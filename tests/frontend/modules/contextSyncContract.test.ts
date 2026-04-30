import test from "node:test";
import assert from "node:assert/strict";
import { hasSequenceGap, isNewerSequence, readIncomingSequence } from "../../../frontend/src/modules/contextSyncContract.js";

test("drops stale and duplicate sequences so projection state stays deterministic", () => {
  assert.equal(isNewerSequence(10, 9), false);
  assert.equal(isNewerSequence(10, 10), false);
  assert.equal(isNewerSequence(10, 11), true);
});

test("flags explicit sequence gaps for scoped reconciliation", () => {
  assert.equal(hasSequenceGap(10, 11), false);
  assert.equal(hasSequenceGap(10, 12), true);
  assert.equal(hasSequenceGap(10, 25), true);
});


test("prefers envelope sequence and keeps legacy revision fallback during migration", () => {
  assert.equal(readIncomingSequence({ revision: 7 }), 7);
  assert.equal(readIncomingSequence({ envelope: { context_id: "c", source_module_id: "m", sequence: 9, timestamp: "2026-04-29T00:00:00.000Z", user_action_type: "node_selection_changed" }, revision: 7 }), 9);
});
