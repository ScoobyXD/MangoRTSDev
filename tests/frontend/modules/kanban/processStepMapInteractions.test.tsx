import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { ProcessStepMapLayout } from "../../../../frontend/src/modules/kanban/processStepMapGeometry.js";
import type { ProcessStep, ProcessStepRelationship } from "../../../../frontend/src/modules/kanban/processWork.js";
import type { ProcessStepMapActions, ProcessStepMapCommands, ProcessStepMapEditorProps } from "../../../../frontend/src/modules/kanban/ProcessStepMap.js";

const initialSteps: ProcessStep[] = [
  { process_step_id: "a", logic_gate_id: "process", name: "Receive", position: 1000, body_json: { format: "mango-tiptap-json", schema_version: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Record the delivery." }] }] } } },
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

async function harness(isNew = false, normalizeZoom = true, authoring = false) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (original) Object.defineProperty(globalThis, name, original); else delete (globalThis as Record<string, unknown>)[name]; });
  };
  for (const name of ["window", "document", "navigator", "Element", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "CustomEvent", "localStorage"]) install(name, name === "window" ? dom.window : name === "document" ? dom.window.document : (dom.window as any)[name]);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  const state = { steps: structuredClone(initialSteps), relationships: [structuredClone(initialEdge)], layout: structuredClone(initialLayout), processID: "process", showMap: true, canEdit: true, hoverModeEnabled: false, editBodies: false, editorPlacement: null as ProcessStepMapEditorProps["stepEditorPlacement"], saveMode: "success" as "success" | "failure" | "conflict", customFetch: null as ((request: Request) => Promise<Response> | null) | null, customLocalSave: null as ((layout: ProcessStepMapLayout) => Promise<ProcessStepMapLayout>) | null };
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
  const createdStepIDs: string[] = [];
  const editorPlacements: Array<ProcessStepMapEditorProps["stepEditorPlacement"]> = [];
  let disposed = false;
  const commands: ProcessStepMapCommands = {
    readLayout: async () => state.layout,
    saveLayout: async (layout) => {
      localCalls.push("layout");
      if (state.customLocalSave) return state.customLocalSave(layout);
      if (state.saveMode === "failure") throw new Error("Could not update new Process");
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
  const renderActions = ({ createStep, disabled }: ProcessStepMapActions) => <div aria-label="Canvas actions"><button type="button" disabled={disabled} onClick={createStep}>Create Step</button></div>;
  const render = () => {
    if (disposed) return;
    const props = { steps: [...state.steps], relationships: [...state.relationships], canEdit: state.canEdit, onChanged: render, onBusyChange, onStepCreated: (stepID: string) => createdStepIDs.push(stepID), stepEditorPlacement: state.editorPlacement, onStepEditorPlacementChange: state.editBodies ? (placement: ProcessStepMapEditorProps["stepEditorPlacement"]) => { state.editorPlacement = placement; editorPlacements.push(placement); render(); } : undefined, authoring, processName: "Order Process", hoverModeEnabled: state.hoverModeEnabled, renderActions };
    root.render(!state.showMap ? <div>Map closed</div> : isNew
      ? <ProcessStepMapEditor key={state.processID} {...props} commands={commands} saveMode="new" />
      : <ProcessStepMap apiBase="http://localhost" companyID="company" processID={state.processID} {...props} />);
  };
  const mount = async () => {
    await act(async () => render()); await flush();
    // Existing gesture cases run at an explicit 100% camera; initial framing is covered separately.
    if (normalizeZoom) await act(async () => container.querySelector(".process-step-map__viewport")!.dispatchEvent(new dom.window.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: Math.log(.85) / .002 })));
  };
  const button = (label: string): HTMLButtonElement => {
    const result = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
    assert.ok(result, `Missing button ${label}`);
    return result;
  };
  const click = async (label: string) => { await act(async () => button(label).click()); await flush(); };
  const input = async (value: string) => {
    const element = container.querySelector<HTMLInputElement>('[aria-label="Step name"]');
    assert.ok(element, "inline Step name must be available");
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    return element;
  };
  const doubleClick = async (element: Element, x = 0, y = 0) => { await act(async () => element.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2, clientX: x, clientY: y }))); await flush(); };
  const pointer = async (element: Element, type: string, x: number, y: number) => {
    await act(async () => element.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })));
  };
  const key = async (element: Element, value: string) => { await act(async () => element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }))); await flush(); };
  const writes = () => requests.filter((request) => request.method === "PUT");
  const dispose = async () => { disposed = true; await act(async () => root.unmount()); restores.reverse().forEach((restore) => restore()); dom.window.close(); };
  return { dom, container, state, requests, localCalls, busyStates, createdStepIDs, editorPlacements, mount, render, button, click, input, doubleClick, pointer, key, writes, dispose };
}

function cameraFixture(h: Awaited<ReturnType<typeof harness>>) {
  const viewport = h.container.querySelector<HTMLElement>(".process-step-map__viewport")!;
  const canvas = h.container.querySelector<HTMLElement>(".process-step-map__canvas")!;
  viewport.style.padding = "80px 24px 24px";
  Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 800 }, clientHeight: { configurable: true, value: 600 } });
  viewport.getBoundingClientRect = () => ({ x: 20, y: 30, left: 20, top: 30, right: 820, bottom: 630, width: 800, height: 600, toJSON() {} });
  const read = () => {
    const transform = canvas.style.transform.match(/^translate\(([-\d.e+]+)px, ([-\d.e+]+)px\) scale\(([-\d.e+]+)\)$/);
    assert.ok(transform, `missing canvas camera transform: ${canvas.style.transform}`);
    return { x: Number(transform[1]), y: Number(transform[2]), zoom: Number(transform[3]) };
  };
  const wheel = async (deltaY: number, deltaMode = 0, target: Element = viewport) => {
    const event = new h.dom.window.WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 244, clientY: 260, deltaY, deltaMode });
    await act(async () => target.dispatchEvent(event));
    await flush();
    return event;
  };
  const screenPosition = (stepID: string) => {
    const step = h.container.querySelector<HTMLElement>(`[data-step-map-id="${stepID}"]`)!;
    const transform = read();
    return { x: transform.x + Number.parseFloat(step.style.left) * transform.zoom, y: transform.y + Number.parseFloat(step.style.top) * transform.zoom };
  };
  return { viewport, canvas, read, wheel, screenPosition };
}

const near = (actual: number, expected: number, message?: string) => assert.ok(Math.abs(actual - expected) < 1e-7, message ?? `expected ${actual} to equal ${expected}`);

function connectionFixture(h: Awaited<ReturnType<typeof harness>>) {
  const viewport = h.container.querySelector<HTMLElement>(".process-step-map__viewport")!;
  let hit: Element | null = null;
  const hitPoints: Array<[number, number]> = [];
  Object.defineProperty(h.dom.window.document, "elementFromPoint", { configurable: true, value: (x: number, y: number) => { hitPoints.push([x, y]); return hit; } });
  const port = (name: string, side: "input" | "output") => h.button(`Connect ${side === "input" ? "into" : "from"} ${name}`);
  const preview = () => h.container.querySelector<SVGPathElement>(".process-step-map__connection-preview");
  const hover = async (target: Element | null, x = 480, y = 312) => { hit = target; await h.pointer(viewport, "pointermove", x, y); };
  const drop = async (target: Element | null, x = 480, y = 312) => { hit = target; await h.pointer(viewport, "pointerup", x, y); await flush(); };
  return { viewport, port, preview, hover, drop, hitPoints };
}

