import assert from "node:assert/strict";
import test from "node:test";

import type { Layer } from "@deck.gl/core";
import {
  applyProcessMapMutationEnvelope,
  buildProcessMapLayers,
  mergeProcessMapPresentation,
  ProcessMapProtectedTileLayer,
  processMapCurrentOperationKeys,
  processMapPerimeterSegments,
  processMapViewportHasCompleteCoverage,
  reconcileProcessMapKnownMappedKeys,
  replaceProcessMapPreviewEntries,
  retireProcessMapMutationMasks,
  type ProcessMapLayerBuildOptions,
  type ProcessMapPresentationState,
} from "../../../../frontend/src/modules/process-map/ProcessMapSurface.js";
import type {
  ProcessMapMutationEnvelope,
  ProcessMapSceneResponse,
  ProcessMapTileResponse,
  ProcessMapTrace,
  ProcessMapVisiblePlacement,
} from "../../../../frontend/src/modules/process-map/processMapApi.js";
import {
  fetchProcessMapScene,
  fetchProcessMapTile,
  getProcessMapReadCacheStats,
  invalidateProcessMapReadCaches,
} from "../../../../frontend/src/modules/process-map/processMapApi.js";
import {
  PROCESS_MAP_DEFAULT_HEIGHT,
  PROCESS_MAP_DEFAULT_WIDTH,
  PROCESS_MAP_EDITING_LOD_MIN_PX,
  PROCESS_MAP_MAX_CAMERA_ZOOM,
  PROCESS_MAP_MAX_TILE_REQUESTS,
  PROCESS_MAP_MIN_CAMERA_ZOOM,
  PROCESS_MAP_NORMAL_LOD_MIN_PX,
  PROCESS_MAP_SAFE_WORLD_COORDINATE,
  PROCESS_MAP_SETTLE_DELAY_MS,
  PROCESS_MAP_TILE_CACHE_BYTES,
  PROCESS_MAP_TILE_DEBOUNCE_MS,
  PROCESS_MAP_TILE_SIZE,
  fitProcessMapViewState,
  processMapDeckTileSize,
  processMapPlacementLOD,
} from "../../../../frontend/src/modules/process-map/processMapGeometry.js";
import { createProcessMapSettlementGate } from "../../../../frontend/src/modules/process-map/processMapInteraction.js";

function placement(id: string, x: number, y: number, width = 10, height = 6, resourceType: "logic_gate" | "company_explorer_folder" = "logic_gate"): ProcessMapVisiblePlacement {
  return {
    restricted: false,
    presentation: "editing",
    resource_type: resourceType,
    resource_id: id,
    name: id,
    map_parent_folder_id: null,
    grid_x: x,
    grid_y: y,
    grid_width: width,
    grid_height: height,
    can_edit: true,
    revision: 5,
    created_timestamp: "created",
    updated_timestamp: "updated",
  };
}

function trace(source: ProcessMapVisiblePlacement, target: ProcessMapVisiblePlacement): ProcessMapTrace {
  return {
    presentation: "editing",
    resource_operational_relationship_id: "relationship-1",
    source: { resource_type: source.resource_type, resource_id: source.resource_id },
    target: { resource_type: target.resource_type, resource_id: target.resource_id },
    route_points: [{ x: 15, y: 3 }],
    path_fragments: [[{ x: 10, y: 3 }, { x: 20, y: 3 }]],
    revision: 4,
    created_timestamp: "created",
    updated_timestamp: "updated",
  };
}

const scene: ProcessMapSceneResponse = {
  bounds: { min_x: 0, min_y: 0, max_x: 256, max_y: 256 },
  process_map_read_version: 11,
  tile_size: 256,
  min_tile_zoom: 0,
  max_tile_zoom: 22,
};

function emptyPresentation(): ProcessMapPresentationState {
  return { placements: new Map(), traces: new Map(), removedPlacementKeys: new Set() };
}

function buildOptions(overrides: Partial<ProcessMapLayerBuildOptions> = {}): ProcessMapLayerBuildOptions {
  return {
    scene,
    protectedGeneration: 0,
    settled: true,
    settledGeneration: 3,
    settledPixelsPerGridUnit: 0.25,
    presentation: emptyPresentation(),
    editedPlacementKeys: new Set(),
    editedTraceIDs: new Set(),
    editOverlay: {
      placements: [], traces: [], selectedPlacementKey: null, selectedTraceID: null,
      connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null,
    },
    getTileData: async () => null,
    onTileLoad: () => undefined,
    onTileUnload: () => undefined,
    ...overrides,
  };
}

function layerByID(layers: Layer[], id: string): Layer {
  const layer = layers.find((candidate) => candidate.id === id);
  assert.ok(layer, `missing layer ${id}`);
  return layer;
}

function assertFlatXYPathLayer(layer: Layer): void {
  assert.equal(layer.props.positionFormat, "XY", `${layer.id} must declare its flat coordinates as XY`);
  const data = layer.props.data as Array<{ path: number[][] }>;
  assert.ok(data.length > 0, `${layer.id} needs path data in this fixture`);
  const getPath = layer.props.getPath as (item: { path: number[][] }) => number[];
  const flatPath = getPath(data[0]);
  assert.ok(flatPath.length >= 4 && flatPath.length % 2 === 0, `${layer.id} must yield complete XY pairs`);
  assert.ok(flatPath.every(Number.isFinite), `${layer.id} must yield finite coordinates`);
}

test("one TileLayer owns non-geographic selection, bounded scheduling, and the settled read gate", async () => {
  let reads = 0;
  const payload: ProcessMapTileResponse = { z: 22, x: 0, y: 0, process_map_read_version: 11, placements: [], traces: [], byteLength: 100 };
  const unsettled = buildProcessMapLayers(buildOptions({
    settled: false,
    getTileData: async () => { reads += 1; return payload; },
  }));
  const unsettledTiles = layerByID(unsettled, "process-map-spatial-tiles");
  assert.equal(unsettled.filter((layer) => layer.id === "process-map-spatial-tiles").length, 1);
  const getUnsettled = unsettledTiles.props.getTileData as unknown as (request: { id: string; index: { z: number; x: number; y: number }; signal: AbortSignal }) => Promise<ProcessMapTileResponse | null> | null;
  assert.equal(getUnsettled({ id: "22-0-0", index: { z: 22, x: 0, y: 0 }, signal: new AbortController().signal }), null);
  assert.equal(reads, 0, "interim wheel and pan candidates must not schedule business reads");

  const settled = buildProcessMapLayers(buildOptions({ getTileData: async () => { reads += 1; return payload; } }));
  const tiles = layerByID(settled, "process-map-spatial-tiles");
  assert.equal(tiles.props.tileSize, processMapDeckTileSize(scene.tile_size, scene.max_tile_zoom));
  assert.equal(tiles.props.zoomOffset, scene.max_tile_zoom);
  assert.equal(tiles.props.maxCacheByteSize, PROCESS_MAP_TILE_CACHE_BYTES);
  assert.ok(Number(tiles.props.maxRequests) > 0 && Number(tiles.props.maxRequests) <= 16);
  const getSettled = tiles.props.getTileData as unknown as (request: { id: string; index: { z: number; x: number; y: number }; signal: AbortSignal }) => Promise<ProcessMapTileResponse | null>;
  assert.equal(await getSettled({ id: "22-0-0", index: { z: 22, x: 0, y: 0 }, signal: new AbortController().signal }), payload);
  assert.equal(reads, 1);
});

