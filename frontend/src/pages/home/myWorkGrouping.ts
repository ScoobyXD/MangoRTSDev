import type { Account } from "../../modules/accounts/accountsApi.js";
import type { LogicGateRaciRole } from "../../modules/logic-gate-map/shared.js";

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
  | "person"
  | "priority"
  | "project"
  | "racio"
  | "status"
  | "team";

export type MyWorkGroupingDirection = "asc" | "desc";

export type MyWorkGroupingSetting = {
  field: MyWorkGroupingField;
  direction: MyWorkGroupingDirection;
};

export type MyWorkSavedGroupingSetting = {
  setting_id: string;
  company_id: string;
  user_id: string;
  surface: "my_work";
  name: string;
  selected_scope: MyWorkSelectedScope;
  groupings: MyWorkGroupingSetting[];
  panel_collapsed: boolean;
  created_timestamp: string;
  updated_timestamp: string;
};

export type MyWorkResourceKind = "node" | "logic_gate";

export type MyWorkPerson = {
  userID: string;
  label: string;
};

export type MyWorkTeam = {
  groupID: string;
  label: string;
};

export type MyWorkResourceRow = {
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
  raciRoles: LogicGateRaciRole[];
  participantUserIDs: string[];
  logicGateLabels: string[];
};

export type MyWorkGroupValue = {
  key: string;
  label: string;
  sortValue: string | number;
  sortLast?: boolean;
};

export type MyWorkNestedGroup = MyWorkGroupValue & {
  id: string;
  field: MyWorkGroupingField;
  depth: number;
  groups: MyWorkNestedGroup[];
  rows: MyWorkResourceRow[];
};

export const MY_WORK_GROUPING_FIELDS: ReadonlyArray<{ value: MyWorkGroupingField; label: string }> = [
  { value: "account", label: "Account" },
  { value: "due_date", label: "Date / Due Date" },
  { value: "person", label: "Person" },
  { value: "priority", label: "Priority" },
  { value: "project", label: "Project" },
  { value: "racio", label: "RACIO" },
  { value: "status", label: "Status" },
  { value: "team", label: "Team" },
];

