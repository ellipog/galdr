import { motion } from "framer-motion";
import type { MediaInfo } from "../types";

interface Props {
  info: MediaInfo;
  mediaType: "video" | "audio" | "image" | null;
  onContextMenu?: (e: React.MouseEvent) => void;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function fmtDur(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function MediaInfoCard({ info, mediaType, onContextMenu }: Props) {
  const videoStreams = info.streams.filter((s) => s.kind === "video");
  const audioStreams = info.streams.filter((s) => s.kind === "audio");
  const otherStreams = info.streams.filter((s) => s.kind !== "video" && s.kind !== "audio");

  return (
    <motion.div
      className="mi-card"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onContextMenu={onContextMenu}
    >
      {/* General info row */}
      <div className="mi-row">
        <span className="mi-label">container</span>
        <span className="mi-value">{info.container}</span>
        <span className="mi-label">size</span>
        <span className="mi-value">{fmtSize(info.size)}</span>
      </div>
      {info.bitrate && info.bitrate > 0 && (
        <div className="mi-row">
          <span className="mi-label">bitrate</span>
          <span className="mi-value">{((info.bitrate ?? 0) / 1000).toFixed(0)} kbps</span>
          <span className="mi-label">type</span>
          <span className="mi-value">{mediaType ?? "—"}</span>
        </div>
      )}
      {info.duration > 0 && (
        <div className="mi-row">
          <span className="mi-label">duration</span>
          <span className="mi-value">{fmtDur(info.duration)}</span>
          <span className="mi-label" />
          <span className="mi-value" />
        </div>
      )}

      {videoStreams.length > 0 && <hr className="mi-divider" />}
      {videoStreams.map((s, i) => (
        <div key={`v${i}`}>
          <div className="mi-row">
            <span className="mi-label">{i === 0 ? "video" : ""}</span>
            <span className="mi-value">{s.codec}</span>
            <span className="mi-label">res</span>
            <span className="mi-value">
              {s.width && s.height ? `${s.width}×${s.height}` : "—"}
            </span>
          </div>
          {s.frame_rate && s.frame_rate > 0 && (
            <div className="mi-row">
              <span className="mi-label" />
              <span className="mi-value" />
              <span className="mi-label">fps</span>
              <span className="mi-value">{s.frame_rate.toFixed(1)}</span>
            </div>
          )}
        </div>
      ))}

      {audioStreams.length > 0 && <hr className="mi-divider" />}
      {audioStreams.map((s, i) => (
        <div key={`a${i}`}>
          <div className="mi-row">
            <span className="mi-label">{i === 0 ? "audio" : ""}</span>
            <span className="mi-value">{s.codec}</span>
            <span className="mi-label">ch</span>
            <span className="mi-value">{s.channels ? `${s.channels}ch` : "—"}</span>
          </div>
          {s.sample_rate && s.sample_rate > 0 && (
            <div className="mi-row">
              <span className="mi-label" />
              <span className="mi-value" />
              <span className="mi-label">sample</span>
              <span className="mi-value">{(s.sample_rate / 1000).toFixed(0)} kHz</span>
            </div>
          )}
        </div>
      ))}

      {otherStreams.length > 0 && <hr className="mi-divider" />}
      {otherStreams.map((s, i) => (
        <div className="mi-row" key={`o${i}`}>
          <span className="mi-label">{i === 0 ? s.kind : ""}</span>
          <span className="mi-value">{s.codec}</span>
          <span className="mi-label" />
          <span className="mi-value" />
        </div>
      ))}
    </motion.div>
  );
}
