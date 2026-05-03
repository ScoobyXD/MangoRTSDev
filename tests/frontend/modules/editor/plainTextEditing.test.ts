import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EDITOR_OUTLINE_STYLE, EDITOR_TAB_TEXT, getAutomaticOutlineContinuation, insertEditorEnterText, insertEditorTabText, isEditorOutlineStyleID } from "../../../../frontend/src/modules/editor/plainTextEditing.js";

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

test("outline style ids stay explicit for UI and headless callers", () => {
  assert.equal(DEFAULT_EDITOR_OUTLINE_STYLE, "indent-guides");
  assert.equal(isEditorOutlineStyleID("automatic-outline-numbering"), true);
  assert.equal(isEditorOutlineStyleID("indent-guides"), true);
  assert.equal(isEditorOutlineStyleID("rich-text"), false);
});

test("automatic outline numbering continues simple numbered lines on Enter", () => {
  const edit = insertEditorEnterText("1. alpha", "1. alpha".length, "1. alpha".length, "automatic-outline-numbering");

  assert.deepEqual(edit, {
    value: "1. alpha\n2. ",
    selectionStart: 12,
    selectionEnd: 12,
  });
});

test("automatic outline numbering continues multilevel lines without rewriting earlier text", () => {
  const value = "intro\n  1.2. beta";
  const edit = insertEditorEnterText(value, value.length, value.length, "automatic-outline-numbering");

  assert.deepEqual(edit, {
    value: "intro\n  1.2. beta\n  1.3. ",
    selectionStart: 25,
    selectionEnd: 25,
  });
});

test("indent guides mode leaves Enter as a plain newline", () => {
  const edit = insertEditorEnterText("1. alpha", "1. alpha".length, "1. alpha".length, "indent-guides");

  assert.deepEqual(edit, {
    value: "1. alpha\n",
    selectionStart: 9,
    selectionEnd: 9,
  });
});

test("automatic outline continuation only looks at the new edit point", () => {
  assert.equal(getAutomaticOutlineContinuation("already typed\nplain line", "already typed\nplain line".length), null);
});
