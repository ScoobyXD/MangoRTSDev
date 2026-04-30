import test from "node:test";
import assert from "node:assert/strict";
import { buildFrameDeleteConfirmationState } from "../../../frontend/src/app/frameLinking.js";

test("frame delete confirmation keeps explicit titles", () => {
  const result = buildFrameDeleteConfirmationState({ frameID: "frame-1", frameTitle: "Node Map" });
  assert.equal(result.frameID, "frame-1");
  assert.equal(result.frameTitle, "Node Map");
});

test("frame delete confirmation falls back for blank titles", () => {
  const result = buildFrameDeleteConfirmationState({ frameID: "frame-2", frameTitle: "   " });
  assert.equal(result.frameID, "frame-2");
  assert.equal(result.frameTitle, "Untitled frame");
});
