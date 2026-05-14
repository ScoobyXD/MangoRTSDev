import { connectAuthenticatedSse, type SseConnection, type SseEvent } from "../../auth/authenticatedSse.js";

type WorkspaceStreamSubscriber = {
  onEvent: (event: SseEvent) => void;
  onError?: (error: unknown) => void;
};

type WorkspaceStreamEntry = {
  subscribers: Set<WorkspaceStreamSubscriber>;
  source?: SseConnection;
  closeTimer?: ReturnType<typeof window.setTimeout>;
};

const workspaceStreams = new Map<string, WorkspaceStreamEntry>();
const STREAM_CLOSE_GRACE_MS = 1500;

function streamKey(apiBase: string, companyID: string): string {
  return `${apiBase}:${companyID}`;
}

function getEntry(key: string): WorkspaceStreamEntry {
  const existing = workspaceStreams.get(key);
  if (existing) return existing;
  const created: WorkspaceStreamEntry = { subscribers: new Set() };
  workspaceStreams.set(key, created);
  return created;
}

function ensureWorkspaceStream(apiBase: string, companyID: string, entry: WorkspaceStreamEntry): void {
  if (entry.source) return;
  entry.source = connectAuthenticatedSse(`${apiBase}/v1/workspace/stream?company_id=${encodeURIComponent(companyID)}`, {
    onEvent(event: SseEvent) {
      for (const subscriber of Array.from(entry.subscribers)) subscriber.onEvent(event);
    },
    onError(error: unknown) {
      for (const subscriber of Array.from(entry.subscribers)) subscriber.onError?.(error);
    },
  });
}

export function subscribeWorkspaceStream(apiBase: string, companyID: string, subscriber: WorkspaceStreamSubscriber): () => void {
  const key = streamKey(apiBase, companyID);
  const entry = getEntry(key);
  if (entry.closeTimer !== undefined) {
    window.clearTimeout(entry.closeTimer);
    entry.closeTimer = undefined;
  }
  entry.subscribers.add(subscriber);
  ensureWorkspaceStream(apiBase, companyID, entry);

  return () => {
    const current = workspaceStreams.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
    if (current.subscribers.size === 0) {
      current.closeTimer = window.setTimeout(() => {
        const closingEntry = workspaceStreams.get(key);
        if (closingEntry !== current || current.subscribers.size > 0) return;
        current.source?.close();
        workspaceStreams.delete(key);
      }, STREAM_CLOSE_GRACE_MS);
    }
  };
}
