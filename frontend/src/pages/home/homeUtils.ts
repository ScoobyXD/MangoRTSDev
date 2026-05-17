import type { CommunicationsSharedInbox, EmailAddress, EmailMailbox, EmailMessage, UserLogicGateShortcut } from "../../modules/communications/communicationsApi.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../modules/folders/companyExplorerFolders.js";
import { collectFolderSubtreeIDs, EXPLORER_DRAG_MIME } from "../../modules/company-explorer/companyExplorerDragDrop.js";
import { getExplorerDropPayloadItems } from "../../modules/company-explorer/treePresentation.js";
import type { ExplorerDragPayload, ExplorerTreeNode } from "../../modules/company-explorer/companyExplorerTypes.js";
import type { LogicGateRaciRole, LogicGateRecord } from "../../modules/logic-gate-map/shared.js";
import { getNodeTitle, type NodeRecord } from "../../modules/node-map/shared.js";
import { attachStackedDragPreview, KANBAN_LOGIC_GATE_DONE_COLOR, KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR, KANBAN_LOGIC_GATE_PENDING_COLOR } from "../../modules/kanban/shared.js";
import { ACI_COLUMNS, HOME_COLUMN_MAX_WIDTHS, HOME_COLUMN_MIN_WIDTHS, HOME_COLUMN_RESIZER_WIDTH, HOME_COLUMN_WIDTHS_STORAGE_KEY, MAILBOX_OPTIONS, TRIAGE_MESSAGE_DRAG_MIME } from "./homeConstants.js";
import type { AciInboxRole, HomeColumnWidths, HomeViewID, InboxLogicGateNodeGroup, InboxPriority, MyLogicGateGroup, ResponsibleInboxStatus } from "./homeTypes.js";
export function readHomeColumnWidths(): HomeColumnWidths {
  try {
    const parsed = JSON.parse(localStorage.getItem(HOME_COLUMN_WIDTHS_STORAGE_KEY) ?? "null") as unknown;
    if (isHomeColumnWidths(parsed)) {
      return normalizeHomeColumnWidths(parsed as HomeColumnWidths);
    }
  } catch {
    // Stored UI preferences are optional; fall back to viewport-aware defaults.
  }
  return defaultHomeColumnWidths();
}

