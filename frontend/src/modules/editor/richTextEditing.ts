import {
  createEditorImageFrame,
  editorAttachmentIDFromImageSource,
  EDITOR_IMAGE_NODE_ATTRIBUTE,
  readEditorImageData,
} from "./editorImages.js";
import {
  applyEditorMentionStyle,
  EDITOR_MENTION_KIND_ATTRIBUTE,
  EDITOR_MENTION_USER_ID_ATTRIBUTE,
  isEditorMentionElement,
} from "./editorMentions.js";
import { createEditorEntityLinkElement, readEditorEntityLinkElement } from "./editorEntityLinks.js";

export const EDITOR_DOCUMENT_BOTTOM_BUFFER_LINES = 20;
export const EDITOR_RICH_TEXT_PREFIX = "<!-- mango-editor-html-v1 -->";
export const EDITOR_LINK_COLOR = "#0369a1";
export const EDITOR_TERMINAL_BREAK_ATTRIBUTE = "data-mango-editor-terminal-break";
export const EDITOR_IMAGE_CLEAR_BREAK_ATTRIBUTE = "data-mango-editor-image-clear";
export const EDITOR_TABLE_ATTRIBUTE = "data-mango-editor-table";
export const EDITOR_TABLE_CELL_ATTRIBUTE = "data-mango-editor-table-cell";
export const EDITOR_TABLE_COLUMNS_ATTRIBUTE = "data-mango-editor-table-columns";
export const EDITOR_TABLE_HEADER_ATTRIBUTE = "data-mango-editor-table-header";
export const EDITOR_TABLE_COLUMN_WIDTHS_ATTRIBUTE = "data-mango-editor-table-column-widths";
export const EDITOR_TABLE_WIDTH_ATTRIBUTE = "data-mango-editor-table-width";
export const EDITOR_TABLE_OFFSET_ATTRIBUTE = "data-mango-editor-table-offset";
export const EDITOR_TABLE_TEXT_ALIGN_ATTRIBUTE = "data-mango-editor-table-text-align";
const EDITOR_TEXT_ALIGN_ATTRIBUTE = "data-mango-editor-text-align";
export const EDITOR_TABLE_ALIGNMENT_CONTROL_ATTRIBUTE = "data-mango-editor-table-align-controls";
export const EDITOR_TABLE_ALIGNMENT_ACTION_ATTRIBUTE = "data-mango-editor-table-align-action";
export const EDITOR_TABLE_ALIGNMENT_ICON_ATTRIBUTE = "data-mango-editor-table-align-icon";
export const EDITOR_LIST_ATTRIBUTE = "data-mango-editor-list";
export const EDITOR_ORDERED_LIST_ATTRIBUTE = "data-mango-editor-ordered-list";
export const EDITOR_LIST_ITEM_ATTRIBUTE = "data-mango-editor-list-item";
export const EDITOR_CHECKLIST_CHECKED_ATTRIBUTE = "data-mango-editor-checklist-checked";
export const EDITOR_LIST_MARKER_ATTRIBUTE = "data-mango-editor-list-marker";
export const EDITOR_EMAIL_BODY_ATTRIBUTE = "data-mango-email-body";
export const EDITOR_HIGHLIGHT_ATTRIBUTE = "data-mango-editor-highlight";
export const EDITOR_HIGHLIGHT_CLEAR_VALUE = "none";

export type EditorListKind = "bullet" | "checklist";
export type EditorOrderedListAttributes = {
  markerType?: "1" | "a" | "A" | "i" | "I";
  start?: number;
  reversed: boolean;
};
export type EditorListMarkerStyle = "solid-circle" | "hollow-circle" | "solid-square" | "hollow-square";
export type EditorTextAlignment = "left" | "center" | "right";
export type EditorHighlightColor = `#${string}`;
export type EditorHighlightColorItem = { id: string; label: string; color: EditorHighlightColor };
function splitEditorSelectedTextRunOffsets(text: string, startOffset: number, endOffset: number): Array<{ startOffset: number; endOffset: number }> {
  const runs: Array<{ startOffset: number; endOffset: number }> = [];
  let runStart = Math.max(0, startOffset);
  const safeEnd = Math.min(text.length, endOffset);
  for (let offset = runStart; offset < safeEnd; offset += 1) {
    if (text[offset] !== "\n" && text[offset] !== "\r") continue;
    if (offset > runStart) runs.push({ startOffset: runStart, endOffset: offset });
    runStart = offset + 1;
  }
  if (safeEnd > runStart) runs.push({ startOffset: runStart, endOffset: safeEnd });
  return runs;
}
export type EditorSelectionTextNode = { text: string; selectable?: boolean };
export type EditorSelectedTextNodeRun = {
  nodeIndex: number;
  startOffset: number;
  endOffset: number;
};

export function mapEditorSelectedTextRunOffsets(
  nodes: readonly EditorSelectionTextNode[],
  selectionStart: number,
  selectionEnd: number,
): EditorSelectedTextNodeRun[] {
  const runs: EditorSelectedTextNodeRun[] = [];
  let currentOffset = 0;
  nodes.forEach((node, nodeIndex) => {
    const nodeStart = currentOffset;
    currentOffset += node.text.length;
    if (!node.text.length || node.selectable === false) return;
    const startOffset = Math.max(0, selectionStart - nodeStart);
    const endOffset = Math.min(node.text.length, selectionEnd - nodeStart);
    splitEditorSelectedTextRunOffsets(node.text, startOffset, endOffset).forEach((run) => {
      runs.push({ nodeIndex, ...run });
    });
  });
  return runs;
}



export const EDITOR_HIGHLIGHT_COLOR_ITEMS: readonly EditorHighlightColorItem[] = [
  { id: "yellow", label: "Yellow", color: "#fef08a" },
  { id: "orange", label: "Orange", color: "#fed7aa" },
  { id: "red", label: "Red", color: "#fecaca" },
  { id: "pink", label: "Pink", color: "#fbcfe8" },
  { id: "purple", label: "Purple", color: "#ddd6fe" },
  { id: "blue", label: "Blue", color: "#bfdbfe" },
  { id: "cyan", label: "Cyan", color: "#a5f3fc" },
  { id: "green", label: "Green", color: "#bbf7d0" },
] as const;

export type EditorElementHighlight = { explicit: boolean; color: EditorHighlightColor | null };

export const EDITOR_TABLE_DEFAULT_ROWS = 3;
export const EDITOR_TABLE_DEFAULT_COLUMNS = 3;
export const EDITOR_TABLE_MAX_ROWS = 20;
export const EDITOR_TABLE_MAX_COLUMNS = 8;
const EDITOR_TABLE_MAX_CELL_TEXT_LENGTH = 2000;
const EDITOR_TABLE_MIN_COLUMN_WIDTH_PERCENT = 5;
const EDITOR_TABLE_MIN_WIDTH_PERCENT = 18;

const URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
const TRAILING_URL_PUNCTUATION = /[),.;:!?]+$/;

