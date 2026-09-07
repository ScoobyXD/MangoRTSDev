import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import type { ProcessStep, ProcessWorkSnapshot } from "../../../../frontend/src/modules/kanban/processWork.js";
import type { MangoTiptapFormattingController } from "../../../../frontend/src/modules/editor/tiptap/MangoTiptapEditor.js";
import type { MangoTiptapDocument } from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapDocument.js";

function body(text: string): MangoTiptapDocument {
  return { format: "mango-tiptap-json", schema_version: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } };
}

async function waitFor(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (predicate()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
  assert.fail(message);
}

test("Process instructions share one toolbar and scroll while step bodies follow their exact step through edits and reorder", { timeout: 15_000 }, async () => {
  const css = readFileSync("frontend/src/modules/editor/processStepInstructions.css", "utf8");
  const dom = new JSDOM(`<!doctype html><style>${css}</style><div id="process-editor"></div>`, { url: "http://localhost/", pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    });
  };
  for (const name of ["window", "document", "navigator", "self", "Node", "NodeFilter", "Element", "HTMLElement", "DocumentFragment", "DOMParser", "Event", "EventTarget", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "InputEvent", "MutationObserver", "Range", "Selection", "localStorage", "sessionStorage"]) {
    install(name, name === "window" || name === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name]);
  }
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("IS_REACT_ACT_ENVIRONMENT", true);
  install("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0));
  install("cancelAnimationFrame", clearTimeout);
  dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  dom.window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
  const container = dom.window.document.getElementById("process-editor")!;
  const [{ createRoot }, { LogicGateTiptapEditorSurface }] = await Promise.all([
    import("react-dom/client"),
    import("../../../../frontend/src/modules/editor/LogicGateTiptapEditorSurface.js"),
  ]);
  const root = createRoot(container);
  const controllerRef: React.MutableRefObject<MangoTiptapFormattingController | null> = { current: null };
  let overview = body("Process purpose");
  let steps: ProcessStep[] = [
    { process_step_id: "step-b", logic_gate_id: "process-a", name: "Ship", position: 20, body_json: body("Ship instructions") },
    { process_step_id: "step-a", logic_gate_id: "process-a", name: "Prepare", position: 10, body_json: body("Prepare instructions") },
  ];
  const requestJSON = async <T,>(): Promise<T> => { assert.fail("unsaved Process instructions must not write to a server"); };
  let boldActive = false;
  let fontSize = 0;
  let section: "overview" | "steps" | undefined;
  const render = (key = "process-a") => root.render(<React.Suspense fallback={<div>Loading editor</div>}>
    <button onMouseDown={(event) => event.preventDefault()} onClick={() => controllerRef.current?.insertTable()}>Insert table</button>
    <LogicGateTiptapEditorSurface key={key} apiBase="" companyID="company-local" resourceID="process-a" documentID="logic-gate-overview"
      saveMode="local" value={JSON.stringify(overview)} steps={steps} section={section} requestJSON={requestJSON} formattingControllerRef={controllerRef}
      leadingContent={<div>Process metadata</div>} onSelectionInlineFormatChange={(format) => { boldActive = format.bold; }}
      onSelectionFontSizeChange={(next) => { fontSize = next; }}
      onDocumentSnapshotChange={(document) => { overview = document; }}
      onStepBodyChange={(stepID, document) => { steps = steps.map((step) => step.process_step_id === stepID ? { ...step, body_json: document } : step); }} />
  </React.Suspense>);
  const stepCard = (stepID: string) => container.querySelector<HTMLElement>(`[data-process-step-id="${stepID}"]`)!;
  const editorRoot = (stepID?: string) => stepID
    ? stepCard(stepID).querySelector<HTMLElement>('[data-mango-editor-format="tiptap_json"]')!
    : container.querySelector<HTMLElement>('[data-mango-editor-format="tiptap_json"]')!;
  const activate = async (stepID?: string, beforeFocus?: () => void) => {
    const element = editorRoot(stepID);
    await act(async () => { Simulate.doubleClick(element); });
    await waitFor(() => Boolean(element.querySelector('.mango-tiptap-prosemirror')), "the requested instruction editor did not activate");
    beforeFocus?.();
    await act(async () => { element.querySelector<HTMLElement>('.mango-tiptap-prosemirror')!.focus(); });
    await waitFor(() => controllerRef.current !== null, "the shared toolbar did not receive the focused editor");
  };
  try {
    await act(async () => render());
    await waitFor(() => container.querySelectorAll('[data-mango-editor-format="tiptap_json"]').length === 3, "overview and both step instructions did not load");
    assert.deepEqual(Array.from(container.querySelectorAll("section")).map((card) => card.getAttribute("aria-label")), ["Step 1: Prepare", "Step 2: Ship"]);
    assert.match(editorRoot().textContent ?? "", /Process purpose/);
    assert.doesNotMatch(editorRoot().textContent ?? "", /Prepare instructions|Ship instructions/);
    assert.equal(dom.window.getComputedStyle(container.querySelector(".mango-process-instructions")!).overflowY, "auto");
    assert.equal(editorRoot("step-a").style.overflowY, "", "step cards must grow in the shared scroller");

    await activate("step-a");
    await act(async () => { controllerRef.current!.toggleInlineFormat("bold"); });
    assert.equal(boldActive, true);
    const firstController = controllerRef.current;
    await act(async () => { Simulate.click(container.querySelector("button")!); });
    assert.match(JSON.stringify(steps.find((step) => step.process_step_id === "step-a")!.body_json), /"type":"table"/);
    assert.doesNotMatch(JSON.stringify(steps.find((step) => step.process_step_id === "step-b")!.body_json), /"type":"table"/);
    assert.doesNotMatch(JSON.stringify(overview), /"type":"table"/);

    await act(async () => { controllerRef.current!.applyFontSizeValue(24); });
    await activate("step-b", () => {
      assert.equal(fontSize, 24, "preparing an unfocused step must not replace the shared toolbar state");
      assert.equal(controllerRef.current, firstController, "preparing an unfocused step must not steal the shared toolbar");
    });
    assert.notEqual(controllerRef.current, firstController);
    assert.equal(boldActive, false, "moving to another step must show that step's formatting state");
    await act(async () => { controllerRef.current!.applyTextAlignment("right"); });
    assert.match(JSON.stringify(steps.find((step) => step.process_step_id === "step-b")!.body_json), /"textAlign":"right"/);
    const shipEditor = editorRoot("step-b");
    steps = steps.map((step) => ({ ...step, position: step.process_step_id === "step-b" ? 5 : 20 }));
    await act(async () => render());
    assert.equal(editorRoot("step-b"), shipEditor, "reorder must preserve the exact live editor and its caret");
    assert.deepEqual(Array.from(container.querySelectorAll("section")).map((card) => card.getAttribute("aria-label")), ["Step 1: Ship", "Step 2: Prepare"]);

    steps = [...steps, { process_step_id: "step-c", logic_gate_id: "process-a", name: "Archive", position: 30 }];
    await act(async () => render());
    assert.ok(stepCard("step-c"), "adding a step automatically adds its blank instruction card");
    steps = steps.filter((step) => step.process_step_id !== "step-a");
    await act(async () => render());
    assert.equal(stepCard("step-a"), null);
    assert.equal(editorRoot("step-b"), shipEditor, "removing another step must preserve the surviving editor");
    await activate();
    await act(async () => { controllerRef.current!.applyTextAlignment("center"); });
    assert.match(JSON.stringify(overview), /"textAlign":"center"/);
    assert.match(JSON.stringify(steps.find((step) => step.process_step_id === "step-b")!.body_json), /"textAlign":"right"/);
    const overviewEditor = editorRoot();
    section = "steps";
    await act(async () => render());
    assert.equal(overviewEditor.parentElement?.hidden, true, "Steps hides the overview without unmounting it");
    assert.equal(editorRoot("step-b"), shipEditor);
    await activate("step-b");
    section = "overview";
    await act(async () => render());
    assert.equal(dom.window.getComputedStyle(container.querySelector(".mango-process-instructions__steps")!).display, "none");
    assert.equal(editorRoot(), overviewEditor, "changing sections keeps the live overview and its pending edits");
    await act(async () => { controllerRef.current!.applyTextAlignment("left"); });
    assert.match(JSON.stringify(overview), /"textAlign":"left"/, "the toolbar targets the visible overview after a tab change");
    assert.match(JSON.stringify(steps.find((step) => step.process_step_id === "step-b")!.body_json), /"textAlign":"right"/, "the toolbar must not edit a hidden step");
    await act(async () => render("reopened"));
    await waitFor(() => Boolean(stepCard("step-b")), "the saved local step did not reopen");
    assert.match(stepCard("step-b").textContent ?? "", /Ship instructions/);
    assert.doesNotMatch(stepCard("step-b").textContent ?? "", /Process purpose|Prepare instructions/);
    assert.match(editorRoot("step-b").innerHTML, /text-align: right/);
    assert.equal(dom.window.localStorage.length, 0, "local Process creation must remain unsaved until Save Process");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

test("saved Process instruction cards follow canonical step events and stop editing when Process access is removed", { timeout: 15_000 }, async () => {
  const dom = new JSDOM('<!doctype html><div id="saved-process-editor"></div>', { url: "http://saved-instructions.test/", pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    });
  };
  for (const name of ["window", "document", "navigator", "self", "Node", "NodeFilter", "Element", "HTMLElement", "DocumentFragment", "DOMParser", "Event", "EventTarget", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "InputEvent", "MutationObserver", "Range", "Selection", "localStorage", "sessionStorage"]) {
    install(name, name === "window" || name === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name]);
  }
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("IS_REACT_ACT_ENVIRONMENT", true);
  install("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0));
  install("cancelAnimationFrame", clearTimeout);
  install("indexedDB", indexedDB);
  install("IDBKeyRange", IDBKeyRange);
  const observers: Array<{ target?: Element; rootMargin: string; callback: IntersectionObserverCallback }> = [];
  install("IntersectionObserver", class {
    target?: Element;
    rootMargin: string;
    constructor(readonly callback: IntersectionObserverCallback, options: IntersectionObserverInit) { this.rootMargin = options.rootMargin ?? ""; observers.push(this); }
    observe(target: Element) { this.target = target; }
    disconnect() { this.target = undefined; }
  });
  const markNearViewport = (target: HTMLElement) => {
    const observer = observers.find((entry) => entry.target === target && entry.rootMargin === "600px 0px")!;
    assert.ok(observer, "the shared editor must install its normal viewport observer");
    observer.callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], observer as unknown as IntersectionObserver);
    const visibleObserver = observers.find((entry) => entry.target === target && entry.rootMargin === "0px")!;
    assert.ok(visibleObserver, "a visible Step editor must use the normal realtime subscription path");
    visibleObserver.callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], visibleObserver as unknown as IntersectionObserver);
  };
  install("WebSocket", class {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 0;
    close() { this.readyState = 3; }
    send() {}
  });
  const scrolledTargets: HTMLElement[] = [];
  const flashedTargets: HTMLElement[] = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolledTargets.push(this); };
  dom.window.HTMLElement.prototype.animate = function () { flashedTargets.push(this); return {} as Animation; };
  dom.window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
  const apiBase = "http://saved-instructions.test";
  const companyID = "saved-instructions-company";
  const processID = "44444444-4444-4444-8444-444444444444";
  const stepA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const stepB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const stepBMentionBody = body("Ship instructions");
  stepBMentionBody.document.content![0].content!.push({ type: "mention", attrs: { userId: "step-reader", label: "Step reader", kind: "urgent" } });
  let snapshot: ProcessWorkSnapshot = {
    logic_gate: { logic_gate_id: processID, header: "Saved Process" },
    permissions: { can_edit: true, can_resolve_requests: true },
    steps: [{ process_step_id: stepA, logic_gate_id: processID, name: "Prepare", position: 10, body_json: body("Initial step snapshot") }],
    relationships: [], nodes: [],
  };
  let denied = false;
  let reads = 0;
  install("fetch", async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(String(input), apiBase);
    if (url.pathname === "/v1/realtime/ticket") return new Response("{}", { headers: { "Content-Type": "application/json" } });
    assert.equal(options?.method ?? "GET", "GET");
    assert.equal(url.pathname, `/v2/logic-gates/${processID}/work`);
    reads++;
    return new Response(JSON.stringify(denied ? { error: "forbidden" } : snapshot), { status: denied ? 403 : 200, headers: { "Content-Type": "application/json" } });
  });
  const canonicalBodies = new Map([[stepA, body("Canonical Prepare instructions")], [stepB, body("Canonical Ship instructions")]]);
  const documentRequests: Array<{ path: string; method: string }> = [];
  let holdStepID = "";
  let pendingSaveStarted = false;
  let rejectPendingSave: ((cause: Error) => void) | undefined;
  const requestJSON = async <T,>(path: string, options?: RequestInit & { json?: unknown }): Promise<T> => {
    const method = options?.method ?? "GET";
    documentRequests.push({ path, method });
    const url = new URL(path, apiBase);
    const parts = url.pathname.split("/");
    const ownerType = parts[3];
    const ownerID = parts[4];
    const documentID = parts[6];
    assert.equal(url.searchParams.get("company_id"), companyID);
    assert.equal(parts[2], "editor-json");
    assert.equal(parts[5], "documents");
    if (ownerType === "process_step") {
      assert.equal(documentID, ownerID, "a step document must use the exact step UUID as both owner and document identity");
      assert.ok(canonicalBodies.has(ownerID));
    } else {
      assert.equal(ownerType, "logic_gate");
      assert.equal(ownerID, processID);
      assert.equal(documentID, "logic-gate-overview");
    }
    if (method === "POST") {
      assert.equal(snapshot.permissions.can_edit, true, "read-only instructions must never submit an autosave");
      if (ownerID === holdStepID) return new Promise<T>((_resolve, reject) => { pendingSaveStarted = true; rejectPendingSave = reject; });
      const commit = options!.json as { operation_id: string; document: MangoTiptapDocument };
      canonicalBodies.set(ownerID, commit.document);
      return { operation_id: commit.operation_id, revision: 1, committed_at: "2026-09-05T12:00:00Z" } as T;
    }
    assert.equal(method, "GET");
    return { revision: 0, schema_version: 1, document: canonicalBodies.get(ownerID) ?? body("Canonical overview"), annotations: [] } as T;
  };
  const [{ createRoot }, { LogicGateTiptapEditorSurface }, { dispatchLogicGateWorkUpdated, clearProcessWorkCache }, { flushMangoTiptapResource }] = await Promise.all([
    import("react-dom/client"), import("../../../../frontend/src/modules/editor/LogicGateTiptapEditorSurface.js"),
    import("../../../../frontend/src/modules/kanban/kanbanApi.js"), import("../../../../frontend/src/modules/editor/tiptap/mangoTiptapFlushRegistry.js"),
  ]);
  const container = dom.window.document.getElementById("saved-process-editor")!;
  const root = createRoot(container);
  const controllerRef: React.MutableRefObject<MangoTiptapFormattingController | null> = { current: null };
  const reportedErrors: string[] = [];
  const reportedSaveStates: string[] = [];
  const card = (id: string) => container.querySelector<HTMLElement>(`[data-process-step-id="${id}"]`);
  const refresh = async () => { await act(async () => { dispatchLogicGateWorkUpdated(companyID, processID); }); };
  try {
    await act(async () => root.render(<React.Suspense fallback={<div>Loading editor</div>}>
      <button onMouseDown={(event) => event.preventDefault()} onClick={() => controllerRef.current?.insertTable()}>Insert table</button>
      <LogicGateTiptapEditorSurface apiBase={apiBase} companyID={companyID} resourceID={processID} documentID="logic-gate-overview"
        focusInformationID={stepB} focusMentionUserID="step-reader" focusRequestID={1}
        value={JSON.stringify(body("Overview snapshot"))} editable requestJSON={requestJSON} formattingControllerRef={controllerRef}
        onError={(message) => reportedErrors.push(message)} onSaveStateChange={(state) => reportedSaveStates.push(state.status)} />
    </React.Suspense>));
    await waitFor(() => Boolean(card(stepA)), "saved Process steps did not load");
    assert.match(card(stepA)!.textContent ?? "", /Initial step snapshot/);
    const stepEditor = card(stepA)!.querySelector<HTMLElement>('[data-mango-editor-format="tiptap_json"]')!;
    await act(async () => { markNearViewport(stepEditor); Simulate.doubleClick(stepEditor); });
    await waitFor(() => reportedErrors.length > 0 || Boolean(stepEditor.querySelector(".mango-tiptap-prosemirror")), "saved step editor did not activate");
    assert.deepEqual(reportedErrors, [], "a visible Step editor must prepare and subscribe without an error");
    await act(async () => { stepEditor.querySelector<HTMLElement>(".mango-tiptap-prosemirror")!.focus(); });
    assert.match(stepEditor.textContent ?? "", /Canonical Prepare instructions/);
    assert.ok(documentRequests.some((request) => request.path.includes(`/editor-json/process_step/${stepA}/documents/${stepA}?`)));
    await act(async () => { controllerRef.current!.applyTextAlignment("right"); });
    await act(async () => { await flushMangoTiptapResource({ companyID, resourceType: "logic_gate", resourceID: processID }); });
    assert.match(JSON.stringify(canonicalBodies.get(stepA)), /"textAlign":"right"/);
    assert.equal(documentRequests.filter((request) => request.method === "POST").length, 1);

    assert.equal(scrolledTargets.length, 0, "a notification for an unloaded Step must wait for that exact Step");
    snapshot = { ...snapshot, steps: [...snapshot.steps, { process_step_id: stepB, logic_gate_id: processID, name: "Ship", position: 20, body_json: stepBMentionBody }] };
    await refresh();
    await waitFor(() => Boolean(card(stepB)), "creating a step did not add its instruction card");
    await waitFor(() => scrolledTargets.some((target) => target.getAttribute("data-mango-user-id") === "step-reader"), "a Step mention notification must scroll to its exact mention after the Step loads");
    assert.equal(flashedTargets.includes(card(stepB)!), true, "a Step mention notification must also highlight its instruction card");
    assert.equal(scrolledTargets.some((target) => target.closest("[data-process-step-id]")?.getAttribute("data-process-step-id") === stepA), false, "a Step notification must not focus another Step");
    const activeStepDOM = stepEditor.querySelector<TiptapEditorHTMLElement>(".mango-tiptap-prosemirror")!;
    const activeStepEditor = activeStepDOM.editor!;
    const activeStepController = controllerRef.current;
    await act(async () => {
      controllerRef.current!.applyTextAlignment("center");
      activeStepEditor.commands.insertContentAt(1, "Pending instructions. ");
    });
    const selectionBeforeRename = activeStepEditor.state.selection.toJSON();
    assert.match(stepEditor.textContent ?? "", /Pending instructions/);
    assert.equal(documentRequests.filter((request) => request.method === "POST").length, 1, "the rename must arrive while the edit is still pending");
    snapshot = { ...snapshot, steps: snapshot.steps.map((step) => step.process_step_id === stepA ? { ...step, name: "Prepare shipment" } : step) };
    await refresh();
    await waitFor(() => card(stepA)?.getAttribute("aria-label") === "Step 1: Prepare shipment", "renaming a step did not update its instruction heading");
    assert.equal(activeStepDOM === stepEditor.querySelector(".mango-tiptap-prosemirror"), true, "a canonical rename must preserve the active Step editor");
    assert.equal(controllerRef.current === activeStepController, true, "a rename must preserve the shared toolbar's editor");
    assert.equal(dom.window.document.activeElement === activeStepDOM, true, "a rename must preserve focus");
    assert.deepEqual(activeStepEditor.state.selection.toJSON(), selectionBeforeRename, "a rename must preserve the caret");
    assert.match(stepEditor.textContent ?? "", /Pending instructions/);
    await act(async () => { controllerRef.current!.insertTable(); });
    await act(async () => { await flushMangoTiptapResource({ companyID, resourceType: "logic_gate", resourceID: processID }); });
    assert.match(JSON.stringify(canonicalBodies.get(stepA)), /Pending instructions/, "the next edit after a rename must save the pending text");
    assert.match(JSON.stringify(canonicalBodies.get(stepA)), /"textAlign":"center"/, "the next edit after a rename must save the pending formatting");
    assert.equal(activeStepEditor.can().undo(), true, "a rename must preserve undo history");
    holdStepID = stepA;
    await act(async () => { controllerRef.current!.applyTextAlignment("center"); });
    const removedStepSave = assert.rejects(flushMangoTiptapResource({ companyID, resourceType: "logic_gate", resourceID: processID }), /removed_step_save/);
    await waitFor(() => pendingSaveStarted, "the edited step save did not begin before deletion");
    snapshot = { ...snapshot, steps: snapshot.steps.filter((step) => step.process_step_id !== stepA) };
    await refresh();
    await waitFor(() => !card(stepA) && card(stepB)?.getAttribute("aria-label") === "Step 1: Ship", "deleting a step did not remove its card and renumber surviving steps");
    const errorsAfterRemoval = reportedErrors.length;
    const statesAfterRemoval = reportedSaveStates.length;
    await act(async () => { rejectPendingSave!(new Error("removed_step_save")); await removedStepSave; });
    assert.equal(reportedErrors.length, errorsAfterRemoval, "a deleted step's late failed save must not set the Process error");
    assert.equal(reportedSaveStates.slice(statesAfterRemoval).includes("failed"), false, "a deleted step's late failed save must not fail the surviving Process save status");

    snapshot = { ...snapshot, permissions: { can_edit: false, can_resolve_requests: false } };
    await refresh();
    await waitFor(() => !card(stepB)?.querySelector('[data-mango-editor-editable="true"]'), "read-only Process retained an editable step");
    const readOnlyEditor = card(stepB)!.querySelector<HTMLElement>('[data-mango-editor-format="tiptap_json"]')!;
    await act(async () => { markNearViewport(readOnlyEditor); Simulate.doubleClick(readOnlyEditor); });
    await waitFor(() => Boolean(readOnlyEditor.querySelector('.mango-tiptap-prosemirror[contenteditable="false"]')), "read-only instructions did not mount with editing disabled");
    await act(async () => { readOnlyEditor.querySelector<HTMLElement>(".mango-tiptap-prosemirror")!.focus(); Simulate.click(container.querySelector("button")!); });
    assert.equal(controllerRef.current, null, "read-only instructions must not hand a writable editor to the shared toolbar");
    assert.equal(container.querySelector('[contenteditable="true"]'), null);
    await act(async () => { await flushMangoTiptapResource({ companyID, resourceType: "logic_gate", resourceID: processID }); });
    assert.equal(documentRequests.filter((request) => request.method === "POST").length, 3, "read-only selection and toolbar interaction must not autosave");
    denied = true;
    await refresh();
    await waitFor(() => Boolean(container.querySelector('[role="alert"]')) && !card(stepB), "denied Process must hide previously loaded step contents");
    assert.ok(reads >= 5);

    denied = false;
    snapshot = { ...snapshot, permissions: { can_edit: true, can_resolve_requests: true } };
    await refresh();
    await waitFor(() => Boolean(card(stepB)), "restored access did not reopen the Process instruction card");
    const restoredEditor = card(stepB)!.querySelector<HTMLElement>('[data-mango-editor-format="tiptap_json"]')!;
    await act(async () => { markNearViewport(restoredEditor); Simulate.doubleClick(restoredEditor); });
    await waitFor(() => Boolean(restoredEditor.querySelector(".mango-tiptap-prosemirror")), "the remaining step did not reactivate");
    await act(async () => { restoredEditor.querySelector<HTMLElement>(".mango-tiptap-prosemirror")!.focus(); });
    holdStepID = stepB;
    pendingSaveStarted = false;
    await act(async () => { controllerRef.current!.applyTextAlignment("center"); });
    const unmountedStepSave = assert.rejects(flushMangoTiptapResource({ companyID, resourceType: "logic_gate", resourceID: processID }), /unmounted_process_save/);
    await waitFor(() => pendingSaveStarted, "the remaining step save did not begin before navigation");
    await act(async () => root.render(null));
    const errorsAfterUnmount = reportedErrors.length;
    const statesAfterUnmount = reportedSaveStates.length;
    await act(async () => { rejectPendingSave!(new Error("unmounted_process_save")); await unmountedStepSave; });
    assert.equal(reportedErrors.length, errorsAfterUnmount, "an old Process must not report errors after its editor unmounts");
    assert.equal(reportedSaveStates.length, statesAfterUnmount, "an old Process must not overwrite another Process's save status after navigation");
  } finally {
    rejectPendingSave?.(new Error("test_cleanup"));
    await act(async () => root.unmount());
    clearProcessWorkCache(apiBase, companyID, processID);
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});