export const DEFAULT_MY_WORK_GROUPINGS: MyWorkGroupingSetting[] = [
  { field: "racio", direction: "asc" },
  { field: "priority", direction: "asc" },
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
  return out.length > 0 ? out : [...DEFAULT_MY_WORK_GROUPINGS];
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

  if (field === "priority") {
    const priority = Number(row.priority);
    if (!Number.isFinite(priority) || priority <= 0) return [{ key: "priority:none", label: "No priority", sortValue: Number.MAX_SAFE_INTEGER, sortLast: true }];
    const normalized = Math.max(1, Math.min(5, Math.round(priority)));
    return [{ key: `priority:${normalized}`, label: priorityLabel(normalized), sortValue: normalized }];
  }

  if (field === "project") {
    const projects = (row.projectLabels ?? []).map((label) => label.trim()).filter(Boolean);
    if (projects.length === 0) return [{ key: "project:none", label: "No project", sortValue: "", sortLast: true }];
    return projects.map((label) => ({ key: `project:${label.toLowerCase()}`, label, sortValue: label.toLowerCase() }));
  }

  if (field === "racio") {
    if (row.raciRoles.length === 0) return [{ key: "racio:none", label: "No RACIO", sortValue: "", sortLast: true }];
    return row.raciRoles.map((role) => ({ key: `racio:${role}`, label: raciRoleLabel(role), sortValue: raciRoleSort(role) }));
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
  return buildNestedGroupLevel(rows, cleanGroupings, 0, "my-work", getValues);
}

function buildNestedGroupLevel(
  rows: MyWorkResourceRow[],
  groupings: MyWorkGroupingSetting[],
  depth: number,
  parentID: string,
  getValues: (row: MyWorkResourceRow, field: MyWorkGroupingField) => MyWorkGroupValue[],
): MyWorkNestedGroup[] {
  const grouping = groupings[depth];
  if (!grouping) return [];
  const byKey = new Map<string, MyWorkGroupValue & { rows: MyWorkResourceRow[] }>();
  for (const row of rows) {
    const seenValues = new Set<string>();
    for (const value of getValues(row, grouping.field)) {
      if (seenValues.has(value.key)) continue;
      seenValues.add(value.key);
      const existing = byKey.get(value.key) ?? { ...value, rows: [] };
      if (!existing.rows.some((item) => item.kind === row.kind && item.id === row.id)) existing.rows.push(row);
      byKey.set(value.key, existing);
    }
  }
  return sortGroups(Array.from(byKey.values()), grouping.direction).map((group) => {
    const id = `${parentID}/${grouping.field}:${group.key}`;
    return {
      key: group.key,
      label: group.label,
      sortValue: group.sortValue,
      sortLast: group.sortLast,
      id,
      field: grouping.field,
      depth,
      rows: groupings[depth + 1] ? [] : sortMyWorkRows(group.rows),
      groups: buildNestedGroupLevel(group.rows, groupings, depth + 1, id, getValues),
    };
  });
}

export function sortGroups<T extends MyWorkGroupValue>(groups: T[], direction: MyWorkGroupingDirection): T[] {
  const regular = groups.filter((group) => !group.sortLast).sort(compareGroupValues);
  const trailing = groups.filter((group) => group.sortLast).sort(compareGroupValues);
  return direction === "desc" ? [...regular.reverse(), ...trailing] : [...regular, ...trailing];
}

export function computeDefaultExpandedGroupIDs(groups: MyWorkNestedGroup[]): Set<string> {
  const expanded = new Set<string>();
  const visit = (items: MyWorkNestedGroup[], level: number) => {
    const limit = Math.max(1, level);
    items.forEach((group, index) => {
      if (index >= limit) return;
      expanded.add(group.id);
      visit(group.groups, level + 1);
    });
  };
  visit(groups, 1);
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
    const leftPriority = Number.isFinite(Number(left.priority)) && Number(left.priority) > 0 ? Number(left.priority) : Number.MAX_SAFE_INTEGER;
    const rightPriority = Number.isFinite(Number(right.priority)) && Number(right.priority) > 0 ? Number(right.priority) : Number.MAX_SAFE_INTEGER;
    return leftPriority - rightPriority
      || dueDateSortValue(left.dueDate) - dueDateSortValue(right.dueDate)
      || left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" })
      || left.kind.localeCompare(right.kind)
      || left.id.localeCompare(right.id);
  });
}

export function myWorkNodeIsActive(input: { status?: string | null; due_date?: string | null }, today = new Date()): boolean {
  const normalizedStatus = normalizeStatus(input.status ?? "");
  if (normalizedStatus === "done" || normalizedStatus === "complete" || normalizedStatus === "completed" || normalizedStatus === "closed" || normalizedStatus === "archived") return false;
  const dueDate = parseDateOnly(input.due_date);
  if (!dueDate) return true;
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  const staleBoundary = new Date(todayStart);
  staleBoundary.setDate(staleBoundary.getDate() - 14);
  return dueDate.getTime() >= staleBoundary.getTime();
}

export function priorityLabel(priority: number): string {
  if (priority === 1) return "1 URGENT(<1hr)";
  if (priority === 2) return "2 By end of day";
  if (priority === 3) return "3 Tomorrow";
  if (priority === 4) return "4 Sprint (1 week)";
  if (priority === 5) return "5 Later (low priority)";
  return "No priority";
}

export function raciRoleLabel(role: LogicGateRaciRole): string {
  if (role === "responsible") return "Responsible";
  if (role === "accountable") return "Accountable";
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
  if (normalized === "verify") return "Verify";
  if (normalized === "done") return "Done";
  return value.trim().replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusSortValue(value: string): number | string {
  const normalized = normalizeStatus(value);
  if (normalized === "pending") return 1;
  if (normalized === "in_progress") return 2;
  if (normalized === "verify") return 3;
  if (normalized === "done") return 4;
  return normalized;
}

function raciRoleSort(role: LogicGateRaciRole): number {
  if (role === "responsible") return 1;
  if (role === "accountable") return 2;
  if (role === "consulted") return 3;
  return 4;
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
