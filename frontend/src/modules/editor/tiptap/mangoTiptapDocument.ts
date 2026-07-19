import type { JSONContent } from "@tiptap/core";

export const MANGO_TIPTAP_FORMAT = "mango-tiptap-json" as const;
export const MANGO_TIPTAP_SCHEMA_VERSION = 1 as const;
export const MANGO_TIPTAP_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

export type MangoTiptapDocument = {
  format: typeof MANGO_TIPTAP_FORMAT;
  schema_version: typeof MANGO_TIPTAP_SCHEMA_VERSION;
  document: JSONContent;
};

export type MangoTiptapValidationResult =
  | { valid: true; value: MangoTiptapDocument }
  | { valid: false; error: string };

const nodeAttributes: Readonly<Record<string, ReadonlySet<string>>> = {
  doc: new Set(),
  paragraph: new Set(["blockId", "textAlign", "indentLevel"]),
  heading: new Set(["blockId", "level", "textAlign", "indentLevel"]),
  blockquote: new Set(["blockId"]),
  codeBlock: new Set(["blockId", "language"]),
  horizontalRule: new Set(["blockId"]),
  text: new Set(),
  hardBreak: new Set(),
  bulletList: new Set(["blockId"]),
  orderedList: new Set(["blockId", "start"]),
  listItem: new Set(["blockId"]),
  taskList: new Set(["blockId"]),
  taskItem: new Set(["blockId", "checked"]),
  table: new Set(["blockId", "style"]),
  tableRow: new Set(),
  tableHeader: new Set(["colspan", "rowspan", "colwidth", "align", "backgroundColor"]),
  tableCell: new Set(["colspan", "rowspan", "colwidth", "align", "backgroundColor"]),
  mention: new Set(["userId", "label"]),
  mangoAttachmentImage: new Set([
    "attachmentId", "filename", "mimeType", "width", "height", "displayWidth",
    "displayHeight", "alignment", "position", "layout", "alt", "title",
  ]),
};

const markAttributes: Readonly<Record<string, ReadonlySet<string>>> = {
  bold: new Set(),
  italic: new Set(),
  underline: new Set(),
  strike: new Set(),
  code: new Set(),
  textStyle: new Set(["fontSize", "color"]),
  highlight: new Set(["color"]),
  link: new Set(["href", "target", "rel", "class", "title"]),
};

