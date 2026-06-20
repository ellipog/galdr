import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { enable, disable } from "@tauri-apps/plugin-autostart";
import { useGaldrStore } from "../store";
import Dropdown from "../components/Dropdown";
import { TRANSITION_OPTIONS } from "../transitions";
import { useContextMenu } from "../components/ContextMenu";

const SUBFOLDERS = ["video", "audio", "image"];

interface Props {
  onNavigate: (page: "batch" | "watch") => void;
}

export default function SettingsPage({ onNavigate }: Props) {
  const {
    outputDir, setOutputDir,
    transitionStyle, setTransitionStyle,
    triggerTransitionTest,
    setUpdateDismissed,
    showRuneInTitlebar, setShowRuneInTitlebar,
    discordEnabled, setDiscordEnabled,
    autostartEnabled, setAutostartEnabled,
  } = useGaldrStore();
  const [version, setVersion] = useState("");
  const { show } = useContextMenu();

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("0.1.0"));
  }, []);

  const toggleDiscord = useCallback(() => {
    const next = !discordEnabled;
    setDiscordEnabled(next);
    invoke("set_discord_enabled", { enabled: next }).catch(() => {});
  }, [discordEnabled, setDiscordEnabled]);

  const toggleAutostart = useCallback(() => {
    const next = !autostartEnabled;
    setAutostartEnabled(next);
    if (next) enable().catch(() => setAutostartEnabled(false));
    else disable().catch(() => setAutostartEnabled(true));
  }, [autostartEnabled, setAutostartEnabled]);

  const pickFolder = async () => {
    const sel = await open({ directory: true, multiple: false });
    if (sel) setOutputDir(sel as string);
  };

  const handleOutputDirContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "browse", rune: "ᚨ", action: pickFolder },
      { label: "copy path", rune: "ᚷ", action: () => navigator.clipboard.writeText(outputDir) },
      ...(outputDir ? [{ label: "clear", rune: "ᛏ", action: () => setOutputDir("") }] : []),
    ]);
  }, [show, outputDir, pickFolder, setOutputDir]);

  const handleUpdateContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "check for updates", rune: "ᚠ", action: () => setUpdateDismissed(false) },
    ]);
  }, [show, setUpdateDismissed]);

  const handleTransitionContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "test transition", rune: "ᛟ", action: triggerTransitionTest },
      { label: "reset to default", rune: "ᛏ", action: () => setTransitionStyle("none") },
    ]);
  }, [show, triggerTransitionTest, setTransitionStyle]);

  const handleDiscordContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: discordEnabled ? "turn off" : "turn on", rune: "ᚷ", action: toggleDiscord },
    ]);
  }, [show, discordEnabled, toggleDiscord]);

  const handleSubfolderContext = useCallback((e: React.MouseEvent, sub: string) => {
    e.stopPropagation();
    const path = `${outputDir}/${sub}/`;
    show(e, [
      { label: "copy path", rune: "ᚷ", action: () => navigator.clipboard.writeText(path) },
      { label: "open in explorer", rune: "ᛏ", action: () => invoke("reveal_in_folder", { path }).catch(() => {}) },
    ]);
  }, [show, outputDir]);

  const handleBatchSectionContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: "navigate to batch", rune: "ᛏ", action: () => onNavigate("batch") },
    ]);
  }, [show, onNavigate]);

  return (
    <div className="page">
      <h2>ᚲ settings</h2>

      <div className="card" onContextMenu={handleOutputDirContext}>
        <label className="label">base output folder</label>
        <div className="row">
          <input className="input" value={outputDir} placeholder="not set — will prompt on convert" readOnly />
          <button className="btn" onClick={pickFolder}>browse</button>
        </div>
        {outputDir && (
          <p className="settings-hint">
            single-file conversions are organized into subfolders by media type
          </p>
        )}
      </div>

      {outputDir && (
        <div className="card">
          <label className="label">auto-created subfolders</label>
          <div className="settings-subs">
            {SUBFOLDERS.map((sf) => (
              <div key={sf} className="settings-sub" onContextMenu={(e) => handleSubfolderContext(e, sf)}>
                <span className="settings-sub-name">{sf}/</span>
                <span className="settings-sub-path">{outputDir}/{sf}/</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" onContextMenu={handleBatchSectionContext}>
        <label className="label">batch conversion</label>
        <p className="settings-hint">
          batch mode uses its own input and output folders independent of this setting.
          navigate to{" "}
          <span className="nav-path-link" onClick={() => onNavigate("batch")}>
            ~/galdr/convert/batch
          </span>{" "}
          to use it.
        </p>
      </div>

      <div className="card">
        <label className="label">background &amp; watch folders</label>
        <p className="settings-hint" style={{ margin: 0 }}>
          watch folders convert incoming files automatically, even when the window is
          closed to the tray. configure them in{" "}
          <span className="nav-path-link" onClick={() => onNavigate("watch")}>
            ~/galdr/watch
          </span>.
        </p>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="toggle-label" style={{ flex: 1 }}>launch at login</label>
          <button
            className={`btn toggle-btn${autostartEnabled ? " active" : ""}`}
            onClick={toggleAutostart}
          >
            {autostartEnabled ? "on" : "off"}
          </button>
        </div>
      </div>

      <div className="card" onContextMenu={handleUpdateContext}>
        <label className="label">updates</label>
        <div className="row">
          <p className="settings-hint" style={{ flex: 1, margin: 0 }}>
            v{version || "..."} &mdash; checks GitHub on startup
          </p>
          <button className="btn" onClick={() => setUpdateDismissed(false)}>
            ᚠ check
          </button>
        </div>
      </div>

      <div className="card" onContextMenu={handleTransitionContext}>
        <label className="label">page transition</label>
        <div className="row">
          <div style={{ flex: 1 }}>
            <Dropdown
              options={TRANSITION_OPTIONS}
              value={transitionStyle}
              onChange={(v) => setTransitionStyle(v as typeof transitionStyle)}
            />
          </div>
          <button
            className="btn"
            disabled={transitionStyle === "none"}
            onClick={triggerTransitionTest}
          >
            ᛟ test
          </button>
        </div>
      </div>


      {import.meta.env.DEV_MODE && (
        <div className="card">
          <label className="label">dev options</label>
          <div className="row">
            <label className="toggle-label" style={{ flex: 1 }}>
              rune tags nav: titlebar vs home card
            </label>
            <button
              className={`btn toggle-btn${showRuneInTitlebar ? " active" : ""}`}
              onClick={() => setShowRuneInTitlebar(!showRuneInTitlebar)}
            >
              {showRuneInTitlebar ? "titlebar" : "home"}
            </button>
          </div>
        </div>
      )}
      <div className="card" onContextMenu={handleDiscordContext}>
        <label className="label">Discord Rich Presence</label>
        <div className="row">
          <p className="settings-hint" style={{ flex: 1, margin: 0 }}>
            show what you&rsquo;re doing on your Discord profile
          </p>
          <button
            className={`btn toggle-btn${discordEnabled ? " active" : ""}`}
            onClick={toggleDiscord}
          >
            {discordEnabled ? "on" : "off"}
          </button>
        </div>
      </div>
    </div>
  );
}