function escapeEditorHTML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeEditorAttribute(value: string): string {
  return escapeEditorHTML(value).replace(/`/g, "&#96;");
}

function splitURLTrailingPunctuation(value: string): { urlText: string; trailingText: string } {
  const match = TRAILING_URL_PUNCTUATION.exec(value);
  if (!match || !match.index) return { urlText: value, trailingText: "" };
  return {
    urlText: value.slice(0, match.index),
    trailingText: value.slice(match.index),
  };
}

function normalizeEditorArrowLigatureText(value: string): string {
  return value.replace(/\u2192/g, "->");
}

function normalizeEditorURL(value: string): string | null {
  const withProtocol = value.toLowerCase().startsWith("www.") ? `https://${value}` : value;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function readEditorListKind(value: string | null | undefined): EditorListKind | null {
  if (value === "bullet" || value === "checklist") return value;
  return null;
}

export function getEditorLinkHrefForText(value: string): string | null {
  return normalizeEditorURL(value);
}

function editorLinkHTML(label: string, href: string): string {
  return `<a href="${escapeEditorAttribute(href)}" target="_blank" rel="noopener noreferrer" style="color: ${EDITOR_LINK_COLOR}; text-decoration: underline; cursor: pointer;">${escapeEditorHTML(label)}</a>`;
}

export function linkifyEditorPlainTextToHTML(value: string): string {
  URL_PATTERN.lastIndex = 0;
  let output = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(value)) !== null) {
    const matchedText = match[0];
    const matchIndex = match.index;
    const { urlText, trailingText } = splitURLTrailingPunctuation(matchedText);
    const href = normalizeEditorURL(urlText);
    output += escapeEditorHTML(normalizeEditorArrowLigatureText(value.slice(lastIndex, matchIndex)));
    output += href ? editorLinkHTML(urlText, href) : escapeEditorHTML(urlText);
    output += escapeEditorHTML(normalizeEditorArrowLigatureText(trailingText));
    lastIndex = matchIndex + matchedText.length;
  }
  output += escapeEditorHTML(normalizeEditorArrowLigatureText(value.slice(lastIndex)));
  return output;
}

function applySafeFontSize(source: HTMLElement, target: HTMLElement) {
  const fontSize = source.style.fontSize.trim();
  if (!fontSize) return;
  const parsed = Number.parseFloat(fontSize);
  if (!Number.isFinite(parsed) || parsed < 6 || parsed > 96) return;
  target.style.fontSize = `${Math.round(parsed)}px`;
}

function editorHighlightByteHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

const EDITOR_HIGHLIGHT_NAMED_COLOR_ALIASES: Readonly<Record<string, EditorHighlightColor>> = {
  yellow: "#ffff00",
  orange: "#ffa500",
  red: "#ff0000",
  pink: "#ffc0cb",
  purple: "#800080",
  blue: "#0000ff",
  cyan: "#00ffff",
  aqua: "#00ffff",
  green: "#008000",
  lime: "#00ff00",
};

export function normalizeEditorHighlightColor(value: string | null | undefined): EditorHighlightColor | null {
  const cleanValue = value?.trim().toLowerCase() ?? "";
  if (!cleanValue) return null;
  const named = EDITOR_HIGHLIGHT_NAMED_COLOR_ALIASES[cleanValue];
  if (named) return named;
  const shortHex = /^#([0-9a-f]{3})$/.exec(cleanValue);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split("");
    return `#${r}${r}${g}${g}${b}${b}` as EditorHighlightColor;
  }
  const longHex = /^#([0-9a-f]{6})$/.exec(cleanValue);
  if (longHex) return `#${longHex[1]}` as EditorHighlightColor;
  const rgb = /^rgba?\(\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)(?:\s*,\s*([0-9]+(?:\.[0-9]+)?))?\s*\)$/.exec(cleanValue);
  if (!rgb) return null;
  const red = Number.parseFloat(rgb[1]);
  const green = Number.parseFloat(rgb[2]);
  const blue = Number.parseFloat(rgb[3]);
  const alpha = rgb[4] === undefined ? 1 : Number.parseFloat(rgb[4]);
  if (![red, green, blue, alpha].every(Number.isFinite)) return null;
  if (red < 0 || red > 255 || green < 0 || green > 255 || blue < 0 || blue > 255 || alpha !== 1) return null;
  return `#${editorHighlightByteHex(red)}${editorHighlightByteHex(green)}${editorHighlightByteHex(blue)}` as EditorHighlightColor;
}

export function readEditorElementHighlight(element: HTMLElement): EditorElementHighlight {
  const storedValue = element.getAttribute(EDITOR_HIGHLIGHT_ATTRIBUTE)?.trim().toLowerCase() ?? "";
  if (storedValue === EDITOR_HIGHLIGHT_CLEAR_VALUE) return { explicit: true, color: null };
  const storedColor = normalizeEditorHighlightColor(storedValue);
  if (storedColor) return { explicit: true, color: storedColor };
  const styleColor = normalizeEditorHighlightColor(element.style.backgroundColor);
  return styleColor ? { explicit: true, color: styleColor } : { explicit: false, color: null };
}

export function setEditorElementHighlight(element: HTMLElement, color: EditorHighlightColor | null) {
  if (color) {
    element.setAttribute(EDITOR_HIGHLIGHT_ATTRIBUTE, color);
    element.style.backgroundColor = color;
    return;
  }
  element.setAttribute(EDITOR_HIGHLIGHT_ATTRIBUTE, EDITOR_HIGHLIGHT_CLEAR_VALUE);
  element.style.backgroundColor = "transparent";
}

export function removeEditorElementHighlight(element: HTMLElement) {
  element.removeAttribute(EDITOR_HIGHLIGHT_ATTRIBUTE);
  element.style.removeProperty("background-color");
}

function appendCloneWhenNotEmpty(clone: HTMLElement, output: Node[]) {
  if (clone.childNodes.length > 0) output.push(clone);
}

function liftEditorHighlightSpanOutOfAncestor(target: HTMLSpanElement, ancestor: HTMLElement) {
  let pivot: HTMLElement = target;
  while (pivot.parentElement && pivot.parentElement !== ancestor) {
    const wrapper = pivot.parentElement;
    const before = wrapper.cloneNode(false) as HTMLElement;
    const after = wrapper.cloneNode(false) as HTMLElement;
    while (wrapper.firstChild && wrapper.firstChild !== pivot) before.appendChild(wrapper.firstChild);
    while (pivot.nextSibling) after.appendChild(pivot.nextSibling);
    const middle = wrapper.cloneNode(false) as HTMLElement;
    middle.appendChild(pivot);
    const replacements: Node[] = [];
    appendCloneWhenNotEmpty(before, replacements);
    replacements.push(middle);
    appendCloneWhenNotEmpty(after, replacements);
    wrapper.replaceWith(...replacements);
    pivot = middle;
  }
  if (pivot.parentElement !== ancestor) return;
  const before = ancestor.cloneNode(false) as HTMLElement;
  const after = ancestor.cloneNode(false) as HTMLElement;
  while (ancestor.firstChild && ancestor.firstChild !== pivot) before.appendChild(ancestor.firstChild);
  while (pivot.nextSibling) after.appendChild(pivot.nextSibling);
  const replacements: Node[] = [];
  appendCloneWhenNotEmpty(before, replacements);
  replacements.push(pivot);
  appendCloneWhenNotEmpty(after, replacements);
  ancestor.replaceWith(...replacements);
}

