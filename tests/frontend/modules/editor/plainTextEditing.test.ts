import test from "node:test";
import assert from "node:assert/strict";
import { applyEditorInlineFormat, DEFAULT_EDITOR_OUTLINE_STYLE, deleteEditorBackspaceText, EDITOR_TAB_TEXT, getAutomaticOutlineContinuation, insertAutomaticOutlineFirstText, insertEditorEnterText, insertEditorTabText, isEditorOutlineStyleID, toggleAutomaticOutlineNumberingText } from "../../../../frontend/src/modules/editor/plainTextEditing.js";

test("editor Tab inserts exactly five plain spaces", () => {
  assert.equal(EDITOR_TAB_TEXT, "     ");
  assert.equal(EDITOR_TAB_TEXT.length, 5);
});

test("editor Tab preserves selected text and indents its line", () => {
  const edit = insertEditorTabText("alpha beta", 6, 10);

  assert.deepEqual(edit, {
    value: "     alpha beta",
    selectionStart: 11,
    selectionEnd: 15,
  });
});

test("editor Tab indents every selected line without selecting an untouched trailing line", () => {
  const value = "alpha\nbeta\ngamma";
  const edit = insertEditorTabText(value, 0, "alpha\nbeta\n".length);

  assert.deepEqual(edit, {
    value: `${EDITOR_TAB_TEXT}alpha\n${EDITOR_TAB_TEXT}beta\ngamma`,
    selectionStart: EDITOR_TAB_TEXT.length,
    selectionEnd: "     alpha\n     beta\n".length,
  });
});

test("editor Shift+Tab outdents every selected line while preserving its content", () => {
  const value = `${EDITOR_TAB_TEXT}alpha\n\tbeta\n  gamma`;
  const edit = insertEditorTabText(value, 0, value.length, "indent-guides", "outdent");

  assert.deepEqual(edit, {
    value: "alpha\nbeta\ngamma",
    selectionStart: 0,
    selectionEnd: "alpha\nbeta\ngamma".length,
  });
});

test("automatic numbering Tab updates every selected marker family and continues the new depth", () => {
  const value = "1. A\n2. B";
  const edit = insertEditorTabText(value, 0, value.length, "automatic-outline-numbering", "indent");
  const expectedValue = `${EDITOR_TAB_TEXT}a. A\n${EDITOR_TAB_TEXT}b. B`;

  assert.equal(edit.value, expectedValue);
  assert.equal(edit.selectionEnd, expectedValue.length);
  assert.equal(getAutomaticOutlineContinuation(edit.value, edit.selectionEnd), `\n${EDITOR_TAB_TEXT}c. `);

  const outdent = insertEditorTabText(expectedValue, 0, expectedValue.length, "automatic-outline-numbering", "outdent");
  assert.equal(outdent.value, value);
});

