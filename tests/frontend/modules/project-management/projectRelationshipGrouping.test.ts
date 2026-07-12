import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  DEFAULT_PROJECT_RELATIONSHIP_GROUPINGS,
  buildProjectRelationshipGroupingModel,
  collectProjectRelationshipGroupIDs,
  flattenVisibleProjectRelationshipLeafRows,
  normalizeProjectRelationshipGroupingStack,
  type ProjectRelationshipGroupingSetting,
} from "../../../../frontend/src/modules/project-management/projectRelationshipGrouping.js";
import type { ProjectRelationshipProjection } from "../../../../frontend/src/modules/project-management/projectManagementApi.js";

function relationship(
  input: Partial<ProjectRelationshipProjection>
    & Pick<ProjectRelationshipProjection, "relationship_id" | "resource_type" | "resource_id" | "display_title">,
): ProjectRelationshipProjection {
  const id = input.relationship_id;
  const logicGateID = input.logic_gate_id !== undefined
    ? input.logic_gate_id
    : input.resource_type === "logic_gate" ? input.resource_id : null;
  const nodeID = input.node_id !== undefined
    ? input.node_id
    : input.resource_type === "node" ? input.resource_id : null;
  return {
    company_id: "company-1",
    project_id: "project-1",
    status: null,
    created_from_email: false,
    position: 1000,
    resource_created_timestamp: "2026-01-01T00:00:00Z",
    relationship_created_timestamp: "2026-02-01T00:00:00Z",
    relationship_updated_timestamp: "2026-02-01T00:00:00Z",
    projection_updated_timestamp: "2026-02-01T00:00:00Z",
    ...input,
    relationship_id: id,
    resource_type: input.resource_type,
    resource_id: input.resource_id,
    logic_gate_id: logicGateID,
    node_id: nodeID,
    display_title: input.display_title,
  };
}

function gate(id: string, title: string, input: Partial<ProjectRelationshipProjection> = {}): ProjectRelationshipProjection {
  return relationship({
    relationship_id: `relationship-gate-${id}`,
    resource_type: "logic_gate",
    resource_id: id,
    logic_gate_id: id,
    display_title: title,
    ...input,
  });
}

function node(id: string, title: string, logicGateID = "", input: Partial<ProjectRelationshipProjection> = {}): ProjectRelationshipProjection {
  return relationship({
    relationship_id: `relationship-node-${id}`,
    resource_type: "node",
    resource_id: id,
    node_id: id,
    logic_gate_id: logicGateID || null,
    display_title: title,
    ...input,
  });
}

test("normalizes project relationship groupings while preserving an explicit empty stack", () => {
  assert.deepEqual(normalizeProjectRelationshipGroupingStack(undefined), DEFAULT_PROJECT_RELATIONSHIP_GROUPINGS);
  assert.deepEqual(normalizeProjectRelationshipGroupingStack([]), []);
  assert.deepEqual(normalizeProjectRelationshipGroupingStack([
    { field: "type", direction: "desc" },
    { field: "status", direction: "sideways" },
    { field: "type", direction: "asc" },
    { field: "unknown", direction: "desc" },
    null,
    { field: "email_origin" },
  ]), [
    { field: "type", direction: "desc" },
    { field: "status", direction: "asc" },
    { field: "email_origin", direction: "asc" },
  ]);
});