test("canvas ports create one directed connection at the current zoom and reuse an existing pair", async () => {
  const h = await harness();
  try {
    h.state.relationships = [];
    h.state.layout.routes = [];
    await h.mount();
    const c = cameraFixture(h), p = connectionFixture(h);
    c.canvas.getBoundingClientRect = () => {
      const camera = c.read(), x = 44 + camera.x, y = 110 + camera.y;
      const width = Number.parseFloat(c.canvas.parentElement!.style.width) * camera.zoom, height = Number.parseFloat(c.canvas.parentElement!.style.height) * camera.zoom;
      return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {} };
    };
    await c.wheel(-Math.log(2) / .002);
    const cameraBefore = c.read(), layoutBefore = structuredClone(h.state.layout);
    const source = p.port("Receive", "output"), target = p.port("Check", "input");
    assert.equal(source.dataset.stepMapPort, "output");
    assert.equal(target.dataset.stepMapPort, "input");
    await h.pointer(source, "pointerdown", 420, 200);
    assert.ok(p.preview(), "dragging from a port must show a live connection");
    const firstPath = p.preview()!.getAttribute("d");
    assert.equal(h.busyStates.at(-1), true);
    assert.equal(h.button("Create Step").disabled, true);
    await p.hover(null, 580, 420);
    assert.notEqual(p.preview()!.getAttribute("d"), firstPath, "the preview must follow the pointer before a target is reached");
    const pathCoordinates = p.preview()!.getAttribute("d")!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
    assert.deepEqual(pathCoordinates.slice(0, 2), [288, 120], "the path must start at the output port in world coordinates");
    near(pathCoordinates.at(-2)!, 368);
    near(pathCoordinates.at(-1)!, 230);
    await c.wheel(-200);
    assert.deepEqual(c.read(), cameraBefore, "connection dragging must lock camera zoom");
    await p.hover(target, 804, 584);
    assert.ok(target.classList.contains("is-connection-target"));
    assert.deepEqual(p.hitPoints.at(-1), [804, 584], "port hit testing must use screen coordinates even while zoomed");
    assert.equal(h.requests.filter((request) => request.method !== "GET").length, 0);
    await p.drop(target, 804, 584);
    assert.deepEqual(h.requests.filter((request) => request.method !== "GET"), [{ path: "/v2/logic-gates/process/step-relationships", method: "POST", body: { company_id: "company", source: { resource_type: "process_step", resource_id: "a" }, target: { resource_type: "process_step", resource_id: "b" } } }]);
    assert.equal(p.preview(), null);
    assert.equal(h.container.querySelector(".is-connection-target"), null);
    assert.equal(h.busyStates.at(-1), false);
    assert.deepEqual(h.state.layout, layoutBefore, "connecting must not drag or resize either Step");
    assert.deepEqual(c.read(), cameraBefore, "port events must not bubble into blank-canvas panning");
    assert.ok(h.container.querySelector('[aria-label="Connection from Receive to Check"]'));
    await h.click("Move Receive");
    await h.pointer(p.port("Check", "input"), "pointerdown", 804, 584);
    await p.drop(p.port("Receive", "output"), 420, 200);
    assert.equal(h.requests.filter((request) => request.method === "POST").length, 1, "the same directed pair must reuse its existing relationship");
    assert.ok(h.container.querySelector('.process-step-map__edges .is-selected [aria-label="Connection from Receive to Check"]'));
    assert.equal(h.writes().length, 0);
  } finally { await h.dispose(); }
});

test("dragging backward from an input to an output connects the output Step to the input Step locally", async () => {
  const h = await harness(true);
  try {
    h.state.relationships = [];
    h.state.layout.routes = [];
    await h.mount();
    const p = connectionFixture(h);
    await h.pointer(p.port("Check", "input"), "pointerdown", 480, 312);
    await p.hover(p.port("Receive", "output"), 288, 120);
    assert.ok(p.port("Receive", "output").classList.contains("is-connection-target"));
    await p.drop(p.port("Receive", "output"), 288, 120);
    assert.deepEqual(h.localCalls, ["connect"]);
    assert.deepEqual(h.state.relationships, [{ resource_operational_relationship_id: "new-edge", source: { resource_type: "process_step", resource_id: "a" }, target: { resource_type: "process_step", resource_id: "b" } }]);
    assert.deepEqual(h.requests, [], "new Process connections must use the supplied local command only");
    assert.equal(h.busyStates.at(-1), false);
  } finally { await h.dispose(); }
});

test("keyboard users can connect opposite ports with Enter or Space and cancel with Escape", async () => {
  const h = await harness(true);
  try {
    h.state.relationships = [];
    h.state.layout.routes = [];
    await h.mount();
    const p = connectionFixture(h);
    const source = p.port("Receive", "output"), target = p.port("Check", "input");
    await act(async () => source.focus());
    await h.key(source, "Enter");
    assert.ok(p.preview());
    assert.equal(h.busyStates.at(-1), true);
    await h.key(p.port("Check", "output"), "Enter");
    assert.deepEqual(h.localCalls, [], "a same-side keyboard activation cannot complete a connection");
    // jsdom does not perform native Tab focus traversal.
    await act(async () => target.focus());
    await h.key(target, " ");
    assert.deepEqual(h.localCalls, ["connect"]);
    assert.deepEqual(h.state.relationships[0].source, { resource_type: "process_step", resource_id: "a" });
    assert.deepEqual(h.state.relationships[0].target, { resource_type: "process_step", resource_id: "b" });
    assert.equal(p.preview(), null);
    assert.equal(h.dom.window.document.activeElement, target);
    await h.key(p.port("Receive", "input"), " ");
    assert.ok(p.preview());
    await h.key(p.port("Receive", "input"), "Escape");
    assert.equal(p.preview(), null);
    assert.deepEqual(h.localCalls, ["connect"]);
    assert.deepEqual(h.requests, []);
    assert.equal(h.busyStates.at(-1), false);
  } finally { await h.dispose(); }
});

test("blank, same-Step, same-side and outside-canvas connection drops do not issue commands", async () => {
  const h = await harness();
  try {
    await h.mount();
    const p = connectionFixture(h);
    const outside = p.port("Check", "input").cloneNode(true) as HTMLButtonElement;
    h.dom.window.document.body.append(outside);
    const invalidTargets = [null, p.port("Receive", "input"), p.port("Check", "output"), outside];
    for (const target of invalidTargets) {
      await h.pointer(p.port("Receive", "output"), "pointerdown", 288, 120);
      await p.hover(target);
      assert.ok(p.preview());
      assert.equal(h.container.querySelector(".is-connection-target"), null);
      await p.drop(target);
      assert.equal(p.preview(), null);
      assert.equal(h.busyStates.at(-1), false);
    }
    assert.deepEqual(h.requests.filter((request) => request.method !== "GET"), []);
    assert.deepEqual(h.state.layout, initialLayout);
    assert.deepEqual(h.state.relationships, [initialEdge]);
  } finally { await h.dispose(); }
});