export function saveHomeColumnWidths(widths: HomeColumnWidths): void {
  try {
    localStorage.setItem(HOME_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch {}
}

export function isHomeColumnWidths(value: unknown): value is HomeColumnWidths {
  return Array.isArray(value) && value.length === 4 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

export function defaultHomeColumnWidths(): HomeColumnWidths {
  const availableWidth = Math.max(1120, window.innerWidth - 52 - HOME_COLUMN_RESIZER_WIDTH * 3);
  const sidebarWidth = 220;
  const listWidth = 350;
  const logicGateWidth = 340;
  const detailWidth = clampNumber(availableWidth - sidebarWidth - listWidth - logicGateWidth, 360, 820);
  return normalizeHomeColumnWidths([sidebarWidth, listWidth, detailWidth, logicGateWidth]);
}

export function normalizeHomeColumnWidths(widths: HomeColumnWidths): HomeColumnWidths {
  return [
    clampNumber(widths[0], HOME_COLUMN_MIN_WIDTHS[0], HOME_COLUMN_MAX_WIDTHS[0]),
    clampNumber(widths[1], HOME_COLUMN_MIN_WIDTHS[1], HOME_COLUMN_MAX_WIDTHS[1]),
    clampNumber(widths[2], HOME_COLUMN_MIN_WIDTHS[2], HOME_COLUMN_MAX_WIDTHS[2]),
    clampNumber(widths[3], HOME_COLUMN_MIN_WIDTHS[3], HOME_COLUMN_MAX_WIDTHS[3]),
  ];
}

export function resizeHomeColumns(startWidths: HomeColumnWidths, dividerIndex: 0 | 1 | 2, delta: number, availableWidth: number): HomeColumnWidths {
  const next: HomeColumnWidths = [startWidths[0], startWidths[1], startWidths[2], startWidths[3]];
  const resizerTotal = HOME_COLUMN_RESIZER_WIDTH * 3;

  if (dividerIndex === 0) {
    const pairTotal = startWidths[0] + startWidths[1];
    const maxLeft = Math.min(HOME_COLUMN_MAX_WIDTHS[0], pairTotal - HOME_COLUMN_MIN_WIDTHS[1]);
    next[0] = clampNumber(startWidths[0] + delta, HOME_COLUMN_MIN_WIDTHS[0], maxLeft);
    next[1] = pairTotal - next[0];
  } else if (dividerIndex === 1) {
    const maxListFromViewport = availableWidth - next[0] - next[3] - resizerTotal - HOME_COLUMN_MIN_WIDTHS[2];
    const maxList = Math.min(HOME_COLUMN_MAX_WIDTHS[1], Math.max(HOME_COLUMN_MIN_WIDTHS[1], maxListFromViewport));
    next[1] = clampNumber(startWidths[1] + delta, HOME_COLUMN_MIN_WIDTHS[1], maxList);
  } else {
    const maxRailFromViewport = availableWidth - next[0] - next[1] - resizerTotal - HOME_COLUMN_MIN_WIDTHS[2];
    const maxRail = Math.min(HOME_COLUMN_MAX_WIDTHS[3], Math.max(HOME_COLUMN_MIN_WIDTHS[3], maxRailFromViewport));
    next[3] = clampNumber(startWidths[3] - delta, HOME_COLUMN_MIN_WIDTHS[3], maxRail);
  }

  next[2] = Math.max(HOME_COLUMN_MIN_WIDTHS[2], availableWidth - next[0] - next[1] - next[3] - resizerTotal);
  return normalizeHomeColumnWidths(next);
}

export function resizeHomeColumnsWithoutSidebar(startWidths: HomeColumnWidths, dividerIndex: 0 | 1 | 2, delta: number, availableWidth: number): HomeColumnWidths {
  const next: HomeColumnWidths = [startWidths[0], startWidths[1], startWidths[2], startWidths[3]];
  const resizerTotal = HOME_COLUMN_RESIZER_WIDTH * 2;

  if (dividerIndex === 1) {
    const maxList = Math.min(
      HOME_COLUMN_MAX_WIDTHS[1],
      Math.max(HOME_COLUMN_MIN_WIDTHS[1], availableWidth - next[3] - resizerTotal - HOME_COLUMN_MIN_WIDTHS[2]),
    );
    next[1] = clampNumber(startWidths[1] + delta, HOME_COLUMN_MIN_WIDTHS[1], maxList);
  } else if (dividerIndex === 2) {
    const maxRail = Math.min(
      HOME_COLUMN_MAX_WIDTHS[3],
      Math.max(HOME_COLUMN_MIN_WIDTHS[3], availableWidth - next[1] - resizerTotal - HOME_COLUMN_MIN_WIDTHS[2]),
    );
    next[3] = clampNumber(startWidths[3] - delta, HOME_COLUMN_MIN_WIDTHS[3], maxRail);
  }

  next[2] = Math.max(HOME_COLUMN_MIN_WIDTHS[2], availableWidth - next[1] - next[3] - resizerTotal);
  return normalizeHomeColumnWidths(next);
}

export function resizeHomeInboxMatrixColumnsWithoutSidebar(startWidths: HomeColumnWidths, dividerIndex: 0 | 1 | 2, delta: number, availableWidth: number): HomeColumnWidths {
  const next: HomeColumnWidths = [startWidths[0], startWidths[1], startWidths[2], startWidths[3]];
  if (dividerIndex !== 2) return normalizeHomeColumnWidths(next);

  const maxRail = Math.min(
    HOME_COLUMN_MAX_WIDTHS[3],
    Math.max(HOME_COLUMN_MIN_WIDTHS[3], availableWidth - HOME_COLUMN_RESIZER_WIDTH - 760),
  );
  next[3] = clampNumber(startWidths[3] - delta, HOME_COLUMN_MIN_WIDTHS[3], maxRail);
  next[2] = Math.max(760, availableWidth - next[3] - HOME_COLUMN_RESIZER_WIDTH);
  return normalizeHomeColumnWidths(next);
}

export function getHomeGridTemplateColumns(widths: HomeColumnWidths): string {
  return [
    `${widths[0]}px`,
    `${HOME_COLUMN_RESIZER_WIDTH}px`,
    `${widths[1]}px`,
    `${HOME_COLUMN_RESIZER_WIDTH}px`,
    `minmax(${HOME_COLUMN_MIN_WIDTHS[2]}px, 1fr)`,
    `${HOME_COLUMN_RESIZER_WIDTH}px`,
    `${widths[3]}px`,
  ].join(" ");
}

export function getHomeGridTemplateColumnsWithoutSidebar(widths: HomeColumnWidths): string {
  return [
    `${widths[1]}px`,
    `${HOME_COLUMN_RESIZER_WIDTH}px`,
    `minmax(${HOME_COLUMN_MIN_WIDTHS[2]}px, 1fr)`,
    `${HOME_COLUMN_RESIZER_WIDTH}px`,
    `${widths[3]}px`,
  ].join(" ");
}

export function getHomeWorkspaceTrackWidth(element: HTMLElement | null): number {
  if (!element) return Math.max(1, window.innerWidth - 20);
  const styles = window.getComputedStyle(element);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
  return Math.max(1, element.clientWidth - paddingLeft - paddingRight);
}

export function getInboxMatrixGridTemplateColumns(widths: HomeColumnWidths): string {
  return [
    `${widths[0]}px`,
    "minmax(760px, 1fr)",
    `${widths[3]}px`,
  ].join(" ");
}

export function getInboxMatrixGridTemplateColumnsWithoutSidebar(widths: HomeColumnWidths): string {
  return [
    "minmax(760px, 1fr)",
    `${HOME_COLUMN_RESIZER_WIDTH}px`,
    `${widths[3]}px`,
  ].join(" ");
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function readTriageMessageIDs(dataTransfer: DataTransfer): string[] {
  try {
    const raw = dataTransfer.getData(TRIAGE_MESSAGE_DRAG_MIME);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { kind?: string; message_ids?: unknown };
    if (parsed.kind !== "triage_messages" || !Array.isArray(parsed.message_ids)) return [];
    return cleanIDList(parsed.message_ids.filter((value): value is string => typeof value === "string"));
  } catch {
    return [];
  }
}

export function hasTriageMessageDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(TRIAGE_MESSAGE_DRAG_MIME);
}

export function hasExplorerDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(EXPLORER_DRAG_MIME);
}

export function cleanIDList(values: string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    ids.push(clean);
  }
  return ids;
}

export function logicGateTreeID(logicGateID: string): string {
  return `logic-gate-${logicGateID.trim()}`;
}

export function logicGateIDFromTreeID(treeID: string): string {
  const prefix = "logic-gate-";
  const value = treeID.trim();
  return value.startsWith(prefix) ? value.slice(prefix.length).trim() : "";
}

export function logicGateTitle(logicGate?: Pick<LogicGateRecord, "header" | "logic_gate_id">): string {
  return logicGate?.header?.trim() || logicGate?.logic_gate_id || "Logic Gate";
}

export function buildLogicGateExplorerPayload(logicGateIDs: string[]): ExplorerDragPayload | null {
  const ids = cleanIDList(logicGateIDs);
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    return {
      kind: "logic_gate",
      itemID: ids[0],
      itemType: "logic_gate",
      sourceTreeID: logicGateTreeID(ids[0]),
    };
  }
  return {
    kind: "batch",
    itemType: "logic_gate",
    items: ids.map((logicGateID) => ({
      itemID: logicGateID,
      itemType: "logic_gate",
      treeID: logicGateTreeID(logicGateID),
    })),
  };
}

