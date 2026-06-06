import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getEmailMessage, listEmailMessages, sendEmail, type EmailAddress, type EmailMessage } from "../communications/communicationsApi";
import { canDeleteEditorTextBlockChatMessage, type EditorAttachedEmail, type EditorChatAttachment, type EditorTextBlockChatMessage } from "./editorProjection";
import { createEditorDocumentUndoHistory, resetEditorDocumentUndoHistory } from "./editorUndoHistory";
import { createEditorScrollMemory } from "./editorScroll";
import { EDITOR_TAB_TEXT, type EditorOutlineStyleID } from "./plainTextEditing";
import { buildEditorIndentGuideSegments, editorIndentGuideLeftForDepth, type EditorIndentGuideSegment } from "./editorIndentGuides";
import { deserializeEditorDocumentHTML, readEditorDocumentText, serializeEditorDocumentHTML } from "./richTextEditing";
import { resolveEditorTextBlockChatAnchorRanges } from "./editorTextBlockChatHighlights";
import { useEditorDocumentSurfaceHandlers } from "./useEditorDocumentSurfaceHandlers";
import { getEditorDocumentFontFamily } from "./useEditorPreferences";
import {
  createStandaloneImageClipboardHTML,
  findEditorImageFrame,
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
  PlusIcon,
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
  onDelete: () => void;
};

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
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            style={{ ...menuItemStyle, color: "#334155" }}
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
  onConfirm: () => void;
  onCancel: () => void;
};

export const DeleteTextBlockConfirmationModal: React.FC<DeleteTextBlockConfirmationModalProps> = ({
  title,
  chatCount,
  accent,
  surfaceText,
  panelBackground,
  ruleColor,
  onConfirm,
  onCancel,
}) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 120, display: "grid", placeItems: "center" }}>
    <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: `1px solid ${ruleColor}`, background: panelBackground, color: surfaceText, padding: 12, display: "grid", gap: 10, boxShadow: "0 18px 44px rgba(0,0,0,0.20)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0 }}>
        Are you sure you want to delete this?
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.35, color: surfaceText, opacity: 0.72 }}>
        This removes "{title}" from the middle column{chatCount > 0 ? ` and deletes ${chatCount} chat repl${chatCount === 1 ? "y" : "ies"} attached to it` : ""}.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button type="button" onClick={onConfirm} style={{ minHeight: 28, border: `1px solid ${accent}`, background: "#ffffff", color: "#111111", cursor: "pointer", fontWeight: 700 }}>
          Yes
        </button>
        <button type="button" onClick={onCancel} style={{ minHeight: 28, border: "1px solid #64748b", boxShadow: "inset 0 0 0 1px rgba(100,116,139,0.25), 0 0 10px rgba(100,116,139,0.18)", color: "#334155", background: "#ffffff", cursor: "pointer", fontWeight: 700 }}>
          No
        </button>
      </div>
    </div>
  </div>
);

