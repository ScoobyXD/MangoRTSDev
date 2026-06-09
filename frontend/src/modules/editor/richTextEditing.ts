import {
  createEditorImageFrame,
  EDITOR_IMAGE_NODE_ATTRIBUTE,
  readEditorImageData,
} from "./editorImages.js";
import {
  applyEditorMentionStyle,
  EDITOR_MENTION_USER_ID_ATTRIBUTE,
  isEditorMentionElement,
} from "./editorMentions.js";

export const EDITOR_DOCUMENT_BOTTOM_BUFFER_LINES = 20;
export const EDITOR_RICH_TEXT_PREFIX = "<!-- mango-editor-html-v1 -->";
export const EDITOR_LINK_COLOR = "rgb(51, 65, 85)";
export const EDITOR_TERMINAL_BREAK_ATTRIBUTE = "data-mango-editor-terminal-break";
export const EDITOR_IMAGE_CLEAR_BREAK_ATTRIBUTE = "data-mango-editor-image-clear";
export const EDITOR_TABLE_ATTRIBUTE = "data-mango-editor-table";
export const EDITOR_TABLE_CELL_ATTRIBUTE = "data-mango-editor-table-cell";
export const EDITOR_TABLE_COLUMNS_ATTRIBUTE = "data-mango-editor-table-columns";

const EDITOR_TABLE_MAX_ROWS = 20;
const EDITOR_TABLE_MAX_COLUMNS = 8;
const EDITOR_TABLE_MAX_CELL_TEXT_LENGTH = 2000;

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
    output += escapeEditorHTML(value.slice(lastIndex, matchIndex));
    output += href ? editorLinkHTML(urlText, href) : escapeEditorHTML(urlText);
    output += escapeEditorHTML(trailingText);
    lastIndex = matchIndex + matchedText.length;
  }
  output += escapeEditorHTML(value.slice(lastIndex));
  return output;
}

function applySafeFontSize(source: HTMLElement, target: HTMLElement) {
  const fontSize = source.style.fontSize.trim();
  if (!fontSize) return;
  const parsed = Number.parseFloat(fontSize);
  if (!Number.isFinite(parsed) || parsed < 6 || parsed > 96) return;
  target.style.fontSize = `${Math.round(parsed)}px`;
}

function applySafeTableElementStyle(element: HTMLElement, tagName: string) {
  if (tagName === "table") {
    element.style.borderCollapse = "collapse";
    element.style.width = "100%";
    element.style.margin = "8px 0";
    element.style.tableLayout = "fixed";
    return;
  }
  if (tagName === "td" || tagName === "th") {
    element.style.border = "1px solid rgba(100, 116, 139, 0.36)";
    element.style.padding = "6px 8px";
    element.style.verticalAlign = "top";
    if (tagName === "th") element.style.fontWeight = "800";
  }
}

function clampEditorTableSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readEditorGridTableColumns(element: HTMLElement, fallback = 3): number {
  const raw = Number.parseInt(element.getAttribute(EDITOR_TABLE_COLUMNS_ATTRIBUTE) ?? "", 10);
  return clampEditorTableSize(raw || fallback, 1, EDITOR_TABLE_MAX_COLUMNS);
}

function applyEditorGridTableStyle(element: HTMLElement, columns: number) {
  element.setAttribute(EDITOR_TABLE_ATTRIBUTE, "true");
  element.setAttribute(EDITOR_TABLE_COLUMNS_ATTRIBUTE, String(columns));
  element.style.display = "grid";
  element.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  element.style.width = "100%";
  element.style.maxWidth = "100%";
  element.style.margin = "8px 0";
  element.style.borderTop = "1px solid rgba(100, 116, 139, 0.36)";
  element.style.borderLeft = "1px solid rgba(100, 116, 139, 0.36)";
  element.style.background = "#ffffff";
  element.style.boxSizing = "border-box";
  element.style.overflow = "hidden";
}

function applyEditorGridTableCellStyle(element: HTMLElement) {
  element.setAttribute(EDITOR_TABLE_CELL_ATTRIBUTE, "true");
  element.style.display = "block";
  element.style.minWidth = "0";
  element.style.minHeight = "30px";
  element.style.borderRight = "1px solid rgba(100, 116, 139, 0.36)";
  element.style.borderBottom = "1px solid rgba(100, 116, 139, 0.36)";
  element.style.padding = "6px 8px";
  element.style.whiteSpace = "pre-wrap";
  element.style.overflowWrap = "anywhere";
  element.style.boxSizing = "border-box";
}

