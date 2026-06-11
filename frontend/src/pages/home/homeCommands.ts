import {
  archiveEmailMessage as defaultArchiveEmailMessage,
  archiveEmailMessagesBatch as defaultArchiveEmailMessagesBatch,
  addMyLogicGateShortcuts as defaultAddMyLogicGateShortcuts,
  convertTriageMessagesToLogicGate as defaultConvertTriageMessagesToLogicGate,
  createCommunicationsSharedInbox as defaultCreateCommunicationsSharedInbox,
  deleteCommunicationsSharedInbox as defaultDeleteCommunicationsSharedInbox,
  deleteEmailMessage as defaultDeleteEmailMessage,
  invalidateCommunicationsCache as defaultInvalidateCommunicationsCache,
  removeMyLogicGateShortcut as defaultRemoveMyLogicGateShortcut,
  parseEmailAddressList,
  sendEmail as defaultSendEmail,
  unarchiveEmailMessage as defaultUnarchiveEmailMessage,
  updateCommunicationsSharedInbox as defaultUpdateCommunicationsSharedInbox,
  updateCommunicationsSharedInboxRaciAssignments as defaultUpdateCommunicationsSharedInboxRaciAssignments,
  updateEmailMessage as defaultUpdateEmailMessage,
  updateNode as defaultUpdateNode,
} from "../../modules/communications/communicationsApi.js";
import { requestJSON as defaultRequestJSON, type RequestJSONInit } from "../../modules/api/requestJSON.js";
import type { LogicGateRaciRole, LogicGateRecord } from "../../modules/logic-gate-map/shared.js";
import type {
  CompanyUser,
  ArchiveEmailMessagesBatchResult,
  CommunicationsSharedInbox,
  CommunicationsSharedInboxRaciAssignment,
  CommunicationsSharedInboxRaciRole,
  CommunicationsSharedInboxRaciSubjectType,
  EmailMessage,
  SendEmailInput,
  UserLogicGateShortcut,
} from "../../modules/communications/communicationsApi.js";
import type { ExplorerDragPayload } from "../../modules/company-explorer/companyExplorerTypes.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../modules/folders/companyExplorerFolders.js";
import {
  assignNodeToLogicGateStatus as defaultAssignNodeToLogicGateStatus,
  createRacioMatrixNode as defaultCreateRacioMatrixNode,
  invalidateKanbanBoardListCache as defaultInvalidateKanbanBoardListCache,
  invalidateLogicGateArenaViewCache as defaultInvalidateLogicGateArenaViewCache,
  moveLogicGateAssignment as defaultMoveLogicGateAssignment,
} from "../../modules/kanban/kanbanApi.js";
import type { LogicGateAssignmentCommandResult, RacioMatrixProjectionRow } from "../../modules/kanban/kanbanApi.js";
import {
  EVENT_KANBAN_BOARD_CONTENTS_UPDATED,
  EVENT_KANBAN_BOARDS_UPDATED,
  logicGateKanbanBoardID,
  type KanbanBoardContentsUpdatedDetail,
  type KanbanBoardsUpdatedDetail,
} from "../../modules/kanban/shared.js";
import type { NodeRecord } from "../../modules/node-map/shared.js";
import { createWorkspaceEntityBatchClientID, createWorkspaceEntityBatchCommand } from "../../modules/workspace/workspaceEntityCommands.js";
import {
  cleanIDList,
  collectSharedInboxSubtreeIDs,
  logicGateIDsFromExplorerPayload,
  nodeTitle,
  normalizeResponsibleInboxStatus,
} from "./homeUtils.js";
import { INBOX_NO_LOGIC_GATE_ID } from "./homeConstants.js";
import type { ComposeState, HomeEntityDeleteKind, HomeViewID, InboxPriority, ResponsibleInboxStatus } from "./homeTypes.js";

export type HomeDropAssignNodeToLogicGateStatus = (
  args: Parameters<typeof defaultAssignNodeToLogicGateStatus>[0],
) => Promise<LogicGateAssignmentCommandResult>;

export type HomeBulkMoveLogicGateAssignment = (
  args: Parameters<typeof defaultMoveLogicGateAssignment>[0],
) => Promise<LogicGateAssignmentCommandResult>;

export type HomeCreateRacioMatrixNode = typeof defaultCreateRacioMatrixNode;

