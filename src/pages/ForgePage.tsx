import { useEffect, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import VideoPreview from "../components/forge/VideoPreview";
import SourceBrowser from "../components/forge/SourceBrowser";
import Timeline from "../components/forge/Timeline";
import PropertiesPanel from "../components/forge/PropertiesPanel";
import { useForgeStore, isDragActive, endDrag } from "../store/forgeStore";
import { useGaldrStore } from "../store";
import "./ForgePage.css";

export default function ForgePage() {
  const project = useForgeStore((s) => s.project);
  const isExporting = useForgeStore((s) => s.isExporting);
  const exportProgress = useForgeStore((s) => s.exportProgress);
  const undo = useForgeStore((s) => s.undo);
  const redo = useForgeStore((s) => s.redo);
  const splitClipAtPlayhead = useForgeStore((s) => s.splitClipAtPlayhead);
  const deleteClip = useForgeStore((s) => s.deleteClip);
  const rippleDeleteClip = useForgeStore((s) => s.rippleDeleteClip);
  const setPlayhead = useForgeStore((s) => s.setPlayhead);
  const saveProject = useForgeStore((s) => s.saveProject);
  const loadProject = useForgeStore((s) => s.loadProject);
  const resetProject = useForgeStore((s) => s.resetProject);
  const setExporting = useForgeStore((s) => s.setExporting);
  const setExportProgress = useForgeStore((s) => s.setExportProgress);
  const updateClip = useForgeStore((s) => s.updateClip);
  const importMediaFiles = useForgeStore((s) => s.importMediaFiles);
  const addToLibrary = useForgeStore((s) => s.addToLibrary);
  const addClipToVideo = useForgeStore((s) => s.addClipToVideo);
  const addClipToAudio = useForgeStore((s) => s.addClipToAudio);

  const [previewHeight, setPreviewHeight] = useState(360);
  const [resizing, setResizing] = useState(false);

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
    [undo, redo, splitClipAtPlayhead, deleteClip, rippleDeleteClip, selectedClip, selectedTrack, setPlayhead, updateClip, project]
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
  }, [addToLibrary]);

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
      // PADDING only (labels are in a separate fixed column, not in the scrollable area)
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

  // Preview resize handlers
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setResizing(true);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const pageEl = document.querySelector(".forge-page");
    if (!pageEl) return;
    const pageRect = pageEl.getBoundingClientRect();

    const onMove = (e: PointerEvent) => {
      const h = Math.max(140, Math.min(600, e.clientY - pageRect.top));
      setPreviewHeight(h);
    };
    const onUp = () => setResizing(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizing]);

  const handleCast = useCallback(async () => {
    try {
      setExporting(true);
      setExportProgress(0);
      const unlisten = await listen<{ progress: number }>("forge-export-progress", (e) => {
        setExportProgress(e.payload.progress);
      });

      const outputDir = useGaldrStore.getState().outputDir || "~/Desktop/galdr-output";

      await invoke("export_timeline", {
        project: {
          fps: project.fps,
          width: project.width,
          height: project.height,
          video_track: project.videoTrack,
          audio_track: project.audioTrack,
          zoom_level: project.zoomLevel,
        },
        outputDir,
      });

      unlisten();
      setExporting(false);
      setExportProgress(1);
    } catch (err) {
      console.error("Export failed:", err);
      setExporting(false);
    }
  }, [project, setExporting, setExportProgress]);

  return (
    <div className="forge-page">
      <div className="forge-top" style={{ flex: "none" }}>
        <SourceBrowser />
        <div className="forge-center">
          <div className="forge-preview" style={{ height: previewHeight }}>
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
        <div className="forge-bottom-bar">
          <span className="forge-bottom-label">ᚲ forge</span>
          <span className="forge-bottom-info">
            {project.videoTrack.clips.length} clips ·{" "}
            {Math.round(
              project.videoTrack.clips.reduce((s, c) => s + c.duration, 0) * 10
            ) / 10}s
          </span>
          <div className="forge-bottom-spacer" />
          <button className="forge-btn" onClick={saveProject} title="Save project (Ctrl+S)">
            ᛟ save
          </button>
          <button className="forge-btn" onClick={loadProject} title="Load project">
            ᚨ load
          </button>
          <button className="forge-btn" onClick={resetProject} title="New project">
            ᚷ new
          </button>
          <button className="forge-btn" onClick={importMediaFiles} title="Import media">
            + media
          </button>
          <button
            className="forge-btn forge-btn-cast"
            onClick={handleCast}
            disabled={isExporting || project.videoTrack.clips.length === 0}
          >
            {isExporting ? `ᚲ casting ${Math.round(exportProgress * 100)}%` : "ᚲ cast"}
          </button>
        </div>
        <Timeline />
      </div>

      {isExporting && (
        <div className="forge-export-overlay">
          <div className="forge-export-modal">
            <span className="forge-export-rune">ᚲ</span>
            <span className="forge-export-title">casting timeline...</span>
            <div className="progress-bar-container">
              <div
                className="progress-bar"
                style={{ width: `${Math.round(exportProgress * 100)}%` }}
              />
            </div>
            <span className="progress-text">{Math.round(exportProgress * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}