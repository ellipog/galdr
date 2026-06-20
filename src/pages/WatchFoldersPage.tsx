import { useEffect, useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useWatchStore } from "../store/watchStore";
import Dropdown from "../components/Dropdown";
import ScrambleText from "../components/ScrambleText";
import { FORMAT_OPTIONS } from "../options";
import type { ConversionParams, WatchAction, WatchFolderConfig } from "../types";

const ACTION_OPTIONS = [
  { value: "autoConvert", label: "auto-convert now" },
  { value: "queue", label: "queue for review" },
];

/** Minimal-but-complete ConversionParams preset. input_path/output_dir are
 *  overwritten per-file at convert time; they just need to exist for serde. */
function defaultParams(): ConversionParams {
  return {
    input_path: "",
    output_dir: "",
    output_format: "mp4",
    quality: 0.8,
  };
}

function emptyFolder(): WatchFolderConfig {
  return {
    id: "",
    enabled: true,
    path: "",
    extensions: [],
    outputDir: "",
    action: "autoConvert",
    params: defaultParams(),
    deleteSource: false,
  };
}

export default function WatchFoldersPage() {
  const {
    folders, paused, queue, activity, load, saveFolder, deleteFolder,
    setPaused, convertQueued, dequeue, clearQueue, bindEvents,
  } = useWatchStore();

  const [editing, setEditing] = useState<WatchFolderConfig | null>(null);
  const [extInput, setExtInput] = useState("");

  useEffect(() => {
    load();
    let unbind: (() => void) | undefined;
    bindEvents().then((u) => { unbind = u; });
    return () => { unbind?.(); };
  }, [load, bindEvents]);

  const pickFolder = useCallback(async () => {
    const sel = await open({ directory: true, multiple: false });
    if (sel && editing) setEditing({ ...editing, path: sel as string });
  }, [editing]);

  const pickOutput = useCallback(async () => {
    const sel = await open({ directory: true, multiple: false });
    if (sel && editing) setEditing({ ...editing, outputDir: sel as string });
  }, [editing]);

  const addExt = useCallback(() => {
    if (!editing || !extInput.trim()) return;
    const ext = extInput.trim().replace(/^\./, "").toLowerCase();
    if (!editing.extensions.includes(ext)) {
      setEditing({ ...editing, extensions: [...editing.extensions, ext] });
    }
    setExtInput("");
  }, [editing, extInput]);

  const save = useCallback(async () => {
    if (!editing || !editing.path || !editing.outputDir) return;
    await saveFolder(editing);
    setEditing(null);
  }, [editing, saveFolder]);

  const activityList = Object.values(activity);
  const enabledCount = folders.filter((f) => f.enabled).length;

  return (
    <div className="page">
      <div className="ops-row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <ScrambleText as="span" className="ops-rune" text="ᛟ" hover ticks={2} />
          <span className="label" style={{ display: "inline", marginLeft: 8 }}>watch folders</span>
        </div>
        <div className="ops-row">
          <span className="ops-sub">
            {paused ? "paused" : `watching ${enabledCount}/${folders.length}`}
          </span>
          <button
            className={`btn watch-pause-btn${paused ? " active" : ""}`}
            onClick={() => setPaused(!paused)}
          >
            {paused ? "resume" : "pause"}
          </button>
          <button className="btn btn-primary" onClick={() => setEditing(emptyFolder())}>
            add folder
          </button>
        </div>
      </div>

      {/* Folder list */}
      {folders.length === 0 && !editing && (
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <span className="ops-sub">no watch folders configured — click "add folder"</span>
        </div>
      )}

      {folders.map((f) => (
        <div className="card" key={f.id}>
          <div className="ops-row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14 }}>{f.path || "(no path)"}</div>
              <div className="ops-sub">
                {f.extensions.length ? f.extensions.join(", ") : "all files"} ·{" "}
                {f.action === "autoConvert" ? "auto-convert" : "queue"} ·{" "}
                {f.params.output_format}
                {f.deleteSource ? " · delete source" : ""}
              </div>
            </div>
            <div className="ops-row">
              <button
                className={`ops-toggle${f.enabled ? " on" : ""}`}
                style={{ padding: "6px 16px" }}
                onClick={async () => {
                  const updated = await saveFolder({ ...f, enabled: !f.enabled });
                  void updated;
                }}
              >
                {f.enabled ? "on" : "off"}
              </button>
              <button className="btn" onClick={() => setEditing({ ...f })}>edit</button>
              <button className="btn" onClick={() => deleteFolder(f.id)}>delete</button>
            </div>
          </div>
        </div>
      ))}

      {/* Editor */}
      {editing && (
        <div className="card ops-card" style={{ marginTop: 16 }}>
          <div className="ops-header" style={{ borderBottom: "1px solid var(--fg-faint)" }}>
            <span className="ops-rune">ᚦ</span>
            <span className="label">{editing.id ? "edit folder" : "new folder"}</span>
          </div>
          <div className="ops-body" style={{ overflow: "visible" }}>
            <div className="ops-group">
              <span className="ops-group-label">folder to watch</span>
              <div className="ops-row">
                <span className="ops-sub" style={{ flex: 1 }}>{editing.path || "—"}</span>
                <button className="btn" onClick={pickFolder}>browse</button>
              </div>
            </div>

            <div className="ops-group">
              <span className="ops-group-label">output folder</span>
              <div className="ops-row">
                <span className="ops-sub" style={{ flex: 1 }}>{editing.outputDir || "—"}</span>
                <button className="btn" onClick={pickOutput}>browse</button>
              </div>
            </div>

            <div className="ops-group">
              <span className="ops-group-label">extensions (empty = all)</span>
              <div className="ops-row">
                {editing.extensions.map((e) => (
                  <button
                    key={e}
                    className="ops-toggle on"
                    onClick={() => setEditing({ ...editing, extensions: editing.extensions.filter((x) => x !== e) })}
                  >.{e} ✕</button>
                ))}
                <input
                  className="ops-field-input"
                  value={extInput}
                  onChange={(ev) => setExtInput(ev.target.value)}
                  onKeyDown={(ev) => ev.key === "Enter" && addExt()}
                  placeholder="mp4"
                  style={{ background: "transparent", border: "1px solid var(--fg-faint)", color: "var(--fg)", padding: "4px 6px", fontFamily: "inherit", fontSize: 13, width: 90 }}
                />
                <button className="btn" onClick={addExt}>add</button>
              </div>
            </div>

            <div className="ops-group">
              <span className="ops-group-label">output format</span>
              <Dropdown
                options={FORMAT_OPTIONS}
                value={editing.params.output_format ?? "mp4"}
                onChange={(v) => setEditing({ ...editing, params: { ...editing.params, output_format: v } })}
                showCategories
              />
            </div>

            <div className="ops-group">
              <span className="ops-group-label">quality ({Math.round((editing.params.quality ?? 0.8) * 100)}%)</span>
              <input
                type="range"
                className="watch-slider"
                min={0}
                max={1}
                step={0.05}
                value={editing.params.quality ?? 0.8}
                onChange={(e) => setEditing({ ...editing, params: { ...editing.params, quality: Number(e.target.value) } })}
              />
            </div>

            <div className="ops-group">
              <span className="ops-group-label">action</span>
              <Dropdown
                options={ACTION_OPTIONS}
                value={editing.action}
                onChange={(v) => setEditing({ ...editing, action: v as WatchAction })}
              />
            </div>

            <label className="ops-row watch-check-row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                className="watch-check"
                checked={editing.deleteSource}
                onChange={(e) => setEditing({ ...editing, deleteSource: e.target.checked })}
              />
              <span className="ops-sub">delete source after successful auto-convert</span>
            </label>

            <div className="convert-actions" style={{ marginTop: 8 }}>
              <button className="btn btn-primary" onClick={save} disabled={!editing.path || !editing.outputDir}>
                save
              </button>
              <button className="btn" onClick={() => setEditing(null)}>cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Live activity */}
      {activityList.length > 0 && (
        <>
          <ScrambleText as="div" className="rune-divider" text="ᛟ ᛟ ᛟ" hover ticks={2} />
          <div className="card">
            <span className="label">active conversions</span>
            {activityList.map((a) => {
              const key = `${a.folderId}:${a.path}`;
              return (
                <div className="ops-row" key={key} style={{ justifyContent: "space-between", marginTop: 8 }}>
                  <span className="ops-sub" style={{ flex: 1 }}>{a.path.split(/[/\\]/).pop()}</span>
                  {a.status === "running" && (
                    <div className="progress-bar-container" style={{ flex: 1, margin: "0 12px" }}>
                      <div className="progress-bar" style={{ width: `${a.progress * 100}%` }} />
                    </div>
                  )}
                  {a.status === "done" && a.outputPath && (
                    <button className="btn" onClick={() => revealItemInDir(a.outputPath!)}>show</button>
                  )}
                  {a.status === "error" && <span className="alert-error" style={{ padding: "2px 6px" }}>failed</span>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Queue */}
      {queue.length > 0 && (
        <>
          <ScrambleText as="div" className="rune-divider" text="ᛟ ᛟ ᛟ" hover ticks={2} />
          <div className="card">
            <div className="ops-row" style={{ justifyContent: "space-between" }}>
              <span className="label" style={{ margin: 0 }}>queue ({queue.length})</span>
              <button className="btn" onClick={clearQueue}>clear all</button>
            </div>
            {queue.map((q) => (
              <div className="ops-row" key={q.id} style={{ justifyContent: "space-between", marginTop: 8 }}>
                <span className="ops-sub" style={{ flex: 1 }}>{q.name}</span>
                <button className="btn btn-primary" onClick={() => convertQueued(q.id)}>convert</button>
                <button className="btn" onClick={() => dequeue(q.id)}>remove</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
