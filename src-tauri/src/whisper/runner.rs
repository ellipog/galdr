use regex::Regex;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;

/// Streaming events emitted while whisper-cli runs. Mirrors `FfmpegEvent`
/// so transcription can be surfaced in the UI exactly like a conversion.
pub enum WhisperEvent {
    /// 0.0 – 1.0 progress through the audio.
    Progress(f64),
    /// A parsed transcript segment: `[start --> end] text`.
    Segment(String),
    /// Any other log line from whisper.cpp stderr.
    Log(String),
    Done(String),
    Error(String),
}

/// Spawn whisper-cli with the given args and stream events until it exits.
///
/// `_duration` is accepted for signature symmetry with `run_conversion` but
/// unused: whisper.cpp emits its own `progress = N%` lines, so we don't need
/// to map an absolute timestamp back to a fraction of total duration.
pub fn run_whisper(args: &[String], _duration: f64) -> Result<Vec<WhisperEvent>, String> {
    let whisper = crate::whisper::whisper_path();
    let mut cmd = Command::new(whisper);
    cmd.args(args)
        .stderr(Stdio::piped())
        .stdout(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn whisper-cli: {}", e))?;

    // whisper.cpp writes segment output to stdout and progress to stderr.
    let stderr = child.stderr.take().unwrap();
    let stdout = child.stdout.take().unwrap();

    let progress_re = Regex::new(r"progress\s*=\s*(\d+)\s*%").unwrap();
    // Segment lines look like: "[00:00:00.000 --> 00:00:03.500]  Hello world"
    let segment_re = Regex::new(r"^\[\d{2}:\d{2}:\d{2}\.\d+\s*-->\s*\d{2}:\d{2}:\d{2}\.\d+\]").unwrap();
    // Detected-language line: `language = "en"` or `language = en`
    let lang_re = Regex::new(r#"language\s*=\s*"?([a-zA-Z]{2})"?"#).unwrap();

    let (tx, rx) = mpsc::channel::<WhisperEvent>();

    // stderr reader: progress + detected language + error scanning.
    let tx_err = tx.clone();
    let progress_re_err = progress_re.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            if line.is_empty() {
                continue;
            }
            if let Some(caps) = progress_re_err.captures(&line) {
                let pct: f64 = caps[1].parse().unwrap_or(0.0);
                let _ = tx_err.send(WhisperEvent::Progress(pct / 100.0));
            }
            if let Some(caps) = lang_re.captures(&line) {
                let _ = tx_err.send(WhisperEvent::Log(format!("detected: {}", &caps[1])));
            }
            if line.to_lowercase().contains("error") {
                let _ = tx_err.send(WhisperEvent::Error(line.clone()));
            }
            // Most stderr lines are useful context; surface them as logs.
            if !progress_re_err.is_match(&line) && !lang_re.is_match(&line) {
                let _ = tx_err.send(WhisperEvent::Log(line));
            }
        }
    });

    // stdout reader: segment lines become transcript output.
    let tx_out = tx.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut buffer = String::new();
        for line in reader.lines().flatten() {
            if segment_re.is_match(&line) {
                // Flush the previous segment if one was being accumulated.
                if !buffer.is_empty() {
                    let _ = tx_out.send(WhisperEvent::Segment(std::mem::take(&mut buffer)));
                }
                buffer = line;
            } else if !buffer.is_empty() {
                // Continuation of the current segment.
                buffer.push('\n');
                buffer.push_str(&line);
            } else {
                let _ = tx_out.send(WhisperEvent::Log(line));
            }
        }
        if !buffer.is_empty() {
            let _ = tx_out.send(WhisperEvent::Segment(buffer));
        }
    });

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait on whisper-cli: {}", e))?;

    drop(tx);
    let events: Vec<WhisperEvent> = rx.iter().collect();

    if status.success() {
        // The output file path is the argument immediately following `-of`,
        // if present; otherwise fall back to the input's sibling path.
        let output_path = args
            .iter()
            .position(|a| a == "-of")
            .and_then(|i| args.get(i + 1))
            .cloned()
            .unwrap_or_default();
        Ok(vec![WhisperEvent::Done(output_path)])
    } else {
        let err_msg = events
            .iter()
            .filter_map(|e| {
                if let WhisperEvent::Error(msg) = e {
                    Some(msg.clone())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        Err(if err_msg.is_empty() {
            format!("whisper-cli exited with code: {}", status)
        } else {
            err_msg
        })
    }
}

/// Verify that whisper-cli is available.
///
/// We avoid actually invoking the binary: whisper-cli reads from stdin when
/// given no/`-h` args, which hangs the process. A presence check on the
/// resolved path is sufficient and instant.
pub fn detect_whisper() -> bool {
    let path = crate::whisper::whisper_path();
    path.exists()
}

/// Kill any running whisper-cli process. Mirrors `kill_ffmpeg()` in
/// commands/convert.rs so a hung transcription can be cancelled the same
/// way a hung conversion can.
pub fn kill_whisper() -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("taskkill")
            .args(["/IM", "whisper-cli.exe", "/F"])
            .output()
            .map(|_| ())
            .map_err(|e| format!("Failed to kill whisper-cli: {}", e))
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("pkill")
            .arg("-9")
            .arg("whisper-cli")
            .output()
            .map(|_| ())
            .map_err(|e| format!("Failed to kill whisper-cli: {}", e))
    }
}
