import type { Account } from "../../modules/accounts/accountsApi.js";
import type { LogicGateGVICRole } from "../../modules/logic-gate-map/shared.js";
import { buildUniversalNestedGroups, computeUniversalDefaultExpandedGroupIDs, type UniversalGroupValue, type UniversalNestedGroup } from "./universalGrouping.js";

export type MyWorkScopeLevel = "me" | "team" | "all";
export type MyWorkScopeSubjectType = "user" | "group" | "company";

export type MyWorkSelectedScope = {
  level: MyWorkScopeLevel;
  subject_type: MyWorkScopeSubjectType;
  subject_id: string;
};

export type MyWorkGroupingField =
  | "account"
  | "due_date"
  | "logic_gate"
  | "person"
  | "project"
  | "status"
  | "team";

export type MyWorkGroupingDirection = "asc" | "desc";

export type MyWorkGroupingSetting = {
  field: MyWorkGroupingField;
  direction: MyWorkGroupingDirection;
};

export type MyWorkSavedViewPrincipal = "user" | "group";

export type MyWorkSavedGroupingSetting = {
  setting_id: string;
  company_id: string;
  user_id: string;
  surface: "my_work";
  principal: MyWorkSavedViewPrincipal;
  principal_id: string;
  name: string;
  selected_scope: MyWorkSelectedScope;
  groupings: MyWorkGroupingSetting[];
  panel_collapsed: boolean;
  created_timestamp: string;
  updated_timestamp: string;
};

export type MyWorkResourceKind = "project" | "node" | "logic_gate";

export type MyWorkPerson = {
  userID: string;
  label: string;
};

export type MyWorkTeam = {
  groupID: string;
  label: string;
};

export type MyWorkResourceRow = {
  rowKey?: string;
  companyID?: string;
  kind: MyWorkResourceKind;
  id: string;
  title: string;
  status?: string | null;
  dueDate?: string | null;
  priority?: number | null;
  accounts?: Account[];
  projectLabels?: string[];
  people: MyWorkPerson[];
  teams: MyWorkTeam[];
  gvicRoles: LogicGateGVICRole[];
  primaryGVICRole?: LogicGateGVICRole;
  participantUserIDs: string[];
  projectID?: string;
  projectName?: string;
  logicGateLabels: string[];
  logicGateIDs: string[];
  nodeLeafID?: string;
  depth?: number;
  sortOrder?: number;
};

export type MyWorkGroupValue = UniversalGroupValue;

export type MyWorkNestedGroup = UniversalNestedGroup<MyWorkResourceRow, MyWorkGroupingField>;

export const MY_WORK_GROUPING_FIELDS: ReadonlyArray<{ value: MyWorkGroupingField; label: string }> = [
  { value: "account", label: "Account" },
  { value: "due_date", label: "Date / Due Date" },
  { value: "logic_gate", label: "Logic Gate" },
  { value: "person", label: "Person" },
  { value: "project", label: "Project" },
  { value: "status", label: "Status" },
  { value: "team", label: "Team" },
];

export const DEFAULT_MY_WORK_GROUPINGS: MyWorkGroupingSetting[] = [
  { field: "project", direction: "asc" },
];

const MY_WORK_GROUPING_FIELD_SET = new Set<MyWorkGroupingField>(MY_WORK_GROUPING_FIELDS.map((field) => field.value));

export function myWorkGroupingFieldLabel(field: MyWorkGroupingField): string {
  return MY_WORK_GROUPING_FIELDS.find((item) => item.value === field)?.label ?? "Field";
}

export function defaultMyWorkSelectedScope(currentUserID: string): MyWorkSelectedScope {
  return {
    level: "me",
    subject_type: "user",
    subject_id: currentUserID.trim(),
  };
}