test("builds Logic Gate then status nesting with stable depths and no anchor-only status branch", () => {
  const rows = [
    gate("gate-a", "Alpha Gate", { position: 100 }),
    node("node-review", "Review node", "gate-a", { position: 300, status: "review" }),
    node("node-pending", "Pending node", "gate-a", { position: 200, status: "pending" }),
    gate("gate-empty", "Empty Gate", { position: 400 }),
  ];
  const groupings: ProjectRelationshipGroupingSetting[] = [
    { field: "logic_gate", direction: "asc" },
    { field: "status", direction: "asc" },
  ];
  const model = buildProjectRelationshipGroupingModel(rows, groupings);

  assert.deepEqual(model.groups.map((group) => group.label), ["Alpha Gate", "Empty Gate"]);
  assert.deepEqual(model.groups[0]?.groups.map((group) => group.label), ["Review", "Pending"]);
  assert.deepEqual(model.groups[0]?.groups.map((group) => group.depth), [1, 1]);
  assert.deepEqual(model.groups[0]?.groups.flatMap((group) => group.rows.map((row) => row.relationship_id)), [
    "relationship-node-node-review",
    "relationship-node-node-pending",
  ]);
  assert.deepEqual(model.groups[1]?.groups, []);
  assert.deepEqual(model.groups[1]?.rows, []);

  const expanded = new Set(collectProjectRelationshipGroupIDs(model.groups));
  const visibleRows = flattenVisibleProjectRelationshipLeafRows(model, expanded);
  assert.deepEqual(visibleRows.map((item) => [item.row.relationship_id, item.depth]), [
    ["relationship-node-node-review", 2],
    ["relationship-node-node-pending", 2],
  ]);
});

test("honors grouping order and direction", () => {
  const rows = [
    gate("gate-a", "Alpha Gate", { created_from_email: false }),
    node("node-a", "Alpha node", "gate-a", { created_from_email: false }),
    node("node-email", "Email node", "gate-a", { created_from_email: true }),
  ];
  const typeFirst = buildProjectRelationshipGroupingModel(rows, [
    { field: "type", direction: "desc" },
    { field: "email_origin", direction: "asc" },
  ]);
  assert.deepEqual(typeFirst.groups.map((group) => [group.field, group.label]), [
    ["type", "Nodes"],
    ["type", "Logic Gates"],
  ]);
  assert.deepEqual(typeFirst.groups[0]?.groups.map((group) => group.label), [
    "Created from email",
    "Not created from email",
  ]);

  const emailFirst = buildProjectRelationshipGroupingModel(rows, [
    { field: "email_origin", direction: "desc" },
    { field: "type", direction: "asc" },
  ]);
  assert.equal(emailFirst.groups[0]?.field, "email_origin");
  assert.deepEqual(emailFirst.groups.map((group) => group.label), [
    "Not created from email",
    "Created from email",
  ]);
});

test("uses No logic gate for standalone nodes and nodes whose referenced gate is not visible", () => {
  const rows = [
    gate("gate-visible", "Visible Gate"),
    node("node-visible", "Visible gate node", "gate-visible"),
    node("node-standalone", "Standalone node"),
    node("node-hidden-gate", "Hidden gate node", "gate-hidden"),
  ];
  const model = buildProjectRelationshipGroupingModel(rows, [
    { field: "logic_gate", direction: "desc" },
  ]);

  assert.deepEqual(model.groups.map((group) => group.label), ["Visible Gate", "No logic gate"]);
  const fallback = model.groups[1];
  assert.equal(fallback?.id.includes("gate-hidden"), false);
  assert.deepEqual(fallback?.rows.map((row) => row.relationship_id), [
    "relationship-node-node-hidden-gate",
    "relationship-node-node-standalone",
  ]);
});

test("keeps an empty visible Logic Gate as a group", () => {
  const model = buildProjectRelationshipGroupingModel([
    gate("gate-empty", "Empty Gate"),
  ], [{ field: "logic_gate", direction: "asc" }]);

  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0]?.label, "Empty Gate");
  assert.deepEqual(model.groups[0]?.groups, []);
  assert.deepEqual(model.groups[0]?.rows, []);
});

test("an explicit ungrouped model returns all relationship rows at depth zero", () => {
  const rows = [
    node("node-b", "Node B", "gate-a", { position: 300 }),
    gate("gate-a", "Gate A", { position: 100 }),
    node("node-a", "Node A", "gate-a", { position: 200 }),
  ];
  const model = buildProjectRelationshipGroupingModel(rows, []);

  assert.deepEqual(model.groups, []);
  assert.deepEqual(model.ungroupedRows.map((row) => row.relationship_id), [
    "relationship-gate-gate-a",
    "relationship-node-node-a",
    "relationship-node-node-b",
  ]);
  assert.deepEqual(flattenVisibleProjectRelationshipLeafRows(model, new Set()).map((item) => ({
    id: item.row.relationship_id,
    depth: item.depth,
  })), [
    { id: "relationship-gate-gate-a", depth: 0 },
    { id: "relationship-node-node-a", depth: 0 },
    { id: "relationship-node-node-b", depth: 0 },
  ]);
});