export function setLogicGateDragData(dataTransfer: DataTransfer, logicGateIDs: string[], logicGateByID: Map<string, LogicGateRecord>): void {
  const payload = buildLogicGateExplorerPayload(logicGateIDs);
  if (!payload) return;
  const ids = cleanIDList(logicGateIDs);
  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", ids.length === 1 ? logicGateTitle(logicGateByID.get(ids[0])) : `${ids.length} Logic Gates`);
  attachStackedDragPreview(
    dataTransfer,
    ids.map((logicGateID) => ({ label: logicGateTitle(logicGateByID.get(logicGateID)), color: "#ff8820" })),
    "#ff8820",
    "Logic Gates",
  );
}

export function nodeTreeID(nodeID: string): string {
  return `node-${nodeID.trim()}`;
}

export function nodeIDFromTreeID(treeID: string): string {
  const value = treeID.trim();
  const prefixes = ["node-", "system-active-node-", "system-history-node-"];
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) return value.slice(prefix.length).trim();
  }
  return "";
}

export function nodeTitle(node?: Pick<NodeRecord, "title" | "node_id">): string {
  return node ? getNodeTitle(node) || node.node_id : "Node";
}

export function inboxLogicGateLabel(logicGateID: string, logicGateByID: Map<string, LogicGateRecord>): string {
  const logicGate = logicGateByID.get(logicGateID);
  return logicGate ? logicGateTitle(logicGate) : logicGateID || "Logic Gate";
}

export function logicGateHasRaciRole(logicGate: LogicGateRecord | undefined, role: LogicGateRaciRole, userID: string): boolean {
  const cleanUserID = userID.trim();
  if (!logicGate || !cleanUserID) return false;
  return (logicGate.raci_assignments ?? []).some((assignment) => assignment.role === role && assignment.user_id?.trim() === cleanUserID);
}

export function nodeHasLogicGateRaciRole(node: NodeRecord, logicGateByID: Map<string, LogicGateRecord>, role: LogicGateRaciRole, userID: string): boolean {
  return cleanIDList(node.logic_gate_ids ?? []).some((logicGateID) => logicGateHasRaciRole(logicGateByID.get(logicGateID), role, userID));
}

export function addRaciInboxGroupNode(byCell: Map<string, Map<string, Set<string>>>, cellKey: string, logicGateID: string, nodeID: string): void {
  const byLogicGate = byCell.get(cellKey) ?? new Map<string, Set<string>>();
  const nodeIDs = byLogicGate.get(logicGateID) ?? new Set<string>();
  nodeIDs.add(nodeID);
  byLogicGate.set(logicGateID, nodeIDs);
  byCell.set(cellKey, byLogicGate);
}

