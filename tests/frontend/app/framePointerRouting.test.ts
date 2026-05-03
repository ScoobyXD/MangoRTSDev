import test from "node:test";
import assert from "node:assert/strict";
import { FRAME_INTERACTIVE_SELECTOR, isFrameInteractiveTarget } from "../../../frontend/src/app/framePointerRouting.js";

test("frame pointer routing ignores controls marked as frame-interactive", () => {
  const target = {
    closest: (selector: string) => selector === FRAME_INTERACTIVE_SELECTOR ? { dataset: { frameInteractive: "true" } } : null,
  };

  assert.equal(isFrameInteractiveTarget(target), true);
});

test("frame pointer routing still allows ordinary frame targets", () => {
  const target = {
    closest: () => null,
  };

  assert.equal(isFrameInteractiveTarget(target), false);
});
