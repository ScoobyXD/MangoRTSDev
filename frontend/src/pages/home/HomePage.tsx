import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readAuthConfig } from "../../auth/cognitoAuth";
import { AccountFilterControl, useCompanyAccounts } from "../../modules/accounts/AccountFilterControl";
import { entityMatchesAccountFilter } from "../../modules/accounts/accountsApi";
import { createRequestJSON, requestJSON } from "../../modules/api/requestJSON";
import { EntityPermissionsDialog } from "../../modules/permissions/EntityPermissionsDialog";
import { getActiveCompanyID } from "../../auth/currentCompany";
import type { ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu";
import { requestAppDockTab } from "../../app/appDockTabs";
import { MangoWordmark } from "../../app/MangoLogo";
import { preloadLogicGateArenaSurface, preloadProjectManagementSurface } from "../../app/preloadDashboardModules";
import {
  applyEmailMessageToCachedPages,
  addLogicGateGVICAssignments,
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
  markCommunicationsFolderCacheStale,
  mergeEmailMessageIntoMessageList,
  primeEmailMessageCache,
  reconcileEmailMessageLocalReply,
  reconcileLocalEmailReply,
  removeLogicGateGVICAssignments,
  removeEmailMessageFromCache,
  sortEmailMessagesByDateDescending,
  updateCommunicationsSharedInboxGVICAssignments,
  type CompanyUser,
  type CompanyUserGroup,
  type CompanyUserGroupMember,
  type CommunicationsSharedInbox,
  type CommunicationsSharedInboxCreateIntent,
  type CommunicationsSharedInboxGVICRole,
  type CommunicationsSharedInboxGVICPrincipalType,
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
import type { LogicGateGVICRole, LogicGateRecord } from "../../modules/logic-gate-map/shared";
import { toLogicGateCanvasRecord } from "../../modules/logic-gate-map/shared";
import { invalidateNodeRecordStoreCaches } from "../../modules/node-map/NodeRecordStore";
import { getLogicGateRecordSingleFlight } from "../../modules/logic-gate-map/LogicGateRecordStore";
import { removeNodeRelationshipGraphNode, upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../../modules/node-map/NodeRelationshipGraph";
import { removeLogicGateRelationshipGraphNode, upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../../modules/logic-gate-map/LogicGateRelationshipGraph";
import { invalidateKanbanBoardContentsCache } from "../../modules/kanban/KanbanBoardContentStore";
import { invalidateKanbanBoardListCache, invalidateLogicGateArenaViewCache, type GVICMatrixProjectionRow } from "../../modules/kanban/kanbanApi";
import { applyGVICMatrixProjectionEnvelope, parseGVICMatrixProjectionSequence, GVICMatrixRealtimeScope, type GVICMatrixProjectionDeltaEnvelope } from "../../modules/gvic/gvicMatrixProjectionDeltas";
import { subscribeRealtimeScope, type RealtimeProjectionDeltaMessage } from "../../modules/realtime/realtimeWebSocket";
import { listMyLogicGates, listGVICMatrixProjectionRows } from "../../modules/work-items/workItemReadApi";
import { subscribeWorkspaceRealtime, workspaceRealtimeScope, type WorkspaceReconciliationScope } from "../../modules/workspace/workspaceRealtime";
import { useNotificationSummary } from "../../modules/notifications/useNotificationSummary";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED } from "../../modules/node-map/eventbus";
import { writePendingLogicGateArenaSelection } from "../logic-gate-arena/logicGateArenaLaunch";
import { buildLogicGateRoute, buildProjectRoute } from "../../app/deepLinkRoutes";
import { DeleteHomeEntitiesConfirmationModal, HomeBulkEditMenu, HomeColumnResizeHandle, HomeSidebar, LogicGateRail, NodeEditorPopup, NodeInboxRail, GVICMatrixViewerSelector, GVICRoleInboxMatrix, SharedInboxGVICSettingsModal, type GVICMatrixViewerListEntry } from "./HomeParts";
import { MyWorkView } from "./MyWorkView";
import { markMyWorkMatrixCachesStaleForCompany, markMyWorkMatrixCachesStaleForTargetUsers } from "./myWorkMatrixLoader";
import { myWorkDebugLog, recordMyWorkDebugCause } from "./myWorkPerformanceDebug";
import { UpdatesView } from "./UpdatesView";
import { HomeMailOverlays, HomeMailWorkspace, type HomeMailNoticeAction } from "./HomeMailWorkspace";
import { composeHasDraftContent, createHomeMailDraftID, deleteHomeMailDraft, deleteHomeMailDrafts, homeMailDraftToCompose, homeMailDraftToMessage, readHomeMailDrafts, readHomeMailSignature, saveHomeMailDraftFromCompose, saveHomeMailSignature, type HomeMailDraft } from "./homeMailDrafts";
import { ARCHIVE_QUEUE_MAX_EMAILS, EVENT_HOME_TRIAGE_CONVERSION_APPLIED, HOME_COLUMN_RESIZER_WIDTH, MESSAGE_BATCH_SIZE, MESSAGE_EVENT_REFRESH_DELAY_MS, SELF_SEND_DELIVERY_REFRESH_DELAY_MS, TRIAGE_MESSAGE_DRAG_MIME, type HomeTriageConversionAppliedDetail } from "./homeConstants";
import { addMyLogicGateShortcutsCommand, addNodesToLogicGateCommand, applyBulkNodePatchCommand, archiveHomeMailMessagesCommand, convertMessagesToLogicGateCommand, createHomeLogicGateCommand, createHomeNodeCommand, createHomeGVICMatrixNodeCommand, createSharedInboxCommand, deleteHomeEntitiesCommand, deleteHomeMailMessagesCommand, deleteSharedInboxCommand, dropNodesIntoInboxLogicGateCommand, moveMyWorkNodesToCellCommand, moveSharedInboxCommand, removeMyLogicGateShortcutCommand, removeSharedInboxCommand, renameSharedInboxCommand, sendHomeMailComposeCommand, unarchiveHomeMailMessagesCommand, updateHomeMailMessageCommand, updateSharedInboxAccountEmailCommand } from "./homeCommands";
import { buildMyLogicGateGroups, buildMyNodeGroups, canDragTriageMessageFromMailbox, cleanIDList, communicationStreamEventIsArchiveConfirmation, communicationStreamEventIsStarConfirmation, filterExplorerRowsForSearch, fitHomeColumnWidthsToAvailableWidth, formatAddressList, formatError, formatErrorCode, getHomeColumnMinimumTrackWidth, getHomeGridTemplateColumns, getHomeGridTemplateColumnsWithoutSidebar, getHomeWorkspaceTrackWidth, getHomeViewLabel, getInboxMatrixGridTemplateColumns, getInboxMatrixGridTemplateColumnsWithoutSidebar, isArchivableHomeViewID, isEditableKeyboardTarget, isEmailAccessExpiredError, isInboxMatrixViewID, isWorkspacePanelHomeViewID, logicGateHasAnyGVICRole, logicGateHasGVICRole, logicGateIDFromTreeID, logicGateTitle, logicGateTreeID, mailboxCountsFromFolders, missingLogicGateRecordIDs, mailboxForHomeView, mailboxLabel, mergeLogicGateShortcuts, messageListFilterKey, nodeIDFromTreeID, nodeTitle, nodeTreeID, gvicInboxSectionForView, readHomeColumnWidths, resizeHomeColumns, resizeHomeColumnsWithoutSidebar, resizeHomeInboxMatrixColumnsWithoutSidebar, saveHomeColumnWidths, sharedInboxCanLoadMail, sharedInboxTreeUserCanManageMail, sortLogicGateShortcuts, sortSharedInboxes, triageMessageIDsFromStreamMessageID, userCanManageSharedInboxStructure, userHasFullSharedInboxAccess, workspaceEventTouchesHomePanel } from "./homeUtils";
import { brandStyle, centerStyle, connectPanelStyle, errorStyle, headerButtonStyle, headerDividerStyle, headerStyle, mutedTextStyle, noticeStyle, pageStyle, panelTitleStyle, primaryButtonStyle, titleStyle, userPillStyle, workspaceStyle } from "./homeStyles";
import { emptyCompose, type ComposeState, type CommunicationsStreamEnvelope, type HomeColumnResizeDrag, type HomeColumnWidths, type HomeEntityDeleteKind, type HomeEntityDeleteTarget, type HomePageProps, type HomeViewID, type InboxPriority, type LoadMessagesOptions, type MessageSelectionModifiers, type NodeEditorOverlayState, type GVICInboxStatus, type WorkspaceStreamEnvelope } from "./homeTypes";

function sharedInboxIDForHomeView(viewID: HomeViewID): string {
  return viewID.startsWith("shared:") ? viewID.slice("shared:".length).trim() : "";
}

function isPrimaryTriageMailbox(viewID: HomeViewID, mailbox: EmailMailbox): boolean {
  return isArchivableHomeViewID(viewID) && mailbox === "primary";
}

function homeViewUsesSharedEmailConnection(viewID: HomeViewID): boolean {
  return sharedInboxIDForHomeView(viewID) !== "";
}

function isTriageMailViewID(viewID: HomeViewID): boolean {
  return viewID === "my-triage" || viewID === "shared-root" || viewID.startsWith("shared:");
}

const MISSING_LOGIC_GATE_REPAIR_CONCURRENCY = 4;
const MISSING_LOGIC_GATE_REPAIR_FAILURE_TTL_MS = 5 * 60_000;
const ARCHIVE_BACKGROUND_CONFIRMATION_TIMEOUT_MS = 3 * 60_000;
const LOCAL_TRIAGE_CONVERSION_ECHO_TTL_MS = 8_000;
const LOCAL_TRIAGE_CONVERSION_MAIL_NETWORK_SUPPRESSION_MS = 8_000;
const LOCAL_TRIAGE_CONVERSION_WORKSPACE_EVENT_TYPES = new Set([
  "work_item.email_converted",
  "node_created",
  "node_updated",
  "work_item.logic_gate_assignment_saved",
  "kanban_card_upserted",
  "company_explorer_folder_item_assigned",
  "company_explorer_item_placed",
]);

type LocalTriageConversionWorkspaceEcho = {
  expiresAt: number;
  sharedInboxID: string;
  messageIDs: Set<string>;
  nodeIDs: Set<string>;
  boardIDs: Set<string>;
  cardIDs: Set<string>;
  logicGateIDs: Set<string>;
};

function recordStringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function nestedRecordValue(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function workspaceEventValue(record: Record<string, unknown>, key: string, nestedKey?: string): string {
  const direct = recordStringValue(record, key);
  if (direct || !nestedKey) return direct;
  return recordStringValue(nestedRecordValue(record, nestedKey), key);
}

function hasSemanticWorkspaceScopes(scopes: WorkspaceReconciliationScope[]): boolean {
  return scopes.some((scope) => Boolean(scope.semanticScope));
}

function workspaceScopeTouchesHomeWorkspacePanel(scope: WorkspaceReconciliationScope): boolean {
  if (scope.semanticScope) return false;
  return (
    scope.kind === "company_explorer" ||
    (scope.kind === "node_graph" && workspaceEventTouchesHomePanel(scope.eventType)) ||
    (scope.kind === "logic_gate_graph" && workspaceEventTouchesHomePanel(scope.eventType)) ||
    scope.kind === "kanban_board" ||
    scope.kind === "kanban_board_list" ||
    scope.kind === "gvic_matrix" ||
    scope.kind === "work_item_assignment" ||
    scope.kind === "workspace"
  );
}

function workspaceScopeTouchesSharedInbox(scope: WorkspaceReconciliationScope): boolean {
  if (scope.semanticScope) return false;
  return (
    scope.eventType === "communications_shared_inbox_gvic_updated" ||
    scope.eventType === "shared_triage_access_updated" ||
    (scope.kind === "company_explorer" && (!scope.folderKind || scope.folderKind === "communications")) ||
    scope.kind === "workspace"
  );
}

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
  const cleanSignature = signature.trim();
  return cleanSignature ? `\n\n\n${cleanSignature}` : "";
}

type HomeNoticeResourceAction =
  | { kind: "logic_gate"; logicGateID: string }
  | { kind: "node"; nodeID: string };

const GVICMatrix_VIEWER_LIST_STORAGE_KEY_PREFIX = "mangorts.home.gvicViewerList.v1";

function GVICMatrixViewerListStorageKey(companyID: string, userID: string): string {
  const cleanCompanyID = companyID.trim() || "global";
  const cleanUserID = userID.trim() || "anonymous";
  return `${GVICMatrix_VIEWER_LIST_STORAGE_KEY_PREFIX}:${cleanCompanyID}:${cleanUserID}`;
}

function readGVICMatrixViewerListEntries(companyID: string, userID: string): GVICMatrixViewerListEntry[] {
  if (typeof localStorage === "undefined" || !companyID.trim() || !userID.trim()) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(GVICMatrixViewerListStorageKey(companyID, userID)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries: GVICMatrixViewerListEntry[] = [];
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

function storeGVICMatrixViewerListEntries(companyID: string, userID: string, entries: GVICMatrixViewerListEntry[]): void {
  if (typeof localStorage === "undefined" || !companyID.trim() || !userID.trim()) return;
  const cleanEntries = entries
    .map((entry) => ({ kind: entry.kind, id: entry.id.trim() }))
    .filter((entry) => (entry.kind === "group" || entry.kind === "user") && entry.id);
  const key = GVICMatrixViewerListStorageKey(companyID, userID);
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

type QueuedArchiveBatch = {
  companyID: string;
  sharedInboxID?: string;
  messageIDs: string[];
};

type SharedInboxEmailConnectionDialogState = {
  accountEmail: string;
  canConnect: boolean;
  createIntent?: CommunicationsSharedInboxCreateIntent;
};

type SharedInboxEmailAssignmentDialogState = {
  folderID: string;
  folderName: string;
  draft: string;
  error: string;
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
  hideNavigation = false,
  initialViewID = "my-work",
  onActiveViewChange,
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
  const [queuedArchiveEmailCount, setQueuedArchiveEmailCount] = useState(0);
  const [pendingStarredMessageIDs, setPendingStarredMessageIDs] = useState<Set<string>>(new Set());
  const [messageContextMenu, setMessageContextMenu] = useState<{ x: number; y: number; messageIDs: string[] } | null>(null);
  const [bulkEditMenu, setBulkEditMenu] = useState<{ x: number; y: number; kind: "node" | "logic_gate"; ids: string[] } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ messageIDs: string[]; position?: ConfirmActionMenuPosition | null } | null>(null);
  const [entityDeleteConfirmation, setEntityDeleteConfirmation] = useState<{ targets: HomeEntityDeleteTarget[]; position?: ConfirmActionMenuPosition | null } | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [nextPageToken, setNextPageToken] = useState("");
  const [loadedMessageListKey, setLoadedMessageListKey] = useState("");
  const [compose, setCompose] = useState<ComposeState>(emptyCompose);
  const [mailDrafts, setMailDrafts] = useState<HomeMailDraft[]>([]);
  const [emailSignature, setEmailSignature] = useState("");
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
  const [GVICMatrixViewerListEntries, setGVICMatrixViewerListEntries] = useState<GVICMatrixViewerListEntry[]>([]);
  const [GVICMatrixTargetUserID, setGVICMatrixTargetUserID] = useState("");
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
  const [sharedInboxGVICFolderID, setSharedInboxGVICFolderID] = useState("");
  const [sharedInboxEmailConnectionDialog, setSharedInboxEmailConnectionDialog] = useState<SharedInboxEmailConnectionDialogState | null>(null);
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
  const [myWorkLiveRefreshToken, setMyWorkLiveRefreshToken] = useState(0);
  const [updatesLiveRefreshToken, setUpdatesLiveRefreshToken] = useState(0);
  const [optimisticMyWorkDeletedNodeIDs, setOptimisticMyWorkDeletedNodeIDs] = useState<Set<string>>(new Set());
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
  const prefetchMessageGenerationRef = useRef(0);
  const selectedMessageIDRef = useRef("");
  const selectedMessageRef = useRef<EmailMessage | null>(null);
  const activeViewIDRef = useRef<HomeViewID>(initialViewID);
  const initialViewIDRef = useRef<HomeViewID>(initialViewID);
  const queuedArchiveBatchesRef = useRef<Map<string, QueuedArchiveBatch>>(new Map());
  const pendingArchiveMessageKeysRef = useRef<Set<string>>(new Set());
  const archiveQueueFlushTimerRef = useRef<number | null>(null);
  const archivePendingReleaseTimerIDsRef = useRef<Set<number>>(new Set());
  const pendingStarredMessageIDsRef = useRef<Set<string>>(new Set());
  const folderReloadTimerRef = useRef<number | null>(null);
  const workspacePanelReloadTimerRef = useRef<number | null>(null);
  const messageListRefreshTimerRef = useRef<number | null>(null);
  const myWorkLiveRefreshTimerRef = useRef<number | null>(null);
  const GVICMatrixProjectionSequenceRef = useRef(0);
  const GVICMatrixProjectionRefetchInFlightRef = useRef(false);
  const GVICMatrixProjectionInitializedRef = useRef(false);
  const GVICMatrixProjectionRowsRef = useRef<GVICMatrixProjectionRow[]>([]);
  const GVICMatrixProjectionScopeKeyRef = useRef("");
  const GVICMatrixProjectedNodeIDsRef = useRef<Set<string>>(new Set());
  const GVICMatrixProjectedLogicGateIDsRef = useRef<Set<string>>(new Set());
  const requestGVICMatrixProjectionRefreshRef = useRef<((minimumSequence?: number) => void) | null>(null);
  const messagesRef = useRef<EmailMessage[]>([]);
  const foldersRef = useRef<EmailFolder[]>([]);
  const sharedInboxesRef = useRef<CommunicationsSharedInbox[]>([]);
  const locallyReadMessageIDsRef = useRef<Set<string>>(new Set());
  const mailboxRef = useRef<EmailMailbox>("primary");
  const nextPageTokenRef = useRef("");
  const searchQueryRef = useRef("");
  const unreadOnlyRef = useRef(false);
  const loadingMessagesRef = useRef(false);
  const loadingMoreMessagesRef = useRef(false);
  const activeDeleteSelectionKindRef = useRef<"message" | HomeEntityDeleteKind | "">("");
  const messageListFilterKeyRef = useRef("");
  const locallyAppliedTriageConversionIDsRef = useRef<Map<string, number>>(new Map());
  const locallyAppliedTriageConversionWorkspaceEchoesRef = useRef<LocalTriageConversionWorkspaceEcho[]>([]);
  const localTriageConversionMailNetworkSuppressionRef = useRef<{ filterKey: string; expiresAt: number } | null>(null);
  const locallyArchivedMessageKeysRef = useRef<Map<string, number>>(new Map());
  const locallyStarMutatedMessageKeysRef = useRef<Map<string, number>>(new Map());
  const missingLogicGateRepairFailureIDsRef = useRef<Map<string, number>>(new Map());
  const noticeResourceTextRef = useRef("");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const columnWidthsRef = useRef<HomeColumnWidths>(columnWidths);
  const columnResizeDragRef = useRef<HomeColumnResizeDrag | null>(null);
  const hideNavigationRef = useRef(hideNavigation);
  const isInboxMatrixView = isInboxMatrixViewID(activeViewID);
  const isMyWorkView = activeViewID === "my-work";
  const isUpdatesView = activeViewID === "updates";
  const { accounts: matrixAccounts } = useCompanyAccounts(companyID, isInboxMatrixView);
  const isNarrow = isInboxMatrixView
    ? viewportWidth < 980
    : isMyWorkView || isUpdatesView
      ? viewportWidth < 760
      : workspaceTrackWidth < getHomeColumnMinimumTrackWidth(!hideNavigation);
  const currentUserID = me?.user.user_id?.trim() ?? "";
  const activeGVICMatrixUserID = isInboxMatrixView ? (GVICMatrixTargetUserID.trim() || currentUserID) : currentUserID;
  useEffect(() => {
    setOptimisticMyWorkDeletedNodeIDs(new Set());
  }, [companyID]);
  const scheduleMyWorkLiveRefresh = useCallback((scopes?: WorkspaceReconciliationScope[]) => {
    const myWorkScopes = (scopes ?? []).filter((scope) => scope.kind === "my_work");
    const targetUserIDs = cleanIDList(myWorkScopes.map((scope) => (
      scope.userID ?? (scope.semanticTargetType === "user" ? scope.semanticTargetID ?? "" : "")
    )));
    if (targetUserIDs.length > 0) markMyWorkMatrixCachesStaleForTargetUsers(targetUserIDs);
    if (
      myWorkScopes.length === 0 ||
      myWorkScopes.some((scope) => scope.semanticTargetType !== "user" && !scope.userID)
    ) {
      markMyWorkMatrixCachesStaleForCompany(companyID);
    }
    myWorkDebugLog("home.scheduleMyWorkRefresh", {
      companyID,
      targetUserIDs,
      scopeKinds: myWorkScopes.map((scope) => ({
        eventType: scope.eventType,
        semanticScope: scope.semanticScope,
        semanticTargetType: scope.semanticTargetType,
        semanticTargetID: scope.semanticTargetID,
        userID: scope.userID,
        teamID: scope.teamID,
      })),
      broadCompanyRefresh: myWorkScopes.length === 0 || myWorkScopes.some((scope) => scope.semanticTargetType !== "user" && !scope.userID),
    });
    recordMyWorkDebugCause(myWorkScopes[0]?.eventType ?? (myWorkScopes.length > 0 ? "realtime delta" : "realtime refetch"), {
      companyID,
      targetUserCount: targetUserIDs.length,
      broadCompanyRefresh: myWorkScopes.length === 0 || myWorkScopes.some((scope) => scope.semanticTargetType !== "user" && !scope.userID),
    });
    if (myWorkLiveRefreshTimerRef.current !== null) window.clearTimeout(myWorkLiveRefreshTimerRef.current);
    myWorkLiveRefreshTimerRef.current = window.setTimeout(() => {
      myWorkLiveRefreshTimerRef.current = null;
      myWorkDebugLog("home.fireMyWorkRefreshToken", { companyID, targetUserIDs });
      setMyWorkLiveRefreshToken((value) => value + 1);
    }, 80);
  }, [companyID]);
  const scheduleCurrentUserMyWorkRefresh = useCallback(() => {
    scheduleMyWorkLiveRefresh(currentUserID
      ? [{ kind: "my_work", eventType: "local_mutation", userID: currentUserID }]
      : undefined);
  }, [currentUserID, scheduleMyWorkLiveRefresh]);
  useEffect(() => () => {
    if (myWorkLiveRefreshTimerRef.current !== null) {
      window.clearTimeout(myWorkLiveRefreshTimerRef.current);
      myWorkLiveRefreshTimerRef.current = null;
    }
  }, []);
  useEffect(() => {
    setMailDrafts(readHomeMailDrafts(companyID, currentUserID));
    setEmailSignature(readHomeMailSignature(companyID, currentUserID));
  }, [companyID, currentUserID]);
  const draftMessages = useMemo(() => (
    unreadOnly
      ? []
      : mailDrafts
        .filter((draft) => homeMailDraftMatchesSearch(draft, searchQuery))
        .map(homeMailDraftToMessage)
  ), [mailDrafts, searchQuery, unreadOnly]);
  useEffect(() => {
    setGVICMatrixTargetUserID(currentUserID);
  }, [companyID, currentUserID]);
  useEffect(() => {
    setMatrixAccountFilterIDs((current) => current.filter((accountID) => matrixAccounts.some((account) => account.account_id === accountID)));
  }, [matrixAccounts]);
  useEffect(() => {
    setGVICMatrixViewerListEntries(readGVICMatrixViewerListEntries(companyID, currentUserID));
  }, [companyID, currentUserID]);
  const updateGVICMatrixViewerListEntries = useCallback((entries: GVICMatrixViewerListEntry[]) => {
    setGVICMatrixViewerListEntries(entries);
    storeGVICMatrixViewerListEntries(companyID, currentUserID, entries);
  }, [companyID, currentUserID]);
  useEffect(() => {
    const scopeKey = companyID && currentUserID && activeGVICMatrixUserID ? `${companyID}\u0000${currentUserID}\u0000${activeGVICMatrixUserID}` : "";
    if (GVICMatrixProjectionScopeKeyRef.current === scopeKey) return;
    GVICMatrixProjectionScopeKeyRef.current = scopeKey;
    GVICMatrixProjectionSequenceRef.current = 0;
    GVICMatrixProjectionRefetchInFlightRef.current = false;
    GVICMatrixProjectionRowsRef.current = [];
    GVICMatrixProjectionInitializedRef.current = false;
    GVICMatrixProjectedNodeIDsRef.current = new Set();
    GVICMatrixProjectedLogicGateIDsRef.current = new Set();
  }, [activeGVICMatrixUserID, companyID, currentUserID]);
  const currentUserHasFullSharedInboxAccess = userHasFullSharedInboxAccess(me, companyID);
  const currentUserCanManageSharedInboxStructure = userCanManageSharedInboxStructure(me, companyID);
  const activeSharedInboxFolderID = sharedInboxIDForHomeView(activeViewID);
  const activeSharedTreeViewSelected = activeViewID === "shared-root" || !!activeSharedInboxFolderID;
  const activePersonalMailViewNeedsConnection = activeViewID === "my-triage" || activeViewID === "primary";
  const showPersonalEmailConnectPanel = status?.connected === false
    && activePersonalMailViewNeedsConnection;
  const connection = status?.connection;

  const activeSharedInbox = useMemo(
    () => activeSharedInboxFolderID ? sharedInboxes.find((folder) => folder.folder_id === activeSharedInboxFolderID) ?? null : null,
    [activeSharedInboxFolderID, sharedInboxes],
  );
  const activeSharedInboxIsParent = !!activeSharedInbox && activeSharedInbox.entry_type !== "shared_inbox";
  const activeSharedInboxIsMailbox = !!activeSharedInbox && activeSharedInbox.entry_type === "shared_inbox";
  const activeSharedInboxNeedsEmail = activeSharedInboxIsMailbox && !(activeSharedInbox.account_email ?? "").trim();
  const activeSharedInboxBlocksEmail = !!activeSharedInboxFolderID && (!activeSharedInbox || !activeSharedInboxIsMailbox);
  const activeMailViewUsesSharedConnection = sharedInboxCanLoadMail(activeSharedInbox);
  const activeMailViewHasEmailConnection = activeSharedInboxFolderID
    ? activeMailViewUsesSharedConnection
    : activePersonalMailViewNeedsConnection && status?.connected === true;
  const activeMailAccountEmail = activeViewID === "shared-root"
    ? ""
    : activeSharedInboxFolderID
      ? activeSharedInbox?.account_email ?? ""
      : connection?.account_email ?? "";
  const sharedInboxForHomeView = useCallback((viewID: HomeViewID): CommunicationsSharedInbox | null => {
    const sharedInboxID = sharedInboxIDForHomeView(viewID);
    if (!sharedInboxID) return null;
    return sharedInboxesRef.current.find((folder) => folder.folder_id === sharedInboxID || folder.shared_inbox_id === sharedInboxID) ?? null;
  }, []);
  const canLoadMailForView = useCallback((viewID: HomeViewID): boolean => {
    const sharedInboxID = sharedInboxIDForHomeView(viewID);
    if (sharedInboxID) return sharedInboxCanLoadMail(sharedInboxForHomeView(viewID));
    return (viewID === "my-triage" || viewID === "primary") && status?.connected === true;
  }, [sharedInboxForHomeView, status?.connected]);
  const sharedInboxPermissionsFolder = useMemo(
    () => sharedInboxPermissionsFolderID ? sharedInboxes.find((folder) => folder.folder_id === sharedInboxPermissionsFolderID) ?? null : null,
    [sharedInboxPermissionsFolderID, sharedInboxes],
  );
  const sharedInboxGVICFolder = useMemo(
    () => sharedInboxGVICFolderID ? sharedInboxes.find((folder) => folder.folder_id === sharedInboxGVICFolderID) ?? null : null,
    [sharedInboxGVICFolderID, sharedInboxes],
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
      if (archiveQueueFlushTimerRef.current !== null) {
        window.clearTimeout(archiveQueueFlushTimerRef.current);
        archiveQueueFlushTimerRef.current = null;
      }
      for (const timerID of archivePendingReleaseTimerIDsRef.current) window.clearTimeout(timerID);
      archivePendingReleaseTimerIDsRef.current.clear();
      queuedArchiveBatchesRef.current.clear();
      pendingArchiveMessageKeysRef.current.clear();
      pendingStarredMessageIDsRef.current.clear();
    };
  }, []);
  useEffect(() => {
    selectedMessageIDRef.current = selectedMessageID;
  }, [selectedMessageID]);
  useEffect(() => {
    selectedMessageRef.current = selectedMessage;
  }, [selectedMessage]);
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
    sharedInboxesRef.current = sharedInboxes;
  }, [sharedInboxes]);
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
        for (const timerID of archivePendingReleaseTimerIDsRef.current) window.clearTimeout(timerID);
        archivePendingReleaseTimerIDsRef.current.clear();
        queuedArchiveBatchesRef.current.clear();
        pendingArchiveMessageKeysRef.current.clear();
        setQueuedArchiveEmailCount(0);
        cancelPendingStarredMessages(Array.from(pendingStarredMessageIDsRef.current));
        setMailboxCountOverrides({});
        setFolders([]);
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
  }, [cancelPendingStarredMessages]);
  const handleEmailAccessExpired = useCallback(async (accessError: unknown) => {
    setNotice("");
    if (archiveQueueFlushTimerRef.current !== null) {
      window.clearTimeout(archiveQueueFlushTimerRef.current);
      archiveQueueFlushTimerRef.current = null;
    }
    for (const timerID of archivePendingReleaseTimerIDsRef.current) window.clearTimeout(timerID);
    archivePendingReleaseTimerIDsRef.current.clear();
    queuedArchiveBatchesRef.current.clear();
    pendingArchiveMessageKeysRef.current.clear();
    setQueuedArchiveEmailCount(0);
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
  }, [cancelPendingStarredMessages, loadStatus]);
  const loadFolders = useCallback(async (): Promise<boolean> => {
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    if (sharedInboxID) {
      const sharedInbox = sharedInboxes.find((folder) => folder.folder_id === sharedInboxID) ?? null;
      if (!sharedInbox || sharedInbox.entry_type !== "shared_inbox") {
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
        companyID: sharedInboxID ? companyID : undefined,
        sharedInboxID: sharedInboxID || undefined,
      });
      if (foldersRequestSeqRef.current === requestSeq) setFolders(next);
      return true;
    } catch (folderError) {
      if (foldersRequestSeqRef.current !== requestSeq) return false;
      if (sharedInboxID && (isSharedInboxEmailConnectionError(folderError) || isEmailAccessExpiredError(folderError))) {
        const folder = sharedInboxes.find((item) => item.folder_id === sharedInboxID);
        const accountEmail = folder?.account_email?.trim().toLowerCase() ?? "";
        if (accountEmail) {
          setSharedInboxEmailConnectionDialog({ accountEmail, canConnect: canRepairSharedInboxConnection(sharedInboxID) });
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
  }, [canRepairSharedInboxConnection, companyID, handleEmailAccessExpired, sharedInboxes]);
  const scheduleFolderMetadataRefresh = useCallback(() => {
    markCommunicationsFolderCacheStale();
    if (folderReloadTimerRef.current !== null) window.clearTimeout(folderReloadTimerRef.current);
    folderReloadTimerRef.current = window.setTimeout(() => {
      folderReloadTimerRef.current = null;
      void loadFolders();
    }, 300);
  }, [loadFolders]);
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
    prefetchMessageGenerationRef.current += 1;
    prefetchedMessagePageRef.current = null;
    prefetchMessageTokenRef.current = "";
    prefetchMessageFilterKeyRef.current = "";
    prefetchMessagePromiseRef.current = null;
  }, []);
  const currentMessageFilterKey = useCallback(() => (
    messageListFilterKey(companyID, activeViewIDRef.current, mailboxRef.current, searchQueryRef.current, unreadOnlyRef.current)
  ), [companyID]);
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
    if (messageListRefreshTimerRef.current !== null) {
      window.clearTimeout(messageListRefreshTimerRef.current);
      messageListRefreshTimerRef.current = null;
    }
    clearPrefetchedMessagePage();
  }, [clearPrefetchedMessagePage, currentMessageFilterKey]);
  const messageListWithinPrefetchDistance = useCallback(() => {
    const list = messageListRef.current;
    if (!list) return false;
    const remaining = messageListRemainingDistance(list);
    return remaining < Math.max(800, list.clientHeight * 2);
  }, []);
  const clearMailListState = useCallback(() => {
    setLoadedMessageListKey("");
    setMessages([]);
    setSelectedMessage(null);
    setSelectedMessageID("");
    setSelectedMessageIDs(new Set());
    setSelectionAnchorMessageID("");
    setNextPageToken("");
    messageRequestKeyRef.current = "";
    clearPrefetchedMessagePage();
  }, [clearPrefetchedMessagePage]);
  const loadMessages = useCallback(async (options: LoadMessagesOptions = {}) => {
    if (!canLoadMailForView(activeViewID)) {
      clearMailListState();
      return;
    }
    if (isInboxMatrixViewID(activeViewID) || activeViewID === "my-work" || activeViewID === "updates") {
      clearMailListState();
      return;
    }
    const requestKey = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly);
    messageListFilterKeyRef.current = requestKey;
    if (mailbox === "drafts") {
      messageRequestKeyRef.current = "";
      setLoadedMessageListKey(requestKey);
      clearPrefetchedMessagePage();
      setLoadingMessages(false);
      setNextPageToken("");
      setMessages(draftMessages);
      const currentSelectedMessageID = selectedMessageIDRef.current;
      const currentSelectionStillVisible = !!currentSelectedMessageID && draftMessages.some((message) => message.id === currentSelectedMessageID);
      if (!currentSelectionStillVisible && currentSelectedMessageID) {
        setSelectedMessageID("");
        setSelectedMessage(null);
        setSelectedMessageIDs(new Set());
        setSelectionAnchorMessageID("");
      }
      return;
    }
    if (activeSharedInboxNeedsEmail || activeSharedInboxBlocksEmail) {
      messageListFilterKeyRef.current = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly);
      clearMailListState();
      return;
    }
    if (localTriageConversionMailNetworkIsSuppressed(requestKey)) return;
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
        if (activeSharedInboxFolderID && activeSharedInbox?.account_email && (isSharedInboxEmailConnectionError(messageError) || isEmailAccessExpiredError(messageError))) {
          setSharedInboxEmailConnectionDialog({ accountEmail: activeSharedInbox.account_email.trim().toLowerCase(), canConnect: canRepairSharedInboxConnection(activeSharedInboxFolderID) });
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
          pendingMessageReloadRef.current = false;
          pendingMessageRefreshRef.current = false;
          window.setTimeout(() => { void loadMessages({ refresh }); }, 0);
        }
      }
    }
  }, [activeSharedInbox, activeSharedInboxBlocksEmail, activeSharedInboxFolderID, activeSharedInboxNeedsEmail, activeViewID, canLoadMailForView, canRepairSharedInboxConnection, clearMailListState, clearPrefetchedMessagePage, companyID, draftMessages, handleEmailAccessExpired, localTriageConversionMailNetworkIsSuppressed, mailbox, searchQuery, unreadOnly]);
  useEffect(() => {
    const sharedInboxID = pendingSharedInboxMessageRefreshID.trim();
    if (!sharedInboxID) return;
    if (sharedInboxIDForHomeView(activeViewID) !== sharedInboxID || mailbox !== "primary") return;
    const folder = sharedInboxes.find((item) => item.folder_id === sharedInboxID || item.shared_inbox_id === sharedInboxID);
    if (!folder || folder.entry_type !== "shared_inbox" || !(folder.account_email ?? "").trim()) return;
    setPendingSharedInboxMessageRefreshID("");
    invalidateCommunicationsCache({ folders: true, messagePages: true, messages: true });
    void loadFolders();
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
      for (const message of page.messages ?? []) {
        if (!message.id || seen.has(message.id)) continue;
        seen.add(message.id);
        next.push(message);
      }
      return sortEmailMessagesByDateDescending(next);
    });
    setNextPageToken(page.next_page_token ?? "");
    return page.next_page_token ?? "";
  }, [consumePrefetchedMessagePage]);
  const prefetchNextMessagePage = useCallback(async (explicitPageToken?: string) => {
    if (!canLoadMailForView(activeViewIDRef.current) || mailboxRef.current === "drafts" || isInboxMatrixViewID(activeViewIDRef.current) || activeViewIDRef.current === "my-work" || activeViewIDRef.current === "updates" || loadingMessagesRef.current) return;
    const pageToken = (explicitPageToken ?? nextPageTokenRef.current).trim();
    if (!pageToken) return;
    const filterKey = currentMessageFilterKey();
    if (localTriageConversionMailNetworkIsSuppressed(filterKey)) return;
    const prefetched = prefetchedMessagePageRef.current;
    if (prefetched?.filterKey === filterKey && prefetched.pageToken === pageToken) return;
    if (prefetchMessagePromiseRef.current && prefetchMessageFilterKeyRef.current === filterKey && prefetchMessageTokenRef.current === pageToken) return;
    const requestGeneration = prefetchMessageGenerationRef.current;
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
        if (prefetchMessageGenerationRef.current !== requestGeneration) return;
        if (localTriageConversionMailNetworkIsSuppressed(filterKey)) return;
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
  }, [canLoadMailForView, companyID, currentMessageFilterKey, handleEmailAccessExpired, localTriageConversionMailNetworkIsSuppressed]);
  const loadMoreMessages = useCallback(async () => {
    if (!canLoadMailForView(activeViewIDRef.current) || mailboxRef.current === "drafts" || isInboxMatrixViewID(activeViewIDRef.current) || activeViewIDRef.current === "my-work" || activeViewIDRef.current === "updates" || loadingMessagesRef.current || loadingMoreMessagesRef.current) return;
    if (isPrimaryTriageMailbox(activeViewIDRef.current, mailboxRef.current)) return;
    const pageToken = nextPageTokenRef.current.trim();
    if (!pageToken) return;
    const filterKey = currentMessageFilterKey();
    if (localTriageConversionMailNetworkIsSuppressed(filterKey)) return;
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
      if (activeSharedInboxFolderID && activeSharedInbox?.account_email && (isSharedInboxEmailConnectionError(messageError) || isEmailAccessExpiredError(messageError))) {
        setSharedInboxEmailConnectionDialog({ accountEmail: activeSharedInbox.account_email.trim().toLowerCase(), canConnect: canRepairSharedInboxConnection(activeSharedInboxFolderID) });
        return;
      }
      if (isEmailAccessExpiredError(messageError)) {
        await handleEmailAccessExpired(messageError);
        return;
      }
      setError(formatError(messageError, "Failed to load messages"));
    } finally {
      setLoadingMoreMessages(false);
    }
  }, [activeSharedInbox, activeSharedInboxFolderID, appendPrefetchedMessagePage, canLoadMailForView, canRepairSharedInboxConnection, companyID, currentMessageFilterKey, handleEmailAccessExpired, localTriageConversionMailNetworkIsSuppressed, messageListWithinPrefetchDistance, prefetchNextMessagePage]);
  const replaceVisibleMessagesForAdvance = useCallback((page: MessagePage) => {
    const pageMessages = page.messages ?? [];
    const firstMessage = pageMessages[0] ?? null;
    messagesRef.current = pageMessages;
    nextPageTokenRef.current = page.next_page_token ?? "";
    selectedMessageIDRef.current = firstMessage?.id ?? "";
    selectedMessageRef.current = firstMessage;
    setMessages(pageMessages);
    setNextPageToken(page.next_page_token ?? "");
    setSelectedMessageIDs(firstMessage ? new Set([firstMessage.id]) : new Set());
    setSelectionAnchorMessageID(firstMessage?.id ?? "");
    setSelectedMessageID(firstMessage?.id ?? "");
    setSelectedMessage(firstMessage);
    setMessageContextMenu(null);
    window.setTimeout(() => {
      messageListRef.current?.scrollTo({ top: 0 });
    }, 0);
  }, []);
  useEffect(() => {
    loadMessagesRef.current = loadMessages;
  }, [loadMessages]);
  const scheduleMessageListRefresh = useCallback((delayMs = MESSAGE_EVENT_REFRESH_DELAY_MS, options?: { refresh?: boolean }) => {
    if (messageListRefreshTimerRef.current !== null) window.clearTimeout(messageListRefreshTimerRef.current);
    const refresh = options?.refresh === true;
    messageListRefreshTimerRef.current = window.setTimeout(() => {
      messageListRefreshTimerRef.current = null;
      if (!canLoadMailForView(activeViewIDRef.current) || isInboxMatrixViewID(activeViewIDRef.current) || activeViewIDRef.current === "my-work" || activeViewIDRef.current === "updates") return;
      if (localTriageConversionMailNetworkIsSuppressed(currentMessageFilterKey())) return;
      void loadMessagesRef.current?.({ refresh });
    }, delayMs);
  }, [canLoadMailForView, currentMessageFilterKey, localTriageConversionMailNetworkIsSuppressed]);
  const localTriageConversionMessageKey = useCallback((sharedInboxID: string | undefined, messageID: string) => (
    `${sharedInboxID?.trim() ?? ""}\x1f${messageID.trim()}`
  ), []);
  const rememberLocallyAppliedTriageConversion = useCallback((messageIDs: string[], options: {
    sharedInboxID?: string;
    nodeIDs?: string[];
    boardIDs?: string[];
    cardIDs?: string[];
    logicGateIDs?: string[];
  } = {}) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    const sharedInboxID = options.sharedInboxID?.trim() ?? "";
    const expiresAt = Date.now() + LOCAL_TRIAGE_CONVERSION_ECHO_TTL_MS;
    for (const messageID of ids) {
      locallyAppliedTriageConversionIDsRef.current.set(localTriageConversionMessageKey(sharedInboxID, messageID), expiresAt);
      if (sharedInboxID) locallyAppliedTriageConversionIDsRef.current.set(localTriageConversionMessageKey("", messageID), expiresAt);
    }
    const nodeIDs = cleanIDList(options.nodeIDs ?? []);
    const boardIDs = cleanIDList(options.boardIDs ?? []);
    const cardIDs = cleanIDList(options.cardIDs ?? []);
    const logicGateIDs = cleanIDList(options.logicGateIDs ?? []);
    if (nodeIDs.length === 0 && boardIDs.length === 0 && cardIDs.length === 0 && logicGateIDs.length === 0) return;
    locallyAppliedTriageConversionWorkspaceEchoesRef.current = [
      ...locallyAppliedTriageConversionWorkspaceEchoesRef.current.filter((echo) => echo.expiresAt > Date.now()),
      {
        expiresAt,
        sharedInboxID,
        messageIDs: new Set(ids),
        nodeIDs: new Set(nodeIDs),
        boardIDs: new Set(boardIDs),
        cardIDs: new Set(cardIDs),
        logicGateIDs: new Set(logicGateIDs),
      },
    ];
  }, [localTriageConversionMessageKey]);
  const triageConversionWasAppliedLocally = useCallback((streamMessageID: string, sharedInboxID?: string): boolean => {
    const ids = triageMessageIDsFromStreamMessageID(streamMessageID);
    if (ids.length === 0) return false;
    const now = Date.now();
    const cleanSharedInboxID = sharedInboxID?.trim() ?? "";
    let allHandled = true;
    for (const messageID of ids) {
      const key = localTriageConversionMessageKey(cleanSharedInboxID, messageID);
      const expiresAt = locallyAppliedTriageConversionIDsRef.current.get(key) ?? 0;
      if (expiresAt <= now) {
        locallyAppliedTriageConversionIDsRef.current.delete(key);
        allHandled = false;
      }
    }
    return allHandled;
  }, [localTriageConversionMessageKey]);
  const triageConversionWorkspaceEventWasAppliedLocally = useCallback((type: string, data: Record<string, unknown>): boolean => {
    if (!LOCAL_TRIAGE_CONVERSION_WORKSPACE_EVENT_TYPES.has(type)) return false;
    const now = Date.now();
    locallyAppliedTriageConversionWorkspaceEchoesRef.current = locallyAppliedTriageConversionWorkspaceEchoesRef.current.filter((echo) => echo.expiresAt > now);
    if (locallyAppliedTriageConversionWorkspaceEchoesRef.current.length === 0) return false;
    const messageID = workspaceEventValue(data, "message_id");
    const nodeID = workspaceEventValue(data, "node_id", "node");
    const boardID = workspaceEventValue(data, "board_id", "card") || workspaceEventValue(data, "compatibility_board_id");
    const cardID = workspaceEventValue(data, "card_id", "card") || workspaceEventValue(data, "compatibility_card_id");
    const logicGateID = workspaceEventValue(data, "logic_gate_id", "card") || workspaceEventValue(data, "logic_gate_id", "logic_gate");
    const itemID = workspaceEventValue(data, "item_id", "folder_item");
    const targetID = workspaceEventValue(data, "target_id", "entity");
    return locallyAppliedTriageConversionWorkspaceEchoesRef.current.some((echo) => (
      (!!messageID && echo.messageIDs.has(messageID)) ||
      (!!nodeID && echo.nodeIDs.has(nodeID)) ||
      (!!itemID && echo.nodeIDs.has(itemID)) ||
      (!!targetID && echo.nodeIDs.has(targetID)) ||
      (!!boardID && echo.boardIDs.has(boardID)) ||
      (!!cardID && echo.cardIDs.has(cardID)) ||
      (!!logicGateID && echo.logicGateIDs.has(logicGateID))
    ));
  }, []);
  const locallyArchivedMessageKey = useCallback((nextCompanyID: string, sharedInboxID: string | undefined, messageID: string) => (
    `${nextCompanyID.trim()}\x1f${sharedInboxID?.trim() ?? ""}\x1f${messageID.trim()}`
  ), []);
  const rememberLocallyArchivedMessages = useCallback((nextCompanyID: string, sharedInboxID: string | undefined, messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    const expiresAt = Date.now() + 120_000;
    for (const messageID of ids) {
      locallyArchivedMessageKeysRef.current.set(locallyArchivedMessageKey(nextCompanyID, sharedInboxID, messageID), expiresAt);
    }
  }, [locallyArchivedMessageKey]);
  const archiveUpdateWasAppliedLocally = useCallback((messageID: string, sharedInboxID: string | undefined): boolean => {
    const cleanMessageID = messageID.trim();
    if (!cleanMessageID) return false;
    const key = locallyArchivedMessageKey(companyID, sharedInboxID, cleanMessageID);
    const expiresAt = locallyArchivedMessageKeysRef.current.get(key) ?? 0;
    if (expiresAt <= Date.now()) {
      locallyArchivedMessageKeysRef.current.delete(key);
      return false;
    }
    locallyArchivedMessageKeysRef.current.delete(key);
    return true;
  }, [companyID, locallyArchivedMessageKey]);
  const locallyStarMutationMessageKey = useCallback((nextCompanyID: string, sharedInboxID: string | undefined, messageID: string) => (
    `${nextCompanyID.trim()}\x1f${sharedInboxID?.trim() ?? ""}\x1f${messageID.trim()}`
  ), []);
  const rememberLocallyStarMutatedMessages = useCallback((nextCompanyID: string, sharedInboxID: string | undefined, messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    const expiresAt = Date.now() + 120_000;
    for (const messageID of ids) {
      locallyStarMutatedMessageKeysRef.current.set(locallyStarMutationMessageKey(nextCompanyID, sharedInboxID, messageID), expiresAt);
    }
  }, [locallyStarMutationMessageKey]);
  const starUpdateWasAppliedLocally = useCallback((messageID: string, sharedInboxID: string | undefined, options?: { consume?: boolean }): boolean => {
    const cleanMessageID = messageID.trim();
    if (!cleanMessageID) return false;
    const key = locallyStarMutationMessageKey(companyID, sharedInboxID, cleanMessageID);
    const expiresAt = locallyStarMutatedMessageKeysRef.current.get(key) ?? 0;
    if (expiresAt <= Date.now()) {
      locallyStarMutatedMessageKeysRef.current.delete(key);
      return false;
    }
    if (options?.consume !== false) locallyStarMutatedMessageKeysRef.current.delete(key);
    return true;
  }, [companyID, locallyStarMutationMessageKey]);
  const archiveQueueBatchKey = useCallback((nextCompanyID: string, sharedInboxID?: string) => (
    `${nextCompanyID.trim()}\x1f${sharedInboxID?.trim() ?? ""}`
  ), []);
  const archiveQueueMessageKey = useCallback((nextCompanyID: string, sharedInboxID: string | undefined, messageID: string) => (
    `${archiveQueueBatchKey(nextCompanyID, sharedInboxID)}\x1f${messageID.trim()}`
  ), [archiveQueueBatchKey]);
  const syncQueuedArchiveEmailCount = useCallback(() => {
    setQueuedArchiveEmailCount(pendingArchiveMessageKeysRef.current.size);
  }, []);
  const forgetPendingArchiveMessages = useCallback((args: { companyID: string; sharedInboxID?: string; messageIDs: string[] }) => {
    const sharedInboxID = args.sharedInboxID?.trim() || undefined;
    let changed = false;
    for (const messageID of cleanIDList(args.messageIDs)) {
      changed = pendingArchiveMessageKeysRef.current.delete(archiveQueueMessageKey(args.companyID, sharedInboxID, messageID)) || changed;
    }
    if (changed) syncQueuedArchiveEmailCount();
  }, [archiveQueueMessageKey, syncQueuedArchiveEmailCount]);
  const releasePendingArchiveMessagesLater = useCallback((batch: QueuedArchiveBatch) => {
    const timerID = window.setTimeout(() => {
      archivePendingReleaseTimerIDsRef.current.delete(timerID);
      forgetPendingArchiveMessages(batch);
    }, ARCHIVE_BACKGROUND_CONFIRMATION_TIMEOUT_MS);
    archivePendingReleaseTimerIDsRef.current.add(timerID);
  }, [forgetPendingArchiveMessages]);
  const archiveQueueCanAccept = useCallback((messageIDs: string[], nextCompanyID: string, sharedInboxID?: string) => {
    const pending = pendingArchiveMessageKeysRef.current;
    let newCount = 0;
    for (const messageID of cleanIDList(messageIDs)) {
      if (!pending.has(archiveQueueMessageKey(nextCompanyID, sharedInboxID, messageID))) newCount++;
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
      void archiveHomeMailMessagesCommand({
        companyID: batch.companyID,
        sharedInboxID: batch.sharedInboxID,
        messageIDs: batch.messageIDs,
      })
        .then((result) => {
          keepPendingUntilConfirmation = result?.accepted === true;
          if (keepPendingUntilConfirmation) releasePendingArchiveMessagesLater(batch);
          const failed = result?.failed ?? [];
          if (failed.length > 0) {
            setError(failed.length === 1 ? "Failed to archive 1 message." : `Failed to archive ${failed.length} messages.`);
            scheduleMessageListRefresh(0);
          }
        })
        .catch((archiveError) => {
          if (isEmailAccessExpiredError(archiveError)) {
            void handleEmailAccessExpired(archiveError);
            return;
          }
          setError(formatError(archiveError, "Failed to archive queued messages"));
          scheduleMessageListRefresh(0);
        })
        .finally(() => {
          if (!keepPendingUntilConfirmation) forgetPendingArchiveMessages(batch);
          if (!keepPendingUntilConfirmation) scheduleFolderMetadataRefresh();
        });
    }
  }, [forgetPendingArchiveMessages, handleEmailAccessExpired, releasePendingArchiveMessagesLater, scheduleFolderMetadataRefresh, scheduleMessageListRefresh]);
  const queueArchiveMessages = useCallback((args: { companyID: string; sharedInboxID?: string; messageIDs: string[] }): string[] => {
    const messageIDs = cleanIDList(args.messageIDs);
    if (messageIDs.length === 0) return [];
    const sharedInboxID = args.sharedInboxID?.trim() || undefined;
    const batchKey = archiveQueueBatchKey(args.companyID, sharedInboxID);
    const batch = queuedArchiveBatchesRef.current.get(batchKey) ?? { companyID: args.companyID, sharedInboxID, messageIDs: [] };
    const queuedIDs: string[] = [];
    for (const messageID of messageIDs) {
      const messageKey = archiveQueueMessageKey(args.companyID, sharedInboxID, messageID);
      if (pendingArchiveMessageKeysRef.current.has(messageKey)) continue;
      pendingArchiveMessageKeysRef.current.add(messageKey);
      batch.messageIDs.push(messageID);
      queuedIDs.push(messageID);
    }
    if (batch.messageIDs.length > 0) queuedArchiveBatchesRef.current.set(batchKey, batch);
    if (queuedIDs.length === 0) return [];
    rememberLocallyArchivedMessages(args.companyID, sharedInboxID, queuedIDs);
    syncQueuedArchiveEmailCount();
    if (archiveQueueFlushTimerRef.current === null) {
      archiveQueueFlushTimerRef.current = window.setTimeout(() => {
        archiveQueueFlushTimerRef.current = null;
        flushQueuedArchiveMessages();
      }, 0);
    }
    return queuedIDs;
  }, [archiveQueueBatchKey, archiveQueueMessageKey, flushQueuedArchiveMessages, rememberLocallyArchivedMessages, syncQueuedArchiveEmailCount]);
  const advanceTriageMailPage = useCallback(async () => {
    if (!canMutateCurrentMailView || !activeMailViewHasEmailConnection || loadingMessagesRef.current || loadingMoreMessagesRef.current || busy) return;
    if (!isPrimaryTriageMailbox(activeViewIDRef.current, mailboxRef.current)) return;
    const previousMessageIDs = cleanIDList(messagesRef.current.map((message) => message.id));
    if (previousMessageIDs.length === 0) return;
    const countKey = mailCountKey(companyID, activeViewIDRef.current);
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current) || undefined;
    if (!archiveQueueCanAccept(previousMessageIDs, companyID, sharedInboxID)) return;
    const pageToken = nextPageTokenRef.current.trim();
    const filterKey = currentMessageFilterKey();
    let displayedNextPage = false;
    setError("");
    setNotice("");
    try {
      let nextPage: MessagePage = { messages: [], next_page_token: "" };
      if (pageToken) {
        let nextPageLoaded = false;
        const prefetchedPage = consumePrefetchedMessagePage(filterKey, pageToken);
        if (prefetchedPage) {
          nextPage = prefetchedPage;
          nextPageLoaded = true;
        }
        if (!nextPageLoaded && prefetchMessagePromiseRef.current && prefetchMessageFilterKeyRef.current === filterKey && prefetchMessageTokenRef.current === pageToken) {
          setLoadingMoreMessages(true);
          await prefetchMessagePromiseRef.current;
          const awaitedPrefetchedPage = consumePrefetchedMessagePage(filterKey, pageToken);
          if (awaitedPrefetchedPage) {
            nextPage = awaitedPrefetchedPage;
            nextPageLoaded = true;
          }
        }
        if (!nextPageLoaded) {
          setLoadingMoreMessages(true);
          nextPage = await listEmailMessages({
            limit: MESSAGE_BATCH_SIZE,
            pageToken,
            mailbox: mailboxRef.current,
            companyID,
            sharedInboxID,
            q: searchQueryRef.current,
            unread: unreadOnlyRef.current ? true : undefined,
          });
        }
        if (messageListFilterKeyRef.current !== filterKey || nextPageTokenRef.current !== pageToken || !isPrimaryTriageMailbox(activeViewIDRef.current, mailboxRef.current)) return;
      }
      replaceVisibleMessagesForAdvance(nextPage);
      displayedNextPage = true;
      const nextToken = nextPage.next_page_token ?? "";
      if (nextToken) {
        window.setTimeout(() => {
          void prefetchNextMessagePage(nextToken);
        }, 0);
      }
      const queuedIDs = queueArchiveMessages({ companyID, sharedInboxID, messageIDs: previousMessageIDs });
      adjustPrimaryMailboxCount(countKey, -queuedIDs.length);
    } catch (advanceError) {
      if (isEmailAccessExpiredError(advanceError)) {
        await handleEmailAccessExpired(advanceError);
        return;
      }
      setError(formatError(advanceError, displayedNextPage ? "Failed to archive page" : "Failed to load next page"));
      if (displayedNextPage) scheduleMessageListRefresh(0);
    } finally {
      setLoadingMoreMessages(false);
    }
  }, [activeMailViewHasEmailConnection, adjustPrimaryMailboxCount, archiveQueueCanAccept, busy, canMutateCurrentMailView, companyID, consumePrefetchedMessagePage, currentMessageFilterKey, handleEmailAccessExpired, prefetchNextMessagePage, queueArchiveMessages, replaceVisibleMessagesForAdvance, scheduleMessageListRefresh]);
  const fillMessageListAfterRemoval = useCallback(() => {
    window.setTimeout(() => {
      const list = messageListRef.current;
      if (!list || !nextPageTokenRef.current) return;
      if (!canLoadMailForView(activeViewIDRef.current)) return;
      if (localTriageConversionMailNetworkIsSuppressed(currentMessageFilterKey())) return;
      if (isPrimaryTriageMailbox(activeViewIDRef.current, mailboxRef.current)) {
        void prefetchNextMessagePage();
        return;
      }
      if (messageListWithinPrefetchDistance()) void prefetchNextMessagePage();
      if (messageListContentScrollHeight(list) <= list.clientHeight + 160) void loadMoreMessages();
    }, 0);
  }, [canLoadMailForView, currentMessageFilterKey, loadMoreMessages, localTriageConversionMailNetworkIsSuppressed, messageListWithinPrefetchDistance, prefetchNextMessagePage]);
  const removeMessagesFromVisibleMailList = useCallback((messageIDs: string[], options?: { fillAfterRemoval?: boolean; preserveScrollAnchor?: boolean; suppressAutoNetwork?: boolean }) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    if (options?.suppressAutoNetwork) suppressLocalTriageConversionMailNetwork();
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
    if (options?.fillAfterRemoval !== false) fillMessageListAfterRemoval();
  }, [fillMessageListAfterRemoval, suppressLocalTriageConversionMailNetwork]);
  const reconcileConvertedMessageUnstars = useCallback((messageIDs: string[], sharedInboxID: string, options?: { updateVisibleList?: boolean }) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    rememberLocallyStarMutatedMessages(companyID, sharedInboxID.trim() || undefined, ids);
    if (options?.updateVisibleList === false) return;
    const idSet = new Set(ids);
    const visibleStarredCount = messagesRef.current.reduce((count, message) => count + (idSet.has(message.id) && message.starred ? 1 : 0), 0);
    if (visibleStarredCount > 0) adjustStarredMailboxCount(mailCountKey(companyID, activeViewIDRef.current), -visibleStarredCount);
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
  }, [adjustStarredMailboxCount, companyID, rememberLocallyStarMutatedMessages]);
  useEffect(() => {
    return () => {
      if (messageListRefreshTimerRef.current !== null) {
        window.clearTimeout(messageListRefreshTimerRef.current);
        messageListRefreshTimerRef.current = null;
      }
    };
  }, []);
  useEffect(() => { void loadStatus({ clearError: !preserveInitialOAuthError }); }, [loadStatus, preserveInitialOAuthError]);
  useEffect(() => { if (activeMailViewHasEmailConnection && isArchivableHomeViewID(activeViewID)) void loadFolders(); }, [activeMailViewHasEmailConnection, activeViewID, loadFolders]);
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
      rememberLocallyAppliedTriageConversion(messageIDs, {
        sharedInboxID,
        nodeIDs: detail.nodeIDs,
        boardIDs: detail.boardIDs,
        cardIDs: detail.cardIDs,
        logicGateIDs: detail.logicGateID ? [detail.logicGateID] : undefined,
      });
      const conversionSucceeded = Boolean(
        detail.logicGateID?.trim()
        || (detail.nodeIDs ?? []).some((id) => id.trim())
        || (detail.boardIDs ?? []).some((id) => id.trim())
        || (detail.cardIDs ?? []).some((id) => id.trim())
      );
      if (!conversionSucceeded) return;
      const unstarredMessageIDs = cleanIDList(detail.unstarredMessageIDs ?? []);
      reconcileConvertedMessageUnstars(unstarredMessageIDs, sharedInboxID, {
        updateVisibleList: sharedInboxID === sharedInboxIDForHomeView(activeViewIDRef.current),
      });
      for (const messageID of messageIDs) removeEmailMessageFromCache(messageID);
      if (sharedInboxID !== sharedInboxIDForHomeView(activeViewIDRef.current)) return;
      removeMessagesFromVisibleMailList(messageIDs, { preserveScrollAnchor: true, fillAfterRemoval: false, suppressAutoNetwork: true });
    };
    window.addEventListener(EVENT_HOME_TRIAGE_CONVERSION_APPLIED, onTriageConversionApplied);
    return () => window.removeEventListener(EVENT_HOME_TRIAGE_CONVERSION_APPLIED, onTriageConversionApplied);
  }, [companyID, reconcileConvertedMessageUnstars, rememberLocallyAppliedTriageConversion, removeMessagesFromVisibleMailList]);
  useEffect(() => { void loadMessages({ refresh: true }); }, [loadMessages]);
  useEffect(() => {
    setNodeEditorOverlay(null);
  }, [companyID]);
  useEffect(() => {
    const loadedListKey = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly);
    if (loadedMessageListKey !== loadedListKey) return;
    if (!nextPageToken || loadingMessages || loadingMoreMessages) return;
    if (localTriageConversionMailNetworkIsSuppressed(loadedListKey)) return;
    if (isPrimaryTriageMailbox(activeViewID, mailbox)) {
      void prefetchNextMessagePage(nextPageToken);
      return;
    }
    const list = messageListRef.current;
    if (!list) return;
    if (messageListWithinPrefetchDistance()) void prefetchNextMessagePage();
    if (messageListContentScrollHeight(list) <= list.clientHeight + 120) void loadMoreMessages();
  }, [activeViewID, companyID, loadMoreMessages, loadedMessageListKey, loadingMessages, loadingMoreMessages, localTriageConversionMailNetworkIsSuppressed, mailbox, messageListWithinPrefetchDistance, messages.length, nextPageToken, prefetchNextMessagePage, searchQuery, unreadOnly]);
  useEffect(() => {
    if (!activeMailViewHasEmailConnection) return undefined;
    const currentMessageListParams = () => ({
      limit: MESSAGE_BATCH_SIZE,
      mailbox: mailboxRef.current,
      companyID,
      sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
      q: searchQueryRef.current,
      unread: unreadOnlyRef.current ? true : undefined,
    });
    const scheduleFolderRefresh = (options?: { preserveInflight?: boolean }) => {
      if (options?.preserveInflight) markCommunicationsFolderCacheStale();
      else invalidateCommunicationsFolderCache();
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
        if (!canLoadMailForView(activeViewIDRef.current)) return;
        let envelope: CommunicationsStreamEnvelope;
        try {
          envelope = JSON.parse(event.data) as CommunicationsStreamEnvelope;
        } catch {
          return;
        }
        const trigger = envelope.trigger?.trim().toLowerCase() ?? "";
        const messageID = envelope.message_id?.trim() ?? "";
        const eventAction = envelope.action?.trim().toLowerCase() ?? "";
        const eventSharedInboxID = envelope.shared_inbox_id?.trim() ?? "";
        const archiveConfirmation = communicationStreamEventIsArchiveConfirmation({ trigger, action: eventAction });
        const starConfirmation = communicationStreamEventIsStarConfirmation({ trigger, action: eventAction });
        if (trigger.startsWith("triage.")) {
          const activeSharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
          const conversionTargetsCurrentMailbox = eventSharedInboxID ? eventSharedInboxID === activeSharedInboxID : activeSharedInboxID === "";
          if (trigger.startsWith("triage.converted") && triageConversionWasAppliedLocally(messageID, eventSharedInboxID || undefined)) return;
          if (trigger.startsWith("triage.converted") && conversionTargetsCurrentMailbox && isTriageMailViewID(activeViewIDRef.current)) {
            const converted = triageMessageIDsFromStreamMessageID(messageID);
            if (converted.length > 0) removeMessagesFromVisibleMailList(converted, { preserveScrollAnchor: true });
          }
          return;
        }
        if (trigger.startsWith("folder.")) {
          scheduleFolderRefresh();
          return;
        }
        if (!trigger.startsWith("message.")) return;
        if (!messageID) return;
        const activeSharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
        const archiveTargetsCurrentMailbox = eventSharedInboxID ? eventSharedInboxID === activeSharedInboxID : activeSharedInboxID === "";
        const localArchiveConfirmation = archiveUpdateWasAppliedLocally(messageID, eventSharedInboxID || undefined);
        if (archiveConfirmation || (trigger.startsWith("message.updated") && localArchiveConfirmation)) {
          forgetPendingArchiveMessages({ companyID, sharedInboxID: eventSharedInboxID || undefined, messageIDs: [messageID] });
          invalidateEmailMessageCache(messageID);
          if (localArchiveConfirmation) return;
          scheduleFolderRefresh({ preserveInflight: true });
          if (!archiveTargetsCurrentMailbox) return;
          const visible = messagesRef.current.some((message) => message.id === messageID);
          const selected = selectedMessageIDRef.current === messageID;
          const selectedLocalReply = selectedMessageRef.current?.local_replies?.some((reply) => reply.id === messageID) ?? false;
          if (visible && isPrimaryTriageMailbox(activeViewIDRef.current, mailboxRef.current)) {
            removeMessagesFromVisibleMailList([messageID], { preserveScrollAnchor: true });
            return;
          }
          if (!visible && !selected && !selectedLocalReply) return;
          void getEmailMessage(messageID, companyID, activeSharedInboxID)
            .then((message) => {
              primeEmailMessageCache(message);
              reconcileLocalEmailReply(message);
              setSelectedMessage((current) => current ? reconcileEmailMessageLocalReply(current, message) : current);
              applyMessageToCurrentView(message, false);
            })
            .catch((messageError) => {
              if (isEmailAccessExpiredError(messageError)) {
                void handleEmailAccessExpired(messageError);
              }
            });
          return;
        }
        const localStarSharedInboxID = eventSharedInboxID || activeSharedInboxID || undefined;
        const localGenericStarUpdate = trigger.startsWith("message.updated") && starUpdateWasAppliedLocally(messageID, localStarSharedInboxID);
        if (starConfirmation || localGenericStarUpdate) {
          scheduleFolderRefresh({ preserveInflight: true });
          invalidateEmailMessageCache(messageID);
          const starTargetsCurrentMailbox = eventSharedInboxID ? eventSharedInboxID === activeSharedInboxID : true;
          if (!starTargetsCurrentMailbox) return;
          const visible = messagesRef.current.some((message) => message.id === messageID);
          const selected = selectedMessageIDRef.current === messageID;
          const selectedLocalReply = selectedMessageRef.current?.local_replies?.some((reply) => reply.id === messageID) ?? false;
          const localStarConfirmation = localGenericStarUpdate || starUpdateWasAppliedLocally(messageID, localStarSharedInboxID, { consume: false });
          if (!visible && !selected && !selectedLocalReply) {
            if (!localStarConfirmation && trigger.startsWith("message.starred") && mailboxRef.current === "starred") {
              void getEmailMessage(messageID, companyID, activeSharedInboxID)
                .then((message) => {
                  primeEmailMessageCache(message);
                  reconcileLocalEmailReply(message);
                  applyMessageToCurrentView(message, true);
                })
                .catch((messageError) => {
                  if (isEmailAccessExpiredError(messageError)) {
                    void handleEmailAccessExpired(messageError);
                  }
                });
            }
            return;
          }
          void getEmailMessage(messageID, companyID, activeSharedInboxID)
            .then((message) => {
              primeEmailMessageCache(message);
              reconcileLocalEmailReply(message);
              setSelectedMessage((current) => current ? reconcileEmailMessageLocalReply(current, message) : current);
              applyMessageToCurrentView(message, false);
            })
            .catch((messageError) => {
              if (isEmailAccessExpiredError(messageError)) {
                void handleEmailAccessExpired(messageError);
              }
            });
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
        const selectedLocalReply = selectedMessageRef.current?.local_replies?.some((reply) => reply.id === messageID) ?? false;
        const shouldFetchCreated = trigger.startsWith("message.created") && emailMessageMatchesListFilters({
          id: messageID,
          subject: "",
          unread: true,
          starred: false,
        }, params);
        if (!visible && !selected && !selectedLocalReply && !shouldFetchCreated) return;
        void getEmailMessage(messageID, companyID, sharedInboxIDForHomeView(activeViewIDRef.current))
          .then((message) => {
            primeEmailMessageCache(message);
            reconcileLocalEmailReply(message);
            setSelectedMessage((current) => current ? reconcileEmailMessageLocalReply(current, message) : current);
            applyMessageToCurrentView(message, trigger.startsWith("message.created"));
          })
          .catch((messageError) => {
            if (isEmailAccessExpiredError(messageError)) {
              void handleEmailAccessExpired(messageError);
              return;
            }
            if (trigger.startsWith("message.deleted")) removeEmailMessageFromCache(messageID);
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
  }, [activeMailViewHasEmailConnection, apiBase, archiveUpdateWasAppliedLocally, canLoadMailForView, companyID, forgetPendingArchiveMessages, handleEmailAccessExpired, loadFolders, removeMessagesFromVisibleMailList, starUpdateWasAppliedLocally, triageConversionWasAppliedLocally]);
  useEffect(() => {
    if (!companyID || !currentUserID) return undefined;
    const unsubscribe = subscribeWorkspaceRealtime(apiBase, companyID, workspaceRealtimeScope(currentUserID), {
      onGap(gap) {
        if (gap.companyID !== companyID) return;
        const touchesSharedInbox = gap.scopes.some(workspaceScopeTouchesSharedInbox);
        const touchesWorkspacePanel = gap.scopes.some(workspaceScopeTouchesHomeWorkspacePanel);
        const touchesGVICMatrix = gap.scopes.some((scope) => !scope.semanticScope && (scope.kind === "gvic_matrix" || scope.kind === "workspace"));
        if (gap.scopes.some((scope) => scope.kind === "my_work")) scheduleMyWorkLiveRefresh(gap.scopes);
        if (gap.scopes.some((scope) => scope.kind === "updates")) setUpdatesLiveRefreshToken((value) => value + 1);
        if (touchesSharedInbox) void loadSharedInboxes();
        if (touchesWorkspacePanel) scheduleWorkspacePanelReload();
        if (touchesGVICMatrix) requestGVICMatrixProjectionRefreshRef.current?.();
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
        const localTriageConversionEcho = triageConversionWorkspaceEventWasAppliedLocally(type, data);
        const scopes = context.scopes ?? [];
        const semanticScopesPresent = hasSemanticWorkspaceScopes(scopes);
        const touchesSharedInbox = scopes.some(workspaceScopeTouchesSharedInbox);
        const touchesWorkspacePanel = scopes.some(workspaceScopeTouchesHomeWorkspacePanel);
        const touchesGVICMatrix = scopes.some((scope) => !scope.semanticScope && (scope.kind === "gvic_matrix" || scope.kind === "workspace"));
        const touchesMyWork = scopes.some((scope) => scope.kind === "my_work");
        const touchesUpdates = scopes.some((scope) => scope.kind === "updates");
        if (touchesMyWork) scheduleMyWorkLiveRefresh(scopes);
        if (touchesUpdates) setUpdatesLiveRefreshToken((value) => value + 1);
        if (touchesSharedInbox) {
          void loadSharedInboxes();
        }
        if (touchesWorkspacePanel && !localTriageConversionEcho) scheduleWorkspacePanelReload();
        if (touchesGVICMatrix) requestGVICMatrixProjectionRefreshRef.current?.();
        if (semanticScopesPresent && !touchesSharedInbox && !touchesWorkspacePanel && !touchesGVICMatrix) return;
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
        } else if (type === "logic_gate_created" || type === "logic_gate_updated" || type === "logic_gate_gvic_updated" || type === "logic_gate_permissions_updated") {
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
        if (!localTriageConversionEcho && !touchesWorkspacePanel && scopes.some((scope) => scope.kind === "workspace") && workspaceEventTouchesHomePanel(type)) {
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
  }, [apiBase, companyID, currentUserID, isInboxMatrixView, loadSharedInboxes, refreshNodeRelationshipsForMatrix, scheduleMyWorkLiveRefresh, scheduleWorkspacePanelReload, triageConversionWorkspaceEventWasAppliedLocally]);
  useEffect(() => {
    if (!selectedMessageID) return;
    if (!canLoadMailForView(activeViewID)) {
      setLoadingDetail(false);
      return;
    }
    if (mailbox === "drafts" || selectedMessageID.startsWith("draft:")) {
      setLoadingDetail(false);
      return;
    }
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
  }, [activeViewID, canLoadMailForView, companyID, handleEmailAccessExpired, mailbox, selectedMessageID]);
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
  useEffect(() => {
    if (mailbox !== "archive") return;
    selectMailbox("all");
  }, [mailbox, selectMailbox]);
  const selectHomeView = useCallback((viewID: HomeViewID, nextMailbox: EmailMailbox = "primary") => {
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
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current) || undefined;
    setBusy("message");
    setError("");
    if (starredDelta !== 0) adjustStarredMailboxCount(countKey, starredDelta);
    if (starredDelta !== 0) {
      addPendingStarredMessages([selectedMessage.id]);
      rememberLocallyStarMutatedMessages(companyID, sharedInboxID, [selectedMessage.id]);
      applyUpdatedMessageToCurrentView({ ...selectedMessage, starred: update.starred ?? selectedMessage.starred });
    }
    try {
      const commandResult = await updateHomeMailMessageCommand({
        companyID,
        sharedInboxID,
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
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current) || undefined;
    const starredDelta = nextStarred ? 1 : -1;
    adjustStarredMailboxCount(countKey, starredDelta);
    addPendingStarredMessages([messageID]);
    rememberLocallyStarMutatedMessages(companyID, sharedInboxID, [messageID]);
    applyUpdatedMessageToCurrentView(optimistic);
    void updateHomeMailMessageCommand({
      companyID,
      sharedInboxID,
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
  }, [addPendingStarredMessages, adjustStarredMailboxCount, applyUpdatedMessageToCurrentView, cancelPendingStarredMessages, companyID, handleEmailAccessExpired, loadFolders, rememberLocallyStarMutatedMessages, removePendingStarredMessages, scheduleMessageListRefresh]);
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
    setBusy("archive");
    setError("");
    setNotice("");
    rememberLocallyArchivedMessages(companyID, sharedInboxID, ids);
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
      scheduleFolderMetadataRefresh();
    } catch (archiveError) {
      setError(formatError(archiveError, ids.length === 1 ? "Failed to archive message" : "Failed to archive messages"));
      scheduleMessageListRefresh(0);
    } finally {
      setBusy("");
    }
  }, [adjustPrimaryMailboxCount, canMutateCurrentMailView, companyID, rememberLocallyArchivedMessages, removeMessagesFromVisibleMailList, scheduleFolderMetadataRefresh, scheduleMessageListRefresh]);
  const unarchiveMessages = useCallback(async (messageIDs: string[]) => {
    if (!canMutateCurrentMailView) return;
    const ids = cleanIDList(messageIDs);
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    if (ids.length === 0) return;
    const countKey = mailCountKey(companyID, activeViewIDRef.current);
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
      scheduleFolderMetadataRefresh();
    } catch (unarchiveError) {
      setError(formatError(unarchiveError, ids.length === 1 ? "Failed to unarchive message" : "Failed to unarchive messages"));
    } finally {
      setBusy("");
    }
  }, [adjustPrimaryMailboxCount, canMutateCurrentMailView, companyID, removeMessagesFromVisibleMailList, scheduleFolderMetadataRefresh, selectedMessageID]);
  const archiveSelected = async () => {
    if (!selectedMessage || !canMutateCurrentMailView) return;
    if (mailboxRef.current === "archive") await unarchiveMessages([selectedMessage.id]);
    else await archiveMessages([selectedMessage.id]);
  };
  const saveCurrentComposeDraft = useCallback((options?: { quiet?: boolean; keepOpen?: boolean }) => {
    if (!compose.open) return false;
    const shouldSave = composeHasDraftContent(compose, emailSignature);
    const composeForSave = shouldSave && !compose.draftID.trim()
      ? { ...compose, draftID: createHomeMailDraftID() }
      : compose;
    const nextDrafts = saveHomeMailDraftFromCompose(companyID, currentUserID, composeForSave, emailSignature);
    setMailDrafts(nextDrafts);
    if (options?.keepOpen && composeForSave.draftID !== compose.draftID) {
      setCompose(composeForSave);
    } else if (options?.keepOpen && !shouldSave && compose.draftID) {
      setCompose({ ...compose, draftID: "" });
    }
    if (shouldSave && !options?.quiet) setNotice("Draft saved.");
    return shouldSave;
  }, [companyID, compose, currentUserID, emailSignature]);
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
    setCompose({
      ...emptyCompose,
      open: true,
      sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
      accountEmail: (activeMailAccountEmail ?? "").trim(),
      body: composeBodyWithSignature(emailSignature),
    });
  };
  const openReply = () => {
    if (!selectedMessage) return;
    const composeError = currentMailComposeError();
    if (composeError) {
      setError(composeError);
      return;
    }
    saveCurrentComposeDraft({ quiet: true });
    setCompose({
      ...emptyCompose,
      open: true,
      sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
      accountEmail: (activeMailAccountEmail ?? "").trim(),
      replyToMessageID: selectedMessage.id,
      to: formatAddressList(selectedMessage.from),
      subject: selectedMessage.subject?.toLowerCase().startsWith("re:") ? selectedMessage.subject : `Re: ${selectedMessage.subject || ""}`.trim(),
      body: composeBodyWithSignature(emailSignature),
    });
  };
  const submitCompose = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("send");
    setError("");
    try {
      const targetSharedInboxID = compose.sharedInboxID.trim() || sharedInboxIDForHomeView(activeViewIDRef.current);
      const composeError = currentMailComposeError(targetSharedInboxID);
      if (composeError) {
        setError(composeError);
        return;
      }
      const currentSharedInbox = targetSharedInboxID ? sharedInboxes.find((folder) => folder.folder_id === targetSharedInboxID) ?? null : null;
      const connectedAccountEmail = (compose.accountEmail || currentSharedInbox?.account_email || connection?.account_email || "").trim();
      const submittedCompose = compose;
      const result = await sendHomeMailComposeCommand({ companyID, sharedInboxID: targetSharedInboxID, compose, connectedAccountEmail });
      if (submittedCompose.draftID.trim()) {
        setMailDrafts(deleteHomeMailDraft(companyID, currentUserID, submittedCompose.draftID));
      }
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
  const createSharedInboxFolder = useCallback(async (parentFolderID: string, rawName = "New Folder", accountEmail = ""): Promise<CommunicationsSharedInbox | null> => {
    if (!currentUserCanManageSharedInboxStructure) {
      setError("Only managers and admins can create Shared Triage folders and inboxes.");
      return null;
    }
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
      const viewID = result.viewID ?? (`shared:${folder.folder_id}` as HomeViewID);
      selectHomeView(viewID, "primary");
      if (folder.entry_type === "shared_inbox" && (folder.account_email ?? "").trim()) {
        setPendingSharedInboxMessageRefreshID(folder.folder_id);
      }
      return folder;
    } catch (sharedInboxError) {
      if (accountEmail.trim() && requestSharedInboxEmailConnection(sharedInboxError, accountEmail, { companyID, parentFolderID, name: rawName })) return null;
      setError(formatError(sharedInboxError, "Failed to create Shared Triage"));
      return null;
    } finally {
      setBusy("");
    }
  }, [companyID, currentUserCanManageSharedInboxStructure, requestSharedInboxEmailConnection, selectHomeView]);

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

  const removeSharedInboxFolder = useCallback(async (folderID: string): Promise<void> => {
    setBusy("shared-inbox");
    setError("");
    setNotice("");
    try {
      const result = await removeSharedInboxCommand({ companyID, folderID, sharedInboxes });
      if (!result) return;
      const deletedIDs = new Set(result.deletedFolderIDs);
      setSharedInboxes((previous) => previous.filter((folder) => !deletedIDs.has(folder.folder_id)));
      const currentView = activeViewIDRef.current;
      const activeFolderID = currentView.startsWith("shared:") ? currentView.slice("shared:".length) : "";
      if (activeFolderID && deletedIDs.has(activeFolderID)) setActiveViewID("shared-root");
    } catch (sharedInboxError) {
      setError(formatError(sharedInboxError, "Failed to remove Shared Triage inbox"));
    } finally {
      setBusy("");
    }
  }, [companyID, sharedInboxes]);

  const currentDirectSharedInboxGVICAssignments = useCallback((folderID: string): Array<{ role: CommunicationsSharedInboxGVICRole; principal_type: CommunicationsSharedInboxGVICPrincipalType; principal_id: string }> => {
    const cleanFolderID = folderID.trim();
    const folder = sharedInboxes.find((item) => item.folder_id === cleanFolderID);
    return (folder?.gvic_assignments ?? [])
      .filter((assignment) => assignment.folder_id === cleanFolderID)
      .map((assignment) => {
        const principalType = (assignment.principal_type?.trim() || "user") as CommunicationsSharedInboxGVICPrincipalType;
        const principalID = assignment.principal_id?.trim() || assignment.user_id.trim();
        return { role: assignment.role, principal_type: principalType, principal_id: principalID };
      })
      .filter((assignment) => assignment.principal_id);
  }, [sharedInboxes]);

  const saveSharedInboxGVICAssignments = useCallback(async (
    folderID: string,
    assignments: Array<{ role: CommunicationsSharedInboxGVICRole; principal_type: CommunicationsSharedInboxGVICPrincipalType; principal_id: string }>,
  ): Promise<void> => {
    const cleanFolderID = folderID.trim();
    if (!cleanFolderID) return;
    setBusy("shared-inbox-GVIC");
    setError("");
    setNotice("");
    try {
      const nextAssignments = await updateCommunicationsSharedInboxGVICAssignments(companyID, cleanFolderID, assignments);
      setSharedInboxes((previous) => previous.map((folder) => (
        folder.folder_id === cleanFolderID ? { ...folder, gvic_assignments: nextAssignments } : folder
      )));
      await loadSharedInboxes();
    } catch (GVICError) {
      setError(formatError(GVICError, "Failed to update Shared Triage GVIC"));
    } finally {
      setBusy("");
    }
  }, [companyID, loadSharedInboxes]);

  const addSharedInboxGVICPrincipal = useCallback((
    folderID: string,
    role: CommunicationsSharedInboxGVICRole,
    principalType: CommunicationsSharedInboxGVICPrincipalType,
    principalID: string,
  ) => {
    const cleanPrincipalID = principalID.trim();
    if (!cleanPrincipalID) return;
    const direct = currentDirectSharedInboxGVICAssignments(folderID);
    if (direct.some((assignment) => assignment.role === role && assignment.principal_type === principalType && assignment.principal_id === cleanPrincipalID)) return;
    void saveSharedInboxGVICAssignments(folderID, [...direct, { role, principal_type: principalType, principal_id: cleanPrincipalID }]);
  }, [currentDirectSharedInboxGVICAssignments, saveSharedInboxGVICAssignments]);

  const removeSharedInboxGVICPrincipal = useCallback((
    folderID: string,
    role: CommunicationsSharedInboxGVICRole,
    principalType: CommunicationsSharedInboxGVICPrincipalType,
    principalID: string,
  ) => {
    const cleanPrincipalID = principalID.trim();
    if (!cleanPrincipalID) return;
    const direct = currentDirectSharedInboxGVICAssignments(folderID);
    void saveSharedInboxGVICAssignments(folderID, direct.filter((assignment) => (
      assignment.role !== role || assignment.principal_type !== principalType || assignment.principal_id !== cleanPrincipalID
    )));
  }, [currentDirectSharedInboxGVICAssignments, saveSharedInboxGVICAssignments]);

  const nodeByID = useMemo(() => new Map(nodes.map((node) => [node.node_id, node])), [nodes]);
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
  const activeGVICInboxSection = gvicInboxSectionForView(activeViewID);
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
  const workspacePanelUserID = isInboxMatrixView ? activeGVICMatrixUserID : currentUserID;
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
        const byID = new Map(previous.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
        let changed = false;
        for (const logicGate of fetched) {
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
    return nodes.filter((node) => cleanIDList(node.logic_gate_ids ?? []).some((logicGateID) => logicGateHasAnyGVICRole(logicGateByID.get(logicGateID), workspacePanelUserID)));
  }, [logicGateByID, nodes, workspacePanelUserID]);
  const assignedMyLogicGates = useMemo(() => {
    if (!workspacePanelUserID) return [];
    return logicGates.filter((logicGate) => logicGateHasAnyGVICRole(logicGate, workspacePanelUserID));
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
  const activeGVICRoleLogicGates = useMemo(() => {
    const role = activeGVICInboxSection?.role;
    if (!workspacePanelUserID || !role || role === "other") return [];
    return logicGates.filter((logicGate) => logicGateHasGVICRole(logicGate, role, workspacePanelUserID));
  }, [activeGVICInboxSection?.role, logicGates, workspacePanelUserID]);
  const activeGVICRoleLogicGateGroups = useMemo(() => buildMyLogicGateGroups({
    shortcuts: [],
    assignedLogicGates: activeGVICRoleLogicGates,
    logicGateByID,
    folders: logicGateFolders,
    folderItems: logicGateFolderItems,
  }), [activeGVICRoleLogicGates, logicGateByID, logicGateFolderItems, logicGateFolders]);
  const GVICMatrixDirectoryUsers = useMemo(() => {
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
    <GVICMatrixViewerSelector
      companyUsers={GVICMatrixDirectoryUsers}
      groups={companyUserGroups}
      groupMembers={companyUserGroupMembers}
      currentUserID={currentUserID}
      selectedUserID={activeGVICMatrixUserID}
      entries={GVICMatrixViewerListEntries}
      onEntriesChange={updateGVICMatrixViewerListEntries}
      onSelectUser={setGVICMatrixTargetUserID}
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
    if (mailboxRef.current === "drafts" || homeMessageIsDraft(primaryMessage)) {
      const draft = mailDrafts.find((item) => item.id === primaryID);
      setSelectedMessage(primaryMessage);
      if (draft) setCompose(homeMailDraftToCompose(draft));
      return;
    }
    markMessageReadFromListSelection(primaryMessage);
  }, [mailDrafts, markMessageReadFromListSelection, messages, selectedMessageIDs, selectionAnchorMessageID]);
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
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(TRIAGE_MESSAGE_DRAG_MIME, JSON.stringify({
      kind: "triage_messages",
      company_id: companyID,
      message_ids: messageIDs,
      shared_inbox_id: sharedInboxID || undefined,
    }));
    event.dataTransfer.setData("text/plain", messageIDs.join(","));
  }, [activeViewID, companyID, selectedMessageIDs]);
  const getSelectedMessageIDsForAction = useCallback((): string[] => {
    const visibleIDs = new Set(messages.map((message) => message.id));
    const ids = Array.from(selectedMessageIDs).filter((id) => visibleIDs.has(id));
    if (selectedMessageID && visibleIDs.has(selectedMessageID) && !ids.includes(selectedMessageID)) {
      ids.unshift(selectedMessageID);
    }
    return cleanIDList(ids);
  }, [messages, selectedMessageID, selectedMessageIDs]);
  const requestDeleteMessages = useCallback((messageIDs: string[], position?: ConfirmActionMenuPosition) => {
    if (!canMutateCurrentMailView) return;
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    setDeleteConfirmation({ messageIDs: ids, position: position ?? null });
  }, [canMutateCurrentMailView]);
  const deleteDraftMessages = useCallback((messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    setError("");
    setMailDrafts(deleteHomeMailDrafts(companyID, currentUserID, ids));
    removeMessagesFromVisibleMailList(ids);
    if (compose.open && compose.draftID.trim() && ids.includes(compose.draftID.trim())) {
      setCompose(emptyCompose);
    }
    setSelectedMessageIDs(new Set());
    setSelectionAnchorMessageID("");
    setMessageContextMenu(null);
    setNotice(ids.length === 1 ? "Draft deleted." : `${ids.length} drafts deleted.`);
  }, [companyID, compose.draftID, compose.open, currentUserID, removeMessagesFromVisibleMailList]);
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
  }, [adjustPrimaryMailboxCount, canMutateCurrentMailView, companyID, removeMessagesFromVisibleMailList, selectedMessageID]);
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
    rememberLocallyAppliedTriageConversion(ids, { sharedInboxID, logicGateIDs: [logicGateID] });
    try {
      const conversion = await convertMessagesToLogicGateCommand({
        apiBase,
        companyID,
        logicGateID,
        sharedInboxID,
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
      rememberLocallyAppliedTriageConversion(converted, {
        sharedInboxID,
        nodeIDs: conversion.result.nodes?.map((node) => node.node_id) ?? [],
        boardIDs: [
          conversion.boardID,
          ...(conversion.result.cards ?? []).map((card) => card.board_id),
        ],
        cardIDs: (conversion.result.cards ?? []).map((card) => card.card_id),
        logicGateIDs: [conversion.logicGateID, logicGateID],
      });
      for (const messageID of converted) removeEmailMessageFromCache(messageID);
      reconcileConvertedMessageUnstars(conversion.unstarredMessageIDs, sharedInboxID);
      removeMessagesFromVisibleMailList(converted, { preserveScrollAnchor: true, fillAfterRemoval: false, suppressAutoNetwork: true });
      const title = logicGateByID.get(logicGateID)?.header || "Logic Gate";
      showNoticeWithResourceAction(converted.length === 1 ? `Sent to ${title}.` : `${converted.length} messages sent to ${title}.`, { kind: "logic_gate", logicGateID });
    } catch (convertError) {
      setError(formatError(convertError, "Failed to send messages to Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, logicGateByID, reconcileConvertedMessageUnstars, rememberLocallyAppliedTriageConversion, removeMessagesFromVisibleMailList, showNoticeWithResourceAction]);
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

  const openProjectManagement = useCallback((projectID: string, label: string) => {
    const cleanProjectID = projectID.trim();
    if (!cleanProjectID) return;
    const cleanLabel = label.trim() || "Project";
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
      companyID,
      sourceFrameID: "home",
      kind: "project",
      id: cleanProjectID,
      label: cleanLabel,
      changedAt: Date.now(),
    });
    preloadProjectManagementSurface();
    const targetPath = buildProjectRoute(cleanProjectID);
    if (onNavigate) onNavigate(targetPath);
    else window.location.assign(targetPath);
  }, [companyID, onNavigate]);
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
  const applyGVICMatrixProjectionRows = useCallback((rows: GVICMatrixProjectionRow[], options: {
    mode?: "merge" | "replace";
    logicGates?: LogicGateRecord[];
  } = {}) => {
    if (!companyID || !activeGVICMatrixUserID) return;
    const mode = options.mode ?? "merge";
    const cleanRows = rows.filter((row) => (
      row.company_id?.trim() === companyID &&
      row.user_id?.trim() === activeGVICMatrixUserID &&
      row.projection_row_id?.trim() &&
      row.node_id?.trim()
    ));
    if (cleanRows.length === 0 && mode !== "replace") return;
    if (mode === "replace") {
      GVICMatrixProjectionRowsRef.current = cleanRows;
    } else {
      const byKey = new Map(GVICMatrixProjectionRowsRef.current.map((row) => [row.projection_row_id, row]));
      for (const row of cleanRows) byKey.set(row.projection_row_id, row);
      GVICMatrixProjectionRowsRef.current = Array.from(byKey.values());
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
        ? GVICMatrixProjectionInitializedRef.current
          ? GVICMatrixProjectedNodeIDsRef.current
          : new Set(previous
            .filter((node) => (
              cleanIDList(node.logic_gate_ids ?? []).some((logicGateID) => logicGateHasAnyGVICRole(logicGateByIDRef.current.get(logicGateID), activeGVICMatrixUserID))
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
        ? GVICMatrixProjectionInitializedRef.current
          ? GVICMatrixProjectedLogicGateIDsRef.current
          : new Set(previous
            .filter((logicGate) => logicGateHasAnyGVICRole(logicGate, activeGVICMatrixUserID))
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
          can_view: projectedLogicGate?.can_view ?? previousLogicGate?.can_view ?? true,
          can_edit: projectedLogicGate?.can_edit ?? previousLogicGate?.can_edit ?? true,
          can_admin: projectedLogicGate?.can_admin ?? previousLogicGate?.can_admin ?? false,
        });
        upsertLogicGateRelationshipGraphNode(apiBase, companyID, toLogicGateCanvasRecord(byID.get(logicGateID)!));
      }
      return Array.from(byID.values());
    });

    if (mode === "replace") {
      GVICMatrixProjectionInitializedRef.current = true;
      GVICMatrixProjectedNodeIDsRef.current = nextProjectedNodeIDs;
      GVICMatrixProjectedLogicGateIDsRef.current = nextProjectedLogicGateIDs;
    } else {
      for (const nodeID of nextProjectedNodeIDs) GVICMatrixProjectedNodeIDsRef.current.add(nodeID);
      for (const logicGateID of nextProjectedLogicGateIDs) GVICMatrixProjectedLogicGateIDsRef.current.add(logicGateID);
    }
  }, [activeGVICMatrixUserID, apiBase, companyID]);
  const refreshGVICMatrixProjection = useCallback(async (minimumSequence = 0) => {
    if (!companyID || !activeGVICMatrixUserID || !isInboxMatrixViewID(activeViewIDRef.current)) return;
    if (GVICMatrixProjectionRefetchInFlightRef.current) return;
    const requestScopeKey = `${companyID}\u0000${currentUserID}\u0000${activeGVICMatrixUserID}`;
    GVICMatrixProjectionRefetchInFlightRef.current = true;
    try {
      const [projection, projectedLogicGates] = await Promise.all([
        listGVICMatrixProjectionRows({ apiBase, companyID, targetUserID: activeGVICMatrixUserID, limit: 500 }),
        listMyLogicGates({ apiBase, companyID, targetUserID: activeGVICMatrixUserID, limit: 500 }),
      ]);
      if (GVICMatrixProjectionScopeKeyRef.current !== requestScopeKey) return;
      applyGVICMatrixProjectionRows(projection.rows ?? [], {
        mode: "replace",
        logicGates: projectedLogicGates.logic_gates ?? [],
      });
      const sequence = Math.max(minimumSequence, parseGVICMatrixProjectionSequence(projection.projection_sequence));
      if (sequence > GVICMatrixProjectionSequenceRef.current) {
        GVICMatrixProjectionSequenceRef.current = sequence;
      }
    } catch (projectionError) {
      setError(formatError(projectionError, "Failed to refresh GVIC matrix"));
    } finally {
      GVICMatrixProjectionRefetchInFlightRef.current = false;
    }
  }, [activeGVICMatrixUserID, apiBase, applyGVICMatrixProjectionRows, companyID, currentUserID]);
  const removeGVICMatrixProjectionNodeIfGone = useCallback((nodeID: string) => {
    const cleanNodeID = nodeID.trim();
    if (!cleanNodeID) return;
    if (GVICMatrixProjectionRowsRef.current.some((row) => row.node_id?.trim() === cleanNodeID)) return;
    GVICMatrixProjectedNodeIDsRef.current.delete(cleanNodeID);
    setNodes((previous) => previous.filter((node) => node.node_id !== cleanNodeID));
    removeNodeRelationshipGraphNode(apiBase, companyID, cleanNodeID);
  }, [apiBase, companyID]);
  const requestGVICMatrixProjectionRefresh = useCallback((minimumSequence = 0) => {
    void refreshGVICMatrixProjection(minimumSequence);
  }, [refreshGVICMatrixProjection]);
  requestGVICMatrixProjectionRefreshRef.current = requestGVICMatrixProjectionRefresh;
  const applyRealtimeGVICMatrixProjectionDelta = useCallback((message: RealtimeProjectionDeltaMessage) => {
    if (!companyID || !activeGVICMatrixUserID) return;
    if (GVICMatrixProjectionScopeKeyRef.current !== `${companyID}\u0000${currentUserID}\u0000${activeGVICMatrixUserID}`) return;
    const envelope = message as unknown as GVICMatrixProjectionDeltaEnvelope;
    const result = applyGVICMatrixProjectionEnvelope({
      envelope,
      companyID,
      userID: activeGVICMatrixUserID,
      rows: GVICMatrixProjectionRowsRef.current,
      lastSequence: GVICMatrixProjectionSequenceRef.current,
    });
    if (result.fallback) {
      requestGVICMatrixProjectionRefresh(parseGVICMatrixProjectionSequence(envelope.projection_sequence ?? envelope.sequence));
      return;
    }
    GVICMatrixProjectionRowsRef.current = result.rows;
    GVICMatrixProjectionSequenceRef.current = result.lastSequence ?? GVICMatrixProjectionSequenceRef.current;
    if (!result.changed) return;

    for (const key of result.removedRowKeys) {
      if (key.node_id) removeGVICMatrixProjectionNodeIfGone(key.node_id);
    }
    if (result.upsertedRows.length > 0) applyGVICMatrixProjectionRows(result.upsertedRows);
  }, [activeGVICMatrixUserID, applyGVICMatrixProjectionRows, companyID, currentUserID, removeGVICMatrixProjectionNodeIfGone, requestGVICMatrixProjectionRefresh]);
  useEffect(() => {
    if (!companyID || !activeGVICMatrixUserID || !isInboxMatrixView) return undefined;
    void refreshGVICMatrixProjection();
    return undefined;
  }, [activeGVICMatrixUserID, companyID, isInboxMatrixView, refreshGVICMatrixProjection]);
  useEffect(() => {
    const canSubscribeGVICMatrixTarget = activeGVICMatrixUserID === currentUserID || userHasFullSharedInboxAccess(me, companyID);
    if (!companyID || !activeGVICMatrixUserID || !isInboxMatrixView || !canSubscribeGVICMatrixTarget) return undefined;
    return subscribeRealtimeScope(apiBase, companyID, GVICMatrixRealtimeScope(activeGVICMatrixUserID), {
      getAfterSequence: () => GVICMatrixProjectionSequenceRef.current,
      onRejected: () => requestGVICMatrixProjectionRefresh(),
      onRefetch: (message) => requestGVICMatrixProjectionRefresh(parseGVICMatrixProjectionSequence(message.sequence)),
      onPermissionRevoked: () => requestGVICMatrixProjectionRefresh(),
      onError: () => requestGVICMatrixProjectionRefresh(),
      onDelta: applyRealtimeGVICMatrixProjectionDelta,
    });
  }, [activeGVICMatrixUserID, apiBase, applyRealtimeGVICMatrixProjectionDelta, companyID, currentUserID, isInboxMatrixView, me, requestGVICMatrixProjectionRefresh]);
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
  const createHomeNode = useCallback(async (assignment?: { logicGateID: string; priority: InboxPriority; status?: GVICInboxStatus }) => {
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
        applyGVICMatrixProjectionRows(dropResult.gvic_projection_rows);
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
  }, [apiBase, applyGVICMatrixProjectionRows, companyID, mergeCreatedFolderItems, mergeUpdatedNode, nodeByID]);
  const createHomeLogicGate = useCallback(async (options: { assignCurrentUser?: boolean; creatorGVICRole?: LogicGateGVICRole; openArena?: boolean } = {}) => {
    setBusy("create-logic-gate");
    setError("");
    try {
      const creatorGVICRole = options.creatorGVICRole ?? (options.assignCurrentUser ? "generated" : undefined);
      const result = await createHomeLogicGateCommand({ apiBase, companyID, creatorGVICRole });
      const logicGate = result.logicGate;
      mergeCreatedLogicGate(logicGate, result.folderItems);
      setNotice(creatorGVICRole ? "Logic Gate created and assigned to you." : "Logic Gate created.");
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
  const createLogicGateInInboxCell = useCallback(async (input: { creatorGVICRole?: LogicGateGVICRole }) => {
    const logicGate = await createHomeLogicGate({ creatorGVICRole: input.creatorGVICRole, openArena: false });
    if (logicGate) scheduleCurrentUserMyWorkRefresh();
  }, [createHomeLogicGate, scheduleCurrentUserMyWorkRefresh]);
  const createNodeInInboxCell = useCallback(async (input: { priority: InboxPriority; status?: GVICInboxStatus; creatorGVICRole?: LogicGateGVICRole }) => {
    setBusy("create-node");
    setError("");
    try {
      const result = await createHomeGVICMatrixNodeCommand({
        apiBase,
        companyID,
        priority: input.priority,
        status: input.status,
        creatorGVICRole: input.creatorGVICRole,
        createLogicGateTitle: "new logic gate",
      });
      if (result.logicGate) mergeCreatedLogicGate(result.logicGate, result.folderItems.filter((item) => item.item_type === "logic_gate"));
      mergeCreatedFolderItems(result.folderItems.filter((item) => item.item_type !== "logic_gate"));
      applyGVICMatrixProjectionRows(result.gvic_projection_rows);
      mergeUpdatedNode(result.node);
      scheduleCurrentUserMyWorkRefresh();
      setNotice("Note created in a new Logic Gate.");
    } catch (createError) {
      setError(formatError(createError, "Failed to create note in matrix cell"));
    } finally {
      setBusy("");
    }
  }, [apiBase, applyGVICMatrixProjectionRows, companyID, mergeCreatedFolderItems, mergeCreatedLogicGate, mergeUpdatedNode, scheduleCurrentUserMyWorkRefresh]);
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
  const moveMyWorkNodesIntoCell = useCallback(async (input: { logicGateID?: string; nodeIDs: string[]; priority: InboxPriority; fromLogicGateID?: string; creatorGVICRole?: LogicGateGVICRole; targetUserID?: string }) => {
    const targetGVICRole = input.creatorGVICRole;
    const nodeIDs = cleanIDList(input.nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (!targetGVICRole || nodeIDs.length === 0) return null;
    setBusy("my-work-node-drop");
    setError("");
    try {
      const result = await moveMyWorkNodesToCellCommand({
        apiBase,
        companyID,
        nodeIDs,
        priority: input.priority,
        targetGVICRole,
        targetUserID: input.targetUserID,
        logicGateID: input.logicGateID,
        fromLogicGateID: input.fromLogicGateID,
        nodeByID,
      });
      applyGVICMatrixProjectionRows(result.gvic_projection_rows);
      for (const node of result.nodes) mergeUpdatedNode(node);
      setNotice(nodeIDs.length === 1 ? "My Work node moved." : `${nodeIDs.length} My Work nodes moved.`);
      return result;
    } catch (dropError) {
      setError(formatError(dropError, "Failed to move My Work node"));
      return null;
    } finally {
      setBusy("");
    }
  }, [apiBase, applyGVICMatrixProjectionRows, companyID, mergeUpdatedNode, nodeByID]);
  const dropNodesIntoInboxLogicGate = useCallback(async (input: { logicGateID: string; nodeIDs: string[]; priority: InboxPriority; status?: GVICInboxStatus; fromLogicGateID?: string }) => {
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
      applyGVICMatrixProjectionRows(dropResult.gvic_projection_rows);
      for (const node of dropResult.nodes) {
        if (node) mergeUpdatedNode(node);
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
  }, [apiBase, applyGVICMatrixProjectionRows, companyID, mergeUpdatedNode, nodeByID, scheduleCurrentUserMyWorkRefresh]);
  const dropNodesIntoNewInboxLogicGate = useCallback(async (input: { nodeIDs: string[]; priority: InboxPriority; status?: GVICInboxStatus; creatorGVICRole?: LogicGateGVICRole; fromLogicGateID?: string }) => {
    const nodeIDs = cleanIDList(input.nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (nodeIDs.length === 0) return;
    setBusy("inbox-node-drop");
    setError("");
    try {
      const logicGateResult = await createHomeLogicGateCommand({ apiBase, companyID, creatorGVICRole: input.creatorGVICRole });
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
      applyGVICMatrixProjectionRows(dropResult.gvic_projection_rows);
      for (const node of dropResult.nodes) mergeUpdatedNode(node);
      scheduleCurrentUserMyWorkRefresh();
      setNotice(nodeIDs.length === 1 ? "Node moved into a new Logic Gate." : `${nodeIDs.length} nodes moved into a new Logic Gate.`);
    } catch (dropError) {
      setError(formatError(dropError, "Failed to move nodes into a new Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [apiBase, applyGVICMatrixProjectionRows, companyID, mergeCreatedLogicGate, mergeUpdatedNode, nodeByID, scheduleCurrentUserMyWorkRefresh]);
  const moveLogicGatesIntoInboxCell = useCallback(async (input: { logicGateIDs: string[]; priority: InboxPriority; status?: GVICInboxStatus; creatorGVICRole?: LogicGateGVICRole; nodeIDsByLogicGateID?: Record<string, string[]> }) => {
    const logicGateIDs = cleanIDList(input.logicGateIDs).filter((logicGateID) => logicGateByID.has(logicGateID));
    if (logicGateIDs.length === 0) return;
    setBusy("inbox-logic-gate-drop");
    setError("");
    try {
      const targetRole = input.creatorGVICRole;
      if (currentUserID && targetRole) {
        const GVICRoles: LogicGateGVICRole[] = ["generated", "verified", "consulted", "informed"];
        const assignmentUpdates = await Promise.all(logicGateIDs.map(async (logicGateID) => {
          const gate = logicGateByID.get(logicGateID);
          let assignments = gate?.gvic_assignments ?? [];
          const removalRoles = GVICRoles.filter((role) => (
            role !== targetRole
            && assignments.some((assignment) => assignment.role === role && assignment.user_id?.trim() === currentUserID)
          ));
          if (removalRoles.length > 0) {
            assignments = await removeLogicGateGVICAssignments(companyID, logicGateID, removalRoles.map((role) => ({ role, user_id: currentUserID })));
          }
          const hasTargetRole = assignments.some((assignment) => assignment.role === targetRole && assignment.user_id?.trim() === currentUserID);
          if (!hasTargetRole) {
            assignments = await addLogicGateGVICAssignments(companyID, logicGateID, [{ role: targetRole, user_id: currentUserID }]);
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
        applyGVICMatrixProjectionRows(dropResult.gvic_projection_rows);
        movedNodeCount += dropResult.nodes.length;
        for (const node of dropResult.nodes) mergeUpdatedNode(node);
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
  }, [apiBase, applyGVICMatrixProjectionRows, companyID, currentUserID, logicGateByID, mergeUpdatedNode, nodeByID, nodes, scheduleCurrentUserMyWorkRefresh]);

  const moveProjectsIntoInboxCell = useCallback(async (input: { projectIDs: string[]; priority: InboxPriority; status?: GVICInboxStatus; creatorGVICRole?: LogicGateGVICRole; logicGateIDsByProjectID?: Record<string, string[]>; nodeIDsByProjectID?: Record<string, string[]>; nodeIDsByLogicGateID?: Record<string, string[]> }) => {
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
        creatorGVICRole: input.creatorGVICRole,
        nodeIDsByLogicGateID,
      });
    }
    if (directNodeIDs.length > 0) {
      await dropNodesIntoNewInboxLogicGate({
        nodeIDs: directNodeIDs,
        priority: input.priority,
        status: input.status,
        creatorGVICRole: input.creatorGVICRole,
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
      const updated = await requestJSON<NodeRecord>(apiBase, `/v1/nodes/${encodeURIComponent(cleanNodeID)}`, {
        method: "PUT",
        body: JSON.stringify({ company_id: companyID, name: nextTitle }),
      });
      mergeUpdatedNode(updated);
      invalidateNodeRecordStoreCaches(apiBase, companyID, cleanNodeID);
      scheduleMyWorkLiveRefresh();
      setNotice("Node renamed.");
    } catch (renameError) {
      setError(formatError(renameError, "Failed to rename node"));
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, mergeUpdatedNode, nodeByID, scheduleMyWorkLiveRefresh]);
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
  const applyBulkLogicGateGVIC = useCallback(async (logicGateIDs: string[], role: LogicGateGVICRole, userID: string, action: "add" | "remove") => {
    const ids = cleanIDList(logicGateIDs).filter((logicGateID) => logicGateByID.has(logicGateID));
    const cleanUserID = userID.trim();
    if (ids.length === 0 || !cleanUserID) return;
    setBusy("bulk-logic-gate-edit");
    setError("");
    try {
      const updates = await Promise.all(ids.map(async (logicGateID) => {
        const assignments = action === "add"
          ? await addLogicGateGVICAssignments(companyID, logicGateID, [{ role, user_id: cleanUserID }])
          : await removeLogicGateGVICAssignments(companyID, logicGateID, [{ role, user_id: cleanUserID }]);
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
  const closeCompose = useCallback(() => {
    saveCurrentComposeDraft();
    setCompose(emptyCompose);
  }, [saveCurrentComposeDraft]);
  const saveComposeAndStayOpen = useCallback(() => {
    saveCurrentComposeDraft({ keepOpen: true });
  }, [saveCurrentComposeDraft]);
  const handleSaveEmailSignature = useCallback(() => {
    saveHomeMailSignature(companyID, currentUserID, emailSignature);
    setNotice("Signature saved.");
  }, [companyID, currentUserID, emailSignature]);
  const activeMessageListKey = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly);
  const activeMailViewCanLoadMessages = canLoadMailForView(activeViewID);
  const messageListIsCurrent = !activeMailViewCanLoadMessages || loadedMessageListKey === activeMessageListKey;
  const visibleMessages = messageListIsCurrent ? messages : [];
  const visibleLoadingMessages = loadingMessages || (activeMailViewCanLoadMessages && !messageListIsCurrent);
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
    ? cleanIDList(messages.map((message) => message.id)).length
    : 0;
  const archiveQueueHasRoomForVisiblePage = queuedArchiveEmailCount + visibleArchiveCandidateCount <= ARCHIVE_QUEUE_MAX_EMAILS;
  const mailFilterStatus = selectedMessageIDs.size > 1
    ? `${selectedMessageIDs.size} selected`
    : (visibleLoadingMessages || loadingMoreMessages) ? "Loading" : "";
  const showLocalEntityRail = !embedded;
  const layoutColumnWidths = isNarrow || isInboxMatrixView || isMyWorkView || isUpdatesView
    ? columnWidths
    : fitHomeColumnWidthsToAvailableWidth(columnWidths, workspaceTrackWidth, !hideNavigation);
  const workspaceGridTemplateColumns = isNarrow
    ? "1fr"
    : isMyWorkView || isUpdatesView
      ? hideNavigation
        ? "minmax(0, 1fr)"
        : `${layoutColumnWidths[0]}px minmax(0, 1fr)`
      : hideNavigation
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
          {!hideNavigation && (
            <HomeSidebar
              activeViewID={activeViewID}
              connectedAccountEmail={connection?.account_email}
              sharedInboxes={sharedInboxes}
              loadingSharedInboxes={loadingSharedInboxes}
              busy={busy}
              canManageSharedTriage={currentUserCanManageSharedInboxStructure}
              onSelectView={selectHomeView}
              onCreateSharedInbox={createSharedInboxFolder}
              onRenameSharedInbox={renameSharedInboxFolder}
              onSetSharedInboxAccountEmail={setSharedInboxAccountEmail}
              onMoveSharedInbox={moveSharedInboxFolder}
              onDeleteSharedInbox={deleteSharedInboxFolder}
              onRemoveSharedInbox={removeSharedInboxFolder}
            />
          )}
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
              liveRefreshToken={updatesLiveRefreshToken}
              onOpenNode={(nodeID, informationID) => {
                const node = nodeByID.get(nodeID);
                if (node) openNodeEditorOverlay(node, informationID);
              }}
              onOpenLogicGate={(logicGateID, label) => openLogicGateArena(logicGateID, label || logicGateTitle(logicGateByID.get(logicGateID)))}
              onOpenProject={openProjectManagement}
            />
          ) : isInboxMatrixView ? (
            <>
              {activeGVICInboxSection && (
                <GVICRoleInboxMatrix
                  section={activeGVICInboxSection}
                  loading={loadingNodes}
                  nodes={matrixFilteredNodes}
                  nodeByID={nodeByID}
                  nodeRelationships={nodeRelationships}
                  logicGateByID={logicGateByID}
                  nodeFolders={nodeFolders}
                  nodeFolderItems={nodeFolderItems}
                  currentUserID={activeGVICMatrixUserID}
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
              {showLocalEntityRail && hideNavigation && !isNarrow && <HomeColumnResizeHandle dividerIndex={2} onPointerDown={startColumnResize} />}
              {showLocalEntityRail && (
                <NodeInboxRail
                  loading={loadingNodes}
                  nodeByID={nodeByID}
                  logicGateByID={logicGateByID}
                  allRows={visibleNodeRows}
                  myNodeGroups={myNodeGroups}
                  otherNodes={otherAssignedNodes}
                  myLogicGateGroups={activeGVICRoleLogicGateGroups}
                  inboxRole={activeGVICInboxSection?.role ?? "other"}
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
          {!hideNavigation && !isNarrow && <HomeColumnResizeHandle dividerIndex={0} onPointerDown={startColumnResize} />}
          <HomeMailWorkspace
            activeViewID={activeViewID}
            accountEmail={activeMailAccountEmail}
            archiveAvailable={canMutateCurrentMailView}
            archiveLabel={isArchiveMailbox ? "Unarchive" : "Archive"}
            busy={busy}
            companyID={companyID}
            compose={compose}
            draftCount={mailDrafts.length}
            emailSignature={emailSignature}
            error={error}
            isArchivableListView={isArchivableListView}
            isArchiveMailbox={isArchiveMailbox}
            listViewLabel={listViewLabel}
            loadingDetail={loadingDetail}
            loadingMessages={visibleLoadingMessages}
            loadingMoreMessages={loadingMoreMessages}
            mailFilterStatus={mailFilterStatus}
            mailbox={mailbox}
            mailboxCounts={mailboxCounts}
            messageListRef={messageListRef}
            messages={visibleMessages}
            companyUsers={companyUsers}
            notice={notice}
            noticeAction={mailNoticeAction}
            pendingStarredMessageIDs={pendingStarredMessageIDs}
            searchDraft={searchDraft}
            selectedMessage={selectedMessage}
            selectedMessageID={selectedMessageID}
            selectedMessageIDs={selectedMessageIDs}
            sharedInboxSettings={activeSharedInbox ? {
              onOpen: () => setSharedInboxPermissionsFolderID(activeSharedInbox.folder_id),
              onOpenGVIC: activeSharedInbox.entry_type === "shared_inbox" ? () => setSharedInboxGVICFolderID(activeSharedInbox.folder_id) : undefined,
            } : undefined}
            unassignedSharedInbox={activeSharedInboxBlocksEmail && activeSharedInbox
              ? { folderName: activeSharedInbox.name, message: "Parent folders cannot have emails assigned." }
              : activeSharedInboxNeedsEmail && activeSharedInbox
                ? { folderName: activeSharedInbox.name, onAssignEmail: currentUserCanManageSharedInboxStructure ? assignActiveSharedInboxEmail : undefined }
                : undefined}
            showDetailResizeHandle={!isNarrow}
            unreadOnly={unreadOnly}
            unreadMessageCount={unreadMessageCount}
            canAdvanceTriagePage={canMutateCurrentMailView && activeMailViewHasEmailConnection && isPrimaryTriageMailbox(activeViewID, mailbox) && archiveQueueHasRoomForVisiblePage}
            hasNextMessagePage={!!nextPageToken}
            onAdvanceTriagePage={() => { void advanceTriageMailPage(); }}
            onArchiveSelected={archiveSelected}
            onCancelCompose={closeCompose}
            onColumnResizeStart={startColumnResize}
            onComposeChange={setCompose}
            onDeleteSelected={deleteSelected}
            onDisconnect={disconnect}
            onLoadMoreMessages={() => { void loadMoreMessages(); }}
            onPrefetchMessages={() => { void prefetchNextMessagePage(); }}
            onOpenAllMailbox={openAllMailbox}
            onOpenContextMenu={openMessageContextMenu}
            onOpenNewCompose={openNewCompose}
            onOpenDraftsMailbox={openDraftsMailbox}
            onOpenPendingMailbox={openPendingMailbox}
            onOpenReply={openReply}
            onOpenSentMailbox={openSentMailbox}
            onOpenStarredMailbox={openStarredMailbox}
            onEmailSignatureChange={setEmailSignature}
            onSaveEmailSignature={handleSaveEmailSignature}
            onSaveComposeDraft={saveComposeAndStayOpen}
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
            mailMutationAvailable={canMutateCurrentMailView}
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
          companyID={companyID}
          entityType={sharedInboxPermissionsFolder.entry_type === "shared_inbox" ? "shared_inbox" : "shared_inbox_folder"}
          entityID={sharedInboxPermissionsFolder.folder_id}
          title={sharedInboxPermissionsFolder.name}
          onClose={() => setSharedInboxPermissionsFolderID("")}
          onSaved={() => { void loadSharedInboxes(); }}
        />
      )}
      {sharedInboxGVICFolder && sharedInboxGVICFolder.entry_type === "shared_inbox" && (
        <SharedInboxGVICSettingsModal
          requestJSON={permissionsRequestJSON}
          companyID={companyID}
          folder={sharedInboxGVICFolder}
          companyUsers={companyUsers}
          busy={busy === "shared-inbox-GVIC"}
          onAddPrincipal={addSharedInboxGVICPrincipal}
          onRemovePrincipal={removeSharedInboxGVICPrincipal}
          onClose={() => setSharedInboxGVICFolderID("")}
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
        onApplyLogicGateGVIC={(logicGateIDs, role, userID, action) => { void applyBulkLogicGateGVIC(logicGateIDs, role, userID, action); }}
        onAddNodesToLogicGate={(nodeIDs, logicGateID) => { void addNodesToLogicGate(nodeIDs, logicGateID); }}
        onRequestDelete={requestDeleteBulkEditTargets}
      />
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
    <div style={homeDialogBackdropStyle} onPointerDown={onCancel}>
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
    <div style={homeDialogBackdropStyle} onPointerDown={onCancel}>
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
  );
}

const homeDialogBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 80,
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
