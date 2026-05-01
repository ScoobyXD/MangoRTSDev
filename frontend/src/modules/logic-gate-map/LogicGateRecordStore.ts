import { LogicGateDetails } from "./shared";

const detailsCache = new Map<string, LogicGateDetails>();
const detailsInflight = new Map<string, Promise<LogicGateDetails>>();

function key(apiBase: string, companyID: string, logicGateID: string): string {
  return `${apiBase}:${companyID}:${logicGateID}`;
}

async function requestJSON<T>(apiBase: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(await response.text() || `Request failed (${response.status})`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function invalidateLogicGateRecordStoreCaches(apiBase: string, companyID: string, logicGateID: string): void {
  detailsCache.delete(key(apiBase, companyID, logicGateID));
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

