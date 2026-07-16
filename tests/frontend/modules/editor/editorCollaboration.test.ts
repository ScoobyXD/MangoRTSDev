import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { IDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";

import {
  applyEditorCollaborationDelta,
  cleanupLegacyEditorProjectionStorage,
  editorCollaborationDeltaForHTML,
  EDITOR_COLLABORATION_OPERATION_TARGET_BYTES,
  EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES,
  EditorCollaborationController,
  materializeEditorCollaborationState,
  newEditorCollaborationState,
  splitEditorCollaborationDelta,
  type EditorCollaborationSnapshot,
} from "../../../../frontend/src/modules/editor/editorCollaboration.js";
import {
  transformStructuredEditorOperation,
  type StructuredEditorOperation,
} from "../../../../frontend/src/modules/editor/editorStructuredDocument.js";
import {
  deserializeEditorDocumentHTML,
  EDITOR_RICH_TEXT_PREFIX,
} from "../../../../frontend/src/modules/editor/richTextEditing.js";
import type { RealtimeEditorDelta } from "../../../../frontend/src/modules/realtime/realtimeWebSocket.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

type InstalledDOM = {
  window: Window;
  renders: string[];
  restore: () => void;
};

function installEditorDOM(initialHTML = "A"): InstalledDOM {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    Node: globalThis.Node,
    HTMLElement: globalThis.HTMLElement,
    HTMLLIElement: globalThis.HTMLLIElement,
    HTMLUListElement: globalThis.HTMLUListElement,
    HTMLTableCellElement: globalThis.HTMLTableCellElement,
    HTMLSpanElement: globalThis.HTMLSpanElement,
  };
  const dom = new JSDOM("<!doctype html><div id=\"editor\"></div>", { url: "https://mango.test/" });
  const domGlobals = dom.window as unknown as typeof globalThis;
  const renders: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, "Node", { configurable: true, value: domGlobals.Node });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: domGlobals.HTMLElement });
  Object.defineProperty(globalThis, "HTMLLIElement", { configurable: true, value: domGlobals.HTMLLIElement });
  Object.defineProperty(globalThis, "HTMLUListElement", { configurable: true, value: domGlobals.HTMLUListElement });
  Object.defineProperty(globalThis, "HTMLTableCellElement", { configurable: true, value: domGlobals.HTMLTableCellElement });
  Object.defineProperty(globalThis, "HTMLSpanElement", { configurable: true, value: domGlobals.HTMLSpanElement });
  dom.window.document.querySelector("#editor")!.innerHTML = initialHTML;
  return {
    window: dom.window as unknown as Window,
    renders,
    restore: () => {
      dom.window.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
        else Object.defineProperty(globalThis, key, { configurable: true, value });
      }
    },
  };
}

function snapshot(revision: number, state: ReturnType<typeof newEditorCollaborationState>): EditorCollaborationSnapshot {
  return {
    revision,
    snapshot_revision: revision,
    state,
    html: materializeEditorCollaborationState(state),
    etag: `"editor-${revision}"`,
  };
}

class StructuredTestServer {
  state = newEditorCollaborationState("A");
  revision = 0;
  readonly operations: Array<{ revision: number; operationID: string; delta: RealtimeEditorDelta }> = [];
  private readonly dedupe = new Map<string, { operation_id: string; revision: number; delta: RealtimeEditorDelta; snapshot: EditorCollaborationSnapshot; deduplicated?: boolean }>();

  currentSnapshot(): EditorCollaborationSnapshot {
    return snapshot(this.revision, this.state);
  }

  commit(body: { operation_id: string; base_revision: number; delta: RealtimeEditorDelta }) {
    const found = this.dedupe.get(body.operation_id);
    if (found) return { ...found, deduplicated: true, snapshot: this.currentSnapshot() };
    let transformed = body.delta as StructuredEditorOperation;
    for (const operation of this.operations) {
      if (operation.revision > body.base_revision) {
        transformed = transformStructuredEditorOperation(operation.delta as StructuredEditorOperation, transformed, true);
      }
    }
    const delta = transformed as RealtimeEditorDelta;
    this.state = applyEditorCollaborationDelta(this.state, delta);
    this.revision += 1;
    this.operations.push({ revision: this.revision, operationID: body.operation_id, delta });
    const result = {
      operation_id: body.operation_id,
      revision: this.revision,
      delta,
      snapshot: this.currentSnapshot(),
    };
    this.dedupe.set(body.operation_id, result);
    return result;
  }
}

