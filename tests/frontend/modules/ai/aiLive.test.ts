import test from "node:test";
import assert from "node:assert/strict";
import { AILiveConnection, liveDelegationContext, liveSpokenResult } from "../../../../frontend/src/modules/ai/aiLive.js";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fakeBrowser(media?: () => Promise<unknown>) {
  let stopped = 0;
  let peerClosed = false;
  const track = { enabled: true, stop() { stopped += 1; } };
  const stream = { getTracks: () => [track] };
  const sent: Record<string, unknown>[] = [];
  const channel = {
    readyState: "open", onmessage: null as ((event: { data: string }) => void) | null, onclose: null as (() => void) | null,
    send(data: string) {
      const event = JSON.parse(data);
      sent.push(event);
      if (event.type === "session.close") queueMicrotask(() => channel.onmessage?.({ data: JSON.stringify({ type: "session.closed", usage: { seconds: 3 } }) }));
    },
    close() { channel.readyState = "closed"; channel.onclose?.(); },
  };
  class Peer {
    iceGatheringState = "complete";
    localDescription = { type: "offer", sdp: "gathered-offer" };
    ontrack = null;
    onconnectionstatechange = null;
    addTrack() {}
    createDataChannel(label: string) { assert.equal(label, "oai-events"); return channel; }
    createOffer() { return Promise.resolve({ type: "offer", sdp: "offer" }); }
    setLocalDescription() { return Promise.resolve(); }
    setRemoteDescription(answer: { sdp: string }) { assert.equal(answer.sdp, "answer"); return Promise.resolve(); }
    close() { peerClosed = true; }
  }
  class AudioElement {
    autoplay = false;
    srcObject = null;
    play() { return Promise.resolve(); }
    pause() {}
  }
  const replacements: Record<string, unknown> = {
    navigator: { mediaDevices: { getUserMedia: media ?? (() => Promise.resolve(stream)) } },
    RTCPeerConnection: Peer, Audio: AudioElement,
  };
  const originals = new Map(Object.keys(replacements).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.entries(replacements).forEach(([name, value]) => Object.defineProperty(globalThis, name, { configurable: true, value }));
  return {
    stream, sent, track, stopped: () => stopped, peerClosed: () => peerClosed,
    emit: (event: unknown) => channel.onmessage?.({ data: JSON.stringify(event) }),
    restore: () => originals.forEach((descriptor, name) => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }),
  };
}

test("voice delegation retains exact fragments at its timestamp and excludes later corrections", () => {
  assert.equal(liveDelegationContext([
    { role: "user", delta: "Read ", start_ms: 0, end_ms: 100 },
    { role: "user", delta: "my emails.", start_ms: 100, end_ms: 800 },
    { role: "ai", delta: "I will check.", start_ms: 700, end_ms: 950 },
    { role: "user", delta: "Actually stop.", start_ms: 1000, end_ms: 1200 },
  ], 900), "user [0-100ms]: Read \nuser [100-800ms]: my emails.\nai [700-950ms]: I will check.");
});

test("spoken results fit the Live token bound even for multibyte text", () => {
  const result = liveSpokenResult("🌻你好".repeat(200));
  assert.ok(new TextEncoder().encode(result).length < 500);
  assert.ok(result.endsWith("See the full result in Mango AI."));
  assert.ok(!result.includes("�"));
});

test("WebRTC startup, serialized delegation, duplicate delivery and graceful microphone cleanup", async () => {
  const browser = fakeBrowser();
  const requests: string[] = [];
  const errors: string[] = [];
  let finish!: (result: string) => void;
  const first = new Promise<string>((resolve) => { finish = resolve; });
  const voice = new AILiveConnection({
    createSession: async (sdp) => { assert.equal(sdp, "gathered-offer"); return { session_id: "live_opaque", sdp: "answer" }; },
    onStatus: () => {}, onTranscript: () => {}, onError: (error) => errors.push(error),
    onDelegation: async (context) => { requests.push(context); return requests.length === 1 ? first : "Second result"; },
  });
  try {
    await voice.start();
    assert.deepEqual(browser.sent, []);
    browser.emit({ type: "session.started" });
    browser.emit({ type: "session.input_transcript.delta", delta: "Read emails.", start_ms: 0, end_ms: 100 });
    const delegation = { type: "session.delegation.created", offset_ms: 150, delegation: { id: "item_one", target: "client" } };
    browser.emit(delegation);
    browser.emit(delegation);
    browser.emit({ type: "session.input_transcript.delta", delta: "Then explain steps.", start_ms: 200, end_ms: 300 });
    browser.emit({ type: "session.delegation.created", offset_ms: 350, delegation: { id: "item_two", target: "client" } });
    await tick();
    assert.equal(requests.length, 1);
    assert.ok(!requests[0].includes("Then explain"));
    finish("First result");
    await tick();
    assert.equal(requests.length, 2);
    assert.deepEqual(browser.sent.map((event) => event.delegation_id), ["item_one", "item_two"]);
    await voice.close();
    assert.equal(browser.sent.at(-1)?.type, "session.close");
    assert.ok(browser.stopped() > 0);
    assert.ok(browser.peerClosed());
    assert.deepEqual(errors, []);
  } finally { await voice.close(); browser.restore(); }
});

test("session creation failure releases the microphone", async () => {
  const browser = fakeBrowser();
  const errors: string[] = [];
  const voice = new AILiveConnection({ createSession: async () => { throw new Error("OpenAI access unavailable"); }, onStatus: () => {}, onTranscript: () => {}, onDelegation: async () => "", onError: (message) => errors.push(message) });
  try {
    await voice.start();
    assert.deepEqual(errors, ["OpenAI access unavailable"]);
    assert.ok(browser.stopped() > 0);
    assert.ok(browser.peerClosed());
  } finally { browser.restore(); }
});

test("closing during a microphone permission request releases capture when permission resolves", async () => {
  let resolve!: (stream: unknown) => void;
  const browser = fakeBrowser(() => new Promise((done) => { resolve = done; }));
  let created = false;
  const voice = new AILiveConnection({ createSession: async () => { created = true; return { session_id: "x", sdp: "answer" }; }, onStatus: () => {}, onTranscript: () => {}, onDelegation: async () => "", onError: () => {} });
  try {
    const startup = voice.start();
    await voice.close();
    resolve(browser.stream);
    await startup;
    assert.equal(created, false);
    assert.ok(browser.stopped() > 0);
  } finally { browser.restore(); }
});

test("closing voice suppresses an in-flight result and queued delegation", async () => {
  const browser = fakeBrowser();
  let finish!: (result: string) => void;
  let calls = 0;
  const voice = new AILiveConnection({ createSession: async () => ({ session_id: "x", sdp: "answer" }), onStatus: () => {}, onTranscript: () => {}, onError: () => {}, onDelegation: async () => { calls += 1; return new Promise((done) => { finish = done; }); } });
  try {
    await voice.start();
    browser.emit({ type: "session.started" });
    browser.emit({ type: "session.input_transcript.delta", delta: "Read emails", start_ms: 0, end_ms: 100 });
    browser.emit({ type: "session.delegation.created", offset_ms: 100, delegation: { id: "one", target: "client" } });
    browser.emit({ type: "session.delegation.created", offset_ms: 110, delegation: { id: "two", target: "client" } });
    await tick();
    await voice.close();
    finish("Outdated result");
    await tick();
    assert.equal(calls, 1);
    assert.ok(browser.sent.every((event) => event.type !== "session.commentary.append"));
  } finally { await voice.close(); browser.restore(); }
});
