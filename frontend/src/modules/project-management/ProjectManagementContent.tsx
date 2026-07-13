import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal.js";
import { ConfirmActionMenu, confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu.js";
import { buildProjectRoute } from "../../app/deepLinkRoutes.js";
import type { ProjectLogicGateReturnContext } from "../../app/projectRouteHistory.js";
import { openAppPathInNewTab } from "../../app/resourceLinks.js";
import { requestAppSidebarPin } from "../../app/sidebarPins.js";
import { fetchCurrentUser } from "../../auth/cognitoAuth.js";
import { getActiveCompanyID } from "../../auth/currentCompany.js";
import { AccountFilterControl, useCompanyAccounts } from "../accounts/AccountFilterControl.js";
import { entityMatchesAccountFilter } from "../accounts/accountsApi.js";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons.js";
import { EXPLORER_DRAG_MIME, readExplorerDragPayload } from "../company-explorer/companyExplorerDragDrop.js";
import { buildCompanyExplorerTreeRows } from "../company-explorer/companyExplorerTreeRows.js";
import type { ExplorerTreeNode } from "../company-explorer/companyExplorerTypes.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders.js";
import type { LogicGateRecord } from "../logic-gate-map/shared.js";
import { toLogicGateCanvasRecord } from "../logic-gate-map/shared.js";
import { getNodeTitle, type NodeRecord } from "../node-map/shared.js";
import {
  fetchCommunicationsWorkspacePanel,
  invalidateCommunicationsWorkspacePanelCache,
  listCompanyUserGroups,
  listCompanyUsers,
  type CommunicationsWorkspacePanel,
  type CompanyUser,
  type CompanyUserGroup,
  type CompanyUserGroupMember,
} from "../communications/communicationsApi.js";
import {
  CompanyPerspectiveSelector,
  companyPerspectiveLabel,
  userIDsForPerspective,
  type CompanyPerspective,
} from "../perspectives/PerspectiveSelector.js";
import {
  createProject,
  createProjectManagementTimelineItem,
  deleteProject,
  deleteProjectManagementNode,
  deleteProjectManagementTimelineItem,
  fetchProjectManagementTimeline,
  listProjects,
  updateProject,
  updateProjectManagementTimelineItem,
  type ProjectRecord,
  type ProjectHealth,
  type ProjectManagementEntityType,
  type ProjectManagementTimelineRow,
} from "./projectManagementApi.js";
import { ProjectSummaryContent } from "./ProjectSummaryContent.js";

type ProjectManagementContentProps = {
  accent: string;
  widgetId?: string;
  hideTopControls?: boolean;
  theme?: "mango" | "teal" | "light" | "dark";
  onNodeOpen?: (nodeID: string) => void;
  onLogicGateOpen?: (logicGateID: string, returnContext?: ProjectLogicGateReturnContext) => void;
  onProjectOpen?: (projectID: string) => void;
  onProjectCollapseToTab?: (target: { projectID: string; label: string }) => void;
  targetProjectID?: string;
  targetProjectRequestID?: number;
};

type ProjectTimelinePayload = {
  entityType: ProjectManagementEntityType;
  entityID: string;
  label: string;
  color?: string;
};

type WorkspacePanelState = {
  nodeFolders: CompanyExplorerFolder[];
  nodeFolderItems: CompanyExplorerFolderItem[];
  nodes: NodeRecord[];
  logicGateFolders: CompanyExplorerFolder[];
  logicGateFolderItems: CompanyExplorerFolderItem[];
  logicGates: LogicGateRecord[];
};

type ResizeState =
  { kind: "vertical"; pageTop: number; pageHeight: number };

type BarDraft = {
  itemID: string;
  startOffset: number;
  durationDays: number;
};

type BarInteraction = {
  item: ProjectManagementTimelineRow;
  mode: "move" | "left" | "right";
  startX: number;
  dayWidth: number;
  startOffset: number;
  durationDays: number;
};

type TimelineContextMenuState = {
  item: ProjectManagementTimelineRow;
  x: number;
  y: number;
};

type ProjectContextMenuState = {
  project: ProjectRecord;
  x: number;
  y: number;
};

type TimelineLoadOptions = {
  showLoading?: boolean;
};

type ProjectManagementViewMode = "timeline" | "list";

type ProjectGroupField = "account" | "team";
type ProjectGroupingField = ProjectGroupField | "";

type ProjectGroupValue = {
  key: string;
  label: string;
};

type ProjectGroupBucket<T> = {
  group: ProjectGroupValue;
  items: T[];
};

type ProjectGroupSection<T> = {
  group: ProjectGroupValue;
  buckets: ProjectGroupBucket<T>[];
};

type TimelineWorkDisplayRow = {
  id: string;
  kind: "logic_gate" | "node";
  item: ProjectManagementTimelineRow;
  depth: number;
  gateID?: string;
  canExpand?: boolean;
  expanded?: boolean;
};

type TimelineGroupDisplayRow = {
  id: string;
  kind: "group";
  label: string;
  depth: number;
};

type TimelineDisplayRow = TimelineWorkDisplayRow | TimelineGroupDisplayRow;

const PROJECT_TIMELINE_ENTITY_MIME = "application/x-mangorts-project-timeline-entity";
const PROJECT_GROUP_FIELDS: Array<{ field: ProjectGroupField; label: string }> = [
  { field: "account", label: "Account" },
  { field: "team", label: "Team" },
];
const PROJECT_HEALTH_OPTIONS: ProjectHealth[] = ["On Track", "AT RISK", "Off Track"];
const EMPTY_WORKSPACE_PANEL: WorkspacePanelState = {
  nodeFolders: [],
  nodeFolderItems: [],
  nodes: [],
  logicGateFolders: [],
  logicGateFolderItems: [],
  logicGates: [],
};
const WEEK_DAY_COUNT = 7;
const TIMELINE_LABEL_W = 280;
const TIMELINE_MIN_DAY_W = 96;
const TIMELINE_HEADER_H = 38;
const TIMELINE_ROW_H = 45;

function workspacePanelStateFromResponse(panel: CommunicationsWorkspacePanel): WorkspacePanelState {
  return {
    nodeFolders: panel.nodeFolders,
    nodeFolderItems: panel.nodeFolderItems,
    nodes: panel.nodes,
    logicGateFolders: panel.logicGateFolders,
    logicGateFolderItems: panel.logicGateFolderItems,
    logicGates: panel.logicGates,
  };
}

function defaultUserPerspective(currentUserID: string): CompanyPerspective {
  return { scope: "mine", subjectType: "user", subjectID: currentUserID.trim() };
}

function weekStart(date: Date): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = next.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + mondayOffset);
  return next;
}

