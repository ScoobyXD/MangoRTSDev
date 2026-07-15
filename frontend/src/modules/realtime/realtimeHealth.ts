export type RealtimeHealthStatus = "connected" | "reconnecting" | "attempting" | "disconnected";

export type RealtimeHealthSnapshot = {
  status: RealtimeHealthStatus;
  lastConfirmedAt?: number;
};

type HealthEntry = RealtimeHealthSnapshot & {
  active: boolean;
  listeners: Set<(snapshot: RealtimeHealthSnapshot) => void>;
};

const entries = new Map<string, HealthEntry>();

export function realtimeHealthKey(apiBase: string, companyID: string): string {
  return `${apiBase.trim()}:${companyID.trim()}`;
}

function entryFor(key: string): HealthEntry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { status: "reconnecting", active: false, listeners: new Set() };
    entries.set(key, entry);
  }
  return entry;
}

export function setRealtimeHealthClientActive(key: string, active: boolean): void {
  const entry = entryFor(key);
  entry.active = active;
}

export function updateRealtimeHealth(key: string, snapshot: RealtimeHealthSnapshot): void {
  const entry = entryFor(key);
  if (entry.status === snapshot.status && entry.lastConfirmedAt === snapshot.lastConfirmedAt) return;
  entry.status = snapshot.status;
  entry.lastConfirmedAt = snapshot.lastConfirmedAt;
  const value = { status: entry.status, lastConfirmedAt: entry.lastConfirmedAt };
  for (const listener of entry.listeners) listener(value);
}

export function subscribeRealtimeHealthState(
  key: string,
  listener: (snapshot: RealtimeHealthSnapshot) => void,
): () => void {
  const entry = entryFor(key);
  entry.listeners.add(listener);
  listener({ status: entry.status, lastConfirmedAt: entry.lastConfirmedAt });
  return () => {
    entry.listeners.delete(listener);
  };
}

export function getGlobalRealtimeHealthStatus(): RealtimeHealthStatus {
  let status: RealtimeHealthStatus = "connected";
  const rank: Record<RealtimeHealthStatus, number> = {
    connected: 0,
    reconnecting: 1,
    attempting: 2,
    disconnected: 3,
  };
  for (const entry of entries.values()) {
    if (entry.active && rank[entry.status] > rank[status]) status = entry.status;
  }
  return status;
}

export function shouldBlockRealtimeMutation(method: string, path: string): boolean {
  const normalizedMethod = method.trim().toUpperCase() || "GET";
  if (normalizedMethod === "GET" || normalizedMethod === "HEAD" || normalizedMethod === "OPTIONS") return false;
  if (normalizedMethod === "POST" && path.split("?")[0].startsWith("/v1/editor-collaboration/")) return false;
  return getGlobalRealtimeHealthStatus() !== "connected";
}

export class RealtimeMutationBlockedError extends Error {
  readonly status: RealtimeHealthStatus;

  constructor(status = getGlobalRealtimeHealthStatus()) {
    super(status === "disconnected"
      ? "Mango is disconnected. Refresh your browser before making changes."
      : "Mango is reconnecting. Changes outside the editor are temporarily paused.");
    this.name = "RealtimeMutationBlockedError";
    this.status = status;
  }
}
