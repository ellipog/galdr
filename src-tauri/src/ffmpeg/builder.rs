use crate::models::ConversionParams;

pub fn build_args(params: &ConversionParams) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    args.push("-y".to_string());

    if let Some(start) = params.trim_start {
        if start > 0.0 {
            args.push("-ss".to_string());
            args.push(start.to_string());
        }
    }

    args.push("-i".to_string());
    args.push(params.input_path.to_string_lossy().to_string());

    if let Some(codec) = &params.video_codec {
        args.push("-c:v".to_string());
        args.push(codec.clone());
    }

    if let Some(codec) = &params.audio_codec {
        args.push("-c:a".to_string());
        args.push(codec.clone());
    }

    if let Some(crf) = params.crf {
        args.push("-crf".to_string());
        args.push(crf.to_string());
    }

    if let Some(preset) = &params.preset {
        args.push("-preset".to_string());
        args.push(preset.clone());
    }

    if let Some(bitrate) = &params.video_bitrate {
        args.push("-b:v".to_string());
        args.push(bitrate.clone());
    }

    if let Some(bitrate) = &params.audio_bitrate {
        args.push("-b:a".to_string());
        args.push(bitrate.clone());
    }

    if let Some(end) = params.trim_end {
        if end > 0.0 {
            args.push("-to".to_string());
            args.push(end.to_string());
        }
    }

    // Build filter graph from parts (resolution, GIF pipeline, etc.)
    let mut filter_parts: Vec<String> = Vec::new();

    if let Some((w, h)) = params.resolution {
        filter_parts.push(format!("scale={}:{}:flags=lanczos", w, h));
    }

    if let Some(fps) = params.framerate {
        filter_parts.push(format!("fps={}", fps));
    }

    // Crop (either from ratio preset or manual dimensions)
    if let Some(ratio) = &params.crop_ratio {
        let r = match ratio.as_str() {
            "16:9" => "16/9",
            "4:3" => "4/3",
            "1:1" => "1/1",
            "9:16" => "9/16",
            _ => "16/9",
        };
        filter_parts.push(format!(
            "crop='min(iw\\,ih*{r})':'min(ih\\,iw/{r})':'(iw-min(iw\\,ih*{r}))/2':'(ih-min(ih\\,iw/{r}))/2'",
            r = r
        ));
    } else if params.crop_w.is_some() || params.crop_h.is_some() {
        let cw = params.crop_w.unwrap_or(0);
        let ch = params.crop_h.unwrap_or(0);
        let cx = params.crop_x.unwrap_or(0);
        let cy = params.crop_y.unwrap_or(0);
        let cw_even = if cw > 0 { cw - (cw % 2) } else { 0 };
        let ch_even = if ch > 0 { ch - (ch % 2) } else { 0 };
        if cw_even > 0 && ch_even > 0 {
            filter_parts.push(format!("crop={}:{}:{}:{}", cw_even, ch_even, cx, cy));
        }
    }

    // Rotate (transpose)
    if let Some(angle) = params.rotate {
        match angle {
            90 => filter_parts.push("transpose=1".to_string()),
            180 => filter_parts.push("transpose=1,transpose=1".to_string()),
            270 => filter_parts.push("transpose=2".to_string()),
            _ => {}
        }
    }

    // Flip (horizontal/vertical)
    if let Some(flip) = &params.flip {
        match flip.as_str() {
            "h" => filter_parts.push("hflip".to_string()),
            "v" => filter_parts.push("vflip".to_string()),
            _ => {}
        }
    }

    // Video speed (setpts)
    if let Some(spd) = params.speed_video {
        if (spd - 1.0).abs() > f64::EPSILON && spd > 0.0 {
            filter_parts.push(format!("setpts={}*PTS", 1.0 / spd));
        }
    }

    // Quality-driven resolution downscaling for extra compression
    if let Some(quality) = params.quality {
        if quality < 0.25 && params.resolution.is_none() {
            let scale = if quality < 0.05 {
                0.35
            } else if quality < 0.10 {
                0.50
            } else if quality < 0.15 {
                0.60
            } else if quality < 0.20 {
                0.75
            } else {
                0.85
            };
            filter_parts.push(format!(
                "scale='trunc(iw*{}/2)*2':'trunc(ih*{}/2)*2':flags=lanczos",
                scale, scale
            ));
        }
    }

    // Format-specific quality settings
    if let Some(quality) = params.quality {
        match params.output_format.to_lowercase().as_str() {
            // ── Video formats ──
            "mp4" | "m4v" | "mov" | "avi" | "flv" | "ogv" | "wmv" | "ts" | "3gp" => {
                if params.video_codec.is_none() && params.crf.is_none() && params.video_bitrate.is_none() {
                    let crf = (51.0 - quality * 50.0).clamp(0.0, 51.0).round() as u8;
                    args.push("-crf".to_string());
                    args.push(crf.to_string());
                }
                if params.audio_codec.is_none() && params.audio_bitrate.is_none() {
                    args.push("-b:a".to_string());
                    args.push(audio_bitrate(quality));
                    maybe_mono(&mut args, quality);
                }
            }
            "mkv" | "webm" => {
                if params.video_codec.is_none() && params.crf.is_none() && params.video_bitrate.is_none() {
                    let crf = (63.0 - quality * 63.0).clamp(0.0, 63.0).round() as u8;
                    args.push("-crf".to_string());
                    args.push(crf.to_string());
                }
                if params.audio_codec.is_none() && params.audio_bitrate.is_none() {
                    args.push("-b:a".to_string());
                    args.push(audio_bitrate(quality));
                    maybe_mono(&mut args, quality);
                }
            }

            // ── GIF ──
            "gif" => {
                let max_colors = (4.0 + quality * 252.0).clamp(4.0, 256.0).round() as u32;
                let fps = (2.0 + quality * 28.0).clamp(2.0, 30.0).round() as u32;
                let bayer_scale = ((1.0 - quality) * 5.0).clamp(0.0, 5.0).round() as u32;
                let has_filter = !filter_parts.is_empty();
                let prefix = if has_filter {
                    format!("{},", filter_parts.join(","))
                } else {
                    String::new()
                };
                let vf = format!(
                    "{}fps={},split[s0][s1];[s0]palettegen=max_colors={}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale={}",
                    prefix, fps, max_colors, bayer_scale
                );
                filter_parts.clear();
                args.push("-vf".to_string());
                args.push(vf);
            }

            // ── Image formats ──
            "jpg" | "jpeg" => {
                let qv = (1.0 + (1.0 - quality) * 30.0).clamp(1.0, 31.0).round() as u8;
                if params.video_codec.is_none() {
                    args.push("-c:v".to_string());
                    args.push("mjpeg".to_string());
                }
                args.push("-q:v".to_string());
                args.push(qv.to_string());
            }
            "webp" => {
                let q = (quality * 100.0).clamp(0.0, 100.0).round() as u8;
                if params.video_codec.is_none() {
                    args.push("-c:v".to_string());
                    args.push("libwebp".to_string());
                }
                args.push("-quality".to_string());
                args.push(q.to_string());
            }
            "avif" => {
                let q = (quality * 100.0).clamp(0.0, 100.0).round() as u8;
                args.push("-quality".to_string());
                args.push(q.to_string());
            }
            "png" => {
                let level = (1.0 + quality * 8.0).clamp(1.0, 9.0).round() as u8;
                if params.video_codec.is_none() {
                    args.push("-c:v".to_string());
                    args.push("png".to_string());
                }
                args.push("-compression_level".to_string());
                args.push(level.to_string());
            }
            "bmp" => {
                if params.video_codec.is_none() {
                    args.push("-c:v".to_string());
                    args.push("bmp".to_string());
                }
            }
            "tiff" => {
                let comp = match quality {
                    q if q >= 0.7 => "lzw",
                    q if q >= 0.4 => "deflate",
                    _ => "raw",
                };
                if params.video_codec.is_none() {
                    args.push("-c:v".to_string());
                    args.push("tiff".to_string());
                }
                args.push("-compression_algo".to_string());
                args.push(comp.to_string());
            }

            // ── Audio formats ──
            "mp3" => {
                if params.audio_codec.is_none() {
                    args.push("-c:a".to_string());
                    args.push("libmp3lame".to_string());
                }
                if params.audio_bitrate.is_none() {
                    args.push("-b:a".to_string());
                    args.push(audio_bitrate(quality));
                    maybe_mono(&mut args, quality);
                }
                args.push("-vn".to_string());
            }
            "aac" | "m4a" => {
                if params.audio_codec.is_none() {
                    args.push("-c:a".to_string());
                    args.push("aac".to_string());
                }
                if params.audio_bitrate.is_none() {
                    args.push("-b:a".to_string());
                    args.push(audio_bitrate(quality));
                    maybe_mono(&mut args, quality);
                }
                args.push("-vn".to_string());
            }
            "ogg" | "opus" => {
                if params.audio_codec.is_none() {
                    args.push("-c:a".to_string());
                    args.push(if params.output_format == "opus" { "libopus".to_string() } else { "libvorbis".to_string() });
                }
                if params.audio_bitrate.is_none() {
                    args.push("-b:a".to_string());
                    args.push(audio_bitrate(quality));
                    maybe_mono(&mut args, quality);
                }
                args.push("-vn".to_string());
            }
            "wav" | "aiff" => {
                if params.audio_bitrate.is_none() {
                    args.push("-b:a".to_string());
                    args.push("1411k".to_string());
                    maybe_mono(&mut args, quality);
                }
                args.push("-vn".to_string());
            }
            "flac" => {
                if params.audio_codec.is_none() {
                    args.push("-c:a".to_string());
                    args.push("flac".to_string());
                }
                let level = (0.0 + quality * 8.0).clamp(0.0, 8.0).round() as u8;
                args.push("-compression_level".to_string());
                args.push(level.to_string());
                args.push("-vn".to_string());
            }
            "wma" => {
                if params.audio_bitrate.is_none() {
                    args.push("-b:a".to_string());
                    args.push(audio_bitrate(quality));
                    maybe_mono(&mut args, quality);
                }
                args.push("-vn".to_string());
            }
            "ac3" => {
                if params.audio_codec.is_none() {
                    args.push("-c:a".to_string());
                    args.push("ac3".to_string());
                }
                if params.audio_bitrate.is_none() {
                    args.push("-b:a".to_string());
                    args.push(audio_bitrate(quality));
                    maybe_mono(&mut args, quality);
                }
                args.push("-vn".to_string());
            }

            _ => {}
        }
    }

    // Apply pixel format for compatible video output (not for GIF or audio-only)
    let is_audio_fmt = matches!(
        params.output_format.to_lowercase().as_str(),
        "mp3" | "aac" | "m4a" | "ogg" | "opus" | "wav" | "aiff" | "flac" | "wma" | "ac3"
    );
    let is_gif = params.output_format.to_lowercase() == "gif";
    if !is_audio_fmt && !is_gif && params.video_codec.as_deref().unwrap_or("") != "png" {
        if params.video_codec.is_none() || params.video_codec.as_deref().unwrap_or("") == "libx264" {
            args.push("-pix_fmt".to_string());
            args.push("yuv420p".to_string());
        }
    }

    // ── Subtitle burn-in ──
    // When subtitle_mode == "burn" and a subtitle file is set, append a
    // `subtitles=` filter to the chain. This MUST run after every geometric
    // filter (scale/crop/rotate) so the subtitles render onto the final
    // frame. SRT/VTT inputs are converted to ASS in a temp file so we can
    // inject styling via `force_style`; native ASS files are used as-is.
    if params.subtitle_mode.as_deref() == Some("burn") {
        if let Some(sub_path) = &params.subtitle_path {
            match build_subtitle_filter(sub_path, params.subtitle_style.as_ref()) {
                Ok(filter) => filter_parts.push(filter),
                Err(e) => {
                    // Surface as a fatal arg error — FFmpeg will fail loudly
                    // rather than silently producing a video with no subs.
                    args.push("-vf".to_string());
                    args.push(format!("__subtitle_error={}__", e));
                }
            }
        }
    }

    // Remaining filter parts (if not already consumed by GIF)
    if !filter_parts.is_empty() {
        args.push("-vf".to_string());
        args.push(filter_parts.join(","));
    }

    // Audio filter chain: speed (atempo) + normalization + fades.
    // All audio filters are joined into a single -af argument.
    let mut af_parts: Vec<String> = Vec::new();

    // Audio speed (atempo chaining for values outside 0.5–2.0 range)
    if let Some(spd) = params.speed_audio {
        if (spd - 1.0).abs() > f64::EPSILON && spd > 0.0 {
            let mut remaining = spd;
            while remaining < 0.5 {
                af_parts.push("atempo=0.5".to_string());
                remaining /= 0.5;
            }
            while remaining > 2.0 {
                af_parts.push("atempo=2.0".to_string());
                remaining /= 2.0;
            }
            if (remaining - 1.0).abs() > f64::EPSILON {
                af_parts.push(format!("atempo={}", remaining));
            }
        }
    }

    // Audio normalization (EBU R128 loudnorm or peak dynaudnorm)
    if let Some(norm) = &params.audio_normalize {
        match norm.as_str() {
            "loudnorm" => af_parts.push(
                "loudnorm=I=-16:TP=-1.5:LRA=11".to_string(),
            ),
            "dynaudnorm" => af_parts.push("dynaudnorm".to_string()),
            _ => {}
        }
    }

    // Audio fades. Fade-in starts at t=0; fade-out starts at
    // (effective duration - fade_out). Effective duration accounts for
    // trim and speed so the out-fade lands at the real end of the audio.
    let src_duration = crate::ffmpeg::probe_duration(&params.input_path);
    let trim_end = params.trim_end.filter(|&e| e > 0.0).unwrap_or(src_duration);
    let trim_start = params.trim_start.unwrap_or(0.0);
    let span = (trim_end - trim_start).max(0.0);
    let audio_speed = params.speed_audio.unwrap_or(1.0).max(0.01);
    let eff_duration = if (audio_speed - 1.0).abs() > f64::EPSILON {
        span / audio_speed
    } else {
        span
    };

    if let Some(d) = params.fade_in {
        if d > 0.0 {
            af_parts.push(format!("afade=t=in:st=0:d={}", d));
        }
    }
    if let Some(d) = params.fade_out {
        if d > 0.0 && eff_duration > d {
            let start = eff_duration - d;
            af_parts.push(format!("afade=t=out:st={}:d={}", start, d));
        }
    }

    if !af_parts.is_empty() {
        args.push("-af".to_string());
        args.push(af_parts.join(","));
    }

    // Sample rate and channels
    if let Some(rate) = params.sample_rate {
        args.push("-ar".to_string());
        args.push(rate.to_string());
    }

    if let Some(ch) = params.channels {
        args.push("-ac".to_string());
        args.push(ch.to_string());
    }

    let input_stem = params.input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");

    let output_path = params.output_dir.join(format!(
        "{}.{}",
        input_stem,
        params.output_format
    ));

    args.push(output_path.to_string_lossy().to_string());

    args
}