type NodeTextBlockEditorProps = {
  blockID: string;
  editable: boolean;
  nodeID: string;
  companyID: string;
  currentUserID: string;
  companyUsers: MentionableCompanyUser[];
  documentValue: string;
  contentChanges: NodeContentChange[];
  chatMessages: EditorTextBlockChatMessage[];
  activeChatAnchorMessageID: string;
  chatNavigationRequest: { anchorMessageID: string; requestID: number } | null;
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
  companyID,
  currentUserID,
  companyUsers,
  documentValue,
  contentChanges,
  chatMessages,
  activeChatAnchorMessageID,
  chatNavigationRequest,
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
  const lastAppliedDocumentRef = useRef("");
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

  useEffect(() => {
    const element = editorRef.current;
    if (!element) return;
    const nextHTML = deserializeEditorDocumentHTML(documentValue);
    const targetChanged = loadedDocumentTargetKeyRef.current !== documentTargetKey;
    if (!targetChanged && documentValue === lastAppliedDocumentRef.current) return;
    if (!targetChanged) {
      const currentDocument = serializeEditorDocumentHTML(element);
      if (documentValue === currentDocument) {
        lastAppliedDocumentRef.current = documentValue;
        return;
      }
      if (editorHasFocus(element)) return;
    }
    element.innerHTML = nextHTML;
    resetEditorDocumentUndoHistory(documentUndoHistoryRef.current);
    lastAppliedDocumentRef.current = documentValue;
    loadedDocumentTargetKeyRef.current = documentTargetKey;
  }, [documentTargetKey, documentValue]);

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

  const handlers = useEditorDocumentSurfaceHandlers({
    restoringScrollRef,
    currentDocumentTargetKeyRef: targetKeyRef,
    scrollMemoryRef,
    documentUndoHistoryRef,
    pendingEditorFontSizeRef: pendingFontSizeRef,
    outlineStyle,
    setDocumentScrollTop,
    scheduleDocumentSave: (nextDocument, immediate = false) => {
      if (!editable) return;
      lastAppliedDocumentRef.current = nextDocument;
      onDocumentChange(nextDocument);
      if (immediate) onDocumentFlush(nextDocument);
    },
    scheduleIndentGuideUpdate: scheduleTextBlockIndentGuideUpdate,
    rememberCurrentDocumentScroll: () => undefined,
    flushPendingDocumentSave: (fallbackDocument) => {
      if (!editable) return;
      const nextDocument = fallbackDocument ?? (editorRef.current ? serializeEditorDocumentHTML(editorRef.current) : lastAppliedDocumentRef.current);
      lastAppliedDocumentRef.current = nextDocument;
      onDocumentFlush(nextDocument);
    },
    onSelectionFontSizeChange: () => undefined,
    mentionUsers: companyUsers,
    mentionAccent: accent,
    mentionSurfaceText: surfaceText,
    mentionStrokeColor: indentGuideColor,
    mentionMenuPosition: "absolute",
  });
  const { mentionMenu: documentMentionMenu, ...documentSurfaceHandlers } = handlers;

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
                background: rect.active ? "linear-gradient(135deg, rgba(254, 240, 138, 0.76), rgba(253, 224, 71, 0.66))" : "linear-gradient(135deg, rgba(254, 240, 138, 0.54), rgba(253, 224, 71, 0.42))",
                boxShadow: rect.active ? "0 0 0 1px rgba(202,138,4,0.56), 0 0 16px rgba(250,204,21,0.30)" : "none",
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
          if (editable) onFocus();
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
  messages: EditorTextBlockChatMessage[];
  emailPane?: React.ReactNode;
  emailCount?: number;
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
  onAttachFiles: (files: FileList | File[]) => void;
  onRemoveDraftAttachment: (attachmentID: string) => void;
  onSubmit: () => void;
};

