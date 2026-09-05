import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { ProcessStepMapLayout } from "../../../../frontend/src/modules/kanban/processStepMapGeometry.js";
import type { ProcessStep, ProcessStepRelationship } from "../../../../frontend/src/modules/kanban/processWork.js";
import type { ProcessStepMapCommands } from "../../../../frontend/src/modules/kanban/ProcessStepMap.js";

const initialSteps: ProcessStep[] = [
  { process_step_id: "a", logic_gate_id: "process", name: "Receive", position: 1000 },
  { process_step_id: "b", logic_gate_id: "process", name: "Check", position: 2000 },
];
const initialEdge: ProcessStepRelationship = { resource_operational_relationship_id: "edge", source: { resource_type: "process_step", resource_id: "a" }, target: { resource_type: "process_step", resource_id: "b" } };
const initialLayout: ProcessStepMapLayout = { revision: 3, steps: [
  { process_step_id: "a", x: 64, y: 64, width: 224, height: 112 },
  { process_step_id: "b", x: 480, y: 256, width: 224, height: 112 },
], routes: [{ resource_operational_relationship_id: "edge", points: [{ x: 368, y: 176 }] }] };

type Request = { path: string; method: string; body: Record<string, any> };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
async function flush() { await act(async () => { for (let index = 0; index < 16; index += 1) await Promise.resolve(); }); }

