use regex::Regex;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

pub enum FfmpegEvent {
    Progress(f64),
    Done(String),
    Error(String),
    Log(String),
}

pub fn run_conversion<F>(
    args: &[String],
    duration: f64,
    on_event: F,
) -> std::result::Result<Vec<FfmpegEvent>, String>
where
    F: FnMut(&FfmpegEvent) + Send + 'static,
{
    let ffmpeg = crate::ffmpeg::ffmpeg_path();
    let mut cmd = Command::new(ffmpeg);
    cmd.args(args)
        .stderr(Stdio::piped())
        .stdout(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

    let stderr = child.stderr.take().unwrap();
    let reader = BufReader::new(stderr);

    let time_re = Regex::new(r"time=(\d+):(\d+):(\d+)\.(\d+)").unwrap();
    let (tx, rx) = mpsc::channel::<FfmpegEvent>();

    // Thread 1: read ffmpeg stderr, parse events, send to channel
    let tx_thread = tx.clone();
    thread::spawn(move || {
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };

            if !line.is_empty() && !time_re.is_match(&line) {
                let _ = tx_thread.send(FfmpegEvent::Log(line.clone()));
            }

            if line.starts_with("Error ") || line.contains("Conversion failed") {
                let _ = tx_thread.send(FfmpegEvent::Error(line.clone()));
            }

            if time_re.is_match(&line) {
                if let Some(caps) = time_re.captures(&line) {
                    let h: f64 = caps[1].parse().unwrap_or(0.0);
                    let m: f64 = caps[2].parse().unwrap_or(0.0);
                    let s: f64 = caps[3].parse().unwrap_or(0.0);
                    let ms: f64 = caps[4].parse().unwrap_or(0.0);
                    let current = h * 3600.0 + m * 60.0 + s + ms / 100.0;

                    if duration > 0.0 {
                        let progress = (current / duration).min(1.0);
                        let _ = tx_thread.send(FfmpegEvent::Progress(progress));
                    }
                }
            }
        }
    });

    // Thread 2: wait for ffmpeg to exit (non-blocking on this thread)
    let wait_thread = thread::spawn(move || child.wait());

    // Drop our sender so the channel closes once the reader thread exits
    drop(tx);

    // Drain the channel in real-time, calling on_event for each event
    let mut events = Vec::new();
    let mut on_event = on_event;
    let start_time = Instant::now();
    let mut last_known_progress = 0.0;

    loop {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(event) => {
                if let FfmpegEvent::Progress(p) = &event {
                    last_known_progress = *p;
                }
                on_event(&event);
                events.push(event);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if duration > 0.0 {
                    let elapsed = start_time.elapsed().as_secs_f64();
                    let estimated = ((elapsed / duration) * 0.95).min(0.95);
                    if estimated > last_known_progress {
                        let progress_event = FfmpegEvent::Progress(estimated);
                        on_event(&progress_event);
                        events.push(progress_event);
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    // ffmpeg is done (stderr pipe closed → reader thread exited → channel closed)
    let status = match wait_thread.join() {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => return Err(format!("Failed to wait on ffmpeg: {}", e)),
        Err(_) => return Err("ffmpeg wait thread panicked".to_string()),
    };

    if status.success() {
        let output_path = args.last().cloned().unwrap_or_default();
        events.push(FfmpegEvent::Done(output_path));
        Ok(events)
    } else {
        let err_msg = events
            .iter()
            .filter_map(|e| {
                if let FfmpegEvent::Error(msg) = e {
                    Some(msg.clone())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n");

        Err(if err_msg.is_empty() {
            format!("ffmpeg exited with code: {}", status)
        } else {
            err_msg
        })
    }
}

pub fn detect_ffmpeg() -> bool {
    let path = crate::ffmpeg::ffmpeg_path();
    let mut cmd = Command::new(path);
    cmd.arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.status().is_ok()
}
