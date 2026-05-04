import test from "node:test";
import assert from "node:assert/strict";
import { applyEditorInlineFormat, DEFAULT_EDITOR_OUTLINE_STYLE, deleteEditorBackspaceText, EDITOR_TAB_TEXT, getAutomaticOutlineContinuation, insertEditorEnterText, insertEditorTabText, isEditorOutlineStyleID } from "../../../../frontend/src/modules/editor/plainTextEditing.js";

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

test("indent guides mode continues the current indentation level on Enter", () => {
  const indentation = EDITOR_TAB_TEXT.repeat(3);
  const edit = insertEditorEnterText(`${indentation}deep`, `${indentation}deep`.length, `${indentation}deep`.length, "indent-guides");
  const expectedValue = `${indentation}deep\n${indentation}`;

  assert.deepEqual(edit, {
    value: expectedValue,
    selectionStart: expectedValue.length,
    selectionEnd: expectedValue.length,
  });
});

test("Shift+Tab removes one indent level in indent guides mode", () => {
  const value = `${EDITOR_TAB_TEXT.repeat(3)}deep`;
  const expectedValue = `${EDITOR_TAB_TEXT.repeat(2)}deep`;
  const edit = insertEditorTabText(value, value.length, value.length, "indent-guides", "outdent");

  assert.deepEqual(edit, {
    value: expectedValue,
    selectionStart: expectedValue.length,
    selectionEnd: expectedValue.length,
  });
});

test("Backspace deletes one inserted tab-sized space run", () => {
  const value = `alpha${EDITOR_TAB_TEXT}`;
  const edit = deleteEditorBackspaceText(value, value.length, value.length);

  assert.deepEqual(edit, {
    value: "alpha",
    selectionStart: "alpha".length,
    selectionEnd: "alpha".length,
  });
});

test("automatic outline continuation only looks at the new edit point", () => {
  assert.equal(getAutomaticOutlineContinuation("already typed\nplain line", "already typed\nplain line".length), null);
});

test("automatic numbering Tab changes a numeric item into an alphabetic child", () => {
  const value = "1. alpha\n2. ";
  const edit = insertEditorTabText(value, value.length, value.length, "automatic-outline-numbering", "indent");
  const expectedValue = `1. alpha\n${EDITOR_TAB_TEXT}a. `;

  assert.deepEqual(edit, {
    value: expectedValue,
    selectionStart: expectedValue.length,
    selectionEnd: expectedValue.length,
  });
});

test("automatic numbering continues alphabetic child items on Enter", () => {
  const value = `1. alpha\n${EDITOR_TAB_TEXT}a. `;
  const edit = insertEditorEnterText(value, value.length, value.length, "automatic-outline-numbering");
  const expectedValue = `1. alpha\n${EDITOR_TAB_TEXT}a. \n${EDITOR_TAB_TEXT}b. `;

  assert.deepEqual(edit, {
    value: expectedValue,
    selectionStart: expectedValue.length,
    selectionEnd: expectedValue.length,
  });
});

test("automatic numbering Tab cycles decimal, alphabetic, and roman marker styles by depth", () => {
  const value = "1. alpha\n2. ";
  const levelOne = insertEditorTabText(value, value.length, value.length, "automatic-outline-numbering", "indent");
  const levelTwo = insertEditorTabText(levelOne.value, levelOne.selectionStart, levelOne.selectionEnd, "automatic-outline-numbering", "indent");
  const levelThree = insertEditorTabText(levelTwo.value, levelTwo.selectionStart, levelTwo.selectionEnd, "automatic-outline-numbering", "indent");
  const levelFour = insertEditorTabText(levelThree.value, levelThree.selectionStart, levelThree.selectionEnd, "automatic-outline-numbering", "indent");

  assert.equal(levelOne.value, `1. alpha\n${EDITOR_TAB_TEXT}a. `);
  assert.equal(levelTwo.value, `1. alpha\n${EDITOR_TAB_TEXT.repeat(2)}i. `);
  assert.equal(levelThree.value, `1. alpha\n${EDITOR_TAB_TEXT.repeat(3)}1. `);
  assert.equal(levelFour.value, `1. alpha\n${EDITOR_TAB_TEXT.repeat(4)}a. `);
});

test("automatic numbering Shift+Tab returns an alphabetic child to the numeric parent flow", () => {
  const value = `1. alpha\n${EDITOR_TAB_TEXT}a. `;
  const edit = insertEditorTabText(value, value.length, value.length, "automatic-outline-numbering", "outdent");
  const expectedValue = "1. alpha\n2. ";

  assert.deepEqual(edit, {
    value: expectedValue,
    selectionStart: expectedValue.length,
    selectionEnd: expectedValue.length,
  });
});

test("inline format commands are deterministic text edits for UI and headless callers", () => {
  assert.deepEqual(applyEditorInlineFormat("alpha beta", 0, 5, "bold"), {
    value: "**alpha** beta",
    selectionStart: 9,
    selectionEnd: 9,
  });
  assert.deepEqual(applyEditorInlineFormat("alpha beta", 6, 10, "underline"), {
    value: "alpha <u>beta</u>",
    selectionStart: 17,
    selectionEnd: 17,
  });
  assert.deepEqual(applyEditorInlineFormat("alpha", 0, 5, "hyperlink", "https://example.test"), {
    value: "[alpha](https://example.test)",
    selectionStart: 29,
    selectionEnd: 29,
  });
});
