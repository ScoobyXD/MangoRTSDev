import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { PROCESS_NODE_DRAG, type ProcessWorkNode, type ProcessWorkSnapshot } from "../../../../frontend/src/modules/kanban/processWork.js";

const companyID = "11111111-1111-1111-1111-111111111111";
const processID = "22222222-2222-2222-2222-222222222229";
const stepA = "44444444-4444-4444-4444-444444444441";
const stepB = "44444444-4444-4444-4444-444444444442";
const movingID = "55555555-5555-5555-5555-555555555551";
const otherID = "55555555-5555-5555-5555-555555555552";
const requestedID = "55555555-5555-5555-5555-555555555553";
const unassignedID = "55555555-5555-5555-5555-555555555554";
const createdID = "55555555-5555-5555-5555-555555555555";
const apiBase = "http://localhost:8080";

async function settle(condition: () => boolean, description: string) {
  const until = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() >= until) assert.fail(description);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

test("Kanban and Steps share work, preserve independent status and step changes, and reconcile failed moves", async () => {
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
  const duplicateKeyWarnings: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (/Encountered two children with the same key/.test(String(args[0]))) duplicateKeyWarnings.push(args);
    else originalConsoleError(...args);
  };
  restores.push(() => { console.error = originalConsoleError; });

  const created = "2026-09-05T00:00:00Z";
  const node = (node_id: string, status: string, process_step_id: string | null, position: number): ProcessWorkNode => ({ node_id, node_title: node_id === movingID ? "Check purchase order" : node_id === otherID ? "Review shipment" : node_id === unassignedID ? "Prepare invoice" : "Requested inspection", status, process_step_id, position, is_issue: false, priority: 2, created_timestamp: created });
  const snapshot: ProcessWorkSnapshot = {
    logic_gate: { logic_gate_id: processID, header: "Order Process" },
    permissions: { can_edit: true, can_resolve_requests: true },
    steps: [
      { process_step_id: stepA, logic_gate_id: processID, name: "Receive order", position: 1000 },
      { process_step_id: stepB, logic_gate_id: processID, name: "Dispatch order", position: 2000 },
    ],
    relationships: [],
    nodes: [
      { ...node(movingID, "Pending", stepA, 1000), accounts: [
        { company_id: companyID, account_id: "account-a", name: "Alpha", created_timestamp: created },
        { company_id: companyID, account_id: "account-b", name: "Beta", created_timestamp: created },
      ] },
      node(otherID, "Review", stepB, 3000),
      { ...node(requestedID, "Requested", stepA, 4000), requested_by_user_id: "another-user" },
      node(unassignedID, "Pending", null, 5000),
    ],
  };
  const savedView = { company_id: companyID, saved_view_id: "saved-view", surface: "logic_gate_kanban", principal: "user", principal_id: "viewer", name: "Process work", groupings: [{ field: "account", direction: "asc" }], settings: { date_added_sort_enabled: false, date_added_sort_direction: "desc" }, position: 1000, created_timestamp: created, updated_timestamp: created };
  const nodeRecord = (current: ProcessWorkNode) => ({ company_id: companyID, node_id: current.node_id, name: current.node_title, status: current.status, priority: current.priority, created_timestamp: created });
  const commandResult = (current: ProcessWorkNode) => ({ node: nodeRecord(current), assignment: { assignment_id: current.node_id, company_id: companyID, node_id: current.node_id, logic_gate_id: processID, process_step_id: current.process_step_id, is_issue: current.is_issue, position: current.position, placed_by_user_id: current.placed_by_user_id, requested_by_user_id: current.requested_by_user_id, version: 1, created_timestamp: current.created_timestamp, updated_timestamp: created }, gvic_projection_rows: [] });
  const liveNodes = new Map(snapshot.nodes.map((current) => [current.node_id, nodeRecord(current)]));
  const recycledNodes = new Set<string>();
  const createWrites: Record<string, unknown>[] = [];
  const renameWrites: Array<{ nodeID: string; body: Record<string, unknown> }> = [];
  const detachWrites: Array<{ nodeID: string; companyID: string | null }> = [];
  const recycleWrites: Record<string, unknown>[] = [];
  let workReads = 0, savedViewReads = 0, savedViewWrites = 0, rejectNextMove = false;
  const stateWrites: Array<{ nodeID: string; body: Record<string, unknown> }> = [];
  install("fetch", async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, apiBase);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/v1/me") return reply({ user: { user_id: "viewer", display_name: "Board Tester" }, memberships: [] });
    if (url.pathname.endsWith("/users")) return reply({ users: [] });
    if (url.pathname.startsWith("/v1/saved-views")) {
      if (method === "GET") { savedViewReads++; return reply({ saved_views: [savedView] }); }
      savedViewWrites++; return reply({ ...savedView, ...body });
    }
    if (url.pathname === "/v1/realtime/ticket") return reply({ ticket: "local-test" });
    if (url.pathname === `/v2/logic-gates/${processID}/work`) { workReads++; return reply(snapshot); }
    if (url.pathname === `/v2/logic-gates/${processID}/nodes` && method === "POST") {
      createWrites.push(body);
      const current = { ...node(createdID, body.status, body.process_step_id ?? null, 6000), node_title: body.create_node_title, priority: body.priority, placed_by_user_id: "viewer" };
      snapshot.nodes.push(current);
      liveNodes.set(current.node_id, nodeRecord(current));
      return reply(commandResult(current), 201);
    }
    const renameMatch = url.pathname.match(/^\/v1\/nodes\/([^/]+)$/);
    if (renameMatch && method === "PUT") {
      const current = snapshot.nodes.find((item) => item.node_id === renameMatch[1]);
      assert.ok(current);
      renameWrites.push({ nodeID: current.node_id, body });
      current.node_title = body.name;
      liveNodes.set(current.node_id, nodeRecord(current));
      return reply(nodeRecord(current));
    }
    const detachMatch = url.pathname.match(/^\/v2\/logic-gates\/([^/]+)\/nodes\/([^/]+)$/);
    if (detachMatch && method === "DELETE") {
      assert.equal(detachMatch[1], processID);
      const current = snapshot.nodes.find((item) => item.node_id === detachMatch[2]);
      assert.ok(current);
      detachWrites.push({ nodeID: current.node_id, companyID: url.searchParams.get("company_id") });
      snapshot.nodes = snapshot.nodes.filter((item) => item.node_id !== current.node_id);
      return reply(commandResult(current));
    }
    if (url.pathname === "/v1/company-explorer/delete-targets" && method === "POST") {
      recycleWrites.push(body);
      for (const target of body.targets as Array<{ kind: string; id: string }>) {
        assert.equal(target.kind, "node");
        assert.ok(liveNodes.has(target.id));
        snapshot.nodes = snapshot.nodes.filter((item) => item.node_id !== target.id);
        liveNodes.delete(target.id);
        recycledNodes.add(target.id);
      }
      return reply({ status: "deleted" });
    }
    const match = url.pathname.match(/^\/v2\/logic-gates\/([^/]+)\/nodes\/([^/]+)\/state$/);
    assert.ok(match, `Unexpected request ${method} ${url.pathname}`);
    assert.equal(match[1], processID);
    assert.equal(method, "PUT");
    stateWrites.push({ nodeID: match[2], body });
    if (rejectNextMove) { rejectNextMove = false; return reply({ error: "move_rejected" }, 409); }
    const current = snapshot.nodes.find((item) => item.node_id === match[2]);
    assert.ok(current);
    for (const field of ["status", "process_step_id", "position", "priority", "is_issue"] as const) {
      if (Object.hasOwn(body, field)) Object.assign(current, { [field]: body[field] });
    }
    liveNodes.set(current.node_id, nodeRecord(current));
    return reply(commandResult(current));
  });
  const { createRoot } = await import("react-dom/client");
  const { KanbanContent } = await import("../../../../frontend/src/modules/kanban/KanbanContent.js");
  const { dispatchLogicGateWorkUpdated, clearProcessWorkCache } = await import("../../../../frontend/src/modules/kanban/kanbanApi.js");
  const { updateRealtimeHealth, realtimeHealthKey } = await import("../../../../frontend/src/modules/realtime/realtimeHealth.js");
  clearProcessWorkCache(apiBase, companyID, processID);
  const document = dom.window.document;
  const root = createRoot(document.getElementById("root")!);
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
  const click = async (label: string) => { const target = button(label); assert.ok(target, `Missing ${label} button`); await act(async () => target.click()); };
  const lane = (status: string) => document.querySelector<HTMLElement>(`[data-kanban-status="${status}"]`);
  const card = (id: string, parent: ParentNode = document) => parent.querySelector<HTMLElement>(`[data-process-node="${id}"]`);
  const drop = async (target: HTMLElement, ids: string[]) => {
    const dataTransfer = { types: [PROCESS_NODE_DRAG], getData: (type: string) => type === PROCESS_NODE_DRAG ? JSON.stringify({ companyID, logicGateID: processID, nodeIDs: ids }) : "", setData() {}, effectAllowed: "move" };
    await act(async () => Simulate.drop(target, { dataTransfer: dataTransfer as unknown as DataTransfer, clientX: 0, clientY: 0 }));
  };
  const contextMenu = async (target: HTMLElement) => { await act(async () => Simulate.contextMenu(target, { clientX: 100, clientY: 100 })); };
  const editTitle = async (input: HTMLInputElement, value: string, key: "Enter" | "Escape") => {
    await act(async () => { input.value = value; Simulate.change(input); });
    await act(async () => Simulate.keyDown(input, { key }));
  };
  try {
    await act(async () => root.render(<KanbanContent accent="#17a8aa" widgetId="status-integration" forcedLogicGateID={processID} />));
    await settle(() => document.querySelectorAll(`[data-process-node="${movingID}"]`).length === 2, "Saved account grouping did not render the Node in both account groups");
    updateRealtimeHealth(realtimeHealthKey(apiBase, companyID), { status: "connected" });
    assert.equal(button("Kanban board")?.getAttribute("aria-pressed"), "true");
    assert.deepEqual(new Set([...document.querySelectorAll<HTMLElement>("[data-kanban-status]")].map((item) => item.dataset.kanbanStatus)), new Set(["Requested", "Pending", "Backlogs", "In Progress", "Review", "Done"]));
    assert.ok(card(movingID, lane("Pending")!));
    assert.ok(button("Accept Requested inspection"), "A Responsible viewer must retain request actions");

    const readsBeforeSwitch = workReads;
    await click("Steps board");
    await settle(() => Boolean(document.querySelector(`[data-process-step="${stepB}"]`)), "Steps mode did not render the same steps");
    assert.ok(card(otherID, document.querySelector(`[data-process-step="${stepB}"]`)!));
    await click("Kanban board");
    assert.equal(workReads, readsBeforeSwitch, "Changing Board presentation must reuse its existing canonical work read");
    assert.equal(savedViewReads, 1, "Both modes must load the same saved grouping once");
    assert.equal(savedViewWrites, 0, "A mode switch must not create another preference record");

    await act(async () => card(movingID, lane("Pending")!)!.click());
    assert.match(document.querySelector(".process-work__selection")?.textContent ?? "", /1 selected/);
    const dragged = new Map<string, string>();
    await act(async () => Simulate.dragStart(card(movingID, lane("Pending")!)!, { dataTransfer: {
      setData: (type: string, value: string) => dragged.set(type, value), getData: (type: string) => dragged.get(type) ?? "", setDragImage() {}, effectAllowed: "move",
    } as unknown as DataTransfer }));
    assert.deepEqual(JSON.parse(dragged.get(PROCESS_NODE_DRAG)!).nodeIDs, [movingID], "Account groups must not duplicate the selected Node in a drag payload");
    await drop(lane("In Progress")!, [movingID, movingID]);
    await settle(() => Boolean(card(movingID, lane("In Progress")!)), "Status move did not refresh Kanban");
    assert.equal(stateWrites.length, 1, "Duplicate appearances of one Node must produce one state command");
    assert.equal(stateWrites[0].nodeID, movingID);
    assert.equal(stateWrites[0].body.status, "In Progress");
    assert.equal(Object.hasOwn(stateWrites[0].body, "process_step_id"), false, "Status movement must not write step placement");
    assert.equal(snapshot.nodes[0].process_step_id, stepA);
    assert.equal(document.querySelectorAll(`[data-process-node="${movingID}"]`).length, 2, "Reconciliation must retain exactly one appearance per matching account group");

    await click("Steps board");
    assert.ok(card(movingID, document.querySelector(`[data-process-step="${stepA}"]`)!));
    await drop(document.querySelector<HTMLElement>(`[data-process-step="${stepB}"]`)!, [movingID]);
    await settle(() => Boolean(card(movingID, document.querySelector(`[data-process-step="${stepB}"]`)!)), "Step move did not refresh the shared Node");
    assert.equal(stateWrites.length, 2);
    assert.equal(stateWrites[1].body.process_step_id, stepB);
    assert.equal(Object.hasOwn(stateWrites[1].body, "status"), false, "Step movement must not write Node status");
    assert.equal(snapshot.nodes[0].status, "In Progress");

    await click("Kanban board");
    const readsBeforeFailure = workReads;
    rejectNextMove = true;
    await drop(lane("Done")!, [movingID]);
    await settle(() => workReads > readsBeforeFailure && Boolean(document.querySelector('[role="alert"]')) && Boolean(card(movingID, lane("In Progress")!)), "Failed mutation did not reconcile through the canonical work read");
    assert.equal(card(movingID, lane("Done")!), null);
    assert.equal(snapshot.nodes[0].status, "In Progress");
    assert.equal(snapshot.nodes[0].process_step_id, stepB);

    await drop(lane("In Progress")!, [unassignedID]);
    await settle(() => Boolean(card(unassignedID, lane("In Progress")!)), "Kanban must allow active work without asking for a step");
    assert.equal(Object.hasOwn(stateWrites.at(-1)!.body, "process_step_id"), false);
    assert.equal(snapshot.nodes.find((item) => item.node_id === unassignedID)?.process_step_id, null);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await click("Steps board");
    assert.ok(card(unassignedID, document.querySelector('[data-process-step="unassigned"]')!), "Status-only active work belongs under No step assigned");
    await click("Kanban board");

    await click("Create node in Pending");
    await click("2\u00a0\u00a0By end of day");
    await settle(() => Boolean(card(createdID)?.querySelector("input")), "Creating a Node must start its inline title editor");
    assert.deepEqual(createWrites, [{ company_id: companyID, create_node_title: "New Node", status: "Pending", priority: 2, mutation_origin: "kanban" }]);
    assert.equal(snapshot.nodes.find((item) => item.node_id === createdID)?.process_step_id, null);
    await editTitle(card(createdID)!.querySelector<HTMLInputElement>("input")!, "Pack order", "Enter");
    await settle(() => card(createdID)?.textContent?.includes("Pack order") === true && !card(createdID)?.querySelector("input"), "Committed inline title did not replace New Node");
    assert.deepEqual(renameWrites, [{ nodeID: createdID, body: { company_id: companyID, name: "Pack order" } }]);

    const groupedOccurrences = () => [...document.querySelectorAll<HTMLElement>(`[data-process-node="${movingID}"]`)];
    await contextMenu(groupedOccurrences()[1]);
    await click("Rename node");
    await settle(() => Boolean(groupedOccurrences()[1]?.querySelector("input")), "Rename must edit the chosen account-group appearance");
    assert.equal(document.querySelectorAll(`[data-process-node="${movingID}"] input`).length, 1, "A grouped Node must have only one active title editor");
    await editTitle(groupedOccurrences()[1].querySelector<HTMLInputElement>("input")!, "Discarded draft", "Escape");
    assert.equal(renameWrites.length, 1, "Cancelling inline rename must not write the Node");
    assert.ok(groupedOccurrences().every((item) => item.textContent?.includes("Check purchase order")));
    await contextMenu(groupedOccurrences()[1]);
    await click("Rename node");
    await editTitle(groupedOccurrences()[1].querySelector<HTMLInputElement>("input")!, "Check approved order", "Enter");
    await settle(() => groupedOccurrences().every((item) => item.textContent?.includes("Check approved order")), "One committed Node title must update every grouped appearance");
    assert.equal(renameWrites.length, 2, "Grouped rename must save exactly once");
    assert.deepEqual(renameWrites[1], { nodeID: movingID, body: { company_id: companyID, name: "Check approved order" } });

    const stepsBeforeRemoval = structuredClone(snapshot.steps);
    await contextMenu(card(createdID)!);
    await click("Remove node from Kanban Board");
    await click("No");
    assert.equal(detachWrites.length, 0, "Cancelling removal must retain Process membership");
    assert.ok(card(createdID));
    await contextMenu(card(createdID)!);
    await click("Remove node from Kanban Board");
    await click("Yes");
    await settle(() => !card(createdID), "Confirmed detach did not remove the Process card");
    assert.deepEqual(detachWrites, [{ nodeID: createdID, companyID }]);
    assert.ok(liveNodes.has(createdID), "Removing a card must preserve its underlying Node");
    assert.equal(recycledNodes.has(createdID), false);
    assert.equal(recycleWrites.length, 0, "Detach must not invoke typed Node deletion");

    await contextMenu(card(otherID)!);
    await click("Delete node");
    await settle(() => button("Yes")?.disabled === false, "Node recycle confirmation did not resolve the acting user's name");
    await click("Yes");
    await settle(() => !card(otherID), "Confirmed deletion did not remove the Node card");
    assert.deepEqual(recycleWrites, [{ company_id: companyID, targets: [{ kind: "node", id: otherID }], confirmation_display_name: "Board Tester" }]);
    assert.equal(detachWrites.length, 1, "Node deletion must use the atomic typed-target command instead of a detach request");
    assert.equal(liveNodes.has(otherID), false);
    assert.equal(recycledNodes.has(otherID), true);
    assert.ok(liveNodes.has(createdID), "Deleting another Node must preserve the detached Node");
    assert.deepEqual(snapshot.steps, stepsBeforeRemoval, "Detach and Node deletion must preserve Process steps");

    snapshot.permissions = { can_edit: false, can_resolve_requests: false };
    await act(async () => dispatchLogicGateWorkUpdated(companyID, processID));
    await settle(() => card(movingID)?.draggable === false && !button("Accept Requested inspection"), "Read-only work retained mutation affordances");
    assert.equal(document.querySelector('[aria-label^="New Node in "], [aria-label^="Create node in "]'), null);
    assert.equal(document.querySelector('[aria-label="Set selected Nodes status"]'), null);
    assert.equal(button("Delete Nodes"), undefined);
    assert.equal(button("Detach Nodes"), undefined);
    const writesBeforeDeniedDrop = stateWrites.length;
    await drop(lane("Done")!, [movingID]);
    assert.equal(stateWrites.length, writesBeforeDeniedDrop, "Read-only drag must not send a mutation");
    assert.equal(duplicateKeyWarnings.length, 0, "Each account-group appearance needs a distinct React key so status updates reconcile reliably");
  } finally {
    await act(async () => root.unmount());
    clearProcessWorkCache(apiBase, companyID, processID);
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});
