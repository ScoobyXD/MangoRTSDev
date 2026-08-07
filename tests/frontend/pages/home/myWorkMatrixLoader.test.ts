import assert from "node:assert/strict";
import test from "node:test";

import {
  loadMyWorkMatrixCacheEntry,
  markMyWorkMatrixCachesStaleForTargetUsers,
  myWorkMatrixCacheKey,
  patchMyWorkMatrixCells,
  patchMyWorkMatrixCellsForCommittedTitle,
  patchMyWorkMatrixCachesForCommittedTitle,
  readMyWorkMatrixCache,
  resetMyWorkMatrixLoaderForTests,
  uniqueMyWorkTargetUserIDs,
} from "../../../../frontend/src/pages/home/myWorkMatrixLoader.js";
import {
  publishCommittedEntityTitleUpdate,
  readCommittedEntityTitleVersion,
  resetCommittedEntityTitleRegistryForTests,
} from "../../../../frontend/src/modules/realtime/committedEntityTitleUpdates.js";
function myWorkProjectionRow(userID: string, gvicAssignment: string, priority: number) {
  const nodeID = `${userID}:node-1`;
  return {
    company_id: "company-cache-test",
    projection_row_id: `my_work_node_leaf:company-cache-test:${userID}:${gvicAssignment}:${priority}:node:${nodeID}:project:none:logic_gate:none`,
    user_id: userID,
    node_name: "Node",
    gvic_assignment: gvicAssignment,
    priority,
    node_id: nodeID,
    created_timestamp: "2026-01-01T00:00:00Z",
    updated_timestamp: "2026-01-01T00:00:00Z",
  };
}

test("My Work matrix cache keys keep selected scope and target users distinct", () => {
  const meKey = myWorkMatrixCacheKey({
    companyID: " company-1 ",
    selectedScope: { level: "me", subject_type: "user", subject_id: "user-1" },
    targetUserIDs: ["user-1"],
  });
  const teamKey = myWorkMatrixCacheKey({
    companyID: "company-1",
    selectedScope: { level: "team", subject_type: "group", subject_id: "group-1" },
    targetUserIDs: ["user-1", "user-2"],
  });
  const allKey = myWorkMatrixCacheKey({
    companyID: "company-1",
    selectedScope: { level: "all", subject_type: "company", subject_id: "company" },
    targetUserIDs: ["user-1", "user-2"],
  });

  assert.notEqual(meKey, teamKey);
  assert.notEqual(teamKey, allKey);
  assert.equal(meKey.includes("my_work:company-1:me:user:user-1:targets:user-1"), true);
  assert.equal(teamKey.includes("targets:user-1,user-2"), true);
});

test("My Work target user IDs are cleaned and deduped", () => {
  assert.deepEqual(uniqueMyWorkTargetUserIDs([" user-1 ", "", "user-2", "user-1"]), ["user-1", "user-2"]);
});

test("My Work matrix cache dedupes in-flight loads", async () => {
  const cacheKey = "test:my-work:dedupe";
  let calls = 0;
  const first = loadMyWorkMatrixCacheEntry({
    cacheKey,
    companyID: "company-cache-test",
    targetUserIDs: ["user-1"],
    fetchMatrix: async (targetUserID) => {
      calls += 1;
      return {
        company_id: "company-cache-test",
        user_id: targetUserID,
        rows: [myWorkProjectionRow(targetUserID, "responsible", 1)],
      };
    },
  });
  const second = loadMyWorkMatrixCacheEntry({
    cacheKey,
    companyID: "company-cache-test",
    targetUserIDs: ["user-1"],
    fetchMatrix: async () => {
      throw new Error("deduped_request_should_not_run");
    },
  });

  assert.equal(first, second);
  const result = await first;
  assert.equal(calls, 1);
  assert.equal(result.cells.length, 1);
  assert.equal(readMyWorkMatrixCache(cacheKey)?.hasValue, true);
});

