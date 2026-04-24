// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { resolveNodeMapDeleteIntent } from "./keyboardDeletion.js";

test("returns none for non-delete keys", () => {
  const intent = resolveNodeMapDeleteIntent({
    key: "a",
    selectedRelationshipIDs: new Set(["r1"]),
    selectedNodeIDs: new Set(["n1"]),
    selectedNodeID: "n1",
  });
  assert.deepEqual(intent, { type: "none" });
});

test("prioritizes relationship deletion over node deletion", () => {
  const intent = resolveNodeMapDeleteIntent({
    key: "Delete",
    selectedRelationshipIDs: new Set(["r1", "r2"]),
    selectedNodeIDs: new Set(["n1"]),
    selectedNodeID: "n1",
  });
  assert.deepEqual(intent, { type: "relationships", ids: ["r1", "r2"] });
});

test("falls back to selected node IDs when no relationships are selected", () => {
  const intent = resolveNodeMapDeleteIntent({
    key: "Backspace",
    selectedRelationshipIDs: new Set(),
    selectedNodeIDs: new Set(["n1", "n2"]),
    selectedNodeID: "n1",
  });
  assert.deepEqual(intent, { type: "nodes", ids: ["n1", "n2"] });
});

test("uses primary selected node when set is empty", () => {
  const intent = resolveNodeMapDeleteIntent({
    key: "Delete",
    selectedRelationshipIDs: new Set(),
    selectedNodeIDs: new Set(),
    selectedNodeID: "n1",
  });
  assert.deepEqual(intent, { type: "nodes", ids: ["n1"] });
});