export function materializeRaciInboxGroupsByCell(
  byCell: Map<string, Map<string, Set<string>>>,
  nodeByID: Map<string, NodeRecord>,
  logicGateByID: Map<string, LogicGateRecord>,
): Map<string, InboxLogicGateNodeGroup[]> {
  const out = new Map<string, InboxLogicGateNodeGroup[]>();
  for (const [cellKey, byLogicGate] of byCell.entries()) {
    const groups = Array.from(byLogicGate.entries())
      .map(([logicGateID, childIDs]) => ({
        logicGateID,
        label: inboxLogicGateLabel(logicGateID, logicGateByID),
        nodeIDs: Array.from(childIDs).sort((a, b) => nodeTitle(nodeByID.get(a)).localeCompare(nodeTitle(nodeByID.get(b)), undefined, { numeric: true, sensitivity: "base" }) || a.localeCompare(b)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }) || a.logicGateID.localeCompare(b.logicGateID));
    out.set(cellKey, groups);
  }
  return out;
}

export function buildAciInboxGroupsByCell(
  nodes: NodeRecord[],
  nodeByID: Map<string, NodeRecord>,
  logicGateByID: Map<string, LogicGateRecord>,
  currentUserID: string,
): Map<string, InboxLogicGateNodeGroup[]> {
  const byCell = new Map<string, Map<string, Set<string>>>();
  for (const node of nodes) {
    const priority = normalizeInboxPriority(node.priority);
    if (priority === null) continue;
    for (const logicGateID of cleanIDList(node.logic_gate_ids ?? [])) {
      const logicGate = logicGateByID.get(logicGateID);
      for (const column of ACI_COLUMNS) {
        if (!logicGateHasRaciRole(logicGate, column.role, currentUserID)) continue;
        addRaciInboxGroupNode(byCell, aciCellKey(column.role, priority), logicGateID, node.node_id);
      }
    }
  }
  return materializeRaciInboxGroupsByCell(byCell, nodeByID, logicGateByID);
}

export function buildResponsibleInboxGroupsByCell(
  nodes: NodeRecord[],
  nodeByID: Map<string, NodeRecord>,
  logicGateByID: Map<string, LogicGateRecord>,
  currentUserID: string,
): Map<string, InboxLogicGateNodeGroup[]> {
  const byCell = new Map<string, Map<string, Set<string>>>();
  for (const node of nodes) {
    const priority = normalizeInboxPriority(node.priority);
    const status = normalizeResponsibleInboxStatus(node.status);
    if (priority === null || !status) continue;
    for (const logicGateID of cleanIDList(node.logic_gate_ids ?? [])) {
      const logicGate = logicGateByID.get(logicGateID);
      if (!logicGateHasRaciRole(logicGate, "responsible", currentUserID)) continue;
      addRaciInboxGroupNode(byCell, responsibleCellKey(status, priority), logicGateID, node.node_id);
    }
  }
  return materializeRaciInboxGroupsByCell(byCell, nodeByID, logicGateByID);
}

export function sortNodesForInbox(nodes: NodeRecord[]): NodeRecord[] {
  return [...nodes].sort((a, b) => {
    const priorityA = inboxPrioritySortRank(normalizeInboxPriority(a.priority));
    const priorityB = inboxPrioritySortRank(normalizeInboxPriority(b.priority));
    return priorityA - priorityB
      || nodeTitle(a).localeCompare(nodeTitle(b), undefined, { numeric: true, sensitivity: "base" })
      || a.node_id.localeCompare(b.node_id);
  });
}

export function inboxPrioritySortRank(priority: InboxPriority | null): number {
  if (priority === null) return Number.MAX_SAFE_INTEGER;
  return priority === 0 ? 6 : priority;
}

export function buildNodeExplorerPayload(nodeIDs: string[]): ExplorerDragPayload | null {
  const ids = cleanIDList(nodeIDs);
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    return {
      kind: "node",
      itemID: ids[0],
      itemType: "node",
      sourceTreeID: nodeTreeID(ids[0]),
    };
  }
  return {
    kind: "batch",
    itemType: "node",
    items: ids.map((nodeID) => ({
      itemID: nodeID,
      itemType: "node",
      treeID: nodeTreeID(nodeID),
    })),
  };
}

export function setNodeDragData(dataTransfer: DataTransfer, nodeIDs: string[], nodeByID: Map<string, NodeRecord>): void {
  const payload = buildNodeExplorerPayload(nodeIDs);
  if (!payload) return;
  const ids = cleanIDList(nodeIDs);
  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", ids.length === 1 ? nodeTitle(nodeByID.get(ids[0])) : `${ids.length} nodes`);
  attachStackedDragPreview(
    dataTransfer,
    ids.map((nodeID) => ({ label: nodeTitle(nodeByID.get(nodeID)), color: "#ff8820" })),
    "#ff8820",
    "Nodes",
  );
}

