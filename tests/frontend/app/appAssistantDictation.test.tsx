import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";
import type { Editor } from "@tiptap/core";
import { AllSelection } from "@tiptap/pm/state";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function harness() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  const replace = (target: object, name: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, { configurable: true, writable: true, value });
    restores.push(() => { if (descriptor) Object.defineProperty(target, name, descriptor); else delete (target as Record<string, unknown>)[name]; });
  };
  for (const [name, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage,
    MutationObserver: dom.window.MutationObserver, DOMParser: dom.window.DOMParser, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) replace(globalThis, name, value);
  Object.assign(dom.window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {}, getClientRects: () => [{ width: 100, height: 30 }] });
  Object.assign(dom.window.Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) });
  const permissions: Array<ReturnType<typeof deferred<MediaStream>>> = [];
  replace(dom.window.navigator, "mediaDevices", { getUserMedia: (constraints: MediaStreamConstraints) => {
    assert.equal(constraints.audio, true);
    const permission = deferred<MediaStream>(); permissions.push(permission); return permission.promise;
  } });
  class Recorder {
    static isTypeSupported = (mime: string) => mime === "audio/webm;codecs=opus";
    state = "inactive";
    mimeType: string;
    stopCalls = 0;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly stream: MediaStream, options?: MediaRecorderOptions) { this.mimeType = options?.mimeType ?? "audio/webm"; recorders.push(this); }
    start() { this.state = "recording"; }
    stop() { this.stopCalls++; this.state = "inactive"; }
    chunk(data: string | Uint8Array) { this.ondataavailable?.({ data: new Blob([data as BlobPart], { type: this.mimeType }) }); }
    finish() { this.onstop?.(); }
  }
  const recorders: Recorder[] = [];
  replace(globalThis, "MediaRecorder", Recorder);
  replace(dom.window, "MediaRecorder", Recorder);
  const requests: Array<{ url: string; init: RequestInit; response: ReturnType<typeof deferred<Response>> }> = [];
  const chats: Array<{ process_id?: string; messages: Array<{ content: string }> }> = [];
  replace(globalThis, "fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.includes("/status?")) return Response.json({ available: true });
    if (url.includes("/transcriptions?")) {
      const response = deferred<Response>(); requests.push({ url, init, response }); return response.promise;
    }
    assert.match(url, /\/assistant\/chat\?/);
    chats.push(JSON.parse(String(init.body)));
    return new Response('data: {"type":"text","text":"Done"}\n\ndata: {"type":"done"}\n\n', { headers: { "Content-Type": "text/event-stream" } });
  });
  const [{ createRoot }, { AppAssistant }, { setActiveCompanyID }, { resetTerminalAuthFailure, markTerminalAuthFailure }] = await Promise.all([
    import("react-dom/client"), import("../../../frontend/src/app/AppAssistant.tsx"), import("../../../frontend/src/auth/currentCompany.ts"), import("../../../frontend/src/auth/cognitoAuth.ts"),
  ]);
  resetTerminalAuthFailure();
  setActiveCompanyID("company-a");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let mounted = true;
  const render = (userID = "user-a") => root.render(<AppAssistant apiBase="http://localhost:8080" userID={userID} bottomInset={10} />);
  const input = () => container.querySelector<HTMLElement & { editor: Editor }>('[role="textbox"][aria-label="Message Mango"]')!;
  const button = (label: string) => {
    const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      ?? Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label);
    assert.ok(found, `missing button: ${label}`); return found;
  };
  const click = async (label: string) => { await act(async () => { button(label).click(); }); };
  const setText = async (text: string) => { await act(async () => { input().editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] }); }); };
  const grant = async () => {
    const track = { stopped: false, readyState: "live", onended: null as (() => void) | null, stop() { this.stopped = true; this.readyState = "ended"; } };
    await act(async () => { permissions.at(-1)!.resolve({ getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream); });
    return track;
  };
  const record = async () => { await click("Start dictation"); return grant(); };
  const complete = async (data = "audio") => {
    await click("Stop recording");
    await act(async () => { recorders.at(-1)!.chunk(data); recorders.at(-1)!.finish(); });
  };
  const respond = async (text: string, status = 200) => { await act(async () => { requests.at(-1)!.response.resolve(Response.json(status === 200 ? { text } : { error: text }, { status })); }); };
  const unmount = async () => { if (mounted) { await act(async () => { root.unmount(); }); mounted = false; } };
  await act(async () => { render(); });
  await click("Expand Mango chat");
  return {
    dom, container, replace, input, button, click, setText, grant, record, complete, respond, unmount, permissions, recorders, requests, chats,
    company: async () => { await act(async () => { setActiveCompanyID("company-b"); }); },
    account: async () => { await act(async () => { render("user-b"); }); },
    logout: async () => { await act(async () => { markTerminalAuthFailure("logout"); }); },
    dispose: async () => { await unmount(); resetTerminalAuthFailure(); restores.reverse().forEach((restore) => restore()); dom.window.close(); },
  };
}

