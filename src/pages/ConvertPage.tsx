import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useGaldrStore } from "../store";
import Dropdown from "../components/Dropdown";
import ScrambleText from "../components/ScrambleText";
import { FORMAT_OPTIONS } from "../options";
import type { FormatOption } from "../options";
import CommandPreview from "../components/CommandPreview";
import { useContextMenu } from "../components/ContextMenu";

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

function fmtDur(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function ConvertPage() {
  const {
    mediaInfo, conversionParams, isConverting,
    conversionProgress, lastOutputPath, error, ffmpegFound, outputDir,
    setMediaInfo, setConversionParams,
    setIsConverting, setConversionProgress,
    setLastOutputPath, setError, setFfmpegFound, setOutputDir,
  } = useGaldrStore();

  const [log, setLog] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [mediaType, setMediaType] = useState<MediaType>(null);
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

  return (
    <div className="page">
      {!ffmpegFound && (
        <div className="alert-error" onContextMenu={handleFfmpegAlertContext}>! ffmpeg not found on PATH</div>
      )}

      <div
        className={`drop-zone${isDragOver ? " drag-over" : ""}${conversionParams.input_path ? " has-file" : ""}`}
        onClick={pickFile}
        onContextMenu={handleDropZoneContext}
      >
        {conversionParams.input_path ? (
          <span className="drop-file">{conversionParams.input_path}</span>
        ) : (
          <>
            <span className="drop-rune">ᚨ</span>
            <ScrambleText as="span" className="drop-text" text="drop media or click to browse" hover />
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
            onContextMenu={handleMediaInfoContext}
          >
          <div className="primary">
            {mediaInfo.container} | {fmtDur(mediaInfo.duration)} | {fmtSize(mediaInfo.size)}
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
        <div className="log-panel" onContextMenu={handleLogContext}>
          {log.map((l, i) => <div key={i} className="log-line">{l}</div>)}
        </div>
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
    </div>
  );
}