async function harness(draft = false) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (original) Object.defineProperty(globalThis, name, original); else delete (globalThis as Record<string, unknown>)[name]; });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "CustomEvent", "localStorage"]) install(name, name === "window" ? dom.window : name === "document" ? dom.window.document : (dom.window as any)[name]);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  const state = { steps: structuredClone(initialSteps), relationships: [structuredClone(initialEdge)], layout: structuredClone(initialLayout), processID: "process", canEdit: true, saveMode: "success" as "success" | "failure" | "conflict", customFetch: null as ((request: Request) => Promise<Response> | null) | null, customLocalSave: null as ((layout: ProcessStepMapLayout) => Promise<ProcessStepMapLayout>) | null };
  const requests: Request[] = [];
  install("fetch", async (url: string, options?: RequestInit) => {
    const request = { path: new URL(url, "http://localhost").pathname, method: options?.method ?? "GET", body: options?.body ? JSON.parse(String(options.body)) : {} };
    requests.push(request);
    const intercepted = state.customFetch?.(request);
    if (intercepted) return intercepted;
    if (request.path.endsWith("/step-map")) {
      if (request.method === "GET") return response(state.layout);
      if (state.saveMode === "failure") return response({ error: "Save failed" }, 500);
      if (state.saveMode === "conflict") { state.layout = { ...state.layout, revision: 9, steps: state.layout.steps.map((box) => ({ ...box, x: box.x + 128 })) }; return response({ error: "process_step_map_revision_conflict" }, 409); }
      state.layout = { revision: state.layout.revision + 1, steps: request.body.steps, routes: request.body.routes };
      return response(state.layout);
    }
    if (request.path.endsWith("/steps") && request.method === "POST") {
      const step = { process_step_id: "new", logic_gate_id: state.processID, name: request.body.name, position: 3000 };
      state.steps.push(step);
      return response({ step });
    }
    if (request.path.includes("/steps/") && request.method === "PATCH") {
      const id = request.path.split("/").at(-1)!;
      state.steps = state.steps.map((step) => step.process_step_id === id ? { ...step, name: request.body.name } : step);
      return response({ step: state.steps.find((step) => step.process_step_id === id) });
    }
    if (request.path.endsWith("/step-relationships") && request.method === "POST") {
      const relationship = { resource_operational_relationship_id: "new-edge", source: request.body.source, target: request.body.target };
      state.relationships.push(relationship);
      return response({ relationship });
    }
    if (request.path.includes("/step-relationships/") && request.method === "DELETE") { state.relationships = state.relationships.filter((edge) => edge.resource_operational_relationship_id !== request.path.split("/").at(-1)); return response({}); }
    if (request.path.includes("/steps/") && request.method === "DELETE") {
      const id = request.path.split("/").at(-1)!;
      state.steps = state.steps.filter((step) => step.process_step_id !== id);
      state.relationships = state.relationships.filter((edge) => edge.source.resource_id !== id && edge.target.resource_id !== id);
      return response({});
    }
    throw new Error(`Unexpected request ${request.method} ${request.path}`);
  });
  const [{ createRoot }, { ProcessStepMap, ProcessStepMapEditor }] = await Promise.all([import("react-dom/client"), import("../../../../frontend/src/modules/kanban/ProcessStepMap.js")]);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const localCalls: string[] = [];
  const busyStates: boolean[] = [];
  const commands: ProcessStepMapCommands = {
    readLayout: async () => state.layout,
    saveLayout: async (layout) => {
      localCalls.push("layout");
      if (state.customLocalSave) return state.customLocalSave(layout);
      if (state.saveMode === "failure") throw new Error("Could not update draft");
      return state.layout = { ...layout, revision: state.layout.revision + 1 };
    },
    createStep: async (name) => {
      localCalls.push("create");
      const step = { process_step_id: "new", logic_gate_id: state.processID, name, position: 3000 };
      state.steps = [...state.steps, step];
      return { step };
    },
    renameStep: async (id, name) => {
      localCalls.push("rename");
      state.steps = state.steps.map((step) => step.process_step_id === id ? { ...step, name } : step);
      return { step: state.steps.find((step) => step.process_step_id === id) };
    },
    deleteStep: async (id) => {
      localCalls.push("delete");
      state.steps = state.steps.filter((step) => step.process_step_id !== id);
      state.relationships = state.relationships.filter((edge) => edge.source.resource_id !== id && edge.target.resource_id !== id);
    },
    connectSteps: async (sourceID, targetID) => {
      localCalls.push("connect");
      const relationship: ProcessStepRelationship = { resource_operational_relationship_id: "new-edge", source: { resource_type: "process_step", resource_id: sourceID }, target: { resource_type: "process_step", resource_id: targetID } };
      state.relationships = [...state.relationships, relationship];
      return { relationship };
    },
    disconnectSteps: async (id) => {
      localCalls.push("disconnect");
      state.relationships = state.relationships.filter((edge) => edge.resource_operational_relationship_id !== id);
    },
  };
  const onBusyChange = (busy: boolean) => busyStates.push(busy);
  const onCreateFolder = () => { localCalls.push("folder"); };
  const onCreateProcess = () => { localCalls.push("process"); };
  const render = () => {
    const props = { steps: [...state.steps], relationships: [...state.relationships], canEdit: state.canEdit, onChanged: render, onBusyChange, onCreateFolder, onCreateProcess };
    root.render(draft
      ? <ProcessStepMapEditor key={state.processID} {...props} commands={commands} saveMode="draft" />
      : <ProcessStepMap apiBase="http://localhost" companyID="company" processID={state.processID} {...props} />);
  };
  const mount = async () => { await act(async () => render()); await flush(); };
  const button = (label: string): HTMLButtonElement => {
    const result = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
    assert.ok(result, `Missing button ${label}`);
    return result;
  };
  const click = async (label: string) => { await act(async () => button(label).click()); await flush(); };
  const pointer = async (element: Element, type: string, x: number, y: number) => {
    await act(async () => element.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })));
  };
  const key = async (element: Element, value: string) => { await act(async () => element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }))); await flush(); };
  const writes = () => requests.filter((request) => request.method === "PUT");
  const dispose = async () => { await act(async () => root.unmount()); restores.reverse().forEach((restore) => restore()); dom.window.close(); };
  return { dom, container, state, requests, localCalls, busyStates, mount, render, button, click, pointer, key, writes, dispose };
}

