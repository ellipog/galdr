import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useGaldrStore } from "../store";
import CustomSelect from "../components/CustomSelect";
import QualitySlider from "../components/QualitySlider";
import ScrambleText from "../components/ScrambleText";
import MediaPreview from "../components/MediaPreview";
import type { MediaInfo } from "../types";
import CommandPreview from "../components/CommandPreview";
import { useContextMenu } from "../components/ContextMenu";

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

export default function CompressPage() {
  const {
    outputDir, ffmpegFound, isConverting, conversionProgress,
    lastOutputPath, error,
    setOutputDir, setIsConverting,
    setConversionProgress, setLastOutputPath, setError, setFfmpegFound,
  } = useGaldrStore();

  const [inputPath, setInputPath] = useState("");
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [mediaType, setMediaType] = useState<MediaType>(null);
  const [quality, setQuality] = useState(0.5);
  const [outputFormat, setOutputFormat] = useState("mp4");
  const [filteredOptions, setFilteredOptions] = useState(FORMAT_OPTIONS);
  const [estimate, setEstimate] = useState<{ original: number; estimated: number; can_compress: boolean } | null>(null);
  const [compressedInfo, setCompressedInfo] = useState<MediaInfo | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [btnHover, setBtnHover] = useState(false);
  const { show } = useContextMenu();

  useEffect(() => {
    invoke<boolean>("detect_ffmpeg").then(setFfmpegFound);
  }, [setFfmpegFound]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<{ job_id: string; progress: number }>(
        "conversion-progress",
        (e) => {
          setConversionProgress(e.payload.progress);
          setLog((p) => {
            const pct = `${Math.round(e.payload.progress * 100)}%`;
            return p[p.length - 1] !== pct ? [...p, pct] : p;
          });
        },
      );
    })();
    return () => { if (unlisten) unlisten(); };
  }, [setConversionProgress]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<{ message: string }>(
        "conversion-log",
        (e) => {
          setLog((p) => [...p, e.payload.message]);
        },
      );
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(
        await listen("tauri://drag-enter", () => setIsDragOver(true)),
      );
      unlisteners.push(
        await listen("tauri://drag-leave", () => setIsDragOver(false)),
      );
      unlisteners.push(
        await listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
          setIsDragOver(false);
          const path = e.payload.paths?.[0];
          if (path) loadFile(path);
        }),
      );
    })();
    return () => { unlisteners.forEach((u) => u()); };
  }, []);

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

  useEffect(() => {
    if (!inputPath) { setEstimate(null); return; }
    const t = setTimeout(async () => {
      try {
        type EstimateResult = { original_size: number; estimated_size: number; can_compress: boolean };
        const r = await invoke<EstimateResult>(
          "estimate_compress_size", { path: inputPath, quality, outputFormat },
        );
        setEstimate({ original: r.original_size, estimated: r.estimated_size, can_compress: r.can_compress });
      } catch { setEstimate(null); }
    }, 300);
    return () => clearTimeout(t);
  }, [inputPath, quality, outputFormat]);

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

    const params = {
      input_path: inputPath,
      output_dir: typeDir,
      output_format: outputFormat,
      quality,
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
  }, [inputPath, outputDir, mediaType, outputFormat, quality, setOutputDir, setIsConverting, setError, setLastOutputPath, setConversionProgress]);

  const sizeIncrease = estimate && estimate.estimated >= estimate.original;
  const btnDisabled = !inputPath || isConverting;

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

  return (
    <div className="page">
      {!ffmpegFound && (
        <div className="alert-error" onContextMenu={handleCompressFfmpegAlertContext}>! ffmpeg not found on PATH</div>
      )}

      <div
        className={`drop-zone${isDragOver ? " drag-over" : ""}${inputPath ? " has-file" : ""}`}
        onClick={pickFile}
        onContextMenu={handleCompressDropZoneContext}
      >
        {inputPath ? (
          <span className="drop-file">{inputPath}</span>
        ) : (
          <>
            <span className="drop-rune">ᛉ</span>
            <ScrambleText as="span" className="drop-text" text="drop media to compress or click to browse" hover />
          </>
        )}
      </div>

      <AnimatePresence>
        {mediaInfo && (
          <motion.div
            className="media-info"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onContextMenu={handleCompressMediaInfoContext}
          >
            <div className="primary">
              {mediaInfo.container} | {fmtSize(mediaInfo.size)}
              {mediaInfo.bitrate && ` | ${(mediaInfo.bitrate / 1000).toFixed(0)}kbps`}
              {mediaType && ` | ${mediaType}`}
            </div>
            {mediaInfo.streams.map((s, i) => (
              <div key={i} className="stream">
                [{s.kind}] {s.codec}
                {s.width && ` ${s.width}x${s.height}`}
                {s.frame_rate && ` @ ${s.frame_rate.toFixed(1)}fps`}
                {s.channels && ` ${s.channels}ch`}
                {s.sample_rate && ` ${(s.sample_rate / 1000).toFixed(0)}kHz`}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <ScrambleText as="div" className="rune-divider" text="ᛟ ᛟ ᛟ ᛟ ᛟ" hover ticks={4} />

      <div onContextMenu={handleQualitySliderContext}>
        <QualitySlider
          label="quality"
          value={quality}
          onChange={setQuality}
        />
      </div>

      {estimate && (
        <div className={`estimate-bar${sizeIncrease ? " estimate-warn" : ""}`} onContextMenu={handleEstimateContext}>
          <span className="estimate-original">{fmtSize(estimate.original)}</span>
          <span className="estimate-arrow">→</span>
          <span className="estimate-result">{fmtSize(estimate.estimated)}</span>
          <span className="estimate-pct">
            {sizeIncrease
              ? `+${Math.round((estimate.estimated / estimate.original - 1) * 100)}% increase`
              : `-${Math.round((1 - estimate.estimated / estimate.original) * 100)}%`}
          </span>
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
        <div className="log-panel" onContextMenu={handleCompressLogContext}>
          {log.map((l, i) => <div key={i} className="log-line">{l}</div>)}
        </div>
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
          <CommandPreview params={{ input_path: inputPath, output_dir: outputDir || "", output_format: outputFormat, quality }} mediaType={mediaType} />
        </div>
      )}
    </div>
  );
}
