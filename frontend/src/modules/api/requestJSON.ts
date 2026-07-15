import {
  getApiAccessToken,
  isAuthEnabled,
  isTerminalAuthFailureActive,
  markTerminalAuthFailure,
} from "../../auth/cognitoAuth.js";
import { RealtimeMutationBlockedError, shouldBlockRealtimeMutation } from "../realtime/realtimeHealth.js";

export type RequestJSONInit = RequestInit & {
  json?: unknown;
  timeoutMs?: number;
  auth?: boolean;
  getAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  throwOnHTTPError?: boolean;
  allowDuringRealtimeDegraded?: boolean;
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

export class APIHTTPError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly bodyText: string;

  constructor(status: number, statusText: string, bodyText: string) {
    super(sanitizeAPIErrorMessage(status, statusText, bodyText));
    this.name = "APIHTTPError";
    this.status = status;
    this.statusText = statusText;
    this.bodyText = bodyText;
  }
}

export class TerminalAuthFailureError extends Error {
  readonly reason: string;

  constructor(reason = "terminal_auth_failure") {
    super("Your session expired. Sign in again.");
    this.name = "TerminalAuthFailureError";
    this.reason = reason;
  }
}

export async function requestJSON<T>(apiBase: string, path: string, init: RequestJSONInit = {}): Promise<T> {
  const response = await requestJSONWithMeta<T>(apiBase, path, init);
  return response.body as T;
}

export async function requestJSONWithMeta<T>(apiBase: string, path: string, init: RequestJSONInit = {}): Promise<RequestJSONResponse<T>> {
  const {
    allowDuringRealtimeDegraded = false,
    auth = true,
    fetchImpl = globalThis.fetch.bind(globalThis),
    getAccessToken = getApiAccessToken,
    json,
    throwOnHTTPError = true,
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    ...requestInit
  } = init;
  const method = (requestInit.method ?? "GET").toUpperCase();
  if (!allowDuringRealtimeDegraded && shouldBlockRealtimeMutation(method, path)) {
    throw new RealtimeMutationBlockedError();
  }
  const headers = new Headers(requestInit.headers);
  let body = requestInit.body;
  const isFormDataBody = typeof FormData !== "undefined" && body instanceof FormData;
  if (json !== undefined) {
    body = JSON.stringify(json);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  } else if (body != null && !headers.has("Content-Type") && !isFormDataBody) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (auth && !headers.has("Authorization")) {
    if (isAuthEnabled() && isTerminalAuthFailureActive()) {
      throw new TerminalAuthFailureError("terminal_auth_failure_active");
    }
    const token = await getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    } else if (isAuthEnabled()) {
      markTerminalAuthFailure("missing_access_token");
      throw new TerminalAuthFailureError("missing_access_token");
    }
  }

  const { signal, cleanup } = timeoutSignal(requestInit.signal, timeoutMs);
  const startedAt = requestTimingNow();
  let responseStatus: number | undefined;
  try {
    const response = await fetchImpl(`${apiBase}${path}`, { ...requestInit, headers, body, signal });
    responseStatus = response.status;
    const responseHeaders = new Headers(response.headers);
    const notModified = response.status === 304;
    const ok = response.ok || notModified;
    if (!ok) {
      if (auth && response.status === 401) {
        markTerminalAuthFailure("http_401");
        throw new TerminalAuthFailureError("http_401");
      }
      if (throwOnHTTPError) {
        throw new APIHTTPError(response.status, response.statusText, await response.text());
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
    logBenchmarkRequestTiming(method, path, responseStatus, requestTimingNow() - startedAt);
    cleanup();
  }
}

export function isTerminalAuthFailureError(cause: unknown): cause is TerminalAuthFailureError {
  return cause instanceof TerminalAuthFailureError
    || (cause instanceof Error && cause.name === "TerminalAuthFailureError");
}

export function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError"
    || cause instanceof Error && cause.name === "AbortError";
}

export function isHTTPNotFoundError(cause: unknown): boolean {
  if (cause instanceof APIHTTPError) return cause.status === 404;
  if (!(cause instanceof Error)) return false;
  const message = cause.message.toLowerCase();
  return message.includes("404") || message.includes("not_found") || message.includes("not found");
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

function requestTimingNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function logBenchmarkRequestTiming(method: string, path: string, status: number | undefined, durationMs: number): void {
  if (!shouldLogBenchmarkRequestTiming(method, path)) return;
  const cleanPath = path.split("?")[0] || path;
  const statusLabel = status === undefined ? "error" : String(status);
  console.info(`request_timing method=${method} path=${cleanPath} status=${statusLabel} duration=${formatRequestTimingDuration(durationMs)}`);
}

function formatRequestTimingDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 10) return `${durationMs.toFixed(1)}ms`;
  return `${Math.round(durationMs)}ms`;
}

function shouldLogBenchmarkRequestTiming(method: string, path: string): boolean {
  const cleanPath = path.split("?")[0] || path;
  if (method === "POST" && cleanPath === "/v1/workspace/entity-batches") return true;
  if (method === "POST" && cleanPath === "/v2/gvic-matrix/nodes") return true;
  if (method === "POST" && /^\/v2\/gvic-matrix\/nodes\/[^/]+\/move$/.test(cleanPath)) return true;
  if (method === "POST" && /^\/v2\/logic-gates\/[^/]+\/nodes$/.test(cleanPath)) return true;
  if (method === "PUT" && /^\/v2\/logic-gates\/[^/]+\/nodes\/[^/]+\/state$/.test(cleanPath)) return true;
  if (method !== "GET") return false;
  return (
    cleanPath === "/v1/workspace/snapshot" ||
    cleanPath === "/v1/kanban/boards" ||
    cleanPath === "/v1/kanban/columns" ||
    cleanPath === "/v1/kanban/cards" ||
    cleanPath === "/v1/company-explorer/folders" ||
    cleanPath === "/v1/company-explorer/roots" ||
    cleanPath === "/v1/company-explorer/children" ||
    cleanPath === "/v1/map-layout" ||
    cleanPath === "/v1/nodes" ||
    cleanPath === "/v1/logic-gates" ||
    /^\/v2\/logic-gates\/[^/]+\/(work|view)$/.test(cleanPath) ||
    /^\/v2\/nodes\/[^/]+\/view$/.test(cleanPath)
  );
}
