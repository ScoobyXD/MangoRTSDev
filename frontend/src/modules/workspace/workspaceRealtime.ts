import { fetchCurrentUser } from "../../auth/cognitoAuth.js";
import { subscribeRealtimeScope, type RealtimeSnapshotRefetchMessage, type RealtimeWorkspaceEventMessage } from "../realtime/realtimeWebSocket.js";

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
  | "racio_matrix"
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
  projectID?: string;
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

export type WorkspaceRealtimeEvent = {
  event: "workspace";
  id?: string;
  data: string;
};

export type WorkspaceStreamGapSignal = {
  apiBase: string;
  companyID: string;
  previousSequence: number;
  receivedSequence: number;
  missingFrom: number;
  missingTo: number;
  event: WorkspaceRealtimeEvent;
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

type WorkspaceRealtimeSubscriber = {
  onEvent: (event: WorkspaceRealtimeEvent, context: WorkspaceStreamEventContext) => void;
  onGap?: (gap: WorkspaceStreamGapSignal) => void;
  onReplayBoundary?: (boundary: WorkspaceStreamReplayBoundary) => void;
  onError?: (error: unknown) => void;
};

type WorkspaceUserScopeFactory = (userID: string) => string;

const workspaceCursors = new Map<string, number>();
const workspaceReadyCounts = new Map<string, number>();
const workspaceStreams = new Map<string, WorkspaceStreamState>();
const WORK_ITEM_ASSIGNMENT_EVENT_TYPES = new Set([
  "work_item.logic_gate_assignment_saved",
  "work_item.logic_gate_assignment_moved",
  "work_item.logic_gate_assignment_removed",
  "work_item.logic_gate_issue_toggled",
]);
const INTERNAL_DERIVED_WORK_EVENT_TYPES = new Set([
  "workspace_derived_projection_requested",
  "company_explorer_folder_item_assign_requested",
  "node_map_position_upsert_requested",
  "logic_gate_map_position_upsert_requested",
]);

type WorkspaceStreamState = {
  apiBase: string;
  companyID: string;
  scope: string;
  key: string;
  subscribers: Set<WorkspaceRealtimeSubscriber>;
  unsubscribe?: () => void;
};

export function workspaceRealtimeScope(userID: string): string {
  return userScopedWorkspaceScope("workspace", userID);
}

export function companyExplorerRealtimeScope(userID: string): string {
  return userScopedWorkspaceScope("company_explorer", userID);
}

export function nodeGraphRealtimeScope(userID: string): string {
  return userScopedWorkspaceScope("node_graph", userID);
}

export function logicGateGraphRealtimeScope(userID: string): string {
  return userScopedWorkspaceScope("logic_gate_graph", userID);
}

function userScopedWorkspaceScope(prefix: string, userID: string): string {
  const cleanPrefix = prefix.trim();
  const cleanUserID = userID.trim();
  return cleanPrefix && cleanUserID ? `${cleanPrefix}:user:${cleanUserID}` : "";
}

function streamKey(apiBase: string, companyID: string, scope: string): string {
  return `${apiBase}:${companyID}:${scope}`;
}

function workspaceEventSequence(event: WorkspaceRealtimeEvent): number | undefined {
  if (event.event !== "workspace" || event.id === undefined) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(event.id)) return undefined;
  const sequence = Number(event.id);
  return Number.isSafeInteger(sequence) ? sequence : undefined;
}

