use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

use base64::Engine;

use crate::whisper::{
    self, find_model, list_models, require_installed_model, run_whisper, run_whisper_streaming,
    WhisperEvent, WhisperModel,
};

/// Cancel flag shared between the command and `cancel_transcription`.
pub static CANCELLED_TRANSCRIPTION: AtomicBool = AtomicBool::new(false);

// ── Event payloads (mirror conversion.rs) ──

#[derive(Clone, serde::Serialize)]
pub struct TranscribeProgressPayload {
    pub progress: f64,
}

#[derive(Clone, serde::Serialize)]
pub struct TranscribeLogPayload {
    pub message: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressPayload {
    pub model_id: String,
    /// 0.0 – 1.0
    pub progress: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeResult {
    pub srt_path: Option<String>,
    pub vtt_path: Option<String>,
    pub json_path: Option<String>,
    pub output_dir: String,
}

// ── Model management ──

#[tauri::command]
pub fn list_whisper_models() -> Vec<WhisperModel> {
    list_models()
}

#[tauri::command]
pub fn is_whisper_available() -> bool {
    whisper::detect_whisper()
}

/// Download a whisper model into the per-user models dir, streaming progress
/// to the frontend via `whisper-download-progress` events.
#[tauri::command]
pub async fn install_whisper_model(
    app_handle: tauri::AppHandle,
    model_id: String,
) -> Result<WhisperModel, String> {
    let model = find_model(&model_id)
        .ok_or_else(|| format!("unknown model id: {}", model_id))?;

    let dest = crate::whisper::model_path(&model_id)
        .ok_or_else(|| format!("unknown model id: {}", model_id))?;

    if dest.exists() {
        // Already present — report complete and return.
        return Ok(model);
    }

    let tmp_dest = dest.with_extension("part");
    let total = model.size_bytes;
    let model_id_for_thread = model_id.clone();
    let app_for_thread = app_handle.clone();

    // Run the blocking download on a thread so the command stays async and
    // the event loop can deliver progress events.
    let result = tokio::task::spawn_blocking(move || -> Result<WhisperModel, String> {
        CANCELLED_TRANSCRIPTION.store(false, Ordering::SeqCst);

        let mut response = reqwest::blocking::get(&model.url)
            .map_err(|e| format!("download failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "download failed: HTTP {}",
                response.status()
            ));
        }

        // Create the parent dir (usually already created by init_paths, but
        // be safe in case the user wiped %APPDATA%/galdr/models between launches).
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create models dir: {}", e))?;
        }

        let mut file = std::fs::File::create(&tmp_dest)
            .map_err(|e| format!("failed to create temp file: {}", e))?;

        use std::io::Write;
        let mut downloaded: u64 = 0;
        let mut buf = [0u8; 64 * 1024];
        loop {
            if CANCELLED_TRANSCRIPTION.load(Ordering::SeqCst) {
                let _ = std::fs::remove_file(&tmp_dest);
                return Err("download cancelled".to_string());
            }
            let n = Read::read(&mut response, &mut buf)
                .map_err(|e| format!("download read error: {}", e))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .map_err(|e| format!("write error: {}", e))?;
            downloaded = downloaded.saturating_add(n as u64);
            let progress = if total > 0 {
                (downloaded as f64 / total as f64).min(1.0)
            } else {
                0.0
            };
            let _ = app_for_thread.emit(
                "whisper-download-progress",
                DownloadProgressPayload {
                    model_id: model_id_for_thread.clone(),
                    progress,
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                },
            );
        }

        std::fs::rename(&tmp_dest, &dest)
            .map_err(|e| format!("failed to finalize model file: {}", e))?;

        Ok(model)
    })
    .await
    .map_err(|e| format!("download task panicked: {}", e))??;

    // Re-fetch so the returned entry has installed: true.
    Ok(find_model(&model_id).unwrap_or(result))
}

#[tauri::command]
pub fn delete_whisper_model(model_id: String) -> Result<(), String> {
    if let Some(path) = crate::whisper::model_path(&model_id) {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("failed to delete model: {}", e))?;
        }
    }
    Ok(())
}

// ── Transcription ──

