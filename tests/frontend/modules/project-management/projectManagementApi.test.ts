import test from "node:test";
import assert from "node:assert/strict";
import {
  invalidateProjectRelationshipsForResource,
  listProjectRelationshipsForResource,
  upsertProjectRelationship,
  type ProjectCriticalPathStep,
  type ProjectManagementTimelineRow,
  type ProjectRelationshipProjection,
} from "../../../../frontend/src/modules/project-management/projectManagementApi.js";
import { reconcileCompanyExplorerSearchResultTitles } from "../../../../frontend/src/modules/company-explorer/companyExplorerStore.js";
import {
  reconcileProjectResourceDisplayTitles,
  reconcileProjectManagementWorkspaceTitles,
  reconcileRelationshipContextTitle,
  reconcileSelectedNodeTitle,
} from "../../../../frontend/src/modules/project-management/projectManagementCommittedTitles.js";
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

function timelineRow(resourceType: "node" | "logic_gate", resourceID: string, title: string): ProjectManagementTimelineRow {
  return {
    company_id: "company-1",
    item_id: `item-${resourceID}`,
    user_id: "user-1",
    resource_type: resourceType,
    resource_id: resourceID,
    node_id: resourceType === "node" ? resourceID : undefined,
    logic_gate_id: resourceType === "logic_gate" ? resourceID : undefined,
    display_title: title,
    start_date: "2026-07-13",
    end_date: "2026-07-13",
    duration_days: 1,
  };
}

function relationshipFor(resourceType: "node" | "logic_gate", resourceID: string, title: string): ProjectRelationshipProjection {
  return {
    ...relationship(`relationship-${resourceID}`),
    resource_type: resourceType,
    resource_id: resourceID,
    node_id: resourceType === "node" ? resourceID : null,
    logic_gate_id: resourceType === "logic_gate" ? resourceID : null,
    display_title: title,
  };
}

function criticalStep(resourceType: "node" | "logic_gate", resourceID: string, title: string): ProjectCriticalPathStep {
  return {
    company_id: "company-1",
    project_id: "project-1",
    step_id: `step-${resourceID}`,
    name: `Step ${resourceID}`,
    resource_type: resourceType,
    resource_id: resourceID,
    node_id: resourceType === "node" ? resourceID : null,
    logic_gate_id: resourceType === "logic_gate" ? resourceID : null,
    display_title: title,
    position: 1,
    is_current: false,
    created_timestamp: "2026-07-13T00:00:00Z",
    updated_timestamp: "2026-07-13T00:00:00Z",
  };
}

