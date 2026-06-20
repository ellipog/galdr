//! Watch-folder daemon.
//!
//! One `notify` watcher per configured folder. On a create/modify event the
//! file is debounced (settle check), filtered by extension, then either
//! auto-converted (Phase 3) or pushed to the in-memory review queue and
//! surfaced to the UI via `watch://` events.
//!
//! Designed to keep running while the main window is hidden (close-to-tray):
//! it lives entirely in Tauri managed state and emits events that the UI
//! re-subscribes to whenever it's visible.

use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::Utc;
use notify::{event::EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use uuid::Uuid;

use crate::commands::settings::load_settings;
use crate::models::watch_folder::{QueuedFile, WatchAction, WatchFolderConfig};
use crate::tray;

/// Per-folder "last seen" timestamps to debounce rapid create+write bursts.
/// Keyed by file path. A file is only processed once it has gone unmodified
/// for `SETTLE_MS`.
const SETTLE_MS: u64 = 1500;
/// How often the settle-sweep loop runs.
const SWEEP_INTERVAL_MS: u64 = 500;

/// Managed state: active notify watchers + the review queue.
pub struct WatcherState {
    /// Active watchers keyed by folder id. Dropping a watcher stops it.
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    /// Files seen but not yet settled, keyed by (folder_id, path).
    pending: Mutex<HashMap<String, (Instant, String, String)>>, // key -> (first_seen, folder_id, path)
    /// The manual-review queue (Queue-action folders).
    queue: Mutex<VecDeque<QueuedFile>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
            queue: Mutex::new(VecDeque::new()),
        }
    }
}

impl WatcherState {
    pub fn queued_files(&self) -> Vec<QueuedFile> {
        self.queue.lock().map(|q| q.iter().cloned().collect()).unwrap_or_default()
    }

    pub fn take_queue(&self) -> Vec<QueuedFile> {
        self.queue.lock().map(|mut q| q.drain(..).collect()).unwrap_or_default()
    }

    pub fn remove_queued(&self, id: &str) -> Option<QueuedFile> {
        self.queue
            .lock()
            .ok()?
            .iter()
            .position(|f| f.id == id)
            .and_then(|i| self.queue.lock().ok()?.remove(i))
    }
}

/// Start (or replace) watchers for all enabled folders in settings. Called
/// from `setup` and whenever watch-folder config changes.
pub fn start_watcher<R: Runtime>(app: &AppHandle<R>) {
    let settings = load_settings();
    stop_watcher(app);

    let state = app.state::<WatcherState>();

    let mut watchers = HashMap::new();
    let enabled_count;

    state.pending.lock().expect("pending poisoned").clear();

    enabled_count = settings
        .watch_folders
        .iter()
        .filter(|f| f.enabled)
        .count();

    // Clone config + app handle for each watcher closure.
    for folder in settings.watch_folders.iter().filter(|f| f.enabled) {
        match spawn_folder_watcher(app.clone(), folder.clone()) {
            Ok(w) => {
                watchers.insert(folder.id.clone(), w);
            }
            Err(e) => {
                eprintln!("[watcher] failed to watch {}: {}", folder.path, e);
            }
        }
    }

    *state.watchers.lock().expect("watchers poisoned") = watchers;

    // Reflect status in the tray tooltip.
    if enabled_count > 0 {
        tray::set_tooltip_status(app, Some(&format!("watching {} folder{}", enabled_count, if enabled_count == 1 { "" } else { "s" })));
    } else {
        tray::set_tooltip_status(app, None);
    }

    // Kick off the settle-sweep loop once.
    ensure_sweep_loop(app.clone());
}

/// Stop all watchers and clear pending detections (queue is preserved).
pub fn stop_watcher<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<WatcherState>();
    state.watchers.lock().expect("watchers poisoned").clear();
    state.pending.lock().expect("pending poisoned").clear();
}

/// Build a notify watcher for a single folder. The handler debounces events
/// via the shared `pending` map; the sweep loop promotes settled files.
fn spawn_folder_watcher<R: Runtime>(
    app: AppHandle<R>,
    folder: WatchFolderConfig,
) -> notify::Result<RecommendedWatcher> {
    let folder_id = folder.id.clone();
    let folder_path = folder.path.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let event = match res {
            Ok(e) => e,
            Err(_) => return,
        };
        // Only react to new/changed files, not accesses or removals.
        let is_relevant = matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Modify(_)
        );
        if !is_relevant {
            return;
        }
        if tray::WATCHING_PAUSED.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }

        for path in &event.paths {
            // Skip directories themselves; only register files.
            if path.is_dir() {
                continue;
            }
            let key = format!("{}|{}", folder_id, path.display());
            if let Some(pending) = app.try_state::<WatcherState>() {
                pending
                    .pending
                    .lock()
                    .expect("pending poisoned")
                    .insert(key, (Instant::now(), folder_id.clone(), path.display().to_string()));
            }
        }
    })?;

    watcher.watch(Path::new(&folder_path), RecursiveMode::NonRecursive)?;
    let _ = folder_id; // already moved into closure
    Ok(watcher)
}

/// Ensure the settle-sweep background loop is running. Idempotent — uses a
/// OnceCell-style guard so repeated calls don't stack loops.
static SWEEP_STARTED: std::sync::Once = std::sync::Once::new();