/// Generate the 16 kHz mono WAV that whisper.cpp expects, using the bundled
/// ffmpeg. Returns the temp file path.
fn prepare_wav(input_path: &Path) -> Result<PathBuf, String> {
    let temp = std::env::temp_dir().join("galdr-whisper");
    std::fs::create_dir_all(&temp)
        .map_err(|e| format!("failed to create temp dir: {}", e))?;

    let stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio");
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let wav_path = temp.join(format!("{}_{}.wav", stem, suffix));

    let ffmpeg = crate::ffmpeg::ffmpeg_path();
    let mut cmd = Command::new(ffmpeg);
    cmd.args([
        "-y",
        "-i",
    ])
    .arg(input_path)
    .args([
        "-vn",          // drop video if present
        "-ac",          // mono
        "1",
        "-ar",          // 16 kHz
        "16000",
        "-c:a",
        "pcm_s16le",
    ])
    .arg(&wav_path)
    .stdout(Stdio::null())
    .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("failed to run ffmpeg: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("audio extraction failed: {}", stderr.trim()));
    }
    Ok(wav_path)
}

#[derive(Clone, serde::Serialize)]
pub struct DetectedLanguage {
    pub language: String,
}

/// Cheap pass: run whisper with `-l auto` on a short slice and peek at the
/// detected-language line on stderr. Lets the UI show the detected language
/// before the user commits to a full transcription.
#[tauri::command]
pub async fn detect_spoken_language(
    input_path: String,
    model_id: String,
) -> Result<DetectedLanguage, String> {
    let model_path = require_installed_model(&model_id)?;
    let wav = prepare_wav(Path::new(&input_path))?;

    let mut args: Vec<String> = vec![
        "-m".into(),
        model_path.to_string_lossy().to_string(),
        "-f".into(),
        wav.to_string_lossy().to_string(),
        "-l".into(),
        "auto".into(),
        "-ojf".into(), // JSON output so we can parse the detected language
    ];
    // Limit work: transcribe only the first 30 seconds for language detection.
    args.push("-mc".into());
    args.push("0".into());

    let events = run_whisper(&args, 30.0)?;
    let _ = std::fs::remove_file(&wav);

    // Look for a "language = xx" line among logs first.
    for ev in &events {
        if let WhisperEvent::Log(msg) = ev {
            if let Some(code) = extract_language_code(&msg) {
                return Ok(DetectedLanguage { language: code });
            }
        }
    }
    // Fall back to the JSON file (whisper writes it next to the input).
    let json_path = wav.with_extension("json");
    if let Ok(content) = std::fs::read_to_string(&json_path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(lang) = val
                .get("result")
                .and_then(|r| r.get("language"))
                .and_then(|l| l.as_str())
            {
                let _ = std::fs::remove_file(&json_path);
                return Ok(DetectedLanguage {
                    language: lang.to_string(),
                });
            }
        }
    }
    let _ = std::fs::remove_file(&json_path);

    Ok(DetectedLanguage {
        language: "unknown".to_string(),
    })
}

fn extract_language_code(line: &str) -> Option<String> {
    let lower = line.to_lowercase();
    let marker = "language =";
    if let Some(idx) = lower.find(marker) {
        let rest = &line[idx + marker.len()..].trim_start();
        let code: String = rest.chars().take_while(|c| c.is_alphanumeric()).collect();
        if code.len() >= 2 && code.len() <= 8 {
            return Some(code);
        }
    }
    None
}

