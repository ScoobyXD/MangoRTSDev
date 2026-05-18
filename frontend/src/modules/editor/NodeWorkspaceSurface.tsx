import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCurrentUser } from "../../auth/cognitoAuth";
import { getNodeTitle as getLogicGateTitle, type LogicGateRecord } from "../logic-gate-map/shared";
import {
  buildEditorAttachedEmailPayload,
  buildEditorTextBlockContentPayload,
  buildEditorTextBlockChatPayload,
  EDITOR_ATTACHED_EMAIL_TYPE,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  EDITOR_TEXT_BLOCK_TYPE,
  canDeleteEditorTextBlockChatMessage,
  listEditorTextBlockProjections,
  parseEditorAttachedEmails,
  parseEditorTextBlockContent,
  parseEditorTextBlockChats,
  type EditorAttachedEmail,
  type EditorChatAttachment,
  type EditorTextBlockContent,
  type EditorTextBlockChatMessage,
} from "./editorProjection";
import { EDITOR_AUTOSAVE_DELAY_MS, generateStableInformationID } from "./editorTypes";
import { resolveEditorTextBlockChatAnchorMessageID } from "./editorTextBlockChatHighlights";
import { createEditorImageFrame } from "./editorImages";
import { serializeEditorDocumentHTML } from "./richTextEditing";

import {
  AttachedEmailsPanel,
  ChatPane,
  DeleteTextBlockConfirmationModal,
  EmailDetailModal,
  EmailPickerModal,
  NodeTextBlockEditor,
  TextBlockActionsMenu,
  TimelineCell,
} from "./NodeWorkspaceSurfaceParts";
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES,
  DEFAULT_TEXT_BLOCK_TITLE,
  EMAIL_DRAG_MIME,
  formatFileSize,
  formatTimestamp,
  ChatIcon,
  MailIcon,
  messageAttachmentPayload,
  parseDraggedEmail,
  PlusIcon,
  projectionsKey,
  readChatAttachment,
  type NodeWorkspaceSurfaceProps,
  type TextBlockImageDraft,
  type TextBlockSelectionAnchor,
  type TextBlockSelectionDraft,
  type TextBlockState,
} from "./NodeWorkspaceSurfaceShared";

const DEFAULT_TEXT_CHAT_SPLIT_RATIO = 0.704;
const TEXT_CHAT_SPLIT_MIN_RATIO = 0.50;
const TEXT_CHAT_SPLIT_MAX_RATIO = 0.84;
const TEXT_CHAT_SPLIT_STORAGE_KEY_PREFIX = "node-editor-text-chat-split-ratio-v1";

function clampTextChatSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TEXT_CHAT_SPLIT_RATIO;
  return Math.max(TEXT_CHAT_SPLIT_MIN_RATIO, Math.min(TEXT_CHAT_SPLIT_MAX_RATIO, value));
}

function textChatSplitStorageKey(companyID: string, nodeID: string): string {
  return `${TEXT_CHAT_SPLIT_STORAGE_KEY_PREFIX}:${companyID || "company"}:${nodeID || "node"}`;
}

function readStoredTextChatSplitRatio(companyID: string, nodeID: string): number {
  if (typeof localStorage === "undefined") return DEFAULT_TEXT_CHAT_SPLIT_RATIO;
  const parsed = Number.parseFloat(localStorage.getItem(textChatSplitStorageKey(companyID, nodeID)) ?? "");
  return Number.isFinite(parsed) ? clampTextChatSplitRatio(parsed) : DEFAULT_TEXT_CHAT_SPLIT_RATIO;
}

function storeTextChatSplitRatio(companyID: string, nodeID: string, ratio: number) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(textChatSplitStorageKey(companyID, nodeID), String(clampTextChatSplitRatio(ratio)));
}

function logicGateOptionLabel(logicGate: LogicGateRecord): string {
  return getLogicGateTitle({ header: logicGate.header, title: logicGate.header }).trim() || logicGate.logic_gate_id;
}

function sortLogicGateOptions(items: LogicGateRecord[]): LogicGateRecord[] {
  return [...items].sort((a, b) => (
    logicGateOptionLabel(a).localeCompare(logicGateOptionLabel(b), undefined, { numeric: true, sensitivity: "base" })
    || a.logic_gate_id.localeCompare(b.logic_gate_id)
  ));
}

