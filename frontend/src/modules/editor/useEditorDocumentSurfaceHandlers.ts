import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorDocumentSurfaceProps } from "./EditorDocumentSurface";
import type { EditorScrollMemory } from "./editorScroll";
import {
  EDITOR_TAB_TEXT,
  deleteEditorBackspaceText,
  insertAutomaticOutlineFirstText,
  insertEditorEnterText,
  insertEditorTabText,
  type EditorOutlineStyleID,
} from "./plainTextEditing";
import {
  EDITOR_TERMINAL_BREAK_ATTRIBUTE,
  EDITOR_IMAGE_CLEAR_BREAK_ATTRIBUTE,
  deserializeEditorDocumentHTML,
  getEditorLinkHrefForText,
  linkifyEditorPlainTextToHTML,
  readEditorDocumentText,
  serializeEditorDocumentHTML,
} from "./richTextEditing";
import {
  recordEditorDocumentUndoChange,
  redoEditorDocument,
  snapshotEditorDocumentHTML,
  undoEditorDocument,
  type EditorDocumentChangeKind,
  type EditorDocumentUndoHistory,
  type EditorDocumentUndoSnapshot,
} from "./editorUndoHistory";
import {
  EDITOR_DOCUMENT_MAX_FONT_SIZE_PX,
  EDITOR_DOCUMENT_MIN_FONT_SIZE_PX,
} from "./useEditorPreferences";
import {
  buildMentionOptions,
  createEditorMentionElement,
  EDITOR_MENTION_ATTRIBUTE,
  mentionUserDisplayName,
  mentionUserOptionLabel,
  readActiveMentionDraft,
  type ActiveMentionDraft,
  type MentionableCompanyUser,
} from "./editorMentions";
import {
  DEFAULT_EDITOR_IMAGE_MARGIN_TOP_PX,
  EDITOR_IMAGE_MAX_WIDTH_INSET_PX,
  applyEditorImageFloatLayout,
  clampEditorImageOffset,
  clampEditorImageSize,
  clampEditorImageVerticalOffset,
  clearEditorImageSelection,
  createEditorImageBlob,
  createEditorImageClipboardHTML,
  createEditorImageDataFromFile,
  createEditorImageDataFromSource,
  createEditorImageFrame,
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
  getSelectedEditorImageFrame,
  selectEditorImageFrame,
  type EditorImageClipboardData,
  type EditorImageData,
} from "./editorImages";

export type EditorDocumentSurfaceHandlers = Pick<
  EditorDocumentSurfaceProps,
  | "onBeforeInput"
  | "onPaste"
  | "onCopy"
  | "onDrop"
  | "onInput"
  | "onSelect"
  | "onClick"
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
};

type UseEditorDocumentSurfaceHandlersOptions = {
  restoringScrollRef: React.MutableRefObject<boolean>;
  currentDocumentTargetKeyRef: React.MutableRefObject<string>;
  scrollMemoryRef: React.MutableRefObject<EditorScrollMemory>;
  documentUndoHistoryRef: React.MutableRefObject<EditorDocumentUndoHistory>;
  pendingEditorFontSizeRef: React.MutableRefObject<number | null>;
  outlineStyle: EditorOutlineStyleID;
  setDocumentScrollTop: React.Dispatch<React.SetStateAction<number>>;
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
  scheduleIndentGuideUpdate: (text: string) => void;
  rememberCurrentDocumentScroll: () => void;
  flushPendingDocumentSave: (fallbackText?: string) => void;
  onSelectionFontSizeChange: (fontSize: number) => void;
  mentionUsers?: MentionableCompanyUser[];
  mentionAccent?: string;
  mentionSurfaceText?: string;
  mentionStrokeColor?: string;
};

function clampEditorFontSize(value: number): number {
  return Math.max(EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, Math.min(EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, Math.round(value)));
}

const PENDING_FONT_SIZE_CANCEL_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Backspace", "Delete", "End", "Home", "PageDown", "PageUp"]);
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

function getEditorSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const range = getEditorSelectionRange(root);
  if (!range) return null;
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

function setEditorSelectionByOffsets(root: HTMLElement, start: number, end = start) {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  if (!selection) return;

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startNodeOffset = 0;
  let endNodeOffset = 0;

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const nextOffset = currentOffset + node.data.length;
    if (!startNode && start <= nextOffset) {
      startNode = node;
      startNodeOffset = Math.max(0, Math.min(node.data.length, start - currentOffset));
    }
    if (!endNode && end <= nextOffset) {
      endNode = node;
      endNodeOffset = Math.max(0, Math.min(node.data.length, end - currentOffset));
      break;
    }
    currentOffset = nextOffset;
  }

  if (!startNode) {
    const textNode = doc.createTextNode("");
    root.appendChild(textNode);
    startNode = textNode;
    startNodeOffset = 0;
  }
  if (!endNode) {
    endNode = startNode;
    endNodeOffset = startNodeOffset;
  }

  const range = doc.createRange();
  range.setStart(startNode, startNodeOffset);
  range.setEnd(endNode, endNodeOffset);
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

function collectMentionElementsForNativeEdit(root: HTMLElement, inputType: string): HTMLElement[] {
  const range = getEditorSelectionRange(root);
  if (!range) return [];

  const mentions = new Set<HTMLElement>();
  const addClosestMention = (node: Node | null) => {
    const mention = closestMentionElement(root, node);
    if (mention) mentions.add(mention);
  };

  addClosestMention(range.startContainer);
  addClosestMention(range.endContainer);

  if (!range.collapsed) {
    root.querySelectorAll(EDITOR_MENTION_SELECTOR).forEach((node) => {
      try {
        if (range.intersectsNode(node)) mentions.add(node as HTMLElement);
      } catch {
        // Ignore detached nodes or browser range edge cases.
      }
    });
  }

  if (range.collapsed && inputType.startsWith("delete")) {
    const offsets = getEditorSelectionOffsets(root);
    if (offsets) {
      const deleteBackward = inputType.toLowerCase().includes("backward");
      const deleteForward = inputType.toLowerCase().includes("forward");
      root.querySelectorAll(EDITOR_MENTION_SELECTOR).forEach((node) => {
        const mentionOffsets = getNodeTextOffsets(root, node);
        if (!mentionOffsets) return;
        if ((deleteBackward && offsets.start === mentionOffsets.end) || (deleteForward && offsets.start === mentionOffsets.start)) {
          mentions.add(node as HTMLElement);
        }
      });
    }
  }

  return Array.from(mentions).filter((mention) => root.contains(mention));
}

function breakEditorMentionsForInput(root: HTMLElement, inputType: string, undoBefore?: EditorDocumentUndoSnapshot): EditorDocumentUndoSnapshot | null {
  const mentions = collectMentionElementsForNativeEdit(root, inputType);
  if (mentions.length === 0) return null;
  const snapshotBefore = undoBefore ?? snapshotEditorDocumentRoot(root);
  const offsets = getEditorSelectionOffsets(root);
  for (const mention of mentions) {
    mention.replaceWith(root.ownerDocument.createTextNode(mention.textContent ?? ""));
  }
  if (offsets) setEditorSelectionByOffsets(root, offsets.start, offsets.end);
  return snapshotBefore;
}

function isPlainTextKeyboardEdit(event: React.KeyboardEvent<HTMLDivElement>): boolean {
  return event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey;
}

