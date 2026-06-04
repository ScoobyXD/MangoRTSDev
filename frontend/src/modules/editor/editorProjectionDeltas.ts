import type { EditorProjectionItem } from "./editorProjection";

export type EditorProjectionResourceType = "node" | "logic_gate";
export type EditorProjectionOperation = "upsert" | "delete" | "patch";

export type EditorProjectionRow = EditorProjectionItem & {
  company_id?: string;
  resource_type?: string;
  resource_id?: string;
  node_id?: string;
  logic_gate_id?: string;
};

export type EditorProjectionRowKey = {
  resource_type?: string;
  resource_id?: string;
  information_id?: string;
};

export type EditorProjectionDelta = {
  operation?: EditorProjectionOperation | string;
  row_key?: EditorProjectionRowKey | null;
  row?: EditorProjectionRow | null;
  patch?: Partial<EditorProjectionRow> | null;
};

export type EditorProjectionDeltaEnvelope = {
  company_id?: string;
  scope?: string;
  projection?: string;
  sequence?: number | string;
  resource_type?: string;
  resource_id?: string;
  deltas?: EditorProjectionDelta[];
};

export type EditorProjectionFallbackReason =
  | "wrong_company"
  | "wrong_projection"
  | "wrong_scope"
  | "wrong_resource"
  | "sequence_gap"
  | "invalid_envelope"
  | "invalid_delta"
  | "unknown_delta_operation"
  | "missing_row_key"
  | "missing_row"
  | "missing_existing_row";

export type EditorProjectionApplyResult<T extends EditorProjectionItem = EditorProjectionRow> = {
  items: T[];
  changed: boolean;
  fallback: boolean;
  fallbackReason?: EditorProjectionFallbackReason;
  lastSequence?: number;
  removedInformationIDs: string[];
  upsertedItems: T[];
};

export type EditorProjectionApplyInput<T extends EditorProjectionItem = EditorProjectionRow> = {
  envelope: EditorProjectionDeltaEnvelope;
  companyID: string;
  resourceType: EditorProjectionResourceType;
  resourceID: string;
  scope: string;
  items: T[];
  lastSequence?: number;
};

export const EDITOR_PROJECTION_NAME = "editor";

export function editorRealtimeScope(resourceType: EditorProjectionResourceType, resourceID: string): string {
  const cleanID = resourceID.trim();
  if (!cleanID) return "";
  return resourceType === "node" ? `editor:node:${cleanID}` : `editor:logic_gate:${cleanID}`;
}

