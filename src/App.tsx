import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, ProgressBarStatus, UserAttentionType } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import HomePage from "./pages/HomePage";
import ConvertPage from "./pages/ConvertPage";
import BatchConvertPage from "./pages/BatchConvertPage";
import CompressPage from "./pages/CompressPage";
import SettingsPage from "./pages/SettingsPage";
import RunesPage from "./pages/RunesPage";
import ScrambleText from "./components/ScrambleText";
import UpdateBanner from "./components/UpdateBanner";
import PageTransition from "./transitions";
import { useGaldrStore } from "./store";
import "./App.css";

type Page = "home" | "convert" | "batch" | "compress" | "settings" | "runes";

function App() {
  const [page, setPage] = useState<Page>("home");
  const [prevPage, setPrevPage] = useState<Page>("home");
  const [appVersion, setAppVersion] = useState("");
  const transitionStyle = useGaldrStore((s) => s.transitionStyle);
  const taskbarAction = useGaldrStore((s) => s.taskbarAction);
  const taskbarProgress = useGaldrStore((s) => s.taskbarProgress);
  const taskbarFlash = useGaldrStore((s) => s.taskbarFlash);
  const setTaskbarFlash = useGaldrStore((s) => s.setTaskbarFlash);
  const showRuneInTitlebar = useGaldrStore((s) => s.showRuneInTitlebar);
  const win = getCurrentWindow();
  const prevFlash = useRef(false);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("0.1.0"));
  }, []);

  useEffect(() => {
    invoke("update_discord_presence", { page }).catch(() => {});
  }, [page]);

  useEffect(() => {
    const title = taskbarAction ? `GALDR - ${taskbarAction}` : "GALDR";
    win.setTitle(title).catch(() => {});
  }, [taskbarAction, win]);

  useEffect(() => {
    if (taskbarProgress === null) {
      win.setProgressBar({ progress: 0, status: ProgressBarStatus.None }).catch(() => {});
    } else {
      win.setProgressBar({ progress: Math.round(taskbarProgress * 100), status: ProgressBarStatus.Normal }).catch(() => {});
    }
  }, [taskbarProgress, win]);

  useEffect(() => {
    if (taskbarFlash && !prevFlash.current) {
      prevFlash.current = true;
      win.requestUserAttention(UserAttentionType.Critical).catch(() => {});
      setTimeout(() => {
        prevFlash.current = false;
        setTaskbarFlash(false);
      }, 100);
    }
  }, [taskbarFlash, win, setTaskbarFlash]);

  const handleSettings = () => {
    if (page === "settings") {
      setPage(prevPage);
    } else {
      setPrevPage(page);
      setPage("settings");
    }
  };

  const handleRunes = () => {
    if (page === "runes") {
      setPage(prevPage);
    } else {
      setPrevPage(page);
      setPage("runes");
    }
  };

  const rootSegs: { label: string; target: Page }[] = [
    { label: "~", target: "home" },
    { label: "galdr", target: "home" },
  ];

  const pageSegs: { label: string; target: Page }[] = (() => {
    if (page === "convert") {
      return [
        { label: "convert", target: "convert" },
        { label: "single", target: "convert" },
      ];
    }
    if (page === "batch") {
      return [
        { label: "convert", target: "convert" },
        { label: "batch", target: "batch" },
      ];
    }
    if (page === "compress") {
      return [
        { label: "compress", target: "compress" },
      ];
    }
    if (page === "runes") {
      return [
        { label: "runes", target: "runes" },
      ];
    }
    return [{ label: page, target: page }];
  })();

  const pathSegs = [...rootSegs, ...pageSegs];

  return (
    <div className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left">
          {showRuneInTitlebar && (
            <button className="titlebar-btn titlebar-rune-btn" onClick={handleRunes}>
              <span className="ts-rune">ᚠ</span>
            </button>
          )}
          <button className="titlebar-btn titlebar-settings" onClick={handleSettings}>
            <span className="ts-rune">ᚲ</span>
            <span className="ts-label">settings</span>
          </button>
        </div>
        <ScrambleText as="span" className="titlebar-logo" text="ᚷ Galdr" hover load />
        <div className="titlebar-controls">
          <button className="titlebar-btn" onClick={() => win.minimize()}>
            _
          </button>
          <button className="titlebar-btn" onClick={() => win.toggleMaximize()}>
            []
          </button>
          <button className="titlebar-btn titlebar-close" onClick={() => win.close()}>
            x
          </button>
        </div>
      </header>

      <nav className="path-nav">
        {pathSegs.map((seg, i) => (
          <span key={i} className="path-group">
            {i > 0 && <span className="path-sep">/</span>}
            <span
              className={`path-seg${i === pathSegs.length - 1 ? " active" : ""}`}
              onClick={() => seg.target !== page && setPage(seg.target)}
            >
              {seg.label}
            </span>
          </span>
        ))}
        <span className="path-sep trail">/</span>
        {appVersion && <span className="path-version">v{appVersion}</span>}
      </nav>

      <main className="main-content">
        <UpdateBanner />
        <PageTransition style={transitionStyle} pageKey={page}>
          {page === "home" && <HomePage onNavigate={setPage} />}
          {page === "convert" && <ConvertPage />}
          {page === "batch" && <BatchConvertPage />}
          {page === "compress" && <CompressPage />}
          {page === "settings" && <SettingsPage onNavigate={setPage} />}
          {page === "runes" && <RunesPage />}
        </PageTransition>
      </main>
    </div>
  );
}

export default App;
