import assert from "node:assert/strict";
import test from "node:test";
import { ScatterplotLayer } from "../../../../frontend/node_modules/@deck.gl/layers/dist/index.js";
import { TileLayer, _Tile2DHeader as TileHeader } from "../../../../frontend/node_modules/@deck.gl/geo-layers/dist/index.js";
import { OrthographicViewport, type Layer } from "../../../../frontend/node_modules/@deck.gl/core/dist/index.js";
import { ProcessMapProtectedTileLayer, ProcessMapTileset, type ProcessMapTileRenderState, type ProcessMapValidatedTile } from "../../../../frontend/src/modules/process-map/processMapTileLayer.js";
import { transparentVectorRefinementStrategy } from "../../../../frontend/src/modules/process-map/processMapInteraction.js";
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
    can_edit: true, revision: 1,
  };
}

function cachedTile(id: string, placements: ProcessMapTileResponse["placements"], traceIDs: string[] = []) {
  const content: ProcessMapTileResponse = {
    z: 2, x: 0, y: 0, byteLength: 1, process_map_read_version: 1, placements,
    traces: traceIDs.map((traceID) => ({
      resource_operational_relationship_id: traceID, presentation: "editing",
      source: { resource_type: "logic_gate", resource_id: "source" },
      target: { resource_type: "logic_gate", resource_id: "target" },
      route_points: [], path_fragments: [], revision: 1,
    })),
  };
  return {
    id, content, isLoaded: true, isVisible: true, needsReload: false,
    layers: [new ScatterplotLayer({ id: `${id}-cached`, data: [] })] as Layer[] | null,
    setNeedsReload() { this.needsReload = true; this.isLoaded = false; },
  };
}

type TestTile = Pick<TileHeader<ProcessMapTileResponse>, "id" | "content" | "isLoaded" | "layers" | "setNeedsReload" | "isVisible">;

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
    render() { return ProcessMapProtectedTileLayer.prototype.renderLayers.call(fake as never); },
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

test("offscreen layers are released and rebuild current LOD and masks only when visible again", () => {
  const visible = cachedTile("visible", [placement("visible")]);
  const offscreen = cachedTile("offscreen", [placement("offscreen")]);
  offscreen.isVisible = false;
  const run = harness([visible, offscreen]);
  const before = renderState();
  const after = renderState({ settledPixelsPerGridUnit: 24, selectedPlacementKey: "logic_gate:offscreen" });
  run.update(before, after);
  run.render();
  assert.equal(run.counts().renders, 1);
  assert.equal(offscreen.layers, null, "settling zoom does not construct offscreen geometry");
  assert.ok(offscreen.content, "payload coverage remains in the existing cache");
  offscreen.isVisible = true;
  run.render();
  assert.equal(run.counts().renders, 2);
  const currentLayers = offscreen.layers;
  run.render();
  assert.equal(offscreen.layers, currentLayers, "unchanged visible geometry stays reusable");
  assert.equal(run.counts().renders, 2);
  visible.isVisible = false;
  run.render();
  assert.equal(visible.layers, null, "departed layers leave deck's live layer list");
});

function viewport(x = 0, width = 128, height = 128) {
  return new OrthographicViewport({ width, height, target: [x * 256 + 128, 128, 0], zoom: 0, flipY: true });
}

function assertCacheBytes(tileset: ProcessMapTileset, bytes: number): void {
  assert.equal(Reflect.get(tileset, "_cacheByteSize"), bytes);
  assert.equal(tileset.tiles.reduce((total, tile) => total + tile.byteLength, 0), bytes);
}

async function loadViewport(tileset: ProcessMapTileset, view = viewport()) {
  tileset.update(view);
  await Promise.all(tileset.selectedTiles!.map((tile) => tile.data));
  tileset.update(view);
}

test("real pinned tileset accounts successful, empty and failed replacements exactly", async () => {
  let bytes: number | null = 128;
  let fail = false;
  let errors = 0;
  const tileset = new ProcessMapTileset({
    tileSize: 256, minZoom: 0, maxZoom: 0, maxCacheSize: 4, maxCacheByteSize: 512, maxRequests: 0,
    getTileData: async () => {
      if (fail) throw new Error("fixture load failure");
      return bytes === null ? null : { byteLength: bytes };
    },
    onTileError: () => { errors += 1; },
  });
  try {
    await loadViewport(tileset);
    assertCacheBytes(tileset, 128);
    for (const replacement of [128, 256, 64, null, 128]) {
      bytes = replacement;
      tileset.selectedTiles![0].setNeedsReload();
      await loadViewport(tileset);
      assertCacheBytes(tileset, replacement ?? 0);
    }
    fail = true;
    tileset.selectedTiles![0].setNeedsReload();
    await loadViewport(tileset);
    assert.equal(errors, 1);
    assertCacheBytes(tileset, 0);
    fail = false;
    tileset.selectedTiles![0].setNeedsReload();
    await loadViewport(tileset);
    assertCacheBytes(tileset, 128);
  } finally {
    tileset.finalize();
  }
  assertCacheBytes(tileset, 0);
});

