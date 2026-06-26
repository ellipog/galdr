import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import ScrambleText from "../components/ScrambleText";
import MediaInfoCard from "../components/MediaInfoCard";
import LogPanel from "../components/LogPanel";
import Dropdown from "../components/Dropdown";
import ModelManager from "../components/whisper/ModelManager";
import SubtitleStylePanel from "../components/SubtitleStylePanel";
import TranscriptEditor from "../components/TranscriptEditor";
import { useSubtitleStore, bindSubtitleEvents } from "../store/subtitleStore";
import { useGaldrStore } from "../store";
import { resolvePreferredEncoder } from "../utils/ffmpegBuilder";
import { LANGUAGE_OPTIONS, LANGUAGE_LABEL } from "../options/languages";
import { useContextMenu } from "../components/ContextMenu";
import { parseSrt, parseVtt, serializeSrt, serializeVtt } from "../utils/srt";
import type {
  MediaInfo,
  WhisperModel,
  SubtitleStyle,
  SubtitleOpResult,
  SubtitleMode,
  StreamInfo,
  ConversionProgress,
  Cue,
  TranscriptEditorRecovery,
} from "../types";

const MEDIA_FILTERS = [
  "mp4", "mkv", "avi", "mov", "webm", "m4v", "flv", "ogv", "wmv", "ts",
  "mp3", "flac", "wav", "aac", "ogg", "opus", "wma", "m4a", "aiff", "ac3",
];

const SUBTITLE_FILTERS = ["srt", "vtt", "ass", "ssa", "sub"];

const OUTPUT_FORMAT_OPTIONS = [
  { value: "srt", label: "srt (subtitles)", category: "format" },
  { value: "vtt", label: "vtt (web subtitles)", category: "format" },
  { value: "json", label: "json (word timing)", category: "format" },
  { value: "all", label: "all formats", category: "format" },
];

/* ISO 639-2 language codes for subtitle embedding */
const EMBED_LANG_OPTIONS = [
  { value: "eng", label: "English" },
  { value: "spa", label: "Spanish" },
  { value: "fra", label: "French" },
  { value: "deu", label: "German" },
  { value: "ita", label: "Italian" },
  { value: "por", label: "Portuguese" },
  { value: "rus", label: "Russian" },
  { value: "jpn", label: "Japanese" },
  { value: "kor", label: "Korean" },
  { value: "chi", label: "Chinese" },
  { value: "ara", label: "Arabic" },
  { value: "hin", label: "Hindi" },
  { value: "tur", label: "Turkish" },
  { value: "nld", label: "Dutch" },
  { value: "pol", label: "Polish" },
  { value: "swe", label: "Swedish" },
  { value: "dan", label: "Danish" },
  { value: "nor", label: "Norwegian" },
  { value: "fin", label: "Finnish" },
  { value: "ell", label: "Greek" },
  { value: "ces", label: "Czech" },
  { value: "ron", label: "Romanian" },
  { value: "hun", label: "Hungarian" },
  { value: "tha", label: "Thai" },
  { value: "vie", label: "Vietnamese" },
  { value: "ind", label: "Indonesian" },
  { value: "msa", label: "Malay" },
  { value: "ukr", label: "Ukrainian" },
];

const EXTRACT_FORMAT_OPTIONS = [
  { value: "srt", label: "srt" },
  { value: "vtt", label: "vtt" },
  { value: "ass", label: "ass" },
];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

type MediaType = "video" | "audio" | "image" | null;

const IMAGE_CODECS = ["png", "jpeg", "gif", "bmp", "tiff", "webp", "avif"];

function detectMediaType(mi: MediaInfo): MediaType {
  const isImage = mi.container.includes("image") ||
    (mi.duration === 0 && mi.streams.some((s) => IMAGE_CODECS.includes(s.codec)));
  if (isImage) return "image";
  if (mi.streams.some((s) => s.kind === "audio") &&
    !mi.streams.some((s) => s.kind === "video")) return "audio";
  return "video";
}

/**
 * Four-mode subtitle manager:
 * - transcribe (whisper.cpp AI speech-to-text)
 * - burn (hardcode subtitles into video via ffmpeg)
 * - embed (mux subtitles as a stream into container)
 * - extract (demux subtitle streams from container)
 */
