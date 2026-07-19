import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IDBKeyRange, IDBObjectStore, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { JSDOM } from "jsdom";

import { MangoEditorLifecycle } from "../../../../frontend/src/modules/editor/editorLifecycle.js";
import {
  createEmptyMangoTiptapDocument,
  parseMangoTiptapDocument,
  validateMangoTiptapDocument,
  type MangoTiptapDocument,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapDocument.js";
import {
  MangoTiptapSync,
  mangoTiptapPendingStorageKey,
  readExactMangoTiptapPending,
  type MangoTiptapSnapshot,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapSync.js";
import {
  clearMangoEditorDataFormatCacheForTests,
  loadMangoEditorDataFormat,
} from "../../../../frontend/src/modules/editor/editorDataFormat.js";
import {
  createMangoTiptapExtensions,
  MangoTiptapEditorEngine,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapExtensions.js";
import {
  MangoTiptapAnnotations,
  navigateMangoTiptapTarget,
  readMappedMangoTiptapAnnotations,
  updateMangoTiptapAnnotations,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapAnnotations.js";
import {
  getEditorRuntimeMetrics,
  resetEditorRuntimeMetricsForTests,
} from "../../../../frontend/src/modules/editor/editorRuntimeMetrics.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

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

test("strict Mango Tiptap contract covers rich features and fails closed", () => {
  assert.equal(validateMangoTiptapDocument(richDocument()).valid, true);
  assert.equal(parseMangoTiptapDocument(JSON.stringify(richDocument())).valid, true);
  assert.equal(parseMangoTiptapDocument("<p>legacy HTML</p>").valid, false);
  const unknown = richDocument();
  unknown.document.content?.push({ type: "legacyHTML", attrs: { html: "<p>old</p>" } });
  assert.equal(validateMangoTiptapDocument(unknown).valid, false);
  const transient = richDocument();
  const image = transient.document.content?.[2];
  if (image?.attrs) image.attrs.alt = "blob:temporary";
  assert.equal(validateMangoTiptapDocument(transient).valid, false);
  const wrongVersion = { ...createEmptyMangoTiptapDocument(), schema_version: 2 };
  assert.equal(validateMangoTiptapDocument(wrongVersion).valid, false);
  const invalidNesting = richDocument();
  invalidNesting.document.content = [{ type: "tableRow", content: [] }];
  assert.equal(validateMangoTiptapDocument(invalidNesting).valid, false);
  const unsafeColor = richDocument();
  const markedText = unsafeColor.document.content?.[0]?.content?.[1];
  const textStyle = markedText?.marks?.find((mark) => mark.type === "textStyle");
  if (textStyle?.attrs) textStyle.attrs.color = "red;background:url(https://example.test)";
  assert.equal(validateMangoTiptapDocument(unsafeColor).valid, false);
  const oversizedImage = richDocument();
  const oversizedImageNode = oversizedImage.document.content?.[2];
  if (oversizedImageNode?.attrs) oversizedImageNode.attrs.displayWidth = 1_000_000;
  assert.equal(validateMangoTiptapDocument(oversizedImage).valid, false);
});

test("Tiptap owns commands, history, tables, positions, and annotation mapping", () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    Node: globalThis.Node,
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

    updateMangoTiptapAnnotations(editor, [{ id: "comment-1", kind: "comment", from: 2, to: 6 }]);
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
  } finally {
    editor.destroy();
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
    await new Promise<void>((resolve) => { releaseCommit = resolve; });
    return { revision: 1, schema_version: 1, document: next } as T;
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
    assert.equal(pending?.commits.length, 1);
    assert.deepEqual(pending?.commits[0]?.document, next);
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
  const edited = richDocument("accepted despite a lost response");
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
      return { revision, schema_version: 1, document: canonical, annotations: canonicalAnnotations, deduplicated: true } as T;
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
    return { revision, schema_version: 1, document: canonical, annotations: canonicalAnnotations } as T;
  };
  const options = {
    companyID: "company-lost-ack", resourceType: "node" as const,
    resourceID: "resource-lost-ack", documentID: "document-lost-ack", requestJSON: request,
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
      revision += 1;
      return { revision, schema_version: 1, document: edited, annotations: [] } as T;
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
    await sync.recover();
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
  let revision = 0;
  const edited = richDocument("saved after quota failure");
  const sync = new MangoTiptapSync({
    companyID: "company-idb-quota", resourceType: "project",
    resourceID: "resource-idb-quota", documentID: "document-idb-quota",
    requestJSON: async <T>(_path: string, init?: RequestInit & { json?: unknown }) => {
      if (init?.method !== "POST") return { revision, schema_version: 1, document: createEmptyMangoTiptapDocument(), annotations: [] } as T;
      revision += 1;
      return { revision, schema_version: 1, document: edited, annotations: [] } as T;
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
    assert.equal(revision, 1);
    assert.ok(storageErrors.some((message) => message.includes("pending document exceeds this browser quota")));
    assert.ok(pendingCounts.includes(1));
    assert.equal(pendingCounts[pendingCounts.length - 1], 0);
  } finally {
    IDBObjectStore.prototype.put = originalPut;
    await sync.shutdown();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});

test("non-email document surfaces share the gate and email stays on the HTML editor", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  assert.match(read("frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), /useMangoEditorDataFormat/);
  assert.doesNotMatch(read("frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"), /MangoTiptapEditor|useMangoEditorDataFormat|tiptap_json/);
  assert.match(read("frontend/src/modules/editor/EditorContent.tsx"), /useMangoEditorDataFormat/);
  const packageJSON = read("frontend/package.json").toLowerCase();
  assert.doesNotMatch(packageJSON, /hocuspocus|\byjs\b|tiptap-cloud/);
  const sync = read("frontend/src/modules/editor/tiptap/mangoTiptapSync.ts");
  assert.match(sync, /store\.get\(storage_key\)/);
  assert.doesNotMatch(sync, /getAll\(/);
  const editor = read("frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx");
  assert.match(editor, /const \[activeEditor, setActiveEditor\] = useState<Editor \| null>\(null\)/);
  assert.match(editor, /<EditorContent editor=\{activeEditor\}/);
  assert.match(editor, /activateFromPointer/);
  assert.match(editor, />Keep my version<\/button>/);
  assert.match(editor, />Use saved version<\/button>/);
  const communications = read("frontend/src/modules/communications/communicationsApi.ts");
  assert.doesNotMatch(communications, /mangoTiptap|tiptap_json|editor_format/);
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