test("connection cancellation and permission loss discard the preview and prevent later release from saving", async () => {
  const h = await harness();
  try {
    h.state.relationships = [];
    h.state.layout.routes = [];
    await h.mount();
    const p = connectionFixture(h);
    for (const cancellation of ["pointercancel", "Escape", "lostpointercapture", "permission"] as const) {
      const source = p.port("Receive", "output");
      await h.pointer(source, "pointerdown", 288, 120);
      await p.hover(p.port("Check", "input"));
      assert.ok(p.preview());
      if (cancellation === "Escape") await h.key(source, "Escape");
      else if (cancellation === "permission") { h.state.canEdit = false; await h.mount(); }
      else await h.pointer(source, cancellation, 480, 312);
      assert.equal(p.preview(), null, `${cancellation} must clear the temporary path`);
      assert.equal(h.container.querySelector(".is-connection-target"), null);
      await p.drop(p.port("Check", "input"));
      assert.equal(h.busyStates.at(-1), false);
      if (cancellation === "permission") {
        await h.pointer(p.port("Receive", "output"), "pointerdown", 288, 120);
        await p.drop(p.port("Check", "input"));
        assert.equal(p.preview(), null, "read-only ports cannot begin a new connection");
      }
    }
    assert.deepEqual(h.requests.filter((request) => request.method !== "GET"), []);
    assert.deepEqual(h.state.relationships, []);
    h.state.canEdit = true;
    await h.mount();
    assert.equal(p.preview(), null, "restoring permission must not resume the cancelled connection");
    await p.drop(p.port("Check", "input"));
    assert.deepEqual(h.requests.filter((request) => request.method !== "GET"), []);
  } finally { await h.dispose(); }
});

test("a pending connection blocks overlapping edits and a failed save leaves no edge before retry", async () => {
  const h = await harness();
  let releaseConnection!: (value: Response) => void;
  try {
    h.state.relationships = [];
    h.state.layout.routes = [];
    await h.mount();
    const p = connectionFixture(h), layoutBefore = structuredClone(h.state.layout);
    h.state.customFetch = (request) => request.path.endsWith("/step-relationships") && request.method === "POST" ? new Promise((resolve) => { releaseConnection = resolve; }) : null;
    await h.pointer(p.port("Receive", "output"), "pointerdown", 288, 120);
    await p.drop(p.port("Check", "input"));
    assert.equal(h.busyStates.at(-1), true);
    assert.equal(p.preview(), null);
    assert.equal(h.button("Create Step").disabled, true);
    await h.pointer(p.port("Check", "output"), "pointerdown", 704, 312);
    await p.drop(p.port("Receive", "input"));
    await h.pointer(h.button("Move Receive"), "pointerdown", 100, 100);
    await h.pointer(p.viewport, "pointerup", 148, 132);
    assert.equal(h.requests.filter((request) => request.method === "POST").length, 1);
    assert.equal(h.writes().length, 0);
    await act(async () => releaseConnection(response({ error: "Connection denied" }, 403)));
    await flush();
    assert.match(h.container.querySelector('[role="alert"]')?.textContent ?? "", /Connection denied/);
    assert.equal(h.container.querySelector('[aria-label="Connection from Receive to Check"]'), null);
    assert.deepEqual(h.state.relationships, []);
    assert.deepEqual(h.state.layout, layoutBefore);
    assert.equal(h.busyStates.at(-1), false);
    h.state.customFetch = null;
    await h.pointer(p.port("Receive", "output"), "pointerdown", 288, 120);
    await p.drop(p.port("Check", "input"));
    assert.equal(h.requests.filter((request) => request.method === "POST").length, 2);
    assert.equal(h.state.relationships.length, 1);
    assert.ok(h.container.querySelector('[aria-label="Connection from Receive to Check"]'));
    assert.equal(h.container.querySelector('[role="alert"]'), null);
    assert.equal(h.writes().length, 0);
  } finally { await h.dispose(); }
});

test("readonly canvas pans on blank space and restores the starting view on pointercancel or Escape without saving", async () => {
  const h = await harness();
  try {
    h.state.canEdit = false;
    await h.mount();
    const c = cameraFixture(h);
    const busyBefore = [...h.busyStates];
    await h.pointer(c.viewport, "pointerdown", 300, 300);
    await h.pointer(c.viewport, "pointermove", 390, 345);
    await h.pointer(c.viewport, "pointerup", 390, 345);
    assert.deepEqual(c.read(), { x: 90, y: 45, zoom: 1 });
    await h.pointer(c.canvas, "pointerdown", 300, 300);
    await h.pointer(c.canvas, "pointermove", 320, 330);
    assert.deepEqual(c.read(), { x: 110, y: 75, zoom: 1 });
    await h.pointer(c.canvas, "pointercancel", 320, 330);
    assert.deepEqual(c.read(), { x: 90, y: 45, zoom: 1 });
    await h.pointer(c.viewport, "pointerdown", 300, 300);
    await h.pointer(c.viewport, "pointermove", 340, 280);
    await h.key(c.viewport, "Escape");
    assert.deepEqual(c.read(), { x: 90, y: 45, zoom: 1 });
    await h.pointer(h.button("Move Receive"), "pointerdown", 100, 100);
    await h.pointer(c.viewport, "pointermove", 200, 180);
    await h.pointer(c.viewport, "pointerup", 200, 180);
    assert.deepEqual(c.read(), { x: 90, y: 45, zoom: 1 }, "readonly Steps must not become pan handles");
    assert.deepEqual(h.busyStates, busyBefore, "camera movement must not make the editor busy");
    assert.deepEqual(h.requests.filter((request) => request.method !== "GET"), []);
    assert.deepEqual(h.state.layout, initialLayout);
  } finally { await h.dispose(); }
});

test("canvas wheel zoom keeps the pointer's world point fixed, normalizes wheel units and clamps the range", async () => {
  const h = await harness();
  try {
    await h.mount();
    const c = cameraFixture(h);
    const busyBefore = [...h.busyStates];
    assert.equal((await c.wheel(-Math.log(2) / .002)).defaultPrevented, true, "the native wheel handler must suppress page scrolling");
    near(c.read().zoom, 2);
    near(c.read().x, -200);
    near(c.read().y, -150);
    near((200 - c.read().x) / c.read().zoom, 200);
    near((150 - c.read().y) / c.read().zoom, 150);
    await c.wheel(-1, 1);
    near(c.read().zoom, 2 * Math.exp(16 * .002));
    const beforePage = c.read().zoom;
    await c.wheel(-.1, 2);
    near(c.read().zoom, beforePage * Math.exp(49.6 * .002));
    await c.wheel(-10000);
    near(c.read().zoom, 8);
    await c.wheel(10000);
    near(c.read().zoom, .5);
    assert.deepEqual(h.busyStates, busyBefore);
    assert.deepEqual(h.requests.filter((request) => request.method !== "GET"), []);
    assert.deepEqual(h.state.layout, initialLayout);
  } finally { await h.dispose(); }
});

test("Step movement and resizing block camera changes until cancelled", async () => {
  const h = await harness();
  try {
    await h.mount();
    const c = cameraFixture(h);
    const initial = c.read();
    const step = h.button("Move Receive");
    await h.pointer(step, "pointerdown", 100, 100);
    await c.wheel(-200);
    assert.deepEqual(c.read(), initial);
    await h.pointer(step, "pointercancel", 100, 100);
    const resize = h.button("Resize Receive");
    await h.pointer(resize, "pointerdown", 288, 176);
    await c.wheel(-200);
    assert.deepEqual(c.read(), initial);
    await h.pointer(resize, "pointercancel", 288, 176);
    await c.wheel(-Math.log(1.25) / .002);
    near(c.read().zoom, 1.25);
    assert.equal(h.writes().length, 0);
  } finally { await h.dispose(); }
});

