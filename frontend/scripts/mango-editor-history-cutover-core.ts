import { isDeepStrictEqual } from "node:util";
import type { MangoTiptapDocument } from "../src/modules/editor/tiptap/mangoTiptapDocument.js";
import { validateMangoTiptapDocument } from "../src/modules/editor/tiptap/mangoTiptapDocument.js";
import { convertMangoLegacyHTML, type MangoLegacyAttachmentMetadata } from "./mango-html-to-json-core.js";

const NODE_TEXTBOX_PREFIX = "<!-- mango-node-text-block-v1 -->";
const PROJECT_SAVE_PREFIX = "MANGO_PROJECT_SAVE_V1:";

export type JSONRecord = Record<string, unknown>;

export type RecycleConversionStats = {
  nodeCurrent: number;
  projectCurrent: number;
  logicGateCurrent: number;
  nodeHistory: number;
  projectHistory: number;
  logicGateHistory: number;
  automaticHistoryDiscarded: number;
};

function record(value: unknown, message: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as JSONRecord;
}

function rows(value: unknown): JSONRecord[] {
  return Array.isArray(value) ? value.map((item) => record(item, "Recycle payload row must be an object.")) : [];
}

function text(row: JSONRecord, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function requiredText(row: JSONRecord, key: string): string {
  const value = text(row, key).trim();
  if (!value) throw new Error(`Legacy row is missing ${key}.`);
  return value;
}

function integer(row: JSONRecord, key: string, fallback = 0): number {
  const value = row[key];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  return fallback;
}

function timestamp(row: JSONRecord, key: string, fallbackKey?: string): string {
  const value = text(row, key).trim() || (fallbackKey ? text(row, fallbackKey).trim() : "");
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(`Legacy row has an invalid ${key}.`);
  return value;
}

function projectionDocument(information: string): string {
  if (!information.startsWith(NODE_TEXTBOX_PREFIX)) return information;
  const payload = record(JSON.parse(information.slice(NODE_TEXTBOX_PREFIX.length)), "Textbox envelope must be an object.");
  const document = payload.document;
  if (typeof document !== "string") throw new Error("Textbox envelope is missing its document string.");
  return document;
}

export function convertStoredEditorBody(information: string, attachments: readonly MangoLegacyAttachmentMetadata[] = []): JSONRecord {
  const stored = projectionDocument(information);
  try {
    const parsed = record(JSON.parse(stored), "Stored editor JSON must be an object.");
    const annotations = Array.isArray(parsed.annotations) ? parsed.annotations : [];
    const document = { ...parsed };
    delete document.annotations;
    const validation = validateMangoTiptapDocument(document as unknown as MangoTiptapDocument);
    if (!validation.valid) throw new Error(validation.error);
    return { ...document, annotations };
  } catch (cause) {
    if (cause instanceof SyntaxError) {
      const converted = convertMangoLegacyHTML(stored, { attachments });
      return { ...converted.document, annotations: [] };
    }
    if (stored.trimStart().startsWith("<") || stored.startsWith("<!-- mango-editor-html-v1 -->")) {
      const converted = convertMangoLegacyHTML(stored, { attachments });
      return { ...converted.document, annotations: [] };
    }
    throw cause;
  }
}

function documentWithoutAnnotations(body: JSONRecord): JSONRecord {
  const document = { ...body };
  delete document.annotations;
  return document;
}

function currentRow(resourceType: "node" | "project" | "logic_gate", source: JSONRecord, displayOrder: number, attachments: readonly MangoLegacyAttachmentMetadata[]): JSONRecord {
  const companyID = requiredText(source, "company_id");
  const textboxID = requiredText(source, "information_id");
  const body = convertStoredEditorBody(requiredText(source, "information"), attachments);
  const revision = Math.max(0, integer(source, "revision"));
  const created = timestamp(source, "created_timestamp", "updated_timestamp");
  const updated = timestamp(source, "updated_timestamp", "created_timestamp");
  const deleted = source.is_deleted === true ? updated : null;
  if (resourceType === "node") {
    return {
      company_id: companyID,
      node_id: requiredText(source, "node_id"),
      textbox_id: textboxID,
      source_information_id: null,
      document_schema_version: 1,
      document_json: documentWithoutAnnotations(body),
      plain_text: "",
      content_revision: revision,
      created_by_user_id: null,
      updated_by_user_id: null,
      created_timestamp: created,
      updated_timestamp: updated,
      deleted_timestamp: deleted,
      body_json: body,
      revision,
      display_order: displayOrder,
    };
  }
  const ownerColumn = resourceType === "project" ? "project_id" : "logic_gate_id";
  const result: JSONRecord = {
    company_id: companyID,
    [ownerColumn]: requiredText(source, ownerColumn),
    textbox_id: textboxID,
    body_json: body,
    revision,
    created_timestamp: created,
    updated_timestamp: updated,
    deleted_timestamp: deleted,
  };
  if (resourceType === "project") result.display_order = displayOrder;
  return result;
}

export function legacyDocumentToNodeTextbox(source: JSONRecord, displayOrder: number): JSONRecord {
  const body = {
    ...record(source.canonical_document, "Legacy canonical_document must be an object."),
    annotations: Array.isArray(source.canonical_annotations) ? source.canonical_annotations : [],
  };
  const companyID = requiredText(source, "company_id");
  const nodeID = requiredText(source, "resource_id");
  const textboxID = requiredText(source, "document_id");
  const revision = Math.max(0, integer(source, "revision"));
  const created = timestamp(source, "created_timestamp", "updated_timestamp");
  const updated = timestamp(source, "updated_timestamp", "created_timestamp");
  return {
    company_id: companyID,
    node_id: nodeID,
    textbox_id: textboxID,
    source_information_id: null,
    document_schema_version: 1,
    document_json: documentWithoutAnnotations(body),
    plain_text: "",
    content_revision: revision,
    created_by_user_id: null,
    updated_by_user_id: null,
    created_timestamp: created,
    updated_timestamp: updated,
    deleted_timestamp: source.is_deleted === true ? updated : null,
    body_json: body,
    revision,
    display_order: displayOrder,
  };
}

function historyRow(resourceType: "node" | "logic_gate", source: JSONRecord, displayOrder: number, attachments: readonly MangoLegacyAttachmentMetadata[]): JSONRecord {
  const companyID = requiredText(source, "company_id");
  const ownerColumn = resourceType === "node" ? "node_id" : "logic_gate_id";
  const textboxID = text(source, "source_information_id").trim() || requiredText(source, "information_id");
  const result: JSONRecord = {
    company_id: companyID,
    [ownerColumn]: requiredText(source, ownerColumn),
    textbox_id: textboxID,
    batch_id: requiredText(source, "save_batch_id"),
    body_json: convertStoredEditorBody(requiredText(source, "information"), attachments),
    saved_by_user_id: text(source, "saved_by_user_id").trim() || null,
    saved_timestamp: timestamp(source, "updated_timestamp", "created_timestamp"),
  };
  if (resourceType === "node") result.display_order = displayOrder;
  return result;
}

export function convertActiveHistoryRows(resourceType: "node" | "logic_gate", sourceRows: JSONRecord[], attachments: readonly MangoLegacyAttachmentMetadata[] = []): JSONRecord[] {
  const displayByBatch = new Map<string, number>();
  return sourceRows
    .filter((source) => text(source, "save_kind").trim().toLowerCase() !== "auto")
    .map((source) => {
      const batch = requiredText(source, "save_batch_id");
      const ownerColumn = resourceType === "node" ? "node_id" : "logic_gate_id";
      const displayKey = `${requiredText(source, "company_id")}|${requiredText(source, ownerColumn)}|${batch}`;
      const display = displayByBatch.get(displayKey) ?? 0;
      displayByBatch.set(displayKey, display + 1);
      return historyRow(resourceType, source, display, attachments);
    });
}

function projectHistoryRows(source: JSONRecord, attachments: readonly MangoLegacyAttachmentMetadata[]): JSONRecord[] {
  const information = requiredText(source, "information");
  if (!information.startsWith(PROJECT_SAVE_PREFIX)) throw new Error("Project saved version has an unreadable prefix.");
  const payload = record(JSON.parse(information.slice(PROJECT_SAVE_PREFIX.length)), "Project saved version must be an object.");
  if (!Array.isArray(payload.blocks) || payload.blocks.length === 0) throw new Error("Project saved version has no blocks.");
  return payload.blocks.map((raw, index) => {
    const block = record(raw, "Project saved-version block must be an object.");
    const body = convertStoredEditorBody(requiredText(block, "document"), attachments);
    body.history_metadata = {
      title: text(block, "title"),
      attachments: Array.isArray(block.attachments) ? block.attachments : [],
      createdTimestamp: text(block, "createdTimestamp"),
      updatedTimestamp: text(block, "updatedTimestamp"),
    };
    return {
      company_id: requiredText(source, "company_id"),
      project_id: requiredText(source, "project_id"),
      textbox_id: requiredText(block, "id"),
      batch_id: requiredText(source, "information_id"),
      body_json: body,
      display_order: index,
      saved_by_user_id: null,
      saved_timestamp: timestamp(source, "updated_timestamp", "created_timestamp"),
    };
  });
}

function keyFor(table: string, row: JSONRecord): string {
  const owner = table.startsWith("node_") ? requiredText(row, "node_id")
    : table.startsWith("project_") ? requiredText(row, "project_id")
      : requiredText(row, "logic_gate_id");
  const history = table.endsWith("_history") ? `|${requiredText(row, "batch_id")}` : "";
  return `${requiredText(row, "company_id")}|${owner}${history}|${requiredText(row, "textbox_id")}`;
}

function mergeTargetRows(table: string, existing: JSONRecord[], converted: JSONRecord[]): JSONRecord[] {
  const byKey = new Map(existing.map((row) => [keyFor(table, row), row]));
  for (const row of converted) {
    const key = keyFor(table, row);
    const previous = byKey.get(key);
    if (previous && !isDeepStrictEqual(previous, row)) throw new Error(`Recycle payload has a conflicting ${table} row for ${key}.`);
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

export function convertRecyclePayload(input: JSONRecord, legacyNodeDocuments: JSONRecord[] = [], attachments: readonly MangoLegacyAttachmentMetadata[] = []): {
  payload: JSONRecord;
  stats: RecycleConversionStats;
} {
  const payload = structuredClone(input);
  const nodeProjections = rows(payload.node_projection_table).filter((row) => text(row, "type") === "Text box");
  const projectProjections = rows(payload.project_projection_table).filter((row) => text(row, "type") === "Text box");
  const logicProjections = rows(payload.logic_gate_projection_table).filter((row) => text(row, "type") === "Text box");
  const nodeCurrent = nodeProjections.map((row, index) => currentRow("node", row, index, attachments));
  const orphanByKey = new Map(legacyNodeDocuments.map((row, index) => {
    const converted = legacyDocumentToNodeTextbox(row, index);
    return [keyFor("node_textboxes", converted), converted] as const;
  }));
  for (let index = 0; index < nodeCurrent.length; index += 1) {
    const replacement = orphanByKey.get(keyFor("node_textboxes", nodeCurrent[index]));
    if (replacement) {
      replacement.display_order = nodeCurrent[index].display_order;
      nodeCurrent[index] = replacement;
      orphanByKey.delete(keyFor("node_textboxes", replacement));
    }
  }
  nodeCurrent.push(...orphanByKey.values());

  const rawNodeHistory = rows(payload.node_information).filter((row) => text(row, "save_batch_id").trim());
  const rawLogicHistory = rows(payload.logic_gate_information).filter((row) => text(row, "save_batch_id").trim());
  const rawProjectHistory = rows(payload.project_information).filter((row) => text(row, "type") === "Saved version");
  const nodeHistory = convertActiveHistoryRows("node", rawNodeHistory, attachments);
  const logicHistory = convertActiveHistoryRows("logic_gate", rawLogicHistory, attachments);
  const projectHistory = rawProjectHistory.flatMap((row) => projectHistoryRows(row, attachments));

  payload.node_textboxes = mergeTargetRows("node_textboxes", rows(payload.node_textboxes), nodeCurrent);
  payload.project_textboxes = mergeTargetRows("project_textboxes", rows(payload.project_textboxes), projectProjections.map((row, index) => currentRow("project", row, index, attachments)));
  payload.logic_gate_textboxes = mergeTargetRows("logic_gate_textboxes", rows(payload.logic_gate_textboxes), logicProjections.map((row, index) => currentRow("logic_gate", row, index, attachments)));
  payload.node_textboxes_history = mergeTargetRows("node_textboxes_history", rows(payload.node_textboxes_history), nodeHistory);
  payload.project_textboxes_history = mergeTargetRows("project_textboxes_history", rows(payload.project_textboxes_history), projectHistory);
  payload.logic_gate_textboxes_history = mergeTargetRows("logic_gate_textboxes_history", rows(payload.logic_gate_textboxes_history), logicHistory);
  payload.node_information = rows(payload.node_information).filter((row) => !text(row, "save_batch_id").trim());
  payload.logic_gate_information = rows(payload.logic_gate_information).filter((row) => !text(row, "save_batch_id").trim());
  payload.project_information = rows(payload.project_information).filter((row) => text(row, "type") !== "Saved version");

  return {
    payload,
    stats: {
      nodeCurrent: nodeCurrent.length,
      projectCurrent: projectProjections.length,
      logicGateCurrent: logicProjections.length,
      nodeHistory: nodeHistory.length,
      projectHistory: projectHistory.length,
      logicGateHistory: logicHistory.length,
      automaticHistoryDiscarded: [...rawNodeHistory, ...rawLogicHistory]
        .filter((row) => text(row, "save_kind").trim().toLowerCase() === "auto").length,
    },
  };
}
