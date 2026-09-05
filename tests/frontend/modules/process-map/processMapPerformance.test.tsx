import assert from "node:assert/strict";
import test from "node:test";

import { OrthographicViewport, type Layer } from "../../../../frontend/node_modules/@deck.gl/core/dist/index.js";
import {
  buildProcessMapLayers,
  mergeTilePresentation,
  mergeProcessMapPresentation,
  prioritizeProcessMapValidationTiles,
  processMapFolderChildTops,
  type ProcessMapLayerBuildOptions,
  type ProcessMapPlacementTransform,
} from "../../../../frontend/src/modules/process-map/ProcessMapSurface.js";
import {
  fetchProcessMapTile,
  invalidateProcessMapReadCaches,
  type ProcessMapVisiblePlacement,
  type ProcessMapTileResponse,
  type ProcessMapTileVersion,
  PROCESS_MAP_MAX_VALIDATION_TILES,
} from "../../../../frontend/src/modules/process-map/processMapApi.js";

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

test("presentation merging shares frozen reads and reuses fragment keys without changing deduplication", async () => {
  const apiBase = "https://process-map-merge-ownership.test";
  const originalFetch = globalThis.fetch;
  const process = placement("shared-process");
  let fragmentSerializations = 0;
  globalThis.fetch = (async (input) => {
    const x = Number(new URL(String(input)).pathname.split("/").at(-2));
    return new Response(JSON.stringify({
      z: 22, x, y: 0, process_map_read_version: 1,
      placements: [{ ...process, presentation: x === 0 ? "normal" : "editing" }],
      traces: [{
        presentation: "editing", resource_operational_relationship_id: "shared-trace",
        source: { resource_type: "logic_gate", resource_id: "shared-process" },
        target: { resource_type: "logic_gate", resource_id: "target" },
        route_points: [{ x: 14, y: 4 }],
        path_fragments: x === 0
          ? [[{ x: 0, y: 4 }, { x: 14, y: 4 }]]
          : [[{ x: 0, y: 4 }, { x: 14, y: 4 }], [{ x: 14, y: 4 }, { x: 28, y: 4 }]],
        revision: 1, created_timestamp: "created", updated_timestamp: "updated",
      }],
    }));
  }) as typeof fetch;
  try {
    const tiles = await Promise.all([0, 1].map((x) => fetchProcessMapTile(apiBase, "company", 1, 22, x, 0)));
    const countedTiles = tiles.map((tile): ProcessMapTileResponse => {
      const fragments = tile.traces[0].path_fragments.map((fragment) => new Proxy(fragment, {
        get(target, property, receiver) {
          if (property === "map") fragmentSerializations += 1;
          return Reflect.get(target, property, receiver);
        },
      }));
      Object.freeze(fragments);
      return Object.freeze({ ...tile, traces: Object.freeze([Object.freeze({ ...tile.traces[0], path_fragments: fragments })]) });
    });
    const inputs = new Map(countedTiles.map((tile) => [String(tile.x), tile]));
    const merged = mergeTilePresentation(inputs);
    assert.equal(merged.placements.get(key(process)), tiles[1].placements[0], "the higher presentation wins without copying its immutable object");
    const trace = merged.traces.get("shared-trace");
    assert.ok(trace);
    assert.equal(trace.route_points, tiles[0].traces[0].route_points);
    assert.deepEqual(trace.path_fragments, [[{ x: 0, y: 4 }, { x: 14, y: 4 }], [{ x: 14, y: 4 }, { x: 28, y: 4 }]]);
    assert.equal(trace.path_fragments[0], countedTiles[0].traces[0].path_fragments[0]);
    assert.equal(trace.path_fragments[1], countedTiles[1].traces[0].path_fragments[1]);
    assert.equal(Reflect.set(trace.path_fragments[0][0], "x", 99), false);
    assert.equal(fragmentSerializations, 3, "each distinct immutable fragment computes its key once");
    assert.deepEqual(mergeTilePresentation(inputs), merged);
    assert.equal(fragmentSerializations, 3, "another arrival/merge reuses the existing fragments' keys");
    assert.equal(mergeProcessMapPresentation(merged, { placements: new Map(), traces: new Map(), removedPlacementKeys: new Set() }, new Map(), new Map(), new Set()), merged,
      "an idle presentation does not copy the full resident maps");
  } finally {
    globalThis.fetch = originalFetch;
    invalidateProcessMapReadCaches(apiBase, "company");
  }
});

test("validation overflow prioritizes visible fractional-zoom negative tiles before retained history", () => {
  const scene = options([]).scene;
  const viewport = new OrthographicViewport({ width: 400, height: 300, target: [-330, -170, 0], zoom: -0.4 });
  const history: ProcessMapTileVersion[] = Array.from({ length: PROCESS_MAP_MAX_VALIDATION_TILES }, (_, index) => ({
    z: 22, x: 2_000 - index, y: 2_000, process_map_read_version: 1,
  }));
  const visible: ProcessMapTileVersion = { z: 22, x: -2, y: -1, process_map_read_version: 1 };
  const ancestor: ProcessMapTileVersion = { z: 21, x: -1, y: -1, process_map_read_version: 1 };
  const candidates = [...history, ancestor, visible];
  const prioritized = prioritizeProcessMapValidationTiles(candidates, scene, viewport);
  assert.equal(prioritized.length, PROCESS_MAP_MAX_VALIDATION_TILES);
  assert.equal(prioritized[0], visible, "ceil(camera zoom + max tile zoom) gives current z22 coverage at negative fractional zoom");
  assert.equal(prioritized[1], ancestor, "visible coarser coverage precedes every offscreen tile");
  assert.equal(prioritized[2], history.at(-1), "the nearest offscreen coverage fills remaining capacity first");
  assert.equal(candidates[0], history[0], "prioritization leaves cache insertion order untouched");
  assert.equal(candidates.at(-1), visible);
  const bounded = candidates.slice(0, PROCESS_MAP_MAX_VALIDATION_TILES);
  Object.freeze(bounded);
  assert.equal(prioritizeProcessMapValidationTiles(bounded, scene, {
    zoom: -0.4, getBounds: () => { throw new Error("bounded validation must not inspect or sort the camera coverage"); },
  }), bounded);
});
