import test from "node:test";
import assert from "node:assert/strict";
import {
  createMapEntityBatchCommand,
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

test("createMapEntityBatchCommand posts one map entity batch request", async () => {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const requestJSON: NodeMapCommandRequest = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return { ok: true } as T;
  };

  const result = await createMapEntityBatchCommand<{ ok: boolean }>({
    companyID: "company-1",
    entityKind: "logic_gate",
    folderID: "folder-1",
    items: [{ client_id: "gate-a", title: "Gate A", x: 120, y: 240 }],
    relationships: [{ entity_id_a: "source", client_id_b: "gate-a", a_position: "Input", b_position: "Output" }],
    requestJSON,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{
    path: "/v1/map-entity-batches",
    method: "POST",
    body: {
      company_id: "company-1",
      entity_kind: "logic_gate",
      folder_id: "folder-1",
      items: [{ client_id: "gate-a", title: "Gate A", x: 120, y: 240 }],
      relationships: [{ entity_id_a: "source", client_id_b: "gate-a", a_position: "Input", b_position: "Output" }],
    },
  }]);
});