const inlineNodes = new Set(["text", "hardBreak", "mention"]);
const textContainers = new Set(["paragraph", "heading"]);
const blockNodes = new Set([
  "paragraph", "heading", "blockquote", "codeBlock", "horizontalRule", "bulletList",
  "orderedList", "taskList", "table", "mangoAttachmentImage",
]);
const blockContainers = new Set(["doc", "blockquote", "tableCell", "tableHeader"]);
const listContainers = new Set(["bulletList", "orderedList", "taskList"]);
const atomNodes = new Set(["text", "hardBreak", "horizontalRule", "mention", "mangoAttachmentImage"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeColor(value: unknown): boolean {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function positiveInteger(value: unknown, maximum = 100_000): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= maximum;
}

function validateAttributes(
  kind: string,
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return `${path}.attrs must be an object`;
  for (const [name, attribute] of Object.entries(value)) {
    if (!allowed.has(name)) return `${path}.attrs.${name} is not supported for ${kind}`;
    if (
      attribute !== null
      && typeof attribute !== "string"
      && typeof attribute !== "number"
      && typeof attribute !== "boolean"
      && !Array.isArray(attribute)
    ) return `${path}.attrs.${name} has an invalid value`;
    if (Array.isArray(attribute) && !attribute.every((item) => typeof item === "number" && Number.isFinite(item))) {
      return `${path}.attrs.${name} must contain only numbers`;
    }
  }
  const attrs = value as Record<string, unknown>;
  if (kind === "mention" && (typeof attrs.userId !== "string" || !attrs.userId.trim())) {
    return `${path}.attrs.userId is required`;
  }
  if (kind === "mangoAttachmentImage") {
    if (typeof attrs.attachmentId !== "string" || !attrs.attachmentId.trim()) return `${path}.attrs.attachmentId is required`;
    if (Object.values(attrs).some((attribute) => typeof attribute === "string" && /^(blob:|data:)/i.test(attribute))) {
      return `${path} cannot store transient Blob or data URLs`;
    }
  }
  if (kind === "link") {
    const href = attrs.href;
    if (typeof href !== "string" || !href.trim()) return `${path}.attrs.href is required`;
    if (!/^(https?:|mailto:|tel:|\/|#)/i.test(href.trim())) return `${path}.attrs.href uses an unsafe protocol`;
  }
  if (attrs.blockId !== undefined && attrs.blockId !== null && (typeof attrs.blockId !== "string" || !attrs.blockId.trim() || attrs.blockId.length > 160)) {
    return `${path}.attrs.blockId is invalid`;
  }
  if (attrs.indentLevel !== undefined && (!Number.isInteger(attrs.indentLevel) || Number(attrs.indentLevel) < 0 || Number(attrs.indentLevel) > 12)) {
    return `${path}.attrs.indentLevel must be an integer from 0 through 12`;
  }
  if (attrs.textAlign !== undefined && attrs.textAlign !== null && !["left", "center", "right"].includes(String(attrs.textAlign))) {
    return `${path}.attrs.textAlign is invalid`;
  }
  if (kind === "heading" && !positiveInteger(attrs.level, 6)) return `${path}.attrs.level must be from 1 through 6`;
  if (kind === "orderedList" && attrs.start !== undefined && attrs.start !== null && !positiveInteger(attrs.start)) return `${path}.attrs.start is invalid`;
  if (kind === "taskItem" && attrs.checked !== undefined && attrs.checked !== null && typeof attrs.checked !== "boolean") return `${path}.attrs.checked must be boolean`;
  if (kind === "table" && attrs.style !== undefined && attrs.style !== null && !["auto", "fixed"].includes(String(attrs.style))) return `${path}.attrs.style is invalid`;
  if (kind === "tableCell" || kind === "tableHeader") {
    if (attrs.colspan !== undefined && attrs.colspan !== null && !positiveInteger(attrs.colspan, 1_000)) return `${path}.attrs.colspan is invalid`;
    if (attrs.rowspan !== undefined && attrs.rowspan !== null && !positiveInteger(attrs.rowspan, 1_000)) return `${path}.attrs.rowspan is invalid`;
    if (attrs.colwidth !== undefined && attrs.colwidth !== null && (!Array.isArray(attrs.colwidth) || !attrs.colwidth.every((item) => positiveInteger(item)))) return `${path}.attrs.colwidth is invalid`;
    if (attrs.align !== undefined && attrs.align !== null && !["left", "center", "right"].includes(String(attrs.align))) return `${path}.attrs.align is invalid`;
    if (attrs.backgroundColor !== undefined && attrs.backgroundColor !== null && !safeColor(attrs.backgroundColor)) return `${path}.attrs.backgroundColor is invalid`;
  }
  if (kind === "textStyle") {
    if (attrs.fontSize !== undefined && attrs.fontSize !== null) {
      const match = typeof attrs.fontSize === "string" ? /^(\d+)px$/.exec(attrs.fontSize) : null;
      if (!match || Number(match[1]) < 10 || Number(match[1]) > 28) return `${path}.attrs.fontSize is invalid`;
    }
    if (attrs.color !== undefined && attrs.color !== null && !safeColor(attrs.color)) return `${path}.attrs.color is invalid`;
  }
  if (kind === "highlight" && attrs.color !== undefined && attrs.color !== null && !safeColor(attrs.color)) return `${path}.attrs.color is invalid`;
  if (kind === "mangoAttachmentImage") {
    if (typeof attrs.mimeType !== "string" || !/^image\/(jpeg|png|gif|webp)$/i.test(attrs.mimeType)) return `${path}.attrs.mimeType is invalid`;
    for (const name of ["width", "height", "displayWidth", "displayHeight"] as const) {
      if (attrs[name] !== undefined && attrs[name] !== null && !positiveInteger(attrs[name])) return `${path}.attrs.${name} is invalid`;
    }
    if (attrs.alignment !== undefined && attrs.alignment !== null && !["left", "center", "right"].includes(String(attrs.alignment))) return `${path}.attrs.alignment is invalid`;
    if (attrs.position !== undefined && attrs.position !== null && !["inline", "break"].includes(String(attrs.position))) return `${path}.attrs.position is invalid`;
    if (attrs.layout !== undefined && attrs.layout !== null && !["content", "wide"].includes(String(attrs.layout))) return `${path}.attrs.layout is invalid`;
  }
  return null;
}

function validateNode(value: unknown, path: string, depth: number, count: { value: number }): string | null {
  if (depth > 100) return `${path} is nested too deeply`;
  if (!isRecord(value)) return `${path} must be an object`;
  count.value += 1;
  if (count.value > 100_000) return "document contains too many nodes";
  const type = value.type;
  if (typeof type !== "string" || !(type in nodeAttributes)) return `${path}.type is unknown`;
  for (const key of Object.keys(value)) {
    if (!["type", "attrs", "content", "text", "marks"].includes(key)) return `${path} contains unsupported property ${key}`;
  }
  const attrError = validateAttributes(type, value.attrs, nodeAttributes[type], path);
  if (attrError) return attrError;
  if (type === "text") {
    if (typeof value.text !== "string") return `${path}.text is required`;
    if (value.content !== undefined) return `${path}.content is not valid on text`;
  } else if (value.text !== undefined) {
    return `${path}.text is only valid on text nodes`;
  }
  if (value.marks !== undefined) {
    if (type !== "text" && type !== "mention" || !Array.isArray(value.marks)) return `${path}.marks is invalid`;
    for (let index = 0; index < value.marks.length; index += 1) {
      const mark = value.marks[index];
      if (!isRecord(mark) || typeof mark.type !== "string" || !(mark.type in markAttributes)) {
        return `${path}.marks[${index}] is unknown`;
      }
      for (const key of Object.keys(mark)) if (!["type", "attrs"].includes(key)) return `${path}.marks[${index}] contains unsupported property ${key}`;
      const markError = validateAttributes(mark.type, mark.attrs, markAttributes[mark.type], `${path}.marks[${index}]`);
      if (markError) return markError;
    }
  }
  const content = value.content;
  if (content !== undefined && !Array.isArray(content)) return `${path}.content must be an array`;
  if (content === undefined) return type === "doc" ? `${path}.content is required` : null;
  if (atomNodes.has(type)) return `${path}.content is not valid on ${type}`;
  if (["doc", "blockquote", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "table", "tableRow", "tableCell", "tableHeader"].includes(type) && content.length === 0) {
    return `${path}.content cannot be empty for ${type}`;
  }
  for (let index = 0; index < content.length; index += 1) {
    const child = content[index];
    const childType = isRecord(child) ? child.type : undefined;
    if (textContainers.has(type) && (typeof childType !== "string" || !inlineNodes.has(childType))) {
      return `${path}.content[${index}] is not valid inside ${type}`;
    }
    if (type === "codeBlock" && childType !== "text") return `${path}.content[${index}] is not text`;
    if (listContainers.has(type) && childType !== (type === "taskList" ? "taskItem" : "listItem")) {
      return `${path}.content[${index}] is not a valid list item`;
    }
    if (type === "table" && childType !== "tableRow") return `${path}.content[${index}] is not a table row`;
    if (type === "tableRow" && childType !== "tableCell" && childType !== "tableHeader") {
      return `${path}.content[${index}] is not a table cell`;
    }
    if (blockContainers.has(type) && (typeof childType !== "string" || !blockNodes.has(childType))) {
      return `${path}.content[${index}] is not a valid block`;
    }
    if ((type === "listItem" || type === "taskItem") && (typeof childType !== "string" || !blockNodes.has(childType) || (index === 0 && childType !== "paragraph"))) {
      return `${path}.content[${index}] is not valid inside ${type}`;
    }
    const childError = validateNode(child, `${path}.content[${index}]`, depth + 1, count);
    if (childError) return childError;
  }
  return null;
}

export function createEmptyMangoTiptapDocument(): MangoTiptapDocument {
  return {
    format: MANGO_TIPTAP_FORMAT,
    schema_version: MANGO_TIPTAP_SCHEMA_VERSION,
    document: { type: "doc", content: [{ type: "paragraph" }] },
  };
}

export function validateMangoTiptapDocument(value: unknown): MangoTiptapValidationResult {
  if (!isRecord(value)) return { valid: false, error: "document envelope must be an object" };
  for (const key of Object.keys(value)) {
    if (!["format", "schema_version", "document"].includes(key)) return { valid: false, error: `document envelope contains unsupported property ${key}` };
  }
  if (value.format !== MANGO_TIPTAP_FORMAT) return { valid: false, error: "document format is not mango-tiptap-json" };
  if (value.schema_version !== MANGO_TIPTAP_SCHEMA_VERSION) return { valid: false, error: "document schema version is not supported" };
  if (!isRecord(value.document) || value.document.type !== "doc") return { valid: false, error: "document root must be doc" };
  const nodeError = validateNode(value.document, "document", 0, { value: 0 });
  if (nodeError) return { valid: false, error: nodeError };
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > MANGO_TIPTAP_MAX_DOCUMENT_BYTES) {
    return { valid: false, error: "document exceeds the two MiB limit" };
  }
  return { valid: true, value: value as MangoTiptapDocument };
}

export function parseMangoTiptapDocument(serialized: string): MangoTiptapValidationResult {
  if (!serialized.trim()) return { valid: false, error: "document is empty" };
  try {
    return validateMangoTiptapDocument(JSON.parse(serialized));
  } catch {
    return { valid: false, error: "document is not valid JSON" };
  }
}

export function serializeMangoTiptapDocument(value: MangoTiptapDocument): string {
  const result = validateMangoTiptapDocument(value);
  if (!result.valid) throw new Error(result.error);
  return JSON.stringify(result.value);
}
