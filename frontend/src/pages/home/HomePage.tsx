import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readAuthConfig } from "../../auth/cognitoAuth";
import { createRequestJSON } from "../../modules/api/requestJSON";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { requestAppDockTab } from "../../app/appDockTabs";
import { MangoWordmark } from "../../app/MangoLogo";
import { preloadLogicGateArenaSurface } from "../../app/preloadDashboardModules";
import {
  applyEmailMessageToCachedPages,
  addLogicGateRaciAssignments,
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
  listEmailFolders,
  listEmailMessages,
  listCommunicationsSharedInboxes,
  mergeEmailMessageIntoMessageList,
  primeEmailMessageCache,
  removeLogicGateRaciAssignments,
  removeEmailMessageFromCache,
  sortEmailMessagesByDateDescending,
  type CompanyUser,
  type CommunicationsSharedInbox,
  type CommunicationsSharedInboxRaciRole,
  type EmailFolder,
  type EmailMailbox,
  type EmailMessage,
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
import type { LogicGateRecord } from "../../modules/logic-gate-map/shared";
import { toLogicGateCanvasRecord } from "../../modules/logic-gate-map/shared";
import { invalidateNodeRecordStoreCaches } from "../../modules/node-map/NodeRecordStore";
import { getLogicGateRecordSingleFlight } from "../../modules/logic-gate-map/LogicGateRecordStore";
import { getNodeRelationshipGraphSnapshot, subscribeNodeRelationshipGraph, upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../../modules/node-map/NodeRelationshipGraph";
import { upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../../modules/logic-gate-map/LogicGateRelationshipGraph";
import { invalidateKanbanBoardContentsCache } from "../../modules/kanban/KanbanBoardContentStore";
import { invalidateKanbanBoardListCache, invalidateLogicGateArenaViewCache } from "../../modules/kanban/kanbanApi";
import { subscribeWorkspaceStream } from "../../modules/workspace/workspaceStream";
import { useNotificationSummary } from "../../modules/notifications/useNotificationSummary";
import type { NotificationItem } from "../../modules/notifications/notificationsApi";
import {
  EVENT_KANBAN_BOARD_CONTENTS_UPDATED,
  EVENT_KANBAN_BOARDS_UPDATED,
} from "../../modules/kanban/shared";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED } from "../../modules/node-map/eventbus";
import { writePendingLogicGateArenaSelection } from "../logic-gate-arena/logicGateArenaLaunch";
import { AciInboxMatrix, HomeBulkEditMenu, HomeColumnResizeHandle, HomeSidebar, LogicGateRail, NodeEditorPopup, NodeInboxRail, ResponsibleInboxMatrix } from "./HomeParts";
import { EntityPermissionsDialog } from "../../modules/permissions/EntityPermissionsDialog";
import { HomeMailOverlays, HomeMailWorkspace } from "./HomeMailWorkspace";
import { AUTO_ARCHIVE_SCROLL_DELAY_MS, MESSAGE_BATCH_SIZE, MESSAGE_EVENT_REFRESH_DELAY_MS, SELF_SEND_DELIVERY_REFRESH_DELAY_MS, TRIAGE_MESSAGE_DRAG_MIME } from "./homeConstants";
import { addMyLogicGateShortcutsCommand, addNodesToLogicGateCommand, applyBulkNodePatchCommand, archiveHomeMailMessagesCommand, convertMessagesToLogicGateCommand, createHomeLogicGateCommand, createHomeNodeCommand, createSharedInboxCommand, deleteHomeMailMessagesCommand, deleteSharedInboxCommand, dropNodesIntoInboxLogicGateCommand, moveSharedInboxCommand, removeMyLogicGateShortcutCommand, renameSharedInboxCommand, sendHomeMailComposeCommand, unarchiveHomeMailMessagesCommand, updateHomeMailMessageCommand, updateSharedInboxAccountEmailCommand } from "./homeCommands";
import { buildMyLogicGateGroups, buildMyNodeGroups, cleanIDList, filterExplorerRowsForSearch, fitHomeColumnWidthsToAvailableWidth, formatAddressList, formatError, formatErrorCode, getHomeColumnMinimumTrackWidth, getHomeGridTemplateColumns, getHomeGridTemplateColumnsWithoutSidebar, getHomeWorkspaceTrackWidth, getHomeViewLabel, getInboxMatrixGridTemplateColumns, getInboxMatrixGridTemplateColumnsWithoutSidebar, isArchivableHomeViewID, isEditableKeyboardTarget, isEmailAccessExpiredError, isInboxMatrixViewID, isWorkspacePanelHomeViewID, logicGateHasAnyRaciRole, logicGateIDFromTreeID, logicGateTreeID, mailboxCountsFromFolders, missingLogicGateRecordIDs, mailboxForHomeView, mailboxLabel, markMessageSentToLogicGate, mergeLogicGateShortcuts, messageHasRecipient, messageListFilterKey, nodeIDFromTreeID, nodeTitle, nodeTreeID, readHomeColumnWidths, resizeHomeColumns, resizeHomeColumnsWithoutSidebar, resizeHomeInboxMatrixColumnsWithoutSidebar, saveHomeColumnWidths, sharedInboxTreeUserCanManageMail, sortLogicGateShortcuts, sortSharedInboxes, userHasFullSharedInboxAccess, workspaceEventTouchesHomePanel } from "./homeUtils";
import { brandStyle, centerStyle, connectPanelStyle, errorStyle, headerButtonStyle, headerDividerStyle, headerStyle, mutedTextStyle, noticeStyle, pageStyle, panelTitleStyle, primaryButtonStyle, titleStyle, userPillStyle, workspaceStyle } from "./homeStyles";
import { emptyCompose, type ComposeState, type CommunicationsStreamEnvelope, type HomeColumnResizeDrag, type HomeColumnWidths, type HomePageProps, type HomeViewID, type InboxPriority, type LoadMessagesOptions, type MessageSelectionModifiers, type NodeEditorOverlayState, type ResponsibleInboxStatus, type WorkspaceStreamEnvelope } from "./homeTypes";

function sharedInboxIDForHomeView(viewID: HomeViewID): string {
  return viewID.startsWith("shared:") ? viewID.slice("shared:".length).trim() : "";
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

export function HomePage({ me, onNavigate, embedded = false, hideNavigation = false, initialViewID = "my-triage" }: HomePageProps) {
  const companyID = getActiveCompanyID();
  const apiBase = readAuthConfig().apiBase;
  const permissionsRequestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const notificationSummary = useNotificationSummary(companyID);
  const [status, setStatus] = useState<CommunicationsStatus | null>(null);
  const [folders, setFolders] = useState<EmailFolder[]>([]);
  const [sharedInboxes, setSharedInboxes] = useState<CommunicationsSharedInbox[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [mailbox, setMailbox] = useState<EmailMailbox>("primary");
  const [activeViewID, setActiveViewID] = useState<HomeViewID>(initialViewID);
  const [selectedMessageID, setSelectedMessageID] = useState("");
  const [selectedMessageIDs, setSelectedMessageIDs] = useState<Set<string>>(new Set());
  const [selectionAnchorMessageID, setSelectionAnchorMessageID] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [pendingAutoArchiveMessageIDs, setPendingAutoArchiveMessageIDs] = useState<Set<string>>(new Set());
  const [messageContextMenu, setMessageContextMenu] = useState<{ x: number; y: number; messageIDs: string[] } | null>(null);
  const [bulkEditMenu, setBulkEditMenu] = useState<{ x: number; y: number; kind: "node" | "logic_gate"; ids: string[] } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ messageIDs: string[] } | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [nextPageToken, setNextPageToken] = useState("");
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
  const [sharedInboxRaciFolderID, setSharedInboxRaciFolderID] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [workspaceTrackWidth, setWorkspaceTrackWidth] = useState(() => Math.max(1, window.innerWidth - 20));
  const [columnWidths, setColumnWidths] = useState<HomeColumnWidths>(() => readHomeColumnWidths());
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const foldersRequestSeqRef = useRef(0);
  const sharedInboxesRequestInFlightRef = useRef(false);
  const logicGatePanelRequestInFlightRef = useRef(false);
  const messageRequestKeyRef = useRef("");
  const pendingMessageReloadRef = useRef(false);
  const pendingMessageRefreshRef = useRef(false);
  const messageRequestSeqRef = useRef(0);
  const loadMessagesRef = useRef<((options?: LoadMessagesOptions) => Promise<void>) | null>(null);
  const selectedMessageIDRef = useRef("");
  const activeViewIDRef = useRef<HomeViewID>(initialViewID);
  const pendingAutoArchiveMessageIDsRef = useRef<Set<string>>(new Set());
  const autoArchiveTimerIDsRef = useRef<Map<string, number>>(new Map());
  const folderReloadTimerRef = useRef<number | null>(null);
  const workspacePanelReloadTimerRef = useRef<number | null>(null);
  const messageListRefreshTimerRef = useRef<number | null>(null);
  const messagesRef = useRef<EmailMessage[]>([]);
  const locallyReadMessageIDsRef = useRef<Set<string>>(new Set());
  const mailboxRef = useRef<EmailMailbox>("primary");
  const nextPageTokenRef = useRef("");
  const searchQueryRef = useRef("");
  const unreadOnlyRef = useRef(false);
  const loadingMessagesRef = useRef(false);
  const loadingMoreMessagesRef = useRef(false);
  const messageListFilterKeyRef = useRef("");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const columnWidthsRef = useRef<HomeColumnWidths>(columnWidths);
  const columnResizeDragRef = useRef<HomeColumnResizeDrag | null>(null);
  const hideNavigationRef = useRef(hideNavigation);
  const isInboxMatrixView = isInboxMatrixViewID(activeViewID);
  const isNarrow = isInboxMatrixView ? viewportWidth < 980 : workspaceTrackWidth < getHomeColumnMinimumTrackWidth(!hideNavigation);
  const currentUserID = me?.user.user_id?.trim() ?? "";
  const currentUserHasFullSharedInboxAccess = userHasFullSharedInboxAccess(me, companyID);
  const activeSharedInboxFolderID = sharedInboxIDForHomeView(activeViewID);

  useEffect(() => {
    if (!companyID || !isInboxMatrixView) {
      setNodeRelationships([]);
      return undefined;
    }
    const updateRelationships = () => {
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
      setNodeRelationships(snapshot.relationships ?? []);
    };
    updateRelationships();
    return subscribeNodeRelationshipGraph(apiBase, companyID, updateRelationships);
  }, [apiBase, companyID, isInboxMatrixView]);

  const activeSharedInbox = useMemo(
    () => activeSharedInboxFolderID ? sharedInboxes.find((folder) => folder.folder_id === activeSharedInboxFolderID) ?? null : null,
    [activeSharedInboxFolderID, sharedInboxes],
  );
  const activeSharedInboxNeedsEmail = !!activeSharedInbox && !(activeSharedInbox.account_email ?? "").trim();
  const sharedInboxRaciFolder = useMemo(
    () => sharedInboxRaciFolderID ? sharedInboxes.find((folder) => folder.folder_id === sharedInboxRaciFolderID) ?? null : null,
    [sharedInboxRaciFolderID, sharedInboxes],
  );
  const canMutateCurrentMailView = activeViewID === "shared-root"
    ? sharedInboxTreeUserCanManageMail(sharedInboxes, "", currentUserID, currentUserHasFullSharedInboxAccess)
    : activeSharedInboxFolderID
      ? sharedInboxTreeUserCanManageMail(sharedInboxes, activeSharedInboxFolderID, currentUserID, currentUserHasFullSharedInboxAccess)
      : true;
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
    removePendingAutoArchiveMessages(ids);
  }, [removePendingAutoArchiveMessages]);
  useEffect(() => {
    return () => {
      autoArchiveTimerIDsRef.current.forEach((timerID) => window.clearTimeout(timerID));
      autoArchiveTimerIDsRef.current.clear();
      pendingAutoArchiveMessageIDsRef.current.clear();
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
        setFolders([]);
        setSharedInboxes([]);
        setCompanyUsers([]);
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
  }, [cancelPendingAutoArchiveMessages]);
  const handleEmailAccessExpired = useCallback(async (accessError: unknown) => {
    setNotice("");
    cancelPendingAutoArchiveMessages(Array.from(pendingAutoArchiveMessageIDsRef.current));
    invalidateCommunicationsCache();
    setFolders([]);
    setMessages([]);
    setSelectedMessage(null);
    setSelectedMessageID("");
    setSelectedMessageIDs(new Set());
    setSelectionAnchorMessageID("");
    await loadStatus();
    setError(formatError(accessError, "Email access expired. Disconnect and reconnect your mailbox."));
  }, [cancelPendingAutoArchiveMessages, loadStatus]);
  const loadFolders = useCallback(async (): Promise<boolean> => {
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
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
  }, [companyID, handleEmailAccessExpired]);
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
    try {
      const users = await listCompanyUsers(companyID);
      setCompanyUsers(users);
      return true;
    } catch (usersError) {
      setCompanyUsers([]);
      setError(formatError(usersError, "Failed to load company users"));
      return false;
    }
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
  const scheduleWorkspacePanelReload = useCallback(() => {
    if (!companyID) return;
    invalidateCommunicationsWorkspacePanelCache(companyID);
    if (workspacePanelReloadTimerRef.current !== null) {
      window.clearTimeout(workspacePanelReloadTimerRef.current);
    }
    workspacePanelReloadTimerRef.current = window.setTimeout(() => {
      workspacePanelReloadTimerRef.current = null;
      void loadLogicGatePanel();
    }, 250);
  }, [companyID, loadLogicGatePanel]);
  const loadMessages = useCallback(async (options: LoadMessagesOptions = {}) => {
    if (!status?.connected) return;
    if (isInboxMatrixViewID(activeViewID)) {
      setMessages([]);
      setSelectedMessage(null);
      setSelectedMessageID("");
      setSelectedMessageIDs(new Set());
      setSelectionAnchorMessageID("");
      setNextPageToken("");
      return;
    }
    if (activeSharedInboxNeedsEmail) {
      setMessages([]);
      setSelectedMessage(null);
      setSelectedMessageID("");
      setSelectedMessageIDs(new Set());
      setSelectionAnchorMessageID("");
      setNextPageToken("");
      messageRequestKeyRef.current = "";
      messageListFilterKeyRef.current = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly);
      return;
    }    const requestKey = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly);
    messageListFilterKeyRef.current = requestKey;
    if (messageRequestKeyRef.current === requestKey) {
      pendingMessageReloadRef.current = true;
      pendingMessageRefreshRef.current = pendingMessageRefreshRef.current || options.refresh === true;
      return;
    }
    messageRequestKeyRef.current = requestKey;
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
      setMessages(page.messages ?? []);
      setNextPageToken(page.next_page_token ?? "");
      const currentSelectedMessageID = selectedMessageIDRef.current;
      if (currentSelectedMessageID && !(page.messages ?? []).some((message) => message.id === currentSelectedMessageID)) {
        setSelectedMessageID("");
        setSelectedMessage(null);
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
  }, [activeSharedInboxNeedsEmail, activeViewID, companyID, handleEmailAccessExpired, mailbox, searchQuery, status?.connected, unreadOnly]);
  const loadMoreMessages = useCallback(async () => {
    if (!status?.connected || isInboxMatrixViewID(activeViewIDRef.current) || loadingMessagesRef.current || loadingMoreMessagesRef.current) return;
    const pageToken = nextPageTokenRef.current.trim();
    if (!pageToken) return;
    const filterKey = messageListFilterKey(companyID, activeViewIDRef.current, mailboxRef.current, searchQueryRef.current, unreadOnlyRef.current);
    setLoadingMoreMessages(true);
    setError("");
    try {
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
    } catch (messageError) {
      if (isEmailAccessExpiredError(messageError)) {
        await handleEmailAccessExpired(messageError);
        return;
      }
      setError(formatError(messageError, "Failed to load messages"));
    } finally {
      setLoadingMoreMessages(false);
    }
  }, [companyID, handleEmailAccessExpired, status?.connected]);
  useEffect(() => {
    loadMessagesRef.current = loadMessages;
  }, [loadMessages]);
  const scheduleMessageListRefresh = useCallback((delayMs = MESSAGE_EVENT_REFRESH_DELAY_MS) => {
    if (messageListRefreshTimerRef.current !== null) window.clearTimeout(messageListRefreshTimerRef.current);
    messageListRefreshTimerRef.current = window.setTimeout(() => {
      messageListRefreshTimerRef.current = null;
      if (!status?.connected || isInboxMatrixViewID(activeViewIDRef.current)) return;
      invalidateCommunicationsCache({ messagePages: true });
      void loadMessagesRef.current?.({ refresh: true });
    }, delayMs);
  }, [status?.connected]);
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
      setMessages((previous) => previous.filter((message) => message.id !== messageID));
      setSelectedMessageIDs((previous) => {
        if (!previous.has(messageID)) return previous;
        const next = new Set(previous);
        next.delete(messageID);
        return next;
      });
      setSelectionAnchorMessageID((current) => (current === messageID ? "" : current));
      if (selectedMessageIDRef.current === messageID) {
        setSelectedMessageID("");
        setSelectedMessage(null);
      }
      setMessageContextMenu((current) => current && current.messageIDs.includes(messageID) ? null : current);
    }
    void archiveHomeMailMessagesCommand({ companyID, sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current), messageIDs: [messageID] })
      .then(() => { void loadFolders(); })
      .catch((archiveError) => {
        if (isEmailAccessExpiredError(archiveError)) {
          void handleEmailAccessExpired(archiveError);
          return;
        }
        setError(formatError(archiveError, "Failed to archive scrolled message"));
        scheduleMessageListRefresh();
      });
  }, [companyID, handleEmailAccessExpired, loadFolders, removePendingAutoArchiveMessages, scheduleMessageListRefresh]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (status?.connected && isArchivableHomeViewID(activeViewID)) void loadFolders(); }, [activeViewID, loadFolders, status?.connected]);
  useEffect(() => { if (status?.connected) void loadSharedInboxes(); }, [loadSharedInboxes, status?.connected]);
  useEffect(() => { if (status?.connected) void loadCompanyUsers(); }, [loadCompanyUsers, status?.connected]);
  useEffect(() => {
    const onSharedInboxesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string }>).detail;
      if (detail?.companyID && detail.companyID !== companyID) return;
      void loadSharedInboxes();
    };
    window.addEventListener(EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED, onSharedInboxesUpdated);
    return () => window.removeEventListener(EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED, onSharedInboxesUpdated);
  }, [companyID, loadSharedInboxes]);
  useEffect(() => { void loadLogicGatePanel(); }, [loadLogicGatePanel]);
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
    if (list.scrollHeight <= list.clientHeight + 120) void loadMoreMessages();
  }, [loadMoreMessages, loadingMessages, loadingMoreMessages, messages.length, nextPageToken]);
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
      if (selectedMessageIDRef.current === message.id) setSelectedMessage(message);
    };
    const unsubscribe = subscribeCommunicationsStream({
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
        // SSE reconnects automatically; keep the UI quiet unless an API reload fails.
      },
    });
    return () => {
      unsubscribe();
      if (folderReloadTimerRef.current !== null) {
        window.clearTimeout(folderReloadTimerRef.current);
        folderReloadTimerRef.current = null;
      }
    };
  }, [companyID, handleEmailAccessExpired, loadFolders, loadMessages, scheduleMessageListRefresh, status?.connected, status?.connection?.account_email]);
  useEffect(() => {
    if (!companyID) return undefined;
    const unsubscribe = subscribeWorkspaceStream(apiBase, companyID, {
      onGap(gap) {
        if (gap.companyID !== companyID) return;
        const touchesSharedInbox = gap.scopes.some((scope) => (
          scope.eventType === "communications_shared_inbox_raci_updated" || scope.eventType === "shared_triage_access_updated" ||
          (scope.kind === "company_explorer" && (!scope.folderKind || scope.folderKind === "communications")) ||
          scope.kind === "workspace"
        ));
        const touchesWorkspacePanel = gap.scopes.some((scope) => (
          scope.kind === "company_explorer" ||
          scope.kind === "node_graph" ||
          scope.kind === "logic_gate_graph" ||
          scope.kind === "kanban_board" ||
          scope.kind === "kanban_board_list" ||
          scope.kind === "work_item_assignment" ||
          scope.kind === "workspace"
        ));
        if (touchesSharedInbox) void loadSharedInboxes();
        if (touchesWorkspacePanel) scheduleWorkspacePanelReload();
      },
      onEvent(event) {
        if (event.event !== "workspace") return;
        let envelope: WorkspaceStreamEnvelope;
        try {
          envelope = JSON.parse(event.data) as WorkspaceStreamEnvelope;
        } catch {
          return;
        }
        if (envelope.company_id?.trim() && envelope.company_id.trim() !== companyID) return;
        const type = envelope.type?.trim() ?? "";
        if (!workspaceEventTouchesHomePanel(type)) return;
        if ((type === "communications_shared_inbox_raci_updated" || type === "shared_triage_access_updated" || type.startsWith("company_explorer_folder_"))) {
          void loadSharedInboxes();
        }
        scheduleWorkspacePanelReload();
      },
      onError() {
        // Workspace SSE reconnects automatically; visible errors come from reloads.
      },
    });
    return () => {
      unsubscribe();
      if (workspacePanelReloadTimerRef.current !== null) {
        window.clearTimeout(workspacePanelReloadTimerRef.current);
        workspacePanelReloadTimerRef.current = null;
      }
    };
  }, [apiBase, companyID, loadSharedInboxes, scheduleWorkspacePanelReload]);
  useEffect(() => {
    const handleKanbanChange = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string }>).detail;
      if (detail?.companyID && detail.companyID !== companyID) return;
      scheduleWorkspacePanelReload();
    };
    window.addEventListener(EVENT_KANBAN_BOARD_CONTENTS_UPDATED, handleKanbanChange);
    window.addEventListener(EVENT_KANBAN_BOARDS_UPDATED, handleKanbanChange);
    return () => {
      window.removeEventListener(EVENT_KANBAN_BOARD_CONTENTS_UPDATED, handleKanbanChange);
      window.removeEventListener(EVENT_KANBAN_BOARDS_UPDATED, handleKanbanChange);
    };
  }, [companyID, scheduleWorkspacePanelReload]);
  useEffect(() => {
    if (!selectedMessageID) return;
    let cancelled = false;
    setLoadingDetail(true);
    setError("");
    getEmailMessage(selectedMessageID, companyID, sharedInboxIDForHomeView(activeViewID))
      .then((message) => {
        if (!cancelled) {
          setSelectedMessage(locallyReadMessageIDsRef.current.has(message.id) ? { ...message, unread: false } : message);
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
  const connection = status?.connection;
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
        setSelectedMessage((current) => (current?.id === message.id ? { ...current, ...message } : message));
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
    setBusy("message");
    setError("");
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
      const normalized = update.unread === undefined ? updated : { ...updated, unread: update.unread };
      applyUpdatedMessageToCurrentView(normalized);
      if (update.folders) await loadMessages();
    } catch (updateError) {
      setError(formatError(updateError, "Failed to update message"));
    } finally {
      setBusy("");
    }
  };
  const toggleMessageStar = useCallback((message: EmailMessage) => {
    const messageID = message.id.trim();
    if (!messageID) return;
    const nextStarred = !message.starred;
    const optimistic = { ...message, starred: nextStarred };
    applyUpdatedMessageToCurrentView(optimistic);
    void updateHomeMailMessageCommand({
      companyID,
      sharedInboxID: sharedInboxIDForHomeView(activeViewIDRef.current),
      messageID,
      update: { starred: nextStarred },
    })
      .then((result) => {
        if (!result) return;
        applyUpdatedMessageToCurrentView({ ...result.message, starred: nextStarred });
        void loadFolders();
      })
      .catch((starError) => {
        invalidateEmailMessageCache(messageID);
        if (isEmailAccessExpiredError(starError)) {
          void handleEmailAccessExpired(starError);
          return;
        }
        setError(formatError(starError, "Failed to update message star"));
        scheduleMessageListRefresh();
      });
  }, [applyUpdatedMessageToCurrentView, companyID, handleEmailAccessExpired, loadFolders, scheduleMessageListRefresh]);
  const archiveMessages = useCallback(async (messageIDs: string[]) => {
    if (!canMutateCurrentMailView) return;
    const ids = cleanIDList(messageIDs);
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    if (ids.length === 0) return;
    cancelPendingAutoArchiveMessages(ids);
    setBusy("archive");
    setError("");
    setNotice("");
    try {
      await archiveHomeMailMessagesCommand({ companyID, sharedInboxID, messageIDs: ids });
      setMessages((previous) => previous.filter((message) => !ids.includes(message.id)));
      if (selectedMessageID && ids.includes(selectedMessageID)) {
        setSelectedMessageID("");
        setSelectedMessage(null);
      }
      setSelectedMessageIDs(new Set());
      setSelectionAnchorMessageID("");
      setMessageContextMenu(null);
      setNotice(ids.length === 1 ? "Message archived." : `${ids.length} messages archived.`);
      await loadMessages();
      await loadFolders();
    } catch (archiveError) {
      setError(formatError(archiveError, ids.length === 1 ? "Failed to archive message" : "Failed to archive messages"));
    } finally {
      setBusy("");
    }
  }, [canMutateCurrentMailView, cancelPendingAutoArchiveMessages, companyID, loadFolders, loadMessages, selectedMessageID]);
  const unarchiveMessages = useCallback(async (messageIDs: string[]) => {
    if (!canMutateCurrentMailView) return;
    const ids = cleanIDList(messageIDs);
    const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
    if (ids.length === 0) return;
    cancelPendingAutoArchiveMessages(ids);
    setBusy("unarchive");
    setError("");
    setNotice("");
    try {
      await unarchiveHomeMailMessagesCommand({ companyID, sharedInboxID, messageIDs: ids });
      setMessages((previous) => previous.filter((message) => !ids.includes(message.id)));
      if (selectedMessageID && ids.includes(selectedMessageID)) {
        setSelectedMessageID("");
        setSelectedMessage(null);
      }
      setSelectedMessageIDs(new Set());
      setSelectionAnchorMessageID("");
      setMessageContextMenu(null);
      setNotice(ids.length === 1 ? "Message moved to My Triage." : `${ids.length} messages moved to My Triage.`);
      await loadMessages();
      await loadFolders();
    } catch (unarchiveError) {
      setError(formatError(unarchiveError, ids.length === 1 ? "Failed to unarchive message" : "Failed to unarchive messages"));
    } finally {
      setBusy("");
    }
  }, [canMutateCurrentMailView, cancelPendingAutoArchiveMessages, companyID, loadFolders, loadMessages, selectedMessageID]);
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
  const openArchivedMailbox = useCallback(() => {
    setCompose(emptyCompose);
    selectMailbox("archive");
  }, [selectMailbox]);
  const openAllMailbox = useCallback(() => {
    setCompose(emptyCompose);
    selectMailbox("all");
  }, [selectMailbox]);
  const openNewCompose = () => {
    setCompose({ ...emptyCompose, open: true });
  };
  const openReply = () => {
    if (!selectedMessage) return;
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
      const result = await sendHomeMailComposeCommand({ compose, connectedAccountEmail: connection?.account_email });
      setCompose(emptyCompose);
      setNotice("Message sent.");
      if (result.sentToConnectedAccount && mailboxRef.current === "primary") {
        scheduleMessageListRefresh(SELF_SEND_DELIVERY_REFRESH_DELAY_MS);
      } else {
        await loadMessages();
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
  }, [companyID]);

  const assignActiveSharedInboxEmail = useCallback(() => {
    if (!activeSharedInbox) return;
    const initialEmail = (activeSharedInbox.account_email ?? connection?.account_email ?? "").trim().toLowerCase();
    const rawEmail = window.prompt("Email for shared inbox", initialEmail);
    if (rawEmail === null) return;
    const accountEmail = rawEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    void setSharedInboxAccountEmail(activeSharedInbox.folder_id, accountEmail);
  }, [activeSharedInbox, connection?.account_email, setSharedInboxAccountEmail]);
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
    if (!currentUserID) return [];
    return nodes.filter((node) => node.assignee_user_id?.trim() === currentUserID);
  }, [currentUserID, nodes]);
  const myNodeGroups = useMemo(() => buildMyNodeGroups({
    nodes: myNodes,
    logicGateFolders,
    logicGateFolderItems,
  }), [logicGateFolderItems, logicGateFolders, myNodes]);
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
  const assignedMyLogicGates = useMemo(() => {
    if (!currentUserID) return [];
    return logicGates.filter((logicGate) => logicGateHasAnyRaciRole(logicGate, currentUserID));
  }, [currentUserID, logicGates]);
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
          setSelectedMessage((current) => (current?.id === messageID ? { ...current, ...readUpdated } : readUpdated));
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
    const nextIDs = selectedMessageIDs.has(message.id) ? Array.from(selectedMessageIDs) : [message.id];
    setSelectedMessageIDs(new Set(nextIDs));
    setSelectionAnchorMessageID(message.id);
    setSelectedMessageID(message.id);
    setMessageContextMenu({ x: event.clientX, y: event.clientY, messageIDs: nextIDs });
  }, [selectedMessageIDs]);
  const startMessageDrag = useCallback((message: EmailMessage, event: React.DragEvent<HTMLElement>) => {
    if (activeViewID !== "my-triage" || mailboxRef.current === "archive") return;
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
    cancelPendingAutoArchiveMessages(ids);
    setBusy("delete");
    setError("");
    try {
      const sharedInboxID = sharedInboxIDForHomeView(activeViewIDRef.current);
      await deleteHomeMailMessagesCommand({ companyID, sharedInboxID, messageIDs: ids });
      setMessages((previous) => previous.filter((message) => !ids.includes(message.id)));
      if (selectedMessageID && ids.includes(selectedMessageID)) {
        setSelectedMessageID("");
        setSelectedMessage(null);
      }
      setSelectedMessageIDs(new Set());
      setSelectionAnchorMessageID("");
      setMessageContextMenu(null);
      setNotice(ids.length === 1 ? "Message deleted." : `${ids.length} messages deleted.`);
      await loadMessages();
    } catch (deleteError) {
      setError(formatError(deleteError, ids.length === 1 ? "Failed to delete message" : "Failed to delete messages"));
    } finally {
      setBusy("");
    }
  }, [canMutateCurrentMailView, cancelPendingAutoArchiveMessages, companyID, loadMessages, selectedMessageID]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Delete" || deleteConfirmation || busy) return;
      if (isEditableKeyboardTarget(event.target)) return;
      const ids = getSelectedMessageIDsForAction();
      if (ids.length === 0) return;
      event.preventDefault();
      requestDeleteMessages(ids);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, deleteConfirmation, getSelectedMessageIDsForAction, requestDeleteMessages]);
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
  const convertMessagesToLogicGate = useCallback(async (logicGateID: string, messageIDs: string[]) => {
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
        invalidateKanbanBoardList: invalidateKanbanBoardListCache,
        invalidateKanbanBoardContents: invalidateKanbanBoardContentsCache,
        invalidateLogicGateArenaView: invalidateLogicGateArenaViewCache,
        invalidateNodeRecord: invalidateNodeRecordStoreCaches,
        upsertNodeRelationshipGraphNode,
        upsertNodeFolderItemInRelationshipGraph: upsertCompanyExplorerFolderItemInNodeRelationshipGraph,
        upsertLogicGateFolderItemInRelationshipGraph: upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph,
      });
      if (!conversion) return;
      const converted = conversion.convertedMessageIDs;
      setMessages((previous) => previous.map((message) => converted.includes(message.id) ? markMessageSentToLogicGate(message, logicGateID) : message));
      setSelectedMessage((current) => current && converted.includes(current.id) ? markMessageSentToLogicGate(current, logicGateID) : current);
      const title = logicGateByID.get(logicGateID)?.header || "Logic Gate";
      setNotice(converted.length === 1 ? `Sent to ${title}.` : `${converted.length} messages sent to ${title}.`);
    } catch (convertError) {
      setError(formatError(convertError, "Failed to send messages to Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, logicGateByID]);
  const selectLogicGateTreeID = useCallback((treeID: string, orderedIDs: string[], event: React.MouseEvent) => {
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
  const openNodeEditorOverlay = useCallback((node: NodeRecord) => {
    const nodeID = node.node_id.trim();
    if (!nodeID) return;
    setNodeEditorOverlay({ nodeID, nodeTitle: nodeTitle(node) });
  }, []);
  const openLogicGateArena = useCallback((logicGateID: string, label: string, nodeID?: string) => {
    const cleanLogicGateID = logicGateID.trim();
    if (!cleanLogicGateID) return;
    writePendingLogicGateArenaSelection({
      companyID,
      logicGateID: cleanLogicGateID,
      label,
      nodeID,
    });
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
      companyID,
      sourceFrameID: "home",
      kind: "logic_gate",
      id: cleanLogicGateID,
      label,
      selectedTreeID: logicGateTreeID(cleanLogicGateID),
      changedAt: Date.now(),
    });
    preloadLogicGateArenaSurface();
    if (onNavigate) onNavigate("/logic-gate-arena");
    else window.location.assign("/logic-gate-arena");
  }, [companyID, onNavigate]);
  const openMentionNotificationTarget = useCallback((notification: NotificationItem) => {
    const rawNodeID = notification.node_id?.trim() || (notification.entity_type === "node" ? notification.entity_id.trim() : "");
    const node = rawNodeID ? nodeByID.get(rawNodeID) : undefined;
    const rawLogicGateID = notification.logic_gate_id?.trim()
      || (notification.entity_type === "logic_gate" ? notification.entity_id.trim() : "")
      || cleanIDList(node?.logic_gate_ids ?? [])[0]
      || "";
    if (rawLogicGateID) {
      const gate = logicGateByID.get(rawLogicGateID);
      openLogicGateArena(rawLogicGateID, gate?.header?.trim() || notification.title || rawLogicGateID, rawNodeID);
      return;
    }
    if (rawNodeID) {
      setNodeEditorOverlay({ nodeID: rawNodeID, nodeTitle: node ? nodeTitle(node) : notification.title || rawNodeID });
    }
  }, [logicGateByID, nodeByID, openLogicGateArena]);
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
        const updatedNodes = await dropNodesIntoInboxLogicGateCommand({
          apiBase,
          companyID,
          logicGateID: assignment.logicGateID,
          nodeIDs: [result.node.node_id],
          priority: assignment.priority,
          status: assignment.status,
          nodeByID: nodeMap,
          invalidateKanbanBoardContents: invalidateKanbanBoardContentsCache,
        });
        for (const node of updatedNodes) mergeUpdatedNode(node);
        setNotice("Node created and added to Logic Gate.");
        return;
      }
      setNotice("Node created.");
      openNodeEditorOverlay(result.node);
    } catch (createError) {
      setError(formatError(createError, assignment?.logicGateID ? "Failed to create node in Logic Gate" : "Failed to create node"));
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, mergeCreatedFolderItems, mergeUpdatedNode, nodeByID, openNodeEditorOverlay]);
  const createHomeLogicGate = useCallback(async (options: { assignCurrentUser?: boolean } = {}) => {
    setBusy("create-logic-gate");
    setError("");
    try {
      const result = await createHomeLogicGateCommand({ apiBase, companyID });
      let logicGate = result.logicGate;
      if (options.assignCurrentUser && currentUserID) {
        const assignments = await addLogicGateRaciAssignments(companyID, logicGate.logic_gate_id, [{ role: "responsible", user_id: currentUserID }]);
        logicGate = { ...logicGate, raci_assignments: assignments };
      }
      setLogicGates((previous) => {
        const next = previous.filter((item) => item.logic_gate_id !== logicGate.logic_gate_id);
        return [...next, logicGate];
      });
      mergeCreatedFolderItems(result.folderItems);
      upsertLogicGateRelationshipGraphNode(apiBase, companyID, toLogicGateCanvasRecord(logicGate));
      setNotice(options.assignCurrentUser && currentUserID ? "Logic Gate created and assigned to you." : "Logic Gate created.");
      openLogicGateArena(logicGate.logic_gate_id, logicGate.header || "Logic Gate");
    } catch (createError) {
      setError(formatError(createError, "Failed to create Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, currentUserID, mergeCreatedFolderItems, openLogicGateArena]);
  const openNodeBulkEditMenu = useCallback((nodeID: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
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
  const dropNodesIntoInboxLogicGate = useCallback(async (input: { logicGateID: string; nodeIDs: string[]; priority: InboxPriority; status?: ResponsibleInboxStatus }) => {
    const logicGateID = input.logicGateID.trim();
    const nodeIDs = cleanIDList(input.nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (!logicGateID || nodeIDs.length === 0) return;
    setBusy("inbox-node-drop");
    setError("");
    try {
      const updatedNodes = await dropNodesIntoInboxLogicGateCommand({
        apiBase,
        companyID,
        logicGateID,
        nodeIDs,
        priority: input.priority,
        status: input.status,
        nodeByID,
        invalidateKanbanBoardContents: invalidateKanbanBoardContentsCache,
      });
      for (const node of updatedNodes) {
        if (node) mergeUpdatedNode(node);
      }
      setNotice(nodeIDs.length === 1 ? "Node added to Logic Gate." : `${nodeIDs.length} nodes added to Logic Gate.`);
    } catch (dropError) {
      setError(formatError(dropError, "Failed to add nodes to Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, mergeUpdatedNode, nodeByID]);
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
  const applyBulkLogicGateRaci = useCallback(async (logicGateIDs: string[], role: CommunicationsSharedInboxRaciRole, userID: string, action: "add" | "remove") => {
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
  const listViewLabel = activeViewID.startsWith("shared:") ? activeViewLabel : isArchivableListView ? mailboxLabel(mailbox) : activeViewLabel;
  const mailboxActionBusy = busy === "archive" || busy === "unarchive";
  const unreadMessageCount = messages.reduce((count, message) => count + (message.unread ? 1 : 0), 0);
  const mailboxCounts = useMemo(() => mailboxCountsFromFolders(folders), [folders]);
  useEffect(() => {
    if (!status?.connected || isInboxMatrixView) return;
    window.dispatchEvent(new CustomEvent("mangorts:home-unread-counts-updated", {
      detail: { companyID, viewID: activeViewID, unreadCount: unreadMessageCount },
    }));
  }, [activeViewID, companyID, isInboxMatrixView, status?.connected, unreadMessageCount]);
  const mailFilterStatus = selectedMessageIDs.size > 1
    ? `${selectedMessageIDs.size} selected`
    : (loadingMessages || loadingMoreMessages) ? "Loading" : "";
  const isAciInboxView = activeViewID === "aci-inbox";
  const layoutColumnWidths = isNarrow || isInboxMatrixView
    ? columnWidths
    : fitHomeColumnWidthsToAvailableWidth(columnWidths, workspaceTrackWidth, !hideNavigation);
  const workspaceGridTemplateColumns = isNarrow
    ? "1fr"
    : hideNavigation
      ? isInboxMatrixView
        ? getInboxMatrixGridTemplateColumnsWithoutSidebar(layoutColumnWidths)
        : getHomeGridTemplateColumnsWithoutSidebar(layoutColumnWidths)
      : isInboxMatrixView
        ? getInboxMatrixGridTemplateColumns(layoutColumnWidths)
        : getHomeGridTemplateColumns(layoutColumnWidths);
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
        <main ref={workspaceRef} style={{ ...workspaceStyle, gridTemplateColumns: workspaceGridTemplateColumns, gap: isNarrow || (isInboxMatrixView && !hideNavigation) ? 10 : 0 }}>
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
              onOpenMentionNotification={openMentionNotificationTarget}
              onNewSharedInboxNameChange={setNewSharedInboxName}
              onSubmitSharedInbox={submitSharedInbox}
              onCreateSharedInbox={createSharedInboxFolder}
              onRenameSharedInbox={renameSharedInboxFolder}
              onSetSharedInboxAccountEmail={setSharedInboxAccountEmail}
              onMoveSharedInbox={moveSharedInboxFolder}
              onDeleteSharedInbox={deleteSharedInboxFolder}
            />
          )}
          {isInboxMatrixView ? (
            <>
              {isAciInboxView ? (
                <AciInboxMatrix
                  loading={loadingNodes}
                  nodes={nodes}
                  nodeByID={nodeByID}
                  nodeRelationships={nodeRelationships}
                  logicGateByID={logicGateByID}
                  nodeFolders={nodeFolders}
                  nodeFolderItems={nodeFolderItems}
                  currentUserID={currentUserID}
                  notificationSummary={notificationSummary}
                  selectedRowIDs={selectedNodeRowIDs}
                  selectedLogicGateRowIDs={selectedLogicGateRowIDs}
                  getNodeDragIDs={getNodeDragIDs}
                  onSelectNode={selectNodeMatrixCard}
                  onSelectLogicGate={selectLogicGateTreeID}
                  onOpenNode={openNodeEditorOverlay}
                  onOpenLogicGate={openLogicGateArena}
                  onOpenNodeBulkMenu={openNodeBulkEditMenu}
                  onOpenLogicGateBulkMenu={openLogicGateBulkEditMenu}
                  onOpenLogicGateBulkMenuAt={openLogicGateBulkEditMenuAt}
                  onCreateNodeInLogicGate={(input) => { void createHomeNode(input); }}
                  onDropNodes={(input) => { void dropNodesIntoInboxLogicGate(input); }}
                />
              ) : (
                <ResponsibleInboxMatrix
                  loading={loadingNodes}
                  nodes={nodes}
                  nodeByID={nodeByID}
                  nodeRelationships={nodeRelationships}
                  logicGateByID={logicGateByID}
                  nodeFolders={nodeFolders}
                  nodeFolderItems={nodeFolderItems}
                  currentUserID={currentUserID}
                  notificationSummary={notificationSummary}
                  selectedRowIDs={selectedNodeRowIDs}
                  selectedLogicGateRowIDs={selectedLogicGateRowIDs}
                  getNodeDragIDs={getNodeDragIDs}
                  onSelectNode={selectNodeMatrixCard}
                  onSelectLogicGate={selectLogicGateTreeID}
                  onOpenNode={openNodeEditorOverlay}
                  onOpenLogicGate={openLogicGateArena}
                  onOpenNodeBulkMenu={openNodeBulkEditMenu}
                  onOpenLogicGateBulkMenu={openLogicGateBulkEditMenu}
                  onOpenLogicGateBulkMenuAt={openLogicGateBulkEditMenuAt}
                  onCreateNodeInLogicGate={(input) => { void createHomeNode(input); }}
                  onDropNodes={(input) => { void dropNodesIntoInboxLogicGate(input); }}
                />
              )}
              {hideNavigation && !isNarrow && <HomeColumnResizeHandle dividerIndex={2} onPointerDown={startColumnResize} />}
              <NodeInboxRail
                loading={loadingNodes}
                nodeByID={nodeByID}
                allRows={visibleNodeRows}
                myNodeGroups={myNodeGroups}
                selectedRowIDs={selectedNodeRowIDs}
                expandedRowIDs={nodeExpandedIDs}
                search={nodeSearch}
                getNodeDragIDs={getNodeDragIDs}
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
                onOpenNode={openNodeEditorOverlay}
                onOpenNodeBulkMenu={openNodeBulkEditMenu}
                onCreateNode={() => { void createHomeNode(); }}
              />
            </>
          ) : (
            <>
          {!hideNavigation && !isNarrow && <HomeColumnResizeHandle dividerIndex={0} onPointerDown={startColumnResize} />}
          <HomeMailWorkspace
            activeViewID={activeViewID}
            accountEmail={connection?.account_email}
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
            notice={notice}
            pendingAutoArchiveMessageIDs={pendingAutoArchiveMessageIDs}
            searchDraft={searchDraft}
            selectedMessage={selectedMessage}
            selectedMessageID={selectedMessageID}
            selectedMessageIDs={selectedMessageIDs}
            sharedInboxSettings={activeSharedInbox ? { onOpen: () => setSharedInboxRaciFolderID(activeSharedInbox.folder_id) } : undefined}
            unassignedSharedInbox={activeSharedInboxNeedsEmail && activeSharedInbox ? { folderName: activeSharedInbox.name, onAssignEmail: assignActiveSharedInboxEmail } : undefined}
            showDetailResizeHandle={!isNarrow}
            unreadOnly={unreadOnly}
            unreadMessageCount={unreadMessageCount}
            onArchiveSelected={archiveSelected}
            onAutoArchiveMessages={autoArchiveScrolledMessages}
            onCancelCompose={() => setCompose(emptyCompose)}
            onColumnResizeStart={startColumnResize}
            onComposeChange={setCompose}
            onDeleteSelected={deleteSelected}
            onDisconnect={disconnect}
            onLoadMoreMessages={() => { void loadMoreMessages(); }}
            onOpenAllMailbox={openAllMailbox}
            onOpenArchivedMailbox={openArchivedMailbox}
            onOpenContextMenu={openMessageContextMenu}
            onOpenNewCompose={openNewCompose}
            onOpenPendingMailbox={openPendingMailbox}
            onOpenReply={openReply}
            onOpenStarredMailbox={openStarredMailbox}
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
            onCreateLogicGate={(options) => { void createHomeLogicGate(options); }}
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
      {sharedInboxRaciFolder && (
        <EntityPermissionsDialog
          requestJSON={permissionsRequestJSON}
          companyID={companyID}
          entityType="shared_triage_folder"
          entityID={sharedInboxRaciFolder.folder_id}
          title={`Shared Triage / ${sharedInboxRaciFolder.name}`}
          onClose={() => setSharedInboxRaciFolderID("")}
          onSaved={() => { void loadSharedInboxes(); }}
        />
      )}
      <HomeBulkEditMenu
        menu={bulkEditMenu}
        companyUsers={companyUsers}
        logicGates={logicGates}
        busy={busy === "bulk-node-edit" || busy === "bulk-logic-gate-edit"}
        onClose={() => setBulkEditMenu(null)}
        onApplyNodePatch={(nodeIDs, patch) => { void applyBulkNodePatch(nodeIDs, patch); }}
        onApplyLogicGateRaci={(logicGateIDs, role, userID, action) => { void applyBulkLogicGateRaci(logicGateIDs, role, userID, action); }}
        onAddNodesToLogicGate={(nodeIDs, logicGateID) => { void addNodesToLogicGate(nodeIDs, logicGateID); }}
      />
      {nodeEditorOverlay && (
        <NodeEditorPopup
          nodeID={nodeEditorOverlay.nodeID}
          nodeTitle={nodeEditorOverlay.nodeTitle}
          onClose={() => setNodeEditorOverlay(null)}
          onCollapseToTab={() => {
            requestAppDockTab({ kind: "node", entityID: nodeEditorOverlay.nodeID, label: nodeEditorOverlay.nodeTitle });
            setNodeEditorOverlay(null);
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
