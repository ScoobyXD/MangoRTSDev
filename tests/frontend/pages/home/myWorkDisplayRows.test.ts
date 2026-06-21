import assert from "node:assert/strict";
import test from "node:test";

import { buildMyWorkDisplayRows, type MyWorkDisplayRow } from "../../../../frontend/src/pages/home/myWorkDisplayRows.js";
import type { MyWorkResourceRow } from "../../../../frontend/src/pages/home/myWorkGrouping.js";

function row(input: Partial<MyWorkResourceRow> & Pick<MyWorkResourceRow, "id" | "title">): MyWorkResourceRow {
  return {
    rowKey: input.rowKey ?? `row:${input.id}`,
    kind: "node",
    status: "Pending",
    dueDate: null,
    priority: null,
    accounts: [],
    projectLabels: [],
    people: [],
    teams: [],
    gvicRoles: [],
    participantUserIDs: [],
    logicGateLabels: [],
    logicGateIDs: [],
    ...input,
  };
}

function kinds(rows: MyWorkDisplayRow[]): string[] {
  return rows.map((item) => item.kind);
}

test("flat My Work display rows emit shared project and logic gate headers once", () => {
  const sourceRows = [
    row({ id: "node-1", title: "Node 1", projectID: "project-1", projectName: "Project 1", projectLabels: ["Project 1"], logicGateIDs: ["gate-1"], logicGateLabels: ["Gate 1"] }),
    row({ id: "node-2", title: "Node 2", projectID: "project-1", projectName: "Project 1", projectLabels: ["Project 1"], logicGateIDs: ["gate-1"], logicGateLabels: ["Gate 1"] }),
  ];

  const displayRows = buildMyWorkDisplayRows(sourceRows);

  assert.deepEqual(kinds(displayRows), ["project_header", "logic_gate_header", "node", "node"]);
  assert.equal(displayRows[0]?.kind === "project_header" ? displayRows[0].title : "", "Project 1");
  assert.equal(displayRows[1]?.kind === "logic_gate_header" ? displayRows[1].title : "", "Gate 1");
  assert.deepEqual(displayRows.map((item) => item.depth), [0, 1, 2, 2]);
  assert.equal(displayRows[2]?.kind === "node" ? displayRows[2].row : null, sourceRows[0]);
  assert.equal(displayRows[3]?.kind === "node" ? displayRows[3].row : null, sourceRows[1]);
});

test("flat My Work display rows can hide project headers", () => {
  const sourceRows = [
    row({ id: "node-1", title: "Node 1", projectID: "project-1", projectName: "Project 1", projectLabels: ["Project 1"], logicGateIDs: ["gate-1"], logicGateLabels: ["Gate 1"] }),
    row({ id: "node-2", title: "Node 2", projectID: "project-1", projectName: "Project 1", projectLabels: ["Project 1"], logicGateIDs: ["gate-1"], logicGateLabels: ["Gate 1"] }),
  ];

  const displayRows = buildMyWorkDisplayRows(sourceRows, { showProjectHeaders: false });

  assert.deepEqual(kinds(displayRows), ["logic_gate_header", "node", "node"]);
  assert.deepEqual(displayRows.map((item) => item.depth), [0, 1, 1]);
});

test("flat My Work display rows can hide logic gate headers", () => {
  const sourceRows = [
    row({ id: "node-1", title: "Node 1", projectID: "project-1", projectName: "Project 1", projectLabels: ["Project 1"], logicGateIDs: ["gate-1"], logicGateLabels: ["Gate 1"] }),
    row({ id: "node-2", title: "Node 2", projectID: "project-1", projectName: "Project 1", projectLabels: ["Project 1"], logicGateIDs: ["gate-1"], logicGateLabels: ["Gate 1"] }),
  ];

  const displayRows = buildMyWorkDisplayRows(sourceRows, { showLogicGateHeaders: false });

  assert.deepEqual(kinds(displayRows), ["project_header", "node", "node"]);
  assert.deepEqual(displayRows.map((item) => item.depth), [0, 1, 1]);
});

test("flat My Work display rows leave nodes without path context directly visible", () => {
  const sourceRows = [
    row({ id: "node-1", title: "Node 1" }),
  ];

  const displayRows = buildMyWorkDisplayRows(sourceRows, { baseDepth: 3 });

  assert.deepEqual(kinds(displayRows), ["node"]);
  assert.equal(displayRows[0]?.depth, 3);
  assert.equal(displayRows[0]?.kind === "node" ? displayRows[0].row : null, sourceRows[0]);
});

test("flat My Work display rows do not produce children arrays", () => {
  const sourceRows = [
    row({ id: "node-1", title: "Node 1", projectID: "project-1", projectName: "Project 1", logicGateIDs: ["gate-1"], logicGateLabels: ["Gate 1"] }),
  ];

  const displayRows = buildMyWorkDisplayRows(sourceRows);

  for (const displayRow of displayRows) {
    assert.equal(Object.prototype.hasOwnProperty.call(displayRow, "children"), false);
  }
});

test("flat My Work display row order and depth stay stable across separated path sections", () => {
  const first = row({ id: "node-1", title: "Node 1", projectID: "project-1", projectName: "Project 1", logicGateIDs: ["gate-1"], logicGateLabels: ["Gate 1"] });
  const second = row({ id: "node-2", title: "Node 2", projectID: "project-2", projectName: "Project 2", logicGateIDs: ["gate-2"], logicGateLabels: ["Gate 2"] });
  const third = row({ id: "node-3", title: "Node 3", projectID: "project-1", projectName: "Project 1", logicGateIDs: ["gate-1"], logicGateLabels: ["Gate 1"] });

  const displayRows = buildMyWorkDisplayRows([first, second, third], { baseDepth: 1 });

  assert.deepEqual(displayRows.map((item) => item.kind === "node" ? `node:${item.row.id}` : `${item.kind}:${item.title}`), [
    "project_header:Project 1",
    "logic_gate_header:Gate 1",
    "node:node-1",
    "project_header:Project 2",
    "logic_gate_header:Gate 2",
    "node:node-2",
    "project_header:Project 1",
    "logic_gate_header:Gate 1",
    "node:node-3",
  ]);
  assert.deepEqual(displayRows.map((item) => item.depth), [1, 2, 3, 1, 2, 3, 1, 2, 3]);
  assert.equal(displayRows.filter((item) => item.kind === "project_header" && item.projectID === "project-1").length, 2);
  assert.equal(displayRows.filter((item) => item.kind === "logic_gate_header" && item.logicGateID === "gate-1").length, 2);
});