export const NodeWorkspaceSurface: React.FC<NodeWorkspaceSurfaceProps> = ({
  companyID,
  nodeID,
  projections,
  projectionsLoaded,
  topPx,
  accent,
  surfaceText,
  panelBackground,
  strokeColor,
  ruleColor,
  scrollbarAccent,
  scrollbarTrack,
  outlineStyle,
  requestJSON,
  onProjectionMutation,
  onCreateNodeFromImage,
  onAssignToLogicGate,
  onError,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const saveTimersRef = useRef(new Map<string, number>());
  const contentByBlockRef = useRef(new Map<string, EditorTextBlockContent>());
  const focusBlockIDRef = useRef("");
  const previousNodeIDRef = useRef(nodeID);
  const [width, setWidth] = useState(0);
  const [blocks, setBlocks] = useState<TextBlockState[]>([]);
  const [chatMessages, setChatMessages] = useState<EditorTextBlockChatMessage[]>([]);
  const [attachedEmails, setAttachedEmails] = useState<EditorAttachedEmail[]>([]);
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [chatDraftAttachments, setChatDraftAttachments] = useState<Record<string, EditorChatAttachment[]>>({});
  const [chatReplyTargets, setChatReplyTargets] = useState<Record<string, string>>({});
  const [chatSelectionAnchors, setChatSelectionAnchors] = useState<Record<string, TextBlockSelectionAnchor>>({});
  const [activeChatMessageIDs, setActiveChatMessageIDs] = useState<Record<string, string>>({});
  const [activeChatBlockID, setActiveChatBlockID] = useState("");
  const [chatNavigationRequest, setChatNavigationRequest] = useState<{ blockID: string; anchorMessageID: string; requestID: number } | null>(null);
  const [closedChatBlockIDs, setClosedChatBlockIDs] = useState<Set<string>>(() => new Set());
  const [focusedTextBlockID, setFocusedTextBlockID] = useState("");
  const [emailPickerOpen, setEmailPickerOpen] = useState(false);
  const [selectedEmailID, setSelectedEmailID] = useState("");
  const [logicGateAssignerOpen, setLogicGateAssignerOpen] = useState(false);
  const [logicGateSearch, setLogicGateSearch] = useState("");
  const [logicGateOptions, setLogicGateOptions] = useState<LogicGateRecord[]>([]);
  const [logicGateOptionsLoading, setLogicGateOptionsLoading] = useState(false);
  const [logicGateSearchResults, setLogicGateSearchResults] = useState<LogicGateRecord[]>([]);
  const [logicGateSearchLoading, setLogicGateSearchLoading] = useState(false);
  const [assigningLogicGateID, setAssigningLogicGateID] = useState("");
  const [logicGateAssignStatus, setLogicGateAssignStatus] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [author, setAuthor] = useState({ userID: "", name: "You" });
  const [deleteTextBlockConfirmation, setDeleteTextBlockConfirmation] = useState<{ blockID: string; title: string; chatCount: number } | null>(null);
  const [textChatSplitRatio, setTextChatSplitRatio] = useState(() => readStoredTextChatSplitRatio(companyID, nodeID));
  const textChatSplitRatioRef = useRef(textChatSplitRatio);
  const autoCreatedTextBlockNodeIDsRef = useRef(new Set<string>());

  const projectionIdentity = useMemo(() => projectionsKey(projections), [projections]);
  const compact = width > 0 && width < 720;
  const editorGridTemplateColumns = compact
    ? "58px minmax(0, 1fr)"
    : `62px minmax(0, ${textChatSplitRatio}fr) 8px minmax(0, ${1 - textChatSplitRatio}fr)`;
  const myLogicGates = useMemo(
    () => sortLogicGateOptions(logicGateOptions),
    [logicGateOptions],
  );
  const searchedLogicGates = useMemo(() => sortLogicGateOptions(logicGateSearchResults), [logicGateSearchResults]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const updateWidth = () => setWidth(root.getBoundingClientRect().width);
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const nextRatio = readStoredTextChatSplitRatio(companyID, nodeID);
    textChatSplitRatioRef.current = nextRatio;
    setTextChatSplitRatio(nextRatio);
  }, [companyID, nodeID]);

  useEffect(() => {
    textChatSplitRatioRef.current = textChatSplitRatio;
  }, [textChatSplitRatio]);

  useEffect(() => {
    const textBlocks = listEditorTextBlockProjections(projections).map((item) => {
      const content = parseEditorTextBlockContent(item.information);
      return {
        id: item.information_id,
        title: content.title,
        document: content.document,
        createdTimestamp: item.created_timestamp,
        updatedTimestamp: item.updated_timestamp,
        pending: false,
      };
    });
    const parsedChatMessages = parseEditorTextBlockChats(projections);
    setBlocks(textBlocks);
    contentByBlockRef.current = new Map(textBlocks.map((block) => [block.id, { title: block.title, document: block.document }]));
    setChatMessages(parsedChatMessages);
    setAttachedEmails(parseEditorAttachedEmails(projections));
    const nodeChanged = previousNodeIDRef.current !== nodeID;
    previousNodeIDRef.current = nodeID;
    const blockIDs = new Set(textBlocks.map((block) => block.id));
    const messageIDsByBlock = new Map<string, Set<string>>();
    for (const message of parsedChatMessages) {
      const messageIDs = messageIDsByBlock.get(message.blockID) ?? new Set<string>();
      messageIDs.add(message.id);
      messageIDsByBlock.set(message.blockID, messageIDs);
    }
    setChatDrafts((current) => nodeChanged ? {} : Object.fromEntries(Object.entries(current).filter(([id]) => blockIDs.has(id))));
    setChatDraftAttachments((current) => nodeChanged ? {} : Object.fromEntries(Object.entries(current).filter(([id]) => blockIDs.has(id))));
    setChatReplyTargets((current) => {
      if (nodeChanged) return {};
      return Object.fromEntries(Object.entries(current).filter(([blockID, messageID]) => Boolean(messageIDsByBlock.get(blockID)?.has(messageID))));
    });
    setChatSelectionAnchors((current) => (nodeChanged ? {} : Object.fromEntries(Object.entries(current).filter(([id]) => blockIDs.has(id)))));
    setActiveChatMessageIDs((current) => {
      if (nodeChanged) return {};
      return Object.fromEntries(Object.entries(current).filter(([blockID, messageID]) => Boolean(messageIDsByBlock.get(blockID)?.has(messageID))));
    });
    setActiveChatBlockID((current) => (nodeChanged || !blockIDs.has(current) ? "" : current));
    setClosedChatBlockIDs((current) => {
      if (nodeChanged) return new Set();
      return new Set(Array.from(current).filter((id) => blockIDs.has(id)));
    });
    setFocusedTextBlockID((current) => (nodeChanged || !blockIDs.has(current) ? "" : current));
  }, [nodeID, projectionIdentity, projections]);

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentUser()
      .then((payload) => {
        if (cancelled) return;
        const name = payload.user.display_name?.trim() || payload.user.email?.trim() || "You";
        setAuthor({ userID: payload.user.user_id, name });
      })
      .catch(() => {
        if (!cancelled) setAuthor({ userID: "", name: "You" });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!logicGateAssignerOpen || !companyID) return;
    let cancelled = false;
    setLogicGateOptionsLoading(true);
    const params = new URLSearchParams({ company_id: companyID, assigned_to_me: "1" });
    void requestJSON<{ logic_gates?: LogicGateRecord[] }>(`/v1/logic-gates?${params.toString()}`)
      .then((payload) => {
        if (!cancelled) setLogicGateOptions(payload.logic_gates ?? []);
      })
      .catch((cause) => {
        if (!cancelled) onError(cause instanceof Error ? cause.message : "failed_to_load_logic_gates");
      })
      .finally(() => {
        if (!cancelled) setLogicGateOptionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyID, logicGateAssignerOpen, onError, requestJSON]);

  useEffect(() => {
    const query = logicGateSearch.trim();
    if (!logicGateAssignerOpen || !companyID || !query) {
      setLogicGateSearchResults([]);
      setLogicGateSearchLoading(false);
      return;
    }
    let cancelled = false;
    setLogicGateSearchLoading(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ company_id: companyID, q: query, limit: "12" });
      void requestJSON<{ logic_gates?: LogicGateRecord[] }>(`/v1/logic-gates?${params.toString()}`)
        .then((payload) => {
          if (!cancelled) setLogicGateSearchResults(payload.logic_gates ?? []);
        })
        .catch((cause) => {
          if (!cancelled) onError(cause instanceof Error ? cause.message : "failed_to_search_logic_gates");
        })
        .finally(() => {
          if (!cancelled) setLogicGateSearchLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [companyID, logicGateAssignerOpen, logicGateSearch, onError, requestJSON]);

  useEffect(() => () => {
    for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer);
    saveTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!focusBlockIDRef.current) return;
    const blockID = focusBlockIDRef.current;
    focusBlockIDRef.current = "";
    window.requestAnimationFrame(() => {
      const editor = rootRef.current?.querySelector<HTMLElement>(`[data-node-text-block-id="${blockID}"]`);
      editor?.focus({ preventScroll: true });
    });
  }, [blocks.length]);

  const persistTextBlock = useCallback(async (blockID: string, content: EditorTextBlockContent) => {
    if (!nodeID || !companyID) return;
    setBlocks((current) => current.map((block) => block.id === blockID ? { ...block, pending: true } : block));
    try {
      const information = buildEditorTextBlockContentPayload(content);
      if (information.trim()) {
        await requestJSON<unknown>(`/v1/nodes/${nodeID}/information`, {
          method: "POST",
          body: JSON.stringify({
            company_id: companyID,
            type: EDITOR_TEXT_BLOCK_TYPE,
            information,
            information_id: blockID,
          }),
        });
      } else {
        await requestJSON<unknown>(`/v1/nodes/${nodeID}/projection/${blockID}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
      }
      onProjectionMutation();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_save_text_block");
    } finally {
      setBlocks((current) => current.map((block) => block.id === blockID ? { ...block, pending: false } : block));
    }
  }, [companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const flushTextBlockSave = useCallback((blockID: string) => {
    const timer = saveTimersRef.current.get(blockID);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      saveTimersRef.current.delete(blockID);
    }
    void persistTextBlock(blockID, contentByBlockRef.current.get(blockID) ?? { title: "", document: "" });
  }, [persistTextBlock]);

  const scheduleTextBlockSave = useCallback((blockID: string, content: EditorTextBlockContent) => {
    contentByBlockRef.current.set(blockID, content);
    const existingTimer = saveTimersRef.current.get(blockID);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(blockID);
      void persistTextBlock(blockID, contentByBlockRef.current.get(blockID) ?? { title: "", document: "" });
    }, EDITOR_AUTOSAVE_DELAY_MS);
    saveTimersRef.current.set(blockID, timer);
  }, [persistTextBlock]);

  const createTextBlock = useCallback(() => {
    const now = new Date().toISOString();
    const blockID = generateStableInformationID();
    const initialContent: EditorTextBlockContent = { title: DEFAULT_TEXT_BLOCK_TITLE, document: "" };
    focusBlockIDRef.current = blockID;
    contentByBlockRef.current.set(blockID, initialContent);
    setBlocks((current) => [
      {
        id: blockID,
        title: initialContent.title,
        document: "",
        createdTimestamp: now,
        updatedTimestamp: now,
        pending: true,
      },
      ...current,
    ]);
    void persistTextBlock(blockID, initialContent);
  }, [persistTextBlock]);

  useEffect(() => {
    if (!projectionsLoaded || !nodeID || blocks.length > 0 || autoCreatedTextBlockNodeIDsRef.current.has(nodeID)) return;
    autoCreatedTextBlockNodeIDsRef.current.add(nodeID);
    createTextBlock();
  }, [blocks.length, createTextBlock, nodeID, projectionsLoaded]);

  const updateTextBlockContent = useCallback((blockID: string, patch: Partial<EditorTextBlockContent>) => {
    const existing = contentByBlockRef.current.get(blockID) ?? { title: "", document: "" };
    const nextContent: EditorTextBlockContent = {
      title: patch.title ?? existing.title,
      document: patch.document ?? existing.document,
    };
    setBlocks((current) => current.map((block) => {
      if (block.id !== blockID) return block;
      return { ...block, ...nextContent, updatedTimestamp: new Date().toISOString() };
    }));
    scheduleTextBlockSave(blockID, nextContent);
  }, [scheduleTextBlockSave]);

  const renameTextBlock = useCallback((blockID: string) => {
    const block = blocks.find((item) => item.id === blockID);
    const nextTitle = window.prompt("Rename title", block?.title || DEFAULT_TEXT_BLOCK_TITLE);
    if (nextTitle === null) return;
    const title = nextTitle.trim();
    if (!title) return;
    updateTextBlockContent(blockID, { title });
    flushTextBlockSave(blockID);
  }, [blocks, flushTextBlockSave, updateTextBlockContent]);

  const deleteTextBlock = useCallback(async (blockID: string) => {
    if (!nodeID || !companyID) return;
    const timer = saveTimersRef.current.get(blockID);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      saveTimersRef.current.delete(blockID);
    }
    const relatedChatIDs = chatMessages.filter((message) => message.blockID === blockID).map((message) => message.id);
    const deletedInformationIDs = [blockID, ...relatedChatIDs];
    contentByBlockRef.current.delete(blockID);
    setBlocks((current) => current.filter((block) => block.id !== blockID));
    setChatMessages((current) => current.filter((message) => message.blockID !== blockID));
    setChatDrafts((current) => {
      if (!(blockID in current)) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
    setChatDraftAttachments((current) => {
      if (!(blockID in current)) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
    setChatReplyTargets((current) => {
      if (!(blockID in current)) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
    setChatSelectionAnchors((current) => {
      if (!(blockID in current)) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
    setActiveChatMessageIDs((current) => {
      if (!(blockID in current)) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
    setClosedChatBlockIDs((current) => {
      if (!current.has(blockID)) return current;
      const next = new Set(current);
      next.delete(blockID);
      return next;
    });
    setActiveChatBlockID((current) => current === blockID ? "" : current);
    setFocusedTextBlockID((current) => current === blockID ? "" : current);

    try {
      for (const informationID of deletedInformationIDs) {
        try {
          await requestJSON<unknown>(`/v1/nodes/${nodeID}/projection/${informationID}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "";
          if (!message.includes("node_projection_not_found")) throw cause;
        }
      }
      onProjectionMutation();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_delete_text_block");
      onProjectionMutation();
    }
  }, [chatMessages, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const requestDeleteTextBlock = useCallback((blockID: string) => {
    const block = blocks.find((item) => item.id === blockID);
    const chatCount = chatMessages.filter((message) => message.blockID === blockID).length;
    setDeleteTextBlockConfirmation({
      blockID,
      title: block?.title.trim() || DEFAULT_TEXT_BLOCK_TITLE,
      chatCount,
    });
  }, [blocks, chatMessages]);

  const openSelectionChat = useCallback((selection: TextBlockSelectionDraft) => {
    setFocusedTextBlockID("");
    setChatReplyTargets((current) => {
      if (!current[selection.blockID]) return current;
      const next = { ...current };
      delete next[selection.blockID];
      return next;
    });
    setChatSelectionAnchors((current) => ({ ...current, [selection.blockID]: selection }));
    setActiveChatMessageIDs((current) => {
      if (!current[selection.blockID]) return current;
      const next = { ...current };
      delete next[selection.blockID];
      return next;
    });
    setClosedChatBlockIDs((current) => {
      if (!current.has(selection.blockID)) return current;
      const next = new Set(current);
      next.delete(selection.blockID);
      return next;
    });
    setActiveChatBlockID(selection.blockID);
  }, []);

  const navigateToChatMessage = useCallback((blockID: string, messages: EditorTextBlockChatMessage[], messageID: string) => {
    const anchorMessageID = resolveEditorTextBlockChatAnchorMessageID(messages, messageID);
    if (!anchorMessageID) return;
    setFocusedTextBlockID(blockID);
    setClosedChatBlockIDs((current) => {
      if (!current.has(blockID)) return current;
      const next = new Set(current);
      next.delete(blockID);
      return next;
    });
    setActiveChatBlockID(blockID);
    setActiveChatMessageIDs((current) => ({ ...current, [blockID]: messageID }));
    setChatNavigationRequest((current) => ({
      blockID,
      anchorMessageID,
      requestID: (current?.requestID ?? 0) + 1,
    }));
  }, []);

  const submitChat = useCallback(async (blockID: string) => {
    const message = (chatDrafts[blockID] ?? "").trim();
    const attachments = chatDraftAttachments[blockID] ?? [];
    if (!message && attachments.length === 0) return;
    const now = new Date().toISOString();
    const id = generateStableInformationID();
    const parentID = chatReplyTargets[blockID] ?? "";
    const selectionAnchor = parentID ? undefined : chatSelectionAnchors[blockID];
    const nextMessage: EditorTextBlockChatMessage = {
      id,
      blockID,
      parentID: parentID || undefined,
      selectionQuote: selectionAnchor?.quote,
      selectionStart: selectionAnchor?.startOffset,
      selectionEnd: selectionAnchor?.endOffset,
      authorID: author.userID,
      authorName: author.name,
      message,
      createdTimestamp: now,
      attachments,
    };
    setChatDrafts((current) => ({ ...current, [blockID]: "" }));
    setChatDraftAttachments((current) => {
      if (!current[blockID]?.length) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
    setChatReplyTargets((current) => {
      if (!current[blockID]) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
    setChatSelectionAnchors((current) => {
      if (!(blockID in current)) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
    setChatMessages((current) => [...current, nextMessage]);
    setActiveChatMessageIDs((current) => ({ ...current, [blockID]: id }));
    setClosedChatBlockIDs((current) => {
      if (!current.has(blockID)) return current;
      const next = new Set(current);
      next.delete(blockID);
      return next;
    });
    try {
      await requestJSON<unknown>(`/v1/nodes/${nodeID}/information`, {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
          information: buildEditorTextBlockChatPayload({
            blockID,
            parentID,
            selectionQuote: selectionAnchor?.quote,
            selectionStart: selectionAnchor?.startOffset,
            selectionEnd: selectionAnchor?.endOffset,
            authorID: author.userID,
            authorName: author.name,
            message,
            createdTimestamp: now,
            attachments,
          }),
          information_id: id,
        }),
      });
      onProjectionMutation();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_save_chat_message");
    }
  }, [author.name, author.userID, chatDraftAttachments, chatDrafts, chatReplyTargets, chatSelectionAnchors, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const deleteChatMessage = useCallback(async (messageID: string) => {
    const message = chatMessages.find((item) => item.id === messageID);
    if (!message || !nodeID || !companyID) return;
    if (!canDeleteEditorTextBlockChatMessage(message, author.userID)) {
      onError("cannot_delete_other_users_chat_message");
      return;
    }

    setChatMessages((current) => current.filter((item) => item.id !== messageID));
    setChatReplyTargets((current) => {
      const nextEntries = Object.entries(current).filter(([, targetID]) => targetID !== messageID);
      return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
    });
    setActiveChatMessageIDs((current) => {
      const nextEntries = Object.entries(current).filter(([, activeID]) => activeID !== messageID);
      return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
    });

    try {
      await requestJSON<unknown>(`/v1/nodes/${nodeID}/projection/${messageID}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
      onProjectionMutation();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_delete_chat_message");
      onProjectionMutation();
    }
  }, [author.userID, chatMessages, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const addChatDraftAttachments = useCallback(async (blockID: string, files: FileList | File[]) => {
    const candidates = Array.from(files);
    if (candidates.length === 0) return;
    const existingBytes = (chatDraftAttachments[blockID] ?? []).reduce((total, attachment) => total + attachment.size, 0);
    let nextBytes = existingBytes;
    const accepted: File[] = [];
    for (const file of candidates) {
      if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
        onError(`${file.name} is larger than ${formatFileSize(CHAT_ATTACHMENT_MAX_BYTES)}.`);
        continue;
      }
      if (nextBytes + file.size > CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES) {
        onError(`Chat attachments are limited to ${formatFileSize(CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES)} per message.`);
        break;
      }
      accepted.push(file);
      nextBytes += file.size;
    }
    if (accepted.length === 0) return;
    try {
      const attachments = await Promise.all(accepted.map(readChatAttachment));
      setChatDraftAttachments((current) => ({
        ...current,
        [blockID]: [...(current[blockID] ?? []), ...attachments],
      }));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_read_attachment");
    }
  }, [chatDraftAttachments, onError]);

  const removeChatDraftAttachment = useCallback((blockID: string, attachmentID: string) => {
    setChatDraftAttachments((current) => {
      const nextAttachments = (current[blockID] ?? []).filter((attachment) => attachment.id !== attachmentID);
      if (nextAttachments.length === 0) {
        const next = { ...current };
        delete next[blockID];
        return next;
      }
      return { ...current, [blockID]: nextAttachments };
    });
  }, []);

  const addImageChatComment = useCallback((image: TextBlockImageDraft) => {
    const attachment: EditorChatAttachment = {
      id: generateStableInformationID(),
      name: "selected-image.png",
      type: image.mimeType || "image/png",
      size: image.size,
      dataURL: image.dataURL,
    };
    setFocusedTextBlockID("");
    setClosedChatBlockIDs((current) => {
      if (!current.has(image.blockID)) return current;
      const next = new Set(current);
      next.delete(image.blockID);
      return next;
    });
    setActiveChatBlockID(image.blockID);
    setChatReplyTargets((current) => {
      if (!current[image.blockID]) return current;
      const next = { ...current };
      delete next[image.blockID];
      return next;
    });
    setChatSelectionAnchors((current) => {
      if (!(image.blockID in current)) return current;
      const next = { ...current };
      delete next[image.blockID];
      return next;
    });
    setChatDraftAttachments((current) => ({
      ...current,
      [image.blockID]: [...(current[image.blockID] ?? []), attachment],
    }));
  }, []);

  const createNodeFromImage = useCallback(async (image: TextBlockImageDraft) => {
    if (typeof document === "undefined") return;
    const sourceBlock = blocks.find((block) => block.id === image.blockID);
    const sourceTitle = sourceBlock?.title.trim() || "Image";
    const container = document.createElement("div");
    const maxWidth = 520;
    const width = Math.max(48, Math.min(image.width || 320, maxWidth));
    const ratio = image.width > 0 && image.height > 0 ? image.height / image.width : 0.75;
    const height = Math.max(36, Math.min(Math.round(width * ratio), 900));
    container.appendChild(createEditorImageFrame(document, {
      src: image.dataURL,
      width,
      height,
      floatSide: "left",
      marginLeft: 0,
      marginTop: 4,
    }));
    const imageDocument = serializeEditorDocumentHTML(container);
    if (!imageDocument) return;
    try {
      await onCreateNodeFromImage({
        title: sourceTitle === "Image" ? "Image" : `Image - ${sourceTitle}`,
        document: imageDocument,
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_create_image_node");
    }
  }, [blocks, onCreateNodeFromImage, onError]);

  const attachEmail = useCallback(async (email: ReturnType<typeof messageAttachmentPayload>) => {
    if (attachedEmails.some((item) => item.messageID === email.messageID)) {
      setEmailPickerOpen(false);
      return;
    }
    const id = generateStableInformationID();
    const attached: EditorAttachedEmail = {
      id,
      messageID: email.messageID,
      threadID: email.threadID,
      subject: email.subject,
      snippet: email.snippet,
      from: email.from,
      date: email.date,
      attachedTimestamp: email.attachedTimestamp,
    };
    setAttachedEmails((current) => [attached, ...current]);
    setEmailPickerOpen(false);
    try {
      await requestJSON<unknown>(`/v1/nodes/${nodeID}/information`, {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          type: EDITOR_ATTACHED_EMAIL_TYPE,
          information: buildEditorAttachedEmailPayload(email),
          information_id: id,
        }),
      });
      onProjectionMutation();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_attach_email");
    }
  }, [attachedEmails, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const assignToLogicGate = useCallback(async (logicGateID: string) => {
    const cleanLogicGateID = logicGateID.trim();
    if (!cleanLogicGateID || assigningLogicGateID) return;
    setAssigningLogicGateID(cleanLogicGateID);
    setLogicGateAssignStatus("");
    try {
      await onAssignToLogicGate(cleanLogicGateID);
      setLogicGateAssignStatus("Assigned to Pending.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "failed_to_assign_logic_gate";
      setLogicGateAssignStatus(message);
      onError(message);
    } finally {
      setAssigningLogicGateID("");
    }
  }, [assigningLogicGateID, onAssignToLogicGate, onError]);

  const onDropEmail = useCallback((event: React.DragEvent) => {
    const email = parseDraggedEmail(event.dataTransfer);
    if (!email) return;
    event.preventDefault();
    setDropActive(false);
    void attachEmail({ ...email, attachedTimestamp: new Date().toISOString() });
  }, [attachEmail]);

  const startTextChatSplitResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const previousColumn = event.currentTarget.previousElementSibling;
    const nextColumn = event.currentTarget.nextElementSibling;
    if (!(previousColumn instanceof HTMLElement) || !(nextColumn instanceof HTMLElement)) return;
    const previousRect = previousColumn.getBoundingClientRect();
    const nextRect = nextColumn.getBoundingClientRect();
    const left = previousRect.left;
    const widthPx = Math.max(1, nextRect.right - previousRect.left);
    const ownerDocument = event.currentTarget.ownerDocument;
    const previousCursor = ownerDocument.body.style.cursor;
    ownerDocument.body.style.cursor = "col-resize";

    const updateRatio = (clientX: number) => {
      const nextRatio = clampTextChatSplitRatio((clientX - left) / widthPx);
      textChatSplitRatioRef.current = nextRatio;
      setTextChatSplitRatio(nextRatio);
    };
    const onPointerMove = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      updateRatio(pointerEvent.clientX);
    };
    const finish = () => {
      ownerDocument.body.style.cursor = previousCursor;
      ownerDocument.removeEventListener("pointermove", onPointerMove);
      ownerDocument.removeEventListener("pointerup", finish);
      ownerDocument.removeEventListener("pointercancel", finish);
      storeTextChatSplitRatio(companyID, nodeID, textChatSplitRatioRef.current);
    };

    updateRatio(event.clientX);
    ownerDocument.addEventListener("pointermove", onPointerMove);
    ownerDocument.addEventListener("pointerup", finish);
    ownerDocument.addEventListener("pointercancel", finish);
  }, [companyID, nodeID]);

  const chatMessagesByBlock = useMemo(() => {
    const grouped = new Map<string, EditorTextBlockChatMessage[]>();
    for (const message of chatMessages) {
      const blockMessages = grouped.get(message.blockID) ?? [];
      blockMessages.push(message);
      grouped.set(message.blockID, blockMessages);
    }
    return grouped;
  }, [chatMessages]);

  const renderTextChatSplitHandle = (enabled: boolean) => {
    if (compact) return null;
    if (!enabled) return <div aria-hidden="true" />;
    return (
      <div
        role="separator"
        aria-label="Resize text and chat columns"
        aria-orientation="vertical"
        data-frame-interactive="true"
        onPointerDown={startTextChatSplitResize}
        style={{
          alignSelf: "stretch",
          minHeight: 40,
          display: "flex",
          justifyContent: "center",
          padding: "0 2px",
          cursor: "col-resize",
          touchAction: "none",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 2,
            height: "100%",
            minHeight: 40,
            borderRadius: 2,
            background: ruleColor,
            opacity: 0.62,
          }}
        />
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className="editor-document-scroll"
      onWheel={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        top: topPx,
        right: 0,
        bottom: 0,
        left: 0,
        overflowY: "auto",
        overflowX: "hidden",
        scrollbarGutter: "stable",
        padding: "0 14px 38px 14px",
        cursor: "default",
        ["--editor-document-scroll-accent" as string]: scrollbarAccent,
        ["--editor-document-scroll-track" as string]: scrollbarTrack,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: editorGridTemplateColumns, columnGap: 8, rowGap: 12, alignItems: "start", minWidth: 0 }}>
        <div aria-hidden="true" style={{ minHeight: 32, padding: "2px 0 10px", background: "inherit" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0 10px", background: "inherit" }}>
          <button
            type="button"
            title="Add text box"
            onClick={createTextBlock}
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              border: `1px solid ${accent}`,
              background: panelBackground,
              color: accent,
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              flex: "0 0 auto",
            }}
          >
            <PlusIcon color={accent} />
          </button>
          <button
            type="button"
            onClick={() => setEmailPickerOpen(true)}
            style={{
              minHeight: 30,
              borderRadius: 6,
              border: `1px solid ${strokeColor}`,
              background: panelBackground,
              color: surfaceText,
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "0 10px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0,
            }}
          >
            <MailIcon color={accent} />
            Attach email
          </button>
          <button
            type="button"
            onClick={() => {
              setLogicGateAssignerOpen((open) => !open);
              setLogicGateAssignStatus("");
            }}
            style={{
              minHeight: 30,
              borderRadius: 6,
              border: `1px solid ${logicGateAssignerOpen ? accent : strokeColor}`,
              background: logicGateAssignerOpen ? "rgba(255,136,32,0.12)" : panelBackground,
              color: surfaceText,
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "0 10px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0,
            }}
          >
            Assign to logic gate
          </button>
        </div>

        {!compact && <div aria-hidden="true" />}
        {!compact && (
          <div style={{ minHeight: 32, borderBottom: `1px solid ${ruleColor}`, background: "inherit" }} />
        )}

        {logicGateAssignerOpen && (
          <>
            <div aria-hidden="true" />
            <div style={{ minWidth: 0, display: "grid", gap: 8, border: `1px solid ${strokeColor}`, borderRadius: 8, background: panelBackground, padding: 9 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: surfaceText }}>My Logic Gates</div>
                <div style={{ display: "grid", gap: 5, maxHeight: 132, overflowY: "auto", paddingRight: 2 }}>
                  {logicGateOptionsLoading && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64 }}>Loading...</div>}
                  {!logicGateOptionsLoading && myLogicGates.length === 0 && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64 }}>No assigned logic gates</div>}
                  {myLogicGates.map((logicGate) => (
                    <button
                      key={`mine-${logicGate.logic_gate_id}`}
                      type="button"
                      disabled={Boolean(assigningLogicGateID)}
                      onClick={() => { void assignToLogicGate(logicGate.logic_gate_id); }}
                      style={{ minHeight: 30, border: `1px solid ${strokeColor}`, borderRadius: 6, background: assigningLogicGateID === logicGate.logic_gate_id ? "rgba(255,136,32,0.16)" : "#ffffff", color: surfaceText, cursor: assigningLogicGateID ? "default" : "pointer", padding: "6px 8px", textAlign: "left", fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {logicGateOptionLabel(logicGate)}
                    </button>
                  ))}
                </div>
              </div>
              <input
                value={logicGateSearch}
                onChange={(event) => setLogicGateSearch(event.currentTarget.value)}
                placeholder="Search logic gates"
                style={{ width: "100%", minHeight: 30, border: `1px solid ${strokeColor}`, borderRadius: 6, outline: "none", background: "#ffffff", color: surfaceText, padding: "0 9px", boxSizing: "border-box", fontSize: 12, fontWeight: 700, letterSpacing: 0 }}
              />
              {logicGateSearch.trim() && (
                <div style={{ display: "grid", gap: 5, maxHeight: 160, overflowY: "auto", paddingRight: 2 }}>
                  {logicGateSearchLoading && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64 }}>Searching...</div>}
                  {!logicGateSearchLoading && searchedLogicGates.length === 0 && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64 }}>No matches</div>}
                  {searchedLogicGates.map((logicGate) => (
                    <button
                      key={`search-${logicGate.logic_gate_id}`}
                      type="button"
                      disabled={Boolean(assigningLogicGateID)}
                      onClick={() => { void assignToLogicGate(logicGate.logic_gate_id); }}
                      style={{ minHeight: 30, border: `1px solid ${strokeColor}`, borderRadius: 6, background: assigningLogicGateID === logicGate.logic_gate_id ? "rgba(255,136,32,0.16)" : "#ffffff", color: surfaceText, cursor: assigningLogicGateID ? "default" : "pointer", padding: "6px 8px", textAlign: "left", fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {logicGateOptionLabel(logicGate)}
                    </button>
                  ))}
                </div>
              )}
              {logicGateAssignStatus && <div style={{ fontSize: 11, fontWeight: 800, color: logicGateAssignStatus === "Assigned to Pending." ? accent : "#b42318" }}>{logicGateAssignStatus}</div>}
            </div>
            {!compact && <div aria-hidden="true" />}
            {!compact && <div aria-hidden="true" />}
          </>
        )}

        {blocks.length === 0 && (
          <>
            <TimelineCell accent={accent} muted isLast />
            <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, minHeight: 92, display: "grid", placeItems: "center", color: surfaceText, opacity: 0.7, fontSize: 13, fontWeight: 700 }}>
              No text boxes
            </div>
            {!compact && <div />}
            {!compact && <div />}
          </>
        )}

        {blocks.map((block, index) => {
          const messages = chatMessagesByBlock.get(block.id) ?? [];
          const chatIsActive = activeChatBlockID === block.id;
          const chatIsVisible = chatIsActive || (messages.length > 0 && !closedChatBlockIDs.has(block.id));
          const textBlockIsFocused = focusedTextBlockID === block.id;
          const selectionAnchor = chatSelectionAnchors[block.id];
          const activeChatMessageID = activeChatMessageIDs[block.id] ?? "";
          const activeChatAnchorMessageID = resolveEditorTextBlockChatAnchorMessageID(messages, activeChatMessageID);
          const toggleChat = () => {
            setFocusedTextBlockID("");
            const nextOpen = !chatIsVisible;
            setClosedChatBlockIDs((closed) => {
              const next = new Set(closed);
              if (nextOpen) next.delete(block.id);
              else next.add(block.id);
              return next;
            });
            setActiveChatBlockID(nextOpen ? block.id : "");
          };
          const focusChat = () => {
            setFocusedTextBlockID("");
            setClosedChatBlockIDs((current) => {
              if (!current.has(block.id)) return current;
              const next = new Set(current);
              next.delete(block.id);
              return next;
            });
            setActiveChatBlockID(block.id);
          };
          const replyToMessage = (messageID: string) => {
            focusChat();
            setChatReplyTargets((current) => ({ ...current, [block.id]: messageID }));
            setChatSelectionAnchors((current) => {
              if (!(block.id in current)) return current;
              const next = { ...current };
              delete next[block.id];
              return next;
            });
          };
          const activateChatMessage = (messageID: string) => {
            focusChat();
            setActiveChatMessageIDs((current) => {
              const next = { ...current };
              if (next[block.id] === messageID) {
                delete next[block.id];
                return next;
              }
              next[block.id] = messageID;
              return next;
            });
          };
          const clearReplyTarget = () => {
            setChatReplyTargets((current) => {
              if (!current[block.id]) return current;
              const next = { ...current };
              delete next[block.id];
              return next;
            });
          };
          return (
            <React.Fragment key={block.id}>
              <TimelineCell accent={accent} muted={false} isLast={index === blocks.length - 1} />
              <div style={{ minWidth: 0 }}>
                <div style={{ border: `1px solid ${textBlockIsFocused ? accent : strokeColor}`, borderRadius: 8, background: "rgba(255,255,255,0.72)", overflow: "hidden", boxShadow: textBlockIsFocused ? "0 0 0 2px rgba(255,136,32,0.14), 0 6px 18px rgba(0,0,0,0.05)" : "0 6px 18px rgba(0,0,0,0.05)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, auto) 26px 26px", alignItems: "center", gap: 8, minHeight: 32, borderBottom: `1px solid ${ruleColor}`, padding: "6px 6px 6px 8px", background: panelBackground }}>
                    <input
                      value={block.title}
                      onFocus={() => {
                        setFocusedTextBlockID(block.id);
                        setActiveChatBlockID("");
                      }}
                      onChange={(event) => updateTextBlockContent(block.id, { title: event.currentTarget.value })}
                      onBlur={() => flushTextBlockSave(block.id)}
                      placeholder={DEFAULT_TEXT_BLOCK_TITLE}
                      style={{
                        minWidth: 0,
                        width: "100%",
                        border: 0,
                        outline: "none",
                        background: "transparent",
                        color: surfaceText,
                        opacity: block.title ? 0.9 : 0.68,
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: 0,
                      }}
                    />
                    <div style={{ minWidth: 0, maxWidth: compact ? 210 : 380, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, paddingRight: 6, color: surfaceText, opacity: 0.58, fontSize: 10, fontWeight: 800, letterSpacing: 0, whiteSpace: "nowrap" }}>
                      <span title={`Last updated ${formatTimestamp(block.updatedTimestamp)}`} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                        Last updated {formatTimestamp(block.updatedTimestamp)}
                      </span>
                      <span aria-hidden="true" style={{ flex: "0 0 auto", opacity: 0.62 }}>|</span>
                      <span title={`Created ${formatTimestamp(block.createdTimestamp)}`} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                        Created {formatTimestamp(block.createdTimestamp)}
                      </span>
                    </div>
                    {messages.length > 0 || chatIsVisible ? (
                      <button
                        type="button"
                        title={chatIsVisible ? "Hide chat" : "Open chat"}
                        onClick={toggleChat}
                        style={{ width: 26, height: 24, borderRadius: 5, border: `1px solid ${chatIsActive ? accent : strokeColor}`, background: chatIsActive ? accent : "#ffffff", color: chatIsActive ? "#ffffff" : accent, display: "grid", placeItems: "center", cursor: "pointer" }}
                      >
                        <ChatIcon color={chatIsActive ? "#ffffff" : accent} />
                      </button>
                    ) : (
                      <div aria-hidden="true" style={{ width: 26, height: 24 }} />
                    )}
                    <TextBlockActionsMenu
                      accent={accent}
                      surfaceText={surfaceText}
                      panelBackground={panelBackground}
                      strokeColor={strokeColor}
                      onRename={() => renameTextBlock(block.id)}
                      onDelete={() => requestDeleteTextBlock(block.id)}
                    />
                  </div>
                  <NodeTextBlockEditor
                    blockID={block.id}
                    nodeID={nodeID}
                    companyID={companyID}
                    currentUserID={author.userID || "local-user"}
                    documentValue={block.document}
                    chatMessages={messages}
                    activeChatAnchorMessageID={activeChatAnchorMessageID}
                    chatNavigationRequest={chatNavigationRequest?.blockID === block.id
                      ? { anchorMessageID: chatNavigationRequest.anchorMessageID, requestID: chatNavigationRequest.requestID }
                      : null}
                    surfaceText={surfaceText}
                    accent={accent}
                    outlineStyle={outlineStyle}
                    indentGuideColor={ruleColor}
                    scrollbarTrack={scrollbarTrack}
                    onFocus={() => {
                      setFocusedTextBlockID(block.id);
                      setActiveChatBlockID("");
                    }}
                    onBlur={() => {
                      setFocusedTextBlockID((current) => current === block.id ? "" : current);
                    }}
                    onDocumentChange={(document) => updateTextBlockContent(block.id, { document })}
                    onDocumentFlush={(document) => {
                      updateTextBlockContent(block.id, { document });
                      flushTextBlockSave(block.id);
                    }}
                    onSelectionChatRequest={openSelectionChat}
                    onImageChatRequest={addImageChatComment}
                    onImageNodeRequest={(image) => { void createNodeFromImage(image); }}
                  />
                </div>
                {compact && chatIsVisible && (
                  <ChatPane
                    blockID={block.id}
                    messages={messages}
                    selectionAnchor={selectionAnchor}
                    draft={chatDrafts[block.id] ?? ""}
                    active={chatIsActive}
                    currentUserID={author.userID}
                    activeMessageID={activeChatMessageID}
                    accent={accent}
                    surfaceText={surfaceText}
                    panelBackground={panelBackground}
                    strokeColor={strokeColor}
                    ruleColor={ruleColor}
                    replyTargetID={chatReplyTargets[block.id] ?? ""}
                    draftAttachments={chatDraftAttachments[block.id] ?? []}
                    heightStorageKey={`node-editor-chat-pane-height-v1:${companyID}:${nodeID}:${block.id}`}
                    onFocus={focusChat}
                    onDraftChange={(draft) => setChatDrafts((current) => ({ ...current, [block.id]: draft }))}
                    onActivateMessage={activateChatMessage}
                    onNavigateToMessage={(messageID) => navigateToChatMessage(block.id, messages, messageID)}
                    onReply={replyToMessage}
                    onDeleteMessage={(messageID) => { void deleteChatMessage(messageID); }}
                    onClearReply={clearReplyTarget}
                    onAttachFiles={(files) => { void addChatDraftAttachments(block.id, files); }}
                    onRemoveDraftAttachment={(attachmentID) => removeChatDraftAttachment(block.id, attachmentID)}
                    onSubmit={() => { void submitChat(block.id); }}
                  />
                )}
              </div>
              {renderTextChatSplitHandle(chatIsVisible)}
              {!compact && (
                chatIsVisible ? (
                  <ChatPane
                    blockID={block.id}
                    messages={messages}
                    selectionAnchor={selectionAnchor}
                    draft={chatDrafts[block.id] ?? ""}
                    active={chatIsActive}
                    currentUserID={author.userID}
                    activeMessageID={activeChatMessageID}
                    accent={accent}
                    surfaceText={surfaceText}
                    panelBackground={panelBackground}
                    strokeColor={strokeColor}
                    ruleColor={ruleColor}
                    replyTargetID={chatReplyTargets[block.id] ?? ""}
                    draftAttachments={chatDraftAttachments[block.id] ?? []}
                    heightStorageKey={`node-editor-chat-pane-height-v1:${companyID}:${nodeID}:${block.id}`}
                    onFocus={focusChat}
                    onDraftChange={(draft) => setChatDrafts((current) => ({ ...current, [block.id]: draft }))}
                    onActivateMessage={activateChatMessage}
                    onNavigateToMessage={(messageID) => navigateToChatMessage(block.id, messages, messageID)}
                    onReply={replyToMessage}
                    onDeleteMessage={(messageID) => { void deleteChatMessage(messageID); }}
                    onClearReply={clearReplyTarget}
                    onAttachFiles={(files) => { void addChatDraftAttachments(block.id, files); }}
                    onRemoveDraftAttachment={(attachmentID) => removeChatDraftAttachment(block.id, attachmentID)}
                    onSubmit={() => { void submitChat(block.id); }}
                  />
                ) : <div />
              )}
            </React.Fragment>
          );
        })}

        <div />
        <div style={{ minWidth: 0, display: "grid", gap: 8 }}>
          <div
            onDragEnter={() => setDropActive(true)}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(EMAIL_DRAG_MIME)) event.preventDefault();
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={onDropEmail}
            style={{
              minHeight: 58,
              border: `1px ${dropActive ? "solid" : "dashed"} ${dropActive ? accent : strokeColor}`,
              borderRadius: 8,
              background: dropActive ? "rgba(255,136,32,0.08)" : panelBackground,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "10px 12px",
              color: surfaceText,
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <MailIcon color={accent} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Attach email</span>
            </span>
            <button
              type="button"
              onClick={() => setEmailPickerOpen(true)}
              style={{ border: `1px solid ${accent}`, background: "#ffffff", color: accent, borderRadius: 6, padding: "5px 9px", fontSize: 11, fontWeight: 800, cursor: "pointer", flex: "0 0 auto" }}
            >
              Add email
            </button>
          </div>
          <AttachedEmailsPanel emails={attachedEmails} accent={accent} surfaceText={surfaceText} panelBackground={panelBackground} strokeColor={strokeColor} onOpenEmail={setSelectedEmailID} />
        </div>
        {!compact && <div aria-hidden="true" />}
        {!compact && <div />}
      </div>

      {emailPickerOpen && (
        <EmailPickerModal
          accent={accent}
          surfaceText={surfaceText}
          panelBackground={panelBackground}
          strokeColor={strokeColor}
          onClose={() => setEmailPickerOpen(false)}
          onAttach={(message) => { void attachEmail(messageAttachmentPayload(message)); }}
        />
      )}
      {selectedEmailID && (
        <EmailDetailModal
          messageID={selectedEmailID}
          accent={accent}
          surfaceText={surfaceText}
          panelBackground={panelBackground}
          strokeColor={strokeColor}
          onClose={() => setSelectedEmailID("")}
        />
      )}
      {deleteTextBlockConfirmation && (
        <DeleteTextBlockConfirmationModal
          title={deleteTextBlockConfirmation.title}
          chatCount={deleteTextBlockConfirmation.chatCount}
          accent={accent}
          surfaceText={surfaceText}
          panelBackground={panelBackground}
          ruleColor={ruleColor}
          onConfirm={() => {
            const blockID = deleteTextBlockConfirmation.blockID;
            setDeleteTextBlockConfirmation(null);
            void deleteTextBlock(blockID);
          }}
          onCancel={() => setDeleteTextBlockConfirmation(null)}
        />
      )}
    </div>
  );
};

