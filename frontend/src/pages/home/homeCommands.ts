import {
	archiveEmailMessagesBatch as defaultArchiveEmailMessagesBatch,
  addMyLogicGateShortcuts as defaultAddMyLogicGateShortcuts,
  convertTriageMessagesToExplorerTarget as defaultConvertTriageMessagesToExplorerTarget,
  convertTriageMessagesToLogicGate as defaultConvertTriageMessagesToLogicGate,
  deleteEmailMessage as defaultDeleteEmailMessage,
  removeMyLogicGateShortcut as defaultRemoveMyLogicGateShortcut,
  parseEmailAddressList,
  sendEmail as defaultSendEmail,
  unarchiveEmailMessage as defaultUnarchiveEmailMessage,
  updateCommunicationsSharedInbox as defaultUpdateCommunicationsSharedInbox,
  updateCommunicationsSharedInboxRACIAssignments as defaultUpdateCommunicationsSharedInboxRACIAssignments,
  updateEmailMessage as defaultUpdateEmailMessage,
  updateNode as defaultUpdateNode,
} from "../../modules/communications/communicationsApi.js";
import { requestJSON as defaultRequestJSON, type RequestJSONInit } from "../../modules/api/requestJSON.js";
import type { LogicGateRACIRole, LogicGateRecord } from "../../modules/logic-gates/types.js";
import type {
  CompanyUser,
	CommunicationsArchiveJob,
  CommunicationsSharedInbox,
  CommunicationsSharedInboxRACIAssignment,
  CommunicationsSharedInboxRACIRole,
  CommunicationsSharedInboxRACIPrincipalType,
  EmailMessage,
  CommunicationsTriageConversionTarget,
  SendEmailInput,
  UserLogicGateShortcut,
} from "../../modules/communications/communicationsApi.js";
import type { ExplorerDragPayload } from "../../modules/company-explorer/companyExplorerTypes.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../modules/folders/companyExplorerFolders.js";
import {
  assignNodeToLogicGateStatus as defaultAssignNodeToLogicGateStatus,
  createRACIMatrixNode as defaultCreateRACIMatrixNode,
  invalidateKanbanBoardListCache as defaultInvalidateKanbanBoardListCache,
  invalidateLogicGateArenaViewCache as defaultInvalidateLogicGateArenaViewCache,
  moveLogicGateAssignment as defaultMoveLogicGateAssignment,
} from "../../modules/kanban/kanbanApi.js";
import type { LogicGateAssignmentCommandResult, RACIMatrixProjectionRow } from "../../modules/kanban/kanbanApi.js";
import {
  EVENT_KANBAN_BOARD_CONTENTS_UPDATED,
  EVENT_KANBAN_BOARDS_UPDATED,
  logicGateKanbanBoardID,
  type KanbanBoardContentsUpdatedDetail,
  type KanbanBoardsUpdatedDetail,
} from "../../modules/kanban/shared.js";
import { editorBodyHasEmailContent, serializeEditorBodyForEmailHTML } from "../../modules/editor/richTextEditing.js";
import { buildForwardedComposeBody } from "./emailForwarding.js";
import type { NodeRecord } from "../../modules/nodes/types.js";
import {
  moveMyWorkNodeToCell as defaultMoveMyWorkNodeToCell,
  type MyWorkNodeMoveResult,
} from "../../modules/work-items/workItemReadApi.js";
import { createWorkspaceEntityBatchClientID, createWorkspaceEntityBatchCommand } from "../../modules/workspace/workspaceEntityCommands.js";
import {
  cleanIDList,
  logicGateIDsFromExplorerPayload,
  nodeTitle,
  normalizeRACIInboxStatus,
} from "./homeUtils.js";
import { INBOX_NO_LOGIC_GATE_ID } from "./homeConstants.js";
import type { ComposeState, HomeEntityDeleteKind, InboxPriority, RACIInboxStatus } from "./homeTypes.js";

export type HomeDropAssignNodeToLogicGateStatus = (
  args: Parameters<typeof defaultAssignNodeToLogicGateStatus>[0],
) => Promise<LogicGateAssignmentCommandResult>;

export type HomeBulkMoveLogicGateAssignment = (
  args: Parameters<typeof defaultMoveLogicGateAssignment>[0],
) => Promise<LogicGateAssignmentCommandResult>;

export type HomeCreateRACIMatrixNode = typeof defaultCreateRACIMatrixNode;

