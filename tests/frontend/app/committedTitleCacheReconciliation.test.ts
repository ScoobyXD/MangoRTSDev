import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reconcileCachesForCommittedEntityTitle } from "../../../frontend/src/app/committedTitleCacheReconciliation.js";
import {
  publishCommittedEntityTitleUpdate,
  resetCommittedEntityTitleRegistryForTests,
  subscribeCommittedEntityTitleUpdates,
} from "../../../frontend/src/modules/realtime/committedEntityTitleUpdates.js";
import {
  invalidateCommunicationsCache,
  listNodes,
} from "../../../frontend/src/modules/communications/communicationsApi.js";
import {
  clearKanbanBoardContentsCache,
  getKanbanBoardContentsSingleFlight,
  peekKanbanBoardContentsCache,
  primeKanbanBoardContentsCache,
  type KanbanBoardContents,
} from "../../../frontend/src/modules/kanban/KanbanBoardContentStore.js";
import {
  invalidateKanbanBoardListCache,
  listKanbanBoards,
} from "../../../frontend/src/modules/kanban/kanbanApi.js";
import { logicGateKanbanBoardID } from "../../../frontend/src/modules/kanban/shared.js";
import {
  getNodeRelationshipGraphSnapshot,
  hasNodeRelationshipGraphSnapshot,
  refreshNodeRelationshipGraphSnapshot,
} from "../../../frontend/src/modules/nodes/nodeRelationshipGraph.js";

test("Node title publication invalidates Home and PM reads and patches cached Kanban cards", async () => {
  const appLayoutSource = readFileSync("frontend/src/app/applayout.tsx", "utf8");
  assert.match(
    appLayoutSource,
    /subscribeCommittedEntityTitleUpdates[\s\S]*reconcileCachesForCommittedEntityTitle\(apiBase, update\)/,
  );
  const apiBase = "https://title-cache-node.example.test";
  const companyID = "title-cache-node-company";
  const nodeID = "node-1";
  const boardID = logicGateKanbanBoardID("gate-for-node");
  invalidateCommunicationsCache();
  clearKanbanBoardContentsCache(apiBase, companyID, boardID);
  resetCommittedEntityTitleRegistryForTests();
  let nodeFetches = 0;
  const originalFetch = globalThis.fetch;
  const target = new EventTarget();
  const unsubscribe = subscribeCommittedEntityTitleUpdates(
    (update) => reconcileCachesForCommittedEntityTitle(apiBase, update),
    target,
  );
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = input.toString();
    if (!path.startsWith(`/v1/nodes?company_id=${companyID}`)) throw new Error(`unexpected request: ${path}`);
    nodeFetches += 1;
    return jsonResponse({
      nodes: [{
        company_id: companyID,
        node_id: nodeID,
        name: nodeFetches === 1 ? "Old node" : "Canonical new node",
        created_timestamp: "2026-07-13T00:00:00Z",
      }],
    });
  };
  primeKanbanBoardContentsCache(apiBase, companyID, boardID, boardContents(companyID, "gate-for-node", {
    nodeID,
    nodeTitle: "Old node",
  }));

  try {
    assert.equal((await listNodes(companyID))[0]?.name, "Old node");
    assert.equal((await listNodes(companyID))[0]?.name, "Old node");
    assert.equal(nodeFetches, 1, "the second pre-publication read must be a cache hit");

    publishCommittedEntityTitleUpdate({
      companyID,
      entityType: "node",
      resourceID: nodeID,
      title: "Committed node",
    }, target);

    assert.equal((await listNodes(companyID))[0]?.name, "Canonical new node");
    assert.equal(nodeFetches, 2, "the first post-publication panel read must refetch");
    assert.equal(
      (await getKanbanBoardContentsSingleFlight(apiBase, companyID, boardID)).cards[0]?.node_title,
      "Committed node",
      "a cache-first Kanban remount must receive the committed card title",
    );
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
    clearKanbanBoardContentsCache(apiBase, companyID, boardID);
    resetCommittedEntityTitleRegistryForTests();
  }
});

