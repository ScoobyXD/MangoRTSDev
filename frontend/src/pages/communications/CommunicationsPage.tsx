import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readAuthConfig, type CurrentUserResponse } from "../../auth/cognitoAuth";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { MangoWordmark } from "../../app/MangoLogo";
import { preloadLogicGateArenaSurface } from "../../app/preloadDashboardModules";
import {
  applyEmailMessageToCachedPages,
  archiveEmailMessage,
  createCommunicationsSharedInbox,
  addMyLogicGateShortcuts,
  convertTriageMessagesToLogicGate,
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
  unarchiveEmailMessage,
  updateEmailMessage,
  type CommunicationsSharedInbox,
  type EmailAddress,
  type EmailFolder,
  type EmailMailbox,
  type EmailMessage,
  type CommunicationsStatus,
  type UserLogicGateShortcut,
} from "./communicationsApi";
import { subscribeCommunicationsStream } from "./communicationsStream";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../modules/folders/companyExplorerFolders";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import { EditorContent } from "../../modules/editor/EditorContent";
import { getNodeTitle, type NodeRecord } from "../../modules/node-map/shared";
import {
  collectFolderSubtreeIDs,
  EXPLORER_DRAG_MIME,
  getExplorerDragPayloadForSelection,
  readExplorerDragPayload,
} from "../../modules/company-explorer/companyExplorerDragDrop";
import { buildCompanyExplorerTreeRows } from "../../modules/company-explorer/companyExplorerTreeRows";
import { getExplorerDropPayloadItems, resolveExplorerClickSelection } from "../../modules/company-explorer/treePresentation";
import type { ExplorerDragPayload, ExplorerTreeNode } from "../../modules/company-explorer/companyExplorerTypes";
import type { LogicGateRaciRole, LogicGateRecord } from "../../modules/logic-gate-map/shared";
import { invalidateNodeRecordStoreCaches } from "../../modules/node-map/NodeRecordStore";
import { upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../../modules/node-map/NodeRelationshipGraph";
import { upsertCompanyExplorerFolderItemInLogicGateRelationshipGraph } from "../../modules/logic-gate-map/LogicGateRelationshipGraph";
import { invalidateKanbanBoardContentsCache } from "../../modules/kanban/KanbanBoardContentStore";
import { invalidateKanbanBoardListCache, invalidateLogicGateArenaViewCache } from "../../modules/kanban/kanbanApi";
import { subscribeWorkspaceStream } from "../../modules/workspace/workspaceStream";
import {
  attachStackedDragPreview,
  EVENT_KANBAN_BOARD_CONTENTS_UPDATED,
  EVENT_KANBAN_BOARDS_UPDATED,
  KANBAN_LOGIC_GATE_DONE_COLOR,
  KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR,
  KANBAN_LOGIC_GATE_PENDING_COLOR,
  logicGateKanbanBoardID,
  type KanbanBoardContentsUpdatedDetail,
  type KanbanBoardsUpdatedDetail,
} from "../../modules/kanban/shared";
import { writePendingLogicGateArenaSelection } from "../logic-gate-arena/logicGateArenaLaunch";

type CommunicationsPageProps = {
  me?: CurrentUserResponse;
  onNavigate?: (path: string) => void;
  embedded?: boolean;
  hideNavigation?: boolean;
  initialViewID?: CommunicationsViewID;
};

type ComposeState = {
  open: boolean;
  replyToMessageID: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
};

const emptyCompose: ComposeState = {
  open: false,
  replyToMessageID: "",
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
};

type MailboxOption = {
  value: EmailMailbox;
  label: string;
};

type MessageSelectionModifiers = {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

type CommunicationsStreamEnvelope = {
  type?: string;
  trigger?: string;
  message_id?: string;
};

type WorkspaceStreamEnvelope = {
  company_id?: string;
  type?: string;
};

type LoadMessagesOptions = {
  refresh?: boolean;
};

type CommunicationsViewID =
  | "primary"
  | "my-triage"
  | "shared-root"
  | "aci-inbox"
  | "r-inbox"
  | "my-nodes"
  | "my-logic-gates"
  | `shared:${string}`;

type CommunicationsColumnWidths = [number, number, number, number];

type NodeEditorOverlayState = {
  nodeID: string;
  nodeTitle: string;
};

type CommunicationsColumnResizeDrag = {
  dividerIndex: 0 | 1 | 2;
  startX: number;
  startWidths: CommunicationsColumnWidths;
  availableWidth: number;
};

type AciInboxRole = Extract<LogicGateRaciRole, "accountable" | "consulted" | "informed">;
type ResponsibleInboxStatus = "pending" | "in_progress" | "done";
type InboxPriority = 0 | 1 | 2 | 3 | 4 | 5;

type InboxLogicGateNodeGroup = {
  logicGateID: string;
  label: string;
  nodeIDs: string[];
};

const MAILBOX_OPTIONS: MailboxOption[] = [
  { value: "primary", label: "My Triage" },
  { value: "sent", label: "Sent mail" },
  { value: "all", label: "All mail" },
  { value: "archive", label: "Archives" },
];

const MESSAGE_BATCH_SIZE = 15;
const MESSAGE_EVENT_REFRESH_DELAY_MS = 1_200;
const SELF_SEND_DELIVERY_REFRESH_DELAY_MS = 4_000;
const TRIAGE_MESSAGE_DRAG_MIME = "application/x-mangorts-communications-triage-messages";
const COMMUNICATIONS_COLUMN_WIDTHS_STORAGE_KEY = "mangorts.communications.columnWidths.v1";
const COMMUNICATIONS_COLUMN_RESIZER_WIDTH = 10;
const COMMUNICATIONS_ROW_RESIZER_HEIGHT = 10;
const COMMUNICATIONS_LOGIC_GATE_RAIL_HEIGHT_STORAGE_KEY = "mangorts.communications.logicGateRailTopHeight.v1";
const COMMUNICATIONS_NODE_RAIL_HEIGHT_STORAGE_KEY = "mangorts.communications.nodeRailTopHeight.v1";
const COMMUNICATIONS_COLUMN_MIN_WIDTHS: CommunicationsColumnWidths = [170, 280, 220, 280];
const COMMUNICATIONS_COLUMN_MAX_WIDTHS: CommunicationsColumnWidths = [360, 760, 1600, 1600];
const INBOX_NO_LOGIC_GATE_ID = "__mango_inbox_no_logic_gate__";

const ACI_COLUMNS: ReadonlyArray<{ role: AciInboxRole; letter: string; label: string }> = [
  { role: "accountable", letter: "A", label: "Accountable" },
  { role: "consulted", letter: "C", label: "Consulted" },
  { role: "informed", letter: "I", label: "Informed" },
];

const RESPONSIBLE_STATUS_COLUMNS: ReadonlyArray<{ status: ResponsibleInboxStatus; letter: string; label: string }> = [
  { status: "pending", letter: "P", label: "Pending" },
  { status: "in_progress", letter: "IP", label: "In Progress" },
  { status: "done", letter: "D", label: "Done" },
];

const INBOX_PRIORITIES: ReadonlyArray<{ value: InboxPriority; label: string }> = [
  { value: 1, label: "1\u00A0\u00A0URGENT (<1 hr)" },
  { value: 2, label: "2\u00A0\u00A0By end of day" },
  { value: 3, label: "3\u00A0\u00A0Within a few days" },
  { value: 4, label: "4\u00A0\u00A0Within the week" },
  { value: 5, label: "5\u00A0\u00A0Later (low priority)" },
  { value: 0, label: "0\u00A0\u00A0Unassigned" },
];

export function CommunicationsPage({ me, onNavigate, embedded = false, hideNavigation = false, initialViewID = "my-triage" }: CommunicationsPageProps) {
  const companyID = getActiveCompanyID();
  const apiBase = readAuthConfig().apiBase;
  const [status, setStatus] = useState<CommunicationsStatus | null>(null);
  const [, setFolders] = useState<EmailFolder[]>([]);
  const [sharedInboxes, setSharedInboxes] = useState<CommunicationsSharedInbox[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [mailbox, setMailbox] = useState<EmailMailbox>("primary");
  const [activeViewID, setActiveViewID] = useState<CommunicationsViewID>(initialViewID);
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
  const [columnWidths, setColumnWidths] = useState<CommunicationsColumnWidths>(() => readCommunicationsColumnWidths());
  const [columnResizeDrag, setColumnResizeDrag] = useState<CommunicationsColumnResizeDrag | null>(null);
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
  const activeViewIDRef = useRef<CommunicationsViewID>(initialViewID);
  const folderReloadTimerRef = useRef<number | null>(null);
  const workspacePanelReloadTimerRef = useRef<number | null>(null);
  const messageListRefreshTimerRef = useRef<number | null>(null);
  const messagesRef = useRef<EmailMessage[]>([]);
  const mailboxRef = useRef<EmailMailbox>("primary");
  const nextPageTokenRef = useRef("");
  const searchQueryRef = useRef("");
  const unreadOnlyRef = useRef(false);
  const loadingMessagesRef = useRef(false);
  const loadingMoreMessagesRef = useRef(false);
  const messageListFilterKeyRef = useRef("");
  const markingReadMessageIDsRef = useRef<Set<string>>(new Set());
  const workspaceRef = useRef<HTMLElement | null>(null);

  const isNarrow = viewportWidth < 980;

  const markMessageReadOnOpen = useCallback((message: EmailMessage) => {
    if (activeViewIDRef.current !== "my-triage" || !message.id || !message.unread) return;
    if (markingReadMessageIDsRef.current.has(message.id)) return;
    markingReadMessageIDsRef.current.add(message.id);

    const applyReadState = (readMessage: EmailMessage) => {
      setMessages((previous) => unreadOnlyRef.current
        ? previous.filter((item) => item.id !== readMessage.id)
        : previous.map((item) => (item.id === readMessage.id ? { ...item, ...readMessage, unread: false } : item)));
      setSelectedMessage((current) => current?.id === readMessage.id ? { ...current, ...readMessage, unread: false } : current);
    };

    applyReadState({ ...message, unread: false });
    updateEmailMessage(message.id, { unread: false })
      .then((updated) => applyReadState(updated))
      .catch((markReadError) => {
        if (activeViewIDRef.current === "my-triage") {
          setError(formatError(markReadError, "Failed to mark message read"));
        }
      })
      .finally(() => {
        markingReadMessageIDsRef.current.delete(message.id);
      });
  }, []);

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
          ? resizeInboxMatrixColumnsWithoutSidebar(columnResizeDrag.startWidths, columnResizeDrag.dividerIndex, delta, columnResizeDrag.availableWidth)
          : resizeCommunicationsColumnsWithoutSidebar(columnResizeDrag.startWidths, columnResizeDrag.dividerIndex, delta, columnResizeDrag.availableWidth)
        : resizeCommunicationsColumns(columnResizeDrag.startWidths, columnResizeDrag.dividerIndex, delta, columnResizeDrag.availableWidth);
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
    saveCommunicationsColumnWidths(columnWidths);
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
        return next;
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
    if (!isWorkspacePanelCommunicationsViewID(activeViewID)) return;
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
        if (!workspaceEventTouchesCommunicationsPanel(type)) return;
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
          setSelectedMessage(message);
          markMessageReadOnOpen(message);
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
  }, [companyID, handleEmailAccessExpired, markMessageReadOnOpen, selectedMessageID]);

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

  const selectCommunicationsView = useCallback((viewID: CommunicationsViewID, nextMailbox: EmailMailbox = "primary") => {
    setActiveViewID(viewID);
    selectMailbox(nextMailbox);
  }, [selectMailbox]);

  useEffect(() => {
    if (activeViewID === initialViewID) return;
    selectCommunicationsView(initialViewID, mailboxForCommunicationsView(initialViewID));
  }, [activeViewID, initialViewID, selectCommunicationsView]);

  const patchSelectedMessage = async (update: { unread?: boolean; starred?: boolean; folders?: string[] }) => {
    if (!selectedMessage) return;
    setBusy("message");
    setError("");
    try {
      const updated = await updateEmailMessage(selectedMessage.id, update);
      setSelectedMessage(updated);
      setMessages((previous) => previous.map((message) => (message.id === updated.id ? { ...message, ...updated } : message)));
      if (update.folders) await loadMessages();
    } catch (updateError) {
      setError(formatError(updateError, "Failed to update message"));
    } finally {
      setBusy("");
    }
  };

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
      setNotice(ids.length === 1 ? "Message moved to My Triage." : `${ids.length} messages moved to My Triage.`);
      await loadMessages();
    } catch (unarchiveError) {
      setError(formatError(unarchiveError, ids.length === 1 ? "Failed to unarchive message" : "Failed to unarchive messages"));
    } finally {
      setBusy("");
    }
  }, [loadMessages, selectedMessageID]);

  const archiveSelected = async () => {
    if (!selectedMessage) return;
    if (mailboxRef.current === "archive") await unarchiveMessages([selectedMessage.id]);
    else await archiveMessages([selectedMessage.id]);
  };

  const openArchives = useCallback(() => {
    setCompose(emptyCompose);
    selectMailbox("archive");
  }, [selectMailbox]);

  const openMyTriageMailbox = useCallback(() => {
    setCompose(emptyCompose);
    selectMailbox("primary");
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

  const submitSharedInbox = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newSharedInboxName.trim();
    if (!name) return;
    const parentFolderID = activeViewID.startsWith("shared:") ? activeViewID.slice("shared:".length) : "";
    setBusy("shared-inbox");
    setError("");
    try {
      const folder = await createCommunicationsSharedInbox({ companyID, name, parentFolderID });
      setSharedInboxes((previous) => sortSharedInboxes([...previous, folder]));
      setNewSharedInboxName("");
      setActiveViewID(`shared:${folder.folder_id}`);
    } catch (sharedInboxError) {
      setError(formatError(sharedInboxError, "Failed to create Shared Triage"));
    } finally {
      setBusy("");
    }
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
    setSelectedMessageIDs(new Set(orderedSelectedIDs));
    setSelectionAnchorMessageID(next.anchorID);
    setSelectedMessageID(primaryID);
    setMessageContextMenu(null);
    markMessageReadOnOpen(messages.find((item) => item.id === primaryID) ?? message);
  }, [markMessageReadOnOpen, messages, selectedMessageIDs, selectionAnchorMessageID]);

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

  const archiveSelection = useCallback(() => {
    void archiveMessages(getSelectedMessageIDsForAction());
  }, [archiveMessages, getSelectedMessageIDsForAction]);

  const unarchiveSelection = useCallback(() => {
    void unarchiveMessages(getSelectedMessageIDsForAction());
  }, [getSelectedMessageIDsForAction, unarchiveMessages]);

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
      availableWidth: getCommunicationsWorkspaceTrackWidth(workspaceRef.current),
    });
  }, [columnWidths, isNarrow]);

  const activeViewLabel = getCommunicationsViewLabel(activeViewID, sharedInboxes);
  const isArchivableListView = isArchivableCommunicationsViewID(activeViewID);
  const isArchiveMailbox = isArchivableListView && mailbox === "archive";
  const listViewLabel = isArchiveMailbox ? "All Archives" : activeViewLabel;
  const returnMailboxLabel = activeViewID === "my-triage" || activeViewID === "primary" ? "My Triage" : activeViewLabel;
  const mailboxActionBusy = busy === "archive" || busy === "unarchive";
  const unreadMessageCount = messages.reduce((count, message) => count + (message.unread ? 1 : 0), 0);
  const mailFilterStatus = selectedMessageIDs.size > 1
    ? `${selectedMessageIDs.size} selected`
    : (loadingMessages || loadingMoreMessages) ? "Loading" : "";
  const isAciInboxView = activeViewID === "aci-inbox";
  const isResponsibleInboxView = activeViewID === "r-inbox";
  const isInboxMatrixView = isAciInboxView || isResponsibleInboxView;
  const selectedMessageActionCount = getSelectedMessageIDsForAction().length;
  const workspaceGridTemplateColumns = isNarrow
    ? "1fr"
    : hideNavigation
      ? isInboxMatrixView
        ? getInboxMatrixGridTemplateColumnsWithoutSidebar(columnWidths)
        : getCommunicationsGridTemplateColumnsWithoutSidebar(columnWidths)
      : isInboxMatrixView
        ? getInboxMatrixGridTemplateColumns(columnWidths)
        : getCommunicationsGridTemplateColumns(columnWidths);

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
          {!hideNavigation && <aside style={sidebarStyle}>
            <nav style={sidebarNavStyle} aria-label="Home triage">
              <CommunicationsNavButton label="My Triage" active={activeViewID === "my-triage" || activeViewID === "primary"} onClick={() => selectCommunicationsView("my-triage", "primary")} />
              <section style={sidebarSectionStyle}>
                <button
                  type="button"
                  style={navButtonStyle(activeViewID === "shared-root")}
                  onClick={() => selectCommunicationsView("shared-root", "primary")}
                >
                  <span style={navLabelStyle}>Shared Triage</span>
                  {loadingSharedInboxes && <span style={navMetaStyle}>Loading</span>}
                </button>
                <div style={sharedInboxRowsStyle}>
                  {buildSharedInboxRows(sharedInboxes).map((row) => (
                    <CommunicationsNavButton
                      key={row.folder.folder_id}
                      label={row.folder.name}
                      depth={row.depth}
                      active={activeViewID === `shared:${row.folder.folder_id}`}
                      onClick={() => selectCommunicationsView(`shared:${row.folder.folder_id}`, "primary")}
                    />
                  ))}
                </div>
                <form style={sharedInboxCreateStyle} onSubmit={submitSharedInbox}>
                  <input
                    style={sharedInboxInputStyle}
                    value={newSharedInboxName}
                    onChange={(event) => setNewSharedInboxName(event.target.value)}
                    placeholder="New shared triage"
                  />
                  <button style={sharedInboxCreateButtonStyle} disabled={busy === "shared-inbox" || !newSharedInboxName.trim()} aria-label="Create Shared Triage">+</button>
                </form>
              </section>
              <CommunicationsNavButton label="ACI Inbox" active={activeViewID === "aci-inbox"} onClick={() => selectCommunicationsView("aci-inbox", "all")} />
              <CommunicationsNavButton label="R Inbox" active={activeViewID === "r-inbox"} onClick={() => selectCommunicationsView("r-inbox", "all")} />
              <CommunicationsNavButton label="My Nodes" active={activeViewID === "my-nodes"} onClick={() => selectCommunicationsView("my-nodes", "all")} />
              <CommunicationsNavButton label="My Logic Gates" active={activeViewID === "my-logic-gates"} onClick={() => selectCommunicationsView("my-logic-gates", "all")} />
            </nav>
          </aside>}

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
              {hideNavigation && !isNarrow && <CommunicationsColumnResizeHandle dividerIndex={2} onPointerDown={startColumnResize} />}
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
          {!hideNavigation && !isNarrow && <CommunicationsColumnResizeHandle dividerIndex={0} onPointerDown={startColumnResize} />}

          <section style={mailPanelStyle}>
            <div style={mailPanelControlsStyle}>
              {isArchivableListView ? (
                <div style={triageMailListHeaderStyle}>
                  <div style={mailListTitleStackStyle}>
                    <h2 style={panelTitleStyle}>{listViewLabel}</h2>
                    <span style={mutedSmallStyle}>{unreadMessageCount} unread</span>
                  </div>
                  <div style={accountRowStyle}>
                    <span style={accountEmailStyle}>{connection?.account_email}</span>
                    <button style={smallButtonStyle} disabled={busy === "disconnect"} onClick={disconnect}>Disconnect</button>
                  </div>
                </div>
              ) : (
                <div style={mailListToolbarStyle}>
                  <div style={mailListTitleStackStyle}>
                    <h2 style={panelTitleStyle}>{listViewLabel}</h2>
                  </div>
                  <button style={primaryButtonStyle} onClick={openNewCompose}>Compose</button>
                </div>
              )}
              {error && <div style={inlineErrorStyle}>{error}</div>}
              {notice && !error && <div style={inlineNoticeStyle}>{notice}</div>}
              {isArchivableListView && (
                <div style={mailArchiveActionsStyle}>
                  <button
                    type="button"
                    style={mailArchiveActionButtonStyle(!isArchiveMailbox)}
                    onClick={() => {
                      if (isArchiveMailbox) openMyTriageMailbox();
                    }}
                  >
                    {returnMailboxLabel}
                  </button>
                  <button
                    type="button"
                    style={mailArchiveActionButtonStyle(isArchiveMailbox)}
                    onClick={() => {
                      if (!isArchiveMailbox) openArchives();
                    }}
                  >
                    All Archives
                  </button>
                  <button
                    type="button"
                    style={mailArchiveActionButtonStyle(false)}
                    disabled={mailboxActionBusy || selectedMessageActionCount === 0}
                    onClick={isArchiveMailbox ? unarchiveSelection : archiveSelection}
                  >
                    {mailboxActionBusy
                      ? isArchiveMailbox ? "Moving" : "Archiving"
                      : selectedMessageActionCount > 1
                        ? `${isArchiveMailbox ? "Unarchive" : "Archive"} ${selectedMessageActionCount}`
                        : isArchiveMailbox ? "Unarchive" : "Archive"}
                  </button>
                </div>
              )}
              {isArchivableListView && <button style={primaryButtonStyle} onClick={openNewCompose}>Compose</button>}
              {!isArchivableListView && (
                <div style={accountRowStyle}>
                  <span style={accountEmailStyle}>{connection?.account_email}</span>
                  <button style={smallButtonStyle} disabled={busy === "disconnect"} onClick={disconnect}>Disconnect</button>
                </div>
              )}
              <form style={searchRowStyle} onSubmit={submitSearch}>
                <input
                  style={inputStyle}
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Search mail"
                />
                <button type="submit" style={searchButtonStyle}>Search</button>
              </form>
              <div style={mailFiltersRowStyle}>
                <label style={checkboxStyle}>
                  <input
                    type="checkbox"
                    checked={unreadOnly}
                    onChange={(event) => {
                      setUnreadOnly(event.target.checked);
                      setNextPageToken("");
                    }}
                  />
                  <span>Unread only</span>
                </label>
                {mailFilterStatus && <span style={selectedCountStyle}>{mailFilterStatus}</span>}
              </div>
              {!isArchivableListView && (
                <div style={listHeaderStyle}>
                  <span>{mailboxLabel(mailbox)}</span>
                  {(loadingMessages || loadingMoreMessages) && <span>Loading</span>}
                </div>
              )}
            </div>
            <div
              ref={messageListRef}
              style={messageListStyle}
              onScroll={(event) => {
                const target = event.currentTarget;
                if (target.scrollHeight - target.scrollTop - target.clientHeight < 160) void loadMoreMessages();
              }}
            >
              {messages.length === 0 && !loadingMessages ? (
                <div style={emptyStateStyle}>{isArchiveMailbox ? "No archived messages" : "No messages"}</div>
              ) : messages.map((message) => {
                const active = selectedMessageIDs.has(message.id) || selectedMessageID === message.id;
                const draggable = activeViewID === "my-triage" && !isArchiveMailbox;
                return (
                <div
                  key={message.id}
                  role="button"
                  tabIndex={0}
                  style={isArchivableListView
                    ? triageMessageRowStyle(active, message.unread, draggable)
                    : messageRowStyle(active, message.unread)}
                  draggable={draggable}
                  onClick={(event) => selectMessageRow(message, event)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    selectMessageRow(message, event);
                  }}
                  onContextMenu={(event) => openMessageContextMenu(message, event)}
                  onDragStart={(event) => startMessageDrag(message, event)}
                >
                  {isArchivableListView ? (
                    <>
                      <MessagePlacementIcon message={message} active={active} />
                      <span style={triageMessageContentStyle}>
                        <strong style={triageSenderStyle}>{formatAddressList(message.from) || "Unknown sender"}</strong>
                        <span style={triageSubjectStyle}>{message.subject || "(no subject)"}</span>
                        <span style={snippetStyle}>{message.snippet || ""}</span>
                      </span>
                      <span style={triageMessageMetaStyle}>
                        <span style={triageDateStyle}>{formatMessageDate(message.date)}</span>
                        <button
                          type="button"
                          style={messageArchiveButtonStyle}
                          disabled={mailboxActionBusy}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (isArchiveMailbox) void unarchiveMessages([message.id]);
                            else void archiveMessages([message.id]);
                          }}
                        >
                          {isArchiveMailbox ? "Unarchive" : "Archive"}
                        </button>
                      </span>
                    </>
                  ) : (
                    <>
                      <span style={messageRowTopStyle}>
                        <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{formatAddressList(message.from) || "Unknown sender"}</strong>
                        <span>{formatMessageDate(message.date)}</span>
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message.subject || "(no subject)"}</span>
                      <span style={snippetStyle}>{message.snippet || ""}</span>
                    </>
                  )}
                </div>
                );
              })}
              {loadingMoreMessages && <div style={loadingMoreStyle}>Loading</div>}
            </div>
          </section>

          {!isNarrow && <CommunicationsColumnResizeHandle dividerIndex={1} onPointerDown={startColumnResize} />}

          <section style={panelStyle}>
            {compose.open ? (
              <ComposePanel
                compose={compose}
                busy={busy === "send"}
                onChange={setCompose}
                onCancel={() => setCompose(emptyCompose)}
                onSubmit={submitCompose}
              />
            ) : selectedMessage ? (
              <MessageDetail
                message={selectedMessage}
                loading={loadingDetail}
                archiveAvailable
                archiveLabel={isArchiveMailbox ? "Unarchive" : "Archive"}
                busy={!!busy}
                onReply={openReply}
                onArchive={archiveSelected}
                onDelete={deleteSelected}
                onToggleRead={() => patchSelectedMessage({ unread: !selectedMessage.unread })}
                onToggleStar={() => patchSelectedMessage({ starred: !selectedMessage.starred })}
              />
            ) : (
              <div style={emptyStateStyle}>Select a message or compose a new one</div>
            )}
          </section>

          {!isNarrow && <CommunicationsColumnResizeHandle dividerIndex={2} onPointerDown={startColumnResize} />}

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
          {messageContextMenu && (
            <div
              style={{ ...messageContextMenuStyle, left: messageContextMenu.x, top: messageContextMenu.y }}
              onMouseLeave={() => setMessageContextMenu(null)}
            >
              <button
                style={contextMenuActionStyle}
                disabled={mailboxActionBusy}
                onClick={() => {
                  if (isArchiveMailbox) void unarchiveMessages(messageContextMenu.messageIDs);
                  else void archiveMessages(messageContextMenu.messageIDs);
                }}
              >
                {isArchiveMailbox ? "Unarchive" : "Archive"}
              </button>
              <button
                style={{ ...contextMenuActionStyle, color: "#8b123f" }}
                disabled={busy === "delete"}
                onClick={() => requestDeleteMessages(messageContextMenu.messageIDs)}
              >
                Delete
              </button>
            </div>
          )}
          {deleteConfirmation && (
            <DeleteMessagesConfirmationModal
              count={deleteConfirmation.messageIDs.length}
              busy={busy === "delete"}
              onConfirm={() => {
                const ids = deleteConfirmation.messageIDs;
                setDeleteConfirmation(null);
                void deleteMessages(ids);
              }}
              onCancel={() => setDeleteConfirmation(null)}
            />
          )}
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