test("inline text and connection controls cannot start canvas panning", async () => {
  const h = await harness();
  try {
    await h.mount();
    const c = cameraFixture(h);
    await h.doubleClick(h.button("Move Receive"));
    const input = h.container.querySelector<HTMLInputElement>('[aria-label="Step name"]')!;
    const initial = c.read();
    const busyBefore = [...h.busyStates];
    await h.pointer(input, "pointerdown", 100, 100);
    await h.pointer(c.viewport, "pointermove", 200, 180);
    await h.pointer(c.viewport, "pointerup", 200, 180);
    assert.equal((await c.wheel(-200, 0, input)).defaultPrevented, false, "wheel input over a text field must remain native");
    assert.deepEqual(c.read(), initial);
    assert.deepEqual(h.busyStates, busyBefore);
    await h.key(input, "Escape");
    const edge = h.container.querySelector('[aria-label="Connection from Receive to Check"]')!;
    await h.pointer(edge, "pointerdown", 100, 100);
    await h.pointer(c.viewport, "pointermove", 200, 180);
    await h.pointer(c.viewport, "pointerup", 200, 180);
    assert.deepEqual(c.read(), initial, "a connection hit target must not be treated as blank space");
    assert.deepEqual(h.requests.filter((request) => request.method !== "GET"), []);
  } finally { await h.dispose(); }
});

test("negative Step bounds cannot shift unrelated Steps on screen when zoomed and moved", async () => {
  const h = await harness();
  try {
    h.state.layout.steps[0] = { ...h.state.layout.steps[0], x: -144, y: -80 };
    await h.mount();
    const c = cameraFixture(h);
    await c.wheel(-Math.log(2) / .002);
    const fixed = c.screenPosition("b");
    await h.key(h.button("Move Receive"), "ArrowLeft");
    assert.deepEqual(c.screenPosition("b"), fixed, "normalizing a new negative bound must not move an untouched Step on screen");
    assert.equal(h.state.layout.steps[0].x, -160);
    assert.equal(h.writes().length, 1, "only the authored Step movement may save geometry");
  } finally { await h.dispose(); }
});

test("canvas creates and names Steps inline without inspectors or separate zoom controls", async () => {
  const h = await harness();
  try {
    await h.mount();
    assert.ok(h.container.querySelector(".process-step-map--canvas"));
    assert.equal(h.container.querySelector(".process-step-map__toolbar"), null);
    assert.equal(h.container.querySelector(".process-step-map__zoom"), null);
    await h.click("Create Step");
    assert.equal(h.requests.filter((request) => request.method === "POST" && request.path.endsWith("/steps")).length, 1);
    assert.deepEqual(h.createdStepIDs, ["new"]);
    assert.ok(h.container.querySelector('[data-step-map-id="new"].is-selected'));
    assert.equal(h.container.querySelector('[aria-label="Selected Step"]'), null);
    const step = h.container.querySelector<HTMLElement>('[data-step-map-id="new"]')!;
    assert.equal(step.style.width, "256px");
    assert.equal(step.style.height, "80px");
    const input = step.querySelector<HTMLInputElement>('[aria-label="Step name"]')!;
    assert.ok(input, "new Steps must be named directly in their card");
    assert.equal(h.dom.window.document.activeElement, input);
    assert.equal(input.selectionStart, 0);
    assert.equal(input.selectionEnd, input.value.length);
    await h.key(input, "Escape");
    assert.equal(h.button("Create Step").disabled, false);
    await h.click("Move New step");
    assert.equal(h.container.querySelector('[aria-label="Selected Step"]'), null);
    const edge = h.container.querySelector('[aria-label="Connection from Receive to Check"]')!;
    await h.key(edge, "Enter");
    assert.equal(h.container.querySelector('[aria-label="Selected connection"]'), null);
    h.state.canEdit = false;
    await h.mount();
    assert.equal(h.button("Create Step").disabled, true);
  } finally { await h.dispose(); }
});

test("focused canvas context menus create Steps without offering Folder or Process creation", async () => {
  const h = await harness(true);
  try {
    await h.mount();
    const viewport = h.container.querySelector(".process-step-map__viewport")!;
    await h.pointer(viewport, "contextmenu", 400, 300);
    const menu = h.dom.window.document.querySelector('[role="menu"][aria-label="Process map creation"]')!;
    assert.ok(menu);
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    assert.deepEqual(items.map((item) => item.textContent), ["Create Step"]);
    await h.pointer(items[0], "pointerdown", 410, 310);
    assert.ok(h.dom.window.document.querySelector('[aria-label="Process map creation"]'), "pressing a menu action must keep it available for the click");
    await act(async () => items[0].click());
    await flush();
    assert.ok(h.container.querySelector('[data-step-map-id="new"] input[aria-label="Step name"]'));
    assert.deepEqual(h.localCalls, ["create"]);
    assert.deepEqual(h.createdStepIDs, ["new"]);
    assert.deepEqual(h.requests, []);
  } finally { await h.dispose(); }
});

test("Step previews preserve instruction paragraphs, formatting and lists without changing documents or saved dimensions", async () => {
  const h = await harness();
  try {
    const originalSteps = structuredClone(h.state.steps);
    const originalLayout = structuredClone(h.state.layout);
    await h.mount();
    const card = h.container.querySelector<HTMLElement>('[data-step-map-id="a"]')!;
    assert.equal(card.querySelector(".process-step-map__step-title")!.textContent, "Receive");
    assert.equal(card.querySelector(".process-step-map__step-preview")!.textContent, "Record the delivery.");
    assert.equal(h.container.querySelector(".process-step-map__step-label"), null);
    assert.equal(h.container.querySelector('[data-step-map-id="b"] .process-step-map__step-preview')?.textContent ?? "", "", "a blank instruction body adds no filler caption");
    assert.equal(card.style.width, "224px");
    assert.equal(card.style.height, "112px");
    assert.deepEqual(h.state.steps, originalSteps);
    assert.deepEqual(h.state.layout, originalLayout);
    h.state.steps = h.state.steps.map((step) => step.process_step_id === "a" ? { ...step, body_json: { format: "mango-tiptap-json", schema_version: 1, document: { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "Inspect", marks: [{ type: "bold" }] }, { type: "hardBreak" }, { type: "text", text: "the delivery." }] },
      { type: "paragraph", content: [{ type: "text", text: "Record <details>." }] },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Check the count." }] }] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Flag damage." }] }] }] },
    ] } } } : step);
    const updatedBody = structuredClone(h.state.steps[0].body_json);
    await act(async () => h.render()); await flush();
    const preview = card.querySelector(".process-step-map__step-preview")!;
    assert.deepEqual([...preview.querySelectorAll("p")].map((paragraph) => paragraph.textContent), ["Inspectthe delivery.", "Record <details>.", "Check the count.", "Flag damage."]);
    assert.equal(preview.querySelector("strong")!.textContent, "Inspect");
    assert.ok(preview.querySelector("p > br"), "authored hard breaks stay in the preview");
    assert.equal(preview.querySelector("ol")!.getAttribute("start"), "3");
    assert.equal(preview.querySelector("ol > li > p")!.textContent, "Check the count.");
    assert.equal(preview.querySelector("ul > li > p")!.textContent, "Flag damage.");
    assert.equal(card.querySelector("details"), null, "instruction text must remain escaped in the rich preview");
    assert.deepEqual(h.state.steps[0].body_json, updatedBody);
    assert.deepEqual(h.state.layout, originalLayout);
    assert.equal(h.requests.filter((request) => request.method !== "GET").length, 0, "preview updates must not save a layout or resource");
  } finally { await h.dispose(); }
});

