import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetchJSON, readAuthConfig, type CurrentUserResponse } from "../../auth/cognitoAuth";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { EditorContent } from "../../modules/editor/EditorContent";
import {
  createKanbanBoard,
  createKanbanColumn,
  listKanbanCards,
  listKanbanColumns,
  moveKanbanCard,
  upsertKanbanCard,
} from "../../modules/kanban/kanbanApi";
import {
  groupCardsByColumn,
  logicGateKanbanBoardID,
  nextCardPosition,
  sortColumns,
  type KanbanCard,
  type KanbanColumn,
} from "../../modules/kanban/shared";
import { subscribeWorkspaceStream } from "../../modules/workspace/workspaceStream";
import {
  buildSmartFilterSearchQuery,
  createCommunicationsComment,
  deleteEmailMessage,
  disconnectCommunications,
  EMAIL_SMART_FILTERS,
  fetchCommunicationsAuthURL,
  fetchCommunicationsStatus,
  getCommunicationsCollaboration,
  getEmailMessage,
  listEmailFolders,
  listEmailMessages,
  markCommunicationsRead,
  parseEmailAddressList,
  sendEmail,
  smartFilterUnread,
  updateCommunicationsCollaboration,
  updateEmailMessage,
  upsertCommunicationsSharedDraft,
  type CommunicationsCollaborationState,
  type CommunicationsStatus,
  type EmailAddress,
  type EmailFolder,
  type EmailMessage,
  type EmailSmartFilterID,
} from "./communicationsApi";

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

type CompanyUser = {
  user_id: string;
  email?: string;
  display_name?: string;
};

type LogicGateOption = {
  company_id: string;
  logic_gate_id: string;
  header: string;
  created_timestamp: string;
};

type NodeRecord = {
  company_id: string;
  node_id: string;
  title: string;
  status?: string | null;
  status_color?: string | null;
  priority?: number | null;
  created_timestamp: string;
};

type WorkspaceStreamEnvelope = {
  company_id: string;
  type: string;
  data?: Record<string, unknown>;
};

type NodeConversionState = {
  message: EmailMessage | null;
  nodeID: string;
  nodeTitle: string;
  creating: boolean;
  sending: boolean;
  error: string;
  gateQuery: string;
  selectedLogicGateID: string;
};

type EmailBoardSortDirection = "asc" | "desc";

const emptyCompose: ComposeState = {
  open: false,
  replyToMessageID: "",
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
};

const EMAIL_DRAG_MIME = "application/x-mango-email-message";
const EMAIL_BOARD_CARD_DRAG_MIME = "application/x-mango-email-board-card";
const EMAIL_KANBAN_BOARD_ID = "communications-email-kanban";
const EMAIL_KANBAN_BOARD_TITLE = "Email Kanban";
const EMAIL_KANBAN_COLUMNS: Array<{ title: string; position: number; color: string }> = [
  { title: "Responsible", position: 1000, color: "#2f7d62" },
  { title: "Accountable", position: 2000, color: "#245c9f" },
  { title: "Consulted", position: 3000, color: "#8f3d56" },
  { title: "Informed", position: 4000, color: "#66752c" },
];
const EMAIL_PRIORITY_ROWS = [5, 4, 3, 2, 1, 0];

