import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildUniversalNestedGroups } from "../../../../frontend/src/modules/grouping/universalGrouping.js";
import {
  DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS,
  DEFAULT_MY_WORK_ACTION_ITEM_ORDERINGS,
  DEFAULT_MY_WORK_NODE_GROUPINGS,
  myWorkActionItemGroupingAdapter,
  myWorkNodeGroupingAdapter,
  normalizeMyWorkActionItemGroupings,
  normalizeMyWorkActionItemPreferences,
} from "../../../../frontend/src/modules/my-work/myWorkGrouping.js";
import {
  beginMyWorkSectionRequest,
  takeUnseenMyWorkItems,
} from "../../../../frontend/src/modules/my-work/useMyWorkData.js";
import {
  columnResizeA11y,
  measureMyWorkDisplayEntry,
  myWorkUnscaledPointerDelta,
  resizedColumnWeights,
  scrollRemaining,
} from "../../../../frontend/src/modules/my-work/MyWorkContent.js";
import type { MyWorkActionItem } from "../../../../frontend/src/modules/my-work/myWorkApi.js";

test("My Work density keeps virtual rows and resizer movement in unscaled layout coordinates", () => {
  const measuredRow = {
    offsetHeight: 52,
    dataset: { myWorkEstimatedSize: "48" },
  } as unknown as HTMLDivElement;
  assert.equal(measureMyWorkDisplayEntry(measuredRow), 52, "virtual rows use the unscaled layout height");
  assert.equal(myWorkUnscaledPointerDelta(18), 20, "90-percent viewport movement converts back to layout pixels");

  const source = readFileSync(new URL("../../../../../src/modules/my-work/MyWorkContent.tsx", import.meta.url), "utf8");
  assert.match(source, /onDelta\(myWorkUnscaledPointerDelta\(next - previous\)\)/, "pointer movement is unscaled at its viewport boundary");
  assert.match(source, /const nextValue = onDelta\(delta\);/, "keyboard steps remain in layout pixels");
});

test("Action Items default to Color, Huddle process, then exact Completion due date", () => {
  const groups = buildUniversalNestedGroups([
    { entity_id: "red", name: "Red", color: "red", huddle_process: { huddle_logic_gate_id: "huddle-a", name: "Alpha Huddle" }, completion_due_date: "2026-09-01", completion_due_date_field_id: "field-red", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
    { entity_id: "yellow", name: "Yellow", color: "yellow", huddle_process: { huddle_logic_gate_id: "huddle-b", name: "Beta Huddle" }, completion_due_date: "2026-09-02T18:00:00Z", completion_due_date_field_id: "field-yellow", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
    { entity_id: "none", name: "No color", completion_due_date: null, completion_due_date_field_id: "field-none", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
  ], DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS, myWorkActionItemGroupingAdapter);

  assert.deepEqual(groups.map((group) => group.label), ["Red", "Yellow", "No color"]);
  assert.deepEqual(groups[0]?.groups.map((group) => group.label), ["Alpha Huddle"]);
  assert.deepEqual(groups[0]?.groups[0]?.groups.map((group) => group.label), ["Completion due date: 09/01/2026"]);
  assert.deepEqual(groups[1]?.groups[0]?.groups.map((group) => group.label), ["Completion due date: 09/02/2026"]);
  assert.deepEqual(groups[2]?.groups.map((group) => group.label), ["No Huddle process"]);
  assert.deepEqual(groups[2]?.groups[0]?.groups.map((group) => group.label), ["No completion due date"]);
  assert.deepEqual(DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS.map((grouping) => grouping.field), ["color", "huddle_process", "completion_due_date"]);
});

test("Delegated Action Items share the three grouping levels and order leaves by Person in charge", () => {
  const groups = buildUniversalNestedGroups([
    { entity_id: "alex", name: "Alex item", color: "yellow", huddle_process: { huddle_logic_gate_id: "huddle-a", name: "Alpha Huddle" }, completion_due_date: "2026-09-01", completion_due_date_field_id: "field-alex", person_in_charge_user_id: "person-alex", person_in_charge_name: "Alex Morgan" },
    { entity_id: "zoe", name: "Zoe item", color: "yellow", huddle_process: { huddle_logic_gate_id: "huddle-a", name: "Alpha Huddle" }, completion_due_date: "2026-09-01", completion_due_date_field_id: "field-zoe", person_in_charge_user_id: "person-zoe", person_in_charge_name: "Zoe Chen" },
  ], DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS, myWorkActionItemGroupingAdapter);

  assert.deepEqual(DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS, [
    { field: "color", direction: "asc" },
    { field: "huddle_process", direction: "asc" },
    { field: "completion_due_date", direction: "asc" },
  ]);
  assert.deepEqual(DEFAULT_MY_WORK_ACTION_ITEM_ORDERINGS.delegated, [
    { field: "person_in_charge", direction: "asc" },
  ]);
  assert.deepEqual(groups[0]?.groups[0]?.groups[0]?.rows.map((row) => row.entity_id), ["alex", "zoe"]);
});

test("My Work preserves the backend keyset order instead of applying locale or numeric name sorting", () => {
  const authoritativeRows: MyWorkActionItem[] = [
    { entity_id: "00000000-0000-4000-8000-000000000001", name: "Item 10", color: "red", completion_due_date_field_id: "field-1", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
    { entity_id: "00000000-0000-4000-8000-000000000002", name: "Älpha", color: "red", completion_due_date_field_id: "field-2", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
    { entity_id: "00000000-0000-4000-8000-000000000003", name: "Item 2", color: "red", completion_due_date_field_id: "field-3", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
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

test("saved Action Item grouping and ordering remain disjoint when one side is missing", () => {
  const delegated = normalizeMyWorkActionItemPreferences({
    groupings: [{ field: "person_in_charge", direction: "asc" }],
    settings: {},
  }, "delegated");
  assert.deepEqual(delegated.groupings, [{ field: "person_in_charge", direction: "asc" }]);
  assert.deepEqual(delegated.orderings, [], "the missing default ordering cannot duplicate a saved grouping");

  const mine = normalizeMyWorkActionItemPreferences({
    settings: { ordering: [{ field: "color", direction: "desc" }] },
  }, "mine");
  assert.deepEqual(mine.orderings, [{ field: "color", direction: "desc" }]);
  assert.deepEqual(mine.groupings.map((grouping) => grouping.field), ["huddle_process", "completion_due_date"], "an explicit ordering wins over missing grouping defaults");
});

test("a Process role change clears the old role rows while its replacement is loading", () => {
  const next = beginMyWorkSectionRequest({
    items: [{
      logic_gate_id: "old",
      name: "Old Responsible Process",
      status_counts: { request: 0, pending: 0, in_progress: 0, review: 0 },
    }],
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

test("My Work column dividers resize only adjacent columns and keep every column reachable", () => {
  const start: [number, number, number] = [0.35, 0.35, 0.3];
  const first = resizedColumnWeights(start, 0, 80, 1600);
  assert.ok(first[0] > start[0]);
  assert.ok(first[1] < start[1]);
  assert.equal(Math.round(first[2] * 1000), Math.round(start[2] * 1000));

  const second = resizedColumnWeights(start, 1, -80, 1600);
  assert.equal(Math.round(second[0] * 1000), Math.round(start[0] * 1000));
  assert.ok(second[1] < start[1]);
  assert.ok(second[2] > start[2]);

  assert.deepEqual(columnResizeA11y(start, 1, 1600), { minimum: 45, maximum: 77, current: 54 });
  assert.equal(scrollRemaining({ scrollHeight: 900, scrollTop: 600, clientHeight: 250 }), 50);
});
