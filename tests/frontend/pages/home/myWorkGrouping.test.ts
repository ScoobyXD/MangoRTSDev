import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNestedGroups,
  computeAllExpandedCellGroupIDs,
  computeDefaultExpandedGroupIDs,
  getMyWorkGroupValues,
  myWorkCellGroupStateID,
  myWorkDisplayGroupingStack,
  normalizeMyWorkGroupingStack,
  normalizeMyWorkSelectedScope,
  type MyWorkGroupingSetting,
  type MyWorkResourceRow,
} from "../../../../frontend/src/pages/home/myWorkGrouping.js";
import { loadMyWorkMatrixCellsForUsers } from "../../../../frontend/src/pages/home/myWorkMatrixLoader.js";

function account(accountID: string, name: string) {
  return { company_id: "company-1", account_id: accountID, name, created_timestamp: "2026-01-01T00:00:00Z" };
}
function row(input: Partial<MyWorkResourceRow> & Pick<MyWorkResourceRow, "id" | "title">): MyWorkResourceRow {
  return {
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

test("normalizes My Work selected scope and grouping stack", () => {
  assert.deepEqual(normalizeMyWorkSelectedScope({ level: "team", subject_type: "group", subject_id: "group-1" }, "user-1"), {
    level: "team",
    subject_type: "group",
    subject_id: "group-1",
  });
  assert.deepEqual(normalizeMyWorkSelectedScope({ level: "me", subject_type: "company", subject_id: "company" }, "user-1"), {
    level: "me",
    subject_type: "user",
    subject_id: "user-1",
  });
  assert.deepEqual(normalizeMyWorkGroupingStack([
    { field: "project", direction: "desc" },
    { field: "project", direction: "asc" },
    { field: "status", direction: "sideways" },
    { field: "priority", direction: "asc" },
    { field: "unknown", direction: "asc" },
  ]), [
    { field: "project", direction: "desc" },
    { field: "status", direction: "asc" },
  ]);
});

test("groups My Work rows by project, person, and status with missing fallbacks", () => {
  const rows = [
    row({ id: "node-1", title: "Project node", projectLabels: ["Project A"], people: [{ userID: "user-1", label: "Person 1" }], status: "Review" }),
    row({ id: "node-2", title: "Missing project", people: [{ userID: "user-1", label: "Person 1" }], status: "" }),
    row({ id: "node-3", title: "Unassigned", projectLabels: ["Project B"], status: "Pending" }),
  ];
  const groups = buildNestedGroups(rows, [
    { field: "project", direction: "asc" },
    { field: "person", direction: "asc" },
    { field: "status", direction: "asc" },
  ]);

  assert.equal(groups[0].label, "Project A");
  assert.equal(groups[0].groups[0].label, "Person 1");
  assert.equal(groups[0].groups[0].groups[0].label, "Review");
  assert.equal(groups[1].label, "Project B");
  assert.equal(groups[1].groups[0].label, "Unassigned");
  assert.equal(groups[2].label, "No project");
  assert.equal(groups[2].groups[0].groups[0].label, "No status");
  assert.equal(getMyWorkGroupValues(row({ id: "empty", title: "Empty" }), "account")[0].label, "No account");
  assert.equal(getMyWorkGroupValues(row({ id: "empty", title: "Empty" }), "person")[0].label, "Unassigned");
  assert.equal(getMyWorkGroupValues(row({ id: "empty", title: "Empty" }), "status")[0].label, "Pending");
});

test("default expansion opens the first N groups at level N", () => {
  const rows = [
    row({ id: "a-1", title: "A1", accounts: [account("a", "Account A")], people: [{ userID: "u1", label: "Person 1" }], projectLabels: ["Project 1"] }),
    row({ id: "a-2", title: "A2", accounts: [account("a", "Account A")], people: [{ userID: "u2", label: "Person 2" }], projectLabels: ["Project 2"] }),
    row({ id: "a-3", title: "A3", accounts: [account("a", "Account A")], people: [{ userID: "u3", label: "Person 3" }], projectLabels: ["Project 3"] }),
    row({ id: "b-1", title: "B1", accounts: [account("b", "Account B")], people: [{ userID: "u1", label: "Person 1" }], projectLabels: ["Project 1"] }),
  ];
  const groups = buildNestedGroups(rows, [
    { field: "account", direction: "asc" },
    { field: "person", direction: "asc" },
    { field: "project", direction: "asc" },
  ]);
  const expanded = computeDefaultExpandedGroupIDs(groups);

  assert.equal(groups.length, 2);
  assert.equal(expanded.has(groups[0].id), true);
  assert.equal(expanded.has(groups[1].id), false);
  assert.equal(expanded.has(groups[0].groups[0].id), true);
  assert.equal(expanded.has(groups[0].groups[1].id), true);
  assert.equal(expanded.has(groups[0].groups[2].id), false);
});

test("My Work project display toggle filters project grouping without mutating saved grouping", () => {
  const savedGroupings: MyWorkGroupingSetting[] = [
    { field: "person", direction: "asc" },
    { field: "project", direction: "asc" },
    { field: "status", direction: "desc" },
  ];

  assert.deepEqual(myWorkDisplayGroupingStack([...savedGroupings], true), savedGroupings);
  assert.deepEqual(myWorkDisplayGroupingStack([...savedGroupings], false), [
    { field: "person", direction: "asc" },
    { field: "status", direction: "desc" },
  ]);
  assert.equal(savedGroupings[1].field, "project");
});

test("My Work expanded group state is scoped to the matrix cell", () => {
  const rows = [
    row({ id: "node-1", title: "Node 1", people: [{ userID: "u1", label: "Person 1" }], status: "Pending" }),
  ];
  const groups = buildNestedGroups(rows, [
    { field: "person", direction: "asc" },
    { field: "status", direction: "asc" },
  ]);
  const pendingGroupID = groups[0]?.groups[0]?.id ?? "";
  const generatedPendingID = myWorkCellGroupStateID("generated:1", pendingGroupID);
  const consultedPendingID = myWorkCellGroupStateID("consulted:1", pendingGroupID);

  const expanded = computeAllExpandedCellGroupIDs([
    { cellKey: "generated:1", groups },
    { cellKey: "consulted:1", groups },
  ]);
  const afterConsultedCollapse = new Set(expanded);
  afterConsultedCollapse.delete(consultedPendingID);

  assert.notEqual(generatedPendingID, consultedPendingID);
  assert.equal(expanded.has(generatedPendingID), true);
  assert.equal(expanded.has(consultedPendingID), true);
  assert.equal(afterConsultedCollapse.has(generatedPendingID), true);
  assert.equal(afterConsultedCollapse.has(consultedPendingID), false);
});

test("My Work scoped matrix loading preserves successful users when another user fails", async () => {
  const result = await loadMyWorkMatrixCellsForUsers({
    companyID: "company-1",
    targetUserIDs: ["user-ok", "user-fail", "user-ok", ""],
    fetchMatrix: async (targetUserID) => {
      if (targetUserID === "user-fail") throw new Error("failed_to_list_my_work_matrix");
      return {
        company_id: "company-1",
        user_id: targetUserID,
        rows: [{
          company_id: "company-1",
          projection_row_id: `my_work_node_leaf:company-1:${targetUserID}:generated:1:node:node-1:project:none:logic_gate:none`,
          user_id: targetUserID,
          node_name: "Still visible",
          gvic_assignment: "generated",
          priority: 1,
          node_id: "node-1",
          created_timestamp: "2026-01-01T00:00:00Z",
          updated_timestamp: "2026-01-01T00:00:00Z",
        }],
      };
    },
  });

  assert.equal(result.cells.length, 1);
  assert.equal(result.cells[0].userID, "user-ok");
  assert.equal(result.cells[0].node_name, "Still visible");
  assert.deepEqual(result.failures, [{ userID: "user-fail", message: "failed_to_list_my_work_matrix" }]);
});
