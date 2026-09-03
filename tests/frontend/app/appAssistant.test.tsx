import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";

test("chat submits once, preserves only finished history, aborts on Stop and isolates company/account state", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  for (const [name, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; });
  }
  Object.assign(dom.window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {}, getClientRects: () => [{ width: 100, height: 30 }] });
  const requests: Array<{ url: string; body: { messages: Array<{ role: string; content: string }> }; signal: AbortSignal; stream: ReadableStreamDefaultController<Uint8Array> }> = [];
  const statusURLs: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/status?")) {
      statusURLs.push(url);
      return new Response(JSON.stringify({ available: true }), { headers: { "Content-Type": "application/json" } });
    }
    const signal = init!.signal!;
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      stream = controller;
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    } });
    requests.push({ url, body: JSON.parse(String(init?.body)), signal, stream });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  };
  const [{ createRoot }, { AppAssistant }, { setActiveCompanyID }, { AppModalPortal }, { resetTerminalAuthFailure, markTerminalAuthFailure }] = await Promise.all([
    import("react-dom/client"), import("../../../frontend/src/app/AppAssistant.tsx"), import("../../../frontend/src/auth/currentCompany.ts"),
    import("../../../frontend/src/app/AppModalPortal.tsx"), import("../../../frontend/src/auth/cognitoAuth.ts"),
  ]);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const render = (userID = "user-a", modal = false) => root.render(<>
    <AppAssistant apiBase="http://localhost:8080" userID={userID} leftInset={340} bottomInset={10} />
    {modal && <AppModalPortal onRequestClose={() => undefined}><section role="dialog" aria-label="Permissions"><input aria-label="Permission input" /></section></AppModalPortal>}
  </>);
  const input = () => container.querySelector<HTMLInputElement>('input[aria-label="Message Mango"]')!;
  const form = () => container.querySelector("form")!;
  const send = async (content: string, duplicate = false) => {
    await act(async () => { input().value = content; Simulate.change(input()); });
    await act(async () => {
      Simulate.submit(form());
      if (duplicate) Simulate.submit(form());
    });
  };
  const emit = async (index: number, message: object) => {
    await act(async () => { requests[index].stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(message)}\n\n`)); });
  };
  const stop = async () => { await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Stop")!.click(); }); };
  try {
    resetTerminalAuthFailure();
    setActiveCompanyID("company-a");
    await act(async () => { render(); });
    assert.equal(input().disabled, false);
    await send("List my processes", true);
    assert.equal(requests.length, 1);
    await act(async () => { render("user-a", true); });
    const modalInput = dom.window.document.querySelector<HTMLInputElement>('input[aria-label="Permission input"]')!;
    await act(async () => { modalInput.focus(); });
    await emit(0, { type: "text", text: "<script>safe text</script>" });
    assert.equal(dom.window.document.activeElement, modalInput, "stream updates must not take focus from a dialog");
    assert.equal(container.querySelector("script"), null);
    await emit(0, { type: "done" });
    await act(async () => { render(); });
    await send("Create a process");
    assert.equal(requests[1].body.messages.length, 3);
    await emit(1, { type: "text", text: "Partial write reply" });
    await stop();
    assert.equal(requests[1].signal.aborted, true);
    assert.match(container.textContent!, /Changes already completed in Mango may remain/);
    await send("Read the current state");
    assert.deepEqual(requests[2].body.messages.map((message) => message.content), ["List my processes", "<script>safe text</script>", "Read the current state"]);
    await emit(2, { type: "error", message: "Check Mango before repeating this change." });
    await send("Another read");
    assert.equal(requests[3].body.messages.length, 3, "failed and stopped replies cannot become history");
    await act(async () => { setActiveCompanyID("company-b"); });
    assert.equal(requests[3].signal.aborted, true);
    assert.doesNotMatch(container.textContent!, /List my processes|Partial write reply|Another read/);
    assert.equal(input().value, "");
    assert.match(statusURLs.at(-1)!, /company_id=company-b$/);
    await send("Company B question");
    assert.match(requests[4].url, /company_id=company-b$/);
    assert.deepEqual(requests[4].body.messages, [{ role: "user", content: "Company B question" }]);
    await emit(4, { type: "done" });
    await send("After empty reply");
    assert.deepEqual(requests[5].body.messages, [{ role: "user", content: "After empty reply" }]);
    await act(async () => { render("user-b"); });
    assert.equal(requests[5].signal.aborted, true);
    assert.doesNotMatch(container.textContent!, /Company B question/);
    await send("User B question");
    await act(async () => { markTerminalAuthFailure("logout"); });
    assert.equal(requests[6].signal.aborted, true);
    assert.doesNotMatch(container.textContent!, /User B question/);
    assert.equal(input().disabled, true);
  } finally {
    await act(async () => { root.unmount(); });
    resetTerminalAuthFailure();
    globalThis.fetch = originalFetch;
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});
