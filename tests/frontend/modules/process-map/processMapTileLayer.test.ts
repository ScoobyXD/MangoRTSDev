import assert from "node:assert/strict";
import test from "node:test";
import { ScatterplotLayer } from "../../../../frontend/node_modules/@deck.gl/layers/dist/index.js";
import { TileLayer, _Tile2DHeader as TileHeader } from "../../../../frontend/node_modules/@deck.gl/geo-layers/dist/index.js";
import type { Layer } from "../../../../frontend/node_modules/@deck.gl/core/dist/index.js";
import { ProcessMapProtectedTileLayer, type ProcessMapTileRenderState, type ProcessMapValidatedTile } from "../../../../frontend/src/modules/process-map/processMapTileLayer.js";
import type { ProcessMapTileResponse, ProcessMapVisiblePlacement } from "../../../../frontend/src/modules/process-map/processMapApi.js";

function renderState(overrides: Partial<ProcessMapTileRenderState> = {}): ProcessMapTileRenderState {
  return {
    settledPixelsPerGridUnit: 8,
    editedPlacementKeys: new Set(),
    editedTraceIDs: new Set(),
    selectedPlacementKey: null,
    selectedTraceID: null,
    ...overrides,
  };
}

function placement(id: string, resourceType: "logic_gate" | "company_explorer_folder" = "logic_gate"): ProcessMapVisiblePlacement {
  return {
    resource_type: resourceType, resource_id: id, restricted: false, presentation: "editing", name: id,
    grid_x: 0, grid_y: 0, grid_width: 10, grid_height: 10, map_parent_folder_id: null,
    can_edit: true, revision: 1, created_timestamp: "created", updated_timestamp: "updated",
  };
}

function cachedTile(id: string, placements: ProcessMapTileResponse["placements"], traceIDs: string[] = []) {
  const content: ProcessMapTileResponse = {
    z: 2, x: 0, y: 0, byteLength: 1, process_map_read_version: 1, placements,
    traces: traceIDs.map((traceID) => ({
      resource_operational_relationship_id: traceID, presentation: "editing",
      source: { resource_type: "logic_gate", resource_id: "source" },
      target: { resource_type: "logic_gate", resource_id: "target" },
      route_points: [], path_fragments: [], revision: 1, created_timestamp: "created", updated_timestamp: "updated",
    })),
  };
  return {
    id, content, isLoaded: true, needsReload: false,
    layers: [new ScatterplotLayer({ id: `${id}-cached`, data: [] })] as Layer[] | null,
    setNeedsReload() { this.needsReload = true; this.isLoaded = false; },
  };
}

type TestTile = Pick<TileHeader<ProcessMapTileResponse>, "id" | "content" | "isLoaded" | "layers" | "setNeedsReload">;

function harness(tiles: TestTile[]) {
  let reloads = 0;
  let finalizes = 0;
  let renders = 0;
  const initialTileset = {
    tiles,
    setOptions: () => undefined,
    reloadAll: () => { reloads += 1; },
    finalize: () => { finalizes += 1; },
  };
  const fake = {
    props: {} as Record<string, unknown>,
    context: { viewport: { zoom: 2 } },
    state: { tileset: initialTileset as typeof initialTileset | null, isLoaded: true, completedReadVersion: undefined as number | undefined },
    setState(next: Record<string, unknown>) { this.state = { ...this.state, ...next }; },
    _getTilesetOptions: () => ({}),
    _updateTileset: () => undefined,
    getSubLayerProps: (props: Record<string, unknown>) => props,
    getSubLayerPropsByTile: () => null,
    renderSubLayers: (props: { id: string }) => {
      renders += 1;
      return new ScatterplotLayer({ id: `${props.id}-rebuilt`, data: [] });
    },
  };
  return {
    tiles,
    counts: () => ({ reloads, finalizes, renders }),
    update(previous: ProcessMapTileRenderState, next: ProcessMapTileRenderState, dataChanged = false, protectedChanged = false, validatedTiles: ReadonlyMap<string, ProcessMapValidatedTile> | null = null, renderTriggerChanged = true) {
      const props = {
        protectedGeneration: protectedChanged ? 2 : 1,
        readVersion: validatedTiles?.values().next().value?.current.process_map_read_version ?? (dataChanged ? 2 : 1),
        renderState: next,
        validatedTiles,
        TilesetClass: class {
          tiles: TestTile[] = [];
        },
      };
      fake.props = props;
      ProcessMapProtectedTileLayer.prototype.updateState.call(fake as never, {
        oldProps: { protectedGeneration: 1, renderState: previous },
        props,
        changeFlags: { propsOrDataChanged: true, dataChanged, updateTriggersChanged: renderTriggerChanged ? { renderSubLayers: true } : false },
      } as never);
    },
    render() { TileLayer.prototype.renderLayers.call(fake as never); },
    currentTiles: () => fake.state.tileset?.tiles,
    isLoaded: () => fake.state.isLoaded,
    setCompletedReadVersion: (version: number) => { fake.state.completedReadVersion = version; },
    completedReadVersion: () => fake.state.completedReadVersion,
  };
}

