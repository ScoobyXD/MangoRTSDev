import type { UniversalGroupingSetting } from "../grouping/universalGrouping.js";
import type { ProjectRecord } from "./projectManagementApi.js";

export type ProjectListBuiltInGroupingField = "account" | "team" | "status" | "health" | "created_month" | "updated_month";
export type ProjectListGroupingField = ProjectListBuiltInGroupingField;

export const PROJECT_LIST_FILTER_UNASSIGNED = "__unassigned" as const;

export type ProjectListFilters = {
  nameQuery: string;
  accountIDs: string[];
  teamIDs: string[];
  statuses: string[];
  healthValues: string[];
  createdFrom: string;
  createdTo: string;
  updatedFrom: string;
  updatedTo: string;
};

export const PROJECT_LIST_GROUPING_FIELDS: ReadonlyArray<{ value: ProjectListBuiltInGroupingField; label: string }> = [
  { value: "account", label: "Account" },
  { value: "team", label: "Team" },
  { value: "status", label: "Status" },
  { value: "health", label: "Health" },
  { value: "created_month", label: "Date created" },
  { value: "updated_month", label: "Date updated" },
];

export function projectListGroupingFields(): Array<{ value: ProjectListGroupingField; label: string }> {
  return [...PROJECT_LIST_GROUPING_FIELDS];
}

export function activeProjectListGroupings(
  groupings: ReadonlyArray<UniversalGroupingSetting<ProjectListGroupingField>>,
): Array<UniversalGroupingSetting<ProjectListGroupingField>> {
  return normalizeProjectListGroupings(groupings);
}

export function normalizeProjectListGroupings(value: unknown): Array<UniversalGroupingSetting<ProjectListGroupingField>> {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<ProjectListGroupingField>(PROJECT_LIST_GROUPING_FIELDS.map((field) => field.value));
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

export function createEmptyProjectListFilters(): ProjectListFilters {
  return {
    nameQuery: "",
    accountIDs: [],
    teamIDs: [],
    statuses: [],
    healthValues: [],
    createdFrom: "",
    createdTo: "",
    updatedFrom: "",
    updatedTo: "",
  };
}

export function hasActiveProjectListFilters(filters: ProjectListFilters): boolean {
  return Boolean(
    filters.nameQuery.trim()
    || cleanFilterDate(filters.createdFrom)
    || cleanFilterDate(filters.createdTo)
    || cleanFilterDate(filters.updatedFrom)
    || cleanFilterDate(filters.updatedTo)
    || filters.accountIDs.some((value) => value.trim())
    || filters.teamIDs.some((value) => value.trim())
    || filters.statuses.some((value) => value.trim())
    || filters.healthValues.some((value) => value.trim()),
  );
}

export function filterProjectsForList(projects: ProjectRecord[], filters: ProjectListFilters): ProjectRecord[] {
  if (!hasActiveProjectListFilters(filters)) return projects;
  return projects.filter((project) => projectMatchesProjectListFilters(project, filters));
}

export function projectMatchesProjectListFilters(project: ProjectRecord, filters: ProjectListFilters): boolean {
  const nameQuery = filters.nameQuery.trim().toLocaleLowerCase();
  if (nameQuery && !project.name.toLocaleLowerCase().includes(nameQuery)) return false;
  if (!matchesAssignmentFilter(project.accounts?.map((account) => account.account_id) ?? [], filters.accountIDs)) return false;
  if (!matchesAssignmentFilter(project.teams?.map((team) => team.group_id) ?? [], filters.teamIDs)) return false;
  if (!matchesSingleValueFilter(project.status.trim() || "Active", filters.statuses)) return false;
  if (!matchesSingleValueFilter(project.health?.trim() || "On Track", filters.healthValues)) return false;
  if (!matchesDateRange(project.created_timestamp, filters.createdFrom, filters.createdTo)) return false;
  return matchesDateRange(project.updated_timestamp, filters.updatedFrom, filters.updatedTo);
}

function matchesAssignmentFilter(assignedValues: string[], selectedValues: string[]): boolean {
  const selected = cleanFilterValues(selectedValues);
  if (selected.size === 0) return true;
  const assigned = Array.from(new Set(assignedValues.map((value) => value.trim()).filter(Boolean)));
  if (assigned.length === 0) return selected.has(PROJECT_LIST_FILTER_UNASSIGNED);
  return assigned.some((value) => selected.has(value));
}

function matchesSingleValueFilter(value: string, selectedValues: string[]): boolean {
  const selected = cleanFilterValues(selectedValues);
  return selected.size === 0 || selected.has(value.trim());
}

function cleanFilterValues(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim()).filter(Boolean));
}

function matchesDateRange(timestamp: string, fromValue: string, toValue: string): boolean {
  const from = cleanFilterDate(fromValue);
  const to = cleanFilterDate(toValue);
  if (!from && !to) return true;
  const date = localDateKey(timestamp);
  if (!date) return false;
  return (!from || date >= from) && (!to || date <= to);
}

function cleanFilterDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? `${match[1]}-${match[2]}-${match[3]}`
    : "";
}

function localDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
