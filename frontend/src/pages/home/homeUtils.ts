import type { CommunicationsSharedInbox, EmailAddress, EmailFolder, EmailMailbox, EmailMessage, EmailReadStatus, UserLogicGateShortcut } from "../../modules/communications/communicationsApi.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../modules/folders/companyExplorerFolders.js";
import { collectFolderSubtreeIDs, EXPLORER_DRAG_MIME } from "../../modules/company-explorer/companyExplorerDragDrop.js";
import { getExplorerDropPayloadItems } from "../../modules/company-explorer/treePresentation.js";
import type { ExplorerDragPayload, ExplorerTreeNode } from "../../modules/company-explorer/companyExplorerTypes.js";
import { humanLabelOrFallback } from "../../modules/entityLabels.js";
import type { LogicGateGVICRole, LogicGateRecord } from "../../modules/logic-gate-map/shared.js";
import { getNodeTitle, type NodeRecord } from "../../modules/node-map/shared.js";
import { attachStackedDragPreview, EXPLORER_ENTITY_DRAG_MIME, KANBAN_LOGIC_GATE_DONE_COLOR, KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR, KANBAN_LOGIC_GATE_PENDING_COLOR, KANBAN_LOGIC_GATE_REVIEW_COLOR, serializeExplorerEntityDragPayload, type ExplorerEntityDragItem } from "../../modules/kanban/shared.js";
import { HOME_COLUMN_MAX_WIDTHS, HOME_COLUMN_MIN_WIDTHS, HOME_COLUMN_RESIZER_WIDTH, HOME_COLUMN_WIDTHS_STORAGE_KEY, HOME_INBOX_MATRIX_PANEL_MIN_WIDTH, INBOX_NO_LOGIC_GATE_ID, MAILBOX_OPTIONS, GVIC_INBOX_SECTIONS, TRIAGE_MESSAGE_DRAG_MIME } from "./homeConstants.js";
import type { HomeColumnWidths, HomeViewID, InboxLogicGateNodeGroup, InboxPriority, MyLogicGateGroup, MyNodeGroup, GVICInboxRole, GVICInboxStatus } from "./homeTypes.js";
export function readHomeColumnWidths(): HomeColumnWidths {
  try {
    const parsed = JSON.parse(localStorage.getItem(HOME_COLUMN_WIDTHS_STORAGE_KEY) ?? "null") as unknown;
    if (isHomeColumnWidths(parsed)) {
      return fitHomeColumnWidthsToAvailableWidth(parsed as HomeColumnWidths, getHomeWindowTrackWidth(), true);
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
  const availableWidth = Math.max(getHomeColumnMinimumTrackWidth(true), getHomeWindowTrackWidth());
  const sidebarWidth = 220;
  const listWidth = 350;
  const logicGateWidth = 340;
  const detailWidth = clampNumber(availableWidth - sidebarWidth - listWidth - logicGateWidth - HOME_COLUMN_RESIZER_WIDTH * 3, 360, 820);
  return fitHomeColumnWidthsToAvailableWidth([sidebarWidth, listWidth, detailWidth, logicGateWidth], availableWidth, true);
}

export function normalizeHomeColumnWidths(widths: HomeColumnWidths): HomeColumnWidths {
  return [
    clampNumber(widths[0], HOME_COLUMN_MIN_WIDTHS[0], HOME_COLUMN_MAX_WIDTHS[0]),
    clampNumber(widths[1], HOME_COLUMN_MIN_WIDTHS[1], HOME_COLUMN_MAX_WIDTHS[1]),
    clampNumber(widths[2], HOME_COLUMN_MIN_WIDTHS[2], HOME_COLUMN_MAX_WIDTHS[2]),
    clampNumber(widths[3], HOME_COLUMN_MIN_WIDTHS[3], HOME_COLUMN_MAX_WIDTHS[3]),
  ];
}

export function getHomeColumnMinimumTrackWidth(includeSidebar: boolean): number {
  const resizerCount = includeSidebar ? 3 : 2;
  const fixedMin = includeSidebar
    ? HOME_COLUMN_MIN_WIDTHS[0] + HOME_COLUMN_MIN_WIDTHS[1] + HOME_COLUMN_MIN_WIDTHS[3]
    : HOME_COLUMN_MIN_WIDTHS[1] + HOME_COLUMN_MIN_WIDTHS[3];
  return fixedMin + HOME_COLUMN_MIN_WIDTHS[2] + HOME_COLUMN_RESIZER_WIDTH * resizerCount;
}

export function getHomeWindowTrackWidth(): number {
  if (typeof window === "undefined") return getHomeColumnMinimumTrackWidth(true);
  return Math.max(1, window.innerWidth - 20);
}

export function fitHomeColumnWidthsToAvailableWidth(widths: HomeColumnWidths, availableWidth: number, includeSidebar: boolean): HomeColumnWidths {
  const next = normalizeHomeColumnWidths(widths);
  const cleanAvailableWidth = Number.isFinite(availableWidth)
    ? Math.max(1, Math.round(availableWidth))
    : getHomeColumnMinimumTrackWidth(includeSidebar);
  const fixedIndices: Array<0 | 1 | 3> = includeSidebar ? [0, 1, 3] : [1, 3];
  const resizerTotal = HOME_COLUMN_RESIZER_WIDTH * (includeSidebar ? 3 : 2);
  const minFixedTotal = fixedIndices.reduce<number>((sum, index) => sum + HOME_COLUMN_MIN_WIDTHS[index], 0);
  const targetFixedTotal = Math.max(
    minFixedTotal,
    cleanAvailableWidth - resizerTotal - HOME_COLUMN_MIN_WIDTHS[2],
  );
  let overflow = fixedIndices.reduce<number>((sum, index) => sum + next[index], 0) - targetFixedTotal;

  for (const index of includeSidebar ? [1, 3, 0] as const : [1, 3] as const) {
    if (overflow <= 0) break;
    const shrink = Math.min(overflow, next[index] - HOME_COLUMN_MIN_WIDTHS[index]);
    next[index] -= shrink;
    overflow -= shrink;
  }

  const fixedTotal = fixedIndices.reduce<number>((sum, index) => sum + next[index], 0);
  next[2] = Math.max(HOME_COLUMN_MIN_WIDTHS[2], cleanAvailableWidth - fixedTotal - resizerTotal);
  return normalizeHomeColumnWidths(next);
}

export function resizeHomeColumns(startWidths: HomeColumnWidths, dividerIndex: 0 | 1 | 2, delta: number, availableWidth: number): HomeColumnWidths {
  const fittedStart = fitHomeColumnWidthsToAvailableWidth(startWidths, availableWidth, true);
  const next: HomeColumnWidths = [fittedStart[0], fittedStart[1], fittedStart[2], fittedStart[3]];
  const resizerTotal = HOME_COLUMN_RESIZER_WIDTH * 3;

  if (dividerIndex === 0) {
    const pairTotal = fittedStart[0] + fittedStart[1];
    const maxLeft = Math.min(HOME_COLUMN_MAX_WIDTHS[0], pairTotal - HOME_COLUMN_MIN_WIDTHS[1]);
    next[0] = clampNumber(fittedStart[0] + delta, HOME_COLUMN_MIN_WIDTHS[0], maxLeft);
    next[1] = pairTotal - next[0];
  } else if (dividerIndex === 1) {
    const maxListFromViewport = availableWidth - next[0] - next[3] - resizerTotal - HOME_COLUMN_MIN_WIDTHS[2];
    const maxList = Math.min(HOME_COLUMN_MAX_WIDTHS[1], Math.max(HOME_COLUMN_MIN_WIDTHS[1], maxListFromViewport));
    next[1] = clampNumber(fittedStart[1] + delta, HOME_COLUMN_MIN_WIDTHS[1], maxList);
  } else {
    const maxRailFromViewport = availableWidth - next[0] - next[1] - resizerTotal - HOME_COLUMN_MIN_WIDTHS[2];
    const maxRail = Math.min(HOME_COLUMN_MAX_WIDTHS[3], Math.max(HOME_COLUMN_MIN_WIDTHS[3], maxRailFromViewport));
    next[3] = clampNumber(fittedStart[3] - delta, HOME_COLUMN_MIN_WIDTHS[3], maxRail);
  }

  next[2] = Math.max(HOME_COLUMN_MIN_WIDTHS[2], availableWidth - next[0] - next[1] - next[3] - resizerTotal);
  return normalizeHomeColumnWidths(next);
}

export function resizeHomeColumnsWithoutSidebar(startWidths: HomeColumnWidths, dividerIndex: 0 | 1 | 2, delta: number, availableWidth: number): HomeColumnWidths {
  const fittedStart = fitHomeColumnWidthsToAvailableWidth(startWidths, availableWidth, false);
  const next: HomeColumnWidths = [fittedStart[0], fittedStart[1], fittedStart[2], fittedStart[3]];
  const resizerTotal = HOME_COLUMN_RESIZER_WIDTH * 2;

  if (dividerIndex === 1) {
    const maxList = Math.min(
      HOME_COLUMN_MAX_WIDTHS[1],
      Math.max(HOME_COLUMN_MIN_WIDTHS[1], availableWidth - next[3] - resizerTotal - HOME_COLUMN_MIN_WIDTHS[2]),
    );
    next[1] = clampNumber(fittedStart[1] + delta, HOME_COLUMN_MIN_WIDTHS[1], maxList);
  } else if (dividerIndex === 2) {
    const maxRail = Math.min(
      HOME_COLUMN_MAX_WIDTHS[3],
      Math.max(HOME_COLUMN_MIN_WIDTHS[3], availableWidth - next[1] - resizerTotal - HOME_COLUMN_MIN_WIDTHS[2]),
    );
    next[3] = clampNumber(fittedStart[3] - delta, HOME_COLUMN_MIN_WIDTHS[3], maxRail);
  }

  next[2] = Math.max(HOME_COLUMN_MIN_WIDTHS[2], availableWidth - next[1] - next[3] - resizerTotal);
  return normalizeHomeColumnWidths(next);
}

export function resizeHomeInboxMatrixColumnsWithoutSidebar(startWidths: HomeColumnWidths, dividerIndex: 0 | 1 | 2, delta: number, availableWidth: number): HomeColumnWidths {
  const next: HomeColumnWidths = [startWidths[0], startWidths[1], startWidths[2], startWidths[3]];
  if (dividerIndex !== 2) return normalizeHomeColumnWidths(next);

  const maxRail = Math.min(
    HOME_COLUMN_MAX_WIDTHS[3],
    Math.max(HOME_COLUMN_MIN_WIDTHS[3], availableWidth - HOME_COLUMN_RESIZER_WIDTH - HOME_INBOX_MATRIX_PANEL_MIN_WIDTH),
  );
  next[3] = clampNumber(startWidths[3] - delta, HOME_COLUMN_MIN_WIDTHS[3], maxRail);
  next[2] = Math.max(HOME_INBOX_MATRIX_PANEL_MIN_WIDTH, availableWidth - next[3] - HOME_COLUMN_RESIZER_WIDTH);
  return normalizeHomeColumnWidths(next);
}

export function emailThreadKey(message: Pick<EmailMessage, "id" | "thread_id">): string {
  const threadID = (message.thread_id ?? "").trim();
  if (threadID) return `thread:${threadID}`;
  return `message:${message.id.trim()}`;
}

export function condenseEmailThreadMessages(messages: EmailMessage[]): EmailMessage[] {
  const groups = new Map<string, EmailMessage[]>();
  const order: string[] = [];
  for (const message of messages) {
    const key = emailThreadKey(message);
    const existing = groups.get(key);
    if (existing) {
      existing.push(message);
    } else {
      groups.set(key, [message]);
      order.push(key);
    }
  }

  const condensed: EmailMessage[] = [];
  for (const key of order) {
    const group = groups.get(key) ?? [];
    const representative = group[0];
    if (!representative) continue;
    const unreadCount = group.reduce((count, message) => count + (message.unread ? 1 : 0), 0);
    condensed.push({
      ...representative,
      unread: unreadCount > 0,
      starred: group.some((message) => message.starred),
      thread_message_count: group.length,
      thread_unread_count: unreadCount,
    });
  }
  return condensed;
}

export function getHomeGridTemplateColumns(widths: HomeColumnWidths): string {
  return [
    `${widths[0]}px`,
    `${HOME_COLUMN_RESIZER_WIDTH}px`,
    `${widths[1]}px`,
    `${HOME_COLUMN_RESIZER_WIDTH}px`,
    `minmax(${widths[2]}px, 1fr)`,
    `${HOME_COLUMN_RESIZER_WIDTH}px`,
    `${widths[3]}px`,
  ].join(" ");
}

export function getHomeGridTemplateColumnsWithoutSidebar(widths: HomeColumnWidths): string {
  return [
    `${widths[1]}px`,
    `${HOME_COLUMN_RESIZER_WIDTH}px`,
    `minmax(${widths[2]}px, 1fr)`,
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
    `minmax(${HOME_INBOX_MATRIX_PANEL_MIN_WIDTH}px, 1fr)`,
    `${widths[3]}px`,
  ].join(" ");
}

export function getInboxMatrixGridTemplateColumnsWithoutSidebar(widths: HomeColumnWidths): string {
  return [
    `minmax(${HOME_INBOX_MATRIX_PANEL_MIN_WIDTH}px, 1fr)`,
    `${HOME_COLUMN_RESIZER_WIDTH}px`,
    `${widths[3]}px`,
  ].join(" ");
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export type TriageMessageDragPayload = {
  messageIDs: string[];
  sharedInboxID?: string;
  companyID?: string;
};

export function readTriageMessageDrag(dataTransfer: DataTransfer): TriageMessageDragPayload {
  try {
    const raw = dataTransfer.getData(TRIAGE_MESSAGE_DRAG_MIME);
    if (!raw) return { messageIDs: [] };
    const parsed = JSON.parse(raw) as { kind?: string; message_ids?: unknown; shared_inbox_id?: unknown; company_id?: unknown };
    if (parsed.kind !== "triage_messages" || !Array.isArray(parsed.message_ids)) return { messageIDs: [] };
    return {
      messageIDs: cleanIDList(parsed.message_ids.filter((value): value is string => typeof value === "string")),
      sharedInboxID: typeof parsed.shared_inbox_id === "string" ? parsed.shared_inbox_id.trim() || undefined : undefined,
      companyID: typeof parsed.company_id === "string" ? parsed.company_id.trim() || undefined : undefined,
    };
  } catch {
    return { messageIDs: [] };
  }
}

export function readTriageMessageIDs(dataTransfer: DataTransfer): string[] {
  return readTriageMessageDrag(dataTransfer).messageIDs;
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

export function localMailboxMutationEchoKeys(companyID: string, sharedInboxID: string | undefined, messageID: string): string[] {
  const cleanCompanyID = companyID.trim();
  const cleanMessageID = messageID.trim();
  if (!cleanCompanyID || !cleanMessageID) return [];
  const cleanSharedInboxID = sharedInboxID?.trim() ?? "";
  const scopedKey = `${cleanCompanyID}\x1f${cleanSharedInboxID}\x1f${cleanMessageID}`;
  return cleanSharedInboxID ? [scopedKey, `${cleanCompanyID}\x1f\x1f${cleanMessageID}`] : [scopedKey];
}

export function triageMessageIDsFromStreamMessageID(value: string): string[] {
  return cleanIDList(value.split(","));
}

export function communicationStreamEventIsArchiveConfirmation(event: { trigger?: string; action?: string }): boolean {
  const trigger = event.trigger?.trim().toLowerCase() ?? "";
  const action = event.action?.trim().toLowerCase() ?? "";
  return action === "archive" || trigger.startsWith("message.archived");
}

export function communicationStreamEventIsStarConfirmation(event: { trigger?: string; action?: string }): boolean {
  const trigger = event.trigger?.trim().toLowerCase() ?? "";
  const action = event.action?.trim().toLowerCase() ?? "";
  return action === "star" || action === "unstar" || trigger.startsWith("message.starred") || trigger.startsWith("message.unstarred");
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
  return humanLabelOrFallback(logicGate?.header, humanLabelOrFallback(logicGate?.logic_gate_id, "Logic Gate"));
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
    ids.map((logicGateID) => ({ label: logicGateTitle(logicGateByID.get(logicGateID)), color: "#334155" })),
    "#334155",
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

export function nodeTitle(node?: Pick<NodeRecord, "name" | "node_id">): string {
  return node ? getNodeTitle(node) || node.node_id : "Node";
}

export function inboxLogicGateLabel(logicGateID: string, logicGateByID: Map<string, LogicGateRecord>): string {
  const logicGate = logicGateByID.get(logicGateID);
  return logicGate ? logicGateTitle(logicGate) : humanLabelOrFallback(logicGateID, "Logic Gate");
}

export function missingLogicGateRecordIDs(nodes: Pick<NodeRecord, "logic_gate_ids">[], logicGateByID: Map<string, LogicGateRecord>): string[] {
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const node of nodes) {
    for (const logicGateID of cleanIDList(node.logic_gate_ids ?? [])) {
      if (logicGateByID.has(logicGateID) || seen.has(logicGateID)) continue;
      seen.add(logicGateID);
      missing.push(logicGateID);
    }
  }
  return missing;
}

export function logicGateHasGVICRole(logicGate: LogicGateRecord | undefined, role: LogicGateGVICRole, userID: string): boolean {
  const cleanUserID = userID.trim();
  if (!logicGate || !cleanUserID) return false;
  return (logicGate.gvic_assignments ?? []).some((assignment) => assignment.role === role && assignment.user_id?.trim() === cleanUserID);
}

export function logicGateHasAnyGVICRole(logicGate: LogicGateRecord | undefined, userID: string): boolean {
  const cleanUserID = userID.trim();
  if (!logicGate || !cleanUserID) return false;
  return (logicGate.gvic_assignments ?? []).some((assignment) => assignment.user_id?.trim() === cleanUserID);
}

export function addGVICInboxGroupNode(byCell: Map<string, Map<string, Set<string>>>, cellKey: string, logicGateID: string, nodeID: string): void {
  const byLogicGate = byCell.get(cellKey) ?? new Map<string, Set<string>>();
  const nodeIDs = byLogicGate.get(logicGateID) ?? new Set<string>();
  nodeIDs.add(nodeID);
  byLogicGate.set(logicGateID, nodeIDs);
  byCell.set(cellKey, byLogicGate);
}

export function materializeGVICInboxGroupsByCell(
  byCell: Map<string, Map<string, Set<string>>>,
  nodeByID: Map<string, NodeRecord>,
  logicGateByID: Map<string, LogicGateRecord>,
): Map<string, InboxLogicGateNodeGroup[]> {
  const out = new Map<string, InboxLogicGateNodeGroup[]>();
  for (const [cellKey, byLogicGate] of byCell.entries()) {
    const groups = Array.from(byLogicGate.entries())
      .map(([logicGateID, childIDs]) => ({
        logicGateID,
        label: logicGateID === INBOX_NO_LOGIC_GATE_ID ? "No Logic Gate" : inboxLogicGateLabel(logicGateID, logicGateByID),
        nodeIDs: Array.from(childIDs).sort((a, b) => nodeTitle(nodeByID.get(a)).localeCompare(nodeTitle(nodeByID.get(b)), undefined, { numeric: true, sensitivity: "base" }) || a.localeCompare(b)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }) || a.logicGateID.localeCompare(b.logicGateID));
    out.set(cellKey, groups);
  }
  return out;
}

export function buildGVICRoleInboxGroupsByCell(
  nodes: NodeRecord[],
  nodeByID: Map<string, NodeRecord>,
  logicGateByID: Map<string, LogicGateRecord>,
  currentUserID: string,
  role: GVICInboxRole,
): Map<string, InboxLogicGateNodeGroup[]> {
  const cleanUserID = currentUserID.trim();
  const byCell = new Map<string, Map<string, Set<string>>>();
  if (!cleanUserID) return materializeGVICInboxGroupsByCell(byCell, nodeByID, logicGateByID);
  for (const node of nodes) {
    const priority = normalizeInboxPriority(node.priority);
    const status = normalizeGVICInboxStatus(node.status);
    if (priority === null || !status || status === "done") continue;
    if (role === "other") {
      const logicGateIDs = cleanIDList(node.logic_gate_ids ?? []);
      if (logicGateIDs.length === 0) {
        addGVICInboxGroupNode(byCell, GVICRoleCellKey(role, status, priority), INBOX_NO_LOGIC_GATE_ID, node.node_id);
        continue;
      }
      for (const logicGateID of logicGateIDs) {
        const logicGate = logicGateByID.get(logicGateID);
        if (logicGateHasAnyGVICRole(logicGate, cleanUserID)) continue;
        addGVICInboxGroupNode(byCell, GVICRoleCellKey(role, status, priority), logicGateID, node.node_id);
      }
      continue;
    }
    for (const logicGateID of cleanIDList(node.logic_gate_ids ?? [])) {
      const logicGate = logicGateByID.get(logicGateID);
      if (!logicGateHasGVICRole(logicGate, role, cleanUserID)) continue;
      addGVICInboxGroupNode(byCell, GVICRoleCellKey(role, status, priority), logicGateID, node.node_id);
    }
  }
  return materializeGVICInboxGroupsByCell(byCell, nodeByID, logicGateByID);
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

export function nodeDragItemsFromIDs(nodeIDs: string[], nodeByID: Map<string, NodeRecord>): ExplorerEntityDragItem[] {
  return cleanIDList(nodeIDs)
    .filter((nodeID) => nodeByID.has(nodeID))
    .map((nodeID) => ({ nodeID, label: nodeTitle(nodeByID.get(nodeID)) || nodeID }));
}

export function nodeDragItemsFromExplorerRows(
  payload: ExplorerDragPayload | null,
  rows: ExplorerTreeNode[],
  nodeByID: Map<string, NodeRecord>,
): ExplorerEntityDragItem[] {
  if (!payload) return [];
  if (payload.kind === "node" && payload.itemID) return nodeDragItemsFromIDs([payload.itemID], nodeByID);
  if (payload.kind === "batch") {
    return nodeDragItemsFromIDs(
      getExplorerDropPayloadItems(payload)
        .filter((item) => item.itemType === "node")
        .map((item) => item.itemID),
      nodeByID,
    );
  }
  if (payload.kind === "folder" && payload.folderKind === "node" && payload.folderID) {
    const rootIndex = rows.findIndex((row) => row.kind === "folder" && row.folderID === payload.folderID);
    if (rootIndex < 0) return [];
    const rootDepth = rows[rootIndex].depth;
    const nodeIDs: string[] = [];
    for (let index = rootIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.depth <= rootDepth) break;
      if (row.kind === "node" && row.nodeID) nodeIDs.push(row.nodeID);
    }
    return nodeDragItemsFromIDs(nodeIDs, nodeByID);
  }
  return [];
}

export function setKanbanNodeEntityDragData(dataTransfer: DataTransfer, items: ExplorerEntityDragItem[]): void {
  if (items.length === 0) return;
  const payload = items.length === 1
    ? { itemType: "node" as const, nodeID: items[0].nodeID, label: items[0].label }
    : { itemType: "node_batch" as const, nodes: items };
  dataTransfer.setData(EXPLORER_ENTITY_DRAG_MIME, serializeExplorerEntityDragPayload(payload));
}

export function setNodeDragData(dataTransfer: DataTransfer, nodeIDs: string[], nodeByID: Map<string, NodeRecord>): void {
  const payload = buildNodeExplorerPayload(nodeIDs);
  if (!payload) return;
  const ids = cleanIDList(nodeIDs);
  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(payload));
  setKanbanNodeEntityDragData(dataTransfer, nodeDragItemsFromIDs(ids, nodeByID));
  dataTransfer.setData("text/plain", ids.length === 1 ? nodeTitle(nodeByID.get(ids[0])) : `${ids.length} nodes`);
  attachStackedDragPreview(
    dataTransfer,
    ids.map((nodeID) => ({ label: nodeTitle(nodeByID.get(nodeID)), color: "#334155" })),
    "#334155",
    "Nodes",
  );
}

export function GVICRoleCellKey(role: GVICInboxRole, status: GVICInboxStatus, priority: InboxPriority): string {
  return `${role}:${status}:${priority}`;
}

export function normalizeInboxPriority(value: unknown): InboxPriority | null {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string" && value.trim() === "") return 0;
  const priority = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(priority)) return null;
  const rounded = Math.round(priority);
  return rounded >= 0 && rounded <= 5 ? rounded as InboxPriority : null;
}

export function normalizeGVICInboxStatus(value: unknown): GVICInboxStatus | null {
  const status = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s_-]+/g, " ") : "";
  if (status === "pending" || status === "p") return "pending";
  if (status === "in progress" || status === "ip") return "in_progress";
  if (status === "review") return "review";
  if (status === "done" || status === "d") return "done";
  return null;
}

export function gvicStatusColor(status: GVICInboxStatus): string {
  if (status === "pending") return KANBAN_LOGIC_GATE_PENDING_COLOR;
  if (status === "in_progress") return KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR;
  if (status === "review") return KANBAN_LOGIC_GATE_REVIEW_COLOR;
  return KANBAN_LOGIC_GATE_DONE_COLOR;
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

export function nodeIDsFromExplorerPayload(payload: ExplorerDragPayload | null, folders: CompanyExplorerFolder[], folderItems: CompanyExplorerFolderItem[]): string[] {
  if (!payload) return [];
  if (payload.kind === "node" && payload.itemID) return [payload.itemID];
  if (payload.kind === "batch") {
    return cleanIDList(getExplorerDropPayloadItems(payload)
      .filter((item) => item.itemType === "node")
      .map((item) => item.itemID));
  }
  if (payload.kind === "folder" && payload.folderKind === "node" && payload.folderID) {
    const subtree = collectFolderSubtreeIDs(folders, payload.folderID);
    return cleanIDList(folderItems
      .filter((item) => item.item_type === "node" && subtree.has(item.folder_id))
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
  assignedLogicGates?: LogicGateRecord[];
  logicGateByID: Map<string, LogicGateRecord>;
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
}): MyLogicGateGroup[] {
  const folderByID = new Map(input.folders.map((folder) => [folder.folder_id, folder]));
  const folderIDByLogicGateID = new Map(input.folderItems.filter((item) => item.item_type === "logic_gate").map((item) => [item.item_id, item.folder_id]));
  const groupByKey = new Map<string, MyLogicGateGroup>();
  const seen = new Set<string>();
  const orderedLogicGates = [
    ...sortLogicGateShortcuts(input.shortcuts)
      .map((shortcut) => input.logicGateByID.get(shortcut.logic_gate_id))
      .filter((logicGate): logicGate is LogicGateRecord => Boolean(logicGate)),
    ...[...(input.assignedLogicGates ?? [])].sort((a, b) => (
      logicGateTitle(a).localeCompare(logicGateTitle(b), undefined, { numeric: true, sensitivity: "base" })
      || a.logic_gate_id.localeCompare(b.logic_gate_id)
    )),
  ];
  for (const logicGate of orderedLogicGates) {
    if (seen.has(logicGate.logic_gate_id)) continue;
    seen.add(logicGate.logic_gate_id);
    if (!logicGate) continue;
    const folderID = folderIDByLogicGateID.get(logicGate.logic_gate_id) ?? "";
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

export function buildMyNodeGroups(input: {
  nodes: NodeRecord[];
  logicGateFolders: CompanyExplorerFolder[];
  logicGateFolderItems: CompanyExplorerFolderItem[];
}): MyNodeGroup[] {
  const folderByID = new Map(input.logicGateFolders.map((folder) => [folder.folder_id, folder]));
  const folderIDByLogicGateID = new Map(input.logicGateFolderItems.filter((item) => item.item_type === "logic_gate").map((item) => [item.item_id, item.folder_id]));
  const groupByKey = new Map<string, MyNodeGroup>();
  for (const node of sortNodesForInbox(input.nodes)) {
    let folderID = "";
    for (const logicGateID of cleanIDList(node.logic_gate_ids ?? [])) {
      folderID = folderIDByLogicGateID.get(logicGateID) ?? "";
      if (folderID) break;
    }
    const key = folderID || "unfiled";
    const group = groupByKey.get(key) ?? {
      key,
      label: folderID ? folderPathLabel(folderByID, folderID) : "Unfiled Nodes",
      nodes: [],
    };
    group.nodes.push(node);
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
  const visibleIDs = new Set(folders.map((folder) => folder.folder_id));
  for (const folder of sortSharedInboxes(folders)) {
    const parentID = folder.parent_folder_id?.trim() ?? "";
    const key = parentID && visibleIDs.has(parentID) ? parentID : "";
    const bucket = byParent.get(key) ?? [];
    bucket.push(folder);
    byParent.set(key, bucket);
    if (parentID && visibleIDs.has(parentID)) childCounts.set(parentID, (childCounts.get(parentID) ?? 0) + 1);
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

type SharedInboxAccessLevel = "no_access" | "view" | "edit" | "admin";

function sharedInboxAccessRank(accessLevel: string | undefined): number {
  switch (accessLevel) {
    case "no_access":
      return 0;
    case "view":
      return 1;
    case "edit":
      return 2;
    case "admin":
      return 3;
    default:
      return 0;
  }
}

export function sharedInboxHasAnyAccessGrants(folders: CommunicationsSharedInbox[]): boolean {
  return folders.some((folder) => (folder.access_grants ?? []).length > 0);
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

export function userCanManageSharedInboxStructure(user: SharedInboxAccessUser | null | undefined, companyID: string): boolean {
  if (!user) return false;
  if (user.is_dev_admin) return true;
  const cleanCompanyID = companyID.trim();
  return (user.memberships ?? []).some((membership) => {
    const role = membership.role?.trim();
    if (role === "dev_admin") return true;
    return cleanCompanyID !== "" && membership.company_id?.trim() === cleanCompanyID && (
      role === "company_admin" || role === "company_manager"
    );
  });
}

function sharedInboxEffectiveAccess(folder: CommunicationsSharedInbox | undefined, userID: string): SharedInboxAccessLevel | "" {
  if (!folder) return "";
  const effective = folder.effective_access_level;
  if (effective === "no_access" || effective === "view" || effective === "edit" || effective === "admin") return effective;
  const cleanUserID = userID.trim();
  let best: SharedInboxAccessLevel | "" = "";
  if (!cleanUserID) return best;
  for (const grant of folder.access_grants ?? []) {
    if (grant.subject_type !== "user" || grant.subject_id?.trim() !== cleanUserID) continue;
    const accessLevel = grant.access_level ?? grant.permission;
    if (accessLevel !== "no_access" && accessLevel !== "view" && accessLevel !== "edit" && accessLevel !== "admin") continue;
    if (best === "" || sharedInboxAccessRank(accessLevel) > sharedInboxAccessRank(best)) best = accessLevel;
  }
  return best;
}

export function sharedInboxUserHasRole(folder: CommunicationsSharedInbox | undefined, userID: string): boolean {
  return sharedInboxAccessRank(sharedInboxEffectiveAccess(folder, userID)) >= sharedInboxAccessRank("view");
}

export function sharedInboxUserCanManageMail(folder: CommunicationsSharedInbox | undefined, userID: string, hasFullAccess = false): boolean {
  if (hasFullAccess) return true;
  if (!folder) return false;
  return sharedInboxAccessRank(sharedInboxEffectiveAccess(folder, userID)) >= sharedInboxAccessRank("edit");
}

export function sharedInboxTreeUserCanManageMail(folders: CommunicationsSharedInbox[], folderID: string, userID: string, hasFullAccess = false): boolean {
  if (hasFullAccess) return true;
  const cleanFolderID = folderID.trim();
  const scopedFolderIDs = cleanFolderID ? collectSharedInboxSubtreeIDs(folders, cleanFolderID) : new Set(folders.map((folder) => folder.folder_id));
  return folders.some((folder) => scopedFolderIDs.has(folder.folder_id) && sharedInboxUserCanManageMail(folder, userID, false));
}

export function sharedInboxCanLoadMail(folder: Pick<CommunicationsSharedInbox, "entry_type" | "account_email"> | null | undefined): boolean {
  return !!folder && folder.entry_type === "shared_inbox" && Boolean((folder.account_email ?? "").trim());
}

export function gvicInboxSectionForView(viewID: HomeViewID): (typeof GVIC_INBOX_SECTIONS)[number] | null {
  return GVIC_INBOX_SECTIONS.find((section) => section.viewID === viewID) ?? null;
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
  if (viewID === "my-triage") return "My Triage";
  if (viewID === "shared-root") return "Shared Triage";
  const GVICSection = gvicInboxSectionForView(viewID);
  if (GVICSection) return GVICSection.title;
  if (viewID === "my-work") return "My Work";
  if (viewID === "updates") return "Updates";
  if (viewID === "my-nodes") return "My Nodes";
  if (viewID === "my-logic-gates") return "My Logic Gates";
  const folderID = viewID.startsWith("shared:") ? viewID.slice("shared:".length) : "";
  return sharedInboxes.find((folder) => folder.folder_id === folderID)?.name ?? "Shared Triage";
}

export function mailboxLabel(mailbox: EmailMailbox): string {
  return MAILBOX_OPTIONS.find((option) => option.value === mailbox)?.label ?? "Mail";
}

export type MailboxCountMap = Partial<Record<Extract<EmailMailbox, "primary" | "starred">, number>>;

export function mailboxCountsFromFolders(folders: EmailFolder[]): MailboxCountMap {
  const inboxFolder = findEmailFolder(folders, ["inbox"]);
  const primaryCategoryFolder = findEmailFolder(folders, ["category:primary", "category:personal", "primary"]);
  return {
    // The Gmail primary list excludes Social and Promotions via native search,
    // but folder metadata does not expose that exact filtered count.
    primary: emailFolderTotalCount(inboxFolder) ?? emailFolderTotalCount(primaryCategoryFolder),
    starred: emailFolderTotalCount(findEmailFolder(folders, ["starred", "flagged"])),
  };
}

export function isInboxMatrixViewID(viewID: HomeViewID): boolean {
  return gvicInboxSectionForView(viewID) !== null;
}

export function workspaceEventTouchesHomePanel(type: string): boolean {
  const cleanType = type.trim();
  if (!cleanType) return false;
  if (
    cleanType === "workspace_derived_projection_requested"
    || cleanType === "company_explorer_folder_item_assign_requested"
    || cleanType === "node_map_position_upsert_requested"
    || cleanType === "logic_gate_map_position_upsert_requested"
  ) {
    return false;
  }
  return cleanType === "node_created"
    || cleanType === "node_updated"
    || cleanType === "node_deleted"
    || cleanType === "node_permissions_updated"
    || cleanType === "relationship_created"
    || cleanType === "relationship_deleted"
    || cleanType === "logic_gate_created"
    || cleanType === "logic_gate_updated"
    || cleanType === "logic_gate_deleted"
    || cleanType === "logic_gate_gvic_updated"
    || cleanType === "logic_gate_permissions_updated"
    || cleanType === "communications_shared_inbox_gvic_updated"
    || cleanType === "shared_triage_access_updated"
    || cleanType.startsWith("company_explorer_folder_")
    || cleanType.startsWith("kanban_")
    || cleanType.startsWith("work_item.");
}

export function isWorkspacePanelHomeViewID(viewID: HomeViewID): boolean {
  return isArchivableHomeViewID(viewID) || isInboxMatrixViewID(viewID) || viewID === "my-work" || viewID === "updates" || viewID === "my-nodes" || viewID === "my-logic-gates";
}

export function mailboxForHomeView(viewID: HomeViewID): EmailMailbox {
  return isArchivableHomeViewID(viewID) ? "primary" : "all";
}

export function canDragTriageMessageFromMailbox(mailbox: EmailMailbox): boolean {
  return mailbox === "primary" || mailbox === "starred" || mailbox === "all" || mailbox === "archive" || mailbox === "sent";
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

export function messageIsSent(message: EmailMessage): boolean {
  return [...(message.folders ?? []), ...(message.folder_ids ?? [])]
    .map(normalizeEmailFolderToken)
    .some((token) => token === "sent");
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
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function messageReadStatusLabel(status?: EmailReadStatus): string {
  if (!status) return "";
  return "Seen";
}

export function messageReadStatusTimestamp(status?: EmailReadStatus): string {
  const raw = status?.last_signal_timestamp || status?.first_signal_timestamp || "";
  if (!raw.trim()) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function messageReadStatusTitle(status?: EmailReadStatus): string {
  if (!status) return "";
  const label = messageReadStatusLabel(status);
  if (!label) return "";
  const timestamp = messageReadStatusTimestamp(status);
  const count = typeof status.signal_count === "number" && status.signal_count > 1 ? ` (${Math.floor(status.signal_count)} open signals)` : "";
  const caveat = "Open tracking can be affected by recipient image and privacy settings.";
  return timestamp ? `${label} ${timestamp}${count}. ${caveat}` : `${label}${count}. ${caveat}`;
}

function emailFolderTotalCount(folder: EmailFolder | undefined): number | undefined {
  const count = folder?.total_count;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return undefined;
  return Math.floor(count);
}

function findEmailFolder(folders: EmailFolder[], tokens: string[]): EmailFolder | undefined {
  const targets = new Set(tokens.map(normalizeEmailFolderToken).filter(Boolean));
  return folders.find((folder) => emailFolderTokens(folder).some((token) => targets.has(token)));
}

function emailFolderTokens(folder: EmailFolder): string[] {
  return [
    folder.id,
    folder.name,
    folder.display_name,
    folder.system_folder,
    ...(folder.attributes ?? []),
  ].map(normalizeEmailFolderToken).filter(Boolean);
}

function normalizeEmailFolderToken(value: string | undefined): string {
  let token = value?.trim().toLowerCase() ?? "";
  while (token.startsWith("\\")) token = token.slice(1);
  token = token.replace(/[\s-]+/g, "_");
  if (token.startsWith("category_")) token = `category:${token.slice("category_".length)}`;
  return token;
}

function escapeHTMLAttribute(value: string): string {
  return escapeHTML(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function linkifyPlainText(value: string): string {
  const urlPattern = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
  let output = "";
  let cursor = 0;
  for (const match of value.matchAll(urlPattern)) {
    const matchText = match[0] ?? "";
    const index = match.index ?? 0;
    if (index > cursor) output += escapeHTML(value.slice(cursor, index));
    const trailingPunctuation = matchText.match(/[),.;:!?]+$/)?.[0] ?? "";
    const cleanURL = trailingPunctuation ? matchText.slice(0, -trailingPunctuation.length) : matchText;
    const href = cleanURL.toLowerCase().startsWith("www.") ? `https://${cleanURL}` : cleanURL;
    output += `<a href="${escapeHTMLAttribute(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(cleanURL)}</a>${escapeHTML(trailingPunctuation)}`;
    cursor = index + matchText.length;
  }
  return output + escapeHTML(value.slice(cursor));
}

export function messageDocument(body: string): string {
  const value = body.trim();
  const content = /<\/?[a-z][\s\S]*>/i.test(value) ? value : `<pre>${linkifyPlainText(value)}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#111;margin:0;padding:14px;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif}a{color:#0369a1;text-decoration:underline;text-decoration-thickness:1.5px;text-underline-offset:2px;font-weight:650;cursor:pointer}a:hover{color:#0c4a6e}</style></head><body>${content}</body></html>`;
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