test("protected generations keep one logical TileLayer while replacing and disposing protected Tilesets", () => {
  const first = layerByID(buildProcessMapLayers(buildOptions({ protectedGeneration: 0 })), "process-map-spatial-tiles");
  const second = layerByID(buildProcessMapLayers(buildOptions({ protectedGeneration: 1 })), "process-map-spatial-tiles");
  assert.equal(first.id, second.id, "the deck layer identity remains stable across protected generations");
  assert.equal(first.props.data, "11:0");
  assert.equal(second.props.data, "11:1");
  assert.deepEqual(first.props.updateTriggers?.getTileData, [3, 11, 0]);
  assert.deepEqual(second.props.updateTriggers?.getTileData, [3, 11, 1]);

  const parent = Object.getPrototypeOf(ProcessMapProtectedTileLayer.prototype) as { updateState: (params: unknown) => void };
  const originalParentUpdate = parent.updateState;
  let parentUpdates = 0;
  let finalizes = 0;
  const fake = {
    state: { tileset: { finalize: () => { finalizes += 1; } }, isLoaded: true },
    setState(next: Record<string, unknown>) { this.state = { ...this.state, ...next }; },
  };
  parent.updateState = () => { parentUpdates += 1; };
  try {
    ProcessMapProtectedTileLayer.prototype.updateState.call(fake as never, {
      oldProps: { protectedGeneration: 4 },
      props: { protectedGeneration: 4 },
    } as never);
    assert.equal(finalizes, 0);
    ProcessMapProtectedTileLayer.prototype.updateState.call(fake as never, {
      oldProps: { protectedGeneration: 4 },
      props: { protectedGeneration: 5 },
    } as never);
    assert.equal(finalizes, 1, "permission generation changes must finalize the old protected Tileset");
    assert.equal(fake.state.tileset, null);
    assert.equal(fake.state.isLoaded, false);
    assert.equal(parentUpdates, 2);
  } finally {
    parent.updateState = originalParentUpdate;
  }
});

test("known mapped keys accumulate by exact identity and preview replacement preserves unrelated operations", () => {
  const folder = { resource_type: "company_explorer_folder" as const, resource_id: "folder-1" };
  const process = { resource_type: "logic_gate" as const, resource_id: "process-1" };
  const another = { resource_type: "logic_gate" as const, resource_id: "process-2" };
  const empty = new Set<string>();
  const first = reconcileProcessMapKnownMappedKeys(empty, [folder]);
  const accumulated = reconcileProcessMapKnownMappedKeys(first, [process, another]);
  assert.deepEqual([...accumulated].sort(), [
    "company_explorer_folder:folder-1",
    "logic_gate:process-1",
    "logic_gate:process-2",
  ]);
  const removed = reconcileProcessMapKnownMappedKeys(accumulated, [], [folder, another]);
  assert.deepEqual([...removed], ["logic_gate:process-1"]);
  assert.deepEqual([...accumulated].sort(), [
    "company_explorer_folder:folder-1",
    "logic_gate:process-1",
    "logic_gate:process-2",
  ], "reconciliation returns a new scoped set");

  const previews = new Map([["unrelated", "keep"], ["owned-a", "old-a"], ["owned-b", "old-b"]]);
  const replaced = replaceProcessMapPreviewEntries(previews, ["owned-a", "owned-b"], new Map([["owned-a", "new-a"]]));
  assert.deepEqual([...replaced], [["unrelated", "keep"], ["owned-a", "new-a"]]);
  assert.deepEqual([...previews], [["unrelated", "keep"], ["owned-a", "old-a"], ["owned-b", "old-b"]]);
});

test("whole-company tile rendering keeps every placement perceptible without leaking restricted picks", () => {
  const process = placement("Process", 10, 10);
  const folder = placement("Folder", 0, 0, 80, 60, "company_explorer_folder");
  const tileData: ProcessMapTileResponse = {
    z: 0, x: 0, y: 0, process_map_read_version: 11, byteLength: 1,
    placements: [folder, process, { restricted: true, grid_x: 100, grid_y: 20 }],
    traces: [],
  };
  const tileLayer = layerByID(buildProcessMapLayers(buildOptions()), "process-map-spatial-tiles");
  const render = tileLayer.props.renderSubLayers as unknown as (props: { id: string; data: ProcessMapTileResponse; tile: { boundingBox: [number[], number[]] } }) => Layer[];
  const sublayers = render({ id: "tile", data: tileData, tile: { boundingBox: [[0, 0], [256, 256]] } });
  const bodies = layerByID(sublayers, "tile-placements");
  const fences = layerByID(sublayers, "tile-folder-fences");
  const restricted = layerByID(sublayers, "tile-restricted");
  const labels = layerByID(sublayers, "tile-labels");
  assert.equal((bodies.props.data as unknown[]).length, 1, "only the Process needs a filled body at whole-company LOD");
  assert.ok((fences.props.data as unknown[]).length > 0, "transparent Folder perimeter remains visible");
  assert.equal((restricted.props.data as unknown[]).length, 1);
  assert.equal(restricted.props.pickable, false);
  const texts = (labels.props.data as Array<{ text: string }>).map((item) => item.text);
  assert.deepEqual(texts, ["?"], "whole LOD suppresses names but retains a permission-safe placeholder");
});

