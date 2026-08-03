import type { JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { incrementEditorRuntimeMetric } from "../editorRuntimeMetrics.js";

export const MANGO_TIPTAP_FORMAT = "mango-tiptap-json" as const;
export const MANGO_TIPTAP_SCHEMA_VERSION = 1 as const;

export type MangoTiptapDocument = {
  format: typeof MANGO_TIPTAP_FORMAT;
  schema_version: typeof MANGO_TIPTAP_SCHEMA_VERSION;
  document: JSONContent;
};

export type MangoTiptapValidationResult =
  | { valid: true; value: MangoTiptapDocument }
  | { valid: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createEmptyMangoTiptapDocument(): MangoTiptapDocument {
  return {
    format: MANGO_TIPTAP_FORMAT,
    schema_version: MANGO_TIPTAP_SCHEMA_VERSION,
    document: { type: "doc", content: [{ type: "paragraph" }] },
  };
}

/**
 * Checks only Mango's versioned envelope. Tiptap's configured ProseMirror schema
 * is the authority for node, mark, and cosmetic formatting validity.
 */
export function validateMangoTiptapDocument(value: unknown): MangoTiptapValidationResult {
  if (!isRecord(value)) return { valid: false, error: "document envelope must be an object" };
  for (const key of Object.keys(value)) {
    if (key !== "format" && key !== "schema_version" && key !== "document") {
      return { valid: false, error: `document envelope contains unsupported property ${key}` };
    }
  }
  if (value.format !== MANGO_TIPTAP_FORMAT) return { valid: false, error: "document format is not mango-tiptap-json" };
  if (value.schema_version !== MANGO_TIPTAP_SCHEMA_VERSION) return { valid: false, error: "document schema version is not supported" };
  if (!isRecord(value.document) || value.document.type !== "doc") return { valid: false, error: "document root must be doc" };
  if (value.document.content !== undefined && !Array.isArray(value.document.content)) {
    return { valid: false, error: "document content must be an array" };
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

type MangoTiptapAttributeSpecs = Record<string, { default?: unknown }> | undefined;

const mangoTiptapRequiredNodeAttributes: Readonly<Record<string, ReadonlySet<string>>> = {
  paragraph: new Set(["blockId"]),
  heading: new Set(["blockId"]),
  blockquote: new Set(["blockId"]),
  codeBlock: new Set(["blockId"]),
  horizontalRule: new Set(["blockId"]),
  bulletList: new Set(["blockId"]),
  orderedList: new Set(["blockId"]),
  listItem: new Set(["blockId"]),
  taskList: new Set(["blockId"]),
  taskItem: new Set(["blockId"]),
  table: new Set(["blockId"]),
  mention: new Set(["userId", "label"]),
  mangoEntityLink: new Set(["entityType", "entityId", "label"]),
  mangoAttachmentImage: new Set(["attachmentId"]),
};

function mangoTiptapJSONValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => mangoTiptapJSONValuesEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && mangoTiptapJSONValuesEqual(left[key], right[key]));
}

function compactMangoTiptapAttributes(
  attributes: Record<string, unknown> | undefined,
  specs: MangoTiptapAttributeSpecs,
  requiredAttributes?: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (!attributes) return undefined;
  const compact: Record<string, unknown> = {};
  Object.entries(attributes).forEach(([name, value]) => {
    const spec = specs?.[name];
    if (
      !requiredAttributes?.has(name)
      && spec
      && Object.prototype.hasOwnProperty.call(spec, "default")
      && mangoTiptapJSONValuesEqual(value, spec.default)
    ) return;
    compact[name] = value;
  });
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function compactMangoTiptapJSONContent(value: JSONContent, schema: Schema): JSONContent {
  const compact: JSONContent = { ...value };
  const attributes = compactMangoTiptapAttributes(
    value.attrs,
    value.type ? schema.nodes[value.type]?.spec.attrs : undefined,
    value.type ? mangoTiptapRequiredNodeAttributes[value.type] : undefined,
  );
  if (attributes) compact.attrs = attributes;
  else delete compact.attrs;
  if (value.content) compact.content = value.content.map((child) => compactMangoTiptapJSONContent(child, schema));
  if (value.marks) {
    compact.marks = value.marks.map((mark) => {
      const compactMark = { ...mark };
      const markAttributes = compactMangoTiptapAttributes(mark.attrs, schema.marks[mark.type]?.spec.attrs);
      if (markAttributes) compactMark.attrs = markAttributes;
      else delete compactMark.attrs;
      return compactMark;
    });
  }
  return compact;
}

/**
 * Removes optional attributes equal to defaults declared by the active editor
 * schema. Required durable identity always remains explicit in saved JSON.
 */
export function compactMangoTiptapDocument(value: MangoTiptapDocument, schema: Schema): MangoTiptapDocument {
  const result = validateMangoTiptapDocument(value);
  if (!result.valid) throw new Error(result.error);
  return { ...result.value, document: compactMangoTiptapJSONContent(result.value.document, schema) };
}

/** Used only by explicit export/legacy boundaries, never by the normal save path. */
export function serializeMangoTiptapDocument(value: MangoTiptapDocument): string {
  const result = validateMangoTiptapDocument(value);
  if (!result.valid) throw new Error(result.error);
  incrementEditorRuntimeMetric("full_document_serializations");
  return JSON.stringify(result.value);
}

export function needsMangoTiptapLegacyDateHeadingBreak(value: MangoTiptapDocument): boolean {
  const firstBlock = value.document.content?.[0];
  if (firstBlock?.type !== "paragraph") return false;
  const [dateNode, headingNode] = firstBlock.content ?? [];
  if (
    dateNode?.type !== "text"
    || !/^\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/.test(dateNode.text ?? "")
    || headingNode?.type !== "text"
  ) return false;
  return (headingNode.marks ?? []).some((mark) => mark.type === "bold");
}
