import QualitySlider from "./QualitySlider";

interface Props {
  mode: "quality" | "targetSize";
  onModeChange: (mode: "quality" | "targetSize") => void;
  quality: number;
  onQualityChange: (v: number) => void;
  targetSizeValue: number;
  onTargetSizeValueChange: (v: number) => void;
  targetSizeUnit: "MB" | "KB";
  onTargetSizeUnitChange: (unit: "MB" | "KB") => void;
  targetSizeBytes: number;
  /** When set (duration > 0), shows estimated kbps in target-size mode */
  estimatedDuration?: number;
  onQualitySliderContext?: (e: React.MouseEvent) => void;
  onTargetSizeContext?: (e: React.MouseEvent) => void;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function CompressionControls({
  mode, onModeChange,
  quality, onQualityChange,
  targetSizeValue, onTargetSizeValueChange,
  targetSizeUnit, onTargetSizeUnitChange,
  targetSizeBytes, estimatedDuration,
  onQualitySliderContext, onTargetSizeContext,
}: Props) {
  return (
    <>
      {/* ── Mode toggle: quality vs target size ── */}
      <div className="mode-toggle-group">
        <button
          className={`mode-toggle-btn${mode === "quality" ? " active" : ""}`}
          onClick={() => onModeChange("quality")}
        >
          ᚠ quality
        </button>
        <button
          className={`mode-toggle-btn${mode === "targetSize" ? " active" : ""}`}
          onClick={() => onModeChange("targetSize")}
        >
          ᚨ target size
        </button>
      </div>

      {mode === "quality" ? (
        <div onContextMenu={onQualitySliderContext}>
          <QualitySlider
            label="quality"
            value={quality}
            onChange={onQualityChange}
          />
        </div>
      ) : (
        <div className="card" onContextMenu={onTargetSizeContext}>
          <label className="label">target file size</label>
          <div className="target-size-input-row">
            <input
              className="input target-size-input"
              type="number"
              min={1}
              value={targetSizeValue}
              onChange={(e) => onTargetSizeValueChange(Math.max(1, Number(e.target.value) || 1))}
            />
            <div className="target-size-unit-group">
              <button
                className={`target-size-unit-btn${targetSizeUnit === "MB" ? " active" : ""}`}
                onClick={() => onTargetSizeUnitChange("MB")}
              >
                MB
              </button>
              <button
                className={`target-size-unit-btn${targetSizeUnit === "KB" ? " active" : ""}`}
                onClick={() => onTargetSizeUnitChange("KB")}
              >
                KB
              </button>
            </div>
          </div>
          <div className="target-size-info">
            ≈ {fmtSize(targetSizeBytes || 0)}
            {estimatedDuration && estimatedDuration > 0
              ? <> &nbsp;·&nbsp; {Math.round((targetSizeBytes || 0) * 8 / estimatedDuration / 1000)} kbps</>
              : <> overall per file</>
            }
          </div>
        </div>
      )}
    </>
  );
}