export function aciCellKey(role: AciInboxRole, priority: InboxPriority): string {
  return `${role}:${priority}`;
}

export function responsibleCellKey(status: ResponsibleInboxStatus, priority: InboxPriority): string {
  return `${status}:${priority}`;
}

export function normalizeInboxPriority(value: unknown): InboxPriority | null {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string" && value.trim() === "") return 0;
  const priority = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(priority)) return null;
  const rounded = Math.round(priority);
  return rounded >= 0 && rounded <= 5 ? rounded as InboxPriority : null;
}

export function normalizeResponsibleInboxStatus(value: unknown): ResponsibleInboxStatus | null {
  const status = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s_-]+/g, " ") : "";
  if (status === "pending" || status === "p") return "pending";
  if (status === "in progress" || status === "ip") return "in_progress";
  if (status === "done" || status === "d") return "done";
  return null;
}

export function responsibleStatusColor(status: ResponsibleInboxStatus): string {
  if (status === "pending") return KANBAN_LOGIC_GATE_PENDING_COLOR;
  if (status === "in_progress") return KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR;
  return KANBAN_LOGIC_GATE_DONE_COLOR;
}

export function responsibleStatusLetter(value: unknown): string {
  const status = normalizeResponsibleInboxStatus(value);
  if (status === "pending") return "P";
  if (status === "in_progress") return "IP";
  if (status === "done") return "D";
  return "";
}

export function logicGateIDsFromExplorerPayload(payload: ExplorerDragPayload | null, folders: CompanyExplorerFolder[], folderItems: CompanyExplorerFolderItem[]): string[] {
  if (!payload) return [];
  if (payload.kind === "logic_gate" && payload.itemID) return [payload.itemID];
  if (payload.kind === "batch") {
    return cleanIDList(getExplorerDropPayloadItems(payload)
      .filter((item) => item.itemType === "logic_gate")
      .map((item) => item.itemID));
  }
  if (payload.kind === "folder" && payload.folderKind === "logic_gate" && payload.folderID) {
    const subtree = collectFolderSubtreeIDs(folders, payload.folderID);
    return cleanIDList(folderItems
      .filter((item) => item.item_type === "logic_gate" && subtree.has(item.folder_id))
      .map((item) => item.item_id));
  }
  return [];
}

export function sortLogicGateShortcuts(shortcuts: UserLogicGateShortcut[]): UserLogicGateShortcut[] {
  return [...shortcuts].sort((a, b) => a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp) || a.logic_gate_id.localeCompare(b.logic_gate_id));
}

export function mergeLogicGateShortcuts(current: UserLogicGateShortcut[], incoming: UserLogicGateShortcut[]): UserLogicGateShortcut[] {
  const byID = new Map(current.map((shortcut) => [shortcut.logic_gate_id, shortcut]));
  for (const shortcut of incoming) byID.set(shortcut.logic_gate_id, shortcut);
  return sortLogicGateShortcuts(Array.from(byID.values()));
}

