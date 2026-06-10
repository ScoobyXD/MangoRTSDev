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
  EDITOR_TABLE_ATTRIBUTE,
  EDITOR_TABLE_CELL_ATTRIBUTE,
  EDITOR_TABLE_COLUMNS_ATTRIBUTE,
  EDITOR_TERMINAL_BREAK_ATTRIBUTE,
  EDITOR_IMAGE_CLEAR_BREAK_ATTRIBUTE,
  createEditorTableElement,
  deserializeEditorDocumentHTML,
  getEditorLinkHrefForText,
  linkifyEditorPlainTextToHTML,
  readEditorDocumentText,
  sanitizeEditorDocumentHTML,
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
  writeImageClipboardData,
  writeImageToSystemClipboard,
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
  insertTable: (root?: HTMLElement | null) => boolean;
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
  mentionMenuPosition?: "fixed" | "absolute";
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
}

function createEmptyEditorTableCell(ownerDocument: Document): HTMLTableCellElement {
  const cell = ownerDocument.createElement("td");
  cell.setAttribute(EDITOR_TABLE_CELL_ATTRIBUTE, "true");
  cell.appendChild(ownerDocument.createElement("br"));
  return cell;
}

function createEmptyEditorTableRow(ownerDocument: Document, columns: number): HTMLTableRowElement {
  const row = ownerDocument.createElement("tr");
  for (let index = 0; index < Math.max(1, columns); index += 1) {
    row.appendChild(createEmptyEditorTableCell(ownerDocument));
  }
  return row;
}

