import { connectAuthenticatedSse, type SseConnection, type SseEvent } from "../../auth/authenticatedSse.js";

export type WorkspaceStreamEnvelope = {
  company_id?: string;
  event_id?: string;
  sequence?: number;
  stream_type?: string;
  stream_id?: string;
  type?: string;
  ts?: string;
  data?: Record<string, unknown>;
};

export type WorkspaceReconciliationScopeKind =
  | "kanban_board"
  | "kanban_board_list"
  | "node_graph"
  | "logic_gate_graph"
  | "company_explorer"
  | "work_item_assignment"
  | "workspace";

export type WorkspaceReconciliationScope = {
  kind: WorkspaceReconciliationScopeKind;
  eventType: string;
  boardID?: string;
  logicGateID?: string;
  nodeID?: string;
  assignmentID?: string;
  cardID?: string;
  columnID?: string;
  folderID?: string;
  folderKind?: string;
  itemType?: string;
  itemID?: string;
};

export type WorkspaceStreamReplayBoundary = {
  apiBase: string;
  companyID: string;
  afterSequence: number;
  previousSequence?: number;
  reconnect: boolean;
};

export type WorkspaceStreamGapSignal = {
  apiBase: string;
  companyID: string;
  previousSequence: number;
  receivedSequence: number;
  missingFrom: number;
  missingTo: number;
  event: SseEvent;
  envelope?: WorkspaceStreamEnvelope;
  scopes: WorkspaceReconciliationScope[];
};

export type WorkspaceStreamEventContext = {
  sequence?: number;
  previousSequence?: number;
  replayBoundary?: WorkspaceStreamReplayBoundary;
  envelope?: WorkspaceStreamEnvelope;
  scopes: WorkspaceReconciliationScope[];
  gap?: WorkspaceStreamGapSignal;
};

type WorkspaceStreamSubscriber = {
  onEvent: (event: SseEvent, context: WorkspaceStreamEventContext) => void;
  onGap?: (gap: WorkspaceStreamGapSignal) => void;
  onReplayBoundary?: (boundary: WorkspaceStreamReplayBoundary) => void;
  onError?: (error: unknown) => void;
};

type WorkspaceStreamEntry = {
  subscribers: Set<WorkspaceStreamSubscriber>;
  source?: SseConnection;
  closeTimer?: ReturnType<typeof setTimeout>;
  readyCount: number;
};

const workspaceStreams = new Map<string, WorkspaceStreamEntry>();
const workspaceCursors = new Map<string, number>();
const STREAM_CLOSE_GRACE_MS = 1500;
const WORK_ITEM_ASSIGNMENT_EVENT_TYPES = new Set([
  "work_item.logic_gate_assignment_saved",
  "work_item.logic_gate_assignment_moved",
  "work_item.logic_gate_assignment_removed",
  "work_item.logic_gate_issue_toggled",
]);

function streamKey(apiBase: string, companyID: string): string {
  return `${apiBase}:${companyID}`;
}

function getEntry(key: string): WorkspaceStreamEntry {
  const existing = workspaceStreams.get(key);
  if (existing) return existing;
  const created: WorkspaceStreamEntry = { subscribers: new Set(), readyCount: 0 };
  workspaceStreams.set(key, created);
  return created;
}

function buildWorkspaceStreamURL(apiBase: string, companyID: string, cursor: number | undefined): string {
  const params = new URLSearchParams({ company_id: companyID });
  if (cursor !== undefined) params.set("after_sequence", String(cursor));
  return `${apiBase}/v1/workspace/stream?${params.toString()}`;
}

function workspaceEventSequence(event: SseEvent): number | undefined {
  if (event.event !== "workspace" || event.id === undefined) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(event.id)) return undefined;
  const sequence = Number(event.id);
  return Number.isSafeInteger(sequence) ? sequence : undefined;
}

function parseNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseReadyAfterSequence(event: SseEvent): number | undefined {
  if (event.event !== "ready" || event.data.length === 0) return undefined;
  try {
    const payload = JSON.parse(event.data) as { after_sequence?: unknown };
    return parseNonNegativeInteger(payload.after_sequence);
  } catch {
    return undefined;
  }
}

