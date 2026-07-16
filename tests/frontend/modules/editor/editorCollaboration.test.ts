import assert from "node:assert/strict";
import test from "node:test";
// Browser-level coverage is exercised by the collaboration browser harness.

import {
  applyEditorCollaborationDelta,
  cleanupLegacyEditorProjectionStorage,
  editorCollaborationDeltaForHTML,
  EDITOR_COLLABORATION_ATOM_TARGET_CODE_POINTS,
  EDITOR_COLLABORATION_OPERATION_TARGET_BYTES,
  EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES,
  EditorCollaborationController,
  materializeEditorCollaborationState,
  newEditorCollaborationState,
  splitEditorCollaborationDelta,
  type EditorCollaborationSnapshot,
} from "../../../../frontend/src/modules/editor/editorCollaboration.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test("concurrent same-document operations converge in deterministic server-independent order", () => {
  const initial = newEditorCollaborationState("A");
  const left = { inserts: [{ id: "client-a:operation:0", after_id: "0:00000000", value: "L" }] };
  const right = { inserts: [{ id: "client-b:operation:0", after_id: "0:00000000", value: "R" }] };
  const leftThenRight = applyEditorCollaborationDelta(applyEditorCollaborationDelta(initial, left), right);
  const rightThenLeft = applyEditorCollaborationDelta(applyEditorCollaborationDelta(initial, right), left);
  assert.equal(materializeEditorCollaborationState(leftThenRight), materializeEditorCollaborationState(rightThenLeft));
  assert.equal(materializeEditorCollaborationState(leftThenRight), "ARL");
});

test("ordinary typing emits a bounded structured edit instead of a full body", () => {
  const html = `<p>${"a".repeat(2_000)}</p>`;
  const state = newEditorCollaborationState(html);
  const next = html.replace("aaaa", "aaZaa");
  const delta = editorCollaborationDeltaForHTML(state, next, "client:operation");
  assert.equal(delta.delete_ids?.length, 0);
  assert.equal(delta.inserts?.length, 1);
  assert.equal(delta.inserts?.[0]?.value, "Z");
  assert.equal(materializeEditorCollaborationState(applyEditorCollaborationDelta(state, delta)), next);
});

test("rich HTML operations preserve formatting, lists, mentions, tables, and attachment references", () => {
  const html = '<p><strong>Bold</strong></p><ol><li>One</li></ol><span data-mention-user-id="u-1">@Ada</span><table><tbody><tr><td>A</td></tr></tbody></table><img data-mango-attachment-id="attachment-1">';
  const state = newEditorCollaborationState("");
  const delta = editorCollaborationDeltaForHTML(state, html, "client:operation");
  assert.equal(materializeEditorCollaborationState(applyEditorCollaborationDelta(state, delta)), html);
});

test("one-time cleanup deletes obsolete full-body draft and tab-session records only", () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  local.setItem("mango-editor-projection-draft-v2:old", "full body");
  local.setItem("mango-editor-collaboration-pending-v1:keep", "structured operation");
  session.setItem("mango-editor-projection-tab-v1", "tab");
  assert.equal(cleanupLegacyEditorProjectionStorage(local, session), 2);
  assert.equal(local.getItem("mango-editor-projection-draft-v2:old"), null);
  assert.equal(session.getItem("mango-editor-projection-tab-v1"), null);
  assert.equal(local.getItem("mango-editor-collaboration-pending-v1:keep"), "structured operation");
});function collaborationSnapshot(revision: number, state: ReturnType<typeof newEditorCollaborationState>): EditorCollaborationSnapshot {
  return {
    revision,
    snapshot_revision: revision,
    state,
    html: materializeEditorCollaborationState(state),
    etag: `"editor-${revision}"`,
  };
}

function installEditorDOM(initialHTML: string) {
  const previousWindow = (globalThis as { window?: Window }).window;
  const fakeWindow = {
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    setTimeout,
    clearTimeout,
  } as unknown as Window;
  (globalThis as { window: Window }).window = fakeWindow;
  return {
    editor: { innerHTML: initialHTML },
    restore: () => {
      if (previousWindow) (globalThis as { window: Window }).window = previousWindow;
      else delete (globalThis as { window?: Window }).window;
    },
  };
}

function controllerOptions(overrides: Partial<ConstructorParameters<typeof EditorCollaborationController>[0]> = {}) {
  return {
    apiBase: "https://mango.test",
    companyID: "company-1",
    currentUserID: "user-1",
    resourceType: "node" as const,
    resourceID: "node-1",
    documentID: "document-1",
    initialHTML: "A",
    requestJSON: async <T,>() => collaborationSnapshot(0, newEditorCollaborationState("A")) as T,
    onHTML: () => undefined,
    subscribe: (() => () => undefined) as never,
    ...overrides,
  };
}