function normalizeEditorTable(table: HTMLTableElement) {
  const ownerDocument = table.ownerDocument;
  const body = table.tBodies[0] ?? table.createTBody();
  const rows = getEditorTableRows(table);
  const columns = getEditorTableColumnCount(table);
  if (rows.length === 0) body.appendChild(createEmptyEditorTableRow(ownerDocument, columns));
  getEditorTableRows(table).forEach((row) => {
    const cells = getEditorTableCells(row);
    cells.forEach((cell) => {
      cell.setAttribute(EDITOR_TABLE_CELL_ATTRIBUTE, "true");
      if (cell.childNodes.length === 0) cell.appendChild(ownerDocument.createElement("br"));
    });
    for (let index = cells.length; index < columns; index += 1) {
      row.appendChild(createEmptyEditorTableCell(ownerDocument));
    }
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
  normalizeEditorTable(table);
  const cells = getEditorTableRows(table).flatMap(getEditorTableCells);
  const currentIndex = cells.indexOf(cell);
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
  const newRow = createEmptyEditorTableRow(root.ownerDocument, columns);
  const body = table.tBodies[0] ?? table.createTBody();
  body.appendChild(newRow);
  updateEditorTableColumnAttribute(table);
  const firstCell = getEditorTableCells(newRow)[0];
  if (firstCell) setSelectionInEditorTableCell(root, firstCell);
  recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
  return true;
}

type EditorTableCommand = "insert-row-after" | "insert-column-after" | "delete-row" | "delete-column" | "delete-table";

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
  normalizeEditorTable(table);
  const coordinates = getEditorTableCellCoordinates(table, cell);
  if (!coordinates) return false;

  const undoBefore = snapshotEditorDocumentRoot(root);
  const rows = getEditorTableRows(table);
  const targetRow = rows[coordinates.rowIndex];
  let nextSelectionCell: HTMLTableCellElement | null = cell;

  if (command === "delete-table") {
    removeEditorTableAndSetCaret(root, table);
  } else if (command === "insert-row-after") {
    const newRow = createEmptyEditorTableRow(root.ownerDocument, getEditorTableColumnCount(table));
    targetRow.after(newRow);
    nextSelectionCell = getEditorTableCells(newRow)[Math.min(coordinates.columnIndex, getEditorTableCells(newRow).length - 1)] ?? null;
    updateEditorTableColumnAttribute(table);
  } else if (command === "insert-column-after") {
    getEditorTableRows(table).forEach((row) => {
      const cells = getEditorTableCells(row);
      const newCell = createEmptyEditorTableCell(root.ownerDocument);
      const anchor = cells[Math.min(coordinates.columnIndex, cells.length - 1)];
      if (anchor) anchor.after(newCell);
      else row.appendChild(newCell);
      if (row === targetRow) nextSelectionCell = newCell;
    });
    updateEditorTableColumnAttribute(table);
  } else if (command === "delete-row") {
    if (rows.length <= 1) {
      removeEditorTableAndSetCaret(root, table);
    } else {
      const fallbackRow = rows[coordinates.rowIndex + 1] ?? rows[coordinates.rowIndex - 1] ?? null;
      targetRow.remove();
      nextSelectionCell = fallbackRow ? getEditorTableCells(fallbackRow)[Math.min(coordinates.columnIndex, getEditorTableCells(fallbackRow).length - 1)] ?? null : null;
      updateEditorTableColumnAttribute(table);
    }
  } else if (command === "delete-column") {
    const columns = getEditorTableColumnCount(table);
    if (columns <= 1) {
      removeEditorTableAndSetCaret(root, table);
    } else {
      getEditorTableRows(table).forEach((row) => {
        const cells = getEditorTableCells(row);
        cells[coordinates.columnIndex]?.remove();
      });
      const nextCoordinates = {
        rowIndex: Math.min(coordinates.rowIndex, Math.max(0, getEditorTableRows(table).length - 1)),
        columnIndex: Math.min(coordinates.columnIndex, Math.max(0, columns - 2)),
      };
      const nextRow = getEditorTableRows(table)[nextCoordinates.rowIndex];
      nextSelectionCell = nextRow ? getEditorTableCells(nextRow)[nextCoordinates.columnIndex] ?? null : null;
      updateEditorTableColumnAttribute(table);
    }
  }

  if (nextSelectionCell && root.contains(nextSelectionCell)) setSelectionInEditorTableCell(root, nextSelectionCell);
  recordEditorDocumentMutation(documentUndoHistory, root, undoBefore, "format");
  commitEditorDocument(root, scheduleDocumentSave, scheduleIndentGuideUpdate, true);
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
  position: "fixed" | "absolute";
};

type RichTextTableDraft = {
  left: number;
  top: number;
  position: "fixed" | "absolute";
  rows: number;
  columns: number;
};

type EditorImagePreviewDraft = {
  src: string;
  label: string;
  html: string;
};

const EDITOR_MENTION_MENU_WIDTH_PX = 320;
const EDITOR_MENTION_MENU_MAX_HEIGHT_PX = 242;
const EDITOR_MENTION_MENU_MARGIN_PX = 8;
const EDITOR_TABLE_MENU_WIDTH_PX = 286;
const EDITOR_TABLE_MENU_HEIGHT_PX = 76;

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

function readRichTextTableDraft(root: HTMLElement, position: "fixed" | "absolute" = "fixed"): RichTextTableDraft | null {
  const cell = getCurrentEditorTableCell(root);
  const table = getEditorTableForCell(root, cell);
  if (!cell || !table) return null;

  const cellRect = cell.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  const container = position === "absolute" ? root.parentElement : null;
  const containerRect = container?.getBoundingClientRect() ?? null;
  const rootRect = root.getBoundingClientRect();
  const view = root.ownerDocument.defaultView;
  const viewportWidth = view?.innerWidth ?? 1280;
  const viewportHeight = view?.innerHeight ?? 720;
  const coordinateLeft = position === "absolute" && containerRect
    ? cellRect.left - containerRect.left
    : cellRect.left;
  const aboveTop = position === "absolute" && containerRect
    ? tableRect.top - containerRect.top - EDITOR_TABLE_MENU_HEIGHT_PX - 6
    : tableRect.top - EDITOR_TABLE_MENU_HEIGHT_PX - 6;
  const belowTop = position === "absolute" && containerRect
    ? cellRect.bottom - containerRect.top + 6
    : cellRect.bottom + 6;
  const boundaryLeft = position === "absolute" && containerRect ? 0 : rootRect.left;
  const boundaryRight = position === "absolute" && containerRect ? containerRect.width : rootRect.right;
  const boundaryHeight = position === "absolute" && containerRect ? containerRect.height : viewportHeight;
  const editorMinLeft = Number.isFinite(boundaryLeft) ? boundaryLeft + EDITOR_MENTION_MENU_MARGIN_PX : EDITOR_MENTION_MENU_MARGIN_PX;
  const editorMaxLeft = Number.isFinite(boundaryRight)
    ? boundaryRight - EDITOR_TABLE_MENU_WIDTH_PX - EDITOR_MENTION_MENU_MARGIN_PX
    : viewportWidth - EDITOR_TABLE_MENU_WIDTH_PX - EDITOR_MENTION_MENU_MARGIN_PX;
  const viewportMaxLeft = viewportWidth - EDITOR_TABLE_MENU_WIDTH_PX - EDITOR_MENTION_MENU_MARGIN_PX;
  const minLeft = position === "absolute"
    ? Math.max(EDITOR_MENTION_MENU_MARGIN_PX, editorMinLeft)
    : Math.max(EDITOR_MENTION_MENU_MARGIN_PX, Math.min(editorMinLeft, viewportMaxLeft));
  const maxLeft = Math.max(minLeft, position === "absolute" ? editorMaxLeft : Math.min(editorMaxLeft, viewportMaxLeft));
  const preferredTop = aboveTop >= EDITOR_MENTION_MENU_MARGIN_PX ? aboveTop : belowTop;
  const maxTop = boundaryHeight - EDITOR_TABLE_MENU_HEIGHT_PX - EDITOR_MENTION_MENU_MARGIN_PX;
  return {
    left: Math.max(minLeft, Math.min(coordinateLeft, maxLeft)),
    top: Math.max(EDITOR_MENTION_MENU_MARGIN_PX, Math.min(preferredTop, maxTop)),
    position,
    rows: getEditorTableRows(table).length,
    columns: getEditorTableColumnCount(table),
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
  void name;
  return `#475569`;
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
  writeImageClipboardData(clipboardData, data.src, html);
  writeImageToSystemClipboard(data.src, html);
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
  onPreviewImage?: (preview: EditorImagePreviewDraft) => void,
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
    if (!moved) {
      const data = readEditorImageData(frame);
      if (data && onPreviewImage) {
        onPreviewImage({
          src: data.src,
          label: "Editor image",
          html: createEditorImageClipboardHTML(root.ownerDocument, data),
        });
      }
      return;
    }
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
  mentionAccent = "#334155",
  mentionSurfaceText = "#111827",
  mentionStrokeColor = "rgba(15,23,42,0.18)",
  mentionMenuPosition = "fixed",
}: UseEditorDocumentSurfaceHandlersOptions): EditorDocumentSurfaceHandlerResult {
  const pendingNativeUndoSnapshotRef = useRef<EditorDocumentUndoSnapshot | null>(null);
  const activeMentionRootRef = useRef<HTMLElement | null>(null);
  const activeTableRootRef = useRef<HTMLElement | null>(null);
  const [activeMentionDraft, setActiveMentionDraft] = useState<RichTextMentionDraft | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [activeTableDraft, setActiveTableDraft] = useState<RichTextTableDraft | null>(null);
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

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [activeMentionDraft?.start, activeMentionDraft?.query]);

  useEffect(() => {
    setActiveMentionIndex((current) => Math.min(current, Math.max(0, mentionOptions.length - 1)));
  }, [mentionOptions.length]);

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

  const refreshTableDraft = useCallback((root: HTMLElement) => {
    const draft = readRichTextTableDraft(root, mentionMenuPosition);
    activeTableRootRef.current = draft ? root : null;
    setActiveTableDraft(draft);
  }, [mentionMenuPosition]);

  const insertMention = useCallback((root: HTMLElement, mention: ActiveMentionDraft, user: MentionableCompanyUser) => {
    replaceEditorMentionDraft(root, mention, user, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
    activeMentionRootRef.current = null;
    setActiveMentionDraft(null);
  }, [documentUndoHistoryRef, scheduleDocumentSave, scheduleIndentGuideUpdate]);

  const runTableCommand = useCallback((command: EditorTableCommand) => {
    const root = activeTableRootRef.current;
    if (!root) return;
    const applied = applyEditorTableCommand(root, command, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
    if (applied) refreshTableDraft(root);
  }, [documentUndoHistoryRef, refreshTableDraft, scheduleDocumentSave, scheduleIndentGuideUpdate]);

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
              background: selected ? "rgba(100, 116, 139, 0.16)" : "transparent",
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
          background: "rgba(17,24,39,0.46)",
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

  const tableButtonStyle = {
    minHeight: 26,
    border: `1px solid ${mentionStrokeColor}`,
    borderRadius: 6,
    background: "#ffffff",
    color: mentionSurfaceText,
    cursor: "pointer",
    fontSize: 10.5,
    fontWeight: 800,
    letterSpacing: 0,
    padding: "0 8px",
    whiteSpace: "nowrap",
  } satisfies React.CSSProperties;

  const tableMenu = activeTableDraft && !mentionMenuOpen
    ? React.createElement(
      "div",
      {
        role: "toolbar",
        "aria-label": "Table actions",
        onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => {
          event.preventDefault();
          event.stopPropagation();
        },
        style: {
          position: activeTableDraft.position,
          left: activeTableDraft.left,
          top: activeTableDraft.top,
          zIndex: 1990,
          width: EDITOR_TABLE_MENU_WIDTH_PX,
          maxWidth: "calc(100vw - 16px)",
          display: "grid",
          gap: 6,
          padding: 6,
          border: `1px solid ${mentionStrokeColor}`,
          borderRadius: 8,
          background: "#ffffff",
          boxShadow: "0 16px 36px rgba(15,23,42,0.18)",
          color: mentionSurfaceText,
          fontFamily: "var(--mango-font-family)",
        } satisfies React.CSSProperties,
      },
      React.createElement(
        "div",
        {
          style: {
            minWidth: 0,
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 5,
          } satisfies React.CSSProperties,
        },
        React.createElement("button", { type: "button", onClick: () => runTableCommand("insert-row-after"), style: tableButtonStyle }, "Add row"),
        React.createElement("button", { type: "button", onClick: () => runTableCommand("insert-column-after"), style: tableButtonStyle }, "Add column"),
        React.createElement("button", { type: "button", onClick: () => runTableCommand("delete-row"), style: tableButtonStyle }, activeTableDraft.rows <= 1 ? "Delete table" : "Delete row"),
        React.createElement("button", { type: "button", onClick: () => runTableCommand("delete-column"), style: tableButtonStyle }, activeTableDraft.columns <= 1 ? "Delete table" : "Delete column"),
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => runTableCommand("delete-table"),
          style: {
            ...tableButtonStyle,
            width: "100%",
            color: "#991b1b",
            borderColor: "rgba(153,27,27,0.22)",
            background: "rgba(254,242,242,0.96)",
          } satisfies React.CSSProperties,
        },
        "Delete table",
      ),
    )
    : null;

  const handlers = useMemo<EditorDocumentSurfaceHandlers>(() => ({
    onBeforeInput(event) {
      const root = event.currentTarget;
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
          refreshTableDraft(root);
        }
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
          refreshTableDraft(root);
        }
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
      refreshTableDraft(event.currentTarget);
    },
    onSelect(event) {
      const range = getEditorSelectionRange(event.currentTarget);
      if (range && !range.collapsed) {
        setActiveMentionDraft(null);
        activeTableRootRef.current = null;
        setActiveTableDraft(null);
        pendingEditorFontSizeRef.current = null;
        syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange);
        return;
      }
      if (pendingEditorFontSizeRef.current !== null) {
        onSelectionFontSizeChange(pendingEditorFontSizeRef.current);
        return;
      }
      syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange);
      refreshTableDraft(event.currentTarget);
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
        refreshTableDraft(event.currentTarget);
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
        startEditorImagePointerInteraction(
          event.currentTarget,
          frame,
          event,
          documentUndoHistoryRef.current,
          scheduleDocumentSave,
          scheduleIndentGuideUpdate,
          setActiveImagePreview,
        );
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
      refreshTableDraft(event.currentTarget);
    },
    onBlur(event) {
      setActiveMentionDraft(null);
      setActiveTableDraft(null);
      activeMentionRootRef.current = null;
      activeTableRootRef.current = null;
      pendingEditorFontSizeRef.current = null;
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(serializeEditorDocumentHTML(event.currentTarget));
    },
    onScroll(event) {
      setActiveMentionDraft(null);
      setActiveTableDraft(null);
      activeMentionRootRef.current = null;
      activeTableRootRef.current = null;
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
        syncSelectionFontSize(root, onSelectionFontSizeChange);
        return;
      }

      const activeTableCell = getCurrentEditorTableCell(root);
      if (activeTableCell) {
        if (event.key === "Tab") {
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
          refreshTableDraft(root);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          pendingEditorFontSizeRef.current = null;
          pendingNativeUndoSnapshotRef.current = null;
          clearEditorImageSelection(root);
          insertEditorTableCellLineBreak(root, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
          refreshTableDraft(root);
          return;
        }
        if (event.key === "Backspace" || event.key === "Delete") {
          pendingEditorFontSizeRef.current = null;
          clearEditorImageSelection(root);
          return;
        }
      }

      if (event.key === "Escape") {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        clearEditorImageSelection(root);
        activeTableRootRef.current = null;
        setActiveTableDraft(null);
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
        const edit = insertEditorEnterText(currentText, offsets.start, offsets.end, outlineStyle, { continueAutomaticOutline: !event.shiftKey });
        const insertedText = edit.value.slice(offsets.start, edit.selectionStart);
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
    refreshTableDraft,
    restoringScrollRef,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
    scrollMemoryRef,
    setDocumentScrollTop,
  ]);
  const insertTable = useCallback((root?: HTMLElement | null) => {
    if (!root) return false;
    root.focus();
    pendingEditorFontSizeRef.current = null;
    clearEditorImageSelection(root);
    activeMentionRootRef.current = null;
    setActiveMentionDraft(null);
    const inserted = insertEditorTable(root, documentUndoHistoryRef.current, scheduleDocumentSave, scheduleIndentGuideUpdate);
    if (inserted) refreshTableDraft(root);
    return inserted;
  }, [documentUndoHistoryRef, pendingEditorFontSizeRef, refreshTableDraft, scheduleDocumentSave, scheduleIndentGuideUpdate]);

  const overlay = React.createElement(React.Fragment, null, mentionMenu, tableMenu, imagePreviewModal);
  return { ...handlers, mentionMenu: overlay, insertTable };
}
