import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveEditorTextBlockChatAnchorMessageID,
  resolveEditorTextBlockChatAnchorRanges,
} from "../../../../frontend/src/modules/editor/editorTextBlockChatHighlights.js";
import type { EditorTextBlockChatMessage } from "../../../../frontend/src/modules/editor/editorProjection.js";

function message(input: Partial<EditorTextBlockChatMessage> & { id: string }): EditorTextBlockChatMessage {
  return {
    id: input.id,
    blockID: input.blockID ?? "block-a",
    parentID: input.parentID,
    selectionQuote: input.selectionQuote,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd,
    authorID: input.authorID ?? "user-a",
    authorName: input.authorName ?? "Ada",
    message: input.message ?? "note",
    createdTimestamp: input.createdTimestamp ?? "2026-05-13T00:00:00.000Z",
    attachments: input.attachments ?? [],
  };
}

test("chat highlight ranges use stored offsets when the quote still matches", () => {
  const ranges = resolveEditorTextBlockChatAnchorRanges("alpha beta gamma", [
    message({ id: "chat-a", selectionQuote: "beta", selectionStart: 6, selectionEnd: 10 }),
  ]);

  assert.deepEqual(ranges, [
    { messageID: "chat-a", quote: "beta", startOffset: 6, endOffset: 10 },
  ]);
});

test("chat highlight ranges re-anchor by quote after text edits move the selection", () => {
  const ranges = resolveEditorTextBlockChatAnchorRanges("prefix alpha beta gamma", [
    message({ id: "chat-a", selectionQuote: "beta", selectionStart: 6, selectionEnd: 10 }),
  ]);

  assert.deepEqual(ranges, [
    { messageID: "chat-a", quote: "beta", startOffset: 13, endOffset: 17 },
  ]);
});

test("child chat messages activate the nearest parent text anchor", () => {
  const messages = [
    message({ id: "parent", selectionQuote: "beta", selectionStart: 6, selectionEnd: 10 }),
    message({ id: "child", parentID: "parent" }),
    message({ id: "grandchild", parentID: "child" }),
  ];

  assert.equal(resolveEditorTextBlockChatAnchorMessageID(messages, "grandchild"), "parent");
});