export type HomeArchiveEmailMessage = typeof defaultArchiveEmailMessage;
export type HomeArchiveEmailMessagesBatch = typeof defaultArchiveEmailMessagesBatch;
export type HomeUnarchiveEmailMessage = typeof defaultUnarchiveEmailMessage;
export type HomeDeleteEmailMessage = typeof defaultDeleteEmailMessage;
export type HomeUpdateEmailMessage = typeof defaultUpdateEmailMessage;
export type HomeSendEmail = typeof defaultSendEmail;
export type HomeBulkUpdateNode = typeof defaultUpdateNode;
export type HomeAddMyLogicGateShortcuts = typeof defaultAddMyLogicGateShortcuts;
export type HomeRemoveMyLogicGateShortcut = typeof defaultRemoveMyLogicGateShortcut;
export type HomeConvertTriageMessagesToLogicGate = typeof defaultConvertTriageMessagesToLogicGate;
export type HomeCreateSharedInbox = typeof defaultCreateCommunicationsSharedInbox;
export type HomeUpdateSharedInbox = typeof defaultUpdateCommunicationsSharedInbox;
export type HomeDeleteSharedInbox = typeof defaultDeleteCommunicationsSharedInbox;
export type HomeUpdateSharedInboxRaciAssignments = typeof defaultUpdateCommunicationsSharedInboxRaciAssignments;

export type HomeBulkNodePatch = Partial<Pick<NodeRecord, "assignee_user_id" | "priority" | "status" | "due_date">>;
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
};

export type HomeMailMessagesCommandResult = {
  messageIDs: string[];
  failed?: ArchiveEmailMessagesBatchResult["failed"];
};

export type HomeMailMessageCommandResult = {
  message: EmailMessage;
};

export type HomeSendMailCommandResult = {
  sentMessage: EmailMessage;
  sentToConnectedAccount: boolean;
};

function escapeEmailBodyHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function linkifyEmailBodyLine(value: string): string {
  const urlPattern = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
  let output = "";
  let cursor = 0;
  for (const match of value.matchAll(urlPattern)) {
    const matchText = match[0] ?? "";
    const index = match.index ?? 0;
    if (index > cursor) output += escapeEmailBodyHTML(value.slice(cursor, index));
    const trailingPunctuation = matchText.match(/[),.;:!?]+$/)?.[0] ?? "";
    const cleanURL = trailingPunctuation ? matchText.slice(0, -trailingPunctuation.length) : matchText;
    const href = cleanURL.toLowerCase().startsWith("www.") ? `https://${cleanURL}` : cleanURL;
    output += `<a href="${escapeEmailBodyHTML(href)}" target="_blank" rel="noopener noreferrer" style="color:#0369a1;text-decoration:underline;">${escapeEmailBodyHTML(cleanURL)}</a>${escapeEmailBodyHTML(trailingPunctuation)}`;
    cursor = index + matchText.length;
  }
  return output + escapeEmailBodyHTML(value.slice(cursor));
}

function plainTextEmailBodyToHTML(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  return `<div style="font:14px/1.5 Arial,sans-serif;color:#111827;">${lines.map(linkifyEmailBodyLine).join("<br>")}</div>`;
}

export type HomeSharedInboxCommandResult = {
  folder: CommunicationsSharedInbox;
  viewID?: HomeViewID;
  notice?: string;
};

export type HomeSharedInboxDeleteCommandResult = {
  deletedFolderIDs: string[];
};

export type HomeSharedInboxRaciCommandResult = {
  folderID: string;
  assignments: CommunicationsSharedInboxRaciAssignment[];
};

export type HomeCreateNodeCommandResult = {
  node: NodeRecord;
  folderItems: CompanyExplorerFolderItem[];
};

export type HomeCreateLogicGateCommandResult = {
  logicGate: LogicGateRecord;
  folderItems: CompanyExplorerFolderItem[];
};

export type HomeCreateRacioMatrixNodeCommandResult = {
  node: NodeRecord;
  logicGate?: LogicGateRecord;
  folderItems: CompanyExplorerFolderItem[];
  racio_projection_rows: RacioMatrixProjectionRow[];
};

