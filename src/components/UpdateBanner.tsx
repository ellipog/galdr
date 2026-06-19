import { useEffect, useRef, useState, useCallback } from "react";
import { check } from "@tauri-apps/plugin-updater";
import type { Update, DownloadEvent } from "@tauri-apps/plugin-updater";
import { useGaldrStore } from "../store";

const DEV_UPDATE_TEST = import.meta.env.VITE_UPDATE_TEST === "true";

export default function UpdateBanner() {
  const {
    updateStatus, setUpdateStatus,
    updateVersion, setUpdateVersion,
    updateProgress, setUpdateProgress,
    updateDismissed, setUpdateDismissed,
    updateError, setUpdateError,
  } = useGaldrStore();

  const updateRef = useRef<Update | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (updateDismissed) return;
    setUpdateStatus("checking");
    setUpdateError(null);
    check({ timeout: 10000 })
      .then((u) => {
        if (u) {
          updateRef.current = u;
          setUpdateVersion(u.version);
          setUpdateStatus("available");
        } else if (DEV_UPDATE_TEST) {
          setUpdateVersion("9.9.9");
          setUpdateStatus("available");
        } else {
          setUpdateStatus("idle");
        }
      })
      .catch(() => {
        if (DEV_UPDATE_TEST) {
          setUpdateVersion("9.9.9");
          setUpdateStatus("available");
        } else {
          setUpdateStatus("idle");
        }
      });
  }, [updateDismissed]);

  const handleUpgrade = useCallback(async () => {
    const u = updateRef.current;
    if (DEV_UPDATE_TEST) {
      setUpdateStatus("downloading");
      setDownloadedBytes(0);
      setTotalBytes(5_000_000);
      let pct = 0;
      const interval = setInterval(() => {
        pct += Math.random() * 15 + 5;
        if (pct >= 100) {
          pct = 100;
          clearInterval(interval);
          setUpdateProgress(100);
          setDownloadedBytes(5_000_000);
          setTimeout(() => setUpdateStatus("downloaded"), 400);
        } else {
          setUpdateProgress(Math.round(pct));
          setDownloadedBytes(Math.round((pct / 100) * 5_000_000));
        }
      }, 500);
      return;
    }
    if (!u) return;
    setUpdateStatus("downloading");
    setDownloadedBytes(0);
    setTotalBytes(undefined);
    try {
      await u.download((event: DownloadEvent) => {
        if (event.event === "Started") {
          setTotalBytes(event.data.contentLength);
          setDownloadedBytes(0);
        } else if (event.event === "Progress") {
          setDownloadedBytes((prev) => {
            const next = prev + event.data.chunkLength;
            if (totalBytes) {
              setUpdateProgress(Math.min(100, Math.round((next / totalBytes) * 100)));
            }
            return next;
          });
        } else if (event.event === "Finished") {
          setUpdateProgress(100);
        }
      });
      setUpdateStatus("downloaded");
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
      setUpdateStatus("error");
    }
  }, [totalBytes]);

  const handleInstall = useCallback(async () => {
    const u = updateRef.current;
    if (DEV_UPDATE_TEST) {
      setUpdateStatus("installing");
      setTimeout(() => {
        setUpdateDismissed(true);
        setUpdateStatus("idle");
      }, 1500);
      return;
    }
    if (!u) return;
    setUpdateStatus("installing");
    try {
      await u.install();
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
      setUpdateStatus("error");
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setUpdateDismissed(true);
    setUpdateStatus("idle");
    setUpdateError(null);
  }, []);

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (updateStatus === "idle" || updateStatus === "checking") return null;

  return (
    <>
      {/* Banner */}
      {updateStatus === "available" && !updateDismissed && (
        <div className="update-banner">
          <span className="update-banner-rune">ᚠ</span>
          <span className="update-banner-text">
            update available: <strong>v{updateVersion}</strong>
            {DEV_UPDATE_TEST && <span className="update-banner-dev"> [dev test]</span>}
          </span>
          <button className="btn update-banner-btn" onClick={handleUpgrade}>
            ᛏ upgrade
          </button>
          <button className="btn update-banner-btn update-banner-dismiss" onClick={handleDismiss}>
            later
          </button>
        </div>
      )}

      {/* Download modal overlay */}
      {(updateStatus === "downloading" || updateStatus === "downloaded" || updateStatus === "installing" || updateStatus === "error") && (
        <div className="update-overlay">
          <div className="update-modal">
            <div className="update-modal-header">
              <span className="update-modal-rune">
                {updateStatus === "downloading" && "ᛏ"}
                {updateStatus === "downloaded" && "ᚷ"}
                {updateStatus === "installing" && "ᚱ"}
                {updateStatus === "error" && "ᛉ"}
              </span>
              <span className="update-modal-title">
                {updateStatus === "downloading" && `downloading v${updateVersion}`}
                {updateStatus === "downloaded" && "download complete"}
                {updateStatus === "installing" && "installing..."}
                {updateStatus === "error" && "update failed"}
              </span>
            </div>

            {updateStatus === "downloading" && (
              <div className="update-modal-body">
                <div className="progress-bar-container">
                  <div className="progress-bar" style={{ width: `${updateProgress}%` }} />
                </div>
                <span className="progress-text">
                  {formatBytes(downloadedBytes)}
                  {totalBytes !== undefined && ` / ${formatBytes(totalBytes)}`}
                  {"  "}{updateProgress}%
                </span>
              </div>
            )}

            {updateStatus === "downloaded" && (
              <div className="update-modal-actions">
                <button className="btn btn-primary" onClick={handleInstall}>
                  ᚷ install & restart
                </button>
                <button className="btn" onClick={handleDismiss}>
                  later
                </button>
              </div>
            )}

            {updateStatus === "installing" && (
              <div className="update-modal-body">
                <span className="update-modal-hint">the application will restart</span>
              </div>
            )}

            {updateStatus === "error" && (
              <div className="update-modal-actions">
                <span className="update-modal-hint">
                  {updateError || "something went wrong"}
                </span>
                <button className="btn" onClick={handleDismiss}>
                  close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}