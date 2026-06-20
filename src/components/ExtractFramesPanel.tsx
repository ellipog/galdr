import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { MediaInfo } from "../types";

interface Props {
  inputPath: string;
  mediaInfo: MediaInfo | null;
}

type Mode = "single" | "sequence";

function fmtDur(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

export default function ExtractFramesPanel({ inputPath, mediaInfo }: Props) {
  const [mode, setMode] = useState<Mode>("single");
  const [open, setOpen] = useState(false);
  const [timestamp, setTimestamp] = useState(0);
  const [seqStart, setSeqStart] = useState(0);
  const [seqInterval, setSeqInterval] = useState(1);
  const [seqCount, setSeqCount] = useState(5);
  const [results, setResults] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const duration = mediaInfo?.duration ?? 0;

  const extract = useCallback(async () => {
    if (!inputPath) return;
    setBusy(true);
    setError(null);
    setResults([]);
    try {
      const timestamps: number[] = [];
      if (mode === "single") {
        timestamps.push(timestamp);
      } else {
        for (let i = 0; i < seqCount; i++) {
          const t = seqStart + i * seqInterval;
          if (duration > 0 && t > duration) break;
          timestamps.push(t);
        }
      }
      const all: string[] = [];
      for (const t of timestamps) {
        const paths = await invoke<string[]>("extract_frames", {
          paths: [inputPath],
          timestamp: t,
        });
        all.push(...paths.filter(Boolean));
      }
      setResults(all);
      if (all.length === 0) setError("No frames extracted");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [inputPath, mode, timestamp, seqStart, seqInterval, seqCount, duration]);

  return (
    <div className="card frames-card ops-card">
      <button
        className="ops-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="ops-rune">ᚾ</span>
        <span className="label">extract frames</span>
        <span className="ops-collapse">{open ? "▾" : "▸"}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="frames-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="frames-mode">
              <button className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}>single</button>
              <button className={mode === "sequence" ? "active" : ""} onClick={() => setMode("sequence")}>sequence</button>
            </div>

            {mode === "single" ? (
              <div className="ops-row">
                <label className="ops-field">
                  <span className="ops-hint">timestamp (s)</span>
                  <input
                    type="number"
                    min={0}
                    max={duration || undefined}
                    step={0.1}
                    value={timestamp}
                    onChange={(e) => setTimestamp(Number(e.target.value))}
                  />
                </label>
                {duration > 0 && <span className="ops-sub">source {fmtDur(duration)}</span>}
              </div>
            ) : (
              <>
                <div className="ops-row">
                  <label className="ops-field">
                    <span className="ops-hint">start (s)</span>
                    <input type="number" min={0} step={0.1} value={seqStart} onChange={(e) => setSeqStart(Number(e.target.value))} />
                  </label>
                  <label className="ops-field">
                    <span className="ops-hint">interval (s)</span>
                    <input type="number" min={0.1} step={0.1} value={seqInterval} onChange={(e) => setSeqInterval(Number(e.target.value))} />
                  </label>
                  <label className="ops-field">
                    <span className="ops-hint">count</span>
                    <input type="number" min={1} max={100} step={1} value={seqCount} onChange={(e) => setSeqCount(Number(e.target.value))} />
                  </label>
                </div>
                <span className="ops-sub">
                  {Math.min(seqCount, duration > 0 ? Math.ceil((duration - seqStart) / seqInterval) : seqCount)} frames
                </span>
              </>
            )}

            <div className="convert-actions">
              <button className="btn btn-primary" disabled={busy || !inputPath} onClick={extract}>
                {busy ? "extracting..." : "extract"}
              </button>
            </div>

            {error && <div className="alert-error">! {error}</div>}

            {results.length > 0 && (
              <div className="frames-results">
                {results.map((p, i) => (
                  <div className="frames-result" key={i}>
                    <span>{p.split(/[/\\]/).pop()}</span>
                    <button className="btn" onClick={() => revealItemInDir(p)}>show</button>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