test("project management title caches converge for Node and Logic Gate commits without crossing companies", () => {
  const nodeUpdate = { companyID: "company-1", entityType: "node" as const, resourceID: "node-1", title: "Renamed node" };
  const gateUpdate = { companyID: "company-1", entityType: "logic_gate" as const, resourceID: "gate-1", title: "Renamed gate" };
  const initialTimeline = [timelineRow("node", "node-1", "Old node"), timelineRow("logic_gate", "gate-1", "Old gate")];

  const nodeTimeline = reconcileProjectResourceDisplayTitles(initialTimeline, nodeUpdate, "company-1");
  assert.deepEqual(nodeTimeline.map((row) => row.display_title), ["Renamed node", "Old gate"]);
  const bothTimeline = reconcileProjectResourceDisplayTitles(nodeTimeline, gateUpdate, "company-1");
  assert.deepEqual(bothTimeline.map((row) => row.display_title), ["Renamed node", "Renamed gate"]);

  const workspace = {
    nodes: [{ company_id: "company-1", node_id: "node-1", name: "Old node", created_timestamp: "2026-07-13T00:00:00Z" }],
    logicGates: [{ company_id: "company-1", logic_gate_id: "gate-1", header: "Old gate", created_timestamp: "2026-07-13T00:00:00Z" }],
    nodeFolders: ["preserved"],
  };
  const nodeWorkspace = reconcileProjectManagementWorkspaceTitles(workspace, nodeUpdate, "company-1");
  assert.equal(nodeWorkspace.nodes[0]?.name, "Renamed node");
  assert.equal(nodeWorkspace.logicGates[0]?.header, "Old gate");
  assert.deepEqual(nodeWorkspace.nodeFolders, ["preserved"]);
  const bothWorkspace = reconcileProjectManagementWorkspaceTitles(nodeWorkspace, gateUpdate, "company-1");
  assert.equal(bothWorkspace.logicGates[0]?.header, "Renamed gate");

  const relationships = [relationshipFor("node", "node-1", "Old node"), relationshipFor("logic_gate", "gate-1", "Old gate")];
  const nodeRelationships = reconcileProjectResourceDisplayTitles(relationships, nodeUpdate, "company-1");
  assert.deepEqual(nodeRelationships.map((row) => row.display_title), ["Renamed node", "Old gate"]);
  const bothRelationships = reconcileProjectResourceDisplayTitles(nodeRelationships, gateUpdate, "company-1");
  assert.deepEqual(bothRelationships.map((row) => row.display_title), ["Renamed node", "Renamed gate"]);

  const steps = [criticalStep("node", "node-1", "Old node"), criticalStep("logic_gate", "gate-1", "Old gate")];
  const nodeSteps = reconcileProjectResourceDisplayTitles(steps, nodeUpdate, "company-1");
  const bothSteps = reconcileProjectResourceDisplayTitles(nodeSteps, gateUpdate, "company-1");
  assert.deepEqual(bothSteps.map((step) => step.display_title), ["Renamed node", "Renamed gate"]);

  const selection = { nodeID: "node-1", title: "Old node", stepID: "step-node-1" };
  assert.deepEqual(reconcileSelectedNodeTitle(selection, nodeUpdate, "company-1"), { ...selection, title: "Renamed node" });
  const context = { resourceType: "logic_gate" as const, resourceID: "gate-1", displayTitle: "Old gate", relationshipID: "relationship-gate-1" };
  assert.deepEqual(reconcileRelationshipContextTitle(context, gateUpdate, "company-1"), { ...context, displayTitle: "Renamed gate" });

  const foreignUpdate = { ...nodeUpdate, companyID: "company-2", title: "Wrong company" };
  assert.equal(reconcileProjectResourceDisplayTitles(bothTimeline, foreignUpdate, "company-1"), bothTimeline);
  assert.equal(reconcileProjectManagementWorkspaceTitles(bothWorkspace, foreignUpdate, "company-1"), bothWorkspace);
  assert.equal(reconcileProjectResourceDisplayTitles(bothRelationships, foreignUpdate, "company-1"), bothRelationships);
  assert.equal(reconcileProjectResourceDisplayTitles(bothSteps, foreignUpdate, "company-1"), bothSteps);
});

test("open Critical Path node picker converges its matching search label without a reload", () => {
  const results = [
    {
      company_id: "company-1",
      resource_type: "node" as const,
      resource_id: "node-1",
      entity_id: "node-entity-1",
      display_name: "Old node",
      match_reason: "name",
      location_path: [{ entity_type: "node" as const, entity_id: "node-entity-1", resource_id: "node-1", name: "Old node" }],
      created_timestamp: "1",
      updated_timestamp: "1",
    },
    {
      company_id: "company-1",
      resource_type: "logic_gate" as const,
      resource_id: "gate-1",
      entity_id: "gate-entity-1",
      display_name: "Gate",
      match_reason: "name",
      location_path: [{ entity_type: "logic_gate" as const, entity_id: "gate-entity-1", resource_id: "gate-1", name: "Gate" }],
      created_timestamp: "2",
      updated_timestamp: "2",
    },
  ];
  const update = { companyID: "company-1", entityType: "node" as const, resourceID: "node-1", title: "Renamed node" };
  const next = reconcileCompanyExplorerSearchResultTitles(results, update);
  assert.equal(next[0]?.display_name, "Renamed node");
  assert.equal(next[0]?.location_path[0]?.name, "Renamed node");
  assert.equal(next[1], results[1]);
  assert.equal(reconcileCompanyExplorerSearchResultTitles(next, { ...update, companyID: "company-2" }), next);
});
