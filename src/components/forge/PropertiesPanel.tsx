import { useForgeStore } from "../../store/forgeStore";

export default function PropertiesPanel() {
  const project = useForgeStore((s) => s.project);
  const updateClip = useForgeStore((s) => s.updateClip);

  const selected =
    project.videoTrack.clips.find((c) => c.selected) ||
    project.audioTrack.clips.find((c) => c.selected);

  const trackKey = project.videoTrack.clips.some((c) => c.selected) ? "video" as const : "audio" as const;

  return (
    <div className="forge-properties">
      <div className="forge-panel-header">
        <span className="forge-panel-title">ᛏ properties</span>
      </div>
      <div className="forge-properties-body">
        <div className="forge-prop-row">
          <span className="forge-prop-label">name</span>
          <input
            className="forge-prop-input"
            value={selected?.name ?? ""}
            disabled={!selected}
            onChange={(e) => selected && updateClip(selected.id, { name: e.target.value }, trackKey)}
          />
        </div>
        <div className="forge-prop-row">
          <span className="forge-prop-label">source</span>
          <span className={`forge-prop-value dim${!selected ? " faint" : ""}`}>
            {selected ? selected.sourcePath.split(/[/\\]/).pop() : "—"}
          </span>
        </div>
        <div className="forge-prop-divider" />
        <div className="forge-prop-row">
          <span className="forge-prop-label">in</span>
          <input
            className="forge-prop-input narrow"
            type="number"
            step={0.1}
            min={0}
            disabled={!selected}
            value={selected ? Math.round(selected.sourceStart * 10) / 10 : 0}
            onChange={(e) => {
              if (!selected) return;
              const v = parseFloat(e.target.value) || 0;
              updateClip(selected.id, { sourceStart: v, sourceEnd: Math.max(selected.sourceEnd, v + 0.1) }, trackKey);
            }}
          />
          <span className="forge-prop-suffix">s</span>
        </div>
        <div className="forge-prop-row">
          <span className="forge-prop-label">out</span>
          <input
            className="forge-prop-input narrow"
            type="number"
            step={0.1}
            min={0}
            disabled={!selected}
            value={selected ? Math.round(selected.sourceEnd * 10) / 10 : 0}
            onChange={(e) => {
              if (!selected) return;
              const v = parseFloat(e.target.value) || 0;
              updateClip(selected.id, { sourceEnd: v, sourceStart: Math.min(selected.sourceStart, v - 0.1) }, trackKey);
            }}
          />
          <span className="forge-prop-suffix">s</span>
        </div>
        <div className="forge-prop-row">
          <span className="forge-prop-label">speed</span>
          <input
            className="forge-prop-input narrow"
            type="number"
            step={0.05}
            min={0.25}
            max={4}
            disabled={!selected}
            value={selected ? selected.speed : 1}
            onChange={(e) => {
              if (!selected) return;
              const v = parseFloat(e.target.value) || 1;
              updateClip(selected.id, { speed: Math.max(0.25, Math.min(4, v)) }, trackKey);
            }}
          />
          <span className="forge-prop-suffix">x</span>
        </div>
      </div>
    </div>
  );
}