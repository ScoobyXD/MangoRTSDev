import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProcessMapCacheValidation,
  fetchProcessMapChanges,
  fetchProcessMapTile,
  invalidateProcessMapReadCaches,
  PROCESS_MAP_MAX_VALIDATION_TILES,
  type ProcessMapChangesResponse,
  type ProcessMapTileVersion,
} from "../../../../frontend/src/modules/process-map/processMapApi.js";

function changes(
  version = 11,
  validated: ProcessMapTileVersion[] = [],
  protectedGeometryChanged = false,
): ProcessMapChangesResponse {
  return {
    bounds: { min_x: 0, min_y: 0, max_x: 1_024, max_y: 1_024 },
    process_map_read_version: version,
    tile_size: 256,
    min_tile_zoom: 0,
    max_tile_zoom: 22,
    validated_tiles: validated,
    protected_geometry_changed: protectedGeometryChanged,
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

const clean: ProcessMapTileVersion = { z: 2, x: 1, y: 0, process_map_read_version: 10 };
const dirty: ProcessMapTileVersion = { z: 2, x: 2, y: 0, process_map_read_version: 10 };

function tile(version: number, reference: ProcessMapTileVersion) {
  return {
    ...reference,
    process_map_read_version: version,
    placements: [{
      restricted: false,
      presentation: "normal",
      resource_type: "logic_gate",
      resource_id: `process-${reference.x}`,
      name: `tile-${reference.x}-version-${version}`,
      map_parent_folder_id: null,
      grid_x: reference.x * 20,
      grid_y: 0,
      grid_width: 14,
      grid_height: 8,
      can_edit: true,
      revision: version,
      created_timestamp: "created",
      updated_timestamp: "updated",
    }],
    traces: [],
  };
}

test("changes POST submits only exact tile references and at most 512 candidates", async () => {
  const originalFetch = globalThis.fetch;
  const candidates = Array.from({ length: 513 }, (_, index) => ({
    z: 2, x: index, y: -1, process_map_read_version: 10, extra: "must-not-be-submitted",
  }));
  let requestCount = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestCount += 1;
    assert.equal(String(input), "https://process-map-changes-post.test/v1/process-map/changes");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      company_id: "company-1",
      since_version: 10,
      tiles: candidates.slice(0, 512).map(({ z, x, y, process_map_read_version }) => ({ z, x, y, process_map_read_version })),
    });
    return json(changes(11, [candidates[0], candidates[511]]));
  }) as typeof fetch;
  try {
    assert.equal(PROCESS_MAP_MAX_VALIDATION_TILES, 512);
    const result = await fetchProcessMapChanges("https://process-map-changes-post.test", " company-1 ", 10, candidates);
    assert.deepEqual(result.validated_tiles, [0, 511].map((x) => ({ z: 2, x, y: -1, process_map_read_version: 10 })));
    assert.equal(result.process_map_read_version, 11);
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("changes reject unsubmitted coordinates, wrong source versions, duplicate certificates, and protected certificates", async () => {
  const originalFetch = globalThis.fetch;
  const cases: Array<[unknown, RegExp]> = [
    [changes(11, [{ ...clean, x: 7 }]), /invalid_process_map_validated_tile/],
    [changes(11, [{ ...clean, process_map_read_version: 9 }]), /invalid_process_map_validated_tile/],
    [changes(11, [clean, clean]), /invalid_process_map_validated_tile/],
    [changes(11, [clean], true), /invalid_process_map_protected_validation/],
    [changes(9, []), /stale_process_map_changes/],
    [changes(11, [{ ...clean, x: 1.5 }]), /invalid_process_map_tile_x/],
  ];
  try {
    for (const [response, error] of cases) {
      globalThis.fetch = (async () => json(response)) as typeof fetch;
      await assert.rejects(fetchProcessMapChanges("https://process-map-changes-invalid.test", "company-1", 10, [clean]), error);
    }
    const candidates = Array.from({ length: 513 }, (_, x) => ({ ...clean, x }));
    globalThis.fetch = (async () => json(changes(11, [candidates[512]]))) as typeof fetch;
    await assert.rejects(fetchProcessMapChanges("https://process-map-changes-invalid.test", "company-1", 10, candidates), /invalid_process_map_validated_tile/);
    const future = { ...clean, process_map_read_version: 12 };
    globalThis.fetch = (async () => json(changes(11, [future]))) as typeof fetch;
    await assert.rejects(fetchProcessMapChanges("https://process-map-changes-invalid.test", "company-1", 10, [future]), /invalid_process_map_validated_tile/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("canceling a changes read aborts its request", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  let requestSignal: AbortSignal | null | undefined;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    requestSignal = init?.signal;
    assert.ok(requestSignal);
    requestSignal.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
    started();
  })) as typeof fetch;
  try {
    const pending = fetchProcessMapChanges("https://process-map-changes-abort.test", "company-1", 10, [clean], controller.signal);
    await requestStarted;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(requestSignal?.aborted, true);
  } finally {
    controller.abort();
    globalThis.fetch = originalFetch;
  }
});

test("validated old tiles are reused at the new version while dirty tiles are fetched again", async () => {
  const apiBase = "https://process-map-changes-cache.test";
  const companyID = "company-1";
  const originalFetch = globalThis.fetch;
  let serverVersion = 10;
  let tileReads = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/changes")) return json(changes(11, [clean]));
    tileReads += 1;
    return json(tile(serverVersion, url.includes("/2/1/0?") ? clean : dirty));
  }) as typeof fetch;
  const read = (reference: ProcessMapTileVersion, version: number) => fetchProcessMapTile(apiBase, companyID, version, reference.z, reference.x, reference.y, undefined, "2026-09-04");
  try {
    await read(clean, 10);
    await read(dirty, 10);
    assert.equal(tileReads, 2);
    const validation = await fetchProcessMapChanges(apiBase, companyID, 10, [clean, dirty]);
    applyProcessMapCacheValidation(apiBase, companyID, validation);
    serverVersion = 11;
    const retained = await read(clean, 11);
    assert.equal(retained.process_map_read_version, 11);
    assert.equal(retained.placements[0].restricted ? null : retained.placements[0].name, "tile-1-version-10");
    assert.equal(tileReads, 2, "a certified unchanged tile must not make another tile request");
    const refreshed = await read(dirty, 11);
    assert.equal(refreshed.placements[0].restricted ? null : refreshed.placements[0].name, "tile-2-version-11");
    assert.equal(tileReads, 3, "the uncertified tile must request current data");
    serverVersion = 12;
    await read(clean, 12);
    assert.equal(tileReads, 4);
    applyProcessMapCacheValidation(apiBase, companyID, validation);
    const newer = await read(clean, 12);
    assert.equal(newer.placements[0].restricted ? null : newer.placements[0].name, "tile-1-version-12");
    assert.equal(tileReads, 4, "an older validation completion cannot discard a newer cache entry");
  } finally {
    invalidateProcessMapReadCaches(apiBase, companyID);
    globalThis.fetch = originalFetch;
  }
});