test("selection changes rebuild only affected cached tiles without requesting tile data", () => {
  const a = cachedTile("a", [placement("a")]);
  const b = cachedTile("b", [placement("b", "company_explorer_folder")]);
  const unrelated = cachedTile("unrelated", [placement("c")]);
  const untouchedLayers = unrelated.layers;
  const originalB = b.layers;
  const run = harness([a, b, unrelated]);
  const initial = renderState();
  const selectedA = renderState({ selectedPlacementKey: "logic_gate:a" });
  run.update(initial, selectedA);
  assert.equal(a.layers, null);
  assert.equal(b.layers, originalB);
  assert.equal(unrelated.layers, untouchedLayers);
  run.render();
  assert.deepEqual(run.counts(), { reloads: 0, finalizes: 0, renders: 1 });

  const selectedB = renderState({ selectedPlacementKey: "company_explorer_folder:b" });
  run.update(selectedA, selectedB);
  assert.equal(a.layers, null, "deselecting A removes its old tile mask");
  assert.equal(b.layers, null, "selecting B applies its Folder mask");
  assert.equal(unrelated.layers, untouchedLayers);
  run.render();
  assert.deepEqual(run.counts(), { reloads: 0, finalizes: 0, renders: 3 });

  const restoredA = a.layers;
  run.update(selectedB, initial);
  assert.equal(a.layers, restoredA);
  assert.equal(b.layers, null);
  assert.equal(unrelated.layers, untouchedLayers);
});

test("mask changes rebuild every tile containing an edited placement or cross-tile trace", () => {
  const left = cachedTile("left", [placement("folder", "company_explorer_folder")], ["shared"]);
  const right = cachedTile("right", [placement("child")], ["shared"]);
  const unrelated = cachedTile("elsewhere", [placement("other")], ["other-trace"]);
  const untouchedLayers = unrelated.layers;
  const run = harness([left, right, unrelated]);
  const initial = renderState();
  const selectedTrace = renderState({ selectedTraceID: "shared" });
  run.update(initial, selectedTrace);
  assert.equal(left.layers, null);
  assert.equal(right.layers, null);
  assert.equal(unrelated.layers, untouchedLayers);
  run.render();
  const movingFolder = renderState({
    selectedTraceID: "shared",
    editedPlacementKeys: new Set(["company_explorer_folder:folder", "logic_gate:child"]),
  });
  run.update(selectedTrace, movingFolder);
  assert.equal(left.layers, null);
  assert.equal(right.layers, null);
  assert.equal(unrelated.layers, untouchedLayers);
  run.render();
  assert.deepEqual(run.counts(), { reloads: 0, finalizes: 0, renders: 4 });
});

test("equivalent effective masks and restricted placeholders retain existing layers", () => {
  const a = cachedTile("a", [placement("a")]);
  const hidden = cachedTile("hidden", [{ restricted: true, grid_x: 0, grid_y: 0 }]);
  const originalA = a.layers;
  const originalHidden = hidden.layers;
  const run = harness([a, hidden]);
  run.update(
    renderState({ editedPlacementKeys: new Set(["logic_gate:a"]), selectedPlacementKey: "logic_gate:a" }),
    renderState({ editedPlacementKeys: new Set(["logic_gate:a"]) }),
  );
  assert.equal(a.layers, originalA, "a continuing edit still masks the deselected object");
  assert.equal(hidden.layers, originalHidden);
  run.render();
  assert.equal(run.counts().renders, 0);
});