test("double-clicking Step instructions targets their existing editor and clicked text without renaming or saving", async () => {
  const h = await harness(true);
  try {
    h.state.editBodies = true;
    h.state.steps[0].body_json!.document.content![0].attrs = { blockId: "step-a-body" };
    await h.mount();
    const card = h.container.querySelector<HTMLElement>('[data-step-map-id="a"]')!;
    const paragraph = card.querySelector<HTMLElement>(".process-step-map__step-preview p")!;
    Object.defineProperty(h.dom.window.document, "caretPositionFromPoint", { configurable: true, value: () => ({ offsetNode: paragraph.firstChild, offset: 7 }) });
    await h.doubleClick(paragraph, 180, 150);
    const placement = h.state.editorPlacement;
    assert.ok(placement);
    assert.equal(placement.stepID, "a");
    assert.equal(placement.container, card.querySelector(".process-step-map__step-editor"));
    assert.deepEqual(placement.activation.coordinates, { left: 180, top: 150 });
    assert.deepEqual(placement.activation.bookmark, { blockID: "step-a-body", textOffset: 7 });
    assert.ok(placement.activation.requestID > 0);
    assert.equal(card.querySelector('[aria-label="Step name"]'), null);
    assert.deepEqual(h.localCalls, [], "opening Step instructions does not issue a map or rename command");
    assert.deepEqual(h.state.layout, initialLayout);
    await h.key(h.button("Move Receive"), "F2");
    assert.equal(h.state.editorPlacement, null, "title editing returns the shared instruction editor from its map placement");
    await h.key(card.querySelector('[aria-label="Step name"]')!, "Escape");
    h.state.canEdit = false;
    await h.mount();
    const requestCount = h.editorPlacements.length;
    await h.doubleClick(paragraph, 180, 150);
    assert.equal(h.editorPlacements.length, requestCount, "read-only access cannot open an editable Step body");
    assert.deepEqual(h.localCalls, []);
  } finally { await h.dispose(); }
});

test("layout denial, Step removal and map unmount clear detached Step editor placements before recovery", async () => {
  const h = await harness();
  const openBody = async () => {
    const paragraph = h.container.querySelector('[data-step-map-id="a"] .process-step-map__step-preview p')!;
    await h.doubleClick(paragraph, 180, 150);
    assert.ok(h.state.editorPlacement);
    return h.state.editorPlacement.container;
  };
  try {
    h.state.editBodies = true;
    await h.mount();
    const deniedContainer = await openBody();
    h.state.customFetch = (request) => request.method === "GET" && request.path.endsWith("/step-map") ? Promise.resolve(response({ error: "Forbidden" }, 403)) : null;
    await h.mount();
    assert.equal(h.state.editorPlacement, null, "a denied layout releases its editor placement");
    assert.equal(deniedContainer.isConnected, false);
    h.state.customFetch = null;
    await h.click("Reload map");
    assert.equal(h.state.editorPlacement, null, "layout recovery cannot restore a detached editor target");
    const removedContainer = await openBody();
    h.state.steps = h.state.steps.filter((step) => step.process_step_id !== "a");
    await h.mount();
    assert.equal(h.state.editorPlacement, null, "removing the active Step releases its editor placement");
    assert.equal(removedContainer.isConnected, false);
    h.state.steps = structuredClone(initialSteps);
    await h.mount();
    assert.equal(h.state.editorPlacement, null);
    const unmountedContainer = await openBody();
    h.state.showMap = false;
    await act(async () => h.render()); await flush();
    assert.equal(h.state.editorPlacement, null, "unmounting a map releases its editor placement while its owner remains mounted");
    assert.equal(unmountedContainer.isConnected, false);
    h.state.showMap = true;
    await h.mount();
    assert.equal(h.state.editorPlacement, null, "a remounted map starts without a detached editor target");
    assert.equal(h.requests.filter((request) => request.method !== "GET").length, 0);
  } finally { await h.dispose(); }
});

test("outside pointer presses dismiss map menus even when the canvas or Step stops propagation", async () => {
  const h = await harness(true);
  try {
    await h.mount();
    const viewport = h.container.querySelector(".process-step-map__viewport")!;
    await h.pointer(viewport, "contextmenu", 400, 300);
    await h.pointer(viewport, "pointerdown", 200, 150);
    assert.equal(h.dom.window.document.querySelector('[aria-label="Process map creation"]'), null);
    await h.pointer(viewport, "pointerup", 200, 150);
    await h.pointer(viewport, "contextmenu", 400, 300);
    await h.pointer(h.button("Move Receive"), "pointerdown", 100, 100);
    assert.equal(h.dom.window.document.querySelector('[aria-label="Process map creation"]'), null);
    await h.key(viewport, "Escape");
    assert.deepEqual(h.localCalls, []);
  } finally { await h.dispose(); }
});

test("failed Step creation does not notify the editor of a created Step", async () => {
  const h = await harness();
  try {
    h.state.customFetch = (request) => request.method === "POST" && request.path.endsWith("/steps") ? Promise.resolve(response({ error: "Cannot create Step" }, 500)) : null;
    await h.mount();
    await h.click("Create Step");
    assert.deepEqual(h.createdStepIDs, []);
    assert.ok(h.container.querySelector('[role="alert"]'));
  } finally { await h.dispose(); }
});

test("canvas hover previews leave an unfinished Step name and selection intact", async () => {
  const h = await harness(true);
  try {
    h.state.hoverModeEnabled = true;
    await h.mount();
    await h.doubleClick(h.button("Move Receive"));
    const input = await h.input("Receive delivery");
    await h.pointer(h.button("Move Check"), "pointerover", 520, 280);
    assert.match(h.container.querySelector('[role="tooltip"]')?.textContent ?? "", /Check/);
    assert.ok(h.container.querySelector(".process-step-map__edges .is-hovered"));
    assert.ok(h.container.querySelector('[data-step-map-id="a"].is-selected'));
    assert.equal(input.value, "Receive delivery");
    await h.key(input, "ArrowRight");
    await h.pointer(input, "contextmenu", 20, 20);
    assert.equal(h.container.querySelector('[aria-label="Process map creation"]'), null);
    assert.deepEqual(h.localCalls, [], "text navigation and hover events must not issue map commands");
    h.state.hoverModeEnabled = false;
    await h.mount();
    assert.equal(h.container.querySelector('[role="tooltip"]'), null);
    assert.equal(h.container.querySelector(".is-hovered"), null);
    assert.ok(h.container.querySelector('[data-step-map-id="a"].is-selected'));
    assert.equal(input.value, "Receive delivery");
    await h.key(input, "Enter");
    assert.equal(h.state.steps.find((step) => step.process_step_id === "a")?.name, "Receive delivery");
    assert.deepEqual(h.localCalls, ["rename"]);
  } finally { await h.dispose(); }
});

