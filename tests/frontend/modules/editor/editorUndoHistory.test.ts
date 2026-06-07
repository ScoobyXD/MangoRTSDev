import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyEditorInputType,
  createEditorDocumentUndoHistory,
  createEditorUndoHistory,
  recordEditorDocumentUndoChange,
  recordEditorUndoChange,
  redoEditorDocument,
  redoEditorText,
  resetEditorDocumentUndoHistory,
  resetEditorUndoHistory,
  snapshotEditorDocumentHTML,
  snapshotEditorText,
  undoEditorDocument,
  undoEditorText,
} from "../../../../frontend/src/modules/editor/editorUndoHistory.js";

test("adjacent typing inside the group window undoes as one small text group", () => {
  const history = createEditorUndoHistory();
  recordEditorUndoChange(history, snapshotEditorText("", 0, 0), snapshotEditorText("h", 1, 1), "typing", 0);
  recordEditorUndoChange(history, snapshotEditorText("h", 1, 1), snapshotEditorText("hi", 2, 2), "typing", 250);

  assert.equal(history.undoStack.length, 1);
  assert.deepEqual(undoEditorText(history, "hi"), snapshotEditorText("", 0, 0));
  assert.deepEqual(redoEditorText(history, ""), snapshotEditorText("hi", 2, 2));
});

test("typing after a pause starts a new undo group", () => {
  const history = createEditorUndoHistory();
  recordEditorUndoChange(history, snapshotEditorText("", 0, 0), snapshotEditorText("h", 1, 1), "typing", 0);
  recordEditorUndoChange(history, snapshotEditorText("h", 1, 1), snapshotEditorText("hi", 2, 2), "typing", 700);

  assert.equal(history.undoStack.length, 2);
  assert.deepEqual(undoEditorText(history, "hi"), snapshotEditorText("h", 1, 1));
});

test("non-adjacent edits stay separate even when they happen quickly", () => {
  const history = createEditorUndoHistory();
  recordEditorUndoChange(history, snapshotEditorText("ab", 2, 2), snapshotEditorText("abx", 3, 3), "typing", 0);
  recordEditorUndoChange(history, snapshotEditorText("abx", 0, 0), snapshotEditorText("yabx", 1, 1), "typing", 100);

  assert.equal(history.undoStack.length, 2);
  assert.deepEqual(undoEditorText(history, "yabx"), snapshotEditorText("abx", 0, 0));
});

test("backspace-style deletes merge and restore the original range", () => {
  const history = createEditorUndoHistory();
  recordEditorUndoChange(history, snapshotEditorText("abc", 3, 3), snapshotEditorText("ab", 2, 2), "delete", 0);
  recordEditorUndoChange(history, snapshotEditorText("ab", 2, 2), snapshotEditorText("a", 1, 1), "delete", 100);

  assert.equal(history.undoStack.length, 1);
  assert.deepEqual(undoEditorText(history, "a"), snapshotEditorText("abc", 3, 3));
});

test("paste is isolated and a new edit clears redo", () => {
  const history = createEditorUndoHistory();
  recordEditorUndoChange(history, snapshotEditorText("", 0, 0), snapshotEditorText("pasted", 6, 6), "paste", 0);
  assert.deepEqual(undoEditorText(history, "pasted"), snapshotEditorText("", 0, 0));
  assert.equal(history.redoStack.length, 1);

  recordEditorUndoChange(history, snapshotEditorText("", 0, 0), snapshotEditorText("x", 1, 1), "typing", 100);

  assert.equal(history.redoStack.length, 0);
  assert.deepEqual(redoEditorText(history, "x"), null);
});

test("history is bounded by group count and stored character budget", () => {
  const history = createEditorUndoHistory({ maxGroups: 2, maxStoredChars: 5 });
  recordEditorUndoChange(history, snapshotEditorText("", 0, 0), snapshotEditorText("a", 1, 1), "typing", 0);
  recordEditorUndoChange(history, snapshotEditorText("a", 1, 1), snapshotEditorText("ab", 2, 2), "typing", 700);
  recordEditorUndoChange(history, snapshotEditorText("ab", 2, 2), snapshotEditorText("abc", 3, 3), "typing", 1400);

  assert.equal(history.undoStack.length, 2);
  recordEditorUndoChange(history, snapshotEditorText("abc", 3, 3), snapshotEditorText("abc123456", 9, 9), "paste", 2000);
  assert.equal(history.undoStack.length, 0);
});

test("input type classification follows browser edit intent", () => {
  assert.equal(classifyEditorInputType("insertText"), "typing");
  assert.equal(classifyEditorInputType("insertFromPaste"), "paste");
  assert.equal(classifyEditorInputType("deleteContentBackward"), "delete");
  assert.equal(classifyEditorInputType("insertLineBreak"), "lineBreak");
  assert.equal(classifyEditorInputType(undefined), "unknown");
});

test("reset drops local editor undo and redo state", () => {
  const history = createEditorUndoHistory();
  recordEditorUndoChange(history, snapshotEditorText("", 0, 0), snapshotEditorText("a", 1, 1), "typing", 0);
  undoEditorText(history, "a");

  resetEditorUndoHistory(history);

  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 0);
});

test("document undo restores image-bearing HTML snapshots", () => {
  const history = createEditorDocumentUndoHistory();
  const before = snapshotEditorDocumentHTML("<!-- mango-editor-html-v1 -->", 0, 0);
  const after = snapshotEditorDocumentHTML('<!-- mango-editor-html-v1 --><span data-mango-editor-image="true"><img src="data:image/png;base64,iVBORw0KGgo="/></span>', 0, 0);

  recordEditorDocumentUndoChange(history, before, after, "image", 0);

  assert.deepEqual(undoEditorDocument(history, after.html), before);
  assert.deepEqual(redoEditorDocument(history, before.html), after);

  resetEditorDocumentUndoHistory(history);
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 0);
});

test("document undo skips stale newer snapshots without clearing usable history", () => {
  const history = createEditorDocumentUndoHistory();
  const start = snapshotEditorDocumentHTML("start", 0, 0);
  const middle = snapshotEditorDocumentHTML("middle", 6, 6);
  const stale = snapshotEditorDocumentHTML("stale", 5, 5);

  recordEditorDocumentUndoChange(history, start, middle, "typing", 0);
  recordEditorDocumentUndoChange(history, middle, stale, "typing", 700);

  assert.deepEqual(undoEditorDocument(history, middle.html), start);
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 1);
  assert.deepEqual(redoEditorDocument(history, start.html), middle);
});

test("document redo skips stale newer snapshots without clearing usable history", () => {
  const history = createEditorDocumentUndoHistory();
  const start = snapshotEditorDocumentHTML("start", 0, 0);
  const middle = snapshotEditorDocumentHTML("middle", 6, 6);
  const stale = snapshotEditorDocumentHTML("stale", 5, 5);

  recordEditorDocumentUndoChange(history, start, middle, "typing", 0);
  assert.deepEqual(undoEditorDocument(history, middle.html), start);
  history.redoStack.push({ before: stale, after: snapshotEditorDocumentHTML("stale-after", 11, 11), kind: "typing", timestamp: 700 });

  assert.deepEqual(redoEditorDocument(history, start.html), middle);
  assert.equal(history.redoStack.length, 0);
  assert.equal(history.undoStack.length, 1);
});
