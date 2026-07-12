import assert from "node:assert/strict";
import test from "node:test";

import {
  loadMyWorkMatrixCacheEntry,
  markMyWorkMatrixCachesStaleForTargetUsers,
  myWorkMatrixCacheKey,
  readMyWorkMatrixCache,
  uniqueMyWorkTargetUserIDs,
} from "../../../../frontend/src/pages/home/myWorkMatrixLoader.js";
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
        rows: [myWorkProjectionRow(targetUserID, "generated", 1)],
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
      rows: [myWorkProjectionRow(targetUserID, "verified", calls)],
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
