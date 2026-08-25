import {
  buildUniversalNestedGroups,
  type UniversalGroupValue,
  type UniversalNestedGroup,
} from "../grouping/universalGrouping.js";
import { getUniversalStatusGroupValue } from "../grouping/universalStatusGrouping.js";
import type { ProjectRelationshipProjection } from "./projectManagementApi.js";

export type ProjectRelationshipGroupingField =
  | "logic_gate"
  | "type"
  | "status"
  | "date_added"
  | "email_origin";

export type ProjectRelationshipGroupingDirection = "asc" | "desc";

export type ProjectRelationshipGroupingSetting = {
  field: ProjectRelationshipGroupingField;
  direction: ProjectRelationshipGroupingDirection;
};

export type ProjectRelationshipNestedGroup = UniversalNestedGroup<
  ProjectRelationshipProjection,
  ProjectRelationshipGroupingField
>;

export type ProjectRelationshipGroupingModel = {
  groupings: ProjectRelationshipGroupingSetting[];
  groups: ProjectRelationshipNestedGroup[];
  ungroupedRows: ProjectRelationshipProjection[];
};

export type ProjectRelationshipVisibleLeafRow = {
  row: ProjectRelationshipProjection;
  depth: number;
};

export const PROJECT_RELATIONSHIP_GROUPING_FIELDS: ReadonlyArray<{
  value: ProjectRelationshipGroupingField;
  label: string;
}> = [
  { value: "logic_gate", label: "Process" },
  { value: "type", label: "Type" },
  { value: "status", label: "Status" },
  { value: "date_added", label: "Date Added" },
  { value: "email_origin", label: "Email Origin" },
];

export const DEFAULT_PROJECT_RELATIONSHIP_GROUPINGS: ProjectRelationshipGroupingSetting[] = [
  { field: "logic_gate", direction: "asc" },
];

const PROJECT_RELATIONSHIP_GROUPING_FIELD_SET = new Set<ProjectRelationshipGroupingField>(
  PROJECT_RELATIONSHIP_GROUPING_FIELDS.map((field) => field.value),
);

/**
 * Normalizes persisted or local grouping settings. A missing/non-array value
 * receives the default, while an explicit empty array remains intentionally
 * ungrouped.
 */
export function normalizeProjectRelationshipGroupingStack(
  value: unknown,
): ProjectRelationshipGroupingSetting[] {
  if (!Array.isArray(value)) return DEFAULT_PROJECT_RELATIONSHIP_GROUPINGS.map((grouping) => ({ ...grouping }));

  const normalized: ProjectRelationshipGroupingSetting[] = [];
  const seen = new Set<ProjectRelationshipGroupingField>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as { field?: unknown; direction?: unknown };
    if (
      typeof candidate.field !== "string"
      || !PROJECT_RELATIONSHIP_GROUPING_FIELD_SET.has(candidate.field as ProjectRelationshipGroupingField)
    ) continue;

    const field = candidate.field as ProjectRelationshipGroupingField;
    if (seen.has(field)) continue;
    seen.add(field);
    normalized.push({
      field,
      direction: candidate.direction === "desc" ? "desc" : "asc",
    });
  }
  return normalized;
}

/**
 * Builds the display tree from every visible project relationship. Logic Gate
 * relationships participate in the tree so a visible gate is retained even
 * when it currently has no visible node relationships.
 */
export function buildProjectRelationshipGroupingModel(
  relationships: ProjectRelationshipProjection[],
  groupingsValue: unknown,
): ProjectRelationshipGroupingModel {
  const groupings = normalizeProjectRelationshipGroupingStack(groupingsValue);
  const sortedRows = sortProjectRelationshipRows(relationships);
  if (groupings.length === 0) {
    return { groupings, groups: [], ungroupedRows: sortedRows };
  }

  const visibleLogicGates = buildVisibleProjectLogicGateIndex(sortedRows);
  const universalGroups = buildUniversalNestedGroups(sortedRows, groupings, {
    rootID: "project-relationships",
    rowKey: (row) => row.relationship_id,
    getValues: (row, field) => getProjectRelationshipGroupValues(row, field, visibleLogicGates),
    sortRows: sortProjectRelationshipRows,
  });
  const groups = normalizeProjectRelationshipDisplayGroups(universalGroups, visibleLogicGates);
  return { groupings, groups, ungroupedRows: [] };
}

