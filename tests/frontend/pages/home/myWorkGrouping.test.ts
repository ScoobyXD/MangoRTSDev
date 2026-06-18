import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNestedGroups,
  computeDefaultExpandedGroupIDs,
  getMyWorkGroupValues,
  normalizeMyWorkGroupingStack,
  normalizeMyWorkSelectedScope,
  type MyWorkResourceRow,
} from "../../../../frontend/src/pages/home/myWorkGrouping.js";

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
    raciRoles: [],
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
    { field: "priority", direction: "desc" },
    { field: "priority", direction: "asc" },
    { field: "project", direction: "sideways" },
    { field: "unknown", direction: "asc" },
  ]), [
    { field: "priority", direction: "desc" },
    { field: "project", direction: "asc" },
  ]);
});

test("groups My Work rows by RACIO, priority, and project with missing fallbacks", () => {
  const rows = [
    row({ id: "node-1", title: "Project node", priority: 1, projectLabels: ["Project A"], raciRoles: ["generated"] }),
    row({ id: "node-2", title: "Missing project", priority: 2, raciRoles: ["generated"] }),
    row({ id: "node-3", title: "Others", priority: null }),
  ];
  const groups = buildNestedGroups(rows, [
    { field: "racio", direction: "asc" },
    { field: "priority", direction: "asc" },
    { field: "project", direction: "asc" },
  ]);

  assert.equal(groups[0].label, "generated");
  assert.equal(groups[0].groups[0].label, "1 URGENT(<1hr)");
  assert.equal(groups[0].groups[0].groups[0].label, "Project A");
  assert.equal(groups[0].groups[1].groups[0].label, "No project");
  assert.equal(groups[1].label, "Others");
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
