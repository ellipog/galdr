import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { SubtitleStyle } from "../types";

interface Props {
  value: SubtitleStyle;
  onChange: (style: SubtitleStyle) => void;
}

const COLOR_SWATCHES = [
  { label: "white", value: "&H00FFFFFF" },
  { label: "yellow", value: "&H0000FFFF" },
  { label: "red", value: "&H000000FF" },
  { label: "green", value: "&H0000FF00" },
  { label: "cyan", value: "&H00FFFF00" },
  { label: "blue", value: "&H00FF0000" },
  { label: "magenta", value: "&H00FF00FF" },
];

const BACK_COLOR_SWATCHES = [
  { label: "none", value: "&H00000000" },
  { label: "semi-black", value: "&H80000000" },
  { label: "semi-white", value: "&H80FFFFFF" },
  { label: "black", value: "&H00000000" },
];

const ALIGN_KEYS = [
  [7, 8, 9],
  [4, 5, 6],
  [1, 2, 3],
];

const DEFAULTS: SubtitleStyle = {
  fontName: "Arial",
  fontSize: 24,
  primaryColor: "&H00FFFFFF",
  outlineColor: "&H00000000",
  outlineWidth: 2,
  marginV: 40,
  alignment: 2,
  bold: 0,
  backColor: "&H00000000",
};

export default function SubtitleStylePanel({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const set = useCallback(
    (patch: Partial<SubtitleStyle>) => {
      onChange({ ...value, ...patch });
    },
    [value, onChange],
  );

  const resetToDefaults = useCallback(() => {
    onChange({ ...DEFAULTS });
  }, [onChange]);

  return (
    <div className="card sub-style-panel">
      <button
        className="sub-style-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="ops-rune">ᛦ</span>
        <span className="sub-style-toggle-label">subtitle style</span>
        <span className="sub-style-toggle-arrow">{open ? "▾" : "▸"}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="sub-style-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Font name + size */}
            <div className="sub-style-row">
              <label>font</label>
              <div className="sub-style-inline">
                <input
                  className="input"
                  type="text"
                  placeholder="Arial"
                  value={value.fontName ?? ""}
                  onChange={(e) => set({ fontName: e.target.value || undefined })}
                />
              </div>
            </div>

            <div className="sub-style-row">
              <label>font size</label>
              <div className="sub-style-inline">
                <input
                  type="range"
                  min={6}
                  max={72}
                  step={1}
                  value={value.fontSize ?? 24}
                  onChange={(e) => set({ fontSize: Number(e.target.value) })}
                />
                <span className="sub-style-val">{value.fontSize ?? 24}pt</span>
              </div>
            </div>

            {/* Primary colour */}
            <div className="sub-style-row">
              <label>primary colour</label>
              <div className="sub-color-row">
                {COLOR_SWATCHES.map((sw) => (
                  <button
                    key={sw.value}
                    className={`color-swatch${value.primaryColor === sw.value ? " selected" : ""}`}
                    style={{ backgroundColor: assHexToCSS(sw.value) }}
                    title={sw.label}
                    onClick={() => set({ primaryColor: sw.value })}
                  />
                ))}
                <div className="sub-color-hex">
                  <input
                    className="input"
                    type="text"
                    placeholder="&H00FFFFFF"
                    value={value.primaryColor ?? ""}
                    onChange={(e) => set({ primaryColor: e.target.value || undefined })}
                    title="ASS hex colour: &HAABBGGRR"
                  />
                </div>
              </div>
            </div>

            {/* Outline colour */}
            <div className="sub-style-row">
              <label>outline colour</label>
              <div className="sub-color-row">
                {COLOR_SWATCHES.map((sw) => (
                  <button
                    key={sw.value}
                    className={`color-swatch${value.outlineColor === sw.value ? " selected" : ""}`}
                    style={{ backgroundColor: assHexToCSS(sw.value) }}
                    title={sw.label}
                    onClick={() => set({ outlineColor: sw.value })}
                  />
                ))}
                <div className="sub-color-hex">
                  <input
                    className="input"
                    type="text"
                    placeholder="&H00000000"
                    value={value.outlineColor ?? ""}
                    onChange={(e) => set({ outlineColor: e.target.value || undefined })}
                    title="ASS hex colour: &HAABBGGRR"
                  />
                </div>
              </div>
            </div>

            {/* Outline width */}
            <div className="sub-style-row">
              <label>outline width</label>
              <div className="sub-style-inline">
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.5}
                  value={value.outlineWidth ?? 2}
                  onChange={(e) => set({ outlineWidth: Number(e.target.value) })}
                />
                <span className="sub-style-val">{value.outlineWidth ?? 2}px</span>
              </div>
            </div>

            {/* Alignment */}
            <div className="sub-style-row">
              <label>alignment</label>
              <div className="align-grid">
                {ALIGN_KEYS.flat().map((n) => (
                  <button
                    key={n}
                    className={`align-btn${value.alignment === n ? " selected" : ""}`}
                    onClick={() => set({ alignment: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Vertical margin */}
            <div className="sub-style-row">
              <label>vertical margin</label>
              <div className="sub-style-inline">
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={value.marginV ?? 40}
                  onChange={(e) => set({ marginV: Number(e.target.value) })}
                />
                <span className="sub-style-val">{value.marginV ?? 40}px</span>
              </div>
            </div>

            {/* Bold + back colour */}
            <div className="sub-style-row">
              <label>bold</label>
              <div className="sub-style-inline">
                <button
                  className={`btn toggle-btn${value.bold === 1 ? " active" : ""}`}
                  onClick={() => set({ bold: value.bold === 1 ? 0 : 1 })}
                >
                  {value.bold === 1 ? "on" : "off"}
                </button>
              </div>
            </div>

            <div className="sub-style-row">
              <label>background</label>
              <div className="sub-color-row">
                {BACK_COLOR_SWATCHES.map((sw) => (
                  <button
                    key={sw.label}
                    className={`color-swatch${value.backColor === sw.value ? " selected" : ""}`}
                    style={{ backgroundColor: assHexToCSS(sw.value) }}
                    title={sw.label}
                    onClick={() => set({ backColor: sw.value })}
                  />
                ))}
                <div className="sub-color-hex">
                  <input
                    className="input"
                    type="text"
                    placeholder="&H00000000"
                    value={value.backColor ?? ""}
                    onChange={(e) => set({ backColor: e.target.value || undefined })}
                    title="ASS hex: &HAABBGGRR"
                  />
                </div>
              </div>
            </div>

            {/* Reset */}
            <button className="sub-style-reset" onClick={resetToDefaults}>
              reset to defaults
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Convert an ASS hex colour string (&HAABBGGRR) to a CSS hex string (#RRGGBB)
 * so it can be used as a swatch background colour.
 */
function assHexToCSS(ass: string): string {
  if (!ass || ass.length < 8) return "#888";
  // Strip "&H" prefix, take last 6 chars as BBGGRR → reverse to RRGGBB
  const hex = ass.replace(/^&H/, "").padStart(6, "0").slice(-6);
  const bb = hex.slice(0, 2);
  const gg = hex.slice(2, 4);
  const rr = hex.slice(4, 6);
  return `#${rr}${gg}${bb}`;
}
