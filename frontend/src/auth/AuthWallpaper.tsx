import { useEffect, useRef, useState } from "react";
import { buildWallpaperScenes, type WallpaperScene } from "./authWallpaperScenes.js";

const wallpaperScenes = buildWallpaperScenes(import.meta.glob<string>(
  "../assets/auth-wallpapers/*/*.{jpg,jpeg,png,webp,avif,mp4,webm}",
  { eager: true, query: "?url&no-inline", import: "default" },
));
const ROTATION_MS = 60_000;
const FADE_MS = 1_600;

function Scene({ scene, visible, active, reducedMotion, onReady, onError }: {
  scene: WallpaperScene;
  visible: boolean;
  active: boolean;
  reducedMotion: boolean;
  onReady?: (ready: boolean) => void;
  onError: () => void;
}) {
  const source = scene.landscape ?? scene.portrait;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const playVideo = Boolean(scene.video && !reducedMotion && !videoFailed);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };

  useEffect(() => {
    if (!playVideo) {
      if (!source) {
        if (reducedMotion) callbacks.current.onReady?.(true);
        else callbacks.current.onError();
      }
      return;
    }
    const video = videoRef.current!;
    if (!active) return;
    let cancelled = false;
    void video.play().then(() => {
      if (!cancelled && !document.hidden) callbacks.current.onReady?.(true);
    }).catch(() => {
      if (!cancelled) {
        callbacks.current.onReady?.(false);
        setVideoFailed(true);
      }
    });
    return () => {
      cancelled = true;
      video.pause();
    };
  }, [active, playVideo, reducedMotion, scene.video, source]);

  return (
    <div className={`auth-wallpaper__scene${visible ? " is-visible" : ""}`}>
      {playVideo ? (
        <video
          ref={videoRef}
          src={scene.video}
          muted
          loop
          playsInline
          preload="auto"
          tabIndex={-1}
          onError={() => {
            onReady?.(false);
            setVideoFailed(true);
          }}
        />
      ) : source ? (
        <picture>
          {scene.portrait && scene.landscape && (
            <source media="(orientation: portrait)" srcSet={scene.portrait.srcSet} sizes={scene.portrait.sizes} />
          )}
          <img
            src={source.src}
            srcSet={source.srcSet}
            sizes={source.sizes}
            alt=""
            decoding="async"
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              const loadedSource = image.currentSrc;
              void image.decode().then(() => {
                if (image.isConnected && image.currentSrc === loadedSource && !document.hidden) onReady?.(true);
              }).catch(() => {
                if (image.isConnected && image.currentSrc === loadedSource) onError();
              });
            }}
            onError={onError}
          />
        </picture>
      ) : null}
    </div>
  );
}

export function AuthWallpaper({ scenes = wallpaperScenes }: { scenes?: readonly WallpaperScene[] }) {
  const [current, setCurrent] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(() => !document.hidden);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const failed = useRef(new Set<number>());

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      setReducedMotion(motion.matches);
      setPending(null);
      setReady(false);
    };
    const onVisibility = () => {
      setActive(!document.hidden);
      if (document.hidden) { setPending(null); setReady(false); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    motion.addEventListener("change", onMotion);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
    };
  }, []);

  useEffect(() => {
    if (!active || pending !== null || (current !== null && (reducedMotion || scenes.length < 2))) return;
    let next: number | null = null;
    for (let offset = 1; offset <= scenes.length; offset += 1) {
      const candidate = ((current ?? -1) + offset) % scenes.length;
      if (candidate !== current && !failed.current.has(candidate)) { next = candidate; break; }
    }
    if (next === null) return;
    if (current === null) { setPending(next); return; }
    const timer = window.setTimeout(() => setPending(next), ROTATION_MS);
    return () => window.clearTimeout(timer);
  }, [active, current, pending, reducedMotion, scenes]);

  useEffect(() => {
    if (!active || pending === null || !ready) return;
    const timer = window.setTimeout(() => {
      setCurrent(pending);
      setPending(null);
      setReady(false);
    }, current === null || reducedMotion ? 0 : FADE_MS);
    return () => window.clearTimeout(timer);
  }, [active, current, pending, ready, reducedMotion]);

  return (
    <div className="auth-wallpaper" aria-hidden="true">
      {current !== null && (
        <Scene key={scenes[current].id} scene={scenes[current]} visible active={active} reducedMotion={reducedMotion} onError={() => {
          failed.current.add(current);
          setCurrent(null);
        }} />
      )}
      {pending !== null && (
        <Scene key={scenes[pending].id} scene={scenes[pending]} visible={ready} active={active} reducedMotion={reducedMotion} onReady={setReady} onError={() => {
          failed.current.add(pending);
          setPending(null);
          setReady(false);
        }} />
      )}
    </div>
  );
}
