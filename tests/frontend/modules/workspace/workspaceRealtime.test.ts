import test from "node:test";
import assert from "node:assert/strict";

import {
  companyExplorerRealtimeScope,
  deriveWorkspaceReconciliationScopes,
  nodeGraphRealtimeScope,
  subscribeWorkspaceRealtime,
  workspaceRealtimeScope,
  workspaceScopeRequiresKanbanBoardRefetch,
} from "../../../../frontend/src/modules/workspace/workspaceRealtime.js";

test("builds user-scoped workspace realtime scopes", () => {
  assert.equal(workspaceRealtimeScope("user-1"), "workspace:user:user-1");
  assert.equal(companyExplorerRealtimeScope("user-1"), "company_explorer:user:user-1");
  assert.equal(nodeGraphRealtimeScope("user-1"), "node_graph:user:user-1");
  assert.equal(workspaceRealtimeScope(" "), "");
});

test("workspace realtime accepted boundary and events update cursor without gap signals", async () => {
  const harness = installRealtimeHarness();
  const receivedIDs: string[] = [];
  const replayBoundaries: number[] = [];
  let gaps = 0;

  try {
    const unsubscribe = subscribeWorkspaceRealtime("https://api.workspace-realtime-in-order.test", "company-in-order", "workspace:user:user-1", {
      onReplayBoundary: (boundary) => {
        replayBoundaries.push(boundary.afterSequence);
      },
      onGap: () => {
        gaps += 1;
      },
      onEvent: (event, context) => {
        if (context.replayBoundary) {
          assert.equal(event.id, "10");
          return;
        }
        if (!event.id) return;
        receivedIDs.push(event.id);
      },
      onError: (error) => {
        throw error instanceof Error ? error : new Error(String(error));
      },
    });

    await harness.waitForSocket();
    assert.equal(harness.openedURLs.length, 1);
    const url = new URL(harness.openedURLs[0]);
    assert.equal(url.searchParams.has("ticket"), false);
    assert.equal(url.searchParams.has("access_token"), false);
    assert.equal(url.searchParams.has("token"), false);
    assert.deepEqual(harness.subscriptionScopes(), ["workspace:user:user-1"]);

    harness.emit({
      type: "subscription.accepted",
      scope: "workspace:user:user-1",
      current_sequence: 10,
    });
    harness.emit(workspaceEventMessage("company-in-order", "workspace:user:user-1", 11, "node_updated", { node_id: "node-11" }));
    harness.emit(workspaceEventMessage("company-in-order", "workspace:user:user-1", 12, "node_updated", { node_id: "node-12" }));

    assert.deepEqual(replayBoundaries, [10]);
    assert.deepEqual(receivedIDs, ["11", "12"]);
    assert.equal(gaps, 0);
    unsubscribe();
  } finally {
    harness.restore();
  }
});

test("workspace realtime emits scoped gap metadata and ignores stale events", async () => {
  const harness = installRealtimeHarness();
  const receivedIDs: string[] = [];
  const gapSignals: Array<{ previousSequence: number; receivedSequence: number; missingFrom: number; missingTo: number; boardID?: string }> = [];

  try {
    const unsubscribe = subscribeWorkspaceRealtime("https://api.workspace-realtime-gap.test", "company-gap", "workspace:user:user-1", {
      onGap: (gap) => {
        const boardScope = gap.scopes.find((scope) => scope.kind === "kanban_board");
        gapSignals.push({
          previousSequence: gap.previousSequence,
          receivedSequence: gap.receivedSequence,
          missingFrom: gap.missingFrom,
          missingTo: gap.missingTo,
          boardID: boardScope?.boardID,
        });
      },
      onEvent: (event, context) => {
        if (context.replayBoundary || !event.id) return;
        receivedIDs.push(event.id);
      },
      onError: (error) => {
        throw error instanceof Error ? error : new Error(String(error));
      },
    });

    await harness.waitForSocket();
    harness.emit({ type: "subscription.accepted", scope: "workspace:user:user-1", current_sequence: 20 });
    harness.emit(workspaceEventMessage("company-gap", "workspace:user:user-1", 22, "kanban_card_moved", { board_id: "board-A", card_id: "card-A" }));
    harness.emit(workspaceEventMessage("company-gap", "workspace:user:user-1", 22, "kanban_card_moved", { board_id: "board-A", card_id: "card-A-duplicate" }));
    harness.emit(workspaceEventMessage("company-gap", "workspace:user:user-1", 21, "node_updated", { node_id: "node-stale" }));

    assert.deepEqual(receivedIDs, ["22"]);
    assert.deepEqual(gapSignals, [{ previousSequence: 20, receivedSequence: 22, missingFrom: 21, missingTo: 21, boardID: "board-A" }]);
    unsubscribe();
  } finally {
    harness.restore();
  }
});

