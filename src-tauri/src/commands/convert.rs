use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

use crate::discord_rpc;
use crate::ffmpeg::{build_args, probe_file, run_conversion};
use crate::models::{BatchConversionParams, ConversionParams, ScannedFile};

pub static CANCELLED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, serde::Serialize)]
#[allow(dead_code)]
pub struct ConversionStartedPayload {
    pub job_id: String,
}

#[derive(Clone, serde::Serialize)]
pub struct ConversionProgressPayload {
    pub job_id: String,
    pub progress: f64,
}

#[derive(Clone, serde::Serialize)]
pub struct ConversionDonePayload {
    pub job_id: String,
    pub output_path: String,
}

#[derive(Clone, serde::Serialize)]
#[allow(dead_code)]
pub struct ConversionErrorPayload {
    pub job_id: String,
    pub error: String,
}

#[derive(Clone, serde::Serialize)]
pub struct ConversionLogPayload {
    pub message: String,
}

#[tauri::command]
pub async fn start_conversion(
    app_handle: tauri::AppHandle,
    params: ConversionParams,
) -> Result<ConversionDonePayload, String> {
    std::fs::create_dir_all(&params.output_dir)
        .map_err(|e| format!("Failed to create output dir: {}", e))?;

    let duration = probe_file(&params.input_path)
        .map(|info| info.duration)
        .unwrap_or(0.0);

    let file_name = std::path::Path::new(&params.input_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    discord_rpc::set_converting(&file_name, 0.0, &params.output_format);

    let args = build_args(&params);
    let events = run_conversion(&args, duration)?;

    for event in &events {
        match event {
            crate::ffmpeg::FfmpegEvent::Progress(p) => {
                discord_rpc::set_converting(&file_name, *p, &params.output_format);
                let _ = app_handle.emit(
                    "conversion-progress",
                    ConversionProgressPayload {
                        job_id: "default".to_string(),
                        progress: *p,
                    },
                );
            }
            crate::ffmpeg::FfmpegEvent::Log(msg) => {
                let _ = app_handle.emit(
                    "conversion-log",
                    ConversionLogPayload {
                        message: msg.clone(),
                    },
                );
            }
            crate::ffmpeg::FfmpegEvent::Done(path) => {
                discord_rpc::set_idle();
                return Ok(ConversionDonePayload {
                    job_id: "default".to_string(),
                    output_path: path.clone(),
                });
            }
            crate::ffmpeg::FfmpegEvent::Error(msg) => {
                discord_rpc::set_idle();
                return Err(msg.clone());
            }
        }
    }

    discord_rpc::set_idle();
    Err("Conversion produced no output".to_string())
}

#[tauri::command]
pub async fn detect_ffmpeg() -> bool {
    crate::ffmpeg::runner::detect_ffmpeg()
}

#[tauri::command]
pub fn get_default_output_dir() -> Result<String, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Could not find home directory".to_string())?;
    let dir = std::path::Path::new(&home)
        .join("Desktop")
        .join("galdr-output");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create output dir: {}", e))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn is_directory(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[tauri::command]
pub fn scan_directory(dir: PathBuf, extension: String) -> Result<Vec<ScannedFile>, String> {
    let ext_filter = if extension.is_empty() {
        None
    } else {
        Some(extension.trim_start_matches('.').to_lowercase())
    };
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.is_file() {
            let ext = path
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_lowercase());
            let match_ext = match (&ext_filter, &ext) {
                (None, _) => true,
                (Some(ref filter), Some(ref e)) => e == filter,
                _ => false,
            };
            if match_ext {
                let name = path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                let size = std::fs::metadata(&path)
                    .map(|m| m.len())
                    .unwrap_or(0);
                files.push(ScannedFile {
                    path: path.to_string_lossy().to_string(),
                    name,
                    size,
                });
            }
        }
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

#[derive(Clone, serde::Serialize)]
pub struct BatchProgressPayload {
    pub total: usize,
    pub done: usize,
    pub failed: usize,
    pub current_file: String,
    pub file_progress: f64,
}

#[tauri::command]
pub async fn start_batch_conversion(
    app_handle: tauri::AppHandle,
    params: BatchConversionParams,
) -> Result<(), String> {
    let extension = params.input_extension.trim_start_matches('.').to_lowercase();
    let mut entries: Vec<PathBuf> = Vec::new();

    for entry in std::fs::read_dir(&params.input_dir)
        .map_err(|e| format!("Failed to read input directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension().and_then(|s| s.to_str()).map(|s| s.to_lowercase()) {
                if ext == extension {
                    entries.push(path);
                }
            }
        }
    }
    entries.sort();

    let total = entries.len();
    std::fs::create_dir_all(&params.output_dir)
        .map_err(|e| format!("Failed to create output dir: {}", e))?;

    let mut done = 0usize;
    let mut failed = 0usize;
    let done_offset = params.skip;

    CANCELLED.store(false, Ordering::SeqCst);

    for input_path in entries.iter().skip(params.skip) {
        if CANCELLED.load(Ordering::SeqCst) {
            break;
        }
        let file_name = input_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        let _ = app_handle.emit(
            "batch-progress",
            BatchProgressPayload {
                total,
                done: done + done_offset,
                failed,
                current_file: file_name.clone(),
                file_progress: 0.0,
            },
        );

        discord_rpc::set_batch(&file_name, done + done_offset + 1, total, 0.0);

        let duration = probe_file(input_path)
            .map(|info| info.duration)
            .unwrap_or(0.0);

        let single_params = ConversionParams {
            input_path: input_path.clone(),
            output_dir: params.output_dir.clone(),
            output_format: params.output_format.clone(),
            video_codec: None,
            audio_codec: None,
            video_bitrate: None,
            audio_bitrate: None,
            resolution: None,
            framerate: None,
            crf: None,
            preset: None,
            quality: None,
            trim_start: None,
            trim_end: None,
            crop_w: None,
            crop_h: None,
            crop_x: None,
            crop_y: None,
            crop_ratio: None,
            speed_video: None,
            speed_audio: None,
            rotate: None,
            sample_rate: None,
            channels: None,
        };

        let args = build_args(&single_params);

        let result: Result<(), String> = (|| {
            let events = run_conversion(&args, duration)?;
            for event in &events {
                match event {
                    crate::ffmpeg::FfmpegEvent::Progress(p) => {
                        discord_rpc::set_batch(&file_name, done + done_offset + 1, total, *p);
                        let _ = app_handle.emit(
                            "batch-progress",
                            BatchProgressPayload {
                                total,
                                done: done + done_offset,
                                failed,
                                current_file: file_name.clone(),
                                file_progress: *p,
                            },
                        );
                    }
                    crate::ffmpeg::FfmpegEvent::Log(msg) => {
                        let _ = app_handle.emit(
                            "batch-log",
                            ConversionLogPayload {
                                message: msg.clone(),
                            },
                        );
                    }
                    crate::ffmpeg::FfmpegEvent::Done(_) => return Ok(()),
                    crate::ffmpeg::FfmpegEvent::Error(msg) => return Err(msg.clone()),
                }
            }
            Ok(())
        })();

        match result {
            Ok(_) => done += 1,
            Err(e) => {
                failed += 1;
                let _ = app_handle.emit(
                    "batch-progress",
                    BatchProgressPayload {
                        total,
                        done: done + done_offset,
                        failed,
                        current_file: format!("{} — {}", file_name, e),
                        file_progress: 0.0,
                    },
                );
            }
        }
    }

    discord_rpc::set_idle();

    let _ = app_handle.emit(
        "batch-progress",
        BatchProgressPayload {
            total,
            done: done + done_offset,
            failed,
            current_file: String::new(),
            file_progress: 1.0,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn update_discord_presence(page: String) {
    match page.as_str() {
        "home" => discord_rpc::set_idle(),
        _ => discord_rpc::set_browsing(&page),
    }
}

#[tauri::command]
pub fn set_discord_enabled(enabled: bool) {
    discord_rpc::set_enabled(enabled);
}

#[tauri::command]
pub fn cancel_conversion() -> Result<(), String> {
    CANCELLED.store(true, Ordering::SeqCst);
    kill_ffmpeg()
}

fn kill_ffmpeg() -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("taskkill")
            .args(["/IM", "ffmpeg.exe", "/F"])
            .output()
            .map(|_| ())
            .map_err(|e| format!("Failed to kill ffmpeg: {}", e))
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("pkill")
            .arg("-9")
            .arg("ffmpeg")
            .output()
            .map(|_| ())
            .map_err(|e| format!("Failed to kill ffmpeg: {}", e))
    }
}
