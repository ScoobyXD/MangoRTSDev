import test from "node:test";
import assert from "node:assert/strict";
import { shouldIgnoreMapDeleteKeyTarget } from "../../../../frontend/src/modules/node-map/NodeMapControls.js";

type DeleteRoutingInput = {
  canvasActive: boolean;
  hasSelection: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
};

const shouldHandleDelete = (input: DeleteRoutingInput) => {
  if (!input.hasSelection) return false;
  if (shouldIgnoreMapDeleteKeyTarget(input.target)) return false;
  return true;
};

test("ignores delete when inline title editing has focus even if canvas is active", () => {
  assert.equal(shouldHandleDelete({
    canvasActive: true,
    hasSelection: true,
    target: { isContentEditable: true },
  }), false);
});

test("ignores delete for editable target when canvas is not active", () => {
  assert.equal(shouldHandleDelete({
    canvasActive: false,
    hasSelection: true,
    target: { tagName: "TEXTAREA", isContentEditable: false },
  }), false);
});

test("ignores delete when nothing is selected", () => {
  assert.equal(shouldHandleDelete({
    canvasActive: true,
    hasSelection: false,
    target: null,
  }), false);
});
