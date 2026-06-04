import { requestJSON } from "../api/requestJSON.js";
import { LogicGateDetails, LogicGateRecord, LogicGateRelationship } from "./shared";

export type LogicGateProjectionItem = {
  company_id: string;
  logic_gate_id: string;
  information_id: string;
  type: string;
  information: string;
  created_timestamp: string;
  updated_timestamp: string;
};

type LogicGateViewResponse = LogicGateDetails & {
  company_id?: string;
  logic_gate_id?: string;
  projections?: LogicGateProjectionItem[];
  editor_sequence?: number | string;
};

const viewCache = new Map<string, LogicGateViewResponse>();
const viewInflight = new Map<string, Promise<LogicGateViewResponse>>();

const detailsCache = new Map<string, LogicGateDetails>();

const projectionCache = new Map<string, LogicGateProjectionItem[]>();

function key(apiBase: string, companyID: string, logicGateID: string): string {
  return `${apiBase}:${companyID}:${logicGateID}`;
}

function cacheLogicGateViewPayload(cacheKey: string, payload: LogicGateViewResponse): LogicGateDetails {
  viewCache.set(cacheKey, payload);
  const details: LogicGateDetails = {
    logic_gate: payload.logic_gate,
    information: payload.information ?? [],
    relationships: payload.relationships ?? [],
    information_count: payload.information_count,
    relationships_count: payload.relationships_count,
    effective_access_level: payload.effective_access_level ?? payload.logic_gate?.effective_access_level,
    can_view: payload.can_view,
    can_edit: payload.can_edit,
    can_admin: payload.can_admin,
  };
  detailsCache.set(cacheKey, details);
  projectionCache.set(cacheKey, payload.projections ?? []);
  return details;
}

async function getLogicGateViewPayloadSingleFlight(apiBase: string, companyID: string, logicGateID: string): Promise<LogicGateViewResponse> {
  const cacheKey = key(apiBase, companyID, logicGateID);
  const cached = viewCache.get(cacheKey);
  if (cached) return cached;
  const inflight = viewInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = requestJSON<LogicGateViewResponse>(apiBase, `/v2/logic-gates/${encodeURIComponent(logicGateID)}/view?company_id=${encodeURIComponent(companyID)}`)
    .then((payload) => {
      cacheLogicGateViewPayload(cacheKey, payload);
      viewInflight.delete(cacheKey);
      return payload;
    })
    .catch((error) => {
      viewInflight.delete(cacheKey);
      throw error;
    });
  viewInflight.set(cacheKey, promise);
  return promise;
}

export function invalidateLogicGateRecordStoreCaches(apiBase: string, companyID: string, logicGateID: string): void {
  const cacheKey = key(apiBase, companyID, logicGateID);
  viewCache.delete(cacheKey);
  detailsCache.delete(cacheKey);
  projectionCache.delete(cacheKey);
}

export function primeLogicGateRecordStoreCaches(apiBase: string, companyID: string, entries: Array<{
  logicGate: LogicGateRecord;
  relationships?: LogicGateRelationship[];
  projections?: LogicGateProjectionItem[];
}>): void {
  for (const entry of entries) {
    const cacheKey = key(apiBase, companyID, entry.logicGate.logic_gate_id);
    detailsCache.set(cacheKey, {
      logic_gate: entry.logicGate,
      information: [],
      relationships: entry.relationships ?? [],
      information_count: 0,
      relationships_count: entry.relationships?.length ?? 0,
      effective_access_level: entry.logicGate.effective_access_level,
      can_view: entry.logicGate.can_view,
      can_edit: entry.logicGate.can_edit,
      can_admin: entry.logicGate.can_admin,
    });
    projectionCache.set(cacheKey, entry.projections ?? []);
  }
}

export async function getLogicGateRecordSingleFlight(apiBase: string, companyID: string, logicGateID: string): Promise<LogicGateDetails> {
  const cacheKey = key(apiBase, companyID, logicGateID);
  const cached = detailsCache.get(cacheKey);
  if (cached) return cached;
  const payload = await getLogicGateViewPayloadSingleFlight(apiBase, companyID, logicGateID);
  return cacheLogicGateViewPayload(cacheKey, payload);
}

export async function getLogicGateInformationProjectionSingleFlight(apiBase: string, companyID: string, logicGateID: string): Promise<LogicGateProjectionItem[]> {
  const cacheKey = key(apiBase, companyID, logicGateID);
  const cached = projectionCache.get(cacheKey);
  if (cached) return cached;
  const payload = await getLogicGateViewPayloadSingleFlight(apiBase, companyID, logicGateID);
  return payload.projections ?? [];
}

export async function getLogicGateEditorSequenceSingleFlight(apiBase: string, companyID: string, logicGateID: string): Promise<number> {
  const payload = await getLogicGateViewPayloadSingleFlight(apiBase, companyID, logicGateID);
  return parseEditorSequence(payload.editor_sequence);
}

function parseEditorSequence(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

