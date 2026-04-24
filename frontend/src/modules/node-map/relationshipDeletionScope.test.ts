// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { resolveRelationshipDeletionScope } from "./relationshipDeletionScope.js";

const relationship = (overrides = {}) => ({
  company_id: "company-a",
  node_relationship_id: "rel-1",
  node_id_a: "node-a",
  node_id_b: "node-b",
  a_position: "Peer",
  b_position: "Peer",
  created_timestamp: new Date().toISOString(),
  ...overrides,
});

test("returns invalid_selection for empty relationship id input", () => {
  const result = resolveRelationshipDeletionScope({ relationshipIDs: ["", "  "], relationships: [], activeCompanyID: "company-a" });
  assert.deepEqual(result, { type: "invalid_selection" });
});

test("returns company_scope_mismatch when selected relationship company differs from active company", () => {
  const result = resolveRelationshipDeletionScope({
    relationshipIDs: ["rel-2"],
    relationships: [relationship({ node_relationship_id: "rel-2", company_id: "company-b" })],
    activeCompanyID: "company-a",
  });
  assert.deepEqual(result, { type: "company_scope_mismatch" });
});

test("returns ok for valid scoped relationship ids", () => {
  const result = resolveRelationshipDeletionScope({
    relationshipIDs: ["rel-1", "rel-1", " rel-2 "],
    relationships: [relationship({ node_relationship_id: "rel-1" }), relationship({ node_relationship_id: "rel-2" })],
    activeCompanyID: "company-a",
  });
  assert.deepEqual(result, { type: "ok", ids: ["rel-1", "rel-2"], companyID: "company-a" });
});
