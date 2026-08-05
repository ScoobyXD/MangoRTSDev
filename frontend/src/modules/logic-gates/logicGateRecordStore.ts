import {
  clearResourceMissing,
  markResourceMissing,
  TerminalResourceNotFoundError,
  throwIfResourceMarkedMissing,
} from "../api/missingResources.js";
import { isHTTPNotFoundError, requestJSON } from "../api/requestJSON.js";
import type { LogicGateDetails, LogicGateGVICAssignment, LogicGateRecord, LogicGateRelationship } from "./types.js";

export type LogicGateProjectionItem = {
  company_id: string;
  logic_gate_id: string;
  information_id: string;
  type: string;
  information: string;
  revision?: number;
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
const viewGeneration = new Map<string, number>();

const detailsCache = new Map<string, LogicGateDetails>();

const projectionCache = new Map<string, LogicGateProjectionItem[]>();

function key(apiBase: string, companyID: string, logicGateID: string): string {
  return `${apiBase}:${companyID}:${logicGateID}`;
}

function readViewGeneration(cacheKey: string): number {
  return viewGeneration.get(cacheKey) ?? 0;
}

function bumpViewGeneration(cacheKey: string): void {
  viewGeneration.set(cacheKey, readViewGeneration(cacheKey) + 1);
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
    can_edit: payload.can_edit,
  };
  detailsCache.set(cacheKey, details);
  projectionCache.set(cacheKey, payload.projections ?? []);
  return details;
}

function normalizeCachedGVICAssignments(assignments: LogicGateGVICAssignment[], logicGateID: string): LogicGateGVICAssignment[] {
  return assignments.map((assignment) => ({
    ...assignment,
    logic_gate_id: assignment.logic_gate_id?.trim() || logicGateID,
    resource_id: assignment.resource_id?.trim() || logicGateID,
  }));
}

async function getLogicGateViewPayloadSingleFlight(apiBase: string, companyID: string, logicGateID: string): Promise<LogicGateViewResponse> {
  const cacheKey = key(apiBase, companyID, logicGateID);
  const resourceKey = { apiBase, companyID, resourceType: "logic_gate" as const, resourceID: logicGateID };
  throwIfResourceMarkedMissing(resourceKey);
  const cached = viewCache.get(cacheKey);
  if (cached) return cached;
  const inflight = viewInflight.get(cacheKey);
  if (inflight) return inflight;
  const generation = readViewGeneration(cacheKey);
  const promise = requestJSON<LogicGateViewResponse>(apiBase, `/v2/logic-gates/${encodeURIComponent(logicGateID)}/view?company_id=${encodeURIComponent(companyID)}`)
    .then((payload) => {
      if (readViewGeneration(cacheKey) === generation) cacheLogicGateViewPayload(cacheKey, payload);
      if (viewInflight.get(cacheKey) === promise) viewInflight.delete(cacheKey);
      return payload;
    })
    .catch((error) => {
      if (viewInflight.get(cacheKey) === promise) viewInflight.delete(cacheKey);
      if (isHTTPNotFoundError(error)) {
        markResourceMissing(resourceKey);
        invalidateLogicGateRecordStoreCaches(apiBase, companyID, logicGateID);
        throw new TerminalResourceNotFoundError("logic_gate", logicGateID);
      }
      throw error;
    });
  viewInflight.set(cacheKey, promise);
  return promise;
}

export function invalidateLogicGateRecordStoreCaches(apiBase: string, companyID: string, logicGateID: string): void {
  const cacheKey = key(apiBase, companyID, logicGateID);
  bumpViewGeneration(cacheKey);
  viewInflight.delete(cacheKey);
  viewCache.delete(cacheKey);
  detailsCache.delete(cacheKey);
  projectionCache.delete(cacheKey);
}

export function patchLogicGateRecordStoreGVICAssignments(
  apiBase: string,
  companyID: string,
  logicGateID: string,
  assignments: LogicGateGVICAssignment[],
): void {
  const cleanLogicGateID = logicGateID.trim();
  if (!cleanLogicGateID) return;
  clearResourceMissing({ apiBase, companyID, resourceType: "logic_gate", resourceID: cleanLogicGateID });
  const cacheKey = key(apiBase, companyID, cleanLogicGateID);
  const nextAssignments = normalizeCachedGVICAssignments(assignments, cleanLogicGateID);
  bumpViewGeneration(cacheKey);
  viewInflight.delete(cacheKey);

  const cachedView = viewCache.get(cacheKey);
  if (cachedView?.logic_gate) {
    viewCache.set(cacheKey, {
      ...cachedView,
      logic_gate: {
        ...cachedView.logic_gate,
        gvic_assignments: nextAssignments,
      },
    });
  }

  const cachedDetails = detailsCache.get(cacheKey);
  if (cachedDetails?.logic_gate) {
    detailsCache.set(cacheKey, {
      ...cachedDetails,
      logic_gate: {
        ...cachedDetails.logic_gate,
        gvic_assignments: nextAssignments,
      },
    });
  }
}

export function primeLogicGateRecordStoreCaches(apiBase: string, companyID: string, entries: Array<{
  logicGate: LogicGateRecord;
  relationships?: LogicGateRelationship[];
  projections?: LogicGateProjectionItem[];
}>): void {
  for (const entry of entries) {
    const cacheKey = key(apiBase, companyID, entry.logicGate.logic_gate_id);
    clearResourceMissing({ apiBase, companyID, resourceType: "logic_gate", resourceID: entry.logicGate.logic_gate_id });
    bumpViewGeneration(cacheKey);
    viewInflight.delete(cacheKey);
    viewCache.delete(cacheKey);
    detailsCache.set(cacheKey, {
      logic_gate: entry.logicGate,
      information: [],
      relationships: entry.relationships ?? [],
      information_count: 0,
      relationships_count: entry.relationships?.length ?? 0,
      effective_access_level: entry.logicGate.effective_access_level,
      can_edit: entry.logicGate.can_edit,
    });
    projectionCache.set(cacheKey, entry.projections ?? []);
  }
}

export async function getLogicGateRecordSingleFlight(apiBase: string, companyID: string, logicGateID: string): Promise<LogicGateDetails> {
  const cacheKey = key(apiBase, companyID, logicGateID);
  const cached = detailsCache.get(cacheKey);
  if (cached) return cached;
  const generation = readViewGeneration(cacheKey);
  const payload = await getLogicGateViewPayloadSingleFlight(apiBase, companyID, logicGateID);
  if (readViewGeneration(cacheKey) !== generation) {
    const current = detailsCache.get(cacheKey);
    if (current) return current;
    return getLogicGateRecordSingleFlight(apiBase, companyID, logicGateID);
  }
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

