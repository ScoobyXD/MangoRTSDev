import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteNodeMapRelationshipsCommand,
  normalizeNodeMapRelationshipIDs,
  type NodeMapCommandRequest,
} from "../../../../frontend/src/modules/node-map/nodeMapCommands.js";

test("normalizeNodeMapRelationshipIDs trims, drops blanks, and dedupes", () => {
  assert.deepEqual(normalizeNodeMapRelationshipIDs([" rel-a ", "", "rel-a", "rel-b"]), ["rel-a", "rel-b"]);
});

test("deleteNodeMapRelationshipsCommand returns partial failure summary without browser UI", async () => {
  const calls: Array<{ path: string; method?: string }> = [];
  const requestJSON: NodeMapCommandRequest = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, method: init?.method });
    if (path.includes("rel-b")) throw new Error("relationship_not_found");
    return { status: "ok" } as T;
  };

  const result = await deleteNodeMapRelationshipsCommand({
    companyID: "company 1",
    relationshipIDs: ["rel-a", "rel-b", "rel-a"],
    requestJSON,
  });

  assert.deepEqual(result.requestedIDs, ["rel-a", "rel-b"]);
  assert.deepEqual(result.succeededIDs, ["rel-a"]);
  assert.deepEqual(result.failed, [{ relationshipID: "rel-b", reason: "relationship_not_found" }]);
  assert.deepEqual(calls, [
    { path: "/v1/node-relationships/rel-a?company_id=company%201", method: "DELETE" },
    { path: "/v1/node-relationships/rel-b?company_id=company%201", method: "DELETE" },
  ]);
});
