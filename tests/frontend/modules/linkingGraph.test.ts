import test from "node:test";
import assert from "node:assert/strict";
import { classifyFrameKind, resolveConnectedFrameTargets, resolveDirectLinkedTargets, resolveLinkedFrameByKindFromGraph, sanitizeFrameLinks, sanitizeFrameRegistry } from "../../../frontend/src/modules/linkingGraph.js";

test("sanitizeFrameLinks canonicalizes and deduplicates undirected edges", () => {
  assert.deepEqual(sanitizeFrameLinks([
    { a: "b", b: "a", mode: "context" },
    { a: "a", b: "b", mode: "context" },
    { a: "b", b: "b", mode: "context" },
  ]), [{ a: "a", b: "b", mode: "context" }]);
});

test("resolveLinkedFrameByKindFromGraph walks through surviving intermediary frames", () => {
  const registry = sanitizeFrameRegistry({
    "editor-1": { kind: "editor" },
    "explorer-1": { kind: "company-explorer" },
    "kanban-1": { kind: "kanban" },
  });
  const edges = sanitizeFrameLinks([
    { a: "editor-1", b: "explorer-1", mode: "context" },
    { a: "explorer-1", b: "kanban-1", mode: "context" },
  ]);
  assert.equal(resolveLinkedFrameByKindFromGraph({ startFrameID: "editor-1", targetKind: "kanban", edges, registry }), "kanban-1");
});

test("classifyFrameKind recognizes only surviving linkable modules", () => {
  assert.equal(classifyFrameKind("editor"), "editor");
  assert.equal(classifyFrameKind("company-explorer"), "explorer");
  assert.equal(classifyFrameKind("kanban"), "kanban");
  assert.equal(classifyFrameKind("retired-kind"), null);
});

test("resolveDirectLinkedTargets returns direct neighbors only", () => {
  const edges = sanitizeFrameLinks([
    { a: "explorer-1", b: "editor-1", mode: "context" },
    { a: "editor-1", b: "kanban-1", mode: "context" },
  ]);
  assert.deepEqual(resolveDirectLinkedTargets({ sourceFrameID: "editor-1", edges }).sort(), ["explorer-1", "kanban-1"]);
});

test("resolveConnectedFrameTargets returns transitive context targets", () => {
  const registry = sanitizeFrameRegistry({
    "explorer-1": { kind: "company-explorer" },
    "kanban-1": { kind: "kanban" },
    "editor-1": { kind: "editor" },
    "isolated-1": { kind: "editor" },
  });
  const edges = sanitizeFrameLinks([
    { a: "explorer-1", b: "kanban-1", mode: "context" },
    { a: "kanban-1", b: "editor-1", mode: "context" },
  ]);
  assert.deepEqual(resolveConnectedFrameTargets({ sourceFrameID: "explorer-1", edges, registry }).sort(), ["editor-1", "kanban-1"]);
});