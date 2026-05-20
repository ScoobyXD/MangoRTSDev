import { getApiAccessToken } from "../../auth/cognitoAuth.js";

export type RequestJSONInit = RequestInit & {
  json?: unknown;
  timeoutMs?: number;
  auth?: boolean;
  getAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  throwOnHTTPError?: boolean;
};

export type BoundRequestJSON = <T>(path: string, init?: RequestJSONInit) => Promise<T>;

export type RequestJSONResponse<T> = {
  body: T | undefined;
  status: number;
  statusText: string;
  ok: boolean;
  notModified: boolean;
  headers: Headers;
  etag?: string;
};

const DEFAULT_API_TIMEOUT_MS = 15_000;
const MAX_API_ERROR_MESSAGE_CHARS = 280;

export async function requestJSON<T>(apiBase: string, path: string, init: RequestJSONInit = {}): Promise<T> {
  const response = await requestJSONWithMeta<T>(apiBase, path, init);
  return response.body as T;
}

export async function requestJSONWithMeta<T>(apiBase: string, path: string, init: RequestJSONInit = {}): Promise<RequestJSONResponse<T>> {
  const {
    auth = true,
    fetchImpl = globalThis.fetch.bind(globalThis),
    getAccessToken = getApiAccessToken,
    json,
    throwOnHTTPError = true,
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    ...requestInit
  } = init;
  const headers = new Headers(requestInit.headers);
  let body = requestInit.body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  } else if (body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (auth && !headers.has("Authorization")) {
    const token = await getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const { signal, cleanup } = timeoutSignal(requestInit.signal, timeoutMs);
  try {
    const response = await fetchImpl(`${apiBase}${path}`, { ...requestInit, headers, body, signal });
    const responseHeaders = new Headers(response.headers);
    const notModified = response.status === 304;
    const ok = response.ok || notModified;
    if (!ok) {
      if (throwOnHTTPError) {
        throw new Error(sanitizeAPIErrorMessage(response.status, response.statusText, await response.text()));
      }
      return {
        body: undefined,
        status: response.status,
        statusText: response.statusText,
        ok: false,
        notModified: false,
        headers: responseHeaders,
        etag: responseHeaders.get("ETag") ?? undefined,
      };
    }
    const emptyBody = notModified || response.status === 204;
    return {
      body: emptyBody ? undefined : await response.json() as T,
      status: response.status,
      statusText: response.statusText,
      ok: true,
      notModified,
      headers: responseHeaders,
      etag: responseHeaders.get("ETag") ?? undefined,
    };
  } finally {
    cleanup();
  }
}

export function createRequestJSON(apiBase: string): BoundRequestJSON {
  return <T>(path: string, init?: RequestJSONInit): Promise<T> => requestJSON<T>(apiBase, path, init);
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

export function sanitizeAPIErrorMessage(status: number, statusText: string, bodyText: string): string {
  const statusLabel = statusText ? `${status} ${statusText}` : String(status);
  const fallback = `Request failed (${statusLabel})`;
  const text = bodyText.trim();
  if (!text) return fallback;

  const jsonMessage = readJSONErrorMessage(text);
  if (jsonMessage) return jsonMessage;
  if (looksLikeHTMLResponse(text)) return `${fallback}. Received an HTML error page from the API/CDN.`;

  const normalized = text.replace(/\s+/g, " ");
  return normalized.length > MAX_API_ERROR_MESSAGE_CHARS
    ? `${normalized.slice(0, MAX_API_ERROR_MESSAGE_CHARS - 3)}...`
    : normalized;
}

function readJSONErrorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return "";
    const record = parsed as Record<string, unknown>;
    for (const key of ["error", "message", "detail", "title"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return "";
  }
  return "";
}

function looksLikeHTMLResponse(text: string): boolean {
  const prefix = text.slice(0, 400).toLowerCase();
  return (
    prefix.startsWith("<!doctype html") ||
    prefix.startsWith("<html") ||
    prefix.includes("<head") ||
    prefix.includes("<body") ||
    prefix.includes("generated by cloudfront")
  );
}