test("realistic one-megabyte rich-text paste uses compact atoms and ordered sub-64 KiB requests without truncation", () => {
  const richUnit = '<p><strong>Bold Ω🙂</strong></p><ol><li>One</li><li><mark>Two</mark></li></ol><table><tbody><tr><td data-mention-user-id="user-2">@Ada</td></tr></tbody></table><img data-mango-attachment-id="attachment-1">';
  const html = richUnit.repeat(6_000);
  const htmlBytes = new TextEncoder().encode(html).byteLength;
  assert.ok(htmlBytes > 1024 * 1024);
  assert.ok(htmlBytes < EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES);
  const delta = editorCollaborationDeltaForHTML(newEditorCollaborationState(""), html, "large-paste");
  assert.ok((delta.inserts?.length ?? 0) < 2_000);
  assert.ok(delta.inserts?.every((atom) => Array.from(atom.value).length <= EDITOR_COLLABORATION_ATOM_TARGET_CODE_POINTS));
  const parts = splitEditorCollaborationDelta(delta);
  assert.ok(parts.length > 1);
  let state = newEditorCollaborationState("");
  for (const part of parts) {
    assert.ok(new TextEncoder().encode(JSON.stringify(part)).byteLength <= EDITOR_COLLABORATION_OPERATION_TARGET_BYTES);
    state = applyEditorCollaborationDelta(state, part);
  }
  assert.equal(materializeEditorCollaborationState(state), html);
});

test("editing inside a compact atom replaces only bounded chunks and materializes exactly", () => {
  const html = `<p>${"a".repeat(10_000)}</p>`;
  const state = newEditorCollaborationState(html);
  assert.ok(state.atoms.length < 20);
  const next = `${html.slice(0, 5_000)}Z${html.slice(5_001)}`;
  const delta = editorCollaborationDeltaForHTML(state, next, "compact-edit");
  assert.ok((delta.inserts?.length ?? 0) <= 2);
  assert.equal(materializeEditorCollaborationState(applyEditorCollaborationDelta(state, delta)), next);
});

test("oversized or sensitive pasted bodies never enter durable pending realtime work", () => {
  const dom = installEditorDOM("A");
  try {
    const errors: string[] = [];
    const controller = new EditorCollaborationController(controllerOptions({ onError: (cause) => errors.push(cause instanceof Error ? cause.message : String(cause)) }));
    controller.schedule('<img src="data:image/png;base64,AAAA">', true);
    controller.schedule("x".repeat(EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES + 1), true);
    assert.deepEqual(errors, ["editor_collaboration_sensitive_content_rejected", "editor_collaboration_document_too_large"]);
    const local = globalThis.window.localStorage as Storage;
    const keys = Array.from({ length: local.length }, (_, index) => local.key(index));
    assert.equal(keys.filter((key) => key?.startsWith("mango-editor-collaboration-pending-v1:")).length, 0);
  } finally {
    dom.restore();
  }
});

test("acknowledgement before broadcast renders remote accepted content exactly once in the visible editor", async () => {
  const dom = installEditorDOM("A");
  try {
    const initial = newEditorCollaborationState("A");
    const remoteDelta = { inserts: [{ id: "remote:1", after_id: "0:00000000", value: "R" }] };
    let subscriptionHandlers: any;
    const renders: string[] = [];
    let committedState = initial;
    const controller = new EditorCollaborationController(controllerOptions({
      subscribe: ((...args: any[]) => { subscriptionHandlers = args[3]; return () => undefined; }) as never,
      onHTML: (html) => { dom.editor.innerHTML = html; renders.push(html); },
      requestJSON: async <T,>(_path: string, init?: RequestInit) => {
        if (!init?.method) return collaborationSnapshot(0, initial) as T;
        const body = JSON.parse(String(init.body)) as { operation_id: string; delta: Parameters<typeof applyEditorCollaborationDelta>[1] };
        committedState = applyEditorCollaborationDelta(applyEditorCollaborationDelta(initial, remoteDelta), body.delta);
        return { operation_id: body.operation_id, revision: 2, snapshot: collaborationSnapshot(2, committedState) } as T;
      },
    }));
    controller.start();
    await controller.recover();
    dom.editor.innerHTML = "AL";
    controller.schedule("AL");
    await controller.flush();
    const expected = materializeEditorCollaborationState(committedState);
    assert.equal(dom.editor.innerHTML, expected);
    const rendersAfterAck = renders.length;
    subscriptionHandlers.onEditorDeltaCommitted({ resource_revision: 1, operation_id: "remote-operation", delta: remoteDelta });
    subscriptionHandlers.onEditorDeltaCommitted({ resource_revision: 2, operation_id: "origin-operation", delta: {} });
    assert.equal(dom.editor.innerHTML, expected);
    assert.equal(renders.length, rendersAfterAck);
    controller.stop();
  } finally {
    dom.restore();
  }
});

