import { apiFetchJSON, getApiAccessToken, getAuthSessionCacheGeneration, readAuthConfig } from "../../auth/cognitoAuth.js";
import type { CompanyExplorerFolderItem } from "../folders/companyExplorerFolders.js";
import type { CompanyExplorerV2Row } from "../company-explorer/companyExplorerLazyApi.js";
import type { KanbanBoard, KanbanCard } from "../kanban/shared.js";
import type { NodeRecord } from "../nodes/types.js";
import type { LogicGateRACIAssignment, LogicGateRACIRole, LogicGateRACIPrincipalType, LogicGateRecord } from "../logic-gates/types.js";
import type { ProjectRelationshipProjection } from "../project-management/projectManagementApi.js";
import { invalidateResourcePolicyDependentCaches } from "../permissions/resourcePolicyCaches.js";
import { requestJSONWithMeta } from "../api/requestJSON.js";
import { scheduleOutboundEmailDispatch } from "./outboundEmailUndo.js";
import type { EditorProjectionItem } from "../editor/editorProjection.js";

export type EmailProvider = "google" | "microsoft";

export type EmailConnection = {
  user_id: string;
  provider: EmailProvider;
  account_email: string;
  scope?: "personal" | "shared" | string;
  status: "connected" | "disconnected" | "reauth_required" | "configuration_required";
  created_timestamp: string;
  updated_timestamp: string;
};

export type CommunicationsStatus = {
  configured: boolean;
  connected: boolean;
  status: "connected" | "disconnected" | "reauth_required" | "configuration_required";
  connection?: EmailConnection;
};

export type EmailAddress = {
  name?: string;
  email: string;
};

export type EmailAttachment = {
  id?: string;
  attachment_id?: string;
  filename: string;
  content_type?: string;
  content?: string;
  content_id?: string;
  content_disposition?: string;
  is_inline?: boolean;
  size?: number;
};

export type EmailReadSignal = {
  timestamp: string;
  identity_available?: boolean;
  person_name?: string;
  person_email?: string;
};

export type EmailReadStatus = {
  message_id?: string;
  thread_id?: string;
  status: "read" | "likely_read";
  signal_count?: number;
  first_signal_timestamp?: string;
  last_signal_timestamp?: string;
  signals?: EmailReadSignal[];
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
  email_message_id?: string;
  email_thread_id?: string;
  message_order?: number;
  id: string;
  detail_fetched?: boolean;
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
  attachments?: EmailAttachment[];
  folders?: string[];
  folder_ids?: string[];
  logic_gate_ids?: string[];
  logic_gate_count?: number;
  thread_message_count?: number;
  thread_unread_count?: number;
  read_status?: EmailReadStatus;
  local_replies?: EmailMessage[];
  collaboration_id?: string;
  collaboration_node_id?: string;
  collaboration_information_id?: string;
  collaboration_scope_type?: string;
  collaboration_personal_user_id?: string;
  collaboration_shared_inbox_id?: string;
  collaboration_account_email?: string;
  /** Client-only immutable mailbox scope used to keep provider IDs isolated in mixed collaboration lists. */
  client_source_scope_key?: string;
};

export type ListMessagesParams = {
  limit?: number;
  pageToken?: string;
  order?: "oldest";
  mailbox?: EmailMailbox;
  folderID?: string;
  threadID?: string;
  companyID?: string;
  sharedInboxID?: string;
  accountEmail?: string;
  q?: string;
  unread?: boolean;
  refresh?: boolean;
};

export type EmailMailbox = "primary" | "drafts" | "sent" | "starred" | "all" | "archive" | "spam";

export type ListEmailFoldersParams = {
  companyID?: string;
  sharedInboxID?: string;
  accountEmail?: string;
  refresh?: boolean;
};

export type CommunicationsSharedInboxRACIRole = LogicGateRACIRole;
export type CommunicationsSharedInboxRACIPrincipalType = "user" | "group";

export type CommunicationsSharedInboxRACIAssignment = {
  company_id: string;
  folder_id: string;
  resource_type?: string;
  resource_id?: string;
  role: CommunicationsSharedInboxRACIRole;
  principal_type?: CommunicationsSharedInboxRACIPrincipalType;
  principal_id?: string;
  principal_name?: string;
  user_id: string;
  user_display_name?: string;
  user_email?: string;
  created_timestamp: string;
};

export type ResourceAccessLevel = "no_access" | "edit";

export type ResourceAccessGrant = {
  company_id: string;
  entity_type?: "node" | "logic_gate" | "shared_inbox_folder" | "shared_inbox" | "company_explorer_folder" | "project";
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
  shared_inbox_id?: string;
  parent_folder_id?: string;
  folder_kind: "communications";
  entry_type?: "folder" | "shared_inbox";
  name: string;
  default_access?: "edit" | "no_access";
  account_email?: string;
  company_email_connection_id?: string;
  position: number;
  gvic_assignments?: CommunicationsSharedInboxRACIAssignment[];
  access_grants?: ResourceAccessGrant[];
  effective_access_level?: ResourceAccessLevel;
  created_timestamp: string;
  updated_timestamp: string;
};