/** Splits outer highlight wrappers so applied or cleared selections are never represented by nested transparent spans. */
export function normalizeEditorHighlightSpans(root: HTMLElement) {
  const highlightedSpans = Array.from(root.querySelectorAll(`span[${EDITOR_HIGHLIGHT_ATTRIBUTE}]`)) as HTMLSpanElement[];
  for (const span of highlightedSpans) {
    if (!root.contains(span)) continue;
    let ancestor = span.parentElement;
    while (ancestor && ancestor !== root) {
      if (readEditorElementHighlight(ancestor).explicit) {
        liftEditorHighlightSpanOutOfAncestor(span, ancestor);
        ancestor = span.parentElement;
        continue;
      }
      ancestor = ancestor.parentElement;
    }
    if (readEditorElementHighlight(span).explicit && readEditorElementHighlight(span).color === null) {
      removeEditorElementHighlight(span);
    }
  }
}

function applySafeHighlight(source: HTMLElement, target: HTMLElement) {
  const highlight = readEditorElementHighlight(source);
  if (highlight.explicit) setEditorElementHighlight(target, highlight.color);
}

function readEditorAlignmentValue(value: string | null | undefined): EditorTextAlignment | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "left" || normalized === "center" || normalized === "right") return normalized;
  return null;
}

export function readEditorTableTextAlign(table: HTMLElement): EditorTextAlignment | null {
  return readEditorAlignmentValue(table.getAttribute(EDITOR_TABLE_TEXT_ALIGN_ATTRIBUTE))
    ?? readEditorAlignmentValue(table.style.textAlign);
}

export function readEditorTextAlign(element: HTMLElement): EditorTextAlignment | null {
  return readEditorAlignmentValue(element.getAttribute(EDITOR_TEXT_ALIGN_ATTRIBUTE))
    ?? readEditorAlignmentValue(element.style.textAlign);
}

function applyEditorTextAlign(element: HTMLElement, align: EditorTextAlignment) {
  element.setAttribute(EDITOR_TEXT_ALIGN_ATTRIBUTE, align);
  element.style.textAlign = align;
}

function clampEditorTableSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampEditorTablePercent(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatEditorTablePercent(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function equalEditorTableColumnWidths(columns: number): number[] {
  const safeColumns = clampEditorTableSize(columns, 1, EDITOR_TABLE_MAX_COLUMNS);
  return Array.from({ length: safeColumns }, () => 100 / safeColumns);
}

export function normalizeEditorTableColumnWidths(widths: number[], columns: number): number[] {
  const safeColumns = clampEditorTableSize(columns, 1, EDITOR_TABLE_MAX_COLUMNS);
  if (widths.length !== safeColumns) return equalEditorTableColumnWidths(safeColumns);
  const positiveWidths = widths.map((value) => Number.isFinite(value) && value > 0 ? value : 0);
  const total = positiveWidths.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return equalEditorTableColumnWidths(safeColumns);
  const minWidth = Math.min(EDITOR_TABLE_MIN_COLUMN_WIDTH_PERCENT, (100 / safeColumns) * 0.72);
  const normalized = positiveWidths.map((value) => Math.max(minWidth, (value / total) * 100));
  const adjustedTotal = normalized.reduce((sum, value) => sum + value, 0);
  return adjustedTotal > 0 ? normalized.map((value) => (value / adjustedTotal) * 100) : equalEditorTableColumnWidths(safeColumns);
}

function parseEditorTablePercentList(value: string | null): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => Number.parseFloat(part.trim().replace(/%$/, "")))
    .filter((part) => Number.isFinite(part));
}

function directEditorTableColWidths(element: HTMLElement): number[] {
  const colGroup = Array.from(element.children).find((child) => child instanceof HTMLElement && child.tagName === "COLGROUP");
  if (!(colGroup instanceof HTMLElement)) return [];
  return Array.from(colGroup.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName === "COL")
    .map((col) => Number.parseFloat(col.style.width.trim().replace(/%$/, "")))
    .filter((width) => Number.isFinite(width) && width > 0);
}

export function readEditorTableColumnWidths(element: HTMLElement, columns: number): number[] {
  const safeColumns = clampEditorTableSize(columns, 1, EDITOR_TABLE_MAX_COLUMNS);
  const attributeWidths = parseEditorTablePercentList(element.getAttribute(EDITOR_TABLE_COLUMN_WIDTHS_ATTRIBUTE));
  if (attributeWidths.length === safeColumns) return normalizeEditorTableColumnWidths(attributeWidths, safeColumns);
  const colWidths = directEditorTableColWidths(element);
  if (colWidths.length === safeColumns) return normalizeEditorTableColumnWidths(colWidths, safeColumns);
  return equalEditorTableColumnWidths(safeColumns);
}

export function applyEditorTableColumnWidths(table: HTMLTableElement, widths: number[]): number[] {
  const normalizedWidths = normalizeEditorTableColumnWidths(widths, widths.length || readEditorGridTableColumns(table));
  Array.from(table.children).forEach((child) => {
    if (child instanceof HTMLElement && child.tagName === "COLGROUP") child.remove();
  });
  const colGroup = table.ownerDocument.createElement("colgroup");
  normalizedWidths.forEach((width) => {
    const col = table.ownerDocument.createElement("col");
    col.style.width = `${formatEditorTablePercent(width)}%`;
    colGroup.appendChild(col);
  });
  table.insertBefore(colGroup, table.firstChild);
  table.setAttribute(EDITOR_TABLE_COLUMN_WIDTHS_ATTRIBUTE, normalizedWidths.map(formatEditorTablePercent).join(","));
  return normalizedWidths;
}

function readEditorTablePercentAttribute(element: HTMLElement, attribute: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(element.getAttribute(attribute) ?? "");
  return clampEditorTablePercent(Number.isFinite(parsed) ? parsed : fallback, min, max);
}

export function readEditorTableWidthPercent(table: HTMLTableElement): number {
  return readEditorTablePercentAttribute(table, EDITOR_TABLE_WIDTH_ATTRIBUTE, 100, EDITOR_TABLE_MIN_WIDTH_PERCENT, 100);
}

export function readEditorTableOffsetPercent(table: HTMLTableElement, widthPercent = readEditorTableWidthPercent(table)): number {
  return readEditorTablePercentAttribute(table, EDITOR_TABLE_OFFSET_ATTRIBUTE, 0, 0, Math.max(0, 100 - widthPercent));
}

export function applyEditorTableLayout(table: HTMLTableElement, widthPercent = 100, offsetPercent = 0): { widthPercent: number; offsetPercent: number } {
  const safeWidth = clampEditorTablePercent(widthPercent, EDITOR_TABLE_MIN_WIDTH_PERCENT, 100);
  const safeOffset = clampEditorTablePercent(offsetPercent, 0, Math.max(0, 100 - safeWidth));
  table.setAttribute(EDITOR_TABLE_WIDTH_ATTRIBUTE, formatEditorTablePercent(safeWidth));
  table.setAttribute(EDITOR_TABLE_OFFSET_ATTRIBUTE, formatEditorTablePercent(safeOffset));
  table.style.width = `${formatEditorTablePercent(safeWidth)}%`;
  table.style.marginLeft = safeOffset > 0 ? `${formatEditorTablePercent(safeOffset)}%` : "";
  table.style.maxWidth = `${formatEditorTablePercent(100 - safeOffset)}%`;
  return { widthPercent: safeWidth, offsetPercent: safeOffset };
}

export function applyEditorTableTextAlign(table: HTMLTableElement, align: EditorTextAlignment | null) {
  if (align) {
    table.setAttribute(EDITOR_TABLE_TEXT_ALIGN_ATTRIBUTE, align);
    table.style.textAlign = align;
  } else {
    table.removeAttribute(EDITOR_TABLE_TEXT_ALIGN_ATTRIBUTE);
    table.style.textAlign = "";
  }
  Array.from(table.querySelectorAll("td,th")).forEach((cell) => {
    if (!(cell instanceof HTMLElement)) return;
    cell.style.textAlign = align ?? "";
  });
}

