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
import {
  beginMyWorkSectionRequest,
  takeUnseenMyWorkItems,
} from "../../../../frontend/src/modules/my-work/useMyWorkData.js";
import {
  columnResizeA11y,
  resizedColumnWeights,
  resizedSplitRatio,
  scrollRemaining,
  splitResizeA11y,
} from "../../../../frontend/src/modules/my-work/MyWorkContent.js";
import type { MyWorkActionItem } from "../../../../frontend/src/modules/my-work/myWorkApi.js";

test("Action Items default to Color then exact Completion due date in Red, Yellow, No color order", () => {
  const groups = buildUniversalNestedGroups([
    { entity_id: "red", name: "Red", color: "red", completion_due_date: "2026-09-01", completion_due_date_field_id: "field-red" },
    { entity_id: "yellow", name: "Yellow", color: "yellow", completion_due_date: "2026-09-02T18:00:00Z", completion_due_date_field_id: "field-yellow" },
    { entity_id: "none", name: "No color", completion_due_date: null, completion_due_date_field_id: "field-none" },
  ], DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS, myWorkActionItemGroupingAdapter);

  assert.deepEqual(groups.map((group) => group.label), ["Red", "Yellow", "No color"]);
  assert.deepEqual(groups[0]?.groups.map((group) => group.label), ["Completion due date: 09/01/2026"]);
  assert.deepEqual(groups[1]?.groups.map((group) => group.label), ["Completion due date: 09/02/2026"]);
  assert.deepEqual(groups[2]?.groups.map((group) => group.label), ["No completion due date"]);
  assert.deepEqual(DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS.map((grouping) => grouping.field), ["color", "completion_due_date"]);
});

test("My Work preserves the backend keyset order instead of applying locale or numeric name sorting", () => {
  const authoritativeRows: MyWorkActionItem[] = [
    { entity_id: "00000000-0000-4000-8000-000000000001", name: "Item 10", color: "red", completion_due_date_field_id: "field-1" },
    { entity_id: "00000000-0000-4000-8000-000000000002", name: "Älpha", color: "red", completion_due_date_field_id: "field-2" },
    { entity_id: "00000000-0000-4000-8000-000000000003", name: "Item 2", color: "red", completion_due_date_field_id: "field-3" },
  ];
  const groups = buildUniversalNestedGroups(
    authoritativeRows,
    [{ field: "color", direction: "asc" }],
    myWorkActionItemGroupingAdapter,
  );
  assert.deepEqual(groups[0]?.rows.map((item) => item.name), ["Item 10", "Älpha", "Item 2"]);
  assert.equal(myWorkActionItemGroupingAdapter.sortRows(authoritativeRows), authoritativeRows);
});

test("universal grouping de-duplicates one large group with linear row-key work", () => {
  const rows = Array.from({ length: 2_000 }, (_, index) => ({ id: `row-${index}` }));
  let rowKeyReads = 0;
  const groups = buildUniversalNestedGroups(rows, [{ field: "bucket", direction: "asc" }], {
    rootID: "linear-grouping-test",
    rowKey: (row) => {
      rowKeyReads += 1;
      return row.id;
    },
    getValues: () => [{ key: "shared", label: "Shared", sortValue: 1 }],
    sortRows: (items) => items,
  });

  assert.equal(groups[0]?.rows.length, rows.length);
  assert.equal(rowKeyReads, rows.length);
});

test("persistent My Work de-duplication reads only the incoming page and resets for replacements", () => {
  let oldKeyReads = 0;
  const oldItems = ["old-1", "old-2"].map((id) => Object.defineProperty({}, "entity_id", {
    configurable: true,
    enumerable: true,
    get: () => {
      oldKeyReads += 1;
      return id;
    },
  }) as MyWorkActionItem);
  const seen = new Set(oldItems.map((item) => item.entity_id));
  oldKeyReads = 0;
  const newItem = { entity_id: "new-1", name: "New" };

  assert.deepEqual(takeUnseenMyWorkItems("action_items", [
    { entity_id: "old-1", name: "Cursor overlap" },
    newItem,
    { entity_id: "new-1", name: "Same-page overlap" },
  ], seen), [newItem]);
  assert.equal(oldKeyReads, 0, "appending never re-reads identifiers from accumulated rows");
  assert.deepEqual([...seen], ["old-1", "old-2", "new-1"]);

  const replacement = { entity_id: "old-1", name: "Legitimate replacement" };
  assert.deepEqual(takeUnseenMyWorkItems("action_items", [replacement], new Set()), [replacement]);
});

test("Nodes default to Priority then exact Due date and keep missing values visible", () => {
  const groups = buildUniversalNestedGroups([
    { node_id: "urgent", name: "Urgent", priority: 1, due_date: "2026-08-29T12:00:00Z" },
    { node_id: "later", name: "Later", priority: 5, due_date: "2026-10-20" },
    { node_id: "missing", name: "Missing", priority: null, due_date: null },
  ], DEFAULT_MY_WORK_NODE_GROUPINGS, myWorkNodeGroupingAdapter);

  assert.deepEqual(groups.map((group) => group.label), ["1  URGENT(<1hr)", "5  Later (low priority)", "No priority"]);
  assert.deepEqual(groups[0]?.groups.map((group) => group.label), ["Due date: 08/29/2026"]);
  assert.deepEqual(groups[2]?.groups.map((group) => group.label), ["No due date"]);
  assert.equal(groups.flatMap((group) => group.groups).some((group) => /today|tomorrow|overdue/i.test(group.label)), false);
  assert.deepEqual(DEFAULT_MY_WORK_NODE_GROUPINGS.map((grouping) => grouping.field), ["priority", "due_date"]);
});

test("universal My Work grouping allows an empty stack without restoring a hidden default", () => {
  assert.deepEqual(normalizeMyWorkActionItemGroupings([]), []);
});

test("a Process role change clears the old role rows while its replacement is loading", () => {
  const next = beginMyWorkSectionRequest({
    items: [{ logic_gate_id: "old", name: "Old Responsible Process" }],
    nextCursor: "old-next",
    hasMore: true,
    loading: false,
    error: "old error",
  }, true);

  assert.deepEqual(next.items, []);
  assert.equal(next.nextCursor, undefined);
  assert.equal(next.hasMore, false);
  assert.equal(next.loading, true);
  assert.equal(next.error, "");
});

test("My Work splitters resize only adjacent panes and keep every pane reachable", () => {
  const start: [number, number, number] = [0.4, 0.3, 0.3];
  const first = resizedColumnWeights(start, 0, 80, 1000);
  assert.ok(first[0] > start[0]);
  assert.ok(first[1] < start[1]);
  assert.equal(Math.round(first[2] * 1000), Math.round(start[2] * 1000));

  const second = resizedColumnWeights(start, 1, -80, 1000);
  assert.equal(Math.round(second[0] * 1000), Math.round(start[0] * 1000));
  assert.ok(second[1] < start[1]);
  assert.ok(second[2] > start[2]);

  assert.equal(resizedSplitRatio(0.5, -10000, 800), 0.175);
  assert.equal(resizedSplitRatio(0.5, 10000, 800), 0.825);
  assert.deepEqual(splitResizeA11y(0.5, 790), { minimum: 18, maximum: 82, current: 50 });
  assert.deepEqual(columnResizeA11y(start, 1, 1000), { minimum: 40, maximum: 60, current: 50 });
  assert.equal(scrollRemaining({ scrollHeight: 900, scrollTop: 600, clientHeight: 250 }), 50);
});
