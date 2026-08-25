import test from "node:test";
import assert from "node:assert/strict";
import { createLogicGateArenaFrames } from "../../../frontend/src/app/DefaultViews.js";
import { buildLinkModulesLabel, buildLinkPool, classifyFrameKind, computeLinkPlan, delinkForPool, mergeLinkPlan } from "../../../frontend/src/app/frameLinking.js";
import { loadViews } from "../../../frontend/src/app/useFramePersistence.js";
import { readPendingLogicGateArenaSelection } from "../../../frontend/src/pages/logic-gate-arena/logicGateArenaLaunch.js";
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

test("persisted Logic Gate Arena tabs are renamed to Process Arena", () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const legacyFrames = createLogicGateArenaFrames().map((frame) => ({
    ...frame,
    title: "Logic Gate Kanban",
  }));
  const values = new Map<string, string>([[
    "grid-dashboard-views-v1",
    JSON.stringify({
      tabs: [{ id: "legacy-arena", name: "Logic Gate Arena", frames: legacyFrames }],
      activeId: "legacy-arena",
    }),
  ]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  try {
    const loaded = loadViews();
    const arena = loaded.tabs.find((tab) => tab.id === "legacy-arena");
    assert.equal(arena?.name, "Process Arena");
    assert.equal(arena?.page, "logic-gate-arena");
    assert.equal(loaded.tabs.filter((tab) => tab.page === "logic-gate-arena").length, 1);
    assert.equal(arena?.frames.find((frame) => frame.kind === "kanban")?.title, "Process Kanban");
    assert.equal(arena?.frames.find((frame) => frame.kind === "editor")?.title, "Logic Gate Kanban");
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("persisted arena fallback labels are renamed without changing Process names", () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const key = "mangorts.logic-gate-arena.pending-selection.v1:company-1";
  const values = new Map<string, string>([[key, JSON.stringify({
    logicGateID: "gate-legacy",
    label: "Logic Gate",
    createdAt: 1,
  })]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (storageKey: string) => values.get(storageKey) ?? null },
  });
  try {
    assert.equal(readPendingLogicGateArenaSelection("company-1")?.label, "Process");
    values.set(key, JSON.stringify({ logicGateID: "gate-custom", label: "Logic Gate review", createdAt: 2 }));
    assert.equal(readPendingLogicGateArenaSelection("company-1")?.label, "Logic Gate review");
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
