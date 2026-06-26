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

/// Conflict resolution policy when an output file already exists.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicy {
    /// Skip the conversion — never overwrite, never rename.
    Skip,
    /// Replace the existing output file.
    Overwrite,
    /// Auto-rename with numeric suffix (output_1.mp4, output_2.mp4, …).
    Rename,
}

impl Default for ConflictPolicy {
    fn default() -> Self {
        Self::Skip
    }
}

/// Outcome of a watched-file processing attempt, recorded in the log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WatchLogStatus {
    Success,
    SkippedConflict,
    SkippedAge,
    Failed,
}

/// A single entry in a watch folder's persistent processing history.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchLogEntry {
    pub input_path: String,
    /// One path per output format produced (empty if skipped/failed before write).
    pub output_paths: Vec<String>,
    pub status: WatchLogStatus,
    /// ISO 8601 timestamp of when processing completed.
    pub timestamp: String,
    /// Populated when status == Failed.
    pub error: Option<String>,
}

/// A single output format target for a watch folder. A folder can produce
/// multiple formats from the same source file (e.g. mp4 + webm).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchOutputFormat {
    /// Target format, e.g. "mp4", "webm", "mp3".
    pub output_format: String,
    /// Quality slider 0.0–1.0. None inherits the folder's legacy quality.
    pub quality: Option<f64>,
    /// Optional per-format output directory override. When empty, the folder's
    /// primary output_dir is used.
    #[serde(default)]
    pub output_dir: String,
}

impl Default for WatchOutputFormat {
    fn default() -> Self {
        Self {
            output_format: "mp4".to_string(),
            quality: None,
            output_dir: String::new(),
        }
    }
}

fn default_settle_ms() -> u64 {
    10000 // 10s default per PLAN.md
}

fn default_output_formats() -> Vec<WatchOutputFormat> {
    vec![WatchOutputFormat::default()]
}

/// Maximum number of log entries retained per folder. Older entries are
/// trimmed to keep settings.json bounded.
pub const MAX_LOG_ENTRIES: usize = 100;

/// Configuration for a single watch folder. Persisted as part of AppSettings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchFolderConfig {
    /// Stable identifier (uuid). Used as the notify-watcher map key and in
    /// all watch:// events so the UI can correlate activity to a folder.
    pub id: String,
    /// Master toggle — when false the folder is loaded but not watched.
    pub enabled: bool,
    /// Absolute path of the folder to monitor.
    pub path: String,

    // ── Filtering ──

    /// Glob patterns matched against the filename (not the full path),
    /// e.g. ["*.mp4", "*_hq.*", "screenshot_*.png"]. Empty = accept all files.
    #[serde(default)]
    pub patterns: Vec<String>,
    /// Ignore files whose modification time is older than this many minutes.
    /// 0 = no age limit (default).
    #[serde(default)]
    pub ignore_older_than_minutes: u64,

    // ── Timing ──

    /// Debounce window in milliseconds. A file is only processed once it has
    /// gone unmodified for this long. Default 10000 (10s per PLAN.md).
    #[serde(default = "default_settle_ms")]
    pub settle_ms: u64,

    // ── Output ──

    /// What to do when a matching file lands.
    pub action: WatchAction,
    /// One or more output formats to produce from each source file.
    #[serde(default = "default_output_formats")]
    pub output_formats: Vec<WatchOutputFormat>,
    /// Where converted files are written (used as the default when a format
    /// entry does not override output_dir).
    pub output_dir: String,
    /// Policy when an output file already exists.
    #[serde(default)]
    pub conflict_policy: ConflictPolicy,

    // ── Post-processing ──

    /// Remove the source file after a successful AutoConvert.
    #[serde(default)]
    pub delete_source: bool,
    /// Whether to watch subdirectories recursively.
    #[serde(default)]
    pub recursive: bool,
    /// When true (and recursive is true), output mirrors the relative
    /// subfolder path under the output directory instead of flattening.
    #[serde(default)]
    pub preserve_path: bool,

    // ── Persistent history ──

    /// Most-recent-first log of processed files. Bounded to MAX_LOG_ENTRIES.
    #[serde(default)]
    pub processing_log: Vec<WatchLogEntry>,

    // ── Deprecated fields (kept for migration, do not use in new code) ──

    /// Deprecated: use `patterns` instead. Auto-migrated on load.
    #[serde(default)]
    pub extensions: Vec<String>,
    /// Deprecated: use `output_formats[0]` instead. Auto-migrated on load.
    #[serde(default = "ConversionParams::default_value")]
    pub params: ConversionParams,
}

impl Default for WatchFolderConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            enabled: true,
            path: String::new(),
            patterns: Vec::new(),
            ignore_older_than_minutes: 0,
            settle_ms: default_settle_ms(),
            action: WatchAction::default(),
            output_formats: default_output_formats(),
            output_dir: String::new(),
            conflict_policy: ConflictPolicy::default(),
            delete_source: false,
            recursive: false,
            preserve_path: false,
            processing_log: Vec::new(),
            extensions: Vec::new(),
            params: ConversionParams::default_value(),
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
