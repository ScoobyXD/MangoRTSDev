import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu.js";
import { AppModalPortal, useAppFloatingMenuDismissal } from "../../app/AppModalPortal.js";
import { fetchCurrentUser } from "../../auth/cognitoAuth";
import { isAbortError } from "../api/requestJSON";
import { humanLabelOrFallback } from "../entityLabels.js";
import { getLogicGateRecordSingleFlight } from "../logic-gate-map/LogicGateRecordStore.js";
import type { LogicGateRecord } from "../logic-gate-map/shared";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED } from "../node-map/eventbus";
import { ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons";
import { CompanyExplorerSearchBox } from "../company-explorer/CompanyExplorerSearchBox";
import { fetchCompanyExplorerSearchResults, type CompanyExplorerSearchResult } from "../company-explorer/companyExplorerLazyApi";
import { reconcileCompanyExplorerSearchResultTitles } from "../company-explorer/companyExplorerStore";
import { foldCommittedEntityTitlesSince, readCommittedEntityTitleVersion, subscribeCommittedEntityTitleUpdates } from "../realtime/committedEntityTitleUpdates";
import { buildCompanyExplorerSearchTreeRows } from "../company-explorer/companyExplorerTreeRows";
import type { ExplorerTreeNode } from "../company-explorer/companyExplorerTypes";
import { reconcileCommittedLogicGateRecordTitles } from "../map/committedTitleSnapshotReconciliation";
import {
  fetchProjectView,
  listProjectRelationshipsForResource,
  listProjects,
  upsertProjectRelationship,
  type ProjectRecord,
  type ProjectRelationshipProjection,
} from "../project-management/projectManagementApi";
import {
  filterMangoResourceAttachments,
  groupMangoResourceAttachmentsByInformationID,
  invalidateMangoResourceAttachmentsCache,
  listMangoResourceAttachments,
  unlinkMangoResourceAttachment,
  type MangoAttachmentUploadProgress,
  type MangoResourceAttachment,
} from "../attachments/attachmentApi";
import {
  buildEditorAttachedEmailPayload,
  buildEditorTextBlockMetadataPayload,
  buildEditorTextBlockChatPayload,
  EDITOR_ATTACHED_EMAIL_TYPE,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  canDeleteEditorTextBlockChatMessage,
  editorEmailMessageAccent,
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
import { createTextBlockProjectionSaveController } from "./nodeTextBlockProjectionSaves";
import {
  appendUniqueEditorAttachments,
  editorChatAttachmentsReadyForSubmit,
  failEditorChatAttachmentTransfer,
  resolveEditorChatAttachmentTransfer,
  stageEditorChatAttachmentTransfer,
  transferTextBlockImageToChatDraft,
  nodeAttachmentUploadScopeMatches,
  textBlockAttachmentContextLabel,
  visibleNodeAttachmentUploads,
  type NodeAttachmentUploadScope,
} from "./nodeTextBlockAttachments";
import {
  projectionIDsForTextBlockDeletion,
  shouldCreateInitialTextBlock,
} from "./nodeTextBlockDeletion";
import { resolveEditorTextBlockChatAnchorMessageID } from "./editorTextBlockChatHighlights";
import { createEditorImageFrame } from "./editorImages";
import { serializeEditorDocumentHTML } from "./richTextEditing";
import { createEditorScrollMemory } from "./editorScroll";
import { useBoundedEditorRowVirtualization } from "./editorRowVirtualization";

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
  type AttachmentUploadDropdownItem,
} from "./NodeWorkspaceSurfaceParts";
import {
  DEFAULT_TEXT_BLOCK_TITLE,
  EMAIL_DRAG_MIME,
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_PANEL_SHADOW,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
  ChatIcon,
  MailIcon,
  messageAttachmentPayload,
  PaperclipIcon,
  parseDraggedEmail,
  PlusIcon,
  TextEditorIcon,
  TEXT_BLOCK_MIN_HEIGHT,
  TEXT_BLOCK_ROW_GAP,
  TEXT_BLOCK_ROW_HEIGHT,
  projectionsKey,
  uploadEditorAttachment,
  type NodeWorkspaceSurfaceProps,
  type TextBlockImageDraft,
  type TextBlockSelectionAnchor,
  type TextBlockSelectionDraft,
  type TextBlockState,
} from "./NodeWorkspaceSurfaceShared";
import { prepareTextBlockImageFile } from "./nodeTextBlockImageFiles";
import { mentionUserDisplayName, splitTextByMentions, type MentionableCompanyUser } from "./editorMentions";

const TEXT_TIMELINE_COLUMN_WIDTH_PX = 52;
const TEXT_TIMELINE_COMPACT_COLUMN_WIDTH_PX = 48;
const TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX = 8;
const TEXT_CHAT_GRID_COLUMN_GAP_PX = 8;
const TEXT_CHAT_HORIZONTAL_PADDING_PX = 28;
const TEXT_BLOCK_RESIZE_MIN_WIDTH_PX = 160;
const TEXT_SIDE_PANE_DEFAULT_WIDTH_PX = 360;
const TEXT_SIDE_PANE_MIN_WIDTH_PX = 300;
const TEXT_SIDE_PANE_MAX_WIDTH_PX = 1400;
const NODE_EMAIL_COLUMN_LAYOUT_ID = "__node_email_column__";
const TEXT_SIDE_PANE_WIDTH_STORAGE_KEY_PREFIX = "node-editor-side-pane-width-v1";
const TEXT_PANE_LAYOUT_STORAGE_KEY_PREFIX = "node-editor-pane-layout-v4";
const LEGACY_TEXT_PANE_LAYOUT_STORAGE_KEY_PREFIXES = ["node-editor-pane-layout-v3", "node-editor-pane-layout-v2"] as const;
const EMAIL_SELECTION_NODE_TITLE_MAX_LENGTH = 80;

function mentionedUserIDsFromChatDraft(draft: string, users: MentionableCompanyUser[]): string[] {
  const aliasCounts = new Map<string, number>();
  for (const user of users) {
    const alias = mentionUserDisplayName(user).trim().toLowerCase();
    if (alias) aliasCounts.set(alias, (aliasCounts.get(alias) ?? 0) + 1);
  }
  const unambiguousUsers = users.filter((user) => aliasCounts.get(mentionUserDisplayName(user).trim().toLowerCase()) === 1);
  return Array.from(new Set(splitTextByMentions(draft, unambiguousUsers)
    .filter((segment) => segment.mention)
    .map((segment) => segment.user?.user_id.trim() ?? "")
    .filter(Boolean)));
}

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
  initialized: boolean;
  openEditorBlockIDs: string[];
  openEmailBlockIDs: string[];
  openChatBlockIDs: string[];
  closedChatBlockIDs: string[];
  closedEditorBlockIDs: string[];
  closedEmailBlockIDs: string[];
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

function textPaneLayoutStorageKey(companyID: string, nodeID: string, prefix = TEXT_PANE_LAYOUT_STORAGE_KEY_PREFIX): string {
  return `${prefix}:${companyID || "company"}:${nodeID || "node"}`;
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

function emptyTextPaneLayoutSnapshot(): TextPaneLayoutSnapshot {
  return {
    initialized: false,
    openEditorBlockIDs: [],
    openEmailBlockIDs: [],
    openChatBlockIDs: [],
    closedEditorBlockIDs: [],
    closedEmailBlockIDs: [],
    closedChatBlockIDs: [],
    selectedEmailIDsByBlock: {},
  };
}

function readStoredTextPaneLayout(companyID: string, nodeID: string): TextPaneLayoutSnapshot {
  if (typeof localStorage === "undefined") return emptyTextPaneLayoutSnapshot();
  try {
    const current = localStorage.getItem(textPaneLayoutStorageKey(companyID, nodeID));
    const legacy = current === null
      ? LEGACY_TEXT_PANE_LAYOUT_STORAGE_KEY_PREFIXES
        .map((prefix) => localStorage.getItem(textPaneLayoutStorageKey(companyID, nodeID, prefix)))
        .find((value) => value !== null) ?? null
      : null;
    const stored = current ?? legacy;
    const parsed = JSON.parse(stored ?? "{}") as Record<string, unknown>;
    const openEditorBlockIDs = cleanIDList(parsed.openEditorBlockIDs);
    const openEmailBlockIDs = cleanIDList(parsed.openEmailBlockIDs);
    const openChatBlockIDs = cleanIDList(parsed.openChatBlockIDs);
    const closedEditorBlockIDs = cleanIDList(parsed.closedEditorBlockIDs);
    const closedEmailBlockIDs = cleanIDList(parsed.closedEmailBlockIDs);
    const closedChatBlockIDs = cleanIDList(parsed.closedChatBlockIDs);
    const selectedEmailIDsByBlock = cleanSelectedEmailMap(parsed.selectedEmailIDsByBlock);
    const activeChatBlockID = typeof parsed.activeChatBlockID === "string" && parsed.activeChatBlockID.trim() ? parsed.activeChatBlockID.trim() : undefined;
    const faultyLegacyEmptyLayout = legacy !== null
      && openEditorBlockIDs.length === 0
      && openEmailBlockIDs.length === 0
      && openChatBlockIDs.length === 0
      && closedEditorBlockIDs.length === 0
      && closedEmailBlockIDs.length === 0
      && closedChatBlockIDs.length === 0
      && Object.keys(selectedEmailIDsByBlock).length === 0
      && !activeChatBlockID;
    return {
      initialized: stored !== null && !faultyLegacyEmptyLayout,
      openEditorBlockIDs,
      openEmailBlockIDs,
      openChatBlockIDs,
      closedEditorBlockIDs,
      closedEmailBlockIDs,
      closedChatBlockIDs,
      selectedEmailIDsByBlock,
      activeChatBlockID,
    };
  } catch {
    return emptyTextPaneLayoutSnapshot();
  }
}

function storeTextPaneLayout(companyID: string, nodeID: string, snapshot: TextPaneLayoutSnapshot) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(textPaneLayoutStorageKey(companyID, nodeID), JSON.stringify({
    initialized: true,
    openEditorBlockIDs: cleanIDList(snapshot.openEditorBlockIDs),
    openEmailBlockIDs: cleanIDList(snapshot.openEmailBlockIDs),
    openChatBlockIDs: cleanIDList(snapshot.openChatBlockIDs),
    closedEditorBlockIDs: cleanIDList(snapshot.closedEditorBlockIDs),
    closedEmailBlockIDs: cleanIDList(snapshot.closedEmailBlockIDs),
    closedChatBlockIDs: cleanIDList(snapshot.closedChatBlockIDs),
    selectedEmailIDsByBlock: cleanSelectedEmailMap(snapshot.selectedEmailIDsByBlock),
    activeChatBlockID: snapshot.activeChatBlockID?.trim() || "",
  }));
}

function logicGateOptionLabel(logicGate: LogicGateRecord): string {
  return humanLabelOrFallback(logicGate.header, humanLabelOrFallback(logicGate.logic_gate_id, "Logic Gate"));
}

const RelationshipCheckIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="m3.4 8.15 2.8 2.75 6.35-6.65" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function sortLogicGateOptions(items: LogicGateRecord[]): LogicGateRecord[] {
  return [...items].sort((a, b) => (
    logicGateOptionLabel(a).localeCompare(logicGateOptionLabel(b), undefined, { numeric: true, sensitivity: "base" })
    || a.logic_gate_id.localeCompare(b.logic_gate_id)
  ));
}

function projectOptionLabel(project: ProjectRecord): string {
  return humanLabelOrFallback(project.name, humanLabelOrFallback(project.project_id, "Project"));
}

function sortProjectOptions(items: ProjectRecord[]): ProjectRecord[] {
  return [...items].sort((a, b) => (
    projectOptionLabel(a).localeCompare(projectOptionLabel(b), undefined, { numeric: true, sensitivity: "base" })
    || a.project_id.localeCompare(b.project_id)
  ));
}

function projectRelationshipLabel(row: ProjectRelationshipProjection): string {
  return row.project_name?.trim() || humanLabelOrFallback(row.project_id, "Project");
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
  editorSequence,
  hidden = false,
  focusInformationID,
  focusEmailMessageID,
  focusRequestID,
  focusInformationMode = "focus",
  topPx,
  accent,
  surfaceText,
  panelBackground,
  strokeColor,
  ruleColor,
  scrollbarAccent,
  scrollbarTrack,
  outlineStyle,
  formattingControllerRef,
  requestJSON,
  onProjectionMutation,
  onMarkChangeSeen,
  onMarkAllChangesSeen,
  onCreateNodeFromImage,
  onAssignToLogicGate,
  onRequireNodePriorityForLogicGateAssignment,
  onSelectionFontSizeChange,
  onSelectionInlineFormatChange,
  onSelectionHighlightColorChange,
  onSelectionTextAlignmentChange,
  onFormattingControllerAvailabilityChange,
  onRegisterSaveController,
  onError,
}) => {
  const paneLayoutScope = `${companyID}\u001f${nodeID}`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const logicGateAssignerRef = useRef<HTMLDivElement | null>(null);
  const logicGateSearchRequestRef = useRef(0);
  const projectAssignerRef = useRef<HTMLDivElement | null>(null);
  const saveTimersRef = useRef(new Map<string, number>());
  const attachmentUploadScopeRef = useRef({ companyID, nodeID, canEdit, generation: 0 });
  const nodeAttachmentUploadFilesRef = useRef(new Map<string, { file: File; blockID: string; controller?: AbortController }>());
  const logicGateAssignStatusTimerRef = useRef<number | null>(null);
  const logicGateAssignFlashTimerRef = useRef<number | null>(null);
  const contentByBlockRef = useRef(new Map<string, EditorTextBlockContent>());
  const documentScrollMemoryRef = useRef(createEditorScrollMemory());
  const focusBlockIDRef = useRef("");
  const handledFocusRequestRef = useRef("");
  const loadedNodeScopeRef = useRef("");
  const initialPaneLayoutRef = useRef(readStoredTextPaneLayout(companyID, nodeID));
  const paneLayoutReadyScopeRef = useRef("");
  const [width, setWidth] = useState(0);
  const [blocks, setBlocks] = useState<TextBlockState[]>([]);
  const [chatMessages, setChatMessages] = useState<EditorTextBlockChatMessage[]>([]);
  const [attachedEmails, setAttachedEmails] = useState<EditorAttachedEmail[]>([]);
  const [nodeResourceAttachments, setNodeResourceAttachments] = useState<MangoResourceAttachment[]>([]);
  const [nodeAttachmentsLoading, setNodeAttachmentsLoading] = useState(false);
  const [nodeAttachmentsLoadError, setNodeAttachmentsLoadError] = useState("");
  const [nodeAttachmentsRefreshKey, setNodeAttachmentsRefreshKey] = useState(0);
  const [nodeAttachmentUploads, setNodeAttachmentUploads] = useState<AttachmentUploadDropdownItem[]>([]);
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [chatDraftAttachments, setChatDraftAttachments] = useState<Record<string, EditorChatAttachment[]>>({});
  const [chatReplyTargets, setChatReplyTargets] = useState<Record<string, string>>({});
  const [chatSelectionAnchors, setChatSelectionAnchors] = useState<Record<string, TextBlockSelectionAnchor>>({});
  const [activeChatMessageIDs, setActiveChatMessageIDs] = useState<Record<string, string>>({});
  const [activeChatBlockID, setActiveChatBlockID] = useState(initialPaneLayoutRef.current.activeChatBlockID ?? "");
  const [selectedEmailIDsByBlock, setSelectedEmailIDsByBlock] = useState<Record<string, string>>(() => initialPaneLayoutRef.current.selectedEmailIDsByBlock);
  const [openEditorBlockIDs, setOpenEditorBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.openEditorBlockIDs));
  const [openEmailBlockIDs, setOpenEmailBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.openEmailBlockIDs));
  const [openChatBlockIDs, setOpenChatBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.openChatBlockIDs));
  const [sidePaneWidths, setSidePaneWidths] = useState<Record<string, Partial<Record<TextSidePaneKind, number>>>>({});
  const [chatNavigationRequest, setChatNavigationRequest] = useState<{ blockID: string; anchorMessageID: string; requestID: number } | null>(null);
  const [chatMessageFocusRequest, setChatMessageFocusRequest] = useState<{ blockID: string; messageID: string; requestID: number } | null>(null);
  const [chatComposerFocusRequestIDs, setChatComposerFocusRequestIDs] = useState<Record<string, number>>({});
  const [emailHighlightRemovalRequest, setEmailHighlightRemovalRequest] = useState<EmailHighlightRemovalRequest | null>(null);
  const [closedEditorBlockIDs, setClosedEditorBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.closedEditorBlockIDs));
  const [closedEmailBlockIDs, setClosedEmailBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.closedEmailBlockIDs));
  const [closedChatBlockIDs, setClosedChatBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.closedChatBlockIDs));
  const [focusedTextBlockID, setFocusedTextBlockID] = useState<string | null>(null);
  const [activeRowBlockID, setActiveRowBlockID] = useState("");
  const [emailReplyBlockID, setEmailReplyBlockID] = useState("");
  const [emailPickerTargetBlockID, setEmailPickerTargetBlockID] = useState<string | null>(null);
  const [nodeEmailModalMessageID, setNodeEmailModalMessageID] = useState("");
  const [logicGateAssignerOpen, setLogicGateAssignerOpen] = useState(false);
  const [logicGateSearch, setLogicGateSearch] = useState("");
  const [logicGateSearchResults, setLogicGateSearchResults] = useState<CompanyExplorerSearchResult[]>([]);
  const [assignedLogicGateRecords, setAssignedLogicGateRecords] = useState<LogicGateRecord[]>([]);
  const [logicGateSearchLoading, setLogicGateSearchLoading] = useState(false);
  const [assigningLogicGateID, setAssigningLogicGateID] = useState("");
  const [hoveredLogicGateID, setHoveredLogicGateID] = useState("");
  const [lastAssignedLogicGateID, setLastAssignedLogicGateID] = useState("");
  const [lastAssignedLogicGateLabel, setLastAssignedLogicGateLabel] = useState("");
  const [logicGateAssignStatus, setLogicGateAssignStatus] = useState("");
  const [logicGateAssignFlash, setLogicGateAssignFlash] = useState<"" | "success" | "error">("");
  const [projectAssignerOpen, setProjectAssignerOpen] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectRecord[]>([]);
  const [projectOptionsLoading, setProjectOptionsLoading] = useState(false);
  const [projectRelationshipRefreshKey, setProjectRelationshipRefreshKey] = useState(0);
  const [nodeProjectRelationships, setNodeProjectRelationships] = useState<ProjectRelationshipProjection[]>([]);
  const [selectedProjectForAssignment, setSelectedProjectForAssignment] = useState<ProjectRecord | null>(null);
  const [projectLogicGateOptions, setProjectLogicGateOptions] = useState<LogicGateRecord[]>([]);
  const [projectLogicGatesLoading, setProjectLogicGatesLoading] = useState(false);
  const [assigningProjectID, setAssigningProjectID] = useState("");
  const [assigningProjectLogicGateID, setAssigningProjectLogicGateID] = useState("");
  const [projectAssignStatus, setProjectAssignStatus] = useState("");
  useEffect(() => subscribeCommittedEntityTitleUpdates((update) => {
    if (update.companyID !== companyID || update.entityType !== "logic_gate") return;
    const resourceID = update.resourceID.trim();
    const title = update.title.trim();
    if (!resourceID || !title) return;
    setAssignedLogicGateRecords((current) => reconcileCommittedLogicGateRecordTitles(current, update));
    setLogicGateSearchResults((current) => reconcileCompanyExplorerSearchResultTitles(current, update));
    setLastAssignedLogicGateLabel((current) => lastAssignedLogicGateID.trim() === resourceID ? title : current);
    setProjectLogicGateOptions((current) => reconcileCommittedLogicGateRecordTitles(current, update));
  }), [companyID, lastAssignedLogicGateID]);

  const [projectAssignerDropdownLeft, setProjectAssignerDropdownLeft] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const [author, setAuthor] = useState({ userID: "", name: "You" });
  const editorTextCanEdit = canEdit && projectionsLoaded && Boolean(author.userID);
  const formattingControllerAvailable = editorTextCanEdit && blocks.some((block) => block.id === focusedTextBlockID);
  useEffect(() => {
    onFormattingControllerAvailabilityChange?.(formattingControllerAvailable);
  }, [formattingControllerAvailable, onFormattingControllerAvailabilityChange]);
  useEffect(() => () => {
    onFormattingControllerAvailabilityChange?.(false);
  }, [onFormattingControllerAvailabilityChange]);
  const [deleteTextBlockConfirmation, setDeleteTextBlockConfirmation] = useState<{ blockID: string; title: string; chatCount: number; position: ConfirmActionMenuPosition } | null>(null);
  const autoCreatedTextBlockNodeIDsRef = useRef(new Set<string>());
  const textBlockProjectionSaveController = useMemo(
    () => createTextBlockProjectionSaveController<EditorTextBlockContent>(),
    [companyID, nodeID],
  );

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
    const byConversation = new Map<string, EditorAttachedEmail>();
    for (const email of attachedEmails) {
      const messageID = email.messageID.trim();
      if (!messageID) continue;
      const mailboxKey = email.sharedInboxID?.trim()
        ? `shared:${email.sharedInboxID.trim()}`
        : `account:${email.accountEmail?.trim().toLowerCase() ?? ""}`;
      const conversationKey = `${mailboxKey}:${email.threadID?.trim() || messageID}`;
      if (byConversation.has(conversationKey)) continue;
      byConversation.set(conversationKey, email);
    }
    return Array.from(byConversation.values());
  }, [attachedEmails]);
  const emailOriginAttachedEmail = nodeAttachedEmails.find((email) => email.createdFromEmail) ?? null;
  const emailOriginChatBlockID = emailOriginAttachedEmail?.id.trim() ?? "";
  const emailOriginNode = Boolean(emailOriginChatBlockID);
  const nodeFileAttachments = useMemo(() => filterMangoResourceAttachments(nodeResourceAttachments, {
    relationshipKind: "file_attachment",
  }), [nodeResourceAttachments]);
  const nodeTextBlockAttachmentsByInformationID = useMemo(() => groupMangoResourceAttachmentsByInformationID(
    filterMangoResourceAttachments(nodeFileAttachments, { editorSurface: "node_text_block" }),
  ), [nodeFileAttachments]);
  const textBlockTitleByID = useMemo(() => new Map(blocks.map((block) => [block.id, block.title.trim() || "Text box"])), [blocks]);
  const nodeAttachmentDropdownItems = useMemo(() => nodeFileAttachments.map((resourceAttachment) => {
    return {
      resourceAttachment,
      contextLabel: textBlockAttachmentContextLabel(resourceAttachment.information_id, textBlockTitleByID),
    };
  }), [nodeFileAttachments, textBlockTitleByID]);
  const nodeAttachmentUploadDropdownItems = useMemo(() => {
    const completedAttachmentIDs = new Set(nodeFileAttachments.map((item) => item.attachment_id.trim()).filter(Boolean));
    return visibleNodeAttachmentUploads(nodeAttachmentUploads, completedAttachmentIDs);
  }, [nodeAttachmentUploads, nodeFileAttachments]);
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
  const logicGateSearchTreeRows = useMemo(() => (
    buildCompanyExplorerSearchTreeRows(logicGateSearchResults.filter((result) => (
      result.resource_type === "folder" || result.resource_type === "logic_gate"
    )))
  ), [logicGateSearchResults]);
  const logicGateLabelByID = useMemo(() => {
    const labels = new Map<string, string>();
    for (const logicGate of assignedLogicGateRecords) {
      if (!logicGate.logic_gate_id || labels.has(logicGate.logic_gate_id)) continue;
      labels.set(logicGate.logic_gate_id, logicGateOptionLabel(logicGate));
    }
    for (const result of logicGateSearchResults) {
      if (result.resource_type !== "logic_gate") continue;
      const logicGateID = (result.resource_id || result.entity_id).trim();
      if (!logicGateID || labels.has(logicGateID)) continue;
      labels.set(logicGateID, humanLabelOrFallback(result.display_name, humanLabelOrFallback(logicGateID, "Logic Gate")));
    }
    return labels;
  }, [assignedLogicGateRecords, logicGateSearchResults]);
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
  const sortedNodeProjectRelationships = useMemo(() => (
    [...nodeProjectRelationships].sort((a, b) => (
      (b.relationship_updated_timestamp ?? "").localeCompare(a.relationship_updated_timestamp ?? "")
      || projectRelationshipLabel(a).localeCompare(projectRelationshipLabel(b), undefined, { numeric: true, sensitivity: "base" })
    ))
  ), [nodeProjectRelationships]);
  const primaryAssignedProject = sortedNodeProjectRelationships[0] ?? null;
  const primaryAssignedProjectID = primaryAssignedProject?.project_id?.trim() ?? "";
  const primaryAssignedProjectLabel = primaryAssignedProject ? projectRelationshipLabel(primaryAssignedProject) : "";
  const assignProjectButtonLabel = primaryAssignedProject
    ? `Project: ${primaryAssignedProjectLabel}`
    : "Assign to Project";
  const projectAssignerMenuWidth = Math.max(
    280,
    Math.min(compact ? 320 : 390, width > 0 ? width - 28 : compact ? 320 : 390),
  );
  const nodePriorityUnassignedForLogicGate = useMemo(() => {
    const raw = nodePriorityDraft.trim();
    if (!raw || raw === "0") return true;
    const parsed = Number(raw);
    return !Number.isInteger(parsed) || parsed < 1 || parsed > 5;
  }, [nodePriorityDraft]);
  const logicGateSearchQuery = logicGateSearch.trim();
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
  const focusTargetBlockID = useMemo(() => {
    const targetID = focusInformationID?.trim() ?? "";
    const emailMessageID = focusEmailMessageID?.trim() ?? "";
    if (!targetID && !emailMessageID) return "";
    if (blocks.some((block) => block.id === targetID)) return targetID;
    const chatMessage = chatMessages.find((message) => message.id === targetID);
    if (chatMessage) {
      return chatMessage.blockID === emailOriginChatBlockID ? blocks[0]?.id ?? "" : chatMessage.blockID;
    }
    const contentChange = unseenChanges.find((change) => change.change_id === targetID && change.node_id === nodeID);
    if (contentChange?.information_id) return contentChange.information_id;
    const attachedEmail = nodeAttachedEmails.find((email) => email.id === targetID || email.messageID === targetID || email.messageID === emailMessageID);
    if (attachedEmail) {
      const linkedBlock = blocks.find((block) => block.emailMessageID === attachedEmail.messageID)
        ?? (attachedEmail.blockID ? blocks.find((block) => block.id === attachedEmail.blockID) : undefined);
      return linkedBlock?.id ?? blocks[0]?.id ?? "";
    }
    if (emailMessageID) return blocks.find((block) => block.emailMessageID === emailMessageID)?.id ?? blocks[0]?.id ?? "";
    return "";
  }, [blocks, chatMessages, emailOriginChatBlockID, focusEmailMessageID, focusInformationID, nodeAttachedEmails, nodeID, unseenChanges]);
  const focusTargetIndex = useMemo(
    () => focusTargetBlockID ? blocks.findIndex((block) => block.id === focusTargetBlockID) : -1,
    [blocks, focusTargetBlockID],
  );
  const pinnedRowIndices = useMemo(() => {
    const indices = new Set<number>();
    if (focusedTextBlockID) {
      const focusedIndex = blocks.findIndex((block) => block.id === focusedTextBlockID);
      if (focusedIndex >= 0) indices.add(focusedIndex);
    }
    if (activeChatBlockID) {
      const chatIndex = activeChatBlockID === emailOriginChatBlockID
        ? (blocks.length > 0 ? 0 : -1)
        : blocks.findIndex((block) => block.id === activeChatBlockID);
      if (chatIndex >= 0) indices.add(chatIndex);
    }
    if (activeRowBlockID) {
      const activeRowIndex = blocks.findIndex((block) => block.id === activeRowBlockID);
      if (activeRowIndex >= 0) indices.add(activeRowIndex);
    }
    if (emailReplyBlockID) {
      const replyRowIndex = blocks.findIndex((block) => block.id === emailReplyBlockID);
      if (replyRowIndex >= 0) indices.add(replyRowIndex);
    }
    return Array.from(indices);
  }, [activeChatBlockID, activeRowBlockID, blocks, emailOriginChatBlockID, emailReplyBlockID, focusedTextBlockID]);
  const rowVirtualizer = useBoundedEditorRowVirtualization({
    itemCount: blocks.length,
    rowHeight: TEXT_BLOCK_ROW_HEIGHT,
    rowGap: TEXT_BLOCK_ROW_GAP,
    scrollElementRef: rootRef,
    targetIndex: focusTargetIndex >= 0 ? focusTargetIndex : null,
    targetRequestKey: `${nodeID}:${focusInformationID ?? ""}:${focusEmailMessageID ?? ""}:${focusRequestID ?? 0}`,
    pinnedIndices: pinnedRowIndices,
  });

  const refreshNodeAttachments = useCallback(() => {
    invalidateMangoResourceAttachmentsCache(requestJSON, {
      apiBase,
      companyID,
      resourceType: "node",
      resourceID: nodeID,
    });
    setNodeAttachmentsRefreshKey((key) => key + 1);
  }, [apiBase, companyID, nodeID, requestJSON]);

  const removeNodeAttachment = useCallback(async (resourceAttachment: MangoResourceAttachment) => {
    if (!canEdit) return;
    const attachmentID = resourceAttachment.attachment_id?.trim();
    if (!attachmentID) {
      onError("attachment_metadata_unavailable");
      return;
    }
    try {
      await unlinkMangoResourceAttachment(requestJSON, {
        companyID,
        resourceType: "node",
        resourceID: nodeID,
        attachmentID,
      });
      setNodeResourceAttachments((current) => current.filter((item) => item.attachment_id !== attachmentID));
      refreshNodeAttachments();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_remove_attachment");
    }
  }, [canEdit, companyID, nodeID, onError, refreshNodeAttachments, requestJSON]);

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

  const goToAssignedProject = useCallback(() => {
    const projectID = primaryAssignedProjectID.trim();
    if (!projectID) return;
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
      companyID,
      sourceFrameID: "editor",
      kind: "project",
      id: projectID,
      label: primaryAssignedProjectLabel || projectID,
      nodeID,
      selectedTreeID: `project-${projectID}`,
      changedAt: Date.now(),
    });
  }, [companyID, nodeID, primaryAssignedProjectID, primaryAssignedProjectLabel]);

  useLayoutEffect(() => {
    const generation = attachmentUploadScopeRef.current.generation + 1;
    attachmentUploadScopeRef.current = { companyID, nodeID, canEdit, generation };
    setNodeAttachmentUploads([]);
    return () => {
      if (attachmentUploadScopeRef.current.generation !== generation) return;
      attachmentUploadScopeRef.current = { companyID: "", nodeID: "", canEdit: false, generation: generation + 1 };
      for (const upload of nodeAttachmentUploadFilesRef.current.values()) upload.controller?.abort();
      nodeAttachmentUploadFilesRef.current.clear();
    };
  }, [canEdit, companyID, nodeID]);

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
    setProjectAssignerOpen(false);
    setNodeEmailModalMessageID("");
    setLogicGateSearch("");
    setAssigningLogicGateID("");
    setLastAssignedLogicGateID("");
    setLastAssignedLogicGateLabel("");
    setLogicGateAssignStatus("");
    setLogicGateAssignFlash("");
    setSelectedProjectForAssignment(null);
    setProjectLogicGateOptions([]);
    setProjectAssignStatus("");
    setAssigningProjectID("");
    setAssigningProjectLogicGateID("");
  }, [nodeID]);

  useEffect(() => {
    if (!companyID.trim() || !nodeID.trim()) {
      setNodeResourceAttachments([]);
      setNodeAttachmentsLoading(false);
      setNodeAttachmentsLoadError("");
      return undefined;
    }
    let cancelled = false;
    setNodeAttachmentsLoading(true);
    setNodeAttachmentsLoadError("");
    void listMangoResourceAttachments(requestJSON, {
      apiBase,
      companyID,
      resourceType: "node",
      resourceID: nodeID,
    })
      .then((payload) => {
        if (!cancelled) setNodeResourceAttachments(payload.attachments ?? []);
      })
      .catch((cause) => {
        if (cancelled) return;
        if (isAbortError(cause)) return;
        const message = cause instanceof Error ? cause.message : "failed_to_load_attachments";
        setNodeResourceAttachments([]);
        setNodeAttachmentsLoadError(message);
        onError(message);
      })
      .finally(() => {
        if (!cancelled) setNodeAttachmentsLoading(false);
      });
    return () => { cancelled = true; };
  }, [apiBase, companyID, nodeAttachmentsRefreshKey, nodeID, onError, requestJSON]);

  useEffect(() => {
    if (canEdit) return;
    setLogicGateAssignerOpen(false);
    setProjectAssignerOpen(false);
    setEmailPickerTargetBlockID(null);
    setDropActive(false);
    setDeleteTextBlockConfirmation(null);
  }, [canEdit]);


  useAppFloatingMenuDismissal(logicGateAssignerOpen, logicGateAssignerRef, () => setLogicGateAssignerOpen(false));

  useEffect(() => {
    if (logicGateAssignerOpen) return;
    setLogicGateSearch("");
    setLogicGateSearchResults([]);
    setLogicGateSearchLoading(false);
  }, [logicGateAssignerOpen]);

  useLayoutEffect(() => {
    if (!projectAssignerOpen) {
      setProjectAssignerDropdownLeft(0);
      return;
    }
    const updateDropdownLeft = () => {
      const anchor = projectAssignerRef.current;
      if (!anchor || typeof window === "undefined") {
        setProjectAssignerDropdownLeft(0);
        return;
      }
      const anchorBounds = anchor.getBoundingClientRect();
      const rootBounds = rootRef.current?.getBoundingClientRect();
      const visibleRight = Math.min(rootBounds?.right ?? window.innerWidth, window.innerWidth) - 14;
      const visibleLeft = Math.max(rootBounds?.left ?? 0, 0) + 14;
      const overflowRight = Math.max(0, anchorBounds.left + projectAssignerMenuWidth - visibleRight);
      const minLeft = visibleLeft - anchorBounds.left;
      const nextLeft = Math.round(Math.max(minLeft, -overflowRight));
      setProjectAssignerDropdownLeft((current) => (current === nextLeft ? current : nextLeft));
    };
    updateDropdownLeft();
    window.addEventListener("resize", updateDropdownLeft);
    return () => window.removeEventListener("resize", updateDropdownLeft);
  }, [projectAssignerMenuWidth, projectAssignerOpen, width]);

  useAppFloatingMenuDismissal(projectAssignerOpen, projectAssignerRef, () => setProjectAssignerOpen(false));

  useEffect(() => {
    if (!companyID || !nodeID) {
      setNodeProjectRelationships([]);
      return;
    }
    let cancelled = false;
    void listProjectRelationshipsForResource({ companyID, resourceType: "node", resourceID: nodeID })
      .then((payload) => {
        if (!cancelled) setNodeProjectRelationships(payload.relationships ?? []);
      })
      .catch((cause) => {
        if (!cancelled && !isAbortError(cause)) setNodeProjectRelationships([]);
      });
    return () => { cancelled = true; };
  }, [companyID, nodeID, projectRelationshipRefreshKey]);

  useEffect(() => {
    if (!projectAssignerOpen || !companyID) return;
    let cancelled = false;
    setProjectOptionsLoading(true);
    void listProjects(companyID)
      .then((payload) => {
        if (!cancelled) setProjectOptions(sortProjectOptions(payload.projects ?? []));
      })
      .catch((cause) => {
        if (!cancelled) onError(cause instanceof Error ? cause.message : "failed_to_load_projects");
      })
      .finally(() => {
        if (!cancelled) setProjectOptionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyID, onError, projectAssignerOpen]);

  useEffect(() => {
    const projectID = selectedProjectForAssignment?.project_id?.trim() ?? "";
    if (!projectAssignerOpen || !companyID || !projectID) {
      setProjectLogicGateOptions([]);
      setProjectLogicGatesLoading(false);
      return;
    }
    let cancelled = false;
    setProjectLogicGateOptions([]);
    setProjectLogicGatesLoading(true);
    const titleVersionAtStart = readCommittedEntityTitleVersion();
    void (async () => {
      const view = await fetchProjectView(companyID, projectID);
      if (cancelled) return;
      const logicGateIDs = Array.from(new Set((view.relationships ?? [])
        .filter((row) => row.resource_type === "logic_gate")
        .map((row) => row.resource_id.trim())
        .filter(Boolean)));
      const records = await Promise.all(logicGateIDs.map(async (logicGateID) => {
        try {
          const details = await getLogicGateRecordSingleFlight(apiBase, companyID, logicGateID);
          return details.logic_gate;
        } catch {
          return null;
        }
      }));
      if (!cancelled) {
        setProjectLogicGateOptions(foldCommittedEntityTitlesSince(
          sortLogicGateOptions(records.filter((record): record is LogicGateRecord => Boolean(record))),
          companyID,
          titleVersionAtStart,
          reconcileCommittedLogicGateRecordTitles,
        ));
      }
    })()
      .catch((cause) => {
        if (!cancelled) onError(cause instanceof Error ? cause.message : "failed_to_load_project_logic_gates");
      })
      .finally(() => {
        if (cancelled) return;
        setProjectLogicGatesLoading(false);
      });
    return () => { cancelled = true; };
  }, [apiBase, companyID, onError, projectAssignerOpen, selectedProjectForAssignment?.project_id]);

  useEffect(() => {
    const layout = readStoredTextPaneLayout(companyID, nodeID);
    paneLayoutReadyScopeRef.current = "";
    setSelectedEmailIDsByBlock(layout.selectedEmailIDsByBlock);
    setOpenEditorBlockIDs(new Set(layout.openEditorBlockIDs));
    setOpenEmailBlockIDs(new Set(layout.openEmailBlockIDs));
    setOpenChatBlockIDs(new Set(layout.openChatBlockIDs));
    setClosedChatBlockIDs(new Set(layout.closedChatBlockIDs));
    setClosedEditorBlockIDs(new Set(layout.closedEditorBlockIDs));
    setClosedEmailBlockIDs(new Set(layout.closedEmailBlockIDs));
    setActiveChatBlockID(layout.activeChatBlockID ?? "");
  }, [companyID, nodeID]);

  useEffect(() => {
    for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer);
    saveTimersRef.current.clear();
    contentByBlockRef.current = new Map();
  }, [companyID, nodeID]);

  useEffect(() => {
    if (paneLayoutReadyScopeRef.current !== paneLayoutScope) return;
    storeTextPaneLayout(companyID, nodeID, {
      initialized: true,
      openEditorBlockIDs: Array.from(openEditorBlockIDs),
      openEmailBlockIDs: Array.from(openEmailBlockIDs),
      openChatBlockIDs: Array.from(openChatBlockIDs),
      closedEditorBlockIDs: Array.from(closedEditorBlockIDs),
      closedEmailBlockIDs: Array.from(closedEmailBlockIDs),
      closedChatBlockIDs: Array.from(closedChatBlockIDs),
      selectedEmailIDsByBlock,
      activeChatBlockID,
    });
  }, [activeChatBlockID, closedChatBlockIDs, closedEditorBlockIDs, closedEmailBlockIDs, companyID, nodeID, openChatBlockIDs, openEditorBlockIDs, openEmailBlockIDs, paneLayoutScope, selectedEmailIDsByBlock]);

  useEffect(() => {
    const serverRevisionByInformationID = new Map(loadedTextBlockProjections.map((item) => [item.information_id, item.revision ?? 1]));
    const textBlocks = loadedTextBlockProjections.map((item) => {
      const content = parseEditorTextBlockContent(item.information);
      return {
        id: item.information_id,
        title: content.title,
        document: content.document,
        attachments: content.attachments ?? [],
        emailMessageID: content.emailMessageID,
        emailAccent: content.emailAccent,
        createdTimestamp: item.created_timestamp,
        updatedTimestamp: item.updated_timestamp,
        pending: false,
      };
    });
    const parsedAttachedEmails = parseEditorAttachedEmails(projections);
    const parsedChatMessages = parseEditorTextBlockChats(projections);
    if (textBlockProjectionSaveController.hasAnyChangedOrSaveInProgress()) {
      setChatMessages(parsedChatMessages);
      setAttachedEmails(parsedAttachedEmails);
      return;
    }
    setBlocks(textBlocks);
    contentByBlockRef.current = new Map(textBlocks.map((block) => [block.id, { title: block.title, document: block.document, attachments: block.attachments, emailMessageID: block.emailMessageID, emailAccent: block.emailAccent }]));
    textBlockProjectionSaveController.replaceBlocksAsHasNotChanged(textBlocks.map((block) => ({
      blockID: block.id,
      content: { title: block.title, document: block.document, attachments: block.attachments, emailMessageID: block.emailMessageID, emailAccent: block.emailAccent },
      revision: serverRevisionByInformationID.get(block.id) ?? 0,
    })));
    setChatMessages(parsedChatMessages);
    setAttachedEmails(parsedAttachedEmails);
    const nodeChanged = loadedNodeScopeRef.current !== paneLayoutScope;
    const blockIDs = new Set(textBlocks.map((block) => block.id));
    const emailOriginChatID = parsedAttachedEmails.find((email) => email.createdFromEmail)?.id.trim() ?? "";
    const chatBlockIDs = new Set(blockIDs);
    if (emailOriginChatID) chatBlockIDs.add(emailOriginChatID);
    const defaultChatBlockIDs = textBlocks.map((block, index) => index === 0 && emailOriginChatID ? emailOriginChatID : block.id);
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
    setChatComposerFocusRequestIDs((current) => (nodeChanged ? {} : Object.fromEntries(Object.entries(current).filter(([id]) => blockIDs.has(id)))));
    setSidePaneWidths((current) => (nodeChanged ? {} : Object.fromEntries(Object.entries(current).filter(([id]) => blockIDs.has(id)))));
    setActiveChatMessageIDs((current) => {
      if (nodeChanged) return {};
      return Object.fromEntries(Object.entries(current).filter(([blockID, messageID]) => Boolean(messageIDsByBlock.get(blockID)?.has(messageID))));
    });
    setChatMessageFocusRequest((current) => (
      !current || (!nodeChanged && Boolean(messageIDsByBlock.get(current.blockID)?.has(current.messageID))) ? current : null
    ));
    if (projectionsLoaded) {
      const storedLayout = nodeChanged ? readStoredTextPaneLayout(companyID, nodeID) : null;
      const validClosedEditorBlockIDs = new Set((nodeChanged
        ? storedLayout?.closedEditorBlockIDs ?? []
        : Array.from(closedEditorBlockIDs)).filter((id) => blockIDs.has(id)));
      const validClosedEmailBlockIDs = new Set((nodeChanged
        ? storedLayout?.closedEmailBlockIDs ?? []
        : Array.from(closedEmailBlockIDs)).filter((id) => id === NODE_EMAIL_COLUMN_LAYOUT_ID));
      const validClosedChatBlockIDs = new Set((nodeChanged
        ? storedLayout?.closedChatBlockIDs ?? []
        : Array.from(closedChatBlockIDs)).filter((id) => chatBlockIDs.has(id)));
      const hasAttachedEmails = parsedAttachedEmails.length > 0;

      setActiveChatBlockID((current) => {
        const candidate = nodeChanged ? storedLayout?.activeChatBlockID ?? "" : current;
        return chatBlockIDs.has(candidate) ? candidate : "";
      });
      setSelectedEmailIDsByBlock((current) => Object.fromEntries(Object.entries(current).filter(([blockID, messageID]) => blockID === NODE_EMAIL_COLUMN_LAYOUT_ID && parsedAttachedEmails.some((email) => email.messageID === messageID))));
      setClosedEditorBlockIDs(validClosedEditorBlockIDs);
      setClosedEmailBlockIDs(validClosedEmailBlockIDs);
      setClosedChatBlockIDs(validClosedChatBlockIDs);
      setOpenEditorBlockIDs((current) => {
        const next = new Set((nodeChanged ? storedLayout?.openEditorBlockIDs ?? [] : Array.from(current)).filter((id) => blockIDs.has(id)));
        for (const blockID of blockIDs) {
          if (!validClosedEditorBlockIDs.has(blockID)) next.add(blockID);
        }
        return next;
      });
      setOpenEmailBlockIDs((current) => {
        const next = new Set((nodeChanged ? storedLayout?.openEmailBlockIDs ?? [] : Array.from(current)).filter((id) => id === NODE_EMAIL_COLUMN_LAYOUT_ID));
        if (hasAttachedEmails && !validClosedEmailBlockIDs.has(NODE_EMAIL_COLUMN_LAYOUT_ID)) next.add(NODE_EMAIL_COLUMN_LAYOUT_ID);
        return next;
      });
      setOpenChatBlockIDs((current) => {
        const next = new Set((nodeChanged ? storedLayout?.openChatBlockIDs ?? [] : Array.from(current)).filter((id) => chatBlockIDs.has(id)));
        for (const blockID of defaultChatBlockIDs) {
          if (!validClosedChatBlockIDs.has(blockID)) next.add(blockID);
        }
        return next;
      });
      loadedNodeScopeRef.current = paneLayoutScope;
      paneLayoutReadyScopeRef.current = paneLayoutScope;
    }
    setFocusedTextBlockID((current) => {
      if (nodeChanged || current === null) return "";
      return blockIDs.has(current) ? current : "";
    });
  }, [companyID, loadedTextBlockProjections, nodeID, paneLayoutScope, projectionIdentity, projections, projectionsLoaded, textBlockProjectionSaveController]);

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
    const titleVersionAtStart = readCommittedEntityTitleVersion();
    void Promise.all(ids.map(async (logicGateID) => {
      try {
        const details = await getLogicGateRecordSingleFlight(apiBase, companyID, logicGateID);
        return details.logic_gate;
      } catch {
        return null;
      }
    })).then((records) => {
      if (!cancelled) setAssignedLogicGateRecords(foldCommittedEntityTitlesSince(
        records.filter((record): record is LogicGateRecord => Boolean(record)),
        companyID,
        titleVersionAtStart,
        reconcileCommittedLogicGateRecordTitles,
      ));
    });
    return () => { cancelled = true; };
  }, [apiBase, assignedLogicGateIDs, companyID]);
  useEffect(() => {
    const query = logicGateSearch.trim();
    if (!logicGateAssignerOpen || !companyID || !query) {
      setLogicGateSearchResults([]);
      setLogicGateSearchLoading(false);
      return;
    }
    const requestID = logicGateSearchRequestRef.current + 1;
    logicGateSearchRequestRef.current = requestID;
    let cancelled = false;
    setLogicGateSearchLoading(true);
    const timer = window.setTimeout(() => {
      const titleVersionAtStart = readCommittedEntityTitleVersion();
      void fetchCompanyExplorerSearchResults(apiBase, companyID, query, 24, ["folder", "logic_gate"])
        .then((payload) => {
          if (!cancelled && logicGateSearchRequestRef.current === requestID) setLogicGateSearchResults(foldCommittedEntityTitlesSince(
            payload.results ?? [],
            companyID,
            titleVersionAtStart,
            reconcileCompanyExplorerSearchResultTitles,
          ));
        })
        .catch((cause) => {
          if (!cancelled && logicGateSearchRequestRef.current === requestID) onError(cause instanceof Error ? cause.message : "failed_to_search_logic_gates");
        })
        .finally(() => {
          if (!cancelled && logicGateSearchRequestRef.current === requestID) setLogicGateSearchLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiBase, companyID, logicGateAssignerOpen, logicGateSearch, onError]);

  useEffect(() => () => {
    if (logicGateAssignStatusTimerRef.current !== null) window.clearTimeout(logicGateAssignStatusTimerRef.current);
    if (logicGateAssignFlashTimerRef.current !== null) window.clearTimeout(logicGateAssignFlashTimerRef.current);
    for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer);
    saveTimersRef.current.clear();
    void textBlockProjectionSaveController.flushChangedBlocks().catch(() => undefined);
  }, [textBlockProjectionSaveController]);

  useEffect(() => {
    if (!focusBlockIDRef.current) return;
    if (!canEdit) {
      focusBlockIDRef.current = "";
      return;
    }
    const blockID = focusBlockIDRef.current;
    focusBlockIDRef.current = "";
    const blockIndex = blocks.findIndex((block) => block.id === blockID);
    if (blockIndex >= 0) rowVirtualizer.mountAndScrollToIndex(blockIndex);
    window.requestAnimationFrame(() => {
      const editor = rootRef.current?.querySelector<HTMLElement>(`[data-node-text-block-id="${blockID}"]`);
      editor?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      focusContentEditableAtEnd(editor ?? null);
    });
  }, [blocks, canEdit, rowVirtualizer.mountAndScrollToIndex]);

  const saveTextBlockProjection = useCallback(async (blockID: string, content: EditorTextBlockContent, baseRevision: number) => {
    if (!canEdit || !nodeID || !companyID || !author.userID) throw new Error("failed_to_save_text_block_metadata");
    const response = await requestJSON<{ projection_revision?: number }>(
      `/v1/editor-collaboration/node/${nodeID}/documents/${blockID}?company_id=${encodeURIComponent(companyID)}`,
      {
        method: "PATCH",
        body: JSON.stringify(buildEditorTextBlockMetadataPayload(content)),
      },
    );
    const revision = response?.projection_revision ?? 0;
    if (!Number.isInteger(revision) || revision <= baseRevision) throw new Error("invalid_projection_revision_ack");
    onProjectionMutation();
    return { revision };
  }, [author.userID, canEdit, companyID, nodeID, onProjectionMutation, requestJSON]);

  const setTextBlockSaveInProgress = useCallback((blockID: string, saveInProgress: boolean) => {
    setBlocks((current) => current.map((block) => block.id === blockID ? { ...block, pending: saveInProgress } : block));
  }, []);

  useEffect(() => {
    textBlockProjectionSaveController.configure({
      saveBlock: ({ blockID, content, baseRevision }) => saveTextBlockProjection(blockID, content, baseRevision),
      onBlockSaveInProgressChange: setTextBlockSaveInProgress,
      onSaveError: (_blockID, cause) => onError(cause instanceof Error ? cause.message : "failed_to_save_text_block_metadata"),
    });
  }, [onError, saveTextBlockProjection, setTextBlockSaveInProgress, textBlockProjectionSaveController]);

  const flushAllTextBlockProjectionSaves = useCallback(async () => {
    if (!canEdit) return;
    for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer);
    saveTimersRef.current.clear();
    await textBlockProjectionSaveController.flushChangedBlocks();
  }, [canEdit, textBlockProjectionSaveController]);

  useEffect(() => {
    if (!onRegisterSaveController) return undefined;
    onRegisterSaveController({ flushPendingProjectionSaves: flushAllTextBlockProjectionSaves });
    return () => onRegisterSaveController(null);
  }, [flushAllTextBlockProjectionSaves, onRegisterSaveController]);

  const scheduleTextBlockSave = useCallback((blockID: string, content: EditorTextBlockContent) => {
    if (!editorTextCanEdit) return;
    contentByBlockRef.current.set(blockID, content);
    textBlockProjectionSaveController.markHasChanged(blockID, content);
    const existingTimer = saveTimersRef.current.get(blockID);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(blockID);
      textBlockProjectionSaveController.startLatestContentSave(blockID);
    }, EDITOR_AUTOSAVE_DELAY_MS);
    saveTimersRef.current.set(blockID, timer);
  }, [editorTextCanEdit, textBlockProjectionSaveController]);

  const createTextBlock = useCallback(() => {
    if (!editorTextCanEdit) return;
    const now = new Date().toISOString();
    const blockID = generateStableInformationID();
    const initialContent: EditorTextBlockContent = { title: DEFAULT_TEXT_BLOCK_TITLE, document: "", attachments: [] };
    focusBlockIDRef.current = blockID;
    contentByBlockRef.current.set(blockID, initialContent);
    textBlockProjectionSaveController.markHasChanged(blockID, initialContent);
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
    setClosedEditorBlockIDs((current) => {
      const next = new Set(current);
      next.delete(blockID);
      return next;
    });
    setClosedChatBlockIDs((current) => {
      const next = new Set(current);
      next.delete(blockID);
      return next;
    });
    setOpenEditorBlockIDs((current) => new Set(current).add(blockID));
    setOpenChatBlockIDs((current) => new Set(current).add(blockID));
    textBlockProjectionSaveController.startLatestContentSave(blockID);
  }, [editorTextCanEdit, textBlockProjectionSaveController]);

  const createEmailTextBlock = useCallback((messageID: string, quote = "") => {
    const cleanMessageID = messageID.trim();
    if (!editorTextCanEdit || !cleanMessageID) return "";
    const now = new Date().toISOString();
    const blockID = generateStableInformationID();
    const sourceEmail = nodeAttachedEmails.find((email) => email.messageID === cleanMessageID || email.id === cleanMessageID);
    const emailAccent = editorEmailMessageAccent(cleanMessageID);
    const cleanQuote = quote.trim();
    const initialContent: EditorTextBlockContent = {
      title: sourceEmail?.subject.trim() ? `Email: ${sourceEmail.subject.trim()}` : "Email text box",
      document: cleanQuote && typeof document !== "undefined" ? createEmailSelectionDocument(document, cleanQuote) : "",
      attachments: [],
      emailMessageID: cleanMessageID,
      emailAccent,
    };
    focusBlockIDRef.current = blockID;
    contentByBlockRef.current.set(blockID, initialContent);
    textBlockProjectionSaveController.markHasChanged(blockID, initialContent);
    setBlocks((current) => [{
      id: blockID,
      title: initialContent.title,
      document: initialContent.document,
      attachments: [],
      emailMessageID: cleanMessageID,
      emailAccent,
      createdTimestamp: now,
      updatedTimestamp: now,
      pending: true,
    }, ...current]);
    setClosedEditorBlockIDs((current) => {
      const next = new Set(current);
      next.delete(blockID);
      return next;
    });
    setClosedChatBlockIDs((current) => {
      const next = new Set(current);
      next.delete(blockID);
      return next;
    });
    setOpenEditorBlockIDs((current) => new Set(current).add(blockID));
    setOpenChatBlockIDs((current) => new Set(current).add(blockID));
    setActiveRowBlockID(blockID);
    setFocusedTextBlockID(blockID);
    textBlockProjectionSaveController.startLatestContentSave(blockID);
    return blockID;
  }, [editorTextCanEdit, nodeAttachedEmails, textBlockProjectionSaveController]);

  useEffect(() => {
    if (!shouldCreateInitialTextBlock({
      canEdit,
      projectionsLoaded,
      nodeID,
      editorSequence,
      loadedTextBlockCount: loadedTextBlockProjections.length,
      renderedTextBlockCount: blocks.length,
    })) return;
    if (autoCreatedTextBlockNodeIDsRef.current.has(nodeID)) return;
    autoCreatedTextBlockNodeIDsRef.current.add(nodeID);
    createTextBlock();
  }, [blocks.length, canEdit, createTextBlock, editorSequence, loadedTextBlockProjections.length, nodeID, projectionsLoaded]);

  const updateTextBlockContent = useCallback((blockID: string, patch: Partial<EditorTextBlockContent>) => {
    if (!canEdit) return;
    const existing = contentByBlockRef.current.get(blockID) ?? { title: "", document: "", attachments: [] };
    const nextContent: EditorTextBlockContent = {
      title: patch.title ?? existing.title,
      document: patch.document ?? existing.document,
      attachments: patch.attachments ?? existing.attachments ?? [],
      emailMessageID: patch.emailMessageID ?? existing.emailMessageID,
      emailAccent: patch.emailAccent ?? existing.emailAccent,
    };
    setBlocks((current) => current.map((block) => {
      if (block.id !== blockID) return block;
      return { ...block, ...nextContent, updatedTimestamp: new Date().toISOString() };
    }));
    if (patch.title !== undefined || patch.attachments !== undefined || patch.emailMessageID !== undefined || patch.emailAccent !== undefined) scheduleTextBlockSave(blockID, nextContent);
  }, [canEdit, scheduleTextBlockSave]);

  useEffect(() => {
    if (!editorTextCanEdit || !emailOriginAttachedEmail) return;
    const primaryBlock = blocks[0];
    if (!primaryBlock || primaryBlock.emailMessageID?.trim()) return;
    updateTextBlockContent(primaryBlock.id, {
      emailMessageID: emailOriginAttachedEmail.messageID,
      emailAccent: editorEmailMessageAccent(emailOriginAttachedEmail.messageID),
      title: primaryBlock.title === DEFAULT_TEXT_BLOCK_TITLE && emailOriginAttachedEmail.subject.trim()
        ? `Email: ${emailOriginAttachedEmail.subject.trim()}`
        : primaryBlock.title,
    });
  }, [blocks, editorTextCanEdit, emailOriginAttachedEmail, updateTextBlockContent]);

  const appendTextBlockAttachments = useCallback((blockID: string, attachments: EditorChatAttachment[]) => {
    if (!canEdit || attachments.length === 0) return;
    const latest = contentByBlockRef.current.get(blockID);
    if (!latest) return;
    const latestAttachments = latest.attachments ?? [];
    const mergedAttachments = appendUniqueEditorAttachments(latestAttachments, attachments);
    if (mergedAttachments.length === latestAttachments.length) return;
    updateTextBlockContent(blockID, { attachments: mergedAttachments });
  }, [canEdit, updateTextBlockContent]);

  const uploadNodeAttachmentItem = useCallback(async (
    uploadID: string,
    uploadScope: NodeAttachmentUploadScope,
  ): Promise<EditorChatAttachment> => {
    const pending = nodeAttachmentUploadFilesRef.current.get(uploadID);
    if (!pending) throw new Error("attachment_upload_file_unavailable");
    if (pending.controller) throw new Error("attachment_upload_already_running");
    const controller = new AbortController();
    nodeAttachmentUploadFilesRef.current.set(uploadID, { ...pending, controller });
    const uploadStillBelongsToCurrentNode = () => nodeAttachmentUploadScopeMatches(uploadScope, attachmentUploadScopeRef.current);
    let succeeded = false;
    try {
      const attachment = await uploadEditorAttachment(pending.file, {
        requestJSON,
        companyID: uploadScope.companyID,
        resourceType: "node",
        resourceID: uploadScope.nodeID,
        sourceKind: "user_upload",
        relationshipKind: "file_attachment",
        informationID: pending.blockID,
        editorSurface: "node_text_block",
        signal: controller.signal,
        onProgress: (progress: MangoAttachmentUploadProgress) => {
          if (!uploadStillBelongsToCurrentNode()) return;
          setNodeAttachmentUploads((current) => current.map((item) => (
            item.id === uploadID ? { ...item, progress } : item
          )));
        },
      });
      succeeded = true;
      if (uploadStillBelongsToCurrentNode()) {
        appendTextBlockAttachments(pending.blockID, [attachment]);
        setNodeAttachmentUploads((current) => current.map((item) => (
          item.id === uploadID ? { ...item, attachmentID: attachment.attachmentID } : item
        )));
        refreshNodeAttachments();
      }
      return attachment;
    } finally {
      const latest = nodeAttachmentUploadFilesRef.current.get(uploadID);
      if (succeeded) nodeAttachmentUploadFilesRef.current.delete(uploadID);
      else if (latest?.controller === controller) nodeAttachmentUploadFilesRef.current.set(uploadID, { ...latest, controller: undefined });
    }
  }, [appendTextBlockAttachments, refreshNodeAttachments, requestJSON]);

  const addTextBlockAttachments = useCallback(async (blockID: string, files: FileList | File[]) => {
    if (!canEdit) return;
    const incoming = Array.from(files);
    if (incoming.length === 0) return;
    const uploadScope = attachmentUploadScopeRef.current;
    const uploadStillBelongsToCurrentNode = () => nodeAttachmentUploadScopeMatches(uploadScope, attachmentUploadScopeRef.current);
    const scheduled = incoming.map((file) => {
      const id = generateStableInformationID();
      nodeAttachmentUploadFilesRef.current.set(id, { file, blockID });
      return { id, file };
    });
    const initialUploads: AttachmentUploadDropdownItem[] = scheduled.map(({ id, file }) => ({
      id,
      filename: file.name || "attachment",
      size: file.size,
      progress: {
        state: "preparing",
        bytesUploaded: 0,
        bytesPrepared: 0,
        totalBytes: file.size,
        fraction: 0,
      },
    }));
    setNodeAttachmentUploads((current) => [...current, ...initialUploads]);
    const uploadResults = await Promise.allSettled(scheduled.map(({ id }) => uploadNodeAttachmentItem(id, uploadScope)));
    const uploadedAttachments = uploadResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failures = uploadResults.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0 && uploadStillBelongsToCurrentNode()) {
      const firstFailureMessage = failures[0]?.reason instanceof Error ? failures[0].reason.message : "failed_to_upload_attachment";
      const summary = uploadedAttachments.length > 0
        ? `${uploadedAttachments.length} ${uploadedAttachments.length === 1 ? "attachment" : "attachments"} uploaded; ${failures.length} failed.`
        : `${failures.length} ${failures.length === 1 ? "attachment" : "attachments"} failed to upload.`;
      onError(firstFailureMessage === "failed_to_upload_attachment" ? summary : `${summary} ${firstFailureMessage}`);
    }
  }, [canEdit, companyID, nodeID, onError, uploadNodeAttachmentItem]);

  const cancelNodeAttachmentUpload = useCallback((uploadID: string) => {
    nodeAttachmentUploadFilesRef.current.get(uploadID)?.controller?.abort();
  }, []);

  const retryNodeAttachmentUpload = useCallback((uploadID: string) => {
    const upload = nodeAttachmentUploadFilesRef.current.get(uploadID);
    if (!upload || upload.controller || !attachmentUploadScopeRef.current.canEdit) return;
    const uploadScope = attachmentUploadScopeRef.current;
    setNodeAttachmentUploads((current) => current.map((item) => item.id === uploadID ? {
      ...item,
      progress: {
        state: "preparing",
        bytesUploaded: 0,
        bytesPrepared: 0,
        totalBytes: upload.file.size,
        fraction: 0,
      },
    } : item));
    void uploadNodeAttachmentItem(uploadID, uploadScope).catch((cause) => {
      if (cause instanceof Error && cause.name === "AbortError") return;
      onError(cause instanceof Error ? cause.message : "failed_to_upload_attachment");
    });
  }, [onError, uploadNodeAttachmentItem]);

  const deleteTextBlock = useCallback(async (blockID: string) => {
    if (!canEdit || !nodeID || !companyID) return;
    const timer = saveTimersRef.current.get(blockID);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      saveTimersRef.current.delete(blockID);
    }
    let snapshot;
    try {
      snapshot = await textBlockProjectionSaveController.waitForInProgressSave(blockID);
    } catch {
      return;
    }
    if (!snapshot) return;
    // Attached-email projections and resource attachment links are node-owned and intentionally retained.
    const deletedInformationIDs = projectionIDsForTextBlockDeletion(blockID, chatMessages);
    try {
      for (const informationID of deletedInformationIDs) {
        try {
          if (informationID === blockID) {
            await requestJSON<unknown>(`/v1/editor-collaboration/node/${nodeID}/documents/${blockID}?company_id=${encodeURIComponent(companyID)}`, {
              method: "DELETE",
              body: JSON.stringify({ operation_id: generateStableInformationID(), client_id: `node-delete:${author.userID}` }),
            });
          } else {
            await requestJSON<unknown>(`/v1/nodes/${nodeID}/projection/${informationID}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
          }
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "";
          if (!message.includes("node_projection_not_found") && !message.includes("editor_document_not_found")) throw cause;
        }
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_delete_text_block");
      return;
    }
    textBlockProjectionSaveController.removeBlock(blockID);
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
    setSelectedEmailIDsByBlock((current) => {
      if (!(blockID in current)) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
    const removeDeletedBlockID = (current: Set<string>) => {
      if (!current.has(blockID)) return current;
      const next = new Set(current);
      next.delete(blockID);
      return next;
    };
    setOpenEditorBlockIDs(removeDeletedBlockID);
    setOpenEmailBlockIDs(removeDeletedBlockID);
    setOpenChatBlockIDs(removeDeletedBlockID);
    setClosedEditorBlockIDs(removeDeletedBlockID);
    setClosedEmailBlockIDs(removeDeletedBlockID);
    setClosedChatBlockIDs(removeDeletedBlockID);
    setActiveChatBlockID((current) => current === blockID ? "" : current);
    setFocusedTextBlockID((current) => current === blockID ? "" : current);
    onProjectionMutation();
  }, [author.userID, canEdit, chatMessages, companyID, nodeID, onError, onProjectionMutation, requestJSON, textBlockProjectionSaveController]);


  const requestDeleteTextBlock = useCallback((blockID: string, position: ConfirmActionMenuPosition) => {
    if (!canEdit) return;
    const chatCount = chatMessages.filter((message) => message.blockID === blockID).length;
    setDeleteTextBlockConfirmation({
      blockID,
      title: "text box",
      chatCount,
      position,
    });
  }, [canEdit, chatMessages]);

  const openSelectionChat = useCallback((selection: TextBlockSelectionDraft, conversationBlockID = selection.blockID) => {
    if (!canEdit) return;
    const chatBlockID = conversationBlockID.trim() || selection.blockID;
    setFocusedTextBlockID("");
    setChatReplyTargets((current) => {
      if (!current[chatBlockID]) return current;
      const next = { ...current };
      delete next[chatBlockID];
      return next;
    });
    setChatSelectionAnchors((current) => ({ ...current, [chatBlockID]: selection }));
    setActiveChatMessageIDs((current) => {
      if (!current[chatBlockID]) return current;
      const next = { ...current };
      delete next[chatBlockID];
      return next;
    });
    setClosedChatBlockIDs((current) => {
      if (!current.has(chatBlockID)) return current;
      const next = new Set(current);
      next.delete(chatBlockID);
      return next;
    });
    setActiveChatBlockID(chatBlockID);
  }, [canEdit]);
  const navigateToChatMessage = useCallback((blockID: string, messages: EditorTextBlockChatMessage[], messageID: string) => {
    const anchorMessageID = resolveEditorTextBlockChatAnchorMessageID(messages, messageID);
    if (!anchorMessageID) return;
    const selectedMessage = messages.find((message) => message.id === messageID);
    const navigationBlockID = selectedMessage?.selectionBlockID?.trim() || blockID;
    setFocusedTextBlockID(navigationBlockID);
    setClosedChatBlockIDs((current) => {
      if (!current.has(blockID)) return current;
      const next = new Set(current);
      next.delete(blockID);
      return next;
    });
    setActiveChatBlockID(blockID);
    setActiveChatMessageIDs((current) => ({ ...current, [blockID]: messageID }));
    setChatNavigationRequest((current) => ({
      blockID: navigationBlockID,
      anchorMessageID,
      requestID: (current?.requestID ?? 0) + 1,
    }));
  }, []);
  const submitChat = useCallback(async (blockID: string) => {
    if (!canEdit) return;
    const message = (chatDrafts[blockID] ?? "").trim();
    const attachments = chatDraftAttachments[blockID] ?? [];
    if (!editorChatAttachmentsReadyForSubmit(attachments)) return;
    if (!message && attachments.length === 0) return;
    const now = new Date().toISOString();
    const id = generateStableInformationID();
    const parentID = chatReplyTargets[blockID] ?? "";
    const selectionAnchor = parentID ? undefined : chatSelectionAnchors[blockID];
    const mentionedUserIDs = mentionedUserIDsFromChatDraft(message, companyUsers);
    const nextMessage: EditorTextBlockChatMessage = {
      id,
      blockID,
      parentID: parentID || undefined,
      selectionSource: selectionAnchor?.source,
      selectionBlockID: selectionAnchor?.blockID,
      selectionMessageID: selectionAnchor?.messageID,
      selectionQuote: selectionAnchor?.quote,
      selectionStart: selectionAnchor?.startOffset,
      selectionEnd: selectionAnchor?.endOffset,
      authorID: author.userID,
      authorName: author.name,
      message,
      createdTimestamp: now,
      attachments,
      mentionedUserIDs,
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
            selectionBlockID: selectionAnchor?.blockID,
            selectionMessageID: selectionAnchor?.messageID,
            selectionQuote: selectionAnchor?.quote,
            selectionStart: selectionAnchor?.startOffset,
            selectionEnd: selectionAnchor?.endOffset,
            authorID: author.userID,
            authorName: author.name,
            message,
            createdTimestamp: now,
            attachments,
            mentionedUserIDs,
          }),
          information_id: id,
        }),
      });
      onProjectionMutation();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_save_chat_message");
    }
  }, [author.name, author.userID, canEdit, chatDraftAttachments, chatDrafts, chatReplyTargets, chatSelectionAnchors, companyID, companyUsers, nodeID, onError, onProjectionMutation, requestJSON]);

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
    const results = await Promise.allSettled(candidates.map((file) => uploadEditorAttachment(file, {
      requestJSON,
      companyID,
      resourceType: "node",
      resourceID: nodeID,
      sourceKind: "chat_upload",
      relationshipKind: "chat_attachment",
      informationID: blockID,
      editorSurface: "node_text_block_chat",
    })));
    const attachments = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (attachments.length > 0) {
      setChatDraftAttachments((current) => ({
        ...current,
        [blockID]: [...(current[blockID] ?? []), ...attachments],
      }));
    }
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) {
      const first = failures[0]?.reason;
      onError(first instanceof Error ? first.message : `${failures.length} attachment upload${failures.length === 1 ? "" : "s"} failed.`);
    }
  }, [canEdit, companyID, nodeID, onError, requestJSON]);

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

  const addImageChatComment = useCallback(async (image: TextBlockImageDraft) => {
    if (!canEdit) return;
    setFocusedTextBlockID("");
    setClosedChatBlockIDs((current) => {
      if (!current.has(image.blockID)) return current;
      const next = new Set(current);
      next.delete(image.blockID);
      return next;
    });
    setActiveChatBlockID(image.blockID);
    setChatComposerFocusRequestIDs((current) => ({
      ...current,
      [image.blockID]: (current[image.blockID] ?? 0) + 1,
    }));
    setChatMessageFocusRequest((current) => current?.blockID === image.blockID ? null : current);
    setActiveChatMessageIDs((current) => {
      if (!current[image.blockID]) return current;
      const next = { ...current };
      delete next[image.blockID];
      return next;
    });
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

    try {
      await transferTextBlockImageToChatDraft({
        image,
        requestJSON,
        companyID,
        resourceType: "node",
        resourceID: nodeID,
        editorSurface: "node_text_block_image_chat",
        createPendingID: generateStableInformationID,
        uploadLegacyImage: async () => {
          const file = await prepareTextBlockImageFile(image, apiBase, companyID);
          if (!file) throw new Error("failed_to_prepare_attachment");
          return uploadEditorAttachment(file, {
            requestJSON,
            companyID,
            resourceType: "node",
            resourceID: nodeID,
            sourceKind: "chat_upload",
            relationshipKind: "chat_attachment",
            informationID: image.blockID,
            editorSurface: "node_text_block_image_chat",
          });
        },
        onStage: (attachment) => setChatDraftAttachments((current) => ({
          ...current,
          [image.blockID]: stageEditorChatAttachmentTransfer(current[image.blockID] ?? [], attachment),
        })),
        onResolve: (pendingID, attachment) => setChatDraftAttachments((current) => ({
          ...current,
          [image.blockID]: resolveEditorChatAttachmentTransfer(current[image.blockID] ?? [], pendingID, attachment),
        })),
        onReject: (pendingID) => setChatDraftAttachments((current) => ({
          ...current,
          [image.blockID]: failEditorChatAttachmentTransfer(current[image.blockID] ?? [], pendingID),
        })),
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_attach_image_to_chat");
    }
  }, [apiBase, canEdit, companyID, nodeID, onError, requestJSON]);

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

  const createNodeFromEmailSelection = useCallback(async (messageID: string, quote: string) => {
    if (!canEdit) return;
    if (typeof document === "undefined") return;
    const cleanQuote = quote.trim();
    if (!cleanQuote) return;
    const sourceEmail = attachedEmails.find((email) => email.messageID === messageID || email.id === messageID);
    const fallbackTitle = sourceEmail?.subject.trim() || "Email selection";
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
  }, [attachedEmails, canEdit, onCreateNodeFromImage, onError]);

  const attachEmail = useCallback(async (email: ReturnType<typeof messageAttachmentPayload>) => {
    if (!canEdit) return;
    const mailboxMatches = (item: EditorAttachedEmail) => (
      (item.sharedInboxID?.trim() ?? "") === (email.sharedInboxID?.trim() ?? "")
      && (item.accountEmail?.trim().toLowerCase() ?? "") === (email.accountEmail?.trim().toLowerCase() ?? "")
    );
    if (attachedEmails.some((item) => mailboxMatches(item) && (
      item.messageID === email.messageID || Boolean(email.threadID?.trim() && item.threadID?.trim() === email.threadID.trim())
    ))) {
      setEmailPickerTargetBlockID(null);
      return;
    }
    const id = generateStableInformationID();
    const attached: EditorAttachedEmail = {
      id,
      messageID: email.messageID,
      threadID: email.threadID,
      sharedInboxID: email.sharedInboxID,
      accountEmail: email.accountEmail,
      subject: email.subject,
      snippet: email.snippet,
      from: email.from,
      date: email.date,
      attachedTimestamp: email.attachedTimestamp,
    };
    setAttachedEmails((current) => [attached, ...current]);
    setEmailPickerTargetBlockID(null);
    setSelectedEmailIDsByBlock((current) => ({ ...current, [NODE_EMAIL_COLUMN_LAYOUT_ID]: email.messageID }));
    setClosedEmailBlockIDs((current) => {
      const next = new Set(current);
      next.delete(NODE_EMAIL_COLUMN_LAYOUT_ID);
      return next;
    });
    setOpenEmailBlockIDs((current) => new Set(current).add(NODE_EMAIL_COLUMN_LAYOUT_ID));
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

  const flashLogicGateAssignButton = useCallback((state: "success" | "error") => {
    if (logicGateAssignFlashTimerRef.current !== null) {
      window.clearTimeout(logicGateAssignFlashTimerRef.current);
      logicGateAssignFlashTimerRef.current = null;
    }
    setLogicGateAssignFlash(state);
    logicGateAssignFlashTimerRef.current = window.setTimeout(() => {
      setLogicGateAssignFlash((current) => (current === state ? "" : current));
      logicGateAssignFlashTimerRef.current = null;
    }, 700);
  }, []);

  const assignToLogicGate = useCallback(async (logicGateID: string, rawLabel: string) => {
    if (!canEdit) return;
    const cleanLogicGateID = logicGateID.trim();
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
      flashLogicGateAssignButton("error");
      onRequireNodePriorityForLogicGateAssignment();
      logicGateAssignStatusTimerRef.current = window.setTimeout(() => {
        setLogicGateAssignStatus((current) => (current === message ? "" : current));
        logicGateAssignStatusTimerRef.current = null;
      }, 1500);
      return;
    }
    const label = humanLabelOrFallback(rawLabel, humanLabelOrFallback(cleanLogicGateID, "Logic Gate"));
    const previousAssignedLogicGateID = lastAssignedLogicGateID;
    const previousAssignedLogicGateLabel = lastAssignedLogicGateLabel;
    setAssigningLogicGateID(cleanLogicGateID);
    setLastAssignedLogicGateID(cleanLogicGateID);
    setLastAssignedLogicGateLabel(label);
    setLogicGateAssignerOpen(false);
    setLogicGateSearch("");
    setLogicGateAssignStatus(`Assigning to Logic Gate: ${label}`);
    try {
      await onAssignToLogicGate(cleanLogicGateID);
      const message = `Assigned to Logic Gate: ${label}`;
      setLogicGateAssignStatus(message);
      flashLogicGateAssignButton("success");
      logicGateAssignStatusTimerRef.current = window.setTimeout(() => {
        setLogicGateAssignStatus((current) => (current === message ? "" : current));
        logicGateAssignStatusTimerRef.current = null;
      }, 1500);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "failed_to_assign_logic_gate";
      setLastAssignedLogicGateID(previousAssignedLogicGateID);
      setLastAssignedLogicGateLabel(previousAssignedLogicGateLabel);
      setLogicGateAssignStatus(message);
      flashLogicGateAssignButton("error");
      onError(message);
      logicGateAssignStatusTimerRef.current = window.setTimeout(() => {
        setLogicGateAssignStatus((current) => (current === message ? "" : current));
        logicGateAssignStatusTimerRef.current = null;
      }, 1500);
    } finally {
      setAssigningLogicGateID("");
    }
  }, [assigningLogicGateID, canEdit, flashLogicGateAssignButton, lastAssignedLogicGateID, lastAssignedLogicGateLabel, nodePriorityUnassignedForLogicGate, onAssignToLogicGate, onError, onRequireNodePriorityForLogicGateAssignment]);

  const assignToProject = useCallback(async () => {
    if (!canEdit) return;
    const project = selectedProjectForAssignment;
    const projectID = project?.project_id?.trim() ?? "";
    if (!companyID || !nodeID || !projectID || assigningProjectID || assigningProjectLogicGateID) return;
    const projectLabel = project ? projectOptionLabel(project) : projectID;
    setAssigningProjectID(projectID);
    setProjectAssignStatus(`Adding to ${projectLabel}`);
    try {
      await upsertProjectRelationship({
        companyID,
        projectID,
        resourceType: "node",
        resourceID: nodeID,
      });
      setProjectAssignerOpen(false);
      setSelectedProjectForAssignment(null);
      setProjectAssignStatus(`Project: ${projectLabel}`);
      setProjectRelationshipRefreshKey((key) => key + 1);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "failed_to_assign_project";
      setProjectAssignStatus(message);
      onError(message);
    } finally {
      setAssigningProjectID("");
    }
  }, [assigningProjectID, assigningProjectLogicGateID, canEdit, companyID, nodeID, onError, selectedProjectForAssignment]);

  const assignToProjectLogicGate = useCallback(async (logicGate: LogicGateRecord) => {
    if (!canEdit) return;
    const project = selectedProjectForAssignment;
    const projectID = project?.project_id?.trim() ?? "";
    const logicGateID = logicGate.logic_gate_id.trim();
    if (!companyID || !nodeID || !projectID || !logicGateID || assigningProjectID || assigningProjectLogicGateID) return;
    if (nodePriorityUnassignedForLogicGate) {
      setProjectAssignStatus("Must give node a priority");
      onRequireNodePriorityForLogicGateAssignment();
      return;
    }
    const projectLabel = project ? projectOptionLabel(project) : projectID;
    const logicGateLabel = logicGateOptionLabel(logicGate);
    setAssigningProjectLogicGateID(logicGateID);
    setProjectAssignStatus(`Adding to ${projectLabel}`);
    try {
      await upsertProjectRelationship({
        companyID,
        projectID,
        resourceType: "node",
        resourceID: nodeID,
      });
      await onAssignToLogicGate(logicGateID);
      setLastAssignedLogicGateID(logicGateID);
      setLastAssignedLogicGateLabel(logicGateLabel);
      setProjectAssignerOpen(false);
      setSelectedProjectForAssignment(null);
      setProjectAssignStatus(`Project: ${projectLabel}`);
      setProjectRelationshipRefreshKey((key) => key + 1);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "failed_to_assign_project";
      setProjectAssignStatus(message);
      onError(message);
    } finally {
      setAssigningProjectLogicGateID("");
    }
  }, [assigningProjectID, assigningProjectLogicGateID, canEdit, companyID, nodeID, nodePriorityUnassignedForLogicGate, onAssignToLogicGate, onError, onRequireNodePriorityForLogicGateAssignment, selectedProjectForAssignment]);

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
    setClosedEmailBlockIDs((current) => {
      if (!current.has(cleanBlockID)) return current;
      const next = new Set(current);
      next.delete(cleanBlockID);
      return next;
    });
    setOpenEmailBlockIDs((current) => {
      if (current.has(cleanBlockID)) return current;
      const next = new Set(current);
      next.add(cleanBlockID);
      return next;
    });
    if (cleanBlockID !== NODE_EMAIL_COLUMN_LAYOUT_ID) setActiveRowBlockID(cleanBlockID);
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
    setNodeEmailModalMessageID(cleanMessageID);
  }, []);

  const sidePaneWidthForBlock = useCallback((blockID: string, pane: TextSidePaneKind, fallback: number, maxWidth = TEXT_SIDE_PANE_MAX_WIDTH_PX): number => {
    const localWidth = sidePaneWidths[blockID]?.[pane];
    if (localWidth !== undefined) return clampTextSidePaneWidth(localWidth, maxWidth);
    return clampTextSidePaneWidth(readStoredTextSidePaneWidth(companyID, nodeID, blockID, pane, fallback), maxWidth);
  }, [companyID, nodeID, sidePaneWidths]);

  const startTextSidePaneResize = useCallback((blockID: string, pane: TextSidePaneKind, edge: "before" | "after", fallbackWidth: number, maxWidth: number, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const paneElement = edge === "before" ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
    if (!(paneElement instanceof HTMLElement)) return;
    const paneRect = paneElement.getBoundingClientRect();
    const startX = event.clientX;
    const startWidth = paneRect.width > 0 ? paneRect.width : sidePaneWidthForBlock(blockID, pane, fallbackWidth);
    const ownerDocument = event.currentTarget.ownerDocument;
    const previousCursor = ownerDocument.body.style.cursor;
    ownerDocument.body.style.cursor = "col-resize";
    let latestWidth = clampTextSidePaneWidth(startWidth, maxWidth);

    const updateWidth = (clientX: number) => {
      latestWidth = clampTextSidePaneWidth(startWidth + (edge === "before" ? startX - clientX : clientX - startX), maxWidth);
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
    const cleanEmailMessageID = focusEmailMessageID?.trim() ?? "";
    if ((!cleanInformationID && !cleanEmailMessageID) || !projectionsLoaded) return;
    const requestKey = `${nodeID}:${cleanInformationID}:${cleanEmailMessageID}:${focusRequestID ?? 0}`;
    if (handledFocusRequestRef.current === requestKey) return;
    if (focusTargetIndex < 0) return;

    if (cleanEmailMessageID && emailOriginChatBlockID) {
      const anchoredChat = chatMessages.slice().reverse().find((item) => item.blockID === emailOriginChatBlockID && item.selectionMessageID === cleanEmailMessageID);
      if (anchoredChat) {
        handledFocusRequestRef.current = requestKey;
        setFocusedTextBlockID("");
        setActiveChatBlockID(emailOriginChatBlockID);
        setOpenChatBlockIDs((current) => new Set(current).add(emailOriginChatBlockID));
        setActiveChatMessageIDs((current) => ({ ...current, [emailOriginChatBlockID]: anchoredChat.id }));
        setClosedChatBlockIDs((current) => {
          if (!current.has(emailOriginChatBlockID)) return current;
          const next = new Set(current);
          next.delete(emailOriginChatBlockID);
          return next;
        });
        window.requestAnimationFrame(() => {
          scrollNodeWorkspaceInformationIntoView(rootRef.current, anchoredChat.id);
        });
        return;
      }
    }

    const block = blocks[focusTargetIndex];
    if (block) {
      handledFocusRequestRef.current = requestKey;
      const message = chatMessages.find((item) => item.id === cleanInformationID);
      const attachedEmail = nodeAttachedEmails.find((email) => email.id === cleanInformationID || email.messageID === cleanInformationID || email.messageID === cleanEmailMessageID);
      if (message) {
        const messages = chatMessagesByBlock.get(message.blockID) ?? [];
        navigateToChatMessage(message.blockID, messages, message.id);
      } else if (attachedEmail) {
        setFocusedTextBlockID("");
        setActiveRowBlockID(block.id);
        setOpenEmailBlockIDs((current) => new Set(current).add(NODE_EMAIL_COLUMN_LAYOUT_ID));
        setSelectedEmailIDsByBlock((current) => ({ ...current, [NODE_EMAIL_COLUMN_LAYOUT_ID]: attachedEmail.messageID }));
        setClosedEmailBlockIDs((current) => {
          if (!current.has(NODE_EMAIL_COLUMN_LAYOUT_ID)) return current;
          const next = new Set(current);
          next.delete(NODE_EMAIL_COLUMN_LAYOUT_ID);
          return next;
        });
      } else {
        setActiveRowBlockID(block.id);
        setOpenEditorBlockIDs((current) => new Set(current).add(block.id));
        setFocusedTextBlockID(block.id);
        setClosedEditorBlockIDs((current) => {
          if (!current.has(block.id)) return current;
          const next = new Set(current);
          next.delete(block.id);
          return next;
        });
        setActiveChatBlockID("");
      }
      window.requestAnimationFrame(() => {
        const editor = rootRef.current?.querySelector<HTMLElement>(`[data-node-text-block-id="${block.id}"]`) ?? null;
        scrollNodeWorkspaceInformationIntoView(rootRef.current, message?.id || attachedEmail?.messageID || block.id);
        if (!message && !attachedEmail && canEdit && focusInformationMode !== "scroll") focusContentEditableAtEnd(editor);
      });
      return;
    }
  }, [blocks, canEdit, chatMessages, chatMessagesByBlock, emailOriginChatBlockID, focusEmailMessageID, focusInformationID, focusInformationMode, focusRequestID, focusTargetIndex, navigateToChatMessage, nodeAttachedEmails, nodeID, projectionsLoaded]);

  const renderTextSidePaneResizeHandle = (blockID: string, pane: TextSidePaneKind, edge: "before" | "after", fallbackWidth: number, maxWidth: number) => {
    return (
      <div
        role="separator"
        aria-label={`Resize ${pane} column`}
        aria-orientation="vertical"
        data-frame-interactive="true"
        onPointerDown={(event) => startTextSidePaneResize(blockID, pane, edge, fallbackWidth, maxWidth, event)}
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

  const renderLogicGateSearchRow = (row: ExplorerTreeNode) => {
    const logicGateID = (row.logicGateID ?? row.resourceID ?? (row.entityType === "logic_gate" ? row.entityID : "") ?? "").trim();
    const selectable = row.kind === "logic_gate" && Boolean(logicGateID);
    const label = row.label || logicGateID;
    const depthInset = Math.min(72, Math.max(0, row.depth) * 14);
    if (!selectable) {
      return (
        <div
          key={row.id}
          role="presentation"
          style={{
            minHeight: 30,
            display: "grid",
            gridTemplateColumns: `${depthInset}px 24px minmax(0, 1fr)`,
            alignItems: "center",
            gap: 7,
            color: surfaceText,
            opacity: row.syntheticKind === "search_path" ? 0.66 : 0.82,
            padding: "4px 8px",
            minWidth: 0,
          }}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" style={{ width: 22, height: 22, display: "grid", placeItems: "center" }}>
            <ExplorerRowIcon kind="folder" systemKey={row.systemKey} mangoDefaultFolder={Boolean(row.systemKey || row.protectedDefaultFolder)} />
          </span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: row.syntheticKind === "search_result" ? 850 : 760 }}>
            {label}
          </span>
        </div>
      );
    }
    const selected = assignedLogicGateIDSet.has(logicGateID) || lastAssignedLogicGateID === logicGateID;
    const busy = assigningLogicGateID === logicGateID;
    const hovered = hoveredLogicGateID === logicGateID;
    const highlighted = selected || busy || hovered;
    return (
      <button
        key={row.id}
        type="button"
        disabled={Boolean(assigningLogicGateID)}
        onClick={() => { void assignToLogicGate(logicGateID, label); }}
        title={label}
        style={{
          position: "relative",
          width: "100%",
          minHeight: 38,
          display: "grid",
          gridTemplateColumns: `${depthInset}px 28px minmax(0, 1fr) 24px`,
          alignItems: "center",
          gap: 8,
          border: highlighted ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
          borderRadius: 9,
          background: highlighted ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
          color: surfaceText,
          cursor: assigningLogicGateID ? "default" : "pointer",
          font: "inherit",
          padding: "6px 8px",
          minWidth: 0,
          textAlign: "left",
          boxShadow: highlighted ? `${EDITOR_NEU_SHADOW}, inset 1px 1px 0 rgba(255,255,255,0.86)` : EDITOR_NEU_SHADOW,
          transition: "background 140ms ease, border-color 140ms ease, box-shadow 160ms ease, transform 160ms ease",
          transform: hovered && !selected ? "translateY(-1px)" : "translateY(0)",
        }}
        onMouseEnter={() => setHoveredLogicGateID(logicGateID)}
        onMouseLeave={() => setHoveredLogicGateID((current) => (current === logicGateID ? "" : current))}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", background: highlighted ? "rgba(255,255,255,0.76)" : "rgba(255,255,255,0.58)", boxShadow: highlighted ? "inset 1px 1px 0 rgba(255,255,255,0.86)" : "2px 2px 6px rgba(174,174,192,0.18), -2px -2px 6px rgba(255,255,255,0.86)" }}>
          <ExplorerRowIcon kind="logic_gate" />
        </span>
        <span style={{ maxWidth: "100%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: selected ? 900 : 820, lineHeight: 1.2 }}>
          {label}
        </span>
        <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 8, display: "grid", placeItems: "center", border: selected ? `1px solid ${accent}` : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: selected ? "#ffffff" : "rgba(255,255,255,0.5)", opacity: selected || busy ? 1 : 0 }}>
          {selected ? <RelationshipCheckIcon color={accent} /> : busy ? "..." : null}
        </span>
      </button>
    );
  };

  const logicGateAssignerMenuWidth = Math.max(
    280,
    Math.min(compact ? 420 : 520, width > 0 ? width - 28 : compact ? 420 : 520),
  );
  const logicGateAssignButtonBackground = logicGateAssignFlash === "success"
    ? "linear-gradient(135deg, rgba(57,255,136,0.98), rgba(206,255,225,0.98))"
    : logicGateAssignFlash === "error"
      ? "linear-gradient(135deg, rgba(255,65,96,0.98), rgba(255,220,228,0.98))"
      : logicGateAssignerOpen
        ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`
        : EDITOR_NEU_SURFACE;
  const logicGateAssignButtonBorder = logicGateAssignFlash
    ? "1px solid transparent"
    : logicGateAssignerOpen ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`;
  const logicGateAssignButtonColor = logicGateAssignFlash === "success"
    ? "#064e3b"
    : logicGateAssignFlash === "error"
      ? "#7f1d1d"
      : surfaceText;
  const logicGateAssignButtonBoxShadow = logicGateAssignFlash === "success"
    ? "0 0 0 1px rgba(57,255,136,0.42), 0 0 26px rgba(57,255,136,0.58), inset 1px 1px 0 rgba(255,255,255,0.88)"
    : logicGateAssignFlash === "error"
      ? "0 0 0 1px rgba(255,65,96,0.42), 0 0 26px rgba(255,65,96,0.56), inset 1px 1px 0 rgba(255,255,255,0.84)"
      : EDITOR_NEU_SHADOW;

  const logicGateAssignerDropdown = canEdit && logicGateAssignerOpen ? (
    <div
      role="menu"
      aria-label="Assign logic gate"
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% - 1px)",
        left: 0,
        zIndex: 95,
        width: logicGateAssignerMenuWidth,
        minWidth: 0,
        maxWidth: "calc(100vw - 44px)",
        minHeight: 0,
        display: "grid",
        gap: 9,
        border: "1px solid transparent",
        borderRadius: "0 0 14px 14px",
        background: `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
        padding: 10,
        boxShadow: `${EDITOR_NEU_PANEL_SHADOW}, 0 18px 36px rgba(15,23,42,0.16)`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <CompanyExplorerSearchBox
          value={logicGateSearch}
          onChange={setLogicGateSearch}
          onEscape={() => setLogicGateSearch("")}
          placeholder="Search logic gates"
          ariaLabel="Search logic gates"
          autoFocus
          style={{
            height: 34,
            borderRadius: 10,
            border: logicGateSearchQuery ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
            background: logicGateSearchQuery ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_ACTIVE_SURFACE,
            boxShadow: "inset 2px 2px 6px rgba(174,174,192,0.16), inset -2px -2px 6px rgba(255,255,255,0.82)",
          }}
        />
      </div>

      {nodePriorityUnassignedForLogicGate && (
        <div style={{ justifySelf: "start", maxWidth: "100%", display: "inline-flex", alignItems: "center", border: "1px solid rgba(245, 158, 11, 0.34)", borderRadius: 10, background: "linear-gradient(135deg, rgba(255,251,235,0.96), rgba(254,243,199,0.72))", color: "#92400e", padding: "7px 9px", fontSize: 11, fontWeight: 800, lineHeight: 1.3, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.82)" }}>
          In order to assign to a Logic Gate, give this node a priority.
        </div>
      )}

      {logicGateSearchQuery && (
        <div
          className="editor-document-scroll"
          role="listbox"
          aria-label="Logic gate search results"
          style={{
            minHeight: 0,
            maxHeight: 314,
            overflowY: "auto",
            padding: "2px 6px 8px 2px",
            display: "grid",
            alignContent: "start",
            gap: 5,
            background: "rgba(255,255,255,0.42)",
            borderRadius: 10,
            ["--editor-document-scroll-accent" as string]: "linear-gradient(180deg, rgba(92,238,255,0.92), rgba(183,124,255,0.82))",
            ["--editor-document-scroll-track" as string]: "rgba(255,255,255,0.46)",
          }}
        >
          {logicGateSearchLoading && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64, padding: 8 }}>Searching...</div>}
          {!logicGateSearchLoading && logicGateSearchTreeRows.length === 0 && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64, padding: 8 }}>No matches</div>}
          {!logicGateSearchLoading && logicGateSearchTreeRows.length > 0 && logicGateSearchTreeRows.map(renderLogicGateSearchRow)}
        </div>
      )}

      {logicGateAssignStatus && <div style={{ justifySelf: "start", maxWidth: "100%", border: `1px solid ${logicGateAssignStatus.startsWith("Assigning") ? "rgba(59,130,246,0.24)" : logicGateAssignStatus.startsWith("Assigned") ? "rgba(100,116,139,0.22)" : "rgba(245,158,11,0.30)"}`, borderRadius: 9, background: logicGateAssignStatus.startsWith("Assigning") ? "rgba(239,246,255,0.82)" : logicGateAssignStatus.startsWith("Assigned") ? "rgba(248,250,252,0.9)" : "rgba(255,251,235,0.9)", color: logicGateAssignStatus.startsWith("Assigning") ? accent : logicGateAssignStatus.startsWith("Assigned") ? surfaceText : "#92400e", padding: "5px 8px", fontSize: 11, fontWeight: 800, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{logicGateAssignStatus}</div>}
    </div>
  ) : null;
  const projectAssignerDropdown = canEdit && projectAssignerOpen ? (
    <div
      role="menu"
      aria-label="Assign project"
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% - 1px)",
        left: projectAssignerDropdownLeft,
        zIndex: 94,
        width: projectAssignerMenuWidth,
        minWidth: 0,
        maxWidth: "calc(100vw - 44px)",
        display: "grid",
        gap: 9,
        border: "1px solid transparent",
        borderRadius: "0 0 14px 14px",
        background: `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
        padding: 10,
        boxShadow: `${EDITOR_NEU_PANEL_SHADOW}, 0 18px 36px rgba(15,23,42,0.16)`,
      }}
    >
      <div style={{ display: "grid", gap: 5, minWidth: 0 }}>
        <div style={{ color: surfaceText, opacity: 0.68, fontSize: 10.5, fontWeight: 900 }}>Project</div>
        <div className="editor-document-scroll" style={{ maxHeight: 168, overflowY: "auto", display: "grid", gap: 5, padding: "2px 5px 6px 2px" }}>
          {projectOptionsLoading && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64, padding: 8 }}>Loading projects</div>}
          {!projectOptionsLoading && projectOptions.length === 0 && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64, padding: 8 }}>No projects</div>}
          {!projectOptionsLoading && projectOptions.map((project) => {
            const projectID = project.project_id.trim();
            const selected = selectedProjectForAssignment?.project_id === projectID;
            return (
              <button
                key={projectID}
                type="button"
                role="menuitem"
                onClick={() => {
                  setSelectedProjectForAssignment(project);
                  setProjectAssignStatus("");
                }}
                title={projectOptionLabel(project)}
                style={{ minHeight: 34, display: "grid", gridTemplateColumns: "24px minmax(0, 1fr) 18px", alignItems: "center", gap: 7, border: selected ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 9, background: selected ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: surfaceText, cursor: "pointer", padding: "5px 8px", font: "inherit", textAlign: "left", boxShadow: EDITOR_NEU_SHADOW }}
              >
                <ExplorerRowIcon kind="project" />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 850 }}>{projectOptionLabel(project)}</span>
                <span>{selected ? <RelationshipCheckIcon color={accent} /> : null}</span>
              </button>
            );
          })}
        </div>
      </div>
      {selectedProjectForAssignment && (
        <div style={{ display: "grid", gap: 5, minWidth: 0 }}>
          <button
            type="button"
            role="menuitem"
            disabled={Boolean(assigningProjectID || assigningProjectLogicGateID)}
            onClick={() => { void assignToProject(); }}
            title={`Assign node to ${projectOptionLabel(selectedProjectForAssignment)}`}
            style={{ minHeight: 34, display: "grid", gridTemplateColumns: "24px minmax(0, 1fr) 18px", alignItems: "center", gap: 7, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 9, background: EDITOR_NEU_SURFACE, color: surfaceText, cursor: assigningProjectID || assigningProjectLogicGateID ? "default" : "pointer", padding: "5px 8px", font: "inherit", textAlign: "left", boxShadow: EDITOR_NEU_SHADOW }}
          >
            <ExplorerRowIcon kind="project" />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 850 }}>Assign node to project</span>
            <span>{assigningProjectID ? "..." : null}</span>
          </button>
          <div style={{ color: surfaceText, opacity: 0.68, fontSize: 10.5, fontWeight: 900 }}>Optional Logic Gate</div>
          {nodePriorityUnassignedForLogicGate && (
            <div style={{ border: "1px solid rgba(245, 158, 11, 0.34)", borderRadius: 9, background: "rgba(255,251,235,0.9)", color: "#92400e", padding: "6px 8px", fontSize: 11, fontWeight: 800 }}>Give this node a priority before assigning it to a project logic gate.</div>
          )}
          <div className="editor-document-scroll" style={{ maxHeight: 190, overflowY: "auto", display: "grid", gap: 5, padding: "2px 5px 6px 2px" }}>
            {projectLogicGatesLoading && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64, padding: 8 }}>Loading logic gates</div>}
            {!projectLogicGatesLoading && projectLogicGateOptions.length === 0 && <div style={{ fontSize: 11, color: surfaceText, opacity: 0.64, padding: 8 }}>No logic gates in this project</div>}
            {!projectLogicGatesLoading && projectLogicGateOptions.map((logicGate) => {
              const logicGateID = logicGate.logic_gate_id.trim();
              const busy = assigningProjectLogicGateID === logicGateID;
              return (
                <button
                  key={logicGateID}
                  type="button"
                  role="menuitem"
                  disabled={Boolean(assigningProjectID || assigningProjectLogicGateID)}
                  onClick={() => { void assignToProjectLogicGate(logicGate); }}
                  title={logicGateOptionLabel(logicGate)}
                  style={{ minHeight: 34, display: "grid", gridTemplateColumns: "24px minmax(0, 1fr) 18px", alignItems: "center", gap: 7, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 9, background: EDITOR_NEU_SURFACE, color: surfaceText, cursor: assigningProjectID || assigningProjectLogicGateID ? "default" : "pointer", padding: "5px 8px", font: "inherit", textAlign: "left", boxShadow: EDITOR_NEU_SHADOW }}
                >
                  <ExplorerRowIcon kind="logic_gate" />
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 850 }}>{logicGateOptionLabel(logicGate)}</span>
                  <span>{busy ? "..." : null}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {projectAssignStatus && <div style={{ justifySelf: "start", maxWidth: "100%", border: `1px solid ${projectAssignStatus.startsWith("Project:") ? "rgba(100,116,139,0.22)" : "rgba(59,130,246,0.24)"}`, borderRadius: 9, background: projectAssignStatus.startsWith("Project:") ? "rgba(248,250,252,0.9)" : "rgba(239,246,255,0.82)", color: projectAssignStatus.startsWith("Project:") ? surfaceText : accent, padding: "5px 8px", fontSize: 11, fontWeight: 800, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectAssignStatus}</div>}
    </div>
  ) : null;

  const nodeEmailColumnVisible = nodeAttachedEmails.length > 0 && openEmailBlockIDs.has(NODE_EMAIL_COLUMN_LAYOUT_ID);
  const nodeEmailPaneMaxWidth = Math.max(TEXT_SIDE_PANE_MIN_WIDTH_PX, Math.min(560, textCommunicationContentWidth - TEXT_BLOCK_RESIZE_MIN_WIDTH_PX));
  const nodeEmailPaneWidth = sidePaneWidthForBlock(
    NODE_EMAIL_COLUMN_LAYOUT_ID,
    "email",
    Math.min(420, textSidePaneDefaultWidth),
    nodeEmailPaneMaxWidth,
  );
  const nodeEmailMessageAccents = Object.fromEntries(blocks
    .filter((block) => Boolean(block.emailMessageID?.trim()))
    .map((block) => [
      block.emailMessageID!.trim(),
      block.emailAccent?.trim() || editorEmailMessageAccent(block.emailMessageID!.trim()),
    ]));
  const activeNodeEmailChatMessage = activeChatBlockID
    ? (chatMessagesByBlock.get(activeChatBlockID) ?? []).find((message) => message.id === activeChatMessageIDs[activeChatBlockID])
    : undefined;
  const activeNodeEmailSelection = activeNodeEmailChatMessage?.selectionSource === "email"
    && activeNodeEmailChatMessage.selectionMessageID
    && activeNodeEmailChatMessage.selectionQuote
    && Number.isFinite(activeNodeEmailChatMessage.selectionStart)
    && Number.isFinite(activeNodeEmailChatMessage.selectionEnd)
    ? {
      messageID: activeNodeEmailChatMessage.selectionMessageID,
      quote: activeNodeEmailChatMessage.selectionQuote,
      startOffset: activeNodeEmailChatMessage.selectionStart ?? 0,
      endOffset: activeNodeEmailChatMessage.selectionEnd ?? 0,
    }
    : null;
  const openEmailSelectionChat = (messageID: string, selection: { quote: string; startOffset: number; endOffset: number; x: number; y: number }) => {
    const existingBlockID = blocks.find((block) => block.emailMessageID === messageID)?.id ?? "";
    const blockID = existingBlockID || createEmailTextBlock(messageID, selection.quote);
    if (!blockID) return;
    openSelectionChat({
      blockID,
      source: "email",
      messageID,
      quote: selection.quote,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
      x: selection.x,
      y: selection.y,
    }, blockID);
    setChatComposerFocusRequestIDs((current) => ({ ...current, [blockID]: (current[blockID] ?? 0) + 1 }));
  };

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
        display: hidden ? "none" : "block",
        overflowY: "auto",
        overflowAnchor: "none",
        overflowX: "hidden",
        pointerEvents: hidden ? "none" : "auto",
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
          {nodeAttachedEmails.length > 0 && (
            <button
              type="button"
              title={nodeEmailColumnVisible ? "Hide node email column" : "Open node email column"}
              aria-label="Toggle node email column"
              aria-pressed={nodeEmailColumnVisible}
              onClick={() => {
                setFocusedTextBlockID("");
                setOpenEmailBlockIDs((current) => {
                  const next = new Set(current);
                  if (nodeEmailColumnVisible) next.delete(NODE_EMAIL_COLUMN_LAYOUT_ID);
                  else next.add(NODE_EMAIL_COLUMN_LAYOUT_ID);
                  return next;
                });
                setClosedEmailBlockIDs((current) => {
                  const next = new Set(current);
                  if (nodeEmailColumnVisible) next.add(NODE_EMAIL_COLUMN_LAYOUT_ID);
                  else next.delete(NODE_EMAIL_COLUMN_LAYOUT_ID);
                  return next;
                });
              }}
              style={{ minHeight: 30, borderRadius: 9, border: nodeEmailColumnVisible ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: nodeEmailColumnVisible ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: accent, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0 9px", cursor: "pointer", fontSize: 11, fontWeight: 900, boxShadow: EDITOR_NEU_SHADOW }}
            >
              <MailIcon color={accent} />
              Email ({nodeAttachedEmails.length})
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
            onRemoveEmail={canEdit ? (emailID) => { void removeAttachedEmail(emailID); } : undefined}
          />
          <AttachmentCountDropdown
            items={nodeAttachmentDropdownItems}
            uploads={nodeAttachmentUploadDropdownItems}
            apiBase={apiBase}
            companyID={companyID}
            accent={accent}
            surfaceText={surfaceText}
            align="left"
            loading={nodeAttachmentsLoading}
            loadError={nodeAttachmentsLoadError}
            onRetry={refreshNodeAttachments}
            onRemove={canEdit ? (item) => { void removeNodeAttachment(item.resourceAttachment); } : undefined}
            onCancelUpload={cancelNodeAttachmentUpload}
            onRetryUpload={retryNodeAttachmentUpload}
            onError={onError}
          />
          {canEdit && (
            <div ref={logicGateAssignerRef} style={{ position: "relative", display: "inline-flex", flex: "1 1 132px", minWidth: 0, maxWidth: compact ? "100%" : 360, overflow: "visible" }}>
              <button
                type="button"
                title={assignLogicGateButtonLabel}
                aria-haspopup="menu"
                aria-expanded={logicGateAssignerOpen}
                onClick={() => {
                  setLogicGateAssignerOpen((open) => !open);
                  setLogicGateAssignStatus("");
                }}
                style={{
                  minHeight: 30,
                  width: "100%",
                  minWidth: 0,
                  borderRadius: logicGateAssignerOpen ? "9px 9px 0 0" : 9,
                  border: logicGateAssignButtonBorder,
                  background: logicGateAssignButtonBackground,
                  color: logicGateAssignButtonColor,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "0 10px",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: 0,
                  whiteSpace: "nowrap",
                  boxShadow: logicGateAssignButtonBoxShadow,
                  transition: "background 140ms ease, border-color 140ms ease, box-shadow 180ms ease, color 140ms ease",
                }}
              >
                <ExplorerRowIcon kind="logic_gate" />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assignLogicGateButtonLabel}</span>
              </button>
              {logicGateAssignerDropdown}
            </div>
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
          {canEdit && (
            <div ref={projectAssignerRef} style={{ position: "relative", display: "inline-flex", flex: "0 1 auto", width: "fit-content", minWidth: 0, maxWidth: compact ? "100%" : 360, overflow: "visible" }}>
              <button
                type="button"
                title={assignProjectButtonLabel}
                aria-haspopup="menu"
                aria-expanded={projectAssignerOpen}
                onClick={() => {
                  setProjectAssignerOpen((open) => !open);
                  setProjectAssignStatus("");
                }}
                style={{
                  minHeight: 30,
                  width: "100%",
                  minWidth: 0,
                  borderRadius: projectAssignerOpen ? "9px 9px 0 0" : 9,
                  border: projectAssignerOpen ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                  background: projectAssignerOpen ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
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
                  boxShadow: EDITOR_NEU_SHADOW,
                }}
              >
                <ExplorerRowIcon kind="project" />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assignProjectButtonLabel}</span>
              </button>
              {projectAssignerDropdown}
            </div>
          )}
          {primaryAssignedProjectID && (
            <button
              type="button"
              title={`Go to ${primaryAssignedProjectLabel}`}
              onClick={goToAssignedProject}
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
              Go to Project
            </button>
          )}
          </div>

        {blocks.length === 0 && (
          <>
            <TimelineCell accent={accent} muted isLast />
            <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, minHeight: 92, display: "grid", placeItems: "center", color: surfaceText, opacity: 0.7, fontSize: 13, fontWeight: 700 }}>
              No text boxes
            </div>
          </>
        )}

        <div
          data-node-email-workspace="true"
          style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: nodeEmailColumnVisible ? `${nodeEmailPaneWidth}px ${TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX}px minmax(0, 1fr)` : "minmax(0, 1fr)", minWidth: 0, alignItems: "start" }}
        >
        {nodeEmailColumnVisible && (
          <div
            data-node-email-column="true"
            style={{ position: "sticky", top: 38, minWidth: 0, height: "min(720px, calc(100vh - 170px))", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 14, background: panelBackground, overflow: "hidden", boxShadow: EDITOR_NEU_SHADOW }}
          >
            <AttachedEmailOrganizerPane
              emails={nodeAttachedEmails}
              nodeID={nodeID}
              apiBase={apiBase}
              companyID={companyID}
              companyUsers={companyUsers}
              attachmentRequestJSON={requestJSON}
              attachmentResourceType="node"
              attachmentResourceID={nodeID}
              storageKey={`node-editor-attached-email-layout-v1:${companyID || "company"}:${nodeID || "node"}`}
              tabbed={false}
              editable={canEdit}
              accent={accent}
              surfaceText={surfaceText}
              strokeColor={strokeColor}
              ruleColor={ruleColor}
              selectedMessageID={selectedEmailIDsByBlock[NODE_EMAIL_COLUMN_LAYOUT_ID] ?? ""}
              focusMessageID={(activeNodeEmailChatMessage?.selectionSource === "email" ? activeNodeEmailChatMessage.selectionMessageID : undefined) || focusEmailMessageID}
              activeEmailSelection={activeNodeEmailSelection}
              emailHighlightRemovalRequest={emailHighlightRemovalRequest}
              messageAccents={nodeEmailMessageAccents}
              onSelectMessage={(messageID) => openBlockEmail(NODE_EMAIL_COLUMN_LAYOUT_ID, messageID)}
              onClearSelectedMessage={() => clearBlockEmail(NODE_EMAIL_COLUMN_LAYOUT_ID)}
              onRemoveEmail={(emailID) => { void removeAttachedEmail(emailID); }}
              onReplyEditorFocus={() => {
                setEmailReplyBlockID(NODE_EMAIL_COLUMN_LAYOUT_ID);
                setFocusedTextBlockID("");
                if (formattingControllerRef) formattingControllerRef.current = null;
              }}
              onEmailSelectionChatRequest={openEmailSelectionChat}
              onEmailSelectionTextBoxRequest={(messageID, quote) => { createEmailTextBlock(messageID, quote); }}
              onEmailMessageTextBoxRequest={(messageID) => { createEmailTextBlock(messageID); }}
              onEmailSelectionNodeRequest={(messageID, quote) => { void createNodeFromEmailSelection(messageID, quote); }}
              onError={onError}
            />
          </div>
        )}
        {nodeEmailColumnVisible && renderTextSidePaneResizeHandle(NODE_EMAIL_COLUMN_LAYOUT_ID, "email", "after", nodeEmailPaneWidth, nodeEmailPaneMaxWidth)}
        <div
          ref={rowVirtualizer.listRef}
          data-mango-bounded-editor-rows="node"
          data-mounted-row-count={rowVirtualizer.mountedRowCount}
          style={{ display: "grid", gridTemplateColumns: editorGridTemplateColumns, columnGap: TEXT_CHAT_GRID_COLUMN_GAP_PX, rowGap: 0, minWidth: 0 }}
        >
        {rowVirtualizer.entries.map((entry) => {
          if (entry.kind === "spacer") {
            return <div key={entry.key} aria-hidden="true" data-editor-row-spacer="true" style={{ gridColumn: "1 / -1", height: entry.height, pointerEvents: "none" }} />;
          }
          const index = entry.index;
          const block = blocks[index];
          if (!block) return null;
          const emailOriginPrimaryRow = emailOriginNode && index === 0;
          const chatBlockID = emailOriginPrimaryRow ? emailOriginChatBlockID : block.id;
          const messages = chatMessagesByBlock.get(chatBlockID) ?? [];
          const blockEmails = nodeAttachedEmails;
          const chatIsActive = activeChatBlockID === chatBlockID;
          const chatIsVisible = openChatBlockIDs.has(chatBlockID) || chatIsActive;
          const editorPaneIsVisible = openEditorBlockIDs.has(block.id);
          const emailPaneIsVisible = false;
          const emailPaneIsMounted = false;
          const chatPaneIsVisible = chatIsVisible;
          const sidePaneCount = (emailPaneIsVisible ? 1 : 0) + (chatPaneIsVisible ? 1 : 0);
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
          const rawChatPaneWidth = sidePaneWidthForBlock(chatBlockID, "chat", sidePaneFallbackWidth, sidePaneMaxWidth);
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
          const blockCommunicationGridTemplateColumns = [
            emailPaneIsVisible ? `minmax(${TEXT_SIDE_PANE_MIN_WIDTH_PX}px, ${emailPaneWidth}px)` : "",
            emailPaneIsVisible ? `${TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX}px` : "",
            editorPaneIsVisible ? `minmax(${TEXT_BLOCK_RESIZE_MIN_WIDTH_PX}px, 1fr)` : "",
            chatPaneIsVisible ? `${TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX}px` : "",
            chatPaneIsVisible ? `minmax(${TEXT_SIDE_PANE_MIN_WIDTH_PX}px, ${chatPaneWidth}px)` : "",
          ].filter(Boolean).join(" ") || "minmax(0, 1fr)";
          const minimumCommunicationWidth = (emailPaneIsVisible ? emailPaneWidth + TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX : 0)
            + (editorPaneIsVisible ? TEXT_BLOCK_RESIZE_MIN_WIDTH_PX : 0)
            + (chatPaneIsVisible ? chatPaneWidth + TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX : 0);
          const textBlockIsFocused = focusedTextBlockID === block.id;
          const blockEmailAccent = block.emailMessageID ? (block.emailAccent?.trim() || editorEmailMessageAccent(block.emailMessageID)) : "";
          const selectionAnchor = chatSelectionAnchors[chatBlockID];
          const activeChatMessageID = activeChatMessageIDs[chatBlockID] ?? "";
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
          const emailChatParticipantIDs = emailOriginPrimaryRow
            ? new Set(messages.flatMap((message) => [message.authorID, ...(message.mentionedUserIDs ?? [])]).map((id) => id.trim()).filter(Boolean))
            : new Set<string>();
          const emailChatParticipants = companyUsers.filter((user) => emailChatParticipantIDs.has(user.user_id));
          const emailChatParticipantRoster = emailChatParticipants.length > 0 ? (
            <div title={emailChatParticipants.map((user) => user.display_name?.trim() || user.email?.trim() || user.user_id).join(", ")} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ display: "flex", alignItems: "center", paddingLeft: 4 }}>
                {emailChatParticipants.slice(0, 5).map((user, participantIndex) => {
                  const label = user.display_name?.trim() || user.email?.trim() || "User";
                  return <span key={user.user_id} aria-label={label} style={{ width: 22, height: 22, marginLeft: participantIndex === 0 ? 0 : -5, border: "2px solid rgba(255,255,255,0.94)", borderRadius: "50%", background: "linear-gradient(135deg, #dbeafe, #ede9fe)", color: "#4338ca", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 950 }}>{label.slice(0, 1).toUpperCase()}</span>;
                })}
              </span>
              {emailChatParticipants.length > 5 && <span style={{ fontSize: 10, fontWeight: 900, color: "#64748b" }}>+{emailChatParticipants.length - 5}</span>}
            </div>
          ) : undefined;
          const blockAttachmentDropdownItems = (nodeTextBlockAttachmentsByInformationID.get(block.id) ?? []).map((resourceAttachment) => ({
            resourceAttachment,
          }));
          const blockEmailPane = (
            <AttachedEmailOrganizerPane
              emails={blockEmails}
              nodeID={nodeID}
              apiBase={apiBase}
              companyID={companyID}
              companyUsers={companyUsers}
              attachmentRequestJSON={requestJSON}
              storageKey={`node-editor-attached-email-layout-v1:${companyID || "company"}:${nodeID || "node"}`}
              tabbed={false}
              editable={canEdit}
              accent={accent}
              surfaceText={surfaceText}
              strokeColor={strokeColor}
              ruleColor={ruleColor}
              selectedMessageID={selectedEmailIDsByBlock[block.id] ?? ""}
              focusMessageID={emailOriginPrimaryRow
                ? (activeChatMessage?.selectionSource === "email" ? activeChatMessage.selectionMessageID : undefined) || focusEmailMessageID
                : undefined}
              activeEmailSelection={activeEmailSelection}
              emailHighlightRemovalRequest={emailHighlightRemovalRequest}
              onSelectMessage={(messageID) => openBlockEmail(block.id, messageID)}
              onClearSelectedMessage={() => clearBlockEmail(block.id)}
              onRemoveEmail={(emailID) => { void removeAttachedEmail(emailID); }}
              onReplyEditorFocus={() => {
                setActiveRowBlockID(block.id);
                setEmailReplyBlockID(block.id);
                setFocusedTextBlockID("");
                if (formattingControllerRef) formattingControllerRef.current = null;
              }}
              onEmailSelectionChatRequest={(messageID, selection) => openSelectionChat({
                blockID: block.id,
                source: "email",
                messageID,
                quote: selection.quote,
                startOffset: selection.startOffset,
                endOffset: selection.endOffset,
                x: selection.x,
                y: selection.y,
              }, chatBlockID)}
              onEmailSelectionNodeRequest={(messageID, quote) => { void createNodeFromEmailSelection(messageID, quote); }}
              onError={onError}
            />
          );
          const toggleChat = () => {
            setFocusedTextBlockID("");
            if (chatPaneIsVisible) {
              setActiveChatBlockID("");
              setOpenChatBlockIDs((current) => {
                if (!current.has(chatBlockID)) return current;
                const next = new Set(current);
                next.delete(chatBlockID);
                return next;
              });
              setClosedChatBlockIDs((current) => {
                const next = new Set(current);
                next.add(chatBlockID);
                return next;
              });
              return;
            }
            setClosedChatBlockIDs((current) => {
              if (!current.has(chatBlockID)) return current;
              const next = new Set(current);
              next.delete(chatBlockID);
              return next;
            });
            setOpenChatBlockIDs((current) => {
              if (current.has(chatBlockID)) return current;
              const next = new Set(current);
              next.add(chatBlockID);
              return next;
            });
            setActiveChatBlockID(chatBlockID);
          };
          const focusChat = () => {
            setActiveRowBlockID(block.id);
            setFocusedTextBlockID("");
            setOpenChatBlockIDs((current) => {
              if (current.has(chatBlockID)) return current;
              const next = new Set(current);
              next.add(chatBlockID);
              return next;
            });
            setClosedChatBlockIDs((current) => {
              if (!current.has(chatBlockID)) return current;
              const next = new Set(current);
              next.delete(chatBlockID);
              return next;
            });
            setActiveChatBlockID(chatBlockID);
          };
          const toggleEditor = () => {
            if (editorPaneIsVisible) {
              setFocusedTextBlockID("");
              if (formattingControllerRef) formattingControllerRef.current = null;
            }
            setClosedEditorBlockIDs((current) => {
              const next = new Set(current);
              if (editorPaneIsVisible) next.add(block.id);
              else next.delete(block.id);
              return next;
            });
            setOpenEditorBlockIDs((current) => {
              const next = new Set(current);
              if (editorPaneIsVisible) next.delete(block.id);
              else next.add(block.id);
              return next;
            });
          };
          const replyToMessage = (messageID: string) => {
            focusChat();
            setChatReplyTargets((current) => ({ ...current, [chatBlockID]: messageID }));
            setChatSelectionAnchors((current) => {
              if (!(chatBlockID in current)) return current;
              const next = { ...current };
              delete next[chatBlockID];
              return next;
            });
          };
          const activateChatMessage = (messageID: string) => {
            focusChat();
            setActiveChatMessageIDs((current) => {
              const next = { ...current };
              if (next[chatBlockID] === messageID) {
                delete next[chatBlockID];
                return next;
              }
              next[chatBlockID] = messageID;
              return next;
            });
          };
          const revealChatMessage = (messageID: string) => {
            focusChat();
            setActiveChatMessageIDs((current) => ({ ...current, [chatBlockID]: messageID }));
            setChatMessageFocusRequest((current) => ({
              blockID: chatBlockID,
              messageID,
              requestID: (current?.requestID ?? 0) + 1,
            }));
          };
          const clearReplyTarget = () => {
            setChatReplyTargets((current) => {
              if (!current[chatBlockID]) return current;
              const next = { ...current };
              delete next[chatBlockID];
              return next;
            });
          };
          const clearSelectionAnchor = () => {
            setChatSelectionAnchors((current) => {
              if (!(chatBlockID in current)) return current;
              const next = { ...current };
              delete next[chatBlockID];
              return next;
            });
          };
          return (
            <React.Fragment key={block.id}>
              <div style={{ height: TEXT_BLOCK_ROW_HEIGHT + TEXT_BLOCK_ROW_GAP, paddingBottom: TEXT_BLOCK_ROW_GAP, boxSizing: "border-box", overflow: "hidden" }}>
                <TimelineCell accent={accent} muted={false} isLast={index === blocks.length - 1} />
              </div>
              <div style={{ minWidth: 0, height: TEXT_BLOCK_ROW_HEIGHT + TEXT_BLOCK_ROW_GAP, paddingBottom: TEXT_BLOCK_ROW_GAP, boxSizing: "border-box", overflow: "hidden" }}>
                <div
                  data-node-text-box-row={block.id}
                  className="mango-fixed-editor-row"
                  style={{ height: TEXT_BLOCK_ROW_HEIGHT, minWidth: 0, display: "grid", gridTemplateRows: "38px minmax(0, 1fr)", borderWidth: 1, borderStyle: "solid", borderColor: textBlockIsFocused ? "transparent" : blockEmailAccent || EDITOR_NEU_SOFT_BORDER, borderLeftWidth: blockEmailAccent ? 4 : 1, borderLeftColor: blockEmailAccent || (textBlockIsFocused ? "transparent" : EDITOR_NEU_SOFT_BORDER), borderRadius: 14, background: blockEmailAccent ? `linear-gradient(135deg, ${blockEmailAccent}16, rgba(255,255,255,0.96))` : `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${textBlockIsFocused ? EDITOR_NEU_EDGE_FRAME : "linear-gradient(135deg, rgba(255,255,255,0.76), rgba(255,255,255,0.76))"} border-box`, overflow: "hidden", boxShadow: textBlockIsFocused ? "8px 8px 20px rgba(174,174,192,0.26), -7px -7px 16px rgba(255,255,255,0.92), 0 0 18px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.88)" : EDITOR_NEU_SHADOW }}
                >
                  <div style={{ minWidth: 0, overflowX: "auto", overflowY: "hidden", borderBottom: `1px solid ${ruleColor}`, background: blockEmailAccent ? `linear-gradient(90deg, ${blockEmailAccent}30, ${blockEmailAccent}0c 54%, rgba(255,255,255,0.88))` : "linear-gradient(90deg, rgba(255,241,242,0.62), rgba(236,253,245,0.42) 52%, rgba(239,246,255,0.66))" }}>
                    <div style={{ minWidth: Math.max(448, minimumCommunicationWidth), height: 37, display: "grid", gridTemplateColumns: `${blockEmailAccent ? 112 : 44}px minmax(360px, 1fr) ${chatPaneIsVisible ? chatPaneWidth : 44}px`, alignItems: "center", gap: 4, padding: "4px 6px", boxSizing: "border-box" }}>
                      <div style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                        {blockEmailAccent && <span title="This text box is linked to an email message" style={{ minWidth: 0, display: "inline-flex", alignItems: "center", gap: 5, color: blockEmailAccent, fontSize: 10, fontWeight: 900 }}><MailIcon color={blockEmailAccent} />Linked email</span>}
                      </div>
                      <div style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <button type="button" title={editorPaneIsVisible ? "Hide text editor" : "Open text editor"} aria-label="Toggle text editor column" aria-pressed={editorPaneIsVisible} onClick={toggleEditor} style={{ width: 28, height: 26, flex: "0 0 auto", borderRadius: 8, border: editorPaneIsVisible ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: editorPaneIsVisible ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", boxShadow: EDITOR_NEU_SHADOW }}>
                          <TextEditorIcon color={accent} />
                        </button>
                        <span title={`Last Updated: ${formatTextBlockMetadataTimestamp(block.updatedTimestamp)} | Created: ${formatTextBlockMetadataTimestamp(block.createdTimestamp)}`} style={{ minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.58, fontSize: 10, fontWeight: 800 }}>
                          Last Updated: {formatTextBlockMetadataTimestamp(block.updatedTimestamp)} | Created: {formatTextBlockMetadataTimestamp(block.createdTimestamp)}
                        </span>
                        {canEdit && (
                          <label title="Add attachment" aria-label="Add attachment" style={{ width: 26, height: 24, flex: "0 0 auto", borderRadius: 8, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", boxShadow: EDITOR_NEU_SHADOW }}>
                            <PaperclipIcon color={accent} />
                            <input type="file" multiple style={{ display: "none" }} onChange={(event) => {
                              const files = event.currentTarget.files;
                              if (files) void addTextBlockAttachments(block.id, files);
                              event.currentTarget.value = "";
                            }} />
                          </label>
                        )}
                        <AttachmentCountDropdown items={blockAttachmentDropdownItems} apiBase={apiBase} companyID={companyID} accent={accent} surfaceText={surfaceText} compact loading={nodeAttachmentsLoading} loadError={nodeAttachmentsLoadError} onRetry={refreshNodeAttachments} onRemove={canEdit ? (item) => { void removeNodeAttachment(item.resourceAttachment); } : undefined} onError={onError} />
                        {canEdit && <TextBlockActionsMenu accent={accent} surfaceText={surfaceText} panelBackground={panelBackground} strokeColor={strokeColor} onDelete={(position) => requestDeleteTextBlock(block.id, position)} />}
                      </div>
                      <div style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
                        {emailOriginPrimaryRow && emailChatParticipantRoster}
                        <button type="button" title={chatPaneIsVisible ? "Hide chat" : "Open chat"} aria-label="Toggle chat column" aria-pressed={chatPaneIsVisible} onClick={toggleChat} style={{ width: 28, height: 26, borderRadius: 8, border: chatPaneIsVisible ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: chatPaneIsVisible ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", boxShadow: EDITOR_NEU_SHADOW }}>
                          <ChatIcon color={accent} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div style={{ minWidth: 0, minHeight: 0, overflowX: "auto", overflowY: "hidden" }}>
                    <div data-node-text-box-columns="editor-chat" style={{ minWidth: Math.max(minimumCommunicationWidth, 1), height: TEXT_BLOCK_MIN_HEIGHT, display: "grid", gridTemplateColumns: blockCommunicationGridTemplateColumns, columnGap: 0, alignItems: "stretch" }}>
                      {emailPaneIsMounted && (
                        <div style={{ minWidth: 0, height: TEXT_BLOCK_MIN_HEIGHT, display: emailPaneIsVisible ? "block" : "none", borderRight: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: panelBackground, overflow: "hidden" }}>
                          {blockEmailPane}
                        </div>
                      )}
                      {emailPaneIsVisible && renderTextSidePaneResizeHandle(block.id, "email", "after", emailPaneWidth, emailPaneMaxWidth)}
                      {editorPaneIsVisible && (
                        <div style={{ minWidth: 0, height: TEXT_BLOCK_MIN_HEIGHT, overflow: "hidden" }}>
                          <NodeTextBlockEditor
                            blockID={block.id}
                            editable={editorTextCanEdit}
                            nodeID={nodeID}
                            apiBase={apiBase}
                            companyID={companyID}
                            attachmentResourceType="node"
                            attachmentResourceID={nodeID}
                            attachmentRequestJSON={requestJSON}
                            attachmentEditorSurface="node_text_block"
                            currentUserID={author.userID || "local-user"}
                            companyUsers={companyUsers}
                            documentValue={block.document}
                            contentChanges={unseenChangesByBlockID.get(block.id) ?? []}
                            focusContentChangeID={unseenChanges.some((change) => change.change_id === focusInformationID && change.information_id === block.id) ? focusInformationID : undefined}
                            chatMessages={messages}
                            pendingChatSelectionAnchor={selectionAnchor}
                            activeChatAnchorMessageID={activeChatAnchorMessageID}
                            chatNavigationRequest={chatNavigationRequest?.blockID === chatBlockID ? { anchorMessageID: chatNavigationRequest.anchorMessageID, requestID: chatNavigationRequest.requestID } : null}
                            documentScrollMemoryRef={documentScrollMemoryRef}
                            surfaceText={surfaceText}
                            accent={accent}
                            outlineStyle={outlineStyle}
                            indentGuideColor={ruleColor}
                            scrollbarTrack={scrollbarTrack}
                            onFocus={() => {
                              setActiveRowBlockID(block.id);
                              setFocusedTextBlockID(block.id);
                            }}
                            onBlur={() => undefined}
                            onDocumentChange={(document) => updateTextBlockContent(block.id, { document })}
                            onDocumentFlush={(document) => updateTextBlockContent(block.id, { document })}
                            onDocumentConflict={() => onError("Mango is recovering this text box from its committed snapshot.")}
                            onChangeSeen={onMarkChangeSeen}
                            onChatHighlightActivate={revealChatMessage}
                            onSelectionChatRequest={(selection) => openSelectionChat(selection, chatBlockID)}
                            onImageChatRequest={addImageChatComment}
                            onImageNodeRequest={(image) => { void createNodeFromImage(image); }}
                            formattingControllerRef={formattingControllerRef}
                            formattingControllerActive={textBlockIsFocused}
                            onSelectionFontSizeChange={onSelectionFontSizeChange}
                            onSelectionInlineFormatChange={onSelectionInlineFormatChange}
                            onSelectionHighlightColorChange={onSelectionHighlightColorChange}
                            onSelectionTextAlignmentChange={onSelectionTextAlignmentChange}
                          />
                        </div>
                      )}
                      {chatPaneIsVisible && renderTextSidePaneResizeHandle(chatBlockID, "chat", "before", chatPaneWidth, chatPaneMaxWidth)}
                      {chatPaneIsVisible && (
                        <div style={{ minWidth: 0, height: TEXT_BLOCK_MIN_HEIGHT, borderLeft: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, overflow: "hidden" }}>
                          <ChatPane
                    blockID={chatBlockID}
                    editable={canEdit}
                    apiBase={apiBase}
                    companyID={companyID}
                    messages={messages}
                    headerTrailing={emailOriginPrimaryRow ? emailChatParticipantRoster : undefined}
                    selectionAnchor={selectionAnchor}
                    draft={chatDrafts[chatBlockID] ?? ""}
                    companyUsers={companyUsers}
                    active={chatIsActive}
                    currentUserID={author.userID}
                    activeMessageID={activeChatMessageID}
                    messageFocusRequest={chatMessageFocusRequest?.blockID === chatBlockID
                      ? { messageID: chatMessageFocusRequest.messageID, requestID: chatMessageFocusRequest.requestID }
                      : null}
                    composerFocusRequestID={chatComposerFocusRequestIDs[chatBlockID] ?? 0}
                    accent={accent}
                    surfaceText={surfaceText}
                    panelBackground={panelBackground}
                    strokeColor={strokeColor}
                    ruleColor={ruleColor}
                    replyTargetID={chatReplyTargets[chatBlockID] ?? ""}
                    draftAttachments={chatDraftAttachments[chatBlockID] ?? []}
                    heightStorageKey={`node-editor-chat-pane-height-v1:${companyID}:${nodeID}:${chatBlockID}`}
                    fixedHeight={TEXT_BLOCK_MIN_HEIGHT}
                    onFocus={focusChat}
                    onDraftChange={(draft) => setChatDrafts((current) => ({ ...current, [chatBlockID]: draft }))}
                    onActivateMessage={activateChatMessage}
                    onNavigateToMessage={(messageID) => navigateToChatMessage(chatBlockID, messages, messageID)}
                    onReply={replyToMessage}
                    onDeleteMessage={(messageID) => { void deleteChatMessage(messageID); }}
                    onClearReply={clearReplyTarget}
                    onClearSelectionAnchor={clearSelectionAnchor}
                    onAttachFiles={(files) => { void addChatDraftAttachments(chatBlockID, files); }}
                    onRemoveDraftAttachment={(attachmentID) => removeChatDraftAttachment(chatBlockID, attachmentID)}
                    onSubmit={() => { void submitChat(chatBlockID); }}
                  />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
        </div>
        </div>

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

      {nodeEmailModalMessageID && (
        <AppModalPortal onRequestClose={() => setNodeEmailModalMessageID("")}>
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setNodeEmailModalMessageID("");
          }}
          style={{ position: "fixed", zIndex: 1, inset: 0, display: "grid", placeItems: "stretch", background: "rgba(15,23,42,0.44)", padding: 12 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="node-attached-email-dialog-title"
            style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "44px minmax(0, 1fr)", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: panelBackground, color: surfaceText, overflow: "hidden", boxShadow: "0 24px 64px rgba(15,23,42,0.28)" }}
          >
            <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 32px", alignItems: "center", gap: 10, borderBottom: `1px solid ${ruleColor}`, padding: "6px 8px 6px 12px", background: EDITOR_NEU_SURFACE }}>
              <div id="node-attached-email-dialog-title" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 900 }}>
                Attached emails
              </div>
              <button
                type="button"
                title="Close attached emails"
                aria-label="Close attached emails"
                onClick={() => setNodeEmailModalMessageID("")}
                style={{ width: 30, height: 30, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: surfaceText, cursor: "pointer", fontSize: 14, fontWeight: 900, lineHeight: 1, padding: 0, boxShadow: EDITOR_NEU_SHADOW }}
              >
                X
              </button>
            </div>
            <div style={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>
              <AttachedEmailOrganizerPane
                emails={nodeAttachedEmails}
                nodeID={nodeID}
                apiBase={apiBase}
                companyID={companyID}
                companyUsers={companyUsers}
                attachmentRequestJSON={requestJSON}
                storageKey={`node-editor-attached-email-layout-v1:${companyID || "company"}:${nodeID || "node"}`}
                editable={canEdit}
                accent={accent}
                surfaceText={surfaceText}
                strokeColor={strokeColor}
                ruleColor={ruleColor}
                selectedMessageID={nodeEmailModalMessageID}
                onSelectMessage={setNodeEmailModalMessageID}
                onClearSelectedMessage={() => setNodeEmailModalMessageID("")}
                onRemoveEmail={canEdit ? (emailID) => { void removeAttachedEmail(emailID); } : undefined}
                onReplyEditorFocus={() => {
                  setFocusedTextBlockID("");
                  if (formattingControllerRef) formattingControllerRef.current = null;
                }}
                onError={onError}
              />
            </div>
          </div>
        </div>
        </AppModalPortal>
      )}
      {canEdit && emailPickerTargetBlockID !== null && (
        <EmailPickerModal
          accent={accent}
          surfaceText={surfaceText}
          panelBackground={panelBackground}
          strokeColor={strokeColor}
          onClose={() => setEmailPickerTargetBlockID(null)}
          onAttach={(message, scope) => { void attachEmail(messageAttachmentPayload(message, scope.sharedInboxID, scope.accountEmail)); }}
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
          position={deleteTextBlockConfirmation.position}
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