/// Transcribe an audio/video file to SRT/VTT/JSON using whisper.cpp.
///
/// Steps:
/// 1. Extract 16 kHz mono WAV (whisper.cpp's required input format)
/// 2. Resolve the model file (errors if not installed)
/// 3. Build args with the requested source language / translate flag
/// 4. Stream `transcribe-progress` + `transcribe-log` events as it runs
/// 5. Move the generated SRT/VTT/JSON into the chosen output dir
#[tauri::command]
pub async fn transcribe_audio(
    app_handle: tauri::AppHandle,
    input_path: String,
    model_id: String,
    language: String,
    translate_to_english: bool,
    output_format: String,
    output_dir: String,
) -> Result<TranscribeResult, String> {
    CANCELLED_TRANSCRIPTION.store(false, Ordering::SeqCst);

    let input = Path::new(&input_path);
    let model_path = require_installed_model(&model_id)?;
    let wav_path = prepare_wav(input)?;

    // Probe source duration for progress mapping.
    let duration = crate::ffmpeg::probe_file(input)
        .map(|info| info.duration)
        .unwrap_or(0.0)
        .max(1.0);

    let _ = app_handle.emit(
        "transcribe-log",
        TranscribeLogPayload {
            message: "extracting 16 kHz audio…".to_string(),
        },
    );

    // Build whisper-cli args.
    let mut args: Vec<String> = vec![
        "-m".into(),
        model_path.to_string_lossy().to_string(),
        "-f".into(),
        wav_path.to_string_lossy().to_string(),
    ];

    // Source language: `auto` lets whisper.cpp detect, otherwise the ISO code.
    let lang = if language.trim().is_empty() {
        "auto".to_string()
    } else {
        language.trim().to_lowercase()
    };
    args.push("-l".into());
    args.push(lang.clone());

    if translate_to_english {
        args.push("-tr".into());
    }

    // Output formats. whisper.cpp writes one file per `-o*` flag, named
    // after the input WAV stem.
    let want_srt = matches!(output_format.as_str(), "srt" | "all" | "");
    let want_vtt = matches!(output_format.as_str(), "vtt" | "all" | "");
    let want_json = matches!(output_format.as_str(), "json" | "all" | "");

    // Pin the output basename with `-of` so we always know the exact filename
    // whisper writes, regardless of build. Without this, different whisper.cpp
    // versions name the file `<wav>`, `<wav>.wav`, or `<wav-stem>` and the
    // relocate step below silently fails to find them.
    let out_stem = wav_path.with_file_name(format!(
        "{}_out",
        wav_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("audio"),
    ));
    args.push("-of".into());
    args.push(out_stem.to_string_lossy().to_string());

    if want_srt {
        args.push("-osrt".into());
    }
    if want_vtt {
        args.push("-ovtt".into());
    }
    if want_json {
        args.push("-ojf".into());
    }

    // Thread count — default to available CPUs for throughput.
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    args.push("-t".into());
    args.push(threads.to_string());

    // Ask whisper.cpp to emit `progress = N%` lines on stderr so we can drive
    // the UI progress bar. Without `-pp` it's silent about progress and the
    // bar would sit idle until completion.
    args.push("-pp".into());

    // Run on a blocking thread so the async command stays responsive.
    let app_clone = app_handle.clone();
    let file_name = input
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("audio")
        .to_string();
    crate::discord_rpc::set_transcribing(&file_name, 0.0, &model_id, &lang);

    let _ = app_clone.emit(
        "transcribe-log",
        TranscribeLogPayload {
            message: format!("running whisper-cli ({} threads, lang={})", threads, lang),
        },
    );
    let _ = app_clone.emit(
        "transcribe-log",
        TranscribeLogPayload {
            message: format!("wav: {}", wav_path.display()),
        },
    );
    let _ = app_clone.emit(
        "transcribe-log",
        TranscribeLogPayload {
            message: format!("out stem: {}", out_stem.display()),
        },
    );

    // Stream events to the frontend as they arrive (not buffered at the end)
    // so the progress bar advances live. Discord RPC is also updated in line.
    let app_for_emit = app_clone.clone();
    let file_name_for_emit = file_name.clone();
    let model_id_for_emit = model_id.clone();
    let lang_for_emit = lang.clone();
    let emit = move |ev: &WhisperEvent| match ev {
        WhisperEvent::Progress(p) => {
            crate::discord_rpc::set_transcribing(&file_name_for_emit, *p, &model_id_for_emit, &lang_for_emit);
            let _ = app_for_emit.emit(
                "transcribe-progress",
                TranscribeProgressPayload { progress: *p },
            );
        }
        WhisperEvent::Segment(s) => {
            let _ = app_for_emit.emit(
                "transcribe-log",
                TranscribeLogPayload { message: s.clone() },
            );
        }
        WhisperEvent::Log(msg) => {
            let _ = app_for_emit.emit(
                "transcribe-log",
                TranscribeLogPayload { message: msg.clone() },
            );
        }
        WhisperEvent::Error(msg) => {
            let _ = app_for_emit.emit(
                "transcribe-log",
                TranscribeLogPayload { message: format!("! {}", msg) },
            );
        }
        WhisperEvent::Done(_) => {}
    };

    let run_result = tokio::task::spawn_blocking(move || run_whisper_streaming(&args, duration, emit))
        .await
        .map_err(|e| format!("transcription task panicked: {}", e))?;

    if CANCELLED_TRANSCRIPTION.load(Ordering::SeqCst) {
        let _ = std::fs::remove_file(&wav_path);
        crate::discord_rpc::set_idle();
        return Err("transcription cancelled".to_string());
    }

    // The streaming runner returns Err on a non-zero exit (with the first
    // captured error message). Surface it after cleaning up the temp WAV.
    if let Err(err) = run_result {
        let _ = std::fs::remove_file(&wav_path);
        crate::discord_rpc::set_idle();
        return Err(err);
    }

    // Move generated files into the requested output dir.
    let out_dir = PathBuf::from(&output_dir);
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("failed to create output dir: {}", e))?;

    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("transcript")
        .to_string();
    let wav_stem = wav_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio")
        .to_string();

    let _ = app_clone.emit(
        "transcribe-log",
        TranscribeLogPayload {
            message: format!("output dir: {}", out_dir.display()),
        },
    );

    let mut result = TranscribeResult {
        srt_path: None,
        vtt_path: None,
        json_path: None,
        output_dir: output_dir.clone(),
    };

    /// Locate the file whisper wrote for a given extension by probing the
    /// known naming variants, then move it into the output dir.
    fn relocate(
        ext: &str,
        out_stem: &Path,
        wav_path: &Path,
        wav_stem: &str,
        out_dir: &Path,
        stem: &str,
        log: &dyn Fn(String),
    ) -> Option<String> {
        // Candidate source paths whisper.cpp may have written, across builds:
        //   <out_stem>.<ext>          — when `-of` is honored (our case)
        //   <wav_path>.<ext>          — default behavior
        //   <wav_path>.wav.<ext>      — older builds that keep the .wav
        //   <wav_dir>/<wav_stem>.<ext> — when the .wav extension is stripped
        let mut candidates: Vec<PathBuf> = vec![
            out_stem.with_extension(ext),
            wav_path.with_extension(ext),
        ];
        if let Some(parent) = wav_path.parent() {
            candidates.push(parent.join(format!("{}.{}", wav_stem, ext)));
            candidates.push(parent.join(format!("{}.wav.{}", wav_stem, ext)));
        }
        // Dedupe while preserving order.
        let mut seen = std::collections::HashSet::new();
        candidates.retain(|p| seen.insert(p.clone()));

        let src = candidates.iter().find(|p| p.exists()).cloned();
        let dst = out_dir.join(format!("{}.{}", stem, ext));
        match src {
            Some(src) => {
                log(format!("found .{} → {}", ext, src.display()));
                if std::fs::rename(&src, &dst).is_ok() || std::fs::copy(&src, &dst).is_ok() {
                    let _ = std::fs::remove_file(&src);
                    log(format!("relocated → {}", dst.display()));
                    Some(dst.to_string_lossy().to_string())
                } else {
                    log(format!("! could not move .{} to {}", ext, dst.display()));
                    None
                }
            }
            None => {
                let tried = candidates
                    .iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                log(format!("! no .{} file produced (tried: {})", ext, tried));
                None
            }
        }
    }

    let log_fn = |msg: String| {
        let _ = app_clone.emit(
            "transcribe-log",
            TranscribeLogPayload { message: msg },
        );
    };

    if want_srt {
        result.srt_path = relocate("srt", &out_stem, &wav_path, &wav_stem, &out_dir, &stem, &log_fn);
    }
    if want_vtt {
        result.vtt_path = relocate("vtt", &out_stem, &wav_path, &wav_stem, &out_dir, &stem, &log_fn);
    }
    if want_json {
        result.json_path = relocate("json", &out_stem, &wav_path, &wav_stem, &out_dir, &stem, &log_fn);
    }

    // Clean up the temp WAV and any stray whisper artifacts.
    let _ = std::fs::remove_file(&wav_path);

    let produced = [
        result.srt_path.is_some(),
        result.vtt_path.is_some(),
        result.json_path.is_some(),
    ]
    .iter()
    .filter(|&&b| b)
    .count();
    log_fn(format!("done — {} file(s) in output dir", produced));

    crate::discord_rpc::set_idle();

    Ok(result)
}

