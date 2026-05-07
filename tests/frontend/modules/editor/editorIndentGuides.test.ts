import test from "node:test";
import assert from "node:assert/strict";
import { buildEditorIndentGuideSegments } from "../../../../frontend/src/modules/editor/editorIndentGuides.js";

test("indent guides are empty for unindented text", () => {
  assert.deepEqual(buildEditorIndentGuideSegments("alpha\nbeta", 5), []);
});

test("indent guides follow only actual indented lines", () => {
  const text = "root\n     child\n     child again\nroot again";

  assert.deepEqual(buildEditorIndentGuideSegments(text, 5), [
    { depth: 1, lineStart: 1, lineEnd: 2 },
  ]);
});

test("indent guides close nested levels when indentation drops", () => {
  const text = "root\n     child\n          grandchild\n     child again\nroot again";

  assert.deepEqual(buildEditorIndentGuideSegments(text, 5), [
    { depth: 2, lineStart: 2, lineEnd: 2 },
    { depth: 1, lineStart: 1, lineEnd: 3 },
  ]);
});

test("indent guides continue through blank lines inside an indented block", () => {
  const text = "root\n     child\n\n     child again\nroot again";

  assert.deepEqual(buildEditorIndentGuideSegments(text, 5), [
    { depth: 1, lineStart: 1, lineEnd: 3 },
  ]);
});

test("indent guides include newly inserted whitespace-only indented lines", () => {
  const text = "root\n     ";

  assert.deepEqual(buildEditorIndentGuideSegments(text, 5), [
    { depth: 1, lineStart: 1, lineEnd: 1 },
  ]);
});
