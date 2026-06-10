import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCurrentUser } from "../../auth/cognitoAuth";
import { humanLabelOrFallback } from "../entityLabels.js";
import { getLogicGateRecordSingleFlight } from "../logic-gate-map/LogicGateRecordStore.js";
import type { LogicGateRecord } from "../logic-gate-map/shared";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED } from "../node-map/eventbus";
import { getNodeRelationshipGraphSnapshot, removeNodeRelationshipGraphNode, subscribeNodeRelationshipGraph } from "../node-map/NodeRelationshipGraph";
import { invalidateNodeRecordStoreCaches } from "../node-map/NodeRecordStore";
import {
  buildNodeRelationshipHierarchyRows,
  collectNodeStructureIDs,
  type NodeRelationshipHierarchyRow,
} from "../node-map/nodeRelationshipStructure";
import { createNodeFromSelectionTitle, type SelectionNodeRelationshipKind } from "../node-map/selectionNodeCreation";
import { getNodeTitle, type NodeRecord, type NodeRelationship } from "../node-map/shared";
import { listProjectRelationshipsForResource, type ProjectRelationshipProjection } from "../project-management/projectManagementApi";
import { publishLiveSelection } from "../selectionCoordinator";
import { ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
import { invalidateWorkspaceSnapshot } from "../workspace/workspaceSnapshotCache";
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
  AttachedEmailOrganizerPane,
  AttachmentCountDropdown,
  ChatPane,
  DeleteTextBlockConfirmationModal,
  EmailCountDropdown,
  EmailPickerModal,
  NodeTextBlockEditor,
  removeStoredEmailLocalHighlight,
  TextBlockActionsMenu,
  TimelineCell,
  type EmailHighlightRemovalRequest,
  type TextBlockAttachmentListItem,
} from "./NodeWorkspaceSurfaceParts";
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES,
  CHAT_PANE_DEFAULT_HEIGHT,
  DEFAULT_TEXT_BLOCK_TITLE,
  EMAIL_DRAG_MIME,
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_PANEL_SHADOW,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
  formatFileSize,
  ChatIcon,
  MailIcon,
  messageAttachmentPayload,
  PaperclipIcon,
  parseDraggedEmail,
  PlusIcon,
  projectionsKey,
  readChatAttachment,
  TableIcon,
  type NodeWorkspaceSurfaceProps,
  type TextBlockImageDraft,
  type TextBlockSelectionAnchor,
  type TextBlockSelectionDraft,
  type TextBlockState,
} from "./NodeWorkspaceSurfaceShared";

const TEXT_TIMELINE_COLUMN_WIDTH_PX = 52;
const TEXT_TIMELINE_COMPACT_COLUMN_WIDTH_PX = 48;
const TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX = 8;
const TEXT_CHAT_GRID_COLUMN_GAP_PX = 8;
const TEXT_CHAT_HORIZONTAL_PADDING_PX = 28;
const TEXT_BLOCK_RESIZE_MIN_WIDTH_PX = 160;
const TEXT_SIDE_PANE_DEFAULT_WIDTH_PX = 360;
const TEXT_SIDE_PANE_MIN_WIDTH_PX = 300;
const TEXT_SIDE_PANE_MAX_WIDTH_PX = 1400;
const TEXT_SIDE_PANE_WIDTH_STORAGE_KEY_PREFIX = "node-editor-side-pane-width-v1";
const TEXT_PANE_LAYOUT_STORAGE_KEY_PREFIX = "node-editor-pane-layout-v1";
const EMAIL_SELECTION_NODE_TITLE_MAX_LENGTH = 80;

