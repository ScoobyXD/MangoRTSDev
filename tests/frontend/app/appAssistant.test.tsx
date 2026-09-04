import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  const requests: Array<{ url: string; body: { reasoning_effort: string; messages: Array<{ role: string; content: string }> }; signal: AbortSignal; stream: ReadableStreamDefaultController<Uint8Array> }> = [];
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
    <AppAssistant apiBase="http://localhost:8080" userID={userID} bottomInset={10} />
    {modal && <AppModalPortal onRequestClose={() => undefined}><section role="dialog" aria-label="Permissions"><input aria-label="Permission input" /></section></AppModalPortal>}
  </>);
  const input = () => container.querySelector<HTMLInputElement>('input[aria-label="Message Mango"]')!;
  const reasoningSelect = () => container.querySelector<HTMLSelectElement>('select[aria-label="Reasoning effort"]')!;
  const form = () => container.querySelector("form")!;
  const assistantButton = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
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
    dom.window.localStorage.setItem("mangorts.assistant.reasoningEffort.v1", "ultra");
    await act(async () => { render(); });
    assert.equal(input().disabled, false);
    const assistant = container.querySelector<HTMLElement>(".mango-assistant")!;
    assert.equal(assistant.style.left, "", "chat centering must not inherit the app sidebar inset");
    const stylesheet = readFileSync(resolve(process.cwd(), "frontend/src/index.css"), "utf8");
    assert.match(stylesheet, /\.mango-assistant\s*\{[^}]*left:\s*10px;[^}]*right:\s*10px;/s, "chat must use equal viewport gutters");
    const collapseButton = assistantButton("Collapse Mango chat");
    const panelID = collapseButton.getAttribute("aria-controls")!;
    const panel = dom.window.document.getElementById(panelID)!;
    const expandedRegion = panel.closest<HTMLDivElement>(".mango-assistant-expanded")!;
    const expandButton = assistantButton("Expand Mango chat");
    assert.ok(dom.window.document.getElementById(panelID), "the controlled panel must remain mounted while hidden");
    assert.equal(expandedRegion.hidden, true, "chat must start collapsed");
    assert.equal(expandButton.hidden, false);
    assert.equal(expandButton.getAttribute("aria-expanded"), "false");
    await act(async () => { expandButton.click(); });
    assert.equal(expandedRegion.hidden, false);
    assert.equal(expandButton.hidden, true);
    assert.equal(dom.window.document.activeElement, collapseButton, "expanding must focus the replacement control");
    assert.equal(reasoningSelect().value, "medium", "invalid saved effort must fall back to medium");
    assert.deepEqual(Array.from(reasoningSelect().options, (option) => option.value), ["low", "medium", "high", "xhigh", "max"]);
    await act(async () => { reasoningSelect().value = "max"; Simulate.change(reasoningSelect()); });
    assert.equal(dom.window.localStorage.getItem("mangorts.assistant.reasoningEffort.v1"), "max");
    await act(async () => { input().value = "Keep this draft"; Simulate.change(input()); });
    await act(async () => { collapseButton.click(); });
    assert.equal(expandedRegion.hidden, true);
    assert.equal(expandButton.hidden, false);
    assert.equal(dom.window.document.activeElement, expandButton, "collapse must focus the replacement control");
    assert.equal(expandButton.getAttribute("aria-expanded"), "false");
    await act(async () => { expandButton.click(); });
    assert.equal(expandedRegion.hidden, false);
    assert.equal(dom.window.document.activeElement, collapseButton, "expand must focus the replacement control");
    assert.equal(input().value, "Keep this draft", "collapsing chat must preserve its in-memory session");
    await send("List my processes", true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.reasoning_effort, "max");
    assert.equal(reasoningSelect().disabled, true, "the effort for a running Send must stay fixed");
    await act(async () => { assistantButton("Collapse Mango chat").click(); });
    assert.equal(requests[0].signal.aborted, false, "collapsing must not stop the active request");
    await emit(0, { type: "text", text: "<script>safe text</script>" });
    await act(async () => { assistantButton("Expand Mango chat").click(); });
    assert.match(container.textContent!, /<script>safe text<\/script>/, "the live turn must remain visible after expansion");
    assert.ok(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Stop"));
    await act(async () => { render("user-a", true); });
    const modalInput = dom.window.document.querySelector<HTMLInputElement>('input[aria-label="Permission input"]')!;
    await act(async () => { modalInput.focus(); });
    await emit(0, { type: "tool", name: "list_processes", status: "running" });
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
    assert.equal(assistantButton("Expand Mango chat").hidden, false, "a new company session must start collapsed");
    assert.equal(reasoningSelect().value, "max", "the valid browser choice must survive a session remount");
    await act(async () => { assistantButton("Expand Mango chat").click(); });
    await send("Company B question");
    assert.match(requests[4].url, /company_id=company-b$/);
    assert.deepEqual(requests[4].body.messages, [{ role: "user", content: "Company B question" }]);
    await emit(4, { type: "done" });
    await send("After empty reply");
    assert.deepEqual(requests[5].body.messages, [{ role: "user", content: "After empty reply" }]);
    await act(async () => { render("user-b"); });
    assert.equal(requests[5].signal.aborted, true);
    assert.doesNotMatch(container.textContent!, /Company B question/);
    assert.equal(assistantButton("Expand Mango chat").hidden, false, "a new account session must start collapsed");
    assert.equal(reasoningSelect().value, "max");
    await act(async () => { assistantButton("Expand Mango chat").click(); });
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

test("Process selection uses the universal picker, exact per-turn identities, editable mentions, and existing Node navigation", async () => {
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
  const processIDs = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const nodeID = "33333333-3333-4333-8333-333333333333";
  const requests: Array<{ process_id?: string; messages: Array<{ content: string }> }> = [];
  const calls: Array<{ url: string; method: string }> = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.includes("/status?")) return new Response(JSON.stringify({ available: true }), { headers: { "Content-Type": "application/json" } });
    if (url.includes("/user-pins?")) return new Response(JSON.stringify({ user_pins: [
      ...processIDs.map((id, index) => ({ pin_id: `pin-${index}`, resource_type: "logic_gate", resource_id: id, name: "Order review", position: index })),
      { pin_id: "pin-node", resource_type: "node", resource_id: nodeID, name: "Unrelated Node", position: 2 },
    ] }), { headers: { "Content-Type": "application/json" } });
    assert.match(url, /\/assistant\/chat\?/);
    requests.push(JSON.parse(String(init?.body)));
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      streams.push(controller);
      init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
    } }), { headers: { "Content-Type": "text/event-stream" } });
  };
  const [{ createRoot }, { AppAssistant }, { setActiveCompanyID }, { resetTerminalAuthFailure }, { universalPickerAllowedTypes }] = await Promise.all([
    import("react-dom/client"), import("../../../frontend/src/app/AppAssistant.tsx"), import("../../../frontend/src/auth/currentCompany.ts"), import("../../../frontend/src/auth/cognitoAuth.ts"), import("../../../frontend/src/modules/editor/UniversalEntityPicker.tsx"),
  ]);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const render = (userID = "process-user-a") => root.render(<AppAssistant apiBase="http://localhost:8080" userID={userID} bottomInset={10} />);
  const input = () => container.querySelector<HTMLInputElement>('input[aria-label="Message Mango"]')!;
  const picker = () => dom.window.document.querySelector<HTMLElement>('[aria-label="Universal picker"]');
  const selected = () => container.querySelector('[aria-label="Selected Process"]');
  const change = async (value: string, cursor = value.length) => { await act(async () => { input().value = value; input().setSelectionRange(cursor, cursor); Simulate.change(input()); }); };
  const submit = async () => { await act(async () => { Simulate.submit(container.querySelector("form")!); }); };
  const emit = async (index: number, event: object) => { await act(async () => { streams[index].enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); }); };
  const choose = async () => {
    await change("Please perform #");
    assert.ok(picker(), "# must open the existing universal picker");
    assert.equal(picker()!.dataset.mangoUniversalPickerMode, "reference");
    assert.match(picker()!.textContent!, /# Reference/);
    assert.doesNotMatch(picker()!.textContent!, /## Link/);
    const options = picker()!.querySelectorAll<HTMLButtonElement>('[role="option"]');
    assert.equal(options.length, 2, "only Processes can be selected");
    assert.doesNotMatch(picker()!.textContent!, /Unrelated Node/);
    const search = picker()!.querySelector<HTMLInputElement>("input")!;
    await act(async () => { Simulate.keyDown(search, { key: "ArrowDown" }); });
    await act(async () => { Simulate.keyDown(search, { key: "Enter" }); });
    assert.equal(picker(), null);
    assert.equal(dom.window.document.activeElement, input(), "selection returns focus to the message");
    assert.equal(input().value, "Please perform #Order review ");
    assert.match(selected()!.textContent!, /Order review/);
  };
  try {
    assert.deepEqual(universalPickerAllowedTypes("reference", [], "all"), ["node", "logic_gate", "project", "entity", "email_message"], "existing reference callers keep their full resource choices");
    assert.deepEqual(universalPickerAllowedTypes("reference", [], "all", ["logic_gate"]), ["logic_gate"]);
    assert.deepEqual(universalPickerAllowedTypes("reference", [], "node", ["logic_gate"]), []);
    assert.deepEqual(universalPickerAllowedTypes("link", ["project"], "all", ["logic_gate"]), ["project"], "reference filtering does not change relationship linking");
    resetTerminalAuthFailure();
    setActiveCompanyID("process-company-a");
    await act(async () => { render(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Expand Mango chat"]')!.click(); });
    await choose();
    assert.equal(requests.length, 0, "choosing a Process must not execute it or create any relationship");
    assert.ok(calls.every((call) => call.method === "GET"));
    await change(`Now: ${input().value}`);
    await change(`${input().value}for today's order`);
    assert.ok(selected(), "editing around the exact mention preserves selection");
    await submit();
    assert.equal(requests[0].process_id, processIDs[1], "duplicate names retain the exact selected Process ID");
    assert.equal(input().value, "");
    assert.equal(selected(), null, "Process selection belongs only to the submitted turn");
    await emit(0, { type: "node", node_id: nodeID, process_id: processIDs[0] });
    assert.ok(!container.textContent!.includes("Open Node"), "a different Process event cannot link a Node to this turn");
    await emit(0, { type: "node", node_id: nodeID, process_id: processIDs[1] });
    await emit(0, { type: "error", message: "Stopped at the current Step." });
    const failed = container.querySelector('[data-assistant-turn-status="failed"]')!;
    assert.match(failed.textContent!, /Open Node/, "failed work keeps its existing Node accessible");
    await act(async () => { failed.querySelector<HTMLButtonElement>("button")!.click(); });
    assert.match(dom.window.location.pathname, new RegExp(`${nodeID}$`));
    await change("What happened?");
    await submit();
    assert.equal(requests[1].process_id, undefined, "a follow-up cannot silently execute the prior Process again");
    assert.deepEqual(requests[1].messages, [{ role: "user", content: "What happened?" }], "failed work is not replayed");
    await emit(1, { type: "done" });
    await choose();
    await change(input().value.replace("Order", "Other"));
    assert.equal(selected(), null, "editing the mention invalidates its selected identity");
    await submit();
    assert.equal(requests[2].process_id, undefined);
    await emit(2, { type: "done" });
    await choose();
    await change(`Prefix ${input().value}`);
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Remove selected Process"]')!.click(); });
    assert.equal(input().value, "Prefix Please perform  ");
    assert.equal(selected(), null);
    await change("Cancel #");
    await act(async () => { Simulate.keyDown(picker()!.querySelector("input")!, { key: "Escape" }); });
    assert.equal(picker(), null);
    assert.equal(dom.window.document.activeElement, input());
    await choose();
    await change(`${input().value}#Order review `);
    assert.ok(selected());
    await change("Please perform #Order review ", "Please perform ".length);
    assert.equal(selected(), null, "removing the selected occurrence cannot transfer its ID to identical unselected text");
    await choose();
    await act(async () => { setActiveCompanyID("process-company-b"); });
    assert.equal(selected(), null);
    assert.equal(input().value, "");
    assert.doesNotMatch(container.textContent!, /Order review|Open Node/);
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Expand Mango chat"]')!.click(); });
    await choose();
    await act(async () => { render("process-user-b"); });
    assert.equal(selected(), null);
    assert.equal(input().value, "");
    assert.equal(picker(), null);
  } finally {
    await act(async () => { root.unmount(); });
    resetTerminalAuthFailure();
    globalThis.fetch = originalFetch;
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});