test("Folder labels use the inside top edge while Process labels remain centered", () => {
  const folder = placement("folder-label", 0, 0, 80, 60, "company_explorer_folder");
  const process = placement("process-label", 100, 0, 80, 60);
  const tileData: ProcessMapTileResponse = {
    z: 22, x: 0, y: 0, process_map_read_version: 11, byteLength: 1,
    placements: [folder, process],
    traces: [],
  };
  const tileLayer = layerByID(buildProcessMapLayers(buildOptions({ settledPixelsPerGridUnit: 0.5 })), "process-map-spatial-tiles");
  const render = tileLayer.props.renderSubLayers as unknown as (props: { id: string; data: ProcessMapTileResponse; tile: { boundingBox: [number[], number[]] } }) => Layer[];
  const sublayers = render({ id: "normal-labels", data: tileData, tile: { boundingBox: [[0, 0], [256, 256]] } });
  const labels = layerByID(sublayers, "normal-labels-labels").props.data as Array<{ position: [number, number]; text: string }>;
  const folderLabel = labels.find((item) => item.text === folder.name);
  const processLabel = labels.find((item) => item.text === process.name);
  assert.ok(folderLabel && processLabel);
  assert.ok(folderLabel.position[1] > folder.grid_y && folderLabel.position[1] < folder.grid_y + folder.grid_height / 2);
  assert.equal(processLabel.position[1], process.grid_y + process.grid_height / 2);
});

test("every Process Map PathLayer declares and yields flat XY geometry", () => {
  const source = placement("source", 10, 10);
  const target = placement("target", 40, 10);
  const folder = placement("folder", 0, 0, 80, 60, "company_explorer_folder");
  const relationship = trace(source, target);
  const tileData: ProcessMapTileResponse = {
    z: 22,
    x: 0,
    y: 0,
    process_map_read_version: 11,
    byteLength: 1,
    placements: [folder, source, target, { restricted: true, grid_x: 100, grid_y: 20 }],
    traces: [relationship],
  };
  const tileLayer = layerByID(buildProcessMapLayers(buildOptions({ settledPixelsPerGridUnit: 24 })), "process-map-spatial-tiles");
  const render = tileLayer.props.renderSubLayers as unknown as (props: {
    id: string;
    data: ProcessMapTileResponse;
    tile: { boundingBox: [number[], number[]] };
  }) => Layer[];
  const tileLayers = render({ id: "xy-tile", data: tileData, tile: { boundingBox: [[0, 0], [256, 256]] } });
  for (const id of [
    "xy-tile-traces",
    "xy-tile-folder-fences",
    "xy-tile-process-perimeters",
    "xy-tile-restricted-perimeters",
  ]) assertFlatXYPathLayer(layerByID(tileLayers, id));

  const presentation: ProcessMapPresentationState = {
    placements: new Map([
      ["company_explorer_folder:folder", folder],
      ["logic_gate:source", source],
      ["logic_gate:target", target],
    ]),
    traces: new Map([[relationship.resource_operational_relationship_id, relationship]]),
    removedPlacementKeys: new Set(),
  };
  const editLayers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 24,
    presentation,
    editedPlacementKeys: new Set(["company_explorer_folder:folder"]),
    editedTraceIDs: new Set([relationship.resource_operational_relationship_id]),
    editOverlay: {
      placements: [folder],
      traces: [relationship],
      selectedPlacementKey: "company_explorer_folder:folder",
      selectedTraceID: relationship.resource_operational_relationship_id,
      connectionPreview: { source, point: { x: 35, y: 28 } },
      highlightedFolderKey: "company_explorer_folder:folder",
      connectionSourceKey: "logic_gate:source",
    },
  }));
  const editTraceLayer = layerByID(editLayers, "process-map-edit-traces");
  assertFlatXYPathLayer(editTraceLayer);
  assertFlatXYPathLayer(layerByID(editLayers, "process-map-edit-folder-fences"));
  const colors = (editTraceLayer.props.data as Array<{ color: number[] }>).map((item) => item.color);
  assert.notDeepEqual(colors[0], colors[colors.length - 1], "saved and pending traces retain a static cyan-to-blue treatment");
});

test("declared presentation ceilings suppress labels and waypoints above authorized detail", () => {
  const wholeProcess = { ...placement("whole", 10, 10), presentation: "whole" as const, name: "Must stay hidden" };
  const tileData: ProcessMapTileResponse = {
    z: 22,
    x: 0,
    y: 0,
    process_map_read_version: 11,
    byteLength: 1,
    placements: [wholeProcess],
    traces: [],
  };
  const tileLayer = layerByID(buildProcessMapLayers(buildOptions({ settledPixelsPerGridUnit: 3 })), "process-map-spatial-tiles");
  const render = tileLayer.props.renderSubLayers as unknown as (props: { id: string; data: ProcessMapTileResponse; tile: { boundingBox: [number[], number[]] } }) => Layer[];
  const tileLayers = render({ id: "capped", data: tileData, tile: { boundingBox: [[0, 0], [256, 256]] } });
  assert.deepEqual(layerByID(tileLayers, "capped-labels").props.data, []);

  const source = placement("source", 0, 0);
  const target = placement("target", 20, 0);
  const normalTrace = { ...trace(source, target), presentation: "normal" as const };
  const normalPresentation: ProcessMapPresentationState = {
    placements: new Map([["logic_gate:source", source], ["logic_gate:target", target]]),
    traces: new Map([[normalTrace.resource_operational_relationship_id, normalTrace]]),
    removedPlacementKeys: new Set(),
  };
  const normalLayers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 100,
    presentation: normalPresentation,
    editedTraceIDs: new Set([normalTrace.resource_operational_relationship_id]),
    editOverlay: {
      placements: [], traces: [normalTrace], selectedPlacementKey: null,
      selectedTraceID: normalTrace.resource_operational_relationship_id,
      connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null,
    },
  }));
  assert.deepEqual(layerByID(normalLayers, "process-map-edit-waypoints").props.data, []);

  const editingTrace = { ...normalTrace, presentation: "editing" as const };
  const zoomedOutEditingLayers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 1,
    presentation: { ...normalPresentation, traces: new Map([[editingTrace.resource_operational_relationship_id, editingTrace]]) },
    editedTraceIDs: new Set([editingTrace.resource_operational_relationship_id]),
    editOverlay: {
      placements: [], traces: [editingTrace], selectedPlacementKey: null,
      selectedTraceID: editingTrace.resource_operational_relationship_id,
      connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null,
    },
  }));
  assert.deepEqual(
    layerByID(zoomedOutEditingLayers, "process-map-edit-waypoints").props.data,
    [],
    "a previously detailed trace cannot leave route controls behind after zooming out",
  );
  const editingLayers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 100,
    presentation: { ...normalPresentation, traces: new Map([[editingTrace.resource_operational_relationship_id, editingTrace]]) },
    editedTraceIDs: new Set([editingTrace.resource_operational_relationship_id]),
    editOverlay: {
      placements: [], traces: [editingTrace], selectedPlacementKey: null,
      selectedTraceID: editingTrace.resource_operational_relationship_id,
      connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null,
    },
  }));
  assert.equal((layerByID(editingLayers, "process-map-edit-waypoints").props.data as unknown[]).length, 1);
  const editingLayerIDs = editingLayers.map((layer) => layer.id);
  assert.ok(
    editingLayerIDs.indexOf("process-map-edit-traces") < editingLayerIDs.indexOf("process-map-spatial-tiles"),
    "selected traces and connection previews stay below ordinary placement bodies",
  );
  assert.ok(
    editingLayerIDs.indexOf("process-map-spatial-tiles") < editingLayerIDs.indexOf("process-map-edit-waypoints"),
    "selected route waypoints remain visible and pickable above tiled geometry",
  );
  assert.ok(
    editingLayerIDs.indexOf("process-map-edit-waypoints") < editingLayerIDs.indexOf("process-map-edit-placement-bodies"),
    "actively edited placements remain the top interactive map items",
  );
});

