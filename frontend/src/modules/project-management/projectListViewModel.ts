import type { UniversalGroupingSetting } from "../grouping/universalGrouping.js";

export type ProjectListGroupingField = "account" | "team" | "status" | "health" | "created_month" | "updated_month";

export const PROJECT_LIST_GROUPING_FIELDS: ReadonlyArray<{ value: ProjectListGroupingField; label: string }> = [
  { value: "account", label: "Account" },
  { value: "team", label: "Team" },
  { value: "status", label: "Status" },
  { value: "health", label: "Health" },
  { value: "created_month", label: "Date created" },
  { value: "updated_month", label: "Date updated" },
];

export function normalizeProjectListGroupings(value: unknown): Array<UniversalGroupingSetting<ProjectListGroupingField>> {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(PROJECT_LIST_GROUPING_FIELDS.map((field) => field.value));
  const seen = new Set<ProjectListGroupingField>();
  const result: Array<UniversalGroupingSetting<ProjectListGroupingField>> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const field = String((item as { field?: unknown }).field ?? "") as ProjectListGroupingField;
    if (!allowed.has(field) || seen.has(field)) continue;
    seen.add(field);
    result.push({ field, direction: (item as { direction?: unknown }).direction === "desc" ? "desc" : "asc" });
  }
  return result;
}
