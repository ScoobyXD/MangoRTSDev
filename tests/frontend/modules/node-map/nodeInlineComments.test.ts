import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNodeInlineCommentsStorageKey,
  buildNodeTitleCommentSegments,
  createNodeInlineCommentMessage,
  createNodeInlineCommentThread,
  parseNodeInlineCommentThreads,
  type NodeInlineCommentThread,
} from "../../../../frontend/src/modules/node-map/nodeInlineComments.js";

test("buildNodeInlineCommentsStorageKey scopes node comments by company", () => {
  assert.equal(buildNodeInlineCommentsStorageKey(" company-a "), "mango-node-inline-comments-v1:company-a");
});

test("createNodeInlineCommentThread preserves selected node title range", () => {
  const thread = createNodeInlineCommentThread({
    nodeID: "node-a",
    quote: "selected text",
    startOffset: 4,
    endOffset: 17,
    anchorX: 20,
    anchorY: 8,
  }, "thread-a", "2026-05-13T00:00:00.000Z");

  assert.deepEqual(thread, {
    id: "thread-a",
    nodeID: "node-a",
    quote: "selected text",
    startOffset: 4,
    endOffset: 17,
    createdAt: "2026-05-13T00:00:00.000Z",
    messages: [],
  });
});

test("createNodeInlineCommentMessage trims blank replies", () => {
  assert.equal(createNodeInlineCommentMessage("   "), null);
  assert.deepEqual(createNodeInlineCommentMessage("  noted  ", "Me", "message-a", "2026-05-13T00:00:00.000Z"), {
    id: "message-a",
    body: "noted",
    authorLabel: "Me",
    createdAt: "2026-05-13T00:00:00.000Z",
  });
});

test("buildNodeTitleCommentSegments marks active title ranges and ignores resolved threads", () => {
  const threads: NodeInlineCommentThread[] = [
    {
      id: "thread-a",
      nodeID: "node-a",
      quote: "B2B software",
      startOffset: 25,
      endOffset: 37,
      createdAt: "",
      messages: [],
    },
    {
      id: "thread-b",
      nodeID: "node-a",
      quote: "ignored",
      startOffset: 0,
      endOffset: 7,
      createdAt: "",
      resolvedAt: "2026-05-13T00:00:00.000Z",
      messages: [],
    },
  ];

  const segments = buildNodeTitleCommentSegments("This startup is building B2B software for millions", threads);
  assert.deepEqual(segments.map((segment) => ({ text: segment.text, threadIDs: segment.threadIDs })), [
    { text: "This startup is building ", threadIDs: [] },
    { text: "B2B software", threadIDs: ["thread-a"] },
    { text: " for millions", threadIDs: [] },
  ]);
});

test("buildNodeTitleCommentSegments reanchors a quote after title edits", () => {
  const segments = buildNodeTitleCommentSegments("prefix strict latency culture", [{
    id: "thread-a",
    nodeID: "node-a",
    quote: "strict latency",
    startOffset: 0,
    endOffset: 14,
    createdAt: "",
    messages: [],
  }]);

  assert.deepEqual(segments.map((segment) => ({ text: segment.text, threadIDs: segment.threadIDs })), [
    { text: "prefix ", threadIDs: [] },
    { text: "strict latency", threadIDs: ["thread-a"] },
    { text: " culture", threadIDs: [] },
  ]);
});

test("parseNodeInlineCommentThreads drops malformed stored threads", () => {
  const parsed = parseNodeInlineCommentThreads(JSON.stringify([
    { id: "bad", nodeID: "", quote: "missing node", startOffset: 0, endOffset: 12 },
    {
      id: "thread-a",
      nodeID: "node-a",
      quote: "millions",
      startOffset: 0,
      endOffset: 8,
      createdAt: "2026-05-13T00:00:00.000Z",
      messages: [{ id: "message-a", body: " done ", authorLabel: "Me", createdAt: "2026-05-13T00:01:00.000Z" }],
    },
  ]));

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "thread-a");
  assert.deepEqual(parsed[0].messages, [{
    id: "message-a",
    body: "done",
    authorLabel: "Me",
    createdAt: "2026-05-13T00:01:00.000Z",
  }]);
});
