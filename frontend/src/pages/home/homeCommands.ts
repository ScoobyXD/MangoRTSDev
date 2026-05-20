import {
  addMyLogicGateShortcuts as defaultAddMyLogicGateShortcuts,
  convertTriageMessagesToLogicGate as defaultConvertTriageMessagesToLogicGate,
  invalidateCommunicationsCache as defaultInvalidateCommunicationsCache,
  removeMyLogicGateShortcut as defaultRemoveMyLogicGateShortcut,
  updateNode as defaultUpdateNode,
} from "../../modules/communications/communicationsApi.js";
import type { UserLogicGateShortcut } from "../../modules/communications/communicationsApi.js";
import type { ExplorerDragPayload } from "../../modules/company-explorer/companyExplorerTypes.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../modules/folders/companyExplorerFolders.js";
import {
  assignNodeToLogicGateStatus as defaultAssignNodeToLogicGateStatus,
  invalidateKanbanBoardListCache as defaultInvalidateKanbanBoardListCache,
  invalidateLogicGateArenaViewCache as defaultInvalidateLogicGateArenaViewCache,
  moveLogicGateAssignment as defaultMoveLogicGateAssignment,
} from "../../modules/kanban/kanbanApi.js";
import type { LogicGateAssignmentCommandResult } from "../../modules/kanban/kanbanApi.js";
import {
  EVENT_KANBAN_BOARD_CONTENTS_UPDATED,
  EVENT_KANBAN_BOARDS_UPDATED,
  logicGateKanbanBoardID,
  type KanbanBoardContentsUpdatedDetail,
  type KanbanBoardsUpdatedDetail,
} from "../../modules/kanban/shared.js";
import type { NodeRecord } from "../../modules/node-map/shared.js";
import { cleanIDList, logicGateIDsFromExplorerPayload, nodeTitle, normalizeResponsibleInboxStatus } from "./homeUtils.js";
import type { InboxPriority, ResponsibleInboxStatus } from "./homeTypes.js";

export type HomeDropAssignNodeToLogicGateStatus = (
  args: Parameters<typeof defaultAssignNodeToLogicGateStatus>[0],
) => Promise<LogicGateAssignmentCommandResult>;

export type HomeBulkMoveLogicGateAssignment = (
  args: Parameters<typeof defaultMoveLogicGateAssignment>[0],
) => Promise<LogicGateAssignmentCommandResult>;

export type HomeBulkUpdateNode = typeof defaultUpdateNode;
export type HomeAddMyLogicGateShortcuts = typeof defaultAddMyLogicGateShortcuts;
export type HomeRemoveMyLogicGateShortcut = typeof defaultRemoveMyLogicGateShortcut;
export type HomeConvertTriageMessagesToLogicGate = typeof defaultConvertTriageMessagesToLogicGate;

export type HomeBulkNodePatch = Partial<Pick<NodeRecord, "assignee_user_id" | "priority" | "status" | "due_date">>;

export type HomeKanbanBoardContentsInvalidator = (apiBase: string, companyID: string, boardID: string) => void;
export type HomeNodeRecordInvalidator = (apiBase: string, companyID: string, nodeID: string) => void;
export type HomeNodeGraphNodeUpsert = (apiBase: string, companyID: string, node: NodeRecord) => void;
export type HomeFolderItemGraphUpsert = (apiBase: string, companyID: string, item: CompanyExplorerFolderItem) => void;

export type HomeLogicGateShortcutCommandResult = {
  logicGateIDs: string[];
  shortcuts: UserLogicGateShortcut[];
};

export type HomeTriageConversionCommandResult = {
  result: Awaited<ReturnType<HomeConvertTriageMessagesToLogicGate>>;
  boardID: string;
  logicGateID: string;
  convertedMessageIDs: string[];
};

function noopKanbanBoardContentsInvalidator(): void {}
function noopNodeRecordInvalidator(): void {}
function noopNodeGraphNodeUpsert(): void {}
function noopFolderItemGraphUpsert(): void {}

function dispatchKanbanBoardsUpdated(detail: KanbanBoardsUpdatedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<KanbanBoardsUpdatedDetail>(EVENT_KANBAN_BOARDS_UPDATED, { detail }));
}

function dispatchKanbanBoardContentsUpdated(detail: KanbanBoardContentsUpdatedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<KanbanBoardContentsUpdatedDetail>(EVENT_KANBAN_BOARD_CONTENTS_UPDATED, { detail }));
}

