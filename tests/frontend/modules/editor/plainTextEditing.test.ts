import test from "node:test";
import assert from "node:assert/strict";
import { EDITOR_TAB_TEXT, insertEditorTabText } from "../../../../frontend/src/modules/editor/plainTextEditing.js";

test("editor Tab inserts exactly five plain spaces", () => {
  assert.equal(EDITOR_TAB_TEXT, "     ");
  assert.equal(EDITOR_TAB_TEXT.length, 5);
});

test("editor Tab replaces selected text with five spaces and moves caret after them", () => {
  const edit = insertEditorTabText("alpha beta", 6, 10);

  assert.deepEqual(edit, {
    value: "alpha      ",
    selectionStart: 11,
    selectionEnd: 11,
  });
});
