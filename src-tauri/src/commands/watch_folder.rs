//! Commands for managing watch-folder config + the review queue.
//!
//! Config lives in `settings.json` (as part of AppSettings), so adding /
//! editing / deleting a folder is "load settings → mutate → save → restart
//! watcher". The queue is in-memory (transitory) and lives in WatcherState.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Runtime, State};
use uuid::Uuid;

use crate::commands::settings::{load_settings, save_settings};
use crate::models::watch_folder::{QueuedFile, WatchFolderConfig};
use crate::tray;
use crate::watcher::WatcherState;

/// Return the current watch-folder configs.
#[tauri::command]
pub fn watch_folders() -> Vec<WatchFolderConfig> {
    load_settings().watch_folders
}

/// Insert or update a watch folder (matched by id). Assigns a fresh id if
/// the incoming id is empty. Restarts the watcher so the change takes effect.
#[tauri::command]
pub fn save_watch_folder<R: Runtime>(
    app: AppHandle<R>,
    config: WatchFolderConfig,
) -> Result<WatchFolderConfig, String> {
    let mut settings = load_settings();
    let mut config = config;
    if config.id.is_empty() {
        config.id = Uuid::new_v4().to_string();
    }
    let id = config.id.clone();
    if let Some(existing) = settings.watch_folders.iter_mut().find(|f| f.id == id) {
        *existing = config.clone();
    } else {
        settings.watch_folders.push(config.clone());
    }
    save_settings(settings)?;
    crate::watcher::start_watcher(&app);
    Ok(config)
}

/// Remove a watch folder by id. Restarts the watcher.
#[tauri::command]
pub fn delete_watch_folder<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let mut settings = load_settings();
    settings.watch_folders.retain(|f| f.id != id);
    save_settings(settings)?;
    crate::watcher::start_watcher(&app);
    Ok(())
}

/// Pause or resume watching globally (mirrors the tray menu toggle).
#[tauri::command]
pub fn set_watching_paused<R: Runtime>(app: AppHandle<R>, paused: bool) -> bool {
    tray::WATCHING_PAUSED.store(paused, Ordering::SeqCst);
    tray::update_tooltip(&app);
    paused
}

/// Read the global pause flag.
#[tauri::command]
pub fn watching_paused() -> bool {
    tray::WATCHING_PAUSED.load(Ordering::SeqCst)
}

/// Snapshot of the manual-review queue.
#[tauri::command]
pub fn queued_files<R: Runtime>(_app: AppHandle<R>, state: State<'_, WatcherState>) -> Vec<QueuedFile> {
    state.queued_files()
}

/// Remove a single file from the queue by id. Returns true if found.
#[tauri::command]
pub fn dequeue_file<R: Runtime>(_app: AppHandle<R>, state: State<'_, WatcherState>, id: String) -> bool {
    state.remove_queued(&id).is_some()
}

/// Clear the whole queue.
#[tauri::command]
pub fn clear_queue<R: Runtime>(_app: AppHandle<R>, state: State<'_, WatcherState>) {
    let _ = state.take_queue();
}

/// Convert a single queued file now, using its folder's preset. Removes it
/// from the queue regardless of success. Returns the output path or error.
#[tauri::command]
pub fn convert_queued_file<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WatcherState>,
    id: String,
) -> Result<String, String> {
    let entry = state.remove_queued(&id).ok_or_else(|| "File not in queue".to_string())?;

    // Find the originating folder to reuse its preset.
    let folder = load_settings()
        .watch_folders
        .into_iter()
        .find(|f| f.id == entry.folder_id)
        .ok_or_else(|| "Originating watch folder no longer exists".to_string())?;

    let mut params = folder.params.clone();
    params.input_path = std::path::PathBuf::from(&entry.path);
    params.output_dir = std::path::PathBuf::from(&folder.output_dir);

    let job_id = format!("watch:{}", folder.id);
    let done = crate::commands::run_single_conversion(&app, params, &job_id)?;
    Ok(done.output_path)
}
