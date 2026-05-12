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
  maxRetryDelayMs?: number;
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
  const baseRetryDelayMs = Math.max(250, options.retryDelayMs ?? 2000);
  const maxRetryDelayMs = Math.max(baseRetryDelayMs, options.maxRetryDelayMs ?? 30000);
  let retryDelayMs = baseRetryDelayMs;
  let closed = false;
  let retryTimer: TimerID | null = null;
  let abortController: AbortController | null = null;
  let visibilityListenerInstalled = false;

  const isDocumentHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

  const installVisibilityListener = () => {
    if (visibilityListenerInstalled || typeof document === "undefined") return;
    document.addEventListener("visibilitychange", onVisibilityChange);
    visibilityListenerInstalled = true;
  };

  const removeVisibilityListener = () => {
    if (!visibilityListenerInstalled || typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    visibilityListenerInstalled = false;
  };

  const waitForVisibleDocument = (): boolean => {
    if (!isDocumentHidden()) return false;
    installVisibilityListener();
    return true;
  };

  const shouldResetRetryDelay = (event: SseEvent): boolean => event.event !== "ready" && event.event !== "ping";

  function onVisibilityChange() {
    if (closed) return;
    if (isDocumentHidden()) {
      abortController?.abort();
      return;
    }
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    if (abortController !== null) return;
    void run();
  }

  const scheduleReconnect = () => {
    if (closed) return;
    if (waitForVisibleDocument()) return;
    const delay = retryDelayMs;
    retryDelayMs = Math.min(maxRetryDelayMs, Math.max(baseRetryDelayMs, retryDelayMs * 2));
    retryTimer = setTimer(() => {
      retryTimer = null;
      void run();
    }, delay);
  };

  const run = async () => {
    if (closed) return;
    if (waitForVisibleDocument()) return;
    installVisibilityListener();
    abortController = new AbortController();
    const parser = createSseParser();
    try {
      const token = await getAccessToken();
      const headers = new Headers({
        Accept: "text/event-stream",
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
          else if (shouldResetRetryDelay(event)) retryDelayMs = baseRetryDelayMs;
          options.onEvent(event);
        }
      }
      for (const event of parser.flush()) {
        if (event.retry !== undefined) retryDelayMs = event.retry;
        else if (shouldResetRetryDelay(event)) retryDelayMs = baseRetryDelayMs;
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

  installVisibilityListener();
  void run();

  return {
    close() {
      closed = true;
      if (retryTimer !== null) {
        clearTimer(retryTimer);
        retryTimer = null;
      }
      removeVisibilityListener();
      abortController?.abort();
    },
  };
}

function newDraftEvent(): DraftEvent {
  return { event: "message", dataLines: [] };
}
