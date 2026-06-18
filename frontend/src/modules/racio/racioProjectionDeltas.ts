import type { RacioMatrixProjectionRow } from "../kanban/kanbanApi.js";

export type RacioProjectionDeltaOperation = "upsert" | "delete" | "patch";

export type RacioProjectionRowKey = {
  company_id?: string;
  user_id?: string;
  resource_type?: RacioMatrixProjectionRow["resource_type"] | string;
  resource_id?: string;
};

export type RacioProjectionDelta = {
  company_id?: string;
  projection?: string;
  projection_sequence?: number | string;
  operation?: RacioProjectionDeltaOperation | string;
  row_key?: RacioProjectionRowKey | null;
  row?: RacioMatrixProjectionRow | null;
  patch?: Partial<RacioMatrixProjectionRow> | null;
  projected_timestamp?: string;
};

export type RacioProjectionDeltaEnvelope = {
  company_id?: string;
  projection?: string;
  projection_scope?: string;
  projection_sequence?: number | string;
  sequence?: number | string;
  projected_timestamp?: string;
  deltas?: RacioProjectionDelta[];
} & Partial<RacioProjectionDelta>;

export type RacioProjectionFallbackReason =
  | "wrong_company"
  | "wrong_projection"
  | "sequence_gap"
  | "invalid_envelope"
  | "invalid_delta"
  | "unknown_delta_operation"
  | "missing_row_key"
  | "missing_row"
  | "missing_existing_row"
  | "wrong_user";

export type RacioProjectionApplyResult = {
  rows: RacioMatrixProjectionRow[];
  changed: boolean;
  fallback: boolean;
  fallbackReason?: RacioProjectionFallbackReason;
  lastSequence?: number;
  removedRowKeys: RacioProjectionRowKey[];
  upsertedRows: RacioMatrixProjectionRow[];
};

export type RacioProjectionApplyInput = {
  envelope: RacioProjectionDeltaEnvelope;
  companyID: string;
  userID: string;
  rows: RacioMatrixProjectionRow[];
  lastSequence?: number;
};

export const RACIO_PROJECTION_NAME = "gvic_matrix";

export function racioRealtimeScope(userID: string): string {
  return `gvic_matrix:user:${userID.trim()}`;
}

