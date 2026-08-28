import type { CompanyUser } from "../communications/communicationsApi.js";
import type { Entity, EntityField } from "../entities/entitiesApi.js";
import type { UniversalGroupValue, UniversalGroupingSetting } from "../grouping/universalGrouping.js";

export const ACTION_ITEM_GROUPING_FIELDS = [
  { value: "person", label: "Person in charge" },
  { value: "created_date", label: "Created date" },
  { value: "analysis_due_date", label: "Analysis due date" },
  { value: "completion_due_date", label: "Completion due date" },
  { value: "status", label: "Status" },
  { value: "color", label: "Color" },
] as const;

export type ActionItemGroupingField = (typeof ACTION_ITEM_GROUPING_FIELDS)[number]["value"];
export type ActionItemGrouping = UniversalGroupingSetting<ActionItemGroupingField>;

export const DEFAULT_ACTION_ITEM_GROUPINGS: ActionItemGrouping[] = [
  { field: "person", direction: "asc" },
  { field: "completion_due_date", direction: "asc" },
];

export type HuddleActionItemScope =
  | { resourceType: "huddle_node"; resourceID: string }
  | { resourceType: "huddle_logic_gate"; resourceID: string };

type HuddleActionItemsRequest = <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;

type ActionItemEntityField = EntityField & { system_key?: string | null };

const GROUPING_FIELD_SET = new Set<ActionItemGroupingField>(ACTION_ITEM_GROUPING_FIELDS.map((field) => field.value));

export function actionItemGroupingStorageKey(companyID: string, userID: string): string {
  return `mangorts-huddle-action-item-groupings-v2:${companyID.trim()}:${userID.trim()}`;
}

export async function listHuddleActionItems(
  requestJSON: HuddleActionItemsRequest,
  input: { companyID: string; scope: HuddleActionItemScope; signal?: AbortSignal },
): Promise<Entity[]> {
  const params = new URLSearchParams({ company_id: input.companyID });
  params.set(
    input.scope.resourceType === "huddle_node" ? "huddle_node_id" : "huddle_logic_gate_id",
    input.scope.resourceID,
  );
  const response = await requestJSON<{ action_items?: Entity[] }>(`/v1/action-items?${params.toString()}`, {
    cache: "no-store",
    signal: input.signal,
  });
  return response.action_items ?? [];
}

export function actionItemReferenceIDs(document: unknown): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const node = value as { type?: unknown; attrs?: unknown; content?: unknown };
    if (node.type === "mangoEntityLink" && node.attrs && typeof node.attrs === "object") {
      const attrs = node.attrs as Record<string, unknown>;
      const entityID = typeof attrs.entityId === "string" ? attrs.entityId.trim() : "";
      const actionItem = attrs.actionItem === true || attrs.actionItemColor === "yellow" || attrs.actionItemColor === "red";
      if (attrs.entityType === "entity" && actionItem && entityID) ids.add(entityID);
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(document);
  return [...ids].sort();
}

export type ActionItemReferenceRefreshState = {
  signature: string;
  notifiedSignature: string;
  dirty: boolean;
};

export type ActionItemReferenceRefreshEvent =
  | { type: "snapshot"; signature: string }
  | { type: "saved" }
  | { type: "canonical"; signature: string }
  | { type: "removed" };

export function transitionActionItemReferenceRefresh(
  state: ActionItemReferenceRefreshState | undefined,
  event: ActionItemReferenceRefreshEvent,
): { state: ActionItemReferenceRefreshState | undefined; refresh: boolean } {
  if (event.type === "removed") {
    return { state: undefined, refresh: true };
  }
  if (event.type === "snapshot") {
    if (!state) {
      return { state: { signature: event.signature, notifiedSignature: event.signature, dirty: false }, refresh: false };
    }
    if (event.signature === state.signature) return { state, refresh: false };
    return { state: { ...state, signature: event.signature, dirty: true }, refresh: false };
  }
  if (event.type === "canonical") {
    if (!state) {
      return { state: { signature: event.signature, notifiedSignature: event.signature, dirty: false }, refresh: false };
    }
    const refresh = state.notifiedSignature !== event.signature;
    return {
      state: { signature: event.signature, notifiedSignature: event.signature, dirty: false },
      refresh,
    };
  }
  if (!state?.dirty) return { state, refresh: false };
  const refresh = state.notifiedSignature !== state.signature;
  return {
    state: { ...state, notifiedSignature: state.signature, dirty: false },
    refresh,
  };
}