test("ordinary version reload applies new masks immediately while retaining unrelated old coverage", () => {
  const changed = cachedTile("changed", [placement("changed")]);
  const unrelated = cachedTile("unrelated", [placement("other")]);
  const originalUnrelated = unrelated.layers;
  const run = harness([changed, unrelated]);
  run.update(renderState(), renderState({ editedPlacementKeys: new Set(["logic_gate:changed"]) }), true);
  assert.equal(changed.layers, null);
  assert.equal(unrelated.layers, originalUnrelated);
  run.render();
  assert.deepEqual(run.counts(), { reloads: 1, finalizes: 0, renders: 1 });
});

test("settled LOD changes rebuild all cached layers while permission changes discard the old tileset", () => {
  const a = cachedTile("a", [placement("a")]);
  const b = cachedTile("b", [placement("b")]);
  const run = harness([a, b]);
  run.update(renderState(), renderState({ settledPixelsPerGridUnit: 24 }));
  assert.equal(a.layers, null);
  assert.equal(b.layers, null);
  run.render();
  assert.deepEqual(run.counts(), { reloads: 0, finalizes: 0, renders: 2 });
  run.update(renderState({ settledPixelsPerGridUnit: 24 }), renderState({ selectedPlacementKey: "logic_gate:a" }), true, true);
  assert.deepEqual(run.currentTiles(), [], "no old protected tile is restored into the replacement tileset");
  assert.equal(run.counts().finalizes, 1);
});

test("certified clean tiles promote their version while dirty tiles retain coverage for the existing scheduler", () => {
  const clean = cachedTile("clean", [placement("clean")]);
  const dirty = cachedTile("dirty", [placement("dirty")]);
  const originalCleanLayers = clean.layers;
  const originalDirtyLayers = dirty.layers;
  const promoted = { ...clean.content, process_map_read_version: 2 };
  const run = harness([clean, dirty]);
  run.update(renderState(), renderState(), true, false, new Map([
    [clean.id, { previous: clean.content, current: promoted }],
  ]), false);
  assert.equal(clean.content, promoted);
  assert.equal(clean.needsReload, false);
  assert.equal(dirty.needsReload, true);
  assert.equal(clean.layers, originalCleanLayers);
  assert.equal(dirty.layers, originalDirtyLayers, "old valid dirty coverage remains until its replacement arrives");
  assert.equal(run.isLoaded(), false);
  run.render();
  assert.deepEqual(run.counts(), { reloads: 0, finalizes: 0, renders: 0 });
});

test("certified tiles still rebuild changed masks and LOD without refetching their geometry", () => {
  const selected = cachedTile("selected", [placement("selected")]);
  const clean = cachedTile("clean", [placement("clean")]);
  const cleanLayers = clean.layers;
  const run = harness([selected, clean]);
  const certified = new Map([selected, clean].map((tile) => [tile.id, {
    previous: tile.content, current: { ...tile.content, process_map_read_version: 2 },
  }]));
  const selection = renderState({ selectedPlacementKey: "logic_gate:selected" });
  run.update(renderState(), selection, true, false, certified);
  assert.equal(selected.layers, null);
  assert.equal(clean.layers, cleanLayers);
  assert.equal(selected.needsReload, false);
  assert.equal(clean.needsReload, false);
  run.render();
  run.update(selection, { ...selection, settledPixelsPerGridUnit: 24 }, true, false, new Map([selected, clean].map((tile) => [tile.id, {
    previous: tile.content, current: { ...tile.content, process_map_read_version: 3 },
  }])));
  assert.equal(selected.layers, null);
  assert.equal(clean.layers, null);
  assert.equal(run.counts().reloads, 0);
});

