import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion } from "framer-motion";
import ScrambleText from "../components/ScrambleText";
import RuneTagEditor from "../components/RuneTagEditor";
import RuneImportPreview from "../components/RuneImportPreview";
import { useContextMenu } from "../components/ContextMenu";
import { useGaldrStore } from "../store";
import {
  summarizePreset,
  presetType,
  presetTypeLabel,
  defaultRuneGlyph,
} from "../utils/runeMerge";
import type { RuneTag, GaldrRunesFile } from "../types";
import type { PresetType } from "../utils/runeMerge";

/** Seeded starter runes use ids like "starter-1"; user runes use UUIDs. */
function isStarter(tag: RuneTag): boolean {
  return tag.id.startsWith("starter-");
}

const FILTER_TYPES: { value: "all" | PresetType; label: string }[] = [
  { value: "all", label: "all" },
  { value: "video", label: "video" },
  { value: "audio", label: "audio" },
  { value: "image", label: "image" },
  { value: "animated", label: "animated" },
  { value: "time", label: "time fx" },
];

export default function RunesPage() {
  const tags = useGaldrStore((s) => s.runeTags);
  const refreshRuneTags = useGaldrStore((s) => s.refreshRuneTags);
  const pendingRunesImport = useGaldrStore((s) => s.pendingRunesImport);
  const setPendingRunesImport = useGaldrStore((s) => s.setPendingRunesImport);
  const [editing, setEditing] = useState<RuneTag | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | PresetType>("all");
  const [message, setMessage] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<{ runes: RuneTag[]; sourceName: string } | null>(null);
  const { show } = useContextMenu();

  // Keep in sync with the shared store: refresh whenever the page mounts.
  useEffect(() => {
    refreshRuneTags();
  }, [refreshRuneTags]);

  // When a .galdr runes file is opened externally (or via the import button),
  // the runes land in the store. Pick them up and open the preview modal.
  useEffect(() => {
    if (pendingRunesImport) {
      setImportPreview(pendingRunesImport);
      setPendingRunesImport(null);
    }
  }, [pendingRunesImport, setPendingRunesImport]);

  // Auto-dismiss message after 4s
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(id);
  }, [message]);

  const handleSave = async (tag: RuneTag) => {
    try {
      await invoke<RuneTag>("save_rune_tag", { tag });
      await refreshRuneTags();
      setEditing(undefined);
      setCreating(false);
    } catch (e) {
      setMessage(`! failed to save rune: ${e}`);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await invoke("delete_rune_tag", { id });
      await refreshRuneTags();
    } catch (e) {
      console.error("Failed to delete rune tag", e);
    }
    setDeleting(null);
  };

  const handleExport = useCallback(async (scope: "all" | "user") => {
    try {
      const exported = scope === "user"
        ? tags.filter((t) => !isStarter(t))
        : tags;
      if (exported.length === 0) {
        setMessage("! no runes to export");
        return;
      }
      const path = await save({
        filters: [{ name: "Rune Collection", extensions: ["galdr"] }],
        defaultPath: "runes.galdr",
      });
      if (!path) return; // user cancelled
      const data: GaldrRunesFile = {
        type: "galdr-runes",
        version: "1.0",
        runes: exported,
      };
      const content = JSON.stringify(data, null, 2);
      await invoke("save_project_file", { path, content });
      setMessage(`exported ${exported.length} rune${exported.length > 1 ? "s" : ""}`);
    } catch (e) {
      setMessage(`! export failed: ${e}`);
    }
  }, [tags, setMessage]);

  const handleImport = useCallback(async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Rune Collection", extensions: ["galdr", "json"] }],
      });
      if (!path) return; // user cancelled

      const content = await invoke<string>("load_project_file", { path });
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        setMessage("! invalid file: not valid JSON");
        return;
      }

      // Accept both the new wrapped format ({ type: "galdr-runes", runes: [...] })
      // and the legacy bare-array format ([ { ...rune }, ... ]).
      let runes: unknown[];
      if (
        parsed && typeof parsed === "object" &&
        (parsed as { type?: unknown }).type === "galdr-runes" &&
        Array.isArray((parsed as { runes?: unknown[] }).runes)
      ) {
        runes = (parsed as GaldrRunesFile).runes;
      } else if (Array.isArray(parsed)) {
        runes = parsed;
      } else {
        setMessage("! invalid rune collection: expected a .galdr runes file or rune array");
        return;
      }

      // Validate each entry up front; only structurally-valid runes make it
      // to the preview modal where the user picks which to import.
      const valid: RuneTag[] = [];
      let skipped = 0;
      for (const raw of runes) {
        if (!raw || typeof raw !== "object" || typeof (raw as any).name !== "string" || !(raw as any).params) {
          skipped++;
          continue;
        }
        const params = (raw as any).params;
        if (!params || typeof params.output_format !== "string") {
          skipped++;
          continue;
        }
        valid.push({
          id: "",
          name: String((raw as any).name),
          rune: typeof (raw as any).rune === "string" ? (raw as any).rune : defaultRuneGlyph(),
          description: typeof (raw as any).description === "string" ? (raw as any).description : "",
          params,
        });
      }

      if (valid.length === 0) {
        setMessage("! no valid runes found in file");
        return;
      }

      const sourceName = path.split(/[/\\]/).pop() || path;
      setPendingRunesImport({ runes: valid, sourceName });
      if (skipped > 0) {
        // Surface invalid entries without blocking the import flow.
        setMessage(`loaded ${valid.length} rune${valid.length > 1 ? "s" : ""} (${skipped} skipped)`);
      }
    } catch (e) {
      setMessage(`! import failed: ${e}`);
    }
  }, [setMessage, setPendingRunesImport]);

  // Persist the runes the user ticked in the preview modal. IDs are cleared so
  // each import creates fresh runes (never overwrites an existing one).
  const handleConfirmImport = useCallback(async (selected: RuneTag[]) => {
    if (selected.length === 0) {
      setImportPreview(null);
      return;
    }
    let imported = 0;
    let failed = 0;
    for (const tag of selected) {
      try {
        await invoke<RuneTag>("save_rune_tag", { tag: { ...tag, id: "" } });
        imported++;
      } catch {
        failed++;
      }
    }
    await refreshRuneTags();
    setImportPreview(null);
    setMessage(
      imported > 0
        ? `imported ${imported} rune${imported > 1 ? "s" : ""}${failed > 0 ? ` (${failed} failed)` : ""}`
        : "! import failed",
    );
  }, [refreshRuneTags, setMessage]);

  const handleCardContext = useCallback((e: React.MouseEvent, tag: RuneTag) => {
    e.stopPropagation();
    show(e, [
      { label: "edit", rune: "ᛏ", action: () => setEditing(tag) },
      { label: "duplicate", rune: "ᚷ", action: async () => {
        const dup: RuneTag = { ...tag, id: crypto.randomUUID(), name: `${tag.name} (copy)` };
        await invoke("save_rune_tag", { tag: dup });
        await refreshRuneTags();
      }},
      { label: "", rune: "", action: () => {}, divider: true },
      { label: "delete", rune: "ᚨ", action: () => handleDelete(tag.id) },
    ]);
  }, [show, refreshRuneTags]);

  const handleEmptyContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "new preset", rune: "ᚨ", action: () => setCreating(true) },
      { label: "", rune: "", action: () => {}, divider: true },
      { label: "import runes", rune: "ᚨ", action: handleImport },
      { label: "export all", rune: "ᚷ", action: () => handleExport("all") },
    ]);
  }, [show, handleImport, handleExport]);

  const handleHeaderContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "new preset", rune: "ᚨ", action: () => setCreating(true) },
      { label: "", rune: "", action: () => {}, divider: true },
      { label: "import runes", rune: "ᚨ", action: handleImport },
      { label: "export all", rune: "ᚷ", action: () => handleExport("all") },
    ]);
  }, [show, handleImport, handleExport]);

  const starters = useMemo(() => tags.filter(isStarter), [tags]);
  const userRunes = useMemo(() => tags.filter((t) => !isStarter(t)), [tags]);

  const filterTag = useCallback((tag: RuneTag) => {
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const haystack = [
        tag.name,
        tag.description,
        tag.rune,
        summarizePreset(tag.params),
      ].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (typeFilter !== "all" && presetType(tag.params) !== typeFilter) return false;
    return true;
  }, [searchQuery, typeFilter]);

  const filteredStarters = useMemo(() => starters.filter(filterTag), [starters, filterTag]);
  const filteredUserRunes = useMemo(() => userRunes.filter(filterTag), [userRunes, filterTag]);

  const hasActiveFilter = searchQuery.trim().length > 0 || typeFilter !== "all";
  const noMatch = hasActiveFilter && filteredUserRunes.length === 0 && filteredStarters.length === 0;

  const renderCard = (tag: RuneTag) => {
    const type = presetType(tag.params);
    return (
      <motion.div
        key={tag.id}
        className="rune-card"
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        whileHover={{ scale: 1.02 }}
        onContextMenu={(e) => handleCardContext(e, tag)}
      >
        <div className="rune-card-main" onClick={() => setEditing(tag)}>
          <div className="rune-card-top">
            <span className="rune-card-rune">{tag.rune}</span>
            <span className={`rune-card-badge badge-${type}`}>{presetTypeLabel(type)}</span>
          </div>
          <span className="rune-card-name">{tag.name}</span>
          <span className="rune-card-desc">{tag.description}</span>
          <span className="rune-card-params">{summarizePreset(tag.params)}</span>
        </div>
        <button
          className="rune-card-delete"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(tag.id);
          }}
          disabled={deleting === tag.id}
          title="delete"
        >
          {deleting === tag.id ? "..." : "x"}
        </button>
      </motion.div>
    );
  };

  return (
    <div className="page runes-page">
      <header className="runes-header" onContextMenu={handleHeaderContext}>
        <ScrambleText as="h1" className="page-heading" text="ᚠ rune tags" hover load />
        <p className="runes-subtitle">
          save conversion settings as named runes, then apply them anywhere with one click —
          convert, compress, and batch. {tags.length > 0 && (
            <span className="runes-count">{tags.length} saved</span>
          )}
        </p>
      </header>

      {/* Toolbar: search + import/export */}
      <div className="rune-toolbar">
        <div className="rune-search-wrapper">
          <span className="rune-search-icon">ᚠ</span>
          <input
            className="rune-search"
            type="text"
            placeholder="filter runes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="rune-search-clear" onClick={() => setSearchQuery("")}>
              x
            </button>
          )}
        </div>
        <div className="rune-toolbar-actions">
          <button className="btn" onClick={handleImport} title="import runes from file">
            ᚨ import
          </button>
          <button
            className="btn"
            onClick={() => handleExport("all")}
            title="export all runes to file"
          >
            ᚷ export
          </button>
        </div>
      </div>

      {/* Type filter pills */}
      <div className="rune-filter-bar">
        {FILTER_TYPES.map((ft) => (
          <button
            key={ft.value}
            className={`rune-filter-btn${typeFilter === ft.value ? " active" : ""}`}
            onClick={() => setTypeFilter(ft.value)}
          >
            {ft.label}
          </button>
        ))}
      </div>

      {/* Message feedback */}
      <AnimatePresence>
        {message && (
          <motion.div
            className="rune-message"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rune-grid-actions">
        <motion.button
          className="rune-card rune-card-new"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setCreating(true)}
          onContextMenu={(e) => {
            e.stopPropagation();
            show(e, [{ label: "new preset", rune: "ᚨ", action: () => setCreating(true) }]);
          }}
        >
          <span className="rune-card-rune new">+</span>
          <span className="rune-card-name">new preset</span>
          <span className="rune-card-desc">capture current settings as a reusable rune</span>
        </motion.button>
      </div>

      {noMatch && (
        <div className="rune-empty" onContextMenu={handleEmptyContext}>
          <span className="rune-empty-icon">ᚱ</span>
          <span className="rune-empty-text">no runes match your filter</span>
        </div>
      )}

      {!noMatch && filteredUserRunes.length > 0 && (
        <section className="rune-section">
          <h2 className="rune-section-title">
            your runes
            {hasActiveFilter && (
              <span className="rune-section-hint">{filteredUserRunes.length} of {userRunes.length}</span>
            )}
          </h2>
          <div className="rune-grid">
            <AnimatePresence>
              {filteredUserRunes.map(renderCard)}
            </AnimatePresence>
          </div>
        </section>
      )}

      {!noMatch && filteredStarters.length > 0 && (
        <section className="rune-section">
          <h2 className="rune-section-title">
            starter runes
            <span className="rune-section-hint">examples — edit, duplicate, or delete any of them</span>
            {hasActiveFilter && (
              <span className="rune-section-hint">{filteredStarters.length} of {starters.length}</span>
            )}
          </h2>
          <div className="rune-grid">
            <AnimatePresence>
              {filteredStarters.map(renderCard)}
            </AnimatePresence>
          </div>
        </section>
      )}

      {tags.length === 0 && !creating && (
        <div className="rune-empty" onContextMenu={handleEmptyContext}>
          <span className="rune-empty-icon">ᚱ</span>
          <span className="rune-empty-text">no rune tags yet. create one to get started.</span>
        </div>
      )}

      <AnimatePresence>
        {(creating || editing) && (
          <RuneTagEditor
            tag={editing}
            onSave={handleSave}
            onCancel={() => {
              setEditing(undefined);
              setCreating(false);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {importPreview && (
          <RuneImportPreview
            runes={importPreview.runes}
            sourceName={importPreview.sourceName}
            onConfirm={handleConfirmImport}
            onCancel={() => setImportPreview(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
