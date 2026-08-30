import assert from "node:assert/strict";
import test from "node:test";

import type { UniversalNestedGroup } from "../../../../frontend/src/modules/grouping/universalGrouping.js";
import { buildUniversalNestedGroups } from "../../../../frontend/src/modules/grouping/universalGrouping.js";
import type { MyWorkActionItem } from "../../../../frontend/src/modules/my-work/myWorkApi.js";
import {
  DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS,
  myWorkActionItemGroupingAdapter,
} from "../../../../frontend/src/modules/my-work/myWorkGrouping.js";
import {
  findAdjacentMyWorkRowEntryIndex,
  findMyWorkDisplayEntryIndex,
  flattenMyWorkGroupedDisplayEntries,
  flattenMyWorkUngroupedDisplayEntries,
} from "../../../../frontend/src/modules/my-work/myWorkWindowing.js";

test("My Work display entries preserve canonical group and backend row order", () => {
  const rows: MyWorkActionItem[] = [
    { entity_id: "red-first", name: "Red first", color: "red", completion_due_date: "2026-09-01", completion_due_date_field_id: "field-red-first", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
    { entity_id: "red-second", name: "Red second", color: "red", completion_due_date: "2026-09-01", completion_due_date_field_id: "field-red-second", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
    { entity_id: "yellow", name: "Yellow", color: "yellow", completion_due_date: "2026-09-02", completion_due_date_field_id: "field-yellow", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
    { entity_id: "none", name: "No color", completion_due_date: null, completion_due_date_field_id: "field-none", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
  ];
  const groups = buildUniversalNestedGroups(
    rows,
    DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS.mine,
    myWorkActionItemGroupingAdapter,
  );

  const entries = flattenMyWorkGroupedDisplayEntries(groups, (row) => row.entity_id);
  assert.deepEqual(entries.map((entry) => entry.kind === "group-header"
    ? `header:${entry.depth}:${entry.label}:${entry.rowCount}`
    : `row:${entry.depth}:${entry.rowID}`), [
    "header:0:Red:2",
    "header:1:No Huddle process:2",
    "row:2:red-first",
    "row:2:red-second",
    "header:0:Yellow:1",
    "header:1:No Huddle process:1",
    "row:2:yellow",
    "header:0:No color:1",
    "header:1:No Huddle process:1",
    "row:2:none",
  ]);

  const rowEntries = entries.filter((entry) => entry.kind === "row");
  assert.equal(rowEntries[0]?.row, rows[0], "flattening retains the authoritative row object");
  assert.deepEqual(
    flattenMyWorkGroupedDisplayEntries(groups, (row) => row.entity_id).map((entry) => entry.entryID),
    entries.map((entry) => entry.entryID),
    "stable group and row identities survive model rebuilds",
  );
});

test("hidden date headers keep due-date-first batches and nested color boundaries", () => {
  const rows: MyWorkActionItem[] = [
    { entity_id: "early-red", name: "Early red", color: "red", completion_due_date: "2026-09-01", completion_due_date_field_id: "field-early-red", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
    { entity_id: "early-yellow", name: "Early yellow", color: "yellow", completion_due_date: "2026-09-01", completion_due_date_field_id: "field-early-yellow", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
    { entity_id: "late-red", name: "Late red", color: "red", completion_due_date: "2026-09-02", completion_due_date_field_id: "field-late-red", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
  ];
  const groups = buildUniversalNestedGroups(rows, [
    { field: "completion_due_date", direction: "asc" },
    { field: "color", direction: "asc" },
  ], myWorkActionItemGroupingAdapter);

  const entries = flattenMyWorkGroupedDisplayEntries(
    groups,
    (row) => row.entity_id,
    new Set(["completion_due_date"]),
  );

  assert.deepEqual(entries.map((entry) => entry.kind === "group-header"
    ? `header:${entry.depth}:${entry.label}`
    : `row:${entry.depth}:${entry.rowID}`), [
    "header:0:Red",
    "row:1:early-red",
    "header:0:Yellow",
    "row:1:early-yellow",
    "header:0:Red",
    "row:1:late-red",
  ]);
  assert.deepEqual(entries.filter((entry) => entry.kind === "row").map((entry) => entry.rowID), [
    "early-red",
    "early-yellow",
    "late-red",
  ], "removing date headers never regroups rows across date batches");
});

test("Delegated Action Item rows use Color, Person in charge, then Huddle process", () => {
  const rows: MyWorkActionItem[] = [
    { entity_id: "alex", name: "Alex item", color: "yellow", completion_due_date: "2026-09-01", completion_due_date_field_id: "field-alex", person_in_charge_user_id: "person-alex", person_in_charge_name: "Alex Morgan" },
    { entity_id: "zoe", name: "Zoe item", color: "yellow", completion_due_date: "2026-09-01", completion_due_date_field_id: "field-zoe", person_in_charge_user_id: "person-zoe", person_in_charge_name: "Zoe Chen" },
  ];
  const entries = flattenMyWorkGroupedDisplayEntries(
    buildUniversalNestedGroups(rows, DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS.delegated, myWorkActionItemGroupingAdapter),
    (row) => row.entity_id,
  );

  assert.deepEqual(entries.map((entry) => entry.kind === "group-header"
    ? `header:${entry.depth}:${entry.field}:${entry.label}`
    : `row:${entry.depth}:${entry.rowID}`), [
    "header:0:color:Yellow",
    "header:1:person_in_charge:Alex Morgan",
    "header:2:huddle_process:No Huddle process",
    "row:3:alex",
    "header:1:person_in_charge:Zoe Chen",
    "header:2:huddle_process:No Huddle process",
    "row:3:zoe",
  ]);
});

test("Huddle surfaces include their headings, descendant groups, and rows", () => {
  const rows: MyWorkActionItem[] = [
    {
      entity_id: "weekly-first",
      name: "Weekly first",
      color: "yellow",
      completion_due_date: "2026-09-01",
      completion_due_date_field_id: "field-weekly-first",
      person_in_charge_user_id: "person-1",
      person_in_charge_name: "Person One",
      huddle_process: { huddle_logic_gate_id: "huddle-weekly", name: "Weekly Huddle" },
    },
    {
      entity_id: "weekly-second",
      name: "Weekly second",
      color: "yellow",
      completion_due_date: "2026-09-01",
      completion_due_date_field_id: "field-weekly-second",
      person_in_charge_user_id: "person-1",
      person_in_charge_name: "Person One",
      huddle_process: { huddle_logic_gate_id: "huddle-weekly", name: "Weekly Huddle" },
    },
  ];
  const groups = buildUniversalNestedGroups(rows, [
    { field: "color", direction: "asc" },
    { field: "huddle_process", direction: "asc" },
    { field: "completion_due_date", direction: "asc" },
  ], myWorkActionItemGroupingAdapter);
  const entries = flattenMyWorkGroupedDisplayEntries(
    groups,
    (row) => row.entity_id,
    new Set(),
    false,
    "huddle_process",
  );
  const surfaced = entries.filter((entry) => entry.surface?.key === "huddle-weekly");

  assert.deepEqual(surfaced.map((entry) => ({
    entry: entry.kind === "row" ? `row:${entry.rowID}` : `header:${entry.field}`,
    surfaceID: entry.surface?.id,
    surfaceDepth: entry.surface?.depth,
    edge: entry.surface?.edge,
  })), [
    { entry: "header:huddle_process", surfaceID: "my-work/action-items/color:yellow/huddle_process:huddle-weekly", surfaceDepth: 1, edge: "first" },
    { entry: "header:completion_due_date", surfaceID: "my-work/action-items/color:yellow/huddle_process:huddle-weekly", surfaceDepth: 1, edge: "middle" },
    { entry: "row:weekly-first", surfaceID: "my-work/action-items/color:yellow/huddle_process:huddle-weekly", surfaceDepth: 1, edge: "middle" },
    { entry: "row:weekly-second", surfaceID: "my-work/action-items/color:yellow/huddle_process:huddle-weekly", surfaceDepth: 1, edge: "last" },
  ]);
  assert.equal(entries[0]?.surface, undefined, "the parent Color heading stays outside the Huddle surface");
});

test("No-Huddle buckets receive a neutral surface and a lone visible entry uses the only edge", () => {
  const row: MyWorkActionItem = {
    entity_id: "without-huddle",
    name: "Without Huddle",
    color: "red",
    completion_due_date: null,
    completion_due_date_field_id: "field-without-huddle",
    person_in_charge_user_id: "person-1",
    person_in_charge_name: "Person One",
  };
  const groups = buildUniversalNestedGroups(
    [row],
    [{ field: "huddle_process", direction: "asc" }],
    myWorkActionItemGroupingAdapter,
  );
  const visibleEntries = flattenMyWorkGroupedDisplayEntries(
    groups,
    (item) => item.entity_id,
    new Set(),
    false,
    "huddle_process",
  );

  assert.deepEqual(visibleEntries.map((entry) => ({
    kind: entry.kind,
    key: entry.surface?.key,
    edge: entry.surface?.edge,
  })), [
    { kind: "group-header", key: "none", edge: "first" },
    { kind: "row", key: "none", edge: "last" },
  ]);

  const hiddenHeadingEntries = flattenMyWorkGroupedDisplayEntries(
    groups,
    (item) => item.entity_id,
    new Set(["huddle_process"]),
    false,
    "huddle_process",
  );
  assert.equal(hiddenHeadingEntries.length, 1);
  assert.deepEqual(hiddenHeadingEntries[0]?.surface, {
    id: "my-work/action-items/huddle_process:none",
    key: "none",
    depth: 0,
    edge: "only",
  });
});

test("the same Huddle under separate parent groups receives separate surfaces", () => {
  const huddle = { huddle_logic_gate_id: "huddle-shared", name: "Shared Huddle" };
  const rows: MyWorkActionItem[] = [
    { entity_id: "red-shared", name: "Red shared", color: "red", completion_due_date_field_id: "field-red", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One", huddle_process: huddle },
    { entity_id: "yellow-shared", name: "Yellow shared", color: "yellow", completion_due_date_field_id: "field-yellow", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One", huddle_process: huddle },
  ];
  const entries = flattenMyWorkGroupedDisplayEntries(
    buildUniversalNestedGroups(rows, DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS.mine, myWorkActionItemGroupingAdapter),
    (row) => row.entity_id,
    new Set(),
    false,
    "huddle_process",
  );
  const huddleHeaders = entries.filter((entry) => entry.kind === "group-header" && entry.field === "huddle_process");

  assert.deepEqual(huddleHeaders.map((entry) => ({
    key: entry.surface?.key,
    id: entry.surface?.id,
    edge: entry.surface?.edge,
  })), [
    { key: "huddle-shared", id: "my-work/action-items/color:red/huddle_process:huddle-shared", edge: "first" },
    { key: "huddle-shared", id: "my-work/action-items/color:yellow/huddle_process:huddle-shared", edge: "first" },
  ]);
  assert.notEqual(huddleHeaders[0]?.surface?.id, huddleHeaders[1]?.surface?.id);
});

test("My Work row navigation skips group headers in both directions", () => {
  const rows: MyWorkActionItem[] = [
    { entity_id: "red-first", name: "Red first", color: "red", completion_due_date: "2026-09-01", completion_due_date_field_id: "field-red-first", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
    { entity_id: "red-second", name: "Red second", color: "red", completion_due_date: "2026-09-01", completion_due_date_field_id: "field-red-second", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
    { entity_id: "yellow", name: "Yellow", color: "yellow", completion_due_date: "2026-09-02", completion_due_date_field_id: "field-yellow", person_in_charge_user_id: "person-1", person_in_charge_name: "Person One" },
  ];
  const entries = flattenMyWorkGroupedDisplayEntries(
    buildUniversalNestedGroups(rows, DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS.mine, myWorkActionItemGroupingAdapter),
    (row) => row.entity_id,
  );
  const first = entries.findIndex((entry) => entry.kind === "row" && entry.rowID === "red-first");
  const second = entries.findIndex((entry) => entry.kind === "row" && entry.rowID === "red-second");
  const yellow = entries.findIndex((entry) => entry.kind === "row" && entry.rowID === "yellow");

  assert.equal(findAdjacentMyWorkRowEntryIndex(entries, first, "next"), second);
  assert.equal(findAdjacentMyWorkRowEntryIndex(entries, second, "next"), yellow, "headers between groups are skipped");
  assert.equal(findAdjacentMyWorkRowEntryIndex(entries, yellow, "previous"), second);
  assert.equal(findAdjacentMyWorkRowEntryIndex(entries, first, "previous"), null);
  assert.equal(findAdjacentMyWorkRowEntryIndex(entries, yellow, "next"), null);
  assert.equal(findMyWorkDisplayEntryIndex(entries, entries[yellow]?.entryID ?? ""), yellow);
});

test("My Work flattening stays linear for thousands of rows", () => {
  type Row = { id: string };
  type Field = "color" | "due_date";
  const rowCount = 5_000;
  const rows = Array.from({ length: rowCount }, (_, index): Row => ({ id: `row-${index}` }));
  const leaf: UniversalNestedGroup<Row, Field> = {
    id: "my-work/action-items/color:red/due_date:2026-09-01",
    field: "due_date",
    key: "2026-09-01",
    label: "Completion due date: 09/01/2026",
    sortValue: "2026-09-01",
    depth: 1,
    groups: [],
    rows,
  };
  const groups: Array<UniversalNestedGroup<Row, Field>> = [{
    id: "my-work/action-items/color:red",
    field: "color",
    key: "red",
    label: "Red",
    sortValue: 1,
    depth: 0,
    groups: [leaf],
    rows: [],
  }];
  let identityReads = 0;

  const entries = flattenMyWorkGroupedDisplayEntries(groups, (row) => {
    identityReads += 1;
    return row.id;
  });

  assert.equal(entries.length, rowCount + 2, "one entry is produced per row plus one per existing header");
  assert.equal(identityReads, rowCount, "each row identity is read exactly once");
  assert.deepEqual(entries.slice(0, 4).map((entry) => entry.kind === "row" ? entry.rowID : entry.rowCount), [rowCount, rowCount, "row-0", "row-1"]);
  const lastEntry = entries[entries.length - 1];
  assert.equal(lastEntry?.kind === "row" ? lastEntry.rowID : "", `row-${rowCount - 1}`);
});

test("ungrouped My Work rows retain order, identity, and zero depth", () => {
  const rows = [{ id: "first" }, { id: "second" }];
  const entries = flattenMyWorkUngroupedDisplayEntries(rows, (row) => row.id);

  assert.deepEqual(entries.map((entry) => ({
    entryID: entry.entryID,
    rowID: entry.rowID,
    depth: entry.depth,
    parentGroupID: entry.parentGroupID,
  })), [
    { entryID: "row:first", rowID: "first", depth: 0, parentGroupID: undefined },
    { entryID: "row:second", rowID: "second", depth: 0, parentGroupID: undefined },
  ]);
  assert.equal(entries[1]?.row, rows[1]);
});