test("validation cannot promote a mismatched payload, altered geometry, or a protected generation", () => {
  const mismatched = cachedTile("mismatched", [placement("mismatched")]);
  const altered = cachedTile("altered", [placement("altered")]);
  const run = harness([mismatched, altered]);
  run.update(renderState(), renderState(), true, false, new Map([
    [mismatched.id, { previous: { ...mismatched.content }, current: { ...mismatched.content, process_map_read_version: 2 } }],
    [altered.id, { previous: altered.content, current: { ...altered.content, placements: [...altered.content.placements], process_map_read_version: 2 } }],
  ]));
  assert.equal(mismatched.needsReload, true);
  assert.equal(altered.needsReload, true);
  assert.equal(mismatched.content.process_map_read_version, 1);
  assert.equal(altered.content.process_map_read_version, 1);
  const clean = cachedTile("protected", [placement("protected")]);
  const protectedRun = harness([clean]);
  protectedRun.setCompletedReadVersion(1);
  protectedRun.update(renderState(), renderState(), true, true, new Map([
    [clean.id, { previous: clean.content, current: { ...clean.content, process_map_read_version: 2 } }],
  ]));
  assert.equal(clean.content.process_map_read_version, 1);
  assert.equal(protectedRun.counts().finalizes, 1);
  assert.equal(protectedRun.completedReadVersion(), undefined);
  assert.deepEqual(protectedRun.currentTiles(), []);
});

test("selective reload aborts active stale tile work and rejects its later completion", async () => {
  const old = cachedTile("active", [placement("old")]);
  const header = new TileHeader<ProcessMapTileResponse>({ z: 2, x: 1, y: 0 });
  header.id = old.id;
  header.content = old.content;
  header.layers = old.layers;
  let observedSignal: AbortSignal | undefined;
  let oldLoads = 0;
  let completeOld!: (value: ProcessMapTileResponse) => void;
  const loading = header.loadData({
    requestScheduler: { scheduleRequest: async () => ({ done: () => undefined }) } as never,
    getData: ({ signal }) => new Promise<ProcessMapTileResponse>((resolve) => {
      observedSignal = signal;
      completeOld = resolve;
    }),
    onLoad: () => { oldLoads += 1; },
    onError: (error) => { throw error; },
  });
  await Promise.resolve();
  assert.equal(header.isLoading, true);
  const run = harness([header]);
  run.update(renderState(), renderState(), true, false, new Map([
    [header.id, { previous: old.content, current: { ...old.content, process_map_read_version: 2 } }],
  ]));
  assert.equal(observedSignal?.aborted, true, "a pending header is reloaded even if its earlier payload was certified clean");
  assert.equal(header.needsReload, true);
  assert.equal(header.layers, old.layers);
  const current = { ...old.content, process_map_read_version: 2, placements: [placement("current")] };
  const replacement = header.loadData({
    requestScheduler: { scheduleRequest: async () => ({ done: () => undefined }) } as never,
    getData: async () => current,
    onLoad: () => undefined,
    onError: (error) => { throw error; },
  });
  completeOld({ ...old.content, placements: [placement("stale")] });
  await loading;
  await replacement;
  assert.equal(header.content, current, "the existing scheduler's replacement rejects a late old completion");
  assert.equal(oldLoads, 0);
});

test("a new same-version validation response certifies retained headers without rebuilding clean layers", () => {
  const clean = cachedTile("clean", [placement("clean")]);
  const dirty = cachedTile("dirty", [placement("dirty")]);
  const originalCleanLayers = clean.layers;
  const originalDirtyLayers = dirty.layers;
  dirty.content = { ...dirty.content, process_map_read_version: 0 };
  const current = { ...clean.content };
  const run = harness([clean, dirty]);
  run.update(renderState(), renderState(), false, false, new Map([
    [clean.id, { previous: clean.content, current }],
  ]), false);
  assert.equal(clean.content.process_map_read_version, current.process_map_read_version);
  assert.equal(clean.layers, originalCleanLayers);
  assert.equal(dirty.layers, originalDirtyLayers);
  assert.equal(dirty.needsReload, true);
  run.render();
  assert.deepEqual(run.counts(), { reloads: 0, finalizes: 0, renders: 0 });
});

test("a repeated validation does not reload current or newer tiles that arrived after its request", () => {
  const current = cachedTile("current", [placement("current")]);
  const newer = cachedTile("newer", [placement("newer")]);
  const old = cachedTile("old", [placement("old")]);
  current.content = { ...current.content, process_map_read_version: 2 };
  newer.content = { ...newer.content, process_map_read_version: 3 };
  const currentLayers = current.layers;
  const newerLayers = newer.layers;
  const run = harness([current, newer, old]);
  run.update(renderState(), renderState(), true, false, new Map());
  assert.equal(current.needsReload, false);
  assert.equal(newer.needsReload, false);
  assert.equal(old.needsReload, true);
  assert.equal(current.layers, currentLayers);
  assert.equal(newer.layers, newerLayers);
  assert.equal(newer.content.process_map_read_version, 3);
  run.render();
  assert.deepEqual(run.counts(), { reloads: 0, finalizes: 0, renders: 0 });
});

