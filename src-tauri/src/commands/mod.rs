pub mod convert;
pub mod forge;
pub mod info;
pub mod preview;
pub mod reziser;
pub mod rune_tags;
pub mod settings;
pub mod subtitles;
pub mod watch_folder;

pub use convert::*;
pub use forge::*;
pub use info::*;
pub use preview::*;
pub use reziser::*;
pub use rune_tags::*;
pub use settings::*;
pub use subtitles::*;
pub use watch_folder::*;

/// Returns a `.galdr` path the app was launched with (first-instance
/// launch on Windows/Linux), then clears it so it isn't replayed.
#[tauri::command]
pub fn consume_pending_file() -> Option<String> {
    let mut slot = match crate::PENDING_FILE.lock() {
        Ok(g) => g,
        Err(_) => return None,
    };
    slot.take()
}
