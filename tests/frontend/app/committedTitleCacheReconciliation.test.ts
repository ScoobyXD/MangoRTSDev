import test from "node:test";
import assert from "node:assert/strict";
import { reconcileCachesForCommittedEntityTitle } from "../../../frontend/src/app/committedTitleCacheReconciliation.js";
import { publishCommittedEntityTitleUpdate, resetCommittedEntityTitleRegistryForTests, subscribeCommittedEntityTitleUpdates } from "../../../frontend/src/modules/realtime/committedEntityTitleUpdates.js";
import { clearProcessWorkCache, getCachedProcessWork, getProcessWorkSingleFlight, invalidateLogicGateArenaViewCache } from "../../../frontend/src/modules/kanban/ProcessWorkStore.js";
import { getNodeRelationshipGraphSnapshot, hasNodeRelationshipGraphSnapshot, refreshNodeRelationshipGraphSnapshot } from "../../../frontend/src/modules/nodes/nodeRelationshipGraph.js";

function jsonResponse(payload: unknown): Response { return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } }); }

test("committed Node and Process titles patch cache and survive an older response", async () => {
  const apiBase = "https://titles.test", companyID = "titles-company", processID = "process-a";
  const target = new EventTarget(); const originalFetch = globalThis.fetch; let reads = 0;
  let release!: () => void; const gate = new Promise<void>((done) => { release = done; });
  const unsubscribe = subscribeCommittedEntityTitleUpdates((update) => reconcileCachesForCommittedEntityTitle(apiBase, update), target);
  resetCommittedEntityTitleRegistryForTests();
  globalThis.fetch = async () => {
    reads++; if (reads === 2) await gate;
    return jsonResponse({ logic_gate: { logic_gate_id: processID, header: "Old Process" }, permissions: { can_edit: true, can_resolve_requests: true }, steps: [], relationships: [], nodes: [{ node_id: "node-a", node_title: "Old Node", status: "Review", process_step_id: null, position: 1000, is_issue: false, created_timestamp: "2026-09-03T00:00:00Z" }] });
  };
  try {
    await getProcessWorkSingleFlight(apiBase, companyID, processID);
    invalidateLogicGateArenaViewCache(apiBase, companyID, processID);
    const stale = getProcessWorkSingleFlight(apiBase, companyID, processID);
    publishCommittedEntityTitleUpdate({ companyID, entityType: "node", resourceID: "node-a", title: "New Node" }, target);
    publishCommittedEntityTitleUpdate({ companyID, entityType: "logic_gate", resourceID: processID, title: "New Process" }, target);
    assert.equal(getCachedProcessWork(apiBase, companyID, processID)?.contents.nodes[0].node_title, "New Node");
    assert.equal(getCachedProcessWork(apiBase, companyID, processID)?.contents.logic_gate.header, "New Process");
    release(); const result = await stale;
    assert.equal(result.nodes[0].node_title, "New Node"); assert.equal(result.logic_gate.header, "New Process");
    assert.equal(reads, 2);
  } finally { release(); unsubscribe(); globalThis.fetch = originalFetch; clearProcessWorkCache(apiBase, companyID, processID); resetCommittedEntityTitleRegistryForTests(); }
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