export const ChatPane: React.FC<ChatPaneProps> = ({
  blockID,
  editable,
  messages,
  emailPane,
  emailCount = 0,
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
  const lineCount = Math.min(5, Math.max(1, draft.split(/\r\n|\r|\n/).length));
  const composerHeight = 34 + ((lineCount - 1) * 17);
  const canSubmit = editable && (draft.trim().length > 0 || draftAttachments.length > 0);
  const [height, setHeight] = useState(() => readStoredChatPaneHeight(heightStorageKey));
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

  useEffect(() => {
    if (!activeMessageID) return;
    const frame = window.requestAnimationFrame(() => {
      messageListRef.current
        ?.querySelector<HTMLElement>(`[data-node-chat-message-id="${activeMessageID}"]`)
        ?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeMessageID, messages]);

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
    const insert = `@${mentionUserDisplayName(user)} `;
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
                <span>{messages.length}</span>
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
                <span>{emailCount}</span>
              </button>
            </>
          ) : (
            <>
              <ChatIcon color={active ? accent : "rgba(100,116,139,0.85)"} />
              <span>{messages.length}</span>
            </>
          )}
        </div>
        {showingEmail ? (
          <div className="editor-document-scroll" style={{ minHeight: 0, overflowY: "auto", overflowX: "hidden", ["--editor-document-scroll-accent" as string]: accent, ["--editor-document-scroll-track" as string]: "transparent" }}>
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
            <div style={{ border: "1px solid rgba(92,238,255,0.34)", borderLeft: `3px solid ${accent}`, borderRadius: 9, background: "linear-gradient(135deg, rgba(230,252,255,0.58), rgba(247,239,255,0.58))", color: surfaceText, padding: "6px 7px", fontSize: 10, lineHeight: 1.35, fontWeight: 800, overflowWrap: "anywhere", maxHeight: 72, overflowY: "auto", boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.82)" }}>
              {selectionAnchor.quote}
            </div>
          )}
          {draftAttachments.length > 0 && (
            <DraftAttachmentList
              attachments={draftAttachments}
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
              rows={lineCount}
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
              style={{ width: "100%", height: composerHeight, minHeight: 34, maxHeight: 102, resize: "none", overflowY: lineCount >= 5 ? "auto" : "hidden", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, outline: "none", padding: "7px 8px", color: surfaceText, background: EDITOR_NEU_ACTIVE_SURFACE, fontSize: 12, lineHeight: 1.35, letterSpacing: 0, caretColor: editable ? surfaceText : "transparent", cursor: editable ? "text" : "default", boxShadow: "inset 2px 2px 6px rgba(174,174,192,0.18), inset -2px -2px 6px rgba(255,255,255,0.82)" }}
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

const ChatThreadItem: React.FC<ChatThreadItemProps> = ({ node, depth, isLastSibling, currentUserID, editable, activeMessageID, companyUsers, accent, surfaceText, ruleColor, collapsedThreadIDs, onToggleCollapse, onActivate, onNavigate, onReply, onDelete, onPreviewImage }) => {
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
        {message.attachments.length > 0 && <ChatAttachmentList attachments={message.attachments} surfaceText={surfaceText} strokeColor={ruleColor} onPreviewImage={onPreviewImage} />}
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
  surfaceText: string;
  strokeColor: string;
  onPreviewImage: (attachment: EditorChatAttachment) => void;
};

const ChatAttachmentList: React.FC<ChatAttachmentListProps> = ({ attachments, surfaceText, strokeColor, onPreviewImage }) => (
  <div style={{ minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5 }}>
    {attachments.map((attachment) => {
      const image = isImageAttachment(attachment);
      const content = (
        <>
          <AttachmentThumb attachment={attachment} />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
          <span style={{ flex: "0 0 auto", opacity: 0.58 }}>{formatFileSize(attachment.size)}</span>
        </>
      );
      const style: React.CSSProperties = {
        maxWidth: "100%",
        minHeight: 30,
        display: "inline-grid",
        gridTemplateColumns: "24px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 6,
        border: `1px solid ${strokeColor}`,
        borderRadius: 6,
        background: "#ffffff",
        color: surfaceText,
        padding: "3px 6px",
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0,
        textDecoration: "none",
      };
      if (image) {
        return (
          <button
            key={attachment.id}
            type="button"
            data-mango-copyable-image="true"
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
            onClick={() => onPreviewImage(attachment)}
            style={{ ...style, cursor: "pointer" }}
          >
            {content}
          </button>
        );
      }
      return attachment.dataURL ? (
        <a key={attachment.id} href={attachment.dataURL} download={attachment.name} style={style}>
          {content}
        </a>
      ) : (
        <span key={attachment.id} style={style}>{content}</span>
      );
    })}
  </div>
);

type DraftAttachmentListProps = {
  attachments: EditorChatAttachment[];
  surfaceText: string;
  strokeColor: string;
  onRemove: (attachmentID: string) => void;
  onPreviewImage: (attachment: EditorChatAttachment) => void;
};

const DraftAttachmentList: React.FC<DraftAttachmentListProps> = ({ attachments, surfaceText, strokeColor, onRemove, onPreviewImage }) => (
  <div style={{ minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5 }}>
    {attachments.map((attachment) => (
      <span key={attachment.id} style={{ maxWidth: "100%", minHeight: 30, display: "inline-grid", gridTemplateColumns: "24px minmax(0, 1fr) auto 18px", alignItems: "center", gap: 5, border: `1px solid ${strokeColor}`, borderRadius: 6, background: "#ffffff", color: surfaceText, padding: "3px 4px 3px 5px", fontSize: 10, fontWeight: 800, letterSpacing: 0 }}>
        <button
          type="button"
          data-mango-copyable-image={isImageAttachment(attachment) ? "true" : undefined}
          aria-label={isImageAttachment(attachment) ? `Preview ${attachment.name}` : attachment.name}
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
          onClick={() => { if (isImageAttachment(attachment)) onPreviewImage(attachment); }}
          style={{ width: 24, height: 24, border: "none", background: "transparent", padding: 0, cursor: isImageAttachment(attachment) ? "pointer" : "default" }}
        >
          <AttachmentThumb attachment={attachment} />
        </button>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
        <span style={{ flex: "0 0 auto", opacity: 0.58 }}>{formatFileSize(attachment.size)}</span>
        <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => onRemove(attachment.id)} style={{ width: 18, height: 18, border: "none", borderRadius: 4, background: "transparent", color: surfaceText, cursor: "pointer", fontSize: 12, fontWeight: 800, lineHeight: 1 }}>
          x
        </button>
      </span>
    ))}
  </div>
);

const AttachmentThumb: React.FC<{ attachment: EditorChatAttachment }> = ({ attachment }) => {
  if (isImageAttachment(attachment)) {
    return <img alt="" src={attachment.dataURL} style={{ width: 24, height: 24, borderRadius: 4, objectFit: "cover", display: "block", border: "1px solid rgba(17,17,17,0.12)" }} />;
  }
  return (
    <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 4, border: "1px solid rgba(17,17,17,0.14)", background: "rgba(100,116,139,0.10)", display: "grid", placeItems: "center", color: "rgba(15,23,42,0.78)", fontSize: 8, fontWeight: 900 }}>
      FILE
    </span>
  );
};

type ImageAttachmentPreviewModalProps = {
  attachment: EditorChatAttachment;
  surfaceText: string;
  strokeColor: string;
  onClose: () => void;
};

const ImageAttachmentPreviewModal: React.FC<ImageAttachmentPreviewModalProps> = ({ attachment, surfaceText, strokeColor, onClose }) => {
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
          <img alt={attachment.name} src={attachment.dataURL} style={{ maxWidth: "100%", maxHeight: "78vh", objectFit: "contain", display: "block" }} />
        </div>
      </div>
    </div>
  );
};

type AttachedEmailsPanelProps = {
  emails: EditorAttachedEmail[];
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  onOpenEmail: (messageID: string) => void;
};

export const AttachedEmailsPanel: React.FC<AttachedEmailsPanelProps> = ({ emails, accent, surfaceText, panelBackground: _panelBackground, strokeColor, onOpenEmail }) => (
  <div style={{ minWidth: 0, display: "grid", gap: 7, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 14, background: EDITOR_NEU_SURFACE, padding: 8, maxHeight: 260, overflowY: "auto", boxShadow: EDITOR_NEU_SHADOW }}>
    <div style={{ display: "flex", alignItems: "center", gap: 7, color: surfaceText, fontSize: 11, fontWeight: 800 }}>
      <MailIcon color={accent} />
      <span>{emails.length}</span>
    </div>
    {emails.map((email) => (
      <button key={email.id} type="button" title={email.subject} onClick={() => onOpenEmail(email.messageID)} style={{ display: "grid", gap: 2, minWidth: 0, border: 0, borderTop: `1px solid ${strokeColor}`, padding: "7px 0 0", background: "transparent", textAlign: "left", cursor: "pointer" }}>
        <div style={{ color: surfaceText, fontSize: 11, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email.subject}</div>
        <div style={{ color: surfaceText, opacity: 0.62, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email.from || formatTimestamp(email.date)}</div>
      </button>
    ))}
  </div>
);

type EmailCountDropdownProps = {
  emails: EditorAttachedEmail[];
  accent: string;
  surfaceText: string;
  align?: "left" | "right";
  compact?: boolean;
  onOpenEmail: (messageID: string) => void;
};

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

type EmailConversationPaneProps = {
  messageID: string;
  companyID: string;
  editable: boolean;
  accent: string;
  surfaceText: string;
  strokeColor: string;
  ruleColor: string;
  onError: (message: string) => void;
};

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

function messageTextSummary(message: EmailMessage): string {
  const body = (message.body || message.snippet || "").trim();
  if (!body) return "";
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const EmailConversationPane: React.FC<EmailConversationPaneProps> = ({
  messageID,
  companyID,
  editable,
  accent,
  surfaceText,
  strokeColor,
  ruleColor,
  onError,
}) => {
  const [message, setMessage] = useState<EmailMessage | null>(null);
  const [sentReplies, setSentReplies] = useState<EmailMessage[]>([]);
  const [toDraft, setToDraft] = useState("");
  const [subjectDraft, setSubjectDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setMessage(null);
    setSentReplies([]);
    void getEmailMessage(messageID, companyID)
      .then((payload) => {
        if (cancelled) return;
        setMessage(payload);
        setSentReplies(payload.local_replies ?? []);
        setToDraft(formatAddressList(payload.reply_to?.length ? payload.reply_to : payload.from));
        setSubjectDraft(replySubject(payload.subject));
        setBodyDraft("");
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "failed_to_load_email");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyID, messageID]);

  const recipients = parseEmailAddressDraft(toDraft);
  const canSend = editable && !sending && Boolean(message) && recipients.length > 0 && subjectDraft.trim() && bodyDraft.trim();

  const submitReply = () => {
    if (!message || !canSend) return;
    setSending(true);
    void sendEmail({
      to: recipients,
      subject: subjectDraft.trim(),
      body: bodyDraft.trim(),
      reply_to_message_id: message.id,
      company_id: companyID,
    })
      .then((sent) => {
        const sentWithTimestamp = sent.date ? sent : { ...sent, date: Math.floor(Date.now() / 1000) };
        setSentReplies((current) => [...current, sentWithTimestamp]);
        setBodyDraft("");
      })
      .catch((cause) => {
        const nextError = cause instanceof Error ? cause.message : "failed_to_send_email";
        setError(nextError);
        onError(nextError);
      })
      .finally(() => setSending(false));
  };

  return (
    <div style={{ minHeight: 0, display: "grid", gap: 9, padding: 9, color: surfaceText }}>
      {loading && <div style={{ padding: 10, color: accent, fontSize: 12, fontWeight: 900 }}>Loading</div>}
      {error && <div style={{ border: "1px solid rgba(185,28,28,0.24)", borderRadius: 10, background: "rgba(254,242,242,0.86)", color: "#991b1b", padding: "7px 9px", fontSize: 11, fontWeight: 850 }}>{error}</div>}
      {message && (
        <>
          <div style={{ display: "grid", gap: 4, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 12, background: EDITOR_NEU_SURFACE, padding: 8, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86), 2px 2px 8px rgba(174,174,192,0.12), -2px -2px 8px rgba(255,255,255,0.76)" }}>
            <div style={{ minWidth: 0, overflowWrap: "anywhere", fontSize: 13, fontWeight: 900 }}>{message.subject || "(no subject)"}</div>
            <div style={{ minWidth: 0, display: "grid", gap: 2, color: "rgba(100,116,139,0.88)", fontSize: 10.5, fontWeight: 750 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>From: {formatAddressList(message.from) || "Unknown sender"}</div>
              <div>Received: {formatTimestamp(message.date)}</div>
            </div>
          </div>
          <div style={{ minHeight: 320, height: "min(54vh, 460px)", border: `1px solid ${strokeColor}`, borderRadius: 12, background: "#ffffff", overflow: "hidden", boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86)" }}>
            <iframe title="Attached email body" sandbox="" srcDoc={messageDocument(message.body || message.snippet || "")} style={{ width: "100%", height: "100%", minHeight: 320, border: 0, background: "#ffffff" }} />
          </div>
          <div style={{ display: "grid", gap: 7, border: `1px solid ${ruleColor}`, borderRadius: 12, background: EDITOR_NEU_ACTIVE_SURFACE, padding: 8, boxShadow: "inset 2px 2px 6px rgba(174,174,192,0.16), inset -2px -2px 6px rgba(255,255,255,0.82)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "42px minmax(0, 1fr)", gap: 6, alignItems: "center", color: surfaceText, fontSize: 10.5, fontWeight: 850 }}>
              <span>To:</span>
              <input value={toDraft} disabled={!editable} onChange={(event) => setToDraft(event.currentTarget.value)} style={{ minWidth: 0, minHeight: 28, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 9, background: "#ffffff", color: surfaceText, outline: "none", padding: "0 8px", fontSize: 11.5, fontWeight: 700, boxShadow: "inset 1px 1px 4px rgba(174,174,192,0.12)" }} />
              <span>Subject:</span>
              <input value={subjectDraft} disabled={!editable} onChange={(event) => setSubjectDraft(event.currentTarget.value)} style={{ minWidth: 0, minHeight: 28, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 9, background: "#ffffff", color: surfaceText, outline: "none", padding: "0 8px", fontSize: 11.5, fontWeight: 700, boxShadow: "inset 1px 1px 4px rgba(174,174,192,0.12)" }} />
            </div>
            <textarea
              value={bodyDraft}
              disabled={!editable}
              rows={3}
              placeholder="Write a reply"
              onChange={(event) => setBodyDraft(event.currentTarget.value)}
              style={{ width: "100%", minHeight: 86, resize: "vertical", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: "#ffffff", color: surfaceText, outline: "none", padding: "8px 9px", fontSize: 12, lineHeight: 1.38, letterSpacing: 0, boxShadow: "inset 1px 1px 5px rgba(174,174,192,0.14)" }}
            />
            <button
              type="button"
              disabled={!canSend}
              onClick={submitReply}
              style={{
                justifySelf: "end",
                minHeight: 30,
                border: canSend ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                borderRadius: 9,
                background: canSend ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
                color: accent,
                cursor: canSend ? "pointer" : "default",
                opacity: canSend ? 1 : 0.48,
                padding: "0 12px",
                fontSize: 11.5,
                fontWeight: 900,
                letterSpacing: 0,
                boxShadow: EDITOR_NEU_SHADOW,
              }}
            >
              {sending ? "Sending" : "Send reply"}
            </button>
          </div>
          <div style={{ display: "grid", gap: 7, paddingBottom: 4 }}>
            {sentReplies.map((reply) => (
              <div key={reply.id} style={{ display: "grid", gap: 5, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 12, background: "linear-gradient(135deg, rgba(255,255,255,0.94), rgba(230,252,255,0.42) 52%, rgba(247,239,255,0.48))", padding: 8, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86), 2px 2px 8px rgba(174,174,192,0.12), -2px -2px 8px rgba(255,255,255,0.76)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, minWidth: 0, fontSize: 10.5, fontWeight: 900 }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: accent }}>Sent reply</span>
                  <span style={{ flex: "0 0 auto", color: "rgba(100,116,139,0.78)" }}>{formatTimestamp(reply.date)}</span>
                </div>
                <div style={{ display: "grid", gap: 2, color: "rgba(100,116,139,0.88)", fontSize: 10, fontWeight: 750 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>From: {formatAddressList(reply.from) || "Me"}</div>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Send to: {formatAddressList(reply.to) || toDraft}</div>
                </div>
                <div style={{ color: surfaceText, fontSize: 12, lineHeight: 1.38, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{messageTextSummary(reply) || reply.body || bodyDraft}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
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
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      setLoading(true);
      setError("");
      void listEmailMessages({ mailbox: "primary", limit: 30, q: query.trim() || undefined })
        .then((page) => {
          if (!cancelled) setMessages(page.messages ?? []);
        })
        .catch((cause) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : "failed_to_load_email");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, query.trim() ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 140, background: "rgba(17, 24, 39, 0.32)", display: "grid", placeItems: "center", padding: 18 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={{ width: "min(560px, 100%)", maxHeight: "min(680px, 92%)", display: "grid", gridTemplateRows: "auto 1fr", border: `1px solid ${strokeColor}`, borderRadius: 8, background: "#ffffff", color: surfaceText, boxShadow: "0 18px 48px rgba(0,0,0,0.24)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", padding: 12, borderBottom: `1px solid ${strokeColor}`, background: panelBackground }}>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search email"
            style={{ minWidth: 0, height: 32, border: `1px solid ${strokeColor}`, borderRadius: 6, padding: "0 10px", outline: "none", color: surfaceText, fontSize: 13, letterSpacing: 0 }}
          />
          <button type="button" onClick={onClose} style={{ width: 32, height: 32, border: `1px solid ${strokeColor}`, borderRadius: 6, background: "#ffffff", color: surfaceText, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>
            x
          </button>
        </div>
        <div className="editor-document-scroll" style={{ overflowY: "auto", minHeight: 220, padding: 10, display: "grid", alignContent: "start", gap: 8, ["--editor-document-scroll-accent" as string]: accent, ["--editor-document-scroll-track" as string]: "transparent" }}>
          {loading && <div style={{ padding: 12, color: surfaceText, opacity: 0.68, fontSize: 12, fontWeight: 700 }}>Loading</div>}
          {error && <div style={{ padding: 12, color: "#b00020", fontSize: 12, fontWeight: 700 }}>{error}</div>}
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
              style={{ display: "grid", gap: 4, width: "100%", minWidth: 0, textAlign: "left", border: `1px solid ${strokeColor}`, borderRadius: 8, background: "#ffffff", color: surfaceText, padding: "9px 10px", cursor: "grab" }}
            >
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 800 }}>{message.subject || "(no subject)"}</span>
                <span style={{ color: accent, fontSize: 10, fontWeight: 800, flex: "0 0 auto" }}>{formatTimestamp(message.date, "day")}</span>
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, opacity: 0.68 }}>{formatAddressList(message.from)}</span>
              {message.snippet && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, opacity: 0.72 }}>{message.snippet}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

type EmailDetailModalProps = {
  messageID: string;
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  onClose: () => void;
};

export const EmailDetailModal: React.FC<EmailDetailModalProps> = ({ messageID, accent, surfaceText, panelBackground, strokeColor, onClose }) => {
  const [message, setMessage] = useState<EmailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void getEmailMessage(messageID)
      .then((payload) => {
        if (!cancelled) setMessage(payload);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "failed_to_load_email");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [messageID]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 142, background: "rgba(17, 24, 39, 0.32)", display: "grid", placeItems: "center", padding: 18 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={{ width: "min(720px, 100%)", maxHeight: "min(760px, 92%)", display: "grid", gridTemplateRows: "auto auto minmax(260px, 1fr)", border: `1px solid ${strokeColor}`, borderRadius: 8, background: "#ffffff", color: surfaceText, boxShadow: "0 18px 48px rgba(0,0,0,0.24)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "start", padding: 12, borderBottom: `1px solid ${strokeColor}`, background: panelBackground }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: surfaceText, fontSize: 15, fontWeight: 800, overflowWrap: "anywhere" }}>{message?.subject || "(no subject)"}</div>
            <div style={{ marginTop: 4, color: surfaceText, opacity: 0.64, fontSize: 11, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {message ? `${formatAddressList(message.from) || "Unknown sender"}${message.date ? ` - ${formatTimestamp(message.date)}` : ""}` : "Email"}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ width: 32, height: 32, border: `1px solid ${strokeColor}`, borderRadius: 6, background: "#ffffff", color: surfaceText, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>
            x
          </button>
        </div>
        {(loading || error) && (
          <div style={{ padding: "9px 12px", borderBottom: `1px solid ${strokeColor}`, color: error ? "#334155" : accent, fontSize: 12, fontWeight: 800 }}>
            {error || "Loading"}
          </div>
        )}
        <iframe title="Attached email body" sandbox="" srcDoc={messageDocument(message?.body || message?.snippet || "")} style={{ width: "100%", height: "100%", minHeight: 320, border: 0, background: "#ffffff" }} />
      </div>
    </div>
  );
};

function messageDocument(body: string): string {
  const value = body.trim();
  const content = /<\/?[a-z][\s\S]*>/i.test(value) ? value : `<pre>${escapeHTML(value)}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#111;margin:0;padding:14px;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif}</style></head><body>${content}</body></html>`;
}

function escapeHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
