import { APIHTTPError, isTerminalAuthFailureError, requestJSON } from "../api/requestJSON.js";
import { RealtimeMutationBlockedError } from "../realtime/realtimeHealth.js";

export type AssistantMessage = { role: "user" | "assistant"; content: string };
export const ASSISTANT_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AssistantReasoningEffort = typeof ASSISTANT_REASONING_EFFORTS[number];
export const ASSISTANT_DEFAULT_REASONING_EFFORT: AssistantReasoningEffort = "medium";
const TRACE_STATUSES = ["prepared", "dispatched", "completed", "saved", "failed", "denied", "stopped", "uncertain"] as const;
export type AssistantTrace = { sequence: number; kind: string; status: typeof TRACE_STATUSES[number]; time: string; data: Record<string, unknown> };
export type AssistantResult = { finished: boolean; process?: { id: string; name: string }; node_id?: string };
export type AssistantTraceSnapshot = AssistantResult & { events: AssistantTrace[] };
export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; status: "running" | "completed" }
  | { type: "node"; node_id: string; process_id: string }
  | { type: "process"; process_id: string; name: string }
  | { type: "trace"; trace: AssistantTrace }
  | { type: "done" }
  | { type: "error"; message: string };

export const ASSISTANT_STOP_MESSAGE = "Stopped. Changes already completed in Mango may remain.";
export const ASSISTANT_MAX_TRACE_BYTES = 8 * 1024 * 1024;
const ASSISTANT_TRACE_STREAM_BYTES = ASSISTANT_MAX_TRACE_BYTES + 256 * 1024;
const STREAM_ERROR = "The reply was interrupted. Check Mango before repeating a request that changes data.";

export function isAssistantReasoningEffort(value: string): value is AssistantReasoningEffort {
  return (ASSISTANT_REASONING_EFFORTS as readonly string[]).includes(value);
}

export function assistantHistoryError(messages: AssistantMessage[]): string {
  if (messages.length > 24) {
    return "This conversation is full. Clear chat to start a new one.";
  }
  return "";
}

export function getAssistantStatus(apiBase: string, companyID: string, signal: AbortSignal): Promise<{ available: boolean; can_inspect_context: boolean }> {
  return requestJSON(apiBase, `/v1/assistant/status?company_id=${encodeURIComponent(companyID)}`, { signal });
}

export async function transcribeAssistantAudio(apiBase: string, companyID: string, audio: Blob, signal: AbortSignal): Promise<string> {
  try {
    return await requestJSON<string>(apiBase, `/v1/assistant/transcriptions?company_id=${encodeURIComponent(companyID)}`, {
      method: "POST", body: audio, signal, timeoutMs: 0,
      headers: { "Content-Type": audio.type, Accept: "application/x-ndjson" },
      consumeResponse: consumeTranscriptionStream,
    });
  } catch (error) {
    if (isTerminalAuthFailureError(error) || error instanceof RealtimeMutationBlockedError) throw error;
    if (signal.aborted) throw error;
    if (error instanceof APIHTTPError) {
      if (error.status === 403) throw new Error("Dictation is unavailable for this company or account.");
      if (error.status === 503) throw new Error("Dictation is unavailable. Ask your administrator to configure Deepgram.");
      if (error.status === 413 || error.bodyText.includes("transcription_audio_too_large")) throw new Error("The recording exceeds the 2 GB maximum. Please record again.");
      if (error.status === 415) throw new Error("This recording format is unsupported. Try another browser.");
      if (error.status === 422 || error.bodyText.includes("transcription_no_speech")) throw new Error("No speech was heard. Please try recording again.");
      if (error.status === 408 || error.status === 504 || error.bodyText.includes("transcription_timed_out")) throw new Error("Deepgram could not finish processing the recording in time. Please try again.");
    }
    throw new Error("The recording could not be transcribed. Check your connection and try again.");
  }
}

