use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Emitter;

use crate::ffmpeg::runner::run_conversion;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForgeClip {
    pub id: String,
    pub name: String,
    pub source_path: String,
    pub start_time: f64,
    pub duration: f64,
    pub source_start: f64,
    pub source_end: f64,
    pub speed: f64,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForgeTrack {
    pub clips: Vec<ForgeClip>,
    pub height: u32,
    pub muted: bool,
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForgeExportProject {
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub video_track: ForgeTrack,
    pub audio_track: ForgeTrack,
    pub zoom_level: f64,
}

static EXPORT_CANCELLED: once_cell::sync::Lazy<Mutex<bool>> =
    once_cell::sync::Lazy::new(|| Mutex::new(false));

#[tauri::command]
pub async fn export_timeline(
    app_handle: tauri::AppHandle,
    project: ForgeExportProject,
    output_dir: String,
) -> Result<String, String> {
    let mut cancelled = EXPORT_CANCELLED.lock().map_err(|e| e.to_string())?;
    *cancelled = false;
    drop(cancelled);

    let output_path = PathBuf::from(&output_dir).join("forge_export.mp4");
    let temp_dir = std::env::temp_dir().join("galdr-forge");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let clips = &project.video_track.clips;
    if clips.is_empty() {
        return Err("no clips on timeline".to_string());
    }

    let mut concat_parts: Vec<String> = Vec::new();

    for (i, clip) in clips.iter().enumerate() {
        {
            let c = EXPORT_CANCELLED.lock().map_err(|e| e.to_string())?;
            if *c {
                return Err("export cancelled".to_string());
            }
        }

        let part_path = temp_dir.join(format!("part_{:04}.ts", i));
        let inter_path = part_path.to_string_lossy().to_string();

        let dur = clip.source_end - clip.source_start;
        let mut args = vec![
            "-y".to_string(),
            "-ss".to_string(),
            format!("{}", clip.source_start),
            "-i".to_string(),
            clip.source_path.clone(),
            "-t".to_string(),
            format!("{}", dur),
        ];

        if (clip.speed - 1.0).abs() > 0.01 {
            let setpts = format!("setpts={}*PTS", 1.0 / clip.speed);
            args.extend_from_slice(&["-vf".to_string(), setpts]);
            let atempo_val = clip.speed;
            let atempo = if atempo_val > 2.0 || atempo_val < 0.5 {
                format!("atempo={},atempo={}", atempo_val.sqrt(), atempo_val.sqrt())
            } else {
                format!("atempo={}", atempo_val)
            };
            args.extend_from_slice(&["-af".to_string(), atempo]);
        }

        args.extend_from_slice(&[
            "-c:v".to_string(),
            "libx264".to_string(),
            "-preset".to_string(),
            "fast".to_string(),
            "-crf".to_string(),
            "18".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "192k".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            inter_path.clone(),
        ]);

        let events = run_conversion(&args, dur)?;
        for event in &events {
            match event {
                crate::ffmpeg::runner::FfmpegEvent::Error(e) => {
                    return Err(format!("clip {} error: {}", i, e));
                }
                _ => {}
            }
        }

        concat_parts.push(format!("file '{}'", inter_path.replace('\\', "\\\\")));

        let progress = (i + 1) as f64 / clips.len() as f64;
        app_handle
            .emit("forge-export-progress", serde_json::json!({ "progress": progress }))
            .ok();
    }

    let concat_path = temp_dir.join("concat.txt");
    let concat_content = concat_parts.join("\n");
    std::fs::write(&concat_path, &concat_content).map_err(|e| e.to_string())?;

    let merge_args = vec![
        "-y".to_string(),
        "-f".to_string(),
        "concat".to_string(),
        "-safe".to_string(),
        "0".to_string(),
        "-i".to_string(),
        concat_path.to_string_lossy().to_string(),
        "-c".to_string(),
        "copy".to_string(),
        output_path.to_string_lossy().to_string(),
    ];

    let _ = run_conversion(&merge_args, clips.len() as f64)?;

    app_handle
        .emit("forge-export-progress", serde_json::json!({ "progress": 1.0 }))
        .ok();

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn cancel_forge_export() -> Result<(), String> {
    let mut cancelled = EXPORT_CANCELLED.lock().map_err(|e| e.to_string())?;
    *cancelled = true;
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/IM", "ffmpeg.exe", "/F"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-9", "ffmpeg"])
            .output();
    }
    Ok(())
}

#[tauri::command]
pub async fn save_project_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_project_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Reads file bytes up to 200MB. Used for video preview blob URLs.
/// Limits to prevent OOM on huge files.
#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let max_bytes: u64 = 200 * 1024 * 1024;
    let metadata = std::fs::metadata(&path).map_err(|e| format!("Cannot access file: {}", e))?;
    if metadata.len() > max_bytes {
        return Err(format!(
            "File too large for preview ({} MB). Max is 200 MB.",
            metadata.len() / (1024 * 1024)
        ));
    }
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}