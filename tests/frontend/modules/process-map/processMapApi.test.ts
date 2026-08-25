import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteProcessMapPlacement,
  deleteProcessMapRelationship,
  fetchProcessMapLayer,
  fetchProcessMapOperationalRelationships,
  postProcessMapRelationship,
  putProcessMapPlacement,
  putProcessMapTrace,
} from "../../../../frontend/src/modules/process-map/processMapApi.js";

function layerPayload() {
  return {
    layer: { kind: "root" },
    placements: [
      {
        restricted: false,
        resource_type: "company_explorer_folder",
        resource_id: "folder-1",
        name: "Operations",
        grid_x: 4,
        grid_y: 8,
        revision: 1,
        created_timestamp: "created",
        updated_timestamp: "updated",
      },
      {
        restricted: true,
        grid_x: 14,
        grid_y: 8,
        resource_id: "must-not-survive",
        resource_type: "logic_gate",
        name: "must-not-survive",
      },
    ],
    traces: [{
      resource_operational_relationship_id: "must-not-survive",
      source: { resource_type: "company_explorer_folder", resource_id: "folder-1" },
      target: { resource_type: "logic_gate", resource_id: "must-not-survive" },
      route_points: [],
      revision: 1,
      created_timestamp: "created",
      updated_timestamp: "updated",
    }],
  };
}

test("identical exact-layer reads singleflight and restricted rows retain only existence and position", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async (input) => {
    requested.push(input.toString());
    await gate;
    return new Response(JSON.stringify(layerPayload()), { status: 200, headers: { "content-type": "application/json", etag: '"viewer-1"' } });
  }) as typeof fetch;
  try {
    const first = fetchProcessMapLayer("https://process-map-singleflight.test", "company-1");
    const second = fetchProcessMapLayer("https://process-map-singleflight.test", "company-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requested.length, 1);
    assert.match(requested[0], /\/v1\/process-map\/layer\?company_id=company-1$/);
    release();
    const [left, right] = await Promise.all([first, second]);
    assert.deepEqual(left, right);
    assert.deepEqual(left.placements[1], { restricted: true, grid_x: 14, grid_y: 8 });
    assert.deepEqual(Object.keys(left.placements[1]).sort(), ["grid_x", "grid_y", "restricted"]);
    assert.deepEqual(left.traces, []);
  } finally {
    release();
    globalThis.fetch = originalFetch;
  }
});

test("Strict Mode abort and immediate replay keep the shared exact-layer leader alive", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    await gate;
    return new Response(JSON.stringify(layerPayload()), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const controller = new AbortController();
    const abandoned = fetchProcessMapLayer("https://process-map-strict.test", "company-1", "folder-1", controller.signal);
    controller.abort();
    const replay = fetchProcessMapLayer("https://process-map-strict.test", "company-1", "folder-1");
    release();
    await assert.rejects(abandoned, (cause: unknown) => cause instanceof Error && cause.name === "AbortError");
    await replay;
    assert.equal(fetchCalls, 1);
  } finally {
    release();
    globalThis.fetch = originalFetch;
  }
});

