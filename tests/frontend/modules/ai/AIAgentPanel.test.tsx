import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import AIAgentPanel from "../../../../frontend/src/modules/ai/AIAgentPanel.js";

test("saved task history pages use reads, preserve messages, and company changes release voice capture", async () => {
  const browser = new Window({ url: "http://localhost:5173" });
  const replacements: Record<string, unknown> = {
    window: browser, document: browser.document, navigator: browser.navigator,
    HTMLElement: browser.HTMLElement, Node: browser.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  let stopped = 0;
  let calls = 0;
  const microphone = { getTracks: () => [{ enabled: true, stop: () => { stopped += 1; } }] };
  Object.defineProperty(browser.navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { calls += 1; return microphone; } } });
  class Peer {
    iceGatheringState = "complete";
    localDescription = { sdp: "offer" };
    addTrack() {}
    createDataChannel() { return { readyState: "connecting", close() {}, onmessage: null, onclose: null }; }
    createOffer() { return Promise.resolve({ type: "offer", sdp: "offer" }); }
    setLocalDescription() { return Promise.resolve(); }
    close() {}
  }
  class AudioElement { autoplay = true; srcObject = null; pause() {} }
  replacements.RTCPeerConnection = Peer;
  replacements.Audio = AudioElement;
  let pendingSignal: AbortSignal | null = null;
  const requests: string[] = [];
  const view = { id: "task-one", model: "gpt-6-astra", prompt: "Read my emails", instructions: "", skills: [], stopped: false, status: "completed", created_at: "2026-09-11", actions: [], read_counts: {} };
  replacements.fetch = async (input: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${input}`);
    if (input.includes("/v1/ai/live")) {
      pendingSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    }
    const url = new URL(input);
    let result: unknown = { sessions: [{ id: view.id, prompt: view.prompt, created_at: view.created_at, stopped: false }], models: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"], default_model: "gpt-5.6-luna" };
    if (url.pathname.endsWith("/task-one")) {
      const cursor = url.searchParams.get("items_after");
      result = cursor
        ? { ...view, items: [{ id: "ai-two", role: "ai", text: cursor === "ai-two" ? "Updated second page" : "Second page", status: "completed" }], items_cursor: "ai-two", items_has_more: false }
        : { ...view, items: [{ id: "ai-one", role: "ai", text: "First page", status: "completed" }], items_cursor: "ai-one", items_has_more: true };
    }
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const originals = new Map(Object.keys(replacements).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(replacements).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, value }));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let closed = false;
  try {
    await act(async () => {
      root.render(<AIAgentPanel companyID="company-one" onClose={() => { closed = true; }} />);
    });
    assert.equal(calls, 0, "opening the panel must not capture audio");
    const select = document.querySelector("select")!;
    await act(async () => { select.value = "task-one"; select.dispatchEvent(new browser.Event("change", { bubbles: true }) as unknown as Event); });
    assert.ok(document.body.textContent?.includes("First page"));
    assert.ok(document.body.textContent?.includes("Second page"));
    assert.ok(requests.some((url) => url.includes("items_after=ai-one")));
    assert.ok(requests.every((url) => url.startsWith("GET ")), "opening a saved task must not execute tools");
    const model = document.querySelector<HTMLSelectElement>('[aria-label="Task model"]')!;
    assert.equal(model.value, "gpt-6-astra", "show the saved task's actual model instead of the catalog default");
    assert.equal(model.disabled, true);
    const refresh = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Refresh task")!;
    await act(async () => refresh.click());
    assert.ok(requests.some((url) => url.includes("items_after=ai-two")));
    assert.deepEqual(Array.from(document.querySelectorAll(".mango-ai-message > div")).map((node) => node.textContent), ["First page", "Updated second page"]);
    view.model = "";
    await act(async () => refresh.click());
    assert.equal(model.value, "");
    assert.equal(model.textContent, "Model unavailable");
    assert.equal(Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Start voice")?.disabled, true);
    view.model = "gpt-6-astra";
    await act(async () => refresh.click());
    const start = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Start voice");
    assert.ok(start);
    await act(async () => { start!.click(); });
    assert.equal(calls, 1);
    assert.ok(pendingSignal);
    await act(async () => { browser.dispatchEvent(new browser.Event("mangorts:active-company-changed")); });
    assert.equal(closed, true);
    await act(async () => { root.unmount(); });
    assert.ok(stopped > 0);
    assert.equal((pendingSignal as unknown as AbortSignal).aborted, true);
  } finally {
    if (!closed) await act(async () => root.unmount());
    originals.forEach((descriptor, key) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
    await browser.happyDOM.close();
  }
});

test("new tasks use the server model default, send the selected model for text and voice, and reset after saved tasks", async () => {
  const browser = new Window({ url: "http://localhost:5173" });
  const models = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"];
  let resolveCatalog!: (response: Response) => void;
  const pendingCatalog = new Promise<Response>((resolve) => { resolveCatalog = resolve; });
  let resolveCreate!: (response: Response) => void;
  const created: Record<string, unknown>[] = [];
  const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  const view = (input: Record<string, unknown>, id: string) => ({ ...input, id, stopped: false, status: "completed", created_at: "2026-09-11", items: [], items_cursor: "", items_has_more: false, actions: [], read_counts: {} });
  let stopped = 0;
  const channel = {
    readyState: "open", onmessage: null as ((event: { data: string }) => void) | null, onclose: null as (() => void) | null,
    send(data: string) {
      if (JSON.parse(data).type === "session.close") queueMicrotask(() => channel.onmessage?.({ data: JSON.stringify({ type: "session.closed" }) }));
    },
    close() { channel.readyState = "closed"; channel.onclose?.(); },
  };
  class Peer {
    iceGatheringState = "complete";
    localDescription = { sdp: "offer" };
    addTrack() {}
    createDataChannel() { return channel; }
    createOffer() { return Promise.resolve({ type: "offer", sdp: "offer" }); }
    setLocalDescription() { return Promise.resolve(); }
    setRemoteDescription() { return Promise.resolve(); }
    close() {}
  }
  class AudioElement { autoplay = true; srcObject = null; pause() {} }
  Object.defineProperty(browser.navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped += 1; } }] }) } });
  const replacements: Record<string, unknown> = {
    window: browser, document: browser.document, navigator: browser.navigator,
    HTMLElement: browser.HTMLElement, Node: browser.Node, IS_REACT_ACT_ENVIRONMENT: true,
    RTCPeerConnection: Peer, Audio: AudioElement,
    fetch: async (input: string, init?: RequestInit) => {
      if (input.includes("/v1/ai/live")) return response({ session_id: "live-one", sdp: "answer" });
      if (init?.method !== "POST") return pendingCatalog;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      created.push(body);
      if (created.length === 1) return new Promise<Response>((resolve) => { resolveCreate = resolve; });
      return response(view(body, "voice-task"));
    },
  };
  const originals = new Map(Object.keys(replacements).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(replacements).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, value }));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const button = (label: string) => Array.from(document.querySelectorAll("button")).find((item) => item.textContent === label)!;
  const change = async (element: HTMLSelectElement | HTMLTextAreaElement, value: string) => {
    await act(async () => { element.value = value; Simulate.change(element); });
  };
  try {
    await act(async () => root.render(<AIAgentPanel companyID="company-one" onClose={() => {}} />));
    const model = document.querySelector<HTMLSelectElement>('[aria-label="Task model"]')!;
    const prompt = document.querySelector<HTMLTextAreaElement>('[aria-label="Your AI request"]')!;
    await change(prompt, "Review my emails");
    assert.equal(model.disabled, true);
    assert.equal(button("Send").disabled, true, "drafts cannot run before the model catalog arrives");
    assert.equal(button("Start voice").disabled, true);
    await act(async () => resolveCatalog(response({ sessions: [], models, default_model: "gpt-5.6-terra" })));
    assert.equal(model.value, "gpt-5.6-terra", "the backend chooses the default");
    assert.deepEqual(Array.from(model.options).filter((option) => option.value).map((option) => option.value), models);
    assert.equal(button("Send").disabled, false);
    await change(model, "");
    assert.equal(button("Send").disabled, true);
    assert.equal(button("Start voice").disabled, true);
    await change(model, "gpt-6-astra");
    await act(async () => button("Send").click());
    assert.equal(created.length, 1);
    assert.deepEqual(created[0], { model: "gpt-6-astra", prompt: "Review my emails", instructions: "", skills: [] });
    assert.equal(model.disabled, true, "the model cannot change during a request");
    await act(async () => resolveCreate(response(view(created[0], "typed-task"))));
    assert.equal(model.value, "gpt-6-astra");
    assert.equal(model.disabled, true, "created tasks retain their model");
    await act(async () => button("New task").click());
    assert.equal(model.value, "gpt-5.6-terra", "new tasks do not inherit an expensive saved model");
    assert.equal(model.disabled, false);
    await change(model, "gpt-5.6-sol");
    await act(async () => button("Start voice").click());
    assert.equal(model.disabled, true, "a live voice conversation locks its delegated task model");
    await act(async () => {
      channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
      channel.onmessage?.({ data: JSON.stringify({ type: "session.input_transcript.delta", delta: "Read my emails", start_ms: 0, end_ms: 100 }) });
      channel.onmessage?.({ data: JSON.stringify({ type: "session.delegation.created", offset_ms: 100, delegation: { id: "voice-delegation", target: "client" } }) });
    });
    assert.equal(created.length, 2);
    assert.equal(created[1].model, "gpt-5.6-sol");
    assert.ok(String(created[1].prompt).includes("Read my emails"));
    assert.ok(document.body.textContent?.includes("Voice conversations use GPT-Live"));
    await act(async () => button("End voice").click());
    assert.ok(stopped > 0);
  } finally {
    await act(async () => root.unmount());
    originals.forEach((descriptor, key) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
    await browser.happyDOM.close();
  }
});
