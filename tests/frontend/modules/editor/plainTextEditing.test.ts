import test from "node:test";
import assert from "node:assert/strict";
import { EDITOR_TAB_TEXT, insertEditorTabText } from "../../../../frontend/src/modules/editor/plainTextEditing.js";

test("editor Tab inserts exactly seven plain spaces", () => {
  assert.equal(EDITOR_TAB_TEXT, "       ");
  assert.equal(EDITOR_TAB_TEXT.length, 7);
});

test("editor Tab replaces selected text with seven spaces and moves caret after them", () => {
  const edit = insertEditorTabText("alpha beta", 6, 10);

  assert.deepEqual(edit, {
    value: "alpha        ",
    selectionStart: 13,
    selectionEnd: 13,
  });
});
