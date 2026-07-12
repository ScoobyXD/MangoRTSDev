import test from "node:test";
import assert from "node:assert/strict";
import {
  projectionIDsForTextBlockDeletion,
  resolveAttachedEmailHostBlockID,
  shouldCreateInitialTextBlock,
} from "../../../../frontend/src/modules/editor/nodeTextBlockDeletion.js";

test("initial text-box creation does not replace a deleted last box after reload", () => {
  const base = {
    canEdit: true,
    projectionsLoaded: true,
    nodeID: "node-1",
    editorSequence: 0,
    loadedTextBlockCount: 0,
    renderedTextBlockCount: 0,
  };

  assert.equal(shouldCreateInitialTextBlock(base), true);
  assert.equal(shouldCreateInitialTextBlock({ ...base, editorSequence: 1 }), false);
  assert.equal(shouldCreateInitialTextBlock({ ...base, loadedTextBlockCount: 1 }), false);
});

test("text-box deletion targets only the block and its chat projections", () => {
  assert.deepEqual(projectionIDsForTextBlockDeletion("block-1", [
    { id: "chat-1", blockID: "block-1" },
    { id: "chat-2", blockID: "block-2" },
    { id: "attached-email-projection", blockID: "" },
    { id: "chat-1", blockID: "block-1" },
  ]), ["block-1", "chat-1"]);
});

test("attached-email host resolution never returns a stale focused block", () => {
  assert.equal(resolveAttachedEmailHostBlockID(["block-a", "block-b"], "block-b"), "block-b");
  assert.equal(resolveAttachedEmailHostBlockID(["block-a", "block-b"], "deleted-block"), "block-a");
  assert.equal(resolveAttachedEmailHostBlockID([], "deleted-block"), "");
});