function controllerOptions(
  server: StructuredTestServer,
  documentID: string,
  overrides: Partial<ConstructorParameters<typeof EditorCollaborationController>[0]> = {},
) {
  return {
    apiBase: "https://mango.test",
    companyID: "company-1",
    currentUserID: "user-1",
    resourceType: "node" as const,
    resourceID: "node-1",
    documentID,
    initialHTML: "A",
    requestJSON: async <T,>(_path: string, init?: RequestInit) => {
      if (!init?.method) return server.currentSnapshot() as T;
      return server.commit(JSON.parse(String(init.body))) as T;
    },
    onHTML: () => undefined,
    subscribe: (() => () => undefined) as never,
    ...overrides,
  };
}

test("structured rich documents roundtrip with lists, formatting, tables, mentions, and attachment references", () => {
  const dom = installEditorDOM();
  try {
    const html = '<h2><strong>Bold</strong> <em>text</em></h2><ol><li>One</li></ol><p><span data-mention-user-id="u-1">@Ada</span></p><table data-mango-editor-table-id="t-1"><tbody><tr><td>A</td></tr></tbody></table><p><span data-mango-editor-image="true" data-mango-editor-attachment-id="attachment-1"><img data-mango-attachment-id="attachment-1" alt="diagram"></span></p>';
    const state = newEditorCollaborationState(html);
    const canonical = materializeEditorCollaborationState(state);
    for (const required of ["<h2>", "<strong>Bold</strong>", "<em>text</em>", "<ol", "data-mango-mention-user-id", "<table", "data-mango-editor-attachment-id"]) {
      assert.ok(canonical.includes(required), required);
    }
    assert.equal(materializeEditorCollaborationState(newEditorCollaborationState(canonical)), canonical);
  } finally {
    dom.restore();
  }
});

test("collaboration materialization renders rich markup and durable attachment images instead of literal HTML", () => {
  const dom = installEditorDOM();
  try {
    const stored = EDITOR_RICH_TEXT_PREFIX
      + '<br><span style="font-size: 14px; font-size: 14px;">Business Logic &quot;Email&quot;</span>'
      + '<span data-mango-editor-image="true" data-mango-editor-attachment-id="attachment-1">'
      + '<img src="mango-attachment:attachment-1" data-mango-attachment-id="attachment-1" alt="Diagram" width="320" height="180"></span>';
    const materialized = materializeEditorCollaborationState(newEditorCollaborationState(stored));

    assert.ok(materialized.startsWith(EDITOR_RICH_TEXT_PREFIX));
    const rendered = deserializeEditorDocumentHTML(materialized);
    const editor = dom.window.document.querySelector("#editor");
    if (!editor) {
      throw new Error("editor fixture was not mounted");
    }
    editor.innerHTML = rendered;

    assert.equal(editor.textContent?.includes("<br>"), false);
    assert.match(editor.textContent ?? "", /Business Logic "Email"/);
    const image = editor.querySelector("img");
    if (!image) {
      throw new Error("durable attachment image was not rendered");
    }
    const frame = image.parentElement;
    if (!frame) {
      throw new Error("durable attachment frame was not rendered");
    }
    assert.equal(image.getAttribute("src"), "mango-attachment:attachment-1");
    assert.equal(frame.getAttribute("data-mango-editor-attachment-id"), "attachment-1");
    assert.equal(image.getAttribute("alt"), "Diagram");
    assert.equal(frame.style.width, "320px");
    assert.equal(frame.style.height, "180px");
  } finally {
    dom.restore();
  }
});

