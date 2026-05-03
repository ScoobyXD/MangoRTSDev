import test from "node:test";
import assert from "node:assert/strict";
import { getEditorDocumentIsolationState } from "../../../../frontend/src/modules/editor/editorTabs.js";

test("editor document is visible and interactive only on the Editor tab", () => {
  assert.deepEqual(getEditorDocumentIsolationState("editor"), {
    ariaHidden: false,
    pointerEvents: "auto",
    tabIndex: 0,
    visibility: "visible",
  });
});

test("metadata and history tabs wall off the editor document surface", () => {
  const isolatedState = {
    ariaHidden: true,
    pointerEvents: "none",
    tabIndex: -1,
    visibility: "hidden",
  };

  assert.deepEqual(getEditorDocumentIsolationState("metadata"), isolatedState);
  assert.deepEqual(getEditorDocumentIsolationState("history"), isolatedState);
});
