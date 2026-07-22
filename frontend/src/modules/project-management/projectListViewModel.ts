import type { UniversalGroupingSetting } from "../grouping/universalGrouping.js";

export type ProjectListBuiltInGroupingField = "account" | "team" | "status" | "health" | "created_month" | "updated_month";
export const PROJECT_LIST_FIELD_COLUMN_PLACEHOLDER = "__field_column__" as const;
export const PROJECT_LIST_FIELD_GROUPING = "field" as const;
export type ProjectListGroupingField = ProjectListBuiltInGroupingField | typeof PROJECT_LIST_FIELD_GROUPING | `field:${string}`;

export const PROJECT_LIST_GROUPING_FIELDS: ReadonlyArray<{ value: ProjectListBuiltInGroupingField | typeof PROJECT_LIST_FIELD_GROUPING; label: string }> = [
  { value: "account", label: "Account" },
  { value: "team", label: "Team" },
  { value: "status", label: "Status" },
  { value: "health", label: "Health" },
  { value: "created_month", label: "Date created" },
  { value: "updated_month", label: "Date updated" },
  { value: PROJECT_LIST_FIELD_GROUPING, label: "Group by Fields" },
];

export function projectListGroupingFields(): Array<{ value: ProjectListGroupingField; label: string }> {
  return [...PROJECT_LIST_GROUPING_FIELDS];
}

export function entityFieldGroupingValue(fieldID: string): `field:${string}` {
  return `field:${fieldID}`;
}

export function entityFieldIDFromGrouping(field: ProjectListGroupingField): string {
  return field.startsWith("field:") ? field.slice("field:".length).trim() : "";
}

export function activeProjectListGroupings(
  groupings: ReadonlyArray<UniversalGroupingSetting<ProjectListGroupingField>>,
): Array<UniversalGroupingSetting<ProjectListGroupingField>> {
  return normalizeProjectListGroupings(groupings);
}

export function normalizeProjectListFieldColumns(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.some((item) => String(item ?? "").trim()) ? [PROJECT_LIST_FIELD_COLUMN_PLACEHOLDER] : [];
}

export function normalizeProjectListGroupings(value: unknown): Array<UniversalGroupingSetting<ProjectListGroupingField>> {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<ProjectListGroupingField>(PROJECT_LIST_GROUPING_FIELDS.map((field) => field.value));
  const seen = new Set<ProjectListGroupingField>();
  const result: Array<UniversalGroupingSetting<ProjectListGroupingField>> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const storedField = String((item as { field?: unknown }).field ?? "") as ProjectListGroupingField;
    const field = entityFieldIDFromGrouping(storedField) ? PROJECT_LIST_FIELD_GROUPING : storedField;
    if (!allowed.has(field) || seen.has(field)) continue;
    seen.add(field);
    result.push({ field, direction: (item as { direction?: unknown }).direction === "desc" ? "desc" : "asc" });
  }
  return result;
}
