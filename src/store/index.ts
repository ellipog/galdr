import { create } from "zustand";
import type { MediaInfo, ConversionParams, RuneTag } from "../types";
import type { TransitionStyle } from "../transitions";
import { DEFAULT_TRANSITION } from "../transitions";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "error";

interface GaldrState {
  mediaInfo: MediaInfo | null;
  conversionParams: ConversionParams;
  isConverting: boolean;
  conversionProgress: number;
  lastOutputPath: string | null;
  error: string | null;
  ffmpegFound: boolean;
  outputDir: string;
  transitionStyle: TransitionStyle;
  testTransitionSignal: number;
  crtEnabled: boolean;

  taskbarAction: string;
  taskbarProgress: number | null;
  taskbarFlash: boolean;

  updateStatus: UpdateStatus;
  updateVersion: string | null;
  updateNotes: string | null;
  updateProgress: number;
  updateDismissed: boolean;
  updateError: string | null;

  runeTags: RuneTag[];
  showRuneInTitlebar: boolean;
  discordEnabled: boolean;
  autostartEnabled: boolean;

  setMediaInfo: (info: MediaInfo | null) => void;
  setConversionParams: (params: Partial<ConversionParams>) => void;
  setIsConverting: (v: boolean) => void;
  setConversionProgress: (v: number) => void;
  setLastOutputPath: (v: string | null) => void;
  setError: (v: string | null) => void;
  setFfmpegFound: (v: boolean) => void;
  setOutputDir: (v: string) => void;
  setTransitionStyle: (v: TransitionStyle) => void;
  setCrtEnabled: (v: boolean) => void;
  triggerTransitionTest: () => void;
  reset: () => void;

  setTaskbarAction: (v: string) => void;
  setTaskbarProgress: (v: number | null) => void;
  setTaskbarFlash: (v: boolean) => void;

  setUpdateStatus: (v: UpdateStatus) => void;
  setUpdateVersion: (v: string | null) => void;
  setUpdateNotes: (v: string | null) => void;
  setUpdateProgress: (v: number) => void;
  setUpdateDismissed: (v: boolean) => void;
  setUpdateError: (v: string | null) => void;
  setRuneTags: (tags: RuneTag[]) => void;
  setShowRuneInTitlebar: (v: boolean) => void;
  setDiscordEnabled: (v: boolean) => void;
  setAutostartEnabled: (v: boolean) => void;
}

const defaultParams: ConversionParams = {
  input_path: "",
  output_dir: "",
  output_format: "mp4",
  video_codec: undefined,
  audio_codec: undefined,
  video_bitrate: undefined,
  audio_bitrate: undefined,
  resolution: undefined,
  framerate: undefined,
  crf: undefined,
  preset: undefined,
  quality: undefined,
  trim_start: undefined,
  trim_end: undefined,
  crop_w: undefined,
  crop_h: undefined,
  crop_x: undefined,
  crop_y: undefined,
  crop_ratio: undefined,
  speed_video: undefined,
  speed_audio: undefined,
  rotate: undefined,
  flip: undefined,
  sample_rate: undefined,
  channels: undefined,
  audio_normalize: undefined,
  fade_in: undefined,
  fade_out: undefined,
};

export const useGaldrStore = create<GaldrState>((set) => ({
  mediaInfo: null,
  conversionParams: { ...defaultParams },
  isConverting: false,
  conversionProgress: 0,
  lastOutputPath: null,
  error: null,
  ffmpegFound: false,
  outputDir: "",
  transitionStyle: DEFAULT_TRANSITION,
  testTransitionSignal: 0,
  crtEnabled: false,

  taskbarAction: "",
  taskbarProgress: null,
  taskbarFlash: false,

  updateStatus: "idle",
  updateVersion: null,
  updateNotes: null,
  updateProgress: 0,
  updateDismissed: false,
  updateError: null,
  runeTags: [],
  showRuneInTitlebar: true,
  discordEnabled: true,
  autostartEnabled: false,

  setMediaInfo: (info) => set({ mediaInfo: info }),
  setConversionParams: (params) =>
    set((state) => ({
      conversionParams: { ...state.conversionParams, ...params },
    })),
  setIsConverting: (v) => set({ isConverting: v }),
  setConversionProgress: (v) => set({ conversionProgress: v }),
  setLastOutputPath: (v) => set({ lastOutputPath: v }),
  setError: (v) => set({ error: v }),
  setFfmpegFound: (v) => set({ ffmpegFound: v }),
  setOutputDir: (v) => set({ outputDir: v }),
  setTransitionStyle: (v) => set({ transitionStyle: v }),
  setCrtEnabled: (v) => set({ crtEnabled: v }),
  triggerTransitionTest: () => set((s) => ({ testTransitionSignal: s.testTransitionSignal + 1 })),
  setTaskbarAction: (v) => set({ taskbarAction: v }),
  setTaskbarProgress: (v) => set({ taskbarProgress: v }),
  setTaskbarFlash: (v) => set({ taskbarFlash: v }),
  reset: () =>
    set({
      mediaInfo: null,
      conversionParams: { ...defaultParams },
      isConverting: false,
      conversionProgress: 0,
      lastOutputPath: null,
      error: null,
    }),

  setUpdateStatus: (v) => set({ updateStatus: v }),
  setUpdateVersion: (v) => set({ updateVersion: v }),
  setUpdateNotes: (v) => set({ updateNotes: v }),
  setUpdateProgress: (v) => set({ updateProgress: v }),
  setUpdateDismissed: (v) => set({ updateDismissed: v }),
  setUpdateError: (v) => set({ updateError: v }),
  setRuneTags: (tags) => set({ runeTags: tags }),
  setShowRuneInTitlebar: (v) => set({ showRuneInTitlebar: v }),
  setDiscordEnabled: (v) => set({ discordEnabled: v }),
  setAutostartEnabled: (v) => set({ autostartEnabled: v }),
}));
