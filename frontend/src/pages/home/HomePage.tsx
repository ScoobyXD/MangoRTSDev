import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readAuthConfig } from "../../auth/cognitoAuth";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { requestAppDockTab } from "../../app/appDockTabs";
import { MangoWordmark } from "../../app/MangoLogo";
import { preloadLogicGateArenaSurface } from "../../app/preloadDashboardModules";
import {
  applyEmailMessageToCachedPages,
  archiveEmailMessage,
  createCommunicationsSharedInbox,
  addMyLogicGateShortcuts,
  convertTriageMessagesToLogicGate,
  deleteCommunicationsSharedInbox,
  deleteEmailMessage,
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
  parseEmailAddressList,
  primeEmailMessageCache,
  removeMyLogicGateShortcut,
  removeEmailMessageFromCache,
  sendEmail,
  sortEmailMessagesByDateDescending,
  unarchiveEmailMessage,
  updateEmailMessage,
  updateCommunicationsSharedInbox,
  updateCommunicationsSharedInboxRaciAssignments,
  updateLogicGateRaciAssignments,
  updateNode,
  type CompanyUser,
  type CommunicationsSharedInbox,
  type CommunicationsSharedInboxRaciAssignment,
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
import type { NodeRecord } from "../../modules/node-map/shared";
import { buildCompanyExplorerTreeRows } from "../../modules/company-explorer/companyExplorerTreeRows";
import { resolveExplorerClickSelection } from "../../modules/company-explorer/treePresentation";
import type { ExplorerDragPayload, ExplorerTreeNode } from "../../modules/company-explorer/companyExplorerTypes";
import type { LogicGateRecord } from "../../modules/logic-gate-map/shared";
import { invalidateNodeRecordStoreCaches } from "../../modules/node-map/NodeRecordStore";
import { upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../../modules/node-map/NodeRelationshipGraph";
import { upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph } from "../../modules/logic-gate-map/LogicGateRelationshipGraph";
import { invalidateKanbanBoardContentsCache } from "../../modules/kanban/KanbanBoardContentStore";
import { getLogicGateArenaView, invalidateKanbanBoardListCache, invalidateLogicGateArenaViewCache, upsertKanbanCard } from "../../modules/kanban/kanbanApi";
import { subscribeWorkspaceStream } from "../../modules/workspace/workspaceStream";
import { useNotificationSummary } from "../../modules/notifications/useNotificationSummary";
import type { NotificationItem } from "../../modules/notifications/notificationsApi";
import {
  EVENT_KANBAN_BOARD_CONTENTS_UPDATED,
  EVENT_KANBAN_BOARDS_UPDATED,
  logicGateKanbanBoardID,
  type KanbanBoardContentsUpdatedDetail,
  type KanbanBoardsUpdatedDetail,
} from "../../modules/kanban/shared";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED } from "../../modules/node-map/eventbus";
import { writePendingLogicGateArenaSelection } from "../logic-gate-arena/logicGateArenaLaunch";
import { AciInboxMatrix, HomeBulkEditMenu, HomeColumnResizeHandle, HomeSidebar, LogicGateRail, NodeEditorPopup, NodeInboxRail, ResponsibleInboxMatrix, SharedInboxRaciSettingsModal } from "./HomeParts";
import { HomeMailOverlays, HomeMailWorkspace } from "./HomeMailWorkspace";
import { AUTO_ARCHIVE_SCROLL_DELAY_MS, MESSAGE_BATCH_SIZE, MESSAGE_EVENT_REFRESH_DELAY_MS, SELF_SEND_DELIVERY_REFRESH_DELAY_MS, TRIAGE_MESSAGE_DRAG_MIME } from "./homeConstants";
import { buildMyLogicGateGroups, buildMyNodeGroups, cleanIDList, collectSharedInboxSubtreeIDs, emailAddressListContains, filterExplorerRowsForSearch, filterSharedInboxesForUser, fitHomeColumnWidthsToAvailableWidth, formatAddressList, formatError, formatErrorCode, getHomeColumnMinimumTrackWidth, getHomeGridTemplateColumns, getHomeGridTemplateColumnsWithoutSidebar, getHomeWorkspaceTrackWidth, getHomeViewLabel, getInboxMatrixGridTemplateColumns, getInboxMatrixGridTemplateColumnsWithoutSidebar, isArchivableHomeViewID, isEditableKeyboardTarget, isEmailAccessExpiredError, isInboxMatrixViewID, isWorkspacePanelHomeViewID, logicGateIDFromTreeID, logicGateIDsFromExplorerPayload, logicGateTreeID, mailboxForHomeView, mailboxLabel, markMessageSentToLogicGate, mergeLogicGateShortcuts, messageHasRecipient, messageListFilterKey, nodeIDFromTreeID, nodeTitle, nodeTreeID, normalizeResponsibleInboxStatus, readHomeColumnWidths, resizeHomeColumns, resizeHomeColumnsWithoutSidebar, resizeHomeInboxMatrixColumnsWithoutSidebar, saveHomeColumnWidths, sharedInboxTreeUserCanManageMail, sortLogicGateShortcuts, sortSharedInboxes, userHasFullSharedInboxAccess, workspaceEventTouchesHomePanel } from "./homeUtils";
import { brandStyle, centerStyle, connectPanelStyle, errorStyle, headerButtonStyle, headerDividerStyle, headerStyle, mutedTextStyle, noticeStyle, pageStyle, panelTitleStyle, primaryButtonStyle, titleStyle, userPillStyle, workspaceStyle } from "./homeStyles";
import { emptyCompose, type ComposeState, type CommunicationsStreamEnvelope, type HomeColumnResizeDrag, type HomeColumnWidths, type HomePageProps, type HomeViewID, type InboxPriority, type LoadMessagesOptions, type MessageSelectionModifiers, type NodeEditorOverlayState, type ResponsibleInboxStatus, type WorkspaceStreamEnvelope } from "./homeTypes";

function responsibleInboxStatusTitle(status: ResponsibleInboxStatus): string {
  if (status === "in_progress") return "In Progress";
  if (status === "done") return "Done";
  return "Pending";
}

function firstResponsibleUserID(logicGate: LogicGateRecord | undefined): string {
  return (logicGate?.raci_assignments ?? []).find((assignment) => assignment.role === "responsible")?.user_id?.trim() ?? "";
}

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
  const notificationSummary = useNotificationSummary(companyID);
  const [status, setStatus] = useState<CommunicationsStatus | null>(null);
  const [, setFolders] = useState<EmailFolder[]>([]);
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
  const foldersRequestInFlightRef = useRef(false);
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
  const visibleSharedInboxes = useMemo(
    () => filterSharedInboxesForUser(sharedInboxes, currentUserID, currentUserHasFullSharedInboxAccess),
    [currentUserHasFullSharedInboxAccess, currentUserID, sharedInboxes],
  );
  const activeSharedInboxFolderID = sharedInboxIDForHomeView(activeViewID);
  const activeSharedInbox = useMemo(
    () => activeSharedInboxFolderID ? sharedInboxes.find((folder) => folder.folder_id === activeSharedInboxFolderID) ?? null : null,
    [activeSharedInboxFolderID, sharedInboxes],
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
    if (visibleSharedInboxes.some((folder) => folder.folder_id === activeSharedInboxFolderID)) return;
    setActiveViewID("shared-root");
  }, [activeSharedInboxFolderID, visibleSharedInboxes]);
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
    if (foldersRequestInFlightRef.current) return false;
    foldersRequestInFlightRef.current = true;
    try {
      const next = await listEmailFolders();
      setFolders(next);
      return true;
    } catch (folderError) {
      if (isEmailAccessExpiredError(folderError)) {
        await handleEmailAccessExpired(folderError);
        return false;
      }
      setError(formatError(folderError, "Failed to load folders"));
      return false;
    } finally {
      foldersRequestInFlightRef.current = false;
    }
  }, [handleEmailAccessExpired]);
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
    const requestKey = messageListFilterKey(companyID, activeViewID, mailbox, searchQuery, unreadOnly);
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
  }, [activeViewID, companyID, handleEmailAccessExpired, mailbox, searchQuery, status?.connected, unreadOnly]);
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
    void archiveEmailMessage(messageID, sharedInboxIDForHomeView(activeViewIDRef.current), companyID)
      .catch((archiveError) => {
        if (isEmailAccessExpiredError(archiveError)) {
          void handleEmailAccessExpired(archiveError);
          return;
        }
        setError(formatError(archiveError, "Failed to archive scrolled message"));
        scheduleMessageListRefresh();
      });
  }, [companyID, handleEmailAccessExpired, removePendingAutoArchiveMessages, scheduleMessageListRefresh]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (status?.connected) void loadFolders(); }, [loadFolders, status?.connected]);
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
        if (type === "communications_shared_inbox_raci_updated" || type.startsWith("company_explorer_folder_")) {
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
      const updated = await updateEmailMessage(selectedMessage.id, update, sharedInboxIDForHomeView(activeViewIDRef.current), companyID);
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
    void updateEmailMessage(messageID, { starred: nextStarred }, sharedInboxIDForHomeView(activeViewIDRef.current), companyID)
      .then((updated) => {
        applyUpdatedMessageToCurrentView({ ...updated, starred: nextStarred });
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
  }, [applyUpdatedMessageToCurrentView, companyID, handleEmailAccessExpired, scheduleMessageListRefresh]);
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
      await Promise.all(ids.map((id) => archiveEmailMessage(id, sharedInboxID, companyID)));
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
    } catch (archiveError) {
      setError(formatError(archiveError, ids.length === 1 ? "Failed to archive message" : "Failed to archive messages"));
    } finally {
      setBusy("");
    }
  }, [canMutateCurrentMailView, cancelPendingAutoArchiveMessages, companyID, loadMessages, selectedMessageID]);
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
      await Promise.all(ids.map((id) => unarchiveEmailMessage(id, sharedInboxID, companyID)));
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
    } catch (unarchiveError) {
      setError(formatError(unarchiveError, ids.length === 1 ? "Failed to unarchive message" : "Failed to unarchive messages"));
    } finally {
      setBusy("");
    }
  }, [canMutateCurrentMailView, cancelPendingAutoArchiveMessages, companyID, loadMessages, selectedMessageID]);
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
    const to = parseEmailAddressList(compose.to);
    const cc = parseEmailAddressList(compose.cc);
    const bcc = parseEmailAddressList(compose.bcc);
    if (to.length === 0 && cc.length === 0 && bcc.length === 0) {
      setError("Add at least one recipient.");
      return;
    }
    if (!compose.subject.trim() && !compose.body.trim()) {
      setError("Add a subject or message body.");
      return;
    }
    setBusy("send");
    setError("");
    try {
      const sentToConnectedAccount = emailAddressListContains([...to, ...cc, ...bcc], connection?.account_email ?? "");
      await sendEmail({
        to,
        cc,
        bcc,
        subject: compose.subject.trim(),
        body: compose.body.trim(),
        reply_to_message_id: compose.replyToMessageID || undefined,
      });
      setCompose(emptyCompose);
      setNotice("Message sent.");
      if (sentToConnectedAccount && mailboxRef.current === "primary") {
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
    const name = rawName.trim();
    if (!name) return null;
    setBusy("shared-inbox");
    setError("");
    setNotice("");
    try {
      const folder = await createCommunicationsSharedInbox({ companyID, name, parentFolderID, accountEmail });
      setSharedInboxes((previous) => sortSharedInboxes([
        ...previous.filter((item) => item.folder_id !== folder.folder_id),
        folder,
      ]));
      setActiveViewID(`shared:${folder.folder_id}`);
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
    const cleanFolderID = folderID.trim();
    if (!cleanFolderID) return;
    setBusy("shared-inbox");
    setError("");
    setNotice("");
    try {
      const folder = await updateCommunicationsSharedInbox({ companyID, folderID: cleanFolderID, accountEmail });
      setSharedInboxes((previous) => sortSharedInboxes(previous.map((item) => item.folder_id === folder.folder_id ? folder : item)));
      setNotice(folder.account_email ? `Attached ${folder.account_email}.` : "Email detached.");
    } catch (sharedInboxError) {
      if (await offerNylasConnectionForSharedInboxEmail(sharedInboxError, accountEmail)) return;
      setError(formatError(sharedInboxError, "Failed to update Shared Triage email"));
    } finally {
      setBusy("");
    }
  }, [companyID]);

  const renameSharedInboxFolder = useCallback(async (folderID: string, name: string): Promise<void> => {
    const cleanName = name.trim();
    if (!folderID.trim() || !cleanName) return;
    setBusy("shared-inbox");
    setError("");
    setNotice("");
    try {
      const folder = await updateCommunicationsSharedInbox({ companyID, folderID, name: cleanName });
      setSharedInboxes((previous) => sortSharedInboxes(previous.map((item) => item.folder_id === folder.folder_id ? folder : item)));
    } catch (sharedInboxError) {
      setError(formatError(sharedInboxError, "Failed to rename Shared Triage folder"));
    } finally {
      setBusy("");
    }
  }, [companyID]);

  const moveSharedInboxFolder = useCallback(async (folderID: string, parentFolderID: string, position: number): Promise<void> => {
    if (!folderID.trim()) return;
    setBusy("shared-inbox");
    setError("");
    setNotice("");
    try {
      const folder = await updateCommunicationsSharedInbox({ companyID, folderID, parentFolderID, position });
      setSharedInboxes((previous) => sortSharedInboxes(previous.map((item) => item.folder_id === folder.folder_id ? folder : item)));
    } catch (sharedInboxError) {
      setError(formatError(sharedInboxError, "Failed to move Shared Triage folder"));
    } finally {
      setBusy("");
    }
  }, [companyID]);

  const deleteSharedInboxFolder = useCallback(async (folderID: string): Promise<void> => {
    const cleanFolderID = folderID.trim();
    if (!cleanFolderID) return;
    const deletedIDs = collectSharedInboxSubtreeIDs(sharedInboxes, cleanFolderID);
    if (deletedIDs.size === 0) deletedIDs.add(cleanFolderID);
    setBusy("shared-inbox");
    setError("");
    setNotice("");
    try {
      await deleteCommunicationsSharedInbox(companyID, cleanFolderID);
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

  const saveSharedInboxRaciAssignments = useCallback(async (folderID: string, assignments: CommunicationsSharedInboxRaciAssignment[]) => {
    const cleanFolderID = folderID.trim();
    if (!cleanFolderID) return;
    const directAssignments = assignments.filter((assignment) => assignment.folder_id === cleanFolderID);
    setBusy("shared-inbox-raci");
    setError("");
    try {
      const nextAssignments = await updateCommunicationsSharedInboxRaciAssignments(
        companyID,
        cleanFolderID,
        directAssignments.map((assignment) => ({ role: assignment.role, user_id: assignment.user_id })),
      );
      setSharedInboxes((previous) => sortSharedInboxes(previous.map((folder) => (
        folder.folder_id === cleanFolderID ? { ...folder, raci_assignments: nextAssignments } : folder
      ))));
      void loadSharedInboxes();
      setNotice("Shared Triage RACI updated.");
    } catch (raciError) {
      setError(formatError(raciError, "Failed to update Shared Triage RACI"));
    } finally {
      setBusy("");
    }
  }, [companyID, loadSharedInboxes]);

  const addSharedInboxRaciUser = useCallback((folderID: string, role: CommunicationsSharedInboxRaciRole, userID: string) => {
    const cleanFolderID = folderID.trim();
    const cleanUserID = userID.trim();
    if (!cleanFolderID || !cleanUserID) return;
    const folder = sharedInboxes.find((item) => item.folder_id === cleanFolderID);
    if (!folder || (folder.raci_assignments ?? []).some((assignment) => assignment.role === role && assignment.user_id === cleanUserID)) return;
    const user = companyUsers.find((item) => item.user_id === cleanUserID);
    void saveSharedInboxRaciAssignments(cleanFolderID, [
      ...(folder.raci_assignments ?? []),
      {
        company_id: companyID,
        folder_id: cleanFolderID,
        role,
        user_id: cleanUserID,
        user_display_name: user?.display_name,
        user_email: user?.email,
        created_timestamp: new Date().toISOString(),
      },
    ]);
  }, [companyID, companyUsers, saveSharedInboxRaciAssignments, sharedInboxes]);

  const removeSharedInboxRaciUser = useCallback((folderID: string, role: CommunicationsSharedInboxRaciRole, userID: string) => {
    const cleanFolderID = folderID.trim();
    const cleanUserID = userID.trim();
    if (!cleanFolderID || !cleanUserID) return;
    const folder = sharedInboxes.find((item) => item.folder_id === cleanFolderID);
    if (!folder) return;
    const directAssignments = (folder.raci_assignments ?? []).filter((assignment) => assignment.folder_id === cleanFolderID);
    const nextAssignments = directAssignments.filter((assignment) => !(assignment.role === role && assignment.user_id === cleanUserID));
    if (nextAssignments.length === directAssignments.length) return;
    void saveSharedInboxRaciAssignments(cleanFolderID, nextAssignments);
  }, [saveSharedInboxRaciAssignments, sharedInboxes]);

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
  const myLogicGateGroups = useMemo(() => buildMyLogicGateGroups({
    shortcuts: myLogicGateShortcuts,
    logicGateByID,
    folders: logicGateFolders,
    folderItems: logicGateFolderItems,
  }), [logicGateByID, logicGateFolderItems, logicGateFolders, myLogicGateShortcuts]);
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
    void updateEmailMessage(messageID, { unread: false }, sharedInboxIDForHomeView(activeViewIDRef.current), companyID)
      .then((updated) => {
        const readUpdated = { ...updated, unread: false };
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
      await Promise.all(ids.map((id) => deleteEmailMessage(id, sharedInboxID, companyID)));
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
    const logicGateIDs = logicGateIDsFromExplorerPayload(payload, logicGateFolders, logicGateFolderItems);
    if (logicGateIDs.length === 0) return;
    setBusy("my-logic-gates");
    setError("");
    try {
      const shortcuts = await addMyLogicGateShortcuts(companyID, logicGateIDs);
      setMyLogicGateShortcuts((previous) => mergeLogicGateShortcuts(previous, shortcuts));
      setNotice(logicGateIDs.length === 1 ? "Added to My Logic Gates." : `${logicGateIDs.length} Logic Gates added.`);
    } catch (shortcutError) {
      setError(formatError(shortcutError, "Failed to add My Logic Gates"));
    } finally {
      setBusy("");
    }
  }, [companyID, logicGateFolderItems, logicGateFolders]);
  const removeShortcut = useCallback(async (logicGateID: string) => {
    if (!logicGateID) return;
    setBusy("my-logic-gates");
    setError("");
    try {
      await removeMyLogicGateShortcut(companyID, logicGateID);
      setMyLogicGateShortcuts((previous) => previous.filter((shortcut) => shortcut.logic_gate_id !== logicGateID));
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
      const result = await convertTriageMessagesToLogicGate({ companyID, logicGateID, messageIDs: ids });
      const boardID = result.board?.board_id?.trim() || logicGateKanbanBoardID(logicGateID);
      const boardLogicGateID = result.board?.logic_gate_id?.trim() || logicGateID;
      invalidateKanbanBoardListCache(apiBase, companyID);
      invalidateKanbanBoardContentsCache(apiBase, companyID, boardID);
      invalidateLogicGateArenaViewCache(apiBase, companyID, boardLogicGateID);
      window.dispatchEvent(new CustomEvent<KanbanBoardsUpdatedDetail>(EVENT_KANBAN_BOARDS_UPDATED, { detail: { companyID, board: result.board } }));
      window.dispatchEvent(new CustomEvent<KanbanBoardContentsUpdatedDetail>(EVENT_KANBAN_BOARD_CONTENTS_UPDATED, { detail: { companyID, boardID, logicGateID: boardLogicGateID } }));
      for (const node of result.nodes ?? []) {
        invalidateNodeRecordStoreCaches(apiBase, companyID, node.node_id);
        upsertNodeRelationshipGraphNode(apiBase, companyID, node);
      }
      for (const item of result.folder_items ?? []) {
        upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, item);
        upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph(apiBase, companyID, item);
      }
      const converted = result.deleted_message_ids?.length ? result.deleted_message_ids : ids;
      invalidateCommunicationsCache({ messagePages: true, messages: true });
      setMessages((previous) => previous.map((message) => converted.includes(message.id) ? markMessageSentToLogicGate(message, logicGateID) : message));
      setSelectedMessage((current) => current && converted.includes(current.id) ? markMessageSentToLogicGate(current, logicGateID) : current);
      const title = logicGateByID.get(logicGateID)?.header || "Logic Gate";
      setNotice(converted.length === 1 ? `Sent to ${title}.` : `${converted.length} messages sent to ${title}.`);
    } catch (convertError) {
      setError(formatError(convertError, "Failed to send messages to Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, logicGateByID, selectedMessageID]);
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
    setNodes((previous) => previous.map((item) => item.node_id === node.node_id ? node : item));
    invalidateNodeRecordStoreCaches(apiBase, companyID, node.node_id);
    upsertNodeRelationshipGraphNode(apiBase, companyID, node);
  }, [apiBase, companyID]);
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
  const openLogicGateBulkEditMenu = useCallback((logicGateID: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
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
    setBulkEditMenu({ x: event.clientX, y: event.clientY, kind: "logic_gate", ids });
  }, [logicGateByID, selectedLogicGateRowIDs]);
  const findLogicGateColumnID = useCallback(async (logicGateID: string, status: ResponsibleInboxStatus): Promise<{ boardID: string; columnID: string } | null> => {
    const view = await getLogicGateArenaView(apiBase, companyID, logicGateID);
    const sortedColumns = [...(view.columns ?? [])].sort((a, b) => a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp) || a.column_id.localeCompare(b.column_id));
    const wantedTitle = responsibleInboxStatusTitle(status).toLowerCase();
    const column = sortedColumns.find((item) => item.title.trim().toLowerCase() === wantedTitle) ?? sortedColumns[0];
    if (!column) return null;
    return { boardID: view.board.board_id, columnID: column.column_id };
  }, [apiBase, companyID]);
  const dropNodesIntoInboxLogicGate = useCallback(async (input: { logicGateID: string; nodeIDs: string[]; priority: InboxPriority; status?: ResponsibleInboxStatus }) => {
    const logicGateID = input.logicGateID.trim();
    const nodeIDs = cleanIDList(input.nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (!logicGateID || nodeIDs.length === 0) return;
    setBusy("inbox-node-drop");
    setError("");
    try {
      const responsibleUserID = firstResponsibleUserID(logicGateByID.get(logicGateID));
      const columnCache = new Map<ResponsibleInboxStatus, Promise<{ boardID: string; columnID: string } | null>>();
      const columnForStatus = (status: ResponsibleInboxStatus) => {
        const existing = columnCache.get(status);
        if (existing) return existing;
        const next = findLogicGateColumnID(logicGateID, status);
        columnCache.set(status, next);
        return next;
      };
      const updatedNodes = await Promise.all(nodeIDs.map(async (nodeID) => {
        const node = nodeByID.get(nodeID);
        if (!node) return null;
        const status = input.status ?? normalizeResponsibleInboxStatus(node.status) ?? "pending";
        const placement = await columnForStatus(status);
        if (placement) {
          await upsertKanbanCard({
            apiBase,
            companyID,
            boardID: placement.boardID,
            columnID: placement.columnID,
            nodeID,
            nodeTitle: nodeTitle(node),
            position: 0,
          });
          invalidateKanbanBoardContentsCache(apiBase, companyID, placement.boardID);
          invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateID);
        }
        const priority = input.priority === 0 ? null : input.priority;
        const updated = await updateNode(companyID, nodeID, {
          priority,
          ...(responsibleUserID ? { assignee_user_id: responsibleUserID } : {}),
        });
        return updated;
      }));
      for (const node of updatedNodes) {
        if (node) mergeUpdatedNode(node);
      }
      setNotice(nodeIDs.length === 1 ? "Node added to Logic Gate." : `${nodeIDs.length} nodes added to Logic Gate.`);
    } catch (dropError) {
      setError(formatError(dropError, "Failed to add nodes to Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [apiBase, companyID, findLogicGateColumnID, logicGateByID, mergeUpdatedNode, nodeByID]);
  const applyBulkNodePatch = useCallback(async (nodeIDs: string[], patch: Partial<Pick<NodeRecord, "assignee_user_id" | "priority" | "status" | "due_date">>) => {
    const ids = cleanIDList(nodeIDs).filter((nodeID) => nodeByID.has(nodeID));
    if (ids.length === 0) return;
    setBusy("bulk-node-edit");
    setError("");
    try {
      const status = normalizeResponsibleInboxStatus(patch.status);
      const updatedNodes = await Promise.all(ids.map(async (nodeID) => {
        const node = nodeByID.get(nodeID);
        if (!node) return null;
        if (status) {
          const logicGateID = cleanIDList(node.logic_gate_ids ?? [])[0] ?? "";
          if (logicGateID) {
            const placement = await findLogicGateColumnID(logicGateID, status);
            if (placement) {
              await upsertKanbanCard({
                apiBase,
                companyID,
                boardID: placement.boardID,
                columnID: placement.columnID,
                nodeID,
                nodeTitle: nodeTitle(node),
                position: 0,
              });
              invalidateKanbanBoardContentsCache(apiBase, companyID, placement.boardID);
              invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateID);
            }
          }
        }
        const updated = await updateNode(companyID, nodeID, patch);
        return updated;
      }));
      for (const node of updatedNodes) {
        if (node) mergeUpdatedNode(node);
      }
      setNotice(ids.length === 1 ? "Node updated." : `${ids.length} nodes updated.`);
    } catch (bulkError) {
      setError(formatError(bulkError, "Failed to update selected nodes"));
    } finally {
      setBusy("");
      setBulkEditMenu(null);
    }
  }, [apiBase, companyID, findLogicGateColumnID, mergeUpdatedNode, nodeByID]);
  const applyBulkLogicGateRaci = useCallback(async (logicGateIDs: string[], role: CommunicationsSharedInboxRaciRole, userID: string, action: "add" | "remove") => {
    const ids = cleanIDList(logicGateIDs).filter((logicGateID) => logicGateByID.has(logicGateID));
    const cleanUserID = userID.trim();
    if (ids.length === 0 || !cleanUserID) return;
    setBusy("bulk-logic-gate-edit");
    setError("");
    try {
      const updates = await Promise.all(ids.map(async (logicGateID) => {
        const current = logicGateByID.get(logicGateID);
        const existing = current?.raci_assignments ?? [];
        const nextAssignments = action === "add"
          ? [
              ...existing.map((assignment) => ({ role: assignment.role, user_id: assignment.user_id })),
              { role, user_id: cleanUserID },
            ]
          : existing
              .filter((assignment) => !(assignment.role === role && assignment.user_id === cleanUserID))
              .map((assignment) => ({ role: assignment.role, user_id: assignment.user_id }));
        const assignments = await updateLogicGateRaciAssignments(companyID, logicGateID, nextAssignments);
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
              sharedInboxes={visibleSharedInboxes}
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
                  onDropNodes={(input) => { void dropNodesIntoInboxLogicGate(input); }}
                />
              ) : (
                <ResponsibleInboxMatrix
                  loading={loadingNodes}
                  nodes={nodes}
                  nodeByID={nodeByID}
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
            messageListRef={messageListRef}
            messages={messages}
            notice={notice}
            pendingAutoArchiveMessageIDs={pendingAutoArchiveMessageIDs}
            searchDraft={searchDraft}
            selectedMessage={selectedMessage}
            selectedMessageID={selectedMessageID}
            selectedMessageIDs={selectedMessageIDs}
            sharedInboxSettings={activeSharedInbox ? { onOpen: () => setSharedInboxRaciFolderID(activeSharedInbox.folder_id) } : undefined}
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
        <SharedInboxRaciSettingsModal
          folder={sharedInboxRaciFolder}
          companyUsers={companyUsers}
          busy={busy === "shared-inbox-raci"}
          onAddUser={addSharedInboxRaciUser}
          onRemoveUser={removeSharedInboxRaciUser}
          onClose={() => setSharedInboxRaciFolderID("")}
        />
      )}
      <HomeBulkEditMenu
        menu={bulkEditMenu}
        companyUsers={companyUsers}
        busy={busy === "bulk-node-edit" || busy === "bulk-logic-gate-edit"}
        onClose={() => setBulkEditMenu(null)}
        onApplyNodePatch={(nodeIDs, patch) => { void applyBulkNodePatch(nodeIDs, patch); }}
        onApplyLogicGateRaci={(logicGateIDs, role, userID, action) => { void applyBulkLogicGateRaci(logicGateIDs, role, userID, action); }}
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
