import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import type { ProcessMapDetailsContents } from "../../../../frontend/src/pages/process-map/ProcessMapDetails.js";

test("the open Process editor preserves document identity, Step cards, inherited RACI, and read-only access", async () => {
  const { IDBKeyRange, indexedDB } = createRequire(resolve("frontend/package.json"))("fake-indexeddb");
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://process-details.test/", pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (prior) Object.defineProperty(globalThis, name, prior); else delete (globalThis as Record<string, unknown>)[name]; });
  };
  for (const name of ["window", "document", "navigator", "self", "Node", "NodeFilter", "Element", "HTMLElement", "HTMLInputElement", "HTMLDivElement", "HTMLSpanElement", "HTMLButtonElement", "DocumentFragment", "DOMParser", "Event", "EventTarget", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "InputEvent", "MutationObserver", "Range", "Selection", "localStorage", "sessionStorage"]) install(name, name === "window" || name === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name]);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
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
  const markNearViewport = (target: Element) => {
    const observer = observers.find((entry) => entry.target === target && entry.rootMargin === "600px 0px");
    assert.ok(observer);
    observer.callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], observer as unknown as IntersectionObserver);
  };
  dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  dom.window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
  const requests: Array<{ path: string; method: string }> = [];
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const body = { format: "mango-tiptap-json", schema_version: 1, document: { type: "doc", content: [{ type: "paragraph" }] } };
  const steps = [{ process_step_id: "step-one", logic_gate_id: "new-process", name: "Prepare", position: 1000 }];
  let failNextSave = false;
  let holdRetrySave = false;
  let releaseRetrySave: (() => void) | undefined;
  let savedStepBody: unknown;
  install("fetch", async (input: string, options?: RequestInit) => {
    const url = new URL(input, "http://process-details.test");
    const method = options?.method ?? "GET";
    requests.push({ path: url.pathname, method });
    if (url.pathname === "/v1/realtime/ticket") return response({});
    if (url.pathname.endsWith("/users")) return response({ users: [] });
    if (url.pathname.endsWith("/view")) return response({ can_edit: !url.pathname.includes("readonly"), logic_gate: { logic_gate_id: url.pathname.split("/")[3], header: "Procedure" }, information: [], projections: [{ information_id: "existing-sop", type: "Text box", information: "", updated_timestamp: "2026-09-05" }] });
    if (url.pathname.endsWith("/work")) return response({ logic_gate: { logic_gate_id: url.pathname.split("/")[3], header: "Procedure" }, permissions: { can_edit: !url.pathname.includes("readonly"), can_resolve_requests: false }, steps: steps.map((step) => ({ ...step, logic_gate_id: url.pathname.split("/")[3] })), relationships: [], nodes: [] });
    if (url.pathname.startsWith("/v1/editor-json/")) {
      if (method === "POST") {
        assert.equal(url.pathname, "/v1/editor-json/process_step/step-one/documents/step-one", "Step instructions use their canonical editor identity");
        if (failNextSave) { failNextSave = false; return response({ error: "Test Step save failed" }, 500); }
        if (holdRetrySave) await new Promise<void>((resolveSave) => { releaseRetrySave = resolveSave; });
        const commit = JSON.parse(String(options?.body));
        savedStepBody = commit.document;
        return response({ operation_id: commit.operation_id, revision: 2, committed_at: "2026-09-07T12:00:00Z" });
      }
      assert.equal(method, "GET");
      return response({ revision: 1, schema_version: 1, document: body });
    }
    assert.fail(`Unexpected request ${method} ${url.pathname}`);
  });
  const [{ createRoot }, { ProcessMapDetails }] = await Promise.all([
    import("react-dom/client"), import("../../../../frontend/src/pages/process-map/ProcessMapDetails.js"),
  ]);
  const root = createRoot(dom.window.document.getElementById("root")!);
  let contents: ProcessMapDetailsContents = {};
  let busy = true;
  const render = (processID: string, isNew: boolean, focusStepID?: string, refreshVersion = 0) => root.render(<ProcessMapDetails key={processID} apiBase="http://process-details.test" companyID="details-company" processID={processID} isNew={isNew} steps={isNew ? steps : undefined} focusStepID={focusStepID} refreshVersion={refreshVersion} onChange={(next) => { contents = next; }} onBusyChange={(next) => { busy = next; }} />);
  const settle = async (predicate: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      if (Date.now() > deadline) assert.fail(dom.window.document.body.textContent ?? "did not settle");
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
  };
  const stepsTab = () => [...dom.window.document.querySelectorAll<HTMLButtonElement>('[aria-label="Process editor sections"] button')].find((tab) => tab.textContent === "Steps")!;
  const editorTab = () => [...stepsTab().parentElement!.querySelectorAll<HTMLButtonElement>("button")].find((tab) => tab.textContent === "Editor")!;
  const editorDocument = (id: string) => dom.window.document.querySelector(`[data-process-sop-document-id="${id}"]`);
  try {
    await act(async () => render("new-process", true));
    await settle(() => !busy && Boolean(editorDocument("logic-gate-overview")));
    assert.equal(Object.hasOwn(contents, "gvic_assignments"), false, "removing RACI controls must preserve live Folder inheritance");
    assert.equal(dom.window.document.querySelector('[data-raci-add-principal], .process-map-details__toggle'), null);
    assert.equal(editorTab().getAttribute("aria-pressed"), "true");
    const overview = editorDocument("logic-gate-overview");
    const stepCard = dom.window.document.querySelector('[data-process-step-id="step-one"]');
    assert.ok(stepCard, "the existing Step instruction card must be mounted");
    await act(async () => render("new-process", true, "step-one"));
    await settle(() => stepsTab().getAttribute("aria-pressed") === "true");
    assert.equal(editorDocument("logic-gate-overview"), overview, "opening Steps preserves the overview editor and its pending text");
    assert.equal(dom.window.document.querySelector('[data-process-step-id="step-one"]'), stepCard);
    await act(async () => editorTab().click());
    assert.equal(editorTab().getAttribute("aria-pressed"), "true");
    assert.equal(dom.window.document.querySelector('[data-process-step-id="step-one"]'), stepCard, "returning to Editor preserves the Step editor");
    assert.equal(requests.some((request) => request.method !== "GET"), false, "the new Process remains local until Save");

    await act(async () => render("saved-process", false));
    await settle(() => !busy && Boolean(editorDocument("existing-sop")) && Boolean(dom.window.document.querySelector('[data-process-step-id="step-one"]')));
    const savedEditor = editorDocument("existing-sop");
    assert.doesNotMatch(dom.window.document.body.textContent ?? "", /Could not load the Process steps/);
    await act(async () => render("saved-process", false, undefined, 1));
    await settle(() => !busy);
    assert.equal(editorDocument("existing-sop"), savedEditor, "canonical refresh retains the exact existing SOP editor");
    await act(async () => stepsTab().click());
    const savedStep = dom.window.document.querySelector<HTMLElement>('[data-process-step-id="step-one"] [data-mango-editor-format="tiptap_json"]')!;
    await act(async () => { markNearViewport(savedStep); savedStep.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true })); });
    await settle(() => Boolean(savedStep.querySelector(".mango-tiptap-prosemirror")));
    const activeStep = savedStep.querySelector<TiptapEditorHTMLElement>(".mango-tiptap-prosemirror")!;
    failNextSave = true;
    holdRetrySave = true;
    await act(async () => { activeStep.focus(); activeStep.editor!.commands.insertContentAt(1, "Retry these instructions."); });
    await settle(() => Boolean(dom.window.document.querySelector(".process-map-details__error")));
    assert.match(savedStep.textContent ?? "", /Retry these instructions/, "a failed save keeps the Step's pending instructions");
    const retryButton = dom.window.document.querySelector<HTMLButtonElement>(".process-map-details__error button")!;
    await act(async () => retryButton.click());
    await settle(() => Boolean(releaseRetrySave));
    assert.equal(busy, true, "retry keeps navigation blocked until the server acknowledges the Step save");
    await act(async () => { releaseRetrySave!(); });
    await settle(() => !busy);
    assert.equal(dom.window.document.querySelector(".process-map-details__error"), null, "a successful Retry clears the Process error");
    assert.match(JSON.stringify(savedStepBody), /Retry these instructions/, "Retry saves the original pending Step text");
    assert.equal(requests.filter((request) => request.path.startsWith("/v1/editor-json/") && request.method === "POST").length, 2, "one failed save and one Retry use the same editor command");
    await act(async () => render("readonly-process", false));
    await settle(() => !busy && Boolean(editorDocument("existing-sop")));
    const bold = dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="Bold"]');
    assert.ok(bold);
    assert.equal(bold.disabled, true, "the map respects the existing Process edit permission");
    assert.equal(requests.some((request) => request.path.endsWith("/gvic") || request.path.endsWith("/user-groups")), false, "the editor must not read or change hidden RACI assignments");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});