export type HomeArchiveEmailMessagesBatch = typeof defaultArchiveEmailMessagesBatch;
export type HomeUnarchiveEmailMessage = typeof defaultUnarchiveEmailMessage;
export type HomeDeleteEmailMessage = typeof defaultDeleteEmailMessage;
export type HomeUpdateEmailMessage = typeof defaultUpdateEmailMessage;
export type HomeSendEmail = typeof defaultSendEmail;
export type HomeBulkUpdateNode = typeof defaultUpdateNode;
export type HomeMoveMyWorkNodeToCell = typeof defaultMoveMyWorkNodeToCell;
export type HomeAddMyLogicGateShortcuts = typeof defaultAddMyLogicGateShortcuts;
export type HomeRemoveMyLogicGateShortcut = typeof defaultRemoveMyLogicGateShortcut;
export type HomeConvertTriageMessagesToExplorerTarget = typeof defaultConvertTriageMessagesToExplorerTarget;
export type HomeConvertTriageMessagesToLogicGate = typeof defaultConvertTriageMessagesToLogicGate;
export type HomeUpdateSharedInbox = typeof defaultUpdateCommunicationsSharedInbox;
export type HomeUpdateSharedInboxRACIAssignments = typeof defaultUpdateCommunicationsSharedInboxRACIAssignments;

export type HomeBulkNodePatch = Partial<Pick<NodeRecord, "priority" | "status" | "due_date">>;
export type HomeMailMessageUpdate = { unread?: boolean; starred?: boolean; folders?: string[] };

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
  unstarredMessageIDs: string[];
};

export type HomeExplorerTriageConversionCommandResult = {
  result: Awaited<ReturnType<HomeConvertTriageMessagesToExplorerTarget>>;
  boardID: string;
  logicGateID: string;
  convertedMessageIDs: string[];
  unstarredMessageIDs: string[];
};

export type HomeMailMessagesCommandResult = {
	messageIDs: string[];
};

export type HomeMailArchiveCommandResult = HomeMailMessagesCommandResult & {
	archiveJob: CommunicationsArchiveJob;
};

export type HomeMailMessageCommandResult = {
  message: EmailMessage;
};

export type HomeMyWorkNodeMoveCommandResult = {
  nodes: NodeRecord[];
  gvic_projection_rows: RACIMatrixProjectionRow[];
  removed_projection_row_ids: string[];
};

export type HomeSendMailCommandResult = {
  sentMessage: EmailMessage;
  sentToConnectedAccount: boolean;
};

export type HomeSharedInboxCommandResult = {
  folder: CommunicationsSharedInbox;
  notice?: string;
};

export type HomeSharedInboxRACICommandResult = {
  folderID: string;
  assignments: CommunicationsSharedInboxRACIAssignment[];
};

export type HomeCreateNodeCommandResult = {
  node: NodeRecord;
  folderItems: CompanyExplorerFolderItem[];
};

export type HomeCreateLogicGateCommandResult = {
  logicGate: LogicGateRecord;
  folderItems: CompanyExplorerFolderItem[];
};

export type HomeCreateRACIMatrixNodeCommandResult = {
  node: NodeRecord;
  logicGate?: LogicGateRecord;
  folderItems: CompanyExplorerFolderItem[];
  gvic_projection_rows: RACIMatrixProjectionRow[];
};

export type HomeLogicGateDropCommandResult = {
  nodes: NodeRecord[];
  gvic_projection_rows: RACIMatrixProjectionRow[];
};

type HomeWorkspaceEntityBatchResponse = {
  nodes?: NodeRecord[];
  logic_gates?: LogicGateRecord[];
  folder_items?: CompanyExplorerFolderItem[];
};

type HomeDeleteEntityTarget = {
  kind: HomeEntityDeleteKind;
  id: string;
};

type HomeDeleteEntitiesResponse = {
  status?: string;
  targets?: HomeDeleteEntityTarget[];
};

function noopKanbanBoardContentsInvalidator(): void {}
function noopNodeRecordInvalidator(): void {}
function noopNodeGraphNodeUpsert(): void {}
function noopFolderItemGraphUpsert(): void {}

type HomeEntityCreateRequestJSON = <T>(apiBase: string, path: string, init?: RequestJSONInit) => Promise<T>;

function bindHomeEntityCreateRequest(apiBase: string, requestJSON: HomeEntityCreateRequestJSON) {
  return <T>(path: string, init?: RequestInit): Promise<T> => requestJSON<T>(apiBase, path, init as RequestJSONInit);
}

function dispatchKanbanBoardsUpdated(detail: KanbanBoardsUpdatedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<KanbanBoardsUpdatedDetail>(EVENT_KANBAN_BOARDS_UPDATED, { detail }));
}