export function normalizeMyWorkSelectedScope(value: unknown, currentUserID: string): MyWorkSelectedScope {
  const fallback = defaultMyWorkSelectedScope(currentUserID);
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as { level?: unknown; subject_type?: unknown; subject_id?: unknown };
  const level = candidate.level === "team" || candidate.level === "all" || candidate.level === "me" ? candidate.level : fallback.level;
  const subjectType = candidate.subject_type === "group" || candidate.subject_type === "company" || candidate.subject_type === "user" ? candidate.subject_type : fallback.subject_type;
  const subjectID = typeof candidate.subject_id === "string" && candidate.subject_id.trim() ? candidate.subject_id.trim() : fallback.subject_id;
  if (level === "me" && subjectType !== "user") return fallback;
  if (level === "team" && subjectType === "company") return { ...fallback, level: "team" };
  if (level === "all" && subjectType === "company") return { level, subject_type: "company", subject_id: subjectID || "company" };
  return { level, subject_type: subjectType, subject_id: subjectID };
}

export function normalizeMyWorkGroupingStack(value: unknown): MyWorkGroupingSetting[] {
  if (!Array.isArray(value)) return [...DEFAULT_MY_WORK_GROUPINGS];
  const out: MyWorkGroupingSetting[] = [];
  const seen = new Set<MyWorkGroupingField>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as { field?: unknown; direction?: unknown };
    if (typeof candidate.field !== "string" || !MY_WORK_GROUPING_FIELD_SET.has(candidate.field as MyWorkGroupingField)) continue;
    const field = candidate.field as MyWorkGroupingField;
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({
      field,
      direction: candidate.direction === "desc" ? "desc" : "asc",
    });
  }
  return out;
}

export function normalizeMyWorkSavedGroupingSetting(
  value: unknown,
  fallback: MyWorkSavedGroupingSetting,
  currentUserID: string,
): MyWorkSavedGroupingSetting {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<MyWorkSavedGroupingSetting>;
  const settingID = typeof candidate.setting_id === "string" && candidate.setting_id.trim() ? candidate.setting_id.trim() : fallback.setting_id;
  const name = typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : fallback.name;
  const created = typeof candidate.created_timestamp === "string" && candidate.created_timestamp.trim() ? candidate.created_timestamp : fallback.created_timestamp;
  const updated = typeof candidate.updated_timestamp === "string" && candidate.updated_timestamp.trim() ? candidate.updated_timestamp : fallback.updated_timestamp;
  return {
    setting_id: settingID,
    company_id: fallback.company_id,
    user_id: fallback.user_id,
    surface: "my_work",
    principal: candidate.principal === "group" ? "group" : "user",
    principal_id: normalizeMyWorkSavedViewPrincipalID(candidate.principal_id, candidate.principal, fallback, currentUserID),
    name,
    selected_scope: normalizeMyWorkSelectedScope(candidate.selected_scope, currentUserID),
    groupings: normalizeMyWorkGroupingStack(candidate.groupings),
    panel_collapsed: candidate.panel_collapsed === true,
    created_timestamp: created,
    updated_timestamp: updated,
  };
}

export function normalizeMyWorkSavedGroupingSettings(
  value: unknown,
  fallback: MyWorkSavedGroupingSetting,
  currentUserID: string,
): MyWorkSavedGroupingSetting[] {
  if (!Array.isArray(value)) return [fallback];
  const out: MyWorkSavedGroupingSetting[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizeMyWorkSavedGroupingSetting(item, fallback, currentUserID);
    if (!normalized.setting_id || seen.has(normalized.setting_id)) continue;
    seen.add(normalized.setting_id);
    out.push(normalized);
  }
  return out.length > 0 ? out : [fallback];
}

function normalizeMyWorkSavedViewPrincipalID(
  value: unknown,
  principal: unknown,
  fallback: MyWorkSavedGroupingSetting,
  currentUserID: string,
): string {
  const clean = typeof value === "string" ? value.trim() : "";
  if (clean) return clean;
  if (principal === "group") return fallback.principal === "group" ? fallback.principal_id : "";
  return currentUserID.trim() || fallback.principal_id;
}

