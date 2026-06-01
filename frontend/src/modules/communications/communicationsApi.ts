import { apiFetchJSON, getAuthSessionCacheGeneration, readAuthConfig } from "../../auth/cognitoAuth.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders.js";
import { logicGateKanbanBoardID, type KanbanBoard, type KanbanCard } from "../kanban/shared.js";
import type { NodeRecord } from "../node-map/shared.js";
import type { LogicGateRaciAssignment, LogicGateRaciRole, LogicGateRecord } from "../logic-gate-map/shared.js";
import { markWorkspaceSnapshotScopeStale } from "../workspace/workspaceSnapshotCache.js";

export type EmailProvider = "google" | "microsoft";

export type EmailConnection = {
  user_id: string;
  provider: EmailProvider;
  account_email: string;
  status: "connected" | "disconnected" | "reauth_required";
  created_timestamp: string;
  updated_timestamp: string;
};

export type CommunicationsStatus = {
  configured: boolean;
  connected: boolean;
  status: "connected" | "disconnected" | "reauth_required";
  connection?: EmailConnection;
};

export type EmailAddress = {
  name?: string;
  email: string;
};

export type EmailFolder = {
  id: string;
  name: string;
  display_name?: string;
  system_folder?: string;
  attributes?: string[];
  unread_count?: number;
  total_count?: number;
};

export type EmailMessage = {
  id: string;
  thread_id?: string;
  subject: string;
  snippet?: string;
  body?: string;
  date?: number;
  unread: boolean;
  starred: boolean;
  from?: EmailAddress[];
  to?: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  reply_to?: EmailAddress[];
  folders?: string[];
  folder_ids?: string[];
  logic_gate_ids?: string[];
  logic_gate_count?: number;
};

export type ListMessagesParams = {
  limit?: number;
  pageToken?: string;
  mailbox?: EmailMailbox;
  folderID?: string;
  companyID?: string;
  sharedInboxID?: string;
  q?: string;
  unread?: boolean;
  refresh?: boolean;
};

export type EmailMailbox = "primary" | "sent" | "starred" | "all" | "archive";

export type ListEmailFoldersParams = {
  companyID?: string;
  sharedInboxID?: string;
};

export type CommunicationsSharedInboxRaciRole = LogicGateRaciRole;
export type CommunicationsSharedInboxRaciSubjectType = "user" | "group";

export type CommunicationsSharedInboxRaciAssignment = {
  company_id: string;
  folder_id: string;
  role: CommunicationsSharedInboxRaciRole;
  subject_type?: CommunicationsSharedInboxRaciSubjectType;
  subject_id?: string;
  subject_name?: string;
  user_id: string;
  user_display_name?: string;
  user_email?: string;
  created_timestamp: string;
};

export type ResourceAccessLevel = "no_access" | "view" | "edit" | "admin";

export type ResourceAccessGrant = {
  company_id: string;
  entity_type?: "node" | "logic_gate" | "shared_triage_folder";
  entity_id?: string;
  subject_type: "user" | "group";
  subject_id: string;
  subject_name?: string;
  subject_email?: string;
  permission: ResourceAccessLevel;
  access_level?: ResourceAccessLevel;
  created_timestamp: string;
};
export type CommunicationsSharedInbox = {
  company_id: string;
  folder_id: string;
  parent_folder_id?: string;
  folder_kind: "communications";
  name: string;
  account_email?: string;
  position: number;
  raci_assignments?: CommunicationsSharedInboxRaciAssignment[];
  access_grants?: ResourceAccessGrant[];
  effective_access_level?: ResourceAccessLevel;
  created_timestamp: string;
  updated_timestamp: string;
};

export type CommunicationsTriageItem = {
  user_id: string;
  message_id: string;
  message: EmailMessage;
  created_timestamp: string;
  updated_timestamp: string;
};

