import test from "node:test";
import assert from "node:assert/strict";
import { buildLinkModulesLabel, buildLinkPool, computeLinkPlan, delinkForPool } from "./frameLinking.js";
import type { FrameDataModel } from "../types.js";

const map: FrameDataModel = { id: "map-1", kind: "nodes-map", title: "Node Map", x: 0, y: 0, w: 8, h: 8, color: "#fff", accent: "#111" };
const editor: FrameDataModel = { id: "editor-1", kind: "editor", title: "Editor", x: 0, y: 0, w: 8, h: 8, color: "#fff", accent: "#111" };
const explorer: FrameDataModel = { id: "explorer-1", kind: "company-explorer", title: "Company Explorer", x: 0, y: 0, w: 8, h: 8, color: "#fff", accent: "#111" };

test("link menu label falls back to no-other-selected when only one frame is in pool", () => {
  const label = buildLinkModulesLabel([map], null);
  assert.equal(label, "No other module selected");
});

test("computeLinkPlan links editor + explorer through existing linked map fallback", () => {
  const plan = computeLinkPlan([editor, explorer], { "editor-1": "map-1" }, {});
  assert.deepEqual(plan, {
    mapFrameID: "map-1",
    editorFrameIDs: ["editor-1"],
    explorerFrameIDs: ["explorer-1"],
  });
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
    { "editor-1": "map-1", "editor-2": "map-2" },
    { "explorer-1": "map-1", "explorer-2": "map-2" },
  );
  assert.equal(result.changed, true);
  assert.deepEqual(result.nextEditorLinks, { "editor-2": "map-2" });
  assert.deepEqual(result.nextExplorerLinks, { "explorer-2": "map-2" });
});