export default function SubtitlesPage() {
  const {
    models,
    whisperAvailable,
    whisperResolvedPath,
    loaded,
    transcribing,
    transcriptionProgress,
    transcriptionLog,
    lastResult,
    error: whisperError,
    load,
    transcribe,
    cancelTranscription,
    clearError,
    resetLog,
  } = useSubtitleStore();

  // ── Shared UI state ──
  const [mode, setMode] = useState<SubtitleMode>("transcribe");
  const [inputPath, setInputPath] = useState("");
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { show } = useContextMenu();

  // ── Transcribe state ──
  const [modelId, setModelId] = useState("");
  const [language, setLanguage] = useState("auto");
  const [translateToEnglish, setTranslateToEnglish] = useState(false);
  const [outputFormat, setOutputFormat] = useState("srt");
  const [outputDir, setOutputDir] = useState("");
  const [btnHover, setBtnHover] = useState(false);

  // ── Burn/Embed subtitle file state ──
  const [subtitlePath, setSubtitlePath] = useState("");
  const [subIsDragOver, setSubIsDragOver] = useState(false);

  // ── Burn-specific state ──
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>({});
  const [burnOutputFormat, setBurnOutputFormat] = useState("mp4");
  const [burnOutputDir, setBurnOutputDir] = useState("");
  const [burning, setBurning] = useState(false);
  const [burnProgress, setBurnProgress] = useState(0);
  const [burnLog, setBurnLog] = useState<string[]>([]);
  const [burnResult, setBurnResult] = useState<string | null>(null);

  // ── Burn preview state ──
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSeek, setPreviewSeek] = useState(60);

  // ── Embed-specific state ──
  const [embedLang, setEmbedLang] = useState("eng");
  const [embedOutputDir, setEmbedOutputDir] = useState("");
  const [embedding, setEmbedding] = useState(false);
  const [embedProgress, setEmbedProgress] = useState(0);
  const [embedLog, setEmbedLog] = useState<string[]>([]);
  const [embedResult, setEmbedResult] = useState<SubtitleOpResult | null>(null);

  // ── Extract-specific state ──
  const [subtitleStreams, setSubtitleStreams] = useState<StreamInfo[]>([]);
  const [extracting, setExtracting] = useState<number | null>(null); // stream index being extracted
  const [extractProgress, setExtractProgress] = useState(0);
  const [extractLog, setExtractLog] = useState<string[]>([]);
  const [extractResults, setExtractResults] = useState<SubtitleOpResult[]>([]);
  const [extractStreamFormats, setExtractStreamFormats] = useState<Record<number, string>>({});

  // ── Edit mode state ──
  const [editorCues, setEditorCues] = useState<Cue[]>([]);
  const [editorFilePath, setEditorFilePath] = useState<string | null>(null);
  const [editorVideoPath, setEditorVideoPath] = useState<string | null>(null);
  const [editorSaveMsg, setEditorSaveMsg] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  /* ── Bootstrap ── */
  useEffect(() => {
    load();
    bindSubtitleEvents();
  }, [load]);

  /* ── Auto-select default model ── */
  useEffect(() => {
    if (!modelId && models.length > 0) {
      const installed = models.find((m) => m.installed);
      const defaultPick =
        installed ??
        models.find((m) => m.id === "base") ??
        models[0];
      setModelId(defaultPick.id);
    }
  }, [models, modelId]);

  /* ── Reset mode-specific state when mode changes ── */
  useEffect(() => {
    setError(null);
    if (mode !== "transcribe") {
      // Don't reset transcribe state; just clear local errors
    }
    if (mode !== "burn") {
      setBurning(false);
      setBurnProgress(0);
    }
    if (mode !== "embed") {
      setEmbedding(false);
      setEmbedProgress(0);
    }
    if (mode !== "extract") {
      setExtracting(null);
      setExtractProgress(0);
    }
    if (mode !== "edit") {
      // Don't reset editor cues — user may switch away and back
    }
  }, [mode]);

  /* ── Update subtitle streams when mediaInfo changes in extract mode ── */
  useEffect(() => {
    if (mode === "extract" && mediaInfo) {
      setSubtitleStreams(mediaInfo.streams.filter((s) => s.kind === "subtitle"));
    } else if (mode !== "extract") {
      setSubtitleStreams([]);
    }
  }, [mode, mediaInfo]);

  const selectedModel: WhisperModel | undefined = models.find((m) => m.id === modelId);
  const modelIsInstalled = !!selectedModel?.installed;

  /* ── File loading ── */
  const loadFile = useCallback(async (path: string) => {
    clearError();
    setError(null);
    setInputPath(path);
    setMediaInfo(null);
    // Reset mode-specific results
    setBurnResult(null);
    setEmbedResult(null);
    setExtractResults([]);
    setSubtitleStreams([]);
    try {
      const info = await invoke<MediaInfo>("get_media_info", { path });
      setMediaInfo(info);
    } catch (e) {
      setMediaInfo(null);
      console.warn("media info failed:", e);
    }
  }, [clearError]);

  /* ── Subtitle file loading in edit mode ── */
  const loadSubtitleForEdit = useCallback(async (path: string) => {
    setEditorError(null);
    setEditorSaveMsg(null);
    try {
      const content = await invoke<string>("read_subtitle_file", { path });
      const ext = path.split(".").pop()?.toLowerCase();
      let parsed: Cue[];
      if (ext === "vtt") {
        parsed = parseVtt(content);
      } else {
        // SRT and ASS both use the SRT parser for basic cue extraction
        parsed = parseSrt(content);
      }
      if (parsed.length === 0) {
        setEditorError("No cues found in subtitle file");
        return;
      }
      setEditorCues(parsed);
      setEditorFilePath(path);
    } catch (e) {
      setEditorError(typeof e === "string" ? e : "Failed to load subtitle file");
    }
  }, []);

  const pickFile = useCallback(async () => {
    const filters = mode === "edit"
      ? [
          { name: "Media", extensions: MEDIA_FILTERS },
          { name: "Subtitles", extensions: SUBTITLE_FILTERS },
        ]
      : [{ name: "Media", extensions: MEDIA_FILTERS }];
    const sel = await open({ multiple: false, filters });
    if (sel) {
      const path = sel as string;
      const ext = path.split(".").pop()?.toLowerCase();
      if (mode === "edit") {
        if (ext && SUBTITLE_FILTERS.includes(ext)) {
          loadSubtitleForEdit(path);
        } else {
          setEditorVideoPath(path);
          loadFile(path);
        }
      } else {
        loadFile(path);
      }
    }
  }, [loadFile, loadSubtitleForEdit, mode]);

  /* ── Subtitle file loading (burn/embed) ── */
  const loadSubtitleFile = useCallback(async (path: string) => {
    setSubtitlePath(path);
  }, []);

  const pickSubtitleFile = useCallback(async () => {
    const sel = await open({
      multiple: false,
      filters: [{ name: "Subtitles", extensions: SUBTITLE_FILTERS }],
    });
    if (sel) loadSubtitleFile(sel as string);
  }, [loadSubtitleFile]);

  /* ── Subtitle file picker for edit mode ── */
  const pickSubtitleForEdit = useCallback(async () => {
    const sel = await open({
      multiple: false,
      filters: [{ name: "Subtitles", extensions: SUBTITLE_FILTERS }],
    });
    if (sel) loadSubtitleForEdit(sel as string);
  }, [loadSubtitleForEdit]);

  /* ── Drag-and-drop (main) ── */
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(await listen("tauri://drag-enter", () => setIsDragOver(true)));
      unlisteners.push(await listen("tauri://drag-leave", () => setIsDragOver(false)));
      unlisteners.push(
        await listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
          setIsDragOver(false);
          const path = e.payload.paths?.[0];
          if (!path) return;
          invoke<boolean>("is_directory", { path }).then((isDir) => {
            if (isDir) return;
            const ext = path.split(".").pop()?.toLowerCase();
            if (mode === "edit") {
              if (ext && SUBTITLE_FILTERS.includes(ext)) {
                loadSubtitleForEdit(path);
              } else if (ext && MEDIA_FILTERS.includes(ext)) {
                // Media file in edit mode: load as video for sync
                setEditorVideoPath(path);
                loadFile(path);
              }
            } else {
              loadFile(path);
            }
          });
        }),
      );
    })();
    return () => { unlisteners.forEach((u) => u()); };
  }, [loadFile, loadSubtitleForEdit, mode]);

  /* ── Drag-and-drop (subtitle file) ── */
  useEffect(() => {
    if (mode !== "burn" && mode !== "embed") return;
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(
        await listen("tauri://drag-enter", () => {
          // We don't distinguish which zone; the subtitle zone sets its own drag state
        }),
      );
      unlisteners.push(
        await listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
          const path = e.payload.paths?.[0];
          if (!path) return;
          // Only treat as subtitle file if it has a subtitle extension
          const ext = path.split(".").pop()?.toLowerCase();
          if (ext && SUBTITLE_FILTERS.includes(ext)) {
            setSubIsDragOver(false);
            loadSubtitleFile(path);
          }
        }),
      );
    })();
    return () => { unlisteners.forEach((u) => u()); };
  }, [mode, loadSubtitleFile]);

  /* ── Output dir defaults ── */
  useEffect(() => {
    if (!outputDir) {
      invoke<string>("get_default_output_dir")
        .then((d) => setOutputDir(`${d}/subtitles`))
        .catch(() => {});
    }
  }, [outputDir]);

  useEffect(() => {
    if (!burnOutputDir) {
      invoke<string>("get_default_output_dir")
        .then((d) => setBurnOutputDir(`${d}/burn`))
        .catch(() => {});
    }
  }, [burnOutputDir]);

  useEffect(() => {
    if (!embedOutputDir) {
      invoke<string>("get_default_output_dir")
        .then((d) => setEmbedOutputDir(`${d}/embed`))
        .catch(() => {});
    }
  }, [embedOutputDir]);

  const browseOutputDir = useCallback(async () => {
    const sel = await open({ directory: true, multiple: false });
    if (sel) setOutputDir(sel as string);
  }, []);

  const browseBurnOutputDir = useCallback(async () => {
    const sel = await open({ directory: true, multiple: false });
    if (sel) setBurnOutputDir(sel as string);
  }, []);

  const browseEmbedOutputDir = useCallback(async () => {
    const sel = await open({ directory: true, multiple: false });
    if (sel) setEmbedOutputDir(sel as string);
  }, []);

  /* ── Clear preview when inputs change ── */
  useEffect(() => {
    setPreviewUrl(null);
  }, [inputPath, subtitlePath, subtitleStyle]);

  /* ── Transcribe ── */
  const handleTranscribe = useCallback(async () => {
    if (!inputPath || !modelId) return;
    if (!modelIsInstalled) {
      useSubtitleStore.setState({ error: `install ${selectedModel?.label ?? "the model"} first` });
      return;
    }
    await transcribe({
      inputPath,
      modelId,
      language,
      translateToEnglish,
      outputFormat,
      outputDir,
    });
  }, [inputPath, modelId, modelIsInstalled, language, translateToEnglish, outputFormat, outputDir, transcribe, selectedModel]);

  /* ── Burn ── */
  useEffect(() => {
    if (mode !== "burn") return;
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(
        await listen<ConversionProgress>("conversion-progress", (e) => {
          setBurnProgress(e.payload.progress);
        }),
      );
      unlisteners.push(
        await listen<{ message: string }>("conversion-log", (e) => {
          setBurnLog((prev) => [...prev, e.payload.message]);
        }),
      );
    })();
    return () => { unlisteners.forEach((u) => u()); };
  }, [mode]);

  const handleBurn = useCallback(async () => {
    if (!inputPath || !subtitlePath) return;
    setError(null);
    setBurning(true);
    setBurnProgress(0);
    setBurnLog(["> burn start"]);
    setBurnResult(null);
    try {
      const params = {
        input_path: inputPath,
        output_dir: burnOutputDir,
        output_format: burnOutputFormat,
        subtitle_path: subtitlePath,
        subtitle_mode: "burn" as const,
        subtitle_style: Object.keys(subtitleStyle).length > 0 ? subtitleStyle : undefined,
        preferred_video_encoder: resolvePreferredEncoder(
          useGaldrStore.getState().preferredVideoEncoder,
          burnOutputFormat,
          useGaldrStore.getState().availableEncoders,
        ),
      };
      const r = await invoke<{ job_id: string; output_path: string }>(
        "start_conversion", { params },
      );
      setBurnLog((prev) => [...prev, `> ${r.output_path}`]);
      setBurnResult(r.output_path);
    } catch (e) {
      const msg = typeof e === "string" ? e : "burn failed";
      setBurnLog((prev) => [...prev, `! ${msg}`]);
      setError(msg);
    } finally {
      setBurning(false);
    }
  }, [inputPath, subtitlePath, burnOutputDir, burnOutputFormat, subtitleStyle]);

  /* ── Burn preview ── */
  const handleGeneratePreview = useCallback(async () => {
    if (!inputPath || !subtitlePath) return;
    setPreviewLoading(true);
    setPreviewUrl(null);
    try {
      const url = await invoke<string>("preview_subtitle_burn", {
        inputPath,
        subtitlePath,
        style: Object.keys(subtitleStyle).length > 0 ? subtitleStyle : undefined,
        seekSeconds: previewSeek,
      });
      setPreviewUrl(url);
    } catch (e) {
      const msg = typeof e === "string" ? e : "preview failed";
      setError(msg);
    } finally {
      setPreviewLoading(false);
    }
  }, [inputPath, subtitlePath, subtitleStyle, previewSeek]);

  /* ── Embed ── */
  useEffect(() => {
    if (mode !== "embed") return;
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(
        await listen<{ jobId: string; progress: number }>("subtitle-op-progress", (e) => {
          setEmbedProgress(e.payload.progress);
        }),
      );
      unlisteners.push(
        await listen<{ jobId: string; message: string }>("subtitle-op-log", (e) => {
          setEmbedLog((prev) => [...prev, e.payload.message]);
        }),
      );
    })();
    return () => { unlisteners.forEach((u) => u()); };
  }, [mode]);

  const handleEmbed = useCallback(async () => {
    if (!inputPath || !subtitlePath) return;
    setError(null);
    setEmbedding(true);
    setEmbedProgress(0);
    setEmbedLog(["> embed start"]);
    setEmbedResult(null);
    try {
      const baseName = inputPath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") ?? "output";
      const ext = inputPath.split(".").pop() ?? "mp4";
      const outputPath = `${embedOutputDir}/${baseName}_with_subs.${ext}`;
      const r = await invoke<SubtitleOpResult>("embed_subtitle", {
        inputPath,
        subtitlePath,
        outputPath,
        lang: embedLang,
      });
      setEmbedLog((prev) => [...prev, `> ${r.outputPath}`]);
      setEmbedResult(r);
    } catch (e) {
      const msg = typeof e === "string" ? e : "embed failed";
      setEmbedLog((prev) => [...prev, `! ${msg}`]);
      setError(msg);
    } finally {
      setEmbedding(false);
    }
  }, [inputPath, subtitlePath, embedOutputDir, embedLang]);

  /* ── Extract ── */
  useEffect(() => {
    if (mode !== "extract") return;
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(
        await listen<{ jobId: string; progress: number }>("subtitle-op-progress", (e) => {
          setExtractProgress(e.payload.progress);
        }),
      );
      unlisteners.push(
        await listen<{ jobId: string; message: string }>("subtitle-op-log", (e) => {
          setExtractLog((prev) => [...prev, e.payload.message]);
        }),
      );
    })();
    return () => { unlisteners.forEach((u) => u()); };
  }, [mode]);

  const handleExtract = useCallback(async (streamIndex: number) => {
    if (!inputPath) return;
    setError(null);
    setExtracting(streamIndex);
    setExtractProgress(0);
    setExtractLog((prev) => [...prev, `> extract stream #${streamIndex}`]);
    try {
      const fmt = extractStreamFormats[streamIndex] ?? "srt";
      const baseName = inputPath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") ?? "output";
      const outputDir = embedOutputDir || (await invoke<string>("get_default_output_dir").catch(() => ""));
      const outputPath = `${outputDir}/extract/${baseName}_stream${streamIndex}.${fmt}`;
      const r = await invoke<SubtitleOpResult>("extract_subtitle", {
        inputPath,
        outputPath,
        streamIndex,
        outputFormat: fmt,
      });
      setExtractLog((prev) => [...prev, `> ${r.outputPath}`]);
      setExtractResults((prev) => [...prev, r]);
    } catch (e) {
      const msg = typeof e === "string" ? e : "extract failed";
      setExtractLog((prev) => [...prev, `! ${msg}`]);
      setError(msg);
    } finally {
      setExtracting(null);
    }
  }, [inputPath, embedOutputDir, extractStreamFormats]);

  /* ── Context menus ── */
  const handleDropContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (inputPath) {
      show(e, [
        { label: "browse (replace)", rune: "ᛏ", action: pickFile },
        { label: "copy path", rune: "ᚷ", action: () => navigator.clipboard.writeText(inputPath) },
        { label: "", rune: "", action: () => {}, divider: true },
        {
          label: "clear file",
          rune: "ᚨ",
          action: () => {
            setInputPath("");
            setMediaInfo(null);
          },
        },
        {
          label: "reveal in folder",
          rune: "ᚠ",
          action: () => inputPath && invoke("reveal_in_folder", { path: inputPath }).catch(() => {}),
        },
      ]);
    } else {
      show(e, [
        { label: "browse media", rune: "ᚨ", action: pickFile },
        {
          label: "paste path",
          rune: "ᚷ",
          action: async () => {
            const text = await navigator.clipboard.readText();
            if (text) loadFile(text);
          },
        },
      ]);
    }
  }, [show, inputPath, pickFile, loadFile]);

  const handleOutputContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "browse", rune: "ᚨ", action: browseOutputDir },
      { label: "copy path", rune: "ᚷ", action: () => navigator.clipboard.writeText(outputDir) },
      ...(outputDir ? [{ label: "clear", rune: "ᚨ", action: () => setOutputDir("") }] : []),
    ]);
  }, [show, outputDir, browseOutputDir]);

  const handleModelContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "open model manager", rune: "ᛏ", action: () => {} },
      { label: "refresh catalog", rune: "ᚷ", action: () => load() },
    ]);
  }, [show, load]);

  const handleLogContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Pick the active log
    let log: string[] = [];
    if (mode === "transcribe") log = transcriptionLog;
    else if (mode === "burn") log = burnLog;
    else if (mode === "embed") log = embedLog;
    else if (mode === "extract") log = extractLog;
    if (log.length === 0) return;
    show(e, [
      { label: "copy all", rune: "ᚷ", action: () => navigator.clipboard.writeText(log.join("\n")) },
      { label: "clear", rune: "ᚨ", action: () => {
        if (mode === "transcribe") resetLog();
        else if (mode === "burn") setBurnLog([]);
        else if (mode === "embed") setEmbedLog([]);
        else if (mode === "extract") setExtractLog([]);
      }},
    ]);
  }, [show, mode, transcriptionLog, burnLog, embedLog, extractLog, resetLog]);

  const handleResultContext = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    show(e, [
      { label: "show in folder", rune: "ᛏ", action: () => revealItemInDir(path) },
      { label: "copy path", rune: "ᚷ", action: () => navigator.clipboard.writeText(path) },
    ]);
  }, [show]);

  const handleBurnOutputContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "browse", rune: "ᚨ", action: browseBurnOutputDir },
      { label: "copy path", rune: "ᚷ", action: () => navigator.clipboard.writeText(burnOutputDir) },
      ...(burnOutputDir ? [{ label: "clear", rune: "ᚨ", action: () => setBurnOutputDir("") }] : []),
    ]);
  }, [show, burnOutputDir, browseBurnOutputDir]);

  const handleEmbedOutputContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "browse", rune: "ᚨ", action: browseEmbedOutputDir },
      { label: "copy path", rune: "ᚷ", action: () => navigator.clipboard.writeText(embedOutputDir) },
      ...(embedOutputDir ? [{ label: "clear", rune: "ᚨ", action: () => setEmbedOutputDir("") }] : []),
    ]);
  }, [show, embedOutputDir, browseEmbedOutputDir]);

  /* ── Derived ── */
  const canTranscribe = !!inputPath && modelIsInstalled && !transcribing;
  const translateDisabled = language === "en";
  const canBurn = !!inputPath && !!subtitlePath && !burning;
  const canEmbed = !!inputPath && !!subtitlePath && !embedding;
  const canExtract = subtitleStreams.length > 0 && extracting === null;

  /* ── Active log for current mode ── */
  const activeLog =
    mode === "transcribe" ? transcriptionLog :
    mode === "burn" ? burnLog :
    mode === "embed" ? embedLog :
    mode === "extract" ? extractLog :
    [];

  const activeProgress =
    mode === "transcribe" ? transcriptionProgress :
    mode === "burn" ? burnProgress :
    mode === "embed" ? embedProgress :
    mode === "extract" ? extractProgress :
    0;

  const isRunning =
    (mode === "transcribe" && transcribing) ||
    (mode === "burn" && burning) ||
    (mode === "embed" && embedding) ||
    (mode === "extract" && extracting !== null);

  /* ── Render ── */
  return (
    <div className="page subtitles-page">
      {/* Mode tabs */}
      <div className="mode-tabs">
        <button
          className={`mode-tab${mode === "transcribe" ? " active" : ""}`}
          onClick={() => setMode("transcribe")}
        >
          ᛊ transcribe
        </button>
        <button
          className={`mode-tab${mode === "burn" ? " active" : ""}`}
          onClick={() => setMode("burn")}
        >
          ᛦ burn-in
        </button>
        <button
          className={`mode-tab${mode === "embed" ? " active" : ""}`}
          onClick={() => setMode("embed")}
        >
          ᛇ embed
        </button>
        <button
          className={`mode-tab${mode === "extract" ? " active" : ""}`}
          onClick={() => setMode("extract")}
        >
          ᛉ extract
        </button>
        <button
          className={`mode-tab${mode === "edit" ? " active" : ""}`}
          onClick={() => setMode("edit")}
        >
          ᚷ edit
        </button>
      </div>

      {/* Whisper availability alert (transcribe only) */}
      {mode === "transcribe" && loaded && !whisperAvailable && (
        <div className="alert-error" title={whisperResolvedPath}>
          ! whisper-cli not found — looked for: {whisperResolvedPath || "(unresolved)"}
        </div>
      )}

      {/* ── Shared input section ── */}
      <div className="section-heading">
        <span className="section-heading-line" />
        <span className="section-heading-rune">ᚨ</span>
        <span className="section-heading-label">input</span>
      </div>

      <div
        className={`drop-zone${isDragOver ? " drag-over" : ""}${inputPath ? " has-file" : ""}`}
        onClick={pickFile}
        onContextMenu={handleDropContext}
      >
        {inputPath ? (
          <>
            <span className="drop-file-icon">ᛉ</span>
            <span className="drop-file-name">{inputPath.split(/[/\\]/).pop()}</span>
            <span className="drop-file-size">{mediaInfo ? fmtSize(mediaInfo.size) : ""}</span>
            <span className="drop-file-change">change</span>
          </>
        ) : (
          <>
            <span className="drop-rune">ᛊ</span>
            <ScrambleText as="span" className="drop-text" text="drop media or click to browse" hover />
          </>
        )}
      </div>

      {mediaInfo && <MediaInfoCard info={mediaInfo} mediaType={mediaInfo ? detectMediaType(mediaInfo) : null} />}

      {/* ── TRANSCRIBE MODE ── */}
      {mode === "transcribe" && (
        <>
          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᛟ</span>
            <span className="section-heading-label">transcription</span>
          </div>

          {/* Model selector */}
          <div className="card" onContextMenu={handleModelContext}>
            <label className="label">model</label>
            <Dropdown
              options={models.map((m) => ({
                value: m.id,
                label: `${m.label}${m.installed ? "  ✓" : ""}`,
                category: m.category,
              }))}
              value={modelId}
              onChange={setModelId}
              showCategories
            />
            {selectedModel && !modelIsInstalled && (
              <div className="whisper-model-hint">
                {selectedModel.label} isn't installed — open the manager below to download it.
              </div>
            )}
          </div>

          <ModelManager
            selectedId={modelId}
            onSelect={setModelId}
            allowDelete={!transcribing}
          />

          {/* Language + translate */}
          <div className="card">
            <label className="label">source language</label>
            <Dropdown
              options={LANGUAGE_OPTIONS.map((l) => ({ value: l.value, label: l.label }))}
              value={language}
              onChange={setLanguage}
            />
            <div className="row settings-toggle-row">
              <label className="toggle-label">
                translate to english
                {translateDisabled && <span className="toggle-hint"> (source is english)</span>}
              </label>
              <button
                className={`btn toggle-btn${translateToEnglish && !translateDisabled ? " active" : ""}`}
                disabled={translateDisabled}
                onClick={() => setTranslateToEnglish((v) => !v)}
              >
                {translateToEnglish && !translateDisabled ? "on" : "off"}
              </button>
            </div>
          </div>

          {/* Output format + dir */}
          <div className="card">
            <label className="label">output format</label>
            <Dropdown
              options={OUTPUT_FORMAT_OPTIONS}
              value={outputFormat}
              onChange={setOutputFormat}
            />
          </div>

          <div className="card" onContextMenu={handleOutputContext}>
            <label className="label">output folder</label>
            <div className="row">
              <input className="input" value={outputDir} placeholder="drag & drop or browse" readOnly />
              <button className="btn" onClick={browseOutputDir}>browse</button>
            </div>
          </div>

          {/* Transcribe button */}
          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᛟ</span>
            <span className="section-heading-label">output</span>
          </div>

          <div className="convert-actions">
            <button
              className="btn btn-primary"
              disabled={!canTranscribe}
              onClick={handleTranscribe}
              onMouseEnter={() => setBtnHover(true)}
              onMouseLeave={() => setBtnHover(false)}
            >
              {transcribing ? "transcribing..." : <ScrambleText text="transcribe" trigger={btnHover} ticks={4} />}
            </button>
            {transcribing && (
              <button className="btn btn-cancel" onClick={() => cancelTranscription()} title="cancel">
                ■
              </button>
            )}
          </div>
        </>
      )}

      {/* ── BURN MODE ── */}
      {mode === "burn" && (
        <>
          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᛦ</span>
            <span className="section-heading-label">subtitle file</span>
          </div>

          {/* Subtitle file drop zone */}
          <div
            className={`sub-file-zone${subIsDragOver ? " drag-over" : ""}${subtitlePath ? " has-file" : ""}`}
            onClick={pickSubtitleFile}
          >
            {subtitlePath ? (
              <>
                <span className="sub-file-rune">ᛊ</span>
                <span className="sub-file-name">{subtitlePath.split(/[/\\]/).pop()}</span>
                <span className="sub-file-change">change</span>
                <button
                  className="sub-file-clear"
                  onClick={(e) => { e.stopPropagation(); setSubtitlePath(""); }}
                  title="clear"
                >
                  ✕
                </button>
              </>
            ) : (
              <>
                <span className="sub-file-rune">ᛉ</span>
                <span className="sub-file-name" style={{ color: "var(--fg-dim)" }}>
                  drop subtitle file or click to browse (.srt, .vtt, .ass)
                </span>
              </>
            )}
          </div>

          {/* Subtitle style panel */}
          <SubtitleStylePanel
            value={subtitleStyle}
            onChange={setSubtitleStyle}
          />

          {/* Preview */}
          <div className="card">
            <label className="label">preview</label>
            <div className="sub-style-inline" style={{ marginBottom: 10 }}>
              <label>seek time (s)</label>
              <input
                className="input"
                type="number"
                min={0}
                max={99999}
                step={1}
                value={previewSeek}
                onChange={(e) => setPreviewSeek(Math.max(0, Number(e.target.value)))}
                style={{ width: 90 }}
              />
              <button
                className="btn"
                disabled={!inputPath || !subtitlePath || previewLoading}
                onClick={handleGeneratePreview}
              >
                {previewLoading ? "rendering..." : "generate preview"}
              </button>
            </div>
            {previewLoading && (
              <div className="preview-status">rendering preview frame…</div>
            )}
            {previewUrl && !previewLoading && (
              <img
                className="preview-img"
                src={previewUrl}
                alt="subtitle burn preview"
              />
            )}
          </div>

          {/* Output settings */}
          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᛟ</span>
            <span className="section-heading-label">output</span>
          </div>

          <div className="card">
            <label className="label">output format</label>
            <Dropdown
              options={[
                { value: "mp4", label: "mp4", category: "video" },
                { value: "mkv", label: "mkv", category: "video" },
                { value: "mov", label: "mov", category: "video" },
                { value: "webm", label: "webm", category: "video" },
              ]}
              value={burnOutputFormat}
              onChange={(v) => setBurnOutputFormat(v as string)}
            />
          </div>

          <div className="card" onContextMenu={handleBurnOutputContext}>
            <label className="label">output folder</label>
            <div className="row">
              <input className="input" value={burnOutputDir} placeholder="drag & drop or browse" readOnly />
              <button className="btn" onClick={browseBurnOutputDir}>browse</button>
            </div>
          </div>

          <div className="convert-actions">
            <button
              className="btn btn-primary"
              disabled={!canBurn}
              onClick={handleBurn}
            >
              {burning ? "burning..." : "ᛦ  burn"}
            </button>
          </div>
        </>
      )}

      {/* ── EMBED MODE ── */}
      {mode === "embed" && (
        <>
          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᛇ</span>
            <span className="section-heading-label">subtitle file</span>
          </div>

          {/* Subtitle file drop zone */}
          <div
            className={`sub-file-zone${subIsDragOver ? " drag-over" : ""}${subtitlePath ? " has-file" : ""}`}
            onClick={pickSubtitleFile}
          >
            {subtitlePath ? (
              <>
                <span className="sub-file-rune">ᛊ</span>
                <span className="sub-file-name">{subtitlePath.split(/[/\\]/).pop()}</span>
                <span className="sub-file-change">change</span>
                <button
                  className="sub-file-clear"
                  onClick={(e) => { e.stopPropagation(); setSubtitlePath(""); }}
                  title="clear"
                >
                  ✕
                </button>
              </>
            ) : (
              <>
                <span className="sub-file-rune">ᛉ</span>
                <span className="sub-file-name" style={{ color: "var(--fg-dim)" }}>
                  drop subtitle file or click to browse (.srt, .vtt, .ass)
                </span>
              </>
            )}
          </div>

          {/* Language + output */}
          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᛟ</span>
            <span className="section-heading-label">options</span>
          </div>

          <div className="card">
            <label className="label">language tag</label>
            <Dropdown
              options={EMBED_LANG_OPTIONS}
              value={embedLang}
              onChange={setEmbedLang}
            />
          </div>

          <div className="card" onContextMenu={handleEmbedOutputContext}>
            <label className="label">output folder</label>
            <div className="row">
              <input className="input" value={embedOutputDir} placeholder="drag & drop or browse" readOnly />
              <button className="btn" onClick={browseEmbedOutputDir}>browse</button>
            </div>
          </div>

          <div className="convert-actions">
            <button
              className="btn btn-primary"
              disabled={!canEmbed}
              onClick={handleEmbed}
            >
              {embedding ? "embedding..." : "ᛇ  embed"}
            </button>
          </div>
        </>
      )}

      {/* ── EXTRACT MODE ── */}
      {mode === "extract" && (
        <>
          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᛉ</span>
            <span className="section-heading-label">subtitle streams</span>
          </div>

          {subtitleStreams.length > 0 ? (
            <div className="sub-stream-card">
              <div className="sub-stream-header">
                {subtitleStreams.length} subtitle stream{subtitleStreams.length !== 1 ? "s" : ""} detected
              </div>
              <div className="sub-stream-list">
                {subtitleStreams.map((s) => {
                  const fmt = extractStreamFormats[s.index] ?? "srt";
                  const isExtractingThis = extracting === s.index;
                  return (
                    <div key={s.index} className="sub-stream-row">
                      <span className="sub-stream-index">#{s.index}</span>
                      <div className="sub-stream-info">
                        <span className="sub-stream-codec">{s.codec}</span>
                        <span className="sub-stream-lang">{s.language ?? "undetermined"}</span>
                      </div>
                      <div className="sub-stream-actions">
                        <Dropdown
                          options={EXTRACT_FORMAT_OPTIONS}
                          value={fmt}
                          onChange={(v) =>
                            setExtractStreamFormats((prev) => ({ ...prev, [s.index]: v as string }))
                          }
                        />
                        <button
                          className="btn"
                          disabled={!canExtract || isExtractingThis}
                          onClick={() => handleExtract(s.index)}
                        >
                          {isExtractingThis ? "..." : "extract"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="card">
              {inputPath ? (
                <p className="sub-stream-empty">no subtitle streams found in this file</p>
              ) : (
                <p className="sub-stream-empty">select a video file to see its subtitle streams</p>
              )}
            </div>
          )}

          {/* Extract results */}
          {extractResults.length > 0 && (
            <div className="subtitle-results">
              <div className="subtitle-results-header">
                <span className="label">extracted files</span>
              </div>
              {extractResults.map((r) => (
                <div
                  key={r.jobId}
                  className="result-bar"
                  onContextMenu={(e) => handleResultContext(e, r.outputPath)}
                >
                  <span className="result-path">
                    ᛊ {r.outputPath.split(/[/\\]/).pop()}
                  </span>
                  <button
                    className="btn"
                    onClick={() => revealItemInDir(r.outputPath)}
                  >
                    show
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── EDIT MODE ── */}
      {mode === "edit" && (
        <>
          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᚷ</span>
            <span className="section-heading-label">transcript editor</span>
          </div>

          {editorSaveMsg && (
            <div className="alert-success" onClick={() => setEditorSaveMsg(null)} style={{ cursor: "pointer" }}>
              ✓ {editorSaveMsg}
            </div>
          )}

          {editorError && (
            <div className="alert-error" onClick={() => setEditorError(null)} style={{ cursor: "pointer" }}>
              ! {editorError}
            </div>
          )}

          <TranscriptEditor
            cues={editorCues}
            onChange={setEditorCues}
            filePath={editorFilePath}
            videoPath={editorVideoPath}
            onSetVideoPath={setEditorVideoPath}
            onSave={async (cues, path, asVtt) => {
              setEditorSaveMsg(null);
              setEditorError(null);
              try {
                const content = asVtt ? serializeVtt(cues) : serializeSrt(cues);
                if (path) {
                  await invoke("save_subtitle_file", { path, content });
                  setEditorSaveMsg(`Saved to ${path.split(/[/\\]/).pop()}`);
                } else {
                  // No file path — trigger save-as
                  const dest = await open({
                    filters: [
                      { name: "SRT", extensions: ["srt"] },
                      { name: "VTT", extensions: ["vtt"] },
                    ],
                    multiple: false,
                  });
                  if (dest) {
                    const destPath = dest as string;
                    const isVtt = destPath.endsWith(".vtt");
                    const c = isVtt ? serializeVtt(cues) : serializeSrt(cues);
                    await invoke("save_subtitle_file", { path: destPath, content: c });
                    setEditorFilePath(destPath);
                    setEditorSaveMsg(`Saved to ${destPath.split(/[/\\]/).pop()}`);
                  }
                }
                return true;
              } catch (e) {
                setEditorError(typeof e === "string" ? e : "Save failed");
                return false;
              }
            }}
            onAutoSave={async (cues) => {
              try {
                const data: TranscriptEditorRecovery = {
                  cues,
                  filePath: editorFilePath ?? undefined,
                  videoPath: editorVideoPath ?? undefined,
                  savedAt: Date.now(),
                };
                await invoke("recovery_save_subtitle_editor", {
                  data: JSON.stringify(data),
                });
              } catch {
                // Silent — auto-save is best-effort
              }
            }}
          />

          {/* Subtitle file drop zone for loading into editor */}
          {editorCues.length === 0 && (
            <div
              className={`sub-file-zone${subIsDragOver ? " drag-over" : ""}${editorFilePath ? " has-file" : ""}`}
              onClick={pickSubtitleForEdit}
              style={{ marginTop: 16 }}
            >
              <span className="sub-file-rune">ᛊ</span>
              <span className="sub-file-name" style={{ color: "var(--fg-dim)" }}>
                drop a subtitle file or click to browse (.srt, .vtt, .ass)
              </span>
            </div>
          )}
        </>
      )}

      {/* ── Shared: error ── */}
      {(error || (mode === "transcribe" && whisperError)) && (
        <div
          className="alert-error"
          onClick={() => { clearError(); setError(null); }}
          style={{ cursor: "pointer" }}
        >
          ! {error ?? whisperError}
        </div>
      )}

      {/* ── Shared: progress ── */}
      {isRunning && (
        <div className="progress-bar-container">
          <div className="progress-bar" style={{ width: `${activeProgress * 100}%` }} />
          <span className="progress-text">{Math.round(activeProgress * 100)}%</span>
        </div>
      )}

      {/* ── Shared: log panel ── */}
      {activeLog.length > 0 && (
        <LogPanel lines={activeLog} onContextMenu={handleLogContext} />
      )}

      {/* ── Shared: results (transcribe / burn / embed) ── */}
      {mode === "transcribe" && lastResult && !transcribing && (
        <div className="subtitle-results">
          <div className="subtitle-results-header">
            <span className="label">generated files</span>
            <span className="subtitle-results-lang">
              {translateToEnglish ? "english" : LANGUAGE_LABEL[language] ?? language}
            </span>
            <button
              className="btn"
              title={lastResult.outputDir}
              onClick={() => lastResult.outputDir && revealItemInDir(lastResult.outputDir).catch(() => {})}
            >
              show in folder
            </button>
          </div>
          {lastResult.srtPath && (
            <div className="result-bar" onContextMenu={(e) => handleResultContext(e, lastResult.srtPath!)}>
              <span className="result-path">ᛊ srt — {lastResult.srtPath.split(/[/\\]/).pop()}</span>
              <button className="btn" onClick={() => revealItemInDir(lastResult.srtPath!)}>
                show
              </button>
            </div>
          )}
          {lastResult.vttPath && (
            <div className="result-bar" onContextMenu={(e) => handleResultContext(e, lastResult.vttPath!)}>
              <span className="result-path">ᛊ vtt — {lastResult.vttPath.split(/[/\\]/).pop()}</span>
              <button className="btn" onClick={() => revealItemInDir(lastResult.vttPath!)}>
                show
              </button>
            </div>
          )}
          {lastResult.jsonPath && (
            <div className="result-bar" onContextMenu={(e) => handleResultContext(e, lastResult.jsonPath!)}>
              <span className="result-path">ᛊ json — {lastResult.jsonPath.split(/[/\\]/).pop()}</span>
              <button className="btn" onClick={() => revealItemInDir(lastResult.jsonPath!)}>
                show
              </button>
            </div>
          )}
          {!lastResult.srtPath && !lastResult.vttPath && !lastResult.jsonPath && (
            <div className="result-bar">
              <span className="result-path">! no files were written — check the log above for the paths whisper tried</span>
              <button
                className="btn"
                title={lastResult.outputDir}
                onClick={() => lastResult.outputDir && revealItemInDir(lastResult.outputDir).catch(() => {})}
              >
                open folder
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "burn" && burnResult && !burning && (
        <div className="subtitle-results">
          <div className="subtitle-results-header">
            <span className="label">burned file</span>
            <button className="btn" onClick={() => revealItemInDir(burnResult!)}>
              show in folder
            </button>
          </div>
          <div className="result-bar" onContextMenu={(e) => handleResultContext(e, burnResult!)}>
            <span className="result-path">ᛦ {burnResult.split(/[/\\]/).pop()}</span>
            <button className="btn" onClick={() => revealItemInDir(burnResult!)}>
              show
            </button>
          </div>
        </div>
      )}

      {mode === "embed" && embedResult && !embedding && (
        <div className="subtitle-results">
          <div className="subtitle-results-header">
            <span className="label">embedded file</span>
            <button className="btn" onClick={() => revealItemInDir(embedResult.outputPath)}>
              show in folder
            </button>
          </div>
          <div className="result-bar" onContextMenu={(e) => handleResultContext(e, embedResult.outputPath)}>
            <span className="result-path">ᛇ {embedResult.outputPath.split(/[/\\]/).pop()}</span>
            <button className="btn" onClick={() => revealItemInDir(embedResult.outputPath)}>
              show
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
