import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readAuthConfig } from "../../auth/cognitoAuth";
import { createRequestJSON, requestJSON } from "../../modules/api/requestJSON";
import { EntityPermissionsDialog } from "../../modules/permissions/EntityPermissionsDialog";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { requestAppDockTab } from "../../app/appDockTabs";
import { MangoWordmark } from "../../app/MangoLogo";
import { preloadLogicGateArenaSurface } from "../../app/preloadDashboardModules";
import {
  applyEmailMessageToCachedPages,
  addLogicGateRaciAssignments,
  addLocalReplyToEmailMessage,
  disconnectCommunications,
  emailMessageMatchesListFilters,
  EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED,
  fetchCommunicationsAuthURL,
  fetchCommunicationsWorkspacePanel,
  fetchCommunicationsStatus,
  getEmailMessage,
  invalidateCommunicationsCache,
  invalidateCommunicationsFolderCache,
  invalidateCommunicationsWorkspacePanelCache,
  invalidateEmailMessageCache,
  listCompanyUsers,
  listCompanyUserGroups,
  listEmailFolders,
  listEmailMessages,
  listCommunicationsSharedInboxes,
  mergeEmailMessageIntoMessageList,
  primeEmailMessageCache,
  reconcileEmailMessageLocalReply,
  reconcileLocalEmailReply,
  removeLogicGateRaciAssignments,
  removeEmailMessageFromCache,
  sortEmailMessagesByDateDescending,
  updateCommunicationsSharedInboxRaciAssignments,
  type CompanyUser,
  type CompanyUserGroup,
  type CompanyUserGroupMember,
  type CommunicationsSharedInbox,
  type CommunicationsSharedInboxRaciRole,
  type CommunicationsSharedInboxRaciSubjectType,
  type EmailFolder,
  type EmailMailbox,
  type EmailMessage,
  type MessagePage,
  type CommunicationsStatus,
  type EmailProvider,
  type UserLogicGateShortcut,
} from "../../modules/communications/communicationsApi";
import { subscribeCommunicationsStream } from "../../modules/communications/communicationsStream";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../modules/folders/companyExplorerFolders";
import type { NodeRecord, NodeRelationship } from "../../modules/node-map/shared";
import { buildCompanyExplorerTreeRows } from "../../modules/company-explorer/companyExplorerTreeRows";
import { resolveExplorerClickSelection } from "../../modules/company-explorer/treePresentation";
import type { ExplorerDragPayload, ExplorerTreeNode } from "../../modules/company-explorer/companyExplorerTypes";
import type { LogicGateRaciRole, LogicGateRecord } from "../../modules/logic-gate-map/shared";
import { toLogicGateCanvasRecord } from "../../modules/logic-gate-map/shared";
import { invalidateNodeRecordStoreCaches } from "../../modules/node-map/NodeRecordStore";
import { getLogicGateRecordSingleFlight } from "../../modules/logic-gate-map/LogicGateRecordStore";
import { removeNodeRelationshipGraphNode, upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../../modules/node-map/NodeRelationshipGraph";
import { removeLogicGateRelationshipGraphNode, upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../../modules/logic-gate-map/LogicGateRelationshipGraph";
import { invalidateKanbanBoardContentsCache } from "../../modules/kanban/KanbanBoardContentStore";
import { invalidateKanbanBoardListCache, invalidateLogicGateArenaViewCache, type RacioMatrixProjectionRow } from "../../modules/kanban/kanbanApi";
import { applyRacioProjectionEnvelope, parseRacioProjectionSequence, racioRealtimeScope, type RacioProjectionDeltaEnvelope } from "../../modules/racio/racioProjectionDeltas";
import { subscribeRealtimeScope, type RealtimeProjectionDeltaMessage } from "../../modules/realtime/realtimeWebSocket";
import { listMyLogicGates, listRacioMatrixProjectionRows } from "../../modules/work-items/workItemReadApi";
import { subscribeWorkspaceRealtime, workspaceRealtimeScope } from "../../modules/workspace/workspaceRealtime";
import { useNotificationSummary } from "../../modules/notifications/useNotificationSummary";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED } from "../../modules/node-map/eventbus";
import { writePendingLogicGateArenaSelection } from "../logic-gate-arena/logicGateArenaLaunch";
import { buildLogicGateRoute } from "../../app/deepLinkRoutes";
import { DeleteHomeEntitiesConfirmationModal, HomeBulkEditMenu, HomeColumnResizeHandle, HomeSidebar, LogicGateRail, NodeEditorPopup, NodeInboxRail, RacioMatrixViewerSelector, RaciRoleInboxMatrix, SharedInboxRaciSettingsModal, type RacioMatrixViewerListEntry } from "./HomeParts";
import { CustomMatrixView } from "./CustomMatrixView";
import { HomeMailOverlays, HomeMailWorkspace, type HomeMailNoticeAction } from "./HomeMailWorkspace";
import { ARCHIVE_BATCH_FLUSH_DELAY_MS, ARCHIVE_BATCH_SIZE, AUTO_ARCHIVE_SCROLL_DELAY_MS, MESSAGE_BATCH_SIZE, MESSAGE_EVENT_REFRESH_DELAY_MS, SELF_SEND_DELIVERY_REFRESH_DELAY_MS, TRIAGE_MESSAGE_DRAG_MIME } from "./homeConstants";
import { addMyLogicGateShortcutsCommand, addNodesToLogicGateCommand, applyBulkNodePatchCommand, archiveHomeMailMessagesCommand, convertMessagesToLogicGateCommand, createHomeLogicGateCommand, createHomeNodeCommand, createHomeRacioMatrixNodeCommand, createSharedInboxCommand, deleteHomeEntitiesCommand, deleteHomeMailMessagesCommand, deleteSharedInboxCommand, dropNodesIntoInboxLogicGateCommand, moveSharedInboxCommand, removeMyLogicGateShortcutCommand, renameSharedInboxCommand, sendHomeMailComposeCommand, unarchiveHomeMailMessagesCommand, updateHomeMailMessageCommand, updateSharedInboxAccountEmailCommand } from "./homeCommands";
import { buildMyLogicGateGroups, buildMyNodeGroups, canDragTriageMessageFromMailbox, cleanIDList, filterExplorerRowsForSearch, fitHomeColumnWidthsToAvailableWidth, formatAddressList, formatError, formatErrorCode, getHomeColumnMinimumTrackWidth, getHomeGridTemplateColumns, getHomeGridTemplateColumnsWithoutSidebar, getHomeWorkspaceTrackWidth, getHomeViewLabel, getInboxMatrixGridTemplateColumns, getInboxMatrixGridTemplateColumnsWithoutSidebar, isArchivableHomeViewID, isCustomMatrixViewID, isEditableKeyboardTarget, isEmailAccessExpiredError, isInboxMatrixViewID, isWorkspacePanelHomeViewID, logicGateHasAnyRaciRole, logicGateHasRaciRole, logicGateIDFromTreeID, logicGateTitle, logicGateTreeID, mailboxCountsFromFolders, missingLogicGateRecordIDs, mailboxForHomeView, mailboxLabel, markMessageSentToLogicGate, mergeLogicGateShortcuts, messageHasRecipient, messageListFilterKey, nodeIDFromTreeID, nodeTitle, nodeTreeID, raciInboxSectionForView, readHomeColumnWidths, resizeHomeColumns, resizeHomeColumnsWithoutSidebar, resizeHomeInboxMatrixColumnsWithoutSidebar, saveHomeColumnWidths, sharedInboxTreeUserCanManageMail, sortLogicGateShortcuts, sortSharedInboxes, userHasFullSharedInboxAccess, workspaceEventTouchesHomePanel } from "./homeUtils";
import { brandStyle, centerStyle, connectPanelStyle, errorStyle, headerButtonStyle, headerDividerStyle, headerStyle, mutedTextStyle, noticeStyle, pageStyle, panelTitleStyle, primaryButtonStyle, titleStyle, userPillStyle, workspaceStyle } from "./homeStyles";
import { emptyCompose, type ComposeState, type CommunicationsStreamEnvelope, type HomeColumnResizeDrag, type HomeColumnWidths, type HomeEntityDeleteKind, type HomeEntityDeleteTarget, type HomePageProps, type HomeViewID, type InboxPriority, type LoadMessagesOptions, type MessageSelectionModifiers, type NodeEditorOverlayState, type ResponsibleInboxStatus, type WorkspaceStreamEnvelope } from "./homeTypes";

function sharedInboxIDForHomeView(viewID: HomeViewID): string {
  return viewID.startsWith("shared:") ? viewID.slice("shared:".length).trim() : "";
}

function isTriageMailViewID(viewID: HomeViewID): boolean {
  return viewID === "my-triage" || viewID === "shared-root" || viewID.startsWith("shared:");
}

type HomeNoticeResourceAction =
  | { kind: "logic_gate"; logicGateID: string }
  | { kind: "node"; nodeID: string };

const RACIO_VIEWER_LIST_STORAGE_KEY_PREFIX = "mangorts.home.racioViewerList.v1";

function racioViewerListStorageKey(companyID: string, userID: string): string {
  const cleanCompanyID = companyID.trim() || "global";
  const cleanUserID = userID.trim() || "anonymous";
  return `${RACIO_VIEWER_LIST_STORAGE_KEY_PREFIX}:${cleanCompanyID}:${cleanUserID}`;
}

function readRacioViewerListEntries(companyID: string, userID: string): RacioMatrixViewerListEntry[] {
  if (typeof localStorage === "undefined" || !companyID.trim() || !userID.trim()) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(racioViewerListStorageKey(companyID, userID)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries: RacioMatrixViewerListEntry[] = [];
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

function storeRacioViewerListEntries(companyID: string, userID: string, entries: RacioMatrixViewerListEntry[]): void {
  if (typeof localStorage === "undefined" || !companyID.trim() || !userID.trim()) return;
  const cleanEntries = entries
    .map((entry) => ({ kind: entry.kind, id: entry.id.trim() }))
    .filter((entry) => (entry.kind === "group" || entry.kind === "user") && entry.id);
  const key = racioViewerListStorageKey(companyID, userID);
  if (cleanEntries.length === 0) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(cleanEntries));
}

function homeCompanyUserLabel(user: Pick<CompanyUser, "user_id" | "display_name" | "email"> | null | undefined, fallbackUserID: string): string {
  return user?.display_name?.trim() || user?.email?.trim() || fallbackUserID.trim() || "User";
}

function promptEmailProviderForConnection(): EmailProvider | "" {
  const raw = window.prompt("Connect with provider: google or microsoft", "google")?.trim().toLowerCase() ?? "";
  if (raw === "google" || raw === "gmail") return "google";
  if (raw === "microsoft" || raw === "outlook" || raw === "office365") return "microsoft";
  if (raw) window.alert("Enter google or microsoft.");
  return "";
}

function isSharedInboxEmailConnectionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("shared_inbox_email_account_not_connected");
}

async function offerNylasConnectionForSharedInboxEmail(error: unknown, accountEmail: string): Promise<boolean> {
  const cleanAccountEmail = accountEmail.trim().toLowerCase();
  if (!cleanAccountEmail || !isSharedInboxEmailConnectionError(error)) return false;
  if (!window.confirm(`${cleanAccountEmail} is not connected yet. Connect it through Nylas now?`)) return true;
  const provider = promptEmailProviderForConnection();
  if (!provider) return true;
  const authURL = await fetchCommunicationsAuthURL(provider, cleanAccountEmail);
  window.location.assign(authURL);
  return true;
}

type PrefetchedMessagePage = {
  filterKey: string;
  pageToken: string;
  page: MessagePage;
};

type QueuedArchiveBatch = {
  companyID: string;
  sharedInboxID?: string;
  messageIDs: string[];
};

type MailboxCountOverrideKey = Extract<EmailMailbox, "primary" | "starred">;
type MailboxCountOverrides = Record<string, Partial<Record<MailboxCountOverrideKey, number>>>;

function mailCountKey(companyID: string, viewID: HomeViewID): string {
  return `${companyID.trim()}\x1f${sharedInboxIDForHomeView(viewID)}`;
}

function messageHasInboxLabel(message: EmailMessage): boolean {
  return [...(message.folders ?? []), ...(message.folder_ids ?? [])].some((folder) => {
    let token = folder.trim().toLowerCase();
    while (token.startsWith("\\")) token = token.slice(1);
    return token === "inbox";
  });
}

type MessageListScrollAnchor = {
  messageID: string;
  top: number;
};

function captureMessageListScrollAnchor(container: HTMLDivElement, removedIDs: Set<string>): MessageListScrollAnchor | null {
  const containerTop = container.getBoundingClientRect().top;
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-home-mail-message-id]"));
  for (const row of rows) {
    const messageID = row.dataset.homeMailMessageId?.trim();
    if (!messageID || removedIDs.has(messageID)) continue;
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= containerTop + 1) continue;
    return { messageID, top: rect.top - containerTop };
  }
  return null;
}

function restoreMessageListScrollAnchor(container: HTMLDivElement, anchor: MessageListScrollAnchor): void {
  const row = Array.from(container.querySelectorAll<HTMLElement>("[data-home-mail-message-id]"))
    .find((item) => item.dataset.homeMailMessageId?.trim() === anchor.messageID);
  if (!row) return;
  const nextTop = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const delta = nextTop - anchor.top;
  if (Math.abs(delta) > 0.5) container.scrollTop += delta;
}

function messageListAutoArchiveSpacerHeight(container: HTMLDivElement): number {
  return container.querySelector<HTMLElement>("[data-home-mail-auto-archive-spacer]")?.offsetHeight ?? 0;
}

function messageListRemainingDistance(container: HTMLDivElement): number {
  return container.scrollHeight - container.scrollTop - container.clientHeight - messageListAutoArchiveSpacerHeight(container);
}

function messageListContentScrollHeight(container: HTMLDivElement): number {
  return container.scrollHeight - messageListAutoArchiveSpacerHeight(container);
}