test("Step map saves one snapped drag/resize/route result, then restores it when reopened", async () => {
  const h = await harness();
  try {
    await h.mount();
    const move = h.button("Move Receive");
    await h.pointer(move, "pointerdown", 100, 100);
    await h.pointer(move, "pointermove", 125, 141);
    await h.pointer(move, "pointermove", 143, 150);
    assert.equal(h.writes().length, 0, "pointer movement must remain local");
    await h.pointer(move, "pointerup", 143, 150);
    await flush();
    assert.equal(h.writes().length, 1);
    assert.equal(h.writes()[0].body.base_revision, 3);
    assert.deepEqual(h.writes()[0].body.steps[0], { process_step_id: "a", x: 112, y: 112, width: 224, height: 112 });
    assert.deepEqual(Object.keys(h.writes()[0].body).sort(), ["base_revision", "company_id", "routes", "steps"], "layout writes must carry no Node or runtime payload");
    await h.key(h.button("Resize Receive"), "ArrowRight");
    assert.equal(h.state.layout.steps[0].width, 240);
    const edge = h.container.querySelector('[aria-label="Connection from Receive to Check"]')!;
    await h.key(edge, "Enter");
    await h.key(h.button("Move route point 1"), "ArrowDown");
    assert.equal(h.state.layout.routes[0].points[0].y, 192);
    const saved = structuredClone(h.state.layout);
    h.state.processID = "another-process";
    await h.mount();
    h.state.processID = "process";
    await h.mount();
    assert.deepEqual(h.state.layout, saved);
    const card = h.container.querySelector<HTMLElement>('[data-step-map-id="a"]')!;
    assert.equal(card.style.left, "112px");
    assert.equal(card.style.width, "240px");
  } finally { await h.dispose(); }
});

test("failed layout save rolls back, conflict loads current saved geometry, and denied editing sends no commands", async () => {
  const h = await harness();
  try {
    await h.mount();
    h.state.saveMode = "failure";
    await h.key(h.button("Move Receive"), "ArrowRight");
    assert.match(h.container.textContent ?? "", /not saved/);
    assert.equal(h.container.querySelector<HTMLElement>('[data-step-map-id="a"]')!.style.left, "64px");
    h.state.saveMode = "conflict";
    await h.key(h.button("Move Receive"), "ArrowRight");
    assert.match(h.container.textContent ?? "", /Someone changed this map/);
    assert.equal(h.container.querySelector<HTMLElement>('[data-step-map-id="a"]')!.style.left, "192px");
    assert.equal(h.state.layout.revision, 9);
    h.state.canEdit = false;
    await h.mount();
    const count = h.requests.length;
    await h.click("+ Create Step");
    await h.key(h.button("Move Receive"), "ArrowRight");
    assert.equal(h.requests.length, count);
  } finally { await h.dispose(); }
});

test("Step creation, naming, directed connection and deletion use existing definition commands", async () => {
  const h = await harness();
  try {
    await h.mount();
    await h.click("+ Create Step");
    assert.ok(h.container.querySelector('[data-step-map-id="new"]'));
    const input = h.container.querySelector<HTMLInputElement>('[aria-label="Step name"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(h.dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "Confirm order");
      input.dispatchEvent(new h.dom.window.Event("input", { bubbles: true }));
    });
    await h.click("Save name");
    assert.equal(h.state.steps.find((step) => step.process_step_id === "new")?.name, "Confirm order");
    const select = h.container.querySelector<HTMLSelectElement>('[aria-label="Connect to Step"]')!;
    await act(async () => { select.value = "a"; select.dispatchEvent(new h.dom.window.Event("change", { bubbles: true })); });
    await h.click("Connect");
    const createEdge = h.requests.find((request) => request.path.endsWith("/step-relationships") && request.method === "POST")!;
    assert.deepEqual(createEdge.body.source, { resource_type: "process_step", resource_id: "new" });
    assert.deepEqual(createEdge.body.target, { resource_type: "process_step", resource_id: "a" });
    await h.click("Delete connection");
    assert.equal(h.state.steps.length, 3);
    await h.click("Move Confirm order");
    await h.click("Delete Step");
    assert.equal(h.state.steps.length, 3, "deleting a Step asks before changing the definition");
    await h.click("Confirm delete Step");
    assert.equal(h.state.steps.length, 2);
    assert.ok(h.requests.every((request) => !request.path.includes("/nodes")), "map authoring never creates, changes or copies a runtime Node");
  } finally { await h.dispose(); }
});