function addDays(date: Date, count: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function dateFromISO(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function endDate(startDate: string, durationDays: number): string {
  const parsed = dateFromISO(startDate);
  if (!parsed) return startDate;
  return isoDate(addDays(parsed, Math.max(1, durationDays) - 1));
}

function daysBetween(left: Date, right: Date): number {
  const a = new Date(left.getFullYear(), left.getMonth(), left.getDate()).getTime();
  const b = new Date(right.getFullYear(), right.getMonth(), right.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

function shortDayLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeTimelineRow(row: ProjectManagementTimelineRow): ProjectManagementTimelineRow {
  const durationDays = clampInteger(Number(row.duration_days) || 1, 1, 90);
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(row.start_date ?? "") ? row.start_date : isoDate(weekStart(new Date()));
  return {
    ...row,
    start_date: startDate,
    end_date: row.end_date || endDate(startDate, durationDays),
    duration_days: durationDays,
    position: Number.isFinite(Number(row.position)) ? Number(row.position) : 0,
    display_title: row.display_title?.trim() || row.resource_id,
  };
}

function rowColor(row: ProjectManagementTimelineRow): string {
  const status = row.status?.trim().toLowerCase() ?? "";
  if (status.includes("done") || status.includes("complete")) return "#22c55e";
  if (status.includes("progress")) return "#3b82f6";
  if (status.includes("review")) return "#a855f7";
  if (status.includes("blocked")) return "#ef4444";
  if (status.includes("pending") || status.includes("todo") || status.includes("to do") || status.includes("backlog") || status.includes("not started")) return "#d97706";
  if (row.resource_type === "logic_gate") return "#8b5cf6";
  return "#0891b2";
}

function nodeIDForTimelineRow(row: ProjectManagementTimelineRow): string {
  return row.node_id?.trim() || (row.resource_type === "node" ? row.resource_id.trim() : "");
}

function logicGateIDForTimelineRow(row: ProjectManagementTimelineRow): string {
  return row.logic_gate_id?.trim() || (row.resource_type === "logic_gate" ? row.resource_id.trim() : "");
}

function readableTextColor(background: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(background.trim());
  if (!match) return "#ffffff";
  const hex = match[1];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111827" : "#ffffff";
}

function targetUserIDsForPerspective(input: {
  perspective: CompanyPerspective;
  companyUsers: CompanyUser[];
  groupMembers: CompanyUserGroupMember[];
  currentUserID: string;
}): string[] {
  const currentUserID = input.currentUserID.trim();
  if (input.perspective.scope === "company" || input.perspective.subjectType === "company") {
    const userIDs = input.companyUsers.map((user) => user.user_id.trim()).filter(Boolean);
    return userIDs.length > 0 ? Array.from(new Set(userIDs)).sort() : currentUserID ? [currentUserID] : [];
  }
  const scoped = userIDsForPerspective(input.perspective, input.groupMembers, currentUserID);
  const userIDs = Array.from(scoped ?? new Set(input.companyUsers.map((user) => user.user_id.trim()).filter(Boolean))).filter(Boolean);
  return userIDs.length > 0 ? Array.from(new Set(userIDs)).sort() : currentUserID ? [currentUserID] : [];
}

function writeUserIDForPerspective(userIDs: string[], currentUserID: string): string {
  const current = currentUserID.trim();
  if (current && userIDs.includes(current)) return current;
  return userIDs[0] ?? current;
}

function filterNodesByPerspective(nodes: NodeRecord[], perspective: CompanyPerspective, members: CompanyUserGroupMember[], currentUserID: string): NodeRecord[] {
  const userIDs = userIDsForPerspective(perspective, members, currentUserID);
  if (!userIDs) return nodes;
  return nodes;
}

function filterLogicGatesByPerspective(logicGates: LogicGateRecord[], perspective: CompanyPerspective, members: CompanyUserGroupMember[], currentUserID: string): LogicGateRecord[] {
  const userIDs = userIDsForPerspective(perspective, members, currentUserID);
  if (!userIDs) return logicGates;
  return logicGates.filter((logicGate) => (logicGate.gvic_assignments ?? []).some((assignment) => userIDs.has(assignment.user_id.trim())));
}

function readTimelinePayload(dataTransfer: DataTransfer): ProjectTimelinePayload | null {
  const raw = dataTransfer.getData(PROJECT_TIMELINE_ENTITY_MIME);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ProjectTimelinePayload>;
      const entityType = parsed.entityType === "logic_gate" ? "logic_gate" : parsed.entityType === "node" ? "node" : "";
      const entityID = typeof parsed.entityID === "string" ? parsed.entityID.trim() : "";
      const label = typeof parsed.label === "string" ? parsed.label.trim() : "";
      if (!entityType || !entityID || !label) return null;
      return { entityType, entityID, label, color: typeof parsed.color === "string" ? parsed.color : undefined };
    } catch {
      return null;
    }
  }

  const explorerPayload = readExplorerDragPayload(dataTransfer);
  const droppedLabel = dataTransfer.getData("text/plain").trim();
  if (explorerPayload?.kind === "node" && explorerPayload.itemID) {
    return { entityType: "node", entityID: explorerPayload.itemID.trim(), label: droppedLabel || explorerPayload.itemID.trim(), color: "#0891b2" };
  }
  if (explorerPayload?.kind === "logic_gate" && explorerPayload.itemID) {
    return { entityType: "logic_gate", entityID: explorerPayload.itemID.trim(), label: droppedLabel || explorerPayload.itemID.trim(), color: "#8b5cf6" };
  }
  if (explorerPayload?.kind === "batch" && (explorerPayload.itemType === "node" || explorerPayload.itemType === "logic_gate")) {
    const first = explorerPayload.items?.find((item) => item.itemID.trim());
    if (!first) return null;
    const entityType = explorerPayload.itemType;
    return { entityType, entityID: first.itemID.trim(), label: droppedLabel || first.itemID.trim(), color: entityType === "logic_gate" ? "#8b5cf6" : "#0891b2" };
  }
  return null;
}

function hasTimelinePayloadType(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types);
  return types.includes(PROJECT_TIMELINE_ENTITY_MIME) || types.includes(EXPLORER_DRAG_MIME);
}

function buildProjectExplorerRows(input: {
  expanded: Set<string>;
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
  nodeFolders: CompanyExplorerFolder[];
  nodeFolderItems: CompanyExplorerFolderItem[];
  logicGateFolders: CompanyExplorerFolder[];
  logicGateFolderItems: CompanyExplorerFolderItem[];
}): ExplorerTreeNode[] {
  return buildCompanyExplorerTreeRows({
    expanded: input.expanded,
    nodes: input.nodes,
    logicGates: input.logicGates.map(toLogicGateCanvasRecord),
    projects: [],
    kanbanBoards: [],
    folders: [...input.nodeFolders, ...input.logicGateFolders],
    folderItems: [...input.nodeFolderItems, ...input.logicGateFolderItems],
    rootRowOrder: {},
  });
}

function rowOverlapsWeek(row: ProjectManagementTimelineRow, weekStartDate: Date): boolean {
  const start = dateFromISO(row.start_date);
  if (!start) return false;
  const offset = daysBetween(start, weekStartDate);
  const endOffset = offset + Math.max(1, row.duration_days) - 1;
  return endOffset >= 0 && offset < WEEK_DAY_COUNT;
}

function displayStartOffset(row: ProjectManagementTimelineRow, weekStartDate: Date): number {
  const start = dateFromISO(row.start_date);
  return start ? daysBetween(start, weekStartDate) : 0;
}

function compareTimelineRowsByPosition(left: ProjectManagementTimelineRow, right: ProjectManagementTimelineRow): number {
  const leftPosition = Number.isFinite(Number(left.position)) ? Number(left.position) : 0;
  const rightPosition = Number.isFinite(Number(right.position)) ? Number(right.position) : 0;
  return leftPosition - rightPosition ||
    (left.created_timestamp ?? "").localeCompare(right.created_timestamp ?? "") ||
    left.display_title.localeCompare(right.display_title, undefined, { numeric: true, sensitivity: "base" }) ||
    left.item_id.localeCompare(right.item_id);
}

function orderTimelineRows(rows: ProjectManagementTimelineRow[], previousRows: ProjectManagementTimelineRow[] = []): ProjectManagementTimelineRow[] {
  if (previousRows.length === 0) return rows.slice().sort(compareTimelineRowsByPosition);
  const previousIndexByID = new Map(previousRows.map((row, index) => [row.item_id, index]));
  return rows.slice().sort((left, right) => (
    (previousIndexByID.get(left.item_id) ?? Number.MAX_SAFE_INTEGER) - (previousIndexByID.get(right.item_id) ?? Number.MAX_SAFE_INTEGER) ||
    compareTimelineRowsByPosition(left, right)
  ));
}

function timelineRowsSameResource(left: ProjectManagementTimelineRow, right: ProjectManagementTimelineRow): boolean {
  return left.user_id === right.user_id && left.resource_type === right.resource_type && left.resource_id === right.resource_id;
}

function upsertTimelineRows(current: ProjectManagementTimelineRow[], incoming: ProjectManagementTimelineRow[]): ProjectManagementTimelineRow[] {
  const next = current.slice();
  for (const row of incoming) {
    const index = next.findIndex((candidate) => candidate.item_id === row.item_id || timelineRowsSameResource(candidate, row));
    if (index >= 0) next[index] = row;
    else next.push(row);
  }
  return next;
}

function buildTimelineDisplayRows(rows: ProjectManagementTimelineRow[], nodes: NodeRecord[], expandedGateIDs: Set<string>): TimelineWorkDisplayRow[] {
  const visibleGateIDs = new Set(rows.map(logicGateIDForTimelineRow).filter(Boolean));
  const nodesByGateID = new Map<string, NodeRecord[]>();
  const nestedNodeIDs = new Set<string>();
  for (const node of nodes) {
    const nodeID = node.node_id.trim();
    if (!nodeID) continue;
    for (const gateID of node.logic_gate_ids ?? []) {
      const cleanGateID = gateID.trim();
      if (!cleanGateID || !visibleGateIDs.has(cleanGateID)) continue;
      const bucket = nodesByGateID.get(cleanGateID) ?? [];
      bucket.push(node);
      nodesByGateID.set(cleanGateID, bucket);
      nestedNodeIDs.add(nodeID);
    }
  }
  for (const bucket of nodesByGateID.values()) {
    bucket.sort((left, right) => (
      (getNodeTitle(left) || left.node_id).localeCompare(getNodeTitle(right) || right.node_id, undefined, { numeric: true, sensitivity: "base" }) ||
      left.node_id.localeCompare(right.node_id)
    ));
  }

  const nodeRowsByID = new Map<string, ProjectManagementTimelineRow>();
  for (const row of rows) {
    if (row.resource_type !== "node") continue;
    const nodeID = nodeIDForTimelineRow(row);
    if (nodeID && !nodeRowsByID.has(nodeID)) nodeRowsByID.set(nodeID, row);
  }

  const displayRows: TimelineWorkDisplayRow[] = [];
  for (const row of rows) {
    if (row.resource_type === "logic_gate") {
      const gateID = logicGateIDForTimelineRow(row);
      const childNodes = (nodesByGateID.get(gateID) ?? []).filter((node) => nodeRowsByID.has(node.node_id));
      const expanded = gateID ? expandedGateIDs.has(gateID) : false;
      displayRows.push({
        id: `gate:${row.item_id}`,
        kind: "logic_gate",
        item: row,
        depth: 0,
        gateID,
        canExpand: childNodes.length > 0,
        expanded,
      });
      if (!expanded) continue;
      for (const node of childNodes) {
        const nodeRow = nodeRowsByID.get(node.node_id);
        if (!nodeRow) continue;
        displayRows.push({
          id: `${row.item_id}:node:${node.node_id}`,
          kind: "node",
          item: nodeRow,
          depth: 1,
        });
      }
      continue;
    }

    const nodeID = nodeIDForTimelineRow(row);
    if (nodeID && nestedNodeIDs.has(nodeID)) continue;
    displayRows.push({ id: `node:${row.item_id}`, kind: "node", item: row, depth: 0 });
  }
  return displayRows;
}

function timelineRowMatchesAccountFilter(row: ProjectManagementTimelineRow, selectedAccountIDs: string[], nodeByID: Map<string, NodeRecord>): boolean {
  if (selectedAccountIDs.length === 0) return true;
  if (entityMatchesAccountFilter(row, selectedAccountIDs)) return true;
  if (row.resource_type !== "node") return false;
  const nodeID = nodeIDForTimelineRow(row);
  return entityMatchesAccountFilter(nodeByID.get(nodeID), selectedAccountIDs);
}

const UNASSIGNED_GROUP_KEY = "__unassigned";

function fallbackGroupValue(label = "Unassigned"): ProjectGroupValue {
  return { key: UNASSIGNED_GROUP_KEY, label };
}

function uniqueGroupValues(values: ProjectGroupValue[], fallbackLabel = "Unassigned"): ProjectGroupValue[] {
  const byKey = new Map<string, ProjectGroupValue>();
  for (const value of values) {
    const key = value.key.trim();
    if (!key) continue;
    byKey.set(key, { key, label: value.label.trim() || key });
  }
  return byKey.size > 0 ? Array.from(byKey.values()) : [fallbackGroupValue(fallbackLabel)];
}

function projectGroupValues(project: ProjectRecord, field: ProjectGroupField): ProjectGroupValue[] {
  if (field === "account") {
    const accounts = project.accounts ?? [];
    const values = accounts.map((account) => ({ key: account.account_id, label: account.name || account.account_id }));
    return uniqueGroupValues(values);
  }
  if (field === "team") {
    const teams = project.teams ?? [];
    const values = teams.map((team) => ({ key: team.group_id, label: team.name || team.group_id }));
    return uniqueGroupValues(values);
  }
  return [fallbackGroupValue()];
}

function timelineGroupValues(
  row: ProjectManagementTimelineRow,
  field: ProjectGroupField,
  groups: CompanyUserGroup[],
  groupMembers: CompanyUserGroupMember[],
  nodeByID: Map<string, NodeRecord>,
): ProjectGroupValue[] {
  if (field === "account") {
    const rowAccounts = row.accounts ?? [];
    const nodeAccounts = row.resource_type === "node" ? nodeByID.get(nodeIDForTimelineRow(row))?.accounts ?? [] : [];
    return uniqueGroupValues([...rowAccounts, ...nodeAccounts].map((account) => ({ key: account.account_id, label: account.name || account.account_id })));
  }
  if (field === "team") {
    const userID = row.user_id?.trim() ?? "";
    if (!userID) return [fallbackGroupValue()];
    const groupsByID = new Map(groups.map((group) => [group.group_id, group]));
    const values = groupMembers
      .filter((member) => member.user_id === userID)
      .map((member) => {
        const group = groupsByID.get(member.group_id);
        return { key: member.group_id, label: group?.name || member.group_id };
    });
    return uniqueGroupValues(values);
  }
  return [fallbackGroupValue()];
}

function compareProjectGroupValues(left: ProjectGroupValue, right: ProjectGroupValue): number {
  const leftUnassigned = left.key === UNASSIGNED_GROUP_KEY;
  const rightUnassigned = right.key === UNASSIGNED_GROUP_KEY;
  if (leftUnassigned || rightUnassigned) return leftUnassigned === rightUnassigned ? 0 : leftUnassigned ? 1 : -1;
  return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" }) || left.key.localeCompare(right.key);
}

function buildGroupedSections<T>(
  items: T[],
  getValues: (item: T, field: ProjectGroupField) => ProjectGroupValue[],
  groupField: ProjectGroupField,
  subgroupField: ProjectGroupingField,
): ProjectGroupSection<T>[] {
  const sectionsByKey = new Map<string, ProjectGroupSection<T>>();
  const effectiveSubgroupField = subgroupField && subgroupField !== groupField ? subgroupField : "";
  const append = (groupValue: ProjectGroupValue, subgroupValue: ProjectGroupValue, item: T) => {
    let section = sectionsByKey.get(groupValue.key);
    if (!section) {
      section = { group: groupValue, buckets: [] };
      sectionsByKey.set(groupValue.key, section);
    }
    let bucket = section.buckets.find((candidate) => candidate.group.key === subgroupValue.key);
    if (!bucket) {
      bucket = { group: subgroupValue, items: [] };
      section.buckets.push(bucket);
    }
    bucket.items.push(item);
  };
  for (const item of items) {
    const groupValues = getValues(item, groupField);
    const subgroupValues = effectiveSubgroupField ? getValues(item, effectiveSubgroupField) : [{ key: "__all", label: "All" }];
    for (const groupValue of groupValues) {
      for (const subgroupValue of subgroupValues) {
        append(groupValue, subgroupValue, item);
      }
    }
  }
  return Array.from(sectionsByKey.values())
    .sort((left, right) => compareProjectGroupValues(left.group, right.group))
    .map((section) => ({
      ...section,
      buckets: section.buckets.sort((left, right) => compareProjectGroupValues(left.group, right.group)),
    }));
}

function buildGroupedTimelineRows(
  rows: TimelineWorkDisplayRow[],
  groupField: ProjectGroupField,
  subgroupField: ProjectGroupingField,
  groups: CompanyUserGroup[],
  groupMembers: CompanyUserGroupMember[],
  nodeByID: Map<string, NodeRecord>,
): TimelineDisplayRow[] {
  const effectiveSubgroupField = subgroupField && subgroupField !== groupField ? subgroupField : "";
  const sections = buildGroupedSections(
    rows,
    (row, field) => timelineGroupValues(row.item, field, groups, groupMembers, nodeByID),
    groupField,
    effectiveSubgroupField,
  );
  const displayRows: TimelineDisplayRow[] = [];
  for (const section of sections) {
    displayRows.push({ id: `group:${groupField}:${section.group.key}`, kind: "group", label: section.group.label, depth: 0 });
    for (const bucket of section.buckets) {
      const bucketID = `subgroup:${groupField}:${section.group.key}:${effectiveSubgroupField || "none"}:${bucket.group.key}`;
      if (effectiveSubgroupField) {
        displayRows.push({ id: bucketID, kind: "group", label: bucket.group.label, depth: 1 });
      }
      displayRows.push(...bucket.items.map((row) => ({ ...row, id: `${bucketID}:${row.id}`, depth: row.depth + (effectiveSubgroupField ? 2 : 1) })));
    }
  }
  return displayRows;
}

function projectAccountLabel(project: ProjectRecord): string {
  const labels = (project.accounts ?? []).map((account) => account.name || account.account_id).filter(Boolean);
  if (labels.length > 0) return labels.join(", ");
  return "Unassigned";
}

function projectTeamLabel(project: ProjectRecord): string {
  const labels = (project.teams ?? []).map((team) => team.name || team.group_id).filter(Boolean);
  if (labels.length > 0) return labels.join(", ");
  return "Unassigned";
}

export const ProjectManagementContent: React.FC<ProjectManagementContentProps> = ({
  accent,
  widgetId,
  hideTopControls: _hideTopControls,
  theme: _theme,
  onNodeOpen,
  onLogicGateOpen,
  onProjectOpen,
  onProjectCollapseToTab,
  targetProjectID,
  targetProjectRequestID,
}) => {
  const companyID = getActiveCompanyID();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const workspacePanelReloadTimerRef = useRef<number | null>(null);
  const projectListReloadTimerRef = useRef<number | null>(null);
  const timelineRowsRef = useRef<ProjectManagementTimelineRow[]>([]);
  const [currentUserID, setCurrentUserID] = useState("");
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [groups, setGroups] = useState<CompanyUserGroup[]>([]);
  const [groupMembers, setGroupMembers] = useState<CompanyUserGroupMember[]>([]);
  const [workspace, setWorkspace] = useState<WorkspacePanelState>(EMPTY_WORKSPACE_PANEL);
  const [loading, setLoading] = useState(true);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<ProjectManagementViewMode>("list");
  const [groupBy, setGroupBy] = useState<ProjectGroupingField>("");
  const [subgroupBy, setSubgroupBy] = useState<ProjectGroupingField>("");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProjectID, setActiveProjectID] = useState("");
  const [weekAnchor, setWeekAnchor] = useState(() => weekStart(new Date()));
  const [timelineRows, setTimelineRows] = useState<ProjectManagementTimelineRow[]>([]);
  const [timelinePerspective, setTimelinePerspective] = useState<CompanyPerspective>(() => defaultUserPerspective(""));
  const [explorerPerspective, setExplorerPerspective] = useState<CompanyPerspective>(() => defaultUserPerspective(""));
  const [timelineAccountFilterIDs, setTimelineAccountFilterIDs] = useState<string[]>([]);
  const [explorerExpanded, setExplorerExpanded] = useState<Set<string>>(() => new Set());
  const [timelineExpandedGateIDs, setTimelineExpandedGateIDs] = useState<Set<string>>(() => new Set());
  const [verticalSplit, setVerticalSplit] = useState(54);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [barInteraction, setBarInteraction] = useState<BarInteraction | null>(null);
  const [barDraft, setBarDraft] = useState<BarDraft | null>(null);
  const [timelineContextMenu, setTimelineContextMenu] = useState<TimelineContextMenuState | null>(null);
  const [projectContextMenu, setProjectContextMenu] = useState<ProjectContextMenuState | null>(null);
  const [projectDeleteConfirmation, setProjectDeleteConfirmation] = useState<{ project: ProjectRecord; position?: ConfirmActionMenuPosition | null } | null>(null);
  const [timelineNodeDeleteConfirmation, setTimelineNodeDeleteConfirmation] = useState<{ item: ProjectManagementTimelineRow; position?: ConfirmActionMenuPosition | null } | null>(null);
  const [projectRenameTarget, setProjectRenameTarget] = useState<ProjectRecord | null>(null);
  const [projectRenameDraft, setProjectRenameDraft] = useState("");
  const [projectRenameSaving, setProjectRenameSaving] = useState(false);
  const { accounts: timelineAccounts } = useCompanyAccounts(companyID);

  const loadWorkspacePanel = useCallback(async () => {
    const cleanCompanyID = companyID.trim();
    if (!cleanCompanyID) return;
    try {
      const panel = await fetchCommunicationsWorkspacePanel(cleanCompanyID);
      setWorkspace(workspacePanelStateFromResponse(panel));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load project management data");
    }
  }, [companyID]);

  const loadProjectList = useCallback(async (showLoading = false) => {
    const cleanCompanyID = companyID.trim();
    if (!cleanCompanyID) return;
    if (showLoading) setProjectsLoading(true);
    try {
      const response = await listProjects(cleanCompanyID);
      setProjects(response.projects ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load projects");
    } finally {
      setProjectsLoading(false);
    }
  }, [companyID]);

  const scheduleWorkspacePanelReload = useCallback(() => {
    const cleanCompanyID = companyID.trim();
    if (!cleanCompanyID) return;
    invalidateCommunicationsWorkspacePanelCache(cleanCompanyID);
    if (workspacePanelReloadTimerRef.current !== null) {
      window.clearTimeout(workspacePanelReloadTimerRef.current);
    }
    workspacePanelReloadTimerRef.current = window.setTimeout(() => {
      workspacePanelReloadTimerRef.current = null;
      void loadWorkspacePanel();
    }, 250);
  }, [companyID, loadWorkspacePanel]);

  const scheduleProjectListReload = useCallback(() => {
    const cleanCompanyID = companyID.trim();
    if (!cleanCompanyID) return;
    if (projectListReloadTimerRef.current !== null) {
      window.clearTimeout(projectListReloadTimerRef.current);
    }
    projectListReloadTimerRef.current = window.setTimeout(() => {
      projectListReloadTimerRef.current = null;
      void loadProjectList();
    }, 250);
  }, [companyID, loadProjectList]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      fetchCurrentUser().catch(() => null),
      fetchCommunicationsWorkspacePanel(companyID),
      listCompanyUsers(companyID),
      listCompanyUserGroups(companyID),
    ])
      .then(([current, panel, users, userGroups]) => {
        if (cancelled) return;
        const userID = current?.user.user_id.trim() ?? "";
        setCurrentUserID(userID);
        setCompanyUsers(users);
        setGroups(userGroups.groups);
        setGroupMembers(userGroups.members);
        setWorkspace(workspacePanelStateFromResponse(panel));
        const defaultPerspective = defaultUserPerspective(userID);
        setTimelinePerspective((currentValue) => currentValue.subjectID.trim() ? currentValue : defaultPerspective);
        setExplorerPerspective((currentValue) => currentValue.subjectID.trim() ? currentValue : defaultPerspective);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load project management data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyID]);


  useEffect(() => () => {
    if (workspacePanelReloadTimerRef.current !== null) {
      window.clearTimeout(workspacePanelReloadTimerRef.current);
      workspacePanelReloadTimerRef.current = null;
    }
    if (projectListReloadTimerRef.current !== null) {
      window.clearTimeout(projectListReloadTimerRef.current);
      projectListReloadTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    setExplorerExpanded((current) => {
      const next = new Set(current);
      for (const folder of workspace.nodeFolders) next.add(`workspace-folder-${folder.folder_id}`);
      for (const folder of workspace.logicGateFolders) next.add(`workspace-folder-${folder.folder_id}`);
      return next;
    });
  }, [workspace.logicGateFolders, workspace.nodeFolders]);

  useEffect(() => {
    timelineRowsRef.current = timelineRows;
  }, [timelineRows]);

  useEffect(() => {
    setTimelineAccountFilterIDs((current) => current.filter((accountID) => timelineAccounts.some((account) => account.account_id === accountID)));
  }, [timelineAccounts]);

  const weekDays = useMemo(() => Array.from({ length: WEEK_DAY_COUNT }, (_, index) => addDays(weekAnchor, index)), [weekAnchor]);
  const timelineTargetUserIDs = useMemo(() => targetUserIDsForPerspective({
    perspective: timelinePerspective,
    companyUsers,
    groupMembers,
    currentUserID,
  }), [companyUsers, currentUserID, groupMembers, timelinePerspective]);
  const timelineWriteUserID = writeUserIDForPerspective(timelineTargetUserIDs, currentUserID);

  const loadTimelineRows = useCallback(async (options: TimelineLoadOptions = {}) => {
    const showLoading = options.showLoading === true;
    if (!companyID || timelineTargetUserIDs.length === 0) {
      setTimelineRows([]);
      setTimelineLoading(false);
      return;
    }
    if (showLoading) setTimelineLoading(true);
    setError("");
    const settled = await Promise.allSettled(timelineTargetUserIDs.map((userID) => fetchProjectManagementTimeline(companyID, userID)));
    const rows: ProjectManagementTimelineRow[] = [];
    let failureCount = 0;
    settled.forEach((result) => {
      if (result.status === "fulfilled") {
        rows.push(...result.value.rows.map(normalizeTimelineRow));
      } else {
        failureCount += 1;
      }
    });
    setTimelineRows((current) => orderTimelineRows(rows, current.length > 0 ? current : timelineRowsRef.current));
    if (failureCount > 0 && rows.length === 0) {
      setError("Failed to load project management timeline");
    }
    setTimelineLoading(false);
  }, [companyID, timelineTargetUserIDs]);

  useEffect(() => {
    void loadTimelineRows({ showLoading: true });
  }, [loadTimelineRows]);

  useEffect(() => {
    void loadProjectList(true);
  }, [loadProjectList]);

  useEffect(() => {
    const cleanProjectID = targetProjectID?.trim() ?? "";
    if (!cleanProjectID) {
      setActiveProjectID("");
      setViewMode("list");
      return;
    }
    setActiveProjectID(cleanProjectID);
    setViewMode("list");
  }, [targetProjectID, targetProjectRequestID]);


  useEffect(() => {
    if (!resizeState) return undefined;
    const onPointerMove = (event: PointerEvent) => {
      const pct = ((event.clientY - resizeState.pageTop) / resizeState.pageHeight) * 100;
      setVerticalSplit(clampInteger(pct, 36, 70));
    };
    const onPointerUp = () => setResizeState(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [resizeState]);

  const updateTimelineItem = useCallback(async (item: ProjectManagementTimelineRow, startOffset: number, durationDays: number) => {
    const nextStartDate = isoDate(addDays(weekDays[0], clampInteger(startOffset, 0, WEEK_DAY_COUNT - 1)));
    const nextDuration = clampInteger(durationDays, 1, WEEK_DAY_COUNT);
    const optimistic = normalizeTimelineRow({ ...item, start_date: nextStartDate, end_date: endDate(nextStartDate, nextDuration), duration_days: nextDuration });
    setTimelineRows((current) => current.map((row) => row.item_id === item.item_id ? optimistic : row));
    try {
      const result = await updateProjectManagementTimelineItem({
        companyID,
        itemID: item.item_id,
        startDate: nextStartDate,
        durationDays: nextDuration,
        position: item.position ?? 0,
      });
      if (result.item) {
        setTimelineRows((current) => current.map((row) => row.item_id === item.item_id ? normalizeTimelineRow(result.item!) : row));
      }
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update timeline item");
      void loadTimelineRows();
    }
  }, [companyID, loadTimelineRows, weekDays]);

  useEffect(() => {
    if (!barInteraction) return undefined;
    const onPointerMove = (event: PointerEvent) => {
      const deltaDays = Math.round((event.clientX - barInteraction.startX) / Math.max(1, barInteraction.dayWidth));
      if (barInteraction.mode === "move") {
        setBarDraft({
          itemID: barInteraction.item.item_id,
          startOffset: clampInteger(barInteraction.startOffset + deltaDays, 0, WEEK_DAY_COUNT - barInteraction.durationDays),
          durationDays: barInteraction.durationDays,
        });
      } else if (barInteraction.mode === "left") {
        const nextStart = clampInteger(barInteraction.startOffset + deltaDays, 0, barInteraction.startOffset + barInteraction.durationDays - 1);
        const nextDuration = clampInteger(barInteraction.durationDays + (barInteraction.startOffset - nextStart), 1, WEEK_DAY_COUNT - nextStart);
        setBarDraft({ itemID: barInteraction.item.item_id, startOffset: nextStart, durationDays: nextDuration });
      } else {
        setBarDraft({
          itemID: barInteraction.item.item_id,
          startOffset: barInteraction.startOffset,
          durationDays: clampInteger(barInteraction.durationDays + deltaDays, 1, WEEK_DAY_COUNT - barInteraction.startOffset),
        });
      }
    };
    const onPointerUp = () => {
      const draft = barDraft;
      const interaction = barInteraction;
      setBarInteraction(null);
      setBarDraft(null);
      if (draft && interaction && (draft.startOffset !== interaction.startOffset || draft.durationDays !== interaction.durationDays)) {
        void updateTimelineItem(interaction.item, draft.startOffset, draft.durationDays);
      }
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [barDraft, barInteraction, updateTimelineItem]);

  useEffect(() => {
    if (!timelineContextMenu) return undefined;
    const close = () => setTimelineContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [timelineContextMenu]);

  useEffect(() => {
    if (!projectContextMenu) return undefined;
    const close = () => setProjectContextMenu(null);
    const closeUnlessConfirming = () => {
      if (document.querySelector("[data-mango-confirm-action-menu='true']")) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", closeUnlessConfirming);
    window.addEventListener("mango:confirm-action-complete", close);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", closeUnlessConfirming);
      window.removeEventListener("mango:confirm-action-complete", close);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [projectContextMenu]);

  const filteredLogicGates = useMemo(() => filterLogicGatesByPerspective(workspace.logicGates, explorerPerspective, groupMembers, currentUserID), [currentUserID, explorerPerspective, groupMembers, workspace.logicGates]);
  const filteredNodes = useMemo(() => filterNodesByPerspective(workspace.nodes, explorerPerspective, groupMembers, currentUserID), [currentUserID, explorerPerspective, groupMembers, workspace.nodes]);
  const workspaceNodeByID = useMemo(() => new Map(workspace.nodes.map((node) => [node.node_id, node])), [workspace.nodes]);
  const visibleTimelineRows = useMemo(() => {
    const weekRows = timelineRows.filter((row) => rowOverlapsWeek(row, weekDays[0]));
    if (timelineAccountFilterIDs.length === 0) return weekRows;
    const matchingNodeRows = weekRows.filter((row) => row.resource_type === "node" && timelineRowMatchesAccountFilter(row, timelineAccountFilterIDs, workspaceNodeByID));
    const matchingGateIDs = new Set(matchingNodeRows.map(logicGateIDForTimelineRow).filter(Boolean));
    return weekRows.filter((row) => (
      row.resource_type === "node"
        ? matchingNodeRows.some((nodeRow) => nodeRow.item_id === row.item_id)
        : matchingGateIDs.has(logicGateIDForTimelineRow(row)) || timelineRowMatchesAccountFilter(row, timelineAccountFilterIDs, workspaceNodeByID)
    ));
  }, [timelineAccountFilterIDs, timelineRows, weekDays, workspaceNodeByID]);
  const baseTimelineDisplayRows = useMemo(() => buildTimelineDisplayRows(visibleTimelineRows, workspace.nodes, timelineExpandedGateIDs), [timelineExpandedGateIDs, visibleTimelineRows, workspace.nodes]);
  const timelineDisplayRows = useMemo(() => (
    groupBy
      ? buildGroupedTimelineRows(baseTimelineDisplayRows, groupBy, subgroupBy, groups, groupMembers, workspaceNodeByID)
      : baseTimelineDisplayRows
  ), [baseTimelineDisplayRows, groupBy, groups, groupMembers, subgroupBy, workspaceNodeByID]);
  const explorerRows = useMemo(() => buildProjectExplorerRows({
    expanded: explorerExpanded,
    nodes: filteredNodes,
    logicGates: filteredLogicGates,
    nodeFolders: workspace.nodeFolders,
    nodeFolderItems: workspace.nodeFolderItems,
    logicGateFolders: workspace.logicGateFolders,
    logicGateFolderItems: workspace.logicGateFolderItems,
  }), [explorerExpanded, filteredLogicGates, filteredNodes, workspace.logicGateFolderItems, workspace.logicGateFolders, workspace.nodeFolderItems, workspace.nodeFolders]);
  const defaultTimelineStartOffset = useMemo(() => clampInteger(daysBetween(new Date(), weekDays[0]), 0, WEEK_DAY_COUNT - 1), [weekDays]);

  const addTimelineItem = useCallback(async (payload: ProjectTimelinePayload, startOffset: number) => {
    if (!timelineWriteUserID) return;
    const startDate = isoDate(addDays(weekDays[0], startOffset));
    const durationDays = payload.entityType === "logic_gate" ? 2 : 1;
    try {
      const result = await createProjectManagementTimelineItem({
        companyID,
        userID: timelineWriteUserID,
        entityType: payload.entityType,
        entityID: payload.entityID,
        startDate,
        durationDays,
        position: visibleTimelineRows.length,
      });
      const createdRows: ProjectManagementTimelineRow[] = [];
      if (result.item) createdRows.push(normalizeTimelineRow(result.item));

      if (payload.entityType === "logic_gate") {
        const childNodes = workspace.nodes
          .filter((node) => (node.logic_gate_ids ?? []).some((logicGateID) => logicGateID.trim() === payload.entityID))
          .sort((left, right) => (
            (getNodeTitle(left) || left.node_id).localeCompare(getNodeTitle(right) || right.node_id, undefined, { numeric: true, sensitivity: "base" }) ||
            left.node_id.localeCompare(right.node_id)
          ));
        const settled = await Promise.allSettled(childNodes.map((node, index) => createProjectManagementTimelineItem({
          companyID,
          userID: timelineWriteUserID,
          entityType: "node",
          entityID: node.node_id,
          startDate,
          durationDays,
          position: visibleTimelineRows.length + index + 1,
        })));
        for (const childResult of settled) {
          if (childResult.status === "fulfilled" && childResult.value.item) {
            createdRows.push(normalizeTimelineRow(childResult.value.item));
          }
        }
      }

      if (createdRows.length > 0) {
        setTimelineRows((current) => upsertTimelineRows(current, createdRows));
      } else {
        void loadTimelineRows();
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to add timeline item");
    }
  }, [companyID, loadTimelineRows, timelineWriteUserID, visibleTimelineRows.length, weekDays, workspace.nodes]);
  const addExplorerEntityToTimeline = useCallback((payload: ProjectTimelinePayload) => {
    void addTimelineItem(payload, defaultTimelineStartOffset);
  }, [addTimelineItem, defaultTimelineStartOffset]);

  const toggleTimelineGate = useCallback((gateID: string) => {
    setTimelineExpandedGateIDs((current) => {
      const next = new Set(current);
      if (next.has(gateID)) next.delete(gateID);
      else next.add(gateID);
      return next;
    });
  }, []);

  const removeTimelineItem = useCallback(async (item: ProjectManagementTimelineRow) => {
    setTimelineContextMenu(null);
    setTimelineRows((current) => current.filter((row) => row.item_id !== item.item_id));
    try {
      await deleteProjectManagementTimelineItem(companyID, item.item_id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete timeline item");
      void loadTimelineRows();
    }
  }, [companyID, loadTimelineRows]);

  const requestDeleteTimelineNode = useCallback((item: ProjectManagementTimelineRow, position?: ConfirmActionMenuPosition) => {
    setTimelineContextMenu(null);
    setTimelineNodeDeleteConfirmation({ item, position: position ?? null });
  }, []);

  const deleteTimelineNode = useCallback(async (item: ProjectManagementTimelineRow, confirmationDisplayName: string) => {
    if (item.resource_type !== "node") return;
    const nodeID = nodeIDForTimelineRow(item);
    if (!nodeID) return;
    setTimelineContextMenu(null);
    setTimelineNodeDeleteConfirmation(null);
    const previousWorkspace = workspace;
    setTimelineRows((current) => current.filter((row) => nodeIDForTimelineRow(row) !== nodeID));
    setWorkspace((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.node_id !== nodeID),
      nodeFolderItems: current.nodeFolderItems.filter((folderItem) => folderItem.item_type !== "node" || folderItem.item_id !== nodeID),
    }));
    try {
      await deleteProjectManagementNode(companyID, nodeID, confirmationDisplayName);
      scheduleWorkspacePanelReload();
      void loadTimelineRows();
    } catch (deleteError) {
      setWorkspace(previousWorkspace);
      setError(deleteError instanceof Error ? deleteError.message : "Node delete failed");
      void loadTimelineRows();
    }
  }, [companyID, loadTimelineRows, scheduleWorkspacePanelReload, workspace]);

  const clearTimelinePerspective = useCallback(() => {
    const items = visibleTimelineRows.slice();
    setTimelineRows((current) => current.filter((row) => !items.some((item) => item.item_id === row.item_id)));
    void Promise.allSettled(items.map((item) => deleteProjectManagementTimelineItem(companyID, item.item_id))).then(() => loadTimelineRows());
  }, [companyID, loadTimelineRows, visibleTimelineRows]);

  const openProject = useCallback((projectID: string) => {
    const cleanProjectID = projectID.trim();
    if (!cleanProjectID) return;
    setActiveProjectID(cleanProjectID);
    setViewMode("list");
    onProjectOpen?.(cleanProjectID);
  }, [onProjectOpen]);

  const confirmDeleteProject = useCallback(async (project: ProjectRecord, confirmationDisplayName: string) => {
    const projectID = project.project_id.trim();
    if (!companyID.trim() || !projectID) return;
    setProjectDeleteConfirmation(null);
    setProjectContextMenu(null);
    setError("");
    const previousProjects = projects;
    setProjects((current) => current.filter((item) => item.project_id !== projectID));
    try {
      await deleteProject(companyID, projectID, confirmationDisplayName);
      scheduleProjectListReload();
      scheduleWorkspacePanelReload();
    } catch (deleteError) {
      setProjects(previousProjects);
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete project");
      void loadProjectList();
    }
  }, [companyID, loadProjectList, projects, scheduleProjectListReload, scheduleWorkspacePanelReload]);

  const saveProjectRename = useCallback(async () => {
    const project = projectRenameTarget;
    if (!project) return;
    const nextName = projectRenameDraft.trim();
    if (!nextName || nextName === project.name) {
      setProjectRenameTarget(null);
      setProjectRenameDraft("");
      return;
    }
    setProjectRenameSaving(true);
    setError("");
    try {
      const result = await updateProject({
        companyID,
        projectID: project.project_id,
        name: nextName,
        status: project.status || "Active",
        health: normalizeProjectHealth(project.health),
      });
      const renamed = result.project ?? { ...project, name: nextName };
      setProjects((current) => current.map((item) => item.project_id === project.project_id ? renamed : item));
      setProjectRenameTarget(null);
      setProjectRenameDraft("");
      scheduleProjectListReload();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename project");
    } finally {
      setProjectRenameSaving(false);
    }
  }, [companyID, projectRenameDraft, projectRenameTarget, scheduleProjectListReload]);

  const createNewProject = useCallback(async () => {
    setError("");
    try {
      const result = await createProject({
        companyID,
        name: "Untitled Project",
        status: "Active",
        health: "On Track",
      });
      if (result.project) {
        setProjects((current) => [result.project!, ...current.filter((project) => project.project_id !== result.project!.project_id)]);
        openProject(result.project.project_id);
      } else {
        await loadProjectList();
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create project");
    }
  }, [companyID, loadProjectList, openProject]);

  const showLocalProjectExplorer = false;

  const startVerticalResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    setResizeState({ kind: "vertical", pageTop: rect.top, pageHeight: rect.height });
  };

  if (activeProjectID) {
    return (
      <ProjectSummaryContent
        projectID={activeProjectID}
        accent={accent}
        workspace={workspace}
        onBack={() => setActiveProjectID("")}
        onNodeOpen={onNodeOpen}
        onLogicGateOpen={onLogicGateOpen}
        onOpenInNewTab={() => openAppPathInNewTab(buildProjectRoute(activeProjectID))}
        onCollapseToTab={onProjectCollapseToTab ? (target) => {
          onProjectCollapseToTab(target);
          setActiveProjectID("");
        } : undefined}
      />
    );
  }

  return (
    <div ref={pageRef} style={pageStyle(showLocalProjectExplorer, verticalSplit)}>
      <section style={timelineSurfaceStyle}>
        <div style={surfaceHeaderStyle}>
          <div style={titleClusterStyle}>
            <h2 style={surfaceTitleStyle}>Projects</h2>
            <div style={surfaceMetaStyle}>{viewMode === "timeline" ? `${shortDayLabel(weekDays[0])} - ${shortDayLabel(weekDays[WEEK_DAY_COUNT - 1])}` : `${projects.length} projects`}</div>
          </div>
          <div role="group" aria-label="Projects view" style={viewToggleStyle}>
            <span aria-hidden="true" style={viewToggleThumbStyle(viewMode)} />
            <button type="button" style={viewToggleButtonStyle(viewMode === "list")} onClick={() => setViewMode("list")}>List View</button>
            <button type="button" style={viewToggleButtonStyle(viewMode === "timeline")} onClick={() => setViewMode("timeline")}>Timeline View</button>
          </div>
          <div style={surfaceHeaderActionsStyle}>
          <ProjectGroupingControls
            groupBy={groupBy}
            subgroupBy={subgroupBy}
            onGroupByChange={setGroupBy}
            onSubgroupByChange={setSubgroupBy}
          />
          {viewMode === "timeline" ? (
            <>
              <CompanyPerspectiveSelector
                companyUsers={companyUsers}
                groups={groups}
                groupMembers={groupMembers}
                currentUserID={currentUserID}
                value={timelinePerspective}
                onChange={setTimelinePerspective}
                label="Timeline"
              />
              <AccountFilterControl
                accounts={timelineAccounts}
                selectedAccountIDs={timelineAccountFilterIDs}
                onChange={setTimelineAccountFilterIDs}
                label="Accounts"
                placeholder="Filter accounts"
                compact
              />
              <div style={weekControlsStyle}>
                <button type="button" aria-label="Previous week" style={iconButtonStyle} onClick={() => setWeekAnchor((current) => addDays(current, -WEEK_DAY_COUNT))}>{"<"}</button>
                <button type="button" style={todayButtonStyle} onClick={() => setWeekAnchor(weekStart(new Date()))}>Today</button>
                <button type="button" aria-label="Next week" style={iconButtonStyle} onClick={() => setWeekAnchor((current) => addDays(current, WEEK_DAY_COUNT))}>{">"}</button>
                <button type="button" style={secondaryButtonStyle} onClick={clearTimelinePerspective}>Clear</button>
              </div>
            </>
          ) : (
            <button type="button" style={primaryProjectButtonStyle(accent)} onClick={() => void createNewProject()}>New Project</button>
          )}
          </div>
        </div>
        <div style={timelineMessageSlotStyle}>
          {error && <div style={errorStyle}>{error}</div>}
        </div>
        {viewMode === "timeline" ? (
          <TimelineChart
            accent={accent}
            loading={loading || timelineLoading}
            weekDays={weekDays}
            rows={timelineDisplayRows}
            draft={barDraft}
            onDropEntity={addTimelineItem}
            onRemoveItem={removeTimelineItem}
            onDeleteNode={requestDeleteTimelineNode}
            onNodeOpen={onNodeOpen}
            onLogicGateOpen={onLogicGateOpen}
            contextMenu={timelineContextMenu}
            onOpenContextMenu={setTimelineContextMenu}
            onStartBarInteraction={setBarInteraction}
            onToggleGate={toggleTimelineGate}
          />
        ) : (
          <ProjectListTable
            projects={projects}
            loading={projectsLoading}
            groupBy={groupBy}
            subgroupBy={subgroupBy}
            onProjectOpen={openProject}
            onProjectContextMenu={(project, event) => {
              event.preventDefault();
              event.stopPropagation();
              setProjectContextMenu({ project, x: event.clientX, y: event.clientY });
            }}
          />
        )}
      </section>
      {showLocalProjectExplorer && (
        <>
          <div role="separator" aria-orientation="horizontal" style={verticalResizerStyle} onPointerDown={startVerticalResize} />
          <section style={bottomExplorerStyle}>
            <ProjectEntityExplorerPanel
              title="Company Explorer"
              rootLabel={`${companyPerspectiveLabel(explorerPerspective, companyUsers, groups, currentUserID)} Company Explorer`}
              rows={explorerRows}
              expanded={explorerExpanded}
              onSetExpanded={setExplorerExpanded}
              perspective={explorerPerspective}
              onPerspectiveChange={setExplorerPerspective}
              companyUsers={companyUsers}
              groups={groups}
              groupMembers={groupMembers}
              currentUserID={currentUserID}
              count={filteredNodes.length + filteredLogicGates.length}
              onNodeOpen={onNodeOpen}
              onAddEntity={addExplorerEntityToTimeline}
            />
          </section>
        </>
      )}
      {projectContextMenu ? (
        <div
          role="menu"
          style={projectContextMenuStyle(projectContextMenu.x, projectContextMenu.y)}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            style={projectContextMenuButtonStyle}
            onClick={() => {
              openAppPathInNewTab(buildProjectRoute(projectContextMenu.project.project_id));
              setProjectContextMenu(null);
            }}
          >
            Open in new browser tab
          </button>
          <button
            type="button"
            role="menuitem"
            style={projectContextMenuButtonStyle}
            onClick={() => {
              requestAppSidebarPin({
                kind: "project",
                id: projectContextMenu.project.project_id,
                name: projectContextMenu.project.name,
              });
              setProjectContextMenu(null);
            }}
          >
            Pin
          </button>
          <button
            type="button"
            role="menuitem"
            style={projectContextMenuButtonStyle}
            onClick={() => {
              setProjectRenameTarget(projectContextMenu.project);
              setProjectRenameDraft(projectContextMenu.project.name || "");
              setProjectContextMenu(null);
            }}
          >
            Rename Title
          </button>
          <button
            type="button"
            role="menuitem"
            style={{ ...projectContextMenuButtonStyle, color: "#dc2626" }}
            onClick={(event) => {
              setProjectDeleteConfirmation({
                project: projectContextMenu.project,
                position: confirmMenuPositionFromElement(event.currentTarget),
              });
            }}
          >
            Delete project
          </button>
        </div>
      ) : null}
      {projectRenameTarget ? (
        <AppModalPortal onRequestClose={projectRenameSaving ? undefined : () => setProjectRenameTarget(null)}>
        <div
          role="presentation"
          style={projectDeleteBackdropStyle}
          onPointerDown={() => {
            if (!projectRenameSaving) setProjectRenameTarget(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-rename-title"
            style={projectDeleteDialogStyle}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h3 id="project-rename-title" style={projectDeleteTitleStyle}>Rename project</h3>
            <input
              autoFocus
              value={projectRenameDraft}
              style={projectRenameInputStyle}
              onChange={(event) => setProjectRenameDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveProjectRename();
                }
              }}
            />
            <div style={projectDeleteActionsStyle}>
              <button type="button" style={projectDeleteCancelButtonStyle} disabled={projectRenameSaving} onClick={() => setProjectRenameTarget(null)}>Cancel</button>
              <button type="button" style={projectRenameSaveButtonStyle} disabled={projectRenameSaving} onClick={() => void saveProjectRename()}>
                {projectRenameSaving ? "Saving" : "Save"}
              </button>
            </div>
          </div>
        </div>
        </AppModalPortal>
      ) : null}
      {projectDeleteConfirmation ? (
        <ConfirmActionMenu
          title="Delete project?"
          detail={`Are you sure you want to delete ${projectDeleteConfirmation.project.name || "this project"}?`}
          position={projectDeleteConfirmation.position}
          confirmLabel="Yes, delete"
          cancelLabel="No"
          onConfirm={(confirmationDisplayName) => void confirmDeleteProject(projectDeleteConfirmation.project, confirmationDisplayName)}
          onCancel={() => setProjectDeleteConfirmation(null)}
        />
      ) : null}
      {timelineNodeDeleteConfirmation ? (
        <ConfirmActionMenu
          title="Delete node?"
          detail="This moves the underlying node to the Recycle Bin."
          position={timelineNodeDeleteConfirmation.position}
          confirmLabel="Yes, delete"
          cancelLabel="No"
          onConfirm={(confirmationDisplayName) => void deleteTimelineNode(timelineNodeDeleteConfirmation.item, confirmationDisplayName)}
          onCancel={() => setTimelineNodeDeleteConfirmation(null)}
        />
      ) : null}
      <div aria-hidden="true" data-project-management-scope={widgetId?.trim() || "project-management"} style={{ display: "none" }} />
    </div>
  );
};

function ProjectGroupingControls({
  groupBy,
  subgroupBy,
  onGroupByChange,
  onSubgroupByChange,
}: {
  groupBy: ProjectGroupingField;
  subgroupBy: ProjectGroupingField;
  onGroupByChange: (field: ProjectGroupingField) => void;
  onSubgroupByChange: (field: ProjectGroupingField) => void;
}) {
  return (
    <div style={projectGroupingControlsStyle}>
      <label style={projectGroupFieldStyle}>
        <span style={projectGroupAxisLabelStyle}>Group by</span>
        <select
          value={groupBy}
          style={projectGroupSelectStyle}
          onChange={(event) => {
            const next = event.currentTarget.value as ProjectGroupingField;
            onGroupByChange(next);
            if (!next) onSubgroupByChange("");
          }}
        >
          <option value="">None</option>
          {PROJECT_GROUP_FIELDS.map((field) => <option key={`group:${field.field}`} value={field.field}>{field.label}</option>)}
        </select>
      </label>
      <label style={projectGroupFieldStyle}>
        <span style={projectGroupAxisLabelStyle}>Subgroup</span>
        <select
          value={subgroupBy}
          style={projectGroupSelectStyle}
          disabled={!groupBy}
          onChange={(event) => onSubgroupByChange(event.currentTarget.value as ProjectGroupingField)}
        >
          <option value="">None</option>
          {PROJECT_GROUP_FIELDS.map((field) => <option key={`subgroup:${field.field}`} value={field.field}>{field.label}</option>)}
        </select>
      </label>
    </div>
  );
}

function normalizeProjectHealth(value: string | undefined | null): ProjectHealth {
  return PROJECT_HEALTH_OPTIONS.includes(value as ProjectHealth) ? value as ProjectHealth : "On Track";
}

function ProjectListTable({
  projects,
  loading,
  groupBy,
  subgroupBy,
  onProjectOpen,
  onProjectContextMenu,
}: {
  projects: ProjectRecord[];
  loading: boolean;
  groupBy: ProjectGroupingField;
  subgroupBy: ProjectGroupingField;
  onProjectOpen: (projectID: string) => void;
  onProjectContextMenu: (project: ProjectRecord, event: React.MouseEvent<HTMLTableRowElement>) => void;
}) {
  const [hoveredProjectID, setHoveredProjectID] = useState("");
  const sortedProjects = useMemo(() => [...projects].sort((left, right) => (
    left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }) ||
    left.project_id.localeCompare(right.project_id)
  )), [projects]);

  if (loading) {
    return <div style={projectListEmptyStyle}>Loading</div>;
  }

  const renderProjectRows = (items: ProjectRecord[]) => (
    <>
      {items.map((project) => (
        <tr
          key={project.project_id}
          style={projectRowStyle(hoveredProjectID === project.project_id)}
          onPointerEnter={() => setHoveredProjectID(project.project_id)}
          onPointerLeave={() => setHoveredProjectID((current) => current === project.project_id ? "" : current)}
          onClick={() => onProjectOpen(project.project_id)}
          onDoubleClick={() => onProjectOpen(project.project_id)}
          onContextMenu={(event) => onProjectContextMenu(project, event)}
        >
          <td style={projectNameCellStyle}>
            <span style={projectNameCellInnerStyle}>
              <span style={projectIconCellStyle}><ExplorerRowIcon kind="project" /></span>
              <span style={projectNameTextStyle}>{project.name || project.project_id}</span>
            </span>
          </td>
          <td style={projectCellStyle}><span style={projectStatusPillStyle}>{project.status || "Active"}</span></td>
          <td style={projectCellStyle}><span style={projectHealthPillStyle(normalizeProjectHealth(project.health))}>{normalizeProjectHealth(project.health)}</span></td>
          <td style={projectCellStyle}>{projectAccountLabel(project)}</td>
          <td style={projectCellStyle}>{projectTeamLabel(project)}</td>
        </tr>
      ))}
    </>
  );

  if (groupBy) {
    const effectiveSubgroupBy = subgroupBy && subgroupBy !== groupBy ? subgroupBy : "";
    const sections = buildGroupedSections(
      sortedProjects,
      projectGroupValues,
      groupBy,
      effectiveSubgroupBy,
    );
    return (
      <div className="kanban-board-scroll" style={projectListScrollStyle}>
        <div style={projectGroupedListStyle}>
          {sections.map((section) => (
            <section key={`y:${section.group.key}`} style={projectGroupedSectionStyle}>
              <div style={projectGroupHeaderStyle}>
                <span style={projectGroupHeaderAxisStyle}>Group by</span>
                <span style={projectGroupHeaderTextStyle}>{section.group.label}</span>
              </div>
              {section.buckets.map((bucket) => (
                <div key={`x:${section.group.key}:${bucket.group.key}`} style={projectGroupedBucketStyle}>
                  {effectiveSubgroupBy ? (
                    <div style={projectBucketHeaderStyle}>
                      <span style={projectGroupHeaderAxisStyle}>Subgroup</span>
                      <span style={projectBucketHeaderTextStyle}>{bucket.group.label}</span>
                      <span style={projectBucketCountStyle}>{bucket.items.length}</span>
                    </div>
                  ) : null}
                  <table style={projectTableStyle}>
                    <thead>
                      <tr>
                        <th style={projectHeaderCellStyle}>Project Name</th>
                        <th style={projectHeaderCellStyle}>Status</th>
                        <th style={projectHeaderCellStyle}>Health</th>
                        <th style={projectHeaderCellStyle}>Account</th>
                        <th style={projectHeaderCellStyle}>Team</th>
                      </tr>
                    </thead>
                    <tbody>{renderProjectRows(bucket.items)}</tbody>
                  </table>
                </div>
              ))}
            </section>
          ))}
          {sections.length === 0 ? <div style={projectListEmptyStyle}>No projects</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="kanban-board-scroll" style={projectListScrollStyle}>
      <table style={projectTableStyle}>
        <thead>
          <tr>
            <th style={projectHeaderCellStyle}>Project Name</th>
            <th style={projectHeaderCellStyle}>Status</th>
            <th style={projectHeaderCellStyle}>Health</th>
            <th style={projectHeaderCellStyle}>Account</th>
            <th style={projectHeaderCellStyle}>Team</th>
          </tr>
        </thead>
        <tbody>
          {renderProjectRows(sortedProjects)}
          {sortedProjects.length === 0 ? (
            <tr>
              <td colSpan={5} style={projectEmptyCellStyle}>No projects</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function TimelineChart({
  accent,
  loading,
  weekDays,
  rows,
  draft,
  onDropEntity,
  onRemoveItem,
  onDeleteNode,
  onNodeOpen,
  onLogicGateOpen,
  contextMenu,
  onOpenContextMenu,
  onStartBarInteraction,
  onToggleGate,
}: {
  accent: string;
  loading: boolean;
  weekDays: Date[];
  rows: TimelineDisplayRow[];
  draft: BarDraft | null;
  onDropEntity: (payload: ProjectTimelinePayload, startOffset: number) => void;
  onRemoveItem: (item: ProjectManagementTimelineRow) => void;
  onNodeOpen?: (nodeID: string) => void;
  onLogicGateOpen?: (logicGateID: string, returnContext?: ProjectLogicGateReturnContext) => void;
  contextMenu: TimelineContextMenuState | null;
  onOpenContextMenu: (state: TimelineContextMenuState | null) => void;
  onDeleteNode: (item: ProjectManagementTimelineRow, position?: ConfirmActionMenuPosition) => void;
  onStartBarInteraction: (interaction: BarInteraction) => void;
  onToggleGate: (gateID: string) => void;
}) {
  const [dropOffset, setDropOffset] = useState<number | null>(null);
  const weekStartDate = weekDays[0];
  const bodyRowCount = loading ? 3 : Math.max(rows.length, 6);
  const dayWidthForRect = (rect: DOMRect): number => Math.max(1, (rect.width - TIMELINE_LABEL_W) / WEEK_DAY_COUNT);
  const dayWidthForPointerEvent = (event: React.PointerEvent<HTMLElement>): number => {
    const grid = event.currentTarget.closest("[data-project-timeline-grid]");
    const rect = grid?.getBoundingClientRect();
    return rect ? dayWidthForRect(rect) : TIMELINE_MIN_DAY_W;
  };
  const dropOffsetForEvent = (event: React.DragEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const dayWidth = dayWidthForRect(rect);
    const x = event.clientX - rect.left - TIMELINE_LABEL_W;
    return clampInteger(Math.floor(x / dayWidth), 0, WEEK_DAY_COUNT - 1);
  };
  return (
    <div className="kanban-board-scroll" style={timelineScrollStyle}>
      <div
        data-project-timeline-grid="true"
        style={timelineGridStyle(bodyRowCount)}
        onDragOver={(event) => {
          if (!hasTimelinePayloadType(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDropOffset(dropOffsetForEvent(event));
        }}
        onDragLeave={() => setDropOffset(null)}
        onDrop={(event) => {
          const payload = readTimelinePayload(event.dataTransfer);
          if (!payload) return;
          event.preventDefault();
          onDropEntity(payload, dropOffsetForEvent(event));
          setDropOffset(null);
        }}
      >
        <div style={timelineCornerStyle}>Week</div>
        {weekDays.map((day, index) => (
          <div key={isoDate(day)} style={timelineHeaderCellStyle(index === dropOffset, accent)}>
            <span style={timelineHeaderDayStyle}>{shortDayLabel(day)}</span>
          </div>
        ))}
        {loading ? (
          <div style={{ ...timelineEmptyStyle, gridColumn: `1 / span ${WEEK_DAY_COUNT + 1}` }}>Loading</div>
        ) : rows.length > 0 ? rows.map((displayRow, rowIndex) => {
          if (displayRow.kind === "group") {
            return (
              <React.Fragment key={displayRow.id}>
                <div style={timelineGroupLabelStyle(rowIndex, displayRow.depth)}>
                  <span style={timelineGroupTextStyle}>{displayRow.label}</span>
                </div>
                {weekDays.map((day, dayIndex) => (
                  <div key={`${displayRow.id}:${isoDate(day)}`} style={timelineGroupCellStyle(rowIndex, dayIndex === dropOffset, accent)} />
                ))}
              </React.Fragment>
            );
          }
          const item = displayRow.item;
          const actualStartOffset = displayStartOffset(item, weekStartDate);
          const baseStart = clampInteger(actualStartOffset, 0, WEEK_DAY_COUNT - 1);
          const baseDuration = clampInteger(Math.min(item.duration_days, WEEK_DAY_COUNT - baseStart), 1, WEEK_DAY_COUNT - baseStart);
          const activeDraft = draft?.itemID === item.item_id ? draft : null;
          const startOffset = activeDraft?.startOffset ?? baseStart;
          const durationDays = activeDraft?.durationDays ?? baseDuration;
          const canInteractWithBar = displayRow.kind === "node";
          return (
            <React.Fragment key={displayRow.id}>
              <div
                style={timelineRowLabelStyle(rowIndex, displayRow.depth, displayRow.kind)}
                onDoubleClick={() => {
                  if (displayRow.kind === "logic_gate" && displayRow.gateID) onLogicGateOpen?.(displayRow.gateID);
                  if (displayRow.kind === "node") {
                    const nodeID = nodeIDForTimelineRow(item);
                    if (nodeID) onNodeOpen?.(nodeID);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenContextMenu({ item, x: event.clientX, y: event.clientY });
                }}
              >
                <span style={timelineTypeIconStyle(displayRow.kind)}>
                  <ExplorerRowIcon kind={displayRow.kind === "logic_gate" ? "logic_gate" : "node"} />
                </span>
                <span style={timelineRowTitleStyle}>{item.display_title}</span>
                {displayRow.kind === "node" ? <span style={timelineStatusStyle}>{item.status || "Node"}</span> : (
                  displayRow.canExpand && displayRow.gateID ? (
                    <button
                      type="button"
                      aria-label={`${displayRow.expanded ? "Collapse" : "Expand"} ${item.display_title}`}
                      aria-expanded={displayRow.expanded}
                      style={timelineGateDisclosureButtonStyle}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleGate(displayRow.gateID ?? "");
                      }}
                      onContextMenu={(event) => event.stopPropagation()}
                    >
                      <ExplorerDisclosureIcon open={Boolean(displayRow.expanded)} color="#059669" />
                    </button>
                  ) : <span aria-hidden="true" />
                )}
              </div>
              {weekDays.map((day, dayIndex) => (
                <div key={`${displayRow.id}:${isoDate(day)}`} style={timelineCellStyle(rowIndex, dayIndex === dropOffset, accent, displayRow.kind)} />
              ))}
              {displayRow.kind === "node" ? (
                <div
                  style={timelineBarStyle(item, rowIndex, startOffset, durationDays, canInteractWithBar)}
                  title={item.display_title}
                  onDoubleClick={() => {
                    const nodeID = nodeIDForTimelineRow(item);
                    if (nodeID) onNodeOpen?.(nodeID);
                  }}
                  onContextMenu={(event) => {
                    if (!canInteractWithBar) return;
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenContextMenu({ item, x: event.clientX, y: event.clientY });
                  }}
                  onPointerDown={(event) => {
                    if (!canInteractWithBar || event.button !== 0) return;
                    event.preventDefault();
                    onStartBarInteraction({ item, mode: "move", startX: event.clientX, dayWidth: dayWidthForPointerEvent(event), startOffset, durationDays });
                  }}
                >
                  <button
                    type="button"
                    aria-label={`Resize ${item.display_title} start`}
                    disabled={!canInteractWithBar}
                    tabIndex={canInteractWithBar ? 0 : -1}
                    style={barHandleStyle("left", canInteractWithBar)}
                    onPointerDown={(event) => {
                      if (!canInteractWithBar) return;
                      event.stopPropagation();
                      event.preventDefault();
                      onStartBarInteraction({ item, mode: "left", startX: event.clientX, dayWidth: dayWidthForPointerEvent(event), startOffset, durationDays });
                    }}
                  />
                  <span style={timelineBarLabelStyle}>{item.display_title}</span>
                  <button
                    type="button"
                    aria-label={`Resize ${item.display_title} end`}
                    disabled={!canInteractWithBar}
                    tabIndex={canInteractWithBar ? 0 : -1}
                    style={barHandleStyle("right", canInteractWithBar)}
                    onPointerDown={(event) => {
                      if (!canInteractWithBar) return;
                      event.stopPropagation();
                      event.preventDefault();
                      onStartBarInteraction({ item, mode: "right", startX: event.clientX, dayWidth: dayWidthForPointerEvent(event), startOffset, durationDays });
                    }}
                  />
                </div>
              ) : null}
            </React.Fragment>
          );
        }) : (
          <>
            {Array.from({ length: bodyRowCount }).map((_, rowIndex) => (
              <React.Fragment key={`empty-lane:${rowIndex}`}>
                <div style={timelineEmptyLaneLabelStyle(rowIndex, dropOffset !== null, accent)}>
                  {rowIndex === 0 ? (
                    <>
                      <span style={timelineLanePlusStyle}>+</span>
                      <span style={timelineLaneTextStyle}>Drop work here</span>
                    </>
                  ) : null}
                </div>
                {weekDays.map((day, dayIndex) => (
                  <div key={`empty-lane:${rowIndex}:${isoDate(day)}`} style={timelineCellStyle(rowIndex, dayIndex === dropOffset, accent)} />
                ))}
              </React.Fragment>
            ))}
            <div style={timelineEmptyOverlayStyle}>Drag a node or logic gate into the week, or use the + buttons in the lists below.</div>
          </>
        )}
      </div>
      {contextMenu ? (
        <div
          role="menu"
          style={timelineContextMenuStyle(contextMenu.x, contextMenu.y)}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            style={timelineContextMenuButtonStyle}
            onClick={() => onRemoveItem(contextMenu.item)}
          >
            {contextMenu.item.resource_type === "node" ? "Remove node from timeline" : "Remove gate from timeline"}
          </button>
          {contextMenu.item.resource_type === "node" && nodeIDForTimelineRow(contextMenu.item) ? (
            <button
              type="button"
              role="menuitem"
              style={{ ...timelineContextMenuButtonStyle, color: "#dc2626" }}
              onClick={(event) => onDeleteNode(contextMenu.item, confirmMenuPositionFromElement(event.currentTarget))}
            >
              Delete node
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProjectEntityExplorerPanel({
  title,
  rootLabel,
  rows,
  expanded,
  onSetExpanded,
  perspective,
  onPerspectiveChange,
  companyUsers,
  groups,
  groupMembers,
  currentUserID,
  count,
  onNodeOpen,
  onAddEntity,
}: {
  title: string;
  rootLabel: string;
  rows: ExplorerTreeNode[];
  expanded: Set<string>;
  onSetExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  perspective: CompanyPerspective;
  onPerspectiveChange: (perspective: CompanyPerspective) => void;
  companyUsers: CompanyUser[];
  groups: CompanyUserGroup[];
  groupMembers: CompanyUserGroupMember[];
  currentUserID: string;
  count: number;
  onNodeOpen?: (nodeID: string) => void;
  onAddEntity?: (payload: ProjectTimelinePayload) => void;
}) {
  const [rootOpen, setRootOpen] = useState(true);
  const toggleRow = (rowID: string) => {
    onSetExpanded((current) => {
      const next = new Set(current);
      if (next.has(rowID)) next.delete(rowID);
      else next.add(rowID);
      return next;
    });
  };
  return (
    <div style={entityPanelStyle}>
      <div style={entityPanelHeaderStyle}>
        <div style={titleClusterStyle}>
          <h3 style={entityPanelTitleStyle}>{title}</h3>
          <div style={surfaceMetaStyle}>{count} visible</div>
        </div>
        <CompanyPerspectiveSelector
          companyUsers={companyUsers}
          groups={groups}
          groupMembers={groupMembers}
          currentUserID={currentUserID}
          value={perspective}
          onChange={onPerspectiveChange}
          compact
        />
      </div>
      <div className="kanban-board-scroll" style={treeScrollStyle}>
        <button type="button" style={treeRootRowStyle} onClick={() => setRootOpen((open) => !open)}>
          <span style={treeDisclosureStyle}><ExplorerDisclosureIcon open={rootOpen} color="#64748b" /></span>
          <span style={treeIconStyle}><ExplorerRowIcon kind="folder" /></span>
          <span style={treeLabelStyle}>{rootLabel}</span>
        </button>
        {rootOpen && rows.map((row) => (
          <ProjectExplorerRow key={row.id} row={row} expanded={expanded} onToggle={toggleRow} onNodeOpen={onNodeOpen} onAddEntity={onAddEntity} />
        ))}
        {rootOpen && rows.length === 0 && <div style={emptyTreeStyle}>No nodes or logic gates</div>}
      </div>
    </div>
  );
}

function ProjectExplorerRow({
  row,
  expanded,
  onToggle,
  onNodeOpen,
  onAddEntity,
}: {
  row: ExplorerTreeNode;
  expanded: Set<string>;
  onToggle: (rowID: string) => void;
  onNodeOpen?: (nodeID: string) => void;
  onAddEntity?: (payload: ProjectTimelinePayload) => void;
}) {
  const isFolder = row.kind === "folder";
  const entityType: ProjectManagementEntityType | null = row.kind === "logic_gate" ? "logic_gate" : row.kind === "node" ? "node" : null;
  const entityID = entityType === "logic_gate" ? row.logicGateID : entityType === "node" ? row.nodeID : "";
  const color = entityType === "logic_gate" ? "#8b5cf6" : entityType === "node" ? "#0891b2" : "#64748b";
  const depth = Math.max(0, row.depth + 1);
  const draggable = !!entityType && !!entityID;
  const payload: ProjectTimelinePayload | null = entityType && entityID ? {
    entityType,
    entityID,
    label: row.label,
    color,
  } : null;
  const startDrag = (event: React.DragEvent<HTMLElement>) => {
    if (!payload) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(PROJECT_TIMELINE_ENTITY_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", row.label);
  };
  return (
    <div
      draggable={draggable}
      onDragStart={startDrag}
      onDoubleClick={() => {
        if (entityType === "node" && entityID) onNodeOpen?.(entityID);
      }}
      style={treeRowWrapStyle(depth, draggable)}
    >
      <div style={treeRowInnerStyle(draggable)}>
        {payload ? (
          <button
            type="button"
            aria-label={`Add ${row.label} to timeline`}
            title="Add to timeline"
            draggable={false}
            style={treeAddButtonStyle}
            onClick={(event) => {
              event.stopPropagation();
              onAddEntity?.(payload);
            }}
          >
            +
          </button>
        ) : null}
        <button
          type="button"
          draggable={draggable}
          style={treeRowButtonStyle(draggable)}
          onDragStart={startDrag}
          onClick={() => {
            if (isFolder) onToggle(row.id);
          }}
        >
          <span style={treeDisclosureStyle}>{isFolder ? <ExplorerDisclosureIcon open={expanded.has(row.id)} color="#64748b" /> : null}</span>
          <span style={{ ...treeIconStyle, color }}><ExplorerRowIcon kind={row.kind} /></span>
          <span style={treeLabelStyle}>{row.label}</span>
        </button>
      </div>
    </div>
  );
}

function pageStyle(showLocalProjectExplorer: boolean, verticalSplit: number): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    minHeight: 0,
    display: "grid",
    gridTemplateRows: showLocalProjectExplorer ? `minmax(260px, ${verticalSplit}%) 8px minmax(220px, 1fr)` : "minmax(0, 1fr)",
    gap: 0,
    padding: 12,
    borderRadius: 0,
    background: "linear-gradient(145deg, #f8fafc 0%, #eef2f7 100%)",
    boxSizing: "border-box",
    color: "#111827",
    overflow: "hidden",
  };
}

const timelineSurfaceStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr)",
  gap: 8,
  padding: 12,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 12,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(246, 247, 251, 0.92))",
  boxShadow: "9px 9px 20px rgba(174, 174, 192, 0.26), -8px -8px 18px rgba(255, 255, 255, 0.92), inset 1px 1px 0 rgba(255, 255, 255, 0.9)",
  boxSizing: "border-box",
  overflow: "hidden",
};

const verticalResizerStyle: React.CSSProperties = {
  cursor: "row-resize",
  borderRadius: 999,
  margin: "2px 34px",
  background: "linear-gradient(90deg, transparent, rgba(100, 116, 139, 0.34), transparent)",
};

const bottomExplorerStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  overflow: "hidden",
};

const surfaceHeaderStyle: React.CSSProperties = {
  minHeight: 38,
  display: "grid",
  gridTemplateColumns: "minmax(150px, 1fr) 224px minmax(220px, 1fr)",
  alignItems: "center",
  gap: 12,
};

const viewToggleStyle: React.CSSProperties = {
  position: "relative",
  width: 224,
  height: 34,
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  alignItems: "center",
  padding: 3,
  borderRadius: 999,
  background: "#e2e8f0",
  overflow: "hidden",
  boxSizing: "border-box",
};

const viewToggleThumbStyle = (viewMode: ProjectManagementViewMode): React.CSSProperties => ({
  position: "absolute",
  left: 3,
  top: 3,
  width: "calc((100% - 6px) / 2)",
  height: 28,
  borderRadius: 999,
  background: "#ffffff",
  boxShadow: "0 1px 4px rgba(15, 23, 42, 0.10)",
  transform: viewMode === "timeline" ? "translateX(100%)" : "translateX(0)",
  transition: "transform 190ms cubic-bezier(0.2, 0, 0, 1)",
  pointerEvents: "none",
});

const viewToggleButtonStyle = (active: boolean): React.CSSProperties => ({
  position: "relative",
  zIndex: 1,
  minHeight: 30,
  border: 0,
  borderRadius: 999,
  padding: "0 12px",
  background: "transparent",
  color: active ? "#0f172a" : "#64748b",
  fontSize: 12,
  fontWeight: 900,
  cursor: "pointer",
  transition: "color 160ms ease",
});

const surfaceHeaderActionsStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
  flexWrap: "wrap",
};

const projectGroupingControlsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 6,
  flexWrap: "wrap",
};

const projectGroupFieldStyle: React.CSSProperties = {
  height: 30,
  display: "inline-grid",
  gridTemplateColumns: "auto 120px",
  alignItems: "center",
  gap: 5,
  border: "1px solid rgba(148, 163, 184, 0.24)",
  borderRadius: 8,
  background: "#ffffff",
  padding: "0 5px 0 8px",
  boxSizing: "border-box",
};

const projectGroupAxisLabelStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 10,
  fontWeight: 950,
  whiteSpace: "nowrap",
};

const projectGroupSelectStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  border: 0,
  outline: "none",
  background: "transparent",
  color: "#0f172a",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 900,
};

const primaryProjectButtonStyle = (accent: string): React.CSSProperties => ({
  minHeight: 32,
  border: 0,
  borderRadius: 8,
  background: accent,
  color: "#ffffff",
  padding: "0 12px",
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: "0 8px 18px rgba(37, 99, 235, 0.16)",
});

const projectListScrollStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  border: "1px solid rgba(148, 163, 184, 0.20)",
  borderRadius: 10,
  background: "rgba(255, 255, 255, 0.82)",
};

const projectTableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  minWidth: 720,
  color: "#0f172a",
};

const projectGroupedListStyle: React.CSSProperties = {
  minWidth: 760,
  display: "grid",
  alignContent: "start",
  gap: 14,
  padding: 12,
  boxSizing: "border-box",
};

const projectGroupedSectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const projectGroupHeaderStyle: React.CSSProperties = {
  minHeight: 34,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  color: "#0f172a",
};

const projectGroupHeaderAxisStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 22,
  borderRadius: 999,
  padding: "0 8px",
  background: "#e2e8f0",
  color: "#475569",
  fontSize: 10,
  fontWeight: 950,
};

const projectGroupHeaderTextStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 950,
};

const projectGroupedBucketStyle: React.CSSProperties = {
  overflow: "hidden",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 8,
  background: "#ffffff",
};

const projectBucketHeaderStyle: React.CSSProperties = {
  minHeight: 34,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 12px",
  borderBottom: "1px solid rgba(226, 232, 240, 0.9)",
  background: "#f8fafc",
  boxSizing: "border-box",
};

const projectBucketHeaderTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#0f172a",
  fontSize: 13,
  fontWeight: 950,
};

const projectBucketCountStyle: React.CSSProperties = {
  marginLeft: "auto",
  color: "#64748b",
  fontSize: 11,
  fontWeight: 900,
};

const projectHeaderCellStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  height: 42,
  padding: "0 14px",
  background: "#f8fafc",
  borderBottom: "1px solid rgba(148, 163, 184, 0.26)",
  color: "#475569",
  fontSize: 12,
  fontWeight: 900,
  textAlign: "left",
};

const projectRowStyle = (hovered: boolean): React.CSSProperties => ({
  height: 48,
  cursor: "pointer",
  background: hovered ? "linear-gradient(90deg, rgba(236, 253, 245, 0.82), rgba(240, 249, 255, 0.76))" : "transparent",
  outline: hovered ? "2px solid rgba(14, 165, 233, 0.22)" : "2px solid transparent",
  outlineOffset: -2,
  transition: "background 150ms ease, outline-color 150ms ease",
});

const projectCellStyle: React.CSSProperties = {
  padding: "0 14px",
  borderBottom: "1px solid rgba(226, 232, 240, 0.9)",
  fontSize: 13,
  fontWeight: 700,
  color: "#334155",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};

const projectNameCellStyle: React.CSSProperties = {
  ...projectCellStyle,
  color: "#0f172a",
  fontWeight: 900,
};

const projectNameCellInnerStyle: React.CSSProperties = {
  minHeight: 48,
  display: "inline-flex",
  alignItems: "center",
  gap: 9,
  maxWidth: "100%",
  verticalAlign: "middle",
};

const projectIconCellStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const projectNameTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const projectStatusPillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 24,
  borderRadius: 999,
  padding: "0 9px",
  background: "rgba(16, 185, 129, 0.12)",
  color: "#047857",
  fontSize: 12,
  fontWeight: 900,
};

function projectHealthPillStyle(health: ProjectHealth): React.CSSProperties {
  const colors = health === "AT RISK"
    ? { background: "rgba(249, 115, 22, 0.14)", color: "#c2410c", border: "rgba(249, 115, 22, 0.30)" }
    : health === "Off Track"
      ? { background: "rgba(239, 68, 68, 0.13)", color: "#b91c1c", border: "rgba(239, 68, 68, 0.30)" }
      : { background: "rgba(16, 185, 129, 0.12)", color: "#047857", border: "rgba(16, 185, 129, 0.26)" };
  return {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 24,
    borderRadius: 999,
    border: `1px solid ${colors.border}`,
    padding: "0 9px",
    background: colors.background,
    color: colors.color,
    fontSize: 12,
    fontWeight: 950,
  };
}

const projectEmptyCellStyle: React.CSSProperties = {
  height: 120,
  textAlign: "center",
  color: "#64748b",
  fontWeight: 850,
};

const projectListEmptyStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(148, 163, 184, 0.20)",
  borderRadius: 10,
  background: "rgba(255, 255, 255, 0.82)",
  color: "#64748b",
  fontWeight: 850,
};

const titleClusterStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 2,
};

const surfaceTitleStyle: React.CSSProperties = {
  margin: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#111827",
  fontSize: 16,
  fontWeight: 950,
  letterSpacing: 0,
};

const surfaceMetaStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#64748b",
  fontSize: 11,
  fontWeight: 800,
};

const weekControlsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 6,
};

const iconButtonStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: "inline-grid",
  placeItems: "center",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 950,
  boxShadow: "4px 4px 10px rgba(174, 174, 192, 0.16), -4px -4px 10px rgba(255, 255, 255, 0.84)",
};

const todayButtonStyle: React.CSSProperties = {
  height: 30,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 900,
  padding: "0 10px",
  boxShadow: "4px 4px 10px rgba(174, 174, 192, 0.16), -4px -4px 10px rgba(255, 255, 255, 0.84)",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...todayButtonStyle,
  color: "#64748b",
};

const errorStyle: React.CSSProperties = {
  minHeight: 28,
  display: "flex",
  alignItems: "center",
  padding: "0 10px",
  border: "1px solid rgba(248, 113, 113, 0.28)",
  borderRadius: 8,
  background: "rgba(254, 242, 242, 0.82)",
  color: "#991b1b",
  fontSize: 11,
  fontWeight: 800,
};

const timelineMessageSlotStyle: React.CSSProperties = {
  minHeight: 0,
};

const timelineScrollStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  border: "1px solid rgba(148, 163, 184, 0.20)",
  borderRadius: 10,
  background: "rgba(255, 255, 255, 0.74)",
};

function timelineGridStyle(bodyRowCount: number): React.CSSProperties {
  return {
    position: "relative",
    display: "grid",
    gridTemplateColumns: `${TIMELINE_LABEL_W}px repeat(${WEEK_DAY_COUNT}, minmax(${TIMELINE_MIN_DAY_W}px, 1fr))`,
    gridTemplateRows: `${TIMELINE_HEADER_H}px repeat(${Math.max(1, bodyRowCount)}, ${TIMELINE_ROW_H}px)`,
    alignContent: "start",
    width: "100%",
    minWidth: TIMELINE_LABEL_W + WEEK_DAY_COUNT * TIMELINE_MIN_DAY_W,
    minHeight: "100%",
  };
}

