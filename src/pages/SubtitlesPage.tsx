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
import { useSubtitleStore, bindSubtitleEvents } from "../store/subtitleStore";
import { LANGUAGE_OPTIONS, LANGUAGE_LABEL } from "../options/languages";
import { useContextMenu } from "../components/ContextMenu";
import type { MediaInfo, WhisperModel } from "../types";

const MEDIA_FILTERS = [
  "mp4", "mkv", "avi", "mov", "webm", "m4v", "flv", "ogv", "wmv", "ts",
  "mp3", "flac", "wav", "aac", "ogg", "opus", "wma", "m4a", "aiff", "ac3",
];

const OUTPUT_FORMAT_OPTIONS = [
  { value: "srt", label: "srt (subtitles)", category: "format" },
  { value: "vtt", label: "vtt (web subtitles)", category: "format" },
  { value: "json", label: "json (word timing)", category: "format" },
  { value: "all", label: "all formats", category: "format" },
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
 * Subtitle Manager page. Phase 1 ships AI transcription via whisper.cpp;
 * burn/embed/extract and the in-app editor arrive in later phases.
 *
 * Layout mirrors ConvertPage: a mode-tab strip, an input drop-zone, a
 * MediaInfoCard, the operation controls, and a result bar.
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
    error,
    load,
    transcribe,
    cancelTranscription,
    clearError,
    resetLog,
  } = useSubtitleStore();

  const [inputPath, setInputPath] = useState("");
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [modelId, setModelId] = useState("");
  const [language, setLanguage] = useState("auto");
  const [translateToEnglish, setTranslateToEnglish] = useState(false);
  const [outputFormat, setOutputFormat] = useState("srt");
  const [outputDir, setOutputDir] = useState("");
  const [btnHover, setBtnHover] = useState(false);
  const { show } = useContextMenu();

  /* ── Bootstrap: load catalog + bind events once ── */
  useEffect(() => {
    load();
    bindSubtitleEvents();
  }, [load]);

  /* ── Auto-select default model once the catalog loads ── */
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

  const selectedModel: WhisperModel | undefined = models.find((m) => m.id === modelId);
  const modelIsInstalled = !!selectedModel?.installed;

  /* ── File loading ── */
  const loadFile = useCallback(async (path: string) => {
    clearError();
    resetLog();
    setInputPath(path);
    setMediaInfo(null);
    try {
      const info = await invoke<MediaInfo>("get_media_info", { path });
      setMediaInfo(info);
    } catch (e) {
      setMediaInfo(null);
      // Don't surface as error — some audio formats probe oddly; whisper can still try.
      console.warn("media info failed:", e);
    }
  }, [clearError, resetLog]);

  const pickFile = useCallback(async () => {
    const sel = await open({
      multiple: false,
      filters: [{ name: "Media", extensions: MEDIA_FILTERS }],
    });
    if (sel) loadFile(sel as string);
  }, [loadFile]);

  /* ── Drag-and-drop ── */
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
          // Subtitle transcription takes a single media file; ignore folders.
          invoke<boolean>("is_directory", { path }).then((isDir) => {
            if (!isDir) loadFile(path);
          });
        }),
      );
    })();
    return () => { unlisteners.forEach((u) => u()); };
  }, [loadFile]);

  /* ── Output dir default ── */
  useEffect(() => {
    if (!outputDir) {
      invoke<string>("get_default_output_dir")
        .then((d) => setOutputDir(`${d}/subtitles`))
        .catch(() => {});
    }
  }, [outputDir]);

  const browseOutputDir = useCallback(async () => {
    const sel = await open({ directory: true, multiple: false });
    if (sel) setOutputDir(sel as string);
  }, []);

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
    if (transcriptionLog.length === 0) return;
    show(e, [
      { label: "copy all", rune: "ᚷ", action: () => navigator.clipboard.writeText(transcriptionLog.join("\n")) },
      { label: "clear", rune: "ᚨ", action: () => resetLog() },
    ]);
  }, [show, transcriptionLog, resetLog]);

  const handleResultContext = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    show(e, [
      { label: "show in folder", rune: "ᛏ", action: () => revealItemInDir(path) },
      { label: "copy path", rune: "ᚷ", action: () => navigator.clipboard.writeText(path) },
    ]);
  }, [show]);

  /* ── Derived ── */
  const canTranscribe = !!inputPath && modelIsInstalled && !transcribing;
  const translateDisabled = language === "en";

  return (
    <div className="page subtitles-page">
      {/* Mode tabs — only transcribe active in Phase 1 */}
      <div className="mode-tabs">
        <button className="mode-tab active">ᛊ transcribe</button>
        <button className="mode-tab disabled" title="coming soon">burn-in</button>
        <button className="mode-tab disabled" title="coming soon">embed</button>
        <button className="mode-tab disabled" title="coming soon">extract</button>
      </div>

      {/* whisper binary availability alert */}
      {loaded && !whisperAvailable && (
        <div className="alert-error" title={whisperResolvedPath}>
          ! whisper-cli not found — looked for: {whisperResolvedPath || "(unresolved)"}
        </div>
      )}

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

      <div className="section-heading">
        <span className="section-heading-line" />
        <span className="section-heading-rune">ᛟ</span>
        <span className="section-heading-label">transcription</span>
      </div>

      {/* Model selector card */}
      <div className="card" onContextMenu={handleModelContext}>
        <label className="label">model</label>
        <Dropdown
          options={models.map((m) => ({
            value: m.id,
            label: `${m.label}${m.installed ? "  ✓" : ""}`,
            category: m.languageClass === "english-only" ? "english-only" : "multilingual",
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

      {/* Model manager */}
      <ModelManager
        selectedId={modelId}
        onSelect={setModelId}
        allowDelete={!transcribing}
      />

      {/* Language + translate card */}
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

      {error && (
        <div className="alert-error" onClick={() => clearError()} style={{ cursor: "pointer" }}>
          ! {error}
        </div>
      )}

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

      {transcribing && (
        <div className="progress-bar-container">
          <div className="progress-bar" style={{ width: `${transcriptionProgress * 100}%` }} />
          <span className="progress-text">{Math.round(transcriptionProgress * 100)}%</span>
        </div>
      )}

      {transcriptionLog.length > 0 && (
        <LogPanel lines={transcriptionLog} onContextMenu={handleLogContext} />
      )}

      {lastResult && !transcribing && (
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
    </div>
  );
}