export type UserLogicGateShortcut = {
  user_id: string;
  company_id: string;
  logic_gate_id: string;
  position: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type CompanyUser = {
  company_id: string;
  user_id: string;
  email?: string;
  display_name?: string;
  role?: string;
};

export type CommunicationsWorkspacePanel = {
  logicGateFolders: CompanyExplorerFolder[];
  logicGateFolderItems: CompanyExplorerFolderItem[];
  logicGates: LogicGateRecord[];
  myLogicGateShortcuts: UserLogicGateShortcut[];
  nodeFolders: CompanyExplorerFolder[];
  nodeFolderItems: CompanyExplorerFolderItem[];
  nodes: NodeRecord[];
};

export type CommunicationsWorkspacePanelCacheScope = {
  logicGateFolders?: boolean;
  logicGateFolderItems?: boolean;
  logicGates?: boolean;
  nodeFolders?: boolean;
  nodeFolderItems?: boolean;
  nodes?: boolean;
  companyUsers?: boolean;
};

export type MessagePage = {
  messages: EmailMessage[];
  next_page_token?: string;
};

export type ArchiveEmailMessagesBatchResult = {
  archived_ids: string[];
  failed: Array<{ message_id: string; error: string }>;
};

export type MergeEmailMessageOptions = {
  prependIfMissing?: boolean;
  maxMessages?: number;
};

export type SendEmailInput = {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  body: string;
  reply_to_message_id?: string;
  company_id?: string;
  shared_inbox_id?: string;
};

type CacheEntry<T> = {
  value: T;
  fetchedAt: number;
};

const STATUS_CACHE_TTL_MS = 60_000;
const FOLDERS_CACHE_TTL_MS = 10 * 60_000;
const MESSAGE_PAGE_CACHE_TTL_MS = 5 * 60_000;
const MESSAGE_DETAIL_CACHE_TTL_MS = 10 * 60_000;
const SHARED_INBOX_CACHE_TTL_MS = 5 * 60_000;
const WORKSPACE_PANEL_CACHE_TTL_MS = 5 * 60_000;
const RECENT_ARCHIVED_MESSAGE_TTL_MS = 10 * 60_000;
const RECENT_PRIMARY_MESSAGE_TTL_MS = 10 * 60_000;
export const EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED = "mangorts:communications-shared-inboxes-updated";

let statusCache: CacheEntry<CommunicationsStatus> | null = null;
const foldersCache = new Map<string, CacheEntry<EmailFolder[]>>();
const messagePageCache = new Map<string, CacheEntry<MessagePage>>();
const messageDetailCache = new Map<string, CacheEntry<EmailMessage>>();
const recentArchivedMessages = new Map<string, CacheEntry<EmailMessage>>();
const recentPrimaryMessages = new Map<string, CacheEntry<EmailMessage>>();
let statusInflight: Promise<CommunicationsStatus> | null = null;
const foldersInflight = new Map<string, Promise<EmailFolder[]>>();
const messagePageInflight = new Map<string, Promise<MessagePage>>();
const messageDetailInflight = new Map<string, Promise<EmailMessage>>();
const communicationsReadCache = new Map<string, CacheEntry<unknown>>();
const communicationsReadInflight = new Map<string, Promise<unknown>>();
let communicationsAuthSessionGeneration = getAuthSessionCacheGeneration();

export async function fetchCommunicationsStatus(): Promise<CommunicationsStatus> {
  ensureCommunicationsCacheAuthScope();
  const cached = readCache(statusCache, STATUS_CACHE_TTL_MS, cloneStatus);
  if (cached) return cached;
  if (statusInflight) return cloneStatus(await statusInflight);
  statusInflight = apiFetchJSON<CommunicationsStatus>("/v1/communications/status")
    .then((status) => {
      const value = cloneStatus(status);
      statusCache = { value, fetchedAt: Date.now() };
      return value;
    })
    .finally(() => {
      statusInflight = null;
    });
  return cloneStatus(await statusInflight);
}

export async function fetchCommunicationsAuthURL(provider: EmailProvider, accountEmail?: string): Promise<string> {
  const query = new URLSearchParams({ provider });
  const cleanAccountEmail = accountEmail?.trim().toLowerCase() ?? "";
  if (cleanAccountEmail) query.set("account_email", cleanAccountEmail);
  const payload = await apiFetchJSON<{ auth_url: string }>(`/v1/communications/auth-url?${query.toString()}`);
  return payload.auth_url;
}

export async function disconnectCommunications(): Promise<void> {
  await apiFetchJSON<{ status: string }>("/v1/communications/disconnect", { method: "POST" });
  invalidateCommunicationsCache();
}

export async function listEmailFolders(params: ListEmailFoldersParams = {}): Promise<EmailFolder[]> {
  ensureCommunicationsCacheAuthScope();
  const cachePath = `/v1/communications/folders${createFolderQuery(params)}`;
  const cached = readCache(foldersCache.get(cachePath) ?? null, FOLDERS_CACHE_TTL_MS, cloneFolders);
  if (cached) return cached;
  const existingInflight = foldersInflight.get(cachePath);
  if (existingInflight) return cloneFolders(await existingInflight);
  const request = apiFetchJSON<{ folders?: EmailFolder[] }>(cachePath)
    .then((payload) => {
      const folders = cloneFolders(payload.folders ?? []);
      foldersCache.set(cachePath, { value: folders, fetchedAt: Date.now() });
      return folders;
    })
    .finally(() => {
      foldersInflight.delete(cachePath);
    });
  foldersInflight.set(cachePath, request);
  return cloneFolders(await request);
}

export async function listEmailMessages(params: ListMessagesParams): Promise<MessagePage> {
  ensureCommunicationsCacheAuthScope();
  const cacheParams = { ...params, refresh: false };
  const cachePath = `/v1/communications/messages${createMessageQuery(cacheParams)}`;
  const requestPath = params.refresh ? `/v1/communications/messages${createMessageQuery(params)}` : cachePath;
  if (!params.refresh) {
    const cached = readCache(messagePageCache.get(cachePath) ?? null, MESSAGE_PAGE_CACHE_TTL_MS, cloneMessagePage);
    if (cached) return applyLocalMessageOverlaysToPage(cached, cacheParams);
    const existingInflight = messagePageInflight.get(cachePath);
    if (existingInflight) return applyLocalMessageOverlaysToPage(cloneMessagePage(await existingInflight), cacheParams);
  }
  const pagePromise = apiFetchJSON<MessagePage>(requestPath).finally(() => {
    messagePageInflight.delete(cachePath);
  });
  messagePageInflight.set(cachePath, pagePromise);
  const page = await pagePromise;
  const normalized = applyLocalMessageOverlaysToPage(cloneMessagePage(page), cacheParams);
  messagePageCache.set(cachePath, { value: normalized, fetchedAt: Date.now() });
  for (const message of normalized.messages) {
    if (isEmailMessageDetailed(message)) {
      messageDetailCache.set(messageDetailCacheKey(message.id, params.companyID, params.sharedInboxID), { value: cloneMessage(message), fetchedAt: Date.now() });
    }
  }
  return cloneMessagePage(normalized);
}

export function sortEmailMessagesByDateDescending(messages: EmailMessage[]): EmailMessage[] {
  return messages
    .map((message, index) => ({ message: cloneMessage(message), index }))
    .sort((a, b) => {
      const dateDelta = emailMessageSortTimestamp(b.message) - emailMessageSortTimestamp(a.message);
      return dateDelta || a.index - b.index;
    })
    .map((item) => item.message);
}

export async function getEmailMessage(messageID: string, companyID?: string, sharedInboxID?: string): Promise<EmailMessage> {
  ensureCommunicationsCacheAuthScope();
  const cacheKey = messageDetailCacheKey(messageID, companyID, sharedInboxID);
  const cached = readCache(messageDetailCache.get(cacheKey) ?? null, MESSAGE_DETAIL_CACHE_TTL_MS, cloneMessage);
  if (cached && isEmailMessageDetailed(cached)) return cached;
  const existingInflight = messageDetailInflight.get(cacheKey);
  if (existingInflight) return cloneMessage(await existingInflight);
  const queryParams = new URLSearchParams();
  if (companyID?.trim()) queryParams.set("company_id", companyID.trim());
  if (sharedInboxID?.trim()) queryParams.set("shared_inbox_id", sharedInboxID.trim());
  const query = queryParams.toString();
  const request = apiFetchJSON<{ message: EmailMessage }>(`/v1/communications/messages/${encodeURIComponent(messageID)}${query ? `?${query}` : ""}`)
    .then((payload) => {
      const message = cloneMessage(payload.message);
      messageDetailCache.set(cacheKey, { value: message, fetchedAt: Date.now() });
      return message;
    })
    .finally(() => {
      messageDetailInflight.delete(cacheKey);
    });
  messageDetailInflight.set(cacheKey, request);
  return cloneMessage(await request);
}

export async function updateEmailMessage(messageID: string, update: { unread?: boolean; starred?: boolean; folders?: string[] }, sharedInboxID?: string, companyID?: string): Promise<EmailMessage> {
  const query = createSharedInboxMessageMutationQuery(sharedInboxID, companyID);
  const payload = await apiFetchJSON<{ message: EmailMessage }>(`/v1/communications/messages/${encodeURIComponent(messageID)}${query}`, {
    method: "PUT",
    body: JSON.stringify(update),
  });
  primeMessageCaches(payload.message);
  clearMessagePageCache();
  if (update.folders) clearEmailFolderCache();
  return payload.message;
}

export async function archiveEmailMessage(messageID: string, sharedInboxID?: string, companyID?: string): Promise<EmailMessage> {
  const query = createSharedInboxMessageMutationQuery(sharedInboxID, companyID);
  const payload = await apiFetchJSON<{ message: EmailMessage }>(`/v1/communications/messages/${encodeURIComponent(messageID)}/archive${query}`, {
    method: "POST",
  });
  const message = archivedEmailMessageForLocalLists(payload.message);
  recentPrimaryMessages.delete(message.id.trim());
  rememberRecentlyArchivedMessage(message);
  primeMessageCaches(message);
  clearMessagePageCache();
  clearEmailFolderCache();
  return message;
}

export async function archiveEmailMessagesBatch(messageIDs: string[], sharedInboxID?: string, companyID?: string): Promise<ArchiveEmailMessagesBatchResult> {
  const ids = cleanIDs(messageIDs);
  if (ids.length === 0) return { archived_ids: [], failed: [] };
  const query = createSharedInboxMessageMutationQuery(sharedInboxID, companyID);
  const payload = await apiFetchJSON<Partial<ArchiveEmailMessagesBatchResult>>(`/v1/communications/messages/archive-batch${query}`, {
    method: "POST",
    body: JSON.stringify({ message_ids: ids }),
  });
  const archivedIDs = cleanIDs(payload.archived_ids ?? []);
  for (const messageID of archivedIDs) {
    recentPrimaryMessages.delete(messageID);
    recentArchivedMessages.delete(messageID);
    invalidateEmailMessageCache(messageID);
  }
  clearMessagePageCache();
  clearEmailFolderCache();
  return {
    archived_ids: archivedIDs,
    failed: (payload.failed ?? [])
      .map((item) => ({ message_id: item.message_id?.trim() ?? "", error: item.error?.trim() ?? "archive_failed" }))
      .filter((item) => item.message_id),
  };
}

export async function unarchiveEmailMessage(messageID: string, sharedInboxID?: string, companyID?: string): Promise<EmailMessage> {
  const query = createSharedInboxMessageMutationQuery(sharedInboxID, companyID);
  const payload = await apiFetchJSON<{ message: EmailMessage }>(`/v1/communications/messages/${encodeURIComponent(messageID)}/unarchive${query}`, {
    method: "POST",
  });
  recentArchivedMessages.delete(messageID.trim());
  rememberRecentlyPrimaryMessage(payload.message);
  primeMessageCaches(payload.message);
  clearMessagePageCache();
  clearEmailFolderCache();
  return payload.message;
}

export async function deleteEmailMessage(messageID: string, sharedInboxID?: string, companyID?: string): Promise<void> {
  const query = createSharedInboxMessageMutationQuery(sharedInboxID, companyID);
  await apiFetchJSON<{ status: string }>(`/v1/communications/messages/${encodeURIComponent(messageID)}${query}`, { method: "DELETE" });
  recentArchivedMessages.delete(messageID.trim());
  recentPrimaryMessages.delete(messageID.trim());
  invalidateEmailMessageCache(messageID);
  clearMessagePageCache();
  clearEmailFolderCache();
}

export async function sendEmail(input: SendEmailInput): Promise<EmailMessage> {
  const { company_id: companyID, shared_inbox_id: sharedInboxID, ...messageInput } = input;
  const query = createSharedInboxMessageMutationQuery(sharedInboxID, companyID);
  const payload = await apiFetchJSON<{ message: EmailMessage }>(`/v1/communications/messages/send${query}`, {
    method: "POST",
    body: JSON.stringify(messageInput),
  });
  primeMessageCaches(payload.message);
  clearMessagePageCache();
  clearEmailFolderCache();
  return payload.message;
}

export async function listCommunicationsSharedInboxes(companyID: string): Promise<CommunicationsSharedInbox[]> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`shared-inboxes:${cleanCompanyID}`, SHARED_INBOX_CACHE_TTL_MS, async () => {
    const params = new URLSearchParams({
      company_id: cleanCompanyID,
    });
    const payload = await apiFetchJSON<{ shared_inboxes?: CommunicationsSharedInbox[]; folders?: CommunicationsSharedInbox[] }>(`/v1/communications/shared-inboxes?${params.toString()}`);
    return cloneSharedInboxes((payload.shared_inboxes ?? payload.folders ?? []).filter((folder) => folder.effective_access_level !== "no_access"));
  }, cloneSharedInboxes);
}

