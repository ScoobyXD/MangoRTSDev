import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CurrentUserResponse } from "../../auth/cognitoAuth";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { MangoWordmark } from "../../app/MangoLogo";
import { preloadLogicGateArenaSurface } from "../../app/preloadDashboardModules";
import {
  applyEmailMessageToCachedPages,
  createCommunicationsSharedInbox,
  addMessagesToMyTriage,
  addMyLogicGateShortcuts,
  convertTriageMessagesToLogicGate,
  deleteEmailMessage,
  disconnectCommunications,
  emailMessageMatchesListFilters,
  fetchCommunicationsAuthURL,
  fetchCommunicationsStatus,
  getEmailMessage,
  invalidateCommunicationsCache,
  invalidateCommunicationsFolderCache,
  invalidateEmailMessageCache,
  listEmailFolders,
  listEmailMessages,
  listCommunicationsSharedInboxes,
  listCommunicationsTriageItems,
  listLogicGateFolderItems,
  listLogicGateFolders,
  listLogicGates,
  listMyLogicGateShortcuts,
  mergeEmailMessageIntoMessageList,
  parseEmailAddressList,
  primeEmailMessageCache,
  removeMessageFromMyTriage,
  removeMyLogicGateShortcut,
  removeEmailMessageFromCache,
  sendEmail,
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
import {
  collectFolderSubtreeIDs,
  EXPLORER_DRAG_MIME,
  getExplorerDragPayloadForSelection,
  readExplorerDragPayload,
} from "../../modules/company-explorer/companyExplorerDragDrop";
import { buildCompanyExplorerTreeRows } from "../../modules/company-explorer/companyExplorerTreeRows";
import { getExplorerDropPayloadItems, resolveExplorerClickSelection } from "../../modules/company-explorer/treePresentation";
import type { ExplorerDragPayload, ExplorerTreeNode } from "../../modules/company-explorer/companyExplorerTypes";
import type { LogicGateRecord } from "../../modules/logic-gate-map/shared";

type CommunicationsPageProps = {
  me?: CurrentUserResponse;
  onNavigate?: (path: string) => void;
  embedded?: boolean;
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

type CommunicationsStreamEnvelope = {
  type?: string;
  trigger?: string;
  message_id?: string;
};

type CommunicationsViewID =
  | "primary"
  | "my-triage"
  | "shared-root"
  | "logic-gate"
  | "my-nodes"
  | "my-logic-gates"
  | `shared:${string}`;

type CommunicationsColumnWidths = [number, number, number, number];

type CommunicationsColumnResizeDrag = {
  dividerIndex: 0 | 1 | 2;
  startX: number;
  startWidths: CommunicationsColumnWidths;
  availableWidth: number;
};

const MAILBOX_OPTIONS: MailboxOption[] = [
  { value: "primary", label: "Primary Inbox" },
  { value: "sent", label: "Sent mail" },
  { value: "all", label: "All mail" },
];

const MESSAGE_BATCH_SIZE = 25;
const TRIAGE_MESSAGE_DRAG_MIME = "application/x-mangorts-communications-triage-messages";
const COMMUNICATIONS_COLUMN_WIDTHS_STORAGE_KEY = "mangorts.communications.columnWidths.v1";
const COMMUNICATIONS_COLUMN_RESIZER_WIDTH = 10;
const COMMUNICATIONS_COLUMN_MIN_WIDTHS: CommunicationsColumnWidths = [170, 280, 220, 280];
const COMMUNICATIONS_COLUMN_MAX_WIDTHS: CommunicationsColumnWidths = [360, 760, 1600, 1600];

export function CommunicationsPage({ me, onNavigate, embedded = false }: CommunicationsPageProps) {
  const companyID = getActiveCompanyID();
  const [status, setStatus] = useState<CommunicationsStatus | null>(null);
  const [folders, setFolders] = useState<EmailFolder[]>([]);
  const [sharedInboxes, setSharedInboxes] = useState<CommunicationsSharedInbox[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [mailbox, setMailbox] = useState<EmailMailbox>("primary");
  const [activeViewID, setActiveViewID] = useState<CommunicationsViewID>("primary");
  const [selectedMessageID, setSelectedMessageID] = useState("");
  const [selectedMessageIDs, setSelectedMessageIDs] = useState<Set<string>>(new Set());
  const [selectionAnchorMessageID, setSelectionAnchorMessageID] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [messageContextMenu, setMessageContextMenu] = useState<{ x: number; y: number; messageIDs: string[] } | null>(null);
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
  const [logicGateFolders, setLogicGateFolders] = useState<CompanyExplorerFolder[]>([]);
  const [logicGateFolderItems, setLogicGateFolderItems] = useState<CompanyExplorerFolderItem[]>([]);
  const [logicGates, setLogicGates] = useState<LogicGateRecord[]>([]);
  const [myLogicGateShortcuts, setMyLogicGateShortcuts] = useState<UserLogicGateShortcut[]>([]);
  const [logicGateSearch, setLogicGateSearch] = useState("");
  const [logicGateExpandedIDs, setLogicGateExpandedIDs] = useState<Set<string>>(new Set());
  const [selectedLogicGateRowIDs, setSelectedLogicGateRowIDs] = useState<Set<string>>(new Set());
  const [logicGateSelectionAnchorID, setLogicGateSelectionAnchorID] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [columnWidths, setColumnWidths] = useState<CommunicationsColumnWidths>(() => readCommunicationsColumnWidths());
  const [columnResizeDrag, setColumnResizeDrag] = useState<CommunicationsColumnResizeDrag | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const foldersRequestInFlightRef = useRef(false);
  const sharedInboxesRequestInFlightRef = useRef(false);
  const messageRequestKeyRef = useRef("");
  const pendingMessageReloadRef = useRef(false);
  const messageRequestSeqRef = useRef(0);
  const selectedMessageIDRef = useRef("");
  const activeViewIDRef = useRef<CommunicationsViewID>("primary");
  const folderReloadTimerRef = useRef<number | null>(null);
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
    if (activeViewIDRef.current !== "primary" || !message.id || !message.unread) return;
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
        if (activeViewIDRef.current === "primary") {
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
      setColumnWidths(resizeCommunicationsColumns(columnResizeDrag.startWidths, columnResizeDrag.dividerIndex, delta, columnResizeDrag.availableWidth));
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
  }, [columnResizeDrag]);

  useEffect(() => {
    if (isNarrow) return;
    localStorage.setItem(COMMUNICATIONS_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
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
      setError(formatError(sharedInboxError, "Failed to load shared inboxes"));
      return false;
    } finally {
      sharedInboxesRequestInFlightRef.current = false;
      setLoadingSharedInboxes(false);
    }
  }, [companyID]);

  const loadLogicGatePanel = useCallback(async (): Promise<boolean> => {
    if (!companyID) return false;
    setLoadingLogicGates(true);
    try {
      const [nextFolders, nextFolderItems, nextLogicGates, nextShortcuts] = await Promise.all([
        listLogicGateFolders(companyID),
        listLogicGateFolderItems(companyID),
        listLogicGates(companyID),
        listMyLogicGateShortcuts(companyID),
      ]);
      setLogicGateFolders(nextFolders);
      setLogicGateFolderItems(nextFolderItems);
      setLogicGates(nextLogicGates);
      setMyLogicGateShortcuts(sortLogicGateShortcuts(nextShortcuts));
      setLogicGateExpandedIDs((previous) => {
        const next = new Set(previous);
        for (const folder of nextFolders) next.add(`workspace-folder-${folder.folder_id}`);
        return next;
      });
      return true;
    } catch (logicGateError) {
      setError(formatError(logicGateError, "Failed to load Logic Gates"));
      return false;
    } finally {
      setLoadingLogicGates(false);
    }
  }, [companyID]);

  const loadMessages = useCallback(async () => {
    if (!status?.connected) return;
    const requestKey = JSON.stringify([activeViewID, mailbox, searchQuery, unreadOnly]);
    messageListFilterKeyRef.current = requestKey;
    if (messageRequestKeyRef.current === requestKey) {
      pendingMessageReloadRef.current = true;
      return;
    }
    messageRequestKeyRef.current = requestKey;
    const requestSeq = messageRequestSeqRef.current + 1;
    messageRequestSeqRef.current = requestSeq;
    setLoadingMessages(true);
    setError("");
    try {
      if (activeViewID === "my-triage") {
        const triageItems = await listCommunicationsTriageItems();
        const nextMessages = triageItems
          .map((item) => item.message)
          .filter((message) => emailMessageMatchesListFilters(message, {
            mailbox: "all",
            q: searchQuery,
            unread: unreadOnly ? true : undefined,
          }));
        if (messageRequestSeqRef.current !== requestSeq) return;
        setMessages(nextMessages);
        setNextPageToken("");
        const currentSelectedMessageID = selectedMessageIDRef.current;
        if (currentSelectedMessageID && !nextMessages.some((message) => message.id === currentSelectedMessageID)) {
          setSelectedMessageID("");
          setSelectedMessage(null);
        }
        return;
      }
      const page = await listEmailMessages({
        limit: MESSAGE_BATCH_SIZE,
        mailbox,
        q: searchQuery,
        unread: unreadOnly ? true : undefined,
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
          pendingMessageReloadRef.current = false;
          window.setTimeout(() => { void loadMessages(); }, 0);
        }
      }
    }
  }, [activeViewID, handleEmailAccessExpired, mailbox, searchQuery, status?.connected, unreadOnly]);

  const loadMoreMessages = useCallback(async () => {
    if (!status?.connected || activeViewIDRef.current === "my-triage" || loadingMessagesRef.current || loadingMoreMessagesRef.current) return;
    const pageToken = nextPageTokenRef.current.trim();
    if (!pageToken) return;
    const filterKey = JSON.stringify([mailboxRef.current, searchQueryRef.current, unreadOnlyRef.current]);
    setLoadingMoreMessages(true);
    setError("");
    try {
      const page = await listEmailMessages({
        limit: MESSAGE_BATCH_SIZE,
        pageToken,
        mailbox: mailboxRef.current,
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
  }, [handleEmailAccessExpired, status?.connected]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (status?.connected) void loadFolders(); }, [loadFolders, status?.connected]);
  useEffect(() => { if (status?.connected) void loadSharedInboxes(); }, [loadSharedInboxes, status?.connected]);
  useEffect(() => { if (status?.connected) void loadLogicGatePanel(); }, [loadLogicGatePanel, status?.connected]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list || !nextPageToken || loadingMessages || loadingMoreMessages) return;
    if (list.scrollHeight <= list.clientHeight + 120) void loadMoreMessages();
  }, [loadMoreMessages, loadingMessages, loadingMoreMessages, messages.length, nextPageToken]);

  useEffect(() => {
    if (!status?.connected) return undefined;
    const currentMessageListParams = () => ({
      limit: MESSAGE_BATCH_SIZE,
      mailbox: mailboxRef.current,
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
        if (!trigger.startsWith("message.") || !messageID) return;
        if (trigger.startsWith("message.deleted")) {
          removeEmailMessageFromCache(messageID);
          setMessages((previous) => previous.filter((message) => message.id !== messageID));
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
        void getEmailMessage(messageID)
          .then((message) => {
            primeEmailMessageCache(message);
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
  }, [handleEmailAccessExpired, loadFolders, loadMessages, status?.connected]);

  useEffect(() => {
    if (activeViewID !== "my-triage" || !selectedMessageID) return;
    setLoadingDetail(false);
    setSelectedMessage(messages.find((message) => message.id === selectedMessageID) ?? null);
  }, [activeViewID, messages, selectedMessageID]);

  useEffect(() => {
    if (!selectedMessageID || activeViewID === "my-triage") return;
    let cancelled = false;
    setLoadingDetail(true);
    setError("");
    getEmailMessage(selectedMessageID)
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
  }, [activeViewID, handleEmailAccessExpired, markMessageReadOnOpen, selectedMessageID]);

  const archiveFolder = useMemo(() => findSystemFolder(folders, "archive"), [folders]);
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

  const selectMailbox = (nextMailbox: EmailMailbox) => {
    setMailbox(nextMailbox);
    setNextPageToken("");
    setSelectedMessageID("");
    setSelectedMessageIDs(new Set());
    setSelectionAnchorMessageID("");
    setSelectedMessage(null);
    setMessageContextMenu(null);
  };

  const selectCommunicationsView = (viewID: CommunicationsViewID, nextMailbox: EmailMailbox = "primary") => {
    setActiveViewID(viewID);
    selectMailbox(nextMailbox);
  };

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

  const archiveSelected = async () => {
    if (!selectedMessage || !archiveFolder) return;
    await patchSelectedMessage({ folders: [archiveFolder.id] });
  };

  const deleteSelected = async () => {
    if (!selectedMessage) return;
    setBusy("delete");
    setError("");
    try {
      await deleteEmailMessage(selectedMessage.id);
      setSelectedMessage(null);
      setSelectedMessageID("");
      setNotice("Message deleted.");
      await loadMessages();
    } catch (deleteError) {
      setError(formatError(deleteError, "Failed to delete message"));
    } finally {
      setBusy("");
    }
  };

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
      await loadMessages();
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
      setError(formatError(sharedInboxError, "Failed to create shared inbox"));
    } finally {
      setBusy("");
    }
  };

  const logicGateByID = useMemo(() => new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate])), [logicGates]);
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
  const visibleLogicGateRows = useMemo(() => filterLogicGateRowsForSearch(allLogicGateRows, logicGateSearch), [allLogicGateRows, logicGateSearch]);
  const myLogicGateGroups = useMemo(() => buildMyLogicGateGroups({
    shortcuts: myLogicGateShortcuts,
    logicGateByID,
    folders: logicGateFolders,
    folderItems: logicGateFolderItems,
  }), [logicGateByID, logicGateFolderItems, logicGateFolders, myLogicGateShortcuts]);

  const selectMessageRow = useCallback((message: EmailMessage, event: React.MouseEvent) => {
    const orderedIDs = messages.map((item) => item.id);
    const next = resolveExplorerClickSelection({
      orderedIDs,
      previousSelectedIDs: selectedMessageIDs,
      anchorID: selectionAnchorMessageID,
      clickedID: message.id,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey || event.metaKey,
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

  const startMessageDrag = useCallback((message: EmailMessage, event: React.DragEvent<HTMLButtonElement>) => {
    if (activeViewID !== "my-triage") return;
    const messageIDs = selectedMessageIDs.has(message.id) ? Array.from(selectedMessageIDs) : [message.id];
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TRIAGE_MESSAGE_DRAG_MIME, JSON.stringify({ kind: "triage_messages", message_ids: messageIDs }));
    event.dataTransfer.setData("text/plain", messageIDs.join(","));
  }, [activeViewID, selectedMessageIDs]);

  const addSelectedMessagesToTriage = useCallback(async (messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    setBusy("triage");
    setError("");
    try {
      await addMessagesToMyTriage(ids);
      setNotice(ids.length === 1 ? "Added to My Triage." : `${ids.length} messages added to My Triage.`);
      setMessageContextMenu(null);
    } catch (triageError) {
      setError(formatError(triageError, "Failed to add to My Triage"));
    } finally {
      setBusy("");
    }
  }, []);

  const removeSelectedMessagesFromTriage = useCallback(async (messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    setBusy("triage");
    setError("");
    try {
      await Promise.all(ids.map(removeMessageFromMyTriage));
      setMessages((previous) => previous.filter((message) => !ids.includes(message.id)));
      if (selectedMessageID && ids.includes(selectedMessageID)) {
        setSelectedMessageID("");
        setSelectedMessage(null);
      }
      setSelectedMessageIDs(new Set());
      setSelectionAnchorMessageID("");
      setMessageContextMenu(null);
      setNotice(ids.length === 1 ? "Removed from My Triage." : `${ids.length} messages removed from My Triage.`);
    } catch (triageError) {
      setError(formatError(triageError, "Failed to remove from My Triage"));
    } finally {
      setBusy("");
    }
  }, [selectedMessageID]);

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
      const removed = result.deleted_message_ids ?? ids;
      setMessages((previous) => previous.filter((message) => !removed.includes(message.id)));
      if (selectedMessageID && removed.includes(selectedMessageID)) {
        setSelectedMessageID("");
        setSelectedMessage(null);
      }
      setSelectedMessageIDs((previous) => new Set(Array.from(previous).filter((id) => !removed.includes(id))));
      const title = logicGateByID.get(logicGateID)?.header || "Logic Gate";
      setNotice(removed.length === 1 ? `Moved to ${title}.` : `${removed.length} messages moved to ${title}.`);
    } catch (convertError) {
      setError(formatError(convertError, "Failed to move messages to Logic Gate"));
    } finally {
      setBusy("");
    }
  }, [companyID, logicGateByID, selectedMessageID]);

  const selectLogicGateRow = useCallback((row: ExplorerTreeNode, event: React.MouseEvent) => {
    const orderedIDs = visibleLogicGateRows.map((item) => item.id);
    const next = resolveExplorerClickSelection({
      orderedIDs,
      previousSelectedIDs: selectedLogicGateRowIDs,
      anchorID: logicGateSelectionAnchorID,
      clickedID: row.id,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey || event.metaKey,
    });
    setSelectedLogicGateRowIDs(next.selectedIDs);
    setLogicGateSelectionAnchorID(next.anchorID);
  }, [logicGateSelectionAnchorID, selectedLogicGateRowIDs, visibleLogicGateRows]);

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
  const isTriageView = activeViewID === "my-triage";
  const workspaceGridTemplateColumns = isNarrow ? "1fr" : getCommunicationsGridTemplateColumns(columnWidths);

  return (
    <div style={embedded ? { ...pageStyle, height: "100%" } : pageStyle}>
      {!embedded && (
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <h1 style={brandStyle}>
            <MangoWordmark size={22} weight={500} />
          </h1>
          <span style={headerDividerStyle} />
          <span style={titleStyle}>Communications</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {me && <span style={userPillStyle}>{me.user.display_name?.trim() || me.user.email}</span>}
          <button style={headerButtonStyle} onClick={() => onNavigate?.("/")}>MangoRTS</button>
          <button style={headerButtonStyle} onPointerEnter={preloadLogicGateArenaSurface} onFocus={preloadLogicGateArenaSurface} onPointerDown={preloadLogicGateArenaSurface} onClick={() => onNavigate?.("/logic-gate-arena")}>Logic Gate Arena</button>
          <button style={headerButtonStyle} onClick={() => onNavigate?.("/settings")}>Settings</button>
        </div>
      </header>
      )}

      {error && <div style={errorStyle}>{error}</div>}
      {notice && <div style={noticeStyle}>{notice}</div>}

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
        <main ref={workspaceRef} style={{ ...workspaceStyle, gridTemplateColumns: workspaceGridTemplateColumns, gap: isNarrow ? 10 : 0 }}>
          <aside style={sidebarStyle}>
            <nav style={sidebarNavStyle} aria-label="Communication inboxes">
              <CommunicationsNavButton label="Primary Inbox" active={activeViewID === "primary"} onClick={() => selectCommunicationsView("primary", "primary")} />
              <CommunicationsNavButton label="My Triage" active={activeViewID === "my-triage"} onClick={() => selectCommunicationsView("my-triage", "all")} />
              <section style={sidebarSectionStyle}>
                <button
                  type="button"
                  style={navButtonStyle(activeViewID === "shared-root")}
                  onClick={() => selectCommunicationsView("shared-root", "all")}
                >
                  <span style={navLabelStyle}>Shared Inbox</span>
                  {loadingSharedInboxes && <span style={navMetaStyle}>Loading</span>}
                </button>
                <div style={sharedInboxRowsStyle}>
                  {buildSharedInboxRows(sharedInboxes).map((row) => (
                    <CommunicationsNavButton
                      key={row.folder.folder_id}
                      label={row.folder.name}
                      depth={row.depth}
                      active={activeViewID === `shared:${row.folder.folder_id}`}
                      onClick={() => selectCommunicationsView(`shared:${row.folder.folder_id}`, "all")}
                    />
                  ))}
                </div>
                <form style={sharedInboxCreateStyle} onSubmit={submitSharedInbox}>
                  <input
                    style={sharedInboxInputStyle}
                    value={newSharedInboxName}
                    onChange={(event) => setNewSharedInboxName(event.target.value)}
                    placeholder="New shared inbox"
                  />
                  <button style={sharedInboxCreateButtonStyle} disabled={busy === "shared-inbox" || !newSharedInboxName.trim()} aria-label="Create shared inbox">+</button>
                </form>
              </section>
              <CommunicationsNavButton label="Logic Gate Inbox" active={activeViewID === "logic-gate"} onClick={() => selectCommunicationsView("logic-gate", "all")} />
              <CommunicationsNavButton label="My Nodes" active={activeViewID === "my-nodes"} onClick={() => selectCommunicationsView("my-nodes", "all")} />
              <CommunicationsNavButton label="My Logic Gates" active={activeViewID === "my-logic-gates"} onClick={() => selectCommunicationsView("my-logic-gates", "all")} />
            </nav>
          </aside>

          {!isNarrow && <CommunicationsColumnResizeHandle dividerIndex={0} onPointerDown={startColumnResize} />}

          <section style={mailPanelStyle(isTriageView)}>
            <div style={isTriageView ? triageMailListToolbarStyle : mailListToolbarStyle}>
              <div style={mailListTitleStackStyle}>
                <h2 style={panelTitleStyle}>{activeViewLabel}</h2>
                {isTriageView && <span style={mutedSmallStyle}>{messages.length} message{messages.length === 1 ? "" : "s"}</span>}
              </div>
              {!isTriageView && <button style={primaryButtonStyle} onClick={openNewCompose}>Compose</button>}
            </div>
            {!isTriageView && <div style={accountRowStyle}>
              <span style={mutedSmallStyle}>{connection?.account_email}</span>
              <button style={smallButtonStyle} disabled={busy === "disconnect"} onClick={disconnect}>Disconnect</button>
            </div>}
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
              {selectedMessageIDs.size > 1 && <span style={selectedCountStyle}>{selectedMessageIDs.size} selected</span>}
            </div>
            <div style={listHeaderStyle}>
              <span>{activeViewID === "my-triage" ? "My Triage" : mailboxLabel(mailbox)}</span>
              {(loadingMessages || loadingMoreMessages) && <span>Loading</span>}
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
                <div style={emptyStateStyle}>No messages</div>
              ) : messages.map((message) => (
                <button
                  key={message.id}
                  style={isTriageView
                    ? triageMessageRowStyle(selectedMessageIDs.has(message.id) || selectedMessageID === message.id, message.unread)
                    : messageRowStyle(selectedMessageIDs.has(message.id) || selectedMessageID === message.id, message.unread)}
                  draggable={activeViewID === "my-triage"}
                  onClick={(event) => selectMessageRow(message, event)}
                  onContextMenu={(event) => openMessageContextMenu(message, event)}
                  onDragStart={(event) => startMessageDrag(message, event)}
                >
                  {isTriageView ? (
                    <>
                      <span style={messageSelectDotStyle(selectedMessageIDs.has(message.id) || selectedMessageID === message.id, message.unread)} />
                      <span style={triageMessageContentStyle}>
                        <strong style={triageSenderStyle}>{formatAddressList(message.from) || "Unknown sender"}</strong>
                        <span style={triageSubjectStyle}>{message.subject || "(no subject)"}</span>
                        <span style={snippetStyle}>{message.snippet || ""}</span>
                      </span>
                      <span style={triageDateStyle}>{formatMessageDate(message.date)}</span>
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
                </button>
              ))}
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
                archiveAvailable={!!archiveFolder}
                busy={!!busy}
                onReply={openReply}
                onArchive={archiveSelected}
                onDelete={deleteSelected}
                onToggleRead={() => patchSelectedMessage({ unread: !selectedMessage.unread })}
                onToggleStar={() => patchSelectedMessage({ starred: !selectedMessage.starred })}
              />
            ) : (
              <div style={emptyStateStyle}>{isTriageView ? "Select a triage message" : "Select a message or compose a new one"}</div>
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
            onAddShortcuts={addShortcutsFromExplorerPayload}
            onRemoveShortcut={removeShortcut}
            onConvertMessages={convertMessagesToLogicGate}
          />
          {messageContextMenu && (
            <div
              style={{ ...messageContextMenuStyle, left: messageContextMenu.x, top: messageContextMenu.y }}
              onMouseLeave={() => setMessageContextMenu(null)}
            >
              {activeViewID === "my-triage" ? (
                <button style={contextMenuActionStyle} disabled={busy === "triage"} onClick={() => removeSelectedMessagesFromTriage(messageContextMenu.messageIDs)}>Remove from triage</button>
              ) : (
                <button style={contextMenuActionStyle} disabled={busy === "triage"} onClick={() => addSelectedMessagesToTriage(messageContextMenu.messageIDs)}>Add to My Triage</button>
              )}
            </div>
          )}
        </main>
      )}
    </div>
  );
}

