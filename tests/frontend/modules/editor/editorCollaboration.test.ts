import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { IDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";

import {
  applyEditorHTMLPatch,
  cleanupLegacyEditorProjectionStorage,
  editorHTMLPatchForChange,
  EDITOR_COLLABORATION_OPERATION_TARGET_BYTES,
  EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES,
  EditorCollaborationController,
  splitEditorHTMLPatch,
  transformEditorHTMLPatch,
  type EditorCollaborationSnapshot,
} from "../../../../frontend/src/modules/editor/editorCollaboration.js";
import type {
  RealtimeEditorHTMLPatch,
  RealtimeEditorPatchCommittedMessage,
  RealtimeSubscriptionHandlers,
} from "../../../../frontend/src/modules/realtime/realtimeWebSocket.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

type InstalledDOM = { window: Window; editor: HTMLElement; restore: () => void };

function installEditorDOM(initialHTML = ""): InstalledDOM {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange,
    Node: globalThis.Node,
    HTMLElement: globalThis.HTMLElement,
  };
  const dom = new JSDOM('<!doctype html><div id="editor" contenteditable="true"></div>', { url: "https://mango.test/" });
  const domGlobals = dom.window as unknown as typeof globalThis;
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, "Node", { configurable: true, value: domGlobals.Node });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: domGlobals.HTMLElement });
  const editor = dom.window.document.querySelector<HTMLElement>("#editor")!;
  editor.innerHTML = initialHTML;
  return {
    window: dom.window as unknown as Window,
    editor,
    restore: () => {
      dom.window.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
        else Object.defineProperty(globalThis, key, { configurable: true, value });
      }
    },
  };
}

type ServerOperation = {
  revision: number;
  operationID: string;
  clientID: string;
  patch: RealtimeEditorHTMLPatch;
};
type CommitBody = {
  operation_id: string;
  client_id: string;
  base_revision: number;
  patch: RealtimeEditorHTMLPatch;
};
type TestCommit = {
  operation_id: string;
  event_id: string;
  revision: number;
  patch: RealtimeEditorHTMLPatch;
  concurrent_operations: Array<{
    revision: number;
    operation_id: string;
    client_id: string;
    patch: RealtimeEditorHTMLPatch;
  }>;
  deduplicated?: boolean;
};

class HTMLPatchTestServer {
  revision = 0;
  readonly operations: ServerOperation[] = [];
  readonly dedupe = new Map<string, TestCommit>();

  constructor(public html: string) {}

  currentSnapshot(): EditorCollaborationSnapshot {
    return { revision: this.revision, html: this.html, etag: `"editor-${this.revision}"` };
  }

  commit(body: CommitBody): TestCommit {
    const duplicate = this.dedupe.get(body.operation_id);
    if (duplicate) return { ...duplicate, deduplicated: true };
    const concurrent = this.operations.filter((operation) => operation.revision > body.base_revision);
    let transformed = body.patch;
    for (const operation of concurrent) transformed = transformEditorHTMLPatch(operation.patch, transformed, true);
    this.html = applyEditorHTMLPatch(this.html, transformed);
    this.revision += 1;
    this.operations.push({
      revision: this.revision,
      operationID: body.operation_id,
      clientID: body.client_id,
      patch: transformed,
    });
    const result: TestCommit = {
      operation_id: body.operation_id,
      event_id: `event-${this.revision}`,
      revision: this.revision,
      patch: transformed,
      concurrent_operations: concurrent.map((operation) => ({
        revision: operation.revision,
        operation_id: operation.operationID,
        client_id: operation.clientID,
        patch: operation.patch,
      })),
    };
    this.dedupe.set(body.operation_id, result);
    return result;
  }
}

class RealtimeBus {
  private readonly subscriptions = new Map<string, Set<RealtimeSubscriptionHandlers>>();

  subscribe = (_apiBase: string, _companyID: string, scope: string, handlers: RealtimeSubscriptionHandlers) => {
    const bucket = this.subscriptions.get(scope) ?? new Set<RealtimeSubscriptionHandlers>();
    bucket.add(handlers);
    this.subscriptions.set(scope, bucket);
    return () => bucket.delete(handlers);
  };

