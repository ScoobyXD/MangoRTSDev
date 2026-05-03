import test from "node:test";
import assert from "node:assert/strict";
import { EDITOR_TAB_ITEMS, getEditorDocumentIsolationState } from "../../../../frontend/src/modules/editor/editorTabs.js";

test("editor exposes the document, outline style, metadata, and history tabs", () => {
  assert.deepEqual(EDITOR_TAB_ITEMS.map((tab) => tab.id), ["editor", "outline-styles", "metadata", "history"]);
});

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

  assert.deepEqual(getEditorDocumentIsolationState("outline-styles"), isolatedState);
  assert.deepEqual(getEditorDocumentIsolationState("metadata"), isolatedState);
  assert.deepEqual(getEditorDocumentIsolationState("history"), isolatedState);
});
