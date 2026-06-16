import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import CustomSelect from "../components/CustomSelect";
import ScrambleText from "../components/ScrambleText";
import type { ScannedFile, BatchProgress } from "../types";

const EXT_OPTIONS = [
  { value: "mp4", label: ".mp4", type: "video" as const },
  { value: "mkv", label: ".mkv", type: "video" as const },
  { value: "avi", label: ".avi", type: "video" as const },
  { value: "mov", label: ".mov", type: "video" as const },
  { value: "webm", label: ".webm", type: "video" as const },
  { value: "m4v", label: ".m4v", type: "video" as const },
  { value: "flv", label: ".flv", type: "video" as const },
  { value: "ogv", label: ".ogv", type: "video" as const },
  { value: "wmv", label: ".wmv", type: "video" as const },
  { value: "ts", label: ".ts", type: "video" as const },
  { value: "3gp", label: ".3gp", type: "video" as const },
  { value: "mod", label: ".mod", type: "video" as const },
  { value: "mp3", label: ".mp3", type: "audio" as const },
  { value: "flac", label: ".flac", type: "audio" as const },
  { value: "wav", label: ".wav", type: "audio" as const },
  { value: "aac", label: ".aac", type: "audio" as const },
  { value: "ogg", label: ".ogg", type: "audio" as const },
  { value: "opus", label: ".opus", type: "audio" as const },
  { value: "wma", label: ".wma", type: "audio" as const },
  { value: "m4a", label: ".m4a", type: "audio" as const },
  { value: "aiff", label: ".aiff", type: "audio" as const },
  { value: "ac3", label: ".ac3", type: "audio" as const },
  { value: "dts", label: ".dts", type: "audio" as const },
  { value: "png", label: ".png", type: "image" as const },
  { value: "jpg", label: ".jpg", type: "image" as const },
  { value: "jpeg", label: ".jpeg", type: "image" as const },
  { value: "webp", label: ".webp", type: "image" as const },
  { value: "gif", label: ".gif", type: "image" as const },
  { value: "bmp", label: ".bmp", type: "image" as const },
  { value: "tiff", label: ".tiff", type: "image" as const },
  { value: "avif", label: ".avif", type: "image" as const },
  { value: "svg", label: ".svg", type: "image" as const },
];

const FMT_OPTIONS = [
  { value: "mp4", label: "mp4", type: "video" as const },
  { value: "mkv", label: "mkv", type: "video" as const },
  { value: "avi", label: "avi", type: "video" as const },
  { value: "mov", label: "mov", type: "video" as const },
  { value: "webm", label: "webm", type: "video" as const },
  { value: "m4v", label: "m4v", type: "video" as const },
  { value: "flv", label: "flv", type: "video" as const },
  { value: "ogv", label: "ogv", type: "video" as const },
  { value: "wmv", label: "wmv", type: "video" as const },
  { value: "gif", label: "gif", type: "video" as const },
  { value: "mod", label: "mod", type: "video" as const },
  { value: "mp3", label: "mp3", type: "audio" as const },
  { value: "flac", label: "flac", type: "audio" as const },
  { value: "wav", label: "wav", type: "audio" as const },
  { value: "aac", label: "aac", type: "audio" as const },
  { value: "ogg", label: "ogg", type: "audio" as const },
  { value: "opus", label: "opus", type: "audio" as const },
  { value: "wma", label: "wma", type: "audio" as const },
  { value: "m4a", label: "m4a", type: "audio" as const },
  { value: "aiff", label: "aiff", type: "audio" as const },
  { value: "ac3", label: "ac3", type: "audio" as const },
  { value: "png", label: "png", type: "image" as const },
  { value: "jpeg", label: "jpeg", type: "image" as const },
  { value: "webp", label: "webp", type: "image" as const },
  { value: "bmp", label: "bmp", type: "image" as const },
  { value: "tiff", label: "tiff", type: "image" as const },
  { value: "avif", label: "avif", type: "image" as const },
];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

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