test("repeated validation preserves promoted tiles and tiles already loaded at its current version", async () => {
  const apiBase = "https://process-map-changes-repeat.test";
  const companyID = "company-1";
  const originalFetch = globalThis.fetch;
  let tileReads = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    tileReads += 1;
    const reference = String(input).includes("/2/1/0?") ? clean : dirty;
    return json(tile(reference === clean ? 10 : 11, reference));
  }) as typeof fetch;
  const read = (reference: ProcessMapTileVersion, version: number) => fetchProcessMapTile(apiBase, companyID, version, reference.z, reference.x, reference.y);
  try {
    await read(clean, 10);
    await read(dirty, 11);
    const validation = changes(11, [clean]);
    applyProcessMapCacheValidation(apiBase, companyID, validation);
    applyProcessMapCacheValidation(apiBase, companyID, validation);
    const promoted = await read(clean, 11);
    const alreadyCurrent = await read(dirty, 11);
    assert.equal(promoted.process_map_read_version, 11);
    assert.equal(promoted.placements[0].restricted ? null : promoted.placements[0].name, "tile-1-version-10");
    assert.equal(alreadyCurrent.placements[0].restricted ? null : alreadyCurrent.placements[0].name, "tile-2-version-11");
    assert.equal(tileReads, 2, "repeated or same-version validation must not refetch current tile payloads");
  } finally {
    invalidateProcessMapReadCaches(apiBase, companyID);
    globalThis.fetch = originalFetch;
  }
});

test("protected validation clears cached geometry and cancels older tile reads", async () => {
  const apiBase = "https://process-map-changes-protected.test";
  const companyID = "company-1";
  const originalFetch = globalThis.fetch;
  let tileReads = 0;
  let started!: () => void;
  const pendingStarted = new Promise<void>((resolve) => { started = resolve; });
  let pendingSignal: AbortSignal | null | undefined;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    tileReads += 1;
    if (String(input).includes("/2/2/0?")) {
      return new Promise<Response>((_resolve, reject) => {
        pendingSignal = init?.signal;
        assert.ok(pendingSignal);
        pendingSignal.addEventListener("abort", () => reject(pendingSignal?.reason), { once: true });
        started();
      });
    }
    return Promise.resolve(json(tile(tileReads === 1 ? 10 : 11, clean)));
  }) as typeof fetch;
  try {
    await fetchProcessMapTile(apiBase, companyID, 10, clean.z, clean.x, clean.y);
    const pending = fetchProcessMapTile(apiBase, companyID, 10, dirty.z, dirty.x, dirty.y);
    await pendingStarted;
    applyProcessMapCacheValidation(apiBase, companyID, changes(11, [], true));
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(pendingSignal?.aborted, true);
    const reloaded = await fetchProcessMapTile(apiBase, companyID, 11, clean.z, clean.x, clean.y);
    assert.equal(reloaded.process_map_read_version, 11);
    assert.equal(tileReads, 3, "protected geometry is fetched anew after disposal");
  } finally {
    invalidateProcessMapReadCaches(apiBase, companyID);
    globalThis.fetch = originalFetch;
  }
});
