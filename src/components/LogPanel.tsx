import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface Props {
  lines: string[];
  onContextMenu?: (e: React.MouseEvent) => void;
}

export default function LogPanel({ lines, onContextMenu }: Props) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines arrive (only when open)
  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines, open]);

  if (lines.length === 0) return null;

  return (
    <div className="log-panel" onContextMenu={onContextMenu}>
      <button
        className="log-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="log-toggle-arrow">{open ? "▾" : "▸"}</span>
        <span className="log-toggle-label">log</span>
        <span className="log-toggle-count">{lines.length} line{lines.length !== 1 ? "s" : ""}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            ref={bodyRef}
            className="log-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            {lines.map((l, i) => (
              <div key={i} className="log-line">{l}</div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