function buildEmailSelectionNodeTitle(quote: string, fallback: string): string {
  const compactQuote = quote.replace(/\s+/g, " ").trim();
  const base = compactQuote || fallback.trim() || "Email selection";
  if (base.length <= EMAIL_SELECTION_NODE_TITLE_MAX_LENGTH) return base;
  return `${base.slice(0, EMAIL_SELECTION_NODE_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

function createEmailSelectionDocument(ownerDocument: Document, quote: string): string {
  const container = ownerDocument.createElement("div");
  const paragraph = ownerDocument.createElement("div");
  quote.split(/\r\n|\r|\n/).forEach((line, index) => {
    if (index > 0) paragraph.appendChild(ownerDocument.createElement("br"));
    paragraph.appendChild(ownerDocument.createTextNode(line));
  });
  container.appendChild(paragraph);
  return serializeEditorDocumentHTML(container);
}

type TextSidePaneKind = "email" | "chat";

type TextPaneLayoutSnapshot = {
  openEmailBlockIDs: string[];
  openChatBlockIDs: string[];
  closedChatBlockIDs: string[];
  selectedEmailIDsByBlock: Record<string, string>;
  activeChatBlockID?: string;
};

type EmailChatSelectionAnchor = Omit<EmailHighlightRemovalRequest, "requestID">;

function emailChatSelectionAnchorFromMessage(message: EditorTextBlockChatMessage): EmailChatSelectionAnchor | null {
  const messageID = message.selectionMessageID?.trim() ?? "";
  const quote = message.selectionQuote?.trim() ?? "";
  const startOffset = message.selectionStart;
  const endOffset = message.selectionEnd;
  if (message.selectionSource !== "email" || !messageID || !quote) return null;
  if (typeof startOffset !== "number" || typeof endOffset !== "number" || !Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset <= startOffset) return null;
  return {
    messageID,
    quote,
    startOffset,
    endOffset,
  };
}

function chatMessageHasEmailSelectionAnchor(message: EditorTextBlockChatMessage, anchor: EmailChatSelectionAnchor): boolean {
  const candidate = emailChatSelectionAnchorFromMessage(message);
  return Boolean(candidate
    && candidate.messageID === anchor.messageID
    && candidate.quote === anchor.quote
    && Math.round(candidate.startOffset) === Math.round(anchor.startOffset)
    && Math.round(candidate.endOffset) === Math.round(anchor.endOffset));
}

function formatTextBlockMetadataTimestamp(value: string | number | undefined): string {
  if (value === undefined || value === "") return "";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
  const day = new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "numeric" }).format(date);
  return `${time} ${day}`;
}

function clampTextSidePaneWidth(value: number, maxWidth = TEXT_SIDE_PANE_MAX_WIDTH_PX): number {
  if (!Number.isFinite(value)) return TEXT_SIDE_PANE_DEFAULT_WIDTH_PX;
  const safeMaxWidth = Math.max(TEXT_SIDE_PANE_MIN_WIDTH_PX, Math.min(TEXT_SIDE_PANE_MAX_WIDTH_PX, Math.round(maxWidth)));
  return Math.max(TEXT_SIDE_PANE_MIN_WIDTH_PX, Math.min(safeMaxWidth, Math.round(value)));
}

function fitTextSidePaneWidths(widths: number[], maxCombinedWidth: number): number[] {
  if (widths.length === 0) return [];
  const minTotalWidth = TEXT_SIDE_PANE_MIN_WIDTH_PX * widths.length;
  const safeMaxCombinedWidth = Math.max(minTotalWidth, Math.round(maxCombinedWidth));
  const maxSingleWidth = Math.max(TEXT_SIDE_PANE_MIN_WIDTH_PX, safeMaxCombinedWidth - (TEXT_SIDE_PANE_MIN_WIDTH_PX * (widths.length - 1)));
  const clamped = widths.map((width) => clampTextSidePaneWidth(width, maxSingleWidth));
  const totalWidth = clamped.reduce((sum, width) => sum + width, 0);
  if (totalWidth <= safeMaxCombinedWidth) return clamped;
  const requestedExtras = clamped.map((width) => Math.max(0, width - TEXT_SIDE_PANE_MIN_WIDTH_PX));
  const totalRequestedExtra = requestedExtras.reduce((sum, width) => sum + width, 0);
  const availableExtra = Math.max(0, safeMaxCombinedWidth - minTotalWidth);
  if (totalRequestedExtra <= 0) return clamped.map(() => TEXT_SIDE_PANE_MIN_WIDTH_PX);
  return requestedExtras.map((extra) => Math.round(TEXT_SIDE_PANE_MIN_WIDTH_PX + ((extra / totalRequestedExtra) * availableExtra)));
}

function textSidePaneWidthStorageKey(companyID: string, nodeID: string, blockID: string, pane: TextSidePaneKind): string {
  return `${TEXT_SIDE_PANE_WIDTH_STORAGE_KEY_PREFIX}:${companyID || "company"}:${nodeID || "node"}:${blockID}:${pane}`;
}

function readStoredTextSidePaneWidth(companyID: string, nodeID: string, blockID: string, pane: TextSidePaneKind, fallback: number): number {
  if (typeof localStorage === "undefined") return clampTextSidePaneWidth(fallback);
  const parsed = Number.parseFloat(localStorage.getItem(textSidePaneWidthStorageKey(companyID, nodeID, blockID, pane)) ?? "");
  return Number.isFinite(parsed) ? clampTextSidePaneWidth(parsed) : clampTextSidePaneWidth(fallback);
}

function storeTextSidePaneWidth(companyID: string, nodeID: string, blockID: string, pane: TextSidePaneKind, width: number) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(textSidePaneWidthStorageKey(companyID, nodeID, blockID, pane), String(clampTextSidePaneWidth(width)));
}

function textPaneLayoutStorageKey(companyID: string, nodeID: string): string {
  return `${TEXT_PANE_LAYOUT_STORAGE_KEY_PREFIX}:${companyID || "company"}:${nodeID || "node"}`;
}

function cleanIDList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)));
}

function cleanSelectedEmailMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const next: Record<string, string> = {};
  for (const [blockID, messageID] of Object.entries(value as Record<string, unknown>)) {
    const cleanBlockID = blockID.trim();
    const cleanMessageID = typeof messageID === "string" ? messageID.trim() : "";
    if (cleanBlockID && cleanMessageID) next[cleanBlockID] = cleanMessageID;
  }
  return next;
}

function readStoredTextPaneLayout(companyID: string, nodeID: string): TextPaneLayoutSnapshot {
  if (typeof localStorage === "undefined") {
    return { openEmailBlockIDs: [], openChatBlockIDs: [], closedChatBlockIDs: [], selectedEmailIDsByBlock: {} };
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(textPaneLayoutStorageKey(companyID, nodeID)) ?? "{}") as Record<string, unknown>;
    return {
      openEmailBlockIDs: cleanIDList(parsed.openEmailBlockIDs),
      openChatBlockIDs: cleanIDList(parsed.openChatBlockIDs),
      closedChatBlockIDs: cleanIDList(parsed.closedChatBlockIDs),
      selectedEmailIDsByBlock: cleanSelectedEmailMap(parsed.selectedEmailIDsByBlock),
      activeChatBlockID: typeof parsed.activeChatBlockID === "string" && parsed.activeChatBlockID.trim() ? parsed.activeChatBlockID.trim() : undefined,
    };
  } catch {
    return { openEmailBlockIDs: [], openChatBlockIDs: [], closedChatBlockIDs: [], selectedEmailIDsByBlock: {} };
  }
}

function storeTextPaneLayout(companyID: string, nodeID: string, snapshot: TextPaneLayoutSnapshot) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(textPaneLayoutStorageKey(companyID, nodeID), JSON.stringify({
    openEmailBlockIDs: cleanIDList(snapshot.openEmailBlockIDs),
    openChatBlockIDs: cleanIDList(snapshot.openChatBlockIDs),
    closedChatBlockIDs: cleanIDList(snapshot.closedChatBlockIDs),
    selectedEmailIDsByBlock: cleanSelectedEmailMap(snapshot.selectedEmailIDsByBlock),
    activeChatBlockID: snapshot.activeChatBlockID?.trim() || "",
  }));
}

function logicGateOptionLabel(logicGate: LogicGateRecord): string {
  return humanLabelOrFallback(logicGate.header, humanLabelOrFallback(logicGate.logic_gate_id, "Logic Gate"));
}

type RelationshipIconKind = "parent" | "peer" | "child" | "related";
type RelationshipCreateKind = SelectionNodeRelationshipKind;
type RelationshipRowContextMenu = { row: NodeRelationshipHierarchyRow; x: number; y: number };

const RELATIONSHIP_CREATE_OPTIONS: Array<{ kind: RelationshipCreateKind; label: string; title: string }> = [
  { kind: "parent", label: "Create Parent Node", title: "new parent node" },
  { kind: "peer", label: "Create Peer Node", title: "new peer node" },
  { kind: "child", label: "Create Child Node", title: "new child node" },
];

function relationshipRowIconKind(row: NodeRelationshipHierarchyRow): RelationshipIconKind {
  if (row.role === "Peer") return "peer";
  if (row.role === "Child") return "child";
  if (row.role === "Parent" || row.hasChildren || row.depth === 0) return "parent";
  return "related";
}

function relationshipRowRoleLabel(row: NodeRelationshipHierarchyRow, current: boolean): string {
  if (current) return "Current";
  const kind = relationshipRowIconKind(row);
  if (kind === "parent") return "Parent";
  if (kind === "peer") return "Peer";
  if (kind === "child") return "Child";
  return "";
}

function relationshipRowAccentColor(kind: RelationshipIconKind, accent: string): string {
  if (kind === "parent") return "#0891b2";
  if (kind === "peer") return "#7c3aed";
  if (kind === "child") return "#059669";
  return accent;
}

const RelationshipCheckIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="m3.4 8.15 2.8 2.75 6.35-6.65" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const RelationshipRoleIcon: React.FC<{ kind: RelationshipIconKind; color: string }> = ({ kind, color }) => {
  const boxFill = "rgba(255,255,255,0.9)";
  if (kind === "peer") {
    return (
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" style={{ display: "block" }}>
        <path d="M3.5 14h6.1M18.4 14h6.1" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <rect x="9.6" y="8.8" width="8.8" height="10.4" rx="2.4" fill={boxFill} stroke={color} strokeWidth="1.8" />
      </svg>
    );
  }
  if (kind === "child") {
    return (
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" style={{ display: "block" }}>
        <path d="M14 3.5v7.2" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <rect x="9.6" y="10.7" width="8.8" height="10.4" rx="2.4" fill={boxFill} stroke={color} strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" style={{ display: "block" }}>
      <rect x="9.6" y="6.7" width="8.8" height="10.4" rx="2.4" fill={boxFill} stroke={color} strokeWidth="1.8" />
      <path d="M14 17.1v7.4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};

function RelationshipMenuRow({
  row,
  current,
  hovered,
  accent,
  surfaceText,
  strokeColor,
  onOpen,
  onHover,
  onContextMenu,
}: {
  row: NodeRelationshipHierarchyRow;
  current: boolean;
  hovered: boolean;
  accent: string;
  surfaceText: string;
  strokeColor: string;
  onOpen: (row: NodeRelationshipHierarchyRow) => void;
  onHover: (nodeID: string) => void;
  onContextMenu: (row: NodeRelationshipHierarchyRow, event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const kind = relationshipRowIconKind(row);
  const color = current ? accent : relationshipRowAccentColor(kind, accent);
  const label = relationshipRowRoleLabel(row, current);
  const highlighted = current || hovered;
  return (
    <button
      type="button"
      role="treeitem"
      title={row.title}
      aria-current={current ? "true" : undefined}
      onClick={() => onOpen(row)}
      onMouseEnter={() => onHover(row.nodeID)}
      onMouseLeave={() => onHover("")}
      onContextMenu={(event) => onContextMenu(row, event)}
      style={{
        width: "100%",
        minWidth: 0,
        minHeight: 38,
        boxSizing: "border-box",
        display: "grid",
        gridTemplateColumns: "30px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 8,
        padding: `5px 8px 5px ${10 + row.depth * 18}px`,
        border: highlighted ? "1px solid transparent" : `1px solid ${strokeColor}`,
        borderRadius: 8,
        background: highlighted
          ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, linear-gradient(135deg, rgba(6,182,212,0.8), rgba(124,58,237,0.72), rgba(16,185,129,0.62)) border-box`
          : "rgba(255,255,255,0.7)",
        color: surfaceText,
        cursor: "pointer",
        font: "inherit",
        textAlign: "left",
        boxShadow: highlighted ? `${EDITOR_NEU_SHADOW}, inset 1px 1px 0 rgba(255,255,255,0.86)` : "inset 1px 1px 0 rgba(255,255,255,0.72)",
        transition: "background 140ms ease, border-color 140ms ease, box-shadow 160ms ease, transform 160ms ease",
        transform: hovered && !current ? "translateY(-1px)" : "translateY(0)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          background: `linear-gradient(135deg, rgba(255,255,255,0.95), ${color}22)`,
          boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86)",
        }}
      >
        <RelationshipRoleIcon kind={kind} color={color} />
      </span>
      <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: current ? 900 : 780 }}>
          {row.title}
        </span>
        {label && (
          <span style={{ color, fontSize: 9.5, fontWeight: 850, letterSpacing: 0 }}>
            {label}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 24,
          height: 24,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          border: current ? `1px solid ${color}` : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
          background: current ? "#ffffff" : "rgba(255,255,255,0.56)",
          opacity: current ? 1 : 0,
          boxShadow: current ? "0 6px 14px rgba(15,23,42,0.12)" : undefined,
        }}
      >
        {current && <RelationshipCheckIcon color={color} />}
      </span>
    </button>
  );
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
  scope,
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
  const initialPaneLayoutRef = useRef(readStoredTextPaneLayout(companyID, nodeID));
  const skipNextPaneLayoutPersistRef = useRef(false);
  const [width, setWidth] = useState(0);
  const [blocks, setBlocks] = useState<TextBlockState[]>([]);
  const [chatMessages, setChatMessages] = useState<EditorTextBlockChatMessage[]>([]);
  const [attachedEmails, setAttachedEmails] = useState<EditorAttachedEmail[]>([]);
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [chatDraftAttachments, setChatDraftAttachments] = useState<Record<string, EditorChatAttachment[]>>({});
  const [chatReplyTargets, setChatReplyTargets] = useState<Record<string, string>>({});
  const [chatSelectionAnchors, setChatSelectionAnchors] = useState<Record<string, TextBlockSelectionAnchor>>({});
  const [activeChatMessageIDs, setActiveChatMessageIDs] = useState<Record<string, string>>({});
  const [activeChatBlockID, setActiveChatBlockID] = useState(initialPaneLayoutRef.current.activeChatBlockID ?? "");
  const [selectedEmailIDsByBlock, setSelectedEmailIDsByBlock] = useState<Record<string, string>>(() => initialPaneLayoutRef.current.selectedEmailIDsByBlock);
  const [openEmailBlockIDs, setOpenEmailBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.openEmailBlockIDs));
  const [openChatBlockIDs, setOpenChatBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.openChatBlockIDs));
  const [sidePaneWidths, setSidePaneWidths] = useState<Record<string, Partial<Record<TextSidePaneKind, number>>>>({});
  const [chatNavigationRequest, setChatNavigationRequest] = useState<{ blockID: string; anchorMessageID: string; requestID: number } | null>(null);
  const [emailHighlightRemovalRequest, setEmailHighlightRemovalRequest] = useState<EmailHighlightRemovalRequest | null>(null);
  const [closedChatBlockIDs, setClosedChatBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.closedChatBlockIDs));
  const [focusedTextBlockID, setFocusedTextBlockID] = useState("");
  const [tableInsertRequests, setTableInsertRequests] = useState<Record<string, number>>({});
  const [emailPickerTargetBlockID, setEmailPickerTargetBlockID] = useState<string | null>(null);
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
  const [relationshipMenuOpen, setRelationshipMenuOpen] = useState(false);
  const [relationshipHoveredNodeID, setRelationshipHoveredNodeID] = useState("");
  const [relationshipCreateMenuOpen, setRelationshipCreateMenuOpen] = useState(false);
  const [relationshipCreatingKind, setRelationshipCreatingKind] = useState<RelationshipCreateKind | "">("");
  const [relationshipRowContextMenu, setRelationshipRowContextMenu] = useState<RelationshipRowContextMenu | null>(null);
  const [relationshipDeletingNodeID, setRelationshipDeletingNodeID] = useState("");
  const [projectRelationshipRows, setProjectRelationshipRows] = useState<ProjectRelationshipProjection[]>([]);
  const [projectRelationshipsLoading, setProjectRelationshipsLoading] = useState(false);
  const [relationshipGraph, setRelationshipGraph] = useState<{ nodes: NodeRecord[]; relationships: NodeRelationship[] }>(() => {
    const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
    return { nodes: snapshot.nodes ?? [], relationships: snapshot.relationships ?? [] };
  });
  const [dropActive, setDropActive] = useState(false);
  const [author, setAuthor] = useState({ userID: "", name: "You" });
  const [deleteTextBlockConfirmation, setDeleteTextBlockConfirmation] = useState<{ blockID: string; title: string; chatCount: number } | null>(null);
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
  const nodeAttachedEmails = useMemo(() => {
    const byMessageID = new Map<string, EditorAttachedEmail>();
    for (const email of attachedEmails) {
      const messageID = email.messageID.trim();
      if (!messageID || byMessageID.has(messageID)) continue;
      byMessageID.set(messageID, email);
    }
    return Array.from(byMessageID.values());
  }, [attachedEmails]);
  const nodeTextBlockAttachments = useMemo<TextBlockAttachmentListItem[]>(() => (
    blocks.flatMap((block) => (block.attachments ?? []).map((attachment) => ({
      blockID: block.id,
      blockTitle: block.title,
      attachment,
    })))
  ), [blocks]);
  const compact = width > 0 && width < 720;
  const textCommunicationContentWidth = Math.max(
    TEXT_BLOCK_RESIZE_MIN_WIDTH_PX + TEXT_SIDE_PANE_MIN_WIDTH_PX,
    width
      - TEXT_CHAT_HORIZONTAL_PADDING_PX
      - TEXT_TIMELINE_COLUMN_WIDTH_PX
      - TEXT_CHAT_GRID_COLUMN_GAP_PX,
  );
  const textSidePaneAvailableWidth = Math.max(
    TEXT_SIDE_PANE_MIN_WIDTH_PX,
    textCommunicationContentWidth
      - TEXT_BLOCK_RESIZE_MIN_WIDTH_PX
      - TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX
      - (TEXT_CHAT_GRID_COLUMN_GAP_PX * 2),
  );
  const textSidePaneDefaultWidth = clampTextSidePaneWidth(
    Math.min(TEXT_SIDE_PANE_DEFAULT_WIDTH_PX, Math.round(textSidePaneAvailableWidth * 0.36)),
    textSidePaneAvailableWidth,
  );
  const editorGridTemplateColumns = compact
    ? `${TEXT_TIMELINE_COMPACT_COLUMN_WIDTH_PX}px minmax(0, 1fr)`
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
  const relationshipNodeTitle = useMemo(() => {
    const node = relationshipGraph.nodes.find((item) => item.node_id === nodeID);
    return node ? getNodeTitle(node) : humanLabelOrFallback(nodeID, "This node");
  }, [nodeID, relationshipGraph.nodes]);
  const relationshipRows = useMemo(() => {
    const cleanNodeID = nodeID.trim();
    if (!cleanNodeID) return [];
    const structureIDs = Array.from(collectNodeStructureIDs(cleanNodeID, relationshipGraph.relationships));
    const requestedIDs = structureIDs.includes(cleanNodeID) ? structureIDs : [cleanNodeID, ...structureIDs];
    const fallbackNode: NodeRecord | null = relationshipGraph.nodes.some((item) => item.node_id === cleanNodeID)
      ? null
      : {
        company_id: companyID,
        node_id: cleanNodeID,
        title: relationshipNodeTitle,
        created_timestamp: "",
      };
    const nodes = fallbackNode ? [...relationshipGraph.nodes, fallbackNode] : relationshipGraph.nodes;
    return buildNodeRelationshipHierarchyRows({
      nodes,
      relationships: relationshipGraph.relationships,
      nodeIDs: requestedIDs,
    });
  }, [companyID, nodeID, relationshipGraph.nodes, relationshipGraph.relationships, relationshipNodeTitle]);
  const relationshipCount = Math.max(0, relationshipRows.length - (relationshipRows.some((row) => row.nodeID === nodeID) ? 1 : 0));
  const projectRelationshipCount = projectRelationshipRows.length;
  const relationshipRowCountLabel = `${relationshipRows.length} linked`;
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

  const goToRelationshipNode = useCallback((row: NodeRelationshipHierarchyRow) => {
    const cleanNodeID = row.nodeID.trim();
    if (!cleanNodeID) return;
    setRelationshipMenuOpen(false);
    setRelationshipHoveredNodeID("");
    setRelationshipCreateMenuOpen(false);
    setRelationshipRowContextMenu(null);
    publishLiveSelection({
      companyID,
      entityKind: "node",
      entityID: cleanNodeID,
      label: row.title || cleanNodeID,
      sourceFrameID: `${scope}:relationships-menu`,
      sourceModule: "editor",
      targetFrameIDs: [scope],
      selectionIntent: "navigate",
    });
  }, [companyID, scope]);

  const goToProjectRelationship = useCallback((row: ProjectRelationshipProjection) => {
    const projectID = row.project_id.trim();
    if (!projectID) return;
    setRelationshipMenuOpen(false);
    setRelationshipCreateMenuOpen(false);
    setRelationshipRowContextMenu(null);
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
      companyID,
      sourceFrameID: `${scope}:relationships-menu`,
      kind: "project",
      id: projectID,
      label: row.project_name?.trim() || projectID,
      selectedTreeID: `project-${projectID}`,
      changedAt: Date.now(),
    });
  }, [companyID, scope]);

  const openRelationshipRowContextMenu = useCallback((row: NodeRelationshipHierarchyRow, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canEdit) return;
    const width = 164;
    const height = 42;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : event.clientX + width;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : event.clientY + height;
    setRelationshipCreateMenuOpen(false);
    setRelationshipRowContextMenu({
      row,
      x: Math.max(8, Math.min(event.clientX, viewportWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, viewportHeight - height - 8)),
    });
  }, [canEdit]);

  const deleteRelationshipRowNode = useCallback(async (row: NodeRelationshipHierarchyRow) => {
    if (!canEdit) return;
    const cleanNodeID = row.nodeID.trim();
    if (!companyID || !cleanNodeID || relationshipDeletingNodeID) return;
    const fallbackRow = relationshipRows.find((item) => item.nodeID !== cleanNodeID);
    setRelationshipRowContextMenu(null);
    setRelationshipCreateMenuOpen(false);
    setRelationshipDeletingNodeID(cleanNodeID);
    try {
      await requestJSON<{ status: string }>(`/v1/nodes/${encodeURIComponent(cleanNodeID)}?company_id=${encodeURIComponent(companyID)}`, {
        method: "DELETE",
      });
      invalidateNodeRecordStoreCaches(apiBase, companyID, cleanNodeID);
      removeNodeRelationshipGraphNode(apiBase, companyID, cleanNodeID);
      invalidateWorkspaceSnapshot(apiBase, companyID);
      if (cleanNodeID === nodeID && fallbackRow) {
        setRelationshipMenuOpen(false);
        publishLiveSelection({
          companyID,
          entityKind: "node",
          entityID: fallbackRow.nodeID,
          label: fallbackRow.title || fallbackRow.nodeID,
          sourceFrameID: `${scope}:relationships-menu`,
          sourceModule: "editor",
          targetFrameIDs: [scope],
          selectionIntent: "navigate",
        });
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_delete_node");
    } finally {
      setRelationshipDeletingNodeID("");
    }
  }, [apiBase, canEdit, companyID, nodeID, onError, relationshipDeletingNodeID, relationshipRows, requestJSON, scope]);

  const createRelationshipNode = useCallback(async (kind: RelationshipCreateKind) => {
    if (!canEdit) return;
    const cleanNodeID = nodeID.trim();
    const option = RELATIONSHIP_CREATE_OPTIONS.find((item) => item.kind === kind);
    if (!companyID || !cleanNodeID || !option) return;
    setRelationshipCreateMenuOpen(false);
    setRelationshipCreatingKind(kind);
    try {
      await createNodeFromSelectionTitle({
        companyID,
        title: option.title,
        sourceNodeID: cleanNodeID,
        relationshipKind: kind,
        apiBase,
        requestJSON,
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_create_related_node");
    } finally {
      setRelationshipCreatingKind("");
    }
  }, [apiBase, canEdit, companyID, nodeID, onError, requestJSON]);

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
    const updateRelationshipGraph = () => {
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
      setRelationshipGraph({ nodes: snapshot.nodes ?? [], relationships: snapshot.relationships ?? [] });
    };
    updateRelationshipGraph();
    return subscribeNodeRelationshipGraph(apiBase, companyID, updateRelationshipGraph);
  }, [apiBase, companyID]);

  useEffect(() => {
    const cleanNodeID = nodeID.trim();
    if (!relationshipMenuOpen || !companyID || !cleanNodeID) {
      setProjectRelationshipsLoading(false);
      return;
    }
    let cancelled = false;
    setProjectRelationshipsLoading(true);
    void listProjectRelationshipsForResource({
      companyID,
      resourceType: "node",
      resourceID: cleanNodeID,
    })
      .then((payload) => {
        if (!cancelled) setProjectRelationshipRows(payload.relationships ?? []);
      })
      .catch(() => {
        if (!cancelled) setProjectRelationshipRows([]);
      })
      .finally(() => {
        if (!cancelled) setProjectRelationshipsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyID, nodeID, relationshipMenuOpen]);

  useEffect(() => {
    setLogicGateAssignerOpen(false);
    setRelationshipMenuOpen(false);
    setRelationshipHoveredNodeID("");
    setRelationshipCreateMenuOpen(false);
    setRelationshipCreatingKind("");
    setRelationshipRowContextMenu(null);
    setRelationshipDeletingNodeID("");
    setProjectRelationshipRows([]);
    setProjectRelationshipsLoading(false);
    setLogicGateSearch("");
    setAssigningLogicGateID("");
    setLastAssignedLogicGateID("");
    setLastAssignedLogicGateLabel("");
    setLogicGateAssignStatus("");
  }, [nodeID]);

  useEffect(() => {
    if (canEdit) return;
    setLogicGateAssignerOpen(false);
    setRelationshipMenuOpen(false);
    setRelationshipHoveredNodeID("");
    setRelationshipCreateMenuOpen(false);
    setRelationshipCreatingKind("");
    setRelationshipRowContextMenu(null);
    setRelationshipDeletingNodeID("");
    setEmailPickerTargetBlockID(null);
    setDropActive(false);
    setDeleteTextBlockConfirmation(null);
  }, [canEdit]);

  useEffect(() => {
    if (!relationshipRowContextMenu) return;
    const close = () => setRelationshipRowContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", close, true);
    };
  }, [relationshipRowContextMenu]);

  useEffect(() => {
    const layout = readStoredTextPaneLayout(companyID, nodeID);
    skipNextPaneLayoutPersistRef.current = true;
    setSelectedEmailIDsByBlock(layout.selectedEmailIDsByBlock);
    setOpenEmailBlockIDs(new Set(layout.openEmailBlockIDs));
    setOpenChatBlockIDs(new Set(layout.openChatBlockIDs));
    setClosedChatBlockIDs(new Set(layout.closedChatBlockIDs));
    setActiveChatBlockID(layout.activeChatBlockID ?? "");
  }, [companyID, nodeID]);

  useEffect(() => {
    if (skipNextPaneLayoutPersistRef.current) {
      skipNextPaneLayoutPersistRef.current = false;
      return;
    }
    storeTextPaneLayout(companyID, nodeID, {
      openEmailBlockIDs: Array.from(openEmailBlockIDs),
      openChatBlockIDs: Array.from(openChatBlockIDs),
      closedChatBlockIDs: Array.from(closedChatBlockIDs),
      selectedEmailIDsByBlock,
      activeChatBlockID,
    });
  }, [activeChatBlockID, closedChatBlockIDs, companyID, nodeID, openChatBlockIDs, openEmailBlockIDs, selectedEmailIDsByBlock]);

  useEffect(() => {
    const textBlocks = loadedTextBlockProjections.map((item) => {
      const content = parseEditorTextBlockContent(item.information);
      return {
        id: item.information_id,
        title: content.title,
        document: content.document,
        attachments: content.attachments ?? [],
        createdTimestamp: item.created_timestamp,
        updatedTimestamp: item.updated_timestamp,
        pending: false,
      };
    });
    const parsedChatMessages = parseEditorTextBlockChats(projections);
    setBlocks(textBlocks);
    contentByBlockRef.current = new Map(textBlocks.map((block) => [block.id, { title: block.title, document: block.document, attachments: block.attachments }]));
    setChatMessages(parsedChatMessages);
    const parsedAttachedEmails = parseEditorAttachedEmails(projections);
    setAttachedEmails(parsedAttachedEmails);
    const nodeChanged = previousNodeIDRef.current !== nodeID;
    previousNodeIDRef.current = nodeID;
    const blockIDs = new Set(textBlocks.map((block) => block.id));
    const emailIDsByBlock = new Map<string, Set<string>>();
    for (const email of parsedAttachedEmails) {
      const blockID = email.blockID?.trim() ?? "";
      if (!blockID) continue;
      const messageIDs = emailIDsByBlock.get(blockID) ?? new Set<string>();
      messageIDs.add(email.messageID);
      emailIDsByBlock.set(blockID, messageIDs);
    }
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
    setTableInsertRequests((current) => (nodeChanged ? {} : Object.fromEntries(Object.entries(current).filter(([id]) => blockIDs.has(id)))));
    setSidePaneWidths((current) => (nodeChanged ? {} : Object.fromEntries(Object.entries(current).filter(([id]) => blockIDs.has(id)))));
    setActiveChatMessageIDs((current) => {
      if (nodeChanged) return {};
      return Object.fromEntries(Object.entries(current).filter(([blockID, messageID]) => Boolean(messageIDsByBlock.get(blockID)?.has(messageID))));
    });
    if (projectionsLoaded) {
      setActiveChatBlockID((current) => (nodeChanged || !blockIDs.has(current) ? "" : current));
      setSelectedEmailIDsByBlock((current) => Object.fromEntries(Object.entries(current).filter(([blockID, messageID]) => Boolean(emailIDsByBlock.get(blockID)?.has(messageID)))));
      setOpenEmailBlockIDs((current) => new Set(Array.from(current).filter((id) => blockIDs.has(id))));
      setOpenChatBlockIDs((current) => new Set(Array.from(current).filter((id) => blockIDs.has(id))));
      setClosedChatBlockIDs((current) => new Set(Array.from(current).filter((id) => blockIDs.has(id))));
    }
    setFocusedTextBlockID((current) => (nodeChanged || !blockIDs.has(current) ? "" : current));
  }, [loadedTextBlockProjections, nodeID, projectionIdentity, projections, projectionsLoaded]);

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
    void persistTextBlock(blockID, contentByBlockRef.current.get(blockID) ?? { title: "", document: "", attachments: [] });
  }, [canEdit, persistTextBlock]);

  const scheduleTextBlockSave = useCallback((blockID: string, content: EditorTextBlockContent) => {
    if (!canEdit) return;
    contentByBlockRef.current.set(blockID, content);
    const existingTimer = saveTimersRef.current.get(blockID);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(blockID);
      void persistTextBlock(blockID, contentByBlockRef.current.get(blockID) ?? { title: "", document: "", attachments: [] });
    }, EDITOR_AUTOSAVE_DELAY_MS);
    saveTimersRef.current.set(blockID, timer);
  }, [canEdit, persistTextBlock]);

  const createTextBlock = useCallback(() => {
    if (!canEdit) return;
    const now = new Date().toISOString();
    const blockID = generateStableInformationID();
    const initialContent: EditorTextBlockContent = { title: DEFAULT_TEXT_BLOCK_TITLE, document: "", attachments: [] };
    focusBlockIDRef.current = blockID;
    contentByBlockRef.current.set(blockID, initialContent);
    setBlocks((current) => [
      {
        id: blockID,
        title: initialContent.title,
        document: "",
        attachments: [],
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
    const existing = contentByBlockRef.current.get(blockID) ?? { title: "", document: "", attachments: [] };
    const nextContent: EditorTextBlockContent = {
      title: patch.title ?? existing.title,
      document: patch.document ?? existing.document,
      attachments: patch.attachments ?? existing.attachments ?? [],
    };
    setBlocks((current) => current.map((block) => {
      if (block.id !== blockID) return block;
      return { ...block, ...nextContent, updatedTimestamp: new Date().toISOString() };
    }));
    scheduleTextBlockSave(blockID, nextContent);
  }, [canEdit, scheduleTextBlockSave]);

  const addTextBlockAttachments = useCallback(async (blockID: string, files: FileList | File[]) => {
    if (!canEdit) return;
    const incoming = Array.from(files);
    if (incoming.length === 0) return;
    const existing = contentByBlockRef.current.get(blockID) ?? { title: "", document: "", attachments: [] };
    const existingAttachments = existing.attachments ?? [];
    let nextTotalSize = existingAttachments.reduce((total, attachment) => total + attachment.size, 0);
    const accepted: File[] = [];
    for (const file of incoming) {
      if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
        onError(`Attachments are limited to ${formatFileSize(CHAT_ATTACHMENT_MAX_BYTES)} each.`);
        continue;
      }
      if (nextTotalSize + file.size > CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES) {
        onError(`Text box attachments are limited to ${formatFileSize(CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES)} total.`);
        continue;
      }
      accepted.push(file);
      nextTotalSize += file.size;
    }
    if (accepted.length === 0) return;
    try {
      const attachments = await Promise.all(accepted.map(readChatAttachment));
      updateTextBlockContent(blockID, { attachments: [...existingAttachments, ...attachments] });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_read_attachment");
    }
  }, [canEdit, onError, updateTextBlockContent]);

  const removeTextBlockAttachment = useCallback((blockID: string, attachmentID: string) => {
    if (!canEdit || !attachmentID.trim()) return;
    const existing = contentByBlockRef.current.get(blockID);
    if (!existing) return;
    const nextAttachments = (existing.attachments ?? []).filter((attachment) => attachment.id !== attachmentID);
    updateTextBlockContent(blockID, { attachments: nextAttachments });
  }, [canEdit, updateTextBlockContent]);

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
    setTableInsertRequests((current) => {
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
    setSelectedEmailIDsByBlock((current) => {
      if (!(blockID in current)) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
    setOpenEmailBlockIDs((current) => {
      if (!current.has(blockID)) return current;
      const next = new Set(current);
      next.delete(blockID);
      return next;
    });
    setOpenChatBlockIDs((current) => {
      if (!current.has(blockID)) return current;
      const next = new Set(current);
      next.delete(blockID);
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
      selectionSource: selectionAnchor?.source,
      selectionMessageID: selectionAnchor?.messageID,
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
    setOpenChatBlockIDs((current) => {
      if (current.has(blockID)) return current;
      const next = new Set(current);
      next.add(blockID);
      return next;
    });
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
            selectionSource: selectionAnchor?.source,
            selectionMessageID: selectionAnchor?.messageID,
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
    const emailSelectionAnchor = emailChatSelectionAnchorFromMessage(message);
    const removeEmailHighlight = Boolean(emailSelectionAnchor && !chatMessages.some((item) => (
      item.id !== messageID && chatMessageHasEmailSelectionAnchor(item, emailSelectionAnchor)
    )));

    setChatMessages((current) => current.filter((item) => item.id !== messageID));
    setChatReplyTargets((current) => {
      const nextEntries = Object.entries(current).filter(([, targetID]) => targetID !== messageID);
      return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
    });
    setActiveChatMessageIDs((current) => {
      const nextEntries = Object.entries(current).filter(([, activeID]) => activeID !== messageID);
      return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
    });
    if (emailSelectionAnchor && removeEmailHighlight) {
      removeStoredEmailLocalHighlight(emailSelectionAnchor.messageID, emailSelectionAnchor);
      setEmailHighlightRemovalRequest((current) => ({
        ...emailSelectionAnchor,
        requestID: (current?.requestID ?? 0) + 1,
      }));
    }

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

  const createNodeFromEmailSelection = useCallback(async (blockID: string, messageID: string, quote: string) => {
    if (!canEdit) return;
    if (typeof document === "undefined") return;
    const cleanQuote = quote.trim();
    if (!cleanQuote) return;
    const sourceBlock = blocks.find((block) => block.id === blockID);
    const sourceEmail = attachedEmails.find((email) => email.messageID === messageID || email.id === messageID);
    const fallbackTitle = sourceEmail?.subject.trim() || sourceBlock?.title.trim() || "Email selection";
    const selectionDocument = createEmailSelectionDocument(document, cleanQuote);
    if (!selectionDocument) return;
    try {
      await onCreateNodeFromImage({
        title: buildEmailSelectionNodeTitle(cleanQuote, fallbackTitle),
        blockTitle: "Email selection",
        document: selectionDocument,
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_create_email_selection_node");
    }
  }, [attachedEmails, blocks, canEdit, onCreateNodeFromImage, onError]);

  const attachEmail = useCallback(async (email: ReturnType<typeof messageAttachmentPayload>, blockID = "") => {
    if (!canEdit) return;
    const cleanBlockID = blockID.trim();
    if (attachedEmails.some((item) => item.messageID === email.messageID && (item.blockID ?? "") === cleanBlockID)) {
      setEmailPickerTargetBlockID(null);
      return;
    }
    const id = generateStableInformationID();
    const attached: EditorAttachedEmail = {
      id,
      blockID: cleanBlockID || undefined,
      messageID: email.messageID,
      threadID: email.threadID,
      subject: email.subject,
      snippet: email.snippet,
      from: email.from,
      date: email.date,
      attachedTimestamp: email.attachedTimestamp,
    };
    setAttachedEmails((current) => [attached, ...current]);
    setEmailPickerTargetBlockID(null);
    if (cleanBlockID) {
      setSelectedEmailIDsByBlock((current) => ({ ...current, [cleanBlockID]: email.messageID }));
      setOpenEmailBlockIDs((current) => {
        if (current.has(cleanBlockID)) return current;
        const next = new Set(current);
        next.add(cleanBlockID);
        return next;
      });
    }
    try {
      await requestJSON<unknown>(`/v1/nodes/${nodeID}/information`, {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          type: EDITOR_ATTACHED_EMAIL_TYPE,
          information: buildEditorAttachedEmailPayload({ ...email, blockID: cleanBlockID }),
          information_id: id,
        }),
      });
      onProjectionMutation();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_attach_email");
    }
  }, [attachedEmails, canEdit, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const removeAttachedEmail = useCallback(async (emailID: string) => {
    if (!canEdit || !nodeID || !companyID) return;
    const cleanEmailID = emailID.trim();
    if (!cleanEmailID) return;
    const target = attachedEmails.find((email) => email.id === cleanEmailID || email.messageID === cleanEmailID);
    if (!target) return;
    setAttachedEmails((current) => current.filter((email) => email.id !== target.id));
    setSelectedEmailIDsByBlock((current) => {
      const nextEntries = Object.entries(current).filter(([, messageID]) => messageID !== target.messageID);
      return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
    });
    try {
      await requestJSON<unknown>(`/v1/nodes/${nodeID}/projection/${encodeURIComponent(target.id)}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
      onProjectionMutation();
    } catch (cause) {
      setAttachedEmails((current) => current.some((email) => email.id === target.id) ? current : [target, ...current]);
      onError(cause instanceof Error ? cause.message : "failed_to_remove_email");
      onProjectionMutation();
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

  const openBlockEmail = useCallback((blockID: string, messageID: string) => {
    const cleanBlockID = blockID.trim();
    const cleanMessageID = messageID.trim();
    if (!cleanBlockID || !cleanMessageID) return;
    setSelectedEmailIDsByBlock((current) => ({ ...current, [cleanBlockID]: cleanMessageID }));
    setOpenEmailBlockIDs((current) => {
      if (current.has(cleanBlockID)) return current;
      const next = new Set(current);
      next.add(cleanBlockID);
      return next;
    });
    setFocusedTextBlockID("");
  }, []);

  const clearBlockEmail = useCallback((blockID: string) => {
    const cleanBlockID = blockID.trim();
    if (!cleanBlockID) return;
    setSelectedEmailIDsByBlock((current) => {
      if (!current[cleanBlockID]) return current;
      const next = { ...current };
      delete next[cleanBlockID];
      return next;
    });
  }, []);

  const openAttachedEmailFromHeader = useCallback((messageID: string) => {
    const cleanMessageID = messageID.trim();
    if (!cleanMessageID) return;
    const focusedBlockStillExists = blocks.some((block) => block.id === focusedTextBlockID);
    const targetBlockID = focusedBlockStillExists ? focusedTextBlockID : blocks[0]?.id ?? "";
    if (!targetBlockID) {
      onError("Create a text box to show attached email.");
      return;
    }
    openBlockEmail(targetBlockID, cleanMessageID);
  }, [blocks, focusedTextBlockID, onError, openBlockEmail]);

  const sidePaneWidthForBlock = useCallback((blockID: string, pane: TextSidePaneKind, fallback: number, maxWidth = TEXT_SIDE_PANE_MAX_WIDTH_PX): number => {
    const localWidth = sidePaneWidths[blockID]?.[pane];
    if (localWidth !== undefined) return clampTextSidePaneWidth(localWidth, maxWidth);
    return clampTextSidePaneWidth(readStoredTextSidePaneWidth(companyID, nodeID, blockID, pane, fallback), maxWidth);
  }, [companyID, nodeID, sidePaneWidths]);

  const startTextSidePaneResize = useCallback((blockID: string, pane: TextSidePaneKind, fallbackWidth: number, maxWidth: number, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const paneElement = event.currentTarget.nextElementSibling;
    if (!(paneElement instanceof HTMLElement)) return;
    const paneRect = paneElement.getBoundingClientRect();
    const startX = event.clientX;
    const startWidth = paneRect.width > 0 ? paneRect.width : sidePaneWidthForBlock(blockID, pane, fallbackWidth);
    const ownerDocument = event.currentTarget.ownerDocument;
    const previousCursor = ownerDocument.body.style.cursor;
    ownerDocument.body.style.cursor = "col-resize";
    let latestWidth = clampTextSidePaneWidth(startWidth, maxWidth);

    const updateWidth = (clientX: number) => {
      latestWidth = clampTextSidePaneWidth(startWidth + startX - clientX, maxWidth);
      setSidePaneWidths((current) => ({
        ...current,
        [blockID]: {
          ...current[blockID],
          [pane]: latestWidth,
        },
      }));
    };
    const onPointerMove = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      updateWidth(pointerEvent.clientX);
    };
    const finish = () => {
      ownerDocument.body.style.cursor = previousCursor;
      ownerDocument.removeEventListener("pointermove", onPointerMove);
      ownerDocument.removeEventListener("pointerup", finish);
      ownerDocument.removeEventListener("pointercancel", finish);
      storeTextSidePaneWidth(companyID, nodeID, blockID, pane, latestWidth);
    };

    updateWidth(event.clientX);
    ownerDocument.addEventListener("pointermove", onPointerMove);
    ownerDocument.addEventListener("pointerup", finish);
    ownerDocument.addEventListener("pointercancel", finish);
  }, [companyID, nodeID, sidePaneWidthForBlock]);

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

  const renderTextSidePaneResizeHandle = (blockID: string, pane: TextSidePaneKind, fallbackWidth: number, maxWidth: number) => {
    if (compact) return null;
    return (
      <div
        role="separator"
        aria-label={`Resize ${pane} column`}
        aria-orientation="vertical"
        data-frame-interactive="true"
        onPointerDown={(event) => startTextSidePaneResize(blockID, pane, fallbackWidth, maxWidth, event)}
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
        <div aria-hidden="true" style={{ position: "sticky", top: 0, zIndex: 42, minHeight: 38, padding: "0 0 7px", background: panelBackground }} />

        <div style={{ position: "sticky", top: 0, zIndex: 43, display: "flex", alignItems: "center", gap: 7, flexWrap: "nowrap", overflow: "visible", padding: "0 0 7px", background: panelBackground }}>
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
              onClick={() => setEmailPickerTargetBlockID("")}
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
          <EmailCountDropdown
            emails={nodeAttachedEmails}
            accent={accent}
            surfaceText={surfaceText}
            align="left"
            onOpenEmail={openAttachedEmailFromHeader}
          />
          <AttachmentCountDropdown
            items={nodeTextBlockAttachments}
            accent={accent}
            surfaceText={surfaceText}
            align="left"
            editable={canEdit}
            onRemove={removeTextBlockAttachment}
          />
          {canEdit && (
            <button
              type="button"
              title={assignLogicGateButtonLabel}
              onClick={() => {
                setLogicGateAssignerOpen((open) => !open);
                setRelationshipMenuOpen(false);
                setRelationshipCreateMenuOpen(false);
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
          <div style={{ position: "relative", display: "inline-flex", flex: "0 0 auto", minWidth: 0 }}>
            <button
              type="button"
              title="Relationships"
              aria-expanded={relationshipMenuOpen}
              onClick={() => {
                setRelationshipMenuOpen((open) => {
                  const next = !open;
                  if (!next) setRelationshipCreateMenuOpen(false);
                  if (!next) setRelationshipRowContextMenu(null);
                  return next;
                });
                setRelationshipHoveredNodeID("");
                setRelationshipRowContextMenu(null);
                setLogicGateAssignerOpen(false);
              }}
              style={{
                minHeight: 30,
                borderRadius: 9,
                border: relationshipMenuOpen ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                background: relationshipMenuOpen ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
                color: relationshipMenuOpen ? accent : surfaceText,
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
              <ExplorerRowIcon kind="node" />
              <span>Relationships</span>
              {relationshipCount + projectRelationshipCount > 0 && (
                <span style={{ minWidth: 18, height: 18, borderRadius: 999, display: "grid", placeItems: "center", background: "rgba(100,116,139,0.12)", color: accent, fontSize: 10, fontWeight: 900, padding: "0 5px", boxSizing: "border-box" }}>
                  {relationshipCount + projectRelationshipCount}
                </span>
              )}
            </button>
            {relationshipMenuOpen && (
              <div
                className="mango-editor-hover-highlight"
                onWheel={(event) => event.stopPropagation()}
                style={{
                  position: "absolute",
                  top: "calc(100% + 9px)",
                  left: "50%",
                  width: "min(430px, calc(100vw - 32px))",
                  maxHeight: 320,
                  zIndex: 90,
                  minHeight: 0,
                  display: "grid",
                  gridTemplateRows: "auto minmax(0, 1fr)",
                  overflow: "hidden",
                  transform: "translateX(-50%)",
                  border: "1px solid transparent",
                  borderRadius: 10,
                  background: `${panelBackground} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
                  color: surfaceText,
                  boxShadow: `${EDITOR_NEU_PANEL_SHADOW}, 0 0 18px rgba(183,124,255,0.18)`,
                  cursor: "default",
                }}
              >
                <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 10, padding: "10px 11px 8px", borderBottom: `1px solid ${ruleColor}`, background: `linear-gradient(135deg, rgba(6,182,212,0.12), rgba(255,255,255,0.72) 44%, rgba(124,58,237,0.12))` }}>
                  <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
                    <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: surfaceText, fontSize: 12, fontWeight: 950 }}>
                      Relationships
                    </div>
                    <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.82)", fontSize: 10, fontWeight: 760 }}>
                      {relationshipNodeTitle || "Current node"}
                    </div>
                  </div>
                  <div style={{ position: "relative", minWidth: 0, display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                    <span style={{ flex: "0 0 auto", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 999, padding: "3px 7px", background: EDITOR_NEU_SURFACE, color: accent, fontSize: 10, fontWeight: 900, boxShadow: EDITOR_NEU_SHADOW }}>
                      {relationshipRowCountLabel} · {projectRelationshipCount} project{projectRelationshipCount === 1 ? "" : "s"}
                    </span>
                    {canEdit && (
                      <div style={{ position: "relative", flex: "0 0 auto" }}>
                        <button
                          type="button"
                          aria-label="Create related node"
                          aria-haspopup="menu"
                          aria-expanded={relationshipCreateMenuOpen}
                          title="Create related node"
                          disabled={!!relationshipCreatingKind}
                          onClick={(event) => {
                            event.stopPropagation();
                            setRelationshipRowContextMenu(null);
                            setRelationshipCreateMenuOpen((open) => !open);
                          }}
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 8,
                            border: relationshipCreateMenuOpen ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                            background: relationshipCreateMenuOpen ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
                            color: accent,
                            cursor: relationshipCreatingKind ? "wait" : "pointer",
                            display: "grid",
                            placeItems: "center",
                            padding: 0,
                            fontSize: 17,
                            fontWeight: 600,
                            lineHeight: 1,
                            boxShadow: relationshipCreateMenuOpen ? `${EDITOR_NEU_SHADOW}, 0 0 14px rgba(183,124,255,0.18)` : EDITOR_NEU_SHADOW,
                            opacity: relationshipCreatingKind ? 0.66 : 1,
                          }}
                        >
                          +
                        </button>
                        {relationshipCreateMenuOpen && (
                          <div
                            role="menu"
                            aria-label="Create related node"
                            style={{
                              position: "absolute",
                              top: "calc(100% + 6px)",
                              right: 0,
                              width: 184,
                              padding: 5,
                              border: "1px solid transparent",
                              borderRadius: 8,
                              background: `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
                              boxShadow: `${EDITOR_NEU_PANEL_SHADOW}, 0 10px 24px rgba(15,23,42,0.14)`,
                              display: "grid",
                              gap: 3,
                              zIndex: 2,
                            }}
                          >
                            {RELATIONSHIP_CREATE_OPTIONS.map((option) => (
                              <button
                                key={option.kind}
                                type="button"
                                role="menuitem"
                                disabled={!!relationshipCreatingKind}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void createRelationshipNode(option.kind);
                                }}
                                style={{
                                  width: "100%",
                                  minHeight: 30,
                                  border: 0,
                                  borderRadius: 5,
                                  background: "transparent",
                                  color: surfaceText,
                                  cursor: relationshipCreatingKind ? "wait" : "pointer",
                                  textAlign: "left",
                                  padding: "6px 8px",
                                  fontSize: 11,
                                  fontWeight: 800,
                                  letterSpacing: 0,
                                }}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div
                  className="editor-document-scroll"
                  role="tree"
                  aria-label="Node relationships"
                  style={{
                    minHeight: 0,
                    overflowY: "auto",
                    padding: 8,
                    display: "grid",
                    alignContent: "start",
                    gap: 5,
                    background: "rgba(255,255,255,0.58)",
                    ["--editor-document-scroll-accent" as string]: scrollbarAccent,
                    ["--editor-document-scroll-track" as string]: scrollbarTrack,
                  }}
                >
                  <div style={{ display: "grid", gap: 5, paddingBottom: projectRelationshipCount > 0 || projectRelationshipsLoading ? 6 : 0, borderBottom: projectRelationshipCount > 0 || projectRelationshipsLoading ? `1px solid ${ruleColor}` : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: surfaceText, opacity: 0.74, fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                      <ExplorerRowIcon kind="project" />
                      <span>Projects</span>
                    </div>
                    {projectRelationshipsLoading ? (
                      <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, padding: 9, color: surfaceText, opacity: 0.62, fontSize: 11, fontWeight: 760 }}>
                        Loading projects
                      </div>
                    ) : projectRelationshipCount === 0 ? (
                      <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, padding: 9, color: surfaceText, opacity: 0.62, fontSize: 11, fontWeight: 760 }}>
                        No project relationships
                      </div>
                    ) : projectRelationshipRows.map((row) => {
                      const projectID = row.project_id.trim();
                      const label = row.project_name?.trim() || `Project ${projectID.slice(0, 8)}`;
                      return (
                        <button
                          key={row.relationship_id}
                          type="button"
                          onClick={() => goToProjectRelationship(row)}
                          title={label}
                          style={{
                            width: "100%",
                            minHeight: 30,
                            display: "grid",
                            gridTemplateColumns: "18px minmax(0, 1fr)",
                            alignItems: "center",
                            gap: 7,
                            border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                            borderRadius: 8,
                            background: EDITOR_NEU_SURFACE,
                            color: surfaceText,
                            cursor: "pointer",
                            padding: "5px 8px",
                            boxShadow: EDITOR_NEU_SHADOW,
                            font: "inherit",
                            textAlign: "left",
                          }}
                        >
                          <ExplorerRowIcon kind="project" />
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 850 }}>
                            {label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {relationshipRows.length === 0 ? (
                    <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, padding: 10, color: surfaceText, opacity: 0.68, fontSize: 11, fontWeight: 760 }}>
                      No related nodes
                    </div>
                  ) : relationshipRows.map((row) => (
                    <RelationshipMenuRow
                      key={`${row.nodeID}:${row.depth}`}
                      row={row}
                      current={row.nodeID === nodeID}
                      hovered={relationshipHoveredNodeID === row.nodeID}
                      accent={accent}
                      surfaceText={surfaceText}
                      strokeColor={strokeColor}
                      onOpen={goToRelationshipNode}
                      onHover={setRelationshipHoveredNodeID}
                      onContextMenu={openRelationshipRowContextMenu}
                    />
                  ))}
                </div>
              </div>
            )}
            {relationshipRowContextMenu && (
              <>
                <div
                  aria-hidden="true"
                  onMouseDown={() => setRelationshipRowContextMenu(null)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setRelationshipRowContextMenu(null);
                  }}
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 98,
                    background: "transparent",
                  }}
                />
                <div
                  role="menu"
                  aria-label="Relationship node actions"
                  onMouseDown={(event) => event.stopPropagation()}
                  style={{
                    position: "fixed",
                    left: relationshipRowContextMenu.x,
                    top: relationshipRowContextMenu.y,
                    zIndex: 99,
                    width: 164,
                    padding: 5,
                    border: "1px solid transparent",
                    borderRadius: 8,
                    background: `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
                    boxShadow: `${EDITOR_NEU_PANEL_SHADOW}, 0 10px 24px rgba(15,23,42,0.16)`,
                    display: "grid",
                    gap: 3,
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!!relationshipDeletingNodeID}
                    onClick={() => { void deleteRelationshipRowNode(relationshipRowContextMenu.row); }}
                    style={{
                      width: "100%",
                      minHeight: 30,
                      border: 0,
                      borderRadius: 5,
                      background: "transparent",
                      color: relationshipDeletingNodeID ? "rgba(100,116,139,0.58)" : "#b91c1c",
                      cursor: relationshipDeletingNodeID ? "wait" : "pointer",
                      textAlign: "left",
                      padding: "6px 8px",
                      fontSize: 11,
                      fontWeight: 850,
                      letterSpacing: 0,
                    }}
                  >
                    Delete node
                  </button>
                </div>
              </>
            )}
          </div>
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
          </>
        )}

        {blocks.length === 0 && (
          <>
            <TimelineCell accent={accent} muted isLast />
            <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, minHeight: 92, display: "grid", placeItems: "center", color: surfaceText, opacity: 0.7, fontSize: 13, fontWeight: 700 }}>
              No text boxes
            </div>
          </>
        )}

        {blocks.map((block, index) => {
          const messages = chatMessagesByBlock.get(block.id) ?? [];
          const blockEmails = nodeAttachedEmails;
          const chatIsActive = activeChatBlockID === block.id;
          const chatIsVisible = openChatBlockIDs.has(block.id) || chatIsActive || (messages.length > 0 && !closedChatBlockIDs.has(block.id));
          const emailPaneIsVisible = openEmailBlockIDs.has(block.id);
          const chatPaneIsVisible = chatIsVisible;
          const sidePaneCount = (emailPaneIsVisible ? 1 : 0) + (chatPaneIsVisible ? 1 : 0);
          const stackedSidePanes = compact || (sidePaneCount > 1 && width > 0 && width < 1080);
          const sidePaneChromeWidth = sidePaneCount > 0
            ? (TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX * sidePaneCount) + (TEXT_CHAT_GRID_COLUMN_GAP_PX * sidePaneCount * 2)
            : 0;
          const maxCombinedSidePaneWidth = sidePaneCount > 0
            ? Math.max(
              TEXT_SIDE_PANE_MIN_WIDTH_PX * sidePaneCount,
              textCommunicationContentWidth - TEXT_BLOCK_RESIZE_MIN_WIDTH_PX - sidePaneChromeWidth,
            )
            : TEXT_SIDE_PANE_MIN_WIDTH_PX;
          const sidePaneMaxWidth = Math.max(
            TEXT_SIDE_PANE_MIN_WIDTH_PX,
            maxCombinedSidePaneWidth - (TEXT_SIDE_PANE_MIN_WIDTH_PX * Math.max(0, sidePaneCount - 1)),
          );
          const sidePaneFallbackWidth = sidePaneCount > 1
            ? clampTextSidePaneWidth(Math.min(420, Math.floor(maxCombinedSidePaneWidth / sidePaneCount)), sidePaneMaxWidth)
            : textSidePaneDefaultWidth;
          const rawEmailPaneWidth = sidePaneWidthForBlock(block.id, "email", sidePaneFallbackWidth, sidePaneMaxWidth);
          const rawChatPaneWidth = sidePaneWidthForBlock(block.id, "chat", sidePaneFallbackWidth, sidePaneMaxWidth);
          const fittedSidePaneWidths = fitTextSidePaneWidths(
            [
              emailPaneIsVisible ? rawEmailPaneWidth : 0,
              chatPaneIsVisible ? rawChatPaneWidth : 0,
            ].filter((paneWidth) => paneWidth > 0),
            maxCombinedSidePaneWidth,
          );
          const emailPaneWidth = emailPaneIsVisible ? fittedSidePaneWidths[0] ?? rawEmailPaneWidth : rawEmailPaneWidth;
          const chatPaneWidth = chatPaneIsVisible ? fittedSidePaneWidths[emailPaneIsVisible ? 1 : 0] ?? rawChatPaneWidth : rawChatPaneWidth;
          const emailPaneMaxWidth = Math.max(TEXT_SIDE_PANE_MIN_WIDTH_PX, maxCombinedSidePaneWidth - (chatPaneIsVisible ? chatPaneWidth : 0));
          const chatPaneMaxWidth = Math.max(TEXT_SIDE_PANE_MIN_WIDTH_PX, maxCombinedSidePaneWidth - (emailPaneIsVisible ? emailPaneWidth : 0));
          const blockCommunicationGridTemplateColumns = !stackedSidePanes && sidePaneCount > 0
            ? [
              `minmax(${TEXT_BLOCK_RESIZE_MIN_WIDTH_PX}px, 1fr)`,
              emailPaneIsVisible ? `${TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX}px` : "",
              emailPaneIsVisible ? `minmax(${TEXT_SIDE_PANE_MIN_WIDTH_PX}px, ${emailPaneWidth}px)` : "",
              chatPaneIsVisible ? `${TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX}px` : "",
              chatPaneIsVisible ? `minmax(${TEXT_SIDE_PANE_MIN_WIDTH_PX}px, ${chatPaneWidth}px)` : "",
            ].filter(Boolean).join(" ")
            : "minmax(0, 1fr)";
          const textBlockIsFocused = focusedTextBlockID === block.id;
          const selectionAnchor = chatSelectionAnchors[block.id];
          const activeChatMessageID = activeChatMessageIDs[block.id] ?? "";
          const activeChatMessage = activeChatMessageID ? messages.find((message) => message.id === activeChatMessageID) ?? null : null;
          const activeChatAnchorMessageID = resolveEditorTextBlockChatAnchorMessageID(messages, activeChatMessageID);
          const activeEmailSelection = activeChatMessage?.selectionSource === "email"
            && activeChatMessage.selectionMessageID
            && activeChatMessage.selectionQuote
            && Number.isFinite(activeChatMessage.selectionStart)
            && Number.isFinite(activeChatMessage.selectionEnd)
            ? {
              messageID: activeChatMessage.selectionMessageID,
              quote: activeChatMessage.selectionQuote,
              startOffset: activeChatMessage.selectionStart ?? 0,
              endOffset: activeChatMessage.selectionEnd ?? 0,
            }
            : null;
          const blockAttachmentItems: TextBlockAttachmentListItem[] = (block.attachments ?? []).map((attachment) => ({
            blockID: block.id,
            blockTitle: block.title,
            attachment,
          }));
          const blockHeaderGridTemplateColumns = canEdit
            ? "minmax(0, 1fr) 26px 42px 26px 26px 26px 26px"
            : "minmax(0, 1fr) 42px 26px 26px 26px";
          const blockEmailPane = (
            <AttachedEmailOrganizerPane
              emails={blockEmails}
              companyID={companyID}
              storageKey={`node-editor-attached-email-layout-v1:${companyID || "company"}:${nodeID || "node"}`}
              editable={canEdit}
              accent={accent}
              surfaceText={surfaceText}
              strokeColor={strokeColor}
              ruleColor={ruleColor}
              selectedMessageID={selectedEmailIDsByBlock[block.id] ?? ""}
              activeEmailSelection={activeEmailSelection}
              emailHighlightRemovalRequest={emailHighlightRemovalRequest}
              onSelectMessage={(messageID) => openBlockEmail(block.id, messageID)}
              onClearSelectedMessage={() => clearBlockEmail(block.id)}
              onRemoveEmail={(emailID) => { void removeAttachedEmail(emailID); }}
              onEmailSelectionChatRequest={(messageID, selection) => openSelectionChat({
                blockID: block.id,
                source: "email",
                messageID,
                quote: selection.quote,
                startOffset: selection.startOffset,
                endOffset: selection.endOffset,
                x: selection.x,
                y: selection.y,
              })}
              onEmailSelectionNodeRequest={(messageID, quote) => { void createNodeFromEmailSelection(block.id, messageID, quote); }}
              onError={onError}
            />
          );
          const toggleChat = () => {
            setFocusedTextBlockID("");
            if (chatPaneIsVisible) {
              setActiveChatBlockID("");
              setOpenChatBlockIDs((current) => {
                if (!current.has(block.id)) return current;
                const next = new Set(current);
                next.delete(block.id);
                return next;
              });
              setClosedChatBlockIDs((current) => {
                const next = new Set(current);
                next.add(block.id);
                return next;
              });
              return;
            }
            setClosedChatBlockIDs((current) => {
              if (!current.has(block.id)) return current;
              const next = new Set(current);
              next.delete(block.id);
              return next;
            });
            setOpenChatBlockIDs((current) => {
              if (current.has(block.id)) return current;
              const next = new Set(current);
              next.add(block.id);
              return next;
            });
            setActiveChatBlockID(block.id);
          };
          const focusChat = () => {
            setFocusedTextBlockID("");
            setOpenChatBlockIDs((current) => {
              if (current.has(block.id)) return current;
              const next = new Set(current);
              next.add(block.id);
              return next;
            });
            setClosedChatBlockIDs((current) => {
              if (!current.has(block.id)) return current;
              const next = new Set(current);
              next.delete(block.id);
              return next;
            });
            setActiveChatBlockID(block.id);
          };
          const toggleEmail = () => {
            setFocusedTextBlockID("");
            setOpenEmailBlockIDs((current) => {
              const next = new Set(current);
              if (next.has(block.id)) next.delete(block.id);
              else next.add(block.id);
              return next;
            });
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
              <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: blockCommunicationGridTemplateColumns, columnGap: TEXT_CHAT_GRID_COLUMN_GAP_PX, rowGap: 8, alignItems: "start" }}>
                <div style={{ border: textBlockIsFocused ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 14, background: `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${textBlockIsFocused ? EDITOR_NEU_EDGE_FRAME : "linear-gradient(135deg, rgba(255,255,255,0.76), rgba(255,255,255,0.76))"} border-box`, overflow: "hidden", boxShadow: textBlockIsFocused ? "8px 8px 20px rgba(174,174,192,0.26), -7px -7px 16px rgba(255,255,255,0.92), 0 0 18px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.88)" : EDITOR_NEU_SHADOW }}>
                  <div style={{ display: "grid", gridTemplateColumns: blockHeaderGridTemplateColumns, alignItems: "center", gap: 6, minHeight: 34, borderBottom: `1px solid ${ruleColor}`, padding: "5px 6px 5px 8px", background: "linear-gradient(90deg, rgba(255,241,242,0.62), rgba(236,253,245,0.42) 52%, rgba(239,246,255,0.66))", overflow: "visible" }}>
                    <div style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 6, paddingRight: 6, color: surfaceText, fontSize: 10, fontWeight: 800, letterSpacing: 0, whiteSpace: compact ? "normal" : "nowrap", overflow: "visible" }}>
                      <span style={{ minWidth: 0, display: "inline-flex", alignItems: "center", gap: 7, overflow: "hidden", opacity: 0.58 }}>
                        <span title={`Last Updated: ${formatTextBlockMetadataTimestamp(block.updatedTimestamp)}`} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                          Last Updated: {formatTextBlockMetadataTimestamp(block.updatedTimestamp)}
                        </span>
                        <span aria-hidden="true" style={{ flex: "0 0 auto", opacity: 0.62 }}>|</span>
                        <span title={`Created: ${formatTextBlockMetadataTimestamp(block.createdTimestamp)}`} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                          Created: {formatTextBlockMetadataTimestamp(block.createdTimestamp)}
                        </span>
                      </span>
                    </div>
                    {canEdit && (
                      <label
                        title="Add attachment"
                        aria-label="Add attachment"
                        style={{ width: 26, height: 24, borderRadius: 8, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", boxShadow: "2px 2px 7px rgba(174,174,192,0.16), -2px -2px 7px rgba(255,255,255,0.78)" }}
                      >
                        <PaperclipIcon color={accent} />
                        <input
                          type="file"
                          multiple
                          style={{ display: "none" }}
                          onChange={(event) => {
                            const files = event.currentTarget.files;
                            if (files) void addTextBlockAttachments(block.id, files);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    )}
                    <AttachmentCountDropdown
                      items={blockAttachmentItems}
                      accent={accent}
                      surfaceText={surfaceText}
                      compact
                      editable={canEdit}
                      onRemove={removeTextBlockAttachment}
                    />
                    {canEdit && (
                      <button
                        type="button"
                        title="Insert table"
                        aria-label="Insert table"
                        onClick={() => setTableInsertRequests((current) => ({ ...current, [block.id]: (current[block.id] ?? 0) + 1 }))}
                        style={{ width: 26, height: 24, borderRadius: 8, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", boxShadow: "2px 2px 7px rgba(174,174,192,0.16), -2px -2px 7px rgba(255,255,255,0.78)" }}
                      >
                        <TableIcon color={accent} />
                      </button>
                    )}
                    <button
                      type="button"
                      title={emailPaneIsVisible ? "Hide email" : "Open email"}
                      onClick={toggleEmail}
                      style={{ position: "relative", width: 26, height: 24, borderRadius: 8, border: emailPaneIsVisible ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: emailPaneIsVisible ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", boxShadow: "2px 2px 7px rgba(174,174,192,0.16), -2px -2px 7px rgba(255,255,255,0.78)" }}
                    >
                      <MailIcon color={accent} />
                    </button>
                    <button
                      type="button"
                      title={chatPaneIsVisible ? "Hide chat" : "Open chat"}
                      onClick={toggleChat}
                      style={{ width: 26, height: 24, borderRadius: 8, border: chatPaneIsVisible ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: chatPaneIsVisible ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", boxShadow: "2px 2px 7px rgba(174,174,192,0.16), -2px -2px 7px rgba(255,255,255,0.78)" }}
                    >
                      <ChatIcon color={accent} />
                    </button>
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
                    tableInsertRequestID={tableInsertRequests[block.id] ?? 0}
                    surfaceText={surfaceText}
                    accent={accent}
                    outlineStyle={outlineStyle}
                    indentGuideColor={ruleColor}
                    scrollbarTrack={scrollbarTrack}
                    onFocus={() => {
                      setFocusedTextBlockID(block.id);
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
                {emailPaneIsVisible && !stackedSidePanes && renderTextSidePaneResizeHandle(block.id, "email", emailPaneWidth, emailPaneMaxWidth)}
                {emailPaneIsVisible && (
                  <div style={{ minWidth: 0, height: CHAT_PANE_DEFAULT_HEIGHT, gridColumn: stackedSidePanes ? "1 / -1" : undefined, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 14, background: panelBackground, overflow: "hidden", boxShadow: EDITOR_NEU_SHADOW }}>
                    {blockEmailPane}
                  </div>
                )}
                {chatPaneIsVisible && !stackedSidePanes && renderTextSidePaneResizeHandle(block.id, "chat", chatPaneWidth, chatPaneMaxWidth)}
                {chatPaneIsVisible && (
                  <div style={{ minWidth: 0, gridColumn: stackedSidePanes ? "1 / -1" : undefined }}>
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
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}

        <div />
        <div
          onDragEnter={() => { if (canEdit) setDropActive(true); }}
          onDragOver={(event) => {
            if (canEdit && event.dataTransfer.types.includes(EMAIL_DRAG_MIME)) event.preventDefault();
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={onDropEmail}
          style={{ minHeight: dropActive ? 48 : 14, border: dropActive ? "1px solid transparent" : "none", borderRadius: 14, background: dropActive ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : "transparent", boxShadow: dropActive ? "0 10px 24px rgba(15,23,42,0.12), 0 0 16px rgba(183,124,255,0.18)" : undefined }}
        />
      </div>

      {canEdit && emailPickerTargetBlockID !== null && (
        <EmailPickerModal
          accent={accent}
          surfaceText={surfaceText}
          panelBackground={panelBackground}
          strokeColor={strokeColor}
          onClose={() => setEmailPickerTargetBlockID(null)}
          onAttach={(message) => { void attachEmail(messageAttachmentPayload(message), emailPickerTargetBlockID ?? ""); }}
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

