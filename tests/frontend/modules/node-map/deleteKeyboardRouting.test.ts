import test from "node:test";
import assert from "node:assert/strict";

type DeleteRoutingInput = {
  canvasActive: boolean;
  hasSelection: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
};

const shouldHandleDelete = (input: DeleteRoutingInput) => {
  if (!input.hasSelection) return false;
  if (!input.target || input.canvasActive) return true;
  const tag = input.target.tagName ?? "";
  if (tag === "INPUT" || tag === "TEXTAREA" || input.target.isContentEditable) return false;
  return true;
};

test("handles delete when canvas is active even if contentEditable has focus", () => {
  assert.equal(shouldHandleDelete({
    canvasActive: true,
    hasSelection: true,
    target: { isContentEditable: true },
  }), true);
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
