import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorImagePreviewModal } from "./EditorImagePreviewModal.js";
import {
  downloadMangoAttachment,
  fetchMangoAttachmentBlob,
  fileFromDataURL,
  importRemoteMangoImageAttachment,
  linkMangoResourceAttachment,
  loadMangoAttachmentObjectURL,
  uploadMangoAttachment,
  type AttachmentRequestJSON,
  type MangoAttachmentResourceType,
} from "../attachments/attachmentApi";
import { withPreparedEditorAttachmentResource, type EditorAttachmentMutationLifecycle } from "./editorAttachmentPreparation";
import type { EditorDocumentSurfaceProps } from "./EditorDocumentSurface";
import type { EditorScrollMemory } from "./editorScroll";
import {
  EDITOR_TAB_TEXT,
  deleteEditorBackspaceText,
  insertAutomaticOutlineFirstText,
  insertEditorEnterText,
  insertEditorTabText,
  toggleAutomaticOutlineNumberingText,
  type EditorOutlineStyleID,
  type EditorTabDirection,
} from "./plainTextEditing";
import {
  EDITOR_CHECKLIST_CHECKED_ATTRIBUTE,
  EDITOR_LIST_ATTRIBUTE,
  EDITOR_LIST_ITEM_ATTRIBUTE,
  EDITOR_ORDERED_LIST_ATTRIBUTE,
  EDITOR_LINK_COLOR,
  EDITOR_TABLE_ATTRIBUTE,
  EDITOR_TABLE_ALIGNMENT_CONTROL_ATTRIBUTE,
  EDITOR_TABLE_CELL_ATTRIBUTE,
  EDITOR_TABLE_COLUMNS_ATTRIBUTE,
  EDITOR_TABLE_HEADER_ATTRIBUTE,
  EDITOR_TABLE_MAX_COLUMNS,
  EDITOR_TABLE_MAX_ROWS,
  applyEditorListMarkerStyles,
  applyEditorTableColumnWidths,
  applyEditorTableLayout,
  applyEditorTableTextAlign,
  ensureEditorTableAlignmentControls,
  EDITOR_TERMINAL_BREAK_ATTRIBUTE,
  EDITOR_IMAGE_CLEAR_BREAK_ATTRIBUTE,
  createEditorTableElement,
  deserializeEditorDocumentHTML,
  getEditorLinkHrefForText,
  readEditorTextAlign,
  linkifyEditorPlainTextToHTML,
  readEditorTableColumnWidths,
  readEditorTableOffsetPercent,
  readEditorTableTextAlign,
  readEditorTableWidthPercent,
  readEditorListKind,
  mapEditorSelectedTextRunOffsets,
  readEditorDocumentText,
  normalizeEditorHighlightColor,
  normalizeEditorHighlightSpans,
  readEditorElementHighlight,
  removeEditorElementHighlight,
  sanitizeEditorDocumentHTML,
  setEditorElementHighlight,
  serializeEditorDocumentHTML,
  type EditorHighlightColor,
  type EditorListKind,
  type EditorTextAlignment,
} from "./richTextEditing";
import {
  classifyEditorInputType,
  recordEditorDocumentUndoChange,
  redoEditorDocument,
  snapshotEditorDocumentHTML,
  undoEditorDocument,
  type EditorDocumentChangeKind,
  type EditorDocumentUndoHistory,
  type EditorDocumentUndoSnapshot,
} from "./editorUndoHistory";
import { EditorNativeInputBatcher, type PendingEditorNativeInputBatch } from "./editorInputBatch";
import {
  EDITOR_DOCUMENT_FONT_SIZE_PX,
  EDITOR_DOCUMENT_MAX_FONT_SIZE_PX,
  EDITOR_DOCUMENT_MIN_FONT_SIZE_PX,
} from "./useEditorPreferences";
import {
  buildMentionOptions,
  createEditorMentionElement,
  EDITOR_MENTION_ATTRIBUTE,
  mentionUserDisplayName,
  mentionUserOptionLabel,
  mentionUserProfileColor,
  readActiveMentionDraft,
  type ActiveMentionDraft,
  type MentionableCompanyUser,
} from "./editorMentions";
import {
  EDITOR_IMAGE_NODE_ATTRIBUTE,
  DEFAULT_EDITOR_IMAGE_MARGIN_TOP_PX,
  EDITOR_IMAGE_MAX_WIDTH_INSET_PX,
  applyEditorImageFloatLayout,
  clampEditorImageOffset,
  clampEditorImageSize,
  clampEditorImageVerticalOffset,
  clearEditorImageSelection,
  createEditorImageClipboardHTML,
  createEditorImageDataFromFile,
  createEditorImageDataFromSource,
  editorAttachmentImageSource,
  editorAttachmentIDFromImageSource,
  createEditorImageFrame,
  editorClipboardHTMLContainsOnlyOneImage,
  estimateEditorDocumentBytes,
  findEditorImageFrame,
  getEditorImageCursorForInteraction,
  getEditorImageFloatSideForVisualLeft,
  getEditorImageHorizontalLimit,
  getEditorImageInlineOffsetForVisualLeft,
  getEditorImagePointerInteraction,
  getEditorImageStorageBudgetForDocumentBytes,
  readEditorImageAspectRatio,
  readEditorImageClipboardDataFromHTML,
  readEditorImageData,
  readEditorImageFloatSide,
  refreshEditorAttachmentImageFrames,
  getSelectedEditorImageFrame,
  selectEditorImageFrame,
  shouldUseEditorImageFileTransferShortcut,
  writeEditorImageToSystemClipboard,
  writeImageClipboardData,
  type EditorImageTransferHTMLKind,
  type EditorImageClipboardData,
  type EditorImageData,
} from "./editorImages";
import {
  countEditorRichClipboardImages,
  prepareEditorRichClipboardHTML,
  type EditorRichClipboardImageRequest,
} from "./editorRichClipboard";

export type { EditorTextAlignment } from "./richTextEditing";

export type EditorDocumentSurfaceHandlers = Pick<
  EditorDocumentSurfaceProps,
  | "onBeforeInput"
  | "onPaste"
  | "onCopy"
  | "onCut"
  | "onDrop"
  | "onInput"
  | "onCompositionStart"
  | "onCompositionEnd"
  | "onSelect"
  | "onClick"
  | "onDoubleClick"
  | "onContextMenu"
  | "onPointerDown"
  | "onPointerMove"
  | "onKeyUp"
  | "onBlur"
  | "onScroll"
  | "onWheel"
  | "onKeyDown"
>;

export type EditorDocumentSurfaceHandlerResult = EditorDocumentSurfaceHandlers & {
  mentionMenu: React.ReactNode;
  insertTable: (root?: HTMLElement | null) => boolean;
  restoreSelection: (root: HTMLElement) => boolean;
  flushPendingInput: (root?: HTMLElement | null) => string | undefined;
};

type UseEditorDocumentSurfaceHandlersOptions = {
  restoringScrollRef: React.MutableRefObject<boolean>;
  currentDocumentTargetKeyRef: React.MutableRefObject<string>;
  scrollMemoryRef: React.MutableRefObject<EditorScrollMemory>;
  documentUndoHistoryRef: React.MutableRefObject<EditorDocumentUndoHistory>;
  pendingEditorFontSizeRef: React.MutableRefObject<number | null>;
  pendingEditorHighlightColorRef: React.MutableRefObject<EditorHighlightColor | null | undefined>;
  pendingEditorInlineFormatRef: React.MutableRefObject<EditorSelectionInlineFormatState | null>;
  pendingEditorTypingCaretRef: React.MutableRefObject<EditorTypingCaretBookmark | null>;
  outlineStyle: EditorOutlineStyleID;
  setDocumentScrollTop: React.Dispatch<React.SetStateAction<number>>;
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
  scheduleIndentGuideUpdate: (text: string) => void;
  rememberCurrentDocumentScroll: () => void;
  flushPendingDocumentSave: (fallbackText?: string) => void;
  onSelectionFontSizeChange: (fontSize: number) => void;
  onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void;
  onSelectionHighlightColorChange?: (color: EditorHighlightColor | null) => void;
  onSelectionTextAlignmentChange?: (alignment: EditorTextAlignment) => void;
  mentionUsers?: MentionableCompanyUser[];
  mentionAccent?: string;
  mentionSurfaceText?: string;
  mentionStrokeColor?: string;
  mentionMenuPosition?: "fixed" | "absolute";
  editorImageAttachmentContext?: EditorImageAttachmentContext;
  onEditorImageAttachmentError?: (message: string) => void;
};

export type EditorImageAttachmentContext = {
  requestJSON: AttachmentRequestJSON;
  apiBase: string;
  companyID: string;
  resourceType: MangoAttachmentResourceType;
  resourceID: string;
  informationID?: string;
  editorSurface?: string;
  prepareResource?: () => Promise<void>;
  onError?: (message: string) => void;
  mutationLifecycle?: EditorAttachmentMutationLifecycle;
};

export type EditorInlineStyleCommand = "bold" | "underline" | "italic" | "strikethrough";

export type EditorSelectionInlineFormatState = {
  bold: boolean;
  underline: boolean;
  italic: boolean;
  strikethrough: boolean;
};

export type EditorTypingCaretBookmark = {
  start: number;
  end: number;
  range: Range;
};

export type EditorSelectionFormatState = EditorSelectionInlineFormatState & {
  fontSize: number;
  highlightColor: EditorHighlightColor | null;
  textAlignment: EditorTextAlignment;
};
type EditorPendingTypingStyle = {
  fontSize?: number;
  highlightColor?: EditorHighlightColor | null;
  inlineFormat?: EditorSelectionInlineFormatState;
};


export type EditorDocumentFormattingController = {
  applyFontSizeValue: (fontSize: number) => boolean;
  adjustFontSize: (delta: number) => boolean;
  toggleInlineFormat: (command: EditorInlineStyleCommand) => boolean;
  applyHighlightColor: (color: EditorHighlightColor | null) => boolean;
  applyTextAlignment: (alignment: EditorTextAlignment) => boolean;
  insertLink: (href: string) => boolean;
  insertList: (kind: EditorListKind) => boolean;
  toggleNumberedList: () => boolean;
  indent: () => boolean;
  outdent: () => boolean;
  insertTable: () => boolean;
  readFormatState: () => EditorSelectionFormatState | null;
};

export type UseEditorDocumentFormattingControllerOptions = {
  editorRef: { readonly current: HTMLElement | null };
  editable: boolean;
  outlineStyle: EditorOutlineStyleID;
  documentUndoHistoryRef: React.MutableRefObject<EditorDocumentUndoHistory>;
  pendingEditorFontSizeRef: React.MutableRefObject<number | null>;
  pendingEditorHighlightColorRef: React.MutableRefObject<EditorHighlightColor | null | undefined>;
  pendingEditorInlineFormatRef: React.MutableRefObject<EditorSelectionInlineFormatState | null>;
  pendingEditorTypingCaretRef: React.MutableRefObject<EditorTypingCaretBookmark | null>;
  restoreSelection: (root: HTMLElement) => boolean;
  insertTable: (root?: HTMLElement | null) => boolean;
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
  scheduleIndentGuideUpdate: (text: string) => void;
  onSelectionFontSizeChange: (fontSize: number) => void;
  onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void;
  onSelectionHighlightColorChange?: (color: EditorHighlightColor | null) => void;
  onSelectionTextAlignmentChange?: (alignment: EditorTextAlignment) => void;
};

function clampEditorFontSize(value: number): number {
  return Math.max(EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, Math.min(EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, Math.round(value)));
}

const PENDING_TYPING_STYLE_CANCEL_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Backspace", "Delete", "End", "Home", "PageDown", "PageUp"]);
const EDITOR_MENTION_SELECTOR = `[${EDITOR_MENTION_ATTRIBUTE}="true"]`;

function rootContainsRange(root: HTMLElement, range: Range): boolean {
  const container = range.commonAncestorContainer;
  return container === root || root.contains(container);
}

function getEditorSelectionRange(root: HTMLElement): Range | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return rootContainsRange(root, range) ? range : null;
}

function getEditorRangeOffsets(root: HTMLElement, range: Range): { start: number; end: number } | null {
  if (!rootContainsRange(root, range)) return null;
  const startRange = range.cloneRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = range.cloneRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);
  return {
    start: startRange.toString().length,
    end: endRange.toString().length,
  };
}

export function getEditorSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const range = getEditorSelectionRange(root);
  return range ? getEditorRangeOffsets(root, range) : null;
}

function getEditorTypingCaretBookmark(root: HTMLElement): EditorTypingCaretBookmark | null {
  const range = getEditorSelectionRange(root);
  const offsets = range?.collapsed ? getEditorRangeOffsets(root, range) : null;
  return range && offsets ? { ...offsets, range: range.cloneRange() } : null;
}

function editorTypingCaretMatches(root: HTMLElement, bookmark: EditorTypingCaretBookmark): boolean {
  const range = getEditorSelectionRange(root);
  const offsets = range?.collapsed ? getEditorRangeOffsets(root, range) : null;
  if (!range || !offsets || offsets.start !== bookmark.start || offsets.end !== bookmark.end) return false;
  try {
    return range.compareBoundaryPoints(0, bookmark.range) === 0
      && range.compareBoundaryPoints(2, bookmark.range) === 0;
  } catch {
    return false;
  }
}

export function setEditorSelectionByOffsets(root: HTMLElement, start: number, end = start) {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  if (!selection) return;

  type Boundary = { container: Node; offset: number };
  const boundaryBesideNode = (node: Node, edge: "before" | "after"): Boundary => {
    const parent = node.parentNode ?? root;
    const index = Array.prototype.indexOf.call(parent.childNodes, node) as number;
    return { container: parent, offset: Math.max(0, index + (edge === "after" ? 1 : 0)) };
  };
  const locate = (requestedOffset: number, affinity: "start" | "end" | "nearest"): Boundary => {
    const target = Math.max(0, requestedOffset);
    let currentOffset = 0;
    let found: Boundary | null = null;
    const walk = (parent: Node) => {
      for (let index = 0; index < parent.childNodes.length && !found; index += 1) {
        const child = parent.childNodes.item(index);
        if (child instanceof HTMLElement && child.getAttribute(EDITOR_MENTION_ATTRIBUTE) === "true") {
          const length = child.textContent?.length ?? 0;
          const nextOffset = currentOffset + length;
          if (target <= currentOffset) found = boundaryBesideNode(child, "before");
          else if (target < nextOffset) {
            const edge = affinity === "start"
              ? "before"
              : affinity === "end" ? "after" : target - currentOffset < length / 2 ? "before" : "after";
            found = boundaryBesideNode(child, edge);
          } else if (target === nextOffset) {
            found = boundaryBesideNode(child, "after");
          }
          currentOffset = nextOffset;
          continue;
        }
        if (child.nodeType === Node.TEXT_NODE) {
          const length = child.textContent?.length ?? 0;
          if (target <= currentOffset + length) {
            found = { container: child, offset: Math.max(0, Math.min(length, target - currentOffset)) };
          }
          currentOffset += length;
          continue;
        }
        walk(child);
      }
    };
    walk(root);
    return found ?? { container: root, offset: root.childNodes.length };
  };

  const range = doc.createRange();
  const collapsed = start === end;
  const startBoundary = locate(start, collapsed ? "nearest" : "start");
  const endBoundary = collapsed ? startBoundary : locate(end, "end");
  range.setStart(startBoundary.container, startBoundary.offset);
  range.setEnd(endBoundary.container, endBoundary.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function removeEditorTerminalBreaks(root: HTMLElement) {
  root.querySelectorAll(`br[${EDITOR_TERMINAL_BREAK_ATTRIBUTE}="true"]`).forEach((node) => node.remove());
}

function replaceSelectionWithText(root: HTMLElement, text: string, options: { preserveTrailingNewline?: boolean } = {}): boolean {
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  removeEditorTerminalBreaks(root);
  const node = root.ownerDocument.createTextNode(text);
  range.deleteContents();
  range.insertNode(node);
  if (options.preserveTrailingNewline) {
    const terminalBreak = root.ownerDocument.createElement("br");
    terminalBreak.setAttribute(EDITOR_TERMINAL_BREAK_ATTRIBUTE, "true");
    node.after(terminalBreak);
  }
  range.setStart(node, node.data.length);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function setCollapsedSelectionInTextNode(root: HTMLElement, textNode: Text, offset: number) {
  const range = root.ownerDocument.createRange();
  range.setStart(textNode, Math.max(0, Math.min(textNode.data.length, offset)));
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function setEditorSelectionRange(root: HTMLElement, range: Range): boolean {
  if (!rootContainsRange(root, range)) return false;
  const selection = root.ownerDocument.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function selectElementContents(element: HTMLElement) {
  const selection = element.ownerDocument.getSelection();
  if (!selection) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getNodeTextOffsets(root: HTMLElement, node: Node): { start: number; end: number } | null {
  if (!root.contains(node)) return null;
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  try {
    range.setEndBefore(node);
  } catch {
    return null;
  }
  const start = range.toString().length;
  return { start, end: start + (node.textContent ?? "").length };
}

function breakEditorMentionsForInput(root: HTMLElement, inputType: string, undoBefore?: EditorDocumentUndoSnapshot): EditorDocumentUndoSnapshot | null {
  const range = getEditorSelectionRange(root);
  if (!range) return null;
  const startMention = closestMentionElement(root, range.startContainer);
  const endMention = closestMentionElement(root, range.endContainer);
  if (!startMention && !endMention) return null;
  const normalized = range.cloneRange();
  if (startMention) normalized.setStartBefore(startMention);
  if (endMention) normalized.setEndAfter(endMention);
  if (range.collapsed && startMention && startMention === endMention) {
    normalized.setStartBefore(startMention);
    normalized.collapse(true);
  }
  setEditorSelectionRange(root, normalized);
  // Normalizing an invalid legacy caret is not a document mutation. Keep the
  // optional snapshot parameter for existing callers, but never dissolve the
  // durable entity into ordinary text.
  void inputType;
  void undoBefore;
  return null;
}

function mentionAtTextBoundary(root: HTMLElement, offset: number, edge: "before" | "after"): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>(EDITOR_MENTION_SELECTOR)).find((mention) => {
    const bounds = getNodeTextOffsets(root, mention);
    return bounds ? offset === (edge === "before" ? bounds.start : bounds.end) : false;
  }) ?? null;
}

function setSelectionBesideMention(root: HTMLElement, mention: HTMLElement, edge: "before" | "after"): boolean {
  if (!root.contains(mention)) return false;
  const range = root.ownerDocument.createRange();
  if (edge === "before") range.setStartBefore(mention);
  else range.setStartAfter(mention);
  range.collapse(true);
  return setEditorSelectionRange(root, range);
}

function moveEditorSelectionAcrossMention(root: HTMLElement, direction: "backward" | "forward", extend: boolean): boolean {
  const range = getEditorSelectionRange(root);
  const offsets = range?.collapsed ? getEditorRangeOffsets(root, range) : null;
  if (!range || !offsets) return false;
  const mention = mentionAtTextBoundary(root, offsets.start, direction === "backward" ? "after" : "before");
  if (!mention) return false;
  if (!extend) return setSelectionBesideMention(root, mention, direction === "backward" ? "before" : "after");
  const selectionRange = root.ownerDocument.createRange();
  selectionRange.selectNode(mention);
  return setEditorSelectionRange(root, selectionRange);
}

function applyAtomicMentionKeyboardEdit(
  root: HTMLElement,
  edit: { kind: "deleteBackward" | "deleteForward" },
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
): boolean {
  const range = getEditorSelectionRange(root);
  const offsets = range ? getEditorRangeOffsets(root, range) : null;
  if (!range || !offsets) return false;
  const undoBefore = snapshotEditorDocumentRoot(root);
  if (!range.collapsed) {
    const mentions = Array.from(root.querySelectorAll<HTMLElement>(EDITOR_MENTION_SELECTOR)).filter((mention) => {
      try {
        return range.intersectsNode(mention);
      } catch {
        return false;
      }
    });
    if (mentions.length === 0) return false;
    const expanded = range.cloneRange();
    const startMention = closestMentionElement(root, expanded.startContainer);
    const endMention = closestMentionElement(root, expanded.endContainer);
    if (startMention) expanded.setStartBefore(startMention);
    if (endMention) expanded.setEndAfter(endMention);
    expanded.deleteContents();
    expanded.collapse(true);
    setEditorSelectionRange(root, expanded);
  } else {
    const mention = mentionAtTextBoundary(root, offsets.start, edit.kind === "deleteBackward" ? "after" : "before");
    if (!mention) return false;
    const parent = mention.parentNode;
    if (!parent) return false;
    const index = Array.prototype.indexOf.call(parent.childNodes, mention) as number;
    mention.remove();
    const nextRange = root.ownerDocument.createRange();
    nextRange.setStart(parent, Math.max(0, index));
    nextRange.collapse(true);
    setEditorSelectionRange(root, nextRange);
  }

  recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, "delete");
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
  return true;
}

function joinEditorLineBeforeMention(
  root: HTMLElement,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
): boolean {
  const range = getEditorSelectionRange(root);
  const offsets = range?.collapsed ? getEditorRangeOffsets(root, range) : null;
  if (!range || !offsets) return false;
  const mention = mentionAtTextBoundary(root, offsets.start, "before");
  if (!mention || getClosestEditorTableCell(root, mention)) return false;
  const undoBefore = snapshotEditorDocumentRoot(root);

  let block: HTMLElement | null = mention.parentElement;
  while (block && block !== root && block.tagName !== "LI" && block.tagName !== "DIV" && block.tagName !== "P") {
    block = block.parentElement;
  }
  if (block && block !== root) {
    const prefixRange = root.ownerDocument.createRange();
    prefixRange.setStart(block, 0);
    prefixRange.setEndBefore(mention);
    const prefix = prefixRange.cloneContents();
    const mentionStartsBlock = (prefix.textContent ?? "").length === 0 && !prefix.querySelector(
      `br,img,table,[${EDITOR_MENTION_ATTRIBUTE}="true"],[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"]`,
    );
    const previous = block.previousElementSibling;
    const compatiblePrevious = previous instanceof HTMLElement && (
      (block.tagName === "LI" && previous.tagName === "LI")
      || (block.tagName !== "LI" && (previous.tagName === "DIV" || previous.tagName === "P"))
    ) ? previous : null;
    if (compatiblePrevious && mentionStartsBlock) {
      if (
        compatiblePrevious.lastChild instanceof HTMLBRElement
        && (compatiblePrevious.textContent ?? "").length === 0
      ) compatiblePrevious.lastChild.remove();
      const joinOffset = compatiblePrevious.childNodes.length;
      while (block.firstChild) compatiblePrevious.appendChild(block.firstChild);
      block.remove();
      const nextRange = root.ownerDocument.createRange();
      nextRange.setStart(compatiblePrevious, joinOffset);
      nextRange.collapse(true);
      setEditorSelectionRange(root, nextRange);
      recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, "delete");
      commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
      return true;
    }
  }

  const currentText = readEditorDocumentText(root);
  if (offsets.start <= 0 || currentText.slice(offsets.start - 1, offsets.start) !== "\n") return false;
  if (!deleteTextByOffsets(root, offsets.start - 1, offsets.start, { preserveTrailingNewline: currentText.endsWith("\n") })) return false;
  recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, "delete");
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
  return true;
}



function replaceSelectionWithHTML(root: HTMLElement, html: string): boolean {
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = html;
  const fragment = template.content;
  if (replaceSelectionWithEditorListFragment(root, range, fragment)) return true;
  const lastChild = fragment.lastChild;
  range.deleteContents();
  range.insertNode(fragment);
  const lastAnchor = lastChild instanceof HTMLAnchorElement
    ? lastChild
    : (lastChild instanceof HTMLElement ? lastChild.querySelector("a[href]:last-of-type") as HTMLAnchorElement | null : null);
  if (lastAnchor?.lastChild) {
    range.setStart(lastAnchor.lastChild, lastAnchor.lastChild.textContent?.length ?? 0);
  } else if (lastChild) {
    range.setStartAfter(lastChild);
  }
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function isIgnorableEditorFragmentText(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim();
}

function editorFragmentMeaningfulChildren(fragment: DocumentFragment): Node[] {
  return Array.from(fragment.childNodes).filter((node) => !isIgnorableEditorFragmentText(node));
}

function editorFragmentRootLists(fragment: DocumentFragment): HTMLUListElement[] {
  const meaningfulChildren = editorFragmentMeaningfulChildren(fragment);
  if (meaningfulChildren.length === 0) return [];
  const lists = meaningfulChildren.filter((node): node is HTMLUListElement => (
    node instanceof HTMLUListElement && readEditorListKind(node.getAttribute(EDITOR_LIST_ATTRIBUTE)) !== null
  ));
  return lists.length === meaningfulChildren.length ? lists : [];
}

function insertEditorListItemsAfter(referenceItem: HTMLLIElement, items: HTMLLIElement[]) {
  let anchor: ChildNode = referenceItem;
  for (const item of items) {
    anchor.after(item);
    anchor = item;
  }
}

function insertEditorListItemsBefore(referenceItem: HTMLLIElement, items: HTMLLIElement[]) {
  const list = getEditorListForItem(referenceItem);
  if (!list) return;
  for (const item of items) list.insertBefore(item, referenceItem);
}

function replaceSelectionWithEditorListFragment(root: HTMLElement, range: Range, fragment: DocumentFragment): boolean {
  if (!range.collapsed) return false;
  const activeItem = getCurrentEditorListItem(root);
  const activeList = activeItem ? getEditorListForItem(activeItem) : null;
  const activeKind = getEditorListKindForList(activeList);
  if (!activeItem || !activeList || !activeKind) return false;

  const rootLists = editorFragmentRootLists(fragment);
  if (rootLists.length === 0) return false;
  if (rootLists.some((list) => readEditorListKind(list.getAttribute(EDITOR_LIST_ATTRIBUTE)) !== activeKind)) return false;

  const pastedItems = rootLists.flatMap((list) => (
    Array.from(list.children).filter((child): child is HTMLLIElement => child instanceof HTMLLIElement)
  ));
  if (pastedItems.length === 0) return false;

  removeEditorTerminalBreaks(root);
  if (pastedItems.length === 1 && !directNestedEditorList(pastedItems[0])) {
    const pastedItem = pastedItems[0];
    const inlineContent = root.ownerDocument.createDocumentFragment();
    while (pastedItem.firstChild) inlineContent.appendChild(pastedItem.firstChild);
    const lastInserted = inlineContent.lastChild;
    if (!lastInserted) return false;
    if (editorListItemContentIsEmpty(activeItem)) removeEditorListItemPlaceholders(activeItem);
    range.deleteContents();
    range.insertNode(inlineContent);
    range.setStartAfter(lastInserted);
    range.collapse(true);
    const selection = root.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }
  if (editorListItemContentIsEmpty(activeItem)) {
    insertEditorListItemsBefore(activeItem, pastedItems);
    activeItem.remove();
  } else {
    insertEditorListItemsAfter(activeItem, pastedItems);
  }

  selectEditorListItem(root, pastedItems[pastedItems.length - 1], "end");
  return true;
}

function getClosestEditorTableCell(root: HTMLElement, node: Node | EventTarget | null): HTMLTableCellElement | null {
  if (!node) return null;
  const element = node instanceof Element
    ? node
    : node instanceof Node ? node.parentElement : null;
  const cell = element?.closest?.(`[${EDITOR_TABLE_CELL_ATTRIBUTE}="true"],td,th`) ?? null;
  return cell instanceof HTMLTableCellElement && root.contains(cell) ? cell : null;
}

function getCurrentEditorTableCell(root: HTMLElement): HTMLTableCellElement | null {
  const range = getEditorSelectionRange(root);
  if (!range) return null;
  return getClosestEditorTableCell(root, range.startContainer)
    ?? getClosestEditorTableCell(root, range.endContainer)
    ?? getClosestEditorTableCell(root, range.commonAncestorContainer);
}

function getEditorTableForCell(root: HTMLElement, cell: HTMLTableCellElement | null): HTMLTableElement | null {
  const table = cell?.closest(`table[${EDITOR_TABLE_ATTRIBUTE}="true"],table`) ?? null;
  return table instanceof HTMLTableElement && root.contains(table) ? table : null;
}

function getClosestEditorTable(root: HTMLElement, node: Node | EventTarget | null): HTMLTableElement | null {
  const element = node instanceof Element
    ? node
    : node instanceof Node ? node.parentElement : null;
  const table = element?.closest?.(`table[${EDITOR_TABLE_ATTRIBUTE}="true"],table`) ?? null;
  return table instanceof HTMLTableElement && root.contains(table) ? table : null;
}

function getEditorTableRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.rows).filter((row): row is HTMLTableRowElement => row instanceof HTMLTableRowElement);
}

function getEditorTableCells(row: HTMLTableRowElement): HTMLTableCellElement[] {
  return Array.from(row.cells).filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement);
}

function getEditorTableColumnCount(table: HTMLTableElement): number {
  return Math.max(1, ...getEditorTableRows(table).map((row) => getEditorTableCells(row).length));
}

