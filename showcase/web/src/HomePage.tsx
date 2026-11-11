import { useRef, useState, type CSSProperties } from "react";
import { AssetSlot } from "./AssetSlot";
import { FullscreenControl } from "./FullscreenControl";
import { assetManifest } from "./asset-manifest";
import { audioManifest } from "./audio-manifest";

type MusicState = "off" | "playing" | "error";

function documentAssetUrl(path: string | null): string | null {
  return path ? new URL(path, document.baseURI).href : null;
}

const homeBackgroundWide = documentAssetUrl(assetManifest["home.background.pixel-wide"].src);
const homeBackgroundNarrow = documentAssetUrl(assetManifest["home.background.pixel-narrow"].src);
const homeBackgroundStyle = {
  "--home-background-wide": homeBackgroundWide ? `url("${homeBackgroundWide}")` : "none",
  "--home-background-narrow": homeBackgroundNarrow ? `url("${homeBackgroundNarrow}")` : "none",
} as CSSProperties;

export function HomePage() {
  const sessionView = Boolean(document.getElementById("arena-session-data"));
  const [musicState, setMusicState] = useState<MusicState>("off");
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggleMusic = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (musicState === "playing") {
      audio.pause();
      setMusicState("off");
      return;
    }
    audio.volume = 0.25;
    audio.loop = true;
    try {
      await audio.play();
      setMusicState("playing");
    } catch {
      setMusicState("error");
    }
  };

  return (
    <main className="home-shell" style={homeBackgroundStyle}>
      <section className="home-stage" aria-label="北京浮生记首页">
        <nav className="home-toolbar" aria-label="首页辅助功能">
          <FullscreenControl className="home-fullscreen-control" />
          {!sessionView && <button
            type="button"
            className="music-control"
            aria-pressed={musicState === "playing"}
            disabled={musicState === "error"}
            onClick={toggleMusic}
          >
            {musicState === "playing" ? "音乐开关：开" : musicState === "error" ? "音乐暂不可用" : "音乐开关：关"}
          </button>}
          <a className="rules-control" href="./rules.html">
            玩法介绍 <span aria-hidden="true">?</span>
          </a>
        </nav>

        <AssetSlot
          assetId="home.hero.zhongguancun"
          className="home-hero"
          loading="eager"
          fallback={<span>首页主视觉暂不可用</span>}
        />

        <div className="home-actions" aria-label="首页主要入口">
          <a className="home-action home-action--primary" href="./replay.html">比赛回放</a>
          {!sessionView && <a className="home-action home-action--secondary" href="./bench.html">
            Bench 分析
            <span>Gold 1 + 2</span>
          </a>}
        </div>
      </section>

      {!sessionView && <audio
        ref={audioRef}
        src={audioManifest["demo.bgm.happy-times"].src}
        preload="none"
        onError={() => setMusicState("error")}
      />}

    </main>
  );
}