function isEditorTableAlignmentControlNode(node: Node): boolean {
  return node instanceof HTMLElement && node.getAttribute(EDITOR_TABLE_ALIGNMENT_CONTROL_ATTRIBUTE) === "true";
}

export function ensureEditorTableAlignmentControls(cell: HTMLTableCellElement, _rowIndex: number, _columnIndex: number) {
  // Legacy documents can still contain the retired cell-corner overlay. Strip
  // it during every create/normalize/sanitize pass; alignment now lives only in
  // the shared editor header.
  cell.querySelectorAll(`[${EDITOR_TABLE_ALIGNMENT_CONTROL_ATTRIBUTE}="true"]`).forEach((control) => control.remove());
}

function readEditorGridTableColumns(element: HTMLElement, fallback = 3): number {
  const raw = Number.parseInt(element.getAttribute(EDITOR_TABLE_COLUMNS_ATTRIBUTE) ?? "", 10);
  return clampEditorTableSize(raw || fallback, 1, EDITOR_TABLE_MAX_COLUMNS);
}

function directEditorGridTableCells(element: HTMLElement): HTMLElement[] {
  return Array.from(element.children).filter((child): child is HTMLElement => (
    child instanceof HTMLElement && child.getAttribute(EDITOR_TABLE_CELL_ATTRIBUTE) === "true"
  ));
}

function editorPlainTextTableLinesFromCells(rowCells: string[][], rows: number, columns: number): string[] {
  const safeRows = clampEditorTableSize(rows, 1, EDITOR_TABLE_MAX_ROWS);
  const safeColumns = clampEditorTableSize(columns, 1, EDITOR_TABLE_MAX_COLUMNS);
  const lines: string[] = [];
  for (let rowIndex = 0; rowIndex < safeRows; rowIndex += 1) {
    const cells = Array.from({ length: safeColumns }, (_, columnIndex) => rowCells[rowIndex]?.[columnIndex]?.trim() ?? "");
    lines.push(`| ${cells.map((cell) => cell || " ").join(" | ")} |`);
  }
  return lines;
}

export function createEditorTableElement(ownerDocument: Document, rows = EDITOR_TABLE_DEFAULT_ROWS, columns = EDITOR_TABLE_DEFAULT_COLUMNS): HTMLTableElement {
  const safeRows = clampEditorTableSize(rows, 1, EDITOR_TABLE_MAX_ROWS);
  const safeColumns = clampEditorTableSize(columns, 1, EDITOR_TABLE_MAX_COLUMNS);
  const table = ownerDocument.createElement("table");
  const body = ownerDocument.createElement("tbody");
  table.setAttribute(EDITOR_TABLE_ATTRIBUTE, "true");
  table.setAttribute(EDITOR_TABLE_COLUMNS_ATTRIBUTE, String(safeColumns));
  for (let rowIndex = 0; rowIndex < safeRows; rowIndex += 1) {
    const row = ownerDocument.createElement("tr");
    for (let columnIndex = 0; columnIndex < safeColumns; columnIndex += 1) {
      row.appendChild(createEditorTableCell(ownerDocument, rowIndex, columnIndex));
    }
    body.appendChild(row);
  }
  table.appendChild(body);
  applyEditorTableColumnWidths(table, equalEditorTableColumnWidths(safeColumns));
  applyEditorTableLayout(table, 100, 0);
  return table;
}

function normalizeNativeTableCellText(value: string): string {
  return normalizeEditorWhitespaceText(value)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, EDITOR_TABLE_MAX_CELL_TEXT_LENGTH);
}

function createEditorTableCell(ownerDocument: Document, rowIndex: number, columnIndex: number): HTMLTableCellElement {
  const isHeader = rowIndex === 0 || columnIndex === 0;
  const cell = ownerDocument.createElement(isHeader ? "th" : "td") as HTMLTableCellElement;
  cell.setAttribute(EDITOR_TABLE_CELL_ATTRIBUTE, "true");
  if (isHeader) {
    cell.setAttribute(EDITOR_TABLE_HEADER_ATTRIBUTE, rowIndex === 0 && columnIndex === 0 ? "corner" : rowIndex === 0 ? "column" : "row");
  }
  ensureEditorTableAlignmentControls(cell, rowIndex, columnIndex);
  cell.appendChild(ownerDocument.createElement("br"));
  return cell;
}

function ensureEditableTableCellContent(cell: HTMLTableCellElement) {
  const editableChildren = Array.from(cell.childNodes).filter((child) => !isEditorTableAlignmentControlNode(child));
  if (editableChildren.length > 0) return;
  cell.appendChild(cell.ownerDocument.createElement("br"));
}

function sanitizeEditorTableCellContent(source: HTMLElement, target: HTMLTableCellElement, ownerDocument: Document) {
  source.childNodes.forEach((child) => {
    if (!isEditorTableAlignmentControlNode(child)) appendSanitizedNode(child, target, ownerDocument);
  });
  while (target.firstChild?.nodeType === Node.TEXT_NODE && !(target.firstChild.textContent ?? "").trim()) {
    target.firstChild.remove();
  }
  while (target.lastChild?.nodeType === Node.TEXT_NODE && !(target.lastChild.textContent ?? "").trim()) {
    target.lastChild.remove();
  }
  ensureEditableTableCellContent(target);
}

function createSanitizedEditorTableFromCells(sourceRows: HTMLElement[][], ownerDocument: Document, sourceTable?: HTMLElement | null): HTMLTableElement {
  const safeRows = clampEditorTableSize(Math.max(1, sourceRows.length), 1, EDITOR_TABLE_MAX_ROWS);
  const inferredColumns = Math.max(0, ...sourceRows.map((row) => row.length));
  const safeColumns = clampEditorTableSize(inferredColumns || EDITOR_TABLE_DEFAULT_COLUMNS, 1, EDITOR_TABLE_MAX_COLUMNS);
  const table = createEditorTableElement(ownerDocument, safeRows, safeColumns);
  const rows = Array.from(table.querySelectorAll("tr"));
  for (let rowIndex = 0; rowIndex < safeRows; rowIndex += 1) {
    const cells = Array.from(rows[rowIndex]?.children ?? []).filter((child): child is HTMLTableCellElement => (
      child instanceof HTMLTableCellElement
    ));
    for (let columnIndex = 0; columnIndex < safeColumns; columnIndex += 1) {
      const targetCell = cells[columnIndex];
      const sourceCell = sourceRows[rowIndex]?.[columnIndex];
      if (!targetCell || !sourceCell) continue;
      targetCell.replaceChildren();
      sanitizeEditorTableCellContent(sourceCell, targetCell, ownerDocument);
      ensureEditorTableAlignmentControls(targetCell, rowIndex, columnIndex);
    }
  }
  if (sourceTable) {
    applyEditorTableColumnWidths(table, readEditorTableColumnWidths(sourceTable, safeColumns));
    applyEditorTableLayout(table, readEditorTablePercentAttribute(sourceTable, EDITOR_TABLE_WIDTH_ATTRIBUTE, 100, EDITOR_TABLE_MIN_WIDTH_PERCENT, 100), readEditorTablePercentAttribute(sourceTable, EDITOR_TABLE_OFFSET_ATTRIBUTE, 0, 0, 100));
    applyEditorTableTextAlign(table, readEditorTableTextAlign(sourceTable));
  }
  return table;
}

