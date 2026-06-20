import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useGaldrStore } from "../store";
import Dropdown from "./Dropdown";
import type { MediaInfo, ConversionParams } from "../types";

type MediaType = "video" | "audio" | "image" | null;

interface Props {
  mediaType: MediaType;
  mediaInfo: MediaInfo | null;
}

const RATIO_OPTIONS = [
  { value: "", label: "none" },
  { value: "16:9", label: "16:9" },
  { value: "4:3", label: "4:3" },
  { value: "1:1", label: "1:1" },
  { value: "9:16", label: "9:16" },
];

const RES_PRESETS: { value: string; label: string; size: [number, number] }[] = [
  { value: "source", label: "source", size: [0, 0] },
  { value: "1080p", label: "1080p", size: [1920, 1080] },
  { value: "720p", label: "720p", size: [1280, 720] },
  { value: "480p", label: "480p", size: [854, 480] },
  { value: "square", label: "square", size: [1080, 1080] },
];

const SAMPLE_RATE_OPTIONS = [
  { value: "0", label: "source" },
  { value: "22050", label: "22 kHz" },
  { value: "44100", label: "44.1 kHz" },
  { value: "48000", label: "48 kHz" },
];

const CHANNEL_OPTIONS = [
  { value: "0", label: "source" },
  { value: "1", label: "mono" },
  { value: "2", label: "stereo" },
];

const ROTATE_OPTIONS = [
  { value: "0", label: "0°" },
  { value: "90", label: "90°" },
  { value: "180", label: "180°" },
  { value: "270", label: "270°" },
];

const NORMALIZE_OPTIONS = [
  { value: "off", label: "off" },
  { value: "loudnorm", label: "loudnorm (EBU R128)" },
  { value: "dynaudnorm", label: "dynaudnorm (peak)" },
];

const FLIP_OPTIONS = [
  { value: "off", label: "off" },
  { value: "h", label: "horizontal" },
  { value: "v", label: "vertical" },
];

