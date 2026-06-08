import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getNodeTitle as getNodeRecordTitle, type NodeRecord } from "../node-map/shared";
import { getNodeTitle as getLogicGateRecordTitle, toLogicGateCanvasRecord, type LogicGateRaciRole, type LogicGateRecord as LogicGateApiRecord, type NodeRecord as LogicGateCanvasRecord } from "../logic-gate-map/shared";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, EVENT_LOGIC_GATE_MAP_FOCUS_REQUESTED, EVENT_NODE_MAP_FOCUS_REQUESTED } from "../node-map/eventbus";
import { removeCompanyExplorerFolderInNodeRelationshipGraph, removeNodeRelationshipGraphNode, removeNodeRelationshipGraphRelationshipsForNode, upsertCompanyExplorerFolderInNodeRelationshipGraph, upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../node-map/NodeRelationshipGraph";
import { removeCompanyExplorerFolderInLogicGateRelationshipGraph, removeLogicGateRelationshipGraphNode, removeLogicGateRelationshipGraphRelationshipsForLogicGate, upsertCompanyExplorerFolderInLogicGateRelationshipGraph, upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../logic-gate-map/LogicGateRelationshipGraph";
import { type ExplorerSelectionState } from "./explorerSync";
import { type CompanyExplorerFolder, type CompanyExplorerFolderItem, type CompanyExplorerFolderKind, type CompanyExplorerItemType, type CompanyExplorerSystemFolderKey } from "../folders/companyExplorerFolders";
import { invalidateKanbanBoardListCache, listKanbanBoards, type RacioMatrixProjectionRow } from "../kanban/kanbanApi";
import { EVENT_KANBAN_BOARDS_UPDATED, logicGateKanbanBoardID, type ExplorerEntityDragItem, type KanbanBoardsUpdatedDetail } from "../kanban/shared";
import { type SelectionIntent } from "../selectionCoordinator";
import { companyExplorerRealtimeScope, subscribeWorkspaceUserRealtime, type WorkspaceStreamGapSignal } from "../workspace/workspaceRealtime";
import { fetchWorkspaceSnapshot } from "../workspace/workspaceSnapshotCache";
import { createWorkspaceEntityBatchClientID, createWorkspaceEntityBatchCommand, type WorkspaceEntityBatchCreatorLogicGateRaciRole } from "../workspace/workspaceEntityCommands";
import { buildExplorerFindSelection, buildExplorerRowBatchReorderPlan, buildExplorerRowReorderPlan, buildExplorerSearchResults, buildExplorerSearchViewRows, getExplorerDropPayloadItemType, getExplorerDropPayloadItems, getExplorerScrollTopForRow, isExplorerSystemFolderKey, resolveExplorerClickSelection, resolveExplorerCreationTargets, resolveExplorerDeleteTarget, resolveExplorerRenameTarget, type ExplorerFindEntity } from "./treePresentation";
import { CompanyExplorerContextMenu } from "./CompanyExplorerContextMenu";
import { CompanyExplorerDeleteBlockedDialog, CompanyExplorerDeleteConfirmationDialog, CompanyExplorerFolderShareDialogView } from "./CompanyExplorerDialogs";
import { CompanyExplorerTree } from "./CompanyExplorerTree";
import {
  collectFolderSubtreeIDs,
  explorerRowOrder,
  getExplorerFindTarget,
  getExplorerItemPayload,
  getExplorerRowContainerID,
  getExplorerRowOrderKind,
  getExplorerSelectionDomain,
  readExpandedRowsFromStorage,
  readRootRowOrderFromStorage,
  readScrollTopFromStorage,
  TREE_ROW_POSITION_STEP,
} from "./companyExplorerDragDrop";
import {
  type CompanyExplorerContextMenuState,
  type ExplorerDeleteTargetWithLabel,
  type ExplorerDragPayload,
  type ExplorerFindTarget,
  type ExplorerPinTarget,
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
import { buildCompanyExplorerTreeRows, buildScopedCompanyExplorerTreeRows, findCompanyExplorerRootFolderByName } from "./companyExplorerTreeRows";
import { useCompanyExplorerFolderShares } from "./useCompanyExplorerFolderShares";
import { fetchCurrentUser } from "../../auth/cognitoAuth";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { requestAppSidebarPin } from "../../app/sidebarPins";
import { createRequestJSON } from "../api/requestJSON";
import { listCompanyUserGroups, type CompanyUserGroupMember } from "../communications/communicationsApi";
import { assignNodeToLogicGateStatus, moveLogicGateAssignment } from "../kanban/kanbanApi";
import { listMyLogicGates, listRacioMatrixProjectionRows } from "../work-items/workItemReadApi";
import {
  buildDeleteConfirmationSummary,
  findProtectedSystemFolderInDeleteTargets,
  getSystemFolderKeyForTreeRowID,
  type CompanyExplorerContentProps,
  type CompanyExplorerDeleteBatchResponse,
  type CompanyExplorerFolderItemAssignment,
  type CompanyExplorerFolderItemsBatchResponse,
  type CompanyExplorerWorkspaceEntityBatchResponse,
} from "./CompanyExplorerContentModel";
import {
  createCompanyExplorerStoreState,
  reduceCompanyExplorerStore,
  shouldInvalidateKanbanBoardListForExplorerEnvelope,
  shouldRefreshCompanyExplorerSnapshotForGap,
  shouldRefreshKanbanBoardsAfterUpdate,
  type CompanyExplorerSnapshotPayload,
  type CompanyExplorerWorkspaceStreamEnvelope,
} from "./companyExplorerStore";

const scopedRootCreationKeys = new Set<string>();
const raciVisualRootCreationKeys = new Set<string>();
const LIGHT_EXPLORER_CYAN_ACCENT = "rgb(71, 85, 105)";
const HIDDEN_MAIN_EXPLORER_ROOT_FOLDER_NAMES = new Set(["logic gates by function", "logic gates by person"]);
type CompanyExplorerScopeView = "mine" | "teams" | "company";
type ExplorerLogicGateRecord = LogicGateCanvasRecord & Partial<Pick<LogicGateApiRecord, "raci_assignments">>;
type CompanyExplorerRaciFolderRole = LogicGateRaciRole | "other";

const RACI_FOLDER_ROWS = [
  { role: "responsible", label: "Responsible" },
  { role: "accountable", label: "Accountable" },
  { role: "consulted", label: "Consulted" },
  { role: "informed", label: "Informed" },
  { role: "other", label: "Others" },
] as const satisfies ReadonlyArray<{ role: CompanyExplorerRaciFolderRole; label: string }>;

const LOGIC_GATE_RACI_ROLES: LogicGateRaciRole[] = ["responsible", "accountable", "consulted", "informed"];
const RACI_PROJECTION_LIMIT = 500;
const RACI_VISUAL_ROOT_FOLDER_PREFIX = "Mango RACI ";

function normalizeExplorerFolderName(value: string): string {
  return value.trim().toLowerCase();
}

function raciVisualRootFolderName(role: CompanyExplorerRaciFolderRole): string {
  const label = RACI_FOLDER_ROWS.find((folder) => folder.role === role)?.label ?? role;
  return `${RACI_VISUAL_ROOT_FOLDER_PREFIX}${label}`;
}

function isRaciVisualRootFolderName(value: string): boolean {
  const normalized = normalizeExplorerFolderName(value);
  return RACI_FOLDER_ROWS.some((folder) => normalized === normalizeExplorerFolderName(raciVisualRootFolderName(folder.role)));
}

function raciVisualRootFolderForRole(folders: CompanyExplorerFolder[], role: CompanyExplorerRaciFolderRole): CompanyExplorerFolder | null {
  const targetName = normalizeExplorerFolderName(raciVisualRootFolderName(role));
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
      || isRaciVisualRootFolderName(row.label)
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

function shouldRefreshRaciExplorerProjectionForGap(gap: WorkspaceStreamGapSignal, companyID: string): boolean {
  if (gap.companyID !== companyID) return false;
  return gap.scopes.some((scope) => scope.kind === "racio_matrix" || scope.kind === "workspace");
}

function shouldRefreshRaciExplorerProjectionForEnvelope(companyID: string, envelope: CompanyExplorerWorkspaceStreamEnvelope): boolean {
  if (envelope.company_id !== companyID) return false;
  const type = envelope.type?.trim() ?? "";
  return type === "node_created"
    || type === "node_updated"
    || type === "node_deleted"
    || type === "node_permissions_updated"
    || type === "logic_gate_created"
    || type === "logic_gate_updated"
    || type === "logic_gate_deleted"
    || type === "logic_gate_raci_updated"
    || type === "logic_gate_permissions_updated"
    || type.startsWith("work_item.");
}

function cleanExplorerID(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function logicGateOwnedByAnyUser(logicGate: ExplorerLogicGateRecord, userIDs: Set<string>): boolean {
  if (userIDs.size === 0) return false;
  return (logicGate.raci_assignments ?? []).some((assignment) => userIDs.has(cleanExplorerID(assignment.user_id)));
}

function teamMemberUserIDsForCurrentUser(members: CompanyUserGroupMember[], currentUserID: string): Set<string> {
  const cleanCurrentUserID = currentUserID.trim();
  const ownGroupIDs = new Set(
    members
      .filter((member) => cleanExplorerID(member.user_id) === cleanCurrentUserID)
      .map((member) => cleanExplorerID(member.group_id))
      .filter(Boolean),
  );
  const userIDs = new Set<string>();
  if (cleanCurrentUserID) userIDs.add(cleanCurrentUserID);
  for (const member of members) {
    if (ownGroupIDs.has(cleanExplorerID(member.group_id))) {
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

  const ownerUserIDs = input.scopeView === "teams"
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
  for (const node of input.nodes) {
    const assigneeID = cleanExplorerID(node.assignee_user_id);
    if (assigneeID && ownerUserIDs.has(assigneeID)) {
      for (const logicGateID of node.logic_gate_ids ?? []) {
        const cleanLogicGateID = cleanExplorerID(logicGateID);
        if (cleanLogicGateID) visibleLogicGateIDs.add(cleanLogicGateID);
      }
    }
  }

  const visibleNodeIDs = new Set<string>();
  for (const node of input.nodes) {
    const assigneeID = cleanExplorerID(node.assignee_user_id);
    if (assigneeID && ownerUserIDs.has(assigneeID)) {
      visibleNodeIDs.add(node.node_id);
      continue;
    }
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
    folders: input.folders.filter((folder) => visibleFolderIDs.has(folder.folder_id)),
    folderItems: scopedFolderItems,
  };
}

function raciFolderTreeID(role: CompanyExplorerRaciFolderRole): string {
  return `raci-folder-${role}`;
}

function raciLogicGateTreeID(role: CompanyExplorerRaciFolderRole, logicGateID: string): string {
  return `raci-${role}-logic-gate-${logicGateID}`;
}

function raciNodeTreeID(role: CompanyExplorerRaciFolderRole, logicGateID: string, nodeID: string): string {
  return `raci-${role}-logic-gate-${logicGateID}-node-${nodeID}`;
}

function raciNoLogicGateTreeID(role: CompanyExplorerRaciFolderRole): string {
  return `raci-${role}-no-logic-gate`;
}

function raciNoLogicGateNodeTreeID(role: CompanyExplorerRaciFolderRole, nodeID: string): string {
  return `raci-${role}-no-logic-gate-node-${nodeID}`;
}

function raciVisualLogicGateTreeID(role: CompanyExplorerRaciFolderRole, folderID: string, logicGateID: string): string {
  return `raci-${role}-folder-${folderID}-logic-gate-${logicGateID}`;
}

function raciVisualNodeTreeID(role: CompanyExplorerRaciFolderRole, folderID: string, nodeID: string): string {
  return `raci-${role}-folder-${folderID}-node-${nodeID}`;
}

function isProtectedRaciRoleRow(row: ExplorerTreeNode | null | undefined): boolean {
  return row?.syntheticKind === "raci_folder";
}

function isLogicGateRaciRole(value: CompanyExplorerRaciFolderRole | string | undefined): value is LogicGateRaciRole {
  return LOGIC_GATE_RACI_ROLES.includes(value as LogicGateRaciRole);
}

function logicGateRaciRolesForUser(logicGate: ExplorerLogicGateRecord, userID: string): CompanyExplorerRaciFolderRole[] {
  const cleanUserID = cleanExplorerID(userID);
  if (!cleanUserID) return ["other"];
  const roles = LOGIC_GATE_RACI_ROLES.filter((role) => (
    (logicGate.raci_assignments ?? []).some((assignment) => assignment.role === role && cleanExplorerID(assignment.user_id) === cleanUserID)
  ));
  return roles.length > 0 ? roles : ["other"];
}

function projectionRowMatchesUser(row: RacioMatrixProjectionRow, companyID: string, userID: string): boolean {
  return cleanExplorerID(row.company_id) === cleanExplorerID(companyID)
    && cleanExplorerID(row.user_id) === cleanExplorerID(userID)
    && Boolean(cleanExplorerID(row.resource_id));
}

function materializeProjectionNode(row: RacioMatrixProjectionRow, previous: NodeRecord | undefined): NodeRecord | null {
  const nodeID = cleanExplorerID(row.resource_id);
  if (row.resource_type !== "node" || !nodeID) return null;
  const logicGateID = cleanExplorerID(row.logic_gate_id);
  return {
    ...previous,
    company_id: cleanExplorerID(row.company_id) || previous?.company_id || "",
    node_id: nodeID,
    title: row.display_title || previous?.title || "Untitled node",
    status: row.status ?? null,
    status_color: row.status_color ?? null,
    due_date: row.due_date ?? null,
    priority: row.priority ?? null,
    assignee_user_id: row.assignee_user_id ?? null,
    assignee_name: row.assignee_display_name ?? null,
    assignee_email: row.assignee_email ?? null,
    logic_gate_ids: logicGateID ? [logicGateID] : [],
    created_timestamp: row.resource_created_timestamp || previous?.created_timestamp || "",
    effective_access_level: previous?.effective_access_level ?? "edit",
    can_view: previous?.can_view ?? true,
    can_edit: previous?.can_edit ?? true,
    can_admin: previous?.can_admin ?? false,
  };
}

function materializeProjectionLogicGate(
  row: RacioMatrixProjectionRow,
  previous: ExplorerLogicGateRecord | undefined,
  projected: ExplorerLogicGateRecord | undefined,
): ExplorerLogicGateRecord | null {
  const logicGateID = cleanExplorerID(row.resource_id);
  if (row.resource_type !== "logic_gate" || !logicGateID) return null;
  const header = row.display_title || projected?.header || previous?.header || previous?.title || "Untitled Logic Gate";
  return {
    ...previous,
    ...projected,
    company_id: cleanExplorerID(row.company_id) || projected?.company_id || previous?.company_id || "",
    logic_gate_id: logicGateID,
    node_id: logicGateID,
    title: header,
    header,
    created_timestamp: row.resource_created_timestamp || projected?.created_timestamp || previous?.created_timestamp || "",
    raci_assignments: projected?.raci_assignments ?? previous?.raci_assignments ?? [],
    effective_access_level: projected?.effective_access_level ?? previous?.effective_access_level ?? "edit",
    can_view: projected?.can_view ?? previous?.can_view ?? true,
    can_edit: projected?.can_edit ?? previous?.can_edit ?? true,
    can_admin: projected?.can_admin ?? previous?.can_admin ?? false,
  };
}

function materializeRaciProjectionExplorerData(input: {
  companyID: string;
  currentUserID: string;
  projectionRows: RacioMatrixProjectionRow[];
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
    if (row.resource_type === "node") {
      const node = materializeProjectionNode(row, fallbackNodeByID.get(cleanExplorerID(row.resource_id)));
      if (node) {
        nodeByID.set(node.node_id, node);
        const logicGateID = cleanExplorerID(row.logic_gate_id);
        const projected = projectedLogicGateByID.get(logicGateID);
        const fallback = fallbackLogicGateByID.get(logicGateID);
        if (logicGateID && !logicGateByID.has(logicGateID) && (projected || fallback)) {
          logicGateByID.set(logicGateID, projected ?? fallback!);
        }
      }
      continue;
    }
    if (row.resource_type === "logic_gate") {
      const logicGateID = cleanExplorerID(row.resource_id);
      const logicGate = materializeProjectionLogicGate(
        row,
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

function buildRaciCompanyExplorerRows(input: {
  expanded: Set<string>;
  nodes: NodeRecord[];
  logicGates: ExplorerLogicGateRecord[];
  folderNodes: NodeRecord[];
  folderLogicGates: ExplorerLogicGateRecord[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  currentUserID: string;
}): ExplorerTreeNode[] {
  const rows: ExplorerTreeNode[] = [];
  const nodeByID = new Map<string, NodeRecord>();
  for (const node of input.folderNodes) nodeByID.set(node.node_id, node);
  for (const node of input.nodes) nodeByID.set(node.node_id, node);
  const logicGateByID = new Map<string, ExplorerLogicGateRecord>();
  for (const logicGate of input.folderLogicGates) logicGateByID.set(logicGate.logic_gate_id, logicGate);
  for (const logicGate of input.logicGates) logicGateByID.set(logicGate.logic_gate_id, logicGate);
  const folderByID = new Map(input.folders.map((folder) => [folder.folder_id, folder]));
  const roleRootByRole = new Map<CompanyExplorerRaciFolderRole, CompanyExplorerFolder>();
  const roleByRootFolderID = new Map<string, CompanyExplorerRaciFolderRole>();
  for (const folder of RACI_FOLDER_ROWS) {
    const root = raciVisualRootFolderForRole(input.folders, folder.role);
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

  const roleForVisualFolder = (folderID: string): CompanyExplorerRaciFolderRole | null => {
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
  const logicGatesByRole = new Map<CompanyExplorerRaciFolderRole, ExplorerLogicGateRecord[]>();
  for (const logicGate of input.logicGates) {
    for (const role of logicGateRaciRolesForUser(logicGate, input.currentUserID)) {
      const bucket = logicGatesByRole.get(role) ?? [];
      bucket.push(logicGate);
      logicGatesByRole.set(role, bucket);
    }
  }
  const placedByRole = new Map<CompanyExplorerRaciFolderRole, { logicGateIDs: Set<string>; nodeIDs: Set<string> }>();
  const placementForRole = (role: CompanyExplorerRaciFolderRole) => {
    let placement = placedByRole.get(role);
    if (!placement) {
      placement = { logicGateIDs: new Set<string>(), nodeIDs: new Set<string>() };
      placedByRole.set(role, placement);
    }
    return placement;
  };
  for (const item of input.folderItems) {
    const role = roleForVisualFolder(item.folder_id);
    if (!role) continue;
    const placement = placementForRole(role);
    if (item.item_type === "logic_gate" && logicGateByID.has(item.item_id)) placement.logicGateIDs.add(item.item_id);
    if (item.item_type === "node" && nodeByID.has(item.item_id)) placement.nodeIDs.add(item.item_id);
  }

  const visualFolderHasChildren = (folderID: string): boolean => {
    if ((foldersByParent.get(folderID) ?? []).length > 0) return true;
    return (itemsByFolder.get(folderID) ?? []).some((item) => (
      (item.item_type === "logic_gate" && logicGateByID.has(item.item_id))
      || (item.item_type === "node" && nodeByID.has(item.item_id))
    ));
  };

  const pushVisualLogicGateBranch = (
    role: CompanyExplorerRaciFolderRole,
    folderID: string,
    folderKind: CompanyExplorerFolderKind,
    logicGate: ExplorerLogicGateRecord,
    depth: number,
    position: number,
    createdTimestamp: string,
  ) => {
    const placed = placementForRole(role);
    const rowID = raciVisualLogicGateTreeID(role, folderID, logicGate.logic_gate_id);
    const nestedNodes = [...(nodesByLogicGateID.get(logicGate.logic_gate_id) ?? [])]
      .filter((node) => !placed.nodeIDs.has(node.node_id))
      .sort((a, b) => (
        getNodeRecordTitle(a).localeCompare(getNodeRecordTitle(b))
        || a.created_timestamp.localeCompare(b.created_timestamp)
        || a.node_id.localeCompare(b.node_id)
      ));
    rows.push({
      id: rowID,
      label: getLogicGateRecordTitle(logicGate) || logicGate.logic_gate_id,
      depth,
      kind: "logic_gate",
      logicGateID: logicGate.logic_gate_id,
      folderID,
      folderKind,
      scopeLevel: depth,
      position,
      createdTimestamp,
      hasChildren: nestedNodes.length > 0,
      raciRole: role,
      syntheticKind: "logic_gate_children",
    });
    if (!input.expanded.has(rowID)) return;
    for (const [nodeIndex, node] of nestedNodes.entries()) {
      rows.push({
        id: raciNodeTreeID(role, logicGate.logic_gate_id, node.node_id),
        label: getNodeRecordTitle(node) || node.node_id,
        depth: depth + 1,
        kind: "node",
        nodeID: node.node_id,
        scopeLevel: depth + 1,
        position: (nodeIndex + 1) * TREE_ROW_POSITION_STEP,
        createdTimestamp: node.created_timestamp,
        parentLogicGateID: logicGate.logic_gate_id,
        raciRole: role,
        syntheticKind: "logic_gate_children",
      });
    }
  };

  const pushVisualFolderBranch = (role: CompanyExplorerRaciFolderRole, parentFolderID: string, depth: number) => {
    const parentFolderKind = folderByID.get(parentFolderID)?.folder_kind ?? "logic_gate";
    const branchRows: Array<
      | { kind: "folder"; folder: CompanyExplorerFolder; position: number; createdTimestamp: string; label: string }
      | { kind: "item"; item: CompanyExplorerFolderItem; position: number; createdTimestamp: string; label: string }
    > = [];
    for (const folder of foldersByParent.get(parentFolderID) ?? []) {
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
        const logicGate = logicGateByID.get(item.item_id);
        if (!logicGate) continue;
        branchRows.push({
          kind: "item",
          item,
          position: item.position || TREE_ROW_POSITION_STEP,
          createdTimestamp: item.created_timestamp,
          label: getLogicGateRecordTitle(logicGate) || logicGate.logic_gate_id,
        });
      } else if (item.item_type === "node") {
        const node = nodeByID.get(item.item_id);
        if (!node) continue;
        branchRows.push({
          kind: "item",
          item,
          position: item.position || TREE_ROW_POSITION_STEP,
          createdTimestamp: item.created_timestamp,
          label: getNodeRecordTitle(node) || node.node_id,
        });
      }
    }
    branchRows.sort((a, b) => a.position - b.position || a.createdTimestamp.localeCompare(b.createdTimestamp) || a.label.localeCompare(b.label));
    for (const entry of branchRows) {
      if (entry.kind === "folder") {
        const folder = entry.folder;
        const rowID = `workspace-folder-${folder.folder_id}`;
        rows.push({
          id: rowID,
          label: folder.name,
          depth,
          kind: "folder",
          folderID: folder.folder_id,
          parentFolderID: folder.parent_folder_id ?? "",
          folderKind: folder.folder_kind as CompanyExplorerFolderKind,
          scopeLevel: depth,
          position: folder.position || TREE_ROW_POSITION_STEP,
          createdTimestamp: folder.created_timestamp,
          hasChildren: visualFolderHasChildren(folder.folder_id),
          raciRole: role,
          syntheticKind: "logic_gate_children",
        });
        if (input.expanded.has(rowID)) pushVisualFolderBranch(role, folder.folder_id, depth + 1);
        continue;
      }
      const item = entry.item;
      if (item.item_type === "logic_gate") {
        const logicGate = logicGateByID.get(item.item_id);
        if (!logicGate) continue;
        pushVisualLogicGateBranch(role, parentFolderID, parentFolderKind as CompanyExplorerFolderKind, logicGate, depth, item.position || TREE_ROW_POSITION_STEP, item.created_timestamp);
      } else if (item.item_type === "node") {
        const node = nodeByID.get(item.item_id);
        if (!node) continue;
        rows.push({
          id: raciVisualNodeTreeID(role, parentFolderID, node.node_id),
          label: getNodeRecordTitle(node) || node.node_id,
          depth,
          kind: "node",
          nodeID: node.node_id,
          folderID: parentFolderID,
          folderKind: parentFolderKind as CompanyExplorerFolderKind,
          scopeLevel: depth,
          position: item.position || TREE_ROW_POSITION_STEP,
          createdTimestamp: item.created_timestamp,
          raciRole: role,
          syntheticKind: "logic_gate_children",
        });
      }
    }
  };

  for (const [folderIndex, folder] of RACI_FOLDER_ROWS.entries()) {
    const folderID = raciFolderTreeID(folder.role);
    const visualRootFolder = roleRootByRole.get(folder.role);
    const visualRootFolderID = visualRootFolder?.folder_id ?? "";
    const visualRootHasChildren = visualRootFolderID ? visualFolderHasChildren(visualRootFolderID) : false;
    const placed = placementForRole(folder.role);
    const noLogicGateNodes = folder.role === "other"
      ? [...nodesWithoutLogicGate].filter((node) => !placed.nodeIDs.has(node.node_id)).sort((a, b) => (
        getNodeRecordTitle(a).localeCompare(getNodeRecordTitle(b))
        || a.created_timestamp.localeCompare(b.created_timestamp)
        || a.node_id.localeCompare(b.node_id)
      ))
      : [];
    const noLogicGateRowID = raciNoLogicGateTreeID(folder.role);
    const logicGateRows = [...(logicGatesByRole.get(folder.role) ?? [])].sort((a, b) => (
      getLogicGateRecordTitle(a).localeCompare(getLogicGateRecordTitle(b))
      || a.created_timestamp.localeCompare(b.created_timestamp)
      || a.logic_gate_id.localeCompare(b.logic_gate_id)
    )).filter((logicGate) => !placed.logicGateIDs.has(logicGate.logic_gate_id));
    rows.push({
      id: folderID,
      label: folder.label,
      depth: 0,
      kind: "folder",
      folderID: visualRootFolderID || undefined,
      parentFolderID: "",
      folderKind: "logic_gate",
      scopeLevel: 0,
      position: (folderIndex + 1) * TREE_ROW_POSITION_STEP,
      createdTimestamp: visualRootFolder?.created_timestamp ?? "",
      hasChildren: visualRootHasChildren || logicGateRows.length > 0 || noLogicGateNodes.length > 0,
      raciRole: folder.role,
      syntheticKind: "raci_folder",
    });
    if (!input.expanded.has(folderID)) continue;

    if (visualRootFolderID) pushVisualFolderBranch(folder.role, visualRootFolderID, 1);

    if (noLogicGateNodes.length > 0) {
      rows.push({
        id: noLogicGateRowID,
        label: "No Logic Gate",
        depth: 1,
        kind: "folder",
        folderKind: "node",
        scopeLevel: 1,
        position: TREE_ROW_POSITION_STEP,
        createdTimestamp: "",
        hasChildren: noLogicGateNodes.length > 0,
        raciRole: folder.role,
        syntheticKind: "logic_gate_children",
      });
      if (input.expanded.has(noLogicGateRowID)) {
        for (const [nodeIndex, node] of noLogicGateNodes.entries()) {
          rows.push({
            id: raciNoLogicGateNodeTreeID(folder.role, node.node_id),
            label: getNodeRecordTitle(node) || node.node_id,
            depth: 2,
            kind: "node",
            nodeID: node.node_id,
            scopeLevel: 2,
            position: (nodeIndex + 1) * TREE_ROW_POSITION_STEP,
            createdTimestamp: node.created_timestamp,
            raciRole: folder.role,
            syntheticKind: "logic_gate_children",
          });
        }
      }
    }

    const logicGatePositionOffset = noLogicGateNodes.length > 0 ? 1 : 0;
    for (const [logicGateIndex, logicGate] of logicGateRows.entries()) {
      const logicGateRowID = raciLogicGateTreeID(folder.role, logicGate.logic_gate_id);
      const nestedNodes = [...(nodesByLogicGateID.get(logicGate.logic_gate_id) ?? [])].filter((node) => !placed.nodeIDs.has(node.node_id)).sort((a, b) => (
        getNodeRecordTitle(a).localeCompare(getNodeRecordTitle(b))
        || a.created_timestamp.localeCompare(b.created_timestamp)
        || a.node_id.localeCompare(b.node_id)
      ));
      rows.push({
        id: logicGateRowID,
        label: getLogicGateRecordTitle(logicGate) || logicGate.logic_gate_id,
        depth: 1,
        kind: "logic_gate",
        logicGateID: logicGate.logic_gate_id,
        folderID: visualRootFolderID || undefined,
        folderKind: visualRootFolderID ? "logic_gate" : undefined,
        scopeLevel: 1,
        position: (logicGateIndex + 1 + logicGatePositionOffset) * TREE_ROW_POSITION_STEP,
        createdTimestamp: logicGate.created_timestamp,
        hasChildren: nestedNodes.length > 0,
        raciRole: folder.role,
        syntheticKind: "logic_gate_children",
      });
      if (!input.expanded.has(logicGateRowID)) continue;

      for (const [nodeIndex, node] of nestedNodes.entries()) {
        rows.push({
          id: raciNodeTreeID(folder.role, logicGate.logic_gate_id, node.node_id),
          label: getNodeRecordTitle(node) || node.node_id,
          depth: 2,
          kind: "node",
          nodeID: node.node_id,
          scopeLevel: 2,
          position: (nodeIndex + 1) * TREE_ROW_POSITION_STEP,
          createdTimestamp: node.created_timestamp,
          parentLogicGateID: logicGate.logic_gate_id,
          raciRole: folder.role,
          syntheticKind: "logic_gate_children",
        });
      }
    }
  }
  return rows;
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
  onSearchResultSelect,
}) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = getActiveCompanyID();
  const scope = widgetId?.trim() ? widgetId : "global";
  const normalizedSelectionTargetFrameIDs = useMemo(() => (
    Array.from(new Set((selectionTargetFrameIDs ?? []).map((id) => id.trim()).filter(Boolean)))
  ), [selectionTargetFrameIDs]);
  const expandedStorageKey = `company-explorer-expanded-v1:${companyID}:${scope}`;
  const scrollStorageKey = `company-explorer-scroll-v1:${companyID}:${scope}`;
  const rootOrderStorageKey = `company-explorer-root-order-v1:${companyID}:${scope}`;

  const [explorerStore, dispatchExplorerStore] = useReducer(reduceCompanyExplorerStore, undefined, createCompanyExplorerStoreState);
  const { nodes, logicGates, kanbanBoards, folders, folderItems, folderSnapshotLoaded } = explorerStore;
  const [selectedTreeID, setSelectedTreeID] = useState("folder-root");
  const [selectedTreeIDs, setSelectedTreeIDs] = useState<Set<string>>(new Set(["folder-root"]));
  const [selectionAnchorTreeID, setSelectionAnchorTreeID] = useState("folder-root");
  const [selectedNodeID, setSelectedNodeID] = useState("");
  const [selectedLogicGateID, setSelectedLogicGateID] = useState("");
  const [selectedKanbanBoardID, setSelectedKanbanBoardID] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => readExpandedRowsFromStorage(expandedStorageKey));
  const selectedTreeIDRef = useRef(selectedTreeID);
  const expandedRef = useRef(expanded);
  const defaultExpansionAppliedRef = useRef(false);
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
  const preSearchScrollTopRef = useRef(treeScrollTop);
  const [treeViewportHeight, setTreeViewportHeight] = useState(480);
  const [rootRowOrder, setRootRowOrder] = useState<Record<string, number>>(() => readRootRowOrderFromStorage(rootOrderStorageKey));
  const [draggingTreeID, setDraggingTreeID] = useState("");
  const [dragOverTreeID, setDragOverTreeID] = useState("");
  const [dragOverPlacement, setDragOverPlacement] = useState<ExplorerRowDropPlacement | null>(null);
  const [dragPayload, setDragPayload] = useState<ExplorerDragPayload | null>(null);
  const [explorerContextMenu, setExplorerContextMenu] = useState<CompanyExplorerContextMenuState | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ targets: ExplorerDeleteTargetWithLabel[] } | null>(null);
  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState("");
  const [deleteFolderAcknowledged, setDeleteFolderAcknowledged] = useState(false);
  const [explorerSearchQuery, setExplorerSearchQuery] = useState("");
  const effectiveExplorerSearchQuery = externalSearchQuery ?? explorerSearchQuery;
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
  const [scopeView, setScopeView] = useState<CompanyExplorerScopeView>("mine");
  const [currentUserID, setCurrentUserID] = useState("");
  const [groupMembers, setGroupMembers] = useState<CompanyUserGroupMember[]>([]);
  const [raciProjectionRows, setRaciProjectionRows] = useState<RacioMatrixProjectionRow[]>([]);
  const [raciProjectionLogicGates, setRaciProjectionLogicGates] = useState<ExplorerLogicGateRecord[]>([]);
  const [raciProjectionLoaded, setRaciProjectionLoaded] = useState(false);
  const raciProjectionRequestIDRef = useRef(0);
  const requestRaciExplorerProjectionRefreshRef = useRef<() => void>(() => undefined);

  const applyCompanyExplorerSnapshot = useCallback((snapshot: CompanyExplorerSnapshotPayload) => {
    dispatchExplorerStore({ type: "applySnapshot", snapshot });
  }, []);

  const reconcileCompanyExplorerGap = useCallback((gap: WorkspaceStreamGapSignal) => {
    if (!shouldRefreshCompanyExplorerSnapshotForGap(gap, companyID)) return;
    void fetchWorkspaceSnapshot(apiBase, companyID, { scope: "company_explorer", force: true })
      .then((result) => {
        if (result.payload) dispatchExplorerStore({ type: "applySnapshot", snapshot: result.payload as CompanyExplorerSnapshotPayload });
      })
      .catch(() => {
        // The next normal Explorer refresh still goes through the bounded snapshot cache.
      });
  }, [apiBase, companyID]);

  useEffect(() => {
    let cancelled = false;
    dispatchExplorerStore({ type: "resetSnapshot" });
    (async () => {
      try {
        const result = await fetchWorkspaceSnapshot(apiBase, companyID, { scope: "company_explorer" });
        if (cancelled || !result.payload) return;
        applyCompanyExplorerSnapshot(result.payload as CompanyExplorerSnapshotPayload);
      } catch {
        // Explorer bootstrap stays independent from map graph snapshots; stream deltas can still catch up.
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, applyCompanyExplorerSnapshot, companyID]);

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
        if (shouldRefreshRaciExplorerProjectionForGap(gap, companyID)) requestRaciExplorerProjectionRefreshRef.current();
      },
      onEvent(event) {
        if (event.event !== "workspace" || event.data.length === 0) return;
        try {
          const envelope = JSON.parse(event.data) as CompanyExplorerWorkspaceStreamEnvelope;
          if (shouldInvalidateKanbanBoardListForExplorerEnvelope(companyID, envelope)) {
            invalidateKanbanBoardListCache(apiBase, companyID);
          }
          dispatchExplorerStore({ type: "applyWorkspaceEnvelope", companyID, envelope });
          if (shouldRefreshRaciExplorerProjectionForEnvelope(companyID, envelope)) requestRaciExplorerProjectionRefreshRef.current();
        } catch {
          // The stream is best-effort UI sync; the explicit refresh path remains available.
        }
      },
    });
  }, [apiBase, companyID, reconcileCompanyExplorerGap]);
  const scopedRootName = scopedRootFolderName.trim();
  const scopedKind = scopedRootName ? (scopedRootFolderKind ?? "logic_gate") : undefined;
  const scopedExplorerActive = Boolean(scopedKind && scopedRootName);
  const scopeViewsEnabled = !hideTopControls && !scopedExplorerActive;
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
    void listCompanyUserGroups(companyID)
      .then((payload) => {
        if (!cancelled) setGroupMembers(payload.members ?? []);
      })
      .catch(() => {
        if (!cancelled) setGroupMembers([]);
      });
    return () => { cancelled = true; };
  }, [companyID, scopeViewsEnabled]);
  const teamMemberUserIDs = useMemo(() => teamMemberUserIDsForCurrentUser(groupMembers, currentUserID), [currentUserID, groupMembers]);
  const scopedExplorerData = useMemo(() => filterCompanyExplorerDataForScope({
    scopeView: scopeViewsEnabled ? scopeView : "company",
    currentUserID,
    teamMemberUserIDs,
    nodes,
    logicGates,
    folders,
    folderItems,
  }), [currentUserID, folderItems, folders, groupMembers, logicGates, nodes, scopeView, scopeViewsEnabled, teamMemberUserIDs]);
  const raciExplorerActive = scopeViewsEnabled && scopeView === "mine" && currentUserID.trim().length > 0;
  const refreshRaciExplorerProjection = useCallback(async () => {
    const targetUserID = currentUserID.trim();
    if (!raciExplorerActive || !companyID || !targetUserID) return;
    const requestID = raciProjectionRequestIDRef.current + 1;
    raciProjectionRequestIDRef.current = requestID;
    try {
      const [projection, projectedLogicGates] = await Promise.all([
        listRacioMatrixProjectionRows({ apiBase, companyID, targetUserID, limit: RACI_PROJECTION_LIMIT }),
        listMyLogicGates({ apiBase, companyID, targetUserID, limit: RACI_PROJECTION_LIMIT }),
      ]);
      if (raciProjectionRequestIDRef.current !== requestID) return;
      setRaciProjectionRows(projection.rows ?? []);
      setRaciProjectionLogicGates((projectedLogicGates.logic_gates ?? []).map((logicGate) => toLogicGateCanvasRecord(logicGate) as ExplorerLogicGateRecord));
      setRaciProjectionLoaded(true);
    } catch (err) {
      if (raciProjectionRequestIDRef.current !== requestID) return;
      setRaciProjectionLoaded(false);
      setError(err instanceof Error ? err.message : "failed_to_load_raci_explorer_projection");
    }
  }, [apiBase, companyID, currentUserID, raciExplorerActive]);
  requestRaciExplorerProjectionRefreshRef.current = () => { void refreshRaciExplorerProjection(); };
  useEffect(() => {
    if (!raciExplorerActive) {
      raciProjectionRequestIDRef.current += 1;
      setRaciProjectionRows([]);
      setRaciProjectionLogicGates([]);
      setRaciProjectionLoaded(false);
      return undefined;
    }
    void refreshRaciExplorerProjection();
    return undefined;
  }, [raciExplorerActive, refreshRaciExplorerProjection]);
  useEffect(() => {
    if (!raciExplorerActive) return;
    setExpanded((previous) => {
      let changed = false;
      const next = new Set(previous);
      for (const folder of RACI_FOLDER_ROWS) {
        const treeID = raciFolderTreeID(folder.role);
        if (next.has(treeID)) continue;
        next.add(treeID);
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [raciExplorerActive]);
  const scopedRootFolder = useMemo(() => (
    scopedKind && scopedRootName
      ? findCompanyExplorerRootFolderByName(folders, scopedKind, scopedRootName)
      : null
  ), [folders, scopedKind, scopedRootName]);
  const scopedRootTreeID = scopedRootFolder ? `workspace-folder-${scopedRootFolder.folder_id}` : "";
  const effectiveExpanded = useMemo(() => {
    if (!scopedRootTreeID || expanded.has(scopedRootTreeID)) return expanded;
    return new Set(expanded).add(scopedRootTreeID);
  }, [expanded, scopedRootTreeID]);
  const projectedRaciExplorerData = useMemo(() => materializeRaciProjectionExplorerData({
    companyID,
    currentUserID,
    projectionRows: raciProjectionRows,
    projectedLogicGates: raciProjectionLogicGates,
    fallbackNodes: nodes,
    fallbackLogicGates: logicGates as ExplorerLogicGateRecord[],
  }), [companyID, currentUserID, logicGates, nodes, raciProjectionLogicGates, raciProjectionRows]);
  const raciExplorerData = useMemo(() => (
    raciProjectionLoaded
      ? projectedRaciExplorerData
      : { nodes: scopedExplorerData.nodes, logicGates: scopedExplorerData.logicGates }
  ), [projectedRaciExplorerData, raciProjectionLoaded, scopedExplorerData.logicGates, scopedExplorerData.nodes]);

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
    kanbanBoards,
    folders: scopedExplorerData.folders,
    folderItems: scopedExplorerData.folderItems,
    rootRowOrder,
    selectedTreeID,
    treeViewportHeight,
    treeScrollTop,
  });
  const scopedRootRow = scopedRootTreeID ? fullRowByID.get(scopedRootTreeID) : undefined;
  const baseTreeRows = useMemo(() => (
    raciExplorerActive
      ? buildRaciCompanyExplorerRows({
          expanded: effectiveExpanded,
          nodes: raciExplorerData.nodes,
          logicGates: raciExplorerData.logicGates,
          folderNodes: nodes,
          folderLogicGates: logicGates as ExplorerLogicGateRecord[],
          folders,
          folderItems,
          currentUserID,
        })
      : scopedExplorerActive
      ? (scopedRootFolder ? buildScopedCompanyExplorerTreeRows(fullTreeRows, scopedRootFolder.folder_id) : [])
      : hideMainExplorerRootFolders(fullTreeRows)
  ), [currentUserID, effectiveExpanded, folderItems, folders, fullTreeRows, logicGates, nodes, raciExplorerActive, raciExplorerData, scopedExplorerActive, scopedRootFolder]);
  const explorerSearchText = effectiveExplorerSearchQuery.trim();
  const explorerSearchActive = explorerSearchText.length > 0;
  const allExpandedSearchTreeRows = useMemo(() => {
    const expandedForSearch = new Set<string>(["folder-root"]);
    for (const folder of scopedExplorerData.folders) expandedForSearch.add(`workspace-folder-${folder.folder_id}`);
    const rows = buildCompanyExplorerTreeRows({
      expanded: expandedForSearch,
      nodes: scopedExplorerData.nodes,
      logicGates: scopedExplorerData.logicGates,
      kanbanBoards,
      folders: scopedExplorerData.folders,
      folderItems: scopedExplorerData.folderItems,
      rootRowOrder,
    });
    if (raciExplorerActive) {
      const raciExpanded = new Set(expandedForSearch);
      for (const folder of RACI_FOLDER_ROWS) raciExpanded.add(raciFolderTreeID(folder.role));
      for (const folder of folders) raciExpanded.add(`workspace-folder-${folder.folder_id}`);
      raciExpanded.add(raciNoLogicGateTreeID("other"));
      for (const logicGate of raciExplorerData.logicGates) {
        for (const role of logicGateRaciRolesForUser(logicGate, currentUserID)) {
          raciExpanded.add(raciLogicGateTreeID(role, logicGate.logic_gate_id));
        }
      }
      return buildRaciCompanyExplorerRows({
        expanded: raciExpanded,
        nodes: raciExplorerData.nodes,
        logicGates: raciExplorerData.logicGates,
        folderNodes: nodes,
        folderLogicGates: logicGates as ExplorerLogicGateRecord[],
        folders,
        folderItems,
        currentUserID,
      });
    }
    return scopedExplorerActive
      ? (scopedRootFolder ? buildScopedCompanyExplorerTreeRows(rows, scopedRootFolder.folder_id) : [])
      : hideMainExplorerRootFolders(rows);
  }, [currentUserID, folderItems, folders, kanbanBoards, logicGates, nodes, raciExplorerActive, raciExplorerData, rootRowOrder, scopedExplorerActive, scopedExplorerData, scopedRootFolder]);
  const explorerSearchViewRows = useMemo(() => (
    buildExplorerSearchViewRows({ rows: allExpandedSearchTreeRows, query: effectiveExplorerSearchQuery })
  ), [allExpandedSearchTreeRows, effectiveExplorerSearchQuery]);
  const explorerSearchResults = useMemo(() => (
    buildExplorerSearchResults({ rows: allExpandedSearchTreeRows, selectedRowID: "", query: effectiveExplorerSearchQuery, limit: 1 })
  ), [allExpandedSearchTreeRows, effectiveExplorerSearchQuery]);
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
    if (defaultExpansionAppliedRef.current) return;
    try {
      if (localStorage.getItem(expandedStorageKey) != null) {
        defaultExpansionAppliedRef.current = true;
        return;
      }
    } catch {
      // If local storage is blocked, still apply the first-open default.
    }
    const logicGateDefaultsRoot = folders.find((folder) =>
      folder.folder_kind === "logic_gate"
      && !folder.parent_folder_id
      && folder.name.trim().toLowerCase() === "logic gates"
    );
    if (!logicGateDefaultsRoot) return;
    defaultExpansionAppliedRef.current = true;
    setExpanded((previous) => {
      const next = new Set(previous);
      next.add(`workspace-folder-${logicGateDefaultsRoot.folder_id}`);
      return next;
    });
  }, [expandedStorageKey, folders]);

  useEffect(() => {
    if (!scopedRootTreeID) return;
    setExpanded((previous) => previous.has(scopedRootTreeID) ? previous : new Set(previous).add(scopedRootTreeID));
  }, [scopedRootTreeID]);

  useEffect(() => {
    try {
      localStorage.setItem(expandedStorageKey, JSON.stringify([...expanded]));
    } catch {
      // Expanded rows are per-device UI state; storage failure should not block navigation.
    }
  }, [expanded, expandedStorageKey]);

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

  const {
    closeFolderShareDialog,
    folderShareDialog,
    openFolderShareDialog,
    refreshFolderShares,
    removeFolderShare,
    submitFolderShare,
    updateFolderShareEmail,
  } = useCompanyExplorerFolderShares(companyID, requestJSON);

  useEffect(() => {
    if (!raciExplorerActive || !folderSnapshotLoaded || !companyID) return;
    const missing = RACI_FOLDER_ROWS.find((folder) => !raciVisualRootFolderForRole(folders, folder.role));
    if (!missing) return;
    const creationKey = `${companyID}:${missing.role}`;
    if (raciVisualRootCreationKeys.has(creationKey)) return;
    let cancelled = false;
    raciVisualRootCreationKeys.add(creationKey);
    requestJSON<CompanyExplorerFolder>("/v1/company-explorer/folders", {
      method: "POST",
      body: JSON.stringify({
        company_id: companyID,
        parent_folder_id: "",
        folder_kind: "logic_gate",
        name: raciVisualRootFolderName(missing.role),
      }),
    }).then((created) => {
      upsertCompanyExplorerFolderInNodeRelationshipGraph(apiBase, companyID, created);
      upsertCompanyExplorerFolderInLogicGateRelationshipGraph(apiBase, companyID, created);
      if (!cancelled) dispatchExplorerStore({ type: "upsertFolder", folder: created });
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "failed_to_create_raci_visual_folder");
    }).finally(() => {
      raciVisualRootCreationKeys.delete(creationKey);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase, companyID, folderSnapshotLoaded, folders, raciExplorerActive, requestJSON]);

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

  const createFolder = useCallback(async (folderKind: CompanyExplorerFolderKind, parentFolderID: string, position?: number) => {
    setError("");
    try {
      let folder = await requestJSON<CompanyExplorerFolder>("/v1/company-explorer/folders", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          parent_folder_id: parentFolderID,
          folder_kind: folderKind,
          name: "New Folder",
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
  }, [apiBase, companyID, requestJSON]);

  const assignItemsToFolders = useCallback(async (assignments: CompanyExplorerFolderItemAssignment[], options: { expandTarget?: boolean } = {}) => {
    const normalizedAssignments = assignments.filter((assignment) => (
      assignment.folder_id
      && assignment.item_id
      && assignment.item_type
      && assignment.item_type !== "kanban"
    ));
    if (normalizedAssignments.length === 0) return true;
    const previousFolderIDByKey = new Map(folderItems.map((row) => [`${row.item_type}:${row.item_id}`, row.folder_id]));
    setError("");
    try {
      const payload = await requestJSON<CompanyExplorerFolderItemsBatchResponse>("/v1/company-explorer/folder-items/batch", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          assignments: normalizedAssignments,
        }),
      });
      const items = payload.folder_items ?? [];
      dispatchExplorerStore({ type: "upsertFolderItems", folderItems: items });
      for (const item of items) {
        upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, item);
        upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase, companyID, item);
        if (previousFolderIDByKey.get(`${item.item_type}:${item.item_id}`) !== item.folder_id) {
          // Moving between folder levels starts a new local context. Drop stale
          // edges immediately; the API performs the same cleanup canonically.
          if (item.item_type === "node") removeNodeRelationshipGraphRelationshipsForNode(apiBase, companyID, item.item_id);
          else if (item.item_type === "logic_gate") removeLogicGateRelationshipGraphRelationshipsForLogicGate(apiBase, companyID, item.item_id);
        }
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
  }, [apiBase, companyID, folderItems, requestJSON]);

  const upsertOptimisticFolderItem = useCallback((item: CompanyExplorerFolderItem) => {
    dispatchExplorerStore({ type: "upsertFolderItems", folderItems: [item] });
    upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, item);
    upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase, companyID, item);
  }, [apiBase, companyID]);

  const expandCreatedItemTarget = useCallback((parentFolderID: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      next.add(parentFolderID ? `workspace-folder-${parentFolderID}` : "folder-root");
      return next;
    });
  }, []);

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
        folderID: targetLogicGateID ? "" : parentFolderID,
        mutationOrigin: "company_explorer",
        items: [{
          client_id: createWorkspaceEntityBatchClientID("explorer-node"),
          title: "new node",
          x: 120,
          y: 120,
          position,
        }],
        requestJSON,
      });
      const node = response.nodes?.[0];
      if (!node) throw new Error("node_batch_create_missing_node");
      for (const item of response.folder_items ?? []) upsertOptimisticFolderItem(item);
      const createdFolderID = response.folder_items?.find((item) => item.item_type === "node" && item.item_id === node.node_id)?.folder_id ?? parentFolderID;
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
        requestRaciExplorerProjectionRefreshRef.current();
      }
      if (!createdFolderID && position && position > 0) {
        setRootRowOrder((previous) => ({ ...previous, [`node-${node.node_id}`]: position }));
      }
      expandCreatedItemTarget(createdFolderID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_node");
    }
  }, [apiBase, companyID, expandCreatedItemTarget, requestJSON, upsertOptimisticFolderItem]);

  const createLogicGateAtFolder = useCallback(async (parentFolderID: string, position?: number, raciRole?: string) => {
    setError("");
    const creatorLogicGateRaciRole: WorkspaceEntityBatchCreatorLogicGateRaciRole | undefined = isLogicGateRaciRole(raciRole) ? raciRole : undefined;
    try {
      const response = await createWorkspaceEntityBatchCommand<CompanyExplorerWorkspaceEntityBatchResponse>({
        companyID,
        entityKind: "logic_gate",
        folderID: parentFolderID,
        mutationOrigin: "company_explorer",
        creatorLogicGateRaciRole,
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
      logicGate.raci_assignments = created.raci_assignments ?? [];
      for (const item of response.folder_items ?? []) upsertOptimisticFolderItem(item);
      const createdFolderID = response.folder_items?.find((item) => item.item_type === "logic_gate" && item.item_id === logicGate.logic_gate_id)?.folder_id ?? parentFolderID;
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
      if (creatorLogicGateRaciRole) requestRaciExplorerProjectionRefreshRef.current();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_logic_gate");
    }
  }, [apiBase, companyID, expandCreatedItemTarget, requestJSON, upsertOptimisticFolderItem]);

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
      const key = `${target.kind}:${target.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (normalizedTargets.length === 0) return;

    const deletedFolderIDs = new Set<string>();
    const deletedNodeIDs = new Set<string>();
    const deletedLogicGateIDs = new Set<string>();
    const deletedKanbanBoardIDs = new Set<string>();

    for (const target of normalizedTargets) {
      if (target.kind === "folder") {
        for (const id of collectFolderSubtreeIDs(folders, target.id)) deletedFolderIDs.add(id);
      } else if (target.kind === "node") {
        deletedNodeIDs.add(target.id);
      } else if (target.kind === "logic_gate") {
        deletedLogicGateIDs.add(target.id);
        deletedKanbanBoardIDs.add(logicGateKanbanBoardID(target.id));
      } else {
        deletedKanbanBoardIDs.add(target.id);
      }
    }
    for (const item of folderItems) {
      if (!deletedFolderIDs.has(item.folder_id)) continue;
      if (item.item_type === "node") {
        deletedNodeIDs.add(item.item_id);
      } else if (item.item_type === "logic_gate") {
        deletedLogicGateIDs.add(item.item_id);
        deletedKanbanBoardIDs.add(logicGateKanbanBoardID(item.item_id));
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
      deletedKanbanBoardIDs,
    });
    try {
      await requestJSON<CompanyExplorerDeleteBatchResponse>("/v1/company-explorer/delete-batch", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          targets: normalizedTargets.map((target) => ({
            kind: target.kind,
            id: target.id,
            folder_kind: target.kind === "folder" ? target.folderKind : undefined,
          })),
        }),
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
  }, [apiBase, companyID, explorerStore, folderItems, folders, kanbanBoards, requestJSON]);

  const getDeleteTargetsForRows = useCallback((rows: ExplorerTreeNode[]): ExplorerDeleteTargetWithLabel[] => {
    const selectedFolderIDs = new Set(rows.filter((row) => row.kind === "folder" && row.folderID && !isProtectedRaciRoleRow(row)).map((row) => row.folderID!));
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
    const isCoveredBySelectedAncestor = (row: ExplorerTreeNode): boolean => {
      if (row.kind === "folder") return Boolean(row.parentFolderID && isFolderCoveredBySelectedAncestor(row.parentFolderID));
      return Boolean(row.folderID && isFolderCoveredBySelectedAncestor(row.folderID));
    };
    const targets: ExplorerDeleteTargetWithLabel[] = [];
    const seenTargets = new Set<string>();
    for (const row of rows) {
      if (isProtectedRaciRoleRow(row)) continue;
      if (isCoveredBySelectedAncestor(row)) continue;
      const target = resolveExplorerDeleteTarget(row);
      if (!target) continue;
      const key = `${target.kind}:${target.id}`;
      if (seenTargets.has(key)) continue;
      seenTargets.add(key);
      targets.push({ ...target, label: row.label, treeID: row.id });
    }
    return targets;
  }, [folders]);

  const requestDeleteTargets = useCallback((targets: ExplorerDeleteTargetWithLabel[]) => {
    if (targets.length === 0) return;
    const protectedFolder = findProtectedSystemFolderInDeleteTargets(targets, folders);
    if (protectedFolder) {
      setExplorerContextMenu(null);
      setDeleteBlockedMessage(`We can't delete this folder because it contains the special folder: ${protectedFolder.name}`);
      return;
    }
    setExplorerContextMenu(null);
    setDeleteFolderAcknowledged(false);
    setDeleteConfirmation({ targets });
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
          body: JSON.stringify({ company_id: companyID, title: value }),
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
  }, [apiBase, companyID, renaming, requestJSON]);

  const moveFolder = useCallback(async (folderID: string, parentFolderID: string | undefined, options: { position?: number; expandTarget?: boolean; parentProvided?: boolean; targetExpanded?: boolean } = {}) => {
    if (!folderID || folderID === parentFolderID) return;
    setError("");
    try {
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
  }, [apiBase, companyID, requestJSON]);

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

  const emitExplorerEntityActivation = useCallback((row: ExplorerTreeNode) => {
    const kind = row.kind === "node" || row.kind === "logic_gate" ? row.kind : "";
    const id = kind === "node" ? (row.nodeID ?? "") : kind === "logic_gate" ? (row.logicGateID ?? "") : "";
    const cleanID = id.trim();
    if (!kind || !cleanID) return;
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
      companyID,
      sourceFrameID: scope,
      kind,
      id: cleanID,
      label: row.label,
      selectedTreeID: row.id,
      suppressNavigation: kind === "node",
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
    if (isProtectedRaciRoleRow(row)) return;
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
    } else {
      setSelectedLogicGateID(plan.primaryEntity.id);
      setSelectedNodeID("");
      setSelectedKanbanBoardID("");
    }
    pendingScrollAlignRef.current = "center";
    pendingScrollTreeIDRef.current = plan.primaryTreeID;
  }, [folderItems, folders, logicGates, nodes]);

  const selectExplorerSearchResult = useCallback((row: ExplorerTreeNode) => {
    treeKeyboardActiveRef.current = true;
    treeViewportRef.current?.focus({ preventScroll: true });
    expandTreeIDs([row.id]);
    setSelectedTreeID(row.id);
    setSelectedTreeIDs(new Set([row.id]));
    setSelectionAnchorTreeID(row.id);
    focusTreeRow(row, { selectionIntent: "activate" });
    emitExplorerEntityActivation(row);
    onSearchResultSelect?.();
    pendingScrollAlignRef.current = "center";
    pendingScrollTreeIDRef.current = row.id;
  }, [emitExplorerEntityActivation, expandTreeIDs, focusTreeRow, onSearchResultSelect]);

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
    setExpanded,
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

  const canPlaceExplorerItemsAtTarget = useCallback((payload: ExplorerDragPayload | null, target: ExplorerTreeNode): boolean => {
    const itemType = getExplorerDropPayloadItemType(payload);
    if (isProtectedRaciRoleRow(target)) return false;
    if (itemType === "kanban") return false;
    if (scopedAllowedItemType && itemType !== scopedAllowedItemType) return false;
    const targetKind = getExplorerRowOrderKind(target);
    const targetAcceptsItem = Boolean(itemType && targetKind);
    if (!itemType || !targetAcceptsItem) return false;
    const itemRows = getExplorerItemRowsForPayload(payload);
    if (itemRows.length === 0 || itemRows.some((row) => row.id === target.id)) return false;
    const targetContainer = getExplorerRowContainerID(target);
    if (targetContainer == null) return false;
    return targetContainer !== "" || itemRows.every((row) => getExplorerRowContainerID(row) === "");
  }, [getExplorerItemRowsForPayload, scopedAllowedItemType]);

  const canDropExplorerPayloadOnRow = useCallback((payload: ExplorerDragPayload | null, target: ExplorerTreeNode): boolean => {
    const itemType = getExplorerDropPayloadItemType(payload);
    if (!itemType || itemType === "kanban") return false;
    if (isProtectedRaciRoleRow(target)) return false;
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
      setError("");
      try {
        for (const item of nodeItems) {
          const nodeID = item.itemID.trim();
          const sourceRow = nodeRowsByID.get(nodeID);
          const fromLogicGateID = sourceRow?.parentLogicGateID?.trim() ?? "";
          if (fromLogicGateID === target.logicGateID) continue;
          const result = await moveLogicGateAssignment({
            apiBase,
            companyID,
            logicGateID: target.logicGateID,
            nodeID,
            fromLogicGateID: fromLogicGateID || undefined,
            mutationOrigin: "matrix",
          });
          dispatchExplorerStore({ type: "replaceNode", node: result.node });
          upsertNodeRelationshipGraphNode(apiBase, companyID, result.node);
        }
        setExpanded((previous) => new Set(previous).add(target.id));
        requestRaciExplorerProjectionRefreshRef.current();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "failed_to_move_node_to_logic_gate");
        return false;
      }
    }

    return false;
  }, [apiBase, companyID, getExplorerItemRowsForPayload]);

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
    if (isProtectedRaciRoleRow(target)) return false;
    if (!source || source.kind !== "folder" || !source.folderID || !source.folderKind || source.id === target.id) return false;
    if (getExplorerRowOrderKind(target) !== source.folderKind) return false;
    const targetContainer = getExplorerRowContainerID(target);
    if (targetContainer == null) return false;
    if (targetContainer === source.folderID || isFolderDescendantOf(targetContainer, source.folderID)) return false;
    return true;
  }, [isFolderDescendantOf]);

  const getReorderRowsForTarget = useCallback((source: ExplorerTreeNode, target: ExplorerTreeNode): ExplorerTreeNode[] => {
    if (isProtectedRaciRoleRow(source) || isProtectedRaciRoleRow(target)) return [];
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

    const itemAssignments: CompanyExplorerFolderItemAssignment[] = [];
    const folderMoves: Array<Promise<void>> = [];
    for (const { row, position } of updates) {
      if (row.kind === "folder" && row.folderID) {
        folderMoves.push(moveFolder(row.folderID, row.parentFolderID ?? "", { position, parentProvided: false }));
        continue;
      }
      const itemType: CompanyExplorerItemType | null = row.kind === "node" ? "node" : row.kind === "logic_gate" ? "logic_gate" : null;
      const itemID = row.kind === "node" ? row.nodeID : row.kind === "logic_gate" ? row.logicGateID : "";
      if (row.folderID && itemType && itemID) itemAssignments.push({ folder_id: row.folderID, item_type: itemType, item_id: itemID, position });
    }
    await Promise.all(folderMoves);
    if (itemAssignments.length > 0) await assignItemsToFolders(itemAssignments);
    return true;
  }, [assignItemsToFolders, getReorderRowsForTarget, moveFolder]);

  const placeExplorerFolderAtTarget = useCallback(async (source: ExplorerTreeNode, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => {
    if (!source.folderID || !source.folderKind || !canPlaceExplorerFolderAtTarget(source, target)) return false;
    const targetContainer = getExplorerRowContainerID(target);
    if (targetContainer == null) return false;

    const targetRows = baseTreeRows.filter((row) => getExplorerRowContainerID(row) === targetContainer && getExplorerRowOrderKind(row) === source.folderKind);
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
      const rowItemType: CompanyExplorerFolderKind | null = row.kind === "node" ? "node" : row.kind === "logic_gate" ? "logic_gate" : null;
      const itemID = row.kind === "node" ? row.nodeID : row.logicGateID;
      if (targetContainer && rowItemType && itemID) itemAssignments.push({ folder_id: targetContainer, item_type: rowItemType, item_id: itemID, position });
    }
    await Promise.all(folderMoves);
    if (itemAssignments.length > 0) await assignItemsToFolders(itemAssignments);
    return true;
  }, [assignItemsToFolders, baseTreeRows, canPlaceExplorerFolderAtTarget, moveFolder]);

  const placeExplorerItemsAtTarget = useCallback(async (payload: ExplorerDragPayload | null, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => {
    const itemType = getExplorerDropPayloadItemType(payload);
    if (itemType === "kanban") return false;
    const targetContainer = getExplorerRowContainerID(target);
    if (!itemType || targetContainer == null || !canPlaceExplorerItemsAtTarget(payload, target)) return false;

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

    const itemAssignments: CompanyExplorerFolderItemAssignment[] = [];
    const folderMoves: Array<Promise<void>> = [];
    for (const { row, position } of updates) {
      if (row.kind === "folder" && row.folderID) {
        folderMoves.push(moveFolder(row.folderID, row.parentFolderID ?? "", { position, parentProvided: false }));
        continue;
      }
      const rowItemType: CompanyExplorerItemType | null = row.kind === "node" ? "node" : row.kind === "logic_gate" ? "logic_gate" : null;
      const itemID = row.kind === "node" ? row.nodeID : row.kind === "logic_gate" ? row.logicGateID : "";
      if (targetContainer && rowItemType && itemID) itemAssignments.push({ folder_id: targetContainer, item_type: rowItemType, item_id: itemID, position });
    }
    await Promise.all(folderMoves);
    if (itemAssignments.length > 0) await assignItemsToFolders(itemAssignments);
    return true;
  }, [assignItemsToFolders, baseTreeRows, canPlaceExplorerItemsAtTarget, getExplorerItemRowsForPayload, moveFolder]);

  const assignExplorerPayloadItemsToFolder = useCallback(async (targetFolderID: string, itemType: CompanyExplorerItemType, payload: ExplorerDragPayload) => {
    if (itemType === "kanban") return;
    if (scopedAllowedItemType && itemType !== scopedAllowedItemType) return;
    const items = getExplorerDropPayloadItems(payload).filter((item) => item.itemType === itemType);
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
      assignments.push({ folder_id: targetFolderID, item_type: itemType, item_id: item.itemID, position });
    }
    await assignItemsToFolders(assignments, { expandTarget: true });
  }, [assignItemsToFolders, baseTreeRows, scopedAllowedItemType]);

  const requestMapFind = useCallback((target: ExplorerFindTarget) => {
    if (target.kind === "node") {
      emitDashboardEvent(EVENT_NODE_MAP_FOCUS_REQUESTED, {
        mapWidgetID: linkedMapFrameID,
        nodeID: target.id,
        sourceExplorerID: scope,
      });
      return;
    }
    emitDashboardEvent(EVENT_LOGIC_GATE_MAP_FOCUS_REQUESTED, {
      mapWidgetID: linkedLogicMapFrameID || linkedMapFrameID,
      logicGateID: target.id,
      sourceExplorerID: scope,
    });
  }, [linkedLogicMapFrameID, linkedMapFrameID, scope]);

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
    const creationRow = row ?? scopedRootRow;
    const protectedRaciRow = isProtectedRaciRoleRow(row);
    const canCreateForContext = !protectedRaciRow || Boolean(row?.folderID);
    const contextKind: CompanyExplorerFolderKind | null = creationRow?.folderKind ?? (creationRow?.kind === "node" ? "node" : creationRow?.kind === "logic_gate" ? "logic_gate" : null);
    const createNodeLogicGateID = creationRow?.kind === "logic_gate"
      ? (creationRow.logicGateID ?? "")
      : (creationRow?.parentLogicGateID ?? "");
    const createNodeLogicGateTreeID = creationRow?.kind === "logic_gate" && createNodeLogicGateID ? (creationRow.id ?? "") : "";
    const createLogicGateRaciRole = isLogicGateRaciRole(creationRow?.raciRole) ? creationRow.raciRole : "";
    const targets = resolveExplorerCreationTargets(creationRow ?? null);
    const deleteRows = row ? (selectedTreeIDs.has(row.id) ? treeRows.filter((candidate) => selectedTreeIDs.has(candidate.id)) : [row]) : [];
    const deleteTargets = getDeleteTargetsForRows(deleteRows);
    const shareTarget = !protectedRaciRow && row?.kind === "folder" && row.folderID && !row.systemKey
      ? { folderID: row.folderID, label: row.label }
      : null;
    const pinTarget: ExplorerPinTarget | null = row?.kind === "node" && row.nodeID
      ? { kind: "node", id: row.nodeID, label: row.label }
      : row?.kind === "logic_gate" && row.logicGateID
        ? { kind: "logic_gate", id: row.logicGateID, label: row.label }
        : null;
    setExplorerContextMenu({
      x: event.clientX,
      y: event.clientY,
      targets,
      deleteTarget: protectedRaciRow ? null : (deleteTargets[0] ?? resolveExplorerDeleteTarget(row ?? null)),
      deleteTargets,
      renameTarget: protectedRaciRow ? null : resolveExplorerRenameTarget(row ?? null),
      findTarget: getExplorerFindTarget(row ?? null),
      pinTarget,
      shareTarget,
      renameTreeID: row?.id ?? "",
      renameLabel: row?.label ?? "",
      contextKind,
      createPosition: getContextCreatePosition(row, event),
      createNodeLogicGateID,
      createNodeLogicGateTreeID,
      createLogicGateRaciRole,
      canCreateBothFolderTypes: !contextKind && !scopedKind,
      canCreateFolder: canCreateForContext && (!scopedKind || Boolean(scopedRootFolder)),
      canCreateNode: canCreateForContext && !scopedKind,
      canCreateLogicGate: canCreateForContext && (scopedKind ? scopedKind === "logic_gate" && Boolean(scopedRootFolder) : true),
    });
  }, [focusTreeRow, getContextCreatePosition, getDeleteTargetsForRows, scopedKind, scopedRootFolder, scopedRootRow, selectTreeRow, selectedTreeIDs, treeRows]);

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
  const explorerMenuButtonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    width: "100%",
    padding: "9px 14px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: "var(--mango-font-family)",
    fontSize: 12,
    fontWeight: 700,
    textAlign: "left",
  };
  const scopeToggleStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 4,
    minWidth: 0,
  };
  const scopeButtonStyle = (active: boolean): React.CSSProperties => ({
    minWidth: 0,
    height: 28,
    border: `1px solid ${active ? "rgba(71, 85, 105, 0.72)" : "rgba(148, 163, 184, 0.34)"}`,
    borderRadius: 7,
    background: active ? "rgba(71, 85, 105, 0.14)" : "rgba(255, 255, 255, 0.82)",
    color: "#111827",
    cursor: "pointer",
    fontFamily: "var(--mango-font-family)",
    fontSize: 11,
    fontWeight: active ? 760 : 620,
    letterSpacing: 0,
    padding: "0 6px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  const scopeControls = scopeViewsEnabled ? (
    <div data-frame-interactive="true" style={scopeToggleStyle} aria-label="Company Explorer view scope">
      <button type="button" style={scopeButtonStyle(scopeView === "mine")} onClick={() => setScopeView("mine")}>My</button>
      <button type="button" style={scopeButtonStyle(scopeView === "teams")} onClick={() => setScopeView("teams")}>Teams</button>
      <button type="button" style={scopeButtonStyle(scopeView === "company")} onClick={() => setScopeView("company")}>Company</button>
    </div>
  ) : undefined;

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
        explorerSearchQuery={effectiveExplorerSearchQuery}
        explorerSearchActive={explorerSearchActive}
        explorerSearchResult={explorerSearchResults[0] ?? null}
        draggingTreeID={draggingTreeID}
        dragOverTreeID={dragOverTreeID}
        dragOverPlacement={dragOverPlacement}
        dragPayload={dragPayload}
        renaming={renaming}
        renameInputRef={renameInputRef}
        cancelRenameOnBlurRef={cancelRenameOnBlurRef}
        onTreeKeyDown={handleTreeKeyDown}
        onScrollTopChange={setTreeScrollTop}
        onCloseContextMenu={() => setExplorerContextMenu(null)}
        onOpenContextMenu={openExplorerContextMenu}
        onSetExplorerSearchQuery={setExplorerSearchQuery}
        onSelectExplorerSearchResult={selectExplorerSearchResult}
        onSelectTreeRow={selectTreeRow}
        onStartRenamingRow={startRenamingRow}
        onCommitRename={commitRename}
        onSetRenaming={setRenaming}
        onSetExpanded={setExpanded}
        onSetDraggingTreeID={setDraggingTreeID}
        onSetDragOverTreeID={setDragOverTreeID}
        onSetDragOverPlacement={setDragOverPlacement}
        onSetDragPayload={setDragPayload}
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

      <CompanyExplorerContextMenu
        menu={explorerContextMenu}
        buttonStyle={explorerMenuButtonStyle}
        onClose={() => setExplorerContextMenu(null)}
        onCreateFolder={(folderKind, parentFolderID, position) => {
          void createFolder(folderKind, parentFolderID, position);
          setExplorerContextMenu(null);
        }}
        onCreateNode={(parentFolderID, position, logicGateID, logicGateTreeID, priority) => {
          void createNodeAtFolder(parentFolderID, position, logicGateID, logicGateTreeID, priority);
          setExplorerContextMenu(null);
        }}
        onCreateLogicGate={(parentFolderID, position, raciRole) => {
          void createLogicGateAtFolder(parentFolderID, position, raciRole);
          setExplorerContextMenu(null);
        }}
        onFindTarget={(target) => {
          setExplorerContextMenu(null);
          requestMapFind(target);
        }}
        onPinTarget={(target) => {
          setExplorerContextMenu(null);
          requestAppSidebarPin(target);
        }}
        onShareFolder={(target) => {
          setExplorerContextMenu(null);
          openFolderShareDialog(target);
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

      {folderShareDialog && (
        <CompanyExplorerFolderShareDialogView
          dialog={folderShareDialog}
          isDarkTheme={isDarkTheme}
          ruleColor={ruleColor}
          rowRuleColor={rowRuleColor}
          onEmailChange={updateFolderShareEmail}
          onSubmit={() => void submitFolderShare()}
          onRemoveShare={(share) => void removeFolderShare(share)}
          onClose={closeFolderShareDialog}
          onRefresh={refreshFolderShares}
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