test("workspace realtime converts snapshot refetch messages into workspace gap signals", async () => {
  const harness = installRealtimeHarness();
  const gapScopes: string[] = [];

  try {
    const unsubscribe = subscribeWorkspaceRealtime("https://api.workspace-realtime-refetch.test", "company-refetch", "workspace:user:user-1", {
      onGap: (gap) => {
        gapScopes.push(...gap.scopes.map((scope) => scope.eventType));
        assert.equal(gap.previousSequence, 4);
        assert.equal(gap.receivedSequence, 7);
        assert.equal(gap.missingFrom, 5);
        assert.equal(gap.missingTo, 7);
      },
      onEvent: () => undefined,
      onError: (error) => {
        throw error instanceof Error ? error : new Error(String(error));
      },
    });

    await harness.waitForSocket();
    harness.emit({ type: "subscription.accepted", scope: "workspace:user:user-1", current_sequence: 4 });
    harness.emit({ type: "snapshot.refetch", scope: "workspace:user:user-1", sequence: 7, reason: "sequence_unavailable" });

    assert.deepEqual(gapScopes, ["workspace_snapshot_refetch"]);
    unsubscribe();
  } finally {
    harness.restore();
  }
});

test("workspace realtime fans one scoped event out to multiple local subscribers", async () => {
  const harness = installRealtimeHarness();
  const firstReceived: string[] = [];
  const secondReceived: string[] = [];

  try {
    const firstUnsubscribe = subscribeWorkspaceRealtime("https://api.workspace-realtime-fanout.test", "company-fanout", "workspace:user:user-1", {
      onEvent: (event, context) => {
        if (!context.replayBoundary && event.id) firstReceived.push(event.id);
      },
    });
    const secondUnsubscribe = subscribeWorkspaceRealtime("https://api.workspace-realtime-fanout.test", "company-fanout", "workspace:user:user-1", {
      onEvent: (event, context) => {
        if (!context.replayBoundary && event.id) secondReceived.push(event.id);
      },
    });

    await harness.waitForSocket();
    assert.equal(harness.openedURLs.length, 1);
    assert.deepEqual(harness.subscriptionScopes(), ["workspace:user:user-1"]);

    harness.emit({ type: "subscription.accepted", scope: "workspace:user:user-1", current_sequence: 30 });
    harness.emit(workspaceEventMessage("company-fanout", "workspace:user:user-1", 31, "node_updated", { node_id: "node-31" }));

    assert.deepEqual(firstReceived, ["31"]);
    assert.deepEqual(secondReceived, ["31"]);
    firstUnsubscribe();
    secondUnsubscribe();
  } finally {
    harness.restore();
  }
});

