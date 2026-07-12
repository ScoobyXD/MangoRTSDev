import test from "node:test";
import assert from "node:assert/strict";
import {
  invalidateProjectRelationshipsForResource,
  listProjectRelationshipsForResource,
  upsertProjectRelationship,
  type ProjectRelationshipProjection,
} from "../../../../frontend/src/modules/project-management/projectManagementApi.js";
import { logout } from "../../../../frontend/src/auth/cognitoAuth.js";

function relationship(id: string): ProjectRelationshipProjection {
  return {
    company_id: "company-1",
    project_id: "project-1",
    relationship_id: id,
    resource_type: "node",
    resource_id: "node-1",
    display_title: "Node",
    position: 1,
    resource_created_timestamp: "2026-07-12T00:00:00Z",
    relationship_created_timestamp: "2026-07-12T00:00:00Z",
    relationship_updated_timestamp: "2026-07-12T00:00:00Z",
    projection_updated_timestamp: "2026-07-12T00:00:00Z",
  };
}

test("project relationship reference reads singleflight and invalidate after mutation", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  globalThis.fetch = (async (_input, init) => {
    fetchCalls += 1;
    if ((init?.method ?? "GET") === "POST") {
      return new Response(JSON.stringify({ relationship: relationship("relationship-mutated") }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (fetchCalls === 1) await firstGate;
    return new Response(JSON.stringify({ relationships: [relationship(`relationship-${fetchCalls}`)] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const input = { companyID: "company-1", resourceType: "node" as const, resourceID: "node-1" };
  invalidateProjectRelationshipsForResource();
  try {
    const first = listProjectRelationshipsForResource(input);
    const strictModeReplay = listProjectRelationshipsForResource(input);
    assert.equal(fetchCalls, 1);
    releaseFirst();
    assert.deepEqual((await first).relationships.map((item) => item.relationship_id), ["relationship-1"]);
    assert.deepEqual((await strictModeReplay).relationships.map((item) => item.relationship_id), ["relationship-1"]);
    assert.equal((await listProjectRelationshipsForResource(input)).relationships[0]?.relationship_id, "relationship-1");
    assert.equal(fetchCalls, 1);

    await upsertProjectRelationship({ ...input, projectID: "project-1" });
    assert.equal(fetchCalls, 2);
    assert.equal((await listProjectRelationshipsForResource(input)).relationships[0]?.relationship_id, "relationship-3");
    assert.equal(fetchCalls, 3);
  } finally {
    invalidateProjectRelationshipsForResource();
    globalThis.fetch = originalFetch;
  }
});

test("project relationship callers reject an old auth generation after an in-flight response", async () => {
  const originalFetch = globalThis.fetch;
  let resolveResponse!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => { resolveResponse = resolve; });
  globalThis.fetch = (async () => response) as typeof fetch;
  invalidateProjectRelationshipsForResource();
  try {
    const read = listProjectRelationshipsForResource({ companyID: "company-stale-auth", resourceType: "node", resourceID: "node-1" });
    logout();
    resolveResponse(new Response(JSON.stringify({ relationships: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await assert.rejects(read, (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError");
  } finally {
    invalidateProjectRelationshipsForResource();
    globalThis.fetch = originalFetch;
  }
});

test("project relationship invalidation aborts an obsolete in-flight caller", async () => {
  const originalFetch = globalThis.fetch;
  let resolveFirst!: (response: Response) => void;
  const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve; });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return firstResponse;
    return new Response(JSON.stringify({ relationships: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const input = { companyID: "company-invalidation", resourceType: "node" as const, resourceID: "node-1" };
  invalidateProjectRelationshipsForResource(input);
  try {
    const staleRead = listProjectRelationshipsForResource(input);
    invalidateProjectRelationshipsForResource(input);
    resolveFirst(new Response(JSON.stringify({ relationships: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await assert.rejects(staleRead, (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError");
    await listProjectRelationshipsForResource(input);
    assert.equal(calls, 2);
  } finally {
    invalidateProjectRelationshipsForResource(input);
    globalThis.fetch = originalFetch;
  }
});
