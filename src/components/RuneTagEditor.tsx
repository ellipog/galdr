import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import Dropdown from "./Dropdown";
import { FMT_OPTIONS } from "../options";
import type { RuneTag, PresetParams } from "../types";

const ELDER_FUTHARK = [
  "ᚠ", "ᚢ", "ᚦ", "ᚨ", "ᚱ", "ᚲ", "ᚷ", "ᚹ", "ᚺ", "ᚾ",
  "ᛁ", "ᛃ", "ᛇ", "ᛈ", "ᛉ", "ᛊ", "ᛏ", "ᛒ", "ᛖ", "ᛗ",
  "ᛚ", "ᛝ", "ᛟ", "ᛞ",
];

interface Props {
  tag?: RuneTag;
  onSave: (tag: RuneTag) => void;
  onCancel: () => void;
}

/** A blank preset spanning the full conversion surface (paths excluded). */
const emptyParams: PresetParams = {
  output_format: "mp4",
  video_codec: undefined,
  audio_codec: undefined,
  video_bitrate: undefined,
  audio_bitrate: undefined,
  resolution: undefined,
  framerate: undefined,
  crf: undefined,
  preset: undefined,
  quality: undefined,
  trim_start: undefined,
  trim_end: undefined,
  crop_w: undefined,
  crop_h: undefined,
  crop_x: undefined,
  crop_y: undefined,
  crop_ratio: undefined,
  speed_video: undefined,
  speed_audio: undefined,
  rotate: undefined,
  flip: undefined,
  sample_rate: undefined,
  channels: undefined,
  audio_normalize: undefined,
  fade_in: undefined,
  fade_out: undefined,
};

const NORMALIZE_OPTIONS = [
  { value: "", label: "none" },
  { value: "loudnorm", label: "loudnorm (EBU R128)" },
  { value: "dynaudnorm", label: "dynaudnorm (peak)" },
];

const FLIP_OPTIONS = [
  { value: "", label: "none" },
  { value: "h", label: "horizontal" },
  { value: "v", label: "vertical" },
];

const ROTATE_OPTIONS = [
  { value: "", label: "none" },
  { value: "90", label: "90°" },
  { value: "180", label: "180°" },
  { value: "270", label: "270°" },
];