test("derives scoped invalidation targets from workspace event types", () => {
  const nodeScopes = deriveWorkspaceReconciliationScopes({ type: "node_updated", data: { node_id: "node-1", node: { node_id: "node-1", logic_gate_ids: ["gate-1", "gate-2"] } } });
  assert.equal(nodeScopes.some((scope) => scope.kind === "node_graph" && scope.nodeID === "node-1"), true);
  assert.equal(nodeScopes.some((scope) => scope.kind === "company_explorer" && scope.itemType === "node" && scope.itemID === "node-1"), true);
  assert.equal(nodeScopes.some((scope) => scope.kind === "kanban_board" && scope.boardID === "logic-gate:gate-1" && scope.logicGateID === "gate-1" && scope.nodeID === "node-1"), true);
  assert.equal(nodeScopes.some((scope) => scope.kind === "kanban_board" && scope.boardID === "logic-gate:gate-2" && scope.logicGateID === "gate-2" && scope.nodeID === "node-1"), true);
  assert.equal(nodeScopes.some((scope) => scope.kind === "gvic_matrix" && scope.nodeID === "node-1"), true);
  assert.equal(nodeScopes.some((scope) => scope.kind === "workspace"), false);

  const assignmentScopes = deriveWorkspaceReconciliationScopes({ type: "work_item.logic_gate_assignment_saved", data: { logic_gate_id: "gate-A", node_id: "node-A", assignment_id: "assignment-A" } });
  assert.equal(assignmentScopes.some((scope) => scope.kind === "gvic_matrix" && scope.logicGateID === "gate-A" && scope.nodeID === "node-A"), true);
  assert.equal(assignmentScopes.filter((scope) => scope.kind === "work_item_assignment" && scope.boardID === "logic-gate:gate-A").length, 1);
  assert.equal(assignmentScopes.some((scope) => scope.kind === "kanban_board"), false);

  const logicGateScopes = deriveWorkspaceReconciliationScopes({ type: "logic_gate_gvic_updated", data: { logic_gate_id: "gate-B" } });
  assert.equal(logicGateScopes.some((scope) => scope.kind === "gvic_matrix" && scope.logicGateID === "gate-B"), true);

  const kanbanScopes = deriveWorkspaceReconciliationScopes({ type: "kanban_card_moved", data: { board_id: "board-A", card_id: "card-A", node_id: "node-A" } });
  assert.equal(kanbanScopes.some((scope) => scope.kind === "kanban_board" && scope.boardID === "board-A" && scope.cardID === "card-A"), true);
  assert.equal(kanbanScopes.some((scope) => scope.kind === "workspace"), false);

  const folderScopes = deriveWorkspaceReconciliationScopes({ type: "company_explorer_folder_item_assigned", data: { folder_id: "folder-1", item_type: "node", item_id: "node-2" } });
  assert.equal(folderScopes.some((scope) => scope.kind === "company_explorer" && scope.folderID === "folder-1" && scope.itemType === "node"), true);
  assert.equal(folderScopes.some((scope) => scope.kind === "node_graph" && scope.folderID === "folder-1" && scope.nodeID === "node-2"), true);

  const unknownScopes = deriveWorkspaceReconciliationScopes({ type: "future_workspace_event", data: { id: "unknown" } });
  assert.deepEqual(unknownScopes, [{ kind: "workspace", eventType: "future_workspace_event" }]);
});

test("exact Kanban projection events do not request duplicate broad board reloads", () => {
  assert.equal(workspaceScopeRequiresKanbanBoardRefetch({
    kind: "work_item_assignment",
    eventType: "work_item.logic_gate_assignment_saved",
    boardID: "logic-gate:gate-1",
  }), false);
  assert.equal(workspaceScopeRequiresKanbanBoardRefetch({
    kind: "kanban_board",
    eventType: "kanban_card_moved",
    boardID: "logic-gate:gate-1",
  }), false);
  assert.equal(workspaceScopeRequiresKanbanBoardRefetch({
    kind: "kanban_board",
    eventType: "node_updated",
    boardID: "logic-gate:gate-1",
  }), false);
  assert.equal(workspaceScopeRequiresKanbanBoardRefetch({
    kind: "kanban_board",
    eventType: "kanban_column_updated",
    boardID: "logic-gate:gate-1",
  }), true);
});