test("My Work matrix cache reuses fresh values until marked stale", async () => {
  const cacheKey = "test:my-work:stale";
  let calls = 0;
  const fetchMatrix = async (targetUserID: string) => {
    calls += 1;
    return {
      company_id: "company-cache-test",
      user_id: targetUserID,
      rows: [myWorkProjectionRow(targetUserID, "accountable", calls)],
    };
  };

  const first = await loadMyWorkMatrixCacheEntry({
    cacheKey,
    companyID: "company-cache-test",
    targetUserIDs: ["user-2"],
    fetchMatrix,
    now: 100,
  });
  const second = await loadMyWorkMatrixCacheEntry({
    cacheKey,
    companyID: "company-cache-test",
    targetUserIDs: ["user-2"],
    fetchMatrix,
    now: 101,
  });
  markMyWorkMatrixCachesStaleForTargetUsers(["user-2"]);
  const third = await loadMyWorkMatrixCacheEntry({
    cacheKey,
    companyID: "company-cache-test",
    targetUserIDs: ["user-2"],
    fetchMatrix,
    now: 102,
  });

  assert.equal(calls, 2);
  assert.equal(first.cells[0]?.priority, 1);
  assert.equal(second.cells[0]?.priority, 1);
  assert.equal(third.cells[0]?.priority, 2);
});

test("My Work matrix cache can invalidate an empty target-user result", async () => {
  const cacheKey = "test:my-work:empty-target";
  let calls = 0;
  const fetchMatrix = async (targetUserID: string) => {
    calls += 1;
    return {
      company_id: "company-cache-test",
      user_id: targetUserID,
      rows: [],
    };
  };

  await loadMyWorkMatrixCacheEntry({
    cacheKey,
    companyID: "company-cache-test",
    targetUserIDs: ["user-empty"],
    fetchMatrix,
    now: 100,
  });
  await loadMyWorkMatrixCacheEntry({
    cacheKey,
    companyID: "company-cache-test",
    targetUserIDs: ["user-empty"],
    fetchMatrix,
    now: 101,
  });
  markMyWorkMatrixCachesStaleForTargetUsers(["user-empty"]);
  await loadMyWorkMatrixCacheEntry({
    cacheKey,
    companyID: "company-cache-test",
    targetUserIDs: ["user-empty"],
    fetchMatrix,
    now: 102,
  });

  assert.equal(calls, 2);
});

test("My Work committed titles patch only matching company and entity labels", () => {
  const cell = {
    ...myWorkProjectionRow("user-title", "responsible", 1),
    companyID: "company-cache-test",
    userID: "user-title",
    node_name: "Old node",
    logic_gate_id: "gate-title",
    logic_gate_name: "Old gate",
  };
  const nodePatched = patchMyWorkMatrixCellsForCommittedTitle([cell], {
    companyID: "company-cache-test",
    entityType: "node",
    resourceID: "user-title:node-1",
    title: "Current node",
  });
  assert.equal(nodePatched[0]?.node_name, "Current node");
  assert.equal(nodePatched[0]?.logic_gate_name, "Old gate");

  const gatePatched = patchMyWorkMatrixCellsForCommittedTitle(nodePatched, {
    companyID: "company-cache-test",
    entityType: "logic_gate",
    resourceID: "gate-title",
    title: "Current gate",
  });
  assert.equal(gatePatched[0]?.node_name, "Current node");
  assert.equal(gatePatched[0]?.logic_gate_name, "Current gate");
  assert.equal(patchMyWorkMatrixCellsForCommittedTitle(gatePatched, {
    companyID: "other-company",
    entityType: "node",
    resourceID: "user-title:node-1",
    title: "Wrong company",
  }), gatePatched);
});

