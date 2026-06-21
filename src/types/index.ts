export interface ConversionParams {
  input_path: string;
  output_dir: string;
  output_format: string;
  video_codec?: string;
  audio_codec?: string;
  video_bitrate?: string;
  audio_bitrate?: string;
  resolution?: [number, number];
  framerate?: number;
  crf?: number;
  preset?: string;
  quality?: number;
  /** Target file size in bytes. When set, enables target-size two-pass encoding. */
  target_size_bytes?: number;
  trim_start?: number;
  trim_end?: number;
  crop_w?: number;
  crop_h?: number;
  crop_x?: number;
  crop_y?: number;
  crop_ratio?: string;
  speed_video?: number;
  speed_audio?: number;
  rotate?: number;
  flip?: "h" | "v";
  sample_rate?: number;
  channels?: number;
  /** Audio normalization: "loudnorm" (EBU R128) | "dynaudnorm" (peak) */
  audio_normalize?: "loudnorm" | "dynaudnorm";
  /** Audio fade-in duration (seconds) */
  fade_in?: number;
  /** Audio fade-out duration (seconds) */
  fade_out?: number;
}

/**
 * A rune tag captures a conversion preset.
 *
 * `PresetParams` is intentionally an alias of `ConversionParams` minus the two
 * job-specific path fields, so every conversion parameter (current and future)
 * is automatically saveable, persistable, and applyable as a rune. The paths
 * describe a particular file and never belong in a reusable preset.
 */
export type PresetParams = Omit<ConversionParams, "input_path" | "output_dir">;

export interface RuneTag {
  id: string;
  name: string;
  rune: string;
  description: string;
  params: PresetParams;
}

/** Wrapper format for `.galdr` files containing rune presets. */
export interface GaldrRunesFile {
  type: "galdr-runes";
  version: string;
  runes: RuneTag[];
}

export interface StreamInfo {
  index: number;
  kind: string;
  codec: string;
  width?: number;
  height?: number;
  frame_rate?: number;
  sample_rate?: number;
  channels?: number;
  bitrate?: number;
  language?: string;
}

export interface MediaInfo {
  container: string;
  streams: StreamInfo[];
  duration: number;
  bitrate?: number;
  size: number;
}

export interface ConversionProgress {
  job_id: string;
  progress: number;
}

export interface ConversionDone {
  job_id: string;
  output_path: string;
}

export interface ScannedFile {
  path: string;
  name: string;
  size: number;
}

export interface BatchProgress {
  total: number;
  done: number;
  failed: number;
  current_file: string;
  file_progress: number;
}

// ── Forge (Video Editor) Types ──

export interface ForgeClip {
  id: string;
  name: string;
  sourcePath: string;
  /** Position on timeline (seconds) */
  startTime: number;
  /** Duration on timeline after trim + speed (seconds) */
  duration: number;
  /** In-point in source media (seconds) */
  sourceStart: number;
  /** Out-point in source media (seconds) */
  sourceEnd: number;
  /** Playback speed (0.25 - 4.0) */
  speed: number;
  selected: boolean;
}

export interface ForgeTrack {
  clips: ForgeClip[];
  height: number;
  muted: boolean;
  locked: boolean;
}

export interface ForgeMarker {
  time: number;
  label: string;
}

export interface ForgeProjectData {
  fps: number;
  width: number;
  height: number;
  videoTrack: ForgeTrack;
  audioTrack: ForgeTrack;
  markers: ForgeMarker[];
  playheadTime: number;
  zoomLevel: number;
}

/**
 * Universal .galdr project file format.
 * The `app` field determines which tool interprets `data`.
 * This structure can be extended for batch jobs, settings, etc.
 */
export interface GaldrProjectFile {
  version: string;
  type: "galdr-project";
  app: string;
  name: string;
  created: string;
  updated: string;
  data: ForgeProjectData;
  extensions: Record<string, unknown>;
}

export interface MediaLibraryItem {
  id: string;
  name: string;
  path: string;
  duration: number;
  width?: number;
  height?: number;
}

export interface RecentFileEntry {
  path: string;
  name: string;
  updated: string;
}

// ── Watch Folder Types ──

export type WatchAction = "autoConvert" | "queue";

export interface WatchFolderConfig {
  id: string;
  enabled: boolean;
  path: string;
  /** Lowercase extensions without dot, e.g. ["mp4","mov"]. Empty = all. */
  extensions: string[];
  outputDir: string;
  action: WatchAction;
  /** Conversion preset applied on auto-convert (inputPath/outputDir overwritten). */
  params: Partial<ConversionParams>;
  deleteSource: boolean;
  recursive: boolean;
  preservePath: boolean;
}

/** A file waiting in the manual-review queue (Queue-action folders). */
export interface QueuedFile {
  id: string;
  folderId: string;
  folderPath: string;
  path: string;
  name: string;
  queuedAt: string;
}

/** Live activity for a watched-file conversion. */
export interface WatchActivity {
  folderId: string;
  path: string;
  progress: number;
  status: "running" | "done" | "error";
  outputPath?: string;
  error?: string;
}

// ── Subtitles / Whisper ──

/** A single subtitle cue parsed from SRT/VTT. */
export interface Cue {
  index: number;
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  text: string;
}

/** A whisper.cpp ggml model offered for download. */
export interface WhisperModel {
  id: string;
  label: string;
  fileName: string;
  url: string;
  sizeBytes: number;
  languageClass: "multilingual" | "english-only";
  tier: "fast" | "balanced" | "accurate" | "best";
  description: string;
  installed: boolean;
}

export interface WhisperStatus {
  available: boolean;
  resolvedPath: string;
  models: WhisperModel[];
  anyInstalled: boolean;
}

export interface TranscribeParams {
  inputPath: string;
  modelId: string;
  /** ISO language code, or "auto" for detection. */
  language: string;
  translateToEnglish: boolean;
  /** "srt" | "vtt" | "json" | "all" */
  outputFormat: string;
  outputDir: string;
}

export interface TranscribeResult {
  srtPath: string | null;
  vttPath: string | null;
  jsonPath: string | null;
  outputDir: string;
}

export interface DownloadProgress {
  modelId: string;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
}