test("Folder move and delete acknowledgements clear only previews from their own still-current operations", () => {
  const expected = new Map([
    ["company_explorer_folder:folder", 2],
    ["logic_gate:child", 4],
    ["trace:relationship-1", 3],
  ]);
  const current = new Map([
    ["company_explorer_folder:folder", 2],
    ["logic_gate:child", 5],
    ["trace:relationship-1", 4],
  ]);
  assert.deepEqual(
    [...processMapCurrentOperationKeys(
      ["company_explorer_folder:folder", "logic_gate:child"],
      expected,
      current,
    )],
    ["company_explorer_folder:folder"],
  );
  assert.deepEqual(
    [...processMapCurrentOperationKeys(["relationship-1"], expected, current, "trace:")],
    [],
  );
  assert.deepEqual(
    [...processMapCurrentOperationKeys(
      ["company_explorer_folder:folder", "logic_gate:child"],
      expected,
      new Map([
        ["company_explorer_folder:folder", 2],
        ["logic_gate:child", 5],
      ]),
    )],
    ["company_explorer_folder:folder"],
    "a Folder-delete reply cannot clear a direct child's newer edit preview",
  );
  assert.deepEqual(
    [...processMapCurrentOperationKeys(["logic_gate:child"], undefined, current)],
    ["logic_gate:child"],
    "ordinary envelopes without an operation fence keep their existing cleanup behavior",
  );
});

test("selected Folder editing stays transparent and exposes saved-geometry resize and connection handles", () => {
  const folder = placement("Folder", 10, 20, 80, 60, "company_explorer_folder");
  const child = { ...placement("Child", 25, 35), map_parent_folder_id: folder.resource_id };
  const key = "company_explorer_folder:Folder";
  const presentation: ProcessMapPresentationState = {
    placements: new Map([[key, folder], ["logic_gate:Child", child]]), traces: new Map(), removedPlacementKeys: new Set(),
  };
  const layers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 24,
    presentation,
    editedPlacementKeys: new Set([key]),
    editOverlay: {
      placements: [folder], traces: [], selectedPlacementKey: key, selectedTraceID: null,
      connectionPreview: null, highlightedFolderKey: key, connectionSourceKey: null,
    },
  }));
  const fences = layerByID(layers, "process-map-edit-folder-fences").props.data as unknown[];
  const bodies = layerByID(layers, "process-map-edit-placement-bodies").props.data as Array<{ fill: number[] }>;
  const handles = layerByID(layers, "process-map-edit-resize-handles").props.data as unknown[];
  const anchors = layerByID(layers, "process-map-edit-anchors").props.data as unknown[];
  const labels = layerByID(layers, "process-map-edit-labels").props.data as Array<{ position: [number, number] }>;
  const tileLayer = layerByID(layers, "process-map-spatial-tiles");
  const render = tileLayer.props.renderSubLayers as unknown as (props: { id: string; data: ProcessMapTileResponse; tile: { boundingBox: [number[], number[]] } }) => Layer[];
  const tileLayers = render({
    id: "selected-folder",
    data: { z: 22, x: 0, y: 0, process_map_read_version: 11, byteLength: 1, placements: [folder, child], traces: [] },
    tile: { boundingBox: [[0, 0], [256, 256]] },
  });
  const containedBodies = layerByID(tileLayers, "selected-folder-placements").props.data as Array<{ pick: { key: string } }>;
  assert.equal(fences.length, 4, "a Folder is a perimeter fence, not an opaque card");
  assert.equal(bodies.length, 0, "the selected Folder has no invisible interior pick surface over its contents");
  assert.deepEqual(containedBodies.map((item) => item.pick.key), ["logic_gate:Child"], "the contained Process body stays directly pickable");
  assert.ok(labels[0].position[1] > folder.grid_y && labels[0].position[1] < folder.grid_y + folder.grid_height / 2, "the selected Folder label stays along the inside top edge");
  assert.equal(handles.length, 4, "all four corners resize the saved global bounds");
  assert.equal(anchors.length, 2, "physical input and output sides remain connectable while editing");
});

test("an active connection keeps only the source output and distinct eligible target inputs", () => {
  const source = placement("source", 0, 0);
  const target = placement("target", 20, 0, 12, 8, "company_explorer_folder");
  const sourceKey = "logic_gate:source";
  const targetKey = "company_explorer_folder:target";
  const presentation: ProcessMapPresentationState = {
    placements: new Map([[sourceKey, source], [targetKey, target]]),
    traces: new Map(),
    removedPlacementKeys: new Set(),
  };
  const layers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 24,
    presentation,
    editedPlacementKeys: new Set([sourceKey]),
    editOverlay: {
      placements: [source],
      traces: [],
      selectedPlacementKey: sourceKey,
      selectedTraceID: null,
      connectionPreview: { source, point: { x: target.grid_x, y: target.grid_y + target.grid_height / 2 } },
      highlightedFolderKey: null,
      connectionSourceKey: sourceKey,
    },
  }));
  const anchors = layerByID(layers, "process-map-edit-anchors").props.data as Array<{
    radius: number;
    pick: { anchor: "input" | "output"; key: string };
  }>;
  assert.deepEqual(
    anchors.map((item) => [item.pick.key, item.pick.anchor]),
    [[sourceKey, "output"], [targetKey, "input"]],
  );
  assert.ok(anchors[1].radius > anchors[0].radius, "eligible inputs receive the clearer target treatment");
  const preview = layerByID(layers, "process-map-edit-traces");
  assertFlatXYPathLayer(preview);
  const colors = (preview.props.data as Array<{ color: number[] }>).map((item) => item.color);
  assert.notDeepEqual(colors[0], colors[colors.length - 1], "the pending orthogonal preview is a static cyan-to-blue path");
  assert.ok(
    layers.indexOf(preview) < layers.indexOf(layerByID(layers, "process-map-spatial-tiles")),
    "the pending trace remains below placement bodies",
  );
});

