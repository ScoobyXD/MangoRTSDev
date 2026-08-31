import type { CompanyUser } from "../communications/communicationsApi.js";
import type { ActionItemSource, Entity, EntityField } from "../entities/entitiesApi.js";
import type { UniversalGroupValue, UniversalGroupingSetting } from "../grouping/universalGrouping.js";
import type { MyWorkActionItem, MyWorkActionItemDisplayFieldID } from "../my-work/myWorkApi.js";
import { actionItemGroupingValues as myWorkActionItemGroupingValues } from "../my-work/myWorkGrouping.js";

export const EVENT_HUDDLE_ACTION_ITEMS_CHANGED = "mangorts:huddle-action-items-changed";
export type HuddleActionItemsChangedDetail = {
  companyID: string;
  huddleLogicGateID: string;
};

export const HUDDLE_ACTION_ITEM_ARRANGE_FIELDS = [
  { value: "color", label: "Color" },
  { value: "person_in_charge", label: "Person in charge" },
  { value: "completion_due_date", label: "Completion due date" },
] as const;

export type HuddleActionItemArrangeField = (typeof HUDDLE_ACTION_ITEM_ARRANGE_FIELDS)[number]["value"];
export type HuddleActionItemGrouping = UniversalGroupingSetting<HuddleActionItemArrangeField>;
export type HuddleActionItemOrdering = UniversalGroupingSetting<HuddleActionItemArrangeField>;

export const DEFAULT_HUDDLE_ACTION_ITEM_GROUPINGS: HuddleActionItemGrouping[] = [
  { field: "color", direction: "asc" },
  { field: "person_in_charge", direction: "asc" },
];
export const DEFAULT_HUDDLE_ACTION_ITEM_ORDERINGS: HuddleActionItemOrdering[] = [
  { field: "completion_due_date", direction: "asc" },
];

export type HuddleActionItemDisplayFieldID = Exclude<MyWorkActionItemDisplayFieldID, "huddle_process">;
export const HUDDLE_ACTION_ITEM_DISPLAY_FIELDS: ReadonlyArray<{
  id: HuddleActionItemDisplayFieldID;
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
];
export const DEFAULT_HUDDLE_ACTION_ITEM_DISPLAYED_FIELDS: HuddleActionItemDisplayFieldID[] = [
  "person_in_charge",
  "completion_due_date",
];

export type HuddleActionItemScope =
  | { resourceType: "huddle_node"; resourceID: string }
  | { resourceType: "huddle_logic_gate"; resourceID: string };

export const HUDDLE_ACTION_ITEM_SAVED_VIEW_SURFACES = {
  huddle_logic_gate: "huddle_logic_gate_action_items",
  huddle_node: "huddle_node_action_items",
} as const;
export type HuddleActionItemSavedViewSurface = (
  typeof HUDDLE_ACTION_ITEM_SAVED_VIEW_SURFACES
)[HuddleActionItemScope["resourceType"]];

export type HuddleActionItem = Entity & { source?: ActionItemSource };
export type HuddleActionItemSavedView = {
  company_id: string;
  saved_view_id: string;
  surface: HuddleActionItemSavedViewSurface;
  principal: "user";
  principal_id: string;
  name: string;
  groupings: HuddleActionItemGrouping[];
  settings: {
    ordering: HuddleActionItemOrdering[];
    displayed_fields: HuddleActionItemDisplayFieldID[];
  };
  position: number;
};
export type HuddleActionItemPreferences = {
  groupings: HuddleActionItemGrouping[];
  orderings: HuddleActionItemOrdering[];
  displayedFields: HuddleActionItemDisplayFieldID[];
};

type HuddleActionItemsRequest = <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;
type ActionItemEntityField = EntityField & { system_key?: string | null };
const ARRANGE_FIELD_SET = new Set<HuddleActionItemArrangeField>(
  HUDDLE_ACTION_ITEM_ARRANGE_FIELDS.map((field) => field.value),
);
const DISPLAY_FIELD_SET = new Set<HuddleActionItemDisplayFieldID>(
  HUDDLE_ACTION_ITEM_DISPLAY_FIELDS.map((field) => field.id),
);

export async function listHuddleActionItems(
  requestJSON: HuddleActionItemsRequest,
  input: { companyID: string; scope: HuddleActionItemScope; signal?: AbortSignal },
): Promise<HuddleActionItem[]> {
  const params = new URLSearchParams({ company_id: input.companyID });
  params.set(
    input.scope.resourceType === "huddle_node" ? "huddle_node_id" : "huddle_logic_gate_id",
    input.scope.resourceID,
  );
  const response = await requestJSON<{ action_items?: HuddleActionItem[] }>(`/v1/action-items?${params.toString()}`, {
    cache: "no-store",
    signal: input.signal,
  });
  return response.action_items ?? [];
}