export function buildMyLogicGateGroups(input: {
  shortcuts: UserLogicGateShortcut[];
  logicGateByID: Map<string, LogicGateRecord>;
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
}): MyLogicGateGroup[] {
  const folderByID = new Map(input.folders.map((folder) => [folder.folder_id, folder]));
  const folderIDByLogicGateID = new Map(input.folderItems.filter((item) => item.item_type === "logic_gate").map((item) => [item.item_id, item.folder_id]));
  const groupByKey = new Map<string, MyLogicGateGroup>();
  for (const shortcut of sortLogicGateShortcuts(input.shortcuts)) {
    const logicGate = input.logicGateByID.get(shortcut.logic_gate_id);
    if (!logicGate) continue;
    const folderID = folderIDByLogicGateID.get(shortcut.logic_gate_id) ?? "";
    const key = folderID || "unfiled";
    const group = groupByKey.get(key) ?? {
      key,
      label: folderID ? folderPathLabel(folderByID, folderID) : "Unfiled Logic Gates",
      logicGates: [],
    };
    group.logicGates.push(logicGate);
    groupByKey.set(key, group);
  }
  return Array.from(groupByKey.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function folderPathLabel(folderByID: Map<string, CompanyExplorerFolder>, folderID: string): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let currentID = folderID;
  while (currentID && !seen.has(currentID)) {
    seen.add(currentID);
    const folder = folderByID.get(currentID);
    if (!folder) break;
    names.push(folder.name);
    currentID = folder.parent_folder_id ?? "";
  }
  return names.reverse().join(" / ") || "Logic Gates";
}

export function filterExplorerRowsForSearch(rows: ExplorerTreeNode[], rawQuery: string): ExplorerTreeNode[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return rows;
  const included = new Set<string>();
  const includeDescendants = (startIndex: number) => {
    const parent = rows[startIndex];
    included.add(parent.id);
    for (let index = startIndex + 1; index < rows.length; index += 1) {
      if (rows[index].depth <= parent.depth) break;
      included.add(rows[index].id);
    }
  };
  const includeAncestors = (startIndex: number) => {
    let depth = rows[startIndex].depth;
    for (let index = startIndex - 1; index >= 0 && depth > 0; index -= 1) {
      const row = rows[index];
      if (row.depth >= depth) continue;
      included.add(row.id);
      depth = row.depth;
    }
  };
  rows.forEach((row, index) => {
    const text = [row.label, row.folderLabel, row.nodeID, row.logicGateID, row.folderID].join(" ").toLowerCase();
    if (!text.includes(query)) return;
    included.add(row.id);
    includeAncestors(index);
    if (row.kind === "folder") includeDescendants(index);
  });
  return rows.filter((row) => included.has(row.id));
}

export type SharedInboxDropPlacement = "before" | "after" | "inside";

export type SharedInboxTreeRow = {
  folder: CommunicationsSharedInbox;
  depth: number;
  treeID: HomeViewID;
  hasChildren: boolean;
};

const SHARED_INBOX_POSITION_STEP = 1000;

export function sharedInboxTreeID(folderID: string): HomeViewID {
  return `shared:${folderID.trim()}`;
}

export function buildSharedInboxRows(folders: CommunicationsSharedInbox[], expandedFolderIDs?: Set<string>): SharedInboxTreeRow[] {
  const byParent = new Map<string, CommunicationsSharedInbox[]>();
  const childCounts = new Map<string, number>();
  for (const folder of sortSharedInboxes(folders)) {
    const key = folder.parent_folder_id ?? "";
    const bucket = byParent.get(key) ?? [];
    bucket.push(folder);
    byParent.set(key, bucket);
    if (key) childCounts.set(key, (childCounts.get(key) ?? 0) + 1);
  }
  const rows: SharedInboxTreeRow[] = [];
  const visit = (parentID: string, depth: number, seen: Set<string>) => {
    for (const folder of byParent.get(parentID) ?? []) {
      if (seen.has(folder.folder_id)) continue;
      rows.push({
        folder,
        depth,
        treeID: sharedInboxTreeID(folder.folder_id),
        hasChildren: (childCounts.get(folder.folder_id) ?? 0) > 0,
      });
      if (expandedFolderIDs && !expandedFolderIDs.has(folder.folder_id)) continue;
      visit(folder.folder_id, depth + 1, new Set([...seen, folder.folder_id]));
    }
  };
  visit("", 0, new Set());
  return rows;
}

export function sortSharedInboxes(folders: CommunicationsSharedInbox[]): CommunicationsSharedInbox[] {
  return [...folders].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name) || a.folder_id.localeCompare(b.folder_id));
}

export function sharedInboxHasAnyRaciAssignments(folders: CommunicationsSharedInbox[]): boolean {
  return folders.some((folder) => (folder.raci_assignments ?? []).length > 0);
}

type SharedInboxAccessUser = {
  is_dev_admin?: boolean;
  memberships?: Array<{ company_id?: string; role?: string }>;
};

export function userHasFullSharedInboxAccess(user: SharedInboxAccessUser | null | undefined, companyID: string): boolean {
  if (!user) return false;
  if (user.is_dev_admin) return true;
  const cleanCompanyID = companyID.trim();
  return (user.memberships ?? []).some((membership) => {
    const role = membership.role?.trim();
    if (role === "dev_admin") return true;
    return cleanCompanyID !== "" && membership.company_id?.trim() === cleanCompanyID && role === "company_admin";
  });
}

export function sharedInboxUserHasRole(folder: CommunicationsSharedInbox | undefined, userID: string): boolean {
  const cleanUserID = userID.trim();
  if (!folder || !cleanUserID) return false;
  return (folder.raci_assignments ?? []).some((assignment) => assignment.user_id?.trim() === cleanUserID);
}

export function sharedInboxUserCanManageMail(folder: CommunicationsSharedInbox | undefined, userID: string, hasFullAccess = false): boolean {
  if (hasFullAccess) return true;
  if (!folder) return true;
  const assignments = folder.raci_assignments ?? [];
  const cleanUserID = userID.trim();
  if (assignments.length === 0) return true;
  if (!cleanUserID) return false;
  return assignments.some((assignment) => {
    if (assignment.user_id?.trim() !== cleanUserID) return false;
    return assignment.role === "responsible" || assignment.role === "accountable";
  });
}