test("recovery promotes already-corrupted Logic Gate markup and durably commits one stable repair", async () => {
  const dom = installEditorDOM();
  try {
    const broken = EDITOR_RICH_TEXT_PREFIX
      + "&lt;strong&gt;&lt;span style=\"font-size: 16px; font-size: 16px;\"&gt;nice prompt&lt;/span&gt;&lt;/strong&gt;"
      + "&lt;span style=\"font-size: 14px; font-size: 14px;\"&gt;review everything&lt;/span&gt;";
    const server = new StructuredTestServer();
    server.state = newEditorCollaborationState(broken);
    const renders: string[] = [];
    const controller = new EditorCollaborationController(controllerOptions(server, "legacy-escaped-logic-gate", {
      onHTML: (html) => renders.push(html),
    }));
    controller.start();
    await controller.recover();
    await controller.flush();

    assert.equal(server.revision, 1);
    assert.equal(server.operations[0]?.operationID, "legacy-escaped-rich-html-v1-0-0");
    const canonical = materializeEditorCollaborationState(server.state);
    assert.match(canonical, /<strong><span style="font-size: 16px;?">nice prompt<\/span><\/strong>/);
    assert.doesNotMatch(canonical, /font-size: 16px[^"]*font-size/);
    assert.doesNotMatch(canonical, /&lt;strong&gt;/);
    assert.ok(renders.length > 0);
    assert.ok(renders.every((html) => !html.includes("&lt;strong&gt;")));
    const editor = dom.window.document.querySelector("#editor");
    if (!editor) throw new Error("editor fixture was not mounted");
    editor.innerHTML = deserializeEditorDocumentHTML(renders[renders.length - 1]);
    assert.equal(editor.querySelectorAll("strong").length, 1);
    assert.equal(editor.textContent, "nice promptreview everything");
    controller.stop();
  } finally {
    dom.restore();

  }
});
test("structured OT converges formatting versus formatting and block versus inline formatting", () => {
  const dom = installEditorDOM();
  try {
    const initial = newEditorCollaborationState("<p>abcdef</p>");
    const bold = { ops: [{ retain: 1 }, { retain: 3, attributes: { bold: true } }] };
    const italic = { ops: [{ retain: 2 }, { retain: 3, attributes: { italic: true } }] };
    const heading = { ops: [{ retain: 6 }, { retain: 1, attributes: { block: "h2" } }] };
    for (const concurrent of [italic, heading]) {
      const first = applyEditorCollaborationDelta(
        applyEditorCollaborationDelta(initial, bold),
        transformStructuredEditorOperation(bold, concurrent, true) as RealtimeEditorDelta,
      );
      const second = applyEditorCollaborationDelta(
        applyEditorCollaborationDelta(initial, concurrent),
        transformStructuredEditorOperation(concurrent, bold, false) as RealtimeEditorDelta,
      );
      assert.equal(materializeEditorCollaborationState(first), materializeEditorCollaborationState(second));
      assert.equal(dom.window.document.createElement("div").textContent, "");
    }
  } finally {
    dom.restore();
  }
});

test("disjoint edits in a formerly shared large chunk converge without duplication, including astral Unicode", () => {
  const dom = installEditorDOM();
  try {
    const emoji = "\u{1F642}";
    const initial = newEditorCollaborationState("<p>" + "a".repeat(5000) + emoji + "b".repeat(5000) + "</p>");
    const left = { ops: [{ retain: 100 }, { insert: "LEFT" }] };
    const right = { ops: [{ retain: 5202 }, { insert: "RIGHT" }] };
    const first = applyEditorCollaborationDelta(applyEditorCollaborationDelta(initial, left), transformStructuredEditorOperation(left, right, true) as RealtimeEditorDelta);
    const second = applyEditorCollaborationDelta(applyEditorCollaborationDelta(initial, right), transformStructuredEditorOperation(right, left, false) as RealtimeEditorDelta);
    const firstHTML = materializeEditorCollaborationState(first);
    assert.equal(firstHTML, materializeEditorCollaborationState(second));
    assert.equal(firstHTML.match(/LEFT/g)?.length, 1);
    assert.equal(firstHTML.match(/RIGHT/g)?.length, 1);
    assert.equal(firstHTML.match(new RegExp(emoji, "gu"))?.length, 1);
  } finally {
    dom.restore();
  }
});

test("large rich paste is split into ordered bounded operations without truncation", () => {
  const dom = installEditorDOM();
  try {
    const html = '<p><strong>' + "Bold text ".repeat(120_000) + '</strong></p><ol><li>One</li><li>Two</li></ol><table><tbody><tr><td data-mention-user-id="user-2">@Ada</td></tr></tbody></table>';
    assert.ok(new TextEncoder().encode(html).byteLength > 1024 * 1024);
    assert.ok(new TextEncoder().encode(html).byteLength < EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES);
    const expected = materializeEditorCollaborationState(newEditorCollaborationState(html));
    const delta = editorCollaborationDeltaForHTML(newEditorCollaborationState(""), html);
    const parts = splitEditorCollaborationDelta(delta);
    assert.ok(parts.length > 1);
    let state = newEditorCollaborationState("");
    for (const part of parts) {
      assert.ok(new TextEncoder().encode(JSON.stringify(part)).byteLength <= EDITOR_COLLABORATION_OPERATION_TARGET_BYTES);
      state = applyEditorCollaborationDelta(state, part);
    }
    assert.equal(materializeEditorCollaborationState(state), expected);
  } finally {
    dom.restore();
  }
});

test("cleanup removes obsolete whole-body and v1 collaboration storage", () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  local.setItem("mango-editor-projection-draft-v2:old", "full body");
  local.setItem("mango-editor-collaboration-pending-v1:old", "raw html operation");
  session.setItem("mango-editor-projection-tab-v1", "tab");
  assert.equal(cleanupLegacyEditorProjectionStorage(local, session), 3);
  assert.equal(local.length, 0);
  assert.equal(session.length, 0);
});

test("storage unavailability rolls back visible content and never reports a pending save", async () => {
  const dom = installEditorDOM("A");
  try {
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    const server = new StructuredTestServer();
    const errors: string[] = [];
    const renders: string[] = [];
    const controller = new EditorCollaborationController(controllerOptions(server, "storage-failure", {
      onHTML: (html) => renders.push(html),
      onError: (cause) => errors.push(cause instanceof Error ? cause.message : String(cause)),
    }));
    controller.schedule("AL", true);
    await controller.flush();
    assert.deepEqual(renders, [EDITOR_RICH_TEXT_PREFIX + "A"]);
    assert.deepEqual(errors, ["editor_collaboration_storage_unavailable"]);
    assert.equal(server.revision, 0);
  } finally {
    dom.restore();
  }
});

test("IndexedDB quota failure rolls back visible content with a stable user-safe error", async () => {
  const dom = installEditorDOM("A");
  try {
    const quotaFactory = {
      open: () => {
        const request: {
          error: { name: string };
          onerror: null | (() => void);
          onblocked: null | (() => void);
          onupgradeneeded: null | (() => void);
          onsuccess: null | (() => void);
        } = {
          error: { name: "QuotaExceededError" },
          onerror: null,
          onblocked: null,
          onupgradeneeded: null,
          onsuccess: null,
        };
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    };
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: quotaFactory });
    const server = new StructuredTestServer();
    const errors: string[] = [];
    const renders: string[] = [];
    const controller = new EditorCollaborationController(controllerOptions(server, "quota-failure", {
      onHTML: (html) => renders.push(html),
      onError: (cause) => errors.push(cause instanceof Error ? cause.message : String(cause)),
    }));
    controller.schedule("AL", true);
    await controller.flush();
    assert.deepEqual(renders, [EDITOR_RICH_TEXT_PREFIX + "A"]);
    assert.deepEqual(errors, ["editor_collaboration_storage_quota_exceeded"]);
    assert.equal(server.revision, 0);
  } finally {
    dom.restore();
  }
});