function appendNativeTableAsEditorTable(source: HTMLElement, target: Node, ownerDocument: Document) {
  const sourceRows = Array.from(source.querySelectorAll("tr")).slice(0, EDITOR_TABLE_MAX_ROWS);
  const rowCells = sourceRows.map((row) => (
    Array.from(row.children)
      .filter((child): child is HTMLElement => (
        child instanceof HTMLElement && (child.tagName === "TD" || child.tagName === "TH")
      ))
      .slice(0, EDITOR_TABLE_MAX_COLUMNS)
  ));
  target.appendChild(createSanitizedEditorTableFromCells(rowCells, ownerDocument, source));
}

function appendSanitizedEditorGridTable(source: HTMLElement, target: Node, ownerDocument: Document) {
  const requestedColumns = readEditorGridTableColumns(source);
  const sourceCells = directEditorGridTableCells(source).slice(0, EDITOR_TABLE_MAX_ROWS * EDITOR_TABLE_MAX_COLUMNS);
  const rows = clampEditorTableSize(Math.max(1, Math.ceil(Math.max(1, sourceCells.length) / requestedColumns)), 1, EDITOR_TABLE_MAX_ROWS);
  const rowCells = Array.from({ length: rows }, () => Array.from<HTMLElement | null>({ length: requestedColumns }).fill(null));
  sourceCells.forEach((sourceCell, index) => {
    const rowIndex = Math.floor(index / requestedColumns);
    const columnIndex = index % requestedColumns;
    if (!rowCells[rowIndex]) return;
    rowCells[rowIndex][columnIndex] = sourceCell;
  });
  target.appendChild(createSanitizedEditorTableFromCells(rowCells.map((row) => row.filter((cell): cell is HTMLElement => cell !== null)), ownerDocument, source));
}

function directExternalChecklistInput(source: HTMLElement): HTMLElement | null {
  return Array.from(source.children).find((child): child is HTMLElement => (
    child instanceof HTMLElement
    && child.tagName === "INPUT"
    && (child.getAttribute("type") ?? "").trim().toLowerCase() === "checkbox"
  )) ?? null;
}

function appendSanitizedEditorListItem(source: HTMLElement, list: HTMLUListElement, ownerDocument: Document, kind: EditorListKind) {
  const item = ownerDocument.createElement("li");
  item.setAttribute(EDITOR_LIST_ITEM_ATTRIBUTE, kind);
  if (kind === "checklist") {
    const sourceCheckbox = directExternalChecklistInput(source);
    const checked = source.getAttribute(EDITOR_CHECKLIST_CHECKED_ATTRIBUTE) === "true"
      || sourceCheckbox?.hasAttribute("checked") === true
      || sourceCheckbox?.getAttribute("aria-checked") === "true";
    item.setAttribute(EDITOR_CHECKLIST_CHECKED_ATTRIBUTE, checked ? "true" : "false");
  }
  appendSanitizedChildren(source, item, ownerDocument);
  if (item.childNodes.length === 0) item.appendChild(ownerDocument.createElement("br"));
  list.appendChild(item);
}

function appendSanitizedEditorList(source: HTMLElement, target: Node, ownerDocument: Document, fallbackKind: EditorListKind) {
  const hasExternalChecklist = Array.from(source.children).some((child) => (
    child instanceof HTMLElement
    && child.tagName.toLowerCase() === "li"
    && directExternalChecklistInput(child) !== null
  ));
  const kind = readEditorListKind(source.getAttribute(EDITOR_LIST_ATTRIBUTE))
    ?? (hasExternalChecklist ? "checklist" : fallbackKind);
  const list = ownerDocument.createElement("ul");
  list.setAttribute(EDITOR_LIST_ATTRIBUTE, kind);
  Array.from(source.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === "li")
    .forEach((item) => appendSanitizedEditorListItem(item, list, ownerDocument, kind));
  if (list.children.length === 0) {
    const item = ownerDocument.createElement("li");
    item.setAttribute(EDITOR_LIST_ITEM_ATTRIBUTE, kind);
    if (kind === "checklist") item.setAttribute(EDITOR_CHECKLIST_CHECKED_ATTRIBUTE, "false");
    item.appendChild(ownerDocument.createElement("br"));
    list.appendChild(item);
  }
  target.appendChild(list);
}

export function normalizeEditorOrderedListAttributes(input: {
  markerType?: string | null;
  start?: string | null;
  reversed?: boolean;
}): EditorOrderedListAttributes {
  const rawMarkerType = input.markerType?.trim() ?? "";
  const markerType = ["1", "a", "A", "i", "I"].includes(rawMarkerType)
    ? rawMarkerType as EditorOrderedListAttributes["markerType"]
    : undefined;
  const parsedStart = Number.parseInt(input.start ?? "", 10);
  return {
    markerType,
    start: Number.isFinite(parsedStart) ? Math.max(-100000, Math.min(100000, parsedStart)) : undefined,
    reversed: input.reversed === true,
  };
}

function appendSanitizedOrderedList(source: HTMLElement, target: Node, ownerDocument: Document) {
  const list = ownerDocument.createElement("ol");
  list.setAttribute(EDITOR_ORDERED_LIST_ATTRIBUTE, "true");
  const attributes = normalizeEditorOrderedListAttributes({
    markerType: source.getAttribute("type"),
    start: source.getAttribute("start"),
    reversed: source.hasAttribute("reversed"),
  });
  if (attributes.markerType) list.setAttribute("type", attributes.markerType);
  if (attributes.start !== undefined) list.setAttribute("start", String(attributes.start));
  if (attributes.reversed) list.setAttribute("reversed", "");
  Array.from(source.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === "li")
    .forEach((sourceItem) => {
      const item = ownerDocument.createElement("li");
      appendSanitizedChildren(sourceItem, item, ownerDocument);
      if (item.childNodes.length === 0) item.appendChild(ownerDocument.createElement("br"));
      list.appendChild(item);
    });
  if (list.children.length === 0) {
    const item = ownerDocument.createElement("li");
    item.appendChild(ownerDocument.createElement("br"));
    list.appendChild(item);
  }
  target.appendChild(list);
}

function wrapRootEditorListItems(fragment: DocumentFragment, ownerDocument: Document) {
  let activeList: HTMLUListElement | null = null;
  let activeKind: EditorListKind | null = null;
  Array.from(fragment.childNodes).forEach((child) => {
    const kind = child instanceof HTMLLIElement ? readEditorListKind(child.getAttribute(EDITOR_LIST_ITEM_ATTRIBUTE)) : null;
    if (!kind) {
      activeList = null;
      activeKind = null;
      return;
    }
    if (!activeList || activeKind !== kind) {
      activeList = ownerDocument.createElement("ul");
      activeList.setAttribute(EDITOR_LIST_ATTRIBUTE, kind);
      fragment.insertBefore(activeList, child);
      activeKind = kind;
    }
    activeList.appendChild(child);
  });
}

function editorListMarkerStyleForDepth(depth: number): EditorListMarkerStyle {
  const normalizedDepth = Math.max(1, Math.round(depth));
  const cycleIndex = (normalizedDepth - 1) % 4;
  if (cycleIndex === 1) return "hollow-circle";
  if (cycleIndex === 2) return "solid-square";
  if (cycleIndex === 3) return "hollow-square";
  return "solid-circle";
}

