pub mod models;
pub mod runner;

pub use models::*;
pub use runner::*;

use once_cell::sync::OnceCell;
use std::path::PathBuf;
use tauri::Manager;

/// Resolved location of the whisper-cli binary, or `None` if no candidate
/// was found on disk or PATH. Set once during `init_paths`.
static WHISPER_PATH: OnceCell<Option<PathBuf>> = OnceCell::new();

/// Per-user directory for downloaded whisper models.
/// Lives alongside `settings.json` in `%APPDATA%/galdr/models/` so models
/// survive app updates and aren't bundled into the installer.
static MODELS_DIR: OnceCell<PathBuf> = OnceCell::new();

/// Try several candidate locations for the bundled whisper-cli binary.
///
/// `resource_dir()` is reliable in packaged builds but can resolve
/// surprisingly during `tauri dev` (it points at the crate root, not a
/// staging dir). We probe in order:
///   1. `resource_dir()/binaries/whisper-cli(.exe)`
///   2. `current_exe()`'s sibling `binaries/whisper-cli(.exe)`
///   3. `src-tauri/binaries/whisper-cli(.exe)` (dev fallback)
///   4. PATH lookup
fn locate_whisper(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let exe_name = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };

    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. Tauri resource dir (works in packaged builds, sometimes dev)
    if let Ok(resource) = app_handle.path().resource_dir() {
        candidates.push(resource.join("binaries").join(exe_name));
    }

    // 2. Sibling to the running .exe (defensive — covers sidecar-like layouts)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("binaries").join(exe_name));
            candidates.push(parent.join(exe_name));
        }
    }

    // 3. Dev fallback: <crate>/src-tauri/binaries/ relative to CWD
    candidates.push(PathBuf::from("src-tauri").join("binaries").join(exe_name));
    candidates.push(PathBuf::from("binaries").join(exe_name));

    for candidate in &candidates {
        if candidate.exists() {
            return Some(candidate.clone());
        }
    }

    // 4. PATH lookup as a last resort.
    which_whisper()
}

/// Best-effort PATH lookup for the whisper-cli binary.
fn which_whisper() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(exe);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

pub fn init_paths(app_handle: &tauri::AppHandle) {
    let resolved = locate_whisper(app_handle);
    WHISPER_PATH.set(resolved).ok();

    // Models dir mirrors the settings storage location (see settings.rs).
    let mut dir = data_dir();
    dir.push("galdr");
    dir.push("models");
    let _ = std::fs::create_dir_all(&dir);
    MODELS_DIR.set(dir).ok();
}

fn data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                let home = std::env::var("USERPROFILE").unwrap_or_default();
                PathBuf::from(home).join("AppData").join("Roaming")
            })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join(".config")
    }
}

/// Resolve the whisper-cli binary path, or fall back to the bare command
/// name (letting the OS resolve it via PATH at spawn time).
pub fn whisper_path() -> PathBuf {
    if let Some(Some(resolved)) = WHISPER_PATH.get() {
        return resolved.clone();
    }
    // Bare name so a PATH-resolved install still works; includes the .exe on
    // Windows so .exists() checks in detect_whisper() can match it.
    if cfg!(windows) {
        PathBuf::from("whisper-cli.exe")
    } else {
        PathBuf::from("whisper-cli")
    }
}

/// Directory holding installed whisper ggml model files.
pub fn models_dir() -> PathBuf {
    MODELS_DIR
        .get()
        .cloned()
        .unwrap_or_else(|| data_dir().join("galdr").join("models"))
}
