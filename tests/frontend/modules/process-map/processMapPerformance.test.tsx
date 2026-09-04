import assert from "node:assert/strict";
import test from "node:test";

import type { Layer } from "../../../../frontend/node_modules/@deck.gl/core/dist/index.js";
import {
  buildProcessMapLayers,
  processMapFolderChildTops,
  type ProcessMapLayerBuildOptions,
  type ProcessMapPlacementTransform,
} from "../../../../frontend/src/modules/process-map/ProcessMapSurface.js";
import type { ProcessMapVisiblePlacement } from "../../../../frontend/src/modules/process-map/processMapApi.js";

function key(placement: ProcessMapVisiblePlacement): string {
  return `${placement.resource_type}:${placement.resource_id}`;
}

function placement(id: string, x = 0, y = 0): ProcessMapVisiblePlacement {
  return {
    restricted: false,
    presentation: "editing",
    resource_type: "logic_gate",
    resource_id: id,
    name: id,
    map_parent_folder_id: null,
    grid_x: x,
    grid_y: y,
    grid_width: 14,
    grid_height: 8,
    can_edit: true,
    revision: 1,
    created_timestamp: "created",
    updated_timestamp: "updated",
  };
}

class LookupOnlyMap<K, V> extends Map<K, V> {
  lookups = 0;

  override get(key: K): V | undefined {
    this.lookups += 1;
    return super.get(key);
  }

  override values(): ReturnType<Map<K, V>["values"]> {
    throw new Error("an overlay update must not visit every resident placement");
  }

  override keys(): ReturnType<Map<K, V>["keys"]> {
    throw new Error("an overlay update must not visit every resident key");
  }

  override entries(): ReturnType<Map<K, V>["entries"]> {
    throw new Error("an overlay update must not visit every resident entry");
  }

  override [Symbol.iterator](): ReturnType<Map<K, V>["entries"]> {
    return this.entries();
  }

  override forEach(): void {
    throw new Error("an overlay update must not visit every resident placement");
  }
}

function options(placements: ProcessMapVisiblePlacement[]): ProcessMapLayerBuildOptions {
  return {
    scene: {
      bounds: { min_x: 0, min_y: 0, max_x: 4_096, max_y: 4_096 },
      process_map_read_version: 1,
      tile_size: 256,
      min_tile_zoom: 0,
      max_tile_zoom: 22,
    },
    protectedGeneration: 0,
    scoreCardBusinessDate: "2026-09-04",
    settled: true,
    settledPixelsPerGridUnit: 16,
    presentation: {
      placements: new LookupOnlyMap(placements.map((item) => [key(item), item])),
      traces: new Map(),
      removedPlacementKeys: new Set(),
    },
    folderChildTops: processMapFolderChildTops(placements),
    validatedTiles: null,
    editedPlacementKeys: new Set(),
    editedTraceIDs: new Set(),
    editOverlay: {
      placements: [],
      traces: [],
      selectedPlacementKey: null,
      selectedTraceID: null,
      hoveredPlacementKey: null,
      connectionPreview: null,
      highlightedFolderKey: null,
      connectionSourceKey: null,
      placementTransform: null,
    },
    getTileData: async () => null,
    onTileLoad: () => undefined,
    onTileUnload: () => undefined,
  };
}

function data<T>(layers: Layer[], id: string): T[] {
  const layer = layers.find((candidate) => candidate.id === id);
  assert.ok(layer, `missing layer ${id}`);
  return layer.props.data as T[];
}

type Control = { position: [number, number]; pick: { key: string; anchor?: "input" | "output" } };
type Label = { text: string; position: [number, number] };

test("idle, hover, selection, and one-Process movement use bounded lookups among 20,000 residents", (t) => {
  const placements = Array.from({ length: 20_000 }, (_, index) => ({
    ...placement(`process-${index}`, index % 100 * 20, Math.floor(index / 100) * 12),
    map_parent_folder_id: `folder-${Math.floor(index / 100)}`,
  }));
  const process = placements[0];
  const processKey = key(process);
  const build = options(placements);
  const residents = build.presentation.placements as LookupOnlyMap<string, ProcessMapVisiblePlacement>;

  for (const state of ["idle", "hover", "selected", "move"] as const) {
    const selected = state === "selected" || state === "move";
    build.editOverlay = {
      ...build.editOverlay,
      placements: selected ? [process] : [],
      selectedPlacementKey: selected ? processKey : null,
      hoveredPlacementKey: state === "hover" ? processKey : null,
      placementTransform: state === "move" ? {
        kind: "move", key: processKey, placementKeys: new Set([processKey]), traceIDs: new Set(),
        basePlacements: new Map([[processKey, process]]), deltaX: 3, deltaY: 2,
      } : null,
    };
    build.editedPlacementKeys = new Set(selected ? [processKey] : []);
    residents.lookups = 0;
    const layers = buildProcessMapLayers(build);
    const controls = data<Control>(layers, "process-map-edit-anchors");
    const grips = data<Control>(layers, "process-map-edit-resize-handles");
    assert.equal(controls.length, state === "idle" ? 0 : 2);
    assert.equal(grips.length, state === "idle" ? 0 : 4);
    assert.ok([...controls, ...grips].every((item) => item.pick.key === processKey));
    assert.ok(residents.lookups <= 12, `${state} must use a fixed number of placement lookups`);
    if (state === "move") {
      assert.deepEqual(controls.map((item) => item.position), [[3, 6], [17, 6]]);
      const bodies = data<{ polygon: number[][] }>(layers, "process-map-edit-placement-bodies");
      assert.deepEqual(bodies[0].polygon[0], [3, 2]);
    }
    t.diagnostic(JSON.stringify({ resident_placements: placements.length, state, whole_map_visits: 0, placement_lookups: residents.lookups }));
  }
});