  publish(scope: string, commit: TestCommit, resourceType: "node" | "logic_gate" | "project" = "node"): void {
    const parts = scope.split(":");
    const message: RealtimeEditorPatchCommittedMessage = {
      type: "editor.delta.committed",
      company_id: "company-1",
      scope,
      event_id: commit.event_id,
      resource_type: resourceType,
      resource_id: parts[2]!,
      document_id: parts[3]!,
      resource_revision: commit.revision,
      operation_id: commit.operation_id,
      client_id: "server-client",
      patch: commit.patch,
    };
    for (const handlers of this.subscriptions.get(scope) ?? []) handlers.onEditorPatchCommitted?.(message);
  }
}

function controllerOptions(
  server: HTMLPatchTestServer,
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
    initialHTML: server.html,
    requestJSON: async <T,>(_path: string, init?: RequestInit) => {
      if (!init?.method) return server.currentSnapshot() as T;
      return server.commit(JSON.parse(String(init.body)) as CommitBody) as T;
    },
    onHTML: () => undefined,
    subscribe: (() => () => undefined) as never,
    ...overrides,
  };
}

async function eventually(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`timed out waiting for ${label}`);
}

const completeRichHTML = '<!-- mango-editor-html-v1 --><h2 style="text-align:center"><strong>Heading</strong></h2><p>First&nbsp; row<br>second</p><p><br></p><ul data-mango-editor-list="bullet"><li data-mango-editor-list-item="bullet">Bullet</li></ul><ul data-mango-editor-list="checklist"><li data-mango-editor-list-item="checklist" data-mango-editor-checklist-checked="true">✓ Checked</li></ul><ol><li>One</li><li style="margin-left:32px">Indented</li></ol><p><span style="font-size:18px;background-color:#fff59d"><em><u>Format</u></em></span> <a href="https://example.test">link</a> <span data-mango-mention="true" data-mango-mention-user-id="user-2" contenteditable="false">@Ada</span></p><table data-mango-editor-table-id="table-1"><tbody><tr><th>Key</th><td>Value</td></tr></tbody></table><p><span data-mango-editor-image="true" data-mango-editor-attachment-id="attachment-1"><img src="mango-attachment:attachment-1" data-mango-attachment-id="attachment-1" alt="diagram"></span></p>';

test("rich HTML patches preserve every supported structure and UTF-8 boundary exactly", () => {
  const next = completeRichHTML.replace("second", "second🙂 row");
  const patch = editorHTMLPatchForChange(completeRichHTML, next);
  assert.equal(applyEditorHTMLPatch(completeRichHTML, patch), next);
  assert.throws(
    () => applyEditorHTMLPatch("<p>🙂</p>", { start_utf8: 4, delete_utf8: 1, insert: "x" }),
    /breaks_utf8/,
  );
  const dom = installEditorDOM(next);
  try {
    assert.equal(dom.editor.querySelectorAll("h2, p, ul, ol, li, table, a, img").length, 15);
    assert.equal(dom.editor.textContent?.includes("<strong>"), false);
    assert.equal(dom.editor.querySelector("img")?.getAttribute("data-mango-attachment-id"), "attachment-1");
  } finally {
    dom.restore();
  }
});

test("large pasted rich HTML is split into ordered bounded patches without translation or truncation", () => {
  const html = '<!-- mango-editor-html-v1 --><p><strong>' + "Bold🙂 text ".repeat(100_000) + "</strong></p><ol><li>One</li><li>Two</li></ol><table><tbody><tr><td>@Ada</td></tr></tbody></table>";
  assert.ok(new TextEncoder().encode(html).byteLength > 1024 * 1024);
  assert.ok(new TextEncoder().encode(html).byteLength < EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES);
  const parts = splitEditorHTMLPatch(editorHTMLPatchForChange("", html));
  assert.ok(parts.length > 1);
  let rebuilt = "";
  for (const part of parts) {
    assert.ok(new TextEncoder().encode(JSON.stringify(part)).byteLength <= EDITOR_COLLABORATION_OPERATION_TARGET_BYTES);
    rebuilt = applyEditorHTMLPatch(rebuilt, part);
  }
  assert.equal(rebuilt, html);
});