export const CommunicationsFrameContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "mango" | "teal" | "light" | "dark" }> = () => (
  <CommunicationsPage embedded />
);

function NodeEditorPopup({ nodeID, nodeTitle, onClose }: {
  nodeID: string;
  nodeTitle: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      style={nodeEditorPopupBackdropStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${nodeTitle} node editor`}
        data-frame-interactive="true"
        style={nodeEditorPopupStyle}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          title="Close node editor"
          onClick={onClose}
          style={nodeEditorPopupCloseButtonStyle}
        >
          X
        </button>
        <EditorContent
          accent="#ff8820"
          widgetId={`communications-node-editor-overlay:${nodeID}`}
          theme="mango"
          forcedEntityKind="node"
          forcedEntityID={nodeID}
          forcedLabel={nodeTitle}
        />
      </div>
    </div>
  );
}

function CommunicationsNavButton({ label, active, depth = 0, onClick }: {
  label: string;
  active: boolean;
  depth?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" style={{ ...navButtonStyle(active), paddingLeft: 10 + depth * 14 }} onClick={onClick}>
      <span style={navLabelStyle}>{label}</span>
    </button>
  );
}

function MessagePlacementIcon({ message, active }: { message: EmailMessage; active: boolean }) {
  const count = message.logic_gate_count ?? message.logic_gate_ids?.length ?? 0;
  if (count > 0) {
    return (
      <span style={messagePlacementIconStyle(active)} title={count === 1 ? "Sent to a Logic Gate" : `Sent to ${count} Logic Gates`}>
        <ExplorerRowIcon kind="logic_gate" />
      </span>
    );
  }
  return <span style={messageSelectDotStyle(active, message.unread)} title="Not sent to a Logic Gate" />;
}

function buildSharedInboxRows(folders: CommunicationsSharedInbox[]): Array<{ folder: CommunicationsSharedInbox; depth: number }> {
  const byParent = new Map<string, CommunicationsSharedInbox[]>();
  for (const folder of sortSharedInboxes(folders)) {
    const key = folder.parent_folder_id ?? "";
    const bucket = byParent.get(key) ?? [];
    bucket.push(folder);
    byParent.set(key, bucket);
  }
  const rows: Array<{ folder: CommunicationsSharedInbox; depth: number }> = [];
  const visit = (parentID: string, depth: number, seen: Set<string>) => {
    for (const folder of byParent.get(parentID) ?? []) {
      if (seen.has(folder.folder_id)) continue;
      rows.push({ folder, depth });
      visit(folder.folder_id, depth + 1, new Set([...seen, folder.folder_id]));
    }
  };
  visit("", 0, new Set());
  return rows;
}

function sortSharedInboxes(folders: CommunicationsSharedInbox[]): CommunicationsSharedInbox[] {
  return [...folders].sort((a, b) => a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp) || a.folder_id.localeCompare(b.folder_id));
}

function getCommunicationsViewLabel(viewID: CommunicationsViewID, sharedInboxes: CommunicationsSharedInbox[]): string {
  if (viewID === "primary") return "My Triage";
  if (viewID === "my-triage") return "My Triage";
  if (viewID === "shared-root") return "Shared Triage";
  if (viewID === "aci-inbox") return "ACI Inbox";
  if (viewID === "r-inbox") return "R Inbox";
  if (viewID === "my-nodes") return "My Nodes";
  if (viewID === "my-logic-gates") return "My Logic Gates";
  const folderID = viewID.startsWith("shared:") ? viewID.slice("shared:".length) : "";
  return sharedInboxes.find((folder) => folder.folder_id === folderID)?.name || "Shared Triage";
}

type MyLogicGateGroup = {
  key: string;
  label: string;
  logicGates: LogicGateRecord[];
};

function CommunicationsColumnResizeHandle({
  dividerIndex,
  onPointerDown,
}: {
  dividerIndex: 0 | 1 | 2;
  onPointerDown: (dividerIndex: 0 | 1 | 2, event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Resize Home column ${dividerIndex + 1}`}
      style={columnResizeHandleStyle}
      onPointerDown={(event) => onPointerDown(dividerIndex, event)}
    >
      <span style={columnResizeGripStyle} />
    </button>
  );
}

