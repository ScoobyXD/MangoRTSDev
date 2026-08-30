import { INBOX_PRIORITIES } from "../../pages/home/homeConstants.js";
import type {
  UniversalGroupValue,
  UniversalGroupingAdapter,
  UniversalGroupingSetting,
} from "../grouping/universalGrouping.js";
import {
  MY_WORK_ACTION_ITEM_DISPLAY_FIELD_IDS,
  type MyWorkActionItem,
  type MyWorkActionItemDisplayFieldID,
  type MyWorkActionItemPerspective,
  type MyWorkNode,
} from "./myWorkApi.js";

export const MY_WORK_ACTION_ITEM_GROUPING_FIELDS = [
  { value: "color", label: "Color" },
  { value: "huddle_process", label: "Huddle process" },
  { value: "completion_due_date", label: "Completion due date" },
  { value: "person_in_charge", label: "Person in charge" },
] as const;

export const MY_WORK_MINE_ACTION_ITEM_GROUPING_FIELDS = MY_WORK_ACTION_ITEM_GROUPING_FIELDS.slice(0, 3);

export type MyWorkActionItemGroupingField = (typeof MY_WORK_ACTION_ITEM_GROUPING_FIELDS)[number]["value"];
export type MyWorkActionItemGrouping = UniversalGroupingSetting<MyWorkActionItemGroupingField>;
export type MyWorkActionItemOrdering = UniversalGroupingSetting<MyWorkActionItemGroupingField>;

export const DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS: MyWorkActionItemGrouping[] = [
  { field: "color", direction: "asc" },
  { field: "huddle_process", direction: "asc" },
  { field: "completion_due_date", direction: "asc" },
];

export const DEFAULT_MY_WORK_ACTION_ITEM_ORDERINGS: Record<MyWorkActionItemPerspective, MyWorkActionItemOrdering[]> = {
  mine: [],
  delegated: [{ field: "person_in_charge", direction: "asc" }],
};

export const MY_WORK_ACTION_ITEM_DISPLAY_FIELDS: ReadonlyArray<{
  id: MyWorkActionItemDisplayFieldID;
  label: string;
}> = [
  { id: "person_in_charge", label: "Person in charge" },
  { id: "assigned_by", label: "Assigned by" },
  { id: "created_timestamp", label: "Created date" },
  { id: "source", label: "Source" },
  { id: "color", label: "Color" },
  { id: "analysis_due_date", label: "Analysis due date" },
  { id: "completion_due_date", label: "Completion due date" },
  { id: "status", label: "Status" },
  { id: "huddle_process", label: "Huddle process" },
];

export const DEFAULT_MY_WORK_ACTION_ITEM_DISPLAYED_FIELDS: Record<
  MyWorkActionItemPerspective,
  MyWorkActionItemDisplayFieldID[]
> = {
  mine: ["assigned_by", "completion_due_date"],
  delegated: ["person_in_charge", "completion_due_date"],
};

export const MY_WORK_NODE_GROUPING_FIELDS = [
  { value: "priority", label: "Priority" },
  { value: "due_date", label: "Due date" },
] as const;

export type MyWorkNodeGroupingField = (typeof MY_WORK_NODE_GROUPING_FIELDS)[number]["value"];
export type MyWorkNodeGrouping = UniversalGroupingSetting<MyWorkNodeGroupingField>;

export const DEFAULT_MY_WORK_NODE_GROUPINGS: MyWorkNodeGrouping[] = [
  { field: "priority", direction: "asc" },
  { field: "due_date", direction: "asc" },
];

const ACTION_ITEM_GROUPING_FIELD_SET = new Set<MyWorkActionItemGroupingField>(
  MY_WORK_ACTION_ITEM_GROUPING_FIELDS.map((field) => field.value),
);
const NODE_GROUPING_FIELD_SET = new Set<MyWorkNodeGroupingField>(
  MY_WORK_NODE_GROUPING_FIELDS.map((field) => field.value),
);