export async function dropNodesIntoInboxLogicGateCommand(args: {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  nodeIDs: string[];
  priority: InboxPriority;
  status?: ResponsibleInboxStatus;
  nodeByID: Map<string, NodeRecord>;
  assignNodeToLogicGateStatus?: HomeDropAssignNodeToLogicGateStatus;
  invalidateKanbanBoardContents?: HomeKanbanBoardContentsInvalidator;
}): Promise<NodeRecord[]> {
  const logicGateID = args.logicGateID.trim();
  const nodeIDs = cleanIDList(args.nodeIDs).filter((nodeID) => args.nodeByID.has(nodeID));
  if (!logicGateID || nodeIDs.length === 0) return [];

  const assignNodeToLogicGateStatus = args.assignNodeToLogicGateStatus ?? defaultAssignNodeToLogicGateStatus;
  const priority = args.priority === 0 ? null : args.priority;
  return Promise.all(nodeIDs.map(async (nodeID) => {
    const node = args.nodeByID.get(nodeID);
    if (!node) return null;
    const status = args.status ?? normalizeResponsibleInboxStatus(node.status) ?? "pending";
    const result = await assignNodeToLogicGateStatus({
      apiBase: args.apiBase,
      companyID: args.companyID,
      logicGateID,
      nodeID,
      status,
      priority,
      nodeTitle: nodeTitle(node),
      position: 0,
    });
    args.invalidateKanbanBoardContents?.(args.apiBase, args.companyID, result.card.board_id);
    return result.node;
  })).then((nodes) => nodes.filter((node): node is NodeRecord => node !== null));
}
export async function applyBulkNodePatchCommand(args: {
  apiBase: string;
  companyID: string;
  nodeIDs: string[];
  patch: HomeBulkNodePatch;
  nodeByID: Map<string, NodeRecord>;
  moveLogicGateAssignment?: HomeBulkMoveLogicGateAssignment;
  updateNode?: HomeBulkUpdateNode;
  invalidateKanbanBoardContents?: HomeKanbanBoardContentsInvalidator;
}): Promise<NodeRecord[]> {
  const nodeIDs = cleanIDList(args.nodeIDs).filter((nodeID) => args.nodeByID.has(nodeID));
  if (nodeIDs.length === 0) return [];

  const moveLogicGateAssignment = args.moveLogicGateAssignment ?? defaultMoveLogicGateAssignment;
  const updateNode = args.updateNode ?? defaultUpdateNode;
  const status = normalizeResponsibleInboxStatus(args.patch.status);
  const priorityWasSet = Object.prototype.hasOwnProperty.call(args.patch, "priority");

  return Promise.all(nodeIDs.map(async (nodeID) => {
    const node = args.nodeByID.get(nodeID);
    if (!node) return null;
    const logicGateID = cleanIDList(node.logic_gate_ids ?? [])[0] ?? "";
    let commandNode: NodeRecord | null = null;
    const directPatch: HomeBulkNodePatch = { ...args.patch };

    if (logicGateID && (status || priorityWasSet)) {
      const result = await moveLogicGateAssignment({
        apiBase: args.apiBase,
        companyID: args.companyID,
        logicGateID,
        nodeID,
        status: status ?? undefined,
        position: 0,
        priority: priorityWasSet ? args.patch.priority ?? null : undefined,
      });
      commandNode = result.node;
      if (status) delete directPatch.status;
      if (priorityWasSet) delete directPatch.priority;
      args.invalidateKanbanBoardContents?.(args.apiBase, args.companyID, result.card.board_id);
    }

    if (Object.keys(directPatch).length === 0) return commandNode;
    return updateNode(args.companyID, nodeID, directPatch);
  })).then((nodes) => nodes.filter((node): node is NodeRecord => node !== null));
}

export async function addMyLogicGateShortcutsCommand(args: {
  companyID: string;
  payload: ExplorerDragPayload | null;
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  addMyLogicGateShortcuts?: HomeAddMyLogicGateShortcuts;
}): Promise<HomeLogicGateShortcutCommandResult | null> {
  const logicGateIDs = logicGateIDsFromExplorerPayload(args.payload, args.folders, args.folderItems);
  if (logicGateIDs.length === 0) return null;
  const addMyLogicGateShortcuts = args.addMyLogicGateShortcuts ?? defaultAddMyLogicGateShortcuts;
  const shortcuts = await addMyLogicGateShortcuts(args.companyID, logicGateIDs);
  return { logicGateIDs, shortcuts };
}

export async function removeMyLogicGateShortcutCommand(args: {
  companyID: string;
  logicGateID: string;
  removeMyLogicGateShortcut?: HomeRemoveMyLogicGateShortcut;
}): Promise<string> {
  const logicGateID = args.logicGateID.trim();
  if (!logicGateID) return "";
  const removeMyLogicGateShortcut = args.removeMyLogicGateShortcut ?? defaultRemoveMyLogicGateShortcut;
  await removeMyLogicGateShortcut(args.companyID, logicGateID);
  return logicGateID;
}

