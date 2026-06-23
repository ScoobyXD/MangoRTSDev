import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { buildLogicGateRoute, buildProjectRoute } from "../../app/deepLinkRoutes";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { buildContextualNodeRoute, openAppPathInNewTab } from "../../app/resourceLinks";
import type { ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu";
import { getNodeTitle as getNodeRecordTitle, type NodeRecord } from "../node-map/shared";
import { getNodeTitle as getLogicGateRecordTitle, toLogicGateCanvasRecord, type LogicGateGVICRole, type LogicGateRecord as LogicGateApiRecord, type NodeRecord as LogicGateCanvasRecord } from "../logic-gate-map/shared";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED } from "../node-map/eventbus";
import { removeCompanyExplorerFolderInNodeRelationshipGraph, removeNodeRelationshipGraphNode, upsertCompanyExplorerFolderInNodeRelationshipGraph, upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../node-map/NodeRelationshipGraph";
import { removeCompanyExplorerFolderInLogicGateRelationshipGraph, removeLogicGateRelationshipGraphNode, upsertCompanyExplorerFolderInLogicGateRelationshipGraph, upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../logic-gate-map/LogicGateRelationshipGraph";
import { type ExplorerSelectionState } from "./explorerSync";
import { type CompanyExplorerFolder, type CompanyExplorerFolderItem, type CompanyExplorerFolderKind, type CompanyExplorerFolderScopeType, type CompanyExplorerItemType, type CompanyExplorerSystemFolderKey } from "../folders/companyExplorerFolders";
import { invalidateKanbanBoardListCache, listKanbanBoards, type GVICMatrixProjectionRow } from "../kanban/kanbanApi";
import { EVENT_KANBAN_BOARDS_UPDATED, logicGateKanbanBoardID, type ExplorerEntityDragItem, type KanbanBoardsUpdatedDetail } from "../kanban/shared";
import { type SelectionIntent } from "../selectionCoordinator";
import { companyExplorerRealtimeScope, subscribeWorkspaceUserRealtime, type WorkspaceStreamGapSignal } from "../workspace/workspaceRealtime";
import { createWorkspaceEntityBatchClientID, createWorkspaceEntityBatchCommand, type WorkspaceEntityBatchCreatorLogicGateGVICRole } from "../workspace/workspaceEntityCommands";
import { buildExplorerFindSelection, buildExplorerRowBatchReorderPlan, buildExplorerRowReorderPlan, buildExplorerSearchViewRows, getExplorerDropPayloadItemType, getExplorerDropPayloadItemTypes, getExplorerDropPayloadItems, getExplorerScrollTopForRow, isExplorerSystemFolderKey, resolveExplorerClickSelection, resolveExplorerCreationTargets, resolveExplorerDeleteTarget, resolveExplorerRenameTarget, type ExplorerFindEntity } from "./treePresentation";
import { CompanyExplorerContextMenu } from "./CompanyExplorerContextMenu";
import { CompanyExplorerDeleteBlockedDialog, CompanyExplorerDeleteConfirmationDialog } from "./CompanyExplorerDialogs";
import { CompanyExplorerTree } from "./CompanyExplorerTree";
import {
  collectFolderSubtreeIDs,
  explorerRowOrder,
  getExplorerItemPayload,
  getExplorerRowContainerID,
  getExplorerRowOrderKind,
  getExplorerSelectionDomain,
  readRootRowOrderFromStorage,
  readScrollTopFromStorage,
  TREE_ROW_POSITION_STEP,
} from "./companyExplorerDragDrop";
import {
  type CompanyExplorerContextMenuState,
  type CompanyExplorerFolderPermissionsTarget,
  type CompanyExplorerOpenInNewTabTarget,
  type ExplorerDeleteTargetWithLabel,
  type ExplorerDragPayload,
  type ExplorerRenameDraft,
  type ExplorerRowDropPlacement,
  type ExplorerRowOrderUpdate,
  type ExplorerSelectionDomain,
  type ExplorerTreeNode,
} from "./companyExplorerTypes";
import { useCompanyExplorerKeyboard } from "./useCompanyExplorerKeyboard";
import { useCompanyExplorerSelectionBridge } from "./useCompanyExplorerSelectionBridge";
import { useCompanyExplorerTreeModel } from "./useCompanyExplorerTreeModel";
import { COMPANY_EXPLORER_TREE_ROW_HEIGHT, useCompanyExplorerVirtualTree } from "./useCompanyExplorerVirtualTree";
import { buildCompanyExplorerSearchTreeRows, buildCompanyExplorerTreeRows, buildScopedCompanyExplorerTreeRows, findCompanyExplorerRootFolderByName } from "./companyExplorerTreeRows";
import { EntityPermissionsDialog } from "../permissions/EntityPermissionsDialog";
import { fetchCurrentUser } from "../../auth/cognitoAuth";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { createRequestJSON } from "../api/requestJSON";
import { convertTriageMessagesToExplorerTarget, listCompanyUserGroups, listCompanyUsers, type CommunicationsTriageConversionTarget, type CompanyUser, type CompanyUserGroup, type CompanyUserGroupMember } from "../communications/communicationsApi";
import { createProject, type ProjectRecord } from "../project-management/projectManagementApi";
import { assignNodeToLogicGateStatus, moveLogicGateAssignment } from "../kanban/kanbanApi";
import { listMyLogicGates, listGVICMatrixProjectionRows, type WorkItemLogicGateInboxItem } from "../work-items/workItemReadApi";
import {
  buildDeleteConfirmationSummary,
  createInitialCompanyExplorerExpandedRows,
  findProtectedSystemFolderInDeleteTargets,
  getSystemFolderKeyForTreeRowID,
  type CompanyExplorerContentProps,
  type CompanyExplorerFolderItemAssignment,
  type CompanyExplorerSearchResultSummary,
  type CompanyExplorerTriageMessageDropHandler,
  type CompanyExplorerTriageMessageDropTarget,
  type CompanyExplorerWorkspaceEntityBatchResponse,
} from "./CompanyExplorerContentModel";
import {
  companyExplorerAffectedScopesFromEnvelope,
  companyExplorerRefreshPlanFromAffectedScopes,
  createCompanyExplorerStoreState,
  reduceCompanyExplorerStore,
  shouldInvalidateKanbanBoardListForExplorerEnvelope,
  shouldRefreshCompanyExplorerSnapshotForGap,
  shouldRefreshKanbanBoardsAfterUpdate,
  type CompanyExplorerWorkspaceStreamEnvelope,
} from "./companyExplorerStore";
import { fetchCompanyExplorerChildren, fetchCompanyExplorerRoots, fetchCompanyExplorerSearchResults, type CompanyExplorerLazyScope, type CompanyExplorerSearchResult, type CompanyExplorerV2Row } from "./companyExplorerLazyApi";
import { shouldIncludeGVICCustomRootFolder, shouldShowGVICCompanyScopedFolderShell } from "./companyExplorerGVICVisibility";

const scopedRootCreationKeys = new Set<string>();
const GVICVisualRootCreationKeys = new Set<string>();
const LIGHT_EXPLORER_CYAN_ACCENT = "rgb(71, 85, 105)";
const COMPANY_EXPLORER_TRIAGE_DROP_PRIORITIES = [1, 2, 3, 4, 5] as const;
const companyExplorerTriageDropMenuButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 31,
  border: "none",
  background: "transparent",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  textAlign: "left",
  padding: "0 12px",
};
const HIDDEN_MAIN_EXPLORER_ROOT_FOLDER_LABELS = ["logic gates by function", "logic gates by person"] as const;
const HIDDEN_MAIN_EXPLORER_ROOT_FOLDER_NAMES = new Set<string>(HIDDEN_MAIN_EXPLORER_ROOT_FOLDER_LABELS);
type CompanyExplorerScopeView = "mine" | "team" | "company";
type ExplorerLogicGateRecord = LogicGateCanvasRecord & Partial<Pick<LogicGateApiRecord, "gvic_assignments">>;
type CompanyExplorerGVICFolderRole = LogicGateGVICRole | "other";
type GVICProjectionCacheEntry = { rows: GVICMatrixProjectionRow[]; logicGates: ExplorerLogicGateRecord[]; loaded: boolean };
type ExplorerUserSummary = { userID: string; label: string; email?: string };
type ExplorerGroupSummary = { groupID: string; label: string; users: ExplorerUserSummary[]; children: ExplorerGroupSummary[] };
type CompanyExplorerInternalTriageDropMenu = { target: CompanyExplorerTriageMessageDropTarget; messageIDs: string[]; x: number; y: number };

function getOpenInNewTabTargetForExplorerRow(row?: ExplorerTreeNode | null): CompanyExplorerOpenInNewTabTarget | null {
  if (!row) return null;
  if (row.kind === "node" && row.nodeID) return { kind: "node", id: row.nodeID };
  if (row.kind === "logic_gate" && row.logicGateID) return { kind: "logic_gate", id: row.logicGateID };
  if (row.kind === "project" && row.projectID) return { kind: "project", id: row.projectID };
  return null;
}

function openCompanyExplorerTargetInNewTab(target: CompanyExplorerOpenInNewTabTarget): void {
  if (target.kind === "node") openAppPathInNewTab(buildContextualNodeRoute(target.id));
  else if (target.kind === "logic_gate") openAppPathInNewTab(buildLogicGateRoute(target.id));
  else openAppPathInNewTab(buildProjectRoute(target.id));
}

function companyExplorerLazyScopeForView(scopeView: CompanyExplorerScopeView, scopeViewsEnabled: boolean): CompanyExplorerLazyScope {
  void scopeView;
  void scopeViewsEnabled;
  return "all";
}

function defaultCompanyExplorerScopeView(): CompanyExplorerScopeView {
  return "company";
}

const GVIC_FOLDER_ROWS = [
  { role: "generated", label: "Generated" },
  { role: "verified", label: "Verified" },
  { role: "consulted", label: "Consulted" },
  { role: "informed", label: "Informed" },
  { role: "other", label: "Others" },
] as const satisfies ReadonlyArray<{ role: CompanyExplorerGVICFolderRole; label: string }>;

const LOGIC_GATE_GVIC_ROLES: LogicGateGVICRole[] = ["generated", "verified", "consulted", "informed"];
const GVIC_PROJECTION_LIMIT = 500;
const GVIC_VISUAL_ROOT_FOLDER_PREFIX = "Mango GVIC ";
const DEFAULT_FOLDERS_LABEL = "Default Folders";
const USE_SYNTHETIC_COMPANY_EXPLORER_SCOPE_ROWS = false;

function normalizeExplorerFolderName(value: string): string {
  return value.trim().toLowerCase();
}

function GVICVisualRootFolderName(role: CompanyExplorerGVICFolderRole): string {
  const label = GVIC_FOLDER_ROWS.find((folder) => folder.role === role)?.label ?? role;
  return `${GVIC_VISUAL_ROOT_FOLDER_PREFIX}${label}`;
}

function isGVICVisualRootFolderName(value: string): boolean {
  const normalized = normalizeExplorerFolderName(value);
  return GVIC_FOLDER_ROWS.some((folder) => normalized === normalizeExplorerFolderName(GVICVisualRootFolderName(folder.role)));
}

const HIDDEN_CUSTOM_EXPLORER_ROOT_FOLDER_NAMES = [
  ...HIDDEN_MAIN_EXPLORER_ROOT_FOLDER_LABELS,
  ...GVIC_FOLDER_ROWS.map((folder) => GVICVisualRootFolderName(folder.role)),
];

function GVICVisualRootFolderForRole(folders: CompanyExplorerFolder[], role: CompanyExplorerGVICFolderRole): CompanyExplorerFolder | null {
  const targetName = normalizeExplorerFolderName(GVICVisualRootFolderName(role));
  return [...folders]
    .filter((folder) =>
      folder.folder_kind === "logic_gate"
      && !folder.parent_folder_id
      && normalizeExplorerFolderName(folder.name) === targetName
    )
    .sort((a, b) => a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp) || a.folder_id.localeCompare(b.folder_id))[0] ?? null;
}

function shouldHideMainExplorerRootFolder(row: ExplorerTreeNode): boolean {
  return row.kind === "folder"
    && row.folderKind === "logic_gate"
    && !row.parentFolderID
    && (
      HIDDEN_MAIN_EXPLORER_ROOT_FOLDER_NAMES.has(normalizeExplorerFolderName(row.label))
      || isGVICVisualRootFolderName(row.label)
    );
}

function hideMainExplorerRootFolders(rows: ExplorerTreeNode[]): ExplorerTreeNode[] {
  const filtered: ExplorerTreeNode[] = [];
  let hiddenDepth: number | null = null;
  for (const row of rows) {
    if (hiddenDepth !== null) {
      if (row.depth > hiddenDepth) continue;
      hiddenDepth = null;
    }
    if (shouldHideMainExplorerRootFolder(row)) {
      hiddenDepth = row.depth;
      continue;
    }
    filtered.push(row);
  }
  return filtered;
}

function shouldRefreshGVICExplorerProjectionForGap(gap: WorkspaceStreamGapSignal, companyID: string): boolean {
  if (gap.companyID !== companyID) return false;
  return gap.scopes.some((scope) => scope.kind === "gvic_matrix" || scope.kind === "workspace");
}

function shouldRefreshGVICExplorerProjectionForEnvelope(companyID: string, envelope: CompanyExplorerWorkspaceStreamEnvelope): boolean {
  if (envelope.company_id !== companyID) return false;
  const type = envelope.type?.trim() ?? "";
  return type === "node_created"
    || type === "node_updated"
    || type === "node_deleted"
    || type === "node_permissions_updated"
    || type === "logic_gate_created"
    || type === "logic_gate_updated"
    || type === "logic_gate_deleted"
    || type === "logic_gate_gvic_updated"
    || type === "logic_gate_permissions_updated"
    || type.startsWith("work_item.");
}

function cleanExplorerID(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function cleanExplorerIDs(values: string[]): string[] {
  return Array.from(new Set(values.map(cleanExplorerID).filter(Boolean)));
}

function companyExplorerTriageConversionTarget(target: CompanyExplorerTriageMessageDropTarget): CommunicationsTriageConversionTarget | null {
  switch (target.kind) {
    case "folder": {
      const folderID = cleanExplorerID(target.folderID);
      const parentEntityID = cleanExplorerID(target.parentEntityID);
      return { mode: "folder", folderID: folderID || undefined, parentEntityID: parentEntityID || undefined };
    }
    case "project": {
      const projectID = cleanExplorerID(target.projectID);
      return projectID ? { mode: "project", projectID } : null;
    }
    case "logic_gate": {
      const logicGateID = cleanExplorerID(target.logicGateID);
      return logicGateID ? { mode: "existing_logic_gate", logicGateID } : null;
    }
    case "node": {
      const nodeID = cleanExplorerID(target.nodeID);
      const logicGateID = cleanExplorerID(target.logicGateID);
      return nodeID ? { mode: "existing_node", nodeID, logicGateID: logicGateID || undefined } : null;
    }
    default:
      return null;
  }
}

function companyExplorerEnvelopeParentEntityID(data: Record<string, unknown>): string | null {
  if (typeof data.parent_entity_id === "string") return cleanExplorerID(data.parent_entity_id);
  if (data.entity && typeof data.entity === "object" && !Array.isArray(data.entity)) {
    const entity = data.entity as { parent_entity_id?: unknown };
    if (typeof entity.parent_entity_id === "string") return cleanExplorerID(entity.parent_entity_id);
  }
  return null;
}

function companyExplorerUserLabel(user: Pick<CompanyUser, "user_id" | "display_name" | "email"> | null | undefined, fallbackUserID: string): string {
  return user?.display_name?.trim() || user?.email?.trim() || fallbackUserID.trim() || "Unknown user";
}

function companyExplorerGroupLabel(group: Pick<CompanyUserGroup, "group_id" | "name"> | null | undefined, fallbackGroupID: string): string {
  return group?.name?.trim() || fallbackGroupID.trim() || "Team";
}

function compareExplorerLabels(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function uniqueCleanIDs(values: string[]): string[] {
  return Array.from(new Set(values.map(cleanExplorerID).filter(Boolean)));
}

function explorerUserSummaryForID(userID: string, usersByID: Map<string, CompanyUser>, members: CompanyUserGroupMember[]): ExplorerUserSummary {
  const cleanUserID = cleanExplorerID(userID);
  const user = usersByID.get(cleanUserID);
  const member = members.find((item) => cleanExplorerID(item.user_id) === cleanUserID);
  return {
    userID: cleanUserID,
    label: companyExplorerUserLabel(user ?? null, member?.user_display_name?.trim() || member?.user_email?.trim() || cleanUserID),
    email: user?.email?.trim() || member?.user_email?.trim() || undefined,
  };
}

function sortExplorerUsers(users: ExplorerUserSummary[]): ExplorerUserSummary[] {
  return [...users].sort((left, right) => (
    compareExplorerLabels(left.label, right.label)
    || compareExplorerLabels(left.email ?? "", right.email ?? "")
    || left.userID.localeCompare(right.userID)
  ));
}

function projectedLogicGateRecordForUser(logicGate: WorkItemLogicGateInboxItem, userID: string, companyID: string): ExplorerLogicGateRecord {
  const cleanUserID = cleanExplorerID(userID);
  const record = toLogicGateCanvasRecord(logicGate) as ExplorerLogicGateRecord;
  record.gvic_assignments = (logicGate.roles ?? []).filter(isLogicGateGVICRole).map((role) => ({
    company_id: companyID,
    logic_gate_id: logicGate.logic_gate_id,
    role,
    user_id: cleanUserID,
    created_timestamp: logicGate.created_timestamp ?? "",
  }));
  return record;
}

function logicGateOwnedByAnyUser(logicGate: ExplorerLogicGateRecord, userIDs: Set<string>): boolean {
  if (userIDs.size === 0) return false;
  return (logicGate.gvic_assignments ?? []).some((assignment) => userIDs.has(cleanExplorerID(assignment.user_id)));
}

function companyUserGroupDescendantIDs(groups: CompanyUserGroup[], rootGroupIDs: Set<string>): Set<string> {
  const ids = new Set(rootGroupIDs);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      const groupID = cleanExplorerID(group.group_id);
      const parentID = cleanExplorerID(group.parent_group_id);
      if (!groupID || !parentID || !ids.has(parentID) || ids.has(groupID)) continue;
      ids.add(groupID);
      changed = true;
    }
  }
  return ids;
}

function teamMemberUserIDsForCurrentUser(groups: CompanyUserGroup[], members: CompanyUserGroupMember[], currentUserID: string): Set<string> {
  const cleanCurrentUserID = currentUserID.trim();
  const ownGroupIDs = new Set(
    members
      .filter((member) => cleanExplorerID(member.user_id) === cleanCurrentUserID)
      .map((member) => cleanExplorerID(member.group_id))
      .filter(Boolean),
  );
  const accessibleGroupIDs = companyUserGroupDescendantIDs(groups, ownGroupIDs);
  const userIDs = new Set<string>();
  if (cleanCurrentUserID) userIDs.add(cleanCurrentUserID);
  for (const member of members) {
    if (accessibleGroupIDs.has(cleanExplorerID(member.group_id))) {
      const userID = cleanExplorerID(member.user_id);
      if (userID) userIDs.add(userID);
    }
  }
  return userIDs;
}

function addFolderAncestors(folderID: string, folderByID: Map<string, CompanyExplorerFolder>, target: Set<string>): void {
  let currentID = folderID.trim();
  const seen = new Set<string>();
  while (currentID && !seen.has(currentID)) {
    seen.add(currentID);
    const folder = folderByID.get(currentID);
    if (!folder) break;
    target.add(folder.folder_id);
    currentID = folder.parent_folder_id?.trim() ?? "";
  }
}

