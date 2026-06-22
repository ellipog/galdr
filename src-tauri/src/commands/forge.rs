use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Emitter;

use crate::discord_rpc;
use crate::ffmpeg::runner::run_conversion;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct ForgeTrack {
    pub clips: Vec<ForgeClip>,
    pub height: u32,
    pub muted: bool,
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeExportProject {
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub video_track: ForgeTrack,
    pub audio_track: ForgeTrack,
    pub zoom_level: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForgeExportOptions {
    pub output_path: String,
    pub format: String,
    pub quality: String,
    pub resolution: String,
}

static EXPORT_CANCELLED: once_cell::sync::Lazy<Mutex<bool>> =
    once_cell::sync::Lazy::new(|| Mutex::new(false));

#[tauri::command]
pub async fn export_timeline(
    app_handle: tauri::AppHandle,
    project: ForgeExportProject,
    options: ForgeExportOptions,
) -> Result<String, String> {
    let mut cancelled = EXPORT_CANCELLED.lock().map_err(|e| e.to_string())?;
    *cancelled = false;
    drop(cancelled);

    let output_path = PathBuf::from(&options.output_path);
    let temp_dir = std::env::temp_dir().join("galdr-forge");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let vclips = &project.video_track.clips;
    if vclips.is_empty() {
        return Err("no clips on timeline".to_string());
    }

    let aclips = &project.audio_track.clips;

    // Map quality to preset + crf
    let (preset, crf) = match options.quality.as_str() {
        "high" => ("slow", "18"),
        "fast" => ("fast", "28"),
        _ => ("medium", "23"),
    };

    // Build scale filter if resolution is not "source"
    let scale_filter = match options.resolution.as_str() {
        "1080p" => Some(format!("scale=-2:1080")),
        "720p" => Some(format!("scale=-2:720")),
        _ => None,
    };

    let total_steps = vclips.len() + aclips.len();
    let mut steps_done: f64 = 0.0;

    let total_clips = vclips.len();
    discord_rpc::set_forge_exporting(total_clips, 1, 0.0);

    fn update_progress(app_handle: &tauri::AppHandle, done: f64, total: f64) {
        let p = if total > 0.0 { (done / total).min(0.95) } else { 0.0 };
        app_handle
            .emit("forge-export-progress", serde_json::json!({ "progress": p }))
            .ok();
    }

    fn is_cancelled() -> Result<(), String> {
        let c = EXPORT_CANCELLED.lock().map_err(|e| e.to_string())?;
        if *c { Err("export cancelled".to_string()) } else { Ok(()) }
    }

    // ── 1. Render video clips (no audio) with gaps as black ──

    let mut processed_v = vclips.clone();
    for i in (0..processed_v.len()).rev() {
        let clip_end = processed_v[i].start_time + processed_v[i].duration;
        let c_speed = processed_v[i].speed;
        let c_src_start = processed_v[i].source_start;

        for j in (i + 1)..processed_v.len() {
            if processed_v[j].start_time >= clip_end { break; }
            let new_dur = processed_v[j].start_time - processed_v[i].start_time;
            if new_dur > 0.0 {
                processed_v[i].duration = new_dur;
                processed_v[i].source_end = c_src_start + new_dur * c_speed;
            }
            break;
        }
    }

    processed_v.sort_by(|a, b| a.start_time.partial_cmp(&b.start_time).unwrap());

    let mut vid_concat: Vec<String> = Vec::new();
    let mut seg_counter = 0u32;
    let mut cursor = 0.0;

    for clip in &processed_v {
        is_cancelled()?;

        // Black segment for gap before this clip
        if clip.start_time > cursor + 0.001 {
            let gap_dur = clip.start_time - cursor;
            let black_path = temp_dir.join(format!("seg_{:04}.ts", seg_counter));
            seg_counter += 1;
            let bpath = black_path.to_string_lossy().to_string();

            let black_args = vec![
                "-y".to_string(),
                "-f".to_string(), "lavfi".to_string(),
                "-i".to_string(), format!("color=c=black:s={}x{}:d={}", project.width, project.height, gap_dur),
                "-an".to_string(),
                "-c:v".to_string(), "libx264".to_string(),
                "-preset".to_string(), preset.to_string(),
                "-crf".to_string(), crf.to_string(),
                "-pix_fmt".to_string(), "yuv420p".to_string(),
                bpath.clone(),
            ];
            run_conversion(&black_args, gap_dur, |_| {})?;
            vid_concat.push(format!("file '{}'", bpath.replace('\\', "\\\\")));
        }

        // Process this clip
        let part_path = temp_dir.join(format!("seg_{:04}.ts", seg_counter));
        seg_counter += 1;
        let inter_path = part_path.to_string_lossy().to_string();
        let dur = clip.source_end - clip.source_start;

        let mut args = vec![
            "-y".to_string(),
            "-ss".to_string(), format!("{}", clip.source_start),
            "-i".to_string(), clip.source_path.clone(),
            "-t".to_string(), format!("{}", dur),
            "-an".to_string(),
        ];

        if (clip.speed - 1.0).abs() > 0.01 {
            let setpts = format!("setpts={}*PTS", 1.0 / clip.speed);
            let vf = if let Some(ref scale) = scale_filter {
                format!("{},{}", scale, setpts)
            } else {
                setpts
            };
            args.extend_from_slice(&["-vf".to_string(), vf]);
        } else if let Some(ref scale) = scale_filter {
            args.extend_from_slice(&["-vf".to_string(), scale.clone()]);
        }

        args.extend_from_slice(&[
            "-c:v".to_string(), "libx264".to_string(),
            "-preset".to_string(), preset.to_string(),
            "-crf".to_string(), crf.to_string(),
            "-pix_fmt".to_string(), "yuv420p".to_string(),
            inter_path.clone(),
        ]);

        run_conversion(&args, dur, |_| {})?;

        vid_concat.push(format!("file '{}'", inter_path.replace('\\', "\\\\")));
        cursor = clip.start_time + clip.duration;
        steps_done += 1.0;
        update_progress(&app_handle, steps_done, total_steps as f64);
        let current_clip = ((steps_done) as usize).min(total_clips);
        discord_rpc::set_forge_exporting(total_clips, current_clip, steps_done / total_steps as f64);
    }

    // Concat all video parts (clips + black gaps) into temp file
    let vcat_path = temp_dir.join("vcat.txt");
    std::fs::write(&vcat_path, vid_concat.join("\n")).map_err(|e| e.to_string())?;
    let vtemp = temp_dir.join("video_temp.ts");

    let merge_args = vec![
        "-y".to_string(),
        "-f".to_string(), "concat".to_string(),
        "-safe".to_string(), "0".to_string(),
        "-i".to_string(), vcat_path.to_string_lossy().to_string(),
        "-c".to_string(), "copy".to_string(),
        vtemp.to_string_lossy().to_string(),
    ];
    run_conversion(&merge_args, vclips.len() as f64, |_| {})?;

    // ── 2. Render audio clips from audio track (no video) ──

    let mut atemp: Option<PathBuf> = None;

    if !aclips.is_empty() {
        let mut audio_inputs: Vec<String> = Vec::new();
        let mut filter_parts: Vec<String> = Vec::new();

        for (i, clip) in aclips.iter().enumerate() {
            is_cancelled()?;

            let seg_path = temp_dir.join(format!("aud_{:04}.wav", i));
            let dur = clip.source_end - clip.source_start;

            let mut args = vec![
                "-y".to_string(),
                "-ss".to_string(), format!("{}", clip.source_start),
                "-i".to_string(), clip.source_path.clone(),
                "-t".to_string(), format!("{}", dur),
                "-vn".to_string(),
            ];

            if (clip.speed - 1.0).abs() > 0.01 {
                let atempo_val = clip.speed;
                let atempo = if atempo_val > 2.0 || atempo_val < 0.5 {
                    format!("atempo={},atempo={}", atempo_val.sqrt(), atempo_val.sqrt())
                } else {
                    format!("atempo={}", atempo_val)
                };
                args.extend_from_slice(&["-af".to_string(), atempo]);
            }

            args.extend_from_slice(&[
                "-c:a".to_string(), "pcm_s16le".to_string(),
                seg_path.to_string_lossy().to_string(),
            ]);

            run_conversion(&args, dur, |_| {})?;

            let delay_ms = (clip.start_time * 1000.0) as u64;
            audio_inputs.push("-i".to_string());
            audio_inputs.push(seg_path.to_string_lossy().to_string());
            filter_parts.push(format!("[{}:a]adelay={}|{}[a{}]", i, delay_ms, delay_ms, i));

            steps_done += 1.0;
            update_progress(&app_handle, steps_done, total_steps as f64);
        }

        if !filter_parts.is_empty() {
            let n = filter_parts.len();
            let adelay_chain = filter_parts.join(";");
            let mix_inputs: Vec<String> = (0..n).map(|i| format!("[a{}]", i)).collect();
            let mix = format!("{};{}amix=inputs={}:duration=longest[outa]",
                adelay_chain, mix_inputs.join(""), n);

            let atemp_path = temp_dir.join("audio_temp.wav");
            let mut mix_cmd = vec!["-y".to_string()];
            mix_cmd.extend(audio_inputs);
            mix_cmd.extend_from_slice(&[
                "-filter_complex".to_string(), mix,
                "-map".to_string(), "[outa]".to_string(),
                atemp_path.to_string_lossy().to_string(),
            ]);

            run_conversion(&mix_cmd, 1.0, |_| {})?;
            atemp = Some(atemp_path);
        }
    }

    // ── 3. Mux video + audio into final output ──

    if let Some(audio_path) = atemp {
        let final_args = vec![
            "-y".to_string(),
            "-i".to_string(), vtemp.to_string_lossy().to_string(),
            "-i".to_string(), audio_path.to_string_lossy().to_string(),
            "-c:v".to_string(), "copy".to_string(),
            "-c:a".to_string(), "aac".to_string(),
            "-b:a".to_string(), "192k".to_string(),
            "-shortest".to_string(),
            output_path.to_string_lossy().to_string(),
        ];
        run_conversion(&final_args, 1.0, |_| {})?;
    } else {
        std::fs::copy(&vtemp, &output_path).map_err(|e| e.to_string())?;
    }

    app_handle
        .emit("forge-export-progress", serde_json::json!({ "progress": 1.0 }))
        .ok();

    discord_rpc::track_conversion();
    discord_rpc::set_idle();

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn pre_render_timeline(
    app_handle: tauri::AppHandle,
    project: ForgeExportProject,
) -> Result<String, String> {
    let temp_dir = std::env::temp_dir().join("galdr-forge");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let clips = &project.video_track.clips;
    if clips.is_empty() {
        return Err("no clips on timeline".to_string());
    }

    let total_clips = clips.len();
    discord_rpc::set_forge_prerendering(total_clips, 1, 0.0);

    let output_path = temp_dir.join(format!(
        "preview_{}.mp4",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));

    let preset = "ultrafast";
    let crf = "28";

    let mut concat_parts: Vec<String> = Vec::new();

    let mut processed_clips = clips.clone();
    for i in (0..processed_clips.len()).rev() {
        let clip_end = processed_clips[i].start_time + processed_clips[i].duration;
        let c_speed = processed_clips[i].speed;
        let c_src_start = processed_clips[i].source_start;

        for j in (i + 1)..processed_clips.len() {
            if processed_clips[j].start_time >= clip_end {
                break;
            }
            let new_dur = processed_clips[j].start_time - processed_clips[i].start_time;
            if new_dur > 0.0 {
                processed_clips[i].duration = new_dur;
                processed_clips[i].source_end = c_src_start + new_dur * c_speed;
            }
            break;
        }
    }

    for (i, clip) in processed_clips.iter().enumerate() {
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
            preset.to_string(),
            "-crf".to_string(),
            crf.to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "192k".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            inter_path.clone(),
        ]);

        let events = run_conversion(&args, dur, |_| {})?;
        for event in &events {
            if let crate::ffmpeg::runner::FfmpegEvent::Error(e) = event {
                return Err(format!("clip {} error: {}", i, e));
            }
        }

        concat_parts.push(format!("file '{}'", inter_path.replace('\\', "\\\\")));

        let progress = (i + 1) as f64 / clips.len() as f64;
        discord_rpc::set_forge_prerendering(clips.len(), i + 1, progress);
        app_handle
            .emit("forge-render-progress", serde_json::json!({ "progress": progress }))
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

    run_conversion(&merge_args, clips.len() as f64, |_| {})?;

    app_handle
        .emit("forge-render-progress", serde_json::json!({ "progress": 1.0 }))
        .ok();

    discord_rpc::set_idle();

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_temp_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
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