function updateEditorTableColumnAttribute(table: HTMLTableElement) {
  table.setAttribute(EDITOR_TABLE_ATTRIBUTE, "true");
  table.setAttribute(EDITOR_TABLE_COLUMNS_ATTRIBUTE, String(getEditorTableColumnCount(table)));
  const columns = getEditorTableColumnCount(table);
  applyEditorTableColumnWidths(table, readEditorTableColumnWidths(table, columns));
  applyEditorTableLayout(table, readEditorTableWidthPercent(table), readEditorTableOffsetPercent(table));
  applyEditorTableTextAlign(table, readEditorTableTextAlign(table));
}

function editorTableHeaderValue(rowIndex: number, columnIndex: number): "corner" | "column" | "row" | null {
  if (rowIndex === 0 && columnIndex === 0) return "corner";
  if (rowIndex === 0) return "column";
  if (columnIndex === 0) return "row";
  return null;
}

function createEmptyEditorTableCell(ownerDocument: Document, rowIndex: number, columnIndex: number): HTMLTableCellElement {
  const headerValue = editorTableHeaderValue(rowIndex, columnIndex);
  const cell = ownerDocument.createElement(headerValue ? "th" : "td") as HTMLTableCellElement;
  cell.setAttribute(EDITOR_TABLE_CELL_ATTRIBUTE, "true");
  if (headerValue) cell.setAttribute(EDITOR_TABLE_HEADER_ATTRIBUTE, headerValue);
  ensureEditorTableAlignmentControls(cell, rowIndex, columnIndex);
  cell.appendChild(ownerDocument.createElement("br"));
  return cell;
}

function createEmptyEditorTableRow(ownerDocument: Document, rowIndex: number, columns: number): HTMLTableRowElement {
  const row = ownerDocument.createElement("tr");
  for (let index = 0; index < Math.max(1, columns); index += 1) {
    row.appendChild(createEmptyEditorTableCell(ownerDocument, rowIndex, index));
  }
  return row;
}

function ensureEditorTableCellKind(cell: HTMLTableCellElement, rowIndex: number, columnIndex: number): HTMLTableCellElement {
  const headerValue = editorTableHeaderValue(rowIndex, columnIndex);
  const desiredTagName = headerValue ? "TH" : "TD";
  let nextCell = cell;
  if (cell.tagName !== desiredTagName) {
    nextCell = cell.ownerDocument.createElement(desiredTagName.toLowerCase()) as HTMLTableCellElement;
    while (cell.firstChild) nextCell.appendChild(cell.firstChild);
    Array.from(cell.attributes).forEach((attribute) => {
      if (attribute.name !== EDITOR_TABLE_HEADER_ATTRIBUTE) nextCell.setAttribute(attribute.name, attribute.value);
    });
    cell.replaceWith(nextCell);
  }
  nextCell.setAttribute(EDITOR_TABLE_CELL_ATTRIBUTE, "true");
  if (headerValue) nextCell.setAttribute(EDITOR_TABLE_HEADER_ATTRIBUTE, headerValue);
  else nextCell.removeAttribute(EDITOR_TABLE_HEADER_ATTRIBUTE);
  ensureEditorTableAlignmentControls(nextCell, rowIndex, columnIndex);
  if (nextCell.childNodes.length === 0) nextCell.appendChild(nextCell.ownerDocument.createElement("br"));
  return nextCell;
}

function normalizeEditorTable(table: HTMLTableElement) {
  const ownerDocument = table.ownerDocument;
  const body = table.tBodies[0] ?? table.createTBody();
  const rows = getEditorTableRows(table);
  const columns = getEditorTableColumnCount(table);
  if (rows.length === 0) body.appendChild(createEmptyEditorTableRow(ownerDocument, 0, columns));
  getEditorTableRows(table).forEach((row, rowIndex) => {
    const cells = getEditorTableCells(row);
    cells.forEach((cell) => {
      cell.setAttribute(EDITOR_TABLE_CELL_ATTRIBUTE, "true");
      if (cell.childNodes.length === 0) cell.appendChild(ownerDocument.createElement("br"));
    });
    for (let index = cells.length; index < columns; index += 1) {
      row.appendChild(createEmptyEditorTableCell(ownerDocument, rowIndex, index));
    }
  });
  getEditorTableRows(table).forEach((row, rowIndex) => {
    getEditorTableCells(row).forEach((cell, columnIndex) => {
      ensureEditorTableCellKind(cell, rowIndex, columnIndex);
    });
  });
  updateEditorTableColumnAttribute(table);
}

function getEditorTableCellCoordinates(table: HTMLTableElement, cell: HTMLTableCellElement): { rowIndex: number; columnIndex: number } | null {
  const rows = getEditorTableRows(table);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const columnIndex = getEditorTableCells(rows[rowIndex]).indexOf(cell);
    if (columnIndex >= 0) return { rowIndex, columnIndex };
  }
  return null;
}

function setSelectionInEditorTableCell(root: HTMLElement, cell: HTMLTableCellElement) {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  if (cell.childNodes.length === 0) cell.appendChild(root.ownerDocument.createElement("br"));
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getEditorTableCellAt(table: HTMLTableElement, rowIndex: number, columnIndex: number): HTMLTableCellElement | null {
  const row = getEditorTableRows(table)[rowIndex] ?? null;
  if (!row) return null;
  return getEditorTableCells(row)[columnIndex] ?? null;
}

function clearEditorTableCellSelections(root: HTMLElement) {
  root.querySelectorAll(`[data-mango-editor-table-selected]`).forEach((cell) => {
    if (cell instanceof HTMLElement) cell.removeAttribute("data-mango-editor-table-selected");
  });
}

function markEditorTableHeaderSelection(root: HTMLElement, table: HTMLTableElement, coordinates: { rowIndex: number; columnIndex: number }): boolean {
  clearEditorTableCellSelections(root);
  const rows = getEditorTableRows(table);
  if (coordinates.rowIndex === 0 && coordinates.columnIndex === 0) {
    rows.forEach((row) => {
      getEditorTableCells(row).forEach((cell) => cell.setAttribute("data-mango-editor-table-selected", "all"));
    });
    return true;
  }
  if (coordinates.rowIndex === 0) {
    rows.forEach((row) => {
      getEditorTableCells(row)[coordinates.columnIndex]?.setAttribute("data-mango-editor-table-selected", "column");
    });
    return true;
  }
  if (coordinates.columnIndex === 0) {
    const row = rows[coordinates.rowIndex];
    if (!row) return false;
    getEditorTableCells(row).forEach((cell) => cell.setAttribute("data-mango-editor-table-selected", "row"));
    return true;
  }
  return false;
}

function removeEditorTableAndSetCaret(root: HTMLElement, table: HTMLTableElement) {
  const caretNode = root.ownerDocument.createTextNode("");
  const nextSibling = table.nextSibling;
  table.remove();
  if (nextSibling?.parentNode) {
    nextSibling.parentNode.insertBefore(caretNode, nextSibling);
  } else {
    root.appendChild(caretNode);
  }
  const range = root.ownerDocument.createRange();
  range.setStart(caretNode, 0);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function insertEditorTableCellLineBreak(
  root: HTMLElement,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
): boolean {
  const cell = getCurrentEditorTableCell(root);
  const range = getEditorSelectionRange(root);
  if (!cell || !range || !cell.contains(range.startContainer) || !cell.contains(range.endContainer)) return false;
  const undoBefore = snapshotEditorDocumentRoot(root);
  const breakNode = root.ownerDocument.createElement("br");
  const caretNode = root.ownerDocument.createTextNode("");
  range.deleteContents();
  range.insertNode(breakNode);
  breakNode.after(caretNode);
  const nextRange = root.ownerDocument.createRange();
  nextRange.setStart(caretNode, 0);
  nextRange.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
  recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, "lineBreak");
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
  return true;
}


function insertEditorTableRowAt(table: HTMLTableElement, rowIndex: number): number | null {
  const rows = getEditorTableRows(table);
  if (rows.length >= EDITOR_TABLE_MAX_ROWS) return null;
  const columns = getEditorTableColumnCount(table);
  const safeRowIndex = Math.max(0, Math.min(rowIndex, rows.length));
  const newRow = createEmptyEditorTableRow(table.ownerDocument, safeRowIndex, columns);
  const body = table.tBodies[0] ?? table.createTBody();
  const anchor = rows[safeRowIndex] ?? null;
  if (anchor) body.insertBefore(newRow, anchor);
  else body.appendChild(newRow);
  normalizeEditorTable(table);
  return safeRowIndex;
}

function removeEditorTableRowAt(table: HTMLTableElement, rowIndex: number): boolean {
  const rows = getEditorTableRows(table);
  if (rows.length <= 1) return false;
  const targetRow = rows[rowIndex];
  if (!targetRow) return false;
  targetRow.remove();
  normalizeEditorTable(table);
  return true;
}

function insertEditorTableColumnAt(table: HTMLTableElement, columnIndex: number): number | null {
  const columns = getEditorTableColumnCount(table);
  if (columns >= EDITOR_TABLE_MAX_COLUMNS) return null;
  const safeColumnIndex = Math.max(0, Math.min(columnIndex, columns));
  const widths = readEditorTableColumnWidths(table, columns);
  const splitIndex = Math.max(0, Math.min(columns - 1, safeColumnIndex > 0 ? safeColumnIndex - 1 : 0));
  const splitWidth = widths[splitIndex] ?? 100 / columns;
  const insertedWidth = Math.max(100 / (columns + 1) * 0.58, splitWidth / 2);
  widths[splitIndex] = Math.max(1, splitWidth - insertedWidth);
  widths.splice(safeColumnIndex, 0, insertedWidth);
  getEditorTableRows(table).forEach((row, rowIndex) => {
    const cells = getEditorTableCells(row);
    const newCell = createEmptyEditorTableCell(table.ownerDocument, rowIndex, safeColumnIndex);
    const anchor = cells[safeColumnIndex] ?? null;
    if (anchor) row.insertBefore(newCell, anchor);
    else row.appendChild(newCell);
  });
  applyEditorTableColumnWidths(table, widths);
  normalizeEditorTable(table);
  return safeColumnIndex;
}

function removeEditorTableColumnAt(table: HTMLTableElement, columnIndex: number): boolean {
  const columns = getEditorTableColumnCount(table);
  if (columns <= 1) return false;
  const widths = readEditorTableColumnWidths(table, columns);
  getEditorTableRows(table).forEach((row) => {
    const cells = getEditorTableCells(row);
    cells[columnIndex]?.remove();
  });
  widths.splice(columnIndex, 1);
  if (widths.length > 0) applyEditorTableColumnWidths(table, widths);
  normalizeEditorTable(table);
  return true;
}

type EditorTableCommand = "insert-row-before" | "insert-row-after" | "insert-column-before" | "insert-column-after" | "delete-row" | "delete-column" | "delete-table";

function applyEditorTableCommand(
  root: HTMLElement,
  command: EditorTableCommand,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
): boolean {
  const cell = getCurrentEditorTableCell(root);
  const table = getEditorTableForCell(root, cell);
  if (!cell || !table) return false;
  const initialCoordinates = getEditorTableCellCoordinates(table, cell);
  normalizeEditorTable(table);
  const activeCell = initialCoordinates ? getEditorTableCellAt(table, initialCoordinates.rowIndex, initialCoordinates.columnIndex) ?? cell : cell;
  const coordinates = getEditorTableCellCoordinates(table, activeCell);
  if (!coordinates) return false;

  const undoBefore = snapshotEditorDocumentRoot(root);
  const rows = getEditorTableRows(table);
  const targetRow = rows[coordinates.rowIndex];
  let nextSelectionCell: HTMLTableCellElement | null = activeCell;

  if (command === "delete-table") {
    removeEditorTableAndSetCaret(root, table);
    nextSelectionCell = null;
  } else if (command === "insert-row-before") {
    const insertedRowIndex = insertEditorTableRowAt(table, coordinates.rowIndex);
    if (insertedRowIndex === null) return false;
    nextSelectionCell = getEditorTableCellAt(table, insertedRowIndex, coordinates.columnIndex);
  } else if (command === "insert-row-after") {
    const insertedRowIndex = insertEditorTableRowAt(table, coordinates.rowIndex + 1);
    if (insertedRowIndex === null) return false;
    nextSelectionCell = getEditorTableCellAt(table, insertedRowIndex, coordinates.columnIndex);
  } else if (command === "insert-column-before") {
    const insertedColumnIndex = insertEditorTableColumnAt(table, coordinates.columnIndex);
    if (insertedColumnIndex === null) return false;
    nextSelectionCell = getEditorTableCellAt(table, coordinates.rowIndex, insertedColumnIndex);
  } else if (command === "insert-column-after") {
    const insertedColumnIndex = insertEditorTableColumnAt(table, coordinates.columnIndex + 1);
    if (insertedColumnIndex === null) return false;
    nextSelectionCell = getEditorTableCellAt(table, coordinates.rowIndex, insertedColumnIndex);
  } else if (command === "delete-row") {
    if (rows.length <= 1) {
      removeEditorTableAndSetCaret(root, table);
      nextSelectionCell = null;
    } else {
      targetRow.remove();
      normalizeEditorTable(table);
      const nextRowIndex = Math.min(coordinates.rowIndex, Math.max(0, getEditorTableRows(table).length - 1));
      nextSelectionCell = getEditorTableCellAt(table, nextRowIndex, Math.min(coordinates.columnIndex, getEditorTableColumnCount(table) - 1));
    }
  } else if (command === "delete-column") {
    const columns = getEditorTableColumnCount(table);
    if (columns <= 1) {
      removeEditorTableAndSetCaret(root, table);
      nextSelectionCell = null;
    } else {
      removeEditorTableColumnAt(table, coordinates.columnIndex);
      nextSelectionCell = getEditorTableCellAt(
        table,
        Math.min(coordinates.rowIndex, Math.max(0, getEditorTableRows(table).length - 1)),
        Math.min(coordinates.columnIndex, Math.max(0, getEditorTableColumnCount(table) - 1)),
      );
    }
  }

  if (nextSelectionCell && root.contains(nextSelectionCell)) setSelectionInEditorTableCell(root, nextSelectionCell);
  recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
  return true;
}

function getSelectedEditorTableDeletion(root: HTMLElement): { cell: HTMLTableCellElement; command: EditorTableCommand } | null {
  const selectedCells = Array.from(root.querySelectorAll(`[data-mango-editor-table-selected]`))
    .filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement);
  if (selectedCells.length === 0) return null;

  const allCell = selectedCells.find((cell) => cell.getAttribute("data-mango-editor-table-selected") === "all");
  if (allCell) return { cell: allCell, command: "delete-table" };

  const columnCell = selectedCells.find((cell) => cell.getAttribute("data-mango-editor-table-selected") === "column");
  if (columnCell) return { cell: columnCell, command: "delete-column" };

  const rowCell = selectedCells.find((cell) => cell.getAttribute("data-mango-editor-table-selected") === "row");
  return rowCell ? { cell: rowCell, command: "delete-row" } : null;
}

function deleteSelectedEditorTableDimension(
  root: HTMLElement,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
): boolean {
  const selectedDeletion = getSelectedEditorTableDeletion(root);
  if (!selectedDeletion) return false;
  const table = getEditorTableForCell(root, selectedDeletion.cell);
  if (!table) return false;
  setSelectionInEditorTableCell(root, selectedDeletion.cell);
  const applied = applyEditorTableCommand(
    root,
    selectedDeletion.command,
    documentUndoHistory,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
  );
  if (applied) clearEditorTableCellSelections(root);
  return applied;
}

function getImageFilesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  const itemFiles: File[] = [];
  for (let index = 0; index < dataTransfer.items.length; index += 1) {
    const item = dataTransfer.items[index];
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) itemFiles.push(file);
  }
  if (itemFiles.length > 0) return itemFiles;
  const files: File[] = [];
  for (let index = 0; index < dataTransfer.files.length; index += 1) {
    const file = dataTransfer.files[index];
    if (file.type.startsWith("image/")) files.push(file);
  }
  return files;
}

function getEditorImageStorageBudget(root: HTMLElement): number {
  return getEditorImageStorageBudgetForDocumentBytes(estimateEditorDocumentBytes(serializeEditorDocumentHTML(root)));
}

function getEditorImageMaxFrameWidth(contentWidth: number): number {
  return Math.max(48, Math.round(contentWidth - EDITOR_IMAGE_MAX_WIDTH_INSET_PX));
}

function rangeIsStillInsideRoot(root: HTMLElement, range: Range | null): range is Range {
  if (!range) return false;
  try {
    return rootContainsRange(root, range);
  } catch {
    return false;
  }
}

function createEditorImageClearBreak(ownerDocument: Document): HTMLBRElement {
  const clearBreak = ownerDocument.createElement("br");
  clearBreak.setAttribute(EDITOR_IMAGE_CLEAR_BREAK_ATTRIBUTE, "true");
  clearBreak.setAttribute("clear", "all");
  clearBreak.style.clear = "both";
  return clearBreak;
}

function editorImageAttachmentContextReady(context: EditorImageAttachmentContext | undefined): context is EditorImageAttachmentContext {
  return Boolean(
    context?.requestJSON &&
    context.apiBase.trim() &&
    context.companyID.trim() &&
    context.resourceType &&
    context.resourceID.trim(),
  );
}

function editorImageAttachmentContextIdentity(context: EditorImageAttachmentContext | undefined): string {
  if (!context) return "";
  return JSON.stringify([
    context.companyID.trim(),
    context.resourceType,
    context.resourceID.trim(),
    context.informationID?.trim() ?? "",
    context.editorSurface?.trim() ?? "",
  ]);
}

function editorAttachmentFilenameForMimeType(mimeType: string): string {
  const cleanType = mimeType.trim().toLowerCase();
  if (cleanType === "image/jpeg") return "pasted-image.jpg";
  if (cleanType === "image/gif") return "pasted-image.gif";
  if (cleanType === "image/webp") return "pasted-image.webp";
  return "pasted-image.png";
}

function reportEditorImageAttachmentError(
  context: EditorImageAttachmentContext | undefined,
  fallbackErrorHandler: ((message: string) => void) | undefined,
  cause: unknown,
): void {
  const rawMessage = cause instanceof Error ? cause.message : "failed_to_upload_attachment";
  const message = rawMessage === "editor_image_attachment_context_unavailable"
    ? "Inline image uploads are not available in this editor yet."
    : rawMessage;
  (context?.onError ?? fallbackErrorHandler)?.(message);
}

async function attachUploadedEditorImageData(
  imageData: EditorImageData,
  file: File,
  context: EditorImageAttachmentContext | undefined,
  options: { loadDisplay?: boolean } = {},
): Promise<EditorImageData> {
  if (!editorImageAttachmentContextReady(context)) throw new Error("editor_image_attachment_context_unavailable");
  const uploaded = await withPreparedEditorAttachmentResource(context.prepareResource, () => uploadMangoAttachment(context.requestJSON, {
    companyID: context.companyID,
    resourceType: context.resourceType,
    resourceID: context.resourceID,
    file,
    sourceKind: "editor_paste",
    relationshipKind: "inline_image",
    informationID: context.informationID,
    editorSurface: context.editorSurface,
  }), context.mutationLifecycle);
  const attachment = uploaded.attachment;
  if (options.loadDisplay === false) {
    revokeTemporaryEditorImageSource(imageData.src);
    return {
      ...imageData,
      src: editorAttachmentImageSource(attachment.attachment_id),
      attachmentID: attachment.attachment_id,
      filename: attachment.original_filename || file.name || "image",
      mimeType: attachment.mime_type || file.type || "image/png",
      byteSize: attachment.byte_size || file.size,
    };
  }
  let displaySrc = imageData.src;
  try {
    displaySrc = await loadMangoAttachmentObjectURL(context.apiBase, context.companyID, attachment.attachment_id, "display");
    if (displaySrc !== imageData.src) revokeTemporaryEditorImageSource(imageData.src);
  } catch {
    displaySrc = imageData.src;
    if (displaySrc.startsWith("blob:") && typeof window !== "undefined") {
      window.setTimeout(() => revokeTemporaryEditorImageSource(displaySrc), 60_000);
    }
  }
  return {
    ...imageData,
    src: displaySrc,
    attachmentID: attachment.attachment_id,
    filename: attachment.original_filename || file.name || "image",
    mimeType: attachment.mime_type || file.type || "image/png",
    byteSize: attachment.byte_size || file.size,
  };
}

async function insertEditorImageFile(
  root: HTMLElement,
  file: File,
  savedRange: Range | null,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
  editorImageAttachmentContext: EditorImageAttachmentContext | undefined,
  canCommit: () => boolean,
) {
  const maxDisplayWidth = Math.max(120, Math.min(720, root.clientWidth - 56));
  const localImageData = await createEditorImageDataFromFile(file, maxDisplayWidth, getEditorImageStorageBudget(root));
  let imageData: EditorImageData;
  try {
    imageData = await attachUploadedEditorImageData(localImageData, file, editorImageAttachmentContext);
  } catch (cause) {
    revokeTemporaryEditorImageSource(localImageData.src);
    throw cause;
  }
  if (!canCommit()) {
    revokeTemporaryEditorImageSource(imageData.src);
    return;
  }
  insertPreparedEditorImage(root, imageData, savedRange, snapshotEditorDocumentRoot(root), documentUndoHistory, scheduleDocumentSave, scheduleIndentGuideUpdate);
}

function revokeTemporaryEditorImageSource(src: string): void {
  if (!src.startsWith("blob:") || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(src);
}

async function prepareEditorClipboardImageData(
  root: HTMLElement,
  clipboardData: EditorImageClipboardData,
  editorImageAttachmentContext: EditorImageAttachmentContext | undefined,
  options: { loadDisplay?: boolean } = {},
): Promise<EditorImageData> {
  const maxDisplayWidth = Math.max(120, Math.min(720, root.clientWidth - 56));
  if (clipboardData.attachmentID) {
    const attachmentID = clipboardData.attachmentID;
    if (!editorImageAttachmentContextReady(editorImageAttachmentContext)) {
      throw new Error("editor_image_attachment_context_unavailable");
    }
    await withPreparedEditorAttachmentResource(editorImageAttachmentContext.prepareResource, () => linkMangoResourceAttachment(editorImageAttachmentContext.requestJSON, {
      companyID: editorImageAttachmentContext.companyID,
      resourceType: editorImageAttachmentContext.resourceType,
      resourceID: editorImageAttachmentContext.resourceID,
      attachmentID,
      relationshipKind: "inline_image",
      informationID: editorImageAttachmentContext.informationID,
      editorSurface: editorImageAttachmentContext.editorSurface,
    }), editorImageAttachmentContext.mutationLifecycle);
    let displaySrc = editorAttachmentImageSource(clipboardData.attachmentID);
    if (options.loadDisplay !== false) {
      displaySrc = clipboardData.src;
      try {
        displaySrc = await loadMangoAttachmentObjectURL(
          editorImageAttachmentContext.apiBase,
          editorImageAttachmentContext.companyID,
          clipboardData.attachmentID,
          "display",
        );
      } catch {
        displaySrc = clipboardData.src;
      }
    }
    return {
      src: displaySrc,
      attachmentID: clipboardData.attachmentID,
      filename: clipboardData.filename,
      mimeType: clipboardData.mimeType,
      byteSize: clipboardData.byteSize,
      width: clipboardData.width ?? 220,
      height: clipboardData.height ?? 160,
      marginLeft: clipboardData.marginLeft,
      marginTop: clipboardData.marginTop,
      floatSide: clipboardData.floatSide,
    };
  }
  const imageData = await createEditorImageDataFromSource(clipboardData.src, maxDisplayWidth, {
    maxStoredBytes: getEditorImageStorageBudget(root),
    preferredWidth: clipboardData.width,
    preferredHeight: clipboardData.height,
    marginLeft: clipboardData.marginLeft,
    marginTop: clipboardData.marginTop,
    floatSide: clipboardData.floatSide,
  });
  const file = fileFromDataURL(clipboardData.src, editorAttachmentFilenameForMimeType(clipboardData.mimeType ?? "image/png"));
  if (!file) throw new Error("failed_to_prepare_attachment");
  return attachUploadedEditorImageData(imageData, file, editorImageAttachmentContext, options);
}

async function insertEditorClipboardImageData(
  root: HTMLElement,
  clipboardData: EditorImageClipboardData,
  savedRange: Range | null,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
  editorImageAttachmentContext: EditorImageAttachmentContext | undefined,
  canCommit: () => boolean,
) {
  const uploadedImageData = await prepareEditorClipboardImageData(root, clipboardData, editorImageAttachmentContext);
  if (!canCommit()) {
    revokeTemporaryEditorImageSource(uploadedImageData.src);
    return;
  }
  insertPreparedEditorImage(root, uploadedImageData, savedRange, snapshotEditorDocumentRoot(root), documentUndoHistory, scheduleDocumentSave, scheduleIndentGuideUpdate);
}

function editorRichClipboardImageSize(
  root: HTMLElement,
  request: EditorRichClipboardImageRequest,
): { width: number; height: number } {
  const maxWidth = Math.max(120, Math.min(720, root.clientWidth - 56));
  const requestedWidth = request.width ?? maxWidth;
  const width = Math.max(48, Math.min(maxWidth, Math.round(requestedWidth)));
  const ratio = request.width && request.height ? request.height / request.width : 0.625;
  const height = Math.max(36, Math.min(1_600, Math.round(width * ratio)));
  return { width, height };
}

async function resolveEditorRichClipboardImage(
  root: HTMLElement,
  request: EditorRichClipboardImageRequest,
  matchingFile: File | undefined,
  editorImageAttachmentContext: EditorImageAttachmentContext | undefined,
): Promise<EditorImageData> {
  const maxDisplayWidth = Math.max(120, Math.min(720, root.clientWidth - 56));
  if (matchingFile) {
    const localImageData = await createEditorImageDataFromFile(matchingFile, maxDisplayWidth, getEditorImageStorageBudget(root));
    try {
      return await attachUploadedEditorImageData(localImageData, matchingFile, editorImageAttachmentContext, { loadDisplay: false });
    } catch (cause) {
      revokeTemporaryEditorImageSource(localImageData.src);
      throw cause;
    }
  }
  if (request.sourceKind === "attachment") {
    const attachmentID = request.attachmentData?.attachmentID?.trim()
      || editorAttachmentIDFromImageSource(request.source);
    if (!attachmentID) throw new Error("failed_to_prepare_attachment");
    return prepareEditorClipboardImageData(root, {
      ...request.attachmentData,
      src: request.attachmentData?.src || request.source,
      attachmentID,
      alt: request.attachmentData?.alt ?? request.alt,
      filename: request.attachmentData?.filename ?? request.filename,
      width: request.attachmentData?.width ?? request.width,
      height: request.attachmentData?.height ?? request.height,
    }, editorImageAttachmentContext, { loadDisplay: false });
  }
  if (request.sourceKind === "data") {
    return prepareEditorClipboardImageData(root, {
      src: request.source,
      alt: request.alt,
      filename: request.filename,
      width: request.width,
      height: request.height,
    }, editorImageAttachmentContext, { loadDisplay: false });
  }
  if (request.sourceKind === "blob") {
    const response = await fetch(request.source);
    if (!response.ok) throw new Error("failed_to_read_pasted_image");
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("remote_image_type_unsupported");
    const file = new File([blob], request.filename || editorAttachmentFilenameForMimeType(blob.type), { type: blob.type });
    const localImageData = await createEditorImageDataFromFile(file, maxDisplayWidth, getEditorImageStorageBudget(root));
    try {
      return await attachUploadedEditorImageData(localImageData, file, editorImageAttachmentContext, { loadDisplay: false });
    } catch (cause) {
      revokeTemporaryEditorImageSource(localImageData.src);
      throw cause;
    }
  }
  if (request.sourceKind !== "remote" || !editorImageAttachmentContextReady(editorImageAttachmentContext)) {
    throw new Error("editor_image_attachment_context_unavailable");
  }
  const imported = await withPreparedEditorAttachmentResource(
    editorImageAttachmentContext.prepareResource,
    () => importRemoteMangoImageAttachment(editorImageAttachmentContext.requestJSON, {
      companyID: editorImageAttachmentContext.companyID,
      resourceType: editorImageAttachmentContext.resourceType,
      resourceID: editorImageAttachmentContext.resourceID,
      sourceURL: request.source,
      originalFilename: request.filename,
      informationID: editorImageAttachmentContext.informationID,
      editorSurface: editorImageAttachmentContext.editorSurface,
    }),
    editorImageAttachmentContext.mutationLifecycle,
  );
  const attachment = imported.attachment;
  const size = editorRichClipboardImageSize(root, request);
  return {
    src: editorAttachmentImageSource(attachment.attachment_id),
    attachmentID: attachment.attachment_id,
    filename: attachment.original_filename,
    mimeType: attachment.mime_type,
    byteSize: attachment.byte_size,
    alt: request.alt,
    ...size,
  };
}

function insertPreparedEditorImage(
  root: HTMLElement,
  imageData: EditorImageData,
  savedRange: Range | null,
  undoBefore: EditorDocumentUndoSnapshot | null,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
) {
  const frame = createEditorImageFrame(root.ownerDocument, imageData);
  const clearBreak = createEditorImageClearBreak(root.ownerDocument);
  const caretNode = root.ownerDocument.createTextNode("");
  removeEditorTerminalBreaks(root);
  const range = rangeIsStillInsideRoot(root, savedRange) ? savedRange : getEditorSelectionRange(root);
  if (range) {
    range.deleteContents();
    range.insertNode(frame);
    frame.after(clearBreak, caretNode);
    range.setStart(caretNode, 0);
    range.collapse(true);
  } else {
    root.append(frame, clearBreak, caretNode);
  }
  const selection = root.ownerDocument.getSelection();
  clearEditorImageSelection(root);
  const caretRange = range ?? root.ownerDocument.createRange();
  if (!range) {
    caretRange.setStart(caretNode, 0);
    caretRange.collapse(true);
  }
  selection?.removeAllRanges();
  selection?.addRange(caretRange);
  recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, "image");
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
}

