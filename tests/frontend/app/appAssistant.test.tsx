import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";
import type { Editor } from "@tiptap/core";

test("chat submits once, preserves only finished history, aborts on Stop and isolates company/account state", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  for (const [name, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage,
    MutationObserver: dom.window.MutationObserver, DOMParser: dom.window.DOMParser, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; });
  }
  Object.assign(dom.window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {}, getClientRects: () => [{ width: 100, height: 30 }] });
  const requests: Array<{ url: string; body: { request_id: string; reasoning_effort: string; messages: Array<{ role: string; content: string }> }; signal: AbortSignal; stream: ReadableStreamDefaultController<Uint8Array> }> = [];
  const statusURLs: string[] = [];
  const resultURLs: string[] = [];
  let stoppedResultReads = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/status?")) {
      statusURLs.push(url);
      return new Response(JSON.stringify({ available: true }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/result?")) {
      resultURLs.push(url);
      const savedDuringStop = new URL(url).searchParams.get("request_id") === requests[1]?.body.request_id;
      if (savedDuringStop && ++stoppedResultReads === 1) return new Response(JSON.stringify({ finished: false }), { headers: { "Content-Type": "application/json" } });
      if (savedDuringStop && stoppedResultReads === 2) return new Response(JSON.stringify({ error: "assistant_result_unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ finished: true, ...(savedDuringStop ? {
        process: { id: "41414141-4141-4141-8141-414141414141", name: "Process recovered after Stop" },
        node_id: "51515151-5151-4151-8151-515151515151",
      } : {}) }), { headers: { "Content-Type": "application/json" } });
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
  const input = () => container.querySelector<HTMLElement & { editor: Editor }>('[role="textbox"][aria-label="Message Mango"]')!;
  const setMessage = (content: string) => input().editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: content ? [{ type: "text", text: content }] : [] }] });
  const reasoningSelect = () => container.querySelector<HTMLSelectElement>('select[aria-label="Reasoning effort"]')!;
  const form = () => container.querySelector("form")!;
  const assistantButton = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const send = async (content: string, duplicate = false) => {
    await act(async () => { setMessage(content); });
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
    assert.equal(input().getAttribute("aria-disabled"), "false");
    assert.equal(container.querySelector('input[type="checkbox"]'), null, "normal users have no context-inspection control");
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
    await act(async () => { setMessage("Keep this draft"); });
    await act(async () => { collapseButton.click(); });
    assert.equal(expandedRegion.hidden, true);
    assert.equal(expandButton.hidden, false);
    assert.equal(dom.window.document.activeElement, expandButton, "collapse must focus the replacement control");
    assert.equal(expandButton.getAttribute("aria-expanded"), "false");
    await act(async () => { expandButton.click(); });
    assert.equal(expandedRegion.hidden, false);
    assert.equal(dom.window.document.activeElement, collapseButton, "expand must focus the replacement control");
    assert.equal(input().editor.getText(), "Keep this draft", "collapsing chat must preserve its in-memory session");
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
    const stoppedTurn = container.querySelector('[data-assistant-turn-status="stopped"]')!;
    const refreshResult = () => Array.from(stoppedTurn.querySelectorAll("button")).find((button) => button.textContent === "Refresh saved result");
    assert.doesNotMatch(stoppedTurn.textContent!, /Open Node/, "a pending result must not invent a saved Node");
    assert.equal(refreshResult()!.disabled, false, "a regular user can refresh a save that outlasted the initial recovery wait");
    assert.equal(resultURLs.length, 1);
    await act(async () => { refreshResult()!.click(); });
    assert.equal(resultURLs.length, 2);
    assert.equal(refreshResult()!.disabled, false, "a failed recovery keeps the manual refresh available");
    assert.doesNotMatch(stoppedTurn.textContent!, /Open Node/);
    await act(async () => { refreshResult()!.click(); });
    assert.equal(resultURLs.length, 3, "each click performs one read and never resubmits the action");
    assert.match(stoppedTurn.textContent!, /Open Node/, "a regular user recovers the confirmed Node even when Stop cut its SSE link");
    assert.equal(refreshResult(), undefined, "a confirmed finished result needs no more refreshes");
    assert.match(container.textContent!, /Process recovered after Stop/);
    assert.match(resultURLs[0], /company_id=company-a/);
    assert.equal(new URL(resultURLs[0]).searchParams.get("request_id"), requests[1].body.request_id);
    assert.equal(container.querySelector('input[type="checkbox"]'), null, "saved result recovery does not grant Inspect");
    await send("Read the current state");
    assert.deepEqual(requests[2].body.messages.map((message) => message.content), ["List my processes", "<script>safe text</script>", "Read the current state"]);
    await emit(2, { type: "error", message: "Check Mango before repeating this change." });
    await send("Another read");
    assert.equal(requests[3].body.messages.length, 3, "failed and stopped replies cannot become history");
    await act(async () => { setActiveCompanyID("company-b"); });
    assert.equal(requests[3].signal.aborted, true);
    assert.doesNotMatch(container.textContent!, /List my processes|Partial write reply|Another read/);
    assert.equal(input().editor.getText(), "");
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
    assert.equal(input().getAttribute("aria-disabled"), "true");
  } finally {
    await act(async () => { root.unmount(); });
    resetTerminalAuthFailure();
    globalThis.fetch = originalFetch;
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

test("Process pills persist across follow-ups and inspection retains full server events through failure and Stop", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  for (const [name, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage,
    MutationObserver: dom.window.MutationObserver, DOMParser: dom.window.DOMParser, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; });
  }
  Object.assign(dom.window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {}, getClientRects: () => [{ width: 100, height: 30 }] });
  Object.assign(dom.window.Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) });
  const processIDs = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const nodeID = "33333333-3333-4333-8333-333333333333";
  const requests: Array<{ request_id: string; process_id?: string; inspect_context?: boolean; messages: Array<{ content: string }> }> = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const traces: Array<object[]> = [];
  let canInspect = true;
  const recoveries: string[] = [];
  const publicRecoveries: string[] = [];
  let statusChecks = 0;
  let unfinishedTraceRequestID: string | undefined;
  let missingTraceRequestID: string | undefined;
  let deferStatus = false;
  let pendingStatus: { signal: AbortSignal; resolve: (response: Response) => void } | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/status?")) {
      statusChecks++;
      if (deferStatus) {
        deferStatus = false;
        return new Promise<Response>((resolve) => { pendingStatus = { signal: init!.signal!, resolve }; });
      }
      return new Response(JSON.stringify({ available: true, can_inspect_context: canInspect }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/result?")) {
      publicRecoveries.push(url);
      return new Response(JSON.stringify({ finished: true, process: { id: processIDs[0], name: "Lunch walkthrough revised" }, node_id: nodeID }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/trace?")) {
      recoveries.push(url);
      if (!canInspect) return new Response(JSON.stringify({ error: "assistant_context_inspection_denied" }), { status: 403, headers: { "Content-Type": "application/json" } });
      const requestID = new URL(url).searchParams.get("request_id");
      if (requestID === missingTraceRequestID) return new Response(JSON.stringify({ error: "assistant_trace_not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
      const index = requests.findIndex((request) => request.request_id === requestID);
      return new Response(JSON.stringify({ events: traces[index] ?? [], finished: requestID !== unfinishedTraceRequestID, ...(index === 4 ? { process: { id: processIDs[0], name: "Lunch walkthrough revised" }, node_id: nodeID } : {}) }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/user-pins?")) {
      assert.equal(init?.method ?? "GET", "GET");
      return new Response(JSON.stringify({ user_pins: processIDs.map((id, index) => ({ pin_id: `pin-${index}`, resource_type: "logic_gate", resource_id: id, name: "Order review", position: index })) }), { headers: { "Content-Type": "application/json" } });
    }
    assert.match(url, /\/assistant\/chat\?/, "inserting a reference never calls a relationship command");
    requests.push(JSON.parse(String(init?.body)));
    traces.push([]);
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
  const input = () => container.querySelector<HTMLElement & { editor: Editor }>('[role="textbox"][aria-label="Message Mango"]')!;
  const picker = () => dom.window.document.querySelector<HTMLElement>('[aria-label="Universal picker"]');
  const chip = () => input().querySelector<HTMLElement>('[data-mango-entity-link="true"]');
  const checkbox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const append = async (text: string) => { await act(async () => { input().editor.commands.insertContentAt(input().editor.state.doc.content.size - 1, { type: "text", text }); }); };
  const key = async (value: string, init: KeyboardEventInit = {}) => { await act(async () => { input().dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init })); }); };
  const emit = async (index: number, event: object & { type?: string; trace?: object }) => {
    if (event.type === "trace") traces[index].push(event.trace!);
    await act(async () => { streams[index].enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); });
  };
  const inspect = async (turn: Element) => {
    await act(async () => { Array.from(turn.querySelectorAll("button")).find((button) => button.textContent === "Inspect")!.click(); });
    return dom.window.document.querySelector<HTMLElement>('[role="dialog"][aria-label="AI inspection"]')!;
  };
  const choose = async (index = 1) => {
    await act(async () => { input().editor.commands.setTextSelection(input().editor.state.doc.content.size - 1); });
    await key("#");
    assert.ok(picker());
    assert.equal(picker()!.dataset.mangoUniversalPickerMode, "reference");
    const options = picker()!.querySelectorAll<HTMLButtonElement>('[role="option"]');
    assert.equal(options.length, 2);
    await act(async () => { options[index].click(); await new Promise((resolve) => setTimeout(resolve, 25)); });
    assert.equal(picker(), null);
    assert.equal(chip()!.dataset.mangoEntityId, processIDs[index]);
    assert.match(chip()!.className, /mango-editor-entity-link--logic_gate/);
    assert.ok(chip()!.querySelector("svg"), "the chip renders the existing Process icon");
    assert.equal(input().querySelectorAll('[data-mango-entity-link="true"]').length, 1);
  };
  try {
    assert.deepEqual(universalPickerAllowedTypes("reference", [], "all"), ["node", "logic_gate", "project", "entity", "email_message"]);
    assert.deepEqual(universalPickerAllowedTypes("reference", [], "all", ["logic_gate"]), ["logic_gate"]);
    resetTerminalAuthFailure(); setActiveCompanyID("process-company-a");
    await act(async () => { render(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Expand Mango chat"]')!.click(); });
    assert.equal(checkbox().checked, false);
    await append("Please perform "); await choose(); await append("for today's order");
    assert.equal(requests.length, 0);
    await key("Enter", { isComposing: true });
    assert.equal(requests.length, 0, "composition Enter cannot send");
    await act(async () => { checkbox().click(); });
    await key("Enter");
    assert.equal(requests[0].process_id, processIDs[1]);
    assert.equal(requests[0].inspect_context, true);
    assert.equal(checkbox().checked, false, "inspection applies to one Send");
    assert.equal(chip()!.dataset.mangoEntityId, processIDs[1], "the selected pill stays visible after sending");
    let modal = await inspect(container.querySelector('[data-assistant-turn-status="running"]')!);
    assert.match(modal.textContent!, /No server events received yet/, "Inspect is available before the first provider request");
    await emit(0, { type: "trace", trace: { sequence: 1, kind: "provider_request", status: "prepared", time: "2026-09-05T00:00:00Z", data: { invocation: 1, body: { input: [{ role: "developer", content: "Server-compiled SOP and Steps" }], model: "test-model", instructions: "Server instructions plus Pi", tools: [{ name: "write_process_node" }], max_output_tokens: 4096, store: false, parallel_tool_calls: false } } } });
    await emit(0, { type: "trace", trace: { sequence: 2, kind: "provider_request", status: "dispatched", time: "2026-09-05T00:00:01Z", data: { invocation: 17, body: { input: [{ role: "developer", content: "Server-compiled SOP and Steps" }, { type: "function_call_output", output: "Saved tool result" }], omissions: ["Encrypted reasoning is unavailable"] } } } });
    await emit(0, { type: "trace", trace: { sequence: 3, kind: "skill", status: "completed", time: "2026-09-05T00:00:02Z", data: { content: "Full native skill content, including the final line." } } });
    await emit(0, { type: "node", node_id: nodeID, process_id: processIDs[1] });
    await emit(0, { type: "trace", trace: { sequence: 4, kind: "tool", status: "failed", time: "2026-09-05T00:00:03Z", data: { arguments: { plain_text: "Work attempted" }, error: "The SOP changed" } } });
    await emit(0, { type: "error", message: "Stopped at the current Step." });
    const failed = container.querySelector('[data-assistant-turn-status="failed"]')!;
    assert.match(failed.textContent!, /Open Node/);
    assert.equal(recoveries.length, 1);
    for (const content of ["Server-compiled SOP and Steps", "Server instructions plus Pi", "prepared", "dispatched", "Saved tool result", "hidden reasoning", "max_output_tokens", "Full native skill content, including the final line.", "The SOP changed", "15 minutes", "Clear chat", "reload"]) assert.ok(modal.textContent!.includes(content), content);
    await act(async () => { modal.querySelector<HTMLButtonElement>("button")!.click(); });
    await append("Do you see it now?"); await key("Enter");
    assert.equal(requests[1].process_id, processIDs[1], "a plain follow-up keeps the same exact Process context");
    assert.equal(requests[1].inspect_context, undefined);
    assert.deepEqual(requests[1].messages, [{ role: "user", content: "#Order review Do you see it now?" }]);
    await emit(1, { type: "done" });
    await choose(0); await append("Use this one"); await key("Enter");
    assert.equal(requests[2].process_id, processIDs[0], "same-label replacement changes the exact Process ID");
    await emit(2, { type: "done" });
    await act(async () => { input().editor.commands.setNodeSelection(1); }); await key("Backspace");
    assert.equal(chip(), null, "normal Mango Backspace leaves the label and removes reference identity");
    await append(" is only text now"); await key("Enter");
    assert.equal(requests[3].process_id, undefined); await emit(3, { type: "done" });
    await act(async () => { input().editor.commands.clearContent(); checkbox().click(); });
    await append("Find the saved lunch Process and perform its written walkthrough"); await key("Enter");
    assert.equal(requests[4].process_id, undefined, "discovery starts without a browser-selected identity");
    await emit(4, { type: "process", process_id: processIDs[0], name: "Lunch walkthrough revised" });
    assert.equal(chip()!.dataset.mangoEntityId, processIDs[0]);
    assert.match(chip()!.textContent!, /Lunch walkthrough revised/);
    await emit(4, { type: "trace", trace: { sequence: 1, kind: "tool", status: "saved", time: "2026-09-05T00:00:00Z", data: { node_id: nodeID } } });
    assert.doesNotMatch(container.querySelector('[data-assistant-turn-status="running"]')!.textContent!, /Open Node/);
    traces[4].push({ sequence: 2, kind: "termination", status: "stopped", time: "2026-09-05T00:00:01Z", data: { message: "Server cancellation complete" } });
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Stop")!.click(); });
    const stopped = container.querySelector('[data-assistant-turn-status="stopped"]')!;
    assert.match(stopped.textContent!, /Open Node/, "recovery restores a confirmed saved Node even when Stop cut its SSE event");
    modal = await inspect(stopped);
    assert.match(modal.textContent!, /Browser observation.*Stop requested/s, "local Stop is identified separately from server events");
    assert.match(modal.textContent!, /Server cancellation complete/, "recovery retains final events missed by the aborted stream");
    assert.match(modal.textContent!, /not confirmation.*canceled or undone/s);
    await act(async () => { modal.querySelector<HTMLButtonElement>("button")!.click(); });
    await append("Explain this Process"); await key("Enter");
    assert.equal(requests[5].process_id, processIDs[0], "server-confirmed discovery persists in the existing picker contract");
    await emit(5, { type: "done" });
    const recoveryCount = recoveries.length;
    const previousStatusChecks = statusChecks;
    modal = await inspect(stopped);
    assert.match(modal.textContent!, /Server cancellation complete/, "an earlier complete browser capture remains inspectable after the next Send");
    assert.match(modal.textContent!, /until your next Send/);
    assert.equal(recoveries.length, recoveryCount, "opening a complete captured turn does not depend on expired server recovery");
    assert.equal(statusChecks, previousStatusChecks + 1, "opening an old browser capture still rechecks current developer access");
    await act(async () => { modal.querySelector<HTMLButtonElement>("button")!.click(); });
    await act(async () => { checkbox().click(); });
    await append("Perform a walkthrough that finishes after Stop"); await key("Enter");
    unfinishedTraceRequestID = requests[6].request_id;
    await emit(6, { type: "trace", trace: { sequence: 1, kind: "tool", status: "dispatched", time: "2026-09-05T00:00:00Z", data: { name: "create_process_node", message: "Received before late save" } } });
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Stop")!.click(); });
    const lateStopped = Array.from(container.querySelectorAll('[data-assistant-turn-status="stopped"]')).at(-1)!;
    assert.doesNotMatch(lateStopped.textContent!, /Open Node/, "an unfinished Stop snapshot cannot confirm a later save");
    await append("Explain the next Process"); await key("Enter"); await emit(7, { type: "done" });
    missingTraceRequestID = requests[6].request_id;
    modal = await inspect(lateStopped);
    assert.equal(publicRecoveries.length, 1, "an expired trace recovers the retained public saved result once");
    assert.equal(new URL(publicRecoveries[0]).searchParams.get("request_id"), requests[6].request_id);
    assert.match(lateStopped.textContent!, /Open Node/, "an expired trace cannot strand a confirmed saved Node");
    assert.match(modal.textContent!, /Received before late save/, "public result recovery preserves the browser's partial capture");
    assert.match(modal.textContent!, /Final server capture is unavailable/);
    assert.match(modal.textContent!, /Saved action results recovered/);
    await act(async () => { modal.querySelector<HTMLButtonElement>("button")!.click(); });
    await act(async () => { checkbox().click(); });
    await append("Perform another written walkthrough"); await key("Enter");
    assert.equal(requests[8].inspect_context, true);
    await emit(8, { type: "trace", trace: { sequence: 1, kind: "tool", status: "dispatched", time: "2026-09-05T00:00:00Z", data: { name: "create_process_node" } } });
    canInspect = false;
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Stop")!.click(); });
    assert.equal(publicRecoveries.length, 2, "revoked Inspect recovery requests public saved metadata once");
    assert.equal(new URL(publicRecoveries[1]).searchParams.get("request_id"), requests[8].request_id);
    assert.match(Array.from(container.querySelectorAll('[data-assistant-turn-status="stopped"]')).at(-1)!.textContent!, /Open Node/, "losing Inspect does not hide an accessible confirmed saved Node");
    assert.equal(dom.window.document.querySelector('[aria-label="AI inspection"]'), null, "revocation closes privileged inspection");
    assert.equal(checkbox(), null);
    assert.equal(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Inspect"), false);
    await choose();
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Clear chat")!.click(); });
    assert.equal(chip(), null); assert.equal(input().editor.getText(), "");
    assert.doesNotMatch(container.textContent!, /Inspect|Open Node/);
    await choose(); await act(async () => { setActiveCompanyID("process-company-b"); });
    assert.equal(chip(), null); assert.equal(input().editor.getText(), "");
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Expand Mango chat"]')!.click(); });
    await choose(); await act(async () => { render("process-user-b"); });
    assert.equal(chip(), null); assert.equal(input().editor.getText(), ""); assert.equal(picker(), null);
    canInspect = true;
    await act(async () => { render("inspection-race-user"); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Expand Mango chat"]')!.click(); checkbox().click(); });
    await append("Inspect this completed turn"); await key("Enter"); await emit(9, { type: "done" });
    deferStatus = true;
    await inspect(container.querySelector('[data-assistant-turn-status="complete"]')!);
    assert.ok(pendingStatus, "inspection access remains pending");
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Clear chat")!.click(); });
    assert.equal(pendingStatus.signal.aborted, true, "Clear chat cancels pending inspection requests");
    await append("This new turn was not inspected"); await key("Enter"); await emit(10, { type: "done" });
    await act(async () => { pendingStatus!.resolve(new Response(JSON.stringify({ available: true, can_inspect_context: true }), { headers: { "Content-Type": "application/json" } })); });
    assert.equal(dom.window.document.querySelector('[aria-label="AI inspection"]'), null, "a delayed Inspect response cannot open a new turn after Clear chat");
  } finally {
    await act(async () => { root.unmount(); }); resetTerminalAuthFailure(); globalThis.fetch = originalFetch;
    restores.reverse().forEach((restore) => restore()); dom.window.close();
  }
});
