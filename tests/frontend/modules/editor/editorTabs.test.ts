import test from "node:test";
import assert from "node:assert/strict";
import { EDITOR_TAB_ITEMS, getEditorDocumentIsolationState } from "../../../../frontend/src/modules/editor/editorTabs.js";

test("editor exposes the document, format, outline style, metadata, history, relationships, and permissions tabs", () => {
  assert.deepEqual(EDITOR_TAB_ITEMS.map((tab) => tab.id), ["editor", "format", "outline-styles", "metadata", "history", "relationships", "permissions"]);
});

test("editor document is visible and interactive on editing tabs", () => {
  assert.deepEqual(getEditorDocumentIsolationState("editor"), {
    ariaHidden: false,
    pointerEvents: "auto",
    tabIndex: 0,
    visibility: "visible",
  });
  assert.deepEqual(getEditorDocumentIsolationState("format"), {
    ariaHidden: false,
    pointerEvents: "auto",
    tabIndex: 0,
    visibility: "visible",
  });
  assert.deepEqual(getEditorDocumentIsolationState("outline-styles"), {
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
  assert.deepEqual(getEditorDocumentIsolationState("relationships"), isolatedState);
  assert.deepEqual(getEditorDocumentIsolationState("permissions"), isolatedState);
});
