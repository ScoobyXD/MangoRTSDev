import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";

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
    assert.deepEqual(constraints.audio, { echoCancellation: true, noiseSuppression: true });
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
  let clock = 0;
  let amplitude = 0;
  let activityTimerID = 1_000_000;
  const activityTimers = new Map<number, () => void>();
  const originalInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  replace(globalThis.performance, "now", () => clock);
  replace(globalThis, "setInterval", (callback: () => void, delay?: number) => {
    if (delay !== 100) return originalInterval(callback, delay);
    activityTimers.set(++activityTimerID, callback); return activityTimerID;
  });
  replace(globalThis, "clearInterval", (id: number) => {
    if (!activityTimers.delete(id)) originalClearInterval(id);
  });
  class AudioContextMock {
    state = "suspended";
    source = { connected: false, connect: () => { this.source.connected = true; }, disconnect: () => { this.source.connected = false; } };
    analyser = { fftSize: 2048, disconnected: false, getFloatTimeDomainData: (data: Float32Array) => { data.fill(amplitude); }, disconnect: () => { this.analyser.disconnected = true; } };
    constructor() { audioContexts.push(this); }
    createMediaStreamSource(stream: MediaStream) { assert.ok(stream.getAudioTracks().length); return this.source; }
    createAnalyser() { return this.analyser; }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  }
  const audioContexts: AudioContextMock[] = [];
  replace(globalThis, "AudioContext", AudioContextMock);
  const sample = async (level: number, elapsed = 100) => {
    await act(async () => { amplitude = level; clock += elapsed; for (const callback of activityTimers.values()) callback(); });
  };
  const requests: Array<{ url: string; init: RequestInit; response: ReturnType<typeof deferred<Response>> }> = [];
  replace(globalThis, "fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith("https://cognito-idp.")) {
      assert.equal(JSON.parse(String(init.body)).AuthFlow, "REFRESH_TOKEN_AUTH");
      return Response.json({ AuthenticationResult: { AccessToken: "refreshed-test-token", ExpiresIn: 3600 } });
    }
    assert.match(url, /\/v1\/transcriptions\?/);
    assert.match(new Headers(init.headers).get("Authorization") ?? "", /^Bearer /);
    const response = deferred<Response>(); requests.push({ url, init, response }); return response.promise;
  });
  const [{ createRoot }, { AppAssistant }, { setActiveCompanyID }, { resetTerminalAuthFailure, markTerminalAuthFailure }] = await Promise.all([
    import("react-dom/client"), import("../../../frontend/src/app/AppAssistant.tsx"), import("../../../frontend/src/auth/currentCompany.ts"), import("../../../frontend/src/auth/cognitoAuth.ts"),
  ]);
  resetTerminalAuthFailure();
  const tokenKey = "mangorts:cognito-token-v2";
  dom.window.localStorage.setItem(tokenKey, JSON.stringify({ access_token: "test-token", refresh_token: "test-refresh", expires_at: Date.now() + 3_600_000 }));
  setActiveCompanyID("company-a");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let mounted = true;
  const render = (userID = "user-a") => root.render(<AppAssistant apiBase="http://localhost:8080" userID={userID} bottomInset={10} />);
  const input = () => container.querySelector<HTMLTextAreaElement>('[aria-label="Message Mango"]')!;
  const button = (label: string) => {
    const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      ?? Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label);
    assert.ok(found, `missing button: ${label}`); return found;
  };
  const click = async (label: string) => { await act(async () => { button(label).click(); }); };
  const setText = async (text: string) => { await act(async () => { input().value = text; Simulate.change(input()); }); };
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
  const respond = async (text: string, status = 200) => { await act(async () => {
    requests.at(-1)!.response.resolve(status === 200
      ? new Response(`${JSON.stringify({ type: "result", text })}\n`, { headers: { "Content-Type": "application/x-ndjson" } })
      : Response.json({ error: text }, { status }));
  }); };
  const unmount = async () => { if (mounted) { await act(async () => { root.unmount(); }); mounted = false; } };
  await act(async () => { render(); });
  await click("Expand Mango chat");
  return {
    dom, container, replace, input, button, click, setText, grant, record, complete, respond, unmount, permissions, recorders, requests, sample, audioContexts, activityTimers,
    refresh: async () => {
      const { getApiAccessToken, getAuthSessionCacheGeneration } = await import("../../../frontend/src/auth/cognitoAuth.ts");
      const before = getAuthSessionCacheGeneration();
      dom.window.localStorage.setItem(tokenKey, JSON.stringify({ access_token: "test-token", refresh_token: "test-refresh", expires_at: Date.now() - 1_000 }));
      await act(async () => {
        assert.equal(await getApiAccessToken(), "refreshed-test-token");
        assert.ok(getAuthSessionCacheGeneration() > before);
        render();
      });
    },
    company: async () => { await act(async () => { setActiveCompanyID("company-b"); }); },
    account: async () => { await act(async () => { render("user-b"); }); },
    logout: async () => { await act(async () => { markTerminalAuthFailure("logout"); }); },
    dispose: async () => {
      await unmount(); resetTerminalAuthFailure();
      assert.equal(activityTimers.size, 0, "all activity polling is released");
      assert.ok(audioContexts.every((context) => context.state === "closed" && !context.source.connected && context.analyser.disconnected), "every audio context and analyser is released");
      restores.reverse().forEach((restore) => restore()); dom.window.close();
    },
  };
}

