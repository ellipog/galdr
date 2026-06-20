import { useState, useCallback } from "react";
import ScrambleText from "../components/ScrambleText";
import { useGaldrStore } from "../store";
import { useContextMenu } from "../components/ContextMenu";

interface Props {
  onNavigate: (page: "convert" | "batch" | "compress" | "runes" | "forge" | "watch") => void;
}

interface ToolCard {
  rune: string;
  label: string;
  desc: string;
  target: "convert" | "batch" | "compress" | "runes" | "forge" | "watch";
}

const TOOLS: ToolCard[] = [
  { rune: "ᚨ", label: "convert", desc: "single file conversion", target: "convert" },
  { rune: "ᚷ", label: "batch", desc: "bulk folder conversion", target: "batch" },
  { rune: "ᛉ", label: "compress", desc: "file size reduction", target: "compress" },
  { rune: "ᚲ", label: "forge", desc: "video editor timeline", target: "forge" },
  { rune: "ᚱ", label: "watch", desc: "auto-convert folders", target: "watch" },
  { rune: "ᚠ", label: "rune tags", desc: "saved presets", target: "runes" },
];

export default function HomePage({ onNavigate }: Props) {
  const [hoveredCard, setHoveredCard] = useState(-1);
  const showRuneInTitlebar = useGaldrStore((s) => s.showRuneInTitlebar);
  const { show } = useContextMenu();

  const tools = showRuneInTitlebar
    ? TOOLS.filter((t) => t.target !== "runes")
    : TOOLS;

  const handleCardContext = useCallback((e: React.MouseEvent, tool: ToolCard) => {
    e.stopPropagation();
    show(e, [
      { label: `open ${tool.label}`, rune: "ᛏ", action: () => onNavigate(tool.target) },
    ]);
  }, [show, onNavigate]);

  return (
    <div className="page">
      <div className="home-page-wrapper">
        <div className="home-tagline">ᚱ choose your path</div>
        <div className="home-cards">
          {tools.map((t, i) => (
            <div
              key={t.target}
              className="home-card"
              onClick={() => onNavigate(t.target)}
              onContextMenu={(e) => handleCardContext(e, t)}
              onMouseEnter={() => setHoveredCard(i)}
              onMouseLeave={() => setHoveredCard(-1)}
            >
              <ScrambleText as="span" className="home-card-rune" text={t.rune} load ticks={4} trigger={hoveredCard === i} />
              <div className="home-card-body">
                <ScrambleText as="span" className="home-card-label" text={t.label} load ticks={4} trigger={hoveredCard === i} />
                <span className="home-card-desc">{t.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
