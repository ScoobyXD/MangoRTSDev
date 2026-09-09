import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { buildWallpaperScenes } from "../../../frontend/src/auth/authWallpaperScenes.js";
import { AuthWallpaper } from "../../../frontend/src/auth/AuthWallpaper.js";

const scenes = buildWallpaperScenes({
  "../assets/auth-wallpapers/01-city/720x1280.webp": "/city-small.webp",
  "../assets/auth-wallpapers/01-city/1080x1920.webp": "/city-portrait.webp",
  "../assets/auth-wallpapers/01-city/1920x1080.webp": "/city-landscape.webp",
  "../assets/auth-wallpapers/02-mountains/2560x1440.jpg": "/mountains.jpg",
  "../assets/auth-wallpapers/03-coast/1080x1920.avif": "/coast.avif",
});

const videoScenes = buildWallpaperScenes({
  "../assets/auth-wallpapers/01-city/1920x1080.webp": "/city-still.webp",
  "../assets/auth-wallpapers/01-city/loop.mp4": "/city-loop.mp4",
  "../assets/auth-wallpapers/02-coast/1920x1080.webp": "/coast-still.webp",
  "../assets/auth-wallpapers/02-coast/loop.webm": "/coast-loop.webm",
});

test("wallpaper folders group scenes separately from their optional size variants", () => {
  assert.equal(scenes.length, 3);
  assert.deepEqual(scenes.map((scene) => scene.id), ["01-city", "02-mountains", "03-coast"]);
  assert.equal(scenes[0].portrait?.srcSet, "/city-small.webp 720w, /city-portrait.webp 1080w");
  assert.match(scenes[0].landscape!.sizes, /177\.7778vh$/);
  assert.equal(scenes[1].portrait, undefined);
  assert.equal(scenes[2].landscape, undefined);
  assert.deepEqual(buildWallpaperScenes({ "../assets/auth-wallpapers/README.md": "/readme", "../assets/auth-wallpapers/city/photo.jpg": "/bad.jpg" }), []);
});

test("loop videos belong to the same scene as still variants, with MP4 preferred when both formats exist", () => {
  const result = buildWallpaperScenes({
    "../assets/auth-wallpapers/02-video-only/loop.webm": "/only.webm",
    "../assets/auth-wallpapers/01-city/loop.webm": "/city.webm",
    "../assets/auth-wallpapers/01-city/1920x1080.webp": "/city.webp",
    "../assets/auth-wallpapers/01-city/loop.mp4": "/city.mp4",
    "../assets/auth-wallpapers/03-invalid/movie.mp4": "/movie.mp4",
  });
  assert.deepEqual(result.map((scene) => scene.id), ["01-city", "02-video-only"]);
  assert.equal(result[0].video, "/city.mp4");
  assert.equal(result[0].landscape?.src, "/city.webp");
  assert.equal(result[1].video, "/only.webm");
  assert.equal(result[1].portrait, undefined);
  assert.equal(result[1].landscape, undefined);
});