test("semantic affected scopes override broad workspace heuristics", () => {
  const scopes = deriveWorkspaceReconciliationScopes({
    type: "node_updated",
    data: {
      node_id: "node-1",
      affected_scopes: [
        "my_work:user:user-1",
        "updates:user:user-1",
        "company_explorer:folder:folder-1",
        "company_explorer:node:node-1",
      ],
    },
  });

  assert.equal(scopes.some((scope) => scope.kind === "my_work" && scope.userID === "user-1" && scope.semanticScope === "my_work:user:user-1"), true);
  assert.equal(scopes.some((scope) => scope.kind === "updates" && scope.userID === "user-1" && scope.semanticScope === "updates:user:user-1"), true);
  assert.equal(scopes.some((scope) => scope.kind === "company_explorer" && scope.folderID === "folder-1"), true);
  assert.equal(scopes.some((scope) => scope.kind === "company_explorer" && scope.nodeID === "node-1" && scope.itemType === "node"), true);
  assert.equal(scopes.some((scope) => scope.kind === "node_graph"), false);
  assert.equal(scopes.some((scope) => scope.kind === "gvic_matrix"), false);
  assert.equal(scopes.some((scope) => scope.kind === "workspace"), false);
});

test("internal derived projection request events produce no reconciliation scopes", () => {
  for (const type of [
    "workspace_derived_projection_requested",
    "company_explorer_folder_item_assign_requested",
    "node_map_position_upsert_requested",
    "logic_gate_map_position_upsert_requested",
  ]) {
    assert.deepEqual(deriveWorkspaceReconciliationScopes({ type, data: { item_type: "node", item_id: "node-1" } }), []);
  }
});

function workspaceEventMessage(companyID: string, scope: string, sequence: number, type: string, data: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "workspace.event",
    company_id: companyID,
    scope,
    sequence,
    event: {
      company_id: companyID,
      sequence,
      type,
      data,
    },
  };
}

function installRealtimeHarness(): {
  openedURLs: string[];
  sentMessages: string[];
  emit: (message: Record<string, unknown>) => void;
  restore: () => void;
  subscriptionScopes: () => string[];
  waitForSocket: () => Promise<void>;
} {
  const previousFetch = globalThis.fetch;
  const previousWebSocket = globalThis.WebSocket;
  const openedURLs: string[] = [];
  const sentMessages: string[] = [];
  const sockets: FakeWorkspaceWebSocket[] = [];

  class FakeWorkspaceWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeWorkspaceWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(url: string) {
      openedURLs.push(url);
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = FakeWorkspaceWebSocket.OPEN;
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
      });
    }

    send(message: string): void {
      sentMessages.push(message);
    }

    close(): void {
      this.readyState = FakeWorkspaceWebSocket.CLOSED;
      this.onclose?.();
    }
  }

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/v1/realtime/ticket");
    return new Response(JSON.stringify({ expires_at: "2026-06-04T00:00:30.000Z" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  (globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket = FakeWorkspaceWebSocket as unknown as typeof WebSocket;

  return {
    openedURLs,
    sentMessages,
    emit(message) {
      assert.ok(sockets[0], "expected websocket to be opened");
      sockets[0].onmessage?.({ data: JSON.stringify(message) });
    },
    restore() {
      for (const socket of sockets) socket.close();
      globalThis.fetch = previousFetch;
      globalThis.WebSocket = previousWebSocket;
    },
    subscriptionScopes() {
      return sentMessages
        .map((message) => JSON.parse(message) as { type: string; scope?: string })
        .filter((message) => message.type === "subscribe")
        .map((message) => message.scope ?? "");
    },
    async waitForSocket() {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (sockets.length > 0 && sentMessages.some((message) => JSON.parse(message).type === "subscribe")) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assert.fail("expected websocket subscription");
    },
  };
}
