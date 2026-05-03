import test from "node:test";
import assert from "node:assert/strict";
import { hasExplicitExplorerSelectionContext, hasPendingContextStorageUpdate, hasSequenceGap, isNewerSequence, nextLocalContextSequence, readIncomingSequence } from "../../../frontend/src/modules/contextSyncContract.js";

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

test("keeps local context sequences monotonic across remount-style resets", () => {
  const contextID = "active_node_selection:test-map-remount";
  assert.equal(nextLocalContextSequence(contextID, 1000), 1000);
  assert.equal(nextLocalContextSequence(contextID, 900), 1001);
  assert.equal(nextLocalContextSequence(contextID, 1500), 1500);
});

test("recognizes explicit empty explorer context as a map clear command", () => {
  assert.equal(hasExplicitExplorerSelectionContext({ sourceExplorerID: "explorer-1" }), true);
  assert.equal(hasExplicitExplorerSelectionContext({ selectedTreeID: "folder-root" }), true);
  assert.equal(hasExplicitExplorerSelectionContext({}), false);
});

test("detects pending explorer context before emitting cached map selection", () => {
  assert.equal(hasPendingContextStorageUpdate(JSON.stringify({ ts: 25 }), 10), true);
  assert.equal(hasPendingContextStorageUpdate(JSON.stringify({ ts: 10 }), 10), false);
  assert.equal(hasPendingContextStorageUpdate("not-json", 10), false);
});