#[tauri::command]
pub fn cancel_transcription() -> Result<(), String> {
    CANCELLED_TRANSCRIPTION.store(true, Ordering::SeqCst);
    whisper::kill_whisper()
}

/// Convenience for the UI: surface both the catalog and the binary's
/// availability in a single call so the page can render its empty state.
/// Includes the resolved binary path for diagnostics.
#[tauri::command]
pub fn whisper_status() -> serde_json::Value {
    let path = whisper::whisper_path();
    serde_json::json!({
        "available": whisper::detect_whisper(),
        "resolvedPath": path.to_string_lossy(),
        "models": list_models(),
        "any_installed": list_models().iter().any(|m| m.installed),
    })
}

// ── Phase 2: embed / extract / convert subtitle format ──
//
// Burn-in is handled by `start_conversion` (it routes through build_args via
// the subtitle_mode/subtitle_path fields). The three operations below need
// arguments build_args can't express — multiple `-i` inputs, `-map` flags,
// and container-specific subtitle codecs — so they get their own commands.
// All three reuse `run_conversion` so they stream progress events tagged
// with a job_id just like a normal convert.

/// Codec that FFmpeg should use for an embedded subtitle track, by container.
///
/// MP4/MOV only support `mov_text` (a.k.a. tx3g) for soft subs — passing
/// `ass` or `subrip` into an mp4 silently drops them. MKV is permissive and
/// accepts both. WebM needs `webvtt`.
fn embedded_subtitle_codec(container: &str) -> &'static str {
    match container.to_lowercase().as_str() {
        "mp4" | "m4v" | "mov" | "3gp" => "mov_text",
        "webm" => "webvtt",
        // MKV and everything else: keep the source codec, signalled by "copy".
        _ => "copy",
    }
}