const EDITOR_INLINE_STYLE_COMMANDS = ["bold", "underline", "italic", "strikethrough"] as const;

function editorElementDefinesInlineFormat(element: HTMLElement, command: EditorInlineStyleCommand): boolean {
  const tagName = element.tagName.toLowerCase();
  if (tagNameIndicatesInlineFormat(element, command)) return true;
  if (tagName === "a") return false;
  const style = element.style;
  if (command === "bold") {
    const weight = Number.parseInt(style.fontWeight, 10);
    return Number.isFinite(weight) ? weight >= 600 : style.fontWeight === "bold" || style.fontWeight === "bolder";
  }
  if (command === "italic") return style.fontStyle === "italic" || style.fontStyle === "oblique";
  const decoration = command === "strikethrough" ? "line-through" : "underline";
  return style.textDecorationLine.split(/\s+/).includes(decoration)
    || style.textDecoration.split(/\s+/).includes(decoration);
}

function editorTextNodeHasInlineFormatDefinition(
  root: HTMLElement,
  node: Text,
  command: EditorInlineStyleCommand,
): boolean {
  let current = node.parentElement;
  while (current && current !== root) {
    if (editorElementDefinesInlineFormat(current, command)) return true;
    current = current.parentElement;
  }
  return false;
}

function liftEditorInlineTargetOutOfAncestor(
  target: HTMLSpanElement,
  ancestor: HTMLElement,
) {
  let pivot: HTMLElement = target;
  while (pivot.parentElement && pivot.parentElement !== ancestor) {
    pivot = splitEditorInlineWrapperAroundPivot(pivot.parentElement, pivot);
  }
  if (pivot.parentElement !== ancestor) return;
  const before = ancestor.cloneNode(false) as HTMLElement;
  const after = ancestor.cloneNode(false) as HTMLElement;
  while (ancestor.firstChild && ancestor.firstChild !== pivot) before.appendChild(ancestor.firstChild);
  while (pivot.nextSibling) after.appendChild(pivot.nextSibling);
  const replacements: Node[] = [];
  appendEditorCloneWhenNotEmpty(before, replacements);
  replacements.push(pivot);
  appendEditorCloneWhenNotEmpty(after, replacements);
  ancestor.replaceWith(...replacements);
}

function wrapEditorSelectedTextRunsWithInlineFormat(
  root: HTMLElement,
  range: Range,
  format: EditorSelectionInlineFormatState,
): boolean {
  const runs = editorSelectedTextRuns(root, range);
  let wrapped = false;
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    const parent = run.node.parentElement ?? root;
    const needsChange = EDITOR_INLINE_STYLE_COMMANDS.some((command) => (
      format[command]
        ? !readElementInlineFormat(root, parent, command)
        : editorTextNodeHasInlineFormatDefinition(root, run.node, command)
    ));
    if (!needsChange) continue;
    const runRange = root.ownerDocument.createRange();
    runRange.setStart(run.node, run.startOffset);
    runRange.setEnd(run.node, run.endOffset);
    const target = root.ownerDocument.createElement("span");
    target.appendChild(runRange.extractContents());
    runRange.insertNode(target);

    for (const command of EDITOR_INLINE_STYLE_COMMANDS) {
      if (format[command]) continue;
      let ancestor = target.parentElement;
      while (ancestor && ancestor !== root) {
        if (!editorElementDefinesInlineFormat(ancestor, command)) {
          ancestor = ancestor.parentElement;
          continue;
        }
        liftEditorInlineTargetOutOfAncestor(target, ancestor);
        ancestor = target.parentElement;
      }
    }

    for (const command of EDITOR_INLINE_STYLE_COMMANDS) {
      if (!format[command]) continue;
      const currentParent = target.parentElement ?? root;
      if (readElementInlineFormat(root, currentParent, command)) continue;
      const tagName = command === "bold" ? "strong" : command === "underline" ? "u" : command === "italic" ? "em" : "s";
      const wrapper = root.ownerDocument.createElement(tagName);
      target.replaceWith(wrapper);
      wrapper.appendChild(target);
    }

    const children = Array.from(target.childNodes);
    target.replaceWith(...children);
    wrapped = true;
  }
  return wrapped;
}
function readEditorTextNodeEffectiveFontSize(root: HTMLElement, node: Text): number | null {
  const element = node.parentElement ?? root;
  const value = root.ownerDocument.defaultView?.getComputedStyle(element).fontSize ?? element.style.fontSize;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? clampEditorFontSize(parsed) : null;
}

function applyEditorTypingStyleToRecentlyInsertedText(
  root: HTMLElement,
  text: string,
  style: EditorPendingTypingStyle,
): boolean {
  const offsets = getEditorSelectionOffsets(root);
  if (!offsets || offsets.start !== offsets.end || !text) return false;
  const endOffset = offsets.end;
  const startOffset = Math.max(0, endOffset - text.length);
  if (startOffset >= endOffset) return false;
  const selectInsertedText = () => {
    setEditorSelectionByOffsets(root, startOffset, endOffset);
    return getEditorSelectionRange(root);
  };
  let applied = false;

  if (style.inlineFormat) {
    const range = selectInsertedText();
    if (range) applied = wrapEditorSelectedTextRunsWithInlineFormat(root, range, style.inlineFormat) || applied;
  }

  if (style.fontSize !== undefined) {
    const range = selectInsertedText();
    if (range) {
      const nextFontSize = clampEditorFontSize(style.fontSize);
      const alreadyStyled = editorSelectedTextRuns(root, range).every((run) => readEditorTextNodeEffectiveFontSize(root, run.node) === nextFontSize);
      if (!alreadyStyled) {
        const spans = wrapEditorSelectedTextRuns(
          root,
          range,
          (fragment) => fragment.childNodes.forEach(stripNestedEditorFontSizes),
          (span) => { span.style.fontSize = `${nextFontSize}px`; },
        );
        normalizeEditorFontSizeSpans(root, spans);
        applied = spans.length > 0 || applied;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(style, "highlightColor")) {
    const range = selectInsertedText();
    if (range) {
      const color = style.highlightColor ?? null;
      const alreadyStyled = editorSelectedTextRuns(root, range).every((run) => readSelectionHighlightColor(root, run.node.parentElement ?? root) === color);
      if (!alreadyStyled) {
        const spans = wrapEditorSelectedTextRuns(
          root,
          range,
          (fragment) => fragment.childNodes.forEach(stripNestedEditorHighlights),
          (span) => setEditorElementHighlight(span, color),
        );
        normalizeEditorHighlightSpans(root);
        if (color === null) {
          spans.forEach((span) => {
            if (root.contains(span)) unwrapEditorHighlightClearSpan(span);
          });
        }
        applied = spans.length > 0 || applied;
      }
    }
  }

  setEditorSelectionByOffsets(root, endOffset, endOffset);
  return applied;
}

function stripNestedEditorFontSizes(node: Node) {
  if (node instanceof HTMLElement && node.tagName.toLowerCase() === "span") node.style.fontSize = "";
  node.childNodes.forEach(stripNestedEditorFontSizes);
}

type EditorSelectedTextRun = {
  node: Text;
  startOffset: number;
  endOffset: number;
};


function editorSelectedTextRuns(root: HTMLElement, range: Range): EditorSelectedTextRun[] {
  const selectionOffsets = getEditorRangeOffsets(root, range);
  if (!selectionOffsets) return [];
  const textNodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    textNodes.push(node);
  }
  const selectionNodes = textNodes.map((node) => ({
    text: node.data,
    selectable: !node.parentElement?.closest(`[contenteditable="false"], [${EDITOR_TABLE_ALIGNMENT_CONTROL_ATTRIBUTE}="true"]`),
  }));
  return mapEditorSelectedTextRunOffsets(selectionNodes, selectionOffsets.start, selectionOffsets.end).map((run) => ({
    node: textNodes[run.nodeIndex],
    startOffset: run.startOffset,
    endOffset: run.endOffset,
  }));
}

function wrapEditorSelectedTextRuns(
  root: HTMLElement,
  range: Range,
  prepareFragment: (fragment: DocumentFragment) => void,
  configureSpan: (span: HTMLSpanElement) => void,
): HTMLSpanElement[] {
  const runs = editorSelectedTextRuns(root, range);
  const spans = new Array<HTMLSpanElement>(runs.length);
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    const runRange = root.ownerDocument.createRange();
    runRange.setStart(run.node, run.startOffset);
    runRange.setEnd(run.node, run.endOffset);
    const fragment = runRange.extractContents();
    prepareFragment(fragment);
    const span = root.ownerDocument.createElement("span");
    configureSpan(span);
    span.appendChild(fragment);
    runRange.insertNode(span);
    spans[index] = span;
  }
  return spans;
}

function appendEditorCloneWhenNotEmpty(clone: HTMLElement, output: Node[]) {
  if ((clone.textContent ?? "").length > 0 || clone.querySelector("*")) output.push(clone);
}

function splitEditorInlineWrapperAroundPivot(wrapper: HTMLElement, pivot: HTMLElement): HTMLElement {
  const before = wrapper.cloneNode(false) as HTMLElement;
  const after = wrapper.cloneNode(false) as HTMLElement;
  while (wrapper.firstChild && wrapper.firstChild !== pivot) before.appendChild(wrapper.firstChild);
  while (pivot.nextSibling) after.appendChild(pivot.nextSibling);
  const middle = wrapper.cloneNode(false) as HTMLElement;
  middle.appendChild(pivot);
  const replacements: Node[] = [];
  appendEditorCloneWhenNotEmpty(before, replacements);
  replacements.push(middle);
  appendEditorCloneWhenNotEmpty(after, replacements);
  wrapper.replaceWith(...replacements);
  return middle;
}

function liftEditorFontSizeSpanOutOfAncestor(target: HTMLSpanElement, ancestor: HTMLSpanElement) {
  let pivot: HTMLElement = target;
  while (pivot.parentElement && pivot.parentElement !== ancestor) {
    pivot = splitEditorInlineWrapperAroundPivot(pivot.parentElement, pivot);
  }
  if (pivot.parentElement !== ancestor) return;
  const before = ancestor.cloneNode(false) as HTMLSpanElement;
  const after = ancestor.cloneNode(false) as HTMLSpanElement;
  while (ancestor.firstChild && ancestor.firstChild !== pivot) before.appendChild(ancestor.firstChild);
  while (pivot.nextSibling) after.appendChild(pivot.nextSibling);
  const middle = ancestor.cloneNode(false) as HTMLSpanElement;
  middle.style.removeProperty("font-size");
  if (!middle.getAttribute("style")?.trim()) middle.removeAttribute("style");
  middle.appendChild(pivot);
  const selected: Node = middle.attributes.length === 0 ? pivot : middle;
  const replacements: Node[] = [];
  appendEditorCloneWhenNotEmpty(before, replacements);
  replacements.push(selected);
  appendEditorCloneWhenNotEmpty(after, replacements);
  ancestor.replaceWith(...replacements);
}

function normalizeEditorFontSizeSpans(root: HTMLElement, spans: readonly HTMLSpanElement[]) {
  for (const span of spans) {
    if (!root.contains(span)) continue;
    let ancestor = span.parentElement;
    while (ancestor && ancestor !== root) {
      if (ancestor instanceof HTMLSpanElement && ancestor.style.fontSize.trim()) {
        liftEditorFontSizeSpanOutOfAncestor(span, ancestor);
        ancestor = span.parentElement;
        continue;
      }
      ancestor = ancestor.parentElement;
    }
  }
}

export function applyEditorSelectionFontSizeToRoot(
  root: HTMLElement,
  nextFontSizeInput: number,
  options: {
    documentUndoHistory: EditorDocumentUndoHistory;
    pendingEditorFontSizeRef: React.MutableRefObject<number | null>;
    pendingEditorTypingCaretRef: React.MutableRefObject<EditorTypingCaretBookmark | null>;
    scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
    scheduleIndentGuideUpdate: (text: string) => void;
    onSelectionFontSizeChange?: (fontSize: number) => void;
    undoBefore?: EditorDocumentUndoSnapshot;
  },
): boolean {
  const nextFontSize = clampEditorFontSize(nextFontSizeInput);
  root.focus({ preventScroll: true });
  const range = getEditorSelectionRange(root);
  options.onSelectionFontSizeChange?.(nextFontSize);
  if (!range) return false;
  if (range.collapsed) {
    options.pendingEditorFontSizeRef.current = nextFontSize;
    options.pendingEditorTypingCaretRef.current = getEditorTypingCaretBookmark(root);
    const htmlSize = nextFontSize <= 10 ? "1" : nextFontSize <= 13 ? "2" : nextFontSize <= 16 ? "3" : nextFontSize <= 20 ? "4" : nextFontSize <= 26 ? "5" : nextFontSize <= 36 ? "6" : "7";
    try {
      root.ownerDocument.execCommand("fontSize", false, htmlSize);
    } catch {
      // Pending shared state still applies the exact pixel size on input.
    }
    return true;
  }

  const undoBefore = options.undoBefore ?? snapshotEditorDocumentRoot(root);
  const selectionOffsets = getEditorSelectionOffsets(root);
  const spans = wrapEditorSelectedTextRuns(
    root,
    range,
    (fragment) => fragment.childNodes.forEach(stripNestedEditorFontSizes),
    (span) => {
      span.style.fontSize = `${nextFontSize}px`;
    },
  );
  if (spans.length === 0) return false;
  normalizeEditorFontSizeSpans(root, spans);
  if (selectionOffsets) setEditorSelectionByOffsets(root, selectionOffsets.start, selectionOffsets.end);
  options.pendingEditorFontSizeRef.current = null;
  options.pendingEditorTypingCaretRef.current = null;
  recordEditorDocumentMutation(options.documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, options.scheduleDocumentSave, options.scheduleIndentGuideUpdate);
  return true;
}

function stripNestedEditorHighlights(node: Node) {
  if (node instanceof HTMLElement) removeEditorElementHighlight(node);
  node.childNodes.forEach(stripNestedEditorHighlights);
}

function unwrapEditorHighlightClearSpan(span: HTMLSpanElement) {
  const children = Array.from(span.childNodes);
  span.replaceWith(...children);
}

export function applyEditorHighlightColorToRoot(
  root: HTMLElement,
  colorInput: string | null,
  options: {
    documentUndoHistory: EditorDocumentUndoHistory;
    pendingEditorHighlightColorRef: React.MutableRefObject<EditorHighlightColor | null | undefined>;
    pendingEditorTypingCaretRef: React.MutableRefObject<EditorTypingCaretBookmark | null>;
    scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
    scheduleIndentGuideUpdate: (text: string) => void;
    onSelectionHighlightColorChange?: (color: EditorHighlightColor | null) => void;
  },
): boolean {
  const color = colorInput === null ? null : normalizeEditorHighlightColor(colorInput);
  if (colorInput !== null && !color) return false;
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  root.focus({ preventScroll: true });
  options.onSelectionHighlightColorChange?.(color);
  if (range.collapsed) {
    options.pendingEditorHighlightColorRef.current = color;
    options.pendingEditorTypingCaretRef.current = getEditorTypingCaretBookmark(root);
    return true;
  }
  const undoBefore = snapshotEditorDocumentRoot(root);
  const selectionOffsets = getEditorSelectionOffsets(root);
  const spans = wrapEditorSelectedTextRuns(
    root,
    range,
    (fragment) => fragment.childNodes.forEach(stripNestedEditorHighlights),
    (span) => setEditorElementHighlight(span, color),
  );
  if (spans.length === 0) return false;
  normalizeEditorHighlightSpans(root);
  if (color === null) {
    spans.forEach((span) => {
      if (root.contains(span)) unwrapEditorHighlightClearSpan(span);
    });
  }
  if (selectionOffsets) setEditorSelectionByOffsets(root, selectionOffsets.start, selectionOffsets.end);
  options.pendingEditorHighlightColorRef.current = undefined;
  options.pendingEditorTypingCaretRef.current = null;
  recordEditorDocumentMutation(options.documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, options.scheduleDocumentSave, options.scheduleIndentGuideUpdate);
  return true;
}

function replaceDocumentWithPlainText(root: HTMLElement, text: string, selectionStart: number, selectionEnd = selectionStart) {
  root.innerHTML = linkifyEditorPlainTextToHTML(text);
  setEditorSelectionByOffsets(root, selectionStart, selectionEnd);
}

function documentHasEditorImages(root: HTMLElement): boolean {
  return root.querySelector(`span[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"]`) !== null;
}

const EDITOR_LIST_ITEM_SELECTOR = [
  `li[${EDITOR_LIST_ITEM_ATTRIBUTE}]`,
  `ol[${EDITOR_ORDERED_LIST_ATTRIBUTE}="true"] > li`,
].join(",");
type EditorListElement = HTMLUListElement | HTMLOListElement;

function isEditorListElement(element: Element | null): element is EditorListElement {
  if (element instanceof HTMLUListElement) return readEditorListKind(element.getAttribute(EDITOR_LIST_ATTRIBUTE)) !== null;
  return element instanceof HTMLOListElement && element.getAttribute(EDITOR_ORDERED_LIST_ATTRIBUTE) === "true";
}

function editorListsMatch(left: EditorListElement, right: EditorListElement): boolean {
  if (left instanceof HTMLOListElement || right instanceof HTMLOListElement) {
    return left instanceof HTMLOListElement && right instanceof HTMLOListElement;
  }
  return readEditorListKind(left.getAttribute(EDITOR_LIST_ATTRIBUTE))
    === readEditorListKind(right.getAttribute(EDITOR_LIST_ATTRIBUTE));
}

function editorListKindForOutlineStyle(outlineStyle: EditorOutlineStyleID): EditorListKind | null {
  if (outlineStyle === "bullet-list") return "bullet";
  if (outlineStyle === "checklist") return "checklist";
  return null;
}

function getEditorListKindForList(list: Element | null): EditorListKind | null {
  return list instanceof HTMLUListElement ? readEditorListKind(list.getAttribute(EDITOR_LIST_ATTRIBUTE)) : null;
}

function getEditorListForItem(item: HTMLLIElement): EditorListElement | null {
  const list = item.parentElement;
  return isEditorListElement(list) ? list : null;
}

function getEditorListKindForItem(item: HTMLLIElement): EditorListKind | null {
  return getEditorListKindForList(getEditorListForItem(item));
}

function getClosestEditorListItem(root: HTMLElement, node: Node | EventTarget | null): HTMLLIElement | null {
  const element = node instanceof Element
    ? node
    : node instanceof Node ? node.parentElement : null;
  const item = element?.closest?.(EDITOR_LIST_ITEM_SELECTOR) ?? null;
  return item instanceof HTMLLIElement && root.contains(item) ? item : null;
}

function getCurrentEditorListItem(root: HTMLElement): HTMLLIElement | null {
  const range = getEditorSelectionRange(root);
  if (!range) return null;
  return getClosestEditorListItem(root, range.startContainer)
    ?? getClosestEditorListItem(root, range.endContainer)
    ?? getClosestEditorListItem(root, range.commonAncestorContainer);
}

function editorListItemOwnTextNodes(item: HTMLLIElement): Text[] {
  const textNodes: Text[] = [];
  const walker = item.ownerDocument.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let current: Node | null = node.parentNode;
      while (current && current !== item) {
        if (current instanceof Element && isEditorListElement(current)) {
          return NodeFilter.FILTER_REJECT;
        }
        current = current.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    textNodes.push(node);
  }
  return textNodes;
}

function readEditorListItemOwnText(item: HTMLLIElement): string {
  return editorListItemOwnTextNodes(item).map((node) => node.data).join("");
}

function editorListItemContentIsEmpty(item: HTMLLIElement): boolean {
  if (readEditorListItemOwnText(item).replace(/\u200b/g, "").trim().length > 0) return false;
  return !item.querySelector([
    `[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"]`,
    `[${EDITOR_MENTION_ATTRIBUTE}]`,
    `table[${EDITOR_TABLE_ATTRIBUTE}]`,
    "table",
    "img",
    `ul[${EDITOR_LIST_ATTRIBUTE}]`,
    `ol[${EDITOR_ORDERED_LIST_ATTRIBUTE}="true"]`,
  ].join(","));
}

function directNestedEditorList(item: HTMLLIElement): EditorListElement | null {
  return Array.from(item.children).find(isEditorListElement) ?? null;
}

function removeEditorListItemPlaceholders(item: HTMLLIElement) {
  Array.from(item.childNodes).forEach((child) => {
    if (child instanceof HTMLBRElement) child.remove();
    if (child.nodeType === Node.TEXT_NODE && !(child.textContent ?? "").length) child.remove();
  });
}

function editorListItemHasOwnEditableContent(item: HTMLLIElement): boolean {
  return Array.from(item.childNodes).some((child) => {
    if (child instanceof Element && isEditorListElement(child)) return false;
    if (child instanceof HTMLBRElement) return false;
    if (child.nodeType === Node.TEXT_NODE) return (child.textContent ?? "").length > 0;
    return true;
  });
}

function ensureEditorListItemEditableContent(item: HTMLLIElement) {
  if (editorListItemHasOwnEditableContent(item)) return;
  item.insertBefore(item.ownerDocument.createElement("br"), directNestedEditorList(item));
}

function createEditorListItem(ownerDocument: Document, kind: EditorListKind, text = ""): HTMLLIElement {
  const item = ownerDocument.createElement("li");
  item.setAttribute(EDITOR_LIST_ITEM_ATTRIBUTE, kind);
  if (kind === "checklist") item.setAttribute(EDITOR_CHECKLIST_CHECKED_ATTRIBUTE, "false");
  if (text) item.appendChild(ownerDocument.createTextNode(text));
  else item.appendChild(ownerDocument.createElement("br"));
  return item;
}

function createEditorList(ownerDocument: Document, kind: EditorListKind, text = ""): HTMLUListElement {
  const list = ownerDocument.createElement("ul");
  list.setAttribute(EDITOR_LIST_ATTRIBUTE, kind);
  list.appendChild(createEditorListItem(ownerDocument, kind, text));
  return list;
}

function createEditorListItemForList(ownerDocument: Document, list: EditorListElement): HTMLLIElement {
  if (list instanceof HTMLUListElement) {
    const kind = readEditorListKind(list.getAttribute(EDITOR_LIST_ATTRIBUTE));
    if (kind) return createEditorListItem(ownerDocument, kind);
  }
  const item = ownerDocument.createElement("li");
  item.appendChild(ownerDocument.createElement("br"));
  return item;
}

function nextOrderedListMarkerType(list: HTMLOListElement): "1" | "a" | "A" | "i" | "I" {
  const current = list.getAttribute("type");
  if (current === "A") return "I";
  if (current === "I") return "1";
  if (current === "a") return "i";
  if (current === "i") return "1";
  return "a";
}

function createNestedEditorList(list: EditorListElement): EditorListElement {
  const nested = list.cloneNode(false) as EditorListElement;
  if (nested instanceof HTMLOListElement) {
    nested.removeAttribute("start");
    nested.removeAttribute("reversed");
    nested.setAttribute("type", nextOrderedListMarkerType(list as HTMLOListElement));
  }
  return nested;
}