test("Enter then typing keeps rows and caret intact when acknowledgement and duplicate broadcast arrive", async () => {
  const initial = '<!-- mango-editor-html-v1 --><p>First row</p>';
  const next = '<!-- mango-editor-html-v1 --><p>First row</p><p>N</p>';
  const dom = installEditorDOM(initial);
  try {
    const server = new HTMLPatchTestServer(initial);
    const bus = new RealtimeBus();
    let renders = 0;
    const scope = "editor:node:node-1:enter-caret";
    const controller = new EditorCollaborationController(controllerOptions(server, "enter-caret", {
      subscribe: bus.subscribe,
      onHTML: (html) => { renders += 1; dom.editor.innerHTML = html; },
      requestJSON: async <T,>(_path: string, init?: RequestInit) => {
        if (!init?.method) return server.currentSnapshot() as T;
        const commit = server.commit(JSON.parse(String(init.body)) as CommitBody);
        return commit as T;
      },
    }));
    await controller.recover();
    renders = 0;
    dom.editor.innerHTML = next;
    const text = dom.editor.lastElementChild!.firstChild!;
    const range = dom.window.document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    const selection = dom.window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    controller.schedule(next, true);
    await controller.flush();
    const commit = server.dedupe.values().next().value as TestCommit;
    bus.publish(scope, commit);
    await controller.flush();
    assert.equal(renders, 0, "own acknowledgement/broadcast must not replace the live editor DOM");
    assert.equal(dom.editor.innerHTML, next);
    assert.equal(dom.editor.children.length, 2);
    assert.equal(selection.anchorNode?.textContent, "N");
    assert.equal(selection.anchorOffset, 1);
    controller.stop();
  } finally {
    dom.restore();
  }
});

test("Node and Logic Gate recovery render rich DOM directly and never flatten when collaboration arrives", async () => {
  const dom = installEditorDOM();
  try {
    for (const resourceType of ["node", "logic_gate"] as const) {
      const server = new HTMLPatchTestServer(completeRichHTML);
      const documentID = `rich-load-${resourceType}`;
      const controller = new EditorCollaborationController(controllerOptions(server, documentID, {
        resourceType,
        resourceID: `${resourceType}-1`,
        initialHTML: "",
        onHTML: (html) => { dom.editor.innerHTML = html; },
      }));
      await controller.recover();
      assert.equal(dom.editor.querySelector("strong")?.textContent, "Heading");
      assert.equal(dom.editor.querySelectorAll("p").length, 4);
      assert.equal(dom.editor.querySelectorAll("ul, ol").length, 3);
      assert.equal(dom.editor.querySelector("img")?.getAttribute("src"), "mango-attachment:attachment-1");
      assert.equal(dom.editor.textContent?.includes("<span>"), false);
      controller.stop();
    }
  } finally {
    dom.restore();
  }
});