function dispatchKanbanBoardContentsUpdated(detail: KanbanBoardContentsUpdatedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<KanbanBoardContentsUpdatedDetail>(EVENT_KANBAN_BOARD_CONTENTS_UPDATED, { detail }));
}
export async function archiveHomeMailMessagesCommand(args: {
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  messageIDs: string[];
	archiveEmailMessagesBatch?: HomeArchiveEmailMessagesBatch;
}): Promise<HomeMailArchiveCommandResult | null> {
  const messageIDs = cleanIDList(args.messageIDs);
  if (messageIDs.length === 0) return null;
  const sharedInboxID = args.sharedInboxID?.trim() || undefined;
	const archiveEmailMessagesBatch = args.archiveEmailMessagesBatch ?? defaultArchiveEmailMessagesBatch;
	const accountEmail = sharedInboxID ? undefined : args.accountEmail?.trim().toLowerCase() || undefined;
	let archiveJob: CommunicationsArchiveJob;
	try {
		archiveJob = await archiveEmailMessagesBatch(messageIDs, sharedInboxID, args.companyID, { accountEmail });
  } catch (archiveError) {
    const error = archiveError instanceof Error ? archiveError.message : "archive_failed";
    throw new Error(error);
  }
	return { messageIDs: cleanIDList(archiveJob.accepted_message_ids), archiveJob };
}

export async function unarchiveHomeMailMessagesCommand(args: {
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  messageIDs: string[];
  unarchiveEmailMessage?: HomeUnarchiveEmailMessage;
}): Promise<HomeMailMessagesCommandResult | null> {
  const messageIDs = cleanIDList(args.messageIDs);
  if (messageIDs.length === 0) return null;
  const unarchiveEmailMessage = args.unarchiveEmailMessage ?? defaultUnarchiveEmailMessage;
  const sharedInboxID = args.sharedInboxID?.trim() || undefined;
  const accountEmail = sharedInboxID ? undefined : args.accountEmail?.trim().toLowerCase() || undefined;
  await Promise.all(messageIDs.map((messageID) => unarchiveEmailMessage(messageID, sharedInboxID, args.companyID, accountEmail)));
  return { messageIDs };
}

export async function deleteHomeMailMessagesCommand(args: {
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  messageIDs: string[];
  deleteEmailMessage?: HomeDeleteEmailMessage;
}): Promise<HomeMailMessagesCommandResult | null> {
  const messageIDs = cleanIDList(args.messageIDs);
  if (messageIDs.length === 0) return null;
  const deleteEmailMessage = args.deleteEmailMessage ?? defaultDeleteEmailMessage;
  const sharedInboxID = args.sharedInboxID?.trim() || undefined;
  const accountEmail = sharedInboxID ? undefined : args.accountEmail?.trim().toLowerCase() || undefined;
  await Promise.all(messageIDs.map((messageID) => deleteEmailMessage(messageID, sharedInboxID, args.companyID, accountEmail)));
  return { messageIDs };
}

export async function updateHomeMailMessageCommand(args: {
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  messageID: string;
  update: HomeMailMessageUpdate;
  updateEmailMessage?: HomeUpdateEmailMessage;
}): Promise<HomeMailMessageCommandResult | null> {
  const messageID = args.messageID.trim();
  if (!messageID) return null;
  const updateEmailMessage = args.updateEmailMessage ?? defaultUpdateEmailMessage;
  const sharedInboxID = args.sharedInboxID?.trim() || undefined;
  const accountEmail = sharedInboxID ? undefined : args.accountEmail?.trim().toLowerCase() || undefined;
  const message = await updateEmailMessage(messageID, args.update, sharedInboxID, args.companyID, accountEmail);
  return { message };
}

