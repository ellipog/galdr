import { useCallback } from "react";
import { useForgeStore, beginDrag } from "../../store/forgeStore";
import { useContextMenu } from "../ContextMenu";
import { invoke } from "@tauri-apps/api/core";

export default function SourceBrowser() {
  const mediaLibrary = useForgeStore((s) => s.mediaLibrary);
  const importMediaFiles = useForgeStore((s) => s.importMediaFiles);
  const removeFromLibrary = useForgeStore((s) => s.removeFromLibrary);
  const addClipToVideo = useForgeStore((s) => s.addClipToVideo);
  const addClipToAudio = useForgeStore((s) => s.addClipToAudio);
  const { show } = useContextMenu();

  const formatDur = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  const handlePointerDown = (e: React.PointerEvent, item: typeof mediaLibrary[0]) => {
    e.preventDefault();
    beginDrag({ id: item.id, path: item.path, duration: item.duration, name: item.name });
  };

  const handleItemContext = useCallback((e: React.MouseEvent, item: typeof mediaLibrary[0]) => {
    e.stopPropagation();
    const baseClip = {
      id: crypto.randomUUID(),
      name: item.name,
      sourcePath: item.path,
      startTime: 0,
      duration: item.duration,
      sourceStart: 0,
      sourceEnd: item.duration,
      speed: 1,
      selected: false,
    };
    show(e, [
      { label: "add to V1", rune: "ᛏ", action: () => addClipToVideo({ ...baseClip, id: crypto.randomUUID() }) },
      { label: "add to A1", rune: "ᚷ", action: () => addClipToAudio({ ...baseClip, id: crypto.randomUUID() }) },
      { label: "", rune: "", action: () => {}, divider: true },
      { label: "remove", rune: "ᚨ", action: () => removeFromLibrary(item.id) },
      { label: "copy path", rune: "ᛏ", action: () => navigator.clipboard.writeText(item.path) },
      { label: "reveal in folder", rune: "ᚠ", action: () => invoke("reveal_in_folder", { path: item.path }).catch(() => {}) },
    ]);
  }, [show, addClipToVideo, addClipToAudio, removeFromLibrary]);

  const handlePanelHeaderContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "import media", rune: "ᚨ", action: importMediaFiles },
      ...(mediaLibrary.length > 0 ? [{ label: "clear library", rune: "ᚷ", action: () => mediaLibrary.forEach((item) => removeFromLibrary(item.id)) }] : []),
    ]);
  }, [show, importMediaFiles, mediaLibrary, removeFromLibrary]);

  const handleEmptyContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "import media", rune: "ᚨ", action: importMediaFiles },
      { label: "paste path", rune: "ᚷ", action: async () => {
        const text = await navigator.clipboard.readText();
        if (!text) return;
        try {
          const info = await invoke<{ duration: number; width?: number; height?: number }>("get_media_info", { path: text });
          const name = text.split(/[/\\]/).pop() || text;
          useForgeStore.getState().addToLibrary({
            id: crypto.randomUUID(), name, path: text,
            duration: (info as any).duration || 0, width: (info as any).width, height: (info as any).height,
          });
        } catch {
          useForgeStore.getState().addToLibrary({
            id: crypto.randomUUID(), name: text.split(/[/\\]/).pop() || text, path: text, duration: 0,
          });
        }
      }},
    ]);
  }, [show, importMediaFiles]);

  return (
    <div className="forge-source">
      <div className="forge-panel-header" onContextMenu={handlePanelHeaderContext}>
        <span className="forge-panel-title">ᚨ source</span>
        <button className="forge-source-import-btn" onClick={importMediaFiles}>
          + import
        </button>
      </div>
      <div className="forge-source-list">
        {mediaLibrary.length === 0 && (
          <div className="forge-source-empty" onContextMenu={handleEmptyContext}>
            <span className="forge-source-empty-text">no media imported</span>
            <span className="forge-source-empty-hint">click + import or drag files in</span>
          </div>
        )}
        {mediaLibrary.map((item) => (
          <div
            key={item.id}
            className="forge-source-item"
            onPointerDown={(e) => handlePointerDown(e, item)}
            onContextMenu={(e) => handleItemContext(e, item)}
          >
            <div className="forge-source-item-info">
              <span className="forge-source-item-name">{item.name}</span>
              <span className="forge-source-item-meta">
                {formatDur(item.duration)}
                {item.width && item.height ? `  ${item.width}x${item.height}` : ""}
              </span>
            </div>
            <button
              className="forge-source-item-remove"
              onClick={() => removeFromLibrary(item.id)}
              title="Remove from library"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}