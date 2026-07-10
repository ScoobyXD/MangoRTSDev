import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fileFromDataURL,
  loadMangoAttachmentObjectURL,
  uploadMangoAttachment,
  type AttachmentRequestJSON,
  type MangoAttachmentResourceType,
} from "../attachments/attachmentApi";
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
  EDITOR_LINK_COLOR,
  EDITOR_TABLE_ATTRIBUTE,
  EDITOR_TABLE_ALIGNMENT_ACTION_ATTRIBUTE,
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
  linkifyEditorPlainTextToHTML,
  readEditorTableColumnWidths,
  readEditorTableOffsetPercent,
  readEditorTableTextAlign,
  readEditorTableWidthPercent,
  readEditorListKind,
  readEditorDocumentText,
  sanitizeEditorDocumentHTML,
  serializeEditorDocumentHTML,
  type EditorListKind,
  type EditorTableTextAlign,
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
  getSelectedEditorImageFrame,
  selectEditorImageFrame,
  shouldUseEditorImageFileTransferShortcut,
  writeImageClipboardData,
  writeImageToSystemClipboard,
  type EditorImageTransferHTMLKind,
  type EditorImageClipboardData,
  type EditorImageData,
} from "./editorImages";

export type EditorDocumentSurfaceHandlers = Pick<
  EditorDocumentSurfaceProps,
  | "onBeforeInput"
  | "onPaste"
  | "onCopy"
  | "onCut"
  | "onDrop"
  | "onInput"
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
  onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void;
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
  onError?: (message: string) => void;
};

export type EditorInlineStyleCommand = "bold" | "underline";

export type EditorSelectionInlineFormatState = {
  bold: boolean;
  underline: boolean;
};

export type EditorSelectionFormatState = EditorSelectionInlineFormatState & {
  fontSize: number;
};

