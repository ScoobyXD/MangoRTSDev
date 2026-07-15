import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEditorCollaborationDelta,
  cleanupLegacyEditorProjectionStorage,
  editorCollaborationDeltaForHTML,
  materializeEditorCollaborationState,
  newEditorCollaborationState,
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
});