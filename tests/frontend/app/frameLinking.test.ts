import test from "node:test";
import assert from "node:assert/strict";
import { createLogicGateArenaFrames } from "../../../frontend/src/app/DefaultViews.js";
import { buildLinkModulesLabel, buildLinkPool, classifyFrameKind, computeLinkPlan, delinkForPool, mergeLinkPlan } from "../../../frontend/src/app/frameLinking.js";
import type { FrameDataModel } from "../../../frontend/src/types.js";

const editor: FrameDataModel = { id: "editor-1", kind: "editor", title: "Editor", x: 0, y: 0, w: 8, h: 8, color: "#fff", accent: "#111" };
const explorer: FrameDataModel = { id: "explorer-1", kind: "company-explorer", title: "Explorer", x: 0, y: 0, w: 8, h: 8, color: "#fff", accent: "#111" };
const kanban: FrameDataModel = { id: "kanban-1", kind: "kanban", title: "Kanban board", x: 0, y: 0, w: 8, h: 8, color: "#fff", accent: "#111" };

test("link menu label falls back when only one frame is in the pool", () => {
  assert.equal(buildLinkModulesLabel([editor], null), "No other module selected");
});

test("computeLinkPlan builds pairwise context links for surviving modules", () => {
  const plan = computeLinkPlan([editor, explorer, kanban]);
  assert.deepEqual(plan, { edges: [
    { a: "editor-1", b: "explorer-1", mode: "context" },
    { a: "editor-1", b: "kanban-1", mode: "context" },
    { a: "explorer-1", b: "kanban-1", mode: "context" },
  ] });
});

test("only surviving frame kinds participate in context linking", () => {
  assert.equal(classifyFrameKind("editor"), "editor");
  assert.equal(classifyFrameKind("company-explorer"), "explorer");
  assert.equal(classifyFrameKind("kanban"), "kanban");
  assert.equal(classifyFrameKind("retired-kind"), null);
});

test("buildLinkPool falls back to the context frame", () => {
  const pool = buildLinkPool({ frames: [editor, explorer], selectedFrameIds: new Set(), selectedFrameId: null, contextFrameId: "editor-1" });
  assert.deepEqual(pool.map((item) => item.id), ["editor-1"]);
});

test("delinkForPool removes links touching the selected frame", () => {
  const result = delinkForPool([editor], [
    { a: "editor-1", b: "explorer-1", mode: "context" },
    { a: "explorer-1", b: "kanban-1", mode: "context" },
  ]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.nextEdges, [{ a: "explorer-1", b: "kanban-1", mode: "context" }]);
});

test("mergeLinkPlan deduplicates existing links", () => {
  assert.deepEqual(mergeLinkPlan([{ a: "editor-1", b: "explorer-1", mode: "context" }], computeLinkPlan([editor, explorer])), [
    { a: "editor-1", b: "explorer-1", mode: "context" },
  ]);
});

test("Logic Gate Arena creates editor and Kanban root modules", () => {
  const frames = createLogicGateArenaFrames();
  assert.deepEqual(frames.map((frame) => frame.kind), ["editor", "kanban"]);
  assert.equal(frames.every((frame) => !frame.parentId), true);
  assert.equal(computeLinkPlan(frames)?.edges.length, 1);
});