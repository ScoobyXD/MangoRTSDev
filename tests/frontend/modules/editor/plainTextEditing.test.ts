import test from "node:test";
import assert from "node:assert/strict";
import { EDITOR_TAB_TEXT, insertEditorTabText, insertEditorTabTextIntoTextArea, type PlainTextAreaEditingTarget } from "../../../../frontend/src/modules/editor/plainTextEditing.js";

function createTextAreaTarget(value: string, selectionStart: number, selectionEnd: number): PlainTextAreaEditingTarget {
  const target: PlainTextAreaEditingTarget = {
    value,
    selectionStart,
    selectionEnd,
    setSelectionRange(nextStart, nextEnd) {
      target.selectionStart = nextStart;
      target.selectionEnd = nextEnd;
    },
    setRangeText(replacement, start, end, selectionMode) {
      target.value = `${target.value.slice(0, start)}${replacement}${target.value.slice(end)}`;
      const cursor = selectionMode === "start" ? start : start + replacement.length;
      target.setSelectionRange(cursor, cursor);
    },
  };
  return target;
}

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

test("editor Tab uses browser insertText when available so native undo can track it", () => {
  const target = createTextAreaTarget("alpha beta", 6, 10);
  let commandCallCount = 0;
  target.ownerDocument = {
    execCommand(commandId, showUI, value) {
      commandCallCount += 1;
      assert.equal(commandId, "insertText");
      assert.equal(showUI, false);
      assert.equal(value, EDITOR_TAB_TEXT);
      const edit = insertEditorTabText(target.value, target.selectionStart, target.selectionEnd);
      target.value = edit.value;
      target.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      return true;
    },
  };

  const edit = insertEditorTabTextIntoTextArea(target);

  assert.equal(commandCallCount, 1);
  assert.deepEqual(edit, {
    value: "alpha      ",
    selectionStart: 11,
    selectionEnd: 11,
  });
});

test("editor Tab falls back to deterministic range replacement without insertText", () => {
  const target = createTextAreaTarget("alpha beta", 5, 5);
  target.ownerDocument = {
    execCommand() {
      return false;
    },
  };

  const edit = insertEditorTabTextIntoTextArea(target);

  assert.deepEqual(edit, {
    value: "alpha      beta",
    selectionStart: 10,
    selectionEnd: 10,
  });
  assert.equal(target.value, edit.value);
});