test("title double-click places the caret at the clicked text, F2 selects all, and card bodies never rename the Step", async () => {
  const h = await harness();
  const renames = () => h.requests.filter((request) => request.method === "PATCH");
  try {
    await h.mount();
    const card = h.container.querySelector<HTMLElement>('[data-step-map-id="a"]')!;
    await h.doubleClick(card);
    assert.equal(card.querySelector('[aria-label="Step name"]'), null, "double-clicking the card must not rename its title");
    await h.doubleClick(card.querySelector(".process-step-map__step-preview")!);
    assert.equal(card.querySelector('[aria-label="Step name"]'), null, "double-clicking instructions must not rename the Step");
    const title = h.button("Move Receive");
    const caretRequests: Array<[number, number]> = [];
    Object.defineProperty(h.dom.window.document, "caretPositionFromPoint", { configurable: true, value: (x: number, y: number) => { caretRequests.push([x, y]); return { offsetNode: title.firstChild, offset: 3 }; } });
    await h.doubleClick(title, 125, 40);
    const titleInput = card.querySelector<HTMLInputElement>('[aria-label="Step name"]')!;
    assert.ok(titleInput);
    assert.equal(h.dom.window.document.activeElement, titleInput);
    assert.equal(titleInput.selectionStart, 3);
    assert.equal(titleInput.selectionEnd, 3, "mouse editing places a caret without selecting the whole title");
    assert.deepEqual(caretRequests, [[125, 40]]);
    Reflect.deleteProperty(h.dom.window.document, "caretPositionFromPoint");
    assert.equal(renames().length, 0, "opening the title must not issue a rename");
    const entered = await h.input("  Receive delivery  ");
    assert.ok(card.contains(entered));
    assert.equal(h.dom.window.document.activeElement, entered);
    await h.key(entered, "Enter");
    assert.deepEqual(renames(), [{ path: "/v2/logic-gates/process/steps/a", method: "PATCH", body: { company_id: "company", name: "Receive delivery" } }]);
    assert.equal(h.container.querySelector('[aria-label="Step name"]'), null);
    assert.ok(h.button("Move Receive delivery"));

    await h.key(h.button("Move Receive delivery"), "F2");
    const selected = card.querySelector<HTMLInputElement>('[aria-label="Step name"]')!;
    assert.equal(h.dom.window.document.activeElement, selected);
    assert.equal(selected.selectionStart, 0);
    assert.equal(selected.selectionEnd, "Receive delivery".length);
    const cancelled = await h.input("Discard this edit");
    await h.key(cancelled, "Escape");
    assert.ok(h.button("Move Receive delivery"));
    assert.equal(renames().length, 1, "Escape must preserve the existing name without a command");

    await h.doubleClick(h.button("Move Receive delivery"));
    await h.input("   ");
    await act(async () => h.container.querySelector<HTMLElement>(".process-step-map__viewport")!.focus());
    await flush();
    assert.ok(h.button("Move Receive delivery"));
    assert.equal(h.container.querySelector('[aria-label="Step name"]'), null);
    assert.equal(renames().length, 1, "a blank blur must restore the previous name");

    await h.key(h.button("Move Check"), "F2");
    const blurred = await h.input("Inspect delivery");
    assert.ok(h.container.querySelector('[data-step-map-id="b"]')!.contains(blurred));
    await act(async () => h.container.querySelector<HTMLElement>(".process-step-map__viewport")!.focus());
    await flush();
    assert.equal(renames().length, 2, "blur must issue one rename for the exact edited Step");
    assert.deepEqual(renames()[1], { path: "/v2/logic-gates/process/steps/b", method: "PATCH", body: { company_id: "company", name: "Inspect delivery" } });
    assert.ok(h.button("Move Inspect delivery"));
    assert.equal(h.writes().length, 0, "editing text must not move or resize the Step");
  } finally { await h.dispose(); }
});

test("canvas body dragging uses the current zoom and directional handles keep opposite edges fixed", async () => {
  const h = await harness();
  try {
    await h.mount();
    await cameraFixture(h).wheel(-Math.log(1.5) / .002);
    const card = h.container.querySelector<HTMLElement>('[data-step-map-id="a"]')!;
    assert.deepEqual([...card.querySelectorAll<HTMLElement>("[data-resize-handle]")].map((handle) => handle.dataset.resizeHandle).sort(), ["n", "ne", "nw", "s", "se", "sw"]);
    const body = card.querySelector(".process-step-map__step-preview")!;
    await h.pointer(body, "pointerdown", 100, 100);
    await h.pointer(body, "pointermove", 148, 124);
    assert.equal(h.writes().length, 0);
    await h.pointer(body, "pointerup", 148, 124);
    await flush();
    assert.equal(h.writes().length, 1);
    assert.deepEqual(h.state.layout.steps[0], { process_step_id: "a", x: 96, y: 80, width: 224, height: 112 });

    const north = h.button("Resize Receive n");
    await h.pointer(north, "pointerdown", 100, 100);
    await h.pointer(north, "pointermove", 124, 76);
    await h.pointer(north, "pointerup", 124, 76);
    await flush();
    assert.equal(h.writes().length, 2, "a resize must not also start a body drag");
    assert.deepEqual(h.state.layout.steps[0], { process_step_id: "a", x: 96, y: 64, width: 224, height: 128 }, "north ignores horizontal movement and keeps the bottom edge fixed");

    await h.key(h.button("Resize Receive nw"), "ArrowLeft");
    assert.equal(h.writes().length, 3);
    assert.deepEqual(h.state.layout.steps[0], { process_step_id: "a", x: 80, y: 64, width: 240, height: 128 });

    const northWest = h.button("Resize Receive nw");
    await h.pointer(northWest, "pointerdown", 100, 100);
    await h.pointer(northWest, "pointermove", 124, 124);
    await h.pointer(northWest, "pointerup", 124, 124);
    await flush();
    assert.equal(h.writes().length, 4);
    assert.deepEqual(h.state.layout.steps[0], { process_step_id: "a", x: 96, y: 80, width: 224, height: 112 }, "northwest shrinks from its corner while preserving the opposite corner");
    assert.equal(h.requests.filter((request) => request.method === "PATCH" || request.method === "POST").length, 0);
  } finally { await h.dispose(); }
});

test("resizing an edited Step waits for its pending rename without starting a body drag", async () => {
  const h = await harness();
  let releaseRename!: (value: Response) => void;
  try {
    await h.mount();
    await h.doubleClick(h.button("Move Receive"));
    await h.input("Receive arrival");
    h.state.customFetch = (request) => request.method === "PATCH" ? new Promise((resolve) => { releaseRename = resolve; }) : null;
    const resize = h.button("Resize Receive");
    await h.pointer(resize, "pointerdown", 100, 100);
    assert.equal(h.requests.filter((request) => request.method === "PATCH").length, 1);
    assert.equal(h.busyStates.at(-1), true);
    await h.pointer(resize, "pointermove", 148, 132);
    await h.pointer(resize, "pointerup", 148, 132);
    await flush();
    assert.equal(h.writes().length, 0, "the resize event must not bubble into a move while its rename is pending");
    const card = h.container.querySelector<HTMLElement>('[data-step-map-id="a"]')!;
    assert.equal(card.style.left, "64px");
    assert.equal(card.style.top, "64px");
    assert.equal(card.style.width, "224px");
    assert.equal(card.style.height, "112px");
    assert.deepEqual(h.state.layout, initialLayout);
    h.state.steps = h.state.steps.map((step) => step.process_step_id === "a" ? { ...step, name: "Receive arrival" } : step);
    h.state.customFetch = null;
    await act(async () => releaseRename(response({ step: h.state.steps[0] })));
    await flush();
    assert.equal(h.busyStates.at(-1), false);
    assert.ok(h.button("Move Receive arrival"));
    const readyResize = h.button("Resize Receive arrival");
    await h.pointer(readyResize, "pointerdown", 100, 100);
    await h.pointer(readyResize, "pointermove", 132, 116);
    await h.pointer(readyResize, "pointerup", 132, 116);
    await flush();
    assert.equal(h.writes().length, 1, "one later resize must save after the rename finishes");
    assert.deepEqual(h.state.layout.steps[0], { process_step_id: "a", x: 64, y: 64, width: 256, height: 128 });
    assert.equal(h.requests.filter((request) => request.method === "PATCH").length, 1);
  } finally { await h.dispose(); }
});

test("losing edit permission cancels an inline Step name without committing it later", async () => {
  const h = await harness();
  try {
    await h.mount();
    await h.doubleClick(h.button("Move Receive"));
    const staleInput = await h.input("Unapproved name");
    h.state.canEdit = false;
    await h.mount();
    assert.ok(h.container.querySelector('[aria-label="Step name"]') === null, "permission loss must cancel the inline editor");
    assert.ok(h.button("Move Receive"));
    await h.key(staleInput, "Enter");
    await h.pointer(h.button("Resize Receive"), "pointerdown", 100, 100);
    await h.pointer(h.button("Resize Receive"), "pointerup", 132, 116);
    assert.deepEqual(h.requests.filter((request) => request.method !== "GET"), []);
    h.state.canEdit = true;
    await h.mount();
    assert.ok(h.container.querySelector('[aria-label="Step name"]') === null, "restoring permission must not reopen cancelled text");
    await h.key(h.button("Move Receive"), "F2");
    const newInput = h.container.querySelector<HTMLInputElement>('[aria-label="Step name"]')!;
    assert.equal(newInput.value, "Receive");
    await h.key(newInput, "Enter");
    assert.deepEqual(h.requests.filter((request) => request.method !== "GET"), []);
  } finally { await h.dispose(); }
});