test("two browser contexts converge on disjoint HTML edits without refresh and exact scopes stay isolated", async () => {
  const initial = '<!-- mango-editor-html-v1 --><p>abcd</p>';
  const dom = installEditorDOM(initial);
  try {
    const server = new HTMLPatchTestServer(initial);
    const bus = new RealtimeBus();
    const scope = "editor:node:node-1:shared-document";
    let htmlA = initial;
    let htmlB = initial;
    const request = async <T,>(_path: string, init?: RequestInit) => {
      if (!init?.method) return server.currentSnapshot() as T;
      const commit = server.commit(JSON.parse(String(init.body)) as CommitBody);
      bus.publish(scope, commit);
      return commit as T;
    };
    dom.window.name = "";
    const first = new EditorCollaborationController(controllerOptions(server, "shared-document", {
      subscribe: bus.subscribe, requestJSON: request, onHTML: (html) => { htmlA = html; },
    }));
    dom.window.name = "";
    const second = new EditorCollaborationController(controllerOptions(server, "shared-document", {
      subscribe: bus.subscribe, requestJSON: request, onHTML: (html) => { htmlB = html; },
    }));
    const isolated = new HTMLPatchTestServer(initial);
    let isolatedRenders = 0;
    const third = new EditorCollaborationController(controllerOptions(isolated, "other-document", {
      subscribe: bus.subscribe, onHTML: () => { isolatedRenders += 1; },
    }));
    first.start(); second.start(); third.start();
    await Promise.all([first.recover(), second.recover(), third.recover()]);
    htmlA = initial; htmlB = initial; isolatedRenders = 0;
    htmlA = initial.replace("abcd", "aLbcd");
    htmlB = initial.replace("abcd", "abcRd");
    first.schedule(htmlA, true);
    second.schedule(htmlB, true);
    await Promise.all([first.flush(), second.flush()]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(htmlA, server.html, `first editor diverged; second=${htmlB}`);
    assert.equal(htmlB, server.html, `second editor diverged; first=${htmlA}`);
    assert.match(server.html, /aLbcRd/);
    assert.equal((server.html.match(/L/g) ?? []).length, 1);
    assert.equal((server.html.match(/R/g) ?? []).length, 1);
    assert.equal(isolatedRenders, 0);
    first.stop(); second.stop(); third.stop();
  } finally {
    dom.restore();
  }
});

test("lost acknowledgement, retry, and duplicate acknowledgement/broadcast apply a stable operation once", async () => {
  const dom = installEditorDOM();
  try {
    const server = new HTMLPatchTestServer("A");
    let lostOperationID = "";
    let loseAck = true;
    const first = new EditorCollaborationController(controllerOptions(server, "lost-ack-html", {
      requestJSON: async <T,>(_path: string, init?: RequestInit) => {
        if (!init?.method) return server.currentSnapshot() as T;
        const body = JSON.parse(String(init.body)) as CommitBody;
        lostOperationID = body.operation_id;
        const commit = server.commit(body);
        if (loseAck) { loseAck = false; throw new Error("acknowledgement_lost_after_commit"); }
        return commit as T;
      },
    }));
    await first.recover();
    first.schedule("AL", true);
    await assert.rejects(first.flush(), /acknowledgement_lost_after_commit/);
    first.stop();

    let retryOperationID = "";
    const second = new EditorCollaborationController(controllerOptions(server, "lost-ack-html", {
      initialHTML: "AL",
      requestJSON: async <T,>(_path: string, init?: RequestInit) => {
        if (!init?.method) return server.currentSnapshot() as T;
        const body = JSON.parse(String(init.body)) as CommitBody;
        retryOperationID = body.operation_id;
        return server.commit(body) as T;
      },
    }));
    await second.recover();
    assert.equal(retryOperationID, lostOperationID);
    assert.equal(server.html, "AL");
    assert.equal(server.revision, 1);
    second.stop();
  } finally {
    dom.restore();
  }
});

test("revision gap and reconnect load full canonical HTML recovery without erasing rich content", async () => {
  const initial = '<!-- mango-editor-html-v1 --><p>First</p>';
  const recovered = completeRichHTML.replace("Heading", "Recovered");
  const dom = installEditorDOM(initial);
  try {
    const server = new HTMLPatchTestServer(initial);
    const bus = new RealtimeBus();
    const errors: string[] = [];
    let visible = initial;
    const scope = "editor:node:node-1:revision-gap";
    const controller = new EditorCollaborationController(controllerOptions(server, "revision-gap", {
      subscribe: bus.subscribe,
      onHTML: (html) => { visible = html; dom.editor.innerHTML = html; },
      onError: (cause) => errors.push(cause instanceof Error ? cause.message : String(cause)),
    }));
    controller.start();
    await controller.recover();
    server.html = recovered;
    server.revision = 2;
    bus.publish(scope, {
      operation_id: "gap-operation", event_id: "gap-event", revision: 2,
      patch: { start_utf8: 0, delete_utf8: 0, insert: "ignored-gap" }, concurrent_operations: [],
    });
    await eventually(() => visible === recovered, "revision-gap snapshot recovery");
    assert.ok(errors.includes("collaboration_revision_gap"));
    assert.equal(dom.editor.querySelector("strong")?.textContent, "Recovered");
    assert.equal(dom.editor.querySelector("img")?.getAttribute("data-mango-attachment-id"), "attachment-1");
    controller.stop();
  } finally {
    dom.restore();
  }
});

test("snapshot-required retry keeps the stable operation ID and rebases the HTML patch", async () => {
  const dom = installEditorDOM();
  try {
    const server = new HTMLPatchTestServer("A");
    let posts = 0;
    const operationIDs: string[] = [];
    const controller = new EditorCollaborationController(controllerOptions(server, "snapshot-retry-html", {
      requestJSON: async <T,>(_path: string, init?: RequestInit) => {
        if (!init?.method) return server.currentSnapshot() as T;
        const body = JSON.parse(String(init.body)) as CommitBody;
        posts += 1;
        operationIDs.push(body.operation_id);
        if (posts === 1) throw new Error("collaboration_snapshot_required");
        return server.commit(body) as T;
      },
    }));
    await controller.recover();
    controller.schedule("AL", true);
    await controller.flush();
    assert.equal(posts, 2);
    assert.equal(operationIDs[0], operationIDs[1]);
    assert.equal(server.html, "AL");
    controller.stop();
  } finally {
    dom.restore();
  }
});

test("cleanup removes obsolete whole-body and structured collaboration storage keys", () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  local.setItem("mango-editor-projection-draft-v2:old", "full body");
  local.setItem("mango-editor-collaboration-pending-v1:old", "old operation");
  session.setItem("mango-editor-collaboration-tab-v2:old", "structured tab");
  assert.equal(cleanupLegacyEditorProjectionStorage(local, session), 3);
  assert.equal(local.length, 0);
  assert.equal(session.length, 0);
});