function editorListDepthForItem(item: HTMLElement): number {
  let depth = 0;
  let current = item.parentElement;
  while (current) {
    if (current instanceof HTMLUListElement && readEditorListKind(current.getAttribute(EDITOR_LIST_ATTRIBUTE))) {
      depth += 1;
    }
    current = current.parentElement;
  }
  return Math.max(1, depth);
}

export function applyEditorListMarkerStyles(root: ParentNode) {
  root.querySelectorAll(`li[${EDITOR_LIST_ITEM_ATTRIBUTE}]`).forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.getAttribute(EDITOR_LIST_ITEM_ATTRIBUTE) !== "bullet") {
      node.removeAttribute(EDITOR_LIST_MARKER_ATTRIBUTE);
      return;
    }
    node.setAttribute(EDITOR_LIST_MARKER_ATTRIBUTE, editorListMarkerStyleForDepth(editorListDepthForItem(node)));
  });
}

function appendSanitizedChildren(source: Node, target: Node, ownerDocument: Document) {
  source.childNodes.forEach((child) => appendSanitizedNode(child, target, ownerDocument));
}

function readSafeImageStylePixels(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function readMigratedStandaloneAttachmentImageData(element: HTMLElement) {
  const src = element.getAttribute("src")?.trim() ?? "";
  const attachmentID = editorAttachmentIDFromImageSource(src);
  if (!attachmentID) return null;
  const width = readSafeImageStylePixels(element.style.width, 220, 48, 960);
  const height = readSafeImageStylePixels(element.style.height, 160, 36, 1_600);
  return { src, attachmentID, width, height };
}

function formatSafeCSSNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function normalizeSafeIndentLength(value: string): string {
  const match = /^([0-9]+(?:\.[0-9]+)?)(px|pt|em|rem|ch|%)$/i.exec(value.trim());
  if (!match) return "";
  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  const unit = match[2].toLowerCase();
  const maxByUnit: Record<string, number> = {
    px: 320,
    pt: 240,
    em: 24,
    rem: 24,
    ch: 48,
    "%": 70,
  };
  const clamped = Math.min(parsed, maxByUnit[unit] ?? 0);
  if (clamped <= 0) return "";
  return `${formatSafeCSSNumber(clamped)}${unit}`;
}

function safeBlockIndentForElement(element: HTMLElement, tagName: string): string {
  const indent = normalizeSafeIndentLength(element.style.marginLeft)
    || normalizeSafeIndentLength(element.style.paddingLeft);
  if (indent) return indent;
  return tagName === "blockquote" ? "40px" : "";
}

function appendSanitizedIndentedBlock(element: HTMLElement, target: Node, ownerDocument: Document, indent: string) {
  const block = ownerDocument.createElement("div");
  block.style.marginLeft = indent;
  appendSanitizedChildren(element, block, ownerDocument);
  target.appendChild(block);
  target.appendChild(ownerDocument.createTextNode("\n"));
}

function appendSanitizedAlignedBlock(element: HTMLElement, target: Node, ownerDocument: Document, align: EditorTextAlignment, indent = "") {
  const block = ownerDocument.createElement("div");
  applyEditorTextAlign(block, align);
  if (indent) block.style.marginLeft = indent;
  appendSanitizedChildren(element, block, ownerDocument);
  target.appendChild(block);
}
const EDITOR_HEADING_FONT_SIZE_PX: Readonly<Record<string, number>> = {
  h1: 28,
  h2: 24,
  h3: 20,
  h4: 18,
  h5: 16,
  h6: 14,
};

function appendSanitizedHeading(element: HTMLElement, target: Node, ownerDocument: Document, tagName: string) {
  const block = ownerDocument.createElement("div");
  const align = readEditorTextAlign(element);
  if (align) applyEditorTextAlign(block, align);
  const indent = safeBlockIndentForElement(element, tagName);
  if (indent) block.style.marginLeft = indent;
  const fontSize = ownerDocument.createElement("span");
  fontSize.style.fontSize = `${EDITOR_HEADING_FONT_SIZE_PX[tagName] ?? 14}px`;
  const strong = ownerDocument.createElement("strong");
  appendSanitizedChildren(element, strong, ownerDocument);
  fontSize.appendChild(strong);
  block.appendChild(fontSize);
  target.appendChild(block);
  target.appendChild(ownerDocument.createTextNode("\n"));
}

function appendSanitizedNode(source: Node, target: Node, ownerDocument: Document) {
  if (source.nodeType === Node.TEXT_NODE) {
    target.appendChild(ownerDocument.createTextNode(normalizeEditorArrowLigatureText(source.textContent ?? "")));
    return;
  }
  if (source.nodeType !== Node.ELEMENT_NODE) return;

  const element = source as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  if (
    element.getAttribute(EDITOR_TABLE_ALIGNMENT_CONTROL_ATTRIBUTE) === "true"
    || element.hasAttribute(EDITOR_TABLE_ALIGNMENT_ACTION_ATTRIBUTE)
  ) {
    return;
  }
  if (element.getAttribute(EDITOR_TABLE_ATTRIBUTE) === "true" && tagName !== "table") {
    appendSanitizedEditorGridTable(element, target, ownerDocument);
    return;
  }

  if (element.getAttribute(EDITOR_TABLE_CELL_ATTRIBUTE) === "true") {
    target.appendChild(ownerDocument.createTextNode(normalizeNativeTableCellText(element.textContent ?? "")));
    return;
  }

  if (tagName === "br") {
    const br = ownerDocument.createElement("br");
    if (element.getAttribute(EDITOR_TERMINAL_BREAK_ATTRIBUTE) === "true") {
      br.setAttribute(EDITOR_TERMINAL_BREAK_ATTRIBUTE, "true");
    }
    if (element.getAttribute(EDITOR_IMAGE_CLEAR_BREAK_ATTRIBUTE) === "true") {
      br.setAttribute(EDITOR_IMAGE_CLEAR_BREAK_ATTRIBUTE, "true");
      br.setAttribute("clear", "all");
      br.style.clear = "both";
    }
    target.appendChild(br);
    return;
  }

  const entityLink = readEditorEntityLinkElement(element);
  if (entityLink) {
    target.appendChild(createEditorEntityLinkElement(ownerDocument, entityLink));
    return;
  }

  if (tagName === "a") {
    const href = normalizeEditorURL(element.getAttribute("href") ?? "");
    if (!href) {
      appendSanitizedChildren(element, target, ownerDocument);
      return;
    }
    const anchor = ownerDocument.createElement("a");
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.style.color = EDITOR_LINK_COLOR;
    anchor.style.textDecoration = "underline";
    anchor.style.cursor = "pointer";
    appendSanitizedChildren(element, anchor, ownerDocument);
    target.appendChild(anchor);
    return;
  }

  if (tagName === "img") {
    const imageData = readMigratedStandaloneAttachmentImageData(element);
    if (imageData) {
      target.appendChild(createEditorImageFrame(ownerDocument, imageData, { durable: true }));
    }
    return;
  }

  if (tagName === "span" || tagName === "mark") {
    const imageData = readEditorImageData(element);
    if (imageData) {
      target.appendChild(createEditorImageFrame(ownerDocument, imageData, { durable: true }));
      return;
    }
    const legacyMentionUserID = element.getAttribute("data-mention-user-id")?.trim() ?? "";
    if (isEditorMentionElement(element) || legacyMentionUserID) {
      const span = ownerDocument.createElement("span");
      const mentionKind = element.getAttribute(EDITOR_MENTION_KIND_ATTRIBUTE)?.trim() ?? "";
      if (mentionKind === "urgent") span.setAttribute(EDITOR_MENTION_KIND_ATTRIBUTE, mentionKind);
      applyEditorMentionStyle(span);
      const userID = element.getAttribute(EDITOR_MENTION_USER_ID_ATTRIBUTE)?.trim() || legacyMentionUserID;
      if (userID) span.setAttribute(EDITOR_MENTION_USER_ID_ATTRIBUTE, userID);
      appendSanitizedChildren(element, span, ownerDocument);
      target.appendChild(span);
      return;
    }
    const span = ownerDocument.createElement("span");
    applySafeFontSize(element, span);
    applySafeHighlight(element, span);
    appendSanitizedChildren(element, span, ownerDocument);
    target.appendChild(span);
    return;
  }

  if (tagName === "b" || tagName === "strong" || tagName === "u" || tagName === "i" || tagName === "em" || tagName === "s" || tagName === "strike" || tagName === "del") {
    const inline = ownerDocument.createElement(tagName === "strike" || tagName === "del" ? "s" : tagName);
    appendSanitizedChildren(element, inline, ownerDocument);
    target.appendChild(inline);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(EDITOR_HEADING_FONT_SIZE_PX, tagName)) {
    appendSanitizedHeading(element, target, ownerDocument, tagName);
    return;
  }


  if (tagName === "table") {
    appendNativeTableAsEditorTable(element, target, ownerDocument);
    return;
  }

  if (tagName === "thead" || tagName === "tbody") {
    appendSanitizedChildren(element, target, ownerDocument);
    return;
  }

  if (tagName === "ul") {
    appendSanitizedEditorList(element, target, ownerDocument, "bullet");
    return;
  }

  if (tagName === "ol") {
    appendSanitizedOrderedList(element, target, ownerDocument);
    return;
  }

  if (tagName === "tr") {
    const rowCells = Array.from(element.children)
      .filter((child): child is HTMLElement => (
        child instanceof HTMLElement && (child.tagName === "TD" || child.tagName === "TH")
      ))
      .slice(0, EDITOR_TABLE_MAX_COLUMNS)
      .map((cell) => cell);
    if (rowCells.length > 0) {
      target.appendChild(createSanitizedEditorTableFromCells([rowCells], ownerDocument));
      return;
    }
    appendSanitizedChildren(element, target, ownerDocument);
    return;
  }

  if (tagName === "td" || tagName === "th") {
    target.appendChild(ownerDocument.createTextNode(normalizeNativeTableCellText(element.textContent ?? "")));
    return;
  }

  if (tagName === "blockquote" || tagName === "div" || tagName === "p") {
    const align = readEditorTextAlign(element);
    const indent = safeBlockIndentForElement(element, tagName);
    if (align) {
      appendSanitizedAlignedBlock(element, target, ownerDocument, align, indent);
      return;
    }
    if (indent) {
      appendSanitizedIndentedBlock(element, target, ownerDocument, indent);
      return;
    }
    appendSanitizedChildren(element, target, ownerDocument);
    target.appendChild(ownerDocument.createTextNode("\n"));
    return;
  }

  appendSanitizedChildren(element, target, ownerDocument);
}

function hasSafeFontSize(element: HTMLElement): boolean {
  const parsed = Number.parseFloat(element.style.fontSize.trim());
  return Number.isFinite(parsed) && parsed >= 6 && parsed <= 96;
}

function isEmptyTextNode(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim();
}

function collapseRedundantFontSizeSpans(root: HTMLElement) {
  let changed = true;
  while (changed) {
    changed = false;
    const spans = Array.from(root.querySelectorAll("span")) as HTMLSpanElement[];
    for (const span of spans) {
      if (span.getAttribute(EDITOR_IMAGE_NODE_ATTRIBUTE) === "true") continue;
      if (!hasSafeFontSize(span)) continue;
      if (readEditorElementHighlight(span).explicit) continue;
      const meaningfulChildren = Array.from(span.childNodes).filter((child) => !isEmptyTextNode(child));
      if (meaningfulChildren.length !== 1) continue;
      const onlyChild = meaningfulChildren[0];
      if (!(onlyChild instanceof HTMLSpanElement) || !hasSafeFontSize(onlyChild)) continue;
      span.replaceWith(onlyChild);
      changed = true;
    }
  }
}

function trimEditorPasteBoundaryWhitespace(root: HTMLElement) {
  const first = root.firstChild;
  if (first?.nodeType === Node.TEXT_NODE) {
    first.textContent = (first.textContent ?? "").replace(/^\n+/, "");
    if (!first.textContent) first.remove();
  }

  const last = root.lastChild;
  if (last?.nodeType === Node.TEXT_NODE) {
    last.textContent = (last.textContent ?? "").replace(/\n+$/, "");
    if (!last.textContent) last.remove();
  }
}

function normalizeSafeFontSizeValue(value: string): string {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 6 || parsed > 96) return "";
  return Number.isInteger(parsed) ? String(parsed) : String(parsed);
}