test("Step map saves snapped drag and resize results while preserving existing routes when reopened", async () => {
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
    assert.deepEqual(h.state.layout.routes, initialLayout.routes, "Step movement and resizing preserve authored route points");
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
    await h.click("Create Step");
    await h.key(h.button("Move Receive"), "ArrowRight");
    assert.equal(h.requests.length, count);
  } finally { await h.dispose(); }
});

test("Step creation, naming, directed connection and deletion use existing definition commands", async () => {
  const h = await harness();
  try {
    await h.mount();
    await h.click("Create Step");
    assert.ok(h.container.querySelector('[data-step-map-id="new"]'));
    const input = h.container.querySelector<HTMLInputElement>('[aria-label="Step name"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(h.dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "Confirm order");
      input.dispatchEvent(new h.dom.window.Event("input", { bubbles: true }));
    });
    await h.key(input, "Enter");
    assert.equal(h.state.steps.find((step) => step.process_step_id === "new")?.name, "Confirm order");
    await h.key(h.button("Connect from Confirm order"), "Enter");
    await h.key(h.button("Connect into Receive"), "Enter");
    const createEdge = h.requests.find((request) => request.path.endsWith("/step-relationships") && request.method === "POST")!;
    assert.deepEqual(createEdge.body.source, { resource_type: "process_step", resource_id: "new" });
    assert.deepEqual(createEdge.body.target, { resource_type: "process_step", resource_id: "a" });
    await h.pointer(h.container.querySelector('[aria-label="Connection from Confirm order to Receive"]')!, "contextmenu", 300, 200);
    await h.click("Delete connection");
    assert.equal(h.state.steps.length, 3);
    await h.pointer(h.button("Move Confirm order"), "contextmenu", 300, 200);
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
    await act(async () => move.focus());
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
    const laterFocus = h.container.querySelector<HTMLElement>(".process-step-map__viewport")!;
    await act(async () => laterFocus.focus());
    await act(async () => resolveSave(response({ error: "Save failed" }, 500)));
    await flush();
    assert.equal(h.dom.window.document.activeElement, laterFocus, "saving must never restore focus over the user's later choice");
  } finally { await h.dispose(); }
});

test("selecting a trace highlights it without handles or writes, while Reset route preserves its connection", async () => {
  const h = await harness();
  try {
    await h.mount();
    const edge = h.container.querySelector('[aria-label="Connection from Receive to Check"]')!;
    await h.key(edge, "Enter");
    assert.ok(edge.closest(".is-selected"), "selecting a trace retains its highlighted state");
    assert.equal(h.container.querySelector('.process-step-map__waypoint, [aria-label^="Move route point"]'), null, "trace selection exposes no square route handles");
    await h.pointer(edge, "pointerdown", 368, 176);
    await h.pointer(edge, "pointermove", 400, 208);
    await h.pointer(edge, "pointerup", 400, 208);
    assert.deepEqual(h.state.layout, initialLayout, "dragging a selected trace cannot change its route");
    assert.equal(h.requests.filter((request) => request.method !== "GET").length, 0, "selecting a trace must not write layout or relationships");
    await h.pointer(edge, "contextmenu", 368, 208);
    const menu = h.dom.window.document.querySelector('[aria-label="Connection actions"]')!;
    assert.ok(menu);
    assert.deepEqual([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent), ["Reset route", "Delete connection"]);
    await h.click("Reset route");
    assert.deepEqual(h.state.layout.routes[0].points, [{ x: 384, y: 216 }]);
    assert.deepEqual(h.state.relationships, [initialEdge]);
    assert.deepEqual(h.state.layout.steps, initialLayout.steps);
    assert.equal(h.writes().length, 1, "only the explicit route reset saves layout");
  } finally { await h.dispose(); }
});

test("Delete on a focused Step port or resize handle cannot delete the previously selected connection", async () => {
  const h = await harness();
  try {
    await h.mount();
    const edge = h.container.querySelector<SVGElement>('[aria-label="Connection from Receive to Check"]')!;
    for (const label of ["Connect into Check", "Resize Check n"]) {
      await act(async () => edge.focus());
      assert.ok(h.container.querySelector('.process-step-map__edges .is-selected [aria-label="Connection from Receive to Check"]'));
      const control = h.button(label);
      await act(async () => control.focus());
      await h.key(control, "Delete");
      const confirmation = h.container.querySelector('[aria-label="Delete Step confirmation"]');
      assert.ok(confirmation, `${label} must select its Step before handling Delete`);
      assert.match(confirmation.textContent ?? "", /Delete “Check”/);
      assert.deepEqual(h.state.steps, initialSteps);
      assert.deepEqual(h.state.relationships, [initialEdge]);
      assert.deepEqual(h.requests.filter((request) => request.method !== "GET"), [], "focus and Delete must not mutate either record before confirmation");
      await h.click("Cancel");
    }
  } finally { await h.dispose(); }
});

test("keyboard deletion preserves inline text and permissions and asks before deleting a Step", async () => {
  const h = await harness(true);
  try {
    await h.mount();
    await h.doubleClick(h.button("Move Receive"));
    const input = await h.input("Receive delivery");
    await h.key(input, "Backspace");
    await h.key(input, "Delete");
    assert.equal(h.container.querySelector('[aria-label="Delete Step confirmation"]'), null);
    assert.deepEqual(h.localCalls, [], "native text deletion must not become a Step command");
    await h.key(input, "Escape");
    await act(async () => h.button("Move Receive").focus());
    await h.key(h.button("Move Receive"), "Delete");
    assert.ok(h.container.querySelector('[aria-label="Delete Step confirmation"]'));
    assert.equal(h.state.steps.length, 2);
    await h.key(h.button("Cancel"), "Escape");
    assert.equal(h.container.querySelector('[aria-label="Delete Step confirmation"]'), null);
    assert.deepEqual(h.localCalls, []);
    const edge = h.container.querySelector('[aria-label="Connection from Receive to Check"]')!;
    await act(async () => (edge as SVGElement).focus());
    await h.key(edge, "Backspace");
    assert.deepEqual(h.localCalls, ["disconnect"]);
    assert.equal(h.state.steps.length, 2, "deleting a selected connection must preserve both Steps");
    h.state.canEdit = false;
    await h.mount();
    await act(async () => h.button("Move Receive").focus());
    await h.key(h.button("Move Receive"), "Delete");
    assert.equal(h.container.querySelector('[aria-label="Delete Step confirmation"]'), null);
    assert.deepEqual(h.localCalls, ["disconnect"]);
    assert.deepEqual(h.requests, []);
  } finally { await h.dispose(); }
});