export type CommunicationsSharedInboxCreateIntent = {
  companyID: string;
  folderID?: string;
  parentFolderID?: string;
  name?: string;
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

export type CompanyUserGroup = {
  company_id: string;
  group_id: string;
  parent_group_id?: string;
  name: string;
  position: number;
};

export type CompanyUserGroupMember = {
  company_id: string;
  group_id: string;
  user_id: string;
  user_display_name?: string;
  user_email?: string;
  created_timestamp?: string;
  updated_timestamp?: string;
};

export type CompanyUserGroupsResponse = {
  groups: CompanyUserGroup[];
  members: CompanyUserGroupMember[];
};

export type CommunicationsWorkspaceResources = {
  logicGates: LogicGateRecord[];
  myLogicGateShortcuts: UserLogicGateShortcut[];
  nodes: NodeRecord[];
};

export type CommunicationsWorkspaceResourceCacheScope = {
  logicGates?: boolean;
  nodes?: boolean;
  companyUsers?: boolean;
  userGroups?: boolean;
};

export type MessagePage = {
  messages: EmailMessage[];
  next_page_token?: string;
};

export type CommunicationsArchiveJobItem = {
	job_item_id: string;
	job_id: string;
	message_id: string;
	status: "pending" | "processing" | "archived" | "failed";
	provider_attempt_count: number;
	last_error?: string;
};

export type CommunicationsArchiveJob = {
	job_id: string;
	status: "pending" | "processing" | "completed" | "failed";
	requested_count: number;
	accepted_message_ids: string[];
	items: CommunicationsArchiveJobItem[];
};

export type ArchiveEmailMessagesBatchOptions = {
	accountEmail?: string;
};

export type CommunicationsArchiveJobMailboxScope = {
	companyID?: string;
	sharedInboxID?: string;
	accountEmail?: string;
};

type CommunicationsArchiveJobCacheEntry = {
	job: CommunicationsArchiveJob;
	etag: string;
	fresh: boolean;
	companyID: string;
	sharedInboxID: string;
	accountEmail: string;
};

export type MergeEmailMessageOptions = {
  prependIfMissing?: boolean;
  maxMessages?: number;
  companyID?: string;
  sharedInboxID?: string;
  accountEmail?: string;
};

export type SendEmailInput = {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
  reply_to_message_id?: string;
  company_id?: string;
  shared_inbox_id?: string;
  account_email?: string;
};

export type LocalEmailReplyScope = {
  companyID?: string;
  sharedInboxID?: string;
  userID?: string;
  accountEmail?: string;
};

export type CalendarInviteRSVPStatus = "yes" | "maybe" | "no";

export type CalendarInviteRSVPResponse = {
  status: "responded" | string;
  rsvp_status: CalendarInviteRSVPStatus;
  event_id: string;
  calendar_id?: string;
};
export type CalendarInviteEventParticipant = {
  name?: string;
  email?: string;
  status?: string;
};

export type CalendarInviteEventWhen = {
  object?: string;
  time?: number;
  start_time?: number;
  end_time?: number;
  date?: string;
  start_date?: string;
  end_date?: string;
  start_timezone?: string;
  end_timezone?: string;
};

export type CalendarInviteEvent = {
  id: string;
  calendar_id?: string;
  ical_uid?: string;
  title?: string;
  status?: string;
  description?: string;
  location?: string;
  html_link?: string;
  conference_url?: string;
  busy?: boolean;
  read_only?: boolean;
  organizer?: EmailAddress;
  participants?: CalendarInviteEventParticipant[];
  when?: CalendarInviteEventWhen;
  rsvp_status?: CalendarInviteRSVPStatus;
};

export type CalendarInviteEventResponse = {
  event: CalendarInviteEvent;
};

export type CommunicationsEmailDraftAttachment = {
  resource_attachment_id: string;
  attachment_id: string;
  relationship_kind?: string;
  attachment?: {
    attachment_id: string;
    original_filename: string;
    mime_type: string;
    byte_size: number;
  };
};

export type CommunicationsEmailDraft = {
  company_id: string;
  draft_id: string;
  scope_type: "personal" | "shared" | string;
  personal_user_id?: string;
  personal_account_email?: string;
  shared_inbox_id?: string;
  kind: "compose" | "reply" | "forward" | string;
  source_message_id?: string;
  account_email?: string;
  to_recipients: string;
  cc_recipients: string;
  bcc_recipients: string;
  subject: string;
  body_editor_html: string;
  reply_to_message?: EmailMessage | null;
  scheduled_send_timestamp?: string;
  created_timestamp: string;
  updated_timestamp: string;
  attachments?: CommunicationsEmailDraftAttachment[];
  collaboration_id?: string;
  email_thread_id?: string;
  origin_node_id?: string;
  is_shared?: boolean;
  revision?: number;
  updated_by_user_id?: string;
};

export type CommunicationsEmailDraftScope = {
  sharedInboxID?: string;
  accountEmail?: string;
  revision?: number;
};

export type CommunicationsEmailSignature = {
  company_id: string;
  signature_id: string;
  scope_type: "personal" | "shared" | string;
  personal_user_id?: string;
  personal_account_email?: string;
  shared_inbox_id?: string;
  name: string;
  body_editor_html: string;
  is_default: boolean;
  created_timestamp: string;
  updated_timestamp: string;
};

export type SaveCommunicationsEmailDraftInput = {
  companyID: string;
  draftID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  senderAccountEmail?: string;
  kind?: "compose" | "reply" | "forward";
  sourceMessageID?: string;
  replyToMessageID?: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyEditorHTML: string;
  replyToMessage?: EmailMessage | null;
  scheduledSendTimestamp?: string;
  collaborationID?: string;
  emailThreadID?: string;
  originNodeID?: string;
  sharedDraft?: boolean;
  revision?: number;
};

export type CommunicationsEmailCollaborationParticipant = {
  company_id: string;
  collaboration_id: string;
  user_id: string;
  added_by_user_id?: string;
  added_via_type?: "creator" | "user" | "group" | string;
  added_via_id?: string;
  created_timestamp?: string;
};

export type CommunicationsEmailCollaboration = {
  company_id: string;
  collaboration_id: string;
  email_thread_id?: string;
  node_id: string;
  attached_email_information_id: string;
  scope_type?: "personal" | "shared" | string;
  personal_user_id?: string;
  personal_account_email?: string;
  personal_owner_user_id?: string;
  shared_inbox_id?: string;
  account_email?: string;
  provider_thread_id?: string;
  root_message_id?: string;
  latest_message_id?: string;
  message_snapshot?: EmailMessage | null;
  message?: EmailMessage | null;
  latest_message?: EmailMessage | null;
  participants?: CommunicationsEmailCollaborationParticipant[];
  created_timestamp?: string;
  updated_timestamp?: string;
};

export type ListCommunicationsEmailCollaborationsInput = {
  companyID: string;
  messageID?: string;
  threadID?: string;
  sharedInboxID?: string;
  accountEmail?: string;
};

export type CommunicationsEmailThreadChatGroup = {
  node_id: string;
  node_name: string;
  textbox_id: string;
  textbox_title: string;
  textbox_display_order: number;
  email_thread_id: string;
  linked_messages: Array<{
    email_message_id: string;
    provider_message_id: string;
    message_timestamp: string;
  }>;
  chats: EditorProjectionItem[];
};

export type CommunicationsEmailThreadTextboxLink = {
  node_id: string;
  textbox_id: string;
  email_message_id: string;
  provider_message_id: string;
};

export type CommunicationsEmailThreadChats = {
  collaborations: CommunicationsEmailCollaboration[];
  groups: CommunicationsEmailThreadChatGroup[];
  textbox_links: CommunicationsEmailThreadTextboxLink[];
};

export type EnsureCommunicationsEmailCollaborationInput = ListCommunicationsEmailCollaborationsInput & {
  message: EmailMessage;
  newNodeID?: string;
  targetNodeID?: string;
  priority?: number;
  linkedTextBlock?: { type: string; information: string; informationID: string };
  initialChat?: { type: string; information: string; informationID: string };
};

export type CommunicationsEmailCollaborationThread = {
  collaboration_id: string;
  email_thread_id?: string;
  thread_id?: string;
  messages: EmailMessage[];
  download_status?: "partial" | "downloading" | "complete" | "failed";
  fetched_at?: string;
  last_download_error?: string;
  history_complete: boolean;
};

export type CommunicationsStoredEmailThread = {
  email_thread_id: string;
  thread_id?: string;
  messages: EmailMessage[];
  history_complete: boolean;
  download_status?: "partial" | "downloading" | "complete" | "failed";
  fetched_at?: string;
  last_download_error?: string;
};

export type SendCommunicationsEmailCollaborationDraftResult = {
  message: EmailMessage;
  collaboration_id: string;
  draft_id: string;
  draft_deleted: boolean;
  draft_delete_error?: string;
};

type CacheEntry<T> = {
  value: T;
  fetchedAt: number;
};

type MessageDetailCacheEntry = CacheEntry<EmailMessage> & {
  detailFetched: boolean;
};

type ScopedMessageCacheEntry = CacheEntry<EmailMessage> & {
  companyID: string;
  sharedInboxID: string;
  accountEmail: string;
};

const STATUS_CACHE_TTL_MS = 60_000;
const WORKDAY_EMAIL_CACHE_TTL_MS = 10 * 60 * 60_000;
const FOLDERS_CACHE_TTL_MS = WORKDAY_EMAIL_CACHE_TTL_MS;
const MESSAGE_PAGE_CACHE_TTL_MS = 30_000;
const MESSAGE_DETAIL_CACHE_TTL_MS = WORKDAY_EMAIL_CACHE_TTL_MS;
const MESSAGE_STALE_ON_RATE_LIMIT_TTL_MS = 24 * 60 * 60_000;
const SHARED_INBOX_CACHE_TTL_MS = 5 * 60_000;
const WORKSPACE_RESOURCE_CACHE_TTL_MS = 5 * 60_000;
const EMAIL_DRAFT_LIST_CACHE_TTL_MS = 5_000;
const NODE_EMAIL_THREAD_CACHE_TTL_MS = 30_000;
const RECENT_ARCHIVED_MESSAGE_TTL_MS = WORKDAY_EMAIL_CACHE_TTL_MS;
const RECENT_PRIMARY_MESSAGE_TTL_MS = WORKDAY_EMAIL_CACHE_TTL_MS;
const PRIMARY_EXCLUDED_FOLDER_TOKENS = ["sent", "trash", "spam", "junk", "category:social", "category:promotions"] as const;
const LOCAL_EMAIL_REPLIES_STORAGE_PREFIX = "mangorts:communications-local-replies-v1";
const LOCAL_EMAIL_THREAD_REPLIES_STORAGE_PREFIX = "mangorts:communications-local-thread-replies-v1";
const RECENT_STARRED_MESSAGE_TTL_MS = WORKDAY_EMAIL_CACHE_TTL_MS;
export const EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED = "mangorts:communications-shared-inboxes-updated";

let statusCache: CacheEntry<CommunicationsStatus> | null = null;
const foldersCache = new Map<string, CacheEntry<EmailFolder[]>>();
const messagePageCache = new Map<string, CacheEntry<MessagePage>>();
const messageDetailCache = new Map<string, MessageDetailCacheEntry>();
const archiveJobCache = new Map<string, CommunicationsArchiveJobCacheEntry>();
const archiveJobInflight = new Map<string, Promise<CommunicationsArchiveJob>>();
const recentArchivedMessages = new Map<string, ScopedMessageCacheEntry>();
const recentPrimaryMessages = new Map<string, ScopedMessageCacheEntry>();
const recentStarredMessages = new Map<string, ScopedMessageCacheEntry>();
let statusInflight: Promise<CommunicationsStatus> | null = null;
const foldersInflight = new Map<string, Promise<EmailFolder[]>>();
const foldersCacheWriters = new Map<string, Promise<EmailFolder[]>>();
const messagePageInflight = new Map<string, Promise<MessagePage>>();
const messagePageCacheWriters = new Map<string, Promise<MessagePage>>();
const messageDetailInflight = new Map<string, Promise<EmailMessage>>();
const communicationsReadCache = new Map<string, CacheEntry<unknown>>();
const communicationsReadInflight = new Map<string, Promise<unknown>>();
let communicationsAuthSessionGeneration = getAuthSessionCacheGeneration();

export async function fetchCommunicationsStatus(): Promise<CommunicationsStatus> {
  ensureCommunicationsCacheAuthScope();
  const cached = readCache(statusCache, STATUS_CACHE_TTL_MS, cloneStatus);
  if (cached) return cached;
  if (statusInflight) return cloneStatus(await statusInflight);
  const request = apiFetchJSON<CommunicationsStatus>("/v1/communications/status")
    .then((status) => {
      const value = cloneStatus(status);
      if (statusInflight === request) statusCache = { value, fetchedAt: Date.now() };
      return value;
    })
    .finally(() => {
      if (statusInflight === request) statusInflight = null;
    });
  statusInflight = request;
  return cloneStatus(await request);
}

export async function fetchCommunicationsAuthURL(provider: EmailProvider, accountEmail?: string, sharedInboxCreate?: CommunicationsSharedInboxCreateIntent, personalCompanyID?: string): Promise<string> {
  const query = new URLSearchParams({ provider });
  const cleanAccountEmail = accountEmail?.trim().toLowerCase() ?? "";
  if (cleanAccountEmail) query.set("account_email", cleanAccountEmail);
  const cleanCompanyID = sharedInboxCreate?.companyID.trim() ?? "";
  const cleanPersonalCompanyID = personalCompanyID?.trim() ?? "";
  if (!cleanCompanyID && cleanPersonalCompanyID) query.set("company_id", cleanPersonalCompanyID);
  const cleanFolderID = sharedInboxCreate?.folderID?.trim() ?? "";
  const cleanName = sharedInboxCreate?.name?.trim() ?? "";
  if (cleanCompanyID || cleanFolderID || cleanName || sharedInboxCreate?.parentFolderID?.trim()) {
    if (!cleanCompanyID || (!cleanFolderID && !cleanName)) throw new Error("shared_inbox_create_intent_required");
    query.set("shared_inbox_company_id", cleanCompanyID);
    if (cleanFolderID) query.set("shared_inbox_id", cleanFolderID);
    if (cleanName) query.set("shared_inbox_name", cleanName);
    const cleanParentFolderID = sharedInboxCreate?.parentFolderID?.trim() ?? "";
    if (cleanParentFolderID) query.set("shared_inbox_parent_folder_id", cleanParentFolderID);
  }
  const payload = await apiFetchJSON<{ auth_url: string }>(`/v1/communications/auth-url?${query.toString()}`);
  return payload.auth_url;
}

export async function disconnectCommunications(): Promise<void> {
  await apiFetchJSON<{ status: string }>("/v1/communications/disconnect", { method: "POST" });
  invalidateCommunicationsCache();
}

export async function listEmailFolders(params: ListEmailFoldersParams = {}): Promise<EmailFolder[]> {
  ensureCommunicationsCacheAuthScope();
  const cacheParams = { ...params, refresh: false };
  const cachePath = `/v1/communications/folders${createFolderQuery(cacheParams)}`;
  const requestPath = params.refresh ? `/v1/communications/folders${createFolderQuery(params)}` : cachePath;
  const inflightKey = requestPath;
  const cacheEntry = foldersCache.get(cachePath) ?? null;
  if (!params.refresh) {
    const cached = readCache(cacheEntry, FOLDERS_CACHE_TTL_MS, cloneFolders);
    if (cached) return cached;
  }
  const existingInflight = foldersInflight.get(inflightKey);
  if (existingInflight) return cloneFolders(await existingInflight);
  const request = apiFetchJSON<{ folders?: EmailFolder[] }>(requestPath)
    .then((payload) => {
      const folders = cloneFolders(payload.folders ?? []);
      if (foldersCacheWriters.get(cachePath) === request) {
        foldersCache.set(cachePath, { value: folders, fetchedAt: Date.now() });
      }
      return folders;
    })
    .finally(() => {
      if (foldersInflight.get(inflightKey) === request) foldersInflight.delete(inflightKey);
      if (foldersCacheWriters.get(cachePath) === request) foldersCacheWriters.delete(cachePath);
    });
  foldersInflight.set(inflightKey, request);
  foldersCacheWriters.set(cachePath, request);
  try {
    return cloneFolders(await request);
  } catch (error) {
    const stale = isNylasRateLimitedError(error) ? readCache(cacheEntry, MESSAGE_STALE_ON_RATE_LIMIT_TTL_MS, cloneFolders) : null;
    if (stale) return stale;
    throw error;
  }
}

export async function listEmailMessages(params: ListMessagesParams): Promise<MessagePage> {
  ensureCommunicationsCacheAuthScope();
  const cacheParams = { ...params, refresh: false };
  const cachePath = `/v1/communications/messages${createMessageQuery(cacheParams)}`;
  const requestPath = params.refresh ? `/v1/communications/messages${createMessageQuery(params)}` : cachePath;
  const cacheEntry = messagePageCache.get(cachePath) ?? null;
  const inflightKey = requestPath;
  if (!params.refresh) {
    const cached = readCache(cacheEntry, MESSAGE_PAGE_CACHE_TTL_MS, cloneMessagePage);
    if (cached) return applyLocalMessageOverlaysToPage(cached, cacheParams);
  }
  const existingInflight = messagePageInflight.get(inflightKey);
  if (existingInflight) return applyLocalMessageOverlaysToPage(cloneMessagePage(await existingInflight), cacheParams);
  const pagePromise = apiFetchJSON<MessagePage>(requestPath)
    .then((page) => {
      const normalized = applyLocalMessageOverlaysToPage(cloneMessagePage(page), cacheParams);
      if (messagePageCacheWriters.get(cachePath) === pagePromise) {
        messagePageCache.set(cachePath, { value: normalized, fetchedAt: Date.now() });
        for (const message of normalized.messages) {
          if (isEmailMessageDetailed(message)) {
            primeMessageCaches(message, { companyID: params.companyID, sharedInboxID: params.sharedInboxID, accountEmail: params.accountEmail });
          }
        }
      }
      return normalized;
    })
    .finally(() => {
      if (messagePageInflight.get(inflightKey) === pagePromise) messagePageInflight.delete(inflightKey);
      if (messagePageCacheWriters.get(cachePath) === pagePromise) messagePageCacheWriters.delete(cachePath);
    });
  messagePageInflight.set(inflightKey, pagePromise);
  messagePageCacheWriters.set(cachePath, pagePromise);
  try {
    return cloneMessagePage(await pagePromise);
  } catch (error) {
    const stale = isNylasRateLimitedError(error) ? readCache(cacheEntry, MESSAGE_STALE_ON_RATE_LIMIT_TTL_MS, cloneMessagePage) : null;
    if (stale) return applyLocalMessageOverlaysToPage(stale, cacheParams);
    throw error;
  }
}

export async function listStoredEmailMessages(params: ListMessagesParams): Promise<MessagePage> {
  const localParams = { ...params, pageToken: undefined, refresh: undefined };
  return cloneMessagePage(await apiFetchJSON<MessagePage>(`/v1/communications/stored-messages${createMessageQuery(localParams)}`));
}

export async function ensureEmailMessageIngested(
  messageID: string,
  scope: Pick<ListMessagesParams, "companyID" | "sharedInboxID" | "accountEmail">,
): Promise<EmailMessage> {
  const cleanMessageID = messageID.trim();
  if (!cleanMessageID) throw new Error("email_message_id_required");
  const query = createMessageQuery(scope);
  const payload = await apiFetchJSON<{ message: EmailMessage }>(
    `/v1/communications/messages/${encodeURIComponent(cleanMessageID)}/ingest${query}`,
    { method: "POST" },
  );
  return cloneMessage(payload.message);
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

export async function getEmailMessage(
  messageID: string,
  companyID?: string,
  sharedInboxID?: string,
  localReplyScope: Pick<LocalEmailReplyScope, "userID" | "accountEmail"> = {},
): Promise<EmailMessage> {
  ensureCommunicationsCacheAuthScope();
  const replyScope: LocalEmailReplyScope = { companyID, sharedInboxID, ...localReplyScope };
  const cacheKey = messageDetailCacheKey(messageID, companyID, sharedInboxID, localReplyScope.accountEmail);
  const cacheEntry = messageDetailCache.get(cacheKey) ?? null;
  const cached = readCache(cacheEntry, MESSAGE_DETAIL_CACHE_TTL_MS, cloneMessage);
  if (cached && cacheEntry?.detailFetched) return hydrateEmailMessageLocalReplies({ ...cached, detail_fetched: true }, replyScope);
  const existingInflight = messageDetailInflight.get(cacheKey);
  if (existingInflight) return cloneMessage(await existingInflight);
  const queryParams = new URLSearchParams();
  if (companyID?.trim()) queryParams.set("company_id", companyID.trim());
  if (sharedInboxID?.trim()) queryParams.set("shared_inbox_id", sharedInboxID.trim());
  if (!sharedInboxID?.trim() && localReplyScope.accountEmail?.trim()) queryParams.set("account_email", localReplyScope.accountEmail.trim().toLowerCase());
  const query = queryParams.toString();
  const request = apiFetchJSON<{ message: EmailMessage }>(`/v1/communications/messages/${encodeURIComponent(messageID)}${query ? `?${query}` : ""}`)
    .then((payload) => {
      const message = cloneMessage({ ...payload.message, detail_fetched: true });
      const previous = messageDetailCache.get(cacheKey)?.value;
      const replies = mergeLocalReplies(previous?.local_replies ?? [], [
        ...(message.local_replies ?? []),
        ...readStoredLocalEmailReplies(message.id, replyScope),
        ...readStoredLocalThreadReplies(message.thread_id, replyScope),
      ]);
      const value = cloneMessage({ ...message, local_replies: replies.length > 0 ? replies : undefined });
      if (messageDetailInflight.get(cacheKey) === request) {
        messageDetailCache.set(cacheKey, { value, fetchedAt: Date.now(), detailFetched: true });
      }
      return value;
    })
    .finally(() => {
      if (messageDetailInflight.get(cacheKey) === request) messageDetailInflight.delete(cacheKey);
    });
  messageDetailInflight.set(cacheKey, request);
  try {
    return cloneMessage(await request);
  } catch (error) {
    const stale = isNylasRateLimitedError(error) ? readCache(cacheEntry, MESSAGE_STALE_ON_RATE_LIMIT_TTL_MS, cloneMessage) : null;
    if (stale && cacheEntry?.detailFetched) return hydrateEmailMessageLocalReplies({ ...stale, detail_fetched: true }, replyScope);
    throw error;
  }
}

export async function getStoredEmailThread(
  emailThreadID: string,
  companyID: string,
  sharedInboxID?: string,
  localReplyScope: Pick<LocalEmailReplyScope, "userID" | "accountEmail"> = {},
): Promise<CommunicationsStoredEmailThread> {
  ensureCommunicationsCacheAuthScope();
  const cleanEmailThreadID = emailThreadID.trim();
  if (!cleanEmailThreadID || !companyID.trim()) throw new Error("email_thread_scope_required");
  const replyScope: LocalEmailReplyScope = { companyID, sharedInboxID, ...localReplyScope };
  const queryParams = new URLSearchParams();
  queryParams.set("company_id", companyID.trim());
  if (sharedInboxID?.trim()) queryParams.set("shared_inbox_id", sharedInboxID.trim());
  if (!sharedInboxID?.trim() && localReplyScope.accountEmail?.trim()) {
    queryParams.set("account_email", localReplyScope.accountEmail.trim().toLowerCase());
  }
  const payload = await apiFetchJSON<{ thread?: CommunicationsStoredEmailThread | null }>(
    `/v1/communications/threads/${encodeURIComponent(cleanEmailThreadID)}?${queryParams.toString()}`,
  );
  const hydrate = (message: EmailMessage): EmailMessage => hydrateEmailMessageLocalReplies(
    cloneMessage({ ...message, detail_fetched: true }),
    replyScope,
  );
  if (!payload.thread) throw new Error("stored_email_thread_not_found");
  return {
    ...cloneCommunicationsStoredEmailThread(payload.thread),
    messages: (payload.thread.messages ?? []).map(hydrate),
  };
}

export async function downloadEmailAttachment(
  messageID: string,
  attachmentID: string,
  companyID?: string,
  sharedInboxID?: string,
  options: { signal?: AbortSignal; accountEmail?: string; collaborationID?: string } = {},
): Promise<Blob> {
  const cleanMessageID = messageID.trim();
  const cleanAttachmentID = attachmentID.trim();
  if (!cleanMessageID || !cleanAttachmentID) throw new Error("email_attachment_id_required");
  const queryParams = new URLSearchParams();
  if (companyID?.trim()) queryParams.set("company_id", companyID.trim());
  if (sharedInboxID?.trim()) queryParams.set("shared_inbox_id", sharedInboxID.trim());
  else if (options.accountEmail?.trim()) queryParams.set("account_email", options.accountEmail.trim().toLowerCase());
  if (options.collaborationID?.trim()) queryParams.set("collaboration_id", options.collaborationID.trim());
  const query = queryParams.toString();
  const path = `/v1/communications/messages/${encodeURIComponent(cleanMessageID)}/attachments/${encodeURIComponent(cleanAttachmentID)}${query ? `?${query}` : ""}`;
  const headers = new Headers({ Accept: "application/octet-stream" });
  const token = await getApiAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${readAuthConfig().apiBase}${path}`, { headers, signal: options.signal });
  if (!response.ok) {
    const text = (await response.text()).trim();
    throw new Error(text || `Failed to download attachment (${response.status})`);
  }
  return response.blob();
}

export async function updateEmailMessage(messageID: string, update: { unread?: boolean; starred?: boolean; folders?: string[] }, sharedInboxID?: string, companyID?: string, accountEmail?: string): Promise<EmailMessage> {
  const query = createMailboxMessageMutationQuery(sharedInboxID, companyID, accountEmail);
  const payload = await apiFetchJSON<{ message: EmailMessage }>(`/v1/communications/messages/${encodeURIComponent(messageID)}${query}`, {
    method: "PUT",
    body: JSON.stringify(update),
  });
  const message = cloneMessage({
    ...payload.message,
    ...(update.unread !== undefined ? { unread: update.unread } : {}),
    ...(update.starred !== undefined ? { starred: update.starred } : {}),
  });
  const scope = { companyID, sharedInboxID, accountEmail };
  if (update.starred !== undefined) rememberRecentlyStarredMessage(message, scope);
  applyEmailMessageToCachedPages(message, {
    ...(update.starred !== undefined ? { prependIfMissing: true } : {}),
    ...scope,
  });
  return message;
}

export async function archiveEmailMessagesBatch(messageIDs: string[], sharedInboxID?: string, companyID?: string, options: ArchiveEmailMessagesBatchOptions = {}): Promise<CommunicationsArchiveJob> {
	ensureCommunicationsCacheAuthScope();
	const ids = cleanIDs(messageIDs);
	if (ids.length === 0) throw new Error("email_message_ids_required");
  const queryParams = new URLSearchParams();
  const cleanCompanyID = companyID?.trim() ?? "";
  const cleanSharedInboxID = sharedInboxID?.trim() ?? "";
  if (cleanCompanyID) queryParams.set("company_id", cleanCompanyID);
  if (cleanSharedInboxID) queryParams.set("shared_inbox_id", cleanSharedInboxID);
  if (!cleanSharedInboxID && options.accountEmail?.trim()) queryParams.set("account_email", options.accountEmail.trim().toLowerCase());
  const rawQuery = queryParams.toString();
  const query = rawQuery ? `?${rawQuery}` : "";
	const payload = await apiFetchJSON<{ archive_job: CommunicationsArchiveJob }>(`/v1/communications/messages/archive-batch${query}`, {
    method: "POST",
    body: JSON.stringify({ message_ids: ids }),
  });
	const job = payload.archive_job;
	cacheCommunicationsArchiveJob(job, { companyID, sharedInboxID, accountEmail: options.accountEmail }, false);
	for (const messageID of cleanIDs(job.accepted_message_ids ?? [])) {
		markCachedMessageArchived(messageID, { companyID, sharedInboxID, accountEmail: options.accountEmail });
	}
	return job;
}

export async function getCommunicationsArchiveJob(jobID: string, options: { refresh?: boolean } = {}): Promise<CommunicationsArchiveJob> {
	ensureCommunicationsCacheAuthScope();
	const cleanJobID = jobID.trim();
	if (!cleanJobID) throw new Error("archive_job_id_required");
	const cached = archiveJobCache.get(cleanJobID);
	if (!options.refresh && cached?.fresh) return cloneCommunicationsArchiveJob(cached.job);
	const inflight = archiveJobInflight.get(cleanJobID);
	if (inflight) return cloneCommunicationsArchiveJob(await inflight);
	const headers = new Headers();
	if (cached?.etag) headers.set("If-None-Match", cached.etag);
	const request = requestJSONWithMeta<{ archive_job: CommunicationsArchiveJob }>(
		readAuthConfig().apiBase,
		`/v1/communications/archive-jobs/${encodeURIComponent(cleanJobID)}`,
		{ headers },
	).then((response) => {
		const job = response.notModified ? cached?.job : response.body?.archive_job;
		if (!job) throw new Error("archive_job_304_without_cached_payload");
		cacheCommunicationsArchiveJob(job, cached ?? {}, true, response.etag?.trim() || cached?.etag || "");
		return cloneCommunicationsArchiveJob(job);
	}).finally(() => {
		if (archiveJobInflight.get(cleanJobID) === request) archiveJobInflight.delete(cleanJobID);
	});
	archiveJobInflight.set(cleanJobID, request);
	return cloneCommunicationsArchiveJob(await request);
}

export function markCommunicationsArchiveJobsStaleForMailboxChange(
	scope: CommunicationsArchiveJobMailboxScope,
	messageID: string,
): string[] {
	ensureCommunicationsCacheAuthScope();
	const cleanMessageID = messageID.trim();
	if (!cleanMessageID) return [];
	const normalized = normalizeCommunicationsArchiveJobMailboxScope(scope);
	const staleJobIDs: string[] = [];
	for (const [jobID, entry] of archiveJobCache) {
		if (!communicationsArchiveJobScopeMatches(entry, normalized)) continue;
		const messageMatches = entry.job.accepted_message_ids.some((id) => id.trim() === cleanMessageID)
			|| entry.job.items.some((item) => item.message_id.trim() === cleanMessageID);
		if (!messageMatches) continue;
		entry.fresh = false;
		staleJobIDs.push(jobID);
	}
	return staleJobIDs;
}

function cacheCommunicationsArchiveJob(
	job: CommunicationsArchiveJob,
	scope: CommunicationsArchiveJobMailboxScope | Partial<CommunicationsArchiveJobCacheEntry>,
	fresh: boolean,
	etag = "",
): void {
	const cleanJobID = job.job_id.trim();
	if (!cleanJobID) return;
	const previous = archiveJobCache.get(cleanJobID);
	const normalized = normalizeCommunicationsArchiveJobMailboxScope({
		companyID: scope.companyID ?? previous?.companyID,
		sharedInboxID: scope.sharedInboxID ?? previous?.sharedInboxID,
		accountEmail: scope.accountEmail ?? previous?.accountEmail,
	});
	archiveJobCache.set(cleanJobID, {
		job: cloneCommunicationsArchiveJob(job),
		etag: etag.trim() || previous?.etag || "",
		fresh,
		...normalized,
	});
}

function normalizeCommunicationsArchiveJobMailboxScope(scope: CommunicationsArchiveJobMailboxScope): {
	companyID: string;
	sharedInboxID: string;
	accountEmail: string;
} {
	const sharedInboxID = scope.sharedInboxID?.trim() ?? "";
	return {
		companyID: scope.companyID?.trim() ?? "",
		sharedInboxID,
		accountEmail: sharedInboxID ? "" : scope.accountEmail?.trim().toLowerCase() ?? "",
	};
}

function communicationsArchiveJobScopeMatches(
	entry: Pick<CommunicationsArchiveJobCacheEntry, "companyID" | "sharedInboxID" | "accountEmail">,
	scope: ReturnType<typeof normalizeCommunicationsArchiveJobMailboxScope>,
): boolean {
	return entry.companyID === scope.companyID
		&& entry.sharedInboxID === scope.sharedInboxID
		&& entry.accountEmail === scope.accountEmail;
}

function cloneCommunicationsArchiveJob(job: CommunicationsArchiveJob): CommunicationsArchiveJob {
	return {
		...job,
		accepted_message_ids: [...(job.accepted_message_ids ?? [])],
		items: (job.items ?? []).map((item) => ({ ...item })),
	};
}

export async function unarchiveEmailMessage(messageID: string, sharedInboxID?: string, companyID?: string, accountEmail?: string): Promise<EmailMessage> {
  const query = createMailboxMessageMutationQuery(sharedInboxID, companyID, accountEmail);
  const payload = await apiFetchJSON<{ message: EmailMessage }>(`/v1/communications/messages/${encodeURIComponent(messageID)}/unarchive${query}`, {
    method: "POST",
  });
  const scope = { companyID, sharedInboxID, accountEmail };
  recentArchivedMessages.delete(scopedMessageCacheKey(messageID, scope));
  rememberRecentlyPrimaryMessage(payload.message, scope);
  applyEmailMessageToCachedPages(payload.message, scope);
  return payload.message;
}

export async function deleteEmailMessage(messageID: string, sharedInboxID?: string, companyID?: string, accountEmail?: string): Promise<void> {
  const query = createMailboxMessageMutationQuery(sharedInboxID, companyID, accountEmail);
  await apiFetchJSON<{ status: string }>(`/v1/communications/messages/${encodeURIComponent(messageID)}${query}`, { method: "DELETE" });
  const scope = { companyID, sharedInboxID, accountEmail };
  const cacheKey = scopedMessageCacheKey(messageID, scope);
  recentArchivedMessages.delete(cacheKey);
  recentPrimaryMessages.delete(cacheKey);
  recentStarredMessages.delete(cacheKey);
  invalidateEmailMessageCache(messageID, companyID, sharedInboxID, accountEmail);
  removeEmailMessageFromCachedPages(messageID, scope);
}

export async function sendEmail(input: SendEmailInput): Promise<EmailMessage> {
  const { company_id: companyID, shared_inbox_id: sharedInboxID, account_email: accountEmail, ...messageInput } = input;
  const cleanCompanyID = companyID?.trim() ?? "";
  const query = createMailboxMessageMutationQuery(sharedInboxID, companyID, accountEmail);
  return scheduleOutboundEmailDispatch(async () => {
    const payload = await apiFetchJSON<{ message: EmailMessage }>(`/v1/communications/messages/send${query}`, {
      method: "POST",
      body: JSON.stringify({
        ...(cleanCompanyID ? { company_id: cleanCompanyID } : {}),
        ...messageInput,
      }),
    });
    const message = sentEmailMessageForLocalLists({
      ...payload.message,
      body: payload.message.body?.trim() ? payload.message.body : messageInput.body,
    });
    applyEmailMessageToCachedPages(message, { prependIfMissing: true, companyID, sharedInboxID, accountEmail });
    return message;
  }, { label: messageInput.subject?.trim() || "Email" });
}

export async function getCalendarInviteEvent(input: {
  messageID: string;
  companyID?: string;
  sharedInboxID?: string;
  accountEmail?: string;
}): Promise<CalendarInviteEvent> {
  const mailboxQuery = createMailboxMessageMutationQuery(input.sharedInboxID, input.companyID, input.accountEmail);
  const separator = mailboxQuery ? "&" : "?";
  const response = await apiFetchJSON<CalendarInviteEventResponse>(
    `/v1/communications/calendar-invites/event${mailboxQuery}${separator}message_id=${encodeURIComponent(input.messageID.trim())}`,
  );
  return response.event;
}


export async function respondToCalendarInvite(input: {
  messageID: string;
  status: CalendarInviteRSVPStatus;
  companyID?: string;
  sharedInboxID?: string;
  accountEmail?: string;
}): Promise<CalendarInviteRSVPResponse> {
  const query = createMailboxMessageMutationQuery(input.sharedInboxID, input.companyID, input.accountEmail);
  return apiFetchJSON<CalendarInviteRSVPResponse>(`/v1/communications/calendar-invites/respond${query}`, {
    method: "POST",
    body: JSON.stringify({ message_id: input.messageID.trim(), status: input.status }),
  });
}

export async function listEmailDrafts(
  companyID: string,
  scope: CommunicationsEmailDraftScope,
  options: { refresh?: boolean } = {},
): Promise<CommunicationsEmailDraft[]> {
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) return [];
  const query = createEmailDraftScopeQuery(cleanCompanyID, scope);
  if (Number.isFinite(scope.revision) && (scope.revision ?? 0) > 0) query.set("revision", String(Math.trunc(scope.revision!)));
  const cacheKey = `email-drafts:${cleanCompanyID}:${query.toString()}`;
  if (options.refresh) invalidateCacheKey(cacheKey);
  return cachedRead(cacheKey, EMAIL_DRAFT_LIST_CACHE_TTL_MS, async () => {
    const payload = await apiFetchJSON<{ drafts?: CommunicationsEmailDraft[] }>(`/v1/communications/drafts?${query.toString()}`);
    return payload.drafts ?? [];
  }, (drafts) => drafts.map(cloneCommunicationsEmailDraft));
}

function emailCollaborationQuery(input: ListCommunicationsEmailCollaborationsInput): URLSearchParams {
  const query = new URLSearchParams({ company_id: input.companyID.trim() });
  if (input.messageID?.trim()) query.set("message_id", input.messageID.trim());
  if (input.threadID?.trim()) query.set("thread_id", input.threadID.trim());
  if (input.sharedInboxID?.trim()) query.set("shared_inbox_id", input.sharedInboxID.trim());
  else if (input.accountEmail?.trim()) query.set("account_email", input.accountEmail.trim().toLowerCase());
  return query;
}


export async function listEmailCollaborations(input: ListCommunicationsEmailCollaborationsInput): Promise<CommunicationsEmailCollaboration[]> {
  if (!input.companyID.trim() || (!input.messageID?.trim() && !input.threadID?.trim())) return [];
  const payload = await apiFetchJSON<{ collaborations?: CommunicationsEmailCollaboration[] }>(
    "/v1/communications/email-collaborations?" + emailCollaborationQuery(input).toString(),
  );
  return (payload.collaborations ?? []).map(cloneCommunicationsEmailCollaboration);
}

export async function listEmailThreadChatGroups(input: ListCommunicationsEmailCollaborationsInput): Promise<CommunicationsEmailThreadChats> {
  if (!input.companyID.trim() || (!input.messageID?.trim() && !input.threadID?.trim())) {
    return { collaborations: [], groups: [], textbox_links: [] };
  }
  const payload = await apiFetchJSON<{
    collaborations?: CommunicationsEmailCollaboration[];
    groups?: CommunicationsEmailThreadChatGroup[];
    textbox_links?: CommunicationsEmailThreadTextboxLink[];
  }>(
		"/v1/communications/email-thread-chats?" + emailCollaborationQuery(input).toString(),
	);
	return {
		collaborations: (payload.collaborations ?? []).map(cloneCommunicationsEmailCollaboration),
		groups: payload.groups ?? [],
		textbox_links: payload.textbox_links ?? [],
	};
}

export async function getEmailCollaboration(companyID: string, collaborationID: string): Promise<CommunicationsEmailCollaboration | null> {
  const cleanCompanyID = companyID.trim();
  const cleanCollaborationID = collaborationID.trim();
  if (!cleanCompanyID || !cleanCollaborationID) return null;
  try {
    const query = new URLSearchParams({ company_id: cleanCompanyID });
    const payload = await apiFetchJSON<{ collaboration?: CommunicationsEmailCollaboration | null }>(
      "/v1/communications/email-collaborations/" + encodeURIComponent(cleanCollaborationID) + "?" + query.toString(),
    );
    return payload.collaboration ? cloneCommunicationsEmailCollaboration(payload.collaboration) : null;
  } catch (cause) {
    if ((cause as { status?: unknown } | null)?.status === 404) return null;
    throw cause;
  }
}

export async function getEmailCollaborationThread(companyID: string, collaborationID: string): Promise<CommunicationsEmailCollaborationThread> {
  const cleanCompanyID = companyID.trim();
  const cleanCollaborationID = collaborationID.trim();
  if (!cleanCompanyID || !cleanCollaborationID) throw new Error("email_collaboration_id_required");
  const query = new URLSearchParams({ company_id: cleanCompanyID });
  const payload = await apiFetchJSON<CommunicationsEmailCollaborationThread>(
    "/v1/communications/email-collaborations/" + encodeURIComponent(cleanCollaborationID) + "/thread?" + query.toString(),
  );
  return {
    collaboration_id: payload.collaboration_id,
    email_thread_id: payload.email_thread_id,
    thread_id: payload.thread_id,
    download_status: payload.download_status,
    fetched_at: payload.fetched_at,
    last_download_error: payload.last_download_error,
    messages: (payload.messages ?? []).map((message) => ({
      ...cloneMessage(message),
      collaboration_id: cleanCollaborationID,
    })),
    history_complete: payload.history_complete === true,
  };
}

export async function getNodeEmailThread(
  companyID: string,
  nodeID: string,
  emailThreadID: string,
  options: { refresh?: boolean } = {},
): Promise<CommunicationsStoredEmailThread> {
  const cleanCompanyID = companyID.trim();
  const cleanNodeID = nodeID.trim();
  const cleanEmailThreadID = emailThreadID.trim();
  if (!cleanCompanyID || !cleanNodeID || !cleanEmailThreadID) throw new Error("node_email_thread_id_required");
  const cacheKey = `node-email-thread:${cleanCompanyID}:${cleanNodeID}:${cleanEmailThreadID}`;
  if (options.refresh) invalidateCacheKey(cacheKey);
  return cachedRead(cacheKey, NODE_EMAIL_THREAD_CACHE_TTL_MS, async () => {
    const query = new URLSearchParams({ company_id: cleanCompanyID });
    return apiFetchJSON<CommunicationsStoredEmailThread>(
      `/v1/nodes/${encodeURIComponent(cleanNodeID)}/email-threads/${encodeURIComponent(cleanEmailThreadID)}?${query.toString()}`,
    );
  }, cloneCommunicationsStoredEmailThread);
}

export async function getNodeEmailMessage(
  companyID: string,
  nodeID: string,
  emailThreadID: string,
  emailMessageID: string,
  options: { refresh?: boolean } = {},
): Promise<EmailMessage> {
  const cleanCompanyID = companyID.trim();
  const cleanNodeID = nodeID.trim();
  const cleanEmailThreadID = emailThreadID.trim();
  const cleanEmailMessageID = emailMessageID.trim();
  if (!cleanCompanyID || !cleanNodeID || !cleanEmailThreadID || !cleanEmailMessageID) throw new Error("node_email_message_id_required");
  const cacheKey = `node-email-message:${cleanCompanyID}:${cleanNodeID}:${cleanEmailThreadID}:${cleanEmailMessageID}`;
  if (options.refresh) invalidateCacheKey(cacheKey);
  const stored = await cachedRead(cacheKey, NODE_EMAIL_THREAD_CACHE_TTL_MS, async () => {
    const query = new URLSearchParams({ company_id: cleanCompanyID, message_id: cleanEmailMessageID });
    return apiFetchJSON<CommunicationsStoredEmailThread>(
      `/v1/nodes/${encodeURIComponent(cleanNodeID)}/email-threads/${encodeURIComponent(cleanEmailThreadID)}?${query.toString()}`,
    );
  }, cloneCommunicationsStoredEmailThread);
  const message = stored.messages[0];
  if (!message) throw new Error("node_email_message_not_found");
  return cloneMessage(message);
}

export async function getProjectEmailThread(
  companyID: string,
  projectID: string,
  emailThreadID: string,
  options: { refresh?: boolean } = {},
): Promise<CommunicationsStoredEmailThread> {
  const cleanCompanyID = companyID.trim();
  const cleanProjectID = projectID.trim();
  const cleanEmailThreadID = emailThreadID.trim();
  if (!cleanCompanyID || !cleanProjectID || !cleanEmailThreadID) throw new Error("project_email_thread_id_required");
  const cacheKey = `project-email-thread:${cleanCompanyID}:${cleanProjectID}:${cleanEmailThreadID}`;
  if (options.refresh) invalidateCacheKey(cacheKey);
  return cachedRead(cacheKey, NODE_EMAIL_THREAD_CACHE_TTL_MS, async () => {
    const query = new URLSearchParams({ company_id: cleanCompanyID });
    return apiFetchJSON<CommunicationsStoredEmailThread>(
      `/v1/projects/${encodeURIComponent(cleanProjectID)}/email-threads/${encodeURIComponent(cleanEmailThreadID)}?${query.toString()}`,
    );
  }, cloneCommunicationsStoredEmailThread);
}

export async function getProjectEmailMessage(
  companyID: string,
  projectID: string,
  emailThreadID: string,
  emailMessageID: string,
  options: { refresh?: boolean } = {},
): Promise<EmailMessage> {
  const cleanEmailMessageID = emailMessageID.trim();
  if (!cleanEmailMessageID) throw new Error("project_email_message_id_required");
  const query = new URLSearchParams({ company_id: companyID.trim(), message_id: cleanEmailMessageID });
  const cacheKey = `project-email-message:${companyID.trim()}:${projectID.trim()}:${emailThreadID.trim()}:${cleanEmailMessageID}`;
  if (options.refresh) invalidateCacheKey(cacheKey);
  const stored = await cachedRead(cacheKey, NODE_EMAIL_THREAD_CACHE_TTL_MS, async () => apiFetchJSON<CommunicationsStoredEmailThread>(
    `/v1/projects/${encodeURIComponent(projectID.trim())}/email-threads/${encodeURIComponent(emailThreadID.trim())}?${query.toString()}`,
  ), cloneCommunicationsStoredEmailThread);
  const message = stored.messages[0];
  if (!message) throw new Error("project_email_message_not_found");
  return cloneMessage(message);
}

export async function ensureEmailCollaboration(input: EnsureCommunicationsEmailCollaborationInput): Promise<CommunicationsEmailCollaboration> {
  const cleanCompanyID = input.companyID.trim();
  if (!cleanCompanyID || !input.message.id.trim()) throw new Error("email_collaboration_source_required");
  const payload = await apiFetchJSON<{ collaboration: CommunicationsEmailCollaboration }>(
    "/v1/communications/email-collaborations",
    {
      method: "POST",
      body: JSON.stringify({
        company_id: cleanCompanyID,
        message_id: input.message.id.trim(),
        thread_id: input.threadID?.trim() || input.message.thread_id?.trim() || undefined,
        shared_inbox_id: input.sharedInboxID?.trim() || undefined,
        account_email: input.sharedInboxID?.trim() ? undefined : input.accountEmail?.trim().toLowerCase() || undefined,
        new_node_id: input.newNodeID?.trim() || undefined,
        target_node_id: input.targetNodeID?.trim() || undefined,
        priority: input.priority,
        message: input.message,
        linked_text_block: input.linkedTextBlock ? {
          type: input.linkedTextBlock.type,
          information: input.linkedTextBlock.information,
          information_id: input.linkedTextBlock.informationID,
        } : undefined,
        initial_chat: input.initialChat ? {
          type: input.initialChat.type,
          information: input.initialChat.information,
          information_id: input.initialChat.informationID,
        } : undefined,
      }),
    },
  );
  invalidateCommunicationsReadPrefix(`email-drafts:${cleanCompanyID}:`);
  return cloneCommunicationsEmailCollaboration(payload.collaboration);
}

export async function sendEmailCollaborationDraft(input: {
  companyID: string;
  collaborationID?: string;
  draftID: string;
  expectedRevision: number;
  sharedInboxID?: string;
  accountEmail?: string;
}): Promise<SendCommunicationsEmailCollaborationDraftResult> {
  const companyID = input.companyID.trim();
  const collaborationID = input.collaborationID?.trim() ?? "";
  const draftID = input.draftID.trim();
  const expectedRevision = Math.trunc(input.expectedRevision);
  if (!companyID || !draftID || expectedRevision <= 0 || (!collaborationID && !input.sharedInboxID?.trim() && !input.accountEmail?.trim())) {
    throw new Error("email_collaboration_draft_send_input_required");
  }
  const query = new URLSearchParams({ company_id: companyID });
  if (input.sharedInboxID?.trim()) query.set("shared_inbox_id", input.sharedInboxID.trim());
  if (input.accountEmail?.trim()) query.set("account_email", input.accountEmail.trim());
  const path = collaborationID
    ? `/v1/communications/email-collaborations/${encodeURIComponent(collaborationID)}/drafts/${encodeURIComponent(draftID)}/send`
    : `/v1/communications/drafts/${encodeURIComponent(draftID)}/send`;
  return scheduleOutboundEmailDispatch(async () => {
    const payload = await apiFetchJSON<SendCommunicationsEmailCollaborationDraftResult>(
      `${path}?${query.toString()}`,
      {
        method: "POST",
        body: JSON.stringify({ expected_revision: expectedRevision }),
      },
    );
    const result = {
      ...payload,
      message: cloneMessage(payload.message),
      collaboration_id: payload.collaboration_id?.trim() || collaborationID,
      draft_id: payload.draft_id?.trim() || draftID,
      draft_deleted: payload.draft_deleted === true,
    };
    invalidateCommunicationsReadPrefix(`email-drafts:${companyID}:`);
    return result;
  }, { label: "Shared email" });
}

export async function saveEmailDraft(input: SaveCommunicationsEmailDraftInput): Promise<CommunicationsEmailDraft> {
  const cleanCompanyID = input.companyID.trim();
  const cleanDraftID = input.draftID.trim();
  if (!cleanCompanyID || !cleanDraftID) throw new Error("email_draft_id_required");
  const scheduledSendTimestamp = normalizeDraftTimestampForAPI(input.scheduledSendTimestamp);
  const payload = await apiFetchJSON<{ draft: CommunicationsEmailDraft }>(`/v1/communications/drafts/${encodeURIComponent(cleanDraftID)}`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: cleanCompanyID,
      draft_id: cleanDraftID,
      shared_inbox_id: input.sharedInboxID?.trim() || undefined,
      account_email: input.accountEmail?.trim() || undefined,
      sender_account_email: input.senderAccountEmail?.trim() || undefined,
      kind: input.kind,
      source_message_id: input.sourceMessageID?.trim() || undefined,
      reply_to_message_id: input.replyToMessageID?.trim() || undefined,
      to_recipients: input.to,
      cc_recipients: input.cc,
      bcc_recipients: input.bcc,
      subject: input.subject,
      body_editor_html: input.bodyEditorHTML,
      reply_to_message: input.replyToMessage ?? null,
      scheduled_send_timestamp: scheduledSendTimestamp,
      collaboration_id: input.collaborationID?.trim() || undefined,
      email_thread_id: input.emailThreadID?.trim() || undefined,
      origin_node_id: input.originNodeID?.trim() || undefined,
      is_shared: input.sharedDraft === true || undefined,
      revision: Number.isFinite(input.revision) ? Math.max(0, Math.trunc(input.revision ?? 0)) : undefined,
    }),
  });
  invalidateCommunicationsReadPrefix(`email-drafts:${cleanCompanyID}:`);
  return cloneCommunicationsEmailDraft(payload.draft);
}

export async function deleteEmailDraft(companyID: string, draftID: string, scope: CommunicationsEmailDraftScope): Promise<void> {
  const cleanCompanyID = companyID.trim();
  const cleanDraftID = draftID.trim();
  if (!cleanCompanyID || !cleanDraftID) return;
  const query = createEmailDraftScopeQuery(cleanCompanyID, scope);
  if (Number.isFinite(scope.revision) && (scope.revision ?? 0) > 0) query.set("revision", String(Math.trunc(scope.revision!)));
  await apiFetchJSON<{ status?: string }>(`/v1/communications/drafts/${encodeURIComponent(cleanDraftID)}?${query.toString()}`, {
    method: "DELETE",
  });
  invalidateCommunicationsReadPrefix(`email-drafts:${cleanCompanyID}:`);
}

export async function getEmailSignature(companyID: string, sharedInboxID?: string, accountEmail?: string): Promise<CommunicationsEmailSignature | null> {
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) return null;
  const query = new URLSearchParams({ company_id: cleanCompanyID });
  if (sharedInboxID?.trim()) query.set("shared_inbox_id", sharedInboxID.trim());
  else if (accountEmail?.trim()) query.set("account_email", accountEmail.trim());
  const payload = await apiFetchJSON<{ signature?: CommunicationsEmailSignature | null }>(`/v1/communications/signature?${query.toString()}`);
  return payload.signature ? cloneCommunicationsEmailSignature(payload.signature) : null;
}

export async function saveEmailSignature(input: {
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  bodyEditorHTML: string;
  name?: string;
  isDefault?: boolean;
}): Promise<CommunicationsEmailSignature> {
  const cleanCompanyID = input.companyID.trim();
  if (!cleanCompanyID) throw new Error("company_id_required");
  const payload = await apiFetchJSON<{ signature: CommunicationsEmailSignature }>("/v1/communications/signature", {
    method: "PUT",
    body: JSON.stringify({
      company_id: cleanCompanyID,
      shared_inbox_id: input.sharedInboxID?.trim() || undefined,
      account_email: input.sharedInboxID?.trim() ? undefined : input.accountEmail?.trim() || undefined,
      name: input.name?.trim() || undefined,
      body_editor_html: input.bodyEditorHTML,
      is_default: input.isDefault ?? true,
    }),
  });
  return cloneCommunicationsEmailSignature(payload.signature);
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
  invalidateCommunicationsCache({ folders: true, messagePages: true, messages: true });
  invalidateCacheKey(`shared-inboxes:${cleanCompanyID}`);
  dispatchCommunicationsSharedInboxesUpdated(cleanCompanyID);
}

export async function removeCommunicationsSharedInbox(companyID: string, folderID: string): Promise<void> {
  const cleanCompanyID = companyID.trim();
  const cleanFolderID = folderID.trim();
  await apiFetchJSON<{ status?: string }>(`/v1/communications/shared-inboxes/${encodeURIComponent(cleanFolderID)}?company_id=${encodeURIComponent(cleanCompanyID)}&remove_only=true`, {
    method: "DELETE",
  });
  invalidateCommunicationsCache({ folders: true, messagePages: true, messages: true });
  invalidateCacheKey(`shared-inboxes:${cleanCompanyID}`);
  dispatchCommunicationsSharedInboxesUpdated(cleanCompanyID);
}

export async function updateCommunicationsSharedInboxRACIAssignments(
  companyID: string,
  folderID: string,
  assignments: Array<{ role: CommunicationsSharedInboxRACIRole; principal_type?: CommunicationsSharedInboxRACIPrincipalType; principal_id?: string; user_id?: string }>,
): Promise<CommunicationsSharedInboxRACIAssignment[]> {
  const cleanCompanyID = companyID.trim();
  const cleanFolderID = folderID.trim();
  const path = `/v1/resources/shared_inbox/${encodeURIComponent(cleanFolderID)}/gvic`;
  const current = await apiFetchJSON<{ revision: string }>(
    `${path}?company_id=${encodeURIComponent(cleanCompanyID)}`,
  );
  const payload = await apiFetchJSON<{ gvic_assignments?: CommunicationsSharedInboxRACIAssignment[] }>(path, {
    method: "PUT",
    headers: { "If-Match": current.revision },
    body: JSON.stringify({
      assignment_mode: "customized",
      company_id: cleanCompanyID,
      descendant_action: "inherited_only",
      gvic_assignments: assignments.map(toResourceRACIAssignmentInput),
    }),
  });
  invalidateCacheKey(`shared-inboxes:${cleanCompanyID}`);
  dispatchCommunicationsSharedInboxesUpdated(cleanCompanyID);
  return cloneResourceRACIAssignmentsAsSharedInbox(payload.gvic_assignments ?? [], cleanFolderID);
}

export async function listLogicGates(companyID: string): Promise<LogicGateRecord[]> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`logic-gates:${cleanCompanyID}`, WORKSPACE_RESOURCE_CACHE_TTL_MS, async () => {
    const params = new URLSearchParams({ company_id: cleanCompanyID });
    const payload = await apiFetchJSON<{ logic_gates?: LogicGateRecord[] }>(`/v1/logic-gates?${params.toString()}`);
    return cloneLogicGates(payload.logic_gates ?? []);
  }, cloneLogicGates);
}

export async function listCompanyUsers(companyID: string): Promise<CompanyUser[]> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`company-users:${cleanCompanyID}`, WORKSPACE_RESOURCE_CACHE_TTL_MS, async () => {
    const payload = await apiFetchJSON<{ users?: CompanyUser[] }>(`/v1/companies/${encodeURIComponent(cleanCompanyID)}/users`);
    return cloneCompanyUsers(payload.users ?? []);
  }, cloneCompanyUsers);
}

export async function listCompanyUserGroups(companyID: string): Promise<CompanyUserGroupsResponse> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`company-user-groups:${cleanCompanyID}`, WORKSPACE_RESOURCE_CACHE_TTL_MS, async () => {
    const payload = await apiFetchJSON<{ groups?: CompanyUserGroup[]; members?: CompanyUserGroupMember[] }>(`/v1/companies/${encodeURIComponent(cleanCompanyID)}/user-groups`);
    return cloneCompanyUserGroupsResponse({ groups: payload.groups ?? [], members: payload.members ?? [] });
  }, cloneCompanyUserGroupsResponse);
}

export async function updateLogicGateRACIAssignments(
  companyID: string,
  logicGateID: string,
  assignments: Array<{ role: LogicGateRACIRole; user_id?: string; principal_type?: LogicGateRACIPrincipalType; principal_id?: string }>,
  applyToDescendants = false,
): Promise<LogicGateRACIAssignment[]> {
  const body = {
    company_id: companyID,
    assignment_mode: "customized",
    gvic_assignments: assignments.map(toResourceRACIAssignmentInput),
    descendant_action: applyToDescendants ? "including_customized" : "inherited_only",
  };
  const path = `/v1/resources/logic_gate/${encodeURIComponent(logicGateID)}/gvic`;
  const current = await apiFetchJSON<{ revision: string }>(
    `${path}?company_id=${encodeURIComponent(companyID)}`,
  );
  const payload = await apiFetchJSON<{ gvic_assignments?: LogicGateRACIAssignment[] }>(path, {
    method: "PUT",
    headers: { "If-Match": current.revision },
    body: JSON.stringify(body),
  });
  invalidateWorkspaceResourceCache(companyID);
  invalidateResourcePolicyDependentCaches(readAuthConfig().apiBase, companyID);
  return cloneResourceRACIAssignmentsAsLogicGate(payload.gvic_assignments ?? [], logicGateID);
}

export type LogicGateRACIAssignmentCommandResult = {
  company_id: string;
  logic_gate_id?: string;
  resource_id?: string;
  operation: "add" | "remove";
  changed: boolean;
  gvic_assignments?: LogicGateRACIAssignment[];
};

async function commandLogicGateRACIAssignments(
  companyID: string,
  logicGateID: string,
  operation: "add" | "remove",
  assignments: Array<{ role: LogicGateRACIRole; user_id?: string; principal_type?: LogicGateRACIPrincipalType; principal_id?: string }>,
  applyToDescendants = false,
): Promise<LogicGateRACIAssignment[]> {
  const path = `/v1/resources/logic_gate/${encodeURIComponent(logicGateID)}/gvic`;
  const current = await apiFetchJSON<{ revision: string; gvic_assignments?: LogicGateRACIAssignment[] }>(
    `${path}?company_id=${encodeURIComponent(companyID)}`,
  );
  let next = (current.gvic_assignments ?? []).map(toResourceRACIAssignmentInput);
  for (const assignment of assignments.map(toResourceRACIAssignmentInput)) {
    const matches = (candidate: ReturnType<typeof toResourceRACIAssignmentInput>) => (
      candidate.role === assignment.role
      && candidate.principal_type === assignment.principal_type
      && candidate.principal_id === assignment.principal_id
    );
    if (operation === "remove") {
      next = next.filter((candidate) => !matches(candidate));
      continue;
    }
    next = next.filter((candidate) => !matches(candidate));

    next.push(assignment);
  }
  const payload = await apiFetchJSON<{ gvic_assignments?: LogicGateRACIAssignment[] }>(path, {
    method: "PUT",
    headers: { "If-Match": current.revision },
    body: JSON.stringify({
      company_id: companyID,
      assignment_mode: "customized",
      gvic_assignments: next,
      descendant_action: applyToDescendants ? "including_customized" : "inherited_only",
    }),
  });
  invalidateWorkspaceResourceCache(companyID);
  invalidateResourcePolicyDependentCaches(readAuthConfig().apiBase, companyID);
  return cloneResourceRACIAssignmentsAsLogicGate(payload.gvic_assignments ?? [], logicGateID);
}

export function addLogicGateRACIAssignments(
  companyID: string,
  logicGateID: string,
  assignments: Array<{ role: LogicGateRACIRole; user_id?: string; principal_type?: LogicGateRACIPrincipalType; principal_id?: string }>,
  applyToDescendants = false,
): Promise<LogicGateRACIAssignment[]> {
  return commandLogicGateRACIAssignments(companyID, logicGateID, "add", assignments, applyToDescendants);
}

export function removeLogicGateRACIAssignments(
  companyID: string,
  logicGateID: string,
  assignments: Array<{ role: LogicGateRACIRole; user_id?: string; principal_type?: LogicGateRACIPrincipalType; principal_id?: string }>,
  applyToDescendants = false,
): Promise<LogicGateRACIAssignment[]> {
  return commandLogicGateRACIAssignments(companyID, logicGateID, "remove", assignments, applyToDescendants);
}

export async function listNodes(companyID: string): Promise<NodeRecord[]> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`nodes:${cleanCompanyID}`, WORKSPACE_RESOURCE_CACHE_TTL_MS, async () => {
    const params = new URLSearchParams({ company_id: cleanCompanyID });
    const payload = await apiFetchJSON<{ nodes?: NodeRecord[] }>(`/v1/nodes?${params.toString()}`);
    return cloneNodes(payload.nodes ?? []);
  }, cloneNodes);
}

export async function updateNode(companyID: string, nodeID: string, update: Partial<Pick<NodeRecord, "status" | "due_date" | "priority">>): Promise<NodeRecord> {
  const node = await apiFetchJSON<NodeRecord>(`/v1/nodes/${encodeURIComponent(nodeID)}`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: companyID,
      ...update,
    }),
  });
  invalidateWorkspaceResourceCache(companyID);
  return { ...node };
}

export async function listMyLogicGateShortcuts(companyID: string): Promise<UserLogicGateShortcut[]> {
  const cleanCompanyID = companyID.trim();
  return cachedRead(`my-logic-gates:${cleanCompanyID}`, WORKSPACE_RESOURCE_CACHE_TTL_MS, async () => {
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

export async function fetchCommunicationsWorkspaceResources(companyID: string): Promise<CommunicationsWorkspaceResources> {
  const cleanCompanyID = companyID.trim();
  const [logicGates, shortcuts, nodes] = await Promise.all([
    listLogicGates(cleanCompanyID),
    listMyLogicGateShortcuts(cleanCompanyID),
    listNodes(cleanCompanyID),
  ]);
  return {
    logicGates,
    myLogicGateShortcuts: cloneLogicGateShortcuts(shortcuts),
    nodes,
  };
}

export type CommunicationsTriageConversionTarget =
  | { mode: "existing_logic_gate"; logicGateID: string; projectID?: string; position?: number }
  | { mode: "existing_node"; nodeID: string; logicGateID?: string }
  | { mode: "folder"; folderID?: string; parentEntityID?: string; position?: number }
  | { mode: "project"; projectID: string; position?: number };

export type CommunicationsTriageConversionResult = {
  board?: KanbanBoard;
  cards?: KanbanCard[];
  nodes: NodeRecord[];
  folder_items?: CompanyExplorerFolderItem[];
  explorer_v2_rows?: CompanyExplorerV2Row[];
  project_relationships?: ProjectRelationshipProjection[];
  deleted_message_ids: string[];
  unstarred_message_ids?: string[];
  attached_email_information_ids?: string[];
  email_thread_ids?: string[];
  email_message_ids?: string[];
  linked_text_block_id?: string;
  initial_chat_id?: string;

};

function communicationsTriageConversionTargetPayload(target: CommunicationsTriageConversionTarget): Record<string, unknown> {
  switch (target.mode) {
    case "existing_logic_gate":
      return { mode: "existing_logic_gate", logic_gate_id: target.logicGateID, project_id: target.projectID || undefined, position: target.position };
    case "existing_node":
      return { mode: "existing_node", node_id: target.nodeID, logic_gate_id: target.logicGateID || undefined };
    case "folder":
      return {
        mode: "folder",
        folder_id: target.folderID || undefined,
        parent_entity_id: target.parentEntityID || undefined,
        position: target.position,
      };
    case "project":
      return { mode: "project", project_id: target.projectID, position: target.position };
    default:
      return { mode: "invalid" };
  }
}

export async function convertTriageMessagesToExplorerTarget(input: {
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  target: CommunicationsTriageConversionTarget;
  messageIDs: string[];
  priority?: number;
  columnID?: string;
  status?: string;
  linkedTextBlock?: { type: string; information: string; informationID: string };
  initialChat?: { type: string; information: string; informationID: string };
}): Promise<CommunicationsTriageConversionResult> {
  const cleanSharedInboxID = input.sharedInboxID?.trim() ?? "";
  const cleanAccountEmail = cleanSharedInboxID ? "" : input.accountEmail?.trim().toLowerCase() ?? "";
  const cleanColumnID = input.columnID?.trim() ?? "";
  const cleanStatus = input.status?.trim() ?? "";
  const query = new URLSearchParams();
  if (cleanAccountEmail) query.set("account_email", cleanAccountEmail);
  const rawQuery = query.toString();
  const result = await apiFetchJSON<CommunicationsTriageConversionResult>(`/v1/communications/triage/convert${rawQuery ? `?${rawQuery}` : ""}`, {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      shared_inbox_id: cleanSharedInboxID || undefined,
      target: communicationsTriageConversionTargetPayload(input.target),
      message_ids: cleanIDs(input.messageIDs),
      priority: input.priority,
      column_id: cleanColumnID || undefined,
      status: cleanStatus || undefined,
      linked_text_block: input.linkedTextBlock ? {
        type: input.linkedTextBlock.type,
        information: input.linkedTextBlock.information,
        information_id: input.linkedTextBlock.informationID,
      } : undefined,
      initial_chat: input.initialChat ? {
        type: input.initialChat.type,
        information: input.initialChat.information,
        information_id: input.initialChat.informationID,
      } : undefined,
    }),
  });
  invalidateWorkspaceResourceCache(input.companyID);
  return result;
}

export async function convertTriageMessagesToLogicGate(input: {
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  logicGateID: string;
  nodeID?: string;
  messageIDs: string[];
  priority?: number;
  columnID?: string;
  status?: string;
}): Promise<CommunicationsTriageConversionResult> {
  const cleanNodeID = input.nodeID?.trim() ?? "";
  return convertTriageMessagesToExplorerTarget({
    companyID: input.companyID,
    sharedInboxID: input.sharedInboxID,
    accountEmail: input.sharedInboxID?.trim() ? undefined : input.accountEmail,
    target: cleanNodeID
      ? { mode: "existing_node", logicGateID: input.logicGateID, nodeID: cleanNodeID }
      : { mode: "existing_logic_gate", logicGateID: input.logicGateID },
    messageIDs: input.messageIDs,
    priority: input.priority,
    columnID: input.columnID,
    status: input.status,
  });
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
  invalidateWorkspaceResourceCache(input.companyID);
  return result;
}

export async function transferEmailNodeCardToNode(input: {
  companyID: string;
  sourceBoardID: string;
  sourceCardID: string;
  targetBoardID: string;
  targetCardID: string;
}): Promise<{
  email_placement: {
    company_id: string;
    user_id: string;
    message_id: string;
    node_id: string;
    board_id: string;
    card_id: string;
    logic_gate_id: string;
  };
  deleted_node_id: string;
  deleted_card_id: string;
  source_board_id: string;
  target_node_id: string;
  target_board_id: string;
  target_card_id: string;
}> {
  const result = await apiFetchJSON<{
    email_placement: {
      company_id: string;
      user_id: string;
      message_id: string;
      node_id: string;
      board_id: string;
      card_id: string;
      logic_gate_id: string;
    };
    deleted_node_id: string;
    deleted_card_id: string;
    source_board_id: string;
    target_node_id: string;
    target_board_id: string;
    target_card_id: string;
  }>("/v1/communications/email-nodes/transfer", {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      source_board_id: input.sourceBoardID,
      source_card_id: input.sourceCardID,
      target_board_id: input.targetBoardID,
      target_card_id: input.targetCardID,
    }),
  });
  invalidateWorkspaceResourceCache(input.companyID);
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
    recentStarredMessages.clear();
    communicationsReadCache.clear();
    communicationsReadInflight.clear();
	archiveJobCache.clear();
	archiveJobInflight.clear();
  }
}

export function invalidateCommunicationsMailboxCache(
  scope: { companyID: string; sharedInboxID?: string; accountEmail?: string },
  targets: { folders?: boolean; messagePages?: boolean } = { folders: true, messagePages: true },
): void {
  const matches = (key: string) => communicationsCachePathMatchesMailbox(key, scope);
  if (targets.folders) {
    for (const key of foldersCache.keys()) if (matches(key)) foldersCache.delete(key);
    for (const key of foldersInflight.keys()) if (matches(key)) foldersInflight.delete(key);
    for (const key of foldersCacheWriters.keys()) if (matches(key)) foldersCacheWriters.delete(key);
  }
  if (targets.messagePages) {
    for (const key of messagePageCache.keys()) if (matches(key)) messagePageCache.delete(key);
    for (const key of messagePageInflight.keys()) if (matches(key)) messagePageInflight.delete(key);
    for (const key of messagePageCacheWriters.keys()) if (matches(key)) messagePageCacheWriters.delete(key);
  }
}

export function settleCommunicationsMailboxMessageOverlays(
  scope: { companyID: string; sharedInboxID?: string; accountEmail?: string },
  messageID: string,
): void {
  const cleanMessageID = messageID.trim();
  if (!cleanMessageID) return;
  const cacheKey = scopedMessageCacheKey(cleanMessageID, scope);
  recentArchivedMessages.delete(cacheKey);
  recentPrimaryMessages.delete(cacheKey);
  recentStarredMessages.delete(cacheKey);
}

export function invalidateEmailMessageCache(messageID: string, companyID?: string, sharedInboxID?: string, accountEmail?: string): void {
  const cleanMessageID = messageID.trim();
  if (!cleanMessageID) return;
  const scoped = Boolean(companyID?.trim() || sharedInboxID?.trim() || accountEmail?.trim());
  const scopedKey = messageDetailCacheKey(cleanMessageID, companyID, sharedInboxID, accountEmail);
  for (const key of messageDetailCache.keys()) {
    if ((scoped && key === scopedKey) || (!scoped && messageCacheKeyMatchesID(key, cleanMessageID))) messageDetailCache.delete(key);
  }
  for (const key of messageDetailInflight.keys()) {
    if ((scoped && key === scopedKey) || (!scoped && messageCacheKeyMatchesID(key, cleanMessageID))) messageDetailInflight.delete(key);
  }
}

export function invalidateCommunicationsWorkspaceResourceCache(companyID: string): void {
  invalidateWorkspaceResourceCache(companyID);
}

export function markCommunicationsWorkspaceResourcesStale(companyID: string, scope?: CommunicationsWorkspaceResourceCacheScope): void {
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) return;
  if (scope) {
    if (scope.logicGates) invalidateCacheKey(`logic-gates:${cleanCompanyID}`);
    if (scope.nodes) invalidateCacheKey(`nodes:${cleanCompanyID}`);
    if (scope.companyUsers) invalidateCacheKey(`company-users:${cleanCompanyID}`);
    if (scope.userGroups) invalidateCacheKey(`company-user-groups:${cleanCompanyID}`);
    return;
  }
  clearWorkspaceResourceReadCache(cleanCompanyID);
}

export function patchLogicGateRACIAssignmentsInCommunicationsWorkspaceCache(
  companyID: string,
  logicGateID: string,
  assignments: LogicGateRACIAssignment[],
): void {
  const cleanCompanyID = companyID.trim();
  const cleanLogicGateID = logicGateID.trim();
  if (!cleanCompanyID || !cleanLogicGateID) return;
  const cacheKey = `logic-gates:${cleanCompanyID}`;
  communicationsReadInflight.delete(cacheKey);
  const cached = communicationsReadCache.get(cacheKey) as CacheEntry<LogicGateRecord[]> | undefined;
  if (!cached) return;
  let changed = false;
  const nextLogicGates = cloneLogicGates(cached.value).map((logicGate) => {
    if (logicGate.logic_gate_id !== cleanLogicGateID) return logicGate;
    changed = true;
    return {
      ...logicGate,
      gvic_assignments: cloneResourceRACIAssignmentsAsLogicGate(assignments, cleanLogicGateID),
    };
  });
  if (!changed) return;
  communicationsReadCache.set(cacheKey, {
    value: nextLogicGates,
    fetchedAt: Date.now(),
  });
}

export function emailMessageWithLogicGatePlacement(message: EmailMessage, logicGateID: string): EmailMessage {
  const cleanLogicGateID = logicGateID.trim();
  if (!cleanLogicGateID) return message;
  const currentIDs = cleanIDs(message.logic_gate_ids ?? []);
  const nextIDs = currentIDs.includes(cleanLogicGateID) ? currentIDs : [...currentIDs, cleanLogicGateID];
  const currentCount = Math.max(0, Math.floor(message.logic_gate_count ?? currentIDs.length));
  const nextCount = Math.max(currentCount, nextIDs.length);
  const currentMatches = (message.logic_gate_ids ?? []).length === nextIDs.length
    && (message.logic_gate_ids ?? []).every((id, index) => id === nextIDs[index]);
  if (currentMatches && message.logic_gate_count === nextCount) return message;
  return { ...message, logic_gate_ids: nextIDs, logic_gate_count: nextCount };
}

export function patchEmailMessagesLogicGatePlacement(messageIDs: string[], logicGateID: string, scope: LocalEmailReplyScope = {}): void {
  const ids = new Set(cleanIDs(messageIDs));
  const cleanLogicGateID = logicGateID.trim();
  if (ids.size === 0 || !cleanLogicGateID) return;
  const patch = (message: EmailMessage): EmailMessage => (
    ids.has(message.id) ? emailMessageWithLogicGatePlacement(message, cleanLogicGateID) : message
  );
  const scoped = Boolean(scope.companyID?.trim() || scope.sharedInboxID?.trim() || scope.accountEmail?.trim());
  for (const [key, entry] of messageDetailCache.entries()) {
    if (scoped && !messageDetailCacheKeyMatchesScope(key, scope)) continue;
    const next = patch(entry.value);
    if (next !== entry.value) messageDetailCache.set(key, { ...entry, value: next });
  }
  for (const cache of [recentArchivedMessages, recentPrimaryMessages, recentStarredMessages]) {
    for (const messageID of ids) {
      const entry = cache.get(scopedMessageCacheKey(messageID, scope));
      if (!entry) continue;
      const next = emailMessageWithLogicGatePlacement(entry.value, cleanLogicGateID);
      if (next !== entry.value) cache.set(scopedMessageCacheKey(messageID, scope), { ...entry, value: next });
    }
  }
  patchCachedPageMessages(patch, scope);
}

export function addLocalEmailReply(replyToMessageID: string, reply: EmailMessage, scope: LocalEmailReplyScope = {}): void {
  const cleanReplyToMessageID = replyToMessageID.trim();
  if (!cleanReplyToMessageID || !reply.id.trim()) return;
  persistLocalEmailReply(cleanReplyToMessageID, reply, scope);
  const scopedDetailKey = messageDetailCacheKey(cleanReplyToMessageID, scope.companyID, scope.sharedInboxID, scope.accountEmail);
  for (const [key, entry] of messageDetailCache.entries()) {
    if (scope.companyID?.trim() || scope.sharedInboxID?.trim() || scope.accountEmail?.trim()) {
      if (key !== scopedDetailKey) continue;
    } else if (!messageCacheKeyMatchesID(key, cleanReplyToMessageID)) {
      continue;
    }
    const message = addLocalReplyToEmailMessage(entry.value, reply);
    messageDetailCache.set(key, { ...entry, value: message, fetchedAt: Date.now() });
  }
  patchCachedPageMessages((message) => (
    message.id === cleanReplyToMessageID ? addLocalReplyToEmailMessage(message, reply) : message
  ), scope);
}

export function addLocalReplyToEmailMessage(message: EmailMessage, reply: EmailMessage): EmailMessage {
  const cleanMessageID = message.id.trim();
  const cleanReplyID = reply.id.trim();
  if (!cleanMessageID || !cleanReplyID || cleanMessageID === cleanReplyID) return cloneMessage(message);
  const next = cloneMessage(message);
  next.local_replies = mergeLocalReplies(next.local_replies ?? [], [reply]);
  return next;
}

export function applyEmailMessageToCachedPages(message: EmailMessage, options: MergeEmailMessageOptions = {}): void {
  const scope = { companyID: options.companyID, sharedInboxID: options.sharedInboxID, accountEmail: options.accountEmail };
  primeMessageCaches(message, scope);
  if (options.prependIfMissing && messageMatchesMailbox(message, "primary")) rememberRecentlyPrimaryMessage(message, scope);
  for (const [key, entry] of messagePageCache.entries()) {
    const params = listMessageParamsFromCacheKey(key);
    if (!emailMessageCacheParamsMatchScope(params, options)) continue;
    const maxMessages = params.limit ?? options.maxMessages;
    const messages = mergeEmailMessageIntoMessageList(entry.value.messages, message, params, {
      ...options,
      maxMessages,
    });
    messagePageCache.set(key, { value: { ...entry.value, messages }, fetchedAt: Date.now() });
  }
}

function removeEmailMessageFromCachedPages(messageID: string, scope: LocalEmailReplyScope = {}): void {
  const cleanMessageID = messageID.trim();
  if (!cleanMessageID) return;
  for (const [key, entry] of messagePageCache.entries()) {
    const params = listMessageParamsFromCacheKey(key);
    if (!emailMessageCacheParamsMatchScope(params, scope)) continue;
    const messages = entry.value.messages.filter((message) => message.id !== cleanMessageID);
    if (messages.length !== entry.value.messages.length) {
      messagePageCache.set(key, { value: { ...entry.value, messages }, fetchedAt: Date.now() });
    }
  }
}

function patchCachedPageMessages(patch: (message: EmailMessage) => EmailMessage, scope: LocalEmailReplyScope = {}): void {
  for (const [key, entry] of messagePageCache.entries()) {
    const params = listMessageParamsFromCacheKey(key);
    if (!emailMessageCacheParamsMatchScope(params, scope)) continue;
    let changed = false;
    const messages = entry.value.messages.map((message) => {
      const next = patch(message);
      if (next !== message) changed = true;
      return next;
    });
    if (changed) messagePageCache.set(key, { value: { ...entry.value, messages }, fetchedAt: Date.now() });
  }
}

function emailMessageCacheParamsMatchScope(
  params: ListMessagesParams,
  scope: { companyID?: string; sharedInboxID?: string; accountEmail?: string },
): boolean {
  const companyID = scope.companyID?.trim() ?? "";
  const sharedInboxID = scope.sharedInboxID?.trim() ?? "";
  const accountEmail = sharedInboxID ? "" : scope.accountEmail?.trim().toLowerCase() ?? "";
  if (!companyID && !sharedInboxID && !accountEmail) return true;
  return (params.companyID?.trim() ?? "") === companyID
    && (params.sharedInboxID?.trim() ?? "") === sharedInboxID
    && (!!sharedInboxID || (params.accountEmail?.trim().toLowerCase() ?? "") === accountEmail);
}

function markCachedMessageArchived(messageID: string, scope: LocalEmailReplyScope = {}): void {
  const cleanMessageID = messageID.trim();
  if (!cleanMessageID) return;
  const cacheKey = scopedMessageCacheKey(cleanMessageID, scope);
  const cached = findCachedEmailMessage(cleanMessageID, scope);
  if (!cached) {
    removeEmailMessageFromCachedPages(cleanMessageID, scope);
    invalidateEmailMessageCache(cleanMessageID, scope.companyID, scope.sharedInboxID, scope.accountEmail);
    recentPrimaryMessages.delete(cacheKey);
    recentArchivedMessages.delete(cacheKey);
    recentStarredMessages.delete(cacheKey);
    return;
  }
  const archived = archivedEmailMessageForLocalLists(cached);
  rememberRecentlyArchivedMessage(archived, scope);
  if (archived.starred) rememberRecentlyStarredMessage(archived, scope);
  applyEmailMessageToCachedPages(archived, {
    prependIfMissing: true,
    companyID: scope.companyID,
    sharedInboxID: scope.sharedInboxID,
    accountEmail: scope.accountEmail,
  });
}

function findCachedEmailMessage(messageID: string, scope: LocalEmailReplyScope = {}): EmailMessage | null {
  const cleanMessageID = messageID.trim();
  if (!cleanMessageID) return null;
  const scoped = Boolean(scope.companyID?.trim() || scope.sharedInboxID?.trim() || scope.accountEmail?.trim());
  if (scoped) {
    const entry = messageDetailCache.get(messageDetailCacheKey(cleanMessageID, scope.companyID, scope.sharedInboxID, scope.accountEmail));
    if (entry) return cloneMessage(entry.value);
  } else {
    for (const entry of messageDetailCache.values()) {
      if (entry.value.id === cleanMessageID) return cloneMessage(entry.value);
    }
  }
  for (const [key, entry] of messagePageCache.entries()) {
    if (!emailMessageCacheParamsMatchScope(listMessageParamsFromCacheKey(key), scope)) continue;
    const match = entry.value.messages.find((message) => message.id === cleanMessageID);
    if (match) return cloneMessage(match);
  }
  return null;
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
  const replies = mergeLocalReplies(previous.local_replies ?? [], next.local_replies ?? []);
  if (replies.length > 0) merged.local_replies = replies;
  else delete merged.local_replies;
  return cloneMessage(merged);
}

function applyLocalMessageOverlaysToPage(page: MessagePage, params: ListMessagesParams): MessagePage {
  pruneRecentMessages();
  const mailbox = params.mailbox ?? "primary";
  const withRecentStarMutations = (messages: EmailMessage[]) => messages.map((message) => (
    recentStarredMessages.get(scopedMessageCacheKey(message.id, params))?.value ?? cloneMessage(message)
  ));

  if (params.pageToken) {
    return {
      ...page,
      messages: withRecentStarMutations(page.messages),
    };
  }

  const archivedIDs = new Set(recentMessagesForScope(recentArchivedMessages, params).map((entry) => entry.value.id));
  if (mailbox === "primary") {
    let messages = page.messages.filter((message) => !archivedIDs.has(message.id)).map(cloneMessage);
    messages = prependRecentMessages(messages, recentPrimaryMessages, params);
    messages = withRecentStarMutations(messages);
    return {
      ...page,
      messages,
    };
  }

  if (mailbox === "starred") {
    let messages = withRecentStarMutations(page.messages);
    messages = messages.filter((message) => emailMessageMatchesListFilters(message, params));
    messages = prependRecentMessages(messages, recentStarredMessages, params);
    return {
      ...page,
      messages,
    };
  }

  if (mailbox === "all") {
    let messages = page.messages.map((message) => (
      recentArchivedMessages.get(scopedMessageCacheKey(message.id, params))?.value
      ?? cloneMessage(message)
    ));
    messages = prependRecentMessages(messages, recentArchivedMessages, params);
    messages = withRecentStarMutations(messages);
    messages = prependRecentMessages(messages, recentStarredMessages, params);
    return {
      ...page,
      messages,
    };
  }

  if (mailbox !== "archive") return {
    ...page,
    messages: withRecentStarMutations(page.messages),
  };
  let messages = page.messages.map(cloneMessage);
  messages = prependRecentMessages(messages, recentArchivedMessages, params);
  messages = withRecentStarMutations(messages);
  return {
    ...page,
    messages,
  };
}

function prependRecentMessages(messages: EmailMessage[], recent: Map<string, ScopedMessageCacheEntry>, params: ListMessagesParams): EmailMessage[] {
  if (recent.size === 0) return messages;
  const seen = new Set(messages.map((message) => message.id));
  const additions = recentMessagesForScope(recent, params)
    .sort((a, b) => b.fetchedAt - a.fetchedAt)
    .map((entry) => entry.value)
    .filter((message) => !seen.has(message.id) && emailMessageMatchesListFilters(message, params));
  if (additions.length === 0) return messages;
  return sortEmailMessagesByDateDescending([...additions, ...messages]).slice(0, params.limit && params.limit > 0 ? params.limit : messages.length + additions.length);
}

function emailMessageSortTimestamp(message: EmailMessage): number {
  return typeof message.date === "number" && Number.isFinite(message.date) ? message.date : 0;
}

function rememberRecentlyPrimaryMessage(message: EmailMessage, scope: LocalEmailReplyScope = {}): void {
  const cleanMessageID = message.id.trim();
  if (!cleanMessageID || !messageMatchesMailbox(message, "primary")) return;
  const cacheKey = scopedMessageCacheKey(cleanMessageID, scope);
  recentArchivedMessages.delete(cacheKey);
  recentPrimaryMessages.set(cacheKey, scopedMessageCacheEntry(message, scope));
}

function rememberRecentlyArchivedMessage(message: EmailMessage, scope: LocalEmailReplyScope = {}): void {
  const cleanMessageID = message.id.trim();
  if (!cleanMessageID) return;
  const cacheKey = scopedMessageCacheKey(cleanMessageID, scope);
  recentPrimaryMessages.delete(cacheKey);
  recentArchivedMessages.set(cacheKey, scopedMessageCacheEntry(archivedEmailMessageForLocalLists(message), scope));
}

function rememberRecentlyStarredMessage(message: EmailMessage, scope: LocalEmailReplyScope = {}): void {
  const cleanMessageID = message.id.trim();
  if (!cleanMessageID) return;
  recentStarredMessages.set(scopedMessageCacheKey(cleanMessageID, scope), scopedMessageCacheEntry(message, scope));
}

function pruneRecentMessages(): void {
  const now = Date.now();
  for (const [messageID, entry] of recentArchivedMessages.entries()) {
    if (now - entry.fetchedAt > RECENT_ARCHIVED_MESSAGE_TTL_MS) recentArchivedMessages.delete(messageID);
  }
  for (const [messageID, entry] of recentPrimaryMessages.entries()) {
    if (now - entry.fetchedAt > RECENT_PRIMARY_MESSAGE_TTL_MS) recentPrimaryMessages.delete(messageID);
  }
  for (const [messageID, entry] of recentStarredMessages.entries()) {
    if (now - entry.fetchedAt > RECENT_STARRED_MESSAGE_TTL_MS) recentStarredMessages.delete(messageID);
  }
}

function archivedEmailMessageForLocalLists(message: EmailMessage): EmailMessage {
  const archived = cloneMessage(message);
  archived.folders = stripInboxFolders(archived.folders);
  archived.folder_ids = stripInboxFolders(archived.folder_ids);
  return archived;
}

function sentEmailMessageForLocalLists(message: EmailMessage): EmailMessage {
  const sent = cloneMessage(message);
  sent.unread = false;
  if (!Number.isFinite(sent.date ?? 0) || (sent.date ?? 0) <= 0) sent.date = Math.floor(Date.now() / 1000);
  if (messageFolderTokens(sent).length === 0) sent.folders = ["sent"];
  return sent;
}

function localEmailReplyStorageScope(scope: LocalEmailReplyScope): string {
  const companyID = scope.companyID?.trim() ?? "";
  const userID = scope.userID?.trim() ?? "";
  if (!companyID || !userID) return "";
  const sharedInboxID = scope.sharedInboxID?.trim() ?? "";
  const accountEmail = scope.accountEmail?.trim().toLowerCase() ?? "";
  const mailbox = sharedInboxID ? `shared:${sharedInboxID}` : `personal:${accountEmail || "account"}`;
  return [companyID, userID, mailbox].map(encodeURIComponent).join(":");
}

function localEmailRepliesStorageKey(messageID: string, scope: LocalEmailReplyScope): string {
  const storageScope = localEmailReplyStorageScope(scope);
  return storageScope ? `${LOCAL_EMAIL_REPLIES_STORAGE_PREFIX}:${storageScope}:${encodeURIComponent(messageID.trim())}` : "";
}

function localEmailThreadRepliesStorageKey(threadID: string, scope: LocalEmailReplyScope): string {
  const storageScope = localEmailReplyStorageScope(scope);
  return storageScope ? `${LOCAL_EMAIL_THREAD_REPLIES_STORAGE_PREFIX}:${storageScope}:${encodeURIComponent(threadID.trim())}` : "";
}

function readStoredLocalReplies(key: string): EmailMessage[] {
  if (typeof localStorage === "undefined" || !key.trim()) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return mergeLocalReplies([], parsed.filter((item): item is EmailMessage => Boolean(item && typeof item === "object")));
  } catch {
    return [];
  }
}

function storeStoredLocalReplies(key: string, replies: EmailMessage[]) {
  if (typeof localStorage === "undefined" || !key.trim()) return;
  localStorage.setItem(key, JSON.stringify(mergeLocalReplies([], replies).slice(-80)));
}

function readStoredLocalEmailReplies(messageID: string, scope: LocalEmailReplyScope): EmailMessage[] {
  const cleanMessageID = messageID.trim();
  if (!cleanMessageID) return [];
  return readStoredLocalReplies(localEmailRepliesStorageKey(cleanMessageID, scope));
}

function readStoredLocalThreadReplies(threadID: string | undefined, scope: LocalEmailReplyScope): EmailMessage[] {
  const cleanThreadID = threadID?.trim() ?? "";
  if (!cleanThreadID) return [];
  return readStoredLocalReplies(localEmailThreadRepliesStorageKey(cleanThreadID, scope));
}

function persistLocalEmailReply(replyToMessageID: string, reply: EmailMessage, scope: LocalEmailReplyScope) {
  const cleanReplyToMessageID = replyToMessageID.trim();
  const cleanReplyID = reply.id.trim();
  if (!cleanReplyToMessageID || !cleanReplyID) return;
  const messageKey = localEmailRepliesStorageKey(cleanReplyToMessageID, scope);
  if (!messageKey) return;
  storeStoredLocalReplies(messageKey, mergeLocalReplies(readStoredLocalReplies(messageKey), [reply]));
  const cleanThreadID = reply.thread_id?.trim() ?? "";
  if (cleanThreadID) {
    const threadKey = localEmailThreadRepliesStorageKey(cleanThreadID, scope);
    storeStoredLocalReplies(threadKey, mergeLocalReplies(readStoredLocalReplies(threadKey), [reply]));
  }
}

function hydrateEmailMessageLocalReplies(message: EmailMessage, scope: LocalEmailReplyScope = {}): EmailMessage {
  const replies = mergeLocalReplies(message.local_replies ?? [], [
    ...readStoredLocalEmailReplies(message.id, scope),
    ...readStoredLocalThreadReplies(message.thread_id, scope),
  ]);
  return cloneMessage({ ...message, local_replies: replies.length > 0 ? replies : undefined });
}

function replyForLocalThread(reply: EmailMessage): EmailMessage {
  const local = cloneMessage(reply);
  delete local.local_replies;
  return local;
}

function mergeLocalReplies(existing: EmailMessage[], incoming: EmailMessage[]): EmailMessage[] {
  const replies: EmailMessage[] = [];
  for (const reply of [...existing, ...incoming]) {
    const candidate = replyForLocalThread(reply);
    const cleanID = candidate.id.trim();
    if (!cleanID) continue;
    const duplicateIndex = replies.findIndex((item) => emailRepliesRepresentSameMessage(item, candidate));
    if (duplicateIndex >= 0) replies[duplicateIndex] = mergeLocalReplyMessage(replies[duplicateIndex], candidate);
    else replies.push(candidate);
  }
  return replies.sort((left, right) => emailMessageSortTimestamp(left) - emailMessageSortTimestamp(right));
}

function mergeLocalReplyMessage(previous: EmailMessage, next: EmailMessage): EmailMessage {
  const merged = replyForLocalThread({ ...previous, ...next });
  if (!next.body && previous.body) merged.body = previous.body;
  if (!next.snippet && previous.snippet) merged.snippet = previous.snippet;
  if (!next.from?.length && previous.from?.length) merged.from = cloneEmailAddresses(previous.from);
  if (!next.to?.length && previous.to?.length) merged.to = cloneEmailAddresses(previous.to);
  if (!next.cc?.length && previous.cc?.length) merged.cc = cloneEmailAddresses(previous.cc);
  if (!next.bcc?.length && previous.bcc?.length) merged.bcc = cloneEmailAddresses(previous.bcc);
  return merged;
}

function emailRepliesRepresentSameMessage(left: EmailMessage, right: EmailMessage): boolean {
  const leftID = left.id.trim();
  const rightID = right.id.trim();
  if (leftID && rightID && leftID === rightID) return true;
  const leftSignature = localReplySignature(left);
  return !!leftSignature && leftSignature === localReplySignature(right);
}

function localReplySignature(message: EmailMessage): string {
  const threadID = message.thread_id?.trim() ?? "";
  const body = (message.body || message.snippet || "").trim();
  if (!threadID || !body) return "";
  return [
    threadID,
    normalizeReplySubject(message.subject),
    body,
    formatAddressesForSearch(message.from).trim().toLowerCase(),
    formatAddressesForSearch(message.to).trim().toLowerCase(),
  ].join("\x1f");
}

function normalizeReplySubject(subject: string): string {
  return subject.trim().toLowerCase().replace(/^(re:\s*)+/, "");
}

function stripInboxFolders(folders: string[] | undefined): string[] | undefined {
  if (!folders) return folders;
  return folders.filter((folder) => normalizeFolderToken(folder) !== "inbox");
}

function shouldRemoveExistingMessageFromList(message: EmailMessage, params: ListMessagesParams): boolean {
  if (params.unread === true && !message.unread) return true;
  if (params.folderID && !messageHasFolder(message, params.folderID)) return true;
  if (params.threadID?.trim() && message.thread_id !== params.threadID.trim()) return true;
  const query = params.q?.trim().toLowerCase() ?? "";
  if (query && !messageMatchesSearch(message, query)) return true;

  const mailbox = params.mailbox ?? "primary";
  if (mailbox === "primary") {
    return messageIsArchived(message) || messageIsExcludedFromPrimary(message);
  }
  if (mailbox === "archive") {
    return messageHasAnyFolder(message, ["inbox", "\\inbox", "sent", "\\sent", "trash", "\\trash", "spam", "\\spam", "junk", "\\junk", "draft", "drafts", "\\draft", "\\drafts"]);
  }
  return !messageMatchesMailbox(message, mailbox);
}

export function emailMessageMatchesListFilters(message: EmailMessage, params: ListMessagesParams): boolean {
  if (params.unread === true && !message.unread) return false;
  if (params.folderID && !messageHasFolder(message, params.folderID)) return false;
  if (params.threadID?.trim() && message.thread_id !== params.threadID.trim()) return false;
  if (!messageMatchesMailbox(message, params.mailbox ?? "primary")) return false;
  const query = params.q?.trim().toLowerCase() ?? "";
  if (query && !messageMatchesSearch(message, query)) return false;
  return true;
}

export function createMessageQuery(params: ListMessagesParams): string {
  const query = new URLSearchParams();
  if (params.limit && params.limit > 0) query.set("limit", String(params.limit));
  if (params.pageToken) query.set("page_token", params.pageToken);
  if (params.order) query.set("order", params.order);
  if (params.mailbox) query.set("mailbox", params.mailbox);
  if (params.folderID) query.set("folder_id", params.folderID);
  if (params.threadID?.trim()) query.set("thread_id", params.threadID.trim());
  if (params.companyID?.trim()) query.set("company_id", params.companyID.trim());
  if (params.sharedInboxID?.trim()) query.set("shared_inbox_id", params.sharedInboxID.trim());
  if (!params.sharedInboxID?.trim() && params.accountEmail?.trim()) query.set("account_email", params.accountEmail.trim().toLowerCase());
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
  if (!params.sharedInboxID?.trim() && params.accountEmail?.trim()) query.set("account_email", params.accountEmail.trim().toLowerCase());
  if (params.refresh === true) query.set("refresh", "true");
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
      if (communicationsReadInflight.get(key) === request) {
        communicationsReadCache.set(key, { value: cachedValue, fetchedAt: Date.now() });
      }
      return cachedValue;
    })
    .finally(() => {
      if (communicationsReadInflight.get(key) === request) communicationsReadInflight.delete(key);
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

function invalidateCommunicationsReadPrefix(prefix: string): void {
  for (const key of communicationsReadCache.keys()) {
    if (key.startsWith(prefix)) communicationsReadCache.delete(key);
  }
  for (const key of communicationsReadInflight.keys()) {
    if (key.startsWith(prefix)) communicationsReadInflight.delete(key);
  }
}

function clearEmailFolderCache(): void {
  foldersCache.clear();
  foldersInflight.clear();
  foldersCacheWriters.clear();
}

function clearMessagePageCache(): void {
  messagePageCache.clear();
  messagePageInflight.clear();
  messagePageCacheWriters.clear();
}

function invalidateWorkspaceResourceCache(companyID: string): void {
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) return;
  clearWorkspaceResourceReadCache(cleanCompanyID);
}

function clearWorkspaceResourceReadCache(cleanCompanyID: string): void {
  for (const key of [
    `logic-gates:${cleanCompanyID}`,
    `nodes:${cleanCompanyID}`,
    `company-users:${cleanCompanyID}`,
    `company-user-groups:${cleanCompanyID}`,
  ]) {
    invalidateCacheKey(key);
  }
}


function readCache<T>(entry: CacheEntry<T> | null, maxAgeMs: number, clone: (value: T) => T): T | null {
  if (!entry || Date.now() - entry.fetchedAt > maxAgeMs) return null;
  return clone(entry.value);
}

function isNylasRateLimitedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.trim().toLowerCase();
  return message.includes("nylas_rate_limited") || message.includes("429");
}

function primeMessageCaches(message: EmailMessage, scope: LocalEmailReplyScope = {}): void {
  const cleanMessageID = message.id.trim();
  if (!cleanMessageID) return;
  const now = Date.now();
  const targetKey = messageDetailCacheKey(cleanMessageID, scope.companyID, scope.sharedInboxID, scope.accountEmail);
  const scoped = Boolean(scope.companyID?.trim() || scope.sharedInboxID?.trim() || scope.accountEmail?.trim());
  const hydratedMessage = hydrateEmailMessageLocalReplies(message, scope);
  const hydratedIsDetailed = isEmailMessageDetailed(hydratedMessage);
  for (const [key, entry] of messageDetailCache.entries()) {
    if (key === targetKey || scoped || !messageCacheKeyMatchesID(key, cleanMessageID)) continue;
    const baseMessage = hydratedIsDetailed ? hydratedMessage : mergeEmailMessageForDetailCache(entry.value, hydratedMessage);
    const replies = mergeLocalReplies(entry.value.local_replies ?? [], baseMessage.local_replies ?? []);
    const value = cloneMessage({ ...baseMessage, local_replies: replies.length > 0 ? replies : undefined });
    messageDetailCache.set(key, { value, fetchedAt: now, detailFetched: entry.detailFetched || hydratedIsDetailed });
  }
  const existing = messageDetailCache.get(targetKey)?.value;
  if (!hydratedIsDetailed && !existing) return;
  const baseMessage = existing && !hydratedIsDetailed ? mergeEmailMessageForDetailCache(existing, hydratedMessage) : hydratedMessage;
  const replies = mergeLocalReplies(existing?.local_replies ?? [], baseMessage.local_replies ?? []);
  messageDetailCache.set(targetKey, {
    value: cloneMessage({ ...baseMessage, local_replies: replies.length > 0 ? replies : undefined }),
    fetchedAt: now,
    detailFetched: true,
  });
}

function mergeEmailMessageForDetailCache(previous: EmailMessage, next: EmailMessage): EmailMessage {
  const merged: EmailMessage = { ...previous, ...next };
  if (!isEmailMessageDetailed(next) && previous.body) merged.body = previous.body;
  if (!next.snippet && previous.snippet) merged.snippet = previous.snippet;
  if (!next.from?.length && previous.from?.length) merged.from = cloneEmailAddresses(previous.from);
  if (!next.to?.length && previous.to?.length) merged.to = cloneEmailAddresses(previous.to);
  if (!next.cc?.length && previous.cc?.length) merged.cc = cloneEmailAddresses(previous.cc);
  if (!next.bcc?.length && previous.bcc?.length) merged.bcc = cloneEmailAddresses(previous.bcc);
  return merged;
}

function messageDetailCacheKey(messageID: string, companyID?: string, sharedInboxID?: string, accountEmail?: string): string {
  const cleanCompanyID = companyID?.trim() ?? "";
  const cleanSharedInboxID = sharedInboxID?.trim() ?? "";
  const cleanAccountEmail = cleanSharedInboxID ? "" : accountEmail?.trim().toLowerCase() ?? "";
  const cleanMessageID = messageID.trim();
  return cleanCompanyID || cleanSharedInboxID || cleanAccountEmail
    ? `${cleanCompanyID}\x1f${cleanSharedInboxID}\x1f${cleanAccountEmail}\x1f${cleanMessageID}`
    : cleanMessageID;
}

function scopedMessageCacheKey(
  messageID: string,
  scope: { companyID?: string; sharedInboxID?: string; accountEmail?: string },
): string {
  return messageDetailCacheKey(messageID, scope.companyID, scope.sharedInboxID, scope.accountEmail);
}

function scopedMessageCacheEntry(
  message: EmailMessage,
  scope: { companyID?: string; sharedInboxID?: string; accountEmail?: string },
): ScopedMessageCacheEntry {
  return {
    value: cloneMessage(message),
    fetchedAt: Date.now(),
    companyID: scope.companyID?.trim() ?? "",
    sharedInboxID: scope.sharedInboxID?.trim() ?? "",
    accountEmail: scope.sharedInboxID?.trim() ? "" : scope.accountEmail?.trim().toLowerCase() ?? "",
  };
}

function recentMessagesForScope(
  recent: Map<string, ScopedMessageCacheEntry>,
  scope: { companyID?: string; sharedInboxID?: string; accountEmail?: string },
): ScopedMessageCacheEntry[] {
  const companyID = scope.companyID?.trim() ?? "";
  const sharedInboxID = scope.sharedInboxID?.trim() ?? "";
  const accountEmail = sharedInboxID ? "" : scope.accountEmail?.trim().toLowerCase() ?? "";
  return Array.from(recent.values()).filter((entry) => (
    entry.companyID === companyID && entry.sharedInboxID === sharedInboxID && entry.accountEmail === accountEmail
  ));
}

function messageDetailCacheKeyMatchesScope(
  key: string,
  scope: { companyID?: string; sharedInboxID?: string; accountEmail?: string },
): boolean {
  const companyID = scope.companyID?.trim() ?? "";
  const sharedInboxID = scope.sharedInboxID?.trim() ?? "";
  const accountEmail = sharedInboxID ? "" : scope.accountEmail?.trim().toLowerCase() ?? "";
  if (!companyID && !sharedInboxID && !accountEmail) return true;
  const parts = key.split("\x1f");
  return parts.length >= 4 && parts[0] === companyID && parts[1] === sharedInboxID && parts[2] === accountEmail;
}

function communicationsCachePathMatchesMailbox(
  path: string,
  scope: { companyID: string; sharedInboxID?: string; accountEmail?: string },
): boolean {
  const query = new URL(path, "https://mangorts.invalid").searchParams;
  const companyID = scope.companyID.trim();
  const sharedInboxID = scope.sharedInboxID?.trim() ?? "";
  const accountEmail = sharedInboxID ? "" : scope.accountEmail?.trim().toLowerCase() ?? "";
  return query.get("company_id") === companyID
    && (query.get("shared_inbox_id") ?? "") === sharedInboxID
    && (!!sharedInboxID || (query.get("account_email") ?? "").toLowerCase() === accountEmail);
}

function messageCacheKeyMatchesID(key: string, messageID: string): boolean {
  return key === messageID || key.endsWith(`\x1f${messageID}`);
}

function createMailboxMessageMutationQuery(sharedInboxID?: string, companyID?: string, accountEmail?: string): string {
  const query = new URLSearchParams();
  const cleanSharedInboxID = sharedInboxID?.trim() ?? "";
  const cleanCompanyID = companyID?.trim() ?? "";
  if (cleanCompanyID) query.set("company_id", cleanCompanyID);
  if (cleanSharedInboxID) query.set("shared_inbox_id", cleanSharedInboxID);
  else if (accountEmail?.trim()) query.set("account_email", accountEmail.trim().toLowerCase());
  const raw = query.toString();
  return raw ? `?${raw}` : "";
}

function createEmailDraftScopeQuery(companyID: string, scope: CommunicationsEmailDraftScope): URLSearchParams {
  const query = new URLSearchParams({ company_id: companyID.trim() });
  const sharedInboxID = scope.sharedInboxID?.trim() ?? "";
  const accountEmail = scope.accountEmail?.trim().toLowerCase() ?? "";
  if (sharedInboxID) query.set("shared_inbox_id", sharedInboxID);
  else if (accountEmail) query.set("account_email", accountEmail);
  // A company-only scope is the explicit collaboration branch: the backend
  // returns/deletes only shared drafts for which the actor is a permanent
  // participant. Ordinary private drafts still require an exact mailbox scope.
  return query;
}

function normalizeDraftTimestampForAPI(value: string | undefined): string {
  const cleanValue = value?.trim() ?? "";
  if (!cleanValue) return "";
  const parsed = Date.parse(cleanValue);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : cleanValue;
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
    attachments: message.attachments ? message.attachments.map((attachment) => ({ ...attachment })) : undefined,
    folders: message.folders ? [...message.folders] : undefined,
    folder_ids: message.folder_ids ? [...message.folder_ids] : undefined,
    logic_gate_ids: message.logic_gate_ids ? [...message.logic_gate_ids] : undefined,
    logic_gate_count: message.logic_gate_count,
    read_status: message.read_status ? { ...message.read_status } : undefined,
    local_replies: message.local_replies ? message.local_replies.map((reply) => cloneMessage(reply)) : undefined,
  };
}

function cloneCommunicationsEmailDraft(draft: CommunicationsEmailDraft): CommunicationsEmailDraft {
  return {
    ...draft,
    reply_to_message: draft.reply_to_message ? cloneMessage(draft.reply_to_message) : draft.reply_to_message ?? undefined,
    attachments: draft.attachments ? draft.attachments.map((item) => ({
      ...item,
      attachment: item.attachment ? { ...item.attachment } : undefined,
    })) : undefined,
  };
}

function cloneCommunicationsStoredEmailThread(thread: CommunicationsStoredEmailThread): CommunicationsStoredEmailThread {
  return {
    ...thread,
    messages: (thread.messages ?? []).map(cloneMessage),
    history_complete: thread.history_complete === true,
  };
}

function cloneCommunicationsEmailCollaboration(collaboration: CommunicationsEmailCollaboration): CommunicationsEmailCollaboration {
  return {
    ...collaboration,
    message_snapshot: collaboration.message_snapshot ? cloneMessage(collaboration.message_snapshot) : collaboration.message_snapshot ?? undefined,
    message: collaboration.message ? cloneMessage(collaboration.message) : collaboration.message ?? undefined,
    latest_message: collaboration.latest_message ? cloneMessage(collaboration.latest_message) : collaboration.latest_message ?? undefined,
    participants: collaboration.participants?.map((participant) => ({ ...participant })),
  };
}

function cloneCommunicationsEmailSignature(signature: CommunicationsEmailSignature): CommunicationsEmailSignature {
  return { ...signature };
}

function cloneEmailAddresses(addresses: EmailAddress[] | undefined): EmailAddress[] | undefined {
  return addresses ? addresses.map((address) => ({ ...address })) : undefined;
}

function cloneSharedInboxes(inboxes: CommunicationsSharedInbox[]): CommunicationsSharedInbox[] {
  return inboxes.map(cloneSharedInbox);
}

function cloneSharedInbox(inbox: CommunicationsSharedInbox): CommunicationsSharedInbox {
  const assignments = cloneResourceRACIAssignmentsAsSharedInbox(inbox.gvic_assignments ?? [], inbox.folder_id);
  return {
    ...inbox,
    gvic_assignments: assignments,
    access_grants: cloneResourceAccessGrants(inbox.access_grants ?? []),
  };
}

function cloneResourceAccessGrants(grants: ResourceAccessGrant[]): ResourceAccessGrant[] {
  return grants.map((grant) => ({ ...grant }));
}

function toResourceRACIAssignmentInput(assignment: {
  role: LogicGateRACIRole;
  user_id?: string;
  principal_type?: LogicGateRACIPrincipalType;
  principal_id?: string;
}): { role: LogicGateRACIRole; principal_type: LogicGateRACIPrincipalType; principal_id: string } {
  const principalType = assignment.principal_type?.trim() === "group" ? "group" : "user";
  const principalID = (assignment.principal_id ?? assignment.user_id ?? "").trim();
  return {
    role: assignment.role,
    principal_type: principalType,
    principal_id: principalID,
  };
}

function cloneResourceRACIAssignmentsAsSharedInbox(
  assignments: CommunicationsSharedInboxRACIAssignment[],
  fallbackFolderID: string,
): CommunicationsSharedInboxRACIAssignment[] {
  return assignments.map((assignment) => {
    const principalType = assignment.principal_type ?? "user";
    const principalID = assignment.principal_id ?? assignment.user_id ?? "";
    const userID = assignment.user_id || (principalType === "user" ? principalID : "");
    return {
      ...assignment,
      folder_id: assignment.folder_id || assignment.resource_id || fallbackFolderID,
      principal_type: principalType,
      principal_id: principalID,
      user_id: userID,
    };
  });
}

function dispatchCommunicationsSharedInboxesUpdated(companyID: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED, { detail: { companyID: companyID.trim() } }));
}

function cloneLogicGates(logicGates: LogicGateRecord[]): LogicGateRecord[] {
  return logicGates.map((logicGate) => {
    const assignments = cloneLogicGateRACIAssignments(logicGate.gvic_assignments ?? []);
    return {
      ...logicGate,
      gvic_assignments: assignments,
    };
  });
}

function cloneLogicGateRACIAssignments(assignments: LogicGateRACIAssignment[]): LogicGateRACIAssignment[] {
  return assignments.map((assignment) => ({ ...assignment }));
}

function cloneResourceRACIAssignmentsAsLogicGate(
  assignments: LogicGateRACIAssignment[],
  fallbackLogicGateID: string,
): LogicGateRACIAssignment[] {
  return assignments.map((assignment) => {
    const principalType = assignment.principal_type ?? "user";
    const principalID = assignment.principal_id ?? assignment.user_id ?? "";
    const userID = assignment.user_id || (principalType === "user" ? principalID : "");
    return {
      ...assignment,
      logic_gate_id: assignment.logic_gate_id || assignment.resource_id || fallbackLogicGateID,
      principal_type: principalType,
      principal_id: principalID,
      user_id: userID,
    };
  });
}

function cloneCompanyUsers(users: CompanyUser[]): CompanyUser[] {
  return users.map((user) => ({ ...user }));
}

function cloneCompanyUserGroupsResponse(response: CompanyUserGroupsResponse): CompanyUserGroupsResponse {
  return {
    groups: response.groups.map((group) => ({ ...group })),
    members: response.members.map((member) => ({ ...member })),
  };
}

function cloneLogicGateShortcuts(shortcuts: UserLogicGateShortcut[]): UserLogicGateShortcut[] {
  return shortcuts.map((shortcut) => ({ ...shortcut }));
}

function cloneNodes(nodes: NodeRecord[]): NodeRecord[] {
  return nodes.map((node) => ({
    ...node,
    logic_gate_ids: node.logic_gate_ids ? [...node.logic_gate_ids] : undefined,
    accounts: node.accounts ? node.accounts.map((account) => ({ ...account })) : undefined,
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
    order: query.get("order") === "oldest" ? "oldest" : undefined,
    mailbox: normalizeMailbox(query.get("mailbox") ?? undefined),
    folderID: query.get("folder_id") ?? undefined,
    threadID: query.get("thread_id") ?? undefined,
    companyID: query.get("company_id") ?? undefined,
    sharedInboxID: query.get("shared_inbox_id") ?? undefined,
    accountEmail: query.get("account_email") ?? undefined,
    q: query.get("q") ?? undefined,
    unread: unread === "true" ? true : unread === "false" ? false : undefined,
  };
}

function normalizeMailbox(value: string | undefined): EmailMailbox | undefined {
  if (value === "primary" || value === "drafts" || value === "sent" || value === "starred" || value === "all" || value === "archive" || value === "spam") return value;
  return undefined;
}

function messageMatchesMailbox(message: EmailMessage, mailbox: EmailMailbox): boolean {
  if (mailbox === "all") return true;
  if (mailbox === "drafts") return messageHasAnyFolder(message, ["draft", "drafts", "\\draft", "\\drafts"]);
  if (mailbox === "sent") return messageHasAnyFolder(message, ["sent", "\\sent"]);
  if (mailbox === "starred") return message.starred;
  if (mailbox === "archive") return messageIsArchived(message);
  if (mailbox === "spam") return messageHasAnyFolder(message, ["spam", "\\spam", "junk", "\\junk"]);
  if (messageIsExcludedFromPrimary(message)) return false;
  return !messageHasFolderMetadata(message) || messageHasAnyFolder(message, ["inbox", "\\inbox"]);
}

function messageIsExcludedFromPrimary(message: EmailMessage): boolean {
  return messageHasAnyFolder(message, PRIMARY_EXCLUDED_FOLDER_TOKENS);
}

function messageIsArchived(message: EmailMessage): boolean {
  if (!messageHasFolderMetadata(message)) return false;
  if (messageHasAnyFolder(message, ["trash", "\\trash", "spam", "\\spam", "junk", "\\junk", "sent", "\\sent", "draft", "\\draft", "drafts", "\\drafts"])) return false;
  return !messageHasAnyFolder(message, ["inbox", "\\inbox"]);
}

function messageHasFolderMetadata(message: EmailMessage): boolean {
  return Array.isArray(message.folders) || Array.isArray(message.folder_ids);
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

function messageHasAnyFolder(message: EmailMessage, candidates: readonly string[]): boolean {
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