function applyMentionBreakingKeyboardEdit(
  root: HTMLElement,
  edit: { kind: "deleteBackward" | "deleteForward" | "insertText"; text?: string },
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
): boolean {
  const inputType = edit.kind === "deleteBackward"
    ? "deleteContentBackward"
    : edit.kind === "deleteForward" ? "deleteContentForward" : "insertText";
  const mentions = collectMentionElementsForNativeEdit(root, inputType);
  if (mentions.length === 0) return false;

  const offsets = getEditorSelectionOffsets(root);
  if (!offsets) return false;
  const undoBefore = snapshotEditorDocumentRoot(root);
  for (const mention of mentions) {
    mention.replaceWith(root.ownerDocument.createTextNode(mention.textContent ?? ""));
  }
  setEditorSelectionByOffsets(root, offsets.start, offsets.end);

  let changed = false;
  if (edit.kind === "insertText") {
    changed = replaceSelectionWithText(root, edit.text ?? "");
  } else if (offsets.start !== offsets.end) {
    changed = deleteTextByOffsets(root, offsets.start, offsets.end);
  } else {
    const currentText = readEditorDocumentText(root);
    const deleteStart = edit.kind === "deleteBackward" ? Math.max(0, offsets.start - 1) : offsets.start;
    const deleteEnd = edit.kind === "deleteBackward" ? offsets.start : Math.min(currentText.length, offsets.start + 1);
    changed = deleteStart !== deleteEnd && deleteTextByOffsets(root, deleteStart, deleteEnd, { preserveTrailingNewline: currentText.endsWith("\n") });
    if (!changed) setEditorSelectionByOffsets(root, offsets.start, offsets.start);
  }

  recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, edit.kind === "insertText" ? "typing" : "delete");
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
  return true;
}

function readInlineFontSize(element: HTMLElement): number | null {
  const parsed = Number.parseFloat(element.style.fontSize.trim());
  return Number.isFinite(parsed) ? clampEditorFontSize(parsed) : null;
}

function findMatchingFontSizeSpan(root: HTMLElement, node: Node, fontSize: number): HTMLSpanElement | null {
  let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  const targetFontSize = clampEditorFontSize(fontSize);
  while (current && current !== root) {
    if (current instanceof HTMLSpanElement && root.contains(current) && readInlineFontSize(current) === targetFontSize) return current;
    current = current.parentNode;
  }
  return null;
}

