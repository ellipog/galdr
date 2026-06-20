use serde::{Deserialize, Serialize};

use crate::models::ConversionParams;

/// How a watched folder handles a newly-detected file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WatchAction {
    /// Convert immediately using the folder's preset, no UI interaction.
    AutoConvert,
    /// Add to the in-app queue for the user to review and convert manually.
    Queue,
}

impl Default for WatchAction {
    fn default() -> Self {
        Self::AutoConvert
    }
}

/// Configuration for a single watch folder. Persisted as part of AppSettings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchFolderConfig {
    /// Stable identifier (uuid). Used as the notify-watcher map key and in
    /// all watch:// events so the UI can correlate activity to a folder.
    pub id: String,
    /// Master toggle — when false the folder is loaded but not watched.
    pub enabled: bool,
    /// Absolute path of the folder to monitor (local filesystem only).
    pub path: String,
    /// Lowercase extensions (without dot) to accept, e.g. ["mp4", "mov"].
    /// Empty = accept all files.
    pub extensions: Vec<String>,
    /// Where converted files are written.
    pub output_dir: String,
    /// What to do when a matching file lands.
    pub action: WatchAction,
    /// Conversion preset cloned per file (input_path/output_dir are
    /// overwritten at run time). Drives AutoConvert and is offered as the
    /// default when the user converts a queued file.
    #[serde(default = "ConversionParams::default_value")]
    pub params: ConversionParams,
    /// Remove the source file after a successful AutoConvert.
    #[serde(default)]
    pub delete_source: bool,
}

impl Default for WatchFolderConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            enabled: true,
            path: String::new(),
            extensions: Vec::new(),
            output_dir: String::new(),
            action: WatchAction::default(),
            params: ConversionParams::default_value(),
            delete_source: false,
        }
    }
}

/// A file waiting in the manual-review queue (for Queue-action folders).
/// Lives only in memory; not persisted — the queue is transitory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedFile {
    /// Unique id for this queue entry (uuid).
    pub id: String,
    /// Which watch folder produced this file.
    pub folder_id: String,
    pub folder_path: String,
    pub path: String,
    pub name: String,
    /// ISO 8601 timestamp of when the file was detected.
    pub queued_at: String,
}