test("a delayed old-Process read cannot restore its geometry after navigation", async () => {
  const h = await harness();
  let resolveOld!: (value: Response) => void;
  try {
    const pending = new Promise<Response>((resolve) => { resolveOld = resolve; });
    h.state.customFetch = (request) => request.method === "GET" && request.path.includes("/process/") ? pending : null;
    await h.mount();
    h.state.processID = "new-process";
    h.state.steps = [{ process_step_id: "new-owner-step", logic_gate_id: "new-process", name: "New owner", position: 1000 }];
    h.state.relationships = [];
    h.state.layout = { revision: 1, steps: [{ process_step_id: "new-owner-step", x: 320, y: 160, width: 224, height: 112 }], routes: [] };
    await h.mount();
    await act(async () => resolveOld(response(initialLayout)));
    await flush();
    assert.equal(h.container.querySelector('[data-step-map-id="a"]'), null);
    assert.equal(h.container.querySelector<HTMLElement>('[data-step-map-id="new-owner-step"]')!.style.left, "320px");
  } finally { await h.dispose(); }
});

test("negative-coordinate dragging keeps its canvas origin stable and remote Step deletion cancels the gesture", async () => {
  const h = await harness();
  try {
    await h.mount();
    const move = h.button("Move Receive");
    const oldBounds = h.container.querySelector("svg")!.getAttribute("viewBox");
    await h.pointer(move, "pointerdown", 100, 100);
    await h.pointer(move, "pointermove", -100, -100);
    assert.equal(h.container.querySelector("svg")!.getAttribute("viewBox"), oldBounds, "dragging must not shift the coordinate system under the pointer");
    h.state.steps = h.state.steps.filter((step) => step.process_step_id !== "a");
    h.state.relationships = [];
    await h.mount();
    await h.pointer(h.container.querySelector(".process-step-map__viewport")!, "pointerup", -100, -100);
    await flush();
    assert.equal(h.writes().length, 0, "a deleted Step must not save its stale gesture");
    assert.equal(h.container.querySelector('[data-step-map-id="a"]'), null);
  } finally { await h.dispose(); }
});

test("saving blocks overlapping gestures and publishes its exact Process after unmount", async () => {
  const h = await harness();
  let resolveSave!: (value: Response) => void;
  try {
    await h.mount();
    const committed: unknown[] = [];
    h.dom.window.addEventListener("mangorts:process-work-updated", (event) => committed.push((event as CustomEvent).detail));
    const pending = new Promise<Response>((resolve) => { resolveSave = resolve; });
    h.state.customFetch = (request) => request.method === "PUT" ? pending : null;
    await h.key(h.button("Move Receive"), "ArrowRight");
    assert.equal(h.button("Move Receive").getAttribute("aria-disabled"), "true");
    await h.key(h.button("Move Check"), "ArrowRight");
    assert.equal(h.writes().length, 1);
    h.state.processID = "new-process";
    h.state.steps = [{ process_step_id: "new-owner-step", logic_gate_id: "new-process", name: "New owner", position: 1000 }];
    h.state.relationships = [];
    h.state.layout = { revision: 1, steps: [{ process_step_id: "new-owner-step", x: 320, y: 160, width: 224, height: 112 }], routes: [] };
    await h.mount();
    await act(async () => resolveSave(response({ ...initialLayout, revision: 4 })));
    await flush();
    assert.deepEqual(committed, [{ companyID: "company", logicGateID: "process" }]);
    assert.equal(h.container.querySelector('[data-step-map-id="a"]'), null);
    assert.equal(h.container.querySelector<HTMLElement>('[data-step-map-id="new-owner-step"]')!.style.left, "320px");
  } finally { await h.dispose(); }
});