function parseWorkspaceEnvelope(event: WorkspaceRealtimeEvent): WorkspaceStreamEnvelope | undefined {
  if (event.event !== "workspace" || event.data.length === 0) return undefined;
  try {
    const parsed = JSON.parse(event.data) as WorkspaceStreamEnvelope;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const clean = cleanString(item);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
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
  const project = nestedRecord(data, "project");
  const folder = nestedRecord(data, "folder");
  const folderItem = nestedRecord(data, "folder_item");

  const boardID = cleanString(data.board_id) || cleanString(board.board_id) || cleanString(card.board_id) || cleanString(column.board_id);
  const cardID = cleanString(data.card_id) || cleanString(card.card_id);
  const columnID = cleanString(data.column_id) || cleanString(column.column_id) || cleanString(card.column_id);
  const nodeID = cleanString(data.node_id) || cleanString(node.node_id) || cleanString(card.node_id);
  const logicGateID = cleanString(data.logic_gate_id) || cleanString(logicGate.logic_gate_id) || cleanString(board.logic_gate_id) || cleanString(card.logic_gate_id);
  const projectID = cleanString(data.project_id) || cleanString(project.project_id);
  const assignmentID = cleanString(data.assignment_id);
  const folderID = cleanString(data.folder_id) || cleanString(folder.folder_id) || cleanString(folderItem.folder_id);
  const folderKind = cleanString(data.folder_kind) || cleanString(folder.folder_kind);
  const itemType = cleanString(data.item_type) || cleanString(folderItem.item_type);
  const itemID = cleanString(data.item_id) || cleanString(folderItem.item_id);

  if (INTERNAL_DERIVED_WORK_EVENT_TYPES.has(type)) {
    return [];
  }

  if (WORK_ITEM_ASSIGNMENT_EVENT_TYPES.has(type)) {
    addScope(scopes, seen, { kind: "work_item_assignment", eventType: type, boardID, logicGateID, nodeID, assignmentID, cardID, columnID });
    if (boardID) addScope(scopes, seen, { kind: "kanban_board", eventType: type, boardID, logicGateID, nodeID, cardID, columnID });
    addScope(scopes, seen, { kind: "racio_matrix", eventType: type, logicGateID, nodeID, assignmentID });
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
    for (const nodeLogicGateID of cleanStringList(node.logic_gate_ids)) {
      addScope(scopes, seen, {
        kind: "kanban_board",
        eventType: type,
        boardID: logicGateKanbanBoardID(nodeLogicGateID),
        logicGateID: nodeLogicGateID,
        nodeID,
      });
    }
    addScope(scopes, seen, { kind: "racio_matrix", eventType: type, nodeID });
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
    addScope(scopes, seen, { kind: "racio_matrix", eventType: type, logicGateID });
    return scopes;
  }

  if (type === "logic_gate_relationship_created" || type === "logic_gate_relationship_deleted" || type === "logic_gate_map_positions_updated") {
    addScope(scopes, seen, { kind: "logic_gate_graph", eventType: type, logicGateID });
    return scopes;
  }

  if (
    type === "project_created" ||
    type === "project_updated" ||
    type === "project_deleted" ||
    type === "project_permissions_updated" ||
    type === "project_information_created" ||
    type === "project_information_deleted" ||
    type === "project_relationship_upserted" ||
    type === "project_relationship_deleted"
  ) {
    addScope(scopes, seen, { kind: "company_explorer", eventType: type, itemType: "project", itemID: projectID, projectID });
    return scopes;
  }

  if (type === "company_explorer_folder_created" || type === "company_explorer_folder_moved" || type === "company_explorer_folder_updated" || type === "company_explorer_folder_deleted" || type === "communications_shared_inbox_raci_updated" || type === "shared_triage_access_updated") {
    addScope(scopes, seen, { kind: "company_explorer", eventType: type, folderID, folderKind });
    if (folderKind === "node") addScope(scopes, seen, { kind: "node_graph", eventType: type, folderID });
    if (folderKind === "logic_gate") addScope(scopes, seen, { kind: "logic_gate_graph", eventType: type, folderID });
    return scopes;
  }

  if (type === "company_explorer_folder_item_assigned" || type === "company_explorer_folder_item_removed") {
    addScope(scopes, seen, { kind: "company_explorer", eventType: type, folderID, itemType, itemID });
    if (itemType === "node") addScope(scopes, seen, { kind: "node_graph", eventType: type, nodeID: itemID, folderID });
    if (itemType === "logic_gate") addScope(scopes, seen, { kind: "logic_gate_graph", eventType: type, logicGateID: itemID, folderID });
    if (itemType === "project") addScope(scopes, seen, { kind: "company_explorer", eventType: type, itemType, itemID, projectID: itemID, folderID });
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

function messageToWorkspaceEvent(message: RealtimeWorkspaceEventMessage): WorkspaceRealtimeEvent {
  const sequence = message.sequence ?? message.event.sequence;
  return {
    event: "workspace",
    id: sequence === undefined ? undefined : String(sequence),
    data: JSON.stringify(message.event),
  };
}

function updateWorkspaceCursor(apiBase: string, companyID: string, key: string, event: WorkspaceRealtimeEvent): { deliver: boolean; context: WorkspaceStreamEventContext } {
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

function markAcceptedBoundary(apiBase: string, companyID: string, key: string, currentSequence: number | undefined): WorkspaceStreamReplayBoundary | undefined {
  if (currentSequence === undefined) return undefined;
  const previousSequence = workspaceCursors.get(key);
  if (previousSequence !== undefined) return undefined;
  workspaceCursors.set(key, currentSequence);
  const readyCount = workspaceReadyCounts.get(key) ?? 0;
  workspaceReadyCounts.set(key, readyCount + 1);
  return {
    apiBase,
    companyID,
    afterSequence: currentSequence,
    previousSequence,
    reconnect: readyCount > 0,
  };
}

function refetchGap(apiBase: string, companyID: string, key: string, message: RealtimeSnapshotRefetchMessage): WorkspaceStreamGapSignal | undefined {
  const receivedSequence = message.sequence;
  const previousSequence = workspaceCursors.get(key);
  if (receivedSequence === undefined || previousSequence === undefined || receivedSequence <= previousSequence) return undefined;
  const event: WorkspaceRealtimeEvent = {
    event: "workspace",
    id: String(receivedSequence),
    data: JSON.stringify({ company_id: companyID, sequence: receivedSequence, type: "workspace_snapshot_refetch", data: { reason: message.reason } }),
  };
  workspaceCursors.set(key, receivedSequence);
  return {
    apiBase,
    companyID,
    previousSequence,
    receivedSequence,
    missingFrom: previousSequence + 1,
    missingTo: receivedSequence,
    event,
    envelope: parseWorkspaceEnvelope(event),
    scopes: fallbackWorkspaceScope("workspace_snapshot_refetch"),
  };
}

export function subscribeWorkspaceRealtime(apiBase: string, companyID: string, scope: string, subscriber: WorkspaceRealtimeSubscriber): () => void {
  const cleanCompanyID = companyID.trim();
  const cleanScope = scope.trim();
  if (!cleanCompanyID || !cleanScope) return () => undefined;
  const key = streamKey(apiBase, cleanCompanyID, cleanScope);
  let state = workspaceStreams.get(key);
  if (!state) {
    state = { apiBase, companyID: cleanCompanyID, scope: cleanScope, key, subscribers: new Set() };
    workspaceStreams.set(key, state);
    state.unsubscribe = subscribeRealtimeScope(apiBase, cleanCompanyID, cleanScope, {
      getAfterSequence: () => workspaceCursors.get(key),
      onAccepted(message) {
        const boundary = markAcceptedBoundary(apiBase, cleanCompanyID, key, message.current_sequence);
        if (!boundary) return;
        const event = { event: "workspace" as const, id: String(boundary.afterSequence), data: "{}" };
        const context = { replayBoundary: boundary, sequence: boundary.afterSequence, previousSequence: boundary.previousSequence, scopes: [] };
        for (const current of state?.subscribers ?? []) {
          current.onReplayBoundary?.(boundary);
          current.onEvent(event, context);
        }
      },
      onWorkspaceEvent(message) {
        const event = messageToWorkspaceEvent(message);
        const result = updateWorkspaceCursor(apiBase, cleanCompanyID, key, event);
        if (!result.deliver) return;
        for (const current of state?.subscribers ?? []) {
          if (result.context.gap) current.onGap?.(result.context.gap);
          current.onEvent(event, result.context);
        }
      },
      onRefetch(message) {
        const gap = refetchGap(apiBase, cleanCompanyID, key, message);
        if (!gap) return;
        for (const current of state?.subscribers ?? []) current.onGap?.(gap);
      },
      onError(message) {
        for (const current of state?.subscribers ?? []) current.onError?.(message);
      },
    });
  }
  state.subscribers.add(subscriber);
  return () => {
    const current = workspaceStreams.get(key);
    current?.subscribers.delete(subscriber);
    if (!current || current.subscribers.size > 0) return;
    current.unsubscribe?.();
    workspaceStreams.delete(key);
  };
}

export function subscribeWorkspaceUserRealtime(apiBase: string, companyID: string, scopeForUser: WorkspaceUserScopeFactory, subscriber: WorkspaceRealtimeSubscriber): () => void {
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  void fetchCurrentUser()
    .then((current) => {
      const userID = current.user.user_id?.trim() ?? "";
      if (cancelled || !userID) return;
      const scope = scopeForUser(userID);
      unsubscribe = subscribeWorkspaceRealtime(apiBase, companyID, scope, subscriber);
    })
    .catch((error: unknown) => {
      if (!cancelled) subscriber.onError?.(error);
    });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}
