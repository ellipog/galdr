use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::SystemTime;

use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use discord_rich_presence::activity::{Activity, Assets, Timestamps};

static CLIENT: once_cell::sync::OnceCell<Mutex<Option<DiscordIpcClient>>> = once_cell::sync::OnceCell::new();
static ENABLED: AtomicBool = AtomicBool::new(true);

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
    if !enabled {
        disconnect();
    }
}

fn get_client() -> &'static Mutex<Option<DiscordIpcClient>> {
    CLIENT.get_or_init(|| Mutex::new(None))
}

pub fn connect(client_id: &str) {
    let mut client = DiscordIpcClient::new(client_id);
    if client.connect().is_ok() {
        if let Ok(mut guard) = get_client().lock() {
            *guard = Some(client);
        }
    }
}

pub fn disconnect() {
    if let Ok(mut guard) = get_client().lock() {
        if let Some(mut client) = guard.take() {
            let _ = client.close();
        }
    }
}

fn set_activity(activity: Activity<'_>) {
    if !ENABLED.load(Ordering::SeqCst) {
        return;
    }
    if let Ok(mut guard) = get_client().lock() {
        if let Some(client) = guard.as_mut() {
            let _ = client.set_activity(activity);
        }
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() > max {
        format!("{}…", &s[..max.saturating_sub(1)])
    } else {
        s.to_string()
    }
}

pub fn set_idle() {
    set_activity(
        Activity::new()
            .state("Waiting for a transformation…")
            .details("Idle")
            .assets(Assets::new().large_image("logo").large_text("Galdr")),
    );
}

pub fn set_converting(filename: &str, progress: f64, output_format: &str) {
    let short_name = truncate(filename, 40);
    let pct = (progress * 100.0).round() as i32;
    set_activity(
        Activity::new()
            .state(format!("{}% — {}", pct, output_format))
            .details(format!("Converting {}", short_name))
            .assets(Assets::new().large_image("logo").large_text("Converting…"))
            .timestamps(Timestamps::new().start(now_secs())),
    );
}

pub fn set_batch(current_file: &str, done: usize, total: usize, progress: f64) {
    let short_file = truncate(current_file, 30);
    let pct = (progress * 100.0).round() as i32;
    set_activity(
        Activity::new()
            .state(format!("{} — {}%", short_file, pct))
            .details(format!("Batch: {}/{}", done, total))
            .assets(Assets::new().large_image("logo").large_text("Batch converting…"))
            .timestamps(Timestamps::new().start(now_secs())),
    );
}

pub fn set_browsing(page: &str) {
    let label = match page {
        "home" => "Idle",
        "convert" => "Single convert",
        "batch" => "Batch convert",
        "compress" => "Compress",
        "settings" => "Settings",
        "runes" => "Presets",
        _ => page,
    };
    set_activity(
        Activity::new()
            .state("")
            .details(format!("Browsing {}", label))
            .assets(Assets::new().large_image("logo").large_text("Galdr")),
    );
}