export function CommunicationsPage({ me, onNavigate, embedded = false }: CommunicationsPageProps) {
  const apiBase = useMemo(() => readAuthConfig().apiBase, []);
  const companyID = useMemo(() => getActiveCompanyID(), []);
  const currentUserID = me?.user.user_id ?? "";
  const [status, setStatus] = useState<CommunicationsStatus | null>(null);
  const [folders, setFolders] = useState<EmailFolder[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedFolderID, setSelectedFolderID] = useState("");
  const [selectedMessageID, setSelectedMessageID] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [activeSmartFilter, setActiveSmartFilter] = useState<EmailSmartFilterID>("important");
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [pageToken, setPageToken] = useState("");
  const [pageStack, setPageStack] = useState<string[]>([]);
  const [nextPageToken, setNextPageToken] = useState("");
  const [compose, setCompose] = useState<ComposeState>(emptyCompose);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [logicGates, setLogicGates] = useState<LogicGateOption[]>([]);
  const [collaboration, setCollaboration] = useState<CommunicationsCollaborationState | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [sharedDraftSubject, setSharedDraftSubject] = useState("");
  const [sharedDraftBody, setSharedDraftBody] = useState("");
  const [messageContextMenu, setMessageContextMenu] = useState<{ x: number; y: number; messageID: string } | null>(null);
  const [boardCardContextMenu, setBoardCardContextMenu] = useState<{ x: number; y: number; cardID: string } | null>(null);
  const [conversion, setConversion] = useState<NodeConversionState | null>(null);
  const [emailBoardOpen, setEmailBoardOpen] = useState(false);
  const [emailBoardLoading, setEmailBoardLoading] = useState(false);
  const [emailBoardColumns, setEmailBoardColumns] = useState<KanbanColumn[]>([]);
  const [emailBoardCards, setEmailBoardCards] = useState<KanbanCard[]>([]);
  const [emailBoardNodes, setEmailBoardNodes] = useState<NodeRecord[]>([]);
  const [emailBoardXSort, setEmailBoardXSort] = useState<EmailBoardSortDirection>("asc");
  const [emailBoardYSort, setEmailBoardYSort] = useState<EmailBoardSortDirection>("desc");
  const [emailBoardEditor, setEmailBoardEditor] = useState<{ nodeID: string; nodeTitle: string } | null>(null);

  const isNarrow = viewportWidth < 980;
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderID) ?? null;
  const archiveFolder = useMemo(() => findSystemFolder(folders, "archive"), [folders]);
  const connection = status?.connection;
  const contextMessage = messageContextMenu ? messages.find((message) => message.id === messageContextMenu.messageID) ?? null : null;
  const contextBoardCard = boardCardContextMenu ? emailBoardCards.find((card) => card.card_id === boardCardContextMenu.cardID) ?? null : null;

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("nylas");
    const oauthError = params.get("nylas_error");
    if (connected === "connected") setNotice("Email connected.");
    if (oauthError) setError(formatErrorCode(oauthError));
    if (connected || oauthError) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    setError("");
    try {
      const next = await fetchCommunicationsStatus();
      setStatus(next);
      if (!next.connected) {
        setFolders([]);
        setMessages([]);
        setSelectedMessage(null);
        setSelectedMessageID("");
      }
    } catch (statusError) {
      setError(formatError(statusError, "Failed to load email connection"));
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      const next = await listEmailFolders();
      setFolders(next);
      if (!selectedFolderID) {
        const inbox = findSystemFolder(next, "inbox");
        if (inbox) setSelectedFolderID(inbox.id);
      }
    } catch (folderError) {
      setError(formatError(folderError, "Failed to load folders"));
    }
  }, [selectedFolderID]);

  const loadMessages = useCallback(async () => {
    if (!status?.connected) return;
    setLoadingMessages(true);
    setError("");
    try {
      const page = await listEmailMessages({
        limit: 25,
        pageToken,
        folderID: selectedFolderID,
        q: buildSmartFilterSearchQuery(activeSmartFilter, searchQuery),
        unread: smartFilterUnread(activeSmartFilter),
      });
      setMessages(page.messages ?? []);
      setNextPageToken(page.next_page_token ?? "");
      if (selectedMessageID && !(page.messages ?? []).some((message) => message.id === selectedMessageID)) {
        setSelectedMessageID("");
        setSelectedMessage(null);
      }
    } catch (messageError) {
      setError(formatError(messageError, "Failed to load messages"));
    } finally {
      setLoadingMessages(false);
    }
  }, [activeSmartFilter, pageToken, searchQuery, selectedFolderID, selectedMessageID, status?.connected]);

  const loadCompanyUsers = useCallback(async () => {
    if (!companyID) return;
    try {
      const payload = await apiFetchJSON<{ users?: CompanyUser[] }>(`/v1/companies/${encodeURIComponent(companyID)}/users`);
      setCompanyUsers(payload.users ?? []);
    } catch {
      setCompanyUsers([]);
    }
  }, [companyID]);

  const loadLogicGates = useCallback(async () => {
    if (!companyID) return;
    try {
      const payload = await apiFetchJSON<{ logic_gates?: LogicGateOption[] }>(`/v1/logic-gates?company_id=${encodeURIComponent(companyID)}`);
      setLogicGates(payload.logic_gates ?? []);
    } catch {
      setLogicGates([]);
    }
  }, [companyID]);

  const loadCollaboration = useCallback(async (messageID: string) => {
    if (!messageID || !companyID) return;
    try {
      const next = await getCommunicationsCollaboration(messageID, companyID);
      setCollaboration(next);
      const mine = (currentUserID ? next.drafts.find((draft) => draft.user_id === currentUserID) : null) ?? next.drafts[0];
      setSharedDraftSubject(mine?.subject ?? "");
      setSharedDraftBody(mine?.body ?? "");
    } catch {
      setCollaboration(null);
    }
  }, [companyID, currentUserID]);

  const loadEmailBoard = useCallback(async () => {
    if (!companyID || !emailBoardOpen) return;
    setEmailBoardLoading(true);
    try {
      await createKanbanBoard(apiBase, companyID, EMAIL_KANBAN_BOARD_TITLE, EMAIL_KANBAN_BOARD_ID);
      let columns = await listKanbanColumns(apiBase, companyID, EMAIL_KANBAN_BOARD_ID);
      const existingTitles = new Set(columns.map((column) => column.title.trim().toLowerCase()));
      for (const column of EMAIL_KANBAN_COLUMNS) {
        if (existingTitles.has(column.title.toLowerCase())) continue;
        await createKanbanColumn(apiBase, companyID, EMAIL_KANBAN_BOARD_ID, column.title, column.position, 260, 300, column.color);
      }
      columns = await listKanbanColumns(apiBase, companyID, EMAIL_KANBAN_BOARD_ID);
      const [cards, nodePayload] = await Promise.all([
        listKanbanCards(apiBase, companyID, EMAIL_KANBAN_BOARD_ID, "", 500),
        apiFetchJSON<{ nodes?: NodeRecord[] }>(`/v1/nodes?company_id=${encodeURIComponent(companyID)}`),
      ]);
      setEmailBoardColumns(sortColumns(columns));
      setEmailBoardCards(cards);
      setEmailBoardNodes(nodePayload.nodes ?? []);
    } catch (boardError) {
      setError(formatError(boardError, "Failed to load email Kanban board"));
    } finally {
      setEmailBoardLoading(false);
    }
  }, [apiBase, companyID, emailBoardOpen]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (status?.connected) void loadFolders(); }, [loadFolders, status?.connected]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);
  useEffect(() => { void loadCompanyUsers(); void loadLogicGates(); }, [loadCompanyUsers, loadLogicGates]);
  useEffect(() => { void loadEmailBoard(); }, [loadEmailBoard]);

  useEffect(() => {
    if (!selectedMessageID) {
      setCollaboration(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setError("");
    getEmailMessage(selectedMessageID)
      .then(async (message) => {
        if (cancelled) return;
        setSelectedMessage(message);
        await markCommunicationsRead(message.id, companyID).catch(() => undefined);
        if (!cancelled) await loadCollaboration(message.id);
      })
      .catch((detailError) => {
        if (!cancelled) setError(formatError(detailError, "Failed to load message"));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => { cancelled = true; };
  }, [companyID, loadCollaboration, selectedMessageID]);

  useEffect(() => {
    if (!status?.connected || !companyID) return undefined;
    return subscribeWorkspaceStream(apiBase, companyID, {
      onEvent(event) {
        if (event.event !== "workspace" || event.data.length === 0) return;
        try {
          const envelope = JSON.parse(event.data) as WorkspaceStreamEnvelope;
          if (envelope.company_id !== companyID) return;
          if (envelope.type === "communications_message_created" || envelope.type === "communications_message_updated" || envelope.type === "communications_message_deleted") {
            void loadMessages();
            const messageID = typeof envelope.data?.message_id === "string" ? envelope.data.message_id : "";
            if (messageID && messageID === selectedMessageID) {
              void getEmailMessage(messageID).then(setSelectedMessage).catch(() => undefined);
              void loadCollaboration(messageID);
            }
          }
          if (envelope.type.startsWith("communications_")) {
            const messageID = typeof envelope.data?.message_id === "string" ? envelope.data.message_id : "";
            if (messageID && messageID === selectedMessageID) void loadCollaboration(messageID);
          }
          if (emailBoardOpen && (envelope.type.startsWith("kanban_") || envelope.type.startsWith("node_"))) {
            void loadEmailBoard();
          }
          if (envelope.type.startsWith("logic_gate_")) void loadLogicGates();
        } catch {
          return;
        }
      },
    });
  }, [apiBase, companyID, emailBoardOpen, loadCollaboration, loadEmailBoard, loadLogicGates, loadMessages, selectedMessageID, status?.connected]);

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

  const setFolder = (folderID: string) => {
    setSelectedFolderID(folderID);
    setPageToken("");
    setPageStack([]);
    setSelectedMessageID("");
    setSelectedMessage(null);
  };

  const selectSmartFilter = (filterID: EmailSmartFilterID) => {
    setActiveSmartFilter(filterID);
    setPageToken("");
    setPageStack([]);
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSearchQuery(searchDraft.trim());
    setPageToken("");
    setPageStack([]);
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
    setConversion(null);
    setEmailBoardOpen(false);
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

  const updateCollaboration = async (patch: {
    shared_inbox?: boolean;
    status?: "open" | "pending" | "resolved";
    assigned_user_id?: string | null;
    linked_node_id?: string | null;
  }) => {
    if (!selectedMessageID) return;
    try {
      const next = await updateCommunicationsCollaboration(selectedMessageID, { company_id: companyID, ...patch });
      setCollaboration(next);
    } catch (collaborationError) {
      setError(formatError(collaborationError, "Failed to update shared inbox"));
    }
  };

  const submitComment = async () => {
    if (!selectedMessageID || !commentDraft.trim()) return;
    try {
      await createCommunicationsComment(selectedMessageID, companyID, commentDraft.trim());
      setCommentDraft("");
      await loadCollaboration(selectedMessageID);
    } catch (commentError) {
      setError(formatError(commentError, "Failed to add team comment"));
    }
  };

  const saveSharedDraft = async () => {
    if (!selectedMessageID) return;
    try {
      await upsertCommunicationsSharedDraft(selectedMessageID, companyID, sharedDraftSubject.trim(), sharedDraftBody.trim());
      await loadCollaboration(selectedMessageID);
      setNotice("Shared draft saved.");
    } catch (draftError) {
      setError(formatError(draftError, "Failed to save shared draft"));
    }
  };

  const useSharedDraftInReply = () => {
    if (!selectedMessage) return;
    setCompose({
      open: true,
      replyToMessageID: selectedMessage.id,
      to: formatAddressList(selectedMessage.from),
      cc: "",
      bcc: "",
      subject: sharedDraftSubject.trim() || (selectedMessage.subject?.toLowerCase().startsWith("re:") ? selectedMessage.subject : `Re: ${selectedMessage.subject || ""}`.trim()),
      body: sharedDraftBody,
    });
  };

  const ensureMessageDetails = useCallback(async (message: EmailMessage): Promise<EmailMessage> => {
    if (message.body) return message;
    try {
      return await getEmailMessage(message.id);
    } catch {
      return message;
    }
  }, []);

  const updateNodeForEmailBoard = useCallback(async (nodeID: string, column: KanbanColumn, priority: number): Promise<NodeRecord> => {
    return apiFetchJSON<NodeRecord>(`/v1/nodes/${encodeURIComponent(nodeID)}`, {
      method: "PUT",
      body: JSON.stringify({
        company_id: companyID,
        status: column.title,
        status_color: column.item_color,
        priority: priority > 0 ? priority : null,
      }),
    });
  }, [companyID]);

  const createOrReuseEmailNode = useCallback(async (message: EmailMessage, options: { column?: KanbanColumn; priority?: number } = {}): Promise<NodeRecord> => {
    const fullMessage = await ensureMessageDetails(message);
    const existingCollaboration = await getCommunicationsCollaboration(fullMessage.id, companyID).catch(() => null);
    const linkedNodeID = existingCollaboration?.state.linked_node_id?.trim();
    if (linkedNodeID) {
      if (options.column) return updateNodeForEmailBoard(linkedNodeID, options.column, options.priority ?? 0);
      const payload = await apiFetchJSON<{ node: NodeRecord } | NodeRecord>(`/v1/nodes/${encodeURIComponent(linkedNodeID)}?company_id=${encodeURIComponent(companyID)}`);
      return "node" in payload ? payload.node : payload;
    }

    const node = await apiFetchJSON<NodeRecord>("/v1/nodes", {
      method: "POST",
      body: JSON.stringify({ company_id: companyID, title: emailNodeTitle(fullMessage) }),
    });
    let savedNode = node;
    if (options.column) {
      savedNode = await updateNodeForEmailBoard(node.node_id, options.column, options.priority ?? 0);
    }
    await apiFetchJSON(`/v1/nodes/${encodeURIComponent(node.node_id)}/information`, {
      method: "POST",
      body: JSON.stringify({
        company_id: companyID,
        type: "Text box",
        information: formatEmailNodeInformation(fullMessage),
      }),
    });
    await updateCommunicationsCollaboration(fullMessage.id, {
      company_id: companyID,
      shared_inbox: true,
      linked_node_id: node.node_id,
    }).catch(() => undefined);
    return savedNode;
  }, [companyID, ensureMessageDetails, updateNodeForEmailBoard]);

  const openEmailNodeConversion = async (message: EmailMessage) => {
    setMessageContextMenu(null);
    setCompose(emptyCompose);
    setEmailBoardOpen(false);
    setConversion({
      message,
      nodeID: "",
      nodeTitle: emailNodeTitle(message),
      creating: true,
      sending: false,
      error: "",
      gateQuery: "",
      selectedLogicGateID: "",
    });
    try {
      const node = await createOrReuseEmailNode(message);
      setConversion((current) => current?.message?.id === message.id ? {
        ...current,
        nodeID: node.node_id,
        nodeTitle: node.title || emailNodeTitle(message),
        creating: false,
      } : current);
      await loadCollaboration(message.id);
    } catch (conversionError) {
      setConversion((current) => current?.message?.id === message.id ? {
        ...current,
        creating: false,
        error: formatError(conversionError, "Failed to create node from email"),
      } : current);
    }
  };

  const openExistingNodeConversion = (nodeID: string, nodeTitle: string) => {
    setBoardCardContextMenu(null);
    setConversion({
      message: null,
      nodeID,
      nodeTitle,
      creating: false,
      sending: false,
      error: "",
      gateQuery: "",
      selectedLogicGateID: "",
    });
  };

  const sendConversionToLogicGate = async () => {
    if (!conversion?.nodeID || !conversion.selectedLogicGateID) return;
    setConversion((current) => current ? { ...current, sending: true, error: "" } : current);
    try {
      const gate = logicGates.find((item) => item.logic_gate_id === conversion.selectedLogicGateID);
      const boardID = logicGateKanbanBoardID(conversion.selectedLogicGateID);
      const columns = await listKanbanColumns(apiBase, companyID, boardID);
      const pendingColumn = columns.find((column) => column.title.trim().toLowerCase() === "pending") ?? columns[0];
      if (!pendingColumn) throw new Error("The selected logic gate has no Pending column.");
      const cards = await listKanbanCards(apiBase, companyID, boardID, "", 500);
      await upsertKanbanCard({
        apiBase,
        companyID,
        boardID,
        columnID: pendingColumn.column_id,
        nodeID: conversion.nodeID,
        nodeTitle: conversion.nodeTitle,
        position: nextCardPosition(cards, pendingColumn.column_id),
        descriptionSnapshot: conversion.message ? emailDescriptionSnapshot(conversion.message) : "",
      });
      setNotice(`Node sent to ${gate?.header || "logic gate"} Pending.`);
      setConversion((current) => current ? { ...current, sending: false } : current);
    } catch (sendError) {
      setConversion((current) => current ? { ...current, sending: false, error: formatError(sendError, "Failed to send node to logic gate") } : current);
    }
  };

  const dropEmailOnBoard = async (message: EmailMessage, column: KanbanColumn, priority: number) => {
    setError("");
    try {
      const node = await createOrReuseEmailNode(message, { column, priority });
      const cards = await listKanbanCards(apiBase, companyID, EMAIL_KANBAN_BOARD_ID, "", 500);
      await upsertKanbanCard({
        apiBase,
        companyID,
        boardID: EMAIL_KANBAN_BOARD_ID,
        columnID: column.column_id,
        nodeID: node.node_id,
        nodeTitle: node.title || emailNodeTitle(message),
        position: nextCardPosition(cards, column.column_id),
        descriptionSnapshot: emailDescriptionSnapshot(message),
      });
      await loadEmailBoard();
      setNotice(`Email converted to ${column.title}, priority ${priority}.`);
    } catch (dropError) {
      setError(formatError(dropError, "Failed to convert email into board node"));
    }
  };

  const moveEmailBoardCard = async (cardID: string, column: KanbanColumn, priority: number) => {
    const card = emailBoardCards.find((item) => item.card_id === cardID);
    if (!card) return;
    try {
      await updateNodeForEmailBoard(card.node_id, column, priority);
      await moveKanbanCard({
        apiBase,
        companyID,
        boardID: EMAIL_KANBAN_BOARD_ID,
        cardID,
        columnID: column.column_id,
        position: nextCardPosition(emailBoardCards, column.column_id),
      });
      await loadEmailBoard();
    } catch (moveError) {
      setError(formatError(moveError, "Failed to move email board card"));
    }
  };

  const rightPanel = () => {
    if (conversion) {
      return (
        <NodeConversionPanel
          conversion={conversion}
          logicGates={logicGates}
          onChange={setConversion}
          onClose={() => setConversion(null)}
          onSend={sendConversionToLogicGate}
        />
      );
    }
    if (emailBoardOpen) {
      return (
        <EmailKanbanBoard
          loading={emailBoardLoading}
          columns={emailBoardColumns}
          cards={emailBoardCards}
          nodes={emailBoardNodes}
          xSort={emailBoardXSort}
          ySort={emailBoardYSort}
          editor={emailBoardEditor}
          onSetXSort={setEmailBoardXSort}
          onSetYSort={setEmailBoardYSort}
          onDropEmail={dropEmailOnBoard}
          onMoveCard={moveEmailBoardCard}
          onOpenNode={setEmailBoardEditor}
          onContextCard={setBoardCardContextMenu}
          onCloseEditor={() => setEmailBoardEditor(null)}
        />
      );
    }
    if (compose.open) {
      return (
        <ComposePanel
          compose={compose}
          busy={busy === "send"}
          onChange={setCompose}
          onCancel={() => setCompose(emptyCompose)}
          onSubmit={submitCompose}
        />
      );
    }
    if (selectedMessage) {
      return (
        <div style={rightPanelStackStyle}>
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
          <TeamCollaborationPanel
            collaboration={collaboration}
            users={companyUsers}
            currentUserID={currentUserID}
            commentDraft={commentDraft}
            sharedDraftSubject={sharedDraftSubject}
            sharedDraftBody={sharedDraftBody}
            onPatch={updateCollaboration}
            onCommentDraft={setCommentDraft}
            onSubmitComment={submitComment}
            onSharedDraftSubject={setSharedDraftSubject}
            onSharedDraftBody={setSharedDraftBody}
            onSaveSharedDraft={saveSharedDraft}
            onUseSharedDraft={useSharedDraftInReply}
          />
        </div>
      );
    }
    return <div style={emptyStateStyle}>Select a message or compose a new one</div>;
  };

  return (
    <div style={embedded ? { ...pageStyle, height: "100%" } : pageStyle}>
      {!embedded && (
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <h1 style={brandStyle}>MangoRTS</h1>
          <span style={headerDividerStyle} />
          <span style={titleStyle}>Communications</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {me && <span style={userPillStyle}>{me.user.display_name?.trim() || me.user.email}</span>}
          <button style={headerButtonStyle} onClick={() => onNavigate?.("/")}>MangoRTS</button>
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
        <main style={{ ...workspaceStyle, gridTemplateColumns: isNarrow ? "1fr" : "220px minmax(300px, 390px) minmax(0, 1fr)" }}>
          <aside style={panelStyle}>
            <div style={panelHeaderStyle}>
              <div style={{ minWidth: 0 }}>
                <h2 style={panelTitleStyle}>Mail</h2>
                {connection && <div style={mutedSmallStyle}>{connection.account_email}</div>}
              </div>
              <button style={smallButtonStyle} disabled={busy === "disconnect"} onClick={disconnect}>Disconnect</button>
            </div>
            <button style={composeButtonStyle} onClick={openNewCompose}>Compose</button>
            <button
              style={smallButtonStyle}
              onClick={() => {
                setConversion(null);
                setCompose(emptyCompose);
                setEmailBoardOpen((open) => !open);
              }}
            >
              {emailBoardOpen ? "Hide email board" : "Email board"}
            </button>
            <div style={liveStatusStyle}>Live via workspace stream</div>
            <nav style={folderListStyle}>
              {folders.map((folder) => (
                <button key={folder.id} style={folderButtonStyle(selectedFolderID === folder.id)} onClick={() => setFolder(folder.id)}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{folderLabel(folder)}</span>
                  {folder.unread_count ? <span>{folder.unread_count}</span> : null}
                </button>
              ))}
              <button style={folderButtonStyle(!selectedFolderID)} onClick={() => setFolder("")}>
                <span>All mail</span>
              </button>
            </nav>
          </aside>

          <section style={panelStyle}>
            <form style={searchRowStyle} onSubmit={submitSearch}>
              <input
                style={inputStyle}
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Search mail"
              />
              <button style={smallButtonStyle}>Search</button>
            </form>
            <div style={smartFilterGridStyle}>
              {EMAIL_SMART_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  style={smartFilterButtonStyle(activeSmartFilter === filter.id)}
                  onClick={() => selectSmartFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div style={listHeaderStyle}>
              <span>{selectedFolder ? folderLabel(selectedFolder) : "All mail"}</span>
              {loadingMessages && <span>Loading</span>}
            </div>
            <div style={messageListStyle}>
              {messages.length === 0 && !loadingMessages ? (
                <div style={emptyStateStyle}>No messages</div>
              ) : messages.map((message) => (
                <button
                  key={message.id}
                  draggable
                  style={messageRowStyle(selectedMessageID === message.id, message.unread)}
                  onClick={() => {
                    setConversion(null);
                    setEmailBoardOpen(false);
                    setCompose(emptyCompose);
                    setSelectedMessageID(message.id);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMessageContextMenu({ x: event.clientX, y: event.clientY, messageID: message.id });
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(EMAIL_DRAG_MIME, JSON.stringify(message));
                  }}
                >
                  <span style={messageRowTopStyle}>
                    <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{formatAddressList(message.from) || "Unknown sender"}</strong>
                    <span>{formatMessageDate(message.date)}</span>
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message.subject || "(no subject)"}</span>
                  <span style={snippetStyle}>{message.snippet || ""}</span>
                </button>
              ))}
            </div>
            <div style={paginationStyle}>
              <button
                style={smallButtonStyle}
                disabled={pageStack.length === 0 || loadingMessages}
                onClick={() => {
                  const previous = [...pageStack];
                  const next = previous.pop() ?? "";
                  setPageStack(previous);
                  setPageToken(next);
                }}
              >
                Previous
              </button>
              <button
                style={smallButtonStyle}
                disabled={!nextPageToken || loadingMessages}
                onClick={() => {
                  setPageStack((previous) => [...previous, pageToken]);
                  setPageToken(nextPageToken);
                }}
              >
                Next
              </button>
            </div>
          </section>

          <section style={panelStyle}>
            {rightPanel()}
          </section>
        </main>
      )}

      {messageContextMenu && contextMessage && (
        <ContextMenu x={messageContextMenu.x} y={messageContextMenu.y} onClose={() => setMessageContextMenu(null)}>
          <button type="button" style={contextMenuButtonStyle} onClick={() => void openEmailNodeConversion(contextMessage)}>
            Turn to node and send to logic gate
          </button>
          <button
            type="button"
            style={contextMenuButtonStyle}
            onClick={() => {
              setMessageContextMenu(null);
              void updateCommunicationsCollaboration(contextMessage.id, { company_id: companyID, shared_inbox: true, status: "open" })
                .then((next) => setCollaboration(next))
                .catch((sharedError) => setError(formatError(sharedError, "Failed to add to shared inbox")));
            }}
          >
            Add to shared inbox
          </button>
        </ContextMenu>
      )}
      {boardCardContextMenu && contextBoardCard && (
        <ContextMenu x={boardCardContextMenu.x} y={boardCardContextMenu.y} onClose={() => setBoardCardContextMenu(null)}>
          <button type="button" style={contextMenuButtonStyle} onClick={() => openExistingNodeConversion(contextBoardCard.node_id, contextBoardCard.node_title)}>
            Send node to logic gate
          </button>
        </ContextMenu>
      )}
    </div>
  );
}

export const CommunicationsFrameContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }> = () => (
  <CommunicationsPage embedded />
);

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

function TeamCollaborationPanel({
  collaboration,
  users,
  currentUserID,
  commentDraft,
  sharedDraftSubject,
  sharedDraftBody,
  onPatch,
  onCommentDraft,
  onSubmitComment,
  onSharedDraftSubject,
  onSharedDraftBody,
  onSaveSharedDraft,
  onUseSharedDraft,
}: {
  collaboration: CommunicationsCollaborationState | null;
  users: CompanyUser[];
  currentUserID: string;
  commentDraft: string;
  sharedDraftSubject: string;
  sharedDraftBody: string;
  onPatch: (patch: { shared_inbox?: boolean; status?: "open" | "pending" | "resolved"; assigned_user_id?: string | null }) => void;
  onCommentDraft: (value: string) => void;
  onSubmitComment: () => void;
  onSharedDraftSubject: (value: string) => void;
  onSharedDraftBody: (value: string) => void;
  onSaveSharedDraft: () => void;
  onUseSharedDraft: () => void;
}) {
  const state = collaboration?.state;
  const userByID = new Map(users.map((user) => [user.user_id, user]));
  return (
    <section style={teamPanelStyle}>
      <div style={panelHeaderStyle}>
        <h2 style={panelTitleStyle}>Shared Inbox</h2>
        <label style={switchLabelStyle}>
          <input
            type="checkbox"
            checked={state?.shared_inbox ?? false}
            onChange={(event) => onPatch({ shared_inbox: event.target.checked })}
          />
          <span>Team</span>
        </label>
      </div>
      <div style={teamGridStyle}>
        <label style={fieldLabelStyle}>
          Status
          <select style={selectStyle} value={state?.status ?? "open"} onChange={(event) => onPatch({ status: event.target.value as "open" | "pending" | "resolved" })}>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
        <label style={fieldLabelStyle}>
          Owner
          <select style={selectStyle} value={state?.assigned_user_id ?? ""} onChange={(event) => onPatch({ assigned_user_id: event.target.value || null })}>
            <option value="">Unassigned</option>
            {users.map((user) => <option key={user.user_id} value={user.user_id}>{userLabel(user)}</option>)}
          </select>
        </label>
      </div>
      <div style={subsectionStyle}>
        <div style={sectionLabelStyle}>Read receipts</div>
        <div style={receiptListStyle}>
          {(collaboration?.read_receipts ?? []).length === 0 ? <span style={mutedSmallStyle}>No receipts yet</span> : collaboration?.read_receipts.map((receipt) => (
            <span key={receipt.user_id} style={receiptPillStyle(receipt.user_id === currentUserID)}>
              {userLabel(userByID.get(receipt.user_id))} {formatShortTime(receipt.read_timestamp)}
            </span>
          ))}
        </div>
      </div>
      <div style={subsectionStyle}>
        <div style={sectionLabelStyle}>Team comments</div>
        <div style={commentListStyle}>
          {(collaboration?.comments ?? []).map((comment) => (
            <div key={comment.comment_id} style={commentItemStyle}>
              <strong>{userLabel(userByID.get(comment.user_id))}</strong>
              <span>{comment.body}</span>
            </div>
          ))}
        </div>
        <div style={commentComposerStyle}>
          <input style={inputStyle} value={commentDraft} onChange={(event) => onCommentDraft(event.target.value)} placeholder="Team comment" />
          <button type="button" style={smallButtonStyle} onClick={onSubmitComment}>Add</button>
        </div>
      </div>
      <div style={subsectionStyle}>
        <div style={sectionLabelStyle}>Shared draft</div>
        <input style={inputStyle} value={sharedDraftSubject} onChange={(event) => onSharedDraftSubject(event.target.value)} placeholder="Draft subject" />
        <textarea style={sharedDraftTextareaStyle} value={sharedDraftBody} onChange={(event) => onSharedDraftBody(event.target.value)} placeholder="Draft reply" />
        <div style={paginationStyle}>
          <button type="button" style={smallButtonStyle} onClick={onSaveSharedDraft}>Save draft</button>
          <button type="button" style={smallButtonStyle} onClick={onUseSharedDraft}>Use in reply</button>
        </div>
      </div>
    </section>
  );
}

function NodeConversionPanel({ conversion, logicGates, onChange, onClose, onSend }: {
  conversion: NodeConversionState;
  logicGates: LogicGateOption[];
  onChange: (next: NodeConversionState) => void;
  onClose: () => void;
  onSend: () => void;
}) {
  const query = conversion.gateQuery.trim().toLowerCase();
  const filteredGates = logicGates.filter((gate) => !query || gate.header.toLowerCase().includes(query));
  const selectedGate = logicGates.find((gate) => gate.logic_gate_id === conversion.selectedLogicGateID);
  return (
    <div style={conversionPanelStyle}>
      <div style={panelHeaderStyle}>
        <div style={{ minWidth: 0 }}>
          <h2 style={panelTitleStyle}>Email Node</h2>
          <div style={mutedSmallStyle}>{conversion.nodeTitle}</div>
        </div>
        <button type="button" style={smallButtonStyle} onClick={onClose}>Close</button>
      </div>
      {conversion.error && <div style={errorInlineStyle}>{conversion.error}</div>}
      <div style={conversionEditorShellStyle}>
        {conversion.creating ? (
          <div style={emptyStateStyle}>Preparing editor</div>
        ) : conversion.nodeID ? (
          <EditorContent
            accent="#00e9ff"
            widgetId={`communications-email-node:${conversion.nodeID}`}
            theme="light"
            forcedEntityKind="node"
            forcedEntityID={conversion.nodeID}
            forcedLabel={conversion.nodeTitle}
          />
        ) : (
          <div style={emptyStateStyle}>Node unavailable</div>
        )}
      </div>
      <div style={logicGatePickerStyle}>
        <input
          style={inputStyle}
          value={conversion.gateQuery}
          onChange={(event) => onChange({ ...conversion, gateQuery: event.target.value })}
          placeholder="Search logic gates"
        />
        <div style={logicGateListStyle}>
          {filteredGates.map((gate) => (
            <button
              key={gate.logic_gate_id}
              type="button"
              style={logicGateOptionStyle(conversion.selectedLogicGateID === gate.logic_gate_id)}
              onClick={() => onChange({ ...conversion, selectedLogicGateID: gate.logic_gate_id })}
            >
              {gate.header || gate.logic_gate_id}
            </button>
          ))}
        </div>
        <button
          type="button"
          style={primaryButtonStyle}
          disabled={conversion.creating || conversion.sending || !conversion.nodeID || !selectedGate}
          onClick={onSend}
        >
          {conversion.sending ? "Sending" : "Send to Pending"}
        </button>
      </div>
    </div>
  );
}

function EmailKanbanBoard({
  loading,
  columns,
  cards,
  nodes,
  xSort,
  ySort,
  editor,
  onSetXSort,
  onSetYSort,
  onDropEmail,
  onMoveCard,
  onOpenNode,
  onContextCard,
  onCloseEditor,
}: {
  loading: boolean;
  columns: KanbanColumn[];
  cards: KanbanCard[];
  nodes: NodeRecord[];
  xSort: EmailBoardSortDirection;
  ySort: EmailBoardSortDirection;
  editor: { nodeID: string; nodeTitle: string } | null;
  onSetXSort: (value: EmailBoardSortDirection) => void;
  onSetYSort: (value: EmailBoardSortDirection) => void;
  onDropEmail: (message: EmailMessage, column: KanbanColumn, priority: number) => void;
  onMoveCard: (cardID: string, column: KanbanColumn, priority: number) => void;
  onOpenNode: (value: { nodeID: string; nodeTitle: string }) => void;
  onContextCard: (value: { x: number; y: number; cardID: string } | null) => void;
  onCloseEditor: () => void;
}) {
  const orderedColumns = xSort === "asc" ? sortColumns(columns) : sortColumns(columns).reverse();
  const rows = ySort === "desc" ? EMAIL_PRIORITY_ROWS : [...EMAIL_PRIORITY_ROWS].reverse();
  const nodeByID = new Map(nodes.map((node) => [node.node_id, node]));
  const cardsByColumn = groupCardsByColumn(cards);

  return (
    <div style={emailBoardStyle}>
      <div style={panelHeaderStyle}>
        <div>
          <h2 style={panelTitleStyle}>Email Kanban</h2>
          <div style={mutedSmallStyle}>{loading ? "Loading" : "RACI x priority"}</div>
        </div>
        <div style={boardControlRowStyle}>
          <button type="button" style={smallButtonStyle} onClick={() => onSetXSort(xSort === "asc" ? "desc" : "asc")}>X {xSort}</button>
          <button type="button" style={smallButtonStyle} onClick={() => onSetYSort(ySort === "asc" ? "desc" : "asc")}>Y {ySort}</button>
        </div>
      </div>
      <div style={emailBoardGridStyle(orderedColumns.length, rows.length)}>
        <div style={boardCornerStyle}>Priority</div>
        {orderedColumns.map((column, index) => (
          <div key={column.column_id} style={{ ...boardColumnHeaderStyle, gridColumn: index + 2, borderColor: column.item_color }}>
            {column.title}
          </div>
        ))}
        {rows.map((priority, rowIndex) => (
          <div key={priority} style={{ ...boardRowHeaderStyle, gridRow: rowIndex + 2 }}>
            {priority === 5 ? "5 Urgent" : priority === 0 ? "0 Unassigned" : `${priority} Priority`}
          </div>
        ))}
        {orderedColumns.map((column, columnIndex) => rows.map((priority, rowIndex) => {
          const columnCards = (cardsByColumn.get(column.column_id) ?? []).filter((card) => (nodeByID.get(card.node_id)?.priority ?? 0) === priority);
          return (
            <div
              key={`${column.column_id}:${priority}`}
              style={{ ...boardCellStyle, gridColumn: columnIndex + 2, gridRow: rowIndex + 2 }}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(EMAIL_DRAG_MIME) || event.dataTransfer.types.includes(EMAIL_BOARD_CARD_DRAG_MIME)) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const rawMessage = event.dataTransfer.getData(EMAIL_DRAG_MIME);
                if (rawMessage) {
                  const message = parseDraggedEmail(rawMessage);
                  if (message) onDropEmail(message, column, priority);
                  return;
                }
                const cardID = event.dataTransfer.getData(EMAIL_BOARD_CARD_DRAG_MIME).trim();
                if (cardID) onMoveCard(cardID, column, priority);
              }}
            >
              {columnCards.map((card) => (
                <article
                  key={card.card_id}
                  draggable
                  style={emailBoardCardStyle(column.item_color)}
                  onDoubleClick={() => onOpenNode({ nodeID: card.node_id, nodeTitle: card.node_title })}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onContextCard({ x: event.clientX, y: event.clientY, cardID: card.card_id });
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(EMAIL_BOARD_CARD_DRAG_MIME, card.card_id);
                  }}
                >
                  <strong>{card.node_title}</strong>
                  {card.description_snapshot && <span>{card.description_snapshot}</span>}
                </article>
              ))}
            </div>
          );
        }))}
      </div>
      {editor && (
        <div style={boardEditorOverlayStyle}>
          <button type="button" style={overlayCloseButtonStyle} onClick={onCloseEditor}>X</button>
          <EditorContent
            accent="#00e9ff"
            widgetId={`communications-email-board-node:${editor.nodeID}`}
            theme="light"
            forcedEntityKind="node"
            forcedEntityID={editor.nodeID}
            forcedLabel={editor.nodeTitle}
          />
        </div>
      )}
    </div>
  );
}

