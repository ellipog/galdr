use std::path::Path;
use std::process::Command;

use crate::models::MediaInfo;
use crate::models::StreamInfo;

pub fn probe_file(path: &Path) -> Result<MediaInfo, String> {
    let ffprobe = crate::ffmpeg::ffprobe_path();
    let mut cmd = Command::new(ffprobe);
    cmd.args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output()
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let raw: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("JSON parse error: {}", e))?;

    let format = &raw["format"];
    let container = format["format_name"].as_str().unwrap_or("unknown").to_string();
    let duration: f64 = format["duration"].as_str().unwrap_or("0").parse().unwrap_or(0.0);
    let bitrate: Option<u64> = format["bit_rate"]
        .as_str()
        .and_then(|s| s.parse().ok());
    let size: u64 = format["size"].as_str().unwrap_or("0").parse().unwrap_or(0);

    let streams: Vec<StreamInfo> = raw["streams"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .enumerate()
                .map(|(i, s)| StreamInfo {
                    index: i as u32,
                    kind: s["codec_type"].as_str().unwrap_or("unknown").to_string(),
                    codec: s["codec_name"].as_str().unwrap_or("unknown").to_string(),
                    width: s["width"].as_u64().map(|v| v as u32),
                    height: s["height"].as_u64().map(|v| v as u32),
                    frame_rate: s["r_frame_rate"]
                        .as_str()
                        .and_then(parse_fraction),
                    sample_rate: s["sample_rate"].as_str().and_then(|r| r.parse().ok()),
                    channels: s["channels"].as_u64().map(|v| v as u8),
                    bitrate: s["bit_rate"].as_str().and_then(|b| b.parse().ok()),
                    language: s["tags"]["language"].as_str().map(|l| l.to_string()),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(MediaInfo {
        container,
        streams,
        duration,
        bitrate,
        size,
    })
}

fn parse_fraction(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split('/').collect();
    if parts.len() == 2 {
        let num: f64 = parts[0].parse().ok()?;
        let den: f64 = parts[1].parse().ok()?;
        if den != 0.0 {
            return Some(num / den);
        }
    }
    None
}

/// Lightweight duration-only probe. Used by the builder to place audio
/// fade-outs at the real end of the (trimmed/sped-up) media. Returns 0.0
/// on any failure so it can never break argument generation.
pub fn probe_duration(path: &Path) -> f64 {
    let ffprobe = crate::ffmpeg::ffprobe_path();
    let mut cmd = Command::new(ffprobe);
    cmd.args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
        ])
        .arg(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = match cmd.output()
    {
        Ok(o) => o,
        Err(_) => return 0.0,
    };
    let raw: serde_json::Value = match serde_json::from_slice(&output.stdout) {
        Ok(v) => v,
        Err(_) => return 0.0,
    };
    raw["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0)
}
