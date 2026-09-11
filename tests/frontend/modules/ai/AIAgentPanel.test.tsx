import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
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
  const view = { id: "task-one", prompt: "Read my emails", instructions: "", skills: [], stopped: false, status: "completed", created_at: "2026-09-11", actions: [], read_counts: {} };
  replacements.fetch = async (input: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${input}`);
    if (input.includes("/v1/ai/live")) {
      pendingSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    }
    const url = new URL(input);
    let result: unknown = { sessions: [{ id: view.id, prompt: view.prompt, created_at: view.created_at, stopped: false }] };
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
    const refresh = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Refresh task")!;
    await act(async () => refresh.click());
    assert.ok(requests.some((url) => url.includes("items_after=ai-two")));
    assert.deepEqual(Array.from(document.querySelectorAll(".mango-ai-message > div")).map((node) => node.textContent), ["First page", "Updated second page"]);
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
