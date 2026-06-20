import { useRef, useEffect, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import VideoPreview from "../components/forge/VideoPreview";
import SourceBrowser from "../components/forge/SourceBrowser";
import Timeline from "../components/forge/Timeline";
import PropertiesPanel from "../components/forge/PropertiesPanel";
import ConfirmDialog from "../components/forge/ConfirmDialog";
import { useForgeStore, isDragActive, endDrag } from "../store/forgeStore";
import "./ForgePage.css";

export default function ForgePage() {
  const project = useForgeStore((s) => s.project);
  const isExporting = useForgeStore((s) => s.isExporting);
  const exportProgress = useForgeStore((s) => s.exportProgress);
  const exportResultPath = useForgeStore((s) => s.exportResultPath);
  const exportError = useForgeStore((s) => s.exportError);
  const isRendering = useForgeStore((s) => s.isRendering);
  const renderProgress = useForgeStore((s) => s.renderProgress);
  const renderResultPath = useForgeStore((s) => s.renderResultPath);
  const undo = useForgeStore((s) => s.undo);
  const redo = useForgeStore((s) => s.redo);
  const splitClipAtPlayhead = useForgeStore((s) => s.splitClipAtPlayhead);
  const deleteClip = useForgeStore((s) => s.deleteClip);
  const rippleDeleteClip = useForgeStore((s) => s.rippleDeleteClip);
  const setPlayhead = useForgeStore((s) => s.setPlayhead);
  const saveProject = useForgeStore((s) => s.saveProject);
  const loadProject = useForgeStore((s) => s.loadProject);
  const loadProjectFromPath = useForgeStore((s) => s.loadProjectFromPath);
  const resetProject = useForgeStore((s) => s.resetProject);
  const setExporting = useForgeStore((s) => s.setExporting);
  const setExportProgress = useForgeStore((s) => s.setExportProgress);
  const setExportResultPath = useForgeStore((s) => s.setExportResultPath);
  const setExportError = useForgeStore((s) => s.setExportError);
  const setRendering = useForgeStore((s) => s.setRendering);
  const setRenderProgress = useForgeStore((s) => s.setRenderProgress);
  const setRenderResultPath = useForgeStore((s) => s.setRenderResultPath);
  const updateClip = useForgeStore((s) => s.updateClip);
  const importMediaFiles = useForgeStore((s) => s.importMediaFiles);
  const addToLibrary = useForgeStore((s) => s.addToLibrary);
  const addClipToVideo = useForgeStore((s) => s.addClipToVideo);
  const addClipToAudio = useForgeStore((s) => s.addClipToAudio);
  const clipVersion = useForgeStore((s) => s.clipVersion);
  const isModified = useForgeStore((s) => s.isModified);
  const currentFilePath = useForgeStore((s) => s.currentFilePath);
  const recentFiles = useForgeStore((s) => s.recentFiles);

  const [previewHeight, setPreviewHeight] = useState(360);
  const [resizing, setResizing] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const [showExportOptions, setShowExportOptions] = useState(false);
  const [exportFormat, setExportFormat] = useState<"mp4" | "mkv">("mp4");
  const [exportQuality, setExportQuality] = useState<"high" | "medium" | "fast">("medium");
  const [exportResolution, setExportResolution] = useState<"source" | "1080p" | "720p">("source");
  const [exportDest, setExportDest] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);

  const selectedClip =
    project.videoTrack.clips.find((c) => c.selected) ||
    project.audioTrack.clips.find((c) => c.selected);

  const selectedTrack = project.videoTrack.clips.some((c) => c.selected)
    ? ("video" as const)
    : ("audio" as const);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "z" && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (e.key === "z" && e.ctrlKey) {
        e.preventDefault();
        undo();
      } else if (e.key === "y" && e.ctrlKey) {
        e.preventDefault();
        redo();
      } else if (e.key === "s" && e.ctrlKey) {
        e.preventDefault();
        saveProject();
      } else if (e.key === "s" && !e.ctrlKey) {
        e.preventDefault();
        splitClipAtPlayhead();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedClip) {
          e.preventDefault();
          if (e.shiftKey) {
            rippleDeleteClip(selectedClip.id, selectedTrack);
          } else {
            deleteClip(selectedClip.id, selectedTrack);
          }
        }
      } else if (e.key === " " && !e.ctrlKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("forge-toggle-play"));
      } else if (e.key === "ArrowLeft") {
        const step = e.shiftKey ? project.fps : 1 / (project.fps || 30);
        setPlayhead(Math.max(0, project.playheadTime - step));
      } else if (e.key === "ArrowRight") {
        const step = e.shiftKey ? project.fps : 1 / (project.fps || 30);
        setPlayhead(project.playheadTime + step);
      } else if (e.key === "Home") {
        e.preventDefault();
        setPlayhead(0);
      } else if (e.key === "End") {
        e.preventDefault();
        const allClips = [...project.videoTrack.clips, ...project.audioTrack.clips];
        const maxEnd = allClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
        setPlayhead(maxEnd);
      } else if (e.key === "i" && selectedClip) {
        const ph = project.playheadTime;
        const clipOffset = ph - selectedClip.startTime;
        const sourceT = selectedClip.sourceStart + clipOffset * selectedClip.speed;
        if (sourceT > selectedClip.sourceStart && sourceT < selectedClip.sourceEnd) {
          updateClip(selectedClip.id, { sourceStart: sourceT }, selectedTrack);
        }
      } else if (e.key === "o" && selectedClip) {
        const ph = project.playheadTime;
        const clipOffset = ph - selectedClip.startTime;
        const sourceT = selectedClip.sourceStart + clipOffset * selectedClip.speed;
        if (sourceT > selectedClip.sourceStart && sourceT < selectedClip.sourceEnd) {
          updateClip(selectedClip.id, { sourceEnd: sourceT }, selectedTrack);
        }
      }
    },
    [undo, redo, saveProject, splitClipAtPlayhead, deleteClip, rippleDeleteClip, selectedClip, selectedTrack, setPlayhead, updateClip, project]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Window-level drag-drop: add files to source library
  useEffect(() => {
    let unlistenDrop: (() => void) | null = null;
    (async () => {
      unlistenDrop = await listen<{ paths: string[] }>("tauri://drag-drop", async (e) => {
        for (const path of e.payload.paths) {
          if (path.toLowerCase().endsWith(".galdr")) {
            await loadProjectFromPath(path);
            continue;
          }
          try {
            const info = await invoke<{ duration: number; width?: number; height?: number }>("get_media_info", { path });
            const name = path.split(/[/\\]/).pop() || path;
            addToLibrary({
              id: crypto.randomUUID(),
              name,
              path,
              duration: (info as any).duration || 0,
              width: (info as any).width,
              height: (info as any).height,
            });
          } catch {
            const name = path.split(/[/\\]/).pop() || path;
            addToLibrary({ id: crypto.randomUUID(), name, path, duration: 0 });
          }
        }
      });
    })();
    return () => { unlistenDrop?.(); };
  }, [addToLibrary, loadProjectFromPath]);

  // Update window title with project name
  useEffect(() => {
    const name = currentFilePath
      ? currentFilePath.split(/[/\\]/).pop() || "Untitled"
      : "Forge";
    const dot = isModified ? " •" : "";
    document.title = `${name}${dot} - forge - Galdr`;
  }, [currentFilePath, isModified]);

  // Custom pointer-based drag from SourceBrowser to Timeline
  useEffect(() => {
    let ghost: HTMLElement | null = null;
    let cleanTracks = () => {
      document.querySelectorAll("[data-track]").forEach((el) => el.classList.remove("drag-over"));
    };

    const onMove = (e: PointerEvent) => {
      if (!isDragActive()) return;
      if (!ghost) {
        ghost = document.createElement("div");
        ghost.className = "forge-drag-ghost";
        document.body.appendChild(ghost);
      }
      ghost.style.left = `${e.clientX + 14}px`;
      ghost.style.top = `${e.clientY + 14}px`;
      ghost.textContent = "add clip";

      ghost.style.display = "none";
      const el = document.elementFromPoint(e.clientX, e.clientY);
      ghost.style.display = "";

      cleanTracks();
      const trackEl = el?.closest("[data-track]");
      if (trackEl) trackEl.classList.add("drag-over");
    };

    const onUp = (e: PointerEvent) => {
      if (!isDragActive()) return;
      const payload = endDrag();
      cleanTracks();
      if (ghost) { ghost.remove(); ghost = null; }

      if (!payload) return;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const trackEl = el?.closest("[data-track]");
      if (!trackEl) return;

      const track = trackEl.getAttribute("data-track") as "video" | "audio";

      const ruler = document.querySelector(".forge-ruler");
      const scrollContainer = document.querySelector(".forge-timeline-body");
      if (!ruler) return;

      const rulerRect = ruler.getBoundingClientRect();
      const scrollLeft = scrollContainer?.scrollLeft || 0;
      const zoom = useForgeStore.getState().project.zoomLevel;
      const px = e.clientX - rulerRect.left + scrollLeft - 16;
      const time = Math.max(0, px / zoom);

      const addFn = track === "video" ? addClipToVideo : addClipToAudio;
      addFn({
        id: crypto.randomUUID(),
        name: payload.name,
        sourcePath: payload.path,
        startTime: time,
        duration: payload.duration,
        sourceStart: 0,
        sourceEnd: payload.duration,
        speed: 1,
        selected: false,
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      cleanTracks();
      if (ghost) { ghost.remove(); }
    };
  }, [addClipToVideo, addClipToAudio]);

  // Real-time Discord RPC updates when timeline changes
  useEffect(() => {
    const vclips = project.videoTrack.clips.length;
    const aclips = project.audioTrack.clips.length;
    const totalDur = [...project.videoTrack.clips, ...project.audioTrack.clips]
      .reduce((s, c) => s + c.duration, 0);
    invoke("update_forge_presence", { clips: vclips + aclips, durationSecs: totalDur }).catch(() => {});
  }, [clipVersion, project.videoTrack.clips, project.audioTrack.clips]);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const el = previewRef.current;
    if (!el) return;
    const startY = e.clientY;
    const startHeight = el.offsetHeight;

    setResizing(true);

    const onMove = (moveE: PointerEvent) => {
      const delta = moveE.clientY - startY;
      setPreviewHeight(Math.max(140, Math.min(600, startHeight + delta)));
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const handleChooseDest = useCallback(async () => {
    try {
      const filters = exportFormat === "mp4"
        ? [{ name: "MP4 Video", extensions: ["mp4"] }]
        : [{ name: "MKV Video", extensions: ["mkv"] }];
      const path = await save({
        filters,
        defaultPath: `timeline_export.${exportFormat}`,
      });
      if (!path) return;
      setExportDest(path);
      setExportError(null);
    } catch {
      // dialog dismissed
    }
  }, [exportFormat, setExportError]);

  const handleStartExport = useCallback(async () => {
    if (!exportDest) return;
    setShowExportOptions(false);
    setExporting(true);
    setExportProgress(0);
    setExportResultPath(null);
    setExportError(null);
    const unlisten = await listen<{ progress: number }>("forge-export-progress", (e) => {
      setExportProgress(e.payload.progress);
    });

    try {
      const result = await invoke<string>("export_timeline", {
        project: {
          fps: project.fps,
          width: project.width,
          height: project.height,
          videoTrack: project.videoTrack,
          audioTrack: project.audioTrack,
          zoomLevel: project.zoomLevel,
        },
        options: {
          output_path: exportDest,
          format: exportFormat,
          quality: exportQuality,
          resolution: exportResolution,
        },
      });

      unlisten();
      setExporting(false);
      setExportProgress(1);
      setExportDest(null);
      setExportResultPath(result);
    } catch (err: any) {
      console.error("Export failed:", err);
      unlisten();
      setExporting(false);
      setExportError(err?.toString() || "Export failed");
    }
  }, [exportDest, project, exportFormat, exportQuality, exportResolution, setExporting, setExportProgress, setExportResultPath, setExportError]);

  const handleCancelExport = useCallback(async () => {
    try {
      await invoke("cancel_forge_export");
    } catch {
      // ignore
    }
    setExporting(false);
    setExportError("Export cancelled");
    setExportDest(null);
  }, [setExporting, setExportError]);

  const handleRenderPreview = useCallback(async () => {
    setShowExportOptions(false);
    setRendering(true);
    setRenderProgress(0);
    setRenderResultPath(null);
    try {
      const unlisten = await listen<{ progress: number }>("forge-render-progress", (e) => {
        setRenderProgress(e.payload.progress);
      });

      const result = await invoke<string>("pre_render_timeline", {
        project: {
          fps: project.fps,
          width: project.width,
          height: project.height,
          videoTrack: project.videoTrack,
          audioTrack: project.audioTrack,
          zoomLevel: project.zoomLevel,
        },
      });

      unlisten();
      setRendering(false);
      setRenderProgress(1);
      setRenderResultPath(result);
    } catch (err: any) {
      console.error("Render failed:", err);
      setRendering(false);
      setRenderResultPath(null);
    }
  }, [project, setRendering, setRenderProgress, setRenderResultPath]);

  const isBusy = isExporting || isRendering;

  return (
    <div className="forge-page">
      <div className="forge-bottom-bar">
        <span className="forge-bottom-label">
          {isModified && <span className="forge-unsaved-dot">•</span>}
          ᚲ forge
        </span>
        <span className="forge-bottom-info">
          {currentFilePath
            ? currentFilePath.split(/[/\\]/).pop()
            : `${project.videoTrack.clips.length} clips · ${
                Math.round(
                  project.videoTrack.clips.reduce((s, c) => s + c.duration, 0) * 10
                ) / 10
              }s`}
        </span>
        <div className="forge-bottom-spacer" />
        <button className="forge-btn" onClick={saveProject} title="Save project (Ctrl+S)">
          {isModified ? "ᛟ save*" : currentFilePath ? "ᛟ save" : "ᛟ save as..."}
        </button>
        <div className="forge-load-wrapper">
          <button className="forge-btn" onClick={loadProject} title="Load project">
            ᚨ load
          </button>
          {recentFiles.length > 0 && (
            <button className="forge-btn forge-recent-toggle" onClick={() => setShowRecent(!showRecent)}>
              ▾
            </button>
          )}
          {showRecent && (
            <div className="forge-recent-popup">
              <span className="forge-recent-header">recent</span>
              {recentFiles.map((f) => (
                <button
                  key={f.path}
                  className="forge-recent-item"
                  onClick={() => { loadProjectFromPath(f.path); setShowRecent(false); }}
                >
                  <span className="forge-recent-name">{f.name}</span>
                  <span className="forge-recent-path">{f.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="forge-btn" onClick={resetProject} title="New project">
          ᚷ new
        </button>
        <button className="forge-btn" onClick={importMediaFiles} title="Import media">
          + media
        </button>
        <button
          className="forge-btn forge-btn-cast"
          onClick={() => setShowExportOptions(true)}
          disabled={isBusy || project.videoTrack.clips.length === 0}
        >
          {isExporting
            ? `exporting ${Math.round(exportProgress * 100)}%`
            : isRendering
              ? `rendering ${Math.round(renderProgress * 100)}%`
              : "ᚲ export"}
        </button>
      </div>

      <div className="forge-top">
        <SourceBrowser />
        <div className="forge-center">
          <div className="forge-preview" ref={previewRef} style={{ height: previewHeight }}>
            <VideoPreview />
          </div>
          <PropertiesPanel />
        </div>
      </div>

      <div
        className={`forge-resize-handle${resizing ? " active" : ""}`}
        onPointerDown={handleResizeStart}
      >
        <div className="forge-resize-handle-line" />
      </div>

      <div className="forge-bottom">
        <Timeline />
      </div>

      {/* ── Export Options Modal ── */}
      {showExportOptions && !isBusy && (
        <div className="forge-export-overlay">
          <div className="forge-export-options">
            <span className="forge-export-rune">ᚲ</span>
            <span className="forge-export-title">export options</span>

            <div className="forge-export-field">
              <label>format</label>
              <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as any)}>
                <option value="mp4">MP4</option>
                <option value="mkv">MKV</option>
              </select>
            </div>

            <div className="forge-export-field">
              <label>quality</label>
              <select value={exportQuality} onChange={(e) => setExportQuality(e.target.value as any)}>
                <option value="high">High (slow)</option>
                <option value="medium">Medium</option>
                <option value="fast">Fast</option>
              </select>
            </div>

            <div className="forge-export-field">
              <label>resolution</label>
              <select value={exportResolution} onChange={(e) => setExportResolution(e.target.value as any)}>
                <option value="source">Source</option>
                <option value="1080p">1080p</option>
                <option value="720p">720p</option>
              </select>
            </div>

            {exportDest && (
              <div className="forge-export-field">
                <label>output path</label>
                <span className="forge-export-chosen-path" title={exportDest}>{exportDest}</span>
              </div>
            )}

            <div className="forge-export-actions">
              <button className="forge-btn" onClick={() => { setShowExportOptions(false); setExportDest(null); }}>cancel</button>
              <button className="forge-btn" onClick={handleRenderPreview} title="Fast preview render to temp file">
                ᚲ render preview
              </button>
              {exportDest ? (
                <button className="forge-btn forge-btn-cast" onClick={handleStartExport}>
                  ᚲ render
                </button>
              ) : (
                <button className="forge-btn forge-btn-cast" onClick={handleChooseDest}>
                  ᚲ choose destination...
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Export Progress Modal ── */}
      {isExporting && (
        <div className="forge-export-overlay">
          <div className="forge-export-modal">
            <span className="forge-export-rune forge-export-rune-spin">ᚲ</span>
            <span className="forge-export-title">exporting timeline...</span>
            <div className="progress-bar-container">
              <div
                className="progress-bar"
                style={{ width: `${Math.round(exportProgress * 100)}%` }}
              />
            </div>
            <span className="progress-text">{Math.round(exportProgress * 100)}%</span>
            <button className="forge-btn forge-export-cancel-btn" onClick={handleCancelExport}>
              cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Render Progress Modal ── */}
      {isRendering && (
        <div className="forge-export-overlay">
          <div className="forge-export-modal">
            <span className="forge-export-rune forge-export-rune-spin">ᚲ</span>
            <span className="forge-export-title">rendering preview...</span>
            <div className="progress-bar-container">
              <div
                className="progress-bar"
                style={{ width: `${Math.round(renderProgress * 100)}%` }}
              />
            </div>
            <span className="progress-text">{Math.round(renderProgress * 100)}%</span>
          </div>
        </div>
      )}

      {/* ── Export Complete Modal ── */}
      {exportResultPath && !isExporting && (
        <div className="forge-export-overlay">
          <div className="forge-export-modal">
            <span className="forge-export-rune">✓</span>
            <span className="forge-export-title">export complete</span>
            <span className="forge-export-path" title={exportResultPath}>
              {exportResultPath}
            </span>
            <div className="forge-export-actions">
              <button className="forge-btn" onClick={() => setExportResultPath(null)}>close</button>
              <button className="forge-btn forge-btn-cast" onClick={() => revealItemInDir(exportResultPath)}>
                open in explorer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Export Error Modal ── */}
      {exportError && !isExporting && (
        <div className="forge-export-overlay">
          <div className="forge-export-modal">
            <span className="forge-export-rune forge-export-rune-error">✕</span>
            <span className="forge-export-title">export failed</span>
            <span className="forge-export-error-text">{exportError}</span>
            <div className="forge-export-actions">
              <button className="forge-btn forge-btn-cast" onClick={() => setExportError(null)}>close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Render Complete Modal ── */}
      {renderResultPath && !isRendering && (
        <div className="forge-export-overlay">
          <div className="forge-export-modal">
            <span className="forge-export-rune">✓</span>
            <span className="forge-export-title">preview ready</span>
            <span className="forge-export-path" title={renderResultPath}>
              {renderResultPath}
            </span>
            <div className="forge-export-actions">
              <button className="forge-btn" onClick={() => setRenderResultPath(null)}>close</button>
              <button className="forge-btn forge-btn-cast" onClick={() => revealItemInDir(renderResultPath)}>
                open in explorer
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}
