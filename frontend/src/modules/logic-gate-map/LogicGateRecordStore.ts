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
};

const detailsCache = new Map<string, LogicGateDetails>();
const detailsInflight = new Map<string, Promise<LogicGateDetails>>();

const projectionCache = new Map<string, LogicGateProjectionItem[]>();
const projectionInflight = new Map<string, Promise<LogicGateProjectionItem[]>>();

function key(apiBase: string, companyID: string, logicGateID: string): string {
  return `${apiBase}:${companyID}:${logicGateID}`;
}

function cacheLogicGateViewPayload(cacheKey: string, payload: LogicGateViewResponse): LogicGateDetails {
  const details: LogicGateDetails = {
    logic_gate: payload.logic_gate,
    information: payload.information ?? [],
    relationships: payload.relationships ?? [],
    information_count: payload.information_count,
    relationships_count: payload.relationships_count,
  };
  detailsCache.set(cacheKey, details);
  projectionCache.set(cacheKey, payload.projections ?? []);
  return details;
}

export function invalidateLogicGateRecordStoreCaches(apiBase: string, companyID: string, logicGateID: string): void {
  const cacheKey = key(apiBase, companyID, logicGateID);
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
    });
    projectionCache.set(cacheKey, entry.projections ?? []);
  }
}

export async function getLogicGateRecordSingleFlight(apiBase: string, companyID: string, logicGateID: string): Promise<LogicGateDetails> {
  const cacheKey = key(apiBase, companyID, logicGateID);
  const cached = detailsCache.get(cacheKey);
  if (cached) return cached;
  const inflight = detailsInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = requestJSON<LogicGateViewResponse>(apiBase, `/v2/logic-gates/${encodeURIComponent(logicGateID)}/view?company_id=${encodeURIComponent(companyID)}`)
    .then((payload) => {
      const details = cacheLogicGateViewPayload(cacheKey, payload);
      detailsInflight.delete(cacheKey);
      return details;
    })
    .catch((error) => {
      detailsInflight.delete(cacheKey);
      throw error;
    });
  detailsInflight.set(cacheKey, promise);
  return promise;
}

export async function getLogicGateInformationProjectionSingleFlight(apiBase: string, companyID: string, logicGateID: string): Promise<LogicGateProjectionItem[]> {
  const cacheKey = key(apiBase, companyID, logicGateID);
  const cached = projectionCache.get(cacheKey);
  if (cached) return cached;
  const inflight = projectionInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = requestJSON<LogicGateViewResponse>(apiBase, `/v2/logic-gates/${encodeURIComponent(logicGateID)}/view?company_id=${encodeURIComponent(companyID)}`)
    .then((payload) => {
      cacheLogicGateViewPayload(cacheKey, payload);
      const items = payload.projections ?? [];
      projectionInflight.delete(cacheKey);
      return items;
    })
    .catch((error) => {
      projectionInflight.delete(cacheKey);
      throw error;
    });
  projectionInflight.set(cacheKey, promise);
  return promise;
}