export function HomePage({
  me,
  onNavigate,
  embedded = false,
  hideNavigation = false,
  initialViewID = "my-triage",
  deepLinkNodeID,
  onNodeOverlayOpen,
  onNodeOverlayClose,
}: HomePageProps) {
  const companyID = getActiveCompanyID();
  const apiBase = readAuthConfig().apiBase;
  const permissionsRequestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const notificationSummary = useNotificationSummary(companyID);
  const [status, setStatus] = useState<CommunicationsStatus | null>(null);
  const [folders, setFolders] = useState<EmailFolder[]>([]);
  const [mailboxCountOverrides, setMailboxCountOverrides] = useState<MailboxCountOverrides>({});
  const [sharedInboxes, setSharedInboxes] = useState<CommunicationsSharedInbox[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [mailbox, setMailbox] = useState<EmailMailbox>("primary");
  const [activeViewID, setActiveViewID] = useState<HomeViewID>(initialViewID);
  const [selectedMessageID, setSelectedMessageID] = useState("");
  const [selectedMessageIDs, setSelectedMessageIDs] = useState<Set<string>>(new Set());
  const [selectionAnchorMessageID, setSelectionAnchorMessageID] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [pendingAutoArchiveMessageIDs, setPendingAutoArchiveMessageIDs] = useState<Set<string>>(new Set());
  const [pendingStarredMessageIDs, setPendingStarredMessageIDs] = useState<Set<string>>(new Set());
  const [messageContextMenu, setMessageContextMenu] = useState<{ x: number; y: number; messageIDs: string[] } | null>(null);
  const [bulkEditMenu, setBulkEditMenu] = useState<{ x: number; y: number; kind: "node" | "logic_gate"; ids: string[] } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ messageIDs: string[] } | null>(null);
  const [entityDeleteConfirmation, setEntityDeleteConfirmation] = useState<{ targets: HomeEntityDeleteTarget[] } | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [nextPageToken, setNextPageToken] = useState("");
  const [loadedMessageListKey, setLoadedMessageListKey] = useState("");
  const [newSharedInboxName, setNewSharedInboxName] = useState("");
  const [compose, setCompose] = useState<ComposeState>(emptyCompose);
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
  const [racioViewerListEntries, setRacioViewerListEntries] = useState<RacioMatrixViewerListEntry[]>([]);
  const [racioMatrixTargetUserID, setRacioMatrixTargetUserID] = useState("");
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
  const [sharedInboxRaciFolderID, setSharedInboxRaciFolderID] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeResourceAction, setNoticeResourceAction] = useState<HomeNoticeResourceAction | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [workspaceTrackWidth, setWorkspaceTrackWidth] = useState(() => Math.max(1, window.innerWidth - 20));
  const [columnWidths, setColumnWidths] = useState<HomeColumnWidths>(() => readHomeColumnWidths());
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const foldersRequestSeqRef = useRef(0);
  const sharedInboxesRequestInFlightRef = useRef(false);
  const logicGatePanelRequestInFlightRef = useRef(false);
  const nodeRelationshipRequestSeqRef = useRef(0);
  const messageRequestKeyRef = useRef("");
  const pendingMessageReloadRef = useRef(false);
  const pendingMessageRefreshRef = useRef(false);
  const messageRequestSeqRef = useRef(0);
  const loadMessagesRef = useRef<((options?: LoadMessagesOptions) => Promise<void>) | null>(null);
  const prefetchedMessagePageRef = useRef<PrefetchedMessagePage | null>(null);
  const prefetchMessageTokenRef = useRef("");
  const prefetchMessageFilterKeyRef = useRef("");
  const prefetchMessagePromiseRef = useRef<Promise<void> | null>(null);
  const selectedMessageIDRef = useRef("");
  const activeViewIDRef = useRef<HomeViewID>(initialViewID);
  const pendingAutoArchiveMessageIDsRef = useRef<Set<string>>(new Set());
  const pendingStarredMessageIDsRef = useRef<Set<string>>(new Set());
  const autoArchiveTimerIDsRef = useRef<Map<string, number>>(new Map());
  const queuedArchiveBatchesRef = useRef<Map<string, QueuedArchiveBatch>>(new Map());
  const archiveBatchFlushTimerRef = useRef<number | null>(null);
  const folderReloadTimerRef = useRef<number | null>(null);
  const workspacePanelReloadTimerRef = useRef<number | null>(null);
  const messageListRefreshTimerRef = useRef<number | null>(null);
  const racioProjectionSequenceRef = useRef(0);
  const racioProjectionRefetchInFlightRef = useRef(false);
  const racioProjectionInitializedRef = useRef(false);
  const racioProjectionRowsRef = useRef<RacioMatrixProjectionRow[]>([]);
  const racioProjectionScopeKeyRef = useRef("");
  const racioProjectedNodeIDsRef = useRef<Set<string>>(new Set());
  const racioProjectedLogicGateIDsRef = useRef<Set<string>>(new Set());
  const requestRacioProjectionRefreshRef = useRef<((minimumSequence?: number) => void) | null>(null);
  const messagesRef = useRef<EmailMessage[]>([]);
  const foldersRef = useRef<EmailFolder[]>([]);
  const locallyReadMessageIDsRef = useRef<Set<string>>(new Set());
  const mailboxRef = useRef<EmailMailbox>("primary");
  const nextPageTokenRef = useRef("");
  const searchQueryRef = useRef("");
  const unreadOnlyRef = useRef(false);
  const loadingMessagesRef = useRef(false);
  const loadingMoreMessagesRef = useRef(false);
  const activeDeleteSelectionKindRef = useRef<"message" | HomeEntityDeleteKind | "">("");
  const messageListFilterKeyRef = useRef("");
  const noticeResourceTextRef = useRef("");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const columnWidthsRef = useRef<HomeColumnWidths>(columnWidths);
  const columnResizeDragRef = useRef<HomeColumnResizeDrag | null>(null);
  const hideNavigationRef = useRef(hideNavigation);
  const isInboxMatrixView = isInboxMatrixViewID(activeViewID);
  const isCustomMatrixView = isCustomMatrixViewID(activeViewID);
  const isNarrow = isInboxMatrixView
    ? viewportWidth < 980
    : isCustomMatrixView
      ? viewportWidth < 760
      : workspaceTrackWidth < getHomeColumnMinimumTrackWidth(!hideNavigation);
  const currentUserID = me?.user.user_id?.trim() ?? "";
  const activeRacioMatrixUserID = isInboxMatrixView ? (racioMatrixTargetUserID.trim() || currentUserID) : currentUserID;
  useEffect(() => {
    setRacioMatrixTargetUserID(currentUserID);
  }, [companyID, currentUserID]);
  useEffect(() => {
    setRacioViewerListEntries(readRacioViewerListEntries(companyID, currentUserID));
  }, [companyID, currentUserID]);
  const updateRacioViewerListEntries = useCallback((entries: RacioMatrixViewerListEntry[]) => {
    setRacioViewerListEntries(entries);
    storeRacioViewerListEntries(companyID, currentUserID, entries);
  }, [companyID, currentUserID]);
  useEffect(() => {
    const scopeKey = companyID && currentUserID && activeRacioMatrixUserID ? `${companyID}\u0000${currentUserID}\u0000${activeRacioMatrixUserID}` : "";
    if (racioProjectionScopeKeyRef.current === scopeKey) return;
    racioProjectionScopeKeyRef.current = scopeKey;
    racioProjectionSequenceRef.current = 0;
    racioProjectionRefetchInFlightRef.current = false;
    racioProjectionRowsRef.current = [];
    racioProjectionInitializedRef.current = false;
    racioProjectedNodeIDsRef.current = new Set();
    racioProjectedLogicGateIDsRef.current = new Set();
  }, [activeRacioMatrixUserID, companyID, currentUserID]);
  const currentUserHasFullSharedInboxAccess = userHasFullSharedInboxAccess(me, companyID);
  const activeSharedInboxFolderID = sharedInboxIDForHomeView(activeViewID);
  const connection = status?.connection;

  const activeSharedInbox = useMemo(
    () => activeSharedInboxFolderID ? sharedInboxes.find((folder) => folder.folder_id === activeSharedInboxFolderID) ?? null : null,
    [activeSharedInboxFolderID, sharedInboxes],
  );
  const activeSharedInboxIsParent = !!activeSharedInbox && sharedInboxes.some((folder) => (folder.parent_folder_id ?? "").trim() === activeSharedInbox.folder_id);
  const activeSharedInboxNeedsEmail = !!activeSharedInbox && !activeSharedInboxIsParent && !(activeSharedInbox.account_email ?? "").trim();
  const activeSharedInboxBlocksEmail = !!activeSharedInbox && activeSharedInboxIsParent;
  const activeMailAccountEmail = activeViewID === "shared-root"
    ? ""
    : activeSharedInboxFolderID
      ? activeSharedInbox?.account_email ?? ""
      : connection?.account_email;
  const sharedInboxPermissionsFolder = useMemo(
    () => sharedInboxPermissionsFolderID ? sharedInboxes.find((folder) => folder.folder_id === sharedInboxPermissionsFolderID) ?? null : null,
    [sharedInboxPermissionsFolderID, sharedInboxes],
  );
  const sharedInboxRaciFolder = useMemo(
    () => sharedInboxRaciFolderID ? sharedInboxes.find((folder) => folder.folder_id === sharedInboxRaciFolderID) ?? null : null,
    [sharedInboxRaciFolderID, sharedInboxes],
  );
  const canMutateCurrentMailView = activeViewID === "shared-root"
    ? sharedInboxTreeUserCanManageMail(sharedInboxes, "", currentUserID, currentUserHasFullSharedInboxAccess)
    : activeSharedInboxFolderID
      ? sharedInboxTreeUserCanManageMail(sharedInboxes, activeSharedInboxFolderID, currentUserID, currentUserHasFullSharedInboxAccess)
      : true;
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
  const addPendingAutoArchiveMessages = useCallback((messageIDs: string[]) => {
    const pending = pendingAutoArchiveMessageIDsRef.current;
    let changed = false;
    for (const messageID of messageIDs) {
      if (pending.has(messageID)) continue;
      pending.add(messageID);
      changed = true;
    }
    if (changed) setPendingAutoArchiveMessageIDs(new Set(pending));
  }, []);
  const removePendingAutoArchiveMessages = useCallback((messageIDs: string[]) => {
    const pending = pendingAutoArchiveMessageIDsRef.current;
    let changed = false;
    for (const messageID of messageIDs) {
      changed = pending.delete(messageID) || changed;
    }
    if (changed) setPendingAutoArchiveMessageIDs(new Set(pending));
  }, []);
  const cancelPendingAutoArchiveMessages = useCallback((messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    for (const id of ids) {
      const timerID = autoArchiveTimerIDsRef.current.get(id);
      if (timerID === undefined) continue;
      window.clearTimeout(timerID);
      autoArchiveTimerIDsRef.current.delete(id);
    }
    for (const [key, batch] of queuedArchiveBatchesRef.current.entries()) {
      batch.messageIDs = batch.messageIDs.filter((id) => !ids.includes(id));
      if (batch.messageIDs.length === 0) queuedArchiveBatchesRef.current.delete(key);
    }
    removePendingAutoArchiveMessages(ids);
  }, [removePendingAutoArchiveMessages]);
  const addPendingStarredMessages = useCallback((messageIDs: string[]) => {
    const pending = pendingStarredMessageIDsRef.current;
    let changed = false;
    for (const messageID of cleanIDList(messageIDs)) {
      if (pending.has(messageID)) continue;
      pending.add(messageID);
      changed = true;
    }
    if (changed) setPendingStarredMessageIDs(new Set(pending));
  }, []);
  const removePendingStarredMessages = useCallback((messageIDs: string[]) => {
    const pending = pendingStarredMessageIDsRef.current;
    let changed = false;
    for (const messageID of cleanIDList(messageIDs)) {
      changed = pending.delete(messageID) || changed;
    }
    if (changed) setPendingStarredMessageIDs(new Set(pending));
  }, []);
  const cancelPendingStarredMessages = useCallback((messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    removePendingStarredMessages(ids);
  }, [removePendingStarredMessages]);
  useEffect(() => {
    return () => {
      autoArchiveTimerIDsRef.current.forEach((timerID) => window.clearTimeout(timerID));
      autoArchiveTimerIDsRef.current.clear();
      if (archiveBatchFlushTimerRef.current !== null) {
        window.clearTimeout(archiveBatchFlushTimerRef.current);
        archiveBatchFlushTimerRef.current = null;
      }
      pendingAutoArchiveMessageIDsRef.current.clear();
      pendingStarredMessageIDsRef.current.clear();
      queuedArchiveBatchesRef.current.clear();
    };
  }, []);
  useEffect(() => {
    selectedMessageIDRef.current = selectedMessageID;
  }, [selectedMessageID]);
  useEffect(() => {
    activeViewIDRef.current = activeViewID;
  }, [activeViewID]);
  useEffect(() => {
    if (!activeSharedInboxFolderID) return;
    if (sharedInboxes.some((folder) => folder.folder_id === activeSharedInboxFolderID)) return;
    setActiveViewID("shared-root");
  }, [activeSharedInboxFolderID, sharedInboxes]);
  useEffect(() => {
    messagesRef.current = messages;
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
    mailboxRef.current = mailbox;
  }, [mailbox]);
  useEffect(() => {
    nextPageTokenRef.current = nextPageToken;
  }, [nextPageToken]);
  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);
  useEffect(() => {
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
    hideNavigationRef.current = hideNavigation;
  }, [hideNavigation]);
  const setMailboxCountOverride = useCallback((key: string, mailboxKey: MailboxCountOverrideKey, count: number | undefined) => {
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
  const adjustMailboxCount = useCallback((key: string, mailboxKey: MailboxCountOverrideKey, delta: number) => {
    const cleanKey = key.trim();
    if (!cleanKey || delta === 0) return;
    setMailboxCountOverrides((previous) => {
      const currentEntry = previous[cleanKey] ?? {};
      const baseCount = mailboxCountsFromFolders(foldersRef.current)[mailboxKey] ?? 0;
      const currentCount = currentEntry[mailboxKey] ?? baseCount;
      const nextCount = Math.max(0, Math.floor(currentCount + delta));
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
  const adjustPrimaryMailboxCount = useCallback((key: string, delta: number) => {
    adjustMailboxCount(key, "primary", delta);
  }, [adjustMailboxCount]);
  const adjustStarredMailboxCount = useCallback((key: string, delta: number) => {
    adjustMailboxCount(key, "starred", delta);
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
      const nextWidths = hideNavigationRef.current
        ? activeIsInboxMatrixView
          ? resizeHomeInboxMatrixColumnsWithoutSidebar(drag.startWidths, drag.dividerIndex, delta, drag.availableWidth)
          : resizeHomeColumnsWithoutSidebar(drag.startWidths, drag.dividerIndex, delta, drag.availableWidth)
        : resizeHomeColumns(drag.startWidths, drag.dividerIndex, delta, drag.availableWidth);
      const fittedWidths = activeIsInboxMatrixView
        ? nextWidths
        : fitHomeColumnWidthsToAvailableWidth(nextWidths, drag.availableWidth, !hideNavigationRef.current);
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
      const fitted = fitHomeColumnWidthsToAvailableWidth(current, workspaceTrackWidth, !hideNavigation);
      if (fitted.every((width, index) => width === current[index])) return current;
      columnWidthsRef.current = fitted;
      return fitted;
    });
  }, [hideNavigation, isInboxMatrixView, isNarrow, workspaceTrackWidth]);
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
      setNotice("Email connected.");
    }
    if (oauthError) setError(formatErrorCode(oauthError));
    if (connected || oauthError) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const loadStatus = useCallback(async (): Promise<CommunicationsStatus | null> => {
    setLoadingStatus(true);
    setError("");
    try {
      const next = await fetchCommunicationsStatus();
      setStatus(next);
      if (!next.connected) {
        cancelPendingAutoArchiveMessages(Array.from(pendingAutoArchiveMessageIDsRef.current));
        cancelPendingStarredMessages(Array.from(pendingStarredMessageIDsRef.current));
        setMailboxCountOverrides({});
        setFolders([]);
        setSharedInboxes([]);
        setCompanyUsers([]);
        setCompanyUserGroups([]);
        setCompanyUserGroupMembers([]);
        setRacioViewerListEntries([]);
        setRacioMatrixTargetUserID("");
        setMessages([]);
        setSelectedMessage(null);
        setSelectedMessageID("");
        setSelectedMessageIDs(new Set());
        setSelectionAnchorMessageID("");
        setNextPageToken("");
      }
      return next;
    } catch (statusError) {
      setError(formatError(statusError, "Failed to load email connection"));
      return null;
    } finally {
      setLoadingStatus(false);
    }
  }, [cancelPendingAutoArchiveMessages, cancelPendingStarredMessages]);
  const handleEmailAccessExpired = useCallback(async (accessError: unknown) => {
    setNotice("");
    cancelPendingAutoArchiveMessages(Array.from(pendingAutoArchiveMessageIDsRef.current));
    cancelPendingStarredMessages(Array.from(pendingStarredMessageIDsRef.current));
    invalidateCommunicationsCache();
    setMailboxCountOverrides({});
    setFolders([]);
    setMessages([]);
    setSelectedMessage(null);
    setSelectedMessageID("");
    setSelectedMessageIDs(new Set());
    setSelectionAnchorMessageID("");
    await loadStatus();
    setError(formatError(accessError, "Email access expired. Disconnect and reconnect your mailbox."));
  }, [cancelPendingAutoArchiveMessages, cancelPendingStarredMessages, loadStatus]);
  const loadFolders = useCallback(async (): Promise<boolean> => {
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    if (sharedInboxID && sharedInboxes.some((folder) => (folder.parent_folder_id ?? "").trim() === sharedInboxID)) {
      setFolders([]);
      return true;
    }
    const requestSeq = foldersRequestSeqRef.current + 1;
    foldersRequestSeqRef.current = requestSeq;
    try {
      const next = await listEmailFolders({
        companyID: sharedInboxID ? companyID : undefined,
        sharedInboxID: sharedInboxID || undefined,
      });
      if (foldersRequestSeqRef.current === requestSeq) setFolders(next);
      return true;
    } catch (folderError) {
      if (foldersRequestSeqRef.current !== requestSeq) return false;
      if (isEmailAccessExpiredError(folderError)) {
        await handleEmailAccessExpired(folderError);
        return false;
      }
      setError(formatError(folderError, "Failed to load folders"));
      return false;
    }
  }, [companyID, handleEmailAccessExpired, sharedInboxes]);
  const loadSharedInboxes = useCallback(async (): Promise<boolean> => {
    if (sharedInboxesRequestInFlightRef.current) return false;
    sharedInboxesRequestInFlightRef.current = true;
    setLoadingSharedInboxes(true);
    try {
      const next = await listCommunicationsSharedInboxes(companyID);
      setSharedInboxes(next);
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
      const panel = await fetchCommunicationsWorkspacePanel(companyID);
      setLogicGateFolders(panel.logicGateFolders);
      setLogicGateFolderItems(panel.logicGateFolderItems);
      setLogicGates(panel.logicGates);
      setMyLogicGateShortcuts(sortLogicGateShortcuts(panel.myLogicGateShortcuts));
      setNodeFolders(panel.nodeFolders);
      setNodeFolderItems(panel.nodeFolderItems);
      setNodes(panel.nodes);
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
  const scheduleWorkspacePanelReload = useCallback(() => {
    if (!companyID || !isWorkspacePanelHomeViewID(activeViewIDRef.current)) return;
    invalidateCommunicationsWorkspacePanelCache(companyID);
    if (workspacePanelReloadTimerRef.current !== null) {
      window.clearTimeout(workspacePanelReloadTimerRef.current);
    }
    workspacePanelReloadTimerRef.current = window.setTimeout(() => {
      workspacePanelReloadTimerRef.current = null;
      void loadLogicGatePanel();
      void refreshNodeRelationshipsForMatrix();
    }, 250);
  }, [companyID, loadLogicGatePanel, refreshNodeRelationshipsForMatrix]);
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
    prefetchedMessagePageRef.current = null;
    prefetchMessageTokenRef.current = "";
    prefetchMessageFilterKeyRef.current = "";
    prefetchMessagePromiseRef.current = null;
  }, []);
  const currentMessageFilterKey = useCallback(() => (
    messageListFilterKey(companyID, activeViewIDRef.current, mailboxRef.current, searchQueryRef.current, unreadOnlyRef.current)
  ), [companyID]);
  const messageListWithinPrefetchDistance = useCallback(() => {
    const list = messageListRef.current;
    if (!list) return false;
    const remaining = messageListRemainingDistance(list);
    return remaining < Math.max(800, list.clientHeight * 2);
  }, []);
  const loadMessages = useCallback(async (options: LoadMessagesOptions = {}) => {
    if (!status?.connected) return;
    if (isInboxMatrixViewID(activeViewID) || isCustomMatrixViewID(activeViewID)) {
      setLoadedMessageListKey("");
      setMessages([]);
      setSelectedMessage(null);
      setSelectedMessageID("");
      setSelectedMessageIDs(new Set());
      setSelectionAnchorMessageID("");
      setNextPageToken("");
      clearPrefetchedMessagePage();
      return;
    }
    if (activeSharedInboxNeedsEmail || activeSharedInboxBlocksEmail) {
      setLoadedMessageListKey("");
      setMessages([]);
      setSelectedMessage(null);
      setSelectedMessageID("");
      setSelectedMessageIDs(new Set());
      setSelectionAnchorMessageID("");
      setNextPageToken("");
      messageRequestKeyRef.current = "";
      messageListFilterKeyRef.current = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly);
      clearPrefetchedMessagePage();
      return;
    }
    const requestKey = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly);
    messageListFilterKeyRef.current = requestKey;
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
        mailbox,
        companyID,
        sharedInboxID: sharedInboxIDForHomeView(activeViewID),
        q: searchQuery,
        unread: unreadOnly ? true : undefined,
        refresh: options.refresh,
      });
      if (messageRequestSeqRef.current !== requestSeq) return;
      const pageMessages = page.messages ?? [];
      setMessages(pageMessages);
      setNextPageToken(page.next_page_token ?? "");
      setLoadedMessageListKey(requestKey);
      const currentSelectedMessageID = selectedMessageIDRef.current;
      const currentSelectionStillVisible = !!currentSelectedMessageID && pageMessages.some((message) => message.id === currentSelectedMessageID);
      if (!currentSelectionStillVisible && isTriageMailViewID(activeViewID) && pageMessages.length > 0) {
        const firstMessage = pageMessages[0];
        setSelectedMessageID(firstMessage.id);
        setSelectedMessageIDs(new Set([firstMessage.id]));
        setSelectionAnchorMessageID(firstMessage.id);
        setSelectedMessage(firstMessage);
      } else if (!currentSelectionStillVisible && currentSelectedMessageID) {
        setSelectedMessageID("");
        setSelectedMessage(null);
        setSelectedMessageIDs(new Set());
        setSelectionAnchorMessageID("");
      }
    } catch (messageError) {
      if (messageRequestSeqRef.current === requestSeq) {
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
          pendingMessageReloadRef.current = false;
          pendingMessageRefreshRef.current = false;
          window.setTimeout(() => { void loadMessages({ refresh }); }, 0);
        }
      }
    }
  }, [activeSharedInboxBlocksEmail, activeSharedInboxNeedsEmail, activeViewID, clearPrefetchedMessagePage, companyID, handleEmailAccessExpired, mailbox, searchQuery, status?.connected, unreadOnly]);
  const appendPrefetchedMessagePage = useCallback((filterKey: string, pageToken: string): string | null => {
    const prefetched = prefetchedMessagePageRef.current;
    if (!prefetched || prefetched.filterKey !== filterKey || prefetched.pageToken !== pageToken) return null;
    prefetchedMessagePageRef.current = null;
    prefetchMessageTokenRef.current = "";
    prefetchMessageFilterKeyRef.current = "";
    prefetchMessagePromiseRef.current = null;
    const page = prefetched.page;
    setMessages((previous) => {
      const seen = new Set(previous.map((message) => message.id));
      const next = [...previous];
      for (const message of page.messages ?? []) {
        if (!message.id || seen.has(message.id)) continue;
        seen.add(message.id);
        next.push(message);
      }
      return sortEmailMessagesByDateDescending(next);
    });
    setNextPageToken(page.next_page_token ?? "");
    return page.next_page_token ?? "";
  }, []);
  const prefetchNextMessagePage = useCallback(async (explicitPageToken?: string) => {
    if (!status?.connected || isInboxMatrixViewID(activeViewIDRef.current) || isCustomMatrixViewID(activeViewIDRef.current) || loadingMessagesRef.current) return;
    const pageToken = (explicitPageToken ?? nextPageTokenRef.current).trim();
    if (!pageToken) return;
    const filterKey = currentMessageFilterKey();
    const prefetched = prefetchedMessagePageRef.current;
    if (prefetched?.filterKey === filterKey && prefetched.pageToken === pageToken) return;
    if (prefetchMessagePromiseRef.current && prefetchMessageFilterKeyRef.current === filterKey && prefetchMessageTokenRef.current === pageToken) return;
    prefetchMessageFilterKeyRef.current = filterKey;
    prefetchMessageTokenRef.current = pageToken;
    const request = listEmailMessages({
      limit: MESSAGE_BATCH_SIZE,
      pageToken,
      mailbox: mailboxRef.current,
      companyID,
      sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
      q: searchQueryRef.current,
      unread: unreadOnlyRef.current ? true : undefined,
    })
      .then((page) => {
        if (messageListFilterKeyRef.current !== filterKey || nextPageTokenRef.current !== pageToken) return;
        prefetchedMessagePageRef.current = { filterKey, pageToken, page };
      })
      .catch((messageError) => {
        if (isEmailAccessExpiredError(messageError)) {
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
  }, [companyID, currentMessageFilterKey, handleEmailAccessExpired, status?.connected]);
  const loadMoreMessages = useCallback(async () => {
    if (!status?.connected || isInboxMatrixViewID(activeViewIDRef.current) || isCustomMatrixViewID(activeViewIDRef.current) || loadingMessagesRef.current || loadingMoreMessagesRef.current) return;
    const pageToken = nextPageTokenRef.current.trim();
    if (!pageToken) return;
    const filterKey = currentMessageFilterKey();
    const appendedNextPageToken = appendPrefetchedMessagePage(filterKey, pageToken);
    if (appendedNextPageToken !== null) {
      window.setTimeout(() => {
        if (appendedNextPageToken && messageListWithinPrefetchDistance()) void prefetchNextMessagePage(appendedNextPageToken);
      }, 0);
      return;
    }
    setLoadingMoreMessages(true);
    setError("");
    try {
      if (prefetchMessagePromiseRef.current && prefetchMessageFilterKeyRef.current === filterKey && prefetchMessageTokenRef.current === pageToken) {
        await prefetchMessagePromiseRef.current;
        const prefetchedNextPageToken = appendPrefetchedMessagePage(filterKey, pageToken);
        if (prefetchedNextPageToken !== null) {
          window.setTimeout(() => {
            if (prefetchedNextPageToken && messageListWithinPrefetchDistance()) void prefetchNextMessagePage(prefetchedNextPageToken);
          }, 0);
          return;
        }
      }
      const page = await listEmailMessages({
        limit: MESSAGE_BATCH_SIZE,
        pageToken,
        mailbox: mailboxRef.current,
        companyID,
        sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
        q: searchQueryRef.current,
        unread: unreadOnlyRef.current ? true : undefined,
      });
      if (messageListFilterKeyRef.current !== filterKey || nextPageTokenRef.current !== pageToken) return;
      setMessages((previous) => {
        const seen = new Set(previous.map((message) => message.id));
        const next = [...previous];
        for (const message of page.messages ?? []) {
          if (!message.id || seen.has(message.id)) continue;
          seen.add(message.id);
          next.push(message);
        }
        return sortEmailMessagesByDateDescending(next);
      });
      setNextPageToken(page.next_page_token ?? "");
      window.setTimeout(() => {
        const nextToken = page.next_page_token ?? "";
        if (nextToken && messageListWithinPrefetchDistance()) void prefetchNextMessagePage(nextToken);
      }, 0);
    } catch (messageError) {
      if (isEmailAccessExpiredError(messageError)) {
        await handleEmailAccessExpired(messageError);
        return;
      }
      setError(formatError(messageError, "Failed to load messages"));
    } finally {
      setLoadingMoreMessages(false);
    }
  }, [appendPrefetchedMessagePage, companyID, currentMessageFilterKey, handleEmailAccessExpired, messageListWithinPrefetchDistance, prefetchNextMessagePage, status?.connected]);
  useEffect(() => {
    loadMessagesRef.current = loadMessages;
  }, [loadMessages]);
  const scheduleMessageListRefresh = useCallback((delayMs = MESSAGE_EVENT_REFRESH_DELAY_MS) => {
    if (messageListRefreshTimerRef.current !== null) window.clearTimeout(messageListRefreshTimerRef.current);
    messageListRefreshTimerRef.current = window.setTimeout(() => {
      messageListRefreshTimerRef.current = null;
      if (!status?.connected || isInboxMatrixViewID(activeViewIDRef.current) || isCustomMatrixViewID(activeViewIDRef.current)) return;
      void loadMessagesRef.current?.({ refresh: true });
    }, delayMs);
  }, [status?.connected]);
  const fillMessageListAfterRemoval = useCallback(() => {
    window.setTimeout(() => {
      const list = messageListRef.current;
      if (!list || !nextPageTokenRef.current) return;
      if (messageListWithinPrefetchDistance()) void prefetchNextMessagePage();
      if (messageListContentScrollHeight(list) <= list.clientHeight + 160) void loadMoreMessages();
    }, 0);
  }, [loadMoreMessages, messageListWithinPrefetchDistance, prefetchNextMessagePage]);
  const removeMessagesFromVisibleMailList = useCallback((messageIDs: string[], options?: { preserveScrollAnchor?: boolean }) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    const removedIDSet = new Set(ids);
    const list = options?.preserveScrollAnchor ? messageListRef.current : null;
    const scrollAnchor = list ? captureMessageListScrollAnchor(list, removedIDSet) : null;
    setMessages((previous) => previous.filter((message) => !ids.includes(message.id)));
    setSelectedMessageIDs((previous) => {
      const next = new Set(previous);
      for (const id of ids) next.delete(id);
      return next.size === previous.size ? previous : next;
    });
    setSelectionAnchorMessageID((current) => (ids.includes(current) ? "" : current));
    if (ids.includes(selectedMessageIDRef.current)) {
      setSelectedMessageID("");
      setSelectedMessage(null);
    }
    setMessageContextMenu((current) => current && current.messageIDs.some((id) => ids.includes(id)) ? null : current);
    if (list && scrollAnchor) {
      window.requestAnimationFrame(() => {
        restoreMessageListScrollAnchor(list, scrollAnchor);
      });
    }
    fillMessageListAfterRemoval();
  }, [fillMessageListAfterRemoval]);
  const flushQueuedArchiveMessages = useCallback(() => {
    if (archiveBatchFlushTimerRef.current !== null) {
      window.clearTimeout(archiveBatchFlushTimerRef.current);
      archiveBatchFlushTimerRef.current = null;
    }
    const batches = Array.from(queuedArchiveBatchesRef.current.values()).map((batch) => ({
      ...batch,
      messageIDs: cleanIDList(batch.messageIDs),
    })).filter((batch) => batch.messageIDs.length > 0);
    queuedArchiveBatchesRef.current.clear();
    if (batches.length === 0) return;
    void Promise.all(batches.map(async (batch) => {
      const result = await archiveHomeMailMessagesCommand({
        companyID: batch.companyID,
        sharedInboxID: batch.sharedInboxID,
        messageIDs: batch.messageIDs,
      });
      return { batch, result };
    }))
      .then((resultsByBatch) => {
        const failures = resultsByBatch.flatMap((item) => item.result?.failed ?? []);
        for (const item of resultsByBatch) {
          const failedIDs = new Set(cleanIDList((item.result?.failed ?? []).map((failure) => failure.message_id)));
          const archivedIDs = cleanIDList(item.result?.messageIDs ?? item.batch.messageIDs).filter((id) => !failedIDs.has(id));
          adjustPrimaryMailboxCount(`${item.batch.companyID}\x1f${item.batch.sharedInboxID ?? ""}`, -archivedIDs.length);
        }
        if (failures.length > 0) {
          setError(failures.length === 1 ? "Failed to archive 1 message." : `Failed to archive ${failures.length} messages.`);
          scheduleMessageListRefresh(0);
        }
        void loadFolders();
      })
      .catch((archiveError) => {
        if (isEmailAccessExpiredError(archiveError)) {
          void handleEmailAccessExpired(archiveError);
          return;
        }
        setError(formatError(archiveError, "Failed to archive scrolled messages"));
        scheduleMessageListRefresh(0);
      });
  }, [adjustPrimaryMailboxCount, handleEmailAccessExpired, loadFolders, scheduleMessageListRefresh]);
  const queueArchiveMessages = useCallback((messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current) || undefined;
    const key = `${companyID}\x1f${sharedInboxID ?? ""}`;
    const batch = queuedArchiveBatchesRef.current.get(key) ?? { companyID, sharedInboxID, messageIDs: [] };
    const seen = new Set(batch.messageIDs);
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      batch.messageIDs.push(id);
    }
    queuedArchiveBatchesRef.current.set(key, batch);
    const queuedCount = Array.from(queuedArchiveBatchesRef.current.values()).reduce((count, item) => count + item.messageIDs.length, 0);
    if (queuedCount >= ARCHIVE_BATCH_SIZE) {
      flushQueuedArchiveMessages();
      return;
    }
    if (archiveBatchFlushTimerRef.current === null) {
      archiveBatchFlushTimerRef.current = window.setTimeout(flushQueuedArchiveMessages, ARCHIVE_BATCH_FLUSH_DELAY_MS);
    }
  }, [companyID, flushQueuedArchiveMessages]);
  useEffect(() => {
    return () => {
      if (messageListRefreshTimerRef.current !== null) {
        window.clearTimeout(messageListRefreshTimerRef.current);
        messageListRefreshTimerRef.current = null;
      }
    };
  }, []);
  const completePendingAutoArchiveMessage = useCallback((messageID: string) => {
    autoArchiveTimerIDsRef.current.delete(messageID);
    removePendingAutoArchiveMessages([messageID]);
    if (isArchivableHomeViewID(activeViewIDRef.current) && mailboxRef.current === "primary") {
      removeMessagesFromVisibleMailList([messageID], { preserveScrollAnchor: true });
    }
    queueArchiveMessages([messageID]);
  }, [queueArchiveMessages, removeMessagesFromVisibleMailList, removePendingAutoArchiveMessages]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (status?.connected && isArchivableHomeViewID(activeViewID)) void loadFolders(); }, [activeViewID, loadFolders, status?.connected]);
  useEffect(() => { if (status?.connected) void loadSharedInboxes(); }, [loadSharedInboxes, status?.connected]);
  useEffect(() => { if (status?.connected || isInboxMatrixView) void loadCompanyUsers(); }, [isInboxMatrixView, loadCompanyUsers, status?.connected]);
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
  useEffect(() => { void loadMessages(); }, [loadMessages]);
  useEffect(() => {
    setNodeEditorOverlay(null);
  }, [companyID]);
  useEffect(() => {
    const list = messageListRef.current;
    if (!list || !nextPageToken || loadingMessages || loadingMoreMessages) return;
    if (messageListWithinPrefetchDistance()) void prefetchNextMessagePage();
    if (messageListContentScrollHeight(list) <= list.clientHeight + 120) void loadMoreMessages();
  }, [loadMoreMessages, loadingMessages, loadingMoreMessages, messageListWithinPrefetchDistance, messages.length, nextPageToken, prefetchNextMessagePage]);
  useEffect(() => {
    if (!status?.connected) return undefined;
    const connectedAccountEmail = status.connection?.account_email ?? "";
    const currentMessageListParams = () => ({
      limit: MESSAGE_BATCH_SIZE,
      mailbox: mailboxRef.current,
      companyID,
      sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
      q: searchQueryRef.current,
      unread: unreadOnlyRef.current ? true : undefined,
    });
    const scheduleFolderRefresh = () => {
      invalidateCommunicationsFolderCache();
      if (folderReloadTimerRef.current !== null) window.clearTimeout(folderReloadTimerRef.current);
      folderReloadTimerRef.current = window.setTimeout(() => {
        folderReloadTimerRef.current = null;
        void loadFolders();
      }, 300);
    };
    const applyMessageToCurrentView = (message: EmailMessage, prependIfMissing: boolean) => {
      const params = currentMessageListParams();
      applyEmailMessageToCachedPages(message, { prependIfMissing, maxMessages: MESSAGE_BATCH_SIZE });
      setMessages((previous) => mergeEmailMessageIntoMessageList(previous, message, params, {
        prependIfMissing,
        maxMessages: Math.max(MESSAGE_BATCH_SIZE, previous.length + (prependIfMissing ? 1 : 0)),
      }));
      if (selectedMessageIDRef.current === message.id) {
        setSelectedMessage((current) => current?.id === message.id ? {
          ...message,
          local_replies: current.local_replies ?? message.local_replies,
        } : message);
      }
    };
    const unsubscribe = subscribeCommunicationsStream(apiBase, companyID, {
      onEvent(event) {
        if (event.event !== "communications") return;
        let envelope: CommunicationsStreamEnvelope;
        try {
          envelope = JSON.parse(event.data) as CommunicationsStreamEnvelope;
        } catch {
          return;
        }
        const trigger = envelope.trigger?.trim().toLowerCase() ?? "";
        const messageID = envelope.message_id?.trim() ?? "";
        if (trigger.startsWith("triage.")) {
          if (activeViewIDRef.current === "my-triage") void loadMessages();
          return;
        }
        if (trigger.startsWith("folder.")) {
          scheduleFolderRefresh();
          return;
        }
        if (!trigger.startsWith("message.")) return;
        if (!messageID) {
          if (trigger.startsWith("message.created") || trigger.startsWith("message.updated") || trigger.startsWith("message.deleted")) {
            scheduleMessageListRefresh();
          }
          return;
        }
        if (trigger.startsWith("message.deleted")) {
          removeEmailMessageFromCache(messageID);
          setMessages((previous) => previous.filter((message) => message.id !== messageID));
          setSelectedMessageIDs((previous) => {
            if (!previous.has(messageID)) return previous;
            const next = new Set(previous);
            next.delete(messageID);
            return next;
          });
          if (selectedMessageIDRef.current === messageID) {
            setSelectedMessageID("");
            setSelectedMessage(null);
          }
          return;
        }
        invalidateEmailMessageCache(messageID);
        const params = currentMessageListParams();
        const visible = messagesRef.current.some((message) => message.id === messageID);
        const selected = selectedMessageIDRef.current === messageID;
        const shouldFetchCreated = trigger.startsWith("message.created") && emailMessageMatchesListFilters({
          id: messageID,
          subject: "",
          unread: true,
          starred: false,
        }, params);
        if (!visible && !selected && !shouldFetchCreated) return;
        void getEmailMessage(messageID, companyID, sharedInboxIDForHomeView(activeViewIDRef.current))
          .then((message) => {
            primeEmailMessageCache(message);
            reconcileLocalEmailReply(message);
            setSelectedMessage((current) => current ? reconcileEmailMessageLocalReply(current, message) : current);
            const matchesCurrentView = emailMessageMatchesListFilters(message, params);
            applyMessageToCurrentView(message, trigger.startsWith("message.created"));
            if (
              trigger.startsWith("message.created") &&
              mailboxRef.current === "primary" &&
              !matchesCurrentView &&
              messageHasRecipient(message, connectedAccountEmail)
            ) {
              scheduleMessageListRefresh(SELF_SEND_DELIVERY_REFRESH_DELAY_MS);
            }
          })
          .catch((messageError) => {
            if (isEmailAccessExpiredError(messageError)) {
              void handleEmailAccessExpired(messageError);
              return;
            }
            if (trigger.startsWith("message.deleted")) removeEmailMessageFromCache(messageID);
            if (trigger.startsWith("message.created") || trigger.startsWith("message.updated")) scheduleMessageListRefresh();
          });
      },
      onError() {
        // The realtime client reconnects automatically; keep the UI quiet unless an API reload fails.
      },
    });
    return () => {
      unsubscribe();
      if (folderReloadTimerRef.current !== null) {
        window.clearTimeout(folderReloadTimerRef.current);
        folderReloadTimerRef.current = null;
      }
    };
  }, [apiBase, companyID, handleEmailAccessExpired, loadFolders, loadMessages, scheduleMessageListRefresh, status?.connected, status?.connection?.account_email]);
  useEffect(() => {
    if (!companyID || !currentUserID) return undefined;
    const unsubscribe = subscribeWorkspaceRealtime(apiBase, companyID, workspaceRealtimeScope(currentUserID), {
      onGap(gap) {
        if (gap.companyID !== companyID) return;
        const touchesSharedInbox = gap.scopes.some((scope) => (
          scope.eventType === "communications_shared_inbox_raci_updated" || scope.eventType === "shared_triage_access_updated" ||
          (scope.kind === "company_explorer" && (!scope.folderKind || scope.folderKind === "communications")) ||
          scope.kind === "workspace"
        ));
        const touchesWorkspacePanel = gap.scopes.some((scope) => (
          scope.kind === "company_explorer" ||
          (scope.kind === "node_graph" && workspaceEventTouchesHomePanel(scope.eventType)) ||
          (scope.kind === "logic_gate_graph" && workspaceEventTouchesHomePanel(scope.eventType)) ||
          scope.kind === "kanban_board" ||
          scope.kind === "kanban_board_list" ||
          scope.kind === "racio_matrix" ||
          scope.kind === "work_item_assignment" ||
          scope.kind === "workspace"
        ));
        const touchesRacioMatrix = gap.scopes.some((scope) => scope.kind === "racio_matrix" || scope.kind === "workspace");
        if (touchesSharedInbox) void loadSharedInboxes();
        if (touchesWorkspacePanel) scheduleWorkspacePanelReload();
        if (touchesRacioMatrix) requestRacioProjectionRefreshRef.current?.();
      },
      onEvent(event, context) {
        if (event.event !== "workspace") return;
        let envelope: WorkspaceStreamEnvelope;
        try {
          envelope = JSON.parse(event.data) as WorkspaceStreamEnvelope;
        } catch {
          return;
        }
        if (envelope.company_id?.trim() && envelope.company_id.trim() !== companyID) return;
        const type = envelope.type?.trim() ?? "";
        if (!type) return;
        const data: Record<string, unknown> = envelope.data && typeof envelope.data === "object" ? envelope.data : {};
        const scopes = context.scopes ?? [];
        const touchesSharedInbox = scopes.some((scope) => (
          scope.eventType === "communications_shared_inbox_raci_updated" || scope.eventType === "shared_triage_access_updated" ||
          (scope.kind === "company_explorer" && (!scope.folderKind || scope.folderKind === "communications"))
        ));
        const touchesWorkspacePanel = scopes.some((scope) => (
          scope.kind === "company_explorer" ||
          (scope.kind === "node_graph" && workspaceEventTouchesHomePanel(scope.eventType)) ||
          (scope.kind === "logic_gate_graph" && workspaceEventTouchesHomePanel(scope.eventType)) ||
          scope.kind === "kanban_board" ||
          scope.kind === "kanban_board_list" ||
          scope.kind === "racio_matrix" ||
          scope.kind === "work_item_assignment" ||
          scope.kind === "workspace"
        ));
        const touchesRacioMatrix = scopes.some((scope) => scope.kind === "racio_matrix" || scope.kind === "workspace");
        if (touchesSharedInbox) {
          void loadSharedInboxes();
        }
        if (touchesWorkspacePanel) scheduleWorkspacePanelReload();
        if (touchesRacioMatrix) requestRacioProjectionRefreshRef.current?.();
        if (type === "node_created" || type === "node_updated" || type === "node_permissions_updated") {
          const node = data.node && typeof data.node === "object" ? data.node as NodeRecord : null;
          if (node?.node_id) {
            setNodes((previous) => {
              const next = previous.filter((item) => item.node_id !== node.node_id);
              return [...next, node];
            });
            invalidateNodeRecordStoreCaches(apiBase, companyID, node.node_id);
            upsertNodeRelationshipGraphNode(apiBase, companyID, node);
          }
        } else if (type === "node_deleted") {
          const nodeID = typeof data.node_id === "string" ? data.node_id.trim() : "";
          if (nodeID) {
            setNodes((previous) => previous.filter((node) => node.node_id !== nodeID));
            setNodeRelationships((previous) => previous.filter((relationship) => relationship.node_id_a !== nodeID && relationship.node_id_b !== nodeID));
            setNodeFolderItems((previous) => previous.filter((item) => item.item_type !== "node" || item.item_id !== nodeID));
            removeNodeRelationshipGraphNode(apiBase, companyID, nodeID);
          }
        } else if (type === "relationship_created") {
          const relationship = data.relationship && typeof data.relationship === "object" ? data.relationship as NodeRelationship : null;
          if (relationship?.node_relationship_id) {
            setNodeRelationships((previous) => {
              const next = previous.filter((item) => item.node_relationship_id !== relationship.node_relationship_id);
              return [...next, relationship];
            });
          } else {
            void refreshNodeRelationshipsForMatrix();
          }
        } else if (type === "relationship_deleted") {
          const relationshipID = typeof data.node_relationship_id === "string" ? data.node_relationship_id.trim() : "";
          if (relationshipID) {
            setNodeRelationships((previous) => previous.filter((relationship) => relationship.node_relationship_id !== relationshipID));
          } else {
            void refreshNodeRelationshipsForMatrix();
          }
        } else if (type === "logic_gate_created" || type === "logic_gate_updated" || type === "logic_gate_raci_updated" || type === "logic_gate_permissions_updated") {
          const logicGate = data.logic_gate && typeof data.logic_gate === "object" ? data.logic_gate as LogicGateRecord : null;
          if (logicGate?.logic_gate_id) {
            setLogicGates((previous) => {
              const next = previous.filter((item) => item.logic_gate_id !== logicGate.logic_gate_id);
              return [...next, logicGate];
            });
            upsertLogicGateRelationshipGraphNode(apiBase, companyID, toLogicGateCanvasRecord(logicGate));
          }
        } else if (type === "logic_gate_deleted") {
          const logicGateID = typeof data.logic_gate_id === "string" ? data.logic_gate_id.trim() : "";
          if (logicGateID) {
            setLogicGates((previous) => previous.filter((logicGate) => logicGate.logic_gate_id !== logicGateID));
            setLogicGateFolderItems((previous) => previous.filter((item) => item.item_type !== "logic_gate" || item.item_id !== logicGateID));
            removeLogicGateRelationshipGraphNode(apiBase, companyID, logicGateID);
          }
        } else if (type === "company_explorer_folder_item_assigned") {
          const item = data.folder_item && typeof data.folder_item === "object" ? data.folder_item as CompanyExplorerFolderItem : null;
          if (item?.item_type === "node") {
            setNodeFolderItems((previous) => [...previous.filter((candidate) => candidate.item_type !== item.item_type || candidate.item_id !== item.item_id), item]);
          } else if (item?.item_type === "logic_gate") {
            setLogicGateFolderItems((previous) => [...previous.filter((candidate) => candidate.item_type !== item.item_type || candidate.item_id !== item.item_id), item]);
          }
          if (item) {
            upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, item);
            upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase, companyID, item);
          }
        } else if (type === "company_explorer_folder_item_removed") {
          const itemType = typeof data.item_type === "string" ? data.item_type.trim() : "";
          const itemID = typeof data.item_id === "string" ? data.item_id.trim() : "";
          if (itemType === "node" && itemID) setNodeFolderItems((previous) => previous.filter((item) => item.item_type !== itemType || item.item_id !== itemID));
          if (itemType === "logic_gate" && itemID) setLogicGateFolderItems((previous) => previous.filter((item) => item.item_type !== itemType || item.item_id !== itemID));
        } else if (type === "company_explorer_folder_created" || type === "company_explorer_folder_updated") {
          const folder = data.folder && typeof data.folder === "object" ? data.folder as CompanyExplorerFolder : null;
          if (folder?.folder_kind === "node") {
            setNodeFolders((previous) => [...previous.filter((item) => item.folder_id !== folder.folder_id), folder]);
          } else if (folder?.folder_kind === "logic_gate") {
            setLogicGateFolders((previous) => [...previous.filter((item) => item.folder_id !== folder.folder_id), folder]);
          }
        } else if (type === "company_explorer_folder_deleted") {
          const folderID = typeof data.folder_id === "string" ? data.folder_id.trim() : "";
          const folderKind = typeof data.folder_kind === "string" ? data.folder_kind.trim() : "";
          if (folderKind === "node" && folderID) {
            setNodeFolders((previous) => previous.filter((folder) => folder.folder_id !== folderID));
            setNodeFolderItems((previous) => previous.filter((item) => item.folder_id !== folderID));
          } else if (folderKind === "logic_gate" && folderID) {
            setLogicGateFolders((previous) => previous.filter((folder) => folder.folder_id !== folderID));
            setLogicGateFolderItems((previous) => previous.filter((item) => item.folder_id !== folderID));
          }
        }
        if (!touchesWorkspacePanel && scopes.some((scope) => scope.kind === "workspace") && workspaceEventTouchesHomePanel(type)) {
          scheduleWorkspacePanelReload();
        }
        if (type === "node_permissions_updated") {
          void refreshNodeRelationshipsForMatrix();
        }
      },
      onError() {
        // Workspace realtime reconnects automatically; visible errors come from reloads.
      },
    });
    return () => {
      unsubscribe();
      if (workspacePanelReloadTimerRef.current !== null) {
        window.clearTimeout(workspacePanelReloadTimerRef.current);
        workspacePanelReloadTimerRef.current = null;
      }
    };
  }, [apiBase, companyID, currentUserID, isInboxMatrixView, loadSharedInboxes, refreshNodeRelationshipsForMatrix, scheduleWorkspacePanelReload]);
  useEffect(() => {
    if (!selectedMessageID) return;
    let cancelled = false;
    setLoadingDetail(true);
    setError("");
    getEmailMessage(selectedMessageID, companyID, sharedInboxIDForHomeView(activeViewID))
      .then((message) => {
        if (!cancelled) {
          setSelectedMessage((current) => {
            const next = locallyReadMessageIDsRef.current.has(message.id) ? { ...message, unread: false } : message;
            return current?.id === message.id && current.local_replies?.length ? {
              ...next,
              local_replies: current.local_replies,
            } : next;
          });
        }
      })
      .catch((detailError) => {
        if (!cancelled) {
          if (isEmailAccessExpiredError(detailError)) {
            void handleEmailAccessExpired(detailError);
            return;
          }
          setError(formatError(detailError, "Failed to load message"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
    });
    return () => { cancelled = true; };
  }, [activeViewID, companyID, handleEmailAccessExpired, selectedMessageID]);
  const startConnection = async (provider: "google" | "microsoft") => {
    setBusy(provider);
    setError("");
    try {
      const authURL = await fetchCommunicationsAuthURL(provider);
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
  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSearchQuery(searchDraft.trim());
    setNextPageToken("");
  };
  const selectMailbox = useCallback((nextMailbox: EmailMailbox) => {
    setMailbox(nextMailbox);
    setNextPageToken("");
    setSelectedMessageID("");
    setSelectedMessageIDs(new Set());
    setSelectionAnchorMessageID("");
    setSelectedMessage(null);
    setMessageContextMenu(null);
  }, []);
  const selectHomeView = useCallback((viewID: HomeViewID, nextMailbox: EmailMailbox = "primary") => {
    setActiveViewID(viewID);
    selectMailbox(nextMailbox);
  }, [selectMailbox]);
  useEffect(() => {
    if (activeViewID === initialViewID) return;
    selectHomeView(initialViewID, mailboxForHomeView(initialViewID));
  }, [activeViewID, initialViewID, selectHomeView]);
  const currentMessageListParams = useCallback(() => ({
    limit: MESSAGE_BATCH_SIZE,
    mailbox: mailboxRef.current,
    companyID,
    sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
    q: searchQueryRef.current,
    unread: unreadOnlyRef.current ? true : undefined,
  }), [companyID]);
  const applyUpdatedMessageToCurrentView = useCallback((message: EmailMessage) => {
    const params = currentMessageListParams();
    const stillVisible = emailMessageMatchesListFilters(message, params);
    setMessages((previous) => mergeEmailMessageIntoMessageList(previous, message, params));
    if (selectedMessageIDRef.current === message.id) {
      if (stillVisible) {
        setSelectedMessage((current) => (current?.id === message.id ? {
          ...current,
          ...message,
          local_replies: current.local_replies ?? message.local_replies,
        } : message));
      } else {
        setSelectedMessageID("");
        setSelectedMessage(null);
      }
    }
    if (!stillVisible) {
      setSelectedMessageIDs((previous) => {
        if (!previous.has(message.id)) return previous;
        const next = new Set(previous);
        next.delete(message.id);
        return next;
      });
    }
  }, [currentMessageListParams]);
  const patchSelectedMessage = async (update: { unread?: boolean; starred?: boolean; folders?: string[] }) => {
    if (!selectedMessage) return;
    const starredDelta = update.starred !== undefined && update.starred !== selectedMessage.starred
      ? (update.starred ? 1 : -1)
      : 0;
    const countKey = mailCountKey(companyID, activeViewIDRef.current);
    setBusy("message");
    setError("");
    if (starredDelta !== 0) adjustStarredMailboxCount(countKey, starredDelta);
    if (starredDelta !== 0) {
      cancelPendingAutoArchiveMessages([selectedMessage.id]);
      addPendingStarredMessages([selectedMessage.id]);
      applyUpdatedMessageToCurrentView({ ...selectedMessage, starred: update.starred ?? selectedMessage.starred });
    }
    try {
      const commandResult = await updateHomeMailMessageCommand({
        companyID,
        sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
        messageID: selectedMessage.id,
        update,
      });
      if (!commandResult) return;
      const updated = commandResult.message;
      if (update.unread === false) locallyReadMessageIDsRef.current.add(updated.id);
      if (update.unread === true) locallyReadMessageIDsRef.current.delete(updated.id);
      const normalized = {
        ...updated,
        ...(update.unread !== undefined ? { unread: update.unread } : {}),
        ...(update.starred !== undefined ? { starred: update.starred } : {}),
      };
      applyUpdatedMessageToCurrentView(normalized);
      if (starredDelta !== 0) void loadFolders();
    } catch (updateError) {
      if (starredDelta !== 0) adjustStarredMailboxCount(countKey, -starredDelta);
      setError(formatError(updateError, "Failed to update message"));
      if (starredDelta !== 0) {
        cancelPendingStarredMessages([selectedMessage.id]);
        scheduleMessageListRefresh(0);
      }
    } finally {
      if (starredDelta !== 0) removePendingStarredMessages([selectedMessage.id]);
      setBusy("");
    }
  };
  const toggleMessageStar = useCallback((message: EmailMessage) => {
    const messageID = message.id.trim();
    if (!messageID) return;
    const nextStarred = !message.starred;
    const optimistic = { ...message, starred: nextStarred };
    const countKey = mailCountKey(companyID, activeViewIDRef.current);
    const starredDelta = nextStarred ? 1 : -1;
    adjustStarredMailboxCount(countKey, starredDelta);
    cancelPendingAutoArchiveMessages([messageID]);
    addPendingStarredMessages([messageID]);
    applyUpdatedMessageToCurrentView(optimistic);
    void updateHomeMailMessageCommand({
      companyID,
      sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
      messageID,
      update: { starred: nextStarred },
    })
      .then((result) => {
        if (!result) return;
        const updated = { ...result.message, starred: nextStarred };
        applyUpdatedMessageToCurrentView(updated);
        void loadFolders();
      })
      .catch((starError) => {
        adjustStarredMailboxCount(countKey, -starredDelta);
        invalidateEmailMessageCache(messageID);
        if (isEmailAccessExpiredError(starError)) {
          void handleEmailAccessExpired(starError);
          return;
        }
        setError(formatError(starError, "Failed to update message star"));
        cancelPendingStarredMessages([messageID]);
        scheduleMessageListRefresh();
      })
      .finally(() => {
        removePendingStarredMessages([messageID]);
      });
  }, [addPendingStarredMessages, adjustStarredMailboxCount, applyUpdatedMessageToCurrentView, cancelPendingAutoArchiveMessages, cancelPendingStarredMessages, companyID, handleEmailAccessExpired, loadFolders, removePendingStarredMessages, scheduleMessageListRefresh]);
  const archiveMessages = useCallback(async (messageIDs: string[]) => {
    if (!canMutateCurrentMailView) return;
    const ids = cleanIDList(messageIDs);
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    if (ids.length === 0) return;
    const countKey = mailCountKey(companyID, activeViewIDRef.current);
    const currentMailbox = mailboxRef.current;
    const inboxIDSet = new Set(ids.filter((id) => {
      if (currentMailbox === "primary") return true;
      return messagesRef.current.some((message) => message.id === id && messageHasInboxLabel(message));
    }));
    cancelPendingAutoArchiveMessages(ids);
    setBusy("archive");
    setError("");
    setNotice("");
    removeMessagesFromVisibleMailList(ids);
    try {
      const result = await archiveHomeMailMessagesCommand({ companyID, sharedInboxID, messageIDs: ids });
      const archivedIDs = cleanIDList(result?.messageIDs ?? ids);
      const archivedInboxCount = archivedIDs.reduce((count, id) => count + (inboxIDSet.has(id) ? 1 : 0), 0);
      adjustPrimaryMailboxCount(countKey, -archivedInboxCount);
      const failed = result?.failed ?? [];
      setSelectedMessageIDs(new Set());
      setSelectionAnchorMessageID("");
      setMessageContextMenu(null);
      if (failed.length > 0) {
        setError(failed.length === 1 ? "Failed to archive 1 message." : `Failed to archive ${failed.length} messages.`);
        scheduleMessageListRefresh(0);
      } else {
        setNotice(ids.length === 1 ? "Message archived." : `${ids.length} messages archived.`);
      }
      await loadFolders();
    } catch (archiveError) {
      setError(formatError(archiveError, ids.length === 1 ? "Failed to archive message" : "Failed to archive messages"));
      scheduleMessageListRefresh(0);
    } finally {
      setBusy("");
    }
  }, [adjustPrimaryMailboxCount, canMutateCurrentMailView, cancelPendingAutoArchiveMessages, companyID, loadFolders, removeMessagesFromVisibleMailList, scheduleMessageListRefresh]);
  const unarchiveMessages = useCallback(async (messageIDs: string[]) => {
    if (!canMutateCurrentMailView) return;
    const ids = cleanIDList(messageIDs);
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    if (ids.length === 0) return;
    const countKey = mailCountKey(companyID, activeViewIDRef.current);
    cancelPendingAutoArchiveMessages(ids);
    setBusy("unarchive");
    setError("");
    setNotice("");
    try {
      await unarchiveHomeMailMessagesCommand({ companyID, sharedInboxID, messageIDs: ids });
      adjustPrimaryMailboxCount(countKey, ids.length);
      removeMessagesFromVisibleMailList(ids);
      if (selectedMessageID && ids.includes(selectedMessageID)) {
        setSelectedMessageID("");
        setSelectedMessage(null);
      }
      setSelectedMessageIDs(new Set());
      setSelectionAnchorMessageID("");
      setMessageContextMenu(null);
      setNotice(ids.length === 1 ? "Message moved to Inbox." : `${ids.length} messages moved to Inbox.`);
      await loadFolders();
    } catch (unarchiveError) {
      setError(formatError(unarchiveError, ids.length === 1 ? "Failed to unarchive message" : "Failed to unarchive messages"));
    } finally {
      setBusy("");
    }
  }, [adjustPrimaryMailboxCount, canMutateCurrentMailView, cancelPendingAutoArchiveMessages, companyID, loadFolders, removeMessagesFromVisibleMailList, selectedMessageID]);
  const autoArchiveScrolledMessages = useCallback((messageIDs: string[]) => {
    if (!canMutateCurrentMailView || !status?.connected || !isArchivableHomeViewID(activeViewIDRef.current) || mailboxRef.current !== "primary") return;
    const ids = cleanIDList(messageIDs).filter((id) => !pendingAutoArchiveMessageIDsRef.current.has(id) && !autoArchiveTimerIDsRef.current.has(id));
    if (ids.length === 0) return;
    addPendingAutoArchiveMessages(ids);
    for (const id of ids) {
      const timerID = window.setTimeout(() => {
        completePendingAutoArchiveMessage(id);
      }, AUTO_ARCHIVE_SCROLL_DELAY_MS);
      autoArchiveTimerIDsRef.current.set(id, timerID);
    }
  }, [addPendingAutoArchiveMessages, canMutateCurrentMailView, completePendingAutoArchiveMessage, status?.connected]);
  const archiveSelected = async () => {
    if (!selectedMessage || !canMutateCurrentMailView) return;
    if (mailboxRef.current === "archive") await unarchiveMessages([selectedMessage.id]);
    else await archiveMessages([selectedMessage.id]);
  };
  const openPendingMailbox = useCallback(() => {
    setCompose(emptyCompose);
    selectMailbox("primary");
  }, [selectMailbox]);
  const openStarredMailbox = useCallback(() => {
    setCompose(emptyCompose);
    selectMailbox("starred");
  }, [selectMailbox]);
  const openSentMailbox = useCallback(() => {
    setCompose(emptyCompose);
    selectMailbox("sent");
  }, [selectMailbox]);
  const openArchivedMailbox = useCallback(() => {
    setCompose(emptyCompose);
    selectMailbox("archive");
  }, [selectMailbox]);
  const openAllMailbox = useCallback(() => {
    setCompose(emptyCompose);
    selectMailbox("all");
  }, [selectMailbox]);
  const currentMailComposeError = () => {
    if (activeViewID === "shared-root") return "Select a Shared Triage inbox before composing.";
    if (!canMutateCurrentMailView) return "You need edit access to compose from this inbox.";
    return "";
  };
  const openNewCompose = () => {
    const composeError = currentMailComposeError();
    if (composeError) {
      setError(composeError);
      return;
    }
    setCompose({ ...emptyCompose, open: true });
  };
  const openReply = () => {
    if (!selectedMessage) return;
    const composeError = currentMailComposeError();
    if (composeError) {
      setError(composeError);
      return;
    }
    setCompose({
      open: true,
      replyToMessageID: selectedMessage.id,
      to: formatAddressList(selectedMessage.from),
      cc: "",
      bcc: "",
      subject: selectedMessage.subject?.toLowerCase().startsWith("re:") ? selectedMessage.subject : `Re: ${selectedMessage.subject || ""}`.trim(),
      body: "",
    });
  };
  const submitCompose = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("send");
    setError("");
    try {
      const composeError = currentMailComposeError();
      if (composeError) {
        setError(composeError);
        return;
      }
      const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
      const currentSharedInbox = sharedInboxID ? sharedInboxes.find((folder) => folder.folder_id === sharedInboxID) ?? null : null;
      const connectedAccountEmail = (currentSharedInbox?.account_email ?? connection?.account_email ?? "").trim();
      const submittedCompose = compose;
      const result = await sendHomeMailComposeCommand({ companyID, sharedInboxID, compose, connectedAccountEmail });
      setCompose(emptyCompose);
      setNotice("Message sent.");
      const replyToMessageID = submittedCompose.replyToMessageID.trim();
      if (replyToMessageID) {
        setSelectedMessage((current) => current?.id === replyToMessageID ? addLocalReplyToEmailMessage(current, result.sentMessage) : current);
      }
      const sentParams = currentMessageListParams();
      if (emailMessageMatchesListFilters(result.sentMessage, sentParams)) {
        setMessages((previous) => mergeEmailMessageIntoMessageList(previous, result.sentMessage, sentParams, {
          prependIfMissing: true,
          maxMessages: Math.max(MESSAGE_BATCH_SIZE, previous.length + 1),
        }));
      }
      if (result.sentToConnectedAccount && mailboxRef.current === "primary") {
        scheduleMessageListRefresh(SELF_SEND_DELIVERY_REFRESH_DELAY_MS);
      }
    } catch (sendError) {
      setError(formatError(sendError, "Failed to send message"));
    } finally {
      setBusy("");
    }
  };
  const createSharedInboxFolder = useCallback(async (parentFolderID: string, rawName = "New Folder", accountEmail = ""): Promise<CommunicationsSharedInbox | null> => {
    setBusy("shared-inbox");
    setError("");
    setNotice("");
    try {
      const result = await createSharedInboxCommand({ companyID, parentFolderID, rawName, accountEmail });
      if (!result) return null;
      const folder = result.folder;
      setSharedInboxes((previous) => sortSharedInboxes([
        ...previous.filter((item) => item.folder_id !== folder.folder_id),
        folder,
      ]));
      setActiveViewID(result.viewID ?? `shared:${folder.folder_id}`);
      selectMailbox("primary");
      return folder;
    } catch (sharedInboxError) {
      if (await offerNylasConnectionForSharedInboxEmail(sharedInboxError, accountEmail)) return null;
      setError(formatError(sharedInboxError, "Failed to create Shared Triage"));
      return null;
    } finally {
      setBusy("");
    }
  }, [companyID, selectMailbox]);

  const setSharedInboxAccountEmail = useCallback(async (folderID: string, accountEmail: string): Promise<void> => {
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
    } catch (sharedInboxError) {
      if (await offerNylasConnectionForSharedInboxEmail(sharedInboxError, accountEmail)) return;
      setError(formatError(sharedInboxError, "Failed to update Shared Triage email"));
    } finally {
      setBusy("");
    }
  }, [companyID, sharedInboxes]);

  const assignActiveSharedInboxEmail = useCallback(() => {
    if (!activeSharedInbox) return;
    if (activeSharedInboxIsParent) {
      setError("Parent folders cannot have emails assigned.");
      return;
    }
    const initialEmail = (activeSharedInbox.account_email ?? connection?.account_email ?? "").trim().toLowerCase();
    const rawEmail = window.prompt("Email for shared inbox", initialEmail);
    if (rawEmail === null) return;
    const accountEmail = rawEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    void setSharedInboxAccountEmail(activeSharedInbox.folder_id, accountEmail);
  }, [activeSharedInbox, activeSharedInboxIsParent, connection?.account_email, setSharedInboxAccountEmail]);
  const renameSharedInboxFolder = useCallback(async (folderID: string, name: string): Promise<void> => {
    setBusy("shared-inbox");
    setError("");
    setNotice("");
    try {
      const result = await renameSharedInboxCommand({ companyID, folderID, name });
      if (!result) return;
      const folder = result.folder;
      setSharedInboxes((previous) => sortSharedInboxes(previous.map((item) => item.folder_id === folder.folder_id ? folder : item)));
    } catch (sharedInboxError) {
      setError(formatError(sharedInboxError, "Failed to rename Shared Triage folder"));
    } finally {
      setBusy("");
    }
  }, [companyID]);

  const moveSharedInboxFolder = useCallback(async (folderID: string, parentFolderID: string, position: number): Promise<void> => {
    setBusy("shared-inbox");
    setError("");
    setNotice("");
    try {
      const result = await moveSharedInboxCommand({ companyID, folderID, parentFolderID, position });
      if (!result) return;
      const folder = result.folder;
      setSharedInboxes((previous) => sortSharedInboxes(previous.map((item) => item.folder_id === folder.folder_id ? folder : item)));
    } catch (sharedInboxError) {
      setError(formatError(sharedInboxError, "Failed to move Shared Triage folder"));
    } finally {
      setBusy("");
    }
  }, [companyID]);

  const deleteSharedInboxFolder = useCallback(async (folderID: string): Promise<void> => {
    setBusy("shared-inbox");
    setError("");
    setNotice("");
    try {
      const result = await deleteSharedInboxCommand({ companyID, folderID, sharedInboxes });
      if (!result) return;
      const deletedIDs = new Set(result.deletedFolderIDs);
      setSharedInboxes((previous) => previous.filter((folder) => !deletedIDs.has(folder.folder_id)));
      const currentView = activeViewIDRef.current;
      const activeFolderID = currentView.startsWith("shared:") ? currentView.slice("shared:".length) : "";
      if (activeFolderID && deletedIDs.has(activeFolderID)) setActiveViewID("shared-root");
    } catch (sharedInboxError) {
      setError(formatError(sharedInboxError, "Failed to delete Shared Triage folder"));
    } finally {
      setBusy("");
    }
  }, [companyID, sharedInboxes]);

  const currentDirectSharedInboxRaciAssignments = useCallback((folderID: string): Array<{ role: CommunicationsSharedInboxRaciRole; subject_type: CommunicationsSharedInboxRaciSubjectType; subject_id: string }> => {
    const cleanFolderID = folderID.trim();
    const folder = sharedInboxes.find((item) => item.folder_id === cleanFolderID);
    return (folder?.raci_assignments ?? [])
      .filter((assignment) => assignment.folder_id === cleanFolderID)
      .map((assignment) => {
        const subjectType = (assignment.subject_type?.trim() || "user") as CommunicationsSharedInboxRaciSubjectType;
        const subjectID = assignment.subject_id?.trim() || assignment.user_id.trim();
        return { role: assignment.role, subject_type: subjectType, subject_id: subjectID };
      })
      .filter((assignment) => assignment.subject_id);
  }, [sharedInboxes]);

  const saveSharedInboxRaciAssignments = useCallback(async (
    folderID: string,
    assignments: Array<{ role: CommunicationsSharedInboxRaciRole; subject_type: CommunicationsSharedInboxRaciSubjectType; subject_id: string }>,
  ): Promise<void> => {
    const cleanFolderID = folderID.trim();
    if (!cleanFolderID) return;
    setBusy("shared-inbox-raci");
    setError("");
    setNotice("");
    try {
      const nextAssignments = await updateCommunicationsSharedInboxRaciAssignments(companyID, cleanFolderID, assignments);
      setSharedInboxes((previous) => previous.map((folder) => (
        folder.folder_id === cleanFolderID ? { ...folder, raci_assignments: nextAssignments } : folder
      )));
      await loadSharedInboxes();
    } catch (raciError) {
      setError(formatError(raciError, "Failed to update Shared Triage RACI"));
    } finally {
      setBusy("");
    }
  }, [companyID, loadSharedInboxes]);

  const addSharedInboxRaciSubject = useCallback((
    folderID: string,
    role: CommunicationsSharedInboxRaciRole,
    subjectType: CommunicationsSharedInboxRaciSubjectType,
    subjectID: string,
  ) => {
    const cleanSubjectID = subjectID.trim();
    if (!cleanSubjectID) return;
    const direct = currentDirectSharedInboxRaciAssignments(folderID);
    if (direct.some((assignment) => assignment.role === role && assignment.subject_type === subjectType && assignment.subject_id === cleanSubjectID)) return;
    void saveSharedInboxRaciAssignments(folderID, [...direct, { role, subject_type: subjectType, subject_id: cleanSubjectID }]);
  }, [currentDirectSharedInboxRaciAssignments, saveSharedInboxRaciAssignments]);

  const removeSharedInboxRaciSubject = useCallback((
    folderID: string,
    role: CommunicationsSharedInboxRaciRole,
    subjectType: CommunicationsSharedInboxRaciSubjectType,
    subjectID: string,
  ) => {
    const cleanSubjectID = subjectID.trim();
    if (!cleanSubjectID) return;
    const direct = currentDirectSharedInboxRaciAssignments(folderID);
    void saveSharedInboxRaciAssignments(folderID, direct.filter((assignment) => (
      assignment.role !== role || assignment.subject_type !== subjectType || assignment.subject_id !== cleanSubjectID
    )));
  }, [currentDirectSharedInboxRaciAssignments, saveSharedInboxRaciAssignments]);

  const submitSharedInbox = async (event: React.FormEvent) => {
    event.preventDefault();
    const parentFolderID = activeViewID.startsWith("shared:") ? activeViewID.slice("shared:".length) : "";
    const folder = await createSharedInboxFolder(parentFolderID, newSharedInboxName);
    if (folder) setNewSharedInboxName("");
  };
  const nodeByID = useMemo(() => new Map(nodes.map((node) => [node.node_id, node])), [nodes]);
  const allNodeRows = useMemo(() => buildCompanyExplorerTreeRows({
    expanded: nodeExpandedIDs,
    nodes,
    logicGates: [],
    kanbanBoards: [],
    folders: nodeFolders,
    folderItems: nodeFolderItems,
    rootRowOrder: {},
  }).filter((row) => row.kind === "folder" || row.kind === "node"), [nodeExpandedIDs, nodeFolderItems, nodeFolders, nodes]);
  const visibleNodeRows = useMemo(() => filterExplorerRowsForSearch(allNodeRows, nodeSearch), [allNodeRows, nodeSearch]);
  const logicGateByID = useMemo(() => new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate])), [logicGates]);
  const logicGateByIDRef = useRef(logicGateByID);
  logicGateByIDRef.current = logicGateByID;
  const activeRaciInboxSection = raciInboxSectionForView(activeViewID);
  const workspacePanelUserID = isInboxMatrixView ? activeRacioMatrixUserID : currentUserID;
  useEffect(() => {
    if (!companyID || nodes.length === 0) return undefined;
    const missingIDs = missingLogicGateRecordIDs(nodes, logicGateByID);
    if (missingIDs.length === 0) return undefined;
    let cancelled = false;
    void Promise.all(missingIDs.map(async (logicGateID) => {
      try {
        const details = await getLogicGateRecordSingleFlight(apiBase, companyID, logicGateID);
        return details.logic_gate;
      } catch {
        return null;
      }
    })).then((records) => {
      if (cancelled) return;
      const fetched = records.filter((record): record is LogicGateRecord => Boolean(record));
      if (fetched.length === 0) return;
      setLogicGates((previous) => {
        const byID = new Map(previous.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
        let changed = false;
        for (const logicGate of fetched) {
          const current = byID.get(logicGate.logic_gate_id);
          if (current?.header === logicGate.header && current?.raci_assignments === logicGate.raci_assignments) continue;
          byID.set(logicGate.logic_gate_id, logicGate);
          changed = true;
        }
        return changed ? Array.from(byID.values()) : previous;
      });
    });
    return () => { cancelled = true; };
  }, [apiBase, companyID, logicGateByID, nodes]);
  const myNodes = useMemo(() => {
    if (!workspacePanelUserID) return [];
    return nodes.filter((node) => node.assignee_user_id?.trim() === workspacePanelUserID);
  }, [nodes, workspacePanelUserID]);
  const assignedMyLogicGates = useMemo(() => {
    if (!workspacePanelUserID) return [];
    return logicGates.filter((logicGate) => logicGateHasAnyRaciRole(logicGate, workspacePanelUserID));
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
  const activeRaciRoleLogicGates = useMemo(() => {
    const role = activeRaciInboxSection?.role;
    if (!workspacePanelUserID || !role || role === "other") return [];
    return logicGates.filter((logicGate) => logicGateHasRaciRole(logicGate, role, workspacePanelUserID));
  }, [activeRaciInboxSection?.role, logicGates, workspacePanelUserID]);
  const activeRaciRoleLogicGateGroups = useMemo(() => buildMyLogicGateGroups({
    shortcuts: [],
    assignedLogicGates: activeRaciRoleLogicGates,
    logicGateByID,
    folders: logicGateFolders,
    folderItems: logicGateFolderItems,
  }), [activeRaciRoleLogicGates, logicGateByID, logicGateFolderItems, logicGateFolders]);
  const racioDirectoryUsers = useMemo(() => {
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
  const racioMatrixViewerSelector = (
    <RacioMatrixViewerSelector
      companyUsers={racioDirectoryUsers}
      groups={companyUserGroups}
      groupMembers={companyUserGroupMembers}
      currentUserID={currentUserID}
      selectedUserID={activeRacioMatrixUserID}
      entries={racioViewerListEntries}
      onEntriesChange={updateRacioViewerListEntries}
      onSelectUser={setRacioMatrixTargetUserID}
    />
  );
  const markMessageReadFromListSelection = useCallback((message: EmailMessage) => {
    const messageID = message.id.trim();
    if (!messageID || !message.unread) return;
    if (!isArchivableHomeViewID(activeViewIDRef.current) || mailboxRef.current !== "primary") return;
    locallyReadMessageIDsRef.current.add(messageID);
    const optimistic = { ...message, unread: false };
    const listParams = () => ({
      limit: MESSAGE_BATCH_SIZE,
      mailbox: mailboxRef.current,
      companyID,
      sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
      q: searchQueryRef.current,
      unread: unreadOnlyRef.current ? true : undefined,
    });
    setMessages((previous) => mergeEmailMessageIntoMessageList(previous, optimistic, listParams()));
    setSelectedMessage((current) => (current?.id === messageID ? { ...current, unread: false } : current));
    void updateHomeMailMessageCommand({
      companyID,
      sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
      messageID,
      update: { unread: false },
    })
      .then((result) => {
        if (!result) return;
        const readUpdated = { ...result.message, unread: false };
        setMessages((previous) => mergeEmailMessageIntoMessageList(previous, readUpdated, listParams()));
        if (selectedMessageIDRef.current === messageID) {
          setSelectedMessage((current) => (current?.id === messageID ? {
            ...current,
            ...readUpdated,
            local_replies: current.local_replies ?? readUpdated.local_replies,
          } : readUpdated));
        }
      })
      .catch((markError) => {
        locallyReadMessageIDsRef.current.delete(messageID);
        invalidateEmailMessageCache(messageID);
        if (isEmailAccessExpiredError(markError)) {
          void handleEmailAccessExpired(markError);
          return;
        }
        setError(formatError(markError, "Failed to mark message read"));
        scheduleMessageListRefresh();
      });
  }, [companyID, handleEmailAccessExpired, scheduleMessageListRefresh]);
  const selectMessageRow = useCallback((message: EmailMessage, modifiers: MessageSelectionModifiers) => {
    activeDeleteSelectionKindRef.current = "message";
    const orderedIDs = messages.map((item) => item.id);
    const next = resolveExplorerClickSelection({
      orderedIDs,
      previousSelectedIDs: selectedMessageIDs,
      anchorID: selectionAnchorMessageID,
      clickedID: message.id,
      shiftKey: modifiers.shiftKey,
      ctrlKey: modifiers.ctrlKey || modifiers.metaKey,
    });
    if (next.selectedIDs.size === 0) next.selectedIDs.add(message.id);
    const orderedSelectedIDs = orderedIDs.filter((id) => next.selectedIDs.has(id));
    const primaryID = next.selectedIDs.has(message.id) ? message.id : (orderedSelectedIDs[0] ?? message.id);
    const primaryMessage = messages.find((item) => item.id === primaryID) ?? message;
    setSelectedMessageIDs(new Set(orderedSelectedIDs));
    setSelectionAnchorMessageID(next.anchorID);
    setSelectedMessageID(primaryID);
    setMessageContextMenu(null);
    markMessageReadFromListSelection(primaryMessage);
  }, [markMessageReadFromListSelection, messages, selectedMessageIDs, selectionAnchorMessageID]);
  const openMessageContextMenu = useCallback((message: EmailMessage, event: React.MouseEvent) => {
    event.preventDefault();
    activeDeleteSelectionKindRef.current = "message";
    const nextIDs = selectedMessageIDs.has(message.id) ? Array.from(selectedMessageIDs) : [message.id];
    setSelectedMessageIDs(new Set(nextIDs));
    setSelectionAnchorMessageID(message.id);
    setSelectedMessageID(message.id);
    setMessageContextMenu({ x: event.clientX, y: event.clientY, messageIDs: nextIDs });
  }, [selectedMessageIDs]);
  const startMessageDrag = useCallback((message: EmailMessage, event: React.DragEvent<HTMLElement>) => {
    const triageView = activeViewID === "my-triage" || activeViewID === "shared-root" || activeViewID.startsWith("shared:");
    if (!triageView || !canDragTriageMessageFromMailbox(mailboxRef.current)) return;
    const messageIDs = selectedMessageIDs.has(message.id) ? Array.from(selectedMessageIDs) : [message.id];
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(TRIAGE_MESSAGE_DRAG_MIME, JSON.stringify({ kind: "triage_messages", message_ids: messageIDs }));
    event.dataTransfer.setData("text/plain", messageIDs.join(","));
  }, [activeViewID, selectedMessageIDs]);
  const getSelectedMessageIDsForAction = useCallback((): string[] => {
    const visibleIDs = new Set(messages.map((message) => message.id));
    const ids = Array.from(selectedMessageIDs).filter((id) => visibleIDs.has(id));
    if (selectedMessageID && visibleIDs.has(selectedMessageID) && !ids.includes(selectedMessageID)) {
      ids.unshift(selectedMessageID);
    }
    return cleanIDList(ids);
  }, [messages, selectedMessageID, selectedMessageIDs]);
  const requestDeleteMessages = useCallback((messageIDs: string[]) => {
    if (!canMutateCurrentMailView) return;
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    setMessageContextMenu(null);
    setDeleteConfirmation({ messageIDs: ids });
  }, [canMutateCurrentMailView]);
  const requestDeleteSelection = useCallback(() => {
    requestDeleteMessages(getSelectedMessageIDsForAction());
  }, [getSelectedMessageIDsForAction, requestDeleteMessages]);
  const deleteSelected = useCallback(() => {
    if (!selectedMessage) return;
    requestDeleteSelection();
  }, [requestDeleteSelection, selectedMessage]);
  const deleteMessages = useCallback(async (messageIDs: string[]) => {
    if (!canMutateCurrentMailView) return;
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    const countKey = mailCountKey(companyID, activeViewIDRef.current);
    const currentMailbox = mailboxRef.current;
    const deletedInboxCount = ids.reduce((count, id) => {
      if (currentMailbox === "primary") return count + 1;
      return count + (messagesRef.current.some((message) => message.id === id && messageHasInboxLabel(message)) ? 1 : 0);
    }, 0);
    cancelPendingAutoArchiveMessages(ids);
    setBusy("delete");
    setError("");
    try {
      const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
      await deleteHomeMailMessagesCommand({ companyID, sharedInboxID, messageIDs: ids });
      adjustPrimaryMailboxCount(countKey, -deletedInboxCount);
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
      setError(formatError(deleteError, ids.length === 1 ? "Failed to delete message" : "Failed to delete messages"));
    } finally {
      setBusy("");
    }
  }, [adjustPrimaryMailboxCount, canMutateCurrentMailView, cancelPendingAutoArchiveMessages, companyID, removeMessagesFromVisibleMailList, selectedMessageID]);
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
    setBusy("triage-convert");
    setError("");
    try {
      const conversion = await convertMessagesToLogicGateCommand({
        apiBase,
        companyID,
        logicGateID,
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
      setMessages((previous) => previous.map((message) => converted.includes(message.id) ? markMessageSentToLogicGate(message, logicGateID) : message));
      setSelectedMessage((current) => current && converted.includes(current.id) ? markMessageSentToLogicGate(current, logicGateID) : current);
      const title = logicGateByID.get(logicGateID)?.header || "Logic Gate";
      showNoticeWithResourceAction(converted.length === 1 ? `Sent to ${title}.` : `${converted.length} messages sent to ${title}.`, { kind: "logic_gate", logicGateID });
    } catch (convertError) {
      setError(formatError(convertError, "Failed to send messages to Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, logicGateByID, showNoticeWithResourceAction]);
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
  const openNodeEditorOverlay = useCallback((node: NodeRecord, informationID?: string) => {
    const nodeID = node.node_id.trim();
    if (!nodeID) return;
    const cleanInformationID = informationID?.trim() ?? "";
    setNodeEditorOverlay({
      nodeID,
      nodeTitle: nodeTitle(node),
      focusInformationID: cleanInformationID || undefined,
      focusRequestID: cleanInformationID ? Date.now() : undefined,
    });
    onNodeOverlayOpen?.(nodeID);
  }, [onNodeOverlayOpen]);

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

  const openLogicGateArena = useCallback((logicGateID: string, label: string, nodeID?: string, informationID?: string) => {
    const cleanLogicGateID = logicGateID.trim();
    if (!cleanLogicGateID) return;
    const cleanNodeID = nodeID?.trim() ?? "";
    const cleanInformationID = informationID?.trim() ?? "";
    const suppressLegacyWorkspaceStream = isInboxMatrixView && !!cleanNodeID;
    writePendingLogicGateArenaSelection({
      companyID,
      logicGateID: cleanLogicGateID,
      label,
      nodeID: cleanNodeID || undefined,
      informationID: cleanInformationID || undefined,
      suppressLegacyWorkspaceStream,
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
      suppressLegacyWorkspaceStream,
      changedAt: Date.now(),
    });
    preloadLogicGateArenaSurface();
    const targetPath = buildLogicGateRoute(cleanLogicGateID, cleanNodeID || undefined);
    if (onNavigate) onNavigate(targetPath);
    else window.location.assign(targetPath);
  }, [companyID, isInboxMatrixView, onNavigate]);
  const getLogicGateDragIDs = useCallback((logicGateID: string): string[] => {
    const cleanLogicGateID = logicGateID.trim();
    if (!cleanLogicGateID) return [];
    if (!selectedLogicGateRowIDs.has(logicGateTreeID(cleanLogicGateID))) return [cleanLogicGateID];
    const selectedLogicGateIDs = cleanIDList(Array.from(selectedLogicGateRowIDs).map(logicGateIDFromTreeID))
      .filter((id) => logicGateByID.has(id));
    return selectedLogicGateIDs.length > 0 ? selectedLogicGateIDs : [cleanLogicGateID];
  }, [logicGateByID, selectedLogicGateRowIDs]);
  const mergeUpdatedNode = useCallback((node: NodeRecord) => {
    setNodes((previous) => {
      let found = false;
      const next = previous.map((item) => {
        if (item.node_id !== node.node_id) return item;
        found = true;
        return node;
      });
      return found ? next : [...next, node];
    });
    invalidateNodeRecordStoreCaches(apiBase, companyID, node.node_id);
    upsertNodeRelationshipGraphNode(apiBase, companyID, node);
  }, [apiBase, companyID]);
  const applyRacioProjectionRows = useCallback((rows: RacioMatrixProjectionRow[], options: {
    mode?: "merge" | "replace";
    logicGates?: LogicGateRecord[];
  } = {}) => {
    if (!companyID || !activeRacioMatrixUserID) return;
    const mode = options.mode ?? "merge";
    const cleanRows = rows.filter((row) => (
      row.company_id?.trim() === companyID &&
      row.user_id?.trim() === activeRacioMatrixUserID &&
      (row.resource_type === "node" || row.resource_type === "logic_gate") &&
      row.resource_id?.trim()
    ));
    if (cleanRows.length === 0 && mode !== "replace") return;
    if (mode === "replace") {
      racioProjectionRowsRef.current = cleanRows;
    } else {
      const byKey = new Map(racioProjectionRowsRef.current.map((row) => [`${row.resource_type}\u0000${row.resource_id}`, row]));
      for (const row of cleanRows) byKey.set(`${row.resource_type}\u0000${row.resource_id}`, row);
      racioProjectionRowsRef.current = Array.from(byKey.values());
    }
    const projectedLogicGateByID = new Map((options.logicGates ?? []).map((logicGate) => [logicGate.logic_gate_id, logicGate]));
    const nodeRows = cleanRows.filter((row) => row.resource_type === "node");
    const logicGateRows = cleanRows.filter((row) => row.resource_type === "logic_gate");
    const nextProjectedNodeIDs = new Set(nodeRows.map((row) => row.resource_id.trim()).filter(Boolean));
    const nextProjectedLogicGateIDs = new Set(logicGateRows.map((row) => row.resource_id.trim()).filter(Boolean));

    setNodes((previous) => {
      const byID = new Map(previous.map((node) => [node.node_id, node]));
      const removeIDs = mode === "replace"
        ? racioProjectionInitializedRef.current
          ? racioProjectedNodeIDsRef.current
          : new Set(previous
            .filter((node) => (
              node.assignee_user_id?.trim() === activeRacioMatrixUserID ||
              cleanIDList(node.logic_gate_ids ?? []).some((logicGateID) => logicGateHasAnyRaciRole(logicGateByIDRef.current.get(logicGateID), activeRacioMatrixUserID))
            ))
            .map((node) => node.node_id))
        : new Set<string>();
      for (const nodeID of removeIDs) {
        if (!nextProjectedNodeIDs.has(nodeID)) byID.delete(nodeID);
      }
      for (const row of nodeRows) {
        const nodeID = row.resource_id.trim();
        const previousNode = byID.get(nodeID);
        byID.set(nodeID, {
          ...previousNode,
          company_id: row.company_id,
          node_id: nodeID,
          title: row.display_title || previousNode?.title || "Untitled node",
          status: row.status ?? null,
          status_color: row.status_color ?? null,
          due_date: row.due_date ?? null,
          priority: row.priority ?? null,
          assignee_user_id: row.assignee_user_id ?? null,
          assignee_name: row.assignee_display_name ?? null,
          assignee_email: row.assignee_email ?? null,
          logic_gate_ids: row.logic_gate_id?.trim() ? [row.logic_gate_id.trim()] : [],
          created_timestamp: row.resource_created_timestamp || previousNode?.created_timestamp || new Date().toISOString(),
          effective_access_level: previousNode?.effective_access_level ?? "edit",
          can_view: previousNode?.can_view ?? true,
          can_edit: previousNode?.can_edit ?? true,
          can_admin: previousNode?.can_admin ?? false,
        });
        invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
      }
      return Array.from(byID.values());
    });

    setLogicGates((previous) => {
      const byID = new Map(previous.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
      const removeIDs = mode === "replace"
        ? racioProjectionInitializedRef.current
          ? racioProjectedLogicGateIDsRef.current
          : new Set(previous
            .filter((logicGate) => logicGateHasAnyRaciRole(logicGate, activeRacioMatrixUserID))
            .map((logicGate) => logicGate.logic_gate_id))
        : new Set<string>();
      for (const logicGateID of removeIDs) {
        if (!nextProjectedLogicGateIDs.has(logicGateID)) byID.delete(logicGateID);
      }
      for (const row of logicGateRows) {
        const logicGateID = row.resource_id.trim();
        const previousLogicGate = byID.get(logicGateID);
        const projectedLogicGate = projectedLogicGateByID.get(logicGateID);
        byID.set(logicGateID, {
          ...previousLogicGate,
          ...projectedLogicGate,
          company_id: row.company_id,
          logic_gate_id: logicGateID,
          header: row.display_title || projectedLogicGate?.header || previousLogicGate?.header || "Untitled Logic Gate",
          created_timestamp: row.resource_created_timestamp || projectedLogicGate?.created_timestamp || previousLogicGate?.created_timestamp || new Date().toISOString(),
          raci_assignments: projectedLogicGate?.raci_assignments ?? previousLogicGate?.raci_assignments ?? [],
          effective_access_level: projectedLogicGate?.effective_access_level ?? previousLogicGate?.effective_access_level ?? "edit",
          can_view: projectedLogicGate?.can_view ?? previousLogicGate?.can_view ?? true,
          can_edit: projectedLogicGate?.can_edit ?? previousLogicGate?.can_edit ?? true,
          can_admin: projectedLogicGate?.can_admin ?? previousLogicGate?.can_admin ?? false,
        });
        upsertLogicGateRelationshipGraphNode(apiBase, companyID, toLogicGateCanvasRecord(byID.get(logicGateID)!));
      }
      return Array.from(byID.values());
    });

    if (mode === "replace") {
      racioProjectionInitializedRef.current = true;
      racioProjectedNodeIDsRef.current = nextProjectedNodeIDs;
      racioProjectedLogicGateIDsRef.current = nextProjectedLogicGateIDs;
    } else {
      for (const nodeID of nextProjectedNodeIDs) racioProjectedNodeIDsRef.current.add(nodeID);
      for (const logicGateID of nextProjectedLogicGateIDs) racioProjectedLogicGateIDsRef.current.add(logicGateID);
    }
  }, [activeRacioMatrixUserID, apiBase, companyID]);
  const refreshRacioMatrixProjection = useCallback(async (minimumSequence = 0) => {
    if (!companyID || !activeRacioMatrixUserID || !isInboxMatrixViewID(activeViewIDRef.current)) return;
    if (racioProjectionRefetchInFlightRef.current) return;
    const requestScopeKey = `${companyID}\u0000${currentUserID}\u0000${activeRacioMatrixUserID}`;
    racioProjectionRefetchInFlightRef.current = true;
    try {
      const [projection, projectedLogicGates] = await Promise.all([
        listRacioMatrixProjectionRows({ apiBase, companyID, targetUserID: activeRacioMatrixUserID, limit: 500 }),
        listMyLogicGates({ apiBase, companyID, targetUserID: activeRacioMatrixUserID, limit: 500 }),
      ]);
      if (racioProjectionScopeKeyRef.current !== requestScopeKey) return;
      applyRacioProjectionRows(projection.rows ?? [], {
        mode: "replace",
        logicGates: projectedLogicGates.logic_gates ?? [],
      });
      const sequence = Math.max(minimumSequence, parseRacioProjectionSequence(projection.projection_sequence));
      if (sequence > racioProjectionSequenceRef.current) {
        racioProjectionSequenceRef.current = sequence;
      }
    } catch (projectionError) {
      setError(formatError(projectionError, "Failed to refresh RACI matrix"));
    } finally {
      racioProjectionRefetchInFlightRef.current = false;
    }
  }, [activeRacioMatrixUserID, apiBase, applyRacioProjectionRows, companyID, currentUserID]);
  const removeRacioProjectionNode = useCallback((nodeID: string) => {
    const cleanNodeID = nodeID.trim();
    if (!cleanNodeID) return;
    racioProjectionRowsRef.current = racioProjectionRowsRef.current.filter((row) => row.resource_type !== "node" || row.resource_id.trim() !== cleanNodeID);
    racioProjectedNodeIDsRef.current.delete(cleanNodeID);
    setNodes((previous) => previous.filter((node) => node.node_id !== cleanNodeID));
    removeNodeRelationshipGraphNode(apiBase, companyID, cleanNodeID);
  }, [apiBase, companyID]);
  const requestRacioProjectionRefresh = useCallback((minimumSequence = 0) => {
    void refreshRacioMatrixProjection(minimumSequence);
  }, [refreshRacioMatrixProjection]);
  requestRacioProjectionRefreshRef.current = requestRacioProjectionRefresh;
  const applyRealtimeRacioProjectionDelta = useCallback((message: RealtimeProjectionDeltaMessage) => {
    if (!companyID || !activeRacioMatrixUserID) return;
    if (racioProjectionScopeKeyRef.current !== `${companyID}\u0000${currentUserID}\u0000${activeRacioMatrixUserID}`) return;
    const envelope = message as unknown as RacioProjectionDeltaEnvelope;
    const result = applyRacioProjectionEnvelope({
      envelope,
      companyID,
      userID: activeRacioMatrixUserID,
      rows: racioProjectionRowsRef.current,
      lastSequence: racioProjectionSequenceRef.current,
    });
    if (result.fallback) {
      requestRacioProjectionRefresh(parseRacioProjectionSequence(envelope.projection_sequence ?? envelope.sequence));
      return;
    }
    racioProjectionRowsRef.current = result.rows;
    racioProjectionSequenceRef.current = result.lastSequence ?? racioProjectionSequenceRef.current;
    if (!result.changed) return;

    for (const key of result.removedRowKeys) {
      if (key.resource_type === "node" && key.resource_id) removeRacioProjectionNode(key.resource_id);
    }
    const upsertedNodeRows = result.upsertedRows.filter((row) => row.resource_type === "node");
    const upsertedLogicGateRows = result.upsertedRows.filter((row) => row.resource_type === "logic_gate");
    if (upsertedNodeRows.length > 0) applyRacioProjectionRows(upsertedNodeRows);
    if (upsertedLogicGateRows.length > 0) applyRacioProjectionRows(upsertedLogicGateRows);
    if (upsertedLogicGateRows.length > 0 || result.removedRowKeys.some((key) => key.resource_type === "logic_gate")) {
      requestRacioProjectionRefresh(result.lastSequence ?? 0);
    }
  }, [activeRacioMatrixUserID, applyRacioProjectionRows, companyID, currentUserID, removeRacioProjectionNode, requestRacioProjectionRefresh]);
  useEffect(() => {
    if (!companyID || !activeRacioMatrixUserID || !isInboxMatrixView) return undefined;
    void refreshRacioMatrixProjection();
    return undefined;
  }, [activeRacioMatrixUserID, companyID, isInboxMatrixView, refreshRacioMatrixProjection]);
  useEffect(() => {
    const canSubscribeRacioTarget = activeRacioMatrixUserID === currentUserID || userHasFullSharedInboxAccess(me, companyID);
    if (!companyID || !activeRacioMatrixUserID || !isInboxMatrixView || !canSubscribeRacioTarget) return undefined;
    return subscribeRealtimeScope(apiBase, companyID, racioRealtimeScope(activeRacioMatrixUserID), {
      getAfterSequence: () => racioProjectionSequenceRef.current,
      onRejected: () => requestRacioProjectionRefresh(),
      onRefetch: (message) => requestRacioProjectionRefresh(parseRacioProjectionSequence(message.sequence)),
      onPermissionRevoked: () => requestRacioProjectionRefresh(),
      onError: () => requestRacioProjectionRefresh(),
      onDelta: applyRealtimeRacioProjectionDelta,
    });
  }, [activeRacioMatrixUserID, apiBase, applyRealtimeRacioProjectionDelta, companyID, currentUserID, isInboxMatrixView, me, requestRacioProjectionRefresh]);
  const attachMessagesToNode = useCallback(async (logicGateID: string, nodeID: string, messageIDs: string[], priority: number) => {
    const ids = cleanIDList(messageIDs);
    const cleanLogicGateID = logicGateID.trim();
    const cleanNodeID = nodeID.trim();
    if (!cleanLogicGateID || !cleanNodeID || ids.length === 0) return;
    setBusy("triage-attach");
    setError("");
    try {
      const conversion = await convertMessagesToLogicGateCommand({
        apiBase,
        companyID,
        logicGateID: cleanLogicGateID,
        nodeID: cleanNodeID,
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
      for (const node of conversion.result.nodes ?? []) mergeUpdatedNode(node);
      const converted = conversion.convertedMessageIDs;
      setMessages((previous) => previous.map((message) => converted.includes(message.id) ? markMessageSentToLogicGate(message, cleanLogicGateID) : message));
      setSelectedMessage((current) => current && converted.includes(current.id) ? markMessageSentToLogicGate(current, cleanLogicGateID) : current);
      const title = nodeTitle(nodeByID.get(cleanNodeID)) || "node";
      showNoticeWithResourceAction(converted.length === 1 ? `Attached to ${title}.` : `${converted.length} messages attached to ${title}.`, { kind: "node", nodeID: cleanNodeID });
    } catch (attachError) {
      setError(formatError(attachError, "Failed to attach email to node"));
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, mergeUpdatedNode, nodeByID, showNoticeWithResourceAction]);
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
  const mergeCreatedLogicGate = useCallback((logicGate: LogicGateRecord, folderItems: CompanyExplorerFolderItem[]) => {
    setLogicGates((previous) => {
      const next = previous.filter((item) => item.logic_gate_id !== logicGate.logic_gate_id);
      return [...next, logicGate];
    });
    mergeCreatedFolderItems(folderItems);
    upsertLogicGateRelationshipGraphNode(apiBase, companyID, toLogicGateCanvasRecord(logicGate));
  }, [apiBase, companyID, mergeCreatedFolderItems]);
  const createHomeNode = useCallback(async (assignment?: { logicGateID: string; priority: InboxPriority; status?: ResponsibleInboxStatus }) => {
    setBusy("create-node");
    setError("");
    try {
      const result = await createHomeNodeCommand({ apiBase, companyID });
      mergeCreatedFolderItems(result.folderItems);
      mergeUpdatedNode(result.node);
      if (assignment?.logicGateID.trim()) {
        const nodeMap = new Map(nodeByID);
        nodeMap.set(result.node.node_id, result.node);
        const dropResult = await dropNodesIntoInboxLogicGateCommand({
          apiBase,
          companyID,
          logicGateID: assignment.logicGateID,
          nodeIDs: [result.node.node_id],
          priority: assignment.priority,
          status: assignment.status,
          nodeByID: nodeMap,
          invalidateKanbanBoardContents: invalidateKanbanBoardContentsCache,
        });
        applyRacioProjectionRows(dropResult.racio_projection_rows);
        for (const node of dropResult.nodes) mergeUpdatedNode(node);
        setNotice("Node created and added to Logic Gate.");
        return;
      }
      setNotice("Node created.");
    } catch (createError) {
      setError(formatError(createError, assignment?.logicGateID ? "Failed to create node in Logic Gate" : "Failed to create node"));
    } finally {
      setBusy("");
    }
  }, [apiBase, applyRacioProjectionRows, companyID, mergeCreatedFolderItems, mergeUpdatedNode, nodeByID]);
  const createHomeLogicGate = useCallback(async (options: { assignCurrentUser?: boolean; creatorRaciRole?: LogicGateRaciRole; openArena?: boolean } = {}) => {
    setBusy("create-logic-gate");
    setError("");
    try {
      const creatorRaciRole = options.creatorRaciRole ?? (options.assignCurrentUser ? "responsible" : undefined);
      const result = await createHomeLogicGateCommand({ apiBase, companyID, creatorRaciRole });
      const logicGate = result.logicGate;
      mergeCreatedLogicGate(logicGate, result.folderItems);
      setNotice(creatorRaciRole ? "Logic Gate created and assigned to you." : "Logic Gate created.");
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
  const createLogicGateInInboxCell = useCallback(async (input: { creatorRaciRole?: LogicGateRaciRole }) => {
    await createHomeLogicGate({ creatorRaciRole: input.creatorRaciRole, openArena: false });
  }, [createHomeLogicGate]);
  const createNodeInInboxCell = useCallback(async (input: { priority: InboxPriority; status?: ResponsibleInboxStatus; creatorRaciRole?: LogicGateRaciRole }) => {
    setBusy("create-node");
    setError("");
    try {
      const result = await createHomeRacioMatrixNodeCommand({
        apiBase,
        companyID,
        priority: input.priority,
        status: input.status,
        creatorRaciRole: input.creatorRaciRole,
        createLogicGateTitle: "new logic gate",
      });
      if (result.logicGate) mergeCreatedLogicGate(result.logicGate, result.folderItems.filter((item) => item.item_type === "logic_gate"));
      mergeCreatedFolderItems(result.folderItems.filter((item) => item.item_type !== "logic_gate"));
      applyRacioProjectionRows(result.racio_projection_rows);
      mergeUpdatedNode(result.node);
      setNotice("Note created in a new Logic Gate.");
    } catch (createError) {
      setError(formatError(createError, "Failed to create note in matrix cell"));
    } finally {
      setBusy("");
    }
  }, [apiBase, applyRacioProjectionRows, companyID, mergeCreatedFolderItems, mergeCreatedLogicGate, mergeUpdatedNode]);
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
  const dropNodesIntoInboxLogicGate = useCallback(async (input: { logicGateID: string; nodeIDs: string[]; priority: InboxPriority; status?: ResponsibleInboxStatus; fromLogicGateID?: string }) => {
    const logicGateID = input.logicGateID.trim();
    const fromLogicGateID = input.fromLogicGateID?.trim() ?? "";
    const nodeIDs = cleanIDList(input.nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (!logicGateID || nodeIDs.length === 0) return;
    setBusy("inbox-node-drop");
    setError("");
    try {
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
      applyRacioProjectionRows(dropResult.racio_projection_rows);
      for (const node of dropResult.nodes) {
        if (node) mergeUpdatedNode(node);
      }
      const action = fromLogicGateID ? "moved" : "added";
      setNotice(nodeIDs.length === 1 ? `Node ${action} to Logic Gate.` : `${nodeIDs.length} nodes ${action} to Logic Gate.`);
    } catch (dropError) {
      setError(formatError(dropError, "Failed to add nodes to Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [apiBase, applyRacioProjectionRows, companyID, mergeUpdatedNode, nodeByID]);
  const dropNodesIntoNewInboxLogicGate = useCallback(async (input: { nodeIDs: string[]; priority: InboxPriority; status?: ResponsibleInboxStatus; creatorRaciRole?: LogicGateRaciRole; fromLogicGateID?: string }) => {
    const nodeIDs = cleanIDList(input.nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (nodeIDs.length === 0) return;
    setBusy("inbox-node-drop");
    setError("");
    try {
      const logicGateResult = await createHomeLogicGateCommand({ apiBase, companyID, creatorRaciRole: input.creatorRaciRole });
      const logicGate = logicGateResult.logicGate;
      mergeCreatedLogicGate(logicGate, logicGateResult.folderItems);
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
      applyRacioProjectionRows(dropResult.racio_projection_rows);
      for (const node of dropResult.nodes) mergeUpdatedNode(node);
      setNotice(nodeIDs.length === 1 ? "Node moved into a new Logic Gate." : `${nodeIDs.length} nodes moved into a new Logic Gate.`);
    } catch (dropError) {
      setError(formatError(dropError, "Failed to move nodes into a new Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [apiBase, applyRacioProjectionRows, companyID, mergeCreatedLogicGate, mergeUpdatedNode, nodeByID]);
  const moveLogicGatesIntoInboxCell = useCallback(async (input: { logicGateIDs: string[]; priority: InboxPriority; status?: ResponsibleInboxStatus; creatorRaciRole?: LogicGateRaciRole; nodeIDsByLogicGateID?: Record<string, string[]> }) => {
    const logicGateIDs = cleanIDList(input.logicGateIDs).filter((logicGateID) => logicGateByID.has(logicGateID));
    if (logicGateIDs.length === 0) return;
    setBusy("inbox-logic-gate-drop");
    setError("");
    try {
      const targetRole = input.creatorRaciRole;
      if (currentUserID && targetRole) {
        const raciRoles: LogicGateRaciRole[] = ["responsible", "accountable", "consulted", "informed"];
        const assignmentUpdates = await Promise.all(logicGateIDs.map(async (logicGateID) => {
          const gate = logicGateByID.get(logicGateID);
          let assignments = gate?.raci_assignments ?? [];
          const removalRoles = raciRoles.filter((role) => (
            role !== targetRole
            && assignments.some((assignment) => assignment.role === role && assignment.user_id?.trim() === currentUserID)
          ));
          if (removalRoles.length > 0) {
            assignments = await removeLogicGateRaciAssignments(companyID, logicGateID, removalRoles.map((role) => ({ role, user_id: currentUserID })));
          }
          const hasTargetRole = assignments.some((assignment) => assignment.role === targetRole && assignment.user_id?.trim() === currentUserID);
          if (!hasTargetRole) {
            assignments = await addLogicGateRaciAssignments(companyID, logicGateID, [{ role: targetRole, user_id: currentUserID }]);
          }
          return { logicGateID, assignments };
        }));
        setLogicGates((previous) => previous.map((logicGate) => {
          const update = assignmentUpdates.find((item) => item.logicGateID === logicGate.logic_gate_id);
          return update ? { ...logicGate, raci_assignments: update.assignments } : logicGate;
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
        applyRacioProjectionRows(dropResult.racio_projection_rows);
        movedNodeCount += dropResult.nodes.length;
        for (const node of dropResult.nodes) mergeUpdatedNode(node);
      }
      setNotice(logicGateIDs.length === 1
        ? (movedNodeCount > 0 ? "Logic Gate moved." : "Logic Gate assignment updated.")
        : `${logicGateIDs.length} Logic Gates moved.`);
    } catch (dropError) {
      setError(formatError(dropError, "Failed to move Logic Gates"));
    } finally {
      setBusy("");
    }
  }, [apiBase, applyRacioProjectionRows, companyID, currentUserID, logicGateByID, mergeUpdatedNode, nodeByID, nodes]);
  const addNodesToLogicGate = useCallback(async (nodeIDs: string[], logicGateID: string) => {
    const cleanLogicGateID = logicGateID.trim();
    const ids = cleanIDList(nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (!cleanLogicGateID || ids.length === 0) return;
    setBusy("bulk-node-edit");
    setError("");
    try {
      const updatedNodes = await addNodesToLogicGateCommand({
        apiBase,
        companyID,
        logicGateID: cleanLogicGateID,
        nodeIDs: ids,
        nodeByID,
        invalidateKanbanBoardContents: invalidateKanbanBoardContentsCache,
      });
      for (const node of updatedNodes) mergeUpdatedNode(node);
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
  const requestDeleteHomeEntities = useCallback((targets: HomeEntityDeleteTarget[]) => {
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
    setBulkEditMenu(null);
    setEntityDeleteConfirmation({ targets: normalizedTargets });
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
  const requestDeleteLogicGateContext = useCallback((logicGateID: string) => {
    activeDeleteSelectionKindRef.current = "logic_gate";
    requestDeleteHomeEntities(getLogicGateDeleteTargetsForContext(logicGateID));
  }, [getLogicGateDeleteTargetsForContext, requestDeleteHomeEntities]);
  const requestDeleteBulkEditTargets = useCallback((kind: "node" | "logic_gate", ids: string[]) => {
    activeDeleteSelectionKindRef.current = kind;
    requestDeleteHomeEntities(kind === "node" ? buildNodeDeleteTargets(ids) : buildLogicGateDeleteTargets(ids));
  }, [buildLogicGateDeleteTargets, buildNodeDeleteTargets, requestDeleteHomeEntities]);
  const deleteHomeEntities = useCallback(async (targets: HomeEntityDeleteTarget[]) => {
    const normalizedTargets = targets.map((target) => ({ kind: target.kind, id: target.id.trim() })).filter((target) => target.id);
    const nodeIDSet = new Set(normalizedTargets.filter((target) => target.kind === "node").map((target) => target.id));
    const logicGateIDSet = new Set(normalizedTargets.filter((target) => target.kind === "logic_gate").map((target) => target.id));
    if (nodeIDSet.size === 0 && logicGateIDSet.size === 0) return;
    setBusy("entity-delete");
    setError("");
    try {
      await deleteHomeEntitiesCommand({ apiBase, companyID, targets: normalizedTargets });
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
      const deletedCount = nodeIDSet.size + logicGateIDSet.size;
      setNotice(deletedCount === 1 ? "Item deleted." : `${deletedCount} items deleted.`);
    } catch (deleteError) {
      setError(formatError(deleteError, "Failed to delete selected items"));
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, logicGateIDFromTreeID, logicGateSelectionAnchorID, nodeIDFromTreeID, nodeSelectionAnchorID, nodes]);
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
  const applyBulkNodePatch = useCallback(async (nodeIDs: string[], patch: Partial<Pick<NodeRecord, "assignee_user_id" | "priority" | "status" | "due_date">>) => {
    const ids = cleanIDList(nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (ids.length === 0) return;
    setBusy("bulk-node-edit");
    setError("");
    try {
      const updatedNodes = await applyBulkNodePatchCommand({
        apiBase,
        companyID,
        nodeIDs: ids,
        patch,
        nodeByID,
        invalidateKanbanBoardContents: invalidateKanbanBoardContentsCache,
      });
      for (const node of updatedNodes) {
        mergeUpdatedNode(node);
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
  const applyBulkLogicGateRaci = useCallback(async (logicGateIDs: string[], role: LogicGateRaciRole, userID: string, action: "add" | "remove") => {
    const ids = cleanIDList(logicGateIDs).filter((logicGateID) => logicGateByID.has(logicGateID));
    const cleanUserID = userID.trim();
    if (ids.length === 0 || !cleanUserID) return;
    setBusy("bulk-logic-gate-edit");
    setError("");
    try {
      const updates = await Promise.all(ids.map(async (logicGateID) => {
        const assignments = action === "add"
          ? await addLogicGateRaciAssignments(companyID, logicGateID, [{ role, user_id: cleanUserID }])
          : await removeLogicGateRaciAssignments(companyID, logicGateID, [{ role, user_id: cleanUserID }]);
        return { logicGateID, assignments };
      }));
      setLogicGates((previous) => previous.map((logicGate) => {
        const update = updates.find((item) => item.logicGateID === logicGate.logic_gate_id);
        return update ? { ...logicGate, raci_assignments: update.assignments } : logicGate;
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
      : fitHomeColumnWidthsToAvailableWidth(columnWidthsRef.current, availableWidth, !hideNavigationRef.current);
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
  const activeMessageListKey = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly);
  const baseMailboxCounts = useMemo(() => mailboxCountsFromFolders(folders), [folders]);
  const currentMailboxCountKey = mailCountKey(companyID, activeViewID);
  const currentMailboxCountOverrides = mailboxCountOverrides[currentMailboxCountKey] ?? {};
  const primaryMailboxCountOverride = currentMailboxCountOverrides.primary;
  const starredMailboxCountOverride = currentMailboxCountOverrides.starred;
  const mailboxCounts = useMemo(() => ({
    ...baseMailboxCounts,
    primary: primaryMailboxCountOverride ?? baseMailboxCounts.primary,
    starred: starredMailboxCountOverride ?? baseMailboxCounts.starred,
  }), [baseMailboxCounts, primaryMailboxCountOverride, starredMailboxCountOverride]);
  useEffect(() => {
    if (baseMailboxCounts.primary === undefined || primaryMailboxCountOverride === undefined) return;
    if (baseMailboxCounts.primary === primaryMailboxCountOverride) setPrimaryMailboxCountOverride(currentMailboxCountKey, undefined);
  }, [baseMailboxCounts.primary, currentMailboxCountKey, primaryMailboxCountOverride, setPrimaryMailboxCountOverride]);
  useEffect(() => {
    if (baseMailboxCounts.starred === undefined || starredMailboxCountOverride === undefined) return;
    if (baseMailboxCounts.starred === starredMailboxCountOverride) setStarredMailboxCountOverride(currentMailboxCountKey, undefined);
  }, [baseMailboxCounts.starred, currentMailboxCountKey, setStarredMailboxCountOverride, starredMailboxCountOverride]);
  useEffect(() => {
    if (!status?.connected || !isArchivableListView || mailbox !== "primary" || searchQuery.trim() || unreadOnly) return;
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
    status?.connected,
    unreadOnly,
  ]);
  useEffect(() => {
    if (!status?.connected || isInboxMatrixView || isCustomMatrixView) return;
    window.dispatchEvent(new CustomEvent("mangorts:home-unread-counts-updated", {
      detail: { companyID, viewID: activeViewID, unreadCount: unreadMessageCount },
    }));
  }, [activeViewID, companyID, isCustomMatrixView, isInboxMatrixView, status?.connected, unreadMessageCount]);
  const mailFilterStatus = selectedMessageIDs.size > 1
    ? `${selectedMessageIDs.size} selected`
    : (loadingMessages || loadingMoreMessages) ? "Loading" : "";
  const layoutColumnWidths = isNarrow || isInboxMatrixView || isCustomMatrixView
    ? columnWidths
    : fitHomeColumnWidthsToAvailableWidth(columnWidths, workspaceTrackWidth, !hideNavigation);
  const workspaceGridTemplateColumns = isNarrow
    ? "1fr"
    : isCustomMatrixView
      ? hideNavigation
        ? "minmax(0, 1fr)"
        : `${layoutColumnWidths[0]}px minmax(0, 1fr)`
      : hideNavigation
      ? isInboxMatrixView
        ? getInboxMatrixGridTemplateColumnsWithoutSidebar(layoutColumnWidths)
        : getHomeGridTemplateColumnsWithoutSidebar(layoutColumnWidths)
      : isInboxMatrixView
        ? getInboxMatrixGridTemplateColumns(layoutColumnWidths)
        : getHomeGridTemplateColumns(layoutColumnWidths);
  const matrixWorkspaceActive = (isInboxMatrixView || isCustomMatrixView) && !isNarrow;
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
      {loadingStatus ? (
        <main style={centerStyle}>Loading email connection</main>
      ) : !status?.configured ? (
        <main style={centerStyle}>
          <section style={connectPanelStyle}>
            <h2 style={panelTitleStyle}>Email is not configured</h2>
            <p style={mutedTextStyle}>Set the Nylas environment variables on the backend, then restart the API.</p>
          </section>
        </main>
      ) : !status.connected ? (
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
          {!hideNavigation && (
            <HomeSidebar
              activeViewID={activeViewID}
              connectedAccountEmail={connection?.account_email}
              sharedInboxes={sharedInboxes}
              loadingSharedInboxes={loadingSharedInboxes}
              newSharedInboxName={newSharedInboxName}
              busy={busy}
              notificationSummary={notificationSummary}
              onSelectView={selectHomeView}
              onNewSharedInboxNameChange={setNewSharedInboxName}
              onSubmitSharedInbox={submitSharedInbox}
              onCreateSharedInbox={createSharedInboxFolder}
              onRenameSharedInbox={renameSharedInboxFolder}
              onSetSharedInboxAccountEmail={setSharedInboxAccountEmail}
              onMoveSharedInbox={moveSharedInboxFolder}
              onDeleteSharedInbox={deleteSharedInboxFolder}
            />
          )}
          {isCustomMatrixView ? (
            <CustomMatrixView
              loading={loadingNodes || loadingLogicGates}
              nodes={nodes}
              logicGateByID={logicGateByID}
              companyUsers={companyUsers}
              onOpenNode={openNodeEditorOverlay}
              onOpenLogicGate={(logicGateID, label) => openLogicGateArena(logicGateID, label || logicGateTitle(logicGateByID.get(logicGateID)))}
            />
          ) : isInboxMatrixView ? (
            <>
              {activeRaciInboxSection && (
                <RaciRoleInboxMatrix
                  section={activeRaciInboxSection}
                  loading={loadingNodes}
                  nodes={nodes}
                  nodeByID={nodeByID}
                  nodeRelationships={nodeRelationships}
                  logicGateByID={logicGateByID}
                  nodeFolders={nodeFolders}
                  nodeFolderItems={nodeFolderItems}
                  currentUserID={activeRacioMatrixUserID}
                  viewerSelector={racioMatrixViewerSelector}
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
                  onCreateLogicGateInCell={(input) => { void createLogicGateInInboxCell(input); }}
                  onCreateNodeInCell={(input) => { void createNodeInInboxCell(input); }}
                  onDropNodes={(input) => { void dropNodesIntoInboxLogicGate(input); }}
                  onDropNodesInCell={(input) => { void dropNodesIntoNewInboxLogicGate(input); }}
                  onDropLogicGates={(input) => { void moveLogicGatesIntoInboxCell(input); }}
                />
              )}
              {hideNavigation && !isNarrow && <HomeColumnResizeHandle dividerIndex={2} onPointerDown={startColumnResize} />}
              <NodeInboxRail
                loading={loadingNodes}
                nodeByID={nodeByID}
                logicGateByID={logicGateByID}
                allRows={visibleNodeRows}
                myNodeGroups={myNodeGroups}
                otherNodes={otherAssignedNodes}
                myLogicGateGroups={activeRaciRoleLogicGateGroups}
                inboxRole={activeRaciInboxSection?.role ?? "other"}
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
            </>
          ) : (
            <>
          {!hideNavigation && !isNarrow && <HomeColumnResizeHandle dividerIndex={0} onPointerDown={startColumnResize} />}
          <HomeMailWorkspace
            activeViewID={activeViewID}
            accountEmail={activeMailAccountEmail}
            archiveAvailable={canMutateCurrentMailView}
            archiveLabel={isArchiveMailbox ? "Unarchive" : "Archive"}
            busy={busy}
            compose={compose}
            error={error}
            isArchivableListView={isArchivableListView}
            isArchiveMailbox={isArchiveMailbox}
            listViewLabel={listViewLabel}
            loadingDetail={loadingDetail}
            loadingMessages={loadingMessages}
            loadingMoreMessages={loadingMoreMessages}
            mailFilterStatus={mailFilterStatus}
            mailbox={mailbox}
            mailboxCounts={mailboxCounts}
            messageListRef={messageListRef}
            messages={messages}
            myLogicGateGroups={myLogicGateGroups}
            nodes={nodes}
            notice={notice}
            noticeAction={mailNoticeAction}
            pendingAutoArchiveMessageIDs={pendingAutoArchiveMessageIDs}
            pendingStarredMessageIDs={pendingStarredMessageIDs}
            searchDraft={searchDraft}
            selectedMessage={selectedMessage}
            selectedMessageID={selectedMessageID}
            selectedMessageIDs={selectedMessageIDs}
            sharedInboxSettings={activeSharedInbox ? {
              onOpen: () => setSharedInboxPermissionsFolderID(activeSharedInbox.folder_id),
              onOpenRaci: () => setSharedInboxRaciFolderID(activeSharedInbox.folder_id),
            } : undefined}
            unassignedSharedInbox={activeSharedInboxBlocksEmail && activeSharedInbox
              ? { folderName: activeSharedInbox.name, message: "Parent folders cannot have emails assigned." }
              : activeSharedInboxNeedsEmail && activeSharedInbox
                ? { folderName: activeSharedInbox.name, onAssignEmail: assignActiveSharedInboxEmail }
                : undefined}
            showDetailResizeHandle={!isNarrow}
            unreadOnly={unreadOnly}
            unreadMessageCount={unreadMessageCount}
            onArchiveSelected={archiveSelected}
            onAttachMessageToNode={attachMessagesToNode}
            onAutoArchiveMessages={autoArchiveScrolledMessages}
            onCancelCompose={() => setCompose(emptyCompose)}
            onColumnResizeStart={startColumnResize}
            onComposeChange={setCompose}
            onDeleteSelected={deleteSelected}
            onDisconnect={disconnect}
            onLoadMoreMessages={() => { void loadMoreMessages(); }}
            onPrefetchMessages={() => { void prefetchNextMessagePage(); }}
            onOpenAllMailbox={openAllMailbox}
            onOpenArchivedMailbox={openArchivedMailbox}
            onOpenContextMenu={openMessageContextMenu}
            onOpenNewCompose={openNewCompose}
            onOpenPendingMailbox={openPendingMailbox}
            onOpenReply={openReply}
            onOpenSentMailbox={openSentMailbox}
            onOpenStarredMailbox={openStarredMailbox}
            onCreateMessageNode={convertMessagesToLogicGate}
            onSearchDraftChange={setSearchDraft}
            onSelectMessage={selectMessageRow}
            onStartMessageDrag={startMessageDrag}
            onSubmitCompose={submitCompose}
            onSubmitSearch={submitSearch}
            onToggleMessageStar={toggleMessageStar}
            onToggleRead={() => { if (selectedMessage) void patchSelectedMessage({ unread: !selectedMessage.unread }); }}
            onToggleStar={() => { if (selectedMessage) void patchSelectedMessage({ starred: !selectedMessage.starred }); }}
            onToggleUnreadOnly={(checked) => {
              setUnreadOnly(checked);
              setNextPageToken("");
            }}
          />
          {!isNarrow && <HomeColumnResizeHandle dividerIndex={2} onPointerDown={startColumnResize} />}
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
          <HomeMailOverlays
            busy={busy}
            isArchiveMailbox={isArchiveMailbox}
            mailboxActionBusy={mailboxActionBusy}
            mailMutationAvailable={canMutateCurrentMailView}
            messageContextMenu={messageContextMenu}
            deleteConfirmation={deleteConfirmation}
            onArchiveMessages={(ids) => { void archiveMessages(ids); }}
            onCancelDelete={() => setDeleteConfirmation(null)}
            onCloseContextMenu={() => setMessageContextMenu(null)}
            onConfirmDelete={(ids) => {
              setDeleteConfirmation(null);
              void deleteMessages(ids);
            }}
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
          companyID={companyID}
          entityType="shared_triage_folder"
          entityID={sharedInboxPermissionsFolder.folder_id}
          title={sharedInboxPermissionsFolder.name}
          onClose={() => setSharedInboxPermissionsFolderID("")}
          onSaved={() => { void loadSharedInboxes(); }}
        />
      )}
      {sharedInboxRaciFolder && (
        <SharedInboxRaciSettingsModal
          requestJSON={permissionsRequestJSON}
          companyID={companyID}
          folder={sharedInboxRaciFolder}
          companyUsers={companyUsers}
          busy={busy === "shared-inbox-raci"}
          onAddSubject={addSharedInboxRaciSubject}
          onRemoveSubject={removeSharedInboxRaciSubject}
          onClose={() => setSharedInboxRaciFolderID("")}
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
        onApplyLogicGateRaci={(logicGateIDs, role, userID, action) => { void applyBulkLogicGateRaci(logicGateIDs, role, userID, action); }}
        onAddNodesToLogicGate={(nodeIDs, logicGateID) => { void addNodesToLogicGate(nodeIDs, logicGateID); }}
        onRequestDelete={requestDeleteBulkEditTargets}
      />
      {entityDeleteConfirmation && (
        <DeleteHomeEntitiesConfirmationModal
          targets={entityDeleteConfirmation.targets}
          busy={busy === "entity-delete"}
          onCancel={() => setEntityDeleteConfirmation(null)}
          onConfirm={() => { void deleteHomeEntities(entityDeleteConfirmation.targets); }}
        />
      )}
      {nodeEditorOverlay && (
        <NodeEditorPopup
          nodeID={nodeEditorOverlay.nodeID}
          nodeTitle={nodeEditorOverlay.nodeTitle}
          focusInformationID={nodeEditorOverlay.focusInformationID}
          focusRequestID={nodeEditorOverlay.focusRequestID}
          onClose={closeNodeEditorOverlay}
          onCollapseToTab={() => {
            requestAppDockTab({ kind: "node", entityID: nodeEditorOverlay.nodeID, label: nodeEditorOverlay.nodeTitle });
            closeNodeEditorOverlay();
          }}
        />
      )}
    </div>
  );
}
export const HomeFrameContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "mango" | "teal" | "light" | "dark" }> = () => (
  <HomePage embedded />
);
export type { HomePageProps, HomeViewID } from "./homeTypes";