/// Result returned by embed/extract/convert — mirrors ConversionDonePayload.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleOpResult {
    pub job_id: String,
    pub output_path: String,
}

#[tauri::command]
pub async fn embed_subtitle(
    app_handle: tauri::AppHandle,
    input_path: String,
    subtitle_path: String,
    output_path: String,
    lang: Option<String>,
) -> Result<SubtitleOpResult, String> {
    let input = Path::new(&input_path);
    let out = PathBuf::from(&output_path);

    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create output dir: {}", e))?;
    }

    let container = out
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_else(|| "mkv".to_string());
    let sub_codec = embedded_subtitle_codec(&container);

    let duration = crate::ffmpeg::probe_file(input)
        .map(|info| info.duration)
        .unwrap_or(0.0)
        .max(1.0);

    let file_name = input
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("video")
        .to_string();
    crate::discord_rpc::set_converting(&file_name, 0.0, &format!("embed-{}", container), None);

    // Two inputs: the video (0) and the subtitle (1). Map all streams from
    // the video, copy them, and add the subtitle stream as `-c:s <codec>`.
    // `-map 0` keeps every original stream; `-map 1:s` pulls in the new one.
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-i".into(),
        input_path.clone(),
        "-i".into(),
        subtitle_path.clone(),
        "-map".into(),
        "0".into(),
        "-map".into(),
        "1:s:0".into(),
        "-c".into(),
        "copy".into(),
        "-c:s".into(),
        sub_codec.into(),
    ];

    // Attach a language metadata tag to the embedded track when supplied.
    if let Some(language) = &lang {
        let tag = language.trim().to_lowercase();
        if !tag.is_empty() {
            args.push("-metadata:s:s:0".into());
            args.push(format!("language={}", tag));
        }
    }

    args.push(output_path.clone());

    let events = run_conversion_with_log(&app_handle, &args, duration, "embed", &file_name)?;
    let done = events
        .iter()
        .find_map(|ev| match ev {
            crate::ffmpeg::FfmpegEvent::Done(p) => Some(p.clone()),
            _ => None,
        })
        .unwrap_or(output_path);

    crate::discord_rpc::track_conversion();
    crate::discord_rpc::set_idle();
    Ok(SubtitleOpResult {
        job_id: "embed".to_string(),
        output_path: done,
    })
}

