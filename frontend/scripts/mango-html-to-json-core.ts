import { createHash } from "node:crypto";
import type { JSONContent } from "@tiptap/core";
import { generateHTML, generateJSON } from "@tiptap/html/server";
import { Window } from "happy-dom";
import { normalizeEditorHighlightColor } from "../src/modules/editor/richTextEditing.js";
import { createMangoTiptapExtensions } from "../src/modules/editor/tiptap/mangoTiptapExtensions.js";
import {
  MANGO_TIPTAP_FORMAT,
  MANGO_TIPTAP_SCHEMA_VERSION,
  type MangoTiptapDocument,
  validateMangoTiptapDocument,
} from "../src/modules/editor/tiptap/mangoTiptapDocument.js";

const LEGACY_HTML_PREFIX = "<!-- mango-editor-html-v1 -->";
const BLOCK_NODE_NAMES = new Set([
  "paragraph", "heading", "blockquote", "codeBlock", "horizontalRule",
  "bulletList", "orderedList", "listItem", "taskList", "taskItem", "table",
]);
const UNSAFE_ELEMENTS = "script,style,iframe,object,embed,link,meta,base";

export type MangoHTMLConversionCounts = {
  textCharacters: number;
  paragraphs: number;
  headings: number;
  bulletLists: number;
  orderedLists: number;
  taskLists: number;
  listItems: number;
  tables: number;
  links: number;
  bold: number;
  italic: number;
  underline: number;
  strike: number;
  highlights: number;
  mentions: number;
  entityLinks: number;
  attachmentImages: number;
};

export type MangoHTMLConversionResult = {
  document: MangoTiptapDocument;
  normalizedHTML: string;
  roundTripHTML: string;
  sourceSHA256: string;
  sourceMD5: string;
  normalizedText: string;
  sourceCounts: MangoHTMLConversionCounts;
  jsonCounts: MangoHTMLConversionCounts;
  warnings: string[];
};

export type MangoLegacyAttachmentMetadata = {
  attachmentId: string;
  sourceResourceAttachmentId?: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width?: number | null;
  height?: number | null;
  relationshipKind?: string;
};

export type MangoHTMLConversionOptions = {
  attachments?: readonly MangoLegacyAttachmentMetadata[];
};
export type MangoQuoteAnnotationInput = {
  id: string;
  quote: string;
};

export type MangoMappedAnnotation = {
  id: string;
  kind: "chat";
  from: number;
  to: number;
};


function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedText(value: string): string {
  return value.normalize("NFC").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function unescapeLegacyTagAttributeQuotes(html: string): string {
  let result = "";
  let inTag = false;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < html.length; index += 1) {
    const character = html[index];
    if (!inTag) {
      if (character === "<" && /[A-Za-z!/?]/.test(html[index + 1] ?? "")) inTag = true;
      result += character;
      continue;
    }
    if (character === "\\" && (html[index + 1] === '"' || html[index + 1] === "'")) {
      const escapedQuote = html[index + 1] as '"' | "'";
      result += escapedQuote;
      quote = quote === escapedQuote ? null : quote ?? escapedQuote;
      index += 1;
      continue;
    }
    result += character;
    if (character === '"' || character === "'") quote = quote === character ? null : quote ?? character;
    if (character === ">" && quote === null) inTag = false;
  }
  return result;
}

const HTML_BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "div", "figure", "figcaption", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav",
  "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

function collectHTMLText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "mango-attachment-image") return "\n";
  const content = Array.from(element.childNodes).map(collectHTMLText).join("");
  return HTML_BLOCK_TAGS.has(tag) ? `\n${content}\n` : content;
}