export const myWorkActionItemGroupingAdapter: UniversalGroupingAdapter<MyWorkActionItem, MyWorkActionItemGroupingField> = {
  rootID: "my-work/action-items",
  rowKey: (item) => item.entity_id,
  getValues: (item, field) => actionItemGroupingValues(item, field),
  sortRows: (items) => items,
  preserveGroupOrder: true,
};

export const myWorkNodeGroupingAdapter: UniversalGroupingAdapter<MyWorkNode, MyWorkNodeGroupingField> = {
  rootID: "my-work/nodes",
  rowKey: (item) => item.node_id,
  getValues: (item, field) => nodeGroupingValues(item, field),
  sortRows: (items) => items,
  preserveGroupOrder: true,
};

export function normalizeMyWorkActionItemGroupings(
  value: unknown,
  perspective: MyWorkActionItemPerspective = "mine",
  excludedFields: ReadonlySet<MyWorkActionItemGroupingField> = new Set(),
): MyWorkActionItemGrouping[] {
  const supportedFields = actionItemArrangeFieldSet(perspective, excludedFields);
  return normalizeGroupingStack(value, supportedFields, DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS);
}

export function normalizeMyWorkActionItemOrderings(
  value: unknown,
  perspective: MyWorkActionItemPerspective,
  groupings: ReadonlyArray<MyWorkActionItemGrouping> = [],
): MyWorkActionItemOrdering[] {
  const groupedFields = new Set(groupings.map((grouping) => grouping.field));
  return normalizeGroupingStack(
    value,
    actionItemArrangeFieldSet(perspective, groupedFields),
    DEFAULT_MY_WORK_ACTION_ITEM_ORDERINGS[perspective],
  );
}

export function normalizeMyWorkActionItemDisplayedFields(
  value: unknown,
  perspective: MyWorkActionItemPerspective,
): MyWorkActionItemDisplayFieldID[] {
  if (!Array.isArray(value)) return [...DEFAULT_MY_WORK_ACTION_ITEM_DISPLAYED_FIELDS[perspective]];
  const supportedFields = new Set<MyWorkActionItemDisplayFieldID>(MY_WORK_ACTION_ITEM_DISPLAY_FIELD_IDS);
  const seen = new Set<MyWorkActionItemDisplayFieldID>();
  const normalized: MyWorkActionItemDisplayFieldID[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !supportedFields.has(candidate as MyWorkActionItemDisplayFieldID)) continue;
    const field = candidate as MyWorkActionItemDisplayFieldID;
    if (seen.has(field)) continue;
    seen.add(field);
    normalized.push(field);
  }
  return normalized;
}

export function normalizeMyWorkActionItemPreferences(
  value: unknown,
  perspective: MyWorkActionItemPerspective,
): {
  groupings: MyWorkActionItemGrouping[];
  orderings: MyWorkActionItemOrdering[];
  displayedFields: MyWorkActionItemDisplayFieldID[];
} {
  const candidate = value && typeof value === "object"
    ? value as { groupings?: unknown; settings?: { ordering?: unknown; displayed_fields?: unknown } }
    : {};
  const rawOrderings = candidate.settings?.ordering;
  let groupings: MyWorkActionItemGrouping[];
  let orderings: MyWorkActionItemOrdering[];
  if (!Array.isArray(candidate.groupings) && Array.isArray(rawOrderings)) {
    orderings = normalizeMyWorkActionItemOrderings(rawOrderings, perspective);
    groupings = normalizeMyWorkActionItemGroupings(
      undefined,
      perspective,
      new Set(orderings.map((ordering) => ordering.field)),
    );
  } else {
    groupings = normalizeMyWorkActionItemGroupings(candidate.groupings, perspective);
    orderings = normalizeMyWorkActionItemOrderings(rawOrderings, perspective, groupings);
  }
  return {
    groupings,
    orderings,
    displayedFields: normalizeMyWorkActionItemDisplayedFields(candidate.settings?.displayed_fields, perspective),
  };
}

export function normalizeMyWorkNodeGroupings(value: unknown): MyWorkNodeGrouping[] {
  return normalizeGroupingStack(value, NODE_GROUPING_FIELD_SET, DEFAULT_MY_WORK_NODE_GROUPINGS);
}

