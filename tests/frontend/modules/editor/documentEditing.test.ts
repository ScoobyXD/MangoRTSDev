import test from "node:test";
import assert from "node:assert/strict";
import { applyDocumentTextareaKey, orderedMarkerForLevel } from "../../../../frontend/src/modules/editor/documentEditing.js";

test("space turns a leading 1 into an ordered list marker", () => {
  const edit = applyDocumentTextareaKey({
    value: "1",
    selectionStart: 1,
    selectionEnd: 1,
    key: " ",
  });

  assert.deepEqual(edit, { value: "1. ", selectionStart: 3, selectionEnd: 3 });
});

test("enter continues ordered lists without changing existing text", () => {
  const value = "1. Alpha";
  const edit = applyDocumentTextareaKey({
    value,
    selectionStart: value.length,
    selectionEnd: value.length,
    key: "Enter",
  });

  assert.deepEqual(edit, { value: "1. Alpha\n2. ", selectionStart: 12, selectionEnd: 12 });
});

test("enter on an empty list marker exits the list", () => {
  const value = "\tA. ";
  const edit = applyDocumentTextareaKey({
    value,
    selectionStart: value.length,
    selectionEnd: value.length,
    key: "Enter",
  });

  assert.deepEqual(edit, { value: "\t", selectionStart: 1, selectionEnd: 1 });
});

test("tab indents list lines into outline markers", () => {
  const value = "1. Alpha";
  const edit = applyDocumentTextareaKey({
    value,
    selectionStart: value.length,
    selectionEnd: value.length,
    key: "Tab",
  });

  assert.deepEqual(edit, { value: "\tA. Alpha", selectionStart: 9, selectionEnd: 9 });
});

test("outline marker levels use numeric, alphabetic, then numeric-alpha styles", () => {
  assert.equal(orderedMarkerForLevel(0), "1.");
  assert.equal(orderedMarkerForLevel(1), "A.");
  assert.equal(orderedMarkerForLevel(2), "1A.");
});
