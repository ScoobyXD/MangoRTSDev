import { assignNodeToLogicGateStatus as defaultAssignNodeToLogicGateStatus } from "../../modules/kanban/kanbanApi.js";
import type { LogicGateAssignmentCommandResult } from "../../modules/kanban/kanbanApi.js";
import type { NodeRecord } from "../../modules/node-map/shared.js";
import { cleanIDList, nodeTitle, normalizeResponsibleInboxStatus } from "./homeUtils.js";
import type { InboxPriority, ResponsibleInboxStatus } from "./homeTypes.js";

export type HomeDropAssignNodeToLogicGateStatus = (
  args: Parameters<typeof defaultAssignNodeToLogicGateStatus>[0],
) => Promise<LogicGateAssignmentCommandResult>;

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