export type HomeLogicGateDropCommandResult = {
  nodes: NodeRecord[];
  racio_projection_rows: RacioMatrixProjectionRow[];
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
  messageIDs: string[];
  archiveEmailMessage?: HomeArchiveEmailMessage;
  archiveEmailMessagesBatch?: HomeArchiveEmailMessagesBatch;
}): Promise<HomeMailMessagesCommandResult | null> {
  const messageIDs = cleanIDList(args.messageIDs);
  if (messageIDs.length === 0) return null;
  const sharedInboxID = args.sharedInboxID?.trim() || undefined;
  if (args.archiveEmailMessage && !args.archiveEmailMessagesBatch) {
    const archiveEmailMessage = args.archiveEmailMessage;
    await Promise.all(messageIDs.map((messageID) => archiveEmailMessage(messageID, sharedInboxID, args.companyID)));
    return { messageIDs };
  }
  const archiveEmailMessagesBatch = args.archiveEmailMessagesBatch ?? defaultArchiveEmailMessagesBatch;
  const archivedIDs: string[] = [];
  const failed: ArchiveEmailMessagesBatchResult["failed"] = [];
  for (let index = 0; index < messageIDs.length; index += 5) {
    const result = await archiveEmailMessagesBatch(messageIDs.slice(index, index + 5), sharedInboxID, args.companyID);
    archivedIDs.push(...cleanIDList(result.archived_ids));
    failed.push(...(result.failed ?? []));
  }
  if (archivedIDs.length === 0 && failed.length > 0) {
    throw new Error(failed[0]?.error || "archive_failed");
  }
  return { messageIDs: archivedIDs.length > 0 ? archivedIDs : messageIDs, failed: failed.length ? failed : undefined };
}

export async function unarchiveHomeMailMessagesCommand(args: {
  companyID: string;
  sharedInboxID?: string;
  messageIDs: string[];
  unarchiveEmailMessage?: HomeUnarchiveEmailMessage;
}): Promise<HomeMailMessagesCommandResult | null> {
  const messageIDs = cleanIDList(args.messageIDs);
  if (messageIDs.length === 0) return null;
  const unarchiveEmailMessage = args.unarchiveEmailMessage ?? defaultUnarchiveEmailMessage;
  const sharedInboxID = args.sharedInboxID?.trim() || undefined;
  await Promise.all(messageIDs.map((messageID) => unarchiveEmailMessage(messageID, sharedInboxID, args.companyID)));
  return { messageIDs };
}

export async function deleteHomeMailMessagesCommand(args: {
  companyID: string;
  sharedInboxID?: string;
  messageIDs: string[];
  deleteEmailMessage?: HomeDeleteEmailMessage;
}): Promise<HomeMailMessagesCommandResult | null> {
  const messageIDs = cleanIDList(args.messageIDs);
  if (messageIDs.length === 0) return null;
  const deleteEmailMessage = args.deleteEmailMessage ?? defaultDeleteEmailMessage;
  const sharedInboxID = args.sharedInboxID?.trim() || undefined;
  await Promise.all(messageIDs.map((messageID) => deleteEmailMessage(messageID, sharedInboxID, args.companyID)));
  return { messageIDs };
}

export async function updateHomeMailMessageCommand(args: {
  companyID: string;
  sharedInboxID?: string;
  messageID: string;
  update: HomeMailMessageUpdate;
  updateEmailMessage?: HomeUpdateEmailMessage;
}): Promise<HomeMailMessageCommandResult | null> {
  const messageID = args.messageID.trim();
  if (!messageID) return null;
  const updateEmailMessage = args.updateEmailMessage ?? defaultUpdateEmailMessage;
  const message = await updateEmailMessage(messageID, args.update, args.sharedInboxID?.trim() || undefined, args.companyID);
  return { message };
}

