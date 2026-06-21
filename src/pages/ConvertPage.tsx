import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useGaldrStore } from "../store";
import Dropdown from "../components/Dropdown";
import ScrambleText from "../components/ScrambleText";
import ConvertOperations from "../components/ConvertOperations";
import MediaInfoCard from "../components/MediaInfoCard";
import ExtractFramesPanel from "../components/ExtractFramesPanel";
import { FORMAT_OPTIONS, EXT_OPTIONS, FMT_OPTIONS } from "../options";
import type { FormatOption } from "../options";
import CommandPreview from "../components/CommandPreview";
import LogPanel from "../components/LogPanel";
import PresetPicker from "../components/PresetPicker";
import { useContextMenu } from "../components/ContextMenu";
import { applyRuneToConversion } from "../utils/runeMerge";
import type { PresetParams, ScannedFile, BatchProgress, ConversionParams } from "../types";

const IMAGE_CODECS = ["png", "jpeg", "gif", "bmp", "tiff", "webp"];

type MediaType = "video" | "audio" | "image" | null;

function detectMediaType(mi: import("../types").MediaInfo): MediaType {
  const isImage = mi.container.includes("image") ||
    (mi.duration === 0 && mi.streams.some((s) => IMAGE_CODECS.includes(s.codec)));
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

export default function ConvertPage({ onNavigate }: { onNavigate?: NavigateFn }) {
  const {
    mediaInfo, conversionParams, isConverting,
    conversionProgress, lastOutputPath, error, ffmpegFound, outputDir,
    setMediaInfo, setConversionParams,
    setIsConverting, setConversionProgress,
    setLastOutputPath, setError, setFfmpegFound, setOutputDir,
  } = useGaldrStore();

  /* ── Mode ── */
  const [mode, setMode] = useState<"file" | "batch">("file");

  /* ── File mode state ── */
  const [log, setLog] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [mediaType, setMediaType] = useState<MediaType>(null);
  const [btnHover, setBtnHover] = useState(false);
  const { show } = useContextMenu();

  /* ── Batch mode state ── */
  const [inputDir, setInputDir] = useState("");
  const [batchOutputDir, setBatchOutputDir] = useState("");
  const [inputExt, setInputExt] = useState("mp4");
  const [outputFmt, setOutputFmt] = useState("mp4");
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [scanning, setScanning] = useState(false);
  const [batchConverting, setBatchConverting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchLog, setBatchLog] = useState<string[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [isBatchDragOver, setIsBatchDragOver] = useState(false);
  const [skipCount, setSkipCount] = useState(0);
  const [scanBtnHover, setScanBtnHover] = useState(false);
  const [convBtnHover, setConvBtnHover] = useState(false);
  const scanningRef = useRef(false);
  const loadDirRef = useRef<any>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);
  const prevDoneRef = useRef(0);

  const extType = EXT_OPTIONS.find((e) => e.value === inputExt)?.type;

  /* ── FFmpeg detection ── */
  useEffect(() => {
    invoke<boolean>("detect_ffmpeg").then(setFfmpegFound);
  }, [setFfmpegFound]);

  /* ── File-mode event listeners ── */
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

  /* ── Batch-mode event listeners ── */
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<BatchProgress>("batch-progress", (e) => {
        if (mode !== "batch") return;
        const p = e.payload;
        setBatchProgress(p);
        const completed = p.done + p.failed;
        if (completed > prevDoneRef.current && p.current_file) {
          setBatchLog((prev) => [...prev, `> ${p.current_file} (${p.done}/${p.total})`]);
        }
        prevDoneRef.current = completed;
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
    if (!FMT_OPTIONS.some((o) => o.type === extType && o.value === outputFmt)) {
      setOutputFmt(FMT_OPTIONS.find((o) => o.type === extType)?.value ?? "mp4");
    }
  }, [extType, outputFmt]);

  /* ── Update skip count when batch finishes ── */
  useEffect(() => {
    if (!batchConverting && batchProgress && (batchProgress.done + batchProgress.failed) > 0) {
      setSkipCount(batchProgress.done + batchProgress.failed);
    }
  }, [batchConverting, batchProgress]);

  /* ── File mode: media type detection ── */
  useEffect(() => {
    if (!mediaInfo) {
      setMediaType(null);
      return;
    }
    const mt = detectMediaType(mediaInfo);
    setMediaType(mt);
    const allowed = mt === "image" ? ["image"] as const
      : mt === "audio" ? ["audio"] as const
      : ["video", "audio", "image"] as const;
    const cur = conversionParams.output_format;
    if (!FORMAT_OPTIONS.some((o) => o.type && (allowed as readonly string[]).includes(o.type) && o.value === cur)) {
      const ext = conversionParams.input_path
        ?.split("/").pop()?.split(".").pop()?.toLowerCase();
      let match: FormatOption | undefined;
      if (ext) match = FORMAT_OPTIONS.find((o) => o.value === ext);
      setConversionParams({ output_format: match?.value ?? FORMAT_OPTIONS.find((o) => (allowed as readonly string[]).includes(o.type))?.value ?? "mp4" });
    }
  }, [mediaInfo]);

  /* ── File mode: load file ── */
  const loadFile = useCallback(async (path: string) => {
    setError(null);
    setLog([]);
    setLastOutputPath(null);
    try {
      const info = await invoke<import("../types").MediaInfo>("get_media_info", { path });
      setMediaInfo(info);
      setConversionParams({ input_path: path });
    } catch (e) {
      setMediaInfo(null);
      setError(String(e));
    }
  }, [setConversionParams, setMediaInfo, setError, setLastOutputPath]);

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
    if (!conversionParams.input_path) return;

    let dir = outputDir;
    if (!dir) {
      const defaultDir = await invoke<string>("get_default_output_dir");
      const picked = await open({
        directory: true,
        multiple: false,
        defaultPath: defaultDir,
      });
      if (!picked) return;
      dir = picked as string;
      setOutputDir(dir);
    }

    const typeDir = mediaType ? `${dir}/${mediaType}` : dir;
    const params = { ...conversionParams, output_dir: typeDir };

    setIsConverting(true);
    setError(null);
    setLog(["> start"]);
    setLastOutputPath(null);
    setConversionProgress(0);
    try {
      const r = await invoke<{ job_id: string; output_path: string }>(
        "start_conversion", { params },
      );
      setLog((p) => [...p, `> ${r.output_path}`]);
      setLastOutputPath(r.output_path);
    } catch (e) {
      const m = typeof e === "string" ? e : "failed";
      setLog((p) => [...p, `! ${m}`]);
      setError(m);
    } finally {
      setIsConverting(false);
    }
  }, [conversionParams, outputDir, mediaType, setOutputDir, setIsConverting, setError, setLastOutputPath, setConversionProgress]);

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
    setSkipCount(0);
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    setBatchError(null);
    setFiles([]);
    setBatchProgress(null);
    try {
      const result = await invoke<ScannedFile[]>("scan_directory", {
        dir,
        extension: "",
      });
      const top = mostCommonExtension(result, EXT_OPTIONS);
      if (top) setInputExt(top);
      setFiles(result);
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
    setFiles([]);
    setBatchProgress(null);
    setSkipCount(0);
    try {
      const result = await invoke<ScannedFile[]>("scan_directory", {
        dir: inputDir,
        extension: "",
      });
      setFiles(result);
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
    if (!inputDir || !batchOutputDir || files.length === 0) return;
    setBatchConverting(true);
    setBatchError(null);
    setBatchLog(["> batch start"]);
    setBatchProgress(null);
    prevDoneRef.current = skipCount;
    try {
      await invoke("start_batch_conversion", {
        params: {
          input_dir: inputDir,
          output_dir: batchOutputDir,
          input_extension: inputExt,
          output_format: outputFmt,
          skip: skipCount,
        },
      });
      setBatchLog((p) => [...p, "> batch done"]);
    } catch (e) {
      setBatchError(String(e));
      setBatchLog((p) => [...p, `! ${e}`]);
    } finally {
      setBatchConverting(false);
    }
  }, [inputDir, batchOutputDir, inputExt, outputFmt, files, skipCount]);

  /* ── Batch mode: computed values ── */
  const canScan = !!inputDir && !scanning;
  const canConvert = !!inputDir && !!batchOutputDir && files.length > 0 && !batchConverting;
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const matchingCount = files.filter((f) => {
    const dot = f.name.lastIndexOf(".");
    if (dot < 0) return false;
    return f.name.slice(dot + 1).toLowerCase() === inputExt;
  }).length;

  /* ── Context menus (file mode) ── */
  const handleDropZoneContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (conversionParams.input_path) {
      show(e, [
        { label: "browse (replace)", rune: "ᛏ", action: pickFile },
        { label: "copy path", rune: "ᚷ", action: () => navigator.clipboard.writeText(conversionParams.input_path || "") },
        { label: "", rune: "", action: () => {}, divider: true },
        { label: "clear file", rune: "ᚨ", action: () => {
          setMediaInfo(null);
          setConversionParams({ input_path: "" });
        }},
        { label: "reveal in folder", rune: "ᚠ", action: () => conversionParams.input_path && invoke("reveal_in_folder", { path: conversionParams.input_path }).catch(() => {}) },
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
  }, [show, conversionParams.input_path, pickFile, loadFile, setMediaInfo, setConversionParams]);

  const handleMediaInfoContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!mediaInfo || !conversionParams.input_path) return;
    const streamInfo = mediaInfo.streams.map((s) => `[${s.kind}] ${s.codec}${s.width ? ` ${s.width}x${s.height}` : ""}`).join("\n");
    show(e, [
      { label: "copy file path", rune: "ᛏ", action: () => navigator.clipboard.writeText(conversionParams.input_path || "") },
      { label: "copy stream info", rune: "ᚷ", action: () => navigator.clipboard.writeText(streamInfo) },
      { label: "copy container info", rune: "ᚨ", action: () => navigator.clipboard.writeText(`${mediaInfo.container} | ${mediaInfo.size}B | ${mediaInfo.duration}s`) },
    ]);
  }, [show, mediaInfo, conversionParams.input_path]);

  const handleLogContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (log.length === 0) return;
    show(e, [
      { label: "copy all", rune: "ᚷ", action: () => navigator.clipboard.writeText(log.join("\n")) },
      { label: "clear", rune: "ᚨ", action: () => setLog([]) },
    ]);
  }, [show, log]);

  const handleResultContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!lastOutputPath) return;
    show(e, [
      { label: "show in folder", rune: "ᛏ", action: () => revealItemInDir(lastOutputPath) },
      { label: "copy path", rune: "ᚷ", action: () => navigator.clipboard.writeText(lastOutputPath) },
    ]);
  }, [show, lastOutputPath]);

  const handleCommandContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "copy command", rune: "ᚷ", action: () => {
        const previewEl = document.querySelector(".command-preview-code");
        if (previewEl) navigator.clipboard.writeText(previewEl.textContent || "");
      }},
    ]);
  }, [show]);

  const handleFfmpegAlertContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "retry detection", rune: "ᛏ", action: () => invoke<boolean>("detect_ffmpeg").then(setFfmpegFound) },
      { label: "copy message", rune: "ᚷ", action: () => navigator.clipboard.writeText("ffmpeg not found on PATH") },
    ]);
  }, [show, setFfmpegFound]);

  const handleFormatCardContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const cur = conversionParams.output_format;
    show(e, [
      { label: `copy format (${cur})`, rune: "ᚷ", action: () => navigator.clipboard.writeText(cur) },
      { label: "reset to mp4", rune: "ᛏ", action: () => setConversionParams({ output_format: "mp4" }) },
    ]);
  }, [show, conversionParams.output_format, setConversionParams]);

  const handleOutputPathContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!outputDir || !mediaType) return;
    const path = `${outputDir}/${mediaType}/`;
    show(e, [
      { label: "copy path", rune: "ᚷ", action: () => navigator.clipboard.writeText(path) },
      { label: "open in explorer", rune: "ᛏ", action: () => invoke("reveal_in_folder", { path: outputDir }).catch(() => {}) },
    ]);
  }, [show, outputDir, mediaType]);

  const handleErrorAlertContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!error) return;
    show(e, [
      { label: "copy error", rune: "ᚷ", action: () => navigator.clipboard.writeText(error) },
      { label: "dismiss", rune: "ᚨ", action: () => setError(null) },
    ]);
  }, [show, error, setError]);

  const handleProgressContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isConverting) return;
    show(e, [
      { label: "cancel conversion", rune: "ᛏ", action: () => invoke("cancel_conversion") },
      { label: `copy progress (${Math.round(conversionProgress * 100)}%)`, rune: "ᚷ", action: () => navigator.clipboard.writeText(`${Math.round(conversionProgress * 100)}%`) },
    ]);
  }, [show, isConverting, conversionProgress]);

  /* ── Context menus (batch mode) ── */
  const handleInputDirContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "browse", rune: "ᚨ", action: pickInput },
      { label: "copy path", rune: "ᛏ", action: () => navigator.clipboard.writeText(inputDir) },
      ...(inputDir ? [{ label: "clear", rune: "ᚷ", action: () => { setInputDir(""); setFiles([]); setBatchProgress(null); } }] : []),
    ]);
  }, [show, inputDir, pickInput]);

  const handleOutputDirContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "browse", rune: "ᚨ", action: pickOutput },
      { label: "copy path", rune: "ᛏ", action: () => navigator.clipboard.writeText(batchOutputDir) },
      ...(batchOutputDir ? [{ label: "clear", rune: "ᚷ", action: () => setBatchOutputDir("") }] : []),
    ]);
  }, [show, batchOutputDir, pickOutput]);

  const handleFileRowContext = useCallback((e: React.MouseEvent, f: ScannedFile) => {
    e.stopPropagation();
    const dot = f.name.lastIndexOf(".");
    const ext = dot >= 0 ? f.name.slice(dot + 1).toLowerCase() : "";
    show(e, [
      { label: `filter by .${ext}`, rune: "ᚷ", action: () => ext && setInputExt(ext) },
      { label: "copy name", rune: "ᚨ", action: () => navigator.clipboard.writeText(f.name) },
      { label: "copy path", rune: "ᛏ", action: () => navigator.clipboard.writeText(f.path) },
    ]);
  }, [show, setInputExt]);

  const handleFileHeaderContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "copy all names", rune: "ᚷ", action: () => navigator.clipboard.writeText(files.map((f) => f.name).join("\n")) },
      { label: "copy all paths", rune: "ᚨ", action: () => navigator.clipboard.writeText(files.map((f) => f.path).join("\n")) },
    ]);
  }, [show, files]);

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
      { label: `copy (${outputFmt})`, rune: "ᚷ", action: () => navigator.clipboard.writeText(outputFmt) },
      { label: "reset to mp4", rune: "ᛏ", action: () => setOutputFmt("mp4") },
    ]);
  }, [show, outputFmt, setOutputFmt]);

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
  const handleApplyRune = useCallback((preset: PresetParams) => {
    if (mode === "file") {
      setConversionParams(applyRuneToConversion(conversionParams, preset));
    } else {
      if (preset.output_format) setOutputFmt(preset.output_format);
    }
  }, [mode, conversionParams, setConversionParams]);

  const batchParams: ConversionParams = {
    input_path: inputDir,
    output_dir: batchOutputDir,
    output_format: outputFmt,
  };

  /* ── Render ── */
  return (
    <div className="page">
      {/* Mode tabs */}
      <div className="mode-tabs">
        <button
          className={`mode-tab${mode === "file" ? " active" : ""}`}
          onClick={() => setMode("file")}
        >
          ᚨ file
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
        <div className="alert-error" onContextMenu={handleFfmpegAlertContext}>! ffmpeg not found on PATH</div>
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
            className={`drop-zone${isDragOver ? " drag-over" : ""}${conversionParams.input_path ? " has-file" : ""}`}
            onClick={pickFile}
            onContextMenu={handleDropZoneContext}
          >
            {conversionParams.input_path ? (
              <>
                <span className="drop-file-icon">ᛉ</span>
                <span className="drop-file-name">{conversionParams.input_path.split(/[/\\]/).pop()}</span>
                <span className="drop-file-size">{mediaInfo ? fmtSize(mediaInfo.size) : ""}</span>
                <span className="drop-file-change">change</span>
              </>
            ) : (
              <>
                <span className="drop-rune">ᚨ</span>
                <ScrambleText as="span" className="drop-text" text="drop media or click to browse" hover />
              </>
            )}
          </div>

          <AnimatePresence>
            {mediaInfo && (
              <MediaInfoCard
                info={mediaInfo}
                mediaType={mediaType}
                onContextMenu={handleMediaInfoContext}
              />
            )}
          </AnimatePresence>

          {mediaType && mediaInfo && (
            <ConvertOperations mediaType={mediaType} mediaInfo={mediaInfo} />
          )}

          {mediaType === "video" && mediaInfo && conversionParams.input_path && (
            <ExtractFramesPanel inputPath={conversionParams.input_path} mediaInfo={mediaInfo} />
          )}

          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᚦ</span>
            <span className="section-heading-label">settings</span>
          </div>

          <PresetPicker currentParams={conversionParams} onApply={handleApplyRune} onManage={onNavigate ? () => onNavigate("runes") : undefined} />

          <div className="card" onContextMenu={handleFormatCardContext}>
            <label className="label">output format</label>
            <Dropdown
              options={FORMAT_OPTIONS}
              value={conversionParams.output_format}
              onChange={(v) => setConversionParams({ output_format: v })}
              showCategories
              filterType={mediaType ?? undefined}
            />
          </div>

          {mediaType && outputDir && (
            <div className="card" onContextMenu={handleOutputPathContext}>
              <span className="label">output path</span>
              <span className="path-preview">{outputDir}/{mediaType}/</span>
            </div>
          )}

          {error && <div className="alert-error" onContextMenu={handleErrorAlertContext}>! {error}</div>}

          <div className="section-heading">
            <span className="section-heading-line" />
            <span className="section-heading-rune">ᛟ</span>
            <span className="section-heading-label">output</span>
          </div>

          <div className="convert-actions">
            <button
              className="btn btn-primary"
              disabled={!conversionParams.input_path || isConverting}
              onClick={convert}
              onMouseEnter={() => setBtnHover(true)}
              onMouseLeave={() => setBtnHover(false)}
            >
              {isConverting ? "converting..." : <ScrambleText text="convert" trigger={btnHover} ticks={4} />}
            </button>
            {isConverting && (
              <button className="btn btn-cancel" onClick={() => invoke("cancel_conversion")} title="cancel">
                ■
              </button>
            )}
          </div>

          {isConverting && (
            <div className="progress-bar-container" onContextMenu={handleProgressContext}>
              <div className="progress-bar" style={{ width: `${conversionProgress * 100}%` }} />
              <span className="progress-text">{Math.round(conversionProgress * 100)}%</span>
            </div>
          )}

          {log.length > 0 && (
            <LogPanel lines={log} onContextMenu={handleLogContext} />
          )}

          {lastOutputPath && (
            <div className="result-bar" onContextMenu={handleResultContext}>
              <span className="result-path">{lastOutputPath}</span>
              <button className="btn" onClick={() => revealItemInDir(lastOutputPath)}>
                show in folder
              </button>
            </div>
          )}

          {conversionParams.input_path && (
            <div onContextMenu={handleCommandContext}>
              <CommandPreview params={conversionParams} outputDir={outputDir} mediaType={mediaType} />
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

              <div className="card" onContextMenu={handleInputDirContext}>
                <label className="label">input folder</label>
                <div className="row">
                  <input className="input" value={inputDir} placeholder="drag & drop folder, or browse" readOnly />
                  <button className="btn" onClick={pickInput}>browse</button>
                </div>
              </div>

              <div className="card" onContextMenu={handleOutputDirContext}>
                <label className="label">output folder</label>
                <div className="row">
                  <input className="input" value={batchOutputDir} placeholder="drag & drop folder, or browse" readOnly />
                  <button className="btn" onClick={pickOutput}>browse</button>
                </div>
              </div>

              <PresetPicker currentParams={batchParams} onApply={handleApplyRune} onManage={onNavigate ? () => onNavigate("runes") : undefined} />

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
                  <Dropdown
                    options={FMT_OPTIONS}
                    value={outputFmt}
                    onChange={setOutputFmt}
                    showCategories
                    filterType={extType}
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

              {files.length > 0 && (
                <div className="convert-actions">
                  <button
                    className="btn btn-primary"
                    disabled={!canConvert}
                    onClick={convertAll}
                    onMouseEnter={() => setConvBtnHover(true)}
                    onMouseLeave={() => setConvBtnHover(false)}
                  >
                    {batchConverting ? "converting..." : <ScrambleText text={`convert ${matchingCount} file${matchingCount !== 1 ? "s" : ""}`} trigger={convBtnHover} ticks={4} />}
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
              {files.length > 0 ? (
                <>
                  <div className="batch-file-list" ref={fileListRef}>
                    <div className="batch-file-hdr" onContextMenu={handleFileHeaderContext}>
                      <span className="batch-file-count">{files.length} file{files.length !== 1 ? "s" : ""} ({matchingCount} matching .{inputExt})</span>
                      <span className="batch-file-total">{fmtSize(totalSize)}</span>
                    </div>
                    {files.map((f, i) => {
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
                          onContextMenu={(e) => handleFileRowContext(e, f)}
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

                  {files.length > 0 && inputDir && batchOutputDir && (
                    <div onContextMenu={handleBatchCommandContext}>
                      <CommandPreview
                        params={{
                          input_path: files.find((f) => f.name.endsWith(`.${inputExt}`))?.path || files[0]?.path || "",
                          output_dir: batchOutputDir,
                          output_format: outputFmt,
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
