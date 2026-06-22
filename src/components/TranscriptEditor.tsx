import { useState, useRef, useEffect, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { save as dialogSave, open } from "@tauri-apps/plugin-dialog";
import { useContextMenu } from "./ContextMenu";
import {
  parseTime,
  serializeSrt,
  serializeVtt,
  shiftCues,
  mergeCues,
  splitCue,
  deleteCue,
  replaceInCues,
} from "../utils/srt";
import type { Cue } from "../types";

interface Props {
  cues: Cue[];
  onChange: (cues: Cue[]) => void;
  filePath: string | null;
  videoPath: string | null;
  onSetVideoPath: (path: string | null) => void;
  /** Called when user wants to save. Return true on success. */
  onSave: (cues: Cue[], path: string | null, asVtt: boolean) => Promise<boolean>;
  /** Called for auto-save recovery. */
  onAutoSave: (cues: Cue[]) => void;
}

// ── History entry for undo/redo ──
interface Snapshot {
  cues: Cue[];
}

// ── Format helpers ──

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function parseFmtTime(raw: string): number | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  return parseTime(cleaned);
}

export default function TranscriptEditor({
  cues,
  onChange,
  filePath,
  videoPath,
  onSetVideoPath,
  onSave,
  onAutoSave,
}: Props) {
  const { show } = useContextMenu();

  // ── Selection & editing state ──
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const [activeCueIdx, setActiveCueIdx] = useState<number>(-1);
  const [editingTimeIdx, setEditingTimeIdx] = useState<number | null>(null); // which cue has an open time editor
  const [editingTimeField, setEditingTimeField] = useState<"start" | "end" | null>(null);
  const [editingTimeValue, setEditingTimeValue] = useState("");
  const [editingTextIdx, setEditingTextIdx] = useState<number | null>(null);
  const [editingTextValue, setEditingTextValue] = useState("");

  // ── Search ──
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchReplace, setSearchReplace] = useState("");

  // ── Shift timestamps ──
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftDelta, setShiftDelta] = useState("0");

  // ── Video player ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoOpen, setVideoOpen] = useState(true);
  const vidSyncRef = useRef(true);

  // ── Undo/redo ──
  const [history, setHistory] = useState<Snapshot[]>([{ cues: [] }]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const historyLockRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Refs for cue list scrolling ──
  const cueListRef = useRef<HTMLDivElement>(null);
  const cueRowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // ── Init history from props on first load ──
  useEffect(() => {
    if (!historyLockRef.current && cues.length > 0) {
      setHistory([{ cues: JSON.parse(JSON.stringify(cues)) }]);
      setHistoryIdx(0);
    }
    // Only on mount or when filePath changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // ── Push snapshot helper ──
  const pushSnapshot = useCallback((nextCues: Cue[]) => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIdx + 1);
      const snap: Snapshot = { cues: JSON.parse(JSON.stringify(nextCues)) };
      const next = [...trimmed, snap];
      // Keep max 100 undo steps
      if (next.length > 100) next.shift();
      return next;
    });
    setHistoryIdx((prev) => Math.min(prev + 1, 100));
  }, [historyIdx]);

  // ── Apply cues from history ──
  const applyFromHistory = useCallback((idx: number) => {
    historyLockRef.current = true;
    setHistoryIdx(idx);
    onChange(JSON.parse(JSON.stringify(history[idx].cues)));
    setTimeout(() => { historyLockRef.current = false; }, 0);
  }, [history, onChange]);

  const undo = useCallback(() => {
    if (historyIdx > 0) applyFromHistory(historyIdx - 1);
  }, [historyIdx, applyFromHistory]);

  const redo = useCallback(() => {
    if (historyIdx < history.length - 1) applyFromHistory(historyIdx + 1);
  }, [historyIdx, history.length, applyFromHistory]);

  // ── Auto-save ──
  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      onAutoSave(cues);
    }, 3000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [cues, onAutoSave]);

  // ── Video sync ──
  const handleVideoTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setVideoTime(v.currentTime);

    if (vidSyncRef.current && cues.length > 0) {
      // Find the cue that contains the current video time
      let found = -1;
      for (let i = 0; i < cues.length; i++) {
        if (v.currentTime >= cues[i].start && v.currentTime < cues[i].end) {
          found = i;
          break;
        }
      }
      if (found !== -1 && found !== activeCueIdx) {
        setActiveCueIdx(found);
        // Auto-scroll the active cue into view
        const el = cueRowRefs.current[found];
        if (el && cueListRef.current) {
          const container = cueListRef.current;
          const rect = el.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          if (rect.top < containerRect.top || rect.bottom > containerRect.bottom) {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        }
      } else if (found === -1) {
        setActiveCueIdx(-1);
      }
    }
  }, [cues, activeCueIdx]);

  const toggleVideoPlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setVideoPlaying(true);
    } else {
      v.pause();
      setVideoPlaying(false);
    }
  }, []);

  const seekVideo = useCallback((time: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(time, v.duration || 0));
  }, []);

  // Click on a cue → seek video to its start
  const handleCueClick = useCallback((idx: number) => {
    setSelectedIdx(idx);
    setEditingTextIdx(null);
    setEditingTimeIdx(null);
    if (videoRef.current && videoPath) {
      seekVideo(cues[idx].start);
    }
  }, [cues, videoPath, seekVideo]);

  const handleCueDoubleClick = useCallback((idx: number) => {
    setSelectedIdx(idx);
    setEditingTextIdx(idx);
    setEditingTextValue(cues[idx].text);
  }, [cues]);

  // ── Text editing ──
  const commitTextEdit = useCallback(() => {
    if (editingTextIdx === null) return;
    const next = [...cues];
    next[editingTextIdx] = { ...next[editingTextIdx], text: editingTextValue };
    pushSnapshot(next);
    onChange(next);
    setEditingTextIdx(null);
  }, [editingTextIdx, editingTextValue, cues, onChange, pushSnapshot]);

  const handleTextKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.shiftKey) {
      // Allow shift+enter for newline in textarea
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commitTextEdit();
    }
    if (e.key === "Escape") {
      setEditingTextIdx(null);
    }
  }, [commitTextEdit]);

  // ── Time editing ──
  const openTimeEdit = useCallback((idx: number, field: "start" | "end") => {
    setEditingTimeIdx(idx);
    setEditingTimeField(field);
    setEditingTimeValue(field === "start" ? fmtTime(cues[idx].start) : fmtTime(cues[idx].end));
  }, [cues]);

  const commitTimeEdit = useCallback(() => {
    if (editingTimeIdx === null || !editingTimeField) return;
    const parsed = parseFmtTime(editingTimeValue);
    if (parsed === null) {
      setEditingTimeIdx(null);
      return;
    }
    const next = [...cues];
    const updated = { ...next[editingTimeIdx] };
    if (editingTimeField === "start") {
      updated.start = parsed;
    } else {
      updated.end = parsed;
    }
    // Clamp: start can't be negative, end must be > start
    updated.start = Math.max(0, updated.start);
    if (updated.end <= updated.start) updated.end = updated.start + 0.5;
    next[editingTimeIdx] = updated;
    pushSnapshot(next);
    onChange(next);
    setEditingTimeIdx(null);
  }, [editingTimeIdx, editingTimeField, editingTimeValue, cues, onChange, pushSnapshot]);

  const handleTimeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitTimeEdit();
    }
    if (e.key === "Escape") {
      setEditingTimeIdx(null);
    }
  }, [commitTimeEdit]);

  // ── Toolbar actions ──
  const handleAddCue = useCallback(() => {
    if (cues.length === 0) {
      const first: Cue = { index: 1, start: 0, end: 5, text: "" };
      pushSnapshot([first]);
      onChange([first]);
      setSelectedIdx(0);
      return;
    }
    const idx = selectedIdx >= 0 ? selectedIdx : cues.length - 1;
    const ref = cues[idx];
    const newStart = ref.end;
    const newEnd = ref.end + 5;
    const newCue: Cue = { index: idx + 2, start: newStart, end: newEnd, text: "" };
    const next = [
      ...cues.slice(0, idx + 1),
      newCue,
      ...cues.slice(idx + 1),
    ].map((c, i) => ({ ...c, index: i + 1 }));
    pushSnapshot(next);
    onChange(next);
    setSelectedIdx(idx + 1);
  }, [cues, selectedIdx, onChange, pushSnapshot]);

  const handleDeleteCue = useCallback(() => {
    if (selectedIdx < 0 || selectedIdx >= cues.length) return;
    const next = deleteCue(cues, selectedIdx);
    pushSnapshot(next);
    onChange(next);
    setSelectedIdx(Math.min(selectedIdx, next.length - 1));
  }, [cues, selectedIdx, onChange, pushSnapshot]);

  const handleMergeCue = useCallback(() => {
    if (selectedIdx < 0 || selectedIdx >= cues.length - 1) return;
    const next = mergeCues(cues, selectedIdx, selectedIdx + 1);
    pushSnapshot(next);
    onChange(next);
  }, [cues, selectedIdx, onChange, pushSnapshot]);

  const handleSplitCue = useCallback(() => {
    if (selectedIdx < 0 || selectedIdx >= cues.length) return;
    // Split at midpoint
    const cue = cues[selectedIdx];
    const mid = (cue.end - cue.start) / 2;
    const next = splitCue(cues, selectedIdx, mid);
    pushSnapshot(next);
    onChange(next);
    setSelectedIdx(selectedIdx + 1);
  }, [cues, selectedIdx, onChange, pushSnapshot]);

  const handleShiftApply = useCallback(() => {
    const delta = parseFloat(shiftDelta);
    if (isNaN(delta) || delta === 0) return;
    const next = shiftCues(cues, delta);
    pushSnapshot(next);
    onChange(next);
    setShiftOpen(false);
    setShiftDelta("0");
  }, [cues, shiftDelta, onChange, pushSnapshot]);

  const handleSearchReplace = useCallback(() => {
    if (!searchQuery) return;
    const result = replaceInCues(cues, searchQuery, searchReplace);
    if (result.matches > 0) {
      pushSnapshot(result.cues);
      onChange(result.cues);
    }
  }, [cues, searchQuery, searchReplace, onChange, pushSnapshot]);

  // ── Save ──
  const handleSave = useCallback(async (asVtt: boolean) => {
    await onSave(cues, filePath, asVtt);
  }, [cues, filePath, onSave]);

  const handleSaveAs = useCallback(async () => {
    const ext = filePath?.endsWith(".vtt") ? "vtt" : "srt";
    const dest = await dialogSave({
      filters: [
        { name: "SRT", extensions: ["srt"] },
        { name: "VTT", extensions: ["vtt"] },
      ],
      defaultPath: filePath ? filePath.replace(/\.\w+$/, `_edited.${ext}`) : undefined,
    });
    if (!dest) return;
    const isVtt = dest.endsWith(".vtt");
    const content = isVtt ? serializeVtt(cues) : serializeSrt(cues);
    try {
      await invoke("save_subtitle_file", { path: dest, content });
    } catch (e) {
      console.error("save failed:", e);
    }
  }, [cues, filePath]);

  // ── Load video ──
  const handleLoadVideo = useCallback(async () => {
    const sel = await open({
      multiple: false,
      filters: [{ name: "Video", extensions: ["mp4", "mkv", "avi", "mov", "webm", "m4v", "flv"] }],
    });
    if (sel) onSetVideoPath(sel as string);
  }, [onSetVideoPath]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      // Don't capture when editing text/inputs
      if (tag === "INPUT" || tag === "TEXTAREA") {
        // Still allow Escape
        if (e.key === "Escape") {
          if (editingTextIdx !== null) setEditingTextIdx(null);
          if (editingTimeIdx !== null) setEditingTimeIdx(null);
          if (searchOpen) setSearchOpen(false);
          if (shiftOpen) setShiftOpen(false);
        }
        return;
      }

      switch (e.key) {
        case "z":
          if (e.ctrlKey && e.shiftKey) { e.preventDefault(); redo(); }
          else if (e.ctrlKey) { e.preventDefault(); undo(); }
          break;
        case "y":
          if (e.ctrlKey) { e.preventDefault(); redo(); }
          break;
        case "s":
          if (e.ctrlKey) { e.preventDefault(); handleSave(filePath?.endsWith(".vtt") ?? false); }
          break;
        case " ":
          if (videoPath) { e.preventDefault(); toggleVideoPlay(); }
          break;
        case "Delete":
        case "Backspace":
          if (selectedIdx >= 0) { e.preventDefault(); handleDeleteCue(); }
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIdx((prev) => Math.max(0, prev - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIdx((prev) => Math.min(cues.length - 1, prev + 1));
          break;
        case "Enter":
          if (selectedIdx >= 0) {
            e.preventDefault();
            setEditingTextIdx(selectedIdx);
            setEditingTextValue(cues[selectedIdx].text);
          }
          break;
        case "f":
          if (e.ctrlKey) { e.preventDefault(); setSearchOpen((o) => !o); }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cues, selectedIdx, videoPath, filePath, editingTextIdx, editingTimeIdx, searchOpen, shiftOpen,
      undo, redo, handleSave, toggleVideoPlay, handleDeleteCue]);

  // ── Render helpers ──

  const renderTiming = (cue: Cue, idx: number) => {
    if (editingTimeIdx === idx) {
      return (
        <span className="tc-time-editing">
          <input
            className="input tc-time-input"
            value={editingTimeValue}
            onChange={(e) => setEditingTimeValue(e.target.value)}
            onBlur={commitTimeEdit}
            onKeyDown={handleTimeKeyDown}
            autoFocus
            spellCheck={false}
          />
        </span>
      );
    }
    return (
      <span className="tc-time-range">
        <span
          className="tc-time tc-time-start"
          onClick={() => openTimeEdit(idx, "start")}
          title="Click to edit start time"
        >
          {fmtTime(cue.start)}
        </span>
        <span className="tc-time-arrow">→</span>
        <span
          className="tc-time tc-time-end"
          onClick={() => openTimeEdit(idx, "end")}
          title="Click to edit end time"
        >
          {fmtTime(cue.end)}
        </span>
      </span>
    );
  };

  const renderText = (cue: Cue, idx: number) => {
    if (editingTextIdx === idx) {
      return (
        <textarea
          className="input tc-text-edit"
          value={editingTextValue}
          onChange={(e) => setEditingTextValue(e.target.value)}
          onBlur={commitTextEdit}
          onKeyDown={handleTextKeyDown}
          autoFocus
          rows={Math.max(1, editingTextValue.split("\n").length)}
        />
      );
    }
    return (
      <span
        className="tc-text-display"
        onDoubleClick={() => handleCueDoubleClick(idx)}
        title="Double-click to edit text"
      >
        {cue.text || <span className="tc-text-empty">— empty —</span>}
      </span>
    );
  };

  // ── Context menus ──
  const handleCueContext = useCallback((e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    setSelectedIdx(idx);
    show(e, [
      { label: "edit text", rune: "ᛏ", action: () => handleCueDoubleClick(idx) },
      { label: "edit start time", rune: "ᚷ", action: () => openTimeEdit(idx, "start") },
      { label: "edit end time", rune: "ᚷ", action: () => openTimeEdit(idx, "end") },
      { label: "", rune: "", action: () => {}, divider: true },
      { label: "split cue", rune: "ᛊ", action: handleSplitCue },
      { label: "merge with next", rune: "ᛇ", action: handleMergeCue },
      { label: "delete cue", rune: "ᚨ", action: handleDeleteCue },
    ]);
  }, [show, handleCueDoubleClick, openTimeEdit, handleSplitCue, handleMergeCue, handleDeleteCue]);

  const handleToolbarContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "save (Ctrl+S)", rune: "ᛏ", action: () => handleSave(filePath?.endsWith(".vtt") ?? false) },
      { label: "save as…", rune: "ᚷ", action: handleSaveAs },
      { label: "undo (Ctrl+Z)", rune: "ᚨ", action: undo },
      { label: "redo (Ctrl+Y)", rune: "ᚱ", action: redo },
      { label: "", rune: "", action: () => {}, divider: true },
      { label: `cues: ${cues.length}`, rune: "ᛊ", action: () => {} },
    ]);
  }, [show, handleSave, handleSaveAs, undo, redo, filePath, cues.length]);

  const videoUrl = videoPath ? convertFileSrc(videoPath) : null;

  return (
    <div className="transcript-editor">
      {/* ── Toolbar ── */}
      <div className="tc-toolbar" onContextMenu={handleToolbarContext}>
        <div className="tc-toolbar-left">
          <button className="tc-btn tc-btn-save" onClick={() => handleSave(filePath?.endsWith(".vtt") ?? false)} title="Save (Ctrl+S)">
            ᛏ save
          </button>
          <button className="tc-btn" onClick={handleSaveAs} title="Save as…">
            ᚷ save as
          </button>
          <span className="tc-toolbar-sep" />
          <button className="tc-btn" onClick={handleAddCue} title="Add cue" disabled={cues.length === 0}>
            + add
          </button>
          <button className="tc-btn" onClick={handleDeleteCue} title="Delete cue (Delete)" disabled={selectedIdx < 0}>
            − del
          </button>
          <button className="tc-btn" onClick={handleMergeCue} title="Merge with next cue" disabled={selectedIdx < 0 || selectedIdx >= cues.length - 1}>
            ⇣ merge
          </button>
          <button className="tc-btn" onClick={handleSplitCue} title="Split cue at midpoint" disabled={selectedIdx < 0}>
            ⇠ split
          </button>
          <span className="tc-toolbar-sep" />
          <button className="tc-btn" onClick={() => setShiftOpen((o) => !o)} title="Shift all timestamps">
            ↕ shift
          </button>
          <button className="tc-btn" onClick={() => setSearchOpen((o) => !o)} title="Search & Replace (Ctrl+F)">
            search
          </button>
          <span className="tc-toolbar-sep" />
          <button className="tc-btn" onClick={undo} title="Undo (Ctrl+Z)" disabled={historyIdx === 0}>
            ↩ undo
          </button>
          <button className="tc-btn" onClick={redo} title="Redo (Ctrl+Y)" disabled={historyIdx >= history.length - 1}>
            ↪ redo
          </button>
        </div>
        <div className="tc-toolbar-right">
          <span className="tc-cue-count">{cues.length} cue{cues.length !== 1 ? "s" : ""}</span>
          {filePath && (
            <span className="tc-file-name" title={filePath}>
              {filePath.split(/[/\\]/).pop()}
            </span>
          )}
        </div>
      </div>

      {/* ── Shift timestamps panel ── */}
      {shiftOpen && (
        <div className="tc-shift-panel">
          <label>Shift all cues by</label>
          <input
            className="input"
            type="number"
            step={0.1}
            value={shiftDelta}
            onChange={(e) => setShiftDelta(e.target.value)}
            style={{ width: 80, margin: "0 8px" }}
          />
          <span>seconds</span>
          <button className="btn" onClick={handleShiftApply} style={{ marginLeft: 8 }}>
            apply
          </button>
          <button className="btn" onClick={() => setShiftOpen(false)} style={{ marginLeft: 4 }}>
            cancel
          </button>
        </div>
      )}

      {/* ── Search & Replace panel ── */}
      {searchOpen && (
        <div className="tc-search-panel">
          <input
            className="input"
            placeholder="Find…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flex: 1, minWidth: 120 }}
            autoFocus
          />
          <input
            className="input"
            placeholder="Replace with…"
            value={searchReplace}
            onChange={(e) => setSearchReplace(e.target.value)}
            style={{ flex: 1, minWidth: 120 }}
          />
          <button
            className="btn"
            onClick={handleSearchReplace}
            disabled={!searchQuery}
          >
            replace all
          </button>
          <span className="tc-search-hits">
            {searchQuery ? cues.filter((c) => c.text.includes(searchQuery)).length + " hits" : ""}
          </span>
          <button className="btn" onClick={() => setSearchOpen(false)}>
            ✕
          </button>
        </div>
      )}

      {/* ── Video player ── */}
      {videoPath && videoUrl && (
        <div className="tc-video-section">
          <div className="tc-video-header" onClick={() => setVideoOpen((o) => !o)}>
            <span className="tc-video-arrow">{videoOpen ? "▾" : "▸"}</span>
            <span className="tc-video-label">video</span>
            <span className="tc-video-filename">{videoPath.split(/[/\\]/).pop()}</span>
            <button
              className="tc-video-clear"
              onClick={(e) => { e.stopPropagation(); onSetVideoPath(null); setVideoPlaying(false); }}
              title="Remove video"
            >
              ✕
            </button>
          </div>
          {videoOpen && (
            <div className="tc-video-body">
              <div className="tc-video-canvas">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className="tc-video-el"
                  onTimeUpdate={handleVideoTimeUpdate}
                  onLoadedMetadata={() => {
                    setVideoDuration(videoRef.current?.duration || 0);
                  }}
                  onEnded={() => setVideoPlaying(false)}
                  onPlay={() => setVideoPlaying(true)}
                  onPause={() => setVideoPlaying(false)}
                  playsInline
                />
                {activeCueIdx >= 0 && (
                  <div className="tc-video-sub-overlay">{cues[activeCueIdx]?.text}</div>
                )}
              </div>
              <div className="tc-video-transport">
                <button className="tc-transport-btn" onClick={toggleVideoPlay}>
                  {videoPlaying ? "■" : "▶"}
                </button>
                <span className="tc-transport-time">{fmtTime(videoTime)}</span>
                <span className="tc-transport-sep">/</span>
                <span className="tc-transport-time dim">{fmtTime(videoDuration)}</span>
                <input
                  type="range"
                  className="tc-transport-scrub"
                  min={0}
                  max={videoDuration || 0}
                  step={0.04}
                  value={videoTime}
                  onChange={(e) => seekVideo(parseFloat(e.target.value))}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Video load prompt (when no video, but cues are loaded) ── */}
      {!videoPath && cues.length > 0 && (
        <div className="tc-video-prompt">
          <button className="btn" onClick={handleLoadVideo}>
            ᛉ load video for sync playback
          </button>
        </div>
      )}

      {/* ── Cue list ── */}
      {cues.length > 0 ? (
        <div className="tc-cue-list" ref={cueListRef}>
          {cues.map((cue, idx) => {
            const isSelected = idx === selectedIdx;
            const isActive = idx === activeCueIdx && videoPath !== null;
            const isSearchHit = searchQuery && cue.text.toLowerCase().includes(searchQuery.toLowerCase());
            return (
              <div
                key={idx}
                ref={(el) => { cueRowRefs.current[idx] = el; }}
                className={`tc-cue-row${isActive ? " active" : ""}${isSelected ? " selected" : ""}${isSearchHit ? " search-hit" : ""}`}
                onClick={() => handleCueClick(idx)}
                onContextMenu={(e) => handleCueContext(e, idx)}
              >
                <span className="tc-cue-idx">{cue.index}</span>
                <div className="tc-cue-body">
                  <div className="tc-cue-timing">
                    {renderTiming(cue, idx)}
                    <span className="tc-cue-dur">
                      ({((cue.end - cue.start) * 1000).toFixed(0)}ms)
                    </span>
                  </div>
                  <div className="tc-cue-text">
                    {renderText(cue, idx)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="tc-empty">
          <span className="tc-empty-rune">ᛊ</span>
          <span className="tc-empty-text">No cues loaded. Load a subtitle file or transcribe one.</span>
        </div>
      )}
    </div>
  );
}