export function sharedInboxTreeUserCanManageMail(folders: CommunicationsSharedInbox[], folderID: string, userID: string, hasFullAccess = false): boolean {
  if (hasFullAccess) return true;
  const cleanUserID = userID.trim();
  if (!sharedInboxHasAnyRaciAssignments(folders)) return true;
  if (!cleanUserID) return false;
  const cleanFolderID = folderID.trim();
  const scopedFolderIDs = cleanFolderID ? collectSharedInboxSubtreeIDs(folders, cleanFolderID) : new Set(folders.map((folder) => folder.folder_id));
  return folders.some((folder) => {
    if (!scopedFolderIDs.has(folder.folder_id)) return false;
    return (folder.raci_assignments ?? []).some((assignment) => {
      if (assignment.user_id?.trim() !== cleanUserID) return false;
      return assignment.role === "responsible" || assignment.role === "accountable";
    });
  });
}

export function filterSharedInboxesForUser(folders: CommunicationsSharedInbox[], userID: string, hasFullAccess = false): CommunicationsSharedInbox[] {
  if (hasFullAccess) return folders;
  const cleanUserID = userID.trim();
  if (!sharedInboxHasAnyRaciAssignments(folders)) return folders;
  if (!cleanUserID) return [];

  const byID = new Map(folders.map((folder) => [folder.folder_id, folder]));
  const childrenByParent = new Map<string, CommunicationsSharedInbox[]>();
  for (const folder of folders) {
    const parentID = folder.parent_folder_id ?? "";
    const children = childrenByParent.get(parentID) ?? [];
    children.push(folder);
    childrenByParent.set(parentID, children);
  }

  const included = new Set<string>();
  const includeAncestors = (folderID: string) => {
    let current = byID.get(folderID);
    const seen = new Set<string>();
    while (current && !seen.has(current.folder_id)) {
      seen.add(current.folder_id);
      included.add(current.folder_id);
      const parentID = current.parent_folder_id ?? "";
      current = parentID ? byID.get(parentID) : undefined;
    }
  };
  const includeDescendants = (folderID: string) => {
    for (const child of childrenByParent.get(folderID) ?? []) {
      if (included.has(child.folder_id)) continue;
      included.add(child.folder_id);
      includeDescendants(child.folder_id);
    }
  };

  for (const folder of folders) {
    if (!sharedInboxUserHasRole(folder, cleanUserID)) continue;
    includeAncestors(folder.folder_id);
    includeDescendants(folder.folder_id);
  }
  return folders.filter((folder) => included.has(folder.folder_id));
}

export function collectSharedInboxSubtreeIDs(folders: CommunicationsSharedInbox[], rootFolderID: string): Set<string> {
  const ids = new Set<string>();
  const cleanRootID = rootFolderID.trim();
  if (!cleanRootID || !folders.some((folder) => folder.folder_id === cleanRootID)) return ids;
  ids.add(cleanRootID);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      const parentID = folder.parent_folder_id?.trim() ?? "";
      if (!parentID || !ids.has(parentID) || ids.has(folder.folder_id)) continue;
      ids.add(folder.folder_id);
      changed = true;
    }
  }
  return ids;
}

export function isSharedInboxFolderDescendant(folders: CommunicationsSharedInbox[], sourceFolderID: string, targetFolderID: string): boolean {
  const cleanSourceID = sourceFolderID.trim();
  const cleanTargetID = targetFolderID.trim();
  if (!cleanSourceID || !cleanTargetID) return false;
  return collectSharedInboxSubtreeIDs(folders, cleanSourceID).has(cleanTargetID);
}

export function getSharedInboxChildPosition(folders: CommunicationsSharedInbox[], parentFolderID: string, excludeFolderID = ""): number {
  const cleanParentID = parentFolderID.trim();
  const cleanExcludeID = excludeFolderID.trim();
  const children = sortSharedInboxes(folders)
    .filter((folder) => (folder.parent_folder_id ?? "") === cleanParentID && folder.folder_id !== cleanExcludeID);
  const lastChild = children[children.length - 1];
  return (lastChild?.position ?? 0) + SHARED_INBOX_POSITION_STEP;
}

export function getSharedInboxSiblingPosition(
  folders: CommunicationsSharedInbox[],
  sourceFolderID: string,
  targetFolderID: string,
  placement: Exclude<SharedInboxDropPlacement, "inside">,
): number {
  const target = folders.find((folder) => folder.folder_id === targetFolderID);
  if (!target) return SHARED_INBOX_POSITION_STEP;
  const parentFolderID = target.parent_folder_id ?? "";
  const siblings = sortSharedInboxes(folders)
    .filter((folder) => (folder.parent_folder_id ?? "") === parentFolderID && folder.folder_id !== sourceFolderID);
  const targetIndex = siblings.findIndex((folder) => folder.folder_id === targetFolderID);
  if (targetIndex < 0) return target.position || SHARED_INBOX_POSITION_STEP;
  const previous = placement === "before" ? siblings[targetIndex - 1] : siblings[targetIndex];
  const next = placement === "before" ? siblings[targetIndex] : siblings[targetIndex + 1];
  if (previous && next && next.position - previous.position > 1) return Math.floor((previous.position + next.position) / 2);
  if (previous) return previous.position + SHARED_INBOX_POSITION_STEP;
  if (next) return Math.max(1, next.position - SHARED_INBOX_POSITION_STEP);
  return SHARED_INBOX_POSITION_STEP;
}

