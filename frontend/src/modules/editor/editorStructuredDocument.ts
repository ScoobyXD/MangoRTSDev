import Delta, { type AttributeMap, type EditorDeltaOp as Op } from "./quillDelta.js";

export type StructuredEditorOperation = { ops: Op[] };
export type StructuredEditorDocument = { ops: Op[] };

const BLOCK_TAGS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"]);
const INLINE_STYLE_FORBIDDEN = ["url(", "data:", "base64", "x-amz-", "secret_access_key", "awsaccesskeyid"];

function cloneAttributes(attributes?: AttributeMap): AttributeMap | undefined {
  return attributes ? structuredClone(attributes) : undefined;
}

function cloneOps(ops: Op[]): Op[] {
  return ops.map((op) => ({
    ...(typeof op.insert === "object" && op.insert !== null ? { insert: structuredClone(op.insert) } : { insert: op.insert }),
    delete: op.delete,
    retain: typeof op.retain === "object" && op.retain !== null ? structuredClone(op.retain) : op.retain,
    attributes: cloneAttributes(op.attributes),
  }));
}

function cleanStyle(value: string): string {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed || INLINE_STYLE_FORBIDDEN.some((item) => lower.includes(item))) return "";
  return trimmed.slice(0, 1000);
}

function safeURL(value: string): string {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed || lower.startsWith("javascript:") || lower.startsWith("data:") || lower.includes("x-amz-")) return "";
  return trimmed.slice(0, 2000);
}

function elementAttribute(element: Element, ...names: string[]): string {
  for (const name of names) {
    const value = element.getAttribute(name)?.trim();
    if (value) return value;
  }
  return "";
}

function inlineAttributes(element: Element, inherited: AttributeMap): AttributeMap {
  const next: AttributeMap = { ...inherited };
  const tag = element.tagName.toLowerCase();
  if (tag === "strong" || tag === "b") next.bold = true;
  if (tag === "em" || tag === "i") next.italic = true;
  if (tag === "u") next.underline = true;
  if (tag === "s" || tag === "strike") next.strike = true;
  const style = cleanStyle(element.getAttribute("style") ?? "");
  const lowerStyle = style.toLowerCase();
  if (/font-weight\s*:\s*(bold|[6-9]00)/.test(lowerStyle)) next.bold = true;
  if (/font-style\s*:\s*italic/.test(lowerStyle)) next.italic = true;
  if (/text-decoration[^;]*underline/.test(lowerStyle)) next.underline = true;
  if (/text-decoration[^;]*line-through/.test(lowerStyle)) next.strike = true;
  const highlight = elementAttribute(element, "data-mango-editor-highlight") ||
    (/background(?:-color)?\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim() ?? "");
  if (tag === "mark" || highlight) next.highlight = highlight || "#fef08a";
  const fontSize = /font-size\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim() ?? "";
  if (fontSize) next.font_size = fontSize.slice(0, 100);
  if (tag === "a") {
    const href = safeURL(element.getAttribute("href") ?? "");
    if (href) next.link = href;
  }
  const className = element.getAttribute("class")?.trim() ?? "";
  if (className && className.split(/\s+/).every((item) => item.startsWith("mango-"))) next.class = className.slice(0, 500);
  const spanStyle = tag === "span" ? style : "";
  if (spanStyle) next.span_style = spanStyle;
  return next;
}

function blockAttributes(element: Element, block: string): AttributeMap {
  const attributes: AttributeMap = { block };
  const style = cleanStyle(element.getAttribute("style") ?? "");
  const align = element.getAttribute("align")?.trim() ||
    (/text-align\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim() ?? "");
  if (align && ["left", "center", "right", "justify"].includes(align)) attributes.align = align;
  const marginLeft = /margin-left\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim() ?? "";
  if (marginLeft) attributes.margin_left = marginLeft.slice(0, 100);
  return attributes;
}

function attachmentValue(element: Element): Record<string, unknown> | null {
  let owner: Element | null = element;
  while (owner) {
    const attachmentID = elementAttribute(owner, "data-mango-editor-attachment-id", "data-mango-attachment-id") ||
      (owner.tagName.toLowerCase() === "img" && (owner.getAttribute("src") ?? "").startsWith("mango-attachment:")
        ? decodeURIComponent((owner.getAttribute("src") ?? "").slice("mango-attachment:".length))
        : "");
    if (attachmentID) {
      const image = element.tagName.toLowerCase() === "img" ? element : element.querySelector("img");
      return {
        attachment_id: attachmentID.slice(0, 160),
        alt: (image?.getAttribute("alt") ?? "").slice(0, 500),
        width: (image?.getAttribute("width") ?? owner.getAttribute("data-mango-editor-image-width") ?? "").slice(0, 40),
        height: (image?.getAttribute("height") ?? owner.getAttribute("data-mango-editor-image-height") ?? "").slice(0, 40),
        align: (owner.getAttribute("data-mango-editor-image-align") ?? "").slice(0, 40),
      };
    }
    owner = owner.parentElement;
  }
  return null;
}