test("broadcast before acknowledgement preserves the visible local edit and converges without an echo save", async () => {
  const dom = installEditorDOM("A");
  try {
    const initial = newEditorCollaborationState("A");
    const remoteDelta = { inserts: [{ id: "remote:1", after_id: "0:00000000", value: "R" }] };
    let subscriptionHandlers: any;
    let postCount = 0;
    let committedState = initial;
    const controller = new EditorCollaborationController(controllerOptions({
      subscribe: ((...args: any[]) => { subscriptionHandlers = args[3]; return () => undefined; }) as never,
      onHTML: (html) => { dom.editor.innerHTML = html; },
      requestJSON: async <T,>(_path: string, init?: RequestInit) => {
        if (!init?.method) return collaborationSnapshot(0, initial) as T;
        postCount += 1;
        const body = JSON.parse(String(init.body)) as { operation_id: string; delta: Parameters<typeof applyEditorCollaborationDelta>[1] };
        subscriptionHandlers.onEditorDeltaCommitted({ resource_revision: 1, operation_id: "remote-operation", delta: remoteDelta });
        committedState = applyEditorCollaborationDelta(applyEditorCollaborationDelta(initial, remoteDelta), body.delta);
        return { operation_id: body.operation_id, revision: 2, snapshot: collaborationSnapshot(2, committedState) } as T;
      },
    }));
    controller.start();
    await controller.recover();
    dom.editor.innerHTML = "AL";
    controller.schedule("AL");
    await controller.flush();
    assert.equal(dom.editor.innerHTML, materializeEditorCollaborationState(committedState));
    assert.equal(postCount, 1);
    controller.stop();
  } finally {
    dom.restore();
  }
});

test("lost acknowledgement recovery recognizes the stable operation in the snapshot, deduplicates it, and clears durable pending work", async () => {
  const dom = installEditorDOM("A");
  try {
    const initial = newEditorCollaborationState("A");
    let committedState = initial;
    let committedBody: { operation_id: string; delta: Parameters<typeof applyEditorCollaborationDelta>[1] } | undefined;
    const first = new EditorCollaborationController(controllerOptions({
      onHTML: (html) => { dom.editor.innerHTML = html; },
      requestJSON: async <T,>(_path: string, init?: RequestInit) => {
        if (!init?.method) return collaborationSnapshot(0, initial) as T;
        committedBody = JSON.parse(String(init.body));
        committedState = applyEditorCollaborationDelta(initial, committedBody!.delta);
        throw new Error("acknowledgement_lost_after_commit");
      },
    }));
    first.start();
    await first.recover();
    dom.editor.innerHTML = "AL";
    first.schedule("AL");
    await assert.rejects(first.flush(), /acknowledgement_lost_after_commit/);
    first.stop();

    let dedupePosts = 0;
    const pendingCounts: number[] = [];
    const second = new EditorCollaborationController(controllerOptions({
      initialHTML: "AL",
      onHTML: (html) => { dom.editor.innerHTML = html; },
      onPendingChange: (count) => pendingCounts.push(count),
      requestJSON: async <T,>(_path: string, init?: RequestInit) => {
        if (!init?.method) return collaborationSnapshot(1, committedState) as T;
        dedupePosts += 1;
        const retried = JSON.parse(String(init.body)) as { operation_id: string };
        assert.equal(retried.operation_id, committedBody?.operation_id);
        return { operation_id: retried.operation_id, revision: 1, deduplicated: true, snapshot: collaborationSnapshot(1, committedState) } as T;
      },
    }));
    second.start();
    await second.recover();
    assert.equal(dom.editor.innerHTML, "AL");
    assert.equal(dedupePosts, 1);
    assert.equal(pendingCounts[pendingCounts.length - 1], 0);
    const pendingKeys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter((key) => key?.startsWith("mango-editor-collaboration-pending-v1:"));
    assert.deepEqual(pendingKeys, []);
    second.stop();
  } finally {
    dom.restore();
  }
});
