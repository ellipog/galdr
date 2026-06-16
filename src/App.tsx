import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import HomePage from "./pages/HomePage";
import ConvertPage from "./pages/ConvertPage";
import BatchConvertPage from "./pages/BatchConvertPage";
import SettingsPage from "./pages/SettingsPage";
import ScrambleText from "./components/ScrambleText";
import UpdateBanner from "./components/UpdateBanner";
import PageTransition from "./transitions";
import { useGaldrStore } from "./store";
import "./App.css";

type Page = "home" | "convert" | "batch" | "settings";

function App() {
  const [page, setPage] = useState<Page>("home");
  const [prevPage, setPrevPage] = useState<Page>("home");
  const [appVersion, setAppVersion] = useState("");
  const transitionStyle = useGaldrStore((s) => s.transitionStyle);
  const win = getCurrentWindow();

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("0.1.0"));
  }, []);

  const handleSettings = () => {
    if (page === "settings") {
      setPage(prevPage);
    } else {
      setPrevPage(page);
      setPage("settings");
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
    return [{ label: page, target: page }];
  })();

  const pathSegs = [...rootSegs, ...pageSegs];

  return (
    <div className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left">
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
          {page === "settings" && <SettingsPage onNavigate={setPage} />}
        </PageTransition>
      </main>
    </div>
  );
}

export default App;
