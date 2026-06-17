import { useRef, useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useForgeStore } from "../../store/forgeStore";

const MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4", mkv: "video/x-matroska", avi: "video/x-msvideo",
  mov: "video/quicktime", webm: "video/webm", m4v: "video/mp4",
  flv: "video/x-flv", ogv: "video/ogg", wmv: "video/x-ms-wmv",
  mp3: "audio/mpeg", flac: "audio/flac", wav: "audio/wav",
  aac: "audio/aac", ogg: "audio/ogg", opus: "audio/opus",
};

export default function VideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const project = useForgeStore((s) => s.project);
  const setPlayhead = useForgeStore((s) => s.setPlayhead);
  const playheadTime = project.playheadTime;

  const activeClip = project.videoTrack.clips.find(
    (c) => playheadTime >= c.startTime && playheadTime < c.startTime + c.duration
  );
  const srcPath = activeClip?.sourcePath || null;

  // Load video bytes via IPC -> blob URL whenever source path changes
  useEffect(() => {
    if (!srcPath) {
      if (blobUrl) { URL.revokeObjectURL(blobUrl); setBlobUrl(null); }
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const bytes = await invoke<number[]>("read_file_bytes", { path: srcPath });
        if (cancelled) return;
        const ext = srcPath.split(".").pop()?.toLowerCase() || "";
        const mime = MIME_TYPES[ext] || "video/mp4";
        const blob = new Blob([new Uint8Array(bytes)], { type: mime });
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch (err) {
        if (!cancelled) setLoadError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [srcPath]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, []);

  // Seek when playhead moves on a loaded video
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !activeClip || !blobUrl || loading) return;
    const target = playheadTime - activeClip.startTime + activeClip.sourceStart;
    if (Math.abs(vid.currentTime - target) > 0.3) {
      vid.currentTime = target;
    }
  }, [playheadTime, activeClip, blobUrl, loading]);

  // Resume playback after src reload
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !activeClip || !blobUrl || loading || !playing) return;
    const target = playheadTime - activeClip.startTime + activeClip.sourceStart;
    if (Math.abs(vid.currentTime - target) < 0.3) {
      vid.play().catch(() => setPlaying(false));
    }
  }, [blobUrl, loading, playing, activeClip, playheadTime]);

  const handleLoadedMetadata = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || !activeClip) return;
    setDuration(vid.duration);
    const target = playheadTime - activeClip.startTime + activeClip.sourceStart;
    vid.currentTime = target;
  }, [activeClip, playheadTime]);

  const handleTimeUpdate = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || !activeClip) return;
    const t = vid.currentTime;
    setCurrentTime(t);
    setPlayhead(activeClip.startTime + (t - activeClip.sourceStart));
  }, [activeClip, setPlayhead]);

  const handleEnded = useCallback(() => setPlaying(false), []);

  const togglePlay = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || !blobUrl) return;
    if (playing) {
      vid.pause();
      setPlaying(false);
    } else if (activeClip) {
      vid.currentTime = playheadTime - activeClip.startTime + activeClip.sourceStart;
      vid.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }, [playing, blobUrl, activeClip, playheadTime]);

  const stepFrame = useCallback((dir: number) => {
    const vid = videoRef.current;
    if (!vid || !blobUrl || !activeClip) return;
    const fps = project.fps || 30;
    const newTime = Math.max(0, Math.min(vid.duration || 0, vid.currentTime + dir / fps));
    vid.currentTime = newTime;
    setPlayhead(activeClip.startTime + (newTime - activeClip.sourceStart));
  }, [blobUrl, activeClip, project.fps, setPlayhead]);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const vid = videoRef.current;
    if (!vid || !activeClip) return;
    const v = parseFloat(e.target.value);
    vid.currentTime = v;
    setPlayhead(activeClip.startTime + (v - activeClip.sourceStart));
  }, [activeClip, setPlayhead]);

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 10);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`;
  };

  return (
    <div className="forge-preview">
      <div className="forge-preview-canvas">
        {blobUrl ? (
          <video
            ref={videoRef}
            className="forge-preview-video"
            src={blobUrl}
            preload="auto"
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
            onError={() => setLoadError("Video element failed to render")}
            playsInline
          />
        ) : loading ? (
          <div className="forge-preview-placeholder">
            <div className="forge-preview-placeholder-frame">
              <div className="forge-preview-placeholder-inner">
                <span className="forge-preview-placeholder-rune">ᚲ</span>
                <span className="forge-preview-placeholder-text">loading video...</span>
              </div>
            </div>
          </div>
        ) : loadError ? (
          <div className="forge-preview-placeholder">
            <div className="forge-preview-placeholder-frame error">
              <div className="forge-preview-placeholder-inner">
                <span className="forge-preview-placeholder-rune">ᚲ</span>
                <span className="forge-preview-placeholder-text">video could not load</span>
                <span className="forge-preview-placeholder-hint">{loadError}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="forge-preview-placeholder">
            <div className="forge-preview-placeholder-frame">
              <div className="forge-preview-placeholder-inner">
                <span className="forge-preview-placeholder-rune">ᚲ</span>
                <span className="forge-preview-placeholder-text">drop media here</span>
                <span className="forge-preview-placeholder-hint">or use + media in source</span>
              </div>
            </div>
          </div>
        )}
      </div>
      {blobUrl && !loading && (
        <div className="forge-transport">
          <button className="forge-transport-btn" onClick={() => stepFrame(-1)} title="Frame back">
            ⏮
          </button>
          <button className="forge-transport-btn forge-transport-play" onClick={togglePlay}>
            {playing ? "■" : "▶"}
          </button>
          <button className="forge-transport-btn" onClick={() => stepFrame(1)} title="Frame forward">
            ⏭
          </button>
          <span className="forge-transport-time">{formatTime(currentTime)}</span>
          <span className="forge-transport-sep">/</span>
          <span className="forge-transport-time dim">{formatTime(duration)}</span>
          <input
            type="range"
            className="forge-transport-scrub"
            min={0}
            max={duration || 0}
            step={1 / (project.fps || 30)}
            value={currentTime}
            onChange={handleScrub}
          />
        </div>
      )}
    </div>
  );
}