export const CommunicationsFrameContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "mango" | "teal" | "light" | "dark" }> = () => (
  <CommunicationsPage embedded />
);

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
  if (viewID === "primary") return "Primary Inbox";
  if (viewID === "my-triage") return "My Triage";
  if (viewID === "shared-root") return "Shared Inbox";
  if (viewID === "logic-gate") return "Logic Gate Inbox";
  if (viewID === "my-nodes") return "My Nodes";
  if (viewID === "my-logic-gates") return "My Logic Gates";
  const folderID = viewID.startsWith("shared:") ? viewID.slice("shared:".length) : "";
  return sharedInboxes.find((folder) => folder.folder_id === folderID)?.name || "Shared Inbox";
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
      aria-label={`Resize communications column ${dividerIndex + 1}`}
      style={columnResizeHandleStyle}
      onPointerDown={(event) => onPointerDown(dividerIndex, event)}
    >
      <span style={columnResizeGripStyle} />
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
  onSearchChange,
  onToggleFolder,
  onSelectRow,
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
  onSearchChange: (value: string) => void;
  onToggleFolder: (rowID: string) => void;
  onSelectRow: (row: ExplorerTreeNode, event: React.MouseEvent) => void;
  onAddShortcuts: (payload: ExplorerDragPayload | null) => void;
  onRemoveShortcut: (logicGateID: string) => void;
  onConvertMessages: (logicGateID: string, messageIDs: string[]) => void;
}) {
  return (
    <aside style={logicGateRailStyle}>
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
                  <button
                    key={logicGate.logic_gate_id}
                    type="button"
                    draggable
                    style={myLogicGateTileStyle}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copyMove";
                      event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify({
                        kind: "logic_gate",
                        itemID: logicGate.logic_gate_id,
                        itemType: "logic_gate",
                        sourceTreeID: `logic-gate-${logicGate.logic_gate_id}`,
                      }));
                    }}
                    onDragOver={(event) => {
                      if (!hasTriageMessageDrag(event.dataTransfer)) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      const messageIDs = readTriageMessageIDs(event.dataTransfer);
                      if (messageIDs.length === 0) return;
                      event.preventDefault();
                      onConvertMessages(logicGate.logic_gate_id, messageIDs);
                    }}
                  >
                    <span style={myLogicGateTileIconStyle}><ExplorerRowIcon kind="logic_gate" /></span>
                    <span style={myLogicGateTileTextStyle}>{logicGate.header || "Logic Gate"}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Remove shortcut"
                      style={shortcutRemoveStyle}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!busy) onRemoveShortcut(logicGate.logic_gate_id);
                      }}
                      onKeyDown={(event) => {
                        if ((event.key === "Enter" || event.key === " ") && !busy) {
                          event.preventDefault();
                          event.stopPropagation();
                          onRemoveShortcut(logicGate.logic_gate_id);
                        }
                      }}
                    >
                      x
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

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
                  event.dataTransfer.dropEffect = "move";
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