export async function fetchHuddleActionItemSavedView(
  requestJSON: HuddleActionItemsRequest,
  companyID: string,
  scopeType: HuddleActionItemScope["resourceType"],
): Promise<HuddleActionItemSavedView | null> {
  const surface = HUDDLE_ACTION_ITEM_SAVED_VIEW_SURFACES[scopeType];
  const params = new URLSearchParams({ company_id: companyID.trim(), surface });
  const response = await requestJSON<{ saved_views?: HuddleActionItemSavedView[] }>(
    `/v1/saved-views?${params.toString()}`,
    { cache: "no-store" },
  );
  return (response.saved_views ?? []).find((view) => view?.surface === surface) ?? null;
}

export async function saveHuddleActionItemSavedView(
  requestJSON: HuddleActionItemsRequest,
  input: {
    companyID: string;
    userID: string;
    scopeType: HuddleActionItemScope["resourceType"];
    savedViewID: string;
    groupings: ReadonlyArray<HuddleActionItemGrouping>;
    orderings: ReadonlyArray<HuddleActionItemOrdering>;
    displayedFields: ReadonlyArray<HuddleActionItemDisplayFieldID>;
  },
): Promise<HuddleActionItemSavedView> {
  const surface = HUDDLE_ACTION_ITEM_SAVED_VIEW_SURFACES[input.scopeType];
  return requestJSON<HuddleActionItemSavedView>(`/v1/saved-views/${encodeURIComponent(input.savedViewID.trim())}`, {
    method: "PUT",
    json: {
      company_id: input.companyID.trim(),
      saved_view_id: input.savedViewID.trim(),
      surface,
      principal: "user",
      principal_id: input.userID.trim(),
      name: input.scopeType === "huddle_node" ? "Huddle Node Action Items" : "Huddle Process Action Items",
      groupings: input.groupings,
      settings: { ordering: input.orderings, displayed_fields: input.displayedFields },
      position: 1000,
    },
  });
}

export function normalizeHuddleActionItemPreferences(value: unknown): HuddleActionItemPreferences {
  const candidate = value && typeof value === "object"
    ? value as { groupings?: unknown; settings?: { ordering?: unknown; displayed_fields?: unknown } }
    : {};
  const rawOrderings = candidate.settings?.ordering;
  let groupings: HuddleActionItemGrouping[];
  let orderings: HuddleActionItemOrdering[];
  if (!Array.isArray(candidate.groupings) && Array.isArray(rawOrderings)) {
    orderings = normalizeHuddleActionItemOrderings(rawOrderings);
    groupings = normalizeHuddleActionItemGroupings(undefined, new Set(orderings.map((item) => item.field)));
  } else {
    groupings = normalizeHuddleActionItemGroupings(candidate.groupings);
    orderings = normalizeHuddleActionItemOrderings(rawOrderings, new Set(groupings.map((item) => item.field)));
  }
  return {
    groupings,
    orderings,
    displayedFields: normalizeHuddleActionItemDisplayedFields(candidate.settings?.displayed_fields),
  };
}

export function normalizeHuddleActionItemGroupings(
  value: unknown,
  excludedFields: ReadonlySet<HuddleActionItemArrangeField> = new Set(),
): HuddleActionItemGrouping[] {
  return normalizeArrangeStack(value, DEFAULT_HUDDLE_ACTION_ITEM_GROUPINGS, excludedFields);
}

export function normalizeHuddleActionItemOrderings(
  value: unknown,
  excludedFields: ReadonlySet<HuddleActionItemArrangeField> = new Set(),
): HuddleActionItemOrdering[] {
  return normalizeArrangeStack(value, DEFAULT_HUDDLE_ACTION_ITEM_ORDERINGS, excludedFields);
}

export function normalizeHuddleActionItemDisplayedFields(value: unknown): HuddleActionItemDisplayFieldID[] {
  if (!Array.isArray(value)) return [...DEFAULT_HUDDLE_ACTION_ITEM_DISPLAYED_FIELDS];
  const seen = new Set<HuddleActionItemDisplayFieldID>();
  const normalized: HuddleActionItemDisplayFieldID[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !DISPLAY_FIELD_SET.has(candidate as HuddleActionItemDisplayFieldID)) continue;
    const field = candidate as HuddleActionItemDisplayFieldID;
    if (seen.has(field)) continue;
    seen.add(field);
    normalized.push(field);
  }
  return normalized;
}

function normalizeArrangeStack(
  value: unknown,
  defaults: ReadonlyArray<UniversalGroupingSetting<HuddleActionItemArrangeField>>,
  excludedFields: ReadonlySet<HuddleActionItemArrangeField>,
): HuddleActionItemGrouping[] {
  if (!Array.isArray(value)) {
    return defaults.filter((setting) => !excludedFields.has(setting.field)).map((setting) => ({ ...setting }));
  }
  const seen = new Set<HuddleActionItemArrangeField>();
  const normalized: HuddleActionItemGrouping[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const field = (candidate as { field?: unknown }).field;
    if (
      typeof field !== "string"
      || !ARRANGE_FIELD_SET.has(field as HuddleActionItemArrangeField)
      || excludedFields.has(field as HuddleActionItemArrangeField)
      || seen.has(field as HuddleActionItemArrangeField)
    ) continue;
    const typedField = field as HuddleActionItemArrangeField;
    seen.add(typedField);
    normalized.push({
      field: typedField,
      direction: (candidate as { direction?: unknown }).direction === "desc" ? "desc" : "asc",
    });
  }
  return normalized;
}

