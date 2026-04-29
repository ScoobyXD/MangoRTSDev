// Relationship delete result summarization tests for partial-success/partial-failure handling.
// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { summarizeRelationshipDeleteResults } from "../../../../frontend/src/modules/node-map/relationshipDeleteSummary.js";

test("collects successful relationship IDs", () => {
  const summary = summarizeRelationshipDeleteResults(
    ["r1", "r2"],
    [
      { status: "fulfilled", value: { status: "deleted" } },
      { status: "fulfilled", value: { status: "deleted" } },
    ],
  );
  assert.deepEqual(summary, { succeededIDs: ["r1", "r2"], failed: [] });
});

test("collects failure reasons for rejected deletes", () => {
  const summary = summarizeRelationshipDeleteResults(
    ["r1", "r2"],
    [
      { status: "fulfilled", value: { status: "deleted" } },
      { status: "rejected", reason: new Error("relationship_not_found") },
    ],
  );
  assert.deepEqual(summary, {
    succeededIDs: ["r1"],
    failed: [{ relationshipID: "r2", reason: "relationship_not_found" }],
  });
});