test("dictation waits for final audio, locks every Send path, preserves selected text and Process, and supports Undo", async () => {
  const h = await harness();
  try {
    const processID = "11111111-1111-4111-8111-111111111111";
    await act(async () => {
      h.input().editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: "Before " }, { type: "mangoEntityLink", attrs: { entityType: "logic_gate", entityId: processID, label: "Review" } }, { type: "text", text: " after" },
      ] }] });
      h.input().editor.commands.setTextSelection({ from: 2, to: 9 });
    });
    const original = h.input().editor.getJSON();
    const expected = h.input().editor.state.tr.insertText("<b>spoken</b>", 9, 9).doc.toJSON();
    assert.equal(h.button("Start dictation").type, "button");
    const assertBlocked = async () => {
      assert.equal(h.button("Send").disabled, true);
      assert.equal(h.input().editor.isEditable, false);
      await act(async () => {
        Simulate.submit(h.container.querySelector("form")!);
        h.input().dispatchEvent(new h.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
      assert.equal(h.chats.length, 0);
      assert.deepEqual(h.input().editor.getJSON(), original);
    };
    await h.click("Start dictation");
    await assertBlocked();
    const track = await h.grant();
    await assertBlocked();
    await act(async () => { h.recorders[0].chunk("first-"); });
    await h.click("Stop recording");
    assert.equal(track.stopped, true, "Stop releases the microphone before the recorder's final event");
    assert.equal(h.recorders[0].stopCalls, 1);
    assert.equal(h.requests.length, 0, "partial audio must not upload before onstop");
    await assertBlocked();
    await act(async () => { h.recorders[0].chunk("final"); });
    assert.equal(h.requests.length, 0);
    await act(async () => { h.recorders[0].finish(); });
    assert.equal(h.requests.length, 1);
    assert.match(h.requests[0].url, /\/v1\/assistant\/transcriptions\?company_id=company-a$/);
    assert.equal(h.requests[0].init.method, "POST");
    const audio = (h.requests[0].init.body as FormData).get("audio") as Blob;
    assert.equal(await audio.text(), "first-final");
    assert.equal(audio.type, "audio/webm;codecs=opus");
    assert.equal(new Headers(h.requests[0].init.headers).has("Content-Type"), false, "fetch must set the multipart boundary");
    await assertBlocked();
    assert.equal(h.button("Transcribing speech").disabled, true);
    await h.respond("<b>spoken</b>");
    assert.deepEqual(h.input().editor.getJSON(), expected, "selected text and exact Process identity survive plain text insertion");
    assert.equal(h.input().querySelector("b"), null, "transcription is not parsed as HTML");
    assert.equal(h.chats.length, 0, "dictation never sends a chat message");
    assert.equal(h.input().editor.isEditable, true);
    await act(async () => { assert.equal(h.input().editor.commands.undo(), true); });
    assert.deepEqual(h.input().editor.getJSON(), original, "one Undo removes only the transcript");
    await act(async () => { h.input().editor.commands.redo(); });
    await h.click("Send");
    assert.equal(h.chats.length, 1);
    assert.equal(h.chats[0].process_id, processID);
    assert.match(h.chats[0].messages.at(-1)!.content, /<b>spoken<\/b>/);
  } finally { await h.dispose(); }
});

