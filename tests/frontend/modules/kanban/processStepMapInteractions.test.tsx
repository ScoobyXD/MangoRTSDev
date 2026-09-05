import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { ProcessStepMapLayout } from "../../../../frontend/src/modules/kanban/processStepMapGeometry.js";
import type { ProcessStep, ProcessStepRelationship } from "../../../../frontend/src/modules/kanban/processWork.js";
import type { ProcessStepMapActions, ProcessStepMapCommands } from "../../../../frontend/src/modules/kanban/ProcessStepMap.js";

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

async function harness(draft = false, canvas = false) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (original) Object.defineProperty(globalThis, name, original); else delete (globalThis as Record<string, unknown>)[name]; });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "CustomEvent", "localStorage"]) install(name, name === "window" ? dom.window : name === "document" ? dom.window.document : (dom.window as any)[name]);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  const state = { steps: structuredClone(initialSteps), relationships: [structuredClone(initialEdge)], layout: structuredClone(initialLayout), processID: "process", canEdit: true, hoverModeEnabled: false, saveMode: "success" as "success" | "failure" | "conflict", customFetch: null as ((request: Request) => Promise<Response> | null) | null, customLocalSave: null as ((layout: ProcessStepMapLayout) => Promise<ProcessStepMapLayout>) | null };
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
  const renderActions = ({ createStep, disabled }: ProcessStepMapActions) => <div aria-label="Canvas actions"><button type="button" disabled={disabled} onClick={createStep}>Create Step</button></div>;
  const render = () => {
    const props = { steps: [...state.steps], relationships: [...state.relationships], canEdit: state.canEdit, onChanged: render, onBusyChange, ...(canvas ? { presentation: "canvas" as const, hoverModeEnabled: state.hoverModeEnabled, renderActions } : {}) };
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
  const input = async (value: string) => {
    const element = container.querySelector<HTMLInputElement>('[aria-label="Step name"]');
    assert.ok(element, "inline Step name must be available");
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    return element;
  };
  const doubleClick = async (element: Element) => { await act(async () => element.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }))); await flush(); };
  const pointer = async (element: Element, type: string, x: number, y: number) => {
    await act(async () => element.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })));
  };
  const key = async (element: Element, value: string) => { await act(async () => element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }))); await flush(); };
  const writes = () => requests.filter((request) => request.method === "PUT");
  const dispose = async () => { await act(async () => root.unmount()); restores.reverse().forEach((restore) => restore()); dom.window.close(); };
  return { dom, container, state, requests, localCalls, busyStates, mount, render, button, click, input, doubleClick, pointer, key, writes, dispose };
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