fn ensure_sweep_loop<R: Runtime + 'static>(app: AppHandle<R>) {
    SWEEP_STARTED.call_once(|| {
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(SWEEP_INTERVAL_MS));
            let settled = take_settled(&app);
            for (folder_id, path) in settled {
                handle_settled_file(&app, &folder_id, &path);
            }
        });
    });
}

/// Pull all pending entries that have been quiet for >= SETTLE_MS.
fn take_settled<R: Runtime>(app: &AppHandle<R>) -> Vec<(String, String)> {
    let state = app.state::<WatcherState>();
    let mut pending = state.pending.lock().expect("pending poisoned");
    let now = Instant::now();
    let mut out = Vec::new();
    pending.retain(|_key, (seen, folder_id, path)| {
        if now.duration_since(*seen) >= Duration::from_millis(SETTLE_MS) {
            out.push((folder_id.clone(), path.clone()));
            false // remove settled
        } else {
            true // keep waiting
        }
    });
    out
}

/// A file has settled: validate it, then route by the folder's action mode.
fn handle_settled_file<R: Runtime>(app: &AppHandle<R>, folder_id: &str, path: &str) {
    // Look up the folder config to apply filters + action.
    let settings = load_settings();
    let folder = match settings.watch_folders.iter().find(|f| f.id == folder_id) {
        Some(f) => f.clone(),
        None => return,
    };

    // File must still exist (settle may have caught a temp that was removed).
    let p = Path::new(path);
    if !p.exists() || !p.is_file() {
        return;
    }

    // Extension filter (empty list = accept all).
    if !folder.extensions.is_empty() {
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        if !folder.extensions.iter().any(|e| e.eq_ignore_ascii_case(&ext)) {
            return;
        }
    }

    match folder.action {
        WatchAction::AutoConvert => {
            // Spawn so the blocking conversion runs off the sweep thread and
            // multiple folders convert concurrently. A per-folder mutex
            // serializes conversions within a folder to avoid ffmpeg storms.
            let app2 = app.clone();
            let folder2 = folder.clone();
            let path2 = path.to_string();
            std::thread::spawn(move || {
                run_auto_convert(app2, folder2, path2);
            });
        }
        WatchAction::Queue => {
            enqueue_file(app, &folder, path);
        }
    }
}

/// Run a single auto-conversion for a detected file. Serialized per folder
/// by a shared mutex so one folder never runs two ffmpeg processes at once.
fn run_auto_convert<R: Runtime>(app: AppHandle<R>, folder: WatchFolderConfig, path: String) {
    let job_id = format!("watch:{}", folder.id);

    // Per-folder serialization lock.
    let lock = folder_lock(&folder.id);
    let _guard = lock.lock().expect("folder lock poisoned");

    // Build params from the preset: clone it, overwrite input + output.
    let mut params = folder.params.clone();
    params.input_path = std::path::PathBuf::from(&path);
    params.output_dir = std::path::PathBuf::from(&folder.output_dir);

    let _ = app.emit(
        "watch://convert-started",
        serde_json::json!({ "folderId": folder.id, "path": path, "jobId": job_id }),
    );

    match crate::commands::run_single_conversion(&app, params, &job_id) {
        Ok(done) => {
            let _ = app.emit(
                "watch://convert-done",
                serde_json::json!({
                    "folderId": folder.id,
                    "path": path,
                    "outputPath": done.output_path,
                }),
            );
            // Optional: remove the source after a successful conversion.
            if folder.delete_source {
                let _ = std::fs::remove_file(&path);
            }
            // Rebuild a concise tray status reflecting active folders.
            crate::tray::set_tooltip_status(&app, Some("converted"));
        }
        Err(e) => {
            let _ = app.emit(
                "watch://convert-error",
                serde_json::json!({ "folderId": folder.id, "path": path, "error": e }),
            );
        }
    }
}

/// A shared, lazily-created mutex per folder id. Keeps concurrent
/// conversions for the same folder from overlapping.
static FOLDER_LOCKS: once_cell::sync::Lazy<std::sync::Mutex<HashMap<String, std::sync::Arc<std::sync::Mutex<()>>>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

fn folder_lock(folder_id: &str) -> std::sync::Arc<std::sync::Mutex<()>> {
    let mut map = FOLDER_LOCKS.lock().expect("folder locks poisoned");
    map.entry(folder_id.to_string())
        .or_insert_with(|| std::sync::Arc::new(std::sync::Mutex::new(())))
        .clone()
}

/// Add a file to the manual-review queue and notify the UI.
fn enqueue_file<R: Runtime>(app: &AppHandle<R>, folder: &WatchFolderConfig, path: &str) {
    let name = Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    let entry = QueuedFile {
        id: Uuid::new_v4().to_string(),
        folder_id: folder.id.clone(),
        folder_path: folder.path.clone(),
        path: path.to_string(),
        name,
        queued_at: Utc::now().to_rfc3339(),
    };
    let _ = app.emit("watch://file-queued", entry.clone());
    let state = app.state::<WatcherState>();
    state.queue.lock().expect("queue poisoned").push_back(entry);
}
