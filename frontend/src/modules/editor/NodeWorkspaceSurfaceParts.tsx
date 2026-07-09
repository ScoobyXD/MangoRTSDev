import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConfirmActionMenu, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu.js";
import { getEmailMessage, getEmailThread, listEmailMessages, sendEmail, type EmailAddress, type EmailMailbox, type EmailMessage, type MessagePage } from "../communications/communicationsApi";
import { downloadMangoAttachment, loadMangoAttachmentObjectURL, type AttachmentRequestJSON, type MangoAttachmentResourceType, type MangoAttachmentVariantType } from "../attachments/attachmentApi";
import { canDeleteEditorTextBlockChatMessage, type EditorAttachedEmail, type EditorChatAttachment, type EditorTextBlockChatMessage } from "./editorProjection";
import { createEditorDocumentUndoHistory, resetEditorDocumentUndoHistory } from "./editorUndoHistory";
import { createEditorScrollMemory } from "./editorScroll";
import { EditorTabBar } from "./EditorTabBar";
import type { EditorTabID } from "./editorTabs";
import { EDITOR_TAB_TEXT, type EditorOutlineStyleID } from "./plainTextEditing";
import { buildEditorIndentGuideSegments, editorIndentGuideLeftForDepth, type EditorIndentGuideSegment } from "./editorIndentGuides";
import {
  EDITOR_RICH_TEXT_PREFIX,
  deserializeEditorDocumentHTML,
  linkifyEditorPlainTextToHTML,
  readEditorDocumentText,
  sanitizeEditorDocumentHTML,
  serializeEditorDocumentHTML,
} from "./richTextEditing";
import { resolveEditorTextBlockChatAnchorRanges } from "./editorTextBlockChatHighlights";
import {
  applyEditorIndentCommandToRoot,
  applyEditorInlineFormatToRoot,
  applyEditorNumberedListToRoot,
  applyEditorSelectionFontSizeToRoot,
  readEditorSelectionFormatState,
  useEditorDocumentSurfaceHandlers,
  type EditorDocumentFormattingController,
  type EditorSelectionInlineFormatState,
} from "./useEditorDocumentSurfaceHandlers";
import { EDITOR_DOCUMENT_FONT_SIZE_PX, getEditorDocumentFontFamily } from "./useEditorPreferences";
import { UnifiedRichEditorSurface, type UnifiedRichEditorFormattingController } from "./UnifiedRichEditorSurface";
import {
  createStandaloneImageClipboardHTML,
  findEditorImageFrame,
  hydrateEditorAttachmentImageFrames,
  readEditorImageData,
  writeImageClipboardData,
  writeImageToSystemClipboard,
} from "./editorImages";
import {
  buildMentionOptions,
  EDITOR_MENTION_BACKGROUND,
  EDITOR_MENTION_COLOR,
  mentionUserDisplayName,
  mentionUserOptionLabel,
  readActiveMentionDraft,
  splitTextByMentions,
  type ActiveMentionDraft,
} from "./editorMentions";
import {
  formatNodeContentChangeLabel,
  resolveNodeAdditionRange,
  resolveNodeDeletionAnchorOffset,
  type NodeContentChange,
} from "./nodeContentChanges";
import {
  ArrowRightIcon,
  avatarBackgroundForName,
  buildChatThreads,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES,
  clampChatPaneHeight,
  ChatIcon,
  type ChatThreadNode,
  countChatThreadDescendants,
  EMAIL_DRAG_MIME,
  formatAddressList,
  formatFileSize,
  formatTimestamp,
  imageFilesFromTransfer,
  initialsForName,
  isImageAttachment,
  MailIcon,
  messageAttachmentPayload,
  PaperclipIcon,
  PlusIcon,
  readChatAttachment,
  readStoredChatPaneHeight,
  storeChatPaneHeight,
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_PANEL_BACKGROUND,
  EDITOR_NEU_PANEL_SHADOW,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
  TEXT_BLOCK_BOTTOM_BUFFER_ROWS,
  TEXT_BLOCK_FONT_SIZE,
  TEXT_BLOCK_LINE_HEIGHT,
  TEXT_BLOCK_MAX_HEIGHT,
  TEXT_BLOCK_MIN_HEIGHT,
  TEXT_BLOCK_PADDING_BOTTOM,
  TEXT_BLOCK_PADDING_LEFT,
  TEXT_BLOCK_PADDING_RIGHT,
  TEXT_BLOCK_PADDING_TOP,
  type MentionableCompanyUser,
  type TextBlockImageDraft,
  type TextBlockSelectionAnchor,
  type TextBlockSelectionDraft,
  userAccentForName,
  useCloseFloatingMenu,
} from "./NodeWorkspaceSurfaceShared";
type TimelineCellProps = {
  accent: string;
  muted: boolean;
  isLast: boolean;
};

export const TimelineCell: React.FC<TimelineCellProps> = ({ accent, muted, isLast }) => (
  <div style={{ position: "relative", alignSelf: "stretch", minHeight: TEXT_BLOCK_MIN_HEIGHT, paddingTop: 9, color: "inherit", boxSizing: "border-box" }}>
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        bottom: isLast ? "auto" : -12,
        height: isLast ? 25 : undefined,
        left: 15,
        width: 1,
        background: muted ? "rgba(100,116,139,0.18)" : "rgba(100,116,139,0.35)",
      }}
    />
    <div aria-hidden="true" style={{ position: "relative", width: 31, height: 31, borderRadius: 999, border: `2px solid ${muted ? "rgba(100,116,139,0.28)" : accent}`, background: "#ffffff", boxShadow: "0 0 0 4px rgba(100,116,139,0.08)" }} />
  </div>
);

type TextBlockActionsMenuProps = {
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  onDelete: (position: ConfirmActionMenuPosition) => void;
};

function textBlockDeleteConfirmPositionFromElement(element: Element): ConfirmActionMenuPosition {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.max(12, Math.round(rect.right - 300)),
    y: Math.round(rect.bottom + 8),
  };
}

