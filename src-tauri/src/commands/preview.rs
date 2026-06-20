use base64::Engine;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Once;

static TEMP_INIT: Once = Once::new();

fn temp_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("galdr-previews");
    TEMP_INIT.call_once(|| {
        let _ = std::fs::create_dir_all(&dir);
    });
    dir
}

fn clean_temp() {
    let dir = temp_dir();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "png") {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

fn mime_from_ext(path: &Path) -> &str {
    match path.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "tiff" | "tif" => "image/tiff",
        "svg" => "image/svg+xml",
        _ => "image/png",
    }
}

#[tauri::command]
pub fn extract_frames(paths: Vec<String>, timestamp: f64) -> Result<Vec<String>, String> {
    clean_temp();
    let mut results = Vec::new();
    for path in &paths {
        let input = Path::new(path);
        let stem = input
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("frame");
        let uuid = uuid::Uuid::new_v4();
        let out_path = temp_dir().join(format!("{}_{}.png", stem, uuid));
        let out_str = out_path.to_string_lossy().to_string();

        let mut cmd = Command::new("ffmpeg");
        cmd.args([
                "-y",
                "-i",
                path,
                "-ss",
                &timestamp.to_string(),
                "-vframes",
                "1",
                "-q:v",
                "2",
            ])
            .arg(&out_str)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let status = cmd.status()
            .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

        if status.success() && out_path.exists() {
            results.push(out_str);
        } else {
            results.push(String::new());
        }
    }
    Ok(results)
}

#[tauri::command]
pub fn read_image_data_url(path: String) -> Result<String, String> {
    let file_path = Path::new(&path);
    let mime = mime_from_ext(file_path);

    let file =
        std::fs::File::open(file_path).map_err(|e| format!("Failed to open file: {}", e))?;

    let max_bytes = 10_000_000;
    let mut buf = Vec::with_capacity(max_bytes.min(1024));
    file.take(max_bytes as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    if buf.is_empty() {
        return Err("File is empty".to_string());
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Ok(format!("data:{};base64,{}", mime, b64))
}
