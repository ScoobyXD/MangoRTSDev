import test from "node:test";
import assert from "node:assert/strict";
import { shouldIgnoreCanvasKeydownTarget } from "../../../../frontend/src/modules/node-map/shared.js";

test("returns true for contentEditable targets", () => {
  assert.equal(shouldIgnoreCanvasKeydownTarget({ isContentEditable: true }), true);
});

test("returns true for targets nested inside editable selectors", () => {
  assert.equal(
    shouldIgnoreCanvasKeydownTarget({
      isContentEditable: false,
      closest: (selector: string) => (selector.includes("textarea") ? { isContentEditable: false } : null),
    }),
    true,
  );
});

test("returns true for textarea editor targets so Tab and Enter stay native to the document", () => {
  assert.equal(
    shouldIgnoreCanvasKeydownTarget({
      isContentEditable: false,
      closest: (selector: string) => (selector.includes("textarea") ? { isContentEditable: false } : null),
    }),
    true,
  );
});

test("returns true for copyable image targets", () => {
  assert.equal(
    shouldIgnoreCanvasKeydownTarget({
      isContentEditable: false,
      closest: (selector: string) => (selector.includes("data-mango-copyable-image") ? { isContentEditable: false } : null),
    }),
    true,
  );
});

test("returns false for non-editable canvas targets", () => {
  assert.equal(
    shouldIgnoreCanvasKeydownTarget({
      isContentEditable: false,
      closest: () => null,
    }),
    false,
  );
});
