import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { presetType, presetTypeLabel, summarizePreset } from "../utils/runeMerge";
import type { RuneTag } from "../types";
import type { PresetType } from "../utils/runeMerge";

interface Props {
  runes: RuneTag[];
  sourceName: string;
  onConfirm: (selected: RuneTag[]) => void;
  onCancel: () => void;
}

/**
 * Modal that previews runes about to be imported from a `.galdr` runes file.
 * Every rune is checked by default; the user can untick any they don't want
 * before confirming. The same modal opens whether the file was picked via the
 * import button or double-clicked in the OS file explorer.
 */
export default function RuneImportPreview({ runes, sourceName, onConfirm, onCancel }: Props) {
  // Selection is tracked by index so duplicate-named runes stay distinct.
  const [selected, setSelected] = useState<Set<number>>(() => new Set(runes.map((_, i) => i)));

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const selectAll = () => setSelected(new Set(runes.map((_, i) => i)));
  const deselectAll = () => setSelected(new Set());

  const selectedCount = selected.size;

  const sorted = useMemo(
    () => runes.map((r, i) => ({ rune: r, index: i })),
    [runes],
  );

  return (
    <motion.div
      className="rune-editor-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="rune-editor import-preview"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
      >
        <div className="rune-editor-header">
          <span className="rune-editor-rune">ᚨ</span>
          <span className="rune-editor-title">
            import runes
            <span className="import-preview-source" title={sourceName}>{sourceName}</span>
          </span>
        </div>

        <div className="import-preview-toolbar">
          <div className="import-preview-toolbar-actions">
            <button className="import-preview-link" onClick={selectAll}>select all</button>
            <span className="import-preview-sep">·</span>
            <button className="import-preview-link" onClick={deselectAll}>deselect all</button>
          </div>
          <span className="import-preview-count">
            {selectedCount} of {runes.length} selected
          </span>
        </div>

        <div className="import-preview-list">
          {sorted.map(({ rune, index }) => {
            const type: PresetType = presetType(rune.params);
            const checked = selected.has(index);
            return (
              <label
                key={index}
                className={`import-preview-item${checked ? " checked" : ""}`}
              >
                <input
                  type="checkbox"
                  className="import-preview-checkbox"
                  checked={checked}
                  onChange={() => toggle(index)}
                />
                <span className="import-preview-item-rune">{rune.rune}</span>
                <div className="import-preview-item-info">
                  <div className="import-preview-item-top">
                    <span className="import-preview-item-name">{rune.name}</span>
                    <span className={`rune-card-badge badge-${type}`}>{presetTypeLabel(type)}</span>
                  </div>
                  {rune.description && (
                    <span className="import-preview-item-desc">{rune.description}</span>
                  )}
                  <span className="import-preview-item-params">{summarizePreset(rune.params)}</span>
                </div>
              </label>
            );
          })}
        </div>

        <div className="rune-editor-footer">
          <button className="btn" onClick={onCancel}>
            cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onConfirm(runes.filter((_, i) => selected.has(i)))}
            disabled={selectedCount === 0}
            title={selectedCount === 0 ? "select at least one rune" : `import ${selectedCount} rune${selectedCount > 1 ? "s" : ""}`}
          >
            import {selectedCount > 0 ? `(${selectedCount})` : ""}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
