import test from "node:test";
import assert from "node:assert/strict";
import {
  EDITOR_IMAGE_ATTACHMENT_ID_ATTRIBUTE,
  EDITOR_IMAGE_NODE_ATTRIBUTE,
  editorAttachmentImageSource,
  hydrateEditorAttachmentImageFrames,
  refreshEditorAttachmentImageFrames,
} from "../../../../frontend/src/modules/editor/editorImages.js";

class FakeImage {
  private readonly attributes = new Map<string, string>();
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  set src(value: string) { this.attributes.set("src", value); }
  get src() { return this.attributes.get("src") ?? ""; }
}

class FakeSpan {
  readonly attributes = new Map<string, string>();
  readonly image = new FakeImage();
  readonly style = { width: "220px", height: "160px", marginTop: "4px", marginLeft: "0px", marginRight: "0px", float: "none" };
  constructor(readonly attachmentID: string) {
    this.attributes.set(EDITOR_IMAGE_NODE_ATTRIBUTE, "true");
    this.attributes.set(EDITOR_IMAGE_ATTACHMENT_ID_ATTRIBUTE, attachmentID);
    this.image.src = editorAttachmentImageSource(attachmentID);
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  querySelector(selector: string) { return selector === "img" || selector === "img[src]" ? this.image : null; }
}

class FakeRoot {
  constructor(readonly frames: FakeSpan[]) {}
  querySelectorAll() { return this.frames; }
  contains(frame: FakeSpan) { return this.frames.includes(frame); }
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

test("one hydration owner loads each unique display attachment once and revokes every owned URL", async () => {
  const originalSpan = globalThis.HTMLSpanElement;
  const originalObserver = globalThis.IntersectionObserver;
  const originalRevoke = URL.revokeObjectURL;
  Object.assign(globalThis, { HTMLSpanElement: FakeSpan, IntersectionObserver: undefined });
  const revoked: string[] = [];
  URL.revokeObjectURL = (value) => { revoked.push(value); };
  try {
    const first = new FakeSpan("attachment-1");
    const duplicate = new FakeSpan("attachment-1");
    const second = new FakeSpan("attachment-2");
    const root = new FakeRoot([first, duplicate, second]);
    const calls: string[] = [];
    const cleanup = hydrateEditorAttachmentImageFrames(root as unknown as HTMLElement, async (attachmentID, variant) => {
      calls.push(`${attachmentID}:${variant}`);
      return `blob:${attachmentID}`;
    });
    await flushPromises();
    assert.deepEqual(calls.sort(), ["attachment-1:display", "attachment-2:display"]);
    assert.equal(first.image.src, "blob:attachment-1");
    assert.equal(duplicate.image.src, "blob:attachment-1");
    assert.equal(second.image.src, "blob:attachment-2");
    cleanup();
    assert.deepEqual(revoked.sort(), ["blob:attachment-1", "blob:attachment-2"]);
    assert.equal(first.image.src, editorAttachmentImageSource("attachment-1"));
    assert.equal(duplicate.image.src, editorAttachmentImageSource("attachment-1"));
    assert.equal(second.image.src, editorAttachmentImageSource("attachment-2"));
  } finally {
    Object.assign(globalThis, { HTMLSpanElement: originalSpan, IntersectionObserver: originalObserver });
    URL.revokeObjectURL = originalRevoke;
  }
});

test("refresh replaces the hydration generation while the original cleanup retains root ownership", async () => {
  const originalSpan = globalThis.HTMLSpanElement;
  const originalObserver = globalThis.IntersectionObserver;
  const originalRevoke = URL.revokeObjectURL;
  Object.assign(globalThis, { HTMLSpanElement: FakeSpan, IntersectionObserver: undefined });
  const revoked: string[] = [];
  URL.revokeObjectURL = (value) => { revoked.push(value); };
  try {
    const originalFrame = new FakeSpan("attachment-refresh");
    const root = new FakeRoot([originalFrame]);
    let loadCount = 0;
    const cleanup = hydrateEditorAttachmentImageFrames(root as unknown as HTMLElement, async (attachmentID, variant) => {
      loadCount += 1;
      assert.equal(variant, "display");
      return "blob:" + attachmentID + ":" + loadCount;
    });
    await flushPromises();
    assert.equal(originalFrame.image.src, "blob:attachment-refresh:1");

    const restoredFrame = new FakeSpan("attachment-refresh");
    root.frames.splice(0, root.frames.length, restoredFrame);
    assert.equal(refreshEditorAttachmentImageFrames(root as unknown as HTMLElement), true);
    await flushPromises();

    assert.equal(loadCount, 2);
    assert.deepEqual(revoked, ["blob:attachment-refresh:1"]);
    assert.equal(restoredFrame.image.src, "blob:attachment-refresh:2");

    cleanup();
    assert.deepEqual(revoked, ["blob:attachment-refresh:1", "blob:attachment-refresh:2"]);
    assert.equal(restoredFrame.image.src, editorAttachmentImageSource("attachment-refresh"));
    assert.equal(refreshEditorAttachmentImageFrames(root as unknown as HTMLElement), false);
  } finally {
    Object.assign(globalThis, { HTMLSpanElement: originalSpan, IntersectionObserver: originalObserver });
    URL.revokeObjectURL = originalRevoke;
  }
});

test("hydration waits for the near-viewport observer and uses the configured margin", async () => {
  const originalSpan = globalThis.HTMLSpanElement;
  const originalObserver = globalThis.IntersectionObserver;
  let callback: IntersectionObserverCallback | null = null;
  let observed: FakeSpan | null = null;
  let rootMargin = "";
  let observerRoot: Element | Document | null = null;
  class FakeIntersectionObserver {
    constructor(nextCallback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      callback = nextCallback;
      rootMargin = options?.rootMargin ?? "";
      observerRoot = options?.root ?? null;
    }
    observe(target: Element) { observed = target as unknown as FakeSpan; }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds = [];
  }
  Object.assign(globalThis, { HTMLSpanElement: FakeSpan, IntersectionObserver: FakeIntersectionObserver });
  try {
    const frame = new FakeSpan("attachment-near");
    const root = new FakeRoot([frame]);
    let calls = 0;
    const cleanup = hydrateEditorAttachmentImageFrames(root as unknown as HTMLElement, async () => {
      calls += 1;
      return "blob:attachment-near";
    });
    assert.equal(calls, 0);
    assert.equal(rootMargin, "800px 0px");
    assert.equal(observerRoot, root as unknown as Element);
    const observerCallback = callback as unknown as IntersectionObserverCallback;
    observerCallback([{ target: observed, isIntersecting: true, intersectionRatio: 1 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    await flushPromises();
    assert.equal(calls, 1);
    cleanup();
  } finally {
    Object.assign(globalThis, { HTMLSpanElement: originalSpan, IntersectionObserver: originalObserver });
  }
});

test("eager hydration loads compact signature previews without waiting for an observer callback", async () => {
  const originalSpan = globalThis.HTMLSpanElement;
  const originalObserver = globalThis.IntersectionObserver;
  let observerCreations = 0;
  class FakeIntersectionObserver {
    constructor() { observerCreations += 1; }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds = [];
  }
  Object.assign(globalThis, { HTMLSpanElement: FakeSpan, IntersectionObserver: FakeIntersectionObserver });
  try {
    const frame = new FakeSpan("signature-logo");
    const root = new FakeRoot([frame]);
    let calls = 0;
    const cleanup = hydrateEditorAttachmentImageFrames(root as unknown as HTMLElement, async () => {
      calls += 1;
      return "blob:signature-logo";
    }, { eager: true });
    await flushPromises();
    assert.equal(observerCreations, 0);
    assert.equal(calls, 1);
    assert.equal(frame.image.src, "blob:signature-logo");
    cleanup();
  } finally {
    Object.assign(globalThis, { HTMLSpanElement: originalSpan, IntersectionObserver: originalObserver });
  }
});

test("hydration retries a visible attachment after a bounded backoff", async () => {
  const originalSpan = globalThis.HTMLSpanElement;
  const originalObserver = globalThis.IntersectionObserver;
  Object.assign(globalThis, { HTMLSpanElement: FakeSpan, IntersectionObserver: undefined });
  try {
    const frame = new FakeSpan("attachment-retry");
    let calls = 0;
    const cleanup = hydrateEditorAttachmentImageFrames(new FakeRoot([frame]) as unknown as HTMLElement, async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary_failure");
      return "blob:attachment-retry";
    });
    await new Promise((resolve) => setTimeout(resolve, 130));
    await flushPromises();
    assert.equal(calls, 2);
    assert.equal(frame.image.src, "blob:attachment-retry");
    cleanup();
  } finally {
    Object.assign(globalThis, { HTMLSpanElement: originalSpan, IntersectionObserver: originalObserver });
  }
});

test("the shared hydration queue bounds attachment loads to four", async () => {
  const originalSpan = globalThis.HTMLSpanElement;
  const originalObserver = globalThis.IntersectionObserver;
  Object.assign(globalThis, { HTMLSpanElement: FakeSpan, IntersectionObserver: undefined });
  try {
    const frames = Array.from({ length: 5 }, (_, index) => new FakeSpan(`attachment-${index}`));
    const releases: Array<() => void> = [];
    let calls = 0;
    const cleanup = hydrateEditorAttachmentImageFrames(new FakeRoot(frames) as unknown as HTMLElement, async (attachmentID) => {
      calls += 1;
      await new Promise<void>((resolve) => releases.push(resolve));
      return `blob:${attachmentID}`;
    });
    await flushPromises();
    assert.equal(calls, 4);
    releases.shift()?.();
    await flushPromises();
    assert.equal(calls, 5);
    releases.forEach((release) => release());
    await flushPromises();
    cleanup();
  } finally {
    Object.assign(globalThis, { HTMLSpanElement: originalSpan, IntersectionObserver: originalObserver });
  }
});
