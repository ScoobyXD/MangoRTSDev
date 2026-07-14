import test from "node:test";
import assert from "node:assert/strict";
import { EDITOR_OVERFLOW_HEADER_TAB_IDS, EDITOR_PRIMARY_HEADER_TAB_IDS, EDITOR_TAB_ITEMS, getEditorDocumentIsolationState } from "../../../../frontend/src/modules/editor/editorTabs.js";

test("editor exposes the document, permissions, relationships, format, outline style, metadata, history, and save settings tabs", () => {
  assert.deepEqual(EDITOR_TAB_ITEMS.map((tab) => tab.id), [
    "editor",
    "permissions",
    "relationships",
    "format",
    "outline-styles",
    "metadata",
    "history",
    "save-settings",
  ]);
});

test("editor header keeps primary editing controls ordered before secondary overflow actions", () => {
  assert.deepEqual(EDITOR_PRIMARY_HEADER_TAB_IDS, [
    "editor",
    "permissions",
    "format",
    "outline-styles",
  ]);
  assert.deepEqual(EDITOR_OVERFLOW_HEADER_TAB_IDS, [
    "relationships",
    "metadata",
    "history",
    "save-settings",
  ]);
  assert.deepEqual(new Set([...EDITOR_PRIMARY_HEADER_TAB_IDS, ...EDITOR_OVERFLOW_HEADER_TAB_IDS]), new Set(EDITOR_TAB_ITEMS.map((tab) => tab.id)));
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
  assert.deepEqual(getEditorDocumentIsolationState("save-settings"), isolatedState);
});
