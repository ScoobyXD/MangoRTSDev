import { APIHTTPError, isTerminalAuthFailureError, requestJSON } from "../api/requestJSON.js";
import { RealtimeMutationBlockedError } from "../realtime/realtimeHealth.js";

export type AssistantMessage = { role: "user" | "assistant"; content: string };
export const ASSISTANT_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AssistantReasoningEffort = typeof ASSISTANT_REASONING_EFFORTS[number];
export const ASSISTANT_DEFAULT_REASONING_EFFORT: AssistantReasoningEffort = "medium";
export type AssistantContext = {
  step: number;
  input: unknown[];
  omitted_reasoning_items: number;
  model?: string;
  reasoning_effort?: string;
  instructions?: string;
  tools?: unknown[];
};
export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; status: "running" | "completed" }
  | { type: "node"; node_id: string; process_id: string }
  | { type: "context"; context: AssistantContext }
  | { type: "done" }
  | { type: "error"; message: string };

export const ASSISTANT_MAX_MESSAGE_CHARS = 8_000;
export const ASSISTANT_STOP_MESSAGE = "Stopped. Changes already completed in Mango may remain.";
const STREAM_ERROR = "The reply was interrupted. Check Mango before repeating a request that changes data.";

export function isAssistantReasoningEffort(value: string): value is AssistantReasoningEffort {
  return (ASSISTANT_REASONING_EFFORTS as readonly string[]).includes(value);
}

export function assistantHistoryError(messages: AssistantMessage[]): string {
  if (messages.length > 24 || messages.reduce((total, message) => total + message.content.length, 0) > 48_000) {
    return "This conversation is full. Clear chat to start a new one.";
  }
  return "";
}

export function getAssistantStatus(apiBase: string, companyID: string, signal: AbortSignal): Promise<{ available: boolean; can_inspect_context: boolean }> {
  return requestJSON(apiBase, `/v1/assistant/status?company_id=${encodeURIComponent(companyID)}`, { signal });
}

export async function streamAssistantChat(
  apiBase: string,
  companyID: string,
  messages: AssistantMessage[],
  reasoningEffort: AssistantReasoningEffort,
  signal: AbortSignal,
  onEvent: (event: AssistantEvent) => void,
  processID?: string,
  inspectContext = false,
): Promise<void> {
  const historyError = assistantHistoryError(messages);
  if (historyError) throw new Error(historyError);
  await requestJSON(apiBase, `/v1/assistant/chat?company_id=${encodeURIComponent(companyID)}`, {
    method: "POST",
    json: { request_id: crypto.randomUUID(), reasoning_effort: reasoningEffort, messages, ...(processID ? { process_id: processID } : {}), ...(inspectContext ? { inspect_context: true } : {}) },
    headers: { Accept: "text/event-stream" },
    signal,
    timeoutMs: 95_000,
    consumeResponse: (response) => consumeAssistantStream(response, onEvent, inspectContext),
  });
}

export async function consumeAssistantStream(response: Response, onEvent: (event: AssistantEvent) => void, inspectContext = false): Promise<void> {
  if (!response.body || !response.headers.get("Content-Type")?.includes("text/event-stream")) throw new Error(STREAM_ERROR);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error(STREAM_ERROR);
      bytes += value.byteLength;
      if (bytes > 512_000 + (inspectContext ? 2 * 1024 * 1024 : 0)) throw new Error(STREAM_ERROR);
      buffer += decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const event: unknown = JSON.parse(data);
        if (!isAssistantEvent(event)) throw new Error(STREAM_ERROR);
        if (event.type === "context" && !inspectContext) throw new Error(STREAM_ERROR);
        onEvent(event);
        if (event.type === "error" || event.type === "done") return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function isAssistantEvent(event: unknown): event is AssistantEvent {
  if (!event || typeof event !== "object") return false;
  const value = event as Record<string, unknown>;
  return value.type === "done"
    || value.type === "text" && typeof value.text === "string"
    || value.type === "error" && typeof value.message === "string"
    || value.type === "node" && typeof value.node_id === "string" && Boolean(value.node_id.trim()) && typeof value.process_id === "string" && Boolean(value.process_id.trim())
    || value.type === "context" && isAssistantContext(value.context)
    || value.type === "tool" && typeof value.name === "string" && (value.status === "running" || value.status === "completed");
}

function isAssistantContext(value: unknown): value is AssistantContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Record<string, unknown>;
  return Number.isInteger(context.step) && Number(context.step) >= 1 && Number(context.step) <= 9
    && Array.isArray(context.input)
    && Number.isInteger(context.omitted_reasoning_items) && Number(context.omitted_reasoning_items) >= 0
    && ["model", "reasoning_effort", "instructions"].every((key) => context[key] === undefined || typeof context[key] === "string")
    && (context.tools === undefined || Array.isArray(context.tools));
}

export function assistantErrorMessage(error: unknown): string {
  if (isTerminalAuthFailureError(error)) return "Your session expired. Sign in again.";
  if (error instanceof RealtimeMutationBlockedError) return error.message;
  if (error instanceof APIHTTPError) {
    if (error.status === 503) return "Mango chat is unavailable. Ask your administrator to configure it.";
    if (error.status === 403) return "Mango chat is unavailable for this company or account.";
    if (error.status === 409) return "This request is already running or was already sent. Check Mango before sending it again.";
    if (error.status === 429) return "Mango chat is busy. Wait before sending another message.";
  }
  return STREAM_ERROR;
}