const timelineCornerStyle: React.CSSProperties = {
  position: "sticky",
  left: 0,
  top: 0,
  zIndex: 8,
  display: "flex",
  alignItems: "center",
  padding: "0 12px",
  borderRight: "1px solid rgba(148, 163, 184, 0.20)",
  borderBottom: "1px solid rgba(148, 163, 184, 0.22)",
  background: "linear-gradient(145deg, rgba(248, 250, 252, 0.98), rgba(255, 255, 255, 0.92))",
  color: "#475569",
  fontSize: 11,
  fontWeight: 950,
  boxSizing: "border-box",
};

function timelineHeaderCellStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    position: "sticky",
    top: 0,
    zIndex: 7,
    display: "flex",
    alignItems: "center",
    padding: "0 10px",
    borderRight: "1px solid rgba(148, 163, 184, 0.16)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.22)",
    background: active ? `linear-gradient(145deg, rgba(239, 246, 255, 0.98), ${accent}18)` : "linear-gradient(145deg, rgba(248, 250, 252, 0.98), rgba(255, 255, 255, 0.92))",
    color: "#334155",
    boxSizing: "border-box",
  };
}

const timelineHeaderDayStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 950,
};

function timelineRowLabelStyle(rowIndex: number, depth = 0, kind: "logic_gate" | "node" = "node"): React.CSSProperties {
  return {
    position: "sticky",
    left: 0,
    zIndex: 5,
    gridColumn: 1,
    gridRow: rowIndex + 2,
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "22px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 7,
    padding: `0 10px 0 ${10 + depth * 22}px`,
    borderRight: "1px solid rgba(148, 163, 184, 0.18)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.13)",
    background: kind === "logic_gate"
      ? "linear-gradient(90deg, rgba(236, 253, 245, 0.98), rgba(255, 255, 255, 0.96))"
      : rowIndex % 2 === 0 ? "rgba(255, 255, 255, 0.96)" : "rgba(248, 250, 252, 0.96)",
    boxSizing: "border-box",
  };
}