export default function RuneTagEditor({ tag, onSave, onCancel }: Props) {
  const [name, setName] = useState(tag?.name ?? "");
  const [rune, setRune] = useState(tag?.rune ?? "ᚠ");
  const [description, setDescription] = useState(tag?.description ?? "");
  const [params, setParams] = useState<PresetParams>(tag?.params ?? { ...emptyParams });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [triedSave, setTriedSave] = useState(false);

  const fmtOptions = useMemo(
    () => FMT_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    [],
  );

  const setParam = <K extends keyof PresetParams>(key: K, value: PresetParams[K]) =>
    setParams((p) => ({ ...p, [key]: value }));

  const handleSave = () => {
    setTriedSave(true);
    if (!name.trim()) return;
    onSave({
      id: tag?.id ?? "",
      name: name.trim(),
      rune,
      description: description.trim(),
      params,
    });
  };

  // Generic numeric/text input bound to a preset field. Empty = undefined so
  // unset fields never clobber a conversion when the rune is applied.
  const paramInput = (
    label: string,
    key: keyof PresetParams,
    placeholder: string,
    type: "text" | "number" = "text",
  ) => (
    <label className="rune-editor-field">
      <span className="rune-editor-label">{label}</span>
      <input
        type={type}
        className="input"
        placeholder={placeholder}
        value={(params[key] as string | number | undefined) ?? ""}
        onChange={(e) => {
          const val = e.target.value;
          if (type === "number") {
            setParam(key, val ? Number(val) : undefined);
          } else {
            setParam(key, (val || undefined) as PresetParams[typeof key]);
          }
        }}
      />
    </label>
  );

  return (
    <motion.div
      className="rune-editor-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="rune-editor"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
      >
        <div className="rune-editor-header">
          <span className="rune-editor-rune">{rune}</span>
          <span className="rune-editor-title">
            {tag ? `edit ${tag.name}` : "new rune tag"}
          </span>
        </div>

        <div className="rune-editor-body">
          <label className="rune-editor-field">
            <span className="rune-editor-label">
              name
              <span className="rune-editor-required">*</span>
            </span>
            <input
              type="text"
              className={`input${triedSave && !name.trim() ? " input-error" : ""}`}
              placeholder="e.g. Fehu"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {triedSave && !name.trim() && (
              <span className="rune-editor-validation">name is required</span>
            )}
          </label>

          <label className="rune-editor-field">
            <span className="rune-editor-label">rune</span>
            <div className="rune-picker">
              <input
                type="text"
                className="input rune-picker-input"
                placeholder="ᚠ"
                value={rune}
                onChange={(e) => setRune(e.target.value)}
                maxLength={2}
              />
              <div className="rune-picker-grid">
                {ELDER_FUTHARK.map((r) => (
                  <button
                    key={r}
                    className={`rune-picker-btn${r === rune ? " active" : ""}`}
                    onClick={() => setRune(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </label>

          <label className="rune-editor-field">
            <span className="rune-editor-label">description</span>
            <input
              type="text"
              className="input"
              placeholder="e.g. Archive: H.265 CRF 18, FLAC audio"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="rune-editor-divider">
            <span className="rune-editor-divider-label">core params</span>
          </div>

          <label className="rune-editor-field">
            <span className="rune-editor-label">format</span>
            <Dropdown
              options={fmtOptions}
              value={params.output_format}
              onChange={(v) => setParam("output_format", v)}
              placeholder="select format"
            />
          </label>

          {paramInput("video codec", "video_codec", "e.g. libx264")}
          {paramInput("audio codec", "audio_codec", "e.g. aac")}
          {paramInput("video bitrate", "video_bitrate", "e.g. 2M")}
          {paramInput("audio bitrate", "audio_bitrate", "e.g. 128k")}

          <label className="rune-editor-field">
            <span className="rune-editor-label">resolution (WxH)</span>
            <div className="rune-editor-row">
              <input
                type="number"
                className="input"
                placeholder="width"
                value={params.resolution?.[0] ?? ""}
                onChange={(e) => {
                  const w = e.target.value ? Number(e.target.value) : undefined;
                  const h = params.resolution?.[1];
                  setParam("resolution", w !== undefined && h !== undefined ? [w, h] : undefined);
                }}
              />
              <span className="rune-editor-sep">x</span>
              <input
                type="number"
                className="input"
                placeholder="height"
                value={params.resolution?.[1] ?? ""}
                onChange={(e) => {
                  const w = params.resolution?.[0];
                  const h = e.target.value ? Number(e.target.value) : undefined;
                  setParam("resolution", w !== undefined && h !== undefined ? [w, h] : undefined);
                }}
              />
            </div>
          </label>

          {paramInput("framerate", "framerate", "e.g. 30", "number")}
          {paramInput("CRF", "crf", "0-51 (lower = better)", "number")}
          {paramInput("preset", "preset", "e.g. medium, fast, slow")}
          {paramInput("quality", "quality", "0-100 (higher = better)", "number")}

          <button
            type="button"
            className="rune-editor-advanced-toggle"
            onClick={() => setShowAdvanced((s) => !s)}
          >
            <span className="rune-editor-advanced-arrow">{showAdvanced ? "▼" : "▶"}</span>
            <span>{showAdvanced ? "hide" : "show"} advanced (trim · crop · speed · audio)</span>
          </button>

          {showAdvanced && (
            <div className="rune-editor-advanced">
              <div className="rune-editor-divider">
                <span className="rune-editor-divider-label">trim</span>
              </div>
              {paramInput("trim start (s)", "trim_start", "e.g. 0", "number")}
              {paramInput("trim end (s)", "trim_end", "e.g. 12.5", "number")}

              <div className="rune-editor-divider">
                <span className="rune-editor-divider-label">crop</span>
              </div>
              <label className="rune-editor-field">
                <span className="rune-editor-label">crop size (WxH)</span>
                <div className="rune-editor-row">
                  <input
                    type="number"
                    className="input"
                    placeholder="width"
                    value={params.crop_w ?? ""}
                    onChange={(e) => setParam("crop_w", e.target.value ? Number(e.target.value) : undefined)}
                  />
                  <span className="rune-editor-sep">x</span>
                  <input
                    type="number"
                    className="input"
                    placeholder="height"
                    value={params.crop_h ?? ""}
                    onChange={(e) => setParam("crop_h", e.target.value ? Number(e.target.value) : undefined)}
                  />
                </div>
              </label>
              <label className="rune-editor-field">
                <span className="rune-editor-label">crop offset (X,Y)</span>
                <div className="rune-editor-row">
                  <input
                    type="number"
                    className="input"
                    placeholder="x"
                    value={params.crop_x ?? ""}
                    onChange={(e) => setParam("crop_x", e.target.value ? Number(e.target.value) : undefined)}
                  />
                  <span className="rune-editor-sep">x</span>
                  <input
                    type="number"
                    className="input"
                    placeholder="y"
                    value={params.crop_y ?? ""}
                    onChange={(e) => setParam("crop_y", e.target.value ? Number(e.target.value) : undefined)}
                  />
                </div>
              </label>
              {paramInput("crop ratio lock", "crop_ratio", "e.g. 16:9")}

              <div className="rune-editor-divider">
                <span className="rune-editor-divider-label">speed & orientation</span>
              </div>
              {paramInput("video speed", "speed_video", "0.25 - 4.0", "number")}
              {paramInput("audio speed", "speed_audio", "0.25 - 4.0", "number")}
              <label className="rune-editor-field">
                <span className="rune-editor-label">rotate</span>
                <Dropdown
                  options={ROTATE_OPTIONS}
                  value={params.rotate !== undefined ? String(params.rotate) : ""}
                  onChange={(v) => setParam("rotate", v ? Number(v) : undefined)}
                  placeholder="none"
                />
              </label>
              <label className="rune-editor-field">
                <span className="rune-editor-label">flip</span>
                <Dropdown
                  options={FLIP_OPTIONS}
                  value={params.flip ?? ""}
                  onChange={(v) => setParam("flip", (v || undefined) as PresetParams["flip"])}
                  placeholder="none"
                />
              </label>

              <div className="rune-editor-divider">
                <span className="rune-editor-divider-label">audio</span>
              </div>
              {paramInput("sample rate", "sample_rate", "e.g. 44100", "number")}
              {paramInput("channels", "channels", "1 / 2 / 6", "number")}
              <label className="rune-editor-field">
                <span className="rune-editor-label">normalize</span>
                <Dropdown
                  options={NORMALIZE_OPTIONS}
                  value={params.audio_normalize ?? ""}
                  onChange={(v) => setParam("audio_normalize", (v || undefined) as PresetParams["audio_normalize"])}
                  placeholder="none"
                />
              </label>
              {paramInput("fade in (s)", "fade_in", "e.g. 1.5", "number")}
              {paramInput("fade out (s)", "fade_out", "e.g. 2.0", "number")}
            </div>
          )}
        </div>

        <div className="rune-editor-footer">
          <button className="btn" onClick={onCancel}>
            cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!name.trim()}
            title={!name.trim() ? "name is required" : "save this rune tag"}
          >
            save
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
