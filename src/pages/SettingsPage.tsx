import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { useGaldrStore } from "../store";
import Dropdown from "../components/Dropdown";
import { TRANSITION_OPTIONS } from "../transitions";

const SUBFOLDERS = ["video", "audio", "image"];

interface Props {
  onNavigate: (page: "batch") => void;
}

export default function SettingsPage({ onNavigate }: Props) {
  const {
    outputDir, setOutputDir,
    transitionStyle, setTransitionStyle,
    triggerTransitionTest,
    setUpdateDismissed,
    showRuneInTitlebar, setShowRuneInTitlebar,
    discordEnabled, setDiscordEnabled,
  } = useGaldrStore();
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("0.1.0"));
  }, []);

  const toggleDiscord = useCallback(() => {
    const next = !discordEnabled;
    setDiscordEnabled(next);
    invoke("set_discord_enabled", { enabled: next }).catch(() => {});
  }, [discordEnabled, setDiscordEnabled]);

  const pickFolder = async () => {
    const sel = await open({ directory: true, multiple: false });
    if (sel) setOutputDir(sel as string);
  };

  return (
    <div className="page">
      <h2>ᚲ settings</h2>

      <div className="card">
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
              <div key={sf} className="settings-sub">
                <span className="settings-sub-name">{sf}/</span>
                <span className="settings-sub-path">{outputDir}/{sf}/</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
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

      <div className="card">
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
      <div className="card">
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