function collapseRedundantFontSizeSpanHTML(html: string): string {
  const nestedFontSpan = /<span\s+style=(["'])font-size:\s*([0-9]+(?:\.[0-9]+)?)px;?\1>\s*<span\s+style=(["'])font-size:\s*([0-9]+(?:\.[0-9]+)?)px;?\3>((?:(?!<span\b|<\/span>)[\s\S])*)<\/span>\s*<\/span>/gi;
  let next = html;
  let changed = true;
  while (changed) {
    changed = false;
    next = next.replace(nestedFontSpan, (match, _outerQuote: string, _outerSize: string, _innerQuote: string, innerSize: string, content: string) => {
      const safeInnerSize = normalizeSafeFontSizeValue(innerSize);
      if (!safeInnerSize) return match;
      changed = true;
      return `<span style="font-size: ${safeInnerSize}px;">${content}</span>`;
    });
  }
  return next;
}

function canonicalizeEditorStrikethroughHTML(html: string): string {
  return html.replace(/<(\/?)\s*(?:s|strike|del)\b[^>]*>/gi, (_match, closing: string) => (
    closing ? "</s>" : "<s>"
  ));
}

export function sanitizeEditorDocumentHTML(html: string): string {
  if (typeof document === "undefined") return collapseRedundantFontSizeSpanHTML(canonicalizeEditorStrikethroughHTML(html));
  const template = document.createElement("template");
  template.innerHTML = html;
  wrapRootEditorListItems(template.content, document);
  const clean = document.createElement("div");
  appendSanitizedChildren(template.content, clean, document);
  trimEditorPasteBoundaryWhitespace(clean);
  collapseRedundantFontSizeSpans(clean);
  normalizeEditorHighlightSpans(clean);
  applyEditorListMarkerStyles(clean);
  return collapseRedundantFontSizeSpanHTML(canonicalizeEditorStrikethroughHTML(clean.innerHTML));
}

export function deserializeEditorDocumentHTML(storedDocument: string): string {
  if (!storedDocument) return "";
  if (storedDocument.startsWith(EDITOR_RICH_TEXT_PREFIX)) {
    return sanitizeEditorDocumentHTML(storedDocument.slice(EDITOR_RICH_TEXT_PREFIX.length));
  }
  return linkifyEditorPlainTextToHTML(storedDocument);
}

export function normalizeEditorWhitespaceText(value: string): string {
  return value.replace(/\u00a0/g, " ");
}

const EDITOR_EMAIL_BODY_STYLE = "font:14px/1.5 Arial,sans-serif;color:#111827;white-space:pre-wrap;overflow-wrap:anywhere;";
const EDITOR_EMAIL_BODY_HTML_PATTERN = /<\/?[a-z][\s\S]*>/i;

function editorEmailHTMLWithExplicitLineBreaks(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "<br>");
}

function plainEditorTextToEmailHTML(value: string): string {
  return editorEmailHTMLWithExplicitLineBreaks(linkifyEditorPlainTextToHTML(value));
}

function richEditorDocumentToEmailHTML(value: string): string {
  return editorEmailHTMLWithExplicitLineBreaks(sanitizeEditorDocumentHTML(value.slice(EDITOR_RICH_TEXT_PREFIX.length)));
}

export function serializeEditorBodyForEmailHTML(value: string): string {
  if (!value.trim()) return "";
  const html = value.startsWith(EDITOR_RICH_TEXT_PREFIX)
    ? richEditorDocumentToEmailHTML(value)
    : plainEditorTextToEmailHTML(value);
  return `<div ${EDITOR_EMAIL_BODY_ATTRIBUTE}="true" style="${EDITOR_EMAIL_BODY_STYLE}">${html}</div>`;
}

export function isMangoEditorEmailBodyHTML(value: string): boolean {
  return value.includes(`${EDITOR_EMAIL_BODY_ATTRIBUTE}="true"`) || value.includes(`${EDITOR_EMAIL_BODY_ATTRIBUTE}='true'`);
}

export function editorEmailDisplayDocument(body: string, options: { compact?: boolean; baseTarget?: boolean } = {}): string {
  const value = body.trim();
  const content = EDITOR_EMAIL_BODY_HTML_PATTERN.test(value)
    ? value
    : `<pre ${EDITOR_EMAIL_BODY_ATTRIBUTE}="plain">${linkifyEditorPlainTextToHTML(value)}</pre>`;
  const padding = options.compact ? "6px 0 2px" : "14px";
  const base = options.baseTarget ? `<base target="_blank">` : "";
  return `<!doctype html><html><head><meta charset="utf-8">${base}<style>html{margin:0;padding:0}body{font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#111;margin:0;padding:${padding};overflow-wrap:anywhere}pre{white-space:pre-wrap;font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;margin:0}[${EDITOR_EMAIL_BODY_ATTRIBUTE}]{white-space:pre-wrap!important;overflow-wrap:anywhere!important}[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"]{max-width:100%!important;height:auto!important;aspect-ratio:auto!important}[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"] img{max-width:100%!important;height:auto!important}img{max-width:100%;height:auto}p{margin-top:0}a{color:${EDITOR_LINK_COLOR};text-decoration:underline;text-decoration-thickness:1.5px;text-underline-offset:2px;font-weight:650;cursor:pointer}a:hover{color:#0c4a6e}</style></head><body>${content}</body></html>`;
}

export function editorBodyHasEmailContent(value: string): boolean {
  const body = value.trim();
  if (!body) return false;
  if (!body.startsWith(EDITOR_RICH_TEXT_PREFIX)) return true;
  const richHTML = body.slice(EDITOR_RICH_TEXT_PREFIX.length);
  if (/<(?:img|table|ol|ul|li|hr)\b/i.test(richHTML)) return true;
  if (/\bdata-mango-(?:mention|entity-link|editor-(?:image|table|list|list-item))\s*=/i.test(richHTML)) return true;
  return richHTML
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim()
    .length > 0;
}

const EDITOR_TEXT_BLOCK_TAGS = new Set(["DIV", "P", "LI", "TABLE"]);
const EDITOR_TABLE_CELL_TAGS = new Set(["TD", "TH"]);

export function readEditorDocumentText(root: HTMLElement): string {
  let text = "";
  const readNodePlainText = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    if (node.getAttribute(EDITOR_TABLE_ALIGNMENT_CONTROL_ATTRIBUTE) === "true") return "";
    if (node.tagName === "BR") return "\n";
    let value = "";
    node.childNodes.forEach((child) => {
      value += readNodePlainText(child);
    });
    return value;
  };
  const appendNodeText = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.getAttribute(EDITOR_TABLE_ALIGNMENT_CONTROL_ATTRIBUTE) === "true") return;
    if (node.tagName === "BR") {
      text += "\n";
      return;
    }
    if (node.tagName === "TR") {
      const rowCells = Array.from(node.children)
        .filter((child): child is HTMLElement => (
          child instanceof HTMLElement && EDITOR_TABLE_CELL_TAGS.has(child.tagName)
        ))
        .map((cell) => normalizeNativeTableCellText(readNodePlainText(cell)));
      if (rowCells.length > 0) {
        if (text && !text.endsWith("\n")) text += "\n";
        text += `| ${rowCells.map((cell) => cell || " ").join(" | ")} |`;
        if (!text.endsWith("\n")) text += "\n";
        return;
      }
      if (text && !text.endsWith("\n")) text += "\n";
      node.childNodes.forEach(appendNodeText);
      if (text.endsWith("\t")) text = text.slice(0, -1);
      if (!text.endsWith("\n")) text += "\n";
      return;
    }
    if (EDITOR_TABLE_CELL_TAGS.has(node.tagName)) {
      node.childNodes.forEach(appendNodeText);
      return;
    }
    if (node.getAttribute(EDITOR_TABLE_ATTRIBUTE) === "true") {
      const columns = readEditorGridTableColumns(node);
      const cells = directEditorGridTableCells(node);
      const rows = Math.max(1, Math.ceil(Math.max(1, cells.length) / columns));
      const rowCells = Array.from({ length: rows }, () => Array.from({ length: columns }, () => ""));
      cells.forEach((cell, index) => {
        const rowIndex = Math.floor(index / columns);
        const columnIndex = index % columns;
        if (!rowCells[rowIndex]) return;
        rowCells[rowIndex][columnIndex] = normalizeNativeTableCellText(readNodePlainText(cell));
      });
      if (text && !text.endsWith("\n")) text += "\n";
      text += editorPlainTextTableLinesFromCells(rowCells, rows, columns).join("\n");
      if (!text.endsWith("\n")) text += "\n";
      return;
    }
    if (node.getAttribute(EDITOR_TABLE_CELL_ATTRIBUTE) === "true") {
      node.childNodes.forEach(appendNodeText);
      return;
    }
    const isBlock = EDITOR_TEXT_BLOCK_TAGS.has(node.tagName);
    if (isBlock && text && !text.endsWith("\n")) text += "\n";
    node.childNodes.forEach(appendNodeText);
    if (isBlock && !text.endsWith("\n")) text += "\n";
  };
  root.childNodes.forEach(appendNodeText);
  if (text.endsWith("\n")) text = text.slice(0, -1);
  return normalizeEditorWhitespaceText(text);
}

export function serializeEditorDocumentHTML(root: HTMLElement): string {
  const html = sanitizeEditorDocumentHTML(root.innerHTML);
  if (!readEditorDocumentText(root).trim() && !html.trim()) return "";
  return `${EDITOR_RICH_TEXT_PREFIX}${html}`;
}