function useRailTopResize(storageKey: string, fallbackHeight = 240) {
  const railRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number; availableHeight: number } | null>(null);
  const [topHeight, setTopHeight] = useState(() => readRailTopHeight(storageKey, fallbackHeight));

  useEffect(() => {
    saveRailTopHeight(storageKey, topHeight);
  }, [storageKey, topHeight]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      const maxTopHeight = Math.max(120, drag.availableHeight - COMMUNICATIONS_ROW_RESIZER_HEIGHT - 160);
      setTopHeight(clampNumber(drag.startHeight + event.clientY - drag.startY, 96, maxTopHeight));
    };
    const onPointerUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  const startResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const availableHeight = railRef.current?.clientHeight ?? window.innerHeight;
    dragRef.current = { startY: event.clientY, startHeight: topHeight, availableHeight };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [topHeight]);

  return { railRef, topHeight, startResize };
}

function readRailTopHeight(storageKey: string, fallbackHeight: number): number {
  try {
    const stored = Number(localStorage.getItem(storageKey));
    return Number.isFinite(stored) ? clampNumber(stored, 96, 520) : fallbackHeight;
  } catch {
    return fallbackHeight;
  }
}

function saveRailTopHeight(storageKey: string, height: number): void {
  try {
    localStorage.setItem(storageKey, String(Math.round(height)));
  } catch {}
}

function RailRowResizeHandle({ onPointerDown }: { onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      aria-label="Resize rail sections"
      style={railRowResizeHandleStyle}
      onPointerDown={onPointerDown}
    >
      <span style={railRowResizeGripStyle} />
    </button>
  );
}

