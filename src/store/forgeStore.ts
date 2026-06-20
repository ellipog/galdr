import { create } from "zustand";
import type { ForgeClip, ForgeTrack, ForgeProjectData, MediaLibraryItem, GaldrProjectFile, RecentFileEntry } from "../types";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";

// Module-level drag state — bypasses React and HTML5 DnD entirely.
// Source items store payload via onPointerDown. ForgePage reads it
// via pointermove/pointerup with elementFromPoint() for hit detection.
let _dragPayload: { id: string; path: string; duration: number; name: string } | null = null;
let _dragActive = false;
export function beginDrag(payload: typeof _dragPayload) {
  _dragPayload = payload;
  _dragActive = true;
}
/** Returns the payload and clears drag state. */
export function endDrag(): typeof _dragPayload {
  const p = _dragPayload;
  _dragPayload = null;
  _dragActive = false;
  return p;
}
export function isDragActive() { return _dragActive; }

let _confirmResolve: ((value: boolean) => void) | null = null;

const MAX_UNDO = 50;

function emptyTrack(height: number): ForgeTrack {
  return { clips: [], height, muted: false, locked: false };
}

function createEmptyProject(): ForgeProjectData {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    videoTrack: emptyTrack(60),
    audioTrack: emptyTrack(40),
    markers: [],
    playheadTime: 0,
    zoomLevel: 100,
  };
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function mkSplit(original: ForgeClip, newStart: number, newEnd: number): ForgeClip {
  const newDuration = newEnd - newStart;
  const newSourceStart = original.sourceStart + (newStart - original.startTime) * original.speed;
  const newSourceEnd = original.sourceStart + (newEnd - original.startTime) * original.speed;
  return {
    ...original,
    id: crypto.randomUUID(),
    startTime: newStart,
    duration: newDuration,
    sourceStart: newSourceStart,
    sourceEnd: newSourceEnd,
    selected: false,
  };
}

function resolveTrackOverlap(clips: ForgeClip[], placed: ForgeClip): ForgeClip[] {
  const pStart = placed.startTime;
  const pEnd = placed.startTime + placed.duration;
  const result: ForgeClip[] = [];

  for (const c of clips) {
    if (c.id === placed.id) continue;

    const cStart = c.startTime;
    const cEnd = c.startTime + c.duration;

    if (pEnd <= cStart || pStart >= cEnd) {
      result.push(c);
      continue;
    }

    if (pStart <= cStart && pEnd >= cEnd) {
      continue;
    }

    if (pStart > cStart && pEnd < cEnd) {
      result.push(mkSplit(c, cStart, pStart));
      result.push(mkSplit(c, pEnd, cEnd));
      continue;
    }

    if (pStart > cStart) {
      result.push(mkSplit(c, cStart, pStart));
      continue;
    }

    if (pEnd < cEnd) {
      result.push(mkSplit(c, pEnd, cEnd));
      continue;
    }
  }

  result.push(placed);
  return result.sort((a, b) => a.startTime - b.startTime);
}

interface ForgeState {
  project: ForgeProjectData;
  mediaLibrary: MediaLibraryItem[];
  undoStack: ForgeProjectData[];
  redoStack: ForgeProjectData[];
  isExporting: boolean;
  exportProgress: number;
  exportResultPath: string | null;
  exportError: string | null;
  isRendering: boolean;
  renderProgress: number;
  renderResultPath: string | null;
  snapEnabled: boolean;
  clipVersion: number;
  dragPayload: { id: string; path: string; duration: number; name: string } | null;
  currentFilePath: string | null;
  isModified: boolean;
  recentFiles: RecentFileEntry[];
  confirmDialog: { message: string; title: string } | null;

  pushUndo: () => void;
  undo: () => void;
  redo: () => void;

  addClipToVideo: (clip: ForgeClip) => void;
  addClipToAudio: (clip: ForgeClip) => void;
  moveClip: (clipId: string, newStartTime: number, track: "video" | "audio") => void;
  trimClip: (clipId: string, sourceStart: number, sourceEnd: number, track: "video" | "audio") => void;
  splitClipAtPlayhead: () => void;
  deleteClip: (clipId: string, track: "video" | "audio") => void;
  rippleDeleteClip: (clipId: string, track: "video" | "audio") => void;
  selectClip: (clipId: string | null, track: "video" | "audio") => void;
  updateClip: (clipId: string, changes: Partial<ForgeClip>, track: "video" | "audio") => void;

