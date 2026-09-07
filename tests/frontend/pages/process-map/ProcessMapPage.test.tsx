import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import type { WorkspaceProcessDefinition } from "../../../../frontend/src/modules/workspace/workspaceEntityCommands.js";
import { readProcessMapDeckGLTestProps, resetProcessMapDeckGLTestStub } from "../../modules/process-map/processMapDeckGLTestStub.js";
import { resetProcessMapRealtimeTestStub } from "../../modules/process-map/processMapRealtimeTestStub.js";
import { EVENT_COMPANY_EXPLORER_PROCESS_CREATED } from "../../../../frontend/src/modules/dashboardEvents.js";

const companyID = "11111111-1111-4111-8111-111111111111";
const parentFolderID = "22222222-2222-4222-8222-222222222222";
const childFolderID = "33333333-3333-4333-8333-333333333333";
type Batch = { company_id: string; entity_kind: string; folder_id: string; mutation_origin: string; items: Array<{ client_id: string; title: string }>; relationships: unknown[]; process_definition: WorkspaceProcessDefinition };
type Request = { path: string; method: string; body: Record<string, any> };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
async function settle(condition: () => boolean, message: string) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(message);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}
let fixtureNumber = 0;

async function harness(reducedMotion = false) {
  const { IDBKeyRange, indexedDB } = createRequire(resolve("frontend/package.json"))("fake-indexeddb");
  const apiBase = `http://process-page-${++fixtureNumber}.test`;
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: apiBase, pretendToBeVisual: true });
  // Expose standard animation events so React does not register a vendor-prefixed name in jsdom.
  Object.defineProperty(dom.window, "AnimationEvent", { value: dom.window.Event });
  const motionQuery = Object.assign(new dom.window.EventTarget(), { media: "(prefers-reduced-motion: reduce)", matches: reducedMotion, onchange: null, addListener() {}, removeListener() {} });
  dom.window.matchMedia = (media) => (media === motionQuery.media ? motionQuery : Object.assign(new dom.window.EventTarget(), { media, matches: false, onchange: null, addListener() {}, removeListener() {} })) as MediaQueryList;
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete (globalThis as Record<string, unknown>)[name]; });
  };
  for (const name of ["window", "self", "document", "navigator", "sessionStorage", "localStorage", "Node", "NodeFilter", "Text", "Element", "HTMLElement", "HTMLInputElement", "DocumentFragment", "DOMParser", "Event", "EventTarget", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "InputEvent", "MutationObserver", "Range", "Selection"]) {
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
    constructor(readonly callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) { this.rootMargin = options.rootMargin ?? ""; observers.push(this); }
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
  resetProcessMapDeckGLTestStub();
  resetProcessMapRealtimeTestStub();
  const folders = [
    { company_id: companyID, folder_id: parentFolderID, parent_folder_id: "", folder_kind: "logic_gate", name: "Operations", position: 1000 },
    { company_id: companyID, folder_id: childFolderID, parent_folder_id: parentFolderID, folder_kind: "logic_gate", name: "Orders", position: 1000 },
  ];
  const requests: Request[] = [], opened: Array<{ id: string; label: string }> = [], revealed: Array<{ processID: string; folderPathIDs: string[]; response?: unknown }> = [];
  dom.window.addEventListener(EVENT_COMPANY_EXPLORER_PROCESS_CREATED, (event) => revealed.push((event as CustomEvent).detail));
  const workReads: Array<{ path: string; cache?: RequestCache }> = [];
  const saved = new Map<string, Batch>();
  const state = { companyID, active: true, batchStatus: 200, editorSaveStatus: 200, commitThenFail: false, recoveryFolderID: childFolderID, holdBatch: false, releaseBatch: null as (() => void) | null };
  install("fetch", async (input: string, options?: RequestInit) => {
    const url = new URL(input, apiBase);
    const request = { path: url.pathname, method: options?.method ?? "GET", body: options?.body ? JSON.parse(String(options.body)) : {} };
    requests.push(request);
    if (/^\/v1\/companies\/[^/]+\/users$/.test(request.path)) return reply({ users: [] });
    if (request.path.startsWith("/v1/editor-json/")) {
      if (request.method === "POST") return state.editorSaveStatus === 200
        ? reply({ operation_id: request.body.operation_id, revision: 2, committed_at: "2026-09-07T12:00:00Z" })
        : reply({ error: "Could not save Process instructions" }, state.editorSaveStatus);
      assert.equal(request.method, "GET");
      return reply({ revision: 1, schema_version: 1, document: { format: "mango-tiptap-json", schema_version: 1, document: { type: "doc", content: [{ type: "paragraph" }] } } });
    }
    if (request.path === "/v1/process-map/scene" || request.path === "/v1/process-map/changes") return reply({ bounds: null, process_map_read_version: 1, tile_size: 256, min_tile_zoom: 0, max_tile_zoom: 22, validated_tiles: [], protected_geometry_changed: false });
    const tile = request.path.match(/^\/v1\/process-map\/tiles\/(\d+)\/(-?\d+)\/(-?\d+)$/);
    if (tile) return reply({ z: Number(tile[1]), x: Number(tile[2]), y: Number(tile[3]), process_map_read_version: 1, placements: [], traces: [] });
    if (request.path === "/v1/company-explorer/folders") {
      if (request.method === "GET") return reply({ folders: folders.map((folder) => ({ ...folder, company_id: state.companyID })) });
      assert.equal(request.method, "POST");
      const folder = { ...request.body, folder_id: "44444444-4444-4444-8444-444444444444", folder_kind: "logic_gate", position: 2000 };
      folders.push(folder as typeof folders[number]);
      return reply({ company_id: folder.company_id, entity_id: folder.folder_id, entity_type: "folder", parent_entity_id: folder.parent_folder_id, name: folder.name, position: folder.position, created_timestamp: "2026-09-04T00:00:00Z", updated_timestamp: "2026-09-04T00:00:00Z" }, 201);
    }
    if (request.path === "/v1/workspace/entity-batches") {
      assert.equal(request.method, "POST");
      if (state.holdBatch) await new Promise<void>((resolve) => { state.releaseBatch = resolve; });
      const batch = request.body as Batch;
      if (saved.has(batch.process_definition.logic_gate_id)) return reply({ error: "process_definition_already_exists" }, 409);
      if (state.batchStatus !== 200 && !state.commitThenFail) return reply({ error: "Could not save this Process" }, state.batchStatus);
      saved.set(batch.process_definition.logic_gate_id, structuredClone(batch));
      if (state.commitThenFail) return reply({ error: "Save response unavailable" }, 500);
      return reply({ logic_gates: [{ company_id: state.companyID, logic_gate_id: batch.process_definition.logic_gate_id, header: batch.items[0].title }], folder_items: [{ company_id: state.companyID, folder_id: batch.folder_id, item_type: "logic_gate", item_id: batch.process_definition.logic_gate_id }] }, 201);
    }
    if (request.path === "/v1/company-explorer/location-path") {
      assert.equal(request.method, "GET");
      assert.equal(options?.cache, "no-store", "recovery must resolve the current destination afresh");
      assert.equal(url.searchParams.get("company_id"), state.companyID);
      assert.equal(url.searchParams.get("resource_type"), "logic_gate");
      const batch = saved.get(url.searchParams.get("resource_id")!);
      assert.ok(batch, "location lookup must use the exact saved Process identity");
      const path = folders.filter((folder) => folder.folder_id === parentFolderID || folder.folder_id === state.recoveryFolderID);
      return reply({ kind: "company_explorer", status: "resolved", segments: [...path.map((folder) => ({ entity_type: "folder", entity_id: folder.folder_id, name: folder.name })), { entity_type: "logic_gate", entity_id: batch.process_definition.logic_gate_id, name: batch.items[0].title }] });
    }
    const process = request.path.match(/^\/v2\/logic-gates\/([^/]+)\/(work|step-map|steps|view)$/);
    if (process) {
      if (process[2] === "work") workReads.push({ path: request.path, cache: options?.cache });
      const batch = saved.get(process[1]);
      assert.ok(batch, "saved map must use the exact committed Process UUID");
      const definition = batch.process_definition;
      if (process[2] === "view") return reply({ logic_gate: { company_id: state.companyID, logic_gate_id: process[1], header: batch.items[0].title, can_edit: true }, can_edit: true, information: [] });
      if (process[2] === "steps") {
        assert.equal(request.method, "POST");
        assert.equal(request.body.company_id, state.companyID);
        const step = { process_step_id: crypto.randomUUID(), name: request.body.name as string };
        definition.steps.push(step);
        return reply({ step: { ...step, logic_gate_id: process[1], position: definition.steps.length * 1000 } }, 201);
      }
      assert.equal(request.method, "GET", "draft geometry must only be written in the one batch");
      return reply(process[2] === "step-map" ? { revision: 1, ...definition.layout } : {
        logic_gate: { logic_gate_id: process[1], header: batch.items[0].title },
        permissions: { can_edit: true, can_resolve_requests: false },
        steps: definition.steps.map((step, index) => ({ ...step, logic_gate_id: process[1], position: (index + 1) * 1000 })),
        relationships: definition.relationships, nodes: [],
      });
    }
    assert.fail(`Unexpected request ${request.method} ${request.path}`);
  });
  const [{ createRoot }, { ProcessMapPage }] = await Promise.all([import("react-dom/client"), import("../../../../frontend/src/pages/process-map/ProcessMapPage.js")]);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const onOpenLogicGate = (id: string, label: string) => { opened.push({ id, label }); };
  const render = async () => { await act(async () => root.render(<ProcessMapPage apiBase={apiBase} companyID={state.companyID} active={state.active} onOpenLogicGate={onOpenLogicGate} />)); await flush(); };
  const findButton = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((element) => !element.closest('[aria-hidden="true"], [inert]') && (element.textContent === label || element.getAttribute("aria-label") === label));
  const button = (label: string) => { const element = findButton(label); assert.ok(element, `Missing visible button ${label}`); return element; };
  const click = async (label: string) => { await act(async () => button(label).click()); await flush(); };
  const input = async (selector: string, value: string) => {
    const isProcessName = selector === '[placeholder="Untitled Process"]';
    if (isProcessName && !dom.window.document.querySelector(selector)) await click("Name Process");
    const element = dom.window.document.querySelector<HTMLInputElement>(selector);
    assert.ok(element, `Missing input ${selector}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    if (isProcessName) await key(element, "Enter");
  };
  const key = async (element: Element, value: string) => { await act(async () => element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }))); await flush(); };
  const renameStep = async (name: string) => {
    if (!container.querySelector('[aria-label="Step name"]')) {
      const title = container.querySelector('.process-step-map__step.is-selected .process-step-map__step-title');
      assert.ok(title, "select the Step to rename");
      await key(title, "F2");
    }
    await input('[aria-label="Step name"]', name);
    await key(container.querySelector('[aria-label="Step name"]')!, "Enter");
  };
  const pointer = async (element: Element, type: string, x: number, y: number) => { await act(async () => element.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }))); };
  const animationEnd = async (element: Element, name = "process-map-exit") => {
    const event = new dom.window.Event("animationend", { bubbles: true });
    Object.defineProperty(event, "animationName", { value: name });
    await act(async () => element.dispatchEvent(event));
    await flush();
  };
  const finishExit = async () => {
    const outgoing = container.querySelector(".process-map-focus.is-exiting");
    assert.ok(outgoing, "the outgoing Process must remain mounted for its exit animation");
    await animationEnd(outgoing);
    assert.equal(outgoing.isConnected, false, "the Process exit animation must release the outgoing view");
  };
  const setReducedMotion = async (matches: boolean) => {
    motionQuery.matches = matches;
    await act(async () => motionQuery.dispatchEvent(new dom.window.Event("change")));
    await flush();
  };
  const cards = () => [...container.querySelectorAll<HTMLElement>("[data-step-map-id]")];
  const preventsUnload = () => {
    const event = new dom.window.Event("beforeunload", { cancelable: true });
    dom.window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const mutations = () => requests.filter((request) => request.method !== "GET" && request.path !== "/v1/process-map/changes");
  const batches = () => requests.filter((request) => request.path === "/v1/workspace/entity-batches").map((request) => request.body as Batch);
  const reopenSaved = async () => {
    const batch = batches()[0];
    const processID = batch.process_definition.logic_gate_id;
    await act(async () => readProcessMapDeckGLTestProps().onClick({ object: { kind: "placement", key: `logic_gate:${processID}`, placement: { restricted: false, presentation: "full", resource_type: "logic_gate", resource_id: processID, name: batch.items[0].title, map_parent_folder_id: batch.folder_id, grid_x: 0, grid_y: 0, grid_width: 8, grid_height: 5, can_edit: true, revision: 1, created_timestamp: "", updated_timestamp: "" } } }, { type: "dblclick" }));
    await settle(() => Boolean(container.querySelector('[aria-label="Saved Process map"]')) && findButton("+ Create Step")?.disabled === false && findButton("← Company map")?.disabled === false, "saved Process did not finish opening");
  };
  const chooseFolder = async () => { await click("Choose Folder"); await click("Open Operations"); await click("Open Orders"); await click("Use this Folder"); };
  const start = async (firstStep = false) => {
    await click(firstStep ? "+ Create Step" : "+ Create Process");
    await settle(() => findButton("+ Create Step")?.disabled === false && findButton("Choose Folder")?.disabled === false, "draft did not finish loading");
  };
  const dispose = async () => { await act(async () => root.unmount()); resetProcessMapDeckGLTestStub(); resetProcessMapRealtimeTestStub(); restores.reverse().forEach((restore) => restore()); dom.window.close(); };
  await render();
  return { dom, container, state, requests, workReads, opened, revealed, render, findButton, button, click, input, key, renameStep, pointer, animationEnd, finishExit, setReducedMotion, cards, preventsUnload, mutations, batches, reopenSaved, chooseFolder, start, dispose, markNearViewport };
}

test("Process Map authors Steps and connections locally and saves their exact identities and geometry in one batch", async () => {
  const h = await harness();
  try {
    await h.start();
    assert.ok(h.container.querySelector('[aria-label="New Process map"].process-map-workspace'));
    assert.ok(h.container.querySelector('.process-map-company-canvas[aria-hidden="true"][inert]'));
    assert.ok(h.container.querySelector('[aria-label="Process outline: Untitled Process"]'), "an empty draft must already have its Process boundary");
    assert.equal(h.cards().length, 0);
    assert.deepEqual(h.opened, []);
    assert.equal(h.mutations().length, 0);
    assert.equal(h.container.querySelector(".process-map-page__actions, .process-map-details__toggle, [data-raci-add-principal]"), null);
    assert.ok(h.container.querySelector('[aria-label="Process SOP editor"]'), "the Process editor opens without a disclosure button");
    assert.match(h.container.querySelector(".process-step-map__empty")!.textContent!, /Start this process with a right-click or by pressing the plus button\./);
    assert.equal(h.button("Save Process").disabled, true);
    await h.input('[placeholder="Untitled Process"]', "  Order fulfilment  ");
    assert.equal(h.button("Save Process").disabled, true, "a Process requires an existing Folder");
    assert.ok(h.container.querySelector('[aria-label="Process outline: Order fulfilment"]'), "the outline must use the current draft name");
    await h.chooseFolder();
    assert.match(h.container.querySelector('[aria-label="Destination path"]')!.textContent!, /Workspace\/Operations\/Orders/);
    await h.click("+ Create Step");
    await h.renameStep("Receive order");
    await h.click("+ Create Step");
    await h.renameStep("Ship order");
    const [sourceID, targetID] = h.cards().map((card) => card.dataset.stepMapId!);
    const move = h.button("Move Receive order");
    await h.pointer(move, "pointerdown", 100, 100);
    await h.pointer(move, "pointermove", 132, 116);
    assert.equal(h.button("Save Process").disabled, true, "outer Save must wait for the active gesture");
    await h.pointer(move, "pointerup", 132, 116);
    await flush();
    await h.key(h.button("Resize Receive order"), "ArrowRight");
    const output = h.button("Connect from Receive order"), input = h.button("Connect into Ship order");
    const viewport = h.container.querySelector(".process-step-map__viewport")!;
    Object.defineProperty(h.dom.window.document, "elementFromPoint", { configurable: true, value: () => input });
    await h.pointer(output, "pointerdown", 224, 108);
    await h.pointer(viewport, "pointermove", 384, 92);
    assert.ok(h.container.querySelector(".process-step-map__connection-preview"));
    assert.ok(input.classList.contains("is-connection-target"));
    assert.equal(h.button("Save Process").disabled, true, "outer Save must wait for the connection gesture");
    await h.click("Save Process");
    assert.equal(h.batches().length, 0, "a connection in progress cannot be omitted by saving early");
    await h.pointer(viewport, "pointerup", 384, 92);
    await flush();
    assert.equal(h.container.querySelector(".process-step-map__connection-preview"), null);
    assert.ok(h.container.querySelector('[aria-label="Connection from Receive order to Ship order"]'));
    assert.equal(h.button("Save Process").disabled, false);
    assert.equal(h.mutations().length, 0, "names, Steps, connections and gestures must all remain local before Save");
    await h.click("Save Process");
    await settle(() => Boolean(h.container.querySelector('.process-map-focus.is-exiting')), "Save did not start the return animation");
    await h.finishExit();
    assert.equal(h.batches().length, 1);
    assert.equal(h.mutations().length, 1, "Save must not issue placement or individual Step writes");
    const batch = h.batches()[0], definition = batch.process_definition;
    assert.equal(Object.hasOwn(definition, "gvic_assignments"), false, "Save must omit RACI overrides to retain live Folder inheritance");
    assert.deepEqual(Object.keys(batch).sort(), ["company_id", "entity_kind", "folder_id", "items", "mutation_origin", "process_definition", "relationships"]);
    assert.equal(batch.company_id, companyID);
    assert.equal(batch.entity_kind, "logic_gate");
    assert.equal(batch.folder_id, childFolderID);
    assert.equal(batch.mutation_origin, "company_explorer");
    assert.deepEqual(batch.items, [{ client_id: definition.logic_gate_id, title: "Order fulfilment" }]);
    assert.match(definition.logic_gate_id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(batch.relationships, []);
    assert.deepEqual(definition.steps, [{ process_step_id: sourceID, name: "Receive order" }, { process_step_id: targetID, name: "Ship order" }]);
    assert.equal(definition.relationships.length, 1);
    const relationship = definition.relationships[0];
    assert.match(relationship.resource_operational_relationship_id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(relationship, { resource_operational_relationship_id: relationship.resource_operational_relationship_id, source: { resource_type: "process_step", resource_id: sourceID }, target: { resource_type: "process_step", resource_id: targetID } });
    assert.deepEqual(definition.layout.steps.find((box) => box.process_step_id === sourceID), { process_step_id: sourceID, x: 96, y: 80, width: 272, height: 80 });
    assert.deepEqual(definition.layout.routes, []);
    assert.equal(h.cards().length, 0, "Save returns to the company map");
    assert.deepEqual(h.revealed.map(({ processID, folderPathIDs }) => ({ processID, folderPathIDs })), [{ processID: definition.logic_gate_id, folderPathIDs: [parentFolderID, childFolderID] }]);
    await h.reopenSaved();
    assert.deepEqual(h.cards().map((card) => card.dataset.stepMapId), [sourceID, targetID]);
    assert.equal(h.cards()[0].style.left, "96px");
    assert.equal(h.cards()[0].style.width, "272px");
    assert.ok(h.container.querySelector('[aria-label="Connection from Receive order to Ship order"]'), "the same directed connection must survive the saved-map reload");
    assert.equal(h.container.querySelector('[aria-label="New Process map"]'), null);
    assert.deepEqual(h.opened, [], "opening the Process on the map does not open Board / SOP");
    assert.ok(h.container.querySelector('[aria-label="Process outline: Order fulfilment"]'), "saving must retain the named Process boundary");
    await h.click("Open Board / SOP");
    await settle(() => h.opened.length === 1, "Open Board / SOP did not finish flushing the editors");
    assert.deepEqual(h.opened, [{ id: definition.logic_gate_id, label: "Order fulfilment" }]);
  } finally { await h.dispose(); }
});

test("Open Board / SOP flushes pending instructions and preserves the map when an earlier save failed", async () => {
  const h = await harness();
  try {
    await h.start();
    await h.input('[placeholder="Untitled Process"]', "Save before opening Board");
    await h.chooseFolder();
    await h.click("Save Process");
    await settle(() => Boolean(h.container.querySelector('.process-map-focus.is-exiting')), "Save did not return to the company map");
    await h.finishExit();
    await h.reopenSaved();
    const overview = h.container.querySelector<HTMLElement>('[data-process-sop-document-id="logic-gate-overview"]')!;
    assert.ok(overview);
    await act(async () => { h.markNearViewport(overview); });
    await act(async () => { overview.dispatchEvent(new h.dom.window.MouseEvent("dblclick", { bubbles: true })); });
    await settle(() => Boolean(overview.querySelector(".mango-tiptap-prosemirror")), "saved overview did not activate");
    const activeEditor = overview.querySelector<TiptapEditorHTMLElement>(".mango-tiptap-prosemirror")!;
    h.state.editorSaveStatus = 500;
    await act(async () => { activeEditor.focus(); activeEditor.editor!.commands.insertContentAt(1, "Keep these Process instructions."); });
    await settle(() => Boolean(h.container.querySelector(".process-map-details__error")) && h.findButton("Open Board / SOP")?.disabled === false, "the failed autosave did not leave recovery controls available");
    await h.click("Open Board / SOP");
    await settle(() => h.findButton("Open Board / SOP")?.disabled === false, "the failed flush did not restore the Open Board control");
    assert.deepEqual(h.opened, [], "an unsuccessful flush must not open a second editor with unsaved instructions");
    assert.ok(h.container.querySelector('[aria-label="Saved Process map"]'));
    assert.match(overview.textContent ?? "", /Keep these Process instructions/);
    h.state.editorSaveStatus = 200;
    await h.click("Open Board / SOP");
    await settle(() => h.opened.length === 1, "the Board did not open after a successful instruction save");
    const writes = h.requests.filter((request) => request.path.startsWith("/v1/editor-json/") && request.method === "POST");
    assert.ok(writes.length >= 3, "the action must flush again after the initial failed autosave");
    assert.match(JSON.stringify(writes.at(-1)!.body.document), /Keep these Process instructions/);
    assert.equal(h.opened[0].id, h.batches()[0].process_definition.logic_gate_id);
  } finally { await h.dispose(); }
});

test("Create Step seeds a draft and failed Save keeps UUIDs and edits while pending Save rejects double submission", async () => {
  const h = await harness();
  try {
    await h.start(true);
    assert.equal(h.cards().length, 1);
    const initialName = h.cards()[0].querySelector<HTMLInputElement>('[aria-label="Step name"]');
    assert.ok(initialName, "Create Step on the company map must open inline naming in its new draft");
    assert.equal(h.dom.window.document.activeElement, initialName);
    assert.equal(initialName.selectionStart, 0);
    assert.equal(initialName.selectionEnd, initialName.value.length);
    assert.equal(h.cards()[0].style.width, "256px");
    assert.equal(h.cards()[0].style.height, "80px");
    const stepID = h.cards()[0].dataset.stepMapId;
    await h.input('[placeholder="Untitled Process"]', "Payment approval");
    await h.chooseFolder();
    await h.click("Move New Step");
    await h.renameStep("Check payment");
    await h.key(h.button("Move Check payment"), "ArrowDown");
    h.state.batchStatus = 500;
    await h.click("Save Process");
    await settle(() => h.container.textContent!.includes("Your changes are still here"), "failed Save did not retain the draft");
    assert.equal(h.cards()[0].dataset.stepMapId, stepID);
    assert.equal(h.cards()[0].style.top, "80px");
    const firstAttempt = structuredClone(h.batches()[0]);
    h.state.batchStatus = 200;
    h.state.holdBatch = true;
    const save = h.button("Save Process");
    await act(async () => { save.click(); save.click(); });
    await settle(() => Boolean(h.state.releaseBatch), "retry was not sent");
    assert.equal(h.batches().length, 2, "one request per attempt even before React disables the button");
    assert.equal(h.button("Saving…").disabled, true);
    assert.equal(h.button("← Company map").disabled, true);
    assert.deepEqual(h.batches()[1], firstAttempt, "retry must preserve Process, Step and layout identities");
    await act(async () => h.state.releaseBatch!());
    await settle(() => Boolean(h.container.querySelector('.process-map-focus.is-exiting')), "retry did not return to the company map");
    await h.finishExit();
    assert.deepEqual(h.opened, []);
  } finally { await h.dispose(); }
});

test("lost Save response preserves newer local edits until explicit recovery loads the committed Process and current Folder", async () => {
  const h = await harness();
  try {
    await h.start(true);
    await h.input('[placeholder="Untitled Process"]', "Committed Process name");
    await h.chooseFolder();
    const committedStepID = h.cards()[0].dataset.stepMapId;
    h.state.commitThenFail = true;
    await h.click("Save Process");
    await settle(() => Boolean(h.findButton("Find saved Process")), "lost response did not offer explicit recovery");
    const committed = structuredClone(h.batches()[0]);
    assert.equal(h.preventsUnload(), true);
    await h.input('[placeholder="Untitled Process"]', "Newer local Process name");
    await h.click("Move New Step");
    await h.renameStep("Newer local Step name");
    await h.key(h.button("Move Newer local Step name"), "ArrowRight");
    await h.click("+ Create Step");
    const laterStepID = h.cards()[1].dataset.stepMapId;
    h.state.commitThenFail = false;
    await h.click("Save Process");
    await settle(() => h.container.textContent!.includes("process_definition_already_exists"), "retry should report the already committed identity");
    assert.equal(h.batches().length, 2);
    assert.equal(h.batches()[1].process_definition.logic_gate_id, committed.process_definition.logic_gate_id);
    assert.equal(h.batches()[1].process_definition.steps[0].process_step_id, committedStepID);
    assert.equal(h.button("Name Process").firstChild!.textContent, "Newer local Process name");
    assert.deepEqual(h.cards().map((card) => card.dataset.stepMapId), [committedStepID, laterStepID]);
    assert.equal(h.cards()[0].style.left, "80px");
    assert.equal(h.preventsUnload(), true);
    assert.equal(h.requests.filter((request) => request.path.endsWith("/work") || request.path.includes("location-path")).length, 0, "recovery cannot replace edits automatically after either failure");
    // A saved Process can have moved since the first request committed.
    h.state.recoveryFolderID = parentFolderID;
    await h.click("Find saved Process");
    await settle(() => Boolean(h.container.querySelector('.process-map-focus.is-exiting')), "explicit recovery did not return to the company map");
    await h.finishExit();
    assert.equal(h.cards().length, 0);
    assert.deepEqual(h.revealed, [{ companyID, processID: committed.process_definition.logic_gate_id, response: undefined, folderPathIDs: [parentFolderID] }]);
    assert.equal(h.requests.filter((request) => request.path === "/v1/company-explorer/location-path").length, 1);
    assert.deepEqual(h.workReads[0], { path: `/v2/logic-gates/${committed.process_definition.logic_gate_id}/work`, cache: "no-store" }, "explicit recovery must read the committed version afresh");
    assert.ok(h.requests.some((request) => request.path === `/v2/logic-gates/${committed.process_definition.logic_gate_id}/work`));
    assert.equal(h.mutations().length, 2, "recovery must only read the committed Process");
    assert.equal(h.preventsUnload(), false);
    assert.deepEqual(h.opened, []);
  } finally { await h.dispose(); }
});

test("discard asks first, keeping edits sends no writes, and company navigation cannot retain an old draft", async () => {
  const h = await harness();
  try {
    assert.equal(h.preventsUnload(), false);
    await h.start(true);
    assert.equal(h.preventsUnload(), true);
    const firstStepID = h.cards()[0].dataset.stepMapId;
    await h.input('[placeholder="Untitled Process"]', "Unsaved first company");
    await h.click("← Company map");
    assert.match(h.dom.window.document.querySelector('[role="dialog"]')!.textContent!, /Are you sure\?/);
    await h.click("Keep editing");
    assert.equal(h.preventsUnload(), true);
    assert.equal(h.cards()[0].dataset.stepMapId, firstStepID);
    assert.equal(h.button("Name Process").firstChild!.textContent, "Unsaved first company");
    await h.click("← Company map");
    await h.click("Go back");
    await h.finishExit();
    assert.equal(h.container.querySelector('[aria-label="New Process map"]'), null);
    assert.equal(h.preventsUnload(), false);
    await h.start(true);
    assert.notEqual(h.cards()[0].dataset.stepMapId, firstStepID);
    await h.input('[placeholder="Untitled Process"]', "Another unsaved Process");
    h.state.companyID = "55555555-5555-4555-8555-555555555555";
    await h.render();
    assert.equal(h.container.querySelector('[aria-label="New Process map"]'), null);
    assert.equal(h.cards().length, 0);
    assert.equal(h.preventsUnload(), false);
    await h.start();
    assert.equal(h.button("Name Process").firstChild!.textContent, "Untitled Process");
    assert.equal(h.cards().length, 0);
    assert.equal(h.mutations().length, 0);
    assert.deepEqual(h.opened, []);
  } finally { await h.dispose(); }
});

test("confirmed discard retains the outgoing Process until its own exit animation finishes", async () => {
  const h = await harness();
  try {
    await h.start(true);
    const company = h.container.querySelector(".process-map-company-canvas")!;
    const workspace = h.container.querySelector('[aria-label="New Process map"]')!;
    const step = h.cards()[0];
    await h.click("← Company map");
    assert.ok(h.container.querySelector('[aria-labelledby="process-map-leave-title"]'));
    assert.equal(h.container.querySelector(".process-map-focus.is-exiting"), null, "requesting confirmation must not start the exit");
    await h.click("Go back");
    const outgoing = h.container.querySelector(".process-map-focus.is-exiting")!;
    assert.ok(outgoing);
    assert.ok(outgoing.contains(workspace));
    assert.equal(h.cards()[0], step, "the authored content must remain mounted during the reverse animation");
    assert.equal(outgoing.hasAttribute("inert"), true);
    assert.equal(outgoing.getAttribute("aria-hidden"), "true");
    assert.equal(company.classList.contains("is-focused"), false, "the company canvas must start returning before the Process unmounts");
    assert.equal(company.hasAttribute("inert"), true);
    assert.equal(h.findButton("+ Create Process"), undefined, "company creation must not become interactive beneath the outgoing Process");
    assert.equal(h.container.querySelector('[aria-labelledby="process-map-leave-title"]'), null);
    await h.animationEnd(workspace);
    assert.equal(h.container.querySelector(".process-map-focus.is-exiting"), outgoing, "a bubbling child animation cannot finish the exit");
    await h.animationEnd(outgoing, "process-map-enter");
    assert.equal(h.container.querySelector(".process-map-focus.is-exiting"), outgoing, "an unrelated animation cannot finish the exit");
    await h.finishExit();
    assert.equal(h.container.querySelector(".process-map-focus"), null);
    assert.equal(h.container.querySelector(".process-map-company-canvas"), company);
    assert.equal(company.hasAttribute("inert"), false);
    assert.equal(company.hasAttribute("aria-hidden"), false);
    assert.equal(h.button("+ Create Process").disabled, false);
    assert.equal(h.preventsUnload(), false);
    assert.equal(h.mutations().length, 0);
  } finally { await h.dispose(); }
});

test("saving animates back to the mounted company map and preserves its camera", async () => {
  const h = await harness();
  try {
    const company = h.container.querySelector(".process-map-company-canvas")!;
    const deckElement = company.querySelector("[data-process-map-deck-test-stub]")!;
    assert.ok(deckElement);
    const deck = readProcessMapDeckGLTestProps() as ReturnType<typeof readProcessMapDeckGLTestProps> & { onViewStateChange: (params: { viewState: Record<string, unknown> }) => unknown };
    await act(async () => { deck.onViewStateChange({ viewState: { ...deck.viewState, target: [320, -160, 0], zoom: 1.5 } }); });
    const camera = structuredClone(readProcessMapDeckGLTestProps().viewState);
    await h.start(true);
    await h.input('[placeholder="Untitled Process"]', "Saved Process");
    await h.chooseFolder();
    await h.click("Save Process");
    await settle(() => Boolean(h.container.querySelector('.process-map-focus.is-exiting')), "Save did not start returning to the company map");
    assert.equal(company.classList.contains("is-focused"), false);
    assert.ok(h.container.querySelector(".process-map-focus.is-exiting")?.contains(h.container.querySelector('[aria-label="New Process map"]')));
    assert.equal(company.hasAttribute("inert"), true);
    assert.equal(company.querySelector("[data-process-map-deck-test-stub]"), deckElement);
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, camera);
    // No animation event is dispatched: the bounded cleanup timer must still finish.
    await settle(() => h.container.querySelector(".process-map-focus") === null, "the exit timeout did not restore the company map");
    assert.equal(h.container.querySelector(".process-map-company-canvas"), company);
    assert.equal(company.querySelector("[data-process-map-deck-test-stub]"), deckElement);
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, camera);
    assert.equal(company.hasAttribute("inert"), false);
    assert.equal(h.button("+ Create Step").disabled, false);
    assert.equal(h.mutations().length, 1, "leaving a saved Process must not issue another write");
    assert.deepEqual(h.opened, []);
  } finally { await h.dispose(); }
});

test("reduced motion returns immediately from both confirmed drafts and saved Processes", async () => {
  for (const saveFirst of [false, true]) {
    const h = await harness(true);
    try {
      await h.start(true);
      const company = h.container.querySelector(".process-map-company-canvas")!;
      if (saveFirst) {
        await h.input('[placeholder="Untitled Process"]', "Reduced motion Process");
        await h.chooseFolder();
        await h.click("Save Process");
        await settle(() => h.container.querySelector(".process-map-focus") === null, "Save did not return immediately");
      }
      if (!saveFirst) { await h.click("← Company map"); await h.click("Go back"); }
      assert.equal(h.container.querySelector(".process-map-focus"), null, "reduced motion must not wait for an animation or timeout");
      assert.equal(h.container.querySelector(".process-map-company-canvas"), company);
      assert.equal(company.hasAttribute("inert"), false);
      assert.equal(h.button("+ Create Process").disabled, false);
      assert.equal(h.mutations().length, saveFirst ? 1 : 0);
    } finally { await h.dispose(); }
  }
});

test("an exit finishes when reduced motion is enabled or the Page becomes inactive", async () => {
  for (const cause of ["reduced motion", "inactive"] as const) {
    const h = await harness();
    try {
      await h.start(true);
      await h.click("← Company map");
      await h.click("Go back");
      assert.ok(h.container.querySelector(".process-map-focus.is-exiting"));
      if (cause === "reduced motion") await h.setReducedMotion(true);
      else { h.state.active = false; await h.render(); }
      assert.equal(h.container.querySelector(".process-map-focus"), null, `${cause} must finish the pending exit without an animation event`);
      assert.equal(h.container.querySelector(".process-map-company-canvas")!.hasAttribute("inert"), false);
      assert.equal(h.preventsUnload(), false);
      assert.equal(h.mutations().length, 0);
    } finally { await h.dispose(); }
  }
});

test("leaving the Page removes the unfinished Process and its portal menus", async () => {
  const h = await harness();
  try {
    await h.start(true);
    await h.input('[placeholder="Untitled Process"]', "Unfinished Process");
    await h.chooseFolder();
    const firstStepID = h.cards()[0].dataset.stepMapId;
    const viewport = h.container.querySelector(".process-step-map__viewport")!;
    await act(async () => viewport.dispatchEvent(new h.dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 400, clientY: 300 })));
    assert.ok(h.dom.window.document.querySelector('[role="menu"][aria-label="Process map creation"]'));
    h.state.active = false;
    await h.render();
    assert.equal(h.dom.window.document.querySelector('[role="menu"], [role="dialog"]'), null);
    assert.equal(h.container.querySelector('[aria-label="New Process map"]'), null);
    assert.equal(h.preventsUnload(), false);
    h.state.active = true;
    await h.render();
    await h.start(true);
    assert.notEqual(h.cards()[0].dataset.stepMapId, firstStepID);
    assert.equal(h.button("Name Process").firstChild!.textContent, "Untitled Process");
    assert.equal(h.mutations().length, 0);
  } finally { await h.dispose(); }
});

test("Page Create Folder uses the canonical Folder POST and stays on the company canvas", async () => {
  const h = await harness();
  try {
    await h.click("+ Create Folder");
    await settle(() => Boolean(h.dom.window.document.querySelector('form[role="dialog"] input')), "Folder dialog did not load");
    assert.ok(h.container.querySelector('.process-map-page form[role="dialog"]'), "Folder creation must remain inside the map pane");
    h.state.active = false;
    await h.render();
    assert.equal(h.container.querySelector('form[role="dialog"]'), null);
    h.state.active = true;
    await h.render();
    await h.click("+ Create Folder");
    await settle(() => Boolean(h.dom.window.document.querySelector('form[role="dialog"] input')), "Folder dialog did not reopen");
    await h.input('form[role="dialog"] input', "  Procurement  ");
    await h.click("Create Folder");
    await settle(() => h.container.textContent!.includes("Folder “Procurement” created."), "created Folder did not return to the canvas");
    assert.deepEqual(h.mutations(), [{ path: "/v1/company-explorer/folders", method: "POST", body: { company_id: companyID, parent_folder_id: "", name: "Procurement" } }]);
    assert.equal(h.dom.window.document.querySelector('form[role="dialog"]'), null);
    assert.equal(h.container.querySelector(".process-map-workspace"), null);
    assert.deepEqual(h.opened, []);
  } finally { await h.dispose(); }
});

test("the company creation card gives way to the Process editor and each new Step opens its instruction card", async () => {
  const h = await harness();
  const actions = () => {
    const cards = [...h.container.querySelectorAll<HTMLElement>(".process-map-page__actions")].filter((card) => !card.closest('[aria-hidden="true"], [inert]'));
    assert.equal(cards.length, 1, "the current map must have one visible creation card");
    assert.deepEqual([...cards[0].querySelectorAll("button")].slice(0, 3).map((button) => button.textContent), ["+ Create Folder", "+ Create Process", "+ Create Step"]);
    const hover = cards[0].querySelector<HTMLInputElement>('input[type="checkbox"]');
    assert.ok(hover, "Hover mode must share the creation card");
    assert.ok(h.container.querySelector(".process-map-page__canvas")!.contains(cards[0]));
    return hover;
  };
  const focusedActions = () => {
    assert.equal(h.container.querySelector(".process-map-page__actions"), null, "focused Processes omit the company action card");
    assert.equal(h.findButton("+ Create Folder"), undefined);
    assert.equal(h.findButton("+ Create Process"), undefined);
    assert.equal(h.button("+ Create Step").disabled, false);
    const tabs = [...h.container.querySelectorAll<HTMLButtonElement>('[aria-label="Process editor sections"] button')];
    assert.equal(tabs.find((tab) => tab.textContent === "Steps")?.getAttribute("aria-pressed"), "true", "creating a Step opens the Steps tab");
    assert.ok(tabs[0].parentElement!.compareDocumentPosition(h.container.querySelector('[aria-label="Process SOP editor"]')!) & h.dom.window.Node.DOCUMENT_POSITION_FOLLOWING, "the section tabs stay above the editor contents");
    assert.equal(h.container.querySelector('[role="toolbar"], button[aria-label="Bold"]'), null, "focused Process instructions omit formatting toolbars");
    assert.equal(h.container.querySelectorAll("[data-process-step-id]").length, h.cards().length, "each canonical Step has its existing instruction card");
  };
  try {
    const hover = actions();
    assert.equal(hover.checked, false);
    assert.equal(h.button("+ Create Folder").disabled, false);
    assert.equal(h.button("+ Create Process").disabled, false);
    await act(async () => hover.click());
    await h.start(true);
    focusedActions();
    const focus = h.container.querySelector<HTMLElement>(".process-map-focus")!;
    const viewport = h.container.querySelector(".process-step-map__viewport");
    const overview = h.container.querySelector("[data-process-sop-document-id]");
    const resize = h.container.querySelector<HTMLElement>('[role="separator"][aria-label="Resize Process editor"]')!;
    assert.ok(resize);
    focus.querySelector<HTMLElement>(".process-map-workspace")!.getBoundingClientRect = () => new h.dom.window.DOMRect(0, 0, 1200, 800);
    const originalWidth = Number.parseFloat(focus.style.getPropertyValue("--process-editor-width"));
    await h.key(resize, "ArrowLeft");
    const resizedWidth = focus.style.getPropertyValue("--process-editor-width");
    assert.equal(Number.parseFloat(resizedWidth), originalWidth + 24, "resizing updates the shared pane and floating-control width");
    assert.equal(h.container.querySelector(".process-step-map__viewport"), viewport, "resizing preserves the full map and its camera instance");
    assert.equal(h.container.querySelector("[data-process-sop-document-id]"), overview, "resizing preserves the mounted Process document");
    assert.equal(h.mutations().length, 0, "changing editor width does not change saved Process geometry");
    assert.equal(h.container.querySelector('[placeholder="Untitled Process"]'), null, "a new draft starts with a compact filename, not a large name field");
    assert.equal(h.button("Name Process").firstChild!.textContent, "Untitled Process");
    await h.input('[placeholder="Untitled Process"]', "Shipping");
    assert.equal(h.button("Name Process").firstChild!.textContent, "Shipping");
    assert.equal(h.container.querySelector('[aria-label="Process name"]'), null, "Enter must finish inline naming");
    await h.chooseFolder();
    const firstStepID = h.cards()[0].dataset.stepMapId;
    await h.click("+ Create Step");
    focusedActions();
    assert.equal(h.cards().length, 2);
    assert.equal(h.cards()[0].dataset.stepMapId, firstStepID, "the persistent control must add to the current draft");
    assert.equal(h.dom.window.document.querySelector('[role="dialog"]'), null, "Create Step must not replace the current Process");
    assert.equal(h.mutations().length, 0);
    await h.click("Save Process");
    await settle(() => Boolean(h.container.querySelector('.process-map-focus.is-exiting')), "Save did not return to the company map");
    await h.finishExit();
    assert.equal(actions().checked, true);
    await h.reopenSaved();
    await settle(() => Boolean(h.container.querySelector('[aria-label="Saved Process map"]')) && h.findButton("+ Create Step")?.disabled === false, "saved Step creation did not become available");
    assert.equal(h.container.querySelector<HTMLElement>(".process-map-focus")!.style.getPropertyValue("--process-editor-width"), resizedWidth, "the saved Process reuses the chosen editor width");
    assert.equal(h.container.querySelector(".process-map-page__actions"), null);
    const processID = h.batches()[0].process_definition.logic_gate_id;
    await h.click("+ Create Step");
    await settle(() => h.cards().length === 3 && h.findButton("+ Create Step")?.disabled === false, "saved creation card did not add a Step");
    assert.equal(h.cards()[0].dataset.stepMapId, firstStepID);
    assert.equal(h.batches().length, 1, "adding a saved Step must not create another Process");
    assert.deepEqual(h.mutations().at(-1), { path: `/v2/logic-gates/${processID}/steps`, method: "POST", body: { company_id: companyID, name: "New step" } });
    focusedActions();
    assert.deepEqual(h.opened, []);
  } finally { await h.dispose(); }
});

test("Folder and Process creation disappear inside a draft and return on the company map", async () => {
  const h = await harness();
  try {
    await h.start(true);
    await h.input('[placeholder="Untitled Process"]', "Order fulfilment");
    await h.chooseFolder();
    const stepID = h.cards()[0].dataset.stepMapId;
    assert.equal(h.findButton("+ Create Folder"), undefined);
    assert.equal(h.findButton("+ Create Process"), undefined);
    assert.equal(h.container.querySelector('[role="dialog"]'), null);
    assert.equal(h.cards()[0].dataset.stepMapId, stepID);
    assert.equal(h.button("Name Process").firstChild!.textContent, "Order fulfilment");
    assert.equal(h.container.querySelector('[aria-label="Destination path"]')!.textContent, "Workspace/Operations/Orders");
    await h.click("← Company map");
    await h.click("Go back");
    await h.finishExit();
    assert.equal(h.container.querySelector('[aria-label="New Process map"]'), null);
    assert.equal(h.cards().length, 0);
    assert.equal(h.button("+ Create Folder").disabled, false);
    assert.equal(h.button("+ Create Process").disabled, false);
    assert.equal(h.mutations().length, 0);
  } finally { await h.dispose(); }
});

test("a nonmodal discard prompt cannot discard an in-flight Save and closes after that Save succeeds", async () => {
  const h = await harness();
  try {
    await h.start(true);
    await h.input('[placeholder="Untitled Process"]', "Pending save");
    await h.chooseFolder();
    const stepID = h.cards()[0].dataset.stepMapId;
    await h.click("← Company map");
    assert.ok(h.container.querySelector('[aria-labelledby="process-map-leave-title"]'));
    assert.equal(h.button("Go back").disabled, false);
    h.state.holdBatch = true;
    // Keyboard activation has no outside pointerdown to dismiss the nonmodal prompt.
    await act(async () => { const save = h.button("Save Process"); save.focus(); save.click(); });
    await settle(() => Boolean(h.state.releaseBatch), "Save was not sent while the discard prompt remained open");
    assert.equal(h.button("Go back").disabled, true, "an active Save must block the pending discard action");
    await h.click("Go back");
    assert.ok(h.container.querySelector('[aria-label="New Process map"]'));
    assert.equal(h.cards()[0].dataset.stepMapId, stepID);
    assert.equal(h.batches().length, 1);
    await act(async () => h.state.releaseBatch!());
    await settle(() => Boolean(h.container.querySelector('.process-map-focus.is-exiting')), "Save did not start returning to the company map");
    assert.equal(h.container.querySelector('[aria-labelledby="process-map-leave-title"]'), null, "a successful Save must clear the obsolete discard prompt");
    assert.equal(h.cards()[0].dataset.stepMapId, stepID);
    assert.equal(h.preventsUnload(), false);
    await h.finishExit();
  } finally { await h.dispose(); }
});

test("Enter and Escape finish inline naming and return keyboard focus to the Process filename", async () => {
  const h = await harness();
  try {
    await h.start();
    await h.click("Name Process");
    const enterInput = h.container.querySelector<HTMLInputElement>('[aria-label="Process name"]')!;
    assert.equal(h.dom.window.document.activeElement, enterInput);
    await h.input('[aria-label="Process name"]', "Receiving");
    await h.key(enterInput, "Enter");
    assert.equal(h.container.querySelector('[aria-label="Process name"]'), null);
    await settle(() => h.dom.window.document.activeElement === h.findButton("Name Process"), "Enter left keyboard focus outside the filename");
    assert.equal(h.button("Name Process").firstChild!.textContent, "Receiving");
    await h.click("Name Process");
    const escapeInput = h.container.querySelector<HTMLInputElement>('[aria-label="Process name"]')!;
    await h.input('[aria-label="Process name"]', "Receiving orders");
    await h.key(escapeInput, "Escape");
    assert.equal(h.container.querySelector('[aria-label="Process name"]'), null);
    await settle(() => h.dom.window.document.activeElement === h.findButton("Name Process"), "Escape left keyboard focus outside the filename");
    assert.equal(h.button("Name Process").firstChild!.textContent, "Receiving orders");
    assert.equal(h.mutations().length, 0);
  } finally { await h.dispose(); }
});

test("late Folder and Process filename focus restoration preserves a newer inline Step editor", async () => {
  const h = await harness();
  const originalFrame = h.dom.window.requestAnimationFrame.bind(h.dom.window);
  const pendingFrames: FrameRequestCallback[] = [];
  try {
    await h.start(true);
    await h.input('[placeholder="Untitled Process"]', "Order fulfilment");
    await act(async () => { await new Promise<void>((resolve) => originalFrame(() => resolve())); });
    h.dom.window.requestAnimationFrame = (callback) => { pendingFrames.push(callback); return pendingFrames.length; };

    await h.chooseFolder();
    assert.equal(pendingFrames.length, 1, "choosing the destination schedules its return focus");
    await h.key(h.button("Move New Step"), "F2");
    const afterFolder = h.container.querySelector<HTMLInputElement>('[aria-label="Step name"]')!;
    assert.ok(afterFolder);
    assert.equal(h.dom.window.document.activeElement, afterFolder);
    await act(async () => pendingFrames.shift()!(16));
    assert.ok(h.container.querySelector('[aria-label="Step name"]') === afterFolder, "late Folder focus must not blur and close the newer Step input");
    assert.equal(h.dom.window.document.activeElement, afterFolder);

    await h.key(afterFolder, "Escape");
    await h.input('[placeholder="Untitled Process"]', "Shipping orders");
    assert.equal(pendingFrames.length, 1, "finishing the Process filename schedules its return focus");
    await h.key(h.button("Move New Step"), "F2");
    const afterFilename = h.container.querySelector<HTMLInputElement>('[aria-label="Step name"]')!;
    assert.ok(afterFilename);
    assert.equal(h.dom.window.document.activeElement, afterFilename);
    await act(async () => pendingFrames.shift()!(32));
    assert.ok(h.container.querySelector('[aria-label="Step name"]') === afterFilename, "late filename focus must not blur and close the newer Step input");
    assert.equal(h.dom.window.document.activeElement, afterFilename);
    assert.equal(h.mutations().length, 0);
  } finally { h.dom.window.requestAnimationFrame = originalFrame; await h.dispose(); }
});