test("Folder perimeter ownership crosses tile boundaries once without internal stroke seams", () => {
  const left = { minX: 0, minY: 0, maxX: 256, maxY: 256 };
  const right = { minX: 256, minY: 0, maxX: 512, maxY: 256 };
  const spanning = { min_x: 100, min_y: 20, max_x: 400, max_y: 80 };
  const spanningSegments = [
    ...processMapPerimeterSegments(spanning, left),
    ...processMapPerimeterSegments(spanning, right),
  ];
  assert.equal(
    spanningSegments.filter((segment) => segment[0][0] === 256 && segment[1][0] === 256).length,
    0,
    "a tile boundary inside a Folder must not become a visible fence",
  );
  assert.equal(new Set(spanningSegments.map((segment) => JSON.stringify(segment))).size, spanningSegments.length);
  assert.deepEqual(spanningSegments, [
    [[100, 20], [256, 20]], [[100, 80], [256, 80]], [[100, 20], [100, 80]],
    [[256, 20], [400, 20]], [[256, 80], [400, 80]], [[400, 20], [400, 80]],
  ]);

  const endingOnBoundary = { min_x: 120, min_y: 100, max_x: 256, max_y: 160 };
  const boundarySegments = [
    ...processMapPerimeterSegments(endingOnBoundary, left),
    ...processMapPerimeterSegments(endingOnBoundary, right),
  ];
  assert.equal(
    boundarySegments.filter((segment) => segment[0][0] === 256 && segment[1][0] === 256).length,
    1,
    "a real max edge on a tile boundary has exactly one owner",
  );
});

test("only complete current-version viewport coverage retires mutation masks", () => {
  const current: Parameters<typeof retireProcessMapMutationMasks>[0] = {
    committedOverlay: {
      placements: new Map([["logic_gate:gate", placement("gate", 1, 2)]]),
      traces: new Map(),
      removedPlacementKeys: new Set(["logic_gate:removed"]),
    },
    removedTraceIDs: new Set(["trace-1"]),
  };
  const currentTile = { z: 1, x: 0, y: 0, process_map_read_version: 11, placements: [], traces: [], byteLength: 1 };
  assert.equal(processMapViewportHasCompleteCoverage([], 11), false);
  assert.equal(processMapViewportHasCompleteCoverage([{ isLoaded: true, content: null }], 11), false);
  assert.equal(processMapViewportHasCompleteCoverage([{ isLoaded: true, content: { ...currentTile, process_map_read_version: 10 } }], 11), false);
  assert.equal(processMapViewportHasCompleteCoverage([{ isLoaded: true, content: currentTile }], 11), true);
  assert.equal(retireProcessMapMutationMasks(current, false), current, "partial coverage retains rollback masks");
  const retired = retireProcessMapMutationMasks(current, true);
  assert.equal(retired.committedOverlay.placements.size, 0);
  assert.equal(retired.committedOverlay.traces.size, 0);
  assert.equal(retired.committedOverlay.removedPlacementKeys.size, 0);
  assert.equal(retired.removedTraceIDs.size, 0);

  const completedGenerations: number[] = [];
  const tileLayer = layerByID(buildProcessMapLayers(buildOptions({
    onViewportLoad: (generation) => completedGenerations.push(generation),
  })), "process-map-spatial-tiles");
  const onViewportLoad = tileLayer.props.onViewportLoad as unknown as (tiles: Array<{ isLoaded: boolean; content?: ProcessMapTileResponse | null }>) => void;
  onViewportLoad([{ isLoaded: true, content: null }]);
  onViewportLoad([{ isLoaded: true, content: { ...currentTile, process_map_read_version: 10 } }]);
  assert.deepEqual(completedGenerations, []);
  onViewportLoad([{ isLoaded: true, content: currentTile }]);
  assert.deepEqual(completedGenerations, [3], "only the settled generation with current content may retire masks");
});

test("delete masks win over every overlay and cleared previews cannot return after mask retirement", () => {
  const source = placement("source", 0, 0);
  const target = placement("target", 20, 0);
  const relationship = trace(source, target);
  const placementKey = "logic_gate:source";
  const traceID = relationship.resource_operational_relationship_id;
  const base: ProcessMapPresentationState = {
    placements: new Map([[placementKey, source]]),
    traces: new Map([[traceID, relationship]]),
    removedPlacementKeys: new Set(),
  };
  const committed: ProcessMapPresentationState = {
    placements: new Map([[placementKey, { ...source, grid_x: 1 }]]),
    traces: new Map([[traceID, { ...relationship, revision: relationship.revision + 1 }]]),
    removedPlacementKeys: new Set([placementKey]),
  };
  const previewPlacements = new Map([[placementKey, { ...source, grid_x: 2 }]]);
  const previewTraces = new Map([[traceID, { ...relationship, revision: relationship.revision + 2 }]]);
  const masked = mergeProcessMapPresentation(base, committed, previewPlacements, previewTraces, new Set([traceID]));
  assert.equal(masked.placements.has(placementKey), false);
  assert.equal(masked.traces.has(traceID), false);

  const clearedPlacements = replaceProcessMapPreviewEntries(previewPlacements, [placementKey], new Map());
  const clearedTraces = replaceProcessMapPreviewEntries(previewTraces, [traceID], new Map());
  const lateSaveKeys = processMapCurrentOperationKeys(
    [placementKey],
    new Map([[placementKey, 1]]),
    new Map([[placementKey, 2]]),
  );
  assert.deepEqual([...lateSaveKeys], [], "delete generation fences the older save acknowledgement");
  const afterCoverage = mergeProcessMapPresentation(
    { placements: new Map(), traces: new Map(), removedPlacementKeys: new Set() },
    { placements: new Map(), traces: new Map(), removedPlacementKeys: new Set() },
    clearedPlacements,
    clearedTraces,
    new Set(),
  );
  assert.equal(afterCoverage.placements.has(placementKey), false);
  assert.equal(afterCoverage.traces.has(traceID), false);
});