test("ordinary reload retains accounted neighboring coverage until normal bounded eviction", async () => {
  let bytes = 128;
  let unloaded = 0;
  const tileset = new ProcessMapTileset({
    tileSize: 256, minZoom: 0, maxZoom: 0, maxCacheSize: 2, maxCacheByteSize: 512, maxRequests: 0,
    getTileData: async () => ({ byteLength: bytes }),
    onTileUnload: () => { unloaded += 1; },
  });
  try {
    await loadViewport(tileset);
    await loadViewport(tileset, viewport(1));
    const neighbor = tileset.tiles.find((tile) => tile.index.x === 0)!;
    tileset.reloadAll();
    assert.equal(tileset.tiles.length, 2);
    assert.equal(neighbor.needsReload, true);
    assertCacheBytes(tileset, 256);
    bytes = 64;
    await loadViewport(tileset, viewport(1));
    assertCacheBytes(tileset, 192);
    for (let x = 2; x < 12; x += 1) {
      await loadViewport(tileset, viewport(x));
      assert.equal(tileset.tiles.length, 2, "tiny responses cannot bypass the resident tile count");
      assertCacheBytes(tileset, 128);
    }
    assert.equal(unloaded, 10);
  } finally {
    tileset.finalize();
  }
});

test("evicted and finalized requests cannot revive coverage or add phantom bytes", async () => {
  let pending: ((value: { byteLength: number }) => void) | null = null;
  const loaded: number[] = [];
  const tileset = new ProcessMapTileset({
    tileSize: 256, minZoom: 0, maxZoom: 0, maxCacheSize: 1, maxCacheByteSize: 512, maxRequests: 0,
    getTileData: async ({ index }) => index.x === 0
      ? new Promise<{ byteLength: number }>((resolve) => { pending = resolve; })
      : { byteLength: 64 },
    onTileLoad: (tile) => { loaded.push(tile.index.x); },
  });
  tileset.update(viewport());
  const firstLoad = tileset.selectedTiles![0].data;
  await Promise.resolve();
  await loadViewport(tileset, viewport(1));
  assert.ok(pending);
  pending!({ byteLength: 128 });
  await firstLoad;
  assert.deepEqual(loaded, [1]);
  assertCacheBytes(tileset, 64);

  tileset.update(viewport());
  const lastLoad = tileset.selectedTiles![0].data;
  await Promise.resolve();
  tileset.finalize();
  pending!({ byteLength: 128 });
  await lastLoad;
  assert.deepEqual(loaded, [1]);
  assertCacheBytes(tileset, 0);
});

test("a silently cancelled replacement is accounted before new coverage can trigger eviction", async () => {
  let replacing = false;
  let unloaded = 0;
  const tileset = new ProcessMapTileset({
    tileSize: 256, minZoom: 0, maxZoom: 0, maxCacheSize: 2, maxCacheByteSize: 128, maxRequests: 0,
    getTileData: async ({ index, signal }) => {
      if (replacing && index.x === 0) {
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true }));
      }
      return { byteLength: 128 };
    },
    onTileUnload: () => { unloaded += 1; },
  });
  try {
    await loadViewport(tileset);
    replacing = true;
    const old = tileset.selectedTiles![0];
    old.setNeedsReload();
    tileset.update(viewport());
    const cancelled = old.data;
    await Promise.resolve();
    old.abort();
    await cancelled;
    assert.equal(old.content, null, "deck cancellation clears content without a load/error callback");
    await loadViewport(tileset, viewport(1));
    assertCacheBytes(tileset, 128);
    assert.equal(tileset.tiles.length, 2);
    assert.equal(unloaded, 0, "cancelled bytes cannot force an otherwise unnecessary eviction");
  } finally {
    tileset.finalize();
  }
});

test("new viewport requests start nearest its center using the existing scheduler", async () => {
  const starts: { x: number; y: number }[] = [];
  const tileset = new ProcessMapTileset({
    tileSize: 256, minZoom: 0, maxZoom: 0, maxCacheSize: 64, maxCacheByteSize: 1024, maxRequests: 1, debounceTime: 0,
    getTileData: async ({ index }) => { starts.push(index); return { byteLength: 1 }; },
  });
  try {
    const view = new OrthographicViewport({ width: 1024, height: 1024, target: [640, 640, 0], zoom: 0, flipY: true });
    await loadViewport(tileset, view);
    assert.equal(starts.length, 25);
    assert.deepEqual({ x: starts[0].x, y: starts[0].y }, { x: 2, y: 2 });
    const distances = starts.map(({ x, y }) => (x - 2) ** 2 + (y - 2) ** 2);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
  } finally {
    tileset.finalize();
  }
});

test("real tileset parent links preserve transparent coverage until finer tiles arrive", async () => {
  let finishFine!: (value: { byteLength: number }) => void;
  const tileset = new ProcessMapTileset({
    tileSize: 256, minZoom: 0, maxZoom: 1, maxCacheSize: 16, maxCacheByteSize: 1024, maxRequests: 0,
    refinementStrategy: transparentVectorRefinementStrategy,
    getTileData: async ({ index }) => index.z === 1 && index.x === 1 && index.y === 1
      ? new Promise<{ byteLength: number }>((resolve) => { finishFine = resolve; })
      : { byteLength: 1 },
  });
  try {
    await loadViewport(tileset);
    const coarse = tileset.selectedTiles![0];
    const fine = new OrthographicViewport({ width: 256, height: 256, target: [128, 128, 0], zoom: 1, flipY: true });
    tileset.update(fine);
    await Promise.all(tileset.selectedTiles!.filter((tile) => tile.index.x !== 1 || tile.index.y !== 1).map((tile) => tile.data));
    tileset.update(fine);
    assert.equal(coarse.isVisible, true);
    assert.equal(tileset.selectedTiles!.some((tile) => tile.isVisible), false);
    assert.equal(tileset.selectedTiles!.every((tile) => tile.parent === coarse), true);
    finishFine({ byteLength: 1 });
    await loadViewport(tileset, fine);
    assert.equal(coarse.isVisible, false);
    assert.equal(tileset.selectedTiles!.every((tile) => tile.isVisible), true);
  } finally {
    tileset.finalize();
  }
});
