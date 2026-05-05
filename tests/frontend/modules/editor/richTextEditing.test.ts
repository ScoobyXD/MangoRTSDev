import test from "node:test";
import assert from "node:assert/strict";
import { EDITOR_DOCUMENT_BOTTOM_BUFFER_LINES, deserializeEditorDocumentHTML, getEditorLinkHrefForText, linkifyEditorPlainTextToHTML, sanitizeEditorDocumentHTML } from "../../../../frontend/src/modules/editor/richTextEditing.js";

test("editor rich text keeps a twenty-line bottom buffer", () => {
  assert.equal(EDITOR_DOCUMENT_BOTTOM_BUFFER_LINES, 20);
});

test("editor paste linkification turns plain URLs into safe visible links", () => {
  const html = linkifyEditorPlainTextToHTML("watch https://youtube.com/watch?v=abc now");

  assert.match(html, /<a href="https:\/\/youtube\.com\/watch\?v=abc"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /text-decoration: underline/);
});

test("editor paste linkification preserves punctuation outside the URL", () => {
  const html = linkifyEditorPlainTextToHTML("open https://example.test/path.");

  assert.match(html, /href="https:\/\/example\.test\/path"/);
  assert.match(html, /<\/a>\./);
});

test("editor link href normalization supports appended URL characters", () => {
  assert.equal(getEditorLinkHrefForText("www.example.test/path"), "https://www.example.test/path");
  assert.equal(getEditorLinkHrefForText("not a link"), null);
});

test("plain stored editor documents are escaped before becoming rich HTML", () => {
  const html = deserializeEditorDocumentHTML("<script>alert(1)</script> https://example.test");

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<a href="https:\/\/example\.test\/"/);
});

test("editor sanitizer collapses nested font-size wrappers to the final size", () => {
  const html = sanitizeEditorDocumentHTML('<span style="font-size: 14px;"><span style="font-size: 15px;"><span style="font-size: 16px;">nice</span></span></span>');

  assert.equal(html, '<span style="font-size: 16px;">nice</span>');
});