export function getMyWorkGroupValues(row: MyWorkResourceRow, field: MyWorkGroupingField): MyWorkGroupValue[] {
  if (field === "account") {
    const accounts = (row.accounts ?? []).filter((account) => account.account_id?.trim());
    if (accounts.length === 0) return [{ key: "account:none", label: "No account", sortValue: "", sortLast: true }];
    return accounts.map((account) => {
      const label = account.name?.trim() || account.account_id;
      return { key: `account:${account.account_id}`, label, sortValue: label.toLowerCase() };
    });
  }

  if (field === "due_date") {
    const dueDate = row.dueDate?.trim() ?? "";
    return [dueDate ? { key: `due:${dueDate}`, label: dueDate, sortValue: dueDate } : { key: "due:none", label: "No due date", sortValue: "", sortLast: true }];
  }

  if (field === "person") {
    if (row.people.length === 0) return [{ key: "person:unassigned", label: "Unassigned", sortValue: "", sortLast: true }];
    return row.people.map((person) => ({
      key: `person:${person.userID}`,
      label: person.label,
      sortValue: person.label.toLowerCase(),
    }));
  }

  if (field === "project") {
    const projects = (row.projectLabels ?? []).map((label) => label.trim()).filter(Boolean);
    if (projects.length === 0) return [{ key: "project:none", label: "No project", sortValue: "", sortLast: true }];
    return projects.map((label) => ({ key: `project:${label.toLowerCase()}`, label, sortValue: label.toLowerCase() }));
  }

  if (field === "logic_gate") {
    const logicGates = (row.logicGateLabels ?? []).map((label) => label.trim()).filter(Boolean);
    if (logicGates.length === 0) return [{ key: "logic_gate:none", label: "No logic gate", sortValue: "", sortLast: true }];
    return logicGates.map((label) => ({ key: `logic_gate:${label.toLowerCase()}`, label, sortValue: label.toLowerCase() }));
  }

  if (field === "status") {
    const status = row.status?.trim() ?? "";
    if (!status) return [{ key: "status:none", label: "No status", sortValue: "", sortLast: true }];
    return [{ key: `status:${normalizeStatus(status)}`, label: statusLabel(status), sortValue: statusSortValue(status) }];
  }

  if (row.teams.length === 0) return [{ key: "team:none", label: "No team", sortValue: "", sortLast: true }];
  return row.teams.map((team) => ({ key: `team:${team.groupID}`, label: team.label, sortValue: team.label.toLowerCase() }));
}

export function buildNestedGroups(
  rows: MyWorkResourceRow[],
  groupings: MyWorkGroupingSetting[],
  getValues: (row: MyWorkResourceRow, field: MyWorkGroupingField) => MyWorkGroupValue[] = getMyWorkGroupValues,
): MyWorkNestedGroup[] {
  const cleanGroupings = normalizeMyWorkGroupingStack(groupings);
  return buildUniversalNestedGroups(rows, cleanGroupings, {
    rootID: "my-work",
    rowKey: (row) => row.rowKey ?? `${row.kind}:${row.id}`,
    getValues,
    sortRows: sortMyWorkRows,
  });
}

export function sortGroups<T extends MyWorkGroupValue>(groups: T[], direction: MyWorkGroupingDirection): T[] {
  const regular = groups.filter((group) => !group.sortLast).sort(compareGroupValues);
  const trailing = groups.filter((group) => group.sortLast).sort(compareGroupValues);
  return direction === "desc" ? [...regular.reverse(), ...trailing] : [...regular, ...trailing];
}

export function computeDefaultExpandedGroupIDs(groups: MyWorkNestedGroup[]): Set<string> {
  return computeUniversalDefaultExpandedGroupIDs(groups);
}

export function computeAllExpandedGroupIDs(groups: MyWorkNestedGroup[]): Set<string> {
  const expanded = new Set<string>();
  const visit = (group: MyWorkNestedGroup) => {
    expanded.add(group.id);
    for (const child of group.groups) visit(child);
  };
  for (const group of groups) visit(group);
  return expanded;
}

export function myWorkCellGroupStateID(cellKey: string, groupID: string): string {
  return `${cellKey.trim() || "cell"}/${groupID}`;
}