function directEditorGridTableCells(element: HTMLElement): HTMLElement[] {
  return Array.from(element.children).filter((child): child is HTMLElement => (
    child instanceof HTMLElement && child.getAttribute(EDITOR_TABLE_CELL_ATTRIBUTE) === "true"
  ));
}

export function createEditorGridTableElement(ownerDocument: Document, rows = 3, columns = 3): HTMLElement {
  const safeRows = clampEditorTableSize(rows, 1, EDITOR_TABLE_MAX_ROWS);
  const safeColumns = clampEditorTableSize(columns, 1, EDITOR_TABLE_MAX_COLUMNS);
  const table = ownerDocument.createElement("div");
  applyEditorGridTableStyle(table, safeColumns);
  for (let index = 0; index < safeRows * safeColumns; index += 1) {
    const cell = ownerDocument.createElement("span");
    applyEditorGridTableCellStyle(cell);
    cell.appendChild(ownerDocument.createElement("br"));
    table.appendChild(cell);
  }
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

function appendNativeTableAsEditorGridTable(source: HTMLElement, target: Node, ownerDocument: Document) {
  const sourceRows = Array.from(source.querySelectorAll("tr")).slice(0, EDITOR_TABLE_MAX_ROWS);
  const rowCells = sourceRows.map((row) => (
    Array.from(row.children)
      .filter((child): child is HTMLElement => (
        child instanceof HTMLElement && (child.tagName === "TD" || child.tagName === "TH")
      ))
      .slice(0, EDITOR_TABLE_MAX_COLUMNS)
  ));
  const columns = clampEditorTableSize(Math.max(1, ...rowCells.map((cells) => cells.length)), 1, EDITOR_TABLE_MAX_COLUMNS);
  const rows = clampEditorTableSize(Math.max(1, rowCells.length), 1, EDITOR_TABLE_MAX_ROWS);
  const table = createEditorGridTableElement(ownerDocument, rows, columns);
  const cells = directEditorGridTableCells(table);
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
      const sourceCell = rowCells[rowIndex]?.[columnIndex];
      const targetCell = cells[(rowIndex * columns) + columnIndex];
      if (!sourceCell || !targetCell) continue;
      const text = normalizeNativeTableCellText(sourceCell.textContent ?? "");
      targetCell.replaceChildren(text ? ownerDocument.createTextNode(text) : ownerDocument.createElement("br"));
    }
  }
  target.appendChild(table);
}

function appendSanitizedEditorGridTable(source: HTMLElement, target: Node, ownerDocument: Document) {
  const requestedColumns = readEditorGridTableColumns(source);
  const sourceCells = directEditorGridTableCells(source).slice(0, EDITOR_TABLE_MAX_ROWS * EDITOR_TABLE_MAX_COLUMNS);
  const rows = clampEditorTableSize(Math.max(1, Math.ceil(Math.max(1, sourceCells.length) / requestedColumns)), 1, EDITOR_TABLE_MAX_ROWS);
  const table = createEditorGridTableElement(ownerDocument, rows, requestedColumns);
  const targetCells = directEditorGridTableCells(table);
  sourceCells.forEach((sourceCell, index) => {
    const targetCell = targetCells[index];
    if (!targetCell) return;
    targetCell.replaceChildren();
    appendSanitizedChildren(sourceCell, targetCell, ownerDocument);
    if (targetCell.childNodes.length === 0) targetCell.appendChild(ownerDocument.createElement("br"));
  });
  target.appendChild(table);
}

function appendSanitizedChildren(source: Node, target: Node, ownerDocument: Document) {
  source.childNodes.forEach((child) => appendSanitizedNode(child, target, ownerDocument));
}

