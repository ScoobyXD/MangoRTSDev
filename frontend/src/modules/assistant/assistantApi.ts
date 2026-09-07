import { APIHTTPError, isTerminalAuthFailureError, requestJSON } from "../api/requestJSON.js";

export type AssistantMessage = { id: string | number; role: "user" | "assistant"; content: string };
export type AssistantConversationSummary = { id: string; title: string; updated_at?: string | number };
export type AssistantConversation = AssistantConversationSummary & {
  messages: AssistantMessage[]; active_run_id?: string; pending_submission?: AssistantSubmission;
  has_older_messages?: boolean; next_message_offset?: number;
};
export type AssistantRun = { run_id: string; conversation_id?: string; session_id?: string; status: string; output?: string; error?: string };
export type AssistantSubmission = { request_id: string; conversation_id?: string; message: string };
export type AssistantEvent = { event: string; run_id: string; delta?: string; output?: string };

const assistantPath = (path: string, companyID: string) => `/v1/assistant${path}?company_id=${encodeURIComponent(companyID)}`;

export function listAssistantConversations(apiBase: string, companyID: string, signal: AbortSignal, offset = 0) {
  return requestJSON<{ conversations: AssistantConversationSummary[]; has_more?: boolean; offset?: number; next_offset?: number }>(apiBase, `${assistantPath("/conversations", companyID)}&offset=${offset}`, { signal });
}

export function getAssistantConversation(apiBase: string, companyID: string, id: string, signal: AbortSignal, offset = 0) {
  return requestJSON<AssistantConversation>(apiBase, `${assistantPath(`/conversations/${encodeURIComponent(id)}`, companyID)}&offset=${offset}`, { signal });
}

export function createAssistantRun(apiBase: string, companyID: string, submission: AssistantSubmission, signal: AbortSignal) {
  return requestJSON<AssistantRun>(apiBase, assistantPath("/runs", companyID), {
    method: "POST", json: { ...submission, company_id: companyID }, signal,
    headers: { "Idempotency-Key": submission.request_id }, timeoutMs: 60_000, allowDuringRealtimeDegraded: true,
  });
}

export function getAssistantRun(apiBase: string, companyID: string, id: string, signal: AbortSignal) {
  return requestJSON<AssistantRun>(apiBase, assistantPath(`/runs/${encodeURIComponent(id)}`, companyID), { signal });
}

export function cancelAssistantRun(apiBase: string, companyID: string, id: string, signal: AbortSignal) {
  return requestJSON<AssistantRun>(apiBase, assistantPath(`/runs/${encodeURIComponent(id)}/cancel`, companyID), {
    method: "POST", json: { company_id: companyID }, signal, allowDuringRealtimeDegraded: true,
  });
}

export function watchAssistantRun(apiBase: string, companyID: string, id: string, signal: AbortSignal, onEvent: (event: AssistantEvent) => void) {
  return requestJSON<void>(apiBase, assistantPath(`/runs/${encodeURIComponent(id)}/events`, companyID), {
    signal, timeoutMs: 0, headers: { Accept: "text/event-stream" },
    consumeResponse: (response) => consumeAssistantEvents(response, id, onEvent),
  });
}

// Hermes emits data-only SSE frames. Its queue has no replay cursor; reconnects
// read run status first, and the completion output replaces any partial text.
export async function consumeAssistantEvents(response: Response, runID: string, onEvent: (event: AssistantEvent) => void): Promise<void> {
  if (!response.body || response.headers.get("Content-Type")?.split(";")[0].trim() !== "text/event-stream") {
    throw new Error("Mango chat returned an invalid stream.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("The connection ended. Resume to check the saved response.");
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        if (line || !data.length) continue;
        const event: unknown = JSON.parse(data.join("\n"));
        data = [];
        if (!event || typeof event !== "object" || !("event" in event) || typeof event.event !== "string"
          || !("run_id" in event) || event.run_id !== runID) throw new Error("Mango chat returned an invalid event.");
        if (event.event === "message.delta" && (!("delta" in event) || typeof event.delta !== "string")) throw new Error("Mango chat returned invalid text.");
        if (event.event === "run.completed" && (!("output" in event) || typeof event.output !== "string")) throw new Error("Mango chat returned an invalid response.");
        onEvent(event as AssistantEvent);
        if (["run.completed", "run.failed", "run.cancelled", "run.interrupted"].includes(event.event)) return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function assistantErrorMessage(error: unknown): string {
  if (isTerminalAuthFailureError(error)) return error.message;
  if (assistantErrorCode(error) === "assistant_response_open_elsewhere") return "This response is open in another tab. Close that view, then resume here.";
  if (error instanceof APIHTTPError) {
    if (error.status === 403) return "Mango chat is unavailable for this company or account.";
    if (error.status === 404) return "This saved conversation or run is no longer available.";
    if (error.status === 409) return "This conversation has a pending request. Resume it before sending again.";
    if (error.status === 503) return "Mango chat is unavailable. Ask your administrator to configure Hermes.";
    if (error.status === 429) return "Mango chat is busy. Please try again shortly.";
  }
  return "Mango chat could not finish the request. Check your connection and try again.";
}

export function assistantErrorCode(error: unknown): string {
  if (!(error instanceof APIHTTPError)) return "";
  try {
    const body: unknown = JSON.parse(error.bodyText);
    return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "";
  } catch { return ""; }
}

export function isUnsubmittedAssistantError(error: unknown): boolean {
  return error instanceof APIHTTPError && [400, 401, 403].includes(error.status);
}
