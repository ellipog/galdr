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

  // ── Subtitle burn-in fields ──
  /** Path to subtitle file (.srt/.vtt/.ass) for burn-in */
  subtitle_path?: string;
  /** Subtitle mode: "burn" triggers burn-in via start_conversion */
  subtitle_mode?: SubtitleMode;
  /** Styling for burned-in subtitles (force_style) */
  subtitle_style?: SubtitleStyle;
  /** ISO language tag for embedded subtitles */
  subtitle_lang?: string;
  /** Preferred video encoder (e.g. "h264_nvenc"), resolved from user settings.
   *  "auto" / "software" or undefined means use the default software encoder. */
  preferred_video_encoder?: string;
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

/** Conflict resolution policy when an output file already exists. */
export type ConflictPolicy = "skip" | "overwrite" | "rename";

/** Outcome of a watched-file processing attempt. */
export type WatchLogStatus = "success" | "skippedConflict" | "skippedAge" | "failed";

/** A single output format target for a watch folder. */
export interface WatchOutputFormat {
  outputFormat: string;
  quality?: number;
  outputDir?: string;
}

/** A single entry in a watch folder's persistent processing history. */
export interface WatchLogEntry {
  inputPath: string;
  outputPaths: string[];
  status: WatchLogStatus;
  timestamp: string;
  error?: string;
}

export interface WatchFolderConfig {
  id: string;
  enabled: boolean;
  path: string;
  /** Glob patterns matched against filename, e.g. ["*.mp4","*_hq.*"]. Empty = all. */
  patterns: string[];
  /** Ignore files older than this many minutes. 0 = no limit. */
  ignoreOlderThanMinutes: number;
  /** Debounce window in milliseconds. Default 10000 (10s). */
  settleMs: number;
  action: WatchAction;
  /** One or more output formats to produce from each source file. */
  outputFormats: WatchOutputFormat[];
  outputDir: string;
  /** What to do when an output file already exists. */
  conflictPolicy: ConflictPolicy;
  deleteSource: boolean;
  recursive: boolean;
  preservePath: boolean;
  /** Persistent processing history (most-recent-first). */
  processingLog: WatchLogEntry[];
  // ── Deprecated (kept for migration) ──
  /** Deprecated: use patterns instead. */
  extensions: string[];
  /** Deprecated: use outputFormats[0] instead. */
  params: Partial<ConversionParams>;
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
  /** `true` if this is a quantized (Q5/Q8) variant of a full-precision model. */
  quantized: boolean;
  /** Family group used to cluster models in the picker dropdown, e.g. `"tiny"`, `"base"`, `"large-v3-turbo"`. */
  category: string;
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
  jobId: string;
}

export interface DownloadProgress {
  modelId: string;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
}

// ── Subtitle Operations (Burn / Embed / Extract) ──

export type SubtitleMode = "transcribe" | "burn" | "embed" | "extract" | "edit";

/** Recovery data for the transcript editor auto-save feature. */
export interface TranscriptEditorRecovery {
  cues: Cue[];
  filePath?: string;
  videoPath?: string;
  savedAt: number;
}

/** Hardware encoder detected in the system's ffmpeg installation. */
export interface HardwareEncoderInfo {
  name: string;
  codec: string;
  vendor: string;
  available: boolean;
  description: string;
}

/** ASS subtitle styling parameters for burn-in via `force_style`. */
export interface SubtitleStyle {
  /** Font family name, e.g. "Arial" */
  fontName?: string;
  /** Font size in points (default 24) */
  fontSize?: number;
  /** Primary text colour in ASS hex, e.g. "&H00FFFFFF" */
  primaryColor?: string;
  /** Outline colour in ASS hex, e.g. "&H00000000" */
  outlineColor?: string;
  /** Outline width in pixels (default 2) */
  outlineWidth?: number;
  /** Vertical margin from bottom in pixels (default 40) */
  marginV?: number;
  /** ASS numpad alignment: 1-9 (default 2 = bottom-centre) */
  alignment?: number;
  /** Bold: 0 = normal, 1 = bold (default 0) */
  bold?: number;
  /** Background/box colour in ASS hex, e.g. "&H80000000" for semi-transparent black */
  backColor?: string;
}

export interface SubtitleOpResult {
  jobId: string;
  outputPath: string;
}

// ── Background Queue ──

export type JobType =
  | "conversion"
  | "batch_conversion"
  | "transcription"
  | "subtitle_embed"
  | "subtitle_extract"
  | "subtitle_burn"
  | "concatenation"
  | "audio_extraction"
  | "forge_export";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** A single entry in the background job queue. Mirrors the Rust `JobEntry`. */
export interface QueueJob {
  id: string;
  jobType: JobType;
  status: JobStatus;
  /** 0.0 – 1.0 */
  progress: number;
  /** Human-readable label (e.g. "Converting video.mp4") */
  label: string;
  inputPath: string;
  outputPath?: string;
  error?: string;
  /** ISO 8601 */
  createdAt: string;
  completedAt?: string;
  /** Flexible result payload (batch summary, list of output paths, etc.) */
  resultData?: Record<string, unknown>;
}

/** Payload of the `queue-update` event. */
export interface QueueUpdatePayload {
  jobs: QueueJob[];
}


