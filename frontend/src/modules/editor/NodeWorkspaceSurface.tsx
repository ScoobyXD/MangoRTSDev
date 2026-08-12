import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu.js";
import { useAppFloatingMenuDismissal } from "../../app/AppModalPortal.js";
import { fetchCurrentUser } from "../../auth/cognitoAuth";
import { isAbortError } from "../api/requestJSON";
import { openEditorEntityLink, type EditorEntityLink } from "./editorEntityLinks.js";
import { humanLabelOrFallback } from "../entityLabels.js";
import type { LogicGateRecord } from "../logic-gates/types";
import { listKanbanBoards } from "../kanban/kanbanApi.js";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED } from "../dashboardEvents";
import { ExplorerEntityIcon, ExplorerRowIcon } from "../../icons/index.js";
import { foldCommittedEntityTitlesSince, readCommittedEntityTitleVersion, subscribeCommittedEntityTitleUpdates } from "../realtime/committedEntityTitleUpdates";
import { reconcileCommittedLogicGateRecordTitles } from "../realtime/committedTitleSnapshotReconciliation";
import {
  listProjectRelationshipsForResource,
  upsertProjectRelationship,
  type ProjectRelationshipProjection,
} from "../project-management/projectManagementApi";
import { scheduleTransientInformationFocus } from "./transientInformationFocus.js";
import {
  filterMangoResourceAttachments,
  groupMangoResourceAttachmentsByInformationID,
  invalidateMangoResourceAttachmentsCache,
  listMangoResourceAttachments,
  deleteMangoAttachmentPermanently,
  type MangoAttachmentUploadProgress,
  type MangoResourceAttachment,
} from "../attachments/attachmentApi";
import {
  buildEditorAttachedEmailPayload,
  buildEditorTextBlockChatPayload,
  EDITOR_ATTACHED_EMAIL_TYPE,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  canDeleteEditorTextBlockChatMessage,
  canEditEditorTextBlockChatMessage,
  listEditorTextBlockProjections,
  parseEditorAttachedEmails,
  parseEditorTextBlockContent,
  parseEditorTextBlockChats,
  type EditorAttachedEmail,
  type EditorChatAttachment,
  type EditorTextBlockContent,
  type EditorTextBlockChatMessage,
} from "./editorProjection";
import { editorChatEntityLinkPayloads, remapEditorChatEntityLinks, trimEditorChatDraft, type EditorChatEntityLink } from "./chatEntityLinks.js";
import { EDITOR_AUTOSAVE_DELAY_MS, generateStableInformationID } from "./editorTypes";
import { createTextBlockProjectionSaveController } from "./nodeTextBlockProjectionSaves";
import {
  appendUniqueEditorAttachments,
  editorChatAttachmentsReadyForSubmit,
  failEditorChatAttachmentTransfer,
  resolveEditorChatAttachmentTransfer,
  formatNodeAttachmentListError,
  stageEditorChatAttachmentTransfer,
  transferTextBlockImageToChatDraft,
  nodeAttachmentUploadScopeMatches,
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
import { useMangoEditorDataFormat } from "./editorDataFormat";
import { markEditorHistoryChanged } from "./editorExitHistory.js";
import {
  UniversalEntityPicker,
  type UniversalEntityPickerAnchor,
  type UniversalEntityPickerMode,
} from "./UniversalEntityPicker.js";
import { flushMangoTiptapDocument } from "./tiptap/mangoTiptapFlushRegistry.js";
import { mangoTiptapPendingStorageKey } from "./tiptap/mangoTiptapSync.js";
import { serializeMangoTiptapDocument } from "./tiptap/mangoTiptapDocument.js";
import { groupNodeTimelineEventsByTextBlock } from "./nodeTimelineOrdering";
import { EditorSavedTimestamp, EditorSaveStatusIcon, editorSaveNeedsFailureAttention } from "./EditorSaveStatusIcon.js";

import {
  AttachedEmailOrganizerPane,
  AttachmentCountDropdown,
  ChatPane,
  DeleteTextBlockConfirmationModal,
  LinkedEmailPreviewPane,
  NodeTextBlockEditor,
  removeStoredEmailLocalHighlight,
  TextBlockActionsMenu,
  TimelineCell,
  type EmailChatHighlightsByMessageID,
  type EmailHighlightRemovalRequest,
  type AttachmentUploadDropdownItem,
} from "./NodeWorkspaceSurfaceParts";
import {
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
  parseDraggedEmail,
  PlusIcon,
  TextEditorIcon,
  TEXT_BLOCK_HEADER_CHROME_HEIGHT,
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
import {
  createEmailLinkedNodeTextBlockContent,
  createOrdinaryNodeTextBlockContent,
  defaultOpenTextBlockChatIDs,
  nextNodeTextBlockColor,
} from "./nodeTextBlockCreation";
import { mentionUserDisplayName, splitTextByMentions, type MentionableCompanyUser } from "./editorMentions";

const TEXT_TIMELINE_COLUMN_WIDTH_PX = 34;
const TEXT_TIMELINE_COMPACT_COLUMN_WIDTH_PX = 34;
const TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX = 8;
const TEXT_CHAT_GRID_COLUMN_GAP_PX = 4;
const TEXT_CHAT_HORIZONTAL_PADDING_PX = 28;
const TEXT_BLOCK_RESIZE_MIN_WIDTH_PX = 160;
const TEXT_SIDE_PANE_DEFAULT_WIDTH_PX = 360;
const TEXT_CHAT_PANE_DEFAULT_WIDTH_PX = 340;
const TEXT_SIDE_PANE_MIN_WIDTH_PX = 300;
const TEXT_SIDE_PANE_MAX_WIDTH_PX = 1400;
const NODE_EMAIL_COLUMN_LAYOUT_ID = "__node_email_column__";
const NODE_EMAIL_COLUMN_BOTTOM_GUTTER_PX = 18;
const NODE_HEADER_LINK_TARGET_TYPES = ["logic_gate", "project", "email_message"] as const;

type NodeTimelineEvent = import("../nodes/nodeRecordStore").NodeTimelineEventItem;
const EMPTY_NODE_TIMELINE_EVENTS: NodeTimelineEvent[] = [];
const TEXT_SIDE_PANE_WIDTH_STORAGE_KEY_PREFIX = "node-editor-side-pane-width-v2";
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

function textBlockHasEmailMessage(block: Pick<TextBlockState, "emailMessageID">, messageID: string): boolean {
  const cleanMessageID = messageID.trim();
  if (!cleanMessageID) return false;
  return block.emailMessageID?.trim() === cleanMessageID;
}

function clampTextSidePaneWidth(value: number, maxWidth = TEXT_SIDE_PANE_MAX_WIDTH_PX): number {
  if (!Number.isFinite(value)) return TEXT_SIDE_PANE_DEFAULT_WIDTH_PX;
  const safeMaxWidth = Math.max(TEXT_SIDE_PANE_MIN_WIDTH_PX, Math.min(TEXT_SIDE_PANE_MAX_WIDTH_PX, Math.round(maxWidth)));
  return Math.max(TEXT_SIDE_PANE_MIN_WIDTH_PX, Math.min(safeMaxWidth, Math.round(value)));
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

function nodeTimelineErrorMessage(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : fallback;
  if (message === "verification_recipients_required") {
    return "Add at least one person to Accountable before requesting a verify stamp.";
  }
  if (message.toLowerCase() === "failed to fetch") {
    return "Could not reach the server. Check your connection and try again.";
  }
  return message;
}

const TimelineClockIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg data-node-timeline-clock-icon="true" aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <circle cx="8" cy="8" r="5.7" fill="none" stroke={color} strokeWidth="1.45" />
    <path d="M8 4.65v3.6l2.55 1.5" fill="none" stroke={color} strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TimelineLogicGateLink: React.FC<{
  logicGateID: string;
  logicGateName: string;
  position: "from" | "to";
}> = ({ logicGateID, logicGateName, position }) => {
  const cleanLogicGateID = logicGateID.trim();
  const content = (
    <>
      <span data-node-timeline-gate-icon={position} aria-hidden="true" style={{ display: "inline-flex" }}><ExplorerRowIcon kind="logic_gate" /></span>
      <strong>{logicGateName}</strong>
    </>
  );
  if (!cleanLogicGateID) {
    return <span className="mango-editor-entity-link mango-editor-entity-link--logic_gate" style={{ margin: 0, cursor: "default", pointerEvents: "none" }}>{content}</span>;
  }
  return (
    <button
      type="button"
      className="mango-editor-entity-link mango-editor-entity-link--logic_gate"
      data-node-timeline-logic-gate-link={position}
      aria-label={`Open Logic Gate ${logicGateName}`}
      title={`Open Logic Gate: ${logicGateName}`}
      onClick={() => openEditorEntityLink({ entityType: "logic_gate", entityID: cleanLogicGateID, label: logicGateName })}
      style={{ margin: 0 }}
    >
      {content}
    </button>
  );
};

const TimelineProjectLink: React.FC<{ projectID: string; projectName: string }> = ({ projectID, projectName }) => {
  const cleanProjectID = projectID.trim();
  const content = (
    <>
      <span data-node-timeline-project-icon="true" aria-hidden="true" style={{ display: "inline-flex" }}><ExplorerRowIcon kind="project" /></span>
      <strong>{projectName}</strong>
    </>
  );
  if (!cleanProjectID) {
    return <span className="mango-editor-entity-link mango-editor-entity-link--project" style={{ margin: 0, cursor: "default", pointerEvents: "none" }}>{content}</span>;
  }
  return (
    <button
      type="button"
      className="mango-editor-entity-link mango-editor-entity-link--project"
      data-node-timeline-project-link="true"
      aria-label={`Open Project ${projectName}`}
      title={`Open Project: ${projectName}`}
      onClick={() => openEditorEntityLink({ entityType: "project", entityID: cleanProjectID, label: projectName })}
      style={{ margin: 0 }}
    >
      {content}
    </button>
  );
};

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

function scrollNodeWorkspaceInformationIntoView(root: HTMLElement | null, informationID: string, mentionUserID?: string) {
  scheduleTransientInformationFocus({ root: () => root, informationID, mentionUserID });
}

export const NodeWorkspaceSurface: React.FC<NodeWorkspaceSurfaceProps> = ({
  companyID,
  nodeID,
  canEdit,
  assignedLogicGateIDs,
  apiBase,
  projections,
  initialTimelineEvents = EMPTY_NODE_TIMELINE_EVENTS,
  companyUsers,
  projectionsLoaded,
  editorSequence,
  hidden = false,
  focusInformationID,
  focusMentionUserID,
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
  onCreateNodeFromImage,
  onAssignToLogicGate,
  onSelectionFontSizeChange,
  onSelectionInlineFormatChange,
  onSelectionHighlightColorChange,
  onSelectionTextAlignmentChange,
  onFormattingControllerAvailabilityChange,
  onRegisterSaveController,
  onError,
}) => {
  const paneLayoutScope = `${companyID}\u001f${nodeID}`;
  const editorDataFormat = useMangoEditorDataFormat(apiBase, companyID, requestJSON);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const emailPickerLauncherRef = useRef<HTMLButtonElement | null>(null);
  const timelineCreateMenuRef = useRef<HTMLDivElement | null>(null);
  const saveTimersRef = useRef(new Map<string, number>());
  const attachmentUploadScopeRef = useRef({ companyID, nodeID, canEdit, generation: 0 });
  const nodeAttachmentUploadFilesRef = useRef(new Map<string, { file: File; blockID: string; controller?: AbortController }>());
  const contentByBlockRef = useRef(new Map<string, EditorTextBlockContent>());
  const temporaryEmailChatBlocksRef = useRef(new Map<string, TextBlockState>());
  const chatSubmissionsInProgressRef = useRef(new Set<string>());
  const documentScrollMemoryRef = useRef(createEditorScrollMemory());
  const focusBlockIDRef = useRef("");
  const handledFocusRequestRef = useRef("");
  const loadedNodeScopeRef = useRef("");
  const initialPaneLayoutRef = useRef(readStoredTextPaneLayout(companyID, nodeID));
  const paneLayoutReadyScopeRef = useRef("");
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [blocks, setBlocks] = useState<TextBlockState[]>([]);
  const [textBlockSaveFailures, setTextBlockSaveFailures] = useState<Record<string, boolean>>({});
  const [chatMessages, setChatMessages] = useState<EditorTextBlockChatMessage[]>([]);
  const [attachedEmails, setAttachedEmails] = useState<EditorAttachedEmail[]>([]);
  const [nodeResourceAttachments, setNodeResourceAttachments] = useState<MangoResourceAttachment[]>([]);
  const [nodeAttachmentsLoading, setNodeAttachmentsLoading] = useState(false);
  const [nodeAttachmentsLoadError, setNodeAttachmentsLoadError] = useState("");
  const [nodeAttachmentsRefreshKey, setNodeAttachmentsRefreshKey] = useState(0);
  const [nodeAttachmentUploads, setNodeAttachmentUploads] = useState<AttachmentUploadDropdownItem[]>([]);
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [chatDraftEntityLinks, setChatDraftEntityLinks] = useState<Record<string, EditorChatEntityLink[]>>({});
  const [chatDraftAttachments, setChatDraftAttachments] = useState<Record<string, EditorChatAttachment[]>>({});
  const [chatReplyTargets, setChatReplyTargets] = useState<Record<string, string>>({});
  const [chatSelectionAnchors, setChatSelectionAnchors] = useState<Record<string, TextBlockSelectionAnchor>>({});
  const [pendingEmailChatSelection, setPendingEmailChatSelection] = useState<TextBlockSelectionDraft | null>(null);
  const [flashedEmailChatDestinationBlockID, setFlashedEmailChatDestinationBlockID] = useState("");
  const [activeChatMessageIDs, setActiveChatMessageIDs] = useState<Record<string, string>>({});
  const [activeChatBlockID, setActiveChatBlockID] = useState(initialPaneLayoutRef.current.activeChatBlockID ?? "");
  const [selectedEmailIDsByBlock, setSelectedEmailIDsByBlock] = useState<Record<string, string>>(() => initialPaneLayoutRef.current.selectedEmailIDsByBlock);
  const [openEditorBlockIDs, setOpenEditorBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.openEditorBlockIDs));
  const [openEmailBlockIDs, setOpenEmailBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.openEmailBlockIDs));
  const [openChatBlockIDs, setOpenChatBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.openChatBlockIDs));
  const [sidePaneWidths, setSidePaneWidths] = useState<Record<string, Partial<Record<TextSidePaneKind, number>>>>({});
  const [chatNavigationRequest, setChatNavigationRequest] = useState<{ blockID: string; anchorMessageID: string; requestID: number } | null>(null);
  const chatNavigationRequestIDRef = useRef(0);
  const [chatMessageFocusRequest, setChatMessageFocusRequest] = useState<{ blockID: string; messageID: string; requestID: number } | null>(null);
  const [chatComposerFocusRequestIDs, setChatComposerFocusRequestIDs] = useState<Record<string, number>>({});
  const [emailHighlightRemovalRequest, setEmailHighlightRemovalRequest] = useState<EmailHighlightRemovalRequest | null>(null);
  const [nodeEmailNavigationRequest, setNodeEmailNavigationRequest] = useState<{ messageID: string; blockID: string; requestID: number } | null>(null);
  const [closedEditorBlockIDs, setClosedEditorBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.closedEditorBlockIDs));
  const [closedEmailBlockIDs, setClosedEmailBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.closedEmailBlockIDs));
  const [closedChatBlockIDs, setClosedChatBlockIDs] = useState<Set<string>>(() => new Set(initialPaneLayoutRef.current.closedChatBlockIDs));
  const [focusedTextBlockID, setFocusedTextBlockID] = useState<string | null>(null);
  const [activeRowBlockID, setActiveRowBlockID] = useState("");
  const [tiptapPinnedBlockIDs, setTiptapPinnedBlockIDs] = useState<Set<string>>(() => new Set());
  const [emailReplyBlockID, setEmailReplyBlockID] = useState("");
  const [emailPickerAnchor, setEmailPickerAnchor] = useState<UniversalEntityPickerAnchor | null>(null);
  const [expandedLinkedEmailBlockIDs, setExpandedLinkedEmailBlockIDs] = useState<Set<string>>(() => new Set());
  const [pendingEmailReply, setPendingEmailReply] = useState<{ blockID: string; targetMessageID: string; replyAll: boolean; requestID: number } | null>(null);
  const [nodeEmailFocusExpanded, setNodeEmailFocusExpanded] = useState(false);
  const [assignedLogicGateRecords, setAssignedLogicGateRecords] = useState<LogicGateRecord[]>([]);
  const [lastAssignedLogicGateID, setLastAssignedLogicGateID] = useState("");
  const [lastAssignedLogicGateLabel, setLastAssignedLogicGateLabel] = useState("");
  const [projectRelationshipRefreshKey, setProjectRelationshipRefreshKey] = useState(0);
  const [nodeProjectRelationships, setNodeProjectRelationships] = useState<ProjectRelationshipProjection[]>([]);
  const [headerLinkPickerAnchor, setHeaderLinkPickerAnchor] = useState<UniversalEntityPickerAnchor | null>(null);
  useEffect(() => subscribeCommittedEntityTitleUpdates((update) => {
    if (update.companyID !== companyID || update.entityType !== "logic_gate") return;
    const resourceID = update.resourceID.trim();
    const title = update.title.trim();
    if (!resourceID || !title) return;
    setAssignedLogicGateRecords((current) => reconcileCommittedLogicGateRecordTitles(current, update));
    setLastAssignedLogicGateLabel((current) => lastAssignedLogicGateID.trim() === resourceID ? title : current);
  }), [companyID, lastAssignedLogicGateID]);
  const [dropActive, setDropActive] = useState(false);
  const [author, setAuthor] = useState({ userID: "", name: "You" });
  const [timelineEvents, setTimelineEvents] = useState<NodeTimelineEvent[]>([]);
  const [timelineEventsLoading, setTimelineEventsLoading] = useState(false);
  const [timelineEventsError, setTimelineEventsError] = useState("");
  const [timelineCreateMenuOpen, setTimelineCreateMenuOpen] = useState(false);
  const [verificationRequestPending, setVerificationRequestPending] = useState(false);
  const [verificationCompletionPendingID, setVerificationCompletionPendingID] = useState("");
  const editorTextCanEdit = canEdit && projectionsLoaded && Boolean(author.userID) && Boolean(editorDataFormat.gate);
  const formattingControllerAvailable = editorTextCanEdit && blocks.some((block) => block.id === focusedTextBlockID);
  useEffect(() => {
    onFormattingControllerAvailabilityChange?.(formattingControllerAvailable);
  }, [formattingControllerAvailable, onFormattingControllerAvailabilityChange]);
  useEffect(() => () => {
    onFormattingControllerAvailabilityChange?.(false);
  }, [onFormattingControllerAvailabilityChange]);
  const [deleteTextBlockConfirmation, setDeleteTextBlockConfirmation] = useState<{ blockID: string; title: string; chatCount: number; position: ConfirmActionMenuPosition } | null>(null);
  const autoCreatedTextBlockNodeIDsRef = useRef(new Set<string>());
  const emailChatDestinationFlashTimerRef = useRef<number | null>(null);
  const emailChatDestinationFlashFrameRef = useRef<number | null>(null);
  const flashEmailChatDestination = useCallback((blockID: string) => {
    if (emailChatDestinationFlashTimerRef.current !== null) window.clearTimeout(emailChatDestinationFlashTimerRef.current);
    if (emailChatDestinationFlashFrameRef.current !== null) window.cancelAnimationFrame(emailChatDestinationFlashFrameRef.current);
    setFlashedEmailChatDestinationBlockID("");
    emailChatDestinationFlashFrameRef.current = window.requestAnimationFrame(() => {
      emailChatDestinationFlashFrameRef.current = null;
      setFlashedEmailChatDestinationBlockID(blockID);
      emailChatDestinationFlashTimerRef.current = window.setTimeout(() => {
        emailChatDestinationFlashTimerRef.current = null;
        setFlashedEmailChatDestinationBlockID("");
      }, 1000);
    });
  }, []);
  useEffect(() => () => {
    if (emailChatDestinationFlashTimerRef.current !== null) window.clearTimeout(emailChatDestinationFlashTimerRef.current);
    if (emailChatDestinationFlashFrameRef.current !== null) window.cancelAnimationFrame(emailChatDestinationFlashFrameRef.current);
  }, []);
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
  useEffect(() => {
    if (nodeAttachedEmails.length === 0) setNodeEmailFocusExpanded(false);
  }, [nodeAttachedEmails.length]);

  const nodeFileAttachments = useMemo(() => filterMangoResourceAttachments(nodeResourceAttachments, {
    relationshipKind: "file_attachment",
  }), [nodeResourceAttachments]);
  const nodeTextBlockAttachmentsByInformationID = useMemo(() => groupMangoResourceAttachmentsByInformationID(
    filterMangoResourceAttachments(nodeFileAttachments, { editorSurface: "node_text_block" }),
  ), [nodeFileAttachments]);
  const nodeAttachmentDropdownItems = useMemo(() => nodeFileAttachments.map((resourceAttachment) => ({
    resourceAttachment,
  })), [nodeFileAttachments]);
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
  const editorGridTemplateColumns = compact
    ? `${TEXT_TIMELINE_COMPACT_COLUMN_WIDTH_PX}px minmax(0, 1fr)`
    : `${TEXT_TIMELINE_COLUMN_WIDTH_PX}px minmax(0, 1fr)`;
  const logicGateLabelByID = useMemo(() => {
    const labels = new Map<string, string>();
    for (const logicGate of assignedLogicGateRecords) {
      if (!logicGate.logic_gate_id || labels.has(logicGate.logic_gate_id)) continue;
      labels.set(logicGate.logic_gate_id, logicGateOptionLabel(logicGate));
    }
    return labels;
  }, [assignedLogicGateRecords]);
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
  const sortedNodeProjectRelationships = useMemo(() => (
    [...nodeProjectRelationships].sort((a, b) => (
      (b.relationship_updated_timestamp ?? "").localeCompare(a.relationship_updated_timestamp ?? "")
      || projectRelationshipLabel(a).localeCompare(projectRelationshipLabel(b), undefined, { numeric: true, sensitivity: "base" })
    ))
  ), [nodeProjectRelationships]);
  const primaryAssignedProject = sortedNodeProjectRelationships[0] ?? null;
  const primaryAssignedProjectID = primaryAssignedProject?.project_id?.trim() ?? "";
  const primaryAssignedProjectLabel = primaryAssignedProject ? projectRelationshipLabel(primaryAssignedProject) : "";
  const focusTargetBlockID = useMemo(() => {
    const targetID = focusInformationID?.trim() ?? "";
    const emailMessageID = focusEmailMessageID?.trim() ?? "";
    if (!targetID && !emailMessageID) return "";
    if (blocks.some((block) => block.id === targetID)) return targetID;
    const chatMessage = chatMessages.find((message) => message.id === targetID);
    if (chatMessage) return chatMessage.blockID;
    const attachedEmail = nodeAttachedEmails.find((email) => email.id === targetID || email.messageID === targetID || email.emailMessageID === emailMessageID);
    if (attachedEmail) {
      const linkedBlock = blocks.find((block) => textBlockHasEmailMessage(block, attachedEmail.emailMessageID))
        ?? (attachedEmail.blockID ? blocks.find((block) => block.id === attachedEmail.blockID) : undefined);
      return linkedBlock?.id || blocks[0]?.id || "";
    }
    if (emailMessageID) return blocks.find((block) => textBlockHasEmailMessage(block, emailMessageID))?.id || blocks[0]?.id || "";
    return "";
  }, [blocks, chatMessages, focusEmailMessageID, focusInformationID, nodeAttachedEmails]);
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
      const chatIndex = blocks.findIndex((block) => block.id === activeChatBlockID);
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
    for (const blockID of tiptapPinnedBlockIDs) {
      const pinnedIndex = blocks.findIndex((block) => block.id === blockID);
      if (pinnedIndex >= 0) indices.add(pinnedIndex);
    }
    if (expandedLinkedEmailBlockIDs.size > 0) {
      blocks.forEach((_block, index) => indices.add(index));
    }
    return Array.from(indices);
  }, [activeChatBlockID, activeRowBlockID, blocks, emailReplyBlockID, expandedLinkedEmailBlockIDs, focusedTextBlockID, tiptapPinnedBlockIDs]);
  const rowVirtualizer = useBoundedEditorRowVirtualization({
    itemCount: blocks.length,
    rowHeight: TEXT_BLOCK_ROW_HEIGHT,
    rowGap: TEXT_BLOCK_ROW_GAP,
    scrollElementRef: rootRef,
    targetIndex: focusTargetIndex >= 0 ? focusTargetIndex : null,
    targetRequestKey: `${nodeID}:${focusInformationID ?? ""}:${focusEmailMessageID ?? ""}:${focusRequestID ?? 0}`,
    pinnedIndices: pinnedRowIndices,
  });

  const timelineEventsByBlockIndex = useMemo(
    () => groupNodeTimelineEventsByTextBlock(blocks, timelineEvents),
    [blocks, timelineEvents],
  );
  const refreshNodeAttachments = useCallback(() => {
    invalidateMangoResourceAttachmentsCache(requestJSON, {
      apiBase,
      companyID,
      resourceType: "node",
      resourceID: nodeID,
    });
    setNodeAttachmentsRefreshKey((key) => key + 1);
  }, [apiBase, companyID, nodeID, requestJSON]);

  const deleteNodeAttachment = useCallback(async (resourceAttachment: MangoResourceAttachment) => {
    if (!canEdit) return;
    const attachmentID = resourceAttachment.attachment_id?.trim();
    if (!attachmentID) {
      onError("attachment_metadata_unavailable");
      return;
    }
    if (!window.confirm(`Permanently delete ${resourceAttachment.attachment?.original_filename || "this file"}? This removes the stored file and cannot be undone.`)) return;
    try {
      await deleteMangoAttachmentPermanently(requestJSON, {
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
    const updateSize = () => {
      const bounds = root.getBoundingClientRect();
      setWidth(bounds.width);
      setHeight(bounds.height);
    };
    updateSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }
    const observer = new ResizeObserver(updateSize);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setNodeEmailFocusExpanded(false);
    setLastAssignedLogicGateID("");
    setLastAssignedLogicGateLabel("");
    setHeaderLinkPickerAnchor(null);
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
        const message = formatNodeAttachmentListError(cause);
        setNodeResourceAttachments([]);
        setNodeAttachmentsLoadError(message);
        // Keep optional attachment-list failures local instead of raising a global editor error.
      })
      .finally(() => {
        if (!cancelled) setNodeAttachmentsLoading(false);
      });
    return () => { cancelled = true; };
  }, [apiBase, companyID, nodeAttachmentsRefreshKey, nodeID, onError, requestJSON]);

  useEffect(() => {
    if (canEdit) return;
    setTimelineCreateMenuOpen(false);
    setEmailPickerAnchor(null);
    setHeaderLinkPickerAnchor(null);
    setDropActive(false);
    setDeleteTextBlockConfirmation(null);
  }, [canEdit]);

  useAppFloatingMenuDismissal(timelineCreateMenuOpen, timelineCreateMenuRef, () => setTimelineCreateMenuOpen(false));

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
    temporaryEmailChatBlocksRef.current.clear();
    chatSubmissionsInProgressRef.current.clear();
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
        color: content.color?.trim().toUpperCase() ?? "",
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
    const serverBlockIDs = new Set(textBlocks.map((block) => block.id));
    const temporaryBlocks = Array.from(temporaryEmailChatBlocksRef.current.values()).filter((block) => !serverBlockIDs.has(block.id));
    const renderedTextBlocks = [...temporaryBlocks, ...textBlocks];
    setBlocks(renderedTextBlocks);
    contentByBlockRef.current = new Map(renderedTextBlocks.map((block) => [block.id, { title: block.title, document: block.document, attachments: block.attachments, emailMessageID: block.emailMessageID, color: block.color }]));
    textBlockProjectionSaveController.replaceBlocksAsHasNotChanged(textBlocks.map((block) => ({
      blockID: block.id,
      content: { title: block.title, document: block.document, attachments: block.attachments, emailMessageID: block.emailMessageID, color: block.color },
      revision: serverRevisionByInformationID.get(block.id) ?? 0,
    })));
    setChatMessages(parsedChatMessages);
    setAttachedEmails(parsedAttachedEmails);
    const nodeChanged = loadedNodeScopeRef.current !== paneLayoutScope;
    const blockIDs = new Set(renderedTextBlocks.map((block) => block.id));
    const chatBlockIDs = new Set(blockIDs);
    const defaultChatBlockIDs = defaultOpenTextBlockChatIDs(
      textBlocks.map((block) => block.id),
      parsedChatMessages,
    );
    const defaultChatBlockIDSet = new Set(defaultChatBlockIDs);
    setExpandedLinkedEmailBlockIDs((current) => {
      if (nodeChanged) return new Set();
      const linkedBlockIDs = new Set(textBlocks.filter((block) => Boolean(block.emailMessageID?.trim())).map((block) => block.id));
      return new Set(Array.from(current).filter((blockID) => linkedBlockIDs.has(blockID)));
    });
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
    if (nodeChanged) setPendingEmailChatSelection(null);
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
        return chatBlockIDs.has(candidate) && defaultChatBlockIDSet.has(candidate) ? candidate : "";
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
        const next = new Set((nodeChanged ? storedLayout?.openChatBlockIDs ?? [] : Array.from(current)).filter((id) => chatBlockIDs.has(id) && (!nodeChanged || defaultChatBlockIDSet.has(id))));
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
    void listKanbanBoards(apiBase, companyID, 200).then((boards) => {
      const boardByLogicGateID = new Map(boards.map((board) => [board.logic_gate_id?.trim() ?? "", board]));
      const records = ids.map((logicGateID): LogicGateRecord | null => {
        const board = boardByLogicGateID.get(logicGateID);
        return board ? {
          company_id: board.company_id,
          logic_gate_id: logicGateID,
          header: board.title,
          created_timestamp: board.created_timestamp,
        } : null;
      });
      if (!cancelled) setAssignedLogicGateRecords(foldCommittedEntityTitlesSince(
        records.filter((record): record is LogicGateRecord => Boolean(record)),
        companyID,
        titleVersionAtStart,
        reconcileCommittedLogicGateRecordTitles,
      ));
    });
    return () => { cancelled = true; };
  }, [apiBase, assignedLogicGateIDs, companyID]);
  useEffect(() => () => {
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
    if (!editorDataFormat.gate) throw new Error("editor_data_format_not_ready");
    const response = await requestJSON<{ projection_revision?: number }>(
      `/v1/editor-json/node/${nodeID}/documents/${blockID}?company_id=${encodeURIComponent(companyID)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ title: content.title, attachments: content.attachments ?? [], color: content.color }),
      },
    );
    const revision = response?.projection_revision ?? 0;
    if (!Number.isInteger(revision) || revision <= baseRevision) throw new Error("invalid_projection_revision_ack");
    onProjectionMutation();
    return { revision };
  }, [author.userID, canEdit, companyID, editorDataFormat.gate?.editor_format, nodeID, onProjectionMutation, requestJSON]);

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
    const unregister = onRegisterSaveController(nodeID, { flushPendingProjectionSaves: flushAllTextBlockProjectionSaves });
    return () => {
      void flushAllTextBlockProjectionSaves()
        .catch(() => undefined)
        .finally(unregister);
    };
  }, [flushAllTextBlockProjectionSaves, nodeID, onRegisterSaveController]);

  const scheduleTextBlockSave = useCallback((blockID: string, content: EditorTextBlockContent, markHistory = true) => {
    if (!editorTextCanEdit) return;
    if (markHistory) markEditorHistoryChanged({ companyID, resourceType: "node", resourceID: nodeID });
    contentByBlockRef.current.set(blockID, content);
    textBlockProjectionSaveController.markHasChanged(blockID, content);
    const existingTimer = saveTimersRef.current.get(blockID);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(blockID);
      textBlockProjectionSaveController.startLatestContentSave(blockID);
    }, EDITOR_AUTOSAVE_DELAY_MS);
    saveTimersRef.current.set(blockID, timer);
  }, [companyID, editorTextCanEdit, nodeID, textBlockProjectionSaveController]);

  const createTextBlock = useCallback((markHistory = true) => {
    if (!editorTextCanEdit) return;
    const now = new Date().toISOString();
    const blockID = generateStableInformationID();
    const initialContent = createOrdinaryNodeTextBlockContent();
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
      next.add(blockID);
      return next;
    });
    setOpenEditorBlockIDs((current) => new Set(current).add(blockID));
    setOpenChatBlockIDs((current) => {
      if (!current.has(blockID)) return current;
      const next = new Set(current);
      next.delete(blockID);
      return next;
    });
    if (markHistory) markEditorHistoryChanged({ companyID, resourceType: "node", resourceID: nodeID });
    textBlockProjectionSaveController.startLatestContentSave(blockID);
  }, [companyID, editorTextCanEdit, nodeID, textBlockProjectionSaveController]);

  const createEmailTextBlock = useCallback((messageID: string, quote = "") => {
    const cleanMessageID = messageID.trim();
    if (!editorTextCanEdit || !cleanMessageID) return "";
    const existingBlock = blocks.find((block) => textBlockHasEmailMessage(block, cleanMessageID));
    if (existingBlock) {
      focusBlockIDRef.current = existingBlock.id;
      setActiveRowBlockID(existingBlock.id);
      setOpenEditorBlockIDs((current) => new Set(current).add(existingBlock.id));
      setClosedEditorBlockIDs((current) => {
        if (!current.has(existingBlock.id)) return current;
        const next = new Set(current);
        next.delete(existingBlock.id);
        return next;
      });
      setFocusedTextBlockID(existingBlock.id);
      return existingBlock.id;
    }
    const now = new Date().toISOString();
    const blockID = generateStableInformationID();
    const sourceEmail = nodeAttachedEmails.find((email) => email.emailMessageID === cleanMessageID || email.id === cleanMessageID);
    const color = nextNodeTextBlockColor(blocks.map((block) => block.color ?? ""));
    const cleanQuote = quote.trim();
    const initialContent = createEmailLinkedNodeTextBlockContent({
      title: sourceEmail?.subject.trim() ? `Email: ${sourceEmail.subject.trim()}` : "Email text box",
      document: cleanQuote && typeof document !== "undefined" ? createEmailSelectionDocument(document, cleanQuote) : "",
      messageID: cleanMessageID,
      color,
    });
    focusBlockIDRef.current = blockID;
    contentByBlockRef.current.set(blockID, initialContent);
    textBlockProjectionSaveController.markHasChanged(blockID, initialContent);
    setBlocks((current) => [{
      id: blockID,
      title: initialContent.title,
      document: initialContent.document,
      attachments: [],
      emailMessageID: cleanMessageID,
      color,
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
      next.add(blockID);
      return next;
    });
    setOpenEditorBlockIDs((current) => new Set(current).add(blockID));
    setOpenChatBlockIDs((current) => {
      if (!current.has(blockID)) return current;
      const next = new Set(current);
      next.delete(blockID);
      return next;
    });
    setActiveRowBlockID(blockID);
    markEditorHistoryChanged({ companyID, resourceType: "node", resourceID: nodeID });
    setFocusedTextBlockID(blockID);
    textBlockProjectionSaveController.startLatestContentSave(blockID);
    return blockID;
  }, [blocks, companyID, editorTextCanEdit, nodeAttachedEmails, nodeID, textBlockProjectionSaveController]);

  const openEmailReplyInTextBlock = useCallback((sourceMessageID: string, targetMessageID: string, replyAll: boolean) => {
    const blockID = createEmailTextBlock(sourceMessageID);
    if (!blockID) return;
    setExpandedLinkedEmailBlockIDs((current) => new Set(current).add(blockID));
    setPendingEmailReply((current) => ({
      blockID,
      targetMessageID,
      replyAll,
      requestID: (current?.requestID ?? 0) + 1,
    }));
  }, [createEmailTextBlock]);

  const stageEmailSelectionChatTextBlock = useCallback((messageID: string) => {
    const cleanMessageID = messageID.trim();
    if (!editorTextCanEdit || !cleanMessageID) return "";
    const alreadyStaged = Array.from(temporaryEmailChatBlocksRef.current.values())
      .find((block) => textBlockHasEmailMessage(block, cleanMessageID));
    if (alreadyStaged) return alreadyStaged.id;
    const now = new Date().toISOString();
    const blockID = generateStableInformationID();
    const sourceEmail = nodeAttachedEmails.find((email) => email.emailMessageID === cleanMessageID || email.id === cleanMessageID);
    const color = nextNodeTextBlockColor(blocks.map((block) => block.color ?? ""));
    const initialContent = createEmailLinkedNodeTextBlockContent({
      title: sourceEmail?.subject.trim() ? `Email: ${sourceEmail.subject.trim()}` : "Email text box",
      messageID: cleanMessageID,
      color,
    });
    const temporaryBlock: TextBlockState = {
      id: blockID,
      title: initialContent.title,
      document: "",
      attachments: [],
      emailMessageID: cleanMessageID,
      color,
      temporaryEmailChat: true,
      createdTimestamp: now,
      updatedTimestamp: now,
      pending: false,
    };
    temporaryEmailChatBlocksRef.current.set(blockID, temporaryBlock);
    contentByBlockRef.current.set(blockID, initialContent);
    setBlocks((current) => [...current.filter((block) => block.id !== blockID), temporaryBlock]);
    setClosedEditorBlockIDs((current) => {
      if (!current.has(blockID)) return current;
      const next = new Set(current);
      next.delete(blockID);
      return next;
    });
    setOpenEditorBlockIDs((current) => new Set(current).add(blockID));
    setActiveRowBlockID(blockID);
    return blockID;
  }, [blocks, editorTextCanEdit, nodeAttachedEmails]);

  const cancelTemporaryEmailChatDraft = useCallback((blockID: string, anchor?: TextBlockSelectionAnchor) => {
    if (!temporaryEmailChatBlocksRef.current.has(blockID)) return false;
    temporaryEmailChatBlocksRef.current.delete(blockID);
    contentByBlockRef.current.delete(blockID);
    textBlockProjectionSaveController.removeBlock(blockID);
    setBlocks((current) => current.filter((block) => block.id !== blockID));
    setChatMessages((current) => current.filter((message) => message.blockID !== blockID));
    setChatDrafts((current) => {
      if (!(blockID in current)) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
    setChatDraftEntityLinks((current) => {
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
    setOpenEditorBlockIDs((current) => { const next = new Set(current); next.delete(blockID); return next; });
    setOpenChatBlockIDs((current) => { const next = new Set(current); next.delete(blockID); return next; });
    setClosedEditorBlockIDs((current) => { const next = new Set(current); next.delete(blockID); return next; });
    setClosedChatBlockIDs((current) => { const next = new Set(current); next.delete(blockID); return next; });
    setExpandedLinkedEmailBlockIDs((current) => { const next = new Set(current); next.delete(blockID); return next; });
    setActiveChatBlockID((current) => current === blockID ? "" : current);
    setActiveRowBlockID((current) => current === blockID ? "" : current);
    setFocusedTextBlockID((current) => current === blockID ? "" : current);
    if (anchor?.source === "email" && anchor.messageID?.trim() && anchor.quote.trim()) {
      const emailAnchor = {
        messageID: anchor.messageID.trim(),
        quote: anchor.quote.trim(),
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
      };
      removeStoredEmailLocalHighlight(emailAnchor.messageID, emailAnchor);
      setEmailHighlightRemovalRequest((current) => ({
        ...emailAnchor,
        requestID: (current?.requestID ?? 0) + 1,
      }));
    }
    return true;
  }, [textBlockProjectionSaveController]);

  useEffect(() => {
    if (!shouldCreateInitialTextBlock({
      canEdit,
      projectionsLoaded,
      nodeID,
      editorSequence,
      loadedTextBlockCount: loadedTextBlockProjections.length,
      renderedTextBlockCount: blocks.length,
      suppressAutomaticCreation: nodeAttachedEmails.length > 0,
    })) return;
    if (autoCreatedTextBlockNodeIDsRef.current.has(nodeID)) return;
    autoCreatedTextBlockNodeIDsRef.current.add(nodeID);
    createTextBlock(false);
  }, [blocks.length, canEdit, createTextBlock, editorSequence, loadedTextBlockProjections.length, nodeAttachedEmails.length, nodeID, projectionsLoaded]);

  const updateTextBlockContent = useCallback((blockID: string, patch: Partial<EditorTextBlockContent>, markHistory = true) => {
    if (!canEdit) return;
    const existing = contentByBlockRef.current.get(blockID) ?? { title: "", document: "", attachments: [] };
    const nextContent: EditorTextBlockContent = {
      title: patch.title ?? existing.title,
      document: patch.document ?? existing.document,
      attachments: patch.attachments ?? existing.attachments ?? [],
      emailMessageID: patch.emailMessageID ?? existing.emailMessageID,
      color: patch.color ?? existing.color,
    };
    setBlocks((current) => current.map((block) => {
      if (block.id !== blockID) return block;
      return { ...block, ...nextContent };
    }));
    if (patch.title !== undefined || patch.attachments !== undefined || patch.emailMessageID !== undefined || patch.color !== undefined) {
      scheduleTextBlockSave(blockID, nextContent, markHistory);
    }
  }, [canEdit, scheduleTextBlockSave]);

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
    if (!editorDataFormat.gate) {
      onError("editor_data_format_not_ready");
      return;
    }
    const timer = saveTimersRef.current.get(blockID);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      saveTimersRef.current.delete(blockID);
    }
    let snapshot;
    try {
      await flushMangoTiptapDocument({ companyID, resourceType: "node", resourceID: nodeID, documentID: blockID });
      snapshot = await textBlockProjectionSaveController.waitForInProgressSave(blockID);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_save_text_block_before_deletion");
      return;
    }
    if (!snapshot) return;
    const previousBlockIndex = blocks.findIndex((block) => block.id === blockID);
    const previousBlock = previousBlockIndex >= 0 ? blocks[previousBlockIndex] : undefined;
    setBlocks((current) => current.filter((block) => block.id !== blockID));
    // Attached-email projections and resource attachment links are node-owned and intentionally retained.
    const deletedInformationIDs = projectionIDsForTextBlockDeletion(blockID, chatMessages);
    try {
      for (const informationID of deletedInformationIDs) {
        try {
          if (informationID === blockID) {
            const editorPath = `/v1/editor-json/node/${nodeID}/documents/${blockID}?company_id=${encodeURIComponent(companyID)}`;
            const baseRevision = (await requestJSON<{ revision: number }>(editorPath)).revision;
            await requestJSON<unknown>(editorPath, {
              method: "DELETE",
              body: JSON.stringify({
                operation_id: generateStableInformationID(),
                client_id: `node-delete:${author.userID}`,
                base_revision: baseRevision,
              }),
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
      if (previousBlock) {
        setBlocks((current) => {
          if (current.some((block) => block.id === blockID)) return current;
          const next = [...current];
          next.splice(Math.min(previousBlockIndex, next.length), 0, previousBlock);
          return next;
        });
      }
      onError(cause instanceof Error ? cause.message : "failed_to_delete_text_block");
      onProjectionMutation();
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
    setExpandedLinkedEmailBlockIDs(removeDeletedBlockID);
    setActiveChatBlockID((current) => current === blockID ? "" : current);
    setFocusedTextBlockID((current) => current === blockID ? "" : current);
    markEditorHistoryChanged({ companyID, resourceType: "node", resourceID: nodeID });
    onProjectionMutation();
  }, [author.userID, blocks, canEdit, chatMessages, companyID, editorDataFormat.gate?.editor_format, nodeID, onError, onProjectionMutation, requestJSON, textBlockProjectionSaveController]);


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
    chatNavigationRequestIDRef.current += 1;
    setChatNavigationRequest({
      blockID: navigationBlockID,
      anchorMessageID,
      requestID: chatNavigationRequestIDRef.current,
    });
  }, []);
  const consumeChatNavigationRequest = useCallback((requestID: number) => {
    setChatNavigationRequest((current) => current?.requestID === requestID ? null : current);
  }, []);
  const submitChat = useCallback(async (blockID: string) => {
    if (!canEdit) return;
    if (chatSubmissionsInProgressRef.current.has(blockID)) return;
    const { message, entityLinks } = trimEditorChatDraft(chatDrafts[blockID] ?? "", chatDraftEntityLinks[blockID] ?? []);
    const attachments = chatDraftAttachments[blockID] ?? [];
    if (!editorChatAttachmentsReadyForSubmit(attachments)) return;
    if (!message && attachments.length === 0) return;
    const now = new Date().toISOString();
    const id = generateStableInformationID();
    const parentID = chatReplyTargets[blockID] ?? "";
    const selectionAnchor = parentID ? undefined : chatSelectionAnchors[blockID];
    const chatBlock = blocks.find((block) => block.id === blockID);
    const createsEmailTextBoxOnSend = temporaryEmailChatBlocksRef.current.has(blockID);
    const ensureEmailTextBoxLinkOnSend = selectionAnchor?.source === "email"
      && Boolean(selectionAnchor.messageID?.trim())
      && (createsEmailTextBoxOnSend || !textBlockHasEmailMessage(chatBlock ?? {}, selectionAnchor.messageID ?? ""));
    if (createsEmailTextBoxOnSend && !ensureEmailTextBoxLinkOnSend) return;
    const emailTextBoxColorOnSend = ensureEmailTextBoxLinkOnSend
      ? chatBlock?.color?.trim() || nextNodeTextBlockColor(blocks.map((block) => block.color ?? ""))
      : undefined;
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
      entityLinks,
      mentionedUserIDs,
    };
    setChatDrafts((current) => ({ ...current, [blockID]: "" }));
    setChatDraftEntityLinks((current) => {
      if (!current[blockID]?.length) return current;
      const next = { ...current };
      delete next[blockID];
      return next;
    });
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
    chatSubmissionsInProgressRef.current.add(blockID);
    try {
      await requestJSON<unknown>(`/v1/nodes/${nodeID}/information`, {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
          information: buildEditorTextBlockChatPayload({
            blockID,
            ensureEmailTextBoxLinkOnSend,
            emailTextBoxColorOnSend,
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
            entityLinks,
            mentionedUserIDs,
          }),
          information_id: id,
        }),
      });
      if (ensureEmailTextBoxLinkOnSend && selectionAnchor?.messageID) {
        temporaryEmailChatBlocksRef.current.delete(blockID);
        const content = contentByBlockRef.current.get(blockID);
        const linkedContent = content ? { ...content, emailMessageID: selectionAnchor.messageID, color: emailTextBoxColorOnSend } : undefined;
        if (linkedContent) {
          contentByBlockRef.current.set(blockID, linkedContent);
          if (createsEmailTextBoxOnSend) textBlockProjectionSaveController.replaceBlockAsHasNotChanged({ blockID, content: linkedContent, revision: 0 });
        }
        setBlocks((current) => current.map((block) => block.id === blockID
          ? { ...block, emailMessageID: selectionAnchor.messageID, color: emailTextBoxColorOnSend, temporaryEmailChat: false, pending: false }
          : block));
        markEditorHistoryChanged({ companyID, resourceType: "node", resourceID: nodeID });
      }
      onProjectionMutation();
    } catch (cause) {
      setChatMessages((current) => current.filter((item) => item.id !== id));
      setChatDrafts((current) => ({ ...current, [blockID]: message }));
      if (entityLinks.length > 0) setChatDraftEntityLinks((current) => ({ ...current, [blockID]: entityLinks }));
      if (attachments.length > 0) setChatDraftAttachments((current) => ({ ...current, [blockID]: attachments }));
      if (parentID) setChatReplyTargets((current) => ({ ...current, [blockID]: parentID }));
      if (selectionAnchor) setChatSelectionAnchors((current) => ({ ...current, [blockID]: selectionAnchor }));
      onError(cause instanceof Error ? cause.message : "failed_to_save_chat_message");
    } finally {
      chatSubmissionsInProgressRef.current.delete(blockID);
    }
  }, [author.name, author.userID, blocks, canEdit, chatDraftAttachments, chatDraftEntityLinks, chatDrafts, chatReplyTargets, chatSelectionAnchors, companyID, companyUsers, nodeID, onError, onProjectionMutation, requestJSON, textBlockProjectionSaveController]);

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

  const editChatMessage = useCallback(async (messageID: string, nextText: string) => {
    if (!canEdit) return;
    const existing = chatMessages.find((item) => item.id === messageID);
    if (!existing || !nodeID || !companyID) return;
    if (!canEditEditorTextBlockChatMessage(existing, author.userID)) {
      const cause = new Error("cannot_edit_other_users_chat_message");
      onError(cause.message);
      throw cause;
    }
    const message = nextText.trim();
    if (!message && existing.attachments.length === 0) {
      const cause = new Error("chat_message_required");
      onError(cause.message);
      throw cause;
    }
    if (message === existing.message) return;
    const editedTimestamp = new Date().toISOString();
    const mentionedUserIDs = mentionedUserIDsFromChatDraft(message, companyUsers);
    const entityLinks = remapEditorChatEntityLinks(existing.message, message, existing.entityLinks ?? []);
    setChatMessages((current) => current.map((item) => item.id === messageID ? {
      ...item,
      message,
      editedTimestamp,
      entityLinks,
      mentionedUserIDs,
    } : item));
    try {
      await requestJSON<unknown>(`/v1/nodes/${nodeID}/projection/${messageID}`, {
        method: "PATCH",
        body: JSON.stringify({
          company_id: companyID,
          message,
          entity_links: editorChatEntityLinkPayloads(message, entityLinks),
          mentioned_user_ids: mentionedUserIDs,
          mentioned_group_ids: existing.mentionedGroupIDs ?? [],
        }),
      });
      onProjectionMutation();
    } catch (cause) {
      setChatMessages((current) => current.map((item) => item.id === messageID ? existing : item));
      onError(cause instanceof Error ? cause.message : "failed_to_edit_chat_message");
      throw cause;
    }
  }, [author.userID, canEdit, chatMessages, companyID, companyUsers, nodeID, onError, onProjectionMutation, requestJSON]);

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
    const tiptapDocument = image.attachmentID ? serializeMangoTiptapDocument({
      format: "mango-tiptap-json",
      schema_version: 1,
      document: {
        type: "doc",
        content: [{
          type: "mangoAttachmentImage",
          attrs: {
            attachmentId: image.attachmentID,
            filename: image.filename || "image",
            mimeType: image.mimeType || "application/octet-stream",
            width,
            height,
            displayWidth: width,
            displayHeight: height,
            alignment: "left",
            position: "break",
            layout: "content",
            alt: image.filename || "Image",
            title: image.filename || "Image",
          },
        }, {
          type: "paragraph",
          attrs: { blockId: generateStableInformationID(), textAlign: null, indentLevel: 0 },
        }],
      },
    }) : undefined;
    try {
      await onCreateNodeFromImage({
        title: sourceTitle === "Image" ? "Image" : `Image - ${sourceTitle}`,
        document: imageDocument,
        tiptapDocument,
        attachmentID: image.attachmentID,
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
    const sourceEmail = attachedEmails.find((email) => email.emailMessageID === messageID || email.id === messageID);
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
      setEmailPickerAnchor(null);
      return;
    }
    const id = generateStableInformationID();
    const attached: EditorAttachedEmail = {
      id,
      messageID: email.messageID,
      emailMessageID: email.emailMessageID,
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
    setEmailPickerAnchor(null);
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
      setAttachedEmails((current) => current.filter((item) => item.id !== id));
      const message = cause instanceof Error ? cause.message : "failed_to_attach_email";
      onError(message);
      throw cause instanceof Error ? cause : new Error(message);
    }
  }, [attachedEmails, canEdit, companyID, nodeID, onError, onProjectionMutation, requestJSON]);

  const linkDroppedEmailToTextBlock = useCallback(async (blockID: string, dataTransfer: DataTransfer) => {
    if (!canEdit) return;
    const dragged = parseDraggedEmail(dataTransfer);
    if (!dragged) return;
    const block = blocks.find((candidate) => candidate.id === blockID);
    if (!block) return;
    const primaryEmailMessageID = dragged.emailMessageID;
    if (block.emailMessageID && !textBlockHasEmailMessage(block, primaryEmailMessageID)) {
      throw new Error("This text box is already linked to another email message or thread.");
    }
    await attachEmail(dragged);
    await requestJSON<unknown>(`/v1/nodes/${nodeID}/information`, {
      method: "POST",
      body: JSON.stringify({
        company_id: companyID,
        type: EDITOR_ATTACHED_EMAIL_TYPE,
        information: buildEditorAttachedEmailPayload({ ...dragged, blockID, linkWholeThread: false }),
        information_id: generateStableInformationID(),
      }),
    });
    const color = block.color?.trim() || nextNodeTextBlockColor(blocks.map((candidate) => candidate.color ?? ""));
    updateTextBlockContent(blockID, { color });
    setBlocks((current) => current.map((candidate) => candidate.id === blockID
      ? { ...candidate, emailMessageID: primaryEmailMessageID, color }
      : candidate));
    onProjectionMutation();
  }, [attachEmail, blocks, canEdit, companyID, nodeID, onProjectionMutation, requestJSON, updateTextBlockContent]);

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

  const loadNodeTimelineEvents = useCallback(async () => {
    if (!companyID || !nodeID) {
      setTimelineEvents([]);
      return;
    }
    setTimelineEventsLoading(true);
    setTimelineEventsError("");
    try {
      const payload = await requestJSON<{ timeline_events?: NodeTimelineEvent[] }>(
        `/v1/nodes/${encodeURIComponent(nodeID)}/timeline-events?company_id=${encodeURIComponent(companyID)}`,
      );
      setTimelineEvents(payload.timeline_events ?? []);
    } catch (cause) {
      setTimelineEventsError(nodeTimelineErrorMessage(cause, "failed_to_list_node_timeline_events"));
    } finally {
      setTimelineEventsLoading(false);
    }
  }, [companyID, nodeID, requestJSON]);

  useEffect(() => {
    setTimelineEvents(initialTimelineEvents);
    setTimelineEventsError("");
    setTimelineEventsLoading(false);
  }, [initialTimelineEvents, nodeID]);

  const createVerificationRequest = useCallback(async () => {
    if (!canEdit || !companyID || !nodeID || verificationRequestPending) return;
    setVerificationRequestPending(true);
    setTimelineCreateMenuOpen(false);
    setTimelineEventsError("");
    try {
      const payload = await requestJSON<{ timeline_event: NodeTimelineEvent }>(
        `/v1/nodes/${encodeURIComponent(nodeID)}/verification-requests`,
        {
          method: "POST",
          headers: { "Idempotency-Key": generateStableInformationID() },
          body: JSON.stringify({ company_id: companyID }),
        },
      );
      setTimelineEvents((current) => [payload.timeline_event, ...current.filter((item) => item.event_id !== payload.timeline_event.event_id)]);
    } catch (cause) {
      setTimelineEventsError(nodeTimelineErrorMessage(cause, "failed_to_create_verification_request"));
    } finally {
      setVerificationRequestPending(false);
    }
  }, [canEdit, companyID, nodeID, requestJSON, verificationRequestPending]);

  const completeVerificationRequest = useCallback(async (eventID: string) => {
    const cleanEventID = eventID.trim();
    if (!companyID || !nodeID || !author.userID || !cleanEventID || verificationCompletionPendingID) return;
    setVerificationCompletionPendingID(cleanEventID);
    setTimelineEventsError("");
    try {
      const payload = await requestJSON<{ timeline_event: NodeTimelineEvent }>(
        `/v1/nodes/${encodeURIComponent(nodeID)}/verification-requests/${encodeURIComponent(cleanEventID)}/complete`,
        { method: "POST", body: JSON.stringify({ company_id: companyID }) },
      );
      setTimelineEvents((current) => current.map((item) => item.event_id === cleanEventID ? payload.timeline_event : item));
    } catch (cause) {
      setTimelineEventsError(nodeTimelineErrorMessage(cause, "failed_to_complete_verification_request"));
    } finally {
      setVerificationCompletionPendingID("");
    }
  }, [author.userID, companyID, nodeID, requestJSON, verificationCompletionPendingID]);

  const linkEntityFromEditor = useCallback(async (entity: EditorEntityLink) => {
    if (!canEdit) throw new Error("You do not have permission to edit this Node.");
    if (entity.entityType === "logic_gate") {
      const logicGateID = entity.entityID.trim();
      if (!logicGateID) throw new Error("Select a Logic Gate to link.");
      await onAssignToLogicGate(logicGateID);
      await loadNodeTimelineEvents();
      setLastAssignedLogicGateID(logicGateID);
      setLastAssignedLogicGateLabel(entity.label);
      setProjectRelationshipRefreshKey((key) => key + 1);
      return;
    }
    if (entity.entityType === "project") {
      const projectID = entity.entityID.trim();
      if (!projectID) throw new Error("Select a Project to link.");
      await upsertProjectRelationship({
        companyID,
        projectID,
        resourceType: "node",
        resourceID: nodeID,
      });
      await loadNodeTimelineEvents();
      setProjectRelationshipRefreshKey((key) => key + 1);
      return;
    }
    if (entity.entityType === "email_message") {
      if (!entity.emailMessage) throw new Error("The selected email is no longer available. Search for it again.");
      await attachEmail(messageAttachmentPayload(entity.emailMessage, entity.emailSharedInboxID, entity.emailAccountEmail));
      return;
    }
    throw new Error("A Node can only be linked to a Logic Gate, Project, or Email.");
  }, [
    attachEmail, canEdit, companyID, loadNodeTimelineEvents, nodeID, onAssignToLogicGate,
  ]);

  const chooseHeaderLinkedEntity = useCallback(async (entity: EditorEntityLink, mode: UniversalEntityPickerMode) => {
    if (mode === "link") {
      await linkEntityFromEditor(entity);
    } else {
      openEditorEntityLink(entity);
    }
    setHeaderLinkPickerAnchor(null);
  }, [linkEntityFromEditor]);

  const onDropEmail = useCallback((event: React.DragEvent) => {
    if (!canEdit) return;
    const email = parseDraggedEmail(event.dataTransfer);
    if (!email) return;
    event.preventDefault();
    setDropActive(false);
    void attachEmail({ ...email, attachedTimestamp: new Date().toISOString() }).catch(() => undefined);
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

  const revealEmailTextBlock = useCallback((messageID: string) => {
    const cleanMessageID = messageID.trim();
    const block = blocks.find((candidate) => textBlockHasEmailMessage(candidate, cleanMessageID));
    if (!block) return;
    setNodeEmailNavigationRequest(null);
    setActiveRowBlockID(block.id);
    setOpenEditorBlockIDs((current) => new Set(current).add(block.id));
    setClosedEditorBlockIDs((current) => {
      if (!current.has(block.id)) return current;
      const next = new Set(current);
      next.delete(block.id);
      return next;
    });
    setFocusedTextBlockID(block.id);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-node-text-box-row]") ?? [])
          .find((element) => element.dataset.nodeTextBoxRow === block.id);
        target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        target?.animate([
          { transform: "translateX(0)", boxShadow: "0 0 0 0 rgba(14,165,233,0)" },
          { transform: "translateX(3px)", boxShadow: `0 0 0 4px ${block.color?.trim() || accent}33` },
          { transform: "translateX(0)", boxShadow: "0 0 0 0 rgba(14,165,233,0)" },
        ], { duration: 860, easing: "ease-out" });
      });
    });
  }, [accent, blocks]);

  const revealNodeEmailMessage = useCallback((messageID: string, blockID: string) => {
    const cleanMessageID = messageID.trim();
    if (!cleanMessageID) return;
    setNodeEmailNavigationRequest((current) => ({
      messageID: cleanMessageID,
      blockID,
      requestID: (current?.requestID ?? 0) + 1,
    }));
    setOpenEmailBlockIDs((current) => new Set(current).add(NODE_EMAIL_COLUMN_LAYOUT_ID));
    setClosedEmailBlockIDs((current) => {
      if (!current.has(NODE_EMAIL_COLUMN_LAYOUT_ID)) return current;
      const next = new Set(current);
      next.delete(NODE_EMAIL_COLUMN_LAYOUT_ID);
      return next;
    });
    setFocusedTextBlockID("");
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
    const timelineTarget = cleanInformationID
      ? timelineEvents.find((item) => item.event_id === cleanInformationID)
      : undefined;
    if (timelineTarget) {
      handledFocusRequestRef.current = requestKey;
      window.requestAnimationFrame(() => scrollNodeWorkspaceInformationIntoView(rootRef.current, timelineTarget.event_id, focusMentionUserID));
      return;
    }

    if (focusTargetIndex < 0) return;

    const block = blocks[focusTargetIndex];
    if (block) {
      handledFocusRequestRef.current = requestKey;
      const message = chatMessages.find((item) => item.id === cleanInformationID);
      const attachedEmail = nodeAttachedEmails.find((email) => email.id === cleanInformationID || email.messageID === cleanInformationID || email.emailMessageID === cleanEmailMessageID);
      if (message) {
        const messages = chatMessagesByBlock.get(message.blockID) ?? [];
        navigateToChatMessage(message.blockID, messages, message.id);
      } else if (attachedEmail || (cleanEmailMessageID && nodeAttachedEmails.length > 0)) {
        setFocusedTextBlockID("");
        setActiveRowBlockID(block.id);
        setOpenEmailBlockIDs((current) => new Set(current).add(NODE_EMAIL_COLUMN_LAYOUT_ID));
        if (attachedEmail) setSelectedEmailIDsByBlock((current) => ({ ...current, [NODE_EMAIL_COLUMN_LAYOUT_ID]: attachedEmail.messageID }));
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
        scrollNodeWorkspaceInformationIntoView(rootRef.current, message?.id || attachedEmail?.messageID || block.id, focusMentionUserID);
        if (!message && !attachedEmail && canEdit && focusInformationMode !== "scroll") focusContentEditableAtEnd(editor);
      });
      return;
    }
  }, [blocks, canEdit, chatMessages, chatMessagesByBlock, focusEmailMessageID, focusInformationID, focusInformationMode, focusMentionUserID, focusRequestID, focusTargetIndex, navigateToChatMessage, nodeAttachedEmails, nodeID, projectionsLoaded, timelineEvents]);

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


  const nodeEmailColumnVisible = nodeAttachedEmails.length > 0 && openEmailBlockIDs.has(NODE_EMAIL_COLUMN_LAYOUT_ID);
  const maximumVisibleTextPaneCount = blocks.reduce((maximum, block) => {
    const editorVisible = openEditorBlockIDs.has(block.id) || tiptapPinnedBlockIDs.has(block.id);
    const chatVisible = openChatBlockIDs.has(block.id) || activeChatBlockID === block.id;
    return Math.max(maximum, Number(editorVisible) + Number(chatVisible));
  }, 0);
  const nodeTextSurfaceVisible = maximumVisibleTextPaneCount > 0;
  const nodeEmailOnly = nodeEmailColumnVisible && !nodeTextSurfaceVisible;
  const nodeWorkspaceViewportHeight = Math.max(
    TEXT_BLOCK_ROW_HEIGHT,
    Math.floor(height - TEXT_BLOCK_HEADER_CHROME_HEIGHT - NODE_EMAIL_COLUMN_BOTTOM_GUTTER_PX),
  );
  const minimumNodeTextWorkspaceWidth = maximumVisibleTextPaneCount > 1
    ? TEXT_BLOCK_RESIZE_MIN_WIDTH_PX + TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX + TEXT_SIDE_PANE_MIN_WIDTH_PX
    : TEXT_SIDE_PANE_MIN_WIDTH_PX;
  const nodeEmailPaneMaxWidth = Math.max(
    TEXT_SIDE_PANE_MIN_WIDTH_PX,
    textCommunicationContentWidth - minimumNodeTextWorkspaceWidth - TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX,
  );
  const nodeEmailPaneWidth = sidePaneWidthForBlock(
    NODE_EMAIL_COLUMN_LAYOUT_ID,
    "email",
    Math.round(textCommunicationContentWidth / Math.max(2, maximumVisibleTextPaneCount + 1)),
    nodeEmailPaneMaxWidth,
  );
  const nodeTextCommunicationContentWidth = nodeEmailColumnVisible && !nodeEmailOnly
    ? Math.max(
      minimumNodeTextWorkspaceWidth,
      textCommunicationContentWidth - nodeEmailPaneWidth - TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX,
    )
    : textCommunicationContentWidth;
  const nodeTextTimelineRailWidth = TEXT_TIMELINE_COLUMN_WIDTH_PX + TEXT_CHAT_GRID_COLUMN_GAP_PX;
  const nodeTextWorkspaceOuterWidth = nodeTextCommunicationContentWidth + nodeTextTimelineRailWidth;
  const nodeEmailFocusActive = nodeEmailFocusExpanded && nodeEmailColumnVisible && !nodeEmailOnly;
  const nodeEmailWorkspacePixelWidth = nodeEmailPaneWidth
    + TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX
    + nodeTextWorkspaceOuterWidth;
  const nodeEmailWorkspaceGridTemplateColumns = nodeEmailColumnVisible
    ? nodeEmailOnly
      ? "minmax(0, 1fr) 0px 0px"
      : nodeEmailFocusActive
        ? (nodeEmailWorkspacePixelWidth - nodeTextTimelineRailWidth) + "px 0px " + nodeTextTimelineRailWidth + "px"
        : nodeEmailPaneWidth + "px " + TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX + "px " + nodeTextWorkspaceOuterWidth + "px"
    : "0px 0px minmax(0, 1fr)";
  const nodeEmailWorkspaceMode = nodeEmailOnly
    ? "email-only"
    : nodeEmailColumnVisible
      ? "email-with-text"
      : "text-only";
  const toggleNodeEmailColumn = () => {
    const nextVisible = !nodeEmailColumnVisible;
    if (!nextVisible) setNodeEmailFocusExpanded(false);
    setFocusedTextBlockID("");
    setOpenEmailBlockIDs((current) => {
      const next = new Set(current);
      if (nextVisible) next.add(NODE_EMAIL_COLUMN_LAYOUT_ID);
      else next.delete(NODE_EMAIL_COLUMN_LAYOUT_ID);
      return next;
    });
    setClosedEmailBlockIDs((current) => {
      const next = new Set(current);
      if (nextVisible) next.delete(NODE_EMAIL_COLUMN_LAYOUT_ID);
      else next.add(NODE_EMAIL_COLUMN_LAYOUT_ID);
      return next;
    });
  };
  const nodeEmailMessageAccents = Object.fromEntries(blocks.flatMap((block) => block.emailMessageID && block.color ? [[
    block.emailMessageID.trim(),
    block.color.trim(),
  ] as const] : []));
  const emailChatHighlightsByMessageID = useMemo<EmailChatHighlightsByMessageID>(() => {
    const highlights: Record<string, Array<{ id: string; quote: string; startOffset: number; endOffset: number }>> = {};
    for (const chatMessage of chatMessages) {
      const messageID = chatMessage.selectionSource === "email" ? chatMessage.selectionMessageID?.trim() ?? "" : "";
      const quote = chatMessage.selectionQuote?.trim() ?? "";
      const startOffset = chatMessage.selectionStart;
      const endOffset = chatMessage.selectionEnd;
      if (!messageID || !quote || typeof startOffset !== "number" || typeof endOffset !== "number" || endOffset <= startOffset) continue;
      const group = highlights[messageID] ?? [];
      group.push({ id: `chat:${chatMessage.id}`, quote, startOffset, endOffset });
      highlights[messageID] = group;
    }
    return highlights;
  }, [chatMessages]);
  const activeNodeEmailChatMessage = activeChatBlockID
    ? chatMessages.find((message) => message.id === activeChatMessageIDs[activeChatBlockID])
    : undefined;
  const pendingNodeEmailAnchor = pendingEmailChatSelection
    ?? (activeChatBlockID ? chatSelectionAnchors[activeChatBlockID] : undefined);
  const activeNodeEmailSelection = pendingNodeEmailAnchor?.source === "email"
    && pendingNodeEmailAnchor.messageID
    && pendingNodeEmailAnchor.quote
    && Number.isFinite(pendingNodeEmailAnchor.startOffset)
    && Number.isFinite(pendingNodeEmailAnchor.endOffset)
    ? {
      messageID: pendingNodeEmailAnchor.messageID,
      quote: pendingNodeEmailAnchor.quote,
      startOffset: pendingNodeEmailAnchor.startOffset,
      endOffset: pendingNodeEmailAnchor.endOffset,
    }
    : activeNodeEmailChatMessage?.selectionSource === "email"
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
    const anchor: TextBlockSelectionDraft = {
      blockID: "",
      source: "email",
      messageID,
      quote: selection.quote,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
      x: selection.x,
      y: selection.y,
    };
    setChatSelectionAnchors((current) => Object.fromEntries(
      Object.entries(current).filter(([, currentAnchor]) => currentAnchor.source !== "email"),
    ));
    const existingDestinations = blocks.filter((block) => !block.temporaryEmailChat);
    const linkedDestination = existingDestinations.find((block) => textBlockHasEmailMessage(block, messageID));
    if (linkedDestination) {
      openSelectionChat({ ...anchor, blockID: linkedDestination.id }, linkedDestination.id);
      flashEmailChatDestination(linkedDestination.id);
      setChatComposerFocusRequestIDs((current) => ({
        ...current,
        [linkedDestination.id]: (current[linkedDestination.id] ?? 0) + 1,
      }));
      onError("");
      return;
    }
    if (existingDestinations.length === 0) {
      const blockID = stageEmailSelectionChatTextBlock(messageID);
      if (!blockID) return;
      openSelectionChat({ ...anchor, blockID }, blockID);
      flashEmailChatDestination(blockID);
      setChatComposerFocusRequestIDs((current) => ({ ...current, [blockID]: (current[blockID] ?? 0) + 1 }));
      return;
    }
    setPendingEmailChatSelection(anchor);
    setActiveChatBlockID("");
    setFocusedTextBlockID("");
  };
  const choosePendingEmailChatDestination = (blockID: string): boolean => {
    if (!pendingEmailChatSelection) return false;
    const linkedBlock = blocks.find((block) => textBlockHasEmailMessage(block, pendingEmailChatSelection.messageID ?? ""));
    const requestedBlock = blocks.find((block) => block.id === blockID && !block.temporaryEmailChat);
    const destinationBlock = linkedBlock ?? requestedBlock;
    if (!destinationBlock) return true;
    openSelectionChat({ ...pendingEmailChatSelection, blockID: destinationBlock.id }, destinationBlock.id);
    setPendingEmailChatSelection(null);
    flashEmailChatDestination(destinationBlock.id);
    setChatComposerFocusRequestIDs((current) => ({
      ...current,
      [destinationBlock.id]: (current[destinationBlock.id] ?? 0) + 1,
    }));
    onError("");
    return true;
  };
  const choosePendingEmailChatNodeDestination = () => {
    if (!pendingEmailChatSelection) return;
    const linkedBlock = blocks.find((block) => textBlockHasEmailMessage(block, pendingEmailChatSelection.messageID ?? ""));
    if (linkedBlock) {
      choosePendingEmailChatDestination(linkedBlock.id);
      return;
    }
    const blockID = stageEmailSelectionChatTextBlock(pendingEmailChatSelection.messageID ?? "");
    if (!blockID) return;
    openSelectionChat({ ...pendingEmailChatSelection, blockID }, blockID);
    setPendingEmailChatSelection(null);
    flashEmailChatDestination(blockID);
    setChatComposerFocusRequestIDs((current) => ({ ...current, [blockID]: (current[blockID] ?? 0) + 1 }));
    onError("");
  };
  useEffect(() => {
    if (!pendingEmailChatSelection) return undefined;
    const cancelPendingDestination = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingEmailChatSelection(null);
    };
    window.addEventListener("keydown", cancelPendingDestination);
    return () => window.removeEventListener("keydown", cancelPendingDestination);
  }, [pendingEmailChatSelection]);

  const renderNodeTimelineEvent = (item: NodeTimelineEvent) => {
    const createdLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.created_timestamp));
    const isVerification = item.type === "verification_request";
    const isProjectAssignment = item.type === "project_assignment";
    const fromLogicGateName = item.from_logic_gate_name?.trim() || "Deleted logic gate";
    const toLogicGateName = item.to_logic_gate_name?.trim() || "Deleted logic gate";
    const projectName = item.project_name?.trim() || "Deleted project";
    return (
      <React.Fragment key={item.event_id}>
        <div style={{ padding: "2px 0 4px", boxSizing: "border-box" }}>
          <TimelineCell accent={accent} muted={false} isLast={false} minHeight={isVerification ? 58 : 52} />
        </div>
        <article
          data-node-timeline-event-id={item.event_id}
          data-node-timeline-event-type={item.type}
          tabIndex={-1}
          style={{ width: "min(680px, calc(100% - 16px))", alignSelf: "start", margin: "2px 0 4px", borderRadius: 11, border: `1px solid ${isVerification ? "rgba(99,102,241,0.22)" : ruleColor}`, background: "rgba(255,255,255,0.78)", color: surfaceText, padding: isVerification ? "7px 10px" : "6px 10px", boxShadow: "0 3px 10px rgba(15,23,42,0.05)", boxSizing: "border-box" }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 7, flexWrap: "wrap", minHeight: 15 }}>
            <time dateTime={item.created_timestamp} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, opacity: 0.72 }}><TimelineClockIcon color={surfaceText} />{createdLabel}</time>
            <span aria-hidden="true" style={{ width: 1, height: 12, background: ruleColor }} />
            {!isVerification && <span data-node-timeline-entity-icon="header" aria-hidden="true" style={{ display: "inline-flex" }}><ExplorerRowIcon kind={isProjectAssignment ? "project" : "logic_gate"} /></span>}
            <strong style={{ fontSize: 12, letterSpacing: "0.01em" }}>{isVerification ? "Requested verification" : isProjectAssignment ? "Project assignment" : "Logic Gate transfer"}</strong>
          </div>
          {isVerification ? (
            <>
              <div style={{ marginTop: 4, fontSize: 11.5 }}><strong>{item.actor_display_name}</strong> requested verification from:</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {item.verification_recipients.map((recipient) => {
                  const completed = Boolean(recipient.completed_timestamp);
                  const isCurrentUser = recipient.user_id === author.userID;
                  const pending = verificationCompletionPendingID === item.event_id;
                  return (
                    <button
                      key={recipient.user_id}
                      type="button"
                      aria-label={`${recipient.user_display_name}: ${completed ? "verified" : "verification pending"}`}
                      title={isCurrentUser && !completed ? "Confirm your verification" : completed ? "Verified" : "Waiting for this person"}
                      disabled={!isCurrentUser || completed || pending}
                      onClick={() => { void completeVerificationRequest(item.event_id); }}
                      style={{ minHeight: 27, borderRadius: 999, border: `1px solid ${completed ? "rgba(16,185,129,0.42)" : "rgba(99,102,241,0.25)"}`, background: completed ? "rgba(209,250,229,0.9)" : "rgba(255,255,255,0.8)", color: completed ? "#047857" : surfaceText, display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px 3px 4px", cursor: isCurrentUser && !completed ? "pointer" : "default", opacity: pending ? 0.65 : 1 }}
                    >
                      <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: "50%", border: `1px solid ${completed ? "#10b981" : "rgba(99,102,241,0.38)"}`, display: "grid", placeItems: "center", background: completed ? "#10b981" : "transparent", color: "white", fontSize: 11, fontWeight: 950 }}>{completed ? "✓" : ""}</span>
                      <span style={{ fontSize: 11, fontWeight: 750 }}>{recipient.user_display_name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : isProjectAssignment ? (
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginTop: 4, fontSize: 11.5, lineHeight: 1.25 }}>
              <strong>{item.actor_display_name}</strong>
              <span>assigned this node to</span>
              <TimelineProjectLink projectID={item.project_id ?? ""} projectName={projectName} />
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginTop: 4, fontSize: 11.5, lineHeight: 1.25 }}>
              <strong>{item.actor_display_name}</strong>
              <span>moved this node from</span>
              <TimelineLogicGateLink logicGateID={item.from_logic_gate_id ?? ""} logicGateName={fromLogicGateName} position="from" />
              <span>to</span>
              <TimelineLogicGateLink logicGateID={item.to_logic_gate_id ?? ""} logicGateName={toLogicGateName} position="to" />
            </div>
          )}
        </article>
      </React.Fragment>
    );
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
        overscrollBehaviorY: "contain",
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
        <div
          data-node-header-timeline-control="true"
          style={{ position: "sticky", top: 0, zIndex: 44, minHeight: 38, padding: "0 0 7px", background: panelBackground, display: "flex", alignItems: "flex-start", justifyContent: "flex-start" }}
        >
          {canEdit && (
            <div ref={timelineCreateMenuRef} style={{ position: "relative", width: 30, flex: "0 0 30px" }}>
              <button
                type="button"
                title="Add timeline entry"
                aria-label="Add timeline entry"
                aria-haspopup="menu"
                aria-expanded={timelineCreateMenuOpen}
                onClick={() => setTimelineCreateMenuOpen((current) => !current)}
                style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid transparent", background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", boxShadow: EDITOR_NEU_SHADOW }}
              >
                <PlusIcon color={accent} />
              </button>
              {timelineCreateMenuOpen && (
                <div
                  role="menu"
                  aria-label="Choose timeline entry type"
                  style={{ position: "absolute", top: 36, left: 0, zIndex: 80, width: 230, padding: 7, borderRadius: 12, border: "1px solid " + EDITOR_NEU_SOFT_BORDER, background: panelBackground, boxShadow: EDITOR_NEU_PANEL_SHADOW }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="mango-timeline-create-menu-item"
                    onClick={() => { setTimelineCreateMenuOpen(false); createTextBlock(); }}
                    style={{ width: "100%", border: 0, borderRadius: 8, background: "transparent", color: surfaceText, display: "grid", gridTemplateColumns: "28px 1fr", alignItems: "center", gap: 8, padding: "9px 10px", textAlign: "left", cursor: "pointer" }}
                  >
                    <TextEditorIcon color={accent} />
                    <span><strong style={{ display: "block", fontSize: 12 }}>New text box</strong><small style={{ opacity: 0.7 }}>Add editable timeline content</small></span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="mango-timeline-create-menu-item"
                    disabled={verificationRequestPending}
                    onClick={() => { void createVerificationRequest(); }}
                    style={{ width: "100%", border: 0, borderRadius: 8, background: "transparent", color: surfaceText, display: "grid", gridTemplateColumns: "28px 1fr", alignItems: "center", gap: 8, padding: "9px 10px", textAlign: "left", cursor: verificationRequestPending ? "wait" : "pointer" }}
                  >
                    <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 8, border: "1px solid " + ruleColor, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.55)", color: accent, fontWeight: 950, boxSizing: "border-box" }}>✓</span>
                    <span><strong style={{ display: "block", fontSize: 12 }}>Verify stamp</strong><small style={{ opacity: 0.7 }}>Request everyone assigned to Accountable</small></span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div data-node-header-controls="true" style={{ position: "sticky", top: 0, zIndex: 43, display: "flex", alignItems: "center", gap: 7, flexWrap: "nowrap", overflow: "visible", minWidth: 0, padding: "0 0 7px", background: panelBackground }}>
          {(canEdit || nodeAttachedEmails.length > 0) && (
            <div data-node-header-email-controls="true" style={{ minHeight: 30, display: "inline-flex", alignItems: "center", border: "1px solid " + EDITOR_NEU_SOFT_BORDER, borderRadius: 9, background: nodeEmailColumnVisible ? EDITOR_NEU_ACTIVE_SURFACE : EDITOR_NEU_SURFACE, boxShadow: EDITOR_NEU_SHADOW, overflow: "hidden", flex: "0 0 auto" }}>
              <button
                type="button"
                title={nodeAttachedEmails.length > 0 ? (nodeEmailColumnVisible ? "Hide node email column" : "Open node email column") : "No attached emails"}
                aria-label="Toggle node email column"
                aria-pressed={nodeEmailColumnVisible}
                disabled={nodeAttachedEmails.length === 0}
                onClick={toggleNodeEmailColumn}
                style={{ height: 28, border: 0, background: "transparent", color: accent, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "0 7px", cursor: nodeAttachedEmails.length > 0 ? "pointer" : "default", fontSize: 11, fontWeight: 900, opacity: nodeAttachedEmails.length > 0 ? 1 : 0.62 }}
              >
                <MailIcon color={accent} />
                <span>{nodeAttachedEmails.length}</span>
              </button>
              {canEdit && <span aria-hidden="true" style={{ width: 1, height: 17, background: EDITOR_NEU_SOFT_BORDER }} />}
              {canEdit && (
                <button
                  ref={emailPickerLauncherRef}
                  type="button"
                  title="Attach email"
                  aria-label="Attach email"
                  onClick={() => {
                    const bounds = emailPickerLauncherRef.current?.getBoundingClientRect();
                    setEmailPickerAnchor({ left: bounds?.left ?? 24, top: (bounds?.bottom ?? 49) + 7 });
                  }}
                  style={{ width: 29, height: 28, border: 0, background: "transparent", color: accent, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}
                >
                  <PlusIcon color={accent} />
                </button>
              )}
            </div>
          )}
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
            onRemove={canEdit ? (item) => { void deleteNodeAttachment(item.resourceAttachment); } : undefined}
            onCancelUpload={cancelNodeAttachmentUpload}
            onRetryUpload={retryNodeAttachmentUpload}
            onError={onError}
          />
          {hasAssignedLogicGate && primaryAssignedLogicGateID && (
            <button
              type="button"
              data-node-header-link="logic_gate"
              title={`Go to ${assignedLogicGateLabel}`}
              onClick={goToAssignedLogicGate}
              style={{ minHeight: 30, maxWidth: 230, borderRadius: 9, border: "1px solid transparent", background: EDITOR_NEU_ACTIVE_SURFACE, color: accent, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 9px", cursor: "pointer", fontSize: 11.5, fontWeight: 850, whiteSpace: "nowrap", boxShadow: EDITOR_NEU_SHADOW }}
            >
              <ExplorerRowIcon kind="logic_gate" />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{assignedLogicGateLabel}</span>
            </button>
          )}
          {primaryAssignedProjectID && (
            <button
              type="button"
              data-node-header-link="project"
              title={`Go to ${primaryAssignedProjectLabel}`}
              onClick={goToAssignedProject}
              style={{ minHeight: 30, maxWidth: 230, borderRadius: 9, border: "1px solid transparent", background: EDITOR_NEU_ACTIVE_SURFACE, color: accent, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 9px", cursor: "pointer", fontSize: 11.5, fontWeight: 850, whiteSpace: "nowrap", boxShadow: EDITOR_NEU_SHADOW }}
            >
              <ExplorerRowIcon kind="project" />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{primaryAssignedProjectLabel}</span>
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              data-node-header-universal-linker="true"
              aria-label="Link this Node"
              aria-haspopup="dialog"
              aria-expanded={headerLinkPickerAnchor !== null}
              onClick={(event) => {
                if (headerLinkPickerAnchor) {
                  setHeaderLinkPickerAnchor(null);
                  return;
                }
                const rect = event.currentTarget.getBoundingClientRect();
                setHeaderLinkPickerAnchor({ left: rect.left, top: rect.bottom + 8 });
              }}
              style={{ height: 30, minWidth: 190, maxWidth: 330, flex: "1 1 220px", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: 7, border: headerLinkPickerAnchor ? "1px solid transparent" : "1px solid " + EDITOR_NEU_SOFT_BORDER, borderRadius: 9, background: headerLinkPickerAnchor ? EDITOR_NEU_ACTIVE_SURFACE + " padding-box, " + EDITOR_NEU_EDGE_FRAME + " border-box" : EDITOR_NEU_SURFACE, color: "#334155", boxShadow: headerLinkPickerAnchor ? "inset 2px 2px 6px rgba(174,174,192,0.16), inset -2px -2px 6px rgba(255,255,255,0.86)" : EDITOR_NEU_SHADOW, padding: "0 9px", boxSizing: "border-box", cursor: "text", textAlign: "left", font: "inherit" }}
            >
              <strong aria-hidden="true" style={{ color: "#7c3aed", fontSize: 14, fontWeight: 950 }}>##</strong>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 800 }}>Ready! Open universal linker</span>
            </button>
          )}
        </div>
        {headerLinkPickerAnchor && (
          <UniversalEntityPicker
            companyID={companyID}
            requestJSON={requestJSON}
            sourceType="node"
            sourceLabel="Node header"
            linkTargetTypes={NODE_HEADER_LINK_TARGET_TYPES}
            initialMode="link"
            anchor={headerLinkPickerAnchor}
            onChoose={chooseHeaderLinkedEntity}
            onCancel={() => setHeaderLinkPickerAnchor(null)}
          />
        )}

        {blocks.length === 0 && !nodeEmailColumnVisible && (
          <>
            <TimelineCell accent={accent} muted isLast />
            <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, minHeight: 92, display: "grid", placeItems: "center", color: surfaceText, opacity: 0.7, fontSize: 13, fontWeight: 700 }}>
              No text boxes
            </div>
          </>
        )}

        <div
          data-node-email-workspace="true"
          className="mango-pane-layout-transition"
          data-node-email-workspace-mode={nodeEmailWorkspaceMode}
          data-node-email-focus-mode={nodeEmailFocusActive ? "expanded" : "normal"}
          data-node-email-column-visible={nodeEmailColumnVisible ? "true" : "false"}
          style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: nodeEmailWorkspaceGridTemplateColumns, minWidth: nodeEmailColumnVisible && !nodeEmailOnly ? nodeEmailWorkspacePixelWidth : 0, minHeight: nodeWorkspaceViewportHeight, marginBottom: NODE_EMAIL_COLUMN_BOTTOM_GUTTER_PX, alignItems: "stretch", alignContent: "start", transition: "grid-template-columns 180ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
        >
        {nodeAttachedEmails.length > 0 && (
          <div
            data-node-email-column="true"
            data-node-email-column-state={nodeEmailColumnVisible ? "open" : "closed"}
            className="mango-pane-layout-transition"
            aria-hidden={!nodeEmailColumnVisible}
            {...(!nodeEmailColumnVisible ? { inert: "" } : {})}
            style={{ gridColumn: "1", position: "sticky", top: 38, alignSelf: "start", zIndex: 2, minWidth: 0, height: nodeWorkspaceViewportHeight, minHeight: nodeWorkspaceViewportHeight, boxSizing: "border-box", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 14, background: panelBackground, backgroundClip: "padding-box", overflow: "hidden", opacity: nodeEmailColumnVisible ? 1 : 0, transform: nodeEmailColumnVisible ? "translateX(0) scale(1)" : "translateX(-10px) scale(0.985)", pointerEvents: nodeEmailColumnVisible ? "auto" : "none", boxShadow: EDITOR_NEU_SHADOW, transition: "opacity 180ms ease, transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
          >
			<AttachedEmailOrganizerPane
              emails={nodeAttachedEmails}
              nodeID={nodeID}
              apiBase={apiBase}
				companyID={companyID}
				currentUserID={author.userID}
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
              focusMessageID={nodeEmailNavigationRequest?.messageID || (activeNodeEmailChatMessage?.selectionSource === "email" ? activeNodeEmailChatMessage.selectionMessageID : undefined) || focusEmailMessageID}
              focusBlockID={nodeEmailNavigationRequest?.blockID || activeNodeEmailChatMessage?.blockID}
              focusMessageRequestID={nodeEmailNavigationRequest?.requestID ?? focusRequestID ?? 0}
              activeEmailSelection={activeNodeEmailSelection}
              emailHighlightRemovalRequest={emailHighlightRemovalRequest}
              chatHighlightsByMessageID={emailChatHighlightsByMessageID}
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
              onEmailReplyTextBoxRequest={openEmailReplyInTextBlock}
              onEmailMessageActivate={revealEmailTextBlock}
              onEmailSelectionNodeRequest={(messageID, quote) => { void createNodeFromEmailSelection(messageID, quote); }}
              emailFocusExpanded={nodeEmailFocusActive}
              onRequestEmailFocusToggle={nodeTextSurfaceVisible || nodeEmailFocusExpanded
                ? () => setNodeEmailFocusExpanded((current) => !current)
                : undefined}
              onError={onError}
            />
          </div>
        )}
        {nodeEmailColumnVisible && !nodeEmailOnly && (nodeEmailFocusActive
          ? <div aria-hidden="true" data-node-email-focus-gap="true" />
          : renderTextSidePaneResizeHandle(NODE_EMAIL_COLUMN_LAYOUT_ID, "email", "after", nodeEmailPaneWidth, nodeEmailPaneMaxWidth))}
        <div
          ref={rowVirtualizer.listRef}
          data-mango-bounded-editor-rows="node"
          aria-label="Node activity timeline"
          data-node-timeline-activity="true"
          data-mounted-row-count={rowVirtualizer.mountedRowCount}
          data-node-email-timeline-rail={nodeEmailFocusActive ? "true" : undefined}
          aria-hidden={nodeEmailFocusActive || undefined}
          {...(nodeEmailFocusActive ? { inert: "" } : {})}
          style={{ gridColumn: "3", display: nodeEmailOnly ? "none" : "grid", gridTemplateColumns: nodeEmailFocusActive ? `${TEXT_TIMELINE_COLUMN_WIDTH_PX}px 0px` : editorGridTemplateColumns, columnGap: TEXT_CHAT_GRID_COLUMN_GAP_PX, rowGap: 0, minWidth: 0, overflow: nodeEmailFocusActive ? "hidden" : undefined }}
        >
        {pendingEmailChatSelection && (
          <button
            type="button"
            data-node-email-chat-parent-destination="true"
            onClick={choosePendingEmailChatNodeDestination}
          >
            <ExplorerEntityIcon kind="node" />
            <span>
              <strong>This Node</strong>
              <small>Create a new text-box grouping when the highlighted message is not linked here.</small>
            </span>
          </button>
        )}
        {timelineEventsLoading && timelineEvents.length === 0 && (
          <div role="status" style={{ gridColumn: "1 / -1", marginLeft: 42, fontSize: 12, color: surfaceText, opacity: 0.66 }}>Loading timeline activity…</div>
        )}
        {timelineEventsError && (
          <div role="alert" style={{ gridColumn: "1 / -1", marginLeft: 42, maxWidth: 680, borderRadius: 9, padding: "6px 9px", background: "rgba(254,226,226,0.72)", color: "#b91c1c", fontSize: 12 }}>
            {timelineEventsError}
          </div>
        )}
        {rowVirtualizer.entries.map((entry) => {
          if (entry.kind === "spacer") {
            return <div key={entry.key} aria-hidden="true" data-editor-row-spacer="true" style={{ gridColumn: "1 / -1", height: entry.height, pointerEvents: "none" }} />;
          }
          const index = entry.index;
          const block = blocks[index];
          if (!block) return null;
          const chatBlockID = block.id;
          const messages = chatMessagesByBlock.get(block.id) ?? [];
          const chatIsActive = activeChatBlockID === chatBlockID;
          const chatPaneIsVisible = openChatBlockIDs.has(chatBlockID) || chatIsActive;
          const editorPaneIsVisible = openEditorBlockIDs.has(block.id) || tiptapPinnedBlockIDs.has(block.id);
          const linkedEmailMessageID = block.emailMessageID?.trim() ?? "";
          const blockColor = linkedEmailMessageID ? (block.color?.trim() ?? "") : "";
          const linkedEmailExpanded = Boolean(linkedEmailMessageID && expandedLinkedEmailBlockIDs.has(block.id));
          const contentPaneIsVisible = editorPaneIsVisible || linkedEmailExpanded;
          const chatPaneMaxWidth = Math.max(
            TEXT_SIDE_PANE_MIN_WIDTH_PX,
            nodeTextCommunicationContentWidth - TEXT_BLOCK_RESIZE_MIN_WIDTH_PX - TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX,
          );
          const chatPaneWidth = contentPaneIsVisible && chatPaneIsVisible
            ? sidePaneWidthForBlock(
              chatBlockID,
              "chat",
              TEXT_CHAT_PANE_DEFAULT_WIDTH_PX,
              chatPaneMaxWidth,
            )
            : nodeTextCommunicationContentWidth;
          const blockCommunicationGridTemplateColumns = contentPaneIsVisible && chatPaneIsVisible
            ? `minmax(${TEXT_BLOCK_RESIZE_MIN_WIDTH_PX}px, 1fr) ${TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX}px minmax(${TEXT_SIDE_PANE_MIN_WIDTH_PX}px, ${chatPaneWidth}px)`
            : contentPaneIsVisible
              ? `minmax(${TEXT_BLOCK_RESIZE_MIN_WIDTH_PX}px, 1fr)`
              : chatPaneIsVisible
                ? `minmax(${TEXT_SIDE_PANE_MIN_WIDTH_PX}px, 1fr)`
                : "minmax(0, 1fr)";
          const minimumCommunicationWidth = contentPaneIsVisible && chatPaneIsVisible
            ? TEXT_BLOCK_RESIZE_MIN_WIDTH_PX + TEXT_CHAT_SPLIT_HANDLE_WIDTH_PX + TEXT_SIDE_PANE_MIN_WIDTH_PX
            : contentPaneIsVisible
              ? TEXT_BLOCK_RESIZE_MIN_WIDTH_PX
              : chatPaneIsVisible
                ? TEXT_SIDE_PANE_MIN_WIDTH_PX
                : 0;
          const visiblePaneMode = editorPaneIsVisible && chatPaneIsVisible
            ? "editor-chat"
            : editorPaneIsVisible
              ? "editor-only"
              : chatPaneIsVisible
                ? "chat-only"
                : "none";
          const textBlockIsFocused = focusedTextBlockID === block.id;
          const editorPaneHeight = editorPaneIsVisible ? TEXT_BLOCK_MIN_HEIGHT : 0;
          const chatPaneHeight = TEXT_BLOCK_MIN_HEIGHT;
          const selectionAnchor = chatSelectionAnchors[chatBlockID];
          const activeChatMessageID = activeChatMessageIDs[chatBlockID] ?? "";
          const activeChatAnchorMessageID = resolveEditorTextBlockChatAnchorMessageID(messages, activeChatMessageID);
          const blockAttachmentDropdownItems = (nodeTextBlockAttachmentsByInformationID.get(block.id) ?? []).map((resourceAttachment) => ({
            resourceAttachment,
          }));
          const clearSelectionAnchor = () => {
            if (cancelTemporaryEmailChatDraft(chatBlockID, selectionAnchor)) return;
            setChatSelectionAnchors((current) => {
              if (!(chatBlockID in current)) return current;
              const next = { ...current };
              delete next[chatBlockID];
              return next;
            });
          };
          const toggleChat = () => {
            setFocusedTextBlockID("");
            if (pendingEmailChatSelection) {
              if (!choosePendingEmailChatDestination(chatBlockID)) return;
              setClosedChatBlockIDs((current) => {
                if (!current.has(chatBlockID)) return current;
                const next = new Set(current);
                next.delete(chatBlockID);
                return next;
              });
              setOpenChatBlockIDs((current) => new Set(current).add(chatBlockID));
              setActiveChatBlockID(chatBlockID);
              return;
            }
            if (chatPaneIsVisible) {
              clearSelectionAnchor();
              if (block.temporaryEmailChat) return;
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
            if (pendingEmailChatSelection && !choosePendingEmailChatDestination(chatBlockID)) return;
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
          const toggleLinkedEmail = () => {
            if (!linkedEmailMessageID) return;
            setExpandedLinkedEmailBlockIDs((current) => {
              const next = new Set(current);
              if (next.has(block.id)) next.delete(block.id);
              else next.add(block.id);
              return next;
            });
          };
          const blockSaveStorageKey = mangoTiptapPendingStorageKey({ companyID, resourceType: "node", resourceID: nodeID, documentID: block.id });
          const blockSaveFallback = block.pending ? { status: "saving" as const } : { status: "saved" as const, updatedTimestamp: block.updatedTimestamp };
          const blockSaveNeedsFailureAttention = Boolean(textBlockSaveFailures[block.id]);
          return (
            <React.Fragment key={block.id}>
              {timelineEventsByBlockIndex[index]?.map(renderNodeTimelineEvent)}
              <div style={{ height: linkedEmailExpanded ? "auto" : TEXT_BLOCK_ROW_HEIGHT + TEXT_BLOCK_ROW_GAP, minHeight: TEXT_BLOCK_ROW_HEIGHT + TEXT_BLOCK_ROW_GAP, paddingBottom: TEXT_BLOCK_ROW_GAP, boxSizing: "border-box", overflow: linkedEmailExpanded ? "visible" : "hidden" }}>
                <TimelineCell accent={accent} muted={false} isLast={index === blocks.length - 1} />
              </div>
              <div style={{ minWidth: 0, height: linkedEmailExpanded ? "auto" : TEXT_BLOCK_ROW_HEIGHT + TEXT_BLOCK_ROW_GAP, minHeight: TEXT_BLOCK_ROW_HEIGHT + TEXT_BLOCK_ROW_GAP, paddingBottom: TEXT_BLOCK_ROW_GAP, boxSizing: "border-box", overflow: linkedEmailExpanded ? "visible" : "hidden" }}>
                <div
                  data-node-text-box-row={block.id}
                  data-email-chat-destination-candidate={pendingEmailChatSelection && !block.temporaryEmailChat ? "true" : undefined}
                  data-email-chat-destination-authoritative={pendingEmailChatSelection && textBlockHasEmailMessage(block, pendingEmailChatSelection.messageID ?? "") ? "true" : undefined}
                  data-chat-destination-flash={flashedEmailChatDestinationBlockID === block.id ? "true" : undefined}
                  className={`mango-fixed-editor-row${blockSaveNeedsFailureAttention ? " mango-editor-save-failed-frame" : ""}`}
                  onClickCapture={pendingEmailChatSelection && !block.temporaryEmailChat ? (event) => {
                    const target = event.target;
                    if (target instanceof Element && target.closest("button, a, input, textarea, select")) return;
                    if (choosePendingEmailChatDestination(block.id)) event.stopPropagation();
                  } : undefined}
                  onDragOver={(event) => {
                    if (!canEdit || block.temporaryEmailChat) return;
                    if (event.dataTransfer.types.includes(EMAIL_DRAG_MIME)) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "link";
                    }
                  }}
                  onDrop={(event) => {
                    if (!canEdit || block.temporaryEmailChat) return;
                    if (!event.dataTransfer.types.includes(EMAIL_DRAG_MIME)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    void linkDroppedEmailToTextBlock(block.id, event.dataTransfer).catch((cause) => {
                      onError(cause instanceof Error ? cause.message : "failed_to_link_email_to_text_box");
                    });
                  }}
                  style={{ height: linkedEmailExpanded ? "auto" : TEXT_BLOCK_ROW_HEIGHT, minHeight: TEXT_BLOCK_ROW_HEIGHT, minWidth: 0, display: "grid", gridTemplateRows: linkedEmailExpanded ? "38px auto" : "38px minmax(0, 1fr)", borderTop: `1px solid ${textBlockIsFocused ? "transparent" : blockColor || EDITOR_NEU_SOFT_BORDER}`, borderRight: `1px solid ${textBlockIsFocused ? "transparent" : blockColor || EDITOR_NEU_SOFT_BORDER}`, borderBottom: `1px solid ${textBlockIsFocused ? "transparent" : blockColor || EDITOR_NEU_SOFT_BORDER}`, borderLeft: `${blockColor ? 4 : 1}px solid ${blockColor || (textBlockIsFocused ? "transparent" : EDITOR_NEU_SOFT_BORDER)}`, borderRadius: 14, background: blockColor ? "#ffffff" : `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${textBlockIsFocused ? EDITOR_NEU_EDGE_FRAME : "linear-gradient(135deg, rgba(255,255,255,0.76), rgba(255,255,255,0.76))"} border-box`, overflow: linkedEmailExpanded ? "visible" : "hidden", boxShadow: textBlockIsFocused ? "8px 8px 20px rgba(174,174,192,0.26), -7px -7px 16px rgba(255,255,255,0.92), 0 0 18px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.88)" : EDITOR_NEU_SHADOW }}
                >
                  <div
                    data-node-text-box-header="true"
                    className="mango-editor-header-scroll"
                    title={linkedEmailMessageID ? "Show the linked email message in the email column" : undefined}
                    onClick={(event) => {
                      if (!linkedEmailMessageID) return;
                      const target = event.target;
                      if (target instanceof Element && target.closest("button, input, label, select, textarea, a, details, summary")) return;
                      revealNodeEmailMessage(linkedEmailMessageID, block.id);
                    }}
                    style={{ minWidth: 0, overflowX: "auto", overflowY: "hidden", borderBottom: `1px solid ${ruleColor}`, background: blockColor ? `linear-gradient(90deg, ${blockColor}30, ${blockColor}0c 54%, rgba(255,255,255,0.88))` : "linear-gradient(90deg, rgba(255,241,242,0.62), rgba(236,253,245,0.42) 52%, rgba(239,246,255,0.66))", cursor: linkedEmailMessageID ? "pointer" : undefined }}
                  >
                    <div style={{ minWidth: Math.max(448, minimumCommunicationWidth), height: 37, display: "grid", gridTemplateColumns: `${linkedEmailMessageID ? 128 : 44}px minmax(360px, 1fr) ${chatPaneIsVisible ? chatPaneWidth : 96}px`, alignItems: "center", gap: 4, padding: "4px 6px", boxSizing: "border-box" }}>
                      <div style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                        {linkedEmailMessageID ? (
                          <button type="button" aria-label={linkedEmailExpanded ? "Hide linked email" : "Show linked email"} aria-expanded={linkedEmailExpanded} title={linkedEmailExpanded ? "Hide the linked email" : "Show the linked email"} onClick={toggleLinkedEmail} style={{ minWidth: 0, minHeight: 26, display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${blockColor || EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: linkedEmailExpanded ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: blockColor || accent, cursor: "pointer", padding: "2px 7px", fontSize: 10, fontWeight: 900, boxShadow: EDITOR_NEU_SHADOW }}>
                            <MailIcon color={blockColor || accent} />
                            <span>{linkedEmailExpanded ? "Hide email" : "Show email"}</span>
                          </button>
                        ) : null}
                      </div>
                      <div data-node-pane-header="editor" style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <button type="button" title={editorPaneIsVisible ? "Hide text editor" : "Open text editor"} aria-label="Toggle text editor column" aria-pressed={editorPaneIsVisible} onClick={toggleEditor} style={{ minHeight: 26, flex: "0 0 auto", borderRadius: 8, border: editorPaneIsVisible ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: editorPaneIsVisible ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: accent, display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", padding: "0 7px", fontSize: 10.5, fontWeight: 900, boxShadow: EDITOR_NEU_SHADOW }}>
                          <TextEditorIcon color={accent} />
                          <span>Editor</span>
                        </button>
                        {!block.temporaryEmailChat && <EditorSaveStatusIcon state={blockSaveFallback} storageKey={blockSaveStorageKey} compact />}
                        {!block.temporaryEmailChat && <EditorSavedTimestamp storageKey={blockSaveStorageKey} fallbackUpdatedTimestamp={block.updatedTimestamp} createdTimestamp={block.createdTimestamp} formatTimestamp={formatTextBlockMetadataTimestamp} />}
                        {!block.temporaryEmailChat && <AttachmentCountDropdown
                          items={blockAttachmentDropdownItems}
                          apiBase={apiBase}
                          companyID={companyID}
                          accent={accent}
                          surfaceText={surfaceText}
                          compact
                          loading={nodeAttachmentsLoading}
                          loadError={nodeAttachmentsLoadError}
                          onRetry={refreshNodeAttachments}
                          onAddFiles={canEdit ? (files) => addTextBlockAttachments(block.id, files) : undefined}
                          onRemove={canEdit ? (item) => { void deleteNodeAttachment(item.resourceAttachment); } : undefined}
                          onError={onError}
                        />}
                        {canEdit && !block.temporaryEmailChat && <TextBlockActionsMenu accent={accent} surfaceText={surfaceText} panelBackground={panelBackground} strokeColor={strokeColor} onDelete={(position) => requestDeleteTextBlock(block.id, position)} />}
                      </div>
                      <div data-node-pane-header="chat" style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
                        <button type="button" data-email-chat-destination-action={pendingEmailChatSelection ? "true" : undefined} title={pendingEmailChatSelection ? "Use this chat column for highlighted email text" : chatPaneIsVisible ? "Hide chat" : "Open chat"} aria-label={pendingEmailChatSelection ? "Use this chat column for highlighted email text" : "Toggle chat column"} aria-pressed={chatPaneIsVisible} onClick={toggleChat} style={{ minHeight: 26, borderRadius: 8, border: chatPaneIsVisible || pendingEmailChatSelection ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: chatPaneIsVisible || pendingEmailChatSelection ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: accent, display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", padding: "0 7px", fontSize: 10.5, fontWeight: 900, boxShadow: EDITOR_NEU_SHADOW }}>
                          <ChatIcon color={accent} />
                          <span>Chat</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  <div style={{ minWidth: 0, minHeight: 0, overflowX: linkedEmailExpanded ? "visible" : "auto", overflowY: linkedEmailExpanded ? "visible" : "hidden" }}>
                    <div className="mango-pane-layout-transition" data-node-text-box-columns="editor-chat" data-node-visible-panes={visiblePaneMode} data-node-linked-email-layout={linkedEmailExpanded ? "content-column" : "closed"} style={{ minWidth: Math.max(minimumCommunicationWidth, 1), height: linkedEmailExpanded ? "auto" : chatPaneHeight, minHeight: chatPaneHeight, display: "grid", gridTemplateColumns: blockCommunicationGridTemplateColumns, columnGap: 0, alignItems: "start", transition: "grid-template-columns 180ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
                      {contentPaneIsVisible && (
                        <div data-node-text-box-content-column="true" style={{ minWidth: 0, minHeight: 0, height: linkedEmailExpanded ? "auto" : chatPaneHeight, display: "grid", gridTemplateRows: linkedEmailExpanded && editorPaneIsVisible ? `auto ${editorPaneHeight}px` : linkedEmailExpanded ? "auto" : "minmax(0, 1fr)", overflow: linkedEmailExpanded ? "visible" : "hidden" }}>
                          {linkedEmailExpanded && linkedEmailMessageID && (
                            <div data-node-linked-email-content="true" className="mango-pane-enter" style={{ minWidth: 0, minHeight: 0, overflow: "visible" }}>
                              <LinkedEmailPreviewPane
                                messageID={linkedEmailMessageID}
                                emails={nodeAttachedEmails}
                                nodeID={nodeID}
                                apiBase={apiBase}
                                companyID={companyID}
                                currentUserID={author.userID}
                                companyUsers={companyUsers}
                                attachmentRequestJSON={requestJSON}
                                attachmentResourceType="node"
                                attachmentResourceID={nodeID}
                                attachmentInformationID={block.id}
                                attachmentEditorSurface="node_text_block_linked_email"
                                editable={canEdit}
                                accent={blockColor || accent}
                                surfaceText={surfaceText}
                                strokeColor={strokeColor}
                                activeSelection={activeNodeEmailSelection}
                                highlightRemovalRequest={emailHighlightRemovalRequest}
                                chatHighlightsByMessageID={emailChatHighlightsByMessageID}
                                onEmailSelectionChatRequest={openEmailSelectionChat}
                                onEmailSelectionTextBoxRequest={(messageID, quote) => { createEmailTextBlock(messageID, quote); }}
                                onEmailSelectionNodeRequest={(messageID, quote) => { void createNodeFromEmailSelection(messageID, quote); }}
                                initialReplyTargetMessageID={pendingEmailReply?.blockID === block.id ? pendingEmailReply.targetMessageID : undefined}
                                initialReplyAll={pendingEmailReply?.blockID === block.id ? pendingEmailReply.replyAll : false}
                                initialReplyRequestID={pendingEmailReply?.blockID === block.id ? pendingEmailReply.requestID : 0}
                                onError={onError}
                              />
                            </div>
                          )}
                          {editorPaneIsVisible && (
                            <div className="mango-pane-enter" style={{ minWidth: 0, minHeight: 0, height: editorPaneHeight, overflow: "hidden" }}>
                          {block.temporaryEmailChat ? (
                            <div
                              data-node-text-block-id={block.id}
                              aria-label="Pending email chat text box"
                              style={{ minHeight: TEXT_BLOCK_MIN_HEIGHT, height: TEXT_BLOCK_MIN_HEIGHT, background: "rgba(255,255,255,0.72)" }}
                            />
                          ) : (
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
                            chatMessages={messages}
                            pendingChatSelectionAnchor={selectionAnchor}
                            activeChatAnchorMessageID={activeChatAnchorMessageID}
                            chatNavigationRequest={chatNavigationRequest?.blockID === chatBlockID ? { anchorMessageID: chatNavigationRequest.anchorMessageID, requestID: chatNavigationRequest.requestID } : null}
                            onEntityLink={linkEntityFromEditor}
                            onChatNavigationConsumed={consumeChatNavigationRequest}
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
                            onPinChange={(pinned) => setTiptapPinnedBlockIDs((current) => {
                              const has = current.has(block.id);
                              if (has === pinned) return current;
                              const next = new Set(current);
                              if (pinned) next.add(block.id);
                              else next.delete(block.id);
                              return next;
                            })}
                            onDocumentFlush={(document) => updateTextBlockContent(block.id, { document })}
                            onDocumentConflict={() => onError("Mango is recovering this text box from its committed snapshot.")}
                            onDocumentError={onError}
                            onSaveStateChange={(state) => {
                              const failed = editorSaveNeedsFailureAttention(state);
                              setTextBlockSaveFailures((current) => current[block.id] === failed ? current : { ...current, [block.id]: failed });
                            }}
                            onRecoveryStorageError={onError}
                            onRecoveryStorageRecovered={() => onError("")}
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
                          )}
                            </div>
                          )}
                        </div>
                      )}
                      {contentPaneIsVisible && chatPaneIsVisible && renderTextSidePaneResizeHandle(chatBlockID, "chat", "before", chatPaneWidth, chatPaneMaxWidth)}
                      {chatPaneIsVisible && (
                        <div className="mango-pane-enter" style={{ minWidth: 0, height: chatPaneHeight, borderLeft: contentPaneIsVisible ? `1px solid ${EDITOR_NEU_SOFT_BORDER}` : 0, overflow: "hidden" }}>
                          <ChatPane
                    blockID={chatBlockID}
                    editable={canEdit}
                    apiBase={apiBase}
                    companyID={companyID}
                    entityRequestJSON={requestJSON}
                    messages={messages}
                    hideHeader
                    selectionAnchor={selectionAnchor}
                    draft={chatDrafts[chatBlockID] ?? ""}
                    draftEntityLinks={chatDraftEntityLinks[chatBlockID] ?? []}
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
                    attachmentsEnabled={!block.temporaryEmailChat}
                    heightStorageKey={`node-editor-chat-pane-height-v1:${companyID}:${nodeID}:${chatBlockID}`}
                    fixedHeight={chatPaneHeight}
                    onFocus={focusChat}
                    onDraftChange={(draft) => setChatDrafts((current) => ({ ...current, [chatBlockID]: draft }))}
                    onDraftEntityLinksChange={(links) => setChatDraftEntityLinks((current) => ({ ...current, [chatBlockID]: links }))}
                    onActivateMessage={activateChatMessage}
                    onNavigateToMessage={(messageID) => navigateToChatMessage(chatBlockID, messages, messageID)}
                    onReply={replyToMessage}
                    onEditMessage={editChatMessage}
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
        {timelineEventsByBlockIndex[blocks.length]?.map(renderNodeTimelineEvent)}
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

      {canEdit && emailPickerAnchor && (
        <UniversalEntityPicker
          companyID={companyID}
          requestJSON={requestJSON}
          sourceType="node"
          linkTargetTypes={["logic_gate", "project", "email_message"]}
          initialMode="link"
          initialCategory="email_message"
          anchor={emailPickerAnchor}
          onCancel={() => setEmailPickerAnchor(null)}
          onChoose={async (entity: EditorEntityLink, mode: UniversalEntityPickerMode) => {
            if (mode === "link") await linkEntityFromEditor(entity);
            else openEditorEntityLink(entity);
            setEmailPickerAnchor(null);
          }}
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
