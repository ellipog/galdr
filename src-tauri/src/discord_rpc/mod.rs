use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::SystemTime;

use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use discord_rich_presence::activity::{Activity, Assets, Timestamps};

static CLIENT: once_cell::sync::OnceCell<Mutex<Option<DiscordIpcClient>>> = once_cell::sync::OnceCell::new();
static ENABLED: AtomicBool = AtomicBool::new(true);
static SESSION_CONVERSIONS: AtomicUsize = AtomicUsize::new(0);

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
    if !enabled {
        disconnect();
    }
}

pub fn track_conversion() {
    SESSION_CONVERSIONS.fetch_add(1, Ordering::SeqCst);
}

fn session_count() -> usize {
    SESSION_CONVERSIONS.load(Ordering::SeqCst)
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

fn logo_assets(label: &str) -> Assets<'_> {
    Assets::new().large_image("logo").large_text(label)
}

pub fn set_idle() {
    let count = session_count();
    let details = if count > 0 {
        format!("Session: {} file{} converted", count, if count == 1 { "" } else { "s" })
    } else {
        "Idle".to_string()
    };
    set_activity(
        Activity::new()
            .state("Waiting for a transformation…")
            .details(&details)
            .assets(logo_assets("Galdr")),
    );
}

pub fn set_converting(filename: &str, progress: f64, output_format: &str, source_format: Option<&str>) {
    let short_name = truncate(filename, 40);
    let pct = (progress * 100.0).round() as i32;
    let fmt = match source_format {
        Some(src) => format!("{} → {}", src.to_uppercase(), output_format.to_uppercase()),
        None => output_format.to_uppercase(),
    };
    set_activity(
        Activity::new()
            .state(format!("{}% — {}", pct, fmt))
            .details(format!("Converting {}", short_name))
            .assets(logo_assets("Converting…"))
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
            .assets(logo_assets("Batch converting…"))
            .timestamps(Timestamps::new().start(now_secs())),
    );
}

pub fn set_browsing(page: &str) {
    let label = match page {
        "home" => "Idle",
        "convert" => "Single convert",
        "batch" => "Batch convert",
        "compress" => "Compress",
        "forge" => "Video Editor",
        "settings" => "Settings",
        "runes" => "Presets",
        "subtitles" => "Subtitles",
        _ => page,
    };
    let details = format!("Browsing {}", label);
    set_activity(
        Activity::new()
            .state("")
            .details(&details)
            .assets(logo_assets(label))
            .timestamps(Timestamps::new().start(now_secs())),
    );
}

pub fn set_transcribing(filename: &str, progress: f64, model: &str, language: &str) {
    let short_name = truncate(filename, 40);
    let pct = (progress * 100.0).round() as i32;
    let lang_label = if language.is_empty() || language == "auto" {
        "auto-detect".to_string()
    } else {
        language.to_string()
    };
    set_activity(
        Activity::new()
            .state(format!("{}% — {} · {}", pct, model, lang_label))
            .details(format!("Transcribing {}", short_name))
            .assets(logo_assets("Transcribing…"))
            .timestamps(Timestamps::new().start(now_secs())),
    );
}

pub fn set_forge_editing(clips: usize, duration_secs: f64) {
    let dur_str = if duration_secs >= 60.0 {
        let m = (duration_secs / 60.0).floor() as u64;
        let s = (duration_secs % 60.0).round() as u64;
        format!("{}m {}s", m, s)
    } else {
        format!("{:.1}s", duration_secs)
    };
    set_activity(
        Activity::new()
            .state(format!("Editing timeline — {} clips", clips))
            .details(format!("{} total", dur_str))
            .assets(logo_assets("Video Editor"))
            .timestamps(Timestamps::new().start(now_secs())),
    );
}

pub fn set_forge_exporting(total_clips: usize, current_clip: usize, progress: f64) {
    let pct = (progress * 100.0).round() as i32;
    set_activity(
        Activity::new()
            .state(format!("Exporting clip {}/{} — {}%", current_clip, total_clips, pct))
            .details("Rendering timeline to video")
            .assets(logo_assets("Exporting timeline…"))
            .timestamps(Timestamps::new().start(now_secs())),
    );
}

pub fn set_forge_prerendering(total_clips: usize, current_clip: usize, progress: f64) {
    let pct = (progress * 100.0).round() as i32;
    set_activity(
        Activity::new()
            .state(format!("Rendering preview — clip {}/{} — {}%", current_clip, total_clips, pct))
            .details("Pre-rendering timeline")
            .assets(logo_assets("Rendering preview…"))
            .timestamps(Timestamps::new().start(now_secs())),
    );
}