export const TextBlockActionsMenu: React.FC<TextBlockActionsMenuProps> = ({
  accent,
  surfaceText,
  panelBackground,
  strokeColor,
  onDelete,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useCloseFloatingMenu(open, rootRef, close);
  const menuItemStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 30,
    border: "none",
    borderRadius: 6,
    background: "#ffffff",
    color: surfaceText,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0,
    padding: "7px 9px",
    textAlign: "left",
  };
  return (
    <div ref={rootRef} style={{ position: "relative", width: 26, height: 24 }}>
      <button
        type="button"
        aria-label="Text box actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Text box actions"
        onClick={() => setOpen((nextOpen) => !nextOpen)}
        style={{ width: 26, height: 24, borderRadius: 5, border: `1px solid ${open ? accent : strokeColor}`, background: open ? "rgba(100,116,139,0.12)" : panelBackground, color: surfaceText, display: "grid", placeItems: "center", cursor: "pointer", fontSize: 13, fontWeight: 900, lineHeight: 1, letterSpacing: 0 }}
      >
        ...
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Text box actions"
          style={{
            position: "absolute",
            zIndex: 50,
            top: "calc(100% + 6px)",
            right: 0,
            width: 148,
            display: "grid",
            gap: 3,
            padding: 5,
            border: `1px solid ${strokeColor}`,
            borderRadius: 8,
            background: "#ffffff",
            boxShadow: "0 12px 28px rgba(0,0,0,0.14)",
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={(event) => {
              const position = textBlockDeleteConfirmPositionFromElement(event.currentTarget);
              setOpen(false);
              onDelete(position);
            }}
            style={{ ...menuItemStyle, color: "#dc2626" }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

type DeleteTextBlockConfirmationModalProps = {
  title: string;
  chatCount: number;
  accent: string;
  surfaceText: string;
  panelBackground: string;
  ruleColor: string;
  position?: ConfirmActionMenuPosition | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export const DeleteTextBlockConfirmationModal: React.FC<DeleteTextBlockConfirmationModalProps> = ({
  title,
  chatCount,
  position,
  onConfirm,
  onCancel,
}) => (
  <ConfirmActionMenu
    title="Are you sure you want to delete this?"
    detail={`This removes "${title}" from the middle column${chatCount > 0 ? ` and deletes ${chatCount} chat repl${chatCount === 1 ? "y" : "ies"} attached to it` : ""}.`}
    position={position}
    isDarkTheme={false}
    onConfirm={onConfirm}
    onCancel={onCancel}
  />
);

type NodeTextBlockEditorProps = {
  blockID: string;
  editable: boolean;
  nodeID: string;
  apiBase: string;
  companyID: string;
  attachmentResourceType?: MangoAttachmentResourceType;
  attachmentResourceID?: string;
  attachmentRequestJSON?: AttachmentRequestJSON;
  attachmentEditorSurface?: string;
  currentUserID: string;
  companyUsers: MentionableCompanyUser[];
  documentValue: string;
  contentChanges: NodeContentChange[];
  chatMessages: EditorTextBlockChatMessage[];
  activeChatAnchorMessageID: string;
  chatNavigationRequest: { anchorMessageID: string; requestID: number } | null;
  tableInsertRequestID: number;
  surfaceText: string;
  accent: string;
  outlineStyle: EditorOutlineStyleID;
  indentGuideColor: string;
  scrollbarTrack: string;
  onFocus: () => void;
  onBlur: () => void;
  onDocumentChange: (document: string) => void;
  onDocumentFlush: (document: string) => void;
  onChangeSeen: (changeID: string) => void;
  onSelectionChatRequest: (selection: TextBlockSelectionDraft) => void;
  onImageChatRequest: (image: TextBlockImageDraft) => void;
  onImageNodeRequest: (image: TextBlockImageDraft) => void;
  formattingControllerRef?: React.MutableRefObject<EditorDocumentFormattingController | null>;
  onSelectionFontSizeChange?: (fontSize: number) => void;
  onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void;
};

function readStoredTextBlockHeight(storageKey: string): number {
  if (typeof localStorage === "undefined") return TEXT_BLOCK_MIN_HEIGHT;
  const parsed = Number.parseInt(localStorage.getItem(storageKey) ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(TEXT_BLOCK_MIN_HEIGHT, Math.min(parsed, TEXT_BLOCK_MAX_HEIGHT)) : TEXT_BLOCK_MIN_HEIGHT;
}

function storeTextBlockHeight(storageKey: string, height: number) {
  if (typeof localStorage === "undefined" || !Number.isFinite(height)) return;
  localStorage.setItem(storageKey, String(Math.max(TEXT_BLOCK_MIN_HEIGHT, Math.min(Math.round(height), TEXT_BLOCK_MAX_HEIGHT))));
}

type TextHighlightRect = {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  active: boolean;
};

const EDITOR_SOURCE_HIGHLIGHT_BACKGROUND = "linear-gradient(135deg, rgba(254,255,102,0.72), rgba(250,232,28,0.58))";
const EDITOR_SOURCE_HIGHLIGHT_ACTIVE_BACKGROUND = "linear-gradient(135deg, rgba(255,255,80,0.88), rgba(250,245,24,0.78))";
const EDITOR_SOURCE_HIGHLIGHT_OUTLINE = "0 0 0 2px rgba(234,179,8,0.72), 0 0 18px rgba(250,255,0,0.34)";
const EDITOR_SOURCE_HIGHLIGHT_SOFT_OUTLINE = "0 0 0 1px rgba(234,179,8,0.32)";

type NodeContentChangeLabelLayout = {
  change: NodeContentChange;
  left: number;
  top: number;
};

type TextRangeBoundary = {
  container: Node;
  offset: number;
};

function editorHasFocus(element: HTMLElement): boolean {
  const activeElement = element.ownerDocument.activeElement;
  return activeElement === element || Boolean(activeElement && element.contains(activeElement));
}

function locateTextRangeBoundary(root: HTMLElement, targetOffset: number): TextRangeBoundary {
  const target = Math.max(0, Math.trunc(targetOffset));
  let currentOffset = 0;

  const walk = (parent: Node): TextRangeBoundary | null => {
    for (let index = 0; index < parent.childNodes.length; index += 1) {
      const child = parent.childNodes[index];
      if (child.nodeType === Node.TEXT_NODE) {
        const length = child.textContent?.length ?? 0;
        if (target <= currentOffset + length) {
          return {
            container: child,
            offset: Math.max(0, Math.min(length, target - currentOffset)),
          };
        }
        currentOffset += length;
        continue;
      }
      if (child instanceof HTMLElement && child.tagName === "BR") {
        if (target <= currentOffset + 1) {
          return { container: parent, offset: index + (target > currentOffset ? 1 : 0) };
        }
        currentOffset += 1;
        continue;
      }
      const nested = walk(child);
      if (nested) return nested;
    }
    return null;
  };

  return walk(root) ?? { container: root, offset: root.childNodes.length };
}

function createTextRangeFromOffsets(root: HTMLElement, startOffset: number, endOffset: number): Range | null {
  if (endOffset <= startOffset) return null;
  const range = root.ownerDocument.createRange();
  const start = locateTextRangeBoundary(root, startOffset);
  const end = locateTextRangeBoundary(root, endOffset);
  try {
    range.setStart(start.container, start.offset);
    range.setEnd(end.container, end.offset);
    return range.collapsed ? null : range;
  } catch {
    return null;
  }
}

function scrollTextRangeIntoEditorView(root: HTMLElement, range: Range) {
  const rect = Array.from(range.getClientRects()).find((item) => item.width > 0 && item.height > 0) ?? range.getBoundingClientRect();
  if (!Number.isFinite(rect.top) || rect.height <= 0) return;
  const rootRect = root.getBoundingClientRect();
  const targetTop = root.scrollTop + rect.top - rootRect.top - root.clientHeight * 0.28;
  root.scrollTo({ top: Math.max(0, Math.round(targetTop)), behavior: "smooth" });
}

function getSelectionPointDocumentOffset(root: HTMLElement, container: Node | null, offset: number): number | null {
  if (!container || !(container === root || root.contains(container))) return null;
  const range = root.ownerDocument.createRange();
  try {
    range.selectNodeContents(root);
    range.setEnd(container, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function buildTextHighlightRects(root: HTMLElement, wrapper: HTMLElement, activeMessageID: string, messages: EditorTextBlockChatMessage[]): TextHighlightRect[] {
  const documentText = readEditorDocumentText(root);
  const ranges = resolveEditorTextBlockChatAnchorRanges(documentText, messages);
  if (ranges.length === 0) return [];
  const wrapperRect = wrapper.getBoundingClientRect();
  const editorRect = root.getBoundingClientRect();
  const rects: TextHighlightRect[] = [];

  for (const anchorRange of ranges) {
    const range = createTextRangeFromOffsets(root, anchorRange.startOffset, anchorRange.endOffset);
    if (!range) continue;
    const active = anchorRange.messageID === activeMessageID;
    Array.from(range.getClientRects()).forEach((rect, rectIndex) => {
      const left = Math.max(rect.left, editorRect.left) - wrapperRect.left;
      const right = Math.min(rect.right, editorRect.right) - wrapperRect.left;
      const top = Math.max(rect.top, editorRect.top) - wrapperRect.top;
      const bottom = Math.min(rect.bottom, editorRect.bottom) - wrapperRect.top;
      const width = right - left;
      const height = bottom - top;
      if (width < 1 || height < 2) return;
      rects.push({
        key: `${anchorRange.messageID}:${rectIndex}:${Math.round(left)}:${Math.round(top)}`,
        left,
        top,
        width,
        height,
        active,
      });
    });
  }

  return rects;
}

function firstVisibleRangeRect(root: HTMLElement, wrapper: HTMLElement, startOffset: number, endOffset: number): DOMRect | null {
  const range = createTextRangeFromOffsets(root, startOffset, endOffset);
  if (!range) return null;
  const wrapperRect = wrapper.getBoundingClientRect();
  const editorRect = root.getBoundingClientRect();
  for (const rect of Array.from(range.getClientRects())) {
    const left = Math.max(rect.left, editorRect.left) - wrapperRect.left;
    const right = Math.min(rect.right, editorRect.right) - wrapperRect.left;
    const top = Math.max(rect.top, editorRect.top) - wrapperRect.top;
    const bottom = Math.min(rect.bottom, editorRect.bottom) - wrapperRect.top;
    if (right - left >= 1 && bottom - top >= 2) {
      return new DOMRect(left, top, right - left, bottom - top);
    }
  }
  const rect = range.getBoundingClientRect();
  const left = Math.max(rect.left, editorRect.left) - wrapperRect.left;
  const top = Math.max(rect.top, editorRect.top) - wrapperRect.top;
  return new DOMRect(left, top, Math.max(1, rect.width), Math.max(16, rect.height || 16));
}

function buildNodeContentChangeVisuals(root: HTMLElement, wrapper: HTMLElement, changes: NodeContentChange[], activeChangeID: string): {
  rects: TextHighlightRect[];
  labels: NodeContentChangeLabelLayout[];
} {
  if (changes.length === 0) return { rects: [], labels: [] };
  const documentText = readEditorDocumentText(root);
  const wrapperRect = wrapper.getBoundingClientRect();
  const editorRect = root.getBoundingClientRect();
  const rects: TextHighlightRect[] = [];
  const labels: NodeContentChangeLabelLayout[] = [];

  for (const change of changes) {
    if (change.change_type === "addition") {
      const range = resolveNodeAdditionRange(documentText, change);
      if (!range) continue;
      const rangeRect = createTextRangeFromOffsets(root, range.startOffset, range.endOffset);
      if (!rangeRect) continue;
      const active = change.change_id === activeChangeID;
      const visibleRects = Array.from(rangeRect.getClientRects())
        .map((rect, rectIndex) => {
          const left = Math.max(rect.left, editorRect.left) - wrapperRect.left;
          const right = Math.min(rect.right, editorRect.right) - wrapperRect.left;
          const top = Math.max(rect.top, editorRect.top) - wrapperRect.top;
          const bottom = Math.min(rect.bottom, editorRect.bottom) - wrapperRect.top;
          const width = right - left;
          const height = bottom - top;
          if (width < 1 || height < 2) return null;
          return {
            key: `${change.change_id}:${rectIndex}:${Math.round(left)}:${Math.round(top)}`,
            left,
            top,
            width,
            height,
            active,
          };
        })
        .filter((rect): rect is TextHighlightRect => rect !== null);
      rects.push(...visibleRects);
      const firstRect = visibleRects[0];
      if (firstRect) {
        labels.push({
          change,
          left: -12,
          top: Math.max(6, firstRect.top - 2),
        });
      }
      continue;
    }

    const anchorOffset = resolveNodeDeletionAnchorOffset(documentText, change);
    const endOffset = Math.min(documentText.length, anchorOffset + 1);
    const anchorRect = documentText.length > 0 && endOffset > anchorOffset
      ? firstVisibleRangeRect(root, wrapper, anchorOffset, endOffset)
      : null;
    labels.push({
      change,
      left: -12,
      top: Math.max(6, anchorRect?.top ?? TEXT_BLOCK_PADDING_TOP),
    });
  }

  labels.sort((a, b) => a.top - b.top || a.left - b.left);
  let previousBottom = -Infinity;
  for (const label of labels) {
    if (label.top < previousBottom + 4) {
      label.top = previousBottom + 4;
    }
    previousBottom = label.top + 26;
  }
  return { rects, labels };
}

function imageDataURLMimeType(dataURL: string): string {
  const match = /^data:([^;,]+);base64,/i.exec(dataURL.trim());
  return match?.[1] ?? "image/png";
}

function imageDataURLByteSize(dataURL: string): number {
  const commaIndex = dataURL.indexOf(",");
  if (commaIndex < 0) return dataURL.length;
  const base64 = dataURL.slice(commaIndex + 1).replace(/\s+/g, "");
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

type CopyShortcutEvent = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

function isCopyShortcut(event: CopyShortcutEvent): boolean {
  return Boolean((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "c");
}

function copyImageAttachmentToClipboard(attachment: EditorChatAttachment, clipboardData?: DataTransfer): boolean {
  if (!isImageAttachment(attachment) || !attachment.dataURL) return false;
  const label = attachment.name.trim() || "Image";
  const html = createStandaloneImageClipboardHTML(attachment.dataURL, label);
  if (!html) return false;
  const wroteEventClipboard = clipboardData ? writeImageClipboardData(clipboardData, attachment.dataURL, html, label) : false;
  const wroteSystemClipboard = writeImageToSystemClipboard(attachment.dataURL, html, label);
  return wroteEventClipboard || wroteSystemClipboard;
}

function attachmentIDForContent(attachment: EditorChatAttachment): string {
  return attachment.attachmentID?.trim() || (attachment.dataURL ? "" : attachment.id.trim());
}

function canLoadAttachmentContent(attachment: EditorChatAttachment, apiBase?: string, companyID?: string): boolean {
  return Boolean(apiBase?.trim() && companyID?.trim() && attachmentIDForContent(attachment));
}

function useAttachmentObjectURL(
  attachment: EditorChatAttachment,
  apiBase: string | undefined,
  companyID: string | undefined,
  variant: MangoAttachmentVariantType,
  enabled = true,
): string {
  const legacyDataURL = attachment.dataURL?.trim() ?? "";
  const attachmentID = attachmentIDForContent(attachment);
  const [objectURL, setObjectURL] = useState("");

  useEffect(() => {
    setObjectURL("");
    if (!enabled || legacyDataURL || !apiBase?.trim() || !companyID?.trim() || !attachmentID) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    void loadMangoAttachmentObjectURL(apiBase, companyID, attachmentID, variant, { signal: controller.signal })
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setObjectURL(url);
      })
      .catch(() => {
        if (!cancelled) setObjectURL("");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBase, attachmentID, companyID, enabled, legacyDataURL, variant]);

  useEffect(() => () => {
    if (objectURL) URL.revokeObjectURL(objectURL);
  }, [objectURL]);

  return enabled ? legacyDataURL || objectURL : "";
}

async function downloadChatAttachment(attachment: EditorChatAttachment, apiBase?: string, companyID?: string): Promise<boolean> {
  if (attachment.dataURL && typeof document !== "undefined") {
    const link = document.createElement("a");
    link.href = attachment.dataURL;
    link.download = attachment.name.trim() || "attachment";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  }
  const attachmentID = attachmentIDForContent(attachment);
  if (!apiBase?.trim() || !companyID?.trim() || !attachmentID) return false;
  await downloadMangoAttachment({
    apiBase,
    companyID,
    attachmentID,
    filename: attachment.name,
  });
  return true;
}

function openChatAttachment(
  attachment: EditorChatAttachment,
  onPreviewImage: (attachment: EditorChatAttachment) => void,
  apiBase?: string,
  companyID?: string,
): boolean {
  if (isImageAttachment(attachment)) {
    onPreviewImage(attachment);
    return true;
  }
  void downloadChatAttachment(attachment, apiBase, companyID).catch(() => undefined);
  return Boolean(attachment.dataURL || canLoadAttachmentContent(attachment, apiBase, companyID));
}

function readImageDraftFromFrame(blockID: string, frame: HTMLElement, wrapper: HTMLElement): TextBlockImageDraft | null {
  const imageData = readEditorImageData(frame);
  if (!imageData?.src) return null;
  const frameRect = frame.getBoundingClientRect();
  const wrapperRect = wrapper.getBoundingClientRect();
  const x = Math.max(8, Math.min(frameRect.right - wrapperRect.left + 8, wrapperRect.width - 66));
  const y = Math.max(6, Math.min(frameRect.top - wrapperRect.top + 4, wrapperRect.height - 34));
  return {
    blockID,
    dataURL: imageData.src,
    mimeType: imageDataURLMimeType(imageData.src),
    size: imageDataURLByteSize(imageData.src),
    width: imageData.width,
    height: imageData.height,
    x,
    y,
  };
}

export const NodeTextBlockEditor: React.FC<NodeTextBlockEditorProps> = ({
  blockID,
  editable,
  nodeID,
  apiBase,
  companyID,
  attachmentResourceType,
  attachmentResourceID,
  attachmentRequestJSON,
  attachmentEditorSurface,
  currentUserID,
  companyUsers,
  documentValue,
  contentChanges,
  chatMessages,
  activeChatAnchorMessageID,
  chatNavigationRequest,
  tableInsertRequestID,
  surfaceText,
  accent,
  outlineStyle,
  indentGuideColor,
  scrollbarTrack,
  onFocus,
  onBlur,
  onDocumentChange,
  onDocumentFlush,
  onChangeSeen,
  onSelectionChatRequest,
  onImageChatRequest,
  onImageNodeRequest,
  formattingControllerRef,
  onSelectionFontSizeChange,
  onSelectionInlineFormatChange,
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const restoringScrollRef = useRef(false);
  const documentTargetKey = `node-text-block:${nodeID}:${blockID}`;
  const targetKeyRef = useRef(documentTargetKey);
  const loadedDocumentTargetKeyRef = useRef(documentTargetKey);
  const scrollMemoryRef = useRef(createEditorScrollMemory());
  const documentUndoHistoryRef = useRef(createEditorDocumentUndoHistory());
  const pendingFontSizeRef = useRef<number | null>(null);
  const indentGuideFrameRef = useRef<number | null>(null);
  const selectionPointerDownRef = useRef(false);
  const lastHandledTableInsertRequestIDRef = useRef(0);
  const lastAppliedDocumentRef = useRef("");
  const userEditedDocumentRef = useRef(false);
  const lastStoredHeightRef = useRef(0);
  const heightStorageKey = `node-editor-text-block-height-v2:${currentUserID}:${companyID}:${nodeID}:${blockID}`;
  const [height, setHeight] = useState(() => readStoredTextBlockHeight(heightStorageKey));
  const [documentScrollTop, setDocumentScrollTop] = useState(0);
  const [indentGuideSegments, setIndentGuideSegments] = useState<EditorIndentGuideSegment[]>([]);
  const [selectionDraft, setSelectionDraft] = useState<TextBlockSelectionDraft | null>(null);
  const [imageDraft, setImageDraft] = useState<TextBlockImageDraft | null>(null);
  const [textHighlightRects, setTextHighlightRects] = useState<TextHighlightRect[]>([]);
  const [contentChangeHighlightRects, setContentChangeHighlightRects] = useState<TextHighlightRect[]>([]);
  const [contentChangeLabels, setContentChangeLabels] = useState<NodeContentChangeLabelLayout[]>([]);
  const [activeContentChangeID, setActiveContentChangeID] = useState("");
  const documentFontFamily = getEditorDocumentFontFamily(outlineStyle);
  const documentLineHeightPx = TEXT_BLOCK_FONT_SIZE * TEXT_BLOCK_LINE_HEIGHT;
  const textBlockBottomBufferPx = documentLineHeightPx * TEXT_BLOCK_BOTTOM_BUFFER_ROWS;
  const textBlockPaddingBottomPx = TEXT_BLOCK_PADDING_BOTTOM + textBlockBottomBufferPx;
  const showIndentGuides = outlineStyle === "indent-guides" && indentGuideSegments.length > 0;
  const selectionFontSizeRef = useRef(TEXT_BLOCK_FONT_SIZE);

  const refreshTextHighlights = useCallback(() => {
    const editor = editorRef.current;
    const wrapper = wrapperRef.current;
    if (!editor || !wrapper) {
      setTextHighlightRects((current) => current.length > 0 ? [] : current);
      setContentChangeHighlightRects((current) => current.length > 0 ? [] : current);
      setContentChangeLabels((current) => current.length > 0 ? [] : current);
      return;
    }
    const nextRects = buildTextHighlightRects(editor, wrapper, activeChatAnchorMessageID, chatMessages);
    setTextHighlightRects(nextRects);
    const nextChangeVisuals = buildNodeContentChangeVisuals(editor, wrapper, contentChanges, activeContentChangeID);
    setContentChangeHighlightRects(nextChangeVisuals.rects);
    setContentChangeLabels(nextChangeVisuals.labels);
  }, [activeChatAnchorMessageID, activeContentChangeID, chatMessages, contentChanges]);

  useEffect(() => {
    targetKeyRef.current = documentTargetKey;
  }, [documentTargetKey]);

  useEffect(() => {
    if (!activeContentChangeID) return;
    if (!contentChanges.some((change) => change.change_id === activeContentChangeID)) {
      setActiveContentChangeID("");
    }
  }, [activeContentChangeID, contentChanges]);

  useEffect(() => {
    const nextHeight = readStoredTextBlockHeight(heightStorageKey);
    lastStoredHeightRef.current = nextHeight;
    setHeight(nextHeight);
  }, [heightStorageKey]);

  useLayoutEffect(() => {
    const element = editorRef.current;
    if (!element) return;
    const nextHTML = deserializeEditorDocumentHTML(documentValue);
    const targetChanged = loadedDocumentTargetKeyRef.current !== documentTargetKey;
    if (!targetChanged && documentValue === lastAppliedDocumentRef.current) return;
    if (!targetChanged) {
      const currentDocument = serializeEditorDocumentHTML(element);
      if (documentValue === currentDocument) {
        lastAppliedDocumentRef.current = documentValue;
        userEditedDocumentRef.current = false;
        return;
      }
      if (editorHasFocus(element)) return;
    }
    element.innerHTML = nextHTML;
    resetEditorDocumentUndoHistory(documentUndoHistoryRef.current);
    lastAppliedDocumentRef.current = documentValue;
    userEditedDocumentRef.current = false;
    loadedDocumentTargetKeyRef.current = documentTargetKey;
  }, [documentTargetKey, documentValue]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !apiBase.trim() || !companyID.trim()) return;
    hydrateEditorAttachmentImageFrames(editor, (attachmentID, variant, options) => (
      loadMangoAttachmentObjectURL(apiBase, companyID, attachmentID, variant, options)
    ));
  }, [apiBase, companyID, documentTargetKey, documentValue]);

  useEffect(() => {
    const element = editorRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const nextHeight = Math.round(element.getBoundingClientRect().height);
      refreshTextHighlights();
      if (!Number.isFinite(nextHeight) || Math.abs(nextHeight - lastStoredHeightRef.current) < 2) return;
      lastStoredHeightRef.current = nextHeight;
      setHeight(nextHeight);
      storeTextBlockHeight(heightStorageKey, nextHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [heightStorageKey, refreshTextHighlights]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(refreshTextHighlights);
    return () => window.cancelAnimationFrame(frame);
  }, [documentValue, documentScrollTop, height, refreshTextHighlights]);

  useEffect(() => {
    if (!chatNavigationRequest?.anchorMessageID) return;
    const editor = editorRef.current;
    if (!editor) return;
    const frame = window.requestAnimationFrame(() => {
      const documentText = readEditorDocumentText(editor);
      const anchorRange = resolveEditorTextBlockChatAnchorRanges(documentText, chatMessages)
        .find((item) => item.messageID === chatNavigationRequest.anchorMessageID);
      if (!anchorRange) return;
      const range = createTextRangeFromOffsets(editor, anchorRange.startOffset, anchorRange.endOffset);
      if (!range) return;
      scrollTextRangeIntoEditorView(editor, range);
      refreshTextHighlights();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chatMessages, chatNavigationRequest?.anchorMessageID, chatNavigationRequest?.requestID, refreshTextHighlights]);

  const scheduleTextBlockIndentGuideUpdate = useCallback((text: string) => {
    if (indentGuideFrameRef.current !== null) {
      window.cancelAnimationFrame(indentGuideFrameRef.current);
      indentGuideFrameRef.current = null;
    }
    if (outlineStyle !== "indent-guides") {
      setIndentGuideSegments((current) => current.length > 0 ? [] : current);
      return;
    }
    indentGuideFrameRef.current = window.requestAnimationFrame(() => {
      indentGuideFrameRef.current = null;
      setIndentGuideSegments(buildEditorIndentGuideSegments(text, EDITOR_TAB_TEXT.length));
    });
  }, [outlineStyle]);

  useEffect(() => {
    scheduleTextBlockIndentGuideUpdate(editorRef.current ? readEditorDocumentText(editorRef.current) : documentValue);
  }, [documentValue, scheduleTextBlockIndentGuideUpdate]);

  useEffect(() => () => {
    if (indentGuideFrameRef.current !== null) {
      window.cancelAnimationFrame(indentGuideFrameRef.current);
      indentGuideFrameRef.current = null;
    }
  }, []);

  const handleSelectionFontSizeChange = useCallback((fontSize: number) => {
    selectionFontSizeRef.current = fontSize;
    onSelectionFontSizeChange?.(fontSize);
  }, [onSelectionFontSizeChange]);

  const scheduleNodeDocumentSave = useCallback((nextDocument: string, immediate = false) => {
    if (!editable) return;
    userEditedDocumentRef.current = true;
    lastAppliedDocumentRef.current = nextDocument;
    onDocumentChange(nextDocument);
    if (immediate) onDocumentFlush(nextDocument);
  }, [editable, onDocumentChange, onDocumentFlush]);

  const flushNodeDocumentSave = useCallback((fallbackDocument?: string) => {
    if (!editable) return;
    const nextDocument = fallbackDocument ?? (editorRef.current ? serializeEditorDocumentHTML(editorRef.current) : lastAppliedDocumentRef.current);
    if (!userEditedDocumentRef.current && nextDocument.trim().length === 0 && documentValue.trim().length > 0 && lastAppliedDocumentRef.current !== documentValue) {
      return;
    }
    lastAppliedDocumentRef.current = nextDocument;
    onDocumentFlush(nextDocument);
  }, [documentValue, editable, onDocumentFlush]);

  const editorImageAttachmentContext = useMemo(() => (
    attachmentRequestJSON && attachmentResourceType && attachmentResourceID
      ? {
        requestJSON: attachmentRequestJSON,
        apiBase,
        companyID,
        resourceType: attachmentResourceType,
        resourceID: attachmentResourceID,
        informationID: blockID,
        editorSurface: attachmentEditorSurface,
      }
      : undefined
  ), [apiBase, attachmentEditorSurface, attachmentRequestJSON, attachmentResourceID, attachmentResourceType, blockID, companyID]);

  const handlers = useEditorDocumentSurfaceHandlers({
    restoringScrollRef,
    currentDocumentTargetKeyRef: targetKeyRef,
    scrollMemoryRef,
    documentUndoHistoryRef,
    pendingEditorFontSizeRef: pendingFontSizeRef,
    outlineStyle,
    setDocumentScrollTop,
    scheduleDocumentSave: scheduleNodeDocumentSave,
    scheduleIndentGuideUpdate: scheduleTextBlockIndentGuideUpdate,
    rememberCurrentDocumentScroll: () => undefined,
    flushPendingDocumentSave: flushNodeDocumentSave,
    onSelectionFontSizeChange: handleSelectionFontSizeChange,
    onSelectionInlineFormatChange,
    mentionUsers: companyUsers,
    mentionAccent: accent,
    mentionSurfaceText: surfaceText,
    mentionStrokeColor: indentGuideColor,
    mentionMenuPosition: "absolute",
    editorImageAttachmentContext,
  });
  const { mentionMenu: documentMentionMenu, insertTable, ...documentSurfaceHandlers } = handlers;
  const formattingController = useMemo<EditorDocumentFormattingController>(() => ({
    applyFontSizeValue: (fontSize: number) => {
      const editor = editorRef.current;
      if (!editable || !editor) return false;
      return applyEditorSelectionFontSizeToRoot(editor, fontSize, {
        documentUndoHistory: documentUndoHistoryRef.current,
        pendingEditorFontSizeRef: pendingFontSizeRef,
        scheduleDocumentSave: scheduleNodeDocumentSave,
        scheduleIndentGuideUpdate: scheduleTextBlockIndentGuideUpdate,
        onSelectionFontSizeChange: handleSelectionFontSizeChange,
      });
    },
    adjustFontSize: (delta: number) => {
      const editor = editorRef.current;
      if (!editable || !editor) return false;
      const currentState = readEditorSelectionFormatState(editor, selectionFontSizeRef.current);
      const currentFontSize = pendingFontSizeRef.current ?? currentState?.fontSize ?? selectionFontSizeRef.current;
      return applyEditorSelectionFontSizeToRoot(editor, currentFontSize + delta, {
        documentUndoHistory: documentUndoHistoryRef.current,
        pendingEditorFontSizeRef: pendingFontSizeRef,
        scheduleDocumentSave: scheduleNodeDocumentSave,
        scheduleIndentGuideUpdate: scheduleTextBlockIndentGuideUpdate,
        onSelectionFontSizeChange: handleSelectionFontSizeChange,
      });
    },
    toggleInlineFormat: (command) => {
      const editor = editorRef.current;
      if (!editable || !editor) return false;
      return applyEditorInlineFormatToRoot(editor, command, {
        documentUndoHistory: documentUndoHistoryRef.current,
        scheduleDocumentSave: scheduleNodeDocumentSave,
        scheduleIndentGuideUpdate: scheduleTextBlockIndentGuideUpdate,
        onSelectionInlineFormatChange,
      });
    },
    toggleNumberedList: () => {
      const editor = editorRef.current;
      if (!editable || !editor) return false;
      return applyEditorNumberedListToRoot(editor, {
        documentUndoHistory: documentUndoHistoryRef.current,
        scheduleDocumentSave: scheduleNodeDocumentSave,
        scheduleIndentGuideUpdate: scheduleTextBlockIndentGuideUpdate,
      });
    },
    indent: () => {
      const editor = editorRef.current;
      if (!editable || !editor) return false;
      return applyEditorIndentCommandToRoot(editor, "indent", outlineStyle, {
        documentUndoHistory: documentUndoHistoryRef.current,
        scheduleDocumentSave: scheduleNodeDocumentSave,
        scheduleIndentGuideUpdate: scheduleTextBlockIndentGuideUpdate,
      });
    },
    outdent: () => {
      const editor = editorRef.current;
      if (!editable || !editor) return false;
      return applyEditorIndentCommandToRoot(editor, "outdent", outlineStyle, {
        documentUndoHistory: documentUndoHistoryRef.current,
        scheduleDocumentSave: scheduleNodeDocumentSave,
        scheduleIndentGuideUpdate: scheduleTextBlockIndentGuideUpdate,
      });
    },
    insertTable: () => {
      if (!editable) return false;
      return insertTable(editorRef.current);
    },
    readFormatState: () => {
      const editor = editorRef.current;
      return editor ? readEditorSelectionFormatState(editor, selectionFontSizeRef.current) : null;
    },
  }), [editable, handleSelectionFontSizeChange, insertTable, onSelectionInlineFormatChange, outlineStyle, scheduleNodeDocumentSave, scheduleTextBlockIndentGuideUpdate]);

  const activateFormattingController = useCallback(() => {
    if (!formattingControllerRef || !editable) return;
    formattingControllerRef.current = formattingController;
  }, [editable, formattingController, formattingControllerRef]);

  useEffect(() => {
    if (!tableInsertRequestID || !editable) return;
    if (lastHandledTableInsertRequestIDRef.current === tableInsertRequestID) return;
    lastHandledTableInsertRequestIDRef.current = tableInsertRequestID;
    activateFormattingController();
    formattingController.insertTable();
  }, [activateFormattingController, editable, formattingController, tableInsertRequestID]);

  const handleBlur: React.FocusEventHandler<HTMLDivElement> = (event) => {
    handlers.onBlur(event);
    onBlur();
  };

  const readSelectionDraft = useCallback((): TextBlockSelectionDraft | null => {
    if (!editable) return null;
    const editor = editorRef.current;
    const wrapper = wrapperRef.current;
    if (!editor || !wrapper) return null;
    const selection = editor.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const commonElement = range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    if (commonElement?.closest('[data-floating-selection-actions="disabled"]')) return null;
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
    const rawSelectedText = range.toString();
    const leadingTrim = rawSelectedText.length - rawSelectedText.trimStart().length;
    const selectedText = rawSelectedText.trim();
    if (!selectedText) return null;

    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(editor);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const documentTextLength = readEditorDocumentText(editor).length;
    const startOffset = Math.max(0, Math.min(beforeRange.toString().length + leadingTrim, documentTextLength));
    const endOffset = Math.max(startOffset, Math.min(startOffset + selectedText.length, documentTextLength));
    if (endOffset <= startOffset) return null;

    const rangeRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    const selectionRect = range.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const anchorOffset = getSelectionPointDocumentOffset(editor, selection.anchorNode, selection.anchorOffset);
    const focusOffset = getSelectionPointDocumentOffset(editor, selection.focusNode, selection.focusOffset);
    const isForwardSelection = anchorOffset === null || focusOffset === null || anchorOffset <= focusOffset;
    const firstRect = rangeRects[0] ?? selectionRect;
    const lastRect = rangeRects[rangeRects.length - 1] ?? selectionRect;
    const iconRect = isForwardSelection ? lastRect : firstRect;
    const preferredX = isForwardSelection
      ? iconRect.right - wrapperRect.left + 8
      : iconRect.left - wrapperRect.left - 36;
    const preferredY = iconRect.top - wrapperRect.top + ((iconRect.height - 28) / 2);
    const x = Math.max(8, Math.min(preferredX, wrapperRect.width - 34));
    const y = Math.max(6, Math.min(preferredY, wrapperRect.height - 34));
    return {
      blockID,
      quote: selectedText,
      startOffset,
      endOffset,
      x,
      y,
    };
  }, [blockID, editable]);

  const captureSelectionDraft = useCallback(() => {
    window.setTimeout(() => {
      if (selectionPointerDownRef.current) return;
      const nextDraft = readSelectionDraft();
      setSelectionDraft(nextDraft);
      if (nextDraft) setImageDraft(null);
    }, 0);
  }, [readSelectionDraft]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const ownerDocument = editor.ownerDocument;
    const onSelectionChange = () => {
      const selection = ownerDocument.getSelection();
      const anchorNode = selection?.anchorNode ?? null;
      const focusNode = selection?.focusNode ?? null;
      if (!anchorNode && !focusNode) {
        setSelectionDraft(null);
        return;
      }
      if ((anchorNode && editor.contains(anchorNode)) || (focusNode && editor.contains(focusNode))) {
        if (selectionPointerDownRef.current) return;
        captureSelectionDraft();
      }
    };
    ownerDocument.addEventListener("selectionchange", onSelectionChange);
    return () => ownerDocument.removeEventListener("selectionchange", onSelectionChange);
  }, [captureSelectionDraft]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const ownerDocument = editor.ownerDocument;
    const onPointerUp = () => {
      if (!selectionPointerDownRef.current) return;
      selectionPointerDownRef.current = false;
      captureSelectionDraft();
    };
    const onPointerCancel = () => {
      selectionPointerDownRef.current = false;
    };
    ownerDocument.addEventListener("pointerup", onPointerUp, true);
    ownerDocument.addEventListener("pointercancel", onPointerCancel, true);
    return () => {
      ownerDocument.removeEventListener("pointerup", onPointerUp, true);
      ownerDocument.removeEventListener("pointercancel", onPointerCancel, true);
    };
  }, [captureSelectionDraft]);

  return (
    <div
      ref={wrapperRef}
      className="mango-editor-hover-highlight"
      style={{
        position: "relative",
        width: "100%",
        minWidth: 0,
        border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
        borderRadius: 12,
        background: EDITOR_NEU_ACTIVE_SURFACE,
        boxShadow: "inset 3px 3px 10px rgba(174,174,192,0.12), inset -3px -3px 10px rgba(255,255,255,0.82)",
        overflow: "hidden",
      }}
    >
      {showIndentGuides && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
            boxSizing: "border-box",
            overflow: "hidden",
            padding: `${TEXT_BLOCK_PADDING_TOP}px ${TEXT_BLOCK_PADDING_RIGHT}px ${textBlockPaddingBottomPx}px ${TEXT_BLOCK_PADDING_LEFT}px`,
            fontSize: TEXT_BLOCK_FONT_SIZE,
            lineHeight: TEXT_BLOCK_LINE_HEIGHT,
            fontFamily: documentFontFamily,
            letterSpacing: 0,
            tabSize: EDITOR_TAB_TEXT.length,
          }}
        >
          <div style={{ position: "relative", transform: `translateY(-${documentScrollTop}px)` }}>
            {indentGuideSegments.map((segment) => (
              <div
                key={`${segment.depth}-${segment.lineStart}-${segment.lineEnd}`}
                style={{
                  position: "absolute",
                  top: segment.lineStart * documentLineHeightPx,
                  left: editorIndentGuideLeftForDepth(segment.depth, EDITOR_TAB_TEXT.length),
                  height: Math.max(documentLineHeightPx, (segment.lineEnd - segment.lineStart + 1) * documentLineHeightPx),
                  borderLeft: `1px solid ${indentGuideColor}`,
                  opacity: 0.9,
                }}
              />
            ))}
          </div>
        </div>
      )}
      {contentChangeHighlightRects.length > 0 && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          {contentChangeHighlightRects.map((rect) => (
            <div
              key={rect.key}
              style={{
                position: "absolute",
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                borderRadius: 6,
                background: rect.active ? "linear-gradient(135deg, rgba(254, 202, 202, 0.58), rgba(254, 249, 195, 0.50))" : "linear-gradient(135deg, rgba(254, 202, 202, 0.34), rgba(254, 249, 195, 0.30))",
                boxShadow: rect.active ? "0 0 0 1px rgba(248,113,113,0.44), 0 0 16px rgba(251,191,36,0.22)" : "none",
              }}
            />
          ))}
        </div>
      )}
      {textHighlightRects.length > 0 && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          {textHighlightRects.map((rect) => (
            <div
              key={rect.key}
              style={{
                position: "absolute",
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                borderRadius: 6,
                background: rect.active ? EDITOR_SOURCE_HIGHLIGHT_ACTIVE_BACKGROUND : EDITOR_SOURCE_HIGHLIGHT_BACKGROUND,
                boxShadow: rect.active ? EDITOR_SOURCE_HIGHLIGHT_OUTLINE : "none",
              }}
            />
          ))}
        </div>
      )}
      <div
        ref={editorRef}
        className="editor-document-scroll mango-editor-hover-highlight"
        data-node-text-block-id={blockID}
        role="textbox"
        aria-label="Node text block"
        aria-multiline="true"
        aria-readonly={!editable || undefined}
        tabIndex={editable ? undefined : -1}
        contentEditable={editable}
        suppressContentEditableWarning
        spellCheck
        onFocus={() => {
          if (editable) {
            activateFormattingController();
            onFocus();
          }
        }}
        onBeforeInput={(event) => {
          if (!editable) {
            event.preventDefault();
            return;
          }
          documentSurfaceHandlers.onBeforeInput(event);
        }}
        onPaste={(event) => {
          if (!editable) {
            event.preventDefault();
            return;
          }
          documentSurfaceHandlers.onPaste(event);
        }}
        onCopy={documentSurfaceHandlers.onCopy}
        onDrop={(event) => {
          if (!editable) {
            event.preventDefault();
            return;
          }
          documentSurfaceHandlers.onDrop(event);
        }}
        onInput={(event) => {
          if (!editable) {
            event.preventDefault();
            return;
          }
          documentSurfaceHandlers.onInput(event);
        }}
        onSelect={documentSurfaceHandlers.onSelect}
        onClick={documentSurfaceHandlers.onClick}
        onDoubleClick={documentSurfaceHandlers.onDoubleClick}
        onContextMenu={(event) => {
          if (!editable) {
            event.preventDefault();
            return;
          }
          documentSurfaceHandlers.onContextMenu(event);
        }}
        onPointerDown={(event) => {
          setSelectionDraft(null);
          if (!editable) {
            setImageDraft(null);
            editorRef.current?.blur();
            return;
          }
          const frame = findEditorImageFrame(event.currentTarget, event.target);
          const wrapper = wrapperRef.current;
          setImageDraft(frame && wrapper ? readImageDraftFromFrame(blockID, frame, wrapper) : null);
          if (event.button === 0 && !frame) selectionPointerDownRef.current = true;
          documentSurfaceHandlers.onPointerDown(event);
        }}
        onPointerMove={documentSurfaceHandlers.onPointerMove}
        onKeyUp={(event) => {
          if (!editable) return;
          documentSurfaceHandlers.onKeyUp(event);
          captureSelectionDraft();
        }}
        onBlur={handleBlur}
        onScroll={documentSurfaceHandlers.onScroll}
        onWheel={documentSurfaceHandlers.onWheel}
        onKeyDown={(event) => {
          if (!editable) {
            event.preventDefault();
            return;
          }
          documentSurfaceHandlers.onKeyDown(event);
        }}
        style={{
          position: "relative",
          zIndex: 2,
          display: "block",
          width: "100%",
          height,
          minHeight: TEXT_BLOCK_MIN_HEIGHT,
          maxHeight: TEXT_BLOCK_MAX_HEIGHT,
          resize: editable ? "vertical" : "none",
          border: 0,
          outline: "none",
          padding: `${TEXT_BLOCK_PADDING_TOP}px ${TEXT_BLOCK_PADDING_RIGHT}px ${textBlockPaddingBottomPx}px ${TEXT_BLOCK_PADDING_LEFT}px`,
          boxSizing: "border-box",
          color: surfaceText,
          background: "transparent",
          fontSize: TEXT_BLOCK_FONT_SIZE,
          lineHeight: TEXT_BLOCK_LINE_HEIGHT,
          fontFamily: documentFontFamily,
          tabSize: EDITOR_TAB_TEXT.length,
          letterSpacing: 0,
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
          overflowY: "auto",
          overflowX: "hidden",
          caretColor: editable ? surfaceText : "transparent",
          cursor: editable ? "text" : "default",
          ["--editor-document-scroll-accent" as string]: accent,
          ["--editor-document-scroll-track" as string]: scrollbarTrack,
        }}
      />
      {contentChangeLabels.length > 0 && (
        <div
          aria-label="Unseen text changes"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 6,
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          {contentChangeLabels.map((label) => {
            const active = activeContentChangeID === label.change.change_id;
            const addition = label.change.change_type === "addition";
            const color = addition ? "#047857" : "#be123c";
            const border = addition ? "rgba(16,185,129,0.36)" : "rgba(244,63,94,0.36)";
            const background = addition
              ? "linear-gradient(135deg, rgba(236,253,245,0.96), rgba(207,250,254,0.72))"
              : "linear-gradient(135deg, rgba(255,241,242,0.96), rgba(254,249,195,0.72))";
            return (
              <div
                key={label.change.change_id}
                onMouseEnter={() => setActiveContentChangeID(label.change.change_id)}
                onMouseLeave={() => setActiveContentChangeID((current) => current === label.change.change_id ? "" : current)}
                style={{
                  position: "absolute",
                  left: label.left,
                  top: label.top,
                  width: 118,
                  maxWidth: "min(118px, calc(100vw - 32px))",
                  transform: "translateX(-100%)",
                  display: "inline-grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 24,
                  border: `1px solid ${border}`,
                  borderRadius: 9,
                  background,
                  color,
                  padding: "3px 4px 3px 7px",
                  fontSize: 10,
                  fontWeight: 900,
                  letterSpacing: 0,
                  boxShadow: active ? "0 10px 24px rgba(15,23,42,0.16), 0 0 16px rgba(183,124,255,0.18), inset 1px 1px 0 rgba(255,255,255,0.86)" : "4px 4px 12px rgba(174,174,192,0.18), -4px -4px 12px rgba(255,255,255,0.78), inset 1px 1px 0 rgba(255,255,255,0.82)",
                  pointerEvents: "auto",
                }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {formatNodeContentChangeLabel(label.change)}
                </span>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onChangeSeen(label.change.change_id);
                  }}
                  style={{
                    minHeight: 18,
                    border: `1px solid ${border}`,
                    borderRadius: 7,
                    background: EDITOR_NEU_SURFACE,
                    color,
                    padding: "0 5px",
                    cursor: "pointer",
                    fontSize: 10,
                    fontWeight: 900,
                    boxShadow: "2px 2px 6px rgba(174,174,192,0.16), -2px -2px 6px rgba(255,255,255,0.78)",
                    letterSpacing: 0,
                  }}
                >
                  Seen
                </button>
                {active && (
                  <div
                    role="tooltip"
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "calc(100% + 5px)",
                      width: "min(320px, 78vw)",
                      maxHeight: 170,
                      overflowY: "auto",
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      border: `1px solid ${border}`,
                      borderRadius: 10,
                      background: EDITOR_NEU_PANEL_BACKGROUND,
                      color: surfaceText,
                      padding: 8,
                      boxShadow: EDITOR_NEU_PANEL_SHADOW,
                      fontSize: 11,
                      fontWeight: 700,
                      lineHeight: 1.35,
                      zIndex: 7,
                    }}
                  >
                    {label.change.text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {editable && documentMentionMenu}
      {editable && selectionDraft && (
        <button
          type="button"
          title="Comment on selection"
          aria-label="Comment on selection"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onSelectionChatRequest(selectionDraft);
            setSelectionDraft(null);
            window.getSelection()?.removeAllRanges();
          }}
          style={{
            position: "absolute",
            left: selectionDraft.x,
            top: selectionDraft.y,
            zIndex: 5,
            width: 28,
            height: 28,
            borderRadius: 8,
            border: "1px solid transparent",
            background: `${EDITOR_NEU_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
            color: accent,
            display: "grid",
            placeItems: "center",
            padding: 0,
            cursor: "pointer",
            boxShadow: EDITOR_NEU_SHADOW,
          }}
        >
          <ChatIcon color={accent} />
        </button>
      )}
      {editable && imageDraft && (
        <div
          role="toolbar"
          aria-label="Image actions"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          style={{
            position: "absolute",
            left: imageDraft.x,
            top: imageDraft.y,
            zIndex: 5,
            display: "grid",
            gridTemplateColumns: "28px 28px",
            gap: 5,
            padding: 4,
            border: "1px solid transparent",
            borderRadius: 10,
            background: `${EDITOR_NEU_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
            boxShadow: EDITOR_NEU_SHADOW,
          }}
        >
          <button
            type="button"
            title="Comment on image"
            aria-label="Comment on image"
            onClick={(event) => {
              event.stopPropagation();
              onImageChatRequest(imageDraft);
              setImageDraft(null);
            }}
            style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", padding: 0, cursor: "pointer", boxShadow: "2px 2px 6px rgba(174,174,192,0.16), -2px -2px 6px rgba(255,255,255,0.78)" }}
          >
            <ChatIcon color={accent} />
          </button>
          <button
            type="button"
            title="Create node from image"
            aria-label="Create node from image"
            onClick={(event) => {
              event.stopPropagation();
              onImageNodeRequest(imageDraft);
              setImageDraft(null);
            }}
            style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", padding: 0, cursor: "pointer", boxShadow: "2px 2px 6px rgba(174,174,192,0.16), -2px -2px 6px rgba(255,255,255,0.78)" }}
          >
            <PlusIcon color={accent} />
          </button>
        </div>
      )}
    </div>
  );
};

type ChatPaneProps = {
  blockID: string;
  editable: boolean;
  apiBase?: string;
  companyID?: string;
  messages: EditorTextBlockChatMessage[];
  emailPane?: React.ReactNode;
  activeTab?: "chat" | "email";
  selectionAnchor?: TextBlockSelectionAnchor;
  draft: string;
  companyUsers: MentionableCompanyUser[];
  draftAttachments: EditorChatAttachment[];
  replyTargetID: string;
  heightStorageKey: string;
  active: boolean;
  currentUserID: string;
  activeMessageID: string;
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  ruleColor: string;
  onFocus: () => void;
  onActiveTabChange?: (tab: "chat" | "email") => void;
  onDraftChange: (draft: string) => void;
  onActivateMessage: (messageID: string) => void;
  onNavigateToMessage: (messageID: string) => void;
  onReply: (messageID: string) => void;
  onDeleteMessage: (messageID: string) => void;
  onClearReply: () => void;
  onClearSelectionAnchor: () => void;
  onAttachFiles: (files: FileList | File[]) => void;
  onRemoveDraftAttachment: (attachmentID: string) => void;
  onSubmit: () => void;
};

const CHAT_COMPOSER_MIN_HEIGHT = 34;
const CHAT_COMPOSER_PANE_HEIGHT_RESERVE = 116;

export const ChatPane: React.FC<ChatPaneProps> = ({
  blockID,
  editable,
  apiBase,
  companyID,
  messages,
  emailPane,
  activeTab = "chat",
  selectionAnchor,
  draft,
  companyUsers,
  draftAttachments,
  replyTargetID,
  heightStorageKey,
  active,
  currentUserID,
  activeMessageID,
  accent,
  surfaceText,
  panelBackground,
  strokeColor,
  ruleColor,
  onFocus,
  onActiveTabChange,
  onDraftChange,
  onActivateMessage,
  onNavigateToMessage,
  onReply,
  onDeleteMessage,
  onClearReply,
  onClearSelectionAnchor,
  onAttachFiles,
  onRemoveDraftAttachment,
  onSubmit,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const mentionCloseTimerRef = useRef<number | null>(null);
  const threads = useMemo(() => buildChatThreads(messages), [messages]);
  const replyTarget = replyTargetID ? messages.find((message) => message.id === replyTargetID) : undefined;
  const canSubmit = editable && (draft.trim().length > 0 || draftAttachments.length > 0);
  const [height, setHeight] = useState(() => readStoredChatPaneHeight(heightStorageKey));
  const composerMaxHeight = Math.max(CHAT_COMPOSER_MIN_HEIGHT, height - CHAT_COMPOSER_PANE_HEIGHT_RESERVE);
  const [composerSizing, setComposerSizing] = useState({ height: CHAT_COMPOSER_MIN_HEIGHT, scrolls: false });
  const [previewAttachment, setPreviewAttachment] = useState<EditorChatAttachment | null>(null);
  const [collapsedThreadIDs, setCollapsedThreadIDs] = useState<Set<string>>(() => new Set());
  const [activeMentionDraft, setActiveMentionDraft] = useState<ActiveMentionDraft | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const mentionOptions = useMemo(() => {
    if (!activeMentionDraft) return [];
    return buildMentionOptions(companyUsers, activeMentionDraft.query, 8);
  }, [activeMentionDraft, companyUsers]);
  const mentionMenuOpen = editable && activeMentionDraft !== null && mentionOptions.length > 0;
  const hasEmailPane = Boolean(emailPane);
  const showingEmail = hasEmailPane && activeTab === "email";

  const resizeComposer = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = `${CHAT_COMPOSER_MIN_HEIGHT}px`;
    const measuredHeight = Math.ceil(textarea.scrollHeight);
    const nextHeight = Math.max(CHAT_COMPOSER_MIN_HEIGHT, Math.min(measuredHeight, composerMaxHeight));
    const nextScrolls = measuredHeight > composerMaxHeight + 1;
    textarea.style.height = `${nextHeight}px`;
    setComposerSizing((current) => (
      current.height === nextHeight && current.scrolls === nextScrolls
        ? current
        : { height: nextHeight, scrolls: nextScrolls }
    ));
  }, [composerMaxHeight]);

  useEffect(() => {
    setHeight(readStoredChatPaneHeight(heightStorageKey));
  }, [heightStorageKey]);

  useEffect(() => () => {
    if (mentionCloseTimerRef.current !== null) window.clearTimeout(mentionCloseTimerRef.current);
  }, []);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [activeMentionDraft?.start, activeMentionDraft?.query]);

  useEffect(() => {
    setActiveMentionIndex((current) => Math.min(current, Math.max(0, mentionOptions.length - 1)));
  }, [mentionOptions.length]);

  useLayoutEffect(() => {
    if (showingEmail) return;
    resizeComposer();
  }, [draft, resizeComposer, showingEmail]);

  useLayoutEffect(() => {
    if (showingEmail) return undefined;
    const textarea = textareaRef.current;
    const composer = textarea?.parentElement;
    if (!textarea || !composer || typeof ResizeObserver === "undefined") return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        resizeComposer();
      });
    });
    observer.observe(composer);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [resizeComposer, showingEmail]);

  useEffect(() => {
    const visibleMessageIDs = new Set(messages.map((message) => message.id));
    setCollapsedThreadIDs((previous) => {
      const next = new Set(Array.from(previous).filter((messageID) => visibleMessageIDs.has(messageID)));
      return next.size === previous.size ? previous : next;
    });
  }, [messages]);

  useEffect(() => {
    if (!editable) return;
    if (showingEmail) return;
    if (!replyTargetID) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editable, replyTargetID, showingEmail]);

  useEffect(() => {
    if (!editable) return;
    if (showingEmail) return;
    if (!active || replyTargetID) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [active, editable, replyTargetID, selectionAnchor?.quote, showingEmail]);

  const focusComposer = () => {
    onFocus();
    if (!editable) return;
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const refreshMentionDraft = (nextDraft = draft) => {
    const textarea = textareaRef.current;
    setActiveMentionDraft(readActiveMentionDraft(nextDraft, textarea?.selectionStart ?? null));
  };

  const replaceMentionDraft = (mention: ActiveMentionDraft, user: MentionableCompanyUser) => {
    if (!editable) return;
    const insert = `${mention.trigger}${mentionUserDisplayName(user)} `;
    const nextDraft = `${draft.slice(0, mention.start)}${insert}${draft.slice(mention.end)}`;
    onDraftChange(nextDraft);
    setActiveMentionDraft(null);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const nextCaret = mention.start + insert.length;
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleReply = (messageID: string) => {
    if (!editable) return;
    onActivateMessage(messageID);
    onReply(messageID);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const toggleThreadCollapse = (messageID: string) => {
    setCollapsedThreadIDs((previous) => {
      const next = new Set(previous);
      if (next.has(messageID)) next.delete(messageID);
      else next.add(messageID);
      return next;
    });
  };

  const attachTransferredImages = (dataTransfer: DataTransfer): boolean => {
    if (!editable) return false;
    const files = imageFilesFromTransfer(dataTransfer);
    if (files.length === 0) return false;
    onAttachFiles(files);
    return true;
  };

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = height;
    let nextHeight = startHeight;
    const onPointerMove = (pointerEvent: PointerEvent) => {
      nextHeight = clampChatPaneHeight(startHeight + pointerEvent.clientY - startY);
      setHeight(nextHeight);
    };
    const onPointerUp = () => {
      storeChatPaneHeight(heightStorageKey, nextHeight);
      window.removeEventListener("pointermove", onPointerMove);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  };

  return (
    <>
      <div
        data-node-chat-block-id={blockID}
        onMouseDown={(event) => {
          event.stopPropagation();
          if (!showingEmail) onFocus();
        }}
        style={{
          minWidth: 0,
          height,
          marginTop: 0,
          display: "grid",
          gridTemplateRows: showingEmail ? "auto minmax(0, 1fr) 7px" : "auto minmax(0, 1fr) auto 7px",
          border: active ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
          borderRadius: 14,
          background: active ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : panelBackground,
          overflow: "hidden",
          opacity: active || messages.length > 0 ? 1 : 0.72,
          boxShadow: active ? "8px 8px 20px rgba(174,174,192,0.26), -7px -7px 16px rgba(255,255,255,0.92), 0 0 18px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.88)" : EDITOR_NEU_SHADOW,
        }}
      >
        <div style={{ minHeight: 34, display: "flex", alignItems: "center", gap: 6, borderBottom: `1px solid ${ruleColor}`, padding: "5px 7px", color: surfaceText, fontSize: 11, fontWeight: 800, background: "linear-gradient(90deg, rgba(255,241,242,0.60), rgba(236,253,245,0.42) 52%, rgba(239,246,255,0.62))" }}>
          {hasEmailPane ? (
            <>
              <button
                type="button"
                onClick={() => {
                  onActiveTabChange?.("chat");
                  onFocus();
                }}
                style={{
                  minWidth: 0,
                  minHeight: 26,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: activeTab === "chat" ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                  borderRadius: 9,
                  background: activeTab === "chat" ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
                  color: activeTab === "chat" ? accent : surfaceText,
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: 11,
                  fontWeight: 900,
                  letterSpacing: 0,
                  padding: "3px 9px",
                  boxShadow: activeTab === "chat" ? "0 8px 18px rgba(15,23,42,0.10), 0 0 12px rgba(183,124,255,0.14), inset 1px 1px 0 rgba(255,255,255,0.86)" : "2px 2px 7px rgba(174,174,192,0.14), -2px -2px 7px rgba(255,255,255,0.80)",
                }}
              >
                <ChatIcon color={activeTab === "chat" ? accent : "rgba(100,116,139,0.85)"} />
                <span>Chat</span>
              </button>
              <button
                type="button"
                onClick={() => onActiveTabChange?.("email")}
                style={{
                  minWidth: 0,
                  minHeight: 26,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: activeTab === "email" ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                  borderRadius: 9,
                  background: activeTab === "email" ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
                  color: activeTab === "email" ? accent : surfaceText,
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: 11,
                  fontWeight: 900,
                  letterSpacing: 0,
                  padding: "3px 9px",
                  boxShadow: activeTab === "email" ? "0 8px 18px rgba(15,23,42,0.10), 0 0 12px rgba(183,124,255,0.14), inset 1px 1px 0 rgba(255,255,255,0.86)" : "2px 2px 7px rgba(174,174,192,0.14), -2px -2px 7px rgba(255,255,255,0.80)",
                }}
              >
                <MailIcon color={activeTab === "email" ? accent : "rgba(100,116,139,0.85)"} />
                <span>Email</span>
              </button>
            </>
          ) : (
            <>
              <ChatIcon color={active ? accent : "rgba(100,116,139,0.85)"} />
              <span>Chat</span>
            </>
          )}
        </div>
        {showingEmail ? (
          <div style={{ minHeight: 0, overflow: "hidden", display: "grid" }}>
            {emailPane}
          </div>
        ) : (
          <>
            <div ref={messageListRef} className="editor-document-scroll" style={{ minHeight: 0, display: "grid", alignContent: "start", gap: 8, overflowY: "auto", overflowX: "hidden", padding: "9px 8px", ["--editor-document-scroll-accent" as string]: accent, ["--editor-document-scroll-track" as string]: "transparent" }}>
              {threads.map((thread) => (
                <ChatThreadItem
                  key={thread.message.id}
                  node={thread}
                  depth={0}
                  isLastSibling={false}
                  apiBase={apiBase}
                  companyID={companyID}
                  currentUserID={currentUserID}
                  editable={editable}
                  activeMessageID={activeMessageID}
                  companyUsers={companyUsers}
                  accent={accent}
                  surfaceText={surfaceText}
                  ruleColor={ruleColor}
                  collapsedThreadIDs={collapsedThreadIDs}
                  onToggleCollapse={toggleThreadCollapse}
                  onActivate={onActivateMessage}
                  onNavigate={onNavigateToMessage}
                  onReply={handleReply}
                  onDelete={onDeleteMessage}
                  onPreviewImage={setPreviewAttachment}
                />
              ))}
            </div>
            <div style={{ display: "grid", gap: 6, padding: 8, borderTop: `1px solid ${ruleColor}` }}>
          {selectionAnchor && active && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 22px", alignItems: "start", gap: 6, border: "1px solid rgba(92,238,255,0.34)", borderLeft: `3px solid ${accent}`, borderRadius: 9, background: "linear-gradient(135deg, rgba(230,252,255,0.58), rgba(247,239,255,0.58))", color: surfaceText, padding: "6px 6px 6px 7px", fontSize: 10, lineHeight: 1.35, fontWeight: 800, overflowWrap: "anywhere", maxHeight: 72, overflowY: "auto", boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.82)" }}>
              <span style={{ minWidth: 0 }}>{selectionAnchor.quote}</span>
              <button
                type="button"
                aria-label="Clear selected text"
                title="Clear selected text"
                onClick={onClearSelectionAnchor}
                style={{ width: 22, height: 22, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 6, background: "#ffffff", color: surfaceText, cursor: "pointer", fontSize: 14, fontWeight: 900, lineHeight: 1, padding: 0 }}
              >
                x
              </button>
            </div>
          )}
          {draftAttachments.length > 0 && (
            <DraftAttachmentList
              attachments={draftAttachments}
              apiBase={apiBase}
              companyID={companyID}
              surfaceText={surfaceText}
              strokeColor={strokeColor}
              onRemove={onRemoveDraftAttachment}
              onPreviewImage={setPreviewAttachment}
            />
          )}
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "32px minmax(0, 1fr) 32px", alignItems: "end", gap: 6 }}>
            {mentionMenuOpen && activeMentionDraft && (
              <div
                role="listbox"
                aria-label="Mention users"
                style={{
                  position: "absolute",
                  left: 38,
                  right: 38,
                  bottom: "calc(100% + 6px)",
                  zIndex: 20,
                  display: "grid",
                  gap: 2,
                  maxHeight: 206,
                  overflowY: "auto",
                  border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                  borderRadius: 12,
                  background: EDITOR_NEU_PANEL_BACKGROUND,
                  boxShadow: EDITOR_NEU_PANEL_SHADOW,
                  padding: 4,
                }}
              >
                {mentionOptions.map((user, index) => {
                  const selected = index === activeMentionIndex;
                  const label = mentionUserOptionLabel(user);
                  const name = mentionUserDisplayName(user);
                  const email = (user.email ?? "").trim();
                  return (
                    <button
                      key={user.user_id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      title={label}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        replaceMentionDraft(activeMentionDraft, user);
                      }}
                      style={{
                        width: "100%",
                        minHeight: 34,
                        display: "grid",
                        gridTemplateColumns: "24px minmax(0, 1fr)",
                        alignItems: "center",
                        gap: 8,
                        border: "1px solid transparent",
                        borderRadius: 10,
                        background: selected ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : "transparent",
                        color: surfaceText,
                        cursor: "pointer",
                        padding: "5px 8px",
                        textAlign: "left",
                        font: "inherit",
                        boxShadow: selected ? "0 8px 20px rgba(15,23,42,0.10), 0 0 12px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.86)" : undefined,
                      }}
                    >
                      <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", background: avatarBackgroundForName(name), color: "#ffffff", fontSize: 10, fontWeight: 900 }}>
                        {initialsForName(name)}
                      </span>
                      <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 800 }}>{name}</span>
                        {email && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontWeight: 650, color: "rgba(100,116,139,0.86)" }}>{email}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              aria-label="Add attachment"
              title="Add attachment"
              disabled={!editable}
              onClick={() => {
                focusComposer();
                fileInputRef.current?.click();
              }}
              style={{ width: 32, height: 32, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 9, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: editable ? "pointer" : "default", opacity: editable ? 1 : 0.46, boxShadow: EDITOR_NEU_SHADOW }}
            >
              <PlusIcon color={accent} />
            </button>
            <textarea
              ref={textareaRef}
              value={draft}
              rows={1}
              disabled={!editable}
              readOnly={!editable}
              placeholder={replyTarget ? `↖ Replying to ${replyTarget.authorName}` : ""}
              onFocus={(event) => {
                if (!editable) return;
                onFocus();
                setActiveMentionDraft(readActiveMentionDraft(draft, event.currentTarget.selectionStart));
              }}
              onClick={() => { if (editable) refreshMentionDraft(); }}
              onKeyUp={() => { if (editable) refreshMentionDraft(); }}
              onBlur={() => {
                if (mentionCloseTimerRef.current !== null) window.clearTimeout(mentionCloseTimerRef.current);
                mentionCloseTimerRef.current = window.setTimeout(() => {
                  mentionCloseTimerRef.current = null;
                  setActiveMentionDraft(null);
                }, 120);
              }}
              onPaste={(event) => {
                if (!editable) {
                  event.preventDefault();
                  return;
                }
                if (attachTransferredImages(event.clipboardData)) event.preventDefault();
              }}
              onDragOver={(event) => {
                if (!editable) return;
                if (event.dataTransfer.types.includes("Files")) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!editable) {
                  event.preventDefault();
                  return;
                }
                if (attachTransferredImages(event.dataTransfer)) event.preventDefault();
              }}
              onChange={(event) => {
                if (!editable) return;
                const nextDraft = event.currentTarget.value;
                onDraftChange(nextDraft);
                setActiveMentionDraft(readActiveMentionDraft(nextDraft, event.currentTarget.selectionStart));
              }}
              onKeyDown={(event) => {
                if (!editable) {
                  event.preventDefault();
                  return;
                }
                if (mentionMenuOpen && activeMentionDraft) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveMentionIndex((current) => (current + 1) % mentionOptions.length);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveMentionIndex((current) => (current - 1 + mentionOptions.length) % mentionOptions.length);
                    return;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    replaceMentionDraft(activeMentionDraft, mentionOptions[activeMentionIndex] ?? mentionOptions[0]);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setActiveMentionDraft(null);
                    return;
                  }
                }
                if (event.key === "Escape" && replyTarget) {
                  event.preventDefault();
                  onClearReply();
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSubmit();
                }
              }}
              style={{ width: "100%", height: composerSizing.height, minHeight: CHAT_COMPOSER_MIN_HEIGHT, maxHeight: composerMaxHeight, resize: "none", overflowY: composerSizing.scrolls ? "auto" : "hidden", boxSizing: "border-box", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, outline: "none", padding: "7px 8px", color: surfaceText, background: EDITOR_NEU_ACTIVE_SURFACE, fontSize: 12, lineHeight: 1.35, letterSpacing: 0, caretColor: editable ? surfaceText : "transparent", cursor: editable ? "text" : "default", boxShadow: "inset 2px 2px 6px rgba(174,174,192,0.18), inset -2px -2px 6px rgba(255,255,255,0.82)" }}
            />
            <button
              type="button"
              aria-label="Send"
              title="Send"
              disabled={!canSubmit}
              onClick={onSubmit}
              style={{ width: 32, height: 32, border: canSubmit && active ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: canSubmit && active ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: accent, borderRadius: 9, display: "grid", placeItems: "center", cursor: canSubmit ? "pointer" : "default", opacity: canSubmit ? 1 : 0.44, boxShadow: EDITOR_NEU_SHADOW }}
            >
              <ArrowRightIcon color={accent} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              tabIndex={-1}
              disabled={!editable}
              style={{ display: "none" }}
              onChange={(event) => {
                if (event.currentTarget.files) onAttachFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
            </div>
          </>
        )}
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Resize chat"
          onPointerDown={beginResize}
          style={{ cursor: editable ? "ns-resize" : "default", borderTop: `1px solid ${ruleColor}`, background: active ? "rgba(100,116,139,0.10)" : "rgba(100,116,139,0.08)" }}
        />
      </div>
      {previewAttachment && (
        <ImageAttachmentPreviewModal
          attachment={previewAttachment}
          apiBase={apiBase}
          companyID={companyID}
          surfaceText={surfaceText}
          strokeColor={strokeColor}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </>
  );
};

type ChatThreadItemProps = {
  node: ChatThreadNode;
  depth: number;
  isLastSibling: boolean;
  apiBase?: string;
  companyID?: string;
  currentUserID: string;
  editable: boolean;
  activeMessageID: string;
  companyUsers: MentionableCompanyUser[];
  accent: string;
  surfaceText: string;
  ruleColor: string;
  collapsedThreadIDs: Set<string>;
  onToggleCollapse: (messageID: string) => void;
  onActivate: (messageID: string) => void;
  onNavigate: (messageID: string) => void;
  onReply: (messageID: string) => void;
  onDelete: (messageID: string) => void;
  onPreviewImage: (attachment: EditorChatAttachment) => void;
};

const MentionHighlightedText: React.FC<{ text: string; users: MentionableCompanyUser[]; color: string }> = ({ text, users, color }) => {
  const segments = useMemo(() => splitTextByMentions(text, users), [text, users]);
  return (
    <div style={{ color, fontSize: 12, lineHeight: 1.35, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
      {segments.map((segment, index) => segment.mention ? (
        <span
          key={`${segment.text}:${index}`}
          title={segment.user ? mentionUserOptionLabel(segment.user) : segment.text}
          style={{ background: EDITOR_MENTION_BACKGROUND, color: EDITOR_MENTION_COLOR, border: "1px solid rgba(183,124,255,0.34)", borderRadius: 6, padding: "0 4px", fontWeight: 850, boxDecorationBreak: "clone", boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86), 0 2px 7px rgba(15,23,42,0.08)" }}
        >
          {segment.text}
        </span>
      ) : (
        <React.Fragment key={`${segment.text}:${index}`}>{segment.text}</React.Fragment>
      ))}
    </div>
  );
};

const ChatThreadItem: React.FC<ChatThreadItemProps> = ({ node, depth, isLastSibling, apiBase, companyID, currentUserID, editable, activeMessageID, companyUsers, accent, surfaceText, ruleColor, collapsedThreadIDs, onToggleCollapse, onActivate, onNavigate, onReply, onDelete, onPreviewImage }) => {
  const { message, children } = node;
  const hasChildren = children.length > 0;
  const collapsed = collapsedThreadIDs.has(message.id);
  const hiddenReplyCount = collapsed ? countChatThreadDescendants(node) : 0;
  const isActive = activeMessageID === message.id;
  const canDelete = editable && canDeleteEditorTextBlockChatMessage(message, currentUserID);
  const authorAccent = userAccentForName(message.authorName || message.authorID);
  const guideColor = "rgba(100,116,139,0.24)";
  const guideStyle: React.CSSProperties = isLastSibling
    ? { position: "absolute", top: -10, left: 13, width: 1, height: 23, background: guideColor }
    : { position: "absolute", top: -10, bottom: -8, left: 13, width: 1, background: guideColor };
  return (
    <div
      data-node-chat-message-id={message.id}
      onClick={(event) => {
        event.stopPropagation();
        onActivate(message.id);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onNavigate(message.id);
      }}
      style={{
        minWidth: 0,
        display: "grid",
        gridTemplateColumns: "28px minmax(0, 1fr)",
        columnGap: 7,
        alignItems: "start",
        border: "1px solid transparent",
        borderRadius: 10,
        background: isActive ? "linear-gradient(135deg, rgba(255,255,255,0.88), rgba(230,252,255,0.48) 48%, rgba(247,239,255,0.54))" : "transparent",
        boxShadow: isActive ? `0 8px 20px rgba(15,23,42,0.10), 0 0 14px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.86)` : "none",
        padding: "4px 4px 4px 0",
        cursor: "pointer",
      }}
    >
      <div style={{ position: "relative", gridRow: hasChildren && !collapsed ? "1 / span 2" : undefined, alignSelf: "stretch", display: "grid", justifyItems: "center", minHeight: 28 }}>
        {depth > 0 && <div aria-hidden="true" style={guideStyle} />}
        {hasChildren && (
          <button
            type="button"
            aria-label={collapsed ? "Expand replies" : "Collapse replies"}
            title={collapsed ? "Expand replies" : "Collapse replies"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse(message.id);
            }}
            style={{
              position: "absolute",
              zIndex: 2,
              top: -5,
              left: -2,
              width: 14,
              height: 14,
              border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
              borderRadius: 999,
              background: EDITOR_NEU_SURFACE,
              color: "rgba(15,23,42,0.72)",
              display: "grid",
              placeItems: "center",
              padding: 0,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            {collapsed ? "+" : "-"}
          </button>
        )}
        <div style={{ position: "relative", zIndex: 1, width: 26, height: 26, borderRadius: 999, border: "1px solid rgba(255,255,255,0.82)", background: avatarBackgroundForName(message.authorName || message.authorID), color: "#ffffff", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 900, letterSpacing: 0, boxShadow: "3px 3px 8px rgba(174,174,192,0.22), -3px -3px 8px rgba(255,255,255,0.78)" }}>
          {initialsForName(message.authorName || message.authorID)}
        </div>
      </div>
      <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 6, minWidth: 0, color: surfaceText, fontSize: 10, fontWeight: 800 }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: authorAccent, fontWeight: 900 }}>{message.authorName}</span>
          <span style={{ opacity: 0.58, flex: "0 0 auto" }}>{formatTimestamp(message.createdTimestamp)}</span>
        </div>
        {message.message && <MentionHighlightedText text={message.message} users={companyUsers} color={surfaceText} />}
        {message.attachments.length > 0 && <ChatAttachmentList attachments={message.attachments} apiBase={apiBase} companyID={companyID} surfaceText={surfaceText} strokeColor={ruleColor} onPreviewImage={onPreviewImage} />}
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {editable && (
            <button type="button" onClick={(event) => { event.stopPropagation(); onReply(message.id); }} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent", color: accent, cursor: "pointer", fontSize: 10, fontWeight: 800, letterSpacing: 0, padding: "2px 0" }}>
              <ChatIcon color={accent} />
              Reply
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              aria-label="Delete message"
              title="Delete message"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(message.id);
              }}
              style={{ border: "none", background: "transparent", color: "rgba(51,65,85,0.82)", cursor: "pointer", fontSize: 10, fontWeight: 800, letterSpacing: 0, padding: "2px 0" }}
            >
              Delete
            </button>
          )}
          {hiddenReplyCount > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleCollapse(message.id);
              }}
              style={{ border: "none", background: "transparent", color: "rgba(15,23,42,0.54)", cursor: "pointer", fontSize: 10, fontWeight: 800, letterSpacing: 0, padding: "2px 0" }}
            >
              {hiddenReplyCount} {hiddenReplyCount === 1 ? "reply" : "replies"} hidden
            </button>
          )}
        </div>
      </div>
      {hasChildren && !collapsed && (
        <div style={{ gridColumn: "2", minWidth: 0, marginTop: 4, display: "grid", gap: 8 }}>
          {children.map((child, childIndex) => (
            <ChatThreadItem
              key={child.message.id}
              node={child}
              depth={depth + 1}
              isLastSibling={childIndex === children.length - 1}
              apiBase={apiBase}
              companyID={companyID}
              currentUserID={currentUserID}
              editable={editable}
              activeMessageID={activeMessageID}
              companyUsers={companyUsers}
              accent={accent}
              surfaceText={surfaceText}
              ruleColor={ruleColor}
              collapsedThreadIDs={collapsedThreadIDs}
              onToggleCollapse={onToggleCollapse}
              onActivate={onActivate}
              onNavigate={onNavigate}
              onReply={onReply}
              onDelete={onDelete}
              onPreviewImage={onPreviewImage}
            />
          ))}
        </div>
      )}
    </div>
  );
};

type ChatAttachmentListProps = {
  attachments: EditorChatAttachment[];
  apiBase?: string;
  companyID?: string;
  surfaceText: string;
  strokeColor: string;
  onPreviewImage: (attachment: EditorChatAttachment) => void;
};

const ChatAttachmentList: React.FC<ChatAttachmentListProps> = ({ attachments, apiBase, companyID, surfaceText, strokeColor, onPreviewImage }) => {
  const [selectedAttachmentID, setSelectedAttachmentID] = useState("");

  useEffect(() => {
    if (selectedAttachmentID && !attachments.some((attachment) => attachment.id === selectedAttachmentID)) {
      setSelectedAttachmentID("");
    }
  }, [attachments, selectedAttachmentID]);

  const selectAttachment = (event: React.MouseEvent, attachmentID: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedAttachmentID(attachmentID);
  };

  const openAttachment = (event: React.MouseEvent, attachment: EditorChatAttachment) => {
    selectAttachment(event, attachment.id);
    openChatAttachment(attachment, onPreviewImage, apiBase, companyID);
  };

  return (
    <div style={{ minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5 }}>
      {attachments.map((attachment) => {
        const selected = selectedAttachmentID === attachment.id;
        const style: React.CSSProperties = {
          maxWidth: "100%",
          minHeight: 30,
          display: "inline-grid",
          gridTemplateColumns: "24px minmax(0, 1fr) auto",
          alignItems: "center",
          gap: 6,
          border: selected ? "1px solid transparent" : `1px solid ${strokeColor}`,
          borderRadius: 6,
          background: selected ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : "#ffffff",
          color: surfaceText,
          padding: "3px 6px",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 0,
          textDecoration: "none",
          cursor: "pointer",
          boxShadow: selected ? "0 7px 18px rgba(15,23,42,0.10), 0 0 0 2px rgba(92,238,255,0.14), inset 1px 1px 0 rgba(255,255,255,0.86)" : "none",
        };
        return (
          <button
            key={attachment.id}
            type="button"
            data-mango-copyable-image={isImageAttachment(attachment) ? "true" : undefined}
            aria-pressed={selected}
            title={isImageAttachment(attachment) ? "Double-click to preview" : attachment.dataURL || canLoadAttachmentContent(attachment, apiBase, companyID) ? "Double-click to download" : attachment.name}
            onCopy={(event) => {
              if (!copyImageAttachmentToClipboard(attachment, event.clipboardData)) return;
              event.preventDefault();
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              if (!isCopyShortcut(event) || !copyImageAttachmentToClipboard(attachment)) return;
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => selectAttachment(event, attachment.id)}
            onDoubleClick={(event) => openAttachment(event, attachment)}
            style={style}
          >
            <AttachmentThumb attachment={attachment} apiBase={apiBase} companyID={companyID} />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
            <span style={{ flex: "0 0 auto", opacity: 0.58 }}>{formatFileSize(attachment.size)}</span>
          </button>
        );
      })}
    </div>
  );
};

type DraftAttachmentListProps = {
  attachments: EditorChatAttachment[];
  apiBase?: string;
  companyID?: string;
  surfaceText: string;
  strokeColor: string;
  onRemove: (attachmentID: string) => void;
  onPreviewImage: (attachment: EditorChatAttachment) => void;
};

const DraftAttachmentList: React.FC<DraftAttachmentListProps> = ({ attachments, apiBase, companyID, surfaceText, strokeColor, onRemove, onPreviewImage }) => {
  const [selectedAttachmentID, setSelectedAttachmentID] = useState("");

  useEffect(() => {
    if (selectedAttachmentID && !attachments.some((attachment) => attachment.id === selectedAttachmentID)) {
      setSelectedAttachmentID("");
    }
  }, [attachments, selectedAttachmentID]);

  const selectAttachment = (event: React.MouseEvent | React.KeyboardEvent, attachmentID: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedAttachmentID(attachmentID);
  };

  const openAttachment = (event: React.MouseEvent, attachment: EditorChatAttachment) => {
    selectAttachment(event, attachment.id);
    openChatAttachment(attachment, onPreviewImage, apiBase, companyID);
  };

  return (
    <div style={{ minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5 }}>
      {attachments.map((attachment) => {
        const selected = selectedAttachmentID === attachment.id;
        return (
          <span
            key={attachment.id}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            title={isImageAttachment(attachment) ? "Double-click to preview" : attachment.dataURL || canLoadAttachmentContent(attachment, apiBase, companyID) ? "Double-click to download" : attachment.name}
            onClick={(event) => selectAttachment(event, attachment.id)}
            onDoubleClick={(event) => openAttachment(event, attachment)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              selectAttachment(event, attachment.id);
            }}
            style={{
              maxWidth: "100%",
              minHeight: 30,
              display: "inline-grid",
              gridTemplateColumns: "24px minmax(0, 1fr) auto 18px",
              alignItems: "center",
              gap: 5,
              border: selected ? "1px solid transparent" : `1px solid ${strokeColor}`,
              borderRadius: 6,
              background: selected ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : "#ffffff",
              color: surfaceText,
              padding: "3px 4px 3px 5px",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 0,
              cursor: "pointer",
              boxShadow: selected ? "0 7px 18px rgba(15,23,42,0.10), 0 0 0 2px rgba(92,238,255,0.14), inset 1px 1px 0 rgba(255,255,255,0.86)" : "none",
            }}
          >
            <button
              type="button"
              data-mango-copyable-image={isImageAttachment(attachment) ? "true" : undefined}
              aria-label={`Select ${attachment.name}`}
              onCopy={(event) => {
                if (!copyImageAttachmentToClipboard(attachment, event.clipboardData)) return;
                event.preventDefault();
                event.stopPropagation();
              }}
              onKeyDown={(event) => {
                if (!isCopyShortcut(event) || !copyImageAttachmentToClipboard(attachment)) return;
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => selectAttachment(event, attachment.id)}
              onDoubleClick={(event) => openAttachment(event, attachment)}
              style={{ width: 24, height: 24, border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
            >
              <AttachmentThumb attachment={attachment} apiBase={apiBase} companyID={companyID} />
            </button>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
            <span style={{ flex: "0 0 auto", opacity: 0.58 }}>{formatFileSize(attachment.size)}</span>
            <button
              type="button"
              aria-label={`Remove ${attachment.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(attachment.id);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              style={{ width: 18, height: 18, border: "none", borderRadius: 4, background: "transparent", color: surfaceText, cursor: "pointer", fontSize: 12, fontWeight: 800, lineHeight: 1 }}
            >
              x
            </button>
          </span>
        );
      })}
    </div>
  );
};

const AttachmentThumb: React.FC<{ attachment: EditorChatAttachment; apiBase?: string; companyID?: string }> = ({ attachment, apiBase, companyID }) => {
  const image = isImageAttachment(attachment);
  const src = useAttachmentObjectURL(attachment, apiBase, companyID, "thumbnail", image);
  if (image) {
    if (src) {
      return <img alt="" src={src} style={{ width: 24, height: 24, borderRadius: 4, objectFit: "cover", display: "block", border: "1px solid rgba(17,17,17,0.12)" }} />;
    }
    return (
      <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 4, border: "1px solid rgba(17,17,17,0.14)", background: "rgba(92,238,255,0.10)", display: "grid", placeItems: "center", color: "rgba(15,23,42,0.78)", fontSize: 8, fontWeight: 900 }}>
        IMG
      </span>
    );
  }
  return (
    <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 4, border: "1px solid rgba(17,17,17,0.14)", background: "rgba(100,116,139,0.10)", display: "grid", placeItems: "center", color: "rgba(15,23,42,0.78)", fontSize: 8, fontWeight: 900 }}>
      FILE
    </span>
  );
};

type ImageAttachmentPreviewModalProps = {
  attachment: EditorChatAttachment;
  apiBase?: string;
  companyID?: string;
  surfaceText: string;
  strokeColor: string;
  onClose: () => void;
};

const ImageAttachmentPreviewModal: React.FC<ImageAttachmentPreviewModalProps> = ({ attachment, apiBase, companyID, surfaceText, strokeColor, onClose }) => {
  const src = useAttachmentObjectURL(attachment, apiBase, companyID, "original");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (!isCopyShortcut(event)) return;
      const copied = copyImageAttachmentToClipboard(attachment);
      if (!copied && typeof document !== "undefined") document.execCommand("copy");
      event.preventDefault();
      event.stopPropagation();
    };
    const onCopy = (event: ClipboardEvent) => {
      if (!event.clipboardData || !copyImageAttachmentToClipboard(attachment, event.clipboardData)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("copy", onCopy, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("copy", onCopy, true);
    };
  }, [attachment, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
      data-mango-copyable-image="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(17,24,39,0.46)", display: "grid", placeItems: "center", padding: 18 }}
    >
      <div style={{ width: "min(920px, 96vw)", maxHeight: "92vh", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", border: `1px solid ${strokeColor}`, borderRadius: 8, background: "#ffffff", color: surfaceText, boxShadow: "0 18px 48px rgba(0,0,0,0.26)", overflow: "hidden" }}>
        <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 32px", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: `1px solid ${strokeColor}` }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 800 }}>{attachment.name}</span>
          <button type="button" aria-label="Close image preview" onClick={onClose} style={{ width: 32, height: 32, border: `1px solid ${strokeColor}`, borderRadius: 6, background: "#ffffff", color: surfaceText, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>
            x
          </button>
        </div>
        <div style={{ minHeight: 0, overflow: "auto", display: "grid", placeItems: "center", background: "#111827", padding: 10 }}>
          {src ? (
            <img alt={attachment.name} src={src} style={{ maxWidth: "100%", maxHeight: "78vh", objectFit: "contain", display: "block" }} />
          ) : (
            <div style={{ minHeight: 180, display: "grid", placeItems: "center", color: "#ffffff", fontSize: 12, fontWeight: 800 }}>
              Preview unavailable
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

type EmailCountDropdownProps = {
  emails: EditorAttachedEmail[];
  accent: string;
  surfaceText: string;
  align?: "left" | "right";
  compact?: boolean;
  onOpenEmail: (messageID: string) => void;
};

const ATTACHED_EMAIL_DRAG_MIME = "application/x-mango-node-attached-email";

function writeAttachedEmailDragData(dataTransfer: DataTransfer, email: EditorAttachedEmail) {
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData(ATTACHED_EMAIL_DRAG_MIME, email.messageID);
  dataTransfer.setData("text/plain", email.subject || email.messageID);
}

function readAttachedEmailDragMessageID(dataTransfer: DataTransfer): string {
  return dataTransfer.getData(ATTACHED_EMAIL_DRAG_MIME).trim();
}

function hasAttachedEmailDragData(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(ATTACHED_EMAIL_DRAG_MIME);
}

export const EmailCountDropdown: React.FC<EmailCountDropdownProps> = ({ emails, accent, surfaceText, align = "right", compact = false, onOpenEmail }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useCloseFloatingMenu(open, rootRef, close);
  return (
    <div ref={rootRef} style={{ position: "relative", flex: "0 0 auto", minWidth: 0 }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Attached emails"
        onClick={() => setOpen((nextOpen) => !nextOpen)}
        style={{
          minHeight: compact ? 24 : 30,
          minWidth: compact ? 38 : 54,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          border: open ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
          borderRadius: compact ? 8 : 9,
          background: open ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
          color: open ? accent : surfaceText,
          cursor: "pointer",
          font: "inherit",
          fontSize: compact ? 10.5 : 12,
          fontWeight: 900,
          letterSpacing: 0,
          padding: compact ? "2px 7px" : "0 10px",
          boxShadow: open ? "0 8px 18px rgba(15,23,42,0.10), 0 0 12px rgba(183,124,255,0.14), inset 1px 1px 0 rgba(255,255,255,0.86)" : EDITOR_NEU_SHADOW,
        }}
      >
        <MailIcon color={open ? accent : "rgba(100,116,139,0.85)"} />
        <span>{emails.length}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Attached emails"
          style={{
            position: "absolute",
            zIndex: 80,
            top: "calc(100% + 7px)",
            right: align === "right" ? 0 : undefined,
            left: align === "left" ? 0 : undefined,
            width: compact ? 246 : 320,
            maxWidth: "min(86vw, 320px)",
            maxHeight: 310,
            overflowY: "auto",
            display: "grid",
            gap: 5,
            border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
            borderRadius: 13,
            background: EDITOR_NEU_PANEL_BACKGROUND,
            boxShadow: EDITOR_NEU_PANEL_SHADOW,
            padding: 6,
          }}
        >
          {emails.length === 0 && (
            <div style={{ padding: "8px 10px", color: surfaceText, opacity: 0.62, fontSize: 11, fontWeight: 800 }}>
              No emails attached
            </div>
          )}
          {emails.map((email) => (
            <button
              key={email.id}
              type="button"
              role="menuitem"
              title={email.subject}
              draggable
              onDragStart={(event) => writeAttachedEmailDragData(event.dataTransfer, email)}
              onClick={() => {
                setOpen(false);
                onOpenEmail(email.messageID);
              }}
              style={{
                minWidth: 0,
                display: "grid",
                gap: 3,
                border: "1px solid transparent",
                borderRadius: 10,
                background: "#ffffff",
                color: surfaceText,
                cursor: "pointer",
                padding: "7px 8px",
                textAlign: "left",
                boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86), 2px 2px 8px rgba(174,174,192,0.14), -2px -2px 8px rgba(255,255,255,0.76)",
              }}
            >
              <span style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 8 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 900 }}>{email.subject}</span>
                <span style={{ flex: "0 0 auto", fontSize: 9.5, fontWeight: 850, color: accent }}>{formatTimestamp(email.date)}</span>
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontWeight: 750, color: "rgba(100,116,139,0.86)" }}>
                From: {email.from || "Unknown sender"}
              </span>
              {email.snippet && (
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontWeight: 650, color: "rgba(100,116,139,0.72)" }}>{email.snippet}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export type TextBlockAttachmentListItem = {
  blockID: string;
  blockTitle: string;
  attachment: EditorChatAttachment;
};

type AttachmentCountDropdownProps = {
  items: TextBlockAttachmentListItem[];
  accent: string;
  surfaceText: string;
  align?: "left" | "right";
  compact?: boolean;
  editable?: boolean;
  onRemove?: (blockID: string, attachmentID: string) => void;
};

export const AttachmentCountDropdown: React.FC<AttachmentCountDropdownProps> = ({ items, accent, surfaceText, align = "right", compact = false, editable = false, onRemove }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useCloseFloatingMenu(open, rootRef, close);
  return (
    <div ref={rootRef} style={{ position: "relative", flex: "0 0 auto", minWidth: 0 }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Attachments"
        onClick={() => setOpen((nextOpen) => !nextOpen)}
        style={{
          minHeight: compact ? 24 : 30,
          minWidth: compact ? 38 : 54,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          border: open ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
          borderRadius: compact ? 8 : 9,
          background: open ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
          color: open ? accent : surfaceText,
          cursor: "pointer",
          font: "inherit",
          fontSize: compact ? 10.5 : 12,
          fontWeight: 900,
          letterSpacing: 0,
          padding: compact ? "2px 7px" : "0 10px",
          boxShadow: open ? "0 8px 18px rgba(15,23,42,0.10), 0 0 12px rgba(183,124,255,0.14), inset 1px 1px 0 rgba(255,255,255,0.86)" : EDITOR_NEU_SHADOW,
        }}
      >
        <PaperclipIcon color={open ? accent : "rgba(100,116,139,0.85)"} />
        <span>{items.length}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Attachments"
          style={{
            position: "absolute",
            zIndex: 80,
            top: "calc(100% + 7px)",
            right: align === "right" ? 0 : undefined,
            left: align === "left" ? 0 : undefined,
            width: compact ? 264 : 340,
            maxWidth: "min(86vw, 340px)",
            maxHeight: 330,
            overflowY: "auto",
            display: "grid",
            gap: 5,
            border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
            borderRadius: 13,
            background: EDITOR_NEU_PANEL_BACKGROUND,
            boxShadow: EDITOR_NEU_PANEL_SHADOW,
            padding: 6,
          }}
        >
          {items.length === 0 && (
            <div style={{ padding: "8px 10px", color: surfaceText, opacity: 0.62, fontSize: 11, fontWeight: 800 }}>
              No attachments
            </div>
          )}
          {items.map(({ blockID, blockTitle, attachment }) => (
            <div
              key={`${blockID}:${attachment.id}`}
              role="menuitem"
              style={{
                minWidth: 0,
                display: "grid",
                gridTemplateColumns: editable ? "minmax(0, 1fr) auto" : "minmax(0, 1fr)",
                alignItems: "center",
                gap: 7,
                border: "1px solid transparent",
                borderRadius: 10,
                background: "#ffffff",
                color: surfaceText,
                padding: "7px 8px",
                boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86), 2px 2px 8px rgba(174,174,192,0.14), -2px -2px 8px rgba(255,255,255,0.76)",
              }}
            >
              <a
                href={attachment.dataURL || undefined}
                download={attachment.name}
                title={attachment.name}
                onClick={() => setOpen(false)}
                style={{ minWidth: 0, display: "grid", gap: 3, color: surfaceText, textDecoration: "none", pointerEvents: attachment.dataURL ? "auto" : "none", opacity: attachment.dataURL ? 1 : 0.62 }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 900 }}>{attachment.name}</span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontWeight: 750, color: "rgba(100,116,139,0.86)" }}>
                  {blockTitle || "Text box"} - {formatFileSize(attachment.size)}
                </span>
              </a>
              {editable && onRemove && (
                <button
                  type="button"
                  title="Remove attachment"
                  aria-label="Remove attachment"
                  onClick={() => onRemove(blockID, attachment.id)}
                  style={{ width: 24, height: 24, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: "#be123c", cursor: "pointer", fontSize: 14, fontWeight: 900, lineHeight: 1, padding: 0, boxShadow: "2px 2px 6px rgba(174,174,192,0.16), -2px -2px 6px rgba(255,255,255,0.78)" }}
                >
                  X
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

type AttachedEmailFolderLayout = {
  id: string;
  name: string;
  parentID?: string;
  collapsed: boolean;
};

type AttachedEmailPaneLayout = {
  folders: AttachedEmailFolderLayout[];
  emailOrder: string[];
  emailFolderByID: Record<string, string>;
  collapsedThreadIDs: string[];
};

type AttachedEmailOrganizerPaneProps = {
  emails: EditorAttachedEmail[];
  companyID: string;
  storageKey: string;
  editable: boolean;
  accent: string;
  surfaceText: string;
  strokeColor: string;
  ruleColor: string;
  selectedMessageID?: string;
  activeEmailSelection?: EmailActiveSelection | null;
  emailHighlightRemovalRequest?: EmailHighlightRemovalRequest | null;
  onSelectMessage?: (messageID: string) => void;
  onClearSelectedMessage?: () => void;
  onRemoveEmail?: (emailID: string) => void;
  onEmailSelectionChatRequest?: (messageID: string, selection: EmailSelectionDraft) => void;
  onEmailSelectionNodeRequest?: (messageID: string, quote: string) => void;
  onError: (message: string) => void;
};

const EMPTY_ATTACHED_EMAIL_LAYOUT: AttachedEmailPaneLayout = {
  folders: [],
  emailOrder: [],
  emailFolderByID: {},
  collapsedThreadIDs: [],
};

const FolderPlusIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 18 18" style={{ display: "block" }}>
    <path d="M2.4 5.2h5l1.2 1.4h7v8.1H2.4Z" fill="none" stroke={color} strokeWidth="1.45" strokeLinejoin="round" />
    <path d="M12.2 8.5v4M10.2 10.5h4" fill="none" stroke={color} strokeWidth="1.55" strokeLinecap="round" />
  </svg>
);

const FolderIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" style={{ display: "block" }}>
    <path d="M2.4 5.2h5l1.2 1.4h7v8.1H2.4Z" fill="none" stroke={color} strokeWidth="1.45" strokeLinejoin="round" />
  </svg>
);

const TinyDisclosureIcon: React.FC<{ open: boolean; color: string }> = ({ open, color }) => (
  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" style={{ display: "block", transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }}>
    <path d="M4.7 3.2 8.3 6.5 4.7 9.8" fill="none" stroke={color} strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function uniqueAttachedEmailsByMessageID(emails: EditorAttachedEmail[]): EditorAttachedEmail[] {
  const byID = new Map<string, EditorAttachedEmail>();
  for (const email of emails) {
    const messageID = email.messageID.trim();
    if (!messageID || byID.has(messageID)) continue;
    byID.set(messageID, email);
  }
  return Array.from(byID.values());
}

function readStoredAttachedEmailPaneLayout(storageKey: string): AttachedEmailPaneLayout {
  if (typeof window === "undefined" || !storageKey.trim()) return EMPTY_ATTACHED_EMAIL_LAYOUT;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "{}") as Partial<AttachedEmailPaneLayout>;
    return {
      folders: Array.isArray(parsed.folders)
        ? parsed.folders
          .map((folder): AttachedEmailFolderLayout | null => {
            const id = typeof folder?.id === "string" ? folder.id.trim() : "";
            const name = typeof folder?.name === "string" ? folder.name.trim() : "";
            const parentID = typeof folder?.parentID === "string" ? folder.parentID.trim() : "";
            return id && name ? { id, name, parentID: parentID || undefined, collapsed: Boolean(folder.collapsed) } : null;
          })
          .filter((folder): folder is AttachedEmailFolderLayout => Boolean(folder))
        : [],
      emailOrder: Array.isArray(parsed.emailOrder) ? parsed.emailOrder.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [],
      emailFolderByID: parsed.emailFolderByID && typeof parsed.emailFolderByID === "object" && !Array.isArray(parsed.emailFolderByID)
        ? Object.fromEntries(Object.entries(parsed.emailFolderByID).filter(([emailID, folderID]) => emailID.trim() && typeof folderID === "string"))
        : {},
      collapsedThreadIDs: Array.isArray(parsed.collapsedThreadIDs) ? parsed.collapsedThreadIDs.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [],
    };
  } catch {
    return EMPTY_ATTACHED_EMAIL_LAYOUT;
  }
}

function writeStoredAttachedEmailPaneLayout(storageKey: string, layout: AttachedEmailPaneLayout): void {
  if (typeof window === "undefined" || !storageKey.trim()) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // The email layout is a local convenience and should not block the editor.
  }
}

function normalizeAttachedEmailPaneLayout(layout: AttachedEmailPaneLayout, emails: EditorAttachedEmail[]): AttachedEmailPaneLayout {
  const emailIDs = uniqueAttachedEmailsByMessageID(emails).map((email) => email.messageID);
  const emailIDSet = new Set(emailIDs);
  const folders = layout.folders.reduce<AttachedEmailFolderLayout[]>((next, folder) => {
    const id = folder.id.trim();
    const name = folder.name.trim();
    if (!id || !name || next.some((item) => item.id === id)) return next;
    next.push({ id, name, parentID: folder.parentID?.trim() || undefined, collapsed: Boolean(folder.collapsed) });
    return next;
  }, []);
  const initialFolderIDs = new Set(folders.map((folder) => folder.id));
  const foldersWithValidParents = folders.map((folder) => {
    const parentID = folder.parentID?.trim() ?? "";
    if (!parentID || parentID === folder.id || !initialFolderIDs.has(parentID)) return { ...folder, parentID: undefined };
    return { ...folder, parentID };
  });
  const folderByID = new Map(foldersWithValidParents.map((folder) => [folder.id, folder]));
  const createsCycle = (folderID: string, parentID: string): boolean => {
    let cursor = parentID;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === folderID || visited.has(cursor)) return true;
      visited.add(cursor);
      cursor = folderByID.get(cursor)?.parentID ?? "";
    }
    return false;
  };
  const normalizedFolders = foldersWithValidParents.map((folder) => (
    folder.parentID && createsCycle(folder.id, folder.parentID) ? { ...folder, parentID: undefined } : folder
  ));
  const folderIDs = new Set(normalizedFolders.map((folder) => folder.id));
  const emailOrder = layout.emailOrder.filter((id) => emailIDSet.has(id));
  for (const id of emailIDs) {
    if (!emailOrder.includes(id)) emailOrder.push(id);
  }
  const emailFolderByID: Record<string, string> = {};
  for (const [emailID, folderID] of Object.entries(layout.emailFolderByID)) {
    if (emailIDSet.has(emailID) && folderIDs.has(folderID)) emailFolderByID[emailID] = folderID;
  }
  return {
    folders: normalizedFolders,
    emailOrder,
    emailFolderByID,
    collapsedThreadIDs: layout.collapsedThreadIDs.filter((id) => emailIDSet.has(id)),
  };
}

function createAttachedEmailFolderID(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `folder:${Date.now()}:${Math.round(Math.random() * 1_000_000)}`;
}

async function loadAttachedEmailThreadPreview(email: EditorAttachedEmail, companyID: string): Promise<EmailMessage[]> {
  const primary = await getEmailMessage(email.messageID, companyID);
  const threadID = primary.thread_id?.trim() || email.threadID?.trim() || "";
  if (!threadID) return mergeEmailThreadMessages(primary, [primary], primary.local_replies ?? []);
  try {
    const thread = await getEmailThread(threadID, companyID);
    const ids = Array.from(new Set((thread.message_ids ?? []).map((id) => id.trim()).filter(Boolean)));
    if (!ids.includes(primary.id)) ids.unshift(primary.id);
    const details = await Promise.all(ids.map(async (id) => {
      if (id === primary.id) return primary;
      try {
        return await getEmailMessage(id, companyID);
      } catch {
        return thread.latest_draft_or_message?.id === id ? thread.latest_draft_or_message : null;
      }
    }));
    return mergeEmailThreadMessages(primary, details.filter((item): item is EmailMessage => Boolean(item)), primary.local_replies ?? []);
  } catch {
    return mergeEmailThreadMessages(primary, [primary], primary.local_replies ?? []);
  }
}

const AttachedEmailThreadCard: React.FC<{
  email: EditorAttachedEmail;
  companyID: string;
  editable: boolean;
  accent: string;
  surfaceText: string;
  strokeColor: string;
  ruleColor: string;
  selected: boolean;
  collapsed: boolean;
  draggable: boolean;
  replyTargetMessageID?: string;
  activeSelection?: EmailActiveSelection | null;
  highlightRemovalRequest?: EmailHighlightRemovalRequest | null;
  onToggleCollapsed: () => void;
  onSelect: () => void;
  onReply: (messageID: string) => void;
  onReplyComplete: () => void;
  onError: (message: string) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>, email: EditorAttachedEmail) => void;
  onDragStart: React.DragEventHandler<HTMLDivElement>;
  onDragEnd: React.DragEventHandler<HTMLDivElement>;
  onDropOnEmail: React.DragEventHandler<HTMLDivElement>;
  onSelectionChatRequest?: (messageID: string, selection: EmailSelectionDraft) => void;
  onSelectionNodeRequest?: (messageID: string, quote: string) => void;
}> = ({ email, companyID, editable, accent, surfaceText, strokeColor, ruleColor, selected, collapsed, draggable, replyTargetMessageID = "", activeSelection = null, highlightRemovalRequest = null, onToggleCollapsed, onSelect, onReply, onReplyComplete, onError, onContextMenu, onDragStart, onDragEnd, onDropOnEmail, onSelectionChatRequest, onSelectionNodeRequest }) => {
  const [threadMessages, setThreadMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setThreadMessages([]);
    void loadAttachedEmailThreadPreview(email, companyID)
      .then((messages) => {
        if (!cancelled) setThreadMessages(messages);
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "failed_to_load_thread");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyID, email]);

  const childMessages = threadMessages.filter((message) => message.id !== email.messageID);
  const hasThreadChildren = childMessages.length > 0;
  const replyButtonStyle = (enabled: boolean): React.CSSProperties => ({
    minHeight: 22,
    border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
    borderRadius: 7,
    background: EDITOR_NEU_SURFACE,
    color: accent,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.45,
    padding: "2px 7px",
    fontSize: 9.5,
    fontWeight: 850,
    letterSpacing: 0,
    boxShadow: "1px 1px 4px rgba(174,174,192,0.14), -1px -1px 4px rgba(255,255,255,0.76)",
  });
  const replyComposerOpen = Boolean(replyTargetMessageID.trim());

  return (
    <div
      onDragEnd={onDragEnd}
      onContextMenu={(event) => {
        if (!editable) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(event, email);
      }}
      onDragOver={(event) => {
        if (!draggable) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={onDropOnEmail}
      style={{ minWidth: 0, display: "grid", gap: selected || collapsed ? 0 : 7 }}
    >
      <div
        style={{
          minWidth: 0,
          overflow: "hidden",
          border: selected ? "1px solid transparent" : `1px solid ${strokeColor}`,
          borderRadius: 10,
          background: selected ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : "#ffffff",
          color: surfaceText,
          boxShadow: selected ? "0 9px 22px rgba(15,23,42,0.12), 0 0 14px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.86)" : "2px 2px 8px rgba(174,174,192,0.15), -2px -2px 8px rgba(255,255,255,0.76), inset 1px 1px 0 rgba(255,255,255,0.86)",
        }}
      >
        <div
          role="button"
          tabIndex={0}
          draggable={draggable}
          title={selected ? "Collapse email" : email.subject}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={onSelect}
          onDoubleClick={(event) => {
            event.preventDefault();
            onSelect();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSelect();
          }}
          style={{
            minWidth: 0,
            display: "grid",
            gap: 5,
            color: surfaceText,
            cursor: selected ? "pointer" : draggable ? "grab" : "pointer",
            userSelect: "none",
            padding: selected ? "9px 10px 6px" : "9px 10px",
          }}
        >
          <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: `minmax(0, 1fr) auto auto${hasThreadChildren ? " 22px" : ""}`, alignItems: "center", gap: 7 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 900 }}>{email.subject}</span>
            <span style={{ fontSize: 9.5, fontWeight: 800, color: accent, whiteSpace: "nowrap" }}>{formatTimestamp(email.date)}</span>
            <button
              type="button"
              disabled={!editable}
              title="Reply"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (editable) onReply(email.messageID);
              }}
              style={replyButtonStyle(editable)}
            >
              <ChatIcon color={accent} />
              Reply
            </button>
            {hasThreadChildren && (
              <button
                type="button"
                title={collapsed ? "Expand email thread" : "Collapse email thread"}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleCollapsed();
                }}
                style={{ width: 22, height: 22, border: `1px solid ${strokeColor}`, borderRadius: 7, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}
              >
                <TinyDisclosureIcon open={!collapsed} color={accent} />
              </button>
            )}
          </div>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.86)", fontSize: 10.5, fontWeight: 800 }}>
            {email.from || "Unknown sender"}
          </div>
          {email.snippet && <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.72)", fontSize: 10.5, fontWeight: 650 }}>{email.snippet}</div>}
        </div>
        {selected && (
          <div
            className="mango-email-inline-detail"
            style={{
              minWidth: 0,
              display: replyComposerOpen ? "grid" : "block",
              gridTemplateRows: replyComposerOpen ? "minmax(0, 1fr)" : undefined,
              height: replyComposerOpen ? "min(620px, 72vh)" : undefined,
              maxHeight: replyComposerOpen ? undefined : "min(620px, 72vh)",
              overflow: replyComposerOpen ? "hidden" : "visible",
              padding: replyComposerOpen ? "0 10px" : "0 10px 10px",
              boxSizing: "border-box",
              cursor: "text",
              userSelect: "text",
            }}
          >
            <EmailConversationPane
              messageID={email.messageID}
              companyID={companyID}
              editable={editable}
              accent={accent}
              surfaceText={surfaceText}
              strokeColor={strokeColor}
              ruleColor={ruleColor}
              activeSelection={activeSelection}
              highlightRemovalRequest={highlightRemovalRequest}
              initialReplyTargetMessageID={replyTargetMessageID}
              inlineExpansion
              onReplyComplete={onReplyComplete}
              onError={onError}
              onSelectionChatRequest={onSelectionChatRequest ? (selection) => onSelectionChatRequest(selection.messageID || email.messageID, selection) : undefined}
              onSelectionNodeRequest={onSelectionNodeRequest ? (selection) => onSelectionNodeRequest(selection.messageID || email.messageID, selection.quote) : undefined}
            />
          </div>
        )}
      </div>
      {!selected && !collapsed && (loading || loadError || hasThreadChildren) && (
        <div style={{ minWidth: 0, display: "grid", gap: 6, marginLeft: 22, paddingLeft: 10, borderLeft: `2px solid ${ruleColor}` }}>
          {loading && <div style={{ color: accent, fontSize: 10.5, fontWeight: 850, padding: "2px 0" }}>Loading thread</div>}
          {loadError && <div style={{ color: "#991b1b", fontSize: 10.5, fontWeight: 800 }}>{loadError}</div>}
          {childMessages.map((message) => {
            const relative = formatEmailRelativeTime(message.date);
            return (
              <div
                key={message.id}
                role="button"
                tabIndex={0}
                title={message.subject || email.subject}
                onClick={onSelect}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSelect();
                }}
                style={{ minWidth: 0, display: "grid", gap: 3, border: `1px solid ${strokeColor}`, borderRadius: 9, background: "rgba(255,255,255,0.82)", color: surfaceText, cursor: "pointer", padding: "7px 8px", textAlign: "left", boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.78)" }}
              >
                <span style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 7, alignItems: "center" }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10.8, fontWeight: 900 }}>{formatAddressList(message.from) || "Unknown sender"}</span>
                  <span style={{ color: "rgba(100,116,139,0.76)", fontSize: 9.3, fontWeight: 760, whiteSpace: "nowrap" }}>{formatTimestamp(message.date)}{relative ? ` (${relative})` : ""}</span>
                  <button
                    type="button"
                    disabled={!editable}
                    title="Reply"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (editable) onReply(message.id);
                    }}
                    style={replyButtonStyle(editable)}
                  >
                    <ChatIcon color={accent} />
                    Reply
                  </button>
                </span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.76)", fontSize: 10, fontWeight: 650 }}>{emailBodyText(message.body || message.snippet || "") || "(empty email)"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const AttachedEmailOrganizerPane: React.FC<AttachedEmailOrganizerPaneProps> = ({ emails, companyID, storageKey, editable, accent, surfaceText, strokeColor, ruleColor, selectedMessageID, activeEmailSelection = null, emailHighlightRemovalRequest = null, onSelectMessage, onClearSelectedMessage, onRemoveEmail, onEmailSelectionChatRequest, onEmailSelectionNodeRequest, onError }) => {
  const [layout, setLayout] = useState<AttachedEmailPaneLayout>(() => readStoredAttachedEmailPaneLayout(storageKey));
  const [draggingMessageID, setDraggingMessageID] = useState("");
  const [localSelectedMessageID, setLocalSelectedMessageID] = useState("");
  const [replyComposer, setReplyComposer] = useState<{ rootMessageID: string; targetMessageID: string } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ folderID: string; x: number; y: number } | null>(null);
  const [emailMenu, setEmailMenu] = useState<{ messageID: string; x: number; y: number } | null>(null);
  const [editingFolder, setEditingFolder] = useState<{ folderID: string; draft: string; isNew: boolean } | null>(null);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);
  const emailMenuRef = useRef<HTMLDivElement | null>(null);
  const folderTitleInputRef = useRef<HTMLInputElement | null>(null);
  const uniqueEmails = useMemo(() => uniqueAttachedEmailsByMessageID(emails), [emails]);
  const normalizedLayout = useMemo(() => normalizeAttachedEmailPaneLayout(layout, uniqueEmails), [layout, uniqueEmails]);
  const emailByID = useMemo(() => new Map(uniqueEmails.map((email) => [email.messageID, email])), [uniqueEmails]);
  const orderedEmails = useMemo(() => normalizedLayout.emailOrder.map((id) => emailByID.get(id)).filter((email): email is EditorAttachedEmail => Boolean(email)), [emailByID, normalizedLayout.emailOrder]);
  const collapsedThreadIDs = useMemo(() => new Set(normalizedLayout.collapsedThreadIDs), [normalizedLayout.collapsedThreadIDs]);
  const activeSelectedMessageID = selectedMessageID?.trim() || localSelectedMessageID;
  const childFoldersByParentID = useMemo(() => {
    const groups = new Map<string, AttachedEmailFolderLayout[]>();
    for (const folder of normalizedLayout.folders) {
      const parentID = folder.parentID ?? "";
      const group = groups.get(parentID) ?? [];
      group.push(folder);
      groups.set(parentID, group);
    }
    return groups;
  }, [normalizedLayout.folders]);
  const emailsByFolderID = useMemo(() => {
    const groups = new Map<string, EditorAttachedEmail[]>();
    for (const email of orderedEmails) {
      const folderID = normalizedLayout.emailFolderByID[email.messageID] ?? "";
      const group = groups.get(folderID) ?? [];
      group.push(email);
      groups.set(folderID, group);
    }
    return groups;
  }, [normalizedLayout.emailFolderByID, orderedEmails]);
  const closeFolderMenu = useCallback(() => setFolderMenu(null), []);
  const closeEmailMenu = useCallback(() => setEmailMenu(null), []);
  useCloseFloatingMenu(Boolean(folderMenu), folderMenuRef, closeFolderMenu);
  useCloseFloatingMenu(Boolean(emailMenu), emailMenuRef, closeEmailMenu);

  useEffect(() => {
    setLayout(readStoredAttachedEmailPaneLayout(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (replyComposer && !emailByID.has(replyComposer.rootMessageID)) setReplyComposer(null);
  }, [emailByID, replyComposer]);

  useEffect(() => {
    if (localSelectedMessageID && !emailByID.has(localSelectedMessageID)) setLocalSelectedMessageID("");
  }, [emailByID, localSelectedMessageID]);

  useEffect(() => {
    writeStoredAttachedEmailPaneLayout(storageKey, normalizedLayout);
  }, [normalizedLayout, storageKey]);

  const updateLayout = useCallback((recipe: (current: AttachedEmailPaneLayout) => AttachedEmailPaneLayout) => {
    setLayout((current) => normalizeAttachedEmailPaneLayout(recipe(normalizeAttachedEmailPaneLayout(current, uniqueEmails)), uniqueEmails));
  }, [uniqueEmails]);

  const removeFolder = useCallback((folderID: string) => {
    const folder = normalizedLayout.folders.find((item) => item.id === folderID);
    if (!folder) return;
    updateLayout((current) => {
      const childFolders = new Map<string, AttachedEmailFolderLayout[]>();
      for (const item of current.folders) {
        const parentID = item.parentID ?? "";
        const group = childFolders.get(parentID) ?? [];
        group.push(item);
        childFolders.set(parentID, group);
      }
      const removedFolderIDs = new Set<string>();
      const stack = [folderID];
      while (stack.length > 0) {
        const currentID = stack.pop() ?? "";
        if (!currentID || removedFolderIDs.has(currentID)) continue;
        removedFolderIDs.add(currentID);
        for (const child of childFolders.get(currentID) ?? []) stack.push(child.id);
      }
      const parentID = current.folders.find((item) => item.id === folderID)?.parentID ?? "";
      const nextFolderByID = { ...current.emailFolderByID };
      for (const [emailID, emailFolderID] of Object.entries(nextFolderByID)) {
        if (!removedFolderIDs.has(emailFolderID)) continue;
        if (parentID) nextFolderByID[emailID] = parentID;
        else delete nextFolderByID[emailID];
      }
      return {
        ...current,
        folders: current.folders.filter((item) => !removedFolderIDs.has(item.id)),
        emailFolderByID: nextFolderByID,
      };
    });
  }, [normalizedLayout.folders, updateLayout]);

  const beginFolderTitleEdit = useCallback((folderID: string, draft: string, isNew = false) => {
    if (!editable) return;
    closeFolderMenu();
    setEditingFolder({ folderID, draft, isNew });
  }, [closeFolderMenu, editable]);

  const createFolder = useCallback((parentID = "") => {
    if (!editable) return;
    const folderID = createAttachedEmailFolderID();
    const folderName = `Email folder ${normalizedLayout.folders.length + 1}`;
    updateLayout((current) => ({
      ...current,
      folders: [
        ...current.folders.map((folder) => folder.id === parentID ? { ...folder, collapsed: false } : folder),
        { id: folderID, name: folderName, parentID: parentID || undefined, collapsed: false },
      ],
    }));
    beginFolderTitleEdit(folderID, folderName, true);
  }, [beginFolderTitleEdit, editable, normalizedLayout.folders.length, updateLayout]);

  const renameFolder = useCallback((folderID: string) => {
    if (!editable) return;
    const folder = normalizedLayout.folders.find((item) => item.id === folderID);
    if (!folder) return;
    beginFolderTitleEdit(folderID, folder.name);
  }, [beginFolderTitleEdit, editable, normalizedLayout.folders]);

  const commitFolderTitleEdit = useCallback(() => {
    if (!editingFolder) return;
    const cleanName = editingFolder.draft.trim();
    const folder = normalizedLayout.folders.find((item) => item.id === editingFolder.folderID);
    if (!folder) {
      setEditingFolder(null);
      return;
    }
    if (!cleanName) {
      if (editingFolder.isNew) removeFolder(editingFolder.folderID);
      setEditingFolder(null);
      return;
    }
    updateLayout((current) => ({
      ...current,
      folders: current.folders.map((item) => item.id === editingFolder.folderID ? { ...item, name: cleanName } : item),
    }));
    setEditingFolder(null);
  }, [editingFolder, normalizedLayout.folders, removeFolder, updateLayout]);

  const cancelFolderTitleEdit = useCallback(() => {
    if (editingFolder?.isNew) removeFolder(editingFolder.folderID);
    setEditingFolder(null);
  }, [editingFolder, removeFolder]);

  const deleteFolder = useCallback((folderID: string) => {
    if (!editable) return;
    if (editingFolder?.folderID === folderID) setEditingFolder(null);
    removeFolder(folderID);
  }, [editable, editingFolder?.folderID, removeFolder]);

  useEffect(() => {
    if (!editingFolder) return;
    const frame = window.requestAnimationFrame(() => {
      folderTitleInputRef.current?.focus();
      folderTitleInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingFolder?.folderID]);

  const moveEmail = useCallback((messageID: string, folderID: string, beforeMessageID = "") => {
    if (!editable || !messageID) return;
    updateLayout((current) => {
      const nextFolderByID = { ...current.emailFolderByID };
      if (folderID) nextFolderByID[messageID] = folderID;
      else delete nextFolderByID[messageID];
      const nextOrder = current.emailOrder.filter((id) => id !== messageID);
      let insertIndex = beforeMessageID ? nextOrder.indexOf(beforeMessageID) : -1;
      if (insertIndex < 0) {
        const folderEmailIDs = nextOrder.filter((id) => (nextFolderByID[id] ?? "") === folderID);
        const lastFolderEmailID = folderEmailIDs[folderEmailIDs.length - 1] ?? "";
        insertIndex = lastFolderEmailID ? nextOrder.indexOf(lastFolderEmailID) + 1 : nextOrder.length;
      }
      nextOrder.splice(insertIndex, 0, messageID);
      return { ...current, emailOrder: nextOrder, emailFolderByID: nextFolderByID };
    });
  }, [editable, updateLayout]);

  const dropMessageIDFromEvent = useCallback((event: React.DragEvent): string => (
    draggingMessageID || readAttachedEmailDragMessageID(event.dataTransfer)
  ), [draggingMessageID]);

  const canAcceptAttachedEmailDrop = useCallback((event: React.DragEvent): boolean => (
    editable && Boolean(draggingMessageID || hasAttachedEmailDragData(event.dataTransfer))
  ), [draggingMessageID, editable]);

  const toggleFolder = useCallback((folderID: string) => {
    updateLayout((current) => ({ ...current, folders: current.folders.map((folder) => folder.id === folderID ? { ...folder, collapsed: !folder.collapsed } : folder) }));
  }, [updateLayout]);

  const toggleThread = useCallback((messageID: string) => {
    updateLayout((current) => {
      const collapsed = new Set(current.collapsedThreadIDs);
      if (collapsed.has(messageID)) collapsed.delete(messageID);
      else collapsed.add(messageID);
      return { ...current, collapsedThreadIDs: Array.from(collapsed) };
    });
  }, [updateLayout]);

  const selectMessage = useCallback((messageID: string) => {
    const cleanMessageID = messageID.trim();
    if (!cleanMessageID) return;
    setLocalSelectedMessageID(cleanMessageID);
    onSelectMessage?.(cleanMessageID);
  }, [onSelectMessage]);

  const clearSelectedMessage = useCallback(() => {
    setLocalSelectedMessageID("");
    setReplyComposer(null);
    onClearSelectedMessage?.();
  }, [onClearSelectedMessage]);

  const removeEmailFromNode = useCallback((messageID: string) => {
    if (!editable || !onRemoveEmail) return;
    const email = emailByID.get(messageID);
    if (!email) return;
    closeEmailMenu();
    if (activeSelectedMessageID === messageID) clearSelectedMessage();
    setReplyComposer((current) => current?.rootMessageID === messageID ? null : current);
    onRemoveEmail(email.id);
  }, [activeSelectedMessageID, clearSelectedMessage, closeEmailMenu, editable, emailByID, onRemoveEmail]);

  const toggleSelectedMessage = useCallback((messageID: string) => {
    const cleanMessageID = messageID.trim();
    if (!cleanMessageID) return;
    if (activeSelectedMessageID === cleanMessageID) {
      clearSelectedMessage();
      return;
    }
    selectMessage(cleanMessageID);
  }, [activeSelectedMessageID, clearSelectedMessage, selectMessage]);

  const renderEmailCards = (folderID: string) => (emailsByFolderID.get(folderID) ?? []).map((email) => (
    <AttachedEmailThreadCard
      key={email.messageID}
      email={email}
      companyID={companyID}
      editable={editable}
      accent={accent}
      surfaceText={surfaceText}
      strokeColor={strokeColor}
      ruleColor={ruleColor}
      selected={activeSelectedMessageID === email.messageID}
      collapsed={collapsedThreadIDs.has(email.messageID)}
      draggable={editable}
      replyTargetMessageID={replyComposer?.rootMessageID === email.messageID ? replyComposer.targetMessageID : ""}
      activeSelection={activeEmailSelection}
      highlightRemovalRequest={emailHighlightRemovalRequest?.messageID === email.messageID ? emailHighlightRemovalRequest : null}
      onToggleCollapsed={() => toggleThread(email.messageID)}
      onSelect={() => toggleSelectedMessage(email.messageID)}
      onReply={(targetMessageID) => {
        selectMessage(email.messageID);
        setReplyComposer({ rootMessageID: email.messageID, targetMessageID });
      }}
      onReplyComplete={() => {
        setReplyComposer((current) => current?.rootMessageID === email.messageID ? null : current);
      }}
      onError={onError}
      onContextMenu={(event, targetEmail) => setEmailMenu({ messageID: targetEmail.messageID, x: event.clientX, y: event.clientY })}
      onDragStart={(event) => {
        if (!editable) return;
        setDraggingMessageID(email.messageID);
        writeAttachedEmailDragData(event.dataTransfer, email);
      }}
      onDragEnd={() => {
        setDraggingMessageID("");
      }}
      onDropOnEmail={(event) => {
        const droppedMessageID = dropMessageIDFromEvent(event);
        if (!droppedMessageID || droppedMessageID === email.messageID) return;
        event.preventDefault();
        event.stopPropagation();
        moveEmail(droppedMessageID, folderID, email.messageID);
        setDraggingMessageID("");
      }}
      onSelectionChatRequest={onEmailSelectionChatRequest}
      onSelectionNodeRequest={onEmailSelectionNodeRequest}
    />
  ));

  const renderFolder = (folder: AttachedEmailFolderLayout, depth = 0): React.ReactNode => {
    const childFolders = childFoldersByParentID.get(folder.id) ?? [];
    const directEmails = emailsByFolderID.get(folder.id) ?? [];
    const hasContent = childFolders.length > 0 || directEmails.length > 0;
    const nested = depth > 0;
    return (
      <div
        key={folder.id}
        onDragOver={(event) => {
          if (!canAcceptAttachedEmailDrop(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          const droppedMessageID = dropMessageIDFromEvent(event);
          if (!droppedMessageID) return;
          event.preventDefault();
          event.stopPropagation();
          moveEmail(droppedMessageID, folder.id);
          setDraggingMessageID("");
        }}
        style={{
          minWidth: 0,
          display: "grid",
          gap: folder.collapsed ? 0 : 8,
          border: "1px solid transparent",
          borderRadius: 13,
          background: `${nested ? "rgba(255,255,255,0.76)" : EDITOR_NEU_PANEL_BACKGROUND} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
          boxShadow: nested ? "2px 2px 8px rgba(174,174,192,0.13), -2px -2px 8px rgba(255,255,255,0.78), inset 1px 1px 0 rgba(255,255,255,0.8)" : EDITOR_NEU_SHADOW,
          padding: 8,
        }}
      >
        <div
          onContextMenu={(event) => {
            if (!editable) return;
            event.preventDefault();
            event.stopPropagation();
            setFolderMenu({ folderID: folder.id, x: event.clientX, y: event.clientY });
          }}
          style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7, minHeight: 30, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: EDITOR_NEU_SURFACE, padding: "4px 7px", color: surfaceText, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.78)" }}
        >
          <FolderIcon color={accent} />
          {editingFolder?.folderID === folder.id ? (
            <input
              ref={folderTitleInputRef}
              value={editingFolder.draft}
              onChange={(event) => {
                const nextDraft = event.currentTarget.value;
                setEditingFolder((current) => current?.folderID === folder.id ? { ...current, draft: nextDraft } : current);
              }}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onBlur={commitFolderTitleEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitFolderTitleEdit();
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelFolderTitleEdit();
                }
              }}
              style={{ minWidth: 0, flex: "1 1 auto", height: 24, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: "#ffffff", color: surfaceText, outline: "none", padding: "0 6px", fontSize: 11.5, fontWeight: 950, boxShadow: "inset 1px 1px 4px rgba(174,174,192,0.14)" }}
            />
          ) : (
            <span
              onDoubleClick={(event) => {
                event.stopPropagation();
                renameFolder(folder.id);
              }}
              style={{ minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 950 }}
            >
              {folder.name}
            </span>
          )}
          {editable && (
            <button type="button" title="Create nested folder" onClick={(event) => { event.stopPropagation(); createFolder(folder.id); }} style={{ width: 24, height: 23, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", padding: 0, boxShadow: "1px 1px 5px rgba(174,174,192,0.14), -1px -1px 5px rgba(255,255,255,0.78)" }}>
              <FolderPlusIcon color={accent} />
            </button>
          )}
          {hasContent && (
            <button type="button" title={folder.collapsed ? "Expand folder" : "Collapse folder"} onClick={() => toggleFolder(folder.id)} style={{ width: 22, height: 22, border: `1px solid ${strokeColor}`, borderRadius: 7, background: EDITOR_NEU_ACTIVE_SURFACE, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}>
              <TinyDisclosureIcon open={!folder.collapsed} color={accent} />
            </button>
          )}
        </div>
        {!folder.collapsed && (
          <div style={{ minWidth: 0, display: "grid", gap: 8, marginLeft: 12, paddingLeft: 11, paddingBottom: 2, borderLeft: `2px solid ${ruleColor}` }}>
            {childFolders.map((childFolder) => renderFolder(childFolder, depth + 1))}
            {renderEmailCards(folder.id)}
            {!hasContent && (
              <div style={{ minWidth: 0, minHeight: 34, display: "grid", placeItems: "center", border: `1px dashed ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, color: "rgba(100,116,139,0.68)", fontSize: 10.5, fontWeight: 850, background: "rgba(255,255,255,0.5)" }}>
                Drop emails here
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderUnfiledGroup = () => {
    const label = normalizedLayout.folders.length > 0 ? "Unfiled emails" : "Attached emails";
    const unfiledEmails = emailsByFolderID.get("") ?? [];
    return (
      <div
        key="unfiled"
        onDragOver={(event) => {
          if (!canAcceptAttachedEmailDrop(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          const droppedMessageID = dropMessageIDFromEvent(event);
          if (!droppedMessageID) return;
          event.preventDefault();
          event.stopPropagation();
          moveEmail(droppedMessageID, "");
          setDraggingMessageID("");
        }}
        style={{ minWidth: 0, display: "grid", gap: 8, border: "1px solid transparent", borderRadius: 13, background: `${EDITOR_NEU_PANEL_BACKGROUND} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`, boxShadow: EDITOR_NEU_SHADOW, padding: 8 }}
      >
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7, minHeight: 30, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: EDITOR_NEU_SURFACE, padding: "4px 7px", color: surfaceText, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.78)" }}>
          <MailIcon color={accent} />
          <span style={{ minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 950 }}>{label}</span>
        </div>
        <div style={{ minWidth: 0, display: "grid", gap: 8, padding: "0 1px 1px" }}>
          {renderEmailCards("")}
          {unfiledEmails.length === 0 && (
            <div style={{ minWidth: 0, minHeight: 34, display: "grid", placeItems: "center", border: `1px dashed ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, color: "rgba(100,116,139,0.68)", fontSize: 10.5, fontWeight: 850, background: "rgba(255,255,255,0.5)" }}>
              Drop emails here
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ height: "100%", minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", color: surfaceText, overflow: "hidden" }}>
      <div style={{ minHeight: 34, display: "flex", alignItems: "center", gap: 6, borderBottom: `1px solid ${ruleColor}`, padding: "5px 7px", color: surfaceText, fontSize: 11, fontWeight: 900, background: "linear-gradient(90deg, rgba(255,241,242,0.60), rgba(236,253,245,0.42) 52%, rgba(239,246,255,0.62))" }}>
        <MailIcon color={accent} />
        <span style={{ minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Email</span>
        {editable && (
          <button type="button" title="Create email folder" onClick={() => createFolder("")} style={{ width: 26, height: 24, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: "pointer", padding: 0, boxShadow: "2px 2px 7px rgba(174,174,192,0.16), -2px -2px 7px rgba(255,255,255,0.78)" }}>
            <FolderPlusIcon color={accent} />
          </button>
        )}
      </div>
      {folderMenu && (
        <div
          ref={folderMenuRef}
          role="menu"
          aria-label="Email folder actions"
          onContextMenu={(event) => event.preventDefault()}
          style={{
            position: "fixed",
            zIndex: 120,
            top: folderMenu.y,
            left: folderMenu.x,
            minWidth: 132,
            display: "grid",
            gap: 4,
            border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
            borderRadius: 11,
            background: EDITOR_NEU_PANEL_BACKGROUND,
            boxShadow: EDITOR_NEU_PANEL_SHADOW,
            padding: 5,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const folderID = folderMenu.folderID;
              closeFolderMenu();
              renameFolder(folderID);
            }}
            style={{ minHeight: 28, border: "1px solid transparent", borderRadius: 8, background: "transparent", color: surfaceText, cursor: "pointer", padding: "4px 8px", textAlign: "left", font: "inherit", fontSize: 11, fontWeight: 850 }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const folderID = folderMenu.folderID;
              closeFolderMenu();
              deleteFolder(folderID);
            }}
            style={{ minHeight: 28, border: "1px solid transparent", borderRadius: 8, background: "transparent", color: "#dc2626", cursor: "pointer", padding: "4px 8px", textAlign: "left", font: "inherit", fontSize: 11, fontWeight: 850 }}
          >
            Delete
          </button>
        </div>
      )}
      {emailMenu && onRemoveEmail && (
        <div
          ref={emailMenuRef}
          role="menu"
          aria-label="Email actions"
          onContextMenu={(event) => event.preventDefault()}
          style={{
            position: "fixed",
            zIndex: 120,
            top: emailMenu.y,
            left: emailMenu.x,
            minWidth: 162,
            display: "grid",
            gap: 4,
            border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
            borderRadius: 11,
            background: EDITOR_NEU_PANEL_BACKGROUND,
            boxShadow: EDITOR_NEU_PANEL_SHADOW,
            padding: 5,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => removeEmailFromNode(emailMenu.messageID)}
            style={{ minHeight: 28, border: "1px solid transparent", borderRadius: 8, background: "transparent", color: "#dc2626", cursor: "pointer", padding: "4px 8px", textAlign: "left", font: "inherit", fontSize: 11, fontWeight: 850 }}
          >
            Remove from node
          </button>
        </div>
      )}
      <div className="editor-document-scroll" style={{ minHeight: 0, overflowY: "auto", overflowX: "hidden", display: "grid", alignContent: "start", gap: 10, padding: 9, ["--editor-document-scroll-accent" as string]: accent, ["--editor-document-scroll-track" as string]: "transparent" }}>
        {uniqueEmails.length === 0 ? (
          <div style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 14, color: surfaceText }}>
            <div style={{ display: "grid", justifyItems: "center", gap: 9, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 13, background: EDITOR_NEU_SURFACE, padding: 14, boxShadow: EDITOR_NEU_SHADOW }}>
              <MailIcon color={accent} />
              <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(100,116,139,0.86)" }}>No emails attached</div>
            </div>
          </div>
        ) : (
          <>
            {(childFoldersByParentID.get("") ?? []).map((folder) => renderFolder(folder))}
            {renderUnfiledGroup()}
          </>
        )}
      </div>
    </div>
  );
};

type EmailConversationPaneProps = {
  messageID: string;
  companyID: string;
  editable: boolean;
  accent: string;
  surfaceText: string;
  strokeColor: string;
  ruleColor: string;
  activeSelection?: EmailActiveSelection | null;
  highlightRemovalRequest?: EmailHighlightRemovalRequest | null;
  initialReplyTargetMessageID?: string;
  inlineExpansion?: boolean;
  onReplyComplete?: () => void;
  onError: (message: string) => void;
  onSelectionChatRequest?: (selection: EmailSelectionDraft) => void;
  onSelectionNodeRequest?: (selection: EmailSelectionDraft) => void;
};

type EmailSelectionDraft = {
  messageID: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  x: number;
  y: number;
};

type EmailLocalHighlight = {
  id: string;
  quote: string;
  startOffset: number;
  endOffset: number;
};

type EmailLocalHighlightsByMessageID = Record<string, EmailLocalHighlight[]>;

export type EmailHighlightSelection = {
  quote: string;
  startOffset: number;
  endOffset: number;
};

type EmailActiveSelection = {
  messageID?: string;
  quote: string;
  startOffset: number;
  endOffset: number;
};

export type EmailHighlightRemovalRequest = {
  requestID: number;
  messageID: string;
  quote: string;
  startOffset: number;
  endOffset: number;
};

const EMAIL_LOCAL_HIGHLIGHTS_STORAGE_PREFIX = "node-editor-email-local-highlights-v1";
const EMAIL_BODY_MESSAGE_ID_ATTRIBUTE = "data-mango-email-body-message-id";
const EMAIL_SELECTION_ACTION_BUTTON_SIZE = 28;
const EMAIL_SELECTION_ACTION_GAP = 5;
const EMAIL_SELECTION_ACTION_PADDING = 4;
const EMAIL_SELECTION_ACTION_BORDER = 1;
const EMAIL_SELECTION_ACTION_OFFSET = 8;
const EMAIL_PICKER_MESSAGE_BATCH_SIZE = 12;
const EMAIL_PICKER_PREFETCH_REMAINING_ROWS = 5;
const EMAIL_PICKER_APPROX_ROW_HEIGHT = 80;
const ATTACHED_EMAIL_REPLY_EDITOR_TAB_IDS: readonly EditorTabID[] = ["format", "outline-styles"];

type EmailPickerPrefetchedPage = {
  filterKey: string;
  pageToken: string;
  page: MessagePage;
};

function emailSelectionActionToolbarWidth(actionCount: number): number {
  return (actionCount * EMAIL_SELECTION_ACTION_BUTTON_SIZE)
    + (Math.max(0, actionCount - 1) * EMAIL_SELECTION_ACTION_GAP)
    + (EMAIL_SELECTION_ACTION_PADDING * 2)
    + (EMAIL_SELECTION_ACTION_BORDER * 2);
}

function clampEmailSelectionActionPosition(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

const emailSelectionActionButtonStyle: React.CSSProperties = {
  width: EMAIL_SELECTION_ACTION_BUTTON_SIZE,
  height: EMAIL_SELECTION_ACTION_BUTTON_SIZE,
  minWidth: EMAIL_SELECTION_ACTION_BUTTON_SIZE,
  minHeight: EMAIL_SELECTION_ACTION_BUTTON_SIZE,
  flex: `0 0 ${EMAIL_SELECTION_ACTION_BUTTON_SIZE}px`,
  borderRadius: 8,
  border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
  background: EDITOR_NEU_SURFACE,
  color: "inherit",
  display: "grid",
  placeItems: "center",
  padding: 0,
  cursor: "pointer",
  lineHeight: 0,
  boxSizing: "border-box",
  boxShadow: "2px 2px 6px rgba(174,174,192,0.16), -2px -2px 6px rgba(255,255,255,0.78)",
};

const EmailSelectionActionIconFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span aria-hidden="true" style={{ width: 16, height: 16, display: "grid", placeItems: "center", lineHeight: 0 }}>
    {children}
  </span>
);

const EmailSelectionCreateNodeIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" style={{ display: "block" }}>
    <rect x="2.7" y="2.7" width="10.6" height="10.6" rx="2.2" fill="none" stroke={color} strokeWidth="1.45" />
    <path d="M8 5.2v5.6M5.2 8h5.6" fill="none" stroke={color} strokeWidth="1.65" strokeLinecap="round" />
  </svg>
);

function emailLocalHighlightsStorageKey(messageID: string): string {
  return `${EMAIL_LOCAL_HIGHLIGHTS_STORAGE_PREFIX}:${messageID}`;
}

function readStoredEmailLocalHighlights(messageID: string): EmailLocalHighlight[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(emailLocalHighlightsStorageKey(messageID)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): EmailLocalHighlight | null => {
        if (!item || typeof item !== "object") return null;
        const quote = typeof item.quote === "string" ? item.quote : "";
        const startOffset = Number(item.startOffset);
        const endOffset = Number(item.endOffset);
        const id = typeof item.id === "string" && item.id.trim() ? item.id : `${startOffset}:${endOffset}:${quote}`;
        if (!quote || !Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset <= startOffset) return null;
        return { id, quote, startOffset, endOffset };
      })
      .filter((item): item is EmailLocalHighlight => Boolean(item));
  } catch {
    return [];
  }
}

function storeEmailLocalHighlights(messageID: string, highlights: EmailLocalHighlight[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(emailLocalHighlightsStorageKey(messageID), JSON.stringify(highlights.slice(-80)));
}

function emailLocalHighlightMatchesSelection(highlight: EmailLocalHighlight, selection: EmailHighlightSelection): boolean {
  return highlight.quote.trim() === selection.quote.trim()
    && Math.round(highlight.startOffset) === Math.round(selection.startOffset)
    && Math.round(highlight.endOffset) === Math.round(selection.endOffset);
}

export function removeStoredEmailLocalHighlight(messageID: string, selection: EmailHighlightSelection): boolean {
  const highlights = readStoredEmailLocalHighlights(messageID);
  const next = highlights.filter((highlight) => !emailLocalHighlightMatchesSelection(highlight, selection));
  if (next.length === highlights.length) return false;
  storeEmailLocalHighlights(messageID, next);
  return true;
}

function renderEmailTextWithHighlights(text: string, highlights: EmailLocalHighlight[], activeSelection?: EmailActiveSelection | null): React.ReactNode[] {
  if (!text) return [text];
  const activeHighlight: EmailLocalHighlight | null = activeSelection?.quote.trim()
    ? {
      id: "active-email-chat-selection",
      quote: activeSelection.quote.trim(),
      startOffset: activeSelection.startOffset,
      endOffset: activeSelection.endOffset,
    }
    : null;
  const sourceHighlights = activeHighlight ? [activeHighlight, ...highlights] : highlights;
  if (sourceHighlights.length === 0) return [text];
  const ranges = sourceHighlights
    .map((highlight) => {
      let start = Math.max(0, Math.min(text.length, Math.round(highlight.startOffset)));
      let end = Math.max(start, Math.min(text.length, Math.round(highlight.endOffset)));
      if (!highlight.quote || end <= start || text.slice(start, end) !== highlight.quote) {
        const found = text.indexOf(highlight.quote);
        if (found < 0) return null;
        start = found;
        end = found + highlight.quote.length;
      }
      return { ...highlight, start, end };
    })
    .filter((range): range is EmailLocalHighlight & { start: number; end: number } => Boolean(range))
    .sort((a, b) => a.start - b.start || a.end - b.end || (a.id === "active-email-chat-selection" ? -1 : b.id === "active-email-chat-selection" ? 1 : 0));
  if (ranges.length === 0) return [text];
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor || range.end <= range.start) continue;
    if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
    nodes.push(
      <span
        key={range.id}
        style={{
          borderRadius: 4,
          background: range.id === "active-email-chat-selection" ? EDITOR_SOURCE_HIGHLIGHT_ACTIVE_BACKGROUND : EDITOR_SOURCE_HIGHLIGHT_BACKGROUND,
          boxShadow: range.id === "active-email-chat-selection"
            ? EDITOR_SOURCE_HIGHLIGHT_OUTLINE
            : EDITOR_SOURCE_HIGHLIGHT_SOFT_OUTLINE,
        }}
      >
        {text.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function replySubject(subject: string): string {
  const clean = subject.trim() || "(no subject)";
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

function parseEmailAddressDraft(value: string): EmailAddress[] {
  return value
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*?)<([^<>]+)>$/);
      if (match) {
        return { name: match[1].trim(), email: match[2].trim() };
      }
      return { email: part };
    })
    .filter((address) => address.email.includes("@"));
}

function emailBodyText(body: string): string {
  const value = body.trim();
  if (!value) return "";
  if (/<\/?[a-z][\s\S]*>/i.test(value) && typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(value, "text/html");
    document.querySelectorAll("script, style, noscript").forEach((element) => element.remove());
    const blockTags = new Set(["address", "article", "aside", "blockquote", "div", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "li", "p", "section", "tr"]);
    const parts: string[] = [];
    const appendText = (node: ChildNode) => {
      if (node.nodeType === 3) {
        parts.push(node.textContent ?? "");
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      const tagName = node.tagName.toLowerCase();
      if (tagName === "br") parts.push("\n");
      for (const child of Array.from(node.childNodes)) appendText(child);
      if (blockTags.has(tagName)) parts.push("\n");
    };
    for (const child of Array.from(document.body.childNodes)) appendText(child);
    return parts.join("")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function emailMessageTimestamp(message: EmailMessage): number {
  return typeof message.date === "number" && Number.isFinite(message.date) ? message.date : 0;
}

function formatEmailRelativeTime(value: string | number | undefined): string {
  if (value === undefined || value === "") return "";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return "";
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (diffMs < minuteMs) return "just now";
  if (diffMs < hourMs) {
    const minutes = Math.max(1, Math.round(diffMs / minuteMs));
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.round(diffMs / hourMs));
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.max(1, Math.round(diffMs / dayMs));
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function mergeEmailThreadMessages(primary: EmailMessage | null, fetchedMessages: EmailMessage[], sentReplies: EmailMessage[]): EmailMessage[] {
  const byID = new Map<string, EmailMessage>();
  const append = (message: EmailMessage | null | undefined) => {
    if (!message?.id) return;
    const existing = byID.get(message.id);
    byID.set(message.id, existing ? { ...existing, ...message } : message);
  };
  for (const threadMessage of fetchedMessages) append(threadMessage);
  append(primary);
  for (const threadMessage of fetchedMessages) {
    for (const reply of threadMessage.local_replies ?? []) append(reply);
  }
  for (const reply of primary?.local_replies ?? []) append(reply);
  for (const reply of sentReplies) append(reply);
  return Array.from(byID.values()).sort((a, b) => (
    emailMessageTimestamp(a) - emailMessageTimestamp(b)
    || a.id.localeCompare(b.id)
  ));
}

export const EmailConversationPane: React.FC<EmailConversationPaneProps> = ({
  messageID,
  companyID,
  editable,
  accent,
  surfaceText,
  strokeColor,
  ruleColor,
  activeSelection,
  highlightRemovalRequest,
  initialReplyTargetMessageID,
  inlineExpansion = false,
  onReplyComplete,
  onError,
  onSelectionChatRequest,
  onSelectionNodeRequest,
}) => {
  const [message, setMessage] = useState<EmailMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<EmailMessage[]>([]);
  const [sentReplies, setSentReplies] = useState<EmailMessage[]>([]);
  const [toDraft, setToDraft] = useState("");
  const [subjectDraft, setSubjectDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [replyTargetMessageID, setReplyTargetMessageID] = useState("");
  const [draftAttachments, setDraftAttachments] = useState<EditorChatAttachment[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<EditorChatAttachment | null>(null);
  const [replyOutlineStyle, setReplyOutlineStyle] = useState<EditorOutlineStyleID>("automatic-outline-numbering");
  const [replyToolbarTab, setReplyToolbarTab] = useState<EditorTabID>("format");
  const [replySelectionFontSize, setReplySelectionFontSize] = useState(EDITOR_DOCUMENT_FONT_SIZE_PX);
  const [replySelectionInlineFormat, setReplySelectionInlineFormat] = useState<EditorSelectionInlineFormatState>({ bold: false, underline: false });
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replyEditorControllerRef = useRef<UnifiedRichEditorFormattingController | null>(null);
  const appliedInitialReplyTargetRef = useRef("");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const selectedEmailBodyRef = useRef<HTMLDivElement | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<EmailSelectionDraft | null>(null);
  const [emailHighlightsByMessageID, setEmailHighlightsByMessageID] = useState<EmailLocalHighlightsByMessageID>(() => ({
    [messageID]: readStoredEmailLocalHighlights(messageID),
  }));
  const [bodyFrameHeights, setBodyFrameHeights] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setMessage(null);
    setThreadMessages([]);
    setSentReplies([]);
    setReplyTargetMessageID("");
    setReplyToolbarTab("format");
    setReplySelectionFontSize(EDITOR_DOCUMENT_FONT_SIZE_PX);
    setReplySelectionInlineFormat({ bold: false, underline: false });
    setDraftAttachments([]);
    setPreviewAttachment(null);
    setSelectionDraft(null);
    setEmailHighlightsByMessageID({ [messageID]: readStoredEmailLocalHighlights(messageID) });
    setBodyFrameHeights({});
    void (async () => {
      const payload = await getEmailMessage(messageID, companyID);
      if (cancelled) return;
      setMessage(payload);
      setThreadMessages([payload]);
      setSentReplies(payload.local_replies ?? []);
      setToDraft(formatAddressList(payload.reply_to?.length ? payload.reply_to : payload.from));
      setSubjectDraft(replySubject(payload.subject));
      setBodyDraft("");

      const threadID = payload.thread_id?.trim();
      if (!threadID) return;
      try {
        const thread = await getEmailThread(threadID, companyID);
        if (cancelled) return;
        let ids = Array.from(new Set((thread.message_ids ?? []).map((item) => item.trim()).filter(Boolean)));
        if (ids.length === 0) {
          const page = await listEmailMessages({ companyID, mailbox: "all", limit: EMAIL_PICKER_MESSAGE_BATCH_SIZE, threadID, refresh: true });
          ids = Array.from(new Set((page.messages ?? []).map((item) => item.id).filter(Boolean)));
        }
        if (!ids.includes(payload.id)) ids.unshift(payload.id);
        const details = await Promise.all(ids.map(async (id) => {
          if (id === payload.id) return payload;
          try {
            return await getEmailMessage(id, companyID);
          } catch {
            return thread.latest_draft_or_message?.id === id ? thread.latest_draft_or_message : null;
          }
        }));
        if (!cancelled) setThreadMessages(details.filter((item): item is EmailMessage => Boolean(item)));
      } catch {
        try {
          const page = await listEmailMessages({ companyID, mailbox: "all", limit: EMAIL_PICKER_MESSAGE_BATCH_SIZE, threadID, refresh: true });
          if (cancelled) return;
          const ids = Array.from(new Set((page.messages ?? []).map((item) => item.id).filter(Boolean)));
          if (!ids.includes(payload.id)) ids.unshift(payload.id);
          const details = await Promise.all(ids.map(async (id) => {
            if (id === payload.id) return payload;
            try {
              return await getEmailMessage(id, companyID);
            } catch {
              return (page.messages ?? []).find((item) => item.id === id) ?? null;
            }
          }));
          if (!cancelled) setThreadMessages(details.filter((item): item is EmailMessage => Boolean(item)));
        } catch {
          if (!cancelled) setThreadMessages([payload]);
        }
      }
    })()
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "failed_to_load_email");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyID, messageID]);

  useEffect(() => {
    if (!highlightRemovalRequest) return;
    const targetMessageID = highlightRemovalRequest.messageID.trim() || messageID;
    setEmailHighlightsByMessageID((current) => {
      const currentHighlights = current[targetMessageID] ?? readStoredEmailLocalHighlights(targetMessageID);
      const nextHighlights = currentHighlights.filter((highlight) => !emailLocalHighlightMatchesSelection(highlight, highlightRemovalRequest));
      if (nextHighlights.length === currentHighlights.length) return current;
      storeEmailLocalHighlights(targetMessageID, nextHighlights);
      return { ...current, [targetMessageID]: nextHighlights };
    });
  }, [highlightRemovalRequest?.requestID, highlightRemovalRequest?.messageID, messageID]);

  const recipients = parseEmailAddressDraft(toDraft);
  const canSend = editable && !sending && Boolean(message) && Boolean(replyTargetMessageID) && recipients.length > 0 && subjectDraft.trim() && bodyDraft.trim();
  const replyEditorHeight = inlineExpansion ? 112 : 138;
  const canUseEmailSelection = editable && Boolean(onSelectionChatRequest || onSelectionNodeRequest);
  const useRichEmailBody = !canUseEmailSelection;
  const selectedEmailBodyText = useMemo(() => (message ? emailBodyText(message.body || message.snippet || "") : ""), [message]);
  const displayThreadMessages = useMemo(() => mergeEmailThreadMessages(message, threadMessages, sentReplies), [message, sentReplies, threadMessages]);
  useEffect(() => {
    setEmailHighlightsByMessageID((current) => {
      let changed = false;
      const next = { ...current };
      for (const threadMessage of displayThreadMessages) {
        const threadMessageID = threadMessage.id?.trim();
        if (!threadMessageID || threadMessageID in next) continue;
        next[threadMessageID] = readStoredEmailLocalHighlights(threadMessageID);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [displayThreadMessages]);
  const selectionActionCount = (onSelectionChatRequest ? 1 : 0) + (onSelectionNodeRequest ? 1 : 0);
  const selectionActionToolbarWidth = emailSelectionActionToolbarWidth(selectionActionCount);
  const selectionActionToolbarHeight = EMAIL_SELECTION_ACTION_BUTTON_SIZE + (EMAIL_SELECTION_ACTION_PADDING * 2) + (EMAIL_SELECTION_ACTION_BORDER * 2);
  const replyTargetMessage = useMemo(() => (
    replyTargetMessageID ? displayThreadMessages.find((item) => item.id === replyTargetMessageID) ?? null : null
  ), [displayThreadMessages, replyTargetMessageID]);

  useEffect(() => {
    const targetID = initialReplyTargetMessageID?.trim() ?? "";
    const targetKey = `${messageID}:${targetID}`;
    if (!editable || !targetID || appliedInitialReplyTargetRef.current === targetKey) return;
    const target = displayThreadMessages.find((item) => item.id === targetID);
    if (!target) return;
    appliedInitialReplyTargetRef.current = targetKey;
    setReplyTargetMessageID(target.id);
    setToDraft(formatAddressList(target.reply_to?.length ? target.reply_to : target.from));
    setSubjectDraft(replySubject(target.subject || message?.subject || ""));
    window.requestAnimationFrame(() => replyEditorControllerRef.current?.focus());
  }, [displayThreadMessages, editable, initialReplyTargetMessageID, message?.subject, messageID]);

  const readEmailSelectionDraft = useCallback((): EmailSelectionDraft | null => {
    if (!canUseEmailSelection) return null;
    const root = bodyRef.current;
    if (!root) return null;
    const selection = root.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const commonElement = range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    const content = commonElement?.closest(`[${EMAIL_BODY_MESSAGE_ID_ATTRIBUTE}]`);
    if (!(content instanceof HTMLElement) || !root.contains(content)) return null;
    if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return null;
    const selectionMessageID = content.getAttribute(EMAIL_BODY_MESSAGE_ID_ATTRIBUTE)?.trim() || messageID;
    const contentText = content.textContent ?? "";
    const rawQuote = range.toString();
    const quote = rawQuote.trim();
    if (!quote) return null;
    const leadingTrim = rawQuote.length - rawQuote.trimStart().length;
    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(content);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = Math.max(0, Math.min(contentText.length, beforeRange.toString().length + leadingTrim));
    const endOffset = Math.max(startOffset, Math.min(contentText.length, startOffset + quote.length));
    if (endOffset <= startOffset) return null;
    const selectionIsBackward = selection.anchorNode && selection.focusNode
      ? selection.anchorNode === selection.focusNode
        ? selection.focusOffset < selection.anchorOffset
        : Boolean(selection.anchorNode.compareDocumentPosition(selection.focusNode) & Node.DOCUMENT_POSITION_PRECEDING)
      : false;
    const rangeRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    const focusRect = (selectionIsBackward ? rangeRects[0] : rangeRects[rangeRects.length - 1]) ?? range.getBoundingClientRect();
    const selectionRect = range.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const minX = root.scrollLeft + EMAIL_SELECTION_ACTION_OFFSET;
    const maxX = root.scrollLeft + root.clientWidth - selectionActionToolbarWidth - EMAIL_SELECTION_ACTION_OFFSET;
    const minY = root.scrollTop + EMAIL_SELECTION_ACTION_OFFSET;
    const maxY = root.scrollTop + root.clientHeight - selectionActionToolbarHeight - EMAIL_SELECTION_ACTION_OFFSET;
    const rawSideX = selectionIsBackward
      ? focusRect.left - rootRect.left + root.scrollLeft - selectionActionToolbarWidth - EMAIL_SELECTION_ACTION_OFFSET
      : focusRect.right - rootRect.left + root.scrollLeft + EMAIL_SELECTION_ACTION_OFFSET;
    const sideHasRoom = rawSideX >= minX && rawSideX <= maxX;
    const rawCenteredX = selectionRect.left - rootRect.left + root.scrollLeft + ((selectionRect.width - selectionActionToolbarWidth) / 2);
    const x = sideHasRoom ? rawSideX : clampEmailSelectionActionPosition(rawCenteredX, minX, maxX);
    const rawCenteredY = focusRect.top - rootRect.top + root.scrollTop + ((focusRect.height - selectionActionToolbarHeight) / 2);
    const rawBelowY = selectionRect.bottom - rootRect.top + root.scrollTop + EMAIL_SELECTION_ACTION_OFFSET;
    const rawAboveY = selectionRect.top - rootRect.top + root.scrollTop - selectionActionToolbarHeight - EMAIL_SELECTION_ACTION_OFFSET;
    const rawY = sideHasRoom
      ? rawCenteredY
      : rawBelowY <= maxY
        ? rawBelowY
        : rawAboveY >= minY
          ? rawAboveY
          : rawCenteredY;
    const y = clampEmailSelectionActionPosition(rawY, minY, maxY);
    return { messageID: selectionMessageID, quote, startOffset, endOffset, x, y };
  }, [canUseEmailSelection, messageID, selectionActionToolbarHeight, selectionActionToolbarWidth]);

  const captureEmailSelection = useCallback(() => {
    window.setTimeout(() => setSelectionDraft(readEmailSelectionDraft()), 0);
  }, [readEmailSelectionDraft]);

  const addEmailLocalHighlight = useCallback((draft: EmailSelectionDraft) => {
    const targetMessageID = draft.messageID.trim() || messageID;
    const highlight: EmailLocalHighlight = {
      id: `${Date.now()}:${draft.startOffset}:${draft.endOffset}`,
      quote: draft.quote,
      startOffset: draft.startOffset,
      endOffset: draft.endOffset,
    };
    setEmailHighlightsByMessageID((current) => {
      const currentHighlights = current[targetMessageID] ?? readStoredEmailLocalHighlights(targetMessageID);
      if (currentHighlights.some((item) => item.startOffset === highlight.startOffset && item.endOffset === highlight.endOffset && item.quote === highlight.quote)) return current;
      const nextHighlights = [...currentHighlights, highlight].slice(-80);
      storeEmailLocalHighlights(targetMessageID, nextHighlights);
      return { ...current, [targetMessageID]: nextHighlights };
    });
  }, [messageID]);

  const addEmailDraftAttachments = useCallback((files: FileList | File[]) => {
    if (!editable) return;
    const incomingFiles = Array.from(files);
    if (incomingFiles.length === 0) return;
    let nextTotalSize = draftAttachments.reduce((total, attachment) => total + attachment.size, 0);
    const acceptedFiles: File[] = [];
    for (const file of incomingFiles) {
      if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
        const nextError = `${file.name} is larger than ${formatFileSize(CHAT_ATTACHMENT_MAX_BYTES)}.`;
        setError(nextError);
        onError(nextError);
        continue;
      }
      if (nextTotalSize + file.size > CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES) {
        const nextError = `Email draft attachments are limited to ${formatFileSize(CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES)} total.`;
        setError(nextError);
        onError(nextError);
        continue;
      }
      acceptedFiles.push(file);
      nextTotalSize += file.size;
    }
    if (acceptedFiles.length === 0) return;
    void Promise.all(acceptedFiles.map((file) => readChatAttachment(file)))
      .then((attachments) => {
        setError("");
        setDraftAttachments((current) => [...current, ...attachments]);
      })
      .catch((cause) => {
        const nextError = cause instanceof Error ? cause.message : "failed_to_read_attachment";
        setError(nextError);
        onError(nextError);
      });
  }, [draftAttachments, editable, onError]);

  const removeEmailDraftAttachment = useCallback((attachmentID: string) => {
    setDraftAttachments((current) => current.filter((attachment) => attachment.id !== attachmentID));
  }, []);

  const selectReplyTarget = useCallback((target: EmailMessage) => {
    if (!editable) return;
    if (replyTargetMessageID === target.id) {
      setReplyTargetMessageID("");
      return;
    }
    setReplyTargetMessageID(target.id);
    setToDraft(formatAddressList(target.reply_to?.length ? target.reply_to : target.from));
    setSubjectDraft(replySubject(target.subject || message?.subject || ""));
    window.requestAnimationFrame(() => replyEditorControllerRef.current?.focus());
  }, [editable, message?.subject, replyTargetMessageID]);

  const submitReply = () => {
    if (!message || !replyTargetMessage || !canSend) return;
    if (draftAttachments.length > 0) {
      const nextError = "Email attachment sending is not wired yet.";
      setError(nextError);
      onError(nextError);
      return;
    }
    setSending(true);
    void sendEmail({
      to: recipients,
      subject: subjectDraft.trim(),
      body: unifiedRichEditorBodyToEmailHTML(bodyDraft),
      reply_to_message_id: replyTargetMessage.id,
      company_id: companyID,
    })
      .then((sent) => {
        const sentWithTimestamp = sent.date ? sent : { ...sent, date: Math.floor(Date.now() / 1000) };
        setSentReplies((current) => [...current, sentWithTimestamp]);
        setBodyDraft("");
        setDraftAttachments([]);
        setReplyTargetMessageID("");
        onReplyComplete?.();
      })
      .catch((cause) => {
        const nextError = cause instanceof Error ? cause.message : "failed_to_send_email";
        setError(nextError);
        onError(nextError);
      })
      .finally(() => setSending(false));
  };

  const updateBodyFrameHeight = useCallback((messageIDForFrame: string, iframe: HTMLIFrameElement) => {
    try {
      const bodyHeight = iframe.contentDocument?.body?.scrollHeight ?? 0;
      const documentHeight = iframe.contentDocument?.documentElement?.scrollHeight ?? 0;
      const measuredHeight = inlineExpansion ? bodyHeight : Math.max(bodyHeight, documentHeight);
      const nextHeight = Math.min(1400, Math.max(inlineExpansion ? 44 : 190, measuredHeight + (inlineExpansion ? 2 : 4)));
      setBodyFrameHeights((current) => current[messageIDForFrame] === nextHeight ? current : { ...current, [messageIDForFrame]: nextHeight });
    } catch {
      setBodyFrameHeights((current) => current[messageIDForFrame] ? current : { ...current, [messageIDForFrame]: inlineExpansion ? 64 : 420 });
    }
  }, [inlineExpansion]);

  const syncReplyToolbarFormatState = useCallback(() => {
    const state = replyEditorControllerRef.current?.readFormatState();
    if (!state) return;
    setReplySelectionFontSize(state.fontSize);
    setReplySelectionInlineFormat({ bold: state.bold, underline: state.underline });
  }, []);
  const adjustReplyFontSize = useCallback((delta: number) => {
    replyEditorControllerRef.current?.adjustFontSize(delta);
    syncReplyToolbarFormatState();
  }, [syncReplyToolbarFormatState]);
  const setReplyFontSize = useCallback((fontSize: number) => {
    replyEditorControllerRef.current?.applyFontSizeValue(fontSize);
    syncReplyToolbarFormatState();
  }, [syncReplyToolbarFormatState]);
  const toggleReplyInlineFormat = useCallback((command: "bold" | "underline") => {
    replyEditorControllerRef.current?.toggleInlineFormat(command);
    syncReplyToolbarFormatState();
  }, [syncReplyToolbarFormatState]);
  const changeReplyOutlineStyle = useCallback((nextOutlineStyle: EditorOutlineStyleID) => {
    setReplyOutlineStyle(nextOutlineStyle);
    setReplyToolbarTab("outline-styles");
  }, []);

  const showConversationHeader = loading || Boolean(error) || Boolean(message && !inlineExpansion);
  const replyDockVisible = Boolean(message && replyTargetMessage);
  const conversationGridRows = inlineExpansion
    ? replyDockVisible
      ? (showConversationHeader ? "auto minmax(0, 1fr) auto" : "minmax(0, 1fr) auto")
      : (showConversationHeader ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)")
    : replyDockVisible
      ? (showConversationHeader ? "auto minmax(0, 1fr) auto" : "minmax(0, 1fr) auto")
      : (showConversationHeader ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)");

  return (
    <>
      <div style={{ position: "relative", height: "100%", minHeight: 0, display: "grid", gridTemplateRows: conversationGridRows, gap: inlineExpansion ? 0 : 8, padding: inlineExpansion ? (replyDockVisible ? 0 : "0 0 8px") : 9, color: surfaceText, overflow: "hidden", boxSizing: "border-box" }}>
        {showConversationHeader && (
          <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
            {loading && <div style={{ padding: "6px 4px", color: accent, fontSize: 12, fontWeight: 900 }}>Loading</div>}
            {error && <div style={{ border: "1px solid rgba(185,28,28,0.24)", borderRadius: 10, background: "rgba(254,242,242,0.86)", color: "#991b1b", padding: "7px 9px", fontSize: 11, fontWeight: 850 }}>{error}</div>}
            {!inlineExpansion && message && (
              <div style={{ minWidth: 0, overflowWrap: "anywhere", padding: "0 4px", color: surfaceText, fontSize: 13.5, fontWeight: 900 }}>
                {message.subject || "(no subject)"}
              </div>
            )}
          </div>
        )}
        {message ? (
          <div
            ref={bodyRef}
            className="editor-document-scroll"
            onPointerDown={() => setSelectionDraft(null)}
            onPointerUp={captureEmailSelection}
            style={{
              position: "relative",
              minHeight: 0,
              border: inlineExpansion ? 0 : `1px solid ${strokeColor}`,
              borderRadius: inlineExpansion ? 0 : 8,
              background: "#ffffff",
              overflow: "auto",
              maxHeight: inlineExpansion && !replyDockVisible ? "min(520px, 52vh)" : undefined,
              color: "#111827",
              padding: inlineExpansion ? "0 10px" : "0 14px",
              boxShadow: inlineExpansion ? "none" : "inset 1px 1px 0 rgba(255,255,255,0.86)",
              ["--editor-document-scroll-accent" as string]: accent,
              ["--editor-document-scroll-track" as string]: "transparent",
            }}
          >
            {displayThreadMessages.map((threadMessage, index) => {
              const threadMessageID = threadMessage.id || messageID;
              const isSelectedMessage = threadMessage.id === message.id;
              const hideInlineMessageChrome = inlineExpansion && isSelectedMessage;
              const threadBody = isSelectedMessage ? selectedEmailBodyText : emailBodyText(threadMessage.body || threadMessage.snippet || "");
              const fromLine = formatAddressList(threadMessage.from) || "Unknown sender";
              const toLine = formatAddressList(threadMessage.to) || "Me";
              const isReplyTarget = replyTargetMessage?.id === threadMessage.id;
              const relativeTime = formatEmailRelativeTime(threadMessage.date);
              return (
                <div
                  key={threadMessage.id || `${index}`}
                  style={{
                    position: "relative",
                    display: "grid",
                    gap: inlineExpansion ? 3 : 5,
                    margin: "0 -8px",
                    padding: hideInlineMessageChrome ? "0 8px 5px" : inlineExpansion ? "8px 8px 9px" : "14px 8px 16px",
                    borderTop: index === 0 ? "none" : `1px solid ${ruleColor}`,
                    borderRadius: 10,
                    background: "transparent",
                    boxShadow: isReplyTarget && !hideInlineMessageChrome ? "0 0 0 2px rgba(124,58,237,0.22), 0 0 0 3px rgba(6,182,212,0.24)" : undefined,
                    transition: "box-shadow 140ms ease",
                  }}
                >
                  {!hideInlineMessageChrome && (
                    <>
                      <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", alignItems: "start", gap: 8 }}>
                        <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: surfaceText, fontSize: 12, fontWeight: 900 }}>
                          {fromLine}
                        </div>
                        <div style={{ flex: "0 0 auto", color: "rgba(100,116,139,0.78)", fontSize: 10.5, fontWeight: 750, whiteSpace: "nowrap" }}>
                          {formatTimestamp(threadMessage.date)}{relativeTime ? ` (${relativeTime})` : ""}
                        </div>
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => selectReplyTarget(threadMessage)}
                          style={{
                            minHeight: 22,
                            border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                            borderRadius: 7,
                            background: EDITOR_NEU_SURFACE,
                            color: accent,
                            cursor: editable ? "pointer" : "default",
                            opacity: editable ? 1 : 0.46,
                            padding: "0 8px",
                            fontSize: 10.5,
                            fontWeight: 900,
                            letterSpacing: 0,
                            boxShadow: "2px 2px 6px rgba(174,174,192,0.14), -2px -2px 6px rgba(255,255,255,0.78)",
                          }}
                        >
                          Reply
                        </button>
                      </div>
                      <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.82)", fontSize: 10.5, fontWeight: 700 }}>
                        to {toLine}
                      </div>
                    </>
                  )}
                  {useRichEmailBody ? (
                    <iframe
                      title={`Email body ${index + 1}`}
                      sandbox="allow-same-origin"
                      srcDoc={messageDocument(threadMessage.body || threadMessage.snippet || "", inlineExpansion)}
                      onLoad={(event) => updateBodyFrameHeight(threadMessage.id || `${index}`, event.currentTarget)}
                      style={{
                        width: "100%",
                        height: bodyFrameHeights[threadMessage.id || `${index}`] ?? (inlineExpansion ? 64 : 420),
                        border: inlineExpansion ? 0 : `1px solid ${strokeColor}`,
                        borderRadius: inlineExpansion ? 0 : 8,
                        background: "#ffffff",
                        boxSizing: "border-box",
                      }}
                    />
                  ) : (
                    <div
                      ref={isSelectedMessage ? selectedEmailBodyRef : undefined}
                      {...{ [EMAIL_BODY_MESSAGE_ID_ATTRIBUTE]: threadMessageID }}
                      style={{
                        marginTop: 7,
                        color: "#111827",
                        cursor: "text",
                        fontSize: 13.5,
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        userSelect: "text",
                      }}
                    >
                      {renderEmailTextWithHighlights(
                        threadBody || "(empty email)",
                        emailHighlightsByMessageID[threadMessageID] ?? [],
                        activeSelection?.messageID === threadMessageID ? activeSelection : null
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {canUseEmailSelection && selectionDraft && (
              <div
                role="toolbar"
                aria-label="Email selection actions"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                style={{
                  position: "absolute",
                  left: selectionDraft.x,
                  top: selectionDraft.y,
                  zIndex: 4,
                  display: "grid",
                  gridTemplateColumns: `repeat(${selectionActionCount}, ${EMAIL_SELECTION_ACTION_BUTTON_SIZE}px)`,
                  gridAutoRows: `${EMAIL_SELECTION_ACTION_BUTTON_SIZE}px`,
                  alignItems: "center",
                  justifyContent: "start",
                  gap: EMAIL_SELECTION_ACTION_GAP,
                  width: selectionActionToolbarWidth,
                  minHeight: selectionActionToolbarHeight,
                  padding: EMAIL_SELECTION_ACTION_PADDING,
                  border: "1px solid transparent",
                  borderRadius: 10,
                  background: `${EDITOR_NEU_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
                  boxShadow: EDITOR_NEU_SHADOW,
                  boxSizing: "border-box",
                }}
              >
                {onSelectionChatRequest && (
                  <button
                    type="button"
                    title="Chat about selection"
                    aria-label="Chat about selection"
                    onClick={(event) => {
                      event.stopPropagation();
                      addEmailLocalHighlight(selectionDraft);
                      onSelectionChatRequest(selectionDraft);
                      setSelectionDraft(null);
                      bodyRef.current?.ownerDocument.getSelection()?.removeAllRanges();
                    }}
                    style={{ ...emailSelectionActionButtonStyle, color: accent }}
                  >
                    <EmailSelectionActionIconFrame>
                      <ChatIcon color={accent} />
                    </EmailSelectionActionIconFrame>
                  </button>
                )}
                {onSelectionNodeRequest && (
                  <button
                    type="button"
                    title="Create node from selection"
                    aria-label="Create node from selection"
                    onClick={(event) => {
                      event.stopPropagation();
                      addEmailLocalHighlight(selectionDraft);
                      onSelectionNodeRequest(selectionDraft);
                      setSelectionDraft(null);
                      bodyRef.current?.ownerDocument.getSelection()?.removeAllRanges();
                    }}
                    style={{ ...emailSelectionActionButtonStyle, color: accent }}
                  >
                    <EmailSelectionActionIconFrame>
                      <EmailSelectionCreateNodeIcon color={accent} />
                    </EmailSelectionActionIconFrame>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div aria-hidden="true" style={{ minHeight: 0 }} />
        )}
        {message && replyTargetMessage && (
          <div
            style={{
              position: "relative",
              zIndex: 2,
              display: "grid",
              gap: 7,
              margin: inlineExpansion ? "0 -10px" : 0,
              borderTop: `1px solid ${ruleColor}`,
              borderRadius: inlineExpansion ? "0 0 10px 10px" : 0,
              background: EDITOR_NEU_ACTIVE_SURFACE,
              padding: "8px 10px 10px",
              boxShadow: "0 -10px 18px rgba(248,250,252,0.92)",
              boxSizing: "border-box",
            }}
          >
            {!inlineExpansion && (
              <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.82)", fontSize: 10.5, fontWeight: 800 }}>
                Replying to {formatAddressList(replyTargetMessage.from) || "Unknown sender"} - {formatTimestamp(replyTargetMessage.date)}{formatEmailRelativeTime(replyTargetMessage.date) ? ` (${formatEmailRelativeTime(replyTargetMessage.date)})` : ""}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "42px minmax(0, 1fr)", gap: 6, alignItems: "center", color: surfaceText, fontSize: 10.5, fontWeight: 850 }}>
              <span>To:</span>
              <input value={toDraft} disabled={!editable} onChange={(event) => setToDraft(event.currentTarget.value)} style={{ minWidth: 0, minHeight: 28, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: "#ffffff", color: surfaceText, outline: "none", padding: "0 8px", fontSize: 11.5, fontWeight: 700, boxShadow: "inset 1px 1px 4px rgba(174,174,192,0.12)" }} />
              <span>Subject:</span>
              <input value={subjectDraft} disabled={!editable} onChange={(event) => setSubjectDraft(event.currentTarget.value)} style={{ minWidth: 0, minHeight: 28, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 7, background: "#ffffff", color: surfaceText, outline: "none", padding: "0 8px", fontSize: 11.5, fontWeight: 700, boxShadow: "inset 1px 1px 4px rgba(174,174,192,0.12)" }} />
            </div>
            {draftAttachments.length > 0 && (
              <DraftAttachmentList
                attachments={draftAttachments}
                surfaceText={surfaceText}
                strokeColor={strokeColor}
                onRemove={removeEmailDraftAttachment}
                onPreviewImage={setPreviewAttachment}
              />
            )}
            <div style={{ position: "relative", display: "grid", gridTemplateColumns: "32px minmax(0, 1fr) 32px", alignItems: "end", gap: 6 }}>
            <button
              type="button"
              aria-label="Add attachment"
              title="Add attachment"
              disabled={!editable}
              onClick={() => fileInputRef.current?.click()}
              style={{ width: 32, height: 32, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 9, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", cursor: editable ? "pointer" : "default", opacity: editable ? 1 : 0.46, boxShadow: EDITOR_NEU_SHADOW }}
            >
              <PlusIcon color={accent} />
            </button>
            <div style={{ minWidth: 0, display: "grid", gap: 5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                <EditorTabBar
                  activeTab={replyToolbarTab}
                  outlineStyle={replyOutlineStyle}
                  accent={accent}
                  strokeColor={strokeColor}
                  surfaceText={surfaceText}
                  tabBackground={EDITOR_NEU_SURFACE}
                  tabSelectedBackground={EDITOR_NEU_ACTIVE_SURFACE}
                  outlineMenuAccent={accent}
                  onSelectTab={setReplyToolbarTab}
                  onAdjustSelectionFontSize={adjustReplyFontSize}
                  documentFontSize={replySelectionFontSize}
                  onSetSelectionFontSize={setReplyFontSize}
                  boldActive={replySelectionInlineFormat.bold}
                  underlineActive={replySelectionInlineFormat.underline}
                  onToggleBold={() => toggleReplyInlineFormat("bold")}
                  onToggleUnderline={() => toggleReplyInlineFormat("underline")}
                  onOutlineStyleFocus={() => setReplyToolbarTab("outline-styles")}
                  onOutlineStyleChange={changeReplyOutlineStyle}
                  reserveHeaderOffset={false}
                  visibleTabIDs={ATTACHED_EMAIL_REPLY_EDITOR_TAB_IDS}
                  disabled={!editable}
                />
              </div>
              <UnifiedRichEditorSurface
                value={bodyDraft}
                editable={editable}
                outlineStyle={replyOutlineStyle}
                surfaceID="attached-email-reply"
                ariaLabel="Reply body"
                placeholder="Write a reply"
                surfaceText={surfaceText}
                accent={accent}
                indentGuideColor={strokeColor}
                formattingControllerRef={replyEditorControllerRef}
                style={{ width: "100%", height: replyEditorHeight, minHeight: 78, maxHeight: 260, resize: editable ? "vertical" : "none", overflowY: "auto", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, outline: "none", padding: "7px 8px", color: surfaceText, background: EDITOR_NEU_ACTIVE_SURFACE, fontSize: 12, lineHeight: 1.35, letterSpacing: 0, caretColor: editable ? surfaceText : "transparent", cursor: editable ? "text" : "default", boxSizing: "border-box", boxShadow: "inset 2px 2px 6px rgba(174,174,192,0.18), inset -2px -2px 6px rgba(255,255,255,0.82)" }}
                onSelectionFontSizeChange={setReplySelectionFontSize}
                onSelectionInlineFormatChange={setReplySelectionInlineFormat}
                onEditorImageAttachmentError={(message) => {
                  setError(message);
                  onError(message);
                }}
                onChange={setBodyDraft}
              />
            </div>
            <button
              type="button"
              aria-label={sending ? "Sending" : "Send reply"}
              title={sending ? "Sending" : "Send reply"}
              disabled={!canSend}
              onClick={submitReply}
              style={{ width: 32, height: 32, border: canSend ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: canSend ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: accent, borderRadius: 9, display: "grid", placeItems: "center", cursor: canSend ? "pointer" : "default", opacity: canSend ? 1 : 0.44, boxShadow: EDITOR_NEU_SHADOW }}
            >
              <ArrowRightIcon color={accent} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              tabIndex={-1}
              disabled={!editable}
              style={{ display: "none" }}
              onChange={(event) => {
                if (event.currentTarget.files) addEmailDraftAttachments(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </div>
      )}
    </div>
    {previewAttachment && (
      <ImageAttachmentPreviewModal
        attachment={previewAttachment}
        surfaceText={surfaceText}
        strokeColor={strokeColor}
        onClose={() => setPreviewAttachment(null)}
      />
    )}
    </>
  );
};

type EmailPickerModalProps = {
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  onClose: () => void;
  onAttach: (message: EmailMessage) => void;
};

export const EmailPickerModal: React.FC<EmailPickerModalProps> = ({ accent, surfaceText, panelBackground, strokeColor, onClose, onAttach }) => {
  const [mailbox, setMailbox] = useState<EmailMailbox>("primary");
  const [query, setQuery] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [nextPageToken, setNextPageToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const requestSeqRef = useRef(0);
  const prefetchedPageRef = useRef<EmailPickerPrefetchedPage | null>(null);
  const prefetchPromiseRef = useRef<Promise<void> | null>(null);
  const prefetchFilterKeyRef = useRef("");
  const prefetchPageTokenRef = useRef("");
  const filterKey = useMemo(() => `${mailbox}\n${query.trim()}\n${unreadOnly ? "1" : "0"}`, [mailbox, query, unreadOnly]);
  const filterKeyRef = useRef(filterKey);
  const nextPageTokenRef = useRef(nextPageToken);
  const loadingRef = useRef(loading);
  const loadingMoreRef = useRef(loadingMore);

  useEffect(() => {
    filterKeyRef.current = filterKey;
  }, [filterKey]);

  useEffect(() => {
    nextPageTokenRef.current = nextPageToken;
  }, [nextPageToken]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  const clearPrefetchedPage = useCallback(() => {
    prefetchedPageRef.current = null;
    prefetchPromiseRef.current = null;
    prefetchFilterKeyRef.current = "";
    prefetchPageTokenRef.current = "";
  }, []);

  const appendMessagePage = useCallback((page: MessagePage) => {
    setMessages((current) => {
      const seen = new Set(current.map((message) => message.id));
      const next = [...current];
      for (const message of page.messages ?? []) {
        if (!message.id || seen.has(message.id)) continue;
        seen.add(message.id);
        next.push(message);
      }
      return next;
    });
    const nextToken = page.next_page_token ?? "";
    nextPageTokenRef.current = nextToken;
    setNextPageToken(nextToken);
    return nextToken;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const requestSeq = requestSeqRef.current + 1;
      requestSeqRef.current = requestSeq;
      loadingRef.current = true;
      loadingMoreRef.current = false;
      setLoading(true);
      setLoadingMore(false);
      setError("");
      setMessages([]);
      nextPageTokenRef.current = "";
      setNextPageToken("");
      clearPrefetchedPage();
      void listEmailMessages({ mailbox, limit: EMAIL_PICKER_MESSAGE_BATCH_SIZE, q: query.trim() || undefined, unread: unreadOnly || undefined })
        .then((page) => {
          if (cancelled || requestSeqRef.current !== requestSeq) return;
          setMessages(page.messages ?? []);
          const nextToken = page.next_page_token ?? "";
          nextPageTokenRef.current = nextToken;
          setNextPageToken(nextToken);
        })
        .catch((cause) => {
          if (!cancelled && requestSeqRef.current === requestSeq) setError(cause instanceof Error ? cause.message : "failed_to_load_email");
        })
        .finally(() => {
          if (!cancelled && requestSeqRef.current === requestSeq) {
            loadingRef.current = false;
            setLoading(false);
          }
        });
    }, query.trim() ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [clearPrefetchedPage, mailbox, query, unreadOnly]);

  const appendPrefetchedPage = useCallback((pageToken: string): string | null => {
    const prefetched = prefetchedPageRef.current;
    if (!prefetched || prefetched.filterKey !== filterKeyRef.current || prefetched.pageToken !== pageToken) return null;
    prefetchedPageRef.current = null;
    prefetchPromiseRef.current = null;
    prefetchFilterKeyRef.current = "";
    prefetchPageTokenRef.current = "";
    return appendMessagePage(prefetched.page);
  }, [appendMessagePage]);

  const prefetchNextMessagePage = useCallback(async (explicitPageToken?: string) => {
    if (loadingRef.current || loadingMoreRef.current) return;
    const pageToken = (explicitPageToken ?? nextPageTokenRef.current).trim();
    if (!pageToken) return;
    const requestFilterKey = filterKeyRef.current;
    const prefetched = prefetchedPageRef.current;
    if (prefetched?.filterKey === requestFilterKey && prefetched.pageToken === pageToken) return;
    if (prefetchPromiseRef.current && prefetchFilterKeyRef.current === requestFilterKey && prefetchPageTokenRef.current === pageToken) return;
    prefetchFilterKeyRef.current = requestFilterKey;
    prefetchPageTokenRef.current = pageToken;
    const request = listEmailMessages({
      mailbox,
      limit: EMAIL_PICKER_MESSAGE_BATCH_SIZE,
      pageToken,
      q: query.trim() || undefined,
      unread: unreadOnly || undefined,
    })
      .then((page) => {
        if (filterKeyRef.current !== requestFilterKey || nextPageTokenRef.current !== pageToken) return;
        prefetchedPageRef.current = { filterKey: requestFilterKey, pageToken, page };
      })
      .catch(() => undefined)
      .finally(() => {
        if (prefetchPromiseRef.current === request) {
          prefetchPromiseRef.current = null;
          prefetchFilterKeyRef.current = "";
          prefetchPageTokenRef.current = "";
        }
      });
    prefetchPromiseRef.current = request;
    await request;
  }, [mailbox, query, unreadOnly]);

  const loadMoreMessages = useCallback(async () => {
    if (loadingRef.current || loadingMoreRef.current) return;
    const pageToken = nextPageTokenRef.current.trim();
    if (!pageToken) return;
    const appendedNextToken = appendPrefetchedPage(pageToken);
    if (appendedNextToken !== null) {
      window.setTimeout(() => {
        if (appendedNextToken) void prefetchNextMessagePage(appendedNextToken);
      }, 0);
      return;
    }
    const requestFilterKey = filterKeyRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError("");
    try {
      if (prefetchPromiseRef.current && prefetchFilterKeyRef.current === requestFilterKey && prefetchPageTokenRef.current === pageToken) {
        await prefetchPromiseRef.current;
        const prefetchedNextToken = appendPrefetchedPage(pageToken);
        if (prefetchedNextToken !== null) {
          window.setTimeout(() => {
            if (prefetchedNextToken) void prefetchNextMessagePage(prefetchedNextToken);
          }, 0);
          return;
        }
      }
      const page = await listEmailMessages({
        mailbox,
        limit: EMAIL_PICKER_MESSAGE_BATCH_SIZE,
        pageToken,
        q: query.trim() || undefined,
        unread: unreadOnly || undefined,
      });
      if (filterKeyRef.current !== requestFilterKey || nextPageTokenRef.current !== pageToken) return;
      const nextToken = appendMessagePage(page);
      window.setTimeout(() => {
        if (nextToken) void prefetchNextMessagePage(nextToken);
      }, 0);
    } catch (cause) {
      if (filterKeyRef.current === requestFilterKey) setError(cause instanceof Error ? cause.message : "failed_to_load_email");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [appendMessagePage, appendPrefetchedPage, mailbox, prefetchNextMessagePage, query, unreadOnly]);

  const emailPickerWithinPrefetchDistance = useCallback((): boolean => {
    const list = messageListRef.current;
    if (!list) return false;
    const remaining = list.scrollHeight - list.scrollTop - list.clientHeight;
    return remaining < EMAIL_PICKER_APPROX_ROW_HEIGHT * EMAIL_PICKER_PREFETCH_REMAINING_ROWS;
  }, []);

  const handleMessageListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remaining < EMAIL_PICKER_APPROX_ROW_HEIGHT * EMAIL_PICKER_PREFETCH_REMAINING_ROWS) void prefetchNextMessagePage();
    if (remaining < EMAIL_PICKER_APPROX_ROW_HEIGHT * 2) void loadMoreMessages();
  }, [loadMoreMessages, prefetchNextMessagePage]);

  useEffect(() => {
    if (loading || !nextPageToken) return;
    window.setTimeout(() => {
      const list = messageListRef.current;
      if (!list) return;
      if (emailPickerWithinPrefetchDistance()) void prefetchNextMessagePage();
      if (list.scrollHeight <= list.clientHeight + (EMAIL_PICKER_APPROX_ROW_HEIGHT * 2)) void loadMoreMessages();
    }, 0);
  }, [emailPickerWithinPrefetchDistance, loadMoreMessages, loading, messages.length, nextPageToken, prefetchNextMessagePage]);

  const mailboxTabs: Array<{ mailbox: EmailMailbox; label: string }> = [
    { mailbox: "primary", label: "Inbox" },
    { mailbox: "starred", label: "Starred" },
    { mailbox: "all", label: "All" },
    { mailbox: "sent", label: "Sent" },
  ];
  const unreadCount = messages.filter((message) => message.unread).length;

  const tabButtonStyle = (active: boolean): React.CSSProperties => ({
    minWidth: 0,
    minHeight: 34,
    border: active ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
    borderRadius: 10,
    background: active ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
    color: active ? "#111827" : surfaceText,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    cursor: "pointer",
    padding: "0 10px",
    fontSize: 11.5,
    fontWeight: 850,
    letterSpacing: 0,
    whiteSpace: "nowrap",
    boxShadow: active ? `${EDITOR_NEU_SHADOW}, inset 1px 1px 0 rgba(255,255,255,0.78)` : EDITOR_NEU_SHADOW,
  });

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setQuery(searchDraft.trim());
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 140, background: "rgba(17, 24, 39, 0.32)", display: "grid", placeItems: "center", padding: 18 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={{ width: "min(620px, 100%)", height: "min(760px, 92vh)", display: "grid", gridTemplateRows: "auto 1fr", border: `1px solid ${strokeColor}`, borderRadius: 12, background: panelBackground, color: surfaceText, boxShadow: "0 18px 48px rgba(0,0,0,0.24)", overflow: "hidden" }}>
        <div style={{ display: "grid", gap: 8, padding: 12, borderBottom: `1px solid ${strokeColor}`, background: panelBackground }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center" }}>
            <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7, color: surfaceText }}>
              <MailIcon color={accent} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 950 }}>My Triage</span>
            </div>
            <button type="button" onClick={onClose} style={{ width: 32, height: 32, border: `1px solid ${strokeColor}`, borderRadius: 9, background: "#ffffff", color: surfaceText, cursor: "pointer", fontSize: 18, lineHeight: 1, boxShadow: EDITOR_NEU_SHADOW }}>
            x
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
            {mailboxTabs.map((tab) => (
              <button
                key={tab.mailbox}
                type="button"
                style={tabButtonStyle(mailbox === tab.mailbox)}
                onClick={() => {
                  setMailbox(tab.mailbox);
                }}
              >
                {tab.label}
                {mailbox === tab.mailbox && messages.length > 0 && (
                  <span style={{ minWidth: 18, height: 18, display: "inline-grid", placeItems: "center", borderRadius: 9, padding: "0 5px", border: "1px solid rgba(148,163,184,0.18)", background: "#ffffff", color: "#334155", fontSize: 10, fontWeight: 850 }}>
                    {messages.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <form style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 76px", gap: 6 }} onSubmit={submitSearch}>
            <input
              autoFocus
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.currentTarget.value)}
              placeholder="Search mail"
              style={{ minWidth: 0, height: 34, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, padding: "0 10px", outline: "none", color: surfaceText, background: "#ffffff", fontSize: 12, letterSpacing: 0, boxShadow: "inset 1px 1px 4px rgba(174,174,192,0.12)" }}
            />
            <button type="submit" style={tabButtonStyle(false)}>Search</button>
          </form>
          <div style={{ minWidth: 0, minHeight: 24, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 10, padding: "0 2px" }}>
            <span style={{ minWidth: 0, color: "rgba(15,23,42,0.58)", fontSize: 11, fontWeight: 800 }}>{unreadOnly ? "Unread only" : `${unreadCount} unread`}</span>
            <label style={{ display: "flex", alignItems: "center", gap: 7, color: surfaceText, fontSize: 11, fontWeight: 700 }}>
              <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.currentTarget.checked)} />
              <span>Unread only</span>
            </label>
          </div>
        </div>
        <div
          ref={messageListRef}
          className="editor-document-scroll"
          onScroll={handleMessageListScroll}
          style={{ overflowY: "auto", minHeight: 220, padding: 10, display: "grid", alignContent: "start", gap: 8, ["--editor-document-scroll-accent" as string]: accent, ["--editor-document-scroll-track" as string]: "transparent" }}
        >
          {error && <div style={{ padding: 10, border: "1px solid rgba(185,28,28,0.24)", borderRadius: 10, background: "rgba(254,242,242,0.9)", color: "#991b1b", fontSize: 12, fontWeight: 800 }}>{error}</div>}
          <>
            {loading && <div style={{ padding: 12, color: surfaceText, opacity: 0.68, fontSize: 12, fontWeight: 700 }}>Loading</div>}
            {!loading && !error && messages.length === 0 && <div style={{ padding: 12, color: surfaceText, opacity: 0.68, fontSize: 12, fontWeight: 700 }}>No email</div>}
            {messages.map((message) => (
                <button
                  key={message.id}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(EMAIL_DRAG_MIME, JSON.stringify(messageAttachmentPayload(message)));
                  }}
                  onClick={() => onAttach(message)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "18px minmax(0, 1fr) auto",
                    gap: 8,
                    alignItems: "center",
                    width: "100%",
                    minWidth: 0,
                    textAlign: "left",
                    border: message.unread ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                    borderRadius: 10,
                    background: message.unread ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : "#ffffff",
                    color: surfaceText,
                    padding: "9px 10px",
                    cursor: "grab",
                    boxShadow: message.unread ? "0 8px 18px rgba(15,23,42,0.10), inset 1px 1px 0 rgba(255,255,255,0.86)" : EDITOR_NEU_SHADOW,
                  }}
                >
                  <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 999, background: message.unread ? accent : "rgba(148,163,184,0.34)", boxShadow: message.unread ? "0 0 0 4px rgba(6,182,212,0.10)" : undefined }} />
                  <span style={{ minWidth: 0, display: "grid", gap: 3 }}>
                    <span style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center" }}>
                      <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 900 }}>{formatAddressList(message.from) || "Unknown sender"}</strong>
                      <span style={{ color: "rgba(15,23,42,0.62)", fontSize: 10.5, fontWeight: 780, whiteSpace: "nowrap" }}>{formatTimestamp(message.date, "day")}</span>
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 850 }}>{message.subject || "(no subject)"}</span>
                    {message.snippet && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.78)", fontSize: 11, fontWeight: 650 }}>{message.snippet}</span>}
                  </span>
                  <span style={{ width: 34, height: 34, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: EDITOR_NEU_SURFACE, color: accent, display: "grid", placeItems: "center", boxShadow: EDITOR_NEU_SHADOW }}>
                    <PaperclipIcon color={accent} />
                  </span>
                </button>
              ))}
              {loadingMore && <div style={{ padding: 10, color: surfaceText, opacity: 0.68, fontSize: 11, fontWeight: 800, textAlign: "center" }}>Loading more</div>}
          </>
        </div>
      </div>
    </div>
  );
};

function messageDocument(body: string, compact = false): string {
  const value = body.trim();
  const content = /<\/?[a-z][\s\S]*>/i.test(value) ? value : `<pre>${escapeHTML(value)}</pre>`;
  const padding = compact ? "6px 0 2px" : "14px";
  return `<!doctype html><html><head><meta charset="utf-8"><style>html{margin:0;padding:0}body{font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#111;margin:0;padding:${padding};overflow-wrap:anywhere}pre{white-space:pre-wrap;font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;margin:0}p{margin-top:0}</style></head><body>${content}</body></html>`;
}

function escapeHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unifiedRichEditorBodyToEmailHTML(value: string): string {
  if (!value.trim()) return "";
  const html = value.startsWith(EDITOR_RICH_TEXT_PREFIX)
    ? value.slice(EDITOR_RICH_TEXT_PREFIX.length)
    : linkifyEditorPlainTextToHTML(value);
  return sanitizeEditorDocumentHTML(html);
}