export async function createCommunicationsSharedInbox(input: {
  companyID: string;
  name: string;
  parentFolderID?: string;
  accountEmail?: string;
}): Promise<CommunicationsSharedInbox> {
  const folder = await apiFetchJSON<CommunicationsSharedInbox>("/v1/communications/shared-inboxes", {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      parent_folder_id: input.parentFolderID?.trim() || undefined,
      name: input.name.trim(),
      account_email: input.accountEmail?.trim() || undefined,
    }),
  });
  invalidateCacheKey(`shared-inboxes:${input.companyID.trim()}`);
  dispatchCommunicationsSharedInboxesUpdated(input.companyID);
  return cloneSharedInbox(folder);
}

export async function updateCommunicationsSharedInbox(input: {
  companyID: string;
  folderID: string;
  name?: string;
  parentFolderID?: string;
  accountEmail?: string;
  position?: number;
}): Promise<CommunicationsSharedInbox> {
  const cleanCompanyID = input.companyID.trim();
  const cleanFolderID = input.folderID.trim();
  const body: Record<string, unknown> = { company_id: cleanCompanyID };
  if (input.name !== undefined) body.name = input.name.trim();
  if (Object.prototype.hasOwnProperty.call(input, "parentFolderID")) {
    body.parent_folder_id = input.parentFolderID?.trim() ?? "";
  }
  if (Object.prototype.hasOwnProperty.call(input, "accountEmail")) {
    body.account_email = input.accountEmail?.trim() ?? "";
  }
  if (input.position !== undefined && input.position > 0) body.position = Math.round(input.position);
  const folder = await apiFetchJSON<CommunicationsSharedInbox>(`/v1/communications/shared-inboxes/${encodeURIComponent(cleanFolderID)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  invalidateCacheKey(`shared-inboxes:${cleanCompanyID}`);
  dispatchCommunicationsSharedInboxesUpdated(cleanCompanyID);
  return cloneSharedInbox(folder);
}

export async function deleteCommunicationsSharedInbox(companyID: string, folderID: string): Promise<void> {
  const cleanCompanyID = companyID.trim();
  const cleanFolderID = folderID.trim();
  await apiFetchJSON<{ status?: string }>(`/v1/communications/shared-inboxes/${encodeURIComponent(cleanFolderID)}?company_id=${encodeURIComponent(cleanCompanyID)}`, {
    method: "DELETE",
  });
  invalidateCacheKey(`shared-inboxes:${cleanCompanyID}`);
  dispatchCommunicationsSharedInboxesUpdated(cleanCompanyID);
}

export async function updateCommunicationsSharedInboxRaciAssignments(
  companyID: string,
  folderID: string,
  assignments: Array<{ role: CommunicationsSharedInboxRaciRole; subject_type?: CommunicationsSharedInboxRaciSubjectType; subject_id?: string; user_id?: string }>,
): Promise<CommunicationsSharedInboxRaciAssignment[]> {
  const cleanCompanyID = companyID.trim();
  const cleanFolderID = folderID.trim();
  const payload = await apiFetchJSON<{ raci_assignments?: CommunicationsSharedInboxRaciAssignment[] }>(`/v1/communications/shared-inboxes/${encodeURIComponent(cleanFolderID)}/raci`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: cleanCompanyID,
      assignments,
    }),
  });
  invalidateCacheKey(`shared-inboxes:${cleanCompanyID}`);
  dispatchCommunicationsSharedInboxesUpdated(cleanCompanyID);
  return cloneSharedInboxRaciAssignments(payload.raci_assignments ?? []);
}

export async function listCommunicationsTriageItems(): Promise<CommunicationsTriageItem[]> {
  const payload = await apiFetchJSON<{ items?: CommunicationsTriageItem[] }>("/v1/communications/triage");
  return (payload.items ?? []).map(cloneTriageItem);
}

export async function addMessagesToMyTriage(messageIDs: string[]): Promise<CommunicationsTriageItem[]> {
  const payload = await apiFetchJSON<{ items?: CommunicationsTriageItem[] }>("/v1/communications/triage", {
    method: "POST",
    body: JSON.stringify({ message_ids: cleanIDs(messageIDs) }),
  });
  return (payload.items ?? []).map(cloneTriageItem);
}

export async function removeMessageFromMyTriage(messageID: string): Promise<void> {
  await apiFetchJSON<{ status?: string }>(`/v1/communications/triage/${encodeURIComponent(messageID)}`, { method: "DELETE" });
}

export async function listLogicGates(companyID: string): Promise<LogicGateRecord[]> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`logic-gates:${cleanCompanyID}`, WORKSPACE_PANEL_CACHE_TTL_MS, async () => {
    const params = new URLSearchParams({ company_id: cleanCompanyID });
    const payload = await apiFetchJSON<{ logic_gates?: LogicGateRecord[] }>(`/v1/logic-gates?${params.toString()}`);
    return cloneLogicGates(payload.logic_gates ?? []);
  }, cloneLogicGates);
}

export async function listCompanyUsers(companyID: string): Promise<CompanyUser[]> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`company-users:${cleanCompanyID}`, WORKSPACE_PANEL_CACHE_TTL_MS, async () => {
    const payload = await apiFetchJSON<{ users?: CompanyUser[] }>(`/v1/companies/${encodeURIComponent(cleanCompanyID)}/users`);
    return cloneCompanyUsers(payload.users ?? []);
  }, cloneCompanyUsers);
}

export async function updateLogicGateRaciAssignments(
  companyID: string,
  logicGateID: string,
  assignments: Array<{ role: LogicGateRaciRole; user_id: string }>,
): Promise<LogicGateRaciAssignment[]> {
  const payload = await apiFetchJSON<{ raci_assignments?: LogicGateRaciAssignment[] }>(`/v1/logic-gates/${encodeURIComponent(logicGateID)}/raci`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: companyID,
      assignments,
    }),
  });
  invalidateWorkspacePanelCache(companyID);
  markLogicGateWorkspaceSnapshotScopesStale(companyID, logicGateID);
  return cloneLogicGateRaciAssignments(payload.raci_assignments ?? []);
}

export type LogicGateRaciAssignmentCommandResult = {
  company_id: string;
  logic_gate_id: string;
  operation: "add" | "remove";
  changed: boolean;
  raci_assignments?: LogicGateRaciAssignment[];
};

async function commandLogicGateRaciAssignments(
  companyID: string,
  logicGateID: string,
  operation: "add" | "remove",
  assignments: Array<{ role: LogicGateRaciRole; user_id: string }>,
): Promise<LogicGateRaciAssignment[]> {
  const payload = await apiFetchJSON<LogicGateRaciAssignmentCommandResult>(`/v1/logic-gates/${encodeURIComponent(logicGateID)}/raci/${operation}`, {
    method: "POST",
    body: JSON.stringify({
      company_id: companyID,
      assignments,
    }),
  });
  invalidateWorkspacePanelCache(companyID);
  markLogicGateWorkspaceSnapshotScopesStale(companyID, logicGateID);
  return cloneLogicGateRaciAssignments(payload.raci_assignments ?? []);
}

export function addLogicGateRaciAssignments(
  companyID: string,
  logicGateID: string,
  assignments: Array<{ role: LogicGateRaciRole; user_id: string }>,
): Promise<LogicGateRaciAssignment[]> {
  return commandLogicGateRaciAssignments(companyID, logicGateID, "add", assignments);
}

export function removeLogicGateRaciAssignments(
  companyID: string,
  logicGateID: string,
  assignments: Array<{ role: LogicGateRaciRole; user_id: string }>,
): Promise<LogicGateRaciAssignment[]> {
  return commandLogicGateRaciAssignments(companyID, logicGateID, "remove", assignments);
}

export async function listNodes(companyID: string): Promise<NodeRecord[]> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`nodes:${cleanCompanyID}`, WORKSPACE_PANEL_CACHE_TTL_MS, async () => {
    const params = new URLSearchParams({ company_id: cleanCompanyID });
    const payload = await apiFetchJSON<{ nodes?: NodeRecord[] }>(`/v1/nodes?${params.toString()}`);
    return cloneNodes(payload.nodes ?? []);
  }, cloneNodes);
}

export async function updateNode(companyID: string, nodeID: string, update: Partial<Pick<NodeRecord, "status" | "status_color" | "due_date" | "priority" | "assignee_user_id">>): Promise<NodeRecord> {
  const node = await apiFetchJSON<NodeRecord>(`/v1/nodes/${encodeURIComponent(nodeID)}`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: companyID,
      ...update,
    }),
  });
  invalidateWorkspacePanelCache(companyID);
  markNodeWorkspaceSnapshotScopesStale(companyID);
  return { ...node };
}

export async function listNodeFolders(companyID: string): Promise<CompanyExplorerFolder[]> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`node-folders:${cleanCompanyID}`, WORKSPACE_PANEL_CACHE_TTL_MS, async () => {
    const params = new URLSearchParams({ company_id: cleanCompanyID, folder_kind: "node" });
    const payload = await apiFetchJSON<{ folders?: CompanyExplorerFolder[] }>(`/v1/company-explorer/folders?${params.toString()}`);
    return cloneCompanyExplorerFolders(payload.folders ?? []);
  }, cloneCompanyExplorerFolders);
}

export async function listNodeFolderItems(companyID: string): Promise<CompanyExplorerFolderItem[]> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`node-folder-items:${cleanCompanyID}`, WORKSPACE_PANEL_CACHE_TTL_MS, async () => {
    const params = new URLSearchParams({ company_id: cleanCompanyID, item_type: "node" });
    const payload = await apiFetchJSON<{ folder_items?: CompanyExplorerFolderItem[] }>(`/v1/company-explorer/folder-items?${params.toString()}`);
    return cloneCompanyExplorerFolderItems(payload.folder_items ?? []);
  }, cloneCompanyExplorerFolderItems);
}

export async function listLogicGateFolders(companyID: string): Promise<CompanyExplorerFolder[]> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`logic-gate-folders:${cleanCompanyID}`, WORKSPACE_PANEL_CACHE_TTL_MS, async () => {
    const params = new URLSearchParams({ company_id: cleanCompanyID, folder_kind: "logic_gate" });
    const payload = await apiFetchJSON<{ folders?: CompanyExplorerFolder[] }>(`/v1/company-explorer/folders?${params.toString()}`);
    return cloneCompanyExplorerFolders(payload.folders ?? []);
  }, cloneCompanyExplorerFolders);
}

export async function listLogicGateFolderItems(companyID: string): Promise<CompanyExplorerFolderItem[]> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`logic-gate-folder-items:${cleanCompanyID}`, WORKSPACE_PANEL_CACHE_TTL_MS, async () => {
    const params = new URLSearchParams({ company_id: cleanCompanyID, item_type: "logic_gate" });
    const payload = await apiFetchJSON<{ folder_items?: CompanyExplorerFolderItem[] }>(`/v1/company-explorer/folder-items?${params.toString()}`);
    return cloneCompanyExplorerFolderItems(payload.folder_items ?? []);
  }, cloneCompanyExplorerFolderItems);
}

export async function listMyLogicGateShortcuts(companyID: string): Promise<UserLogicGateShortcut[]> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`my-logic-gates:${cleanCompanyID}`, WORKSPACE_PANEL_CACHE_TTL_MS, async () => {
    const params = new URLSearchParams({ company_id: cleanCompanyID });
    const payload = await apiFetchJSON<{ shortcuts?: UserLogicGateShortcut[] }>(`/v1/communications/my-logic-gates?${params.toString()}`);
    return cloneLogicGateShortcuts(payload.shortcuts ?? []);
  }, cloneLogicGateShortcuts);
}

export async function addMyLogicGateShortcuts(companyID: string, logicGateIDs: string[]): Promise<UserLogicGateShortcut[]> {
  const payload = await apiFetchJSON<{ shortcuts?: UserLogicGateShortcut[] }>("/v1/communications/my-logic-gates", {
    method: "POST",
    body: JSON.stringify({ company_id: companyID, logic_gate_ids: cleanIDs(logicGateIDs) }),
  });
  invalidateCacheKey(`my-logic-gates:${companyID.trim()}`);
  return cloneLogicGateShortcuts(payload.shortcuts ?? []);
}

export async function removeMyLogicGateShortcut(companyID: string, logicGateID: string): Promise<void> {
  const params = new URLSearchParams({ company_id: companyID });
  await apiFetchJSON<{ status?: string }>(`/v1/communications/my-logic-gates/${encodeURIComponent(logicGateID)}?${params.toString()}`, { method: "DELETE" });
  invalidateCacheKey(`my-logic-gates:${companyID.trim()}`);
}

export async function fetchCommunicationsWorkspacePanel(companyID: string): Promise<CommunicationsWorkspacePanel> {
  const cleanCompanyID = companyID.trim();
  const [logicGateFolders, logicGateFolderItems, logicGates, shortcuts, nodeFolders, nodeFolderItems, nodes] = await Promise.all([
    listLogicGateFolders(cleanCompanyID),
    listLogicGateFolderItems(cleanCompanyID),
    listLogicGates(cleanCompanyID),
    listMyLogicGateShortcuts(cleanCompanyID),
    listNodeFolders(cleanCompanyID),
    listNodeFolderItems(cleanCompanyID),
    listNodes(cleanCompanyID),
  ]);
  return {
    logicGateFolders,
    logicGateFolderItems,
    logicGates,
    myLogicGateShortcuts: cloneLogicGateShortcuts(shortcuts),
    nodeFolders,
    nodeFolderItems,
    nodes,
  };
}

export async function convertTriageMessagesToLogicGate(input: {
  companyID: string;
  logicGateID: string;
  nodeID?: string;
  messageIDs: string[];
  priority: number;
}): Promise<{
  board: KanbanBoard;
  cards: KanbanCard[];
  nodes: NodeRecord[];
  folder_items?: CompanyExplorerFolderItem[];
  deleted_message_ids: string[];
}> {
  const cleanNodeID = input.nodeID?.trim() ?? "";
  const result = await apiFetchJSON<{
    board: KanbanBoard;
    cards: KanbanCard[];
    nodes: NodeRecord[];
    folder_items?: CompanyExplorerFolderItem[];
    deleted_message_ids: string[];
  }>("/v1/communications/triage/convert", {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      logic_gate_id: input.logicGateID,
      node_id: cleanNodeID || undefined,
      target: cleanNodeID
        ? { mode: "existing_node", logic_gate_id: input.logicGateID, node_id: cleanNodeID }
        : { mode: "existing_logic_gate", logic_gate_id: input.logicGateID },
      message_ids: cleanIDs(input.messageIDs),
      priority: input.priority,
    }),
  });
  invalidateWorkspacePanelCache(input.companyID);
  markNodeWorkspaceSnapshotScopesStale(input.companyID);
  markKanbanWorkspaceSnapshotScopeStale(input.companyID, logicGateKanbanBoardID(input.logicGateID));
  return result;
}

export async function revertKanbanCardToMyTriage(input: {
  companyID: string;
  boardID: string;
  cardID: string;
}): Promise<{
  triage_item: CommunicationsTriageItem;
  deleted_node_id: string;
  deleted_card_id: string;
  board_id: string;
}> {
  const result = await apiFetchJSON<{
    triage_item: CommunicationsTriageItem;
    deleted_node_id: string;
    deleted_card_id: string;
    board_id: string;
  }>("/v1/communications/triage/revert-card", {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      board_id: input.boardID,
      card_id: input.cardID,
    }),
  });
  invalidateWorkspacePanelCache(input.companyID);
  markNodeWorkspaceSnapshotScopesStale(input.companyID);
  markKanbanWorkspaceSnapshotScopeStale(input.companyID, result.board_id?.trim() || input.boardID);
  return result;
}

export function invalidateCommunicationsCache(scope?: { status?: boolean; folders?: boolean; messagePages?: boolean; messages?: boolean }): void {
  const full = !scope;
  if (full || scope?.status) {
    statusCache = null;
    statusInflight = null;
  }
  if (full || scope?.folders) {
    clearEmailFolderCache();
  }
  if (full || scope?.messagePages) {
    clearMessagePageCache();
  }
  if (full || scope?.messages) {
    messageDetailCache.clear();
    messageDetailInflight.clear();
  }
  if (full) {
    recentArchivedMessages.clear();
    recentPrimaryMessages.clear();
    communicationsReadCache.clear();
    communicationsReadInflight.clear();
  }
}

export function invalidateCommunicationsFolderCache(): void {
  clearEmailFolderCache();
}

export function invalidateEmailMessageCache(messageID: string): void {
  const cleanMessageID = messageID.trim();
  if (!cleanMessageID) return;
  for (const key of messageDetailCache.keys()) {
    if (key === cleanMessageID || key.endsWith(`\x1f${cleanMessageID}`)) messageDetailCache.delete(key);
  }
  for (const key of messageDetailInflight.keys()) {
    if (key === cleanMessageID || key.endsWith(`\x1f${cleanMessageID}`)) messageDetailInflight.delete(key);
  }
}

export function invalidateCommunicationsWorkspacePanelCache(companyID: string): void {
  invalidateWorkspacePanelCache(companyID);
}

export function markCommunicationsWorkspacePanelStale(companyID: string, scope?: CommunicationsWorkspacePanelCacheScope): void {
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) return;
  if (scope) {
    if (scope.logicGates) invalidateCacheKey(`logic-gates:${cleanCompanyID}`);
    if (scope.nodes) invalidateCacheKey(`nodes:${cleanCompanyID}`);
    if (scope.nodeFolders) invalidateCacheKey(`node-folders:${cleanCompanyID}`);
    if (scope.nodeFolderItems) invalidateCacheKey(`node-folder-items:${cleanCompanyID}`);
    if (scope.logicGateFolders) invalidateCacheKey(`logic-gate-folders:${cleanCompanyID}`);
    if (scope.logicGateFolderItems) invalidateCacheKey(`logic-gate-folder-items:${cleanCompanyID}`);
    if (scope.companyUsers) invalidateCacheKey(`company-users:${cleanCompanyID}`);
    return;
  }
  clearWorkspacePanelReadCache(cleanCompanyID);
}

export function primeEmailMessageCache(message: EmailMessage): void {
  primeMessageCaches(message);
}

export function removeEmailMessageFromCache(messageID: string): void {
  const cleanMessageID = messageID.trim();
  if (!cleanMessageID) return;
  recentArchivedMessages.delete(cleanMessageID);
  recentPrimaryMessages.delete(cleanMessageID);
  invalidateEmailMessageCache(cleanMessageID);
  for (const [key, entry] of messagePageCache.entries()) {
    const messages = entry.value.messages.filter((message) => message.id !== cleanMessageID);
    if (messages.length !== entry.value.messages.length) {
      messagePageCache.set(key, { value: { ...entry.value, messages }, fetchedAt: Date.now() });
    }
  }
}

export function applyEmailMessageToCachedPages(message: EmailMessage, options: MergeEmailMessageOptions = {}): void {
  primeMessageCaches(message);
  if (options.prependIfMissing && messageMatchesMailbox(message, "primary")) rememberRecentlyPrimaryMessage(message);
  for (const [key, entry] of messagePageCache.entries()) {
    const params = listMessageParamsFromCacheKey(key);
    const maxMessages = params.limit ?? options.maxMessages;
    const messages = mergeEmailMessageIntoMessageList(entry.value.messages, message, params, {
      ...options,
      maxMessages,
    });
    messagePageCache.set(key, { value: { ...entry.value, messages }, fetchedAt: Date.now() });
  }
}

export function mergeEmailMessageIntoMessageList(
  current: EmailMessage[],
  message: EmailMessage,
  params: ListMessagesParams,
  options: MergeEmailMessageOptions = {},
): EmailMessage[] {
  const cleanMessageID = message.id.trim();
  if (!cleanMessageID) return current.map(cloneMessage);
  const maxMessages = options.maxMessages && options.maxMessages > 0 ? options.maxMessages : Math.max(current.length, params.limit ?? 25);
  const existingIndex = current.findIndex((item) => item.id === cleanMessageID);
  const matches = emailMessageMatchesListFilters(message, params);

  if (existingIndex >= 0) {
    if (!matches && shouldRemoveExistingMessageFromList(message, params)) {
      return sortEmailMessagesByDateDescending(current.filter((item) => item.id !== cleanMessageID));
    }
    return sortEmailMessagesByDateDescending(current.map((item) => (item.id === cleanMessageID ? mergeExistingMessageForList(item, message, !matches) : item)));
  }

  if (!options.prependIfMissing || !matches || params.pageToken) return sortEmailMessagesByDateDescending(current);
  return sortEmailMessagesByDateDescending([message, ...current]).slice(0, maxMessages);
}

function mergeExistingMessageForList(previous: EmailMessage, next: EmailMessage, preservePreviousFolders: boolean): EmailMessage {
  const merged: EmailMessage = { ...previous, ...next };
  if (preservePreviousFolders) {
    merged.folders = previous.folders ? [...previous.folders] : undefined;
    merged.folder_ids = previous.folder_ids ? [...previous.folder_ids] : undefined;
  }
  return cloneMessage(merged);
}

function applyLocalMessageOverlaysToPage(page: MessagePage, params: ListMessagesParams): MessagePage {
  pruneRecentMessages();
  const mailbox = params.mailbox ?? "primary";
  if (params.pageToken) return page;

  const archivedIDs = new Set(recentArchivedMessages.keys());
  if (mailbox === "primary") {
    const messages = page.messages.filter((message) => !archivedIDs.has(message.id)).map(cloneMessage);
    const withRecent = prependRecentMessages(messages, recentPrimaryMessages, params);
    return {
      ...page,
      messages: withRecent,
    };
  }

  if (mailbox !== "archive") return page;
  const messages = page.messages.map(cloneMessage);
  const withRecent = prependRecentMessages(messages, recentArchivedMessages, params);
  return {
    ...page,
    messages: withRecent,
  };
}

function prependRecentMessages(messages: EmailMessage[], recent: Map<string, CacheEntry<EmailMessage>>, params: ListMessagesParams): EmailMessage[] {
  if (recent.size === 0) return messages;
  const seen = new Set(messages.map((message) => message.id));
  const additions = Array.from(recent.values())
    .sort((a, b) => b.fetchedAt - a.fetchedAt)
    .map((entry) => entry.value)
    .filter((message) => !seen.has(message.id) && emailMessageMatchesListFilters(message, params));
  if (additions.length === 0) return messages;
  return sortEmailMessagesByDateDescending([...additions, ...messages]).slice(0, params.limit && params.limit > 0 ? params.limit : messages.length + additions.length);
}

function emailMessageSortTimestamp(message: EmailMessage): number {
  return typeof message.date === "number" && Number.isFinite(message.date) ? message.date : 0;
}

function rememberRecentlyPrimaryMessage(message: EmailMessage): void {
  const cleanMessageID = message.id.trim();
  if (!cleanMessageID || !messageMatchesMailbox(message, "primary")) return;
  recentArchivedMessages.delete(cleanMessageID);
  recentPrimaryMessages.set(cleanMessageID, { value: cloneMessage(message), fetchedAt: Date.now() });
}

function rememberRecentlyArchivedMessage(message: EmailMessage): void {
  const cleanMessageID = message.id.trim();
  if (!cleanMessageID) return;
  recentPrimaryMessages.delete(cleanMessageID);
  recentArchivedMessages.set(cleanMessageID, { value: archivedEmailMessageForLocalLists(message), fetchedAt: Date.now() });
}

function pruneRecentMessages(): void {
  const now = Date.now();
  for (const [messageID, entry] of recentArchivedMessages.entries()) {
    if (now - entry.fetchedAt > RECENT_ARCHIVED_MESSAGE_TTL_MS) recentArchivedMessages.delete(messageID);
  }
  for (const [messageID, entry] of recentPrimaryMessages.entries()) {
    if (now - entry.fetchedAt > RECENT_PRIMARY_MESSAGE_TTL_MS) recentPrimaryMessages.delete(messageID);
  }
}

function archivedEmailMessageForLocalLists(message: EmailMessage): EmailMessage {
  const archived = cloneMessage(message);
  archived.folders = stripInboxFolders(archived.folders);
  archived.folder_ids = stripInboxFolders(archived.folder_ids);
  return archived;
}

function stripInboxFolders(folders: string[] | undefined): string[] | undefined {
  if (!folders) return folders;
  return folders.filter((folder) => normalizeFolderToken(folder) !== "inbox");
}

function shouldRemoveExistingMessageFromList(message: EmailMessage, params: ListMessagesParams): boolean {
  if (params.unread === true && !message.unread) return true;
  if (params.folderID && !messageHasFolder(message, params.folderID)) return true;
  const query = params.q?.trim().toLowerCase() ?? "";
  if (query && !messageMatchesSearch(message, query)) return true;

  const mailbox = params.mailbox ?? "primary";
  if (mailbox === "primary") {
    return messageHasAnyFolder(message, ["sent", "\\sent", "trash", "\\trash", "spam", "\\spam", "junk", "\\junk"]);
  }
  if (mailbox === "archive") {
    return messageHasAnyFolder(message, ["inbox", "\\inbox", "sent", "\\sent", "trash", "\\trash", "spam", "\\spam", "junk", "\\junk", "draft", "drafts", "\\draft", "\\drafts"]);
  }
  return !messageMatchesMailbox(message, mailbox);
}

export function emailMessageMatchesListFilters(message: EmailMessage, params: ListMessagesParams): boolean {
  if (params.unread === true && !message.unread) return false;
  if (params.folderID && !messageHasFolder(message, params.folderID)) return false;
  if (!messageMatchesMailbox(message, params.mailbox ?? "primary")) return false;
  const query = params.q?.trim().toLowerCase() ?? "";
  if (query && !messageMatchesSearch(message, query)) return false;
  return true;
}

export function createMessageQuery(params: ListMessagesParams): string {
  const query = new URLSearchParams();
  if (params.limit && params.limit > 0) query.set("limit", String(params.limit));
  if (params.pageToken) query.set("page_token", params.pageToken);
  if (params.mailbox) query.set("mailbox", params.mailbox);
  if (params.folderID) query.set("folder_id", params.folderID);
  if (params.companyID?.trim()) query.set("company_id", params.companyID.trim());
  if (params.sharedInboxID?.trim()) query.set("shared_inbox_id", params.sharedInboxID.trim());
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.unread !== undefined) query.set("unread", String(params.unread));
  if (params.refresh === true) query.set("refresh", "true");
  const raw = query.toString();
  return raw ? `?${raw}` : "";
}

export function createFolderQuery(params: ListEmailFoldersParams = {}): string {
  const query = new URLSearchParams();
  if (params.companyID?.trim()) query.set("company_id", params.companyID.trim());
  if (params.sharedInboxID?.trim()) query.set("shared_inbox_id", params.sharedInboxID.trim());
  const raw = query.toString();
  return raw ? `?${raw}` : "";
}

export function parseEmailAddressList(raw: string): EmailAddress[] {
  const seen = new Set<string>();
  return raw
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseEmailAddress)
    .filter((item): item is EmailAddress => !!item)
    .filter((item) => {
      const key = item.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parseEmailAddress(raw: string): EmailAddress | null {
  const bracketMatch = raw.match(/^(.*?)<([^<>]+)>$/);
  const email = (bracketMatch ? bracketMatch[2] : raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = bracketMatch ? bracketMatch[1].trim().replace(/^"|"$/g, "") : "";
  return name ? { name, email } : { email };
}

async function cachedRead<T>(key: string, maxAgeMs: number, load: () => Promise<T>, clone: (value: T) => T): Promise<T> {
  ensureCommunicationsCacheAuthScope();
  const cachedEntry = communicationsReadCache.get(key) as CacheEntry<T> | undefined;
  const cached = readCache(cachedEntry ?? null, maxAgeMs, clone);
  if (cached) return cached;

  const inflight = communicationsReadInflight.get(key) as Promise<T> | undefined;
  if (inflight) return clone(await inflight);

  const request = load()
    .then((value) => {
      const cachedValue = clone(value);
      communicationsReadCache.set(key, { value: cachedValue, fetchedAt: Date.now() });
      return cachedValue;
    })
    .finally(() => {
      communicationsReadInflight.delete(key);
    });
  communicationsReadInflight.set(key, request);
  return clone(await request);
}

function ensureCommunicationsCacheAuthScope(): void {
  const generation = getAuthSessionCacheGeneration();
  if (generation === communicationsAuthSessionGeneration) return;
  communicationsAuthSessionGeneration = generation;
  invalidateCommunicationsCache();
}

function invalidateCacheKey(key: string): void {
  communicationsReadCache.delete(key);
  communicationsReadInflight.delete(key);
}

function clearEmailFolderCache(): void {
  foldersCache.clear();
  foldersInflight.clear();
}

function clearMessagePageCache(): void {
  messagePageCache.clear();
  messagePageInflight.clear();
}

function markWorkspacePanelSnapshotScopeStale(companyID: string, options: Parameters<typeof markWorkspaceSnapshotScopeStale>[2]): void {
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) return;
  markWorkspaceSnapshotScopeStale(readAuthConfig().apiBase, cleanCompanyID, options);
}

function markNodeWorkspaceSnapshotScopesStale(companyID: string): void {
  markWorkspacePanelSnapshotScopeStale(companyID, { scope: "node_map" });
  markWorkspacePanelSnapshotScopeStale(companyID, { scope: "company_explorer" });
}

function markLogicGateWorkspaceSnapshotScopesStale(companyID: string, logicGateID: string): void {
  const cleanLogicGateID = logicGateID.trim();
  markWorkspacePanelSnapshotScopeStale(companyID, { scope: "logic_gate_map" });
  markWorkspacePanelSnapshotScopeStale(companyID, { scope: "company_explorer" });
  if (cleanLogicGateID) markWorkspacePanelSnapshotScopeStale(companyID, { scope: "kanban", boardID: logicGateKanbanBoardID(cleanLogicGateID) });
}

function markKanbanWorkspaceSnapshotScopeStale(companyID: string, boardID: string): void {
  const cleanBoardID = boardID.trim();
  if (!cleanBoardID) return;
  markWorkspacePanelSnapshotScopeStale(companyID, { scope: "kanban", boardID: cleanBoardID });
}

function invalidateWorkspacePanelCache(companyID: string): void {
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) return;
  clearWorkspacePanelReadCache(cleanCompanyID);
}

function clearWorkspacePanelReadCache(cleanCompanyID: string): void {
  for (const key of [
    `logic-gates:${cleanCompanyID}`,
    `nodes:${cleanCompanyID}`,
    `node-folders:${cleanCompanyID}`,
    `node-folder-items:${cleanCompanyID}`,
    `logic-gate-folders:${cleanCompanyID}`,
    `logic-gate-folder-items:${cleanCompanyID}`,
    `company-users:${cleanCompanyID}`,
  ]) {
    invalidateCacheKey(key);
  }
}


function readCache<T>(entry: CacheEntry<T> | null, maxAgeMs: number, clone: (value: T) => T): T | null {
  if (!entry || Date.now() - entry.fetchedAt > maxAgeMs) return null;
  return clone(entry.value);
}

function primeMessageCaches(message: EmailMessage): void {
  messageDetailCache.set(message.id, { value: cloneMessage(message), fetchedAt: Date.now() });
}

function messageDetailCacheKey(messageID: string, companyID?: string, sharedInboxID?: string): string {
  const cleanCompanyID = companyID?.trim() ?? "";
  const cleanSharedInboxID = sharedInboxID?.trim() ?? "";
  const cleanMessageID = messageID.trim();
  return cleanCompanyID || cleanSharedInboxID ? `${cleanCompanyID}\x1f${cleanSharedInboxID}\x1f${cleanMessageID}` : cleanMessageID;
}

function createSharedInboxMessageMutationQuery(sharedInboxID?: string, companyID?: string): string {
  const query = new URLSearchParams();
  const cleanSharedInboxID = sharedInboxID?.trim() ?? "";
  const cleanCompanyID = companyID?.trim() ?? "";
  if (cleanCompanyID) query.set("company_id", cleanCompanyID);
  if (cleanSharedInboxID) query.set("shared_inbox_id", cleanSharedInboxID);
  const raw = query.toString();
  return raw ? `?${raw}` : "";
}

function isEmailMessageDetailed(message: EmailMessage): boolean {
  return typeof message.body === "string" && message.body.trim().length > 0;
}

function cloneStatus(status: CommunicationsStatus): CommunicationsStatus {
  return {
    ...status,
    connection: status.connection ? { ...status.connection } : undefined,
  };
}

function cloneFolders(folders: EmailFolder[]): EmailFolder[] {
  return folders.map((folder) => ({
    ...folder,
    attributes: folder.attributes ? [...folder.attributes] : undefined,
  }));
}

function cloneMessagePage(page: MessagePage): MessagePage {
  return {
    messages: sortEmailMessagesByDateDescending(page.messages ?? []),
    next_page_token: page.next_page_token,
  };
}

function cloneMessage(message: EmailMessage): EmailMessage {
  return {
    ...message,
    from: cloneEmailAddresses(message.from),
    to: cloneEmailAddresses(message.to),
    cc: cloneEmailAddresses(message.cc),
    bcc: cloneEmailAddresses(message.bcc),
    reply_to: cloneEmailAddresses(message.reply_to),
    folders: message.folders ? [...message.folders] : undefined,
    folder_ids: message.folder_ids ? [...message.folder_ids] : undefined,
    logic_gate_ids: message.logic_gate_ids ? [...message.logic_gate_ids] : undefined,
    logic_gate_count: message.logic_gate_count,
  };
}

function cloneEmailAddresses(addresses: EmailAddress[] | undefined): EmailAddress[] | undefined {
  return addresses ? addresses.map((address) => ({ ...address })) : undefined;
}

function cloneSharedInboxes(inboxes: CommunicationsSharedInbox[]): CommunicationsSharedInbox[] {
  return inboxes.map(cloneSharedInbox);
}

function cloneSharedInbox(inbox: CommunicationsSharedInbox): CommunicationsSharedInbox {
  return {
    ...inbox,
    raci_assignments: cloneSharedInboxRaciAssignments(inbox.raci_assignments ?? []),
    access_grants: cloneResourceAccessGrants(inbox.access_grants ?? []),
  };
}

function cloneResourceAccessGrants(grants: ResourceAccessGrant[]): ResourceAccessGrant[] {
  return grants.map((grant) => ({ ...grant }));
}

function cloneSharedInboxRaciAssignments(assignments: CommunicationsSharedInboxRaciAssignment[]): CommunicationsSharedInboxRaciAssignment[] {
  return assignments.map((assignment) => ({ ...assignment }));
}

function dispatchCommunicationsSharedInboxesUpdated(companyID: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED, { detail: { companyID: companyID.trim() } }));
}

function cloneTriageItem(item: CommunicationsTriageItem): CommunicationsTriageItem {
  return {
    ...item,
    message: cloneMessage(item.message),
  };
}

function cloneCompanyExplorerFolders(folders: CompanyExplorerFolder[]): CompanyExplorerFolder[] {
  return folders.map((folder) => ({ ...folder }));
}

function cloneCompanyExplorerFolderItems(items: CompanyExplorerFolderItem[]): CompanyExplorerFolderItem[] {
  return items.map((item) => ({ ...item }));
}

function cloneLogicGates(logicGates: LogicGateRecord[]): LogicGateRecord[] {
  return logicGates.map((logicGate) => ({
    ...logicGate,
    raci_assignments: cloneLogicGateRaciAssignments(logicGate.raci_assignments ?? []),
  }));
}

function cloneLogicGateRaciAssignments(assignments: LogicGateRaciAssignment[]): LogicGateRaciAssignment[] {
  return assignments.map((assignment) => ({ ...assignment }));
}

function cloneCompanyUsers(users: CompanyUser[]): CompanyUser[] {
  return users.map((user) => ({ ...user }));
}

function cloneLogicGateShortcuts(shortcuts: UserLogicGateShortcut[]): UserLogicGateShortcut[] {
  return shortcuts.map((shortcut) => ({ ...shortcut }));
}

function cloneNodes(nodes: NodeRecord[]): NodeRecord[] {
  return nodes.map((node) => ({
    ...node,
    logic_gate_ids: node.logic_gate_ids ? [...node.logic_gate_ids] : undefined,
  }));
}

function cleanIDs(values: string[]): string[] {
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

function listMessageParamsFromCacheKey(path: string): ListMessagesParams {
  const queryStart = path.indexOf("?");
  const query = new URLSearchParams(queryStart >= 0 ? path.slice(queryStart + 1) : "");
  const limit = Number.parseInt(query.get("limit") ?? "", 10);
  const unread = query.get("unread");
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    pageToken: query.get("page_token") ?? undefined,
    mailbox: normalizeMailbox(query.get("mailbox") ?? undefined),
    folderID: query.get("folder_id") ?? undefined,
    companyID: query.get("company_id") ?? undefined,
    sharedInboxID: query.get("shared_inbox_id") ?? undefined,
    q: query.get("q") ?? undefined,
    unread: unread === "true" ? true : unread === "false" ? false : undefined,
  };
}

function normalizeMailbox(value: string | undefined): EmailMailbox | undefined {
  if (value === "primary" || value === "sent" || value === "starred" || value === "all" || value === "archive") return value;
  return undefined;
}

function messageMatchesMailbox(message: EmailMessage, mailbox: EmailMailbox): boolean {
  if (mailbox === "all") return true;
  if (mailbox === "sent") return messageHasAnyFolder(message, ["sent", "\\sent"]);
  if (mailbox === "starred") return message.starred;
  if (mailbox === "archive") return messageIsArchived(message);
  if (messageHasAnyFolder(message, ["sent", "\\sent", "trash", "\\trash", "spam", "\\spam", "junk", "\\junk"])) return false;
  return messageFolderTokens(message).length === 0 || messageHasAnyFolder(message, ["inbox", "\\inbox"]);
}

function messageIsArchived(message: EmailMessage): boolean {
  if (messageHasAnyFolder(message, ["trash", "\\trash", "spam", "\\spam", "junk", "\\junk", "sent", "\\sent", "draft", "\\draft", "drafts", "\\drafts"])) return false;
  return !messageHasAnyFolder(message, ["inbox", "\\inbox"]);
}

function messageMatchesSearch(message: EmailMessage, query: string): boolean {
  const haystack = [
    message.subject,
    message.snippet,
    message.body,
    formatAddressesForSearch(message.from),
    formatAddressesForSearch(message.to),
    formatAddressesForSearch(message.cc),
    formatAddressesForSearch(message.bcc),
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function formatAddressesForSearch(addresses: EmailAddress[] | undefined): string {
  return (addresses ?? []).map((address) => `${address.name ?? ""} ${address.email}`).join(" ");
}

function messageHasAnyFolder(message: EmailMessage, candidates: string[]): boolean {
  return candidates.some((candidate) => messageHasFolder(message, candidate));
}

function messageHasFolder(message: EmailMessage, folder: string): boolean {
  const normalized = normalizeFolderToken(folder);
  if (!normalized) return false;
  return messageFolderTokens(message).some((token) => token === normalized);
}

function messageFolderTokens(message: EmailMessage): string[] {
  return [...(message.folders ?? []), ...(message.folder_ids ?? [])]
    .map(normalizeFolderToken)
    .filter(Boolean);
}

function normalizeFolderToken(value: string): string {
  let token = value.trim().toLowerCase();
  while (token.startsWith("\\")) token = token.slice(1);
  if (token.startsWith("category_")) token = `category:${token.slice("category_".length)}`;
  return token;
}