function selectEditorListItem(root: HTMLElement, item: HTMLLIElement, edge: "start" | "end" = "end") {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const range = root.ownerDocument.createRange();
  const textNodes = editorListItemOwnTextNodes(item);
  const textNode = edge === "start" ? textNodes[0] : textNodes[textNodes.length - 1];
  if (textNode) {
    range.setStart(textNode, edge === "start" ? 0 : textNode.data.length);
  } else {
    const placeholder = Array.from(item.childNodes).find((child): child is HTMLBRElement => child instanceof HTMLBRElement);
    if (placeholder) range.setStartBefore(placeholder);
    else range.selectNodeContents(item);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function editorListItemCaretOffset(root: HTMLElement, item: HTMLLIElement): number {
  const range = getEditorSelectionRange(root);
  if (!range || !(item === range.startContainer || item.contains(range.startContainer))) return readEditorListItemOwnText(item).length;
  const prefix = root.ownerDocument.createRange();
  try {
    prefix.setStart(item, 0);
    prefix.setEnd(range.startContainer, range.startOffset);
    return Math.max(0, Math.min(readEditorListItemOwnText(item).length, prefix.toString().length));
  } catch {
    return 0;
  }
}

function selectEditorListItemAtOffset(root: HTMLElement, item: HTMLLIElement, offset: number) {
  let remaining = Math.max(0, Math.trunc(offset));
  for (const textNode of editorListItemOwnTextNodes(item)) {
    if (remaining <= textNode.data.length) {
      setCollapsedSelectionInTextNode(root, textNode, remaining);
      return;
    }
    remaining -= textNode.data.length;
  }
  selectEditorListItem(root, item, remaining > 0 ? "end" : "start");
}

function insertTextIntoEmptyEditorListItem(root: HTMLElement, item: HTMLLIElement, text: string): boolean {
  if (!text || !editorListItemContentIsEmpty(item)) return false;
  removeEditorListItemPlaceholders(item);
  const textNode = root.ownerDocument.createTextNode(text);
  item.insertBefore(textNode, directNestedEditorList(item));
  const range = root.ownerDocument.createRange();
  range.setStart(textNode, textNode.data.length);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function insertEditorListAtSelection(root: HTMLElement, kind: EditorListKind, initialText = ""): HTMLLIElement | null {
  const range = getEditorSelectionRange(root);
  if (!range) return null;
  removeEditorTerminalBreaks(root);
  const list = createEditorList(root.ownerDocument, kind, initialText);
  const item = list.firstElementChild instanceof HTMLLIElement ? list.firstElementChild : null;
  range.deleteContents();
  range.insertNode(list);
  if (item) selectEditorListItem(root, item, initialText ? "end" : "start");
  return item;
}

export function insertEditorListKindToRoot(
  root: HTMLElement,
  kind: EditorListKind,
  options: {
    documentUndoHistory: EditorDocumentUndoHistory;
    scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
    scheduleIndentGuideUpdate: (text: string) => void;
  },
): boolean {
  root.focus({ preventScroll: true });
  const undoBefore = snapshotEditorDocumentRoot(root);
  const inserted = insertEditorListAtSelection(root, kind) !== null;
  if (!inserted) return false;
  recordEditorDocumentMutation(options.documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, options.scheduleDocumentSave, options.scheduleIndentGuideUpdate);
  return true;
}

export function applyEditorNumberedListToRoot(
  root: HTMLElement,
  options: {
    documentUndoHistory: EditorDocumentUndoHistory;
    scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
    scheduleIndentGuideUpdate: (text: string) => void;
  },
): boolean {
  root.focus({ preventScroll: true });
  const offsets = getEditorSelectionOffsets(root);
  if (!offsets) return false;
  const currentText = readEditorDocumentText(root);
  const edit = toggleAutomaticOutlineNumberingText(currentText, offsets.start, offsets.end);
  if (!edit || (edit.value === currentText && edit.selectionStart === offsets.start && edit.selectionEnd === offsets.end)) return false;
  const undoBefore = snapshotEditorDocumentRoot(root);
  const appliedRichEdit = applyPlainTextEditToRichDocument(root, currentText, edit);
  if (!appliedRichEdit) {
    if (documentHasEditorImages(root)) return false;
    replaceDocumentWithPlainText(root, edit.value, edit.selectionStart, edit.selectionEnd);
  }
  recordEditorDocumentMutation(options.documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, options.scheduleDocumentSave, options.scheduleIndentGuideUpdate);
  return true;
}

export function applyEditorIndentCommandToRoot(
  root: HTMLElement,
  direction: EditorTabDirection,
  outlineStyle: EditorOutlineStyleID,
  options: {
    documentUndoHistory: EditorDocumentUndoHistory;
    scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
    scheduleIndentGuideUpdate: (text: string) => void;
  },
): boolean {
  root.focus({ preventScroll: true });
  const activeEditorListItem = getCurrentEditorListItem(root);
  const undoBefore = snapshotEditorDocumentRoot(root);
  if (activeEditorListItem) {
    const changed = direction === "outdent"
      ? outdentEditorListItem(root, activeEditorListItem)
      : indentEditorListItem(root, activeEditorListItem);
    if (!changed) return false;
    recordEditorDocumentMutation(options.documentUndoHistory, root, undoBefore, "tab");
    commitEditorDocument(root, options.scheduleDocumentSave, options.scheduleIndentGuideUpdate);
    return true;
  }

  const offsets = getEditorSelectionOffsets(root);
  if (!offsets) return false;
  const currentText = readEditorDocumentText(root);
  const edit = insertEditorTabText(currentText, offsets.start, offsets.end, outlineStyle, direction);
  if (edit.value === currentText && edit.selectionStart === offsets.start && edit.selectionEnd === offsets.end) return false;
  const appliedRichEdit = applyPlainTextEditToRichDocument(root, currentText, edit);
  if (!appliedRichEdit) {
    if (documentHasEditorImages(root)) return false;
    replaceDocumentWithPlainText(root, edit.value, edit.selectionStart, edit.selectionEnd);
  }
  recordEditorDocumentMutation(options.documentUndoHistory, root, undoBefore, "tab");
  commitEditorDocument(root, options.scheduleDocumentSave, options.scheduleIndentGuideUpdate);
  return true;
}

function readPlainTextLineBounds(value: string, selectionStart: number): { lineStart: number; lineEnd: number; line: string } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextLineBreak = value.indexOf("\n", start);
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
  return { lineStart, lineEnd, line: value.slice(lineStart, lineEnd) };
}

function listStarterLineBounds(value: string, selectionStart: number, selectionEnd: number): { lineStart: number; lineEnd: number } | null {
  if (selectionStart !== selectionEnd) return null;
  const { lineStart, lineEnd, line } = readPlainTextLineBounds(value, selectionStart);
  const relativeStart = selectionStart - lineStart;
  const beforeCaret = line.slice(0, relativeStart);
  const afterCaret = line.slice(relativeStart);
  if (!/^[ \t\u00a0]*$/.test(beforeCaret) || !/^[ \t\u00a0]*$/.test(afterCaret)) return null;
  return { lineStart, lineEnd };
}

function startEditorListFromBlankLine(root: HTMLElement, kind: EditorListKind, currentText: string, selectionStart: number, selectionEnd: number, insertedText: string): boolean {
  const bounds = listStarterLineBounds(currentText, selectionStart, selectionEnd);
  if (!bounds) return false;
  if (bounds.lineEnd > bounds.lineStart) {
    deleteTextByOffsets(root, bounds.lineStart, bounds.lineEnd, { preserveTrailingNewline: currentText.endsWith("\n") });
  }
  setEditorSelectionByPlainTextOffsets(root, bounds.lineStart);
  return insertEditorListAtSelection(root, kind, insertedText) !== null;
}

function startEditorBulletListFromDashShortcut(
  root: HTMLElement,
  currentText: string,
  selectionStart: number,
  selectionEnd: number,
  insertedText: string,
): boolean {
  if (insertedText !== " " || selectionStart !== selectionEnd) return false;
  const { lineStart, lineEnd, line } = readPlainTextLineBounds(currentText, selectionStart);
  const relativeCaret = selectionStart - lineStart;
  const beforeCaret = line.slice(0, relativeCaret);
  const afterCaret = line.slice(relativeCaret);
  if (!/^[ \t\u00a0]*-$/.test(beforeCaret) || !/^[ \t\u00a0]*$/.test(afterCaret)) return false;
  if (!deleteTextByOffsets(root, lineStart, lineEnd, { preserveTrailingNewline: currentText.endsWith("\n") })) return false;
  setEditorSelectionByPlainTextOffsets(root, lineStart);
  return insertEditorListAtSelection(root, "bullet") !== null;
}

function insertEditorListFromEnter(root: HTMLElement, kind: EditorListKind, currentText: string, selectionStart: number, selectionEnd: number): boolean {
  const blankLineBounds = listStarterLineBounds(currentText, selectionStart, selectionEnd);
  if (blankLineBounds) {
    if (blankLineBounds.lineEnd > blankLineBounds.lineStart) {
      deleteTextByOffsets(root, blankLineBounds.lineStart, blankLineBounds.lineEnd, { preserveTrailingNewline: currentText.endsWith("\n") });
    }
    setEditorSelectionByPlainTextOffsets(root, blankLineBounds.lineStart);
    return insertEditorListAtSelection(root, kind) !== null;
  }

  const range = getEditorSelectionRange(root);
  if (!range) return false;
  removeEditorTerminalBreaks(root);
  const list = createEditorList(root.ownerDocument, kind);
  const item = list.firstElementChild instanceof HTMLLIElement ? list.firstElementChild : null;
  const fragment = root.ownerDocument.createDocumentFragment();
  fragment.appendChild(root.ownerDocument.createTextNode("\n"));
  fragment.appendChild(list);
  range.deleteContents();
  range.insertNode(fragment);
  if (item) selectEditorListItem(root, item, "start");
  return true;
}

function insertEditorListItemAfter(root: HTMLElement, item: HTMLLIElement): boolean {
  const list = getEditorListForItem(item);
  if (!list) return false;
  const nextItem = createEditorListItemForList(root.ownerDocument, list);
  const range = getEditorSelectionRange(root);
  if (range && (item === range.startContainer || item.contains(range.startContainer))) {
    const splitRange = root.ownerDocument.createRange();
    try {
      if (!range.collapsed) range.deleteContents();
      splitRange.setStart(range.startContainer, range.startOffset);
      const nestedList = directNestedEditorList(item);
      if (nestedList) splitRange.setEndBefore(nestedList);
      else splitRange.setEnd(item, item.childNodes.length);
    } catch {
      item.after(nextItem);
      selectEditorListItem(root, nextItem, "start");
      return true;
    }
    const trailingContent = splitRange.extractContents();
    nextItem.replaceChildren();
    nextItem.appendChild(trailingContent);
    ensureEditorListItemEditableContent(item);
    ensureEditorListItemEditableContent(nextItem);
    item.after(nextItem);
    selectEditorListItem(root, nextItem, "start");
    return true;
  }
  item.after(nextItem);
  selectEditorListItem(root, nextItem, "start");
  return true;
}

function isEditorTableAlignmentControlElement(node: Node): boolean {
  return node instanceof HTMLElement && node.getAttribute(EDITOR_TABLE_ALIGNMENT_CONTROL_ATTRIBUTE) === "true";
}

function isEditorTableCellPlaceholderNode(node: Node): boolean {
  if (node instanceof HTMLBRElement) return true;
  return node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim();
}

function editorTableCellEditableNodes(cell: HTMLTableCellElement): Node[] {
  return Array.from(cell.childNodes).filter((node) => !isEditorTableAlignmentControlElement(node));
}

function editorTableCellEditableContentIsEmpty(cell: HTMLTableCellElement): boolean {
  return editorTableCellEditableNodes(cell).every(isEditorTableCellPlaceholderNode);
}

function replaceEditorTableCellEditableContentWithList(
  root: HTMLElement,
  cell: HTMLTableCellElement,
  kind: EditorListKind,
  options: { initialText?: string; appendEmptyItem?: boolean } = {},
): HTMLLIElement | null {
  const list = root.ownerDocument.createElement("ul");
  list.setAttribute(EDITOR_LIST_ATTRIBUTE, kind);
  const firstItem = createEditorListItem(root.ownerDocument, kind);
  firstItem.replaceChildren();
  if (options.initialText !== undefined) {
    if (options.initialText) firstItem.appendChild(root.ownerDocument.createTextNode(options.initialText));
  } else {
    const contentNodes = editorTableCellEditableNodes(cell).filter((node) => !isEditorTableCellPlaceholderNode(node));
    contentNodes.forEach((node) => firstItem.appendChild(node));
  }
  ensureEditorListItemEditableContent(firstItem);
  list.appendChild(firstItem);
  const targetItem = options.appendEmptyItem ? createEditorListItem(root.ownerDocument, kind) : firstItem;
  if (options.appendEmptyItem) list.appendChild(targetItem);
  editorTableCellEditableNodes(cell).forEach((node) => node.parentNode?.removeChild(node));
  cell.appendChild(list);
  applyEditorListMarkerStyles(list);
  selectEditorListItem(root, targetItem, "start");
  return targetItem;
}

function startEditorTableCellListFromText(root: HTMLElement, cell: HTMLTableCellElement, kind: EditorListKind, text: string): boolean {
  const range = getEditorSelectionRange(root);
  if (!range || !range.collapsed || !cell.contains(range.startContainer)) return false;
  if (!editorTableCellEditableContentIsEmpty(cell)) return false;
  return replaceEditorTableCellEditableContentWithList(root, cell, kind, { initialText: text }) !== null;
}

function startEditorTableCellBulletListFromDashShortcut(
  root: HTMLElement,
  cell: HTMLTableCellElement,
  insertedText: string,
): boolean {
  if (insertedText !== " ") return false;
  const range = getEditorSelectionRange(root);
  if (!range || !range.collapsed || !cell.contains(range.startContainer)) return false;
  const beforeCaret = root.ownerDocument.createRange();
  const afterCaret = root.ownerDocument.createRange();
  try {
    beforeCaret.selectNodeContents(cell);
    beforeCaret.setEnd(range.startContainer, range.startOffset);
    afterCaret.selectNodeContents(cell);
    afterCaret.setStart(range.startContainer, range.startOffset);
  } catch {
    return false;
  }
  if (!/^[ \t\u00a0]*-$/.test(beforeCaret.toString()) || !/^[ \t\u00a0]*$/.test(afterCaret.toString())) return false;
  return replaceEditorTableCellEditableContentWithList(root, cell, "bullet", { initialText: "" }) !== null;
}

function insertEditorTableCellListFromEnter(root: HTMLElement, cell: HTMLTableCellElement, kind: EditorListKind): boolean {
  const range = getEditorSelectionRange(root);
  if (!range || !cell.contains(range.startContainer) || !cell.contains(range.endContainer)) return false;
  if (editorTableCellEditableContentIsEmpty(cell)) {
    return replaceEditorTableCellEditableContentWithList(root, cell, kind) !== null;
  }
  return replaceEditorTableCellEditableContentWithList(root, cell, kind, { appendEmptyItem: true }) !== null;
}

function exitEditorListItem(root: HTMLElement, item: HTMLLIElement): boolean {
  const list = getEditorListForItem(item);
  if (!list) return false;

  const parentItem = list.parentElement instanceof HTMLLIElement ? list.parentElement : null;
  if (parentItem) {
    parentItem.after(item);
    if (list.children.length === 0) list.remove();
    selectEditorListItem(root, item, "start");
    return true;
  }

  const trailingList = item.nextSibling ? list.cloneNode(false) as EditorListElement : null;
  while (trailingList && item.nextSibling) trailingList.appendChild(item.nextSibling);
  const lineBreak = root.ownerDocument.createTextNode("\n");
  item.remove();
  if (list.children.length > 0) list.after(lineBreak);
  else list.replaceWith(lineBreak);
  if (trailingList?.children.length) {
    lineBreak.after(trailingList);
    applyEditorListMarkerStyles(trailingList);
  }
  const range = root.ownerDocument.createRange();
  range.setStart(lineBreak, lineBreak.data.length);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function indentEditorListItem(root: HTMLElement, item: HTMLLIElement): boolean {
  const list = getEditorListForItem(item);
  if (!list) return false;
  const previousItem = item.previousElementSibling;
  if (!(previousItem instanceof HTMLLIElement)) return false;
  let nestedList = Array.from(previousItem.children).find((child): child is EditorListElement => (
    isEditorListElement(child) && editorListsMatch(child, list)
  )) ?? null;
  if (!nestedList) {
    nestedList = createNestedEditorList(list);
    previousItem.appendChild(nestedList);
  }
  const caretOffset = editorListItemCaretOffset(root, item);
  nestedList.appendChild(item);
  root.focus({ preventScroll: true });
  selectEditorListItemAtOffset(root, item, caretOffset);
  return true;
}

function outdentEditorListItem(root: HTMLElement, item: HTMLLIElement): boolean {
  const list = getEditorListForItem(item);
  if (!list) return false;
  const parentItem = list.parentElement instanceof HTMLLIElement ? list.parentElement : null;
  const caretOffset = editorListItemCaretOffset(root, item);
  if (parentItem) {
    parentItem.after(item);
    if (list.children.length === 0) list.remove();
    root.focus({ preventScroll: true });
    selectEditorListItemAtOffset(root, item, caretOffset);
    return true;
  }

  const trailingList = item.nextSibling ? list.cloneNode(false) as EditorListElement : null;
  while (trailingList && item.nextSibling) trailingList.appendChild(item.nextSibling);
  const plainBlock = root.ownerDocument.createElement("div");
  while (item.firstChild) plainBlock.appendChild(item.firstChild);
  if (plainBlock.childNodes.length === 0) plainBlock.appendChild(root.ownerDocument.createElement("br"));
  item.remove();
  if (list.children.length > 0) list.after(plainBlock);
  else list.replaceWith(plainBlock);
  if (trailingList?.children.length) {
    plainBlock.after(trailingList);
    applyEditorListMarkerStyles(trailingList);
  }
  root.focus({ preventScroll: true });
  const plainTextNodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(plainBlock, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const nestedList = node.parentElement?.closest(`ul[${EDITOR_LIST_ATTRIBUTE}]`);
      return nestedList && plainBlock.contains(nestedList) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) plainTextNodes.push(node);
  let remainingOffset = caretOffset;
  const preferredTextNode = plainTextNodes.find((node) => {
    const length = node.textContent?.length ?? 0;
    if (remainingOffset <= length) return true;
    remainingOffset -= length;
    return false;
  });
  if (preferredTextNode) {
    setCollapsedSelectionInTextNode(root, preferredTextNode, remainingOffset);
  } else {
    const selection = root.ownerDocument.getSelection();
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(plainBlock);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  return true;
}

function getChecklistItemForPointer(root: HTMLElement, event: Pick<React.MouseEvent<HTMLDivElement>, "target" | "clientX">): HTMLLIElement | null {
  const item = getClosestEditorListItem(root, event.target);
  if (!item || getEditorListKindForItem(item) !== "checklist") return null;
  const rect = item.getBoundingClientRect();
  const markerZoneLeft = rect.left - 2;
  const markerZoneRight = rect.left + 26;
  return event.clientX >= markerZoneLeft && event.clientX <= markerZoneRight ? item : null;
}

function updateEditorChecklistCursor(root: HTMLElement, event: React.PointerEvent<HTMLDivElement>): boolean {
  if (!getChecklistItemForPointer(root, event)) return false;
  root.style.cursor = "pointer";
  return true;
}

type EditorPlainTextBoundary = {
  container: Node;
  offset: number;
};

function locateEditorPlainTextBoundary(root: HTMLElement, offset: number): EditorPlainTextBoundary {
  const target = Math.max(0, offset);
  let currentOffset = 0;

  const walk = (parent: Node): EditorPlainTextBoundary | null => {
    for (let index = 0; index < parent.childNodes.length; index += 1) {
      const child = parent.childNodes.item(index);
      if (child instanceof HTMLElement && child.getAttribute(EDITOR_MENTION_ATTRIBUTE) === "true") {
        const length = child.textContent?.length ?? 0;
        const nextOffset = currentOffset + length;
        if (target <= currentOffset) return { container: parent, offset: index };
        if (target <= nextOffset) return { container: parent, offset: index + 1 };
        currentOffset = nextOffset;
        continue;
      }
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
          return {
            container: parent,
            offset: index + (target > currentOffset ? 1 : 0),
          };
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

function setEditorSelectionByPlainTextOffsets(root: HTMLElement, start: number, end = start) {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const safeStart = Math.max(0, start);
  const safeEnd = Math.max(safeStart, end);
  const range = root.ownerDocument.createRange();
  const startBoundary = locateEditorPlainTextBoundary(root, safeStart);
  const endBoundary = locateEditorPlainTextBoundary(root, safeEnd);
  try {
    range.setStart(startBoundary.container, startBoundary.offset);
    range.setEnd(endBoundary.container, endBoundary.offset);
  } catch {
    return;
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function rangeIntersectsEditorImage(root: HTMLElement, range: Range): boolean {
  if (range.collapsed) return false;
  return Array.from(root.querySelectorAll(`span[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"]`)).some((node) => {
    try {
      return range.intersectsNode(node);
    } catch {
      return false;
    }
  });
}

function replaceTextByPlainTextOffsets(
  root: HTMLElement,
  start: number,
  end: number,
  text: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): boolean {
  if (start < 0 || end < start) return false;
  removeEditorTerminalBreaks(root);
  const range = root.ownerDocument.createRange();
  const startBoundary = locateEditorPlainTextBoundary(root, start);
  const endBoundary = locateEditorPlainTextBoundary(root, end);
  try {
    range.setStart(startBoundary.container, startBoundary.offset);
    range.setEnd(endBoundary.container, endBoundary.offset);
  } catch {
    return false;
  }
  if (rangeIntersectsEditorImage(root, range)) return false;
  range.deleteContents();
  if (text) {
    const textNode = root.ownerDocument.createTextNode(text);
    range.insertNode(textNode);
  }
  setEditorSelectionByPlainTextOffsets(root, selectionStart, selectionEnd);
  return true;
}

function readAutomaticOutlineLinePrefix(line: string): { prefix: string; indentation: string; body: string } | null {
  const match = /^([ \t\u00a0]*)(?:\d+(?:\.\d+)*|[a-z]+|[ivxlcdm]+)[.)][ \t\u00a0]*/i.exec(line);
  if (!match) return null;
  return {
    prefix: match[0],
    indentation: match[1],
    body: line.slice(match[0].length),
  };
}

function applyLineIndentEditToRichDocument(
  root: HTMLElement,
  currentText: string,
  edit: { value: string; selectionStart: number; selectionEnd?: number },
): boolean {
  const currentLines = currentText.split("\n");
  const nextLines = edit.value.split("\n");
  if (currentLines.length !== nextLines.length) return false;

  const changes: Array<{ start: number; end: number; text: string }> = [];
  let lineStart = 0;
  for (let index = 0; index < currentLines.length; index += 1) {
    const currentLine = currentLines[index];
    const nextLine = nextLines[index];
    if (nextLine !== currentLine) {
      if (nextLine === `${EDITOR_TAB_TEXT}${currentLine}`) {
        changes.push({ start: lineStart, end: lineStart, text: EDITOR_TAB_TEXT });
      } else {
        const currentOutline = readAutomaticOutlineLinePrefix(currentLine);
        const nextOutline = readAutomaticOutlineLinePrefix(nextLine);
        if (currentOutline && nextOutline && currentOutline.body === nextOutline.body) {
          changes.push({ start: lineStart, end: lineStart + currentOutline.prefix.length, text: nextOutline.prefix });
        } else if (currentOutline && nextLine === `${currentOutline.indentation}${currentOutline.body}`) {
          changes.push({ start: lineStart, end: lineStart + currentOutline.prefix.length, text: currentOutline.indentation });
        } else {
          const removableSpaces = Math.min(EDITOR_TAB_TEXT.length, currentLine.match(/^[ \u00a0]*/)?.[0].length ?? 0);
          const removeCount = currentLine.startsWith("\t") ? 1 : removableSpaces;
          if (removeCount <= 0 || nextLine !== currentLine.slice(removeCount)) return false;
          changes.push({ start: lineStart, end: lineStart + removeCount, text: "" });
        }
      }
    }
    lineStart += currentLine.length + 1;
  }
  if (changes.length === 0) return false;

  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    if (!replaceTextByPlainTextOffsets(root, change.start, change.end, change.text, change.start + change.text.length)) return false;
  }
  setEditorSelectionByPlainTextOffsets(root, edit.selectionStart, edit.selectionEnd ?? edit.selectionStart);
  return true;
}

function applyPlainTextEditToRichDocument(
  root: HTMLElement,
  currentText: string,
  edit: { value: string; selectionStart: number; selectionEnd?: number },
): boolean {
  if (edit.value === currentText) {
    setEditorSelectionByPlainTextOffsets(root, edit.selectionStart, edit.selectionEnd ?? edit.selectionStart);
    return true;
  }
  if (applyLineIndentEditToRichDocument(root, currentText, edit)) return true;

  let prefixLength = 0;
  const maxPrefixLength = Math.min(currentText.length, edit.value.length);
  while (prefixLength < maxPrefixLength && currentText[prefixLength] === edit.value[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maxSuffixLength = Math.min(currentText.length - prefixLength, edit.value.length - prefixLength);
  while (
    suffixLength < maxSuffixLength &&
    currentText[currentText.length - 1 - suffixLength] === edit.value[edit.value.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const replaceStart = prefixLength;
  const replaceEnd = currentText.length - suffixLength;
  const replacementText = edit.value.slice(prefixLength, edit.value.length - suffixLength);
  return replaceTextByPlainTextOffsets(
    root,
    replaceStart,
    replaceEnd,
    replacementText,
    edit.selectionStart,
    edit.selectionEnd ?? edit.selectionStart,
  );
}

function deleteTextByOffsets(root: HTMLElement, start: number, end: number, options: { preserveTrailingNewline?: boolean } = {}): boolean {
  if (start < 0 || end < start) return false;
  removeEditorTerminalBreaks(root);
  setEditorSelectionByOffsets(root, start, end);
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  range.deleteContents();
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  if (options.preserveTrailingNewline) {
    const terminalBreak = root.ownerDocument.createElement("br");
    terminalBreak.setAttribute(EDITOR_TERMINAL_BREAK_ATTRIBUTE, "true");
    root.appendChild(terminalBreak);
  }
  return true;
}

function getPreviousEditableSiblingAnchor(root: HTMLElement, node: Node): HTMLAnchorElement | null {
  let current: Node | null = node.previousSibling;
  while (current) {
    if (current.nodeType === Node.TEXT_NODE && (current.textContent ?? "").length === 0) {
      current = current.previousSibling;
      continue;
    }
    if (current instanceof HTMLAnchorElement && root.contains(current)) return current;
    return null;
  }
  return null;
}

function getCollapsedAnchorAtSelectionEnd(root: HTMLElement): HTMLAnchorElement | null {
  const range = getEditorSelectionRange(root);
  if (!range || !range.collapsed) return null;
  const container = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as Element
    : range.startContainer.parentElement;
  const anchor = container?.closest("a[href]") as HTMLAnchorElement | null;
  if (anchor && root.contains(anchor)) {
    const afterRange = root.ownerDocument.createRange();
    afterRange.selectNodeContents(anchor);
    try {
      afterRange.setStart(range.startContainer, range.startOffset);
    } catch {
      return null;
    }
    return afterRange.toString().length === 0 ? anchor : null;
  }

  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const element = range.startContainer as Element;
    const previousChild = range.startOffset > 0 ? element.childNodes.item(range.startOffset - 1) : null;
    if (previousChild instanceof HTMLAnchorElement && root.contains(previousChild)) return previousChild;
    if (previousChild?.nodeType === Node.TEXT_NODE && (previousChild.textContent ?? "").length === 0) {
      return getPreviousEditableSiblingAnchor(root, previousChild);
    }
    if (previousChild) return null;
  }

  if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
    return getPreviousEditableSiblingAnchor(root, range.startContainer);
  }

  return null;
}

function insertPlainTextAfterAnchor(root: HTMLElement, anchor: HTMLAnchorElement, text: string, options: { preserveTrailingNewline?: boolean } = {}): boolean {
  removeEditorTerminalBreaks(root);
  const textNode = root.ownerDocument.createTextNode(text);
  anchor.after(textNode);
  if (options.preserveTrailingNewline) {
    const terminalBreak = root.ownerDocument.createElement("br");
    terminalBreak.setAttribute(EDITOR_TERMINAL_BREAK_ATTRIBUTE, "true");
    textNode.after(terminalBreak);
  }
  const range = root.ownerDocument.createRange();
  range.setStart(textNode, textNode.data.length);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function appendTextToAnchorEnd(root: HTMLElement, anchor: HTMLAnchorElement, text: string): boolean {
  const currentHref = getEditorLinkHrefForText(anchor.textContent ?? "");
  const shouldSyncHrefToText = currentHref !== null && anchor.href === currentHref;
  const walker = root.ownerDocument.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
  let lastTextNode: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    lastTextNode = node;
  }
  if (!lastTextNode) {
    lastTextNode = root.ownerDocument.createTextNode("");
    anchor.appendChild(lastTextNode);
  }
  lastTextNode.data += text;
  const nextHref = shouldSyncHrefToText ? getEditorLinkHrefForText(anchor.textContent ?? "") : null;
  if (nextHref) anchor.href = nextHref;

  const range = root.ownerDocument.createRange();
  range.setStart(lastTextNode, lastTextNode.data.length);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function isHyperlinkDividerText(text: string): boolean {
  return /[ \t\r\n]/.test(text);
}

function scrollEditorToLineStart(root: HTMLElement) {
  root.scrollLeft = 0;
  window.requestAnimationFrame(() => {
    root.scrollLeft = 0;
  });
}

function commitEditorDocument(root: HTMLElement, scheduleDocumentSave: (nextText: string, immediate?: boolean) => void, scheduleIndentGuideUpdate: (text: string) => void, immediate = false) {
  applyEditorListMarkerStyles(root);
  const plainText = readEditorDocumentText(root);
  scheduleDocumentSave(serializeEditorDocumentHTML(root), immediate);
  scheduleIndentGuideUpdate(plainText);
}

function snapshotEditorDocumentRoot(root: HTMLElement, serializedHTML?: string, fallbackTextLength?: number): EditorDocumentUndoSnapshot {
  const offsets = getEditorSelectionOffsets(root);
  const fallbackOffset = offsets
    ? 0
    : fallbackTextLength ?? readEditorDocumentText(root).length;
  return snapshotEditorDocumentHTML(
    serializedHTML ?? serializeEditorDocumentHTML(root),
    offsets?.start ?? fallbackOffset,
    offsets?.end ?? fallbackOffset,
  );
}

function recordEditorDocumentMutation(
  history: EditorDocumentUndoHistory,
  root: HTMLElement,
  before: EditorDocumentUndoSnapshot | null,
  kind: EditorDocumentChangeKind,
) {
  if (!before) return;
  recordEditorDocumentUndoChange(history, before, snapshotEditorDocumentRoot(root), kind);
}

function commitEditorNativeInputBatch(
  batch: PendingEditorNativeInputBatch,
  history: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
): string {
  const { root, before, kind } = batch;
  applyEditorListMarkerStyles(root);
  const plainText = readEditorDocumentText(root);
  const html = serializeEditorDocumentHTML(root);
  const after = snapshotEditorDocumentRoot(root, html, plainText.length);
  if (before) recordEditorDocumentUndoChange(history, before, after, kind);
  // The DOM batching window is the collaboration batching boundary. Queue one
  // durable HTML delta now and bypass the controller's second debounce.
  scheduleDocumentSave(html, true);
  scheduleIndentGuideUpdate(plainText);
  return html;
}

function insertEditorTable(
  root: HTMLElement,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
): boolean {
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  const undoBefore = snapshotEditorDocumentRoot(root);
  removeEditorTerminalBreaks(root);
  const table = createEditorTableElement(root.ownerDocument);
  const rootMetrics = getEditorRootContentMetrics(root);
  const defaultTableWidthPercent = Math.max(
    EDITOR_TABLE_DEFAULT_INSERT_MIN_WIDTH_PERCENT,
    Math.min(EDITOR_TABLE_DEFAULT_INSERT_MAX_WIDTH_PERCENT, (EDITOR_TABLE_DEFAULT_INSERT_WIDTH_PX / Math.max(1, rootMetrics.width)) * 100),
  );
  applyEditorTableLayout(table, defaultTableWidthPercent, 0);
  const afterTable = root.ownerDocument.createElement("br");
  const fragment = root.ownerDocument.createDocumentFragment();
  fragment.append(table, afterTable);
  range.deleteContents();
  range.insertNode(fragment);
  const firstCell = table.querySelector(`[${EDITOR_TABLE_CELL_ATTRIBUTE}="true"]`);
  if (firstCell instanceof HTMLTableCellElement) setSelectionInEditorTableCell(root, firstCell);
  recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
  return true;
}

function restoreEditorDocumentUndoSnapshot(
  root: HTMLElement,
  snapshot: EditorDocumentUndoSnapshot,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
  onSelectionFontSizeChange: (fontSize: number) => void,
  onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void,
  onSelectionHighlightColorChange?: (color: EditorHighlightColor | null) => void,
  onSelectionTextAlignmentChange?: (alignment: EditorTextAlignment) => void,
) {
  root.innerHTML = deserializeEditorDocumentHTML(snapshot.html);
  refreshEditorAttachmentImageFrames(root);
  setEditorSelectionByOffsets(root, snapshot.selectionStart, snapshot.selectionEnd);
  clearEditorImageSelection(root);
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
  syncSelectionFormatState(root, onSelectionFontSizeChange, onSelectionInlineFormatChange, onSelectionHighlightColorChange, onSelectionTextAlignmentChange);
}

function applyEditorUndoCommand(
  root: HTMLElement,
  history: EditorDocumentUndoHistory,
  direction: "undo" | "redo",
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
  onSelectionFontSizeChange: (fontSize: number) => void,
  onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void,
  onSelectionHighlightColorChange?: (color: EditorHighlightColor | null) => void,
  onSelectionTextAlignmentChange?: (alignment: EditorTextAlignment) => void,
): boolean {
  const currentHTML = serializeEditorDocumentHTML(root);
  const snapshot = direction === "undo"
    ? undoEditorDocument(history, currentHTML)
    : redoEditorDocument(history, currentHTML);
  if (!snapshot) return false;
  restoreEditorDocumentUndoSnapshot(root, snapshot, scheduleDocumentSave, scheduleIndentGuideUpdate, onSelectionFontSizeChange, onSelectionInlineFormatChange, onSelectionHighlightColorChange, onSelectionTextAlignmentChange);
  return true;
}

type RichTextMentionDraft = ActiveMentionDraft & {
  left: number;
  top: number;
  position: "fixed" | "absolute";
};

type RichTextTableContextMenu = {
  left: number;
  top: number;
  position: "fixed" | "absolute";
  root: HTMLElement;
  mode: "editor" | "table";
  rows: number;
  columns: number;
};

type EditorImagePreviewDraft = {
  src: string;
  label: string;
  html: string;
  attachmentID?: string;
  filename?: string;
  mimeType?: string;
  width: number;
  height: number;
};

function previewEditorImageFrame(
  root: HTMLElement,
  frame: HTMLSpanElement,
  onPreviewImage?: (preview: EditorImagePreviewDraft) => void,
): boolean {
  const data = readEditorImageData(frame);
  if (!data || !onPreviewImage) return false;
  onPreviewImage({
    src: data.src,
    label: "Editor image",
    html: createEditorImageClipboardHTML(root.ownerDocument, data),
    attachmentID: data.attachmentID,
    filename: data.filename,
    mimeType: data.mimeType,
    width: data.width,
    height: data.height,
  });
  return true;
}

const EDITOR_MENTION_MENU_WIDTH_PX = 320;
const EDITOR_MENTION_MENU_MAX_HEIGHT_PX = 242;
const EDITOR_MENTION_MENU_MARGIN_PX = 8;
const EDITOR_TABLE_CONTEXT_MENU_WIDTH_PX = 230;
const EDITOR_TABLE_CONTEXT_MENU_MAX_HEIGHT_PX = 330;

function closestMentionElement(root: HTMLElement, node: Node | null): HTMLElement | null {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const mention = element?.closest?.("[data-mango-mention='true']") as HTMLElement | null;
  return mention && root.contains(mention) ? mention : null;
}

function getCaretRect(root: HTMLElement, range: Range): DOMRect {
  const rect = range.getBoundingClientRect();
  if (Number.isFinite(rect.left) && Number.isFinite(rect.top) && (rect.width > 0 || rect.height > 0)) return rect;
  const usefulRect = Array.from(range.getClientRects()).find((item) => item.width > 0 || item.height > 0);
  if (usefulRect) return usefulRect;
  return root.getBoundingClientRect();
}

function readRichTextMentionDraft(root: HTMLElement, position: "fixed" | "absolute" = "fixed"): RichTextMentionDraft | null {
  const range = getEditorSelectionRange(root);
  if (!range || !range.collapsed || closestMentionElement(root, range.startContainer)) return null;
  const beforeRange = range.cloneRange();
  beforeRange.selectNodeContents(root);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const beforeCaret = beforeRange.toString();
  const draft = readActiveMentionDraft(beforeCaret, beforeCaret.length);
  if (!draft) return null;

  const rect = getCaretRect(root, range);
  const container = position === "absolute" ? root.parentElement : null;
  const containerRect = container?.getBoundingClientRect() ?? null;
  const rootRect = root.getBoundingClientRect();
  const view = root.ownerDocument.defaultView;
  const viewportWidth = view?.innerWidth ?? 1280;
  const viewportHeight = view?.innerHeight ?? 720;
  const coordinateLeft = position === "absolute" && containerRect ? rect.left - containerRect.left : rect.left;
  const coordinateTop = position === "absolute" && containerRect ? rect.bottom - containerRect.top + 6 : rect.bottom + 6;
  const boundaryLeft = position === "absolute" && containerRect ? 0 : rootRect.left;
  const boundaryRight = position === "absolute" && containerRect ? containerRect.width : rootRect.right;
  const boundaryHeight = position === "absolute" && containerRect ? containerRect.height : viewportHeight;
  const editorMinLeft = Number.isFinite(boundaryLeft) ? boundaryLeft + EDITOR_MENTION_MENU_MARGIN_PX : EDITOR_MENTION_MENU_MARGIN_PX;
  const editorMaxLeft = Number.isFinite(boundaryRight)
    ? boundaryRight - EDITOR_MENTION_MENU_WIDTH_PX - EDITOR_MENTION_MENU_MARGIN_PX
    : viewportWidth - EDITOR_MENTION_MENU_WIDTH_PX - EDITOR_MENTION_MENU_MARGIN_PX;
  const viewportMaxLeft = viewportWidth - EDITOR_MENTION_MENU_WIDTH_PX - EDITOR_MENTION_MENU_MARGIN_PX;
  const minLeft = position === "absolute"
    ? Math.max(EDITOR_MENTION_MENU_MARGIN_PX, editorMinLeft)
    : Math.max(EDITOR_MENTION_MENU_MARGIN_PX, Math.min(editorMinLeft, viewportMaxLeft));
  const maxLeft = Math.max(minLeft, position === "absolute" ? editorMaxLeft : Math.min(editorMaxLeft, viewportMaxLeft));
  const maxTop = boundaryHeight - EDITOR_MENTION_MENU_MAX_HEIGHT_PX - EDITOR_MENTION_MENU_MARGIN_PX;
  return {
    ...draft,
    left: Math.max(minLeft, Math.min(coordinateLeft, maxLeft)),
    top: Math.max(EDITOR_MENTION_MENU_MARGIN_PX, Math.min(coordinateTop, maxTop)),
    position,
  };
}

function getEditorContextMenuPosition(root: HTMLElement, clientX: number, clientY: number, position: "fixed" | "absolute") {
  const container = position === "absolute" ? root.parentElement : null;
  const containerRect = container?.getBoundingClientRect() ?? null;
  const rootRect = root.getBoundingClientRect();
  const view = root.ownerDocument.defaultView;
  const viewportWidth = view?.innerWidth ?? 1280;
  const viewportHeight = view?.innerHeight ?? 720;
  const coordinateLeft = position === "absolute" && containerRect ? clientX - containerRect.left : clientX;
  const coordinateTop = position === "absolute" && containerRect ? clientY - containerRect.top : clientY;
  const boundaryLeft = position === "absolute" && containerRect ? 0 : rootRect.left;
  const boundaryRight = position === "absolute" && containerRect ? containerRect.width : rootRect.right;
  const boundaryHeight = position === "absolute" && containerRect ? containerRect.height : viewportHeight;
  const editorMinLeft = Number.isFinite(boundaryLeft) ? boundaryLeft + EDITOR_MENTION_MENU_MARGIN_PX : EDITOR_MENTION_MENU_MARGIN_PX;
  const editorMaxLeft = Number.isFinite(boundaryRight)
    ? boundaryRight - EDITOR_TABLE_CONTEXT_MENU_WIDTH_PX - EDITOR_MENTION_MENU_MARGIN_PX
    : viewportWidth - EDITOR_TABLE_CONTEXT_MENU_WIDTH_PX - EDITOR_MENTION_MENU_MARGIN_PX;
  const viewportMaxLeft = viewportWidth - EDITOR_TABLE_CONTEXT_MENU_WIDTH_PX - EDITOR_MENTION_MENU_MARGIN_PX;
  const minLeft = position === "absolute"
    ? Math.max(EDITOR_MENTION_MENU_MARGIN_PX, editorMinLeft)
    : Math.max(EDITOR_MENTION_MENU_MARGIN_PX, Math.min(editorMinLeft, viewportMaxLeft));
  const maxLeft = Math.max(minLeft, position === "absolute" ? editorMaxLeft : Math.min(editorMaxLeft, viewportMaxLeft));
  const maxTop = boundaryHeight - EDITOR_TABLE_CONTEXT_MENU_MAX_HEIGHT_PX - EDITOR_MENTION_MENU_MARGIN_PX;
  return {
    left: Math.max(minLeft, Math.min(coordinateLeft, maxLeft)),
    top: Math.max(EDITOR_MENTION_MENU_MARGIN_PX, Math.min(coordinateTop, Math.max(EDITOR_MENTION_MENU_MARGIN_PX, maxTop))),
    position,
  };
}

function setEditorCaretFromPoint(root: HTMLElement, clientX: number, clientY: number) {
  const ownerDocument = root.ownerDocument;
  let range = getDocumentCaretRangeFromPoint(ownerDocument, clientX, clientY);
  if (!range || !rootContainsRange(root, range)) {
    const rootRect = root.getBoundingClientRect();
    range = createRootBoundaryRange(root, clientY > rootRect.top + rootRect.height / 2);
  }
  if (!range) return;
  range.collapse(true);
  const selection = ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function replaceEditorMentionDraft(
  root: HTMLElement,
  mention: ActiveMentionDraft,
  user: MentionableCompanyUser,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
) {
  const undoBefore = snapshotEditorDocumentRoot(root);
  removeEditorTerminalBreaks(root);
  setEditorSelectionByOffsets(root, mention.start, mention.end);
  const range = getEditorSelectionRange(root);
  if (!range) return;
  const mentionElement = createEditorMentionElement(root.ownerDocument, user, mention.trigger);
  const trailingSpace = root.ownerDocument.createTextNode(" ");
  const fragment = root.ownerDocument.createDocumentFragment();
  fragment.append(mentionElement, trailingSpace);
  range.deleteContents();
  range.insertNode(fragment);
  range.setStart(trailingSpace, trailingSpace.data.length);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, "typing");
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
}

function initialsForMentionName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : parts[0]?.[1] ?? "";
  return `${first}${second}`.toUpperCase();
}

function isEditorUndoShortcut(event: React.KeyboardEvent<HTMLDivElement>): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z" && !event.shiftKey;
}

function isEditorRedoShortcut(event: React.KeyboardEvent<HTMLDivElement>): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  const key = event.key.toLowerCase();
  return (key === "z" && event.shiftKey) || key === "y";
}

function copySelectedEditorImage(root: HTMLElement, clipboardData: DataTransfer, attachmentContext?: EditorImageAttachmentContext): boolean {
  const frame = getSelectedEditorImageFrame(root);
  if (!frame) return false;
  const data = readEditorImageData(frame);
  if (!data) return false;
  const html = createEditorImageClipboardHTML(root.ownerDocument, data);
  if (!writeImageClipboardData(clipboardData, data.src, html)) return false;
  const attachmentID = data.attachmentID?.trim() ?? "";
  writeEditorImageToSystemClipboard(
    root.ownerDocument,
    data,
    attachmentID && editorImageAttachmentContextReady(attachmentContext)
      ? () => fetchMangoAttachmentBlob(attachmentContext.apiBase, attachmentContext.companyID, attachmentID, "original")
      : data.src.startsWith("blob:") ? async () => {
        const response = await fetch(data.src);
        if (!response.ok) throw new Error("failed_to_read_editor_image");
        return response.blob();
      } : undefined,
  );
  return true;
}

function editorImageTransferHTMLKind(ownerDocument: Document, html: string): EditorImageTransferHTMLKind {
  if (!html.trim()) return "none";
  return editorClipboardHTMLContainsOnlyOneImage(ownerDocument, html) ? "single-image" : "other";
}

function selectedHTMLPreservesEditorList(html: string): boolean {
  return html.includes(EDITOR_LIST_ATTRIBUTE) || html.includes(EDITOR_LIST_ITEM_ATTRIBUTE);
}

function createSingleSelectedEditorListItemHTML(root: HTMLElement, range: Range, selectedHTML: string): string | null {
  const startItem = getClosestEditorListItem(root, range.startContainer);
  const endItem = getClosestEditorListItem(root, range.endContainer);
  if (!startItem || startItem !== endItem) return null;
  const kind = getEditorListKindForItem(startItem);
  if (!kind) return null;

  const item = root.ownerDocument.createElement("li");
  item.setAttribute(EDITOR_LIST_ITEM_ATTRIBUTE, kind);
  if (kind === "checklist") {
    item.setAttribute(
      EDITOR_CHECKLIST_CHECKED_ATTRIBUTE,
      startItem.getAttribute(EDITOR_CHECKLIST_CHECKED_ATTRIBUTE) === "true" ? "true" : "false",
    );
  }

  if (selectedHTML.trim()) {
    const template = root.ownerDocument.createElement("template");
    template.innerHTML = selectedHTML;
    item.appendChild(template.content);
  } else {
    item.appendChild(root.ownerDocument.createTextNode(range.toString()));
  }
  if (!(item.textContent ?? "").trim() && item.querySelectorAll("*").length === 0) return null;

  const list = root.ownerDocument.createElement("ul");
  list.setAttribute(EDITOR_LIST_ATTRIBUTE, kind);
  list.appendChild(item);
  return sanitizeEditorDocumentHTML(list.outerHTML);
}

function copySelectedEditorDocumentFragment(root: HTMLElement, clipboardData: DataTransfer): boolean {
  const range = getEditorSelectionRange(root);
  if (!range || range.collapsed) return false;
  const container = root.ownerDocument.createElement("div");
  container.appendChild(range.cloneContents());
  let html = sanitizeEditorDocumentHTML(container.innerHTML);
  const text = range.toString();
  if (!selectedHTMLPreservesEditorList(html)) {
    html = createSingleSelectedEditorListItemHTML(root, range, html) ?? html;
  }
  if (!html.trim() && !text.trim()) return false;
  clipboardData.setData("text/html", html);
  clipboardData.setData("text/plain", text);
  return true;
}

function getFontSizeElementForNode(root: HTMLElement, node: Node | null): Element {
  if (!node) return root;
  if (node.nodeType === Node.TEXT_NODE) return node.parentElement ?? root;
  return node instanceof Element ? node : root;
}

function getRangeFontSizeElement(root: HTMLElement, range: Range): Element {
  if (range.startContainer.nodeType !== Node.ELEMENT_NODE) return getFontSizeElementForNode(root, range.startContainer);
  const element = range.startContainer as Element;
  const nextChild = element.childNodes.item(range.startOffset);
  const previousChild = range.startOffset > 0 ? element.childNodes.item(range.startOffset - 1) : null;
  return getFontSizeElementForNode(root, nextChild ?? previousChild ?? element);
}

function readSelectionHighlightColor(root: HTMLElement, element: Element): EditorHighlightColor | null {
  let current: Element | null = element;
  while (current && current !== root) {
    if (current instanceof HTMLElement) {
      const highlight = readEditorElementHighlight(current);
      if (highlight.explicit) return highlight.color;
    }
    current = current.parentElement;
  }
  return null;
}

function tagNameIndicatesInlineFormat(element: Element, command: EditorInlineStyleCommand): boolean {
  const tagName = element.tagName.toLowerCase();
  if (command === "bold") return tagName === "b" || tagName === "strong";
  if (command === "underline") return tagName === "u";
  if (command === "italic") return tagName === "i" || tagName === "em";
  return tagName === "s" || tagName === "strike" || tagName === "del";
}

function computedStyleIndicatesInlineFormat(element: Element, command: EditorInlineStyleCommand): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(element);
  if (command === "bold") {
    const weight = Number.parseInt(style.fontWeight, 10);
    return Number.isFinite(weight) ? weight >= 600 : style.fontWeight === "bold" || style.fontWeight === "bolder";
  }
  if (command === "italic") return style.fontStyle === "italic" || style.fontStyle === "oblique";
  const decoration = command === "strikethrough" ? "line-through" : "underline";
  return style.textDecorationLine.split(/\s+/).includes(decoration)
    || style.textDecoration.includes(decoration);
}

function readElementInlineFormat(root: HTMLElement, element: Element, command: EditorInlineStyleCommand): boolean {
  let current: Element | null = element;
  while (current && current !== root) {
    if (tagNameIndicatesInlineFormat(current, command) || computedStyleIndicatesInlineFormat(current, command)) return true;
    current = current.parentElement;
  }
  return computedStyleIndicatesInlineFormat(root, command);
}

function readDocumentCommandState(root: HTMLElement, command: EditorInlineStyleCommand): boolean | null {
  if (typeof root.ownerDocument.queryCommandState !== "function") return null;
  try {
    return root.ownerDocument.queryCommandState(command === "strikethrough" ? "strikeThrough" : command);
  } catch {
    return null;
  }
}


function readSelectionTextAlignment(root: HTMLElement, element: Element): EditorTextAlignment {
  const cell = getClosestEditorTableCell(root, element);
  const table = getEditorTableForCell(root, cell);
  const tableAlignment = table ? readEditorTableTextAlign(table) : null;
  if (cell && tableAlignment) return tableAlignment;
  let current: Element | null = element;
  while (current && current !== root) {
    if (current instanceof HTMLElement) {
      const alignment = readEditorTextAlign(current);
      if (alignment) return alignment;
    }
    current = current.parentElement;
  }
  const computed = root.ownerDocument.defaultView?.getComputedStyle(element).textAlign;
  return computed === "center" || computed === "right" ? computed : "left";
}
export function readEditorSelectionFormatState(root: HTMLElement, fallbackFontSize = EDITOR_DOCUMENT_FONT_SIZE_PX): EditorSelectionFormatState | null {
  const range = getEditorSelectionRange(root);
  if (!range) return null;
  const view = root.ownerDocument.defaultView;
  if (!view) return null;
  const selectedTextRun = range.collapsed ? null : editorSelectedTextRuns(root, range)[0] ?? null;
  const element = selectedTextRun?.node.parentElement ?? getRangeFontSizeElement(root, range);
  const parsed = Number.parseFloat(view.getComputedStyle(element).fontSize);
  const boldCommandState = readDocumentCommandState(root, "bold");
  const underlineCommandState = readDocumentCommandState(root, "underline");
  const italicCommandState = readDocumentCommandState(root, "italic");
  const strikethroughCommandState = readDocumentCommandState(root, "strikethrough");
  return {
    fontSize: Number.isFinite(parsed) ? clampEditorFontSize(parsed) : clampEditorFontSize(fallbackFontSize),
    bold: boldCommandState ?? readElementInlineFormat(root, element, "bold"),
    underline: underlineCommandState ?? readElementInlineFormat(root, element, "underline"),
    italic: italicCommandState ?? readElementInlineFormat(root, element, "italic"),
    strikethrough: strikethroughCommandState ?? readElementInlineFormat(root, element, "strikethrough"),
    highlightColor: readSelectionHighlightColor(root, element),
    textAlignment: readSelectionTextAlignment(root, element),
  };
}

function syncSelectionFormatState(
  root: HTMLElement,
  onSelectionFontSizeChange: (fontSize: number) => void,
  onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void,
  onSelectionHighlightColorChange?: (color: EditorHighlightColor | null) => void,
  onSelectionTextAlignmentChange?: (alignment: EditorTextAlignment) => void,
) {
  const state = readEditorSelectionFormatState(root);
  if (!state) return;
  onSelectionFontSizeChange(state.fontSize);
  onSelectionInlineFormatChange?.({ bold: state.bold, underline: state.underline, italic: state.italic, strikethrough: state.strikethrough });
  onSelectionHighlightColorChange?.(state.highlightColor);
  onSelectionTextAlignmentChange?.(state.textAlignment);
}

export function applyEditorInlineFormatToRoot(
  root: HTMLElement,
  command: EditorInlineStyleCommand,
  options: {
    documentUndoHistory: EditorDocumentUndoHistory;
    scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
    scheduleIndentGuideUpdate: (text: string) => void;
    pendingEditorInlineFormatRef: React.MutableRefObject<EditorSelectionInlineFormatState | null>;
    pendingEditorTypingCaretRef: React.MutableRefObject<EditorTypingCaretBookmark | null>;
    onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void;
  },
): boolean {
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  root.focus({ preventScroll: true });
  const currentState = readEditorSelectionFormatState(root);
  const currentInline = options.pendingEditorInlineFormatRef.current ?? {
    bold: currentState?.bold ?? false,
    underline: currentState?.underline ?? false,
    italic: currentState?.italic ?? false,
    strikethrough: currentState?.strikethrough ?? false,
  };
  const nextInline = { ...currentInline, [command]: !currentInline[command] };
  if (range.collapsed) {
    options.pendingEditorInlineFormatRef.current = nextInline;
    options.pendingEditorTypingCaretRef.current = getEditorTypingCaretBookmark(root);
    try {
      root.ownerDocument.execCommand(command === "strikethrough" ? "strikeThrough" : command, false);
    } catch {
      // Explicit pending state is authoritative when native command state is unavailable.
    }
    options.onSelectionInlineFormatChange?.(nextInline);
    return true;
  }
  const undoBefore = snapshotEditorDocumentRoot(root);
  const selectionOffsets = getEditorSelectionOffsets(root);
  let applied = false;
  try {
    applied = root.ownerDocument.execCommand(command === "strikethrough" ? "strikeThrough" : command, false);
  } catch {
    applied = false;
  }
  if (!applied) {
    applied = wrapEditorSelectedTextRunsWithInlineFormat(root, range, nextInline);
    if (selectionOffsets) setEditorSelectionByOffsets(root, selectionOffsets.start, selectionOffsets.end);
  }
  if (!applied) return false;
  options.pendingEditorInlineFormatRef.current = null;
  options.pendingEditorTypingCaretRef.current = null;
  recordEditorDocumentMutation(options.documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, options.scheduleDocumentSave, options.scheduleIndentGuideUpdate);
  const nextState = readEditorSelectionFormatState(root);
  if (nextState) options.onSelectionInlineFormatChange?.({ bold: nextState.bold, underline: nextState.underline, italic: nextState.italic, strikethrough: nextState.strikethrough });
  return true;
}

export function applyEditorTextAlignmentToRoot(
  root: HTMLElement,
  alignment: EditorTextAlignment,
  options: {
    documentUndoHistory: EditorDocumentUndoHistory;
    scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
    scheduleIndentGuideUpdate: (text: string) => void;
    onSelectionTextAlignmentChange?: (alignment: EditorTextAlignment) => void;
  },
): boolean {
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  root.focus({ preventScroll: true });
  const undoBefore = snapshotEditorDocumentRoot(root);
  const selectionOffsets = getEditorSelectionOffsets(root);
  const table = getEditorTableForCell(root, getCurrentEditorTableCell(root));
  let applied = false;
  if (table) {
    normalizeEditorTable(table);
    applyEditorTableTextAlign(table, alignment);
    applied = true;
  } else {
    const command = alignment === "center" ? "justifyCenter" : alignment === "right" ? "justifyRight" : "justifyLeft";
    try {
      applied = root.ownerDocument.execCommand(command, false);
    } catch {
      applied = false;
    }
  }
  if (!applied) return false;
  if (selectionOffsets) setEditorSelectionByOffsets(root, selectionOffsets.start, selectionOffsets.end);
  recordEditorDocumentMutation(options.documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, options.scheduleDocumentSave, options.scheduleIndentGuideUpdate, Boolean(table));
  options.onSelectionTextAlignmentChange?.(alignment);
  return true;
}

export function applyEditorLinkToRoot(
  root: HTMLElement,
  href: string,
  options: {
    documentUndoHistory: EditorDocumentUndoHistory;
    scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
    scheduleIndentGuideUpdate: (text: string) => void;
  },
): boolean {
  const cleanHref = getEditorLinkHrefForText(href.trim());
  if (!cleanHref) return false;
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  root.focus({ preventScroll: true });
  const undoBefore = snapshotEditorDocumentRoot(root);
  const selectedText = range.toString().trim();
  const anchor = root.ownerDocument.createElement("a");
  anchor.href = cleanHref;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.style.color = EDITOR_LINK_COLOR;
  anchor.style.textDecoration = "underline";
  anchor.style.cursor = "pointer";
  anchor.textContent = selectedText || cleanHref;
  range.deleteContents();
  range.insertNode(anchor);
  selectElementContents(anchor);
  recordEditorDocumentMutation(options.documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, options.scheduleDocumentSave, options.scheduleIndentGuideUpdate);
  return true;
}

function readStylePixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getEditorRootContentMetrics(root: HTMLElement): { left: number; width: number } {
  const rootRect = root.getBoundingClientRect();
  const view = root.ownerDocument.defaultView;
  const style = view?.getComputedStyle(root);
  const paddingLeft = style ? readStylePixels(style.paddingLeft, 0) : 0;
  const paddingRight = style ? readStylePixels(style.paddingRight, 0) : 0;
  return {
    left: rootRect.left + paddingLeft,
    width: Math.max(0, root.clientWidth - paddingLeft - paddingRight),
  };
}

function getDocumentCaretRangeFromPoint(ownerDocument: Document, x: number, y: number): Range | null {
  const documentWithCaret = ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caretPosition = documentWithCaret.caretPositionFromPoint?.(x, y);
  if (caretPosition) {
    const range = ownerDocument.createRange();
    range.setStart(caretPosition.offsetNode, caretPosition.offset);
    range.collapse(true);
    return range;
  }
  return documentWithCaret.caretRangeFromPoint?.(x, y) ?? null;
}

function createRootBoundaryRange(root: HTMLElement, atEnd: boolean): Range {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.collapse(!atEnd);
  return range;
}

function restoreImageFrame(frame: HTMLSpanElement, parent: Node, nextSibling: ChildNode | null) {
  if (nextSibling && nextSibling.parentNode === parent) {
    parent.insertBefore(frame, nextSibling);
    return;
  }
  parent.appendChild(frame);
}

function reanchorEditorImageForVisualTop(root: HTMLElement, frame: HTMLSpanElement, visualTop: number): boolean {
  const originalParent = frame.parentNode;
  if (!originalParent) return false;
  const originalNextSibling = frame.nextSibling;
  const ownerDocument = root.ownerDocument;
  const rootRect = root.getBoundingClientRect();
  const rootMetrics = getEditorRootContentMetrics(root);
  const x = rootMetrics.left + Math.max(1, Math.min(rootMetrics.width - 1, 8));
  frame.remove();

  let range: Range | null = null;
  if (visualTop <= rootRect.top) {
    range = createRootBoundaryRange(root, false);
  } else if (visualTop >= rootRect.bottom) {
    range = createRootBoundaryRange(root, true);
  } else {
    const y = Math.max(rootRect.top + 1, Math.min(rootRect.bottom - 1, visualTop));
    range = getDocumentCaretRangeFromPoint(ownerDocument, x, y);
    if (!range || !rootContainsRange(root, range)) range = createRootBoundaryRange(root, visualTop > rootRect.top + rootRect.height / 2);
  }

  if (!range) {
    restoreImageFrame(frame, originalParent, originalNextSibling);
    return false;
  }

  try {
    range.insertNode(frame);
    return true;
  } catch {
    restoreImageFrame(frame, originalParent, originalNextSibling);
    return false;
  }
}

function updateEditorImageCursor(root: HTMLElement, target: EventTarget | null, clientX: number, clientY: number): boolean {
  const frame = findEditorImageFrame(root, target);
  if (!frame) return false;
  const frameRect = frame.getBoundingClientRect();
  const interaction = getEditorImagePointerInteraction(
    frameRect.width,
    frameRect.height,
    clientX - frameRect.left,
    clientY - frameRect.top,
  );
  frame.style.cursor = getEditorImageCursorForInteraction(interaction);
  return true;
}

function removeSelectedEditorImage(root: HTMLElement): boolean {
  const frame = getSelectedEditorImageFrame(root);
  if (!frame) return false;
  frame.remove();
  return true;
}

const EDITOR_TABLE_POINTER_EDGE_PX = 7;
const EDITOR_TABLE_EXTEND_HANDLE_PX = 16;
const EDITOR_TABLE_MIN_COLUMN_WIDTH_PX = 56;
const EDITOR_TABLE_MIN_WIDTH_PX = 160;
const EDITOR_TABLE_EXTEND_COLUMN_STEP_PX = 74;
const EDITOR_TABLE_EXTEND_ROW_STEP_PX = 32;
const EDITOR_TABLE_DEFAULT_INSERT_WIDTH_PX = 560;
const EDITOR_TABLE_DEFAULT_INSERT_MIN_WIDTH_PERCENT = 36;
const EDITOR_TABLE_DEFAULT_INSERT_MAX_WIDTH_PERCENT = 68;

type EditorTablePointerInteraction =
  | { kind: "resize-column"; table: HTMLTableElement; dividerColumnIndex: number }
  | { kind: "resize-table"; table: HTMLTableElement; edge: "left" | "right" }
  | { kind: "extend"; table: HTMLTableElement };

function getEditorTableCellNearPoint(table: HTMLTableElement, clientX: number, clientY: number): HTMLTableCellElement | null {
  for (const row of getEditorTableRows(table)) {
    for (const cell of getEditorTableCells(row)) {
      const rect = cell.getBoundingClientRect();
      if (
        clientX >= rect.left - EDITOR_TABLE_POINTER_EDGE_PX
        && clientX <= rect.right + EDITOR_TABLE_POINTER_EDGE_PX
        && clientY >= rect.top - EDITOR_TABLE_POINTER_EDGE_PX
        && clientY <= rect.bottom + EDITOR_TABLE_POINTER_EDGE_PX
      ) {
        return cell;
      }
    }
  }
  return null;
}

function getEditorTableDividerColumnNearPoint(table: HTMLTableElement, clientX: number, clientY: number): number | null {
  const tableRect = table.getBoundingClientRect();
  if (
    clientY < tableRect.top - EDITOR_TABLE_POINTER_EDGE_PX
    || clientY > tableRect.bottom + EDITOR_TABLE_POINTER_EDGE_PX
  ) {
    return null;
  }

  let closestColumnIndex: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  const columns = getEditorTableColumnCount(table);
  for (const row of getEditorTableRows(table)) {
    getEditorTableCells(row).forEach((cell, columnIndex) => {
      if (columnIndex >= columns - 1) return;
      const cellRect = cell.getBoundingClientRect();
      const distance = Math.abs(clientX - cellRect.right);
      if (distance > EDITOR_TABLE_POINTER_EDGE_PX) return;
      if (distance < closestDistance) {
        closestColumnIndex = columnIndex;
        closestDistance = distance;
      }
    });
  }

  return closestColumnIndex;
}

function getEditorTablePointerInteraction(root: HTMLElement, target: EventTarget | null, clientX: number, clientY: number): EditorTablePointerInteraction | null {
  const table = getClosestEditorTable(root, target);
  if (!table) return null;
  const tableRect = table.getBoundingClientRect();
  if (
    clientX < tableRect.left - EDITOR_TABLE_POINTER_EDGE_PX
    || clientX > tableRect.right + EDITOR_TABLE_POINTER_EDGE_PX
    || clientY < tableRect.top - EDITOR_TABLE_POINTER_EDGE_PX
    || clientY > tableRect.bottom + EDITOR_TABLE_POINTER_EDGE_PX
  ) {
    return null;
  }
  if (clientX >= tableRect.right - EDITOR_TABLE_EXTEND_HANDLE_PX && clientY >= tableRect.bottom - EDITOR_TABLE_EXTEND_HANDLE_PX) {
    return { kind: "extend", table };
  }
  const dividerColumnIndex = getEditorTableDividerColumnNearPoint(table, clientX, clientY);
  if (dividerColumnIndex !== null) return { kind: "resize-column", table, dividerColumnIndex };
  if (Math.abs(clientX - tableRect.left) <= EDITOR_TABLE_POINTER_EDGE_PX) return { kind: "resize-table", table, edge: "left" };
  if (Math.abs(clientX - tableRect.right) <= EDITOR_TABLE_POINTER_EDGE_PX) return { kind: "resize-table", table, edge: "right" };

  const targetCell = getClosestEditorTableCell(root, target);
  const cell = targetCell && getEditorTableForCell(root, targetCell) === table
    ? targetCell
    : getEditorTableCellNearPoint(table, clientX, clientY);
  const coordinates = cell ? getEditorTableCellCoordinates(table, cell) : null;
  if (!cell || !coordinates) return null;
  const columns = getEditorTableColumnCount(table);
  const cellRect = cell.getBoundingClientRect();
  const insideCellY = clientY >= cellRect.top - EDITOR_TABLE_POINTER_EDGE_PX && clientY <= cellRect.bottom + EDITOR_TABLE_POINTER_EDGE_PX;
  if (!insideCellY) return null;
  if (coordinates.columnIndex < columns - 1 && Math.abs(clientX - cellRect.right) <= EDITOR_TABLE_POINTER_EDGE_PX) {
    return { kind: "resize-column", table, dividerColumnIndex: coordinates.columnIndex };
  }
  if (coordinates.columnIndex > 0 && Math.abs(clientX - cellRect.left) <= EDITOR_TABLE_POINTER_EDGE_PX) {
    return { kind: "resize-column", table, dividerColumnIndex: coordinates.columnIndex - 1 };
  }
  return null;
}

function getEditorTableCursorForInteraction(interaction: EditorTablePointerInteraction | null): string {
  if (!interaction) return "text";
  if (interaction.kind === "extend") return "nwse-resize";
  return "col-resize";
}

function updateEditorTableCursor(root: HTMLElement, target: EventTarget | null, clientX: number, clientY: number) {
  root.style.cursor = getEditorTableCursorForInteraction(getEditorTablePointerInteraction(root, target, clientX, clientY));
}

function ensureEditorTablePreviewSize(table: HTMLTableElement, rows: number, columns: number, minimumRows: number, minimumColumns: number): boolean {
  const targetRows = Math.max(minimumRows, Math.min(EDITOR_TABLE_MAX_ROWS, rows));
  const targetColumns = Math.max(minimumColumns, Math.min(EDITOR_TABLE_MAX_COLUMNS, columns));
  let changed = false;

  while (getEditorTableColumnCount(table) > targetColumns && getEditorTableColumnCount(table) > minimumColumns) {
    changed = removeEditorTableColumnAt(table, getEditorTableColumnCount(table) - 1) || changed;
  }
  while (getEditorTableRows(table).length > targetRows && getEditorTableRows(table).length > minimumRows) {
    changed = removeEditorTableRowAt(table, getEditorTableRows(table).length - 1) || changed;
  }
  while (getEditorTableColumnCount(table) < targetColumns) {
    if (insertEditorTableColumnAt(table, getEditorTableColumnCount(table)) === null) break;
    changed = true;
  }
  while (getEditorTableRows(table).length < targetRows) {
    if (insertEditorTableRowAt(table, getEditorTableRows(table).length) === null) break;
    changed = true;
  }

  return changed;
}

function applyEditorTableExtendedColumnWidths(
  table: HTMLTableElement,
  startColumnWidths: number[],
  startWidthPercent: number,
  nextWidthPercent: number,
  rootWidth: number,
  columns: number,
) {
  if (columns <= startColumnWidths.length) {
    applyEditorTableColumnWidths(table, startColumnWidths.slice(0, columns));
    return;
  }

  const startTableWidthPx = Math.max(1, (startWidthPercent / 100) * rootWidth);
  const nextTableWidthPx = Math.max(startTableWidthPx, (nextWidthPercent / 100) * rootWidth);
  const addedColumns = columns - startColumnWidths.length;
  const extraWidthPx = Math.max(0, nextTableWidthPx - startTableWidthPx);
  const addedColumnWidthPx = Math.max(EDITOR_TABLE_MIN_COLUMN_WIDTH_PX, extraWidthPx / Math.max(1, addedColumns));
  const pixelWidths = startColumnWidths.map((width) => (width / 100) * startTableWidthPx);
  while (pixelWidths.length < columns) pixelWidths.push(addedColumnWidthPx);
  const totalWidthPx = pixelWidths.reduce((sum, width) => sum + width, 0);
  applyEditorTableColumnWidths(table, pixelWidths.map((width) => (width / Math.max(1, totalWidthPx)) * 100));
}

function startEditorTablePointerInteraction(
  root: HTMLElement,
  interaction: EditorTablePointerInteraction,
  pointerEvent: React.PointerEvent<HTMLDivElement>,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
) {
  const { table } = interaction;
  normalizeEditorTable(table);
  const ownerDocument = root.ownerDocument;
  const previousCursor = ownerDocument.body.style.cursor;
  ownerDocument.body.style.cursor = getEditorTableCursorForInteraction(interaction);
  const undoBefore = snapshotEditorDocumentRoot(root);
  const startRootMetrics = getEditorRootContentMetrics(root);
  const startTableRect = table.getBoundingClientRect();
  const start = {
    x: pointerEvent.clientX,
    y: pointerEvent.clientY,
    rootWidth: Math.max(1, startRootMetrics.width),
    widthPercent: readEditorTableWidthPercent(table),
    offsetPercent: readEditorTableOffsetPercent(table),
    rows: getEditorTableRows(table).length,
    columns: getEditorTableColumnCount(table),
  };
  const startColumnWidths = readEditorTableColumnWidths(table, start.columns);
  let moved = false;

  const onPointerMove = (event: PointerEvent) => {
    event.preventDefault();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (interaction.kind === "resize-column") {
      if (interaction.dividerColumnIndex < 0 || interaction.dividerColumnIndex >= start.columns - 1) return;
      const widths = [...startColumnWidths];
      const pairTotal = widths[interaction.dividerColumnIndex] + widths[interaction.dividerColumnIndex + 1];
      const minPercent = Math.min(Math.max(3, (EDITOR_TABLE_MIN_COLUMN_WIDTH_PX / Math.max(1, startTableRect.width)) * 100), Math.max(3, (pairTotal / 2) - 0.5));
      if (pairTotal <= minPercent * 2) return;
      const deltaPercent = (dx / Math.max(1, startTableRect.width)) * 100;
      const leftWidth = Math.min(pairTotal - minPercent, Math.max(minPercent, startColumnWidths[interaction.dividerColumnIndex] + deltaPercent));
      widths[interaction.dividerColumnIndex] = leftWidth;
      widths[interaction.dividerColumnIndex + 1] = pairTotal - leftWidth;
      applyEditorTableColumnWidths(table, widths);
      moved = true;
      return;
    }

    if (interaction.kind === "resize-table") {
      const deltaPercent = (dx / start.rootWidth) * 100;
      const minWidthPercent = Math.min(92, Math.max(18, (EDITOR_TABLE_MIN_WIDTH_PX / start.rootWidth) * 100));
      if (interaction.edge === "right") {
        applyEditorTableLayout(table, Math.max(minWidthPercent, start.widthPercent + deltaPercent), start.offsetPercent);
      } else {
        const fixedRight = start.offsetPercent + start.widthPercent;
        const nextOffset = Math.max(0, Math.min(fixedRight - minWidthPercent, start.offsetPercent + deltaPercent));
        applyEditorTableLayout(table, fixedRight - nextOffset, nextOffset);
      }
      moved = true;
      return;
    }

    const positiveDx = Math.max(0, dx);
    const nextWidthPercent = Math.min(100 - start.offsetPercent, Math.max(start.widthPercent, start.widthPercent + (positiveDx / start.rootWidth) * 100));
    const nextLayout = applyEditorTableLayout(table, nextWidthPercent, start.offsetPercent);
    if (Math.abs(nextLayout.widthPercent - start.widthPercent) > 0.01) moved = true;

    const desiredColumns = Math.min(EDITOR_TABLE_MAX_COLUMNS, start.columns + Math.max(0, Math.floor(positiveDx / EDITOR_TABLE_EXTEND_COLUMN_STEP_PX)));
    const desiredRows = Math.min(EDITOR_TABLE_MAX_ROWS, start.rows + Math.max(0, Math.floor(dy / EDITOR_TABLE_EXTEND_ROW_STEP_PX)));
    if (ensureEditorTablePreviewSize(table, desiredRows, desiredColumns, start.rows, start.columns)) moved = true;
    applyEditorTableExtendedColumnWidths(table, startColumnWidths, start.widthPercent, nextLayout.widthPercent, start.rootWidth, getEditorTableColumnCount(table));
  };

  const restoreStartState = () => {
    if (interaction.kind === "extend") {
      ensureEditorTablePreviewSize(table, start.rows, start.columns, start.rows, start.columns);
    }
    applyEditorTableColumnWidths(table, startColumnWidths);
    applyEditorTableLayout(table, start.widthPercent, start.offsetPercent);
  };

  const finish = (commit: boolean) => {
    ownerDocument.removeEventListener("pointermove", onPointerMove);
    ownerDocument.removeEventListener("pointerup", onPointerUp);
    ownerDocument.removeEventListener("pointercancel", onPointerCancel);
    ownerDocument.body.style.cursor = previousCursor;
    root.style.cursor = "text";

    if (!commit) {
      restoreStartState();
      return;
    }

    if (interaction.kind === "extend") {
      const hasFinalExtension = getEditorTableRows(table).length !== start.rows || getEditorTableColumnCount(table) !== start.columns;
      const hasFinalLayoutChange = Math.abs(readEditorTableWidthPercent(table) - start.widthPercent) > 0.01
        || Math.abs(readEditorTableOffsetPercent(table) - start.offsetPercent) > 0.01;
      if (!hasFinalExtension && !hasFinalLayoutChange) {
        restoreStartState();
        return;
      }
    }

    if (!moved) return;
    recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, interaction.kind === "resize-table" || interaction.kind === "resize-column" ? "resize" : "format");
    commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
  };

  const onPointerUp = () => finish(true);
  const onPointerCancel = () => finish(false);

  ownerDocument.addEventListener("pointermove", onPointerMove);
  ownerDocument.addEventListener("pointerup", onPointerUp, { once: true });
  ownerDocument.addEventListener("pointercancel", onPointerCancel, { once: true });
}

function startEditorImagePointerInteraction(
  root: HTMLElement,
  frame: HTMLSpanElement,
  pointerEvent: React.PointerEvent<HTMLDivElement>,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
) {
  const ownerDocument = root.ownerDocument;
  const frameRect = frame.getBoundingClientRect();
  const rootMetrics = getEditorRootContentMetrics(root);
  const interaction = getEditorImagePointerInteraction(
    frameRect.width,
    frameRect.height,
    pointerEvent.clientX - frameRect.left,
    pointerEvent.clientY - frameRect.top,
  );
  const visualLeft = clampEditorImageOffset(
    frameRect.left - rootMetrics.left,
    getEditorImageHorizontalLimit(getEditorImageMaxFrameWidth(rootMetrics.width), frameRect.width),
  );
  const start = {
    x: pointerEvent.clientX,
    y: pointerEvent.clientY,
    width: frameRect.width,
    height: frameRect.height,
    visualLeft,
    visualTop: frameRect.top,
    marginTop: readStylePixels(frame.style.marginTop, DEFAULT_EDITOR_IMAGE_MARGIN_TOP_PX),
    floatSide: readEditorImageFloatSide(frame),
  };
  const aspectRatio = readEditorImageAspectRatio(frame, start.width / Math.max(1, start.height));
  const previousCursor = ownerDocument.body.style.cursor;
  ownerDocument.body.style.cursor = getEditorImageCursorForInteraction(interaction);
  const undoBefore = snapshotEditorDocumentRoot(root);
  let latestDragVisualTop = start.visualTop;
  let shouldReanchorAfterDrag = false;
  let moved = false;

  const onPointerMove = (event: PointerEvent) => {
    event.preventDefault();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    moved = true;
    const nextMetrics = getEditorRootContentMetrics(root);
    if (interaction.kind === "resize") {
      const minWidth = 48;
      const minHeight = 36;
      const maxHeight = 1_600;
      const maxFrameWidth = getEditorImageMaxFrameWidth(nextMetrics.width);
      const fixedRight = Math.min(maxFrameWidth, start.visualLeft + start.width);
      const fixedBottom = start.marginTop + start.height;

      let nextVisualLeft = start.visualLeft;
      let nextWidth = start.width;
      let nextMarginTop = start.marginTop;
      let nextHeight = start.height;

      if (interaction.horizontal && interaction.vertical) {
        const horizontalWeight = Math.abs(dx) / Math.max(1, start.width);
        const verticalWeight = Math.abs(dy) / Math.max(1, start.height);
        if (horizontalWeight >= verticalWeight) {
          if (interaction.horizontal < 0) {
            const maxLeft = Math.max(0, fixedRight - minWidth);
            nextVisualLeft = Math.max(0, Math.min(maxLeft, start.visualLeft + dx));
            nextWidth = fixedRight - nextVisualLeft;
          } else {
            const maxWidth = Math.max(minWidth, maxFrameWidth - start.visualLeft);
            nextWidth = clampEditorImageSize(start.width + dx, minWidth, maxWidth);
          }
          nextHeight = clampEditorImageSize(nextWidth / aspectRatio, minHeight, maxHeight);
        } else {
          if (interaction.vertical < 0) {
            const maxTop = fixedBottom - minHeight;
            nextMarginTop = clampEditorImageVerticalOffset(start.marginTop + dy, -5_000, maxTop);
            nextHeight = fixedBottom - nextMarginTop;
          } else {
            nextHeight = clampEditorImageSize(start.height + dy, minHeight, maxHeight);
          }
          nextWidth = clampEditorImageSize(nextHeight * aspectRatio, minWidth, maxFrameWidth);
        }

        const maxWidthForAnchor = interaction.horizontal < 0 ? Math.max(minWidth, fixedRight) : Math.max(minWidth, maxFrameWidth - start.visualLeft);
        const sizeScale = Math.min(1, maxWidthForAnchor / Math.max(1, nextWidth), maxHeight / Math.max(1, nextHeight));
        nextWidth = clampEditorImageSize(nextWidth * sizeScale, minWidth, maxWidthForAnchor);
        nextHeight = clampEditorImageSize(nextWidth / aspectRatio, minHeight, maxHeight);
        if (interaction.horizontal < 0) nextVisualLeft = fixedRight - nextWidth;
        if (interaction.vertical < 0) nextMarginTop = fixedBottom - nextHeight;
      } else if (interaction.horizontal) {
        if (interaction.horizontal < 0) {
          const maxLeft = Math.max(0, fixedRight - minWidth);
          nextVisualLeft = Math.max(0, Math.min(maxLeft, start.visualLeft + dx));
          nextWidth = fixedRight - nextVisualLeft;
        } else {
          const maxWidth = Math.max(minWidth, maxFrameWidth - start.visualLeft);
          nextWidth = clampEditorImageSize(start.width + dx, minWidth, maxWidth);
        }
      } else if (interaction.vertical) {
        if (interaction.vertical < 0) {
          const maxTop = fixedBottom - minHeight;
          nextMarginTop = clampEditorImageVerticalOffset(start.marginTop + dy, -5_000, maxTop);
          nextHeight = fixedBottom - nextMarginTop;
        } else {
          nextHeight = clampEditorImageSize(start.height + dy, minHeight, maxHeight);
        }
      }

      nextVisualLeft = clampEditorImageOffset(
        nextVisualLeft,
        getEditorImageHorizontalLimit(maxFrameWidth, nextWidth),
      );
      const inlineOffset = getEditorImageInlineOffsetForVisualLeft(maxFrameWidth, nextWidth, start.floatSide, nextVisualLeft);
      applyEditorImageFloatLayout(frame, start.floatSide, inlineOffset);
      frame.style.width = `${nextWidth}px`;
      frame.style.height = `${nextHeight}px`;
      frame.style.aspectRatio = `${nextWidth} / ${nextHeight}`;
      frame.style.marginTop = `${clampEditorImageVerticalOffset(nextMarginTop, -5_000, 5_000)}px`;
      return;
    }

    const maxFrameWidth = getEditorImageMaxFrameWidth(nextMetrics.width);
    const maxLeft = getEditorImageHorizontalLimit(maxFrameWidth, start.width);
    const nextVisualLeft = clampEditorImageOffset(start.visualLeft + dx, maxLeft);
    const nextFloatSide = getEditorImageFloatSideForVisualLeft(maxFrameWidth, start.width, nextVisualLeft);
    const inlineOffset = getEditorImageInlineOffsetForVisualLeft(maxFrameWidth, start.width, nextFloatSide, nextVisualLeft);
    applyEditorImageFloatLayout(frame, nextFloatSide, inlineOffset);
    const rootRect = root.getBoundingClientRect();
    const minVisualTop = rootRect.top - Math.max(0, start.height - 48);
    const maxVisualTop = rootRect.bottom - 48;
    latestDragVisualTop = clampEditorImageVerticalOffset(start.visualTop + dy, minVisualTop, maxVisualTop);
    shouldReanchorAfterDrag = Math.abs(latestDragVisualTop - start.visualTop) >= 6;
    frame.style.marginTop = `${clampEditorImageVerticalOffset(start.marginTop + latestDragVisualTop - start.visualTop, -5_000, 5_000)}px`;
  };

  const finish = () => {
    ownerDocument.removeEventListener("pointermove", onPointerMove);
    ownerDocument.removeEventListener("pointerup", finish);
    ownerDocument.removeEventListener("pointercancel", finish);
    ownerDocument.body.style.cursor = previousCursor;
    if (!moved) return;
    if (interaction.kind === "drag" && shouldReanchorAfterDrag && reanchorEditorImageForVisualTop(root, frame, latestDragVisualTop)) {
      frame.style.marginTop = `${DEFAULT_EDITOR_IMAGE_MARGIN_TOP_PX}px`;
    }
    recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, interaction.kind === "resize" ? "resize" : "image");
    commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
  };

  ownerDocument.addEventListener("pointermove", onPointerMove);
  ownerDocument.addEventListener("pointerup", finish, { once: true });
  ownerDocument.addEventListener("pointercancel", finish, { once: true });
}

export function useEditorDocumentFormattingController({
  editorRef,
  editable,
  outlineStyle,
  documentUndoHistoryRef,
  pendingEditorFontSizeRef,
  pendingEditorHighlightColorRef,
  pendingEditorInlineFormatRef,
  pendingEditorTypingCaretRef,
  restoreSelection,
  insertTable,
  scheduleDocumentSave,
  scheduleIndentGuideUpdate,
  onSelectionFontSizeChange,
  onSelectionInlineFormatChange,
  onSelectionHighlightColorChange,
  onSelectionTextAlignmentChange,
}: UseEditorDocumentFormattingControllerOptions): EditorDocumentFormattingController {
  const restoreFormattingRange = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return null;
    restoreSelection(editor);
    return editor;
  }, [editorRef, restoreSelection]);

  const restoreFormattingSelection = useCallback(() => {
    const editor = restoreFormattingRange();
    if (!editor) return null;
    editor.focus({ preventScroll: true });
    return editor;
  }, [restoreFormattingRange]);

  const readCurrentFormatState = useCallback((editor: HTMLElement): EditorSelectionFormatState | null => {
    const state = readEditorSelectionFormatState(editor);
    if (!state) {
      if (pendingEditorFontSizeRef.current === null && pendingEditorHighlightColorRef.current === undefined && pendingEditorInlineFormatRef.current === null) return null;
      const pendingInline = pendingEditorInlineFormatRef.current;
      return {
        fontSize: pendingEditorFontSizeRef.current ?? EDITOR_DOCUMENT_FONT_SIZE_PX,
        bold: pendingInline?.bold ?? false,
        underline: pendingInline?.underline ?? false,
        italic: pendingInline?.italic ?? false,
        strikethrough: pendingInline?.strikethrough ?? false,
        highlightColor: pendingEditorHighlightColorRef.current ?? null,
        textAlignment: "left",
      };
    }
    return {
      ...state,
      ...(pendingEditorInlineFormatRef.current ?? {}),
      fontSize: pendingEditorFontSizeRef.current ?? state.fontSize,
      highlightColor: pendingEditorHighlightColorRef.current === undefined ? state.highlightColor : pendingEditorHighlightColorRef.current,
    };
  }, [pendingEditorFontSizeRef, pendingEditorHighlightColorRef, pendingEditorInlineFormatRef]);

  return useMemo<EditorDocumentFormattingController>(() => ({
    applyFontSizeValue: (fontSize) => {
      const editor = restoreFormattingSelection();
      if (!editable || !editor) return false;
      return applyEditorSelectionFontSizeToRoot(editor, fontSize, {
        documentUndoHistory: documentUndoHistoryRef.current,
        pendingEditorFontSizeRef,
        pendingEditorTypingCaretRef,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
        onSelectionFontSizeChange,
      });
    },
    adjustFontSize: (delta) => {
      const editor = restoreFormattingSelection();
      if (!editable || !editor) return false;
      const state = readCurrentFormatState(editor);
      const currentFontSize = state?.fontSize ?? EDITOR_DOCUMENT_FONT_SIZE_PX;
      return applyEditorSelectionFontSizeToRoot(editor, currentFontSize + delta, {
        documentUndoHistory: documentUndoHistoryRef.current,
        pendingEditorFontSizeRef,
        pendingEditorTypingCaretRef,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
        onSelectionFontSizeChange,
      });
    },
    toggleInlineFormat: (command) => {
      const editor = restoreFormattingSelection();
      if (!editable || !editor) return false;
      return applyEditorInlineFormatToRoot(editor, command, {
        documentUndoHistory: documentUndoHistoryRef.current,
        pendingEditorInlineFormatRef,
        pendingEditorTypingCaretRef,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
        onSelectionInlineFormatChange,
      });
    },
    applyHighlightColor: (color) => {
      const editor = restoreFormattingSelection();
      if (!editable || !editor) return false;
      return applyEditorHighlightColorToRoot(editor, color, {
        documentUndoHistory: documentUndoHistoryRef.current,
        pendingEditorHighlightColorRef,
        pendingEditorTypingCaretRef,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
        onSelectionHighlightColorChange,
      });
    },
    applyTextAlignment: (alignment) => {
      const editor = restoreFormattingSelection();
      if (!editable || !editor) return false;
      return applyEditorTextAlignmentToRoot(editor, alignment, {
        documentUndoHistory: documentUndoHistoryRef.current,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
        onSelectionTextAlignmentChange,
      });
    },
    insertLink: (href) => {
      const editor = restoreFormattingSelection();
      if (!editable || !editor) return false;
      return applyEditorLinkToRoot(editor, href, {
        documentUndoHistory: documentUndoHistoryRef.current,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
      });
    },
    insertList: (kind) => {
      const editor = restoreFormattingSelection();
      if (!editable || !editor) return false;
      return insertEditorListKindToRoot(editor, kind, {
        documentUndoHistory: documentUndoHistoryRef.current,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
      });
    },
    toggleNumberedList: () => {
      const editor = restoreFormattingSelection();
      if (!editable || !editor) return false;
      return applyEditorNumberedListToRoot(editor, { documentUndoHistory: documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate });
    },
    indent: () => {
      const editor = restoreFormattingSelection();
      if (!editable || !editor) return false;
      return applyEditorIndentCommandToRoot(editor, "indent", outlineStyle, { documentUndoHistory: documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate });
    },
    outdent: () => {
      const editor = restoreFormattingSelection();
      if (!editable || !editor) return false;
      return applyEditorIndentCommandToRoot(editor, "outdent", outlineStyle, { documentUndoHistory: documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate });
    },
    insertTable: () => editable && insertTable(editorRef.current),
    readFormatState: () => {
      const editor = restoreFormattingRange();
      return editor ? readCurrentFormatState(editor) : null;
    },
  }), [
    documentUndoHistoryRef,
    editable,
    editorRef,
    insertTable,
    onSelectionFontSizeChange,
    onSelectionHighlightColorChange,
    onSelectionInlineFormatChange,
    onSelectionTextAlignmentChange,
    outlineStyle,
    pendingEditorFontSizeRef,
    pendingEditorHighlightColorRef,
    pendingEditorInlineFormatRef,
    pendingEditorTypingCaretRef,
    readCurrentFormatState,
    restoreFormattingRange,
    restoreFormattingSelection,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
  ]);
}

// Unified editor semantics live here. Fix keyboard, indentation, clipboard,
// paste/drop, list, image, mention, undo/redo, and flush behavior here (or in a
// shared helper called here), not in a single surface wrapper. See
// unifiedRichEditorContract.ts before introducing any surface-specific branch.
export function useEditorDocumentSurfaceHandlers({
  restoringScrollRef,
  currentDocumentTargetKeyRef,
  scrollMemoryRef,
  documentUndoHistoryRef,
  pendingEditorFontSizeRef,
  pendingEditorHighlightColorRef,
  pendingEditorInlineFormatRef,
  pendingEditorTypingCaretRef,
  outlineStyle,
  setDocumentScrollTop,
  scheduleDocumentSave,
  scheduleIndentGuideUpdate,
  rememberCurrentDocumentScroll,
  flushPendingDocumentSave,
  onSelectionFontSizeChange,
  onSelectionInlineFormatChange,
  onSelectionHighlightColorChange,
  onSelectionTextAlignmentChange,
  mentionUsers = [],
  mentionAccent = "#334155",
  mentionSurfaceText = "#111827",
  mentionStrokeColor = "rgba(15,23,42,0.18)",
  mentionMenuPosition = "fixed",
  editorImageAttachmentContext,
  onEditorImageAttachmentError,
}: UseEditorDocumentSurfaceHandlersOptions): EditorDocumentSurfaceHandlerResult {
  const pendingNativeStyledInsertionRef = useRef<{ text: string; style: EditorPendingTypingStyle } | null>(null);
  const activeMentionRootRef = useRef<HTMLElement | null>(null);
  const lastEditorSelectionRangeRef = useRef<Range | null>(null);
  const editorInputBatchFlushRef = useRef<(batch: PendingEditorNativeInputBatch) => string | undefined>(() => undefined);
  const editorInputBatcherRef = useRef<EditorNativeInputBatcher | null>(null);
  if (!editorInputBatcherRef.current) {
    editorInputBatcherRef.current = new EditorNativeInputBatcher({
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (handle) => window.clearTimeout(handle as number),
    }, (batch) => editorInputBatchFlushRef.current(batch));
  }
  const editorInputBatcher = editorInputBatcherRef.current;
  editorInputBatchFlushRef.current = (batch) => commitEditorNativeInputBatch(
    batch, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate,
  );
  const editorImageAttachmentContextIdentityRef = useRef(editorImageAttachmentContextIdentity(editorImageAttachmentContext));
  editorImageAttachmentContextIdentityRef.current = editorImageAttachmentContextIdentity(editorImageAttachmentContext);
  const [activeMentionDraft, setActiveMentionDraft] = useState<RichTextMentionDraft | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [activeTableContextMenu, setActiveTableContextMenu] = useState<RichTextTableContextMenu | null>(null);
  const [activeImagePreview, setActiveImagePreview] = useState<EditorImagePreviewDraft | null>(null);
  const mentionOptions = useMemo(() => (
    activeMentionDraft ? buildMentionOptions(mentionUsers, activeMentionDraft.query, 8) : []
  ), [activeMentionDraft?.query, mentionUsers]);
  const mentionMenuOpen = activeMentionDraft !== null && mentionOptions.length > 0;

  const clearPendingTypingStyle = useCallback(() => {
    pendingEditorFontSizeRef.current = null;
    pendingEditorHighlightColorRef.current = undefined;
    pendingEditorInlineFormatRef.current = null;
    pendingEditorTypingCaretRef.current = null;
  }, [pendingEditorFontSizeRef, pendingEditorHighlightColorRef, pendingEditorInlineFormatRef, pendingEditorTypingCaretRef]);

  const flushPendingInput = useCallback((root?: HTMLElement | null) => (
    editorInputBatcher.flush(root)
  ), [editorInputBatcher]);

  useLayoutEffect(() => () => {
    editorInputBatcher.flush();
    editorInputBatcher.discard();
  }, [editorInputBatcher]);

  const rememberEditorSelectionRange = useCallback((root: HTMLElement) => {
    const range = getEditorSelectionRange(root);
    if (range) lastEditorSelectionRangeRef.current = range.cloneRange();
  }, []);

  const restoreEditorSelectionRange = useCallback((root: HTMLElement) => {
    const liveRange = getEditorSelectionRange(root);
    if (liveRange) {
      lastEditorSelectionRangeRef.current = liveRange.cloneRange();
      return true;
    }
    const savedRange = lastEditorSelectionRangeRef.current;
    if (!rangeIsStillInsideRoot(root, savedRange)) return false;
    return setEditorSelectionRange(root, savedRange);
  }, []);

  const createAsyncImageCommitGuard = useCallback((root: HTMLElement, savedRange: Range | null) => {
    const targetKey = currentDocumentTargetKeyRef.current;
    const attachmentContextIdentity = editorImageAttachmentContextIdentityRef.current;
    return () => (
      root.isConnected
      && currentDocumentTargetKeyRef.current === targetKey
      && editorImageAttachmentContextIdentityRef.current === attachmentContextIdentity
      && (!savedRange || rangeIsStillInsideRoot(root, savedRange))
    );
  }, [currentDocumentTargetKeyRef]);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [activeMentionDraft?.start, activeMentionDraft?.query]);

  useEffect(() => {
    setActiveMentionIndex((current) => Math.min(current, Math.max(0, mentionOptions.length - 1)));
  }, [mentionOptions.length]);

  useEffect(() => {
    const root = activeTableContextMenu?.root;
    if (!root) return undefined;
    const ownerDocument = root.ownerDocument;
    const onPointerDown = () => setActiveTableContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setActiveTableContextMenu(null);
      root.focus({ preventScroll: true });
    };
    ownerDocument.addEventListener("pointerdown", onPointerDown);
    ownerDocument.addEventListener("keydown", onKeyDown, true);
    return () => {
      ownerDocument.removeEventListener("pointerdown", onPointerDown);
      ownerDocument.removeEventListener("keydown", onKeyDown, true);
    };
  }, [activeTableContextMenu?.root]);

  const refreshMentionDraft = useCallback((root: HTMLElement) => {
    if (mentionUsers.length === 0) {
      activeMentionRootRef.current = null;
      setActiveMentionDraft(null);
      return;
    }
    const draft = readRichTextMentionDraft(root, mentionMenuPosition);
    activeMentionRootRef.current = draft ? root : null;
    setActiveMentionDraft(draft);
  }, [mentionMenuPosition, mentionUsers.length]);

  const syncActiveSelectionFormat = useCallback((root: HTMLElement) => {
    const pendingFontSize = pendingEditorFontSizeRef.current;
    const pendingHighlightColor = pendingEditorHighlightColorRef.current;
    const pendingInlineFormat = pendingEditorInlineFormatRef.current;
    if (pendingFontSize !== null) onSelectionFontSizeChange(pendingFontSize);
    if (pendingHighlightColor !== undefined) onSelectionHighlightColorChange?.(pendingHighlightColor);
    if (pendingInlineFormat !== null) onSelectionInlineFormatChange?.(pendingInlineFormat);
    if (pendingFontSize !== null || pendingHighlightColor !== undefined || pendingInlineFormat !== null) return;
    syncSelectionFormatState(root, onSelectionFontSizeChange, onSelectionInlineFormatChange, onSelectionHighlightColorChange, onSelectionTextAlignmentChange);
  }, [onSelectionFontSizeChange, onSelectionHighlightColorChange, onSelectionInlineFormatChange, onSelectionTextAlignmentChange, pendingEditorFontSizeRef, pendingEditorHighlightColorRef, pendingEditorInlineFormatRef]);

  const insertMention = useCallback((root: HTMLElement, mention: ActiveMentionDraft, user: MentionableCompanyUser) => {
    editorInputBatcher.flush(root);
    replaceEditorMentionDraft(root, mention, user, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
    activeMentionRootRef.current = null;
    setActiveMentionDraft(null);
  }, [documentUndoHistoryRef, editorInputBatcher, scheduleDocumentSave, scheduleIndentGuideUpdate]);

  const openTableContextMenu = useCallback((root: HTMLElement, event: React.MouseEvent<HTMLDivElement>) => {
    editorInputBatcher.flush(root);
    event.preventDefault();
    event.stopPropagation();
    root.focus({ preventScroll: true });
    clearPendingTypingStyle();
    clearEditorImageSelection(root);
    activeMentionRootRef.current = null;
    setActiveMentionDraft(null);
    const cell = getClosestEditorTableCell(root, event.target);
    const table = getEditorTableForCell(root, cell);
    const position = getEditorContextMenuPosition(root, event.clientX, event.clientY, mentionMenuPosition);
    if (cell && table) {
      const initialCoordinates = getEditorTableCellCoordinates(table, cell);
      normalizeEditorTable(table);
      const nextCell = initialCoordinates ? getEditorTableCellAt(table, initialCoordinates.rowIndex, initialCoordinates.columnIndex) ?? cell : cell;
      setSelectionInEditorTableCell(root, nextCell);
      const coordinates = getEditorTableCellCoordinates(table, nextCell);
      if (coordinates) markEditorTableHeaderSelection(root, table, coordinates);
      setActiveTableContextMenu({
        ...position,
        root,
        mode: "table",
        rows: getEditorTableRows(table).length,
        columns: getEditorTableColumnCount(table),
      });
      return;
    }
    clearEditorTableCellSelections(root);
    setEditorCaretFromPoint(root, event.clientX, event.clientY);
    setActiveTableContextMenu({
      ...position,
      root,
      mode: "editor",
      rows: 0,
      columns: 0,
    });
  }, [clearPendingTypingStyle, editorInputBatcher, mentionMenuPosition]);

  const runTableContextCommand = useCallback((command: EditorTableCommand) => {
    const root = activeTableContextMenu?.root;
    if (!root || activeTableContextMenu.mode !== "table") return;
    setActiveTableContextMenu(null);
    editorInputBatcher.flush(root);
    const applied = applyEditorTableCommand(root, command, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
    if (applied) clearEditorTableCellSelections(root);
  }, [activeTableContextMenu, documentUndoHistoryRef, editorInputBatcher, scheduleDocumentSave, scheduleIndentGuideUpdate]);

  const insertTableFromContextMenu = useCallback(() => {
    const root = activeTableContextMenu?.root;
    if (!root) return;
    setActiveTableContextMenu(null);
    editorInputBatcher.flush(root);
    root.focus({ preventScroll: true });
    clearPendingTypingStyle();
    clearEditorImageSelection(root);
    activeMentionRootRef.current = null;
    setActiveMentionDraft(null);
    insertEditorTable(root, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
  }, [activeTableContextMenu?.root, clearPendingTypingStyle, documentUndoHistoryRef, editorInputBatcher, scheduleDocumentSave, scheduleIndentGuideUpdate]);

  useEffect(() => {
    if (!activeImagePreview) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "c") return;
      const attachmentID = activeImagePreview.attachmentID?.trim() ?? "";
      if (writeEditorImageToSystemClipboard(document, {
        ...activeImagePreview,
        attachmentID: attachmentID || undefined,
      }, attachmentID && editorImageAttachmentContextReady(editorImageAttachmentContext)
        ? () => fetchMangoAttachmentBlob(editorImageAttachmentContext.apiBase, editorImageAttachmentContext.companyID, attachmentID, "original")
        : undefined)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeImagePreview, editorImageAttachmentContext]);

  const downloadActiveImagePreview = useCallback(() => {
    if (!activeImagePreview) return;
    const attachmentID = activeImagePreview.attachmentID?.trim() ?? "";
    if (attachmentID && editorImageAttachmentContextReady(editorImageAttachmentContext)) {
      void downloadMangoAttachment({
        apiBase: editorImageAttachmentContext.apiBase,
        companyID: editorImageAttachmentContext.companyID,
        attachmentID,
        filename: activeImagePreview.filename,
        variant: "original",
      }).catch(() => undefined);
      return;
    }
    const link = document.createElement("a");
    link.href = activeImagePreview.src;
    link.download = activeImagePreview.filename?.trim() || "editor-image";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [activeImagePreview, editorImageAttachmentContext]);

  useEffect(() => {
    const attachmentID = activeImagePreview?.attachmentID?.trim() ?? "";
    if (!attachmentID || !editorImageAttachmentContextReady(editorImageAttachmentContext)) return undefined;
    const controller = new AbortController();
    let objectURL = "";
    void loadMangoAttachmentObjectURL(
      editorImageAttachmentContext.apiBase,
      editorImageAttachmentContext.companyID,
      attachmentID,
      "original",
      { signal: controller.signal },
    ).then((url) => {
      objectURL = url;
      setActiveImagePreview((current) => (
        current?.attachmentID === attachmentID ? { ...current, src: url } : current
      ));
    }).catch(() => undefined);
    return () => {
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [
    activeImagePreview?.attachmentID,
    editorImageAttachmentContext,
  ]);

  const mentionMenu = mentionMenuOpen && activeMentionDraft
    ? React.createElement(
      "div",
      {
        role: "listbox",
        "aria-label": "Mention users",
        style: {
        position: activeMentionDraft.position,
        left: activeMentionDraft.left,
        top: activeMentionDraft.top,
        zIndex: 2000,
        width: EDITOR_MENTION_MENU_WIDTH_PX,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: EDITOR_MENTION_MENU_MAX_HEIGHT_PX,
        overflowY: "auto",
        display: "grid",
        gap: 2,
        padding: 4,
        border: `1px solid ${mentionStrokeColor}`,
        borderRadius: 8,
        background: "#ffffff",
        boxShadow: "0 16px 36px rgba(15,23,42,0.20)",
        color: mentionSurfaceText,
        fontFamily: "var(--mango-font-family)",
        } satisfies React.CSSProperties,
      },
      mentionOptions.map((user, index) => {
        const selected = index === activeMentionIndex;
        const name = mentionUserDisplayName(user);
        const label = mentionUserOptionLabel(user);
        const email = (user.email ?? "").trim();
        const profileColor = mentionUserProfileColor(user);
        return React.createElement(
          "button",
          {
            key: user.user_id,
            type: "button",
            role: "option",
            "aria-selected": selected,
            title: label,
            onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault(),
            onClick: () => {
              const root = activeMentionRootRef.current;
              if (!root || !activeMentionDraft) return;
              insertMention(root, activeMentionDraft, user);
            },
            style: {
              width: "100%",
              minHeight: 34,
              display: "grid",
              gridTemplateColumns: "24px minmax(0, 1fr)",
              alignItems: "center",
              gap: 8,
              border: "none",
              borderRadius: 6,
              background: selected ? `${profileColor.background}12` : "transparent",
              boxShadow: selected ? `inset 3px 0 0 ${mentionAccent}` : "none",
              color: mentionSurfaceText,
              cursor: "pointer",
              padding: "5px 8px",
              textAlign: "left",
              font: "inherit",
            } satisfies React.CSSProperties,
          },
          React.createElement(
            "span",
            {
              "aria-hidden": "true",
              style: {
                width: 24,
                height: 24,
                boxSizing: "border-box",
                border: `1px solid ${profileColor.border}`,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                background: profileColor.background,
                color: profileColor.foreground,
                fontSize: 10,
                fontWeight: 900,
              } satisfies React.CSSProperties,
            },
            initialsForMentionName(name),
          ),
          React.createElement(
            "span",
            { style: { minWidth: 0, display: "grid", gap: 1 } satisfies React.CSSProperties },
            React.createElement(
              "span",
              { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 800 } satisfies React.CSSProperties },
              name,
            ),
            email
              ? React.createElement(
                "span",
                { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontWeight: 650, color: "rgba(100,116,139,0.86)" } satisfies React.CSSProperties },
                email,
              )
              : null,
          ),
        );
      }),
    )
    : null;

  const imagePreviewModal = activeImagePreview
    ? React.createElement(EditorImagePreviewModal, {
      label: activeImagePreview.label,
      src: activeImagePreview.src,
      copyable: true,
      onClose: () => setActiveImagePreview(null),
      onDownload: downloadActiveImagePreview,
    })
    : null;
  const tableContextMenuButtonStyle = {
    width: "100%",
    minHeight: 29,
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: mentionSurfaceText,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0,
    padding: "0 9px",
    whiteSpace: "nowrap",
    textAlign: "left",
  } satisfies React.CSSProperties;

  const tableContextMenu = activeTableContextMenu && !mentionMenuOpen
    ? React.createElement(
      "div",
      {
        role: "menu",
        "aria-label": activeTableContextMenu.mode === "table" ? "Table actions" : "Editor actions",
        onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => {
          event.preventDefault();
          event.stopPropagation();
        },
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
          event.preventDefault();
          event.stopPropagation();
        },
        style: {
          position: activeTableContextMenu.position,
          left: activeTableContextMenu.left,
          top: activeTableContextMenu.top,
          zIndex: 1990,
          width: EDITOR_TABLE_CONTEXT_MENU_WIDTH_PX,
          maxWidth: "calc(100vw - 16px)",
          display: "grid",
          gap: 2,
          padding: 5,
          border: `1px solid ${mentionStrokeColor}`,
          borderRadius: 8,
          background: "#ffffff",
          boxShadow: "0 16px 36px rgba(15,23,42,0.20)",
          color: mentionSurfaceText,
          fontFamily: "var(--mango-font-family)",
        } satisfies React.CSSProperties,
      },
      activeTableContextMenu.mode === "editor"
        ? React.createElement("button", { key: "create-table", type: "button", role: "menuitem", onClick: insertTableFromContextMenu, style: tableContextMenuButtonStyle }, "Create table")
        : [
          React.createElement("button", { key: "column-left", type: "button", role: "menuitem", onClick: () => runTableContextCommand("insert-column-before"), style: tableContextMenuButtonStyle }, "Create column on the left"),
          React.createElement("button", { key: "column-right", type: "button", role: "menuitem", onClick: () => runTableContextCommand("insert-column-after"), style: tableContextMenuButtonStyle }, "Create column on the right"),
          React.createElement("button", { key: "row-above", type: "button", role: "menuitem", onClick: () => runTableContextCommand("insert-row-before"), style: tableContextMenuButtonStyle }, "Create row above"),
          React.createElement("button", { key: "row-below", type: "button", role: "menuitem", onClick: () => runTableContextCommand("insert-row-after"), style: tableContextMenuButtonStyle }, "Create row below"),
          React.createElement("div", { key: "divider", role: "separator", style: { height: 1, margin: "3px 4px", background: "rgba(100,116,139,0.18)" } satisfies React.CSSProperties }),
          React.createElement("button", { key: "delete-row", type: "button", role: "menuitem", onClick: () => runTableContextCommand("delete-row"), style: { ...tableContextMenuButtonStyle, color: "#dc2626" } satisfies React.CSSProperties }, activeTableContextMenu.rows <= 1 ? "Delete table" : "Delete row"),
          React.createElement("button", { key: "delete-column", type: "button", role: "menuitem", onClick: () => runTableContextCommand("delete-column"), style: { ...tableContextMenuButtonStyle, color: "#dc2626" } satisfies React.CSSProperties }, activeTableContextMenu.columns <= 1 ? "Delete table" : "Delete column"),
          React.createElement("button", {
            key: "delete-table",
            type: "button",
            role: "menuitem",
            onClick: () => runTableContextCommand("delete-table"),
            style: {
              ...tableContextMenuButtonStyle,
              color: "#dc2626",
              background: "rgba(254,242,242,0.96)",
            } satisfies React.CSSProperties,
          }, "Delete table"),
        ],
    )
    : null;

  const startEditorRichClipboardImport = useCallback((
    root: HTMLElement,
    html: string,
    imageFiles: File[],
    undoBefore: EditorDocumentUndoSnapshot | null,
    focusRoot: boolean,
  ): boolean => {
    const imageCount = countEditorRichClipboardImages(root.ownerDocument, html);
    if (imageCount === 0) return false;
    clearPendingTypingStyle();
    clearEditorImageSelection(root);
    if (focusRoot) root.focus({ preventScroll: true });
    const savedRange = getEditorSelectionRange(root)?.cloneRange() ?? null;
    const asyncGuard = createAsyncImageCommitGuard(root, savedRange);
    const documentAtStart = serializeEditorDocumentHTML(root);
    const canCommit = () => asyncGuard() && serializeEditorDocumentHTML(root) === documentAtStart;
    const matchingFiles = imageFiles.length === imageCount ? imageFiles : [];
    root.setAttribute("data-mango-rich-paste-importing", "true");
    void prepareEditorRichClipboardHTML(
      root.ownerDocument,
      html,
      (request) => resolveEditorRichClipboardImage(
        root,
        request,
        matchingFiles[request.index],
        editorImageAttachmentContext,
      ),
    ).then((result) => {
      if (!canCommit()) return;
      if (savedRange && !setEditorSelectionRange(root, savedRange)) return;
      const mentionUndoBefore = breakEditorMentionsForInput(root, "insertFromPaste", undoBefore ?? undefined);
      if (mentionUndoBefore) {
        activeMentionRootRef.current = null;
        setActiveMentionDraft(null);
      }
      if (result.html.trim() && replaceSelectionWithHTML(root, result.html)) {
        recordEditorDocumentMutation(documentUndoHistoryRef.current, root, mentionUndoBefore ?? undoBefore, "paste");
        commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
        setActiveTableContextMenu(null);
        clearEditorTableCellSelections(root);
      }
      if (result.failedImageCount > 0) {
        const noun = result.failedImageCount === 1 ? "image" : "images";
        const message = `${result.failedImageCount} pasted ${noun} could not be imported. The text and ${result.importedImageCount} imported images were kept.`;
        (editorImageAttachmentContext?.onError ?? onEditorImageAttachmentError)?.(message);
      }
    }).catch((cause) => {
      reportEditorImageAttachmentError(editorImageAttachmentContext, onEditorImageAttachmentError, cause);
    }).finally(() => {
      root.removeAttribute("data-mango-rich-paste-importing");
    });
    return true;
  }, [
    clearPendingTypingStyle,
    createAsyncImageCommitGuard,
    documentUndoHistoryRef,
    editorImageAttachmentContext,
    onEditorImageAttachmentError,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
  ]);

  const handlers = useMemo<EditorDocumentSurfaceHandlers>(() => ({
    onBeforeInput(event) {
      const root = event.currentTarget;
      rememberEditorSelectionRange(root);
      const inputEvent = event.nativeEvent as InputEvent;
      const pendingFontSize = pendingEditorFontSizeRef.current;
      const pendingHighlightColor = pendingEditorHighlightColorRef.current;
      const pendingInlineFormat = pendingEditorInlineFormatRef.current;

      if (inputEvent.inputType === "historyUndo" || inputEvent.inputType === "historyRedo") {
        clearPendingTypingStyle();
        pendingNativeStyledInsertionRef.current = null;
        editorInputBatcher.flush(root);
        const applied = applyEditorUndoCommand(
          root,
          documentUndoHistoryRef.current,
          inputEvent.inputType === "historyUndo" ? "undo" : "redo",
          scheduleDocumentSave,
          scheduleIndentGuideUpdate,
          onSelectionFontSizeChange,
          onSelectionInlineFormatChange,
          onSelectionHighlightColorChange,
          onSelectionTextAlignmentChange,
        );
        if (applied) event.preventDefault();
        return;
      }

      const mentionUndoBefore = breakEditorMentionsForInput(root, inputEvent.inputType);
      if (mentionUndoBefore) {
        activeMentionRootRef.current = null;
        setActiveMentionDraft(null);
      }

      if (
        inputEvent.inputType === "insertText" &&
        typeof inputEvent.data === "string" &&
        inputEvent.data.length > 0
      ) {
        editorInputBatcher.begin(root, "typing", () => mentionUndoBefore ?? snapshotEditorDocumentRoot(root));
        const selectionFormat = readEditorSelectionFormatState(root);
        const pendingStyle: EditorPendingTypingStyle | null = pendingFontSize !== null || pendingHighlightColor !== undefined || pendingInlineFormat !== null ? {} : null;
        if (pendingStyle && pendingFontSize !== null) pendingStyle.fontSize = pendingFontSize;
        if (pendingStyle && pendingHighlightColor !== undefined) pendingStyle.highlightColor = pendingHighlightColor;
        if (pendingStyle && pendingInlineFormat !== null) pendingStyle.inlineFormat = pendingInlineFormat;
        const applyScriptedTypingStyle = (includeInlineFormat = true) => {
          const scriptedTypingStyle: EditorPendingTypingStyle = pendingStyle ? { ...pendingStyle } : {};
          if (includeInlineFormat && !scriptedTypingStyle.inlineFormat && selectionFormat) {
            scriptedTypingStyle.inlineFormat = {
              bold: selectionFormat.bold,
              underline: selectionFormat.underline,
              italic: selectionFormat.italic,
              strikethrough: selectionFormat.strikethrough,
            };
          }
          if (!scriptedTypingStyle.inlineFormat && pendingStyle === null) return;
          applyEditorTypingStyleToRecentlyInsertedText(
            root,
            inputEvent.data!,
            includeInlineFormat ? scriptedTypingStyle : pendingStyle!,
          );
          if (pendingFontSize !== null) onSelectionFontSizeChange(pendingFontSize);
          if (pendingHighlightColor !== undefined) onSelectionHighlightColorChange?.(pendingHighlightColor);
        };

        const activeEditorListItem = getCurrentEditorListItem(root);
        const activeTableCell = getCurrentEditorTableCell(root);
        if (!activeEditorListItem && activeTableCell) {
          if (startEditorTableCellBulletListFromDashShortcut(root, activeTableCell, inputEvent.data)) {
            event.preventDefault();
            editorInputBatcher.markChanged(root);
            return;
          }
        }
        const tableEditorListKind = activeTableCell ? editorListKindForOutlineStyle(outlineStyle) : null;
        if (activeTableCell && tableEditorListKind) {
          if (startEditorTableCellListFromText(root, activeTableCell, tableEditorListKind, inputEvent.data)) {
            event.preventDefault();
            applyScriptedTypingStyle();
            editorInputBatcher.markChanged(root);
            return;
          }
        }

        if (activeEditorListItem && editorListItemContentIsEmpty(activeEditorListItem)) {
          event.preventDefault();
          if (insertTextIntoEmptyEditorListItem(root, activeEditorListItem, inputEvent.data)) {
            applyScriptedTypingStyle();
            editorInputBatcher.markChanged(root);
          }
          return;
        }

        if (!activeEditorListItem && !activeTableCell) {
          const offsets = getEditorSelectionOffsets(root);
          if (offsets) {
            const currentText = readEditorDocumentText(root);
            if (startEditorBulletListFromDashShortcut(root, currentText, offsets.start, offsets.end, inputEvent.data)) {
              event.preventDefault();
              editorInputBatcher.markChanged(root);
              return;
            }
          }
        }

        if (outlineStyle === "automatic-outline-numbering") {
          const offsets = getEditorSelectionOffsets(root);
          if (offsets) {
            const currentText = readEditorDocumentText(root);
            const edit = insertAutomaticOutlineFirstText(currentText, offsets.start, offsets.end, inputEvent.data);
            if (edit) {
              event.preventDefault();
              const appliedLocalEdit = applyPlainTextEditToRichDocument(root, currentText, edit);
              if (!appliedLocalEdit) {
                if (documentHasEditorImages(root)) return;
                replaceDocumentWithPlainText(root, edit.value, edit.selectionStart, edit.selectionEnd);
              }
              applyScriptedTypingStyle();
              editorInputBatcher.markChanged(root);
              return;
            }
          }
        }

        const editorListKind = editorListKindForOutlineStyle(outlineStyle);
        if (editorListKind) {
          const offsets = getEditorSelectionOffsets(root);
          if (offsets) {
            const currentText = readEditorDocumentText(root);
            if (startEditorListFromBlankLine(root, editorListKind, currentText, offsets.start, offsets.end, inputEvent.data)) {
              event.preventDefault();
              applyScriptedTypingStyle();
              editorInputBatcher.markChanged(root);
              return;
            }
          }
        }

        const anchor = getCollapsedAnchorAtSelectionEnd(root);
        if (anchor) {
          event.preventDefault();
          const inserted = isHyperlinkDividerText(inputEvent.data)
            ? insertPlainTextAfterAnchor(root, anchor, inputEvent.data)
            : appendTextToAnchorEnd(root, anchor, inputEvent.data);
          if (inserted) {
            applyScriptedTypingStyle();
            editorInputBatcher.markChanged(root);
          }
          return;
        }
        if (pendingStyle) {
          pendingNativeStyledInsertionRef.current = { text: inputEvent.data, style: pendingStyle };
          editorInputBatcher.begin(root, "typing", () => mentionUndoBefore ?? snapshotEditorDocumentRoot(root));
          return;
        }
      }

      if (inputEvent.inputType && inputEvent.inputType !== "insertCompositionText") {
        editorInputBatcher.begin(
          root,
          classifyEditorInputType(inputEvent.inputType),
          () => mentionUndoBefore ?? snapshotEditorDocumentRoot(root),
        );
      }
    },
    onPaste(event) {
      const root = event.currentTarget;
      editorInputBatcher.flush(root);
      rememberEditorSelectionRange(root);
      const undoBefore = snapshotEditorDocumentRoot(root);
      const html = event.clipboardData.getData("text/html");
      const text = event.clipboardData.getData("text/plain");
      const htmlKind = editorImageTransferHTMLKind(root.ownerDocument, html);
      const imageFiles = getImageFilesFromDataTransfer(event.clipboardData);
      const imageFile = imageFiles[0] ?? null;
      if (imageFile && shouldUseEditorImageFileTransferShortcut(true, htmlKind, text)) {
        event.preventDefault();
        clearPendingTypingStyle();
        const savedRange = getEditorSelectionRange(root)?.cloneRange() ?? null;
        const canCommit = createAsyncImageCommitGuard(root, savedRange);
        void insertEditorImageFile(root, imageFile, savedRange, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate, editorImageAttachmentContext, canCommit)
          .catch((cause) => reportEditorImageAttachmentError(editorImageAttachmentContext, onEditorImageAttachmentError, cause));
        return;
      }

      const clipboardImageData = readEditorImageClipboardDataFromHTML(root.ownerDocument, html);
      if (clipboardImageData) {
        event.preventDefault();
        clearPendingTypingStyle();
        const savedRange = getEditorSelectionRange(root)?.cloneRange() ?? null;
        const canCommit = createAsyncImageCommitGuard(root, savedRange);
        void insertEditorClipboardImageData(root, clipboardImageData, savedRange, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate, editorImageAttachmentContext, canCommit)
          .catch((cause) => reportEditorImageAttachmentError(editorImageAttachmentContext, onEditorImageAttachmentError, cause));
        return;
      }

      if (htmlKind === "other" && startEditorRichClipboardImport(root, html, imageFiles, undoBefore, false)) {
        event.preventDefault();
        return;
      }

      const sanitizedHTML = sanitizeEditorDocumentHTML(html);
      if (sanitizedHTML.trim()) {
        event.preventDefault();
        clearPendingTypingStyle();
        clearEditorImageSelection(root);
        const mentionUndoBefore = breakEditorMentionsForInput(root, "insertFromPaste", undoBefore);
        if (mentionUndoBefore) {
          activeMentionRootRef.current = null;
          setActiveMentionDraft(null);
        }
        if (replaceSelectionWithHTML(root, sanitizedHTML)) {
          recordEditorDocumentMutation(documentUndoHistoryRef.current, root, mentionUndoBefore ?? undoBefore, "paste");
          commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
          setActiveTableContextMenu(null);
          clearEditorTableCellSelections(root);
        }
        return;
      }

      if (!text) return;
      event.preventDefault();
      clearPendingTypingStyle();
      clearEditorImageSelection(root);
      const mentionUndoBefore = breakEditorMentionsForInput(root, "insertFromPaste", undoBefore);
      if (mentionUndoBefore) {
        activeMentionRootRef.current = null;
        setActiveMentionDraft(null);
      }
      if (replaceSelectionWithHTML(root, linkifyEditorPlainTextToHTML(text))) {
        recordEditorDocumentMutation(documentUndoHistoryRef.current, root, mentionUndoBefore ?? undoBefore, "paste");
        commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
      }
    },
    onCopy(event) {
      const root = event.currentTarget;
      if (copySelectedEditorImage(root, event.clipboardData, editorImageAttachmentContext) || copySelectedEditorDocumentFragment(root, event.clipboardData)) {
        event.preventDefault();
      }
    },
    onCut(event) {
      const root = event.currentTarget;
      if (!getSelectedEditorImageFrame(root)) return;
      event.preventDefault();
      editorInputBatcher.flush(root);
      const undoBefore = snapshotEditorDocumentRoot(root);
      if (!copySelectedEditorImage(root, event.clipboardData, editorImageAttachmentContext)) return;
      if (!removeSelectedEditorImage(root)) return;
      clearPendingTypingStyle();
      recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "image");
      commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
    },
    onDrop(event) {
      const root = event.currentTarget;
      rememberEditorSelectionRange(root);
      editorInputBatcher.flush(root);
      const undoBefore = snapshotEditorDocumentRoot(root);
      const html = event.dataTransfer.getData("text/html");
      const text = event.dataTransfer.getData("text/plain");
      const htmlKind = editorImageTransferHTMLKind(root.ownerDocument, html);
      const imageFiles = getImageFilesFromDataTransfer(event.dataTransfer);
      const imageFile = imageFiles[0] ?? null;
      if (imageFile && shouldUseEditorImageFileTransferShortcut(true, htmlKind, text)) {
        event.preventDefault();
        clearPendingTypingStyle();
        root.focus({ preventScroll: true });
        const savedRange = getEditorSelectionRange(root)?.cloneRange() ?? null;
        const canCommit = createAsyncImageCommitGuard(root, savedRange);
        void insertEditorImageFile(root, imageFile, savedRange, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate, editorImageAttachmentContext, canCommit)
          .catch((cause) => reportEditorImageAttachmentError(editorImageAttachmentContext, onEditorImageAttachmentError, cause));
        return;
      }

      const clipboardImageData = readEditorImageClipboardDataFromHTML(root.ownerDocument, html);
      if (clipboardImageData) {
        event.preventDefault();
        clearPendingTypingStyle();
        root.focus({ preventScroll: true });
        const savedRange = getEditorSelectionRange(root)?.cloneRange() ?? null;
        const canCommit = createAsyncImageCommitGuard(root, savedRange);
        void insertEditorClipboardImageData(root, clipboardImageData, savedRange, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate, editorImageAttachmentContext, canCommit)
          .catch((cause) => reportEditorImageAttachmentError(editorImageAttachmentContext, onEditorImageAttachmentError, cause));
        return;
      }

      const sanitizedHTML = sanitizeEditorDocumentHTML(html);
      if (htmlKind === "other" && startEditorRichClipboardImport(root, html, imageFiles, undoBefore, true)) {
        event.preventDefault();
        return;
      }

      if (sanitizedHTML.trim()) {
        event.preventDefault();
        clearPendingTypingStyle();
        clearEditorImageSelection(root);
        root.focus({ preventScroll: true });
        const mentionUndoBefore = breakEditorMentionsForInput(root, "insertFromPaste", undoBefore);
        if (mentionUndoBefore) {
          activeMentionRootRef.current = null;
          setActiveMentionDraft(null);
        }
        if (replaceSelectionWithHTML(root, sanitizedHTML)) {
          recordEditorDocumentMutation(documentUndoHistoryRef.current, root, mentionUndoBefore ?? undoBefore, "paste");
          commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
          setActiveTableContextMenu(null);
          clearEditorTableCellSelections(root);
        }
        return;
      }

      if (!text) return;
      event.preventDefault();
      clearPendingTypingStyle();
      clearEditorImageSelection(root);
      root.focus({ preventScroll: true });
      const mentionUndoBefore = breakEditorMentionsForInput(root, "insertFromPaste", undoBefore);
      if (mentionUndoBefore) {
        activeMentionRootRef.current = null;
        setActiveMentionDraft(null);
      }
      if (replaceSelectionWithHTML(root, linkifyEditorPlainTextToHTML(text))) {
        recordEditorDocumentMutation(documentUndoHistoryRef.current, root, mentionUndoBefore ?? undoBefore, "paste");
        commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
      }
    },
    onInput(event) {
      const root = event.currentTarget;
      const pendingStyledInsertion = pendingNativeStyledInsertionRef.current;
      const inputEvent = event.nativeEvent as InputEvent;
      pendingNativeStyledInsertionRef.current = null;
      if (pendingStyledInsertion) applyEditorTypingStyleToRecentlyInsertedText(root, pendingStyledInsertion.text, pendingStyledInsertion.style);
      editorInputBatcher.markChanged(root, inputEvent.isComposing);
      rememberEditorSelectionRange(root);
      if (
        pendingEditorFontSizeRef.current !== null
        || pendingEditorHighlightColorRef.current !== undefined
        || pendingEditorInlineFormatRef.current !== null
      ) {
        pendingEditorTypingCaretRef.current = getEditorTypingCaretBookmark(event.currentTarget);
      }
      syncActiveSelectionFormat(root);
      refreshMentionDraft(root);
      setActiveTableContextMenu(null);
      clearEditorTableCellSelections(root);
    },
    onCompositionStart(event) {
      const root = event.currentTarget;
      editorInputBatcher.flush(root);
      editorInputBatcher.begin(root, "typing", () => snapshotEditorDocumentRoot(root));
    },
    onCompositionEnd(event) {
      const root = event.currentTarget;
      const pendingFontSize = pendingEditorFontSizeRef.current;
      const pendingHighlightColor = pendingEditorHighlightColorRef.current;
      const pendingInlineFormat = pendingEditorInlineFormatRef.current;
      const composedText = event.data;
      if (composedText && (pendingFontSize !== null || pendingHighlightColor !== undefined || pendingInlineFormat !== null)) {
        const pendingStyle: EditorPendingTypingStyle = {};
        if (pendingFontSize !== null) pendingStyle.fontSize = pendingFontSize;
        if (pendingHighlightColor !== undefined) pendingStyle.highlightColor = pendingHighlightColor;
        if (pendingInlineFormat !== null) pendingStyle.inlineFormat = pendingInlineFormat;
        applyEditorTypingStyleToRecentlyInsertedText(root, composedText, pendingStyle);
        if (pendingFontSize !== null) onSelectionFontSizeChange(pendingFontSize);
        if (pendingHighlightColor !== undefined) onSelectionHighlightColorChange?.(pendingHighlightColor);
        if (pendingInlineFormat !== null) onSelectionInlineFormatChange?.(pendingInlineFormat);
      }
      if (composedText) editorInputBatcher.markChanged(root);
      rememberEditorSelectionRange(root);
      pendingEditorTypingCaretRef.current = getEditorTypingCaretBookmark(root);
      refreshMentionDraft(root);
    },
    onSelect(event) {
      const root = event.currentTarget;
      const range = getEditorSelectionRange(root);
      rememberEditorSelectionRange(root);
      if (range && !range.collapsed) {
        setActiveMentionDraft(null);
        setActiveTableContextMenu(null);
        clearPendingTypingStyle();
        syncActiveSelectionFormat(root);
        return;
      }
      refreshMentionDraft(root);
      syncActiveSelectionFormat(root);
    },
    onClick(event) {
      const root = event.currentTarget;
      editorInputBatcher.flush(root);
      const pendingCaret = pendingEditorTypingCaretRef.current;
      const retainsPendingTypingStyle = pendingCaret ? editorTypingCaretMatches(root, pendingCaret) : false;
      rememberEditorSelectionRange(root);
      setActiveTableContextMenu(null);
      if (!findEditorImageFrame(root, event.target)) {
        clearEditorImageSelection(root);
      }
      if (!retainsPendingTypingStyle) clearPendingTypingStyle();
      syncActiveSelectionFormat(root);
      const checklistItem = getChecklistItemForPointer(root, event);
      if (checklistItem) {
        event.preventDefault();
        event.stopPropagation();
        const undoBefore = snapshotEditorDocumentRoot(root);
        checklistItem.setAttribute(
          EDITOR_CHECKLIST_CHECKED_ATTRIBUTE,
          checklistItem.getAttribute(EDITOR_CHECKLIST_CHECKED_ATTRIBUTE) === "true" ? "false" : "true",
        );
        recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "format");
        commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
        return;
      }
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) {
        const cell = getClosestEditorTableCell(root, event.target);
        const table = getEditorTableForCell(root, cell);
        const coordinates = cell && table ? getEditorTableCellCoordinates(table, cell) : null;
        if (!cell || !table || !coordinates || !markEditorTableHeaderSelection(root, table, coordinates)) {
          clearEditorTableCellSelections(root);
        }
        refreshMentionDraft(root);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      window.open(anchor.href, "_blank", "noopener,noreferrer");
    },
    onDoubleClick(event) {
      const root = event.currentTarget;
      const frame = findEditorImageFrame(root, event.target);
      if (!frame) return;
      event.preventDefault();
      event.stopPropagation();
      clearPendingTypingStyle();
      setActiveTableContextMenu(null);
      root.focus({ preventScroll: true });
      selectEditorImageFrame(root, frame);
      previewEditorImageFrame(root, frame, setActiveImagePreview);
    },
    onContextMenu(event) {
      openTableContextMenu(event.currentTarget, event);
    },
    onPointerDown(event) {
      editorInputBatcher.flush(event.currentTarget);
      const mention = closestMentionElement(
        event.currentTarget,
        event.target instanceof Node ? event.target : null,
      );
      if (mention) {
        event.preventDefault();
        event.stopPropagation();
        clearPendingTypingStyle();
        clearEditorImageSelection(event.currentTarget);
        setActiveTableContextMenu(null);
        event.currentTarget.focus({ preventScroll: true });
        const bounds = mention.getBoundingClientRect();
        setSelectionBesideMention(
          event.currentTarget,
          mention,
          event.clientX <= bounds.left + (bounds.width / 2) ? "before" : "after",
        );
        rememberEditorSelectionRange(event.currentTarget);
        syncActiveSelectionFormat(event.currentTarget);
        return;
      }
      const frame = findEditorImageFrame(event.currentTarget, event.target);
      if (!frame) {
        setActiveTableContextMenu(null);
        const tableInteraction = getEditorTablePointerInteraction(event.currentTarget, event.target, event.clientX, event.clientY);
        if (!tableInteraction || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        clearPendingTypingStyle();
        clearEditorImageSelection(event.currentTarget);
        event.currentTarget.focus({ preventScroll: true });
        startEditorTablePointerInteraction(
          event.currentTarget,
          tableInteraction,
          event,
          documentUndoHistoryRef.current,
          scheduleDocumentSave,
          scheduleIndentGuideUpdate,
        );
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      clearPendingTypingStyle();
      setActiveTableContextMenu(null);
      event.currentTarget.focus({ preventScroll: true });
      selectEditorImageFrame(event.currentTarget, frame);
      if (event.button === 0) {
        startEditorImagePointerInteraction(
          event.currentTarget,
          frame,
          event,
          documentUndoHistoryRef.current,
          scheduleDocumentSave,
          scheduleIndentGuideUpdate,
        );
      }
    },
    onPointerMove(event) {
      if (updateEditorImageCursor(event.currentTarget, event.target, event.clientX, event.clientY)) return;
      if (updateEditorChecklistCursor(event.currentTarget, event)) return;
      updateEditorTableCursor(event.currentTarget, event.target, event.clientX, event.clientY);
    },
    onKeyUp(event) {
      rememberEditorSelectionRange(event.currentTarget);
      refreshMentionDraft(event.currentTarget);
      syncActiveSelectionFormat(event.currentTarget);
    },
    onBlur(event) {
      const root = event.currentTarget;
      rememberEditorSelectionRange(root);
      setActiveMentionDraft(null);
      setActiveTableContextMenu(null);
      activeMentionRootRef.current = null;
      pendingNativeStyledInsertionRef.current = null;
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(flushPendingInput(root) ?? serializeEditorDocumentHTML(root));
    },
    onScroll(event) {
      setActiveMentionDraft(null);
      setActiveTableContextMenu(null);
      activeMentionRootRef.current = null;
      if (restoringScrollRef.current) return;
      const targetKey = currentDocumentTargetKeyRef.current;
      if (targetKey) scrollMemoryRef.current.remember(targetKey, event.currentTarget.scrollTop);
      setDocumentScrollTop(event.currentTarget.scrollTop);
    },
    onWheel(event) {
      event.stopPropagation();
    },
    onKeyDown(event) {
      const root = event.currentTarget;
      if (!event.nativeEvent.isComposing) {
        if (event.key === "Backspace" || event.key === "Delete") {
          editorInputBatcher.flushBoundary(root, "delete");
        } else if (event.key === "Enter") {
          editorInputBatcher.flushBoundary(root, "lineBreak");
        } else if (event.key === "Tab") {
          editorInputBatcher.flushBoundary(root, "tab");
        } else if (event.ctrlKey || event.metaKey || event.altKey || event.key === "Escape" || PENDING_TYPING_STYLE_CANCEL_KEYS.has(event.key)) {
          editorInputBatcher.flush(root);
        }
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
        if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
          event.preventDefault();
          insertMention(root, activeMentionDraft, mentionOptions[activeMentionIndex] ?? mentionOptions[0]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setActiveMentionDraft(null);
          activeMentionRootRef.current = null;
          return;
        }
      }

      if (isEditorUndoShortcut(event) || isEditorRedoShortcut(event)) {
        clearPendingTypingStyle();
        pendingNativeStyledInsertionRef.current = null;
        const applied = applyEditorUndoCommand(
          root,
          documentUndoHistoryRef.current,
          isEditorUndoShortcut(event) ? "undo" : "redo",
          scheduleDocumentSave,
          scheduleIndentGuideUpdate,
          onSelectionFontSizeChange,
          onSelectionInlineFormatChange,
          onSelectionHighlightColorChange,
          onSelectionTextAlignmentChange,
        );
        if (applied) event.preventDefault();
        return;
      }

      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
        && moveEditorSelectionAcrossMention(root, event.key === "ArrowLeft" ? "backward" : "forward", event.shiftKey)
      ) {
        event.preventDefault();
        clearPendingTypingStyle();
        rememberEditorSelectionRange(root);
        syncActiveSelectionFormat(root);
        return;
      }

      const mentionKeyboardEdit = event.key === "Backspace"
        ? { kind: "deleteBackward" as const }
        : event.key === "Delete" ? { kind: "deleteForward" as const } : null;
      if (mentionKeyboardEdit && applyAtomicMentionKeyboardEdit(
        root,
        mentionKeyboardEdit,
        documentUndoHistoryRef.current,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
      )) {
        event.preventDefault();
        clearPendingTypingStyle();
        clearEditorImageSelection(root);
        activeMentionRootRef.current = null;
        setActiveMentionDraft(null);
        syncActiveSelectionFormat(root);
        return;
      }

      if (event.key === "Backspace" && joinEditorLineBeforeMention(
        root,
        documentUndoHistoryRef.current,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
      )) {
        event.preventDefault();
        clearPendingTypingStyle();
        clearEditorImageSelection(root);
        activeMentionRootRef.current = null;
        setActiveMentionDraft(null);
        rememberEditorSelectionRange(root);
        syncActiveSelectionFormat(root);
        return;
      }

      // Chrome can route React contenteditable text through a TextEvent whose
      // native payload has no inputType. Own the Markdown-style shortcut at
      // keydown as well so a physical Space key always reaches the editor rule;
      // onBeforeInput remains the non-keyboard/mobile fallback.
      if (
        event.key === " "
        && !event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && !event.nativeEvent.isComposing
      ) {
        const activeEditorListItem = getCurrentEditorListItem(root);
        if (!activeEditorListItem) {
          const activeTableCell = getCurrentEditorTableCell(root);
          const undoBefore = snapshotEditorDocumentRoot(root);
          let startedBulletList = false;
          if (activeTableCell) {
            startedBulletList = startEditorTableCellBulletListFromDashShortcut(root, activeTableCell, " ");
          } else {
            const offsets = getEditorSelectionOffsets(root);
            if (offsets) {
              const currentText = readEditorDocumentText(root);
              startedBulletList = startEditorBulletListFromDashShortcut(root, currentText, offsets.start, offsets.end, " ");
            }
          }
          if (startedBulletList) {
            event.preventDefault();
            clearEditorImageSelection(root);
            setActiveTableContextMenu(null);
            recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "typing");
            commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
            return;
          }
        }
      }

      const activeTableCell = getCurrentEditorTableCell(root);
      if (activeTableCell) {
        if (event.key === "Enter") {
          event.preventDefault();
          clearPendingTypingStyle();
          clearEditorImageSelection(root);
          const tableListItem = getCurrentEditorListItem(root);
          if (!event.shiftKey && tableListItem && activeTableCell.contains(tableListItem)) {
            const mentionUndoBefore = breakEditorMentionsForInput(root, "insertParagraph");
            if (mentionUndoBefore) {
              activeMentionRootRef.current = null;
              setActiveMentionDraft(null);
            }
            const undoBefore = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
            const changed = editorListItemContentIsEmpty(tableListItem)
              ? exitEditorListItem(root, tableListItem)
              : insertEditorListItemAfter(root, tableListItem);
            if (changed) {
              recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "lineBreak");
              commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
            }
          } else {
            const tableEditorListKind = !event.shiftKey ? editorListKindForOutlineStyle(outlineStyle) : null;
            if (tableEditorListKind) {
              const mentionUndoBefore = breakEditorMentionsForInput(root, "insertParagraph");
              if (mentionUndoBefore) {
                activeMentionRootRef.current = null;
                setActiveMentionDraft(null);
              }
              const undoBefore = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
              if (insertEditorTableCellListFromEnter(root, activeTableCell, tableEditorListKind)) {
                recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "lineBreak");
                commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
              }
            } else {
              insertEditorTableCellLineBreak(root, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
            }
          }
          setActiveTableContextMenu(null);
          clearEditorTableCellSelections(root);
          return;
        }
        if (event.key === "Backspace" || event.key === "Delete") {
          clearPendingTypingStyle();
          clearEditorImageSelection(root);
          if (deleteSelectedEditorTableDimension(root, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate)) {
            event.preventDefault();
            setActiveTableContextMenu(null);
            return;
          }
          if (!getCurrentEditorListItem(root)) return;
        }
      }

      if (event.key === "Escape") {
        event.preventDefault();
        clearPendingTypingStyle();
        clearEditorImageSelection(root);
        setActiveTableContextMenu(null);
        root.blur();
        return;
      }

      if (PENDING_TYPING_STYLE_CANCEL_KEYS.has(event.key)) {
        clearPendingTypingStyle();
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        const undoBefore = snapshotEditorDocumentRoot(root);
        if (!removeSelectedEditorImage(root)) {
          // Text deletion handling below still gets its own narrower undo group.
        } else {
          event.preventDefault();
          recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "image");
          commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
          return;
        }
      }

      // A DOM range spanning empty list rows can flatten to identical text
      // offsets because the rows contain only <br> placeholders. Preserve the
      // browser's normal selected-range deletion instead of treating its first
      // row as a collapsed-caret "exit list" command.
      const deletionSelection = event.key === "Backspace" || event.key === "Delete"
        ? getEditorSelectionRange(root)
        : null;
      if (deletionSelection && !deletionSelection.collapsed) return;

      const activeEditorListItem = getCurrentEditorListItem(root);
      if (activeEditorListItem) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          clearPendingTypingStyle();
          clearEditorImageSelection(root);
          const mentionUndoBefore = breakEditorMentionsForInput(root, "insertParagraph");
          if (mentionUndoBefore) {
            activeMentionRootRef.current = null;
            setActiveMentionDraft(null);
          }
          const undoBefore = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
          const changed = editorListItemContentIsEmpty(activeEditorListItem)
            ? exitEditorListItem(root, activeEditorListItem)
            : insertEditorListItemAfter(root, activeEditorListItem);
          if (changed) {
            recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "lineBreak");
            commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
          }
          return;
        }

        if (event.key === "Tab") {
          event.preventDefault();
          clearPendingTypingStyle();
          clearEditorImageSelection(root);
          const mentionUndoBefore = breakEditorMentionsForInput(root, "insertText");
          if (mentionUndoBefore) {
            activeMentionRootRef.current = null;
            setActiveMentionDraft(null);
          }
          const undoBefore = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
          const changed = event.shiftKey
            ? outdentEditorListItem(root, activeEditorListItem)
            : indentEditorListItem(root, activeEditorListItem);
          if (changed) {
            recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "tab");
            commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
          }
          return;
        }

        if (event.key === "Backspace" && editorListItemContentIsEmpty(activeEditorListItem)) {
          event.preventDefault();
          clearPendingTypingStyle();
          clearEditorImageSelection(root);
          const undoBefore = snapshotEditorDocumentRoot(root);
          if (exitEditorListItem(root, activeEditorListItem)) {
            recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "delete");
            commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
          }
          return;
        }
      }

      if (event.key === "Enter") {
        event.preventDefault();
        clearPendingTypingStyle();
        clearEditorImageSelection(root);
        const offsets = getEditorSelectionOffsets(root);
        if (!offsets) return;
        const mentionUndoBefore = breakEditorMentionsForInput(root, "insertParagraph");
        if (mentionUndoBefore) {
          activeMentionRootRef.current = null;
          setActiveMentionDraft(null);
        }
        const undoBefore = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
        const currentText = readEditorDocumentText(root);
        const editorListKind = !event.shiftKey ? editorListKindForOutlineStyle(outlineStyle) : null;
        if (editorListKind) {
          if (insertEditorListFromEnter(root, editorListKind, currentText, offsets.start, offsets.end)) {
            scrollEditorToLineStart(root);
            recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "lineBreak");
            commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
          }
          return;
        }
        const edit = insertEditorEnterText(currentText, offsets.start, offsets.end, outlineStyle, { continueAutomaticOutline: !event.shiftKey });
        const insertedText = edit.value.slice(offsets.start, edit.selectionStart);
        const simpleReplacement = `${currentText.slice(0, offsets.start)}${insertedText}${currentText.slice(offsets.end)}`;
        if (simpleReplacement !== edit.value) {
          const appliedRichEdit = applyPlainTextEditToRichDocument(root, currentText, edit);
          if (!appliedRichEdit) {
            if (documentHasEditorImages(root)) return;
            replaceDocumentWithPlainText(root, edit.value, edit.selectionStart, edit.selectionEnd);
          }
          scrollEditorToLineStart(root);
          recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "lineBreak");
          commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
          return;
        }
        const preserveTrailingNewline = edit.value.endsWith("\n") && offsets.end >= currentText.length;
        const anchor = getCollapsedAnchorAtSelectionEnd(root);
        const inserted = anchor
          ? insertPlainTextAfterAnchor(root, anchor, insertedText, { preserveTrailingNewline })
          : replaceSelectionWithText(root, insertedText, { preserveTrailingNewline });
        if (inserted) {
          scrollEditorToLineStart(root);
          recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "lineBreak");
          commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
        }
        return;
      }

      if (event.key === "Backspace") {
        const offsets = getEditorSelectionOffsets(root);
        if (!offsets) return;
        const undoBefore = snapshotEditorDocumentRoot(root);
        const currentText = readEditorDocumentText(root);
        const edit = deleteEditorBackspaceText(currentText, offsets.start, offsets.end, outlineStyle);
        if (!edit) return;
        event.preventDefault();
        clearPendingTypingStyle();
        clearEditorImageSelection(root);
        if (deleteTextByOffsets(root, edit.selectionStart, offsets.start, { preserveTrailingNewline: edit.value.endsWith("\n") })) {
          recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "delete");
          commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
        }
        return;
      }

      if (event.key !== "Tab") return;
      event.preventDefault();
      clearPendingTypingStyle();
      clearEditorImageSelection(root);
      const offsets = getEditorSelectionOffsets(root);
      if (!offsets) return;
      const mentionUndoBefore = breakEditorMentionsForInput(root, "insertText");
      if (mentionUndoBefore) {
        activeMentionRootRef.current = null;
        setActiveMentionDraft(null);
      }
      const undoBefore = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
      const anchor = !event.shiftKey ? getCollapsedAnchorAtSelectionEnd(root) : null;
      if (anchor) {
        insertPlainTextAfterAnchor(root, anchor, EDITOR_TAB_TEXT);
        recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "tab");
        commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
        return;
      }
      const currentText = readEditorDocumentText(root);
      const edit = event.shiftKey
        ? insertEditorTabText(currentText, offsets.start, offsets.end, outlineStyle, "outdent")
        : insertEditorTabText(currentText, offsets.start, offsets.end, outlineStyle, "indent");
      if (edit.value === currentText && edit.selectionStart === offsets.start && edit.selectionEnd === offsets.end) return;
      if (event.shiftKey && outlineStyle === "indent-guides" && offsets.start === offsets.end) {
        const deletionMatchesOutdent = edit.selectionStart <= offsets.start
          && `${currentText.slice(0, edit.selectionStart)}${currentText.slice(offsets.start)}` === edit.value;
        if (deletionMatchesOutdent) {
          if (deleteTextByOffsets(root, edit.selectionStart, offsets.start, { preserveTrailingNewline: edit.value.endsWith("\n") })) {
            recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "tab");
            commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
          }
          return;
        }
      }
      const simpleInsertedText = edit.value.slice(offsets.start, edit.selectionStart);
      const simpleReplacement = `${currentText.slice(0, offsets.start)}${simpleInsertedText}${currentText.slice(offsets.end)}`;
      if (!event.shiftKey && simpleReplacement === edit.value) {
        replaceSelectionWithText(root, simpleInsertedText || EDITOR_TAB_TEXT);
      } else {
        const appliedRichEdit = applyPlainTextEditToRichDocument(root, currentText, edit);
        if (!appliedRichEdit) {
          if (documentHasEditorImages(root)) return;
          replaceDocumentWithPlainText(root, edit.value, edit.selectionStart, edit.selectionEnd);
        }
      }
      recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "tab");
      commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
    },
  }), [
    activeMentionDraft,
    activeMentionIndex,
    clearPendingTypingStyle,
    createAsyncImageCommitGuard,
    currentDocumentTargetKeyRef,
    documentUndoHistoryRef,
    editorInputBatcher,
    editorImageAttachmentContext,
    flushPendingDocumentSave,
    insertMention,
    flushPendingInput,
    mentionMenuOpen,
    mentionOptions,
    onSelectionFontSizeChange,
    onSelectionHighlightColorChange,
    onSelectionInlineFormatChange,
    onSelectionTextAlignmentChange,
    onEditorImageAttachmentError,
    openTableContextMenu,
    outlineStyle,
    pendingEditorFontSizeRef,
    pendingEditorHighlightColorRef,
    pendingEditorInlineFormatRef,
    pendingEditorTypingCaretRef,
    rememberCurrentDocumentScroll,
    rememberEditorSelectionRange,
    refreshMentionDraft,
    restoringScrollRef,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
    scrollMemoryRef,
    setDocumentScrollTop,
    startEditorRichClipboardImport,
    syncActiveSelectionFormat,
  ]);
  const insertTable = useCallback((root?: HTMLElement | null) => {
    if (!root) return false;
    restoreEditorSelectionRange(root);
    editorInputBatcher.flush(root);
    root.focus({ preventScroll: true });
    clearPendingTypingStyle();
    clearEditorImageSelection(root);
    setActiveTableContextMenu(null);
    activeMentionRootRef.current = null;
    setActiveMentionDraft(null);
    const inserted = insertEditorTable(root, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
    if (inserted) rememberEditorSelectionRange(root);
    return inserted;
  }, [clearPendingTypingStyle, documentUndoHistoryRef, editorInputBatcher, rememberEditorSelectionRange, restoreEditorSelectionRange, scheduleDocumentSave, scheduleIndentGuideUpdate]);

  const blockingImagePreview = imagePreviewModal;
  const overlay = React.createElement(React.Fragment, null, mentionMenu, tableContextMenu, blockingImagePreview);
  return { ...handlers, mentionMenu: overlay, insertTable, restoreSelection: restoreEditorSelectionRange, flushPendingInput };
}
