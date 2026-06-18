import { useRef, useEffect, useState, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useForgeStore } from "../../store/forgeStore";
import { useContextMenu } from "../ContextMenu";
import type { ForgeClip } from "../../types";

export default function VideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const preloadRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const playingRef = useRef(false);
  const currentClipIdxRef = useRef(-1);
  const playheadTimeRef = useRef(0);
  const clipsRef = useRef<ForgeClip[]>([]);
  const audioClipsRef = useRef<ForgeClip[]>([]);
  const activeAudioIdxRef = useRef(-1);
  const fpsRef = useRef(30);
  const isSwitchingRef = useRef(false);
  const onTimeUpdateRef = useRef<() => void>(() => {});
  const gapRafRef = useRef<number | null>(null);
  const gapPrevTimeRef = useRef(0);
  const gapModeRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState<string | null>(null);
  const { show } = useContextMenu();

  const project = useForgeStore((s) => s.project);
  const clipVersion = useForgeStore((s) => s.clipVersion);
  const setPlayhead = useForgeStore((s) => s.setPlayhead);

  const clips = project.videoTrack.clips;
  const audioClips = project.audioTrack.clips;
  const fps = project.fps || 30;
  const playheadTime = project.playheadTime;
  const fmtW = project.width || 1920;
  const fmtH = project.height || 1080;

  clipsRef.current = clips;
  audioClipsRef.current = audioClips;
  fpsRef.current = fps;
  playheadTimeRef.current = playheadTime;

  const assetUrl = useCallback((path: string) => convertFileSrc(path), []);

  const timelineToSource = useCallback(
    (clip: ForgeClip, t: number) =>
      clip.sourceStart + Math.max(0, t - clip.startTime) * clip.speed,
    [],
  );

  const sourceToTimeline = useCallback(
    (clip: ForgeClip, t: number) =>
      clip.startTime + (t - clip.sourceStart) / clip.speed,
    [],
  );

  const findClipAt = useCallback(
    (time: number): { clip: ForgeClip; index: number } | null => {
      const a = clipsRef.current;
      for (let i = a.length - 1; i >= 0; i--) {
        const c = a[i];
        if (time >= c.startTime && time < c.startTime + c.duration)
          return { clip: c, index: i };
      }
      return null;
    },
    [],
  );

  const findAudioAt = useCallback(
    (time: number): { clip: ForgeClip; index: number } | null => {
      const a = audioClipsRef.current;
      for (let i = a.length - 1; i >= 0; i--) {
        const c = a[i];
        if (time >= c.startTime && time < c.startTime + c.duration)
          return { clip: c, index: i };
      }
      return null;
    },
    [],
  );

  const getMaxEnd = useCallback(
    () =>
      clipsRef.current.reduce(
        (m, c) => Math.max(m, c.startTime + c.duration),
        0,
      ),
    [],
  );

  const pointVideoAt = useCallback(
    (
      vid: HTMLVideoElement,
      clip: ForgeClip,
      timelineTime: number,
      onReady?: () => void,
    ) => {
      const src = assetUrl(clip.sourcePath);
      const seek = Math.max(
        clip.sourceStart,
        Math.min(
          timelineToSource(clip, timelineTime),
          clip.sourceEnd - 0.001,
        ),
      );

      if (vid.src !== src) {
        vid.src = src;
        vid.onloadedmetadata = () => {
          vid.currentTime = seek;
          onReady?.();
        };
      } else {
        vid.currentTime = seek;
        onReady?.();
      }
    },
    [assetUrl, timelineToSource],
  );

  const syncAudio = useCallback((timelineTime: number) => {
    const aud = audioRef.current;
    if (!aud) return;
    const a = audioClipsRef.current;
    if (a.length === 0) return;

    const found = findAudioAt(timelineTime);
    if (!found) {
      if (!aud.paused) aud.pause();
      activeAudioIdxRef.current = -1;
      return;
    }

    const seek = timelineToSource(found.clip, timelineTime);
    const clamped = Math.max(
      found.clip.sourceStart,
      Math.min(seek, found.clip.sourceEnd - 0.001),
    );

    if (found.index !== activeAudioIdxRef.current) {
      activeAudioIdxRef.current = found.index;
      const src = assetUrl(found.clip.sourcePath);
      if (aud.src !== src) {
        aud.src = src;
        aud.onloadedmetadata = () => {
          aud.currentTime = clamped;
          if (playingRef.current) aud.play().catch(() => {});
        };
      } else {
        aud.currentTime = clamped;
        if (playingRef.current) aud.play().catch(() => {});
      }
    } else {
      if (Math.abs(aud.currentTime - clamped) > 0.1) {
        aud.currentTime = clamped;
      }
      if (playingRef.current && aud.paused) {
        aud.play().catch(() => {});
      }
    }
  }, [assetUrl, timelineToSource, findAudioAt]);

  const preloadNext = useCallback(
    (fromIndex: number) => {
      const pre = preloadRef.current;
      if (!pre) return;
      const a = clipsRef.current;
      const cur = a[fromIndex];
      if (!cur) return;
      const endedTime = cur.startTime + cur.duration;
      const found = findClipAt(endedTime);
      if (!found || found.index === fromIndex) return;
      const nextClip = found.clip;
      const src = assetUrl(nextClip.sourcePath);
      const seek = timelineToSource(nextClip, endedTime);
      if (pre.src !== src) {
        pre.src = src;
        pre.onloadedmetadata = () => {
          pre.currentTime = Math.max(
            nextClip.sourceStart,
            Math.min(seek, nextClip.sourceEnd - 0.001),
          );
        };
      } else {
        pre.currentTime = Math.max(
          nextClip.sourceStart,
          Math.min(seek, nextClip.sourceEnd - 0.001),
        );
      }
    },
    [assetUrl, timelineToSource, findClipAt],
  );

  const switchToNextRef = useRef<() => void>(() => {});

  const handleTimeUpdateInternal = useCallback(() => {
    if (!playingRef.current) return;
    if (isSwitchingRef.current) return;
    if (gapModeRef.current) return;
    const vid = videoRef.current;
    if (!vid || vid.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const a = clipsRef.current;
    if (a.length === 0) return;

    const idx = currentClipIdxRef.current;
    if (idx < 0 || idx >= a.length) return;
    const c = a[idx];

    const timelineTime = sourceToTimeline(c, vid.currentTime);

    if (timelineTime >= c.startTime + c.duration) {
      switchToNextRef.current();
      return;
    }

    setPlayhead(timelineTime);
    syncAudio(timelineTime);
  }, [setPlayhead, sourceToTimeline, syncAudio]);

  switchToNextRef.current = useCallback(() => {
    if (isSwitchingRef.current) return;
    isSwitchingRef.current = true;

    const vid = videoRef.current;
    if (!vid) { isSwitchingRef.current = false; return; }
    const a = clipsRef.current;
    const idx = currentClipIdxRef.current;
    if (idx < 0 || idx >= a.length) { isSwitchingRef.current = false; return; }

    const endedTime = a[idx].startTime + a[idx].duration;
    setPlayhead(endedTime);

    const found = findClipAt(endedTime);
    if (!found) {
      vid.pause();
      if (gapRafRef.current !== null) {
        cancelAnimationFrame(gapRafRef.current);
        gapRafRef.current = null;
      }
      gapModeRef.current = true;
      playheadTimeRef.current = endedTime;
      gapPrevTimeRef.current = performance.now();
      isSwitchingRef.current = false;

      const advanceGap = (now: number) => {
        if (!gapModeRef.current || !playingRef.current) {
          gapModeRef.current = false;
          return;
        }
        const dt = (now - gapPrevTimeRef.current) / 1000;
        gapPrevTimeRef.current = now;
        const newTime = playheadTimeRef.current + dt;
        setPlayhead(newTime);

        const nextClip = findClipAt(newTime);
        if (nextClip) {
          gapModeRef.current = false;
          currentClipIdxRef.current = nextClip.index;
          const v = videoRef.current;
          if (v) {
            v.playbackRate = nextClip.clip.speed;
            pointVideoAt(v, nextClip.clip, newTime, () => {
              if (playingRef.current) v.play().catch(() => {});
            });
          }
          preloadNext(nextClip.index);
          return;
        }

        gapRafRef.current = requestAnimationFrame(advanceGap);
      };

      gapRafRef.current = requestAnimationFrame(advanceGap);
      return;
    }

    if (found.index === idx) {
      isSwitchingRef.current = false;
      return;
    }

    currentClipIdxRef.current = found.index;
    syncAudio(found.clip.startTime);

    const pre = preloadRef.current;
    if (pre && pre.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const nextSrc = assetUrl(found.clip.sourcePath);
      if (vid.src !== nextSrc) {
        vid.src = nextSrc;
        vid.onloadedmetadata = () => {
          isSwitchingRef.current = false;
          vid.currentTime = pre.currentTime;
          vid.playbackRate = found.clip.speed;
          if (playingRef.current) vid.play().catch(() => {});
        };
      } else {
        vid.currentTime = pre.currentTime;
        vid.playbackRate = found.clip.speed;
        if (playingRef.current) vid.play().catch(() => {});
        isSwitchingRef.current = false;
      }
    } else {
      pointVideoAt(vid, found.clip, endedTime, () => {
        vid.playbackRate = found.clip.speed;
        if (playingRef.current) vid.play().catch(() => {});
        isSwitchingRef.current = false;
      });
    }

    preloadNext(found.index);
  }, [setPlayhead, pointVideoAt, preloadNext, assetUrl, findClipAt, syncAudio]);

  onTimeUpdateRef.current = handleTimeUpdateInternal;
  const onTimeUpdate = useCallback(() => onTimeUpdateRef.current(), []);

  useEffect(() => {
    setHasError(null);
    if (clips.length === 0 && audioClips.length === 0) return;
    if (playingRef.current) return;

    if (clips.length > 0) {
      const found = findClipAt(playheadTime);
      if (found) {
        currentClipIdxRef.current = found.index;
        const vid = videoRef.current;
        if (vid) pointVideoAt(vid, found.clip, playheadTime);
      } else {
        const gap = clips.find((c) => c.startTime >= playheadTime);
        if (gap) {
          const idx = clips.indexOf(gap);
          currentClipIdxRef.current = idx;
          const vid = videoRef.current;
          if (vid) pointVideoAt(vid, gap, gap.startTime);
        } else {
          currentClipIdxRef.current = -1;
        }
      }
    }

    syncAudio(playheadTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipVersion]);

  useEffect(() => {
    if (playingRef.current) return;
    const vid = videoRef.current;
    if (!vid) return;

    const a = clipsRef.current;
    if (a.length > 0) {
      const found = findClipAt(playheadTime);
      if (found) {
        if (currentClipIdxRef.current !== found.index) {
          currentClipIdxRef.current = found.index;
          pointVideoAt(vid, found.clip, playheadTime);
        } else {
          const c = found.clip;
          const seek = timelineToSource(c, playheadTime);
          if (Math.abs(vid.currentTime - seek) > 0.5 / fpsRef.current) {
            vid.currentTime = Math.max(
              c.sourceStart,
              Math.min(seek, c.sourceEnd - 0.001),
            );
          }
        }
      }
    }

    syncAudio(playheadTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playheadTime]);

  const togglePlay = useCallback(() => {
    isSwitchingRef.current = false;
    if (gapRafRef.current !== null) {
      cancelAnimationFrame(gapRafRef.current);
      gapRafRef.current = null;
    }
    gapModeRef.current = false;
    if (playingRef.current) {
      playingRef.current = false;
      setIsPlaying(false);
      videoRef.current?.pause();
      audioRef.current?.pause();
      return;
    }

    const a = clipsRef.current;
    if (a.length === 0) return;

    let t = playheadTimeRef.current;
    const maxEnd = getMaxEnd();
    if (t >= maxEnd) {
      t = 0;
      setPlayhead(0);
    }

    let found = findClipAt(t);
    if (!found) {
      const next = a
        .slice()
        .sort((x, y) => x.startTime - y.startTime)
        .find((c) => c.startTime >= t);
      if (!next) return;
      t = next.startTime;
      setPlayhead(t);
      found = findClipAt(t);
    }
    if (!found) return;

    const vid = videoRef.current;
    if (!vid) return;

    currentClipIdxRef.current = found.index;
    preloadNext(found.index);

    playingRef.current = true;
    setIsPlaying(true);

    syncAudio(t);

    pointVideoAt(vid, found.clip, t, () => {
      vid.playbackRate = found.clip.speed;
      vid.play().catch(() => {
        playingRef.current = false;
        setIsPlaying(false);
      });
    });
  }, [setPlayhead, findClipAt, getMaxEnd, pointVideoAt, preloadNext, syncAudio]);

  const seek = useCallback(
    (time: number) => {
      if (gapRafRef.current !== null) {
        cancelAnimationFrame(gapRafRef.current);
        gapRafRef.current = null;
      }
      gapModeRef.current = false;
      isSwitchingRef.current = false;
      playingRef.current = false;
      setIsPlaying(false);
      setPlayhead(time);
      const vid = videoRef.current;
      if (!vid) return;
      const a = clipsRef.current;
      if (a.length === 0) return;

      const found = findClipAt(time);
      if (found) {
        currentClipIdxRef.current = found.index;
        pointVideoAt(vid, found.clip, time);
      } else {
        const next = a
          .slice()
          .sort((x, y) => x.startTime - y.startTime)
          .find((c) => c.startTime >= time);
        if (next) {
          const idx = a.indexOf(next);
          currentClipIdxRef.current = idx;
          pointVideoAt(vid, next, next.startTime);
        } else {
          currentClipIdxRef.current = -1;
          vid.pause();
        }
      }

      syncAudio(time);
    },
    [setPlayhead, findClipAt, pointVideoAt, syncAudio],
  );

  const stepFrame = useCallback(
    (dir: number) => {
      const step = dir / fpsRef.current;
      seek(Math.max(0, playheadTimeRef.current + step));
    },
    [seek],
  );

  useEffect(() => {
    const handler = () => togglePlay();
    window.addEventListener("forge-toggle-play", handler);
    return () => window.removeEventListener("forge-toggle-play", handler);
  }, [togglePlay]);

  useEffect(() => {
    return () => {
      playingRef.current = false;
      gapModeRef.current = false;
      if (gapRafRef.current !== null) {
        cancelAnimationFrame(gapRafRef.current);
        gapRafRef.current = null;
      }
      const vid = videoRef.current;
      if (vid) vid.pause();
      const aud = audioRef.current;
      if (aud) aud.pause();
    };
  }, []);

  const hasVideo = clips.length > 0 || audioClips.length > 0;
  const isOnClip = clips.some(
    (c) => playheadTime >= c.startTime && playheadTime < c.startTime + c.duration
  );
  const totalDuration = clips.reduce(
    (m, c) => Math.max(m, c.startTime + c.duration),
    0,
  );

  const handlePreviewContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "toggle play", rune: "ᛏ", action: togglePlay },
      { label: "step forward", rune: "ᚷ", action: () => stepFrame(1) },
      { label: "step back", rune: "ᚨ", action: () => stepFrame(-1) },
    ]);
  }, [show, togglePlay, stepFrame]);

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 10);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`;
  };

  const handleResolutionContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: `copy (${fmtW}×${fmtH})`, rune: "ᚷ", action: () => navigator.clipboard.writeText(`${fmtW}x${fmtH}`) },
    ]);
  }, [show, fmtW, fmtH]);

  const handleTimeDisplayContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: `copy (${formatTime(playheadTime)})`, rune: "ᚷ", action: () => navigator.clipboard.writeText(formatTime(playheadTime)) },
      { label: "go to start", rune: "ᛏ", action: () => seek(0) },
    ]);
  }, [show, playheadTime, seek, formatTime]);

  const handleEmptyPlaceholderContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "import media", rune: "ᚨ", action: () => {
        const store = useForgeStore.getState();
        store.importMediaFiles();
      }},
    ]);
  }, [show]);

  return (
    <div className="forge-preview-inner" onContextMenu={handlePreviewContext}>
      <div className="forge-preview-canvas">
        {hasVideo ? (
          <div
            className="forge-preview-video-wrapper"
            style={{ aspectRatio: `${fmtW}/${fmtH}` }}
          >
            <video
              ref={videoRef}
              muted
              preload="auto"
              className="forge-preview-video"
              style={{ opacity: isOnClip ? 1 : 0 }}
              onTimeUpdate={onTimeUpdate}
              onEnded={() => {
                playingRef.current = false;
                setIsPlaying(false);
              }}
              onError={() => setHasError("Video error")}
              playsInline
            />
            <video
              ref={preloadRef}
              muted
              preload="auto"
              playsInline
              style={{ display: "none" }}
            />
            <audio
              ref={audioRef}
              preload="auto"
              style={{ display: "none" }}
            />
            <div className="forge-preview-format-overlay" />
            <div className="forge-preview-format-label" onContextMenu={handleResolutionContext}>
              {fmtW}×{fmtH}
            </div>
          </div>
        ) : hasError ? (
          <div className="forge-preview-placeholder">
            <div className="forge-preview-placeholder-frame error">
              <div className="forge-preview-placeholder-inner">
                <span className="forge-preview-placeholder-rune">ᚲ</span>
                <span className="forge-preview-placeholder-text">{hasError}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="forge-preview-placeholder" onContextMenu={handleEmptyPlaceholderContext}>
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

      {hasVideo && (
        <div className="forge-transport">
          <button
            className="forge-transport-btn"
            onClick={() => stepFrame(-1)}
            title="Frame back"
          >
            ⏮
          </button>
          <button
            className="forge-transport-btn forge-transport-play"
            onClick={togglePlay}
          >
            {isPlaying ? "■" : "▶"}
          </button>
          <button
            className="forge-transport-btn"
            onClick={() => stepFrame(1)}
            title="Frame forward"
          >
            ⏭
          </button>
          <span className="forge-transport-time" onContextMenu={handleTimeDisplayContext}>
            {formatTime(playheadTime)}
          </span>
          <span className="forge-transport-sep">/</span>
          <span className="forge-transport-time dim">
            {formatTime(totalDuration)}
          </span>
          <input
            type="range"
            className="forge-transport-scrub"
            min={0}
            max={totalDuration || 0}
            step={1 / (project.fps || 30)}
            value={playheadTime}
            onChange={(e) => seek(parseFloat(e.target.value))}
          />
        </div>
      )}
    </div>
  );
}