export function buildProjectRelationshipGroups(
  relationships: ProjectRelationshipProjection[],
  groupingsValue: unknown,
): ProjectRelationshipNestedGroup[] {
  return buildProjectRelationshipGroupingModel(relationships, groupingsValue).groups;
}

export function buildVisibleProjectLogicGateIndex(
  relationships: ProjectRelationshipProjection[],
): ReadonlyMap<string, ProjectRelationshipProjection> {
  const gates = new Map<string, ProjectRelationshipProjection>();
  for (const relationship of sortProjectRelationshipRows(relationships)) {
    if (relationship.resource_type !== "logic_gate") continue;
    const logicGateID = projectRelationshipLogicGateID(relationship);
    if (logicGateID && !gates.has(logicGateID)) gates.set(logicGateID, relationship);
  }
  return gates;
}

export function getProjectRelationshipGroupValues(
  relationship: ProjectRelationshipProjection,
  field: ProjectRelationshipGroupingField,
  visibleLogicGates: ReadonlyMap<string, ProjectRelationshipProjection>,
): UniversalGroupValue[] {
  if (field === "logic_gate") {
    if (relationship.resource_type === "logic_gate") {
      const logicGateID = projectRelationshipLogicGateID(relationship);
      const visibleGate = logicGateID ? visibleLogicGates.get(logicGateID) : undefined;
      if (visibleGate) return [visibleLogicGateGroupValue(logicGateID, visibleGate)];
      return [noLogicGateGroupValue()];
    }

    const referencedLogicGateID = relationship.logic_gate_id?.trim() ?? "";
    const visibleGate = referencedLogicGateID ? visibleLogicGates.get(referencedLogicGateID) : undefined;
    return visibleGate
      ? [visibleLogicGateGroupValue(referencedLogicGateID, visibleGate)]
      : [noLogicGateGroupValue()];
  }

  if (field === "type") {
    return relationship.resource_type === "logic_gate"
      ? [{ key: "logic_gate", label: "Processes", sortValue: 1 }]
      : [{ key: "node", label: "Nodes", sortValue: 2 }];
  }

  if (field === "status") {
    const sourceStatus = relationship.status?.trim() ?? "";
    const status = relationship.resource_type === "logic_gate" && /^logic gate$/i.test(sourceStatus) ? "Process" : sourceStatus;
    return [getUniversalStatusGroupValue(status)];
  }

  if (field === "date_added") {
    const timestamp = relationship.relationship_created_timestamp?.trim() ?? "";
    const date = timestamp.slice(0, 10);
    return date
      ? [{ key: date, label: date, sortValue: date }]
      : [{ key: "none", label: "No date added", sortValue: "", sortLast: true }];
  }

  return relationship.created_from_email
    ? [{ key: "email", label: "Created from email", sortValue: 1 }]
    : [{ key: "not_email", label: "Not created from email", sortValue: 2 }];
}

export function sortProjectRelationshipRows(
  relationships: ProjectRelationshipProjection[],
): ProjectRelationshipProjection[] {
  return [...relationships].sort((left, right) => (
    (left.position ?? 0) - (right.position ?? 0)
    || left.display_title.localeCompare(right.display_title, undefined, { numeric: true, sensitivity: "base" })
    || left.relationship_id.localeCompare(right.relationship_id)
  ));
}

/** Returns every group ID in stable display/preorder order. */
export function collectProjectRelationshipGroupIDs(
  groups: ProjectRelationshipNestedGroup[],
): string[] {
  const ids: string[] = [];
  const visit = (group: ProjectRelationshipNestedGroup) => {
    ids.push(group.id);
    for (const child of group.groups) visit(child);
  };
  for (const group of groups) visit(group);
  return ids;
}