export async function sendHomeMailComposeCommand(args: {
  compose: Pick<ComposeState, "to" | "cc" | "bcc" | "subject" | "body" | "attachments" | "replyToMessageID"> & Partial<Pick<ComposeState, "kind" | "replyToMessage">>;
  companyID?: string;
  sharedInboxID?: string;
  connectedAccountEmail?: string;
  sendEmail?: HomeSendEmail;
}): Promise<HomeSendMailCommandResult> {
  const to = parseEmailAddressList(args.compose.to);
  const cc = parseEmailAddressList(args.compose.cc);
  const bcc = parseEmailAddressList(args.compose.bcc);
  if (to.length === 0 && cc.length === 0 && bcc.length === 0) {
    throw new Error("Add at least one recipient.");
  }
  const subject = args.compose.subject.trim();
  const bodyText = args.compose.body;
  const kind = args.compose.kind ?? (args.compose.replyToMessageID ? "reply" : "compose");
  const body = kind === "forward"
    ? buildForwardedComposeBody(bodyText, args.compose.replyToMessage)
    : editorBodyHasEmailContent(bodyText) ? serializeEditorBodyForEmailHTML(bodyText) : "";
  const attachments = (args.compose.attachments ?? [])
    .map((attachment) => ({
      id: attachment.attachmentID.trim(),
      attachment_id: attachment.attachmentID.trim(),
      filename: attachment.filename.trim() || "attachment",
      content_type: attachment.contentType.trim() || "application/octet-stream",
      size: attachment.size,
    }))
    .filter((attachment) => attachment.attachment_id);
  if (!subject && !body && attachments.length === 0) {
    throw new Error("Add a subject or message body.");
  }
  const input: SendEmailInput = {
    to,
    cc,
    bcc,
    subject,
    body,
    attachments,
    reply_to_message_id: kind === "reply" ? args.compose.replyToMessageID || undefined : undefined,
  };
  const cleanCompanyID = args.companyID?.trim() ?? "";
  const cleanSharedInboxID = args.sharedInboxID?.trim() ?? "";
  if (cleanCompanyID) {
    input.company_id = cleanCompanyID;
  }
  if (cleanSharedInboxID) {
    input.shared_inbox_id = cleanSharedInboxID;
  }
  const cleanConnectedAccountEmail = args.connectedAccountEmail?.trim().toLowerCase() ?? "";
  if (cleanConnectedAccountEmail && !cleanSharedInboxID) input.account_email = cleanConnectedAccountEmail;
  const sentToConnectedAccount = !!cleanConnectedAccountEmail && [...to, ...cc, ...bcc].some((address) => (
    address.email.trim().toLowerCase() === cleanConnectedAccountEmail
  ));
  const sendEmail = args.sendEmail ?? defaultSendEmail;
  const sentMessage = await sendEmail(input);
  return { sentMessage, sentToConnectedAccount };
}
export async function dropNodesIntoInboxLogicGateCommand(args: {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  fromLogicGateID?: string;
  nodeIDs: string[];
  priority: InboxPriority;
  status?: RACIInboxStatus;
  nodeByID: Map<string, NodeRecord>;
  assignNodeToLogicGateStatus?: HomeDropAssignNodeToLogicGateStatus;
  moveLogicGateAssignment?: HomeBulkMoveLogicGateAssignment;
  invalidateKanbanBoardContents?: HomeKanbanBoardContentsInvalidator;
}): Promise<HomeLogicGateDropCommandResult> {
  const logicGateID = args.logicGateID.trim();
  const rawFromLogicGateID = args.fromLogicGateID?.trim() ?? "";
  const fromLogicGateID = rawFromLogicGateID === INBOX_NO_LOGIC_GATE_ID ? "" : rawFromLogicGateID;
  const nodeIDs = cleanIDList(args.nodeIDs).filter((nodeID) => args.nodeByID.has(nodeID));
  if (!logicGateID || nodeIDs.length === 0) return { nodes: [], gvic_projection_rows: [] };

  const assignNodeToLogicGateStatus = args.assignNodeToLogicGateStatus ?? defaultAssignNodeToLogicGateStatus;
  const moveLogicGateAssignment = args.moveLogicGateAssignment ?? defaultMoveLogicGateAssignment;
  const priority = args.priority === 0 ? null : args.priority;
  const results = await Promise.all(nodeIDs.map(async (nodeID) => {
    const node = args.nodeByID.get(nodeID);
    if (!node) return null;
    const status = args.status ?? normalizeRACIInboxStatus(node.status) ?? "pending";
    if (fromLogicGateID) {
      const result = await moveLogicGateAssignment({
        apiBase: args.apiBase,
        companyID: args.companyID,
        logicGateID,
        fromLogicGateID,
        nodeID,
        status,
        priority,
        position: 0,
      });
      args.invalidateKanbanBoardContents?.(args.apiBase, args.companyID, result.card.board_id);
      if (fromLogicGateID !== logicGateID) {
        args.invalidateKanbanBoardContents?.(args.apiBase, args.companyID, logicGateKanbanBoardID(fromLogicGateID));
      }
      return result;
    }
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
    return result;
  }));
  const assignmentResults = results.filter((result): result is LogicGateAssignmentCommandResult => result !== null);
  return {
    nodes: assignmentResults.map((result) => result.node),
    gvic_projection_rows: assignmentResults.flatMap((result) => result.gvic_projection_rows),
  };
}

export async function moveMyWorkNodesToCellCommand(args: {
  apiBase: string;
  companyID: string;
  nodeIDs: string[];
  priority: InboxPriority;
  targetRACIRole: LogicGateRACIRole;
  targetUserID?: string;
  logicGateID?: string;
  fromLogicGateID?: string;
  nodeByID: Map<string, NodeRecord>;
  moveMyWorkNodeToCell?: HomeMoveMyWorkNodeToCell;
}): Promise<HomeMyWorkNodeMoveCommandResult> {
  const nodeIDs = cleanIDList(args.nodeIDs).filter((nodeID) => args.nodeByID.has(nodeID));
  if (nodeIDs.length === 0) return { nodes: [], gvic_projection_rows: [], removed_projection_row_ids: [] };

  const moveMyWorkNodeToCell = args.moveMyWorkNodeToCell ?? defaultMoveMyWorkNodeToCell;
  const priority = args.priority === 0 ? null : args.priority;
  const results = await Promise.all(nodeIDs.map((nodeID) => moveMyWorkNodeToCell({
    apiBase: args.apiBase,
    companyID: args.companyID,
    nodeID,
    targetUserID: args.targetUserID,
    targetRACIRole: args.targetRACIRole,
    priority,
    logicGateID: args.logicGateID,
    fromLogicGateID: args.fromLogicGateID,
  })));

  const removedProjectionRowIDs: string[] = [];
  const seenRemovedIDs = new Set<string>();
  for (const result of results) {
    for (const projectionRowID of result.removed_projection_row_ids ?? []) {
      const cleanID = projectionRowID.trim();
      if (!cleanID || seenRemovedIDs.has(cleanID)) continue;
      seenRemovedIDs.add(cleanID);
      removedProjectionRowIDs.push(cleanID);
    }
  }

  return {
    nodes: results.map((result: MyWorkNodeMoveResult) => result.node).filter((node): node is NodeRecord => Boolean(node)),
    gvic_projection_rows: results.flatMap((result) => result.gvic_projection_rows ?? []),
    removed_projection_row_ids: removedProjectionRowIDs,
  };
}

