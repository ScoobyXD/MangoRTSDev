import type { EntityField } from "../fields/entityFieldsApi.js";
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
  { value: PROJECT_LIST_FIELD_GROUPING, label: "Field" },
];

export function projectListGroupingFields(): Array<{ value: ProjectListGroupingField; label: string }> {
  return [...PROJECT_LIST_GROUPING_FIELDS];
}

export function projectListSpecificFieldGroupingOptions(fields: ReadonlyArray<EntityField>): Array<{ value: ProjectListGroupingField; label: string }> {
  return fields.map((field) => ({ value: entityFieldGroupingValue(field.field_id), label: field.name }));
}

export function entityFieldGroupingValue(fieldID: string): `field:${string}` {
  return `field:${fieldID}`;
}

export function entityFieldIDFromGrouping(field: ProjectListGroupingField): string {
  return field.startsWith("field:") ? field.slice("field:".length).trim() : "";
}

export function isProjectListFieldGrouping(field: ProjectListGroupingField): boolean {
  return field === PROJECT_LIST_FIELD_GROUPING || Boolean(entityFieldIDFromGrouping(field));
}

export function activeProjectListGroupings(
  groupings: ReadonlyArray<UniversalGroupingSetting<ProjectListGroupingField>>,
): Array<UniversalGroupingSetting<ProjectListGroupingField>> {
  return groupings
    .filter((grouping) => grouping.field !== PROJECT_LIST_FIELD_GROUPING)
    .map((grouping) => ({ field: grouping.field, direction: grouping.direction }));
}

export function normalizeProjectListGroupings(value: unknown): Array<UniversalGroupingSetting<ProjectListGroupingField>> {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<ProjectListGroupingField>(PROJECT_LIST_GROUPING_FIELDS.map((field) => field.value));
  const seen = new Set<ProjectListGroupingField>();
  const result: Array<UniversalGroupingSetting<ProjectListGroupingField>> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const field = String((item as { field?: unknown }).field ?? "") as ProjectListGroupingField;
    const dynamicFieldID = entityFieldIDFromGrouping(field);
    if ((!allowed.has(field) && !dynamicFieldID) || seen.has(field)) continue;
    seen.add(field);
    result.push({ field, direction: (item as { direction?: unknown }).direction === "desc" ? "desc" : "asc" });
  }
  return result;
}