export function actionItemGroupingValues(
  item: MyWorkActionItem,
  field: MyWorkActionItemGroupingField,
): UniversalGroupValue[] {
  if (field === "completion_due_date") {
    return exactDateGroupingValue(item.completion_due_date, "Completion due date", "No completion due date");
  }
  if (field === "huddle_process") {
    const processID = item.huddle_process?.huddle_logic_gate_id?.trim() ?? "";
    const name = item.huddle_process?.name?.trim() ?? "";
    if (!processID || !name) return [{ key: "none", label: "No Huddle process", sortValue: "", sortLast: true }];
    return [{ key: processID, label: name, sortValue: `${name.toLowerCase()}\u0000${processID}` }];
  }
  if (field === "person_in_charge") {
    const userID = item.person_in_charge_user_id?.trim() ?? "";
    const name = item.person_in_charge_name?.trim() || userID;
    if (!userID) return [{ key: "none", label: "No person in charge", sortValue: "", sortLast: true }];
    return [{ key: userID, label: name, sortValue: `${name.toLowerCase()}\u0000${userID}` }];
  }
  const color = item.color?.trim().toLowerCase() ?? "";
  if (!color) return [{ key: "none", label: "No color", sortValue: 99, sortLast: true }];
  if (color === "red") return [{ key: color, label: "Red", sortValue: 1 }];
  if (color === "yellow") return [{ key: color, label: "Yellow", sortValue: 2 }];
  return [{ key: color, label: titleCase(color), sortValue: 50 }];
}

export function nodeGroupingValues(item: MyWorkNode, field: MyWorkNodeGroupingField): UniversalGroupValue[] {
  if (field === "due_date") return exactDateGroupingValue(item.due_date, "Due date", "No due date");
  const priority = item.priority;
  if (!Number.isInteger(priority) || priority === undefined || priority === null || priority <= 0) {
    return [{ key: "none", label: "No priority", sortValue: 99, sortLast: true }];
  }
  const label = INBOX_PRIORITIES.find((candidate) => candidate.value === priority)?.label.replace(/\u00a0/g, " ")
    ?? `Priority ${priority}`;
  return [{ key: String(priority), label, sortValue: priority }];
}

function exactDateGroupingValue(value: string | null | undefined, fieldLabel: string, emptyLabel: string): UniversalGroupValue[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? "");
  if (!match) return [{ key: "none", label: emptyLabel, sortValue: "", sortLast: true }];
  const exactDate = `${match[1]}-${match[2]}-${match[3]}`;
  return [{ key: exactDate, label: `${fieldLabel}: ${match[2]}/${match[3]}/${match[1]}`, sortValue: exactDate }];
}

function normalizeGroupingStack<Field extends string>(
  value: unknown,
  supportedFields: ReadonlySet<Field>,
  defaults: ReadonlyArray<UniversalGroupingSetting<Field>>,
): Array<UniversalGroupingSetting<Field>> {
  if (!Array.isArray(value)) {
    return defaults
      .filter((grouping) => supportedFields.has(grouping.field))
      .map((grouping) => ({ ...grouping }));
  }
  const seen = new Set<Field>();
  const normalized: Array<UniversalGroupingSetting<Field>> = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const field = (candidate as { field?: unknown }).field;
    if (typeof field !== "string" || !supportedFields.has(field as Field) || seen.has(field as Field)) continue;
    seen.add(field as Field);
    normalized.push({
      field: field as Field,
      direction: (candidate as { direction?: unknown }).direction === "desc" ? "desc" : "asc",
    });
  }
  return normalized;
}

function actionItemArrangeFieldSet(
  perspective: MyWorkActionItemPerspective,
  excludedFields: ReadonlySet<MyWorkActionItemGroupingField>,
): Set<MyWorkActionItemGroupingField> {
  const fields = new Set<MyWorkActionItemGroupingField>(
    perspective === "delegated"
      ? ACTION_ITEM_GROUPING_FIELD_SET
      : MY_WORK_MINE_ACTION_ITEM_GROUPING_FIELDS.map((field) => field.value),
  );
  for (const field of excludedFields) fields.delete(field);
  return fields;
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