#[tauri::command]
pub async fn extract_subtitle(
    app_handle: tauri::AppHandle,
    input_path: String,
    output_path: String,
    stream_index: Option<i32>,
    output_format: String,
) -> Result<SubtitleOpResult, String> {
    let input = Path::new(&input_path);
    let out = PathBuf::from(&output_path);

    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create output dir: {}", e))?;
    }

    // Codec depends on the requested output format. `copy` would fail when
    // the source is a bitmap format (pgssub/dvd_subtitle) — those need
    // burning, not extraction — but for text formats this is a no-op mux.
    let sub_codec = match output_format.to_lowercase().as_str() {
        "srt" => "subrip",
        "vtt" => "webvtt",
        "ass" | "ssa" => "ass",
        _ => "subrip",
    };

    let duration = crate::ffmpeg::probe_file(input)
        .map(|info| info.duration)
        .unwrap_or(0.0)
        .max(1.0);

    let file_name = input
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("video")
        .to_string();
    crate::discord_rpc::set_converting(&file_name, 0.0, &format!("extract-{}", output_format), None);

    // `-map 0:s:<index>` selects a specific subtitle stream. Default to the
    // first (0) when none is requested.
    let idx = stream_index.unwrap_or(0);
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-i".into(),
        input_path.clone(),
        "-map".into(),
        format!("0:s:{}", idx),
        "-c:s".into(),
        sub_codec.into(),
    ];

    args.push(output_path.clone());

    let events = run_conversion_with_log(&app_handle, &args, duration, "extract", &file_name)?;
    let done = events
        .iter()
        .find_map(|ev| match ev {
            crate::ffmpeg::FfmpegEvent::Done(p) => Some(p.clone()),
            _ => None,
        })
        .unwrap_or(output_path);

    crate::discord_rpc::track_conversion();
    crate::discord_rpc::set_idle();
    Ok(SubtitleOpResult {
        job_id: "extract".to_string(),
        output_path: done,
    })
}

#[tauri::command]
pub async fn convert_subtitle_format(
    input_path: String,
    output_path: String,
    output_format: String,
) -> Result<SubtitleOpResult, String> {
    let in_path = Path::new(&input_path);
    let out = PathBuf::from(&output_path);

    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create output dir: {}", e))?;
    }

    let sub_codec = match output_format.to_lowercase().as_str() {
        "srt" => "subrip",
        "vtt" => "webvtt",
        "ass" | "ssa" => "ass",
        _ => "subrip",
    };

    let ffmpeg = crate::ffmpeg::ffmpeg_path();
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-y", "-i"])
        .arg(in_path)
        .arg("-c:s")
        .arg(sub_codec);
    cmd.arg(&out)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("failed to run ffmpeg: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("subtitle conversion failed: {}", stderr.trim()));
    }

    Ok(SubtitleOpResult {
        job_id: "convert-sub".to_string(),
        output_path: output_path,
    })
}

/// Shared runner wrapper for embed/extract that reuses `run_conversion` and
/// surfaces progress + log events under a job_id, just like start_conversion.
fn run_conversion_with_log<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    args: &[String],
    duration: f64,
    job_id: &str,
    file_name: &str,
) -> Result<Vec<crate::ffmpeg::FfmpegEvent>, String> {
    use crate::ffmpeg::FfmpegEvent;

    let emit_app = app_handle.clone();
    let emit_jid = job_id.to_string();
    let emit_fname = file_name.to_string();
    let events = crate::ffmpeg::run_conversion(args, duration, move |ev| {
        match ev {
            FfmpegEvent::Progress(p) => {
                crate::discord_rpc::set_converting(&emit_fname, *p, &emit_jid, None);
                let _ = emit_app.emit(
                    "subtitle-op-progress",
                    serde_json::json!({ "jobId": emit_jid.clone(), "progress": p }),
                );
            }
            FfmpegEvent::Log(msg) => {
                let _ = emit_app.emit(
                    "subtitle-op-log",
                    serde_json::json!({ "jobId": emit_jid.clone(), "message": msg }),
                );
            }
            _ => {}
        }
    })?;

    // Surface the first error as Err.
    for ev in &events {
        if let FfmpegEvent::Error(msg) = ev {
            crate::discord_rpc::set_idle();
            return Err(msg.clone());
        }
    }
    Ok(events)
}

/// Helper: mime type from image extension.
fn mime_from_ext(path: &Path) -> &str {
    match path.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        _ => "image/png",
    }
}

