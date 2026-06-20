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

export interface PresetParams {
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
}

export interface RuneTag {
  id: string;
  name: string;
  rune: string;
  description: string;
  params: PresetParams;
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