function shouldStoreWorkspaceEventID(key: string, event: SseEvent): boolean {
  const sequence = workspaceEventSequence(event);
  if (sequence === undefined) return false;
  const cursor = workspaceCursors.get(key);
  return cursor === undefined || sequence > cursor;
}

function parseWorkspaceEnvelope(event: SseEvent): WorkspaceStreamEnvelope | undefined {
  if (event.event !== "workspace" || event.data.length === 0) return undefined;
  try {
    const parsed = JSON.parse(event.data) as WorkspaceStreamEnvelope;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nestedRecord(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = data[key];
  return isRecord(value) ? value : {};
}

function logicGateKanbanBoardID(logicGateID: string): string {
  return logicGateID ? `logic-gate:${logicGateID}` : "";
}

function scopeSignature(scope: WorkspaceReconciliationScope): string {
  return [
    scope.kind,
    scope.eventType,
    scope.boardID ?? "",
    scope.logicGateID ?? "",
    scope.nodeID ?? "",
    scope.assignmentID ?? "",
    scope.cardID ?? "",
    scope.columnID ?? "",
    scope.folderID ?? "",
    scope.folderKind ?? "",
    scope.itemType ?? "",
    scope.itemID ?? "",
  ].join("|");
}

function addScope(scopes: WorkspaceReconciliationScope[], seen: Set<string>, scope: WorkspaceReconciliationScope): void {
  const signature = scopeSignature(scope);
  if (seen.has(signature)) return;
  seen.add(signature);
  scopes.push(scope);
}

export function deriveWorkspaceReconciliationScopes(envelope: WorkspaceStreamEnvelope | undefined): WorkspaceReconciliationScope[] {
  const type = cleanString(envelope?.type);
  if (!type) return [];
  const data = isRecord(envelope?.data) ? envelope.data : {};
  if (type === "editor_collaboration_event" || type === "node_information_created" || type === "logic_gate_information_created") return [];
  const scopes: WorkspaceReconciliationScope[] = [];
  const seen = new Set<string>();

  const board = nestedRecord(data, "board");
  const card = nestedRecord(data, "card");
  const column = nestedRecord(data, "column");
  const node = nestedRecord(data, "node");
  const logicGate = nestedRecord(data, "logic_gate");
  const folder = nestedRecord(data, "folder");
  const folderItem = nestedRecord(data, "folder_item");

  const boardID = cleanString(data.board_id) || cleanString(board.board_id) || cleanString(card.board_id) || cleanString(column.board_id);
  const cardID = cleanString(data.card_id) || cleanString(card.card_id);
  const columnID = cleanString(data.column_id) || cleanString(column.column_id) || cleanString(card.column_id);
  const nodeID = cleanString(data.node_id) || cleanString(node.node_id) || cleanString(card.node_id);
  const logicGateID = cleanString(data.logic_gate_id) || cleanString(logicGate.logic_gate_id) || cleanString(board.logic_gate_id) || cleanString(card.logic_gate_id);
  const assignmentID = cleanString(data.assignment_id);
  const folderID = cleanString(data.folder_id) || cleanString(folder.folder_id) || cleanString(folderItem.folder_id);
  const folderKind = cleanString(data.folder_kind) || cleanString(folder.folder_kind);
  const itemType = cleanString(data.item_type) || cleanString(folderItem.item_type);
  const itemID = cleanString(data.item_id) || cleanString(folderItem.item_id);

  if (WORK_ITEM_ASSIGNMENT_EVENT_TYPES.has(type)) {
    addScope(scopes, seen, { kind: "work_item_assignment", eventType: type, boardID, logicGateID, nodeID, assignmentID, cardID, columnID });
    if (boardID) addScope(scopes, seen, { kind: "kanban_board", eventType: type, boardID, logicGateID, nodeID, cardID, columnID });
    if (nodeID) addScope(scopes, seen, { kind: "node_graph", eventType: type, nodeID });
    return scopes;
  }

  if (type === "kanban_board_saved" || type === "kanban_board_updated" || type === "kanban_board_deleted") {
    addScope(scopes, seen, { kind: "kanban_board_list", eventType: type, boardID, logicGateID });
    if (boardID) addScope(scopes, seen, { kind: "kanban_board", eventType: type, boardID, logicGateID });
    return scopes;
  }

  if (type.startsWith("kanban_column_") || type.startsWith("kanban_card_")) {
    if (boardID) addScope(scopes, seen, { kind: "kanban_board", eventType: type, boardID, logicGateID, nodeID, cardID, columnID });
    else addScope(scopes, seen, { kind: "kanban_board_list", eventType: type });
    return scopes;
  }

  if (type === "node_created" || type === "node_updated" || type === "node_deleted" || type === "node_permissions_updated") {
    addScope(scopes, seen, { kind: "node_graph", eventType: type, nodeID });
    addScope(scopes, seen, { kind: "company_explorer", eventType: type, itemType: "node", itemID: nodeID });
    return scopes;
  }

  if (type === "relationship_created" || type === "relationship_deleted" || type === "node_map_positions_updated") {
    addScope(scopes, seen, { kind: "node_graph", eventType: type, nodeID });
    return scopes;
  }

  if (type === "logic_gate_created" || type === "logic_gate_updated" || type === "logic_gate_deleted" || type === "logic_gate_raci_updated" || type === "logic_gate_permissions_updated") {
    const logicGateBoardID = logicGateKanbanBoardID(logicGateID);
    addScope(scopes, seen, { kind: "logic_gate_graph", eventType: type, logicGateID });
    addScope(scopes, seen, { kind: "company_explorer", eventType: type, itemType: "logic_gate", itemID: logicGateID });
    if (logicGateBoardID) addScope(scopes, seen, { kind: "kanban_board", eventType: type, boardID: logicGateBoardID, logicGateID });
    addScope(scopes, seen, { kind: "kanban_board_list", eventType: type, boardID: logicGateBoardID, logicGateID });
    return scopes;
  }

  if (type === "logic_gate_relationship_created" || type === "logic_gate_relationship_deleted" || type === "logic_gate_map_positions_updated") {
    addScope(scopes, seen, { kind: "logic_gate_graph", eventType: type, logicGateID });
    return scopes;
  }

  if (type === "company_explorer_folder_created" || type === "company_explorer_folder_moved" || type === "company_explorer_folder_updated" || type === "company_explorer_folder_deleted" || type === "communications_shared_inbox_raci_updated") {
    addScope(scopes, seen, { kind: "company_explorer", eventType: type, folderID, folderKind });
    if (folderKind === "node") addScope(scopes, seen, { kind: "node_graph", eventType: type, folderID });
    if (folderKind === "logic_gate") addScope(scopes, seen, { kind: "logic_gate_graph", eventType: type, folderID });
    return scopes;
  }

  if (type === "company_explorer_folder_item_assigned" || type === "company_explorer_folder_item_removed") {
    addScope(scopes, seen, { kind: "company_explorer", eventType: type, folderID, itemType, itemID });
    if (itemType === "node") addScope(scopes, seen, { kind: "node_graph", eventType: type, nodeID: itemID, folderID });
    if (itemType === "logic_gate") addScope(scopes, seen, { kind: "logic_gate_graph", eventType: type, logicGateID: itemID, folderID });
    if (itemType === "kanban") {
      addScope(scopes, seen, { kind: "kanban_board", eventType: type, boardID: itemID, folderID });
      addScope(scopes, seen, { kind: "kanban_board_list", eventType: type, boardID: itemID });
    }
    return scopes;
  }

  return [{ kind: "workspace", eventType: type }];
}

function fallbackWorkspaceScope(eventType = "workspace_unparseable"): WorkspaceReconciliationScope[] {
  return [{ kind: "workspace", eventType }];
}

function gapRecoveryScopes(scopes: WorkspaceReconciliationScope[]): WorkspaceReconciliationScope[] {
  return scopes.length > 0 ? scopes : fallbackWorkspaceScope("workspace_gap_unscoped");
}

function markReadyBoundary(apiBase: string, companyID: string, key: string, entry: WorkspaceStreamEntry, event: SseEvent): WorkspaceStreamReplayBoundary | undefined {
  const afterSequence = parseReadyAfterSequence(event);
  if (afterSequence === undefined) return undefined;
  const previousSequence = workspaceCursors.get(key);
  if (previousSequence === undefined || afterSequence > previousSequence) workspaceCursors.set(key, afterSequence);
  const boundary: WorkspaceStreamReplayBoundary = {
    apiBase,
    companyID,
    afterSequence,
    previousSequence,
    reconnect: entry.readyCount > 0 || previousSequence !== undefined,
  };
  entry.readyCount += 1;
  return boundary;
}

function updateWorkspaceCursor(apiBase: string, companyID: string, key: string, event: SseEvent): { deliver: boolean; context: WorkspaceStreamEventContext } {
  const sequence = workspaceEventSequence(event);
  if (sequence === undefined) return { deliver: true, context: { scopes: [] } };
  const cursor = workspaceCursors.get(key);
  if (cursor !== undefined && sequence <= cursor) return { deliver: false, context: { sequence, previousSequence: cursor, scopes: [] } };
  const envelope = parseWorkspaceEnvelope(event);
  const scopes = envelope ? deriveWorkspaceReconciliationScopes(envelope) : fallbackWorkspaceScope();
  const gap = cursor !== undefined && sequence > cursor + 1
    ? {
      apiBase,
      companyID,
      previousSequence: cursor,
      receivedSequence: sequence,
      missingFrom: cursor + 1,
      missingTo: sequence - 1,
      event,
      envelope,
      scopes: gapRecoveryScopes(scopes),
    }
    : undefined;
  workspaceCursors.set(key, sequence);
  return {
    deliver: true,
    context: {
      sequence,
      previousSequence: cursor,
      envelope,
      scopes,
      gap,
    },
  };
}

function ensureWorkspaceStream(apiBase: string, companyID: string, key: string, entry: WorkspaceStreamEntry): void {
  if (entry.source) return;
  const cursor = workspaceCursors.get(key);
  entry.source = connectAuthenticatedSse(() => buildWorkspaceStreamURL(apiBase, companyID, workspaceCursors.get(key)), {
    lastEventId: cursor === undefined ? undefined : String(cursor),
    shouldStoreLastEventId: (event: SseEvent) => shouldStoreWorkspaceEventID(key, event),
    onEvent(event: SseEvent) {
      if (event.event === "ready") {
        const replayBoundary = markReadyBoundary(apiBase, companyID, key, entry, event);
        const context: WorkspaceStreamEventContext = { replayBoundary, sequence: replayBoundary?.afterSequence, previousSequence: replayBoundary?.previousSequence, scopes: [] };
        for (const subscriber of Array.from(entry.subscribers)) {
          if (replayBoundary) subscriber.onReplayBoundary?.(replayBoundary);
          subscriber.onEvent(event, context);
        }
        return;
      }
      const result = updateWorkspaceCursor(apiBase, companyID, key, event);
      if (!result.deliver) return;
      if (result.context.gap) {
        for (const subscriber of Array.from(entry.subscribers)) subscriber.onGap?.(result.context.gap);
      }
      for (const subscriber of Array.from(entry.subscribers)) subscriber.onEvent(event, result.context);
    },
    onError(error: unknown) {
      for (const subscriber of Array.from(entry.subscribers)) subscriber.onError?.(error);
    },
  });
}

export function subscribeWorkspaceStream(apiBase: string, companyID: string, subscriber: WorkspaceStreamSubscriber): () => void {
  const key = streamKey(apiBase, companyID);
  const entry = getEntry(key);
  if (entry.closeTimer !== undefined) {
    clearTimeout(entry.closeTimer);
    entry.closeTimer = undefined;
  }
  entry.subscribers.add(subscriber);
  ensureWorkspaceStream(apiBase, companyID, key, entry);

  return () => {
    const current = workspaceStreams.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
    if (current.subscribers.size === 0) {
      current.closeTimer = setTimeout(() => {
        const closingEntry = workspaceStreams.get(key);
        if (closingEntry !== current || current.subscribers.size > 0) return;
        current.source?.close();
        workspaceStreams.delete(key);
      }, STREAM_CLOSE_GRACE_MS);
    }
  };
}
