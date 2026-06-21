import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DownloadProgress,
  TranscribeParams,
  TranscribeResult,
  WhisperModel,
  WhisperStatus,
} from "../types";

interface SubtitleState {
  /** Catalog of available whisper models, each annotated with `installed`. */
  models: WhisperModel[];
  /** `false` until the first `load()` completes. */
  loaded: boolean;
  /** `true` if the bundled `whisper-cli` binary can be invoked. */
  whisperAvailable: boolean;
  /** Resolved binary path (for diagnostics when availability fails). */
  whisperResolvedPath: string;

  /** Download progress keyed by model id (0.0–1.0). */
  downloads: Record<string, DownloadProgress>;

  /** Active transcription run, or `null` when idle. */
  transcribing: boolean;
  transcriptionProgress: number;
  transcriptionLog: string[];
  lastResult: TranscribeResult | null;
  error: string | null;

  load: () => Promise<void>;
  refreshModels: () => Promise<void>;
  installModel: (id: string) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  transcribe: (params: TranscribeParams) => Promise<TranscribeResult | null>;
  cancelTranscription: () => Promise<void>;
  clearError: () => void;
  resetLog: () => void;
  /** Subscribe to whisper events. Idempotent. */
  bindEvents: () => Promise<() => void>;
}

export const useSubtitleStore = create<SubtitleState>((set) => ({
  models: [],
  loaded: false,
  whisperAvailable: false,
  whisperResolvedPath: "",
  downloads: {},
  transcribing: false,
  transcriptionProgress: 0,
  transcriptionLog: [],
  lastResult: null,
  error: null,

  load: async () => {
    try {
      const status = await invoke<WhisperStatus>("whisper_status");
      set({
        models: status.models,
        whisperAvailable: status.available,
        whisperResolvedPath: status.resolvedPath,
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  refreshModels: async () => {
    try {
      const models = await invoke<WhisperModel[]>("list_whisper_models");
      set({ models });
    } catch {
      // leave catalog as-is
    }
  },

  installModel: async (id) => {
    try {
      set((s) => ({
        downloads: { ...s.downloads, [id]: { modelId: id, progress: 0, downloadedBytes: 0, totalBytes: 0 } },
      }));
      const updated = await invoke<WhisperModel>("install_whisper_model", { modelId: id });
      set((s) => ({
        models: s.models.map((m) => (m.id === updated.id ? updated : m)),
        downloads: Object.fromEntries(Object.entries(s.downloads).filter(([k]) => k !== id)),
      }));
    } catch (e) {
      set((s) => ({
        error: String(e),
        downloads: Object.fromEntries(Object.entries(s.downloads).filter(([k]) => k !== id)),
      }));
    }
  },

  deleteModel: async (id) => {
    try {
      await invoke("delete_whisper_model", { modelId: id });
      set((s) => ({
        models: s.models.map((m) => (m.id === id ? { ...m, installed: false } : m)),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  transcribe: async (params) => {
    set({
      transcribing: true,
      transcriptionProgress: 0,
      transcriptionLog: ["> transcribe start"],
      error: null,
      lastResult: null,
    });
    try {
      const result = await invoke<TranscribeResult>("transcribe_audio", { ...params });
      set((s) => ({
        transcribing: false,
        transcriptionProgress: 1,
        transcriptionLog: [...s.transcriptionLog, "> done"],
        lastResult: result,
      }));
      return result;
    } catch (e) {
      const msg = typeof e === "string" ? e : "transcription failed";
      set((s) => ({
        transcribing: false,
        error: msg,
        transcriptionLog: [...s.transcriptionLog, `! ${msg}`],
      }));
      return null;
    }
  },

  cancelTranscription: async () => {
    try {
      await invoke("cancel_transcription");
    } catch {
      // ignore — the run will surface an error event
    }
  },

  clearError: () => set({ error: null }),
  resetLog: () => set({ transcriptionLog: [] }),

  bindEvents: async () => {
    const unlisteners: UnlistenFn[] = [];

    unlisteners.push(
      await listen<{ progress: number }>("transcribe-progress", (e) => {
        set({ transcriptionProgress: e.payload.progress });
      }),
    );

    unlisteners.push(
      await listen<{ message: string }>("transcribe-log", (e) => {
        set((s) => ({ transcriptionLog: [...s.transcriptionLog, e.payload.message] }));
      }),
    );

    unlisteners.push(
      await listen<DownloadProgress>("whisper-download-progress", (e) => {
        set((s) => ({ downloads: { ...s.downloads, [e.payload.modelId]: e.payload } }));
      }),
    );

    return () => unlisteners.forEach((u) => u());
  },
}));

let bound = false;

/**
 * Bind the global whisper event listeners once for the lifetime of the app.
 * Returns a no-op if already bound (safe to call from multiple mounts).
 */
export async function bindSubtitleEvents() {
  if (bound) return;
  bound = true;
  await useSubtitleStore.getState().bindEvents();
}