/// Parse an SRT/VTT timestamp (HH:MM:SS[,.]mmm) and return seconds as f64.
fn parse_sub_ts(s: &str) -> Option<f64> {
    // Normalise comma to dot for VTT vs SRT
    let s = s.trim().replace(',', ".");
    let parts: Vec<&str> = s.split(':').collect();
    match parts.len() {
        3 => {
            let h: f64 = parts[0].parse().ok()?;
            let m: f64 = parts[1].parse().ok()?;
            let sec: f64 = parts[2].parse().ok()?;
            Some(h * 3600.0 + m * 60.0 + sec)
        }
        2 => {
            let m: f64 = parts[0].parse().ok()?;
            let sec: f64 = parts[1].parse().ok()?;
            Some(m * 60.0 + sec)
        }
        _ => None,
    }
}

/// Read a subtitle file and extract all cue start times (in seconds).
///
/// Supports SRT, VTT, and ASS formats.
fn extract_cue_starts(path: &Path) -> Vec<f64> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "ass" | "ssa" => {
            // ASS: Dialogue: layer,start,end,style,name,effect,text
            // start format: 0:00:01.00  (H:MM:SS.cc)
            content
                .lines()
                .filter_map(|line| {
                    let line = line.trim();
                    if !line.starts_with("Dialogue:") {
                        return None;
                    }
                    // Split by commas — the 2nd and 3rd comma-separated fields are start,end
                    // But ASS allows commas in the text... We need a smarter split.
                    // Format: Dialogue: layer,start,end,style,name,effect,marginL,marginR,marginV,text
                    // After "Dialogue:", split by commas, but text field is after the 9th comma.
                    // For our purpose, just find the start time which is the 2nd field.
                    let body = line.strip_prefix("Dialogue:").unwrap_or("");
                    // Find the second comma-delimited field (start time).
                    let mut comma_count = 0;
                    let mut start_buf = String::new();
                    for ch in body.chars() {
                        if ch == ',' {
                            comma_count += 1;
                            if comma_count == 2 {
                                break;
                            }
                            continue;
                        }
                        if comma_count == 1 {
                            start_buf.push(ch);
                        }
                    }
                    let start_str = start_buf.trim();
                    if start_str.is_empty() {
                        return None;
                    }
                    parse_sub_ts(start_str)
                })
                .collect()
        }
        _ => {
            // SRT / VTT:  HH:MM:SS[,.]mmm --> HH:MM:SS[,.]mmm
            // The timestamp arrow pattern appears on lines before the text.
            let re = regex::Regex::new(
                r"(\d{1,2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{3}",
            )
            .unwrap();
            content
                .lines()
                .filter_map(|line| {
                    let line = line.trim();
                    if let Some(caps) = re.captures(line) {
                        parse_sub_ts(caps.get(1)?.as_str())
                    } else {
                        None
                    }
                })
                .collect()
        }
    }
}

/// Find the cue start time nearest to `target` seconds.
/// Returns `target` if no cues are available.
fn nearest_cue_time(cues: &[f64], target: f64) -> f64 {
    if cues.is_empty() {
        return target;
    }
    // Binary search for the closest value
    let mut best = cues[0];
    let mut best_dist = (best - target).abs();
    for &c in cues {
        let d = (c - target).abs();
        if d < best_dist {
            best_dist = d;
            best = c;
        }
    }
    best
}