function mentionValue(element: Element): Record<string, unknown> | null {
  const id = elementAttribute(element, "data-mention-user-id", "data-mango-mention-user-id", "data-mango-mention-id");
  if (!id) return null;
  return {
    id: id.slice(0, 160),
    label: (element.textContent ?? "").slice(0, 500),
    kind: elementAttribute(element, "data-mango-mention-kind").slice(0, 80),
  };
}

function parserDocument(): Document {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    throw new Error("editor_collaboration_dom_unavailable");
  }
  return document;
}

export function structuredEditorDocumentFromHTML(html: string): StructuredEditorDocument {
  if (!html) return { ops: [] };
  const owner = parserDocument();
  const root = owner.createElement("div");
  root.innerHTML = html;
  const delta = new Delta();
  let tableIndex = 0;

  const appendInline = (node: Node, attributes: AttributeMap = {}): void => {
    if (node.nodeType === 3) {
      if (node.nodeValue) delta.insert(node.nodeValue.replace(/\r/g, ""), Object.keys(attributes).length ? attributes : undefined);
      return;
    }
    if (!(node instanceof owner.defaultView!.Element)) return;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    const mention = mentionValue(element);
    if (mention) {
      delta.insert({ mention }, Object.keys(attributes).length ? attributes : undefined);
      return;
    }
    const attachment = attachmentValue(element);
    if (attachment && (tag === "img" || element.hasAttribute("data-mango-editor-image"))) {
      delta.insert({ attachment }, Object.keys(attributes).length ? attributes : undefined);
      return;
    }
    if (tag === "br") {
      delta.insert({ break: true }, Object.keys(attributes).length ? attributes : undefined);
      return;
    }
    const next = inlineAttributes(element, attributes);
    for (const child of Array.from(element.childNodes)) appendInline(child, next);
  };

  const appendLine = (element: Element, attributes: AttributeMap): void => {
    for (const child of Array.from(element.childNodes)) {
      if (child instanceof owner.defaultView!.Element && ["ul", "ol"].includes(child.tagName.toLowerCase())) continue;
      appendInline(child);
    }
    delta.insert("\n", attributes);
  };

  const appendList = (list: Element, indent: number): void => {
    const tag = list.tagName.toLowerCase();
    const mangoKind = elementAttribute(list, "data-mango-editor-list");
    const listKind = tag === "ol" ? "ordered" : mangoKind === "checklist" ? "checklist" : "bullet";
    for (const child of Array.from(list.children)) {
      if (child.tagName.toLowerCase() !== "li") continue;
      const attributes: AttributeMap = { block: "li", list: listKind, indent };
      if (child.getAttribute("data-mango-editor-checklist-checked") === "true") attributes.checked = true;
      appendLine(child, attributes);
      for (const nested of Array.from(child.children)) {
        if (["ul", "ol"].includes(nested.tagName.toLowerCase())) appendList(nested, indent + 1);
      }
    }
  };

  const appendTable = (table: Element): void => {
    const tableID = elementAttribute(table, "data-mango-editor-table-id") || "t" + String(tableIndex++);
    const rows = Array.from(table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr"));
    rows.forEach((row, rowIndex) => {
      Array.from(row.children).forEach((cell, cellIndex) => {
        if (!["td", "th"].includes(cell.tagName.toLowerCase())) return;
        appendLine(cell, {
          block: "table_cell", table_id: tableID, table_row: rowIndex, table_cell: cellIndex,
          table_header: cell.tagName.toLowerCase() === "th",
          rowspan: Number(cell.getAttribute("rowspan") ?? "1") || 1,
          colspan: Number(cell.getAttribute("colspan") ?? "1") || 1,
        });
      });
    });
  };

  const appendBlock = (element: Element): void => {
    const tag = element.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") { appendList(element, 0); return; }
    if (tag === "table") { appendTable(element); return; }
    if (tag === "div" && Array.from(element.children).some((child) => BLOCK_TAGS.has(child.tagName.toLowerCase()) || ["ul", "ol", "table"].includes(child.tagName.toLowerCase()))) {
      for (const child of Array.from(element.childNodes)) {
        if (child instanceof owner.defaultView!.Element) appendBlock(child);
        else appendInline(child);
      }
      return;
    }
    appendLine(element, blockAttributes(element, BLOCK_TAGS.has(tag) ? tag : "p"));
  };

  let fragmentOpen = false;
  const closeFragment = (): void => {
    if (!fragmentOpen) return;
    delta.insert("\n", { block: "fragment" });
    fragmentOpen = false;
  };
  for (const node of Array.from(root.childNodes)) {
    if (node instanceof owner.defaultView!.Element) {
      const tag = node.tagName.toLowerCase();
      if (BLOCK_TAGS.has(tag) || ["ul", "ol", "table"].includes(tag)) {
        closeFragment();
        appendBlock(node);
        continue;
      }
    }
    appendInline(node);
    fragmentOpen = true;
  }
  closeFragment();
  return { ops: cloneOps(delta.ops) };
}

function escapeHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrapInline(value: string, attributes?: AttributeMap): string {
  if (!attributes) return value;
  let html = value;
  const spanStyles: string[] = [];
  if (typeof attributes.font_size === "string") spanStyles.push("font-size: " + attributes.font_size);
  if (typeof attributes.span_style === "string") spanStyles.push(attributes.span_style);
  if (spanStyles.length) html = '<span style="' + escapeHTML(spanStyles.join("; ")) + '">' + html + "</span>";
  if (typeof attributes.link === "string") html = '<a href="' + escapeHTML(attributes.link) + '">' + html + "</a>";
  if (attributes.highlight) html = '<mark data-mango-editor-highlight="' + escapeHTML(String(attributes.highlight)) + '" style="background-color: ' + escapeHTML(String(attributes.highlight)) + ';">' + html + "</mark>";
  if (attributes.strike) html = "<s>" + html + "</s>";
  if (attributes.underline) html = "<u>" + html + "</u>";
  if (attributes.italic) html = "<em>" + html + "</em>";
  if (attributes.bold) html = "<strong>" + html + "</strong>";
  return html;
}

function embedHTML(insert: Record<string, unknown>, attributes?: AttributeMap): string {
  if (insert.break) return "<br>";
  const mention = insert.mention && typeof insert.mention === "object" ? insert.mention as Record<string, unknown> : null;
  if (mention) {
    const id = escapeHTML(String(mention.id ?? ""));
    const kind = mention.kind ? ' data-mango-mention-kind="' + escapeHTML(String(mention.kind)) + '"' : "";
    return wrapInline('<span data-mention-user-id="' + id + '"' + kind + ">" + escapeHTML(String(mention.label ?? "")) + "</span>", attributes);
  }
  const attachment = insert.attachment && typeof insert.attachment === "object" ? insert.attachment as Record<string, unknown> : null;
  if (attachment) {
    const id = escapeHTML(String(attachment.attachment_id ?? ""));
    const alt = escapeHTML(String(attachment.alt ?? ""));
    const width = attachment.width ? ' width="' + escapeHTML(String(attachment.width)) + '"' : "";
    const height = attachment.height ? ' height="' + escapeHTML(String(attachment.height)) + '"' : "";
    const align = attachment.align ? ' data-mango-editor-image-align="' + escapeHTML(String(attachment.align)) + '"' : "";
    return '<span data-mango-editor-image="true" data-mango-editor-attachment-id="' + id + '"' + align + '><img src="mango-attachment:' + encodeURIComponent(String(attachment.attachment_id ?? "")) + '" data-mango-attachment-id="' + id + '" alt="' + alt + '"' + width + height + "></span>";
  }
  return "";
}

type StructuredLine = { html: string; attributes: AttributeMap };

function structuredLines(documentState: StructuredEditorDocument): StructuredLine[] {
  const lines: StructuredLine[] = [];
  let inline = "";
  const finish = (attributes?: AttributeMap) => {
    lines.push({ html: inline, attributes: { ...(attributes ?? {}), block: attributes?.block ?? "fragment" } });
    inline = "";
  };
  for (const op of documentState.ops) {
    if (typeof op.insert === "string") {
      const parts = op.insert.split("\n");
      parts.forEach((part, index) => {
        if (part) inline += wrapInline(escapeHTML(part), op.attributes);
        if (index < parts.length - 1) finish(op.attributes);
      });
    } else if (op.insert && typeof op.insert === "object") inline += embedHTML(op.insert, op.attributes);
  }
  if (inline) finish({ block: "fragment" });
  return lines;
}

function listTag(kind: unknown): "ol" | "ul" {
  return kind === "ordered" ? "ol" : "ul";
}

function renderListLines(lines: StructuredLine[]): string {
  let html = "";
  const stack: Array<{ tag: "ol" | "ul"; indent: number; liOpen: boolean; kind: string }> = [];
  const closeTop = () => {
    const top = stack.pop();
    if (!top) return;
    if (top.liOpen) html += "</li>";
    html += "</" + top.tag + ">";
  };
  for (const line of lines) {
    const indent = Math.max(0, Number(line.attributes.indent ?? 0) || 0);
    const kind = String(line.attributes.list ?? "bullet");
    while (stack.length && stack[stack.length - 1].indent > indent) closeTop();
    if (stack.length && stack[stack.length - 1].indent === indent && stack[stack.length - 1].kind !== kind) closeTop();
    if (!stack.length || stack[stack.length - 1].indent < indent) {
      const tag = listTag(kind);
      const data = tag === "ul" ? ' data-mango-editor-list="' + escapeHTML(kind) + '"' : ' data-mango-editor-ordered-list="true"';
      html += "<" + tag + data + ">";
      stack.push({ tag, indent, liOpen: false, kind });
    }
    const top = stack[stack.length - 1];
    if (top.liOpen) html += "</li>";
    const checked = kind === "checklist" ? ' data-mango-editor-checklist-checked="' + (line.attributes.checked ? "true" : "false") + '"' : "";
    html += '<li data-mango-editor-list-item="' + escapeHTML(kind) + '"' + checked + ">" + (line.html || "<br>");
    top.liOpen = true;
  }
  while (stack.length) closeTop();
  return html;
}

function renderTableLines(lines: StructuredLine[]): string {
  const tableID = escapeHTML(String(lines[0]?.attributes.table_id ?? ""));
  let html = '<table data-mango-editor-table="true" data-mango-editor-table-id="' + tableID + '"><tbody>';
  let activeRow: number | null = null;
  for (const line of lines) {
    const row = Number(line.attributes.table_row ?? 0) || 0;
    if (row !== activeRow) {
      if (activeRow !== null) html += "</tr>";
      html += "<tr>";
      activeRow = row;
    }
    const tag = line.attributes.table_header ? "th" : "td";
    const rowspan = Math.max(1, Number(line.attributes.rowspan ?? 1) || 1);
    const colspan = Math.max(1, Number(line.attributes.colspan ?? 1) || 1);
    html += "<" + tag + (rowspan > 1 ? ' rowspan="' + rowspan + '"' : "") + (colspan > 1 ? ' colspan="' + colspan + '"' : "") + ">" + (line.html || "<br>") + "</" + tag + ">";
  }
  if (activeRow !== null) html += "</tr>";
  return html + "</tbody></table>";
}

export function structuredEditorDocumentToHTML(documentState: StructuredEditorDocument): string {
  const lines = structuredLines(documentState);
  let html = "";
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.attributes.table_id) {
      let end = index + 1;
      while (end < lines.length && lines[end].attributes.table_id === line.attributes.table_id) end += 1;
      html += renderTableLines(lines.slice(index, end));
      index = end;
      continue;
    }
    if (line.attributes.list) {
      let end = index + 1;
      while (end < lines.length && lines[end].attributes.list) end += 1;
      html += renderListLines(lines.slice(index, end));
      index = end;
      continue;
    }
    const block = String(line.attributes.block ?? "fragment").toLowerCase();
    if (block === "fragment") html += line.html;
    else {
      const tag = BLOCK_TAGS.has(block) ? block : "p";
      const style: string[] = [];
      if (typeof line.attributes.align === "string") style.push("text-align: " + line.attributes.align);
      if (typeof line.attributes.margin_left === "string") style.push("margin-left: " + line.attributes.margin_left);
      html += "<" + tag + (style.length ? ' style="' + escapeHTML(style.join("; ")) + '"' : "") + ">" + (line.html || "<br>") + "</" + tag + ">";
    }
    index += 1;
  }
  return html;
}

export function applyStructuredEditorOperation(state: StructuredEditorDocument, operation: StructuredEditorOperation): StructuredEditorDocument {
  return { ops: cloneOps(new Delta(state).compose(new Delta(operation)).ops) };
}

export function transformStructuredEditorOperation(committed: StructuredEditorOperation, concurrent: StructuredEditorOperation, committedHasPriority = true): StructuredEditorOperation {
  return { ops: cloneOps(new Delta(committed).transform(new Delta(concurrent), committedHasPriority).ops) };
}

export function structuredEditorOperationForHTML(state: StructuredEditorDocument, nextHTML: string): StructuredEditorOperation {
  const next = structuredEditorDocumentFromHTML(nextHTML);
  return { ops: cloneOps(new Delta(state).diff(new Delta(next)).ops) };
}

export function composeStructuredEditorOperations(left: StructuredEditorOperation, right: StructuredEditorOperation): StructuredEditorOperation {
  return { ops: cloneOps(new Delta(left).compose(new Delta(right)).ops) };
}

export function structuredEditorOperationEmpty(operation: StructuredEditorOperation): boolean {
  return operation.ops.length === 0;
}

export function structuredEditorDocumentLength(state: StructuredEditorDocument): number {
  return new Delta(state).length();
}
