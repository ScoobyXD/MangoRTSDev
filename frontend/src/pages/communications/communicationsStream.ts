import { connectAuthenticatedSse, type SseConnection, type SseEvent } from "../../auth/authenticatedSse.js";
import { readAuthConfig } from "../../auth/cognitoAuth.js";

type CommunicationsStreamSubscriber = {
  onEvent: (event: SseEvent) => void;
  onError?: (error: unknown) => void;
};

type CommunicationsStreamEntry = {
  subscribers: Set<CommunicationsStreamSubscriber>;
  source?: SseConnection;
};

let streamEntry: CommunicationsStreamEntry | null = null;

function ensureCommunicationsStream(entry: CommunicationsStreamEntry): void {
  if (entry.source) return;
  const apiBase = readAuthConfig().apiBase;
  entry.source = connectAuthenticatedSse(`${apiBase}/v1/communications/stream`, {
    onEvent(event: SseEvent) {
      for (const subscriber of Array.from(entry.subscribers)) subscriber.onEvent(event);
    },
    onError(error: unknown) {
      for (const subscriber of Array.from(entry.subscribers)) subscriber.onError?.(error);
    },
  });
}

export function subscribeCommunicationsStream(subscriber: CommunicationsStreamSubscriber): () => void {
  const entry = streamEntry ?? { subscribers: new Set<CommunicationsStreamSubscriber>() };
  streamEntry = entry;
  entry.subscribers.add(subscriber);
  ensureCommunicationsStream(entry);

  return () => {
    if (!streamEntry) return;
    streamEntry.subscribers.delete(subscriber);
    if (streamEntry.subscribers.size === 0) {
      streamEntry.source?.close();
      streamEntry = null;
    }
  };
}
