import type { JSONContent } from "@tiptap/core";
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
