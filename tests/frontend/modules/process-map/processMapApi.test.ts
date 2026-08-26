import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchProcessMapScene,
  fetchProcessMapTile,
  getProcessMapReadCacheStats,
  invalidateProcessMapReadCaches,
  postProcessMapRelationship,
  putProcessMapPlacement,
} from "../../../../frontend/src/modules/process-map/processMapApi.js";
import { PROCESS_MAP_TILE_CACHE_BYTES } from "../../../../frontend/src/modules/process-map/processMapGeometry.js";

function scenePayload(readVersion = 11) {
  return {
    bounds: { min_x: -20, min_y: -10, max_x: 80, max_y: 50 },
    process_map_read_version: readVersion,
    tile_size: 256,
    min_tile_zoom: -8,
    max_tile_zoom: 20,
  };
}

function tilePayload(readVersion = 11, z = 2, x = 3, y = -1) {
  return {
    z,
    x,
    y,
    process_map_read_version: readVersion,
    placements: [
      {
        restricted: false,
        presentation: "editing",
        resource_type: "logic_gate",
        resource_id: "gate-1",
        name: "Receive",
        map_parent_folder_id: null,
        grid_x: 4,
        grid_y: 8,
        grid_width: 9,
        grid_height: 6,
        can_edit: true,
        revision: 3,
        created_timestamp: "created",
        updated_timestamp: "updated",
      },
      {
        restricted: true,
        grid_x: 14,
        grid_y: 8,
        resource_id: "must-not-survive",
        resource_type: "company_explorer_folder",
        name: "must-not-survive",
        grid_width: 99,
        grid_height: 99,
        can_edit: true,
        revision: 400,
      },
    ],
    traces: [],
  };
}

test("tile presentation normalizes omitted whole names and coarse trace routes", async () => {
  const apiBase = "https://process-map-presentation-normalization.test";
  invalidateProcessMapReadCaches(apiBase, "company-1");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    z: 4,
    x: 2,
    y: 1,
    process_map_read_version: 14,
    placements: [{
      restricted: false,
      presentation: "whole",
      resource_type: "logic_gate",
      resource_id: "whole-gate",
      map_parent_folder_id: null,
      grid_x: 10,
      grid_y: 12,
      grid_width: 6,
      grid_height: 5,
      can_edit: true,
      revision: 2,
      created_timestamp: "created",
      updated_timestamp: "updated",
    }],
    traces: [{
      presentation: "normal",
      resource_operational_relationship_id: "coarse-trace",
      source: { resource_type: "logic_gate", resource_id: "source" },
      target: { resource_type: "logic_gate", resource_id: "target" },
      path_fragments: [[{ x: 16, y: 14.5 }, { x: 40, y: 14.5 }]],
      revision: 3,
      created_timestamp: "created",
      updated_timestamp: "updated",
    }],
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const tile = await fetchProcessMapTile(apiBase, "company-1", 14, 4, 2, 1);
    const visible = tile.placements[0];
    assert.equal(visible.restricted, false);
    assert.equal(visible.restricted ? undefined : visible.presentation, "whole");
    assert.equal(visible.restricted ? undefined : visible.name, "");
    assert.equal(tile.traces[0].presentation, "normal");
    assert.deepEqual(tile.traces[0].route_points, []);
  } finally {
    invalidateProcessMapReadCaches(apiBase, "company-1");
    globalThis.fetch = originalFetch;
  }
});

