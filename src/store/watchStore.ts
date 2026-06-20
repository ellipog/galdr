import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { QueuedFile, WatchActivity, WatchFolderConfig } from "../types";

interface WatchState {
  folders: WatchFolderConfig[];
  paused: boolean;
  queue: QueuedFile[];
  /** Live conversion activity keyed by `${folderId}:${path}`. */
  activity: Record<string, WatchActivity>;
  loaded: boolean;
  listenersBound: boolean;

  load: () => Promise<void>;
  saveFolder: (config: WatchFolderConfig) => Promise<WatchFolderConfig>;
  deleteFolder: (id: string) => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
  convertQueued: (id: string) => Promise<string | null>;
  dequeue: (id: string) => Promise<void>;
  clearQueue: () => Promise<void>;
  /** Subscribe to watch:// events. Idempotent. */
  bindEvents: () => Promise<() => void>;
}

export const useWatchStore = create<WatchState>((set, get) => ({
  folders: [],
  paused: false,
  queue: [],
  activity: {},
  loaded: false,
  listenersBound: false,

  load: async () => {
    const [folders, paused, queue] = await Promise.all([
      invoke<WatchFolderConfig[]>("watch_folders"),
      invoke<boolean>("watching_paused"),
      invoke<QueuedFile[]>("queued_files"),
    ]);
    set({ folders, paused, queue, loaded: true });
  },

  saveFolder: async (config) => {
    const saved = await invoke<WatchFolderConfig>("save_watch_folder", { config });
    const existing = get().folders;
    const idx = existing.findIndex((f) => f.id === saved.id);
    set({
      folders: idx >= 0
        ? existing.map((f) => (f.id === saved.id ? saved : f))
        : [...existing, saved],
    });
    return saved;
  },

  deleteFolder: async (id) => {
    await invoke("delete_watch_folder", { id });
    set({ folders: get().folders.filter((f) => f.id !== id) });
  },

  setPaused: async (paused) => {
    await invoke("set_watching_paused", { paused });
    set({ paused });
  },

  convertQueued: async (id) => {
    try {
      const out = await invoke<string>("convert_queued_file", { id });
      set({ queue: get().queue.filter((f) => f.id !== id) });
      return out;
    } catch {
      set({ queue: get().queue.filter((f) => f.id !== id) });
      return null;
    }
  },

  dequeue: async (id) => {
    await invoke("dequeue_file", { id });
    set({ queue: get().queue.filter((f) => f.id !== id) });
  },

  clearQueue: async () => {
    await invoke("clear_queue");
    set({ queue: [] });
  },

  bindEvents: async () => {
    if (get().listenersBound) return () => {};
    set({ listenersBound: true });

    const unlisteners: UnlistenFn[] = [];

    unlisteners.push(
      await listen<QueuedFile>("watch://file-queued", (e) => {
        set({ queue: [...get().queue, e.payload] });
      }),
    );

    unlisteners.push(
      await listen<{ folderId: string; path: string }>("watch://convert-started", (e) => {
        const key = `${e.payload.folderId}:${e.payload.path}`;
        set({
          activity: {
            ...get().activity,
            [key]: { folderId: e.payload.folderId, path: e.payload.path, progress: 0, status: "running" },
          },
        });
      }),
    );

    unlisteners.push(
      await listen<{ folderId: string; path: string; outputPath: string }>("watch://convert-done", (e) => {
        const key = `${e.payload.folderId}:${e.payload.path}`;
        const cur = get().activity[key];
        set({
          activity: {
            ...get().activity,
            [key]: { ...cur, folderId: e.payload.folderId, path: e.payload.path, progress: 1, status: "done", outputPath: e.payload.outputPath },
          },
        });
        // Drop the activity entry after a short delay so the UI can show "done".
        setTimeout(() => {
          const next = { ...get().activity };
          delete next[key];
          set({ activity: next });
        }, 4000);
      }),
    );

    unlisteners.push(
      await listen<{ folderId: string; path: string; error: string }>("watch://convert-error", (e) => {
        const key = `${e.payload.folderId}:${e.payload.path}`;
        const cur = get().activity[key];
        set({
          activity: {
            ...get().activity,
            [key]: { ...cur, folderId: e.payload.folderId, path: e.payload.path, progress: 0, status: "error", error: e.payload.error },
          },
        });
        setTimeout(() => {
          const next = { ...get().activity };
          delete next[key];
          set({ activity: next });
        }, 8000);
      }),
    );

    return () => {
      unlisteners.forEach((u) => u && u());
      set({ listenersBound: false });
    };
  },
}));
