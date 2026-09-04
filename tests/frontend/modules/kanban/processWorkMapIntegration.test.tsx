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

test("Board and Map share created Steps, restore saved geometry, and clear the old Process on navigation or denial", async () => {
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
  const creates: unknown[] = [], saves: Array<{ processID: string; layout: ProcessStepMapLayout }> = [];
  install("fetch", async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, apiBase);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/v1/me") return reply({ user: { user_id: "viewer" }, memberships: [] });
    if (url.pathname.endsWith("/users")) return reply({ users: [] });
    if (url.pathname === "/v1/saved-views") return reply({ saved_views: [] });
    if (url.pathname === "/v1/realtime/ticket") return reply({ ticket: "local-test" });
    const match = url.pathname.match(/^\/v2\/logic-gates\/([^/]+)\/(work|step-map|steps)$/);
    assert.ok(match, `Unexpected request ${method} ${url.pathname}`);
    const id = match[1];
    if (denied && id === processB) return reply({ error: "not_found" }, 404);
    if (match[2] === "work") return reply(snapshots.get(id));
    if (match[2] === "step-map" && method === "GET") return reply(layouts.get(id));
    if (match[2] === "step-map" && method === "PUT") {
      const layout = { revision: body.base_revision + 1, steps: body.steps, routes: body.routes };
      layouts.set(id, layout);
      saves.push({ processID: id, layout });
      return reply(layout);
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
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label)!;
  const click = async (label: string) => { assert.ok(button(label), `Missing ${label} button`); await act(async () => Simulate.click(button(label))); };
  try {
    await act(async () => root.render(<KanbanContent accent="#17a8aa" widgetId="integration" forcedLogicGateID={processA} />));
    await settle(() => Boolean(document.querySelector(".process-work__step-title")), "Board did not load the original Step");
    updateRealtimeHealth(realtimeHealthKey(apiBase, companyID), { status: "connected" });
    await click("Map");
    await settle(() => Boolean(document.querySelector(`[data-step-map-id="${stepA}"]`)), "Map did not load the same Step");
    await settle(() => !button("+ Create Step").disabled, "Map never became editable");
    await click("+ Create Step");
    await settle(() => Boolean(releaseCreate), "Create request did not start");
    await click("Board");
    await act(async () => releaseCreate!());
    await settle(() => [...document.querySelectorAll(".process-work__step-title")].some((item) => item.textContent === "New step"), "Board did not receive the Step created in Map after switching views");
    assert.equal(creates.length, 1);
    await click("Map");
    await settle(() => Boolean(document.querySelector(`[data-step-map-id="${stepA}"]`)), "Map did not reopen");
    await settle(() => !document.querySelector<HTMLButtonElement>(`[aria-label="Move Receive purchase order"]`)!.disabled, "Map controls are not ready");
    await act(async () => Simulate.keyDown(document.querySelector('[aria-label="Move Receive purchase order"]')!, { key: "ArrowRight" }));
    await settle(() => saves.length === 1, "Step position was not persisted");
    assert.equal(saves[0].layout.steps.find((step) => step.process_step_id === stepA)!.x, 112);
    await click("Board");
    await click("Map");
    await settle(() => document.querySelector<HTMLElement>(`[data-step-map-id="${stepA}"]`)?.style.left === "112px", "Reopened Map lost persisted geometry");
    assert.equal(saves.length, 1, "view changes must not write layout");
    await act(async () => root.render(<KanbanContent accent="#17a8aa" widgetId="integration" forcedLogicGateID={processB} />));
    await settle(() => document.querySelector(".process-work__step-title")?.textContent === "Review invoice", "Navigation did not open the next Process Board");
    assert.equal(document.querySelector(`[data-step-map-id="${stepA}"]`), null);
    await click("Map");
    await settle(() => document.querySelector<HTMLElement>(`[data-step-map-id="${stepB}"]`)?.style.left === "512px", "Second Process Map did not use its own geometry");
    denied = true;
    await act(async () => dispatchLogicGateWorkUpdated(companyID, processB));
    await settle(() => document.querySelector(".process-step-map__canvas") === null, "Revoked Process access left map geometry visible");
    assert.equal(button("Map").disabled, true);
    assert.deepEqual(saves.map((save) => save.processID), [processA]);
  } finally {
    await act(async () => root.unmount());
    clearProcessWorkCache(apiBase, companyID, processA);
    clearProcessWorkCache(apiBase, companyID, processB);
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});