export type EditorDocumentFormattingController = {
  applyFontSizeValue: (fontSize: number) => boolean;
  adjustFontSize: (delta: number) => boolean;
  toggleInlineFormat: (command: EditorInlineStyleCommand) => boolean;
  toggleNumberedList: () => boolean;
  indent: () => boolean;
  outdent: () => boolean;
  insertTable: () => boolean;
  readFormatState: () => EditorSelectionFormatState | null;
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

function getEditorTableAlignmentAction(root: HTMLElement, node: Node | EventTarget | null): { table: HTMLTableElement; align: EditorTableTextAlign } | null {
  const element = node instanceof Element
    ? node
    : node instanceof Node ? node.parentElement : null;
  const action = element?.closest?.(`[${EDITOR_TABLE_ALIGNMENT_ACTION_ATTRIBUTE}]`) ?? null;
  if (!(action instanceof HTMLElement)) return null;
  const rawAlign = action.getAttribute(EDITOR_TABLE_ALIGNMENT_ACTION_ATTRIBUTE);
  const align = rawAlign === "left" || rawAlign === "center" || rawAlign === "right" ? rawAlign : null;
  const table = align ? getClosestEditorTable(root, action) : null;
  return align && table ? { table, align } : null;
}

function applyEditorTableAlignmentAction(
  root: HTMLElement,
  table: HTMLTableElement,
  align: EditorTableTextAlign,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
): boolean {
  const undoBefore = snapshotEditorDocumentRoot(root);
  normalizeEditorTable(table);
  applyEditorTableTextAlign(table, align);
  const cornerCell = getEditorTableCellAt(table, 0, 0);
  if (cornerCell) setSelectionInEditorTableCell(root, cornerCell);
  recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
  return true;
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

function moveEditorTableSelection(
  root: HTMLElement,
  direction: -1 | 1,
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
  const cells = getEditorTableRows(table).flatMap(getEditorTableCells);
  const currentIndex = cells.indexOf(activeCell);
  if (currentIndex < 0) return false;
  const nextIndex = currentIndex + direction;
  if (nextIndex >= 0 && nextIndex < cells.length) {
    setSelectionInEditorTableCell(root, cells[nextIndex]);
    return true;
  }
  if (direction < 0) {
    setSelectionInEditorTableCell(root, cells[0]);
    return true;
  }

  const undoBefore = snapshotEditorDocumentRoot(root);
  const columns = getEditorTableColumnCount(table);
  if (getEditorTableRows(table).length >= EDITOR_TABLE_MAX_ROWS) {
    setSelectionInEditorTableCell(root, cells[cells.length - 1]);
    return true;
  }
  const newRow = createEmptyEditorTableRow(root.ownerDocument, getEditorTableRows(table).length, columns);
  const body = table.tBodies[0] ?? table.createTBody();
  body.appendChild(newRow);
  updateEditorTableColumnAttribute(table);
  const firstCell = getEditorTableCells(newRow)[0];
  if (firstCell) setSelectionInEditorTableCell(root, firstCell);
  recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
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

function editorImageAttachmentContextReady(context: EditorImageAttachmentContext | undefined): context is EditorImageAttachmentContext {
  return Boolean(
    context?.requestJSON &&
    context.apiBase.trim() &&
    context.companyID.trim() &&
    context.resourceType &&
    context.resourceID.trim(),
  );
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
): Promise<EditorImageData> {
  if (!editorImageAttachmentContextReady(context)) throw new Error("editor_image_attachment_context_unavailable");
  const uploaded = await uploadMangoAttachment(context.requestJSON, {
    companyID: context.companyID,
    resourceType: context.resourceType,
    resourceID: context.resourceID,
    file,
    sourceKind: "editor_paste",
    relationshipKind: "inline_image",
    informationID: context.informationID,
    editorSurface: context.editorSurface,
  });
  const attachment = uploaded.attachment;
  let displaySrc = imageData.src;
  try {
    displaySrc = await loadMangoAttachmentObjectURL(context.apiBase, context.companyID, attachment.attachment_id, "display");
  } catch {
    displaySrc = imageData.src;
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
  undoBefore: EditorDocumentUndoSnapshot | null,
  documentUndoHistory: EditorDocumentUndoHistory,
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
  editorImageAttachmentContext: EditorImageAttachmentContext | undefined,
) {
  const maxDisplayWidth = Math.max(120, Math.min(720, root.clientWidth - 56));
  const imageData = await attachUploadedEditorImageData(
    await createEditorImageDataFromFile(file, maxDisplayWidth, getEditorImageStorageBudget(root)),
    file,
    editorImageAttachmentContext,
  );
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
  editorImageAttachmentContext: EditorImageAttachmentContext | undefined,
) {
  const maxDisplayWidth = Math.max(120, Math.min(720, root.clientWidth - 56));
  if (clipboardData.attachmentID) {
    insertPreparedEditorImage(root, {
      src: clipboardData.src,
      attachmentID: clipboardData.attachmentID,
      filename: clipboardData.filename,
      mimeType: clipboardData.mimeType,
      byteSize: clipboardData.byteSize,
      width: clipboardData.width ?? 220,
      height: clipboardData.height ?? 160,
      marginLeft: clipboardData.marginLeft,
      marginTop: clipboardData.marginTop,
      floatSide: clipboardData.floatSide,
    }, savedRange, undoBefore, documentUndoHistory, scheduleDocumentSave, scheduleIndentGuideUpdate);
    return;
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
  const uploadedImageData = await attachUploadedEditorImageData(imageData, file, editorImageAttachmentContext);
  insertPreparedEditorImage(root, uploadedImageData, savedRange, undoBefore, documentUndoHistory, scheduleDocumentSave, scheduleIndentGuideUpdate);
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

function stripNestedEditorFontSizes(node: Node) {
  if (node instanceof HTMLElement && node.tagName.toLowerCase() === "span") node.style.fontSize = "";
  node.childNodes.forEach(stripNestedEditorFontSizes);
}

export function applyEditorSelectionFontSizeToRoot(
  root: HTMLElement,
  nextFontSizeInput: number,
  options: {
    documentUndoHistory: EditorDocumentUndoHistory;
    pendingEditorFontSizeRef: React.MutableRefObject<number | null>;
    scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
    scheduleIndentGuideUpdate: (text: string) => void;
    onSelectionFontSizeChange?: (fontSize: number) => void;
  },
): boolean {
  const nextFontSize = clampEditorFontSize(nextFontSizeInput);
  root.focus({ preventScroll: true });
  const range = getEditorSelectionRange(root);
  options.onSelectionFontSizeChange?.(nextFontSize);
  if (!range || range.collapsed) {
    options.pendingEditorFontSizeRef.current = nextFontSize;
    return true;
  }

  const undoBefore = snapshotEditorDocumentRoot(root);
  const fragment = range.extractContents();
  fragment.childNodes.forEach(stripNestedEditorFontSizes);
  const span = root.ownerDocument.createElement("span");
  span.style.fontSize = `${nextFontSize}px`;
  span.appendChild(fragment);
  range.insertNode(span);
  selectElementContents(span);
  options.pendingEditorFontSizeRef.current = null;
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

const EDITOR_LIST_ITEM_SELECTOR = `li[${EDITOR_LIST_ITEM_ATTRIBUTE}]`;

function editorListKindForOutlineStyle(outlineStyle: EditorOutlineStyleID): EditorListKind | null {
  if (outlineStyle === "bullet-list") return "bullet";
  if (outlineStyle === "checklist") return "checklist";
  return null;
}

function getEditorListKindForList(list: Element | null): EditorListKind | null {
  return list instanceof HTMLUListElement ? readEditorListKind(list.getAttribute(EDITOR_LIST_ATTRIBUTE)) : null;
}

function getEditorListForItem(item: HTMLLIElement): HTMLUListElement | null {
  const list = item.parentElement;
  return getEditorListKindForList(list) ? list as HTMLUListElement : null;
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
        if (current instanceof HTMLUListElement && readEditorListKind(current.getAttribute(EDITOR_LIST_ATTRIBUTE))) {
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
  ].join(","));
}

function directNestedEditorList(item: HTMLLIElement): HTMLUListElement | null {
  return Array.from(item.children).find((child): child is HTMLUListElement => (
    child instanceof HTMLUListElement && readEditorListKind(child.getAttribute(EDITOR_LIST_ATTRIBUTE)) !== null
  )) ?? null;
}

function removeEditorListItemPlaceholders(item: HTMLLIElement) {
  Array.from(item.childNodes).forEach((child) => {
    if (child instanceof HTMLBRElement) child.remove();
    if (child.nodeType === Node.TEXT_NODE && !(child.textContent ?? "").length) child.remove();
  });
}

function editorListItemHasOwnEditableContent(item: HTMLLIElement): boolean {
  return Array.from(item.childNodes).some((child) => {
    if (child instanceof HTMLUListElement && readEditorListKind(child.getAttribute(EDITOR_LIST_ATTRIBUTE))) return false;
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
  const kind = getEditorListKindForItem(item);
  if (!kind) return false;
  const nextItem = createEditorListItem(root.ownerDocument, kind);
  const range = getEditorSelectionRange(root);
  if (range && (item === range.startContainer || item.contains(range.startContainer))) {
    const splitRange = root.ownerDocument.createRange();
    try {
      if (!range.collapsed) range.deleteContents();
      splitRange.setStart(range.startContainer, range.startOffset);
      splitRange.setEnd(item, item.childNodes.length);
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

  const trailingList = item.nextSibling ? list.cloneNode(false) as HTMLUListElement : null;
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
  const kind = getEditorListKindForItem(item);
  if (!kind) return false;
  const previousItem = item.previousElementSibling;
  if (!(previousItem instanceof HTMLLIElement)) return false;
  let nestedList = Array.from(previousItem.children).find((child): child is HTMLUListElement => (
    child instanceof HTMLUListElement && readEditorListKind(child.getAttribute(EDITOR_LIST_ATTRIBUTE)) === kind
  )) ?? null;
  if (!nestedList) {
    nestedList = root.ownerDocument.createElement("ul");
    nestedList.setAttribute(EDITOR_LIST_ATTRIBUTE, kind);
    previousItem.appendChild(nestedList);
  }
  nestedList.appendChild(item);
  selectEditorListItem(root, item, "end");
  return true;
}

function outdentEditorListItem(root: HTMLElement, item: HTMLLIElement): boolean {
  const list = getEditorListForItem(item);
  if (!list) return false;
  const parentItem = list.parentElement instanceof HTMLLIElement ? list.parentElement : null;
  if (parentItem) {
    parentItem.after(item);
    if (list.children.length === 0) list.remove();
    selectEditorListItem(root, item, "end");
    return true;
  }

  const trailingList = item.nextSibling ? list.cloneNode(false) as HTMLUListElement : null;
  while (trailingList && item.nextSibling) trailingList.appendChild(item.nextSibling);
  const ownTextNodes = editorListItemOwnTextNodes(item);
  const preferredTextNode = ownTextNodes[ownTextNodes.length - 1] ?? null;
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
  if (preferredTextNode && plainBlock.contains(preferredTextNode)) {
    setCollapsedSelectionInTextNode(root, preferredTextNode, preferredTextNode.data.length);
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
) {
  root.innerHTML = deserializeEditorDocumentHTML(snapshot.html);
  setEditorSelectionByOffsets(root, snapshot.selectionStart, snapshot.selectionEnd);
  clearEditorImageSelection(root);
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
  syncSelectionFontSize(root, onSelectionFontSizeChange, onSelectionInlineFormatChange);
}

function applyEditorUndoCommand(
  root: HTMLElement,
  history: EditorDocumentUndoHistory,
  direction: "undo" | "redo",
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void,
  scheduleIndentGuideUpdate: (text: string) => void,
  onSelectionFontSizeChange: (fontSize: number) => void,
  onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void,
): boolean {
  const currentHTML = serializeEditorDocumentHTML(root);
  const snapshot = direction === "undo"
    ? undoEditorDocument(history, currentHTML)
    : redoEditorDocument(history, currentHTML);
  if (!snapshot) return false;
  restoreEditorDocumentUndoSnapshot(root, snapshot, scheduleDocumentSave, scheduleIndentGuideUpdate, onSelectionFontSizeChange, onSelectionInlineFormatChange);
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

function copySelectedEditorImage(root: HTMLElement, clipboardData: DataTransfer): boolean {
  const frame = getSelectedEditorImageFrame(root);
  if (!frame) return false;
  const data = readEditorImageData(frame);
  if (!data) return false;
  const html = createEditorImageClipboardHTML(root.ownerDocument, data);
  if (!writeImageClipboardData(clipboardData, data.src, html)) return false;
  writeImageToSystemClipboard(data.src, html);
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

function tagNameIndicatesInlineFormat(element: Element, command: EditorInlineStyleCommand): boolean {
  const tagName = element.tagName.toLowerCase();
  return command === "bold"
    ? tagName === "b" || tagName === "strong"
    : tagName === "u";
}

function computedStyleIndicatesInlineFormat(element: Element, command: EditorInlineStyleCommand): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(element);
  if (command === "bold") {
    const weight = Number.parseInt(style.fontWeight, 10);
    return Number.isFinite(weight) ? weight >= 600 : style.fontWeight === "bold" || style.fontWeight === "bolder";
  }
  return style.textDecorationLine.split(/\s+/).includes("underline")
    || style.textDecoration.includes("underline");
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
    return root.ownerDocument.queryCommandState(command);
  } catch {
    return null;
  }
}

export function readEditorSelectionFormatState(root: HTMLElement, fallbackFontSize = EDITOR_DOCUMENT_FONT_SIZE_PX): EditorSelectionFormatState | null {
  const range = getEditorSelectionRange(root);
  if (!range) return null;
  const view = root.ownerDocument.defaultView;
  if (!view) return null;
  const element = getRangeFontSizeElement(root, range);
  const parsed = Number.parseFloat(view.getComputedStyle(element).fontSize);
  const boldCommandState = readDocumentCommandState(root, "bold");
  const underlineCommandState = readDocumentCommandState(root, "underline");
  return {
    fontSize: Number.isFinite(parsed) ? clampEditorFontSize(parsed) : clampEditorFontSize(fallbackFontSize),
    bold: boldCommandState ?? readElementInlineFormat(root, element, "bold"),
    underline: underlineCommandState ?? readElementInlineFormat(root, element, "underline"),
  };
}

function syncSelectionFontSize(
  root: HTMLElement,
  onSelectionFontSizeChange: (fontSize: number) => void,
  onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void,
) {
  const state = readEditorSelectionFormatState(root);
  if (!state) return;
  onSelectionFontSizeChange(state.fontSize);
  onSelectionInlineFormatChange?.({ bold: state.bold, underline: state.underline });
}

export function applyEditorInlineFormatToRoot(
  root: HTMLElement,
  command: EditorInlineStyleCommand,
  options: {
    documentUndoHistory: EditorDocumentUndoHistory;
    scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
    scheduleIndentGuideUpdate: (text: string) => void;
    onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void;
  },
): boolean {
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  root.focus({ preventScroll: true });
  const undoBefore = snapshotEditorDocumentRoot(root);
  let applied = false;
  try {
    applied = root.ownerDocument.execCommand(command, false);
  } catch {
    applied = false;
  }
  if (!applied) return false;
  recordEditorDocumentMutation(options.documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, options.scheduleDocumentSave, options.scheduleIndentGuideUpdate);
  const nextState = readEditorSelectionFormatState(root);
  if (nextState) options.onSelectionInlineFormatChange?.({ bold: nextState.bold, underline: nextState.underline });
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
  onSelectionInlineFormatChange,
  mentionUsers = [],
  mentionAccent = "#334155",
  mentionSurfaceText = "#111827",
  mentionStrokeColor = "rgba(15,23,42,0.18)",
  mentionMenuPosition = "fixed",
  editorImageAttachmentContext,
  onEditorImageAttachmentError,
}: UseEditorDocumentSurfaceHandlersOptions): EditorDocumentSurfaceHandlerResult {
  const pendingNativeUndoSnapshotRef = useRef<EditorDocumentUndoSnapshot | null>(null);
  const activeMentionRootRef = useRef<HTMLElement | null>(null);
  const lastEditorSelectionRangeRef = useRef<Range | null>(null);
  const [activeMentionDraft, setActiveMentionDraft] = useState<RichTextMentionDraft | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [activeTableContextMenu, setActiveTableContextMenu] = useState<RichTextTableContextMenu | null>(null);
  const [activeImagePreview, setActiveImagePreview] = useState<EditorImagePreviewDraft | null>(null);
  const [activeImagePreviewSize, setActiveImagePreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [activeImagePreviewViewport, setActiveImagePreviewViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
  }));
  const mentionOptions = useMemo(() => (
    activeMentionDraft ? buildMentionOptions(mentionUsers, activeMentionDraft.query, 8) : []
  ), [activeMentionDraft?.query, mentionUsers]);
  const mentionMenuOpen = activeMentionDraft !== null && mentionOptions.length > 0;

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
      if (event.key === "Escape") setActiveTableContextMenu(null);
    };
    ownerDocument.addEventListener("pointerdown", onPointerDown);
    ownerDocument.addEventListener("keydown", onKeyDown);
    return () => {
      ownerDocument.removeEventListener("pointerdown", onPointerDown);
      ownerDocument.removeEventListener("keydown", onKeyDown);
    };
  }, [activeTableContextMenu?.root]);

  useEffect(() => {
    setActiveImagePreviewSize(null);
    if (!activeImagePreview || typeof window === "undefined") return undefined;
    const updateViewport = () => {
      setActiveImagePreviewViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, [activeImagePreview?.src]);

  const imagePreviewImageSize = useMemo(() => {
    if (!activeImagePreviewSize) return null;
    const maxUpscale = 1.4;
    const modalPadding = 12;
    const headerHeight = 49;
    const maxWidth = Math.max(1, activeImagePreviewViewport.width - (modalPadding * 2));
    const maxHeight = Math.max(1, activeImagePreviewViewport.height - (modalPadding * 2) - headerHeight);
    const scale = Math.min(
      maxWidth / activeImagePreviewSize.width,
      maxHeight / activeImagePreviewSize.height,
      maxUpscale,
    );
    if (!Number.isFinite(scale) || scale <= 0) return null;
    return {
      width: Math.max(1, Math.round(activeImagePreviewSize.width * scale)),
      height: Math.max(1, Math.round(activeImagePreviewSize.height * scale)),
    };
  }, [activeImagePreviewSize, activeImagePreviewViewport.height, activeImagePreviewViewport.width]);

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

  const insertMention = useCallback((root: HTMLElement, mention: ActiveMentionDraft, user: MentionableCompanyUser) => {
    replaceEditorMentionDraft(root, mention, user, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
    activeMentionRootRef.current = null;
    setActiveMentionDraft(null);
  }, [documentUndoHistoryRef, scheduleDocumentSave, scheduleIndentGuideUpdate]);

  const openTableContextMenu = useCallback((root: HTMLElement, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    root.focus({ preventScroll: true });
    pendingEditorFontSizeRef.current = null;
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
  }, [mentionMenuPosition, pendingEditorFontSizeRef]);

  const runTableContextCommand = useCallback((command: EditorTableCommand) => {
    const root = activeTableContextMenu?.root;
    if (!root || activeTableContextMenu.mode !== "table") return;
    setActiveTableContextMenu(null);
    const applied = applyEditorTableCommand(root, command, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
    if (applied) clearEditorTableCellSelections(root);
  }, [activeTableContextMenu, documentUndoHistoryRef, scheduleDocumentSave, scheduleIndentGuideUpdate]);

  const insertTableFromContextMenu = useCallback(() => {
    const root = activeTableContextMenu?.root;
    if (!root) return;
    setActiveTableContextMenu(null);
    root.focus({ preventScroll: true });
    pendingEditorFontSizeRef.current = null;
    clearEditorImageSelection(root);
    activeMentionRootRef.current = null;
    setActiveMentionDraft(null);
    insertEditorTable(root, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
  }, [activeTableContextMenu?.root, documentUndoHistoryRef, pendingEditorFontSizeRef, scheduleDocumentSave, scheduleIndentGuideUpdate]);

  useEffect(() => {
    if (!activeImagePreview) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveImagePreview(null);
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "c") return;
      if (writeImageToSystemClipboard(activeImagePreview.src, activeImagePreview.html)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeImagePreview]);

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
    ? React.createElement(
      "div",
      {
        role: "dialog",
        "aria-modal": true,
        "aria-label": activeImagePreview.label,
        "data-mango-copyable-image": "true",
        onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => {
          if (event.target === event.currentTarget) setActiveImagePreview(null);
        },
        style: {
          position: "fixed",
          inset: 0,
          zIndex: 2400,
          background: "rgba(15,23,42,0.98)",
          display: "grid",
          placeItems: "center",
          padding: 12,
        } satisfies React.CSSProperties,
      },
      React.createElement(
        "div",
        {
          style: {
            width: imagePreviewImageSize ? imagePreviewImageSize.width : "min(1800px, calc(100vw - 24px))",
            maxHeight: "calc(100vh - 24px)",
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr)",
            border: `1px solid ${mentionStrokeColor}`,
            borderRadius: 8,
            background: "#ffffff",
            color: mentionSurfaceText,
            boxShadow: "0 18px 48px rgba(0,0,0,0.26)",
            overflow: "hidden",
          } satisfies React.CSSProperties,
        },
        React.createElement(
          "div",
          {
            style: {
              minWidth: 0,
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 32px",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderBottom: `1px solid ${mentionStrokeColor}`,
            } satisfies React.CSSProperties,
          },
          React.createElement(
            "span",
            {
              style: {
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 12,
                fontWeight: 800,
              } satisfies React.CSSProperties,
            },
            activeImagePreview.label,
          ),
          React.createElement(
            "button",
            {
              type: "button",
              "aria-label": "Close image preview",
              onClick: () => setActiveImagePreview(null),
              style: {
                width: 32,
                height: 32,
                border: `1px solid ${mentionStrokeColor}`,
                borderRadius: 6,
                background: "#ffffff",
                color: mentionSurfaceText,
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
              } satisfies React.CSSProperties,
            },
            "x",
          ),
        ),
        React.createElement(
          "div",
          {
            style: {
              minHeight: 0,
              width: imagePreviewImageSize ? imagePreviewImageSize.width : "100%",
              height: imagePreviewImageSize ? imagePreviewImageSize.height : undefined,
              overflow: "hidden",
              display: "grid",
              placeItems: "center",
              background: "#111827",
              padding: 0,
            } satisfies React.CSSProperties,
          },
          React.createElement("img", {
            alt: activeImagePreview.label,
            src: activeImagePreview.src,
            onLoad: (event: React.SyntheticEvent<HTMLImageElement>) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) {
                setActiveImagePreviewSize({ width: naturalWidth, height: naturalHeight });
              }
            },
            style: {
              width: imagePreviewImageSize ? "100%" : "auto",
              height: imagePreviewImageSize ? "100%" : "auto",
              maxWidth: "calc(100vw - 24px)",
              maxHeight: "calc(100vh - 73px)",
              objectFit: "contain",
              display: "block",
            } satisfies React.CSSProperties,
          }),
        ),
      ),
    )
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

  const handlers = useMemo<EditorDocumentSurfaceHandlers>(() => ({
    onBeforeInput(event) {
      const root = event.currentTarget;
      rememberEditorSelectionRange(root);
      const inputEvent = event.nativeEvent as InputEvent;
      const pendingFontSize = pendingEditorFontSizeRef.current;

      if (inputEvent.inputType === "historyUndo" || inputEvent.inputType === "historyRedo") {
        pendingNativeUndoSnapshotRef.current = null;
        const applied = applyEditorUndoCommand(
          root,
          documentUndoHistoryRef.current,
          inputEvent.inputType === "historyUndo" ? "undo" : "redo",
          scheduleDocumentSave,
          scheduleIndentGuideUpdate,
          onSelectionFontSizeChange,
          onSelectionInlineFormatChange,
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

        const activeTableCell = getCurrentEditorTableCell(root);
        const tableEditorListKind = activeTableCell ? editorListKindForOutlineStyle(outlineStyle) : null;
        if (activeTableCell && tableEditorListKind) {
          const undoBefore = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
          if (startEditorTableCellListFromText(root, activeTableCell, tableEditorListKind, inputEvent.data)) {
            event.preventDefault();
            pendingEditorFontSizeRef.current = null;
            recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "typing");
            commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
            return;
          }
        }

        const activeEditorListItem = getCurrentEditorListItem(root);
        if (activeEditorListItem && editorListItemContentIsEmpty(activeEditorListItem)) {
          event.preventDefault();
          pendingEditorFontSizeRef.current = null;
          const undoBefore = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
          if (insertTextIntoEmptyEditorListItem(root, activeEditorListItem, inputEvent.data)) {
            recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "typing");
            commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
          }
          return;
        }

        if (outlineStyle === "automatic-outline-numbering") {
          const offsets = getEditorSelectionOffsets(root);
          if (offsets) {
            const currentText = readEditorDocumentText(root);
            const edit = insertAutomaticOutlineFirstText(currentText, offsets.start, offsets.end, inputEvent.data);
            if (edit) {
              event.preventDefault();
              pendingEditorFontSizeRef.current = null;
              const undoBefore = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
              const appliedLocalEdit = applyPlainTextEditToRichDocument(root, currentText, edit);
              if (!appliedLocalEdit) {
                if (documentHasEditorImages(root)) return;
                replaceDocumentWithPlainText(root, edit.value, edit.selectionStart, edit.selectionEnd);
              }
              recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "typing");
              commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
              return;
            }
          }
        }

        const editorListKind = editorListKindForOutlineStyle(outlineStyle);
        if (editorListKind) {
          const offsets = getEditorSelectionOffsets(root);
          if (offsets) {
            const currentText = readEditorDocumentText(root);
            const undoBefore = mentionUndoBefore ?? snapshotEditorDocumentRoot(root);
            if (startEditorListFromBlankLine(root, editorListKind, currentText, offsets.start, offsets.end, inputEvent.data)) {
              event.preventDefault();
              pendingEditorFontSizeRef.current = null;
              recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "typing");
              commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate);
              return;
            }
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
      rememberEditorSelectionRange(root);
      const undoBefore = snapshotEditorDocumentRoot(root);
      const html = event.clipboardData.getData("text/html");
      const text = event.clipboardData.getData("text/plain");
      const htmlKind = editorImageTransferHTMLKind(root.ownerDocument, html);
      const imageFile = getImageFileFromDataTransfer(event.clipboardData);
      if (imageFile && shouldUseEditorImageFileTransferShortcut(true, htmlKind, text)) {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        const savedRange = getEditorSelectionRange(root)?.cloneRange() ?? null;
        void insertEditorImageFile(root, imageFile, savedRange, undoBefore, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate, editorImageAttachmentContext)
          .catch((cause) => reportEditorImageAttachmentError(editorImageAttachmentContext, onEditorImageAttachmentError, cause));
        return;
      }

      const clipboardImageData = readEditorImageClipboardDataFromHTML(root.ownerDocument, html);
      if (clipboardImageData) {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        const savedRange = getEditorSelectionRange(root)?.cloneRange() ?? null;
        void insertEditorClipboardImageData(root, clipboardImageData, savedRange, undoBefore, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate, editorImageAttachmentContext)
          .catch((cause) => reportEditorImageAttachmentError(editorImageAttachmentContext, onEditorImageAttachmentError, cause));
        return;
      }

      const sanitizedHTML = sanitizeEditorDocumentHTML(html);
      if (sanitizedHTML.trim()) {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
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
      const root = event.currentTarget;
      if (copySelectedEditorImage(root, event.clipboardData) || copySelectedEditorDocumentFragment(root, event.clipboardData)) {
        event.preventDefault();
      }
    },
    onCut(event) {
      const root = event.currentTarget;
      if (!getSelectedEditorImageFrame(root)) return;
      event.preventDefault();
      const undoBefore = snapshotEditorDocumentRoot(root);
      if (!copySelectedEditorImage(root, event.clipboardData)) return;
      if (!removeSelectedEditorImage(root)) return;
      pendingEditorFontSizeRef.current = null;
      recordEditorDocumentMutation(documentUndoHistoryRef.current, root, undoBefore, "image");
      commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
    },
    onDrop(event) {
      const root = event.currentTarget;
      rememberEditorSelectionRange(root);
      const undoBefore = snapshotEditorDocumentRoot(root);
      const html = event.dataTransfer.getData("text/html");
      const text = event.dataTransfer.getData("text/plain");
      const htmlKind = editorImageTransferHTMLKind(root.ownerDocument, html);
      const imageFile = getImageFileFromDataTransfer(event.dataTransfer);
      if (imageFile && shouldUseEditorImageFileTransferShortcut(true, htmlKind, text)) {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        root.focus({ preventScroll: true });
        const savedRange = getEditorSelectionRange(root)?.cloneRange() ?? null;
        void insertEditorImageFile(root, imageFile, savedRange, undoBefore, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate, editorImageAttachmentContext)
          .catch((cause) => reportEditorImageAttachmentError(editorImageAttachmentContext, onEditorImageAttachmentError, cause));
        return;
      }

      const clipboardImageData = readEditorImageClipboardDataFromHTML(root.ownerDocument, html);
      if (clipboardImageData) {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        root.focus({ preventScroll: true });
        const savedRange = getEditorSelectionRange(root)?.cloneRange() ?? null;
        void insertEditorClipboardImageData(root, clipboardImageData, savedRange, undoBefore, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate, editorImageAttachmentContext)
          .catch((cause) => reportEditorImageAttachmentError(editorImageAttachmentContext, onEditorImageAttachmentError, cause));
        return;
      }

      const sanitizedHTML = sanitizeEditorDocumentHTML(html);
      if (sanitizedHTML.trim()) {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
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
      rememberEditorSelectionRange(event.currentTarget);
      syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange, onSelectionInlineFormatChange);
      refreshMentionDraft(event.currentTarget);
      setActiveTableContextMenu(null);
      clearEditorTableCellSelections(event.currentTarget);
    },
    onSelect(event) {
      const range = getEditorSelectionRange(event.currentTarget);
      rememberEditorSelectionRange(event.currentTarget);
      if (range && !range.collapsed) {
        setActiveMentionDraft(null);
        setActiveTableContextMenu(null);
        pendingEditorFontSizeRef.current = null;
        syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange, onSelectionInlineFormatChange);
        return;
      }
      if (pendingEditorFontSizeRef.current !== null) {
        onSelectionFontSizeChange(pendingEditorFontSizeRef.current);
        return;
      }
      syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange, onSelectionInlineFormatChange);
    },
    onClick(event) {
      const root = event.currentTarget;
      rememberEditorSelectionRange(root);
      setActiveTableContextMenu(null);
      if (!findEditorImageFrame(root, event.target)) {
        clearEditorImageSelection(root);
      }
      pendingEditorFontSizeRef.current = null;
      syncSelectionFontSize(root, onSelectionFontSizeChange, onSelectionInlineFormatChange);
      const tableAlignmentAction = getEditorTableAlignmentAction(root, event.target);
      if (tableAlignmentAction) {
        event.preventDefault();
        event.stopPropagation();
        applyEditorTableAlignmentAction(
          root,
          tableAlignmentAction.table,
          tableAlignmentAction.align,
          documentUndoHistoryRef.current,
          scheduleDocumentSave,
          scheduleIndentGuideUpdate,
        );
        clearEditorTableCellSelections(root);
        return;
      }
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
      pendingEditorFontSizeRef.current = null;
      setActiveTableContextMenu(null);
      root.focus({ preventScroll: true });
      selectEditorImageFrame(root, frame);
      previewEditorImageFrame(root, frame, setActiveImagePreview);
    },
    onContextMenu(event) {
      openTableContextMenu(event.currentTarget, event);
    },
    onPointerDown(event) {
      const tableAlignmentAction = getEditorTableAlignmentAction(event.currentTarget, event.target);
      if (tableAlignmentAction) {
        event.preventDefault();
        event.stopPropagation();
        pendingEditorFontSizeRef.current = null;
        clearEditorImageSelection(event.currentTarget);
        event.currentTarget.focus({ preventScroll: true });
        return;
      }
      const frame = findEditorImageFrame(event.currentTarget, event.target);
      if (!frame) {
        setActiveTableContextMenu(null);
        const tableInteraction = getEditorTablePointerInteraction(event.currentTarget, event.target, event.clientX, event.clientY);
        if (!tableInteraction || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        pendingEditorFontSizeRef.current = null;
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
      pendingEditorFontSizeRef.current = null;
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
      if (pendingEditorFontSizeRef.current !== null) {
        onSelectionFontSizeChange(pendingEditorFontSizeRef.current);
        return;
      }
      syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange, onSelectionInlineFormatChange);
      refreshMentionDraft(event.currentTarget);
    },
    onBlur(event) {
      rememberEditorSelectionRange(event.currentTarget);
      setActiveMentionDraft(null);
      setActiveTableContextMenu(null);
      activeMentionRootRef.current = null;
      pendingEditorFontSizeRef.current = null;
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(serializeEditorDocumentHTML(event.currentTarget));
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
        pendingEditorFontSizeRef.current = null;
        pendingNativeUndoSnapshotRef.current = null;
        const applied = applyEditorUndoCommand(
          root,
          documentUndoHistoryRef.current,
          isEditorUndoShortcut(event) ? "undo" : "redo",
          scheduleDocumentSave,
          scheduleIndentGuideUpdate,
          onSelectionFontSizeChange,
          onSelectionInlineFormatChange,
        );
        if (applied) event.preventDefault();
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
        syncSelectionFontSize(root, onSelectionFontSizeChange, onSelectionInlineFormatChange);
        return;
      }

      const activeTableCell = getCurrentEditorTableCell(root);
      if (activeTableCell) {
        if (event.key === "Tab" && !activeTableCell.contains(getCurrentEditorListItem(root))) {
          event.preventDefault();
          pendingEditorFontSizeRef.current = null;
          pendingNativeUndoSnapshotRef.current = null;
          clearEditorImageSelection(root);
          moveEditorTableSelection(
            root,
            event.shiftKey ? -1 : 1,
            documentUndoHistoryRef.current,
            scheduleDocumentSave,
            scheduleIndentGuideUpdate,
          );
          setActiveTableContextMenu(null);
          clearEditorTableCellSelections(root);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          pendingEditorFontSizeRef.current = null;
          pendingNativeUndoSnapshotRef.current = null;
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
          pendingEditorFontSizeRef.current = null;
          clearEditorImageSelection(root);
          if (deleteSelectedEditorTableDimension(root, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate)) {
            event.preventDefault();
            pendingNativeUndoSnapshotRef.current = null;
            setActiveTableContextMenu(null);
            return;
          }
          if (!getCurrentEditorListItem(root)) return;
        }
      }

      if (event.key === "Escape") {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        clearEditorImageSelection(root);
        setActiveTableContextMenu(null);
        root.blur();
        return;
      }

      if (PENDING_FONT_SIZE_CANCEL_KEYS.has(event.key)) pendingEditorFontSizeRef.current = null;

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

      const activeEditorListItem = getCurrentEditorListItem(root);
      if (activeEditorListItem) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          pendingEditorFontSizeRef.current = null;
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
          pendingEditorFontSizeRef.current = null;
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
          pendingEditorFontSizeRef.current = null;
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
    currentDocumentTargetKeyRef,
    documentUndoHistoryRef,
    editorImageAttachmentContext,
    flushPendingDocumentSave,
    insertMention,
    mentionMenuOpen,
    mentionOptions,
    onSelectionFontSizeChange,
    onSelectionInlineFormatChange,
    onEditorImageAttachmentError,
    openTableContextMenu,
    outlineStyle,
    pendingEditorFontSizeRef,
    rememberCurrentDocumentScroll,
    rememberEditorSelectionRange,
    refreshMentionDraft,
    restoringScrollRef,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
    scrollMemoryRef,
    setDocumentScrollTop,
  ]);
  const insertTable = useCallback((root?: HTMLElement | null) => {
    if (!root) return false;
    root.focus({ preventScroll: true });
    restoreEditorSelectionRange(root);
    pendingEditorFontSizeRef.current = null;
    clearEditorImageSelection(root);
    setActiveTableContextMenu(null);
    activeMentionRootRef.current = null;
    setActiveMentionDraft(null);
    const inserted = insertEditorTable(root, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
    if (inserted) rememberEditorSelectionRange(root);
    return inserted;
  }, [documentUndoHistoryRef, pendingEditorFontSizeRef, rememberEditorSelectionRange, restoreEditorSelectionRange, scheduleDocumentSave, scheduleIndentGuideUpdate]);

  const overlay = React.createElement(React.Fragment, null, mentionMenu, tableContextMenu, imagePreviewModal);
  return { ...handlers, mentionMenu: overlay, insertTable, restoreSelection: restoreEditorSelectionRange };
}
