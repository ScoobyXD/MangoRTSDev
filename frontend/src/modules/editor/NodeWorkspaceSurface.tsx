import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCurrentUser } from "../../auth/cognitoAuth";
import { humanLabelOrFallback } from "../entityLabels.js";
import { getLogicGateRecordSingleFlight } from "../logic-gate-map/LogicGateRecordStore.js";
import type { LogicGateRecord } from "../logic-gate-map/shared";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED } from "../node-map/eventbus";
import { ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
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
import type { NodeContentChange } from "./nodeContentChanges";
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
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_PANEL_SHADOW,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
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
const TEXT_CHAT_SPLIT_STORAGE_KEY_PREFIX = "node-editor-text-chat-split-ratio-v2";
const TEXT_TIMELINE_COLUMN_WIDTH_PX = 52;
const TEXT_TIMELINE_COMPACT_COLUMN_WIDTH_PX = 48;
const TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX = 8;
const TEXT_CHAT_GRID_COLUMN_GAP_PX = 8;
const TEXT_CHAT_HORIZONTAL_PADDING_PX = 28;
const TEXT_CHAT_PANE_MIN_WIDTH_PX = 300;
const TEXT_CHAT_PANE_MAX_WIDTH_PX = 520;

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
  return humanLabelOrFallback(logicGate.header, humanLabelOrFallback(logicGate.logic_gate_id, "Logic Gate"));
}

function sortLogicGateOptions(items: LogicGateRecord[]): LogicGateRecord[] {
  return [...items].sort((a, b) => (
    logicGateOptionLabel(a).localeCompare(logicGateOptionLabel(b), undefined, { numeric: true, sensitivity: "base" })
    || a.logic_gate_id.localeCompare(b.logic_gate_id)
  ));
}

type LogicGateOptionGroup = {
  key: string;
  label: string;
  logicGates: LogicGateRecord[];
};

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