test("My Work title versions patch cached and pre-commit loads but leave later canonical loads authoritative", async () => {
  resetMyWorkMatrixLoaderForTests();
  resetCommittedEntityTitleRegistryForTests();
  const companyID = "company-cache-test";
  const targetUserID = "user-version";
  const nodeID = `${targetUserID}:node-1`;
  const cachedKey = "test:my-work:title-existing-cache";
  const oldPayload = (title: string) => ({
    company_id: companyID,
    user_id: targetUserID,
    rows: [{ ...myWorkProjectionRow(targetUserID, "responsible", 1), node_name: title }],
  });
  const commitTitle = (title: string) => {
    const update = { companyID, entityType: "node" as const, resourceID: nodeID, title };
    publishCommittedEntityTitleUpdate(update, new EventTarget());
    patchMyWorkMatrixCachesForCommittedTitle(update);
  };

  await loadMyWorkMatrixCacheEntry({
    cacheKey: cachedKey,
    companyID,
    targetUserIDs: [targetUserID],
    fetchMatrix: async () => oldPayload("Cached old title"),
  });
  commitTitle("Local committed title");
  assert.equal(readMyWorkMatrixCache(cachedKey)?.cells[0]?.node_name, "Local committed title", "an unmounted fresh cache is patched immediately");

  const inFlightKey = "test:my-work:title-pre-commit-in-flight";
  let resolveInFlight: ((payload: ReturnType<typeof oldPayload>) => void) | undefined;
  const inFlight = loadMyWorkMatrixCacheEntry({
    cacheKey: inFlightKey,
    companyID,
    targetUserIDs: [targetUserID],
    fetchMatrix: () => new Promise((resolve) => { resolveInFlight = resolve; }),
  });
  await Promise.resolve();
  commitTitle("Newer local title");
  resolveInFlight?.(oldPayload("Late stale title"));
  const inFlightResult = await inFlight;
  assert.equal(inFlightResult.cells[0]?.node_name, "Newer local title", "a request begun before the commit merges the newer title");
  assert.equal(readMyWorkMatrixCache(inFlightKey)?.cells[0]?.node_name, "Newer local title", "the late result is stored with the newer title");

  const canonicalResult = await loadMyWorkMatrixCacheEntry({
    cacheKey: inFlightKey,
    companyID,
    targetUserIDs: [targetUserID],
    force: true,
    fetchMatrix: async () => oldPayload("Later canonical title"),
  });
  assert.equal(canonicalResult.cells[0]?.node_name, "Later canonical title", "a request begun after the local commit accepts canonical truth");
  assert.equal(readMyWorkMatrixCache(inFlightKey)?.cells[0]?.node_name, "Later canonical title");
  resetMyWorkMatrixLoaderForTests();
  resetCommittedEntityTitleRegistryForTests();
});

test("My Work projection results merge title commits newer than the drop request", () => {
  resetCommittedEntityTitleRegistryForTests();
  const companyID = "company-cache-test";
  const userID = "user-drop";
  const nodeID = `${userID}:node-1`;
  const logicGateID = "gate-drop";
  const titleVersionAtStart = readCommittedEntityTitleVersion();
  const target = new EventTarget();
  publishCommittedEntityTitleUpdate({
    companyID,
    entityType: "node",
    resourceID: nodeID,
    title: "Committed node title",
  }, target);
  publishCommittedEntityTitleUpdate({
    companyID,
    entityType: "logic_gate",
    resourceID: logicGateID,
    title: "Committed gate title",
  }, target);

  const patched = patchMyWorkMatrixCells([], {
    companyID,
    rows: [{
      ...myWorkProjectionRow(userID, "consulted", 3),
      node_name: "Late stale node",
      logic_gate_id: logicGateID,
      logic_gate_name: "Late stale gate",
    }],
    removedProjectionRowIDs: [],
    titleVersionAtStart,
  });
  assert.equal(patched[0]?.node_name, "Committed node title");
  assert.equal(patched[0]?.logic_gate_name, "Committed gate title");
  assert.equal(patched[0]?.gvic_assignment, "consulted");
  assert.equal(patched[0]?.priority, 3);

  const laterCanonical = patchMyWorkMatrixCells([], {
    companyID,
    rows: [{
      ...myWorkProjectionRow(userID, "accountable", 2),
      node_name: "Later canonical node",
      logic_gate_id: logicGateID,
      logic_gate_name: "Later canonical gate",
    }],
    removedProjectionRowIDs: [],
    titleVersionAtStart: readCommittedEntityTitleVersion(),
  });
  assert.equal(laterCanonical[0]?.node_name, "Later canonical node");
  assert.equal(laterCanonical[0]?.logic_gate_name, "Later canonical gate");
  resetCommittedEntityTitleRegistryForTests();
});