test("permission, capture, provider and length failures preserve the draft and release resources", async () => {
  const h = await harness();
  try {
    await h.setText("Keep this draft");
    await h.click("Start dictation");
    await act(async () => { h.permissions.at(-1)!.reject(new DOMException("Denied", "NotAllowedError")); });
    assert.match(h.container.textContent!, /microphone.*(allow|permission)|allow.*microphone/i);
    assert.equal(h.input().editor.getText(), "Keep this draft");
    assert.equal(h.input().editor.isEditable, true);
    let track = await h.record();
    await h.complete("");
    assert.equal(track.stopped, true);
    assert.equal(h.requests.length, 0, "empty audio does not upload");
    assert.match(h.container.textContent!, /no audio|empty|record.*again/i);
    track = await h.record();
    await h.complete();
    await h.respond("");
    assert.equal(track.stopped, true);
    assert.match(h.container.textContent!, /no speech|could.*hear|empty/i);
    assert.equal(h.input().editor.getText(), "Keep this draft");
    track = await h.record();
    await h.complete();
    await h.respond("Speech service is unavailable. Try again.", 502);
    assert.equal(track.stopped, true);
    assert.match(h.container.textContent!, /unavailable|transcrib|try again/i);
    assert.equal(h.input().editor.getText(), "Keep this draft");
    track = await h.record();
    await h.complete();
    await act(async () => { h.requests.at(-1)!.response.reject(new TypeError("Failed to fetch")); });
    assert.equal(track.stopped, true);
    assert.equal(h.input().editor.getText(), "Keep this draft");
    assert.equal(h.input().editor.isEditable, true);
    await h.setText("a".repeat(7_998));
    await h.record(); await h.complete(); await h.respond("five!");
    assert.equal(h.input().editor.getText(), "a".repeat(7_998), "overlong transcription must not truncate or modify the draft");
    assert.match(h.container.textContent!, /8,000/);
    assert.equal(h.chats.length, 0);
  } finally { await h.dispose(); }
});

test("canceling a pending microphone permission safely discards a later grant", async () => {
  const h = await harness();
  try {
    await h.setText("Keep this draft");
    await h.click("Start dictation");
    await h.click("Cancel microphone request");
    const track = await h.grant();
    assert.equal(track.stopped, true);
    assert.equal(h.recorders.length, 0);
    assert.equal(h.requests.length, 0);
    assert.equal(h.input().editor.getText(), "Keep this draft");
    assert.equal(h.input().editor.isEditable, true);
  } finally { await h.dispose(); }
});

test("dictation counts the paragraph break inserted after Select All toward the 8,000-character limit", async () => {
  const h = await harness();
  try {
    await h.setText("a".repeat(7_999));
    await act(async () => { h.input().editor.view.dispatch(h.input().editor.state.tr.setSelection(new AllSelection(h.input().editor.state.doc))); });
    assert.equal(h.input().editor.state.selection.to, h.input().editor.state.doc.content.size);
    const original = h.input().editor.getJSON();
    await h.record(); await h.complete(); await h.respond("b");
    assert.deepEqual(h.input().editor.getJSON(), original, "an extra paragraph must not push the resulting draft over the limit");
    assert.match(h.container.textContent!, /8,000/);
    assert.equal(h.input().editor.isEditable, true);
    await h.setText("a".repeat(7_998));
    await act(async () => { h.input().editor.view.dispatch(h.input().editor.state.tr.setSelection(new AllSelection(h.input().editor.state.doc))); });
    await h.record(); await h.complete(); await h.respond("b");
    assert.equal(h.input().editor.getText({ blockSeparator: "\n" }), `${"a".repeat(7_998)}\nb`, "a complete 8,000-character draft still accepts the transcript");
    assert.equal(h.button("Send").disabled, false);
    assert.equal(h.chats.length, 0);
  } finally { await h.dispose(); }
});

test("unsupported recording, a missing device, and capture errors leave the draft usable", async () => {
  const h = await harness();
  try {
    await h.setText("Keep this draft");
    const recorder = globalThis.MediaRecorder;
    h.replace(globalThis, "MediaRecorder", undefined);
    await h.click("Start dictation");
    assert.match(h.container.textContent!, /unavailable|supported browser/i);
    assert.equal(h.permissions.length, 0);
    h.replace(globalThis, "MediaRecorder", recorder);
    await h.click("Start dictation");
    await act(async () => { h.permissions.at(-1)!.reject(new DOMException("No device", "NotFoundError")); });
    assert.match(h.container.textContent!, /microphone.*(connected|available)|could not start/i);
    const track = await h.record();
    await act(async () => { h.recorders.at(-1)!.onerror?.(); });
    assert.equal(track.stopped, true);
    assert.match(h.container.textContent!, /recording failed/i);
    assert.equal(h.input().editor.getText(), "Keep this draft");
    assert.equal(h.input().editor.isEditable, true);
    assert.equal(h.requests.length, 0);
  } finally { await h.dispose(); }
});

