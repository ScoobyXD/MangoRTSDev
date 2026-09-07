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

test("wallpaper folders group scenes separately from their optional size variants", () => {
  assert.equal(scenes.length, 3);
  assert.deepEqual(scenes.map((scene) => scene.id), ["01-city", "02-mountains", "03-coast"]);
  assert.equal(scenes[0].portrait?.srcSet, "/city-small.webp 720w, /city-portrait.webp 1080w");
  assert.match(scenes[0].landscape!.sizes, /177\.7778vh$/);
  assert.equal(scenes[1].portrait, undefined);
  assert.equal(scenes[2].landscape, undefined);
  assert.deepEqual(buildWallpaperScenes({ "../assets/auth-wallpapers/README.md": "/readme", "../assets/auth-wallpapers/city/photo.jpg": "/bad.jpg" }), []);
});

test("wallpaper loading, rotation, and accessibility lifecycle", async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/login", pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLImageElement", "Element", "Node", "Event"]) {
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
  const { createRoot } = await import("react-dom/client");
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  let mountID = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tick = async (ms: number) => { await act(async () => { t.mock.timers.tick(ms); }); };
  const images = () => Array.from(container.querySelectorAll("img"));
  const mount = async (value = scenes) => { await act(async () => { root.render(<AuthWallpaper key={++mountID} scenes={value} />); }); };
  const load = async (image: HTMLImageElement, succeeds = true) => {
    await act(async () => { image.dispatchEvent(new Event("load")); });
    assert.ok(decoding.has(image));
    await act(async () => { decoding.get(image)![succeeds ? "resolve" : "reject"](); });
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
