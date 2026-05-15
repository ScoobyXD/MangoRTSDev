import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readAuthConfig } from "../../auth/cognitoAuth";
import { getActiveCompanyID } from "../../auth/currentCompany";
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
  fetchCommunicationsAuthURL,
  fetchCommunicationsWorkspacePanel,
  fetchCommunicationsStatus,
  getEmailMessage,
  invalidateCommunicationsCache,
  invalidateCommunicationsFolderCache,
  invalidateCommunicationsWorkspacePanelCache,
  invalidateEmailMessageCache,
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
  type CommunicationsSharedInbox,
  type EmailFolder,
  type EmailMailbox,
  type EmailMessage,
  type CommunicationsStatus,
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
import { invalidateKanbanBoardListCache, invalidateLogicGateArenaViewCache } from "../../modules/kanban/kanbanApi";
import { subscribeWorkspaceStream } from "../../modules/workspace/workspaceStream";
import {
  EVENT_KANBAN_BOARD_CONTENTS_UPDATED,
  EVENT_KANBAN_BOARDS_UPDATED,
  logicGateKanbanBoardID,
  type KanbanBoardContentsUpdatedDetail,
  type KanbanBoardsUpdatedDetail,
} from "../../modules/kanban/shared";
import { writePendingLogicGateArenaSelection } from "../logic-gate-arena/logicGateArenaLaunch";
import { AciInboxMatrix, HomeColumnResizeHandle, HomeSidebar, LogicGateRail, NodeEditorPopup, NodeInboxRail, ResponsibleInboxMatrix } from "./HomeParts";
import { HomeMailOverlays, HomeMailWorkspace } from "./HomeMailWorkspace";
import { MESSAGE_BATCH_SIZE, MESSAGE_EVENT_REFRESH_DELAY_MS, SELF_SEND_DELIVERY_REFRESH_DELAY_MS, TRIAGE_MESSAGE_DRAG_MIME } from "./homeConstants";
import { buildMyLogicGateGroups, cleanIDList, collectSharedInboxSubtreeIDs, emailAddressListContains, filterExplorerRowsForSearch, formatAddressList, formatError, formatErrorCode, getHomeGridTemplateColumns, getHomeGridTemplateColumnsWithoutSidebar, getHomeWorkspaceTrackWidth, getHomeViewLabel, getInboxMatrixGridTemplateColumns, getInboxMatrixGridTemplateColumnsWithoutSidebar, isArchivableHomeViewID, isEditableKeyboardTarget, isEmailAccessExpiredError, isInboxMatrixViewID, isWorkspacePanelHomeViewID, logicGateIDFromTreeID, logicGateIDsFromExplorerPayload, logicGateTreeID, mailboxForHomeView, mailboxLabel, markMessageSentToLogicGate, mergeLogicGateShortcuts, messageHasRecipient, messageListFilterKey, nodeHasLogicGateRaciRole, nodeIDFromTreeID, nodeTitle, nodeTreeID, readHomeColumnWidths, resizeHomeColumns, resizeHomeColumnsWithoutSidebar, resizeHomeInboxMatrixColumnsWithoutSidebar, saveHomeColumnWidths, sortLogicGateShortcuts, sortNodesForInbox, sortSharedInboxes, workspaceEventTouchesHomePanel } from "./homeUtils";
import { brandStyle, centerStyle, connectPanelStyle, errorStyle, headerButtonStyle, headerDividerStyle, headerStyle, mutedTextStyle, noticeStyle, pageStyle, panelTitleStyle, primaryButtonStyle, titleStyle, userPillStyle, workspaceStyle } from "./homeStyles";
import { emptyCompose, type ComposeState, type CommunicationsStreamEnvelope, type HomeColumnResizeDrag, type HomeColumnWidths, type HomePageProps, type HomeViewID, type LoadMessagesOptions, type MessageSelectionModifiers, type NodeEditorOverlayState, type WorkspaceStreamEnvelope } from "./homeTypes";
export function HomePage({ me, onNavigate, embedded = false, hideNavigation = false, initialViewID = "my-triage" }: HomePageProps) {
  const companyID = getActiveCompanyID();
  const apiBase = readAuthConfig().apiBase;
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
  const [messageContextMenu, setMessageContextMenu] = useState<{ x: number; y: number; messageIDs: string[] } | null>(null);
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
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [columnWidths, setColumnWidths] = useState<HomeColumnWidths>(() => readHomeColumnWidths());
  const [columnResizeDrag, setColumnResizeDrag] = useState<HomeColumnResizeDrag | null>(null);
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
  const folderReloadTimerRef = useRef<number | null>(null);
  const workspacePanelReloadTimerRef = useRef<number | null>(null);
  const messageListRefreshTimerRef = useRef<number | null>(null);
  const messagesRef = useRef<EmailMessage[]>([]);
  const locallyReadMessageIDsRef = useRef<Set<string>>(new Set());
  const autoArchivingMessageIDsRef = useRef<Set<string>>(new Set());
  const mailboxRef = useRef<EmailMailbox>("primary");
  const nextPageTokenRef = useRef("");
  const searchQueryRef = useRef("");
  const unreadOnlyRef = useRef(false);
  const loadingMessagesRef = useRef(false);
  const loadingMoreMessagesRef = useRef(false);
  const messageListFilterKeyRef = useRef("");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const isNarrow = viewportWidth < 980;
  useEffect(() => {
    selectedMessageIDRef.current = selectedMessageID;
  }, [selectedMessageID]);
  useEffect(() => {
    activeViewIDRef.current = activeViewID;
  }, [activeViewID]);
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
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    if (!columnResizeDrag) return undefined;
    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const delta = event.clientX - columnResizeDrag.startX;
      const nextWidths = hideNavigation
        ? isInboxMatrixViewID(activeViewIDRef.current)
          ? resizeHomeInboxMatrixColumnsWithoutSidebar(columnResizeDrag.startWidths, columnResizeDrag.dividerIndex, delta, columnResizeDrag.availableWidth)
          : resizeHomeColumnsWithoutSidebar(columnResizeDrag.startWidths, columnResizeDrag.dividerIndex, delta, columnResizeDrag.availableWidth)
        : resizeHomeColumns(columnResizeDrag.startWidths, columnResizeDrag.dividerIndex, delta, columnResizeDrag.availableWidth);
      setColumnWidths(nextWidths);
    };
    const onPointerUp = () => setColumnResizeDrag(null);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [columnResizeDrag, hideNavigation]);
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
        setFolders([]);
        setSharedInboxes([]);
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
  }, []);
  const handleEmailAccessExpired = useCallback(async (accessError: unknown) => {
    setNotice("");
    invalidateCommunicationsCache();
    setFolders([]);
    setMessages([]);
    setSelectedMessage(null);
    setSelectedMessageID("");
    setSelectedMessageIDs(new Set());
    setSelectionAnchorMessageID("");
    await loadStatus();
    setError(formatError(accessError, "Email access expired. Disconnect and reconnect your mailbox."));
  }, [loadStatus]);
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
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (status?.connected) void loadFolders(); }, [loadFolders, status?.connected]);
  useEffect(() => { if (status?.connected) void loadSharedInboxes(); }, [loadSharedInboxes, status?.connected]);
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
        void getEmailMessage(messageID, companyID)
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
  }, [apiBase, companyID, scheduleWorkspacePanelReload]);
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
    getEmailMessage(selectedMessageID, companyID)
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
  }, [companyID, handleEmailAccessExpired, selectedMessageID]);
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
      const updated = await updateEmailMessage(selectedMessage.id, update);
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
    void updateEmailMessage(messageID, { starred: nextStarred })
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
  }, [applyUpdatedMessageToCurrentView, handleEmailAccessExpired, scheduleMessageListRefresh]);
  const archiveMessages = useCallback(async (messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    setBusy("archive");
    setError("");
    setNotice("");
    try {
      await Promise.all(ids.map(archiveEmailMessage));
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
  }, [loadMessages, selectedMessageID]);
  const unarchiveMessages = useCallback(async (messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    setBusy("unarchive");
    setError("");
    setNotice("");
    try {
      await Promise.all(ids.map(unarchiveEmailMessage));
      setMessages((previous) => previous.filter((message) => !ids.includes(message.id)));
      if (selectedMessageID && ids.includes(selectedMessageID)) {
        setSelectedMessageID("");
        setSelectedMessage(null);
      }
      setSelectedMessageIDs(new Set());
      setSelectionAnchorMessageID("");
      setMessageContextMenu(null);
      setNotice(ids.length === 1 ? "Message moved to Pending." : `${ids.length} messages moved to Pending.`);
      await loadMessages();
    } catch (unarchiveError) {
      setError(formatError(unarchiveError, ids.length === 1 ? "Failed to unarchive message" : "Failed to unarchive messages"));
    } finally {
      setBusy("");
    }
  }, [loadMessages, selectedMessageID]);
  const autoArchiveScrolledMessages = useCallback((messageIDs: string[]) => {
    if (!status?.connected || activeViewIDRef.current !== "my-triage" || mailboxRef.current !== "primary") return;
    const ids = cleanIDList(messageIDs).filter((id) => !autoArchivingMessageIDsRef.current.has(id));
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    ids.forEach((id) => autoArchivingMessageIDsRef.current.add(id));
    setMessages((previous) => previous.filter((message) => !idSet.has(message.id)));
    setSelectedMessageIDs((previous) => {
      const next = new Set(Array.from(previous).filter((id) => !idSet.has(id)));
      return next.size === previous.size ? previous : next;
    });
    setSelectionAnchorMessageID((current) => (idSet.has(current) ? "" : current));
    if (selectedMessageIDRef.current && idSet.has(selectedMessageIDRef.current)) {
      setSelectedMessageID("");
      setSelectedMessage(null);
    }
    setMessageContextMenu((current) => current && current.messageIDs.some((id) => idSet.has(id)) ? null : current);
    void Promise.allSettled(ids.map(archiveEmailMessage))
      .then((results) => {
        ids.forEach((id) => autoArchivingMessageIDsRef.current.delete(id));
        const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (!rejected) return;
        if (isEmailAccessExpiredError(rejected.reason)) {
          void handleEmailAccessExpired(rejected.reason);
          return;
        }
        setError(formatError(rejected.reason, ids.length === 1 ? "Failed to archive scrolled message" : "Failed to archive scrolled messages"));
        scheduleMessageListRefresh();
      });
  }, [handleEmailAccessExpired, scheduleMessageListRefresh, status?.connected]);
  const archiveSelected = async () => {
    if (!selectedMessage) return;
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
  const createSharedInboxFolder = useCallback(async (parentFolderID: string, rawName = "New Folder"): Promise<CommunicationsSharedInbox | null> => {
    const name = rawName.trim();
    if (!name) return null;
    setBusy("shared-inbox");
    setError("");
    setNotice("");
    try {
      const folder = await createCommunicationsSharedInbox({ companyID, name, parentFolderID });
      setSharedInboxes((previous) => sortSharedInboxes([
        ...previous.filter((item) => item.folder_id !== folder.folder_id),
        folder,
      ]));
      setActiveViewID(`shared:${folder.folder_id}`);
      selectMailbox("primary");
      return folder;
    } catch (sharedInboxError) {
      setError(formatError(sharedInboxError, "Failed to create Shared Triage"));
      return null;
    } finally {
      setBusy("");
    }
  }, [companyID, selectMailbox]);

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
  const currentUserID = me?.user.user_id?.trim() ?? "";
  const logicGateByID = useMemo(() => new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate])), [logicGates]);
  const myNodes = useMemo(() => {
    if (!currentUserID) return [];
    return sortNodesForInbox(nodes.filter((node) => nodeHasLogicGateRaciRole(node, logicGateByID, "responsible", currentUserID)));
  }, [currentUserID, logicGateByID, nodes]);
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
      q: searchQueryRef.current,
      unread: unreadOnlyRef.current ? true : undefined,
    });
    setMessages((previous) => mergeEmailMessageIntoMessageList(previous, optimistic, listParams()));
    setSelectedMessage((current) => (current?.id === messageID ? { ...current, unread: false } : current));
    void updateEmailMessage(messageID, { unread: false })
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
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    setMessageContextMenu(null);
    setDeleteConfirmation({ messageIDs: ids });
  }, []);
  const requestDeleteSelection = useCallback(() => {
    requestDeleteMessages(getSelectedMessageIDsForAction());
  }, [getSelectedMessageIDsForAction, requestDeleteMessages]);
  const deleteSelected = useCallback(() => {
    if (!selectedMessage) return;
    requestDeleteSelection();
  }, [requestDeleteSelection, selectedMessage]);
  const deleteMessages = useCallback(async (messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    setBusy("delete");
    setError("");
    try {
      await Promise.all(ids.map(deleteEmailMessage));
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
  }, [loadMessages, selectedMessageID]);
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
    preloadLogicGateArenaSurface();
    if (onNavigate) onNavigate("/logic-gate-arena");
    else window.location.assign("/logic-gate-arena");
  }, [companyID, onNavigate]);
  const getLogicGateDragIDs = useCallback((logicGateID: string): string[] => {
    const cleanLogicGateID = logicGateID.trim();
    if (!cleanLogicGateID) return [];
    if (!selectedLogicGateRowIDs.has(logicGateTreeID(cleanLogicGateID))) return [cleanLogicGateID];
    const selectedLogicGateIDs = cleanIDList(Array.from(selectedLogicGateRowIDs).map(logicGateIDFromTreeID))
      .filter((id) => logicGateByID.has(id));
    return selectedLogicGateIDs.length > 0 ? selectedLogicGateIDs : [cleanLogicGateID];
  }, [logicGateByID, selectedLogicGateRowIDs]);
  const startColumnResize = useCallback((dividerIndex: 0 | 1 | 2, event: React.PointerEvent<HTMLButtonElement>) => {
    if (isNarrow) return;
    event.preventDefault();
    setColumnResizeDrag({
      dividerIndex,
      startX: event.clientX,
      startWidths: columnWidths,
      availableWidth: getHomeWorkspaceTrackWidth(workspaceRef.current),
    });
  }, [columnWidths, isNarrow]);
  const activeViewLabel = getHomeViewLabel(activeViewID, sharedInboxes);
  const isArchivableListView = isArchivableHomeViewID(activeViewID);
  const isArchiveMailbox = isArchivableListView && mailbox === "archive";
  const listViewLabel = isArchivableListView ? mailboxLabel(mailbox) : activeViewLabel;
  const mailboxActionBusy = busy === "archive" || busy === "unarchive";
  const unreadMessageCount = messages.reduce((count, message) => count + (message.unread ? 1 : 0), 0);
  const mailFilterStatus = selectedMessageIDs.size > 1
    ? `${selectedMessageIDs.size} selected`
    : (loadingMessages || loadingMoreMessages) ? "Loading" : "";
  const isAciInboxView = activeViewID === "aci-inbox";
  const isResponsibleInboxView = activeViewID === "r-inbox";
  const isInboxMatrixView = isAciInboxView || isResponsibleInboxView;
  const workspaceGridTemplateColumns = isNarrow
    ? "1fr"
    : hideNavigation
      ? isInboxMatrixView
        ? getInboxMatrixGridTemplateColumnsWithoutSidebar(columnWidths)
        : getHomeGridTemplateColumnsWithoutSidebar(columnWidths)
      : isInboxMatrixView
        ? getInboxMatrixGridTemplateColumns(columnWidths)
        : getHomeGridTemplateColumns(columnWidths);
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
              sharedInboxes={sharedInboxes}
              loadingSharedInboxes={loadingSharedInboxes}
              newSharedInboxName={newSharedInboxName}
              busy={busy}
              onSelectView={selectHomeView}
              onNewSharedInboxNameChange={setNewSharedInboxName}
              onSubmitSharedInbox={submitSharedInbox}
              onCreateSharedInbox={createSharedInboxFolder}
              onRenameSharedInbox={renameSharedInboxFolder}
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
                  currentUserID={currentUserID}
                  selectedRowIDs={selectedNodeRowIDs}
                  getNodeDragIDs={getNodeDragIDs}
                  onSelectNode={selectNodeMatrixCard}
                  onOpenNode={openNodeEditorOverlay}
                  onOpenLogicGate={openLogicGateArena}
                />
              ) : (
                <ResponsibleInboxMatrix
                  loading={loadingNodes}
                  nodes={nodes}
                  nodeByID={nodeByID}
                  logicGateByID={logicGateByID}
                  currentUserID={currentUserID}
                  selectedRowIDs={selectedNodeRowIDs}
                  getNodeDragIDs={getNodeDragIDs}
                  onSelectNode={selectNodeMatrixCard}
                  onOpenNode={openNodeEditorOverlay}
                  onOpenLogicGate={openLogicGateArena}
                />
              )}
              {hideNavigation && !isNarrow && <HomeColumnResizeHandle dividerIndex={2} onPointerDown={startColumnResize} />}
              <NodeInboxRail
                loading={loadingNodes}
                nodeByID={nodeByID}
                allRows={visibleNodeRows}
                myNodes={myNodes}
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
              />
            </>
          ) : (
            <>
          {!hideNavigation && !isNarrow && <HomeColumnResizeHandle dividerIndex={0} onPointerDown={startColumnResize} />}
          <HomeMailWorkspace
            activeViewID={activeViewID}
            accountEmail={connection?.account_email}
            archiveAvailable
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
            searchDraft={searchDraft}
            selectedMessage={selectedMessage}
            selectedMessageID={selectedMessageID}
            selectedMessageIDs={selectedMessageIDs}
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
      {nodeEditorOverlay && (
        <NodeEditorPopup
          nodeID={nodeEditorOverlay.nodeID}
          nodeTitle={nodeEditorOverlay.nodeTitle}
          onClose={() => setNodeEditorOverlay(null)}
        />
      )}
    </div>
  );
}
export const HomeFrameContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "mango" | "teal" | "light" | "dark" }> = () => (
  <HomePage embedded />
);
export type { HomePageProps, HomeViewID } from "./homeTypes";