export function getHomeViewLabel(viewID: HomeViewID, sharedInboxes: CommunicationsSharedInbox[]): string {
  if (viewID === "primary") return "Primary";
  if (viewID === "my-triage") return "Pending";
  if (viewID === "shared-root") return "Shared Triage";
  if (viewID === "aci-inbox") return "ACI Inbox";
  if (viewID === "r-inbox") return "R Inbox";
  if (viewID === "my-nodes") return "My Nodes";
  if (viewID === "my-logic-gates") return "My Logic Gates";
  const folderID = viewID.startsWith("shared:") ? viewID.slice("shared:".length) : "";
  return sharedInboxes.find((folder) => folder.folder_id === folderID)?.name ?? "Shared Triage";
}

export function mailboxLabel(mailbox: EmailMailbox): string {
  return MAILBOX_OPTIONS.find((option) => option.value === mailbox)?.label ?? "Mail";
}

export function isInboxMatrixViewID(viewID: HomeViewID): boolean {
  return viewID === "aci-inbox" || viewID === "r-inbox";
}

export function workspaceEventTouchesHomePanel(type: string): boolean {
  const cleanType = type.trim();
  if (!cleanType) return false;
  return cleanType === "logic_gate_raci_updated"
    || cleanType === "communications_shared_inbox_raci_updated"
    || cleanType.startsWith("node_")
    || cleanType.startsWith("logic_gate_")
    || cleanType.startsWith("kanban_")
    || cleanType.startsWith("company_explorer_folder_");
}

export function isWorkspacePanelHomeViewID(viewID: HomeViewID): boolean {
  return viewID === "aci-inbox" || viewID === "r-inbox" || viewID === "my-nodes" || viewID === "my-logic-gates";
}

export function mailboxForHomeView(viewID: HomeViewID): EmailMailbox {
  return isArchivableHomeViewID(viewID) ? "primary" : "all";
}

export function messageListFilterKey(companyID: string, viewID: HomeViewID, mailbox: EmailMailbox, query: string, unreadOnly: boolean): string {
  return JSON.stringify([companyID.trim(), viewID, mailbox, query.trim(), unreadOnly]);
}

export function isArchivableHomeViewID(viewID: HomeViewID): boolean {
  return viewID === "my-triage" || viewID === "primary" || viewID === "shared-root" || viewID.startsWith("shared:");
}

export function markMessageSentToLogicGate(message: EmailMessage, logicGateID: string): EmailMessage {
  const cleanLogicGateID = logicGateID.trim();
  if (!cleanLogicGateID) return message;
  const logicGateIDs = message.logic_gate_ids ? [...message.logic_gate_ids] : [];
  if (!logicGateIDs.includes(cleanLogicGateID)) logicGateIDs.push(cleanLogicGateID);
  return {
    ...message,
    logic_gate_ids: logicGateIDs,
    logic_gate_count: logicGateIDs.length,
  };
}

export function formatAddressList(addresses?: EmailAddress[]): string {
  if (!addresses?.length) return "";
  return addresses.map((address) => address.name ? `${address.name} <${address.email}>` : address.email).join(", ");
}

export function messageHasRecipient(message: EmailMessage, email: string): boolean {
  return emailAddressListContains([...(message.to ?? []), ...(message.cc ?? []), ...(message.bcc ?? [])], email);
}

export function emailAddressListContains(addresses: EmailAddress[], email: string): boolean {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return false;
  return addresses.some((address) => address.email.trim().toLowerCase() === cleanEmail);
}

export function formatMessageDate(epochSeconds?: number): string {
  if (!epochSeconds) return "";
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function messageDocument(body: string): string {
  const value = body.trim();
  const content = /<\/?[a-z][\s\S]*>/i.test(value) ? value : `<pre>${escapeHTML(value)}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#111;margin:0;padding:14px;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif}</style></head><body>${content}</body></html>`;
}

export function escapeHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function isEmailAccessExpiredError(error: unknown): boolean {
  return error instanceof Error && error.message.trim() === "Email access expired. Disconnect and reconnect your mailbox.";
}

export function formatErrorCode(code: string): string {
  switch (code) {
    case "nylas_email_mismatch":
      return "Connect the same email address you use for Mango.";
    case "nylas_state_expired":
      return "Email connection expired. Start the connection again.";
    case "nylas_not_configured":
      return "Nylas is not configured on the backend.";
    default:
      return code.replace(/_/g, " ");
  }
}

