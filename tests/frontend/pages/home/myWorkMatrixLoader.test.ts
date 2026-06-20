import assert from "node:assert/strict";
import test from "node:test";

import {
  myWorkMatrixCacheKey,
  myWorkProjectionDeltaAffectsTargetUsers,
  uniqueMyWorkTargetUserIDs,
} from "../../../../frontend/src/pages/home/myWorkMatrixLoader.js";

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

test("My Work projection deltas only affect matching target users", () => {
  assert.equal(myWorkProjectionDeltaAffectsTargetUsers({
    scope: "gvic_matrix:user:user-1",
    projection: "gvic_matrix",
    projection_scope: "user:user-1",
    affected_scopes: ["my_work:user:user-1"],
    deltas: [],
  }, ["user-1", "user-2"]), true);

  assert.equal(myWorkProjectionDeltaAffectsTargetUsers({
    scope: "gvic_matrix:user:user-3",
    projection: "gvic_matrix",
    projection_scope: "user:user-3",
    affected_scopes: ["my_work:user:user-3"],
    deltas: [],
  }, ["user-1", "user-2"]), false);

  assert.equal(myWorkProjectionDeltaAffectsTargetUsers({
    scope: "gvic_matrix:user:user-4",
    projection: "gvic_matrix",
    projection_scope: "user:user-4",
    affected_scopes: [],
    deltas: [{ operation: "upsert", row: { user_id: "user-2" } }],
  }, ["user-1", "user-2"]), true);

  assert.equal(myWorkProjectionDeltaAffectsTargetUsers({
    scope: "kanban:board-1",
    projection: "kanban_board",
    projection_scope: "board:board-1",
    affected_scopes: [],
    deltas: [{ operation: "upsert", row: { user_id: "user-1" } }],
  }, ["user-1"]), false);
});
