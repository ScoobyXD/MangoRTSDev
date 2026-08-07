import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IDBKeyRange, IDBObjectStore, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { JSDOM } from "jsdom";

import { MangoEditorLifecycle } from "../../../../frontend/src/modules/editor/editorLifecycle.js";
import {
  publishEditorSaveState,
  readEditorSaveState,
} from "../../../../frontend/src/modules/editor/editorSaveStatusStore.js";
import {
  compactMangoTiptapDocument,
  createEmptyMangoTiptapDocument,
  parseMangoTiptapDocument,
  serializeMangoTiptapDocument,
  validateMangoTiptapDocument,
  type MangoTiptapDocument,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapDocument.js";
import {
  MangoTiptapSync,
  mangoTiptapPendingStorageKey,
  readExactMangoTiptapPending,
  type MangoTiptapSaveState,
  type MangoTiptapSnapshot,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapSync.js";
import {
  clearMangoEditorDataFormatCacheForTests,
  loadMangoEditorDataFormat,
} from "../../../../frontend/src/modules/editor/editorDataFormat.js";
import {
  createMangoTiptapExtensions,
  handleMangoTiptapOutlineEnter,
  indentMangoTiptapSelection,
  MangoTiptapEditorEngine,
  normalizeMangoTiptapBlockIDs,
  repairMangoTiptapRecoveredDocument,
  outdentMangoTiptapSelection,
  readMangoTiptapSelectionState,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapExtensions.js";
import {
  calculateMangoTiptapTableGrowth,
  growMangoTiptapTable,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapTable.js";
import {
  captureMangoTiptapPointerBookmark,
  resolveMangoTiptapPointerBookmark,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapPointerActivation.js";
import {
  MangoTiptapAnnotations,
  mergeMangoTiptapAnnotationPositions,
  navigateMangoTiptapTarget,
  readMappedMangoTiptapAnnotations,
  updateMangoTiptapAnnotations,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapAnnotations.js";
import {
  getEditorRuntimeMetrics,
  resetEditorRuntimeMetricsForTests,
} from "../../../../frontend/src/modules/editor/editorRuntimeMetrics.js";
import {
  createEditorTraceContext,
  resetEditorTraceForTests,
  startEditorTraceForTests,
  stopEditorTraceForTests,
} from "../../../../frontend/src/modules/editor/editorTrace.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test("an image failure remains visible after ordinary text later saves", () => {
  const storageKey = "node:sticky-image-failure";
  const failure: MangoTiptapSaveState = {
    status: "failed",
    message: "Unable to import a pasted image",
    unresolvedFailure: true,
  };

  assert.deepEqual(publishEditorSaveState(storageKey, failure), failure);
  assert.deepEqual(publishEditorSaveState(storageKey, { status: "pending" }), failure);
  assert.deepEqual(publishEditorSaveState(storageKey, { status: "saving" }), failure);
  assert.deepEqual(publishEditorSaveState(storageKey, {
    status: "saved",
    revision: 2,
    updatedTimestamp: "2026-07-30T00:00:00Z",
    unresolvedFailure: false,
  }), failure);
  assert.deepEqual(readEditorSaveState(storageKey), failure);
});


function richDocument(text = "Mango"): MangoTiptapDocument {
  return {
    format: "mango-tiptap-json",
    schema_version: 1,
    document: {
      type: "doc",
      content: [{
        type: "paragraph",
        attrs: { blockId: "paragraph-1", textAlign: "center", indentLevel: 1 },
        content: [
          { type: "mention", attrs: { userId: "user-1", label: "Ada", kind: "normal" } },
          { type: "text", text, marks: [
            { type: "bold" },
            { type: "underline" },
            { type: "textStyle", attrs: { fontSize: "18px", color: "#123456" } },
            { type: "highlight", attrs: { color: "#fff59d" } },
            { type: "link", attrs: { href: "https://example.test", rel: "noopener" } },
          ] },
        ],
      }, {
        type: "table",
        attrs: { blockId: "table-1" },
        content: [{ type: "tableRow", content: [
          { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: [160] }, content: [{ type: "paragraph", content: [{ type: "text", text: "Key" }] }] },
          { type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Value" }] }] },
        ] }],
      }, {
        type: "mangoAttachmentImage",
        attrs: {
          attachmentId: "attachment-1", filename: "diagram.png", mimeType: "image/png",
          width: 640, height: 360, displayWidth: 320, displayHeight: 180,
          alignment: "center", position: "break", layout: "content", alt: "Diagram", title: "Diagram",
        },
      }],
    },
  };
}

function mangoBlockIDs(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const node = value as { attrs?: { blockId?: unknown }; content?: unknown[] };
  const current = typeof node.attrs?.blockId === "string" && node.attrs.blockId.trim()
    ? [node.attrs.blockId]
    : [];
  return current.concat((node.content ?? []).flatMap(mangoBlockIDs));
}

function saveAcknowledgement(operationID: string, revision: number, deduplicated = false) {
  return {
    operation_id: operationID,
    revision,
    committed_at: "2026-07-29T18:00:00Z",
    ...(deduplicated ? { deduplicated: true } : {}),
  };
}

async function writeRawMangoTiptapPending(record: Record<string, unknown>): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolveDB, reject) => {
    const request = indexedDB.open("mango-tiptap-pending-v1", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("pending_documents")) {
        request.result.createObjectStore("pending_documents", { keyPath: "storage_key" });
      }
    };
    request.onsuccess = () => resolveDB(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolveWrite, reject) => {
      const transaction = db.transaction("pending_documents", "readwrite");
      transaction.objectStore("pending_documents").put(record);
      transaction.oncomplete = () => resolveWrite();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

test("editor lifecycle pins dirty work until persistence is confirmed", () => {
  const lifecycle = new MangoEditorLifecycle();
  assert.equal(lifecycle.getSnapshot().state, "sleeping");
  lifecycle.setNearViewport(true);
  assert.equal(lifecycle.getSnapshot().state, "preparing");
  lifecycle.finishPreparation();
  assert.equal(lifecycle.getSnapshot().state, "sleeping");
  lifecycle.setNearViewport(true);
  lifecycle.activate();
  lifecycle.markDirty();
  assert.deepEqual(
    { state: lifecycle.getSnapshot().state, pinned: lifecycle.getSnapshot().pinned },
    { state: "dirty", pinned: true },
  );
  assert.equal(lifecycle.requestSleep(), false);
  lifecycle.setPendingCount(0);
  lifecycle.setNearViewport(false);
  assert.equal(lifecycle.requestSleep(), true);
  lifecycle.finishDeactivation();
  assert.equal(lifecycle.getSnapshot().state, "sleeping");
});

test("Mango validates only the versioned document envelope before Tiptap opens it", () => {
  assert.equal(validateMangoTiptapDocument(richDocument()).valid, true);
  assert.equal(parseMangoTiptapDocument(JSON.stringify(richDocument())).valid, true);
  assert.equal(parseMangoTiptapDocument("<p>legacy HTML</p>").valid, false);
  const wrongVersion = { ...createEmptyMangoTiptapDocument(), schema_version: 2 };
  assert.equal(validateMangoTiptapDocument(wrongVersion).valid, false);
  const wrongRoot = { ...createEmptyMangoTiptapDocument(), document: { type: "paragraph" } };
  assert.equal(validateMangoTiptapDocument(wrongRoot).valid, false);
});

test("schema-default compaction shortens the reported Node Text Box JSON and round trips exactly", () => {
  const screenshotDocument: MangoTiptapDocument = {
    format: "mango-tiptap-json",
    schema_version: 1,
    document: {
      type: "doc",
      content: [{
        type: "paragraph",
        attrs: { blockId: "970fa252-c954-4fc8-a5fa-7d5ba02807f3", textAlign: null, indentLevel: 0 },
        content: [{ text: "this is a test test testS", type: "text" }],
      }, {
        type: "paragraph",
        attrs: { blockId: "7c83bff9-24de-448c-a569-cdd951a7277c", textAlign: null, indentLevel: 0 },
      }, {
        type: "paragraph",
        attrs: { blockId: "65aac248-d542-45c6-9f1a-b13be7fb8b82", textAlign: null, indentLevel: 0 },
        content: [{ text: "s", type: "text" }, { type: "hardBreak" }, { type: "hardBreak" }],
      }, {
        type: "mangoAttachmentImage",
        attrs: {
          alt: "image.png", title: "image.png", width: 640, height: 360,
          layout: "content", linkRel: "", filename: "image.png", linkHref: "",
          mimeType: "image/png", position: "break", alignment: "left", linkTitle: "",
          linkTarget: "", attachmentId: "019fc309-c4a2-7001-b819-35365e91c300",
          displayWidth: 640, displayHeight: 360,
        },
      }, {
        type: "paragraph",
        attrs: { blockId: "3807418e-4311-4f94-9075-d9ce53afee0a", textAlign: null, indentLevel: 0 },
      }],
    },
  };
  const editor = new MangoTiptapEditorEngine({
    extensions: createMangoTiptapExtensions({ editable: false }),
    content: createEmptyMangoTiptapDocument().document,
  });
  try {
    const expanded: MangoTiptapDocument = {
      ...screenshotDocument,
      document: editor.schema.nodeFromJSON(screenshotDocument.document).toJSON(),
    };
    const before = JSON.stringify(expanded);
    const compact = compactMangoTiptapDocument(expanded, editor.schema);
    const paragraphs = compact.document.content?.filter((node) => node.type === "paragraph") ?? [];
    paragraphs.forEach((paragraph) => {
      assert.deepEqual(Object.keys(paragraph.attrs ?? {}), ["blockId"]);
    });
    const image = compact.document.content?.find((node) => node.type === "mangoAttachmentImage");
    assert.deepEqual(image?.attrs, {
      attachmentId: "019fc309-c4a2-7001-b819-35365e91c300",
      filename: "image.png",
      mimeType: "image/png",
      width: 640,
      height: 360,
      displayWidth: 640,
      displayHeight: 360,
      alt: "image.png",
      title: "image.png",
    });
    assert.ok(before.length - JSON.stringify(compact).length > 200, "the example should lose more than 200 redundant JSON characters");
    assert.deepEqual(editor.schema.nodeFromJSON(compact.document).toJSON(), expanded.document, "schema defaults must hydrate to the exact expanded document");
    assert.equal(JSON.stringify(expanded), before, "compaction must not mutate the captured editor document");

    const formattedExpanded: MangoTiptapDocument = {
      ...richDocument(),
      document: editor.schema.nodeFromJSON(richDocument().document).toJSON(),
    };
    const formattedCompact = compactMangoTiptapDocument(formattedExpanded, editor.schema);
    assert.equal(formattedCompact.document.content?.[0]?.attrs?.textAlign, "center");
    assert.equal(formattedCompact.document.content?.[0]?.attrs?.indentLevel, 1);
    assert.equal(formattedCompact.document.content?.[2]?.attrs?.alignment, "center");
    assert.equal(formattedCompact.document.content?.[2]?.attrs?.displayWidth, 320);
    assert.equal(formattedCompact.document.content?.[0]?.content?.[1]?.marks?.find((mark) => mark.type === "link")?.attrs?.rel, "noopener");
    assert.deepEqual(editor.schema.nodeFromJSON(formattedCompact.document).toJSON(), formattedExpanded.document);
  } finally {
    editor.destroy();
  }
});

test("legacy Project JSON repairs repeated block IDs and keeps required Node link identity when compacted", () => {
  const normalized = normalizeMangoTiptapBlockIDs({
    type: "doc",
    content: [{
      type: "paragraph",
      attrs: { blockId: "repeated-project-block" },
      content: [{
        type: "mangoEntityLink",
        attrs: { entityType: "node", entityId: "node-1", label: "Temp Admin Candidates" },
      }],
    }, {
      type: "paragraph",
      attrs: { blockId: "repeated-project-block" },
      content: [{ type: "text", text: "Project notes" }],
    }],
  });
  const blockIDs = (normalized.content ?? []).map((node) => node.attrs?.blockId);
  assert.equal(new Set(blockIDs).size, 2, "load normalization must repair the repeated legacy block ID");

  const editor = new MangoTiptapEditorEngine({
    extensions: createMangoTiptapExtensions({ editable: false }),
    content: createEmptyMangoTiptapDocument().document,
  });
  try {
    const expanded: MangoTiptapDocument = {
      format: "mango-tiptap-json",
      schema_version: 1,
      document: editor.schema.nodeFromJSON(normalized).toJSON(),
    };
    const compact = compactMangoTiptapDocument(expanded, editor.schema);
    const entityLink = compact.document.content?.[0]?.content?.[0];
    assert.deepEqual(entityLink?.attrs, {
      entityType: "node",
      entityId: "node-1",
      label: "Temp Admin Candidates",
    });
    assert.deepEqual(
      editor.schema.nodeFromJSON(compact.document).toJSON(),
      expanded.document,
      "compaction must retain the complete durable document identity",
    );
  } finally {
    editor.destroy();
  }
});

test("block ID normalization preserves the first ID and repairs missing or repeated IDs", () => {
  const source: MangoTiptapDocument["document"] = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { blockId: "shared-block" } },
      { type: "paragraph", attrs: { blockId: "shared-block" } },
      {
        type: "bulletList",
        attrs: { blockId: "list-block" },
        content: [{
          type: "listItem",
          attrs: { blockId: "shared-block" },
          content: [{ type: "paragraph" }],
        }],
      },
    ],
  };
  const normalized = normalizeMangoTiptapBlockIDs(source);
  const blockIDs = mangoBlockIDs(normalized);
  assert.equal(blockIDs[0], "shared-block", "the first occurrence remains stable");
  assert.equal(blockIDs.length, 5);
  assert.equal(new Set(blockIDs).size, blockIDs.length);
  assert.equal(source.content?.[1]?.attrs?.blockId, "shared-block", "normalization does not mutate canonical input");
  assert.equal(normalizeMangoTiptapBlockIDs(normalized), normalized, "already-correct JSON keeps its object identity");
});

test("cosmetic formatting survives serialization without Mango normalization", () => {
  const pasted: MangoTiptapDocument = {
    format: "mango-tiptap-json",
    schema_version: 1,
    document: {
      type: "doc",
      content: [{
        type: "paragraph",
        attrs: { textAlign: "justify", indentLevel: 1.5, clipboardOnly: "ignored by Tiptap" },
        content: [
          { type: "text", text: "first line", marks: [{ type: "textStyle", attrs: { fontSize: "10.5pt", color: "rgb(31, 78, 121)" } }] },
          { type: "hardBreak", marks: [{ type: "bold" }, { type: "highlight", attrs: { color: "color(display-p3 1 0.8 0.1)" } }] },
          { type: "text", text: "second line" },
        ],
      }],
    },
  };
  const serialized = serializeMangoTiptapDocument(pasted);
  const parsed = parseMangoTiptapDocument(serialized);
  assert.equal(parsed.valid, true, parsed.valid ? "" : parsed.error);
  if (!parsed.valid) return;
  assert.deepEqual(parsed.value, pasted);
  assert.equal(parsed.value.document.content?.[0]?.content?.map((node) => node.text ?? "").join(""), "first linesecond line");
});
test("Tiptap validation and serialization accept documents beyond the former two MiB cap", () => {
  const document = richDocument("x".repeat(2 * 1024 * 1024 + 4096));
  const serialized = JSON.stringify(document);
  assert.ok(new TextEncoder().encode(serialized).byteLength > 2 * 1024 * 1024);
  assert.equal(validateMangoTiptapDocument(document).valid, true);
  assert.equal(serializeMangoTiptapDocument(document), serialized);
});

test("Tiptap owns commands, history, tables, positions, and annotation mapping", () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    Node: globalThis.Node,
    ClipboardEvent: globalThis.ClipboardEvent,
    HTMLElement: globalThis.HTMLElement,
    MutationObserver: globalThis.MutationObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const dom = new JSDOM("<!doctype html><div id=\"editor\"></div>", { url: "https://mango.test/" });
  const domGlobals = dom.window as unknown as typeof globalThis;
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "Node", { configurable: true, value: domGlobals.Node });
  Object.defineProperty(globalThis, "ClipboardEvent", { configurable: true, value: domGlobals.Event });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: domGlobals.HTMLElement });
  Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: domGlobals.MutationObserver });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: (handle: number) => clearTimeout(handle) });
  const editor = new MangoTiptapEditorEngine({
    element: dom.window.document.querySelector<HTMLElement>("#editor"),
    extensions: createMangoTiptapExtensions({ editable: true }),
    content: richDocument("format me").document,
    enableContentCheck: true,
  });
  editor.registerPlugin(MangoTiptapAnnotations);
  try {
    const typeThroughEditorInput = (value: string) => {
      for (const character of value) {
        const { from, to } = editor.state.selection;
        const handled = editor.view.someProp(
          "handleTextInput",
          (handler) => handler(editor.view, from, to, character, () => editor.state.tr.insertText(character, from, to)),
        ) ?? false;
        if (!handled) editor.view.dispatch(editor.state.tr.insertText(character, from, to));
      }
    };
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    editor.commands.setTextSelection(1);
    typeThroughEditorInput("forward -> backward <-");
    assert.equal(editor.getText(), "forward \u2192 backward \u2190", "typed ASCII arrow pairs become one durable arrow in either direction");
    assert.equal(editor.state.selection.from, "forward \u2192 backward \u2190".length + 1, "the caret remains after the converted arrow");
    assert.deepEqual(
      editor.state.doc.firstChild?.textContent,
      "forward \u2192 backward \u2190",
      "the unified arrow is stored as Unicode document text",
    );

    editor.commands.setContent({ type: "doc", content: [{ type: "codeBlock" }] });
    editor.commands.setTextSelection(1);
    typeThroughEditorInput("literal -> and <-");
    assert.equal(editor.getText(), "literal -> and <-", "code blocks retain literal input-rule text");

    editor.commands.setContent(richDocument("format me").document);
    editor.commands.setTextSelection({ from: 2, to: 8 });
    assert.equal(editor.chain().toggleBold().toggleItalic().toggleUnderline().toggleStrike().run(), true);
    assert.equal(editor.chain().setFontSize("22px").setColor("#112233").setHighlight({ color: "#fff59d" }).run(), true);
    assert.equal(editor.chain().setTextAlign("right").run(), true);
    assert.equal(editor.chain().setTextAlign("justify").run(), false);
    const beforeTable = editor.getJSON();
    assert.equal(editor.chain().focus("end").insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run(), true);
    assert.equal(editor.getJSON().content?.some((node) => node.type === "table"), true);
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.getJSON(), beforeTable);
    assert.equal(editor.commands.redo(), true);
    assert.deepEqual(calculateMangoTiptapTableGrowth({
      startX: 100,
      startY: 100,
      currentX: 225,
      currentY: 175,
      rowHeight: 36,
      columnWidth: 112,
    }), { rows: 2, columns: 1 }, "table drag distance becomes whole equal-sized row and column additions");
    let firstTableCellPosition: number | null = null;
    editor.state.doc.descendants((node, position) => {
      if (firstTableCellPosition != null || (node.type.name !== "tableCell" && node.type.name !== "tableHeader")) return;
      firstTableCellPosition = position + 2;
    });
    assert.notEqual(firstTableCellPosition, null);
    editor.commands.setTextSelection(firstTableCellPosition!);
    assert.equal(editor.isActive("table"), true, "table growth starts from a selected table cell");
    const tableBeforeGrowth = Array.from({ length: editor.state.doc.childCount }, (_, index) => editor.state.doc.child(index))
      .find((node) => node.type.name === "table")
      ?? null;
    const rowsBeforeGrowth = tableBeforeGrowth?.childCount ?? 0;
    const columnsBeforeGrowth = tableBeforeGrowth?.firstChild?.childCount ?? 0;
    let tableGrowthTransactions = 0;
    const countTableGrowthTransaction = () => { tableGrowthTransactions += 1; };
    editor.on("transaction", countTableGrowthTransaction);
    assert.equal(growMangoTiptapTable(editor, { rows: 2, columns: 1 }), true);
    editor.off("transaction", countTableGrowthTransaction);
    assert.equal(tableGrowthTransactions, 1, "releasing a table growth drag commits one document transaction");
    const grownTable = Array.from({ length: editor.state.doc.childCount }, (_, index) => editor.state.doc.child(index))
      .find((node) => node.type.name === "table")
      ?? null;
    assert.equal(grownTable?.type.name, "table");
    assert.equal(grownTable?.childCount, rowsBeforeGrowth + 2, "table growth appends the requested rows");
    for (let rowIndex = 0; rowIndex < (grownTable?.childCount ?? 0); rowIndex += 1) {
      assert.equal(grownTable?.child(rowIndex).childCount, columnsBeforeGrowth + 1, "every grown row has the same column count");
    }

    let annotationTransactions = 0;
    const countAnnotationTransaction = () => { annotationTransactions += 1; };
    editor.on("transaction", countAnnotationTransaction);
    assert.equal(updateMangoTiptapAnnotations(editor, [{ id: "comment-1", kind: "comment", from: 2, to: 6 }]), true);
    assert.equal(annotationTransactions, 1);
    assert.equal(updateMangoTiptapAnnotations(editor, [{ id: "comment-1", kind: "comment", from: 2, to: 6 }]), false);
    assert.equal(annotationTransactions, 1, "a content-identical annotation array must not dispatch a replacement transaction");
    assert.equal(updateMangoTiptapAnnotations(editor, [{ id: "comment-1", kind: "comment", from: 2, to: 6, active: true }]), true);
    assert.equal(annotationTransactions, 2, "a real annotation change must dispatch exactly once");
    editor.off("transaction", countAnnotationTransaction);
    const before = readMappedMangoTiptapAnnotations(editor)[0];
    assert.ok(before);
    editor.commands.insertContentAt(1, "prefix");
    const after = readMappedMangoTiptapAnnotations(editor)[0];
    assert.ok(after && after.from > before.from && after.to > before.to);
    const blockID = String(editor.getJSON().content?.find((node) => node.attrs?.blockId)?.attrs?.blockId || "");
    assert.equal(Boolean(blockID), true);
    assert.equal(navigateMangoTiptapTarget(editor, { blockID }), true);
    const validation = validateMangoTiptapDocument({
      format: "mango-tiptap-json", schema_version: 1, document: editor.getJSON(),
    });
    assert.equal(validation.valid, true, validation.valid ? "" : validation.error);

    editor.commands.setContent({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { blockId: "kept-block" }, content: [{ type: "text", text: "kept" }] },
        { type: "paragraph", attrs: { blockId: "other-block" }, content: [{ type: "text", text: "other" }] },
      ],
    });
    assert.equal(editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "paragraph",
      attrs: { blockId: "kept-block" },
      content: [{ type: "text", text: "copied" }],
    }), true);
    const insertedBlockIDs = mangoBlockIDs(editor.getJSON());
    assert.equal(insertedBlockIDs[0], "kept-block", "the existing block keeps its identity");
    assert.equal(new Set(insertedBlockIDs).size, insertedBlockIDs.length, "inserted structured content cannot reuse an existing block ID");

    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    editor.commands.setTextSelection(1);
    assert.equal(editor.view.pasteHTML('<p><strong><span style="font-size: 10.5pt; color: rgb(31, 78, 121)">first line<br>second line</span></strong></p>'), true);
    const parsedClipboardDocument: MangoTiptapDocument = {
      format: "mango-tiptap-json",
      schema_version: 1,
      document: editor.getJSON(),
    };
    const parsedClipboardBreak = parsedClipboardDocument.document.content?.[0]?.content?.find((node) => node.type === "hardBreak");
    assert.equal(parsedClipboardBreak?.type, "hardBreak");
    assert.ok((parsedClipboardBreak?.marks?.length ?? 0) > 0, "the real Tiptap HTML parser carries pasted formatting onto the line break");
    const clipboardValidation = validateMangoTiptapDocument(parsedClipboardDocument);
    assert.equal(clipboardValidation.valid, true, clipboardValidation.valid ? "" : clipboardValidation.error);
    assert.ok((parsedClipboardBreak?.marks?.length ?? 0) > 0, "cosmetic line-break marks remain in the valid ProseMirror document");
    assert.equal(parsedClipboardDocument.document.content?.[0]?.content?.filter((node) => node.type === "text").map((node) => node.text).join(""), "first linesecond line");
    editor.commands.setContent({
      type: "doc",
      content: [{
        type: "paragraph",
        attrs: { indentLevel: 0 },
        content: [
          { type: "text", text: "left", marks: [
            { type: "bold" },
            { type: "underline" },
            { type: "italic" },
            { type: "textStyle", attrs: { fontSize: "18px" } },
          ] },
          { type: "text", text: "right" },
        ],
      }],
    });
    editor.commands.setTextSelection(5);
    assert.deepEqual(
      readMangoTiptapSelectionState(editor),
      {
        fontSize: 18,
        highlightColor: null,
        textAlignment: "left",
        bold: true,
        underline: true,
        italic: true,
        strikethrough: false,
      },
      "a caret reflects the formatting of the character immediately to its left",
    );
    editor.commands.setTextSelection(6);
    const unformattedCaretState = readMangoTiptapSelectionState(editor);
    assert.deepEqual(
      {
        fontSize: unformattedCaretState.fontSize,
        bold: unformattedCaretState.bold,
        underline: unformattedCaretState.underline,
        italic: unformattedCaretState.italic,
      },
      { fontSize: 15, bold: false, underline: false, italic: false },
      "moving past the first unformatted character clears the toolbar state",
    );

    editor.commands.setContent({ type: "doc", content: [
      { type: "paragraph", attrs: { blockId: "indent-current", indentLevel: 0 }, content: [{ type: "text", text: "plain" }] },
      { type: "paragraph", attrs: { blockId: "indent-neighbor", indentLevel: 0 }, content: [{ type: "text", text: "neighbor" }] },
    ] });
    editor.commands.setTextSelection(3);
    assert.equal(indentMangoTiptapSelection(editor), true);
    assert.equal(editor.state.doc.textContent, "plainneighbor", "Tab changes block indentation without inserting a tab character");
    assert.equal(editor.state.doc.child(0).attrs.indentLevel, 1, "Tab indents only the row containing the caret");
    assert.equal(editor.state.doc.child(1).attrs.indentLevel, 0, "Tab leaves the neighboring row unchanged");
    assert.equal(outdentMangoTiptapSelection(editor), true);
    assert.equal(editor.state.doc.child(0).attrs.indentLevel, 0);

    for (const [outlineStyle, expectedList] of [
      ["automatic-outline-numbering", "orderedList"],
      ["bullet-list", "bulletList"],
      ["checklist", "taskList"],
    ] as const) {
      editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
      editor.commands.setTextSelection(1);
      assert.equal(handleMangoTiptapOutlineEnter(editor, outlineStyle), true, `Enter starts ${outlineStyle} on an empty row`);
      assert.equal(editor.state.doc.firstChild?.type.name, expectedList);
      assert.equal(editor.state.doc.childCount, 1, `${outlineStyle} must not append a generated ordinary row`);
    }

    editor.commands.setContent({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "ordinary row" }] },
    ] });
    editor.commands.setTextSelection(9);
    assert.equal(handleMangoTiptapOutlineEnter(editor, "bullet-list"), true);
    assert.equal(editor.state.doc.child(0).textContent, "ordinary");
    assert.equal(editor.state.doc.child(1).type.name, "bulletList", "Enter starts the selected bullet mode on only the new row");
    assert.equal(editor.state.doc.child(1).textContent, " row");

    editor.commands.setContent({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "checkbox row" }] },
    ] });
    editor.commands.setTextSelection(9);
    let checkboxTransactions = 0;
    const countCheckboxTransaction = () => { checkboxTransactions += 1; };
    editor.on("transaction", countCheckboxTransaction);
    assert.equal(handleMangoTiptapOutlineEnter(editor, "checklist"), true);
    editor.off("transaction", countCheckboxTransaction);
    assert.equal(checkboxTransactions, 1, "Checkbox Enter creates its row atomically");
    assert.equal(editor.state.doc.childCount, 2, "Checkbox Enter must not insert an intervening ordinary row");
    assert.equal(editor.state.doc.child(0).type.name, "paragraph");
    assert.equal(editor.state.doc.child(0).textContent, "checkbox");
    assert.equal(editor.state.doc.child(1).type.name, "taskList");
    assert.equal(editor.state.doc.child(1).textContent, " row");
    assert.equal(editor.state.doc.child(1).firstChild?.attrs.checked, false, "new Checkbox rows start unchecked");
    assert.equal(editor.state.selection.$from.parent.type.name, "paragraph", "the caret stays in the new Checkbox row");

    editor.commands.setContent({
      type: "doc",
      content: [{ type: "bulletList", attrs: { blockId: "bullet-list" }, content: [
        { type: "listItem", attrs: { blockId: "bullet-first" }, content: [{ type: "paragraph", attrs: { blockId: "bullet-first-paragraph" }, content: [{ type: "text", text: "first" }] }] },
        { type: "listItem", attrs: { blockId: "bullet-after" }, content: [{ type: "paragraph", attrs: { blockId: "bullet-after-paragraph" }, content: [{ type: "text", text: "after" }] }] },
      ] }],
    });
    editor.commands.setTextSelection(6);
    assert.equal(editor.commands.splitListItem("listItem"), true, "Enter creates the next bullet row");
    const splitBulletIDs = mangoBlockIDs(editor.getJSON());
    assert.equal(new Set(splitBulletIDs).size, splitBulletIDs.length, "splitting a bullet must replace cloned list-item and paragraph IDs");
    assert.equal(editor.commands.insertContent("child"), true);
    assert.equal(indentMangoTiptapSelection(editor), true, "Tab nests the newly created bullet row");
    assert.equal((JSON.stringify(editor.getJSON()).match(/"type":"bulletList"/g) ?? []).length, 2);
    const nestedBulletIDs = mangoBlockIDs(editor.getJSON());
    assert.equal(new Set(nestedBulletIDs).size, nestedBulletIDs.length, "nesting a bullet must keep every block ID unique");

    editor.commands.setContent({
      type: "doc",
      content: [{ type: "taskList", attrs: { blockId: "task-list" }, content: [
        { type: "taskItem", attrs: { checked: false, blockId: "task-first" }, content: [{ type: "paragraph", attrs: { blockId: "task-first-paragraph" }, content: [{ type: "text", text: "first" }] }] },
        { type: "taskItem", attrs: { checked: false, blockId: "task-after" }, content: [{ type: "paragraph", attrs: { blockId: "task-after-paragraph" }, content: [{ type: "text", text: "after" }] }] },
      ] }],
    });
    editor.commands.setTextSelection(6);
    assert.equal(handleMangoTiptapOutlineEnter(editor, "checklist"), true, "Enter creates the next Checkbox row");
    const splitTaskIDs = mangoBlockIDs(editor.getJSON());
    assert.equal(new Set(splitTaskIDs).size, splitTaskIDs.length, "splitting a Checkbox item must replace cloned item and paragraph IDs");
    assert.equal(editor.commands.insertContent("child"), true);
    assert.equal(indentMangoTiptapSelection(editor), true, "Tab nests the newly created Checkbox row");
    assert.equal((JSON.stringify(editor.getJSON()).match(/"type":"taskList"/g) ?? []).length, 2);
    const nestedTaskIDs = mangoBlockIDs(editor.getJSON());
    assert.equal(new Set(nestedTaskIDs).size, nestedTaskIDs.length, "nesting a Checkbox item must keep every block ID unique");
  } finally {
    editor.destroy();
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});