/**
 * Flattens only expanded leaf rows and records the depth used by row rendering.
 * A visible Logic Gate represented by an ancestor Logic Gate group is not
 * repeated as a leaf row beneath that same group.
 */
export function flattenVisibleProjectRelationshipLeafRows(
  model: Pick<ProjectRelationshipGroupingModel, "groups" | "ungroupedRows">,
  expandedGroupIDs: ReadonlySet<string>,
): ProjectRelationshipVisibleLeafRow[] {
  if (model.groups.length === 0) {
    return model.ungroupedRows.map((row) => ({ row, depth: 0 }));
  }

  const visibleRows: ProjectRelationshipVisibleLeafRow[] = [];
  const visit = (group: ProjectRelationshipNestedGroup, ancestorLogicGateIDs: ReadonlySet<string>) => {
    if (!expandedGroupIDs.has(group.id)) return;

    const nextAncestorLogicGateIDs = addGroupLogicGateAncestor(group, ancestorLogicGateIDs);
    for (const child of group.groups) visit(child, nextAncestorLogicGateIDs);
    for (const row of group.rows) {
      if (gateLeafDuplicatesAncestor(row, nextAncestorLogicGateIDs)) continue;
      visibleRows.push({ row, depth: group.depth + 1 });
    }
  };
  for (const group of model.groups) visit(group, new Set());
  return visibleRows;
}

function visibleLogicGateGroupValue(
  logicGateID: string,
  gate: ProjectRelationshipProjection,
): UniversalGroupValue {
  const label = gate.display_title.trim() || "Process";
  return { key: logicGateID, label, sortValue: label.toLowerCase() };
}

function noLogicGateGroupValue(): UniversalGroupValue {
  return { key: "none", label: "No process", sortValue: "", sortLast: true };
}

function projectRelationshipLogicGateID(relationship: ProjectRelationshipProjection): string {
  if (relationship.resource_type !== "logic_gate") return "";
  return relationship.logic_gate_id?.trim() || relationship.resource_id.trim();
}

function normalizeProjectRelationshipDisplayGroups(
  groups: ProjectRelationshipNestedGroup[],
  visibleLogicGates: ReadonlyMap<string, ProjectRelationshipProjection>,
  ancestorLogicGateIDs: ReadonlySet<string> = new Set(),
): ProjectRelationshipNestedGroup[] {
  const normalized: ProjectRelationshipNestedGroup[] = [];
  for (const group of groups) {
    const nextAncestorLogicGateIDs = addGroupLogicGateAncestor(group, ancestorLogicGateIDs);
    const childGroups = normalizeProjectRelationshipDisplayGroups(group.groups, visibleLogicGates, nextAncestorLogicGateIDs);
    const rows = group.rows.filter((row) => !gateLeafDuplicatesAncestor(row, nextAncestorLogicGateIDs));
    const isVisibleGateGroup = group.field === "logic_gate"
      && group.key !== "none"
      && visibleLogicGates.has(group.key);
    if (rows.length === 0 && childGroups.length === 0 && !isVisibleGateGroup) continue;
    normalized.push({ ...group, groups: childGroups, rows });
  }
  return normalized;
}

function addGroupLogicGateAncestor(
  group: ProjectRelationshipNestedGroup,
  ancestorLogicGateIDs: ReadonlySet<string>,
): ReadonlySet<string> {
  if (group.field !== "logic_gate" || group.key === "none") return ancestorLogicGateIDs;
  const next = new Set(ancestorLogicGateIDs);
  next.add(group.key);
  return next;
}

function gateLeafDuplicatesAncestor(
  relationship: ProjectRelationshipProjection,
  ancestorLogicGateIDs: ReadonlySet<string>,
): boolean {
  if (relationship.resource_type !== "logic_gate") return false;
  const logicGateID = projectRelationshipLogicGateID(relationship);
  return Boolean(logicGateID && ancestorLogicGateIDs.has(logicGateID));
}