export function toHuddleActionItemPresentation(
  item: HuddleActionItem,
  companyUsers: ReadonlyArray<CompanyUser>,
): MyWorkActionItem {
  const personInChargeID = actionItemFieldString(item, "person_in_charge");
  const assignedByID = actionItemFieldString(item, "assigned_by");
  return {
    entity_id: item.entity_id,
    name: item.name,
    color: actionItemFieldString(item, "color") || null,
    status: actionItemFieldString(item, "status") || null,
    analysis_due_date: actionItemFieldString(item, "analysis_due_date") || null,
    completion_due_date: actionItemFieldString(item, "completion_due_date") || null,
    completion_due_date_field_id: actionItemField(item, "completion_due_date")?.entity_field_id ?? "",
    person_in_charge_user_id: personInChargeID,
    person_in_charge_name: companyUserLabel(personInChargeID, companyUsers, "No person in charge"),
    assigned_by_user_id: assignedByID || undefined,
    assigned_by_name: assignedByID ? companyUserLabel(assignedByID, companyUsers, "Company user unavailable") : undefined,
    created_timestamp: item.created_timestamp,
    source: item.source,
  };
}

export function huddleActionItemGroupingValues(
  item: MyWorkActionItem,
  field: HuddleActionItemArrangeField,
): UniversalGroupValue[] {
  return myWorkActionItemGroupingValues(item, field);
}

export function sortHuddleActionItems(
  items: MyWorkActionItem[],
  orderings: ReadonlyArray<HuddleActionItemOrdering>,
): MyWorkActionItem[] {
  if (orderings.length === 0) return [...items];
  return [...items].sort((left, right) => {
    for (const ordering of orderings) {
      const leftMissing = arrangeFieldMissing(left, ordering.field);
      const rightMissing = arrangeFieldMissing(right, ordering.field);
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      const comparison = compareArrangeField(left, right, ordering.field);
      if (comparison !== 0) return ordering.direction === "desc" ? -comparison : comparison;
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
      || left.entity_id.localeCompare(right.entity_id);
  });
}

function compareArrangeField(
  left: MyWorkActionItem,
  right: MyWorkActionItem,
  field: HuddleActionItemArrangeField,
): number {
  if (field === "color") {
    const rank = (value: string | null | undefined) => value?.trim().toLowerCase() === "red" ? 1
      : value?.trim().toLowerCase() === "yellow" ? 2 : 50;
    return rank(left.color) - rank(right.color)
      || (left.color ?? "").localeCompare(right.color ?? "", undefined, { sensitivity: "base" });
  }
  if (field === "person_in_charge") {
    return left.person_in_charge_name.localeCompare(right.person_in_charge_name, undefined, { numeric: true, sensitivity: "base" })
      || left.person_in_charge_user_id.localeCompare(right.person_in_charge_user_id);
  }
  return (left.completion_due_date ?? "").localeCompare(right.completion_due_date ?? "");
}

function arrangeFieldMissing(item: MyWorkActionItem, field: HuddleActionItemArrangeField): boolean {
  if (field === "color") return !(item.color?.trim());
  if (field === "person_in_charge") return !(item.person_in_charge_user_id?.trim());
  return !(item.completion_due_date?.trim());
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

function companyUserLabel(userID: string, companyUsers: ReadonlyArray<CompanyUser>, emptyLabel: string): string {
  if (!userID) return emptyLabel;
  const user = companyUsers.find((candidate) => candidate.user_id === userID);
  return user?.display_name?.trim() || user?.email?.trim() || userID;
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
  const envelope = document && typeof document === "object" ? document as { document?: unknown } : undefined;
  visit(envelope?.document ?? document);
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
  if (event.type === "removed") return { state: undefined, refresh: true };
  if (event.type === "snapshot") {
    if (!state) return { state: { signature: event.signature, notifiedSignature: event.signature, dirty: false }, refresh: false };
    if (event.signature === state.signature) return { state, refresh: false };
    return { state: { ...state, signature: event.signature, dirty: true }, refresh: false };
  }
  if (event.type === "canonical") {
    if (!state) return { state: { signature: event.signature, notifiedSignature: event.signature, dirty: false }, refresh: false };
    const refresh = state.notifiedSignature !== event.signature;
    if (state.dirty && event.signature !== state.signature) {
      return { state: { ...state, notifiedSignature: event.signature }, refresh };
    }
    return { state: { signature: event.signature, notifiedSignature: event.signature, dirty: false }, refresh };
  }
  if (!state?.dirty) return { state, refresh: false };
  const refresh = state.notifiedSignature !== state.signature;
  return { state: { ...state, notifiedSignature: state.signature, dirty: false }, refresh };
}