function LogicGateRail({
  loading,
  logicGateByID,
  folders,
  folderItems,
  allRows,
  selectedRowIDs,
  expandedRowIDs,
  search,
  myGroups,
  busy,
  getLogicGateDragIDs,
  onSearchChange,
  onToggleFolder,
  onSelectRow,
  onSelectShortcut,
  onOpenLogicGate,
  onAddShortcuts,
  onRemoveShortcut,
  onConvertMessages,
}: {
  loading: boolean;
  logicGateByID: Map<string, LogicGateRecord>;
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  allRows: ExplorerTreeNode[];
  selectedRowIDs: Set<string>;
  expandedRowIDs: Set<string>;
  search: string;
  myGroups: MyLogicGateGroup[];
  busy: boolean;
  getLogicGateDragIDs: (logicGateID: string) => string[];
  onSearchChange: (value: string) => void;
  onToggleFolder: (rowID: string) => void;
  onSelectRow: (row: ExplorerTreeNode, event: React.MouseEvent) => void;
  onSelectShortcut: (logicGateID: string, event: React.MouseEvent) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onAddShortcuts: (payload: ExplorerDragPayload | null) => void;
  onRemoveShortcut: (logicGateID: string) => void;
  onConvertMessages: (logicGateID: string, messageIDs: string[]) => void;
}) {
  const railSplit = useRailTopResize(COMMUNICATIONS_LOGIC_GATE_RAIL_HEIGHT_STORAGE_KEY, 240);

  return (
    <aside ref={railSplit.railRef} style={logicGateRailStyle(railSplit.topHeight)}>
      <section
        style={logicGateRailSectionStyle}
        onDragOver={(event) => {
          if (!hasExplorerDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          const payload = readExplorerDragPayload(event.dataTransfer);
          if (logicGateIDsFromExplorerPayload(payload, folders, folderItems).length === 0) return;
          event.preventDefault();
          onAddShortcuts(payload);
        }}
      >
        <div style={logicGateRailHeaderStyle}>
          <h2 style={panelTitleStyle}>My Logic Gates</h2>
          {loading && <span style={mutedSmallStyle}>Loading</span>}
        </div>
        <div style={myLogicGatesListStyle}>
          {myGroups.length === 0 ? (
            <div style={emptySmallStyle}>No shortcuts</div>
          ) : myGroups.map((group) => (
            <div key={group.key} style={myLogicGateGroupStyle}>
              <div style={myLogicGateFolderLabelStyle}>
                <ExplorerRowIcon kind="folder" />
                <span>{group.label}</span>
              </div>
              <div style={myLogicGateGridStyle}>
                {group.logicGates.map((logicGate) => (
                  <MyLogicGateTile
                    key={logicGate.logic_gate_id}
                    logicGate={logicGate}
                    selected={selectedRowIDs.has(logicGateTreeID(logicGate.logic_gate_id))}
                    busy={busy}
                    getLogicGateDragIDs={getLogicGateDragIDs}
                    logicGateByID={logicGateByID}
                    onSelectShortcut={onSelectShortcut}
                    onOpenLogicGate={onOpenLogicGate}
                    onRemoveShortcut={onRemoveShortcut}
                    onConvertMessages={onConvertMessages}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <RailRowResizeHandle onPointerDown={railSplit.startResize} />

      <section style={{ ...logicGateRailSectionStyle, gridTemplateRows: "auto auto minmax(0, 1fr)" }}>
        <div style={logicGateRailHeaderStyle}>
          <h2 style={panelTitleStyle}>All Logic Gates</h2>
          {loading && <span style={mutedSmallStyle}>Loading</span>}
        </div>
        <input
          style={inputStyle}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search Logic Gates"
        />
        <div style={allLogicGateRowsStyle}>
          {allRows.length === 0 && !loading ? (
            <div style={emptySmallStyle}>No Logic Gates</div>
          ) : allRows.map((row) => {
            const selected = selectedRowIDs.has(row.id);
            const isFolder = row.kind === "folder";
            const logicGateID = row.logicGateID ?? "";
            const logicGate = logicGateID ? logicGateByID.get(logicGateID) : undefined;
            return (
              <div
                key={row.id}
                draggable
                style={logicGateTreeRowStyle(row.depth, selected, row.kind === "logic_gate")}
                onClick={(event) => onSelectRow(row, event)}
                onDoubleClick={(event) => {
                  if (row.kind !== "logic_gate" || !logicGateID) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenLogicGate(logicGateID, logicGateTitle(logicGate));
                }}
                onDragStart={(event) => {
                  const payload = getExplorerDragPayloadForSelection(row, selectedRowIDs, allRows);
                  if (!payload) return;
                  event.dataTransfer.effectAllowed = row.kind === "folder" ? "copyMove" : "copy";
                  event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(payload));
                  event.dataTransfer.setData("text/plain", row.label);
                }}
                onDragOver={(event) => {
                  if (row.kind !== "logic_gate" || !hasTriageMessageDrag(event.dataTransfer)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  if (row.kind !== "logic_gate" || !logicGateID) return;
                  const messageIDs = readTriageMessageIDs(event.dataTransfer);
                  if (messageIDs.length === 0) return;
                  event.preventDefault();
                  onConvertMessages(logicGateID, messageIDs);
                }}
              >
                {isFolder ? (
                  <button
                    type="button"
                    draggable={false}
                    style={logicGateDisclosureStyle}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFolder(row.id);
                    }}
                  >
                    <ExplorerDisclosureIcon open={expandedRowIDs.has(row.id)} color="rgba(36, 18, 10, 0.62)" />
                  </button>
                ) : (
                  <span style={{ width: 18, flexShrink: 0 }} />
                )}
                <ExplorerRowIcon kind={row.kind} systemKey={row.systemKey} />
                <span style={logicGateTreeRowTextStyle}>{logicGate?.header || row.label}</span>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

function MyLogicGateTile({
  logicGate,
  selected,
  busy,
  logicGateByID,
  getLogicGateDragIDs,
  onSelectShortcut,
  onOpenLogicGate,
  onRemoveShortcut,
  onConvertMessages,
}: {
  logicGate: LogicGateRecord;
  selected: boolean;
  busy: boolean;
  logicGateByID: Map<string, LogicGateRecord>;
  getLogicGateDragIDs: (logicGateID: string) => string[];
  onSelectShortcut: (logicGateID: string, event: React.MouseEvent) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onRemoveShortcut: (logicGateID: string) => void;
  onConvertMessages: (logicGateID: string, messageIDs: string[]) => void;
}) {
  const logicGateID = logicGate.logic_gate_id;
  return (
    <button
      type="button"
      draggable
      style={myLogicGateTileStyle(selected)}
      onClick={(event) => onSelectShortcut(logicGateID, event)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenLogicGate(logicGateID, logicGateTitle(logicGate));
      }}
      onDragStart={(event) => {
        const dragIDs = getLogicGateDragIDs(logicGateID);
        setLogicGateDragData(event.dataTransfer, dragIDs, logicGateByID);
      }}
      onDragOver={(event) => {
        if (!hasTriageMessageDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        const messageIDs = readTriageMessageIDs(event.dataTransfer);
        if (messageIDs.length === 0) return;
        event.preventDefault();
        onConvertMessages(logicGateID, messageIDs);
      }}
    >
      <span style={myLogicGateTileIconStyle}><ExplorerRowIcon kind="logic_gate" /></span>
      <span style={myLogicGateTileTextStyle}>{logicGateTitle(logicGate)}</span>
      <span
        role="button"
        tabIndex={0}
        aria-label="Remove shortcut"
        style={shortcutRemoveStyle}
        onClick={(event) => {
          event.stopPropagation();
          if (!busy) onRemoveShortcut(logicGateID);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !busy) {
            event.preventDefault();
            event.stopPropagation();
            onRemoveShortcut(logicGateID);
          }
        }}
      >
        x
      </span>
    </button>
  );
}

function NodeInboxRail({
  loading,
  nodeByID,
  allRows,
  myNodes,
  selectedRowIDs,
  expandedRowIDs,
  search,
  getNodeDragIDs,
  onSearchChange,
  onToggleFolder,
  onSelectRow,
  onSelectNode,
  onOpenNode,
}: {
  loading: boolean;
  nodeByID: Map<string, NodeRecord>;
  allRows: ExplorerTreeNode[];
  myNodes: NodeRecord[];
  selectedRowIDs: Set<string>;
  expandedRowIDs: Set<string>;
  search: string;
  getNodeDragIDs: (nodeID: string) => string[];
  onSearchChange: (value: string) => void;
  onToggleFolder: (rowID: string) => void;
  onSelectRow: (row: ExplorerTreeNode, event: React.MouseEvent) => void;
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
}) {
  const myNodeOrderedRowIDs = useMemo(() => myNodes.map((node) => nodeTreeID(node.node_id)), [myNodes]);
  const railSplit = useRailTopResize(COMMUNICATIONS_NODE_RAIL_HEIGHT_STORAGE_KEY, 220);

  return (
    <aside ref={railSplit.railRef} style={logicGateRailStyle(railSplit.topHeight)}>
      <section style={logicGateRailSectionStyle}>
        <div style={logicGateRailHeaderStyle}>
          <h2 style={panelTitleStyle}>My Nodes</h2>
          {loading && <span style={mutedSmallStyle}>Loading</span>}
        </div>
        <div style={myLogicGatesListStyle}>
          {myNodes.length === 0 && !loading ? (
            <div style={emptySmallStyle}>No responsible nodes</div>
          ) : (
            <div style={myLogicGateGridStyle}>
              {myNodes.map((node) => (
                <MyNodeTile
                  key={node.node_id}
                  node={node}
                  selected={selectedRowIDs.has(nodeTreeID(node.node_id))}
                  orderedRowIDs={myNodeOrderedRowIDs}
                  nodeByID={nodeByID}
                  getNodeDragIDs={getNodeDragIDs}
                  onSelectNode={onSelectNode}
                  onOpenNode={onOpenNode}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <RailRowResizeHandle onPointerDown={railSplit.startResize} />

      <section style={{ ...logicGateRailSectionStyle, gridTemplateRows: "auto auto minmax(0, 1fr)" }}>
        <div style={logicGateRailHeaderStyle}>
          <h2 style={panelTitleStyle}>All Nodes</h2>
          {loading && <span style={mutedSmallStyle}>Loading</span>}
        </div>
        <input
          style={inputStyle}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search Nodes"
        />
        <div style={allLogicGateRowsStyle}>
          {allRows.length === 0 && !loading ? (
            <div style={emptySmallStyle}>No nodes</div>
          ) : allRows.map((row) => {
            const selected = selectedRowIDs.has(row.id);
            const isFolder = row.kind === "folder";
            const nodeID = row.nodeID ?? "";
            const node = nodeID ? nodeByID.get(nodeID) : undefined;
            return (
              <div
                key={row.id}
                draggable
                style={logicGateTreeRowStyle(row.depth, selected, row.kind === "node")}
                onClick={(event) => onSelectRow(row, event)}
                onDoubleClick={(event) => {
                  if (row.kind !== "node" || !node) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenNode(node);
                }}
                onDragStart={(event) => {
                  const payload = getExplorerDragPayloadForSelection(row, selectedRowIDs, allRows);
                  if (!payload) return;
                  event.dataTransfer.effectAllowed = row.kind === "folder" ? "copyMove" : "copy";
                  event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(payload));
                  event.dataTransfer.setData("text/plain", row.label);
                }}
              >
                {isFolder ? (
                  <button
                    type="button"
                    draggable={false}
                    style={logicGateDisclosureStyle}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFolder(row.id);
                    }}
                  >
                    <ExplorerDisclosureIcon open={expandedRowIDs.has(row.id)} color="rgba(36, 18, 10, 0.62)" />
                  </button>
                ) : (
                  <span style={{ width: 18, flexShrink: 0 }} />
                )}
                <ExplorerRowIcon kind={row.kind} systemKey={row.systemKey} />
                <span style={logicGateTreeRowTextStyle}>{node ? nodeTitle(node) : row.label}</span>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

function MyNodeTile({
  node,
  selected,
  orderedRowIDs,
  nodeByID,
  getNodeDragIDs,
  onSelectNode,
  onOpenNode,
}: {
  node: NodeRecord;
  selected: boolean;
  orderedRowIDs: string[];
  nodeByID: Map<string, NodeRecord>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
}) {
  const nodeID = node.node_id;
  return (
    <button
      type="button"
      draggable
      style={myLogicGateTileStyle(selected)}
      onClick={(event) => onSelectNode(nodeID, orderedRowIDs, event)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenNode(node);
      }}
      onDragStart={(event) => {
        const dragIDs = getNodeDragIDs(nodeID);
        setNodeDragData(event.dataTransfer, dragIDs, nodeByID);
      }}
    >
      <span style={myLogicGateTileIconStyle}><ExplorerRowIcon kind="node" /></span>
      <span style={myLogicGateTileTextStyle}>{nodeTitle(node)}</span>
    </button>
  );
}

function AciInboxMatrix({
  loading,
  nodes,
  nodeByID,
  logicGateByID,
  currentUserID,
  selectedRowIDs,
  getNodeDragIDs,
  onSelectNode,
  onOpenNode,
  onOpenLogicGate,
}: {
  loading: boolean;
  nodes: NodeRecord[];
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
  currentUserID: string;
  selectedRowIDs: Set<string>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID: string) => void;
}) {
  const cellLogicGateGroups = useMemo(() => buildAciInboxGroupsByCell(nodes, nodeByID, logicGateByID, currentUserID), [currentUserID, logicGateByID, nodeByID, nodes]);
  const orderedRowIDs = useMemo(() => {
    const ids: string[] = [];
    for (const priority of INBOX_PRIORITIES) {
      for (const column of ACI_COLUMNS) {
        const groups = cellLogicGateGroups.get(aciCellKey(column.role, priority.value)) ?? [];
        for (const group of groups) ids.push(...group.nodeIDs);
      }
    }
    return cleanIDList(ids).map(nodeTreeID);
  }, [cellLogicGateGroups]);
  const placedCount = orderedRowIDs.length;

  return (
    <section style={logicGateRaciPanelStyle}>
      <div style={logicGateRaciHeaderStyle}>
        <h2 style={panelTitleStyle}>ACI Inbox</h2>
        <div style={logicGateRaciMetaStyle}>
          {placedCount > 0 && <span>{placedCount} active</span>}
          {loading && <span>Loading</span>}
        </div>
      </div>
      <div className="kanban-board-scroll" style={logicGateRaciScrollStyle}>
        <div style={inboxMatrixGridStyle(ACI_COLUMNS.length)}>
          <div style={logicGateRaciCornerStyle} />
          {ACI_COLUMNS.map((column) => (
            <div key={column.role} style={logicGateRaciColumnHeaderStyle}>
              <strong style={logicGateRaciColumnLetterStyle}>{column.letter}</strong>
              <span style={logicGateRaciColumnLabelStyle}>{column.label}</span>
            </div>
          ))}
          {INBOX_PRIORITIES.map((priority) => (
            <React.Fragment key={priority.value}>
              <div style={logicGateRaciPriorityHeaderStyle}>{priority.label}</div>
              {ACI_COLUMNS.map((column) => {
                const cellKey = aciCellKey(column.role, priority.value);
                const logicGateGroups = cellLogicGateGroups.get(cellKey) ?? [];
                return (
                  <div key={cellKey} style={logicGateRaciCellStyle(false)}>
                    {logicGateGroups.map((group) => (
                      <LogicGateInboxNodeGroupCard
                        key={group.logicGateID}
                        group={group}
                        selectedRowIDs={selectedRowIDs}
                        orderedRowIDs={orderedRowIDs}
                        nodeByID={nodeByID}
                        getNodeDragIDs={getNodeDragIDs}
                        onSelectNode={onSelectNode}
                        onOpenNode={onOpenNode}
                        onOpenLogicGate={onOpenLogicGate}
                      />
                    ))}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

function ResponsibleInboxMatrix({
  loading,
  nodes,
  nodeByID,
  logicGateByID,
  currentUserID,
  selectedRowIDs,
  getNodeDragIDs,
  onSelectNode,
  onOpenNode,
  onOpenLogicGate,
}: {
  loading: boolean;
  nodes: NodeRecord[];
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
  currentUserID: string;
  selectedRowIDs: Set<string>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID: string) => void;
}) {
  const cellLogicGateGroups = useMemo(() => buildResponsibleInboxGroupsByCell(nodes, nodeByID, logicGateByID, currentUserID), [currentUserID, logicGateByID, nodeByID, nodes]);
  const orderedRowIDs = useMemo(() => {
    const ids: string[] = [];
    for (const priority of INBOX_PRIORITIES) {
      for (const column of RESPONSIBLE_STATUS_COLUMNS) {
        const groups = cellLogicGateGroups.get(responsibleCellKey(column.status, priority.value)) ?? [];
        for (const group of groups) ids.push(...group.nodeIDs);
      }
    }
    return cleanIDList(ids).map(nodeTreeID);
  }, [cellLogicGateGroups]);
  const placedCount = orderedRowIDs.length;

  return (
    <section style={logicGateRaciPanelStyle}>
      <div style={logicGateRaciHeaderStyle}>
        <h2 style={panelTitleStyle}>R Inbox</h2>
        <div style={logicGateRaciMetaStyle}>
          {placedCount > 0 && <span>{placedCount} active</span>}
          {loading && <span>Loading</span>}
        </div>
      </div>
      <div className="kanban-board-scroll" style={logicGateRaciScrollStyle}>
        <div style={inboxMatrixGridStyle(RESPONSIBLE_STATUS_COLUMNS.length)}>
          <div style={logicGateRaciCornerStyle} />
          {RESPONSIBLE_STATUS_COLUMNS.map((column) => (
            <div key={column.status} style={logicGateRaciColumnHeaderStyle}>
              <strong style={logicGateRaciColumnLetterStyle}>{column.letter}</strong>
              <span style={logicGateRaciColumnLabelStyle}>{column.label}</span>
            </div>
          ))}
          {INBOX_PRIORITIES.map((priority) => (
            <React.Fragment key={priority.value}>
              <div style={logicGateRaciPriorityHeaderStyle}>{priority.label}</div>
              {RESPONSIBLE_STATUS_COLUMNS.map((column) => {
                const cellKey = responsibleCellKey(column.status, priority.value);
                const logicGateGroups = cellLogicGateGroups.get(cellKey) ?? [];
                return (
                  <div key={cellKey} style={logicGateRaciCellStyle(false)}>
                    {logicGateGroups.map((group) => (
                      <LogicGateInboxNodeGroupCard
                        key={group.logicGateID}
                        group={group}
                        selectedRowIDs={selectedRowIDs}
                        orderedRowIDs={orderedRowIDs}
                        nodeByID={nodeByID}
                        getNodeDragIDs={getNodeDragIDs}
                        onSelectNode={onSelectNode}
                        onOpenNode={onOpenNode}
                        onOpenLogicGate={onOpenLogicGate}
                      />
                    ))}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

function LogicGateInboxNodeGroupCard({
  group,
  selectedRowIDs,
  orderedRowIDs,
  nodeByID,
  getNodeDragIDs,
  onSelectNode,
  onOpenNode,
  onOpenLogicGate,
  canRemoveNode,
  onRemovePlacement,
}: {
  group: InboxLogicGateNodeGroup;
  selectedRowIDs: Set<string>;
  orderedRowIDs: string[];
  nodeByID: Map<string, NodeRecord>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID: string) => void;
  canRemoveNode?: (nodeID: string) => boolean;
  onRemovePlacement?: (nodeID: string) => void;
}) {
  const canOpenLogicGate = group.logicGateID !== INBOX_NO_LOGIC_GATE_ID;
  const firstNodeID = group.nodeIDs[0] ?? "";
  return (
    <div style={logicGateInboxGroupStyle}>
      <button
        type="button"
        disabled={!canOpenLogicGate}
        title={canOpenLogicGate ? `Open ${group.label} in Logic Gate Arena` : group.label}
        aria-label={canOpenLogicGate ? `Open ${group.label} in Logic Gate Arena` : group.label}
        style={logicGateInboxGroupHeaderStyle(canOpenLogicGate)}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          if (!canOpenLogicGate) return;
          event.preventDefault();
          event.stopPropagation();
          onOpenLogicGate(group.logicGateID, group.label, firstNodeID);
        }}
      >
        <ExplorerRowIcon kind="logic_gate" />
        <span style={logicGateInboxGroupTitleStyle}>{group.label}</span>
        <span style={logicGateInboxGroupCountStyle}>{group.nodeIDs.length}</span>
      </button>
      <div className="kanban-board-scroll" style={logicGateInboxNodeListStyle}>
        {group.nodeIDs.map((nodeID) => {
          const node = nodeByID.get(nodeID);
          if (!node) return null;
          return (
            <LogicGateInboxNodeRow
              key={nodeID}
              node={node}
              selected={selectedRowIDs.has(nodeTreeID(nodeID))}
              orderedRowIDs={orderedRowIDs}
              nodeByID={nodeByID}
              getNodeDragIDs={getNodeDragIDs}
              onSelectNode={onSelectNode}
              onOpenNode={onOpenNode}
              onRemovePlacement={canRemoveNode?.(nodeID) ? onRemovePlacement : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function LogicGateInboxNodeRow({
  node,
  selected,
  orderedRowIDs,
  nodeByID,
  getNodeDragIDs,
  onSelectNode,
  onOpenNode,
  onRemovePlacement,
}: {
  node: NodeRecord;
  selected: boolean;
  orderedRowIDs: string[];
  nodeByID: Map<string, NodeRecord>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onRemovePlacement?: (nodeID: string) => void;
}) {
  const nodeID = node.node_id;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      style={logicGateInboxNodeRowStyle(selected)}
      onClick={(event) => onSelectNode(nodeID, orderedRowIDs, event)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenNode(node);
      }}
      onDragStart={(event) => {
        const dragIDs = getNodeDragIDs(nodeID);
        setNodeDragData(event.dataTransfer, dragIDs, nodeByID);
      }}
    >
      <span style={logicGateInboxNodeGuideStyle} />
      <span style={logicGateInboxNodeIconStyle}><ExplorerRowIcon kind="node" /></span>
      <span style={logicGateInboxNodeTitleStyle}>{nodeTitle(node)}</span>
      {onRemovePlacement ? (
        <button
          type="button"
          aria-label={`Remove ${nodeTitle(node)} from ACI inbox`}
          style={logicGateInboxNodeRemoveStyle}
          onClick={(event) => {
            event.stopPropagation();
            onRemovePlacement(nodeID);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          x
        </button>
      ) : (
        <span style={logicGateInboxNodeStatusStyle(node.status)}>{responsibleStatusLetter(node.status)}</span>
      )}
    </div>
  );
}

function ComposePanel({ compose, busy, onChange, onCancel, onSubmit }: {
  compose: ComposeState;
  busy: boolean;
  onChange: (next: ComposeState) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const update = (patch: Partial<ComposeState>) => onChange({ ...compose, ...patch });
  return (
    <form style={composeStyle} onSubmit={onSubmit}>
      <div style={panelHeaderStyle}>
        <h2 style={panelTitleStyle}>{compose.replyToMessageID ? "Reply" : "New Message"}</h2>
        <button type="button" style={smallButtonStyle} onClick={onCancel}>Close</button>
      </div>
      <input style={inputStyle} value={compose.to} onChange={(event) => update({ to: event.target.value })} placeholder="To" />
      <input style={inputStyle} value={compose.cc} onChange={(event) => update({ cc: event.target.value })} placeholder="Cc" />
      <input style={inputStyle} value={compose.bcc} onChange={(event) => update({ bcc: event.target.value })} placeholder="Bcc" />
      <input style={inputStyle} value={compose.subject} onChange={(event) => update({ subject: event.target.value })} placeholder="Subject" />
      <textarea style={textareaStyle} value={compose.body} onChange={(event) => update({ body: event.target.value })} placeholder="Message" />
      <button style={primaryButtonStyle} disabled={busy}>{busy ? "Sending" : "Send"}</button>
    </form>
  );
}

function MessageDetail({ message, loading, archiveAvailable, archiveLabel, busy, onReply, onArchive, onDelete, onToggleRead, onToggleStar }: {
  message: EmailMessage;
  loading: boolean;
  archiveAvailable: boolean;
  archiveLabel: string;
  busy: boolean;
  onReply: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
}) {
  return (
    <div style={detailStyle}>
      <div style={panelHeaderStyle}>
        <div style={{ minWidth: 0 }}>
          <h2 style={detailSubjectStyle}>{message.subject || "(no subject)"}</h2>
          <div style={mutedSmallStyle}>From {formatAddressList(message.from) || "Unknown sender"} to {formatAddressList(message.to) || "me"}</div>
        </div>
        {loading && <span style={mutedSmallStyle}>Loading</span>}
      </div>
      <div style={toolbarStyle}>
        <button style={smallButtonStyle} disabled={busy} onClick={onReply}>Reply</button>
        <button style={smallButtonStyle} disabled={busy} onClick={onToggleRead}>{message.unread ? "Mark read" : "Mark unread"}</button>
        <button style={smallButtonStyle} disabled={busy} onClick={onToggleStar}>{message.starred ? "Unstar" : "Star"}</button>
        <button style={smallButtonStyle} disabled={busy || !archiveAvailable} onClick={onArchive}>{archiveLabel}</button>
        <button style={{ ...smallButtonStyle, ...dangerButtonStyle }} disabled={busy} onClick={onDelete}>Delete</button>
      </div>
      <iframe title="Email body" sandbox="" srcDoc={messageDocument(message.body || message.snippet || "")} style={iframeStyle} />
    </div>
  );
}

function DeleteMessagesConfirmationModal({ count, busy, onConfirm, onCancel }: {
  count: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={deleteModalBackdropStyle}>
      <div style={deleteModalStyle}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>
          {count === 1 ? "Are you sure you want to delete this?" : `Are you sure you want to delete these ${count} emails?`}
        </div>
        <div style={deleteModalDetailStyle}>
          This deletes the selected email{count === 1 ? "" : "s"} from your mailbox immediately.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" disabled={busy} onClick={onConfirm} style={{ border: "1px solid rgba(255,136,32,0.45)", background: "#ffffff", color: "#111111", cursor: busy ? "not-allowed" : "pointer", fontWeight: 700 }}>
            {busy ? "Deleting" : "Yes"}
          </button>
          <button type="button" disabled={busy} onClick={onCancel} style={{ border: "1px solid #ff3d7f", boxShadow: "inset 0 0 0 1px rgba(255,130,170,0.25), 0 0 10px rgba(255,61,127,0.18)", color: "#8b123f", background: "#ffffff", cursor: busy ? "not-allowed" : "pointer", fontWeight: 700 }}>
            No
          </button>
        </div>
      </div>
    </div>
  );
}

function readCommunicationsColumnWidths(): CommunicationsColumnWidths {
  try {
    const parsed = JSON.parse(localStorage.getItem(COMMUNICATIONS_COLUMN_WIDTHS_STORAGE_KEY) ?? "null") as unknown;
    if (isCommunicationsColumnWidths(parsed)) {
      return normalizeCommunicationsColumnWidths(parsed as CommunicationsColumnWidths);
    }
  } catch {
    // Stored UI preferences are optional; fall back to viewport-aware defaults.
  }
  return defaultCommunicationsColumnWidths();
}

function saveCommunicationsColumnWidths(widths: CommunicationsColumnWidths): void {
  try {
    localStorage.setItem(COMMUNICATIONS_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch {}
}

function isCommunicationsColumnWidths(value: unknown): value is CommunicationsColumnWidths {
  return Array.isArray(value) && value.length === 4 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function defaultCommunicationsColumnWidths(): CommunicationsColumnWidths {
  const availableWidth = Math.max(1120, window.innerWidth - 52 - COMMUNICATIONS_COLUMN_RESIZER_WIDTH * 3);
  const sidebarWidth = 220;
  const listWidth = 350;
  const logicGateWidth = 340;
  const detailWidth = clampNumber(availableWidth - sidebarWidth - listWidth - logicGateWidth, 360, 820);
  return normalizeCommunicationsColumnWidths([sidebarWidth, listWidth, detailWidth, logicGateWidth]);
}

function normalizeCommunicationsColumnWidths(widths: CommunicationsColumnWidths): CommunicationsColumnWidths {
  return [
    clampNumber(widths[0], COMMUNICATIONS_COLUMN_MIN_WIDTHS[0], COMMUNICATIONS_COLUMN_MAX_WIDTHS[0]),
    clampNumber(widths[1], COMMUNICATIONS_COLUMN_MIN_WIDTHS[1], COMMUNICATIONS_COLUMN_MAX_WIDTHS[1]),
    clampNumber(widths[2], COMMUNICATIONS_COLUMN_MIN_WIDTHS[2], COMMUNICATIONS_COLUMN_MAX_WIDTHS[2]),
    clampNumber(widths[3], COMMUNICATIONS_COLUMN_MIN_WIDTHS[3], COMMUNICATIONS_COLUMN_MAX_WIDTHS[3]),
  ];
}

function resizeCommunicationsColumns(startWidths: CommunicationsColumnWidths, dividerIndex: 0 | 1 | 2, delta: number, availableWidth: number): CommunicationsColumnWidths {
  const next: CommunicationsColumnWidths = [startWidths[0], startWidths[1], startWidths[2], startWidths[3]];
  const resizerTotal = COMMUNICATIONS_COLUMN_RESIZER_WIDTH * 3;

  if (dividerIndex === 0) {
    const pairTotal = startWidths[0] + startWidths[1];
    const maxLeft = Math.min(COMMUNICATIONS_COLUMN_MAX_WIDTHS[0], pairTotal - COMMUNICATIONS_COLUMN_MIN_WIDTHS[1]);
    next[0] = clampNumber(startWidths[0] + delta, COMMUNICATIONS_COLUMN_MIN_WIDTHS[0], maxLeft);
    next[1] = pairTotal - next[0];
  } else if (dividerIndex === 1) {
    const maxListFromViewport = availableWidth - next[0] - next[3] - resizerTotal - COMMUNICATIONS_COLUMN_MIN_WIDTHS[2];
    const maxList = Math.min(COMMUNICATIONS_COLUMN_MAX_WIDTHS[1], Math.max(COMMUNICATIONS_COLUMN_MIN_WIDTHS[1], maxListFromViewport));
    next[1] = clampNumber(startWidths[1] + delta, COMMUNICATIONS_COLUMN_MIN_WIDTHS[1], maxList);
  } else {
    const maxRailFromViewport = availableWidth - next[0] - next[1] - resizerTotal - COMMUNICATIONS_COLUMN_MIN_WIDTHS[2];
    const maxRail = Math.min(COMMUNICATIONS_COLUMN_MAX_WIDTHS[3], Math.max(COMMUNICATIONS_COLUMN_MIN_WIDTHS[3], maxRailFromViewport));
    next[3] = clampNumber(startWidths[3] - delta, COMMUNICATIONS_COLUMN_MIN_WIDTHS[3], maxRail);
  }

  next[2] = Math.max(COMMUNICATIONS_COLUMN_MIN_WIDTHS[2], availableWidth - next[0] - next[1] - next[3] - resizerTotal);
  return normalizeCommunicationsColumnWidths(next);
}

function resizeCommunicationsColumnsWithoutSidebar(startWidths: CommunicationsColumnWidths, dividerIndex: 0 | 1 | 2, delta: number, availableWidth: number): CommunicationsColumnWidths {
  const next: CommunicationsColumnWidths = [startWidths[0], startWidths[1], startWidths[2], startWidths[3]];
  const resizerTotal = COMMUNICATIONS_COLUMN_RESIZER_WIDTH * 2;

  if (dividerIndex === 1) {
    const maxList = Math.min(
      COMMUNICATIONS_COLUMN_MAX_WIDTHS[1],
      Math.max(COMMUNICATIONS_COLUMN_MIN_WIDTHS[1], availableWidth - next[3] - resizerTotal - COMMUNICATIONS_COLUMN_MIN_WIDTHS[2]),
    );
    next[1] = clampNumber(startWidths[1] + delta, COMMUNICATIONS_COLUMN_MIN_WIDTHS[1], maxList);
  } else if (dividerIndex === 2) {
    const maxRail = Math.min(
      COMMUNICATIONS_COLUMN_MAX_WIDTHS[3],
      Math.max(COMMUNICATIONS_COLUMN_MIN_WIDTHS[3], availableWidth - next[1] - resizerTotal - COMMUNICATIONS_COLUMN_MIN_WIDTHS[2]),
    );
    next[3] = clampNumber(startWidths[3] - delta, COMMUNICATIONS_COLUMN_MIN_WIDTHS[3], maxRail);
  }

  next[2] = Math.max(COMMUNICATIONS_COLUMN_MIN_WIDTHS[2], availableWidth - next[1] - next[3] - resizerTotal);
  return normalizeCommunicationsColumnWidths(next);
}

function resizeInboxMatrixColumnsWithoutSidebar(startWidths: CommunicationsColumnWidths, dividerIndex: 0 | 1 | 2, delta: number, availableWidth: number): CommunicationsColumnWidths {
  const next: CommunicationsColumnWidths = [startWidths[0], startWidths[1], startWidths[2], startWidths[3]];
  if (dividerIndex !== 2) return normalizeCommunicationsColumnWidths(next);

  const maxRail = Math.min(
    COMMUNICATIONS_COLUMN_MAX_WIDTHS[3],
    Math.max(COMMUNICATIONS_COLUMN_MIN_WIDTHS[3], availableWidth - COMMUNICATIONS_COLUMN_RESIZER_WIDTH - 760),
  );
  next[3] = clampNumber(startWidths[3] - delta, COMMUNICATIONS_COLUMN_MIN_WIDTHS[3], maxRail);
  next[2] = Math.max(760, availableWidth - next[3] - COMMUNICATIONS_COLUMN_RESIZER_WIDTH);
  return normalizeCommunicationsColumnWidths(next);
}

function getCommunicationsGridTemplateColumns(widths: CommunicationsColumnWidths): string {
  return [
    `${widths[0]}px`,
    `${COMMUNICATIONS_COLUMN_RESIZER_WIDTH}px`,
    `${widths[1]}px`,
    `${COMMUNICATIONS_COLUMN_RESIZER_WIDTH}px`,
    `minmax(${COMMUNICATIONS_COLUMN_MIN_WIDTHS[2]}px, 1fr)`,
    `${COMMUNICATIONS_COLUMN_RESIZER_WIDTH}px`,
    `${widths[3]}px`,
  ].join(" ");
}

function getCommunicationsGridTemplateColumnsWithoutSidebar(widths: CommunicationsColumnWidths): string {
  return [
    `${widths[1]}px`,
    `${COMMUNICATIONS_COLUMN_RESIZER_WIDTH}px`,
    `minmax(${COMMUNICATIONS_COLUMN_MIN_WIDTHS[2]}px, 1fr)`,
    `${COMMUNICATIONS_COLUMN_RESIZER_WIDTH}px`,
    `${widths[3]}px`,
  ].join(" ");
}

function getCommunicationsWorkspaceTrackWidth(element: HTMLElement | null): number {
  if (!element) return Math.max(1, window.innerWidth - 20);
  const styles = window.getComputedStyle(element);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
  return Math.max(1, element.clientWidth - paddingLeft - paddingRight);
}

function getInboxMatrixGridTemplateColumns(widths: CommunicationsColumnWidths): string {
  return [
    `${widths[0]}px`,
    "minmax(760px, 1fr)",
    `${widths[3]}px`,
  ].join(" ");
}

function getInboxMatrixGridTemplateColumnsWithoutSidebar(widths: CommunicationsColumnWidths): string {
  return [
    "minmax(760px, 1fr)",
    `${COMMUNICATIONS_COLUMN_RESIZER_WIDTH}px`,
    `${widths[3]}px`,
  ].join(" ");
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readTriageMessageIDs(dataTransfer: DataTransfer): string[] {
  try {
    const raw = dataTransfer.getData(TRIAGE_MESSAGE_DRAG_MIME);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { kind?: string; message_ids?: unknown };
    if (parsed.kind !== "triage_messages" || !Array.isArray(parsed.message_ids)) return [];
    return cleanIDList(parsed.message_ids.filter((value): value is string => typeof value === "string"));
  } catch {
    return [];
  }
}

function hasTriageMessageDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(TRIAGE_MESSAGE_DRAG_MIME);
}

function hasExplorerDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(EXPLORER_DRAG_MIME);
}

function cleanIDList(values: string[]): string[] {
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

function logicGateTreeID(logicGateID: string): string {
  return `logic-gate-${logicGateID.trim()}`;
}

function logicGateIDFromTreeID(treeID: string): string {
  const prefix = "logic-gate-";
  const value = treeID.trim();
  return value.startsWith(prefix) ? value.slice(prefix.length).trim() : "";
}

function logicGateTitle(logicGate?: Pick<LogicGateRecord, "header" | "logic_gate_id">): string {
  return logicGate?.header?.trim() || logicGate?.logic_gate_id || "Logic Gate";
}

function buildLogicGateExplorerPayload(logicGateIDs: string[]): ExplorerDragPayload | null {
  const ids = cleanIDList(logicGateIDs);
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    return {
      kind: "logic_gate",
      itemID: ids[0],
      itemType: "logic_gate",
      sourceTreeID: logicGateTreeID(ids[0]),
    };
  }
  return {
    kind: "batch",
    itemType: "logic_gate",
    items: ids.map((logicGateID) => ({
      itemID: logicGateID,
      itemType: "logic_gate",
      treeID: logicGateTreeID(logicGateID),
    })),
  };
}

function setLogicGateDragData(dataTransfer: DataTransfer, logicGateIDs: string[], logicGateByID: Map<string, LogicGateRecord>): void {
  const payload = buildLogicGateExplorerPayload(logicGateIDs);
  if (!payload) return;
  const ids = cleanIDList(logicGateIDs);
  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", ids.length === 1 ? logicGateTitle(logicGateByID.get(ids[0])) : `${ids.length} Logic Gates`);
  attachStackedDragPreview(
    dataTransfer,
    ids.map((logicGateID) => ({ label: logicGateTitle(logicGateByID.get(logicGateID)), color: "#ff8820" })),
    "#ff8820",
    "Logic Gates",
  );
}

function nodeTreeID(nodeID: string): string {
  return `node-${nodeID.trim()}`;
}

function nodeIDFromTreeID(treeID: string): string {
  const value = treeID.trim();
  const prefixes = ["node-", "system-active-node-", "system-history-node-"];
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) return value.slice(prefix.length).trim();
  }
  return "";
}

function nodeTitle(node?: Pick<NodeRecord, "title" | "node_id">): string {
  return node ? getNodeTitle(node) || node.node_id : "Node";
}

function inboxLogicGateLabel(logicGateID: string, logicGateByID: Map<string, LogicGateRecord>): string {
  const logicGate = logicGateByID.get(logicGateID);
  return logicGate ? logicGateTitle(logicGate) : logicGateID || "Logic Gate";
}

function logicGateHasRaciRole(logicGate: LogicGateRecord | undefined, role: LogicGateRaciRole, userID: string): boolean {
  const cleanUserID = userID.trim();
  if (!logicGate || !cleanUserID) return false;
  return (logicGate.raci_assignments ?? []).some((assignment) => assignment.role === role && assignment.user_id?.trim() === cleanUserID);
}

function nodeHasLogicGateRaciRole(node: NodeRecord, logicGateByID: Map<string, LogicGateRecord>, role: LogicGateRaciRole, userID: string): boolean {
  return cleanIDList(node.logic_gate_ids ?? []).some((logicGateID) => logicGateHasRaciRole(logicGateByID.get(logicGateID), role, userID));
}

function addRaciInboxGroupNode(byCell: Map<string, Map<string, Set<string>>>, cellKey: string, logicGateID: string, nodeID: string): void {
  const byLogicGate = byCell.get(cellKey) ?? new Map<string, Set<string>>();
  const nodeIDs = byLogicGate.get(logicGateID) ?? new Set<string>();
  nodeIDs.add(nodeID);
  byLogicGate.set(logicGateID, nodeIDs);
  byCell.set(cellKey, byLogicGate);
}

function materializeRaciInboxGroupsByCell(
  byCell: Map<string, Map<string, Set<string>>>,
  nodeByID: Map<string, NodeRecord>,
  logicGateByID: Map<string, LogicGateRecord>,
): Map<string, InboxLogicGateNodeGroup[]> {
  const out = new Map<string, InboxLogicGateNodeGroup[]>();
  for (const [cellKey, byLogicGate] of byCell.entries()) {
    const groups = Array.from(byLogicGate.entries())
      .map(([logicGateID, childIDs]) => ({
        logicGateID,
        label: inboxLogicGateLabel(logicGateID, logicGateByID),
        nodeIDs: Array.from(childIDs).sort((a, b) => nodeTitle(nodeByID.get(a)).localeCompare(nodeTitle(nodeByID.get(b)), undefined, { numeric: true, sensitivity: "base" }) || a.localeCompare(b)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }) || a.logicGateID.localeCompare(b.logicGateID));
    out.set(cellKey, groups);
  }
  return out;
}

function buildAciInboxGroupsByCell(
  nodes: NodeRecord[],
  nodeByID: Map<string, NodeRecord>,
  logicGateByID: Map<string, LogicGateRecord>,
  currentUserID: string,
): Map<string, InboxLogicGateNodeGroup[]> {
  const byCell = new Map<string, Map<string, Set<string>>>();
  for (const node of nodes) {
    const priority = normalizeInboxPriority(node.priority);
    if (priority === null) continue;
    for (const logicGateID of cleanIDList(node.logic_gate_ids ?? [])) {
      const logicGate = logicGateByID.get(logicGateID);
      for (const column of ACI_COLUMNS) {
        if (!logicGateHasRaciRole(logicGate, column.role, currentUserID)) continue;
        addRaciInboxGroupNode(byCell, aciCellKey(column.role, priority), logicGateID, node.node_id);
      }
    }
  }
  return materializeRaciInboxGroupsByCell(byCell, nodeByID, logicGateByID);
}

function buildResponsibleInboxGroupsByCell(
  nodes: NodeRecord[],
  nodeByID: Map<string, NodeRecord>,
  logicGateByID: Map<string, LogicGateRecord>,
  currentUserID: string,
): Map<string, InboxLogicGateNodeGroup[]> {
  const byCell = new Map<string, Map<string, Set<string>>>();
  for (const node of nodes) {
    const priority = normalizeInboxPriority(node.priority);
    const status = normalizeResponsibleInboxStatus(node.status);
    if (priority === null || !status) continue;
    for (const logicGateID of cleanIDList(node.logic_gate_ids ?? [])) {
      const logicGate = logicGateByID.get(logicGateID);
      if (!logicGateHasRaciRole(logicGate, "responsible", currentUserID)) continue;
      addRaciInboxGroupNode(byCell, responsibleCellKey(status, priority), logicGateID, node.node_id);
    }
  }
  return materializeRaciInboxGroupsByCell(byCell, nodeByID, logicGateByID);
}

function sortNodesForInbox(nodes: NodeRecord[]): NodeRecord[] {
  return [...nodes].sort((a, b) => {
    const priorityA = inboxPrioritySortRank(normalizeInboxPriority(a.priority));
    const priorityB = inboxPrioritySortRank(normalizeInboxPriority(b.priority));
    return priorityA - priorityB
      || nodeTitle(a).localeCompare(nodeTitle(b), undefined, { numeric: true, sensitivity: "base" })
      || a.node_id.localeCompare(b.node_id);
  });
}

function inboxPrioritySortRank(priority: InboxPriority | null): number {
  if (priority === null) return Number.MAX_SAFE_INTEGER;
  return priority === 0 ? 6 : priority;
}

function buildNodeExplorerPayload(nodeIDs: string[]): ExplorerDragPayload | null {
  const ids = cleanIDList(nodeIDs);
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    return {
      kind: "node",
      itemID: ids[0],
      itemType: "node",
      sourceTreeID: nodeTreeID(ids[0]),
    };
  }
  return {
    kind: "batch",
    itemType: "node",
    items: ids.map((nodeID) => ({
      itemID: nodeID,
      itemType: "node",
      treeID: nodeTreeID(nodeID),
    })),
  };
}

function setNodeDragData(dataTransfer: DataTransfer, nodeIDs: string[], nodeByID: Map<string, NodeRecord>): void {
  const payload = buildNodeExplorerPayload(nodeIDs);
  if (!payload) return;
  const ids = cleanIDList(nodeIDs);
  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", ids.length === 1 ? nodeTitle(nodeByID.get(ids[0])) : `${ids.length} nodes`);
  attachStackedDragPreview(
    dataTransfer,
    ids.map((nodeID) => ({ label: nodeTitle(nodeByID.get(nodeID)), color: "#ff8820" })),
    "#ff8820",
    "Nodes",
  );
}

function aciCellKey(role: AciInboxRole, priority: InboxPriority): string {
  return `${role}:${priority}`;
}

function responsibleCellKey(status: ResponsibleInboxStatus, priority: InboxPriority): string {
  return `${status}:${priority}`;
}

function normalizeInboxPriority(value: unknown): InboxPriority | null {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string" && value.trim() === "") return 0;
  const priority = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(priority)) return null;
  const rounded = Math.round(priority);
  return rounded >= 0 && rounded <= 5 ? rounded as InboxPriority : null;
}

function normalizeResponsibleInboxStatus(value: unknown): ResponsibleInboxStatus | null {
  const status = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s_-]+/g, " ") : "";
  if (status === "pending" || status === "p") return "pending";
  if (status === "in progress" || status === "ip") return "in_progress";
  if (status === "done" || status === "d") return "done";
  return null;
}

function responsibleStatusColor(status: ResponsibleInboxStatus): string {
  if (status === "pending") return KANBAN_LOGIC_GATE_PENDING_COLOR;
  if (status === "in_progress") return KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR;
  return KANBAN_LOGIC_GATE_DONE_COLOR;
}

function responsibleStatusLetter(value: unknown): string {
  const status = normalizeResponsibleInboxStatus(value);
  if (status === "pending") return "P";
  if (status === "in_progress") return "IP";
  if (status === "done") return "D";
  return "";
}

function logicGateIDsFromExplorerPayload(payload: ExplorerDragPayload | null, folders: CompanyExplorerFolder[], folderItems: CompanyExplorerFolderItem[]): string[] {
  if (!payload) return [];
  if (payload.kind === "logic_gate" && payload.itemID) return [payload.itemID];
  if (payload.kind === "batch") {
    return cleanIDList(getExplorerDropPayloadItems(payload)
      .filter((item) => item.itemType === "logic_gate")
      .map((item) => item.itemID));
  }
  if (payload.kind === "folder" && payload.folderKind === "logic_gate" && payload.folderID) {
    const subtree = collectFolderSubtreeIDs(folders, payload.folderID);
    return cleanIDList(folderItems
      .filter((item) => item.item_type === "logic_gate" && subtree.has(item.folder_id))
      .map((item) => item.item_id));
  }
  return [];
}

function sortLogicGateShortcuts(shortcuts: UserLogicGateShortcut[]): UserLogicGateShortcut[] {
  return [...shortcuts].sort((a, b) => a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp) || a.logic_gate_id.localeCompare(b.logic_gate_id));
}

function mergeLogicGateShortcuts(current: UserLogicGateShortcut[], incoming: UserLogicGateShortcut[]): UserLogicGateShortcut[] {
  const byID = new Map(current.map((shortcut) => [shortcut.logic_gate_id, shortcut]));
  for (const shortcut of incoming) byID.set(shortcut.logic_gate_id, shortcut);
  return sortLogicGateShortcuts(Array.from(byID.values()));
}

function buildMyLogicGateGroups(input: {
  shortcuts: UserLogicGateShortcut[];
  logicGateByID: Map<string, LogicGateRecord>;
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
}): MyLogicGateGroup[] {
  const folderByID = new Map(input.folders.map((folder) => [folder.folder_id, folder]));
  const folderIDByLogicGateID = new Map(input.folderItems.filter((item) => item.item_type === "logic_gate").map((item) => [item.item_id, item.folder_id]));
  const groupByKey = new Map<string, MyLogicGateGroup>();
  for (const shortcut of sortLogicGateShortcuts(input.shortcuts)) {
    const logicGate = input.logicGateByID.get(shortcut.logic_gate_id);
    if (!logicGate) continue;
    const folderID = folderIDByLogicGateID.get(shortcut.logic_gate_id) ?? "";
    const key = folderID || "unfiled";
    const group = groupByKey.get(key) ?? {
      key,
      label: folderID ? folderPathLabel(folderByID, folderID) : "Unfiled Logic Gates",
      logicGates: [],
    };
    group.logicGates.push(logicGate);
    groupByKey.set(key, group);
  }
  return Array.from(groupByKey.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function folderPathLabel(folderByID: Map<string, CompanyExplorerFolder>, folderID: string): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let currentID = folderID;
  while (currentID && !seen.has(currentID)) {
    seen.add(currentID);
    const folder = folderByID.get(currentID);
    if (!folder) break;
    names.push(folder.name);
    currentID = folder.parent_folder_id ?? "";
  }
  return names.reverse().join(" / ") || "Logic Gates";
}

function filterExplorerRowsForSearch(rows: ExplorerTreeNode[], rawQuery: string): ExplorerTreeNode[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return rows;
  const included = new Set<string>();
  const includeDescendants = (startIndex: number) => {
    const parent = rows[startIndex];
    included.add(parent.id);
    for (let index = startIndex + 1; index < rows.length; index += 1) {
      if (rows[index].depth <= parent.depth) break;
      included.add(rows[index].id);
    }
  };
  const includeAncestors = (startIndex: number) => {
    let depth = rows[startIndex].depth;
    for (let index = startIndex - 1; index >= 0 && depth > 0; index -= 1) {
      const row = rows[index];
      if (row.depth >= depth) continue;
      included.add(row.id);
      depth = row.depth;
    }
  };
  rows.forEach((row, index) => {
    const text = [row.label, row.folderLabel, row.nodeID, row.logicGateID, row.folderID].join(" ").toLowerCase();
    if (!text.includes(query)) return;
    included.add(row.id);
    includeAncestors(index);
    if (row.kind === "folder") includeDescendants(index);
  });
  return rows.filter((row) => included.has(row.id));
}

function mailboxLabel(mailbox: EmailMailbox): string {
  return MAILBOX_OPTIONS.find((option) => option.value === mailbox)?.label ?? "Mail";
}

function isInboxMatrixViewID(viewID: CommunicationsViewID): boolean {
  return viewID === "aci-inbox" || viewID === "r-inbox";
}

function workspaceEventTouchesCommunicationsPanel(type: string): boolean {
  const cleanType = type.trim();
  if (!cleanType) return false;
  return cleanType === "logic_gate_raci_updated"
    || cleanType.startsWith("node_")
    || cleanType.startsWith("logic_gate_")
    || cleanType.startsWith("kanban_")
    || cleanType.startsWith("company_explorer_folder_");
}

function isWorkspacePanelCommunicationsViewID(viewID: CommunicationsViewID): boolean {
  return viewID === "aci-inbox" || viewID === "r-inbox" || viewID === "my-nodes" || viewID === "my-logic-gates";
}

function mailboxForCommunicationsView(viewID: CommunicationsViewID): EmailMailbox {
  return isArchivableCommunicationsViewID(viewID) ? "primary" : "all";
}

function messageListFilterKey(companyID: string, viewID: CommunicationsViewID, mailbox: EmailMailbox, query: string, unreadOnly: boolean): string {
  return JSON.stringify([companyID.trim(), viewID, mailbox, query.trim(), unreadOnly]);
}

function isArchivableCommunicationsViewID(viewID: CommunicationsViewID): boolean {
  return viewID === "my-triage" || viewID === "primary" || viewID === "shared-root" || viewID.startsWith("shared:");
}

function markMessageSentToLogicGate(message: EmailMessage, logicGateID: string): EmailMessage {
  const cleanLogicGateID = logicGateID.trim();
  if (!cleanLogicGateID) return message;
  const logicGateIDs = message.logic_gate_ids ? [...message.logic_gate_ids] : [];
  if (!logicGateIDs.includes(cleanLogicGateID)) logicGateIDs.push(cleanLogicGateID);
  return {
    ...message,
    logic_gate_ids: logicGateIDs,
    logic_gate_count: logicGateIDs.length,
  };
}

function formatAddressList(addresses?: EmailAddress[]): string {
  if (!addresses?.length) return "";
  return addresses.map((address) => address.name ? `${address.name} <${address.email}>` : address.email).join(", ");
}

function messageHasRecipient(message: EmailMessage, email: string): boolean {
  return emailAddressListContains([...(message.to ?? []), ...(message.cc ?? []), ...(message.bcc ?? [])], email);
}

function emailAddressListContains(addresses: EmailAddress[], email: string): boolean {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return false;
  return addresses.some((address) => address.email.trim().toLowerCase() === cleanEmail);
}

function formatMessageDate(epochSeconds?: number): string {
  if (!epochSeconds) return "";
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function messageDocument(body: string): string {
  const value = body.trim();
  const content = /<\/?[a-z][\s\S]*>/i.test(value) ? value : `<pre>${escapeHTML(value)}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#111;margin:0;padding:14px;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif}</style></head><body>${content}</body></html>`;
}

function escapeHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function isEmailAccessExpiredError(error: unknown): boolean {
  return error instanceof Error && error.message.trim() === "Email access expired. Disconnect and reconnect your mailbox.";
}

function formatErrorCode(code: string): string {
  switch (code) {
    case "nylas_email_mismatch":
      return "Connect the same email address you use for Mango.";
    case "nylas_state_expired":
      return "Email connection expired. Start the connection again.";
    case "nylas_not_configured":
      return "Nylas is not configured on the backend.";
    default:
      return code.replace(/_/g, " ");
  }
}

const pageStyle: React.CSSProperties = {
  height: "100vh",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  background: "#ffffff",
  color: "#24120a",
  fontFamily: "var(--mango-font-family)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  padding: "0 18px",
  borderBottom: "1px solid rgba(255, 136, 32, 0.25)",
  background: "#ffffff",
};

const brandStyle: React.CSSProperties = {
  margin: 0,
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  lineHeight: 1,
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
};

const headerDividerStyle: React.CSSProperties = {
  width: 1,
  height: 22,
  background: "rgba(255, 136, 32, 0.25)",
};

const userPillStyle: React.CSSProperties = {
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
};

const workspaceStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "grid",
  gap: 10,
  padding: 10,
  overflow: "auto",
};

const columnResizeHandleStyle: React.CSSProperties = {
  minHeight: 0,
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "stretch",
  justifyContent: "center",
  padding: 0,
  border: 0,
  background: "transparent",
  cursor: "col-resize",
  touchAction: "none",
};

const columnResizeGripStyle: React.CSSProperties = {
  width: 2,
  minHeight: 0,
  borderRadius: 2,
  background: "rgba(255, 136, 32, 0.2)",
};

const railRowResizeHandleStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "stretch",
  padding: 0,
  border: 0,
  background: "transparent",
  cursor: "row-resize",
  touchAction: "none",
};

const railRowResizeGripStyle: React.CSSProperties = {
  width: "100%",
  height: 2,
  borderRadius: 2,
  background: "rgba(255, 136, 32, 0.24)",
};

const sidebarStyle: React.CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 8,
  padding: 8,
  border: "1px solid rgba(255, 136, 32, 0.18)",
  background: "#ffffff",
  borderRadius: 8,
  overflow: "hidden",
};

const sidebarNavStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  alignContent: "start",
  gap: 5,
  overflow: "auto",
};

const sidebarSectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 5,
  minWidth: 0,
};

const sharedInboxRowsStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  minWidth: 0,
};

function navButtonStyle(active: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 30,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 8,
    border: `1px solid ${active ? "rgba(255, 136, 32, 0.72)" : "rgba(255, 136, 32, 0.16)"}`,
    borderRadius: 6,
    background: active ? "#fff2e0" : "#ffffff",
    color: "#24120a",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    padding: "0 10px",
    textAlign: "left",
    minWidth: 0,
  };
}

const navLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const navMetaStyle: React.CSSProperties = {
  fontSize: 10,
  color: "rgba(36, 18, 10, 0.54)",
};

const sharedInboxCreateStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 30px",
  gap: 5,
};

const sharedInboxInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 30,
  border: "1px solid rgba(255, 136, 32, 0.22)",
  borderRadius: 6,
  padding: "0 8px",
  font: "inherit",
  fontSize: 11,
};

const sharedInboxCreateButtonStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  border: "1px solid rgba(255, 136, 32, 0.42)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#24120a",
  cursor: "pointer",
  font: "inherit",
  fontSize: 16,
  fontWeight: 700,
  lineHeight: 1,
};

const panelStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto",
  gap: 10,
  padding: 10,
  border: "1px solid rgba(255, 136, 32, 0.22)",
  background: "#ffffff",
  borderRadius: 8,
  overflow: "hidden",
};

const mailPanelStyle: React.CSSProperties = {
  ...panelStyle,
  gridTemplateRows: "auto minmax(0, 1fr)",
};

const mailPanelControlsStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 8,
};

function logicGateRailStyle(topHeight: number): React.CSSProperties {
  return {
    position: "sticky",
    right: 0,
    zIndex: 2,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: `${topHeight}px ${COMMUNICATIONS_ROW_RESIZER_HEIGHT}px minmax(0, 1fr)`,
    gap: 0,
    overflow: "hidden",
    background: "#ffffff",
  };
}

const logicGateRailSectionStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
  padding: 10,
  border: "1px solid rgba(255, 136, 32, 0.22)",
  background: "#ffffff",
  borderRadius: 8,
  overflow: "hidden",
};

const logicGateRailHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};

const myLogicGatesListStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  alignContent: "start",
  gap: 10,
  overflowY: "auto",
  paddingRight: 2,
};

const myLogicGateGroupStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 7,
};

const myLogicGateFolderLabelStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  fontWeight: 700,
  color: "rgba(36, 18, 10, 0.76)",
};

const myLogicGateGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
  gap: 8,
};

function myLogicGateTileStyle(selected: boolean): React.CSSProperties {
  return {
    position: "relative",
    minHeight: 88,
    display: "grid",
    alignContent: "center",
    justifyItems: "center",
    gap: 7,
    border: `1px solid ${selected ? "rgba(255, 136, 32, 0.72)" : "rgba(255, 136, 32, 0.28)"}`,
    borderRadius: 7,
    background: selected ? "#fff2e0" : "#fffaf3",
    color: "#24120a",
    cursor: "grab",
    font: "inherit",
    padding: "10px 8px",
    minWidth: 0,
    boxShadow: selected ? "0 0 0 2px rgba(255, 136, 32, 0.12) inset" : "none",
  };
}

const myLogicGateTileIconStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  transform: "scale(1.35)",
};

const myLogicGateTileTextStyle: React.CSSProperties = {
  maxWidth: "100%",
  minWidth: 0,
  overflow: "hidden",
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  overflowWrap: "anywhere",
  textAlign: "center",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.2,
};

const shortcutRemoveStyle: React.CSSProperties = {
  position: "absolute",
  top: 5,
  right: 6,
  width: 18,
  height: 18,
  display: "grid",
  placeItems: "center",
  borderRadius: 4,
  color: "rgba(36, 18, 10, 0.58)",
  fontSize: 12,
  lineHeight: 1,
  cursor: "pointer",
};

const allLogicGateRowsStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  display: "grid",
  alignContent: "start",
  gap: 2,
  paddingRight: 2,
};

function logicGateTreeRowStyle(depth: number, selected: boolean, isDropTarget: boolean): React.CSSProperties {
  return {
    minHeight: 29,
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: `1px solid ${selected ? "rgba(255, 136, 32, 0.6)" : "transparent"}`,
    borderRadius: 6,
    background: selected ? "#fff2e0" : isDropTarget ? "#ffffff" : "transparent",
    color: "#24120a",
    cursor: "pointer",
    padding: `3px 7px 3px ${6 + depth * 14}px`,
    minWidth: 0,
  };
}

const logicGateDisclosureStyle: React.CSSProperties = {
  width: 18,
  height: 20,
  border: "none",
  background: "transparent",
  color: "#24120a",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  padding: 0,
  flexShrink: 0,
};

const logicGateTreeRowTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 600,
};

const logicGateRaciPanelStyle: React.CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
  padding: 10,
  border: "1px solid rgba(255, 136, 32, 0.22)",
  background: "#ffffff",
  borderRadius: 8,
  overflow: "hidden",
};

const logicGateRaciHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};

const logicGateRaciMetaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "rgba(36, 18, 10, 0.56)",
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const logicGateRaciScrollStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  padding: "0 2px 4px 0",
  ["--kanban-board-scroll-accent" as string]: "rgb(255, 136, 32)",
  ["--kanban-board-scroll-track" as string]: "rgba(255, 136, 32, 0.08)",
};

function inboxMatrixGridStyle(columnCount: number): React.CSSProperties {
  return {
    minWidth: columnCount >= 4 ? 920 : 760,
    display: "grid",
    gridTemplateColumns: `120px repeat(${columnCount}, minmax(190px, 1fr))`,
    gridTemplateRows: `46px repeat(${INBOX_PRIORITIES.length}, minmax(112px, auto))`,
    alignItems: "stretch",
  };
}

const logicGateRaciCornerStyle: React.CSSProperties = {
  gridColumn: 1,
  gridRow: 1,
  borderRight: "1px solid rgba(255, 136, 32, 0.18)",
  borderBottom: "1px solid rgba(255, 136, 32, 0.18)",
};

const logicGateRaciColumnHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
  borderBottom: "1px solid rgba(255, 136, 32, 0.24)",
  borderRight: "1px solid rgba(255, 136, 32, 0.18)",
  background: "#fff8ef",
  padding: "0 10px",
};

const logicGateRaciColumnLetterStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(255, 136, 32, 0.42)",
  borderRadius: 5,
  color: "#ff8820",
  fontSize: 13,
  fontWeight: 800,
  flexShrink: 0,
};

const logicGateRaciColumnLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 700,
};

const logicGateRaciPriorityHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignItems: "start",
  borderRight: "1px solid rgba(255, 136, 32, 0.18)",
  borderBottom: "1px solid rgba(255, 136, 32, 0.16)",
  color: "rgba(36, 18, 10, 0.66)",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.2,
  padding: "10px 8px 0 0",
  textAlign: "right",
};

function logicGateRaciCellStyle(activeDrop: boolean): React.CSSProperties {
  return {
    minHeight: 112,
    minWidth: 0,
    display: "grid",
    alignContent: "start",
    gap: 7,
    borderRight: "1px solid rgba(255, 136, 32, 0.18)",
    borderBottom: "1px solid rgba(255, 136, 32, 0.16)",
    background: activeDrop ? "#fff2e0" : "#ffffff",
    boxShadow: activeDrop ? "inset 0 0 0 2px rgba(255, 136, 32, 0.34)" : "none",
    padding: 8,
    transition: "background 120ms ease, box-shadow 120ms ease",
  };
}

const logicGateInboxGroupStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateRows: "30px minmax(0, auto)",
  border: "1px solid rgba(255, 136, 32, 0.28)",
  borderRadius: 7,
  background: "#fffdf9",
  overflow: "hidden",
  boxShadow: "0 2px 7px rgba(36, 18, 10, 0.05)",
};

function logicGateInboxGroupHeaderStyle(interactive: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: 30,
    display: "grid",
    gridTemplateColumns: "18px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 6,
    border: "none",
    borderBottom: "1px solid rgba(255, 136, 32, 0.20)",
    background: "#fff4e6",
    color: "#24120a",
    cursor: interactive ? "pointer" : "default",
    padding: "0 8px",
    minWidth: 0,
    textAlign: "left",
    opacity: 1,
  };
}

const logicGateInboxGroupTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 800,
};

const logicGateInboxGroupCountStyle: React.CSSProperties = {
  minWidth: 21,
  height: 18,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(255, 136, 32, 0.24)",
  borderRadius: 4,
  background: "rgba(255, 255, 255, 0.78)",
  color: "rgba(36, 18, 10, 0.62)",
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1,
};

const logicGateInboxNodeListStyle: React.CSSProperties = {
  maxHeight: 124,
  minHeight: 0,
  display: "grid",
  alignContent: "start",
  gap: 3,
  overflowY: "auto",
  overflowX: "hidden",
  padding: "5px 5px 6px 7px",
  background: "#fffdf9",
};

function logicGateInboxNodeRowStyle(selected: boolean): React.CSSProperties {
  return {
    minHeight: 28,
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "10px 16px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 5,
    border: `1px solid ${selected ? "rgba(255, 136, 32, 0.72)" : "rgba(255, 136, 32, 0.16)"}`,
    borderRadius: 5,
    background: selected ? "#fff2e0" : "#ffffff",
    color: "#24120a",
    cursor: "grab",
    padding: "3px 4px 3px 0",
    boxShadow: selected ? "0 0 0 2px rgba(255, 136, 32, 0.10) inset" : "none",
  };
}

const logicGateInboxNodeGuideStyle: React.CSSProperties = {
  width: 10,
  height: "100%",
  borderLeft: "1px solid rgba(255, 136, 32, 0.28)",
  borderBottom: "1px solid rgba(255, 136, 32, 0.18)",
  justifySelf: "end",
};

const logicGateInboxNodeIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: "grid",
  placeItems: "center",
};

const logicGateInboxNodeTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 700,
};

const logicGateInboxNodeRemoveStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "grid",
  placeItems: "center",
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: "rgba(36, 18, 10, 0.58)",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  lineHeight: 1,
  padding: 0,
};

function logicGateInboxNodeStatusStyle(value: unknown): React.CSSProperties {
  const status = normalizeResponsibleInboxStatus(value);
  const color = status ? responsibleStatusColor(status) : "rgba(36, 18, 10, 0.48)";
  return {
    minWidth: 21,
    height: 18,
    display: "grid",
    placeItems: "center",
    border: `1px solid ${status ? color : "rgba(36, 18, 10, 0.16)"}`,
    borderRadius: 4,
    background: "rgba(255, 255, 255, 0.72)",
    color,
    fontSize: 9,
    fontWeight: 800,
    lineHeight: 1,
  };
}

const emptySmallStyle: React.CSSProperties = {
  minHeight: 64,
  display: "grid",
  placeItems: "center",
  color: "rgba(36, 18, 10, 0.52)",
  fontSize: 11,
};

const messageContextMenuStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 80,
  minWidth: 178,
  padding: 4,
  border: "1px solid rgba(36, 18, 10, 0.16)",
  borderRadius: 7,
  background: "#ffffff",
  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.16)",
};

const nodeEditorPopupBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 130,
  display: "grid",
  placeItems: "center",
  background: "rgba(36, 18, 10, 0.18)",
  padding: 22,
};

const nodeEditorPopupStyle: React.CSSProperties = {
  position: "relative",
  width: "min(1180px, calc(100vw - 44px))",
  height: "min(820px, calc(100vh - 64px))",
  minWidth: "min(420px, calc(100vw - 44px))",
  minHeight: "min(320px, calc(100vh - 64px))",
  border: "1px solid rgba(255, 136, 32, 0.54)",
  borderRadius: 16,
  background: "#ffffff",
  boxShadow: "0 18px 42px rgba(36, 18, 10, 0.22), inset 0 0 0 1px rgba(255, 255, 255, 0.72)",
  overflow: "hidden",
  cursor: "default",
};

const nodeEditorPopupCloseButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 7,
  right: 8,
  zIndex: 8,
  width: 24,
  height: 24,
  border: "1px solid #8b0000",
  borderRadius: 4,
  background: "#ff1f1f",
  color: "#ffffff",
  fontSize: 16,
  fontWeight: 600,
  lineHeight: "20px",
  cursor: "pointer",
};

const deleteModalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 120,
  display: "grid",
  placeItems: "center",
  background: "rgba(0,0,0,0.28)",
};