export function parseRacioProjectionSequence(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rowResourceType(value: unknown): RacioMatrixProjectionRow["resource_type"] | "" {
  const clean = cleanString(value);
  return clean === "node" || clean === "logic_gate" ? clean : "";
}

function rowKey(resourceType: string, resourceID: string): string {
  return `${resourceType}\u0000${resourceID}`;
}

function deltaUserID(delta: RacioProjectionDelta): string {
  return cleanString(delta.row?.user_id) || cleanString(delta.row_key?.user_id);
}

function deltaResourceType(delta: RacioProjectionDelta): RacioMatrixProjectionRow["resource_type"] | "" {
  return rowResourceType(delta.row?.resource_type) || rowResourceType(delta.row_key?.resource_type);
}

function deltaResourceID(delta: RacioProjectionDelta): string {
  return cleanString(delta.row?.resource_id) || cleanString(delta.row_key?.resource_id);
}

function requestFallback(result: RacioProjectionApplyResult, reason: RacioProjectionFallbackReason): RacioProjectionApplyResult {
  return { ...result, fallback: true, fallbackReason: reason };
}

function applyPatchToRow(row: RacioMatrixProjectionRow, patch: Partial<RacioMatrixProjectionRow>): RacioMatrixProjectionRow {
  return {
    ...row,
    ...patch,
    company_id: cleanString(patch.company_id) || row.company_id,
    user_id: cleanString(patch.user_id) || row.user_id,
    resource_type: rowResourceType(patch.resource_type) || row.resource_type,
    resource_id: cleanString(patch.resource_id) || row.resource_id,
    display_title: typeof patch.display_title === "string" ? patch.display_title : row.display_title,
    logic_gate_id: Object.prototype.hasOwnProperty.call(patch, "logic_gate_id") ? patch.logic_gate_id : row.logic_gate_id,
    status: Object.prototype.hasOwnProperty.call(patch, "status") ? patch.status : row.status,
    due_date: Object.prototype.hasOwnProperty.call(patch, "due_date") ? patch.due_date : row.due_date,
    priority: Object.prototype.hasOwnProperty.call(patch, "priority") ? patch.priority : row.priority,
    resource_created_timestamp: typeof patch.resource_created_timestamp === "string" ? patch.resource_created_timestamp : row.resource_created_timestamp,
    updated_timestamp: typeof patch.updated_timestamp === "string" ? patch.updated_timestamp : row.updated_timestamp,
  };
}

function deltaList(envelope: RacioProjectionDeltaEnvelope): RacioProjectionDelta[] | null {
  if (Array.isArray(envelope.deltas)) return envelope.deltas;
  if (envelope.operation && envelope.row_key) return [envelope as RacioProjectionDelta];
  return null;
}

export function applyRacioProjectionEnvelope(input: RacioProjectionApplyInput): RacioProjectionApplyResult {
  const result: RacioProjectionApplyResult = {
    rows: input.rows,
    changed: false,
    fallback: false,
    lastSequence: input.lastSequence,
    removedRowKeys: [],
    upsertedRows: [],
  };
  const companyID = cleanString(input.companyID);
  const userID = cleanString(input.userID);
  const envelopeCompanyID = cleanString(input.envelope.company_id);
  if (!companyID || !userID || !envelopeCompanyID || envelopeCompanyID !== companyID) {
    return requestFallback(result, "wrong_company");
  }
  if (cleanString(input.envelope.projection) !== RACIO_PROJECTION_NAME) {
    return requestFallback(result, "wrong_projection");
  }
  const sequence = parseRacioProjectionSequence(input.envelope.projection_sequence ?? input.envelope.sequence);
  if (sequence > 0) {
    if (input.lastSequence !== undefined && sequence > input.lastSequence + 1) {
      return requestFallback(result, "sequence_gap");
    }
    result.lastSequence = Math.max(input.lastSequence ?? 0, sequence);
  }
  const deltas = deltaList(input.envelope);
  if (!deltas) return requestFallback(result, "invalid_envelope");

  const byKey = new Map(input.rows.map((row) => [rowKey(row.resource_type, row.resource_id), row]));
  for (const delta of deltas) {
    if (!delta || typeof delta !== "object") return requestFallback(result, "invalid_delta");
    if (cleanString(delta.company_id) && cleanString(delta.company_id) !== companyID) {
      return requestFallback(result, "wrong_company");
    }
    if (cleanString(delta.projection) && cleanString(delta.projection) !== RACIO_PROJECTION_NAME) {
      return requestFallback(result, "wrong_projection");
    }
    if (deltaUserID(delta) !== userID) return requestFallback(result, "wrong_user");
    const operation = cleanString(delta.operation);
    if (operation !== "upsert" && operation !== "delete" && operation !== "patch") {
      return requestFallback(result, "unknown_delta_operation");
    }
    const resourceType = deltaResourceType(delta);
    const resourceID = deltaResourceID(delta);
    if (!resourceType || !resourceID) return requestFallback(result, "missing_row_key");
    const key = rowKey(resourceType, resourceID);

    if (operation === "delete") {
      if (byKey.delete(key)) {
        result.changed = true;
        result.removedRowKeys.push({ user_id: userID, resource_type: resourceType, resource_id: resourceID });
      }
      continue;
    }

    if (operation === "upsert") {
      const row = delta.row;
      if (!row || row.company_id?.trim() !== companyID || row.user_id?.trim() !== userID) {
        return requestFallback(result, "missing_row");
      }
      byKey.set(key, row);
      result.changed = true;
      result.upsertedRows.push(row);
      continue;
    }

    const existing = byKey.get(key);
    if (!existing) return requestFallback(result, "missing_existing_row");
    const patched = applyPatchToRow(existing, delta.patch ?? {});
    byKey.set(key, patched);
    result.changed = true;
    result.upsertedRows.push(patched);
  }

  return {
    ...result,
    rows: result.changed ? Array.from(byKey.values()) : input.rows,
  };
}
