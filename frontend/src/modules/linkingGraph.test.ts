import test from "node:test";
import assert from "node:assert/strict";
import { resolveDirectLinkedTargets, resolveLinkedFrameByKindFromGraph, sanitizeFrameLinks, sanitizeFrameRegistry } from "./linkingGraph.js";

test("sanitizeFrameLinks canonicalizes and deduplicates undirected edges", () => {
  const result = sanitizeFrameLinks([
    { a: "b", b: "a", mode: "context" },
    { a: "a", b: "b", mode: "context" },
    { a: "b", b: "b", mode: "context" },
  ]);
  assert.deepEqual(result, [{ a: "a", b: "b", mode: "context" }]);
});

test("resolveLinkedFrameByKindFromGraph walks through intermediary frames", () => {
  const registry = sanitizeFrameRegistry({
    "editor-1": { kind: "editor" },
    "explorer-1": { kind: "company-explorer" },
    "map-1": { kind: "nodes-map" },
  });
  const edges = sanitizeFrameLinks([
    { a: "editor-1", b: "explorer-1", mode: "context" },
    { a: "explorer-1", b: "map-1", mode: "context" },
  ]);
  const linkedMap = resolveLinkedFrameByKindFromGraph({
    startFrameID: "editor-1",
    targetKind: "map",
    edges,
    registry,
  });
  assert.equal(linkedMap, "map-1");
});

test("resolveDirectLinkedTargets returns direct neighbors only", () => {
  const edges = sanitizeFrameLinks([
    { a: "explorer-1", b: "editor-1", mode: "context" },
    { a: "editor-1", b: "map-1", mode: "context" },
  ]);
  const targets = resolveDirectLinkedTargets({ sourceFrameID: "editor-1", edges }).sort();
  assert.deepEqual(targets, ["explorer-1", "map-1"]);
});