for (const action of ["collapse", "clear", "company", "account", "logout", "unmount"] as const) {
  test(`${action} cancels transcription and rejects its stale response`, async () => {
    const h = await harness();
    try {
      await h.setText("Keep this draft");
      const track = await h.record(); await h.complete();
      if (action === "collapse") await h.click("Collapse Mango chat");
      else if (action === "clear") await h.click("Clear chat");
      else await h[action]();
      assert.equal(track.stopped, true);
      assert.equal(h.requests[0].init.signal!.aborted, true);
      await h.respond("This stale text must never appear");
      assert.doesNotMatch(h.container.textContent!, /This stale text/);
      if (action === "collapse") {
        await h.click("Expand Mango chat");
        assert.equal(h.input().editor.getText(), "Keep this draft");
        assert.equal(h.input().editor.isEditable, true);
      } else if (action !== "unmount") assert.equal(h.input().editor.getText(), "");
      assert.equal(h.chats.length, 0);
    } finally { await h.dispose(); }
  });
}

test("collapse stops active capture and safely releases permission granted after cancellation", async () => {
  const h = await harness();
  try {
    await h.setText("Keep this draft");
    const track = await h.record();
    await h.click("Collapse Mango chat");
    assert.equal(track.stopped, true);
    assert.equal(h.recorders[0].stopCalls, 1);
    await act(async () => { h.recorders[0].chunk("late final chunk"); h.recorders[0].finish(); });
    assert.equal(h.requests.length, 0);
    await h.click("Expand Mango chat");
    await h.click("Start dictation");
    await h.click("Collapse Mango chat");
    assert.equal((await h.grant()).stopped, true);
    assert.equal(h.recorders.length, 1);
    assert.equal(h.input().editor.getText(), "Keep this draft");
  } finally { await h.dispose(); }
});

for (const action of ["company", "account", "unmount"] as const) {
  test(`${action} releases active capture and cancels recorder callbacks`, async () => {
    const h = await harness();
    try {
      await h.setText("Keep this draft");
      const track = await h.record();
      await h[action]();
      assert.equal(track.stopped, true);
      assert.equal(h.recorders[0].stopCalls, 1);
      await act(async () => { h.recorders[0].chunk("late audio"); h.recorders[0].finish(); });
      assert.equal(h.requests.length, 0);
      assert.doesNotMatch(h.container.textContent!, /Keep this draft/);
    } finally { await h.dispose(); }
  });
}

test("unmount safely releases microphone permission granted after teardown", async () => {
  const h = await harness();
  try {
    await h.click("Start dictation");
    await h.unmount();
    assert.equal((await h.grant()).stopped, true);
    assert.equal(h.recorders.length, 0);
    assert.equal(h.requests.length, 0);
  } finally { await h.dispose(); }
});

test("dictation retains the existing realtime disconnection request guard", async () => {
  const h = await harness();
  const { realtimeHealthKey, setRealtimeHealthClientActive, updateRealtimeHealth } = await import("../../../frontend/src/modules/realtime/realtimeHealth.ts");
  const key = realtimeHealthKey("http://localhost:8080", "company-a");
  try {
    await h.setText("Keep this draft");
    setRealtimeHealthClientActive(key, true);
    updateRealtimeHealth(key, { status: "disconnected" });
    const track = await h.record(); await h.complete();
    assert.equal(track.stopped, true);
    assert.equal(h.requests.length, 0, "dictation cannot bypass the standard disconnected POST guard");
    assert.equal(h.input().editor.getText(), "Keep this draft");
    assert.equal(h.input().editor.isEditable, true);
    assert.match(h.container.textContent!, /connect|realtime/i);
  } finally { setRealtimeHealthClientActive(key, false); await h.dispose(); }
});

