import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { PROCESS_NODE_DRAG, type ProcessWorkSnapshot } from "../../../../frontend/src/modules/kanban/processWork.js";

const companyID = "11111111-1111-1111-1111-111111111111";
const processA = "22222222-2222-2222-2222-222222222221";
const processB = "22222222-2222-2222-2222-222222222222";
const nodeA = "33333333-3333-3333-3333-333333333331";
const nodeB = "33333333-3333-3333-3333-333333333332";
const apiBase = "http://localhost:8080";

async function settle(condition: () => boolean, description: string) {
  const until = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() >= until) assert.fail(description);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

test("switching to a cached Process keeps controls disabled until the previous save finishes", async () => {
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
  install("WebSocket", class { static OPEN = 1; static CLOSED = 3; readyState = 0; send() {} close() { this.readyState = 3; } });
  dom.window.sessionStorage.setItem("mangorts:active-company-id-v1", companyID);

  const created = "2026-09-05T00:00:00Z";
  const snapshot = (logic_gate_id: string, node_id: string): ProcessWorkSnapshot => ({
    logic_gate: { logic_gate_id, header: logic_gate_id }, permissions: { can_edit: true, can_resolve_requests: false }, steps: [], relationships: [],
    nodes: [{ node_id, node_title: node_id, status: "Pending", process_step_id: null, is_issue: false, position: 1000, priority: 2, created_timestamp: created }],
  });
  const snapshots = new Map([[processA, snapshot(processA, nodeA)], [processB, snapshot(processB, nodeB)]]);
  let releaseSave: (() => void) | undefined;
  const writes: Array<{ processID: string; nodeID: string }> = [];
  install("fetch", async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, apiBase);
    const method = init?.method ?? "GET";
    const reply = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/v1/me") return reply({ user: { user_id: "viewer" }, memberships: [] });
    if (url.pathname.endsWith("/users")) return reply({ users: [] });
    if (url.pathname === "/v1/saved-views") return reply({ saved_views: [] });
    if (url.pathname === "/v1/realtime/ticket") return reply({ ticket: "local-test" });
    const work = url.pathname.match(/^\/v2\/logic-gates\/([^/]+)\/work$/);
    if (work) return reply(snapshots.get(work[1]));
    const state = url.pathname.match(/^\/v2\/logic-gates\/([^/]+)\/nodes\/([^/]+)\/state$/);
    assert.ok(state, `Unexpected request ${method} ${url.pathname}`);
    assert.equal(method, "PUT");
    const node = snapshots.get(state[1])!.nodes.find((item) => item.node_id === state[2]);
    assert.ok(node);
    writes.push({ processID: state[1], nodeID: state[2] });
    if (state[1] === processA) await new Promise<void>((resolve) => { releaseSave = resolve; });
    const body = JSON.parse(String(init?.body));
    node.status = body.status;
    return reply({ node: { company_id: companyID, node_id: node.node_id, name: node.node_title, status: node.status, created_timestamp: created }, assignment: { ...node, company_id: companyID, logic_gate_id: state[1], assignment_id: node.node_id, version: 2, updated_timestamp: created } });
  });
  const { createRoot } = await import("react-dom/client");
  const { KanbanContent } = await import("../../../../frontend/src/modules/kanban/KanbanContent.js");
  const { getProcessWorkSingleFlight, clearProcessWorkCache } = await import("../../../../frontend/src/modules/kanban/kanbanApi.js");
  const { updateRealtimeHealth, realtimeHealthKey } = await import("../../../../frontend/src/modules/realtime/realtimeHealth.js");
  clearProcessWorkCache(apiBase, companyID, processA);
  clearProcessWorkCache(apiBase, companyID, processB);
  await getProcessWorkSingleFlight(apiBase, companyID, processB);
  const document = dom.window.document;
  const root = createRoot(document.getElementById("root")!);
  const card = (id: string) => document.querySelector<HTMLElement>(`[data-process-node="${id}"]`);
  const createButton = () => document.querySelector<HTMLButtonElement>('[aria-label="Create node in Pending"]');
  const drop = async (processID: string, nodeID: string) => {
    const target = document.querySelector<HTMLElement>('[data-kanban-status="Done"]');
    assert.ok(target);
    const dataTransfer = { types: [PROCESS_NODE_DRAG], getData: (type: string) => type === PROCESS_NODE_DRAG ? JSON.stringify({ companyID, logicGateID: processID, nodeIDs: [nodeID] }) : "", setData() {}, effectAllowed: "move" };
    await act(async () => Simulate.drop(target, { dataTransfer: dataTransfer as unknown as DataTransfer, clientX: 0, clientY: 0 }));
  };
  try {
    await act(async () => root.render(<KanbanContent accent="#17a8aa" widgetId="scope-integration" forcedLogicGateID={processA} />));
    await settle(() => Boolean(card(nodeA)) && createButton()?.disabled === false, "Process A did not become editable");
    updateRealtimeHealth(realtimeHealthKey(apiBase, companyID), { status: "connected" });
    await drop(processA, nodeA);
    await settle(() => Boolean(releaseSave), "Process A save did not start");
    await act(async () => root.render(<KanbanContent accent="#17a8aa" widgetId="scope-integration" forcedLogicGateID={processB} />));
    await settle(() => Boolean(card(nodeB)), "Cached Process B did not render while A was saving");
    assert.equal(card(nodeA), null);
    assert.equal(createButton()?.disabled, true, "Process B must not advertise actions the pending-mutation guard will discard");
    assert.equal(card(nodeB)?.draggable, false, "Process B drag must remain disabled until the pending save ends");
    await drop(processB, nodeB);
    assert.deepEqual(writes, [{ processID: processA, nodeID: nodeA }]);

    await act(async () => releaseSave!());
    releaseSave = undefined;
    await settle(() => createButton()?.disabled === false && card(nodeB)?.draggable === true, "Process B remained locked after Process A completed");
    assert.equal(card(nodeA), null, "The old save must not reinsert a Node into Process B");
    updateRealtimeHealth(realtimeHealthKey(apiBase, companyID), { status: "connected" });
    await drop(processB, nodeB);
    await settle(() => snapshots.get(processB)?.nodes[0].status === "Done" && createButton()?.disabled === false, "Process B's first action after unlocking was not saved");
    assert.deepEqual(writes, [{ processID: processA, nodeID: nodeA }, { processID: processB, nodeID: nodeB }]);
  } finally {
    if (releaseSave) await act(async () => releaseSave!());
    await act(async () => root.unmount());
    clearProcessWorkCache(apiBase, companyID, processA);
    clearProcessWorkCache(apiBase, companyID, processB);
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});
