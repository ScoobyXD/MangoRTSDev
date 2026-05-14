import test from "node:test";
import assert from "node:assert/strict";
import { createLogicGateArenaFrames } from "../../../frontend/src/app/DefaultViews.js";
import { buildLinkModulesLabel, buildLinkPool, classifyFrameKind, computeLinkPlan, delinkForPool, deriveLegacyMapLinks, mergeLinkPlan } from "../../../frontend/src/app/frameLinking.js";
import type { FrameDataModel } from "../../../frontend/src/types.js";

const map: FrameDataModel = { id: "map-1", kind: "nodes-map", title: "Node Map", x: 0, y: 0, w: 8, h: 8, color: "#fff", accent: "#111" };
const editor: FrameDataModel = { id: "editor-1", kind: "editor", title: "Editor", x: 0, y: 0, w: 8, h: 8, color: "#fff", accent: "#111" };
const explorer: FrameDataModel = { id: "explorer-1", kind: "company-explorer", title: "Explorer", x: 0, y: 0, w: 8, h: 8, color: "#fff", accent: "#111" };
const kanban: FrameDataModel = { id: "kanban-1", kind: "kanban", title: "Kanban board", x: 0, y: 0, w: 8, h: 8, color: "#fff", accent: "#111" };

test("link menu label falls back to no-other-selected when only one frame is in pool", () => {
  const label = buildLinkModulesLabel([map], null);
  assert.equal(label, "No other module selected");
});

test("computeLinkPlan builds pairwise context links for selected pool", () => {
  const plan = computeLinkPlan([map, editor, explorer, kanban]);
  assert.deepEqual(plan, {
    edges: [
      { a: "map-1", b: "editor-1", mode: "context" },
      { a: "map-1", b: "explorer-1", mode: "context" },
      { a: "map-1", b: "kanban-1", mode: "context" },
      { a: "editor-1", b: "explorer-1", mode: "context" },
      { a: "editor-1", b: "kanban-1", mode: "context" },
      { a: "explorer-1", b: "kanban-1", mode: "context" },
    ],
  });
});

test("unified map frame participates in frame linking as a map", () => {
  assert.equal(classifyFrameKind("map"), "map");
});

test("buildLinkPool falls back to context frame when no multi-select exists", () => {
  const pool = buildLinkPool({
    frames: [map, editor],
    selectedFrameIds: new Set(),
    selectedFrameId: null,
    contextFrameId: "editor-1",
  });
  assert.deepEqual(pool.map((item) => item.id), ["editor-1"]);
});

test("delinkForPool removes both direct and reverse-side module links", () => {
  const result = delinkForPool(
    [map],
    [
      { a: "editor-1", b: "map-1", mode: "context" },
      { a: "editor-2", b: "map-2", mode: "context" },
      { a: "explorer-1", b: "map-1", mode: "context" },
    ],
  );
  assert.equal(result.changed, true);
  assert.deepEqual(result.nextEdges, [{ a: "editor-2", b: "map-2", mode: "context" }]);
});

test("deriveLegacyMapLinks resolves indirect editor/explorer links through the graph", () => {
  const frames = [map, editor, explorer];
  const edges = mergeLinkPlan([], computeLinkPlan([editor, explorer])!);
  const linked = deriveLegacyMapLinks(
    frames,
    mergeLinkPlan(edges, { edges: [{ a: "map-1", b: "editor-1", mode: "context" }] }),
  );
  assert.deepEqual(linked.editorLinks, { "editor-1": "map-1" });
  assert.deepEqual(linked.explorerLinks, { "explorer-1": "map-1" });
});

test("Logic Gate Arena template creates editor and kanban root modules", () => {
  const frames = createLogicGateArenaFrames();
  assert.deepEqual(frames.map((frame) => frame.kind), ["editor", "kanban"]);
  assert.equal(frames.every((frame) => !frame.parentId), true);
  const plan = computeLinkPlan(frames);
  assert.equal(plan?.edges.length, 1);
});