export function computeAllExpandedCellGroupIDs(cellGroups: Iterable<{ cellKey: string; groups: MyWorkNestedGroup[] }>): Set<string> {
  const expanded = new Set<string>();
  const visit = (cellKey: string, group: MyWorkNestedGroup) => {
    expanded.add(myWorkCellGroupStateID(cellKey, group.id));
    for (const child of group.groups) visit(cellKey, child);
  };
  for (const item of cellGroups) {
    for (const group of item.groups) visit(item.cellKey, group);
  }
  return expanded;
}

export function applyManualExpandedState(defaultExpanded: Set<string>, manualState: Record<string, boolean>): Set<string> {
  const expanded = new Set(defaultExpanded);
  for (const [id, open] of Object.entries(manualState)) {
    if (open) expanded.add(id);
    else expanded.delete(id);
  }
  return expanded;
}

export function sortMyWorkRows(rows: MyWorkResourceRow[]): MyWorkResourceRow[] {
  return [...rows].sort((left, right) => {
    const leftSortOrder = Number.isFinite(Number(left.sortOrder)) && Number(left.sortOrder) > 0 ? Number(left.sortOrder) : Number.MAX_SAFE_INTEGER;
    const rightSortOrder = Number.isFinite(Number(right.sortOrder)) && Number(right.sortOrder) > 0 ? Number(right.sortOrder) : Number.MAX_SAFE_INTEGER;
    const leftPriority = Number.isFinite(Number(left.priority)) && Number(left.priority) > 0 ? Number(left.priority) : Number.MAX_SAFE_INTEGER;
    const rightPriority = Number.isFinite(Number(right.priority)) && Number(right.priority) > 0 ? Number(right.priority) : Number.MAX_SAFE_INTEGER;
    return leftSortOrder - rightSortOrder
      || leftPriority - rightPriority
      || dueDateSortValue(left.dueDate) - dueDateSortValue(right.dueDate)
      || Number(left.depth ?? 0) - Number(right.depth ?? 0)
      || myWorkKindSort(left.kind) - myWorkKindSort(right.kind)
      || left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" })
      || left.kind.localeCompare(right.kind)
      || left.id.localeCompare(right.id);
  });
}

function myWorkKindSort(kind: MyWorkResourceKind): number {
  if (kind === "project") return 1;
  if (kind === "logic_gate") return 2;
  return 3;
}

export function priorityLabel(priority: number): string {
  if (priority === 1) return "1 URGENT(<1hr)";
  if (priority === 2) return "2 By end of day";
  if (priority === 3) return "3 Tomorrow";
  if (priority === 4) return "4 Sprint (1 week)";
  if (priority === 5) return "5 Later (low priority)";
  return "No priority";
}

export function GVICRoleLabel(role: LogicGateGVICRole): string {
  if (role === "generated") return "Generated";
  if (role === "verified") return "Verified";
  if (role === "consulted") return "Consulted";
  return "Informed";
}

export function normalizeStatus(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "_");
}

function statusLabel(value: string): string {
  const normalized = normalizeStatus(value);
  if (normalized === "in_progress") return "In Progress";
  if (normalized === "pending") return "Pending";
  if (normalized === "review") return "Review";
  if (normalized === "done") return "Done";
  return value.trim().replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusSortValue(value: string): number | string {
  const normalized = normalizeStatus(value);
  if (normalized === "pending") return 1;
  if (normalized === "in_progress") return 2;
  if (normalized === "review") return 3;
  if (normalized === "done") return 4;
  return normalized;
}

function compareGroupValues(left: MyWorkGroupValue, right: MyWorkGroupValue): number {
  if (typeof left.sortValue === "number" && typeof right.sortValue === "number") {
    return left.sortValue - right.sortValue
      || left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" })
      || left.key.localeCompare(right.key);
  }
  return String(left.sortValue).localeCompare(String(right.sortValue), undefined, { numeric: true, sensitivity: "base" })
    || left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" })
    || left.key.localeCompare(right.key);
}

function parseDateOnly(value: string | null | undefined): Date | null {
  const clean = value?.trim().slice(0, 10) ?? "";
  if (!clean) return null;
  const date = new Date(`${clean}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dueDateSortValue(value: string | null | undefined): number {
  return parseDateOnly(value)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}