export default function ConvertOperations({ mediaType, mediaInfo }: Props) {
  const { conversionParams, setConversionParams } = useGaldrStore();
  const [open, setOpen] = useState(false);
  const [cropMode, setCropMode] = useState<"ratio" | "manual">(
    conversionParams.crop_ratio ? "ratio" : "manual",
  );
  const [speedLinked, setSpeedLinked] = useState(true);
  const [aspectLock, setAspectLock] = useState(false);

  const p = conversionParams;
  const hasAudio = mediaInfo?.streams.some((s) => s.kind === "audio") ?? false;
  const isVideo = mediaType === "video";
  const isImage = mediaType === "image";
  const isAudio = mediaType === "audio";
  const duration = mediaInfo?.duration ?? 0;

  const set = useCallback(
    (patch: Partial<ConversionParams>) => setConversionParams(patch),
    [setConversionParams],
  );

  const resetAll = useCallback(() => {
    set({
      trim_start: undefined, trim_end: undefined,
      resolution: undefined,
      framerate: undefined,
      crop_w: undefined, crop_h: undefined, crop_x: undefined, crop_y: undefined, crop_ratio: undefined,
      speed_video: undefined, speed_audio: undefined,
      rotate: undefined, flip: undefined,
      sample_rate: undefined, channels: undefined,
      audio_normalize: undefined, fade_in: undefined, fade_out: undefined,
    });
    setCropMode("manual");
    setSpeedLinked(true);
    setAspectLock(false);
  }, [set]);

  // Resize helpers
  const srcW = mediaInfo?.streams.find((s) => s.kind === "video")?.width ?? 0;
  const srcH = mediaInfo?.streams.find((s) => s.kind === "video")?.height ?? 0;
  const [resW, resH] = p.resolution ?? [0, 0];
  const applyResPreset = useCallback((value: string) => {
    const preset = RES_PRESETS.find((r) => r.value === value);
    if (!preset) return;
    if (value === "source") {
      set({ resolution: undefined });
    } else {
      set({ resolution: preset.size });
    }
  }, [set]);

  const onResWChange = useCallback((w: number) => {
    if (w <= 0) { set({ resolution: undefined }); return; }
    let h = resH;
    if (aspectLock && srcW && srcH) {
      h = Math.round((w * srcH) / srcW);
      h = h % 2 ? h + 1 : h;
    }
    set({ resolution: [w, h] });
  }, [resH, aspectLock, srcW, srcH, set]);

  const onResHChange = useCallback((h: number) => {
    set({ resolution: [resW || srcW || 0, h] });
  }, [resW, srcW, set]);

  const onSpeedChange = useCallback((v: number) => {
    if (speedLinked) set({ speed_video: v, speed_audio: v });
    else set({ speed_video: v });
  }, [speedLinked, set]);

  const onSpeedAudioChange = useCallback((v: number) => {
    set({ speed_audio: v });
  }, [set]);

  const fmtDur = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = (secs % 60).toFixed(1);
    return `${m}:${s.padStart(4, "0")}`;
  };

  return (
    <div className="card ops-card">
      <button
        className="ops-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="ops-rune">ᚦ</span>
        <span className="label">operations</span>
        <span className="ops-collapse">{open ? "▾" : "▸"}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="ops-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
          {/* Trim — video & audio */}
          {(isVideo || isAudio) && (
            <div className="ops-group">
              <span className="ops-group-label">trim</span>
              <div className="ops-row">
                <label className="ops-field">
                  <span className="ops-hint">start</span>
                  <input
                    type="number"
                    min={0}
                    max={duration || undefined}
                    step="0.1"
                    value={p.trim_start ?? ""}
                    onChange={(e) => set({ trim_start: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </label>
                <label className="ops-field">
                  <span className="ops-hint">end</span>
                  <input
                    type="number"
                    min={0}
                    max={duration || undefined}
                    step="0.1"
                    value={p.trim_end ?? ""}
                    onChange={(e) => set({ trim_end: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </label>
                {duration > 0 && <span className="ops-sub">source {fmtDur(duration)}</span>}
              </div>
            </div>
          )}

          {/* Resize — video & image */}
          {(isVideo || isImage) && (
            <div className="ops-group">
              <span className="ops-group-label">resize</span>
              <div className="ops-row">
                <Dropdown
                  options={RES_PRESETS.map((r) => ({ value: r.value, label: r.label }))}
                  value={
                    RES_PRESETS.find((r) => r.size[0] === resW && r.size[1] === resH)?.value ?? "source"
                  }
                  onChange={applyResPreset}
                />
                <label className="ops-field">
                  <input
                    type="number"
                    min={0}
                    placeholder="w"
                    value={resW || ""}
                    onChange={(e) => onResWChange(Number(e.target.value))}
                  />
                </label>
                <span className="ops-sub">×</span>
                <label className="ops-field">
                  <input
                    type="number"
                    min={0}
                    placeholder="h"
                    value={resH || ""}
                    onChange={(e) => onResHChange(Number(e.target.value))}
                  />
                </label>
                <button
                  className={`ops-toggle${aspectLock ? " on" : ""}`}
                  onClick={() => setAspectLock((a) => !a)}
                  title="lock aspect ratio"
                  disabled={!srcW}
                >
                  ⛓
                </button>
              </div>
            </div>
          )}

          {/* Crop — video & image */}
          {(isVideo || isImage) && (
            <div className="ops-group">
              <span className="ops-group-label">crop</span>
              <div className="ops-row">
                <div className="ops-segmented">
                  <button className={!cropMode || cropMode === "ratio" ? "active" : ""} onClick={() => setCropMode("ratio")}>ratio</button>
                  <button className={cropMode === "manual" ? "active" : ""} onClick={() => setCropMode("manual")}>manual</button>
                </div>
                {cropMode === "ratio" ? (
                  <Dropdown
                    options={RATIO_OPTIONS}
                    value={p.crop_ratio ?? ""}
                    onChange={(v) => set({ crop_ratio: v || undefined })}
                  />
                ) : (
                  <>
                    <label className="ops-field"><input type="number" min={0} placeholder="w" value={p.crop_w ?? ""} onChange={(e) => set({ crop_w: e.target.value ? Number(e.target.value) : undefined })} /></label>
                    <label className="ops-field"><input type="number" min={0} placeholder="h" value={p.crop_h ?? ""} onChange={(e) => set({ crop_h: e.target.value ? Number(e.target.value) : undefined })} /></label>
                    <label className="ops-field"><input type="number" placeholder="x" value={p.crop_x ?? ""} onChange={(e) => set({ crop_x: e.target.value ? Number(e.target.value) : undefined })} /></label>
                    <label className="ops-field"><input type="number" placeholder="y" value={p.crop_y ?? ""} onChange={(e) => set({ crop_y: e.target.value ? Number(e.target.value) : undefined })} /></label>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Frame rate — video only */}
          {isVideo && (
            <div className="ops-group">
              <span className="ops-group-label">framerate</span>
              <div className="ops-row">
                <label className="ops-field">
                  <input
                    type="number"
                    min={1}
                    max={120}
                    placeholder="fps"
                    value={p.framerate ?? ""}
                    onChange={(e) => set({ framerate: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Speed — video & audio */}
          {(isVideo || isAudio) && (
            <div className="ops-group">
              <span className="ops-group-label">speed</span>
              <div className="ops-row">
                <input
                  type="range"
                  min={0.25}
                  max={4}
                  step={0.05}
                  value={p.speed_video ?? 1}
                  onChange={(e) => onSpeedChange(Number(e.target.value))}
                />
                <span className="ops-sub">{(p.speed_video ?? 1).toFixed(2)}×</span>
                {isVideo && (
                  <button
                    className={`ops-toggle${speedLinked ? " on" : ""}`}
                    onClick={() => setSpeedLinked((s) => !s)}
                    title="link audio speed"
                  >
                    🔗
                  </button>
                )}
              </div>
              {isVideo && !speedLinked && (
                <div className="ops-row ops-sub-row">
                  <span className="ops-hint">audio</span>
                  <input
                    type="range"
                    min={0.25}
                    max={4}
                    step={0.05}
                    value={p.speed_audio ?? 1}
                    onChange={(e) => onSpeedAudioChange(Number(e.target.value))}
                  />
                  <span className="ops-sub">{(p.speed_audio ?? 1).toFixed(2)}×</span>
                </div>
              )}
            </div>
          )}

          {/* Rotate / flip — video & image */}
          {(isVideo || isImage) && (
            <div className="ops-group">
              <span className="ops-group-label">rotate</span>
              <div className="ops-row">
                <div className="ops-segmented">
                  {ROTATE_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      className={(p.rotate ?? 0) === Number(o.value) ? "active" : ""}
                      onClick={() => set({ rotate: Number(o.value) || undefined })}
                    >{o.label}</button>
                  ))}
                </div>
                <Dropdown
                  options={FLIP_OPTIONS}
                  value={p.flip ?? "off"}
                  onChange={(v) => set({ flip: v === "off" ? undefined : (v as "h" | "v") })}
                />
              </div>
            </div>
          )}

          {/* Audio sample rate / channels — when audio stream present */}
          {hasAudio && (isVideo || isAudio) && (
            <div className="ops-group">
              <span className="ops-group-label">audio</span>
              <div className="ops-row">
                <Dropdown
                  options={SAMPLE_RATE_OPTIONS}
                  value={String(p.sample_rate ?? 0)}
                  onChange={(v) => set({ sample_rate: Number(v) || undefined })}
                />
                <Dropdown
                  options={CHANNEL_OPTIONS}
                  value={String(p.channels ?? 0)}
                  onChange={(v) => set({ channels: Number(v) || undefined })}
                />
              </div>
            </div>
          )}

          {/* Audio normalize / fades — when audio stream present */}
          {hasAudio && (isVideo || isAudio) && (
            <div className="ops-group">
              <span className="ops-group-label">normalize</span>
              <div className="ops-row">
                <Dropdown
                  options={NORMALIZE_OPTIONS}
                  value={p.audio_normalize ?? "off"}
                  onChange={(v) => set({ audio_normalize: v === "off" ? undefined : (v as "loudnorm" | "dynaudnorm") })}
                />
                <label className="ops-field">
                  <span className="ops-hint">fade in</span>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    placeholder="s"
                    value={p.fade_in ?? ""}
                    onChange={(e) => set({ fade_in: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </label>
                <label className="ops-field">
                  <span className="ops-hint">fade out</span>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    placeholder="s"
                    value={p.fade_out ?? ""}
                    onChange={(e) => set({ fade_out: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </label>
              </div>
            </div>
          )}

          <button className="ops-reset" onClick={resetAll}>reset all</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
