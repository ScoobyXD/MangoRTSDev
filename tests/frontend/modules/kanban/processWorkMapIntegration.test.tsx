import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import type { ProcessWorkSnapshot } from "../../../../frontend/src/modules/kanban/processWork.js";
import type { ProcessStepMapLayout } from "../../../../frontend/src/modules/kanban/processStepMapGeometry.js";

const companyID = "11111111-1111-1111-1111-111111111111";
const processA = "22222222-2222-2222-2222-222222222222";
const processB = "33333333-3333-3333-3333-333333333333";
const stepA = "44444444-4444-4444-4444-444444444444";
const stepB = "55555555-5555-5555-5555-555555555555";
const apiBase = "http://localhost:8080";

async function settle(condition: () => boolean, description: string) {
  const until = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() >= until) assert.fail(description);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

test("Board and the named Process canvas share inline Step edits, block switching during writes, and preserve canonical geometry", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true, url: apiBase });
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; });
  };
  for (const name of ["window", "document", "navigator", "sessionStorage", "localStorage", "Node", "Element", "HTMLElement", "HTMLInputElement", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "MutationObserver", "getComputedStyle"]) {
    install(name, name === "window" ? dom.window : name === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : (dom.window as unknown as Record<string, unknown>)[name]);
  }
  install("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(dom.window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {}, scrollTo() {} });
  // This test drives canonical HTTP/local invalidation. No external socket opens.
  install("WebSocket", class { static OPEN = 1; static CLOSED = 3; readyState = 0; send() {} close() { this.readyState = 3; } });
  dom.window.sessionStorage.setItem("mangorts:active-company-id-v1", companyID);

  const snapshots = new Map<string, ProcessWorkSnapshot>([
    [processA, { logic_gate: { logic_gate_id: processA, header: "Order Process" }, permissions: { can_edit: true, can_resolve_requests: false }, steps: [{ process_step_id: stepA, logic_gate_id: processA, name: "Receive purchase order", position: 1000 }], relationships: [], nodes: [] }],
    [processB, { logic_gate: { logic_gate_id: processB, header: "Finance Process" }, permissions: { can_edit: true, can_resolve_requests: false }, steps: [{ process_step_id: stepB, logic_gate_id: processB, name: "Review invoice", position: 1000 }], relationships: [], nodes: [] }],
  ]);
  const layouts = new Map<string, ProcessStepMapLayout>([
    [processA, { revision: 1, steps: [{ process_step_id: stepA, x: 96, y: 160, width: 224, height: 112 }], routes: [] }],
    [processB, { revision: 1, steps: [{ process_step_id: stepB, x: 512, y: 320, width: 224, height: 112 }], routes: [] }],
  ]);
  let denied = false;
  let releaseCreate: (() => void) | undefined;
  let releaseSave: (() => void) | undefined;
  const creates: unknown[] = [], renames: unknown[] = [], saves: Array<{ processID: string; layout: ProcessStepMapLayout }> = [];
  install("fetch", async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, apiBase);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/v1/me") return reply({ user: { user_id: "viewer" }, memberships: [] });
    if (url.pathname.endsWith("/users")) return reply({ users: [] });
    if (url.pathname === "/v1/saved-views") return reply({ saved_views: [] });
    if (url.pathname === "/v1/realtime/ticket") return reply({ ticket: "local-test" });
    const match = url.pathname.match(/^\/v2\/logic-gates\/([^/]+)\/(work|step-map|steps)(?:\/([^/]+))?$/);
    assert.ok(match, `Unexpected request ${method} ${url.pathname}`);
    const id = match[1];
    if (denied && id === processB) return reply({ error: "not_found" }, 404);
    if (match[2] === "work") return reply(snapshots.get(id));
    if (match[2] === "step-map" && method === "GET") return reply(layouts.get(id));
    if (match[2] === "step-map" && method === "PUT") {
      const layout = { revision: body.base_revision + 1, steps: body.steps, routes: body.routes };
      saves.push({ processID: id, layout });
      await new Promise<void>((resolve) => { releaseSave = resolve; });
      layouts.set(id, layout);
      return reply(layout);
    }
    if (match[2] === "steps" && method === "PATCH") {
      renames.push({ processID: id, stepID: match[3], body });
      const step = snapshots.get(id)!.steps.find((item) => item.process_step_id === match[3]);
      assert.ok(step);
      step.name = body.name;
      return reply({ step });
    }
    assert.equal(method, "POST");
    creates.push(body);
    await new Promise<void>((resolve) => { releaseCreate = resolve; });
    const step = { process_step_id: "66666666-6666-6666-6666-666666666666", logic_gate_id: id, name: body.name, position: 2000 };
    snapshots.get(id)!.steps.push(step);
    return reply({ step });
  });
  const { createRoot } = await import("react-dom/client");
  const { KanbanContent } = await import("../../../../frontend/src/modules/kanban/KanbanContent.js");
  const { dispatchLogicGateWorkUpdated, clearProcessWorkCache } = await import("../../../../frontend/src/modules/kanban/kanbanApi.js");
  const { updateRealtimeHealth, realtimeHealthKey } = await import("../../../../frontend/src/modules/realtime/realtimeHealth.js");
  clearProcessWorkCache(apiBase, companyID, processA);
  clearProcessWorkCache(apiBase, companyID, processB);
  const root = createRoot(dom.window.document.getElementById("root")!);
  const document = dom.window.document;
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label || item.getAttribute("aria-label") === label)!;
  const click = async (label: string) => { assert.ok(button(label), `Missing ${label} button`); await act(async () => button(label).click()); };
  const pointer = async (element: Element, type: string, x: number, y: number) => { await act(async () => element.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }))); };
  try {
    await act(async () => root.render(<KanbanContent accent="#17a8aa" widgetId="integration" forcedLogicGateID={processA} />));
    await settle(() => Boolean(document.querySelector(".process-work__step-title")), "Board did not load the original Step");
    updateRealtimeHealth(realtimeHealthKey(apiBase, companyID), { status: "connected" });
    await click("Map");
    await settle(() => Boolean(document.querySelector(`[data-step-map-id="${stepA}"]`)), "Map did not load the same Step");
    await settle(() => !button("+ Create Step").disabled, "Map never became editable");
    assert.ok(document.querySelector('[aria-label="Process outline: Order Process"]'));
    const controls = document.querySelector('[aria-label="Process map controls"]')!;
    assert.ok(controls.contains(button("Board")) && controls.contains(button("Map")) && controls.contains(button("+ Create Step")));
    assert.equal(document.querySelector('[aria-label="Process work views"]'), null, "the Map pane must not retain Board filters");
    assert.equal(document.querySelector(".process-step-map__toolbar, .process-step-map__inspector, .process-step-map__zoom"), null);
    await click("+ Create Step");
    await settle(() => Boolean(releaseCreate), "Create request did not start");
    assert.equal(button("Board").disabled, true);
    assert.equal(button("Map").disabled, true);
    await click("Board");
    assert.ok(document.querySelector(".process-step-map__canvas"), "a pending Step creation must keep its Map mounted");
    assert.equal(document.querySelector(".process-work__step-title"), null);
    await act(async () => releaseCreate!());
    await settle(() => Boolean(document.querySelector('[aria-label="Step name"]')) && !button("Board").disabled, "the created Step did not open inline naming");
    const input = document.querySelector<HTMLInputElement>('[aria-label="Step name"]')!;
    assert.equal(document.activeElement, input);
    assert.equal(input.selectionStart, 0);
    assert.equal(input.selectionEnd, input.value.length);
    await act(async () => { input.value = "Confirm purchase order"; Simulate.change(input); });
    await act(async () => Simulate.keyDown(input, { key: "Enter" }));
    await settle(() => Boolean(button("Move Confirm purchase order")) && !button("Board").disabled, "the inline name was not saved");
    assert.deepEqual(renames, [{ processID: processA, stepID: "66666666-6666-6666-6666-666666666666", body: { company_id: companyID, name: "Confirm purchase order" } }]);
    await click("Board");
    await settle(() => [...document.querySelectorAll(".process-work__step-title")].some((item) => item.textContent === "Confirm purchase order"), "Board did not receive the Step named in Map");
    assert.equal(creates.length, 1);
    await click("Map");
    await settle(() => Boolean(document.querySelector(`[data-step-map-id="${stepA}"]`)), "Map did not reopen");
    await settle(() => !button("+ Create Step").disabled, "Map controls are not ready");
    const viewport = document.querySelector<HTMLElement>(".process-step-map__viewport")!;
    const canvas = document.querySelector<HTMLElement>(".process-step-map__canvas")!;
    viewport.style.padding = "80px 24px 24px";
    Object.defineProperties(viewport, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    viewport.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() {} });
    const dataBefore = structuredClone(snapshots.get(processA)), layoutBefore = structuredClone(layouts.get(processA));
    await act(async () => viewport.dispatchEvent(new dom.window.WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 224, clientY: 230, deltaY: -Math.log(1.5 / .85) / .002 })));
    await pointer(viewport, "pointerdown", 400, 300);
    await pointer(viewport, "pointermove", 448, 332);
    await pointer(viewport, "pointerup", 448, 332);
    const camera = canvas.style.transform;
    assert.match(camera, /scale\(1\.5\)/);
    assert.deepEqual(snapshots.get(processA), dataBefore);
    assert.deepEqual(layouts.get(processA), layoutBefore);
    assert.equal(saves.length, 0, "camera navigation must not save Process geometry");
    assert.equal(button("Board").disabled, false, "camera navigation must not make authoring busy");
    const move = button("Move Receive purchase order");
    await pointer(move, "pointerdown", 100, 100);
    await pointer(viewport, "pointermove", 148, 100);
    assert.equal(button("Board").disabled, true, "a Step gesture must block view changes before its save starts");
    assert.equal(button("Map").disabled, true);
    await click("Board");
    assert.equal(document.querySelector(".process-step-map__canvas"), canvas);
    await pointer(viewport, "pointerup", 148, 100);
    await settle(() => Boolean(releaseSave), "Step position save did not start");
    assert.equal(button("Board").disabled, true, "finishing a gesture must remain blocked until its mutation completes");
    await click("Board");
    assert.equal(document.querySelector(".process-step-map__canvas"), canvas);
    assert.equal(saves[0].layout.steps.find((step) => step.process_step_id === stepA)!.x, 128, "screen movement must use the current zoom");
    await act(async () => releaseSave!());
    await settle(() => !button("Board").disabled, "view switching did not resume after the save");
    assert.equal(document.querySelector(".process-step-map__canvas"), canvas);
    assert.equal(canvas.style.transform, camera, "saving a Step move must preserve the active Map camera");
    assert.deepEqual(snapshots.get(processA), dataBefore, "layout saves must preserve the canonical Steps, names, and relationships");
    await click("Board");
    await click("Map");
    await settle(() => document.querySelector<HTMLElement>(`[data-step-map-id="${stepA}"]`)?.style.left === "128px", "Reopened Map lost persisted geometry");
    assert.equal(saves.length, 1, "view changes must not write layout");
    await act(async () => root.render(<KanbanContent accent="#17a8aa" widgetId="integration" forcedLogicGateID={processB} />));
    await settle(() => document.querySelector(".process-work__step-title")?.textContent === "Review invoice", "Navigation did not open the next Process Board");
    assert.equal(document.querySelector(`[data-step-map-id="${stepA}"]`), null);
    await click("Map");
    await settle(() => document.querySelector<HTMLElement>(`[data-step-map-id="${stepB}"]`)?.style.left === "512px", "Second Process Map did not use its own geometry");
    assert.ok(document.querySelector('[aria-label="Process outline: Finance Process"]'));
    denied = true;
    await act(async () => dispatchLogicGateWorkUpdated(companyID, processB));
    await settle(() => document.querySelector(".process-step-map__canvas") === null, "Revoked Process access left map geometry visible");
    assert.equal(button("Map").disabled, true);
    assert.equal(button("Board").disabled, false, "denied Map access must still allow returning to Board");
    assert.deepEqual(saves.map((save) => save.processID), [processA]);
  } finally {
    await act(async () => root.unmount());
    clearProcessWorkCache(apiBase, companyID, processA);
    clearProcessWorkCache(apiBase, companyID, processB);
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});