test("outline style ids stay explicit for UI and headless callers", () => {
  assert.equal(DEFAULT_EDITOR_OUTLINE_STYLE, "automatic-outline-numbering");
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

test("automatic outline numbering inserts a plain newline when continuation is disabled", () => {
  const edit = insertEditorEnterText("1. alpha", "1. alpha".length, "1. alpha".length, "automatic-outline-numbering", { continueAutomaticOutline: false });

  assert.deepEqual(edit, {
    value: "1. alpha\n",
    selectionStart: 9,
    selectionEnd: 9,
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

test("Shift+Tab keeps an empty indented line at its left edge after the final outdent", () => {
  const value = `alpha\n${EDITOR_TAB_TEXT}`;
  const edit = insertEditorTabText(value, value.length, value.length, "indent-guides", "outdent");

  assert.deepEqual(edit, {
    value: "alpha\n",
    selectionStart: "alpha\n".length,
    selectionEnd: "alpha\n".length,
  });

  assert.deepEqual(insertEditorTabText(edit.value, edit.selectionStart, edit.selectionEnd, "indent-guides", "outdent"), {
    value: "alpha\n",
    selectionStart: "alpha\n".length,
    selectionEnd: "alpha\n".length,
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

test("Backspace deletes repeated inserted tab-sized space runs one at a time", () => {
  const value = `alpha${EDITOR_TAB_TEXT.repeat(3)}`;
  const first = deleteEditorBackspaceText(value, value.length, value.length);
  assert.equal(first?.value, `alpha${EDITOR_TAB_TEXT.repeat(2)}`);

  const second = first && deleteEditorBackspaceText(first.value, first.selectionStart, first.selectionEnd);
  assert.equal(second?.value, `alpha${EDITOR_TAB_TEXT}`);

  const third = second && deleteEditorBackspaceText(second.value, second.selectionStart, second.selectionEnd);
  assert.equal(third?.value, "alpha");
});

test("Backspace leaves an empty tabbed line at its left edge", () => {
  const value = `alpha\n${EDITOR_TAB_TEXT}`;
  const edit = deleteEditorBackspaceText(value, value.length, value.length);

  assert.deepEqual(edit, {
    value: "alpha\n",
    selectionStart: "alpha\n".length,
    selectionEnd: "alpha\n".length,
  });
});

test("automatic outline continuation only looks at the new edit point", () => {
  assert.equal(getAutomaticOutlineContinuation("already typed\nplain line", "already typed\nplain line".length), null);
});

test("automatic outline parsing rejects marker families that do not belong at the current depth", () => {
  assert.equal(getAutomaticOutlineContinuation("Note. details", "Note. details".length), null);
  assert.equal(getAutomaticOutlineContinuation(`${EDITOR_TAB_TEXT}2. details`, `${EDITOR_TAB_TEXT}2. details`.length), null);
  assert.equal(getAutomaticOutlineContinuation(`${EDITOR_TAB_TEXT.repeat(2)}a. details`, `${EDITOR_TAB_TEXT.repeat(2)}a. details`.length), null);
});

test("typing after a deliberately exited automatic item stays plain", () => {
  const value = "1. alpha\n";
  assert.equal(insertAutomaticOutlineFirstText(value, value.length, value.length, "plain"), null);
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

test("automatic numbering Tab in ordinary text inserts at the caret", () => {
  const value = "plain block";
  const edit = insertEditorTabText(value, value.length, value.length, "automatic-outline-numbering", "indent");
  const expectedValue = `plain block${EDITOR_TAB_TEXT}`;

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

test("automatic numbering toggle starts a numbered item at the current line", () => {
  assert.deepEqual(toggleAutomaticOutlineNumberingText("", 0, 0), {
    value: "1. ",
    selectionStart: 3,
    selectionEnd: 3,
  });

  assert.deepEqual(toggleAutomaticOutlineNumberingText("First\nSecond", 12, 12), {
    value: "First\n1. Second",
    selectionStart: 15,
    selectionEnd: 15,
  });
});

test("automatic numbering toggle removes an existing numbered item marker", () => {
  assert.deepEqual(toggleAutomaticOutlineNumberingText("1. Alpha", 8, 8), {
    value: "Alpha",
    selectionStart: 5,
    selectionEnd: 5,
  });
});

test("automatic numbering toggle follows alphanumerical depth markers", () => {
  const value = `1. Parent\n${EDITOR_TAB_TEXT}Child`;

  assert.deepEqual(toggleAutomaticOutlineNumberingText(value, value.length, value.length), {
    value: `1. Parent\n${EDITOR_TAB_TEXT}a. Child`,
    selectionStart: value.length + 3,
    selectionEnd: value.length + 3,
  });
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

test("automatic numbering Shift+Tab removes a root marker instead of swallowing the command", () => {
  const value = "1. alpha";
  assert.deepEqual(insertEditorTabText(value, value.length, value.length, "automatic-outline-numbering", "outdent"), {
    value: "alpha",
    selectionStart: "alpha".length,
    selectionEnd: "alpha".length,
  });
});

test("Enter on an empty automatic item exits numbering", () => {
  const value = "1. alpha\n2. ";
  assert.deepEqual(insertEditorEnterText(value, value.length, value.length, "automatic-outline-numbering"), {
    value: "1. alpha\n",
    selectionStart: "1. alpha\n".length,
    selectionEnd: "1. alpha\n".length,
  });
});

test("Backspace removes an empty automatic marker atomically", () => {
  const value = "1. alpha\n2. ";
  assert.deepEqual(deleteEditorBackspaceText(value, value.length, value.length, "automatic-outline-numbering"), {
    value: "1. alpha\n",
    selectionStart: "1. alpha\n".length,
    selectionEnd: "1. alpha\n".length,
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
