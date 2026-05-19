import { connectAuthenticatedSse, type SseConnection, type SseEvent } from "../../auth/authenticatedSse.js";

type WorkspaceStreamSubscriber = {
  onEvent: (event: SseEvent) => void;
  onError?: (error: unknown) => void;
};

type WorkspaceStreamEntry = {
  subscribers: Set<WorkspaceStreamSubscriber>;
  source?: SseConnection;
  closeTimer?: ReturnType<typeof setTimeout>;
};

const workspaceStreams = new Map<string, WorkspaceStreamEntry>();
const workspaceCursors = new Map<string, number>();
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

function buildWorkspaceStreamURL(apiBase: string, companyID: string, cursor: number | undefined): string {
  const params = new URLSearchParams({ company_id: companyID });
  if (cursor !== undefined) params.set("after_sequence", String(cursor));
  return `${apiBase}/v1/workspace/stream?${params.toString()}`;
}

function workspaceEventSequence(event: SseEvent): number | undefined {
  if (event.event !== "workspace" || event.id === undefined) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(event.id)) return undefined;
  const sequence = Number(event.id);
  return Number.isSafeInteger(sequence) ? sequence : undefined;
}

function shouldStoreWorkspaceEventID(key: string, event: SseEvent): boolean {
  const sequence = workspaceEventSequence(event);
  if (sequence === undefined) return false;
  const cursor = workspaceCursors.get(key);
  return cursor === undefined || sequence > cursor;
}

function updateWorkspaceCursor(key: string, event: SseEvent): boolean {
  const sequence = workspaceEventSequence(event);
  if (sequence === undefined) return true;
  const cursor = workspaceCursors.get(key);
  if (cursor !== undefined && sequence <= cursor) return false;
  workspaceCursors.set(key, sequence);
  return true;
}

function ensureWorkspaceStream(apiBase: string, companyID: string, key: string, entry: WorkspaceStreamEntry): void {
  if (entry.source) return;
  const cursor = workspaceCursors.get(key);
  entry.source = connectAuthenticatedSse(() => buildWorkspaceStreamURL(apiBase, companyID, workspaceCursors.get(key)), {
    lastEventId: cursor === undefined ? undefined : String(cursor),
    shouldStoreLastEventId: (event: SseEvent) => shouldStoreWorkspaceEventID(key, event),
    onEvent(event: SseEvent) {
      if (!updateWorkspaceCursor(key, event)) return;
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
    clearTimeout(entry.closeTimer);
    entry.closeTimer = undefined;
  }
  entry.subscribers.add(subscriber);
  ensureWorkspaceStream(apiBase, companyID, key, entry);

  return () => {
    const current = workspaceStreams.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
    if (current.subscribers.size === 0) {
      current.closeTimer = setTimeout(() => {
        const closingEntry = workspaceStreams.get(key);
        if (closingEntry !== current || current.subscribers.size > 0) return;
        current.source?.close();
        workspaceStreams.delete(key);
      }, STREAM_CLOSE_GRACE_MS);
    }
  };
}
