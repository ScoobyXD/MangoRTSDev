import { updateNode as defaultUpdateNode } from "../../modules/communications/communicationsApi.js";
import {
  assignNodeToLogicGateStatus as defaultAssignNodeToLogicGateStatus,
  moveLogicGateAssignment as defaultMoveLogicGateAssignment,
} from "../../modules/kanban/kanbanApi.js";
import type { LogicGateAssignmentCommandResult } from "../../modules/kanban/kanbanApi.js";
import type { NodeRecord } from "../../modules/node-map/shared.js";
import { cleanIDList, nodeTitle, normalizeResponsibleInboxStatus } from "./homeUtils.js";
import type { InboxPriority, ResponsibleInboxStatus } from "./homeTypes.js";

export type HomeDropAssignNodeToLogicGateStatus = (
  args: Parameters<typeof defaultAssignNodeToLogicGateStatus>[0],
) => Promise<LogicGateAssignmentCommandResult>;

export type HomeBulkMoveLogicGateAssignment = (
  args: Parameters<typeof defaultMoveLogicGateAssignment>[0],
) => Promise<LogicGateAssignmentCommandResult>;

export type HomeBulkUpdateNode = typeof defaultUpdateNode;

export type HomeBulkNodePatch = Partial<Pick<NodeRecord, "assignee_user_id" | "priority" | "status" | "due_date">>;

export type HomeKanbanBoardContentsInvalidator = (apiBase: string, companyID: string, boardID: string) => void;

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
