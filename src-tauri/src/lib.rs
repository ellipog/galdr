mod commands;
mod ffmpeg;
mod models;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::start_conversion,
            commands::get_media_info,
            commands::detect_ffmpeg,
            commands::get_default_output_dir,
            commands::scan_directory,
            commands::start_batch_conversion,
            commands::is_directory,
            commands::cancel_conversion,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