test("Logic Gate publication patches Kanban contents and fences an older board-list response", async () => {
  const apiBase = "https://title-cache-kanban.example.test";
  const companyID = "title-cache-kanban-company";
  const logicGateID = "gate-1";
  const boardID = logicGateKanbanBoardID(logicGateID);
  invalidateKanbanBoardListCache(apiBase, companyID);
  clearKanbanBoardContentsCache(apiBase, companyID, boardID);
  resetCommittedEntityTitleRegistryForTests();
  let boardFetches = 0;
  let releaseFirstFetch!: () => void;
  let markFirstFetchStarted!: () => void;
  const firstFetchGate = new Promise<void>((resolve) => { releaseFirstFetch = resolve; });
  const firstFetchStarted = new Promise<void>((resolve) => { markFirstFetchStarted = resolve; });
  const originalFetch = globalThis.fetch;
  const target = new EventTarget();
  const unsubscribe = subscribeCommittedEntityTitleUpdates(
    (update) => reconcileCachesForCommittedEntityTitle(apiBase, update),
    target,
  );
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = input.toString();
    if (!path.startsWith(`${apiBase}/v1/kanban/boards?`)) throw new Error(`unexpected request: ${path}`);
    boardFetches += 1;
    if (boardFetches === 1) {
      markFirstFetchStarted();
      await firstFetchGate;
    }
    return jsonResponse({
      boards: [{
        company_id: companyID,
        board_id: boardID,
        logic_gate_id: logicGateID,
        title: boardFetches === 1 ? "Old gate" : "Canonical new gate",
        position: 0,
        created_timestamp: "2026-07-13T00:00:00Z",
        updated_timestamp: "2026-07-13T00:00:00Z",
      }],
    });
  };
  primeKanbanBoardContentsCache(apiBase, companyID, boardID, boardContents(companyID, logicGateID));

  try {
    const oldRequest = listKanbanBoards(apiBase, companyID);
    await firstFetchStarted;
    publishCommittedEntityTitleUpdate({
      companyID,
      entityType: "logic_gate",
      resourceID: logicGateID,
      title: "Committed gate",
    }, target);

    const patched = peekKanbanBoardContentsCache(apiBase, companyID, boardID);
    assert.equal(patched?.contents.logicGate?.header, "Committed gate");
    assert.equal(patched?.contents.board?.title, "Committed gate");
    assert.equal(
      (await getKanbanBoardContentsSingleFlight(apiBase, companyID, boardID)).logicGate?.header,
      "Committed gate",
      "cache-first rendering must not expose the pre-publication header",
    );

    releaseFirstFetch();
    assert.equal((await oldRequest)[0]?.title, "Old gate", "the original pre-publication caller may finish");
    assert.equal((await listKanbanBoards(apiBase, companyID))[0]?.title, "Canonical new gate");
    assert.equal((await listKanbanBoards(apiBase, companyID))[0]?.title, "Canonical new gate");
    assert.equal(boardFetches, 2, "the old response must not repopulate the board-list cache");
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
    invalidateKanbanBoardListCache(apiBase, companyID);
    clearKanbanBoardContentsCache(apiBase, companyID, boardID);
    resetCommittedEntityTitleRegistryForTests();
  }
});

test("Node graph cache is patched synchronously and an older snapshot cannot overwrite it", async () => {
  const apiBase = "https://title-cache-graph.example.test";
  const companyID = "title-cache-graph-company";
  const nodeID = "node-graph";
  resetCommittedEntityTitleRegistryForTests();
  let snapshotFetches = 0;
  let releaseStaleFetch!: () => void;
  let markStaleFetchStarted!: () => void;
  const staleFetchGate = new Promise<void>((resolve) => { releaseStaleFetch = resolve; });
  const staleFetchStarted = new Promise<void>((resolve) => { markStaleFetchStarted = resolve; });
  const originalFetch = globalThis.fetch;
  const target = new EventTarget();
  const unsubscribe = subscribeCommittedEntityTitleUpdates(
    (update) => reconcileCachesForCommittedEntityTitle(apiBase, update),
    target,
  );
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = input.toString();
    if (path.startsWith(`${apiBase}/v1/node-relationships?`)) return jsonResponse({ relationships: [] });
    if (!path.startsWith(`${apiBase}/v1/nodes?`)) throw new Error(`unexpected request: ${path}`);
    snapshotFetches += 1;
    if (snapshotFetches === 2) {
      markStaleFetchStarted();
      await staleFetchGate;
    }
    return jsonResponse({
      nodes: [{
        company_id: companyID,
        node_id: nodeID,
        name: "Old graph node",
        created_timestamp: "2026-07-13T00:00:00Z",
      }],
    });
  };

  try {
    await refreshNodeRelationshipGraphSnapshot(apiBase, companyID);
    assert.equal(getNodeRelationshipGraphSnapshot(apiBase, companyID).nodes[0]?.name, "Old graph node");
    assert.equal(hasNodeRelationshipGraphSnapshot(apiBase, companyID), true);

    const staleRefresh = refreshNodeRelationshipGraphSnapshot(apiBase, companyID);
    await staleFetchStarted;
    publishCommittedEntityTitleUpdate({
      companyID,
      entityType: "node",
      resourceID: nodeID,
      title: "Committed graph node",
    }, target);
    assert.equal(
      getNodeRelationshipGraphSnapshot(apiBase, companyID).nodes[0]?.name,
      "Committed graph node",
      "a remount during the older request must read the committed cached title",
    );

    releaseStaleFetch();
    await staleRefresh;
    assert.equal(getNodeRelationshipGraphSnapshot(apiBase, companyID).nodes[0]?.name, "Committed graph node");
    assert.equal(snapshotFetches, 2, "the stale in-flight node response must be folded without a retry request");
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
    resetCommittedEntityTitleRegistryForTests();
  }
});

function boardContents(
  companyID: string,
  logicGateID: string,
  card?: { nodeID: string; nodeTitle: string },
): KanbanBoardContents {
  const boardID = logicGateKanbanBoardID(logicGateID);
  return {
    logicGate: { logic_gate_id: logicGateID, header: "Old gate", default_access: "edit" },
    permissions: { can_edit: true },
    board: {
      company_id: companyID,
      board_id: boardID,
      logic_gate_id: logicGateID,
      title: "Old gate",
      position: 0,
      created_timestamp: "2026-07-13T00:00:00Z",
      updated_timestamp: "2026-07-13T00:00:00Z",
    },
    columns: [],
    cards: card ? [{
      company_id: companyID,
      board_id: boardID,
      card_id: "card-1",
      column_id: "column-1",
      node_id: card.nodeID,
      logic_gate_id: logicGateID,
      node_title: card.nodeTitle,
      description_snapshot: "",
      position: 0,
      created_timestamp: "2026-07-13T00:00:00Z",
      updated_timestamp: "2026-07-13T00:00:00Z",
    }] : [],
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
