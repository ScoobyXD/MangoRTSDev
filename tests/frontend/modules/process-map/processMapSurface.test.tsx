import assert from "node:assert/strict";
import test from "node:test";

import { OrthographicViewport, type Layer } from "../../../../frontend/node_modules/@deck.gl/core/dist/index.js";
import { _Tile2DHeader as TileHeader } from "../../../../frontend/node_modules/@deck.gl/geo-layers/dist/index.js";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import {
  applyProcessMapMutationEnvelope,
  buildProcessMapLayers,
  materializeProcessMapPlacementTransform,
  mergeProcessMapPresentation,
  ProcessMapSurface,
  processMapFolderChildTops,
  processMapCurrentOperationKeys,
  processMapInternalTracesForTransform,
  processMapPerimeterSegments,
  processMapPlacementSubtree,
  processMapViewportHasCompleteCoverage,
  replaceProcessMapPreviewEntries,
  retireProcessMapMutationMasks,
  type ProcessMapLayerBuildOptions,
  type ProcessMapPlacementTransform,
  type ProcessMapPresentationState,
  type ProcessMapSurfaceProps,
} from "../../../../frontend/src/modules/process-map/ProcessMapSurface.js";
import { ProcessMapProtectedTileLayer } from "../../../../frontend/src/modules/process-map/processMapTileLayer.js";
import "./processMapTileLayer.test.js";
import type {
  ProcessMapChangesResponse,
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
import {
  readProcessMapDeckGLTestProps,
  resetProcessMapDeckGLTestStub,
  setProcessMapDeckGLPickedObjectForTest,
} from "./processMapDeckGLTestStub.js";
import {
  emitProcessMapChangedForTest,
  resetProcessMapRealtimeTestStub,
  setCurrentRealtimeConnectionIDForTest,
} from "./processMapRealtimeTestStub.js";

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

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
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
    validatedTiles: null,
    scoreCardBusinessDate: "2026-08-26",
    settled: true,
    settledPixelsPerGridUnit: 0.25,
    presentation: emptyPresentation(),
    editedPlacementKeys: new Set(),
    editedTraceIDs: new Set(),
    editOverlay: {
      placements: [], traces: [], selectedPlacementKey: null, selectedTraceID: null,
      connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null, hoveredPlacementKey: null, placementTransform: null,
    },
    getTileData: async () => null,
    onTileLoad: () => undefined,
    onTileUnload: () => undefined,
    ...overrides,
    folderChildTops: overrides.folderChildTops ?? processMapFolderChildTops((overrides.presentation ?? emptyPresentation()).placements.values()),
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

type PlacementLabelDatum = {
  position: [number, number];
  text: string;
  contentBox?: [number, number, number, number];
};

function assertPlacementLabelHorizontalContentBox(placement: ProcessMapVisiblePlacement, datum: PlacementLabelDatum): void {
  assert.ok(datum.contentBox, `${datum.text} must have a clipping box`);
  const [offsetX, offsetY, width, height] = datum.contentBox;
  const minX = datum.position[0] + offsetX;
  assert.ok(width > 0, `${datum.text} horizontal clipping box must remain visible`);
  assert.ok(minX > placement.grid_x, `${datum.text} clipping box must be inset from the left edge`);
  assert.ok(minX + width < placement.grid_x + placement.grid_width, `${datum.text} clipping box must be inset from the right edge`);
  assert.equal(offsetY, 0, `${datum.text} clipping box must not shift vertical content`);
  assert.equal(height, -1, `${datum.text} clipping box must disable DeckGL vertical glyph clipping`);
}

function installProcessMapTestDOM(): () => void {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://process-map.test", pretendToBeVisual: true });
  const values: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Text: dom.window.Text,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return () => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}

type DeckTestLayer = ReturnType<typeof readProcessMapDeckGLTestProps>["layers"][number];

function currentDeckLayer(id: string): DeckTestLayer {
  const layer = readProcessMapDeckGLTestProps().layers.find((candidate) => candidate.id === id);
  assert.ok(layer, `missing mounted layer ${id}`);
  return layer;
}

function behaviorSceneResponse(
  readVersion: number,
  bounds: ProcessMapSceneResponse["bounds"],
  validatedTiles: ProcessMapChangesResponse["validated_tiles"] = [],
): Response {
  return new Response(JSON.stringify({
    bounds,
    process_map_read_version: readVersion,
    tile_size: 256,
    min_tile_zoom: 0,
    max_tile_zoom: 22,
    validated_tiles: validatedTiles,
    protected_geometry_changed: false,
  }), { status: 200, headers: { "Content-Type": "application/json", ETag: `"scene-${readVersion}"` } });
}

function behaviorTile(
  readVersion: number,
  placements: ProcessMapTileResponse["placements"],
  traces: ProcessMapTrace[] = [],
): ProcessMapTileResponse {
  return { z: 22, x: 0, y: 0, process_map_read_version: readVersion, byteLength: 1, placements, traces };
}

type MountedProcessMap = {
  companyID: string;
  container: HTMLDivElement;
  initialTile: ProcessMapTileResponse;
  process: ProcessMapVisiblePlacement;
  readSceneCount: () => number;
  holdNextSceneRead: () => Deferred<Response>;
  loadTile: (tile: ProcessMapTileResponse, completeViewport?: boolean, tileID?: string) => Promise<void>;
  clickPlacement: (candidate: ProcessMapVisiblePlacement) => Promise<void>;
  readTileLayer: () => DeckTestLayer;
  root: Root;
  cleanup: () => Promise<void>;
};

type ProcessMapBehaviorMountOptions = Pick<ProcessMapSurfaceProps, "onCreateFolder" | "onCreateProcess" | "onCreateStep"> & {
  strictMode?: boolean;
  process?: ProcessMapVisiblePlacement;
  initialPlacements?: ProcessMapTileResponse["placements"];
  sceneBounds?: ProcessMapSceneResponse["bounds"];
};

let processMapBehaviorTestSequence = 0;

async function mountProcessMapForBehavior(
  onOpenLogicGate: (logicGateID: string, name: string) => void,
  options: ProcessMapBehaviorMountOptions = {},
): Promise<MountedProcessMap> {
  const restoreDOM = installProcessMapTestDOM();
  const originalFetch = globalThis.fetch;
  resetProcessMapDeckGLTestStub();
  resetProcessMapRealtimeTestStub();
  processMapBehaviorTestSequence += 1;
  const apiBase = `https://process-map-behavior-${processMapBehaviorTestSequence}.test`;
  const companyID = `company-${processMapBehaviorTestSequence}`;
  const sceneBounds = options.sceneBounds === undefined ? { min_x: 0, min_y: 0, max_x: 14, max_y: 8 } : options.sceneBounds;
  const process: ProcessMapVisiblePlacement = options.process ?? {
    ...placement("behavior-process", 0, 0, 14, 8),
    name: "Behavior Process",
  };
  const initialTile = behaviorTile(1, options.initialPlacements ?? [process]);
  const heldSceneReads: Array<Deferred<Response>> = [];
  let sceneReads = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/v1/process-map/scene?") || url.endsWith("/v1/process-map/changes")) {
      sceneReads += 1;
      const held = heldSceneReads.shift();
      if (!held) return behaviorSceneResponse(sceneReads, sceneBounds);
      const signal = init?.signal;
      return new Promise<Response>((resolve, reject) => {
        const onAbort = () => reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        if (signal?.aborted) { onAbort(); return; }
        signal?.addEventListener("abort", onAbort, { once: true });
        void held.promise.then(resolve, reject).finally(() => signal?.removeEventListener("abort", onAbort));
      });
    }
    if (url.includes("/qd-ratings?")) {
      return new Response(JSON.stringify({ qd_ratings: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/gvic?")) {
      return new Response(JSON.stringify({
        assignment_mode: "customized",
        effective_assignment_mode: "customized",
        effective_source: { resource_type: "logic_gate", resource_id: "behavior-process" },
        gvic_assignments: [],
        revision: "1",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected_process_map_test_request:${url}`);
  }) as typeof fetch;

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    const surface = <ProcessMapSurface apiBase={apiBase} companyID={companyID} onOpenLogicGate={onOpenLogicGate}
      onCreateFolder={options.onCreateFolder} onCreateProcess={options.onCreateProcess} onCreateStep={options.onCreateStep} />;
    root.render(options.strictMode ? <React.StrictMode>{surface}</React.StrictMode> : surface);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  });
  for (let attempt = 0; attempt < 10 && container.querySelector(".process-map-loading"); attempt += 1) {
    await act(async () => { await new Promise((resolvePromise) => setTimeout(resolvePromise, 0)); });
  }
  let deck = readProcessMapDeckGLTestProps();
  const tileLayer = deck.layers.find((layer) => layer.id === "process-map-spatial-tiles");
  assert.equal(Boolean(tileLayer), Boolean(sceneBounds), "only nonempty scenes create the spatial TileLayer");
  await act(async () => { deck.onResize({ width: 1_000, height: 700 }); });
  await act(async () => {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, PROCESS_MAP_SETTLE_DELAY_MS + 20));
  });
  deck = readProcessMapDeckGLTestProps();
  const currentTileLayer = deck.layers.find((layer) => layer.id === "process-map-spatial-tiles");
  initialTile.process_map_read_version = sceneReads;
  if (currentTileLayer) {
    const onTileLoad = currentTileLayer.props.onTileLoad as (tile: { id: string; content: ProcessMapTileResponse }) => void;
    await act(async () => {
      onTileLoad({ id: "22-0-0", content: initialTile });
    });
  }

  return {
    companyID,
    container,
    initialTile,
    process,
    readSceneCount: () => sceneReads,
    holdNextSceneRead: () => {
      const held = deferred<Response>();
      heldSceneReads.push(held);
      return held;
    },
    loadTile: async (tile, completeViewport = true, tileID = "22-0-0") => {
      const onTileLoad = currentDeckLayer("process-map-spatial-tiles").props.onTileLoad as (header: { id: string; content: ProcessMapTileResponse }) => void;
      await act(async () => { onTileLoad({ id: tileID, content: tile }); });
      if (!completeViewport) return;
      const onViewportLoad = currentDeckLayer("process-map-spatial-tiles").props.onViewportLoad as (headers: Array<{ isLoaded: boolean; content: ProcessMapTileResponse }>) => void;
      await act(async () => { onViewportLoad([{ isLoaded: true, content: tile }]); });
    },
    clickPlacement: async (candidate) => {
      await act(async () => {
        readProcessMapDeckGLTestProps().onClick({
          object: { kind: "placement", key: `${candidate.resource_type}:${candidate.resource_id}`, placement: candidate },
        }, { type: "click" });
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      });
    },
    readTileLayer: () => currentDeckLayer("process-map-spatial-tiles"),
    root,
    cleanup: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
      resetProcessMapDeckGLTestStub();
      resetProcessMapRealtimeTestStub();
      globalThis.fetch = originalFetch;
      restoreDOM();
    },
  };
}

type MountedPlacementDatum = {
  pick?: { key: string; placement: ProcessMapVisiblePlacement };
};

function mountedPlacementDatums(layerID: string): MountedPlacementDatum[] {
  return currentDeckLayer(layerID).props.data as MountedPlacementDatum[];
}

function mountedPlacementBodies(key: string): MountedPlacementDatum[] {
  return mountedPlacementDatums("process-map-edit-placement-bodies").filter((datum) => datum.pick?.key === key);
}

function mountedFolderFences(key: string): MountedPlacementDatum[] {
  return mountedPlacementDatums("process-map-edit-folder-fences").filter((datum) => datum.pick?.key === key);
}

async function emitMountedProcessMapChange(
  mounted: MountedProcessMap,
  protectedGeometryChanged: boolean,
  originConnectionID?: string,
): Promise<void> {
  await act(async () => {
    emitProcessMapChangedForTest({
      type: "process_map.changed",
      company_id: mounted.companyID,
      scope: "process-map:company",
      origin_connection_id: originConnectionID,
      protected_geometry_changed: protectedGeometryChanged,
    });
    await Promise.resolve();
  });
}

async function resolveMountedScene(
  held: Deferred<Response>,
  readVersion: number,
  bounds: ProcessMapSceneResponse["bounds"],
  validatedTiles: ProcessMapChangesResponse["validated_tiles"] = [],
): Promise<void> {
  await act(async () => {
    held.resolve(behaviorSceneResponse(readVersion, bounds, validatedTiles));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  });
}

test("the first nonempty scene frames its geometry after an initially empty company map", async () => {
  const mounted = await mountProcessMapForBehavior(() => undefined, { sceneBounds: null, initialPlacements: [] });
  try {
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState.target, [0, 0, 0]);
    assert.match(mounted.container.textContent ?? "", /No saved Folders or Processes are available on this map/);
    const held = mounted.holdNextSceneRead();
    await emitMountedProcessMapChange(mounted, false, "remote");
    const bounds = { min_x: 10_000, min_y: 20_000, max_x: 10_200, max_y: 20_200 };
    await resolveMountedScene(held, 2, bounds);
    const fitted = fitProcessMapViewState(bounds, { width: 1_000, height: 700 });
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, fitted);
    assert.doesNotMatch(mounted.container.textContent ?? "", /No saved Folders or Processes are available on this map/);
    assert.ok(mounted.readTileLayer(), "the first geometry creates a spatial layer");

    const refresh = mounted.holdNextSceneRead();
    await emitMountedProcessMapChange(mounted, false, "remote");
    await resolveMountedScene(refresh, 3, { ...bounds, max_x: 30_000 });
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, fitted, "later refreshes preserve the existing camera");
  } finally {
    await mounted.cleanup();
  }
});

test("blank map creation menu exposes optional actions and invokes only the chosen action", async () => {
  const calls: Array<[string, string | undefined]> = [];
  const mounted = await mountProcessMapForBehavior(() => undefined, {
    onCreateFolder: (id) => calls.push(["Folder", id]),
    onCreateProcess: (id) => calls.push(["Process", id]),
    onCreateStep: (id) => calls.push(["Step", id]),
  });
  try {
    const surface = mounted.container.querySelector<HTMLElement>("[role='application']")!;
    for (const action of ["Folder", "Process", "Step"]) {
      const event = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 400, clientY: 250 });
      await act(async () => { surface.dispatchEvent(event); });
      assert.equal(event.defaultPrevented, true);
      const menu = document.querySelector("[role='menu'][aria-label='Process Map creation']");
      assert.ok(menu);
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>("[role='menuitem']")];
      assert.deepEqual(buttons.map((button) => button.textContent), ["Create Folder", "Create Process", "Create Step"]);
      assert.equal(document.activeElement, buttons[0], "the first action receives keyboard focus");
      await act(async () => { buttons.find((button) => button.textContent === `Create ${action}`)!.click(); });
      assert.equal(document.querySelector("[aria-label='Process Map creation']"), null);
    }
    assert.deepEqual(calls, [["Folder", undefined], ["Process", undefined], ["Step", undefined]]);
  } finally {
    await mounted.cleanup();
  }
});

test("creation menu uses the picked Folder destination and preserves other map context behavior", async () => {
  const calls: Array<string | undefined> = [];
  const folder = placement("destination-folder", 0, 0, 80, 60, "company_explorer_folder");
  const mounted = await mountProcessMapForBehavior(() => undefined, { onCreateProcess: (id) => calls.push(id), initialPlacements: [folder] });
  try {
    const surface = mounted.container.querySelector<HTMLElement>("[role='application']")!;
    setProcessMapDeckGLPickedObjectForTest({ pick: { kind: "placement", key: "company_explorer_folder:destination-folder", placement: folder } });
    await act(async () => { surface.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    const button = document.querySelector<HTMLButtonElement>("[role='menuitem']");
    assert.equal(button?.textContent, "Create Process");
    assert.equal(document.querySelectorAll("[role='menuitem']").length, 1);
    await act(async () => { button!.click(); });
    assert.deepEqual(calls, ["destination-folder"]);

    setProcessMapDeckGLPickedObjectForTest({ kind: "placement", key: `logic_gate:${mounted.process.resource_id}`, placement: mounted.process });
    const processEvent = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await act(async () => { surface.dispatchEvent(processEvent); });
    assert.equal(processEvent.defaultPrevented, false);
    assert.equal(document.querySelector("[role='menu']"), null);

    setProcessMapDeckGLPickedObjectForTest(null);
    await act(async () => { surface.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    await act(async () => { document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    assert.equal(document.querySelector("[role='menu']"), null);
    assert.deepEqual(calls, ["destination-folder"], "dismissal must not create anything");
  } finally {
    await mounted.cleanup();
  }
});

test("a real Deck double-click opens the Process instead of pinning its scorecard", async () => {
  const opened: Array<[string, string]> = [];
  const mounted = await mountProcessMapForBehavior((logicGateID, name) => { opened.push([logicGateID, name]); });
  try {
    await act(async () => {
      readProcessMapDeckGLTestProps().onClick({
        object: { kind: "placement", key: `logic_gate:${mounted.process.resource_id}`, placement: mounted.process },
      }, { type: "dblclick" });
    });
    assert.deepEqual(opened, [[mounted.process.resource_id, mounted.process.name]]);
    assert.equal(mounted.container.querySelector(".process-map-qd-card"), null, "double-click must not leave the QDC card pinned");
  } finally {
    await mounted.cleanup();
  }
});

test("name-visible normal LOD keeps Process scorecards, controls, and drag movement active", async () => {
  const mounted = await mountProcessMapForBehavior(() => undefined, {
    sceneBounds: { min_x: 0, min_y: 0, max_x: 218, max_y: 143 },
  });
  try {
    const key = `logic_gate:${mounted.process.resource_id}`;
    const zoom = readProcessMapDeckGLTestProps().viewState.zoom as number;
    assert.equal(2 ** zoom, 4, "the fixture must settle exactly at the normal-LOD scale");
    assert.equal(processMapPlacementLOD(mounted.process, 2 ** zoom), "normal");

    await mounted.clickPlacement(mounted.process);
    assert.ok(mounted.container.querySelector(".process-map-qd-card"), "a name-visible Process click pins its QCD card");
    assert.equal((currentDeckLayer("process-map-edit-resize-handles").props.data as unknown[]).length, 4);
    assert.equal((currentDeckLayer("process-map-edit-anchors").props.data as unknown[]).length, 2);

    const pick = { kind: "placement", key, placement: mounted.process };
    let propagationStopped = false;
    await act(async () => {
      readProcessMapDeckGLTestProps().onDragStart(
        { object: pick, coordinate: [1, 1] },
        { stopPropagation: () => { propagationStopped = true; } },
      );
    });
    await act(async () => {
      readProcessMapDeckGLTestProps().onDrag({ coordinate: [4, 3] });
    });
    const movedBody = mountedPlacementBodies(key)[0] as MountedPlacementDatum & { polygon: number[][] };
    assert.equal(propagationStopped, true);
    assert.deepEqual(movedBody.polygon, [[3, 2], [17, 2], [17, 10], [3, 10]], "dragging moves the selected Process through the existing snapped transform");
    assert.ok(mounted.container.querySelector(".process-map-qd-card"), "dragging keeps the pinned scorecard attached");
  } finally {
    await mounted.cleanup();
  }
});

test("pointer movement inside the same snapped grid cell preserves overlay data", async () => {
  const mounted = await mountProcessMapForBehavior(() => undefined);
  try {
    const key = `logic_gate:${mounted.process.resource_id}`;
    await act(async () => {
      readProcessMapDeckGLTestProps().onDragStart(
        { object: { kind: "placement", key, placement: mounted.process }, coordinate: [1, 1] },
        { stopPropagation: () => undefined },
      );
      readProcessMapDeckGLTestProps().onDrag({ coordinate: [4, 3] });
    });
    const moved = currentDeckLayer("process-map-edit-placement-bodies").props.data;
    await act(async () => { readProcessMapDeckGLTestProps().onDrag({ coordinate: [4.1, 3.1] }); });
    assert.equal(currentDeckLayer("process-map-edit-placement-bodies").props.data, moved);
    await act(async () => { readProcessMapDeckGLTestProps().onDrag({ coordinate: [5, 3] }); });
    assert.notEqual(currentDeckLayer("process-map-edit-placement-bodies").props.data, moved);
    assert.deepEqual((mountedPlacementBodies(key)[0] as MountedPlacementDatum & { polygon: number[][] }).polygon,
      [[4, 2], [18, 2], [18, 10], [4, 10]]);
  } finally {
    await mounted.cleanup();
  }
});

test("overlapping saves still validate an older committed result when the newer save fails", async () => {
  const mounted = await mountProcessMapForBehavior(() => undefined);
  try {
    const initialFetch = globalThis.fetch;
    const first = deferred<Response>();
    const second = deferred<Response>();
    const saves = [first, second];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("/v1/process-map/placements/") && init?.method === "PUT") {
        const save = saves.shift();
        assert.ok(save);
        return save.promise;
      }
      return initialFetch(input, init);
    }) as typeof fetch;
    setCurrentRealtimeConnectionIDForTest("local-save");
    await mounted.clickPlacement(mounted.process);
    const key = `logic_gate:${mounted.process.resource_id}`;
    const move = async (candidate: ProcessMapVisiblePlacement, dx: number) => {
      await act(async () => {
        readProcessMapDeckGLTestProps().onDragStart(
          { object: { kind: "placement", key, placement: candidate }, coordinate: [candidate.grid_x + 1, 1] },
          { stopPropagation: () => undefined },
        );
        readProcessMapDeckGLTestProps().onDrag({ coordinate: [candidate.grid_x + 1 + dx, 1] });
      });
      await act(async () => { readProcessMapDeckGLTestProps().onDragEnd({}); });
    };
    await move(mounted.process, 2);
    const firstPreview = mountedPlacementBodies(key)[0].pick!.placement;
    await move(firstPreview, 3);
    assert.equal(saves.length, 0);
    const held = mounted.holdNextSceneRead();
    const committed = { ...mounted.process, grid_x: 2, revision: 6, updated_timestamp: "first-save" };
    await act(async () => {
      first.resolve(new Response(JSON.stringify({
        placements: [{ ...committed, company_id: mounted.companyID }], traces: [], deleted_trace_ids: [], process_map_read_version: 2,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    assert.equal(mounted.readSceneCount(), 2, "the committed older acknowledgement must request canonical validation");
    assert.equal(mountedPlacementBodies(key)[0].pick?.placement.grid_x, 5, "the older acknowledgement must preserve the newer preview");
    await emitMountedProcessMapChange(mounted, false, "local-save");
    assert.equal(mounted.readSceneCount(), 2, "the initiating connection echo is suppressed");
    await act(async () => {
      second.resolve(new Response(JSON.stringify({ error: "save_failed" }), { status: 400, headers: { "Content-Type": "application/json" } }));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    await resolveMountedScene(held, 2, { min_x: 2, min_y: 0, max_x: 16, max_y: 8 });
    await mounted.loadTile(behaviorTile(2, [committed]));
    assert.equal(mountedPlacementBodies(key)[0].pick?.placement.grid_x, 2, "the successful first save must become canonical after the later failure");
  } finally {
    await mounted.cleanup();
  }
});

test("deep gates retain accurate pointer movement, resizing, and pinned cards near both world limits", async () => {
  for (const origin of [-800_000_000, 800_000_000]) {
    const process = placement("deep-gate", origin, origin, 14, 8);
    const saved = { ...process };
    const mounted = await mountProcessMapForBehavior(() => undefined, {
      process,
      sceneBounds: { min_x: origin, min_y: origin, max_x: origin + 14, max_y: origin + 8 },
    });
    try {
      const key = `logic_gate:${process.resource_id}`;
      const view = readProcessMapDeckGLTestProps().viewState;
      const viewport = new OrthographicViewport({ width: 1_000, height: 700, target: view.target as [number, number, number], zoom: view.zoom as number });
      const pointer = (x: number, y: number) => viewport.unproject(viewport.project([origin + x, origin + y]), { targetZ: 0 });
      await mounted.clickPlacement(process);
      const overlay = mounted.container.querySelector<HTMLElement>(".process-map-qd-overlay");
      assert.ok(overlay);
      const topRight = viewport.project([origin + 14, origin]);
      assert.ok(Math.abs(parseFloat(overlay.style.left) - topRight[0] - 22) < 0.001);
      assert.ok(Math.abs(parseFloat(overlay.style.top) - topRight[1]) < 0.001);
      await act(async () => {
        readProcessMapDeckGLTestProps().onDragStart({ object: { kind: "placement", key, placement: process }, coordinate: pointer(1, 1) }, { stopPropagation: () => undefined });
      });
      await act(async () => { readProcessMapDeckGLTestProps().onDrag({ coordinate: pointer(4.2, 3.2) }); });
      const moved = mountedPlacementBodies(key)[0] as MountedPlacementDatum & { polygon: number[][] };
      assert.deepEqual(moved.polygon, [[origin + 3, origin + 2], [origin + 17, origin + 2], [origin + 17, origin + 10], [origin + 3, origin + 10]]);
      const scale = 2 ** (view.zoom as number);
      assert.ok(Math.abs(parseFloat(overlay.style.left) - topRight[0] - 22 - 3 * scale) < 0.001, "the pinned card follows the snapped drag");
      await act(async () => {
        mounted.container.querySelector(".process-map-surface")!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      await act(async () => {
        readProcessMapDeckGLTestProps().onDragStart({ object: { kind: "resize", key, placement: process, horizontal: "east", vertical: "south" }, coordinate: pointer(14, 8) }, { stopPropagation: () => undefined });
      });
      await act(async () => { readProcessMapDeckGLTestProps().onDrag({ coordinate: pointer(16.2, 9.2) }); });
      const resized = mountedPlacementBodies(key)[0] as MountedPlacementDatum & { polygon: number[][] };
      assert.deepEqual(resized.polygon, [[origin, origin], [origin + 16, origin], [origin + 16, origin + 9], [origin, origin + 9]]);
      const anchors = currentDeckLayer("process-map-edit-anchors").props.data as Array<{ position: number[] }>;
      assert.deepEqual(anchors.map((item) => item.position), [[origin, origin + 4.5], [origin + 16, origin + 4.5]]);
      assert.deepEqual(process, saved, "camera and transient gestures do not rewrite saved manual geometry");
    } finally {
      await mounted.cleanup();
    }
  }
});

test("Shift-drag on empty Folder surface selects only placements fully inside the dragged bounds", async () => {
  const folder = placement("selection-folder", 0, 0, 40, 30, "company_explorer_folder");
  const first = { ...placement("selection-first", 4, 4, 6, 4), map_parent_folder_id: folder.resource_id };
  const second = { ...placement("selection-second", 16, 4, 6, 4), map_parent_folder_id: folder.resource_id };
  const outside = { ...placement("selection-outside", 22, 9, 8, 6), map_parent_folder_id: folder.resource_id };
  const mounted = await mountProcessMapForBehavior(() => undefined, {
    process: first,
    initialPlacements: [folder, first, second, outside],
    sceneBounds: { min_x: 0, min_y: 0, max_x: 40, max_y: 30 },
  });
  try {
    type ShiftDragStart = (
      info: { object?: unknown; coordinate?: number[] },
      event: { stopPropagation: () => void; shiftKey?: boolean; srcEvent?: { shiftKey?: boolean } },
    ) => void;
    let propagationStopped = false;
    await act(async () => {
      (readProcessMapDeckGLTestProps().onDragStart as unknown as ShiftDragStart)(
        { coordinate: [2, 2] },
        { shiftKey: true, stopPropagation: () => { propagationStopped = true; } },
      );
    });
    await act(async () => {
      readProcessMapDeckGLTestProps().onDrag({ coordinate: [24, 10] });
    });
    const selectionLayer = currentDeckLayer("process-map-edit-drag-selection");
    assert.equal(selectionLayer.props.pickable, false);
    assert.deepEqual(
      selectionLayer.props.data,
      [{ polygon: [[2, 2], [24, 2], [24, 10], [2, 10]], fill: [14, 165, 233, 28], line: [14, 165, 233, 255], lineWidth: 2 }],
      "drag feedback shows the exact company-world bounds without becoming another pick target",
    );
    assert.equal(propagationStopped, true, "Shift-drag owns the gesture instead of panning the camera");

    await act(async () => {
      readProcessMapDeckGLTestProps().onDragEnd({ coordinate: [24, 10] });
      await Promise.resolve();
    });
    const surface = mounted.container.querySelector<HTMLDivElement>(".process-map-surface");
    assert.equal(surface?.getAttribute("aria-label"), "Process Map. 2 placements selected.");
    const selectedBodies = mountedPlacementDatums("process-map-edit-placement-bodies").map((item) => item.pick?.key);
    assert.deepEqual(selectedBodies, [
      `logic_gate:${first.resource_id}`,
      `logic_gate:${second.resource_id}`,
    ], "partially intersected and enclosing placements are not selected");
    assert.deepEqual(currentDeckLayer("process-map-edit-drag-selection").props.data, [], "the transient selection rectangle clears when the gesture ends");
  } finally {
    await mounted.cleanup();
  }
});

test("child-control keyboard events stay native instead of becoming canvas commands", async () => {
  const opened: Array<[string, string]> = [];
  const mounted = await mountProcessMapForBehavior((logicGateID, name) => { opened.push([logicGateID, name]); });
  let confirmCalls = 0;
  const originalConfirm = window.confirm;
  window.confirm = () => {
    confirmCalls += 1;
    return false;
  };
  try {
    await act(async () => {
      readProcessMapDeckGLTestProps().onClick({
        object: { kind: "placement", key: `logic_gate:${mounted.process.resource_id}`, placement: mounted.process },
      }, { type: "click" });
    });
    const cardClose = mounted.container.querySelector<HTMLButtonElement>(`[aria-label="Close ${mounted.process.name} Q, C and D"]`);
    const surface = mounted.container.querySelector<HTMLDivElement>(".process-map-surface");
    assert.ok(cardClose && surface);

    for (const key of ["Delete", "Backspace"]) {
      const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      await act(async () => { cardClose.dispatchEvent(event); });
      assert.equal(event.defaultPrevented, false, `${key} remains available to the focused scorecard button`);
    }
    for (const key of ["Enter", " "]) {
      const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      await act(async () => { cardClose.dispatchEvent(event); });
      assert.equal(event.defaultPrevented, false, `${JSON.stringify(key)} remains available to the focused scorecard button`);
    }
    assert.equal(confirmCalls, 0, "child Delete and Backspace never prompt for map deletion");
    assert.deepEqual(opened, [], "child Enter and Space never open the selected Process");

    const canvasDelete = new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    await act(async () => { surface.dispatchEvent(canvasDelete); });
    assert.equal(canvasDelete.defaultPrevented, true, "the focused canvas retains its confirmed deletion shortcut without a banner button");
    assert.equal(confirmCalls, 1);

    const canvasEnter = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => { surface.dispatchEvent(canvasEnter); });
    assert.equal(canvasEnter.defaultPrevented, true, "the focused canvas still owns its Process activation key");
    assert.deepEqual(opened, [[mounted.process.resource_id, mounted.process.name]]);
  } finally {
    window.confirm = originalConfirm;
    await mounted.cleanup();
  }
});

test("Explorer Logic Gate creation keeps the mounted scene until canonical automatic placement arrives", async () => {
  const bounds = { min_x: 0, min_y: 0, max_x: 48, max_y: 32 };
  const folder = { ...placement("create-folder", 0, 0, 44, 32, "company_explorer_folder"), name: "Create Folder" };
  const existing = {
    ...placement("create-existing", 4, 10, 14, 8),
    name: "Existing Process",
    map_parent_folder_id: folder.resource_id,
  };
  const created = {
    ...placement("create-new", 24, 10, 14, 8),
    name: "Created Process",
    map_parent_folder_id: folder.resource_id,
    revision: 1,
  };
  const mounted = await mountProcessMapForBehavior(() => undefined, {
    process: existing,
    initialPlacements: [folder, existing],
    sceneBounds: bounds,
  });
  try {
    await mounted.clickPlacement(existing);
    const existingKey = `logic_gate:${existing.resource_id}`;
    const createdKey = `logic_gate:${created.resource_id}`;
    const pinnedCard = mounted.container.querySelector(".process-map-qd-card");
    const cameraBefore = structuredClone(readProcessMapDeckGLTestProps().viewState);
    assert.ok(pinnedCard);
    assert.equal(mountedPlacementBodies(existingKey).length, 1);

    const heldScene = mounted.holdNextSceneRead();
    await emitMountedProcessMapChange(mounted, false);

    assert.equal(mounted.readSceneCount(), 2);
    assert.equal(mounted.readTileLayer().id, "process-map-spatial-tiles", "the last valid TileLayer must remain mounted while the scene read is pending");
    assert.equal(mountedPlacementBodies(existingKey).length, 1, "the selected existing Process must not disappear during refresh");
    assert.equal(mounted.container.querySelector(".process-map-qd-card"), pinnedCard);
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, cameraBefore);

    await resolveMountedScene(heldScene, 2, bounds);
    assert.match(String(mounted.readTileLayer().props.data), /^2:\d+:/);
    assert.equal(mountedPlacementBodies(existingKey).length, 1, "old coverage remains visible while version-2 tiles are pending");
    assert.equal(mounted.container.querySelector(".process-map-qd-card"), pinnedCard);

    await mounted.loadTile(behaviorTile(2, [folder, existing, created]));
    assert.equal(mounted.container.querySelector(".process-map-qd-card"), pinnedCard, "canonical replacement must not remount the existing pinned card");
    await mounted.clickPlacement(created);
    const createdBodies = mountedPlacementBodies(createdKey);
    assert.equal(createdBodies.length, 1, "automatic placement settles one exact Process identity");
    assert.deepEqual(createdBodies[0].pick?.placement && {
      parent: createdBodies[0].pick.placement.map_parent_folder_id,
      x: createdBodies[0].pick.placement.grid_x,
      y: createdBodies[0].pick.placement.grid_y,
      width: createdBodies[0].pick.placement.grid_width,
      height: createdBodies[0].pick.placement.grid_height,
    }, { parent: folder.resource_id, x: 24, y: 10, width: 14, height: 8 });
    assert.equal(mounted.container.querySelectorAll(".process-map-qd-card").length, 1);
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, cameraBefore);
  } finally {
    await mounted.cleanup();
  }
});

test("Explorer Folder deletion stays visible while pending and cannot resurrect from a stale tile", async () => {
  const bounds = { min_x: 0, min_y: 0, max_x: 72, max_y: 36 };
  const deletedFolder = { ...placement("delete-folder", 0, 0, 40, 32, "company_explorer_folder"), name: "Deleted Folder" };
  const deletedChild = {
    ...placement("delete-child", 6, 12, 14, 8),
    name: "Deleted Child",
    map_parent_folder_id: deletedFolder.resource_id,
  };
  const survivor = { ...placement("delete-survivor", 52, 12, 14, 8), name: "Survivor" };
  const mounted = await mountProcessMapForBehavior(() => undefined, {
    process: deletedChild,
    initialPlacements: [deletedFolder, deletedChild, survivor],
    sceneBounds: bounds,
  });
  try {
    await mounted.clickPlacement(deletedFolder);
    const folderKey = `company_explorer_folder:${deletedFolder.resource_id}`;
    const staleOnTileLoad = mounted.readTileLayer().props.onTileLoad as (header: { id: string; content: ProcessMapTileResponse }) => void;
    const cameraBefore = structuredClone(readProcessMapDeckGLTestProps().viewState);
    assert.equal(mountedFolderFences(folderKey).length, 4);

    const heldScene = mounted.holdNextSceneRead();
    await emitMountedProcessMapChange(mounted, false);
    assert.equal(mountedFolderFences(folderKey).length, 4, "the selected Folder fence remains until canonical deletion is available");
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, cameraBefore);

    await resolveMountedScene(heldScene, 2, bounds);
    assert.equal(mountedFolderFences(folderKey).length, 4, "scene settlement alone must not empty valid version-1 coverage");
    await mounted.loadTile(behaviorTile(2, [survivor]));
    assert.equal(mountedFolderFences(folderKey).length, 0, "canonical coverage removes the deleted Folder exactly once");

    await act(async () => { staleOnTileLoad({ id: "22-0-0", content: mounted.initialTile }); });
    assert.equal(mountedFolderFences(folderKey).length, 0, "a late version-1 tile cannot resurrect the deleted Folder");

    const laterScene = mounted.holdNextSceneRead();
    await emitMountedProcessMapChange(mounted, false);
    assert.equal(mountedFolderFences(folderKey).length, 0, "a later ordinary refresh cannot revive deleted edit geometry");
    await resolveMountedScene(laterScene, 3, bounds);
    await mounted.loadTile(behaviorTile(3, [survivor]));
    assert.equal(mountedFolderFences(folderKey).length, 0);
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, cameraBefore);
  } finally {
    await mounted.cleanup();
  }
});

test("an unrelated refresh preserves an offscreen selection until its canonical tile returns", async () => {
  const bounds = { min_x: 0, min_y: 0, max_x: 600, max_y: 80 };
  const selectedFolder = { ...placement("offscreen-folder", 0, 0, 40, 32, "company_explorer_folder"), name: "Offscreen Folder" };
  const viewportProcess = { ...placement("viewport-process", 320, 12, 14, 8), name: "Viewport Process" };
  const mounted = await mountProcessMapForBehavior(() => undefined, {
    process: viewportProcess,
    initialPlacements: [selectedFolder],
    sceneBounds: bounds,
  });
  try {
    const selectedKey = `company_explorer_folder:${selectedFolder.resource_id}`;
    await mounted.loadTile({ ...behaviorTile(1, [viewportProcess]), x: 1 }, false, "22-1-0");
    await mounted.clickPlacement(selectedFolder);
    const cameraBefore = structuredClone(readProcessMapDeckGLTestProps().viewState);
    assert.equal(mountedFolderFences(selectedKey).length, 4);

    const heldScene = mounted.holdNextSceneRead();
    await emitMountedProcessMapChange(mounted, false);
    await resolveMountedScene(heldScene, 2, bounds);

    await mounted.loadTile({ ...behaviorTile(2, [viewportProcess]), x: 1 }, true, "22-1-0");
    assert.equal(mountedFolderFences(selectedKey).length, 0, "current viewport settlement may retire the offscreen tile geometry");
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, cameraBefore);

    await mounted.loadTile(behaviorTile(2, [selectedFolder]), false, "22-0-0");
    assert.equal(mountedFolderFences(selectedKey).length, 4, "the selected edit fence returns when the still-existing Folder's canonical tile returns");
  } finally {
    await mounted.cleanup();
  }
});

test("Explorer PUT reparent and geometry settlement preserves selection, pin, and one latest placement", async () => {
  const bounds = { min_x: 0, min_y: 0, max_x: 96, max_y: 44 };
  const sourceFolder = { ...placement("move-source", 0, 0, 42, 40, "company_explorer_folder"), name: "Source Folder" };
  const targetFolder = { ...placement("move-target", 50, 0, 46, 44, "company_explorer_folder"), name: "Target Folder" };
  const original = {
    ...placement("move-process", 8, 14, 20, 12),
    name: "Moved Process",
    map_parent_folder_id: sourceFolder.resource_id,
  };
  const moved = {
    ...original,
    map_parent_folder_id: targetFolder.resource_id,
    grid_x: 68,
    grid_y: 18,
    grid_width: 22,
    grid_height: 14,
    revision: original.revision + 1,
    updated_timestamp: "moved",
  };
  const mounted = await mountProcessMapForBehavior(() => undefined, {
    process: original,
    initialPlacements: [sourceFolder, targetFolder, original],
    sceneBounds: bounds,
  });
  try {
    await mounted.clickPlacement(original);
    const key = `logic_gate:${original.resource_id}`;
    const staleOnTileLoad = mounted.readTileLayer().props.onTileLoad as (header: { id: string; content: ProcessMapTileResponse }) => void;
    const pinnedCard = mounted.container.querySelector(".process-map-qd-card");
    const cameraBefore = structuredClone(readProcessMapDeckGLTestProps().viewState);
    assert.ok(pinnedCard);
    assert.equal(mountedPlacementBodies(key).length, 1);

    const heldScene = mounted.holdNextSceneRead();
    await emitMountedProcessMapChange(mounted, false);
    const pendingBody = mountedPlacementBodies(key);
    assert.equal(pendingBody.length, 1);
    assert.deepEqual([pendingBody[0].pick?.placement.map_parent_folder_id, pendingBody[0].pick?.placement.grid_x], [sourceFolder.resource_id, 8]);
    assert.equal(mounted.container.querySelector(".process-map-qd-card"), pinnedCard);
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, cameraBefore);

    await resolveMountedScene(heldScene, 2, bounds);
    assert.equal(mountedPlacementBodies(key)[0].pick?.placement.grid_x, 8, "version-1 geometry remains until the version-2 tile arrives");
    await mounted.loadTile(behaviorTile(2, [sourceFolder, targetFolder, moved]));
    const settledBodies = mountedPlacementBodies(key);
    assert.equal(settledBodies.length, 1, "reparent settlement must not duplicate the Process");
    assert.deepEqual(settledBodies[0].pick?.placement && {
      parent: settledBodies[0].pick.placement.map_parent_folder_id,
      x: settledBodies[0].pick.placement.grid_x,
      y: settledBodies[0].pick.placement.grid_y,
      width: settledBodies[0].pick.placement.grid_width,
      height: settledBodies[0].pick.placement.grid_height,
      revision: settledBodies[0].pick.placement.revision,
    }, { parent: targetFolder.resource_id, x: 68, y: 18, width: 22, height: 14, revision: 6 });
    assert.equal(mounted.container.querySelector(".process-map-qd-card"), pinnedCard);

    await act(async () => { staleOnTileLoad({ id: "22-0-0", content: mounted.initialTile }); });
    const afterStaleBodies = mountedPlacementBodies(key);
    assert.equal(afterStaleBodies.length, 1);
    assert.deepEqual([afterStaleBodies[0].pick?.placement.map_parent_folder_id, afterStaleBodies[0].pick?.placement.grid_x], [targetFolder.resource_id, 68]);
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, cameraBefore);
  } finally {
    await mounted.cleanup();
  }
});

test("a remote-client ordinary mutation retains mounted state and settles its canonical geometry", async () => {
  const mounted = await mountProcessMapForBehavior(() => undefined);
  try {
    setCurrentRealtimeConnectionIDForTest("local-connection");
    await mounted.clickPlacement(mounted.process);
    const key = `logic_gate:${mounted.process.resource_id}`;
    const pinnedCard = mounted.container.querySelector(".process-map-qd-card");
    const cameraBefore = structuredClone(readProcessMapDeckGLTestProps().viewState);
    assert.ok(pinnedCard);
    assert.equal(mountedPlacementBodies(key).length, 1);

    await emitMountedProcessMapChange(mounted, false, "local-connection");
    assert.equal(mounted.readSceneCount(), 1, "the initiating connection's direct echo remains ignored");

    const heldScene = mounted.holdNextSceneRead();
    await emitMountedProcessMapChange(mounted, false, "remote-connection");
    assert.equal(mounted.readSceneCount(), 2);
    assert.equal(mountedPlacementBodies(key).length, 1);
    assert.equal(mounted.container.querySelector(".process-map-qd-card"), pinnedCard);
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, cameraBefore);

    const remote = { ...mounted.process, grid_x: 2, grid_y: 1, grid_width: 12, grid_height: 7, revision: 6, updated_timestamp: "remote" };
    await resolveMountedScene(heldScene, 2, { min_x: 0, min_y: 0, max_x: 14, max_y: 8 });
    await mounted.loadTile(behaviorTile(2, [remote]));
    const settled = mountedPlacementBodies(key);
    assert.equal(settled.length, 1);
    assert.deepEqual(settled[0].pick?.placement && [
      settled[0].pick.placement.grid_x,
      settled[0].pick.placement.grid_y,
      settled[0].pick.placement.grid_width,
      settled[0].pick.placement.grid_height,
    ], [2, 1, 12, 7]);
    assert.equal(mounted.container.querySelector(".process-map-qd-card"), pinnedCard);
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, cameraBefore);
  } finally {
    await mounted.cleanup();
  }
});

test("ordinary refresh certifies unrelated loaded tiles while preserving selection, pin, and camera", async () => {
  const mounted = await mountProcessMapForBehavior(() => undefined);
  try {
    const distant = placement("distant-process", 300, 0, 14, 8);
    const distantTile = { ...behaviorTile(1, [distant]), x: 1 };
    await mounted.loadTile(distantTile, false, "22-1-0");
    await mounted.clickPlacement(mounted.process);
    const pinned = mounted.container.querySelector(".process-map-qd-card");
    const camera = structuredClone(readProcessMapDeckGLTestProps().viewState);
    const held = mounted.holdNextSceneRead();
    await emitMountedProcessMapChange(mounted, false, "remote");
    await resolveMountedScene(held, 2, { min_x: 0, min_y: 0, max_x: 314, max_y: 8 }, [
      { z: 22, x: 1, y: 0, process_map_read_version: 1 },
    ]);
    const certified = mounted.readTileLayer().props.validatedTiles as ReadonlyMap<string, { previous: ProcessMapTileResponse; current: ProcessMapTileResponse }>;
    assert.equal(certified.size, 1);
    assert.equal(certified.get("22-1-0")?.previous, distantTile);
    assert.equal(certified.get("22-1-0")?.current.placements, distantTile.placements, "certification must retain the exact unrelated geometry arrays");
    assert.equal(certified.get("22-1-0")?.current.process_map_read_version, 2);
    assert.equal(certified.has("22-0-0"), false, "the changed tile must fetch new canonical data");
    const moved = { ...mounted.process, grid_x: 2, revision: 6 };
    await mounted.loadTile(behaviorTile(2, [moved]));
    assert.equal(mountedPlacementBodies(`logic_gate:${mounted.process.resource_id}`)[0].pick?.placement.grid_x, 2);
    assert.equal(mounted.container.querySelector(".process-map-qd-card"), pinned);
    assert.deepEqual(readProcessMapDeckGLTestProps().viewState, camera);
  } finally {
    await mounted.cleanup();
  }
});

test("canonical refresh remains active after React StrictMode effect replay", async () => {
  const mounted = await mountProcessMapForBehavior(() => undefined, { strictMode: true });
  try {
    const initialReads = mounted.readSceneCount();
    const held = mounted.holdNextSceneRead();
    await emitMountedProcessMapChange(mounted, false, "remote");
    assert.equal(mounted.readSceneCount(), initialReads + 1);
    await resolveMountedScene(held, initialReads + 1, { min_x: 0, min_y: 0, max_x: 14, max_y: 8 });
  } finally {
    await mounted.cleanup();
  }
});

test("protected geometry invalidation interrupts an ordinary refresh and cannot be origin-suppressed", async () => {
  const mounted = await mountProcessMapForBehavior(() => undefined);
  try {
    setCurrentRealtimeConnectionIDForTest("local-connection");
    await mounted.clickPlacement(mounted.process);
    assert.ok(mounted.container.querySelector(".process-map-qd-card"));
    assert.equal(mountedPlacementBodies(`logic_gate:${mounted.process.resource_id}`).length, 1);
    const ordinaryScene = mounted.holdNextSceneRead();
    await emitMountedProcessMapChange(mounted, false, "remote-connection");
    assert.equal(mounted.readSceneCount(), 2);
    assert.ok(readProcessMapDeckGLTestProps().layers.length > 0, "an ordinary refresh retains the mounted scene");

    const protectedReplacementScene = mounted.holdNextSceneRead();
    await emitMountedProcessMapChange(mounted, true, "local-connection");

    assert.equal(mounted.readSceneCount(), 3, "aborting the ordinary read immediately starts one coalesced protected replacement");
    assert.equal(readProcessMapDeckGLTestProps().layers.length, 0, "protected geometry must disappear synchronously while replacement is pending");
    assert.equal(mounted.container.querySelector(".process-map-qd-card"), null);
    assert.ok(mounted.container.querySelector(".process-map-loading"));

    await resolveMountedScene(ordinaryScene, 2, { min_x: 0, min_y: 0, max_x: 14, max_y: 8 });
    assert.equal(mounted.readSceneCount(), 3, "the aborted ordinary response is ignored and one protected replacement read starts");
    assert.equal(readProcessMapDeckGLTestProps().layers.length, 0);

    await resolveMountedScene(protectedReplacementScene, 3, { min_x: 0, min_y: 0, max_x: 14, max_y: 8 });
    assert.equal(mounted.readTileLayer().id, "process-map-spatial-tiles");
  } finally {
    await mounted.cleanup();
  }
});

test("one TileLayer configures non-geographic selection and debounced missing-tile scheduling", async () => {
  let reads = 0;
  const payload: ProcessMapTileResponse = { z: 22, x: 0, y: 0, process_map_read_version: 11, placements: [], traces: [], byteLength: 100 };
  const layers = buildProcessMapLayers(buildOptions({
    settled: false,
    getTileData: async () => { reads += 1; return payload; },
  }));
  const tiles = layerByID(layers, "process-map-spatial-tiles");
  assert.equal(layers.filter((layer) => layer.id === "process-map-spatial-tiles").length, 1);
  assert.equal(tiles.props.tileSize, processMapDeckTileSize(scene.tile_size, scene.max_tile_zoom));
  assert.equal(tiles.props.zoomOffset, scene.max_tile_zoom);
  assert.equal(tiles.props.maxCacheByteSize, PROCESS_MAP_TILE_CACHE_BYTES);
  assert.equal(tiles.props.debounceTime, PROCESS_MAP_TILE_DEBOUNCE_MS);
  assert.ok(Number(tiles.props.maxRequests) > 0 && Number(tiles.props.maxRequests) <= 16);
  assert.equal(tiles.props.updateTriggers?.getTileData, undefined, "camera settlement must not invalidate tile data");
  const getTileData = tiles.props.getTileData as unknown as (request: { id: string; index: { z: number; x: number; y: number }; signal: AbortSignal }) => Promise<ProcessMapTileResponse | null>;
  assert.equal(await getTileData({ id: "22-0-0", index: { z: 22, x: 0, y: 0 }, signal: new AbortController().signal }), payload);
  assert.equal(reads, 1);
});

test("protected generations keep one logical TileLayer while replacing and disposing protected Tilesets", () => {
  const first = layerByID(buildProcessMapLayers(buildOptions({ protectedGeneration: 0 })), "process-map-spatial-tiles");
  const second = layerByID(buildProcessMapLayers(buildOptions({ protectedGeneration: 1 })), "process-map-spatial-tiles");
  const nextBusinessDay = layerByID(buildProcessMapLayers(buildOptions({ protectedGeneration: 1, scoreCardBusinessDate: "2026-08-27" })), "process-map-spatial-tiles");
  assert.equal(first.id, second.id, "the deck layer identity remains stable across protected generations");
  assert.equal(first.props.data, "11:0:2026-08-26");
  assert.equal(second.props.data, "11:1:2026-08-26");
  assert.equal(nextBusinessDay.props.data, "11:1:2026-08-27", "the LA business day must replace stale QCD tile data");
  assert.equal(first.props.updateTriggers?.getTileData, undefined);
  assert.equal(second.props.updateTriggers?.getTileData, undefined);

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
      changeFlags: { dataChanged: false, updateTriggersChanged: false },
    } as never);
    assert.equal(finalizes, 0);
    ProcessMapProtectedTileLayer.prototype.updateState.call(fake as never, {
      oldProps: { protectedGeneration: 4 },
      props: { protectedGeneration: 5 },
      changeFlags: { dataChanged: false, updateTriggersChanged: false },
    } as never);
    assert.equal(finalizes, 1, "permission generation changes must finalize the old protected Tileset");
    assert.equal(fake.state.tileset, null);
    assert.equal(fake.state.isLoaded, false);
    assert.equal(parentUpdates, 2);
  } finally {
    parent.updateState = originalParentUpdate;
  }
});

test("mutation masks regenerate cached tile sublayers during a same-permission version reload", () => {
  const parent = Object.getPrototypeOf(ProcessMapProtectedTileLayer.prototype) as { updateState: (params: unknown) => void };
  const originalParentUpdate = parent.updateState;
  const cachedTile = {
    layers: [{}] as unknown[] | null,
    content: { placements: [placement("masked", 0, 0)], traces: [] },
  };
  const fake = { state: { tileset: { tiles: [cachedTile] } } };
  parent.updateState = () => undefined;
  try {
    ProcessMapProtectedTileLayer.prototype.updateState.call(fake as never, {
      oldProps: { protectedGeneration: 4, renderState: {
        settledPixelsPerGridUnit: 1, editedPlacementKeys: new Set(), editedTraceIDs: new Set(), selectedPlacementKey: null, selectedTraceID: null,
      } },
      props: { protectedGeneration: 4, validatedTiles: null, renderState: {
        settledPixelsPerGridUnit: 1, editedPlacementKeys: new Set(["logic_gate:masked"]), editedTraceIDs: new Set(), selectedPlacementKey: null, selectedTraceID: null,
      } },
      changeFlags: { dataChanged: true, updateTriggersChanged: { renderSubLayers: true } },
    } as never);
    assert.equal(cachedTile.layers, null, "mutation masks must immediately regenerate cached drawing sublayers");
  } finally {
    parent.updateState = originalParentUpdate;
  }
});

test("settled LOD changes regenerate sublayers without reloading cached tile data", () => {
  let reloads = 0;
  let optionUpdates = 0;
  const cachedTile = { layers: [{}] as unknown[] | null };
  const tileLayerPrototype = Object.getPrototypeOf(ProcessMapProtectedTileLayer.prototype) as {
    updateState: (params: unknown) => void;
  };
  const fake = {
    state: {
      tileset: {
        reloadAll: () => { reloads += 1; },
        setOptions: () => { optionUpdates += 1; },
        tiles: [cachedTile],
      },
    },
    _getTilesetOptions: () => ({}),
    _updateTileset: () => undefined,
  };

  tileLayerPrototype.updateState.call(fake, {
    changeFlags: {
      propsOrDataChanged: false,
      updateTriggersChanged: { renderSubLayers: true },
      dataChanged: false,
    },
  });
  assert.equal(optionUpdates, 1);
  assert.equal(reloads, 0, "a settled LOD change must not reload valid same-version tile data");
  assert.equal(cachedTile.layers, null, "LOD changes may synchronously regenerate drawing sublayers");

  tileLayerPrototype.updateState.call(fake, {
    changeFlags: {
      propsOrDataChanged: true,
      updateTriggersChanged: false,
      dataChanged: true,
    },
  });
  assert.equal(reloads, 1, "a real tile data identity change still reloads stale payloads");
});

test("ordinary shared-read cancellation retains tile coverage before deck transitions, while protected cancellation clears it", async () => {
  const mounted = await mountProcessMapForBehavior(() => undefined);
  const originalFetch = globalThis.fetch;
  const observedSignals: AbortSignal[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("/v1/process-map/tiles/")) return originalFetch(input, init);
    const signal = init?.signal;
    assert.ok(signal);
    observedSignals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  }) as typeof fetch;
  const header = new TileHeader<ProcessMapTileResponse>({ z: 22, x: 0, y: 0 });
  header.id = "22-0-0";
  header.content = mounted.initialTile;
  const loadFromSurface = () => {
    const read = mounted.readTileLayer().props.getTileData as (request: {
      id: string; index: { z: number; x: number; y: number }; signal: AbortSignal;
    }) => Promise<ProcessMapTileResponse | null>;
    return header.loadData({
      requestScheduler: { scheduleRequest: async () => ({ done: () => undefined }) } as never,
      getData: read as never,
      onLoad: () => undefined,
      onError: (error) => { throw error; },
    });
  };
  try {
    const ordinaryLoad = loadFromSurface();
    await act(async () => { await Promise.resolve(); });
    assert.equal(observedSignals.length, 1);
    await act(async () => {
      emitProcessMapChangedForTest({ type: "process_map.changed", company_id: mounted.companyID, scope: "process-map:company", protected_geometry_changed: false });
      await ordinaryLoad;
    });
    assert.equal(observedSignals[0].aborted, true, "obsolete shared transport still cancels immediately");
    assert.equal(header.content, mounted.initialTile, "a stale/aborted null must not erase last valid coverage before the next deck update");

    const protectedLoad = loadFromSurface();
    await act(async () => { await Promise.resolve(); });
    assert.equal(observedSignals.length, 2);
    await act(async () => {
      emitProcessMapChangedForTest({ type: "process_map.changed", company_id: mounted.companyID, scope: "process-map:company", protected_geometry_changed: true });
      await protectedLoad;
    });
    assert.equal(observedSignals[1].aborted, true);
    assert.equal(header.content, null, "a protected generation change must never retain earlier tile content");
  } finally {
    globalThis.fetch = originalFetch;
    await mounted.cleanup();
  }
});

test("preview replacement preserves unrelated operations", () => {
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
  const layers = buildProcessMapLayers(buildOptions());
  const background = layerByID(layers, "process-map-background");
  const tileLayer = layerByID(layers, "process-map-spatial-tiles");
  const render = tileLayer.props.renderSubLayers as unknown as (props: { id: string; data: ProcessMapTileResponse; tile: { boundingBox: [number[], number[]] } }) => Layer[];
  const sublayers = render({ id: "tile", data: tileData, tile: { boundingBox: [[0, 0], [256, 256]] } });
  const folderShadows = layerByID(sublayers, "tile-folder-shadows");
  const folderSurfaces = layerByID(sublayers, "tile-folder-surfaces");
  const bodies = layerByID(sublayers, "tile-placements");
  const fences = layerByID(sublayers, "tile-folder-fences");
  const restricted = layerByID(sublayers, "tile-restricted");
  const labels = layerByID(sublayers, "tile-labels");
  assert.deepEqual((background.props.data as Array<{ fill: number[] }>)[0].fill, [255, 255, 255, 255], "the Deck canvas uses the light map surface");
  assert.equal((folderShadows.props.data as unknown[]).length, 1, "the Folder remains elevated at whole-company LOD");
  assert.equal(folderShadows.props.pickable, false);
  assert.deepEqual((folderSurfaces.props.data as Array<{ fill: number[] }>)[0].fill, [255, 247, 237, 190]);
  assert.equal(folderSurfaces.props.pickable, false, "the Folder surface must not hide restricted or accessible picks inside it");
  assert.equal((bodies.props.data as unknown[]).length, 1, "only the Process needs a pickable filled body at whole-company LOD");
  assert.deepEqual((bodies.props.data as Array<{ fill: number[] }>)[0].fill, [248, 250, 252, 252]);
  assert.ok((fences.props.data as unknown[]).length > 0, "the elevated Folder retains its orange selection perimeter");
  assert.equal((restricted.props.data as unknown[]).length, 1);
  assert.deepEqual((restricted.props.data as Array<{ fill: number[] }>)[0].fill, [226, 232, 240, 245]);
  assert.equal(restricted.props.pickable, false);
  const texts = (labels.props.data as Array<{ text: string }>).map((item) => item.text);
  assert.deepEqual(texts, ["?"], "whole LOD suppresses names but retains a permission-safe placeholder");
  const getLabelColor = labels.props.getColor as (item: { color?: number[] }) => number[];
  assert.deepEqual(getLabelColor((labels.props.data as Array<{ color?: number[] }>)[0]), [30, 41, 59, 245]);
});

test("large Folder labels stay in their proportional title band while Process labels remain centered", () => {
  const folder = placement("folder-label", 0, 0, 80, 60, "company_explorer_folder");
  const process = placement("process-label", 100, 0, 80, 60);
  const tileData: ProcessMapTileResponse = {
    z: 22, x: 0, y: 0, process_map_read_version: 11, byteLength: 1,
    placements: [folder, process],
    traces: [],
  };
  const tileLayer = layerByID(buildProcessMapLayers(buildOptions({ settledPixelsPerGridUnit: 2.5 })), "process-map-spatial-tiles");
  const render = tileLayer.props.renderSubLayers as unknown as (props: { id: string; data: ProcessMapTileResponse; tile: { boundingBox: [number[], number[]] } }) => Layer[];
  const sublayers = render({ id: "normal-labels", data: tileData, tile: { boundingBox: [[0, 0], [256, 256]] } });
  const labelsLayer = layerByID(sublayers, "normal-labels-labels");
  const labels = labelsLayer.props.data as Array<{ position: [number, number]; text: string; pick: { key: string } }>;
  const folderLabel = labels.find((item) => item.text === folder.name);
  const processLabel = labels.find((item) => item.text === process.name);
  assert.ok(folderLabel && processLabel);
  assert.equal(folderLabel.position[1], folder.grid_y + 3.5, "the fitted editing label stays centered in the proportional title band");
  assert.equal(processLabel.position[1], process.grid_y + process.grid_height / 2);
  assert.deepEqual(labels.map((item) => item.text), [folder.name, process.name], "labels show source names without redundant type captions");
  assert.equal(labelsLayer.props.pickable, true, "a Folder name is a direct selection and move target");
  assert.equal(folderLabel.pick.key, `company_explorer_folder:${folder.resource_id}`);
  const getLabelColor = labelsLayer.props.getColor as (item: { color?: number[] }) => number[];
  assert.ok(labels.every((item) => getLabelColor(item).join(",") === "30,41,59,245"), "entity names stay dark and readable on the light surfaces");

  const folderShadows = layerByID(sublayers, "normal-labels-folder-shadows");
  const folderSurfaces = layerByID(sublayers, "normal-labels-folder-surfaces");
  const shadows = layerByID(sublayers, "normal-labels-process-shadows");
  const bodies = layerByID(sublayers, "normal-labels-placements");
  const fences = layerByID(sublayers, "normal-labels-folder-fences");
  const processPerimeters = layerByID(sublayers, "normal-labels-process-perimeters");
  assert.equal((folderShadows.props.data as unknown[]).length, 1, "the Folder receives an elevation shadow");
  assert.equal((folderSurfaces.props.data as unknown[]).length, 1, "the Folder receives one encompassing surface");
  assert.equal(folderShadows.props.pickable, false);
  assert.equal(folderSurfaces.props.pickable, false);
  assert.equal((shadows.props.data as unknown[]).length, 1, "the Process retains its own elevation shadow");
  assert.equal(shadows.props.pickable, false, "the shadow never becomes another interaction target");
  assert.deepEqual((bodies.props.data as Array<{ fill: number[] }>)[0].fill, [248, 250, 252, 252]);
  assert.ok((fences.props.data as Array<{ color: number[] }>).every((item) => item.color.join(",") === "249,115,22,230"));
  assert.ok((processPerimeters.props.data as Array<{ color: number[] }>).every((item) => item.color.join(",") === "25,240,122,235"));
  assert.ok(sublayers.indexOf(folderShadows) < sublayers.indexOf(folderSurfaces));
  assert.ok(sublayers.indexOf(folderSurfaces) < sublayers.indexOf(fences), "the noninteractive Folder surface stays behind its interactive perimeter");
  assert.ok(sublayers.indexOf(shadows) < sublayers.indexOf(bodies), "the Process surface stays above its shadow");

  const presentation: ProcessMapPresentationState = {
    placements: new Map([[`company_explorer_folder:${folder.resource_id}`, folder]]),
    traces: new Map(),
    removedPlacementKeys: new Set(),
  };
  const editLayers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 2.5,
    presentation,
    editedPlacementKeys: new Set(presentation.placements.keys()),
    editOverlay: {
      placements: [folder], traces: [], selectedPlacementKey: `company_explorer_folder:${folder.resource_id}`, selectedTraceID: null,
      connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null, hoveredPlacementKey: null, placementTransform: null,
    },
  }));
  const editFolderLabel = (layerByID(editLayers, "process-map-edit-labels").props.data as Array<{ position: [number, number] }>)[0];
  assert.equal(editFolderLabel.position[1], folder.grid_y + 3.5, "the selected overlay uses the same proportional title band");

  const normalFolder = placement("normal-folder-label", 0, 0, 80, 48, "company_explorer_folder");
  const normalTileData: ProcessMapTileResponse = {
    z: 22, x: 0, y: 0, process_map_read_version: 11, byteLength: 1,
    placements: [normalFolder],
    traces: [],
  };
  const normalTile = layerByID(buildProcessMapLayers(buildOptions({ settledPixelsPerGridUnit: 1.9 })), "process-map-spatial-tiles");
  const normalTileLayers = (normalTile.props.renderSubLayers as typeof render)({
    id: "normal-selected-label",
    data: normalTileData,
    tile: { boundingBox: [[0, 0], [256, 256]] },
  });
  const normalTileLabels = layerByID(normalTileLayers, "normal-selected-label-labels").props.data as Array<{ text: string; size: number }>;
  assert.deepEqual(normalTileLabels.map((item) => [item.text, item.size]), [[normalFolder.name, 11]]);
  const normalPresentation: ProcessMapPresentationState = {
    placements: new Map([[`company_explorer_folder:${normalFolder.resource_id}`, normalFolder]]),
    traces: new Map(),
    removedPlacementKeys: new Set(),
  };
  const normalEditLayers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 1.9,
    presentation: normalPresentation,
    editedPlacementKeys: new Set(normalPresentation.placements.keys()),
    editOverlay: {
      placements: [normalFolder], traces: [], selectedPlacementKey: `company_explorer_folder:${normalFolder.resource_id}`, selectedTraceID: null,
      connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null, hoveredPlacementKey: null, placementTransform: null,
    },
  }));
  const normalEditLabels = layerByID(normalEditLayers, "process-map-edit-labels").props.data as Array<{ text: string; size: number }>;
  assert.deepEqual(normalEditLabels.map((item) => [item.text, item.size]), [[normalFolder.name, 11]], "selection preserves a normal-LOD Folder title");

  const highZoomTile = layerByID(buildProcessMapLayers(buildOptions({ settledPixelsPerGridUnit: 24 })), "process-map-spatial-tiles");
  const renderHighZoom = highZoomTile.props.renderSubLayers as typeof render;
  const highZoomLayers = renderHighZoom({ id: "high-zoom-labels", data: tileData, tile: { boundingBox: [[0, 0], [256, 256]] } });
  const highZoomFolderLabel = (layerByID(highZoomLayers, "high-zoom-labels-labels").props.data as Array<{ position: [number, number]; text: string }>).find((item) => item.text === folder.name);
  assert.equal(highZoomFolderLabel?.position[1], folder.grid_y + 18 / 24, "higher zoom retains the established 18px editing offset");

  const lowZoomTile = layerByID(buildProcessMapLayers(buildOptions({ settledPixelsPerGridUnit: 0.5 })), "process-map-spatial-tiles");
  const renderLowZoom = lowZoomTile.props.renderSubLayers as typeof render;
  const lowZoomLayers = renderLowZoom({ id: "low-zoom-labels", data: tileData, tile: { boundingBox: [[0, 0], [256, 256]] } });
  const lowZoomTexts = (layerByID(lowZoomLayers, "low-zoom-labels-labels").props.data as Array<{ text: string }>).map((item) => item.text);
  assert.deepEqual(lowZoomTexts, [process.name], "a title band shorter than the Folder font hides only the Folder title");

  const lowZoomEditLayers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 0.5,
    presentation,
    editedPlacementKeys: new Set(presentation.placements.keys()),
    editOverlay: {
      placements: [folder], traces: [], selectedPlacementKey: `company_explorer_folder:${folder.resource_id}`, selectedTraceID: null,
      connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null, hoveredPlacementKey: null, placementTransform: null,
    },
  }));
  assert.deepEqual(layerByID(lowZoomEditLayers, "process-map-edit-labels").props.data, [], "the selected overlay also hides a Folder title that cannot fit its band");
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
  const tiledTraceLayer = layerByID(tileLayers, "xy-tile-traces");
  assert.equal(tiledTraceLayer.props.widthUnits, "pixels");
  assert.equal(tiledTraceLayer.props.widthMinPixels, 2);
  assert.equal(tiledTraceLayer.props.widthMaxPixels, Number.MAX_SAFE_INTEGER, "normal traces keep deck.gl's unbounded pixel-width default");
  assert.ok((tiledTraceLayer.props.data as Array<{ width: number }>).every((item) => item.width === 3), "tile traces keep the established fixed screen width");

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
      hoveredPlacementKey: null,
      placementTransform: null,
    },
  }));
  const editTraceLayer = layerByID(editLayers, "process-map-edit-traces");
  assertFlatXYPathLayer(editTraceLayer);
  assertFlatXYPathLayer(layerByID(editLayers, "process-map-edit-folder-fences"));
  const editTraceData = editTraceLayer.props.data as Array<{ path: [number, number][]; color: number[]; width: number }>;
  assert.ok(editTraceData.every((item) => item.color.join(",") === "38,195,234,220"), "saved and pending traces retain one static cyan-blue treatment");
  assert.ok(editTraceData.every((item) => item.path.slice(1).every((point, index) => point[0] === item.path[index][0] || point[1] === item.path[index][1])), "saved and pending traces contain only horizontal or vertical segments");
  assert.equal(editTraceData[0].width, 4, "the selected trace keeps the established fixed edit width");
  assert.equal(editTraceData[editTraceData.length - 1]?.width, 3, "the connection preview keeps the established fixed width");
});

test("placement and Process-card text stay horizontally clipped inside their rectangles", () => {
  const folder: ProcessMapVisiblePlacement = {
    ...placement("clip-folder", 10, 10, 80, 60, "company_explorer_folder"),
    name: "A very long Folder name that must never cross into a neighboring rectangle",
  };
  const process: ProcessMapVisiblePlacement = {
    ...placement("clip-process", 100, 20, 14, 10),
    name: "A very long Process name that must stay inside this card",
  };
  const placements = [folder, process];
  const placementByText = new Map(placements.map((item) => [item.name, item]));
  const tileLayer = layerByID(buildProcessMapLayers(buildOptions({ settledPixelsPerGridUnit: 24 })), "process-map-spatial-tiles");
  const render = tileLayer.props.renderSubLayers as unknown as (props: {
    id: string;
    data: ProcessMapTileResponse;
    tile: { boundingBox: [number[], number[]] };
  }) => Layer[];
  const tileLayers = render({
    id: "clipped-labels",
    data: { z: 22, x: 0, y: 0, process_map_read_version: 11, byteLength: 1, placements, traces: [] },
    tile: { boundingBox: [[0, 0], [256, 256]] },
  });
  const tiledLabelLayer = layerByID(tileLayers, "clipped-labels-labels");
  const tiledLabels = tiledLabelLayer.props.data as PlacementLabelDatum[];
  const getTiledContentBox = tiledLabelLayer.props.getContentBox as (datum: PlacementLabelDatum) => [number, number, number, number];
  assert.deepEqual(tiledLabels.map((datum) => datum.text), placements.map((item) => item.name));
  for (const datum of tiledLabels) {
    const candidate = placementByText.get(datum.text);
    assert.ok(candidate);
    assertPlacementLabelHorizontalContentBox(candidate, datum);
    assert.deepEqual(getTiledContentBox(datum), datum.contentBox);
  }

  const processCardTextLayer = layerByID(tileLayers, "clipped-labels-process-card-text");
  const processCardText = processCardTextLayer.props.data as PlacementLabelDatum[];
  const getCardContentBox = processCardTextLayer.props.getContentBox as (datum: PlacementLabelDatum) => [number, number, number, number];
  assert.ok(processCardText.length > 0, "the editing Process fixture must expose QCD and RACI text");
  for (const datum of processCardText) {
    assertPlacementLabelHorizontalContentBox(process, datum);
    assert.deepEqual(getCardContentBox(datum), datum.contentBox);
  }

  const presentation: ProcessMapPresentationState = {
    placements: new Map(placements.map((item) => [`${item.resource_type}:${item.resource_id}`, item])),
    traces: new Map(),
    removedPlacementKeys: new Set(),
  };
  const editLayers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 24,
    presentation,
    editedPlacementKeys: new Set(presentation.placements.keys()),
    editOverlay: {
      placements,
      traces: [],
      selectedPlacementKey: null,
      hoveredPlacementKey: null,
      selectedTraceID: null,
      connectionPreview: null,
      highlightedFolderKey: null,
      connectionSourceKey: null,
      placementTransform: null,
    },
  }));
  const editLabelLayer = layerByID(editLayers, "process-map-edit-labels");
  const editLabels = editLabelLayer.props.data as PlacementLabelDatum[];
  const getEditContentBox = editLabelLayer.props.getContentBox as (datum: PlacementLabelDatum) => [number, number, number, number];
  assert.deepEqual(editLabels.map((datum) => datum.text), placements.map((item) => item.name));
  for (const datum of editLabels) {
    const candidate = placementByText.get(datum.text);
    assert.ok(candidate);
    assertPlacementLabelHorizontalContentBox(candidate, datum);
    assert.deepEqual(getEditContentBox(datum), datum.contentBox);
  }
  const editProcessCardTextLayer = layerByID(editLayers, "process-map-edit-process-card-text");
  const editProcessCardText = editProcessCardTextLayer.props.data as PlacementLabelDatum[];
  const getEditCardContentBox = editProcessCardTextLayer.props.getContentBox as (datum: PlacementLabelDatum) => [number, number, number, number];
  assert.equal(editProcessCardText.length, processCardText.length);
  for (const datum of editProcessCardText) {
    assertPlacementLabelHorizontalContentBox(process, datum);
    assert.deepEqual(getEditCardContentBox(datum), datum.contentBox);
  }
});

test("nested Folder title bands scale with geometry and respect existing manually positioned children", () => {
  for (const factor of [8 ** 8, 8 ** 4, 8]) {
    const folder = placement("scaled-folder", 500_000_000, -800_000_000, 14 * factor, 8 * factor, "company_explorer_folder");
    const child = { ...placement("scaled-child", folder.grid_x + factor / 4, folder.grid_y + factor, 14 * factor / 8, factor), map_parent_folder_id: folder.resource_id };
    const scale = 128 / folder.grid_height;
    const renderLabels = (currentChild: ProcessMapVisiblePlacement) => {
      const placements = [folder, currentChild];
      const key = `company_explorer_folder:${folder.resource_id}`;
      const presentation: ProcessMapPresentationState = {
        placements: new Map(placements.map((item) => [`${item.resource_type}:${item.resource_id}`, item])), traces: new Map(), removedPlacementKeys: new Set(),
      };
      const tiled = layerByID(buildProcessMapLayers(buildOptions({ settledPixelsPerGridUnit: scale })), "process-map-spatial-tiles");
      const render = tiled.props.renderSubLayers as unknown as (props: { id: string; data: ProcessMapTileResponse; tile: { boundingBox: [number[], number[]] } }) => Layer[];
      const tileLayers = render({
        id: "scaled",
        data: { z: 22, x: 0, y: 0, process_map_read_version: 11, byteLength: 1, placements, traces: [] },
        tile: { boundingBox: [[folder.grid_x, folder.grid_y], [folder.grid_x + folder.grid_width, folder.grid_y + folder.grid_height]] },
      });
      const selected = buildProcessMapLayers(buildOptions({
        settledPixelsPerGridUnit: scale, presentation, editedPlacementKeys: new Set([key]),
        editOverlay: {
          placements: [folder], traces: [], selectedPlacementKey: key, selectedTraceID: null,
          connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null, hoveredPlacementKey: null, placementTransform: null,
        },
      }));
      return [layerByID(tileLayers, "scaled-labels"), layerByID(selected, "process-map-edit-labels")]
        .map((layer) => (layer.props.data as Array<PlacementLabelDatum & { size: number }>).find((item) => item.text === folder.name));
    };
    for (const label of renderLabels(child)) {
      assert.ok(label, "each nested Folder has a readable title at the same projected size");
      const halfHeight = label.size / scale / 2;
      assert.ok(label.position[1] - halfHeight >= folder.grid_y);
      assert.ok(label.position[1] + halfHeight <= child.grid_y);
      assertPlacementLabelHorizontalContentBox(folder, label);
    }
    const manuallyPlaced = { ...child, grid_y: folder.grid_y + 6 };
    assert.deepEqual(renderLabels(manuallyPlaced), [undefined, undefined], "a saved child close to the top suppresses an overlapping title without moving the child");
    assert.equal(manuallyPlaced.grid_y, folder.grid_y + 6);
  }
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
      connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null, hoveredPlacementKey: null, placementTransform: null,
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
      connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null, hoveredPlacementKey: null, placementTransform: null,
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
      connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null, hoveredPlacementKey: null, placementTransform: null,
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

test("selected name-visible Folder keeps a non-pickable elevated surface behind its contents and controls", () => {
  const folder = placement("Folder", 10, 20, 112, 64, "company_explorer_folder");
  const child = { ...placement("Child", 14, 32, 14, 8), map_parent_folder_id: folder.resource_id };
  const key = "company_explorer_folder:Folder";
  const presentation: ProcessMapPresentationState = {
    placements: new Map([[key, folder], ["logic_gate:Child", child]]), traces: new Map(), removedPlacementKeys: new Set(),
  };
  const layers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 1.45,
    presentation,
    editedPlacementKeys: new Set([key]),
    editOverlay: {
      placements: [folder], traces: [], selectedPlacementKey: key, selectedPlacementKeys: new Set([key]), selectedTraceID: null,
      connectionPreview: null, highlightedFolderKey: key, connectionSourceKey: null, hoveredPlacementKey: null, placementTransform: null,
    },
  }));
  const folderShadowLayer = layerByID(layers, "process-map-edit-folder-shadows");
  const folderSurfaceLayer = layerByID(layers, "process-map-edit-folder-surfaces");
  const fenceLayer = layerByID(layers, "process-map-edit-folder-fences");
  const fences = fenceLayer.props.data as Array<{ color: number[] }>;
  const processShadows = layerByID(layers, "process-map-edit-placement-shadows").props.data as unknown[];
  const processBodies = layerByID(layers, "process-map-edit-placement-bodies").props.data as Array<{ fill: number[] }>;
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
  assert.equal((folderShadowLayer.props.data as unknown[]).length, 1);
  assert.equal((folderSurfaceLayer.props.data as unknown[]).length, 1);
  assert.equal(folderShadowLayer.props.pickable, false);
  assert.equal(folderSurfaceLayer.props.pickable, false, "the selected Folder surface does not become an interior hit target");
  assert.equal(fences.length, 4, "the selected Folder retains one interactive perimeter");
  assert.ok(fences.every((item) => item.color.join(",") === "14,165,233,255"), "selection remains visible without changing the surface's hit behavior");
  assert.equal(processShadows.length, 0, "Folder elevation remains separate from Process-card elevation");
  assert.equal(processBodies.length, 0, "the selected Folder is absent from the pickable Process-body layer");
  assert.deepEqual(containedBodies.map((item) => item.pick.key), ["logic_gate:Child"], "the contained Process body stays directly pickable");
  assert.ok(layers.indexOf(folderShadowLayer) < layers.indexOf(folderSurfaceLayer));
  assert.ok(layers.indexOf(folderSurfaceLayer) < layers.indexOf(tileLayer), "the selected Folder backdrop stays below its tiled contents");
  assert.ok(layers.indexOf(tileLayer) < layers.indexOf(fenceLayer), "the selected perimeter and controls stay above the tiled contents");
  assert.ok(labels[0].position[1] > folder.grid_y && labels[0].position[1] < folder.grid_y + folder.grid_height / 2, "the selected Folder label stays along the inside top edge");
  assert.equal(handles.length, 4, "all four corners resize the saved global bounds");
  assert.equal(anchors.length, 2, "physical input and output sides remain connectable when the Folder name is visible");
});

test("selected name-visible Process retains the elevated surface and exposes four resize corners", () => {
  const process = placement("Resizable Process", 10, 20, 14, 10);
  const key = "logic_gate:Resizable Process";
  const presentation: ProcessMapPresentationState = {
    placements: new Map([[key, process]]), traces: new Map(), removedPlacementKeys: new Set(),
  };
  const layers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 4,
    presentation,
    editedPlacementKeys: new Set([key]),
    editOverlay: {
      placements: [process], traces: [], selectedPlacementKey: key, selectedPlacementKeys: new Set([key]), selectedTraceID: null,
      connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null, hoveredPlacementKey: null, placementTransform: null,
    },
  }));
  const shadows = layerByID(layers, "process-map-edit-placement-shadows");
  const bodies = layerByID(layers, "process-map-edit-placement-bodies");
  const labels = layerByID(layers, "process-map-edit-labels").props.data as Array<{ text: string; pick: { key: string } }>;
  const handles = layerByID(layers, "process-map-edit-resize-handles").props.data as unknown[];
  const anchors = layerByID(layers, "process-map-edit-anchors").props.data as unknown[];
  assert.equal((shadows.props.data as unknown[]).length, 1);
  assert.equal(shadows.props.pickable, false);
  assert.deepEqual((bodies.props.data as Array<{ fill: number[] }>)[0].fill, [248, 250, 252, 252]);
  assert.deepEqual(labels.map((item) => [item.text, item.pick.key]), [[process.name, key]]);
  assert.equal(handles.length, 4, "all four corners resize the Process bounds");
  assert.equal(anchors.length, 2, "selected Process input and output anchors remain distinct from resize corners");
  assert.ok(layers.indexOf(shadows) < layers.indexOf(bodies));
});

test("editing Process cards show bounded QCD and RACI summaries in tiled and selected layers", () => {
  const process: ProcessMapVisiblePlacement = {
    ...placement("process-internal-id", 10, 20, 14, 10),
    name: "Review",
    score_card: { quality_rating: "green", cost_rating: "yellow", delivery_rating: "red" },
    responsible_names: ["Ada", "Lin"],
    accountable_names: ["Grace"],
  };
  const key = "logic_gate:process-internal-id";
  const presentation: ProcessMapPresentationState = {
    placements: new Map([[key, process]]), traces: new Map(), removedPlacementKeys: new Set(),
  };
  const tileLayer = layerByID(buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 24,
    presentation,
  })), "process-map-spatial-tiles");
  const render = tileLayer.props.renderSubLayers as unknown as (props: {
    id: string;
    data: ProcessMapTileResponse;
    tile: { boundingBox: [number[], number[]] };
  }) => Layer[];
  const renderCardText = (id: string, candidate: ProcessMapTileResponse["placements"][number], pixelsPerGridUnit = 24) => {
    const layer = layerByID(buildProcessMapLayers(buildOptions({ settledPixelsPerGridUnit: pixelsPerGridUnit })), "process-map-spatial-tiles");
    const renderCandidate = layer.props.renderSubLayers as typeof render;
    const layers = renderCandidate({
      id,
      data: { z: 22, x: 0, y: 0, process_map_read_version: 11, byteLength: 1, placements: [candidate], traces: [] },
      tile: { boundingBox: [[0, 0], [256, 256]] },
    });
    return layerByID(layers, `${id}-process-card-text`).props.data as Array<{
      text: string;
      color: number[];
      position: [number, number];
      size: number;
      textAnchor: string;
    }>;
  };

  const tiledText = renderCardText("editing-card", process);
  assert.deepEqual(tiledText.map((datum) => datum.text), ["Q", "C", "D", "R", "Ada, Lin", "A", "Grace"]);
  assert.deepEqual(tiledText.slice(0, 3).map((datum) => datum.color), [
    [104, 184, 78, 255],
    [242, 193, 79, 255],
    [223, 83, 83, 255],
  ]);
  assert.deepEqual([tiledText[4].color, tiledText[6].color], [[30, 41, 59, 245], [30, 41, 59, 245]], "assignment names stay dark and readable on the light Process surface");
  assert.deepEqual(tiledText.slice(0, 3).map((datum) => datum.size), [14, 14, 14]);
  assert.deepEqual([tiledText[3].size, tiledText[5].size], [13, 13]);
  assert.deepEqual([tiledText[4].size, tiledText[6].size], [11, 11]);
  assert.ok(tiledText[3].position[0] < tiledText[4].position[0], "R icon is left of its names");
  assert.ok(tiledText[5].position[0] < tiledText[6].position[0], "A icon is left of its names");
  assert.deepEqual(tiledText.slice(3).map((datum) => datum.textAnchor), ["start", "start", "start", "start"]);
  assert.ok(tiledText.every((datum) => datum.text !== process.resource_id), "presentation text never exposes resource IDs");
  const boundedText = renderCardText("bounded-card", {
    ...process,
    responsible_names: ["Extremely Long Person Name", "Second Person", "Third Person"],
    accountable_names: ["Accountable Name That Is Too Long"],
  });
  assert.ok(boundedText[4].text.length <= 13 && boundedText[4].text.endsWith("+2"));
  assert.ok(boundedText[6].text.length <= 13 && boundedText[6].text.includes("…"));

  const selectedLayers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 24,
    presentation,
    editedPlacementKeys: new Set([key]),
    editOverlay: {
      placements: [process], traces: [], selectedPlacementKey: key, selectedPlacementKeys: new Set([key]), selectedTraceID: null,
      connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null, hoveredPlacementKey: null, placementTransform: null,
    },
  }));
  assert.deepEqual(
    (layerByID(selectedLayers, "process-map-edit-process-card-text").props.data as Array<{ text: string }>).map((datum) => datum.text),
    tiledText.map((datum) => datum.text),
  );

  assert.deepEqual(renderCardText("normal-card", { ...process, presentation: "normal" }), []);
  assert.deepEqual(renderCardText("whole-card", process, 1), []);
  assert.deepEqual(renderCardText("folder-card", { ...process, resource_type: "company_explorer_folder" }), []);
  assert.deepEqual(renderCardText("restricted-card", { restricted: true, grid_x: 10, grid_y: 20 }), []);
});

test("hovering an accessible Process or Folder reveals anchors and all four resize grips", () => {
  const process = placement("process", 0, 0);
  const folder = placement("folder", 20, 0, 12, 8, "company_explorer_folder");
  const processKey = "logic_gate:process";
  const folderKey = "company_explorer_folder:folder";
  const presentation: ProcessMapPresentationState = {
    placements: new Map([[processKey, process], [folderKey, folder]]),
    traces: new Map(),
    removedPlacementKeys: new Set(),
  };
  const controlsFor = (hoveredPlacementKey: string) => {
    const layers = buildProcessMapLayers(buildOptions({
      settledPixelsPerGridUnit: 4,
      presentation,
      editOverlay: {
        placements: [], traces: [], selectedPlacementKey: null, selectedTraceID: null,
        connectionPreview: null, highlightedFolderKey: null, connectionSourceKey: null, hoveredPlacementKey, placementTransform: null,
      },
    }));
    return {
      anchors: layerByID(layers, "process-map-edit-anchors").props.data as Array<{
        pick: { anchor: "input" | "output"; key: string };
      }>,
      grips: layerByID(layers, "process-map-edit-resize-handles").props.data as Array<{
        pick: { horizontal: "west" | "east"; vertical: "north" | "south"; key: string };
      }>,
    };
  };

  const processControls = controlsFor(processKey);
  assert.deepEqual(
    processControls.anchors.map((item) => [item.pick.key, item.pick.anchor]),
    [[processKey, "input"], [processKey, "output"]],
  );
  assert.deepEqual(
    processControls.grips.map((item) => [item.pick.key, item.pick.horizontal, item.pick.vertical]),
    [
      [processKey, "west", "north"],
      [processKey, "east", "north"],
      [processKey, "east", "south"],
      [processKey, "west", "south"],
    ],
  );
  const folderControls = controlsFor(folderKey);
  assert.deepEqual(
    folderControls.anchors.map((item) => [item.pick.key, item.pick.anchor]),
    [[folderKey, "input"], [folderKey, "output"]],
  );
  assert.equal(folderControls.grips.length, 4);
  assert.ok(folderControls.grips.every((item) => item.pick.key === folderKey));
});

test("an active connection keeps only the source output and distinct eligible target inputs", () => {
  const source = placement("source", 0, 0);
  const target = placement("target", 20, 0, 12, 8, "company_explorer_folder");
  const secondTarget = placement("second-target", 40, 0);
  const sourceKey = "logic_gate:source";
  const targetKey = "company_explorer_folder:target";
  const secondTargetKey = "logic_gate:second-target";
  const presentation: ProcessMapPresentationState = {
    placements: new Map([[sourceKey, source], [targetKey, target], [secondTargetKey, secondTarget]]),
    traces: new Map(),
    removedPlacementKeys: new Set(),
  };
  const layers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 4,
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
      hoveredPlacementKey: null,
      placementTransform: null,
    },
  }));
  const anchors = layerByID(layers, "process-map-edit-anchors").props.data as Array<{
    radius: number;
    pick: { anchor: "input" | "output"; key: string };
  }>;
  assert.deepEqual(
    anchors.map((item) => [item.pick.key, item.pick.anchor]),
    [[sourceKey, "output"], [targetKey, "input"], [secondTargetKey, "input"]],
  );
  assert.ok(anchors.slice(1).every((anchor) => anchor.radius > anchors[0].radius), "eligible inputs receive the clearer target treatment");
  assert.deepEqual(layerByID(layers, "process-map-edit-resize-handles").props.data, [], "connection mode does not mix resize grips with anchors");
  const preview = layerByID(layers, "process-map-edit-traces");
  assertFlatXYPathLayer(preview);
  const previewData = preview.props.data as Array<{ path: [number, number][]; color: number[]; width: number }>;
  assert.equal(previewData.length, 1, "the pending preview remains one continuous path through every bend");
  assert.deepEqual(previewData[0].color, [38, 195, 234, 220], "the pending orthogonal preview uses the static cyan-blue trace color");
  assert.ok(previewData[0].path.slice(1).every((point, index) => point[0] === previewData[0].path[index][0] || point[1] === previewData[0].path[index][1]), "the pending preview contains only horizontal or vertical segments");
  const start = previewData[0].path[0];
  const firstEnd = previewData[0].path[1];
  assert.equal(firstEnd[1], start[1], "the preview exits horizontally before its first bend");
  assert.ok(firstEnd[0] > start[0], "the preview first moves out from the source's right edge");
  assert.ok(previewData.every((item) => item.width === 3), "preview width stays fixed in screen pixels");
  assert.equal(preview.props.widthUnits, "pixels");
  assert.equal(preview.props.widthMinPixels, 2);
  assert.equal(preview.props.widthMaxPixels, Number.MAX_SAFE_INTEGER, "the preview keeps deck.gl's unbounded pixel-width default");
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

  const completedProtectedGenerations: number[] = [];
  const tileLayer = layerByID(buildProcessMapLayers(buildOptions({
    onViewportLoad: (generation) => completedProtectedGenerations.push(generation),
  })), "process-map-spatial-tiles");
  const onViewportLoad = tileLayer.props.onViewportLoad as unknown as (tiles: Array<{ isLoaded: boolean; content?: ProcessMapTileResponse | null }>) => void;
  onViewportLoad([{ isLoaded: true, content: null }]);
  onViewportLoad([{ isLoaded: true, content: { ...currentTile, process_map_read_version: 10 } }]);
  assert.deepEqual(completedProtectedGenerations, []);
  onViewportLoad([{ isLoaded: true, content: currentTile }]);
  assert.deepEqual(completedProtectedGenerations, [0], "only complete current-version coverage in the current protected scope may retire masks");
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

test("Folder resize scales its complete subtree and internal trace preview together", () => {
  const root = placement("resize-root", 0, 0, 100, 80, "company_explorer_folder");
  const nested = { ...placement("resize-nested", 20, 16, 40, 32, "company_explorer_folder"), map_parent_folder_id: root.resource_id };
  const source = { ...placement("resize-source", 28, 24, 16, 8), map_parent_folder_id: nested.resource_id };
  const target = { ...placement("resize-target", 68, 48, 16, 8), map_parent_folder_id: root.resource_id };
  const outside = placement("resize-outside", 120, 20, 16, 8);
  const rootKey = `company_explorer_folder:${root.resource_id}`;
  const basePlacements = new Map<string, ProcessMapVisiblePlacement>([
    [rootKey, root],
    [`company_explorer_folder:${nested.resource_id}`, nested],
    [`logic_gate:${source.resource_id}`, source],
    [`logic_gate:${target.resource_id}`, target],
  ]);
  const internalTrace: ProcessMapTrace = {
    ...trace(source, target),
    resource_operational_relationship_id: "resize-internal",
    route_points: [{ x: 80, y: 8 }],
    path_fragments: [[{ x: 44, y: 28 }, { x: 80, y: 8 }, { x: 68, y: 52 }]],
  };
  const externalTrace: ProcessMapTrace = {
    ...trace(source, outside),
    resource_operational_relationship_id: "resize-external",
    target: { resource_type: outside.resource_type, resource_id: outside.resource_id },
  };
  const placementKeys = new Set(basePlacements.keys());
  const internalTraces = processMapInternalTracesForTransform(new Map([
    [internalTrace.resource_operational_relationship_id, internalTrace],
    [externalTrace.resource_operational_relationship_id, externalTrace],
  ]), placementKeys);
  assert.deepEqual([...internalTraces.keys()], [internalTrace.resource_operational_relationship_id], "only a trace whose two endpoints resize with the Folder is transformed");

  const transform: ProcessMapPlacementTransform = {
    kind: "resize",
    key: rootKey,
    placementKeys,
    traceIDs: new Set(internalTraces.keys()),
    basePlacements,
    deltaX: -50,
    deltaY: -40,
    horizontal: "east",
    vertical: "south",
  };
  const transformed = materializeProcessMapPlacementTransform(basePlacements, transform);
  assert.deepEqual(
    [...transformed.values()].map((item) => [item.resource_id, item.grid_x, item.grid_y, item.grid_width, item.grid_height]),
    [
      [root.resource_id, 0, 0, 50, 40],
      [nested.resource_id, 10, 8, 20, 16],
      [source.resource_id, 14, 12, 8, 4],
      [target.resource_id, 34, 24, 8, 4],
    ],
  );
  assert.deepEqual([root.grid_x, root.grid_y, root.grid_width, root.grid_height], [0, 0, 100, 80], "preview materialization never mutates stable placement geometry");

  const presentation: ProcessMapPresentationState = {
    placements: basePlacements,
    traces: internalTraces,
    removedPlacementKeys: new Set(),
  };
  const layers = buildProcessMapLayers(buildOptions({
    settledPixelsPerGridUnit: 24,
    presentation,
    editedPlacementKeys: placementKeys,
    editedTraceIDs: new Set(internalTraces.keys()),
    editOverlay: {
      placements: [...basePlacements.values()],
      traces: [...internalTraces.values()],
      selectedPlacementKey: rootKey,
      selectedPlacementKeys: new Set([rootKey]),
      selectedTraceID: null,
      connectionPreview: null,
      highlightedFolderKey: null,
      connectionSourceKey: null,
      hoveredPlacementKey: null,
      placementTransform: transform,
    },
  }));
  const folderSurfaces = layerByID(layers, "process-map-edit-folder-surfaces").props.data as Array<{ polygon: number[][] }>;
  assert.deepEqual(folderSurfaces.map((item) => item.polygon), [
    [[0, 0], [50, 0], [50, 40], [0, 40]],
    [[10, 8], [30, 8], [30, 24], [10, 24]],
  ], "root and nested Folder surfaces preview the same scale transform");
  const processBodies = layerByID(layers, "process-map-edit-placement-bodies").props.data as Array<{ polygon: number[][]; pick: { key: string } }>;
  assert.deepEqual(processBodies.map((item) => [item.pick.key, item.polygon]), [
    [`logic_gate:${source.resource_id}`, [[14, 12], [22, 12], [22, 16], [14, 16]]],
    [`logic_gate:${target.resource_id}`, [[34, 24], [42, 24], [42, 28], [34, 28]]],
  ]);
  const previewPaths = layerByID(layers, "process-map-edit-traces").props.data as Array<{ path: number[][] }>;
  assert.equal(previewPaths.length, 1);
  const previewPath = previewPaths[0].path;
  assert.deepEqual(previewPath[0], [22, 14], "the preview leaves the scaled source output");
  assert.deepEqual(previewPath.at(-1), [34, 26], "the preview enters the scaled target input");
  assert.ok(previewPath.some((point) => point[0] === 40 && point[1] === 4), "the saved internal route point scales with the Folder");
  assert.ok(previewPath.slice(1).every((point, index) => point[0] === previewPath[index][0] || point[1] === previewPath[index][1]), "the scaled preview remains orthogonal");
});

test("large deep Folder move planning indexes and traverses each stable member once", () => {
  class SingleValuesPassMap<K, V> extends Map<K, V> {
    valuesCalls = 0;
    valueVisits = 0;

    override values(): ReturnType<Map<K, V>["values"]> {
      this.valuesCalls += 1;
      assert.equal(this.valuesCalls, 1, "one operation must not rescan the complete placement or trace map");
      const values = super.values();
      const owner = this;
      return (function* countedValues() {
        for (const value of values) {
          owner.valueVisits += 1;
          yield value;
        }
      })() as ReturnType<Map<K, V>["values"]>;
    }
  }

  const root = placement("deep-root", -50, -40, 20_000, 20_000, "company_explorer_folder");
  const sourcePlacements: ProcessMapVisiblePlacement[] = [root];
  let parentID = root.resource_id;
  for (let depth = 1; depth <= 1_000; depth += 1) {
    const folder = {
      ...placement(`folder-${depth}`, depth * 2, depth * 2, 20_000 - depth * 4, 20_000 - depth * 4, "company_explorer_folder"),
      map_parent_folder_id: parentID,
    };
    const process = {
      ...placement(`process-${depth}`, depth * 2 + 2, depth * 2 + 2),
      map_parent_folder_id: folder.resource_id,
    };
    sourcePlacements.push(folder, process);
    parentID = folder.resource_id;
  }
  const reversedPlacements = new SingleValuesPassMap<string, ProcessMapVisiblePlacement>(
    [...sourcePlacements].reverse().map((item) => [`${item.resource_type}:${item.resource_id}`, item]),
  );
  const subtree = processMapPlacementSubtree(root, reversedPlacements);
  assert.equal(reversedPlacements.valuesCalls, 1);
  assert.equal(reversedPlacements.valueVisits, sourcePlacements.length);
  assert.equal(subtree.size, sourcePlacements.length);
  for (const item of sourcePlacements) {
    assert.equal(subtree.get(`${item.resource_type}:${item.resource_id}`), item, "move planning retains the canonical placement reference");
  }

  const sourceTraces: ProcessMapTrace[] = sourcePlacements.slice(1, 101).map((target, index) => ({
    ...trace(root, target),
    resource_operational_relationship_id: `deep-trace-${index}`,
    target: { resource_type: target.resource_type, resource_id: target.resource_id },
  }));
  const outside = placement("outside", 30_000, 30_000);
  sourceTraces.push({
    ...trace(root, outside),
    resource_operational_relationship_id: "external-trace",
    target: { resource_type: outside.resource_type, resource_id: outside.resource_id },
  });
  const countedTraces = new SingleValuesPassMap(sourceTraces.map((item) => [item.resource_operational_relationship_id, item]));
  const movedKeys = new Set(subtree.keys());
  const internalTraces = processMapInternalTracesForTransform(countedTraces, movedKeys);
  assert.equal(countedTraces.valuesCalls, 1);
  assert.equal(countedTraces.valueVisits, sourceTraces.length);
  assert.equal(internalTraces.size, sourceTraces.length - 1);
  for (const item of sourceTraces.slice(0, -1)) {
    assert.equal(internalTraces.get(item.resource_operational_relationship_id), item, "move planning retains the canonical trace reference");
  }

  const transformed = materializeProcessMapPlacementTransform(subtree, {
    kind: "move",
    key: `company_explorer_folder:${root.resource_id}`,
    placementKeys: movedKeys,
    traceIDs: new Set(internalTraces.keys()),
    basePlacements: subtree,
    deltaX: 17,
    deltaY: -9,
  });
  assert.equal(root.grid_x, -50, "planning and preview deltas never mutate the stable source placement");
  assert.equal(transformed.get(`company_explorer_folder:${root.resource_id}`)?.grid_x, -33);
  assert.equal(transformed.get("logic_gate:process-1000")?.grid_y, sourcePlacements.at(-1)!.grid_y - 9);
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
    const movingLayer = layerByID(buildProcessMapLayers(buildOptions({
      scene: largeScene,
      settled: false,
      getTileData: tileLoader,
    })), "process-map-spatial-tiles");
    const settledLayer = layerByID(buildProcessMapLayers(buildOptions({
      scene: largeScene,
      settled: true,
      settledPixelsPerGridUnit: 8,
      getTileData: tileLoader,
    })), "process-map-spatial-tiles");
    assert.equal(movingLayer.props.data, settledLayer.props.data, "camera settlement must not replace the tile-data identity");
    assert.equal(movingLayer.props.updateTriggers?.getTileData, undefined);
    assert.equal(settledLayer.props.updateTriggers?.getTileData, undefined);
    assert.equal(settledLayer.props.maxRequests, PROCESS_MAP_MAX_TILE_REQUESTS);
    assert.equal(settledLayer.props.maxCacheByteSize, PROCESS_MAP_TILE_CACHE_BYTES);
    const readTile = settledLayer.props.getTileData as unknown as (request: {
      id: string;
      index: { z: number; x: number; y: number };
      signal: AbortSignal;
    }) => Promise<ProcessMapTileResponse>;
    const responses = await Promise.all(Array.from({ length: finalViewportTileCount }, (_, x) => readTile({
      id: `viewport-${x}`,
      index: { z: 22, x, y: 0 },
      signal: new AbortController().signal,
    })));
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
    assert.equal(canceledRequests, 1, "a tile request with no remaining consumer aborts its underlying fetch");
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
    assert.equal(placementVisits, representative.placements.length * 2, "one child-top index and one rendering pass keep construction linear");
    assert.equal(traceVisits, representative.traces.length, "presentation construction visits each trace once");
    const labelData = layerByID(presentationLayers, "representative-large-tile-labels").props.data as Array<{ text: string }>;
    const pickableDatumCount = presentationLayers
      .filter((layer) => layer.props.pickable)
      .reduce((total, layer) => total + ((layer.props.data as unknown[])?.length ?? 0), 0);
    const visiblePlacementCount = representative.placements.filter((item) => !item.restricted).length;
    const visibleFolderCount = representative.placements.filter((item) => !item.restricted && item.resource_type === "company_explorer_folder").length;
    assert.equal(labelData.length, representative.placements.length - visibleFolderCount, "24px folders keep their boxes while their title bands are too short for text");
    assert.equal(
      pickableDatumCount,
      visiblePlacementCount * 5 - visibleFolderCount + representative.placements.length - visibleFolderCount + representative.traces.length,
      "visual Folder surfaces add no pick datum while names, permission-safe placeholders, fences, Process bodies, and continuous static trace paths remain bounded",
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
      viewport_requests: finalViewportTileCount,
      canceled_requests: canceledRequests,
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