function safeNumber(value: string | null | undefined): number | null {
  const parsed = Number.parseFloat(value?.trim() ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function legacyAttachmentID(src: string): string {
  const clean = src.trim();
  if (!clean.startsWith("mango-attachment:")) return "";
  const encoded = clean.slice("mango-attachment:".length);
  try {
    return decodeURIComponent(encoded).trim();
  } catch {
    return encoded.trim();
  }
}

function setOptionalAttribute(element: Element, name: string, value: unknown): void {
  if (value === null || value === undefined || value === "") return;
  element.setAttribute(name, String(value));
}

function normalizedImageMimeType(value: string): string {
  const clean = value.trim().toLowerCase();
  if (clean === "image/jpg") return "image/jpeg";
  return /^image\/(jpeg|png|gif|webp)$/.test(clean) ? clean : "";
}

function inferredImageMimeType(filename: string): string {
  const clean = filename.trim().toLowerCase();
  if (/\.jpe?g$/.test(clean)) return "image/jpeg";
  if (/\.png$/.test(clean)) return "image/png";
  if (/\.gif$/.test(clean)) return "image/gif";
  if (/\.webp$/.test(clean)) return "image/webp";
  return "";
}

function dataImageFingerprint(source: string): { mimeType: string; byteSize: number; sha256: string } | null {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(source.trim());
  if (!match) return null;
  const mimeType = normalizedImageMimeType(match[1]);
  if (!mimeType) return null;
  try {
    const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
    if (bytes.length === 0) return null;
    return { mimeType, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch {
    return null;
  }
}

function attachmentPreference(metadata: MangoLegacyAttachmentMetadata): number {
  if (metadata.relationshipKind === "inline_image") return 0;
  if (metadata.relationshipKind === "migrated_inline_image") return 1;
  if (metadata.relationshipKind === "file_attachment") return 2;
  return 3;
}

function normalizeLegacyImages(
  root: Element,
  document: Document,
  attachments: readonly MangoLegacyAttachmentMetadata[],
): void {
  const sortedAttachments = [...attachments].sort((left, right) =>
    attachmentPreference(left) - attachmentPreference(right)
    || left.attachmentId.localeCompare(right.attachmentId)
    || String(left.sourceResourceAttachmentId ?? "").localeCompare(String(right.sourceResourceAttachmentId ?? ""))
  );
  const frames = Array.from(root.querySelectorAll('span[data-mango-editor-image="true"]'));
  for (const frame of frames) {
    const image = frame.querySelector("img");
    const source = image?.getAttribute("src")?.trim() ?? "";
    const linkedAnchor = frame.closest("a[href]");
    const linkHref = linkedAnchor?.getAttribute("href")?.trim() ?? "";
    const directAttachmentID = frame.getAttribute("data-mango-editor-attachment-id")?.trim()
      || legacyAttachmentID(source);
    const fingerprint = directAttachmentID ? null : dataImageFingerprint(source);
    const metadata = directAttachmentID
      ? sortedAttachments.find((item) => item.attachmentId === directAttachmentID)
      : fingerprint
        ? sortedAttachments.find((item) => item.byteSize === fingerprint.byteSize && item.sha256 === fingerprint.sha256)
        : undefined;
    const attachmentID = directAttachmentID || metadata?.attachmentId || "";
    if (!attachmentID) {
      throw new Error("Legacy image has no permanent attachment ID; conversion stopped before storing a temporary image URL.");
    }
    const converted = document.createElement("mango-attachment-image");
    converted.setAttribute("data-attachment-id", attachmentID);
    const filename = frame.getAttribute("data-mango-editor-filename")?.trim() || metadata?.filename || "";
    const mimeType = normalizedImageMimeType(frame.getAttribute("data-mango-editor-mime-type") ?? "")
      || normalizedImageMimeType(metadata?.mimeType ?? "")
      || fingerprint?.mimeType
      || inferredImageMimeType(filename);
    if (!mimeType) throw new Error(`Legacy image attachment ${attachmentID} has no supported image MIME type.`);
    setOptionalAttribute(converted, "data-filename", filename);
    converted.setAttribute("data-mime-type", mimeType);
    const width = safeNumber((frame as HTMLElement).style.width || image?.getAttribute("width")) ?? metadata?.width ?? null;
    const height = safeNumber((frame as HTMLElement).style.height || image?.getAttribute("height")) ?? metadata?.height ?? null;
    setOptionalAttribute(converted, "data-width", width);
    setOptionalAttribute(converted, "data-height", height);
    setOptionalAttribute(converted, "data-display-width", width);
    setOptionalAttribute(converted, "data-display-height", height);
    const floatSide = (frame as HTMLElement).style.float.trim().toLowerCase();
    converted.setAttribute("data-alignment", floatSide === "right" ? "right" : "left");
    converted.setAttribute("data-position", "break");
    converted.setAttribute("data-layout", "content");
    setOptionalAttribute(converted, "aria-label", image?.getAttribute("alt")?.trim());
    setOptionalAttribute(converted, "title", image?.getAttribute("title")?.trim());
    if (linkHref && /^(https?:|mailto:|tel:|\/|#)/i.test(linkHref)) {
      converted.setAttribute("data-link-href", linkHref);
      setOptionalAttribute(converted, "data-link-target", linkedAnchor?.getAttribute("target")?.trim());
      setOptionalAttribute(converted, "data-link-rel", linkedAnchor?.getAttribute("rel")?.trim());
      setOptionalAttribute(converted, "data-link-title", linkedAnchor?.getAttribute("title")?.trim());
    }
    frame.replaceWith(converted);
  }

  const remainingImages = Array.from(root.querySelectorAll("img"));
  if (remainingImages.length > 0) {
    throw new Error(`Found ${remainingImages.length} image(s) without Mango attachment wrappers; conversion stopped to avoid losing them.`);
  }
}

function hasMeaningfulInlineContent(node: Node): boolean {
  if (node.nodeType === 3) return Boolean(node.textContent?.trim());
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  return element.tagName.toLowerCase() === "br" || Boolean(element.textContent?.trim()) || element.childElementCount > 0;
}

function normalizeBlocksInsideInlineElements(root: Element): void {
  const selector = `${[...HTML_BLOCK_TAGS].join(",")},mango-attachment-image`;
  while (true) {
    const block = Array.from(root.querySelectorAll(selector)).find((element) => {
      const parent = element.parentElement;
      return parent && parent !== root && !HTML_BLOCK_TAGS.has(parent.tagName.toLowerCase());
    });
    if (!block) return;
    const wrapper = block.parentElement!;
    const parent = wrapper.parentNode;
    if (!parent) return;
    const before = wrapper.cloneNode(false) as Element;
    while (wrapper.firstChild && wrapper.firstChild !== block) before.appendChild(wrapper.firstChild);
    const after = wrapper.cloneNode(false) as Element;
    while (block.nextSibling) after.appendChild(block.nextSibling);
    if (hasMeaningfulInlineContent(before)) parent.insertBefore(before, wrapper);
    parent.insertBefore(block, wrapper);
    if (hasMeaningfulInlineContent(after)) parent.insertBefore(after, wrapper);
    wrapper.remove();
  }
}

function isBlockElement(node: Node): boolean {
  return node.nodeType === 1 && (
    HTML_BLOCK_TAGS.has((node as Element).tagName.toLowerCase())
    || (node as Element).tagName.toLowerCase() === "mango-attachment-image"
  );
}

function normalizeLegacyListItems(root: Element, document: Document): void {
  for (const item of Array.from(root.querySelectorAll("li"))) {
    let paragraph: Element | null = null;
    for (const child of Array.from(item.childNodes)) {
      if (isBlockElement(child)) {
        paragraph = null;
        continue;
      }
      if (child.nodeType === 8) continue;
      if (!paragraph && !hasMeaningfulInlineContent(child)) {
        child.remove();
        continue;
      }
      if (!paragraph) {
        paragraph = document.createElement("p");
        item.insertBefore(paragraph, child);
      }
      paragraph.appendChild(child);
    }
    if (item.firstElementChild?.tagName.toLowerCase() !== "p") {
      item.insertBefore(document.createElement("p"), item.firstChild);
    }
  }
}

function normalizeRootInlineRuns(root: Element, document: Document): void {
  let paragraph: Element | null = null;
  for (const child of Array.from(root.childNodes)) {
    const isBlock = child.nodeType === 1 && (
      HTML_BLOCK_TAGS.has((child as Element).tagName.toLowerCase())
      || (child as Element).tagName.toLowerCase() === "mango-attachment-image"
    );
    if (isBlock) {
      paragraph = null;
      continue;
    }
    if (child.nodeType === 8) continue;
    if (!paragraph && !hasMeaningfulInlineContent(child)) {
      child.remove();
      continue;
    }
    if (!paragraph) {
      paragraph = document.createElement("p");
      root.insertBefore(paragraph, child);
    }
    paragraph.appendChild(child);
  }
  const hasBlock = Array.from(root.children).some((child) =>
    HTML_BLOCK_TAGS.has(child.tagName.toLowerCase()) || child.tagName.toLowerCase() === "mango-attachment-image"
  );
  if (!hasBlock) root.appendChild(document.createElement("p"));
}

function normalizeLegacyMentions(root: Element): void {
  for (const mention of Array.from(root.querySelectorAll('span[data-mango-mention="true"]'))) {
    const userID = mention.getAttribute("data-mango-mention-user-id")?.trim() ?? "";
    if (!userID) throw new Error("Legacy mention has no user ID.");
    const visible = (mention.textContent ?? "").trim();
    const rawKind = mention.getAttribute("data-mango-mention-kind")?.trim().toLowerCase();
    const kind = rawKind === "urgent" || visible.startsWith("!") ? "urgent" : "normal";
    const label = mention.getAttribute("data-mango-user-label")?.trim()
      || visible.replace(/^[@!]/, "").trim()
      || "user";
    mention.setAttribute("data-type", "mention");
    mention.setAttribute("data-mango-user-id", userID);
    mention.setAttribute("data-mango-user-label", label);
    mention.setAttribute("data-mango-mention-kind", kind);
  }
}

function normalizeLegacyLists(root: Element): void {
  for (const list of Array.from(root.querySelectorAll('ul[data-mango-editor-list="checklist"]'))) {
    list.setAttribute("data-type", "taskList");
    for (const item of Array.from(list.children)) {
      if (item.tagName.toLowerCase() !== "li") continue;
      item.setAttribute("data-type", "taskItem");
      item.setAttribute("data-checked", item.getAttribute("data-mango-editor-checklist-checked") === "true" ? "true" : "false");
    }
  }
}

function normalizeLegacyTextStyles(root: Element): void {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[style]"))) {
    const rawColor = element.style.color.trim();
    if (rawColor && !["inherit", "initial", "currentcolor", "transparent"].includes(rawColor.toLowerCase())) {
      const color = normalizeEditorHighlightColor(rawColor);
      if (!color) throw new Error(`Unsupported legacy text color: ${rawColor}`);
      element.style.color = color;
    }
    const rawFontSize = element.style.fontSize.trim();
    if (rawFontSize) {
      const fontSize = Number.parseFloat(rawFontSize);
      if (!Number.isFinite(fontSize) || fontSize < 10 || fontSize > 28) {
        throw new Error(`Legacy font size is outside the JSON editor range: ${rawFontSize}`);
      }
      element.style.fontSize = `${Math.round(fontSize)}px`;
    }
  }
}
function normalizeLegacyHighlights(root: Element, document: Document): void {
  const candidates = Array.from(root.querySelectorAll("span,mark"));
  for (const element of candidates) {
    const htmlElement = element as HTMLElement;
    const color = normalizeEditorHighlightColor(
      element.getAttribute("data-mango-editor-highlight") || htmlElement.style.backgroundColor,
    );
    if (!color) continue;
    if (element.tagName.toLowerCase() === "mark") {
      element.setAttribute("data-color", color);
      htmlElement.style.backgroundColor = color;
      continue;
    }
    const mark = document.createElement("mark");
    mark.setAttribute("data-color", color);
    mark.setAttribute("style", `background-color: ${color}`);
    while (element.firstChild) mark.appendChild(element.firstChild);
    element.appendChild(mark);
    element.removeAttribute("data-mango-editor-highlight");
    htmlElement.style.removeProperty("background-color");
  }
}

function normalizeLegacyTables(root: Element): void {
  for (const cell of Array.from(root.querySelectorAll("td,th"))) {
    const htmlCell = cell as HTMLElement;
    const align = cell.getAttribute("data-mango-editor-table-text-align")?.trim().toLowerCase()
      || htmlCell.style.textAlign.trim().toLowerCase();
    if (["left", "center", "right"].includes(align)) cell.setAttribute("data-mango-cell-align", align);
    const background = normalizeEditorHighlightColor(htmlCell.style.backgroundColor);
    if (background) cell.setAttribute("data-mango-cell-background", background);
  }
}


function normalizeVisibleLegacyRootNewlines(root: Element, document: Document): void {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType !== 3) continue;
    const value = child.textContent ?? "";
    if (!value.trim() || !/[\r\n]/.test(value)) continue;
    const lines = value.replace(/\r\n?/g, "\n").split("\n");
    const fragment = document.createDocumentFragment();
    lines.forEach((line, index) => {
      if (line) fragment.appendChild(document.createTextNode(line));
      if (index < lines.length - 1) fragment.appendChild(document.createElement("br"));
    });
    child.replaceWith(fragment);
  }
}

function normalizeLegacyHTML(
  storedHTML: string,
  options: MangoHTMLConversionOptions,
): { html: string; text: string; sourceCounts: MangoHTMLConversionCounts } {
  const prefixedHTML = storedHTML.startsWith(LEGACY_HTML_PREFIX)
    ? storedHTML.slice(LEGACY_HTML_PREFIX.length)
    : storedHTML;
  const html = unescapeLegacyTagAttributeQuotes(prefixedHTML);
  const window = new Window({ settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
    disableIframePageLoading: true,
    disableComputedStyleRendering: true,
  } });
  try {
    const document = window.document as unknown as Document;
    const root = document.createElement("div");
    root.innerHTML = html;
    for (const unsafe of Array.from(root.querySelectorAll(UNSAFE_ELEMENTS))) unsafe.remove();
    normalizeLegacyImages(root, document, options.attachments ?? []);
    normalizeLegacyMentions(root);
    normalizeLegacyLists(root);
    normalizeLegacyTextStyles(root);
    normalizeLegacyHighlights(root, document);
    normalizeLegacyTables(root);
    normalizeVisibleLegacyRootNewlines(root, document);
    normalizeBlocksInsideInlineElements(root);
    normalizeLegacyListItems(root, document);
    normalizeRootInlineRuns(root, document);
    const normalized = root.innerHTML;
    return {
      html: normalized,
      text: normalizedText(collectHTMLText(root)),
      sourceCounts: countNormalizedHTML(root),
    };
  } finally {
    window.happyDOM.abort();
    window.happyDOM.close();
  }
}

function emptyCounts(): MangoHTMLConversionCounts {
  return {
    textCharacters: 0, paragraphs: 0, headings: 0, bulletLists: 0, orderedLists: 0,
    taskLists: 0, listItems: 0, tables: 0, links: 0, bold: 0, italic: 0,
    underline: 0, strike: 0, highlights: 0, mentions: 0, entityLinks: 0,
    attachmentImages: 0,
  };
}

function countNormalizedHTML(root: Element): MangoHTMLConversionCounts {
  const counts = emptyCounts();
  counts.textCharacters = normalizedText(collectHTMLText(root)).length;
  counts.paragraphs = root.querySelectorAll("p").length;
  counts.headings = root.querySelectorAll("h1,h2,h3,h4,h5,h6").length;
  counts.taskLists = root.querySelectorAll('ul[data-type="taskList"]').length;
  counts.bulletLists = Array.from(root.querySelectorAll("ul")).filter((node) => node.getAttribute("data-type") !== "taskList").length;
  counts.orderedLists = root.querySelectorAll("ol").length;
  counts.listItems = root.querySelectorAll("li").length;
  counts.tables = root.querySelectorAll("table").length;
  const meaningfulCount = (selector: string): number => Array.from(root.querySelectorAll(selector))
    .filter((element) => Boolean(normalizedText(collectHTMLText(element)))).length;
  counts.links = meaningfulCount("a[href]") + root.querySelectorAll("mango-attachment-image[data-link-href]").length;
  counts.bold = meaningfulCount("strong,b");
  counts.italic = meaningfulCount("em,i");
  counts.underline = meaningfulCount("u");
  counts.strike = meaningfulCount("s,strike,del");
  counts.highlights = meaningfulCount("mark");
  counts.mentions = root.querySelectorAll('span[data-type="mention"]').length;
  counts.entityLinks = root.querySelectorAll('[data-mango-entity-link="true"]').length;
  counts.attachmentImages = root.querySelectorAll("mango-attachment-image[data-attachment-id]").length;
  return counts;
}

function deterministicBlockID(sourceHash: string, path: string, type: string): string {
  return `mango-import-${sha256(`${sourceHash}:${path}:${type}`).slice(0, 32)}`;
}

function normalizeGeneratedJSON(node: JSONContent): JSONContent {
  const result: JSONContent = { ...node };
  if (node.marks) {
    result.marks = node.marks.map((mark) => {
      if (mark.type === "textStyle") {
        const attrs: Record<string, unknown> = { ...mark.attrs };
        const rawColor = attrs.color;
        if (typeof rawColor === "string") {
          if (rawColor.trim()) {
            const color = normalizeEditorHighlightColor(rawColor);
            if (!color) throw new Error(`Unsupported generated textStyle color: ${rawColor}`);
            attrs.color = color;
          } else {
            delete attrs.color;
          }
        }
        const rawFontSize = attrs.fontSize;
        if (typeof rawFontSize === "string") {
          if (rawFontSize.trim()) {
            const fontSize = Number.parseFloat(rawFontSize);
            if (!Number.isFinite(fontSize) || fontSize < 10 || fontSize > 28) {
              throw new Error(`Generated font size is outside the JSON editor range: ${rawFontSize}`);
            }
            attrs.fontSize = `${Math.round(fontSize)}px`;
          } else {
            delete attrs.fontSize;
          }
        }
        return { ...mark, attrs };
      }
      if (mark.type === "highlight" && typeof mark.attrs?.color === "string") {
        const rawColor = mark.attrs.color.trim();
        if (!rawColor) return { ...mark, attrs: {} };
        const color = normalizeEditorHighlightColor(rawColor);
        if (!color) throw new Error(`Unsupported generated highlight color: ${rawColor}`);
        return { ...mark, attrs: { ...mark.attrs, color } };
      }
      return mark;
    });
  }
  if (node.type !== "text" && node.type !== "mention" && result.marks !== undefined) {
    if ((result.marks?.length ?? 0) > 0 && node.type !== "hardBreak") {
      throw new Error(`Generated ${node.type || "unknown"} node unexpectedly contains text marks.`);
    }
    delete result.marks;
  }
  if (node.content) result.content = node.content.map(normalizeGeneratedJSON);
  return result;
}

function addDeterministicBlockIDs(node: JSONContent, sourceHash: string, path = "0"): JSONContent {
  const result: JSONContent = { ...node };
  if (node.type && BLOCK_NODE_NAMES.has(node.type)) {
    result.attrs = { ...(node.attrs ?? {}), blockId: node.attrs?.blockId || deterministicBlockID(sourceHash, path, node.type) };
  }
  if (node.content) {
    result.content = node.content.map((child, index) => addDeterministicBlockIDs(child, sourceHash, `${path}.${index}`));
  }
  return result;
}

function collectJSONText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") {
    const kind = node.attrs?.kind === "urgent" ? "!" : "@";
    return `${kind}${String(node.attrs?.label || "user")}`;
  }
  if (node.type === "mangoEntityLink") return String(node.attrs?.label || "Entity");
  const content = (node.content ?? []).map(collectJSONText).join("");
  return BLOCK_NODE_NAMES.has(node.type ?? "") || ["doc", "tableRow", "tableCell", "tableHeader"].includes(node.type ?? "")
    ? `\n${content}\n`
    : content;
}