test("an entirely certified viewport reports its new coverage through deck.gl's existing completion hook", () => {
  const clean = cachedTile("clean", [placement("clean")]);
  let completions = 0;
  const tileset = {
    tiles: [clean],
    isLoaded: true,
    update: () => 7,
    setOptions: () => undefined,
  };
  const previous = renderState();
  const next = renderState();
  const props = {
    protectedGeneration: 1, renderState: next,
    validatedTiles: new Map([[clean.id, { previous: clean.content, current: { ...clean.content, process_map_read_version: 2 } }]]),
  };
  const fake = {
    props,
    context: { viewport: {} },
    state: { tileset, isLoaded: true, frameNumber: 7 },
    setState(nextState: Record<string, unknown>) { this.state = { ...this.state, ...nextState }; },
    _getTilesetOptions: () => ({}),
    _updateTileset: (TileLayer.prototype as unknown as { _updateTileset: () => void })._updateTileset,
    _onViewportLoad: () => { completions += 1; },
  };
  ProcessMapProtectedTileLayer.prototype.updateState.call(fake as never, {
    oldProps: { protectedGeneration: 1, renderState: previous },
    props,
    changeFlags: { propsOrDataChanged: true, dataChanged: true, updateTriggersChanged: false },
  } as never);
  assert.equal(completions, 1);
  assert.equal(clean.content.process_map_read_version, 2);
  assert.equal(fake.state.isLoaded, true);
});

test("completed current coverage prevents deleted or moved objects reappearing from offscreen dirty tiles", () => {
  const deleted = cachedTile("deleted", [placement("deleted")]);
  const moved = cachedTile("moved", [placement("old-position")]);
  const current = cachedTile("current", [placement("new-position")]);
  current.content = { ...current.content, process_map_read_version: 2 };
  let completions = 0;
  const fake = {
    props: { readVersion: 2, onViewportLoad: () => { completions += 1; } },
    state: {
      completedReadVersion: 1,
      tileset: { selectedTiles: [deleted], isTileVisible: () => true },
    },
    setState(next: Record<string, unknown>) { this.state = { ...this.state, ...next }; },
  };
  const visible = (tile: ReturnType<typeof cachedTile>) => ProcessMapProtectedTileLayer.prototype.filterSubLayer.call(fake as never, {
    layer: { props: { tile } },
  } as never);
  assert.equal(visible(deleted), true, "prior visible coverage remains during an ordinary replacement");
  ProcessMapProtectedTileLayer.prototype._onViewportLoad.call(fake as never);
  assert.equal(fake.state.completedReadVersion, 1, "old coverage cannot complete the newer version");

  fake.state.tileset.selectedTiles = [current];
  current.isLoaded = false;
  ProcessMapProtectedTileLayer.prototype._onViewportLoad.call(fake as never);
  assert.equal(fake.state.completedReadVersion, 1, "current-version content still loading cannot complete coverage");
  current.isLoaded = true;
  ProcessMapProtectedTileLayer.prototype._onViewportLoad.call(fake as never);
  assert.equal(fake.state.completedReadVersion, 2);
  assert.equal(completions, 3, "the normal viewport callback remains in control of application masks");
  fake.state.tileset.selectedTiles = [deleted, moved];
  assert.equal(visible(deleted), false, "panning back cannot show a previously deleted object's old tile");
  assert.equal(visible(moved), false, "panning back cannot show a moved object's old position");
  deleted.content = { ...deleted.content, process_map_read_version: 2, placements: [] };
  moved.content = { ...moved.content, process_map_read_version: 2, placements: [] };
  assert.equal(visible(deleted), true);
  assert.equal(visible(moved), true);

  fake.props.readVersion = 3;
  assert.equal(visible(current), true, "the next ordinary replacement still retains the last completed coverage");
});