export async function consumeTranscriptionStream(response: Response): Promise<string> {
  if (!response.body || response.headers.get("Content-Type")?.split(";")[0].trim() !== "application/x-ndjson") {
    throw new Error("Invalid transcription response.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let fragments: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("The transcription was interrupted.");
      const lines = decoder.decode(value, { stream: true }).split("\n");
      for (let index = 0; index < lines.length; index++) {
        fragments.push(lines[index]);
        if (index === lines.length - 1) continue;
        const line = fragments.join("");
        fragments = [];
        const event: unknown = JSON.parse(line);
        if (!event || typeof event !== "object" || !("type" in event)) throw new Error("Invalid transcription event.");
        if (event.type === "progress") continue;
        if (event.type === "error" && "code" in event && typeof event.code === "string") {
          throw new APIHTTPError(502, "Transcription failed", event.code);
        }
        if (event.type !== "result" || !("text" in event) || typeof event.text !== "string") throw new Error("Invalid transcription result.");
        const text = event.text.trim();
        if (!text) throw new APIHTTPError(422, "No speech", "transcription_no_speech");
        return text;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function getAssistantTrace(apiBase: string, companyID: string, requestID: string, signal: AbortSignal): Promise<AssistantTraceSnapshot> {
  const snapshot = await requestJSON<AssistantTraceSnapshot>(apiBase, `/v1/assistant/trace?company_id=${encodeURIComponent(companyID)}&request_id=${encodeURIComponent(requestID)}`, { signal, timeoutMs: 7_000 });
  if (!isAssistantResult(snapshot) || !Array.isArray(snapshot.events)
    || snapshot.events.some((event, index) => !isAssistantTrace(event) || event.sequence !== index + 1)
    || (snapshot.node_id !== undefined && !snapshot.process)
    || new TextEncoder().encode(JSON.stringify(snapshot.events)).byteLength > ASSISTANT_TRACE_STREAM_BYTES) throw new Error(STREAM_ERROR);
  return snapshot;
}

export async function getAssistantResult(apiBase: string, companyID: string, requestID: string, signal: AbortSignal): Promise<AssistantResult> {
  const result = await requestJSON<AssistantResult>(apiBase, `/v1/assistant/result?company_id=${encodeURIComponent(companyID)}&request_id=${encodeURIComponent(requestID)}`, { signal, timeoutMs: 7_000 });
  if (!isAssistantResult(result) || Object.keys(result).some((key) => !["finished", "process", "node_id"].includes(key))) throw new Error(STREAM_ERROR);
  return result;
}

function isAssistantResult(value: unknown): value is AssistantResult {
  if (!value || typeof value !== "object") return false;
  const result = value as AssistantResult;
  return typeof result.finished === "boolean"
    && (result.process === undefined || Boolean(result.process && typeof result.process.id === "string" && result.process.id.trim() && typeof result.process.name === "string" && result.process.name.trim()))
    && (result.node_id === undefined || typeof result.node_id === "string" && Boolean(result.node_id.trim()));
}

export async function streamAssistantChat(
  apiBase: string,
  companyID: string,
  requestID: string,
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
    json: { request_id: requestID, reasoning_effort: reasoningEffort, messages, ...(processID ? { process_id: processID } : {}), ...(inspectContext ? { inspect_context: true } : {}) },
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
  let traceSequence = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error(STREAM_ERROR);
      bytes += value.byteLength;
      if (bytes > 512_000 + (inspectContext ? ASSISTANT_TRACE_STREAM_BYTES : 0)) throw new Error(STREAM_ERROR);
      buffer += decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const event: unknown = JSON.parse(data);
        if (!isAssistantEvent(event)) throw new Error(STREAM_ERROR);
        if (event.type === "trace") {
          if (!inspectContext || event.trace.sequence !== traceSequence + 1) throw new Error(STREAM_ERROR);
          traceSequence = event.trace.sequence;
        }
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
    || value.type === "process" && typeof value.process_id === "string" && Boolean(value.process_id.trim()) && typeof value.name === "string" && Boolean(value.name.trim())
    || value.type === "trace" && isAssistantTrace(value.trace)
    || value.type === "tool" && typeof value.name === "string" && (value.status === "running" || value.status === "completed");
}

function isAssistantTrace(value: unknown): value is AssistantTrace {
  if (!value || typeof value !== "object") return false;
  const trace = value as Record<string, unknown>;
  return Number.isSafeInteger(trace.sequence) && Number(trace.sequence) >= 1
    && typeof trace.kind === "string" && Boolean(trace.kind.trim())
    && typeof trace.status === "string" && (TRACE_STATUSES as readonly string[]).includes(trace.status)
    && typeof trace.time === "string" && Number.isFinite(Date.parse(trace.time))
    && Boolean(trace.data) && typeof trace.data === "object" && !Array.isArray(trace.data);
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