test("new Process map uses only supplied local commands for geometry, Steps, and connections", async () => {
  const h = await harness(true);
  try {
    await h.mount();
    assert.doesNotMatch(h.container.textContent ?? "", /Unsaved changes/);
    await h.key(h.button("Move Receive"), "ArrowRight");
    assert.equal(h.state.layout.steps[0].x, 80);
    assert.doesNotMatch(h.container.textContent ?? "", /Unsaved changes/);
    await h.click("Create Step");
    const input = h.container.querySelector<HTMLInputElement>('[aria-label="Step name"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(h.dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "New Process review");
      input.dispatchEvent(new h.dom.window.Event("input", { bubbles: true }));
    });
    await h.key(input, "Enter");
    assert.equal(h.state.steps.find((step) => step.process_step_id === "new")?.name, "New Process review");
    await h.key(h.button("Connect from New Process review"), "Enter");
    await h.key(h.button("Connect into Receive"), "Enter");
    await h.pointer(h.container.querySelector('[aria-label="Connection from New Process review to Receive"]')!, "contextmenu", 300, 200);
    await h.click("Delete connection");
    await h.pointer(h.button("Move New Process review"), "contextmenu", 300, 200);
    await h.click("Delete Step");
    await h.click("Confirm delete Step");
    assert.deepEqual(h.localCalls, ["layout", "create", "rename", "connect", "disconnect", "delete"]);
    assert.equal(h.state.steps.length, 2);
    assert.deepEqual(h.requests, [], "a new Process editor must not access an app API");
  } finally { await h.dispose(); }
});

test("new Process busy state covers gestures and pending mutations, and failure restores the new Process", async () => {
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
    assert.equal(h.button("Create Step").disabled, true);
    const saved = { ...h.state.layout, revision: 4, steps: h.state.layout.steps.map((box) => box.process_step_id === "a" ? { ...box, x: 96 } : box) };
    h.state.layout = saved;
    h.state.customLocalSave = null;
    await act(async () => resolveSave(saved));
    await flush();
    assert.equal(h.busyStates.at(-1), false);
    h.state.saveMode = "failure";
    await h.key(move, "ArrowRight");
    assert.match(h.container.textContent ?? "", /previous layout/);
    assert.equal(h.container.querySelector<HTMLElement>('[data-step-map-id="a"]')!.style.left, "96px");
    assert.equal(h.busyStates.at(-1), false);
    assert.deepEqual(h.requests, []);
  } finally { await h.dispose(); }
  assert.equal(h.busyStates.at(-1), false, "unmount releases the outer Save control");
});

test("saved and new Process map menus distinguish Step actions from blank-canvas creation", async () => {
  for (const isNew of [false, true]) {
    const h = await harness(isNew);
    try {
      await h.mount();
      const open = async (element: Element) => {
        await act(async () => element.dispatchEvent(new h.dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })));
        await flush();
      };
      await open(h.button("Move Receive"));
      assert.equal(h.dom.window.document.querySelector('[aria-label="Process map creation"]'), null);
      assert.ok(h.dom.window.document.querySelector('[aria-label="Step actions"]'));
      await open(h.container.querySelector(".process-step-map__viewport")!);
      assert.deepEqual([...h.dom.window.document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent), ["Create Step"]);
      const create = h.dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
      await act(async () => create.click());
      await flush();
      assert.ok(h.container.querySelector('[data-step-map-id="new"]'));
      if (isNew) assert.deepEqual(h.requests, []);
      h.state.canEdit = false;
      await h.mount();
      await open(h.container.querySelector(".process-step-map__canvas")!);
      const disabledCreate = h.dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
      assert.equal(disabledCreate.disabled, true);
      await h.key(disabledCreate, "Escape");
      assert.equal(h.dom.window.document.querySelector('[aria-label="Process map creation"]'), null);
    } finally { await h.dispose(); }
  }
});


test("initial Process framing leaves room around the outline and never rewrites geometry", async () => {
  const h = await harness(false, false);
  try {
    const before = structuredClone(h.state.layout);
    h.dom.window.document.head.innerHTML = '<style>.process-step-map__viewport { padding: 184px 224px 32px 32px; }</style>';
    Object.defineProperties(h.dom.window.HTMLElement.prototype, {
      clientWidth: { configurable: true, get() { return this.classList.contains("process-step-map__viewport") ? 1600 : 0; } },
      clientHeight: { configurable: true, get() { return this.classList.contains("process-step-map__viewport") ? 900 : 0; } },
    });
    await h.mount();
    const canvas = h.container.querySelector<HTMLElement>(".process-step-map__canvas")!;
    assert.equal(canvas.style.transform, "translate(8px, 8px) scale(0.85)");
    assert.ok(32 + 8 + (1600 - 32 - 224) * .85 < 1600 - 224, "outline fits left of the control area");
    assert.deepEqual(h.state.layout, before);
    assert.equal(h.writes().length, 0);
    await h.pointer(h.container.querySelector(".process-step-map__viewport")!, "pointerdown", 200, 200);
    await h.pointer(h.container.querySelector(".process-step-map__viewport")!, "pointerup", 240, 230);
    const moved = canvas.style.transform;
    await act(async () => h.render());
    await flush();
    assert.equal(canvas.style.transform, moved, "refresh never resets a camera the user moved");
  } finally { await h.dispose(); }
});

test("authoring frames have equal initial margins for empty and saved Processes and retain world size while navigating", async () => {
  for (const isNew of [true, false]) {
    const h = await harness(isNew, false, true);
    try {
      if (isNew) {
        h.state.steps = [];
        h.state.relationships = [];
        h.state.layout = { revision: 0, steps: [], routes: [] };
      }
      const before = structuredClone(h.state.layout);
      h.dom.window.document.head.innerHTML = '<style>.process-step-map__viewport { padding: 24px; }</style>';
      Object.defineProperties(h.dom.window.HTMLElement.prototype, {
        clientWidth: { configurable: true, get() { return this.classList.contains("process-step-map__viewport") ? 1200 : 0; } },
        clientHeight: { configurable: true, get() { return this.classList.contains("process-step-map__viewport") ? 800 : 0; } },
      });
      await h.mount();
      assert.ok(h.container.querySelector(".process-step-map--authoring"));
      const viewport = h.container.querySelector<HTMLElement>(".process-step-map__viewport")!;
      const canvas = h.container.querySelector<HTMLElement>(".process-step-map__canvas")!;
      const extent = canvas.parentElement!;
      const width = Number.parseFloat(extent.style.width), height = Number.parseFloat(extent.style.height);
      const transform = canvas.style.transform.match(/^translate\(([-\d.e+]+)px, ([-\d.e+]+)px\) scale\(([-\d.e+]+)\)$/)!;
      const x = Number(transform[1]), y = Number(transform[2]), zoom = Number(transform[3]);
      near(24 + x, 1200 - (24 + x + width * zoom), "left and right frame margins must match");
      near(24 + y, 800 - (24 + y + height * zoom), "top and bottom frame margins must match");
      near(24 + x, 24 + y, "horizontal and vertical frame margins must match");
      assert.equal(extent.style.minWidth, "");
      assert.equal(extent.style.minHeight, "");
      if (isNew) assert.match(h.container.textContent ?? "", /Start this process with a right-click or by pressing the plus button/);
      await h.pointer(viewport, "pointerdown", 100, 100);
      await h.pointer(viewport, "pointerup", 130, 120);
      await act(async () => viewport.dispatchEvent(new h.dom.window.WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 300, clientY: 250, deltaY: -100 })));
      const navigated = canvas.style.transform;
      await act(async () => h.render());
      await flush();
      assert.equal(canvas.style.transform, navigated, "refresh must preserve navigation");
      near(Number.parseFloat(extent.style.width), width, "zoom must not resize the frame in world space");
      near(Number.parseFloat(extent.style.height), height);
      assert.deepEqual(h.state.layout, before);
      assert.equal(h.writes().length, 0);
      assert.deepEqual(h.localCalls, []);
    } finally { await h.dispose(); }
  }
});