function buildLogicGateOptionGroups(input: {
  logicGates: LogicGateRecord[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
}): LogicGateOptionGroup[] {
  const folderByID = new Map(input.folders.map((folder) => [folder.folder_id, folder]));
  const folderIDByLogicGateID = new Map(
    input.folderItems
      .filter((item) => item.item_type === "logic_gate")
      .map((item) => [item.item_id, item.folder_id]),
  );
  const groupByKey = new Map<string, LogicGateOptionGroup>();
  for (const logicGate of sortLogicGateOptions(input.logicGates)) {
    const folderID = folderIDByLogicGateID.get(logicGate.logic_gate_id) ?? "";
    const key = folderID || "unfiled";
    const group = groupByKey.get(key) ?? {
      key,
      label: folderID ? folderPathLabel(folderByID, folderID) : "Unfiled Logic Gates",
      logicGates: [],
    };
    group.logicGates.push(logicGate);
    groupByKey.set(key, group);
  }
  return Array.from(groupByKey.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
}

function uniqueLogicGateOptions(items: LogicGateRecord[]): LogicGateRecord[] {
  const byID = new Map<string, LogicGateRecord>();
  for (const item of items) {
    if (!item.logic_gate_id || byID.has(item.logic_gate_id)) continue;
    byID.set(item.logic_gate_id, item);
  }
  return Array.from(byID.values());
}

function focusContentEditableAtEnd(element: HTMLElement | null) {
  if (!element) return;
  element.focus({ preventScroll: true });
  const selection = element.ownerDocument.getSelection();
  if (!selection) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function scrollNodeWorkspaceInformationIntoView(root: HTMLElement | null, informationID: string) {
  const cleanInformationID = informationID.trim();
  if (!root || !cleanInformationID) return;
  const target = root.querySelector<HTMLElement>(`[data-node-text-block-id="${cleanInformationID}"], [data-node-chat-block-id="${cleanInformationID}"], [data-node-chat-message-id="${cleanInformationID}"]`);
  target?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
}

export const NodeWorkspaceSurface: React.FC<NodeWorkspaceSurfaceProps> = ({
  companyID,
  nodeID,
  canEdit,
  nodePriorityDraft,
  assignedLogicGateIDs,
  apiBase,
  projections,
  unseenChanges,
  companyUsers,
  projectionsLoaded,
  focusInformationID,
  focusRequestID,
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
  onMarkChangeSeen,
  onMarkAllChangesSeen,
  onCreateNodeFromImage,
  onAssignToLogicGate,
  onRequireNodePriorityForLogicGateAssignment,
  onError,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const saveTimersRef = useRef(new Map<string, number>());
  const logicGateAssignStatusTimerRef = useRef<number | null>(null);
  const contentByBlockRef = useRef(new Map<string, EditorTextBlockContent>());
  const focusBlockIDRef = useRef("");
  const handledFocusRequestRef = useRef("");
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
  const [logicGateFolders, setLogicGateFolders] = useState<CompanyExplorerFolder[]>([]);
  const [logicGateFolderItems, setLogicGateFolderItems] = useState<CompanyExplorerFolderItem[]>([]);
  const [logicGateOptionsLoading, setLogicGateOptionsLoading] = useState(false);
  const [logicGateSearchResults, setLogicGateSearchResults] = useState<LogicGateRecord[]>([]);
  const [assignedLogicGateRecords, setAssignedLogicGateRecords] = useState<LogicGateRecord[]>([]);
  const [logicGateSearchLoading, setLogicGateSearchLoading] = useState(false);
  const [assigningLogicGateID, setAssigningLogicGateID] = useState("");
  const [lastAssignedLogicGateID, setLastAssignedLogicGateID] = useState("");
  const [lastAssignedLogicGateLabel, setLastAssignedLogicGateLabel] = useState("");
  const [logicGateAssignStatus, setLogicGateAssignStatus] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [author, setAuthor] = useState({ userID: "", name: "You" });
  const [deleteTextBlockConfirmation, setDeleteTextBlockConfirmation] = useState<{ blockID: string; title: string; chatCount: number } | null>(null);
  const [textChatSplitRatio, setTextChatSplitRatio] = useState(() => readStoredTextChatSplitRatio(companyID, nodeID));
  const textChatSplitRatioRef = useRef(textChatSplitRatio);
  const autoCreatedTextBlockNodeIDsRef = useRef(new Set<string>());

  const projectionIdentity = useMemo(() => projectionsKey(projections), [projections]);
  const loadedTextBlockProjections = useMemo(() => listEditorTextBlockProjections(projections), [projectionIdentity, projections]);
  const chatMessagesByBlock = useMemo(() => {
    const grouped = new Map<string, EditorTextBlockChatMessage[]>();
    for (const message of chatMessages) {
      const blockMessages = grouped.get(message.blockID) ?? [];
      blockMessages.push(message);
      grouped.set(message.blockID, blockMessages);
    }
    return grouped;
  }, [chatMessages]);
  const compact = width > 0 && width < 720;
  const hasVisibleTextChat = !compact && blocks.some((block) => {
    const messages = chatMessagesByBlock.get(block.id) ?? [];
    return activeChatBlockID === block.id || (messages.length > 0 && !closedChatBlockIDs.has(block.id));
  });
  const textChatResizableWidth = Math.max(
    TEXT_CHAT_PANE_MIN_WIDTH_PX,
    width
      - TEXT_CHAT_HORIZONTAL_PADDING_PX
      - TEXT_TIMELINE_COLUMN_WIDTH_PX
      - TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX
      - (TEXT_CHAT_GRID_COLUMN_GAP_PX * 3),
  );
  const textChatPaneWidth = Math.max(
    TEXT_CHAT_PANE_MIN_WIDTH_PX,
    Math.min(TEXT_CHAT_PANE_MAX_WIDTH_PX, Math.round(textChatResizableWidth * (1 - textChatSplitRatio))),
  );
  const editorGridTemplateColumns = compact
    ? `${TEXT_TIMELINE_COMPACT_COLUMN_WIDTH_PX}px minmax(0, 1fr)`
    : hasVisibleTextChat
      ? `${TEXT_TIMELINE_COLUMN_WIDTH_PX}px minmax(0, 1fr) ${TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX}px ${textChatPaneWidth}px`
      : `${TEXT_TIMELINE_COLUMN_WIDTH_PX}px minmax(0, 1fr)`;
  const myLogicGates = useMemo(
    () => sortLogicGateOptions(logicGateOptions),
    [logicGateOptions],
  );
  const searchedLogicGates = useMemo(() => sortLogicGateOptions(logicGateSearchResults), [logicGateSearchResults]);
  const myLogicGateGroups = useMemo(() => buildLogicGateOptionGroups({
    logicGates: myLogicGates,
    folders: logicGateFolders,
    folderItems: logicGateFolderItems,
  }), [logicGateFolderItems, logicGateFolders, myLogicGates]);
  const searchedLogicGateGroups = useMemo(() => buildLogicGateOptionGroups({
    logicGates: searchedLogicGates,
    folders: logicGateFolders,
    folderItems: logicGateFolderItems,
  }), [logicGateFolderItems, logicGateFolders, searchedLogicGates]);
  const logicGateLabelByID = useMemo(() => {
    const labels = new Map<string, string>();
    for (const logicGate of uniqueLogicGateOptions([...logicGateOptions, ...logicGateSearchResults, ...assignedLogicGateRecords])) {
      labels.set(logicGate.logic_gate_id, logicGateOptionLabel(logicGate));
    }
    return labels;
  }, [assignedLogicGateRecords, logicGateOptions, logicGateSearchResults]);
  const assignedLogicGateIDSet = useMemo(() => new Set(assignedLogicGateIDs.map((id) => id.trim()).filter(Boolean)), [assignedLogicGateIDs]);
  const hasAssignedLogicGate = assignedLogicGateIDSet.size > 0 || Boolean(lastAssignedLogicGateID.trim());
  const assignedLogicGateLabel = useMemo(() => {
    if (lastAssignedLogicGateLabel.trim()) return lastAssignedLogicGateLabel.trim();
    for (const logicGateID of assignedLogicGateIDs) {
      const cleanLogicGateID = logicGateID.trim();
      if (!cleanLogicGateID) continue;
      return logicGateLabelByID.get(cleanLogicGateID) ?? humanLabelOrFallback(cleanLogicGateID, "Logic Gate");
    }
    return "None";
  }, [assignedLogicGateIDs, lastAssignedLogicGateLabel, logicGateLabelByID]);
  const primaryAssignedLogicGateID = useMemo(() => {
    const recentID = lastAssignedLogicGateID.trim();
    if (recentID) return recentID;
    for (const logicGateID of assignedLogicGateIDs) {
      const cleanLogicGateID = logicGateID.trim();
      if (cleanLogicGateID) return cleanLogicGateID;
    }
    return "";
  }, [assignedLogicGateIDs, lastAssignedLogicGateID]);
  const assignLogicGateButtonLabel = hasAssignedLogicGate
    ? `Assigned to Logic Gate: ${assignedLogicGateLabel}`
    : "Assign to Logic Gate";
  const nodePriorityUnassignedForLogicGate = useMemo(() => {
    const raw = nodePriorityDraft.trim();
    if (!raw || raw === "0") return true;
    const parsed = Number(raw);
    return !Number.isInteger(parsed) || parsed < 1 || parsed > 5;
  }, [nodePriorityDraft]);
  const unseenChangesByBlockID = useMemo(() => {
    const items = new Map<string, NodeContentChange[]>();
    for (const change of unseenChanges) {
      if (change.node_id !== nodeID || !change.information_id) continue;
      const bucket = items.get(change.information_id) ?? [];
      bucket.push(change);
      items.set(change.information_id, bucket);
    }
    for (const bucket of items.values()) {
      bucket.sort((a, b) => a.created_timestamp.localeCompare(b.created_timestamp) || a.change_id.localeCompare(b.change_id));
    }
    return items;
  }, [nodeID, unseenChanges]);

  const goToAssignedLogicGate = useCallback(() => {
    const logicGateID = primaryAssignedLogicGateID.trim();
    if (!logicGateID) return;
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
      companyID,
      sourceFrameID: "editor",
      kind: "logic_gate",
      id: logicGateID,
      label: assignedLogicGateLabel,
      nodeID,
      selectedTreeID: `logic-gate-${logicGateID}`,
      changedAt: Date.now(),
    });
  }, [assignedLogicGateLabel, companyID, nodeID, primaryAssignedLogicGateID]);

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
    setLogicGateAssignerOpen(false);
    setLogicGateSearch("");
    setAssigningLogicGateID("");
    setLastAssignedLogicGateID("");
    setLastAssignedLogicGateLabel("");
    setLogicGateAssignStatus("");
  }, [nodeID]);

  useEffect(() => {
    if (canEdit) return;
    setLogicGateAssignerOpen(false);
    setEmailPickerOpen(false);
    setDropActive(false);
    setDeleteTextBlockConfirmation(null);
  }, [canEdit]);

  useEffect(() => {
    const nextRatio = readStoredTextChatSplitRatio(companyID, nodeID);
    textChatSplitRatioRef.current = nextRatio;
    setTextChatSplitRatio(nextRatio);
  }, [companyID, nodeID]);

  useEffect(() => {
    textChatSplitRatioRef.current = textChatSplitRatio;
  }, [textChatSplitRatio]);

  useEffect(() => {
    const textBlocks = loadedTextBlockProjections.map((item) => {
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
  }, [loadedTextBlockProjections, nodeID, projectionIdentity, projections]);

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
    const ids = Array.from(new Set(assignedLogicGateIDs.map((id) => id.trim()).filter(Boolean)));
    if (!companyID || ids.length === 0) {
      setAssignedLogicGateRecords([]);
      return;
    }
    let cancelled = false;
    void Promise.all(ids.map(async (logicGateID) => {
      try {
        const details = await getLogicGateRecordSingleFlight(apiBase, companyID, logicGateID);
        return details.logic_gate;
      } catch {
        return null;
      }
    })).then((records) => {
      if (!cancelled) setAssignedLogicGateRecords(records.filter((record): record is LogicGateRecord => Boolean(record)));
    });
    return () => { cancelled = true; };
  }, [apiBase, assignedLogicGateIDs, companyID]);
  useEffect(() => {
    if (!logicGateAssignerOpen || !companyID) return;
    let cancelled = false;
    setLogicGateOptionsLoading(true);
    const params = new URLSearchParams({ company_id: companyID, assigned_to_me: "1" });
    const folderParams = new URLSearchParams({ company_id: companyID, folder_kind: "logic_gate" });
    const folderItemParams = new URLSearchParams({ company_id: companyID, item_type: "logic_gate" });
    void Promise.all([
      requestJSON<{ logic_gates?: LogicGateRecord[] }>(`/v1/logic-gates?${params.toString()}`),
      requestJSON<{ folders?: CompanyExplorerFolder[] }>(`/v1/company-explorer/folders?${folderParams.toString()}`),
      requestJSON<{ folder_items?: CompanyExplorerFolderItem[] }>(`/v1/company-explorer/folder-items?${folderItemParams.toString()}`),
    ])
      .then(([logicGatePayload, folderPayload, folderItemPayload]) => {
        if (!cancelled) {
          setLogicGateOptions(logicGatePayload.logic_gates ?? []);
          setLogicGateFolders(folderPayload.folders ?? []);
          setLogicGateFolderItems(folderItemPayload.folder_items ?? []);
        }
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
    if (logicGateAssignStatusTimerRef.current !== null) window.clearTimeout(logicGateAssignStatusTimerRef.current);
    for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer);
    saveTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!focusBlockIDRef.current) return;
    if (!canEdit) {
      focusBlockIDRef.current = "";
      return;
    }
    const blockID = focusBlockIDRef.current;
    focusBlockIDRef.current = "";
    window.requestAnimationFrame(() => {
      const editor = rootRef.current?.querySelector<HTMLElement>(`[data-node-text-block-id="${blockID}"]`);
      focusContentEditableAtEnd(editor ?? null);
    });
  }, [blocks.length, canEdit]);

  const persistTextBlock = useCallback(async (blockID: string, content: EditorTextBlockContent) => {
    if (!canEdit) return;
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
  }, [canEdit, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const flushTextBlockSave = useCallback((blockID: string) => {
    if (!canEdit) return;
    const timer = saveTimersRef.current.get(blockID);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      saveTimersRef.current.delete(blockID);
    }
    void persistTextBlock(blockID, contentByBlockRef.current.get(blockID) ?? { title: "", document: "" });
  }, [canEdit, persistTextBlock]);

  const scheduleTextBlockSave = useCallback((blockID: string, content: EditorTextBlockContent) => {
    if (!canEdit) return;
    contentByBlockRef.current.set(blockID, content);
    const existingTimer = saveTimersRef.current.get(blockID);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(blockID);
      void persistTextBlock(blockID, contentByBlockRef.current.get(blockID) ?? { title: "", document: "" });
    }, EDITOR_AUTOSAVE_DELAY_MS);
    saveTimersRef.current.set(blockID, timer);
  }, [canEdit, persistTextBlock]);

  const createTextBlock = useCallback(() => {
    if (!canEdit) return;
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
  }, [canEdit, persistTextBlock]);

  useEffect(() => {
    if (!canEdit || !projectionsLoaded || !nodeID || loadedTextBlockProjections.length > 0 || blocks.length > 0 || autoCreatedTextBlockNodeIDsRef.current.has(nodeID)) return;
    autoCreatedTextBlockNodeIDsRef.current.add(nodeID);
    createTextBlock();
  }, [blocks.length, canEdit, createTextBlock, loadedTextBlockProjections.length, nodeID, projectionsLoaded]);

  const updateTextBlockContent = useCallback((blockID: string, patch: Partial<EditorTextBlockContent>) => {
    if (!canEdit) return;
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
  }, [canEdit, scheduleTextBlockSave]);

  const deleteTextBlock = useCallback(async (blockID: string) => {
    if (!canEdit) return;
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
  }, [canEdit, chatMessages, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const requestDeleteTextBlock = useCallback((blockID: string) => {
    if (!canEdit) return;
    const chatCount = chatMessages.filter((message) => message.blockID === blockID).length;
    setDeleteTextBlockConfirmation({
      blockID,
      title: "text box",
      chatCount,
    });
  }, [canEdit, chatMessages]);

  const openSelectionChat = useCallback((selection: TextBlockSelectionDraft) => {
    if (!canEdit) return;
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
  }, [canEdit]);

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
    if (!canEdit) return;
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
  }, [author.name, author.userID, canEdit, chatDraftAttachments, chatDrafts, chatReplyTargets, chatSelectionAnchors, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const deleteChatMessage = useCallback(async (messageID: string) => {
    if (!canEdit) return;
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
  }, [author.userID, canEdit, chatMessages, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const addChatDraftAttachments = useCallback(async (blockID: string, files: FileList | File[]) => {
    if (!canEdit) return;
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
  }, [canEdit, chatDraftAttachments, onError]);

  const removeChatDraftAttachment = useCallback((blockID: string, attachmentID: string) => {
    if (!canEdit) return;
    setChatDraftAttachments((current) => {
      const nextAttachments = (current[blockID] ?? []).filter((attachment) => attachment.id !== attachmentID);
      if (nextAttachments.length === 0) {
        const next = { ...current };
        delete next[blockID];
        return next;
      }
      return { ...current, [blockID]: nextAttachments };
    });
  }, [canEdit]);

  const addImageChatComment = useCallback((image: TextBlockImageDraft) => {
    if (!canEdit) return;
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
  }, [canEdit]);

  const createNodeFromImage = useCallback(async (image: TextBlockImageDraft) => {
    if (!canEdit) return;
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
  }, [blocks, canEdit, onCreateNodeFromImage, onError]);

  const attachEmail = useCallback(async (email: ReturnType<typeof messageAttachmentPayload>) => {
    if (!canEdit) return;
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
  }, [attachedEmails, canEdit, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const assignToLogicGate = useCallback(async (logicGate: LogicGateRecord) => {
    if (!canEdit) return;
    const cleanLogicGateID = logicGate.logic_gate_id.trim();
    if (!cleanLogicGateID || assigningLogicGateID) return;
    if (logicGateAssignStatusTimerRef.current !== null) {
      window.clearTimeout(logicGateAssignStatusTimerRef.current);
      logicGateAssignStatusTimerRef.current = null;
    }
    if (nodePriorityUnassignedForLogicGate) {
      const message = "Must give node a priority";
      setLastAssignedLogicGateID("");
      setLastAssignedLogicGateLabel("");
      setLogicGateAssignStatus(message);
      onRequireNodePriorityForLogicGateAssignment();
      logicGateAssignStatusTimerRef.current = window.setTimeout(() => {
        setLogicGateAssignStatus((current) => (current === message ? "" : current));
        logicGateAssignStatusTimerRef.current = null;
      }, 1500);
      return;
    }
    const label = logicGateOptionLabel(logicGate);
    setAssigningLogicGateID(cleanLogicGateID);
    setLogicGateAssignStatus(`Assigning to Logic Gate: ${label}`);
    try {
      await onAssignToLogicGate(cleanLogicGateID);
      setLastAssignedLogicGateID(cleanLogicGateID);
      setLastAssignedLogicGateLabel(label);
      const message = `Assigned to Logic Gate: ${label}`;
      setLogicGateAssignStatus(message);
      logicGateAssignStatusTimerRef.current = window.setTimeout(() => {
        setLogicGateAssignStatus((current) => (current === message ? "" : current));
        logicGateAssignStatusTimerRef.current = null;
      }, 1500);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "failed_to_assign_logic_gate";
      setLastAssignedLogicGateID("");
      setLastAssignedLogicGateLabel("");
      setLogicGateAssignStatus(message);
      onError(message);
      logicGateAssignStatusTimerRef.current = window.setTimeout(() => {
        setLogicGateAssignStatus((current) => (current === message ? "" : current));
        logicGateAssignStatusTimerRef.current = null;
      }, 1500);
    } finally {
      setAssigningLogicGateID("");
    }
  }, [assigningLogicGateID, canEdit, nodePriorityUnassignedForLogicGate, onAssignToLogicGate, onError, onRequireNodePriorityForLogicGateAssignment]);

  const onDropEmail = useCallback((event: React.DragEvent) => {
    if (!canEdit) return;
    const email = parseDraggedEmail(event.dataTransfer);
    if (!email) return;
    event.preventDefault();
    setDropActive(false);
    void attachEmail({ ...email, attachedTimestamp: new Date().toISOString() });
  }, [attachEmail, canEdit]);

  const startTextChatSplitResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!canEdit) return;
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
  }, [canEdit, companyID, nodeID]);

  useEffect(() => {
    const cleanInformationID = focusInformationID?.trim() ?? "";
    if (!cleanInformationID || !projectionsLoaded) return;
    const requestKey = `${nodeID}:${cleanInformationID}:${focusRequestID ?? 0}`;
    if (handledFocusRequestRef.current === requestKey) return;

    const block = blocks.find((item) => item.id === cleanInformationID);
    if (block) {
      handledFocusRequestRef.current = requestKey;
      setFocusedTextBlockID(block.id);
      setActiveChatBlockID("");
      window.requestAnimationFrame(() => {
        const editor = rootRef.current?.querySelector<HTMLElement>(`[data-node-text-block-id="${block.id}"]`) ?? null;
        scrollNodeWorkspaceInformationIntoView(rootRef.current, block.id);
        if (canEdit) focusContentEditableAtEnd(editor);
      });
      return;
    }

    const message = chatMessages.find((item) => item.id === cleanInformationID);
    if (!message) return;
    const messages = chatMessagesByBlock.get(message.blockID) ?? [];
    handledFocusRequestRef.current = requestKey;
    navigateToChatMessage(message.blockID, messages, message.id);
    window.requestAnimationFrame(() => {
      scrollNodeWorkspaceInformationIntoView(rootRef.current, message.blockID);
      scrollNodeWorkspaceInformationIntoView(rootRef.current, message.id);
    });
  }, [blocks, canEdit, chatMessages, chatMessagesByBlock, focusInformationID, focusRequestID, navigateToChatMessage, nodeID, projectionsLoaded]);

  const renderTextChatSplitHandle = (enabled: boolean) => {
    if (compact) return null;
    if (!canEdit) return <div aria-hidden="true" />;
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

  const renderLogicGateTile = (logicGate: LogicGateRecord, keyPrefix: string) => {
    const logicGateID = logicGate.logic_gate_id;
    const selected = assignedLogicGateIDSet.has(logicGateID) || lastAssignedLogicGateID === logicGateID;
    const busy = assigningLogicGateID === logicGateID;
    return (
      <button
        key={`${keyPrefix}-${logicGateID}`}
        type="button"
        disabled={Boolean(assigningLogicGateID)}
        onClick={() => { void assignToLogicGate(logicGate); }}
        title={logicGateOptionLabel(logicGate)}
        style={{
          position: "relative",
          minHeight: 82,
          display: "grid",
          alignContent: "center",
          justifyItems: "center",
          gap: 7,
          border: selected || busy ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
          borderRadius: 12,
          background: selected || busy ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
          color: surfaceText,
          cursor: assigningLogicGateID ? "default" : "pointer",
          font: "inherit",
          padding: "10px 8px",
          minWidth: 0,
          boxShadow: selected ? "0 8px 20px rgba(15,23,42,0.10), 0 0 12px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.86)" : EDITOR_NEU_SHADOW,
        }}
      >
        <span aria-hidden="true" style={{ width: 28, height: 28, display: "grid", placeItems: "center", transform: "scale(1.3)" }}>
          <ExplorerRowIcon kind="logic_gate" />
        </span>
        <span style={{ maxWidth: "100%", minWidth: 0, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflowWrap: "anywhere", textAlign: "center", fontSize: 11, fontWeight: 800, lineHeight: 1.2 }}>
          {logicGateOptionLabel(logicGate)}
        </span>
      </button>
    );
  };

  const renderLogicGateGroups = (groups: LogicGateOptionGroup[], keyPrefix: string) => (
    <div style={{ display: "grid", alignContent: "start", gap: 10 }}>
      {groups.map((group) => (
        <div key={`${keyPrefix}-group-${group.key}`} style={{ display: "grid", gap: 7, minWidth: 0 }}>
          <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 6, color: surfaceText, opacity: 0.76, fontSize: 11, fontWeight: 800 }}>
            <ExplorerRowIcon kind="folder" />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.label}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", gap: 8 }}>
            {group.logicGates.map((logicGate) => renderLogicGateTile(logicGate, keyPrefix))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className="editor-document-scroll mango-editor-hover-highlight"
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
      <div style={{ display: "grid", gridTemplateColumns: editorGridTemplateColumns, columnGap: TEXT_CHAT_GRID_COLUMN_GAP_PX, rowGap: 12, alignItems: "start", minWidth: 0 }}>
        <div aria-hidden="true" style={{ minHeight: 32, padding: "2px 0 10px", background: "inherit" }} />

        <div style={{ gridColumn: hasVisibleTextChat ? "2 / -1" : undefined, display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap", overflow: "hidden", padding: "2px 0 10px", borderBottom: hasVisibleTextChat ? `1px solid ${ruleColor}` : undefined, background: "inherit" }}>
          {canEdit && (
            <button
              type="button"
              title="Add text box"
              onClick={createTextBlock}
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                border: "1px solid transparent",
                background: `${EDITOR_NEU_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
                color: accent,
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                flex: "0 0 auto",
                boxShadow: EDITOR_NEU_SHADOW,
              }}
            >
              <PlusIcon color={accent} />
            </button>
          )}
          {unseenChanges.length > 0 && (
            <button
              type="button"
              onClick={onMarkAllChangesSeen}
              style={{
                minHeight: 30,
                borderRadius: 9,
                border: "1px solid rgba(16,185,129,0.34)",
                background: "linear-gradient(135deg, rgba(236,253,245,0.94), rgba(207,250,254,0.64))",
                color: "#047857",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 10px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: 0,
                whiteSpace: "nowrap",
                flex: "0 0 auto",
                boxShadow: EDITOR_NEU_SHADOW,
              }}
            >
              Seen all
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setEmailPickerOpen(true)}
              style={{
                minHeight: 30,
                borderRadius: 9,
                border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                background: EDITOR_NEU_SURFACE,
                color: surfaceText,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "0 10px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 0,
                whiteSpace: "nowrap",
                flex: "0 0 auto",
                boxShadow: EDITOR_NEU_SHADOW,
              }}
            >
              <MailIcon color={accent} />
              Attach email
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              title={assignLogicGateButtonLabel}
              onClick={() => {
                setLogicGateAssignerOpen((open) => !open);
                setLogicGateAssignStatus("");
              }}
              style={{
                minHeight: 30,
                minWidth: 0,
                maxWidth: compact ? "100%" : 360,
                borderRadius: 9,
                border: logicGateAssignerOpen ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                background: logicGateAssignerOpen ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
                color: surfaceText,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "0 10px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 0,
                whiteSpace: "nowrap",
                flex: "1 1 132px",
                boxShadow: EDITOR_NEU_SHADOW,
              }}
            >
              <ExplorerRowIcon kind="logic_gate" />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assignLogicGateButtonLabel}</span>
            </button>
          )}
          {hasAssignedLogicGate && primaryAssignedLogicGateID && (
            <button
              type="button"
              title={`Go to ${assignedLogicGateLabel}`}
              onClick={goToAssignedLogicGate}
              style={{
                minHeight: 30,
                borderRadius: 9,
                border: "1px solid transparent",
                background: `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
                color: accent,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                padding: "0 10px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: 0,
                whiteSpace: "nowrap",
                flex: "0 0 auto",
                boxShadow: EDITOR_NEU_SHADOW,
              }}
            >
              Go to Logic Gate
            </button>
          )}
        </div>

        {canEdit && logicGateAssignerOpen && (
          <>
            <div aria-hidden="true" />
            <div style={{ minWidth: 0, display: "grid", gap: 10, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 14, background: panelBackground, padding: 10, boxShadow: EDITOR_NEU_PANEL_SHADOW }}>
              <div style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7, color: surfaceText }}>
                  <ExplorerRowIcon kind="logic_gate" />
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 900 }}>{hasAssignedLogicGate ? `Assigned to Logic Gate: ${assignedLogicGateLabel}` : "Assign to Logic Gate"}</span>
                </div>
                {logicGateOptionsLoading && <span style={{ flex: "0 0 auto", fontSize: 11, color: surfaceText, opacity: 0.64, fontWeight: 800 }}>Loading</span>}
              </div>
              {nodePriorityUnassignedForLogicGate && (
                <div style={{ justifySelf: "start", maxWidth: "100%", display: "inline-flex", alignItems: "center", border: "1px solid rgba(245, 158, 11, 0.34)", borderRadius: 10, background: "linear-gradient(135deg, rgba(255,251,235,0.96), rgba(254,243,199,0.72))", color: "#92400e", padding: "7px 9px", fontSize: 11, fontWeight: 800, lineHeight: 1.3, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.82)" }}>
                  In order to assign to a Logic Gate, give this node a priority.
                </div>
              )}

              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: surfaceText }}>My Logic Gates</div>
                <div style={{ maxHeight: 222, overflowY: "auto", paddingRight: 2 }}>
                  {logicGateOptionsLoading && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64 }}>Loading...</div>}
                  {!logicGateOptionsLoading && myLogicGateGroups.length === 0 && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64 }}>No assigned logic gates</div>}
                  {!logicGateOptionsLoading && myLogicGateGroups.length > 0 && renderLogicGateGroups(myLogicGateGroups, "mine")}
                </div>
              </div>

              <div style={{ position: "relative", minWidth: 0 }}>
                <input
                  value={logicGateSearch}
                  onChange={(event) => setLogicGateSearch(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setLogicGateSearch("");
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="Search logic gates"
                  aria-label="Search logic gates"
                  style={{ width: "100%", minHeight: 32, border: logicGateSearch.trim() ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, outline: "none", background: logicGateSearch.trim() ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_ACTIVE_SURFACE, color: surfaceText, padding: "0 31px 0 10px", boxSizing: "border-box", fontSize: 12, fontWeight: 700, letterSpacing: 0, boxShadow: "inset 2px 2px 6px rgba(174,174,192,0.16), inset -2px -2px 6px rgba(255,255,255,0.82)" }}
                />
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ position: "absolute", right: 10, top: 9, color: accent, pointerEvents: "none" }}>
                  <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              {logicGateSearch.trim() && (
                <div role="listbox" aria-label="Logic gate search results" style={{ display: "grid", gap: 8, maxHeight: 220, overflowY: "auto", padding: 8, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 12, background: EDITOR_NEU_ACTIVE_SURFACE, boxShadow: EDITOR_NEU_PANEL_SHADOW }}>
                  {logicGateSearchLoading && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64 }}>Searching...</div>}
                  {!logicGateSearchLoading && searchedLogicGateGroups.length === 0 && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64 }}>No matches</div>}
                  {!logicGateSearchLoading && searchedLogicGateGroups.length > 0 && renderLogicGateGroups(searchedLogicGateGroups, "search")}
                </div>
              )}
              {logicGateAssignStatus && <div style={{ justifySelf: "start", maxWidth: "100%", border: `1px solid ${logicGateAssignStatus.startsWith("Assigning") ? "rgba(59,130,246,0.24)" : logicGateAssignStatus.startsWith("Assigned") ? "rgba(100,116,139,0.22)" : "rgba(245,158,11,0.30)"}`, borderRadius: 9, background: logicGateAssignStatus.startsWith("Assigning") ? "rgba(239,246,255,0.82)" : logicGateAssignStatus.startsWith("Assigned") ? "rgba(248,250,252,0.9)" : "rgba(255,251,235,0.9)", color: logicGateAssignStatus.startsWith("Assigning") ? accent : logicGateAssignStatus.startsWith("Assigned") ? surfaceText : "#92400e", padding: "5px 8px", fontSize: 11, fontWeight: 800, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{logicGateAssignStatus}</div>}
            </div>
            {hasVisibleTextChat && <div aria-hidden="true" />}
            {hasVisibleTextChat && <div aria-hidden="true" />}
          </>
        )}

        {blocks.length === 0 && (
          <>
            <TimelineCell accent={accent} muted isLast />
            <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, minHeight: 92, display: "grid", placeItems: "center", color: surfaceText, opacity: 0.7, fontSize: 13, fontWeight: 700 }}>
              No text boxes
            </div>
            {hasVisibleTextChat && <div />}
            {hasVisibleTextChat && <div />}
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
                <div style={{ border: textBlockIsFocused ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 14, background: `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${textBlockIsFocused ? EDITOR_NEU_EDGE_FRAME : "linear-gradient(135deg, rgba(255,255,255,0.76), rgba(255,255,255,0.76))"} border-box`, overflow: "hidden", boxShadow: textBlockIsFocused ? "8px 8px 20px rgba(174,174,192,0.26), -7px -7px 16px rgba(255,255,255,0.92), 0 0 18px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.88)" : EDITOR_NEU_SHADOW }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 26px 26px", alignItems: "center", gap: 8, minHeight: 32, borderBottom: `1px solid ${ruleColor}`, padding: "6px 6px 6px 8px", background: "linear-gradient(90deg, rgba(255,241,242,0.62), rgba(236,253,245,0.42) 52%, rgba(239,246,255,0.66))" }}>
                    <div style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 7, paddingRight: 6, color: surfaceText, opacity: 0.58, fontSize: 10, fontWeight: 800, letterSpacing: 0, whiteSpace: compact ? "normal" : "nowrap", overflow: "hidden" }}>
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
                        style={{ width: 26, height: 24, borderRadius: 8, border: chatIsActive ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: chatIsActive ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", boxShadow: "2px 2px 7px rgba(174,174,192,0.16), -2px -2px 7px rgba(255,255,255,0.78)" }}
                      >
                        <ChatIcon color={accent} />
                      </button>
                    ) : (
                      <div aria-hidden="true" style={{ width: 26, height: 24 }} />
                    )}
                    {canEdit ? (
                      <TextBlockActionsMenu
                        accent={accent}
                        surfaceText={surfaceText}
                        panelBackground={panelBackground}
                        strokeColor={strokeColor}
                        onDelete={() => requestDeleteTextBlock(block.id)}
                      />
                    ) : (
                      <div aria-hidden="true" style={{ width: 26, height: 24 }} />
                    )}
                  </div>
                  <NodeTextBlockEditor
                    blockID={block.id}
                    editable={canEdit}
                    nodeID={nodeID}
                    companyID={companyID}
                    currentUserID={author.userID || "local-user"}
                    companyUsers={companyUsers}
                    documentValue={block.document}
                    contentChanges={unseenChangesByBlockID.get(block.id) ?? []}
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
                    onChangeSeen={onMarkChangeSeen}
                    onSelectionChatRequest={openSelectionChat}
                    onImageChatRequest={addImageChatComment}
                    onImageNodeRequest={(image) => { void createNodeFromImage(image); }}
                  />
                </div>
                {compact && chatIsVisible && (
                  <ChatPane
                    blockID={block.id}
                    editable={canEdit}
                    messages={messages}
                    selectionAnchor={selectionAnchor}
                    draft={chatDrafts[block.id] ?? ""}
                    companyUsers={companyUsers}
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
              {hasVisibleTextChat && renderTextChatSplitHandle(chatIsVisible)}
              {hasVisibleTextChat && (
                chatIsVisible ? (
                  <ChatPane
                    blockID={block.id}
                    editable={canEdit}
                    messages={messages}
                    selectionAnchor={selectionAnchor}
                    draft={chatDrafts[block.id] ?? ""}
                    companyUsers={companyUsers}
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
          {canEdit && (
            <div
              onDragEnter={() => setDropActive(true)}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(EMAIL_DRAG_MIME)) event.preventDefault();
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={onDropEmail}
              style={{
                minHeight: 58,
                border: dropActive ? "1px solid transparent" : `1px dashed ${EDITOR_NEU_SOFT_BORDER}`,
                borderRadius: 14,
                background: dropActive ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : panelBackground,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "10px 12px",
                color: surfaceText,
                fontSize: 12,
                fontWeight: 800,
                boxShadow: dropActive ? "0 10px 24px rgba(15,23,42,0.12), 0 0 16px rgba(183,124,255,0.18)" : EDITOR_NEU_SHADOW,
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <MailIcon color={accent} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Attach email</span>
              </span>
              <button
                type="button"
                onClick={() => setEmailPickerOpen(true)}
                style={{ border: "1px solid transparent", background: `${EDITOR_NEU_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`, color: accent, borderRadius: 9, padding: "5px 9px", fontSize: 11, fontWeight: 800, cursor: "pointer", flex: "0 0 auto", boxShadow: EDITOR_NEU_SHADOW }}
              >
                Add email
              </button>
            </div>
          )}
          <AttachedEmailsPanel emails={attachedEmails} accent={accent} surfaceText={surfaceText} panelBackground={panelBackground} strokeColor={strokeColor} onOpenEmail={setSelectedEmailID} />
        </div>
        {hasVisibleTextChat && <div aria-hidden="true" />}
        {hasVisibleTextChat && <div />}
      </div>

      {canEdit && emailPickerOpen && (
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
      {canEdit && deleteTextBlockConfirmation && (
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

