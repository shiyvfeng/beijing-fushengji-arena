import { useEffect, useState } from "react";

export function FullscreenControl({ className = "" }: { className?: string }) {
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement !== null);
  const [fullscreenAvailable] = useState(() => (
    document.fullscreenEnabled
    && typeof document.documentElement.requestFullscreen === "function"
    && typeof document.exitFullscreen === "function"
  ));

  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  const toggleFullscreen = async () => {
    if (!fullscreenAvailable) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  };

  return (
    <button
      type="button"
      className={`fullscreen-control ${className}`.trim()}
      aria-label={isFullscreen ? "退出全屏" : "进入全屏"}
      aria-pressed={isFullscreen}
      disabled={!fullscreenAvailable}
      title={fullscreenAvailable ? (isFullscreen ? "退出全屏" : "进入无浏览器界面的全屏") : "当前浏览器不支持全屏"}
      onClick={toggleFullscreen}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d={isFullscreen
          ? "M9 4v5H4m11-5v5h5m-5 11v-5h5M9 20v-5H4"
          : "M9 4H4v5m11-5h5v5m0 6v5h-5M4 15v5h5"} />
      </svg>
      <span>{isFullscreen ? "退出全屏" : "全屏"}</span>
    </button>
  );
}