export function normalizeActionItemGroupings(value: unknown): ActionItemGrouping[] {
  if (!Array.isArray(value)) return DEFAULT_ACTION_ITEM_GROUPINGS.map((item) => ({ ...item }));
  const seen = new Set<ActionItemGroupingField>();
  const normalized: ActionItemGrouping[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const field = (candidate as { field?: unknown }).field;
    if (typeof field !== "string" || !GROUPING_FIELD_SET.has(field as ActionItemGroupingField)) continue;
    const typedField = field as ActionItemGroupingField;
    if (seen.has(typedField)) continue;
    seen.add(typedField);
    normalized.push({
      field: typedField,
      direction: (candidate as { direction?: unknown }).direction === "desc" ? "desc" : "asc",
    });
  }
  return normalized;
}

export function actionItemField(item: Entity, systemKey: string): ActionItemEntityField | undefined {
  const normalizedKey = systemKey.trim().toLowerCase();
  return item.entity_fields.find((candidate) => {
    const field = candidate as ActionItemEntityField;
    if (field.system_key?.trim().toLowerCase() === normalizedKey) return true;
    return field.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") === normalizedKey;
  }) as ActionItemEntityField | undefined;
}

export function actionItemFieldString(item: Entity, systemKey: string): string {
  const value = actionItemField(item, systemKey)?.value;
  return typeof value === "string" ? value.trim() : "";
}

export function actionItemFieldOptionLabel(item: Entity, systemKey: string): string {
  const field = actionItemField(item, systemKey);
  const value = typeof field?.value === "string" ? field.value.trim() : "";
  if (!value) return "";
  return field?.config?.options?.find((option) => option.key === value)?.label?.trim() || titleCaseKey(value);
}

export function actionItemColor(item: Entity): string {
  const value = actionItemFieldString(item, "color").toLowerCase();
  return value || "none";
}

export function actionItemColorHex(item: Entity): string {
  const field = actionItemField(item, "color");
  const value = actionItemColor(item);
  const configured = field?.config?.options?.find((option) => option.key === value)?.color;
  if (configured && /^#[0-9a-f]{6}$/i.test(configured)) return configured;
  if (value === "yellow") return "#facc15";
  if (value === "red") return "#ef4444";
  return "#cbd5e1";
}

export function formatActionItemDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return "No date";
  return `${match[2]}/${match[3]}/${match[1]}`;
}

export function actionItemPersonLabel(item: Entity, companyUsers: CompanyUser[]): string {
  const userID = actionItemFieldString(item, "person_in_charge");
  if (!userID) return "Unassigned";
  const user = companyUsers.find((candidate) => candidate.user_id === userID);
  return user?.display_name?.trim() || user?.email?.trim() || "Company user unavailable";
}

export function actionItemGroupingValues(
  item: Entity,
  field: ActionItemGroupingField,
  companyUsers: CompanyUser[],
): UniversalGroupValue[] {
  if (field === "person") {
    const userID = actionItemFieldString(item, "person_in_charge");
    if (!userID) return [{ key: "unassigned", label: "Unassigned", sortValue: "", sortLast: true }];
    const label = actionItemPersonLabel(item, companyUsers);
    return [{ key: userID, label, sortValue: label.toLocaleLowerCase() }];
  }
  if (field === "created_date") return dateGroupingValue(item.created_timestamp, "No created date");
  if (field === "analysis_due_date") return dateGroupingValue(actionItemFieldString(item, "analysis_due_date"), "No analysis due date");
  if (field === "completion_due_date") return dateGroupingValue(actionItemFieldString(item, "completion_due_date"), "No completion due date");
  if (field === "status") {
    const status = actionItemFieldString(item, "status");
    const label = actionItemFieldOptionLabel(item, "status");
    return status
      ? [{ key: status, label, sortValue: label.toLocaleLowerCase() }]
      : [{ key: "no-status", label: "No status", sortValue: "", sortLast: true }];
  }
  const color = actionItemColor(item);
  const colorLabel = actionItemFieldOptionLabel(item, "color");
  return color === "none"
    ? [{ key: color, label: "No color", sortValue: "", sortLast: true }]
    : [{ key: color, label: colorLabel, sortValue: colorLabel.toLocaleLowerCase() }];
}

export function sortActionItems(items: Entity[]): Entity[] {
  return [...items].sort((left, right) => (
    left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
    || left.entity_id.localeCompare(right.entity_id)
  ));
}

function dateGroupingValue(value: string, emptyLabel: string): UniversalGroupValue[] {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match) return [{ key: "none", label: emptyLabel, sortValue: "", sortLast: true }];
  return [{ key: match[1], label: formatActionItemDate(match[1]), sortValue: match[1] }];
}

function titleCaseKey(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
