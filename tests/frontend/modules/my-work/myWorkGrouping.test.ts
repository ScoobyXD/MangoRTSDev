import assert from "node:assert/strict";
import test from "node:test";
import { buildUniversalNestedGroups } from "../../../../frontend/src/modules/grouping/universalGrouping.js";
import {
  DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS,
  DEFAULT_MY_WORK_NODE_GROUPINGS,
  myWorkActionItemGroupingAdapter,
  myWorkNodeGroupingAdapter,
  normalizeMyWorkActionItemGroupings,
} from "../../../../frontend/src/modules/my-work/myWorkGrouping.js";
import { beginMyWorkSectionRequest } from "../../../../frontend/src/modules/my-work/useMyWorkData.js";
import type { MyWorkActionItem } from "../../../../frontend/src/modules/my-work/myWorkApi.js";

test("Action Items default to Color then exact Completion due date in Red, Yellow, No color order", () => {
  const groups = buildUniversalNestedGroups([
    { entity_id: "red", name: "Red", color: "red", completion_due_date: "2026-09-01" },
    { entity_id: "yellow", name: "Yellow", color: "yellow", completion_due_date: "2026-09-02T18:00:00Z" },
    { entity_id: "none", name: "No color", completion_due_date: null },
  ], DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS, myWorkActionItemGroupingAdapter);

  assert.deepEqual(groups.map((group) => group.label), ["Red", "Yellow", "No color"]);
  assert.deepEqual(groups[0]?.groups.map((group) => group.label), ["09/01/2026"]);
  assert.deepEqual(groups[1]?.groups.map((group) => group.label), ["09/02/2026"]);
  assert.deepEqual(groups[2]?.groups.map((group) => group.label), ["No completion due date"]);
  assert.deepEqual(DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS.map((grouping) => grouping.field), ["color", "completion_due_date"]);
});

test("My Work preserves the backend keyset order instead of applying locale or numeric name sorting", () => {
  const authoritativeRows: MyWorkActionItem[] = [
    { entity_id: "00000000-0000-4000-8000-000000000001", name: "Item 10", color: "red" },
    { entity_id: "00000000-0000-4000-8000-000000000002", name: "Älpha", color: "red" },
    { entity_id: "00000000-0000-4000-8000-000000000003", name: "Item 2", color: "red" },
  ];
  const groups = buildUniversalNestedGroups(
    authoritativeRows,
    [{ field: "color", direction: "asc" }],
    myWorkActionItemGroupingAdapter,
  );
  assert.deepEqual(groups[0]?.rows.map((item) => item.name), ["Item 10", "Älpha", "Item 2"]);
});

test("Nodes default to Priority then exact Due date and keep missing values visible", () => {
  const groups = buildUniversalNestedGroups([
    { node_id: "urgent", name: "Urgent", priority: 1, due_date: "2026-08-29T12:00:00Z" },
    { node_id: "later", name: "Later", priority: 5, due_date: "2026-10-20" },
    { node_id: "missing", name: "Missing", priority: null, due_date: null },
  ], DEFAULT_MY_WORK_NODE_GROUPINGS, myWorkNodeGroupingAdapter);

  assert.deepEqual(groups.map((group) => group.label), ["1  URGENT(<1hr)", "5  Later (low priority)", "No priority"]);
  assert.deepEqual(groups[0]?.groups.map((group) => group.label), ["08/29/2026"]);
  assert.deepEqual(groups[2]?.groups.map((group) => group.label), ["No due date"]);
  assert.equal(groups.flatMap((group) => group.groups).some((group) => /today|tomorrow|overdue/i.test(group.label)), false);
  assert.deepEqual(DEFAULT_MY_WORK_NODE_GROUPINGS.map((grouping) => grouping.field), ["priority", "due_date"]);
});

test("universal My Work grouping allows an empty stack without restoring a hidden default", () => {
  assert.deepEqual(normalizeMyWorkActionItemGroupings([]), []);
});

test("a Process role change clears the old role page while its replacement is loading", () => {
  const next = beginMyWorkSectionRequest({
    items: [{ logic_gate_id: "old", name: "Old Responsible Process" }],
    nextCursor: "old-next",
    hasMore: true,
    loading: false,
    error: "old error",
    currentCursor: "old-page",
    previousCursors: ["", "older"],
  }, true);

  assert.deepEqual(next.items, []);
  assert.equal(next.nextCursor, undefined);
  assert.equal(next.hasMore, false);
  assert.equal(next.currentCursor, undefined);
  assert.deepEqual(next.previousCursors, []);
  assert.equal(next.loading, true);
  assert.equal(next.error, "");
});
