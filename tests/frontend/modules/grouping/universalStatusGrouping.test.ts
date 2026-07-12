import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { buildUniversalNestedGroups } from "../../../../frontend/src/modules/grouping/universalGrouping.js";
import { getUniversalStatusGroupValue } from "../../../../frontend/src/modules/grouping/universalStatusGrouping.js";
import { resolveUpdateStatusForGrouping } from "../../../../frontend/src/pages/home/updateStatusGrouping.js";

type StatusRow = { id: string; status: string };

function groupStatusLabels(rows: StatusRow[], direction: "asc" | "desc"): string[] {
  return buildUniversalNestedGroups(rows, [{ field: "status" as const, direction }], {
    rootID: "status-test",
    rowKey: (row) => row.id,
    getValues: (row) => [getUniversalStatusGroupValue(row.status)],
    sortRows: (items) => items,
  }).map((group) => group.label);
}

test("universal status grouping uses the canonical workflow order and keeps Done last", () => {
  const rows: StatusRow[] = [
    { id: "done", status: "Done" },
    { id: "backlog", status: "Backlogs" },
    { id: "requested", status: "Requested" },
    { id: "pending", status: "Pending" },
    { id: "review", status: "Review" },
    { id: "progress", status: "in-progress" },
  ];

  assert.deepEqual(groupStatusLabels(rows, "asc"), [
    "In Progress",
    "Review",
    "Pending",
    "Requested",
    "Backlog",
    "Done",
  ]);
  assert.deepEqual(groupStatusLabels(rows, "desc"), [
    "Backlog",
    "Requested",
    "Pending",
    "Review",
    "In Progress",
    "Done",
  ]);
});

test("universal status grouping normalizes legacy aliases and ranks unknown and missing values before Done", () => {
  assert.deepEqual(getUniversalStatusGroupValue("Verify"), {
    key: "review",
    label: "Review",
    sortValue: 2,
    sortLast: false,
  });
  assert.deepEqual(getUniversalStatusGroupValue("backlogged"), {
    key: "backlog",
    label: "Backlog",
    sortValue: 5,
    sortLast: false,
  });
  assert.deepEqual(getUniversalStatusGroupValue("Back Logs"), {
    key: "backlog",
    label: "Backlog",
    sortValue: 5,
    sortLast: false,
  });
  assert.equal(getUniversalStatusGroupValue("Requests").key, "requested");
  assert.deepEqual(getUniversalStatusGroupValue("completed"), {
    key: "done",
    label: "Done",
    sortValue: 6,
    sortLast: true,
  });
  assert.deepEqual(groupStatusLabels([
    { id: "done", status: "Done" },
    { id: "literal-none", status: "None" },
    { id: "unknown", status: "Logic Gate" },
    { id: "missing", status: "" },
  ], "asc"), ["Logic Gate", "None", "No status", "Done"]);
  assert.notEqual(getUniversalStatusGroupValue("None").key, getUniversalStatusGroupValue("").key);
});

test("Updates prefers a real event status and ignores synthetic legacy fallback copy", () => {
  assert.equal(resolveUpdateStatusForGrouping({
    type: "work_item.logic_gate_assignment_moved",
    title: "Node status changed to Review",
    body_preview: "Plan moved to Review.",
  }, "Done"), "Review");
  assert.equal(resolveUpdateStatusForGrouping({
    type: "work_item.logic_gate_assignment_moved",
    title: "Node status changed to a new state",
    body_preview: "Plan moved to a new state.",
  }, "Pending"), "Pending");
  assert.equal(resolveUpdateStatusForGrouping({
    type: "node.fields_changed",
    title: "Node status changed to a new status",
    body_preview: "Someone changed Plan to a new status.",
  }, "In Progress"), "In Progress");
  assert.equal(resolveUpdateStatusForGrouping({
    type: "work_item.logic_gate_assignment_saved",
    title: "Brand new node",
    body_preview: "Plan was added in Requested.",
  }, "Done"), "Requested");
  assert.equal(resolveUpdateStatusForGrouping({
    type: "node.comment_created",
    title: "New comment on Node status changed to Done",
    body_preview: "We moved to production.",
  }, "Pending"), "Pending");
  assert.equal(resolveUpdateStatusForGrouping({
    type: "mention.created",
    title: "Someone mentioned you in Plan",
    body_preview: "The customer changed direction to Enterprise.",
  }, "Review"), "Review");
});

test("Updates, My Work, and Projects consume the same status grouping helper", () => {
  const updates = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/UpdatesView.tsx"), "utf8");
  const sidebar = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeSavedViewsSidebar.tsx"), "utf8");
  const myWork = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/myWorkGrouping.ts"), "utf8");
  const projects = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/projectRelationshipGrouping.ts"), "utf8");
  const backend = readFileSync(resolve(process.cwd(), "backend/internal/store/saved_views.go"), "utf8");

  assert.match(updates, /type UpdateGroupingField =[^;]+"status"/);
  assert.match(updates, /getUniversalStatusGroupValue\(status\)/);
  assert.match(updates, /resolveUpdateStatusForGrouping\(row\.item, details\?\.status\)/);
  assert.match(updates, /resolveNodeDetails/);
  assert.match(sidebar, /value: "status", label: "Status"/);
  assert.match(myWork, /getUniversalStatusGroupValue\(status\)/);
  assert.match(projects, /getUniversalStatusGroupValue\(status\)/);
  assert.match(backend, /SavedViewSurfaceUpdates:[\s\S]*"status":\s+true/);
});