export async function addNodesToLogicGateCommand(args: {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  nodeIDs: string[];
  nodeByID: Map<string, NodeRecord>;
  assignNodeToLogicGateStatus?: HomeDropAssignNodeToLogicGateStatus;
  invalidateKanbanBoardContents?: HomeKanbanBoardContentsInvalidator;
}): Promise<NodeRecord[]> {
  const logicGateID = args.logicGateID.trim();
  const nodeIDs = cleanIDList(args.nodeIDs).filter((nodeID) => args.nodeByID.has(nodeID));
  if (!logicGateID || nodeIDs.length === 0) return [];

  const assignNodeToLogicGateStatus = args.assignNodeToLogicGateStatus ?? defaultAssignNodeToLogicGateStatus;
  return Promise.all(nodeIDs.map(async (nodeID) => {
    const node = args.nodeByID.get(nodeID);
    if (!node) return null;
    const priority = typeof node.priority === "number" && node.priority >= 1 && node.priority <= 5 ? node.priority : null;
    const status = normalizeRACIInboxStatus(node.status) ?? "pending";
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

export async function createHomeNodeCommand(args: {
  apiBase: string;
  companyID: string;
  name?: string;
  requestJSON?: HomeEntityCreateRequestJSON;
}): Promise<HomeCreateNodeCommandResult> {
  const requestJSON = args.requestJSON ?? defaultRequestJSON;
  const response = await createWorkspaceEntityBatchCommand<HomeWorkspaceEntityBatchResponse>({
    companyID: args.companyID,
    entityKind: "node",
    mutationOrigin: "matrix",
    items: [{
      client_id: createWorkspaceEntityBatchClientID("home-node"),
      name: args.name?.trim() || "new node",
    }],
    requestJSON: bindHomeEntityCreateRequest(args.apiBase, requestJSON),
  });
  const node = response.nodes?.[0];
  if (!node) throw new Error("node_batch_create_missing_node");
  return { node, folderItems: response.folder_items ?? [] };
}

export async function createHomeLogicGateCommand(args: {
  apiBase: string;
  companyID: string;
  title?: string;
  creatorRACIRole?: LogicGateRACIRole;
  requestJSON?: HomeEntityCreateRequestJSON;
}): Promise<HomeCreateLogicGateCommandResult> {
  const requestJSON = args.requestJSON ?? defaultRequestJSON;
  const response = await createWorkspaceEntityBatchCommand<HomeWorkspaceEntityBatchResponse>({
    companyID: args.companyID,
    entityKind: "logic_gate",
    creatorLogicGateRACIRole: args.creatorRACIRole,
    mutationOrigin: "matrix",
    items: [{
      client_id: createWorkspaceEntityBatchClientID("home-logic-gate"),
      title: args.title?.trim() || "new logic gate",
    }],
    requestJSON: bindHomeEntityCreateRequest(args.apiBase, requestJSON),
  });
  const logicGate = response.logic_gates?.[0];
  if (!logicGate) throw new Error("logic_gate_batch_create_missing_gate");
  return { logicGate, folderItems: response.folder_items ?? [] };
}

export async function createHomeRACIMatrixNodeCommand(args: {
  apiBase: string;
  companyID: string;
  title?: string;
  logicGateID?: string;
  createLogicGateTitle?: string;
  creatorRACIRole?: LogicGateRACIRole;
  priority: InboxPriority;
  status?: RACIInboxStatus;
  createRACIMatrixNode?: HomeCreateRACIMatrixNode;
}): Promise<HomeCreateRACIMatrixNodeCommandResult> {
  const createRACIMatrixNode = args.createRACIMatrixNode ?? defaultCreateRACIMatrixNode;
  const result = await createRACIMatrixNode({
    apiBase: args.apiBase,
    companyID: args.companyID,
    name: args.title?.trim() || "new node",
    logicGateID: args.logicGateID,
    createLogicGateHeader: args.createLogicGateTitle,
    creatorLogicGateRACIRole: args.creatorRACIRole,
    priority: args.priority === 0 ? null : args.priority,
    status: args.status ?? "pending",
    position: 0,
  });
  return {
    node: result.node,
    logicGate: result.logic_gate,
    folderItems: result.folder_items ?? [],
    gvic_projection_rows: result.gvic_projection_rows,
  };
}

export async function deleteHomeEntitiesCommand(args: {
  apiBase: string;
  companyID: string;
  targets: HomeDeleteEntityTarget[];
  confirmationDisplayName: string;
  requestJSON?: HomeEntityCreateRequestJSON;
}): Promise<HomeDeleteEntitiesResponse | null> {
  const seen = new Set<string>();
  const targets: HomeDeleteEntityTarget[] = [];
  for (const target of args.targets) {
    const id = target.id.trim();
    if (!id || (target.kind !== "node" && target.kind !== "logic_gate")) continue;
    const key = `${target.kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ kind: target.kind, id });
  }
  if (targets.length === 0) return null;

  const requestJSON = args.requestJSON ?? defaultRequestJSON;
  await Promise.all(targets.map((target) => {
    const endpoint = target.kind === "node"
      ? `/v1/nodes/${encodeURIComponent(target.id)}?company_id=${encodeURIComponent(args.companyID)}`
      : `/v1/logic-gates/${encodeURIComponent(target.id)}?company_id=${encodeURIComponent(args.companyID)}`;
    return requestJSON(args.apiBase, endpoint, {
      method: "DELETE",
      headers: { "X-Mango-Confirmation-Display-Name": args.confirmationDisplayName },
    });
  }));

  for (const target of targets) {
    if (target.kind === "logic_gate") {
      dispatchKanbanBoardsUpdated({ companyID: args.companyID, deletedBoardID: logicGateKanbanBoardID(target.id) });
    }
  }
  return { status: "ok", targets };
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
  const status = normalizeRACIInboxStatus(args.patch.status);
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
export async function updateSharedInboxAccountEmailCommand(args: {
  companyID: string;
  folderID: string;
  accountEmail: string;
  updateSharedInbox?: HomeUpdateSharedInbox;
}): Promise<HomeSharedInboxCommandResult | null> {
  const folderID = args.folderID.trim();
  if (!folderID) return null;
  const updateSharedInbox = args.updateSharedInbox ?? defaultUpdateCommunicationsSharedInbox;
  const folder = await updateSharedInbox({ companyID: args.companyID, folderID, accountEmail: args.accountEmail });
  return { folder, notice: folder.account_email ? `Attached ${folder.account_email}.` : "Email removed." };
}

export async function saveSharedInboxRACIAssignmentsCommand(args: {
  companyID: string;
  folderID: string;
  assignments: CommunicationsSharedInboxRACIAssignment[];
  updateSharedInboxRACIAssignments?: HomeUpdateSharedInboxRACIAssignments;
}): Promise<HomeSharedInboxRACICommandResult | null> {
  const folderID = args.folderID.trim();
  if (!folderID) return null;
  const directAssignments = args.assignments.filter((assignment) => assignment.folder_id === folderID);
  const updateSharedInboxRACIAssignments = args.updateSharedInboxRACIAssignments ?? defaultUpdateCommunicationsSharedInboxRACIAssignments;
  const assignments = await updateSharedInboxRACIAssignments(
    args.companyID,
    folderID,
    directAssignments.map((assignment) => ({
      role: assignment.role,
      principal_type: assignment.principal_type ?? "user",
      principal_id: assignment.principal_id ?? assignment.user_id,
      user_id: assignment.user_id,
    })),
  );
  return { folderID, assignments };
}

export async function addSharedInboxRACIPrincipalCommand(args: {
  companyID: string;
  folderID: string;
  role: CommunicationsSharedInboxRACIRole;
  principalType: CommunicationsSharedInboxRACIPrincipalType;
  principalID: string;
  principalName?: string;
  sharedInboxes: CommunicationsSharedInbox[];
  companyUsers: CompanyUser[];
  now?: () => string;
  updateSharedInboxRACIAssignments?: HomeUpdateSharedInboxRACIAssignments;
}): Promise<HomeSharedInboxRACICommandResult | null> {
  const folderID = args.folderID.trim();
  const principalID = args.principalID.trim();
  if (!folderID || !principalID) return null;
  const folder = args.sharedInboxes.find((item) => item.folder_id === folderID);
  const principalType = args.principalType;
  if (!folder || (folder.gvic_assignments ?? []).some((assignment) => (
    assignment.role === args.role
    && (assignment.principal_type ?? "user") === principalType
    && (assignment.principal_id ?? assignment.user_id) === principalID
  ))) {
    return null;
  }
  const user = principalType === "user" ? args.companyUsers.find((item) => item.user_id === principalID) : undefined;
  return saveSharedInboxRACIAssignmentsCommand({
    companyID: args.companyID,
    folderID,
    assignments: [
      ...(folder.gvic_assignments ?? []),
      {
        company_id: args.companyID,
        folder_id: folderID,
        role: args.role,
        principal_type: principalType,
        principal_id: principalID,
        principal_name: args.principalName ?? user?.display_name ?? user?.email,
        user_id: principalType === "user" ? principalID : "",
        user_display_name: user?.display_name,
        user_email: user?.email,
        created_timestamp: args.now?.() ?? new Date().toISOString(),
      },
    ],
    updateSharedInboxRACIAssignments: args.updateSharedInboxRACIAssignments,
  });
}

export async function removeSharedInboxRACIPrincipalCommand(args: {
  companyID: string;
  folderID: string;
  role: CommunicationsSharedInboxRACIRole;
  principalType: CommunicationsSharedInboxRACIPrincipalType;
  principalID: string;
  sharedInboxes: CommunicationsSharedInbox[];
  updateSharedInboxRACIAssignments?: HomeUpdateSharedInboxRACIAssignments;
}): Promise<HomeSharedInboxRACICommandResult | null> {
  const folderID = args.folderID.trim();
  const principalID = args.principalID.trim();
  if (!folderID || !principalID) return null;
  const folder = args.sharedInboxes.find((item) => item.folder_id === folderID);
  if (!folder) return null;
  const directAssignments = (folder.gvic_assignments ?? []).filter((assignment) => assignment.folder_id === folderID);
  const assignments = directAssignments.filter((assignment) => !(
    assignment.role === args.role
    && (assignment.principal_type ?? "user") === args.principalType
    && (assignment.principal_id ?? assignment.user_id) === principalID
  ));
  if (assignments.length === directAssignments.length) return null;
  return saveSharedInboxRACIAssignmentsCommand({
    companyID: args.companyID,
    folderID,
    assignments,
    updateSharedInboxRACIAssignments: args.updateSharedInboxRACIAssignments,
  });
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

function explorerTargetLogicGateID(target: CommunicationsTriageConversionTarget): string {
  switch (target.mode) {
    case "existing_logic_gate":
      return target.logicGateID.trim();
    case "existing_node":
      return target.logicGateID?.trim() ?? "";
    default:
      return "";
  }
}

function explorerConversionTargetIsValid(target: CommunicationsTriageConversionTarget): boolean {
  switch (target.mode) {
    case "existing_logic_gate":
      return target.logicGateID.trim().length > 0;
    case "existing_node":
      return target.nodeID.trim().length > 0;
    case "folder":
      return Boolean(target.folderID?.trim() || target.parentEntityID?.trim());
    case "project":
      return target.projectID.trim().length > 0;
    default:
      return false;
  }
}

export async function convertMessagesToExplorerTargetCommand(args: {
  apiBase: string;
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  target: CommunicationsTriageConversionTarget;
  messageIDs: string[];
  priority?: number;
  convertTriageMessagesToExplorerTarget?: HomeConvertTriageMessagesToExplorerTarget;
  invalidateKanbanBoardList?: typeof defaultInvalidateKanbanBoardListCache;
  invalidateKanbanBoardContents?: HomeKanbanBoardContentsInvalidator;
  invalidateLogicGateArenaView?: typeof defaultInvalidateLogicGateArenaViewCache;
  dispatchKanbanBoardsUpdated?: (detail: KanbanBoardsUpdatedDetail) => void;
  dispatchKanbanBoardContentsUpdated?: (detail: KanbanBoardContentsUpdatedDetail) => void;
  invalidateNodeRecord?: HomeNodeRecordInvalidator;
  upsertNodeRelationshipGraphNode?: HomeNodeGraphNodeUpsert;
  upsertNodeFolderItemInRelationshipGraph?: HomeFolderItemGraphUpsert;
  upsertLogicGateFolderItemInRelationshipGraph?: HomeFolderItemGraphUpsert;
}): Promise<HomeExplorerTriageConversionCommandResult | null> {
  const companyID = args.companyID.trim();
  const messageIDs = cleanIDList(args.messageIDs);
  if (!companyID || messageIDs.length === 0 || !explorerConversionTargetIsValid(args.target)) return null;

  const priority = typeof args.priority === "number" && Number.isInteger(args.priority) && args.priority >= 1 && args.priority <= 5
    ? args.priority
    : undefined;
  const convertTriageMessagesToExplorerTarget = args.convertTriageMessagesToExplorerTarget ?? defaultConvertTriageMessagesToExplorerTarget;
  const sharedInboxID = args.sharedInboxID?.trim() || undefined;
  const accountEmail = sharedInboxID ? undefined : args.accountEmail?.trim().toLowerCase() || undefined;
  const conversionInput: Parameters<HomeConvertTriageMessagesToExplorerTarget>[0] = {
    companyID,
    target: args.target,
    messageIDs,
    priority,
  };
  if (sharedInboxID) conversionInput.sharedInboxID = sharedInboxID;
  if (accountEmail) conversionInput.accountEmail = accountEmail;
  const result = await convertTriageMessagesToExplorerTarget(conversionInput);

  const targetLogicGateID = explorerTargetLogicGateID(args.target);
  const boardID = result.board?.board_id?.trim() || (targetLogicGateID ? logicGateKanbanBoardID(targetLogicGateID) : "");
  const boardLogicGateID = result.board?.logic_gate_id?.trim() || targetLogicGateID;
  const invalidateKanbanBoardList = args.invalidateKanbanBoardList ?? defaultInvalidateKanbanBoardListCache;
  const invalidateKanbanBoardContents = args.invalidateKanbanBoardContents ?? noopKanbanBoardContentsInvalidator;
  const invalidateLogicGateArenaView = args.invalidateLogicGateArenaView ?? defaultInvalidateLogicGateArenaViewCache;
  const emitKanbanBoardsUpdated = args.dispatchKanbanBoardsUpdated ?? dispatchKanbanBoardsUpdated;
  const emitKanbanBoardContentsUpdated = args.dispatchKanbanBoardContentsUpdated ?? dispatchKanbanBoardContentsUpdated;
  const invalidateNodeRecord = args.invalidateNodeRecord ?? noopNodeRecordInvalidator;
  const upsertNodeRelationshipGraphNode = args.upsertNodeRelationshipGraphNode ?? noopNodeGraphNodeUpsert;
  const upsertNodeFolderItemInRelationshipGraph = args.upsertNodeFolderItemInRelationshipGraph ?? noopFolderItemGraphUpsert;
  const upsertLogicGateFolderItemInRelationshipGraph = args.upsertLogicGateFolderItemInRelationshipGraph ?? noopFolderItemGraphUpsert;

  if (boardID && boardLogicGateID) {
    invalidateKanbanBoardList(args.apiBase, companyID);
    invalidateKanbanBoardContents(args.apiBase, companyID, boardID);
    invalidateLogicGateArenaView(args.apiBase, companyID, boardLogicGateID);
    emitKanbanBoardsUpdated({ companyID, board: result.board });
    emitKanbanBoardContentsUpdated({ companyID, boardID, logicGateID: boardLogicGateID });
  }
  for (const node of result.nodes ?? []) {
    invalidateNodeRecord(args.apiBase, companyID, node.node_id);
    upsertNodeRelationshipGraphNode(args.apiBase, companyID, node);
  }
  for (const item of result.folder_items ?? []) {
    upsertNodeFolderItemInRelationshipGraph(args.apiBase, companyID, item);
    upsertLogicGateFolderItemInRelationshipGraph(args.apiBase, companyID, item);
  }

  const convertedMessageIDs = result.deleted_message_ids?.length ? result.deleted_message_ids : messageIDs;
  const unstarredMessageIDs = cleanIDList(result.unstarred_message_ids ?? []);
  return { result, boardID, logicGateID: boardLogicGateID, convertedMessageIDs, unstarredMessageIDs };
}
export async function convertMessagesToLogicGateCommand(args: {
  apiBase: string;
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  logicGateID: string;
  nodeID?: string;
  messageIDs: string[];
  priority?: number;
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
}): Promise<HomeTriageConversionCommandResult | null> {
  const logicGateID = args.logicGateID.trim();
  const nodeID = args.nodeID?.trim() ?? "";
  const messageIDs = cleanIDList(args.messageIDs);
  if (!logicGateID || messageIDs.length === 0) return null;

  const priority = typeof args.priority === "number" && Number.isInteger(args.priority) && args.priority >= 1 && args.priority <= 5
    ? args.priority
    : undefined;
  const convertTriageMessagesToLogicGate = args.convertTriageMessagesToLogicGate ?? defaultConvertTriageMessagesToLogicGate;
  const conversionInput: Parameters<HomeConvertTriageMessagesToLogicGate>[0] = {
    companyID: args.companyID,
    logicGateID,
    messageIDs,
    priority,
  };
  const sharedInboxID = args.sharedInboxID?.trim() || undefined;
  if (sharedInboxID) conversionInput.sharedInboxID = sharedInboxID;
  const accountEmail = sharedInboxID ? undefined : args.accountEmail?.trim().toLowerCase() || undefined;
  if (accountEmail) conversionInput.accountEmail = accountEmail;
  if (nodeID) conversionInput.nodeID = nodeID;
  const result = await convertTriageMessagesToLogicGate(conversionInput);
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

  const convertedMessageIDs = result.deleted_message_ids?.length ? result.deleted_message_ids : messageIDs;
  const unstarredMessageIDs = cleanIDList(result.unstarred_message_ids ?? []);
  return {
    result,
    boardID,
    logicGateID: boardLogicGateID,
    convertedMessageIDs,
    unstarredMessageIDs,
  };
}
