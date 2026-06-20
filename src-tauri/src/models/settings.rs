use serde::{Deserialize, Serialize};

use crate::models::watch_folder::WatchFolderConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub output_dir: String,
    pub transition_style: String,
    pub crt_enabled: bool,
    pub show_rune_in_titlebar: bool,
    pub discord_enabled: bool,
    /// Watch-folder configs. Each entry is monitored by the watcher daemon.
    #[serde(default)]
    pub watch_folders: Vec<WatchFolderConfig>,
    /// Fire an OS toast when a watched-file conversion finishes.
    #[serde(default)]
    pub notify_on_watch_complete: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            output_dir: String::new(),
            transition_style: "none".into(),
            crt_enabled: false,
            show_rune_in_titlebar: true,
            discord_enabled: true,
            watch_folders: Vec::new(),
            notify_on_watch_complete: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}