test("real insert/delete transactions persist moved comment, change, and chat positions across remount", async () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    MutationObserver: globalThis.MutationObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    sessionStorage: globalThis.sessionStorage,
  };
  const dom = new JSDOM("<!doctype html><div id=\"first\"></div><div id=\"second\"></div><div id=\"third\"></div>", { url: "https://mango.test/" });
  const domGlobals = dom.window as unknown as typeof globalThis;
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "Node", { configurable: true, value: domGlobals.Node });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: domGlobals.Element });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: domGlobals.HTMLElement });
  Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: domGlobals.MutationObserver });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: (handle: number) => clearTimeout(handle) });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });

  const initial: MangoTiptapDocument = {
    format: "mango-tiptap-json",
    schema_version: 1,
    document: {
      type: "doc",
      content: [{
        type: "paragraph",
        attrs: { blockId: "mapped-paragraph", textAlign: "left", indentLevel: 0 },
        content: [{ type: "text", text: "alpha beta gamma delta epsilon" }],
      }],
    },
  };
  const initialAnnotations = [
    { id: "comment-move", kind: "comment" as const, from: 7, to: 11 },
    { id: "change-move", kind: "change" as const, from: 12, to: 17 },
    { id: "chat-move", kind: "chat" as const, from: 18, to: 23 },
  ];
  let canonical = initial;
  let canonicalAnnotations = [...initialAnnotations];
  let revision = 0;
  const syncOptions = {
    companyID: "company-annotation-edit", resourceType: "node" as const,
    resourceID: "resource-annotation-edit", documentID: "document-annotation-edit",
    requestJSON: async <T>(_path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      if (init?.method !== "POST") return { revision, schema_version: 1, document: canonical, annotations: canonicalAnnotations } as T;
      const body = init.json as { operation_id: string; document: MangoTiptapDocument; annotations: typeof canonicalAnnotations };
      revision += 1;
      canonical = body.document;
      canonicalAnnotations = body.annotations;
      return saveAcknowledgement(body.operation_id, revision) as T;
    },
    onDocument: () => undefined,
    batchMs: 60_000,
    maxBatchMs: 60_000,
  };
  const sync = new MangoTiptapSync(syncOptions);
  const makeEditor = (elementID: string, value: MangoTiptapDocument, annotations: typeof initialAnnotations) => {
    const editor = new MangoTiptapEditorEngine({
      element: dom.window.document.querySelector<HTMLElement>(`#${elementID}`),
      extensions: createMangoTiptapExtensions({ editable: true }),
      content: value.document,
      enableContentCheck: true,
    });
    editor.registerPlugin(MangoTiptapAnnotations);
    updateMangoTiptapAnnotations(editor, annotations);
    return editor;
  };
  let first: MangoTiptapEditorEngine | undefined;
  let second: MangoTiptapEditorEngine | undefined;
  let third: MangoTiptapEditorEngine | undefined;
  try {
    await sync.start();
    first = makeEditor("first", initial, initialAnnotations);
    assert.equal(first.commands.insertContentAt(1, "PREFIX "), true);
    const insertedAnnotations = [...readMappedMangoTiptapAnnotations(first)].map(({ id, kind, from, to }) => ({ id, kind, from, to }));
    for (let index = 0; index < initialAnnotations.length; index += 1) {
      assert.equal(insertedAnnotations[index].from, initialAnnotations[index].from + 7);
      assert.equal(insertedAnnotations[index].to, initialAnnotations[index].to + 7);
    }
    const insertedDocument: MangoTiptapDocument = { format: "mango-tiptap-json", schema_version: 1, document: first.getJSON() };
    sync.schedule(insertedDocument, false, () => insertedAnnotations);
    await sync.flush();
    first.destroy();
    first = undefined;

    second = makeEditor("second", canonical, canonicalAnnotations);
    const expectedHighlightedText = new Map([
      ["comment-move", "beta"],
      ["chat-move", "delta"],
    ]);
    for (const [id, expectedText] of expectedHighlightedText) {
      const highlight = dom.window.document.querySelector<HTMLElement>(`#second [data-mango-annotation-id="${id}"]`);
      assert.equal(highlight?.textContent, expectedText, `${id} should remount over the moved text`);
    }
    assert.equal(dom.window.document.querySelector('#second [data-mango-annotation-id="change-move"]'), null);

    const movedComment = readMappedMangoTiptapAnnotations(second).find((annotation) => annotation.id === "comment-move");
    assert.ok(movedComment);
    assert.equal(second.commands.deleteRange({ from: movedComment!.from - 1, to: movedComment!.to + 1 }), true);
    const afterDeleteAnnotations = [...readMappedMangoTiptapAnnotations(second)].map(({ id, kind, from, to }) => ({ id, kind, from, to }));
    assert.equal(afterDeleteAnnotations.some((annotation) => annotation.id === "comment-move"), false, "deleting across a highlight removes that annotation");
    assert.equal(afterDeleteAnnotations.some((annotation) => annotation.id === "change-move"), true);
    assert.equal(afterDeleteAnnotations.some((annotation) => annotation.id === "chat-move"), true);
    const afterDeleteDocument: MangoTiptapDocument = { format: "mango-tiptap-json", schema_version: 1, document: second.getJSON() };
    sync.schedule(afterDeleteDocument, false, () => afterDeleteAnnotations);
    await sync.flush();
    second.destroy();
    second = undefined;

    third = makeEditor("third", canonical, canonicalAnnotations as typeof initialAnnotations);
    assert.equal(dom.window.document.querySelector('#third [data-mango-annotation-id="comment-move"]'), null);
    assert.equal(dom.window.document.querySelector('#third [data-mango-annotation-id="change-move"]'), null);
    assert.equal(dom.window.document.querySelector<HTMLElement>('#third [data-mango-annotation-id="chat-move"]')?.textContent, "delta");
    assert.equal(await readExactMangoTiptapPending(mangoTiptapPendingStorageKey(syncOptions)), null);
  } finally {
    first?.destroy();
    second?.destroy();
    third?.destroy();
    await sync.shutdown();
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});
test("workspace format gate is one coherent cached decision and rejects partial JSON readiness", async () => {
  clearMangoEditorDataFormatCacheForTests();
  let requests = 0;
  const request = async <T>(): Promise<T> => {
    requests += 1;
    return {
      company_id: "company-1", editor_format: "tiptap_json", migration_state: "ready",
      document_schema_version: 1, expected_document_count: 4, converted_document_count: 4,
    } as T;
  };
  const [left, right] = await Promise.all([
    loadMangoEditorDataFormat("https://api.test", "company-1", request),
    loadMangoEditorDataFormat("https://api.test", "company-1", request),
  ]);
  assert.equal(requests, 1);
  assert.equal(left, right);
  clearMangoEditorDataFormatCacheForTests();
  await assert.rejects(() => loadMangoEditorDataFormat("https://api.test", "company-1", async <T>() => ({
    company_id: "company-1", editor_format: "tiptap_json", migration_state: "ready",
    document_schema_version: 1, expected_document_count: 4, converted_document_count: 3,
  } as T)), /conversion_incomplete/);
});

