use crate::models::settings::{AppSettings, WindowState};
use std::fs;
use std::path::PathBuf;

fn store_dir() -> PathBuf {
    let mut dir = dirs_data_dir();
    dir.push("galdr");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn dirs_data_dir() -> PathBuf {
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

#[tauri::command]
pub fn load_settings() -> AppSettings {
    let path = store_dir().join("settings.json");
    if !path.exists() {
        return AppSettings::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = store_dir().join("settings.json");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// The frontend auto-saves preferences (output_dir, toggles, etc.) whenever
/// the user changes any general setting.  We load the *full* `settings.json`
/// off disk and only overwrite the UI-managed fields, so that
/// backend-only fields such as `watch_folders` and `notify_on_watch_complete`
/// are never accidentally wiped.
#[tauri::command]
pub fn save_app_preferences(
    output_dir: String,
    transition_style: String,
    crt_enabled: bool,
    show_rune_in_titlebar: bool,
    discord_enabled: bool,
) -> Result<(), String> {
    let path = store_dir().join("settings.json");
    let mut existing = load_settings();
    existing.output_dir = output_dir;
    existing.transition_style = transition_style;
    existing.crt_enabled = crt_enabled;
    existing.show_rune_in_titlebar = show_rune_in_titlebar;
    existing.discord_enabled = discord_enabled;
    let json = serde_json::to_string_pretty(&existing).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_window_state() -> Option<WindowState> {
    let path = store_dir().join("window-state.json");
    if !path.exists() {
        return None;
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
}

#[tauri::command]
pub fn save_window_state(state: WindowState) -> Result<(), String> {
    let path = store_dir().join("window-state.json");
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_forge_recovery(data: String) -> Result<(), String> {
    let path = store_dir().join("forge-recovery.json");
    fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_forge_recovery() -> Option<String> {
    let path = store_dir().join("forge-recovery.json");
    if !path.exists() {
        return None;
    }
    fs::read_to_string(&path).ok()
}

#[tauri::command]
pub fn clear_forge_recovery() -> Result<(), String> {
    let path = store_dir().join("forge-recovery.json");
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