function filterCompanyExplorerDataForScope(input: {
  scopeView: CompanyExplorerScopeView;
  currentUserID: string;
  teamMemberUserIDs: Set<string>;
  nodes: NodeRecord[];
  logicGates: ExplorerLogicGateRecord[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
}): {
  nodes: NodeRecord[];
  logicGates: ExplorerLogicGateRecord[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
} {
  if (input.scopeView === "company") {
    return {
      nodes: input.nodes,
      logicGates: input.logicGates,
      folders: input.folders,
      folderItems: input.folderItems,
    };
  }

  const ownerUserIDs = input.scopeView === "team"
    ? input.teamMemberUserIDs
    : new Set([input.currentUserID.trim()].filter(Boolean));
  if (ownerUserIDs.size === 0) {
    return {
      nodes: input.nodes,
      logicGates: input.logicGates,
      folders: input.folders,
      folderItems: input.folderItems,
    };
  }

  const visibleLogicGateIDs = new Set(
    input.logicGates
      .filter((logicGate) => logicGateOwnedByAnyUser(logicGate, ownerUserIDs))
      .map((logicGate) => logicGate.logic_gate_id),
  );
  const visibleNodeIDs = new Set<string>();
  for (const node of input.nodes) {
    if ((node.logic_gate_ids ?? []).some((logicGateID) => visibleLogicGateIDs.has(cleanExplorerID(logicGateID)))) {
      visibleNodeIDs.add(node.node_id);
    }
  }

  const folderByID = new Map(input.folders.map((folder) => [folder.folder_id, folder]));
  const visibleFolderIDs = new Set<string>();
  const scopedFolderItems = input.folderItems.filter((item) => {
    const visible = item.item_type === "node"
      ? visibleNodeIDs.has(item.item_id)
      : item.item_type === "logic_gate"
        ? visibleLogicGateIDs.has(item.item_id)
        : false;
    if (visible) addFolderAncestors(item.folder_id, folderByID, visibleFolderIDs);
    return visible;
  });

  return {
    nodes: input.nodes.filter((node) => visibleNodeIDs.has(node.node_id)),
    logicGates: input.logicGates.filter((logicGate) => visibleLogicGateIDs.has(logicGate.logic_gate_id)),
    folders: input.folders,
    folderItems: scopedFolderItems,
  };
}

function GVICFolderTreeID(role: CompanyExplorerGVICFolderRole): string {
  return `GVIC-folder-${role}`;
}

function GVICDefaultFoldersTreeID(): string {
  return "GVIC-default-folders";
}

function teamDefaultFoldersTreeID(): string {
  return "team-default-folders";
}

function companyDefaultFoldersTreeID(): string {
  return "company-default-folders";
}

function GVICLogicGateTreeID(role: CompanyExplorerGVICFolderRole, logicGateID: string): string {
  return `GVIC-${role}-logic-gate-${logicGateID}`;
}

function GVICNodeTreeID(role: CompanyExplorerGVICFolderRole, logicGateID: string, nodeID: string): string {
  return `GVIC-${role}-logic-gate-${logicGateID}-node-${nodeID}`;
}

function GVICNoLogicGateTreeID(role: CompanyExplorerGVICFolderRole): string {
  return `GVIC-${role}-no-logic-gate`;
}

function GVICNoLogicGateNodeTreeID(role: CompanyExplorerGVICFolderRole, nodeID: string): string {
  return `GVIC-${role}-no-logic-gate-node-${nodeID}`;
}

function GVICVisualLogicGateTreeID(role: CompanyExplorerGVICFolderRole, folderID: string, logicGateID: string): string {
  return `GVIC-${role}-folder-${folderID}-logic-gate-${logicGateID}`;
}

function GVICVisualNodeTreeID(role: CompanyExplorerGVICFolderRole, folderID: string, nodeID: string): string {
  return `GVIC-${role}-folder-${folderID}-node-${nodeID}`;
}

function isProtectedGVICRoleRow(row: ExplorerTreeNode | null | undefined): boolean {
  return row?.syntheticKind === "GVIC_folder" || row?.syntheticKind === "default_scope_folder";
}

function isGVICScopedRow(row: ExplorerTreeNode | null | undefined): boolean {
  return row?.syntheticKind === "GVIC_folder" || Boolean(row?.GVICRole);
}

function isLogicGateGVICRole(value: CompanyExplorerGVICFolderRole | string | undefined): value is LogicGateGVICRole {
  return LOGIC_GATE_GVIC_ROLES.includes(value as LogicGateGVICRole);
}

function logicGateGVICRolesForUser(logicGate: ExplorerLogicGateRecord, userID: string): CompanyExplorerGVICFolderRole[] {
  const cleanUserID = cleanExplorerID(userID);
  if (!cleanUserID) return ["other"];
  const roles = LOGIC_GATE_GVIC_ROLES.filter((role) => (
    (logicGate.gvic_assignments ?? []).some((assignment) => assignment.role === role && cleanExplorerID(assignment.user_id) === cleanUserID)
  ));
  return roles.length > 0 ? roles : ["other"];
}

function projectionRowMatchesUser(row: GVICMatrixProjectionRow, companyID: string, userID: string): boolean {
  return cleanExplorerID(row.company_id) === cleanExplorerID(companyID)
    && cleanExplorerID(row.user_id) === cleanExplorerID(userID)
    && Boolean(cleanExplorerID(row.projection_row_id))
    && Boolean(cleanExplorerID(row.node_id));
}

function materializeProjectionNode(row: GVICMatrixProjectionRow, previous: NodeRecord | undefined): NodeRecord | null {
  const nodeID = cleanExplorerID(row.node_id);
  if (!nodeID) return null;
  const logicGateID = cleanExplorerID(row.logic_gate_id);
  return {
    ...previous,
    company_id: cleanExplorerID(row.company_id) || previous?.company_id || "",
    node_id: nodeID,
    name: row.node_name || previous?.name || "Untitled node",
    status: row.status ?? null,
    due_date: row.due_date ?? null,
    priority: row.priority ?? null,
    accounts: (row.accounts ?? previous?.accounts ?? []).map((account) => ({ ...account })),
    logic_gate_ids: logicGateID ? [logicGateID] : [],
    created_timestamp: row.created_timestamp || previous?.created_timestamp || "",
    effective_access_level: previous?.effective_access_level ?? "edit",
    can_view: previous?.can_view ?? true,
    can_edit: previous?.can_edit ?? true,
    can_admin: previous?.can_admin ?? false,
  };
}

function materializeProjectionLogicGate(
  logicGateID: string,
  logicGateName: string,
  previous: ExplorerLogicGateRecord | undefined,
  projected: ExplorerLogicGateRecord | undefined,
): ExplorerLogicGateRecord | null {
  logicGateID = cleanExplorerID(logicGateID);
  if (!logicGateID) return null;
  const header = logicGateName || projected?.header || previous?.header || previous?.title || "Untitled Logic Gate";
  return {
    ...previous,
    ...projected,
    company_id: projected?.company_id || previous?.company_id || "",
    logic_gate_id: logicGateID,
    node_id: logicGateID,
    title: header,
    header,
    created_timestamp: projected?.created_timestamp || previous?.created_timestamp || "",
    gvic_assignments: projected?.gvic_assignments ?? previous?.gvic_assignments ?? [],
    effective_access_level: projected?.effective_access_level ?? previous?.effective_access_level ?? "edit",
    can_view: projected?.can_view ?? previous?.can_view ?? true,
    can_edit: projected?.can_edit ?? previous?.can_edit ?? true,
    can_admin: projected?.can_admin ?? previous?.can_admin ?? false,
  };
}

function materializeGVICProjectionExplorerData(input: {
  companyID: string;
  currentUserID: string;
  projectionRows: GVICMatrixProjectionRow[];
  projectedLogicGates: ExplorerLogicGateRecord[];
  fallbackNodes: NodeRecord[];
  fallbackLogicGates: ExplorerLogicGateRecord[];
}): { nodes: NodeRecord[]; logicGates: ExplorerLogicGateRecord[] } {
  const fallbackNodeByID = new Map(input.fallbackNodes.map((node) => [node.node_id, node]));
  const fallbackLogicGateByID = new Map(input.fallbackLogicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
  const projectedLogicGateByID = new Map(input.projectedLogicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
  const nodeByID = new Map<string, NodeRecord>();
  const logicGateByID = new Map<string, ExplorerLogicGateRecord>();

  for (const row of input.projectionRows) {
    if (!projectionRowMatchesUser(row, input.companyID, input.currentUserID)) continue;
    const node = materializeProjectionNode(row, fallbackNodeByID.get(cleanExplorerID(row.node_id)));
    if (node) nodeByID.set(node.node_id, node);
    const logicGateID = cleanExplorerID(row.logic_gate_id);
    if (logicGateID && !logicGateByID.has(logicGateID)) {
      const logicGate = materializeProjectionLogicGate(
        logicGateID,
        row.logic_gate_name ?? "",
        fallbackLogicGateByID.get(logicGateID),
        projectedLogicGateByID.get(logicGateID),
      );
      if (logicGate) logicGateByID.set(logicGate.logic_gate_id, logicGate);
    }
  }

  return {
    nodes: Array.from(nodeByID.values()),
    logicGates: Array.from(logicGateByID.values()),
  };
}

function fallbackGVICExplorerDataForUser(userID: string, nodes: NodeRecord[], logicGates: ExplorerLogicGateRecord[]): { nodes: NodeRecord[]; logicGates: ExplorerLogicGateRecord[] } {
  const ownerUserIDs = new Set([cleanExplorerID(userID)].filter(Boolean));
  if (ownerUserIDs.size === 0) return { nodes: [], logicGates: [] };
  const visibleLogicGateIDs = new Set(
    logicGates
      .filter((logicGate) => logicGateOwnedByAnyUser(logicGate, ownerUserIDs))
      .map((logicGate) => logicGate.logic_gate_id),
  );
  const visibleNodeIDs = new Set<string>();
  for (const node of nodes) {
    if ((node.logic_gate_ids ?? []).some((logicGateID) => visibleLogicGateIDs.has(cleanExplorerID(logicGateID)))) {
      visibleNodeIDs.add(node.node_id);
    }
  }
  return {
    nodes: nodes.filter((node) => visibleNodeIDs.has(node.node_id)),
    logicGates: logicGates.filter((logicGate) => visibleLogicGateIDs.has(logicGate.logic_gate_id)),
  };
}

function GVICExplorerDataForUser(input: {
  companyID: string;
  userID: string;
  projectionByUserID: Record<string, GVICProjectionCacheEntry>;
  fallbackNodes: NodeRecord[];
  fallbackLogicGates: ExplorerLogicGateRecord[];
}): { nodes: NodeRecord[]; logicGates: ExplorerLogicGateRecord[] } {
  const userID = cleanExplorerID(input.userID);
  const cached = input.projectionByUserID[userID];
  if (cached?.loaded) {
    return materializeGVICProjectionExplorerData({
      companyID: input.companyID,
      currentUserID: userID,
      projectionRows: cached.rows,
      projectedLogicGates: cached.logicGates,
      fallbackNodes: input.fallbackNodes,
      fallbackLogicGates: input.fallbackLogicGates,
    });
  }
  return fallbackGVICExplorerDataForUser(userID, input.fallbackNodes, input.fallbackLogicGates);
}

function buildGVICCompanyExplorerRows(input: {
  expanded: Set<string>;
  nodes: NodeRecord[];
  logicGates: ExplorerLogicGateRecord[];
  projects?: ProjectRecord[];
  folderNodes: NodeRecord[];
  folderLogicGates: ExplorerLogicGateRecord[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  currentUserID: string;
  customFolderNodes?: NodeRecord[];
  customFolderLogicGates?: ExplorerLogicGateRecord[];
  customFolderProjects?: ProjectRecord[];
  includeCustomRootFolders?: boolean;
  customRootOwnerUserIDs?: Set<string>;
  treeIDPrefix?: string;
  depthOffset?: number;
}): ExplorerTreeNode[] {
  const rows: ExplorerTreeNode[] = [];
  const treeIDPrefix = input.treeIDPrefix?.trim() ?? "";
  const depthOffset = input.depthOffset ?? 0;
  const prefixTreeID = (treeID: string): string => treeIDPrefix ? `${treeIDPrefix}:${treeID}` : treeID;
  const rowDepth = (depth: number): number => depth + depthOffset;
  const isExpanded = (treeID: string): boolean => input.expanded.has(treeID) || input.expanded.has("*");
  const currentGVICUserID = cleanExplorerID(input.currentUserID);
  const GVICCreationScope = currentGVICUserID
    ? { folderScopeType: "user" as const, folderScopeID: currentGVICUserID }
    : {};
  const emptyProjectByID = new Map<string, ProjectRecord>();
  const nodeByID = new Map<string, NodeRecord>();
  for (const node of input.folderNodes) nodeByID.set(node.node_id, node);
  for (const node of input.nodes) nodeByID.set(node.node_id, node);
  const GVICNodeByID = new Map<string, NodeRecord>();
  for (const node of input.nodes) GVICNodeByID.set(node.node_id, node);
  const logicGateByID = new Map<string, ExplorerLogicGateRecord>();
  for (const logicGate of input.folderLogicGates) logicGateByID.set(logicGate.logic_gate_id, logicGate);
  for (const logicGate of input.logicGates) logicGateByID.set(logicGate.logic_gate_id, logicGate);
  const GVICLogicGateByID = new Map<string, ExplorerLogicGateRecord>();
  for (const logicGate of input.logicGates) GVICLogicGateByID.set(logicGate.logic_gate_id, logicGate);
  const projectByID = new Map<string, ProjectRecord>();
  for (const project of input.projects ?? []) projectByID.set(project.project_id, project);
  const customNodeByID = new Map(nodeByID);
  for (const node of input.customFolderNodes ?? []) customNodeByID.set(node.node_id, node);
  const customLogicGateByID = new Map(logicGateByID);
  for (const logicGate of input.customFolderLogicGates ?? []) customLogicGateByID.set(logicGate.logic_gate_id, logicGate);
  const customProjectByID = new Map(projectByID);
  for (const project of input.customFolderProjects ?? []) customProjectByID.set(project.project_id, project);
  const folderByID = new Map(input.folders.map((folder) => [folder.folder_id, folder]));
  const folderScopeForFolder = (folder?: CompanyExplorerFolder) => ({
    folderScopeType: folder?.scope_type,
    folderScopeID: folder?.scope_id?.trim() || undefined,
  });
  const GVICFolderScopeForFolder = (folder?: CompanyExplorerFolder) => {
    const scope = folderScopeForFolder(folder);
    if ((scope.folderScopeType === "user" || scope.folderScopeType === "team") && scope.folderScopeID) return scope;
    return GVICCreationScope;
  };
  const GVICFolderScopeForID = (folderID: string) => GVICFolderScopeForFolder(folderByID.get(folderID));
  const roleRootByRole = new Map<CompanyExplorerGVICFolderRole, CompanyExplorerFolder>();
  const roleByRootFolderID = new Map<string, CompanyExplorerGVICFolderRole>();
  for (const folder of GVIC_FOLDER_ROWS) {
    const root = GVICVisualRootFolderForRole(input.folders, folder.role);
    if (!root) continue;
    roleRootByRole.set(folder.role, root);
    roleByRootFolderID.set(root.folder_id, folder.role);
  }
  const foldersByParent = new Map<string, CompanyExplorerFolder[]>();
  for (const folder of input.folders) {
    const parentID = folder.parent_folder_id ?? "";
    const bucket = foldersByParent.get(parentID) ?? [];
    bucket.push(folder);
    foldersByParent.set(parentID, bucket);
  }
  const itemsByFolder = new Map<string, CompanyExplorerFolderItem[]>();
  for (const item of input.folderItems) {
    const bucket = itemsByFolder.get(item.folder_id) ?? [];
    bucket.push(item);
    itemsByFolder.set(item.folder_id, bucket);
  }

  const roleForVisualFolder = (folderID: string): CompanyExplorerGVICFolderRole | null => {
    let currentID = folderID.trim();
    const seen = new Set<string>();
    while (currentID && !seen.has(currentID)) {
      const role = roleByRootFolderID.get(currentID);
      if (role) return role;
      seen.add(currentID);
      currentID = folderByID.get(currentID)?.parent_folder_id?.trim() ?? "";
    }
    return null;
  };
  const customRootCandidateIDs = new Set<string>();
  const customRootFolderIDs = new Set<string>();
  const isCustomRootFolder = (folder: CompanyExplorerFolder): boolean => {
    if (folder.parent_folder_id || folder.system_key || roleByRootFolderID.has(folder.folder_id)) return false;
    const normalizedName = normalizeExplorerFolderName(folder.name);
    return !HIDDEN_CUSTOM_EXPLORER_ROOT_FOLDER_NAMES.some((hiddenName) => normalizedName === normalizeExplorerFolderName(hiddenName));
  };
  for (const folder of input.folders) {
    if (isCustomRootFolder(folder)) customRootCandidateIDs.add(folder.folder_id);
  }
  const customRootForFolder = (folderID: string, rootIDs = customRootFolderIDs): string => {
    let currentID = folderID.trim();
    const seen = new Set<string>();
    while (currentID && !seen.has(currentID)) {
      if (rootIDs.has(currentID)) return currentID;
      seen.add(currentID);
      currentID = folderByID.get(currentID)?.parent_folder_id?.trim() ?? "";
    }
    return "";
  };
  const logicGateOwnerUserIDs = (logicGate: ExplorerLogicGateRecord | undefined): Set<string> => {
    const ownerIDs = new Set<string>();
    for (const assignment of logicGate?.gvic_assignments ?? []) {
      const userID = cleanExplorerID(assignment.user_id);
      if (userID) ownerIDs.add(userID);
    }
    return ownerIDs;
  };
  const itemOwnerUserIDs = (item: CompanyExplorerFolderItem): Set<string> => {
    if (item.item_type === "logic_gate") return logicGateOwnerUserIDs(customLogicGateByID.get(item.item_id));
    if (item.item_type === "node") {
      const ownerIDs = new Set<string>();
      const node = customNodeByID.get(item.item_id);
      for (const logicGateID of node?.logic_gate_ids ?? []) {
        for (const userID of logicGateOwnerUserIDs(customLogicGateByID.get(cleanExplorerID(logicGateID)))) {
          ownerIDs.add(userID);
        }
      }
      return ownerIDs;
    }
    return new Set<string>();
  };
  if (input.includeCustomRootFolders) {
    const ownerIDsByRoot = new Map<string, Set<string>>();
    for (const item of input.folderItems) {
      const rootID = customRootForFolder(item.folder_id, customRootCandidateIDs);
      if (!rootID) continue;
      const bucket = ownerIDsByRoot.get(rootID) ?? new Set<string>();
      for (const ownerID of itemOwnerUserIDs(item)) bucket.add(ownerID);
      ownerIDsByRoot.set(rootID, bucket);
    }
    const requestedOwnerIDs = input.customRootOwnerUserIDs;
    for (const rootID of customRootCandidateIDs) {
      const rootFolder = folderByID.get(rootID);
      const rootScopeType = rootFolder?.scope_type;
      const rootScopeID = cleanExplorerID(rootFolder?.scope_id);
      const ownerIDs = ownerIDsByRoot.get(rootID) ?? new Set<string>();
      if (!requestedOwnerIDs) {
        customRootFolderIDs.add(rootID);
        continue;
      }
      if (rootScopeType === "user" && rootScopeID) {
        if (requestedOwnerIDs.has(rootScopeID)) customRootFolderIDs.add(rootID);
        continue;
      }
      if (shouldIncludeGVICCustomRootFolder({
        rootScopeType,
        rootScopeID,
        ownerUserIDs: ownerIDs,
        requestedOwnerUserIDs: requestedOwnerIDs,
      })) {
        customRootFolderIDs.add(rootID);
      }
    }
  }

  const nodesByLogicGateID = new Map<string, NodeRecord[]>();
  const nodesWithoutLogicGate: NodeRecord[] = [];
  for (const node of input.nodes) {
    const logicGateIDs = Array.from(new Set((node.logic_gate_ids ?? []).map(cleanExplorerID).filter(Boolean)));
    if (logicGateIDs.length === 0) {
      nodesWithoutLogicGate.push(node);
      continue;
    }
    for (const cleanLogicGateID of logicGateIDs) {
      const bucket = nodesByLogicGateID.get(cleanLogicGateID) ?? [];
      bucket.push(node);
      nodesByLogicGateID.set(cleanLogicGateID, bucket);
    }
  }
  const customNodesByLogicGateID = new Map<string, NodeRecord[]>();
  for (const node of input.customFolderNodes ?? input.folderNodes) {
    const logicGateIDs = Array.from(new Set((node.logic_gate_ids ?? []).map(cleanExplorerID).filter(Boolean)));
    for (const cleanLogicGateID of logicGateIDs) {
      const bucket = customNodesByLogicGateID.get(cleanLogicGateID) ?? [];
      bucket.push(node);
      customNodesByLogicGateID.set(cleanLogicGateID, bucket);
    }
  }
  const logicGatesByRole = new Map<CompanyExplorerGVICFolderRole, ExplorerLogicGateRecord[]>();
  for (const logicGate of input.logicGates) {
    for (const role of logicGateGVICRolesForUser(logicGate, input.currentUserID)) {
      const bucket = logicGatesByRole.get(role) ?? [];
      bucket.push(logicGate);
      logicGatesByRole.set(role, bucket);
    }
  }
  const placedByRole = new Map<CompanyExplorerGVICFolderRole, { logicGateIDs: Set<string>; nodeIDs: Set<string> }>();
  const placementForRole = (role: CompanyExplorerGVICFolderRole) => {
    let placement = placedByRole.get(role);
    if (!placement) {
      placement = { logicGateIDs: new Set<string>(), nodeIDs: new Set<string>() };
      placedByRole.set(role, placement);
    }
    return placement;
  };
  for (const item of input.folderItems) {
    const role = roleForVisualFolder(item.folder_id);
    const customRootID = input.includeCustomRootFolders ? customRootForFolder(item.folder_id) : "";
    if (!role && !customRootID) continue;
    for (const placementRole of role ? [role] : GVIC_FOLDER_ROWS.map((folder) => folder.role)) {
      const placement = placementForRole(placementRole);
      const placementLogicGateByID = role ? GVICLogicGateByID : customLogicGateByID;
      const placementNodeByID = role ? GVICNodeByID : customNodeByID;
      if (item.item_type === "logic_gate" && placementLogicGateByID.has(item.item_id)) placement.logicGateIDs.add(item.item_id);
      if (item.item_type === "node" && placementNodeByID.has(item.item_id)) placement.nodeIDs.add(item.item_id);
    }
  }

  const visualFolderHasChildren = (
    folderID: string,
    sourceNodeByID = nodeByID,
    sourceLogicGateByID = logicGateByID,
    sourceProjectByID = projectByID,
  ): boolean => {
    if ((foldersByParent.get(folderID) ?? []).length > 0) return true;
    return (itemsByFolder.get(folderID) ?? []).some((item) => (
      (item.item_type === "logic_gate" && sourceLogicGateByID.has(item.item_id))
      || (item.item_type === "node" && sourceNodeByID.has(item.item_id))
      || (item.item_type === "project" && sourceProjectByID.has(item.item_id))
    ));
  };
  const folderMatchesCurrentGVICUserScope = (folder?: CompanyExplorerFolder): boolean => (
    Boolean(folder)
    && folder?.scope_type === "user"
    && Boolean(currentGVICUserID)
    && cleanExplorerID(folder.scope_id) === currentGVICUserID
  );
  function visualFolderHasGVICVisibleChildren(
    folderID: string,
    sourceNodeByID = GVICNodeByID,
    sourceLogicGateByID = GVICLogicGateByID,
    sourceProjectByID = emptyProjectByID,
  ): boolean {
    for (const child of foldersByParent.get(folderID) ?? []) {
      if (visualFolderVisibleForCurrentGVICUser(child, sourceNodeByID, sourceLogicGateByID, sourceProjectByID)) return true;
    }
    return (itemsByFolder.get(folderID) ?? []).some((item) => (
      (item.item_type === "logic_gate" && sourceLogicGateByID.has(item.item_id))
      || (item.item_type === "node" && sourceNodeByID.has(item.item_id))
      || (item.item_type === "project" && sourceProjectByID.has(item.item_id))
    ));
  }
  function visualFolderVisibleForCurrentGVICUser(
    folder: CompanyExplorerFolder,
    sourceNodeByID = GVICNodeByID,
    sourceLogicGateByID = GVICLogicGateByID,
    sourceProjectByID = emptyProjectByID,
  ): boolean {
    if (folderMatchesCurrentGVICUserScope(folder)) return true;
    if (folder.scope_type === "user" || folder.scope_type === "team") return false;
    return shouldShowGVICCompanyScopedFolderShell(folder.scope_type)
      || visualFolderHasGVICVisibleChildren(folder.folder_id, sourceNodeByID, sourceLogicGateByID, sourceProjectByID);
  }

  const pushVisualLogicGateBranch = (
    role: CompanyExplorerGVICFolderRole,
    folderID: string,
    folderKind: CompanyExplorerFolderKind,
    logicGate: ExplorerLogicGateRecord,
    depth: number,
    position: number,
    createdTimestamp: string,
    sourceNodesByLogicGateID = nodesByLogicGateID,
  ) => {
    const placed = placementForRole(role);
    const rowID = prefixTreeID(GVICVisualLogicGateTreeID(role, folderID, logicGate.logic_gate_id));
    const nestedNodes = [...(sourceNodesByLogicGateID.get(logicGate.logic_gate_id) ?? [])]
      .filter((node) => !placed.nodeIDs.has(node.node_id))
      .sort((a, b) => (
        getNodeRecordTitle(a).localeCompare(getNodeRecordTitle(b))
        || a.created_timestamp.localeCompare(b.created_timestamp)
        || a.node_id.localeCompare(b.node_id)
      ));
    rows.push({
      id: rowID,
      label: getLogicGateRecordTitle(logicGate) || logicGate.logic_gate_id,
      depth: rowDepth(depth),
      kind: "logic_gate",
      logicGateID: logicGate.logic_gate_id,
      folderID,
      folderKind,
      ...GVICFolderScopeForID(folderID),
      scopeLevel: rowDepth(depth),
      position,
      createdTimestamp,
      hasChildren: true,
      GVICRole: role,
      syntheticKind: "logic_gate_children",
    });
    if (!isExpanded(rowID)) return;
    for (const [nodeIndex, node] of nestedNodes.entries()) {
      rows.push({
        id: prefixTreeID(GVICNodeTreeID(role, logicGate.logic_gate_id, node.node_id)),
        label: getNodeRecordTitle(node) || node.node_id,
        depth: rowDepth(depth + 1),
        kind: "node",
        nodeID: node.node_id,
        scopeLevel: rowDepth(depth + 1),
        position: (nodeIndex + 1) * TREE_ROW_POSITION_STEP,
        createdTimestamp: node.created_timestamp,
        parentLogicGateID: logicGate.logic_gate_id,
        GVICRole: role,
        syntheticKind: "logic_gate_children",
      });
    }
  };

  const pushVisualFolderBranch = (
    role: CompanyExplorerGVICFolderRole,
    parentFolderID: string,
    depth: number,
    sourceNodeByID = nodeByID,
    sourceLogicGateByID = logicGateByID,
    sourceNodesByLogicGateID = nodesByLogicGateID,
    sourceProjectByID = projectByID,
    filterFoldersToCurrentGVICUser = false,
  ) => {
    const parentFolderKind = folderByID.get(parentFolderID)?.folder_kind ?? "logic_gate";
    const branchRows: Array<
      | { kind: "folder"; folder: CompanyExplorerFolder; position: number; createdTimestamp: string; label: string }
      | { kind: "item"; item: CompanyExplorerFolderItem; position: number; createdTimestamp: string; label: string }
    > = [];
    for (const folder of foldersByParent.get(parentFolderID) ?? []) {
      if (filterFoldersToCurrentGVICUser && !visualFolderVisibleForCurrentGVICUser(folder, sourceNodeByID, sourceLogicGateByID, sourceProjectByID)) continue;
      branchRows.push({
        kind: "folder",
        folder,
        position: folder.position || TREE_ROW_POSITION_STEP,
        createdTimestamp: folder.created_timestamp,
        label: folder.name,
      });
    }
    for (const item of itemsByFolder.get(parentFolderID) ?? []) {
      if (item.item_type === "logic_gate") {
        const logicGate = sourceLogicGateByID.get(item.item_id);
        if (!logicGate) continue;
        branchRows.push({
          kind: "item",
          item,
          position: item.position || TREE_ROW_POSITION_STEP,
          createdTimestamp: item.created_timestamp,
          label: getLogicGateRecordTitle(logicGate) || logicGate.logic_gate_id,
        });
      } else if (item.item_type === "node") {
        const node = sourceNodeByID.get(item.item_id);
        if (!node) continue;
        branchRows.push({
          kind: "item",
          item,
          position: item.position || TREE_ROW_POSITION_STEP,
          createdTimestamp: item.created_timestamp,
          label: getNodeRecordTitle(node) || node.node_id,
        });
      } else if (item.item_type === "project") {
        const project = sourceProjectByID.get(item.item_id);
        if (!project) continue;
        branchRows.push({
          kind: "item",
          item,
          position: item.position || TREE_ROW_POSITION_STEP,
          createdTimestamp: item.created_timestamp,
          label: project.name || project.project_id,
        });
      }
    }
    branchRows.sort((a, b) => a.position - b.position || a.createdTimestamp.localeCompare(b.createdTimestamp) || a.label.localeCompare(b.label));
    for (const entry of branchRows) {
      if (entry.kind === "folder") {
        const folder = entry.folder;
        const rowID = prefixTreeID(`workspace-folder-${folder.folder_id}`);
        rows.push({
          id: rowID,
          label: folder.name,
          depth: rowDepth(depth),
          kind: "folder",
          folderID: folder.folder_id,
          parentFolderID: folder.parent_folder_id ?? "",
          folderKind: folder.folder_kind as CompanyExplorerFolderKind,
          ...GVICFolderScopeForFolder(folder),
          scopeLevel: rowDepth(depth),
          position: folder.position || TREE_ROW_POSITION_STEP,
          createdTimestamp: folder.created_timestamp,
          hasChildren: filterFoldersToCurrentGVICUser
            ? visualFolderHasGVICVisibleChildren(folder.folder_id, sourceNodeByID, sourceLogicGateByID, sourceProjectByID)
            : visualFolderHasChildren(folder.folder_id, sourceNodeByID, sourceLogicGateByID, sourceProjectByID),
          GVICRole: role,
          syntheticKind: "logic_gate_children",
        });
        if (isExpanded(rowID)) pushVisualFolderBranch(role, folder.folder_id, depth + 1, sourceNodeByID, sourceLogicGateByID, sourceNodesByLogicGateID, sourceProjectByID, filterFoldersToCurrentGVICUser);
        continue;
      }
      const item = entry.item;
      if (item.item_type === "logic_gate") {
        const logicGate = sourceLogicGateByID.get(item.item_id);
        if (!logicGate) continue;
        pushVisualLogicGateBranch(role, parentFolderID, parentFolderKind as CompanyExplorerFolderKind, logicGate, depth, item.position || TREE_ROW_POSITION_STEP, item.created_timestamp, sourceNodesByLogicGateID);
      } else if (item.item_type === "node") {
        const node = sourceNodeByID.get(item.item_id);
        if (!node) continue;
        rows.push({
          id: prefixTreeID(GVICVisualNodeTreeID(role, parentFolderID, node.node_id)),
          label: getNodeRecordTitle(node) || node.node_id,
          depth: rowDepth(depth),
          kind: "node",
          nodeID: node.node_id,
          folderID: parentFolderID,
          folderKind: parentFolderKind as CompanyExplorerFolderKind,
          ...GVICFolderScopeForID(parentFolderID),
          scopeLevel: rowDepth(depth),
          position: item.position || TREE_ROW_POSITION_STEP,
          createdTimestamp: item.created_timestamp,
          GVICRole: role,
          syntheticKind: "logic_gate_children",
        });
      } else if (item.item_type === "project") {
        const project = sourceProjectByID.get(item.item_id);
        if (!project) continue;
        rows.push({
          id: prefixTreeID(`project-${project.project_id}`),
          label: project.name || project.project_id,
          depth: rowDepth(depth),
          kind: "project",
          projectID: project.project_id,
          folderID: parentFolderID,
          folderKind: parentFolderKind as CompanyExplorerFolderKind,
          ...GVICFolderScopeForID(parentFolderID),
          scopeLevel: rowDepth(depth),
          position: item.position || TREE_ROW_POSITION_STEP,
          createdTimestamp: item.created_timestamp,
          GVICRole: role,
          syntheticKind: "logic_gate_children",
        });
      }
    }
  };
  const pushCustomRootFolders = () => {
    if (!input.includeCustomRootFolders || customRootFolderIDs.size === 0) return;
    const customRoots = [...(foldersByParent.get("") ?? [])]
      .filter((folder) => customRootFolderIDs.has(folder.folder_id))
      .sort((a, b) => (
        (a.position - b.position)
        || a.created_timestamp.localeCompare(b.created_timestamp)
        || a.name.localeCompare(b.name)
      ));
    for (const folder of customRoots) {
      const rowID = prefixTreeID(`workspace-folder-${folder.folder_id}`);
      rows.push({
        id: rowID,
        label: folder.name,
        depth: rowDepth(0),
        kind: "folder",
        folderID: folder.folder_id,
        parentFolderID: "",
        folderKind: folder.folder_kind as CompanyExplorerFolderKind,
        ...folderScopeForFolder(folder),
        folderLabel: folder.name,
        scopeLevel: rowDepth(0),
        position: folder.position || TREE_ROW_POSITION_STEP,
        createdTimestamp: folder.created_timestamp,
        hasChildren: visualFolderHasChildren(folder.folder_id, customNodeByID, customLogicGateByID, customProjectByID),
        syntheticKind: "logic_gate_children",
      });
      if (isExpanded(rowID)) pushVisualFolderBranch("other", folder.folder_id, 1, customNodeByID, customLogicGateByID, customNodesByLogicGateID, customProjectByID);
    }
  };

  pushCustomRootFolders();

  const defaultFoldersID = prefixTreeID(GVICDefaultFoldersTreeID());
  rows.push({
    id: defaultFoldersID,
    label: DEFAULT_FOLDERS_LABEL,
    depth: rowDepth(0),
    kind: "folder",
    folderKind: "logic_gate",
    scopeLevel: rowDepth(0),
    position: TREE_ROW_POSITION_STEP,
    createdTimestamp: "",
    hasChildren: true,
    syntheticKind: "default_scope_folder",
  });
  if (!isExpanded(defaultFoldersID)) return rows;

  for (const [folderIndex, folder] of GVIC_FOLDER_ROWS.entries()) {
    const folderID = prefixTreeID(GVICFolderTreeID(folder.role));
    const visualRootFolder = roleRootByRole.get(folder.role);
    const visualRootFolderID = visualRootFolder?.folder_id ?? "";
    const visualRootHasChildren = visualRootFolderID ? visualFolderHasGVICVisibleChildren(visualRootFolderID, GVICNodeByID, GVICLogicGateByID, emptyProjectByID) : false;
    const placed = placementForRole(folder.role);
    const noLogicGateNodes = folder.role === "other"
      ? [...nodesWithoutLogicGate].filter((node) => !placed.nodeIDs.has(node.node_id)).sort((a, b) => (
        getNodeRecordTitle(a).localeCompare(getNodeRecordTitle(b))
        || a.created_timestamp.localeCompare(b.created_timestamp)
        || a.node_id.localeCompare(b.node_id)
      ))
      : [];
    const noLogicGateRowID = GVICNoLogicGateTreeID(folder.role);
    const logicGateRows = [...(logicGatesByRole.get(folder.role) ?? [])].sort((a, b) => (
      getLogicGateRecordTitle(a).localeCompare(getLogicGateRecordTitle(b))
      || a.created_timestamp.localeCompare(b.created_timestamp)
      || a.logic_gate_id.localeCompare(b.logic_gate_id)
    )).filter((logicGate) => !placed.logicGateIDs.has(logicGate.logic_gate_id));
    rows.push({
      id: folderID,
      label: folder.label,
      depth: rowDepth(1),
      kind: "folder",
      folderID: visualRootFolderID || undefined,
      parentFolderID: "",
      folderKind: "logic_gate",
      ...GVICCreationScope,
      scopeLevel: rowDepth(1),
      position: (folderIndex + 1) * TREE_ROW_POSITION_STEP,
      createdTimestamp: visualRootFolder?.created_timestamp ?? "",
      hasChildren: visualRootHasChildren || logicGateRows.length > 0 || noLogicGateNodes.length > 0,
      GVICRole: folder.role,
      syntheticKind: "GVIC_folder",
    });
    if (!isExpanded(folderID)) continue;

    if (visualRootFolderID) pushVisualFolderBranch(folder.role, visualRootFolderID, 2, GVICNodeByID, GVICLogicGateByID, nodesByLogicGateID, emptyProjectByID, true);

    if (noLogicGateNodes.length > 0) {
      rows.push({
        id: prefixTreeID(noLogicGateRowID),
        label: "No Logic Gate",
        depth: rowDepth(2),
        kind: "folder",
        folderKind: "node",
        ...GVICCreationScope,
        scopeLevel: rowDepth(2),
        position: TREE_ROW_POSITION_STEP,
        createdTimestamp: "",
        hasChildren: noLogicGateNodes.length > 0,
        GVICRole: folder.role,
        syntheticKind: "logic_gate_children",
      });
      if (isExpanded(prefixTreeID(noLogicGateRowID))) {
        for (const [nodeIndex, node] of noLogicGateNodes.entries()) {
          rows.push({
            id: prefixTreeID(GVICNoLogicGateNodeTreeID(folder.role, node.node_id)),
            label: getNodeRecordTitle(node) || node.node_id,
            depth: rowDepth(3),
            kind: "node",
            nodeID: node.node_id,
            scopeLevel: rowDepth(3),
            position: (nodeIndex + 1) * TREE_ROW_POSITION_STEP,
            createdTimestamp: node.created_timestamp,
            GVICRole: folder.role,
            syntheticKind: "logic_gate_children",
          });
        }
      }
    }

    const logicGatePositionOffset = noLogicGateNodes.length > 0 ? 1 : 0;
    for (const [logicGateIndex, logicGate] of logicGateRows.entries()) {
      const logicGateRowID = prefixTreeID(GVICLogicGateTreeID(folder.role, logicGate.logic_gate_id));
      const nestedNodes = [...(nodesByLogicGateID.get(logicGate.logic_gate_id) ?? [])].filter((node) => !placed.nodeIDs.has(node.node_id)).sort((a, b) => (
        getNodeRecordTitle(a).localeCompare(getNodeRecordTitle(b))
        || a.created_timestamp.localeCompare(b.created_timestamp)
        || a.node_id.localeCompare(b.node_id)
      ));
      rows.push({
        id: logicGateRowID,
        label: getLogicGateRecordTitle(logicGate) || logicGate.logic_gate_id,
        depth: rowDepth(2),
        kind: "logic_gate",
        logicGateID: logicGate.logic_gate_id,
        folderID: visualRootFolderID || undefined,
        folderKind: visualRootFolderID ? "logic_gate" : undefined,
        ...GVICFolderScopeForFolder(visualRootFolder),
        scopeLevel: rowDepth(2),
        position: (logicGateIndex + 1 + logicGatePositionOffset) * TREE_ROW_POSITION_STEP,
        createdTimestamp: logicGate.created_timestamp,
        hasChildren: true,
        GVICRole: folder.role,
        syntheticKind: "logic_gate_children",
      });
      if (!isExpanded(logicGateRowID)) continue;

      for (const [nodeIndex, node] of nestedNodes.entries()) {
        rows.push({
          id: prefixTreeID(GVICNodeTreeID(folder.role, logicGate.logic_gate_id, node.node_id)),
          label: getNodeRecordTitle(node) || node.node_id,
          depth: rowDepth(3),
          kind: "node",
          nodeID: node.node_id,
          scopeLevel: rowDepth(3),
          position: (nodeIndex + 1) * TREE_ROW_POSITION_STEP,
          createdTimestamp: node.created_timestamp,
          parentLogicGateID: logicGate.logic_gate_id,
          GVICRole: folder.role,
          syntheticKind: "logic_gate_children",
        });
      }
    }
  }
  return rows;
}

function teamUserFolderTreeID(userID: string): string {
  return `team-user-${cleanExplorerID(userID)}`;
}

function companyGroupFolderTreeID(groupID: string): string {
  return `company-group-${cleanExplorerID(groupID)}`;
}

function companyGroupUserFolderTreeID(groupID: string, userID: string): string {
  return `company-group-${cleanExplorerID(groupID)}-user-${cleanExplorerID(userID)}`;
}

function buildTeamGVICExplorerRows(input: {
  expanded: Set<string>;
  companyID: string;
  currentUserID: string;
  users: ExplorerUserSummary[];
  projectionByUserID: Record<string, GVICProjectionCacheEntry>;
  fallbackNodes: NodeRecord[];
  fallbackLogicGates: ExplorerLogicGateRecord[];
  fallbackProjects: ProjectRecord[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
}): ExplorerTreeNode[] {
  const rows: ExplorerTreeNode[] = [];
  const defaultFoldersID = teamDefaultFoldersTreeID();
  rows.push({
    id: defaultFoldersID,
    label: DEFAULT_FOLDERS_LABEL,
    depth: 0,
    kind: "folder",
    folderKind: "logic_gate",
    scopeLevel: 0,
    position: TREE_ROW_POSITION_STEP,
    createdTimestamp: "",
    hasChildren: input.users.length > 0,
    syntheticKind: "default_scope_folder",
  });
  if (!input.expanded.has(defaultFoldersID) && !input.expanded.has("*")) return rows;

  for (const [userIndex, user] of input.users.entries()) {
    const userRowID = teamUserFolderTreeID(user.userID);
    const userData = GVICExplorerDataForUser({
      companyID: input.companyID,
      userID: user.userID,
      projectionByUserID: input.projectionByUserID,
      fallbackNodes: input.fallbackNodes,
      fallbackLogicGates: input.fallbackLogicGates,
    });
    rows.push({
      id: userRowID,
      label: user.label,
      depth: 1,
      kind: "folder",
      folderKind: "logic_gate",
      scopeLevel: 1,
      position: (userIndex + 1) * TREE_ROW_POSITION_STEP,
      createdTimestamp: "",
      hasChildren: true,
      syntheticKind: "default_scope_folder",
    });
    if (!input.expanded.has(userRowID) && !input.expanded.has("*")) continue;
    rows.push(...buildGVICCompanyExplorerRows({
      expanded: input.expanded,
      nodes: userData.nodes,
      logicGates: userData.logicGates,
      projects: input.fallbackProjects,
      folderNodes: userData.nodes,
      folderLogicGates: userData.logicGates,
      folders: input.folders,
      folderItems: input.folderItems,
      currentUserID: user.userID,
      customFolderNodes: input.fallbackNodes,
      customFolderLogicGates: input.fallbackLogicGates,
      customFolderProjects: input.fallbackProjects,
      includeCustomRootFolders: true,
      customRootOwnerUserIDs: new Set([cleanExplorerID(user.userID)].filter(Boolean)),
      treeIDPrefix: userRowID,
      depthOffset: 2,
    }));
  }
  return rows;
}

function buildCompanyGVICExplorerRows(input: {
  expanded: Set<string>;
  companyID: string;
  currentUserID: string;
  groups: ExplorerGroupSummary[];
  projectionByUserID: Record<string, GVICProjectionCacheEntry>;
  fallbackNodes: NodeRecord[];
  fallbackLogicGates: ExplorerLogicGateRecord[];
  fallbackProjects: ProjectRecord[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  historyRows?: ExplorerTreeNode[];
}): ExplorerTreeNode[] {
  const rows: ExplorerTreeNode[] = [];
  const defaultFoldersID = companyDefaultFoldersTreeID();
  rows.push({
    id: defaultFoldersID,
    label: DEFAULT_FOLDERS_LABEL,
    depth: 0,
    kind: "folder",
    folderKind: "logic_gate",
    scopeLevel: 0,
    position: TREE_ROW_POSITION_STEP,
    createdTimestamp: "",
    hasChildren: input.groups.length > 0 || Boolean(input.historyRows?.length),
    syntheticKind: "default_scope_folder",
  });
  if (!input.expanded.has(defaultFoldersID) && !input.expanded.has("*")) return rows;

  const pushShiftedRows = (items: ExplorerTreeNode[]) => {
    for (const row of items) {
      rows.push({ ...row, depth: row.depth + 1, scopeLevel: row.scopeLevel + 1 });
    }
  };

  const pushUserRows = (group: ExplorerGroupSummary, user: ExplorerUserSummary, userDepth: number, position: number) => {
    const userRowID = companyGroupUserFolderTreeID(group.groupID, user.userID);
    const userData = GVICExplorerDataForUser({
      companyID: input.companyID,
      userID: user.userID,
      projectionByUserID: input.projectionByUserID,
      fallbackNodes: input.fallbackNodes,
      fallbackLogicGates: input.fallbackLogicGates,
    });
    rows.push({
      id: userRowID,
      label: user.label,
      depth: userDepth,
      kind: "folder",
      folderKind: "logic_gate",
      scopeLevel: userDepth,
      position,
      createdTimestamp: "",
      hasChildren: true,
      syntheticKind: "default_scope_folder",
    });
    if (!input.expanded.has(userRowID) && !input.expanded.has("*")) return;
    rows.push(...buildGVICCompanyExplorerRows({
      expanded: input.expanded,
      nodes: userData.nodes,
      logicGates: userData.logicGates,
      projects: input.fallbackProjects,
      folderNodes: userData.nodes,
      folderLogicGates: userData.logicGates,
      folders: input.folders,
      folderItems: input.folderItems,
      currentUserID: user.userID,
      customFolderNodes: input.fallbackNodes,
      customFolderLogicGates: input.fallbackLogicGates,
      customFolderProjects: input.fallbackProjects,
      includeCustomRootFolders: true,
      customRootOwnerUserIDs: new Set([cleanExplorerID(user.userID)].filter(Boolean)),
      treeIDPrefix: userRowID,
      depthOffset: userDepth + 1,
    }));
  };

  const pushGroupRows = (group: ExplorerGroupSummary, depth: number, position: number) => {
    const groupRowID = companyGroupFolderTreeID(group.groupID);
    rows.push({
      id: groupRowID,
      label: group.label,
      depth,
      kind: "folder",
      folderKind: "logic_gate",
      scopeLevel: depth,
      position,
      createdTimestamp: "",
      hasChildren: group.children.length > 0 || group.users.length > 0,
      syntheticKind: "default_scope_folder",
    });
    if (!input.expanded.has(groupRowID) && !input.expanded.has("*")) return;
    for (const [childIndex, child] of group.children.entries()) {
      pushGroupRows(child, depth + 1, (childIndex + 1) * TREE_ROW_POSITION_STEP);
    }
    const userDepth = depth + 1;
    const userPositionOffset = group.children.length;
    for (const [userIndex, user] of group.users.entries()) {
      pushUserRows(group, user, userDepth, (userPositionOffset + userIndex + 1) * TREE_ROW_POSITION_STEP);
    }
  };

  for (const [groupIndex, group] of input.groups.entries()) {
    pushGroupRows(group, 1, (groupIndex + 1) * TREE_ROW_POSITION_STEP);
  }
  if (input.historyRows?.length) pushShiftedRows(input.historyRows);
  return rows;
}

function extractSystemFolderBranch(rows: ExplorerTreeNode[], systemKey: CompanyExplorerSystemFolderKey, position: number): ExplorerTreeNode[] {
  const rootIndex = rows.findIndex((row) => row.kind === "folder" && row.systemKey === systemKey);
  if (rootIndex < 0) return [];
  const root = rows[rootIndex];
  const rootDepth = root.depth;
  const branch: ExplorerTreeNode[] = [{ ...root, depth: 0, scopeLevel: 0, position }];
  for (let index = rootIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.depth <= rootDepth) break;
    const depth = Math.max(1, row.depth - rootDepth);
    branch.push({ ...row, depth, scopeLevel: depth });
  }
  return branch;
}

function findParentScrollContainer(element: HTMLElement): HTMLElement {
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if ((style.overflowY === "auto" || style.overflowY === "scroll") && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return element;
}

function getRowsTopOffsetInScrollContainer(viewport: HTMLElement, scrollContainer: HTMLElement): number {
  const rowsStart = viewport.querySelector<HTMLElement>('[data-company-explorer-tree-rows-start="true"]') ?? viewport;
  return rowsStart.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top + scrollContainer.scrollTop;
}

// Company Explorer module: tree navigation + node context handoff into Node Map and Editor.
export const CompanyExplorerContent: React.FC<CompanyExplorerContentProps> = ({
  accent,
  widgetId,
  hideTopControls = false,
  useParentScroll = false,
  theme = "mango",
  selectionTargetFrameIDs,
  scopedRootFolderKind,
  scopedRootFolderName = "",
  externalSearchQuery,
  externalSearchSelectionRequest,
  onSearchResultsChange,
  onSearchResultSelect,
  onTriageMessagesDrop,
}) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = getActiveCompanyID();
  const scope = widgetId?.trim() ? widgetId : "global";
  const normalizedSelectionTargetFrameIDs = useMemo(() => (
    Array.from(new Set((selectionTargetFrameIDs ?? []).map((id) => id.trim()).filter(Boolean)))
  ), [selectionTargetFrameIDs]);
  const scrollStorageKey = `company-explorer-scroll-v1:${companyID}:${scope}`;
  const rootOrderStorageKey = `company-explorer-root-order-v1:${companyID}:${scope}`;

  const [explorerStore, dispatchExplorerStore] = useReducer(reduceCompanyExplorerStore, undefined, createCompanyExplorerStoreState);
  const { nodes, logicGates, projects, kanbanBoards, folders, folderItems, rows: companyExplorerV2Rows, folderSnapshotLoaded } = explorerStore;
  const companyExplorerV2RowsRef = useRef<CompanyExplorerV2Row[]>(companyExplorerV2Rows);
  const companyExplorerSearchRequestRef = useRef(0);
  const [companyExplorerSearchResults, setCompanyExplorerSearchResults] = useState<CompanyExplorerSearchResult[]>([]);
  const [selectedTreeID, setSelectedTreeID] = useState("folder-root");
  const [selectedTreeIDs, setSelectedTreeIDs] = useState<Set<string>>(new Set(["folder-root"]));
  const [selectionAnchorTreeID, setSelectionAnchorTreeID] = useState("folder-root");
  const [selectedNodeID, setSelectedNodeID] = useState("");
  const [selectedLogicGateID, setSelectedLogicGateID] = useState("");
  const [selectedKanbanBoardID, setSelectedKanbanBoardID] = useState("");
  const [error, setError] = useState("");
  const [internalTriageDropMenu, setInternalTriageDropMenu] = useState<CompanyExplorerInternalTriageDropMenu | null>(null);
  const [internalTriageDropBusy, setInternalTriageDropBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(createInitialCompanyExplorerExpandedRows);
  const selectedTreeIDRef = useRef(selectedTreeID);
  const expandedRef = useRef(expanded);
  const treeRowsRef = useRef<ExplorerTreeNode[]>([]);
  const pendingScrollTreeIDRef = useRef("");
  const [renaming, setRenaming] = useState<ExplorerRenameDraft | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const cancelRenameOnBlurRef = useRef(false);
  const renameCommitInFlightRef = useRef(false);
  const treeViewportRef = useRef<HTMLDivElement | null>(null);
  const treeKeyboardActiveRef = useRef(false);
  const [treeScrollTop, setTreeScrollTop] = useState(() => useParentScroll ? 0 : readScrollTopFromStorage(scrollStorageKey));
  const previousExplorerSearchTextRef = useRef("");
  const lastExternalSearchSelectionRequestRef = useRef(0);
  const preSearchScrollTopRef = useRef(treeScrollTop);
  const [treeViewportHeight, setTreeViewportHeight] = useState(480);
  const [rootRowOrder, setRootRowOrder] = useState<Record<string, number>>(() => readRootRowOrderFromStorage(rootOrderStorageKey));
  const [draggingTreeID, setDraggingTreeID] = useState("");
  const [dragOverTreeID, setDragOverTreeID] = useState("");
  const [dragOverPlacement, setDragOverPlacement] = useState<ExplorerRowDropPlacement | null>(null);
  const [dragPayload, setDragPayload] = useState<ExplorerDragPayload | null>(null);
  const [triageDropTreeID, setTriageDropTreeID] = useState("");
  const [explorerContextMenu, setExplorerContextMenu] = useState<CompanyExplorerContextMenuState | null>(null);
  const [folderPermissionsTarget, setFolderPermissionsTarget] = useState<CompanyExplorerFolderPermissionsTarget | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ targets: ExplorerDeleteTargetWithLabel[]; position?: ConfirmActionMenuPosition | null } | null>(null);
  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState("");
  const [deleteFolderAcknowledged, setDeleteFolderAcknowledged] = useState(false);
  const effectiveExplorerSearchQuery = externalSearchQuery ?? "";
  const [linkRevision, setLinkRevision] = useState(0);
  const [linkedMapFrameID, setLinkedMapFrameID] = useState("");
  const [linkedLogicMapFrameID, setLinkedLogicMapFrameID] = useState("");
  const lastMapSelectionRevisionRef = useRef(0);
  const lastLogicMapSelectionRevisionRef = useRef(0);
  const suppressNextExplorerBroadcastRef = useRef(false);
  const previousBroadcastSelectionRef = useRef({ selectedNodeID: "", selectedTreeID: "" });
  const latestSelectionRef = useRef<ExplorerSelectionState>({ selectedNodeID: "", selectedTreeID: "" });
  const latestLogicGateSelectionRef = useRef({ selectedLogicGateID: "", selectedTreeID: "" });
  const latestExplorerDomainRef = useRef<ExplorerSelectionDomain>("root");
  const lastLocalExplorerSelectionRef = useRef<{ domain: ExplorerSelectionDomain; changedAt: number }>({ domain: "root", changedAt: 0 });
  const pendingExplorerSelectionIntentRef = useRef<SelectionIntent>("activate");
  const explorerContextSequenceRef = useRef(0);
  const pendingScrollAlignRef = useRef<"nearest" | "center">("nearest");
  const scopeView = defaultCompanyExplorerScopeView();
  const [currentUserID, setCurrentUserID] = useState("");
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [companyGroups, setCompanyGroups] = useState<CompanyUserGroup[]>([]);
  const [groupMembers, setGroupMembers] = useState<CompanyUserGroupMember[]>([]);
  const [GVICProjectionRows, setGVICProjectionRows] = useState<GVICMatrixProjectionRow[]>([]);
  const [GVICProjectionLogicGates, setGVICProjectionLogicGates] = useState<ExplorerLogicGateRecord[]>([]);
  const [GVICProjectionLoaded, setGVICProjectionLoaded] = useState(false);
  const [GVICProjectionByUserID, setGVICProjectionByUserID] = useState<Record<string, GVICProjectionCacheEntry>>({});
  const GVICProjectionRequestIDRef = useRef(0);
  const GVICMultiProjectionRequestIDRef = useRef(0);
  const requestGVICExplorerProjectionRefreshRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    companyExplorerV2RowsRef.current = companyExplorerV2Rows;
  }, [companyExplorerV2Rows]);
  const scopedRootName = scopedRootFolderName.trim();
  const scopedKind = scopedRootName ? (scopedRootFolderKind ?? "logic_gate") : undefined;
  const scopedExplorerActive = Boolean(scopedKind && scopedRootName);
  const scopeViewsEnabled = false;
  const companyExplorerLazyScope = useMemo(
    () => companyExplorerLazyScopeForView(scopeView, scopeViewsEnabled),
    [scopeView, scopeViewsEnabled],
  );
  const companyExplorerV2Active = folderSnapshotLoaded;
  const companyExplorerV2RootEntityID = useMemo(() => companyID.trim(), [companyID]);
  const companyExplorerV2RowByEntityID = useMemo(() => {
    const byID = new Map<string, CompanyExplorerV2Row>();
    for (const row of companyExplorerV2Rows) {
      if (row.entity_id) byID.set(row.entity_id, row);
    }
    return byID;
  }, [companyExplorerV2Rows]);
  const companyExplorerV2TreeIDForEntityID = useCallback((entityID: string): string => {
    const cleanEntityID = cleanExplorerID(entityID);
    if (!cleanEntityID) return "folder-root";
    if (cleanEntityID === companyExplorerV2RootEntityID) return "folder-root";
    const row = companyExplorerV2RowByEntityID.get(cleanEntityID);
    if (!row) return `workspace-folder-${cleanEntityID}`;
    const resourceID = row.resource_id || row.entity_id;
    if (row.entity_type === "company" && !cleanExplorerID(row.parent_entity_id)) return "folder-root";
    if (row.entity_type === "folder") return `workspace-folder-${row.entity_id}`;
    if (row.entity_type === "logic_gate") return `logic-gate-${resourceID}`;
    if (row.entity_type === "node") return `node-${resourceID}`;
    if (row.entity_type === "project") return `project-${resourceID}`;
    return `workspace-folder-${cleanEntityID}`;
  }, [companyExplorerV2RootEntityID, companyExplorerV2RowByEntityID]);
  const loadedCompanyExplorerBranchesRef = useRef<Set<string>>(new Set());
  const activeCompanyExplorerBranchesRef = useRef<Set<string>>(new Set([`roots:${companyExplorerLazyScope}`]));
  const staleCompanyExplorerBranchesRef = useRef<Set<string>>(new Set());
  const inflightCompanyExplorerBranchesRef = useRef<Set<string>>(new Set());

  const resetCompanyExplorerLazyCache = useCallback(() => {
    loadedCompanyExplorerBranchesRef.current.clear();
    activeCompanyExplorerBranchesRef.current = new Set([`roots:${companyExplorerLazyScope}`]);
    staleCompanyExplorerBranchesRef.current.clear();
    inflightCompanyExplorerBranchesRef.current.clear();
  }, [companyExplorerLazyScope]);

  const refreshCompanyExplorerSnapshot = useCallback(async () => {
    resetCompanyExplorerLazyCache();
    dispatchExplorerStore({ type: "resetSnapshot" });
    setError("");
    const snapshot = await fetchCompanyExplorerRoots(apiBase, companyID, companyExplorerLazyScope);
    dispatchExplorerStore({ type: "applySnapshot", snapshot: snapshot ?? {} });
    loadedCompanyExplorerBranchesRef.current.add(`roots:${companyExplorerLazyScope}`);
  }, [apiBase, companyExplorerLazyScope, companyID, resetCompanyExplorerLazyCache]);

  const loadCompanyExplorerChildren = useCallback(async (parentEntityID: string) => {
    const cleanParentEntityID = parentEntityID.trim();
    if (!cleanParentEntityID) return;
    const branchKey = `${companyExplorerLazyScope}:entity:${cleanParentEntityID}`;
    const branchStale = staleCompanyExplorerBranchesRef.current.has(branchKey);
    if ((!branchStale && loadedCompanyExplorerBranchesRef.current.has(branchKey)) || inflightCompanyExplorerBranchesRef.current.has(branchKey)) return;
    inflightCompanyExplorerBranchesRef.current.add(branchKey);
    try {
      const snapshot = await fetchCompanyExplorerChildren(apiBase, companyID, companyExplorerLazyScope, cleanParentEntityID);
      if (branchStale) {
        dispatchExplorerStore({ type: "replaceV2Children", parentEntityID: cleanParentEntityID, rows: snapshot?.rows ?? [] });
      } else {
        dispatchExplorerStore({ type: "mergeSnapshot", snapshot: snapshot ?? {} });
      }
      loadedCompanyExplorerBranchesRef.current.add(branchKey);
      staleCompanyExplorerBranchesRef.current.delete(branchKey);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_load_company_explorer_children");
      throw err;
    } finally {
      inflightCompanyExplorerBranchesRef.current.delete(branchKey);
    }
  }, [apiBase, companyExplorerLazyScope, companyID]);

  const setExpandedAndLoadChildren = useCallback((action: React.SetStateAction<Set<string>>) => {
    setExpanded((previous) => {
      const next = typeof action === "function"
        ? (action as (current: Set<string>) => Set<string>)(previous)
        : action;
      const nextActiveBranches = new Set<string>([`roots:${companyExplorerLazyScope}`]);
      let collapsedDepth: number | null = null;
      for (const row of treeRowsRef.current) {
        if (collapsedDepth !== null) {
          if (row.depth > collapsedDepth) continue;
          collapsedDepth = null;
        }
        const rowExpanded = next.has(row.id) || next.has("*");
        if (row.entityID && row.hasChildren && rowExpanded) nextActiveBranches.add(`${companyExplorerLazyScope}:entity:${row.entityID}`);
        if (row.hasChildren && !rowExpanded) collapsedDepth = row.depth;
      }
      activeCompanyExplorerBranchesRef.current = nextActiveBranches;
      for (const rowID of next) {
        if (previous.has(rowID)) continue;
        const row = treeRowsRef.current.find((candidate) => candidate.id === rowID);
        if (row?.entityID && row.hasChildren) void loadCompanyExplorerChildren(row.entityID).catch(() => undefined);
      }
      return next;
    });
  }, [companyExplorerLazyScope, loadCompanyExplorerChildren]);

  const companyExplorerBranchKey = useCallback((parentEntityID: string) => {
    const cleanParentEntityID = cleanExplorerID(parentEntityID);
    return cleanParentEntityID ? `${companyExplorerLazyScope}:entity:${cleanParentEntityID}` : `roots:${companyExplorerLazyScope}`;
  }, [companyExplorerLazyScope]);

  const companyExplorerBranchParentEntityID = useCallback((branchKey: string): string | null => {
    if (branchKey === `roots:${companyExplorerLazyScope}`) return "";
    const prefix = `${companyExplorerLazyScope}:entity:`;
    return branchKey.startsWith(prefix) ? branchKey.slice(prefix.length) : null;
  }, [companyExplorerLazyScope]);

  const isCompanyExplorerBranchLoaded = useCallback((parentEntityID: string) => (
    loadedCompanyExplorerBranchesRef.current.has(companyExplorerBranchKey(parentEntityID))
  ), [companyExplorerBranchKey]);

  const refreshCompanyExplorerBranch = useCallback(async (parentEntityID: string) => {
    const cleanParentEntityID = cleanExplorerID(parentEntityID);
    const branchKey = companyExplorerBranchKey(cleanParentEntityID);
    if (inflightCompanyExplorerBranchesRef.current.has(branchKey)) return;
    inflightCompanyExplorerBranchesRef.current.add(branchKey);
    try {
      const snapshot = cleanParentEntityID
        ? await fetchCompanyExplorerChildren(apiBase, companyID, companyExplorerLazyScope, cleanParentEntityID)
        : await fetchCompanyExplorerRoots(apiBase, companyID, companyExplorerLazyScope);
      dispatchExplorerStore({ type: "replaceV2Children", parentEntityID: cleanParentEntityID, rows: snapshot?.rows ?? [] });
      loadedCompanyExplorerBranchesRef.current.add(branchKey);
      staleCompanyExplorerBranchesRef.current.delete(branchKey);
      setError("");
    } catch {
      // Realtime branch refresh is best effort; explicit expansion reloads the same bounded branch.
    } finally {
      inflightCompanyExplorerBranchesRef.current.delete(branchKey);
    }
  }, [apiBase, companyExplorerBranchKey, companyExplorerLazyScope, companyID]);

  const refreshActiveCompanyExplorerBranch = useCallback((parentEntityID: string) => {
    const branchKey = companyExplorerBranchKey(parentEntityID);
    if (!isCompanyExplorerBranchLoaded(parentEntityID)) return;
    if (!activeCompanyExplorerBranchesRef.current.has(branchKey)) {
      staleCompanyExplorerBranchesRef.current.add(branchKey);
      return;
    }
    void refreshCompanyExplorerBranch(parentEntityID);
  }, [companyExplorerBranchKey, isCompanyExplorerBranchLoaded, refreshCompanyExplorerBranch]);

  const refreshActiveCompanyExplorerBranches = useCallback((options: { markInactiveLoadedStale?: boolean } = {}) => {
    if (options.markInactiveLoadedStale) {
      for (const branchKey of loadedCompanyExplorerBranchesRef.current) {
        if (!activeCompanyExplorerBranchesRef.current.has(branchKey)) staleCompanyExplorerBranchesRef.current.add(branchKey);
      }
    }
    for (const branchKey of activeCompanyExplorerBranchesRef.current) {
      if (!loadedCompanyExplorerBranchesRef.current.has(branchKey)) continue;
      const parentEntityID = companyExplorerBranchParentEntityID(branchKey);
      if (parentEntityID !== null) void refreshCompanyExplorerBranch(parentEntityID);
    }
  }, [companyExplorerBranchParentEntityID, refreshCompanyExplorerBranch]);

  const refreshCompanyExplorerBranchesForEnvelope = useCallback((envelope: CompanyExplorerWorkspaceStreamEnvelope) => {
    if (envelope.company_id !== companyID) return;
    const type = envelope.type?.trim() ?? "";
    const data = envelope.data ?? {};
    const affectedScopes = companyExplorerAffectedScopesFromEnvelope(envelope);
    if (affectedScopes.length > 0) {
      const plan = companyExplorerRefreshPlanFromAffectedScopes({ companyID, affectedScopes, rows: companyExplorerV2RowsRef.current });
      if (!plan.hasCompanyExplorerScopes) return;
      if (plan.refreshRoot) refreshActiveCompanyExplorerBranch("");
      for (const parentEntityID of plan.parentEntityIDs) refreshActiveCompanyExplorerBranch(parentEntityID);
      const payloadParentEntityID = companyExplorerEnvelopeParentEntityID(data);
      if (payloadParentEntityID !== null) refreshActiveCompanyExplorerBranch(payloadParentEntityID);
      return;
    }
    const refreshAllLoadedBranchTypes = new Set([
      "company_explorer_folder_deleted",
      "company_explorer_item_removed",
      "project_relationship_upserted",
      "project_relationship_deleted",
      "work_item.logic_gate_assignment_saved",
      "work_item.logic_gate_assignment_moved",
      "work_item.logic_gate_assignment_removed",
      "node_created",
      "node_updated",
      "node_deleted",
      "logic_gate_created",
      "logic_gate_updated",
      "logic_gate_deleted",
      "project_created",
      "project_updated",
      "project_deleted",
    ]);
    if (refreshAllLoadedBranchTypes.has(type)) {
      refreshActiveCompanyExplorerBranches({ markInactiveLoadedStale: true });
      return;
    }
    if (
      type !== "company_explorer_folder_created"
      && type !== "company_explorer_folder_updated"
      && type !== "company_explorer_item_placed"
    ) {
      return;
    }
    const parentEntityID = typeof data.parent_entity_id === "string"
      ? cleanExplorerID(data.parent_entity_id)
      : typeof data.entity === "object" && data.entity && typeof (data.entity as { parent_entity_id?: unknown }).parent_entity_id === "string"
        ? cleanExplorerID((data.entity as { parent_entity_id: string }).parent_entity_id)
        : "";
    refreshActiveCompanyExplorerBranch(parentEntityID);
  }, [companyID, refreshActiveCompanyExplorerBranch, refreshActiveCompanyExplorerBranches]);
  const reconcileCompanyExplorerGap = useCallback((gap: WorkspaceStreamGapSignal) => {
    if (gap.envelope) {
      const affectedScopes = companyExplorerAffectedScopesFromEnvelope(gap.envelope);
      if (affectedScopes.length > 0) {
        const plan = companyExplorerRefreshPlanFromAffectedScopes({ companyID, affectedScopes, rows: companyExplorerV2RowsRef.current });
        if (!plan.hasCompanyExplorerScopes) return;
        if (plan.refreshRoot) refreshActiveCompanyExplorerBranch("");
        for (const parentEntityID of plan.parentEntityIDs) refreshActiveCompanyExplorerBranch(parentEntityID);
        const data: Record<string, unknown> = gap.envelope.data ?? {};
        const payloadParentEntityID = companyExplorerEnvelopeParentEntityID(data);
        if (payloadParentEntityID !== null) refreshActiveCompanyExplorerBranch(payloadParentEntityID);
        return;
      }
    }
    if (!shouldRefreshCompanyExplorerSnapshotForGap(gap, companyID)) return;
    void refreshCompanyExplorerSnapshot().catch(() => {
      // Stream recovery is best effort; the next explicit Explorer action can retry the same bounded reads.
    });
  }, [companyID, refreshCompanyExplorerSnapshot, refreshActiveCompanyExplorerBranch]);

  useEffect(() => {
    let cancelled = false;
    resetCompanyExplorerLazyCache();
    dispatchExplorerStore({ type: "resetSnapshot" });
    (async () => {
      try {
        setError("");
        const snapshot = await fetchCompanyExplorerRoots(apiBase, companyID, companyExplorerLazyScope);
        if (cancelled) return;
        dispatchExplorerStore({ type: "applySnapshot", snapshot: snapshot ?? {} });
        loadedCompanyExplorerBranchesRef.current.add(`roots:${companyExplorerLazyScope}`);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed_to_load_company_explorer_roots");
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, companyExplorerLazyScope, companyID, resetCompanyExplorerLazyCache]);

  const refreshKanbanBoards = useCallback(async () => {
    try {
      // The Explorer tree renders a bounded first window. Board creation and
      // placement stay API-first so headless agents use the same commands.
      const boards = await listKanbanBoards(apiBase, companyID, 200);
      dispatchExplorerStore({ type: "setKanbanBoards", boards });
    } catch {
      // Keep Explorer usable even if Kanban endpoints are temporarily offline.
    }
  }, [apiBase, companyID]);

  useEffect(() => {
    void refreshKanbanBoards();
  }, [refreshKanbanBoards]);

  useEffect(() => {
    const onKanbanBoardsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<KanbanBoardsUpdatedDetail>).detail;
      if (detail?.companyID && detail.companyID !== companyID) return;
      invalidateKanbanBoardListCache(apiBase, companyID);
      dispatchExplorerStore({ type: "applyKanbanBoardsUpdated", companyID, detail });
      if (shouldRefreshKanbanBoardsAfterUpdate(detail, companyID)) void refreshKanbanBoards();
    };
    window.addEventListener(EVENT_KANBAN_BOARDS_UPDATED, onKanbanBoardsUpdated);
    return () => window.removeEventListener(EVENT_KANBAN_BOARDS_UPDATED, onKanbanBoardsUpdated);
  }, [apiBase, companyID, refreshKanbanBoards]);

  useEffect(() => {
    return subscribeWorkspaceUserRealtime(apiBase, companyID, companyExplorerRealtimeScope, {
      onGap(gap) {
        reconcileCompanyExplorerGap(gap);
        if (shouldRefreshGVICExplorerProjectionForGap(gap, companyID)) requestGVICExplorerProjectionRefreshRef.current();
      },
      onEvent(event) {
        if (event.event !== "workspace" || event.data.length === 0) return;
        try {
          const envelope = JSON.parse(event.data) as CompanyExplorerWorkspaceStreamEnvelope;
          const affectedScopes = companyExplorerAffectedScopesFromEnvelope(envelope);
          if (affectedScopes.length > 0) {
            const plan = companyExplorerRefreshPlanFromAffectedScopes({ companyID, affectedScopes, rows: companyExplorerV2RowsRef.current });
            if (!plan.hasCompanyExplorerScopes) return;
          }
          if (shouldInvalidateKanbanBoardListForExplorerEnvelope(companyID, envelope)) {
            invalidateKanbanBoardListCache(apiBase, companyID);
          }
          dispatchExplorerStore({ type: "applyWorkspaceEnvelope", companyID, envelope });
          refreshCompanyExplorerBranchesForEnvelope(envelope);
          if (shouldRefreshGVICExplorerProjectionForEnvelope(companyID, envelope)) requestGVICExplorerProjectionRefreshRef.current();
        } catch {
          // The stream is best-effort UI sync; the explicit refresh path remains available.
        }
      },
    });
  }, [apiBase, companyID, reconcileCompanyExplorerGap, refreshCompanyExplorerBranchesForEnvelope]);
  useEffect(() => {
    if (!scopeViewsEnabled) return undefined;
    let cancelled = false;
    void fetchCurrentUser()
      .then((current) => {
        if (!cancelled) setCurrentUserID(current.user.user_id.trim());
      })
      .catch(() => {
        if (!cancelled) setCurrentUserID("");
      });
    void Promise.all([
      listCompanyUsers(companyID),
      listCompanyUserGroups(companyID),
    ])
      .then(([users, payload]) => {
        if (cancelled) return;
        setCompanyUsers(users ?? []);
        setCompanyGroups(payload.groups ?? []);
        setGroupMembers(payload.members ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setCompanyUsers([]);
          setCompanyGroups([]);
          setGroupMembers([]);
        }
      });
    return () => { cancelled = true; };
  }, [companyID, scopeViewsEnabled]);
  const teamMemberUserIDs = useMemo(() => teamMemberUserIDsForCurrentUser(companyGroups, groupMembers, currentUserID), [companyGroups, currentUserID, groupMembers]);
  const currentTeamScopeID = useMemo(() => (
    groupMembers
      .filter((member) => cleanExplorerID(member.user_id) === cleanExplorerID(currentUserID))
      .map((member) => cleanExplorerID(member.group_id))
      .filter(Boolean)
      .sort()[0] ?? ""
  ), [currentUserID, groupMembers]);
  const companyUserByID = useMemo(() => new Map(companyUsers.map((user) => [cleanExplorerID(user.user_id), user])), [companyUsers]);
  const teamUsers = useMemo(() => (
    sortExplorerUsers(Array.from(teamMemberUserIDs).map((userID) => explorerUserSummaryForID(userID, companyUserByID, groupMembers)))
  ), [companyUserByID, groupMembers, teamMemberUserIDs]);
  const companyGroupSections = useMemo<ExplorerGroupSummary[]>(() => {
    const membersByGroupID = new Map<string, CompanyUserGroupMember[]>();
    for (const member of groupMembers) {
      const groupID = cleanExplorerID(member.group_id);
      if (!groupID) continue;
      const bucket = membersByGroupID.get(groupID) ?? [];
      bucket.push(member);
      membersByGroupID.set(groupID, bucket);
    }
    const groupsByParentID = new Map<string, CompanyUserGroup[]>();
    for (const group of companyGroups) {
      const parentID = cleanExplorerID(group.parent_group_id);
      const bucket = groupsByParentID.get(parentID) ?? [];
      bucket.push(group);
      groupsByParentID.set(parentID, bucket);
    }
    for (const bucket of groupsByParentID.values()) {
      bucket.sort((left, right) => (
        (left.position - right.position)
        || compareExplorerLabels(companyExplorerGroupLabel(left, left.group_id), companyExplorerGroupLabel(right, right.group_id))
        || left.group_id.localeCompare(right.group_id)
      ));
    }
    const buildGroup = (group: CompanyUserGroup, ancestors: Set<string>): ExplorerGroupSummary | null => {
      const groupID = cleanExplorerID(group.group_id);
      if (!groupID || ancestors.has(groupID)) return null;
      const nextAncestors = new Set(ancestors).add(groupID);
      const userIDs = uniqueCleanIDs((membersByGroupID.get(groupID) ?? []).map((member) => member.user_id));
      return {
        groupID,
        label: companyExplorerGroupLabel(group, groupID),
        users: sortExplorerUsers(userIDs.map((userID) => explorerUserSummaryForID(userID, companyUserByID, groupMembers))),
        children: (groupsByParentID.get(groupID) ?? []).map((child) => buildGroup(child, nextAncestors)).filter((child): child is ExplorerGroupSummary => Boolean(child)),
      };
    };
    return (groupsByParentID.get("") ?? []).map((group) => buildGroup(group, new Set())).filter((group): group is ExplorerGroupSummary => Boolean(group));
  }, [companyGroups, companyUserByID, groupMembers]);
  const GVICScopeTargetUserIDs = useMemo(() => {
    if (!USE_SYNTHETIC_COMPANY_EXPLORER_SCOPE_ROWS) return [];
    if (!scopeViewsEnabled || scopeView === "mine") return [];
    if (scopeView === "team") return teamUsers.map((user) => user.userID);
    const collectUsers = (group: ExplorerGroupSummary): string[] => [
      ...group.users.map((user) => user.userID),
      ...group.children.flatMap(collectUsers),
    ];
    return uniqueCleanIDs(companyGroupSections.flatMap(collectUsers));
  }, [companyGroupSections, scopeView, scopeViewsEnabled, teamUsers]);
  const scopedExplorerData = useMemo(() => {
    if (!USE_SYNTHETIC_COMPANY_EXPLORER_SCOPE_ROWS) {
      return { nodes, logicGates, folders, folderItems };
    }
    return filterCompanyExplorerDataForScope({
      scopeView: scopeViewsEnabled ? scopeView : "company",
      currentUserID,
      teamMemberUserIDs,
      nodes,
      logicGates,
      folders,
      folderItems,
    });
  }, [currentUserID, folderItems, folders, logicGates, nodes, scopeView, scopeViewsEnabled, teamMemberUserIDs]);
  const GVICExplorerActive = USE_SYNTHETIC_COMPANY_EXPLORER_SCOPE_ROWS && scopeViewsEnabled && scopeView === "mine" && currentUserID.trim().length > 0;
  const fetchGVICProjectionForUser = useCallback(async (targetUserID: string): Promise<GVICProjectionCacheEntry> => {
    const cleanUserID = cleanExplorerID(targetUserID);
    const [projection, projectedLogicGates] = await Promise.all([
      listGVICMatrixProjectionRows({ apiBase, companyID, targetUserID: cleanUserID, limit: GVIC_PROJECTION_LIMIT }),
      listMyLogicGates({ apiBase, companyID, targetUserID: cleanUserID, limit: GVIC_PROJECTION_LIMIT }),
    ]);
    return {
      rows: projection.rows ?? [],
      logicGates: (projectedLogicGates.logic_gates ?? []).map((logicGate) => projectedLogicGateRecordForUser(logicGate, cleanUserID, companyID)),
      loaded: true,
    };
  }, [apiBase, companyID]);
  const refreshGVICExplorerProjection = useCallback(async () => {
    const targetUserID = currentUserID.trim();
    if (!GVICExplorerActive || !companyID || !targetUserID) return;
    const requestID = GVICProjectionRequestIDRef.current + 1;
    GVICProjectionRequestIDRef.current = requestID;
    try {
      const projection = await fetchGVICProjectionForUser(targetUserID);
      if (GVICProjectionRequestIDRef.current !== requestID) return;
      setGVICProjectionRows(projection.rows);
      setGVICProjectionLogicGates(projection.logicGates);
      setGVICProjectionLoaded(true);
    } catch (err) {
      if (GVICProjectionRequestIDRef.current !== requestID) return;
      setGVICProjectionLoaded(false);
      setError(err instanceof Error ? err.message : "failed_to_load_GVIC_explorer_projection");
    }
  }, [companyID, currentUserID, fetchGVICProjectionForUser, GVICExplorerActive]);
  const refreshScopedGVICExplorerProjections = useCallback(async () => {
    if (!scopeViewsEnabled || scopeView === "mine" || GVICScopeTargetUserIDs.length === 0) {
      GVICMultiProjectionRequestIDRef.current += 1;
      setGVICProjectionByUserID({});
      return;
    }
    const requestID = GVICMultiProjectionRequestIDRef.current + 1;
    GVICMultiProjectionRequestIDRef.current = requestID;
    const results = await Promise.allSettled(GVICScopeTargetUserIDs.map(async (targetUserID) => {
      const projection = await fetchGVICProjectionForUser(targetUserID);
      return [cleanExplorerID(targetUserID), projection] as const;
    }));
    if (GVICMultiProjectionRequestIDRef.current !== requestID) return;
    const next: Record<string, GVICProjectionCacheEntry> = {};
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const [userID, projection] = result.value;
      if (userID) next[userID] = projection;
    }
    setGVICProjectionByUserID(next);
  }, [fetchGVICProjectionForUser, GVICScopeTargetUserIDs, scopeView, scopeViewsEnabled]);
  requestGVICExplorerProjectionRefreshRef.current = () => {
    if (GVICExplorerActive) void refreshGVICExplorerProjection();
    else if (scopeViewsEnabled && scopeView !== "mine") void refreshScopedGVICExplorerProjections();
  };
  useEffect(() => {
    if (!GVICExplorerActive) {
      GVICProjectionRequestIDRef.current += 1;
      setGVICProjectionRows([]);
      setGVICProjectionLogicGates([]);
      setGVICProjectionLoaded(false);
      return undefined;
    }
    void refreshGVICExplorerProjection();
    return undefined;
  }, [GVICExplorerActive, refreshGVICExplorerProjection]);
  useEffect(() => {
    if (!scopeViewsEnabled || scopeView === "mine" || GVICScopeTargetUserIDs.length === 0) {
      GVICMultiProjectionRequestIDRef.current += 1;
      setGVICProjectionByUserID({});
      return undefined;
    }
    let cancelled = false;
    void refreshScopedGVICExplorerProjections().catch(() => {
      if (!cancelled) setGVICProjectionByUserID({});
    });
    return () => { cancelled = true; };
  }, [GVICScopeTargetUserIDs, refreshScopedGVICExplorerProjections, scopeView, scopeViewsEnabled]);
  const scopedRootFolder = useMemo(() => (
    scopedKind && scopedRootName
      ? findCompanyExplorerRootFolderByName(folders, scopedKind, scopedRootName)
      : null
  ), [folders, scopedKind, scopedRootName]);
  const logicGatesByFunctionRootFolder = useMemo(() => (
    findCompanyExplorerRootFolderByName(folders, "logic_gate", "Logic Gates by Function")
  ), [folders]);
  const scopedRootTreeID = scopedRootFolder ? `workspace-folder-${scopedRootFolder.folder_id}` : "";
  const effectiveExpanded = useMemo(() => {
    if (!scopedRootTreeID || expanded.has(scopedRootTreeID)) return expanded;
    return new Set(expanded).add(scopedRootTreeID);
  }, [expanded, scopedRootTreeID]);
  const projectedGVICExplorerData = useMemo(() => materializeGVICProjectionExplorerData({
    companyID,
    currentUserID,
    projectionRows: GVICProjectionRows,
    projectedLogicGates: GVICProjectionLogicGates,
    fallbackNodes: nodes,
    fallbackLogicGates: logicGates as ExplorerLogicGateRecord[],
  }), [companyID, currentUserID, logicGates, nodes, GVICProjectionLogicGates, GVICProjectionRows]);
  const GVICExplorerData = useMemo(() => (
    GVICProjectionLoaded
      ? projectedGVICExplorerData
      : { nodes: scopedExplorerData.nodes, logicGates: scopedExplorerData.logicGates }
  ), [projectedGVICExplorerData, GVICProjectionLoaded, scopedExplorerData.logicGates, scopedExplorerData.nodes]);

  const {
    treeRows: fullTreeRows,
    selectedTree: fullSelectedTree,
    rowByID: fullRowByID,
    selectedFolderKind,
    selectedFolderID,
    selectedFolderLabel,
    selectedKanbanBoardLabel,
  } = useCompanyExplorerTreeModel({
    expanded: effectiveExpanded,
    nodes: scopedExplorerData.nodes,
    logicGates: scopedExplorerData.logicGates,
    projects,
    kanbanBoards,
    folders: scopedExplorerData.folders,
    folderItems: scopedExplorerData.folderItems,
    rows: companyExplorerV2Rows,
    useV2Rows: companyExplorerV2Active,
    rootRowOrder,
    selectedTreeID,
    treeViewportHeight,
    treeScrollTop,
  });
  const logicGatesByFunctionRows = useMemo(() => {
    if (!logicGatesByFunctionRootFolder) return [];
    const rootTreeID = `workspace-folder-${logicGatesByFunctionRootFolder.folder_id}`;
    const expandedForBranch = effectiveExpanded.has(rootTreeID)
      ? effectiveExpanded
      : new Set(effectiveExpanded).add(rootTreeID);
    const rows = expandedForBranch === effectiveExpanded
      ? fullTreeRows
      : buildCompanyExplorerTreeRows({
          expanded: expandedForBranch,
          nodes: scopedExplorerData.nodes,
          logicGates: scopedExplorerData.logicGates,
          projects,
          kanbanBoards,
          folders: scopedExplorerData.folders,
          folderItems: scopedExplorerData.folderItems,
          rootRowOrder,
        });
    return buildScopedCompanyExplorerTreeRows(rows, logicGatesByFunctionRootFolder.folder_id);
  }, [effectiveExpanded, fullTreeRows, kanbanBoards, logicGatesByFunctionRootFolder, projects, rootRowOrder, scopedExplorerData]);
  const scopedRootRow = scopedRootTreeID ? fullRowByID.get(scopedRootTreeID) : undefined;
  const teamCompanyExplorerActive = USE_SYNTHETIC_COMPANY_EXPLORER_SCOPE_ROWS && scopeViewsEnabled && scopeView !== "mine" && !scopedExplorerActive;
  const companyHistoryRows = useMemo(() => (
    extractSystemFolderBranch(fullTreeRows, "history", (companyGroupSections.length + 1) * TREE_ROW_POSITION_STEP)
  ), [companyGroupSections.length, fullTreeRows]);
  const baseTreeRows = useMemo(() => {
    if (!USE_SYNTHETIC_COMPANY_EXPLORER_SCOPE_ROWS) {
      return scopedExplorerActive
        ? (scopedRootFolder ? buildScopedCompanyExplorerTreeRows(fullTreeRows, scopedRootFolder.folder_id) : [])
        : fullTreeRows;
    }
    return GVICExplorerActive
        ? [
            ...buildGVICCompanyExplorerRows({
              expanded: effectiveExpanded,
              nodes: GVICExplorerData.nodes,
              logicGates: GVICExplorerData.logicGates,
              projects,
              folderNodes: nodes,
              folderLogicGates: logicGates as ExplorerLogicGateRecord[],
              folders,
              folderItems,
              currentUserID,
              customFolderNodes: nodes,
              customFolderLogicGates: logicGates as ExplorerLogicGateRecord[],
              customFolderProjects: projects,
              includeCustomRootFolders: true,
              customRootOwnerUserIDs: new Set([cleanExplorerID(currentUserID)].filter(Boolean)),
            }),
          ]
      : teamCompanyExplorerActive && scopeView === "team"
        ? [
            ...buildTeamGVICExplorerRows({
              expanded: effectiveExpanded,
              companyID,
              currentUserID,
              users: teamUsers,
              projectionByUserID: GVICProjectionByUserID,
              fallbackNodes: nodes,
              fallbackLogicGates: logicGates as ExplorerLogicGateRecord[],
              fallbackProjects: projects,
              folders,
              folderItems,
            }),
          ]
      : teamCompanyExplorerActive && scopeView === "company"
        ? [
            ...buildCompanyGVICExplorerRows({
              expanded: effectiveExpanded,
              companyID,
              currentUserID,
              groups: companyGroupSections,
              projectionByUserID: GVICProjectionByUserID,
              fallbackNodes: nodes,
              fallbackLogicGates: logicGates as ExplorerLogicGateRecord[],
              fallbackProjects: projects,
              folders,
              folderItems,
              historyRows: companyHistoryRows,
            }),
            ...logicGatesByFunctionRows,
          ]
      : scopedExplorerActive
      ? (scopedRootFolder ? buildScopedCompanyExplorerTreeRows(fullTreeRows, scopedRootFolder.folder_id) : [])
      : hideMainExplorerRootFolders(fullTreeRows);
  }, [companyGroupSections, companyHistoryRows, companyID, currentUserID, effectiveExpanded, folderItems, folders, fullTreeRows, logicGates, logicGatesByFunctionRows, nodes, projects, GVICExplorerActive, GVICExplorerData, GVICProjectionByUserID, scopedExplorerActive, scopedRootFolder, scopeView, teamCompanyExplorerActive, teamUsers]);
  const explorerSearchText = effectiveExplorerSearchQuery.trim();
  const explorerSearchActive = explorerSearchText.length > 0;

  useEffect(() => {
    if (!companyExplorerV2Active || !explorerSearchActive) {
      setCompanyExplorerSearchResults([]);
      return;
    }
    const requestID = companyExplorerSearchRequestRef.current + 1;
    companyExplorerSearchRequestRef.current = requestID;
    let cancelled = false;
    void fetchCompanyExplorerSearchResults(apiBase, companyID, explorerSearchText)
      .then((payload) => {
        if (cancelled || companyExplorerSearchRequestRef.current !== requestID) return;
        setCompanyExplorerSearchResults(payload.results ?? []);
      })
      .catch((err) => {
        if (cancelled || companyExplorerSearchRequestRef.current !== requestID) return;
        setCompanyExplorerSearchResults([]);
        setError(err instanceof Error ? err.message : "failed_to_search_company_explorer");
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, companyExplorerV2Active, companyID, explorerSearchActive, explorerSearchText]);

  const companyExplorerSearchTreeRows = useMemo(() => (
    buildCompanyExplorerSearchTreeRows(companyExplorerSearchResults)
  ), [companyExplorerSearchResults]);

  const allExpandedSearchTreeRows = useMemo(() => {
    const expandedForSearch = new Set<string>(["folder-root"]);
    if (companyExplorerV2Active) {
      return companyExplorerSearchTreeRows;
    }
    for (const folder of folders) expandedForSearch.add(`workspace-folder-${folder.folder_id}`);
    for (const logicGate of logicGates) expandedForSearch.add(`logic-gate-${logicGate.logic_gate_id}`);
    const rows = buildCompanyExplorerTreeRows({
      expanded: expandedForSearch,
      nodes,
      logicGates,
      projects,
      kanbanBoards,
      folders,
      folderItems,
      rootRowOrder,
    });
    if (!USE_SYNTHETIC_COMPANY_EXPLORER_SCOPE_ROWS) {
      if (scopedExplorerActive && scopedRootFolder) return buildScopedCompanyExplorerTreeRows(rows, scopedRootFolder.folder_id);
      return rows;
    }
    if (!scopeViewsEnabled || scopedExplorerActive) return hideMainExplorerRootFolders(rows);

    const logicGatesByFunctionSearchRows = logicGatesByFunctionRootFolder
      ? buildScopedCompanyExplorerTreeRows(rows, logicGatesByFunctionRootFolder.folder_id)
      : [];
    return [
      ...buildCompanyGVICExplorerRows({
        expanded: new Set(["*"]),
        companyID,
        currentUserID,
        groups: companyGroupSections,
        projectionByUserID: GVICProjectionByUserID,
        fallbackNodes: nodes,
        fallbackLogicGates: logicGates as ExplorerLogicGateRecord[],
        fallbackProjects: projects,
        folders,
        folderItems,
        historyRows: extractSystemFolderBranch(rows, "history", (companyGroupSections.length + 1) * TREE_ROW_POSITION_STEP),
      }),
      ...logicGatesByFunctionSearchRows,
    ];
  }, [companyExplorerSearchTreeRows, companyExplorerV2Active, companyGroupSections, companyID, currentUserID, folderItems, folders, kanbanBoards, logicGates, logicGatesByFunctionRootFolder, nodes, projects, GVICProjectionByUserID, rootRowOrder, scopedExplorerActive, scopedRootFolder, scopeViewsEnabled]);
  const explorerSearchViewRows = useMemo(() => (
    companyExplorerV2Active
      ? companyExplorerSearchTreeRows
      : buildExplorerSearchViewRows({ rows: allExpandedSearchTreeRows, query: effectiveExplorerSearchQuery })
  ), [allExpandedSearchTreeRows, companyExplorerSearchTreeRows, companyExplorerV2Active, effectiveExplorerSearchQuery]);
  const explorerSearchDropdownRows = useMemo(() => (
    companyExplorerV2Active
      ? companyExplorerSearchTreeRows
      : buildExplorerSearchViewRows({ rows: allExpandedSearchTreeRows, query: effectiveExplorerSearchQuery, includeBranchDescendants: true })
  ), [allExpandedSearchTreeRows, companyExplorerSearchTreeRows, companyExplorerV2Active, effectiveExplorerSearchQuery]);
  useEffect(() => {
    if (!onSearchResultsChange) return;
    if (!explorerSearchActive) {
      onSearchResultsChange([]);
      return;
    }
    const results: CompanyExplorerSearchResultSummary[] = explorerSearchDropdownRows.map((row, index) => {
      const nextRow = explorerSearchDropdownRows[index + 1];
      return {
        treeID: row.id,
        label: row.label,
        kind: row.kind,
        depth: row.depth,
        folderLabel: row.folderLabel,
        systemKey: row.systemKey,
        mangoDefaultFolder: row.kind === "folder" && (Boolean(row.systemKey) || row.syntheticKind === "GVIC_folder" || row.syntheticKind === "default_scope_folder"),
        hasChildren: Boolean(row.hasChildren) || Boolean(nextRow && nextRow.depth > row.depth),
      };
    });
    onSearchResultsChange(results);
  }, [explorerSearchActive, explorerSearchDropdownRows, onSearchResultsChange]);
  const treeRows = explorerSearchActive ? explorerSearchViewRows : baseTreeRows;
  const rowByID = useMemo(() => new Map(treeRows.map((row) => [row.id, row])), [treeRows]);
  const baseRowByID = useMemo(() => new Map(baseTreeRows.map((row) => [row.id, row])), [baseTreeRows]);
  const selectedTree = rowByID.get(selectedTreeID) ?? baseRowByID.get(selectedTreeID) ?? (scopedRootFolder ? scopedRootRow : fullSelectedTree);
  const virtualizedTree = useCompanyExplorerVirtualTree(treeRows, treeViewportHeight, treeScrollTop, useParentScroll ? 0 : undefined);
  const scopedAllowedItemType: CompanyExplorerItemType | "" = scopedKind ?? "";
  const systemFolderTreeIDByKey = useMemo(() => {
    const items = new Map<CompanyExplorerSystemFolderKey, string>();
    for (const folder of folders) {
      if (isExplorerSystemFolderKey(folder.system_key)) {
        items.set(folder.system_key, `workspace-folder-${folder.folder_id}`);
      }
    }
    return items;
  }, [folders]);

  useEffect(() => {
    const previousSearchText = previousExplorerSearchTextRef.current;
    const viewport = treeViewportRef.current;
    if (explorerSearchActive) {
      if (!previousSearchText) preSearchScrollTopRef.current = treeScrollTop;
      if (explorerSearchText !== previousSearchText) {
        setTreeScrollTop(0);
        if (viewport) {
          if (useParentScroll) {
            const scrollContainer = findParentScrollContainer(viewport);
            scrollContainer.scrollTop = Math.max(0, getRowsTopOffsetInScrollContainer(viewport, scrollContainer));
          } else {
            viewport.scrollTop = 0;
          }
        }
      }
    } else if (previousSearchText) {
      const restoredScrollTop = preSearchScrollTopRef.current;
      setTreeScrollTop(restoredScrollTop);
      if (viewport && !useParentScroll) viewport.scrollTop = restoredScrollTop;
    }
    previousExplorerSearchTextRef.current = explorerSearchText;
  }, [explorerSearchActive, explorerSearchText, treeScrollTop, useParentScroll]);

  useEffect(() => {
    selectedTreeIDRef.current = selectedTreeID;
  }, [selectedTreeID]);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    treeRowsRef.current = treeRows;
  }, [treeRows]);

  useEffect(() => {
    const nextActiveBranches = new Set<string>([companyExplorerBranchKey("")]);
    let collapsedDepth: number | null = null;
    for (const row of baseTreeRows) {
      if (collapsedDepth !== null) {
        if (row.depth > collapsedDepth) continue;
        collapsedDepth = null;
      }
      const rowExpanded = effectiveExpanded.has(row.id) || effectiveExpanded.has("*");
      if (row.entityID && row.hasChildren && rowExpanded) nextActiveBranches.add(companyExplorerBranchKey(row.entityID));
      if (row.hasChildren && !rowExpanded) collapsedDepth = row.depth;
    }
    activeCompanyExplorerBranchesRef.current = nextActiveBranches;
    for (const branchKey of staleCompanyExplorerBranchesRef.current) {
      if (!nextActiveBranches.has(branchKey) || !loadedCompanyExplorerBranchesRef.current.has(branchKey)) continue;
      const parentEntityID = companyExplorerBranchParentEntityID(branchKey);
      if (parentEntityID !== null) void refreshCompanyExplorerBranch(parentEntityID);
    }
  }, [baseTreeRows, companyExplorerBranchKey, companyExplorerBranchParentEntityID, effectiveExpanded, refreshCompanyExplorerBranch]);

  useEffect(() => {
    latestSelectionRef.current = { selectedNodeID, selectedTreeID };
  }, [selectedNodeID, selectedTreeID]);

  useEffect(() => {
    latestLogicGateSelectionRef.current = { selectedLogicGateID, selectedTreeID };
  }, [selectedLogicGateID, selectedTreeID]);

  const renamingTreeID = renaming?.treeID ?? "";

  useEffect(() => {
    if (!renamingTreeID || !renameInputRef.current) return;
    const input = renameInputRef.current;
    input.focus();
    input.select();
  }, [renamingTreeID]);

  useEffect(() => {
    if (!treeViewportRef.current) return;
    const viewport = treeViewportRef.current;
    const scrollContainer = useParentScroll ? findParentScrollContainer(viewport) : viewport;
    let animationFrame = 0;

    const measure = () => {
      if (useParentScroll) {
        const rowsTopOffset = getRowsTopOffsetInScrollContainer(viewport, scrollContainer);
        setTreeViewportHeight(Math.max(1, scrollContainer.clientHeight));
        setTreeScrollTop(Math.max(0, scrollContainer.scrollTop - rowsTopOffset));
        return;
      }
      const height = viewport.clientHeight;
      if (height > 0) setTreeViewportHeight(height);
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measure);
    };

    measure();
    if (useParentScroll) scrollContainer.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(viewport);
    if (scrollContainer !== viewport) resizeObserver?.observe(scrollContainer);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (useParentScroll) scrollContainer.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
    };
  }, [explorerSearchActive, hideTopControls, treeRows.length, useParentScroll]);

  useEffect(() => {
    if (!useParentScroll || !treeViewportRef.current) return;
    const viewport = treeViewportRef.current;
    const scrollContainer = findParentScrollContainer(viewport);
    const rowsTopOffset = getRowsTopOffsetInScrollContainer(viewport, scrollContainer);
    const nextViewportHeight = Math.max(1, scrollContainer.clientHeight);
    const nextScrollTop = Math.max(0, scrollContainer.scrollTop - rowsTopOffset);
    setTreeViewportHeight((current) => (current === nextViewportHeight ? current : nextViewportHeight));
    setTreeScrollTop((current) => (Math.abs(current - nextScrollTop) < 0.5 ? current : nextScrollTop));
  });

  useEffect(() => {
    if (!scopedRootTreeID) return;
    setExpanded((previous) => previous.has(scopedRootTreeID) ? previous : new Set(previous).add(scopedRootTreeID));
  }, [scopedRootTreeID]);

  useEffect(() => {
    try {
      localStorage.setItem(scrollStorageKey, String(Math.max(0, Math.round(treeScrollTop))));
    } catch {
      // Scroll position is a local convenience only.
    }
  }, [scrollStorageKey, treeScrollTop]);

  useEffect(() => {
    try {
      localStorage.setItem(rootOrderStorageKey, JSON.stringify(rootRowOrder));
    } catch {
      // Root-level order for unplaced rows is intentionally per-device view state.
    }
  }, [rootOrderStorageKey, rootRowOrder]);

  useEffect(() => {
    const viewport = treeViewportRef.current;
    if (!viewport || useParentScroll) return;
    const nextScrollTop = Math.max(0, Math.round(treeScrollTop));
    if (Math.abs(viewport.scrollTop - nextScrollTop) > 1) viewport.scrollTop = nextScrollTop;
  }, [treeRows.length, treeScrollTop, useParentScroll]);

  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);

  useEffect(() => {
    if (!scopeViewsEnabled || companyExplorerLazyScope !== "all" || !folderSnapshotLoaded || !companyID) return;
    const missing = GVIC_FOLDER_ROWS.find((folder) => !GVICVisualRootFolderForRole(folders, folder.role));
    if (!missing) return;
    const creationKey = `${companyID}:${missing.role}`;
    if (GVICVisualRootCreationKeys.has(creationKey)) return;
    let cancelled = false;
    GVICVisualRootCreationKeys.add(creationKey);
    requestJSON<CompanyExplorerFolder>("/v1/company-explorer/folders", {
      method: "POST",
      body: JSON.stringify({
        company_id: companyID,
        parent_folder_id: "",
        folder_kind: "logic_gate",
        name: GVICVisualRootFolderName(missing.role),
      }),
    }).then((created) => {
      upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, created);
      upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, created);
      if (!cancelled) dispatchExplorerStore({ type: "upsertFolder", folder: created });
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "failed_to_create_GVIC_visual_folder");
    }).finally(() => {
      GVICVisualRootCreationKeys.delete(creationKey);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase, companyExplorerLazyScope, companyID, folderSnapshotLoaded, folders, requestJSON, scopeViewsEnabled]);

  useEffect(() => {
    if (!companyID || !folderSnapshotLoaded || !scopedKind || !scopedRootName || scopedRootFolder) return;
    const creationKey = `${companyID}:${scopedKind}:${scopedRootName.toLowerCase()}`;
    if (scopedRootCreationKeys.has(creationKey)) return;
    let cancelled = false;
    scopedRootCreationKeys.add(creationKey);
    setError("");
    requestJSON<CompanyExplorerFolder>("/v1/company-explorer/folders", {
      method: "POST",
      body: JSON.stringify({
        company_id: companyID,
        parent_folder_id: "",
        folder_kind: scopedKind,
        name: scopedRootName,
      }),
    }).then((folder) => {
      upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, folder);
      upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, folder);
      if (cancelled) return;
      dispatchExplorerStore({ type: "upsertFolder", folder });
      setExpanded((previous) => new Set(previous).add(`workspace-folder-${folder.folder_id}`));
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "failed_to_create_scoped_folder");
    }).finally(() => {
      scopedRootCreationKeys.delete(creationKey);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase, companyID, folderSnapshotLoaded, requestJSON, scopedKind, scopedRootFolder, scopedRootName]);

  const resolveCreateFolderScope = useCallback((
    parentFolderID: string,
    requestedScopeType?: CompanyExplorerFolderScopeType,
    requestedScopeID?: string,
  ): { scope_type: CompanyExplorerFolderScopeType; scope_id?: string } | null => {
    const cleanRequestedScopeID = cleanExplorerID(requestedScopeID);
    if ((requestedScopeType === "user" || requestedScopeType === "team") && cleanRequestedScopeID) {
      return { scope_type: requestedScopeType, scope_id: cleanRequestedScopeID };
    }
    if (requestedScopeType === "company") return { scope_type: "company" };
    const parentFolder = folders.find((folder) => folder.folder_id === parentFolderID);
    const parentScopeType = parentFolder?.scope_type;
    const parentScopeID = cleanExplorerID(parentFolder?.scope_id);
    if ((parentScopeType === "user" || parentScopeType === "team") && parentScopeID) {
      return { scope_type: parentScopeType, scope_id: parentScopeID };
    }
    if (scopeViewsEnabled && scopeView === "mine") {
      const userID = cleanExplorerID(currentUserID);
      if (userID) return { scope_type: "user", scope_id: userID };
    }
    if (scopeViewsEnabled && scopeView === "team") {
      const teamID = cleanExplorerID(currentTeamScopeID);
      if (teamID) return { scope_type: "team", scope_id: teamID };
    }
    return null;
  }, [currentTeamScopeID, currentUserID, folders, scopeView, scopeViewsEnabled]);

  const createFolder = useCallback(async (
    folderKind: CompanyExplorerFolderKind,
    parentFolderID: string,
    position?: number,
    requestedScopeType?: CompanyExplorerFolderScopeType,
    requestedScopeID?: string,
  ) => {
    setError("");
    try {
      if (companyExplorerV2Active) {
        const parentEntityID = parentFolderID || companyExplorerV2RootEntityID;
        if (!parentEntityID) throw new Error("company_explorer_v2_parent_missing");
        const row = await requestJSON<CompanyExplorerV2Row>("/v1/company-explorer/folders", {
          method: "POST",
          body: JSON.stringify({
            company_id: companyID,
            parent_folder_id: parentEntityID === companyExplorerV2RootEntityID ? "" : parentEntityID,
            name: "New Folder",
            position,
          }),
        });
        dispatchExplorerStore({ type: "upsertV2Rows", rows: [row] });
        setExpanded((previous) => {
          const next = new Set(previous);
          next.add(companyExplorerV2TreeIDForEntityID(parentEntityID));
          next.add(`workspace-folder-${row.entity_id}`);
          return next;
        });
        lastLocalExplorerSelectionRef.current = { domain: folderKind, changedAt: Date.now() };
        pendingExplorerSelectionIntentRef.current = "activate";
        setSelectedTreeID(`workspace-folder-${row.entity_id}`);
        setSelectedTreeIDs(new Set([`workspace-folder-${row.entity_id}`]));
        setSelectionAnchorTreeID(`workspace-folder-${row.entity_id}`);
        setSelectedNodeID("");
        setSelectedLogicGateID("");
        setSelectedKanbanBoardID("");
        return;
      }
      const folderScope = resolveCreateFolderScope(parentFolderID, requestedScopeType, requestedScopeID);
      let folder = await requestJSON<CompanyExplorerFolder>("/v1/company-explorer/folders", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          parent_folder_id: parentFolderID,
          folder_kind: folderKind,
          name: "New Folder",
          ...(folderScope ? { scope_type: folderScope.scope_type, scope_id: folderScope.scope_id ?? "" } : {}),
        }),
      });
      if (position && position > 0) {
        folder = await requestJSON<CompanyExplorerFolder>(`/v1/company-explorer/folders/${folder.folder_id}`, {
          method: "PUT",
          body: JSON.stringify({ company_id: companyID, position }),
        });
      }
      dispatchExplorerStore({ type: "upsertFolder", folder });
      setExpanded((previous) => {
        const next = new Set(previous);
        next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-root");
        next.add(`workspace-folder-${folder.folder_id}`);
        return next;
      });
      upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, folder);
      upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, folder);
      lastLocalExplorerSelectionRef.current = { domain: folderKind, changedAt: Date.now() };
      pendingExplorerSelectionIntentRef.current = "activate";
      setSelectedTreeID(`workspace-folder-${folder.folder_id}`);
      setSelectedTreeIDs(new Set([`workspace-folder-${folder.folder_id}`]));
      setSelectionAnchorTreeID(`workspace-folder-${folder.folder_id}`);
      setSelectedNodeID("");
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_folder");
    }
  }, [apiBase, companyExplorerV2Active, companyExplorerV2RootEntityID, companyExplorerV2TreeIDForEntityID, companyID, requestJSON, resolveCreateFolderScope]);

  const assignItemsToFolders = useCallback(async (assignments: CompanyExplorerFolderItemAssignment[], options: { expandTarget?: boolean } = {}) => {
    const normalizedAssignments = assignments.filter((assignment) => (
      assignment.folder_id
      && assignment.item_id
      && assignment.item_type
      && assignment.item_type !== "kanban"
    ));
    if (normalizedAssignments.length === 0) return true;
    setError("");
    try {
      const placeRows = async (): Promise<CompanyExplorerV2Row[]> => {
        if (normalizedAssignments.length > 1) {
          const response = await requestJSON<{ rows?: CompanyExplorerV2Row[] }>("/v1/company-explorer/items", {
            method: "POST",
            body: JSON.stringify({
              company_id: companyID,
              items: normalizedAssignments.map((assignment) => {
                const existing = companyExplorerV2Rows.find((row) => (
                  row.entity_type === assignment.item_type
                  && (row.resource_id || row.entity_id) === assignment.item_id
                  && row.edge_id
                ));
                return {
                  edge_id: existing?.edge_id,
                  parent_entity_id: assignment.folder_id,
                  target_type: assignment.item_type,
                  target_id: assignment.item_id,
                  position: assignment.position,
                };
              }),
            }),
          });
          return response.rows ?? [];
        }
        return Promise.all(normalizedAssignments.map((assignment) => {
          const existing = companyExplorerV2Rows.find((row) => (
            row.entity_type === assignment.item_type
            && (row.resource_id || row.entity_id) === assignment.item_id
            && row.edge_id
          ));
          if (existing?.edge_id) {
            return requestJSON<CompanyExplorerV2Row>(`/v1/company-explorer/items/${existing.edge_id}`, {
              method: "PUT",
              body: JSON.stringify({
                company_id: companyID,
                parent_entity_id: assignment.folder_id,
                position: assignment.position,
              }),
            });
          }
          return requestJSON<CompanyExplorerV2Row>("/v1/company-explorer/items", {
            method: "POST",
            body: JSON.stringify({
              company_id: companyID,
              parent_entity_id: assignment.folder_id,
              target_type: assignment.item_type,
              target_id: assignment.item_id,
              position: assignment.position,
            }),
          });
        }));
      };
      if (companyExplorerV2Active) {
        const updatedRows = await placeRows();
        if (updatedRows.length > 0) dispatchExplorerStore({ type: "upsertV2Rows", rows: updatedRows });
        if (options.expandTarget) {
          setExpanded((previous) => {
            const next = new Set(previous);
            for (const assignment of normalizedAssignments) {
              next.add(companyExplorerV2TreeIDForEntityID(assignment.folder_id));
            }
            return next;
          });
        }
        return true;
      }
      const rows = await placeRows();
      const items = rows.map((row) => ({
        company_id: row.company_id,
        folder_id: row.parent_entity_id ?? "",
        item_type: row.entity_type as CompanyExplorerFolderItem["item_type"],
        item_id: row.resource_id || row.entity_id,
        position: row.position ?? 0,
        created_timestamp: row.created_timestamp,
        updated_timestamp: row.updated_timestamp,
      })).filter((item) => item.folder_id && item.item_id);
      dispatchExplorerStore({ type: "upsertV2Rows", rows });
      dispatchExplorerStore({ type: "upsertFolderItems", folderItems: items });
      for (const item of items) {
        upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, item);
        upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase, companyID, item);
      }
      if (options.expandTarget) {
        setExpanded((previous) => {
          const next = new Set(previous);
          for (const assignment of normalizedAssignments) next.add(`workspace-folder-${assignment.folder_id}`);
          return next;
        });
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_move_item");
      return false;
    }
  }, [apiBase, companyExplorerV2Rows, companyExplorerV2TreeIDForEntityID, companyID, folderItems, requestJSON]);

  const upsertOptimisticFolderItem = useCallback((item: CompanyExplorerFolderItem) => {
    dispatchExplorerStore({ type: "upsertFolderItems", folderItems: [item] });
    upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, item);
    upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase, companyID, item);
  }, [apiBase, companyID]);

  const expandCreatedItemTarget = useCallback((parentFolderID: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (companyExplorerV2Active) {
        next.add(companyExplorerV2TreeIDForEntityID(parentFolderID || companyExplorerV2RootEntityID));
      } else {
        next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-root");
      }
      return next;
    });
  }, [companyExplorerV2Active, companyExplorerV2RootEntityID, companyExplorerV2TreeIDForEntityID]);

  const createNodeAtFolder = useCallback(async (parentFolderID: string, position?: number, logicGateID?: string, logicGateTreeID?: string, priority?: number) => {
    setError("");
    const targetLogicGateID = logicGateID?.trim() ?? "";
    const targetLogicGateTreeID = logicGateTreeID?.trim() ?? "";
    const targetPriority = typeof priority === "number" && Number.isInteger(priority) && priority >= 1 && priority <= 5 ? priority : undefined;
    if (targetLogicGateID && targetPriority === undefined) {
      setError("Priority is required");
      return;
    }
    try {
      const response = await createWorkspaceEntityBatchCommand<CompanyExplorerWorkspaceEntityBatchResponse>({
        companyID,
        entityKind: "node",
        folderID: (targetLogicGateID || companyExplorerV2Active) ? "" : parentFolderID,
        mutationOrigin: "company_explorer",
        items: [{
          client_id: createWorkspaceEntityBatchClientID("explorer-node"),
          name: "new node",
          x: 120,
          y: 120,
          position,
        }],
        requestJSON,
      });
      const node = response.nodes?.[0];
      if (!node) throw new Error("node_batch_create_missing_node");
      for (const item of response.folder_items ?? []) upsertOptimisticFolderItem(item);
      let createdFolderID = response.folder_items?.find((item) => item.item_type === "node" && item.item_id === node.node_id)?.folder_id ?? parentFolderID;
      if (companyExplorerV2Active && !targetLogicGateID) {
        const parentEntityID = parentFolderID || companyExplorerV2RootEntityID;
        if (parentEntityID) {
          const row = await requestJSON<CompanyExplorerV2Row>("/v1/company-explorer/items", {
            method: "POST",
            body: JSON.stringify({
              company_id: companyID,
              parent_entity_id: parentEntityID,
              target_type: "node",
              target_id: node.node_id,
              position,
            }),
          });
          dispatchExplorerStore({ type: "upsertV2Rows", rows: [row] });
          createdFolderID = parentEntityID;
        }
      }
      dispatchExplorerStore({ type: "upsertNode", node });
      upsertNodeRelationshipGraphNode(apiBase, companyID, node);
      if (targetLogicGateID) {
        const assignment = await assignNodeToLogicGateStatus({
          apiBase,
          companyID,
          logicGateID: targetLogicGateID,
          nodeID: node.node_id,
          mutationOrigin: "matrix",
          priority: targetPriority,
        });
        dispatchExplorerStore({ type: "replaceNode", node: assignment.node });
        upsertNodeRelationshipGraphNode(apiBase, companyID, assignment.node);
        if (targetLogicGateTreeID) setExpanded((previous) => new Set(previous).add(targetLogicGateTreeID));
        if (companyExplorerV2Active) {
          activeCompanyExplorerBranchesRef.current.add(companyExplorerBranchKey(targetLogicGateID));
          await refreshCompanyExplorerBranch(targetLogicGateID);
        }
        requestGVICExplorerProjectionRefreshRef.current();
      }
      if (!createdFolderID && position && position > 0) {
        setRootRowOrder((previous) => ({ ...previous, [`node-${node.node_id}`]: position }));
      }
      expandCreatedItemTarget(createdFolderID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_node");
    }
  }, [apiBase, companyExplorerBranchKey, companyExplorerV2Active, companyExplorerV2RootEntityID, companyID, expandCreatedItemTarget, refreshCompanyExplorerBranch, requestJSON, upsertOptimisticFolderItem]);

  const createLogicGateAtFolder = useCallback(async (parentFolderID: string, position?: number, GVICRole?: string) => {
    setError("");
    const creatorLogicGateGVICRole: WorkspaceEntityBatchCreatorLogicGateGVICRole | undefined = isLogicGateGVICRole(GVICRole) ? GVICRole : undefined;
    try {
      const response = await createWorkspaceEntityBatchCommand<CompanyExplorerWorkspaceEntityBatchResponse>({
        companyID,
        entityKind: "logic_gate",
        folderID: companyExplorerV2Active ? "" : parentFolderID,
        mutationOrigin: "company_explorer",
        creatorLogicGateGVICRole,
        items: [{
          client_id: createWorkspaceEntityBatchClientID("explorer-logic-gate"),
          title: "new logic gate",
          x: 120,
          y: 120,
          position,
        }],
        requestJSON,
      });
      const created = response.logic_gates?.[0];
      if (!created) throw new Error("logic_gate_batch_create_missing_gate");
      const logicGate = toLogicGateCanvasRecord(created) as ExplorerLogicGateRecord;
      logicGate.gvic_assignments = created.gvic_assignments ?? [];
      for (const item of response.folder_items ?? []) upsertOptimisticFolderItem(item);
      let createdFolderID = response.folder_items?.find((item) => item.item_type === "logic_gate" && item.item_id === logicGate.logic_gate_id)?.folder_id ?? parentFolderID;
      if (companyExplorerV2Active) {
        const parentEntityID = parentFolderID || companyExplorerV2RootEntityID;
        if (parentEntityID) {
          const row = await requestJSON<CompanyExplorerV2Row>("/v1/company-explorer/items", {
            method: "POST",
            body: JSON.stringify({
              company_id: companyID,
              parent_entity_id: parentEntityID,
              target_type: "logic_gate",
              target_id: logicGate.logic_gate_id,
              position,
            }),
          });
          dispatchExplorerStore({ type: "upsertV2Rows", rows: [row] });
          createdFolderID = parentEntityID;
        }
      }
      dispatchExplorerStore({ type: "upsertLogicGate", logicGate });
      upsertLogicGateRelationshipGraphNode(apiBase, companyID, logicGate);
      if (!createdFolderID && position && position > 0) {
        setRootRowOrder((previous) => ({ ...previous, [`logic-gate-${logicGate.logic_gate_id}`]: position }));
      }
      expandCreatedItemTarget(createdFolderID);
      lastLocalExplorerSelectionRef.current = { domain: "logic_gate", changedAt: Date.now() };
      pendingExplorerSelectionIntentRef.current = "activate";
      setSelectedTreeID(`logic-gate-${logicGate.logic_gate_id}`);
      setSelectedTreeIDs(new Set([`logic-gate-${logicGate.logic_gate_id}`]));
      setSelectionAnchorTreeID(`logic-gate-${logicGate.logic_gate_id}`);
      setSelectedLogicGateID(logicGate.logic_gate_id);
      setSelectedNodeID("");
      setSelectedKanbanBoardID("");
      if (creatorLogicGateGVICRole) requestGVICExplorerProjectionRefreshRef.current();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_logic_gate");
    }
  }, [apiBase, companyExplorerV2Active, companyExplorerV2RootEntityID, companyID, expandCreatedItemTarget, requestJSON, upsertOptimisticFolderItem]);

  const createProjectAtFolder = useCallback(async (parentFolderID: string, position?: number) => {
    setError("");
    try {
      const response = await createProject({
        companyID,
        name: "New Project",
        status: "Active",
        skipCompanyExplorerDefaultPlacement: true,
      });
      const project = response.project;
      if (!project) throw new Error("project_create_missing_project");
      let createdFolderID = parentFolderID;
      if (companyExplorerV2Active) {
        const parentEntityID = parentFolderID || companyExplorerV2RootEntityID;
        if (parentEntityID) {
          const row = await requestJSON<CompanyExplorerV2Row>("/v1/company-explorer/items", {
            method: "POST",
            body: JSON.stringify({
              company_id: companyID,
              parent_entity_id: parentEntityID,
              target_type: "project",
              target_id: project.project_id,
              position,
            }),
          });
          dispatchExplorerStore({ type: "upsertV2Rows", rows: [row] });
          createdFolderID = parentEntityID;
        }
      } else if (parentFolderID) {
        await assignItemsToFolders([{
          folder_id: parentFolderID,
          item_type: "project",
          item_id: project.project_id,
          position,
        }], { expandTarget: true });
      }
      dispatchExplorerStore({ type: "upsertProject", project });
      if (!createdFolderID && position && position > 0) {
        setRootRowOrder((previous) => ({ ...previous, [`project-${project.project_id}`]: position }));
      }
      expandCreatedItemTarget(createdFolderID);
      lastLocalExplorerSelectionRef.current = { domain: "project", changedAt: Date.now() };
      pendingExplorerSelectionIntentRef.current = "activate";
      setSelectedTreeID(`project-${project.project_id}`);
      setSelectedTreeIDs(new Set([`project-${project.project_id}`]));
      setSelectionAnchorTreeID(`project-${project.project_id}`);
      setSelectedLogicGateID("");
      setSelectedNodeID("");
      setSelectedKanbanBoardID("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_project");
    }
  }, [assignItemsToFolders, companyExplorerV2Active, companyExplorerV2RootEntityID, companyID, expandCreatedItemTarget, requestJSON]);

  // Delete through one canonical batch request, then patch local/shared caches
  // once so multi-select deletes do not visibly collapse one row at a time.
  const deleteExplorerTargets = useCallback(async (targets: ExplorerDeleteTargetWithLabel[]) => {
    const seen = new Set<string>();
    const selectedLogicGateBoardIDs = new Set(
      targets
        .filter((target) => target.kind === "logic_gate")
        .map((target) => logicGateKanbanBoardID(target.id)),
    );
    const normalizedTargets = targets.filter((target) => {
      if (target.kind === "kanban" && selectedLogicGateBoardIDs.has(target.id)) return false;
      const key = target.edgeID ? `edge:${target.edgeID}` : target.entityID ? `${target.entityType}:${target.entityID}` : `${target.kind}:${target.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (normalizedTargets.length === 0) return;

    const deletedFolderIDs = new Set<string>();
    const deletedNodeIDs = new Set<string>();
    const deletedLogicGateIDs = new Set<string>();
    const deletedProjectIDs = new Set<string>();
    const deletedKanbanBoardIDs = new Set<string>();
    const v2FolderEntityIDs = new Set(companyExplorerV2Rows.filter((row) => row.entity_type === "folder").map((row) => row.entity_id));
    const collectV2FolderSubtreeIDs = (rootEntityID: string): Set<string> => {
      const deleted = new Set<string>();
      if (!rootEntityID || !v2FolderEntityIDs.has(rootEntityID)) return deleted;
      deleted.add(rootEntityID);
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of companyExplorerV2Rows) {
          if (row.entity_type !== "folder" || !row.parent_entity_id || !deleted.has(row.parent_entity_id) || deleted.has(row.entity_id)) continue;
          deleted.add(row.entity_id);
          changed = true;
        }
      }
      return deleted;
    };

    for (const target of normalizedTargets) {
      if (target.kind === "folder") {
        const v2Subtree = collectV2FolderSubtreeIDs(target.id);
        if (v2Subtree.size > 0) {
          for (const id of v2Subtree) deletedFolderIDs.add(id);
        } else {
          for (const id of collectFolderSubtreeIDs(folders, target.id)) deletedFolderIDs.add(id);
        }
      } else if (target.kind === "node") {
        deletedNodeIDs.add(target.id);
      } else if (target.kind === "logic_gate") {
        deletedLogicGateIDs.add(target.id);
        deletedKanbanBoardIDs.add(logicGateKanbanBoardID(target.id));
      } else if (target.kind === "project") {
        deletedProjectIDs.add(target.id);
      } else {
        deletedKanbanBoardIDs.add(target.id);
      }
    }
    for (const board of kanbanBoards) {
      if (board.logic_gate_id && deletedLogicGateIDs.has(board.logic_gate_id)) {
        deletedKanbanBoardIDs.add(board.board_id);
      }
    }

    const previousExplorerStore = explorerStore;

    setError("");
    dispatchExplorerStore({
      type: "removeDeletedEntities",
      deletedFolderIDs,
      deletedNodeIDs,
      deletedLogicGateIDs,
      deletedProjectIDs,
      deletedKanbanBoardIDs,
    });
    try {
      const deleteTargets = normalizedTargets.map((target) => {
        if (target.kind === "folder") {
          return { kind: "folder", id: target.id, folder_kind: target.folderKind };
        }
        return { kind: target.kind, id: target.id };
      });
      await requestJSON("/v1/company-explorer/delete-targets", {
        method: "POST",
        body: JSON.stringify({ company_id: companyID, targets: deleteTargets }),
      });

      if (deletedFolderIDs.size > 0) {
        for (const folderID of deletedFolderIDs) {
          removeCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, folderID);
          removeCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, folderID);
        }
      }
      if (deletedNodeIDs.size > 0) {
        for (const nodeID of deletedNodeIDs) removeNodeRelationshipGraphNode(apiBase, companyID, nodeID);
      }
      if (deletedLogicGateIDs.size > 0) {
        for (const logicGateID of deletedLogicGateIDs) removeLogicGateRelationshipGraphNode(apiBase, companyID, logicGateID);
      }
      if (deletedKanbanBoardIDs.size > 0) {
        for (const boardID of deletedKanbanBoardIDs) {
          window.dispatchEvent(new CustomEvent<KanbanBoardsUpdatedDetail>(EVENT_KANBAN_BOARDS_UPDATED, { detail: { companyID, deletedBoardID: boardID } }));
        }
      }

      lastLocalExplorerSelectionRef.current = { domain: "root", changedAt: Date.now() };
      pendingExplorerSelectionIntentRef.current = "navigate";
      setSelectedTreeID("folder-root");
      setSelectedTreeIDs(new Set(["folder-root"]));
      setSelectionAnchorTreeID("folder-root");
      setSelectedNodeID("");
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
    } catch (err) {
      dispatchExplorerStore({ type: "restore", state: previousExplorerStore });
      setError(err instanceof Error ? err.message : "failed_to_delete_selection");
    }
  }, [apiBase, companyExplorerV2Rows, companyID, explorerStore, folderItems, folders, kanbanBoards, requestJSON]);

  const getDeleteTargetsForRows = useCallback((rows: ExplorerTreeNode[]): ExplorerDeleteTargetWithLabel[] => {
    const selectedFolderIDs = new Set(rows.filter((row) => row.kind === "folder" && row.folderID && !row.entityID && !isProtectedGVICRoleRow(row)).map((row) => row.folderID!));
    const selectedV2FolderEntityIDs = new Set(rows.filter((row) => row.kind === "folder" && row.entityType === "folder" && row.entityID && !isProtectedGVICRoleRow(row)).map((row) => row.entityID!));
    const v2ParentByEntityID = new Map(companyExplorerV2Rows.map((row) => [row.entity_id, row.parent_entity_id ?? ""]));
    const isFolderCoveredBySelectedAncestor = (folderID: string): boolean => {
      let currentFolderID = folderID;
      const seen = new Set<string>();
      while (currentFolderID && !seen.has(currentFolderID)) {
        if (selectedFolderIDs.has(currentFolderID)) return true;
        seen.add(currentFolderID);
        currentFolderID = folders.find((folder) => folder.folder_id === currentFolderID)?.parent_folder_id ?? "";
      }
      return false;
    };
    const isV2EntityCoveredBySelectedAncestor = (parentEntityID: string): boolean => {
      let currentEntityID = parentEntityID;
      const seen = new Set<string>();
      while (currentEntityID && !seen.has(currentEntityID)) {
        if (selectedV2FolderEntityIDs.has(currentEntityID)) return true;
        seen.add(currentEntityID);
        currentEntityID = v2ParentByEntityID.get(currentEntityID) ?? "";
      }
      return false;
    };
    const isCoveredBySelectedAncestor = (row: ExplorerTreeNode): boolean => {
      if (row.entityID && row.entityType) return isV2EntityCoveredBySelectedAncestor(row.parentEntityID ?? v2ParentByEntityID.get(row.entityID) ?? "");
      if (row.kind === "folder") return Boolean(row.parentFolderID && isFolderCoveredBySelectedAncestor(row.parentFolderID));
      return Boolean(row.folderID && isFolderCoveredBySelectedAncestor(row.folderID));
    };
    const targets: ExplorerDeleteTargetWithLabel[] = [];
    const seenTargets = new Set<string>();
    for (const row of rows) {
      if (isProtectedGVICRoleRow(row)) continue;
      if (isCoveredBySelectedAncestor(row)) continue;
      const target = resolveExplorerDeleteTarget(row);
      if (!target) continue;
      const key = `${target.kind}:${target.id}`;
      if (seenTargets.has(key)) continue;
      seenTargets.add(key);
      targets.push({ ...target, label: row.label, treeID: row.id });
    }
    return targets;
  }, [companyExplorerV2Rows, folders]);

  const requestDeleteTargets = useCallback((targets: ExplorerDeleteTargetWithLabel[], position?: ConfirmActionMenuPosition) => {
    if (targets.length === 0) return;
    const protectedFolder = findProtectedSystemFolderInDeleteTargets(targets, folders);
    if (protectedFolder) {
      setExplorerContextMenu(null);
      setDeleteBlockedMessage(`We can't delete this folder because it contains the special folder: ${protectedFolder.name}`);
      return;
    }
    setDeleteFolderAcknowledged(false);
    setDeleteConfirmation({ targets, position: position ?? null });
  }, [folders]);

  const requestDeleteSelection = useCallback(() => {
    if (deleteConfirmation) return;
    const selectedRows = treeRows.filter((row) => selectedTreeIDs.has(row.id));
    const targets = getDeleteTargetsForRows(selectedRows.length > 0 ? selectedRows : (selectedTree ? [selectedTree] : []));
    requestDeleteTargets(targets);
  }, [deleteConfirmation, getDeleteTargetsForRows, requestDeleteTargets, selectedTree, selectedTreeIDs, treeRows]);

  const commitRename = useCallback(async (draft?: ExplorerRenameDraft) => {
    const activeRename = draft ?? renaming;
    if (!activeRename || renameCommitInFlightRef.current) return;
    const value = activeRename.value.trim();
    if (!value) {
      setRenaming(null);
      return;
    }
    renameCommitInFlightRef.current = true;
    setError("");
    try {
      if (activeRename.target.kind === "folder") {
        const isV2Folder = companyExplorerV2Rows.some((row) => row.entity_id === activeRename.target.id && row.entity_type === "folder");
        if (isV2Folder) {
          const row = await requestJSON<CompanyExplorerV2Row>(`/v1/company-explorer/folders/${activeRename.target.id}`, {
            method: "PUT",
            body: JSON.stringify({ company_id: companyID, name: value }),
          });
          dispatchExplorerStore({ type: "upsertV2Rows", rows: [row] });
          setRenaming((current) => (current?.treeID === activeRename.treeID ? null : current));
          return;
        }
        const folder = await requestJSON<CompanyExplorerFolder>(`/v1/company-explorer/folders/${activeRename.target.id}`, {
          method: "PUT",
          body: JSON.stringify({ company_id: companyID, name: value }),
        });
        dispatchExplorerStore({ type: "replaceFolder", folder });
        upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, folder);
        upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, folder);
      } else if (activeRename.target.kind === "node") {
        const node = await requestJSON<NodeRecord>(`/v1/nodes/${activeRename.target.id}`, {
          method: "PUT",
          body: JSON.stringify({ company_id: companyID, name: value }),
        });
        dispatchExplorerStore({ type: "replaceNode", node });
        upsertNodeRelationshipGraphNode(apiBase, companyID, node);
      } else if (activeRename.target.kind === "logic_gate") {
        const updated = await requestJSON<LogicGateApiRecord>(`/v1/logic-gates/${activeRename.target.id}`, {
          method: "PUT",
          body: JSON.stringify({ company_id: companyID, header: value }),
        });
        const logicGate = toLogicGateCanvasRecord(updated);
        dispatchExplorerStore({ type: "replaceLogicGate", logicGate });
        upsertLogicGateRelationshipGraphNode(apiBase, companyID, logicGate);
      }
      setRenaming((current) => (current?.treeID === activeRename.treeID ? null : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : `failed_to_rename_${activeRename.target.kind}`);
    } finally {
      renameCommitInFlightRef.current = false;
    }
  }, [apiBase, companyExplorerV2Rows, companyID, renaming, requestJSON]);

  const moveFolder = useCallback(async (folderID: string, parentFolderID: string | undefined, options: { position?: number; expandTarget?: boolean; parentProvided?: boolean; targetExpanded?: boolean } = {}) => {
    if (!folderID || folderID === parentFolderID) return;
    setError("");
    try {
      const v2Row = companyExplorerV2Rows.find((row) => row.entity_id === folderID && row.entity_type === "folder");
      if (v2Row) {
        const parentEntityID = parentFolderID || companyExplorerV2RootEntityID;
        if (!parentEntityID) throw new Error("company_explorer_v2_parent_missing");
        const row = await requestJSON<CompanyExplorerV2Row>(`/v1/company-explorer/folders/${folderID}`, {
          method: "PUT",
          body: JSON.stringify({
            company_id: companyID,
            parent_folder_id: parentEntityID === companyExplorerV2RootEntityID ? "" : parentEntityID,
            position: options.position,
          }),
        });
        dispatchExplorerStore({ type: "upsertV2Rows", rows: [row] });
        if (typeof options.targetExpanded === "boolean") {
          setExpanded((previous) => {
            const next = new Set(previous);
            const targetTreeID = companyExplorerV2TreeIDForEntityID(parentEntityID);
            if (options.targetExpanded) next.add(targetTreeID);
            else next.delete(targetTreeID);
            return next;
          });
        } else if (options.expandTarget) {
          setExpanded((previous) => {
            const next = new Set(previous);
            next.add(companyExplorerV2TreeIDForEntityID(parentEntityID));
            return next;
          });
        }
        return;
      }
      const body: { company_id: string; parent_folder_id?: string; position?: number } = { company_id: companyID };
      if (options.parentProvided !== false) body.parent_folder_id = parentFolderID ?? "";
      if (options.position && options.position > 0) body.position = options.position;
      const folder = await requestJSON<CompanyExplorerFolder>(`/v1/company-explorer/folders/${folderID}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      dispatchExplorerStore({ type: "replaceFolder", folder });
      if (typeof options.targetExpanded === "boolean") {
        setExpanded((previous) => {
          const next = new Set(previous);
          const targetTreeID = parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-root";
          if (options.targetExpanded) next.add(targetTreeID);
          else next.delete(targetTreeID);
          return next;
        });
      } else if (options.expandTarget) {
        setExpanded((previous) => {
          const next = new Set(previous);
          next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-root");
          return next;
        });
      }
      upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, folder);
      upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_move_folder");
    }
  }, [apiBase, companyExplorerV2RootEntityID, companyExplorerV2Rows, companyExplorerV2TreeIDForEntityID, companyID, requestJSON]);

  const focusTreeRow = useCallback((row: ExplorerTreeNode, options: { localIntent?: boolean; selectionIntent?: SelectionIntent } = {}) => {
    if (options.localIntent !== false) {
      lastLocalExplorerSelectionRef.current = { domain: getExplorerSelectionDomain(row), changedAt: Date.now() };
    }
    pendingExplorerSelectionIntentRef.current = options.selectionIntent ?? "activate";
    selectedTreeIDRef.current = row.id;
    setSelectedTreeID(row.id);
    if (row.kind === "node") {
      setSelectedNodeID(row.nodeID ?? "");
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
      return;
    }
    if (row.kind === "logic_gate") {
      setSelectedLogicGateID(row.logicGateID ?? "");
      setSelectedNodeID("");
      setSelectedKanbanBoardID("");
      return;
    }
    if (row.kind === "kanban") {
      setSelectedKanbanBoardID(row.kanbanBoardID ?? "");
      setSelectedNodeID("");
      setSelectedLogicGateID("");
      return;
    }
    setSelectedNodeID("");
    setSelectedLogicGateID("");
    setSelectedKanbanBoardID("");
  }, []);

  const selectSingleTreeRow = useCallback((row: ExplorerTreeNode) => {
    treeKeyboardActiveRef.current = true;
    treeViewportRef.current?.focus({ preventScroll: true });
    setSelectedTreeID(row.id);
    setSelectedTreeIDs(new Set([row.id]));
    setSelectionAnchorTreeID(row.id);
    focusTreeRow(row, { selectionIntent: "navigate" });
  }, [focusTreeRow]);

  const emitExplorerEntityActivation = useCallback((row: ExplorerTreeNode, options: { suppressNodeNavigation?: boolean } = {}) => {
    const kind = row.kind === "node" || row.kind === "logic_gate" || row.kind === "project" ? row.kind : "";
    const id = kind === "node" ? (row.nodeID ?? "") : kind === "logic_gate" ? (row.logicGateID ?? "") : kind === "project" ? (row.projectID ?? "") : "";
    const cleanID = id.trim();
    if (!kind || !cleanID) return;
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
      companyID,
      sourceFrameID: scope,
      kind,
      id: cleanID,
      label: row.label,
      selectedTreeID: row.id,
      suppressNavigation: kind === "node" ? options.suppressNodeNavigation ?? true : false,
      changedAt: Date.now(),
    });
  }, [companyID, scope]);

  const selectTreeRow = useCallback((row: ExplorerTreeNode, event?: React.MouseEvent, options: { selectionIntent?: SelectionIntent } = {}) => {
    const orderedIDs = treeRows.map((item) => item.id);
    treeKeyboardActiveRef.current = true;
    treeViewportRef.current?.focus({ preventScroll: true });
    const selected = resolveExplorerClickSelection({
      orderedIDs,
      previousSelectedIDs: selectedTreeIDs,
      anchorID: selectionAnchorTreeID,
      clickedID: row.id,
      shiftKey: !!event?.shiftKey,
      ctrlKey: !!event?.ctrlKey || !!event?.metaKey,
    });
    if (selected.selectedIDs.size === 0) selected.selectedIDs.add(row.id);
    const orderedSelectedIDs = orderedIDs.filter((id) => selected.selectedIDs.has(id));
    const primaryID = selected.selectedIDs.has(row.id) ? row.id : (orderedSelectedIDs[0] ?? row.id);
    const primaryRow = rowByID.get(primaryID) ?? row;
    const selectionIntent = options.selectionIntent ?? "activate";
    setSelectedTreeIDs(new Set(orderedSelectedIDs));
    setSelectionAnchorTreeID(selected.anchorID);
    focusTreeRow(primaryRow, { selectionIntent });
    if (selectionIntent === "activate" && !event?.shiftKey && !event?.ctrlKey && !event?.metaKey) {
      emitExplorerEntityActivation(primaryRow);
    }
  }, [emitExplorerEntityActivation, focusTreeRow, rowByID, selectedTreeIDs, selectionAnchorTreeID, treeRows]);

  const expandTreeIDs = useCallback((treeIDs: string[]) => {
    const folderByID = new Map(folders.map((folder) => [folder.folder_id, folder]));
    const addFolderPath = (next: Set<string>, folderID: string) => {
      let currentID = folderID;
      const seen = new Set<string>();
      while (currentID && !seen.has(currentID)) {
        seen.add(currentID);
        next.add(`workspace-folder-${currentID}`);
        currentID = folderByID.get(currentID)?.parent_folder_id ?? "";
      }
    };
    setExpanded((previous) => {
      const next = new Set(previous);
      next.add("folder-root");
      for (const treeID of treeIDs) {
        const systemFolderKey = getSystemFolderKeyForTreeRowID(treeID);
        if (systemFolderKey) {
          const systemFolderTreeID = systemFolderTreeIDByKey.get(systemFolderKey);
          if (systemFolderTreeID) next.add(systemFolderTreeID);
          continue;
        }
        if (treeID.startsWith("workspace-folder-")) {
          addFolderPath(next, treeID.slice("workspace-folder-".length));
          continue;
        }
        const itemType = treeID.startsWith("node-") ? "node"
          : treeID.startsWith("logic-gate-") ? "logic_gate"
            : treeID.startsWith("kanban-") ? "kanban"
              : "";
        const itemID = itemType === "node" ? treeID.slice("node-".length)
          : itemType === "logic_gate" ? treeID.slice("logic-gate-".length)
            : itemType === "kanban" ? treeID.slice("kanban-".length)
              : "";
        if (!itemType || !itemID) continue;
        const placement = folderItems.find((item) => item.item_type === itemType && item.item_id === itemID);
        if (placement) addFolderPath(next, placement.folder_id);
      }
      return next;
    });
  }, [folderItems, folders, systemFolderTreeIDByKey]);

  const startRenamingRow = useCallback((row: ExplorerTreeNode) => {
    if (isProtectedGVICRoleRow(row)) return;
    const target = resolveExplorerRenameTarget(row);
    if (!target) return;
    setSelectedTreeID(row.id);
    setSelectedTreeIDs(new Set([row.id]));
    setSelectionAnchorTreeID(row.id);
    focusTreeRow(row, { selectionIntent: "navigate" });
    cancelRenameOnBlurRef.current = false;
    setRenaming({ treeID: row.id, target, value: row.label });
  }, [focusTreeRow]);

  const scrollTreeRowIntoView = useCallback((rowID: string, options: { align?: "nearest" | "center" } = {}) => {
    const index = treeRows.findIndex((row) => row.id === rowID);
    const viewport = treeViewportRef.current;
    if (index < 0 || !viewport) return;
    const scrollContainer = useParentScroll ? findParentScrollContainer(viewport) : viewport;
    const rowsStart = viewport.querySelector<HTMLElement>('[data-company-explorer-tree-rows-start="true"]');
    const rowsTopOffset = useParentScroll
      ? getRowsTopOffsetInScrollContainer(viewport, scrollContainer)
      : (rowsStart?.offsetTop ?? 0);
    const currentTop = scrollContainer.scrollTop;
    const viewportHeight = scrollContainer.clientHeight || treeViewportHeight;
    const nextScrollTop = getExplorerScrollTopForRow({
      rowIndex: index,
      rowHeight: COMPANY_EXPLORER_TREE_ROW_HEIGHT,
      rowsTopOffset,
      currentScrollTop: currentTop,
      viewportHeight,
      maxScrollTop: Math.max(0, scrollContainer.scrollHeight - viewportHeight),
      bottomPadding: COMPANY_EXPLORER_TREE_ROW_HEIGHT * 2,
      align: options.align,
    });
    if (nextScrollTop === currentTop) return;
    scrollContainer.scrollTop = nextScrollTop;
    setTreeScrollTop(useParentScroll ? Math.max(0, nextScrollTop - rowsTopOffset) : nextScrollTop);
  }, [treeRows, treeViewportHeight, useParentScroll]);

  const applyExplorerFindSelection = useCallback((entities: ExplorerFindEntity[]) => {
    const plan = buildExplorerFindSelection({
      entities,
      folders,
      folderItems,
      nodeIDs: nodes.map((node) => node.node_id),
      logicGateIDs: logicGates.map((logicGate) => logicGate.logic_gate_id),
      projectIDs: projects.map((project) => project.project_id),
      currentExpandedIDs: expandedRef.current,
    });
    if (!plan.primaryTreeID || !plan.primaryEntity) return;

    suppressNextExplorerBroadcastRef.current = true;
    treeKeyboardActiveRef.current = true;
    treeViewportRef.current?.focus({ preventScroll: true });
    expandedRef.current = plan.expandedTreeIDs;
    setExpanded(plan.expandedTreeIDs);
    setSelectedTreeID(plan.primaryTreeID);
    setSelectedTreeIDs(new Set(plan.selectedTreeIDs));
    setSelectionAnchorTreeID(plan.primaryTreeID);
    if (plan.primaryEntity.kind === "node") {
      setSelectedNodeID(plan.primaryEntity.id);
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
    } else if (plan.primaryEntity.kind === "logic_gate") {
      setSelectedLogicGateID(plan.primaryEntity.id);
      setSelectedNodeID("");
      setSelectedKanbanBoardID("");
    } else {
      setSelectedNodeID("");
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
    }
    pendingScrollAlignRef.current = "center";
    pendingScrollTreeIDRef.current = plan.primaryTreeID;
  }, [folderItems, folders, logicGates, nodes, projects]);

  const selectExplorerSearchResult = useCallback((row: ExplorerTreeNode) => {
    treeKeyboardActiveRef.current = true;
    treeViewportRef.current?.focus({ preventScroll: true });
    expandTreeIDs([row.id]);
    setSelectedTreeID(row.id);
    setSelectedTreeIDs(new Set([row.id]));
    setSelectionAnchorTreeID(row.id);
    focusTreeRow(row, { selectionIntent: "activate" });
    emitExplorerEntityActivation(row, { suppressNodeNavigation: false });
    onSearchResultSelect?.();
    pendingScrollAlignRef.current = "center";
    pendingScrollTreeIDRef.current = row.id;
  }, [emitExplorerEntityActivation, expandTreeIDs, focusTreeRow, onSearchResultSelect]);

  useEffect(() => {
    const request = externalSearchSelectionRequest;
    if (!request?.treeID || request.requestID === lastExternalSearchSelectionRequestRef.current) return;
    lastExternalSearchSelectionRequestRef.current = request.requestID;
    const row = allExpandedSearchTreeRows.find((candidate) => candidate.id === request.treeID);
    if (row) selectExplorerSearchResult(row);
  }, [allExpandedSearchTreeRows, externalSearchSelectionRequest, selectExplorerSearchResult]);

  useEffect(() => {
    const rowID = pendingScrollTreeIDRef.current;
    if (!rowID || !treeRows.some((row) => row.id === rowID)) return;
    const align = pendingScrollAlignRef.current;
    pendingScrollTreeIDRef.current = "";
    pendingScrollAlignRef.current = "nearest";
    window.requestAnimationFrame(() => scrollTreeRowIntoView(rowID, { align }));
  }, [scrollTreeRowIntoView, treeRows]);

  const handleTreeKeyDown = useCompanyExplorerKeyboard({
    treeViewportRef,
    treeKeyboardActiveRef,
    selectedTreeIDRef,
    expandedRef,
    treeRowsRef,
    setExpanded: setExpandedAndLoadChildren,
    selectSingleTreeRow,
    scrollTreeRowIntoView,
    onRequestDeleteSelection: requestDeleteSelection,
  });

  const getExplorerItemRowsForPayload = useCallback((payload: ExplorerDragPayload | null): ExplorerTreeNode[] => {
    const payloadItems = getExplorerDropPayloadItems(payload);
    if (payloadItems.length === 0) return [];
    const sourceTreeIDs = new Set<string>();
    if (payload?.sourceTreeID) sourceTreeIDs.add(payload.sourceTreeID);
    for (const item of payloadItems) {
      if (item.treeID) sourceTreeIDs.add(item.treeID);
    }
    if (sourceTreeIDs.size > 0) {
      return baseTreeRows.filter((row) => sourceTreeIDs.has(row.id));
    }
    const keys = new Set(payloadItems.map((item) => `${item.itemType}:${item.itemID}`));
    const seen = new Set<string>();
    const rows: ExplorerTreeNode[] = [];
    for (const row of baseTreeRows) {
      const item = getExplorerItemPayload(row);
      if (!item) continue;
      const key = `${item.itemType}:${item.itemID}`;
      if (!keys.has(key) || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    return rows;
  }, [baseTreeRows]);

  const getLogicGateRowForContainerID = useCallback((containerID: string): ExplorerTreeNode | undefined => {
    const cleanContainerID = containerID.trim();
    if (!cleanContainerID) return undefined;
    return baseTreeRows.find((row) => (
      row.kind === "logic_gate"
      && (
        row.logicGateID === cleanContainerID
        || row.entityID === cleanContainerID
        || row.resourceID === cleanContainerID
      )
    ));
  }, [baseTreeRows]);

  const moveExplorerNodesToLogicGate = useCallback(async (
    moves: Array<{ nodeID: string; position?: number; sourceRow?: ExplorerTreeNode }>,
    logicGateID: string,
    logicGateTreeID?: string,
  ): Promise<boolean> => {
    const targetLogicGateID = logicGateID.trim();
    if (!targetLogicGateID) return false;
    const normalizedMoves: Array<{ nodeID: string; position?: number; sourceRow?: ExplorerTreeNode }> = [];
    const seenNodeIDs = new Set<string>();
    for (const move of moves) {
      const nodeID = move.nodeID.trim();
      if (!nodeID || seenNodeIDs.has(nodeID)) continue;
      seenNodeIDs.add(nodeID);
      normalizedMoves.push({ ...move, nodeID });
    }
    if (normalizedMoves.length === 0) return false;

    setError("");
    const sourceLogicGateIDs = new Set<string>();
    try {
      for (const move of normalizedMoves) {
        const sourceParentEntityID = move.sourceRow?.parentEntityID?.trim() ?? "";
        const fromLogicGateID = move.sourceRow?.parentLogicGateID?.trim()
          || getLogicGateRowForContainerID(sourceParentEntityID)?.logicGateID?.trim()
          || "";
        if (fromLogicGateID) sourceLogicGateIDs.add(fromLogicGateID);
        const result = await moveLogicGateAssignment({
          apiBase,
          companyID,
          logicGateID: targetLogicGateID,
          nodeID: move.nodeID,
          fromLogicGateID: fromLogicGateID || undefined,
          mutationOrigin: "matrix",
          position: move.position,
        });
        dispatchExplorerStore({ type: "replaceNode", node: result.node });
        upsertNodeRelationshipGraphNode(apiBase, companyID, result.node);
      }
      const expandedTreeID = logicGateTreeID || getLogicGateRowForContainerID(targetLogicGateID)?.id || "";
      if (expandedTreeID) setExpanded((previous) => new Set(previous).add(expandedTreeID));
      if (companyExplorerV2Active) {
        const branchIDs = new Set(sourceLogicGateIDs);
        branchIDs.add(targetLogicGateID);
        for (const branchID of branchIDs) {
          activeCompanyExplorerBranchesRef.current.add(companyExplorerBranchKey(branchID));
          await refreshCompanyExplorerBranch(branchID);
        }
      }
      requestGVICExplorerProjectionRefreshRef.current();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_move_node_to_logic_gate");
      return false;
    }
  }, [apiBase, companyExplorerBranchKey, companyExplorerV2Active, companyID, getLogicGateRowForContainerID, refreshCompanyExplorerBranch]);

  const canPlaceExplorerItemsAtTarget = useCallback((payload: ExplorerDragPayload | null, target: ExplorerTreeNode): boolean => {
    if (isProtectedGVICRoleRow(target)) return false;
    const itemTypes = getExplorerDropPayloadItemTypes(payload);
    if (itemTypes.size === 0 || itemTypes.has("kanban")) return false;
    if (scopedAllowedItemType && (itemTypes.size !== 1 || !itemTypes.has(scopedAllowedItemType))) return false;
    const targetKind = getExplorerRowOrderKind(target);
    if (isGVICScopedRow(target) && (itemTypes.size !== 1 || !itemTypes.has(targetKind as CompanyExplorerItemType))) return false;
    if (!targetKind) return false;
    const itemRows = getExplorerItemRowsForPayload(payload);
    if (itemRows.length === 0 || itemRows.some((row) => row.id === target.id)) return false;
    const targetContainer = getExplorerRowContainerID(target);
    if (targetContainer == null) return false;
    if (getLogicGateRowForContainerID(targetContainer)) return itemTypes.size === 1 && itemTypes.has("node");
    return targetContainer !== "" || itemRows.every((row) => getExplorerRowContainerID(row) === "");
  }, [getExplorerItemRowsForPayload, getLogicGateRowForContainerID, scopedAllowedItemType]);

  const canDropExplorerPayloadOnRow = useCallback((payload: ExplorerDragPayload | null, target: ExplorerTreeNode): boolean => {
    const itemType = getExplorerDropPayloadItemType(payload);
    if (!itemType || itemType === "kanban") return false;
    if (isProtectedGVICRoleRow(target)) return false;
    if (target.kind === "logic_gate" && target.logicGateID && itemType === "node") {
      return getExplorerDropPayloadItems(payload).some((item) => item.itemType === "node" && item.itemID.trim());
    }
    return false;
  }, []);

  const dropExplorerPayloadOnRow = useCallback(async (payload: ExplorerDragPayload | null, target: ExplorerTreeNode): Promise<boolean> => {
    const itemType = getExplorerDropPayloadItemType(payload);
    if (!itemType || itemType === "kanban") return false;

    if (target.kind === "logic_gate" && target.logicGateID && itemType === "node") {
      const nodeRowsByID = new Map(getExplorerItemRowsForPayload(payload).filter((row) => row.kind === "node" && row.nodeID).map((row) => [row.nodeID ?? "", row]));
      const nodeItems = getExplorerDropPayloadItems(payload).filter((item) => item.itemType === "node" && item.itemID.trim());
      if (nodeItems.length === 0) return false;
      return moveExplorerNodesToLogicGate(
        nodeItems.map((item) => {
          const nodeID = item.itemID.trim();
          return { nodeID, sourceRow: nodeRowsByID.get(nodeID) };
        }),
        target.logicGateID,
        target.id,
      );
    }

    return false;
  }, [getExplorerItemRowsForPayload, moveExplorerNodesToLogicGate]);

  const isFolderDescendantOf = useCallback((candidateFolderID: string, ancestorFolderID: string): boolean => {
    if (!candidateFolderID || !ancestorFolderID) return false;
    let currentFolderID = candidateFolderID;
    const seen = new Set<string>();
    while (currentFolderID && !seen.has(currentFolderID)) {
      if (currentFolderID === ancestorFolderID) return true;
      seen.add(currentFolderID);
      const folder = folders.find((item) => item.folder_id === currentFolderID);
      currentFolderID = folder?.parent_folder_id ?? "";
    }
    return false;
  }, [folders]);

  const canPlaceExplorerFolderAtTarget = useCallback((source: ExplorerTreeNode | undefined, target: ExplorerTreeNode): boolean => {
    if (isProtectedGVICRoleRow(target)) return false;
    if (!source || source.kind !== "folder" || !source.folderID || !source.folderKind || source.id === target.id) return false;
    const targetKind = getExplorerRowOrderKind(target);
    if (!targetKind) return false;
    if (isGVICScopedRow(target) && source.folderKind !== targetKind) return false;
    const targetContainer = getExplorerRowContainerID(target);
    if (targetContainer == null) return false;
    if (getLogicGateRowForContainerID(targetContainer)) return false;
    if (targetContainer === source.folderID || isFolderDescendantOf(targetContainer, source.folderID)) return false;
    return true;
  }, [getLogicGateRowForContainerID, isFolderDescendantOf]);

  const getReorderRowsForTarget = useCallback((source: ExplorerTreeNode, target: ExplorerTreeNode): ExplorerTreeNode[] => {
    if (isProtectedGVICRoleRow(source) || isProtectedGVICRoleRow(target)) return [];
    const sourceContainer = getExplorerRowContainerID(source);
    const targetContainer = getExplorerRowContainerID(target);
    const sourceKind = getExplorerRowOrderKind(source);
    const targetKind = getExplorerRowOrderKind(target);
    if (sourceContainer == null || targetContainer == null || sourceContainer !== targetContainer || !sourceKind || !targetKind) return [];
    if (sourceContainer === "" && targetContainer === "") {
      return baseTreeRows.filter((row) => getExplorerRowContainerID(row) === "" && Boolean(getExplorerRowOrderKind(row)));
    }
    return baseTreeRows.filter((row) => getExplorerRowContainerID(row) === sourceContainer && Boolean(getExplorerRowOrderKind(row)));
  }, [baseTreeRows]);

  const reorderExplorerRows = useCallback(async (source: ExplorerTreeNode, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => {
    const siblings = getReorderRowsForTarget(source, target);
    if (siblings.length < 2) return false;
    const plan = buildExplorerRowReorderPlan(siblings.map(explorerRowOrder), source.id, target.id, placement);
    if (plan.updates.length === 0) return false;
    const rowByID = new Map(siblings.map((row) => [row.id, row]));
    const updates: ExplorerRowOrderUpdate[] = [];
    for (const update of plan.updates) {
      const row = rowByID.get(update.rowID);
      if (row) updates.push({ row, position: update.position });
    }
    if (updates.length === 0) return false;

    const localRootUpdates = updates.filter(({ row }) => getExplorerRowContainerID(row) === "");
    if (localRootUpdates.length > 0) {
      setRootRowOrder((previous) => {
        const next = { ...previous };
        for (const { row, position } of localRootUpdates) next[row.id] = position;
        return next;
      });
    }

    const reorderContainer = getExplorerRowContainerID(source);
    const logicGateContainer = reorderContainer ? getLogicGateRowForContainerID(reorderContainer) : undefined;
    if (logicGateContainer?.logicGateID) {
      const nodeMoves = updates
        .filter(({ row }) => row.kind === "node" && Boolean(row.nodeID))
        .map(({ row, position }) => ({ nodeID: row.nodeID ?? "", position, sourceRow: row }));
      return moveExplorerNodesToLogicGate(nodeMoves, logicGateContainer.logicGateID, logicGateContainer.id);
    }

    const itemAssignments: CompanyExplorerFolderItemAssignment[] = [];
    const folderMoves: Array<Promise<void>> = [];
    for (const { row, position } of updates) {
      if (row.kind === "folder" && row.folderID) {
        folderMoves.push(moveFolder(row.folderID, row.parentFolderID ?? "", { position, parentProvided: false }));
        continue;
      }
      const itemType: CompanyExplorerItemType | null = row.kind === "node" ? "node" : row.kind === "logic_gate" ? "logic_gate" : row.kind === "project" ? "project" : null;
      const itemID = row.kind === "node" ? row.nodeID : row.kind === "logic_gate" ? row.logicGateID : row.kind === "project" ? row.projectID : "";
      if (row.folderID && itemType && itemID) itemAssignments.push({ folder_id: row.folderID, item_type: itemType, item_id: itemID, position });
    }
    await Promise.all(folderMoves);
    if (itemAssignments.length > 0) await assignItemsToFolders(itemAssignments);
    return true;
  }, [assignItemsToFolders, getLogicGateRowForContainerID, getReorderRowsForTarget, moveExplorerNodesToLogicGate, moveFolder]);

  const placeExplorerFolderAtTarget = useCallback(async (source: ExplorerTreeNode, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => {
    if (!source.folderID || !source.folderKind || !canPlaceExplorerFolderAtTarget(source, target)) return false;
    const targetContainer = getExplorerRowContainerID(target);
    if (targetContainer == null) return false;

    const targetRows = baseTreeRows.filter((row) => getExplorerRowContainerID(row) === targetContainer && Boolean(getExplorerRowOrderKind(row)));
    const targetRowIDs = new Set(targetRows.map((row) => row.id));
    const rowsForPlan = targetRowIDs.has(source.id) ? targetRows : [...targetRows, source];
    const plan = buildExplorerRowBatchReorderPlan(rowsForPlan.map(explorerRowOrder), [source.id], target.id, placement);
    if (plan.updates.length === 0) return false;

    const rowByPlanID = new Map(rowsForPlan.map((row) => [row.id, row]));
    const updates: ExplorerRowOrderUpdate[] = [];
    for (const update of plan.updates) {
      const row = rowByPlanID.get(update.rowID);
      if (row) updates.push({ row, position: update.position });
    }
    if (updates.length === 0) return false;

    if (targetContainer === "") {
      setRootRowOrder((previous) => {
        const next = { ...previous };
        for (const { row, position } of updates) next[row.id] = position;
        return next;
      });
    }

    const itemAssignments: CompanyExplorerFolderItemAssignment[] = [];
    const folderMoves: Array<Promise<void>> = [];
    for (const { row, position } of updates) {
      if (row.kind === "folder" && row.folderID) {
        const parentFolderID = row.id === source.id ? targetContainer : (row.parentFolderID ?? "");
        folderMoves.push(moveFolder(row.folderID, parentFolderID, { position, parentProvided: row.id === source.id }));
        continue;
      }
      const rowItemType: CompanyExplorerFolderKind | null = row.kind === "node" ? "node" : row.kind === "logic_gate" ? "logic_gate" : row.kind === "project" ? "project" : null;
      const itemID = row.kind === "node" ? row.nodeID : row.kind === "logic_gate" ? row.logicGateID : row.kind === "project" ? row.projectID : "";
      if (targetContainer && rowItemType && itemID) itemAssignments.push({ folder_id: targetContainer, item_type: rowItemType, item_id: itemID, position });
    }
    await Promise.all(folderMoves);
    if (itemAssignments.length > 0) await assignItemsToFolders(itemAssignments);
    return true;
  }, [assignItemsToFolders, baseTreeRows, canPlaceExplorerFolderAtTarget, moveFolder]);

  const placeExplorerItemsAtTarget = useCallback(async (payload: ExplorerDragPayload | null, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => {
    const items = getExplorerDropPayloadItems(payload);
    if (items.length === 0 || items.some((item) => item.itemType === "kanban")) return false;
    const targetContainer = getExplorerRowContainerID(target);
    if (targetContainer == null || !canPlaceExplorerItemsAtTarget(payload, target)) return false;

    const itemRows = getExplorerItemRowsForPayload(payload);
    const targetRows = baseTreeRows.filter((row) => {
      if (getExplorerRowContainerID(row) !== targetContainer) return false;
      const rowKind = getExplorerRowOrderKind(row);
      return Boolean(rowKind);
    });
    const targetRowIDs = new Set(targetRows.map((row) => row.id));
    const rowsForPlan = [
      ...targetRows,
      ...itemRows.filter((row) => !targetRowIDs.has(row.id)),
    ];
    const plan = buildExplorerRowBatchReorderPlan(rowsForPlan.map(explorerRowOrder), itemRows.map((row) => row.id), target.id, placement);
    if (plan.updates.length === 0) return false;

    const rowByPlanID = new Map(rowsForPlan.map((row) => [row.id, row]));
    const updates: ExplorerRowOrderUpdate[] = [];
    for (const update of plan.updates) {
      const row = rowByPlanID.get(update.rowID);
      if (row) updates.push({ row, position: update.position });
    }
    if (updates.length === 0) return false;

    if (targetContainer === "") {
      setRootRowOrder((previous) => {
        const next = { ...previous };
        for (const { row, position } of updates) next[row.id] = position;
        return next;
      });
    }

    const logicGateContainer = getLogicGateRowForContainerID(targetContainer);
    if (logicGateContainer?.logicGateID) {
      const nodeMoves = updates
        .filter(({ row }) => row.kind === "node" && Boolean(row.nodeID))
        .map(({ row, position }) => ({ nodeID: row.nodeID ?? "", position, sourceRow: row }));
      return moveExplorerNodesToLogicGate(nodeMoves, logicGateContainer.logicGateID, logicGateContainer.id);
    }

    const itemAssignments: CompanyExplorerFolderItemAssignment[] = [];
    const folderMoves: Array<Promise<void>> = [];
    for (const { row, position } of updates) {
      if (row.kind === "folder" && row.folderID) {
        folderMoves.push(moveFolder(row.folderID, row.parentFolderID ?? "", { position, parentProvided: false }));
        continue;
      }
      const rowItemType: CompanyExplorerItemType | null = row.kind === "node" ? "node" : row.kind === "logic_gate" ? "logic_gate" : row.kind === "project" ? "project" : null;
      const itemID = row.kind === "node" ? row.nodeID : row.kind === "logic_gate" ? row.logicGateID : row.kind === "project" ? row.projectID : "";
      if (targetContainer && rowItemType && itemID) itemAssignments.push({ folder_id: targetContainer, item_type: rowItemType, item_id: itemID, position });
    }
    await Promise.all(folderMoves);
    if (itemAssignments.length > 0) await assignItemsToFolders(itemAssignments);
    return true;
  }, [assignItemsToFolders, baseTreeRows, canPlaceExplorerItemsAtTarget, getExplorerItemRowsForPayload, getLogicGateRowForContainerID, moveExplorerNodesToLogicGate, moveFolder]);

  const assignExplorerPayloadItemsToFolder = useCallback(async (targetFolderID: string, payload: ExplorerDragPayload) => {
    const items = getExplorerDropPayloadItems(payload).filter((item) => item.itemID.trim() && item.itemType !== "kanban");
    if (scopedAllowedItemType && items.some((item) => item.itemType !== scopedAllowedItemType)) return;
    if (!targetFolderID || items.length === 0) return;
    const existingRows = baseTreeRows.filter((row) => {
      if (getExplorerRowContainerID(row) !== targetFolderID) return false;
      const rowKind = getExplorerRowOrderKind(row);
      return Boolean(rowKind);
    });
    let position = existingRows.reduce((max, row) => Math.max(max, row.position || 0), 0);
    const assignments: CompanyExplorerFolderItemAssignment[] = [];
    for (const item of items) {
      position += TREE_ROW_POSITION_STEP;
      assignments.push({ folder_id: targetFolderID, item_type: item.itemType, item_id: item.itemID, position });
    }
    await assignItemsToFolders(assignments, { expandTarget: true });
  }, [assignItemsToFolders, baseTreeRows, scopedAllowedItemType]);

  const getContextCreatePosition = useCallback((row: ExplorerTreeNode | null | undefined, event: React.MouseEvent): number => {
    if (!row) return 0;
    if (row.kind === "folder") return 0;
    const targetContainer = getExplorerRowContainerID(row);
    if (targetContainer == null) return 0;
    const siblingRows = baseTreeRows.filter((candidate) => {
      if (getExplorerRowContainerID(candidate) !== targetContainer) return false;
      const rowKind = getExplorerRowOrderKind(candidate);
      return Boolean(rowKind);
    });
    const targetIndex = siblingRows.findIndex((candidate) => candidate.id === row.id);
    if (targetIndex < 0) return 0;
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect?.();
    const placement: ExplorerRowDropPlacement = bounds && event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
    const previousRow = placement === "before" ? siblingRows[targetIndex - 1] : siblingRows[targetIndex];
    const nextRow = placement === "before" ? siblingRows[targetIndex] : siblingRows[targetIndex + 1];
    if (previousRow && nextRow && nextRow.position - previousRow.position > 1) return Math.floor((previousRow.position + nextRow.position) / 2);
    if (previousRow) return previousRow.position + TREE_ROW_POSITION_STEP;
    if (nextRow) return Math.max(1, nextRow.position - TREE_ROW_POSITION_STEP);
    return 0;
  }, [baseTreeRows]);

  const openExplorerContextMenu = useCallback((event: React.MouseEvent, row?: ExplorerTreeNode | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (row) {
      if (selectedTreeIDs.has(row.id)) focusTreeRow(row, { selectionIntent: "navigate" });
      else selectTreeRow(row, undefined, { selectionIntent: "navigate" });
    }
    const creationRow = row ?? (GVICExplorerActive || teamCompanyExplorerActive ? null : scopedRootRow);
    const protectedGVICRow = isProtectedGVICRoleRow(row);
    const syntheticScopeHeader = row?.syntheticKind === "default_scope_folder" && !row.folderID;
    const creationTargetRow = syntheticScopeHeader ? null : creationRow;
    const canCreateForContext = !protectedGVICRow || Boolean(row?.folderID);
    const contextKind: CompanyExplorerFolderKind | null = creationTargetRow?.folderKind ?? (creationTargetRow?.kind === "node" ? "node" : creationTargetRow?.kind === "logic_gate" ? "logic_gate" : creationTargetRow?.kind === "project" ? "project" : null);
    const createNodeLogicGateID = creationTargetRow?.kind === "logic_gate"
      ? (creationTargetRow.logicGateID ?? "")
      : (creationTargetRow?.parentLogicGateID ?? "");
    const createNodeLogicGateTreeID = creationTargetRow?.kind === "logic_gate" && createNodeLogicGateID ? (creationTargetRow.id ?? "") : "";
    const createLogicGateGVICRole = isLogicGateGVICRole(creationTargetRow?.GVICRole) ? creationTargetRow.GVICRole : "";
    const targets = resolveExplorerCreationTargets(creationTargetRow ?? null);
    const createFolderScope = resolveCreateFolderScope(targets.preferredFolderParentID, targets.folderScopeType, targets.folderScopeID);
    const deleteRows = row ? (selectedTreeIDs.has(row.id) ? treeRows.filter((candidate) => selectedTreeIDs.has(candidate.id)) : [row]) : [];
    const deleteTargets = getDeleteTargetsForRows(deleteRows);
    const permissionsTarget = !protectedGVICRow && row?.kind === "folder" && row.folderID && !row.systemKey && (!row.entityType || row.entityType === "folder")
      ? {
        folderID: row.folderID,
        label: row.label,
        permissionsPath: row.entityType === "folder" ? `/v1/company-explorer/folders/${encodeURIComponent(row.folderID)}/permissions` : undefined,
      }
      : null;
    setExplorerContextMenu({
      x: event.clientX,
      y: event.clientY,
      targets,
      deleteTarget: protectedGVICRow ? null : (deleteTargets[0] ?? resolveExplorerDeleteTarget(row ?? null)),
      deleteTargets,
      renameTarget: protectedGVICRow ? null : resolveExplorerRenameTarget(row ?? null),
      permissionsTarget,
      openInNewTabTarget: protectedGVICRow ? null : getOpenInNewTabTargetForExplorerRow(row),
      renameTreeID: row?.id ?? "",
      renameLabel: row?.label ?? "",
      contextKind,
      createPosition: getContextCreatePosition(row, event),
      createNodeLogicGateID,
      createNodeLogicGateTreeID,
      createLogicGateGVICRole,
      createFolderScopeType: createFolderScope?.scope_type,
      createFolderScopeID: createFolderScope?.scope_id,
      canCreateFolder: canCreateForContext && (!scopedKind || Boolean(scopedRootFolder)),
      canCreateNode: canCreateForContext && !scopedKind,
      canCreateLogicGate: canCreateForContext && (scopedKind ? scopedKind === "logic_gate" && Boolean(scopedRootFolder) : true),
      canCreateProject: canCreateForContext && (scopedKind ? scopedKind === "project" && Boolean(scopedRootFolder) : true),
    });
  }, [focusTreeRow, getContextCreatePosition, getDeleteTargetsForRows, GVICExplorerActive, resolveCreateFolderScope, scopedKind, scopedRootFolder, scopedRootRow, selectTreeRow, selectedTreeIDs, teamCompanyExplorerActive, treeRows]);

  // Kanban accepts node cards only. A mixed Explorer selection is still valid
  // for navigation, but the drag payload intentionally exports node rows only.
  const getKanbanDragItemsForRow = useCallback((row: ExplorerTreeNode): ExplorerEntityDragItem[] => {
    const dragIDs = selectedTreeIDs.has(row.id) ? selectedTreeIDs : new Set([row.id]);
    const items: ExplorerEntityDragItem[] = [];
    const seen = new Set<string>();
    for (const item of treeRows) {
      if (!dragIDs.has(item.id) || item.kind !== "node" || !item.nodeID || seen.has(item.nodeID)) continue;
      seen.add(item.nodeID);
      items.push({ nodeID: item.nodeID, label: item.label });
    }
    if (items.length === 0 && row.kind === "node" && row.nodeID) {
      items.push({ nodeID: row.nodeID, label: row.label });
    }
    return items;
  }, [selectedTreeIDs, treeRows]);

  useCompanyExplorerSelectionBridge({
    companyID,
    scope,
    linkedMapFrameID,
    linkedLogicMapFrameID,
    selectedNodeID,
    selectedLogicGateID,
    selectedKanbanBoardID,
    selectedFolderID,
    selectedFolderKind,
    selectedFolderLabel,
    selectedKanbanBoardLabel,
    selectedTreeID,
    selectedTreeIDs,
    selectedTree,
    selectionTargetFrameIDs: normalizedSelectionTargetFrameIDs,
    linkRevision,
    lastMapSelectionRevisionRef,
    lastLogicMapSelectionRevisionRef,
    suppressNextExplorerBroadcastRef,
    previousBroadcastSelectionRef,
    latestSelectionRef,
    latestLogicGateSelectionRef,
    latestExplorerDomainRef,
    lastLocalExplorerSelectionRef,
    pendingExplorerSelectionIntentRef,
    explorerContextSequenceRef,
    setLinkedMapFrameID,
    setLinkedLogicMapFrameID,
    setLinkRevision,
    setSelectedTreeID,
    setSelectedTreeIDs,
    setSelectionAnchorTreeID,
    setSelectedNodeID,
    setSelectedLogicGateID,
    setSelectedKanbanBoardID,
    expandTreeIDs,
    applyExplorerFindSelection,
  });

  const requestCompanyExplorerTriageMessagesDrop = useCallback<CompanyExplorerTriageMessageDropHandler>((target, messageIDs, point) => {
    if (onTriageMessagesDrop) {
      onTriageMessagesDrop(target, messageIDs, point);
      return;
    }
    const cleanMessageIDs = cleanExplorerIDs(messageIDs);
    if (cleanMessageIDs.length === 0) return;
    setInternalTriageDropMenu({ target, messageIDs: cleanMessageIDs, x: point.x, y: point.y });
  }, [onTriageMessagesDrop]);

  const pickCompanyExplorerTriageDropPriority = useCallback(async (priority: number) => {
    if (!internalTriageDropMenu) return;
    const target = companyExplorerTriageConversionTarget(internalTriageDropMenu.target);
    if (!target) {
      setError("invalid_triage_drop_target");
      setInternalTriageDropMenu(null);
      return;
    }
    setInternalTriageDropBusy(true);
    setError("");
    try {
      const result = await convertTriageMessagesToExplorerTarget({
        companyID,
        target,
        messageIDs: internalTriageDropMenu.messageIDs,
        priority,
      });
      for (const node of result.nodes ?? []) dispatchExplorerStore({ type: "upsertNode", node });
      if (result.folder_items && result.folder_items.length > 0) dispatchExplorerStore({ type: "upsertFolderItems", folderItems: result.folder_items });
      if (result.explorer_v2_rows && result.explorer_v2_rows.length > 0) dispatchExplorerStore({ type: "upsertV2Rows", rows: result.explorer_v2_rows });
      setInternalTriageDropMenu(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_convert_triage_messages");
    } finally {
      setInternalTriageDropBusy(false);
    }
  }, [companyID, internalTriageDropMenu]);

  const deleteSummary = useMemo(() => (
    deleteConfirmation
      ? buildDeleteConfirmationSummary({ targets: deleteConfirmation.targets, folders, folderItems })
      : null
  ), [deleteConfirmation, folderItems, folders]);

  const isDarkTheme = theme === "dark";
  const surfaceBackground = isDarkTheme ? "#0f1216" : "#ffffff";
  const surfaceText = isDarkTheme ? "#f4f7fa" : "#111827";
  const ruleColor = isDarkTheme ? "rgba(255,255,255,0.16)" : "rgba(15,23,42,0.14)";
  const rowRuleColor = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)";
  const selectedRowBackground = isDarkTheme ? "rgba(100,116,139,0.2)" : "rgba(71, 85, 105, 0.24)";
  const dropRowBackground = isDarkTheme ? "rgba(100, 116, 139, 0.18)" : "rgba(100, 116, 139, 0.16)";
  const folderToggleColor = isDarkTheme ? "#f4f7fa" : "#111111";
  const rowIconColor = isDarkTheme ? "#cbd5e1" : "#475569";
  const scrollbarAccent = theme === "light" ? LIGHT_EXPLORER_CYAN_ACCENT : accent;
  const scrollbarTrack = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(71, 85, 105, 0.08)";
  const elevatedExplorerControls = useParentScroll && theme === "light" && !hideTopControls;
  const scopeControls = undefined;

  return (
    <div
      style={{
        width: "100%",
        height: useParentScroll ? "auto" : "100%",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        alignContent: useParentScroll ? "start" : undefined,
        background: elevatedExplorerControls ? "transparent" : surfaceBackground,
        color: surfaceText,
        overflow: useParentScroll ? "visible" : "hidden",
        minWidth: 0,
      }}
    >
      <CompanyExplorerTree
        error={error}
        accent={accent}
        surfaceBackground={surfaceBackground}
        surfaceText={surfaceText}
        rowIconColor={rowIconColor}
        dropRowBackground={dropRowBackground}
        selectedRowBackground={selectedRowBackground}
        rowRuleColor={rowRuleColor}
        ruleColor={ruleColor}
        folderToggleColor={folderToggleColor}
        scrollbarAccent={scrollbarAccent}
        scrollbarTrack={scrollbarTrack}
        isDarkTheme={isDarkTheme}
        elevatedControls={elevatedExplorerControls}
        topControlsAccessory={scopeControls}
        hideTopControls={hideTopControls}
        useParentScroll={useParentScroll}
        treeViewportRef={treeViewportRef}
        treeKeyboardActiveRef={treeKeyboardActiveRef}
        treeRows={treeRows}
        virtualizedTree={virtualizedTree}
        expanded={expanded}
        selectedTreeID={selectedTreeID}
        selectedTreeIDs={selectedTreeIDs}
        explorerSearchActive={explorerSearchActive}
        draggingTreeID={draggingTreeID}
        dragOverTreeID={dragOverTreeID}
        dragOverPlacement={dragOverPlacement}
        dragPayload={dragPayload}
        triageDropTreeID={triageDropTreeID}
        renaming={renaming}
        renameInputRef={renameInputRef}
        cancelRenameOnBlurRef={cancelRenameOnBlurRef}
        onTreeKeyDown={handleTreeKeyDown}
        onScrollTopChange={setTreeScrollTop}
        onCloseContextMenu={() => setExplorerContextMenu(null)}
        onOpenContextMenu={openExplorerContextMenu}
        onSelectExplorerSearchResult={selectExplorerSearchResult}
        onSelectTreeRow={selectTreeRow}
        onStartRenamingRow={startRenamingRow}
        onCommitRename={commitRename}
        onSetRenaming={setRenaming}
        onSetExpanded={setExpandedAndLoadChildren}
        onSetDraggingTreeID={setDraggingTreeID}
        onSetDragOverTreeID={setDragOverTreeID}
        onSetDragOverPlacement={setDragOverPlacement}
        onSetDragPayload={setDragPayload}
        onSetTriageDropTreeID={setTriageDropTreeID}
        onTriageMessagesDrop={requestCompanyExplorerTriageMessagesDrop}
        getKanbanDragItemsForRow={getKanbanDragItemsForRow}
        getExplorerItemRowsForPayload={getExplorerItemRowsForPayload}
        getReorderRowsForTarget={getReorderRowsForTarget}
        canDropExplorerPayloadOnRow={canDropExplorerPayloadOnRow}
        dropExplorerPayloadOnRow={dropExplorerPayloadOnRow}
        canPlaceExplorerFolderAtTarget={canPlaceExplorerFolderAtTarget}
        canPlaceExplorerItemsAtTarget={canPlaceExplorerItemsAtTarget}
        reorderExplorerRows={reorderExplorerRows}
        placeExplorerFolderAtTarget={placeExplorerFolderAtTarget}
        placeExplorerItemsAtTarget={placeExplorerItemsAtTarget}
        moveFolder={moveFolder}
        assignExplorerPayloadItemsToFolder={assignExplorerPayloadItemsToFolder}
      />

      {internalTriageDropMenu && (
        <FrameRightClickMenu x={internalTriageDropMenu.x} y={internalTriageDropMenu.y} onClose={() => setInternalTriageDropMenu(null)} minWidth={190}>
          {COMPANY_EXPLORER_TRIAGE_DROP_PRIORITIES.map((priority) => (
            <button
              key={priority}
              type="button"
              style={companyExplorerTriageDropMenuButtonStyle}
              disabled={internalTriageDropBusy}
              onClick={() => { void pickCompanyExplorerTriageDropPriority(priority); }}
            >
              Priority {priority}
            </button>
          ))}
        </FrameRightClickMenu>
      )}

      <CompanyExplorerContextMenu
        menu={explorerContextMenu}
        onClose={() => setExplorerContextMenu(null)}
        onCreateFolder={(folderKind, parentFolderID, position, scopeType, scopeID) => {
          void createFolder(folderKind, parentFolderID, position, scopeType, scopeID);
          setExplorerContextMenu(null);
        }}
        onCreateNode={(parentFolderID, position, logicGateID, logicGateTreeID, priority) => {
          void createNodeAtFolder(parentFolderID, position, logicGateID, logicGateTreeID, priority);
          setExplorerContextMenu(null);
        }}
        onCreateLogicGate={(parentFolderID, position, GVICRole) => {
          void createLogicGateAtFolder(parentFolderID, position, GVICRole);
          setExplorerContextMenu(null);
        }}
        onCreateProject={(parentFolderID, position) => {
          void createProjectAtFolder(parentFolderID, position);
          setExplorerContextMenu(null);
        }}
        onOpenFolderPermissions={(target) => {
          setExplorerContextMenu(null);
          setFolderPermissionsTarget(target);
        }}
        onOpenInNewTab={(target) => {
          setExplorerContextMenu(null);
          openCompanyExplorerTargetInNewTab(target);
        }}
        onRenameTarget={(treeID, target, value) => {
          setExplorerContextMenu(null);
          cancelRenameOnBlurRef.current = false;
          setSelectedTreeID(treeID);
          setSelectedTreeIDs(new Set([treeID]));
          setSelectionAnchorTreeID(treeID);
          setRenaming({ treeID, target, value });
        }}
        onDeleteTargets={requestDeleteTargets}
      />

      {folderPermissionsTarget && (
        <EntityPermissionsDialog
          requestJSON={requestJSON}
          companyID={companyID}
          entityType="company_explorer_folder"
          entityID={folderPermissionsTarget.folderID}
          title={folderPermissionsTarget.label}
          onClose={() => setFolderPermissionsTarget(null)}
          onSaved={() => void refreshCompanyExplorerSnapshot()}
          permissionsPath={folderPermissionsTarget.permissionsPath}
        />
      )}

      {deleteBlockedMessage && (
        <CompanyExplorerDeleteBlockedDialog
          message={deleteBlockedMessage}
          isDarkTheme={isDarkTheme}
          onClose={() => setDeleteBlockedMessage("")}
        />
      )}

      {deleteConfirmation && deleteSummary && (
        <CompanyExplorerDeleteConfirmationDialog
          targets={deleteConfirmation.targets}
          summary={deleteSummary}
          acknowledged={deleteFolderAcknowledged}
          isDarkTheme={isDarkTheme}
          position={deleteConfirmation.position}
          onAcknowledgedChange={setDeleteFolderAcknowledged}
          onConfirm={(targets) => {
            setDeleteConfirmation(null);
            setDeleteFolderAcknowledged(false);
            void deleteExplorerTargets(targets);
          }}
          onCancel={() => {
            setDeleteConfirmation(null);
            setDeleteFolderAcknowledged(false);
          }}
        />
      )}
    </div>
  );
};