test("keyboard movement keeps focus through save and failure without stealing a later focus choice", async () => {
  const h = await harness();
  let resolveSave!: (value: Response) => void;
  try {
    await h.mount();
    const move = h.button("Move Receive");
    move.focus();
    const pending = new Promise<Response>((resolve) => { resolveSave = resolve; });
    h.state.customFetch = (request) => request.method === "PUT" ? pending : null;
    await h.key(move, "ArrowRight");
    assert.equal(move.getAttribute("aria-disabled"), "true");
    assert.equal(move.disabled, false, "native disabled must not discard the originating keyboard focus");
    assert.equal(h.dom.window.document.activeElement, move);
    await h.key(h.dom.window.document.activeElement!, "ArrowRight");
    assert.equal(h.writes().length, 1, "saving blocks another mutation from the still-focused control");
    const saved = h.writes()[0].body;
    h.state.layout = { revision: 4, steps: saved.steps, routes: saved.routes };
    h.state.customFetch = null;
    await act(async () => resolveSave(response(h.state.layout)));
    await flush();
    assert.equal(h.dom.window.document.activeElement, move);
    await h.key(h.dom.window.document.activeElement!, "ArrowRight");
    assert.equal(h.state.layout.steps[0].x, 96, "the next arrow works without another click");
    h.state.saveMode = "failure";
    await h.key(h.dom.window.document.activeElement!, "ArrowRight");
    assert.equal(h.dom.window.document.activeElement, move);
    assert.equal(h.state.layout.steps[0].x, 96);
    h.state.customFetch = (request) => request.method === "PUT" ? new Promise<Response>((resolve) => { resolveSave = resolve; }) : null;
    await h.key(move, "ArrowRight");
    const zoom = h.button("Zoom in");
    zoom.focus();
    await act(async () => resolveSave(response({ error: "Save failed" }, 500)));
    await flush();
    assert.equal(h.dom.window.document.activeElement, zoom, "saving must never restore focus over the user's later choice");
  } finally { await h.dispose(); }
});

test("waypoint clicks do not save and repeated keyboard route edits retain their focus", async () => {
  const h = await harness();
  try {
    await h.mount();
    await h.key(h.container.querySelector('[aria-label="Connection from Receive to Check"]')!, "Enter");
    const point = h.button("Move route point 1");
    await h.pointer(point, "pointerdown", 368, 176);
    await h.pointer(point, "pointerup", 368, 176);
    await h.click("Move route point 1");
    assert.equal(h.writes().length, 0, "selecting an unchanged route point must not issue a layout PUT");
    point.focus();
    await h.key(h.dom.window.document.activeElement!, "ArrowDown");
    assert.equal(h.dom.window.document.activeElement, point);
    await h.key(h.dom.window.document.activeElement!, "ArrowDown");
    assert.equal(h.dom.window.document.activeElement, point);
    assert.equal(h.state.layout.routes[0].points[0].y, 208);
  } finally { await h.dispose(); }
});

test("draft map uses only supplied local commands for geometry, Steps, and connections", async () => {
  const h = await harness(true);
  try {
    await h.mount();
    assert.match(h.container.textContent ?? "", /Unsaved changes stay here/);
    await h.key(h.button("Move Receive"), "ArrowRight");
    assert.equal(h.state.layout.steps[0].x, 80);
    assert.match(h.container.textContent ?? "", /Unsaved changes kept until you save the Process/);
    await h.click("+ Create Step");
    const input = h.container.querySelector<HTMLInputElement>('[aria-label="Step name"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(h.dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "Draft review");
      input.dispatchEvent(new h.dom.window.Event("input", { bubbles: true }));
    });
    await h.click("Apply name");
    assert.equal(h.state.steps.find((step) => step.process_step_id === "new")?.name, "Draft review");
    const select = h.container.querySelector<HTMLSelectElement>('[aria-label="Connect to Step"]')!;
    await act(async () => { select.value = "a"; select.dispatchEvent(new h.dom.window.Event("change", { bubbles: true })); });
    await h.click("Connect");
    await h.click("Delete connection");
    await h.click("Move Draft review");
    await h.click("Delete Step");
    await h.click("Confirm delete Step");
    assert.deepEqual(h.localCalls, ["layout", "create", "rename", "connect", "disconnect", "delete"]);
    assert.equal(h.state.steps.length, 2);
    assert.deepEqual(h.requests, [], "a draft editor must not access an app API");
  } finally { await h.dispose(); }
});