export default function BatchConvertPage() {
  const [inputDir, setInputDir] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [inputExt, setInputExt] = useState("mp4");
  const [outputFmt, setOutputFmt] = useState("mp4");
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [scanning, setScanning] = useState(false);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [skipCount, setSkipCount] = useState(0);
  const [scanBtnHover, setScanBtnHover] = useState(false);
  const [convBtnHover, setConvBtnHover] = useState(false);
  const scanningRef = useRef(false);
  const loadDirRef = useRef<any>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeRowRef.current && fileListRef.current) {
      activeRowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [progress?.current_file]);

  const filteredFmt = FMT_OPTIONS.filter((o) => {
    const extOpt = EXT_OPTIONS.find((e) => e.value === inputExt);
    return !extOpt || o.type === extOpt.type;
  });

  useEffect(() => {
    if (!filteredFmt.some((o) => o.value === outputFmt)) {
      setOutputFmt(filteredFmt[0]?.value ?? "mp4");
    }
  }, [inputExt, filteredFmt]);

  useEffect(() => {
    if (!converting && progress && (progress.done + progress.failed) > 0) {
      setSkipCount(progress.done + progress.failed);
    }
  }, [converting]);

  const pickInput = async () => {
    const sel = await open({ directory: true, multiple: false });
    if (sel) loadDir(sel as string);
  };

  const pickOutput = async () => {
    const sel = await open({ directory: true, multiple: false });
    if (sel) setOutputDir(sel as string);
  };

  const loadDir = useCallback(async (dir: string) => {
    setInputDir(dir);
    setOutputDir(dir.replace(/[\\/]+$/, "").replace(/\\/g, "/") + "/output");
    setSkipCount(0);
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    setError(null);
    setFiles([]);
    setProgress(null);
    try {
      const result = await invoke<ScannedFile[]>("scan_directory", {
        dir,
        extension: "",
      });
      const top = mostCommonExtension(result, EXT_OPTIONS);
      if (top) setInputExt(top);
      const filtered = top
        ? result.filter((f) => f.name.toLowerCase().endsWith("." + top))
        : result;
      setFiles(filtered);
      setLog((p) => [...p, `> scanned ${result.length} files, auto-detected .${top}`]);
    } catch (e) {
      setError(String(e));
      setLog((p) => [...p, `! scan failed: ${e}`]);
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
    setError(null);
    setFiles([]);
    setProgress(null);
    setSkipCount(0);
    try {
      const result = await invoke<ScannedFile[]>("scan_directory", {
        dir: inputDir,
        extension: inputExt,
      });
      setFiles(result);
      setLog((p) => [...p, `> scanned ${result.length} files`]);
    } catch (e) {
      setError(String(e));
      setLog((p) => [...p, `! scan failed: ${e}`]);
    } finally {
      setScanning(false);
      scanningRef.current = false;
    }
  }, [inputDir, inputExt]);

  const prevDoneRef = useRef(0);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<BatchProgress>("batch-progress", (e) => {
        const p = e.payload;
        setProgress(p);
        const completed = p.done + p.failed;
        if (completed > prevDoneRef.current && p.current_file) {
          setLog((prev) => [...prev, `> ${p.current_file} (${p.done}/${p.total})`]);
        }
        prevDoneRef.current = completed;
        if (p.file_progress >= 1.0 && !p.current_file) {
          setLog((prev) => [...prev, `> batch complete — ${p.done} ok, ${p.failed} failed`]);
        }
      });
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
        await listen<{ paths: string[] }>("tauri://drag-drop", async (e) => {
          setIsDragOver(false);
          const p = e.payload.paths?.[0];
          if (!p) return;
          const isDir = await invoke<boolean>("is_directory", { path: p });
          loadDirRef.current(isDir ? p : parentPath(p));
        }),
      );
    })();
    return () => { unlisteners.forEach((u) => u()); };
  }, []);

  const convertAll = useCallback(async () => {
    if (!inputDir || !outputDir || files.length === 0) return;
    setConverting(true);
    setError(null);
    setLog(["> batch start"]);
    setProgress(null);
    prevDoneRef.current = skipCount;
    try {
      await invoke("start_batch_conversion", {
        params: {
          input_dir: inputDir,
          output_dir: outputDir,
          input_extension: inputExt,
          output_format: outputFmt,
          skip: skipCount,
        },
      });
      setLog((p) => [...p, "> batch done"]);
    } catch (e) {
      setError(String(e));
      setLog((p) => [...p, `! ${e}`]);
    } finally {
      setConverting(false);
    }
  }, [inputDir, outputDir, inputExt, outputFmt, files, skipCount]);

  const canScan = !!inputDir && !scanning;
  const canConvert = !!inputDir && !!outputDir && files.length > 0 && !converting;
  const totalSize = files.reduce((s, f) => s + f.size, 0);

  return (
    <div
      className={`page batch-page${isDragOver ? " dragging" : ""}`}
      onDragOver={(e) => e.preventDefault()}
    >
      <h2>ᚷ batch convert</h2>

      <div className="card">
        <label className="label">input folder</label>
        <div className="row">
          <input className="input" value={inputDir} placeholder="drag & drop folder, or browse" readOnly />
          <button className="btn" onClick={pickInput}>browse</button>
        </div>
      </div>

      <div className="card">
        <label className="label">output folder</label>
        <div className="row">
          <input className="input" value={outputDir} placeholder="drag & drop folder, or browse" readOnly />
          <button className="btn" onClick={pickOutput}>browse</button>
        </div>
      </div>

      <div className="batch-format-row">
        <div className="card batch-card">
          <label className="label">input extension</label>
          <CustomSelect
            options={EXT_OPTIONS}
            value={inputExt}
            onChange={setInputExt}
          />
        </div>
        <div className="card batch-card">
          <label className="label">output format</label>
          <CustomSelect
            options={filteredFmt}
            value={outputFmt}
            onChange={setOutputFmt}
          />
        </div>
      </div>

      <button
        className="btn btn-primary"
        disabled={!canScan}
        onClick={scan}
        onMouseEnter={() => setScanBtnHover(true)}
        onMouseLeave={() => setScanBtnHover(false)}
      >
        {scanning ? "scanning..." : <ScrambleText text="scan folder" trigger={scanBtnHover} ticks={4} />}
      </button>

      {files.length > 0 && (
        <div className="batch-file-list" ref={fileListRef}>
          <div className="batch-file-hdr">
            <span className="batch-file-count">{files.length} file{files.length !== 1 ? "s" : ""}</span>
            <span className="batch-file-total">{fmtSize(totalSize)}</span>
          </div>
          {files.map((f, i) => {
            const isActive = progress?.current_file === f.name && converting;
            return (
              <div
                key={i}
                ref={isActive ? activeRowRef : undefined}
                className={`batch-file-row${isActive ? " active" : ""}`}
                onClick={() => {
                  const dot = f.name.lastIndexOf(".");
                  if (dot >= 0) setInputExt(f.name.slice(dot + 1).toLowerCase());
                }}
                title={`filter by .${f.name.split(".").pop()?.toLowerCase() ?? ""}`}
              >
                <span className="batch-file-name">{f.name}</span>
                <span className="batch-file-size">{fmtSize(f.size)}</span>
              </div>
            );
          })}
        </div>
      )}

      {files.length > 0 && (
        <div className="convert-actions">
          <button
            className="btn btn-primary"
            disabled={!canConvert}
            onClick={convertAll}
            onMouseEnter={() => setConvBtnHover(true)}
            onMouseLeave={() => setConvBtnHover(false)}
          >
            {converting ? "converting..." : <ScrambleText text={`convert ${files.length} file${files.length !== 1 ? "s" : ""}`} trigger={convBtnHover} ticks={4} />}
          </button>
          {converting && (
            <button className="btn btn-cancel" onClick={() => invoke("cancel_conversion")} title="cancel">
              ■
            </button>
          )}
        </div>
      )}

      {progress && (
        <div className="card">
          <label className="label">progress</label>
          <div className="batch-progress-info">
            {progress.done + progress.failed} / {progress.total} files
            {progress.failed > 0 && ` (${progress.failed} failed)`}
          </div>
          <div className="progress-bar-container">
            <div
              className="progress-bar"
              style={{ width: `${progress.total > 0 ? ((progress.done + progress.failed) / progress.total) * 100 : 0}%` }}
            />
          </div>
          {progress.current_file && (
            <div className="batch-current-file">{progress.current_file}</div>
          )}
          {progress.file_progress > 0 && progress.file_progress < 1 && (
            <div className="progress-bar-container" style={{ height: 3, marginTop: 4 }}>
              <div
                className="progress-bar"
                style={{
                  width: `${progress.file_progress * 100}%`,
                  background: "var(--fg-dim)",
                }}
              />
            </div>
          )}
        </div>
      )}

      {error && <div className="alert-error">! {error}</div>}

      {log.length > 0 && (
        <div className="log-panel">
          {log.map((l, i) => <div key={i} className="log-line">{l}</div>)}
        </div>
      )}
    </div>
  );
}
