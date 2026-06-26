import { useState, useCallback } from "react";
import { useSubtitleStore } from "../../store/subtitleStore";
import { useContextMenu, type ContextMenuItem } from "../ContextMenu";
import type { WhisperModel } from "../../types";

function fmtSize(bytes: number): string {
  if (!bytes || !isFinite(bytes)) return "—";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

const TIER_LABEL: Record<WhisperModel["tier"], string> = {
  fast: "fast",
  balanced: "balanced",
  accurate: "accurate",
  best: "best",
};

interface Props {
  /** Called when the active model changes (optional — page wires selection). */
  selectedId?: string;
  onSelect?: (id: string) => void;
  /** When false, hides the delete buttons (e.g. during transcription). */
  allowDelete?: boolean;
}

/**
 * Whisper model catalog card. Lists every offered ggml model with its size,
 * accuracy tier, and install state. Collapsed by default to keep the page
 * compact; expand to browse/install/delete. Downloads stream progress over
 * the shared `whisper-download-progress` event (read from the subtitle store).
 */
export default function ModelManager({ selectedId, onSelect, allowDelete = true }: Props) {
  const { models, downloads, installModel, deleteModel, refreshModels } = useSubtitleStore();
  const [open, setOpen] = useState(false);
  const { show } = useContextMenu();

  const installedBytes = models
    .filter((m) => m.installed)
    .reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0);

  const installedCount = models.filter((m) => m.installed).length;

  const handleContext = useCallback(
    (e: React.MouseEvent, m: WhisperModel) => {
      e.stopPropagation();
      const items: ContextMenuItem[] = [
        {
          label: m.installed ? `reinstall ${m.label}` : `install ${m.label}`,
          rune: "ᛏ",
          action: () => { void installModel(m.id); },
        },
      ];
      if (m.installed && allowDelete) {
        items.push({ label: "", rune: "", action: () => {}, divider: true });
        items.push({ label: `delete ${m.label}`, rune: "ᚨ", action: () => { void deleteModel(m.id); } });
      }
      items.push({ label: "", rune: "", action: () => {}, divider: true });
      items.push({ label: "refresh catalog", rune: "ᚷ", action: () => { void refreshModels(); } });
      show(e, items);
    },
    [show, installModel, deleteModel, refreshModels, allowDelete],
  );

  return (
    <div className="card whisper-models">
      <button
        className={`whisper-models-toggle${open ? " open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        onContextMenu={(e) => {
          e.stopPropagation();
          show(e, [
            { label: open ? "collapse" : "expand", rune: open ? "ᚨ" : "ᛏ", action: () => setOpen((v) => !v) },
            { label: "refresh catalog", rune: "ᚷ", action: () => { void refreshModels(); } },
          ]);
        }}
      >
        <span className="whisper-models-toggle-label">whisper models</span>
        <span className="whisper-models-toggle-meta">
          {installedCount > 0
            ? `${installedCount} installed · ${fmtSize(installedBytes)}`
            : `${models.length} available`}
        </span>
        <span className="whisper-models-toggle-arrow">{open ? "▼" : "▶"}</span>
      </button>

      {open && (
        <>
          {models.length === 0 ? (
            <div className="whisper-models-empty">no models available</div>
          ) : (
            <div className="whisper-model-grid">
              {models.map((m) => {
                const dl = downloads[m.id];
                const isDownloading = !!dl;
                const isSelected = selectedId === m.id;
                return (
                  <div
                    key={m.id}
                    className={`whisper-model-row${m.installed ? " installed" : ""}${isSelected ? " selected" : ""}`}
                    onClick={() => m.installed && onSelect?.(m.id)}
                    onContextMenu={(e) => handleContext(e, m)}
                  >
                    <div className="whisper-model-main">
                      <div className="whisper-model-name-row">
                        <span className="whisper-model-name">{m.label}</span>
                        <span className={`whisper-model-tier tier-${m.tier}`}>{TIER_LABEL[m.tier]}</span>
                        {m.quantized && (
                          <span className="whisper-model-quantized">Q</span>
                        )}
                        {m.languageClass === "english-only" && (
                          <span className="whisper-model-lang">en-only</span>
                        )}
                        {m.installed && <span className="whisper-model-installed" title="installed">✓</span>}
                      </div>
                      <div className="whisper-model-desc">{m.description}</div>
                      <div className="whisper-model-size">{fmtSize(m.sizeBytes)}</div>

                      {isDownloading && (
                        <div className="whisper-download-bar">
                          <div
                            className="progress-bar"
                            style={{ width: `${Math.round(dl.progress * 100)}%` }}
                          />
                          <span className="whisper-download-text">
                            {Math.round(dl.progress * 100)}%
                            {dl.totalBytes > 0 && ` · ${fmtSize(dl.downloadedBytes)}/${fmtSize(dl.totalBytes)}`}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="whisper-model-actions">
                      {m.installed ? (
                        allowDelete && (
                          <button
                            className="whisper-model-btn delete"
                            title="delete model"
                            disabled={isDownloading}
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteModel(m.id);
                            }}
                          >
                            ×
                          </button>
                        )
                      ) : (
                        <button
                          className="whisper-model-btn install"
                          title="install model"
                          disabled={isDownloading}
                          onClick={(e) => {
                            e.stopPropagation();
                            void installModel(m.id);
                          }}
                        >
                          {isDownloading ? "…" : "install"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
