import { fetchCurrentUser, type CurrentUserResponse } from "../../auth/cognitoAuth.js";
import { subscribeRealtimeScope, type RealtimeCommunicationsEventMessage } from "../realtime/realtimeWebSocket.js";

type CommunicationsStreamEvent = {
  event: string;
  data: string;
};

type CommunicationsStreamSubscriber = {
  onEvent: (event: CommunicationsStreamEvent) => void;
  onError?: (error: unknown) => void;
};

type CommunicationsStreamEntry = {
  apiBase: string;
  companyID: string;
  subscribers: Set<CommunicationsStreamSubscriber>;
  unsubscribeRealtime?: () => void;
  pending: boolean;
  closeTimer?: ReturnType<typeof setTimeout>;
};

const streamEntries = new Map<string, CommunicationsStreamEntry>();
const STREAM_CLOSE_GRACE_MS = 1500;

function streamKey(apiBase: string, companyID: string): string {
  return `${apiBase.trim()}\x1f${companyID.trim()}`;
}

function currentUserCanUseCompany(current: CurrentUserResponse, companyID: string): boolean {
  const cleanCompanyID = companyID.trim();
  return !!cleanCompanyID && (current.is_dev_admin || current.memberships.some((membership) => membership.company_id === cleanCompanyID));
}

function ensureCommunicationsRealtime(entry: CommunicationsStreamEntry): void {
  if (entry.unsubscribeRealtime || entry.pending || !entry.companyID.trim()) return;
  entry.pending = true;
  void fetchCurrentUser()
    .then((current) => {
      const userID = current.user.user_id.trim();
      if (!userID || !currentUserCanUseCompany(current, entry.companyID) || streamEntries.get(streamKey(entry.apiBase, entry.companyID)) !== entry) return;
      entry.unsubscribeRealtime = subscribeRealtimeScope(entry.apiBase, entry.companyID, `communications:user:${userID}`, {
        onCommunicationsEvent(message: RealtimeCommunicationsEventMessage) {
          const event = { event: "communications", data: JSON.stringify(message.event) };
          for (const subscriber of Array.from(entry.subscribers)) subscriber.onEvent(event);
        },
        onError(error) {
          for (const subscriber of Array.from(entry.subscribers)) subscriber.onError?.(error);
        },
      });
    })
    .catch((error: unknown) => {
      for (const subscriber of Array.from(entry.subscribers)) subscriber.onError?.(error);
    })
    .finally(() => {
      entry.pending = false;
    });
}

export function subscribeCommunicationsStream(apiBase: string, companyID: string, subscriber: CommunicationsStreamSubscriber): () => void {
  const cleanApiBase = apiBase.trim();
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) return () => undefined;
  const key = streamKey(cleanApiBase, cleanCompanyID);
  const entry = streamEntries.get(key) ?? {
    apiBase: cleanApiBase,
    companyID: cleanCompanyID,
    subscribers: new Set<CommunicationsStreamSubscriber>(),
    pending: false,
  };
  streamEntries.set(key, entry);
  if (entry.closeTimer !== undefined) {
    clearTimeout(entry.closeTimer);
    entry.closeTimer = undefined;
  }
  entry.subscribers.add(subscriber);
  ensureCommunicationsRealtime(entry);

  return () => {
    const current = streamEntries.get(key);
    if (!current) return;
    current.subscribers.delete(subscriber);
    if (current.subscribers.size === 0 && current.closeTimer === undefined) {
      current.closeTimer = setTimeout(() => {
        if (streamEntries.get(key) !== current || current.subscribers.size > 0) return;
        current.unsubscribeRealtime?.();
        streamEntries.delete(key);
      }, STREAM_CLOSE_GRACE_MS);
    }
  };
}
