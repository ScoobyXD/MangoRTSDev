import type { EntityField } from "../fields/entityFieldsApi.js";
import type { UniversalGroupingSetting } from "../grouping/universalGrouping.js";

export type ProjectListBuiltInGroupingField = "account" | "team" | "status" | "health" | "created_month" | "updated_month";
export type ProjectListGroupingField = ProjectListBuiltInGroupingField | `field:${string}`;

export const PROJECT_LIST_GROUPING_FIELDS: ReadonlyArray<{ value: ProjectListBuiltInGroupingField; label: string }> = [
  { value: "account", label: "Account" },
  { value: "team", label: "Team" },
  { value: "status", label: "Status" },
  { value: "health", label: "Health" },
  { value: "created_month", label: "Date created" },
  { value: "updated_month", label: "Date updated" },
];

export function projectListGroupingFields(fields: ReadonlyArray<EntityField>): Array<{ value: ProjectListGroupingField; label: string }> {
  return [
    ...PROJECT_LIST_GROUPING_FIELDS,
    ...fields.map((field) => ({ value: entityFieldGroupingValue(field.field_id), label: `Field: ${field.name}` })),
  ];
}

export function entityFieldGroupingValue(fieldID: string): `field:${string}` {
  return `field:${fieldID}`;
}

export function entityFieldIDFromGrouping(field: ProjectListGroupingField): string {
  return field.startsWith("field:") ? field.slice("field:".length).trim() : "";
}

export function normalizeProjectListGroupings(value: unknown): Array<UniversalGroupingSetting<ProjectListGroupingField>> {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(PROJECT_LIST_GROUPING_FIELDS.map((field) => field.value));
  const seen = new Set<ProjectListGroupingField>();
  const result: Array<UniversalGroupingSetting<ProjectListGroupingField>> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const field = String((item as { field?: unknown }).field ?? "") as ProjectListGroupingField;
    const dynamicFieldID = entityFieldIDFromGrouping(field);
    if ((!allowed.has(field as ProjectListBuiltInGroupingField) && !dynamicFieldID) || seen.has(field)) continue;
    seen.add(field);
    result.push({ field, direction: (item as { direction?: unknown }).direction === "desc" ? "desc" : "asc" });
  }
  return result;
}