export function parseEditorProjectionSequence(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanResourceType(value: unknown): EditorProjectionResourceType | "" {
  const clean = cleanString(value);
  return clean === "node" || clean === "logic_gate" ? clean : "";
}

function itemInformationID(item: EditorProjectionItem): string {
  return cleanString(item.information_id);
}

function deltaInformationID(delta: EditorProjectionDelta): string {
  return cleanString(delta.row?.information_id) || cleanString(delta.row_key?.information_id);
}

function deltaResourceType(delta: EditorProjectionDelta): EditorProjectionResourceType | "" {
  return cleanResourceType(delta.row?.resource_type)
    || cleanResourceType(delta.row_key?.resource_type)
    || (cleanString(delta.row?.node_id) ? "node" : "")
    || (cleanString(delta.row?.logic_gate_id) ? "logic_gate" : "");
}

function deltaResourceID(delta: EditorProjectionDelta): string {
  return cleanString(delta.row?.resource_id)
    || cleanString(delta.row_key?.resource_id)
    || cleanString(delta.row?.node_id)
    || cleanString(delta.row?.logic_gate_id);
}

function requestFallback<T extends EditorProjectionItem>(
  result: EditorProjectionApplyResult<T>,
  reason: EditorProjectionFallbackReason,
): EditorProjectionApplyResult<T> {
  return { ...result, fallback: true, fallbackReason: reason };
}

function compareEditorProjectionItems(a: EditorProjectionItem, b: EditorProjectionItem): number {
  const created = cleanString(a.created_timestamp).localeCompare(cleanString(b.created_timestamp));
  if (created !== 0) return created;
  return cleanString(a.information_id).localeCompare(cleanString(b.information_id));
}

function applyPatchToItem<T extends EditorProjectionItem>(item: T, patch: Partial<EditorProjectionRow>): T {
  return {
    ...item,
    type: typeof patch.type === "string" ? patch.type : item.type,
    information: typeof patch.information === "string" ? patch.information : item.information,
    created_timestamp: typeof patch.created_timestamp === "string" ? patch.created_timestamp : item.created_timestamp,
    updated_timestamp: typeof patch.updated_timestamp === "string" ? patch.updated_timestamp : item.updated_timestamp,
  };
}

function rowMatchesResource(row: EditorProjectionRow, companyID: string, resourceType: EditorProjectionResourceType, resourceID: string): boolean {
  if (cleanString(row.company_id) && cleanString(row.company_id) !== companyID) return false;
  const rowResourceType = cleanResourceType(row.resource_type) || (cleanString(row.node_id) ? "node" : "") || (cleanString(row.logic_gate_id) ? "logic_gate" : "");
  const rowResourceID = cleanString(row.resource_id) || cleanString(row.node_id) || cleanString(row.logic_gate_id);
  return rowResourceType === resourceType && rowResourceID === resourceID;
}

export function applyEditorProjectionEnvelope<T extends EditorProjectionItem>(input: EditorProjectionApplyInput<T>): EditorProjectionApplyResult<T> {
  const result: EditorProjectionApplyResult<T> = {
    items: input.items,
    changed: false,
    fallback: false,
    lastSequence: input.lastSequence,
    removedInformationIDs: [],
    upsertedItems: [],
  };
  const companyID = cleanString(input.companyID);
  const resourceType = cleanResourceType(input.resourceType);
  const resourceID = cleanString(input.resourceID);
  const scope = cleanString(input.scope);
  if (!companyID || !resourceType || !resourceID || cleanString(input.envelope.company_id) !== companyID) {
    return requestFallback(result, "wrong_company");
  }
  if (cleanString(input.envelope.projection) !== EDITOR_PROJECTION_NAME) {
    return requestFallback(result, "wrong_projection");
  }
  if (cleanString(input.envelope.scope) !== scope || scope !== editorRealtimeScope(resourceType, resourceID)) {
    return requestFallback(result, "wrong_scope");
  }
  if (cleanResourceType(input.envelope.resource_type) !== resourceType || cleanString(input.envelope.resource_id) !== resourceID) {
    return requestFallback(result, "wrong_resource");
  }
  const sequence = parseEditorProjectionSequence(input.envelope.sequence);
  if (sequence > 0) {
    if (input.lastSequence !== undefined && sequence > input.lastSequence + 1) {
      return requestFallback(result, "sequence_gap");
    }
    result.lastSequence = Math.max(input.lastSequence ?? 0, sequence);
  }
  if (!Array.isArray(input.envelope.deltas)) return requestFallback(result, "invalid_envelope");

  const byID = new Map(input.items.map((item) => [itemInformationID(item), item]));
  for (const delta of input.envelope.deltas) {
    if (!delta || typeof delta !== "object") return requestFallback(result, "invalid_delta");
    const operation = cleanString(delta.operation);
    if (operation !== "upsert" && operation !== "delete" && operation !== "patch") {
      return requestFallback(result, "unknown_delta_operation");
    }
    if (deltaResourceType(delta) !== resourceType || deltaResourceID(delta) !== resourceID) {
      return requestFallback(result, "wrong_resource");
    }
    const informationID = deltaInformationID(delta);
    if (!informationID) return requestFallback(result, "missing_row_key");

    if (operation === "delete") {
      if (byID.delete(informationID)) {
        result.changed = true;
        result.removedInformationIDs.push(informationID);
      }
      continue;
    }

    if (operation === "upsert") {
      const row = delta.row;
      if (!row || !rowMatchesResource(row, companyID, resourceType, resourceID) || !cleanString(row.information_id)) {
        return requestFallback(result, "missing_row");
      }
      byID.set(informationID, row as T);
      result.changed = true;
      result.upsertedItems.push(row as T);
      continue;
    }

    const existing = byID.get(informationID);
    if (!existing) return requestFallback(result, "missing_existing_row");
    const patched = applyPatchToItem(existing, delta.patch ?? {});
    byID.set(informationID, patched);
    result.changed = true;
    result.upsertedItems.push(patched);
  }

  return {
    ...result,
    items: result.changed ? Array.from(byID.values()).sort(compareEditorProjectionItems) : input.items,
  };
}
