use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

use crate::whisper::{
    self, find_model, list_models, require_installed_model, run_whisper, WhisperEvent, WhisperModel,
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
            if let Some(code) = extract_language_code(msg) {
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

    let events = tokio::task::spawn_blocking(move || run_whisper(&args, duration))
        .await
        .map_err(|e| format!("transcription task panicked: {}", e))??;

    if CANCELLED_TRANSCRIPTION.load(Ordering::SeqCst) {
        let _ = std::fs::remove_file(&wav_path);
        crate::discord_rpc::set_idle();
        return Err("transcription cancelled".to_string());
    }

    // Drain events to the frontend and surface any error.
    let mut had_error: Option<String> = None;
    for ev in &events {
        match ev {
            WhisperEvent::Progress(p) => {
                crate::discord_rpc::set_transcribing(&file_name, *p, &model_id, &lang);
                let _ = app_clone.emit(
                    "transcribe-progress",
                    TranscribeProgressPayload { progress: *p },
                );
            }
            WhisperEvent::Segment(s) => {
                let _ = app_clone.emit(
                    "transcribe-log",
                    TranscribeLogPayload {
                        message: s.clone(),
                    },
                );
            }
            WhisperEvent::Log(msg) => {
                let _ = app_clone.emit(
                    "transcribe-log",
                    TranscribeLogPayload {
                        message: msg.clone(),
                    },
                );
            }
            WhisperEvent::Error(msg) => {
                if had_error.is_none() {
                    had_error = Some(msg.clone());
                }
            }
            WhisperEvent::Done(_) => {}
        }
    }

    if let Some(err) = had_error {
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