function countJSON(document: JSONContent): MangoHTMLConversionCounts {
  const counts = emptyCounts();
  const visit = (node: JSONContent): void => {
    const type = node.type ?? "";
    if (type === "text") counts.textCharacters += normalizedText(node.text ?? "").length;
    if (type === "paragraph") counts.paragraphs += 1;
    if (type === "heading") counts.headings += 1;
    if (type === "bulletList") counts.bulletLists += 1;
    if (type === "orderedList") counts.orderedLists += 1;
    if (type === "taskList") counts.taskLists += 1;
    if (type === "listItem" || type === "taskItem") counts.listItems += 1;
    if (type === "table") counts.tables += 1;
    if (type === "mention") counts.mentions += 1;
    if (type === "mangoEntityLink") counts.entityLinks += 1;
    if (type === "mangoAttachmentImage") {
      counts.attachmentImages += 1;
      if (typeof node.attrs?.linkHref === "string" && node.attrs.linkHref.trim()) counts.links += 1;
    }
    for (const mark of node.marks ?? []) {
      if (mark.type === "link") counts.links += 1;
      if (mark.type === "bold") counts.bold += 1;
      if (mark.type === "italic") counts.italic += 1;
      if (mark.type === "underline") counts.underline += 1;
      if (mark.type === "strike") counts.strike += 1;
      if (mark.type === "highlight") counts.highlights += 1;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(document);
  counts.textCharacters = normalizedText(collectJSONText(document)).length;
  return counts;
}

function assertPreserved(source: MangoHTMLConversionCounts, target: MangoHTMLConversionCounts): void {
  const exact: Array<keyof MangoHTMLConversionCounts> = [
    "taskLists", "bulletLists", "orderedLists", "listItems", "tables", "mentions",
    "entityLinks", "attachmentImages",
  ];
  const differences = exact.filter((name) => source[name] !== target[name]);
  const formatting: Array<keyof MangoHTMLConversionCounts> = ["links", "bold", "italic", "underline", "strike", "highlights"];
  differences.push(...formatting.filter((name) => source[name] > 0 && target[name] === 0));
  if (differences.length > 0) {
    throw new Error(`Conversion changed supported rich-text structures: ${differences.map((name) => `${name} ${source[name]} -> ${target[name]}`).join(", ")}`);
  }
}

export function convertMangoLegacyHTML(storedHTML: string, options: MangoHTMLConversionOptions = {}): MangoHTMLConversionResult {
  const sourceSHA256 = sha256(storedHTML);
  const sourceMD5 = createHash("md5").update(storedHTML, "utf8").digest("hex");
  const normalized = normalizeLegacyHTML(storedHTML, options);
  const extensions = createMangoTiptapExtensions({ editable: false });
  const generated = generateJSON(normalized.html, extensions) as JSONContent;
  const document: MangoTiptapDocument = {
    format: MANGO_TIPTAP_FORMAT,
    schema_version: MANGO_TIPTAP_SCHEMA_VERSION,
    document: addDeterministicBlockIDs(normalizeGeneratedJSON(generated), sourceSHA256),
  };
  const validation = validateMangoTiptapDocument(document);
  if (!validation.valid) throw new Error(`Mango JSON validation failed: ${validation.error}`);
  const convertedText = normalizedText(collectJSONText(document.document));
  if (normalized.text !== convertedText) {
    throw new Error(`Conversion changed visible text (source ${normalized.text.length} characters, JSON ${convertedText.length} characters).`);
  }
  const jsonCounts = countJSON(document.document);
  assertPreserved(normalized.sourceCounts, jsonCounts);
  const roundTripHTML = generateHTML(document.document, extensions);
  const roundTripJSON = generateJSON(roundTripHTML, extensions);
  const roundTripText = normalizedText(collectJSONText(roundTripJSON));
  if (roundTripText !== convertedText) throw new Error("Tiptap JSON-to-HTML round trip changed visible text.");
  return {
    document,
    normalizedHTML: normalized.html,
    roundTripHTML,
    sourceSHA256,
    sourceMD5,
    normalizedText: convertedText,
    sourceCounts: normalized.sourceCounts,
    jsonCounts,
    warnings: [],
  };
}
type PositionedCharacter = { character: string; from: number; to: number };

function jsonNodeSize(node: JSONContent): number {
  if (node.type === "text") return node.text?.length ?? 0;
  if (!node.content?.length) return 1;
  return 2 + node.content.reduce((total, child) => total + jsonNodeSize(child), 0);
}

function positionedDocumentText(document: JSONContent): PositionedCharacter[] {
  const raw: PositionedCharacter[] = [];
  const append = (character: string, from: number, to: number): void => {
    for (const item of character) raw.push({ character: item === "\u00a0" ? " " : item, from, to });
  };
  const visit = (node: JSONContent, position: number): void => {
    if (node.type === "text") {
      for (let index = 0; index < (node.text?.length ?? 0); index += 1) {
        append(node.text?.[index] ?? "", position + index, position + index + 1);
      }
      return;
    }
    if (node.type === "mention") {
      const trigger = node.attrs?.kind === "urgent" ? "!" : "@";
      append(trigger + String(node.attrs?.label || "user"), position, position + 1);
      return;
    }
    if (node.type === "mangoEntityLink") {
      append(String(node.attrs?.label || "Entity"), position, position + 1);
      return;
    }
    if (node.type === "hardBreak") {
      append(" ", position, position + 1);
      return;
    }
    if (["paragraph", "heading", "codeBlock"].includes(node.type ?? "") && raw.length > 0) {
      append(" ", position, position + 1);
    }
    let childPosition = position + (node.type === "doc" ? 0 : 1);
    for (const child of node.content ?? []) {
      visit(child, childPosition);
      childPosition += jsonNodeSize(child);
    }
  };
  visit(document, 0);

  const normalized: PositionedCharacter[] = [];
  for (const item of raw) {
    if (/\s/.test(item.character)) {
      if (normalized.length === 0) continue;
      const previous = normalized[normalized.length - 1];
      if (previous.character === " ") {
        previous.to = Math.max(previous.to, item.to);
      } else {
        normalized.push({ ...item, character: " " });
      }
      continue;
    }
    normalized.push(item);
  }
  while (normalized.at(-1)?.character === " ") normalized.pop();
  return normalized;
}

export function mapMangoQuoteAnnotations(
  document: MangoTiptapDocument,
  inputs: readonly MangoQuoteAnnotationInput[],
): { annotations: MangoMappedAnnotation[]; unmappedIDs: string[] } {
  const characters = positionedDocumentText(document.document);
  const documentText = characters.map((item) => item.character).join("");
  const annotations: MangoMappedAnnotation[] = [];
  const unmappedIDs: string[] = [];
  for (const input of inputs) {
    const quote = normalizedText(input.quote);
    if (!input.id.trim() || !quote) continue;
    const first = documentText.indexOf(quote);
    const second = first < 0 ? -1 : documentText.indexOf(quote, first + 1);
    if (first < 0 || second >= 0) {
      unmappedIDs.push(input.id);
      continue;
    }
    const start = characters[first];
    const end = characters[first + quote.length - 1];
    if (!start || !end || end.to <= start.from) {
      unmappedIDs.push(input.id);
      continue;
    }
    annotations.push({ id: input.id.trim(), kind: "chat", from: start.from, to: end.to });
  }
  return { annotations, unmappedIDs };
}
