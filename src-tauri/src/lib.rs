mod commands;
mod discord_rpc;
mod ffmpeg;
mod models;
mod tray;
mod watcher;

use models::settings::WindowState;
use once_cell::sync::Lazy;
use std::sync::Mutex;
use tauri::{Emitter, Manager, WindowEvent};

const DISCORD_CLIENT_ID: &str = "1516792047095382087";

/// A `.galdr` path the app was launched with (first-instance double-click
/// on Windows/Linux, where the path arrives as a CLI arg). Consumed by the
/// frontend on startup via `consume_pending_file`.
static PENDING_FILE: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// Extracts a `.galdr` path from a list of args, if any.
fn find_galdr_arg(args: &Vec<String>) -> Option<String> {
    args.iter()
        .find(|a| a.to_lowercase().ends_with(".galdr"))
        .cloned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    commands::rune_tags::seed_defaults();

    tauri::Builder::default()
        // Single-instance plugin must be registered first so the second
        // launch is intercepted before anything else initialises. We forward
        // any `.galdr` arg to the existing window and surface it.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = find_galdr_arg(&args) {
                let _ = app.emit("galdr://open-file", path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            ffmpeg::init_paths(&app.handle());
            discord_rpc::connect(DISCORD_CLIENT_ID);
            // Apply the saved discord-enabled setting BEFORE the first
            // set_idle, so RPC only goes live if the user left it on.
            // (ENABLED defaults to true; without this, a turned-off setting
            // would re-activate on every launch until manually toggled.)
            discord_rpc::set_enabled(commands::load_settings().discord_enabled);
            discord_rpc::set_idle();

            // Capture a .galdr path passed as a CLI arg at launch (first
            // instance on Windows/Linux opens files this way).
            if let Some(path) = find_galdr_arg(&std::env::args().collect()) {
                if let Ok(mut slot) = PENDING_FILE.lock() {
                    *slot = Some(path);
                }
            }

            // Apply saved window state after window is created
            let window = app.get_webview_window("main").unwrap();
            if let Some(state) = commands::load_window_state() {
                let _ = window.set_position(tauri::PhysicalPosition::new(state.x, state.y));
                let _ = window.set_size(tauri::PhysicalSize::new(state.width, state.height));
                if state.maximized {
                    let _ = window.maximize();
                }
            }

            // System tray — enables close-to-tray (window hides instead of
            // exiting) so background work like the watch folder keeps running.
            tray::build_tray(&app.handle())?;

            // Watch-folder daemon: managed state + start watching any
            // folders already configured in settings.
            app.manage(watcher::WatcherState::default());
            watcher::start_watcher(&app.handle());

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            commands::start_conversion,
            commands::get_media_info,
            commands::detect_ffmpeg,
            commands::get_default_output_dir,
            commands::scan_directory,
            commands::start_batch_conversion,
            commands::is_directory,
            commands::cancel_conversion,
            commands::concat_videos,
            commands::extract_audio,
            commands::estimate_compress_size,
            commands::extract_frames,
            commands::read_image_data_url,
            commands::list_rune_tags,
            commands::save_rune_tag,
            commands::delete_rune_tag,
            commands::apply_rune_tag,
            commands::update_discord_presence,
            commands::update_forge_presence,
            commands::set_discord_enabled,
            commands::pre_render_timeline,
            commands::delete_temp_file,
            commands::export_timeline,
            commands::cancel_forge_export,
            commands::save_project_file,
            commands::load_project_file,
            commands::read_file_bytes,
            commands::load_settings,
            commands::save_settings,
            commands::load_window_state,
            commands::save_window_state,
            commands::save_forge_recovery,
            commands::load_forge_recovery,
            commands::clear_forge_recovery,
            commands::consume_pending_file,
            commands::watch_folders,
            commands::save_watch_folder,
            commands::delete_watch_folder,
            commands::set_watching_paused,
            commands::watching_paused,
            commands::queued_files,
            commands::dequeue_file,
            commands::clear_queue,
            commands::convert_queued_file,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Save window state first (so the next launch restores geometry).
                if let Ok(position) = window.outer_position() {
                    if let Ok(size) = window.outer_size() {
                        let maximized = window.is_maximized().unwrap_or(false);
                        let state = WindowState {
                            x: position.x,
                            y: position.y,
                            width: size.width,
                            height: size.height,
                            maximized,
                        };
                        let _ = commands::save_window_state(state);
                    }
                }

                // Close-to-tray: hide the window instead of letting the app
                // exit, so background work (watch folder, conversions) keeps
                // running. The tray icon's menu provides a real Quit.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}