test("Tiptap sync durably records one exact document before network completion", async () => {
  const previous = {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    sessionStorage: globalThis.sessionStorage,
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
  resetEditorRuntimeMetricsForTests();
  let releaseCommit: (() => void) | undefined;
  let postStarted = false;
  let canonicalReads = 0;
  const next = richDocument("durable");
  const canonical: MangoTiptapSnapshot = {
    revision: 0, schema_version: 1, document: createEmptyMangoTiptapDocument(),
  };
  const request = async <T>(_path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    if (init?.method !== "POST") {
      canonicalReads += 1;
      return canonical as T;
    }
    postStarted = true;
    const body = init.json as { operation_id: string };
    await new Promise<void>((resolve) => { releaseCommit = resolve; });
    return saveAcknowledgement(body.operation_id, 1) as T;
  };
  const options = {
    companyID: "company-durable", resourceType: "node" as const,
    resourceID: "resource-1", documentID: "document-1", requestJSON: request,
    onDocument: () => undefined, batchMs: 0, maxBatchMs: 10,
  };
  const sync = new MangoTiptapSync(options);
  try {
    await sync.start();
    await Promise.all([sync.recover(), sync.recover()]);
    assert.equal(canonicalReads, 2, "overlapping exact recoveries share one canonical request");
    let snapshotReads = 0;
    for (let index = 0; index < 25; index += 1) {
      sync.schedule(() => {
        snapshotReads += 1;
        return next;
      });
    }
    for (let count = 0; count < 100 && !postStarted; count += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(postStarted, true);
    assert.equal(snapshotReads, 1, "a transaction burst reads one complete JSON snapshot at the batch boundary");
    assert.equal(getEditorRuntimeMetrics().full_document_serializations, 1);
    assert.equal(getEditorRuntimeMetrics().indexeddb_writes, 1, "a transaction burst writes one pending IndexedDB record");
    const key = mangoTiptapPendingStorageKey(options);
    const pending = await readExactMangoTiptapPending(key);
    assert.ok((pending?.generation ?? 0) > 0);
    assert.deepEqual(pending?.document, next);
    releaseCommit?.();
    await sync.flush();
    assert.equal(await readExactMangoTiptapPending(key), null);
  } finally {
    releaseCommit?.();
    await sync.shutdown();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});

test("old queued IndexedDB work becomes one latest whole-document recovery record", async () => {
  const previous = {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  const storageKey = "company-legacy:node:resource-legacy:document-legacy";
  const older = richDocument("older queued document");
  const latest = richDocument("latest queued document");
  try {
    await writeRawMangoTiptapPending({
      storage_key: storageKey,
      company_id: "company-legacy",
      resource_type: "node",
      resource_id: "resource-legacy",
      document_id: "document-legacy",
      commits: [{
        operation_id: "operation-older",
        client_id: "client-legacy",
        base_revision: 4,
        document: older,
        annotations: [],
        created_at: 10,
        attempted: true,
      }, {
        operation_id: "operation-latest",
        client_id: "client-legacy",
        base_revision: 4,
        document: latest,
        annotations: [{ id: "comment-latest", kind: "comment", from: 2, to: 8 }],
        created_at: 20,
        attempted: false,
      }],
    });

    const recovered = await readExactMangoTiptapPending(storageKey);
    assert.equal(recovered?.record_version, 2);
    assert.equal(recovered?.operation_id, "operation-latest");
    assert.equal(recovered?.base_revision, 4);
    assert.deepEqual(recovered?.document, latest);
    assert.deepEqual(recovered?.annotations, [{ id: "comment-latest", kind: "comment", from: 2, to: 8 }]);
    assert.equal("commits" in (recovered ?? {}), false);
    assert.deepEqual(await readExactMangoTiptapPending(storageKey), recovered, "the migrated whole-document record is stable on its next read");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});

test("stale invalid Project recovery is repaired before its save is retried", async () => {
  const previous = {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    sessionStorage: globalThis.sessionStorage,
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });

  const optionsIdentity = {
    companyID: "company-costco",
    resourceType: "project" as const,
    resourceID: "costco-project",
    documentID: "costco-textbox",
  };
  const storageKey = mangoTiptapPendingStorageKey(optionsIdentity);
  const staleDocument: MangoTiptapDocument = {
    format: "mango-tiptap-json",
    schema_version: 1,
    document: {
      type: "doc",
      content: [{
        type: "paragraph",
        attrs: { blockId: "repeated-project-block" },
        content: [{
          type: "mangoEntityLink",
          attrs: { entityId: "node-1", label: "Temp Admin Candidates" },
        }],
      }, {
        type: "paragraph",
        attrs: { blockId: "repeated-project-block" },
        content: [{ type: "text", text: "Unsaved Costco notes" }],
      }],
    },
  };
  await writeRawMangoTiptapPending({
    record_version: 2,
    storage_key: storageKey,
    company_id: optionsIdentity.companyID,
    resource_type: optionsIdentity.resourceType,
    resource_id: optionsIdentity.resourceID,
    document_id: optionsIdentity.documentID,
    document: staleDocument,
    annotations: [],
    generation: 7,
    operation_id: "old-invalid-operation",
    client_id: "old-client",
    base_revision: 50,
    captured_at: 1,
  });

  let posted: {
    operation_id: string;
    base_revision: number;
    document: MangoTiptapDocument;
  } | undefined;
  let recovered: MangoTiptapDocument | undefined;
  const sync = new MangoTiptapSync({
    ...optionsIdentity,
    repairRecoveredDocument: repairMangoTiptapRecoveredDocument,
    requestJSON: async <T>(_path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      if (init?.method !== "POST") {
        return {
          revision: 50,
          schema_version: 1,
          document: createEmptyMangoTiptapDocument(),
          annotations: [],
        } as T;
      }
      posted = init.json as typeof posted;
      return saveAcknowledgement(posted?.operation_id ?? "", 51) as T;
    },
    onDocument: (document, source) => {
      if (source === "recovery") recovered = document;
    },
    batchMs: 60_000,
    maxBatchMs: 60_000,
  });

  try {
    await sync.start();
    const postedRequest = posted as {
      operation_id: string;
      base_revision: number;
      document: MangoTiptapDocument;
    };
    assert.ok(postedRequest);
    assert.notEqual(postedRequest.operation_id, "old-invalid-operation", "a changed retry must use a fresh operation ID");
    assert.equal(postedRequest.base_revision, 50);
    const postedBlockIDs = mangoBlockIDs(postedRequest.document.document);
    assert.equal(new Set(postedBlockIDs).size, postedBlockIDs.length);
    assert.equal(
      postedRequest.document.document.content?.[0]?.content?.[0]?.attrs?.entityType,
      "node",
      "the old compacted Node type must be restored before retry",
    );
    assert.deepEqual(recovered, postedRequest.document);
    assert.equal(await readExactMangoTiptapPending(storageKey), null);
  } finally {
    await sync.shutdown();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});

test("lost acknowledgement recovery replays the stable operation before conflict detection", async () => {
  const previous = {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    sessionStorage: globalThis.sessionStorage,
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
  const original = createEmptyMangoTiptapDocument();
  const edited = repairMangoTiptapRecoveredDocument(richDocument("accepted despite a lost response"));
  const annotations = [
    { id: "comment-1", kind: "comment" as const, from: 3, to: 9 },
    { id: "change-1", kind: "change" as const, from: 10, to: 14 },
    { id: "chat-1", kind: "chat" as const, from: 15, to: 19 },
  ];
  let revision = 0;
  let canonical = original;
  let canonicalAnnotations = [] as typeof annotations;
  let acceptedOperationID = "";
  let loseFirstAcknowledgement = true;
  let conflicts = 0;
  const request = async <T>(_path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    if (init?.method !== "POST") {
      return { revision, schema_version: 1, document: canonical, annotations: canonicalAnnotations } as T;
    }
    const body = init.json as {
      operation_id: string;
      base_revision: number;
      document: MangoTiptapDocument;
      annotations: typeof annotations;
    };
    if (body.operation_id === acceptedOperationID) {
      return saveAcknowledgement(body.operation_id, revision, true) as T;
    }
    assert.equal(body.base_revision, revision);
    acceptedOperationID = body.operation_id;
    revision += 1;
    canonical = body.document;
    canonicalAnnotations = body.annotations;
    if (loseFirstAcknowledgement) {
      loseFirstAcknowledgement = false;
      throw new Error("connection closed after commit");
    }
    return saveAcknowledgement(body.operation_id, revision) as T;
  };
  const options = {
    companyID: "company-lost-ack", resourceType: "node" as const,
    resourceID: "resource-lost-ack", documentID: "document-lost-ack", requestJSON: request,
    repairRecoveredDocument: repairMangoTiptapRecoveredDocument,
    onDocument: () => undefined, onConflict: () => { conflicts += 1; }, batchMs: 60_000, maxBatchMs: 60_000,
  };
  const first = new MangoTiptapSync(options);
  const second = new MangoTiptapSync({ ...options, onAnnotations: (next) => { canonicalAnnotations = [...next] as typeof annotations; } });
  try {
    await first.start();
    first.schedule(edited, false, () => annotations);
    await assert.rejects(() => first.flush(), /connection closed/);
    assert.equal(revision, 1, "the server accepted the operation before its response was lost");
    assert.ok(await readExactMangoTiptapPending(mangoTiptapPendingStorageKey(options)));

    await second.start();
    assert.equal(conflicts, 0, "replaying an accepted stable operation is an acknowledgement, not a conflict");
    assert.equal(await readExactMangoTiptapPending(mangoTiptapPendingStorageKey(options)), null);
    assert.deepEqual(canonicalAnnotations, annotations);
  } finally {
    await second.shutdown();
    await first.shutdown();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});

test("an attempted lost-ack operation stays immutable while later typing becomes a new operation", async () => {
  const previous = {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    sessionStorage: globalThis.sessionStorage,
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
  const initial = createEmptyMangoTiptapDocument();
  const operationADocument = richDocument("operation A accepted before its acknowledgement was lost");
  const operationBDocument = richDocument("later text saved by operation B");
  const operationAAnnotations = [{ id: "comment-a", kind: "comment" as const, from: 2, to: 8 }];
  const operationBAnnotations = [{ id: "comment-a", kind: "comment" as const, from: 7, to: 13 }];
  const acceptedPayloads = new Map<string, string>();
  const requestAttempts: Array<{ operationID: string; payload: string }> = [];
  const acceptedOperationIDs: string[] = [];
  let revision = 0;
  let canonical = initial;
  let canonicalAnnotations = [] as typeof operationAAnnotations;
  let firstAcceptedOperationID = "";
  let loseFirstAcknowledgement = true;
  let conflicts = 0;
  const saveStates: MangoTiptapSaveState[] = [];
  const lifecycle = new MangoEditorLifecycle();
  lifecycle.activate();
  lifecycle.markDirty();
  const request = async <T>(_path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    if (init?.method !== "POST") {
      return { revision, schema_version: 1, document: canonical, annotations: canonicalAnnotations } as T;
    }
    const body = init.json as {
      operation_id: string;
      base_revision: number;
      document: MangoTiptapDocument;
      annotations: typeof operationAAnnotations;
    };
    const payload = JSON.stringify(body);
    requestAttempts.push({ operationID: body.operation_id, payload });
    const acceptedPayload = acceptedPayloads.get(body.operation_id);
    if (acceptedPayload !== undefined) {
      assert.equal(payload, acceptedPayload, "a retry must preserve every stable-operation payload field");
      return saveAcknowledgement(body.operation_id, revision, true) as T;
    }
    assert.equal(body.base_revision, revision);
    acceptedPayloads.set(body.operation_id, payload);
    acceptedOperationIDs.push(body.operation_id);
    revision += 1;
    canonical = body.document;
    canonicalAnnotations = body.annotations;
    if (loseFirstAcknowledgement) {
      loseFirstAcknowledgement = false;
      firstAcceptedOperationID = body.operation_id;
      throw new Error("operation A response was lost after commit");
    }
    return saveAcknowledgement(body.operation_id, revision) as T;
  };
  const options = {
    companyID: "company-lost-ack-later-typing", resourceType: "node" as const,
    resourceID: "resource-lost-ack-later-typing", documentID: "document-lost-ack-later-typing",
    requestJSON: request,
    onDocument: () => undefined,
    onConflict: () => { conflicts += 1; },
    onPendingChange: (count: number) => lifecycle.setPendingCount(count),
    onSaveStateChange: (state: MangoTiptapSaveState) => saveStates.push(state),
    batchMs: 60_000,
    maxBatchMs: 60_000,
  };
  const sync = new MangoTiptapSync(options);
  const storageKey = mangoTiptapPendingStorageKey(options);
  try {
    await sync.start();
    sync.schedule(operationADocument, false, () => operationAAnnotations);
    await assert.rejects(() => sync.flush(), /response was lost/);
    assert.equal(saveStates[saveStates.length - 1]?.status, "failed");
    assert.equal(saveStates[saveStates.length - 1]?.unresolvedFailure, true);
    const statesAfterFailure = saveStates.length;
    const failureMessage = saveStates[saveStates.length - 1]?.message;
    const pendingAfterA = await readExactMangoTiptapPending(storageKey);
    assert.ok((pendingAfterA?.generation ?? 0) > 0);
    assert.equal(pendingAfterA?.operation_id, firstAcceptedOperationID);

    assert.deepEqual(pendingAfterA?.document, operationADocument);

    sync.schedule(operationBDocument, false, () => operationBAnnotations);
    await sync.flush();

    assert.equal(conflicts, 0);
    assert.equal(revision, 2);
    assert.deepEqual(canonical, operationBDocument);
    assert.deepEqual(canonicalAnnotations, operationBAnnotations);
    assert.equal(acceptedOperationIDs.length, 2);
    assert.notEqual(acceptedOperationIDs[0], acceptedOperationIDs[1], "later typing must receive a new operation ID");
    const operationAAttempts = requestAttempts.filter((attempt) => attempt.operationID === firstAcceptedOperationID);
    assert.equal(operationAAttempts.length, 2);
    assert.equal(operationAAttempts[0].payload, operationAAttempts[1].payload);
    assert.equal(await readExactMangoTiptapPending(storageKey), null);
    assert.equal(lifecycle.getSnapshot().pendingCount, 0);
    assert.equal(lifecycle.getSnapshot().pinned, false);
    assert.equal(saveStates.length, statesAfterFailure, "successful text saves must not clear or replace the visible failure state");
    assert.equal(saveStates[saveStates.length - 1]?.status, "failed");
    assert.equal(saveStates[saveStates.length - 1]?.message, failureMessage);
    assert.equal(saveStates[saveStates.length - 1]?.unresolvedFailure, true);
    assert.deepEqual(readEditorSaveState(storageKey), saveStates[saveStates.length - 1], "the status icon keeps the same failure until refresh");
  } finally {
    await sync.shutdown();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});
test("automatic retry captures newer typing after the failed operation succeeds", async () => {
  const previous = {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    sessionStorage: globalThis.sessionStorage,
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
  const initial = createEmptyMangoTiptapDocument();
  const operationADocument = richDocument("operation A");
  const operationBDocument = richDocument("newer typing after operation A failed");
  let revision = 0;
  let canonical = initial;
  let firstOperationID = "";
  let firstOperationAttempts = 0;
  const acceptedOperationIDs: string[] = [];
  const request = async <T>(_path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    if (init?.method !== "POST") return { revision, schema_version: 1, document: canonical, annotations: [] } as T;
    const body = init.json as { operation_id: string; base_revision: number; document: MangoTiptapDocument };
    if (!firstOperationID) firstOperationID = body.operation_id;
    if (body.operation_id === firstOperationID) {
      firstOperationAttempts += 1;
      if (firstOperationAttempts === 1) throw new Error("temporary network failure");
    }
    assert.equal(body.base_revision, revision);
    acceptedOperationIDs.push(body.operation_id);
    revision += 1;
    canonical = body.document;
    return saveAcknowledgement(body.operation_id, revision) as T;
  };
  const options = {
    companyID: "company-automatic-retry", resourceType: "node" as const,
    resourceID: "resource-automatic-retry", documentID: "document-automatic-retry",
    requestJSON: request,
    onDocument: () => undefined,
    batchMs: 60_000,
    maxBatchMs: 60_000,
  };
  const sync = new MangoTiptapSync(options);
  try {
    await sync.start();
    sync.schedule(operationADocument);
    await assert.rejects(() => sync.flush(), /temporary network failure/);
    sync.schedule(operationBDocument);

    const deadline = Date.now() + 2_500;
    while (canonical !== operationBDocument && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.equal(firstOperationAttempts, 2, "the failed stable operation is retried once");
    assert.equal(revision, 2);
    assert.deepEqual(canonical, operationBDocument);
    assert.equal(acceptedOperationIDs.length, 2);
    assert.equal(acceptedOperationIDs[0], firstOperationID);
    assert.notEqual(acceptedOperationIDs[1], firstOperationID, "newer typing is captured as a new operation");
    assert.equal(await readExactMangoTiptapPending(mangoTiptapPendingStorageKey(options)), null);
  } finally {
    await sync.shutdown();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});

test("IndexedDB failure is explicit while server acknowledgement still releases pending work", async () => {
  const previous = {
    indexedDB: globalThis.indexedDB,
    sessionStorage: globalThis.sessionStorage,
  };
  delete (globalThis as Record<string, unknown>).indexedDB;
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
  const pendingCounts: number[] = [];
  const storageErrors: string[] = [];
  let revision = 0;
  const edited = richDocument("saved without browser recovery storage");
  const sync = new MangoTiptapSync({
    companyID: "company-idb-failure", resourceType: "logic_gate",
    resourceID: "resource-idb-failure", documentID: "document-idb-failure",
    requestJSON: async <T>(_path: string, init?: RequestInit & { json?: unknown }) => {
      if (init?.method !== "POST") return { revision, schema_version: 1, document: createEmptyMangoTiptapDocument(), annotations: [] } as T;
      const body = init.json as { operation_id: string };
      revision += 1;
      return saveAcknowledgement(body.operation_id, revision) as T;
    },
    onDocument: () => undefined,
    onPendingChange: (count) => pendingCounts.push(count),
    onRecoveryStorageError: (message) => storageErrors.push(message),
    batchMs: 60_000,
    maxBatchMs: 60_000,
  });
  try {
    await sync.start();
    sync.schedule(edited);
    await sync.flush();
    assert.equal(revision, 1, "canonical backend save still succeeds");
    assert.ok(storageErrors.some((message) => message.startsWith("Browser recovery storage failed:")));
    assert.ok(pendingCounts.includes(1));
    assert.equal(pendingCounts[pendingCounts.length - 1], 0, "backend acknowledgement releases the dirty-row pin despite storage cleanup failure");
  } finally {
    await sync.shutdown();
    if (previous.indexedDB === undefined) delete (globalThis as Record<string, unknown>).indexedDB;
    else Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: previous.indexedDB });
    if (previous.sessionStorage === undefined) delete (globalThis as Record<string, unknown>).sessionStorage;
    else Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: previous.sessionStorage });
  }
});

test("IndexedDB quota write failure is visible and does not block acknowledgement unpin", async () => {
  const previous = {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    sessionStorage: globalThis.sessionStorage,
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function quotaFailure(): IDBRequest<IDBValidKey> {
    throw new DOMException("The pending document exceeds this browser quota", "QuotaExceededError");
  };
  const pendingCounts: number[] = [];
  const storageErrors: string[] = [];
  let storageRecoveries = 0;
  let conflicts = 0;
  let revision = 0;
  const edited = richDocument("saved after quota failure");
  const sync = new MangoTiptapSync({
    companyID: "company-idb-quota", resourceType: "project",
    resourceID: "resource-idb-quota", documentID: "document-idb-quota",
    requestJSON: async <T>(_path: string, init?: RequestInit & { json?: unknown }) => {
      if (init?.method !== "POST") return { revision, schema_version: 1, document: createEmptyMangoTiptapDocument(), annotations: [] } as T;
      const body = init.json as { operation_id: string };
      revision += 1;
      return saveAcknowledgement(body.operation_id, revision) as T;
    },
    onDocument: () => undefined,
    onPendingChange: (count) => pendingCounts.push(count),
    onRecoveryStorageError: (message) => storageErrors.push(message),
    onRecoveryStorageRecovered: () => { storageRecoveries += 1; },
    onConflict: () => { conflicts += 1; },
    batchMs: 60_000,
    maxBatchMs: 60_000,
  });
  try {
    await sync.start();
    sync.schedule(edited);
    await sync.flush();
    assert.equal(revision, 1);
    assert.ok(storageErrors.some((message) => message.includes("pending document exceeds this browser quota")));
    assert.ok(pendingCounts.includes(1));
    assert.equal(pendingCounts[pendingCounts.length - 1], 0);
    assert.equal(conflicts, 0, "a storage failure is not a document conflict");
    IDBObjectStore.prototype.put = originalPut;
    await sync.recover();
    assert.equal(storageRecoveries, 1, "a later successful recovery read clears the storage warning");
    assert.equal(conflicts, 0);
  } finally {
    IDBObjectStore.prototype.put = originalPut;
    await sync.shutdown();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});

test("IndexedDB cleanup failure after acknowledgement unpins and clears after storage recovers", async () => {
  const previous = {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    sessionStorage: globalThis.sessionStorage,
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
  const originalDelete = IDBObjectStore.prototype.delete;
  const pendingCounts: number[] = [];
  const storageErrors: string[] = [];
  let storageRecoveries = 0;
  let conflicts = 0;
  let revision = 0;
  let canonical = createEmptyMangoTiptapDocument();
  let acceptedOperationID = "";
  const edited = richDocument("backend acknowledged before IndexedDB cleanup failed");
  const options = {
    companyID: "company-idb-cleanup", resourceType: "node" as const,
    resourceID: "resource-idb-cleanup", documentID: "document-idb-cleanup",
    requestJSON: async <T>(_path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      if (init?.method !== "POST") return { revision, schema_version: 1, document: canonical, annotations: [] } as T;
      const body = init.json as { operation_id: string; document: MangoTiptapDocument };
      if (body.operation_id === acceptedOperationID) {
        return saveAcknowledgement(body.operation_id, revision, true) as T;
      }
      acceptedOperationID = body.operation_id;
      revision += 1;
      canonical = body.document;
      return saveAcknowledgement(body.operation_id, revision) as T;
    },
    onDocument: () => undefined,
    onPendingChange: (count: number) => pendingCounts.push(count),
    onRecoveryStorageError: (message: string) => storageErrors.push(message),
    onRecoveryStorageRecovered: () => { storageRecoveries += 1; },
    onConflict: () => { conflicts += 1; },
    batchMs: 60_000,
    maxBatchMs: 60_000,
  };
  const sync = new MangoTiptapSync(options);
  const storageKey = mangoTiptapPendingStorageKey(options);
  try {
    await sync.start();
    IDBObjectStore.prototype.delete = function cleanupFailure(): IDBRequest<undefined> {
      throw new DOMException("The acknowledged pending record could not be removed", "UnknownError");
    };
    sync.schedule(edited);
    await sync.flush();
    assert.equal(revision, 1);
    assert.deepEqual(canonical, edited);
    assert.ok(storageErrors.some((message) => message.includes("acknowledged pending record could not be removed")));
    assert.equal(pendingCounts[pendingCounts.length - 1], 0, "server acknowledgement releases pin ownership before cleanup");
    assert.equal(conflicts, 0);
    assert.ok(await readExactMangoTiptapPending(storageKey), "the stale recovery record remains available for exact replay");

    IDBObjectStore.prototype.delete = originalDelete;
    await sync.recover();
    assert.equal(storageRecoveries, 1);
    assert.equal(conflicts, 0);
    assert.equal(await readExactMangoTiptapPending(storageKey), null);
    assert.equal(pendingCounts[pendingCounts.length - 1], 0);
  } finally {
    IDBObjectStore.prototype.delete = originalDelete;
    await sync.shutdown();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});
test("Node, Project, and Logic Gate editors use revisioned JSON while email stays HTML", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  assert.match(read("frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), /useMangoEditorDataFormat/);
  assert.doesNotMatch(read("frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"), /MangoTiptapEditor|useMangoEditorDataFormat|tiptap_json/);
  assert.match(read("frontend/src/modules/editor/EditorContent.tsx"), /useMangoEditorDataFormat/);
  const editorContent = read("frontend/src/modules/editor/EditorContent.tsx");
  const legacyPersistence = read("frontend/src/modules/editor/useEditorDocumentPersistence.ts");
  assert.match(editorContent, /editorFormat: editorDataFormat\.gate\?\.editor_format \?\? ""/);
  assert.doesNotMatch(editorContent, /legacy_html|editor-collaboration/);
  assert.match(editorContent, /documentInformationIDRef\.current = informationID;[\s\S]*documentDraftRef\.current = "";[\s\S]*persistedDocumentRef\.current = "";/);
  assert.match(editorContent, /currentTextBox\?\.information_id\?\.trim\(\) \|\| LOGIC_GATE_OVERVIEW_DOCUMENT_ID/);
  assert.doesNotMatch(editorContent, /NodeV2|nodeV2|VITE_NODE_V2/);
  assert.match(legacyPersistence, /const permanentJSONPersistence/);
  assert.doesNotMatch(legacyPersistence, /legacy_html|editor-collaboration|requestJSON|fetch\(/);
  const packageJSON = JSON.parse(read("frontend/package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const runtimeDependencies = JSON.stringify(packageJSON.dependencies ?? {}).toLowerCase();
  assert.doesNotMatch(runtimeDependencies, /hocuspocus|yjs|y-indexeddb|extension-collaboration|y-tiptap/);
  assert.doesNotMatch(JSON.stringify(packageJSON.devDependencies ?? {}).toLowerCase(), /hocuspocus|yjs|y-indexeddb/);
  for (const runtimePath of [
    "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx",
    "frontend/src/modules/editor/EditorContent.tsx",
    "frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx",
    "frontend/src/modules/editor/tiptap/mangoTiptapSync.ts",
  ]) {
    assert.doesNotMatch(read(runtimePath).toLowerCase(), /hocuspocus|from ["']yjs["']|tiptap-cloud/);
  }
  const sync = read("frontend/src/modules/editor/tiptap/mangoTiptapSync.ts");
  assert.match(sync, /store\.get\(storageKey\)/);
  assert.doesNotMatch(sync, /getAll\(/);
  assert.doesNotMatch(sync, /commits:/);
  assert.doesNotMatch(sync, /JSON\.stringify/);
  const extensions = read("frontend/src/modules/editor/tiptap/mangoTiptapExtensions.ts");
  assert.match(extensions, /mangoBlockEntries\(newState\.doc, changedRanges\)/);
  assert.match(extensions, /updatedMangoBlockIDCounts/);
  assert.match(extensions, /trailingNode:\s*false/);
  assert.doesNotMatch(extensions, /newState\.doc\.descendants/);
  const editor = read("frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx");
  assert.match(editor, /data-mango-editor-sync-mode="revisioned-json"/);
  assert.doesNotMatch(editor, /JSON\.stringify/);
  assert.doesNotMatch(editor, /onSaveStateChange\?\.\(\{ status: "pending"/);
  assert.match(editor, /const \[activeEditor, setActiveEditor\] = useState<Editor \| null>\(null\)/);
  assert.match(editor, /useLayoutEffect\(\(\) => \{\s*if \(!isActive \|\| editorRef\.current\) return undefined;/);
  assert.match(editor, /\{isActive && activeEditor && \(\s*<EditorContent\s+editor=\{activeEditor\}/);
  assert.match(editor, /data-mango-tiptap-live-ready=/);
  assert.match(editor, /data-mango-tiptap-activation-cover/);
  assert.match(editor, /activateFromPointer/);
  assert.match(editor, /if \(event\.button !== 0\) return;\s*event\.preventDefault\(\);/);
  assert.match(editor, />Keep my version<\/button>/);
  assert.match(editor, />Use saved version<\/button>/);
  const communications = read("frontend/src/modules/communications/communicationsApi.ts");
  assert.doesNotMatch(communications, /mangoTiptap|tiptap_json|editor_format/);
});

test("visible refresh waits for an active recovery and then reads canonical state again", async () => {
  const previous = {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    sessionStorage: globalThis.sessionStorage,
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
  let canonicalReads = 0;
  let subscriptions = 0;
  let releaseInitialRead: () => void = () => undefined;
  let markInitialReadStarted: () => void = () => undefined;
  const initialReadStarted = new Promise<void>((resolve) => { markInitialReadStarted = resolve; });
  const initialReadBlocked = new Promise<void>((resolve) => { releaseInitialRead = resolve; });
  const sync = new MangoTiptapSync({
    companyID: "company-visible-race",
    resourceType: "node",
    resourceID: "node-visible-race",
    documentID: "document-visible-race",
    requestJSON: async <T>() => {
      canonicalReads += 1;
      if (canonicalReads === 1) {
        markInitialReadStarted();
        await initialReadBlocked;
      }
      return { revision: 0, schema_version: 1, document: createEmptyMangoTiptapDocument() } as T;
    },
    onDocument: () => undefined,
    subscribeToCanonicalChange: () => {
      subscriptions += 1;
      return () => undefined;
    },
  });
  try {
    const initialRecovery = sync.start();
    await initialReadStarted;
    sync.setRealtimeVisible(true);
    const visibleRefresh = sync.refreshCanonical();
    releaseInitialRead();
    await Promise.all([initialRecovery, visibleRefresh]);
    assert.equal(subscriptions, 1);
    assert.equal(canonicalReads, 2, "visibility queues one fresh canonical read after an in-flight recovery");
  } finally {
    releaseInitialRead();
    await sync.shutdown();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});

test("exact realtime scope exists only while the document is visibly eligible", async () => {
  const previous = {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    sessionStorage: globalThis.sessionStorage,
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
  let subscriptions = 0;
  let unsubscriptions = 0;
  let canonicalReads = 0;
  const sync = new MangoTiptapSync({
    companyID: "company-visible",
    resourceType: "project",
    resourceID: "project-1",
    documentID: "document-1",
    requestJSON: async <T>() => {
      canonicalReads += 1;
      return { revision: 0, schema_version: 1, document: createEmptyMangoTiptapDocument() } as T;
    },
    onDocument: () => undefined,
    subscribeToCanonicalChange: () => {
      subscriptions += 1;
      return () => { unsubscriptions += 1; };
    },
  });
  try {
    await sync.start();
    assert.equal(subscriptions, 0, "near-viewport recovery does not register the exact document scope");
    sync.setRealtimeVisible(true);
    await sync.recover();
    assert.equal(subscriptions, 1);
    assert.equal(canonicalReads, 2, "visible entry subscribes first and then refreshes canonical state");
    sync.setRealtimeVisible(false);
    assert.equal(unsubscriptions, 1);
    sync.setRealtimeVisible(false);
    assert.equal(unsubscriptions, 1, "visibility cleanup is idempotent");
  } finally {
    await sync.shutdown();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});

test("editor trace follows quiet-period scheduling through IndexedDB and save acknowledgement", async () => {
  const previous = {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    sessionStorage: globalThis.sessionStorage,
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
  startEditorTraceForTests();
  const traceContext = createEditorTraceContext({ resourceType: "node", documentLabel: "Node text" });
  assert.ok(traceContext);
  const sensitiveText = "private full document text";
  const document = richDocument(sensitiveText);
  let postCount = 0;
  const sync = new MangoTiptapSync({
    companyID: "company-trace",
    resourceType: "node",
    resourceID: "node-trace",
    documentID: "document-trace",
    traceContext,
    requestJSON: async <T>(_path: string, init?: RequestInit & { json?: unknown; editorTraceContext?: typeof traceContext }) => {
      assert.equal(init?.editorTraceContext, traceContext);
      if (init?.method === "POST") {
        postCount += 1;
        const json = init.json as { operation_id: string };
        return {
          operation_id: json.operation_id,
          revision: postCount,
          committed_at: "2026-07-30T00:00:00Z",
        } as T;
      }
      return {
        revision: 0,
        schema_version: 1,
        document: createEmptyMangoTiptapDocument(),
      } as T;
    },
    onDocument: () => undefined,
    batchMs: 60_000,
    maxBatchMs: 60_000,
  });

  try {
    await sync.start();
    sync.schedule(() => document);
    await sync.flush();
    await sync.shutdown();
    const exported = stopEditorTraceForTests();
    const names = new Set(exported.events.map((event) => event.name));
    for (const expected of [
      "sync.schedule",
      "sync.batch_timer.armed",
      "sync.batch_timer.cancelled",
      "sync.capture_scheduled_snapshot",
      "sync.snapshot_provider",
      "indexeddb.open",
      "indexeddb.pending.get",
      "indexeddb.pending.put",
      "indexeddb.pending.delete_if_operation",
      "sync.drain",
      "sync.save_state.published",
      "sync.pending_count.changed",
    ]) {
      assert.ok(names.has(expected), `missing trace event: ${expected}`);
    }
    assert.equal(postCount, 1);
    assert.equal(exported.open_spans.length, 0);
    assert.ok(!JSON.stringify(exported).includes(sensitiveText));
  } finally {
    resetEditorTraceForTests();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});
test("persisted dormant changes survive without a feature owner", () => {
  const merged = mergeMangoTiptapAnnotationPositions(
    [
      { id: "comment-owned", kind: "comment", from: 2, to: 4 },
      { id: "chat-owned", kind: "chat", from: 5, to: 8 },
    ],
    [
      { id: "comment-owned", kind: "comment", from: 3, to: 5 },
      { id: "chat-owned", kind: "chat", from: 6, to: 9 },
      { id: "change-dormant", kind: "change", from: 10, to: 14 },
      { id: "comment-unowned", kind: "comment", from: 15, to: 18 },
    ],
  );
  assert.deepEqual(merged, [
    { id: "comment-owned", kind: "comment", from: 3, to: 5 },
    { id: "chat-owned", kind: "chat", from: 6, to: 9 },
    { id: "change-dormant", kind: "change", from: 10, to: 14 },
  ]);
});

test("sleeping editor pointer activation preserves the clicked caret across the static-to-live swap", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='static'><p data-mango-block-id='block-1'><strong>Alpha</strong> beta</p></div><div id='live'><p data-mango-block-id='block-1'><span>Alpha</span> beta</p></div></body></html>");
  const document = dom.window.document;
  const staticRoot = document.querySelector<HTMLElement>("#static")!;
  const liveRoot = document.querySelector<HTMLElement>("#live")!;
  const clickedText = staticRoot.querySelector("strong")!.firstChild!;
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true,
    value: () => ({ offsetNode: clickedText, offset: 3 }),
  });

  const bookmark = captureMangoTiptapPointerBookmark(staticRoot, clickedText, { left: 120, top: 80 });
  assert.deepEqual(bookmark, { blockID: "block-1", textOffset: 3 });

  const resolved = resolveMangoTiptapPointerBookmark(liveRoot, bookmark!);
  assert.equal(resolved?.node.textContent, "Alpha");
  assert.equal(resolved?.offset, 3);
});