test("draft busy state covers gestures and pending mutations, and failure restores the draft", async () => {
  const h = await harness(true);
  let resolveSave!: (layout: ProcessStepMapLayout) => void;
  try {
    await h.mount();
    assert.deepEqual(h.busyStates, [true, false]);
    const move = h.button("Move Receive");
    await h.pointer(move, "pointerdown", 100, 100);
    assert.equal(h.busyStates.at(-1), true);
    await h.key(move, "Escape");
    assert.equal(h.busyStates.at(-1), false);
    assert.deepEqual(h.localCalls, []);
    h.state.customLocalSave = () => new Promise((resolve) => { resolveSave = resolve; });
    await h.pointer(move, "pointerdown", 100, 100);
    await h.pointer(move, "pointermove", 132, 100);
    await h.pointer(move, "pointerup", 132, 100);
    assert.equal(h.busyStates.at(-1), true, "finishing a drag remains busy until the local command finishes");
    assert.equal(h.button("+ Create Step").disabled, true);
    const saved = { ...h.state.layout, revision: 4, steps: h.state.layout.steps.map((box) => box.process_step_id === "a" ? { ...box, x: 96 } : box) };
    h.state.layout = saved;
    h.state.customLocalSave = null;
    await act(async () => resolveSave(saved));
    await flush();
    assert.equal(h.busyStates.at(-1), false);
    h.state.saveMode = "failure";
    await h.key(move, "ArrowRight");
    assert.match(h.container.textContent ?? "", /previous draft layout/);
    assert.equal(h.container.querySelector<HTMLElement>('[data-step-map-id="a"]')!.style.left, "96px");
    assert.equal(h.busyStates.at(-1), false);
    assert.deepEqual(h.requests, []);
  } finally { await h.dispose(); }
  assert.equal(h.busyStates.at(-1), false, "unmount releases the outer Save control");
});

test("saved and draft blank-canvas menus reuse creation actions without intercepting Steps", async () => {
  for (const draft of [false, true]) {
    const h = await harness(draft);
    try {
      await h.mount();
      const open = async (element: Element) => {
        await act(async () => element.dispatchEvent(new h.dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })));
        await flush();
      };
      await open(h.button("Move Receive"));
      assert.equal(h.dom.window.document.querySelector('[aria-label="Process map creation"]'), null);
      await open(h.container.querySelector(".process-step-map__viewport")!);
      await h.click("Create Folder");
      await open(h.container.querySelector(".process-step-map__canvas")!);
      await h.click("Create Process");
      await open(h.container.querySelector(".process-step-map__canvas")!);
      await h.click("Create Step");
      assert.ok(h.container.querySelector('[data-step-map-id="new"]'));
      assert.deepEqual(h.localCalls.filter((call) => call === "folder" || call === "process"), ["folder", "process"]);
      if (draft) assert.deepEqual(h.requests, []);
      h.state.canEdit = false;
      await h.mount();
      await open(h.container.querySelector(".process-step-map__canvas")!);
      assert.equal(h.button("Create Step").disabled, true);
      await h.key(h.button("Create Folder"), "Escape");
      assert.equal(h.dom.window.document.querySelector('[aria-label="Process map creation"]'), null);
    } finally { await h.dispose(); }
  }
});
