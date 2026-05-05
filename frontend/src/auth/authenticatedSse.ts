import { getApiAccessToken } from "./cognitoAuth.js";

export type SseEvent = {
  event: string;
  data: string;
  id?: string;
  retry?: number;
};

export type SseConnection = {
  close: () => void;
};

type TimerID = ReturnType<typeof setTimeout>;

type ConnectAuthenticatedSseOptions = {
  onEvent: (event: SseEvent) => void;
  onError?: (error: unknown) => void;
  getAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  setTimeoutImpl?: (handler: () => void, timeout: number) => TimerID;
  clearTimeoutImpl?: (id: TimerID) => void;
};

type DraftEvent = {
  event: string;
  dataLines: string[];
  id?: string;
  retry?: number;
};

export type SseParser = {
  push: (chunk: string) => SseEvent[];
  flush: () => SseEvent[];
};

export function createSseParser(): SseParser {
  let buffer = "";
  let draft: DraftEvent = newDraftEvent();

  const dispatch = (): SseEvent[] => {
    if (draft.dataLines.length === 0 && draft.event === "message" && draft.id === undefined && draft.retry === undefined) {
      draft = newDraftEvent();
      return [];
    }
    const event: SseEvent = {
      event: draft.event || "message",
      data: draft.dataLines.join("\n"),
      id: draft.id,
      retry: draft.retry,
    };
    draft = newDraftEvent();
    return [event];
  };

  const processLine = (line: string): SseEvent[] => {
    if (line === "") return dispatch();
    if (line.startsWith(":")) return [];
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    switch (field) {
      case "event":
        draft.event = value || "message";
        return [];
      case "data":
        draft.dataLines.push(value);
        return [];
      case "id":
        if (!value.includes("\0")) draft.id = value;
        return [];
      case "retry": {
        const retry = Number.parseInt(value, 10);
        if (Number.isFinite(retry) && retry >= 0) draft.retry = retry;
        return [];
      }
      default:
        return [];
    }
  };

  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return lines.flatMap(processLine);
    },
    flush(): SseEvent[] {
      const events = buffer ? processLine(buffer) : [];
      buffer = "";
      return [...events, ...dispatch()];
    },
  };
}

export function connectAuthenticatedSse(url: string, options: ConnectAuthenticatedSseOptions): SseConnection {
  const fetchImpl = options.fetchImpl ?? fetch.bind(window);
  const getAccessToken = options.getAccessToken ?? getApiAccessToken;
  const setTimer = options.setTimeoutImpl ?? setTimeout;
  const clearTimer = options.clearTimeoutImpl ?? clearTimeout;
  let retryDelayMs = options.retryDelayMs ?? 2000;
  let closed = false;
  let retryTimer: TimerID | null = null;
  let abortController: AbortController | null = null;

  const scheduleReconnect = () => {
    if (closed) return;
    retryTimer = setTimer(() => {
      retryTimer = null;
      void run();
    }, retryDelayMs);
  };

  const run = async () => {
    if (closed) return;
    abortController = new AbortController();
    const parser = createSseParser();
    try {
      const token = await getAccessToken();
      const headers = new Headers({
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      });
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetchImpl(url, {
        cache: "no-store",
        headers,
        signal: abortController.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`sse_${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          if (event.retry !== undefined) retryDelayMs = event.retry;
          options.onEvent(event);
        }
      }
      for (const event of parser.flush()) {
        if (event.retry !== undefined) retryDelayMs = event.retry;
        options.onEvent(event);
      }
    } catch (error) {
      const isAbortError = typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
      if (!closed && !isAbortError) {
        options.onError?.(error);
      }
    } finally {
      abortController = null;
    }
    scheduleReconnect();
  };

  void run();

  return {
    close() {
      closed = true;
      if (retryTimer !== null) {
        clearTimer(retryTimer);
        retryTimer = null;
      }
      abortController?.abort();
    },
  };
}

function newDraftEvent(): DraftEvent {
  return { event: "message", dataLines: [] };
}