test("oversized and sensitive visible edits roll back deterministically", () => {
  const dom = installEditorDOM("A");
  try {
    const server = new StructuredTestServer();
    const errors: string[] = [];
    const renders: string[] = [];
    const controller = new EditorCollaborationController(controllerOptions(server, "preflight", {
      onHTML: (html) => renders.push(html),
      onError: (cause) => errors.push(cause instanceof Error ? cause.message : String(cause)),
    }));
    controller.schedule('<img src="data:image/png;base64,AAAA">', true);
    controller.schedule("x".repeat(EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES + 1), true);
    assert.deepEqual(errors, ["editor_collaboration_sensitive_content_rejected", "editor_collaboration_document_too_large"]);
    assert.deepEqual(renders, [EDITOR_RICH_TEXT_PREFIX + "A", EDITOR_RICH_TEXT_PREFIX + "A"]);
  } finally {
    dom.restore();
  }
});

test("lost acknowledgement survives refresh, retries the stable operation, and deduplicates without visible duplication", async () => {
  const dom = installEditorDOM("A");
  try {
    const server = new StructuredTestServer();
    let loseAck = true;
    let retriedOperationID = "";
    const first = new EditorCollaborationController(controllerOptions(server, "lost-ack", {
      requestJSON: async <T,>(_path: string, init?: RequestInit) => {
        if (!init?.method) return server.currentSnapshot() as T;
        const body = JSON.parse(String(init.body));
        const committed = server.commit(body);
        retriedOperationID = body.operation_id;
        if (loseAck) {
          loseAck = false;
          throw new Error("acknowledgement_lost_after_commit");
        }
        return committed as T;
      },
    }));
    first.start();
    await first.recover();
    first.schedule("AL", true);
    await assert.rejects(first.flush(), /acknowledgement_lost_after_commit/);
    first.stop();

    const renders: string[] = [];
    let retryID = "";
    const second = new EditorCollaborationController(controllerOptions(server, "lost-ack", {
      initialHTML: "AL",
      onHTML: (html) => renders.push(html),
      requestJSON: async <T,>(_path: string, init?: RequestInit) => {
        if (!init?.method) return server.currentSnapshot() as T;
        const body = JSON.parse(String(init.body));
        retryID = body.operation_id;
        return server.commit(body) as T;
      },
    }));
    second.start();
    await second.recover();
    assert.equal(retryID, retriedOperationID);
    assert.equal(server.revision, 1);
    assert.equal(materializeEditorCollaborationState(server.state), EDITOR_RICH_TEXT_PREFIX + "AL");
    assert.ok(renders.every((html) => html === EDITOR_RICH_TEXT_PREFIX + "AL"));
    second.stop();
  } finally {
    dom.restore();
  }
});