test("dictation waits for final audio, inserts literal text after the selection, and never enables Send", async () => {
  const h = await harness();
  try {
    await h.setText("Before after");
    h.input().setSelectionRange(0, 7);
    await h.click("Start dictation");
    assert.equal(h.input().readOnly, true);
    const track = await h.grant();
    await act(async () => { h.recorders[0].chunk("first-"); });
    await h.click("Stop recording");
    assert.equal(track.stopped, true, "stop releases the microphone before final recording events");
    assert.equal(h.requests.length, 0);
    await act(async () => { h.recorders[0].chunk("final"); h.recorders[0].finish(); });
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].url, "http://localhost:8080/v1/transcriptions?company_id=company-a");
    assert.equal(h.requests[0].init.method, "POST");
    const audio = h.requests[0].init.body as Blob;
    assert.equal(await audio.text(), "first-final");
    assert.equal(new Headers(h.requests[0].init.headers).get("Content-Type"), audio.type);
    assert.equal(h.button("Transcribing speech").disabled, true);
    assert.equal(h.button("Send").disabled, true);
    await h.respond("<b>spoken</b>");
    assert.equal(h.input().value, "Before <b>spoken</b>after");
    assert.equal(h.input().selectionStart, 20);
    assert.equal(h.input().readOnly, false);
    assert.equal(h.button("Send").disabled, true);
    await h.click("Send");
    await act(async () => { h.input().dispatchEvent(new h.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    assert.equal(h.requests.length, 1, "clicking Send or pressing Enter never sends a request");
    await h.setText("Still editable\nWith a new line");
    assert.equal(h.input().value, "Still editable\nWith a new line");
  } finally { await h.dispose(); }
});

test("permission, capture, no-speech and provider failures preserve the editable draft", async () => {
  const h = await harness();
  try {
    await h.setText("Keep this draft");
    await h.click("Start dictation");
    await act(async () => { h.permissions.at(-1)!.reject(new DOMException("Denied", "NotAllowedError")); });
    assert.match(h.container.textContent!, /microphone access was denied/i);
    let track = await h.record();
    await h.complete("");
    assert.equal(track.stopped, true);
    assert.equal(h.requests.length, 0);
    assert.match(h.container.textContent!, /no audio/i);
    track = await h.record();
    await h.complete();
    await h.respond("");
    assert.equal(track.stopped, true);
    assert.match(h.container.textContent!, /no speech/i);
    await h.record(); await h.complete(); await h.respond("Private provider details", 502);
    assert.match(h.container.textContent!, /could not be transcribed/i);
    assert.doesNotMatch(h.container.textContent!, /Private provider details/);
    assert.equal(h.input().value, "Keep this draft");
    assert.equal(h.input().readOnly, false);
    assert.equal(h.button("Send").disabled, true);
  } finally { await h.dispose(); }
});

test("voice waves follow microphone audio and continuous speech has no duration limit", async () => {
  const h = await harness();
  try {
    const track = await h.record();
    const waves = () => h.container.querySelector<HTMLElement>(".mango-assistant-sound-waves")!;
    assert.equal(h.button("Stop recording").getAttribute("aria-pressed"), "true");
    assert.equal(waves().dataset.active, "false");
    await h.sample(0.03, 150_000);
    assert.equal(waves().dataset.active, "true");
    assert.ok(Number(waves().style.getPropertyValue("--voice-level")) > 0);
    assert.equal(track.stopped, false);
    await h.sample(0, 59_999);
    assert.equal(waves().dataset.active, "false");
    assert.equal(track.stopped, false);
    await h.sample(0, 1);
    assert.equal(track.stopped, true);
    assert.equal(h.activityTimers.size, 0);
    assert.match(h.container.textContent!, /one minute of silence/i);
    await act(async () => { h.recorders[0].chunk("final"); h.recorders[0].finish(); });
    await h.respond("Spoken text");
    assert.equal(h.input().value, "Spoken text");
  } finally { await h.dispose(); }
});

test("canceling permission or closing chat releases late grants and keeps the draft", async () => {
  const h = await harness();
  try {
    await h.setText("Keep this draft");
    await h.click("Start dictation");
    await h.click("Cancel microphone request");
    assert.equal((await h.grant()).stopped, true);
    const track = await h.record();
    await h.click("Collapse Mango chat");
    assert.equal(track.stopped, true);
    await act(async () => { h.recorders[0].chunk("late"); h.recorders[0].finish(); });
    assert.equal(h.requests.length, 0);
    await h.click("Expand Mango chat");
    assert.equal(h.input().value, "Keep this draft");
    assert.equal(h.input().readOnly, false);
  } finally { await h.dispose(); }
});

test("routine token refresh preserves the draft and recording while terminal auth failure cancels them", async () => {
  const h = await harness();
  try {
    await h.setText("Keep this draft");
    const track = await h.record();
    await h.refresh();
    assert.equal(h.input().value, "Keep this draft");
    assert.equal(track.stopped, false);
    assert.equal(h.button("Stop recording").getAttribute("aria-pressed"), "true");
    await h.logout();
    assert.equal(track.stopped, true);
    assert.equal(h.input().value, "");
    assert.equal(h.input().readOnly, false);
  } finally { await h.dispose(); }
});

for (const action of ["collapse", "company", "account", "logout", "unmount"] as const) {
  test(`${action} cancels transcription and discards its late response`, async () => {
    const h = await harness();
    try {
      await h.setText("Keep this draft");
      const track = await h.record(); await h.complete();
      if (action === "collapse") await h.click("Collapse Mango chat"); else await h[action]();
      assert.equal(track.stopped, true);
      assert.equal(h.requests[0].init.signal!.aborted, true);
      await h.respond("Stale transcript");
      if (action !== "unmount") {
        assert.equal(h.input().value, action === "collapse" ? "Keep this draft" : "");
        assert.equal(h.input().readOnly, false);
        assert.equal(h.button("Send").disabled, true);
      }
    } finally { await h.dispose(); }
  });
}

test("permission and recorder completion deadlines release the draft and reject late work", async () => {
  const h = await harness();
  try {
    const originalTimeout = globalThis.setTimeout;
    const deadlines = new Map<number, () => void>();
    h.replace(globalThis, "setTimeout", (callback: () => void, delay?: number, ...args: unknown[]) => {
      if (delay === 30_000 || delay === 5_000) { deadlines.set(delay, callback); return originalTimeout(() => undefined, 0); }
      return originalTimeout(callback, delay, ...args);
    });
    await h.setText("Keep this draft");
    await h.click("Start dictation");
    await act(async () => { deadlines.get(30_000)!(); });
    assert.equal((await h.grant()).stopped, true);
    assert.match(h.container.textContent!, /permission timed out/i);
    const track = await h.record();
    await h.click("Stop recording");
    assert.equal(track.stopped, true);
    await act(async () => { deadlines.get(5_000)!(); h.recorders[0].chunk("late"); h.recorders[0].finish(); });
    assert.equal(h.requests.length, 0);
    assert.match(h.container.textContent!, /recording could not finish/i);
    assert.equal(h.input().value, "Keep this draft");
    assert.equal(h.input().readOnly, false);
  } finally { await h.dispose(); }
});

test("oversized audio never uploads and complete long transcripts remain editable", async () => {
  const h = await harness();
  try {
    await h.setText("Keep this draft");
    const track = await h.record();
    const tooLarge = new Blob(["audio"]);
    h.replace(tooLarge, "size", 2_000_000_001);
    await act(async () => { h.recorders[0].ondataavailable?.({ data: tooLarge }); });
    assert.equal(track.stopped, true);
    assert.equal(h.requests.length, 0);
    assert.equal(h.input().value, "Keep this draft");
    assert.match(h.container.textContent!, /2 GB maximum/i);
    h.input().setSelectionRange(0, h.input().value.length);
    const transcript = "Complete sentence. ".repeat(2_100).trim();
    await h.record(); await h.complete(); await h.respond(transcript);
    assert.equal(h.input().value, `Keep this draft${transcript}`);
    assert.equal(h.input().readOnly, false);
    assert.equal(h.button("Send").disabled, true);
  } finally { await h.dispose(); }
});

test("dictation uses the shared authenticated API while realtime is disconnected", async () => {
  const h = await harness();
  const { realtimeHealthKey, setRealtimeHealthClientActive, updateRealtimeHealth } = await import("../../../frontend/src/modules/realtime/realtimeHealth.ts");
  const key = realtimeHealthKey("http://localhost:8080", "company-a");
  try {
    setRealtimeHealthClientActive(key, true);
    updateRealtimeHealth(key, { status: "disconnected" });
    await h.record(); await h.complete(); await h.respond("Dictation still works");
    assert.equal(h.requests.length, 1);
    assert.equal(h.input().value, "Dictation still works");
    assert.equal(h.button("Send").disabled, true);
  } finally { setRealtimeHealthClientActive(key, false); await h.dispose(); }
});
