import { getAuthSessionCacheGeneration } from "../../auth/cognitoAuth.js";
import { requestJSON } from "../api/requestJSON.js";
import { foldCommittedEntityTitlesSince, readCommittedEntityTitleVersion, type CommittedEntityTitleUpdate } from "../realtime/committedEntityTitleUpdates.js";
import type { ProcessWorkSnapshot } from "./processWork.js";

type Snapshot = { contents: ProcessWorkSnapshot; stale: boolean };
type Flight = { promise: Promise<ProcessWorkSnapshot>; controller: AbortController; callers: Set<symbol>; settled: boolean };
const cache = new Map<string, Snapshot>();
const flights = new Map<string, Flight>();
const revisions = new Map<string, number>();
const key = (apiBase: string, companyID: string, processID: string) => `${getAuthSessionCacheGeneration()}\0${apiBase}\0${companyID}\0${processID}`;
const clone = (value: ProcessWorkSnapshot): ProcessWorkSnapshot => structuredClone(value);

export function getCachedProcessWork(apiBase: string, companyID: string, logicGateID: string): Snapshot | null {
  const entry = cache.get(key(apiBase, companyID, logicGateID));
  return entry ? { contents: clone(entry.contents), stale: entry.stale } : null;
}

export function invalidateLogicGateArenaViewCache(apiBase: string, companyID: string, logicGateID = ""): void {
  const prefix = key(apiBase, companyID, "");
  const keys = logicGateID ? [key(apiBase, companyID, logicGateID)] : [...new Set([...cache.keys(), ...flights.keys()])].filter((item) => item.startsWith(prefix));
  for (const item of keys) {
    revisions.set(item, (revisions.get(item) ?? 0) + 1);
    const entry = cache.get(item);
    if (entry) entry.stale = true;
  }
}

export function clearProcessWorkCache(apiBase: string, companyID: string, logicGateID: string): void {
  const item = key(apiBase, companyID, logicGateID);
  invalidateLogicGateArenaViewCache(apiBase, companyID, logicGateID);
  cache.delete(item);
  flights.get(item)?.controller.abort();
  flights.delete(item);
}

export function reconcileProcessWorkTitles(apiBase: string, companyID: string, update: CommittedEntityTitleUpdate): void {
  const prefix = key(apiBase, companyID, "");
  for (const [item, entry] of cache) {
    if (!item.startsWith(prefix)) continue;
    applyTitle(entry.contents, update);
  }
}

function applyTitle(value: ProcessWorkSnapshot, update: CommittedEntityTitleUpdate): ProcessWorkSnapshot {
  if (update.entityType === "logic_gate" && value.logic_gate.logic_gate_id === update.resourceID) value.logic_gate.header = update.title;
  if (update.entityType === "node") for (const node of value.nodes) if (node.node_id === update.resourceID) node.node_title = update.title;
  return value;
}

export async function getProcessWorkSingleFlight(apiBase: string, companyID: string, logicGateID: string, signal?: AbortSignal): Promise<ProcessWorkSnapshot> {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Request aborted", "AbortError");
  const item = key(apiBase, companyID, logicGateID);
  const cached = cache.get(item);
  if (cached && !cached.stale) return clone(cached.contents);
  let flight = flights.get(item);
  if (!flight) {
    const controller = new AbortController();
    const revision = revisions.get(item) ?? 0;
    const titleVersion = readCommittedEntityTitleVersion();
    const params = new URLSearchParams({ company_id: companyID });
    const next: Flight = { controller, callers: new Set(), settled: false, promise: Promise.resolve(null as unknown as ProcessWorkSnapshot) };
    next.promise = requestJSON<ProcessWorkSnapshot>(apiBase, `/v2/logic-gates/${encodeURIComponent(logicGateID)}/work?${params}`, { signal: controller.signal }).then((contents) => {
      if ((revisions.get(item) ?? 0) !== revision || controller.signal.aborted) throw new DOMException("Process work changed during this read.", "AbortError");
      foldCommittedEntityTitlesSince(contents, companyID, titleVersion, applyTitle);
      cache.set(item, { contents: clone(contents), stale: false });
      return contents;
    }).finally(() => {
      next.settled = true;
      if (flights.get(item) === next) flights.delete(item);
    });
    flights.set(item, next);
    flight = next;
  }
  const current = flight;
  const caller = Symbol("process-work-reader");
  current.callers.add(caller);
  return new Promise((resolve, reject) => {
    let finished = false;
    const release = () => {
      finished = true;
      signal?.removeEventListener("abort", abort);
      current.callers.delete(caller);
      if (!current.settled && current.callers.size === 0) {
        current.controller.abort();
        if (flights.get(item) === current) flights.delete(item);
      }
    };
    const abort = () => {
      if (finished) return;
      release();
      reject(signal?.reason ?? new DOMException("Request aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    current.promise.then((value) => {
      if (finished) return;
      release();
      resolve(clone(value));
    }, (cause) => {
      if (finished) return;
      release();
      reject(cause);
    });
  });
}
