import test from "node:test";
import assert from "node:assert/strict";
import { buildLinkedNodePayload } from "../../../../frontend/src/modules/nodes/relationshipRules.js";

test("Node relationship creation preserves parent, peer, and child write semantics", () => {
  assert.deepEqual(buildLinkedNodePayload("parent"), { a_position: "Child", b_position: "Parent" });
  assert.deepEqual(buildLinkedNodePayload("peer"), { a_position: "Peer", b_position: "Peer" });
  assert.deepEqual(buildLinkedNodePayload("child"), { a_position: "Parent", b_position: "Child" });
});