export async function sendHomeMailComposeCommand(args: {
  compose: Pick<ComposeState, "to" | "cc" | "bcc" | "subject" | "body" | "attachments" | "replyToMessageID">;
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
  const bodyText = args.compose.body.trim();
  const attachments = (args.compose.attachments ?? [])
    .map((attachment) => ({
      filename: attachment.filename.trim() || "attachment",
      content_type: attachment.contentType.trim() || "application/octet-stream",
      content: attachment.content,
      size: attachment.size,
    }))
    .filter((attachment) => attachment.content.trim());
  if (!subject && !bodyText && attachments.length === 0) {
    throw new Error("Add a subject or message body.");
  }
  const input: SendEmailInput = {
    to,
    cc,
    bcc,
    subject,
    body: bodyText ? plainTextEmailBodyToHTML(bodyText) : "",
    attachments,
    reply_to_message_id: args.compose.replyToMessageID || undefined,
  };
  const cleanCompanyID = args.companyID?.trim() ?? "";
  const cleanSharedInboxID = args.sharedInboxID?.trim() ?? "";
  if (cleanCompanyID && cleanSharedInboxID) {
    input.company_id = cleanCompanyID;
    input.shared_inbox_id = cleanSharedInboxID;
  }
  const cleanConnectedAccountEmail = args.connectedAccountEmail?.trim().toLowerCase() ?? "";
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
  status?: ResponsibleInboxStatus;
  nodeByID: Map<string, NodeRecord>;
  assignNodeToLogicGateStatus?: HomeDropAssignNodeToLogicGateStatus;
  moveLogicGateAssignment?: HomeBulkMoveLogicGateAssignment;
  invalidateKanbanBoardContents?: HomeKanbanBoardContentsInvalidator;
}): Promise<HomeLogicGateDropCommandResult> {
  const logicGateID = args.logicGateID.trim();
  const rawFromLogicGateID = args.fromLogicGateID?.trim() ?? "";
  const fromLogicGateID = rawFromLogicGateID === INBOX_NO_LOGIC_GATE_ID ? "" : rawFromLogicGateID;
  const nodeIDs = cleanIDList(args.nodeIDs).filter((nodeID) => args.nodeByID.has(nodeID));
  if (!logicGateID || nodeIDs.length === 0) return { nodes: [], racio_projection_rows: [] };

  const assignNodeToLogicGateStatus = args.assignNodeToLogicGateStatus ?? defaultAssignNodeToLogicGateStatus;
  const moveLogicGateAssignment = args.moveLogicGateAssignment ?? defaultMoveLogicGateAssignment;
  const priority = args.priority === 0 ? null : args.priority;
  const results = await Promise.all(nodeIDs.map(async (nodeID) => {
    const node = args.nodeByID.get(nodeID);
    if (!node) return null;
    const status = args.status ?? normalizeResponsibleInboxStatus(node.status) ?? "pending";
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
    racio_projection_rows: assignmentResults.flatMap((result) => result.racio_projection_rows),
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
    const status = normalizeResponsibleInboxStatus(node.status) ?? "pending";
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
  title?: string;
  requestJSON?: HomeEntityCreateRequestJSON;
}): Promise<HomeCreateNodeCommandResult> {
  const requestJSON = args.requestJSON ?? defaultRequestJSON;
  const response = await createWorkspaceEntityBatchCommand<HomeWorkspaceEntityBatchResponse>({
    companyID: args.companyID,
    entityKind: "node",
    mutationOrigin: "matrix",
    items: [{
      client_id: createWorkspaceEntityBatchClientID("home-node"),
      title: args.title?.trim() || "new node",
      x: 120,
      y: 120,
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
  creatorRaciRole?: LogicGateRaciRole;
  requestJSON?: HomeEntityCreateRequestJSON;
}): Promise<HomeCreateLogicGateCommandResult> {
  const requestJSON = args.requestJSON ?? defaultRequestJSON;
  const response = await createWorkspaceEntityBatchCommand<HomeWorkspaceEntityBatchResponse>({
    companyID: args.companyID,
    entityKind: "logic_gate",
    creatorLogicGateRaciRole: args.creatorRaciRole,
    mutationOrigin: "matrix",
    items: [{
      client_id: createWorkspaceEntityBatchClientID("home-logic-gate"),
      title: args.title?.trim() || "new logic gate",
      x: 120,
      y: 120,
    }],
    requestJSON: bindHomeEntityCreateRequest(args.apiBase, requestJSON),
  });
  const logicGate = response.logic_gates?.[0];
  if (!logicGate) throw new Error("logic_gate_batch_create_missing_gate");
  return { logicGate, folderItems: response.folder_items ?? [] };
}

export async function createHomeRacioMatrixNodeCommand(args: {
  apiBase: string;
  companyID: string;
  title?: string;
  logicGateID?: string;
  createLogicGateTitle?: string;
  creatorRaciRole?: LogicGateRaciRole;
  priority: InboxPriority;
  status?: ResponsibleInboxStatus;
  createRacioMatrixNode?: HomeCreateRacioMatrixNode;
}): Promise<HomeCreateRacioMatrixNodeCommandResult> {
  const createRacioMatrixNode = args.createRacioMatrixNode ?? defaultCreateRacioMatrixNode;
  const result = await createRacioMatrixNode({
    apiBase: args.apiBase,
    companyID: args.companyID,
    title: args.title?.trim() || "new node",
    logicGateID: args.logicGateID,
    createLogicGateHeader: args.createLogicGateTitle,
    creatorLogicGateRaciRole: args.creatorRaciRole,
    priority: args.priority === 0 ? null : args.priority,
    status: args.status ?? "pending",
    position: 0,
  });
  return {
    node: result.node,
    logicGate: result.logic_gate,
    folderItems: result.folder_items ?? [],
    racio_projection_rows: result.racio_projection_rows,
  };
}

export async function deleteHomeEntitiesCommand(args: {
  apiBase: string;
  companyID: string;
  targets: HomeDeleteEntityTarget[];
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
  const response = await requestJSON<HomeDeleteEntitiesResponse>(args.apiBase, "/v1/company-explorer/delete-batch", {
    method: "POST",
    body: JSON.stringify({
      company_id: args.companyID,
      targets,
    }),
  });

  for (const target of targets) {
    if (target.kind === "logic_gate") {
      dispatchKanbanBoardsUpdated({ companyID: args.companyID, deletedBoardID: logicGateKanbanBoardID(target.id) });
    }
  }
  return response ?? { status: "ok", targets };
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
export async function createSharedInboxCommand(args: {
  companyID: string;
  parentFolderID: string;
  rawName?: string;
  accountEmail?: string;
  createSharedInbox?: HomeCreateSharedInbox;
}): Promise<HomeSharedInboxCommandResult | null> {
  const name = (args.rawName ?? "New Folder").trim();
  if (!name) return null;
  const createSharedInbox = args.createSharedInbox ?? defaultCreateCommunicationsSharedInbox;
  const folder = await createSharedInbox({
    companyID: args.companyID,
    name,
    parentFolderID: args.parentFolderID,
    accountEmail: args.accountEmail,
  });
  return { folder, viewID: `shared:${folder.folder_id}` };
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
  return { folder, notice: folder.account_email ? `Attached ${folder.account_email}.` : "Email detached." };
}

export async function renameSharedInboxCommand(args: {
  companyID: string;
  folderID: string;
  name: string;
  updateSharedInbox?: HomeUpdateSharedInbox;
}): Promise<HomeSharedInboxCommandResult | null> {
  const folderID = args.folderID.trim();
  const name = args.name.trim();
  if (!folderID || !name) return null;
  const updateSharedInbox = args.updateSharedInbox ?? defaultUpdateCommunicationsSharedInbox;
  const folder = await updateSharedInbox({ companyID: args.companyID, folderID, name });
  return { folder };
}

export async function moveSharedInboxCommand(args: {
  companyID: string;
  folderID: string;
  parentFolderID: string;
  position: number;
  updateSharedInbox?: HomeUpdateSharedInbox;
}): Promise<HomeSharedInboxCommandResult | null> {
  const folderID = args.folderID.trim();
  if (!folderID) return null;
  const updateSharedInbox = args.updateSharedInbox ?? defaultUpdateCommunicationsSharedInbox;
  const folder = await updateSharedInbox({
    companyID: args.companyID,
    folderID,
    parentFolderID: args.parentFolderID,
    position: args.position,
  });
  return { folder };
}

export async function deleteSharedInboxCommand(args: {
  companyID: string;
  folderID: string;
  sharedInboxes: CommunicationsSharedInbox[];
  deleteSharedInbox?: HomeDeleteSharedInbox;
}): Promise<HomeSharedInboxDeleteCommandResult | null> {
  const folderID = args.folderID.trim();
  if (!folderID) return null;
  const deletedIDs = collectSharedInboxSubtreeIDs(args.sharedInboxes, folderID);
  if (deletedIDs.size === 0) deletedIDs.add(folderID);
  const deleteSharedInbox = args.deleteSharedInbox ?? defaultDeleteCommunicationsSharedInbox;
  await deleteSharedInbox(args.companyID, folderID);
  return { deletedFolderIDs: Array.from(deletedIDs) };
}

export async function saveSharedInboxRaciAssignmentsCommand(args: {
  companyID: string;
  folderID: string;
  assignments: CommunicationsSharedInboxRaciAssignment[];
  updateSharedInboxRaciAssignments?: HomeUpdateSharedInboxRaciAssignments;
}): Promise<HomeSharedInboxRaciCommandResult | null> {
  const folderID = args.folderID.trim();
  if (!folderID) return null;
  const directAssignments = args.assignments.filter((assignment) => assignment.folder_id === folderID);
  const updateSharedInboxRaciAssignments = args.updateSharedInboxRaciAssignments ?? defaultUpdateCommunicationsSharedInboxRaciAssignments;
  const assignments = await updateSharedInboxRaciAssignments(
    args.companyID,
    folderID,
    directAssignments.map((assignment) => ({
      role: assignment.role,
      subject_type: assignment.subject_type ?? "user",
      subject_id: assignment.subject_id ?? assignment.user_id,
      user_id: assignment.user_id,
    })),
  );
  return { folderID, assignments };
}

export async function addSharedInboxRaciSubjectCommand(args: {
  companyID: string;
  folderID: string;
  role: CommunicationsSharedInboxRaciRole;
  subjectType: CommunicationsSharedInboxRaciSubjectType;
  subjectID: string;
  subjectName?: string;
  sharedInboxes: CommunicationsSharedInbox[];
  companyUsers: CompanyUser[];
  now?: () => string;
  updateSharedInboxRaciAssignments?: HomeUpdateSharedInboxRaciAssignments;
}): Promise<HomeSharedInboxRaciCommandResult | null> {
  const folderID = args.folderID.trim();
  const subjectID = args.subjectID.trim();
  if (!folderID || !subjectID) return null;
  const folder = args.sharedInboxes.find((item) => item.folder_id === folderID);
  const subjectType = args.subjectType;
  if (!folder || (folder.raci_assignments ?? []).some((assignment) => (
    assignment.role === args.role
    && (assignment.subject_type ?? "user") === subjectType
    && (assignment.subject_id ?? assignment.user_id) === subjectID
  ))) {
    return null;
  }
  const user = subjectType === "user" ? args.companyUsers.find((item) => item.user_id === subjectID) : undefined;
  return saveSharedInboxRaciAssignmentsCommand({
    companyID: args.companyID,
    folderID,
    assignments: [
      ...(folder.raci_assignments ?? []),
      {
        company_id: args.companyID,
        folder_id: folderID,
        role: args.role,
        subject_type: subjectType,
        subject_id: subjectID,
        subject_name: args.subjectName ?? user?.display_name ?? user?.email,
        user_id: subjectType === "user" ? subjectID : "",
        user_display_name: user?.display_name,
        user_email: user?.email,
        created_timestamp: args.now?.() ?? new Date().toISOString(),
      },
    ],
    updateSharedInboxRaciAssignments: args.updateSharedInboxRaciAssignments,
  });
}

export async function removeSharedInboxRaciSubjectCommand(args: {
  companyID: string;
  folderID: string;
  role: CommunicationsSharedInboxRaciRole;
  subjectType: CommunicationsSharedInboxRaciSubjectType;
  subjectID: string;
  sharedInboxes: CommunicationsSharedInbox[];
  updateSharedInboxRaciAssignments?: HomeUpdateSharedInboxRaciAssignments;
}): Promise<HomeSharedInboxRaciCommandResult | null> {
  const folderID = args.folderID.trim();
  const subjectID = args.subjectID.trim();
  if (!folderID || !subjectID) return null;
  const folder = args.sharedInboxes.find((item) => item.folder_id === folderID);
  if (!folder) return null;
  const directAssignments = (folder.raci_assignments ?? []).filter((assignment) => assignment.folder_id === folderID);
  const assignments = directAssignments.filter((assignment) => !(
    assignment.role === args.role
    && (assignment.subject_type ?? "user") === args.subjectType
    && (assignment.subject_id ?? assignment.user_id) === subjectID
  ));
  if (assignments.length === directAssignments.length) return null;
  return saveSharedInboxRaciAssignmentsCommand({
    companyID: args.companyID,
    folderID,
    assignments,
    updateSharedInboxRaciAssignments: args.updateSharedInboxRaciAssignments,
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

export async function convertMessagesToLogicGateCommand(args: {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  nodeID?: string;
  messageIDs: string[];
  priority: number;
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
  const nodeID = args.nodeID?.trim() ?? "";
  const messageIDs = cleanIDList(args.messageIDs);
  if (!logicGateID || messageIDs.length === 0) return null;

  const priority = Number.isInteger(args.priority) && args.priority >= 1 && args.priority <= 5 ? args.priority : 3;
  const convertTriageMessagesToLogicGate = args.convertTriageMessagesToLogicGate ?? defaultConvertTriageMessagesToLogicGate;
  const conversionInput: Parameters<HomeConvertTriageMessagesToLogicGate>[0] = {
    companyID: args.companyID,
    logicGateID,
    messageIDs,
    priority,
  };
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