  setPlayhead: (time: number) => void;
  setZoom: (level: number) => void;
  addMarker: (time: number, label?: string) => void;
  removeMarker: (time: number) => void;

  addToLibrary: (item: MediaLibraryItem) => void;
  removeFromLibrary: (id: string) => void;

  importMediaFiles: () => Promise<void>;
  saveProject: () => Promise<void>;
  loadProject: () => Promise<void>;
  loadProjectFromPath: (path: string, opts?: { fromExternal?: boolean }) => Promise<void>;
  addRecentFile: (path: string) => void;
  loadRecentFiles: () => void;
  restoreFromRecovery: (project: ForgeProjectData, mediaLibrary: MediaLibraryItem[], filePath: string | null) => void;
  showConfirmDialog: (message: string, title: string) => Promise<boolean>;
  closeConfirmDialog: (result: boolean) => void;
  resetProject: () => Promise<void>;

  setExporting: (v: boolean) => void;
  setExportProgress: (v: number) => void;
  setExportResultPath: (v: string | null) => void;
  setExportError: (v: string | null) => void;
  setRendering: (v: boolean) => void;
  setRenderProgress: (v: number) => void;
  setRenderResultPath: (v: string | null) => void;
  setSnapEnabled: (v: boolean) => void;
  setDragPayload: (payload: { id: string; path: string; duration: number; name: string } | null) => void;
}