test("readonly canvas pans on blank space and restores the starting view on pointercancel or Escape without saving", async () => {
  const h = await harness(false, true);
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
  const h = await harness(false, true);
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

test("Step and route gestures block camera changes until cancelled", async () => {
  const h = await harness(false, true);
  try {
    await h.mount();
    const c = cameraFixture(h);
    const initial = c.read();
    const step = h.button("Move Receive");
    await h.pointer(step, "pointerdown", 100, 100);
    await c.wheel(-200);
    assert.deepEqual(c.read(), initial);
    await h.pointer(step, "pointercancel", 100, 100);
    const edge = h.container.querySelector('[aria-label="Connection from Receive to Check"]')!;
    await h.key(edge, "Enter");
    const waypoint = h.button("Move route point 1");
    await h.pointer(waypoint, "pointerdown", 368, 176);
    await c.wheel(-200);
    assert.deepEqual(c.read(), initial);
    await h.pointer(waypoint, "pointercancel", 368, 176);
    await c.wheel(-Math.log(1.25) / .002);
    near(c.read().zoom, 1.25);
    assert.equal(h.writes().length, 0);
  } finally { await h.dispose(); }
});

test("inline text and connection controls cannot start canvas panning", async () => {
  const h = await harness(false, true);
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

test("Board map keeps its existing scroll surface without canvas wheel zoom or blank-space pan", async () => {
  const h = await harness();
  try {
    await h.mount();
    const viewport = h.container.querySelector<HTMLElement>(".process-step-map__viewport")!;
    const canvas = h.container.querySelector<HTMLElement>(".process-step-map__canvas")!;
    const original = canvas.style.transform;
    const wheel = new h.dom.window.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -200 });
    await act(async () => viewport.dispatchEvent(wheel));
    await h.pointer(viewport, "pointerdown", 100, 100);
    await h.pointer(viewport, "pointermove", 200, 180);
    await h.pointer(viewport, "pointerup", 200, 180);
    assert.equal(wheel.defaultPrevented, false);
    assert.equal(canvas.style.transform, original);
    assert.equal(viewport.classList.contains("is-panning"), false);
    assert.ok(h.container.querySelector(".process-step-map__toolbar"));
    assert.equal(h.button("Zoom in").disabled, false);
    assert.ok(h.button("Fit"));
    assert.equal(h.writes().length, 0);
  } finally { await h.dispose(); }
});

test("negative Step bounds cannot shift unrelated Steps on screen when zoomed and moved", async () => {
  const h = await harness(false, true);
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
  const h = await harness(false, true);
  try {
    await h.mount();
    assert.ok(h.container.querySelector(".process-step-map--canvas"));
    assert.equal(h.container.querySelector(".process-step-map__toolbar"), null);
    assert.equal(h.container.querySelector(".process-step-map__zoom"), null);
    await h.click("Create Step");
    assert.equal(h.requests.filter((request) => request.method === "POST" && request.path.endsWith("/steps")).length, 1);
    assert.ok(h.container.querySelector('[data-step-map-id="new"].is-selected'));
    assert.equal(h.container.querySelector('[aria-label="Selected Step"]'), null);
    const step = h.container.querySelector<HTMLElement>('[data-step-map-id="new"]')!;
    assert.equal(step.style.width, "112px");
    assert.equal(step.style.height, "56px");
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
  const h = await harness(true, true);
  try {
    await h.mount();
    const viewport = h.container.querySelector(".process-step-map__viewport")!;
    await h.pointer(viewport, "contextmenu", 400, 300);
    const menu = h.dom.window.document.querySelector('[role="menu"][aria-label="Process map creation"]')!;
    assert.ok(menu);
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    assert.deepEqual(items.map((item) => item.textContent), ["Create Step"]);
    await act(async () => items[0].click());
    await flush();
    assert.ok(h.container.querySelector('[data-step-map-id="new"] input[aria-label="Step name"]'));
    assert.deepEqual(h.localCalls, ["create"]);
    assert.deepEqual(h.requests, []);
  } finally { await h.dispose(); }
});

test("canvas hover previews leave an unfinished Step name and selection intact", async () => {
  const h = await harness(true, true);
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

test("canvas body, title and keyboard naming share one inline editor and only commit nonblank changes", async () => {
  const h = await harness(false, true);
  const renames = () => h.requests.filter((request) => request.method === "PATCH");
  try {
    await h.mount();
    const card = h.container.querySelector<HTMLElement>('[data-step-map-id="a"]')!;
    await h.doubleClick(card);
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
  const h = await harness(false, true);
  try {
    await h.mount();
    await cameraFixture(h).wheel(-Math.log(1.5) / .002);
    const card = h.container.querySelector<HTMLElement>('[data-step-map-id="a"]')!;
    assert.deepEqual([...card.querySelectorAll<HTMLElement>("[data-resize-handle]")].map((handle) => handle.dataset.resizeHandle).sort(), ["e", "n", "ne", "nw", "s", "se", "sw", "w"]);
    const body = card.querySelector(".process-step-map__step-label")!;
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

    await h.key(h.button("Resize Receive w"), "ArrowLeft");
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
  const h = await harness(false, true);
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
  const h = await harness(false, true);
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

test("saved and draft Board map menus create Steps without intercepting cards", async () => {
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
      assert.deepEqual([...h.dom.window.document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent), ["Create Step"]);
      await h.click("Create Step");
      assert.ok(h.container.querySelector('[data-step-map-id="new"]'));
      if (draft) assert.deepEqual(h.requests, []);
      h.state.canEdit = false;
      await h.mount();
      await open(h.container.querySelector(".process-step-map__canvas")!);
      assert.equal(h.button("Create Step").disabled, true);
      await h.key(h.button("Create Step"), "Escape");
      assert.equal(h.dom.window.document.querySelector('[aria-label="Process map creation"]'), null);
    } finally { await h.dispose(); }
  }
});
