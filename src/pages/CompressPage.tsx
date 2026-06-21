import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useGaldrStore } from "../store";
import CustomSelect from "../components/CustomSelect";
import Dropdown from "../components/Dropdown";
import ScrambleText from "../components/ScrambleText";
import MediaPreview from "../components/MediaPreview";
import MediaInfoCard from "../components/MediaInfoCard";
import CompressionControls from "../components/CompressionControls";
import CommandPreview from "../components/CommandPreview";
import LogPanel from "../components/LogPanel";
import PresetPicker from "../components/PresetPicker";
import { EXT_OPTIONS, FMT_OPTIONS } from "../options";
import { useContextMenu } from "../components/ContextMenu";
import type { MediaInfo, PresetParams, ConversionParams, ScannedFile, BatchProgress } from "../types";

const FORMAT_OPTIONS = [
  { value: "mp4", label: "mp4 (video)", type: "video" as const },
  { value: "mkv", label: "mkv (video)", type: "video" as const },
  { value: "webm", label: "webm (video)", type: "video" as const },
  { value: "gif", label: "gif (video)", type: "video" as const },
  { value: "mp3", label: "mp3 (audio)", type: "audio" as const },
  { value: "flac", label: "flac (audio)", type: "audio" as const },
  { value: "aac", label: "aac (audio)", type: "audio" as const },
  { value: "ogg", label: "ogg (audio)", type: "audio" as const },
  { value: "opus", label: "opus (audio)", type: "audio" as const },
  { value: "jpg", label: "jpg (image)", type: "image" as const },
  { value: "png", label: "png (image)", type: "image" as const },
  { value: "webp", label: "webp (image)", type: "image" as const },
  { value: "avif", label: "avif (image)", type: "image" as const },
];

type MediaType = "video" | "audio" | "image" | null;