function timelineCellStyle(rowIndex: number, active: boolean, accent: string, kind: "logic_gate" | "node" = "node"): React.CSSProperties {
  return {
    gridRow: rowIndex + 2,
    borderRight: "1px solid rgba(148, 163, 184, 0.13)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.13)",
    background: active ? `${accent}10` : kind === "logic_gate" ? "rgba(236, 253, 245, 0.52)" : rowIndex % 2 === 0 ? "rgba(255, 255, 255, 0.48)" : "rgba(248, 250, 252, 0.62)",
    boxSizing: "border-box",
  };
}

function timelineGroupLabelStyle(rowIndex: number, depth: number): React.CSSProperties {
  return {
    position: "sticky",
    left: 0,
    zIndex: 5,
    gridColumn: 1,
    gridRow: rowIndex + 2,
    display: "flex",
    alignItems: "center",
    padding: `0 12px 0 ${12 + depth * 18}px`,
    borderRight: "1px solid rgba(148, 163, 184, 0.18)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.16)",
    background: depth === 0 ? "#e2e8f0" : "#f1f5f9",
    color: "#0f172a",
    boxSizing: "border-box",
  };
}

const timelineGroupTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 950,
};

function timelineGroupCellStyle(rowIndex: number, active: boolean, accent: string): React.CSSProperties {
  return {
    gridRow: rowIndex + 2,
    borderRight: "1px solid rgba(148, 163, 184, 0.13)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.16)",
    background: active ? `${accent}12` : "#f8fafc",
    boxSizing: "border-box",
  };
}