test("suppresses a gate leaf only when the same gate is already a Logic Gate ancestor", () => {
  const rows = [
    gate("gate-a", "Gate A", { status: "pending" }),
    node("node-a", "Node A", "gate-a", { status: "review" }),
  ];
  const groupedByGate = buildProjectRelationshipGroupingModel(rows, [
    { field: "logic_gate", direction: "asc" },
  ]);
  assert.deepEqual(groupedByGate.groups[0]?.rows.map((row) => row.relationship_id), [
    "relationship-node-node-a",
  ]);

  const groupedByStatus = buildProjectRelationshipGroupingModel(rows, [
    { field: "status", direction: "asc" },
  ]);
  const expanded = new Set(collectProjectRelationshipGroupIDs(groupedByStatus.groups));
  assert.deepEqual(flattenVisibleProjectRelationshipLeafRows(groupedByStatus, expanded).map((item) => item.row.relationship_id), [
    "relationship-node-node-a",
    "relationship-gate-gate-a",
  ]);
});

test("collapsed groups are excluded from flattened visible node ordering", () => {
  const rows = [
    gate("gate-a", "Gate A"),
    node("node-a-2", "Node A2", "gate-a", { position: 300 }),
    node("node-a-1", "Node A1", "gate-a", { position: 200 }),
    gate("gate-b", "Gate B"),
    node("node-b-1", "Node B1", "gate-b", { position: 100 }),
    node("node-standalone", "Standalone", "", { position: 400 }),
  ];
  const model = buildProjectRelationshipGroupingModel(rows, [
    { field: "logic_gate", direction: "asc" },
  ]);
  const expanded = new Set(collectProjectRelationshipGroupIDs(model.groups));
  const gateBGroupID = model.groups.find((group) => group.label === "Gate B")?.id ?? "";
  expanded.delete(gateBGroupID);

  const visibleRows = flattenVisibleProjectRelationshipLeafRows(model, expanded);
  assert.deepEqual(visibleRows.map((item) => [item.row.relationship_id, item.depth]), [
    ["relationship-node-node-a-1", 1],
    ["relationship-node-node-a-2", 1],
    ["relationship-node-node-standalone", 1],
  ]);
});

test("Project Logic Gates and Nodes wires universal rows without the old card grid", () => {
  const source = readFileSync(
    resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"),
    "utf8",
  );

  assert.match(source, /<UniversalGroupingControls/);
  assert.match(source, /buildProjectRelationshipGroupingModel/);
  assert.match(source, /data-project-relationship-row="true"/);
  assert.match(source, /handleRelationshipGateDrop/);
  assert.match(source, /openRelationshipGateContextMenu/);
  assert.match(source, /startProjectRelationshipNodeDrag/);
  assert.match(source, /convertTriageMessagesToProject/);
  assert.match(source, /projectRelationshipGroupingPreferenceKey\(companyID, currentUserID\)/);
  assert.match(source, /projectWorkPanelToolbarStyle/);
  assert.match(source, /ProjectRelationshipNodePanel/);
  assert.match(source, /surfaceID="project-relationships-node-panel"/);
  assert.match(source, /position: fullscreen \? "fixed" : "absolute"/);
  assert.match(source, /setNodeEditorFullscreenChromeActive\(fullscreen\)/);
  assert.match(source, /setSelectedRelationshipNodePanel/);
  assert.match(source, /selectedRelationshipNodePanel\?\.projectID === projectID/);
  assert.match(source, /current\.projectID !== projectID/);
  assert.doesNotMatch(source, /onDoubleClick=\{\(\) => nodeID && onNodeOpen\?\.\(nodeID\)\}/);
  assert.doesNotMatch(source, /gateGroupStyle|logicGateCardHeaderStyle|repeat\(4, minmax\(170px/);
});
