import test from "node:test";
import assert from "node:assert/strict";
import { createEditorScrollMemory } from "../../../../frontend/src/modules/editor/editorScroll.js";

test("editor scroll memory restores the last viewport for a document target", () => {
  const memory = createEditorScrollMemory();

  memory.remember("node:one:info", 480.8);

  assert.equal(memory.read("node:one:info"), 480);
});

test("editor scroll memory is bounded for long editing sessions", () => {
  const memory = createEditorScrollMemory(2);

  memory.remember("node:one:info", 100);
  memory.remember("node:two:info", 200);
  memory.remember("node:three:info", 300);

  assert.equal(memory.size(), 2);
  assert.equal(memory.read("node:one:info"), undefined);
  assert.equal(memory.read("node:two:info"), 200);
  assert.equal(memory.read("node:three:info"), 300);
});

test("editor scroll memory ignores empty keys and invalid positions", () => {
  const memory = createEditorScrollMemory();

  memory.remember("", 100);
  memory.remember("node:one:info", Number.NaN);

  assert.equal(memory.size(), 0);
});
