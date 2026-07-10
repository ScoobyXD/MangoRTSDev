import test from "node:test";
import assert from "node:assert/strict";
import { splitChatTextLinks } from "../../../../frontend/src/modules/editor/nodeChatLinks.js";

test("node chat linkification preserves punctuation and normalizes www URLs", () => {
  assert.deepEqual(splitChatTextLinks("See https://example.com/a?b=1, then www.example.org."), [
    { text: "See " },
    { text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
    { text: "," },
    { text: " then " },
    { text: "www.example.org", href: "https://www.example.org" },
    { text: "." },
  ]);
});

test("node chat linkification ignores unsafe URI schemes", () => {
  assert.deepEqual(splitChatTextLinks("javascript:alert(1) and mailto:user@example.com"), [
    { text: "javascript:alert(1) and mailto:user@example.com" },
  ]);
});

test("node chat linkification recognizes bare domains without linking email addresses", () => {
  assert.deepEqual(splitChatTextLinks("Open docs.example.com/guide; email user@example.com."), [
    { text: "Open " },
    { text: "docs.example.com/guide", href: "https://docs.example.com/guide" },
    { text: "; email user@example.com." },
  ]);
});
