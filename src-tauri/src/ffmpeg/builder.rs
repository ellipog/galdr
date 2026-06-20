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
}
