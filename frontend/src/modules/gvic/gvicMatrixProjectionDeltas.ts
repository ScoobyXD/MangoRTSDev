import type { GVICMatrixProjectionRow } from "../kanban/kanbanApi.js";

export type GVICMatrixProjectionDeltaOperation = "upsert" | "delete" | "patch";

export type GVICMatrixProjectionRowKey = {
  company_id?: string;
  user_id?: string;
  projection_row_id?: string;
  node_id?: string;
  gvic_assignment?: string;
  project_id?: string;
  logic_gate_id?: string;
};

export type GVICMatrixProjectionDelta = {
  company_id?: string;
  projection?: string;
  projection_sequence?: number | string;
  operation?: GVICMatrixProjectionDeltaOperation | string;
  row_key?: GVICMatrixProjectionRowKey | null;
  row?: GVICMatrixProjectionRow | null;
  patch?: Partial<GVICMatrixProjectionRow> | null;
  projected_timestamp?: string;
};

export type GVICMatrixProjectionDeltaEnvelope = {
  company_id?: string;
  projection?: string;
  projection_scope?: string;
  projection_sequence?: number | string;
  sequence?: number | string;
  projected_timestamp?: string;
  deltas?: GVICMatrixProjectionDelta[];
} & Partial<GVICMatrixProjectionDelta>;

export type GVICMatrixProjectionFallbackReason =
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

export type GVICMatrixProjectionApplyResult = {
  rows: GVICMatrixProjectionRow[];
  changed: boolean;
  fallback: boolean;
  fallbackReason?: GVICMatrixProjectionFallbackReason;
  lastSequence?: number;
  removedRowKeys: GVICMatrixProjectionRowKey[];
  upsertedRows: GVICMatrixProjectionRow[];
};

export type GVICMatrixProjectionApplyInput = {
  envelope: GVICMatrixProjectionDeltaEnvelope;
  companyID: string;
  userID: string;
  rows: GVICMatrixProjectionRow[];
  lastSequence?: number;
};

export const GVIC_MATRIX_PROJECTION_NAME = "gvic_matrix";

export function GVICMatrixRealtimeScope(userID: string): string {
  return `gvic_matrix:user:${userID.trim()}`;
}

export function parseGVICMatrixProjectionSequence(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rowKey(projectionRowID: string): string {
  return cleanString(projectionRowID);
}

function deltaUserID(delta: GVICMatrixProjectionDelta): string {
  return cleanString(delta.row?.user_id) || cleanString(delta.row_key?.user_id);
}

function deltaProjectionRowID(delta: GVICMatrixProjectionDelta): string {
  return cleanString(delta.row?.projection_row_id) || cleanString(delta.row_key?.projection_row_id);
}

function requestFallback(result: GVICMatrixProjectionApplyResult, reason: GVICMatrixProjectionFallbackReason): GVICMatrixProjectionApplyResult {
  return { ...result, fallback: true, fallbackReason: reason };
}

function applyPatchToRow(row: GVICMatrixProjectionRow, patch: Partial<GVICMatrixProjectionRow>): GVICMatrixProjectionRow {
  return {
    ...row,
    ...patch,
    company_id: cleanString(patch.company_id) || row.company_id,
    projection_row_id: cleanString(patch.projection_row_id) || row.projection_row_id,
    user_id: cleanString(patch.user_id) || row.user_id,
    node_name: typeof patch.node_name === "string" ? patch.node_name : row.node_name,
    gvic_assignment: typeof patch.gvic_assignment === "string" ? patch.gvic_assignment : row.gvic_assignment,
    project_id: Object.prototype.hasOwnProperty.call(patch, "project_id") ? patch.project_id : row.project_id,
    project_name: Object.prototype.hasOwnProperty.call(patch, "project_name") ? patch.project_name : row.project_name,
    logic_gate_id: Object.prototype.hasOwnProperty.call(patch, "logic_gate_id") ? patch.logic_gate_id : row.logic_gate_id,
    logic_gate_name: Object.prototype.hasOwnProperty.call(patch, "logic_gate_name") ? patch.logic_gate_name : row.logic_gate_name,
    node_id: cleanString(patch.node_id) || row.node_id,
    status: Object.prototype.hasOwnProperty.call(patch, "status") ? patch.status : row.status,
    due_date: Object.prototype.hasOwnProperty.call(patch, "due_date") ? patch.due_date : row.due_date,
    priority: Object.prototype.hasOwnProperty.call(patch, "priority") ? patch.priority : row.priority,
    created_timestamp: typeof patch.created_timestamp === "string" ? patch.created_timestamp : row.created_timestamp,
    updated_timestamp: typeof patch.updated_timestamp === "string" ? patch.updated_timestamp : row.updated_timestamp,
  };
}

function deltaList(envelope: GVICMatrixProjectionDeltaEnvelope): GVICMatrixProjectionDelta[] | null {
  if (Array.isArray(envelope.deltas)) return envelope.deltas;
  if (envelope.operation && envelope.row_key) return [envelope as GVICMatrixProjectionDelta];
  return null;
}

export function applyGVICMatrixProjectionEnvelope(input: GVICMatrixProjectionApplyInput): GVICMatrixProjectionApplyResult {
  const result: GVICMatrixProjectionApplyResult = {
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
  if (cleanString(input.envelope.projection) !== GVIC_MATRIX_PROJECTION_NAME) {
    return requestFallback(result, "wrong_projection");
  }
  const sequence = parseGVICMatrixProjectionSequence(input.envelope.projection_sequence ?? input.envelope.sequence);
  if (sequence > 0) {
    if (input.lastSequence !== undefined && sequence > input.lastSequence + 1) {
      return requestFallback(result, "sequence_gap");
    }
    result.lastSequence = Math.max(input.lastSequence ?? 0, sequence);
  }
  const deltas = deltaList(input.envelope);
  if (!deltas) return requestFallback(result, "invalid_envelope");

  const byKey = new Map(input.rows.map((row) => [rowKey(row.projection_row_id), row]));
  for (const delta of deltas) {
    if (!delta || typeof delta !== "object") return requestFallback(result, "invalid_delta");
    if (cleanString(delta.company_id) && cleanString(delta.company_id) !== companyID) {
      return requestFallback(result, "wrong_company");
    }
    if (cleanString(delta.projection) && cleanString(delta.projection) !== GVIC_MATRIX_PROJECTION_NAME) {
      return requestFallback(result, "wrong_projection");
    }
    if (deltaUserID(delta) !== userID) return requestFallback(result, "wrong_user");
    const operation = cleanString(delta.operation);
    if (operation !== "upsert" && operation !== "delete" && operation !== "patch") {
      return requestFallback(result, "unknown_delta_operation");
    }
    const projectionRowID = deltaProjectionRowID(delta);
    if (!projectionRowID) return requestFallback(result, "missing_row_key");
    const key = rowKey(projectionRowID);

    if (operation === "delete") {
      if (byKey.delete(key)) {
        result.changed = true;
        result.removedRowKeys.push({ user_id: userID, projection_row_id: projectionRowID, node_id: cleanString(delta.row_key?.node_id) || cleanString(delta.row?.node_id) });
      }
      continue;
    }

    if (operation === "upsert") {
      const row = delta.row;
      if (!row || row.company_id?.trim() !== companyID || row.user_id?.trim() !== userID || !cleanString(row.projection_row_id) || !cleanString(row.node_id)) {
        return requestFallback(result, "missing_row");
      }
      byKey.set(rowKey(row.projection_row_id), row);
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