export async function convertMessagesToLogicGateCommand(args: {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  messageIDs: string[];
  convertTriageMessagesToLogicGate?: HomeConvertTriageMessagesToLogicGate;
  invalidateKanbanBoardList?: typeof defaultInvalidateKanbanBoardListCache;
  invalidateKanbanBoardContents?: HomeKanbanBoardContentsInvalidator;
  invalidateLogicGateArenaView?: typeof defaultInvalidateLogicGateArenaViewCache;
  dispatchKanbanBoardsUpdated?: (detail: KanbanBoardsUpdatedDetail) => void;
  dispatchKanbanBoardContentsUpdated?: (detail: KanbanBoardContentsUpdatedDetail) => void;
  invalidateNodeRecord?: HomeNodeRecordInvalidator;
  upsertNodeRelationshipGraphNode?: HomeNodeGraphNodeUpsert;
  upsertNodeFolderItemInRelationshipGraph?: HomeFolderItemGraphUpsert;
  upsertLogicGateFolderItemInRelationshipGraph?: HomeFolderItemGraphUpsert;
  invalidateCommunications?: typeof defaultInvalidateCommunicationsCache;
}): Promise<HomeTriageConversionCommandResult | null> {
  const logicGateID = args.logicGateID.trim();
  const messageIDs = cleanIDList(args.messageIDs);
  if (!logicGateID || messageIDs.length === 0) return null;

  const convertTriageMessagesToLogicGate = args.convertTriageMessagesToLogicGate ?? defaultConvertTriageMessagesToLogicGate;
  const result = await convertTriageMessagesToLogicGate({ companyID: args.companyID, logicGateID, messageIDs });
  const boardID = result.board?.board_id?.trim() || logicGateKanbanBoardID(logicGateID);
  const boardLogicGateID = result.board?.logic_gate_id?.trim() || logicGateID;

  const invalidateKanbanBoardList = args.invalidateKanbanBoardList ?? defaultInvalidateKanbanBoardListCache;
  const invalidateKanbanBoardContents = args.invalidateKanbanBoardContents ?? noopKanbanBoardContentsInvalidator;
  const invalidateLogicGateArenaView = args.invalidateLogicGateArenaView ?? defaultInvalidateLogicGateArenaViewCache;
  const emitKanbanBoardsUpdated = args.dispatchKanbanBoardsUpdated ?? dispatchKanbanBoardsUpdated;
  const emitKanbanBoardContentsUpdated = args.dispatchKanbanBoardContentsUpdated ?? dispatchKanbanBoardContentsUpdated;
  const invalidateNodeRecord = args.invalidateNodeRecord ?? noopNodeRecordInvalidator;
  const upsertNodeRelationshipGraphNode = args.upsertNodeRelationshipGraphNode ?? noopNodeGraphNodeUpsert;
  const upsertNodeFolderItemInRelationshipGraph = args.upsertNodeFolderItemInRelationshipGraph ?? noopFolderItemGraphUpsert;
  const upsertLogicGateFolderItemInRelationshipGraph = args.upsertLogicGateFolderItemInRelationshipGraph ?? noopFolderItemGraphUpsert;
  const invalidateCommunications = args.invalidateCommunications ?? defaultInvalidateCommunicationsCache;

  invalidateKanbanBoardList(args.apiBase, args.companyID);
  invalidateKanbanBoardContents(args.apiBase, args.companyID, boardID);
  invalidateLogicGateArenaView(args.apiBase, args.companyID, boardLogicGateID);
  emitKanbanBoardsUpdated({ companyID: args.companyID, board: result.board });
  emitKanbanBoardContentsUpdated({ companyID: args.companyID, boardID, logicGateID: boardLogicGateID });
  for (const node of result.nodes ?? []) {
    invalidateNodeRecord(args.apiBase, args.companyID, node.node_id);
    upsertNodeRelationshipGraphNode(args.apiBase, args.companyID, node);
  }
  for (const item of result.folder_items ?? []) {
    upsertNodeFolderItemInRelationshipGraph(args.apiBase, args.companyID, item);
    upsertLogicGateFolderItemInRelationshipGraph(args.apiBase, args.companyID, item);
  }
  invalidateCommunications({ messagePages: true, messages: true });

  const convertedMessageIDs = result.deleted_message_ids?.length ? result.deleted_message_ids : messageIDs;
  return {
    result,
    boardID,
    logicGateID: boardLogicGateID,
    convertedMessageIDs,
  };
}
