import test from "node:test";
import assert from "node:assert/strict";
import { nextLocalContextSequence } from "../../../frontend/src/modules/contextSyncContract.js";

test("keeps local context sequences monotonic across remount-style resets", () => {
  const contextID = "explorer-selection:test-remount";
  assert.equal(nextLocalContextSequence(contextID, 1000), 1000);
  assert.equal(nextLocalContextSequence(contextID, 900), 1001);
  assert.equal(nextLocalContextSequence(contextID, 1500), 1500);
});