function detectMediaType(mi: MediaInfo): MediaType {
  const imageCodecs = ["png", "jpeg", "gif", "bmp", "tiff", "webp", "avif"];
  const isImage = mi.container.includes("image") ||
    (mi.duration === 0 && mi.streams.some((s) => imageCodecs.includes(s.codec)));
  if (isImage) return "image";
  if (mi.streams.some((s) => s.kind === "audio") &&
    !mi.streams.some((s) => s.kind === "video")) return "audio";
  return "video";
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function defaultFormat(mt: MediaType): string {
  if (mt === "image") return "webp";
  if (mt === "audio") return "mp3";
  return "mp4";
}

/* ── Batch helpers ── */

function parentPath(p: string): string {
  const n = p.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(0, i) : p;
}

function mostCommonExtension(
  files: ScannedFile[],
  supported: { value: string }[],
): string {
  const supportedSet = new Set(supported.map((o) => o.value));
  const counts = new Map<string, number>();
  for (const f of files) {
    const dot = f.name.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = f.name.slice(dot + 1).toLowerCase();
    if (supportedSet.has(ext)) counts.set(ext, (counts.get(ext) || 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [ext, c] of counts) {
    if (c > bestCount) {
      best = ext;
      bestCount = c;
    }
  }
  return best;
}

type NavigateFn = (page: "runes") => void;

export default function CompressPage({ onNavigate }: { onNavigate?: NavigateFn }) {
  const {
    outputDir, ffmpegFound, isConverting, conversionProgress,
    lastOutputPath, error,
    setOutputDir, setIsConverting,
    setConversionProgress, setLastOutputPath, setError, setFfmpegFound,
  } = useGaldrStore();

  /* ── Mode ── */
  const [mode, setMode] = useState<"file" | "batch">("file");

  /* ── File mode state ── */
  const [inputPath, setInputPath] = useState("");
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [mediaType, setMediaType] = useState<MediaType>(null);
  const [quality, setQuality] = useState(0.5);
  const [compressionMode, setCompressionMode] = useState<"quality" | "targetSize">("quality");
  const [targetSizeValue, setTargetSizeValue] = useState(50);
  const [targetSizeUnit, setTargetSizeUnit] = useState<"MB" | "KB">("MB");
  const [outputFormat, setOutputFormat] = useState("mp4");
  const [filteredOptions, setFilteredOptions] = useState(FORMAT_OPTIONS);
  const [estimate, setEstimate] = useState<{ original: number; estimated: number; can_compress: boolean } | null>(null);
  const [compressedInfo, setCompressedInfo] = useState<MediaInfo | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [btnHover, setBtnHover] = useState(false);
  const { show } = useContextMenu();

  /* ── Batch mode state ── */
  const [inputDir, setInputDir] = useState("");
  const [batchOutputDir, setBatchOutputDir] = useState("");
  const [inputExt, setInputExt] = useState("mp4");
  const [batchFiles, setBatchFiles] = useState<ScannedFile[]>([]);
  const [scanning, setScanning] = useState(false);
  const [batchConverting, setBatchConverting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchLog, setBatchLog] = useState<string[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [isBatchDragOver, setIsBatchDragOver] = useState(false);
  const [batchSkipCount, setBatchSkipCount] = useState(0);
  const [scanBtnHover, setScanBtnHover] = useState(false);
  const [batchConvBtnHover, setBatchConvBtnHover] = useState(false);
  const scanningRef = useRef(false);
  const loadDirRef = useRef<any>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);
  const batchPrevDoneRef = useRef(0);

  const extType = EXT_OPTIONS.find((e) => e.value === inputExt)?.type;

  /* ── FFmpeg detection ── */
  useEffect(() => {
    invoke<boolean>("detect_ffmpeg").then(setFfmpegFound);
  }, [setFfmpegFound]);

  /* ── File mode event listeners ── */
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<{ job_id: string; progress: number }>(
        "conversion-progress",
        (e) => {
          if (mode !== "file") return;
          setConversionProgress(e.payload.progress);
          setLog((p) => {
            const pct = `${Math.round(e.payload.progress * 100)}%`;
            return p[p.length - 1] !== pct ? [...p, pct] : p;
          });
        },
      );
    })();
    return () => { if (unlisten) unlisten(); };
  }, [setConversionProgress, mode]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<{ message: string }>(
        "conversion-log",
        (e) => {
          if (mode !== "file") return;
          setLog((p) => [...p, e.payload.message]);
        },
      );
    })();
    return () => { if (unlisten) unlisten(); };
  }, [mode]);

  /* ── Batch mode event listeners ── */
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<BatchProgress>("batch-progress", (e) => {
        if (mode !== "batch") return;
        const p = e.payload;
        setBatchProgress(p);
        const completed = p.done + p.failed;
        if (completed > batchPrevDoneRef.current && p.current_file) {
          setBatchLog((prev) => [...prev, `> ${p.current_file} (${p.done}/${p.total})`]);
        }
        batchPrevDoneRef.current = completed;
        if (p.file_progress >= 1.0 && !p.current_file) {
          setBatchLog((prev) => [...prev, `> batch complete — ${p.done} ok, ${p.failed} failed`]);
        }
      });
    })();
    return () => { if (unlisten) unlisten(); };
  }, [mode]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<{ message: string }>(
        "batch-log",
        (e) => {
          if (mode !== "batch") return;
          setBatchLog((prev) => [...prev, e.payload.message]);
        },
      );
    })();
    return () => { if (unlisten) unlisten(); };
  }, [mode]);

  /* ── Auto-scroll active batch row ── */
  useEffect(() => {
    if (activeRowRef.current && fileListRef.current) {
      activeRowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [batchProgress?.current_file]);

  /* ── Auto-adjust output format for batch ── */
  useEffect(() => {
    if (!FMT_OPTIONS.some((o) => o.type === extType && o.value === outputFormat)) {
      setOutputFormat(FMT_OPTIONS.find((o) => o.type === extType)?.value ?? "mp4");
    }
  }, [extType, outputFormat]);

  /* ── Update skip count when batch finishes ── */
  useEffect(() => {
    if (!batchConverting && batchProgress && (batchProgress.done + batchProgress.failed) > 0) {
      setBatchSkipCount(batchProgress.done + batchProgress.failed);
    }
  }, [batchConverting, batchProgress]);

  /* ── File mode: media type detection ── */
  useEffect(() => {
    if (!mediaInfo) {
      setFilteredOptions(FORMAT_OPTIONS);
      setMediaType(null);
      return;
    }
    const mt = detectMediaType(mediaInfo);
    setMediaType(mt);
    let allowed: Set<string>;
    if (mt === "image") allowed = new Set(["image"]);
    else if (mt === "audio") allowed = new Set(["audio"]);
    else allowed = new Set(["video", "audio", "image"]);
    const filtered = FORMAT_OPTIONS.filter((o) => allowed.has(o.type));
    setFilteredOptions(filtered);
    if (!filtered.some((o) => o.value === outputFormat)) {
      const ext = inputPath.split("/").pop()?.split(".").pop()?.toLowerCase();
      let match = filtered.find((o) => o.value === ext);
      setOutputFormat(match?.value ?? defaultFormat(mt));
    }
  }, [mediaInfo]);

  /* ── File mode: size estimation ── */
  useEffect(() => {
    if (!inputPath) { setEstimate(null); return; }
    const targetSizeBytes = compressionMode === "targetSize"
      ? targetSizeValue * (targetSizeUnit === "MB" ? 1024 * 1024 : 1024)
      : undefined;
    const t = setTimeout(async () => {
      try {
        type EstimateResult = { original_size: number; estimated_size: number; can_compress: boolean };
        const r = await invoke<EstimateResult>(
          "estimate_compress_size", {
            path: inputPath,
            quality,
            outputFormat,
            targetSizeBytes,
          },
        );
        setEstimate({ original: r.original_size, estimated: r.estimated_size, can_compress: r.can_compress });
      } catch { setEstimate(null); }
    }, 300);
    return () => clearTimeout(t);
  }, [inputPath, quality, outputFormat, compressionMode, targetSizeValue, targetSizeUnit]);

  /* ── File mode: load file ── */
  const loadFile = useCallback(async (path: string) => {
    setError(null);
    setLog([]);
    setLastOutputPath(null);
    setCompressedInfo(null);
    setInputPath(path);
    try {
      const info = await invoke<MediaInfo>("get_media_info", { path });
      setMediaInfo(info);
      const mt = detectMediaType(info);
      setOutputFormat(defaultFormat(mt));
    } catch (e) {
      setMediaInfo(null);
      setError(String(e));
    }
  }, [setError, setLastOutputPath]);

  const pickFile = useCallback(async () => {
    const sel = await open({
      multiple: false,
      filters: [{ name: "Media", extensions: [
        "mp4","mkv","avi","mov","webm","m4v","flv","ogv","wmv","ts","3gp","mod",
        "mp3","flac","wav","aac","ogg","opus","wma","m4a","aiff","ac3","dts",
        "png","jpg","jpeg","webp","gif","bmp","tiff","avif","svg",
      ] }],
    });
    if (sel) loadFile(sel as string);
  }, [loadFile]);

  /* ── Drag-and-drop (both modes) ── */
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(
        await listen("tauri://drag-enter", () => {
          if (mode === "file") setIsDragOver(true);
          else setIsBatchDragOver(true);
        }),
      );
      unlisteners.push(
        await listen("tauri://drag-leave", () => {
          setIsDragOver(false);
          setIsBatchDragOver(false);
        }),
      );
      unlisteners.push(
        await listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
          setIsDragOver(false);
          setIsBatchDragOver(false);
          const path = e.payload.paths?.[0];
          if (!path) return;
          if (mode === "file") {
            loadFile(path);
          } else {
            invoke<boolean>("is_directory", { path }).then((isDir) => {
              loadDirRef.current(isDir ? path : parentPath(path));
            });
          }
        }),
      );
    })();
    return () => { unlisteners.forEach((u) => u()); };
  }, [mode, loadFile]);

  /* ── File mode: convert ── */
  const convert = useCallback(async () => {
    if (!inputPath) return;

    let dir = outputDir;
    if (!dir) {
      const defaultDir = await invoke<string>("get_default_output_dir");
      const picked = await open({ directory: true, multiple: false, defaultPath: defaultDir });
      if (!picked) return;
      dir = picked as string;
      setOutputDir(dir);
    }

    const typeDir = mediaType ? `${dir}/${mediaType}` : dir;

    const targetSizeBytes = compressionMode === "targetSize"
      ? targetSizeValue * (targetSizeUnit === "MB" ? 1024 * 1024 : 1024)
      : undefined;

    const params = {
      input_path: inputPath,
      output_dir: typeDir,
      output_format: outputFormat,
      quality: compressionMode === "quality" ? quality : undefined,
      target_size_bytes: targetSizeBytes,
    };

    setIsConverting(true);
    setError(null);
    setLog(["> compress"]);
    setLastOutputPath(null);
    setConversionProgress(0);
    try {
      const r = await invoke<{ job_id: string; output_path: string }>(
        "start_conversion", { params },
      );
      setLog((p) => [...p, `> ${r.output_path}`]);
      setLastOutputPath(r.output_path);
      try {
        const cinfo = await invoke<MediaInfo>("get_media_info", { path: r.output_path });
        setCompressedInfo(cinfo);
      } catch {
        // preview not available
      }
    } catch (e) {
      const m = typeof e === "string" ? e : "failed";
      setLog((p) => [...p, `! ${m}`]);
      setError(m);
    } finally {
      setIsConverting(false);
    }
  }, [inputPath, outputDir, mediaType, outputFormat, quality, compressionMode, targetSizeValue, targetSizeUnit, setOutputDir, setIsConverting, setError, setLastOutputPath, setConversionProgress]);

  /* ── Batch mode: folder operations ── */
  const pickInput = async () => {
    const sel = await open({ directory: true, multiple: false });
    if (sel) loadDir(sel as string);
  };

  const pickOutput = async () => {
    const sel = await open({ directory: true, multiple: false });
    if (sel) setBatchOutputDir(sel as string);
  };

  const loadDir = useCallback(async (dir: string) => {
    setInputDir(dir);
    setBatchOutputDir(dir.replace(/[\\/]+$/, "").replace(/\\/g, "/") + "/output");
    setBatchSkipCount(0);
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    setBatchError(null);
    setBatchFiles([]);
    setBatchProgress(null);
    try {
      const result = await invoke<ScannedFile[]>("scan_directory", {
        dir,
        extension: "",
      });
      const top = mostCommonExtension(result, EXT_OPTIONS);
      if (top) setInputExt(top);
      setBatchFiles(result);
      setBatchLog((p) => [...p, `> scanned ${result.length} files, auto-detected .${top}`]);
    } catch (e) {
      setBatchError(String(e));
      setBatchLog((p) => [...p, `! scan failed: ${e}`]);
    } finally {
      setScanning(false);
      scanningRef.current = false;
    }
  }, []);
  loadDirRef.current = loadDir;

  const scan = useCallback(async () => {
    if (!inputDir) return;
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    setBatchError(null);
    setBatchFiles([]);
    setBatchProgress(null);
    setBatchSkipCount(0);
    try {
      const result = await invoke<ScannedFile[]>("scan_directory", {
        dir: inputDir,
        extension: "",
      });
      setBatchFiles(result);
      setBatchLog((p) => [...p, `> scanned ${result.length} files`]);
    } catch (e) {
      setBatchError(String(e));
      setBatchLog((p) => [...p, `! scan failed: ${e}`]);
    } finally {
      setScanning(false);
      scanningRef.current = false;
    }
  }, [inputDir]);

  /* ── Batch mode: convert all ── */
  const convertAll = useCallback(async () => {
    if (!inputDir || !batchOutputDir || batchFiles.length === 0) return;
    setBatchConverting(true);
    setBatchError(null);
    setBatchLog(["> batch compress start"]);
    setBatchProgress(null);
    batchPrevDoneRef.current = batchSkipCount;
    try {
      await invoke("start_batch_conversion", {
        params: {
          input_dir: inputDir,
          output_dir: batchOutputDir,
          input_extension: inputExt,
          output_format: outputFormat,
          quality: compressionMode === "quality" ? quality : undefined,
          target_size_bytes: targetSizeBytes,
          skip: batchSkipCount,
        },
      });
      setBatchLog((p) => [...p, "> batch compress done"]);
    } catch (e) {
      setBatchError(String(e));
      setBatchLog((p) => [...p, `! ${e}`]);
    } finally {
      setBatchConverting(false);
    }
  }, [inputDir, batchOutputDir, inputExt, outputFormat, quality, compressionMode, targetSizeValue, targetSizeUnit, batchFiles, batchSkipCount]);

  /* ── Batch mode: computed values ── */
  const canScan = !!inputDir && !scanning;
  const canConvert = !!inputDir && !!batchOutputDir && batchFiles.length > 0 && !batchConverting;
  const totalSize = batchFiles.reduce((s, f) => s + f.size, 0);
  const matchingCount = batchFiles.filter((f) => {
    const dot = f.name.lastIndexOf(".");
    if (dot < 0) return false;
    return f.name.slice(dot + 1).toLowerCase() === inputExt;
  }).length;

  /* ── Computed values for file mode ── */
  const sizeIncrease = estimate && estimate.estimated >= estimate.original;
  const btnDisabled = !inputPath || isConverting;

  /* ── Context menus (file mode) ── */
  const handleCompressDropZoneContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (inputPath) {
      show(e, [
        { label: "browse (replace)", rune: "ᛏ", action: pickFile },
        { label: "copy path", rune: "ᚷ", action: () => navigator.clipboard.writeText(inputPath) },
        { label: "", rune: "", action: () => {}, divider: true },
        { label: "clear", rune: "ᚨ", action: () => { setInputPath(""); setMediaInfo(null); setEstimate(null); setCompressedInfo(null); }},
        { label: "reveal in folder", rune: "ᚠ", action: () => invoke("reveal_in_folder", { path: inputPath }).catch(() => {}) },
      ]);
    } else {
      show(e, [
        { label: "browse files", rune: "ᚨ", action: pickFile },
        { label: "paste path", rune: "ᚷ", action: async () => {
          const text = await navigator.clipboard.readText();
          if (text) loadFile(text);
        }},
      ]);
    }
  }, [show, inputPath, pickFile, loadFile]);

  const handleCompressMediaInfoContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!mediaInfo) return;
    const streamInfo = mediaInfo.streams.map((s) => `[${s.kind}] ${s.codec}${s.width ? ` ${s.width}x${s.height}` : ""}`).join("\n");
    show(e, [
      { label: "copy stream info", rune: "ᚷ", action: () => navigator.clipboard.writeText(streamInfo) },
      { label: "copy file info", rune: "ᚨ", action: () => navigator.clipboard.writeText(`${mediaInfo.container} | ${mediaInfo.size}B`) },
    ]);
  }, [show, mediaInfo]);

  const handleEstimateContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!estimate) return;
    show(e, [
      { label: "copy sizes", rune: "ᚷ", action: () => navigator.clipboard.writeText(`${estimate.original} → ${estimate.estimated} bytes`) },
    ]);
  }, [show, estimate]);

  const handleCompressCommandContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "copy command", rune: "ᚷ", action: () => {
        const el = document.querySelector(".command-preview-code");
        if (el) navigator.clipboard.writeText(el.textContent || "");
      }},
    ]);
  }, [show]);

  const handleCompressResultContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!lastOutputPath) return;
    show(e, [
      { label: "show in folder", rune: "ᛏ", action: () => revealItemInDir(lastOutputPath) },
      { label: "copy path", rune: "ᚷ", action: () => navigator.clipboard.writeText(lastOutputPath) },
    ]);
  }, [show, lastOutputPath]);

  const handleCompressLogContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (log.length === 0) return;
    show(e, [
      { label: "copy all", rune: "ᚷ", action: () => navigator.clipboard.writeText(log.join("\n")) },
      { label: "clear", rune: "ᚨ", action: () => setLog([]) },
    ]);
  }, [show, log]);

  const handleCompressFfmpegAlertContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "retry detection", rune: "ᛏ", action: () => invoke<boolean>("detect_ffmpeg").then(setFfmpegFound) },
      { label: "copy message", rune: "ᚷ", action: () => navigator.clipboard.writeText("ffmpeg not found on PATH") },
    ]);
  }, [show, setFfmpegFound]);

  const handleQualitySliderContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: `copy value (${Math.round(quality * 100)}%)`, rune: "ᚷ", action: () => navigator.clipboard.writeText(`${Math.round(quality * 100)}%`) },
      { label: "reset to 50%", rune: "ᛏ", action: () => setQuality(0.5) },
      { label: "set to 100%", rune: "ᚨ", action: () => setQuality(1) },
      { label: "set to 0%", rune: "ᚷ", action: () => setQuality(0) },
    ]);
  }, [show, quality, setQuality]);

  const handleTargetSizeContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const val = `${targetSizeValue}${targetSizeUnit}`;
    show(e, [
      { label: `copy (${val})`, rune: "ᚷ", action: () => navigator.clipboard.writeText(val) },
      { label: "reset to 50 MB", rune: "ᛏ", action: () => { setTargetSizeValue(50); setTargetSizeUnit("MB"); } },
      { label: "switch to KB", rune: "ᚨ", action: () => setTargetSizeUnit("KB") },
      { label: "switch to MB", rune: "ᚷ", action: () => setTargetSizeUnit("MB") },
    ]);
  }, [show, targetSizeValue, targetSizeUnit, setTargetSizeValue, setTargetSizeUnit]);

  const handleCompressFormatCardContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: `copy format (${outputFormat})`, rune: "ᚷ", action: () => navigator.clipboard.writeText(outputFormat) },
      { label: "reset to mp4", rune: "ᛏ", action: () => setOutputFormat("mp4") },
    ]);
  }, [show, outputFormat, setOutputFormat]);

  const handleCompressAlertContext = useCallback((e: React.MouseEvent, msg: string) => {
    e.stopPropagation();
    show(e, [
      { label: "copy message", rune: "ᚷ", action: () => navigator.clipboard.writeText(msg) },
    ]);
  }, [show]);

  const handleCompressErrorContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!error) return;
    show(e, [
      { label: "copy error", rune: "ᚷ", action: () => navigator.clipboard.writeText(error) },
      { label: "dismiss", rune: "ᚨ", action: () => setError(null) },
    ]);
  }, [show, error, setError]);

  const handleCompressProgressContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isConverting) return;
    show(e, [
      { label: "cancel", rune: "ᛏ", action: () => invoke("cancel_conversion") },
      { label: `copy progress (${Math.round(conversionProgress * 100)}%)`, rune: "ᚷ", action: () => navigator.clipboard.writeText(`${Math.round(conversionProgress * 100)}%`) },
    ]);
  }, [show, isConverting, conversionProgress]);

  /* ── Context menus (batch mode) ── */
  const handleBatchInputDirContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "browse", rune: "ᚨ", action: pickInput },
      { label: "copy path", rune: "ᛏ", action: () => navigator.clipboard.writeText(inputDir) },
      ...(inputDir ? [{ label: "clear", rune: "ᚷ", action: () => { setInputDir(""); setBatchFiles([]); setBatchProgress(null); } }] : []),
    ]);
  }, [show, inputDir, pickInput]);

  const handleBatchOutputDirContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "browse", rune: "ᚨ", action: pickOutput },
      { label: "copy path", rune: "ᛏ", action: () => navigator.clipboard.writeText(batchOutputDir) },
      ...(batchOutputDir ? [{ label: "clear", rune: "ᚷ", action: () => setBatchOutputDir("") }] : []),
    ]);
  }, [show, batchOutputDir, pickOutput]);

  const handleBatchFileRowContext = useCallback((e: React.MouseEvent, f: ScannedFile) => {
    e.stopPropagation();
    const dot = f.name.lastIndexOf(".");
    const ext = dot >= 0 ? f.name.slice(dot + 1).toLowerCase() : "";
    show(e, [
      { label: `filter by .${ext}`, rune: "ᚷ", action: () => ext && setInputExt(ext) },
      { label: "copy name", rune: "ᚨ", action: () => navigator.clipboard.writeText(f.name) },
      { label: "copy path", rune: "ᛏ", action: () => navigator.clipboard.writeText(f.path) },
    ]);
  }, [show, setInputExt]);

  const handleBatchFileHeaderContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "copy all names", rune: "ᚷ", action: () => navigator.clipboard.writeText(batchFiles.map((f) => f.name).join("\n")) },
      { label: "copy all paths", rune: "ᚨ", action: () => navigator.clipboard.writeText(batchFiles.map((f) => f.path).join("\n")) },
    ]);
  }, [show, batchFiles]);

  const handleBatchLogContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (batchLog.length === 0) return;
    show(e, [
      { label: "copy all", rune: "ᚷ", action: () => navigator.clipboard.writeText(batchLog.join("\n")) },
      { label: "clear", rune: "ᚨ", action: () => setBatchLog([]) },
    ]);
  }, [show, batchLog]);

  const handleBatchCommandContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "copy command", rune: "ᚷ", action: () => {
        const el = document.querySelector(".command-preview-code");
        if (el) navigator.clipboard.writeText(el.textContent || "");
      }},
    ]);
  }, [show]);

  const handleBatchExtCardContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: `copy (${inputExt})`, rune: "ᚷ", action: () => navigator.clipboard.writeText(inputExt) },
      { label: "reset to mp4", rune: "ᛏ", action: () => setInputExt("mp4") },
    ]);
  }, [show, inputExt, setInputExt]);

  const handleBatchFmtCardContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: `copy (${outputFormat})`, rune: "ᚷ", action: () => navigator.clipboard.writeText(outputFormat) },
      { label: "reset to mp4", rune: "ᛏ", action: () => setOutputFormat("mp4") },
    ]);
  }, [show, outputFormat, setOutputFormat]);

  const handleBatchProgressContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!batchProgress) return;
    const summary = `${batchProgress.done + batchProgress.failed} / ${batchProgress.total} files (${batchProgress.failed} failed)`;
    show(e, [
      ...(batchConverting ? [{ label: "cancel batch", rune: "ᛏ", action: () => invoke("cancel_conversion") }] : []),
      { label: "copy summary", rune: "ᚷ", action: () => navigator.clipboard.writeText(summary) },
    ]);
  }, [show, batchProgress, batchConverting]);

  const handleBatchEmptyContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "browse folder", rune: "ᚨ", action: pickInput },
      { label: "paste path", rune: "ᚷ", action: async () => {
        const text = await navigator.clipboard.readText();
        if (text) loadDirRef.current(text);
      }},
    ]);
  }, [show, pickInput]);

  const handleBatchErrorContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!batchError) return;
    show(e, [
      { label: "copy error", rune: "ᚷ", action: () => navigator.clipboard.writeText(batchError) },
      { label: "dismiss", rune: "ᚨ", action: () => setBatchError(null) },
    ]);
  }, [show, batchError]);

  /* ── Rune presets ── */
  const targetSizeBytes = compressionMode === "targetSize"
    ? targetSizeValue * (targetSizeUnit === "MB" ? 1024 * 1024 : 1024)
    : undefined;

  const compressParams: ConversionParams = {
    input_path: inputPath,
    output_dir: outputDir,
    output_format: outputFormat,
    quality: compressionMode === "quality" ? quality : undefined,
    target_size_bytes: targetSizeBytes,
  };

  const batchParams: ConversionParams = {
    input_path: inputDir,
    output_dir: batchOutputDir,
    output_format: outputFormat,
    quality: compressionMode === "quality" ? quality : undefined,
    target_size_bytes: targetSizeBytes,
  };

  const handleApplyRune = useCallback((preset: PresetParams) => {
    if (preset.output_format) setOutputFormat(preset.output_format);
    if (preset.quality !== undefined) setQuality(preset.quality);
    if (preset.target_size_bytes !== undefined) {
      setCompressionMode("targetSize");
      setTargetSizeUnit("MB");
      setTargetSizeValue(preset.target_size_bytes / (1024 * 1024));
    }
  }, [setOutputFormat, setQuality]);

  /* ── Render ── */
  return (
    <div className="page">
      {/* Mode tabs */}
      <div className="mode-tabs">
        <button
          className={`mode-tab${mode === "file" ? " active" : ""}`}
          onClick={() => setMode("file")}
        >
          ᛉ file
        </button>
        <button
          className={`mode-tab${mode === "batch" ? " active" : ""}`}
          onClick={() => setMode("batch")}
        >
          ᚷ batch
        </button>
      </div>

      {/* FFmpeg alert (shared) */}
      {!ffmpegFound && (
        <div className="alert-error" onContextMenu={handleCompressFfmpegAlertContext}>! ffmpeg not found on PATH</div>
      )}

      {mode === "file" ? (
        /* ═══════════════ FILE MODE ═══════════════ */
        <>
          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᛟ</span>
            <span className="section-heading-label">input</span>
          </div>

          <div
            className={`drop-zone${isDragOver ? " drag-over" : ""}${inputPath ? " has-file" : ""}`}
            onClick={pickFile}
            onContextMenu={handleCompressDropZoneContext}
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
                <span className="drop-rune">ᛉ</span>
                <ScrambleText as="span" className="drop-text" text="drop media to compress or click to browse" hover />
              </>
            )}
          </div>

          <AnimatePresence>
            {mediaInfo && (
              <MediaInfoCard
                info={mediaInfo}
                mediaType={mediaType}
                onContextMenu={handleCompressMediaInfoContext}
              />
            )}
          </AnimatePresence>

          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᚠ</span>
            <span className="section-heading-label">settings</span>
          </div>

          <PresetPicker currentParams={compressParams} onApply={handleApplyRune} onManage={onNavigate ? () => onNavigate("runes") : undefined} />

          <CompressionControls
            mode={compressionMode}
            onModeChange={setCompressionMode}
            quality={quality}
            onQualityChange={setQuality}
            targetSizeValue={targetSizeValue}
            onTargetSizeValueChange={setTargetSizeValue}
            targetSizeUnit={targetSizeUnit}
            onTargetSizeUnitChange={setTargetSizeUnit}
            targetSizeBytes={targetSizeBytes ?? 0}
            estimatedDuration={mediaInfo?.duration}
            onQualitySliderContext={handleQualitySliderContext}
            onTargetSizeContext={handleTargetSizeContext}
          />

          {estimate && (
            <div className={`estimate-bar${sizeIncrease ? " estimate-warn" : ""}`} onContextMenu={handleEstimateContext}>
              <div className="estimate-labels">
                <span className="estimate-original">{fmtSize(estimate.original)}</span>
                <span className="estimate-arrow">→</span>
                <span className="estimate-result">{fmtSize(estimate.estimated)}</span>
                <span className="estimate-pct">
                  {sizeIncrease
                    ? `+${Math.round((estimate.estimated / estimate.original - 1) * 100)}% increase`
                    : `-${Math.round((1 - estimate.estimated / estimate.original) * 100)}%`}
                </span>
              </div>
              <div className="estimate-track">
                <div
                  className="estimate-fill"
                  style={{
                    width: `${Math.min(estimate.estimated / estimate.original * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="card" onContextMenu={handleCompressFormatCardContext}>
            <label className="label">output format</label>
            <CustomSelect
              options={filteredOptions}
              value={outputFormat}
              onChange={setOutputFormat}
            />
          </div>

          {estimate && !estimate.can_compress && !sizeIncrease && (
            <div className="alert-warn" onContextMenu={(e) => handleCompressAlertContext(e, "this combination may not reduce size — lowering quality or switching to a lossy format will help")}>
              ( this combination may not reduce size — lowering quality or switching to a lossy format will help )
            </div>
          )}

          {sizeIncrease && (
            <div className="alert-warn" onContextMenu={(e) => handleCompressAlertContext(e, `estimated output is larger than source — lower quality or switch to a more efficient format`)}>
              ! estimated output is larger than source — lower quality or switch to a more efficient format
            </div>
          )}

          {error && <div className="alert-error" onContextMenu={handleCompressErrorContext}>! {error}</div>}

          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᛟ</span>
            <span className="section-heading-label">output</span>
          </div>

          <div className="convert-actions">
            <button
              className={`btn btn-primary${sizeIncrease ? " btn-warn" : ""}`}
              disabled={btnDisabled}
              onClick={convert}
              onMouseEnter={() => setBtnHover(true)}
              onMouseLeave={() => setBtnHover(false)}
            >
              {isConverting ? "compressing..." : <ScrambleText text={sizeIncrease ? "compress anyway" : "compress"} trigger={btnHover} ticks={4} />}
            </button>
            {isConverting && (
              <button className="btn btn-cancel" onClick={() => invoke("cancel_conversion")} title="cancel">
                ■
              </button>
            )}
          </div>

          {isConverting && (
            <div className="progress-bar-container" onContextMenu={handleCompressProgressContext}>
              <div className="progress-bar" style={{ width: `${conversionProgress * 100}%` }} />
              <span className="progress-text">{Math.round(conversionProgress * 100)}%</span>
            </div>
          )}

          {log.length > 0 && (
            <LogPanel lines={log} onContextMenu={handleCompressLogContext} />
          )}

          {lastOutputPath && (
            <div className="result-bar" onContextMenu={handleCompressResultContext}>
              <span className="result-path">{lastOutputPath}</span>
              <button className="btn" onClick={() => revealItemInDir(lastOutputPath)}>
                show in folder
              </button>
            </div>
          )}

          {lastOutputPath && mediaInfo && compressedInfo && (
            <MediaPreview
              originalPath={inputPath}
              compressedPath={lastOutputPath}
              originalInfo={mediaInfo}
              compressedInfo={compressedInfo}
            />
          )}

          {inputPath && (
            <div onContextMenu={handleCompressCommandContext}>
              <CommandPreview params={{ input_path: inputPath, output_dir: outputDir || "", output_format: outputFormat, quality }} mediaType={mediaType} duration={mediaInfo?.duration} />
            </div>
          )}
        </>
      ) : (
        /* ═══════════════ BATCH MODE ═══════════════ */
        <div className={isBatchDragOver ? "batch-dragging" : ""}>
          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᚷ</span>
            <span className="section-heading-label">batch settings</span>
          </div>

          <div className="batch-layout">
            <div className="batch-left">

              <div className="card" onContextMenu={handleBatchInputDirContext}>
                <label className="label">input folder</label>
                <div className="row">
                  <input className="input" value={inputDir} placeholder="drag & drop folder, or browse" readOnly />
                  <button className="btn" onClick={pickInput}>browse</button>
                </div>
              </div>

              <div className="card" onContextMenu={handleBatchOutputDirContext}>
                <label className="label">output folder</label>
                <div className="row">
                  <input className="input" value={batchOutputDir} placeholder="drag & drop folder, or browse" readOnly />
                  <button className="btn" onClick={pickOutput}>browse</button>
                </div>
              </div>

              <PresetPicker currentParams={batchParams} onApply={handleApplyRune} onManage={onNavigate ? () => onNavigate("runes") : undefined} />

              <CompressionControls
                mode={compressionMode}
                onModeChange={setCompressionMode}
                quality={quality}
                onQualityChange={setQuality}
                targetSizeValue={targetSizeValue}
                onTargetSizeValueChange={setTargetSizeValue}
                targetSizeUnit={targetSizeUnit}
                onTargetSizeUnitChange={setTargetSizeUnit}
                targetSizeBytes={targetSizeBytes ?? 0}
                onQualitySliderContext={handleQualitySliderContext}
                onTargetSizeContext={handleTargetSizeContext}
              />

              <div className="batch-format-row">
                <div className="card batch-card" onContextMenu={handleBatchExtCardContext}>
                  <label className="label">input extension</label>
                  <Dropdown
                    options={EXT_OPTIONS}
                    value={inputExt}
                    onChange={setInputExt}
                    showCategories
                  />
                </div>
                <div className="card batch-card" onContextMenu={handleBatchFmtCardContext}>
                  <label className="label">output format</label>
                  <CustomSelect
                    options={FORMAT_OPTIONS}
                    value={outputFormat}
                    onChange={setOutputFormat}
                  />
                </div>
              </div>

              <div className="batch-scan-row">
                <button
                  className="btn btn-primary"
                  disabled={!canScan}
                  onClick={scan}
                  onMouseEnter={() => setScanBtnHover(true)}
                  onMouseLeave={() => setScanBtnHover(false)}
                >
                  {scanning ? "scanning..." : <ScrambleText text="scan folder" trigger={scanBtnHover} ticks={4} />}
                </button>
              </div>

              {batchFiles.length > 0 && (
                <div className="convert-actions">
                  <button
                    className="btn btn-primary"
                    disabled={!canConvert}
                    onClick={convertAll}
                    onMouseEnter={() => setBatchConvBtnHover(true)}
                    onMouseLeave={() => setBatchConvBtnHover(false)}
                  >
                    {batchConverting ? "compressing..." : <ScrambleText text={`compress ${matchingCount} file${matchingCount !== 1 ? "s" : ""}`} trigger={batchConvBtnHover} ticks={4} />}
                  </button>
                  {batchConverting && (
                    <button className="btn btn-cancel" onClick={() => invoke("cancel_conversion")} title="cancel">
                      ■
                    </button>
                  )}
                </div>
              )}

              {batchProgress && (
                <div className="card" onContextMenu={handleBatchProgressContext}>
                  <label className="label">progress</label>
                  <div className="batch-progress-info">
                    {batchProgress.done + batchProgress.failed} / {batchProgress.total} files
                    {batchProgress.failed > 0 && ` (${batchProgress.failed} failed)`}
                  </div>
                  <div className="progress-bar-container">
                    <div
                      className="progress-bar"
                      style={{ width: `${batchProgress.total > 0 ? ((batchProgress.done + batchProgress.failed) / batchProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                  {batchProgress.current_file && (
                    <div className="batch-current-file">{batchProgress.current_file}</div>
                  )}
                  {batchProgress.file_progress > 0 && batchProgress.file_progress < 1 && (
                    <div className="progress-bar-container" style={{ height: 3, marginTop: 4 }}>
                      <div
                        className="progress-bar"
                        style={{
                          width: `${batchProgress.file_progress * 100}%`,
                          background: "var(--fg-dim)",
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {batchError && <div className="alert-error" onContextMenu={handleBatchErrorContext}>! {batchError}</div>}
            </div>

            <div className="batch-right">
              {batchFiles.length > 0 ? (
                <>
                  <div className="batch-file-list" ref={fileListRef}>
                    <div className="batch-file-hdr" onContextMenu={handleBatchFileHeaderContext}>
                      <span className="batch-file-count">{batchFiles.length} file{batchFiles.length !== 1 ? "s" : ""} ({matchingCount} matching .{inputExt})</span>
                      <span className="batch-file-total">{fmtSize(totalSize)}</span>
                    </div>
                    {batchFiles.map((f, i) => {
                      const isActive = batchProgress?.current_file === f.name && batchConverting;
                      const dot = f.name.lastIndexOf(".");
                      const fileExt = dot >= 0 ? f.name.slice(dot + 1).toLowerCase() : "";
                      const isMatching = fileExt === inputExt;
                      return (
                        <div
                          key={i}
                          ref={isActive ? activeRowRef : undefined}
                          className={`batch-file-row${isActive ? " active" : ""}${!isMatching ? " dim" : ""}`}
                          onClick={() => {
                            if (dot >= 0) setInputExt(fileExt);
                          }}
                          onContextMenu={(e) => handleBatchFileRowContext(e, f)}
                          title={`filter by .${fileExt || "?"}`}
                        >
                          <span className="batch-file-name">{f.name}</span>
                          <span className="batch-file-size">{fmtSize(f.size)}</span>
                        </div>
                      );
                    })}
                  </div>

                  {batchLog.length > 0 && (
                    <LogPanel lines={batchLog} onContextMenu={handleBatchLogContext} />
                  )}

                  {batchFiles.length > 0 && inputDir && batchOutputDir && (
                    <div onContextMenu={handleBatchCommandContext}>
                      <CommandPreview
                        params={{
                          input_path: batchFiles.find((f) => f.name.endsWith(`.${inputExt}`))?.path || batchFiles[0]?.path || "",
                          output_dir: batchOutputDir,
                          output_format: outputFormat,
                          quality: compressionMode === "quality" ? quality : undefined,
                          target_size_bytes: targetSizeBytes,
                        }}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="batch-empty" onContextMenu={handleBatchEmptyContext}>
                  <span className="batch-empty-rune">ᚱ</span>
                  <span className="batch-empty-text">select a folder and scan for files</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
