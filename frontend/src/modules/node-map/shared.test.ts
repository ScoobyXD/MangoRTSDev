import test from "node:test";
import assert from "node:assert/strict";
import { getNodeTitleFromRecord } from "./shared.js";

test("getNodeTitleFromRecord returns header when present", () => {
  assert.equal(
    getNodeTitleFromRecord({
      header: "Launch Plan",
      node_id: "node-1",
    }),
    "Launch Plan",
  );
});

test("getNodeTitleFromRecord trims header whitespace", () => {
  assert.equal(
    getNodeTitleFromRecord({
      header: "  Core Initiative  ",
      node_id: "node-2",
    }),
    "Core Initiative",
  );
});

test("getNodeTitleFromRecord falls back to node identifier when header is empty", () => {
  assert.equal(
    getNodeTitleFromRecord({
      header: "   ",
      node_id: "node-3",
    }),
    "node-3",
  );
});