const deleteModalStyle: React.CSSProperties = {
  width: "min(420px, 90%)",
  display: "grid",
  gap: 10,
  border: "1px solid rgba(255,136,32,0.45)",
  borderRadius: 10,
  background: "#ffffff",
  color: "#24120a",
  padding: 12,
  boxShadow: "0 18px 48px rgba(0,0,0,0.24)",
};

const deleteModalDetailStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.68)",
  fontSize: 11,
  lineHeight: 1.35,
};

const contextMenuActionStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 31,
  border: "none",
  borderRadius: 5,
  background: "transparent",
  color: "#24120a",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  textAlign: "left",
  padding: "0 10px",
};

const connectPanelStyle: React.CSSProperties = {
  width: "min(460px, calc(100vw - 28px))",
  display: "grid",
  gap: 12,
  padding: 16,
  border: "1px solid rgba(255, 136, 32, 0.24)",
  background: "#ffffff",
  borderRadius: 8,
};

const centerStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "grid",
  placeItems: "center",
  padding: 16,
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "start",
  justifyContent: "space-between",
  gap: 10,
  minWidth: 0,
};

const panelTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontWeight: 600,
};

const mutedTextStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.68)",
  fontSize: 12,
  lineHeight: 1.45,
};

const mutedSmallStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.62)",
  fontSize: 11,
  overflowWrap: "anywhere",
};