fn audio_bitrate(quality: f64) -> String {
    match quality {
        q if q >= 0.95 => "320k",
        q if q >= 0.85 => "256k",
        q if q >= 0.70 => "192k",
        q if q >= 0.50 => "128k",
        q if q >= 0.30 => "96k",
        q if q >= 0.15 => "64k",
        q if q >= 0.05 => "32k",
        q if q >= 0.02 => "16k",
        _ => "8k",
    }
    .to_string()
}

fn maybe_mono(args: &mut Vec<String>, quality: f64) {
    if quality < 0.15 {
        args.push("-ac".to_string());
        args.push("1".to_string());
    }
}

// ── Subtitle burn-in helpers ──

/// Escape a filesystem path for FFmpeg's `subtitles=` filter.
///
/// The filtergraph parser treats `:`, `,`, `[`, `]`, `;`, `\`, and `'` as
/// special. The robust, widely-used recipe on Windows is:
///   1. flip backslashes to forward slashes (FFmpeg accepts both)
///   2. backslash-escape the colon that follows a drive letter (`C:` → `C\:`)
///   3. wrap the whole thing in single quotes so spaces and commas survive
/// Single quotes inside the path are escaped shell-style as `'\''`.
pub(crate) fn escape_subtitle_path(path: &str) -> String {
    let forward = path.replace('\\', "/");
    // Escape only the drive-letter colon ("C:") — other colons are rare in
    // real paths but would be caught by the same rule harmlessly.
    let escaped_colon = regex::Regex::new(r"^([a-zA-Z]):").unwrap();
    let drive_fixed = escaped_colon.replace_all(&forward, "$1\\:").to_string();
    // Quote and escape any embedded single quotes.
    let quoted = drive_fixed.replace('\'', "'\\''");
    format!("'{}'", quoted)
}