function timelineBarStyle(item: ProjectManagementTimelineRow, rowIndex: number, startOffset: number, durationDays: number, interactive = true): React.CSSProperties {
  const start = clampInteger(startOffset, 0, WEEK_DAY_COUNT - 1);
  const duration = clampInteger(durationDays, 1, WEEK_DAY_COUNT - start);
  const color = rowColor(item);
  const textColor = readableTextColor(color);
  return {
    zIndex: 6,
    gridColumn: `${start + 2} / span ${duration}`,
    gridRow: rowIndex + 2,
    alignSelf: "center",
    minWidth: 0,
    height: 36,
    display: "grid",
    gridTemplateColumns: "8px minmax(0, 1fr) 8px",
    alignItems: "center",
    gap: 5,
    margin: "0 6px",
    padding: "0 6px",
    border: `1px solid ${color}`,
    borderRadius: 8,
    background: color,
    boxShadow: `0 8px 18px ${color}33, inset 1px 1px 0 rgba(255, 255, 255, 0.30)`,
    color: textColor,
    boxSizing: "border-box",
    cursor: interactive ? "grab" : "default",
    opacity: interactive ? 1 : 0.82,
  };
}

function barHandleStyle(side: "left" | "right", interactive = true): React.CSSProperties {
  return {
    width: 8,
    height: 28,
    border: 0,
    borderRadius: 4,
    background: "rgba(255, 255, 255, 0.54)",
    cursor: interactive ? side === "left" ? "w-resize" : "e-resize" : "default",
    padding: 0,
    opacity: interactive ? 1 : 0.55,
  };
}

const timelineBarLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 950,
};

function timelineContextMenuStyle(x: number, y: number): React.CSSProperties {
  return {
    position: "fixed",
    left: x,
    top: y,
    zIndex: 90,
    minWidth: 190,
    display: "grid",
    gap: 2,
    padding: 5,
    border: "1px solid rgba(100, 116, 139, 0.24)",
    borderRadius: 8,
    background: "rgba(255, 255, 255, 0.98)",
    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.18)",
    boxSizing: "border-box",
  };
}

const timelineContextMenuButtonStyle: React.CSSProperties = {
  minHeight: 30,
  width: "100%",
  border: 0,
  borderRadius: 6,
  background: "transparent",
  color: "#334155",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 850,
  textAlign: "left",
  padding: "0 9px",
};

function projectContextMenuStyle(x: number, y: number): React.CSSProperties {
  return {
    ...timelineContextMenuStyle(x, y),
    minWidth: 170,
  };
}

const projectContextMenuButtonStyle: React.CSSProperties = {
  ...timelineContextMenuButtonStyle,
};

const projectDeleteBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1,
  display: "grid",
  placeItems: "center",
  padding: 18,
  background: "rgba(15, 23, 42, 0.28)",
  boxSizing: "border-box",
};

const projectDeleteDialogStyle: React.CSSProperties = {
  width: "min(420px, 100%)",
  display: "grid",
  gap: 12,
  padding: 16,
  border: "1px solid rgba(148, 163, 184, 0.26)",
  borderRadius: 10,
  background: "#ffffff",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.24)",
  boxSizing: "border-box",
};

const projectDeleteTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#0f172a",
  fontSize: 16,
  fontWeight: 950,
};

const projectDeleteActionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

const projectDeleteCancelButtonStyle: React.CSSProperties = {
  minHeight: 32,
  border: "1px solid rgba(148, 163, 184, 0.26)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 900,
  padding: "0 12px",
};

const projectRenameInputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 36,
  border: "1px solid rgba(148, 163, 184, 0.30)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#0f172a",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 850,
  outline: "none",
  padding: "0 10px",
  boxSizing: "border-box",
};

const projectRenameSaveButtonStyle: React.CSSProperties = {
  ...projectDeleteCancelButtonStyle,
  border: "1px solid rgba(37, 99, 235, 0.26)",
  background: "#2563eb",
  color: "#ffffff",
};

const timelineEmptyStyle: React.CSSProperties = {
  gridRow: 2,
  display: "grid",
  placeItems: "center",
  color: "#64748b",
  fontSize: 12,
  fontWeight: 850,
  minHeight: 96,
};

function timelineEmptyLaneLabelStyle(rowIndex: number, active: boolean, accent: string): React.CSSProperties {
  return {
    ...timelineRowLabelStyle(rowIndex),
    gridTemplateColumns: "24px minmax(0, 1fr)",
    background: active && rowIndex === 0 ? `${accent}10` : rowIndex % 2 === 0 ? "rgba(255, 255, 255, 0.96)" : "rgba(248, 250, 252, 0.96)",
  };
}

const timelineLanePlusStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  display: "inline-grid",
  placeItems: "center",
  border: "1px solid rgba(14, 165, 233, 0.30)",
  borderRadius: 6,
  background: "rgba(240, 249, 255, 0.88)",
  color: "#0284c7",
  fontSize: 14,
  fontWeight: 950,
  lineHeight: 1,
};

const timelineLaneTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#64748b",
  fontSize: 11,
  fontWeight: 900,
};

const timelineEmptyOverlayStyle: React.CSSProperties = {
  zIndex: 4,
  gridColumn: `2 / span ${WEEK_DAY_COUNT}`,
  gridRow: "2 / span 6",
  alignSelf: "center",
  justifySelf: "center",
  maxWidth: 460,
  padding: "8px 12px",
  border: "1px solid rgba(148, 163, 184, 0.20)",
  borderRadius: 9,
  background: "rgba(255, 255, 255, 0.78)",
  color: "#64748b",
  fontSize: 12,
  fontWeight: 850,
  textAlign: "center",
  pointerEvents: "none",
  boxShadow: "4px 4px 12px rgba(174, 174, 192, 0.12), -4px -4px 12px rgba(255, 255, 255, 0.8)",
};

function timelineTypeIconStyle(kind: "logic_gate" | "node"): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    display: "inline-grid",
    placeItems: "center",
    border: kind === "logic_gate" ? "1px solid rgba(25, 240, 122, 0.34)" : "1px solid rgba(14, 165, 233, 0.24)",
    borderRadius: 6,
    background: kind === "logic_gate" ? "rgba(236, 253, 245, 0.86)" : "rgba(240, 249, 255, 0.78)",
    boxSizing: "border-box",
  };
}

const timelineGateDisclosureButtonStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  display: "inline-grid",
  placeItems: "center",
  justifySelf: "end",
  padding: 0,
  border: "1px solid rgba(16, 185, 129, 0.22)",
  borderRadius: 6,
  background: "rgba(255, 255, 255, 0.74)",
  color: "#059669",
  cursor: "pointer",
  boxShadow: "1px 1px 4px rgba(15, 23, 42, 0.06), -1px -1px 4px rgba(255, 255, 255, 0.86)",
};

const timelineRowTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#111827",
  fontSize: 11,
  fontWeight: 900,
};

const timelineStatusStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#64748b",
  fontSize: 10,
  fontWeight: 850,
};

const entityPanelStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
  padding: 12,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 12,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(246, 247, 251, 0.92))",
  boxShadow: "8px 8px 18px rgba(174, 174, 192, 0.18), -7px -7px 16px rgba(255, 255, 255, 0.86)",
  boxSizing: "border-box",
  overflow: "hidden",
};

const entityPanelHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(130px, 1fr) minmax(250px, auto)",
  alignItems: "start",
  gap: 10,
};

const entityPanelTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#111827",
  fontSize: 13,
  fontWeight: 950,
  letterSpacing: 0,
};

const treeScrollStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  padding: 8,
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 10,
  background: "rgba(255, 255, 255, 0.64)",
  boxSizing: "border-box",
};

const treeRootRowStyle: React.CSSProperties = {
  width: "100%",
  height: 32,
  display: "grid",
  gridTemplateColumns: "18px 20px minmax(0, 1fr)",
  alignItems: "center",
  gap: 6,
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.9))",
  color: "#334155",
  cursor: "pointer",
  padding: "0 10px",
  fontFamily: "inherit",
  boxSizing: "border-box",
  boxShadow: "4px 4px 10px rgba(174, 174, 192, 0.12), -4px -4px 10px rgba(255, 255, 255, 0.82)",
};

function treeRowWrapStyle(depth: number, draggable: boolean): React.CSSProperties {
  return {
    paddingLeft: depth * 16,
    cursor: draggable ? "grab" : "default",
  };
}

function treeRowInnerStyle(draggable: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: draggable ? "24px minmax(0, 1fr)" : "minmax(0, 1fr)",
    alignItems: "center",
    gap: 4,
  };
}

function treeRowButtonStyle(draggable: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: 30,
    display: "grid",
    gridTemplateColumns: "18px 20px minmax(0, 1fr)",
    alignItems: "center",
    gap: 6,
    border: 0,
    borderRadius: 7,
    background: "transparent",
    color: "#475569",
    cursor: draggable ? "grab" : "pointer",
    padding: "0 8px",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };
}

const treeAddButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: "inline-grid",
  placeItems: "center",
  border: "1px solid rgba(14, 165, 233, 0.28)",
  borderRadius: 7,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(240, 249, 255, 0.90))",
  color: "#0284c7",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 950,
  lineHeight: 1,
  padding: 0,
  boxShadow: "3px 3px 8px rgba(174, 174, 192, 0.14), -3px -3px 8px rgba(255, 255, 255, 0.86)",
};

const treeDisclosureStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: "grid",
  placeItems: "center",
};

const treeIconStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "grid",
  placeItems: "center",
};

const treeLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 800,
};

const emptyTreeStyle: React.CSSProperties = {
  minHeight: 80,
  display: "grid",
  placeItems: "center",
  color: "#94a3b8",
  fontSize: 12,
  fontWeight: 800,
};
