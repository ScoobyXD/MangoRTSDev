import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEditorTextBlockChatPayload,
  parseEditorTextBlockChats,
  type EditorProjectionItem,
} from "../../../../frontend/src/modules/editor/editorProjection.js";

test("chat payloads round-trip typed workspace entity references", () => {
  const information = buildEditorTextBlockChatPayload({
    blockID: "block-1",
    authorID: "user-1",
    authorName: "Ada",
    message: "See #Gate One",
    createdTimestamp: "2026-07-28T12:00:00.000Z",
    entityLinks: [{
      start: 4,
      end: 13,
      entityType: "logic_gate",
      entityID: "gate-1",
      label: "Gate One",
    }],
  });
  const payload = JSON.parse(information) as Record<string, unknown>;
  assert.deepEqual(payload.entity_links, [{
    start: 4,
    end: 13,
    entity_type: "logic_gate",
    entity_id: "gate-1",
    label: "Gate One",
  }]);

  const projection: EditorProjectionItem = {
    information_id: "chat-1",
    type: "Text block chat",
    information,
  };
  assert.deepEqual(parseEditorTextBlockChats([projection])[0]?.entityLinks, [{
    start: 4,
    end: 13,
    entityType: "logic_gate",
    entityID: "gate-1",
    label: "Gate One",
  }]);
});

test("stale chat entity offsets are ignored without hiding the comment", () => {
  const information = JSON.stringify({
    block_id: "block-1",
    author_id: "user-1",
    author_name: "Ada",
    message: "Changed text",
    created_timestamp: "2026-07-28T12:00:00.000Z",
    attachments: [],
    entity_links: [{ start: 0, end: 9, entity_type: "node", entity_id: "node-1", label: "Node One" }],
  });
  const messages = parseEditorTextBlockChats([{ information_id: "chat-1", type: "Text block chat", information }]);
  assert.equal(messages[0]?.message, "Changed text");
  assert.deepEqual(messages[0]?.entityLinks, []);
});