test("snapshot-required during a durable batch refreshes canonical state and retries the same operation once", async () => {
  const dom = installEditorDOM("A");
  try {
    const server = new StructuredTestServer();
    const renders: string[] = [];
    let reads = 0;
    let posts = 0;
    let firstOperationID = "";
    let retriedOperationID = "";
    const controller = new EditorCollaborationController(controllerOptions(server, "snapshot-interleaving", {
      onHTML: (html) => renders.push(html),
      requestJSON: async <T,>(_path: string, init?: RequestInit) => {
        if (!init?.method) {
          reads += 1;
          return server.currentSnapshot() as T;
        }
        const body = JSON.parse(String(init.body));
        posts += 1;
        if (posts === 1) {
          firstOperationID = body.operation_id;
          throw new Error("collaboration_snapshot_required");
        }
        retriedOperationID = body.operation_id;
        assert.equal(body.base_revision, server.revision);
        return server.commit(body) as T;
      },
    }));
    controller.start();
    await controller.recover();
    const readsBeforeRetry = reads;
    controller.schedule("AL", true);
    await controller.flush();

    assert.equal(posts, 2);
    assert.equal(reads, readsBeforeRetry + 1);
    assert.equal(retriedOperationID, firstOperationID);
    assert.equal(server.revision, 1);
    assert.equal(materializeEditorCollaborationState(server.state), EDITOR_RICH_TEXT_PREFIX + "AL");
    assert.equal(renders[renders.length - 1], EDITOR_RICH_TEXT_PREFIX + "AL");
    controller.stop();
  } finally {
    dom.restore();
  }
});

test("separate tabs use different durable queue identities while refresh keeps the same tab identity", async () => {
  const dom = installEditorDOM("A");
  try {
    const server = new StructuredTestServer();
    const clientIDs: string[] = [];
    const make = (documentID: string) => new EditorCollaborationController(controllerOptions(server, documentID, {
      requestJSON: async <T,>(_path: string, init?: RequestInit) => {
        if (!init?.method) return server.currentSnapshot() as T;
        const body = JSON.parse(String(init.body));
        clientIDs.push(body.client_id);
        return server.commit(body) as T;
      },
    }));

    dom.window.name = "";
    const tabOne = make("tab-one");
    tabOne.schedule("A1", true);
    await tabOne.flush();
    const firstID = clientIDs[clientIDs.length - 1]!;

    const refresh = make("tab-one-refresh");
    refresh.schedule("A2", true);
    await refresh.flush();
    const refreshID = clientIDs[clientIDs.length - 1]!;

    dom.window.name = "";
    const tabTwo = make("tab-two");
    tabTwo.schedule("A3", true);
    await tabTwo.flush();
    const secondID = clientIDs[clientIDs.length - 1]!;

    assert.equal(refreshID, firstID);
    assert.notEqual(secondID, firstID);
  } finally {
    dom.restore();
  }
});