test("tile parser rejects missing or invalid presentation ceilings", async () => {
  const originalFetch = globalThis.fetch;
  const visiblePlacement = {
    restricted: false,
    presentation: "editing" as unknown,
    resource_type: "logic_gate",
    resource_id: "gate-1",
    name: "Gate",
    map_parent_folder_id: null,
    grid_x: 1,
    grid_y: 2,
    grid_width: 7,
    grid_height: 5,
    can_edit: true,
    revision: 1,
    created_timestamp: "created",
    updated_timestamp: "updated",
  };
  const visibleTrace = {
    presentation: "editing" as unknown,
    resource_operational_relationship_id: "trace-1",
    source: { resource_type: "logic_gate", resource_id: "source" },
    target: { resource_type: "logic_gate", resource_id: "target" },
    route_points: [],
    path_fragments: [[{ x: 8, y: 4 }, { x: 20, y: 4 }]],
    revision: 1,
    created_timestamp: "created",
    updated_timestamp: "updated",
  };
  const cases = [
    { label: "placement missing", target: "placement", value: undefined },
    { label: "placement invalid", target: "placement", value: "summary" },
    { label: "trace missing", target: "trace", value: undefined },
    { label: "trace invalid", target: "trace", value: "summary" },
  ] as const;
  try {
    for (const [index, testCase] of cases.entries()) {
      const apiBase = `https://process-map-invalid-presentation-${index}.test`;
      const placement = { ...visiblePlacement, presentation: testCase.target === "placement" ? testCase.value : "editing" };
      const trace = { ...visibleTrace, presentation: testCase.target === "trace" ? testCase.value : "editing" };
      globalThis.fetch = (async () => new Response(JSON.stringify({
        z: 3,
        x: index,
        y: 0,
        process_map_read_version: 15,
        placements: [placement],
        traces: [trace],
      }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
      await assert.rejects(
        fetchProcessMapTile(apiBase, "company-1", 15, 3, index, 0),
        /invalid_process_map_presentation/,
        testCase.label,
      );
      invalidateProcessMapReadCaches(apiBase, "company-1");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scene reads singleflight, revalidate with ETag, and expose only camera metadata", async () => {
  const apiBase = "https://process-map-scene.test";
  invalidateProcessMapReadCaches(apiBase, "company-1");
  const originalFetch = globalThis.fetch;
  const requestETags: Array<string | null> = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async (input, init) => {
    const url = new URL(input.toString());
    assert.equal(url.pathname, "/v1/process-map/scene");
    assert.equal(url.searchParams.get("company_id"), "company-1");
    requestETags.push(new Headers(init?.headers).get("If-None-Match"));
    if (requestETags.length === 1) {
      await gate;
      return new Response(JSON.stringify(scenePayload()), {
        status: 200,
        headers: { "content-type": "application/json", etag: '"scene-viewer-11"' },
      });
    }
    return new Response(null, { status: 304, headers: { etag: '"scene-viewer-11"' } });
  }) as typeof fetch;
  try {
    const first = fetchProcessMapScene(apiBase, "company-1");
    const joined = fetchProcessMapScene(apiBase, "company-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requestETags.length, 1);
    release();
    const [left, right] = await Promise.all([first, joined]);
    assert.deepEqual(left, scenePayload());
    assert.deepEqual(right, left);
    assert.notEqual(right, left, "shared reads return isolated response objects");

    const revalidated = await fetchProcessMapScene(apiBase, "company-1");
    assert.deepEqual(revalidated, left);
    assert.deepEqual(requestETags, [null, '"scene-viewer-11"']);
    assert.deepEqual(Object.keys(revalidated).sort(), [
      "bounds",
      "max_tile_zoom",
      "min_tile_zoom",
      "process_map_read_version",
      "tile_size",
    ]);
  } finally {
    release();
    invalidateProcessMapReadCaches(apiBase, "company-1");
    globalThis.fetch = originalFetch;
  }
});

test("tile cache identity includes read version and z/x/y while restricted rows stay sealed", async () => {
  const apiBase = "https://process-map-tiles.test";
  invalidateProcessMapReadCaches(apiBase, "company-1");
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  let release!: () => void;
  const firstGate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async (input) => {
    const url = new URL(input.toString());
    requests.push(url);
    if (requests.length === 1) await firstGate;
    const [, zText, xText, yText] = url.pathname.match(/\/tiles\/(-?\d+)\/(-?\d+)\/(-?\d+)$/) ?? [];
    return new Response(JSON.stringify(tilePayload(
      requests.length === 1 ? 11 : 12,
      Number(zText),
      Number(xText),
      Number(yText),
    )), { status: 200, headers: { "content-type": "application/json", etag: `"tile-${requests.length}"` } });
  }) as typeof fetch;
  try {
    const first = fetchProcessMapTile(apiBase, "company-1", 11, 2, 3, -1);
    const joined = fetchProcessMapTile(apiBase, "company-1", 11, 2, 3, -1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 1);
    release();
    const [left, right] = await Promise.all([first, joined]);
    assert.deepEqual(left, right);
    assert.match(requests[0].pathname, /\/v1\/process-map\/tiles\/2\/3\/-1$/);
    assert.equal(requests[0].searchParams.get("company_id"), "company-1");
    assert.deepEqual(left.placements[1], { restricted: true, grid_x: 14, grid_y: 8 });
    assert.deepEqual(Object.keys(left.placements[1]).sort(), ["grid_x", "grid_y", "restricted"]);

    await fetchProcessMapTile(apiBase, "company-1", 12, 2, 3, -1);
    await fetchProcessMapTile(apiBase, "company-1", 12, 3, 3, -1);
    assert.equal(requests.length, 3, "new read versions and tile coordinates cannot reuse another payload");
  } finally {
    release();
    invalidateProcessMapReadCaches(apiBase, "company-1");
    globalThis.fetch = originalFetch;
  }
});

test("permission-generation invalidation synchronously disposes cached data and aborts stale leaders", async () => {
  const apiBase = "https://process-map-permission-invalidation.test";
  invalidateProcessMapReadCaches(apiBase, "company-1");
  const originalFetch = globalThis.fetch;
  const before = getProcessMapReadCacheStats();
  let requestCount = 0;
  globalThis.fetch = (async (_input, init) => {
    requestCount += 1;
    if (requestCount === 1) {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    return new Response(JSON.stringify(tilePayload(12, 2, 0, 0)), {
      status: 200,
      headers: { "content-type": "application/json", etag: '"replacement"' },
    });
  }) as typeof fetch;
  try {
    const stale = fetchProcessMapTile(apiBase, "company-1", 11, 2, 0, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(getProcessMapReadCacheStats().inflight_reads, before.inflight_reads + 1);
    invalidateProcessMapReadCaches(apiBase, "company-1");
    assert.deepEqual(getProcessMapReadCacheStats(), before, "protected cache state is removed before replacement reads");
    await assert.rejects(stale, (cause: unknown) => cause instanceof Error && cause.name === "AbortError");

    const replacement = await fetchProcessMapTile(apiBase, "company-1", 12, 2, 0, 0);
    assert.equal(replacement.process_map_read_version, 12);
    assert.equal(requestCount, 2);
  } finally {
    invalidateProcessMapReadCaches(apiBase, "company-1");
    globalThis.fetch = originalFetch;
  }
});

test("committed placement mutations send saved dimensions and return the complete canonical envelope", async () => {
  const apiBase = "https://process-map-mutation.test";
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(input.toString());
    assert.equal(url.pathname, "/v1/process-map/placements/logic_gate/gate-1");
    assert.equal(url.searchParams.get("company_id"), "company-1");
    assert.equal(init?.method, "PUT");
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      placements: [{
        company_id: "company-1",
        resource_type: "logic_gate",
        resource_id: "gate-1",
        map_parent_folder_id: null,
        grid_x: 4,
        grid_y: 8,
        grid_width: 9,
        grid_height: 6,
        revision: 3,
        created_timestamp: "created",
        updated_timestamp: "updated",
      }],
      traces: [{
        resource_operational_relationship_id: "relationship-1",
        route_points: [{ x: 13, y: 11 }],
        revision: 7,
        created_timestamp: "created",
        updated_timestamp: "updated",
      }],
      deleted_trace_ids: [],
      process_map_read_version: 12,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const envelope = await putProcessMapPlacement(
      apiBase,
      "company-1",
      { resource_type: "logic_gate", resource_id: "gate-1" },
      { map_parent_folder_id: null, grid_x: 4.4, grid_y: 8.4, grid_width: 9.4, grid_height: 6.4 },
    );
    assert.deepEqual(requestBody, {
      map_parent_folder_id: null,
      grid_x: 4,
      grid_y: 8,
      grid_width: 9,
      grid_height: 6,
    });
    assert.equal(envelope.process_map_read_version, 12);
    assert.equal(envelope.placements[0].grid_width, 9);
    assert.deepEqual(envelope.traces[0].route_points, [{ x: 13, y: 11 }]);
    assert.equal(
      Object.prototype.hasOwnProperty.call(envelope.traces[0], "path_fragments"),
      false,
      "mutation envelopes carry authoritative route geometry; tile reads own clipped display paths",
    );
  } finally {
    invalidateProcessMapReadCaches(apiBase, "company-1");
    globalThis.fetch = originalFetch;
  }
});

test("connection creation always commits an owned trace, including the empty default route", async () => {
  const apiBase = "https://process-map-connection.test";
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      placements: [],
      traces: [{ resource_operational_relationship_id: "relationship-1", route_points: [], revision: 1, created_timestamp: "created", updated_timestamp: "created" }],
      deleted_trace_ids: [],
      relationship: {
        resource_operational_relationship_id: "relationship-1",
        source: { resource_type: "logic_gate", resource_id: "source" },
        target: { resource_type: "logic_gate", resource_id: "target" },
        created_timestamp: "created",
      },
      created: true,
      changed: true,
      process_map_read_version: 12,
    }), { status: 201, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const envelope = await postProcessMapRelationship(
      apiBase,
      "company-1",
      { resource_type: "logic_gate", resource_id: "source" },
      { resource_type: "logic_gate", resource_id: "target" },
      [],
    );
    assert.deepEqual(requestBody, {
      company_id: "company-1",
      source: { resource_type: "logic_gate", resource_id: "source" },
      target: { resource_type: "logic_gate", resource_id: "target" },
      trace: { route_points: [] },
    });
    assert.equal(envelope.traces.length, 1);
    assert.equal(envelope.relationship?.resource_operational_relationship_id, "relationship-1");
  } finally {
    invalidateProcessMapReadCaches(apiBase, "company-1");
    globalThis.fetch = originalFetch;
  }
});

test("tile cache stays within the documented 32 MiB budget during a representative pan", async () => {
  const apiBase = "https://process-map-cache-budget.test";
  invalidateProcessMapReadCaches(apiBase, "company-1");
  const originalFetch = globalThis.fetch;
  let requests = 0;
  const largeName = "x".repeat(1024 * 1024);
  globalThis.fetch = (async (input) => {
    requests += 1;
    const url = new URL(input.toString());
    const [, zText, xText, yText] = url.pathname.match(/\/tiles\/(-?\d+)\/(-?\d+)\/(-?\d+)$/) ?? [];
    const payload = tilePayload(21, Number(zText), Number(xText), Number(yText));
    (payload.placements[0] as { name: string }).name = `${requests}-${largeName}`;
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await Promise.all(Array.from({ length: 38 }, (_, x) => fetchProcessMapTile(apiBase, "company-1", 21, 8, x, 0)));
    const stats = getProcessMapReadCacheStats();
    assert.equal(requests, 38);
    assert.equal(stats.inflight_reads, 0);
    assert.ok(stats.tile_bytes <= PROCESS_MAP_TILE_CACHE_BYTES, `${stats.tile_bytes} exceeds ${PROCESS_MAP_TILE_CACHE_BYTES}`);
    assert.ok(stats.tile_entries < requests, "the LRU must evict old tiles once the byte budget is crossed");
  } finally {
    invalidateProcessMapReadCaches(apiBase, "company-1");
    globalThis.fetch = originalFetch;
  }
});
