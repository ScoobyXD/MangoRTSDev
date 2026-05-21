import test from "node:test";
import assert from "node:assert/strict";
import {
  formatNodeContentChangeLabel,
  resolveNodeAdditionRange,
  resolveNodeDeletionAnchorOffset,
} from "../../../../frontend/src/modules/editor/nodeContentChanges.js";
import type { NodeContentChange } from "../../../../frontend/src/modules/editor/nodeContentChanges.js";

function change(input: Partial<NodeContentChange>): NodeContentChange {
  return {
    company_id: input.company_id ?? "company-a",
    change_id: input.change_id ?? "change-a",
    node_id: input.node_id ?? "node-a",
    information_id: input.information_id ?? "block-a",
    change_type: input.change_type ?? "addition",
    text: input.text ?? "beta",
    start_offset: input.start_offset ?? 6,
    end_offset: input.end_offset ?? 10,
    actor_user_id: input.actor_user_id,
    actor_display_name: input.actor_display_name ?? "Ada Lovelace",
    created_timestamp: input.created_timestamp ?? "2026-05-21T16:30:00.000Z",
  };
}

test("addition ranges use stored offsets when the changed text still matches", () => {
  assert.deepEqual(
    resolveNodeAdditionRange("alpha beta gamma", change({ text: "beta", start_offset: 6, end_offset: 10 })),
    { startOffset: 6, endOffset: 10 },
  );
});

test("addition ranges re-anchor by text when saved offsets drift", () => {
  assert.deepEqual(
    resolveNodeAdditionRange("prefix alpha beta gamma", change({ text: "beta", start_offset: 6, end_offset: 10 })),
    { startOffset: 13, endOffset: 17 },
  );
});

test("deletion labels clamp their old offset to the current document", () => {
  assert.equal(resolveNodeDeletionAnchorOffset("short", change({ change_type: "deletion", start_offset: 99, end_offset: 99 })), 5);
  assert.equal(resolveNodeDeletionAnchorOffset("short", change({ change_type: "deletion", start_offset: -2, end_offset: -2 })), 0);
});

test("change labels include actor and hide invalid timestamps", () => {
  const label = formatNodeContentChangeLabel(change({ actor_display_name: "Grace Hopper" }));
  assert.match(label, /^Grace Hopper /);
  assert.equal(formatNodeContentChangeLabel(change({ actor_display_name: "  ", created_timestamp: "not-a-date" })), "Unknown user");
});
