import { INBOX_PRIORITIES } from "../../pages/home/homeConstants.js";
import type {
  UniversalGroupValue,
  UniversalGroupingAdapter,
  UniversalGroupingSetting,
} from "../grouping/universalGrouping.js";
import type { MyWorkActionItem, MyWorkNode } from "./myWorkApi.js";

export const MY_WORK_ACTION_ITEM_GROUPING_FIELDS = [
  { value: "color", label: "Color" },
  { value: "completion_due_date", label: "Completion due date" },
] as const;

export type MyWorkActionItemGroupingField = (typeof MY_WORK_ACTION_ITEM_GROUPING_FIELDS)[number]["value"];
export type MyWorkActionItemGrouping = UniversalGroupingSetting<MyWorkActionItemGroupingField>;

export const DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS: MyWorkActionItemGrouping[] = [
  { field: "color", direction: "asc" },
  { field: "completion_due_date", direction: "asc" },
];

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
  sortRows: sortActionItems,
  preserveGroupOrder: true,
};

export const myWorkNodeGroupingAdapter: UniversalGroupingAdapter<MyWorkNode, MyWorkNodeGroupingField> = {
  rootID: "my-work/nodes",
  rowKey: (item) => item.node_id,
  getValues: (item, field) => nodeGroupingValues(item, field),
  sortRows: sortNodes,
  preserveGroupOrder: true,
};

export function normalizeMyWorkActionItemGroupings(value: unknown): MyWorkActionItemGrouping[] {
  return normalizeGroupingStack(value, ACTION_ITEM_GROUPING_FIELD_SET, DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS);
}

export function normalizeMyWorkNodeGroupings(value: unknown): MyWorkNodeGrouping[] {
  return normalizeGroupingStack(value, NODE_GROUPING_FIELD_SET, DEFAULT_MY_WORK_NODE_GROUPINGS);
}

export function actionItemGroupingValues(
  item: MyWorkActionItem,
  field: MyWorkActionItemGroupingField,
): UniversalGroupValue[] {
  if (field === "completion_due_date") {
    return exactDateGroupingValue(item.completion_due_date, "No completion due date");
  }
  const color = item.color?.trim().toLowerCase() ?? "";
  if (!color) return [{ key: "none", label: "No color", sortValue: 99, sortLast: true }];
  if (color === "red") return [{ key: color, label: "Red", sortValue: 1 }];
  if (color === "yellow") return [{ key: color, label: "Yellow", sortValue: 2 }];
  return [{ key: color, label: titleCase(color), sortValue: 50 }];
}

export function nodeGroupingValues(item: MyWorkNode, field: MyWorkNodeGroupingField): UniversalGroupValue[] {
  if (field === "due_date") return exactDateGroupingValue(item.due_date, "No due date");
  const priority = item.priority;
  if (!Number.isInteger(priority) || priority === undefined || priority === null || priority <= 0) {
    return [{ key: "none", label: "No priority", sortValue: 99, sortLast: true }];
  }
  const label = INBOX_PRIORITIES.find((candidate) => candidate.value === priority)?.label.replace(/\u00a0/g, " ")
    ?? `Priority ${priority}`;
  return [{ key: String(priority), label, sortValue: priority }];
}

export function sortActionItems(items: MyWorkActionItem[]): MyWorkActionItem[] {
  return [...items];
}

export function sortNodes(items: MyWorkNode[]): MyWorkNode[] {
  return [...items];
}

export function sortProcesses<T extends { name: string; logic_gate_id: string }>(items: T[]): T[] {
  return [...items];
}

export function sortProjects<T extends { name: string; project_id: string }>(items: T[]): T[] {
  return [...items];
}

function exactDateGroupingValue(value: string | null | undefined, emptyLabel: string): UniversalGroupValue[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? "");
  if (!match) return [{ key: "none", label: emptyLabel, sortValue: "", sortLast: true }];
  const exactDate = `${match[1]}-${match[2]}-${match[3]}`;
  return [{ key: exactDate, label: `${match[2]}/${match[3]}/${match[1]}`, sortValue: exactDate }];
}

function normalizeGroupingStack<Field extends string>(
  value: unknown,
  supportedFields: ReadonlySet<Field>,
  defaults: ReadonlyArray<UniversalGroupingSetting<Field>>,
): Array<UniversalGroupingSetting<Field>> {
  if (!Array.isArray(value)) return defaults.map((grouping) => ({ ...grouping }));
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

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