/// Generate a single-frame preview of subtitles burned into a video frame.
///
/// Uses the same `build_subtitle_filter` logic as the real burn-in so the
/// preview accurately reflects what the final output will look like.
/// The seek time is automatically adjusted to the nearest subtitle cue so
/// the preview always shows a frame with visible subtitle text.
/// Returns a base64 data URL suitable for use as an `<img src="...">`.
#[tauri::command]
pub fn preview_subtitle_burn(
    input_path: String,
    subtitle_path: String,
    style: Option<crate::models::SubtitleStyle>,
    seek_seconds: Option<f64>,
) -> Result<String, String> {
    let requested = seek_seconds.unwrap_or(60.0);

    let sub_path = Path::new(&subtitle_path);
    if !sub_path.exists() {
        return Err(format!("subtitle file not found: {}", subtitle_path));
    }

    // Parse the subtitle file to find the cue nearest to the user's requested time.
    let cues = extract_cue_starts(sub_path);
    let seek = nearest_cue_time(&cues, requested) + 0.1;

    // Build the subtitle filter string using the same logic as the real burn-in.
    let filter = crate::ffmpeg::builder::build_subtitle_filter(
        sub_path,
        style.as_ref(),
    )?;

    // Temp output path (reuse galdr-previews convention from commands::preview).
    let temp_dir = std::env::temp_dir().join("galdr-previews");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("create temp dir: {}", e))?;

    let uuid = uuid::Uuid::new_v4();
    let out_path = temp_dir.join(format!("burn-preview-{}.png", uuid));
    let out_str = out_path.to_string_lossy().to_string();

    let ffmpeg = crate::ffmpeg::ffmpeg_path();

    // Construct: ffmpeg -y -i <input> -ss <seek> -vf <filter> -vframes 1 -q:v 2 <out.png>
    // Output seeking (-ss after -i) is slightly slower but frame-accurate, and
    // ensures the subtitles filter has the correct PTS so text is rendered.
    let mut cmd = Command::new(&ffmpeg);
    cmd.arg("-y")
        .arg("-i")
        .arg(&input_path)
        .args(["-ss", &seek.to_string()])
        .arg("-vf")
        .arg(&filter)
        .args(["-vframes", "1", "-q:v", "2"])
        .arg(&out_str)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let status = cmd.status()
        .map_err(|e| format!("failed to run ffmpeg for preview: {}", e))?;

    if !status.success() || !out_path.exists() {
        return Err("ffmpeg preview generation failed — no output frame produced".to_string());
    }

    // Read the PNG and return as base64 data URL.
    let file = std::fs::File::open(&out_path)
        .map_err(|e| format!("failed to open preview: {}", e))?;

    let max_bytes = 10_000_000u64;
    let mut buf = Vec::with_capacity(1024);
    file.take(max_bytes)
        .read_to_end(&mut buf)
        .map_err(|e| format!("failed to read preview: {}", e))?;

    if buf.is_empty() {
        return Err("preview file is empty".to_string());
    }

    let mime = mime_from_ext(&out_path);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);

    // Don't bother deleting the temp file — the OS will clean it up eventually
    // and the temp dir is bounded by the uuid-based naming.

    Ok(format!("data:{};base64,{}", mime, b64))
}

// ── Transcript Editor: file read/write + recovery ──

/// Read the full text content of a subtitle file (SRT, VTT, ASS).
/// Returns the raw text so the frontend can parse it into Cue[].
#[tauri::command]
pub fn read_subtitle_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("file not found: {}", path));
    }
    std::fs::read_to_string(p)
        .map_err(|e| format!("failed to read subtitle file: {}", e))
}

/// Write text content to a subtitle file. Overwrites if it exists.
/// The frontend serialises its Cue[] to SRT/VTT text before calling this.
#[tauri::command]
pub fn save_subtitle_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create output dir: {}", e))?;
    }
    std::fs::write(p, &content)
        .map_err(|e| format!("failed to write subtitle file: {}", e))
}

/// Recovery storage for the transcript editor auto-save feature.
/// Maps to a single JSON file in the app data dir so unsaved editor work
/// can be restored after a crash.
use once_cell::sync::Lazy;
use std::sync::Mutex;

static SUBTITLE_RECOVERY: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

#[tauri::command]
pub fn recovery_save_subtitle_editor(data: String) -> Result<(), String> {
    let path = recovery_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create recovery dir: {}", e))?;
    }
    std::fs::write(&path, &data)
        .map_err(|e| format!("failed to save recovery: {}", e))?;
    // Also keep in memory for instant retrieval.
    if let Ok(mut slot) = SUBTITLE_RECOVERY.lock() {
        *slot = Some(data);
    }
    Ok(())
}

#[tauri::command]
pub fn recovery_load_subtitle_editor() -> Option<String> {
    // Try memory first.
    if let Ok(slot) = SUBTITLE_RECOVERY.lock() {
        if let Some(data) = slot.as_ref() {
            return Some(data.clone());
        }
    }
    // Fall back to disk.
    let path = recovery_path();
    if path.exists() {
        std::fs::read_to_string(&path).ok()
    } else {
        None
    }
}

#[tauri::command]
pub fn recovery_clear_subtitle_editor() -> Result<(), String> {
    if let Ok(mut slot) = SUBTITLE_RECOVERY.lock() {
        *slot = None;
    }
    let path = recovery_path();
    if path.exists() {
        std::fs::remove_file(&path).ok();
    }
    Ok(())
}

fn recovery_path() -> PathBuf {
    let base = std::env::temp_dir();
    base.join("galdr-subtitle-recovery.json")
}
