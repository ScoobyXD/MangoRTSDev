import test from "node:test";
import assert from "node:assert/strict";
import { buildEditorIndentGuideSegments, editorIndentGuideLeftForDepth } from "../../../../frontend/src/modules/editor/editorIndentGuides.js";
import { EDITOR_DOCUMENT_PROPORTIONAL_FONT_FAMILY, getEditorDocumentFontFamily } from "../../../../frontend/src/modules/editor/useEditorPreferences.js";

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

test("indent guides keep Inter text while guide positions follow rendered spaces", () => {
  assert.equal(getEditorDocumentFontFamily("indent-guides"), EDITOR_DOCUMENT_PROPORTIONAL_FONT_FAMILY);
  assert.equal(getEditorDocumentFontFamily("automatic-outline-numbering"), EDITOR_DOCUMENT_PROPORTIONAL_FONT_FAMILY);
  assert.equal(editorIndentGuideLeftForDepth(1, 5), "0em");
  assert.equal(editorIndentGuideLeftForDepth(2, 5), "1.25em");
  assert.equal(editorIndentGuideLeftForDepth(3, 5), "2.5em");
  assert.doesNotMatch(editorIndentGuideLeftForDepth(3, 5), /ch/);
});
