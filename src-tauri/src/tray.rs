//! System tray icon + close-to-tray support.
//!
//! When the window is "closed" it is hidden instead, keeping the process
//! (and the watch-folder daemon) alive. The tray icon's left-click toggles
//! the window visibility; the menu offers Show / Pause-Resume / Quit.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

/// Global pause flag shared between the tray menu and the watcher.
/// When true, the watcher ignores incoming file events.
pub static WATCHING_PAUSED: AtomicBool = AtomicBool::new(false);

/// Menu item IDs.
const ID_SHOW: &str = "show";
const ID_PAUSE: &str = "pause";
const ID_QUIT: &str = "quit";

/// Tooltip shown when the watcher is idle. The watcher module appends a
/// status suffix via [`set_tooltip_status`] as folders/queue/conversions
/// change — see that function.
const TOOLTIP_BASE: &str = "GALDR";

/// Build and register the tray icon. Safe to call once from `setup`.
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, ID_SHOW, "Show", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, ID_PAUSE, "Toggle watching", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &pause, &sep, &quit])?;

    // Reuse the bundled app icon. `include_bytes!` bakes it into the binary
    // so the tray works regardless of install path.
    let icon_bytes = include_bytes!("../icons/icon.ico");
    let icon = Image::from_bytes(icon_bytes)?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip(TOOLTIP_BASE)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            ID_SHOW => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            ID_PAUSE => {
                let now_paused = !WATCHING_PAUSED.load(Ordering::SeqCst);
                WATCHING_PAUSED.store(now_paused, Ordering::SeqCst);
                // Tooltip reflects the toggle state (label stays generic
                // "Toggle watching" — Tauri 2 has no by-id menu-item lookup).
                update_tooltip(app);
            }
            ID_QUIT => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click toggles the window: show if hidden, hide if visible.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Push a status string into the tray tooltip. Called by the watcher as
/// folders/queue/conversions change. Pass `None` to reset to the base label.
pub fn set_tooltip_status<R: Runtime>(app: &AppHandle<R>, status: Option<&str>) {
    let tooltip = match status {
        Some(s) => format!("{} — {}", TOOLTIP_BASE, s),
        None => TOOLTIP_BASE.to_string(),
    };
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

/// Refresh the tooltip from the global pause flag. Public so the watcher
/// can call it after state changes that don't go through the menu.
pub fn update_tooltip<R: Runtime>(app: &AppHandle<R>) {
    if WATCHING_PAUSED.load(Ordering::SeqCst) {
        set_tooltip_status(app, Some("paused"));
    } else {
        set_tooltip_status(app, None);
    }
}