export const useForgeStore = create<ForgeState>((set, get) => ({
  project: createEmptyProject(),
  mediaLibrary: [],
  undoStack: [],
  redoStack: [],
  isExporting: false,
  exportProgress: 0,
  exportResultPath: null,
  exportError: null,
  isRendering: false,
  renderProgress: 0,
  renderResultPath: null,
  snapEnabled: true,
  clipVersion: 0,
  dragPayload: null,
  currentFilePath: null,
  isModified: false,
  recentFiles: [],
  confirmDialog: null,

  pushUndo: () => {
    const { project, undoStack } = get();
    const stack = [...undoStack, deepClone(project)];
    if (stack.length > MAX_UNDO) stack.shift();
    set({ undoStack: stack, redoStack: [], isModified: true });
  },

  undo: () => {
    const { project, undoStack, redoStack, clipVersion } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    set({
      project: deepClone(prev),
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, deepClone(project)],
      clipVersion: clipVersion + 1,
      isModified: true,
    });
  },

  redo: () => {
    const { project, undoStack, redoStack, clipVersion } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    set({
      project: deepClone(next),
      undoStack: [...undoStack, deepClone(project)],
      redoStack: redoStack.slice(0, -1),
      clipVersion: clipVersion + 1,
      isModified: true,
    });
  },

  addClipToVideo: (clip) => {
    get().pushUndo();
    const track = get().project.videoTrack;
    const newClips = resolveTrackOverlap(track.clips, clip);
    set({
      project: { ...get().project, videoTrack: { ...track, clips: newClips } },
      clipVersion: get().clipVersion + 1,
    });
  },

  addClipToAudio: (clip) => {
    get().pushUndo();
    const track = get().project.audioTrack;
    const newClips = resolveTrackOverlap(track.clips, clip);
    set({
      project: { ...get().project, audioTrack: { ...track, clips: newClips } },
      clipVersion: get().clipVersion + 1,
    });
  },

  moveClip: (clipId, newStartTime, trackKey) => {
    const track = get().project[trackKey === "video" ? "videoTrack" : "audioTrack"];
    const clip = track.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const moved = { ...clip, startTime: Math.max(0, newStartTime) };
    const others = track.clips.filter((c) => c.id !== clipId);
    const newClips = resolveTrackOverlap(others, moved);
    const trackKeyInner = trackKey === "video" ? "videoTrack" : "audioTrack";
    set({
      project: { ...get().project, [trackKeyInner]: { ...track, clips: newClips } },
      clipVersion: get().clipVersion + 1,
    });
  },

  trimClip: (clipId, sourceStart, sourceEnd, trackKey) => {
    const track = get().project[trackKey === "video" ? "videoTrack" : "audioTrack"];
    const found = track.clips.find((c) => c.id === clipId);
    if (!found) return;
    const ss = Math.max(0, sourceStart);
    const se = sourceEnd > ss ? sourceEnd : ss + 0.1;
    const updated = { ...found, sourceStart: ss, sourceEnd: se, duration: (se - ss) / found.speed };
    const others = track.clips.filter((c) => c.id !== clipId);
    const newClips = resolveTrackOverlap(others, updated);
    const trackKeyInner = trackKey === "video" ? "videoTrack" : "audioTrack";
    set({
      project: { ...get().project, [trackKeyInner]: { ...track, clips: newClips } },
      clipVersion: get().clipVersion + 1,
    });
  },

  splitClipAtPlayhead: () => {
    get().pushUndo();
    const { project } = get();
    const ph = project.playheadTime;

    const hasSelectedVideo = project.videoTrack.clips.some((c) => c.selected);
    const hasSelectedAudio = project.audioTrack.clips.some((c) => c.selected);
    const onlyTrack = hasSelectedVideo || hasSelectedAudio;

    let vClips = project.videoTrack.clips;
    let aClips = project.audioTrack.clips;
    let modified = false;

    for (const [trackKey, clips, setter] of [
      ["videoTrack", vClips, (arr: ForgeClip[]) => { vClips = arr; }] as const,
      ["audioTrack", aClips, (arr: ForgeClip[]) => { aClips = arr; }] as const,
    ]) {
      if (onlyTrack && !(trackKey === "videoTrack" ? hasSelectedVideo : hasSelectedAudio)) continue;

      const clip = clips.find(
        (c: ForgeClip) => ph >= c.startTime && ph < c.startTime + c.duration
      );
      if (!clip) continue;

      const splitOffset = ph - clip.startTime;
      const sourceOffset = clip.sourceStart + splitOffset * clip.speed;
      if (sourceOffset <= clip.sourceStart || sourceOffset >= clip.sourceEnd) continue;

      const rightClip: ForgeClip = {
        ...clip,
        id: crypto.randomUUID(),
        startTime: ph,
        duration: clip.duration - splitOffset,
        sourceStart: sourceOffset,
        selected: false,
      };
      const leftClip = { ...clip, duration: splitOffset, sourceEnd: sourceOffset, selected: false };
      setter(
        clips
          .filter((c: ForgeClip) => c.id !== clip.id)
          .concat([leftClip, rightClip])
          .sort((a: ForgeClip, b: ForgeClip) => a.startTime - b.startTime)
      );
      modified = true;
    }

    if (modified) {
      set({
        project: {
          ...project,
          videoTrack: { ...project.videoTrack, clips: vClips },
          audioTrack: { ...project.audioTrack, clips: aClips },
        },
        clipVersion: get().clipVersion + 1,
      });
    }
  },

  deleteClip: (clipId, trackKey) => {
    get().pushUndo();
    const track = get().project[trackKey === "video" ? "videoTrack" : "audioTrack"];
    const newClips = track.clips.filter((c) => c.id !== clipId);
    const trackKeyInner = trackKey === "video" ? "videoTrack" : "audioTrack";
    set({
      project: { ...get().project, [trackKeyInner]: { ...track, clips: newClips } },
      clipVersion: get().clipVersion + 1,
    });
  },

  rippleDeleteClip: (clipId, trackKey) => {
    get().pushUndo();
    const project = get().project;
    const track = project[trackKey === "video" ? "videoTrack" : "audioTrack"];
    const idx = track.clips.findIndex((c) => c.id === clipId);
    if (idx === -1) return;
    const removed = track.clips[idx];
    const gap = removed.duration;
    const newClips = track.clips
      .filter((c) => c.id !== clipId)
      .map((c, i) =>
        i >= idx ? { ...c, startTime: c.startTime - gap } : c
      );
    const trackKeyInner = trackKey === "video" ? "videoTrack" : "audioTrack";
    set({
      project: { ...project, [trackKeyInner]: { ...track, clips: newClips } },
      clipVersion: get().clipVersion + 1,
    });
  },

  selectClip: (clipId, trackKey) => {
    const project = get().project;
    const newVT = {
      ...project.videoTrack,
      clips: project.videoTrack.clips.map((c) => ({
        ...c,
        selected: trackKey === "video" && c.id === clipId,
      })),
    };
    const newAT = {
      ...project.audioTrack,
      clips: project.audioTrack.clips.map((c) => ({
        ...c,
        selected: trackKey === "audio" && c.id === clipId,
      })),
    };
    set({ project: { ...project, videoTrack: newVT, audioTrack: newAT } });
  },

  updateClip: (clipId, changes, trackKey) => {
    get().pushUndo();
    const track = get().project[trackKey === "video" ? "videoTrack" : "audioTrack"];
    const found = track.clips.find((c) => c.id === clipId);
    if (!found) return;
    const updated = { ...found, ...changes };
    if (changes.speed !== undefined || changes.sourceStart !== undefined || changes.sourceEnd !== undefined) {
      updated.duration = (updated.sourceEnd - updated.sourceStart) / updated.speed;
    }
    const timingChanged = changes.startTime !== undefined || changes.speed !== undefined ||
      changes.sourceStart !== undefined || changes.sourceEnd !== undefined;
    const others = track.clips.filter((c) => c.id !== clipId);
    const newClips = timingChanged ? resolveTrackOverlap(others, updated) : [...others, updated];
    const trackKeyInner = trackKey === "video" ? "videoTrack" : "audioTrack";
    set({
      project: { ...get().project, [trackKeyInner]: { ...track, clips: newClips } },
      clipVersion: get().clipVersion + 1,
    });
  },

  setPlayhead: (time) => set((s) => ({ project: { ...s.project, playheadTime: Math.max(0, time) } })),
  setZoom: (level) => set((s) => ({ project: { ...s.project, zoomLevel: Math.max(20, Math.min(500, level)) } })),

  addMarker: (time, label) => {
    const markers = [...get().project.markers, { time, label: label || "" }];
    markers.sort((a, b) => a.time - b.time);
    set((s) => ({ project: { ...s.project, markers }, isModified: true }));
  },

  removeMarker: (time) => {
    set((s) => ({
      project: {
        ...s.project,
        markers: s.project.markers.filter((m) => m.time !== time),
      },
      isModified: true,
    }));
  },

  addToLibrary: (item) => {
    set((s) => {
      if (s.mediaLibrary.some((x) => x.path === item.path)) return s;
      return { mediaLibrary: [...s.mediaLibrary, item], isModified: true };
    });
  },

  removeFromLibrary: (id) => {
    set((s) => ({ mediaLibrary: s.mediaLibrary.filter((x) => x.id !== id), isModified: true }));
  },

  importMediaFiles: async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: "Media", extensions: ["mp4", "mkv", "avi", "mov", "webm", "m4v", "flv", "ogv", "wmv", "mp3", "flac", "wav", "aac", "ogg", "opus", "png", "jpeg", "jpg", "webp", "gif"] },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        try {
          const info = await invoke<{ duration: number; width?: number; height?: number }>("get_media_info", { path });
          const name = path.split(/[/\\]/).pop() || path;
          get().addToLibrary({
            id: crypto.randomUUID(),
            name,
            path,
            duration: (info as any).duration || 0,
            width: (info as any).width,
            height: (info as any).height,
          });
        } catch {
          const name = path.split(/[/\\]/).pop() || path;
          get().addToLibrary({
            id: crypto.randomUUID(),
            name,
            path,
            duration: 0,
          });
        }
      }
    } catch {}
  },

  saveProject: async () => {
    try {
      const { project, mediaLibrary, currentFilePath } = get();
      const now = new Date().toISOString();

      let dest = currentFilePath;
      if (!dest) {
        dest = await save({
          filters: [{ name: "Galdr Project", extensions: ["galdr"] }],
          defaultPath: "untitled.galdr",
        });
        if (!dest) return;
      }

      let created = now;
      if (currentFilePath) {
        try {
          const raw = await invoke<string>("load_project_file", { path: currentFilePath });
          const existing: GaldrProjectFile = JSON.parse(raw);
          created = existing.created;
        } catch {}
      }

      const name = dest.split(/[/\\]/).pop() || "untitled";
      const file: GaldrProjectFile = {
        version: "1.0",
        type: "galdr-project",
        app: "forge",
        name,
        created,
        updated: now,
        data: deepClone(project),
        extensions: { mediaLibrary: deepClone(mediaLibrary) },
      };
      const content = JSON.stringify(file, null, 2);
      await invoke("save_project_file", { path: dest, content });
      set({ currentFilePath: dest, isModified: false });
      get().addRecentFile(dest);
      invoke("clear_forge_recovery").catch(() => {});
    } catch {}
  },

  loadProject: async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Galdr Project", extensions: ["galdr"] }],
      });
      if (!selected) return;
      await get().loadProjectFromPath(selected as string);
    } catch {}
  },

  loadProjectFromPath: async (path: string, opts?: { fromExternal?: boolean }) => {
    const fromExternal = opts?.fromExternal ?? false;
    if (get().isModified) {
      if (await get().showConfirmDialog("Save changes before opening another project?", "Unsaved Changes")) {
        await get().saveProject();
        if (get().isModified) return;
      }
    } else if (!fromExternal) {
      // Skip the confirm for an external double-click launch (nothing to lose),
      // but still ask when opening from within the app.
      if (!await get().showConfirmDialog("Open this project? Current work on this project will be discarded.", "Open Project")) return;
    }
    try {
      const raw = await invoke<string>("load_project_file", { path });
      const file: GaldrProjectFile = JSON.parse(raw);
      if (file.type !== "galdr-project") return;
      set({
        project: deepClone(file.data),
        mediaLibrary: deepClone((file.extensions?.mediaLibrary as MediaLibraryItem[]) || []),
        undoStack: [],
        redoStack: [],
        currentFilePath: path,
        isModified: false,
        clipVersion: get().clipVersion + 1,
      });
      get().addRecentFile(path);
      invoke("clear_forge_recovery").catch(() => {});
    } catch {}
  },

  addRecentFile: (path: string) => {
    const name = path.split(/[/\\]/).pop() || path;
    const entry: RecentFileEntry = { path, name, updated: new Date().toISOString() };
    const existing = get().recentFiles.filter((f) => f.path !== path);
    const updated = [entry, ...existing].slice(0, 5);
    set({ recentFiles: updated });
    try { localStorage.setItem("forge-recent-files", JSON.stringify(updated)); } catch {}
  },

  loadRecentFiles: () => {
    try {
      const raw = localStorage.getItem("forge-recent-files");
      if (raw) set({ recentFiles: JSON.parse(raw) });
    } catch {}
  },

  restoreFromRecovery: (project, mediaLibrary, filePath) => {
    set({
      project: deepClone(project),
      mediaLibrary: deepClone(mediaLibrary),
      currentFilePath: filePath,
      isModified: true,
      undoStack: [],
      redoStack: [],
      clipVersion: get().clipVersion + 1,
    });
  },

  showConfirmDialog: (message: string, title: string) => {
    return new Promise<boolean>((resolve) => {
      _confirmResolve = resolve;
      set({ confirmDialog: { message, title } });
    });
  },

  closeConfirmDialog: (result: boolean) => {
    _confirmResolve?.(result);
    _confirmResolve = null;
    set({ confirmDialog: null });
  },

  resetProject: async () => {
    if (get().isModified) {
      if (!await get().showConfirmDialog("Discard unsaved changes? Any unsaved work will be lost.", "Unsaved Changes")) return;
    }
    set({
      project: createEmptyProject(),
      mediaLibrary: [],
      undoStack: [],
      redoStack: [],
      isExporting: false,
      exportProgress: 0,
      exportResultPath: null,
      exportError: null,
      isRendering: false,
      renderProgress: 0,
      renderResultPath: null,
      currentFilePath: null,
      isModified: false,
      clipVersion: get().clipVersion + 1,
    });
    invoke("clear_forge_recovery").catch(() => {});
  },

  setExporting: (v) => set({ isExporting: v }),
  setExportProgress: (v) => set({ exportProgress: v }),
  setExportResultPath: (v) => set({ exportResultPath: v }),
  setExportError: (v) => set({ exportError: v }),
  setRendering: (v) => set({ isRendering: v }),
  setRenderProgress: (v) => set({ renderProgress: v }),
  setRenderResultPath: (v) => set({ renderResultPath: v }),
  setSnapEnabled: (v) => set({ snapEnabled: v }),
  setDragPayload: (payload) => set({ dragPayload: payload }),
}));

// Load recent files from localStorage on store init
useForgeStore.getState().loadRecentFiles();