function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [onClose]);
  return (
    <div
      style={{ ...contextMenuStyle, left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function parseDraggedEmail(raw: string): EmailMessage | null {
  try {
    const parsed = JSON.parse(raw) as EmailMessage;
    return parsed && typeof parsed.id === "string" ? parsed : null;
  } catch {
    return null;
  }
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

function folderLabel(folder: EmailFolder): string {
  return folder.display_name || folder.name || folder.id;
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

function formatShortTime(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function userLabel(user?: CompanyUser): string {
  if (!user) return "Unknown";
  return user.display_name?.trim() || user.email?.trim() || user.user_id;
}

function emailNodeTitle(message: EmailMessage): string {
  return (message.subject || "").trim() || `Email from ${formatAddressList(message.from) || "unknown sender"}`;
}

function emailDescriptionSnapshot(message: EmailMessage): string {
  const from = formatAddressList(message.from);
  const snippet = (message.snippet || "").trim();
  return [from, snippet].filter(Boolean).join(" - ").slice(0, 260);
}

function formatEmailNodeInformation(message: EmailMessage): string {
  const lines = [
    `Email: ${emailNodeTitle(message)}`,
    `From: ${formatAddressList(message.from) || "Unknown sender"}`,
    `To: ${formatAddressList(message.to) || "Me"}`,
    `Date: ${message.date ? new Date(message.date * 1000).toISOString() : ""}`,
    `Message ID: ${message.id}`,
    "",
    htmlToPlainText(message.body || message.snippet || "").slice(0, 8000),
  ];
  return lines.join("\n").trim();
}

function htmlToPlainText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (typeof DOMParser !== "undefined" && /<\/?[a-z][\s\S]*>/i.test(trimmed)) {
    const parsed = new DOMParser().parseFromString(trimmed, "text/html");
    return parsed.body.textContent?.trim() || trimmed;
  }
  return trimmed.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function messageDocument(body: string): string {
  const value = body.trim();
  const content = /<\/?[a-z][\s\S]*>/i.test(value) ? value : `<pre>${escapeHTML(value)}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px/1.5 Arial,sans-serif;color:#111;margin:0;padding:14px;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:14px/1.5 Arial,sans-serif}</style></head><body>${content}</body></html>`;
}

function escapeHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
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
  background: "#f7fffe",
  color: "#041d22",
  fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  padding: "0 18px",
  borderBottom: "1px solid rgba(12, 67, 74, 0.25)",
  background: "#ffffff",
};

const brandStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 800,
  letterSpacing: 0,
  textTransform: "uppercase",
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  textTransform: "uppercase",
};

const headerDividerStyle: React.CSSProperties = {
  width: 1,
  height: 22,
  background: "rgba(12, 67, 74, 0.25)",
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

const panelStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto",
  gap: 10,
  padding: 10,
  border: "1px solid rgba(12, 67, 74, 0.22)",
  background: "#ffffff",
  borderRadius: 8,
  overflow: "hidden",
};

const connectPanelStyle: React.CSSProperties = {
  width: "min(460px, calc(100vw - 28px))",
  display: "grid",
  gap: 12,
  padding: 16,
  border: "1px solid rgba(12, 67, 74, 0.24)",
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
  fontWeight: 800,
  textTransform: "uppercase",
};

const mutedTextStyle: React.CSSProperties = {
  color: "rgba(4, 29, 34, 0.68)",
  fontSize: 12,
  lineHeight: 1.45,
};

const mutedSmallStyle: React.CSSProperties = {
  color: "rgba(4, 29, 34, 0.62)",
  fontSize: 11,
  overflowWrap: "anywhere",
};

const smallButtonStyle: React.CSSProperties = {
  minHeight: 30,
  border: "1px solid rgba(12, 67, 74, 0.32)",
  borderRadius: 6,
  background: "#fff",
  color: "#041d22",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  padding: "0 9px",
};

const headerButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  border: "1px solid rgba(0, 233, 255, 0.62)",
  background: "linear-gradient(180deg, rgba(9, 31, 38, 0.84), rgba(5, 18, 23, 0.72))",
  color: "#e8fbff",
  fontWeight: 800,
  boxShadow: "0 0 0 1px rgba(0, 233, 255, 0.12) inset, 0 8px 20px rgba(0, 0, 0, 0.18)",
};

const primaryButtonStyle: React.CSSProperties = {
  minHeight: 34,
  border: "1px solid #07545d",
  borderRadius: 6,
  background: "#00e9ff",
  color: "#041d22",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  fontWeight: 800,
  padding: "0 10px",
};

const composeButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  width: 118,
  minHeight: 26,
  justifySelf: "start",
  padding: "0 8px",
};

const dangerButtonStyle: React.CSSProperties = {
  borderColor: "#ff3d7f",
  color: "#8b123f",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 34,
  border: "1px solid rgba(12, 67, 74, 0.28)",
  borderRadius: 6,
  padding: "0 9px",
  font: "inherit",
  fontSize: 12,
  boxSizing: "border-box",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: "min(280px, 34vh)",
  resize: "vertical",
  padding: 9,
  lineHeight: 1.45,
};

const folderListStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  display: "grid",
  alignContent: "start",
  gap: 4,
};

function folderButtonStyle(active: boolean): React.CSSProperties {
  return {
    minHeight: 32,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
    alignItems: "center",
    border: `1px solid ${active ? "#07545d" : "rgba(12, 67, 74, 0.18)"}`,
    borderRadius: 6,
    background: active ? "#dffcff" : "#ffffff",
    color: "#041d22",
    cursor: "pointer",
    font: "inherit",
    fontSize: 11,
    padding: "0 8px",
    textAlign: "left",
  };
}

const searchRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 6,
};

const smartFilterGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(78px, 1fr))",
  gap: 5,
};

function smartFilterButtonStyle(active: boolean): React.CSSProperties {
  return {
    ...smallButtonStyle,
    minHeight: 28,
    borderColor: active ? "#07545d" : "rgba(12, 67, 74, 0.22)",
    background: active ? "#dffcff" : "#ffffff",
    fontWeight: active ? 900 : 700,
  };
}

const liveStatusStyle: React.CSSProperties = {
  border: "1px solid rgba(47, 125, 98, 0.28)",
  borderRadius: 6,
  background: "#effff6",
  color: "#0f7b3f",
  fontSize: 10,
  fontWeight: 800,
  padding: "6px 8px",
  textTransform: "uppercase",
};

const listHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
};

const messageListStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  display: "grid",
  alignContent: "start",
  gap: 6,
};

function messageRowStyle(active: boolean, unread: boolean): React.CSSProperties {
  return {
    display: "grid",
    gap: 4,
    minHeight: 78,
    border: `1px solid ${active ? "#07545d" : unread ? "rgba(0, 184, 204, 0.45)" : "rgba(12, 67, 74, 0.16)"}`,
    borderRadius: 7,
    background: active ? "#dffcff" : unread ? "#f2feff" : "#ffffff",
    cursor: "grab",
    color: "#041d22",
    font: "inherit",
    fontSize: 12,
    padding: 9,
    textAlign: "left",
    minWidth: 0,
  };
}

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
  color: "rgba(4, 29, 34, 0.62)",
  fontSize: 11,
  lineHeight: 1.35,
};

const paginationStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
};

const rightPanelStackStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "minmax(300px, 1fr) minmax(220px, 0.72fr)",
  gap: 10,
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
  border: "1px solid rgba(12, 67, 74, 0.16)",
  borderRadius: 6,
  background: "#fff",
};

const composeStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gap: 8,
  alignContent: "start",
};

const teamPanelStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  display: "grid",
  alignContent: "start",
  gap: 10,
  paddingTop: 10,
  borderTop: "1px solid rgba(12, 67, 74, 0.18)",
};

const teamGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
};

const switchLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  fontWeight: 800,
};

const fieldLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  fontSize: 10,
  fontWeight: 900,
  textTransform: "uppercase",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  padding: "0 6px",
};

const subsectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 900,
  textTransform: "uppercase",
  color: "rgba(4, 29, 34, 0.72)",
};

const receiptListStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 5,
};

function receiptPillStyle(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? "#07545d" : "rgba(12, 67, 74, 0.2)"}`,
    borderRadius: 5,
    background: active ? "#dffcff" : "#ffffff",
    fontSize: 10,
    padding: "4px 6px",
  };
}

const commentListStyle: React.CSSProperties = {
  maxHeight: 90,
  overflow: "auto",
  display: "grid",
  gap: 5,
};

const commentItemStyle: React.CSSProperties = {
  display: "grid",
  gap: 2,
  border: "1px solid rgba(12, 67, 74, 0.14)",
  borderRadius: 6,
  padding: 7,
  fontSize: 11,
  lineHeight: 1.35,
};

const commentComposerStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 6,
};

const sharedDraftTextareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: 90,
  resize: "vertical",
  padding: 8,
  lineHeight: 1.35,
};

const conversionPanelStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
  gap: 10,
};

const conversionEditorShellStyle: React.CSSProperties = {
  minHeight: 0,
  border: "1px solid rgba(12, 67, 74, 0.22)",
  borderRadius: 6,
  overflow: "hidden",
};

const logicGatePickerStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
};

const logicGateListStyle: React.CSSProperties = {
  maxHeight: 110,
  overflow: "auto",
  display: "grid",
  gap: 4,
};

function logicGateOptionStyle(active: boolean): React.CSSProperties {
  return {
    minHeight: 28,
    border: `1px solid ${active ? "#07545d" : "rgba(12, 67, 74, 0.18)"}`,
    borderRadius: 6,
    background: active ? "#dffcff" : "#ffffff",
    color: "#041d22",
    cursor: "pointer",
    font: "inherit",
    fontSize: 11,
    textAlign: "left",
    padding: "0 8px",
  };
}

const emailBoardStyle: React.CSSProperties = {
  position: "relative",
  minHeight: 0,
  overflow: "auto",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 10,
};

const boardControlRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
};

function emailBoardGridStyle(columns: number, rows: number): React.CSSProperties {
  return {
    minWidth: 120 + Math.max(1, columns) * 230,
    display: "grid",
    gridTemplateColumns: `104px repeat(${Math.max(1, columns)}, 230px)`,
    gridTemplateRows: `34px repeat(${Math.max(1, rows)}, minmax(92px, auto))`,
    gap: 6,
    alignItems: "stretch",
    paddingBottom: 12,
  };
}

const boardCornerStyle: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  color: "rgba(4, 29, 34, 0.58)",
  fontSize: 10,
  fontWeight: 900,
  textTransform: "uppercase",
};

const boardColumnHeaderStyle: React.CSSProperties = {
  display: "grid",
  alignItems: "center",
  border: "1px solid rgba(12, 67, 74, 0.24)",
  borderRadius: 6,
  background: "#f7fffe",
  fontSize: 11,
  fontWeight: 900,
  padding: "0 8px",
};

const boardRowHeaderStyle: React.CSSProperties = {
  display: "grid",
  alignItems: "start",
  justifyItems: "end",
  color: "rgba(4, 29, 34, 0.68)",
  fontSize: 10,
  fontWeight: 900,
  lineHeight: 1.2,
  paddingTop: 8,
  textTransform: "uppercase",
};

const boardCellStyle: React.CSSProperties = {
  minHeight: 92,
  display: "grid",
  alignContent: "start",
  gap: 6,
  border: "1px solid rgba(0, 184, 204, 0.26)",
  borderRadius: 7,
  background: "#ffffff",
  padding: 7,
};

function emailBoardCardStyle(color: string): React.CSSProperties {
  return {
    display: "grid",
    gap: 4,
    border: `1px solid ${color || "rgba(12, 67, 74, 0.22)"}`,
    borderLeft: `5px solid ${color || "#2f7d62"}`,
    borderRadius: 6,
    background: "#ffffff",
    color: "#041d22",
    cursor: "grab",
    fontSize: 11,
    lineHeight: 1.3,
    padding: "7px 8px",
    overflowWrap: "anywhere",
  };
}

const boardEditorOverlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: "42px 18px 18px",
  zIndex: 20,
  border: "2px solid #111111",
  background: "#ffffff",
  boxShadow: "0 18px 42px rgba(0,0,0,0.24)",
  overflow: "hidden",
};

const overlayCloseButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 7,
  right: 8,
  zIndex: 8,
  width: 24,
  height: 24,
  border: "1px solid #8b0000",
  background: "#ff1f1f",
  color: "#ffffff",
  fontSize: 16,
  fontWeight: 900,
  lineHeight: "20px",
  cursor: "pointer",
};

const contextMenuStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 1000,
  width: 270,
  display: "grid",
  gap: 2,
  border: "1px solid rgba(12, 67, 74, 0.24)",
  borderRadius: 8,
  background: "#ffffff",
  boxShadow: "0 16px 36px rgba(0,0,0,0.18)",
  padding: 6,
};

const contextMenuButtonStyle: React.CSSProperties = {
  minHeight: 32,
  border: "none",
  borderRadius: 6,
  background: "#ffffff",
  color: "#041d22",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  fontWeight: 800,
  padding: "0 8px",
  textAlign: "left",
};

const errorInlineStyle: React.CSSProperties = {
  padding: "7px 9px",
  border: "1px solid rgba(255, 61, 127, 0.24)",
  borderRadius: 6,
  background: "#fff0f4",
  color: "#8b123f",
  fontSize: 11,
};

const emptyStateStyle: React.CSSProperties = {
  minHeight: 120,
  display: "grid",
  placeItems: "center",
  color: "rgba(4, 29, 34, 0.56)",
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
  fontWeight: 800,
};