test("connection mode retains eligible target inputs and excludes whole-LOD controls", () => {
  const source = placement("source");
  const target = { ...placement("target", 20), resource_type: "company_explorer_folder" as const };
  const hidden = { ...placement("whole", 40), presentation: "whole" as const };
  const build = options([source, target, hidden]);
  // Showing every eligible target is intentional in connection mode.
  build.presentation.placements = new Map([source, target, hidden].map((item) => [key(item), item]));
  build.editOverlay = {
    ...build.editOverlay,
    placements: [source],
    selectedPlacementKey: key(source),
    hoveredPlacementKey: key(target),
    connectionSourceKey: key(source),
    connectionPreview: { source, point: { x: 20, y: 4 } },
  };
  const layers = buildProcessMapLayers(build);
  const anchors = data<Control>(layers, "process-map-edit-anchors");
  assert.deepEqual(anchors.map((item) => [item.pick.key, item.pick.anchor]), [[key(source), "output"], [key(target), "input"]]);
  assert.deepEqual(data(layers, "process-map-edit-resize-handles"), []);
  assert.equal(data(layers, "process-map-edit-traces").length, 1);
});

test("Folder title clearance follows the next stationary child when the lowest child moves", () => {
  const folder: ProcessMapVisiblePlacement = {
    ...placement("folder"), resource_type: "company_explorer_folder", grid_width: 200, grid_height: 160,
  };
  const children = [14, 16, 18].map((y, index) => ({
    ...placement(`child-${index}`, 20, y), map_parent_folder_id: folder.resource_id,
  }));
  const build = options([folder, ...children]);
  build.settledPixelsPerGridUnit = 1;
  build.editOverlay.placements = [folder];
  const labelY = (transform: ProcessMapPlacementTransform | null): number => {
    build.editOverlay.placementTransform = transform;
    const label = data<Label>(buildProcessMapLayers(build), "process-map-edit-labels").find((item) => item.text === folder.name);
    assert.ok(label);
    return label.position[1];
  };
  assert.equal(labelY(null), 7);
  const moveChild = (moved: ProcessMapVisiblePlacement, deltaY: number): ProcessMapPlacementTransform => ({
    kind: "move", key: key(moved), placementKeys: new Set([key(moved)]), traceIDs: new Set(),
    basePlacements: new Map([[key(moved), moved]]), deltaX: 0, deltaY,
  });
  assert.equal(labelY(moveChild(children[0], 12)), 8, "the second child limits the title when the first moves down");
  assert.equal(labelY(moveChild(children[1], -3)), 6.5, "a child moved above its sibling becomes the title limit");
});

test("moving or resizing a complete Folder subtree keeps its title above transformed children", () => {
  const folder: ProcessMapVisiblePlacement = {
    ...placement("folder"), resource_type: "company_explorer_folder", grid_width: 200, grid_height: 160,
  };
  const child = { ...placement("child", 20, 14), map_parent_folder_id: folder.resource_id };
  const build = options([folder, child]);
  build.settledPixelsPerGridUnit = 1;
  build.editOverlay.placements = [folder, child];
  const transform: ProcessMapPlacementTransform = {
    kind: "move", key: key(folder), placementKeys: new Set([key(folder), key(child)]), traceIDs: new Set(),
    basePlacements: new Map([[key(folder), folder], [key(child), child]]), deltaX: 10, deltaY: 5,
  };
  for (const [current, expectedY] of [
    [transform, 12],
    [{ ...transform, kind: "resize", deltaX: 0, deltaY: 160, horizontal: "east", vertical: "south" }, 14],
  ] as Array<[ProcessMapPlacementTransform, number]>) {
    build.editOverlay.placementTransform = current;
    const label = data<Label>(buildProcessMapLayers(build), "process-map-edit-labels").find((item) => item.text === folder.name);
    assert.ok(label);
    assert.equal(label.position[1], expectedY);
  }
});