test("wallpaper loading, rotation, and accessibility lifecycle", async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/login", pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLImageElement", "HTMLMediaElement", "HTMLVideoElement", "Element", "Node", "Event"]) {
    install(key, key === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[key]);
  }
  install("IS_REACT_ACT_ENVIRONMENT", true);
  let hidden = false;
  let reducedMotion = false;
  const motion = new dom.window.EventTarget();
  Object.defineProperty(motion, "matches", { get: () => reducedMotion });
  Object.defineProperty(document, "hidden", { get: () => hidden });
  Object.defineProperty(window, "matchMedia", { value: () => motion });
  const decoding = new Map<HTMLImageElement, { resolve: () => void; reject: () => void }>();
  Object.defineProperty(dom.window.HTMLImageElement.prototype, "decode", { value: function (this: HTMLImageElement) {
    return new Promise<void>((resolve, reject) => { decoding.set(this, { resolve, reject: () => reject(new Error("Bad image")) }); });
  } });
  const playing = new Map<HTMLVideoElement, { resolve: () => void; reject: () => void }[]>();
  const pauses = new Map<HTMLVideoElement, number>();
  Object.defineProperty(dom.window.HTMLMediaElement.prototype, "play", { value: function (this: HTMLVideoElement) {
    return new Promise<void>((resolve, reject) => {
      const calls = playing.get(this) ?? [];
      calls.push({ resolve, reject: () => reject(new Error("Video playback blocked")) });
      playing.set(this, calls);
    });
  } });
  Object.defineProperty(dom.window.HTMLMediaElement.prototype, "pause", { value: function (this: HTMLVideoElement) {
    pauses.set(this, (pauses.get(this) ?? 0) + 1);
  } });
  const { createRoot } = await import("react-dom/client");
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  let mountID = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tick = async (ms: number) => { await act(async () => { t.mock.timers.tick(ms); }); };
  const images = () => Array.from(container.querySelectorAll("img"));
  const videos = () => Array.from(container.querySelectorAll("video"));
  const mount = async (value = scenes) => { await act(async () => { root.render(<AuthWallpaper key={++mountID} scenes={value} />); }); };
  const load = async (image: HTMLImageElement, succeeds = true) => {
    await act(async () => { image.dispatchEvent(new Event("load")); });
    assert.ok(decoding.has(image));
    await act(async () => { decoding.get(image)![succeeds ? "resolve" : "reject"](); });
  };
  const play = async (video: HTMLVideoElement, succeeds = true) => {
    const calls = playing.get(video);
    assert.ok(calls?.length, "the active video starts playback");
    await act(async () => { calls.at(-1)![succeeds ? "resolve" : "reject"](); });
  };
  try {
    await t.test("empty assets render no image requests", async () => {
      await mount([]);
      assert.equal(images().length, 0);
      await tick(120_000);
      assert.equal(images().length, 0);
    });

    await t.test("only the next scene loads; decode failure preserves the current scene and skips the failed scene", async () => {
      await mount();
      assert.equal(images().length, 1);
      assert.equal(container.querySelectorAll(".is-visible").length, 0);
      assert.equal(container.querySelector("source")?.media, "(orientation: portrait)");
      await load(images()[0]);
      await tick(0);
      const first = images()[0];
      await tick(59_999);
      assert.deepEqual(images(), [first]);
      await tick(1);
      assert.equal(images().length, 2);
      assert.equal(images()[1].getAttribute("src"), "/mountains.jpg");
      assert.equal(container.querySelectorAll(".is-visible").length, 1);
      await load(images()[1], false);
      assert.deepEqual(images(), [first]);
      await tick(60_000);
      const coast = images()[1];
      assert.equal(coast.getAttribute("src"), "/coast.avif");
      await load(coast);
      assert.equal(container.querySelectorAll(".is-visible").length, 2);
      await tick(1_600);
      assert.deepEqual(images(), [coast], "decoded image is reused when it becomes current");
      await tick(60_000);
      assert.equal(images()[1].getAttribute("src"), "/city-landscape.webp");
    });

    await t.test("hidden pages cancel pending work and restart the interval when visible", async () => {
      await mount();
      await load(images()[0]);
      await tick(0);
      const first = images()[0];
      await tick(60_000);
      const pending = images()[1];
      await act(async () => { pending.dispatchEvent(new Event("load")); });
      await act(async () => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
      assert.deepEqual(images(), [first]);
      await act(async () => { decoding.get(pending)!.resolve(); });
      await tick(180_000);
      assert.deepEqual(images(), [first]);
      await act(async () => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
      await tick(59_999);
      assert.deepEqual(images(), [first]);
      await tick(1);
      assert.equal(images().length, 2);
    });

    await t.test("one scene and reduced motion do not rotate", async () => {
      await mount(scenes.slice(0, 1));
      await load(images()[0]);
      await tick(0);
      const single = images()[0];
      await tick(180_000);
      assert.deepEqual(images(), [single]);
      reducedMotion = true;
      await mount();
      await load(images()[0]);
      await tick(0);
      const still = images()[0];
      await tick(180_000);
      assert.deepEqual(images(), [still]);
      await act(async () => { reducedMotion = false; motion.dispatchEvent(new Event("change")); });
      await tick(60_000);
      assert.equal(images().length, 2);
    });

    await t.test("silent inline loops become visible only after playback starts and reuse the pending video", async () => {
      await mount(videoScenes);
      const first = videos()[0];
      assert.equal(first.getAttribute("src"), "/city-loop.mp4");
      assert.equal(first.muted, true);
      assert.equal(first.loop, true);
      assert.equal(first.playsInline, true);
      assert.equal(first.controls, false);
      assert.equal(images().length, 0);
      assert.equal(container.querySelectorAll(".is-visible").length, 0);
      await tick(5_000);
      assert.equal(container.querySelectorAll(".is-visible").length, 0);
      await play(first);
      await tick(0);
      assert.deepEqual(videos(), [first]);
      await tick(60_000);
      const pending = videos()[1];
      assert.equal(pending.getAttribute("src"), "/coast-loop.webm");
      assert.equal(container.querySelectorAll(".is-visible").length, 1);
      await tick(5_000);
      assert.equal(container.querySelectorAll(".is-visible").length, 1);
      await play(pending);
      assert.equal(container.querySelectorAll(".is-visible").length, 2);
      await tick(1_600);
      assert.deepEqual(videos(), [pending]);
      assert.ok((pauses.get(first) ?? 0) > 0, "the outgoing video pauses when removed");
    });

    await t.test("blocked playback loads the scene's still image without retrying the video", async () => {
      await mount(videoScenes.slice(0, 1));
      const video = videos()[0];
      await play(video, false);
      assert.equal(videos().length, 0);
      assert.equal(images()[0].getAttribute("src"), "/city-still.webp");
      assert.equal(container.querySelectorAll(".is-visible").length, 0);
      await load(images()[0]);
      await tick(0);
      assert.equal(container.querySelectorAll(".is-visible").length, 1);
      await tick(180_000);
      assert.equal(videos().length, 0);
      assert.ok((pauses.get(video) ?? 0) > 0);
    });

    await t.test("a video error falls back to its still image even after playback starts", async () => {
      await mount(videoScenes.slice(0, 1));
      const video = videos()[0];
      await play(video);
      await tick(0);
      await act(async () => { video.dispatchEvent(new Event("error")); });
      assert.equal(videos().length, 0);
      assert.equal(images()[0].getAttribute("src"), "/city-still.webp");
      await load(images()[0]);
      await tick(0);
      assert.equal(container.querySelectorAll(".is-visible").length, 1);
    });

    await t.test("a pending video error postpones the transition until its fallback image decodes", async () => {
      await mount(videoScenes);
      const first = videos()[0];
      await play(first);
      await tick(0);
      await tick(60_000);
      const pending = videos()[1];
      await play(pending);
      assert.equal(container.querySelectorAll(".is-visible").length, 2);
      await act(async () => { pending.dispatchEvent(new Event("error")); });
      const fallback = images()[0];
      assert.equal(fallback.getAttribute("src"), "/coast-still.webp");
      assert.equal(container.querySelectorAll(".is-visible").length, 1);
      await tick(1_600);
      assert.deepEqual(videos(), [first], "the current scene remains until the fallback is ready");
      await load(fallback);
      assert.equal(container.querySelectorAll(".is-visible").length, 2);
      await tick(1_600);
      assert.equal(videos().length, 0);
      assert.deepEqual(images(), [fallback]);
    });

    await t.test("a failed video without a still image skips to the next available scene", async () => {
      await mount([{ id: "video-only", video: "/only.mp4" }, scenes[1]]);
      await play(videos()[0], false);
      assert.equal(videos().length, 0);
      assert.equal(images()[0].getAttribute("src"), "/mountains.jpg");
      await load(images()[0]);
      await tick(0);
      await tick(180_000);
      assert.equal(videos().length, 0);
      assert.equal(images().length, 1);
    });

    await t.test("hiding pauses current playback, cancels pending playback, and resumes only the current video", async () => {
      await mount(videoScenes);
      const first = videos()[0];
      await play(first);
      await tick(0);
      await tick(60_000);
      const pending = videos()[1];
      const currentPlayCount = playing.get(first)!.length;
      const currentPauseCount = pauses.get(first) ?? 0;
      await act(async () => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
      assert.deepEqual(videos(), [first]);
      assert.ok((pauses.get(first) ?? 0) > currentPauseCount);
      assert.ok((pauses.get(pending) ?? 0) > 0);
      await play(pending);
      await tick(180_000);
      assert.deepEqual(videos(), [first], "a late play result cannot restore the cancelled transition");
      assert.equal(playing.get(first)!.length, currentPlayCount);
      await act(async () => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
      assert.equal(playing.get(first)!.length, currentPlayCount + 1);
      await play(first);
      await tick(59_999);
      assert.deepEqual(videos(), [first]);
      await tick(1);
      assert.equal(videos().length, 2);
      const beforeUnmount = pauses.get(first) ?? 0;
      await mount([]);
      assert.ok((pauses.get(first) ?? 0) > beforeUnmount);
    });

    await t.test("reduced motion uses only still images and changing the preference cancels a pending video", async () => {
      reducedMotion = true;
      await mount(videoScenes);
      assert.equal(videos().length, 0);
      assert.equal(images()[0].getAttribute("src"), "/city-still.webp");
      await load(images()[0]);
      await tick(0);
      const still = images()[0];
      await tick(180_000);
      assert.deepEqual(images(), [still]);
      await act(async () => { reducedMotion = false; motion.dispatchEvent(new Event("change")); });
      assert.equal(videos().length, 1);
      const first = videos()[0];
      await play(first);
      await tick(60_000);
      const pending = videos()[1];
      await act(async () => { reducedMotion = true; motion.dispatchEvent(new Event("change")); });
      assert.equal(videos().length, 0);
      assert.equal(images().length, 1);
      assert.equal(images()[0].getAttribute("src"), "/city-still.webp");
      assert.ok((pauses.get(first) ?? 0) > 0);
      assert.ok((pauses.get(pending) ?? 0) > 0);
      await play(pending);
      await load(images()[0]);
      await tick(180_000);
      assert.equal(videos().length, 0);
      assert.equal(images().length, 1);
      await act(async () => { reducedMotion = false; motion.dispatchEvent(new Event("change")); });
    });

    await t.test("reduced motion leaves the gradient visible for a video-only scene without starting playback", async () => {
      reducedMotion = true;
      const playsBefore = playing.size;
      await mount([{ id: "video-only", video: "/only.mp4" }, scenes[1]]);
      assert.equal(videos().length, 0);
      assert.equal(playing.size, playsBefore);
      assert.equal(images().length, 0);
      await tick(0);
      await tick(180_000);
      assert.equal(images().length, 0);
      assert.equal(videos().length, 0);
      reducedMotion = false;
    });
  } finally {
    await act(async () => root.unmount());
    t.mock.timers.reset();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});