test("canonical mutation envelopes reject stale acknowledgements and rebuild route geometry from saved dimensions", () => {
  const source = placement("source", 0, 0);
  const target = placement("target", 20, 0);
  const currentTrace = trace(source, target);
  const current: ProcessMapPresentationState = {
    placements: new Map([["logic_gate:source", source], ["logic_gate:target", target]]),
    traces: new Map([[currentTrace.resource_operational_relationship_id, currentTrace]]),
    removedPlacementKeys: new Set(),
  };
  const stale: ProcessMapMutationEnvelope = {
    placements: [{ company_id: "company", resource_type: "logic_gate", resource_id: "source", map_parent_folder_id: null, grid_x: 99, grid_y: 99, grid_width: 2, grid_height: 2, revision: 4, created_timestamp: "created", updated_timestamp: "stale" }],
    traces: [{ resource_operational_relationship_id: "relationship-1", route_points: [{ x: 99, y: 99 }], revision: 3, created_timestamp: "created", updated_timestamp: "stale" }],
    deleted_trace_ids: [],
    process_map_read_version: 12,
  };
  const ignored = applyProcessMapMutationEnvelope(current, stale);
  assert.equal(ignored.placements.get("logic_gate:source")?.grid_x, 0);
  assert.deepEqual(ignored.traces.get("relationship-1")?.route_points, [{ x: 15, y: 3 }]);

  const committed: ProcessMapMutationEnvelope = {
    placements: [{ company_id: "company", resource_type: "logic_gate", resource_id: "source", map_parent_folder_id: null, grid_x: 2, grid_y: 4, grid_width: 14, grid_height: 8, revision: 6, created_timestamp: "created", updated_timestamp: "committed" }],
    traces: [{ resource_operational_relationship_id: "relationship-1", route_points: [{ x: 18, y: 8 }], revision: 5, created_timestamp: "created", updated_timestamp: "committed" }],
    deleted_trace_ids: [],
    process_map_read_version: 13,
  };
  const applied = applyProcessMapMutationEnvelope(current, committed);
  const saved = applied.placements.get("logic_gate:source");
  assert.deepEqual(saved && [saved.grid_x, saved.grid_y, saved.grid_width, saved.grid_height, saved.revision], [2, 4, 14, 8, 6]);
  assert.deepEqual(applied.traces.get("relationship-1")?.path_fragments, [[
    { x: 16, y: 8 }, { x: 18, y: 8 }, { x: 18, y: 3 }, { x: 20, y: 3 },
  ]]);

  const removed = applyProcessMapMutationEnvelope(applied, {
    placements: [],
    traces: [],
    deleted_trace_ids: ["relationship-1"],
    process_map_read_version: 14,
  });
  assert.equal(removed.traces.has("relationship-1"), false);
});

test("one group-move envelope reconciles every moved placement and translated internal trace together", () => {
  const folder = placement("folder", 0, 0, 100, 80, "company_explorer_folder");
  const source = { ...placement("source", 10, 10), map_parent_folder_id: "folder" };
  const target = { ...placement("target", 40, 10), map_parent_folder_id: "folder" };
  const relationship = trace(source, target);
  const current: ProcessMapPresentationState = {
    placements: new Map([
      ["company_explorer_folder:folder", folder], ["logic_gate:source", source], ["logic_gate:target", target],
    ]),
    traces: new Map([[relationship.resource_operational_relationship_id, relationship]]),
    removedPlacementKeys: new Set(),
  };
  const committed = (item: ProcessMapVisiblePlacement, x: number, y: number) => ({
    company_id: "company", resource_type: item.resource_type, resource_id: item.resource_id,
    map_parent_folder_id: item.map_parent_folder_id, grid_x: x, grid_y: y,
    grid_width: item.grid_width, grid_height: item.grid_height, revision: 6,
    created_timestamp: "created", updated_timestamp: "moved",
  });
  const next = applyProcessMapMutationEnvelope(current, {
    placements: [committed(folder, 5, 7), committed(source, 15, 17), committed(target, 45, 17)],
    traces: [{ resource_operational_relationship_id: "relationship-1", route_points: [{ x: 20, y: 10 }], revision: 5, created_timestamp: "created", updated_timestamp: "moved" }],
    deleted_trace_ids: [],
    process_map_read_version: 12,
  });
  assert.deepEqual(
    [...next.placements.values()].map((item) => [item.resource_id, item.grid_x, item.grid_y]),
    [["folder", 5, 7], ["source", 15, 17], ["target", 45, 17]],
  );
  assert.deepEqual(next.traces.get("relationship-1")?.route_points, [{ x: 20, y: 10 }]);
  assert.equal(next.traces.get("relationship-1")?.revision, 5);
});

