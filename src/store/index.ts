import { create } from "zustand";
import type { MediaInfo, ConversionParams } from "../types";
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

  updateStatus: UpdateStatus;
  updateVersion: string | null;
  updateNotes: string | null;
  updateProgress: number;
  updateDismissed: boolean;

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

  setUpdateStatus: (v: UpdateStatus) => void;
  setUpdateVersion: (v: string | null) => void;
  setUpdateNotes: (v: string | null) => void;
  setUpdateProgress: (v: number) => void;
  setUpdateDismissed: (v: boolean) => void;
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

  updateStatus: "idle",
  updateVersion: null,
  updateNotes: null,
  updateProgress: 0,
  updateDismissed: false,

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
}));