test("capture automatically stops after two minutes and rejects audio over eight MiB", async () => {
  const h = await harness();
  try {
    const originalTimeout = globalThis.setTimeout;
    let durationElapsed!: () => void;
    h.replace(globalThis, "setTimeout", (callback: () => void, delay?: number, ...args: unknown[]) => {
      if (delay === 120_000) { durationElapsed = callback; return originalTimeout(() => undefined, 0); }
      return originalTimeout(callback, delay, ...args);
    });
    await h.setText("Keep this draft");
    let track = await h.record();
    assert.equal(typeof durationElapsed, "function", "every recording has a two-minute bound");
    await act(async () => { durationElapsed(); });
    assert.equal(track.stopped, true);
    assert.equal(h.recorders[0].stopCalls, 1);
    await act(async () => { h.recorders[0].chunk("completed bounded audio"); h.recorders[0].finish(); });
    await h.respond("Text");
    await h.setText("Keep this draft");
    track = await h.record();
    await act(async () => { h.recorders.at(-1)!.chunk(new Uint8Array(8 * 1024 * 1024 + 1)); });
    assert.equal(track.stopped, true);
    await act(async () => { h.recorders.at(-1)!.finish(); });
    assert.equal(h.requests.length, 1, "oversize audio must not upload");
    assert.equal(h.input().editor.getText(), "Keep this draft");
    assert.equal(h.input().editor.isEditable, true);
    assert.match(h.container.textContent!, /8\s*(MiB|MB)|large|shorter/i);
  } finally { await h.dispose(); }
});

test("permission, recorder completion, and upload deadlines release the draft and ignore late work", async () => {
  const h = await harness();
  try {
    const originalTimeout = globalThis.setTimeout;
    const deadlines = new Map<number, () => void>();
    h.replace(globalThis, "setTimeout", (callback: () => void, delay?: number, ...args: unknown[]) => {
      if (delay === 30_000 || delay === 5_000 || delay === 40_000) {
        deadlines.set(delay, callback); return originalTimeout(() => undefined, 0);
      }
      return originalTimeout(callback, delay, ...args);
    });
    await h.setText("Keep this draft");
    await h.click("Start dictation");
    assert.ok(deadlines.has(30_000));
    await act(async () => { deadlines.get(30_000)!(); });
    assert.equal((await h.grant()).stopped, true);
    assert.match(h.container.textContent!, /permission timed out/i);
    let track = await h.record();
    await h.click("Stop recording");
    assert.equal(track.stopped, true);
    assert.ok(deadlines.has(5_000));
    await act(async () => { deadlines.get(5_000)!(); h.recorders.at(-1)!.chunk("too late"); h.recorders.at(-1)!.finish(); });
    assert.equal(h.requests.length, 0);
    assert.match(h.container.textContent!, /recording could not finish/i);
    track = await h.record(); await h.complete();
    assert.ok(deadlines.has(40_000));
    await act(async () => {
      deadlines.get(40_000)!();
      assert.equal(h.requests[0].init.signal!.aborted, true);
      h.requests[0].response.reject(h.requests[0].init.signal!.reason);
    });
    assert.equal(track.stopped, true);
    assert.match(h.container.textContent!, /timed out|too long/i);
    assert.equal(h.input().editor.getText(), "Keep this draft");
    assert.equal(h.input().editor.isEditable, true);
    assert.equal(h.chats.length, 0);
  } finally { await h.dispose(); }
});

test("the dictation watchdog unlocks a stalled request without waiting for its promise to settle", async () => {
  const h = await harness();
  try {
    const originalTimeout = globalThis.setTimeout;
    const deadlines: Array<() => void> = [];
    h.replace(globalThis, "setTimeout", (callback: () => void, delay?: number, ...args: unknown[]) => {
      if (delay === 40_000) { deadlines.push(callback); return originalTimeout(() => undefined, 0); }
      return originalTimeout(callback, delay, ...args);
    });
    await h.setText("Keep this draft");
    const track = await h.record(); await h.complete();
    assert.equal(deadlines.length, 2, "dictation starts its own watchdog before the request client's fetch timeout");
    assert.equal(h.input().editor.isEditable, false);
    await act(async () => { deadlines[0](); });
    assert.equal(track.stopped, true);
    assert.equal(h.requests[0].init.signal!.aborted, true);
    assert.equal(h.input().editor.isEditable, true, "the editor unlocks while the awaited request is still unresolved");
    assert.equal(h.button("Send").disabled, false);
    assert.match(h.container.textContent!, /transcription timed out/i);
    await h.respond("This late response must be discarded");
    assert.equal(h.input().editor.getText(), "Keep this draft");
    assert.doesNotMatch(h.container.textContent!, /This late response/);
    assert.equal(h.chats.length, 0);
  } finally { await h.dispose(); }
});