/// Build the `subtitles=...:force_style='...'` filter string for burn-in.
///
/// SRT and VTT inputs are converted to ASS first (into the OS temp dir) so
/// that `force_style` can override formatting — libass only honours
/// `force_style` on ASS sources. Native `.ass` files are passed through
/// directly. Returns the full filter clause ready to append to a `-vf` chain.
pub(crate) fn build_subtitle_filter(
    sub_path: &std::path::Path,
    style: Option<&crate::models::SubtitleStyle>,
) -> Result<String, String> {
    let ext = sub_path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    // ASS is the only format that accepts force_style directly; for SRT/VTT
    // we pre-convert to ASS with `ffmpeg -i sub.srt -f ass sub.ass`.
    let effective_path: std::path::PathBuf = if ext == "ass" {
        sub_path.to_path_buf()
    } else {
        let temp = std::env::temp_dir().join("galdr-subs");
        std::fs::create_dir_all(&temp)
            .map_err(|e| format!("create temp dir: {}", e))?;
        let stem = sub_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("subs");
        let ass_path = temp.join(format!("{}.ass", stem));

        let ffmpeg = crate::ffmpeg::ffmpeg_path();
        let mut cmd = std::process::Command::new(ffmpeg);
        cmd.args(["-y", "-i"])
            .arg(sub_path)
            .arg("-f")
            .arg("ass");
        // Discard any embedded styling so our force_style is authoritative.
        cmd.arg(&ass_path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        cmd.status()
            .map_err(|e| format!("run ffmpeg for subtitle conversion: {}", e))?;
        if !ass_path.exists() {
            return Err("subtitle conversion to ASS produced no file".to_string());
        }
        ass_path
    };

    let escaped = escape_subtitle_path(&effective_path.to_string_lossy());
    let mut filter = format!("subtitles={}", escaped);

    // force_style only has effect on ASS sources, so always emit it for the
    // converted path. Wrap the style value in single quotes so commas inside
    // it (Fontname=Foo,Bar) don't split into separate filter options.
    if let Some(style) = style {
        let style_str = style.to_force_style();
        if !style_str.is_empty() {
            filter.push_str(&format!(":force_style='{}'", style_str));
        }
    }

    Ok(filter)
}

// ── Target-size / two-pass encoding helpers ──

/// Parse a bitrate string like "128k" or "1M" into bits-per-second.
fn parse_bitrate(s: &str) -> u64 {
    let s = s.trim().to_lowercase();
    if let Some(num) = s.strip_suffix("k") {
        (num.parse::<f64>().unwrap_or(128.0) * 1000.0) as u64
    } else if let Some(num) = s.strip_suffix("m") {
        (num.parse::<f64>().unwrap_or(1.0) * 1_000_000.0) as u64
    } else {
        s.parse::<u64>().unwrap_or(128_000)
    }
}

/// Format a bitrate in bps to ffmpeg's "k" suffix string (e.g. 128000 → "128k").
fn format_bitrate(bps: u64) -> String {
    let kbps = (bps as f64 / 1000.0).round().max(1.0) as u64;
    format!("{}k", kbps)
}

/// Return a sensible default video codec for the given output format,
/// used during two-pass encoding where pass 1 needs an explicit codec.
fn default_video_codec(format: &str) -> Option<String> {
    match format {
        "mp4" | "m4v" | "mov" | "3gp" | "avi" | "flv" | "ts" => Some("libx264".to_string()),
        "mkv" => Some("libx265".to_string()),
        "webm" => Some("libvpx-vp9".to_string()),
        "ogv" => Some("libtheora".to_string()),
        "wmv" => Some("wmv2".to_string()),
        _ => None,
    }
}

/// Build first-pass and second-pass argument vectors for two-pass encoding
/// targeting a specific output file size.
///
/// * `duration` — the **effective** duration of the output (accounting for trim),
///   in seconds. The caller is responsible for computing this.
///
/// Returns `(pass1_args, pass2_args)`.
///
/// * **Video**: proper two-pass with `-b:v` / `-b:a` derived from the target size.
/// * **Audio-only / GIF**: single pass with precise audio bitrate (`-b:a`).
/// * **Image formats**: falls back to quality-mode `build_args()` (no size targeting).
pub fn build_two_pass_args(
    params: &ConversionParams,
    duration: f64,
) -> Result<(Vec<String>, Vec<String>), String> {
    let target_bytes = params
        .target_size_bytes
        .ok_or_else(|| "target_size_bytes is required".to_string())?;

    if target_bytes == 0 {
        return Err("target_size_bytes must be greater than 0".to_string());
    }
    if duration <= 0.0 {
        return Err("Cannot calculate bitrate for target size: unknown duration".to_string());
    }

    let fmt = params.output_format.to_lowercase();

    // ── Classify output type ──
    let is_audio = matches!(
        fmt.as_str(),
        "mp3" | "aac" | "m4a" | "ogg" | "opus" | "wav" | "aiff" | "flac" | "wma" | "ac3"
    );
    let is_image = matches!(fmt.as_str(), "jpg" | "jpeg" | "png" | "webp" | "avif" | "bmp" | "tiff");

    // ── Calculate target bitrate ──
    let total_bits = (target_bytes as f64) * 8.0;
    // 95 % headroom for container / muxing overhead
    let target_bitrate_bps = (total_bits / duration) * 0.95;

    // Audio bitrate: user-explicit → quality-derived → fallback 128 kbps
    let audio_bps: u64 = if let Some(ref ab) = params.audio_bitrate {
        parse_bitrate(ab)
    } else {
        params
            .quality
            .map(|q| parse_bitrate(&audio_bitrate(q)))
            .unwrap_or(128_000)
    };

    // ── Images: not suitable for size targeting → quality fallback ──
    if is_image {
        return Ok((vec![], build_args(params)));
    }

    // ── Audio-only / GIF: single pass ──
    if is_audio || fmt == "gif" {
        // Target audio bitrate clamped to sensible range
        let audio_target = (target_bitrate_bps.max(16_000.0)) as u64;
        let mut single_params = params.clone();
        single_params.audio_bitrate = Some(format_bitrate(audio_target));
        return Ok((vec![], build_args(&single_params)));
    }

    // ── Video: two-pass encoding ──
    let video_bps = if (audio_bps as f64) >= target_bitrate_bps {
        // Audio alone meets or exceeds the target – still encode video at floor
        100_000u64
    } else {
        ((target_bitrate_bps - audio_bps as f64).max(100_000.0)) as u64
    };

    let video_br = format_bitrate(video_bps);
    let audio_br = format_bitrate(audio_bps);

    // Resolve video codec (user explicit → format default)
    let vcodec = params
        .video_codec
        .clone()
        .or_else(|| default_video_codec(&fmt));

    let null_device = if cfg!(windows) {
        "NUL".to_string()
    } else {
        "/dev/null".to_string()
    };

    // ── Pass 1: analysis only, no audio, no output file ──
    let mut pass1: Vec<String> = Vec::new();
    pass1.push("-y".to_string());
    if let Some(start) = params.trim_start {
        if start > 0.0 {
            pass1.push("-ss".to_string());
            pass1.push(start.to_string());
        }
    }
    pass1.push("-i".to_string());
    pass1.push(params.input_path.to_string_lossy().to_string());
    if let Some(ref c) = vcodec {
        pass1.push("-c:v".to_string());
        pass1.push(c.clone());
    }
    pass1.push("-b:v".to_string());
    pass1.push(video_br.clone());
    pass1.push("-pass".to_string());
    pass1.push("1".to_string());
    // Trim end on pass 1 so analysis matches pass 2
    if let Some(end) = params.trim_end {
        if end > 0.0 {
            pass1.push("-to".to_string());
            pass1.push(end.to_string());
        }
    }
    pass1.push("-an".to_string());
    pass1.push("-f".to_string());
    pass1.push("null".to_string());
    pass1.push(null_device);

    // ── Pass 2: encode with bitrate targeting ──
    // Set video_bitrate + audio_bitrate so build_args skips CRF/quality-derived
    // audio bitrate in the format-specific section.
    let mut pass2_params = params.clone();
    pass2_params.video_bitrate = Some(video_br);
    pass2_params.audio_bitrate = Some(audio_br);
    // Ensure the resolved codec is explicit so both passes match
    if let Some(ref c) = vcodec {
        pass2_params.video_codec = Some(c.clone());
    }

    let mut pass2 = build_args(&pass2_params);
    // Insert -pass 2 right after -y
    if pass2.first().map(|s| s.as_str()) == Some("-y") {
        pass2.insert(1, "-pass".to_string());
        pass2.insert(2, "2".to_string());
    }

    Ok((pass1, pass2))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn make_params(output_format: &str, quality: Option<f64>) -> ConversionParams {
        ConversionParams {
            input_path: PathBuf::from("input.mp4"),
            output_dir: PathBuf::from("."),
            output_format: output_format.to_string(),
            quality,
            ..Default::default()
        }
    }

    fn has_flag(args: &[String], flag: &str) -> bool {
        args.windows(2).any(|w| w[0] == flag)
    }

    fn flag_value<'a>(args: &'a [String], flag: &str) -> Option<&'a String> {
        args.windows(2).find(|w| w[0] == flag).map(|w| &w[1])
    }

    #[test]
    fn test_video_crf_from_quality() {
        let args = build_args(&make_params("mp4", Some(0.5)));
        assert!(has_flag(&args, "-crf"), "should set -crf for mp4");
        let crf = flag_value(&args, "-crf").unwrap();
        let val: u8 = crf.parse().unwrap();
        assert_eq!(val, 26, "50% quality should give CRF 26");
    }

    #[test]
    fn test_video_crf_high_quality() {
        let args = build_args(&make_params("mp4", Some(1.0)));
        let crf = flag_value(&args, "-crf").unwrap();
        assert_eq!(crf, "1", "100% quality should give CRF 1");
    }

    #[test]
    fn test_video_crf_low_quality() {
        let args = build_args(&make_params("mp4", Some(0.0)));
        let crf = flag_value(&args, "-crf").unwrap();
        assert_eq!(crf, "51", "0% quality should give CRF 51");
    }

    #[test]
    fn test_jpeg_quality() {
        let args = build_args(&make_params("jpg", Some(0.5)));
        assert!(has_flag(&args, "-q:v"), "should set -q:v for jpg");
        assert!(has_flag(&args, "-c:v"), "should set -c:v for jpg");
    }

    #[test]
    fn test_webp_quality() {
        let args = build_args(&make_params("webp", Some(0.8)));
        assert!(has_flag(&args, "-quality"), "should set -quality for webp");
        let q = flag_value(&args, "-quality").unwrap();
        assert_eq!(q, "80");
    }

    #[test]
    fn test_png_compression() {
        let args = build_args(&make_params("png", Some(0.5)));
        assert!(has_flag(&args, "-compression_level"), "should set -compression_level for png");
    }

    #[test]
    fn test_audio_bitrate_high() {
        let args = build_args(&make_params("mp3", Some(1.0)));
        let br = flag_value(&args, "-b:a").unwrap();
        assert_eq!(br, "320k");
    }

    #[test]
    fn test_audio_bitrate_low() {
        let args = build_args(&make_params("mp3", Some(0.0)));
        let br = flag_value(&args, "-b:a").unwrap();
        assert_eq!(br, "8k");
    }

    #[test]
    fn test_gif_palette() {
        let args = build_args(&make_params("gif", Some(0.5)));
        assert!(has_flag(&args, "-vf"), "should set -vf for gif");
        let vf = flag_value(&args, "-vf").unwrap();
        assert!(vf.contains("palettegen"), "gif filter should include palettegen");
        assert!(vf.contains("paletteuse"), "gif filter should include paletteuse");
    }

    #[test]
    fn test_mkv_crf_range() {
        let args = build_args(&make_params("mkv", Some(0.5)));
        let crf = flag_value(&args, "-crf").unwrap();
        let val: u8 = crf.parse().unwrap();
        assert!(val <= 63, "mkv/webm CRF should be in range 0-63");
    }

    #[test]
    fn test_pix_fmt_set_for_video() {
        let args = build_args(&make_params("mp4", Some(0.5)));
        assert!(has_flag(&args, "-pix_fmt"), "should set -pix_fmt for mp4 video");
    }

    #[test]
    fn test_pix_fmt_not_for_audio() {
        let args = build_args(&make_params("mp3", Some(0.5)));
        assert!(!has_flag(&args, "-pix_fmt"), "should NOT set -pix_fmt for audio-only");
    }

    #[test]
    fn test_vn_flag_for_audio() {
        let args = build_args(&make_params("flac", Some(0.5)));
        assert!(args.contains(&"-vn".to_string()), "audio formats should have -vn");
    }

    #[test]
    fn test_flac_compression() {
        let args = build_args(&make_params("flac", Some(0.5)));
        let level = flag_value(&args, "-compression_level").unwrap();
        assert_eq!(level, "4");
    }

    #[test]
    fn test_explicit_crf_overrides_quality() {
        let params = ConversionParams {
            input_path: PathBuf::from("input.mp4"),
            output_dir: PathBuf::from("."),
            output_format: "mp4".to_string(),
            quality: Some(0.5),
            crf: Some(18),
            ..Default::default()
        };
        let args = build_args(&params);
        let crf = flag_value(&args, "-crf").unwrap();
        assert_eq!(crf, "18", "explicit CRF should override quality-derived CRF");
    }

    #[test]
    fn test_audio_bitrate_does_not_override_explicit() {
        let params = ConversionParams {
            input_path: PathBuf::from("input.mp4"),
            output_dir: PathBuf::from("."),
            output_format: "mp3".to_string(),
            quality: Some(0.5),
            audio_bitrate: Some("64k".to_string()),
            ..Default::default()
        };
        let args = build_args(&params);
        let br = flag_value(&args, "-b:a").unwrap();
        assert_eq!(br, "64k", "explicit audio bitrate should override quality-derived");
    }

    #[test]
    fn test_flip_horizontal() {
        let mut params = make_params("mp4", Some(0.5));
        params.flip = Some("h".to_string());
        let args = build_args(&params);
        let vf = flag_value(&args, "-vf").unwrap();
        assert!(vf.contains("hflip"), "horizontal flip should emit hflip");
    }

    #[test]
    fn test_flip_vertical() {
        let mut params = make_params("mp4", Some(0.5));
        params.flip = Some("v".to_string());
        let args = build_args(&params);
        let vf = flag_value(&args, "-vf").unwrap();
        assert!(vf.contains("vflip"), "vertical flip should emit vflip");
    }

    #[test]
    fn test_audio_normalize_loudnorm() {
        let mut params = make_params("mp3", Some(0.5));
        params.audio_normalize = Some("loudnorm".to_string());
        let args = build_args(&params);
        let af = flag_value(&args, "-af").unwrap();
        assert!(af.contains("loudnorm=I=-16"), "loudnorm should be in audio filter chain");
    }

    #[test]
    fn test_audio_normalize_dynaudnorm() {
        let mut params = make_params("mp3", Some(0.5));
        params.audio_normalize = Some("dynaudnorm".to_string());
        let args = build_args(&params);
        let af = flag_value(&args, "-af").unwrap();
        assert!(af.contains("dynaudnorm"), "dynaudnorm should be in audio filter chain");
    }

    #[test]
    fn test_no_audio_filter_when_unset() {
        let params = make_params("mp3", Some(0.5));
        let args = build_args(&params);
        assert!(!has_flag(&args, "-af"), "no -af should be emitted when no audio filters are set");
    }

    #[test]
    fn test_fade_in_audio_filter() {
        let mut params = make_params("mp3", Some(0.5));
        params.fade_in = Some(2.0);
        let args = build_args(&params);
        let af = flag_value(&args, "-af").unwrap();
        assert!(af.contains("afade=t=in:st=0:d=2"), "fade-in should emit afade=t=in:st=0:d=2");
    }

    // ── Subtitle burn-in ──

    #[test]
    fn test_escape_subtitle_path_forward_slash() {
        // Backslashes flip to forward slashes.
        let escaped = escape_subtitle_path("C:\\Users\\me\\sub.srt");
        assert!(escaped.contains("C\\:/Users/me/sub.srt"), "drive colon escaped, slashes forward: {}", escaped);
    }

    #[test]
    fn test_escape_subtitle_path_unix() {
        let escaped = escape_subtitle_path("/home/me/sub.srt");
        assert_eq!(escaped, "'/home/me/sub.srt'");
    }

    #[test]
    fn test_escape_subtitle_path_quoted() {
        // Whole path is wrapped in single quotes.
        let escaped = escape_subtitle_path("sub.srt");
        assert!(escaped.starts_with('\'') && escaped.ends_with('\''));
    }

    #[test]
    fn test_build_subtitle_filter_ass_passthrough() {
        // Native ASS files are passed through without conversion.
        let filter = build_subtitle_filter(
            std::path::Path::new("subs.ass"),
            None,
        )
        .expect("ASS passthrough should succeed");
        assert!(filter.starts_with("subtitles='"), "filter should start with subtitles=: {}", filter);
        assert!(!filter.contains("force_style"), "no style → no force_style");
    }

    #[test]
    fn test_build_subtitle_filter_with_style() {
        let style = crate::models::SubtitleStyle {
            font_size: Some(30),
            primary_color: Some("&H00FFFFFF".to_string()),
            ..Default::default()
        };
        let filter = build_subtitle_filter(std::path::Path::new("subs.ass"), Some(&style))
            .expect("styled ASS should succeed");
        assert!(filter.contains("force_style='"), "style should be present: {}", filter);
        assert!(filter.contains("FontSize=30"), "font size in force_style");
        assert!(filter.contains("PrimaryColour=&H00FFFFFF"), "primary colour in force_style");
    }

    #[test]
    fn test_build_subtitle_filter_missing_srt_errors() {
        // SRT that doesn't exist → conversion fails → Err.
        let res = build_subtitle_filter(std::path::Path::new("definitely_nonexistent_file.srt"), None);
        assert!(res.is_err(), "missing SRT should error, not silently pass through");
    }

    #[test]
    fn test_subtitle_burn_emits_vf_filter() {
        // End-to-end: burn mode + ASS path → -vf contains subtitles=.
        let mut params = make_params("mp4", Some(0.5));
        params.subtitle_mode = Some("burn".to_string());
        params.subtitle_path = Some(PathBuf::from("subs.ass"));
        let args = build_args(&params);
        let vf = flag_value(&args, "-vf").expect("burn mode should emit -vf");
        assert!(vf.contains("subtitles="), "burn mode should add subtitles filter: {}", vf);
    }

    #[test]
    fn test_no_subtitle_filter_without_mode() {
        // No subtitle_mode → no subtitles= in the filter chain.
        let params = make_params("mp4", Some(0.5));
        let args = build_args(&params);
        // -vf may or may not be present, but it must never contain subtitles=.
        if let Some(vf) = flag_value(&args, "-vf") {
            assert!(!vf.contains("subtitles="), "no burn mode → no subtitles filter");
        }
    }
}
