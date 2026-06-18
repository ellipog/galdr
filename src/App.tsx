import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, ProgressBarStatus, UserAttentionType } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import HomePage from "./pages/HomePage";
import ConvertPage from "./pages/ConvertPage";
import BatchConvertPage from "./pages/BatchConvertPage";
import CompressPage from "./pages/CompressPage";
import SettingsPage from "./pages/SettingsPage";
import RunesPage from "./pages/RunesPage";
import ForgePage from "./pages/ForgePage";
import ScrambleText from "./components/ScrambleText";
import UpdateBanner from "./components/UpdateBanner";
import PageTransition from "./transitions";
import { useGaldrStore } from "./store";
import { useForgeStore } from "./store/forgeStore";
import { ContextMenuProvider, useContextMenu } from "./components/ContextMenu";
import "./App.css";

type Page = "home" | "convert" | "batch" | "compress" | "settings" | "runes" | "forge";

function AppShell() {
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
  const { show } = useContextMenu();

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("0.1.0"));
  }, []);

  useEffect(() => {
    if (page === "forge") {
      const forgeState = useForgeStore.getState();
      const vclips = forgeState.project.videoTrack.clips.length;
      const aclips = forgeState.project.audioTrack.clips.length;
      const totalDur = [...forgeState.project.videoTrack.clips, ...forgeState.project.audioTrack.clips]
        .reduce((s, c) => s + c.duration, 0);
      invoke("update_discord_presence", { page, forgeClips: vclips + aclips, forgeDuration: totalDur }).catch((e) => console.error("discord rpc:", e));
    } else {
      invoke("update_discord_presence", { page, forgeClips: null, forgeDuration: null }).catch((e) => console.error("discord rpc:", e));
    }
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
    if (page === "forge") {
      return [
        { label: "forge", target: "forge" },
      ];
    }
    return [{ label: page, target: page }];
  })();

  const pathSegs = [...rootSegs, ...pageSegs];

  const handleGlobalContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    show(e, [
      { label: "quick convert", rune: "ᛏ", action: () => setPage("convert") },
      { label: "batch convert", rune: "ᚨ", action: () => setPage("batch") },
      { label: "compress", rune: "ᛉ", action: () => setPage("compress") },
      { label: "forge editor", rune: "ᚲ", action: () => setPage("forge") },
      { label: "", rune: "", action: () => {}, divider: true },
      { label: "rune tags", rune: "ᚠ", action: () => setPage("runes") },
      { label: "settings", rune: "ᚲ", action: () => setPage("settings") },
    ]);
  }, [show, setPage]);

  const handlePathNavContext = useCallback((e: React.MouseEvent, target: Page, label: string) => {
    e.stopPropagation();
    show(e, [
      { label: `navigate to ${label}`, rune: "ᛏ", action: () => setPage(target) },
    ]);
  }, [show, setPage]);

  const handleVersionContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    show(e, [
      { label: `copy (v${appVersion})`, rune: "ᚷ", action: () => navigator.clipboard.writeText(appVersion) },
      { label: "check for updates", rune: "ᚠ", action: () => useGaldrStore.getState().setUpdateDismissed(false) },
    ]);
  }, [show, appVersion]);

  return (
    <div className="app-shell" onContextMenu={handleGlobalContextMenu}>
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
              onContextMenu={(e) => handlePathNavContext(e, seg.target, seg.label)}
            >
              {seg.label}
            </span>
          </span>
        ))}
        <span className="path-sep trail">/</span>
        {appVersion && <span className="path-version" onContextMenu={handleVersionContext}>v{appVersion}</span>}
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
          {page === "forge" && <ForgePage />}
        </PageTransition>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ContextMenuProvider>
      <AppShell />
    </ContextMenuProvider>
  );
}