function replaceSelectionWithHTML(root: HTMLElement, html: string): boolean {
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = html;
  const fragment = template.content;
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

function getImageFileFromDataTransfer(dataTransfer: DataTransfer): File | null {
  for (let index = 0; index < dataTransfer.items.length; index += 1) {
    const item = dataTransfer.items[index];
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  for (let index = 0; index < dataTransfer.files.length; index += 1) {
    const file = dataTransfer.files[index];
    if (file.type.startsWith("image/")) return file;
  }
  return null;
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

async function insertEditorImageFile(
  root: HTMLElement,
  file: File,
  savedRange: Range | null,
  undoBefore: EditorDocumentUndoSnapshot | null,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
) {
  const maxDisplayWidth = Math.max(120, Math.min(720, root.clientWidth - 56));
  const imageData = await createEditorImageDataFromFile(file, maxDisplayWidth, getEditorImageStorageBudget(root));
  insertPreparedEditorImage(root, imageData, savedRange, undoBefore, documentUndoHistory, scheduleDocumentSave, scheduleIndentGuideUpdate);
}

async function insertEditorClipboardImageData(
  root: HTMLElement,
  clipboardData: EditorImageClipboardData,
  savedRange: Range | null,
  undoBefore: EditorDocumentUndoSnapshot | null,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
) {
  const maxDisplayWidth = Math.max(120, Math.min(720, root.clientWidth - 56));
  const imageData = await createEditorImageDataFromSource(clipboardData.src, maxDisplayWidth, {
    maxStoredBytes: getEditorImageStorageBudget(root),
    preferredWidth: clipboardData.width,
    preferredHeight: clipboardData.height,
    marginLeft: clipboardData.marginLeft,
    marginTop: clipboardData.marginTop,
    floatSide: clipboardData.floatSide,
  });
  insertPreparedEditorImage(root, imageData, savedRange, undoBefore, documentUndoHistory, scheduleDocumentSave, scheduleIndentGuideUpdate);
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

function replaceSelectionWithStyledText(root: HTMLElement, text: string, fontSize: number): boolean {
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  const nextFontSize = clampEditorFontSize(fontSize);
  if (range.collapsed && range.startContainer.nodeType === Node.TEXT_NODE) {
    const textNode = range.startContainer as Text;
    if (findMatchingFontSizeSpan(root, textNode, nextFontSize)) {
      textNode.insertData(range.startOffset, text);
      setCollapsedSelectionInTextNode(root, textNode, range.startOffset + text.length);
      return true;
    }
  }
  const span = root.ownerDocument.createElement("span");
  span.style.fontSize = `${nextFontSize}px`;
  const textNode = root.ownerDocument.createTextNode(text);
  span.appendChild(textNode);
  range.deleteContents();
  range.insertNode(span);
  range.setStart(textNode, textNode.data.length);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function replaceDocumentWithPlainText(root: HTMLElement, text: string, selectionStart: number, selectionEnd = selectionStart) {
  root.innerHTML = linkifyEditorPlainTextToHTML(text);
  setEditorSelectionByOffsets(root, selectionStart, selectionEnd);
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
  const plainText = readEditorDocumentText(root);
  scheduleDocumentSave(serializeEditorDocumentHTML(root), immediate);
  scheduleIndentGuideUpdate(plainText);
}

function snapshotEditorDocumentRoot(root: HTMLElement): EditorDocumentUndoSnapshot {
  const offsets = getEditorSelectionOffsets(root);
  const fallbackOffset = readEditorDocumentText(root).length;
  return snapshotEditorDocumentHTML(
    serializeEditorDocumentHTML(root),
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

function restoreEditorDocumentUndoSnapshot(
  root: HTMLElement,
  snapshot: EditorDocumentUndoSnapshot,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
  onSelectionFontSizeChange: (fontSize: number) => void,
) {
  root.innerHTML = deserializeEditorDocumentHTML(snapshot.html);
  setEditorSelectionByOffsets(root, snapshot.selectionStart, snapshot.selectionEnd);
  clearEditorImageSelection(root);
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
  syncSelectionFontSize(root, onSelectionFontSizeChange);
}

function applyEditorUndoCommand(
  root: HTMLElement,
  history: EditorDocumentUndoHistory,
  direction: "undo" | "redo",
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
  onSelectionFontSizeChange: (fontSize: number) => void,
): boolean {
  const currentHTML = serializeEditorDocumentHTML(root);
  const snapshot = direction === "undo"
    ? undoEditorDocument(history, currentHTML)
    : redoEditorDocument(history, currentHTML);
  if (!snapshot) return false;
  restoreEditorDocumentUndoSnapshot(root, snapshot, scheduleDocumentSave, scheduleIndentGuideUpdate, onSelectionFontSizeChange);
  return true;
}

type RichTextMentionDraft = ActiveMentionDraft & {
  left: number;
  top: number;
};

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

function readRichTextMentionDraft(root: HTMLElement): RichTextMentionDraft | null {
  const range = getEditorSelectionRange(root);
  if (!range || !range.collapsed || closestMentionElement(root, range.startContainer)) return null;
  const beforeRange = range.cloneRange();
  beforeRange.selectNodeContents(root);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const beforeCaret = beforeRange.toString();
  const draft = readActiveMentionDraft(beforeCaret, beforeCaret.length);
  if (!draft) return null;

  const rect = getCaretRect(root, range);
  const view = root.ownerDocument.defaultView;
  const viewportWidth = view?.innerWidth ?? 1280;
  const viewportHeight = view?.innerHeight ?? 720;
  return {
    ...draft,
    left: Math.max(8, Math.min(rect.left, viewportWidth - 348)),
    top: Math.max(8, Math.min(rect.bottom + 6, viewportHeight - 258)),
  };
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
  const mentionElement = createEditorMentionElement(root.ownerDocument, user);
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

function avatarBackgroundForMentionName(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) % 360;
  return `hsl(${hash}, 68%, 42%)`;
}

function isEditorUndoShortcut(event: React.KeyboardEvent<HTMLDivElement>): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z" && !event.shiftKey;
}

function isEditorRedoShortcut(event: React.KeyboardEvent<HTMLDivElement>): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  const key = event.key.toLowerCase();
  return (key === "z" && event.shiftKey) || key === "y";
}

function copyEditorImageToSystemClipboard(data: EditorImageData, html: string) {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clipboard?.write || typeof ClipboardItem === "undefined") return;
  const imageBlob = createEditorImageBlob(data.src);
  if (!imageBlob) return;
  void clipboard.write([
    new ClipboardItem({
      [imageBlob.type]: imageBlob,
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob(["Image"], { type: "text/plain" }),
    }),
  ]).catch(() => undefined);
}

function copySelectedEditorImage(root: HTMLElement, clipboardData: DataTransfer): boolean {
  const frame = getSelectedEditorImageFrame(root);
  if (!frame) return false;
  const data = readEditorImageData(frame);
  if (!data) return false;
  const html = createEditorImageClipboardHTML(root.ownerDocument, data);
  clipboardData.setData("text/html", html);
  clipboardData.setData("text/plain", "Image");
  copyEditorImageToSystemClipboard(data, html);
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

function syncSelectionFontSize(root: HTMLElement, onSelectionFontSizeChange: (fontSize: number) => void) {
  const range = getEditorSelectionRange(root);
  if (!range) return;
  const view = root.ownerDocument.defaultView;
  if (!view) return;
  const element = getRangeFontSizeElement(root, range);
  const parsed = Number.parseFloat(view.getComputedStyle(element).fontSize);
  if (Number.isFinite(parsed)) onSelectionFontSizeChange(clampEditorFontSize(parsed));
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

function updateEditorImageCursor(root: HTMLElement, target: EventTarget | null, clientX: number, clientY: number) {
  const frame = findEditorImageFrame(root, target);
  if (!frame) return;
  const frameRect = frame.getBoundingClientRect();
  const interaction = getEditorImagePointerInteraction(
    frameRect.width,
    frameRect.height,
    clientX - frameRect.left,
    clientY - frameRect.top,
  );
  frame.style.cursor = getEditorImageCursorForInteraction(interaction);
}

function removeSelectedEditorImage(root: HTMLElement): boolean {
  const frame = getSelectedEditorImageFrame(root);
  if (!frame) return false;
  frame.remove();
  return true;
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

  const onPointerMove = (event: PointerEvent) => {
    event.preventDefault();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
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

export function useEditorDocumentSurfaceHandlers({
  restoringScrollRef,
  currentDocumentTargetKeyRef,
  scrollMemoryRef,
  documentUndoHistoryRef,
  pendingEditorFontSizeRef,
  outlineStyle,
  setDocumentScrollTop,
  scheduleDocumentSave,
  scheduleIndentGuideUpdate,
  rememberCurrentDocumentScroll,
  flushPendingDocumentSave,
  onSelectionFontSizeChange,
  mentionUsers = [],
  mentionAccent = "#ff8820",
  mentionSurfaceText = "#24120a",
  mentionStrokeColor = "rgba(36,18,10,0.18)",
}: UseEditorDocumentSurfaceHandlersOptions): EditorDocumentSurfaceHandlerResult {
  const pendingNativeUndoSnapshotRef = useRef<EditorDocumentUndoSnapshot | null>(null);
  const activeMentionRootRef = useRef<HTMLElement | null>(null);
  const [activeMentionDraft, setActiveMentionDraft] = useState<RichTextMentionDraft | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const mentionOptions = useMemo(() => (
    activeMentionDraft ? buildMentionOptions(mentionUsers, activeMentionDraft.query, 8) : []
  ), [activeMentionDraft?.query, mentionUsers]);
  const mentionMenuOpen = activeMentionDraft !== null && mentionOptions.length > 0;

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [activeMentionDraft?.start, activeMentionDraft?.query]);

  useEffect(() => {
    setActiveMentionIndex((current) => Math.min(current, Math.max(0, mentionOptions.length - 1)));
  }, [mentionOptions.length]);

  const refreshMentionDraft = useCallback((root: HTMLElement) => {
    if (mentionUsers.length === 0) {
      activeMentionRootRef.current = null;
      setActiveMentionDraft(null);
      return;
    }
    const draft = readRichTextMentionDraft(root);
    activeMentionRootRef.current = draft ? root : null;
    setActiveMentionDraft(draft);
  }, [mentionUsers.length]);

  const insertMention = useCallback((root: HTMLElement, mention: ActiveMentionDraft, user: MentionableCompanyUser) => {
    replaceEditorMentionDraft(root, mention, user, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
    activeMentionRootRef.current = null;
    setActiveMentionDraft(null);
  }, [documentUndoHistoryRef, scheduleDocumentSave, scheduleIndentGuideUpdate]);

  const mentionMenu = mentionMenuOpen && activeMentionDraft
    ? React.createElement(
      "div",
      {
        role: "listbox",
        "aria-label": "Mention users",
        style: {
        position: "fixed",
        left: activeMentionDraft.left,
        top: activeMentionDraft.top,
        zIndex: 2000,
        width: 320,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: 242,
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
              background: selected ? "rgba(255, 136, 32, 0.16)" : "transparent",
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
              style: { width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", background: avatarBackgroundForMentionName(name), color: "#ffffff", fontSize: 10, fontWeight: 900 } satisfies React.CSSProperties,
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

  const handlers = useMemo<EditorDocumentSurfaceHandlers>(() => ({
    onBeforeInput(event) {
      const root = event.currentTarget;
      const inputEvent = event.nativeEvent as InputEvent;
      const pendingFontSize = pendingEditorFontSizeRef.current;

      if (inputEvent.inputType === "historyUndo" || inputEvent.inputType === "historyRedo") {
        event.preventDefault();
        pendingNativeUndoSnapshotRef.current = null;
        applyEditorUndoCommand(
          root,
          documentUndoHistoryRef.current,
          inputEvent.inputType === "historyUndo" ? "undo" : "redo",
          scheduleDocumentSave,
          scheduleIndentGuideUpdate,
          onSelectionFontSizeChange,
        );
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
        if (pendingFontSize !== null) {
          event.preventDefault();
          const undoBefore = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
          if (replaceSelectionWithStyledText(root, inputEvent.data, pendingFontSize)) {
            onSelectionFontSizeChange(pendingFontSize);
            recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "typing");
            commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
          }
          return;
        }

        if (outlineStyle === "automatic-outline-numbering") {
          const offsets = getEditorSelectionOffsets(root);
          const currentText = offsets ? readEditorDocumentText(root) : "";
          const edit = offsets
            ? insertAutomaticOutlineFirstText(currentText, offsets.start, offsets.end, inputEvent.data)
            : null;
          if (edit) {
            event.preventDefault();
            pendingEditorFontSizeRef.current = null;
            const undoBefore = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
            replaceDocumentWithPlainText(root, edit.value, edit.selectionStart, edit.selectionEnd);
            recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "typing");
            commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
            return;
          }
        }

        const anchor = getCollapsedAnchorAtSelectionEnd(root);
        if (anchor) {
          event.preventDefault();
          pendingEditorFontSizeRef.current = null;
          const undoBefore = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
          const inserted = isHyperlinkDividerText(inputEvent.data)
            ? insertPlainTextAfterAnchor(root, anchor, inputEvent.data)
            : appendTextToAnchorEnd(root, anchor, inputEvent.data);
          if (inserted) {
            recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "typing");
            commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
          }
          return;
        }
      }

      if (inputEvent.inputType && inputEvent.inputType !== "insertCompositionText") {
        pendingNativeUndoSnapshotRef.current = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
      }
    },
    onPaste(event) {
      const root = event.currentTarget;
      const undoBefore = snapshotEditorDocumentRoot(root);
      const imageFile = getImageFileFromDataTransfer(event.clipboardData);
      if (imageFile) {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        const savedRange = getEditorSelectionRange(root)?.cloneRange() ?? null;
        void insertEditorImageFile(root, imageFile, savedRange, undoBefore, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
        return;
      }

      const html = event.clipboardData.getData("text/html");
      const clipboardImageData = readEditorImageClipboardDataFromHTML(root.ownerDocument, html);
      if (clipboardImageData) {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        const savedRange = getEditorSelectionRange(root)?.cloneRange() ?? null;
        void insertEditorClipboardImageData(root, clipboardImageData, savedRange, undoBefore, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
        return;
      }

      const text = event.clipboardData.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      pendingEditorFontSizeRef.current = null;
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
      if (!copySelectedEditorImage(event.currentTarget, event.clipboardData)) return;
      event.preventDefault();
    },
    onDrop(event) {
      const root = event.currentTarget;
      const undoBefore = snapshotEditorDocumentRoot(root);
      const imageFile = getImageFileFromDataTransfer(event.dataTransfer);
      if (imageFile) {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        root.focus({ preventScroll: true });
        const savedRange = getEditorSelectionRange(root)?.cloneRange() ?? null;
        void insertEditorImageFile(root, imageFile, savedRange, undoBefore, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
        return;
      }

      const html = event.dataTransfer.getData("text/html");
      const clipboardImageData = readEditorImageClipboardDataFromHTML(root.ownerDocument, html);
      if (clipboardImageData) {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        root.focus({ preventScroll: true });
        const savedRange = getEditorSelectionRange(root)?.cloneRange() ?? null;
        void insertEditorClipboardImageData(root, clipboardImageData, savedRange, undoBefore, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
        return;
      }

      const text = event.dataTransfer.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      pendingEditorFontSizeRef.current = null;
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
      const undoBefore = pendingNativeUndoSnapshotRef.current;
      pendingNativeUndoSnapshotRef.current = null;
      recordEditorDocumentMutation(documentUndoHistoryRef.current, event.currentTarget, undoBefore, "typing");
      commitEditorDocument(event.currentTarget, scheduleDocumentSave, scheduleIndentGuideUpdate);
      syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange);
      refreshMentionDraft(event.currentTarget);
    },
    onSelect(event) {
      const range = getEditorSelectionRange(event.currentTarget);
      if (range && !range.collapsed) {
        setActiveMentionDraft(null);
        pendingEditorFontSizeRef.current = null;
        syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange);
        return;
      }
      if (pendingEditorFontSizeRef.current !== null) {
        onSelectionFontSizeChange(pendingEditorFontSizeRef.current);
        return;
      }
      syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange);
    },
    onClick(event) {
      if (!findEditorImageFrame(event.currentTarget, event.target)) {
        clearEditorImageSelection(event.currentTarget);
      }
      pendingEditorFontSizeRef.current = null;
      syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange);
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) {
        refreshMentionDraft(event.currentTarget);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) window.open(anchor.href, "_blank", "noopener,noreferrer");
    },
    onPointerDown(event) {
      const frame = findEditorImageFrame(event.currentTarget, event.target);
      if (!frame) return;
      event.preventDefault();
      event.stopPropagation();
      pendingEditorFontSizeRef.current = null;
      event.currentTarget.focus({ preventScroll: true });
      selectEditorImageFrame(event.currentTarget, frame);
      if (event.button === 0) {
        startEditorImagePointerInteraction(event.currentTarget, frame, event, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
      }
    },
    onPointerMove(event) {
      updateEditorImageCursor(event.currentTarget, event.target, event.clientX, event.clientY);
    },
    onKeyUp(event) {
      if (pendingEditorFontSizeRef.current !== null) {
        onSelectionFontSizeChange(pendingEditorFontSizeRef.current);
        return;
      }
      syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange);
      refreshMentionDraft(event.currentTarget);
    },
    onBlur(event) {
      setActiveMentionDraft(null);
      activeMentionRootRef.current = null;
      pendingEditorFontSizeRef.current = null;
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(serializeEditorDocumentHTML(event.currentTarget));
    },
    onScroll(event) {
      setActiveMentionDraft(null);
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
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        pendingNativeUndoSnapshotRef.current = null;
        applyEditorUndoCommand(
          root,
          documentUndoHistoryRef.current,
          isEditorUndoShortcut(event) ? "undo" : "redo",
          scheduleDocumentSave,
          scheduleIndentGuideUpdate,
          onSelectionFontSizeChange,
        );
        return;
      }

      const mentionKeyboardEdit = event.key === "Backspace"
        ? { kind: "deleteBackward" as const }
        : event.key === "Delete" ? { kind: "deleteForward" as const } : isPlainTextKeyboardEdit(event) ? { kind: "insertText" as const, text: event.key } : null;
      if (mentionKeyboardEdit && applyMentionBreakingKeyboardEdit(
        root,
        mentionKeyboardEdit,
        documentUndoHistoryRef.current,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
      )) {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        pendingNativeUndoSnapshotRef.current = null;
        clearEditorImageSelection(root);
        activeMentionRootRef.current = null;
        setActiveMentionDraft(null);
        syncSelectionFontSize(root, onSelectionFontSizeChange);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        clearEditorImageSelection(root);
        root.blur();
        return;
      }

      if (PENDING_FONT_SIZE_CANCEL_KEYS.has(event.key)) pendingEditorFontSizeRef.current = null;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
        const undoBefore = snapshotEditorDocumentRoot(root);
        if (removeSelectedEditorImage(root)) {
          event.preventDefault();
          pendingEditorFontSizeRef.current = null;
          recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "image");
          commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
          return;
        }
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

      if (event.key === "Enter") {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
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
        const edit = insertEditorEnterText(currentText, offsets.start, offsets.end, outlineStyle);
        const insertedText = edit.value.slice(offsets.start, edit.selectionStart);
        const anchor = getCollapsedAnchorAtSelectionEnd(root);
        const inserted = anchor
          ? insertPlainTextAfterAnchor(root, anchor, insertedText, { preserveTrailingNewline: edit.value.endsWith("\n") })
          : replaceSelectionWithText(root, insertedText, { preserveTrailingNewline: edit.value.endsWith("\n") });
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
        const edit = deleteEditorBackspaceText(currentText, offsets.start, offsets.end);
        if (!edit) return;
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        clearEditorImageSelection(root);
        if (deleteTextByOffsets(root, edit.selectionStart, offsets.start, { preserveTrailingNewline: edit.value.endsWith("\n") })) {
          recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "delete");
          commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
        }
        return;
      }

      if (event.key !== "Tab") return;
      event.preventDefault();
      pendingEditorFontSizeRef.current = null;
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
        replaceDocumentWithPlainText(root, edit.value, edit.selectionStart, edit.selectionEnd);
      }
      recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "tab");
      commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
    },
  }), [
    activeMentionDraft,
    activeMentionIndex,
    currentDocumentTargetKeyRef,
    documentUndoHistoryRef,
    flushPendingDocumentSave,
    insertMention,
    mentionMenuOpen,
    mentionOptions,
    onSelectionFontSizeChange,
    outlineStyle,
    pendingEditorFontSizeRef,
    rememberCurrentDocumentScroll,
    refreshMentionDraft,
    restoringScrollRef,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
    scrollMemoryRef,
    setDocumentScrollTop,
  ]);
  return { ...handlers, mentionMenu };
}
