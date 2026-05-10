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

type LogicGateProjectionResponse = {
  company_id: string;
  logic_gate_id: string;
  items: LogicGateProjectionItem[];
};

const detailsCache = new Map<string, LogicGateDetails>();
const detailsInflight = new Map<string, Promise<LogicGateDetails>>();

const projectionCache = new Map<string, LogicGateProjectionItem[]>();
const projectionInflight = new Map<string, Promise<LogicGateProjectionItem[]>>();

function key(apiBase: string, companyID: string, logicGateID: string): string {
  return `${apiBase}:${companyID}:${logicGateID}`;
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
  const promise = requestJSON<LogicGateDetails>(apiBase, `/v1/logic-gates/${logicGateID}?company_id=${encodeURIComponent(companyID)}`)
    .then((payload) => {
      detailsCache.set(cacheKey, payload);
      detailsInflight.delete(cacheKey);
      return payload;
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
  const promise = requestJSON<LogicGateProjectionResponse>(apiBase, `/v1/logic-gates/${logicGateID}/projection?company_id=${encodeURIComponent(companyID)}`)
    .then((payload) => {
      const items = payload.items ?? [];
      projectionCache.set(cacheKey, items);
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