function appendSanitizedNode(source: Node, target: Node, ownerDocument: Document) {
  if (source.nodeType === Node.TEXT_NODE) {
    target.appendChild(ownerDocument.createTextNode(source.textContent ?? ""));
    return;
  }
  if (source.nodeType !== Node.ELEMENT_NODE) return;

  const element = source as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  if (element.getAttribute(EDITOR_TABLE_ATTRIBUTE) === "true") {
    appendSanitizedEditorGridTable(element, target, ownerDocument);
    return;
  }

  if (element.getAttribute(EDITOR_TABLE_CELL_ATTRIBUTE) === "true") {
    const cell = ownerDocument.createElement("span");
    applyEditorGridTableCellStyle(cell);
    appendSanitizedChildren(element, cell, ownerDocument);
    if (cell.childNodes.length === 0) cell.appendChild(ownerDocument.createElement("br"));
    target.appendChild(cell);
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

  if (tagName === "span") {
    const imageData = readEditorImageData(element);
    if (imageData) {
      target.appendChild(createEditorImageFrame(ownerDocument, imageData));
      return;
    }
    if (isEditorMentionElement(element)) {
      const span = ownerDocument.createElement("span");
      applyEditorMentionStyle(span);
      const userID = element.getAttribute(EDITOR_MENTION_USER_ID_ATTRIBUTE)?.trim() ?? "";
      if (userID) span.setAttribute(EDITOR_MENTION_USER_ID_ATTRIBUTE, userID);
      appendSanitizedChildren(element, span, ownerDocument);
      target.appendChild(span);
      return;
    }
    const span = ownerDocument.createElement("span");
    applySafeFontSize(element, span);
    appendSanitizedChildren(element, span, ownerDocument);
    target.appendChild(span);
    return;
  }

  if (tagName === "b" || tagName === "strong" || tagName === "u" || tagName === "i" || tagName === "em") {
    const inline = ownerDocument.createElement(tagName);
    appendSanitizedChildren(element, inline, ownerDocument);
    target.appendChild(inline);
    return;
  }

  if (tagName === "table") {
    appendNativeTableAsEditorGridTable(element, target, ownerDocument);
    return;
  }

  if (tagName === "thead" || tagName === "tbody" || tagName === "tr" || tagName === "td" || tagName === "th") {
    const tableElement = ownerDocument.createElement(tagName);
    applySafeTableElementStyle(tableElement, tagName);
    appendSanitizedChildren(element, tableElement, ownerDocument);
    target.appendChild(tableElement);
    return;
  }

  if (tagName === "div" || tagName === "p") {
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
      const meaningfulChildren = Array.from(span.childNodes).filter((child) => !isEmptyTextNode(child));
      if (meaningfulChildren.length !== 1) continue;
      const onlyChild = meaningfulChildren[0];
      if (!(onlyChild instanceof HTMLSpanElement) || !hasSafeFontSize(onlyChild)) continue;
      span.replaceWith(onlyChild);
      changed = true;
    }
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

export function sanitizeEditorDocumentHTML(html: string): string {
  if (typeof document === "undefined") return collapseRedundantFontSizeSpanHTML(html);
  const template = document.createElement("template");
  template.innerHTML = html;
  const clean = document.createElement("div");
  appendSanitizedChildren(template.content, clean, document);
  collapseRedundantFontSizeSpans(clean);
  return collapseRedundantFontSizeSpanHTML(clean.innerHTML);
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

const EDITOR_TEXT_BLOCK_TAGS = new Set(["DIV", "P", "LI", "TABLE"]);
const EDITOR_TABLE_CELL_TAGS = new Set(["TD", "TH"]);

export function readEditorDocumentText(root: HTMLElement): string {
  let text = "";
  const appendNodeText = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      text += "\n";
      return;
    }
    if (node.tagName === "TR") {
      if (text && !text.endsWith("\n")) text += "\n";
      node.childNodes.forEach(appendNodeText);
      if (text.endsWith("\t")) text = text.slice(0, -1);
      if (!text.endsWith("\n")) text += "\n";
      return;
    }
    if (EDITOR_TABLE_CELL_TAGS.has(node.tagName)) {
      node.childNodes.forEach(appendNodeText);
      text += "\t";
      return;
    }
    if (node.getAttribute(EDITOR_TABLE_ATTRIBUTE) === "true") {
      const columns = readEditorGridTableColumns(node);
      const cells = directEditorGridTableCells(node);
      if (text && !text.endsWith("\n")) text += "\n";
      cells.forEach((cell, index) => {
        cell.childNodes.forEach(appendNodeText);
        if ((index + 1) % columns === 0) {
          if (!text.endsWith("\n")) text += "\n";
        } else {
          text += "\t";
        }
      });
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