const smallButtonStyle: React.CSSProperties = {
  minHeight: 30,
  border: "1px solid rgba(255, 136, 32, 0.32)",
  borderRadius: 6,
  background: "#fff",
  color: "#24120a",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  padding: "0 9px",
};

const headerButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  border: "1px solid rgba(255, 136, 32, 0.62)",
  background: "linear-gradient(180deg, rgba(9, 31, 38, 0.84), rgba(5, 18, 23, 0.72))",
  color: "#e8fbff",
  fontWeight: 500,
  boxShadow: "0 0 0 1px rgba(255, 136, 32, 0.12) inset, 0 8px 20px rgba(0, 0, 0, 0.18)",
};

const primaryButtonStyle: React.CSSProperties = {
  minHeight: 34,
  border: "1px solid #ff8820",
  borderRadius: 6,
  background: "linear-gradient(90deg, rgba(251, 177, 82, 1), rgba(254, 169, 78, 1), rgba(254, 155, 70, 1), rgba(255, 136, 32, 1))",
  color: "#24120a",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  fontWeight: 600,
  padding: "0 10px",
};

const dangerButtonStyle: React.CSSProperties = {
  borderColor: "#ff3d7f",
  color: "#8b123f",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 34,
  border: "1px solid rgba(255, 136, 32, 0.28)",
  borderRadius: 6,
  padding: "0 9px",
  font: "inherit",
  fontSize: 12,
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: "min(280px, 34vh)",
  resize: "vertical",
  padding: 9,
  lineHeight: 1.45,
};

const mailListToolbarStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  alignItems: "center",
};

const triageMailListHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.35fr)",
  gap: 10,
  alignItems: "start",
  minWidth: 0,
};

const mailListTitleStackStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 2,
};

const accountRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  alignItems: "center",
  justifySelf: "end",
  minWidth: 0,
  maxWidth: "100%",
};

const accountEmailStyle: React.CSSProperties = {
  ...mutedSmallStyle,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const searchRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 72px",
  gap: 6,
  alignItems: "center",
};

const searchButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  width: "100%",
  height: 34,
  alignSelf: "center",
};

const mailArchiveActionsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 6,
  alignItems: "center",
};

function mailArchiveActionButtonStyle(active: boolean): React.CSSProperties {
  return {
    ...smallButtonStyle,
    width: "100%",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 700,
    borderColor: active ? "#ff8820" : smallButtonStyle.borderColor,
    background: active ? "#fff2e0" : smallButtonStyle.background,
    color: active ? "#8a3d00" : smallButtonStyle.color,
  };
}

const mailFiltersRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const checkboxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  fontSize: 11,
};

const selectedCountStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.58)",
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const listHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  fontSize: 11,
  fontWeight: 600,
};

const messageListStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  display: "grid",
  alignContent: "start",
  gap: 6,
};

const loadingMoreStyle: React.CSSProperties = {
  minHeight: 28,
  display: "grid",
  placeItems: "center",
  color: "rgba(36, 18, 10, 0.56)",
  fontSize: 11,
};

function messageRowStyle(active: boolean, unread: boolean): React.CSSProperties {
  return {
    display: "grid",
    gap: 4,
    minHeight: 78,
    border: `1px solid ${active ? "#ff8820" : unread ? "rgba(255, 136, 32, 0.62)" : "rgba(255, 136, 32, 0.16)"}`,
    borderRadius: 7,
    background: active ? "#fff2e0" : unread ? "#fff4e8" : "#ffffff",
    cursor: "pointer",
    color: "#24120a",
    font: "inherit",
    fontSize: 12,
    fontWeight: unread ? 700 : 500,
    padding: 9,
    textAlign: "left",
    minWidth: 0,
  };
}

function triageMessageRowStyle(active: boolean, unread: boolean, draggable: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "20px minmax(0, 1fr) 62px",
    gap: 9,
    alignItems: "start",
    minHeight: 82,
    border: `1px solid ${active ? "#ff8820" : unread ? "rgba(255, 136, 32, 0.48)" : "rgba(255, 136, 32, 0.16)"}`,
    borderRadius: 7,
    background: active ? "#fff2e0" : unread ? "#fff8ef" : "#ffffff",
    cursor: draggable ? "grab" : "pointer",
    color: "#24120a",
    font: "inherit",
    fontSize: 12,
    padding: "10px 10px 9px",
    textAlign: "left",
    minWidth: 0,
  };
}

function messageSelectDotStyle(active: boolean, unread: boolean): React.CSSProperties {
  return {
    width: 9,
    height: 9,
    marginTop: 4,
    borderRadius: 9,
    background: active ? "#ff8820" : unread ? "rgba(255, 136, 32, 0.72)" : "rgba(36, 18, 10, 0.16)",
    boxShadow: active ? "0 0 0 3px rgba(255, 136, 32, 0.14)" : undefined,
  };
}

function messagePlacementIconStyle(active: boolean): React.CSSProperties {
  return {
    width: 18,
    height: 18,
    marginTop: 0,
    display: "grid",
    placeItems: "center",
    color: active ? "#24120a" : "#ff8820",
    transform: "scale(1.05)",
  };
}

const triageMessageContentStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 3,
};

const triageSenderStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
};

const triageSubjectStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontWeight: 700,
};

const triageDateStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.62)",
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const triageMessageMetaStyle: React.CSSProperties = {
  display: "grid",
  justifyItems: "end",
  alignContent: "start",
  gap: 6,
  minWidth: 58,
};

const messageArchiveButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  width: "100%",
  minHeight: 24,
  padding: "0 7px",
  fontSize: 10,
  fontWeight: 700,
};

const messageRowTopStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  alignItems: "center",
  fontSize: 11,
};

const snippetStyle: React.CSSProperties = {
  overflow: "hidden",
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  color: "rgba(36, 18, 10, 0.62)",
  fontSize: 11,
  lineHeight: 1.35,
};

const detailStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr)",
  gap: 10,
};

const detailSubjectStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  lineHeight: 1.25,
  overflowWrap: "anywhere",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const iframeStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 0,
  height: "100%",
  border: "1px solid rgba(255, 136, 32, 0.16)",
  borderRadius: 6,
  background: "#fff",
};

const composeStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gap: 8,
  alignContent: "start",
};

const emptyStateStyle: React.CSSProperties = {
  minHeight: 120,
  display: "grid",
  placeItems: "center",
  color: "rgba(36, 18, 10, 0.56)",
  fontSize: 12,
};

const errorStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#fff0f4",
  color: "#8b123f",
  borderBottom: "1px solid rgba(255, 61, 127, 0.28)",
  fontSize: 12,
};

const noticeStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#effff6",
  color: "#0f7b3f",
  borderBottom: "1px solid rgba(15, 123, 63, 0.22)",
  fontSize: 12,
  fontWeight: 600,
};

const inlineErrorStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid rgba(255, 61, 127, 0.28)",
  borderRadius: 6,
  background: "#fff0f4",
  color: "#8b123f",
  fontSize: 11,
  lineHeight: 1.35,
};

const inlineNoticeStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid rgba(15, 123, 63, 0.22)",
  borderRadius: 6,
  background: "#effff6",
  color: "#0f7b3f",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.35,
};
