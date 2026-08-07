export type UpdateGroupingField = "type" | "date" | "gvic" | "priority" | "project" | "logic_gate" | "status";
export type UpdateGroupingDirection = "asc" | "desc";
export type UpdateGroupingSetting = {
  field: UpdateGroupingField;
  direction: UpdateGroupingDirection;
};

export const UPDATE_GROUPING_FIELDS: ReadonlyArray<{ value: UpdateGroupingField; label: string }> = [
  { value: "type", label: "Update Type" },
  { value: "date", label: "Date" },
  { value: "gvic", label: "RACI" },
  { value: "priority", label: "Priority" },
  { value: "project", label: "Project" },
  { value: "logic_gate", label: "Logic Gate" },
  { value: "status", label: "Status" },
];

export const DEFAULT_UPDATE_GROUPINGS: UpdateGroupingSetting[] = [
  { field: "date", direction: "desc" },
  { field: "gvic", direction: "asc" },
  { field: "priority", direction: "asc" },
  { field: "logic_gate", direction: "asc" },
];

export function resolveUpdatePriorityGroupOrder(priority: number | null | undefined): { sortValue: number; sortLast?: true } {
  const normalized = typeof priority === "number" && Number.isFinite(priority) ? Math.round(priority) : 0;
  if (normalized >= 1 && normalized <= 5) return { sortValue: normalized };
  return { sortValue: 99, sortLast: true };
}

const UPDATE_GROUPING_FIELD_SET = new Set<UpdateGroupingField>(UPDATE_GROUPING_FIELDS.map((field) => field.value));

export function normalizeUpdateGroupingStack(value: unknown): UpdateGroupingSetting[] {
  if (!Array.isArray(value)) return DEFAULT_UPDATE_GROUPINGS.map((grouping) => ({ ...grouping }));
  const out: UpdateGroupingSetting[] = [];
  const seen = new Set<UpdateGroupingField>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as { field?: unknown; direction?: unknown };
    if (typeof candidate.field !== "string" || !UPDATE_GROUPING_FIELD_SET.has(candidate.field as UpdateGroupingField)) continue;
    const field = candidate.field as UpdateGroupingField;
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({ field, direction: candidate.direction === "desc" ? "desc" : "asc" });
  }
  return out;
}

export function withBuiltInUpdateGroupingSetting<T extends { setting_id: string }>(builtIn: T, custom: readonly T[]): T[] {
  return [builtIn, ...custom.filter((setting) => setting.setting_id !== builtIn.setting_id)];
}

export function resolveUpdateSelectedSettingID<T extends { setting_id: string }>(
  settings: readonly T[],
  builtInSettingID: string,
  preferredSettingID: string,
): string {
  const cleanBuiltInSettingID = builtInSettingID.trim();
  const cleanPreferredSettingID = preferredSettingID.trim();
  if (cleanPreferredSettingID && settings.some((setting) => setting.setting_id === cleanPreferredSettingID)) {
    return cleanPreferredSettingID;
  }
  return settings.find((setting) => setting.setting_id && setting.setting_id !== cleanBuiltInSettingID)?.setting_id
    ?? settings.find((setting) => setting.setting_id === cleanBuiltInSettingID)?.setting_id
    ?? settings[0]?.setting_id
    ?? "";
}

export function sortUpdateItemsNewestFirst<T>(
  items: readonly T[],
  getTimestamp: (item: T) => string,
  getTieBreaker: (item: T) => string,
): T[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(getTimestamp(left));
    const rightTime = Date.parse(getTimestamp(right));
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
    if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) return Number.isFinite(leftTime) ? -1 : 1;
    return getTieBreaker(left).localeCompare(getTieBreaker(right), undefined, { numeric: true, sensitivity: "base" });
  });
}