function MessageDetail({ message, loading, archiveAvailable, busy, onReply, onArchive, onDelete, onToggleRead, onToggleStar }: {
  message: EmailMessage;
  loading: boolean;
  archiveAvailable: boolean;
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
        <button style={smallButtonStyle} disabled={busy || !archiveAvailable} onClick={onArchive}>Archive</button>
        <button style={{ ...smallButtonStyle, ...dangerButtonStyle }} disabled={busy} onClick={onDelete}>Delete</button>
      </div>
      <iframe title="Email body" sandbox="" srcDoc={messageDocument(message.body || message.snippet || "")} style={iframeStyle} />
    </div>
  );
}

function readCommunicationsColumnWidths(): CommunicationsColumnWidths {
  try {
    const parsed = JSON.parse(localStorage.getItem(COMMUNICATIONS_COLUMN_WIDTHS_STORAGE_KEY) ?? "null") as unknown;
    if (Array.isArray(parsed) && parsed.length === 4 && parsed.every((value) => typeof value === "number" && Number.isFinite(value))) {
      return normalizeCommunicationsColumnWidths(parsed as CommunicationsColumnWidths);
    }
  } catch {
    // Stored UI preferences are optional; fall back to viewport-aware defaults.
  }
  return defaultCommunicationsColumnWidths();
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

function getCommunicationsWorkspaceTrackWidth(element: HTMLElement | null): number {
  if (!element) return Math.max(1, window.innerWidth - 20);
  const styles = window.getComputedStyle(element);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
  return Math.max(1, element.clientWidth - paddingLeft - paddingRight);
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

function filterLogicGateRowsForSearch(rows: ExplorerTreeNode[], rawQuery: string): ExplorerTreeNode[] {
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
    const text = [row.label, row.folderLabel, row.logicGateID, row.folderID].join(" ").toLowerCase();
    if (!text.includes(query)) return;
    included.add(row.id);
    includeAncestors(index);
    if (row.kind === "folder") includeDescendants(index);
  });
  return rows.filter((row) => included.has(row.id));
}