test("representative large-company transport and presentation stay byte-, request-, and datum-bounded", async (t) => {
  const companyTileCount = 20;
  const placementsPerTile = 1_000;
  const finalViewportTileCount = 12;
  const companyPlacementCount = companyTileCount * placementsPerTile;
  const apiBase = "https://process-map-large-company.test";
  const companyID = "large-company";
  const readVersion = 41;
  const largeScene: ProcessMapSceneResponse = {
    bounds: { min_x: 0, min_y: 0, max_x: companyTileCount * PROCESS_MAP_TILE_SIZE, max_y: PROCESS_MAP_TILE_SIZE },
    process_map_read_version: readVersion,
    tile_size: PROCESS_MAP_TILE_SIZE,
    min_tile_zoom: 0,
    max_tile_zoom: 22,
  };
  const encodedBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const tilePayload = (tileX: number): Omit<ProcessMapTileResponse, "byteLength"> => {
    const placements: ProcessMapTileResponse["placements"] = [];
    const visible: ProcessMapVisiblePlacement[] = [];
    for (let index = 0; index < placementsPerTile; index += 1) {
      const gridX = tileX * PROCESS_MAP_TILE_SIZE + (index % 40) * 6;
      const gridY = Math.floor(index / 40) * 10;
      if (index % 25 === 0) {
        placements.push({ restricted: true, grid_x: gridX, grid_y: gridY });
        continue;
      }
      const item: ProcessMapVisiblePlacement = {
        restricted: false,
        presentation: "normal",
        resource_type: index % 10 === 0 ? "company_explorer_folder" : "logic_gate",
        resource_id: `tile-${tileX}-placement-${index}`,
        name: `Placement ${tileX}-${index}`,
        map_parent_folder_id: null,
        grid_x: gridX,
        grid_y: gridY,
        grid_width: 5,
        grid_height: 3,
        can_edit: true,
        revision: 1,
        created_timestamp: "2026-08-26T00:00:00Z",
        updated_timestamp: "2026-08-26T00:00:00Z",
      };
      visible.push(item);
      placements.push(item);
    }
    const traces: ProcessMapTrace[] = visible.slice(1).map((target, index) => {
      const source = visible[index];
      return {
        presentation: "normal",
        resource_operational_relationship_id: `tile-${tileX}-relationship-${index}`,
        source: { resource_type: source.resource_type, resource_id: source.resource_id },
        target: { resource_type: target.resource_type, resource_id: target.resource_id },
        route_points: [],
        path_fragments: [[
          { x: source.grid_x + source.grid_width, y: source.grid_y + source.grid_height / 2 },
          { x: target.grid_x, y: target.grid_y + target.grid_height / 2 },
        ]],
        revision: 1,
        created_timestamp: "2026-08-26T00:00:00Z",
        updated_timestamp: "2026-08-26T00:00:00Z",
      };
    });
    return { z: 22, x: tileX, y: 0, process_map_read_version: readVersion, placements, traces };
  };

  assert.equal(companyPlacementCount, 20_000, "the fixture represents a large mapped company, not a toy tile");
  assert.deepEqual({
    tile_size: PROCESS_MAP_TILE_SIZE,
    cache_bytes: PROCESS_MAP_TILE_CACHE_BYTES,
    max_requests: PROCESS_MAP_MAX_TILE_REQUESTS,
    debounce_ms: PROCESS_MAP_TILE_DEBOUNCE_MS,
    settlement_ms: PROCESS_MAP_SETTLE_DELAY_MS,
    normal_lod_px: PROCESS_MAP_NORMAL_LOD_MIN_PX,
    editing_lod_px: PROCESS_MAP_EDITING_LOD_MIN_PX,
    default_width: PROCESS_MAP_DEFAULT_WIDTH,
    default_height: PROCESS_MAP_DEFAULT_HEIGHT,
    min_camera_zoom: PROCESS_MAP_MIN_CAMERA_ZOOM,
    max_camera_zoom: PROCESS_MAP_MAX_CAMERA_ZOOM,
    safe_world_coordinate: PROCESS_MAP_SAFE_WORLD_COORDINATE,
  }, {
    tile_size: 256,
    cache_bytes: 32 * 1024 * 1024,
    max_requests: 6,
    debounce_ms: 60,
    settlement_ms: 180,
    normal_lod_px: 24,
    editing_lod_px: 96,
    default_width: 7,
    default_height: 5,
    min_camera_zoom: -24,
    max_camera_zoom: 20,
    safe_world_coordinate: 1_000_000_000,
  });
  const safeWorldFit = fitProcessMapViewState({
    min_x: -PROCESS_MAP_SAFE_WORLD_COORDINATE,
    min_y: -PROCESS_MAP_SAFE_WORLD_COORDINATE,
    max_x: PROCESS_MAP_SAFE_WORLD_COORDINATE,
    max_y: PROCESS_MAP_SAFE_WORLD_COORDINATE,
  }, { width: 1_920, height: 1_080 });
  assert.ok(safeWorldFit.zoom >= PROCESS_MAP_MIN_CAMERA_ZOOM, "the safe company world must fit inside the tested camera range");
  assert.equal(processMapPlacementLOD({ grid_width: 1, grid_height: 1 }, 2 ** PROCESS_MAP_MAX_CAMERA_ZOOM), "editing");

  invalidateProcessMapReadCaches(apiBase, companyID);
  const originalFetch = globalThis.fetch;
  let sceneRequests = 0;
  let tileRequests = 0;
  let canceledRequests = 0;
  let resolveCanceledFetch: (() => void) | null = null;
  const canceledFetchObserved = new Promise<void>((resolve) => { resolveCanceledFetch = resolve; });
  globalThis.fetch = (async (input, init) => {
    const url = new URL(input.toString());
    if (url.pathname.endsWith("/v1/process-map/scene")) {
      sceneRequests += 1;
      return new Response(JSON.stringify(largeScene), { status: 200, headers: { "content-type": "application/json" } });
    }
    const match = url.pathname.match(/\/tiles\/(-?\d+)\/(-?\d+)\/(-?\d+)$/);
    assert.ok(match, `unexpected Process Map request ${url.pathname}`);
    tileRequests += 1;
    const z = Number(match[1]);
    const x = Number(match[2]);
    const y = Number(match[3]);
    if (x === companyTileCount) {
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          canceledRequests += 1;
          resolveCanceledFetch?.();
          reject(new DOMException("aborted", "AbortError"));
        };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    return new Response(JSON.stringify({ ...tilePayload(x), z, x, y }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const loadedScene = await fetchProcessMapScene(apiBase, companyID);
    assert.deepEqual(loadedScene, largeScene);
    assert.equal(sceneRequests, 1);
    assert.ok(encodedBytes(largeScene) <= 256, "initial scene metadata must stay independent of the company graph size");

    const tileLoader = (request: Parameters<ProcessMapLayerBuildOptions["getTileData"]>[0]) => (
      fetchProcessMapTile(apiBase, companyID, readVersion, request.z, request.x, request.y, request.signal)
    );
    const unsettledLayer = layerByID(buildProcessMapLayers(buildOptions({
      scene: largeScene,
      settled: false,
      getTileData: tileLoader,
    })), "process-map-spatial-tiles");
    const readUnsettled = unsettledLayer.props.getTileData as unknown as (request: {
      id: string;
      index: { z: number; x: number; y: number };
      signal: AbortSignal;
    }) => Promise<ProcessMapTileResponse | null> | null;
    for (let update = 0; update < 240; update += 1) {
      assert.equal(readUnsettled({
        id: `interim-${update}`,
        index: { z: 22, x: update % companyTileCount, y: 0 },
        signal: new AbortController().signal,
      }), null);
    }
    assert.equal(tileRequests, 0, "240 wheel/pan candidates must schedule no business read before settlement");

    const settledLayer = layerByID(buildProcessMapLayers(buildOptions({
      scene: largeScene,
      settled: true,
      settledPixelsPerGridUnit: 8,
      getTileData: tileLoader,
    })), "process-map-spatial-tiles");
    assert.equal(settledLayer.props.maxRequests, PROCESS_MAP_MAX_TILE_REQUESTS);
    assert.equal(settledLayer.props.maxCacheByteSize, PROCESS_MAP_TILE_CACHE_BYTES);
    const readSettled = settledLayer.props.getTileData as unknown as (request: {
      id: string;
      index: { z: number; x: number; y: number };
      signal: AbortSignal;
    }) => Promise<ProcessMapTileResponse>;
    let settledLoadCount = 0;
    let settleFailure: (cause: unknown) => void = () => undefined;
    let settleSuccess: (tiles: ProcessMapTileResponse[]) => void = () => undefined;
    const settledTiles = new Promise<ProcessMapTileResponse[]>((resolve, reject) => {
      settleSuccess = resolve;
      settleFailure = reject;
    });
    const settlementGate = createProcessMapSettlementGate({
      delayMs: 0,
      onSettle: () => {
        settledLoadCount += 1;
        void Promise.all(Array.from({ length: finalViewportTileCount }, (_, x) => readSettled({
          id: `final-${x}`,
          index: { z: 22, x, y: 0 },
          signal: new AbortController().signal,
        }))).then(settleSuccess, settleFailure);
      },
    });
    settlementGate.onInteractionStateChange({ isZooming: true });
    for (let update = 0; update < 240; update += 1) settlementGate.onViewStateChange();
    assert.equal(settledLoadCount, 0);
    settlementGate.onInteractionStateChange({});
    const responses = await settledTiles;
    settlementGate.dispose();
    assert.equal(settledLoadCount, 1, "one wheel/pan burst must produce one final load generation");
    assert.equal(tileRequests, finalViewportTileCount, "only missing tiles from the final viewport are requested");

    await Promise.all(Array.from({ length: finalViewportTileCount }, (_, x) => (
      fetchProcessMapTile(apiBase, companyID, readVersion, 22, x, 0)
    )));
    assert.equal(tileRequests, finalViewportTileCount, "the final viewport reuses its tile cache without new requests");
    const cache = getProcessMapReadCacheStats();
    const retainedTileBytes = responses.reduce((total, response) => total + response.byteLength, 0);
    assert.equal(cache.scene_entries, 1);
    assert.equal(cache.tile_entries, finalViewportTileCount);
    assert.equal(cache.tile_bytes, retainedTileBytes);
    assert.ok(cache.tile_bytes <= PROCESS_MAP_TILE_CACHE_BYTES);
    assert.ok(Math.max(...responses.map((response) => response.byteLength)) <= 1024 * 1024, "a representative tile must remain below 1 MiB");

    const cancelController = new AbortController();
    const canceled = fetchProcessMapTile(apiBase, companyID, readVersion, 22, companyTileCount, 0, cancelController.signal);
    cancelController.abort();
    await assert.rejects(canceled, (cause: unknown) => cause instanceof Error && cause.name === "AbortError");
    await canceledFetchObserved;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(canceledRequests, 1, "a settled request with no remaining consumer aborts its underlying fetch");
    assert.equal(getProcessMapReadCacheStats().inflight_reads, 0);

    let placementVisits = 0;
    let traceVisits = 0;
    const countedArray = <T,>(values: T[], onVisit: () => void): T[] => new Proxy(values, {
      get(target, property, receiver) {
        if (property !== Symbol.iterator) return Reflect.get(target, property, receiver);
        return function* countedIterator() {
          for (const value of target) {
            onVisit();
            yield value;
          }
        };
      },
    });
    const representative = responses[0];
    const render = settledLayer.props.renderSubLayers as unknown as (props: {
      id: string;
      data: ProcessMapTileResponse;
      tile: { boundingBox: [number[], number[]] };
    }) => Layer[];
    const presentationLayers = render({
      id: "representative-large-tile",
      data: {
        ...representative,
        placements: countedArray(representative.placements, () => { placementVisits += 1; }),
        traces: countedArray(representative.traces, () => { traceVisits += 1; }),
      },
      tile: { boundingBox: [[0, 0], [PROCESS_MAP_TILE_SIZE, PROCESS_MAP_TILE_SIZE]] },
    });
    assert.equal(placementVisits, representative.placements.length, "presentation construction visits each placement once");
    assert.equal(traceVisits, representative.traces.length, "presentation construction visits each trace once");
    const labelData = layerByID(presentationLayers, "representative-large-tile-labels").props.data as Array<{ text: string }>;
    const pickableDatumCount = presentationLayers
      .filter((layer) => layer.props.pickable)
      .reduce((total, layer) => total + ((layer.props.data as unknown[])?.length ?? 0), 0);
    const visiblePlacementCount = representative.placements.filter((item) => !item.restricted).length;
    const visibleFolderCount = representative.placements.filter((item) => !item.restricted && item.resource_type === "company_explorer_folder").length;
    assert.equal(labelData.length, representative.placements.length, "normal LOD contributes one bounded label datum per displayable placement");
    assert.equal(
      pickableDatumCount,
      visiblePlacementCount * 5 - visibleFolderCount + representative.traces.length * 2,
      "Folder interiors add no pick datum while visible fences, Process bodies, and static trace halves remain bounded",
    );
    const labelBytes = labelData.reduce((total, datum) => total + encodedBytes(datum.text), 0);
    assert.ok(labelBytes < 64 * 1024, "representative label text stays bounded before the shared font atlas");

    const modeledCompanyTileBytes = Array.from({ length: companyTileCount }, (_, x) => encodedBytes(tilePayload(x)))
      .reduce((total, bytes) => total + bytes, 0);
    t.diagnostic(JSON.stringify({
      fixture_company_placements: companyPlacementCount,
      fixture_company_traces: representative.traces.length * companyTileCount,
      initial_scene_bytes: encodedBytes(largeScene),
      largest_tile_bytes: Math.max(...responses.map((response) => response.byteLength)),
      modeled_company_tile_bytes: modeledCompanyTileBytes,
      settled_viewport_requests: finalViewportTileCount,
      canceled_requests: canceledRequests,
      settled_load_count: settledLoadCount,
      label_datums: labelData.length,
      label_utf8_bytes: labelBytes,
      pickable_datums: pickableDatumCount,
      presentation_placement_visits: placementVisits,
      presentation_trace_visits: traceVisits,
      retained_tile_payload_bytes: cache.tile_bytes,
      tile_cache_limit_bytes: PROCESS_MAP_TILE_CACHE_BYTES,
    }));
  } finally {
    invalidateProcessMapReadCaches(apiBase, companyID);
    globalThis.fetch = originalFetch;
  }
});

test("GPU frame timing is left to a browser/GPU benchmark instead of a synthetic Node threshold", (t) => {
  const hasBrowserGPUFrameSource = typeof globalThis.requestAnimationFrame === "function"
    && typeof globalThis.WebGL2RenderingContext === "function";
  assert.equal(hasBrowserGPUFrameSource, false, "this Node suite has no real browser animation loop or WebGL2 device");
  t.diagnostic(JSON.stringify({
    gpu_frame_behavior: "not measured in Node: profile real pan/zoom frames in a browser with a representative GPU",
    node_scope: "assert transport, settlement, cancellation, label, picking, cache-byte, and linear-construction bounds",
    rule: "correctness is not traded for a fabricated frame-time number",
  }));
});
