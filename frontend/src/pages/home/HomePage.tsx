import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { readAuthConfig } from "../../auth/cognitoAuth";
import { AccountFilterControl, useCompanyAccounts } from "../../modules/accounts/AccountFilterControl";
import { entityMatchesAccountFilter } from "../../modules/accounts/accountsApi";
import { createRequestJSON, requestJSON } from "../../modules/api/requestJSON";
import { EntityPermissionsDialog } from "../../modules/permissions/EntityPermissionsDialog";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { AppModalPortal } from "../../app/AppModalPortal";
import { ConfirmActionMenu, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu";
import { requestAppDockTab } from "../../app/appDockTabs";
import { MangoWordmark } from "../../icons/index.js";
import { preloadLogicGateArenaSurface, preloadProjectManagementSurface } from "../../app/preloadDashboardModules";
import {
  addLogicGateRACIAssignments,
  addLocalEmailReply,
  addLocalReplyToEmailMessage,
  disconnectCommunications,
  downloadEmailAttachment,
  emailMessageWithLogicGatePlacement,
  emailMessageMatchesListFilters,
  ensureEmailCollaboration,
  EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED,
  fetchCommunicationsAuthURL,
  fetchCommunicationsWorkspacePanel,
  fetchCommunicationsStatus,
	getEmailCollaborationThread,
	getCommunicationsArchiveJob,
  getEmailMessage,
  getEmailSignature,
  getEmailThread,
  invalidateCommunicationsCache,
  invalidateCommunicationsMailboxCache,
  invalidateEmailMessageCache,
  invalidateEmailThreadCache,
  listCompanyUsers,
  listCompanyUserGroups,
  listEmailFolders,
  listEmailMessages,
  listCommunicationsSharedInboxes,
  mergeEmailMessageIntoMessageList,
  parseEmailAddressList,
  patchEmailMessagesLogicGatePlacement,
  removeLogicGateRACIAssignments,
  settleCommunicationsMailboxMessageOverlays,
  saveEmailSignature,
  sendEmailCollaborationDraft,
  sortEmailMessagesByDateDescending,
  updateCommunicationsSharedInboxRACIAssignments,
  type CompanyUser,
  type CompanyUserGroup,
  type CompanyUserGroupMember,
	type CommunicationsEmailCollaboration,
	type CommunicationsArchiveJob,
  type CommunicationsSharedInbox,
  type CommunicationsSharedInboxCreateIntent,
  type CommunicationsSharedInboxRACIRole,
  type CommunicationsSharedInboxRACIPrincipalType,
  type EmailFolder,
  type EmailMailbox,
  type EmailMessage,
  type MessagePage,
  type CommunicationsStatus,
  type EmailProvider,
  type UserLogicGateShortcut,
} from "../../modules/communications/communicationsApi";
import { mangoEmailDraftResourceID, uploadMangoAttachment } from "../../modules/attachments/attachmentApi";
import { isOutboundEmailUndoneError } from "../../modules/communications/outboundEmailUndo";
import { realtimePersonalMailboxScope, realtimeSharedMailboxScope, subscribeRealtimeScope } from "../../modules/realtime/realtimeWebSocket";
import { buildReplyAllRecipients } from "../../modules/communications/emailRecipients";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../modules/folders/companyExplorerFolders";
import { EVENT_EDITOR_EMAIL_REFERENCE_OPEN, type EditorEntityLink } from "../../modules/editor/editorEntityLinks.js";
import type { NodeRecord, NodeRelationship } from "../../modules/nodes/types";
import { buildCompanyExplorerTreeRows } from "../../modules/company-explorer/companyExplorerTreeRows";
import {
  reconcileCommittedLogicGateRecordTitles,
  reconcileCommittedNodeTitleInSnapshot,
} from "../../modules/realtime/committedTitleSnapshotReconciliation";
import { resolveExplorerClickSelection } from "../../modules/company-explorer/treePresentation";
import type { ExplorerDragPayload, ExplorerTreeNode } from "../../modules/company-explorer/companyExplorerTypes";
import type { LogicGateRACIRole, LogicGateRecord } from "../../modules/logic-gates/types";
import { toLogicGateViewRecord } from "../../modules/logic-gates/types";
import { invalidateNodeRecordStoreCaches } from "../../modules/nodes/nodeRecordStore";
import { getLogicGateRecordSingleFlight } from "../../modules/logic-gates/logicGateRecordStore";
import { removeNodeRelationshipGraphNode, upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../../modules/nodes/nodeRelationshipGraph";
import { removeLogicGateRelationshipGraphNode, upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../../modules/logic-gates/logicGateRelationshipGraph";
import { invalidateKanbanBoardContentsCache } from "../../modules/kanban/KanbanBoardContentStore";
import { invalidateKanbanBoardListCache, invalidateLogicGateArenaViewCache, type RACIMatrixProjectionRow } from "../../modules/kanban/kanbanApi";

import { listMyLogicGates, listRACIMatrixProjectionRows } from "../../modules/work-items/workItemReadApi";
import { useNotificationSummary } from "../../modules/notifications/useNotificationSummary";
import {
  commitEntityTitleMutation,
  foldCommittedEntityTitlesSince,
  readCommittedEntityTitleVersion,
  subscribeCommittedEntityTitleUpdates,
} from "../../modules/realtime/committedEntityTitleUpdates";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED } from "../../modules/dashboardEvents";
import { writePendingLogicGateArenaSelection } from "../logic-gate-arena/logicGateArenaLaunch";
import { buildLogicGateRoute, buildProjectRoute } from "../../app/deepLinkRoutes";
import { DeleteHomeEntitiesConfirmationModal, HomeBulkEditMenu, HomeColumnResizeHandle, LogicGateRail, NodeEditorPopup, NodeInboxRail, RACIMatrixViewerSelector, RACIRoleInboxMatrix, SharedInboxRACISettingsModal, type RACIMatrixViewerListEntry } from "./HomeParts";
import { MyWorkView } from "./MyWorkView";
import { markMyWorkMatrixCachesStaleForCompany, markMyWorkMatrixCachesStaleForTargetUsers } from "./myWorkMatrixLoader";
import { myWorkDebugLog, recordMyWorkDebugCause } from "./myWorkPerformanceDebug";
import { UpdatesView } from "./UpdatesView";
import { HomeMailOverlays, HomeMailWorkspace, type HomeMailNoticeAction } from "./HomeMailWorkspace";
import { OutboundEmailUndoBanner } from "../../modules/communications/OutboundEmailUndoBanner";
import { applyHomeMailSignature, composeHasDraftContent, createHomeMailDraftID, createHomeMailForwardDraftID, createHomeMailReplyDraftID, createHomeMailSharedReplyDraftID, deleteHomeMailDraft, deleteHomeMailDraftRemote, deleteHomeMailDraftsRemote, ensureHomeMailDraftAttachmentTarget, homeMailDraftMatchesScope, homeMailDraftToCompose, homeMailDraftToMessage, homeMailSignatureScopeKey, loadHomeMailDrafts, loadHomeMailSignature, mergeHomeMailDrafts, readHomeMailDrafts, readHomeMailDraftsForScope, readHomeMailSignature, saveHomeMailDraftFromCompose, saveHomeMailSignatureRemote, syncHomeMailDraftFromCompose, type HomeMailDraft } from "./homeMailDrafts";
import { applyHomeMailboxCountDelta, cancelHomeMailboxListRequestTimers, consumeHomeMailboxLocalMutationEcho, createHomeMailboxFolderLoadCoordinator, createHomeMailboxRealtimeCoordinator, forgetHomeMailboxLocalMutationEchoes, homeMailboxComposeSubmissionIsCurrent, homeMailboxCountKey, homeMailboxFolderOwnerIsCurrent, homeMailboxPendingMessageIDs, homeMailboxPendingMessageKey, homeMailboxRealtimeTargetKey, homeMailboxRequestOwnerIsCurrent, rememberHomeMailboxLocalMutationEchoes, selectHomeMailboxRealtimeTarget, type HomeMailboxCountOverrideKey, type HomeMailboxCountOverrides, type HomeMailboxFolderOwner, type HomeMailboxLocalMutationEchoRegistry, type HomeMailboxRequestOwner } from "./homeMailboxRealtime";
import { ARCHIVE_QUEUE_MAX_EMAILS, EVENT_HOME_TRIAGE_CONVERSION_APPLIED, HOME_COLUMN_RESIZER_WIDTH, MESSAGE_BATCH_SIZE, MESSAGE_EVENT_REFRESH_DELAY_MS, TRIAGE_MESSAGE_DRAG_MIME, type HomeTriageConversionAppliedDetail } from "./homeConstants";
import { addMyLogicGateShortcutsCommand, addNodesToLogicGateCommand, applyBulkNodePatchCommand, archiveHomeMailMessagesCommand, convertMessagesToLogicGateCommand, createHomeLogicGateCommand, createHomeNodeCommand, createHomeRACIMatrixNodeCommand, deleteHomeEntitiesCommand, deleteHomeMailMessagesCommand, dropNodesIntoInboxLogicGateCommand, moveMyWorkNodesToCellCommand, removeMyLogicGateShortcutCommand, sendHomeMailComposeCommand, unarchiveHomeMailMessagesCommand, updateHomeMailMessageCommand, updateSharedInboxAccountEmailCommand } from "./homeCommands";
import { buildMyLogicGateGroups, buildMyNodeGroups, canDragTriageMessageFromMailbox, cleanIDList, condenseEmailThreadMessages, emailMailboxMessageKey, emailMailboxScopeKey, emailMessagesForOrderedPage, emailThreadKey, filterExplorerRowsForSearch, fitHomeColumnWidthsToAvailableWidth, formatAddressList, formatError, formatErrorCode, getHomeColumnMinimumTrackWidth, getHomeGridTemplateColumns, getHomeGridTemplateColumnsWithoutSidebar, getHomeWorkspaceTrackWidth, getHomeViewLabel, getInboxMatrixGridTemplateColumns, getInboxMatrixGridTemplateColumnsWithoutSidebar, inboxCountPresentation, isArchivableHomeViewID, isEditableKeyboardTarget, isEmailAccessExpiredError, isInboxMatrixViewID, isWorkspacePanelHomeViewID, logicGateHasAnyRACIRole, logicGateHasRACIRole, logicGateIDFromTreeID, logicGateTitle, logicGateTreeID, mailboxCountsFromFolders, missingEmailThreadMessageIDs, missingLogicGateRecordIDs, mailboxForHomeView, mailboxLabel, mergeEmailMessageIntoScopedMessageList, mergeLogicGateShortcuts, messageListFilterKey, nextEmailMessageAfterRemoval, nodeIDFromTreeID, nodeTitle, nodeTreeID, gvicInboxSectionForView, orderEmailConversationMessages, readHomeColumnWidths, resizeHomeColumns, resizeHomeColumnsWithoutSidebar, resizeHomeInboxMatrixColumnsWithoutSidebar, saveHomeColumnWidths, sharedInboxCanLoadMail, sharedInboxTreeUserCanManageMail, sortEmailConversationMessagesNewestFirst, sortLogicGateShortcuts, sortSharedInboxes, shouldAutoMarkEmailSelectionRead, unreadEmailThreadMessagesForSelection, userCanManageSharedInboxStructure, userHasFullSharedInboxAccess, type EmailConversationOrder } from "./homeUtils";
import { brandStyle, centerStyle, connectPanelStyle, errorStyle, headerButtonStyle, headerDividerStyle, headerStyle, mutedTextStyle, noticeStyle, pageStyle, panelTitleStyle, primaryButtonStyle, titleStyle, userPillStyle, workspaceStyle } from "./homeStyles";
import { emptyCompose, type ComposeAttachment, type ComposeState, type HomeColumnResizeDrag, type HomeColumnWidths, type HomeEntityDeleteKind, type HomeEntityDeleteTarget, type HomePageProps, type HomeViewID, type InboxPriority, type LoadMessagesOptions, type MessageSelectionModifiers, type NodeEditorOverlayState, type RACIInboxStatus } from "./homeTypes";
import { emailCollaborationListMessage, emailMessageMatchesCollaboration, emailMessageMatchesNodeAttachment, emailMessageUsesActiveProviderScope, mergeEmailCollaborationsForView, mergeEmailMessageWithCollaboration, mergeEmailMessageWithNodeAttachment, sharedInboxIDForHomeView, type EmailNodeAttachmentChange } from "./emailCollaborationRows";
import { forwardedAttachmentsForCopy, forwardedProviderAttachmentID, withForwardedAttachmentCopy } from "./emailForwarding";
import { emailMessageRowKey } from "./homeUtils";

function isPrimaryTriageMailbox(viewID: HomeViewID, mailbox: EmailMailbox): boolean {
  return isArchivableHomeViewID(viewID) && mailbox === "primary";
}

function homeViewUsesSharedEmailConnection(viewID: HomeViewID): boolean {
  return sharedInboxIDForHomeView(viewID) !== "";
}

function isTriageMailViewID(viewID: HomeViewID): boolean {
  return viewID === "my-triage" || viewID === "shared-root" || viewID.startsWith("shared:");
}

function emailBodyLooksHydrated(message: EmailMessage): boolean {
  const body = message.body?.trim() ?? "";
  if (!body) return false;
  const snippet = message.snippet?.trim() ?? "";
  return !snippet || body !== snippet || /<\/?[a-z][\s\S]*>|\r|\n|\s{2,}/i.test(body);
}

function mergeEmailDetailMessage(previous: EmailMessage, next: EmailMessage): EmailMessage {
  const merged: EmailMessage = { ...previous, ...next };
  if (emailBodyLooksHydrated(previous) && !emailBodyLooksHydrated(next)) merged.body = previous.body;
  if (!next.snippet && previous.snippet) merged.snippet = previous.snippet;
  if (!next.from?.length && previous.from?.length) merged.from = previous.from;
  if (!next.to?.length && previous.to?.length) merged.to = previous.to;
  if (!next.cc?.length && previous.cc?.length) merged.cc = previous.cc;
  if (!next.bcc?.length && previous.bcc?.length) merged.bcc = previous.bcc;
  return merged;
}

function mergeEmailThreadDetailMessages(current: EmailMessage[], incoming: EmailMessage[]): EmailMessage[] {
  const byID = new Map<string, EmailMessage>();
  for (const message of [...current, ...incoming]) {
    const rowKey = emailMessageRowKey(message);
    if (!message.id.trim()) continue;
    const existing = byID.get(rowKey);
    byID.set(rowKey, existing ? {
      ...mergeEmailDetailMessage(existing, message),
      local_replies: message.local_replies ?? existing.local_replies,
    } : message);
  }
  return sortEmailConversationMessagesNewestFirst(Array.from(byID.values()));
}

function applyLocalReadOverlay(message: EmailMessage, locallyReadMessageKeys: Set<string>, mailboxScopeKey: string): EmailMessage {
  return locallyReadMessageKeys.has(emailMailboxMessageKey(mailboxScopeKey, message.id)) && message.unread
    ? { ...message, unread: false }
    : message;
}


function applyLocalReadOverlays(messages: EmailMessage[], locallyReadMessageKeys: Set<string>, mailboxScopeKey: string): EmailMessage[] {
  return messages.map((message) => applyLocalReadOverlay(message, locallyReadMessageKeys, mailboxScopeKey));
}

const MISSING_LOGIC_GATE_REPAIR_CONCURRENCY = 4;
const MISSING_LOGIC_GATE_REPAIR_FAILURE_TTL_MS = 5 * 60_000;
const PRIMARY_TRIAGE_PAGE_FILL_MAX_REQUESTS = 4;
const EMAIL_DETAIL_FOREGROUND_GRACE_MS = 250;
const EMAIL_THREAD_PREVIEW_MAX_PAGES = 8;
const LOCAL_TRIAGE_CONVERSION_MAIL_NETWORK_SUPPRESSION_MS = 8_000;


function homeMessageIsDraft(message: EmailMessage): boolean {
  return (message.folders ?? []).some((folder) => {
    const value = folder.trim().toLowerCase();
    return value === "draft" || value === "drafts";
  });
}

function homeMailDraftMatchesSearch(draft: HomeMailDraft, query: string): boolean {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return true;
  return [
    draft.to,
    draft.cc,
    draft.bcc,
    draft.subject,
    draft.body,
    draft.accountEmail,
    ...draft.attachments.map((attachment) => attachment.filename),
  ].some((value) => value.toLowerCase().includes(cleanQuery));
}

function composeBodyWithSignature(signature: string): string {
  return applyHomeMailSignature("", signature);
}

function addressListExcludingMailbox(message: EmailMessage, field: "from" | "reply_to" | "to" | "cc", mailboxEmail: string): string {
  const cleanMailboxEmail = mailboxEmail.trim().toLowerCase();
  const seen = new Set<string>();
  const addresses = (message[field] ?? []).filter((address) => {
    const email = address.email.trim().toLowerCase();
    if (!email || email === cleanMailboxEmail || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
  return formatAddressList(addresses);
}

function replyAllRecipients(message: EmailMessage, mailboxEmail: string): { to: string; cc: string } {
  const recipients = buildReplyAllRecipients(message, [mailboxEmail]);
  return { to: formatAddressList(recipients.to), cc: formatAddressList(recipients.cc) };
}

function mergeEmailAddressDrafts(values: string[], excludedValues: string[] = []): string {
  const excluded = new Set(
    excludedValues.flatMap((value) => parseEmailAddressList(value)).map((address) => address.email.trim().toLowerCase()).filter(Boolean),
  );
  const seen = new Set<string>();
  const addresses = values.flatMap((value) => parseEmailAddressList(value)).filter((address) => {
    const key = address.email.trim().toLowerCase();
    if (!key || excluded.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return formatAddressList(addresses);
}

function replySubject(subject: string): string {
  const cleanSubject = subject.trim();
  return cleanSubject.toLowerCase().startsWith("re:") ? cleanSubject : `Re: ${cleanSubject}`.trim();
}

function forwardSubject(subject: string): string {
  const cleanSubject = subject.trim();
  return cleanSubject.toLowerCase().startsWith("fwd:") ? cleanSubject : `Fwd: ${cleanSubject}`.trim();
}


function scheduledSendTimestamp(value: string): number {
  const cleanValue = value.trim();
  if (!cleanValue) return Number.NaN;
  return Date.parse(cleanValue);
}

function composeIsScheduledForFuture(compose: ComposeState, now = Date.now()): boolean {
  const scheduledAtMs = scheduledSendTimestamp(compose.scheduledAt);
  return Number.isFinite(scheduledAtMs) && scheduledAtMs > now + 30_000;
}

function validateScheduledCompose(compose: ComposeState): string {
  if ([...parseEmailAddressList(compose.to), ...parseEmailAddressList(compose.cc), ...parseEmailAddressList(compose.bcc)].length === 0) {
    return "Add at least one recipient.";
  }
  if (!compose.subject.trim() && !compose.body.trim() && compose.attachments.length === 0) {
    return "Add a subject or message body.";
  }
  return "";
}

function formatScheduledSendNotice(value: string): string {
  const scheduledAtMs = scheduledSendTimestamp(value);
  if (!Number.isFinite(scheduledAtMs)) return "Message scheduled.";
  return `Message scheduled for ${new Date(scheduledAtMs).toLocaleString()}.`;
}

type HomeNoticeResourceAction =
  | { kind: "logic_gate"; logicGateID: string }
  | { kind: "node"; nodeID: string };

const RACIMatrix_VIEWER_LIST_STORAGE_KEY_PREFIX = "mangorts.home.gvicViewerList.v1";

function RACIMatrixViewerListStorageKey(companyID: string, userID: string): string {
  const cleanCompanyID = companyID.trim() || "global";
  const cleanUserID = userID.trim() || "anonymous";
  return `${RACIMatrix_VIEWER_LIST_STORAGE_KEY_PREFIX}:${cleanCompanyID}:${cleanUserID}`;
}

function readRACIMatrixViewerListEntries(companyID: string, userID: string): RACIMatrixViewerListEntry[] {
  if (typeof localStorage === "undefined" || !companyID.trim() || !userID.trim()) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(RACIMatrixViewerListStorageKey(companyID, userID)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries: RACIMatrixViewerListEntry[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as { kind?: unknown; id?: unknown };
      const kind = candidate.kind === "group" ? "group" : candidate.kind === "user" ? "user" : "";
      const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
      if (!kind || !id) continue;
      const key = `${kind}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ kind, id });
    }
    return entries;
  } catch {
    return [];
  }
}

function storeRACIMatrixViewerListEntries(companyID: string, userID: string, entries: RACIMatrixViewerListEntry[]): void {
  if (typeof localStorage === "undefined" || !companyID.trim() || !userID.trim()) return;
  const cleanEntries = entries
    .map((entry) => ({ kind: entry.kind, id: entry.id.trim() }))
    .filter((entry) => (entry.kind === "group" || entry.kind === "user") && entry.id);
  const key = RACIMatrixViewerListStorageKey(companyID, userID);
  if (cleanEntries.length === 0) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(cleanEntries));
}

function homeCompanyUserLabel(user: Pick<CompanyUser, "user_id" | "display_name" | "email"> | null | undefined, fallbackUserID: string): string {
  return user?.display_name?.trim() || user?.email?.trim() || fallbackUserID.trim() || "User";
}

function isSharedInboxEmailConnectionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("shared_inbox_email_account_not_connected");
}

type PrefetchedMessagePage = {
  filterKey: string;
  pageToken: string;
  page: MessagePage;
};

function primaryTriageVisibleMessagesForList(messages: EmailMessage[], order: EmailConversationOrder = "newest"): EmailMessage[] {
  return emailMessagesForOrderedPage(condenseEmailThreadMessages(messages), order, MESSAGE_BATCH_SIZE);
}

function primaryTriageVisibleRawMessageIDs(messages: EmailMessage[], order: EmailConversationOrder = "newest"): string[] {
  const visibleKeys = new Set(primaryTriageVisibleMessagesForList(messages, order).map(emailThreadKey));
  const ids: string[] = [];
  const seenIDs = new Set<string>();
  for (const message of messages) {
    const id = message.id.trim();
    if (!id || seenIDs.has(id) || !visibleKeys.has(emailThreadKey(message))) continue;
    seenIDs.add(id);
    ids.push(id);
  }
  return ids;
}

function mergeEmailMessagePages(current: EmailMessage[], incoming: EmailMessage[]): EmailMessage[] {
  const seen = new Set<string>();
  const next: EmailMessage[] = [];
  for (const message of [...current, ...incoming]) {
    const id = message.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(message);
  }
  return sortEmailMessagesByDateDescending(next);
}

type QueuedArchiveBatch = {
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  messageIDs: string[];
  owner: HomeMailboxRequestOwner;
  realtimeScope: string;
};

type SharedInboxEmailConnectionDialogState = {
  accountEmail: string;
  canConnect: boolean;
  createIntent?: CommunicationsSharedInboxCreateIntent;
};

type SharedInboxEmailConnectionIssue = {
  folderID: string;
  accountEmail: string;
  canConnect: boolean;
};

type SharedInboxEmailAssignmentDialogState = {
  folderID: string;
  folderName: string;
  draft: string;
  error: string;
};

function messageHasInboxLabel(message: EmailMessage): boolean {
  return [...(message.folders ?? []), ...(message.folder_ids ?? [])].some((folder) => {
    let token = folder.trim().toLowerCase();
    while (token.startsWith("\\")) token = token.slice(1);
    return token === "inbox";
  });
}

type MessageListScrollAnchor = {
  rowKey: string;
  top: number;
};

function captureMessageListScrollAnchor(container: HTMLDivElement, removedRowKeys: Set<string>): MessageListScrollAnchor | null {
  const containerTop = container.getBoundingClientRect().top;
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-home-mail-message-id]"));
  for (const row of rows) {
    const rowKey = row.dataset.homeMailMessageId?.trim();
    if (!rowKey || removedRowKeys.has(rowKey)) continue;
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= containerTop + 1) continue;
    return { rowKey, top: rect.top - containerTop };
  }
  return null;
}

function restoreMessageListScrollAnchor(container: HTMLDivElement, anchor: MessageListScrollAnchor): void {
  const row = Array.from(container.querySelectorAll<HTMLElement>("[data-home-mail-message-id]"))
    .find((item) => item.dataset.homeMailMessageId?.trim() === anchor.rowKey);
  if (!row) return;
  const nextTop = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const delta = nextTop - anchor.top;
  if (Math.abs(delta) > 0.5) container.scrollTop += delta;
}

function messageListRemainingDistance(container: HTMLDivElement): number {
  return container.scrollHeight - container.scrollTop - container.clientHeight;
}

function messageListContentScrollHeight(container: HTMLDivElement): number {
  return container.scrollHeight;
}

export function HomePage({
  me,
  onNavigate,
  embedded = false,
  initialViewID = "my-work",
  onActiveViewChange,
  deepLinkNodeID,
  onNodeOverlayOpen,
  onNodeOverlayClose,
}: HomePageProps) {
  const appSidebarOwnsNavigation = true;
  const companyID = getActiveCompanyID();
  const apiBase = readAuthConfig().apiBase;
  const permissionsRequestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const attachmentRequestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const notificationSummary = useNotificationSummary(companyID);
  const [status, setStatus] = useState<CommunicationsStatus | null>(null);
  const [folders, setFolders] = useState<EmailFolder[]>([]);
  const [mailboxCountOverrides, setMailboxCountOverrides] = useState<HomeMailboxCountOverrides>({});
  const [inboxCountFallbacks, setInboxCountFallbacks] = useState<Record<string, { count: number; isMinimum: boolean }>>({});
  const [sharedInboxes, setSharedInboxes] = useState<CommunicationsSharedInbox[]>([]);
  const [sharedInboxesLoaded, setSharedInboxesLoaded] = useState(false);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [emailCollaborations, setEmailCollaborations] = useState<CommunicationsEmailCollaboration[]>([]);
  const [mailbox, setMailbox] = useState<EmailMailbox>("primary");
  const [activeViewID, setActiveViewID] = useState<HomeViewID>(initialViewID);
  const [selectedMessageID, setSelectedMessageID] = useState("");
  const [selectedMessageRowKey, setSelectedMessageRowKey] = useState("");
  const [selectedMessageIDs, setSelectedMessageIDs] = useState<Set<string>>(new Set());
  const [selectionAnchorMessageID, setSelectionAnchorMessageID] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [selectedThreadMessages, setSelectedThreadMessages] = useState<EmailMessage[]>([]);
  const [queuedArchiveEmailCount, setQueuedArchiveEmailCount] = useState(0);
  const [pendingStarredMessageIDs, setPendingStarredMessageIDs] = useState<Set<string>>(new Set());
  const [messageContextMenu, setMessageContextMenu] = useState<{ x: number; y: number; messageIDs: string[] } | null>(null);
  const [bulkEditMenu, setBulkEditMenu] = useState<{ x: number; y: number; kind: "node" | "logic_gate"; ids: string[] } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ messageIDs: string[]; position?: ConfirmActionMenuPosition | null } | null>(null);
  const [disconnectConfirmation, setDisconnectConfirmation] = useState<{ position?: ConfirmActionMenuPosition | null } | null>(null);
  const [entityDeleteConfirmation, setEntityDeleteConfirmation] = useState<{ targets: HomeEntityDeleteTarget[]; position?: ConfirmActionMenuPosition | null } | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [messageListOrder, setMessageListOrder] = useState<EmailConversationOrder>("newest");
  const [nextPageToken, setNextPageToken] = useState("");
  const [loadedMessageListKey, setLoadedMessageListKey] = useState("");
  const [compose, setCompose] = useState<ComposeState>(emptyCompose);
  const [mailDrafts, setMailDrafts] = useState<HomeMailDraft[]>([]);
  const [emailSignature, setEmailSignature] = useState("");
  const [emailSignatureScopeKey, setEmailSignatureScopeKey] = useState("");
  const [emailSignatureID, setEmailSignatureID] = useState("");
  const [emailSignatureIDScopeKey, setEmailSignatureIDScopeKey] = useState("");
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingSharedInboxes, setLoadingSharedInboxes] = useState(false);
  const [loadingLogicGates, setLoadingLogicGates] = useState(false);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [nodeFolders, setNodeFolders] = useState<CompanyExplorerFolder[]>([]);
  const [nodeFolderItems, setNodeFolderItems] = useState<CompanyExplorerFolderItem[]>([]);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [nodeRelationships, setNodeRelationships] = useState<NodeRelationship[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [companyUserGroups, setCompanyUserGroups] = useState<CompanyUserGroup[]>([]);
  const [companyUserGroupMembers, setCompanyUserGroupMembers] = useState<CompanyUserGroupMember[]>([]);
  const [RACIMatrixViewerListEntries, setRACIMatrixViewerListEntries] = useState<RACIMatrixViewerListEntry[]>([]);
  const [RACIMatrixTargetUserID, setRACIMatrixTargetUserID] = useState("");
  const [matrixAccountFilterIDs, setMatrixAccountFilterIDs] = useState<string[]>([]);
  const [logicGateFolders, setLogicGateFolders] = useState<CompanyExplorerFolder[]>([]);
  const [logicGateFolderItems, setLogicGateFolderItems] = useState<CompanyExplorerFolderItem[]>([]);
  const [logicGates, setLogicGates] = useState<LogicGateRecord[]>([]);
  const [myLogicGateShortcuts, setMyLogicGateShortcuts] = useState<UserLogicGateShortcut[]>([]);
  const [nodeSearch, setNodeSearch] = useState("");
  const [nodeExpandedIDs, setNodeExpandedIDs] = useState<Set<string>>(new Set());
  const [selectedNodeRowIDs, setSelectedNodeRowIDs] = useState<Set<string>>(new Set());
  const [nodeSelectionAnchorID, setNodeSelectionAnchorID] = useState("");
  const [logicGateSearch, setLogicGateSearch] = useState("");
  const [logicGateExpandedIDs, setLogicGateExpandedIDs] = useState<Set<string>>(new Set());
  const [selectedLogicGateRowIDs, setSelectedLogicGateRowIDs] = useState<Set<string>>(new Set());
  const [logicGateSelectionAnchorID, setLogicGateSelectionAnchorID] = useState("");
  const [nodeEditorOverlay, setNodeEditorOverlay] = useState<NodeEditorOverlayState | null>(null);
  const [sharedInboxPermissionsFolderID, setSharedInboxPermissionsFolderID] = useState("");
  const [sharedInboxRACIFolderID, setSharedInboxRACIFolderID] = useState("");
  const [sharedInboxEmailConnectionDialog, setSharedInboxEmailConnectionDialog] = useState<SharedInboxEmailConnectionDialogState | null>(null);
  const [sharedInboxEmailConnectionIssue, setSharedInboxEmailConnectionIssue] = useState<SharedInboxEmailConnectionIssue | null>(null);
  const [sharedInboxEmailAssignmentDialog, setSharedInboxEmailAssignmentDialog] = useState<SharedInboxEmailAssignmentDialogState | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preserveInitialOAuthError] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get("nylas_error")?.trim());
  });
  const [pendingSharedOAuthAccountEmail, setPendingSharedOAuthAccountEmail] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const scope = params.get("nylas_scope")?.trim().toLowerCase() ?? "";
    const accountEmail = params.get("nylas_account_email")?.trim().toLowerCase() ?? "";
    return params.get("nylas") === "connected" && scope === "shared" ? accountEmail : "";
  });
  const [pendingSharedOAuthSharedInboxID, setPendingSharedOAuthSharedInboxID] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const scope = params.get("nylas_scope")?.trim().toLowerCase() ?? "";
    const sharedInboxID = params.get("nylas_shared_inbox_id")?.trim() ?? "";
    return params.get("nylas") === "connected" && scope === "shared" ? sharedInboxID : "";
  });
  const [pendingSharedInboxMessageRefreshID, setPendingSharedInboxMessageRefreshID] = useState("");
  const [selectedMailDetailRealtimeRevision, setSelectedMailDetailRealtimeRevision] = useState(0);
  const [myWorkLiveRefreshToken, setMyWorkLiveRefreshToken] = useState(0);
  const [optimisticMyWorkDeletedNodeIDs, setOptimisticMyWorkDeletedNodeIDs] = useState<Set<string>>(new Set());
  const [noticeResourceAction, setNoticeResourceAction] = useState<HomeNoticeResourceAction | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [workspaceTrackWidth, setWorkspaceTrackWidth] = useState(() => Math.max(1, window.innerWidth - 20));
  const [columnWidths, setColumnWidths] = useState<HomeColumnWidths>(() => readHomeColumnWidths());
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const composeRef = useRef<ComposeState>(emptyCompose);
  const foldersRequestSeqRef = useRef(0);
  const sharedInboxesRequestInFlightRef = useRef(false);
  const logicGatePanelRequestInFlightRef = useRef(false);
  const nodeRelationshipRequestSeqRef = useRef(0);
  const messageRequestKeyRef = useRef("");
  const pendingMessageReloadRef = useRef(false);
  const pendingMessageRefreshRef = useRef(false);
  const queuedMessageReloadTimerRef = useRef<number | null>(null);
  const messageRequestSeqRef = useRef(0);
  const loadFoldersRef = useRef<((options?: { refresh?: boolean; owner?: HomeMailboxFolderOwner }) => Promise<boolean>) | null>(null);
  const loadFoldersCanonicalRef = useRef<(owner: HomeMailboxFolderOwner, refresh: boolean) => Promise<boolean>>(async () => false);
  const loadMessagesRef = useRef<((options?: LoadMessagesOptions) => Promise<void>) | null>(null);
  const mailboxRealtimeTargetRef = useRef<ReturnType<typeof selectHomeMailboxRealtimeTarget>>(null);
  const localMailboxMutationEchoesRef = useRef<HomeMailboxLocalMutationEchoRegistry>(new Map());
  const draftMessagesRef = useRef<EmailMessage[]>([]);
  const prefetchedMessagePageRef = useRef<PrefetchedMessagePage | null>(null);
  const prefetchMessageTokenRef = useRef("");
  const prefetchMessageFilterKeyRef = useRef("");
  const prefetchMessagePromiseRef = useRef<Promise<void> | null>(null);
  const prefetchMessageGenerationRef = useRef(0);
  const selectedMessageIDRef = useRef("");
  const selectedMessageRowKeyRef = useRef("");
  const selectedMessageRef = useRef<EmailMessage | null>(null);
  const activeViewIDRef = useRef<HomeViewID>(initialViewID);
  const messageListOrderRef = useRef<EmailConversationOrder>("newest");
  const initialViewIDRef = useRef<HomeViewID>(initialViewID);
  const queuedArchiveBatchesRef = useRef<Map<string, QueuedArchiveBatch>>(new Map());
	const pendingArchiveMessageKeysRef = useRef<Set<string>>(new Set());
	const activeArchiveJobsRef = useRef<Map<string, QueuedArchiveBatch>>(new Map());
	const refreshArchiveJobsRef = useRef<() => void>(() => undefined);
	const archiveQueueFlushTimerRef = useRef<number | null>(null);
  const delayedMailRequestTimerIDsRef = useRef<Set<number>>(new Set());
  const delayedMarkReadTimerByMessageKeyRef = useRef<Map<string, number>>(new Map());
  const markReadMutationTokenByMessageKeyRef = useRef<Map<string, number>>(new Map());
  const nextMarkReadMutationTokenRef = useRef(0);
  const messageSelectionGenerationRef = useRef(0);
  const pendingStarredMessageIDsRef = useRef<Set<string>>(new Set());
  const scheduledMailDraftsInFlightRef = useRef<Set<string>>(new Set());
  const pendingAutoSignatureRef = useRef<{ draftID: string; scopeKey: string } | null>(null);
  const emailSignatureEditRevisionRef = useRef(0);
  const folderReloadTimerRef = useRef<number | null>(null);
  const messageListRefreshTimerRef = useRef<number | null>(null);
  const pendingMessageListRefreshOptionsRef = useRef({ requestKey: "", refresh: false });
  const myWorkLiveRefreshTimerRef = useRef<number | null>(null);
  const RACIMatrixProjectionRefetchInFlightRef = useRef(false);
  const RACIMatrixProjectionInitializedRef = useRef(false);
  const RACIMatrixProjectionRowsRef = useRef<RACIMatrixProjectionRow[]>([]);
  const RACIMatrixProjectionScopeKeyRef = useRef("");
  const RACIMatrixProjectedNodeIDsRef = useRef<Set<string>>(new Set());
  const RACIMatrixProjectedLogicGateIDsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<EmailMessage[]>([]);
  const foldersRef = useRef<EmailFolder[]>([]);
  const sharedInboxesRef = useRef<CommunicationsSharedInbox[]>([]);
  const locallyReadMessageKeysRef = useRef<Set<string>>(new Set());
  const activeEmailMailboxScopeKeyRef = useRef("");
  const activeMailboxRequestKeyRef = useRef("");
  const activeMailAccountEmailRef = useRef("");
  const currentUserIDRef = useRef("");
  const mailboxRef = useRef<EmailMailbox>("primary");
  const nextPageTokenRef = useRef("");
  const searchQueryRef = useRef("");
  const unreadOnlyRef = useRef(false);
  const loadingMessagesRef = useRef(false);
  const loadingMoreMessagesRef = useRef(false);
  const activeDeleteSelectionKindRef = useRef<"message" | HomeEntityDeleteKind | "">("");
  const messageListFilterKeyRef = useRef("");
  const localTriageConversionMailNetworkSuppressionRef = useRef<{ filterKey: string; expiresAt: number } | null>(null);
  const missingLogicGateRepairFailureIDsRef = useRef<Map<string, number>>(new Map());
  const noticeResourceTextRef = useRef("");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const columnWidthsRef = useRef<HomeColumnWidths>(columnWidths);
  const columnResizeDragRef = useRef<HomeColumnResizeDrag | null>(null);
  const appSidebarOwnsNavigationRef = useRef(appSidebarOwnsNavigation);
  const isInboxMatrixView = isInboxMatrixViewID(activeViewID);
  const isMyWorkView = activeViewID === "my-work";
  const isUpdatesView = activeViewID === "updates";
  const { accounts: matrixAccounts } = useCompanyAccounts(companyID, isInboxMatrixView);
  const isNarrow = isInboxMatrixView
    ? viewportWidth < 980
    : isMyWorkView || isUpdatesView
      ? viewportWidth < 760
      : workspaceTrackWidth < getHomeColumnMinimumTrackWidth(!appSidebarOwnsNavigation);
  const currentUserID = me?.user.user_id?.trim() ?? "";
  const activeRACIMatrixUserID = isInboxMatrixView ? (RACIMatrixTargetUserID.trim() || currentUserID) : currentUserID;
  useEffect(() => subscribeCommittedEntityTitleUpdates((update) => {
    if (update.companyID !== companyID) return;
    const title = update.title.trim();
    if (!title) return;
    setEntityDeleteConfirmation((current) => {
      if (!current) return current;
      let changed = false;
      const targets = current.targets.map((target) => {
        if (target.kind !== update.entityType || target.id !== update.resourceID || target.label === title) return target;
        changed = true;
        return { ...target, label: title };
      });
      return changed ? { ...current, targets } : current;
    });
    if (update.entityType === "node") {
      setNodes((current) => reconcileCommittedNodeTitleInSnapshot(current, update));
      setNodeEditorOverlay((current) => current?.nodeID === update.resourceID ? { ...current, nodeTitle: title } : current);
      return;
    }
    setLogicGates((current) => reconcileCommittedLogicGateRecordTitles(current, update));
  }), [companyID]);
  useEffect(() => {
    setOptimisticMyWorkDeletedNodeIDs(new Set());
    setSharedInboxesLoaded(false);
  }, [companyID]);
  const scheduleMyWorkLiveRefresh = useCallback((targetUserIDs: string[] = []) => {
    const cleanTargetUserIDs = cleanIDList(targetUserIDs);
    if (cleanTargetUserIDs.length > 0) markMyWorkMatrixCachesStaleForTargetUsers(cleanTargetUserIDs);
    else markMyWorkMatrixCachesStaleForCompany(companyID);
    myWorkDebugLog("home.scheduleMyWorkRefresh", { companyID, targetUserIDs: cleanTargetUserIDs });
    recordMyWorkDebugCause("local mutation", {
      companyID,
      targetUserCount: cleanTargetUserIDs.length,
      broadCompanyRefresh: cleanTargetUserIDs.length === 0,
    });
    if (myWorkLiveRefreshTimerRef.current !== null) window.clearTimeout(myWorkLiveRefreshTimerRef.current);
    myWorkLiveRefreshTimerRef.current = window.setTimeout(() => {
      myWorkLiveRefreshTimerRef.current = null;
      myWorkDebugLog("home.fireMyWorkRefreshToken", { companyID, targetUserIDs: cleanTargetUserIDs });
      setMyWorkLiveRefreshToken((value) => value + 1);
    }, 80);
  }, [companyID]);
  const scheduleCurrentUserMyWorkRefresh = useCallback(() => {
    scheduleMyWorkLiveRefresh(currentUserID ? [currentUserID] : []);
  }, [currentUserID, scheduleMyWorkLiveRefresh]);
  useEffect(() => () => {
    if (myWorkLiveRefreshTimerRef.current !== null) {
      window.clearTimeout(myWorkLiveRefreshTimerRef.current);
      myWorkLiveRefreshTimerRef.current = null;
    }
  }, []);
  useEffect(() => {
    setRACIMatrixTargetUserID(currentUserID);
  }, [companyID, currentUserID]);
  useEffect(() => {
    setMatrixAccountFilterIDs((current) => current.filter((accountID) => matrixAccounts.some((account) => account.account_id === accountID)));
  }, [matrixAccounts]);
  useEffect(() => {
    setRACIMatrixViewerListEntries(readRACIMatrixViewerListEntries(companyID, currentUserID));
  }, [companyID, currentUserID]);
  const updateRACIMatrixViewerListEntries = useCallback((entries: RACIMatrixViewerListEntry[]) => {
    setRACIMatrixViewerListEntries(entries);
    storeRACIMatrixViewerListEntries(companyID, currentUserID, entries);
  }, [companyID, currentUserID]);
  useEffect(() => {
    const scopeKey = companyID && currentUserID && activeRACIMatrixUserID ? `${companyID}\u0000${currentUserID}\u0000${activeRACIMatrixUserID}` : "";
    if (RACIMatrixProjectionScopeKeyRef.current === scopeKey) return;
    RACIMatrixProjectionScopeKeyRef.current = scopeKey;
    RACIMatrixProjectionRefetchInFlightRef.current = false;
    RACIMatrixProjectionRowsRef.current = [];
    RACIMatrixProjectionInitializedRef.current = false;
    RACIMatrixProjectedNodeIDsRef.current = new Set();
    RACIMatrixProjectedLogicGateIDsRef.current = new Set();
  }, [activeRACIMatrixUserID, companyID, currentUserID]);
  const currentUserHasFullSharedInboxAccess = userHasFullSharedInboxAccess(me, companyID);
  const currentUserCanManageSharedInboxStructure = userCanManageSharedInboxStructure(me, companyID);
  const activeSharedInboxFolderID = sharedInboxIDForHomeView(activeViewID);
  const activeSharedTreeViewSelected = activeViewID === "shared-root" || !!activeSharedInboxFolderID;
  const activePersonalMailViewNeedsConnection = activeViewID === "my-triage" || activeViewID === "primary";
  const showPersonalEmailConnectPanel = status?.connected === false
    && activePersonalMailViewNeedsConnection
    && emailCollaborations.length === 0;
  const connection = status?.connection;

  const activeSharedInbox = useMemo(
    () => activeSharedInboxFolderID ? sharedInboxes.find((folder) => folder.folder_id === activeSharedInboxFolderID) ?? null : null,
    [activeSharedInboxFolderID, sharedInboxes],
  );
  const activeSharedInboxIsParent = !!activeSharedInbox && activeSharedInbox.entry_type !== "shared_inbox";
  const activeSharedInboxIsMailbox = !!activeSharedInbox && activeSharedInbox.entry_type === "shared_inbox";
  const activeSharedInboxNeedsEmail = activeSharedInboxIsMailbox && !(activeSharedInbox.account_email ?? "").trim();
  const activeSharedInboxBlocksEmail = !!activeSharedInboxFolderID && !!activeSharedInbox && !activeSharedInboxIsMailbox;
  const activeSharedInboxConnectionIssue = sharedInboxEmailConnectionIssue?.folderID === activeSharedInboxFolderID
    ? sharedInboxEmailConnectionIssue
    : null;
  const activeMailViewUsesSharedConnection = sharedInboxCanLoadMail(activeSharedInbox) && !activeSharedInboxConnectionIssue;
  const activeMailViewHasEmailConnection = activeSharedInboxFolderID
    ? activeMailViewUsesSharedConnection
    : activePersonalMailViewNeedsConnection && status?.connected === true;
  const activeMailAccountEmail = activeViewID === "shared-root"
    ? ""
    : activeSharedInboxFolderID
      ? activeSharedInbox?.account_email ?? ""
      : connection?.account_email ?? "";
  const activeEmailMailboxScopeKey = emailMailboxScopeKey(
    companyID,
    currentUserID,
    activeMailAccountEmail,
    activeSharedInboxFolderID,
  );
  const activeMailboxRequestKey = messageListFilterKey(
    companyID,
    activeViewID,
    mailbox,
    searchQuery,
    unreadOnly,
    activeEmailMailboxScopeKey,
    messageListOrder,
  );
  useLayoutEffect(() => {
    const mailboxScopeChanged = activeEmailMailboxScopeKeyRef.current !== activeEmailMailboxScopeKey;
    if (mailboxScopeChanged) {
      foldersRequestSeqRef.current += 1;
      if (folderReloadTimerRef.current !== null) {
        window.clearTimeout(folderReloadTimerRef.current);
        folderReloadTimerRef.current = null;
      }
    }
    if (activeMailboxRequestKeyRef.current !== activeMailboxRequestKey) {
      messageRequestSeqRef.current += 1;
      pendingMessageReloadRef.current = false;
      pendingMessageRefreshRef.current = false;
      if (queuedMessageReloadTimerRef.current !== null) {
        window.clearTimeout(queuedMessageReloadTimerRef.current);
        queuedMessageReloadTimerRef.current = null;
      }
      if (messageListRefreshTimerRef.current !== null) {
        window.clearTimeout(messageListRefreshTimerRef.current);
        messageListRefreshTimerRef.current = null;
      }
      cancelHomeMailboxListRequestTimers(
        delayedMailRequestTimerIDsRef.current,
        delayedMarkReadTimerByMessageKeyRef.current,
        (timerID) => window.clearTimeout(timerID),
      );
      prefetchMessageGenerationRef.current += 1;
      prefetchedMessagePageRef.current = null;
      prefetchMessageTokenRef.current = "";
      prefetchMessageFilterKeyRef.current = "";
      prefetchMessagePromiseRef.current = null;
      loadingMoreMessagesRef.current = false;
      setLoadingMoreMessages(false);
      setBusy("");
      setPendingStarredMessageIDs(homeMailboxPendingMessageIDs(
        Array.from(pendingStarredMessageIDsRef.current),
        activeEmailMailboxScopeKey,
      ));
      pendingMessageListRefreshOptionsRef.current = { requestKey: "", refresh: false };
    }
    activeEmailMailboxScopeKeyRef.current = activeEmailMailboxScopeKey;
    activeMailboxRequestKeyRef.current = activeMailboxRequestKey;
    activeMailAccountEmailRef.current = activeMailAccountEmail.trim().toLowerCase();
  }, [activeEmailMailboxScopeKey, activeMailAccountEmail, activeMailboxRequestKey]);
  useLayoutEffect(() => {
    currentUserIDRef.current = currentUserID;
  }, [currentUserID]);
  const activeMailDraftScopeAuthorized = activeSharedInboxFolderID
    ? activeMailViewUsesSharedConnection
    : !!activeMailAccountEmail.trim();
  const activeMailDrafts = useMemo(() => (
    mailDrafts.filter((draft) => (
      (draft.sharedDraft || activeMailDraftScopeAuthorized)
      && homeMailDraftMatchesScope(draft, activeSharedInboxFolderID, activeMailAccountEmail)
      && draft.companyID === companyID
      && draft.userID === currentUserID
    ))
  ), [activeMailAccountEmail, activeMailDraftScopeAuthorized, activeSharedInboxFolderID, companyID, currentUserID, mailDrafts]);
  useEffect(() => {
    const localDrafts = readHomeMailDraftsForScope(
      companyID,
      currentUserID,
      activeSharedInboxFolderID,
      activeMailAccountEmail,
    );
    setMailDrafts(localDrafts);
    if (
      !companyID.trim()
      || !currentUserID.trim()
    ) return undefined;
    let cancelled = false;
    void loadHomeMailDrafts(
      companyID,
      currentUserID,
      activeSharedInboxFolderID,
      activeMailAccountEmail,
    ).then((drafts) => {
      if (!cancelled) setMailDrafts(drafts);
    });
    return () => {
      cancelled = true;
    };
  }, [activeMailAccountEmail, activeMailDraftScopeAuthorized, activeSharedInboxFolderID, companyID, currentUserID]);
  const draftMessages = useMemo(() => (
    unreadOnly
      ? []
      : activeMailDrafts
        .filter((draft) => homeMailDraftMatchesSearch(draft, searchQuery))
        .map(homeMailDraftToMessage)
  ), [activeMailDrafts, searchQuery, unreadOnly]);
  useEffect(() => {
    draftMessagesRef.current = draftMessages;
    if (mailboxRef.current !== "drafts") return;
    setMessages(draftMessages);
    setNextPageToken("");
  }, [draftMessages]);
  const activeSignatureScopeKey = homeMailSignatureScopeKey(
    companyID,
    currentUserID,
    activeSharedInboxFolderID,
    activeMailAccountEmail,
  );
  const activeScopeEmailSignature = emailSignatureScopeKey === activeSignatureScopeKey
    ? emailSignature
    : readHomeMailSignature(companyID, currentUserID, activeSharedInboxFolderID, activeMailAccountEmail);
  const composeSignatureAccountEmail = compose.accountEmail.trim()
    || (!compose.sharedInboxID.trim() && !activeSharedInboxFolderID ? activeMailAccountEmail : "");
  const composeSignatureScopeKey = homeMailSignatureScopeKey(
    companyID,
    currentUserID,
    compose.sharedInboxID,
    composeSignatureAccountEmail,
  );
  const composeScopeEmailSignature = emailSignatureScopeKey === composeSignatureScopeKey
    ? emailSignature
    : readHomeMailSignature(companyID, currentUserID, compose.sharedInboxID, composeSignatureAccountEmail);
  const composeScopeEmailSignatureID = emailSignatureIDScopeKey === composeSignatureScopeKey
    ? emailSignatureID
    : "";
  useEffect(() => {
    const sharedInboxID = compose.sharedInboxID.trim();
    const accountEmail = composeSignatureAccountEmail.trim();
    if (!compose.open || !companyID.trim() || (!sharedInboxID && !accountEmail)) return undefined;
    const initialBody = readHomeMailSignature(companyID, currentUserID, sharedInboxID, accountEmail);
    let cancelled = false;
    void getEmailSignature(companyID, sharedInboxID, accountEmail)
      .then((signature) => signature ?? saveEmailSignature({
        companyID,
        sharedInboxID,
        accountEmail,
        bodyEditorHTML: initialBody,
      }))
      .then((signature) => {
        if (cancelled) return;
        setEmailSignatureID(signature.signature_id.trim());
        setEmailSignatureIDScopeKey(composeSignatureScopeKey);
      })
      .catch(() => {
        if (cancelled) return;
        setEmailSignatureID("");
        setEmailSignatureIDScopeKey(composeSignatureScopeKey);
      });
    return () => {
      cancelled = true;
    };
  }, [companyID, compose.open, compose.sharedInboxID, composeSignatureAccountEmail, composeSignatureScopeKey, currentUserID]);
  useEffect(() => {
    const localSignature = readHomeMailSignature(companyID, currentUserID, activeSharedInboxFolderID, activeMailAccountEmail);
    setEmailSignature(localSignature);
    setEmailSignatureScopeKey(activeSignatureScopeKey);
    if (!activeSharedInboxFolderID && !activeMailAccountEmail.trim()) return undefined;
    const editRevisionAtLoadStart = emailSignatureEditRevisionRef.current;
    let cancelled = false;
    void loadHomeMailSignature(companyID, currentUserID, activeSharedInboxFolderID, activeMailAccountEmail)
      .then((signature) => {
        if (cancelled || emailSignatureEditRevisionRef.current !== editRevisionAtLoadStart) return;
        setEmailSignature(signature);
        setEmailSignatureScopeKey(activeSignatureScopeKey);
      });
    return () => {
      cancelled = true;
    };
  }, [activeMailAccountEmail, activeSharedInboxFolderID, activeSignatureScopeKey, companyID, currentUserID]);
  useEffect(() => {
    const pending = pendingAutoSignatureRef.current;
    if (!pending) return;
    if (!compose.open || compose.draftID !== pending.draftID) {
      pendingAutoSignatureRef.current = null;
      return;
    }
    if (activeSignatureScopeKey !== pending.scopeKey) {
      const composeSharedInboxID = compose.sharedInboxID.trim();
      const composeAccountEmail = compose.accountEmail.trim().toLowerCase();
      const activeAccountEmail = activeMailAccountEmail.trim().toLowerCase();
      const scopeStillMatches = composeSharedInboxID
        ? composeSharedInboxID === activeSharedInboxFolderID
        : !activeSharedInboxFolderID && (!composeAccountEmail || composeAccountEmail === activeAccountEmail);
      if (!scopeStillMatches) {
        pendingAutoSignatureRef.current = null;
        return;
      }
      pendingAutoSignatureRef.current = { ...pending, scopeKey: activeSignatureScopeKey };
      if (!composeSharedInboxID && !composeAccountEmail && activeAccountEmail) {
        setCompose((current) => current.open && current.draftID === pending.draftID
          ? { ...current, accountEmail: activeMailAccountEmail.trim() }
          : current);
      }
      return;
    }
    if (emailSignatureScopeKey !== pending.scopeKey || !emailSignature.trim()) return;
    pendingAutoSignatureRef.current = null;
    setCompose((current) => {
      if (!current.open || current.draftID !== pending.draftID) return current;
      return { ...current, body: applyHomeMailSignature(current.body, emailSignature) };
    });
  }, [activeMailAccountEmail, activeSharedInboxFolderID, activeSignatureScopeKey, compose.accountEmail, compose.draftID, compose.open, compose.sharedInboxID, emailSignature, emailSignatureScopeKey]);
  const sharedInboxForHomeView = useCallback((viewID: HomeViewID): CommunicationsSharedInbox | null => {
    const sharedInboxID = sharedInboxIDForHomeView(viewID);
    if (!sharedInboxID) return null;
    return sharedInboxesRef.current.find((folder) => folder.folder_id === sharedInboxID || folder.shared_inbox_id === sharedInboxID) ?? null;
  }, []);
  const canLoadMailForView = useCallback((viewID: HomeViewID): boolean => {
    const sharedInboxID = sharedInboxIDForHomeView(viewID);
    if (sharedInboxID) {
      if (sharedInboxEmailConnectionIssue?.folderID === sharedInboxID) return false;
      return sharedInboxCanLoadMail(sharedInboxForHomeView(viewID));
    }
    return (viewID === "my-triage" || viewID === "primary") && status?.connected === true;
  }, [sharedInboxEmailConnectionIssue?.folderID, sharedInboxForHomeView, status?.connected]);
  const sharedInboxPermissionsFolder = useMemo(
    () => sharedInboxPermissionsFolderID ? sharedInboxes.find((folder) => folder.folder_id === sharedInboxPermissionsFolderID) ?? null : null,
    [sharedInboxPermissionsFolderID, sharedInboxes],
  );
  const sharedInboxRACIFolder = useMemo(
    () => sharedInboxRACIFolderID ? sharedInboxes.find((folder) => folder.folder_id === sharedInboxRACIFolderID) ?? null : null,
    [sharedInboxRACIFolderID, sharedInboxes],
  );
  const canMutateCurrentMailView = activeViewID === "shared-root"
    ? sharedInboxTreeUserCanManageMail(sharedInboxes, "", currentUserID, currentUserHasFullSharedInboxAccess)
    : activeSharedInboxFolderID
      ? sharedInboxTreeUserCanManageMail(sharedInboxes, activeSharedInboxFolderID, currentUserID, currentUserHasFullSharedInboxAccess)
      : true;
  const canRepairSharedInboxConnection = useCallback((folderID: string): boolean => {
    if (!currentUserCanManageSharedInboxStructure) return false;
    if (currentUserHasFullSharedInboxAccess) return true;
    const cleanFolderID = folderID.trim();
    if (!cleanFolderID) return false;
    return sharedInboxTreeUserCanManageMail(sharedInboxes, cleanFolderID, currentUserID, false);
  }, [currentUserCanManageSharedInboxStructure, currentUserHasFullSharedInboxAccess, currentUserID, sharedInboxes]);
  const showSharedInboxEmailConnectionIssue = useCallback((folderID: string, accountEmail: string) => {
    const cleanFolderID = folderID.trim();
    const cleanAccountEmail = accountEmail.trim().toLowerCase();
    if (!cleanFolderID || !cleanAccountEmail) return;
    const issue = {
      folderID: cleanFolderID,
      accountEmail: cleanAccountEmail,
      canConnect: canRepairSharedInboxConnection(cleanFolderID),
    };
    setSharedInboxEmailConnectionIssue(issue);
    setSharedInboxEmailConnectionDialog({ accountEmail: issue.accountEmail, canConnect: issue.canConnect });
  }, [canRepairSharedInboxConnection]);
  useEffect(() => {
    if (!notice || notice !== noticeResourceTextRef.current) {
      noticeResourceTextRef.current = "";
      setNoticeResourceAction(null);
    }
  }, [notice]);
  const showNoticeWithResourceAction = useCallback((message: string, action: HomeNoticeResourceAction) => {
    noticeResourceTextRef.current = message;
    setNoticeResourceAction(action);
    setNotice(message);
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timerID = window.setTimeout(() => {
      setNotice((current) => current === notice ? "" : current);
    }, 3_000);
    return () => window.clearTimeout(timerID);
  }, [notice]);
  const addPendingStarredMessages = useCallback((messageIDs: string[], mailboxScopeKey: string) => {
    const pending = pendingStarredMessageIDsRef.current;
    let changed = false;
    for (const messageID of cleanIDList(messageIDs)) {
      const messageKey = homeMailboxPendingMessageKey(mailboxScopeKey, messageID);
      if (!messageKey || pending.has(messageKey)) continue;
      pending.add(messageKey);
      changed = true;
    }
    if (changed && activeEmailMailboxScopeKeyRef.current === mailboxScopeKey) {
      setPendingStarredMessageIDs(homeMailboxPendingMessageIDs(Array.from(pending), mailboxScopeKey));
    }
  }, []);
  const removePendingStarredMessages = useCallback((messageIDs: string[], mailboxScopeKey: string) => {
    const pending = pendingStarredMessageIDsRef.current;
    let changed = false;
    for (const messageID of cleanIDList(messageIDs)) {
      const messageKey = homeMailboxPendingMessageKey(mailboxScopeKey, messageID);
      changed = (!!messageKey && pending.delete(messageKey)) || changed;
    }
    if (changed && activeEmailMailboxScopeKeyRef.current === mailboxScopeKey) {
      setPendingStarredMessageIDs(homeMailboxPendingMessageIDs(Array.from(pending), mailboxScopeKey));
    }
  }, []);
  const cancelPendingStarredMessages = useCallback((messageIDs: string[], mailboxScopeKey: string) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    removePendingStarredMessages(ids, mailboxScopeKey);
  }, [removePendingStarredMessages]);
  useEffect(() => {
    return () => {
      if (archiveQueueFlushTimerRef.current !== null) {
        window.clearTimeout(archiveQueueFlushTimerRef.current);
        archiveQueueFlushTimerRef.current = null;
      }
      for (const timerID of delayedMailRequestTimerIDsRef.current) window.clearTimeout(timerID);
      delayedMailRequestTimerIDsRef.current.clear();
      delayedMarkReadTimerByMessageKeyRef.current.clear();
		queuedArchiveBatchesRef.current.clear();
		activeArchiveJobsRef.current.clear();
      pendingArchiveMessageKeysRef.current.clear();
      pendingStarredMessageIDsRef.current.clear();
    };
  }, []);
  useLayoutEffect(() => {
    selectedMessageIDRef.current = selectedMessageID;
  }, [selectedMessageID]);
  useLayoutEffect(() => {
    selectedMessageRowKeyRef.current = selectedMessageRowKey;
  }, [selectedMessageRowKey]);
  useEffect(() => {
    composeRef.current = compose;
  }, [compose]);
  useLayoutEffect(() => {
    selectedMessageRef.current = selectedMessage;
  }, [selectedMessage]);
  useLayoutEffect(() => {
    activeViewIDRef.current = activeViewID;
  }, [activeViewID]);
  useLayoutEffect(() => {
    messageListOrderRef.current = messageListOrder;
  }, [messageListOrder]);
  useEffect(() => {
    if (!activeSharedInboxFolderID) return;
    if (sharedInboxes.some((folder) => folder.folder_id === activeSharedInboxFolderID)) return;
    if (!sharedInboxesLoaded || loadingSharedInboxes || sharedInboxesRequestInFlightRef.current) return;
    setActiveViewID("shared-root");
  }, [activeSharedInboxFolderID, loadingSharedInboxes, sharedInboxes, sharedInboxesLoaded]);
  useLayoutEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    setSelectedMessageIDs((previous) => {
      const visible = new Set(messages.map((message) => message.id));
      const next = new Set(Array.from(previous).filter((id) => visible.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [messages]);
  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);
  useEffect(() => {
    sharedInboxesRef.current = sharedInboxes;
  }, [sharedInboxes]);
  useLayoutEffect(() => {
    mailboxRef.current = mailbox;
  }, [mailbox]);
  useEffect(() => {
    nextPageTokenRef.current = nextPageToken;
  }, [nextPageToken]);
  useLayoutEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);
  useLayoutEffect(() => {
    unreadOnlyRef.current = unreadOnly;
  }, [unreadOnly]);
  useEffect(() => {
    loadingMessagesRef.current = loadingMessages;
  }, [loadingMessages]);
  useEffect(() => {
    loadingMoreMessagesRef.current = loadingMoreMessages;
  }, [loadingMoreMessages]);
  useEffect(() => {
    columnWidthsRef.current = columnWidths;
  }, [columnWidths]);
  useEffect(() => {
    appSidebarOwnsNavigationRef.current = appSidebarOwnsNavigation;
  }, [appSidebarOwnsNavigation]);
  const setMailboxCountOverride = useCallback((key: string, mailboxKey: HomeMailboxCountOverrideKey, count: number | undefined) => {
    const cleanKey = key.trim();
    if (!cleanKey) return;
    setMailboxCountOverrides((previous) => {
      const currentEntry = previous[cleanKey] ?? {};
      if (count === undefined) {
        if (currentEntry[mailboxKey] === undefined) return previous;
        const restEntry = { ...currentEntry };
        delete restEntry[mailboxKey];
        const next = { ...previous };
        if (Object.keys(restEntry).length > 0) next[cleanKey] = restEntry;
        else delete next[cleanKey];
        return next;
      }
      const nextCount = Math.max(0, Math.floor(count));
      if (currentEntry[mailboxKey] === nextCount) return previous;
      return {
        ...previous,
        [cleanKey]: {
          ...currentEntry,
          [mailboxKey]: nextCount,
        },
      };
    });
  }, []);
  const setPrimaryMailboxCountOverride = useCallback((key: string, count: number | undefined) => {
    setMailboxCountOverride(key, "primary", count);
  }, [setMailboxCountOverride]);
  const setStarredMailboxCountOverride = useCallback((key: string, count: number | undefined) => {
    setMailboxCountOverride(key, "starred", count);
  }, [setMailboxCountOverride]);
  const adjustMailboxCount = useCallback((key: string, mailboxKey: HomeMailboxCountOverrideKey, delta: number, capturedBaseCount?: number) => {
    const cleanKey = key.trim();
    if (!cleanKey || delta === 0) return;
    const baseCount = capturedBaseCount ?? mailboxCountsFromFolders(foldersRef.current)[mailboxKey] ?? 0;
    setMailboxCountOverrides((previous) => applyHomeMailboxCountDelta(previous, cleanKey, mailboxKey, delta, baseCount));
  }, []);
  const adjustPrimaryMailboxCount = useCallback((key: string, delta: number, capturedBaseCount?: number) => {
    adjustMailboxCount(key, "primary", delta, capturedBaseCount);
  }, [adjustMailboxCount]);
  const adjustStarredMailboxCount = useCallback((key: string, delta: number, capturedBaseCount?: number) => {
    adjustMailboxCount(key, "starred", delta, capturedBaseCount);
  }, [adjustMailboxCount]);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    const updateWorkspaceTrackWidth = () => setWorkspaceTrackWidth(getHomeWorkspaceTrackWidth(workspaceRef.current));
    updateWorkspaceTrackWidth();
    const element = workspaceRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWorkspaceTrackWidth);
      return () => window.removeEventListener("resize", updateWorkspaceTrackWidth);
    }
    const observer = new ResizeObserver(updateWorkspaceTrackWidth);
    observer.observe(element);
    window.addEventListener("resize", updateWorkspaceTrackWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateWorkspaceTrackWidth);
    };
  }, [status?.connected]);
  useEffect(() => {
    const finishColumnResize = () => {
      const drag = columnResizeDragRef.current;
      if (!drag) return;
      columnResizeDragRef.current = null;
      drag.ownerDocument.body.style.cursor = drag.previousCursor;
      drag.ownerDocument.body.style.userSelect = drag.previousUserSelect;
      try {
        drag.captureTarget.releasePointerCapture?.(drag.pointerID);
      } catch {}
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = columnResizeDragRef.current;
      if (!drag) return;
      event.preventDefault();
      const delta = event.clientX - drag.startX;
      const activeIsInboxMatrixView = isInboxMatrixViewID(activeViewIDRef.current);
      const nextWidths = appSidebarOwnsNavigationRef.current
        ? activeIsInboxMatrixView
          ? resizeHomeInboxMatrixColumnsWithoutSidebar(drag.startWidths, drag.dividerIndex, delta, drag.availableWidth)
          : resizeHomeColumnsWithoutSidebar(drag.startWidths, drag.dividerIndex, delta, drag.availableWidth)
        : resizeHomeColumns(drag.startWidths, drag.dividerIndex, delta, drag.availableWidth);
      const fittedWidths = activeIsInboxMatrixView
        ? nextWidths
        : fitHomeColumnWidthsToAvailableWidth(nextWidths, drag.availableWidth, !appSidebarOwnsNavigationRef.current);
      columnWidthsRef.current = fittedWidths;
      setColumnWidths(fittedWidths);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishColumnResize);
    window.addEventListener("pointercancel", finishColumnResize);
    window.addEventListener("blur", finishColumnResize);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishColumnResize);
      window.removeEventListener("pointercancel", finishColumnResize);
      window.removeEventListener("blur", finishColumnResize);
      finishColumnResize();
    };
  }, []);
  useEffect(() => {
    if (isNarrow || isInboxMatrixView) return;
    setColumnWidths((current) => {
      const fitted = fitHomeColumnWidthsToAvailableWidth(current, workspaceTrackWidth, !appSidebarOwnsNavigation);
      if (fitted.every((width, index) => width === current[index])) return current;
      columnWidthsRef.current = fitted;
      return fitted;
    });
  }, [appSidebarOwnsNavigation, isInboxMatrixView, isNarrow, workspaceTrackWidth]);
  useEffect(() => {
    if (isNarrow) return;
    saveHomeColumnWidths(columnWidths);
  }, [columnWidths, isNarrow]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("nylas");
    const oauthError = params.get("nylas_error");
    if (connected === "connected") {
      invalidateCommunicationsCache();
      const scope = params.get("nylas_scope")?.trim().toLowerCase() ?? "";
      const accountEmail = params.get("nylas_account_email")?.trim().toLowerCase() ?? "";
      const sharedInboxID = params.get("nylas_shared_inbox_id")?.trim() ?? "";
      if (scope === "shared" && accountEmail) setPendingSharedOAuthAccountEmail(accountEmail);
      if (scope === "shared" && sharedInboxID) setPendingSharedOAuthSharedInboxID(sharedInboxID);
      setNotice(scope === "shared" ? "Shared inbox connected." : "Email connected.");
    }
    if (oauthError) setError(formatErrorCode(oauthError));
    if (connected || oauthError) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const clearSelectedMessageState = useCallback(() => {
    messageSelectionGenerationRef.current += 1;
    selectedMessageRef.current = null;
    selectedMessageIDRef.current = "";
    selectedMessageRowKeyRef.current = "";
    setSelectedMessage(null);
    setSelectedMessageID("");
    setSelectedMessageRowKey("");
    setSelectedMessageIDs(new Set());
    setSelectionAnchorMessageID("");
  }, []);
  const loadStatus = useCallback(async (options: { clearError?: boolean } = {}): Promise<CommunicationsStatus | null> => {
    setLoadingStatus(true);
    if (options.clearError !== false) setError("");
    try {
      const next = await fetchCommunicationsStatus();
      setStatus(next);
      if (!next.connected && !homeViewUsesSharedEmailConnection(activeViewIDRef.current)) {
        if (archiveQueueFlushTimerRef.current !== null) {
          window.clearTimeout(archiveQueueFlushTimerRef.current);
          archiveQueueFlushTimerRef.current = null;
        }
		queuedArchiveBatchesRef.current.clear();
		activeArchiveJobsRef.current.clear();
        pendingArchiveMessageKeysRef.current.clear();
        setQueuedArchiveEmailCount(0);
        pendingStarredMessageIDsRef.current.clear();
        setPendingStarredMessageIDs(new Set());
        setMailboxCountOverrides({});
        setInboxCountFallbacks({});
        setFolders([]);
        setMessages([]);
        clearSelectedMessageState();
        setNextPageToken("");
      }
      return next;
    } catch (statusError) {
      setError(formatError(statusError, "Failed to load email connection"));
      return null;
    } finally {
      setLoadingStatus(false);
    }
  }, [clearSelectedMessageState]);
  const handleEmailAccessExpired = useCallback(async (accessError: unknown) => {
    setNotice("");
    if (archiveQueueFlushTimerRef.current !== null) {
      window.clearTimeout(archiveQueueFlushTimerRef.current);
      archiveQueueFlushTimerRef.current = null;
    }
	queuedArchiveBatchesRef.current.clear();
	activeArchiveJobsRef.current.clear();
    pendingArchiveMessageKeysRef.current.clear();
    setQueuedArchiveEmailCount(0);
    pendingStarredMessageIDsRef.current.clear();
    setPendingStarredMessageIDs(new Set());
    invalidateCommunicationsCache();
    setMailboxCountOverrides({});
    setInboxCountFallbacks({});
    setFolders([]);
    setMessages([]);
    clearSelectedMessageState();
    await loadStatus();
    setError(formatError(accessError, "Email access expired. Disconnect and reconnect your mailbox."));
  }, [clearSelectedMessageState, loadStatus]);
  const currentMessageFilterKey = useCallback(() => (
    messageListFilterKey(
      companyID,
      activeViewIDRef.current,
      mailboxRef.current,
      searchQueryRef.current,
      unreadOnlyRef.current,
      activeEmailMailboxScopeKeyRef.current,
      messageListOrderRef.current,
    )
  ), [companyID]);
  const currentMailboxRequestOwner = useCallback((): HomeMailboxRequestOwner => ({
    requestKey: currentMessageFilterKey(),
    mailboxScopeKey: activeEmailMailboxScopeKeyRef.current,
  }), [currentMessageFilterKey]);
  const mailboxRequestOwnerIsCurrent = useCallback((owner: HomeMailboxRequestOwner): boolean => (
    homeMailboxRequestOwnerIsCurrent(owner, currentMailboxRequestOwner())
  ), [currentMailboxRequestOwner]);
  const currentMailboxFolderOwner = useCallback((): HomeMailboxFolderOwner => ({
    mailboxScopeKey: activeEmailMailboxScopeKeyRef.current,
  }), []);
  const mailboxFolderOwnerIsCurrent = useCallback((owner: HomeMailboxFolderOwner): boolean => (
    homeMailboxFolderOwnerIsCurrent(owner, currentMailboxFolderOwner())
  ), [currentMailboxFolderOwner]);
  const scheduleOwnedMailRequest = useCallback((
    owner: HomeMailboxRequestOwner,
    callback: () => void,
    delayMs = 0,
  ): number | null => {
    if (!mailboxRequestOwnerIsCurrent(owner)) return null;
    const timerID = window.setTimeout(() => {
      delayedMailRequestTimerIDsRef.current.delete(timerID);
      if (mailboxRequestOwnerIsCurrent(owner)) callback();
    }, delayMs);
    delayedMailRequestTimerIDsRef.current.add(timerID);
    return timerID;
  }, [mailboxRequestOwnerIsCurrent]);
  const loadFoldersCanonical = useCallback(async (owner: HomeMailboxFolderOwner, refresh: boolean): Promise<boolean> => {
    if (!mailboxFolderOwnerIsCurrent(owner)) return false;
    const requestViewID = activeViewIDRef.current;
    const sharedInboxID = sharedInboxIDForHomeView(requestViewID);
    const requestAccountEmail = sharedInboxID ? "" : activeMailAccountEmailRef.current;
    const requestStillOwnsMailbox = () => mailboxFolderOwnerIsCurrent(owner);
    if (sharedInboxID) {
      const sharedInbox = sharedInboxes.find((folder) => folder.folder_id === sharedInboxID) ?? null;
      if (!sharedInbox) return false;
      if (sharedInbox.entry_type !== "shared_inbox") {
        setFolders([]);
        return true;
      }
    }
    if (sharedInboxID && sharedInboxes.some((folder) => (folder.parent_folder_id ?? "").trim() === sharedInboxID)) {
      setFolders([]);
      return true;
    }
    const requestSeq = foldersRequestSeqRef.current + 1;
    foldersRequestSeqRef.current = requestSeq;
    try {
      const next = await listEmailFolders({
        companyID,
        sharedInboxID: sharedInboxID || undefined,
        accountEmail: requestAccountEmail || undefined,
        refresh,
      });
      if (foldersRequestSeqRef.current !== requestSeq || !requestStillOwnsMailbox()) return false;
      setFolders(next);
      return true;
    } catch (folderError) {
      if (foldersRequestSeqRef.current !== requestSeq || !requestStillOwnsMailbox()) return false;
      if (sharedInboxID && (isSharedInboxEmailConnectionError(folderError) || isEmailAccessExpiredError(folderError))) {
        const folder = sharedInboxes.find((item) => item.folder_id === sharedInboxID);
        const accountEmail = folder?.account_email?.trim().toLowerCase() ?? "";
        if (accountEmail) {
          showSharedInboxEmailConnectionIssue(sharedInboxID, accountEmail);
          return false;
        }
      }
      if (isEmailAccessExpiredError(folderError)) {
        await handleEmailAccessExpired(folderError);
        return false;
      }
      setError(formatError(folderError, "Failed to load folders"));
      return false;
    }
  }, [companyID, handleEmailAccessExpired, mailboxFolderOwnerIsCurrent, sharedInboxes, showSharedInboxEmailConnectionIssue]);
  useLayoutEffect(() => {
    loadFoldersCanonicalRef.current = loadFoldersCanonical;
  }, [loadFoldersCanonical]);
  const folderLoadCoordinator = useMemo(() => createHomeMailboxFolderLoadCoordinator({
    isOwnerCurrent: mailboxFolderOwnerIsCurrent,
    load: (owner, refresh) => loadFoldersCanonicalRef.current(owner, refresh),
    onError: (cause) => setError(formatError(cause, "Failed to load folders")),
  }), [mailboxFolderOwnerIsCurrent]);
  useEffect(() => () => folderLoadCoordinator.dispose(), [folderLoadCoordinator]);
  const loadFolders = useCallback((options?: { refresh?: boolean; owner?: HomeMailboxFolderOwner }): Promise<boolean> => {
    const owner = options?.owner ?? currentMailboxFolderOwner();
    return folderLoadCoordinator.request(owner, options?.refresh === true);
  }, [currentMailboxFolderOwner, folderLoadCoordinator]);
  useLayoutEffect(() => {
    loadFoldersRef.current = loadFolders;
  }, [loadFolders]);
  useLayoutEffect(() => {
    folderLoadCoordinator.cancelObsolete(currentMailboxFolderOwner());
  }, [activeEmailMailboxScopeKey, currentMailboxFolderOwner, folderLoadCoordinator]);
  const scheduleFolderMetadataRefresh = useCallback((owner = currentMailboxFolderOwner()) => {
    if (!mailboxFolderOwnerIsCurrent(owner)) return;
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    invalidateCommunicationsMailboxCache({
      companyID,
      sharedInboxID: sharedInboxID || undefined,
      accountEmail: sharedInboxID ? undefined : activeMailAccountEmailRef.current,
    }, { folders: true });
    if (folderReloadTimerRef.current !== null) window.clearTimeout(folderReloadTimerRef.current);
    folderReloadTimerRef.current = window.setTimeout(() => {
      folderReloadTimerRef.current = null;
      if (!mailboxFolderOwnerIsCurrent(owner)) return;
      void loadFolders({ owner, refresh: true });
    }, 300);
  }, [companyID, currentMailboxFolderOwner, loadFolders, mailboxFolderOwnerIsCurrent]);
  const loadSharedInboxes = useCallback(async (): Promise<boolean> => {
    if (sharedInboxesRequestInFlightRef.current) return false;
    sharedInboxesRequestInFlightRef.current = true;
    setLoadingSharedInboxes(true);
    try {
      const next = await listCommunicationsSharedInboxes(companyID);
      setSharedInboxes(next);
      setSharedInboxesLoaded(true);
      return true;
    } catch (sharedInboxError) {
      setError(formatError(sharedInboxError, "Failed to load Shared Triage"));
      return false;
    } finally {
      sharedInboxesRequestInFlightRef.current = false;
      setLoadingSharedInboxes(false);
    }
  }, [companyID]);
  const loadCompanyUsers = useCallback(async (): Promise<boolean> => {
    if (!companyID) return false;
    const [usersResult, groupsResult] = await Promise.allSettled([
      listCompanyUsers(companyID),
      listCompanyUserGroups(companyID),
    ]);
    if (usersResult.status === "fulfilled") {
      setCompanyUsers(usersResult.value);
    } else {
      setCompanyUsers([]);
      setError(formatError(usersResult.reason, "Failed to load company users"));
    }
    if (groupsResult.status === "fulfilled") {
      setCompanyUserGroups(groupsResult.value.groups);
      setCompanyUserGroupMembers(groupsResult.value.members);
    } else {
      setCompanyUserGroups([]);
      setCompanyUserGroupMembers([]);
      setError(formatError(groupsResult.reason, "Failed to load company user groups"));
    }
    return usersResult.status === "fulfilled" && groupsResult.status === "fulfilled";
  }, [companyID]);
  const loadLogicGatePanel = useCallback(async (): Promise<boolean> => {
    if (!companyID) return false;
    if (logicGatePanelRequestInFlightRef.current) return false;
    logicGatePanelRequestInFlightRef.current = true;
    setLoadingLogicGates(true);
    setLoadingNodes(true);
    try {
      const titleVersionAtStart = readCommittedEntityTitleVersion();
      const panel = await fetchCommunicationsWorkspacePanel(companyID);
      setLogicGateFolders(panel.logicGateFolders);
      setLogicGateFolderItems(panel.logicGateFolderItems);
      setLogicGates(foldCommittedEntityTitlesSince(
        panel.logicGates, companyID, titleVersionAtStart,
        reconcileCommittedLogicGateRecordTitles,
      ));
      setMyLogicGateShortcuts(sortLogicGateShortcuts(panel.myLogicGateShortcuts));
      setNodeFolders(panel.nodeFolders);
      setNodeFolderItems(panel.nodeFolderItems);
      setNodes(foldCommittedEntityTitlesSince(
        panel.nodes, companyID, titleVersionAtStart,
        reconcileCommittedNodeTitleInSnapshot,
      ));
      setLogicGateExpandedIDs((previous) => {
        const next = new Set(previous);
        for (const folder of panel.logicGateFolders) next.add(`workspace-folder-${folder.folder_id}`);
        return next;
      });
      setNodeExpandedIDs((previous) => {
        const next = new Set(previous);
        for (const folder of panel.nodeFolders) next.add(`workspace-folder-${folder.folder_id}`);
        return next;
      });
      return true;
    } catch (logicGateError) {
      setError(formatError(logicGateError, "Failed to load Home nodes"));
      return false;
    } finally {
      logicGatePanelRequestInFlightRef.current = false;
      setLoadingLogicGates(false);
      setLoadingNodes(false);
    }
  }, [companyID]);
  const refreshNodeRelationshipsForMatrix = useCallback(async (): Promise<boolean> => {
    const cleanCompanyID = companyID.trim();
    nodeRelationshipRequestSeqRef.current += 1;
    const requestSeq = nodeRelationshipRequestSeqRef.current;
    if (!cleanCompanyID || !isInboxMatrixViewID(activeViewIDRef.current)) {
      setNodeRelationships([]);
      return false;
    }
    try {
      const query = new URLSearchParams({ company_id: cleanCompanyID });
      const payload = await requestJSON<{ relationships?: NodeRelationship[] }>(apiBase, `/v1/node-relationships?${query.toString()}`);
      if (nodeRelationshipRequestSeqRef.current === requestSeq && isInboxMatrixViewID(activeViewIDRef.current)) {
        setNodeRelationships(payload.relationships ?? []);
      }
      return true;
    } catch (relationshipError) {
      if (nodeRelationshipRequestSeqRef.current === requestSeq && isInboxMatrixViewID(activeViewIDRef.current)) {
        setError(formatError(relationshipError, "Failed to load node relationships"));
      }
      return false;
    }
  }, [apiBase, companyID]);
  useEffect(() => {
    if (!companyID || !isInboxMatrixView) {
      nodeRelationshipRequestSeqRef.current += 1;
      setNodeRelationships([]);
      return undefined;
    }
    void refreshNodeRelationshipsForMatrix();
    return undefined;
  }, [companyID, isInboxMatrixView, refreshNodeRelationshipsForMatrix]);
  const clearPrefetchedMessagePage = useCallback(() => {
    prefetchMessageGenerationRef.current += 1;
    prefetchedMessagePageRef.current = null;
    prefetchMessageTokenRef.current = "";
    prefetchMessageFilterKeyRef.current = "";
    prefetchMessagePromiseRef.current = null;
  }, []);
  const localTriageConversionMailNetworkIsSuppressed = useCallback((filterKey: string): boolean => {
    const suppression = localTriageConversionMailNetworkSuppressionRef.current;
    if (!suppression) return false;
    if (suppression.expiresAt <= Date.now()) {
      localTriageConversionMailNetworkSuppressionRef.current = null;
      return false;
    }
    return suppression.filterKey === filterKey;
  }, []);
  const suppressLocalTriageConversionMailNetwork = useCallback(() => {
    const filterKey = currentMessageFilterKey();
    if (!filterKey) return;
    localTriageConversionMailNetworkSuppressionRef.current = {
      filterKey,
      expiresAt: Date.now() + LOCAL_TRIAGE_CONVERSION_MAIL_NETWORK_SUPPRESSION_MS,
    };
    const pendingOptions = pendingMessageListRefreshOptionsRef.current;
    const hasCanonicalArrivalRefresh = pendingOptions.refresh;
    if (!hasCanonicalArrivalRefresh) {
      if (messageListRefreshTimerRef.current !== null) {
        window.clearTimeout(messageListRefreshTimerRef.current);
        messageListRefreshTimerRef.current = null;
      }
      pendingMessageListRefreshOptionsRef.current = { requestKey: "", refresh: false };
    }
    clearPrefetchedMessagePage();
  }, [clearPrefetchedMessagePage, currentMessageFilterKey]);
  const scheduleMessageListRefresh = useCallback((delayMs = MESSAGE_EVENT_REFRESH_DELAY_MS, options?: { refresh?: boolean; owner?: HomeMailboxRequestOwner }) => {
    const owner = options?.owner ?? currentMailboxRequestOwner();
    if (!mailboxRequestOwnerIsCurrent(owner)) return;
    if (messageListRefreshTimerRef.current !== null) window.clearTimeout(messageListRefreshTimerRef.current);
    const requestKey = owner.requestKey;
    if (!requestKey) return;
    const pendingOptions = pendingMessageListRefreshOptionsRef.current;
    if (pendingOptions.requestKey !== requestKey) pendingOptions.refresh = false;
    pendingOptions.requestKey = requestKey;
    pendingOptions.refresh = pendingOptions.refresh || options?.refresh === true;
    const runScheduledRefresh = () => {
      messageListRefreshTimerRef.current = null;
      if (!mailboxRequestOwnerIsCurrent(owner) || currentMessageFilterKey() !== requestKey || !canLoadMailForView(activeViewIDRef.current)) {
        pendingMessageListRefreshOptionsRef.current = { requestKey: "", refresh: false };
        return;
      }
      if (localTriageConversionMailNetworkIsSuppressed(requestKey)) {
        const retryDelayMs = Math.max(1, (localTriageConversionMailNetworkSuppressionRef.current?.expiresAt ?? Date.now()) - Date.now() + 1);
        messageListRefreshTimerRef.current = window.setTimeout(runScheduledRefresh, retryDelayMs);
        return;
      }
      const { refresh } = pendingMessageListRefreshOptionsRef.current;
      pendingMessageListRefreshOptionsRef.current = { requestKey: "", refresh: false };
      void loadMessagesRef.current?.({ refresh });
    };
    messageListRefreshTimerRef.current = window.setTimeout(runScheduledRefresh, delayMs);
  }, [canLoadMailForView, currentMailboxRequestOwner, currentMessageFilterKey, localTriageConversionMailNetworkIsSuppressed, mailboxRequestOwnerIsCurrent]);
  const messageListWithinPrefetchDistance = useCallback(() => {
    const list = messageListRef.current;
    if (!list) return false;
    const remaining = messageListRemainingDistance(list);
    return remaining < Math.max(800, list.clientHeight * 2);
  }, []);
  const fillPrimaryTriageVisibleMessagePage = useCallback(async (seedPage: MessagePage, filterKey: string): Promise<MessagePage> => {
    let pageMessages = sortEmailMessagesByDateDescending(seedPage.messages ?? []);
    let nextToken = (seedPage.next_page_token ?? "").trim();
    const seenPageTokens = new Set<string>();
    let additionalPageRequests = 0;

    while (
      nextToken
      && primaryTriageVisibleMessagesForList(pageMessages, messageListOrderRef.current).length < MESSAGE_BATCH_SIZE
      && !seenPageTokens.has(nextToken)
      && additionalPageRequests < PRIMARY_TRIAGE_PAGE_FILL_MAX_REQUESTS
    ) {
      if (
        messageListFilterKeyRef.current !== filterKey
        || !isPrimaryTriageMailbox(activeViewIDRef.current, mailboxRef.current)
        || localTriageConversionMailNetworkIsSuppressed(filterKey)
      ) break;
      seenPageTokens.add(nextToken);
      additionalPageRequests += 1;
      const pageToken = nextToken;
      const page = await listEmailMessages({
        limit: MESSAGE_BATCH_SIZE,
        pageToken,
        mailbox: mailboxRef.current,
        companyID,
        sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
        accountEmail: activeMailAccountEmailRef.current,
        q: searchQueryRef.current,
        unread: unreadOnlyRef.current ? true : undefined,
      });
      if (
        messageListFilterKeyRef.current !== filterKey
        || !isPrimaryTriageMailbox(activeViewIDRef.current, mailboxRef.current)
      ) break;
      pageMessages = mergeEmailMessagePages(pageMessages, page.messages ?? []);
      nextToken = (page.next_page_token ?? "").trim();
    }

    return { messages: pageMessages, next_page_token: nextToken };
  }, [companyID, localTriageConversionMailNetworkIsSuppressed]);
  const clearMailListState = useCallback(() => {
    messageRequestSeqRef.current += 1;
    pendingMessageReloadRef.current = false;
    pendingMessageRefreshRef.current = false;
    if (queuedMessageReloadTimerRef.current !== null) {
      window.clearTimeout(queuedMessageReloadTimerRef.current);
      queuedMessageReloadTimerRef.current = null;
    }
    setLoadedMessageListKey("");
    setMessages([]);
    clearSelectedMessageState();
    setNextPageToken("");
    messageRequestKeyRef.current = "";
    messageListFilterKeyRef.current = "";
    clearPrefetchedMessagePage();
  }, [clearPrefetchedMessagePage, clearSelectedMessageState]);
  const loadMessages = useCallback(async (options: LoadMessagesOptions = {}) => {
    if (queuedMessageReloadTimerRef.current !== null) {
      window.clearTimeout(queuedMessageReloadTimerRef.current);
      queuedMessageReloadTimerRef.current = null;
    }
    const sharedInboxID = sharedInboxIDForHomeView(activeViewID);
    if (sharedInboxID && !activeSharedInbox) {
      messageListFilterKeyRef.current = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly, activeEmailMailboxScopeKey, messageListOrder);
      clearMailListState();
      return;
    }
    if (!canLoadMailForView(activeViewID)) {
      clearMailListState();
      return;
    }
    const requestKey = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly, activeEmailMailboxScopeKey, messageListOrder);
    messageListFilterKeyRef.current = requestKey;
    if (mailbox === "drafts") {
      const currentDraftMessages = draftMessagesRef.current;
      messageRequestKeyRef.current = "";
      setLoadedMessageListKey(requestKey);
      clearPrefetchedMessagePage();
      setLoadingMessages(false);
      setNextPageToken("");
      setMessages(currentDraftMessages);
      const currentSelectedMessageRowKey = selectedMessageRowKeyRef.current;
      const currentSelectionStillVisible = !!currentSelectedMessageRowKey
        && currentDraftMessages.some((message) => emailMessageRowKey(message) === currentSelectedMessageRowKey);
      if (!currentSelectionStillVisible && currentSelectedMessageRowKey) {
        clearSelectedMessageState();
      }
      return;
    }
    if (activeSharedInboxNeedsEmail || activeSharedInboxBlocksEmail) {
      messageListFilterKeyRef.current = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly, activeEmailMailboxScopeKey, messageListOrder);
      clearMailListState();
      return;
    }
    if (localTriageConversionMailNetworkIsSuppressed(requestKey)) {
      scheduleMessageListRefresh(0, { refresh: options.refresh });
      return;
    }
    if (messageRequestKeyRef.current === requestKey) {
      pendingMessageReloadRef.current = true;
      pendingMessageRefreshRef.current = pendingMessageRefreshRef.current || options.refresh === true;
      return;
    }
    messageRequestKeyRef.current = requestKey;
    setLoadedMessageListKey("");
    clearPrefetchedMessagePage();
    const requestSeq = messageRequestSeqRef.current + 1;
    messageRequestSeqRef.current = requestSeq;
    setLoadingMessages(true);
    setError("");
    try {
      const page = await listEmailMessages({
        limit: MESSAGE_BATCH_SIZE,
        order: messageListOrder === "oldest" ? "oldest" : undefined,
        mailbox,
        companyID,
        sharedInboxID,
        accountEmail: activeMailAccountEmail,
        q: searchQuery,
        unread: unreadOnly ? true : undefined,
        refresh: options.refresh,
      });
      if (messageRequestSeqRef.current !== requestSeq) return;
      const visiblePage = isPrimaryTriageMailbox(activeViewID, mailbox)
        ? await fillPrimaryTriageVisibleMessagePage(page, requestKey)
        : page;
      if (messageRequestSeqRef.current !== requestSeq) return;
      const pageMessages = applyLocalReadOverlays(
        visiblePage.messages ?? [],
        locallyReadMessageKeysRef.current,
        activeEmailMailboxScopeKey,
      );
      setMessages(pageMessages);
      setNextPageToken(visiblePage.next_page_token ?? "");
      setLoadedMessageListKey(requestKey);
      const selectableMessages = isPrimaryTriageMailbox(activeViewID, mailbox)
        ? primaryTriageVisibleMessagesForList(pageMessages, messageListOrder)
        : pageMessages;
      const currentSelectedMessageRowKey = selectedMessageRowKeyRef.current;
      const currentSelectionStillVisible = !!currentSelectedMessageRowKey
        && selectableMessages.some((message) => emailMessageRowKey(message) === currentSelectedMessageRowKey);
      if (!currentSelectionStillVisible && isTriageMailViewID(activeViewID) && selectableMessages.length > 0) {
        const firstMessage = selectableMessages[0];
        const firstMessageRowKey = emailMessageRowKey(firstMessage);
        messageSelectionGenerationRef.current += 1;
        selectedMessageIDRef.current = firstMessage.id;
        selectedMessageRowKeyRef.current = firstMessageRowKey;
        selectedMessageRef.current = firstMessage;
        setSelectedMessageID(firstMessage.id);
        setSelectedMessageRowKey(firstMessageRowKey);
        setSelectedMessageIDs(new Set([firstMessageRowKey]));
        setSelectionAnchorMessageID(firstMessageRowKey);
        setSelectedMessage(firstMessage);
      } else if (!currentSelectionStillVisible && currentSelectedMessageRowKey) {
        clearSelectedMessageState();
      }
    } catch (messageError) {
      if (messageRequestSeqRef.current === requestSeq) {
        if (activeSharedInboxFolderID && activeSharedInbox?.account_email && (isSharedInboxEmailConnectionError(messageError) || isEmailAccessExpiredError(messageError))) {
          showSharedInboxEmailConnectionIssue(activeSharedInboxFolderID, activeSharedInbox.account_email);
          setMessages([]);
          setNextPageToken("");
          return;
        }
        if (isEmailAccessExpiredError(messageError)) {
          await handleEmailAccessExpired(messageError);
          return;
        }
        setError(formatError(messageError, "Failed to load messages"));
      }
    } finally {
      if (messageRequestSeqRef.current === requestSeq) {
        setLoadingMessages(false);
        messageRequestKeyRef.current = "";
        if (pendingMessageReloadRef.current) {
          const refresh = pendingMessageRefreshRef.current;
          const queuedRequestKey = requestKey;
          pendingMessageReloadRef.current = false;
          pendingMessageRefreshRef.current = false;
          queuedMessageReloadTimerRef.current = window.setTimeout(() => {
            queuedMessageReloadTimerRef.current = null;
            if (currentMessageFilterKey() !== queuedRequestKey) return;
            void loadMessagesRef.current?.({ refresh });
          }, 0);
        }
      }
    }
  }, [activeEmailMailboxScopeKey, activeMailAccountEmail, activeSharedInbox, activeSharedInboxBlocksEmail, activeSharedInboxFolderID, activeSharedInboxNeedsEmail, activeViewID, canLoadMailForView, clearMailListState, clearPrefetchedMessagePage, clearSelectedMessageState, companyID, fillPrimaryTriageVisibleMessagePage, handleEmailAccessExpired, localTriageConversionMailNetworkIsSuppressed, mailbox, messageListOrder, scheduleMessageListRefresh, searchQuery, sharedInboxes, showSharedInboxEmailConnectionIssue, unreadOnly]);
  useEffect(() => {
    const sharedInboxID = pendingSharedInboxMessageRefreshID.trim();
    if (!sharedInboxID) return;
    if (sharedInboxIDForHomeView(activeViewID) !== sharedInboxID || mailbox !== "primary") return;
    const folder = sharedInboxes.find((item) => item.folder_id === sharedInboxID || item.shared_inbox_id === sharedInboxID);
    if (!folder || folder.entry_type !== "shared_inbox" || !(folder.account_email ?? "").trim()) return;
    setPendingSharedInboxMessageRefreshID("");
    invalidateCommunicationsMailboxCache({ companyID, sharedInboxID }, { folders: true, messagePages: true });
    void loadFolders({ refresh: true });
    void loadMessages({ refresh: true });
  }, [activeViewID, loadFolders, loadMessages, mailbox, pendingSharedInboxMessageRefreshID, sharedInboxes]);
  const consumePrefetchedMessagePage = useCallback((filterKey: string, pageToken: string): MessagePage | null => {
    const prefetched = prefetchedMessagePageRef.current;
    if (!prefetched || prefetched.filterKey !== filterKey || prefetched.pageToken !== pageToken) return null;
    prefetchedMessagePageRef.current = null;
    prefetchMessageTokenRef.current = "";
    prefetchMessageFilterKeyRef.current = "";
    prefetchMessagePromiseRef.current = null;
    return prefetched.page;
  }, []);
  const appendPrefetchedMessagePage = useCallback((filterKey: string, pageToken: string): string | null => {
    const page = consumePrefetchedMessagePage(filterKey, pageToken);
    if (!page) return null;
    setMessages((previous) => {
      const seen = new Set(previous.map((message) => message.id));
      const next = [...previous];
      for (const message of applyLocalReadOverlays(page.messages ?? [], locallyReadMessageKeysRef.current, activeEmailMailboxScopeKey)) {
        if (!message.id || seen.has(message.id)) continue;
        seen.add(message.id);
        next.push(message);
      }
      return sortEmailMessagesByDateDescending(next);
    });
    setNextPageToken(page.next_page_token ?? "");
    return page.next_page_token ?? "";
  }, [activeEmailMailboxScopeKey, consumePrefetchedMessagePage]);
  const prefetchNextMessagePage = useCallback(async (explicitPageToken?: string) => {
    if (!canLoadMailForView(activeViewIDRef.current) || mailboxRef.current === "drafts" || loadingMessagesRef.current) return;
    const owner = currentMailboxRequestOwner();
    if (!mailboxRequestOwnerIsCurrent(owner)) return;
    const pageToken = (explicitPageToken ?? nextPageTokenRef.current).trim();
    if (!pageToken) return;
    const filterKey = currentMessageFilterKey();
    if (localTriageConversionMailNetworkIsSuppressed(filterKey)) return;
    const prefetched = prefetchedMessagePageRef.current;
    if (prefetched?.filterKey === filterKey && prefetched.pageToken === pageToken) return;
    if (prefetchMessagePromiseRef.current && prefetchMessageFilterKeyRef.current === filterKey && prefetchMessageTokenRef.current === pageToken) return;
    const requestGeneration = prefetchMessageGenerationRef.current;
    const requestMailbox = mailboxRef.current;
    const requestSharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    const requestAccountEmail = requestSharedInboxID ? undefined : activeMailAccountEmailRef.current;
    const requestQuery = searchQueryRef.current;
    const requestUnread = unreadOnlyRef.current ? true : undefined;
    prefetchMessageFilterKeyRef.current = filterKey;
    prefetchMessageTokenRef.current = pageToken;
    const request = listEmailMessages({
      limit: MESSAGE_BATCH_SIZE,
      pageToken,
      mailbox: requestMailbox,
      companyID,
      sharedInboxID: requestSharedInboxID,
      accountEmail: requestAccountEmail,
      q: requestQuery,
      unread: requestUnread,
    })
      .then(async (page) => {
        if (!mailboxRequestOwnerIsCurrent(owner)) return;
        const preparedPage = isPrimaryTriageMailbox(activeViewIDRef.current, mailboxRef.current)
          ? await fillPrimaryTriageVisibleMessagePage(page, filterKey)
          : page;
        if (prefetchMessageGenerationRef.current !== requestGeneration) return;
        if (!mailboxRequestOwnerIsCurrent(owner)) return;
        if (localTriageConversionMailNetworkIsSuppressed(filterKey)) return;
        if (messageListFilterKeyRef.current !== filterKey || nextPageTokenRef.current !== pageToken) return;
        prefetchedMessagePageRef.current = { filterKey, pageToken, page: preparedPage };
      })
      .catch((messageError) => {
        if (prefetchMessageGenerationRef.current === requestGeneration && mailboxRequestOwnerIsCurrent(owner) && isEmailAccessExpiredError(messageError)) {
          void handleEmailAccessExpired(messageError);
        }
      })
      .finally(() => {
        if (prefetchMessagePromiseRef.current === request) {
          prefetchMessagePromiseRef.current = null;
          prefetchMessageTokenRef.current = "";
          prefetchMessageFilterKeyRef.current = "";
        }
      });
    prefetchMessagePromiseRef.current = request;
    await request;
  }, [canLoadMailForView, companyID, currentMailboxRequestOwner, currentMessageFilterKey, fillPrimaryTriageVisibleMessagePage, handleEmailAccessExpired, localTriageConversionMailNetworkIsSuppressed, mailboxRequestOwnerIsCurrent]);
  const loadMoreMessages = useCallback(async () => {
    if (!canLoadMailForView(activeViewIDRef.current) || mailboxRef.current === "drafts" || loadingMessagesRef.current || loadingMoreMessagesRef.current) return;
    const owner = currentMailboxRequestOwner();
    if (!mailboxRequestOwnerIsCurrent(owner)) return;
    if (isPrimaryTriageMailbox(activeViewIDRef.current, mailboxRef.current)) return;
    const pageToken = nextPageTokenRef.current.trim();
    if (!pageToken) return;
    const filterKey = currentMessageFilterKey();
    if (localTriageConversionMailNetworkIsSuppressed(filterKey)) return;
    const appendedNextPageToken = appendPrefetchedMessagePage(filterKey, pageToken);
    if (appendedNextPageToken !== null) {
      scheduleOwnedMailRequest(owner, () => {
        if (appendedNextPageToken && messageListWithinPrefetchDistance()) void prefetchNextMessagePage(appendedNextPageToken);
      }, 0);
      return;
    }
    const requestMailbox = mailboxRef.current;
    const requestSharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    const requestAccountEmail = requestSharedInboxID ? undefined : activeMailAccountEmailRef.current;
    const requestQuery = searchQueryRef.current;
    const requestUnread = unreadOnlyRef.current ? true : undefined;
    loadingMoreMessagesRef.current = true;
    setLoadingMoreMessages(true);
    setError("");
    try {
      if (prefetchMessagePromiseRef.current && prefetchMessageFilterKeyRef.current === filterKey && prefetchMessageTokenRef.current === pageToken) {
        await prefetchMessagePromiseRef.current;
        if (!mailboxRequestOwnerIsCurrent(owner)) return;
        const prefetchedNextPageToken = appendPrefetchedMessagePage(filterKey, pageToken);
        if (prefetchedNextPageToken !== null) {
          scheduleOwnedMailRequest(owner, () => {
            if (prefetchedNextPageToken && messageListWithinPrefetchDistance()) void prefetchNextMessagePage(prefetchedNextPageToken);
          }, 0);
          return;
        }
      }
      const page = await listEmailMessages({
        limit: MESSAGE_BATCH_SIZE,
        pageToken,
        mailbox: requestMailbox,
        companyID,
        sharedInboxID: requestSharedInboxID,
        accountEmail: requestAccountEmail,
        q: requestQuery,
        unread: requestUnread,
      });
      if (!mailboxRequestOwnerIsCurrent(owner) || messageListFilterKeyRef.current !== filterKey || nextPageTokenRef.current !== pageToken) return;
      setMessages((previous) => {
        const seen = new Set(previous.map((message) => message.id));
        const next = [...previous];
        for (const message of applyLocalReadOverlays(page.messages ?? [], locallyReadMessageKeysRef.current, activeEmailMailboxScopeKey)) {
          if (!message.id || seen.has(message.id)) continue;
          seen.add(message.id);
          next.push(message);
        }
        return sortEmailMessagesByDateDescending(next);
      });
      setNextPageToken(page.next_page_token ?? "");
      scheduleOwnedMailRequest(owner, () => {
        const nextToken = page.next_page_token ?? "";
        if (nextToken && messageListWithinPrefetchDistance()) void prefetchNextMessagePage(nextToken);
      }, 0);
    } catch (messageError) {
      if (!mailboxRequestOwnerIsCurrent(owner)) return;
      if (activeSharedInboxFolderID && activeSharedInbox?.account_email && (isSharedInboxEmailConnectionError(messageError) || isEmailAccessExpiredError(messageError))) {
        showSharedInboxEmailConnectionIssue(activeSharedInboxFolderID, activeSharedInbox.account_email);
        return;
      }
      if (isEmailAccessExpiredError(messageError)) {
        await handleEmailAccessExpired(messageError);
        return;
      }
      setError(formatError(messageError, "Failed to load messages"));
    } finally {
      if (mailboxRequestOwnerIsCurrent(owner)) {
        loadingMoreMessagesRef.current = false;
        setLoadingMoreMessages(false);
      }
    }
  }, [activeEmailMailboxScopeKey, activeSharedInbox, activeSharedInboxFolderID, appendPrefetchedMessagePage, canLoadMailForView, companyID, currentMailboxRequestOwner, currentMessageFilterKey, handleEmailAccessExpired, localTriageConversionMailNetworkIsSuppressed, mailboxRequestOwnerIsCurrent, messageListWithinPrefetchDistance, prefetchNextMessagePage, scheduleOwnedMailRequest, showSharedInboxEmailConnectionIssue]);
  const replaceVisibleMessagesForAdvance = useCallback((page: MessagePage, owner: HomeMailboxRequestOwner) => {
    if (!mailboxRequestOwnerIsCurrent(owner)) return;
    const navigableSharedInboxIDs = new Set(sharedInboxes
      .filter((inbox) => inbox.entry_type === "shared_inbox" && sharedInboxCanLoadMail(inbox))
      .map((inbox) => inbox.folder_id.trim())
      .filter(Boolean));
    const pageMessages = applyLocalReadOverlays(mergeEmailCollaborationsForView(
      page.messages ?? [],
      emailCollaborations,
      activeViewIDRef.current,
      navigableSharedInboxIDs,
      activeMailAccountEmail,
      owner.mailboxScopeKey,
      currentUserID,
    ), locallyReadMessageKeysRef.current, owner.mailboxScopeKey);
    const firstMessage = primaryTriageVisibleMessagesForList(pageMessages, messageListOrderRef.current)[0] ?? pageMessages[0] ?? null;
    const firstMessageRowKey = firstMessage ? emailMessageRowKey(firstMessage) : "";
    messagesRef.current = pageMessages;
    nextPageTokenRef.current = page.next_page_token ?? "";
    selectedMessageIDRef.current = firstMessage?.id ?? "";
    selectedMessageRowKeyRef.current = firstMessageRowKey;
    selectedMessageRef.current = firstMessage;
    messageSelectionGenerationRef.current += 1;
    setMessages(pageMessages);
    setNextPageToken(page.next_page_token ?? "");
    setSelectedMessageIDs(firstMessage ? new Set([firstMessageRowKey]) : new Set());
    setSelectionAnchorMessageID(firstMessageRowKey);
    setSelectedMessageID(firstMessage?.id ?? "");
    setSelectedMessageRowKey(firstMessageRowKey);
    setSelectedMessage(firstMessage);
    setMessageContextMenu(null);
    scheduleOwnedMailRequest(owner, () => {
      messageListRef.current?.scrollTo({ top: 0 });
    }, 0);
  }, [activeMailAccountEmail, currentUserID, emailCollaborations, mailboxRequestOwnerIsCurrent, scheduleOwnedMailRequest, sharedInboxes]);
  useEffect(() => {
    loadMessagesRef.current = loadMessages;
  }, [loadMessages]);
  const mailboxRealtimeTarget = useMemo(() => selectHomeMailboxRealtimeTarget({
    companyID,
    userID: currentUserID,
    accountEmail: activeMailAccountEmail,
    viewID: activeViewID,
    mailbox,
    mailBearing: activeMailViewHasEmailConnection,
    sharedInbox: activeSharedInboxFolderID
      ? { id: activeSharedInboxFolderID, mailBearing: activeMailViewHasEmailConnection }
      : null,
  }), [activeMailAccountEmail, activeMailViewHasEmailConnection, activeSharedInboxFolderID, activeViewID, companyID, currentUserID, mailbox]);
  const mailboxRealtimeSubscriptionKey = homeMailboxRealtimeTargetKey(mailboxRealtimeTarget);
  useLayoutEffect(() => {
    mailboxRealtimeTargetRef.current = mailboxRealtimeTarget;
  }, [mailboxRealtimeTarget]);
  const rememberLocalMailboxMutationEchoes = useCallback((trigger: string, messageIDs: string[], scope = mailboxRealtimeTargetRef.current?.scope ?? "") => {
    rememberHomeMailboxLocalMutationEchoes(localMailboxMutationEchoesRef.current, scope, trigger, messageIDs);
  }, []);
  const forgetLocalMailboxMutationEchoes = useCallback((trigger: string, messageIDs: string[], scope = mailboxRealtimeTargetRef.current?.scope ?? "") => {
    forgetHomeMailboxLocalMutationEchoes(localMailboxMutationEchoesRef.current, scope, trigger, messageIDs);
  }, []);
  useEffect(() => {
    const subscribedTarget = mailboxRealtimeTargetRef.current;
    if (!subscribedTarget || homeMailboxRealtimeTargetKey(subscribedTarget) !== mailboxRealtimeSubscriptionKey) return undefined;
    const subscribedMailboxScopeKey = activeEmailMailboxScopeKeyRef.current;
    const coordinator = createHomeMailboxRealtimeCoordinator({
      target: subscribedTarget,
      getRequestKey: currentMessageFilterKey,
      getSelection: () => ({
        messageID: selectedMessageIDRef.current,
        threadID: selectedMessageRef.current?.thread_id,
      }),
      isRequestCurrent: (requestKey) => requestKey === currentMessageFilterKey(),
      isLocalMutationEcho: (signal) => consumeHomeMailboxLocalMutationEcho(localMailboxMutationEchoesRef.current, signal),
      invalidate: (change) => {
        const trigger = change?.trigger.trim().toLowerCase() ?? "";
        const receiptOnly = trigger === "message.opened";
        if (!receiptOnly) {
          const folderOnly = trigger.startsWith("folder.");
          const mailboxScope = {
            companyID: subscribedTarget.companyID,
            sharedInboxID: subscribedTarget.sharedInboxID || undefined,
            accountEmail: subscribedTarget.sharedInboxID ? undefined : subscribedTarget.accountEmail,
          };
          if (change?.message_id) {
            settleCommunicationsMailboxMessageOverlays(mailboxScope, change.message_id);
          }
          invalidateCommunicationsMailboxCache(mailboxScope, { folders: true, messagePages: !folderOnly });
        }
        if (change?.message_id) {
          invalidateEmailMessageCache(
            change.message_id,
            subscribedTarget.companyID,
            subscribedTarget.sharedInboxID || undefined,
            subscribedTarget.sharedInboxID ? undefined : subscribedTarget.accountEmail,
          );
        }
        if (change?.thread_id) {
          invalidateEmailThreadCache(
            change.thread_id,
            subscribedTarget.companyID,
            subscribedTarget.sharedInboxID || undefined,
            subscribedTarget.sharedInboxID ? undefined : subscribedTarget.accountEmail,
          );
        }
      },
      reconcile: async (plan) => {
        const reads: Array<Promise<unknown>> = [];
        if (plan.messages) {
          const messageRead = loadMessagesRef.current?.({ refresh: true });
          if (messageRead) reads.push(messageRead);
        }
        if (plan.folders) {
          const folderRead = loadFoldersRef.current?.({
            owner: { mailboxScopeKey: subscribedMailboxScopeKey },
            refresh: true,
          });
          if (folderRead) reads.push(folderRead);
        }
        if (plan.selectedDetail) {
          setSelectedMailDetailRealtimeRevision((revision) => revision + 1);
        }
        await Promise.all(reads);
      },
    });
		const onMailboxChanged = (change: {
      scope: string;
      trigger: string;
      message_id?: string;
      thread_id?: string;
      shared_inbox_id?: string;
		}) => {
			coordinator.changed(change);
			refreshArchiveJobsRef.current();
		};
    const unsubscribe = subscribeRealtimeScope(apiBase, subscribedTarget.companyID, subscribedTarget.scope, {
      onAccepted: () => {
        coordinator.accepted();
        refreshArchiveJobsRef.current();
      },
      onMailboxMessageChanged: onMailboxChanged,
      onMailboxFolderChanged: onMailboxChanged,
    });
    return () => {
      coordinator.dispose();
      unsubscribe();
    };
  }, [apiBase, currentMessageFilterKey, mailboxRealtimeSubscriptionKey]);
  const archiveQueueBatchKey = useCallback((nextCompanyID: string, sharedInboxID?: string, accountEmail?: string) => (
    `${nextCompanyID.trim()}\x1f${sharedInboxID?.trim() ?? ""}\x1f${sharedInboxID?.trim() ? "" : accountEmail?.trim().toLowerCase() ?? ""}`
  ), []);
  const archiveQueueMessageKey = useCallback((nextCompanyID: string, sharedInboxID: string | undefined, accountEmail: string | undefined, messageID: string) => (
    `${archiveQueueBatchKey(nextCompanyID, sharedInboxID, accountEmail)}\x1f${messageID.trim()}`
  ), [archiveQueueBatchKey]);
  const syncQueuedArchiveEmailCount = useCallback(() => {
    setQueuedArchiveEmailCount(pendingArchiveMessageKeysRef.current.size);
  }, []);
  const forgetPendingArchiveMessages = useCallback((args: { companyID: string; sharedInboxID?: string; accountEmail?: string; messageIDs: string[] }) => {
    const sharedInboxID = args.sharedInboxID?.trim() || undefined;
    const accountEmail = sharedInboxID ? undefined : args.accountEmail?.trim().toLowerCase() || undefined;
    let changed = false;
    for (const messageID of cleanIDList(args.messageIDs)) {
      changed = pendingArchiveMessageKeysRef.current.delete(archiveQueueMessageKey(args.companyID, sharedInboxID, accountEmail, messageID)) || changed;
    }
    if (changed) syncQueuedArchiveEmailCount();
  }, [archiveQueueMessageKey, syncQueuedArchiveEmailCount]);
	const refreshActiveArchiveJobs = useCallback(async () => {
		for (const [jobID, batch] of Array.from(activeArchiveJobsRef.current.entries())) {
			let job: CommunicationsArchiveJob;
			try {
				job = await getCommunicationsArchiveJob(jobID);
			} catch {
				continue;
			}
			if (job.status === "pending" || job.status === "processing") continue;
			activeArchiveJobsRef.current.delete(jobID);
			forgetPendingArchiveMessages(batch);
			const failed = job.items.filter((item) => item.status === "failed");
			if (failed.length > 0 && mailboxRequestOwnerIsCurrent(batch.owner)) {
				setError(failed.length === 1 ? "Failed to archive 1 message." : `Failed to archive ${failed.length} messages.`);
				scheduleMessageListRefresh(0, { owner: batch.owner });
			}
			scheduleFolderMetadataRefresh({ mailboxScopeKey: batch.owner.mailboxScopeKey });
		}
	}, [forgetPendingArchiveMessages, mailboxRequestOwnerIsCurrent, scheduleFolderMetadataRefresh, scheduleMessageListRefresh]);
	refreshArchiveJobsRef.current = () => { void refreshActiveArchiveJobs(); };
  const archiveQueueCanAccept = useCallback((messageIDs: string[], nextCompanyID: string, sharedInboxID?: string, accountEmail?: string) => {
    const pending = pendingArchiveMessageKeysRef.current;
    let newCount = 0;
    for (const messageID of cleanIDList(messageIDs)) {
      if (!pending.has(archiveQueueMessageKey(nextCompanyID, sharedInboxID, accountEmail, messageID))) newCount++;
    }
    return pending.size + newCount <= ARCHIVE_QUEUE_MAX_EMAILS;
  }, [archiveQueueMessageKey]);
  const flushQueuedArchiveMessages = useCallback(() => {
    if (archiveQueueFlushTimerRef.current !== null) {
      window.clearTimeout(archiveQueueFlushTimerRef.current);
      archiveQueueFlushTimerRef.current = null;
    }
    const batches = Array.from(queuedArchiveBatchesRef.current.values())
      .map((batch) => ({ ...batch, messageIDs: cleanIDList(batch.messageIDs) }))
      .filter((batch) => batch.messageIDs.length > 0);
    queuedArchiveBatchesRef.current.clear();
    if (batches.length === 0) return;
    for (const batch of batches) {
      let keepPendingUntilConfirmation = false;
      rememberLocalMailboxMutationEchoes("message.updated", batch.messageIDs, batch.realtimeScope);
      void archiveHomeMailMessagesCommand({
        companyID: batch.companyID,
        sharedInboxID: batch.sharedInboxID,
        accountEmail: batch.accountEmail,
        messageIDs: batch.messageIDs,
      })
        .then((result) => {
			keepPendingUntilConfirmation = Boolean(result?.archiveJob.job_id);
			if (result?.archiveJob.job_id) {
				activeArchiveJobsRef.current.set(result.archiveJob.job_id, batch);
				void refreshActiveArchiveJobs();
			}
        })
        .catch((archiveError) => {
          forgetLocalMailboxMutationEchoes("message.updated", batch.messageIDs, batch.realtimeScope);
          if (!mailboxRequestOwnerIsCurrent(batch.owner)) return;
          if (isEmailAccessExpiredError(archiveError)) {
            void handleEmailAccessExpired(archiveError);
            return;
          }
          setError(formatError(archiveError, "Failed to archive queued messages"));
          scheduleMessageListRefresh(0, { owner: batch.owner });
        })
        .finally(() => {
          if (!keepPendingUntilConfirmation) forgetPendingArchiveMessages(batch);
          if (!keepPendingUntilConfirmation) scheduleFolderMetadataRefresh({ mailboxScopeKey: batch.owner.mailboxScopeKey });
        });
    }
	}, [forgetLocalMailboxMutationEchoes, forgetPendingArchiveMessages, handleEmailAccessExpired, mailboxRequestOwnerIsCurrent, refreshActiveArchiveJobs, rememberLocalMailboxMutationEchoes, scheduleFolderMetadataRefresh, scheduleMessageListRefresh]);
  const queueArchiveMessages = useCallback((args: { companyID: string; sharedInboxID?: string; accountEmail?: string; messageIDs: string[]; owner?: HomeMailboxRequestOwner }): string[] => {
    const messageIDs = cleanIDList(args.messageIDs);
    if (messageIDs.length === 0) return [];
    const owner = args.owner ?? currentMailboxRequestOwner();
    if (!mailboxRequestOwnerIsCurrent(owner)) return [];
    const sharedInboxID = args.sharedInboxID?.trim() || undefined;
    const accountEmail = sharedInboxID ? undefined : args.accountEmail?.trim().toLowerCase() || undefined;
    const batchKey = `${archiveQueueBatchKey(args.companyID, sharedInboxID, accountEmail)}\x1f${owner.requestKey}\x1f${owner.mailboxScopeKey}`;
    const realtimeScope = mailboxRealtimeTargetRef.current?.scope ?? "";
    const batch = queuedArchiveBatchesRef.current.get(batchKey) ?? { companyID: args.companyID, sharedInboxID, accountEmail, messageIDs: [], owner, realtimeScope };
    const queuedIDs: string[] = [];
    for (const messageID of messageIDs) {
      const messageKey = archiveQueueMessageKey(args.companyID, sharedInboxID, accountEmail, messageID);
      if (pendingArchiveMessageKeysRef.current.has(messageKey)) continue;
      pendingArchiveMessageKeysRef.current.add(messageKey);
      batch.messageIDs.push(messageID);
      queuedIDs.push(messageID);
    }
    if (batch.messageIDs.length > 0) queuedArchiveBatchesRef.current.set(batchKey, batch);
    if (queuedIDs.length === 0) return [];
    syncQueuedArchiveEmailCount();
    if (archiveQueueFlushTimerRef.current === null) {
      archiveQueueFlushTimerRef.current = window.setTimeout(() => {
        archiveQueueFlushTimerRef.current = null;
        flushQueuedArchiveMessages();
      }, 0);
    }
    return queuedIDs;
  }, [archiveQueueBatchKey, archiveQueueMessageKey, currentMailboxRequestOwner, flushQueuedArchiveMessages, mailboxRequestOwnerIsCurrent, syncQueuedArchiveEmailCount]);
  const advanceTriageMailPage = useCallback(async () => {
    if (!canMutateCurrentMailView || !activeMailViewHasEmailConnection || loadingMessagesRef.current || loadingMoreMessagesRef.current || busy) return;
    if (!isPrimaryTriageMailbox(activeViewIDRef.current, mailboxRef.current)) return;
    const owner = currentMailboxRequestOwner();
    if (!mailboxRequestOwnerIsCurrent(owner)) return;
    const providerMessages = messagesRef.current.filter((message) => emailMessageUsesActiveProviderScope(
      message,
      activeViewIDRef.current,
      currentUserID,
      activeMailAccountEmail,
    ));
    const previousMessageIDs = primaryTriageVisibleRawMessageIDs(providerMessages, messageListOrderRef.current);
    if (previousMessageIDs.length === 0) return;
    const countKey = homeMailboxCountKey(owner.mailboxScopeKey);
    const primaryCountAtStart = mailboxCountsFromFolders(foldersRef.current).primary ?? 0;
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current) || undefined;
    const accountEmail = sharedInboxID ? undefined : activeMailAccountEmailRef.current;
    if (!archiveQueueCanAccept(previousMessageIDs, companyID, sharedInboxID, accountEmail)) return;
    const pageToken = nextPageTokenRef.current.trim();
    const filterKey = currentMessageFilterKey();
    let displayedNextPage = false;
    loadingMoreMessagesRef.current = true;
    setError("");
    setNotice("");
    try {
      const archivedIDSet = new Set(previousMessageIDs);
      const remainingMessages = providerMessages.filter((message) => !archivedIDSet.has(message.id.trim()));
      if (pageToken && primaryTriageVisibleMessagesForList(remainingMessages, messageListOrderRef.current).length < MESSAGE_BATCH_SIZE) setLoadingMoreMessages(true);
      let prefetchedPage = consumePrefetchedMessagePage(filterKey, pageToken);
      const matchingPrefetch = !prefetchedPage
        && prefetchMessagePromiseRef.current
        && prefetchMessageFilterKeyRef.current === filterKey
        && prefetchMessageTokenRef.current === pageToken
        ? prefetchMessagePromiseRef.current
        : null;
      if (matchingPrefetch) {
        await matchingPrefetch;
        if (!mailboxRequestOwnerIsCurrent(owner)) return;
        prefetchedPage = consumePrefetchedMessagePage(filterKey, pageToken);
      }
      const seedPage = prefetchedPage ? {
        messages: mergeEmailMessagePages(remainingMessages, prefetchedPage.messages ?? []),
        next_page_token: prefetchedPage.next_page_token ?? "",
      } : {
        messages: remainingMessages,
        next_page_token: pageToken,
      };
      const nextPage = await fillPrimaryTriageVisibleMessagePage(seedPage, filterKey);
      if (!mailboxRequestOwnerIsCurrent(owner) || messageListFilterKeyRef.current !== filterKey || !isPrimaryTriageMailbox(activeViewIDRef.current, mailboxRef.current)) return;
      replaceVisibleMessagesForAdvance(nextPage, owner);
      displayedNextPage = true;
      const nextToken = nextPage.next_page_token ?? "";
      if (nextToken) {
        scheduleOwnedMailRequest(owner, () => {
          void prefetchNextMessagePage(nextToken);
        });
      }
      const queuedIDs = queueArchiveMessages({ companyID, sharedInboxID, accountEmail, messageIDs: previousMessageIDs, owner });
      adjustPrimaryMailboxCount(countKey, -queuedIDs.length, primaryCountAtStart);
    } catch (advanceError) {
      if (!mailboxRequestOwnerIsCurrent(owner)) return;
      if (isEmailAccessExpiredError(advanceError)) {
        await handleEmailAccessExpired(advanceError);
        return;
      }
      setError(formatError(advanceError, displayedNextPage ? "Failed to archive page" : "Failed to load next page"));
      if (displayedNextPage) scheduleMessageListRefresh(0, { owner });
    } finally {
      if (mailboxRequestOwnerIsCurrent(owner)) {
        loadingMoreMessagesRef.current = false;
        setLoadingMoreMessages(false);
      }
    }
  }, [activeMailAccountEmail, activeMailViewHasEmailConnection, adjustPrimaryMailboxCount, archiveQueueCanAccept, busy, canMutateCurrentMailView, companyID, consumePrefetchedMessagePage, currentMailboxRequestOwner, currentMessageFilterKey, currentUserID, fillPrimaryTriageVisibleMessagePage, handleEmailAccessExpired, mailboxRequestOwnerIsCurrent, prefetchNextMessagePage, queueArchiveMessages, replaceVisibleMessagesForAdvance, scheduleMessageListRefresh, scheduleOwnedMailRequest]);
  const fillMessageListAfterRemoval = useCallback(() => {
    const owner = currentMailboxRequestOwner();
    scheduleOwnedMailRequest(owner, () => {
      const list = messageListRef.current;
      if (!list || !nextPageTokenRef.current) return;
      if (!canLoadMailForView(activeViewIDRef.current)) return;
      if (localTriageConversionMailNetworkIsSuppressed(currentMessageFilterKey())) return;
      if (isPrimaryTriageMailbox(activeViewIDRef.current, mailboxRef.current)) {
        const filterKey = owner.requestKey;
        const providerMessages = messagesRef.current.filter((message) => emailMessageUsesActiveProviderScope(
          message,
          activeViewIDRef.current,
          currentUserID,
          activeMailAccountEmail,
        ));
        if (nextPageTokenRef.current && primaryTriageVisibleMessagesForList(providerMessages, messageListOrderRef.current).length < MESSAGE_BATCH_SIZE) {
          void fillPrimaryTriageVisibleMessagePage({
            messages: providerMessages,
            next_page_token: nextPageTokenRef.current,
          }, filterKey)
            .then((page) => {
              if (!mailboxRequestOwnerIsCurrent(owner) || messageListFilterKeyRef.current !== filterKey || !isPrimaryTriageMailbox(activeViewIDRef.current, mailboxRef.current)) return;
              const navigableSharedInboxIDs = new Set(sharedInboxes
                .filter((inbox) => inbox.entry_type === "shared_inbox" && sharedInboxCanLoadMail(inbox))
                .map((inbox) => inbox.folder_id.trim())
                .filter(Boolean));
              setMessages(applyLocalReadOverlays(mergeEmailCollaborationsForView(
                page.messages ?? [],
                emailCollaborations,
                activeViewIDRef.current,
                navigableSharedInboxIDs,
                activeMailAccountEmail,
                owner.mailboxScopeKey,
                currentUserID,
              ), locallyReadMessageKeysRef.current, owner.mailboxScopeKey));
              setNextPageToken(page.next_page_token ?? "");
            })
            .catch((fillError) => {
              if (!mailboxRequestOwnerIsCurrent(owner)) return;
              if (isEmailAccessExpiredError(fillError)) {
                void handleEmailAccessExpired(fillError);
                return;
              }
              setError(formatError(fillError, "Failed to load messages"));
            });
        }
        void prefetchNextMessagePage();
        return;
      }
      if (messageListWithinPrefetchDistance()) void prefetchNextMessagePage();
      if (messageListContentScrollHeight(list) <= list.clientHeight + 160) void loadMoreMessages();
    }, 0);
  }, [activeMailAccountEmail, canLoadMailForView, currentMailboxRequestOwner, currentMessageFilterKey, currentUserID, emailCollaborations, fillPrimaryTriageVisibleMessagePage, handleEmailAccessExpired, loadMoreMessages, localTriageConversionMailNetworkIsSuppressed, mailboxRequestOwnerIsCurrent, messageListWithinPrefetchDistance, prefetchNextMessagePage, scheduleOwnedMailRequest, sharedInboxes]);
  const removeMessagesFromVisibleMailList = useCallback((messageIDs: string[], options?: { exactMessages?: EmailMessage[]; fillAfterRemoval?: boolean; preserveScrollAnchor?: boolean; suppressAutoNetwork?: boolean; selectAfterRemoval?: EmailMessage | null }) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    if (options?.suppressAutoNetwork) suppressLocalTriageConversionMailNetwork();
    const removedIDSet = new Set(ids);
    const exactRowKeys = options?.exactMessages?.length
      ? new Set(options.exactMessages.map(emailMessageRowKey))
      : null;
    const shouldRemove = (message: EmailMessage) => exactRowKeys
      ? exactRowKeys.has(emailMessageRowKey(message))
      : removedIDSet.has(message.id);
    const removedRowKeys = new Set(messagesRef.current
      .filter(shouldRemove)
      .map(emailMessageRowKey));
    const nextSelection = options?.selectAfterRemoval && !shouldRemove(options.selectAfterRemoval)
      ? options.selectAfterRemoval
      : null;
    const nextSelectionRowKey = nextSelection ? emailMessageRowKey(nextSelection) : "";
    const list = options?.preserveScrollAnchor ? messageListRef.current : null;
    const scrollAnchor = list ? captureMessageListScrollAnchor(list, removedRowKeys) : null;
    setMessages((previous) => previous.filter((message) => !shouldRemove(message)));
    if (nextSelection) {
      setSelectedMessageIDs(new Set([nextSelectionRowKey]));
      setSelectionAnchorMessageID(nextSelectionRowKey);
    } else {
      setSelectedMessageIDs((previous) => {
        const next = new Set(previous);
        for (const rowKey of removedRowKeys) next.delete(rowKey);
        return next.size === previous.size ? previous : next;
      });
      setSelectionAnchorMessageID((current) => (removedRowKeys.has(current) ? "" : current));
    }
    if (removedRowKeys.has(selectedMessageRowKeyRef.current)) {
      messageSelectionGenerationRef.current += 1;
      selectedMessageIDRef.current = nextSelection?.id ?? "";
      selectedMessageRowKeyRef.current = nextSelectionRowKey;
      selectedMessageRef.current = nextSelection;
      setSelectedMessageID(nextSelection?.id ?? "");
      setSelectedMessageRowKey(nextSelectionRowKey);
      setSelectedMessage(nextSelection);
      setSelectedThreadMessages(nextSelection ? [nextSelection] : []);
    }
    setMessageContextMenu((current) => current && current.messageIDs.some((id) => ids.includes(id)) ? null : current);
    if (list && scrollAnchor) {
      window.requestAnimationFrame(() => {
        restoreMessageListScrollAnchor(list, scrollAnchor);
      });
    }
    if (options?.fillAfterRemoval !== false) fillMessageListAfterRemoval();
  }, [fillMessageListAfterRemoval, suppressLocalTriageConversionMailNetwork]);
  const reconcileConvertedMessageUnstars = useCallback((messageIDs: string[], options?: { updateVisibleList?: boolean }) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    if (options?.updateVisibleList === false) return;
    const idSet = new Set(ids);
    const visibleStarredCount = messagesRef.current.reduce((count, message) => count + (idSet.has(message.id) && message.starred ? 1 : 0), 0);
    if (visibleStarredCount > 0) adjustStarredMailboxCount(homeMailboxCountKey(activeEmailMailboxScopeKeyRef.current), -visibleStarredCount);
    setMessages((previous) => {
      let changed = false;
      const next = previous.map((message) => {
        if (!idSet.has(message.id) || !message.starred) return message;
        changed = true;
        return { ...message, starred: false };
      });
      return changed ? next : previous;
    });
    if (selectedMessageRef.current?.starred && idSet.has(selectedMessageRef.current.id)) {
      setSelectedMessage((current) => current && idSet.has(current.id) && current.starred ? { ...current, starred: false } : current);
    }
  }, [adjustStarredMailboxCount, companyID]);
  const patchConvertedMessageLogicGatePlacement = useCallback((messageIDs: string[], logicGateID: string, options?: { updateVisibleList?: boolean; sharedInboxID?: string; accountEmail?: string }) => {
    const ids = cleanIDList(messageIDs);
    const cleanLogicGateID = logicGateID.trim();
    if (ids.length === 0 || !cleanLogicGateID) return;
    suppressLocalTriageConversionMailNetwork();
    patchEmailMessagesLogicGatePlacement(ids, cleanLogicGateID, {
      companyID,
      sharedInboxID: options?.sharedInboxID,
      accountEmail: options?.sharedInboxID ? undefined : options?.accountEmail,
    });
    if (options?.updateVisibleList === false) return;
    const idSet = new Set(ids);
    setMessages((previous) => {
      let changed = false;
      const next = previous.map((message) => {
        if (!idSet.has(message.id)) return message;
        const patched = emailMessageWithLogicGatePlacement(message, cleanLogicGateID);
        if (patched !== message) changed = true;
        return patched;
      });
      return changed ? next : previous;
    });
    if (selectedMessageRef.current && idSet.has(selectedMessageRef.current.id)) {
      setSelectedMessage((current) => current && idSet.has(current.id) ? emailMessageWithLogicGatePlacement(current, cleanLogicGateID) : current);
    }
  }, [companyID, suppressLocalTriageConversionMailNetwork]);
  useEffect(() => {
    return () => {
      foldersRequestSeqRef.current += 1;
      messageRequestSeqRef.current += 1;
      pendingMessageReloadRef.current = false;
      pendingMessageRefreshRef.current = false;
      if (queuedMessageReloadTimerRef.current !== null) {
        window.clearTimeout(queuedMessageReloadTimerRef.current);
        queuedMessageReloadTimerRef.current = null;
      }
      if (messageListRefreshTimerRef.current !== null) {
        window.clearTimeout(messageListRefreshTimerRef.current);
        messageListRefreshTimerRef.current = null;
      }
      pendingMessageListRefreshOptionsRef.current = { requestKey: "", refresh: false };
      if (folderReloadTimerRef.current !== null) {
        window.clearTimeout(folderReloadTimerRef.current);
        folderReloadTimerRef.current = null;
      }
    };
  }, []);
  useEffect(() => { void loadStatus({ clearError: !preserveInitialOAuthError }); }, [loadStatus, preserveInitialOAuthError]);
  useEffect(() => { if (activeMailViewHasEmailConnection && isArchivableHomeViewID(activeViewID)) void loadFolders(); }, [activeEmailMailboxScopeKey, activeMailViewHasEmailConnection, activeViewID, loadFolders]);
  useEffect(() => { if (status?.configured) void loadSharedInboxes(); }, [loadSharedInboxes, status?.configured]);
  useEffect(() => { if (status?.connected || activeSharedTreeViewSelected || isInboxMatrixView || isMyWorkView || isUpdatesView) void loadCompanyUsers(); }, [activeSharedTreeViewSelected, isInboxMatrixView, isMyWorkView, isUpdatesView, loadCompanyUsers, status?.connected]);
  useEffect(() => {
    const onSharedInboxesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string }>).detail;
      if (detail?.companyID && detail.companyID !== companyID) return;
      void loadSharedInboxes();
    };
    window.addEventListener(EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED, onSharedInboxesUpdated);
    return () => window.removeEventListener(EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED, onSharedInboxesUpdated);
  }, [companyID, loadSharedInboxes]);
  useEffect(() => {
    if (!isWorkspacePanelHomeViewID(activeViewID)) return;
    void loadLogicGatePanel();
  }, [activeViewID, loadLogicGatePanel]);
  useEffect(() => {
    const onTriageConversionApplied = (event: Event) => {
      const detail = (event as CustomEvent<HomeTriageConversionAppliedDetail>).detail ?? {};
      if (detail.companyID && detail.companyID !== companyID) return;
      const messageIDs = cleanIDList(detail.messageIDs ?? []);
      if (messageIDs.length === 0) return;
      const sharedInboxID = detail.sharedInboxID?.trim() ?? "";
      const accountEmail = sharedInboxID ? "" : detail.accountEmail?.trim().toLowerCase() ?? "";
      const conversionSucceeded = Boolean(
        detail.logicGateID?.trim()
        || (detail.nodeIDs ?? []).some((id) => id.trim())
        || (detail.boardIDs ?? []).some((id) => id.trim())
        || (detail.cardIDs ?? []).some((id) => id.trim())
      );
      if (!conversionSucceeded) return;
      const unstarredMessageIDs = cleanIDList(detail.unstarredMessageIDs ?? []);
      const activeSharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
      const updateVisibleList = sharedInboxID
        ? sharedInboxID === activeSharedInboxID
        : !activeSharedInboxID && Boolean(accountEmail) && accountEmail === activeMailAccountEmail.trim().toLowerCase();
      reconcileConvertedMessageUnstars(unstarredMessageIDs, {
        updateVisibleList,
      });
      patchConvertedMessageLogicGatePlacement(messageIDs, detail.logicGateID ?? "", {
        sharedInboxID,
        accountEmail,
        updateVisibleList,
      });
    };
    window.addEventListener(EVENT_HOME_TRIAGE_CONVERSION_APPLIED, onTriageConversionApplied);
    return () => window.removeEventListener(EVENT_HOME_TRIAGE_CONVERSION_APPLIED, onTriageConversionApplied);
  }, [activeMailAccountEmail, companyID, patchConvertedMessageLogicGatePlacement, reconcileConvertedMessageUnstars]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);
  useEffect(() => {
    setNodeEditorOverlay(null);
  }, [companyID]);
  useEffect(() => {
    const loadedListKey = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly, activeEmailMailboxScopeKey, messageListOrder);
    if (loadedMessageListKey !== loadedListKey) return;
    if (!nextPageToken || loadingMessages || loadingMoreMessages) return;
    if (localTriageConversionMailNetworkIsSuppressed(loadedListKey)) return;
    if (isPrimaryTriageMailbox(activeViewID, mailbox)) {
      if (loadingDetail) return;
      const timerID = window.setTimeout(() => {
        delayedMailRequestTimerIDsRef.current.delete(timerID);
        void prefetchNextMessagePage(nextPageToken);
      }, EMAIL_DETAIL_FOREGROUND_GRACE_MS);
      delayedMailRequestTimerIDsRef.current.add(timerID);
      return () => {
        window.clearTimeout(timerID);
        delayedMailRequestTimerIDsRef.current.delete(timerID);
      };
    }
  }, [activeViewID, companyID, loadedMessageListKey, loadingDetail, loadingMessages, loadingMoreMessages, localTriageConversionMailNetworkIsSuppressed, mailbox, nextPageToken, prefetchNextMessagePage, searchQuery, unreadOnly]);
  useEffect(() => {
    if (!selectedMessageID) {
      setSelectedThreadMessages([]);
      return;
    }
    const selectedListMessage = selectedMessageRef.current;
    const selectedCollaborationID = selectedListMessage?.id === selectedMessageID
      ? selectedListMessage.collaboration_id?.trim() ?? ""
      : "";
    const providerMailAvailable = canLoadMailForView(activeViewID)
      && (!selectedListMessage || emailMessageUsesActiveProviderScope(selectedListMessage, activeViewID, currentUserID, activeMailAccountEmail));
    if (!providerMailAvailable && !selectedCollaborationID) {
      setLoadingDetail(false);
      setSelectedThreadMessages([]);
      return;
    }
    if (mailbox === "drafts" || selectedMessageID.startsWith("draft:")) {
      setLoadingDetail(false);
      setSelectedThreadMessages([]);
      return;
    }
    let cancelled = false;
    const sharedInboxID = sharedInboxIDForHomeView(activeViewID);
    const withLocalReadOverlay = (message: EmailMessage): EmailMessage => ({
      ...applyLocalReadOverlay(message, locallyReadMessageKeysRef.current, activeEmailMailboxScopeKey),
      client_source_scope_key: selectedListMessage?.client_source_scope_key?.trim() || activeEmailMailboxScopeKey,
    });
    const loadDetail = async () => {
      setLoadingDetail(true);
      setError("");
      let collaborationThreadMessages: EmailMessage[] = [];
      try {
        if (selectedCollaborationID) {
          try {
            const collaborationThread = await getEmailCollaborationThread(companyID, selectedCollaborationID);
            if (cancelled) return;
            collaborationThreadMessages = collaborationThread.messages.map((threadMessage) => ({
              ...threadMessage,
              collaboration_id: selectedCollaborationID,
              collaboration_node_id: selectedListMessage?.collaboration_node_id,
              collaboration_information_id: selectedListMessage?.collaboration_information_id,
              collaboration_scope_type: selectedListMessage?.collaboration_scope_type,
              collaboration_personal_user_id: selectedListMessage?.collaboration_personal_user_id,
              collaboration_shared_inbox_id: selectedListMessage?.collaboration_shared_inbox_id,
              collaboration_account_email: selectedListMessage?.collaboration_account_email,
              client_source_scope_key: selectedListMessage?.client_source_scope_key,
            }));
            const collaborationSelected = collaborationThreadMessages.find((candidate) => candidate.id === selectedMessageID)
              ?? collaborationThreadMessages[0]
              ?? null;
            if (collaborationSelected) {
              const selectedSnapshot = selectedListMessage?.id === collaborationSelected.id
                ? { ...selectedListMessage, ...collaborationSelected }
                : collaborationSelected;
              selectedMessageRef.current = selectedSnapshot;
              setSelectedMessage(selectedSnapshot);
              setSelectedThreadMessages(mergeEmailThreadDetailMessages(collaborationThreadMessages, [selectedSnapshot]));
            }
            if (!providerMailAvailable || collaborationThread.history_complete) return;
          } catch (collaborationThreadError) {
            if (!providerMailAvailable) throw collaborationThreadError;
          }
        }
        const selected = withLocalReadOverlay(await getEmailMessage(selectedMessageID, companyID, sharedInboxID, {
          userID: currentUserID,
          accountEmail: activeMailAccountEmail,
        }));
        if (cancelled) return;
        const existingSelected = selectedMessageRef.current;
        const selectedWithCollaboration = existingSelected?.id === selected.id ? { ...existingSelected, ...selected } : selected;
        const selectedWithLocalReplies = existingSelected?.id === selected.id && existingSelected.local_replies?.length ? {
          ...selectedWithCollaboration,
          local_replies: existingSelected.local_replies,
        } : selectedWithCollaboration;
        setSelectedMessage(selectedWithLocalReplies);
        setSelectedThreadMessages([selectedWithLocalReplies]);

        const threadID = (selected.thread_id ?? "").trim();
        if (!threadID) return;

        let threadPreviews: EmailMessage[] = [];
        let authoritativeMessageIDs: string[] = [];
        try {
          const thread = await getEmailThread(threadID, companyID, sharedInboxID, activeMailAccountEmail);
          if (cancelled) return;
          authoritativeMessageIDs = cleanIDList(thread.message_ids ?? []);
          if (authoritativeMessageIDs.length > 1) {
            const selectedThreadKey = emailThreadKey(selectedWithLocalReplies);
            setMessages((previous) => previous.map((message) => (
              emailThreadKey(message) === selectedThreadKey
                ? { ...message, thread_message_count: authoritativeMessageIDs.length }
                : message
            )));
          }
        } catch (threadError) {
          if (cancelled) return;
          if (isEmailAccessExpiredError(threadError)) throw threadError;
        }

        let pageToken = "";
        const seenPageTokens = new Set<string>();
        let loadedPages = 0;
        let threadPreviewExhausted = false;
        try {
          do {
            const page = await listEmailMessages({
              limit: MESSAGE_BATCH_SIZE,
              pageToken: pageToken || undefined,
              mailbox: "all",
              threadID,
              companyID,
              sharedInboxID,
              accountEmail: activeMailAccountEmail,
            });
            if (cancelled) return;
            threadPreviews = mergeEmailMessagePages(threadPreviews, page.messages ?? []);
            loadedPages += 1;
            const nextToken = (page.next_page_token ?? "").trim();
            if (!nextToken) {
              threadPreviewExhausted = true;
              break;
            }
            if (seenPageTokens.has(nextToken)) {
              break;
            }
            seenPageTokens.add(nextToken);
            pageToken = nextToken;
          } while (loadedPages < EMAIL_THREAD_PREVIEW_MAX_PAGES);
        } catch (threadListError) {
          if (cancelled) return;
          if (isEmailAccessExpiredError(threadListError)) throw threadListError;
        }

        if (cancelled) return;
        const missingMessageIDs = missingEmailThreadMessageIDs(
          authoritativeMessageIDs,
          selectedWithLocalReplies.id,
          threadPreviews,
        );
        const hydratedMissingMessages: EmailMessage[] = [];
        for (let index = 0; index < missingMessageIDs.length; index += 4) {
          const batch = missingMessageIDs.slice(index, index + 4);
          const loaded = await Promise.all(batch.map(async (messageID) => {
            try {
              return await getEmailMessage(messageID, companyID, sharedInboxID, {
                userID: currentUserID,
                accountEmail: activeMailAccountEmail,
              });
            } catch (messageError) {
              if (isEmailAccessExpiredError(messageError)) throw messageError;
              return null;
            }
          }));
          if (cancelled) return;
          hydratedMissingMessages.push(...loaded.filter((message): message is EmailMessage => Boolean(message)));
        }
        const loadedThreadMessages = [...threadPreviews, ...hydratedMissingMessages];
        setSelectedThreadMessages(mergeEmailThreadDetailMessages(
          [...collaborationThreadMessages, ...loadedThreadMessages.map(withLocalReadOverlay)],
          [selectedWithLocalReplies],
        ));
        const stillMissingAuthoritativeIDs = missingEmailThreadMessageIDs(
          authoritativeMessageIDs,
          selectedWithLocalReplies.id,
          loadedThreadMessages,
        );
        const threadHistoryIncomplete = authoritativeMessageIDs.length > 0
          ? stillMissingAuthoritativeIDs.length > 0
          : !threadPreviewExhausted;
        if (threadHistoryIncomplete) {
          setError("Some messages in this email thread could not be loaded. Refresh to retry the complete history.");
        }
      } catch (detailError) {
        if (cancelled) return;
        const collaborationFallback = selectedMessageRef.current;
        if (collaborationFallback?.id === selectedMessageID && collaborationFallback.collaboration_id?.trim()) {
          setSelectedMessage(collaborationFallback);
          setSelectedThreadMessages([collaborationFallback]);
          return;
        }
        if (isEmailAccessExpiredError(detailError)) {
          void handleEmailAccessExpired(detailError);
          return;
        }
        setError(formatError(detailError, "Failed to load message"));
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    };
    void loadDetail();
    return () => { cancelled = true; };
  }, [activeEmailMailboxScopeKey, activeMailAccountEmail, activeViewID, canLoadMailForView, companyID, currentUserID, handleEmailAccessExpired, mailbox, selectedMailDetailRealtimeRevision, selectedMessageID, selectedMessageRowKey]);
  const loadSelectedThreadMessageBody = useCallback(async (messageID: string): Promise<EmailMessage | null> => {
    const cleanMessageID = messageID.trim();
    if (!cleanMessageID || !canLoadMailForView(activeViewIDRef.current)) return null;
    const owner = currentMailboxRequestOwner();
    if (!mailboxRequestOwnerIsCurrent(owner)) return null;
    const selectedSourceMessage = selectedMessageRef.current;
    if (selectedSourceMessage && !emailMessageUsesActiveProviderScope(
      selectedSourceMessage,
      activeViewIDRef.current,
      currentUserID,
      activeMailAccountEmail,
    )) return null;
    const requestSharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    const requestAccountEmail = requestSharedInboxID ? undefined : activeMailAccountEmailRef.current;
    try {
      const message = await getEmailMessage(cleanMessageID, companyID, requestSharedInboxID, {
        userID: currentUserID,
        accountEmail: requestAccountEmail,
      });
      if (
        !mailboxRequestOwnerIsCurrent(owner)
        ||
        sharedInboxIDForHomeView(activeViewIDRef.current) !== requestSharedInboxID
      ) return null;
      const overlaid = {
        ...applyLocalReadOverlay(message, locallyReadMessageKeysRef.current, owner.mailboxScopeKey),
        client_source_scope_key: selectedSourceMessage?.client_source_scope_key?.trim() || owner.mailboxScopeKey,
      };
      setSelectedThreadMessages((current) => {
        if (!current.some((candidate) => candidate.id === cleanMessageID)) return current;
        return mergeEmailThreadDetailMessages(current, [overlaid]);
      });
      if (selectedMessageIDRef.current === cleanMessageID) {
        setSelectedMessage((current) => current?.id === cleanMessageID ? mergeEmailDetailMessage(current, overlaid) : current);
      }
      return overlaid;
    } catch (messageError) {
      if (!mailboxRequestOwnerIsCurrent(owner)) return null;
      if (isEmailAccessExpiredError(messageError)) {
        void handleEmailAccessExpired(messageError);
      } else if (selectedMessageIDRef.current === cleanMessageID) {
        setError(formatError(messageError, "Failed to load message"));
      }
      return null;
    }
  }, [canLoadMailForView, companyID, currentMailboxRequestOwner, currentUserID, handleEmailAccessExpired, mailboxRequestOwnerIsCurrent]);
  const startConnection = async (provider: "google" | "microsoft") => {
    setBusy(provider);
    setError("");
    try {
      const authURL = await fetchCommunicationsAuthURL(provider, undefined, undefined, companyID);
      window.location.assign(authURL);
    } catch (connectError) {
      setError(formatError(connectError, "Failed to start email connection"));
      setBusy("");
    }
  };
  const disconnect = async () => {
    setBusy("disconnect");
    setError("");
    try {
      await disconnectCommunications();
      setNotice("Email disconnected.");
      await loadStatus();
    } catch (disconnectError) {
      setError(formatError(disconnectError, "Failed to disconnect email"));
    } finally {
      setBusy("");
    }
  };
  const requestDisconnect = useCallback((position?: ConfirmActionMenuPosition) => {
    setDisconnectConfirmation({ position: position ?? null });
  }, []);
  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const nextSearchQuery = searchDraft.trim();
    searchQueryRef.current = nextSearchQuery;
    setSearchQuery(nextSearchQuery);
    setNextPageToken("");
  };
  const selectMailbox = useCallback((nextMailbox: EmailMailbox) => {
    mailboxRef.current = nextMailbox;
    setMailbox(nextMailbox);
    setNextPageToken("");
    clearSelectedMessageState();
    setMessageContextMenu(null);
  }, [clearSelectedMessageState]);
  useEffect(() => {
    if (mailbox !== "archive") return;
    selectMailbox("all");
  }, [mailbox, selectMailbox]);
  const selectHomeView = useCallback((viewID: HomeViewID, nextMailbox: EmailMailbox = "primary") => {
    activeViewIDRef.current = viewID;
    setActiveViewID(viewID);
    onActiveViewChange?.(viewID);
    selectMailbox(nextMailbox);
  }, [onActiveViewChange, selectMailbox]);
  useEffect(() => {
    if (initialViewIDRef.current === initialViewID) return;
    initialViewIDRef.current = initialViewID;
    if (activeViewID === initialViewID) return;
    selectHomeView(initialViewID, mailboxForHomeView(initialViewID));
  }, [activeViewID, initialViewID, selectHomeView]);
  useEffect(() => {
    const sharedInboxID = pendingSharedOAuthSharedInboxID.trim();
    if (sharedInboxID) {
      const folder = sharedInboxes.find((item) => item.folder_id === sharedInboxID || item.shared_inbox_id === sharedInboxID);
      if (!folder) return;
      const viewID = `shared:${folder.folder_id}` as HomeViewID;
      setPendingSharedOAuthSharedInboxID("");
      setPendingSharedOAuthAccountEmail("");
      selectHomeView(viewID, mailboxForHomeView(viewID));
      setPendingSharedInboxMessageRefreshID(folder.folder_id);
      return;
    }
    const accountEmail = pendingSharedOAuthAccountEmail.trim().toLowerCase();
    if (!accountEmail) return;
    const folder = sortSharedInboxes(sharedInboxes).find((item) => item.entry_type === "shared_inbox" && (item.account_email ?? "").trim().toLowerCase() === accountEmail);
    if (!folder) return;
    const viewID = `shared:${folder.folder_id}` as HomeViewID;
    setPendingSharedOAuthAccountEmail("");
    selectHomeView(viewID, mailboxForHomeView(viewID));
    setPendingSharedInboxMessageRefreshID(folder.folder_id);
  }, [pendingSharedOAuthAccountEmail, pendingSharedOAuthSharedInboxID, selectHomeView, sharedInboxes]);
  const currentMessageListParams = useCallback(() => ({
    limit: MESSAGE_BATCH_SIZE,
    mailbox: mailboxRef.current,
    companyID,
    sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
    accountEmail: sharedInboxIDForHomeView(activeViewIDRef.current) ? undefined : activeMailAccountEmail,
    q: searchQueryRef.current,
    unread: unreadOnlyRef.current ? true : undefined,
  }), [activeMailAccountEmail, companyID]);
  const providerMutationAvailableForMessages = useCallback((candidates: EmailMessage[]): boolean => (
    candidates.every((message) => emailMessageUsesActiveProviderScope(
      message,
      activeViewIDRef.current,
      currentUserID,
      activeMailAccountEmail,
    ))
  ), [activeMailAccountEmail, currentUserID]);
  const providerMutationAvailableForMessageIDs = useCallback((messageIDs: string[]): boolean => {
    const ids = new Set(cleanIDList(messageIDs));
    if (ids.size === 0) return true;
    return providerMutationAvailableForMessages(messagesRef.current.filter((message) => ids.has(message.id)));
  }, [providerMutationAvailableForMessages]);
  const applyUpdatedMessageToCurrentView = useCallback((message: EmailMessage) => {
    const params = currentMessageListParams();
    const selectedSourceMessage = selectedMessageRef.current;
    const scopedMessage = {
      ...message,
      client_source_scope_key: message.client_source_scope_key?.trim()
        || (selectedSourceMessage?.id === message.id ? selectedSourceMessage.client_source_scope_key : "")
        || activeEmailMailboxScopeKeyRef.current,
    };
    const scopedMessageRowKey = emailMessageRowKey(scopedMessage);
    const stillVisible = emailMessageMatchesListFilters(scopedMessage, params);
    setMessages((previous) => mergeEmailMessageIntoScopedMessageList(previous, scopedMessage, params));
    setSelectedThreadMessages((previous) => {
      if (!previous.some((item) => emailMessageRowKey(item) === scopedMessageRowKey)) return previous;
      return mergeEmailThreadDetailMessages(previous, [scopedMessage]);
    });
    if (selectedMessageRowKeyRef.current === scopedMessageRowKey) {
      if (stillVisible) {
        setSelectedMessage((current) => (current && emailMessageRowKey(current) === scopedMessageRowKey ? {
          ...current,
          ...scopedMessage,
          local_replies: current.local_replies ?? scopedMessage.local_replies,
        } : current));
      } else {
        selectedMessageIDRef.current = "";
        selectedMessageRowKeyRef.current = "";
        selectedMessageRef.current = null;
        setSelectedMessageID("");
        setSelectedMessageRowKey("");
        setSelectedMessage(null);
      }
    }
    if (!stillVisible) {
      setSelectedMessageIDs((previous) => {
        if (!previous.has(scopedMessageRowKey)) return previous;
        const next = new Set(previous);
        next.delete(scopedMessageRowKey);
        return next;
      });
    }
  }, [currentMessageListParams]);
  const patchSelectedMessage = async (update: { unread?: boolean; starred?: boolean; folders?: string[] }) => {
    if (!selectedMessage) return;
    if (!providerMutationAvailableForMessages([selectedMessage])) {
      setError("This shared conversation is read-only here; open its source mailbox to change provider state.");
      return;
    }
    const requestFilterKey = currentMessageFilterKey();
    const requestEmailMailboxScopeKey = activeEmailMailboxScopeKeyRef.current;
    const owner = { requestKey: requestFilterKey, mailboxScopeKey: requestEmailMailboxScopeKey };
    const selectedMessageKey = emailMailboxMessageKey(requestEmailMailboxScopeKey, selectedMessage.id);
    const requestStillOwnsVisibleList = () => mailboxRequestOwnerIsCurrent(owner);
    if (update.unread !== undefined) {
      const delayedMarkReadTimerID = delayedMarkReadTimerByMessageKeyRef.current.get(selectedMessageKey);
      if (delayedMarkReadTimerID !== undefined) {
        window.clearTimeout(delayedMarkReadTimerID);
        delayedMailRequestTimerIDsRef.current.delete(delayedMarkReadTimerID);
        delayedMarkReadTimerByMessageKeyRef.current.delete(selectedMessageKey);
      }
    }
    const starredDelta = update.starred !== undefined && update.starred !== selectedMessage.starred
      ? (update.starred ? 1 : -1)
      : 0;
    const countKey = homeMailboxCountKey(owner.mailboxScopeKey);
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current) || undefined;
    const accountEmail = sharedInboxID ? undefined : activeMailAccountEmailRef.current;
    const realtimeScope = mailboxRealtimeTargetRef.current?.scope ?? "";
    setBusy("message");
    setError("");
    if (starredDelta !== 0) adjustStarredMailboxCount(countKey, starredDelta);
    if (starredDelta !== 0) {
      addPendingStarredMessages([selectedMessage.id], owner.mailboxScopeKey);
      applyUpdatedMessageToCurrentView({ ...selectedMessage, starred: update.starred ?? selectedMessage.starred });
    }
    rememberLocalMailboxMutationEchoes("message.updated", [selectedMessage.id], realtimeScope);
    try {
      const commandResult = await updateHomeMailMessageCommand({
        companyID,
        sharedInboxID,
        accountEmail,
        messageID: selectedMessage.id,
        update,
      });
      if (!commandResult) return;
      const updated = commandResult.message;
      const updatedMessageKey = emailMailboxMessageKey(requestEmailMailboxScopeKey, updated.id);
      if (update.unread !== undefined) {
        markReadMutationTokenByMessageKeyRef.current.delete(updatedMessageKey);
        const delayedTimerID = delayedMarkReadTimerByMessageKeyRef.current.get(updatedMessageKey);
        if (delayedTimerID !== undefined) {
          window.clearTimeout(delayedTimerID);
          delayedMailRequestTimerIDsRef.current.delete(delayedTimerID);
          delayedMarkReadTimerByMessageKeyRef.current.delete(updatedMessageKey);
        }
      }
      if (update.unread === false) locallyReadMessageKeysRef.current.add(updatedMessageKey);
      if (update.unread === true) locallyReadMessageKeysRef.current.delete(updatedMessageKey);
      const normalized = {
        ...updated,
        ...(update.unread !== undefined ? { unread: update.unread } : {}),
        ...(update.starred !== undefined ? { starred: update.starred } : {}),
      };
      if (requestStillOwnsVisibleList()) {
        applyUpdatedMessageToCurrentView(normalized);
        if (starredDelta !== 0) void loadFolders({ owner: { mailboxScopeKey: owner.mailboxScopeKey }, refresh: true });
      }
    } catch (updateError) {
      forgetLocalMailboxMutationEchoes("message.updated", [selectedMessage.id], realtimeScope);
      if (starredDelta !== 0) adjustStarredMailboxCount(countKey, -starredDelta);
      if (requestStillOwnsVisibleList()) setError(formatError(updateError, "Failed to update message"));
      if (starredDelta !== 0 && requestStillOwnsVisibleList()) {
        cancelPendingStarredMessages([selectedMessage.id], owner.mailboxScopeKey);
        scheduleMessageListRefresh(0, { owner });
      }
    } finally {
      if (starredDelta !== 0) removePendingStarredMessages([selectedMessage.id], owner.mailboxScopeKey);
      if (requestStillOwnsVisibleList()) setBusy("");
    }
  };
  const toggleMessageStar = useCallback((message: EmailMessage) => {
    const messageID = message.id.trim();
    if (!messageID) return;
    if (!providerMutationAvailableForMessages([message])) {
      setError("This shared conversation is read-only here; open its source mailbox to change provider state.");
      return;
    }
    const nextStarred = !message.starred;
    const optimistic = { ...message, starred: nextStarred };
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current) || undefined;
    const accountEmail = sharedInboxID ? undefined : activeMailAccountEmailRef.current;
    const realtimeScope = mailboxRealtimeTargetRef.current?.scope ?? "";
    const requestFilterKey = currentMessageFilterKey();
    const requestEmailMailboxScopeKey = activeEmailMailboxScopeKeyRef.current;
    const owner = { requestKey: requestFilterKey, mailboxScopeKey: requestEmailMailboxScopeKey };
    const countKey = homeMailboxCountKey(owner.mailboxScopeKey);
    const requestStillOwnsVisibleList = () => mailboxRequestOwnerIsCurrent(owner);
    const starredDelta = nextStarred ? 1 : -1;
    adjustStarredMailboxCount(countKey, starredDelta);
    addPendingStarredMessages([messageID], owner.mailboxScopeKey);
    applyUpdatedMessageToCurrentView(optimistic);
    rememberLocalMailboxMutationEchoes("message.updated", [messageID], realtimeScope);
    void updateHomeMailMessageCommand({
      companyID,
      sharedInboxID,
      accountEmail,
      messageID,
      update: { starred: nextStarred },
    })
      .then((result) => {
        if (!result) return;
        const updated = { ...result.message, starred: nextStarred };
        if (requestStillOwnsVisibleList()) {
          applyUpdatedMessageToCurrentView(updated);
          void loadFolders({ owner: { mailboxScopeKey: owner.mailboxScopeKey }, refresh: true });
        }
      })
      .catch((starError) => {
        forgetLocalMailboxMutationEchoes("message.updated", [messageID], realtimeScope);
        adjustStarredMailboxCount(countKey, -starredDelta);
        invalidateEmailMessageCache(messageID, companyID, sharedInboxID, accountEmail);
        if (!requestStillOwnsVisibleList()) return;
        if (isEmailAccessExpiredError(starError)) {
          void handleEmailAccessExpired(starError);
          return;
        }
        if (requestStillOwnsVisibleList()) {
          setError(formatError(starError, "Failed to update message star"));
          cancelPendingStarredMessages([messageID], owner.mailboxScopeKey);
          scheduleMessageListRefresh(undefined, { owner });
        }
      })
      .finally(() => {
        removePendingStarredMessages([messageID], owner.mailboxScopeKey);
      });
  }, [addPendingStarredMessages, adjustStarredMailboxCount, applyUpdatedMessageToCurrentView, cancelPendingStarredMessages, companyID, currentMessageFilterKey, forgetLocalMailboxMutationEchoes, handleEmailAccessExpired, loadFolders, mailboxRequestOwnerIsCurrent, providerMutationAvailableForMessages, rememberLocalMailboxMutationEchoes, removePendingStarredMessages, scheduleMessageListRefresh]);
  const archiveMessages = useCallback(async (messageIDs: string[], exactMessages?: EmailMessage[], selectAfterRemoval?: EmailMessage | null) => {
    if (!canMutateCurrentMailView) return;
    const ids = cleanIDList(messageIDs);
    if (!(exactMessages ? providerMutationAvailableForMessages(exactMessages) : providerMutationAvailableForMessageIDs(ids))) return;
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    if (ids.length === 0) return;
    const owner = currentMailboxRequestOwner();
    if (!mailboxRequestOwnerIsCurrent(owner)) return;
    const accountEmail = sharedInboxID ? undefined : activeMailAccountEmailRef.current;
    const countKey = homeMailboxCountKey(owner.mailboxScopeKey);
    const realtimeScope = mailboxRealtimeTargetRef.current?.scope ?? "";
    const primaryCountAtStart = mailboxCountsFromFolders(foldersRef.current).primary ?? 0;
    const currentMailbox = mailboxRef.current;
    const inboxIDSet = new Set(ids.filter((id) => {
      if (currentMailbox === "primary") return true;
      return messagesRef.current.some((message) => message.id === id && messageHasInboxLabel(message));
    }));
    setBusy("archive");
    setError("");
    setNotice("");
    removeMessagesFromVisibleMailList(ids, {
      ...(exactMessages ? { exactMessages } : {}),
      selectAfterRemoval,
    });
    try {
      rememberLocalMailboxMutationEchoes("message.updated", ids, realtimeScope);
		const result = await archiveHomeMailMessagesCommand({ companyID, sharedInboxID, accountEmail, messageIDs: ids });
		const archivedIDs = cleanIDList(result?.messageIDs ?? ids);
		if (result?.archiveJob.job_id) {
			activeArchiveJobsRef.current.set(result.archiveJob.job_id, {
				companyID, sharedInboxID, accountEmail, messageIDs: archivedIDs, owner, realtimeScope,
			});
			void refreshActiveArchiveJobs();
		}
      const archivedInboxCount = archivedIDs.reduce((count, id) => count + (inboxIDSet.has(id) ? 1 : 0), 0);
      adjustPrimaryMailboxCount(countKey, -archivedInboxCount, primaryCountAtStart);
      if (!mailboxRequestOwnerIsCurrent(owner)) return;
		if (!selectAfterRemoval) setSelectedMessageIDs(new Set());
		if (!selectAfterRemoval) setSelectionAnchorMessageID("");
		setMessageContextMenu(null);
		setNotice(ids.length === 1 ? "Message archive queued." : `${ids.length} message archives queued.`);
    } catch (archiveError) {
      forgetLocalMailboxMutationEchoes("message.updated", ids, realtimeScope);
      if (!mailboxRequestOwnerIsCurrent(owner)) return;
      setError(formatError(archiveError, ids.length === 1 ? "Failed to archive message" : "Failed to archive messages"));
      scheduleMessageListRefresh(0, { owner });
    } finally {
      if (mailboxRequestOwnerIsCurrent(owner)) setBusy("");
    }
  }, [adjustPrimaryMailboxCount, canMutateCurrentMailView, companyID, currentMailboxRequestOwner, forgetLocalMailboxMutationEchoes, mailboxRequestOwnerIsCurrent, providerMutationAvailableForMessageIDs, providerMutationAvailableForMessages, refreshActiveArchiveJobs, rememberLocalMailboxMutationEchoes, removeMessagesFromVisibleMailList, scheduleFolderMetadataRefresh, scheduleMessageListRefresh]);
  const unarchiveMessages = useCallback(async (messageIDs: string[], exactMessages?: EmailMessage[]) => {
    if (!canMutateCurrentMailView) return;
    const ids = cleanIDList(messageIDs);
    if (!(exactMessages ? providerMutationAvailableForMessages(exactMessages) : providerMutationAvailableForMessageIDs(ids))) return;
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    if (ids.length === 0) return;
    const owner = currentMailboxRequestOwner();
    if (!mailboxRequestOwnerIsCurrent(owner)) return;
    const accountEmail = sharedInboxID ? undefined : activeMailAccountEmailRef.current;
    const countKey = homeMailboxCountKey(owner.mailboxScopeKey);
    const primaryCountAtStart = mailboxCountsFromFolders(foldersRef.current).primary ?? 0;
    const realtimeScope = mailboxRealtimeTargetRef.current?.scope ?? "";
    setBusy("unarchive");
    setError("");
    setNotice("");
    try {
      rememberLocalMailboxMutationEchoes("message.updated", ids, realtimeScope);
      await unarchiveHomeMailMessagesCommand({ companyID, sharedInboxID, accountEmail, messageIDs: ids });
      adjustPrimaryMailboxCount(countKey, ids.length, primaryCountAtStart);
      if (!mailboxRequestOwnerIsCurrent(owner)) return;
      removeMessagesFromVisibleMailList(ids, exactMessages ? { exactMessages } : undefined);
      if (selectedMessageID && ids.includes(selectedMessageID)) {
        setSelectedMessageID("");
        setSelectedMessage(null);
      }
      setSelectedMessageIDs(new Set());
      setSelectionAnchorMessageID("");
      setMessageContextMenu(null);
      setNotice(ids.length === 1 ? "Message moved to Inbox." : `${ids.length} messages moved to Inbox.`);
      scheduleFolderMetadataRefresh({ mailboxScopeKey: owner.mailboxScopeKey });
    } catch (unarchiveError) {
      forgetLocalMailboxMutationEchoes("message.updated", ids, realtimeScope);
      if (!mailboxRequestOwnerIsCurrent(owner)) return;
      setError(formatError(unarchiveError, ids.length === 1 ? "Failed to unarchive message" : "Failed to unarchive messages"));
    } finally {
      if (mailboxRequestOwnerIsCurrent(owner)) setBusy("");
    }
  }, [adjustPrimaryMailboxCount, canMutateCurrentMailView, companyID, currentMailboxRequestOwner, forgetLocalMailboxMutationEchoes, mailboxRequestOwnerIsCurrent, providerMutationAvailableForMessageIDs, providerMutationAvailableForMessages, rememberLocalMailboxMutationEchoes, removeMessagesFromVisibleMailList, scheduleFolderMetadataRefresh, selectedMessageID]);
  const archiveSelected = async () => {
    if (!selectedMessage || !canMutateCurrentMailView) return;
    if (mailboxRef.current === "archive") await unarchiveMessages([selectedMessage.id], [selectedMessage]);
    else {
      const nextMessage = nextEmailMessageAfterRemoval(visibleMessages, selectedMessageRowKey);
      await archiveMessages([selectedMessage.id], [selectedMessage], nextMessage);
    }
  };
  const composeDraftID = useCallback((value: ComposeState): string => {
    const currentDraftID = value.draftID.trim();
    if (currentDraftID) return currentDraftID;
    const replyToMessageID = value.replyToMessageID.trim();
    if (replyToMessageID) return createHomeMailReplyDraftID(value.sharedInboxID, replyToMessageID, value.accountEmail, currentUserID);
    return createHomeMailDraftID();
  }, [currentUserID]);
  const setMailDraftsForScopeIfActive = useCallback((
    drafts: HomeMailDraft[],
    sharedInboxID: string,
    accountEmail: string,
  ) => {
    if (!sharedInboxID.trim() && !accountEmail.trim()) return;
    if (activeEmailMailboxScopeKeyRef.current !== emailMailboxScopeKey(
      companyID,
      currentUserID,
      accountEmail,
      sharedInboxID,
    )) return;
    setMailDrafts(drafts.filter((draft) => homeMailDraftMatchesScope(draft, sharedInboxID, accountEmail)));
  }, [companyID, currentUserID]);
  const applySyncedMailDrafts = useCallback((drafts: HomeMailDraft[], draftID: string) => {
    const canonical = drafts.find((draft) => draft.id === draftID && draft.sharedDraft);
    setMailDrafts((current) => canonical
      ? mergeHomeMailDrafts([...current.filter((draft) => !draft.sharedDraft), ...drafts], [])
      : drafts);
    if (!canonical) return;
    setCompose((current) => {
      if (current.draftID !== canonical.id || current.draftRevision === canonical.revision) return current;
      const next = { ...current, draftRevision: canonical.revision };
      composeRef.current = next;
      return next;
    });
  }, []);
  const saveCurrentComposeDraft = useCallback((options?: { quiet?: boolean; keepOpen?: boolean }, composeAtSave = composeRef.current) => {
    if (!composeAtSave.open) return false;
    const shouldSave = composeHasDraftContent(composeAtSave, composeScopeEmailSignature);
    const composeForSave = shouldSave && !composeAtSave.draftID.trim()
      ? { ...composeAtSave, draftID: composeDraftID(composeAtSave) }
      : composeAtSave;
    const syncing = syncHomeMailDraftFromCompose(companyID, currentUserID, composeForSave, composeScopeEmailSignature);
    setMailDraftsForScopeIfActive(
      readHomeMailDraftsForScope(companyID, currentUserID, composeForSave.sharedInboxID, composeForSave.accountEmail),
      composeForSave.sharedInboxID,
      composeForSave.accountEmail,
    );
    void syncing
      .then((drafts) => {
        setMailDraftsForScopeIfActive(drafts, composeForSave.sharedInboxID, composeForSave.accountEmail);
        applySyncedMailDrafts(drafts, composeForSave.draftID);
        if (composeForSave.sharedDraft && !options?.quiet) setNotice("Shared draft saved.");
      })
      .catch((draftError) => {
        setError(formatError(draftError, "Shared draft changed. Your local edits are preserved; reopen the draft to review the latest revision."));
      });
    if (options?.keepOpen && composeForSave.draftID !== composeAtSave.draftID) {
      setCompose(composeForSave);
    }
    if (shouldSave && !options?.quiet && !composeForSave.sharedDraft) setNotice("Draft saved.");
    return shouldSave;
  }, [applySyncedMailDrafts, companyID, composeDraftID, composeScopeEmailSignature, currentUserID]);
  const openPendingMailbox = useCallback(() => {
    saveCurrentComposeDraft({ quiet: true });
    setCompose(emptyCompose);
    selectMailbox("primary");
  }, [saveCurrentComposeDraft, selectMailbox]);
  const openStarredMailbox = useCallback(() => {
    saveCurrentComposeDraft({ quiet: true });
    setCompose(emptyCompose);
    selectMailbox("starred");
  }, [saveCurrentComposeDraft, selectMailbox]);
  const openDraftsMailbox = useCallback(() => {
    saveCurrentComposeDraft({ quiet: true });
    setCompose(emptyCompose);
    selectMailbox("drafts");
  }, [saveCurrentComposeDraft, selectMailbox]);
  const openSentMailbox = useCallback(() => {
    saveCurrentComposeDraft({ quiet: true });
    setCompose(emptyCompose);
    selectMailbox("sent");
  }, [saveCurrentComposeDraft, selectMailbox]);
  const openAllMailbox = useCallback(() => {
    saveCurrentComposeDraft({ quiet: true });
    setCompose(emptyCompose);
    selectMailbox("all");
  }, [saveCurrentComposeDraft, selectMailbox]);
  const openSpamMailbox = useCallback(() => {
    saveCurrentComposeDraft({ quiet: true });
    setCompose(emptyCompose);
    selectMailbox("spam");
  }, [saveCurrentComposeDraft, selectMailbox]);
  const currentMailComposeError = (targetSharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current)) => {
    const cleanSharedInboxID = targetSharedInboxID.trim();
    if (activeViewID === "shared-root" && !cleanSharedInboxID) return "Select a Shared Triage inbox before composing.";
    if (cleanSharedInboxID) {
      const targetSharedInbox = sharedInboxes.find((folder) => folder.folder_id === cleanSharedInboxID) ?? null;
      if (!targetSharedInbox) return "Shared Triage inbox is unavailable.";
      const targetIsParent = sharedInboxes.some((folder) => (folder.parent_folder_id ?? "").trim() === targetSharedInbox.folder_id);
      if (targetIsParent) return "Parent folders cannot have emails assigned.";
      if (!sharedInboxTreeUserCanManageMail(sharedInboxes, cleanSharedInboxID, currentUserID, currentUserHasFullSharedInboxAccess)) {
        return "You need edit access to compose from this inbox.";
      }
      if (!(targetSharedInbox.account_email ?? "").trim()) return "Assign an email to this Shared Triage inbox before composing.";
      return "";
    }
    if (!canMutateCurrentMailView) return "You need edit access to compose from this inbox.";
    return "";
  };
  const openNewCompose = () => {
    const composeError = currentMailComposeError();
    if (composeError) {
      setError(composeError);
      return;
    }
    saveCurrentComposeDraft({ quiet: true });
    const draftID = createHomeMailDraftID();
    pendingAutoSignatureRef.current = activeScopeEmailSignature.trim()
      ? null
      : { draftID, scopeKey: activeSignatureScopeKey };
    setCompose({
      ...emptyCompose,
      open: true,
      draftID,
      sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
      accountEmail: (activeMailAccountEmail ?? "").trim(),
      body: composeBodyWithSignature(activeScopeEmailSignature),
    });
  };
  const openReply = (
    mode: "reply" | "reply-all" = "reply",
    sourceMessage: EmailMessage | null = selectedMessage,
    sharedCollaboration: CommunicationsEmailCollaboration | null = null,
  ) => {
    if (!sourceMessage) return;
    const composeError = sharedCollaboration ? "" : currentMailComposeError();
    if (composeError) {
      setError(composeError);
      return;
    }
    saveCurrentComposeDraft({ quiet: true });
    const sharedInboxID = sharedCollaboration?.shared_inbox_id?.trim() || sharedInboxIDForHomeView(activeViewIDRef.current);
    const accountEmail = sharedCollaboration?.account_email?.trim() || (activeMailAccountEmail ?? "").trim();
    const focusRequestID = composeRef.current.focusRequestID + 1;
    const existingDraftID = sharedCollaboration
      ? createHomeMailSharedReplyDraftID(sharedCollaboration.collaboration_id, sourceMessage.id)
      : createHomeMailReplyDraftID(sharedInboxID, sourceMessage.id, accountEmail, currentUserID);
    const legacyDraftID = createHomeMailReplyDraftID(sharedInboxID, sourceMessage.id);
    const existingDraft = activeMailDrafts.find((draft) => draft.id === existingDraftID)
      ?? (!sharedCollaboration && legacyDraftID !== existingDraftID ? activeMailDrafts.find((draft) => draft.id === legacyDraftID) : undefined);
    if (existingDraft) {
      pendingAutoSignatureRef.current = null;
      const requiredReplyAllRecipients = mode === "reply-all" ? replyAllRecipients(sourceMessage, accountEmail) : null;
      const to = requiredReplyAllRecipients
        ? mergeEmailAddressDrafts([existingDraft.to, requiredReplyAllRecipients.to])
        : existingDraft.to;
      const cc = requiredReplyAllRecipients
        ? mergeEmailAddressDrafts([existingDraft.cc, requiredReplyAllRecipients.cc], [to])
        : existingDraft.cc;
      const nextCompose = {
        ...homeMailDraftToCompose(existingDraft),
        collaborationID: sharedCollaboration?.collaboration_id ?? existingDraft.collaborationID,
        sharedDraft: Boolean(sharedCollaboration) || existingDraft.sharedDraft,
        replyToMessage: existingDraft.replyToMessage ?? sourceMessage,
        focusRequestID,
        to,
        cc,
      };
      composeRef.current = nextCompose;
      setCompose(nextCompose);
      return;
    }
    const recipients = mode === "reply-all"
      ? replyAllRecipients(sourceMessage, accountEmail)
      : { to: addressListExcludingMailbox(sourceMessage, "reply_to", accountEmail) || addressListExcludingMailbox(sourceMessage, "from", accountEmail), cc: "" };
    pendingAutoSignatureRef.current = activeScopeEmailSignature.trim()
      ? null
      : { draftID: existingDraftID, scopeKey: activeSignatureScopeKey };
    const nextCompose: ComposeState = {
      ...emptyCompose,
      kind: "reply",
      open: true,
      draftID: existingDraftID,
      sharedInboxID,
      accountEmail,
      replyToMessageID: sourceMessage.id,
      replyToMessage: sourceMessage,
      focusRequestID,
      to: recipients.to,
      cc: recipients.cc,
      subject: replySubject(sourceMessage.subject || ""),
      body: composeBodyWithSignature(activeScopeEmailSignature),
      collaborationID: sharedCollaboration?.collaboration_id ?? "",
      sharedDraft: Boolean(sharedCollaboration),
      draftRevision: 0,
    };
    composeRef.current = nextCompose;
    setCompose(nextCompose);
    if (sharedCollaboration) {
      setMailDrafts(saveHomeMailDraftFromCompose(companyID, currentUserID, nextCompose, activeScopeEmailSignature));
      void syncHomeMailDraftFromCompose(companyID, currentUserID, nextCompose, activeScopeEmailSignature)
        .then((drafts) => applySyncedMailDrafts(drafts, nextCompose.draftID))
        .catch((draftError) => setError(formatError(draftError, "Failed to create shared draft")));
    }
  };
  const applyEmailCollaborationChange = useCallback((collaboration: CommunicationsEmailCollaboration) => {
    setEmailCollaborations((current) => [
      collaboration,
      ...current.filter((item) => item.collaboration_id !== collaboration.collaboration_id),
    ]);
    const collaborationMessage = emailCollaborationListMessage(collaboration);
    if (!collaborationMessage) return;
    const matches = (candidate: EmailMessage) => emailMessageMatchesCollaboration(
      candidate,
      collaboration,
      activeViewID,
      activeMailAccountEmail,
      currentUserID,
    );
    setMessages((current) => current.map((candidate) => matches(candidate) ? mergeEmailMessageWithCollaboration(candidate, collaborationMessage) : candidate));
    setSelectedMessage((current) => {
      if (!current || !matches(current)) return current;
      const next = mergeEmailMessageWithCollaboration(current, collaborationMessage);
      selectedMessageRef.current = next;
      return next;
    });
  }, [activeMailAccountEmail, activeViewID, currentUserID]);
  const applyEmailNodeAttachmentChange = useCallback((attachment: EmailNodeAttachmentChange) => {
    const matches = (candidate: EmailMessage) => emailMessageMatchesNodeAttachment(candidate, attachment);
    setMessages((current) => current.map((candidate) => (
      matches(candidate) ? mergeEmailMessageWithNodeAttachment(candidate, attachment) : candidate
    )));
    setSelectedMessage((current) => {
      if (!current || !matches(current)) return current;
      const next = mergeEmailMessageWithNodeAttachment(current, attachment);
      selectedMessageRef.current = next;
      return next;
    });
  }, []);
  const openSharedDraft = async (sourceMessage: EmailMessage) => {
    const sourceSharedInboxID = sourceMessage.collaboration_shared_inbox_id?.trim()
      || sharedInboxIDForHomeView(activeViewIDRef.current);
    const sourceAccountEmail = sourceMessage.collaboration_account_email?.trim()
      || (activeMailAccountEmail ?? "").trim();
    const threadID = sourceMessage.thread_id?.trim() ?? "";
    let collaboration = emailCollaborations.find((item) => (
      item.collaboration_id === sourceMessage.collaboration_id
      || Boolean(
        !sourceMessage.collaboration_id?.trim()
        && threadID
        && item.provider_thread_id?.trim() === threadID
        && (item.shared_inbox_id?.trim() ?? "") === sourceSharedInboxID
        && (!sourceSharedInboxID ? (item.account_email?.trim().toLowerCase() ?? "") === sourceAccountEmail.toLowerCase() : true)
      )
    )) ?? null;
    setBusy("shared-draft");
    setError("");
    try {
      if (!collaboration) {
        collaboration = await ensureEmailCollaboration({
          companyID,
          message: sourceMessage,
          messageID: sourceMessage.id,
          threadID,
          sharedInboxID: sourceSharedInboxID,
          accountEmail: sourceAccountEmail,
          priority: 3,
        });
      }
      applyEmailCollaborationChange(collaboration);
      openReply("reply-all", sourceMessage, collaboration);
      setNotice("Shared draft created for all email participants.");
    } catch (cause) {
      setError(formatError(cause, "Failed to create shared draft"));
    } finally {
      setBusy("");
    }
  };
  const openReplyAll = (sourceMessage: EmailMessage | null = selectedMessage) => openReply("reply-all", sourceMessage);
  const openForward = async (sourceMessage: EmailMessage | null = selectedMessage) => {
    if (!sourceMessage) return;
    const composeError = currentMailComposeError();
    if (composeError) {
      setError(composeError);
      return;
    }
    saveCurrentComposeDraft({ quiet: true });
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    const accountEmail = (activeMailAccountEmail ?? "").trim();
    const forwardDraftID = createHomeMailForwardDraftID(sharedInboxID, sourceMessage.id, accountEmail, currentUserID);
    const legacyDraftID = createHomeMailForwardDraftID(sharedInboxID, sourceMessage.id);
    const existingDraft = activeMailDrafts.find((draft) => draft.id === forwardDraftID)
      ?? (legacyDraftID !== forwardDraftID ? activeMailDrafts.find((draft) => draft.id === legacyDraftID) : undefined);
    if (existingDraft) {
      pendingAutoSignatureRef.current = null;
      const existingCompose = homeMailDraftToCompose(existingDraft);
      composeRef.current = existingCompose;
      setCompose(existingCompose);
      return;
    }

    setBusy("forward");
    setError("");
    setNotice("Preparing the forwarded message…");
    pendingAutoSignatureRef.current = null;
    const hydratedSource = emailBodyLooksHydrated(sourceMessage)
      ? sourceMessage
      : (await loadSelectedThreadMessageBody(sourceMessage.id) ?? sourceMessage);
    let forwardedSource = hydratedSource;
    const forwardedAttachments: ComposeAttachment[] = [];
    let copyFailure = "";
    const attachmentsToCopy = forwardedAttachmentsForCopy(hydratedSource);
    const totalAttachmentBytes = attachmentsToCopy.reduce((sum, attachment) => sum + Math.max(0, attachment.size ?? 0), 0);
    if (totalAttachmentBytes > 24_000_000) {
      copyFailure = "The original attachments exceed the 24 MB forwarding limit. The message body is ready, but its files were not copied.";
    } else if (attachmentsToCopy.length > 0) {
      try {
        const preparedCompose: ComposeState = {
          ...emptyCompose,
          kind: "forward",
          open: true,
          draftID: forwardDraftID,
          sharedInboxID,
          accountEmail,
          replyToMessageID: hydratedSource.id,
          replyToMessage: hydratedSource,
          subject: forwardSubject(hydratedSource.subject || ""),
          body: composeBodyWithSignature(activeScopeEmailSignature),
        };
        const drafts = await ensureHomeMailDraftAttachmentTarget(companyID, currentUserID, preparedCompose, activeScopeEmailSignature);
        setMailDraftsForScopeIfActive(drafts, sharedInboxID, accountEmail);
        const resourceID = mangoEmailDraftResourceID({ draftID: forwardDraftID });
        if (!resourceID) throw new Error("Email attachment context is unavailable.");
        const results = await Promise.allSettled(attachmentsToCopy.map(async (attachment) => {
          const providerAttachmentID = forwardedProviderAttachmentID(attachment);
          const blob = await downloadEmailAttachment(hydratedSource.id, providerAttachmentID, companyID, sharedInboxID || undefined, {
            accountEmail: sharedInboxID ? undefined : accountEmail,
            collaborationID: hydratedSource.collaboration_id,
          });
          const filename = attachment.filename?.trim() || "attachment";
          const file = new File([blob], filename, { type: attachment.content_type?.trim() || blob.type || "application/octet-stream" });
          const uploaded = await uploadMangoAttachment(attachmentRequestJSON, {
            companyID,
            resourceType: "email_draft",
            resourceID,
            file,
            sourceKind: "email_outgoing",
            relationshipKind: attachment.is_inline || attachment.content_id?.trim() ? "email_inline_attachment" : "email_attachment",
            messageID: hydratedSource.id,
            editorSurface: sharedInboxID ? "shared-triage-compose" : "my-triage-compose",
            sourceProvider: "nylas",
          });
          const copied = uploaded.attachment;
          return {
            providerAttachmentID,
            mangoAttachmentID: copied.attachment_id,
            composeAttachment: {
              id: copied.attachment_id,
              attachmentID: copied.attachment_id,
              filename: copied.original_filename || filename,
              contentType: copied.mime_type || file.type || "application/octet-stream",
              size: copied.byte_size || file.size,
            },
          };
        }));
        for (const result of results) {
          if (result.status === "rejected") continue;
          forwardedAttachments.push(result.value.composeAttachment);
          forwardedSource = withForwardedAttachmentCopy(forwardedSource, result.value.providerAttachmentID, result.value.mangoAttachmentID);
        }
        const failureCount = results.filter((result) => result.status === "rejected").length;
        if (failureCount > 0) copyFailure = `${failureCount} original attachment${failureCount === 1 ? "" : "s"} could not be copied. You can still review and send the forward.`;
      } catch (cause) {
        copyFailure = formatError(cause, "The original attachments could not be copied. You can still review and send the forward.");
      }
    }
    const nextCompose: ComposeState = {
      ...emptyCompose,
      kind: "forward",
      open: true,
      draftID: forwardDraftID,
      sharedInboxID,
      accountEmail,
      replyToMessageID: forwardedSource.id,
      replyToMessage: forwardedSource,
      subject: forwardSubject(forwardedSource.subject || ""),
      body: composeBodyWithSignature(activeScopeEmailSignature),
      attachments: forwardedAttachments,
    };
    composeRef.current = nextCompose;
    setCompose(nextCompose);
    setMailDrafts(saveHomeMailDraftFromCompose(companyID, currentUserID, nextCompose, activeScopeEmailSignature));
    void syncHomeMailDraftFromCompose(companyID, currentUserID, nextCompose, activeScopeEmailSignature)
      .then((drafts) => applySyncedMailDrafts(drafts, nextCompose.draftID))
      .catch((draftError) => setError(formatError(draftError, "Failed to save the forwarded draft")));
    setNotice(copyFailure ? "" : attachmentsToCopy.length > 0 ? "Forward ready with the original attachments." : "Forward ready.");
    if (copyFailure) setError(copyFailure);
    setBusy("");
  };
  const submitCompose = async (event: React.FormEvent, composeAtSubmit: ComposeState) => {
    event.preventDefault();
    const visibleOwner = currentMailboxRequestOwner();
    const closeSubmittedCompose = (submitted: ComposeState): boolean => {
      if (!homeMailboxComposeSubmissionIsCurrent(composeRef.current, submitted)) return false;
      composeRef.current = emptyCompose;
      setCompose(emptyCompose);
      return true;
    };
    setBusy("send");
    setError("");
    try {
      const explicitSharedInboxID = composeAtSubmit.sharedInboxID.trim();
      const explicitAccountEmail = composeAtSubmit.accountEmail.trim().toLowerCase();
      const targetSharedInboxID = explicitSharedInboxID
        || (explicitAccountEmail ? "" : sharedInboxIDForHomeView(activeViewIDRef.current));
      const currentSharedInbox = targetSharedInboxID ? sharedInboxes.find((folder) => folder.folder_id === targetSharedInboxID) ?? null : null;
      const connectedAccountEmail = (explicitAccountEmail || currentSharedInbox?.account_email || connection?.account_email || "").trim().toLowerCase();
      const composeError = composeAtSubmit.sharedDraft
        ? ""
        : (targetSharedInboxID || !explicitAccountEmail ? currentMailComposeError(targetSharedInboxID) : "");
      if (composeError) {
        setError(composeError);
        return;
      }
      const composeMailboxScopeKey = emailMailboxScopeKey(
        companyID,
        currentUserID,
        connectedAccountEmail,
        targetSharedInboxID,
      );
      const composeSourceOwnsVisibleMailbox = () => (
        visibleOwner.mailboxScopeKey === composeMailboxScopeKey
        && mailboxRequestOwnerIsCurrent(visibleOwner)
      );
      const submittedSignatureScopeKey = homeMailSignatureScopeKey(
        companyID,
        currentUserID,
        targetSharedInboxID,
        connectedAccountEmail,
      );
      let submittedSignature = emailSignatureScopeKey === submittedSignatureScopeKey
        ? emailSignature
        : readHomeMailSignature(companyID, currentUserID, targetSharedInboxID, connectedAccountEmail);
      let submittedCompose = composeAtSubmit;
      const pendingSignature = pendingAutoSignatureRef.current;
      if (pendingSignature?.draftID === composeAtSubmit.draftID) {
        if (!submittedSignature.trim() && (targetSharedInboxID || connectedAccountEmail)) {
          submittedSignature = await loadHomeMailSignature(
            companyID,
            currentUserID,
            targetSharedInboxID,
            connectedAccountEmail,
          );
        }
        const latestCompose = composeRef.current;
        if (!latestCompose.open || latestCompose.draftID !== pendingSignature.draftID) {
          if (pendingAutoSignatureRef.current?.draftID === pendingSignature.draftID) {
            pendingAutoSignatureRef.current = null;
          }
          return;
        }
        const latestSignatureScopeKey = homeMailSignatureScopeKey(
          companyID,
          currentUserID,
          latestCompose.sharedInboxID.trim() || targetSharedInboxID,
          latestCompose.accountEmail.trim() || connectedAccountEmail,
        );
        if (latestSignatureScopeKey !== submittedSignatureScopeKey) return;
        submittedCompose = latestCompose;
        if (submittedSignature.trim()) {
          submittedCompose = {
            ...latestCompose,
            accountEmail: connectedAccountEmail || latestCompose.accountEmail,
            body: applyHomeMailSignature(latestCompose.body, submittedSignature),
          };
          composeRef.current = submittedCompose;
          setCompose(submittedCompose);
        }
        pendingAutoSignatureRef.current = null;
      }
      if (submittedCompose.sharedDraft && composeIsScheduledForFuture(submittedCompose)) {
        setError("Shared drafts must be sent immediately; scheduled shared sends are not supported yet.");
        return;
      }
      if (composeIsScheduledForFuture(submittedCompose)) {
        const scheduleValidationError = validateScheduledCompose(submittedCompose);
        if (scheduleValidationError) {
          setError(scheduleValidationError);
          return;
        }
        const scheduledCompose = submittedCompose.draftID.trim()
          ? submittedCompose
          : { ...submittedCompose, draftID: composeDraftID(submittedCompose) };
        const syncing = syncHomeMailDraftFromCompose(companyID, currentUserID, scheduledCompose, submittedSignature);
        setMailDraftsForScopeIfActive(
          readHomeMailDraftsForScope(companyID, currentUserID, scheduledCompose.sharedInboxID, scheduledCompose.accountEmail),
          scheduledCompose.sharedInboxID,
          scheduledCompose.accountEmail,
        );
        void syncing.then((drafts) => setMailDraftsForScopeIfActive(
          drafts,
          scheduledCompose.sharedInboxID,
          scheduledCompose.accountEmail,
        ));
        if (closeSubmittedCompose(submittedCompose)) {
          setNotice(formatScheduledSendNotice(scheduledCompose.scheduledAt));
        }
        return;
      }
      let sentMessage: EmailMessage;
      let sharedDraftCleanupPending = false;
      if (submittedCompose.sharedDraft) {
        const collaborationID = submittedCompose.collaborationID.trim();
        const draftID = submittedCompose.draftID.trim();
        if (!collaborationID || !draftID) {
          setError("Save the shared draft before sending it.");
          return;
        }
        const syncedDrafts = await syncHomeMailDraftFromCompose(companyID, currentUserID, submittedCompose, submittedSignature);
        applySyncedMailDrafts(syncedDrafts, draftID);
        const canonicalDraft = syncedDrafts.find((draft) => draft.id === draftID && draft.sharedDraft && draft.collaborationID === collaborationID);
        if (!canonicalDraft || canonicalDraft.revision <= 0) throw new Error("email_collaboration_shared_draft_not_found");
        const result = await sendEmailCollaborationDraft({
          companyID,
          collaborationID,
          draftID,
          expectedRevision: canonicalDraft.revision,
        });
        sentMessage = result.message;
        sharedDraftCleanupPending = !result.draft_deleted;
        setMailDrafts(deleteHomeMailDraft(companyID, currentUserID, draftID));
      } else {
        const result = await sendHomeMailComposeCommand({ companyID, sharedInboxID: targetSharedInboxID, compose: submittedCompose, connectedAccountEmail });
        sentMessage = result.sentMessage;
        if (submittedCompose.draftID.trim()) {
          const deleting = deleteHomeMailDraftRemote(companyID, currentUserID, submittedCompose.draftID);
          setMailDraftsForScopeIfActive(
            readHomeMailDraftsForScope(companyID, currentUserID, submittedCompose.sharedInboxID, submittedCompose.accountEmail),
            submittedCompose.sharedInboxID,
            submittedCompose.accountEmail,
          );
          void deleting.then((drafts) => setMailDraftsForScopeIfActive(drafts, submittedCompose.sharedInboxID, submittedCompose.accountEmail));
        }
      }
      const replyThreadID = submittedCompose.replyToMessage?.thread_id?.trim() ?? "";
      sentMessage = !sentMessage.thread_id?.trim() && replyThreadID
        ? { ...sentMessage, thread_id: replyThreadID }
        : sentMessage;
      const sendRealtimeScope = targetSharedInboxID
        ? realtimeSharedMailboxScope(targetSharedInboxID)
        : realtimePersonalMailboxScope(currentUserID, connectedAccountEmail);
      rememberLocalMailboxMutationEchoes("message.created", [sentMessage.id], sendRealtimeScope);
      if (sharedDraftCleanupPending) {
        setNotice("Message sent. Shared-draft cleanup is pending; do not send it again.");
      }
      const replyToMessageID = submittedCompose.replyToMessageID.trim();
      if (replyToMessageID) {
        addLocalEmailReply(replyToMessageID, sentMessage, {
          companyID,
          sharedInboxID: targetSharedInboxID,
          userID: currentUserID,
          accountEmail: connectedAccountEmail,
        });
      }
      if (closeSubmittedCompose(submittedCompose) && !sharedDraftCleanupPending) {
        setNotice("Message sent.");
      }
      if (!composeSourceOwnsVisibleMailbox()) return;
      if (replyToMessageID) {
        setSelectedMessage((current) => current?.id === replyToMessageID ? addLocalReplyToEmailMessage(current, sentMessage) : current);
        setSelectedThreadMessages((previous) => mergeEmailThreadDetailMessages(previous, [sentMessage]));
      }
      const sentParams = currentMessageListParams();
      if (emailMessageMatchesListFilters(sentMessage, sentParams)) {
        setMessages((previous) => mergeEmailMessageIntoMessageList(previous, sentMessage, sentParams, {
          prependIfMissing: true,
          maxMessages: Math.max(MESSAGE_BATCH_SIZE, previous.length + 1),
        }));
      }
    } catch (sendError) {
      if (homeMailboxComposeSubmissionIsCurrent(composeRef.current, composeAtSubmit)) {
        if (isOutboundEmailUndoneError(sendError)) setNotice("Send undone. Your message is still open.");
        else setError(formatError(sendError, "Failed to send message"));
      }
    } finally {
      if (mailboxRequestOwnerIsCurrent(visibleOwner)) setBusy("");
    }
  };
  useEffect(() => {
    if (!companyID.trim() || !currentUserID.trim()) return undefined;
    let cancelled = false;
    const sendDueScheduledDrafts = () => {
      const now = Date.now();
      const dueDrafts = readHomeMailDrafts(companyID, currentUserID).filter((draft) => {
        const scheduledAtMs = scheduledSendTimestamp(draft.scheduledAt);
        return !draft.sharedDraft && Number.isFinite(scheduledAtMs) && scheduledAtMs <= now && !scheduledMailDraftsInFlightRef.current.has(draft.id);
      });
      for (const draft of dueDrafts) {
        scheduledMailDraftsInFlightRef.current.add(draft.id);
        const scheduledCompose = { ...homeMailDraftToCompose(draft), scheduledAt: "" };
        void sendHomeMailComposeCommand({
          companyID,
          sharedInboxID: draft.sharedInboxID || undefined,
          compose: scheduledCompose,
          connectedAccountEmail: draft.accountEmail,
        })
          .then((result) => {
            if (cancelled) return;
            const replyThreadID = scheduledCompose.replyToMessage?.thread_id?.trim() ?? "";
            const sentMessage = !result.sentMessage.thread_id?.trim() && replyThreadID
              ? { ...result.sentMessage, thread_id: replyThreadID }
              : result.sentMessage;
            const deleting = deleteHomeMailDraftRemote(companyID, currentUserID, draft.id);
            setMailDraftsForScopeIfActive(
              readHomeMailDraftsForScope(companyID, currentUserID, draft.sharedInboxID, draft.accountEmail),
              draft.sharedInboxID,
              draft.accountEmail,
            );
            void deleting.then((drafts) => {
              if (!cancelled) setMailDraftsForScopeIfActive(drafts, draft.sharedInboxID, draft.accountEmail);
            });
            const scheduledMailboxStillActive = activeEmailMailboxScopeKeyRef.current === emailMailboxScopeKey(
              companyID,
              currentUserID,
              draft.accountEmail,
              draft.sharedInboxID,
            );
            if (scheduledMailboxStillActive) {
              setNotice("Scheduled message sent.");
              const replyToMessageID = scheduledCompose.replyToMessageID.trim();
              if (replyToMessageID) {
                addLocalEmailReply(replyToMessageID, sentMessage, {
                  companyID,
                  sharedInboxID: draft.sharedInboxID || undefined,
                  userID: currentUserID,
                  accountEmail: draft.accountEmail,
                });
                setSelectedMessage((current) => current?.id === replyToMessageID ? addLocalReplyToEmailMessage(current, sentMessage) : current);
                setSelectedThreadMessages((previous) => mergeEmailThreadDetailMessages(previous, [sentMessage]));
              }
              const sentParams = currentMessageListParams();
              if (emailMessageMatchesListFilters(sentMessage, sentParams)) {
                setMessages((previous) => mergeEmailMessageIntoMessageList(previous, sentMessage, sentParams, {
                  prependIfMissing: true,
                  maxMessages: Math.max(MESSAGE_BATCH_SIZE, previous.length + 1),
                }));
              }
            }
          })
          .catch(async (scheduledSendError) => {
            if (isOutboundEmailUndoneError(scheduledSendError)) {
              const unscheduledCompose = { ...homeMailDraftToCompose(draft), scheduledAt: "" };
              try {
                const drafts = await syncHomeMailDraftFromCompose(companyID, currentUserID, unscheduledCompose, "");
                if (!cancelled) {
                  setMailDraftsForScopeIfActive(drafts, draft.sharedInboxID, draft.accountEmail);
                  setNotice("Scheduled send undone; draft kept without a send time.");
                }
              } catch (unscheduleError) {
                if (!cancelled) {
                  setMailDraftsForScopeIfActive(
                    readHomeMailDraftsForScope(companyID, currentUserID, draft.sharedInboxID, draft.accountEmail),
                    draft.sharedInboxID,
                    draft.accountEmail,
                  );
                  setError(formatError(unscheduleError, "Send was undone, but clearing its schedule failed to sync"));
                }
              }
            } else if (!cancelled) {
              setError(formatError(scheduledSendError, "Failed to send scheduled message"));
            }
          })
          .finally(() => {
            scheduledMailDraftsInFlightRef.current.delete(draft.id);
          });
      }
    };
    sendDueScheduledDrafts();
    const timerID = window.setInterval(sendDueScheduledDrafts, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timerID);
    };
  }, [companyID, currentMessageListParams, currentUserID, setMailDraftsForScopeIfActive]);
  const requestSharedInboxEmailConnection = useCallback((connectionError: unknown, accountEmail: string, createIntent?: CommunicationsSharedInboxCreateIntent): boolean => {
    const cleanAccountEmail = accountEmail.trim().toLowerCase();
    if (!cleanAccountEmail || !isSharedInboxEmailConnectionError(connectionError)) return false;
    setSharedInboxEmailConnectionDialog({ accountEmail: cleanAccountEmail, canConnect: true, createIntent });
    return true;
  }, []);
  const startSharedInboxEmailConnection = useCallback(async (provider: EmailProvider) => {
    const accountEmail = sharedInboxEmailConnectionDialog?.accountEmail.trim().toLowerCase() ?? "";
    if (!accountEmail || sharedInboxEmailConnectionDialog?.canConnect === false) return;
    if (!currentUserCanManageSharedInboxStructure) {
      setError("Only managers and admins can connect shared inbox emails.");
      return;
    }
    setBusy("shared-inbox-connect");
    setError("");
    try {
      const authURL = await fetchCommunicationsAuthURL(provider, accountEmail, sharedInboxEmailConnectionDialog?.createIntent);
      window.location.assign(authURL);
    } catch (connectError) {
      setBusy("");
      setError(formatError(connectError, "Failed to start shared inbox email connection"));
    }
  }, [currentUserCanManageSharedInboxStructure, sharedInboxEmailConnectionDialog]);
  const setSharedInboxAccountEmail = useCallback(async (folderID: string, accountEmail: string): Promise<void> => {
    if (!currentUserCanManageSharedInboxStructure) {
      setError("Only managers and admins can assign Shared Triage emails.");
      return;
    }
    if (accountEmail.trim() && sharedInboxes.some((folder) => (folder.parent_folder_id ?? "").trim() === folderID.trim())) {
      setError("Parent folders cannot have emails assigned.");
      return;
    }
    setBusy("shared-inbox");
    setError("");
    setNotice("");
    try {
      const result = await updateSharedInboxAccountEmailCommand({ companyID, folderID, accountEmail });
      if (!result) return;
      const folder = result.folder;
      setSharedInboxes((previous) => sortSharedInboxes(previous.map((item) => item.folder_id === folder.folder_id ? folder : item)));
      if (result.notice) setNotice(result.notice);
      if (folder.entry_type === "shared_inbox" && (folder.account_email ?? "").trim()) {
        selectHomeView(`shared:${folder.folder_id}` as HomeViewID, "primary");
        setPendingSharedInboxMessageRefreshID(folder.folder_id);
      }
    } catch (sharedInboxError) {
      if (requestSharedInboxEmailConnection(sharedInboxError, accountEmail, { companyID, folderID })) return;
      setError(formatError(sharedInboxError, "Failed to update Shared Triage email"));
    } finally {
      setBusy("");
    }
  }, [companyID, currentUserCanManageSharedInboxStructure, requestSharedInboxEmailConnection, selectHomeView, sharedInboxes]);

  const assignActiveSharedInboxEmail = useCallback(() => {
    if (!activeSharedInbox) return;
    if (!currentUserCanManageSharedInboxStructure) {
      setError("Only managers and admins can assign Shared Triage emails.");
      return;
    }
    if (activeSharedInboxIsParent) {
      setError("Parent folders cannot have emails assigned.");
      return;
    }
    const initialEmail = (activeSharedInbox.account_email ?? connection?.account_email ?? "").trim().toLowerCase();
    setSharedInboxEmailAssignmentDialog({
      folderID: activeSharedInbox.folder_id,
      folderName: activeSharedInbox.name,
      draft: initialEmail,
      error: "",
    });
  }, [activeSharedInbox, activeSharedInboxIsParent, connection?.account_email, currentUserCanManageSharedInboxStructure]);
  const submitSharedInboxEmailAssignment = useCallback(() => {
    if (!sharedInboxEmailAssignmentDialog || busy === "shared-inbox") return;
    const accountEmail = sharedInboxEmailAssignmentDialog.draft.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) {
      setSharedInboxEmailAssignmentDialog((current) => current ? { ...current, error: "Enter a valid email address." } : current);
      return;
    }
    const folderID = sharedInboxEmailAssignmentDialog.folderID;
    setSharedInboxEmailAssignmentDialog(null);
    void setSharedInboxAccountEmail(folderID, accountEmail);
  }, [busy, setSharedInboxAccountEmail, sharedInboxEmailAssignmentDialog]);
  const currentDirectSharedInboxRACIAssignments = useCallback((folderID: string): Array<{ role: CommunicationsSharedInboxRACIRole; principal_type: CommunicationsSharedInboxRACIPrincipalType; principal_id: string }> => {
    const cleanFolderID = folderID.trim();
    const folder = sharedInboxes.find((item) => item.folder_id === cleanFolderID);
    return (folder?.gvic_assignments ?? [])
      .filter((assignment) => assignment.folder_id === cleanFolderID)
      .map((assignment) => {
        const principalType = (assignment.principal_type?.trim() || "user") as CommunicationsSharedInboxRACIPrincipalType;
        const principalID = assignment.principal_id?.trim() || assignment.user_id.trim();
        return { role: assignment.role, principal_type: principalType, principal_id: principalID };
      })
      .filter((assignment) => assignment.principal_id);
  }, [sharedInboxes]);

  const saveSharedInboxRACIAssignments = useCallback(async (
    folderID: string,
    assignments: Array<{ role: CommunicationsSharedInboxRACIRole; principal_type: CommunicationsSharedInboxRACIPrincipalType; principal_id: string }>,
  ): Promise<void> => {
    const cleanFolderID = folderID.trim();
    if (!cleanFolderID) return;
    setBusy("shared-inbox-RACI");
    setError("");
    setNotice("");
    try {
      const nextAssignments = await updateCommunicationsSharedInboxRACIAssignments(companyID, cleanFolderID, assignments);
      setSharedInboxes((previous) => previous.map((folder) => (
        folder.folder_id === cleanFolderID ? { ...folder, gvic_assignments: nextAssignments } : folder
      )));
      await loadSharedInboxes();
    } catch (RACIError) {
      setError(formatError(RACIError, "Failed to update Shared Triage RACI"));
    } finally {
      setBusy("");
    }
  }, [companyID, loadSharedInboxes]);

  const addSharedInboxRACIPrincipal = useCallback((
    folderID: string,
    role: CommunicationsSharedInboxRACIRole,
    principalType: CommunicationsSharedInboxRACIPrincipalType,
    principalID: string,
  ) => {
    const cleanPrincipalID = principalID.trim();
    if (!cleanPrincipalID) return;
    const direct = currentDirectSharedInboxRACIAssignments(folderID);
    if (direct.some((assignment) => assignment.role === role && assignment.principal_type === principalType && assignment.principal_id === cleanPrincipalID)) return;
    void saveSharedInboxRACIAssignments(folderID, [...direct, { role, principal_type: principalType, principal_id: cleanPrincipalID }]);
  }, [currentDirectSharedInboxRACIAssignments, saveSharedInboxRACIAssignments]);

  const removeSharedInboxRACIPrincipal = useCallback((
    folderID: string,
    role: CommunicationsSharedInboxRACIRole,
    principalType: CommunicationsSharedInboxRACIPrincipalType,
    principalID: string,
  ) => {
    const cleanPrincipalID = principalID.trim();
    if (!cleanPrincipalID) return;
    const direct = currentDirectSharedInboxRACIAssignments(folderID);
    void saveSharedInboxRACIAssignments(folderID, direct.filter((assignment) => (
      assignment.role !== role || assignment.principal_type !== principalType || assignment.principal_id !== cleanPrincipalID
    )));
  }, [currentDirectSharedInboxRACIAssignments, saveSharedInboxRACIAssignments]);

  const nodeByID = useMemo(() => new Map(nodes.map((node) => [node.node_id, node])), [nodes]);
  const companyUserByID = useMemo(() => new Map(companyUsers.map((user) => [user.user_id, user])), [companyUsers]);
  const allNodeRows = useMemo(() => buildCompanyExplorerTreeRows({
    expanded: nodeExpandedIDs,
    nodes,
    logicGates: [],
    projects: [],
    kanbanBoards: [],
    folders: nodeFolders,
    folderItems: nodeFolderItems,
    rootRowOrder: {},
  }).filter((row) => row.kind === "folder" || row.kind === "node"), [nodeExpandedIDs, nodeFolderItems, nodeFolders, nodes]);
  const visibleNodeRows = useMemo(() => filterExplorerRowsForSearch(allNodeRows, nodeSearch), [allNodeRows, nodeSearch]);
  const logicGateByID = useMemo(() => new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate])), [logicGates]);
  const logicGateByIDRef = useRef(logicGateByID);
  logicGateByIDRef.current = logicGateByID;
  const activeRACIInboxSection = gvicInboxSectionForView(activeViewID);
  const matrixFilteredNodes = useMemo(() => (
    isInboxMatrixView && matrixAccountFilterIDs.length > 0
      ? nodes.filter((node) => entityMatchesAccountFilter(node, matrixAccountFilterIDs))
      : nodes
  ), [isInboxMatrixView, matrixAccountFilterIDs, nodes]);
  const matrixAccountFilterControl = useMemo(() => (
    <AccountFilterControl
      accounts={matrixAccounts}
      selectedAccountIDs={matrixAccountFilterIDs}
      onChange={setMatrixAccountFilterIDs}
      label="Accounts"
      placeholder="Filter accounts"
      compact
    />
  ), [matrixAccountFilterIDs, matrixAccounts]);
  const workspacePanelUserID = isInboxMatrixView ? activeRACIMatrixUserID : currentUserID;
  useEffect(() => {
    if (!companyID || nodes.length === 0) return undefined;
    if (isArchivableHomeViewID(activeViewID)) return undefined;
    const now = Date.now();
    const failedRepairIDs = missingLogicGateRepairFailureIDsRef.current;
    for (const [logicGateID, retryAfter] of failedRepairIDs.entries()) {
      if (retryAfter <= now) failedRepairIDs.delete(logicGateID);
    }
    const missingIDs = missingLogicGateRecordIDs(nodes, logicGateByID)
      .filter((logicGateID) => (failedRepairIDs.get(logicGateID) ?? 0) <= now);
    if (missingIDs.length === 0) return undefined;
    let cancelled = false;
    const titleVersionAtStart = readCommittedEntityTitleVersion();
    const fetched: LogicGateRecord[] = [];
    let nextIndex = 0;
    const runRepairWorker = async () => {
      while (!cancelled) {
        const index = nextIndex;
        nextIndex += 1;
        const logicGateID = missingIDs[index];
        if (!logicGateID) return;
        try {
          const details = await getLogicGateRecordSingleFlight(apiBase, companyID, logicGateID);
          if (details.logic_gate) {
            failedRepairIDs.delete(logicGateID);
            fetched.push(details.logic_gate);
          }
        } catch {
          failedRepairIDs.set(logicGateID, Date.now() + MISSING_LOGIC_GATE_REPAIR_FAILURE_TTL_MS);
        }
      }
    };
    const workerCount = Math.min(MISSING_LOGIC_GATE_REPAIR_CONCURRENCY, missingIDs.length);
    void Promise.all(Array.from({ length: workerCount }, runRepairWorker)).then(() => {
      if (cancelled) return;
      if (fetched.length === 0) return;
      setLogicGates((previous) => {
        const reconciledFetched = foldCommittedEntityTitlesSince(
          fetched, companyID, titleVersionAtStart,
          reconcileCommittedLogicGateRecordTitles,
        );
        const byID = new Map(previous.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
        let changed = false;
        for (const logicGate of reconciledFetched) {
          const current = byID.get(logicGate.logic_gate_id);
          if (current?.header === logicGate.header && current?.gvic_assignments === logicGate.gvic_assignments) continue;
          byID.set(logicGate.logic_gate_id, logicGate);
          changed = true;
        }
        return changed ? Array.from(byID.values()) : previous;
      });
    });
    return () => { cancelled = true; };
  }, [activeViewID, apiBase, companyID, logicGateByID, nodes]);
  const myNodes = useMemo(() => {
    if (!workspacePanelUserID) return [];
    return nodes.filter((node) => cleanIDList(node.logic_gate_ids ?? []).some((logicGateID) => logicGateHasAnyRACIRole(logicGateByID.get(logicGateID), workspacePanelUserID)));
  }, [logicGateByID, nodes, workspacePanelUserID]);
  const assignedMyLogicGates = useMemo(() => {
    if (!workspacePanelUserID) return [];
    return logicGates.filter((logicGate) => logicGateHasAnyRACIRole(logicGate, workspacePanelUserID));
  }, [logicGates, workspacePanelUserID]);
  const assignedMyLogicGateIDs = useMemo(() => new Set(assignedMyLogicGates.map((logicGate) => logicGate.logic_gate_id)), [assignedMyLogicGates]);
  const myLogicGateNodes = useMemo(() => (
    myNodes.filter((node) => cleanIDList(node.logic_gate_ids ?? []).some((logicGateID) => assignedMyLogicGateIDs.has(logicGateID)))
  ), [assignedMyLogicGateIDs, myNodes]);
  const otherAssignedNodes = useMemo(() => (
    myNodes
      .filter((node) => cleanIDList(node.logic_gate_ids ?? []).length === 0)
      .sort((a, b) => (
        nodeTitle(a).localeCompare(nodeTitle(b), undefined, { numeric: true, sensitivity: "base" })
        || a.node_id.localeCompare(b.node_id)
      ))
  ), [myNodes]);
  const myNodeGroups = useMemo(() => buildMyNodeGroups({
    nodes: myLogicGateNodes,
    logicGateFolders,
    logicGateFolderItems,
  }), [logicGateFolderItems, logicGateFolders, myLogicGateNodes]);
  const logicGateCanvasRecords = useMemo(() => logicGates.map((logicGate) => ({
    ...logicGate,
    node_id: logicGate.logic_gate_id,
    title: logicGate.header,
  })), [logicGates]);
  const allLogicGateRows = useMemo(() => buildCompanyExplorerTreeRows({
    expanded: logicGateExpandedIDs,
    nodes: [],
    logicGates: logicGateCanvasRecords,
    projects: [],
    kanbanBoards: [],
    folders: logicGateFolders,
    folderItems: logicGateFolderItems,
    rootRowOrder: {},
  }).filter((row) => row.kind === "folder" || row.kind === "logic_gate"), [logicGateCanvasRecords, logicGateExpandedIDs, logicGateFolderItems, logicGateFolders]);
  const visibleLogicGateRows = useMemo(() => filterExplorerRowsForSearch(allLogicGateRows, logicGateSearch), [allLogicGateRows, logicGateSearch]);
  const shortcutLogicGateIDs = useMemo(() => new Set(myLogicGateShortcuts.map((shortcut) => shortcut.logic_gate_id)), [myLogicGateShortcuts]);
  const myLogicGateGroups = useMemo(() => buildMyLogicGateGroups({
    shortcuts: myLogicGateShortcuts,
    assignedLogicGates: assignedMyLogicGates,
    logicGateByID,
    folders: logicGateFolders,
    folderItems: logicGateFolderItems,
  }), [assignedMyLogicGates, logicGateByID, logicGateFolderItems, logicGateFolders, myLogicGateShortcuts]);
  const myLogicGateOrderedRowIDs = useMemo(() => myLogicGateGroups
    .flatMap((group) => group.logicGates.map((logicGate) => logicGateTreeID(logicGate.logic_gate_id))), [myLogicGateGroups]);
  const activeRACIRoleLogicGates = useMemo(() => {
    const role = activeRACIInboxSection?.role;
    if (!workspacePanelUserID || !role || role === "other") return [];
    return logicGates.filter((logicGate) => logicGateHasRACIRole(logicGate, role, workspacePanelUserID));
  }, [activeRACIInboxSection?.role, logicGates, workspacePanelUserID]);
  const activeRACIRoleLogicGateGroups = useMemo(() => buildMyLogicGateGroups({
    shortcuts: [],
    assignedLogicGates: activeRACIRoleLogicGates,
    logicGateByID,
    folders: logicGateFolders,
    folderItems: logicGateFolderItems,
  }), [activeRACIRoleLogicGates, logicGateByID, logicGateFolderItems, logicGateFolders]);
  const RACIMatrixDirectoryUsers = useMemo(() => {
    const users = [...companyUsers];
    if (currentUserID && !users.some((user) => user.user_id.trim() === currentUserID)) {
      users.push({
        company_id: companyID,
        user_id: currentUserID,
        email: me?.user.email ?? "",
        display_name: me?.user.display_name ?? "",
        role: "",
      });
    }
    return users.sort((left, right) => (
      homeCompanyUserLabel(left, left.user_id).localeCompare(homeCompanyUserLabel(right, right.user_id), undefined, { numeric: true, sensitivity: "base" }) ||
      left.user_id.localeCompare(right.user_id)
    ));
  }, [companyID, companyUsers, currentUserID, me?.user.display_name, me?.user.email]);
  const gvicMatrixViewerSelectorElement = (
    <RACIMatrixViewerSelector
      companyUsers={RACIMatrixDirectoryUsers}
      groups={companyUserGroups}
      groupMembers={companyUserGroupMembers}
      currentUserID={currentUserID}
      selectedUserID={activeRACIMatrixUserID}
      entries={RACIMatrixViewerListEntries}
      onEntriesChange={updateRACIMatrixViewerListEntries}
      onSelectUser={setRACIMatrixTargetUserID}
    />
  );
  const markMessageReadFromListSelection = useCallback((message: EmailMessage) => {
    if (!shouldAutoMarkEmailSelectionRead(unreadOnlyRef.current) || !message.id.trim() || !message.unread) return;
    const requestViewID = activeViewIDRef.current;
    const requestMailbox = mailboxRef.current;
    if (!isArchivableHomeViewID(requestViewID) || requestMailbox === "drafts") return;
    if (!emailMessageUsesActiveProviderScope(message, requestViewID, currentUserID, activeMailAccountEmail)) return;
    const requestSharedInboxID = sharedInboxIDForHomeView(requestViewID);
    const requestAccountEmail = requestSharedInboxID ? "" : activeMailAccountEmail;
    const requestEmailMailboxScopeKey = activeEmailMailboxScopeKeyRef.current;
    const requestUserID = currentUserID;
    const requestSelectionGeneration = messageSelectionGenerationRef.current;
    const requestRealtimeScope = requestSharedInboxID ? realtimeSharedMailboxScope(requestSharedInboxID) : realtimePersonalMailboxScope(requestUserID, requestAccountEmail);
    const requestFilterKey = messageListFilterKey(
      companyID,
      requestViewID,
      requestMailbox,
      searchQueryRef.current,
      unreadOnlyRef.current,
      requestEmailMailboxScopeKey,
      messageListOrderRef.current,
    );
    const requestListParams = {
      limit: MESSAGE_BATCH_SIZE,
      mailbox: requestMailbox,
      companyID,
      sharedInboxID: requestSharedInboxID,
      accountEmail: requestAccountEmail || undefined,
      q: searchQueryRef.current,
      unread: unreadOnlyRef.current ? true : undefined,
    };
    const selectedThreadKey = emailThreadKey(message);
    const requestStillOwnsMailboxScope = () => (
      activeViewIDRef.current === requestViewID
      && mailboxRef.current === requestMailbox
      && activeEmailMailboxScopeKeyRef.current === requestEmailMailboxScopeKey
    );
    const requestStillOwnsVisibleList = () => (
      requestStillOwnsMailboxScope()
      && currentMessageFilterKey() === requestFilterKey
    );
    const selectedThreadStillActive = () => {
      const current = selectedMessageRef.current;
      return requestStillOwnsMailboxScope()
        && messageSelectionGenerationRef.current === requestSelectionGeneration
        && !!current
        && emailThreadKey(current) === selectedThreadKey;
    };
    const messagesToMark = unreadEmailThreadMessagesForSelection(messagesRef.current, message);
    const markUnreadMessageRead = (messageToMark: EmailMessage) => {
      const messageID = messageToMark.id.trim();
      if (!messageID) return;
      const messageRowKey = emailMessageRowKey(messageToMark);
      const messageKey = emailMailboxMessageKey(requestEmailMailboxScopeKey, messageID);
      const mutationToken = nextMarkReadMutationTokenRef.current + 1;
      nextMarkReadMutationTokenRef.current = mutationToken;
      markReadMutationTokenByMessageKeyRef.current.set(messageKey, mutationToken);
      locallyReadMessageKeysRef.current.add(messageKey);
      const finishMutationIfOwned = (keepLocalReadOverlay: boolean): boolean => {
        if (markReadMutationTokenByMessageKeyRef.current.get(messageKey) !== mutationToken) return false;
        markReadMutationTokenByMessageKeyRef.current.delete(messageKey);
        if (!keepLocalReadOverlay) locallyReadMessageKeysRef.current.delete(messageKey);
        return true;
      };
      const optimistic = { ...messageToMark, unread: false };
      setMessages((previous) => mergeEmailMessageIntoScopedMessageList(previous, optimistic, requestListParams));
      setSelectedMessage((current) => (current && emailMessageRowKey(current) === messageRowKey ? { ...current, unread: false } : current));
      setSelectedThreadMessages((previous) => mergeEmailThreadDetailMessages(previous, [optimistic]));
      const existingTimerID = delayedMarkReadTimerByMessageKeyRef.current.get(messageKey);
      if (existingTimerID !== undefined) {
        window.clearTimeout(existingTimerID);
        delayedMailRequestTimerIDsRef.current.delete(existingTimerID);
      }
      const timerID = window.setTimeout(() => {
        delayedMailRequestTimerIDsRef.current.delete(timerID);
        if (delayedMarkReadTimerByMessageKeyRef.current.get(messageKey) === timerID) {
          delayedMarkReadTimerByMessageKeyRef.current.delete(messageKey);
        }
        if (currentUserIDRef.current !== requestUserID) {
          finishMutationIfOwned(false);
          return;
        }
        rememberLocalMailboxMutationEchoes("message.updated", [messageID], requestRealtimeScope);
        void updateHomeMailMessageCommand({
          companyID,
          sharedInboxID: requestSharedInboxID,
          accountEmail: requestAccountEmail || undefined,
          messageID,
          update: { unread: false },
        })
          .then((result) => {
            if (currentUserIDRef.current !== requestUserID) {
              finishMutationIfOwned(false);
              return;
            }
            if (!finishMutationIfOwned(true)) return;
            if (!result) return;
            const readUpdated = {
              ...result.message,
              unread: false,
              client_source_scope_key: messageToMark.client_source_scope_key,
            };
            if (requestStillOwnsVisibleList()) {
              setMessages((previous) => mergeEmailMessageIntoScopedMessageList(previous, readUpdated, requestListParams));
            }
            const threadStillActive = selectedThreadStillActive();
            if (threadStillActive) {
              setSelectedThreadMessages((previous) => mergeEmailThreadDetailMessages(previous, [readUpdated]));
            }
            if (threadStillActive && selectedMessageRowKeyRef.current === messageRowKey) {
              setSelectedMessage((current) => (current && emailMessageRowKey(current) === messageRowKey ? {
                ...current,
                ...readUpdated,
                local_replies: current.local_replies ?? readUpdated.local_replies,
              } : current));
            }
          })
          .catch((markError) => {
            forgetLocalMailboxMutationEchoes("message.updated", [messageID], requestRealtimeScope);
            if (currentUserIDRef.current !== requestUserID) {
              finishMutationIfOwned(false);
              return;
            }
            if (!finishMutationIfOwned(false)) return;
            invalidateEmailMessageCache(messageID, companyID, requestSharedInboxID, requestAccountEmail);
            const rollback = { ...messageToMark, unread: true };
            if (requestStillOwnsVisibleList()) {
              setMessages((previous) => mergeEmailMessageIntoScopedMessageList(previous, rollback, requestListParams, { prependIfMissing: true }));
            }
            if (selectedThreadStillActive()) {
              setSelectedThreadMessages((previous) => mergeEmailThreadDetailMessages(previous, [rollback]));
              if (selectedMessageRowKeyRef.current === messageRowKey) {
                setSelectedMessage((current) => current && emailMessageRowKey(current) === messageRowKey ? { ...current, unread: true } : current);
              }
            }
            if (!requestStillOwnsVisibleList()) return;
            if (isEmailAccessExpiredError(markError)) {
              if (requestSharedInboxID) {
                const sharedInbox = sharedInboxesRef.current.find((item) => (
                  item.folder_id === requestSharedInboxID || item.shared_inbox_id === requestSharedInboxID
                ));
                const accountEmail = sharedInbox?.account_email?.trim().toLowerCase() ?? "";
                if (accountEmail) {
                  showSharedInboxEmailConnectionIssue(requestSharedInboxID, accountEmail);
                } else {
                  setError(formatError(markError, "Shared inbox email access expired."));
                }
                return;
              }
              void handleEmailAccessExpired(markError);
              return;
            }
            setError(formatError(markError, "Failed to mark message read"));
            scheduleMessageListRefresh();
          });
      }, EMAIL_DETAIL_FOREGROUND_GRACE_MS);
      delayedMailRequestTimerIDsRef.current.add(timerID);
      delayedMarkReadTimerByMessageKeyRef.current.set(messageKey, timerID);
    };
    for (const unreadMessage of messagesToMark) {
      markUnreadMessageRead(unreadMessage);
    }
  }, [activeMailAccountEmail, companyID, currentMessageFilterKey, currentUserID, forgetLocalMailboxMutationEchoes, handleEmailAccessExpired, rememberLocalMailboxMutationEchoes, scheduleMessageListRefresh, showSharedInboxEmailConnectionIssue]);
  const selectMessageRow = useCallback((message: EmailMessage, modifiers: MessageSelectionModifiers) => {
    activeDeleteSelectionKindRef.current = "message";
    if (compose.open) {
      saveCurrentComposeDraft({ quiet: true });
      setCompose(emptyCompose);
    }
    const clickedRowKey = emailMessageRowKey(message);
    const orderedIDs = messages.map(emailMessageRowKey);
    const next = resolveExplorerClickSelection({
      orderedIDs,
      previousSelectedIDs: selectedMessageIDs,
      anchorID: selectionAnchorMessageID,
      clickedID: clickedRowKey,
      shiftKey: modifiers.shiftKey,
      ctrlKey: modifiers.ctrlKey || modifiers.metaKey,
    });
    if (next.selectedIDs.size === 0) next.selectedIDs.add(clickedRowKey);
    const orderedSelectedIDs = orderedIDs.filter((id) => next.selectedIDs.has(id));
    const primaryRowKey = next.selectedIDs.has(clickedRowKey) ? clickedRowKey : (orderedSelectedIDs[0] ?? clickedRowKey);
    const primaryMessage = messages.find((item) => emailMessageRowKey(item) === primaryRowKey) ?? message;
    const primaryID = primaryMessage.id;
    const previousPrimaryMessage = selectedMessageRef.current;
    const visiblePrimaryMessage = previousPrimaryMessage && emailMessageRowKey(previousPrimaryMessage) === primaryRowKey
      ? mergeEmailDetailMessage(previousPrimaryMessage, primaryMessage)
      : primaryMessage;
    messageSelectionGenerationRef.current += 1;
    selectedMessageIDRef.current = primaryID;
    selectedMessageRowKeyRef.current = primaryRowKey;
    selectedMessageRef.current = visiblePrimaryMessage;
    setSelectedMessageIDs(new Set(orderedSelectedIDs));
    setSelectionAnchorMessageID(next.anchorID);
    setSelectedMessageID(primaryID);
    setSelectedMessageRowKey(primaryRowKey);
    setSelectedMessage(visiblePrimaryMessage);
    const preserveCurrentThread = previousPrimaryMessage
      ? emailThreadKey(previousPrimaryMessage) === emailThreadKey(visiblePrimaryMessage)
      : false;
    setSelectedThreadMessages((current) => preserveCurrentThread
      ? mergeEmailThreadDetailMessages(current, [visiblePrimaryMessage])
      : [visiblePrimaryMessage]);
    setMessageContextMenu(null);
    if (mailboxRef.current === "drafts" || homeMessageIsDraft(visiblePrimaryMessage)) {
      const draft = activeMailDrafts.find((item) => item.id === primaryID);
      if (draft) {
        setCompose(homeMailDraftToCompose(draft));
        const replyToMessageID = draft.replyToMessageID.trim();
        if (replyToMessageID && !draft.replyToMessage) {
          void getEmailMessage(replyToMessageID, companyID, draft.sharedInboxID || undefined, {
            userID: currentUserID,
            accountEmail: draft.accountEmail,
          })
            .then((message) => {
              setCompose((current) => current.draftID === draft.id ? { ...current, replyToMessage: message } : current);
            })
            .catch(() => {});
        }
      }
      return;
    }
    markMessageReadFromListSelection(visiblePrimaryMessage);
  }, [activeMailDrafts, companyID, compose.open, markMessageReadFromListSelection, messages, saveCurrentComposeDraft, selectedMessageIDs, selectionAnchorMessageID]);
  const openMessageContextMenu = useCallback((message: EmailMessage, event: React.MouseEvent) => {
    event.preventDefault();
    activeDeleteSelectionKindRef.current = "message";
    const messageRowKey = emailMessageRowKey(message);
    const nextKeys = selectedMessageIDs.has(messageRowKey) ? Array.from(selectedMessageIDs) : [messageRowKey];
    const nextMessages = messages.filter((candidate) => nextKeys.includes(emailMessageRowKey(candidate)));
    const nextIDs = cleanIDList(nextMessages.map((candidate) => candidate.id));
    messageSelectionGenerationRef.current += 1;
    selectedMessageIDRef.current = message.id;
    selectedMessageRowKeyRef.current = messageRowKey;
    selectedMessageRef.current = message;
    setSelectedMessageIDs(new Set(nextKeys));
    setSelectionAnchorMessageID(messageRowKey);
    setSelectedMessageID(message.id);
    setSelectedMessageRowKey(messageRowKey);
    setSelectedMessage(message);
    setSelectedThreadMessages([message]);
    setMessageContextMenu({ x: event.clientX, y: event.clientY, messageIDs: nextIDs });
  }, [messages, selectedMessageIDs]);
  const startMessageDrag = useCallback((message: EmailMessage, event: React.DragEvent<HTMLElement>) => {
    const triageView = isArchivableHomeViewID(activeViewID);
    if (!triageView || !canDragTriageMessageFromMailbox(mailboxRef.current)) return;
    const messageRowKey = emailMessageRowKey(message);
    const selectedMessages = selectedMessageIDs.has(messageRowKey)
      ? messages.filter((candidate) => selectedMessageIDs.has(emailMessageRowKey(candidate)))
      : [message];
    if (selectedMessages.some((candidate) => !emailMessageUsesActiveProviderScope(
      candidate,
      activeViewIDRef.current,
      currentUserID,
      activeMailAccountEmail,
    ))) {
      event.preventDefault();
      return;
    }
    const messageIDs = cleanIDList(selectedMessages.map((candidate) => candidate.id));
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(TRIAGE_MESSAGE_DRAG_MIME, JSON.stringify({
      kind: "triage_messages",
      company_id: companyID,
      message_ids: messageIDs,
      shared_inbox_id: sharedInboxID || undefined,
      account_email: sharedInboxID ? undefined : activeMailAccountEmail.trim().toLowerCase() || undefined,
    }));
    event.dataTransfer.setData("text/plain", messageIDs.join(","));
  }, [activeMailAccountEmail, activeViewID, companyID, currentUserID, messages, selectedMessageIDs]);
  const getSelectedMessagesForAction = useCallback((): EmailMessage[] => {
    const selected = messages.filter((message) => selectedMessageIDs.has(emailMessageRowKey(message)));
    if (selectedMessage && !selected.some((message) => emailMessageRowKey(message) === selectedMessageRowKey)) {
      selected.unshift(selectedMessage);
    }
    return selected;
  }, [messages, selectedMessage, selectedMessageIDs, selectedMessageRowKey]);
  const getSelectedMessageIDsForAction = useCallback((): string[] => {
    return cleanIDList(getSelectedMessagesForAction().map((message) => message.id));
  }, [getSelectedMessagesForAction]);
  const requestDeleteMessages = useCallback((messageIDs: string[], position?: ConfirmActionMenuPosition) => {
    if (!canMutateCurrentMailView) return;
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    if (mailboxRef.current !== "drafts" && !providerMutationAvailableForMessageIDs(ids)) return;
    setDeleteConfirmation({ messageIDs: ids, position: position ?? null });
  }, [canMutateCurrentMailView, providerMutationAvailableForMessageIDs]);
  const deleteDraftMessages = useCallback((messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    setError("");
    const includesSharedDraft = activeMailDrafts.some((draft) => draft.sharedDraft && ids.includes(draft.id));
    const sharedInboxID = activeSharedInboxFolderID;
    const accountEmail = activeMailAccountEmail;
    setBusy("delete-drafts");
    void deleteHomeMailDraftsRemote(companyID, currentUserID, ids)
      .then((drafts) => {
        setMailDraftsForScopeIfActive(drafts, sharedInboxID, accountEmail);
        removeMessagesFromVisibleMailList(ids);
        if (compose.open && compose.draftID.trim() && ids.includes(compose.draftID.trim())) setCompose(emptyCompose);
        setSelectedMessageIDs(new Set());
        setSelectionAnchorMessageID("");
        setMessageContextMenu(null);
        setNotice(includesSharedDraft
          ? (ids.length === 1 ? "Shared draft discarded." : `${ids.length} drafts discarded.`)
          : (ids.length === 1 ? "Draft deleted." : `${ids.length} drafts deleted.`));
      })
      .catch((deleteError) => {
        setError(formatError(deleteError, includesSharedDraft
          ? "Shared draft changed. Your copy was preserved; reopen it and try again."
          : "Failed to delete draft"));
      })
      .finally(() => setBusy(""));
  }, [activeMailDrafts, activeMailAccountEmail, activeSharedInboxFolderID, companyID, compose.draftID, compose.open, currentUserID, removeMessagesFromVisibleMailList, setMailDraftsForScopeIfActive]);
  const requestDeleteSelection = useCallback(() => {
    requestDeleteMessages(getSelectedMessageIDsForAction());
  }, [getSelectedMessageIDsForAction, requestDeleteMessages]);
  const deleteSelected = useCallback(() => {
    if (!selectedMessage) return;
    requestDeleteSelection();
  }, [requestDeleteSelection, selectedMessage]);
  const deleteMessages = useCallback(async (messageIDs: string[]) => {
    if (!canMutateCurrentMailView) return;
    const realtimeScope = mailboxRealtimeTargetRef.current?.scope ?? "";
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    if (!providerMutationAvailableForMessageIDs(ids)) return;
    const owner = currentMailboxRequestOwner();
    if (!mailboxRequestOwnerIsCurrent(owner)) return;
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    const accountEmail = sharedInboxID ? undefined : activeMailAccountEmailRef.current;
    const countKey = homeMailboxCountKey(owner.mailboxScopeKey);
    const primaryCountAtStart = mailboxCountsFromFolders(foldersRef.current).primary ?? 0;
    const currentMailbox = mailboxRef.current;
    const deletedInboxCount = ids.reduce((count, id) => {
      if (currentMailbox === "primary") return count + 1;
      return count + (messagesRef.current.some((message) => message.id === id && messageHasInboxLabel(message)) ? 1 : 0);
    }, 0);
    setBusy("delete");
    setError("");
    try {
      rememberLocalMailboxMutationEchoes("message.deleted", ids, realtimeScope);
      await deleteHomeMailMessagesCommand({ companyID, sharedInboxID, accountEmail, messageIDs: ids });
      adjustPrimaryMailboxCount(countKey, -deletedInboxCount, primaryCountAtStart);
      if (!mailboxRequestOwnerIsCurrent(owner)) return;
      removeMessagesFromVisibleMailList(ids);
      if (selectedMessageID && ids.includes(selectedMessageID)) {
        setSelectedMessageID("");
        setSelectedMessage(null);
      }
      setSelectedMessageIDs(new Set());
      setSelectionAnchorMessageID("");
      setMessageContextMenu(null);
      setNotice(ids.length === 1 ? "Message deleted." : `${ids.length} messages deleted.`);
    } catch (deleteError) {
      forgetLocalMailboxMutationEchoes("message.deleted", ids, realtimeScope);
      if (!mailboxRequestOwnerIsCurrent(owner)) return;
      setError(formatError(deleteError, ids.length === 1 ? "Failed to delete message" : "Failed to delete messages"));
    } finally {
      if (mailboxRequestOwnerIsCurrent(owner)) setBusy("");
    }
  }, [adjustPrimaryMailboxCount, canMutateCurrentMailView, companyID, currentMailboxRequestOwner, forgetLocalMailboxMutationEchoes, mailboxRequestOwnerIsCurrent, providerMutationAvailableForMessageIDs, rememberLocalMailboxMutationEchoes, removeMessagesFromVisibleMailList, selectedMessageID]);
  const addShortcutsFromExplorerPayload = useCallback(async (payload: ExplorerDragPayload | null) => {
    setBusy("my-logic-gates");
    setError("");
    try {
      const result = await addMyLogicGateShortcutsCommand({
        companyID,
        payload,
        folders: logicGateFolders,
        folderItems: logicGateFolderItems,
      });
      if (!result) return;
      setMyLogicGateShortcuts((previous) => mergeLogicGateShortcuts(previous, result.shortcuts));
      setNotice(result.logicGateIDs.length === 1 ? "Added to My Logic Gates." : `${result.logicGateIDs.length} Logic Gates added.`);
    } catch (shortcutError) {
      setError(formatError(shortcutError, "Failed to add My Logic Gates"));
    } finally {
      setBusy("");
    }
  }, [companyID, logicGateFolderItems, logicGateFolders]);
  const removeShortcut = useCallback(async (logicGateID: string) => {
    if (!logicGateID.trim()) return;
    setBusy("my-logic-gates");
    setError("");
    try {
      const removedLogicGateID = await removeMyLogicGateShortcutCommand({ companyID, logicGateID });
      if (!removedLogicGateID) return;
      setMyLogicGateShortcuts((previous) => previous.filter((shortcut) => shortcut.logic_gate_id !== removedLogicGateID));
    } catch (shortcutError) {
      setError(formatError(shortcutError, "Failed to remove My Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [companyID]);
  const convertMessagesToLogicGate = useCallback(async (logicGateID: string, messageIDs: string[], priority: number) => {
    const ids = cleanIDList(messageIDs);
    if (!logicGateID || ids.length === 0) return;
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    setBusy("triage-convert");
    setError("");
    try {
      const conversion = await convertMessagesToLogicGateCommand({
        apiBase,
        companyID,
        logicGateID,
        sharedInboxID,
        accountEmail: sharedInboxID ? undefined : activeMailAccountEmail,
        messageIDs: ids,
        priority,
        invalidateKanbanBoardList: invalidateKanbanBoardListCache,
        invalidateKanbanBoardContents: invalidateKanbanBoardContentsCache,
        invalidateLogicGateArenaView: invalidateLogicGateArenaViewCache,
        invalidateNodeRecord: invalidateNodeRecordStoreCaches,
        upsertNodeRelationshipGraphNode,
        upsertNodeFolderItemInRelationshipGraph: upsertCompanyExplorerFolderItemInNodeRelationshipGraph,
        upsertLogicGateFolderItemInRelationshipGraph: upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph,
      });
      if (!conversion) return;
      for (const node of conversion.result.nodes ?? []) {
        setNodes((previous) => {
          const next = previous.filter((item) => item.node_id !== node.node_id);
          return [...next, node];
        });
      }
      for (const item of conversion.result.folder_items ?? []) {
        if (item.item_type !== "node") continue;
        setNodeFolderItems((previous) => {
          const next = previous.filter((candidate) => candidate.item_type !== item.item_type || candidate.item_id !== item.item_id);
          return [...next, item];
        });
      }
      const converted = conversion.convertedMessageIDs;
      reconcileConvertedMessageUnstars(conversion.unstarredMessageIDs);
      patchConvertedMessageLogicGatePlacement(converted, conversion.logicGateID || logicGateID, { sharedInboxID, accountEmail: sharedInboxID ? undefined : activeMailAccountEmail });
      const title = logicGateByID.get(logicGateID)?.header || "Logic Gate";
      showNoticeWithResourceAction(converted.length === 1 ? `Sent to ${title}.` : `${converted.length} messages sent to ${title}.`, { kind: "logic_gate", logicGateID });
    } catch (convertError) {
      setError(formatError(convertError, "Failed to send messages to Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [activeMailAccountEmail, apiBase, companyID, logicGateByID, patchConvertedMessageLogicGatePlacement, reconcileConvertedMessageUnstars, showNoticeWithResourceAction]);
  const selectLogicGateTreeID = useCallback((treeID: string, orderedIDs: string[], event: React.MouseEvent) => {
    activeDeleteSelectionKindRef.current = "logic_gate";
    const next = resolveExplorerClickSelection({
      orderedIDs,
      previousSelectedIDs: selectedLogicGateRowIDs,
      anchorID: logicGateSelectionAnchorID,
      clickedID: treeID,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey || event.metaKey,
    });
    setSelectedLogicGateRowIDs(next.selectedIDs);
    setLogicGateSelectionAnchorID(next.anchorID);
  }, [logicGateSelectionAnchorID, selectedLogicGateRowIDs]);
  const selectLogicGateRow = useCallback((row: ExplorerTreeNode, event: React.MouseEvent) => {
    selectLogicGateTreeID(row.id, visibleLogicGateRows.map((item) => item.id), event);
  }, [selectLogicGateTreeID, visibleLogicGateRows]);
  const selectLogicGateShortcut = useCallback((logicGateID: string, event: React.MouseEvent) => {
    selectLogicGateTreeID(logicGateTreeID(logicGateID), myLogicGateOrderedRowIDs, event);
  }, [myLogicGateOrderedRowIDs, selectLogicGateTreeID]);
  const selectNodeTreeID = useCallback((treeID: string, orderedIDs: string[], event: React.MouseEvent) => {
    activeDeleteSelectionKindRef.current = "node";
    const next = resolveExplorerClickSelection({
      orderedIDs,
      previousSelectedIDs: selectedNodeRowIDs,
      anchorID: nodeSelectionAnchorID,
      clickedID: treeID,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey || event.metaKey,
    });
    setSelectedNodeRowIDs(next.selectedIDs);
    setNodeSelectionAnchorID(next.anchorID);
  }, [nodeSelectionAnchorID, selectedNodeRowIDs]);
  const selectNodeRow = useCallback((row: ExplorerTreeNode, event: React.MouseEvent) => {
    selectNodeTreeID(row.id, visibleNodeRows.map((item) => item.id), event);
  }, [selectNodeTreeID, visibleNodeRows]);
  const selectNodeMatrixCard = useCallback((nodeID: string, orderedIDs: string[], event: React.MouseEvent) => {
    selectNodeTreeID(nodeTreeID(nodeID), orderedIDs, event);
  }, [selectNodeTreeID]);
  const getNodeDragIDs = useCallback((nodeID: string): string[] => {
    const cleanNodeID = nodeID.trim();
    if (!cleanNodeID) return [];
    if (!selectedNodeRowIDs.has(nodeTreeID(cleanNodeID))) return [cleanNodeID];
    const selectedNodeIDs = cleanIDList(Array.from(selectedNodeRowIDs).map(nodeIDFromTreeID))
      .filter((id) => nodeByID.has(id));
    return selectedNodeIDs.length > 0 ? selectedNodeIDs : [cleanNodeID];
  }, [nodeByID, selectedNodeRowIDs]);
  const openNodeEditorOverlay = useCallback((node: NodeRecord, informationID?: string, emailMessageID?: string) => {
    const nodeID = node.node_id.trim();
    if (!nodeID) return;
    const cleanInformationID = informationID?.trim() ?? "";
    const cleanEmailMessageID = emailMessageID?.trim() ?? "";
    setNodeEditorOverlay({
      nodeID,
      nodeTitle: nodeTitle(node),
      focusInformationID: cleanInformationID || undefined,
      focusEmailMessageID: cleanEmailMessageID || undefined,
      focusRequestID: cleanInformationID ? Date.now() : undefined,
    });
    onNodeOverlayOpen?.(nodeID);
  }, [onNodeOverlayOpen]);

  const openEmailCollaborationNode = useCallback((message: EmailMessage) => {
    const nodeID = message.collaboration_node_id?.trim() ?? "";
    if (!nodeID) return;
    const node = nodeByID.get(nodeID) ?? {
      company_id: companyID,
      node_id: nodeID,
      name: message.subject?.trim() || "Email conversation",
      created_timestamp: "",
    };
    openNodeEditorOverlay(node);
  }, [companyID, nodeByID, openNodeEditorOverlay]);

  useEffect(() => {
    if (deepLinkNodeID === undefined) return;
    const nodeID = deepLinkNodeID.trim();
    if (!nodeID) {
      setNodeEditorOverlay(null);
      return;
    }
    const node = nodeByID.get(nodeID);
    const nodeTitleValue = node ? nodeTitle(node) : nodeID;
    setNodeEditorOverlay((current) => (
      current?.nodeID === nodeID && current.nodeTitle === nodeTitleValue
        ? current
        : { nodeID, nodeTitle: nodeTitleValue, focusRequestID: Date.now() }
    ));
  }, [deepLinkNodeID, nodeByID]);

  const closeNodeEditorOverlay = useCallback(() => {
    setNodeEditorOverlay(null);
    onNodeOverlayClose?.();
  }, [onNodeOverlayClose]);

  const openLogicGateArena = useCallback((logicGateID: string, label: string, nodeID?: string, informationID?: string, mentionUserID?: string) => {
    const cleanLogicGateID = logicGateID.trim();
    if (!cleanLogicGateID) return;
    const cleanNodeID = nodeID?.trim() ?? "";
    const cleanInformationID = informationID?.trim() ?? "";
    const cleanMentionUserID = mentionUserID?.trim() ?? "";
    writePendingLogicGateArenaSelection({
      companyID,
      logicGateID: cleanLogicGateID,
      label,
      nodeID: cleanNodeID || undefined,
      informationID: cleanInformationID || undefined,
    });
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
      companyID,
      sourceFrameID: "home",
      kind: "logic_gate",
      id: cleanLogicGateID,
      label,
      selectedTreeID: logicGateTreeID(cleanLogicGateID),
      nodeID: cleanNodeID || undefined,
      informationID: cleanInformationID || undefined,
      mentionUserID: cleanMentionUserID || undefined,
      changedAt: Date.now(),
    });
    preloadLogicGateArenaSurface();
    const targetPath = buildLogicGateRoute(cleanLogicGateID, cleanNodeID || undefined);
    if (onNavigate) onNavigate(targetPath);
    else window.location.assign(targetPath);
  }, [companyID, isInboxMatrixView, onNavigate]);

  const openProjectManagement = useCallback((projectID: string, label: string, informationID?: string, mentionUserID?: string) => {
    const cleanProjectID = projectID.trim();
    if (!cleanProjectID) return;
    const cleanLabel = label.trim() || "Project";
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
      companyID,
      sourceFrameID: "home",
      kind: "project",
      id: cleanProjectID,
      label: cleanLabel,
      informationID: informationID?.trim() || undefined,
      mentionUserID: mentionUserID?.trim() || undefined,
      changedAt: Date.now(),
    });
    preloadProjectManagementSurface();
    const targetPath = buildProjectRoute(cleanProjectID);
    if (onNavigate) onNavigate(targetPath);
    else window.location.assign(targetPath);
  }, [companyID, onNavigate]);
  const openReferencedEmail = useCallback(async (entity: EditorEntityLink) => {
    if (entity.entityType !== "email_message") return;
    const sharedInboxID = entity.emailSharedInboxID?.trim() ?? "";
    const sharedFolder = sharedInboxID
      ? sharedInboxes.find((folder) => folder.folder_id === sharedInboxID || folder.shared_inbox_id === sharedInboxID)
      : undefined;
    const targetViewID = sharedFolder ? `shared:${sharedFolder.folder_id}` as HomeViewID : "my-triage";
    const targetMailbox = entity.emailMailbox && entity.emailMailbox !== "drafts" && entity.emailMailbox !== "archive"
      ? entity.emailMailbox
      : "all";
    selectHomeView(targetViewID, targetMailbox);
    setNodeEditorOverlay(null);
    setError("");
    try {
      const message = entity.emailMessage ?? await getEmailMessage(
        entity.entityID,
        companyID,
        sharedFolder?.folder_id || sharedInboxID || undefined,
        { accountEmail: sharedFolder ? undefined : entity.emailAccountEmail },
      );
      const rowKey = emailMessageRowKey(message);
      selectedMessageRef.current = message;
      selectedMessageIDRef.current = message.id;
      selectedMessageRowKeyRef.current = rowKey;
      setMessages((current) => mergeEmailMessageIntoMessageList(current, message, {
        companyID,
        sharedInboxID: sharedFolder?.folder_id || sharedInboxID || undefined,
        accountEmail: sharedFolder ? undefined : entity.emailAccountEmail,
        mailbox: targetMailbox,
        limit: MESSAGE_BATCH_SIZE,
      }));
      setSelectedMessage(message);
      setSelectedMessageID(message.id);
      setSelectedMessageRowKey(rowKey);
      setSelectedMessageIDs(new Set([rowKey]));
      setSelectionAnchorMessageID(message.id);
    } catch (cause) {
      setError(formatError(cause, "Unable to open the referenced email"));
    }
  }, [companyID, selectHomeView, sharedInboxes]);

  const openEmailPickerEntity = useCallback((entity: EditorEntityLink) => {
    if (entity.entityType === "email_message") {
      void openReferencedEmail(entity);
      return;
    }
    if (entity.entityType === "node") {
      const node = nodeByID.get(entity.entityID) ?? {
        company_id: companyID,
        node_id: entity.entityID,
        name: entity.label,
        created_timestamp: "",
      };
      openNodeEditorOverlay(node);
      return;
    }
    if (entity.entityType === "logic_gate") {
      openLogicGateArena(entity.entityID, entity.label);
      return;
    }
    openProjectManagement(entity.entityID, entity.label);
  }, [companyID, nodeByID, openLogicGateArena, openNodeEditorOverlay, openProjectManagement, openReferencedEmail]);

  useEffect(() => {
    const onOpenEmailReference = (event: Event) => {
      const entity = (event as CustomEvent<EditorEntityLink>).detail;
      if (entity?.entityType === "email_message") void openReferencedEmail(entity);
    };
    window.addEventListener(EVENT_EDITOR_EMAIL_REFERENCE_OPEN, onOpenEmailReference);
    return () => window.removeEventListener(EVENT_EDITOR_EMAIL_REFERENCE_OPEN, onOpenEmailReference);
  }, [openReferencedEmail]);
  const getLogicGateDragIDs = useCallback((logicGateID: string): string[] => {
    const cleanLogicGateID = logicGateID.trim();
    if (!cleanLogicGateID) return [];
    if (!selectedLogicGateRowIDs.has(logicGateTreeID(cleanLogicGateID))) return [cleanLogicGateID];
    const selectedLogicGateIDs = cleanIDList(Array.from(selectedLogicGateRowIDs).map(logicGateIDFromTreeID))
      .filter((id) => logicGateByID.has(id));
    return selectedLogicGateIDs.length > 0 ? selectedLogicGateIDs : [cleanLogicGateID];
  }, [logicGateByID, selectedLogicGateRowIDs]);
  const mergeUpdatedNode = useCallback((node: NodeRecord, titleVersionAtStart: number, invalidateRecordCache = true) => {
    const reconciledNode = foldCommittedEntityTitlesSince(
      [node], companyID, titleVersionAtStart,
      reconcileCommittedNodeTitleInSnapshot,
    )[0] ?? node;
    setNodes((previous) => {
      let found = false;
      const next = previous.map((item) => {
        if (item.node_id !== reconciledNode.node_id) return item;
        found = true;
        return reconciledNode;
      });
      return found ? next : [...next, reconciledNode];
    });
    if (invalidateRecordCache) invalidateNodeRecordStoreCaches(apiBase, companyID, reconciledNode.node_id);
    upsertNodeRelationshipGraphNode(apiBase, companyID, reconciledNode);
  }, [apiBase, companyID]);
  const applyRACIMatrixProjectionRows = useCallback((rows: RACIMatrixProjectionRow[], options: {
    mode?: "merge" | "replace";
    logicGates?: LogicGateRecord[];
    titleVersionAtStart: number;
  }) => {
    if (!companyID || !activeRACIMatrixUserID) return;
    const mode = options.mode ?? "merge";
    const cleanRows = rows.filter((row) => (
      row.company_id?.trim() === companyID &&
      row.user_id?.trim() === activeRACIMatrixUserID &&
      row.projection_row_id?.trim() &&
      row.node_id?.trim()
    ));
    if (cleanRows.length === 0 && mode !== "replace") return;
    if (mode === "replace") {
      RACIMatrixProjectionRowsRef.current = cleanRows;
    } else {
      const byKey = new Map(RACIMatrixProjectionRowsRef.current.map((row) => [row.projection_row_id, row]));
      for (const row of cleanRows) byKey.set(row.projection_row_id, row);
      RACIMatrixProjectionRowsRef.current = Array.from(byKey.values());
    }
    const projectedLogicGateByID = new Map((options.logicGates ?? []).map((logicGate) => [logicGate.logic_gate_id, logicGate]));
    const nodeRows = cleanRows;
    const nextProjectedNodeIDs = new Set(nodeRows.map((row) => row.node_id.trim()).filter(Boolean));
    const nextProjectedLogicGateIDs = new Set([
      ...nodeRows.map((row) => row.logic_gate_id?.trim() ?? "").filter(Boolean),
      ...(options.logicGates ?? []).map((logicGate) => logicGate.logic_gate_id.trim()).filter(Boolean),
    ]);

    setNodes((previous) => {
      const byID = new Map(previous.map((node) => [node.node_id, node]));
      const removeIDs = mode === "replace"
        ? RACIMatrixProjectionInitializedRef.current
          ? RACIMatrixProjectedNodeIDsRef.current
          : new Set(previous
            .filter((node) => (
              cleanIDList(node.logic_gate_ids ?? []).some((logicGateID) => logicGateHasAnyRACIRole(logicGateByIDRef.current.get(logicGateID), activeRACIMatrixUserID))
            ))
            .map((node) => node.node_id))
        : new Set<string>();
      for (const nodeID of removeIDs) {
        if (!nextProjectedNodeIDs.has(nodeID)) byID.delete(nodeID);
      }
      for (const row of nodeRows) {
        const nodeID = row.node_id.trim();
        const previousNode = byID.get(nodeID);
        byID.set(nodeID, {
          ...previousNode,
          company_id: row.company_id,
          node_id: nodeID,
          name: row.node_name || previousNode?.name || "Untitled node",
          status: row.status ?? null,
          due_date: row.due_date ?? null,
          priority: row.priority ?? null,
          logic_gate_ids: row.logic_gate_id?.trim() ? [row.logic_gate_id.trim()] : [],
          accounts: row.accounts ?? previousNode?.accounts ?? [],
          created_timestamp: row.created_timestamp || previousNode?.created_timestamp || new Date().toISOString(),
          effective_access_level: previousNode?.effective_access_level ?? "edit",
          can_edit: previousNode?.can_edit ?? true,
        });
        invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
      }
      return foldCommittedEntityTitlesSince(
        Array.from(byID.values()), companyID, options.titleVersionAtStart,
        reconcileCommittedNodeTitleInSnapshot,
      );
    });

    setLogicGates((previous) => {
      const byID = new Map(previous.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
      const removeIDs = mode === "replace"
        ? RACIMatrixProjectionInitializedRef.current
          ? RACIMatrixProjectedLogicGateIDsRef.current
          : new Set(previous
            .filter((logicGate) => logicGateHasAnyRACIRole(logicGate, activeRACIMatrixUserID))
            .map((logicGate) => logicGate.logic_gate_id))
        : new Set<string>();
      for (const logicGateID of removeIDs) {
        if (!nextProjectedLogicGateIDs.has(logicGateID)) byID.delete(logicGateID);
      }
      for (const logicGateID of nextProjectedLogicGateIDs) {
        const previousLogicGate = byID.get(logicGateID);
        const projectedLogicGate = projectedLogicGateByID.get(logicGateID);
        const contextRow = nodeRows.find((row) => row.logic_gate_id?.trim() === logicGateID);
        byID.set(logicGateID, {
          ...previousLogicGate,
          ...projectedLogicGate,
          company_id: projectedLogicGate?.company_id || contextRow?.company_id || companyID,
          logic_gate_id: logicGateID,
          header: contextRow?.logic_gate_name || projectedLogicGate?.header || previousLogicGate?.header || "Untitled Logic Gate",
          created_timestamp: projectedLogicGate?.created_timestamp || previousLogicGate?.created_timestamp || new Date().toISOString(),
          gvic_assignments: projectedLogicGate?.gvic_assignments ?? previousLogicGate?.gvic_assignments ?? [],
          effective_access_level: projectedLogicGate?.effective_access_level ?? previousLogicGate?.effective_access_level ?? "edit",
          can_edit: projectedLogicGate?.can_edit ?? previousLogicGate?.can_edit ?? true,
        });
      }
      const reconciledLogicGates = foldCommittedEntityTitlesSince(
        Array.from(byID.values()), companyID, options.titleVersionAtStart,
        reconcileCommittedLogicGateRecordTitles,
      );
      const reconciledByID = new Map(reconciledLogicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
      for (const logicGateID of nextProjectedLogicGateIDs) {
        const logicGate = reconciledByID.get(logicGateID);
        if (logicGate) upsertLogicGateRelationshipGraphNode(apiBase, companyID, toLogicGateViewRecord(logicGate));
      }
      return reconciledLogicGates;
    });

    if (mode === "replace") {
      RACIMatrixProjectionInitializedRef.current = true;
      RACIMatrixProjectedNodeIDsRef.current = nextProjectedNodeIDs;
      RACIMatrixProjectedLogicGateIDsRef.current = nextProjectedLogicGateIDs;
    } else {
      for (const nodeID of nextProjectedNodeIDs) RACIMatrixProjectedNodeIDsRef.current.add(nodeID);
      for (const logicGateID of nextProjectedLogicGateIDs) RACIMatrixProjectedLogicGateIDsRef.current.add(logicGateID);
    }
  }, [activeRACIMatrixUserID, apiBase, companyID]);
  const refreshRACIMatrixProjection = useCallback(async () => {
    if (!companyID || !activeRACIMatrixUserID || !isInboxMatrixViewID(activeViewIDRef.current)) return;
    if (RACIMatrixProjectionRefetchInFlightRef.current) return;
    const requestScopeKey = `${companyID}\u0000${currentUserID}\u0000${activeRACIMatrixUserID}`;
    RACIMatrixProjectionRefetchInFlightRef.current = true;
    try {
      const titleVersionAtStart = readCommittedEntityTitleVersion();
      const [projection, projectedLogicGates] = await Promise.all([
        listRACIMatrixProjectionRows({ apiBase, companyID, targetUserID: activeRACIMatrixUserID, limit: 500 }),
        listMyLogicGates({ apiBase, companyID, targetUserID: activeRACIMatrixUserID, limit: 500 }),
      ]);
      if (RACIMatrixProjectionScopeKeyRef.current !== requestScopeKey) return;
      applyRACIMatrixProjectionRows(projection.rows ?? [], {
        mode: "replace",
        logicGates: projectedLogicGates.logic_gates ?? [],
        titleVersionAtStart,
      });
    } catch (projectionError) {
      setError(formatError(projectionError, "Failed to refresh RACI matrix"));
    } finally {
      RACIMatrixProjectionRefetchInFlightRef.current = false;
    }
  }, [activeRACIMatrixUserID, apiBase, applyRACIMatrixProjectionRows, companyID, currentUserID]);
  useEffect(() => {
    if (!companyID || !activeRACIMatrixUserID || !isInboxMatrixView) return undefined;
    void refreshRACIMatrixProjection();
    return undefined;
  }, [activeRACIMatrixUserID, companyID, isInboxMatrixView, refreshRACIMatrixProjection]);
  const mergeCreatedFolderItems = useCallback((items: CompanyExplorerFolderItem[]) => {
    if (items.length === 0) return;
    setNodeFolderItems((previous) => {
      const byKey = new Map(previous.map((item) => [`${item.item_type}:${item.item_id}`, item]));
      for (const item of items.filter((item) => item.item_type === "node")) byKey.set(`${item.item_type}:${item.item_id}`, item);
      return Array.from(byKey.values());
    });
    setLogicGateFolderItems((previous) => {
      const byKey = new Map(previous.map((item) => [`${item.item_type}:${item.item_id}`, item]));
      for (const item of items.filter((item) => item.item_type === "logic_gate")) byKey.set(`${item.item_type}:${item.item_id}`, item);
      return Array.from(byKey.values());
    });
    for (const item of items) {
      upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, item);
      upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase, companyID, item);
    }
  }, [apiBase, companyID]);
  const mergeCreatedLogicGate = useCallback((logicGate: LogicGateRecord, folderItems: CompanyExplorerFolderItem[], titleVersionAtStart: number) => {
    const reconciledLogicGate = foldCommittedEntityTitlesSince(
      [logicGate], companyID, titleVersionAtStart,
      reconcileCommittedLogicGateRecordTitles,
    )[0] ?? logicGate;
    setLogicGates((previous) => {
      const next = previous.filter((item) => item.logic_gate_id !== reconciledLogicGate.logic_gate_id);
      return [...next, reconciledLogicGate];
    });
    mergeCreatedFolderItems(folderItems);
    upsertLogicGateRelationshipGraphNode(apiBase, companyID, toLogicGateViewRecord(reconciledLogicGate));
    return reconciledLogicGate;
  }, [apiBase, companyID, mergeCreatedFolderItems]);
  const createHomeNode = useCallback(async (assignment?: { logicGateID: string; priority: InboxPriority; status?: RACIInboxStatus }) => {
    setBusy("create-node");
    setError("");
    try {
      const titleVersionAtStart = readCommittedEntityTitleVersion();
      const result = await createHomeNodeCommand({ apiBase, companyID });
      mergeCreatedFolderItems(result.folderItems);
      mergeUpdatedNode(result.node, titleVersionAtStart);
      if (assignment?.logicGateID.trim()) {
        const nextNodeByID = new Map(nodeByID);
        nextNodeByID.set(result.node.node_id, result.node);
        const dropResult = await dropNodesIntoInboxLogicGateCommand({
          apiBase,
          companyID,
          logicGateID: assignment.logicGateID,
          nodeIDs: [result.node.node_id],
          priority: assignment.priority,
          status: assignment.status,
          nodeByID: nextNodeByID,
          invalidateKanbanBoardContents: invalidateKanbanBoardContentsCache,
        });
        applyRACIMatrixProjectionRows(dropResult.gvic_projection_rows, { titleVersionAtStart });
        for (const node of dropResult.nodes) mergeUpdatedNode(node, titleVersionAtStart);
        setNotice("Node created and added to Logic Gate.");
        return;
      }
      setNotice("Node created.");
    } catch (createError) {
      setError(formatError(createError, assignment?.logicGateID ? "Failed to create node in Logic Gate" : "Failed to create node"));
    } finally {
      setBusy("");
    }
  }, [apiBase, applyRACIMatrixProjectionRows, companyID, mergeCreatedFolderItems, mergeUpdatedNode, nodeByID]);
  const createHomeLogicGate = useCallback(async (options: { assignCurrentUser?: boolean; creatorRACIRole?: LogicGateRACIRole; openArena?: boolean } = {}) => {
    setBusy("create-logic-gate");
    setError("");
    try {
      const creatorRACIRole = options.creatorRACIRole ?? (options.assignCurrentUser ? "responsible" : undefined);
      const titleVersionAtStart = readCommittedEntityTitleVersion();
      const result = await createHomeLogicGateCommand({ apiBase, companyID, creatorRACIRole });
      const logicGate = mergeCreatedLogicGate(result.logicGate, result.folderItems, titleVersionAtStart);
      setNotice(creatorRACIRole ? "Logic Gate created and assigned to you." : "Logic Gate created.");
      if (options.openArena ?? true) {
        openLogicGateArena(logicGate.logic_gate_id, logicGate.header || "Logic Gate");
      }
      return logicGate;
    } catch (createError) {
      setError(formatError(createError, "Failed to create Logic Gate"));
      return null;
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, mergeCreatedLogicGate, openLogicGateArena]);
  const createLogicGateInInboxCell = useCallback(async (input: { creatorRACIRole?: LogicGateRACIRole }) => {
    const logicGate = await createHomeLogicGate({ creatorRACIRole: input.creatorRACIRole, openArena: false });
    if (logicGate) scheduleCurrentUserMyWorkRefresh();
  }, [createHomeLogicGate, scheduleCurrentUserMyWorkRefresh]);
  const createNodeInInboxCell = useCallback(async (input: { priority: InboxPriority; status?: RACIInboxStatus; creatorRACIRole?: LogicGateRACIRole }) => {
    setBusy("create-node");
    setError("");
    try {
      const titleVersionAtStart = readCommittedEntityTitleVersion();
      const result = await createHomeRACIMatrixNodeCommand({
        apiBase,
        companyID,
        priority: input.priority,
        status: input.status,
        creatorRACIRole: input.creatorRACIRole,
        createLogicGateTitle: "new logic gate",
      });
      if (result.logicGate) mergeCreatedLogicGate(result.logicGate, result.folderItems.filter((item) => item.item_type === "logic_gate"), titleVersionAtStart);
      mergeCreatedFolderItems(result.folderItems.filter((item) => item.item_type !== "logic_gate"));
      applyRACIMatrixProjectionRows(result.gvic_projection_rows, { titleVersionAtStart });
      mergeUpdatedNode(result.node, titleVersionAtStart);
      scheduleCurrentUserMyWorkRefresh();
      setNotice("Note created in a new Logic Gate.");
    } catch (createError) {
      setError(formatError(createError, "Failed to create note in matrix cell"));
    } finally {
      setBusy("");
    }
  }, [apiBase, applyRACIMatrixProjectionRows, companyID, mergeCreatedFolderItems, mergeCreatedLogicGate, mergeUpdatedNode, scheduleCurrentUserMyWorkRefresh]);
  const openNodeBulkEditMenu = useCallback((nodeID: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    activeDeleteSelectionKindRef.current = "node";
    const cleanNodeID = nodeID.trim();
    if (!cleanNodeID || !nodeByID.has(cleanNodeID)) return;
    const treeID = nodeTreeID(cleanNodeID);
    const ids = selectedNodeRowIDs.has(treeID)
      ? cleanIDList(Array.from(selectedNodeRowIDs).map(nodeIDFromTreeID)).filter((id) => nodeByID.has(id))
      : [cleanNodeID];
    if (!selectedNodeRowIDs.has(treeID)) {
      setSelectedNodeRowIDs(new Set([treeID]));
      setNodeSelectionAnchorID(treeID);
    }
    setBulkEditMenu({ x: event.clientX, y: event.clientY, kind: "node", ids });
  }, [nodeByID, selectedNodeRowIDs]);
  const openLogicGateBulkEditMenuAt = useCallback((logicGateID: string, x: number, y: number) => {
    activeDeleteSelectionKindRef.current = "logic_gate";
    const cleanLogicGateID = logicGateID.trim();
    if (!cleanLogicGateID || !logicGateByID.has(cleanLogicGateID)) return;
    const treeID = logicGateTreeID(cleanLogicGateID);
    const ids = selectedLogicGateRowIDs.has(treeID)
      ? cleanIDList(Array.from(selectedLogicGateRowIDs).map(logicGateIDFromTreeID)).filter((id) => logicGateByID.has(id))
      : [cleanLogicGateID];
    if (!selectedLogicGateRowIDs.has(treeID)) {
      setSelectedLogicGateRowIDs(new Set([treeID]));
      setLogicGateSelectionAnchorID(treeID);
    }
    setBulkEditMenu({ x, y, kind: "logic_gate", ids });
  }, [logicGateByID, selectedLogicGateRowIDs]);
  const openLogicGateBulkEditMenu = useCallback((logicGateID: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openLogicGateBulkEditMenuAt(logicGateID, event.clientX, event.clientY);
  }, [openLogicGateBulkEditMenuAt]);
  const moveMyWorkNodesIntoCell = useCallback(async (input: { logicGateID?: string; nodeIDs: string[]; priority: InboxPriority; fromLogicGateID?: string; creatorRACIRole?: LogicGateRACIRole; targetUserID?: string }) => {
    const targetRACIRole = input.creatorRACIRole;
    const nodeIDs = cleanIDList(input.nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (!targetRACIRole || nodeIDs.length === 0) return null;
    setBusy("my-work-node-drop");
    setError("");
    try {
      const titleVersionAtStart = readCommittedEntityTitleVersion();
      const result = await moveMyWorkNodesToCellCommand({
        apiBase,
        companyID,
        nodeIDs,
        priority: input.priority,
        targetRACIRole,
        targetUserID: input.targetUserID,
        logicGateID: input.logicGateID,
        fromLogicGateID: input.fromLogicGateID,
        nodeByID,
      });
      applyRACIMatrixProjectionRows(result.gvic_projection_rows, { titleVersionAtStart });
      for (const node of result.nodes) mergeUpdatedNode(node, titleVersionAtStart);
      setNotice(nodeIDs.length === 1 ? "My Work node moved." : `${nodeIDs.length} My Work nodes moved.`);
      return result;
    } catch (dropError) {
      setError(formatError(dropError, "Failed to move My Work node"));
      return null;
    } finally {
      setBusy("");
    }
  }, [apiBase, applyRACIMatrixProjectionRows, companyID, mergeUpdatedNode, nodeByID]);
  const dropNodesIntoInboxLogicGate = useCallback(async (input: { logicGateID: string; nodeIDs: string[]; priority: InboxPriority; status?: RACIInboxStatus; fromLogicGateID?: string }) => {
    const logicGateID = input.logicGateID.trim();
    const fromLogicGateID = input.fromLogicGateID?.trim() ?? "";
    const nodeIDs = cleanIDList(input.nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (!logicGateID || nodeIDs.length === 0) return;
    setBusy("inbox-node-drop");
    setError("");
    try {
      const titleVersionAtStart = readCommittedEntityTitleVersion();
      const dropResult = await dropNodesIntoInboxLogicGateCommand({
        apiBase,
        companyID,
        logicGateID,
        fromLogicGateID,
        nodeIDs,
        priority: input.priority,
        status: input.status,
        nodeByID,
        invalidateKanbanBoardContents: invalidateKanbanBoardContentsCache,
      });
      applyRACIMatrixProjectionRows(dropResult.gvic_projection_rows, { titleVersionAtStart });
      for (const node of dropResult.nodes) {
        if (node) mergeUpdatedNode(node, titleVersionAtStart);
      }
      scheduleCurrentUserMyWorkRefresh();
      if (fromLogicGateID === logicGateID) {
        setNotice(nodeIDs.length === 1 ? "Node updated in Logic Gate." : `${nodeIDs.length} nodes updated in Logic Gate.`);
      } else {
        const action = fromLogicGateID ? "moved" : "added";
        setNotice(nodeIDs.length === 1 ? `Node ${action} to Logic Gate.` : `${nodeIDs.length} nodes ${action} to Logic Gate.`);
      }
    } catch (dropError) {
      setError(formatError(dropError, "Failed to add nodes to Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [apiBase, applyRACIMatrixProjectionRows, companyID, mergeUpdatedNode, nodeByID, scheduleCurrentUserMyWorkRefresh]);
  const dropNodesIntoNewInboxLogicGate = useCallback(async (input: { nodeIDs: string[]; priority: InboxPriority; status?: RACIInboxStatus; creatorRACIRole?: LogicGateRACIRole; fromLogicGateID?: string }) => {
    const nodeIDs = cleanIDList(input.nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (nodeIDs.length === 0) return;
    setBusy("inbox-node-drop");
    setError("");
    try {
      const titleVersionAtStart = readCommittedEntityTitleVersion();
      const logicGateResult = await createHomeLogicGateCommand({ apiBase, companyID, creatorRACIRole: input.creatorRACIRole });
      const logicGate = logicGateResult.logicGate;
      mergeCreatedLogicGate(logicGate, logicGateResult.folderItems, titleVersionAtStart);
      const dropResult = await dropNodesIntoInboxLogicGateCommand({
        apiBase,
        companyID,
        logicGateID: logicGate.logic_gate_id,
        fromLogicGateID: input.fromLogicGateID,
        nodeIDs,
        priority: input.priority,
        status: input.status,
        nodeByID,
        invalidateKanbanBoardContents: invalidateKanbanBoardContentsCache,
      });
      applyRACIMatrixProjectionRows(dropResult.gvic_projection_rows, { titleVersionAtStart });
      for (const node of dropResult.nodes) mergeUpdatedNode(node, titleVersionAtStart);
      scheduleCurrentUserMyWorkRefresh();
      setNotice(nodeIDs.length === 1 ? "Node moved into a new Logic Gate." : `${nodeIDs.length} nodes moved into a new Logic Gate.`);
    } catch (dropError) {
      setError(formatError(dropError, "Failed to move nodes into a new Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [apiBase, applyRACIMatrixProjectionRows, companyID, mergeCreatedLogicGate, mergeUpdatedNode, nodeByID, scheduleCurrentUserMyWorkRefresh]);
  const moveLogicGatesIntoInboxCell = useCallback(async (input: { logicGateIDs: string[]; priority: InboxPriority; status?: RACIInboxStatus; creatorRACIRole?: LogicGateRACIRole; nodeIDsByLogicGateID?: Record<string, string[]> }) => {
    const logicGateIDs = cleanIDList(input.logicGateIDs).filter((logicGateID) => logicGateByID.has(logicGateID));
    if (logicGateIDs.length === 0) return;
    setBusy("inbox-logic-gate-drop");
    setError("");
    try {
      const titleVersionAtStart = readCommittedEntityTitleVersion();
      const targetRole = input.creatorRACIRole;
      if (currentUserID && targetRole) {
        const RACIRoles: LogicGateRACIRole[] = ["responsible", "accountable", "consulted", "informed"];
        const assignmentUpdates = await Promise.all(logicGateIDs.map(async (logicGateID) => {
          const gate = logicGateByID.get(logicGateID);
          let assignments = gate?.gvic_assignments ?? [];
          const removalRoles = RACIRoles.filter((role) => (
            role !== targetRole
            && assignments.some((assignment) => assignment.role === role && assignment.user_id?.trim() === currentUserID)
          ));
          if (removalRoles.length > 0) {
            assignments = await removeLogicGateRACIAssignments(companyID, logicGateID, removalRoles.map((role) => ({ role, user_id: currentUserID })));
          }
          const hasTargetRole = assignments.some((assignment) => assignment.role === targetRole && assignment.user_id?.trim() === currentUserID);
          if (!hasTargetRole) {
            assignments = await addLogicGateRACIAssignments(companyID, logicGateID, [{ role: targetRole, user_id: currentUserID }]);
          }
          return { logicGateID, assignments };
        }));
        setLogicGates((previous) => previous.map((logicGate) => {
          const update = assignmentUpdates.find((item) => item.logicGateID === logicGate.logic_gate_id);
          return update ? { ...logicGate, gvic_assignments: update.assignments } : logicGate;
        }));
      }

      let movedNodeCount = 0;
      for (const logicGateID of logicGateIDs) {
        const explicitNodeIDs = cleanIDList(input.nodeIDsByLogicGateID?.[logicGateID] ?? []);
        const nodeIDs = explicitNodeIDs.length > 0
          ? explicitNodeIDs.filter((nodeID) => nodeByID.has(nodeID))
          : nodes
            .filter((node) => cleanIDList(node.logic_gate_ids ?? []).includes(logicGateID))
            .map((node) => node.node_id);
        if (nodeIDs.length === 0) continue;
        const dropResult = await dropNodesIntoInboxLogicGateCommand({
          apiBase,
          companyID,
          logicGateID,
          fromLogicGateID: logicGateID,
          nodeIDs,
          priority: input.priority,
          status: input.status,
          nodeByID,
          invalidateKanbanBoardContents: invalidateKanbanBoardContentsCache,
        });
        applyRACIMatrixProjectionRows(dropResult.gvic_projection_rows, { titleVersionAtStart });
        movedNodeCount += dropResult.nodes.length;
        for (const node of dropResult.nodes) mergeUpdatedNode(node, titleVersionAtStart);
      }
      scheduleCurrentUserMyWorkRefresh();
      setNotice(logicGateIDs.length === 1
        ? (movedNodeCount > 0 ? "Logic Gate moved." : "Logic Gate assignment updated.")
        : `${logicGateIDs.length} Logic Gates moved.`);
    } catch (dropError) {
      setError(formatError(dropError, "Failed to move Logic Gates"));
    } finally {
      setBusy("");
    }
  }, [apiBase, applyRACIMatrixProjectionRows, companyID, currentUserID, logicGateByID, mergeUpdatedNode, nodeByID, nodes, scheduleCurrentUserMyWorkRefresh]);

  const moveProjectsIntoInboxCell = useCallback(async (input: { projectIDs: string[]; priority: InboxPriority; status?: RACIInboxStatus; creatorRACIRole?: LogicGateRACIRole; logicGateIDsByProjectID?: Record<string, string[]>; nodeIDsByProjectID?: Record<string, string[]>; nodeIDsByLogicGateID?: Record<string, string[]> }) => {
    const projectIDs = cleanIDList(input.projectIDs);
    if (projectIDs.length === 0) return;
    const logicGateIDs = cleanIDList(projectIDs.flatMap((projectID) => input.logicGateIDsByProjectID?.[projectID] ?? [])).filter((logicGateID) => logicGateByID.has(logicGateID));
    const nodeIDsByLogicGateID = input.nodeIDsByLogicGateID ?? {};
    const nodeIDsMovedWithLogicGates = new Set<string>();
    for (const logicGateID of logicGateIDs) {
      for (const nodeID of cleanIDList(nodeIDsByLogicGateID[logicGateID] ?? [])) nodeIDsMovedWithLogicGates.add(nodeID);
    }
    const directNodeIDs = cleanIDList(projectIDs.flatMap((projectID) => input.nodeIDsByProjectID?.[projectID] ?? []))
      .filter((nodeID) => !nodeIDsMovedWithLogicGates.has(nodeID) && nodeByID.has(nodeID));
    if (logicGateIDs.length > 0) {
      await moveLogicGatesIntoInboxCell({
        logicGateIDs,
        priority: input.priority,
        status: input.status,
        creatorRACIRole: input.creatorRACIRole,
        nodeIDsByLogicGateID,
      });
    }
    if (directNodeIDs.length > 0) {
      await dropNodesIntoNewInboxLogicGate({
        nodeIDs: directNodeIDs,
        priority: input.priority,
        status: input.status,
        creatorRACIRole: input.creatorRACIRole,
      });
    }
    if (logicGateIDs.length === 0 && directNodeIDs.length === 0) {
      setNotice(projectIDs.length === 1 ? "Project has no movable work items." : "Projects have no movable work items.");
      return;
    }
    scheduleCurrentUserMyWorkRefresh();
    setNotice(projectIDs.length === 1 ? "Project moved." : `${projectIDs.length} projects moved.`);
  }, [dropNodesIntoNewInboxLogicGate, logicGateByID, moveLogicGatesIntoInboxCell, nodeByID, scheduleCurrentUserMyWorkRefresh]);

  const addNodesToLogicGate = useCallback(async (nodeIDs: string[], logicGateID: string) => {
    const cleanLogicGateID = logicGateID.trim();
    const ids = cleanIDList(nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (!cleanLogicGateID || ids.length === 0) return;
    setBusy("bulk-node-edit");
    setError("");
    try {
      const titleVersionAtStart = readCommittedEntityTitleVersion();
      const updatedNodes = await addNodesToLogicGateCommand({
        apiBase,
        companyID,
        logicGateID: cleanLogicGateID,
        nodeIDs: ids,
        nodeByID,
        invalidateKanbanBoardContents: invalidateKanbanBoardContentsCache,
      });
      for (const node of updatedNodes) mergeUpdatedNode(node, titleVersionAtStart);
      invalidateLogicGateArenaViewCache(apiBase, companyID, cleanLogicGateID);
      setNotice(ids.length === 1 ? "Node added to Logic Gate." : `${ids.length} nodes added to Logic Gate.`);
    } catch (addError) {
      setError(formatError(addError, "Failed to add nodes to Logic Gate"));
    } finally {
      setBusy("");
      setBulkEditMenu(null);
    }
  }, [apiBase, companyID, mergeUpdatedNode, nodeByID]);
  const buildNodeDeleteTargets = useCallback((nodeIDs: string[]): HomeEntityDeleteTarget[] => (
    cleanIDList(nodeIDs)
      .filter((nodeID) => nodeByID.has(nodeID))
      .map((nodeID) => ({ kind: "node" as const, id: nodeID, label: nodeTitle(nodeByID.get(nodeID)) }))
  ), [nodeByID]);
  const buildLogicGateDeleteTargets = useCallback((logicGateIDs: string[]): HomeEntityDeleteTarget[] => (
    cleanIDList(logicGateIDs)
      .filter((logicGateID) => logicGateByID.has(logicGateID))
      .map((logicGateID) => ({ kind: "logic_gate" as const, id: logicGateID, label: logicGateTitle(logicGateByID.get(logicGateID)) }))
  ), [logicGateByID]);
  const getLogicGateDeleteTargetsForContext = useCallback((logicGateID: string): HomeEntityDeleteTarget[] => {
    const cleanLogicGateID = logicGateID.trim();
    if (!cleanLogicGateID) return [];
    const treeID = logicGateTreeID(cleanLogicGateID);
    const ids = selectedLogicGateRowIDs.has(treeID)
      ? cleanIDList(Array.from(selectedLogicGateRowIDs).map(logicGateIDFromTreeID)).filter((id) => logicGateByID.has(id))
      : [cleanLogicGateID];
    return buildLogicGateDeleteTargets(ids);
  }, [buildLogicGateDeleteTargets, logicGateByID, selectedLogicGateRowIDs]);
  const requestDeleteHomeEntities = useCallback((targets: HomeEntityDeleteTarget[], position?: ConfirmActionMenuPosition) => {
    const seen = new Set<string>();
    const normalizedTargets = targets.filter((target) => {
      const id = target.id.trim();
      if (!id) return false;
      const key = `${target.kind}:${id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((target) => ({ ...target, id: target.id.trim(), label: target.label.trim() || target.id.trim() }));
    if (normalizedTargets.length === 0) return;
    setEntityDeleteConfirmation({ targets: normalizedTargets, position: position ?? null });
  }, []);
  const requestDeleteSelectedHomeEntities = useCallback(() => {
    if (activeDeleteSelectionKindRef.current === "node") {
      requestDeleteHomeEntities(buildNodeDeleteTargets(Array.from(selectedNodeRowIDs).map(nodeIDFromTreeID)));
      return;
    }
    if (activeDeleteSelectionKindRef.current === "logic_gate") {
      requestDeleteHomeEntities(buildLogicGateDeleteTargets(Array.from(selectedLogicGateRowIDs).map(logicGateIDFromTreeID)));
    }
  }, [buildLogicGateDeleteTargets, buildNodeDeleteTargets, requestDeleteHomeEntities, selectedLogicGateRowIDs, selectedNodeRowIDs]);
  const requestDeleteLogicGateContext = useCallback((logicGateID: string, position?: ConfirmActionMenuPosition) => {
    activeDeleteSelectionKindRef.current = "logic_gate";
    requestDeleteHomeEntities(getLogicGateDeleteTargetsForContext(logicGateID), position);
  }, [getLogicGateDeleteTargetsForContext, requestDeleteHomeEntities]);
  const requestDeleteBulkEditTargets = useCallback((kind: "node" | "logic_gate", ids: string[], position?: ConfirmActionMenuPosition) => {
    activeDeleteSelectionKindRef.current = kind;
    requestDeleteHomeEntities(kind === "node" ? buildNodeDeleteTargets(ids) : buildLogicGateDeleteTargets(ids), position);
  }, [buildLogicGateDeleteTargets, buildNodeDeleteTargets, requestDeleteHomeEntities]);
  const renameMyWorkNode = useCallback(async (nodeID: string) => {
    const cleanNodeID = nodeID.trim();
    const node = nodeByID.get(cleanNodeID);
    if (!cleanNodeID || !node) return;
    const currentTitle = nodeTitle(node);
    const nextTitle = window.prompt("Rename node", currentTitle)?.trim();
    if (!nextTitle || nextTitle === currentTitle) return;
    setBusy("rename-node");
    setError("");
    try {
      const titleVersionAtStart = readCommittedEntityTitleVersion();
      const updated = await commitEntityTitleMutation(
        () => requestJSON<NodeRecord>(apiBase, `/v1/nodes/${encodeURIComponent(cleanNodeID)}`, {
          method: "PUT",
          body: JSON.stringify({ company_id: companyID, name: nextTitle }),
        }),
        (result) => ({ companyID, entityType: "node", resourceID: result.node_id, title: nodeTitle(result) }),
      );
      mergeUpdatedNode(updated, titleVersionAtStart, false);
      setNotice("Node renamed.");
    } catch (renameError) {
      setError(formatError(renameError, "Failed to rename node"));
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, mergeUpdatedNode, nodeByID]);
  const deleteHomeEntities = useCallback(async (targets: HomeEntityDeleteTarget[], confirmationDisplayName: string): Promise<boolean> => {
    const normalizedTargets = targets.map((target) => ({ kind: target.kind, id: target.id.trim() })).filter((target) => target.id);
    const nodeIDSet = new Set(normalizedTargets.filter((target) => target.kind === "node").map((target) => target.id));
    const logicGateIDSet = new Set(normalizedTargets.filter((target) => target.kind === "logic_gate").map((target) => target.id));
    if (nodeIDSet.size === 0 && logicGateIDSet.size === 0) return false;
    const optimisticNodeIDs = Array.from(nodeIDSet);
    if (optimisticNodeIDs.length > 0) {
      setOptimisticMyWorkDeletedNodeIDs((current) => new Set([...current, ...optimisticNodeIDs]));
    }
    setBusy("entity-delete");
    setError("");
    try {
      await deleteHomeEntitiesCommand({ apiBase, companyID, targets: normalizedTargets, confirmationDisplayName });
      setNodes((previous) => previous
        .filter((node) => !nodeIDSet.has(node.node_id))
        .map((node) => {
          if (logicGateIDSet.size === 0) return node;
          const nextLogicGateIDs = cleanIDList(node.logic_gate_ids ?? []).filter((logicGateID) => !logicGateIDSet.has(logicGateID));
          return nextLogicGateIDs.length === (node.logic_gate_ids ?? []).length ? node : { ...node, logic_gate_ids: nextLogicGateIDs };
        }));
      setNodeRelationships((previous) => previous.filter((relationship) => !nodeIDSet.has(relationship.node_id_a) && !nodeIDSet.has(relationship.node_id_b)));
      setNodeFolderItems((previous) => previous.filter((item) => item.item_type !== "node" || !nodeIDSet.has(item.item_id)));
      setLogicGates((previous) => previous.filter((logicGate) => !logicGateIDSet.has(logicGate.logic_gate_id)));
      setLogicGateFolderItems((previous) => previous.filter((item) => item.item_type !== "logic_gate" || !logicGateIDSet.has(item.item_id)));
      setMyLogicGateShortcuts((previous) => previous.filter((shortcut) => !logicGateIDSet.has(shortcut.logic_gate_id)));
      setSelectedNodeRowIDs((previous) => new Set(Array.from(previous).filter((treeID) => !nodeIDSet.has(nodeIDFromTreeID(treeID)))));
      setSelectedLogicGateRowIDs((previous) => new Set(Array.from(previous).filter((treeID) => !logicGateIDSet.has(logicGateIDFromTreeID(treeID)))));
      if (nodeSelectionAnchorID && nodeIDSet.has(nodeIDFromTreeID(nodeSelectionAnchorID))) setNodeSelectionAnchorID("");
      if (logicGateSelectionAnchorID && logicGateIDSet.has(logicGateIDFromTreeID(logicGateSelectionAnchorID))) setLogicGateSelectionAnchorID("");
      setNodeEditorOverlay((current) => current && nodeIDSet.has(current.nodeID) ? null : current);
      for (const nodeID of nodeIDSet) {
        invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
        removeNodeRelationshipGraphNode(apiBase, companyID, nodeID);
      }
      for (const logicGateID of logicGateIDSet) {
        invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateID);
        removeLogicGateRelationshipGraphNode(apiBase, companyID, logicGateID);
      }
      for (const node of nodes) {
        if (cleanIDList(node.logic_gate_ids ?? []).some((logicGateID) => logicGateIDSet.has(logicGateID))) {
          invalidateNodeRecordStoreCaches(apiBase, companyID, node.node_id);
        }
      }
      setBulkEditMenu(null);
      setEntityDeleteConfirmation(null);
      scheduleMyWorkLiveRefresh();
      const deletedCount = nodeIDSet.size + logicGateIDSet.size;
      setNotice(deletedCount === 1 ? "Item deleted." : `${deletedCount} items deleted.`);
      return true;
    } catch (deleteError) {
      if (optimisticNodeIDs.length > 0) {
        setOptimisticMyWorkDeletedNodeIDs((current) => {
          const next = new Set(current);
          for (const nodeID of optimisticNodeIDs) next.delete(nodeID);
          return next;
        });
      }
      setError(formatError(deleteError, "Failed to delete selected items"));
      return false;
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, logicGateIDFromTreeID, logicGateSelectionAnchorID, nodeIDFromTreeID, nodeSelectionAnchorID, nodes, scheduleMyWorkLiveRefresh]);
  const deleteNodeEditorOverlayNode = useCallback(async (nodeID: string, confirmationDisplayName: string): Promise<boolean> => {
    const targets = buildNodeDeleteTargets([nodeID]);
    if (targets.length === 0) return false;
    return deleteHomeEntities(targets, confirmationDisplayName);
  }, [buildNodeDeleteTargets, deleteHomeEntities]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Delete" || deleteConfirmation || busy) return;
      if (isEditableKeyboardTarget(event.target)) return;
      if (activeDeleteSelectionKindRef.current === "node" || activeDeleteSelectionKindRef.current === "logic_gate") {
        if (entityDeleteConfirmation) return;
        event.preventDefault();
        requestDeleteSelectedHomeEntities();
        return;
      }
      const ids = getSelectedMessageIDsForAction();
      if (ids.length === 0) return;
      event.preventDefault();
      requestDeleteMessages(ids);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, deleteConfirmation, entityDeleteConfirmation, getSelectedMessageIDsForAction, requestDeleteMessages, requestDeleteSelectedHomeEntities]);
  const applyBulkNodePatch = useCallback(async (nodeIDs: string[], patch: Partial<Pick<NodeRecord, "priority" | "status" | "due_date">>) => {
    const ids = cleanIDList(nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (ids.length === 0) return;
    setBusy("bulk-node-edit");
    setError("");
    try {
      const titleVersionAtStart = readCommittedEntityTitleVersion();
      const updatedNodes = await applyBulkNodePatchCommand({
        apiBase,
        companyID,
        nodeIDs: ids,
        patch,
        nodeByID,
        invalidateKanbanBoardContents: invalidateKanbanBoardContentsCache,
      });
      for (const node of updatedNodes) {
        mergeUpdatedNode(node, titleVersionAtStart);
      }
      for (const node of updatedNodes) {
        for (const logicGateID of cleanIDList(node.logic_gate_ids ?? [])) {
          invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateID);
        }
      }
      setNotice(ids.length === 1 ? "Node updated." : `${ids.length} nodes updated.`);
    } catch (bulkError) {
      setError(formatError(bulkError, "Failed to update selected nodes"));
    } finally {
      setBusy("");
      setBulkEditMenu(null);
    }
  }, [apiBase, companyID, mergeUpdatedNode, nodeByID]);
  const applyBulkLogicGateRACI = useCallback(async (logicGateIDs: string[], role: LogicGateRACIRole, userID: string, action: "add" | "remove") => {
    const ids = cleanIDList(logicGateIDs).filter((logicGateID) => logicGateByID.has(logicGateID));
    const cleanUserID = userID.trim();
    if (ids.length === 0 || !cleanUserID) return;
    setBusy("bulk-logic-gate-edit");
    setError("");
    try {
      const updates = await Promise.all(ids.map(async (logicGateID) => {
        const assignments = action === "add"
          ? await addLogicGateRACIAssignments(companyID, logicGateID, [{ role, user_id: cleanUserID }])
          : await removeLogicGateRACIAssignments(companyID, logicGateID, [{ role, user_id: cleanUserID }]);
        return { logicGateID, assignments };
      }));
      setLogicGates((previous) => previous.map((logicGate) => {
        const update = updates.find((item) => item.logicGateID === logicGate.logic_gate_id);
        return update ? { ...logicGate, gvic_assignments: update.assignments } : logicGate;
      }));
      setNotice(ids.length === 1 ? "Logic Gate assignments updated." : `${ids.length} Logic Gate assignments updated.`);
    } catch (bulkError) {
      setError(formatError(bulkError, "Failed to update selected Logic Gates"));
    } finally {
      setBusy("");
      setBulkEditMenu(null);
    }
  }, [companyID, logicGateByID]);
  const startColumnResize = useCallback((dividerIndex: 0 | 1 | 2, event: React.PointerEvent<HTMLButtonElement>) => {
    if (isNarrow) return;
    event.preventDefault();
    event.stopPropagation();
    const availableWidth = getHomeWorkspaceTrackWidth(workspaceRef.current);
    const activeIsInboxMatrixView = isInboxMatrixViewID(activeViewIDRef.current);
    const startWidths = activeIsInboxMatrixView
      ? columnWidthsRef.current
      : fitHomeColumnWidthsToAvailableWidth(columnWidthsRef.current, availableWidth, !appSidebarOwnsNavigationRef.current);
    const ownerDocument = event.currentTarget.ownerDocument;
    columnResizeDragRef.current = {
      dividerIndex,
      startX: event.clientX,
      startWidths,
      availableWidth,
      ownerDocument,
      previousCursor: ownerDocument.body.style.cursor,
      previousUserSelect: ownerDocument.body.style.userSelect,
      pointerID: event.pointerId,
      captureTarget: event.currentTarget,
    };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {}
    ownerDocument.body.style.cursor = "col-resize";
    ownerDocument.body.style.userSelect = "none";
  }, [isNarrow]);
  const activeViewLabel = getHomeViewLabel(activeViewID, sharedInboxes);
  const isArchivableListView = isArchivableHomeViewID(activeViewID);
  const isArchiveMailbox = isArchivableListView && mailbox === "archive";
  const mailNoticeAction = useMemo<HomeMailNoticeAction | null>(() => {
    if (!noticeResourceAction) return null;
    if (noticeResourceAction.kind === "logic_gate") {
      const logicGateID = noticeResourceAction.logicGateID;
      return {
        label: "Go to Logic Gate",
        onClick: () => openLogicGateArena(logicGateID, logicGateTitle(logicGateByID.get(logicGateID))),
      };
    }
    const nodeID = noticeResourceAction.nodeID;
    const node = nodeByID.get(nodeID);
    if (!node) return null;
    return {
      label: "Go to Node",
      onClick: () => openNodeEditorOverlay(node),
    };
  }, [logicGateByID, nodeByID, noticeResourceAction, openLogicGateArena, openNodeEditorOverlay]);
  const listViewLabel = activeViewID === "my-triage" || activeViewID === "shared-root" || activeViewID.startsWith("shared:")
    ? activeViewLabel
    : isArchivableListView ? mailboxLabel(mailbox) : activeViewLabel;
  const mailboxActionBusy = busy === "archive" || busy === "unarchive";
  const unreadMessageCount = messages.reduce((count, message) => count + (message.unread ? 1 : 0), 0);
  const closeCompose = useCallback(() => {
    saveCurrentComposeDraft();
    composeRef.current = emptyCompose;
    setCompose(emptyCompose);
  }, [saveCurrentComposeDraft]);
  const saveComposeAndStayOpen = useCallback((composeAtSave: ComposeState) => {
    saveCurrentComposeDraft({ keepOpen: true }, composeAtSave);
  }, [saveCurrentComposeDraft]);
  const ensureComposeDraft = useCallback(async (composeAtEnsure: ComposeState): Promise<ComposeState> => {
    const current = composeRef.current;
    if (
      !current.open
      || current.draftID !== composeAtEnsure.draftID
      || current.sharedInboxID.trim() !== composeAtEnsure.sharedInboxID.trim()
      || current.accountEmail.trim().toLowerCase() !== composeAtEnsure.accountEmail.trim().toLowerCase()
    ) throw new Error("email_draft_target_changed");
    const composeForEnsure = {
      ...current,
      draftID: current.draftID.trim() || composeDraftID(current),
    };
    composeRef.current = composeForEnsure;
    setCompose(composeForEnsure);
    const drafts = await ensureHomeMailDraftAttachmentTarget(
      companyID,
      currentUserID,
      composeForEnsure,
      composeScopeEmailSignature,
    );
    const latest = composeRef.current;
    if (
      !latest.open
      || latest.draftID !== composeForEnsure.draftID
      || latest.sharedInboxID.trim() !== composeForEnsure.sharedInboxID.trim()
      || latest.accountEmail.trim().toLowerCase() !== composeForEnsure.accountEmail.trim().toLowerCase()
    ) throw new Error("email_draft_target_changed");
    setMailDraftsForScopeIfActive(drafts, composeForEnsure.sharedInboxID, composeForEnsure.accountEmail);
    return composeForEnsure;
  }, [companyID, composeDraftID, composeScopeEmailSignature, currentUserID, setMailDraftsForScopeIfActive]);
  const discardEmptyComposeDraft = useCallback((preparedCompose: ComposeState) => {
    const current = composeRef.current;
    const draftID = preparedCompose.draftID.trim();
    if (
      !draftID
      || !current.open
      || current.draftID.trim() !== draftID
      || current.sharedInboxID.trim() !== preparedCompose.sharedInboxID.trim()
      || current.accountEmail.trim().toLowerCase() !== preparedCompose.accountEmail.trim().toLowerCase()
      || composeHasDraftContent(current, composeScopeEmailSignature)
    ) return;
    const deleting = deleteHomeMailDraftRemote(companyID, currentUserID, draftID);
    setMailDraftsForScopeIfActive(
      readHomeMailDraftsForScope(companyID, currentUserID, current.sharedInboxID, current.accountEmail),
      current.sharedInboxID,
      current.accountEmail,
    );
    void deleting.then((drafts) => {
      const latest = composeRef.current;
      if (
        latest.open
        && latest.draftID.trim() === draftID
        && latest.sharedInboxID.trim() === current.sharedInboxID.trim()
        && latest.accountEmail.trim().toLowerCase() === current.accountEmail.trim().toLowerCase()
      ) setMailDraftsForScopeIfActive(drafts, current.sharedInboxID, current.accountEmail);
    });
  }, [companyID, composeScopeEmailSignature, currentUserID, setMailDraftsForScopeIfActive]);
  const handleComposeChange = useCallback((next: React.SetStateAction<ComposeState>) => {
    const resolved = typeof next === "function"
      ? (next as (current: ComposeState) => ComposeState)(composeRef.current)
      : next;
    composeRef.current = resolved;
    setCompose(resolved);
  }, []);
  const handleEmailSignatureChange = useCallback((value: string) => {
    emailSignatureEditRevisionRef.current += 1;
    setEmailSignature(value);
    setEmailSignatureScopeKey(composeSignatureScopeKey);
  }, [composeSignatureScopeKey]);
  const handleSaveEmailSignature = useCallback((signature: string) => {
    const sharedInboxID = compose.sharedInboxID.trim();
    emailSignatureEditRevisionRef.current += 1;
    setEmailSignature(signature);
    setEmailSignatureScopeKey(composeSignatureScopeKey);
    void saveHomeMailSignatureRemote(companyID, currentUserID, signature, sharedInboxID, composeSignatureAccountEmail)
      .then(() => setNotice("Signature saved."))
      .catch(() => setNotice("Signature save failed. Mango will retry this mailbox-scoped edit; retry before leaving if it remains unsynced."));
  }, [companyID, compose.sharedInboxID, composeSignatureAccountEmail, composeSignatureScopeKey, currentUserID]);
  const activeMessageListKey = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly, activeEmailMailboxScopeKey, messageListOrder);
  const activeMailViewCanLoadMessages = canLoadMailForView(activeViewID);
  const messageListIsCurrent = !activeMailViewCanLoadMessages || loadedMessageListKey === activeMessageListKey;
  const visibleMessages = useMemo(() => {
    if (!messageListIsCurrent) return [];
    const listMessages = isPrimaryTriageMailbox(activeViewID, mailbox)
      ? primaryTriageVisibleMessagesForList(messages, messageListOrder)
      : isArchivableListView && mailbox !== "drafts"
        ? condenseEmailThreadMessages(messages)
        : messages;
    return orderEmailConversationMessages(listMessages, messageListOrder);
  }, [activeViewID, isArchivableListView, mailbox, messageListIsCurrent, messageListOrder, messages]);
  useEffect(() => {
    if (!messageListIsCurrent || mailbox === "drafts" || isPrimaryTriageMailbox(activeViewID, mailbox)) return undefined;
    if (!nextPageToken || loadingMessages || loadingMoreMessages) return undefined;
    const owner = currentMailboxRequestOwner();
    const frameID = window.requestAnimationFrame(() => {
      if (!mailboxRequestOwnerIsCurrent(owner)) return;
      const list = messageListRef.current;
      if (!list) return;
      if (messageListContentScrollHeight(list) <= list.clientHeight + 1) void loadMoreMessages();
    });
    return () => window.cancelAnimationFrame(frameID);
  }, [
    activeViewID,
    currentMailboxRequestOwner,
    loadMoreMessages,
    loadingMessages,
    loadingMoreMessages,
    mailbox,
    mailboxRequestOwnerIsCurrent,
    messageListIsCurrent,
    messages.length,
    nextPageToken,
    visibleMessages.length,
  ]);
  const selectedProviderMutationAvailable = providerMutationAvailableForMessages(getSelectedMessagesForAction());
  const visibleUnreadMessageCount = visibleMessages.reduce((count, message) => count + (message.unread ? 1 : 0), 0);
  const visibleLoadingMessages = loadingMessages || (activeMailViewCanLoadMessages && !messageListIsCurrent);
  const baseMailboxCounts = useMemo(() => mailboxCountsFromFolders(folders), [folders]);
  const currentMailboxCountKey = homeMailboxCountKey(activeEmailMailboxScopeKey);
  const currentMailboxCountOverrides = mailboxCountOverrides[currentMailboxCountKey] ?? {};
  const primaryMailboxCountOverride = currentMailboxCountOverrides.primary;
  const starredMailboxCountOverride = currentMailboxCountOverrides.starred;
  const exactInboxCount = baseMailboxCounts.primary === undefined
    ? undefined
    : primaryMailboxCountOverride ?? baseMailboxCounts.primary;
  const loadedInboxCount = activeMailViewHasEmailConnection
    && isArchivableListView
    && mailbox === "primary"
    && !searchQuery.trim()
    && !unreadOnly
    && loadedMessageListKey === activeMessageListKey
    && !activeSharedInboxNeedsEmail
    && !activeSharedInboxBlocksEmail
    && !loadingMessages
    ? messages.length
    : undefined;
  const currentLoadedInboxFallback = loadedInboxCount === undefined
    ? undefined
    : { count: loadedInboxCount, isMinimum: Boolean(nextPageToken) };
  const storedInboxCountFallback = inboxCountFallbacks[currentMailboxCountKey];
  const inboxCountFallback = currentLoadedInboxFallback ?? storedInboxCountFallback;
  const inboxCount = inboxCountPresentation(
    exactInboxCount,
    inboxCountFallback?.count,
    inboxCountFallback?.isMinimum ?? false,
  );
  const mailboxCounts = useMemo(() => ({ primary: inboxCount.count }), [inboxCount.count]);
  useEffect(() => {
    if (loadedInboxCount === undefined) return;
    const nextFallback = { count: loadedInboxCount, isMinimum: Boolean(nextPageToken) };
    setInboxCountFallbacks((previous) => {
      const current = previous[currentMailboxCountKey];
      if (current?.count === nextFallback.count && current.isMinimum === nextFallback.isMinimum) return previous;
      return { ...previous, [currentMailboxCountKey]: nextFallback };
    });
  }, [currentMailboxCountKey, loadedInboxCount, nextPageToken]);
  useEffect(() => {
    if (baseMailboxCounts.primary === undefined || primaryMailboxCountOverride === undefined) return;
    if (baseMailboxCounts.primary === primaryMailboxCountOverride) setPrimaryMailboxCountOverride(currentMailboxCountKey, undefined);
  }, [baseMailboxCounts.primary, currentMailboxCountKey, primaryMailboxCountOverride, setPrimaryMailboxCountOverride]);
  useEffect(() => {
    if (baseMailboxCounts.starred === undefined || starredMailboxCountOverride === undefined) return;
    if (baseMailboxCounts.starred === starredMailboxCountOverride) setStarredMailboxCountOverride(currentMailboxCountKey, undefined);
  }, [baseMailboxCounts.starred, currentMailboxCountKey, setStarredMailboxCountOverride, starredMailboxCountOverride]);
  useEffect(() => {
    if (!activeMailViewHasEmailConnection || !isArchivableListView || mailbox !== "primary" || searchQuery.trim() || unreadOnly) return;
    if (loadedMessageListKey !== activeMessageListKey) return;
    if (activeSharedInboxNeedsEmail || activeSharedInboxBlocksEmail || loadingMessages || loadingMoreMessages || nextPageToken) return;
    setPrimaryMailboxCountOverride(currentMailboxCountKey, messages.length);
  }, [
    activeSharedInboxBlocksEmail,
    activeSharedInboxNeedsEmail,
    activeMessageListKey,
    currentMailboxCountKey,
    isArchivableListView,
    loadedMessageListKey,
    loadingMessages,
    loadingMoreMessages,
    mailbox,
    messages.length,
    nextPageToken,
    searchQuery,
    setPrimaryMailboxCountOverride,
    activeMailViewHasEmailConnection,
    unreadOnly,
  ]);
  useEffect(() => {
    if (!activeMailViewHasEmailConnection || isInboxMatrixView || isMyWorkView || isUpdatesView) return;
    window.dispatchEvent(new CustomEvent("mangorts:home-unread-counts-updated", {
      detail: { companyID, viewID: activeViewID, unreadCount: unreadMessageCount },
    }));
  }, [activeMailViewHasEmailConnection, activeViewID, companyID, isInboxMatrixView, isMyWorkView, isUpdatesView, unreadMessageCount]);
  const visibleArchiveCandidateCount = isPrimaryTriageMailbox(activeViewID, mailbox)
    ? primaryTriageVisibleRawMessageIDs(messages.filter((message) => emailMessageUsesActiveProviderScope(
      message,
      activeViewID,
      currentUserID,
      activeMailAccountEmail,
    )), messageListOrder).length
    : 0;
  const archiveQueueHasRoomForVisiblePage = queuedArchiveEmailCount + visibleArchiveCandidateCount <= ARCHIVE_QUEUE_MAX_EMAILS;
  const mailFilterStatus = selectedMessageIDs.size > 1
    ? `${selectedMessageIDs.size} selected`
    : (visibleLoadingMessages || loadingMoreMessages) ? "Loading" : "";
  const showLocalEntityRail = !embedded;
  const layoutColumnWidths = isNarrow || isInboxMatrixView || isMyWorkView || isUpdatesView
    ? columnWidths
    : fitHomeColumnWidthsToAvailableWidth(columnWidths, workspaceTrackWidth, !appSidebarOwnsNavigation);
  const workspaceGridTemplateColumns = isNarrow
    ? "1fr"
    : isMyWorkView || isUpdatesView
      ? appSidebarOwnsNavigation
        ? "minmax(0, 1fr)"
        : `${layoutColumnWidths[0]}px minmax(0, 1fr)`
      : appSidebarOwnsNavigation
      ? isInboxMatrixView
        ? showLocalEntityRail
          ? getInboxMatrixGridTemplateColumnsWithoutSidebar(layoutColumnWidths)
          : "minmax(0, 1fr)"
        : showLocalEntityRail
          ? getHomeGridTemplateColumnsWithoutSidebar(layoutColumnWidths)
          : `${layoutColumnWidths[1]}px ${HOME_COLUMN_RESIZER_WIDTH}px minmax(${layoutColumnWidths[2]}px, 1fr)`
      : isInboxMatrixView
        ? getInboxMatrixGridTemplateColumns(layoutColumnWidths)
        : getHomeGridTemplateColumns(layoutColumnWidths);
  const matrixWorkspaceActive = (isInboxMatrixView || isMyWorkView || isUpdatesView) && !isNarrow;
  const workspaceLayoutStyle: React.CSSProperties = {
    ...workspaceStyle,
    gridTemplateColumns: workspaceGridTemplateColumns,
    gap: matrixWorkspaceActive ? 0 : isNarrow ? 10 : 0,
    padding: matrixWorkspaceActive ? 0 : workspaceStyle.padding,
  };
  return (
    <div style={embedded ? { ...pageStyle, height: "100%" } : pageStyle}>
      {!embedded && (
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <h1 style={brandStyle}>
            <MangoWordmark size={22} weight={500} />
          </h1>
          <span style={headerDividerStyle} />
          <span style={titleStyle}>Home</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {me && <span style={userPillStyle}>{me.user.display_name?.trim() || me.user.email}</span>}
          <button style={headerButtonStyle} onClick={() => onNavigate?.("/")}>MangoRTS</button>
          <button style={headerButtonStyle} onPointerEnter={preloadLogicGateArenaSurface} onFocus={preloadLogicGateArenaSurface} onPointerDown={preloadLogicGateArenaSurface} onClick={() => onNavigate?.("/logic-gate-arena")}>Logic Gate Arena</button>
          <button style={headerButtonStyle} onClick={() => onNavigate?.("/settings")}>Settings</button>
        </div>
      </header>
      )}
      {error && !status?.connected && <div style={errorStyle}>{error}</div>}
      {notice && !status?.connected && <div style={noticeStyle}>{notice}</div>}
      {(isMyWorkView || isUpdatesView || isInboxMatrixView) && <OutboundEmailUndoBanner />}
      {loadingStatus ? (
        <main style={centerStyle}>Loading email connection</main>
      ) : !status?.configured ? (
        <main style={centerStyle}>
          <section style={connectPanelStyle}>
            <h2 style={panelTitleStyle}>Email is not configured</h2>
            <p style={mutedTextStyle}>Set the Nylas environment variables on the backend, then restart the API.</p>
          </section>
        </main>
      ) : showPersonalEmailConnectPanel ? (
        <main style={centerStyle}>
          <section style={connectPanelStyle}>
            <h2 style={panelTitleStyle}>Connect your company email</h2>
            <p style={mutedTextStyle}>Mango will ask Nylas for access to your existing mailbox. Email stays in your provider.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button style={primaryButtonStyle} disabled={!!busy} onClick={() => startConnection("google")}>
                {busy === "google" ? "Opening" : "Connect Google"}
              </button>
              <button style={primaryButtonStyle} disabled={!!busy} onClick={() => startConnection("microsoft")}>
                {busy === "microsoft" ? "Opening" : "Connect Microsoft"}
              </button>
            </div>
          </section>
        </main>
      ) : (
        <main ref={workspaceRef} style={workspaceLayoutStyle}>
          {isMyWorkView ? (
            <MyWorkView
              apiBase={apiBase}
              loading={loadingNodes || loadingLogicGates}
              companyID={companyID}
              currentUserID={currentUserID}
              liveRefreshToken={myWorkLiveRefreshToken}
              nodes={nodes}
              logicGates={logicGates}
              companyUsers={companyUsers}
              companyUserGroups={companyUserGroups}
              companyUserGroupMembers={companyUserGroupMembers}
              onOpenNode={openNodeEditorOverlay}
              onOpenLogicGate={(logicGateID, label, nodeID) => openLogicGateArena(logicGateID, label || logicGateTitle(logicGateByID.get(logicGateID)), nodeID)}
              onOpenProject={openProjectManagement}
              onRenameNode={renameMyWorkNode}
              onRequestDeleteNode={(nodeID, position) => requestDeleteBulkEditTargets("node", [nodeID], position)}
              onCreateNodeInCell={(input) => { void createNodeInInboxCell(input); }}
              onDropNodes={(input) => moveMyWorkNodesIntoCell(input)}
              onDropNodesInCell={(input) => { void dropNodesIntoNewInboxLogicGate(input); }}
              onDropLogicGates={(input) => { void moveLogicGatesIntoInboxCell(input); }}
              onDropProjects={(input) => { void moveProjectsIntoInboxCell(input); }}
              hiddenNodeIDs={optimisticMyWorkDeletedNodeIDs}
            />
          ) : isUpdatesView ? (
            <UpdatesView
              apiBase={apiBase}
              companyID={companyID}
              currentUserID={currentUserID}
              onOpenNode={() => undefined}
              onOpenLogicGate={(logicGateID, label, nodeID, informationID) => openLogicGateArena(logicGateID, label || logicGateTitle(logicGateByID.get(logicGateID)), nodeID, informationID)}
              onOpenProject={openProjectManagement}
              resolveNodeDetails={(nodeID) => {
                const node = nodeByID.get(nodeID);
                return node ? { title: nodeTitle(node), status: node.status, priority: node.priority } : null;
              }}
              resolveLogicGateDetails={(logicGateID) => {
                const logicGate = logicGateByID.get(logicGateID);
                return logicGate ? { title: logicGateTitle(logicGate) } : null;
              }}
              resolveUserLabel={(userID) => {
                const companyUser = companyUserByID.get(userID);
                if (companyUser) return homeCompanyUserLabel(companyUser, "");
                if (userID.trim() === currentUserID.trim()) return me?.user.display_name?.trim() || me?.user.email?.trim() || "";
                return "";
              }}
            />
          ) : isInboxMatrixView ? (
            <>
              {activeRACIInboxSection && (
                <RACIRoleInboxMatrix
                  section={activeRACIInboxSection}
                  loading={loadingNodes}
                  nodes={matrixFilteredNodes}
                  nodeByID={nodeByID}
                  nodeRelationships={nodeRelationships}
                  logicGateByID={logicGateByID}
                  nodeFolders={nodeFolders}
                  nodeFolderItems={nodeFolderItems}
                  currentUserID={activeRACIMatrixUserID}
                  viewerSelector={gvicMatrixViewerSelectorElement}
                  accountFilter={matrixAccountFilterControl}
                  notificationSummary={notificationSummary}
                  selectedRowIDs={selectedNodeRowIDs}
                  selectedLogicGateRowIDs={selectedLogicGateRowIDs}
                  getNodeDragIDs={getNodeDragIDs}
                  getLogicGateDragIDs={getLogicGateDragIDs}
                  onSelectNode={selectNodeMatrixCard}
                  onSelectLogicGate={selectLogicGateTreeID}
                  onOpenNode={openNodeEditorOverlay}
                  onOpenLogicGate={openLogicGateArena}
                  onOpenNodeBulkMenu={openNodeBulkEditMenu}
                  onOpenLogicGateBulkMenu={openLogicGateBulkEditMenu}
                  onOpenLogicGateBulkMenuAt={openLogicGateBulkEditMenuAt}
                  onRequestDeleteLogicGate={requestDeleteLogicGateContext}
                  onCreateNodeInLogicGate={(input) => { void createHomeNode(input); }}
                  onCreateNodeInCell={(input) => { void createNodeInInboxCell(input); }}
                  onCreateLogicGateInCell={(input) => { void createLogicGateInInboxCell(input); }}
                  onDropNodes={(input) => { void dropNodesIntoInboxLogicGate(input); }}
                  onDropNodesInCell={(input) => { void dropNodesIntoNewInboxLogicGate(input); }}
                  onDropLogicGates={(input) => { void moveLogicGatesIntoInboxCell(input); }}
                />
              )}
              {showLocalEntityRail && appSidebarOwnsNavigation && !isNarrow && <HomeColumnResizeHandle dividerIndex={2} onPointerDown={startColumnResize} />}
              {showLocalEntityRail && (
                <NodeInboxRail
                  loading={loadingNodes}
                  nodeByID={nodeByID}
                  logicGateByID={logicGateByID}
                  allRows={visibleNodeRows}
                  myNodeGroups={myNodeGroups}
                  otherNodes={otherAssignedNodes}
                  myLogicGateGroups={activeRACIRoleLogicGateGroups}
                  inboxRole={activeRACIInboxSection?.role ?? "other"}
                  selectedRowIDs={selectedNodeRowIDs}
                  selectedLogicGateRowIDs={selectedLogicGateRowIDs}
                  expandedRowIDs={nodeExpandedIDs}
                  search={nodeSearch}
                  busy={!!busy}
                  getNodeDragIDs={getNodeDragIDs}
                  getLogicGateDragIDs={getLogicGateDragIDs}
                  onSearchChange={setNodeSearch}
                  onToggleFolder={(rowID) => {
                    setNodeExpandedIDs((previous) => {
                      const next = new Set(previous);
                      if (next.has(rowID)) next.delete(rowID);
                      else next.add(rowID);
                      return next;
                    });
                  }}
                  onSelectRow={selectNodeRow}
                  onSelectNode={selectNodeMatrixCard}
                  onSelectLogicGate={selectLogicGateTreeID}
                  onOpenNode={openNodeEditorOverlay}
                  onOpenLogicGate={openLogicGateArena}
                  onOpenNodeBulkMenu={openNodeBulkEditMenu}
                  onRemoveLogicGateShortcut={removeShortcut}
                  onConvertMessages={convertMessagesToLogicGate}
                  onRequestDeleteLogicGate={requestDeleteLogicGateContext}
                  onCreateNode={() => { void createHomeNode(); }}
                />
              )}
            </>
          ) : (
            <>
          {!appSidebarOwnsNavigation && !isNarrow && <HomeColumnResizeHandle dividerIndex={0} onPointerDown={startColumnResize} />}
          <HomeMailWorkspace
            activeViewID={activeViewID}
            accountEmail={activeMailAccountEmail}
            archiveAvailable={canMutateCurrentMailView && selectedProviderMutationAvailable}
            archiveLabel={isArchiveMailbox ? "Unarchive" : "Archive"}
            busy={busy}
            companyID={companyID}
            entityRequestJSON={permissionsRequestJSON}
            currentUserID={currentUserID}
            compose={compose}
            draftCount={activeMailDrafts.length}
            emailSignature={composeScopeEmailSignature}
            emailSignatureID={composeScopeEmailSignatureID}
            emailSignatureAccountEmail={composeSignatureAccountEmail}
            error={error}
            isArchivableListView={isArchivableListView}
            isArchiveMailbox={isArchiveMailbox}
            listViewLabel={listViewLabel}
            loadingDetail={loadingDetail}
            loadingMessages={visibleLoadingMessages}
            loadingMoreMessages={loadingMoreMessages}
            mailFilterStatus={mailFilterStatus}
            messageListOrder={messageListOrder}
            mailbox={mailbox}
            mailboxCounts={mailboxCounts}
            inboxCountIsMinimum={inboxCount.isMinimum}
            messageListRef={messageListRef}
            messages={visibleMessages}
            nodes={nodes}
            logicGates={logicGates}
            companyUsers={companyUsers}
            companyUserGroups={companyUserGroups}
            companyUserGroupMembers={companyUserGroupMembers}
            notice={notice}
            noticeAction={mailNoticeAction}
            emailConnectionPrompt={status?.connected === false && activePersonalMailViewNeedsConnection
              ? { onConnect: (provider) => { void startConnection(provider); } }
              : undefined}
            pendingStarredMessageIDs={pendingStarredMessageIDs}
            searchDraft={searchDraft}
            selectedMessage={selectedMessage}
            selectedMessageRowKey={selectedMessageRowKey}
            selectedMessageIDs={selectedMessageIDs}
            selectedThreadMessages={selectedThreadMessages}
            sharedInboxSettings={activeSharedInbox ? {
              onOpen: () => setSharedInboxPermissionsFolderID(activeSharedInbox.folder_id),
              onOpenRACI: activeSharedInbox.entry_type === "shared_inbox" ? () => setSharedInboxRACIFolderID(activeSharedInbox.folder_id) : undefined,
            } : undefined}
            unassignedSharedInbox={activeSharedInboxBlocksEmail && activeSharedInbox
              ? { folderName: activeSharedInbox.name, message: "Parent folders cannot have emails assigned." }
              : activeSharedInboxConnectionIssue && activeSharedInbox
                ? {
                    folderName: activeSharedInbox.name,
                    message: activeSharedInboxConnectionIssue.canConnect
                      ? `${activeSharedInboxConnectionIssue.accountEmail} is disconnected. Reconnect it to resume mail syncing.`
                      : `${activeSharedInboxConnectionIssue.accountEmail} is disconnected. A manager or admin with access to this inbox must reconnect it.`,
                    actionLabel: "Reconnect email",
                    onAssignEmail: activeSharedInboxConnectionIssue.canConnect
                      ? () => setSharedInboxEmailConnectionDialog({
                          accountEmail: activeSharedInboxConnectionIssue.accountEmail,
                          canConnect: true,
                        })
                      : undefined,
                  }
              : activeSharedInboxNeedsEmail && activeSharedInbox
                ? { folderName: activeSharedInbox.name, onAssignEmail: currentUserCanManageSharedInboxStructure ? assignActiveSharedInboxEmail : undefined }
                : undefined}
            showDetailResizeHandle={!isNarrow}
            unreadOnly={unreadOnly}
            unreadMessageCount={visibleUnreadMessageCount}
            canAdvanceTriagePage={canMutateCurrentMailView && activeMailViewHasEmailConnection && isPrimaryTriageMailbox(activeViewID, mailbox) && archiveQueueHasRoomForVisiblePage}
            hasNextMessagePage={!!nextPageToken}
            onAdvanceTriagePage={() => { void advanceTriageMailPage(); }}
            onArchiveSelected={archiveSelected}
            onCancelCompose={closeCompose}
            onColumnResizeStart={startColumnResize}
            onComposeChange={handleComposeChange}
            onDeleteSelected={deleteSelected}
            onDisconnect={activeSharedTreeViewSelected ? undefined : requestDisconnect}
            onLoadMessageBody={loadSelectedThreadMessageBody}
            onLoadMoreMessages={() => { void loadMoreMessages(); }}
            onPrefetchMessages={() => { void prefetchNextMessagePage(); }}
            onOpenAllMailbox={openAllMailbox}
            onOpenContextMenu={openMessageContextMenu}
            onOpenNewCompose={openNewCompose}
            onOpenDraftsMailbox={openDraftsMailbox}
            onOpenPendingMailbox={openPendingMailbox}
            onOpenReply={(message) => openReply("reply", message ?? selectedMessage)}
            onOpenReplyAll={openReplyAll}
            onCreateSharedDraft={(message) => { void openSharedDraft(message); }}
            onOpenSentMailbox={openSentMailbox}
            onOpenSpamMailbox={openSpamMailbox}
            onOpenStarredMailbox={openStarredMailbox}
            onOpenForward={openForward}
            onEmailSignatureChange={handleEmailSignatureChange}
            onSaveEmailSignature={handleSaveEmailSignature}
            onSaveComposeDraft={saveComposeAndStayOpen}
            onEnsureComposeDraft={ensureComposeDraft}
            onDiscardEmptyComposeDraft={discardEmptyComposeDraft}
            onSearchDraftChange={setSearchDraft}
            onSelectMessage={selectMessageRow}
            onStartMessageDrag={startMessageDrag}
            onSubmitCompose={submitCompose}
            onSubmitSearch={submitSearch}
            onToggleMessageStar={toggleMessageStar}
            onToggleRead={() => { if (selectedMessage) void patchSelectedMessage({ unread: !selectedMessage.unread }); }}
            onToggleStar={() => { if (selectedMessage) void patchSelectedMessage({ starred: !selectedMessage.starred }); }}
            onToggleMessageListOrder={() => setMessageListOrder((current) => current === "newest" ? "oldest" : "newest")}
            onToggleUnreadOnly={(checked) => {
              unreadOnlyRef.current = checked;
              setUnreadOnly(checked);
              setNextPageToken("");
            }}
            onEmailCollaborationChange={applyEmailCollaborationChange}
            onOpenPickerEntity={openEmailPickerEntity}
            onOpenCollaborationNode={openEmailCollaborationNode}
            onEmailNodeAttachmentChange={applyEmailNodeAttachmentChange}
          />
          {showLocalEntityRail && !isNarrow && <HomeColumnResizeHandle dividerIndex={2} onPointerDown={startColumnResize} />}
          {showLocalEntityRail && (
            <LogicGateRail
              loading={loadingLogicGates}
              logicGateByID={logicGateByID}
              folders={logicGateFolders}
              folderItems={logicGateFolderItems}
              allRows={visibleLogicGateRows}
              selectedRowIDs={selectedLogicGateRowIDs}
              expandedRowIDs={logicGateExpandedIDs}
              search={logicGateSearch}
              myGroups={myLogicGateGroups}
              busy={!!busy}
              getLogicGateDragIDs={getLogicGateDragIDs}
              shortcutLogicGateIDs={shortcutLogicGateIDs}
              onSearchChange={setLogicGateSearch}
              onToggleFolder={(rowID) => {
                setLogicGateExpandedIDs((previous) => {
                  const next = new Set(previous);
                  if (next.has(rowID)) next.delete(rowID);
                  else next.add(rowID);
                  return next;
                });
              }}
              onSelectRow={selectLogicGateRow}
              onSelectShortcut={selectLogicGateShortcut}
              onOpenLogicGate={openLogicGateArena}
              onAddShortcuts={addShortcutsFromExplorerPayload}
              onRemoveShortcut={removeShortcut}
              onConvertMessages={convertMessagesToLogicGate}
              onCreateLogicGate={(options) => { void createHomeLogicGate({ ...options, openArena: false }); }}
              onRequestDeleteLogicGate={requestDeleteLogicGateContext}
            />
          )}
          <HomeMailOverlays
            busy={busy}
            isArchiveMailbox={isArchiveMailbox}
            isDraftMailbox={mailbox === "drafts"}
            mailboxActionBusy={mailboxActionBusy}
            mailMutationAvailable={canMutateCurrentMailView && selectedProviderMutationAvailable}
            messageContextMenu={messageContextMenu}
            deleteConfirmation={deleteConfirmation}
            onArchiveMessages={(ids) => { void archiveMessages(ids); }}
            onCancelDelete={() => { setDeleteConfirmation(null); setMessageContextMenu(null); }}
            onCloseContextMenu={() => setMessageContextMenu(null)}
            onConfirmDelete={(ids) => {
              setDeleteConfirmation(null);
              setMessageContextMenu(null);
              void deleteMessages(ids);
            }}
            onRequestDeleteDrafts={deleteDraftMessages}
            onRequestDeleteMessages={requestDeleteMessages}
            onUnarchiveMessages={(ids) => { void unarchiveMessages(ids); }}
          />
            </>
          )}
        </main>
      )}
      {sharedInboxPermissionsFolder && (
        <EntityPermissionsDialog
          requestJSON={permissionsRequestJSON}
          apiBase={apiBase}
          companyID={companyID}
          entityType={sharedInboxPermissionsFolder.entry_type === "shared_inbox" ? "shared_inbox" : "shared_inbox_folder"}
          entityID={sharedInboxPermissionsFolder.folder_id}
          title={sharedInboxPermissionsFolder.name}
          onClose={() => setSharedInboxPermissionsFolderID("")}
          onSaved={() => { void loadSharedInboxes(); }}
        />
      )}
      {sharedInboxRACIFolder && sharedInboxRACIFolder.entry_type === "shared_inbox" && (
        <SharedInboxRACISettingsModal
          requestJSON={permissionsRequestJSON}
          companyID={companyID}
          folder={sharedInboxRACIFolder}
          companyUsers={companyUsers}
          busy={busy === "shared-inbox-RACI"}
          onAddPrincipal={addSharedInboxRACIPrincipal}
          onRemovePrincipal={removeSharedInboxRACIPrincipal}
          onClose={() => setSharedInboxRACIFolderID("")}
        />
      )}
      <HomeBulkEditMenu
        menu={bulkEditMenu}
        companyUsers={companyUsers}
        logicGates={logicGates}
        nodeByID={nodeByID}
        busy={busy === "bulk-node-edit" || busy === "bulk-logic-gate-edit"}
        onClose={() => setBulkEditMenu(null)}
        onApplyNodePatch={(nodeIDs, patch) => { void applyBulkNodePatch(nodeIDs, patch); }}
        onApplyLogicGateRACI={(logicGateIDs, role, userID, action) => { void applyBulkLogicGateRACI(logicGateIDs, role, userID, action); }}
        onAddNodesToLogicGate={(nodeIDs, logicGateID) => { void addNodesToLogicGate(nodeIDs, logicGateID); }}
        onRequestDelete={requestDeleteBulkEditTargets}
      />
      {disconnectConfirmation && (
        <ConfirmActionMenu
          title="Are you sure you want to disconnect this email?"
          detail="Mail will stop syncing until the mailbox is connected again."
          confirmLabel="Disconnect"
          position={disconnectConfirmation.position}
          isDarkTheme={false}
          requireDisplayNameConfirmation={false}
          onCancel={() => setDisconnectConfirmation(null)}
          onConfirm={() => {
            setDisconnectConfirmation(null);
            void disconnect();
          }}
        />
      )}
      {entityDeleteConfirmation && (
        <DeleteHomeEntitiesConfirmationModal
          targets={entityDeleteConfirmation.targets}
          position={entityDeleteConfirmation.position}
          busy={busy === "entity-delete"}
          onCancel={() => setEntityDeleteConfirmation(null)}
          onConfirm={(confirmationDisplayName) => { void deleteHomeEntities(entityDeleteConfirmation.targets, confirmationDisplayName); }}
        />
      )}
      {sharedInboxEmailAssignmentDialog && (
        <SharedInboxEmailAssignmentDialog
          folderName={sharedInboxEmailAssignmentDialog.folderName}
          draft={sharedInboxEmailAssignmentDialog.draft}
          error={sharedInboxEmailAssignmentDialog.error}
          busy={busy === "shared-inbox"}
          onDraftChange={(draft) => setSharedInboxEmailAssignmentDialog((current) => current ? { ...current, draft, error: "" } : current)}
          onCancel={() => setSharedInboxEmailAssignmentDialog(null)}
          onSubmit={submitSharedInboxEmailAssignment}
        />
      )}
      {sharedInboxEmailConnectionDialog && (
        <SharedInboxEmailConnectionDialog
          accountEmail={sharedInboxEmailConnectionDialog.accountEmail}
          busy={busy === "shared-inbox-connect"}
          canConnect={sharedInboxEmailConnectionDialog.canConnect}
          onCancel={() => setSharedInboxEmailConnectionDialog(null)}
          onConnect={(provider) => { void startSharedInboxEmailConnection(provider); }}
        />
      )}
      {nodeEditorOverlay && (
        <NodeEditorPopup
          nodeID={nodeEditorOverlay.nodeID}
          nodeTitle={nodeEditorOverlay.nodeTitle}
          focusInformationID={nodeEditorOverlay.focusInformationID}
          focusEmailMessageID={nodeEditorOverlay.focusEmailMessageID}
          focusRequestID={nodeEditorOverlay.focusRequestID}
          onClose={closeNodeEditorOverlay}
          onDeleteNode={deleteNodeEditorOverlayNode}
          onCollapseToTab={() => {
            requestAppDockTab({ kind: "node", entityID: nodeEditorOverlay.nodeID, label: nodeEditorOverlay.nodeTitle });
            closeNodeEditorOverlay();
          }}
        />
      )}
    </div>
  );
}

function SharedInboxEmailAssignmentDialog({ folderName, draft, error, busy, onDraftChange, onSubmit, onCancel }: {
  folderName: string;
  draft: string;
  error: string;
  busy: boolean;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <AppModalPortal onRequestClose={busy ? undefined : onCancel}>
    <div style={homeDialogBackdropStyle} onPointerDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Assign shared inbox email"
        style={homeDialogStyle}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div style={homeDialogTitleStyle}>Assign shared inbox email</div>
        <div style={homeDialogDetailStyle}>{folderName.trim() || "Shared Triage"}</div>
        <input
          autoFocus
          type="email"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="name@example.com"
          disabled={busy}
          style={homeDialogInputStyle}
        />
        {error && <div style={homeDialogErrorStyle}>{error}</div>}
        <div style={homeDialogButtonRowStyle}>
          <button type="button" disabled={busy} onClick={onCancel} style={homeDialogSecondaryButtonStyle}>Cancel</button>
          <button type="submit" disabled={busy} style={homeDialogPrimaryButtonStyle}>{busy ? "Saving" : "Save"}</button>
        </div>
      </form>
    </div>
    </AppModalPortal>
  );
}

function SharedInboxEmailConnectionDialog({ accountEmail, busy, canConnect, onConnect, onCancel }: {
  accountEmail: string;
  busy: boolean;
  canConnect: boolean;
  onConnect: (provider: EmailProvider) => void;
  onCancel: () => void;
}) {
  return (
    <AppModalPortal onRequestClose={busy ? undefined : onCancel}>
    <div style={homeDialogBackdropStyle} onPointerDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect shared inbox email"
        style={homeDialogStyle}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div style={homeDialogTitleStyle}>{canConnect ? "Reconnect shared inbox email" : "Shared inbox needs admin reauthorization"}</div>
        <div style={homeDialogDetailStyle}>{canConnect ? `${accountEmail} needs a company shared connection.` : `${accountEmail} needs an admin to reconnect the shared inbox email.`}</div>
        {canConnect && (
          <div style={homeDialogButtonRowStyle}>
            <button type="button" disabled={busy} onClick={() => onConnect("google")} style={homeDialogPrimaryButtonStyle}>Google</button>
            <button type="button" disabled={busy} onClick={() => onConnect("microsoft")} style={homeDialogPrimaryButtonStyle}>Microsoft</button>
          </div>
        )}
        <button type="button" disabled={busy} onClick={onCancel} style={homeDialogSecondaryButtonStyle}>Cancel</button>
      </div>
    </div>
    </AppModalPortal>
  );
}

const homeDialogBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1,
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "rgba(15, 23, 42, 0.42)",
};

const homeDialogStyle: React.CSSProperties = {
  width: "min(420px, 100%)",
  display: "grid",
  gap: 12,
  padding: 16,
  borderRadius: 8,
  border: "1px solid rgba(15, 23, 42, 0.16)",
  background: "#ffffff",
  boxShadow: "0 18px 48px rgba(15, 23, 42, 0.22)",
};

const homeDialogTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  color: "#0f172a",
};

const homeDialogDetailStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.45,
  color: "#475569",
};

const homeDialogInputStyle: React.CSSProperties = {
  minWidth: 0,
  height: 36,
  borderRadius: 6,
  border: "1px solid rgba(15, 23, 42, 0.18)",
  padding: "0 10px",
  fontSize: 13,
  color: "#0f172a",
};

const homeDialogErrorStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#8b123f",
};

const homeDialogButtonRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
};

const homeDialogPrimaryButtonStyle: React.CSSProperties = {
  minHeight: 34,
  borderRadius: 6,
  border: "1px solid #0891b2",
  background: "#0891b2",
  color: "#ffffff",
  fontSize: 12,
  fontWeight: 800,
};

const homeDialogSecondaryButtonStyle: React.CSSProperties = {
  minHeight: 34,
  borderRadius: 6,
  border: "1px solid rgba(15, 23, 42, 0.16)",
  background: "#ffffff",
  color: "#334155",
  fontSize: 12,
  fontWeight: 800,
};

export const HomeFrameContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "mango" | "teal" | "light" | "dark" }> = () => (
  <HomePage embedded />
);
export type { HomePageProps, HomeViewID } from "./homeTypes";