function findSystemFolder(folders: EmailFolder[], system: string): EmailFolder | null {
  const normalized = system.toLowerCase();
  return folders.find((folder) => {
    const systemFolder = (folder.system_folder || "").toLowerCase();
    const name = (folder.name || folder.display_name || "").toLowerCase();
    const attributes = (folder.attributes ?? []).map((item) => item.toLowerCase());
    return systemFolder === normalized || name === normalized || attributes.includes(`\\${normalized}`);
  }) ?? null;
}

function mailboxLabel(mailbox: EmailMailbox): string {
  return MAILBOX_OPTIONS.find((option) => option.value === mailbox)?.label ?? "Mail";
}

function formatAddressList(addresses?: EmailAddress[]): string {
  if (!addresses?.length) return "";
  return addresses.map((address) => address.name ? `${address.name} <${address.email}>` : address.email).join(", ");
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

function mailPanelStyle(triage: boolean): React.CSSProperties {
  return {
    ...panelStyle,
    gridTemplateRows: triage
      ? "auto auto auto auto minmax(0, 1fr)"
      : "auto auto auto auto auto minmax(0, 1fr)",
  };
}

const logicGateRailStyle: React.CSSProperties = {
  position: "sticky",
  right: 0,
  zIndex: 2,
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: 10,
  overflow: "hidden",
  background: "#ffffff",
};

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

const myLogicGateTileStyle: React.CSSProperties = {
  position: "relative",
  minHeight: 88,
  display: "grid",
  alignContent: "center",
  justifyItems: "center",
  gap: 7,
  border: "1px solid rgba(255, 136, 32, 0.28)",
  borderRadius: 7,
  background: "#fffaf3",
  color: "#24120a",
  cursor: "grab",
  font: "inherit",
  padding: "10px 8px",
  minWidth: 0,
};

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

const triageMailListToolbarStyle: React.CSSProperties = {
  display: "grid",
  gap: 3,
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

function triageMessageRowStyle(active: boolean, unread: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "12px minmax(0, 1fr) auto",
    gap: 9,
    alignItems: "start",
    minHeight: 82,
    border: `1px solid ${active ? "#ff8820" : unread ? "rgba(255, 136, 32, 0.48)" : "rgba(255, 136, 32, 0.16)"}`,
    borderRadius: 7,
    background: active ? "#fff2e0" : unread ? "#fff8ef" : "#ffffff",
    cursor: "grab",
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