test("completed layer reads revalidate with their viewer-safe ETag", async () => {
  const originalFetch = globalThis.fetch;
  const requestETags: Array<string | null> = [];
  globalThis.fetch = (async (_input, init) => {
    const headers = new Headers(init?.headers);
    requestETags.push(headers.get("If-None-Match"));
    if (requestETags.length === 2) return new Response(null, { status: 304, headers: { etag: '"viewer-1"' } });
    return new Response(JSON.stringify(layerPayload()), { status: 200, headers: { "content-type": "application/json", etag: '"viewer-1"' } });
  }) as typeof fetch;
  try {
    const first = await fetchProcessMapLayer("https://process-map-etag.test", "company-1");
    const second = await fetchProcessMapLayer("https://process-map-etag.test", "company-1");
    assert.deepEqual(second, first);
    assert.deepEqual(requestETags, [null, '"viewer-1"']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact-resource relationship reads stay bounded to one typed resource", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input, init) => {
    requested.push(input.toString());
    assert.equal(init?.method ?? "GET", "GET");
    return new Response(JSON.stringify({
      resource_operational_relationships: [{
        resource_operational_relationship_id: "relationship-1",
        source: { resource_type: "company_explorer_folder", resource_id: "folder-1" },
        target: { resource_type: "logic_gate", resource_id: "gate-1" },
        created_timestamp: "created",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const relationships = await fetchProcessMapOperationalRelationships(
      "https://process-map-resource.test",
      "company-1",
      { resource_type: "logic_gate", resource_id: "gate / 1" },
      "incoming",
    );
    assert.equal(requested.length, 1);
    const url = new URL(requested[0]);
    assert.equal(url.pathname, "/v1/process-map/operational-relationships");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      company_id: "company-1",
      resource_type: "logic_gate",
      resource_id: "gate / 1",
      direction: "incoming",
    });
    assert.equal(relationships.length, 1);
    assert.equal(relationships[0].resource_operational_relationship_id, "relationship-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Process Map mutations use the small canonical API and integer route bodies", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: URL; method: string; body: unknown }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (url.pathname.endsWith("/trace")) {
      return new Response(JSON.stringify({
        resource_operational_relationship_id: "relationship-1",
        route_points: body.route_points,
        revision: 2,
        created_timestamp: "created",
        updated_timestamp: "updated-2",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname.endsWith("/operational-relationships")) {
      return new Response(JSON.stringify({
        relationship: {
          resource_operational_relationship_id: "relationship-1",
          source: body.source,
          target: body.target,
          created_timestamp: "created",
        },
        trace: {
          resource_operational_relationship_id: "relationship-1",
          route_points: body.trace.route_points,
          revision: 1,
          created_timestamp: "created",
          updated_timestamp: "created",
        },
        relationship_created: true,
        trace_changed: true,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      resource_type: "logic_gate",
      resource_id: "gate-1",
      map_parent_folder_id: "folder-1",
      grid_x: body.grid_x,
      grid_y: body.grid_y,
      revision: 1,
      created_timestamp: "created",
      updated_timestamp: "created",
    }), { status: 201, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const folder = { resource_type: "company_explorer_folder" as const, resource_id: "folder-1" };
    const gate = { resource_type: "logic_gate" as const, resource_id: "gate-1" };
    const savedPlacement = await putProcessMapPlacement("https://process-map-mutations.test", "company-1", gate, { map_parent_folder_id: "folder-1", grid_x: 4.4, grid_y: -2.6 });
    const createdRelationship = await postProcessMapRelationship("https://process-map-mutations.test", "company-1", folder, gate, [{ x: 4.4, y: -2.6 }]);
    const savedTrace = await putProcessMapTrace("https://process-map-mutations.test", "company-1", "relationship-1", [{ x: 8.8, y: 10.2 }]);
    await deleteProcessMapRelationship("https://process-map-mutations.test", "company-1", "relationship-1");
    await deleteProcessMapPlacement("https://process-map-mutations.test", "company-1", gate);
    assert.deepEqual(calls[0].body, { map_parent_folder_id: "folder-1", grid_x: 4, grid_y: -3 });
    assert.equal(savedPlacement.map_parent_folder_id, "folder-1");
    assert.equal("name" in savedPlacement, false);
    assert.deepEqual((calls[1].body as { trace: { route_points: unknown } }).trace.route_points, [{ x: 4, y: -3 }]);
    assert.deepEqual(createdRelationship.trace?.route_points, [{ x: 4, y: -3 }]);
    assert.equal(createdRelationship.trace ? "source" in createdRelationship.trace : true, false);
    assert.deepEqual(calls[2].body, { route_points: [{ x: 9, y: 10 }] });
    assert.deepEqual(savedTrace.route_points, [{ x: 9, y: 10 }]);
    assert.equal(calls[3].method, "DELETE");
    assert.match(calls[3].url.pathname, /\/operational-relationships\/relationship-1$/);
    assert.equal(calls[4].method, "DELETE");
    assert.match(calls[4].url.pathname, /\/placements\/logic_gate\/gate-1$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