test("storage failure, unsafe content, and oversize edits roll the visible DOM back deterministically", async () => {
  const dom = installEditorDOM("A");
  try {
    const server = new HTMLPatchTestServer("A");
    const errors: string[] = [];
    const renders: string[] = [];
    const controller = new EditorCollaborationController(controllerOptions(server, "preflight-html", {
      onHTML: (html) => { renders.push(html); dom.editor.innerHTML = html; },
      onError: (cause) => errors.push(cause instanceof Error ? cause.message : String(cause)),
    }));
    controller.schedule('<img src="data:image/png;base64,AAAA">', true);
    controller.schedule("x".repeat(EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES + 1), true);
    assert.deepEqual(errors, ["editor_collaboration_sensitive_content_rejected", "editor_collaboration_document_too_large"]);
    assert.deepEqual(renders, ["A", "A"]);
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    controller.schedule("AL", true);
    await controller.flush();
    assert.equal(errors[errors.length - 1], "editor_collaboration_storage_unavailable");
    assert.equal(server.revision, 0);
  } finally {
    dom.restore();
  }
});

test("staged local input is persisted before a remote commit is applied", async () => {
  const initial = "abcd";
  const localHTML = "aLbcd";
  const remoteHTML = "abcRd";
  const expected = "aLbcRd";
  const dom = installEditorDOM(initial);
  try {
    const server = new HTMLPatchTestServer(initial);
    const bus = new RealtimeBus();
    const scope = "editor:node:node-1:staged-local-input";
    let visible = initial;
    let staged = false;
    let stagedFlushes = 0;
    let controller!: EditorCollaborationController;
    controller = new EditorCollaborationController(controllerOptions(server, "staged-local-input", {
      subscribe: bus.subscribe,
      onHTML: (html) => { visible = html; },
      flushPendingLocalInput: () => {
        if (!staged) return;
        staged = false;
        stagedFlushes += 1;
        controller.schedule(localHTML, true);
      },
    }));
    controller.start();
    await controller.recover();

    staged = true;
    const remoteCommit = server.commit({
      operation_id: "remote-operation",
      client_id: "remote-client",
      base_revision: 0,
      patch: editorHTMLPatchForChange(initial, remoteHTML),
    });
    bus.publish(scope, remoteCommit);

    await controller.flush();
    await eventually(() => server.html === expected, "staged local and remote HTML convergence");
    assert.equal(stagedFlushes, 1);
    assert.equal(server.html, expected);
    assert.equal(visible, expected);
    assert.equal(server.operations.length, 2);
    controller.stop();
  } finally {
    dom.restore();
  }
});
