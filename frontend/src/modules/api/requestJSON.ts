export type RequestJSONInit = RequestInit & {
  json?: unknown;
  timeoutMs?: number;
};

const DEFAULT_API_TIMEOUT_MS = 15_000;

export async function requestJSON<T>(apiBase: string, path: string, init: RequestJSONInit = {}): Promise<T> {
  const { json, timeoutMs = DEFAULT_API_TIMEOUT_MS, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  let body = requestInit.body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  } else if (body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const { signal, cleanup } = timeoutSignal(requestInit.signal, timeoutMs);
  try {
    const response = await fetch(`${apiBase}${path}`, { ...requestInit, headers, body, signal });
    if (!response.ok) throw new Error(await response.text() || `Request failed (${response.status})`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  } finally {
    cleanup();
  }
}

function timeoutSignal(signal: AbortSignal | null | undefined, timeoutMs: number): { signal?: AbortSignal; cleanup: () => void } {
  if (timeoutMs <= 0) return { signal: signal ?? undefined, cleanup: () => {} };

  const controller = new AbortController();
  let timeoutID: ReturnType<typeof setTimeout> | undefined;
  const abortFromInput = () => controller.abort(signal?.reason);

  if (signal?.aborted) {
    abortFromInput();
  } else {
    signal?.addEventListener("abort", abortFromInput, { once: true });
    timeoutID = setTimeout(() => controller.abort(new DOMException("API request timed out", "TimeoutError")), timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutID !== undefined) clearTimeout(timeoutID);
      signal?.removeEventListener("abort", abortFromInput);
    },
  };
}
