import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { WorkspaceProcessDefinition } from "../../../../frontend/src/modules/workspace/workspaceEntityCommands.js";
import { resetProcessMapDeckGLTestStub } from "../../modules/process-map/processMapDeckGLTestStub.js";
import { resetProcessMapRealtimeTestStub } from "../../modules/process-map/processMapRealtimeTestStub.js";

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

async function harness() {
  const apiBase = `http://process-page-${++fixtureNumber}.test`;
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: apiBase, pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete (globalThis as Record<string, unknown>)[name]; });
  };
  for (const name of ["window", "document", "navigator", "sessionStorage", "localStorage", "Node", "Text", "Element", "HTMLElement", "HTMLInputElement", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "MutationObserver"]) {
    install(name, name === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name]);
  }
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("IS_REACT_ACT_ENVIRONMENT", true);
  resetProcessMapDeckGLTestStub();
  resetProcessMapRealtimeTestStub();
  const folders = [
    { company_id: companyID, folder_id: parentFolderID, parent_folder_id: "", folder_kind: "logic_gate", name: "Operations", position: 1000 },
    { company_id: companyID, folder_id: childFolderID, parent_folder_id: parentFolderID, folder_kind: "logic_gate", name: "Orders", position: 1000 },
  ];
  const requests: Request[] = [], opened: Array<{ id: string; label: string }> = [], draftStates: boolean[] = [];
  const workReads: Array<{ path: string; cache?: RequestCache }> = [];
  const saved = new Map<string, Batch>();
  const state = { companyID, active: true, batchStatus: 200, commitThenFail: false, recoveryFolderID: childFolderID, holdBatch: false, releaseBatch: null as (() => void) | null };
  install("fetch", async (input: string, options?: RequestInit) => {
    const url = new URL(input, apiBase);
    const request = { path: url.pathname, method: options?.method ?? "GET", body: options?.body ? JSON.parse(String(options.body)) : {} };
    requests.push(request);
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
      return reply({ items: [{ client_id: batch.items[0].client_id, entity_id: batch.items[0].client_id }] }, 201);
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
    const process = request.path.match(/^\/v2\/logic-gates\/([^/]+)\/(work|step-map|steps)$/);
    if (process) {
      if (process[2] === "work") workReads.push({ path: request.path, cache: options?.cache });
      const batch = saved.get(process[1]);
      assert.ok(batch, "saved map must use the exact committed Process UUID");
      const definition = batch.process_definition;
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
  const onDraftStateChange = (active: boolean) => { draftStates.push(active); };
  const render = async () => { await act(async () => root.render(<ProcessMapPage apiBase={apiBase} companyID={state.companyID} active={state.active} onOpenLogicGate={onOpenLogicGate} onDraftStateChange={onDraftStateChange} />)); await flush(); };
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
  const cards = () => [...container.querySelectorAll<HTMLElement>("[data-step-map-id]")];
  const preventsUnload = () => {
    const event = new dom.window.Event("beforeunload", { cancelable: true });
    dom.window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const mutations = () => requests.filter((request) => request.method !== "GET" && request.path !== "/v1/process-map/changes");
  const batches = () => requests.filter((request) => request.path === "/v1/workspace/entity-batches").map((request) => request.body as Batch);
  const chooseFolder = async () => { await click("Choose Folder"); await click("Open Operations"); await click("Open Orders"); await click("Use this Folder"); };
  const start = async (firstStep = false) => {
    await click(firstStep ? "+ Create Step" : "+ Create Process");
    await settle(() => findButton("+ Create Step")?.disabled === false && findButton("Choose Folder")?.disabled === false, "draft did not finish loading");
  };
  const dispose = async () => { await act(async () => root.unmount()); resetProcessMapDeckGLTestStub(); resetProcessMapRealtimeTestStub(); restores.reverse().forEach((restore) => restore()); dom.window.close(); };
  await render();
  return { dom, container, state, requests, workReads, opened, draftStates, render, findButton, button, click, input, key, renameStep, pointer, cards, preventsUnload, mutations, batches, chooseFolder, start, dispose };
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
    await settle(() => Boolean(h.container.querySelector('[aria-label="Saved Process map"]')) && h.findButton("Open Board / SOP")?.disabled === false, "saved full canvas did not load");
    assert.equal(h.batches().length, 1);
    assert.equal(h.mutations().length, 1, "Save must not issue placement or individual Step writes");
    const batch = h.batches()[0], definition = batch.process_definition;
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
    assert.deepEqual(definition.layout.steps.find((box) => box.process_step_id === sourceID), { process_step_id: sourceID, x: 96, y: 80, width: 128, height: 56 });
    assert.deepEqual(definition.layout.routes, []);
    assert.deepEqual(h.cards().map((card) => card.dataset.stepMapId), [sourceID, targetID]);
    assert.equal(h.cards()[0].style.left, "96px");
    assert.equal(h.cards()[0].style.width, "128px");
    assert.ok(h.container.querySelector('[aria-label="Connection from Receive order to Ship order"]'), "the same directed connection must survive the saved-map reload");
    assert.equal(h.container.querySelector('[aria-label="New Process map"]'), null);
    assert.deepEqual(h.opened, [], "saving must keep the full canvas open");
    assert.ok(h.container.querySelector('[aria-label="Process outline: Order fulfilment"]'), "saving must retain the named Process boundary");
    assert.equal(h.draftStates.at(-1), false);
    await h.click("Open Board / SOP");
    assert.deepEqual(h.opened, [{ id: definition.logic_gate_id, label: "Order fulfilment" }]);
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
    assert.equal(h.cards()[0].style.width, "112px");
    assert.equal(h.cards()[0].style.height, "56px");
    const stepID = h.cards()[0].dataset.stepMapId;
    await h.input('[placeholder="Untitled Process"]', "Payment approval");
    await h.chooseFolder();
    await h.click("Move New Step");
    await h.renameStep("Check payment");
    await h.key(h.button("Move Check payment"), "ArrowDown");
    h.state.batchStatus = 500;
    await h.click("Save Process");
    await settle(() => h.container.textContent!.includes("Your draft has been kept"), "failed Save did not retain the draft");
    assert.equal(h.cards()[0].dataset.stepMapId, stepID);
    assert.equal(h.cards()[0].style.top, "80px");
    assert.equal(h.draftStates.at(-1), true);
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
    await settle(() => Boolean(h.container.querySelector('[aria-label="Saved Process map"]')), "retry did not open the saved Process");
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
    await settle(() => Boolean(h.findButton("Open saved version")), "lost response did not offer explicit recovery");
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
    assert.equal(h.draftStates.at(-1), true);
    assert.equal(h.preventsUnload(), true);
    assert.equal(h.requests.filter((request) => request.path.endsWith("/work") || request.path.includes("location-path")).length, 0, "recovery cannot replace edits automatically after either failure");
    // A saved Process can have moved since the first request committed.
    h.state.recoveryFolderID = parentFolderID;
    await h.click("Open saved version");
    await settle(() => Boolean(h.container.querySelector('[aria-label="Saved Process map"]')) && h.findButton("Open Board / SOP")?.disabled === false, "explicit recovery did not load the full saved canvas");
    assert.equal(h.container.querySelector(".process-map-workspace__saved-name")!.textContent, "Committed Process name");
    assert.equal(h.container.querySelector('[aria-label="Destination path"]')!.textContent, "Workspace/Operations");
    assert.deepEqual(h.cards().map((card) => card.dataset.stepMapId), [committedStepID]);
    assert.equal(h.cards()[0].style.left, "64px");
    assert.ok(h.findButton("Move New Step"));
    assert.equal(h.requests.filter((request) => request.path === "/v1/company-explorer/location-path").length, 1);
    assert.deepEqual(h.workReads[0], { path: `/v2/logic-gates/${committed.process_definition.logic_gate_id}/work`, cache: "no-store" }, "explicit recovery must read the committed version afresh");
    assert.ok(h.requests.some((request) => request.path === `/v2/logic-gates/${committed.process_definition.logic_gate_id}/work`));
    assert.equal(h.mutations().length, 2, "recovery must only read the committed Process");
    assert.equal(h.draftStates.at(-1), false);
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
    assert.match(h.dom.window.document.querySelector('[role="dialog"]')!.textContent!, /Discard this Process draft/);
    await h.click("Keep editing");
    assert.equal(h.preventsUnload(), true);
    assert.equal(h.cards()[0].dataset.stepMapId, firstStepID);
    assert.equal(h.button("Name Process").firstChild!.textContent, "Unsaved first company");
    await h.click("← Company map");
    await h.click("Discard draft");
    assert.equal(h.container.querySelector('[aria-label="New Process map"]'), null);
    assert.equal(h.draftStates.at(-1), false);
    assert.equal(h.preventsUnload(), false);
    await h.start(true);
    assert.notEqual(h.cards()[0].dataset.stepMapId, firstStepID);
    await h.input('[placeholder="Untitled Process"]', "Another unsaved Process");
    h.state.companyID = "55555555-5555-4555-8555-555555555555";
    await h.render();
    assert.equal(h.container.querySelector('[aria-label="New Process map"]'), null);
    assert.equal(h.cards().length, 0);
    assert.equal(h.draftStates.at(-1), false);
    assert.equal(h.preventsUnload(), false);
    await h.start();
    assert.equal(h.button("Name Process").firstChild!.textContent, "Untitled Process");
    assert.equal(h.cards().length, 0);
    assert.equal(h.mutations().length, 0);
    assert.deepEqual(h.opened, []);
  } finally { await h.dispose(); }
});

test("inactive Page retains its draft but closes portal menus and discard dialogs and cancels an unfinished gesture", async () => {
  const h = await harness();
  try {
    await h.start(true);
    await h.input('[placeholder="Untitled Process"]', "Retained draft");
    await h.chooseFolder();
    await h.click("Move New Step");
    await h.renameStep("Retained Step");
    await h.key(h.button("Move Retained Step"), "ArrowRight");
    const stepID = h.cards()[0].dataset.stepMapId;
    const viewport = h.container.querySelector(".process-step-map__viewport")!;
    await act(async () => viewport.dispatchEvent(new h.dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 400, clientY: 300 })));
    const menu = h.dom.window.document.querySelector('[role="menu"][aria-label="Process map creation"]');
    assert.ok(menu, "blank-canvas menu must open before hiding the Page");
    assert.equal(h.container.contains(menu), false, "test must exercise the body portal");
    h.state.active = false;
    await h.render();
    assert.equal(h.dom.window.document.querySelector('[role="menu"]'), null);
    assert.equal(h.button("+ Create Step").disabled, true);
    assert.equal(h.cards()[0].dataset.stepMapId, stepID);
    assert.equal(h.cards()[0].style.left, "80px");
    assert.equal(h.button("Name Process").firstChild!.textContent, "Retained draft");
    assert.equal(h.draftStates.at(-1), true);
    assert.equal(h.preventsUnload(), true, "a hidden unsaved draft still needs the unload warning");
    h.state.active = true;
    await h.render();
    await h.click("← Company map");
    assert.ok(h.dom.window.document.querySelector("#process-map-discard-title"));
    h.state.active = false;
    await h.render();
    assert.equal(h.dom.window.document.querySelector('[role="dialog"]'), null);
    h.state.active = true;
    await h.render();
    const move = h.button("Move Retained Step");
    await h.pointer(move, "pointerdown", 100, 100);
    await h.pointer(move, "pointermove", 148, 100);
    assert.equal(h.cards()[0].style.left, "128px");
    assert.equal(h.button("Save Process").disabled, true);
    h.state.active = false;
    await h.render();
    await h.pointer(move, "pointerup", 148, 100);
    h.state.active = true;
    await h.render();
    assert.equal(h.cards()[0].dataset.stepMapId, stepID);
    assert.equal(h.cards()[0].style.left, "80px", "a cancelled gesture cannot replace the retained draft geometry");
    assert.equal(h.button("Save Process").disabled, false);
    assert.equal(h.button("Name Process").firstChild!.textContent, "Retained draft");
    assert.equal(h.dom.window.document.querySelector('[role="menu"], [role="dialog"]'), null);
    assert.equal(h.mutations().length, 0);
    assert.deepEqual(h.opened, []);
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

test("one creation card and Hover mode remain available from the company map through draft and saved Step creation", async () => {
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
  try {
    const hover = actions();
    assert.equal(hover.checked, false);
    assert.equal(h.button("+ Create Folder").disabled, false);
    assert.equal(h.button("+ Create Process").disabled, false);
    await act(async () => hover.click());
    await h.start(true);
    assert.equal(actions().checked, true);
    assert.equal(h.button("+ Create Folder").disabled, true);
    assert.equal(h.button("+ Create Process").disabled, true);
    assert.equal(h.container.querySelector('[placeholder="Untitled Process"]'), null, "a new draft starts with a compact filename, not a large name field");
    assert.equal(h.button("Name Process").firstChild!.textContent, "Untitled Process");
    await h.input('[placeholder="Untitled Process"]', "Shipping");
    assert.equal(h.button("Name Process").firstChild!.textContent, "Shipping");
    assert.equal(h.container.querySelector('[aria-label="Process name"]'), null, "Enter must finish inline naming");
    await h.chooseFolder();
    const firstStepID = h.cards()[0].dataset.stepMapId;
    await h.click("+ Create Step");
    assert.equal(h.cards().length, 2);
    assert.equal(h.cards()[0].dataset.stepMapId, firstStepID, "the persistent control must add to the current draft");
    assert.equal(h.dom.window.document.querySelector('[role="dialog"]'), null, "Create Step must not replace the current Process");
    assert.equal(h.mutations().length, 0);
    await h.click("Save Process");
    await settle(() => Boolean(h.container.querySelector('[aria-label="Saved Process map"]')) && h.findButton("+ Create Step")?.disabled === false, "saved Step creation did not become available");
    assert.equal(actions().checked, true);
    assert.equal(h.button("+ Create Folder").disabled, true);
    assert.equal(h.button("+ Create Process").disabled, true);
    const processID = h.batches()[0].process_definition.logic_gate_id;
    await h.click("+ Create Step");
    await settle(() => h.cards().length === 3 && h.findButton("+ Create Step")?.disabled === false, "saved creation card did not add a Step");
    assert.equal(h.cards()[0].dataset.stepMapId, firstStepID);
    assert.equal(h.batches().length, 1, "adding a saved Step must not create another Process");
    assert.deepEqual(h.mutations().at(-1), { path: `/v2/logic-gates/${processID}/steps`, method: "POST", body: { company_id: companyID, name: "New step" } });
    assert.equal(actions().checked, true);
    assert.deepEqual(h.opened, []);
  } finally { await h.dispose(); }
});

test("Folder and Process creation stay disabled inside a draft and become available again on the company map", async () => {
  const h = await harness();
  try {
    await h.start(true);
    await h.input('[placeholder="Untitled Process"]', "Order fulfilment");
    await h.chooseFolder();
    const stepID = h.cards()[0].dataset.stepMapId;
    assert.equal(h.button("+ Create Folder").disabled, true);
    assert.equal(h.button("+ Create Process").disabled, true);
    await h.click("+ Create Folder");
    await h.click("+ Create Process");
    assert.equal(h.container.querySelector('[role="dialog"]'), null);
    assert.equal(h.cards()[0].dataset.stepMapId, stepID);
    assert.equal(h.button("Name Process").firstChild!.textContent, "Order fulfilment");
    assert.equal(h.container.querySelector('[aria-label="Destination path"]')!.textContent, "Workspace/Operations/Orders");
    await h.click("← Company map");
    await h.click("Discard draft");
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
    assert.ok(h.container.querySelector('[aria-labelledby="process-map-discard-title"]'));
    assert.equal(h.button("Discard draft").disabled, false);
    h.state.holdBatch = true;
    // Keyboard activation has no outside pointerdown to dismiss the nonmodal prompt.
    await act(async () => { const save = h.button("Save Process"); save.focus(); save.click(); });
    await settle(() => Boolean(h.state.releaseBatch), "Save was not sent while the discard prompt remained open");
    assert.equal(h.button("Discard draft").disabled, true, "an active Save must block the pending discard action");
    await h.click("Discard draft");
    assert.ok(h.container.querySelector('[aria-label="New Process map"]'));
    assert.equal(h.cards()[0].dataset.stepMapId, stepID);
    assert.equal(h.batches().length, 1);
    await act(async () => h.state.releaseBatch!());
    await settle(() => Boolean(h.container.querySelector('[aria-label="Saved Process map"]')) && h.findButton("+ Create Step")?.disabled === false, "Save did not finish on the saved map");
    assert.equal(h.container.querySelector('[aria-labelledby="process-map-discard-title"]'), null, "a successful Save must clear the obsolete discard prompt");
    assert.equal(h.cards()[0].dataset.stepMapId, stepID);
    assert.equal(h.preventsUnload(), false);
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
