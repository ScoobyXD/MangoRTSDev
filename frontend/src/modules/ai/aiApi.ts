import { APIHTTPError, isTerminalAuthFailureError, requestJSON } from "../api/requestJSON.js";

export type AIMessage = { message_id: number; role: "user" | "ai"; content: string; created_timestamp: string; run_id?: string };
export type AIChatSummary = { chat_id: string; name: string; created_timestamp?: string };
export type AIChat = AIChatSummary & {
  messages: AIMessage[]; active_run_id?: string; pending_submission?: AISubmission;
  has_older_messages?: boolean; next_message_offset?: number;
};
export type AIRun = { run_id: string; chat_id: string; status: string; output?: string; error?: string; pending_submission?: AISubmission; history?: Array<{ event: string }> };
export type AISubmission = { run_id: string; chat_id?: string; message: string };
export type AIEvent = { event: string; run_id: string; delta?: string; output?: string };

const aiPath = (path: string, companyID: string) => `/v1/ai${path}?company_id=${encodeURIComponent(companyID)}`;

export function listAIChats(apiBase: string, companyID: string, signal: AbortSignal, offset = 0) {
  return requestJSON<{ chats: AIChatSummary[]; has_more?: boolean; offset?: number; next_offset?: number }>(apiBase, `${aiPath("/chats", companyID)}&offset=${offset}`, { signal });
}

export function getAIChat(apiBase: string, companyID: string, id: string, signal: AbortSignal, offset = 0) {
  return requestJSON<AIChat>(apiBase, `${aiPath(`/chats/${encodeURIComponent(id)}`, companyID)}&offset=${offset}`, { signal });
}

export function createAIChat(apiBase: string, companyID: string, id: string, signal: AbortSignal) {
  return requestJSON<AIChatSummary>(apiBase, aiPath("/chats", companyID), {
    method: "POST", json: { company_id: companyID, chat_id: id, name: "New chat" }, signal, allowDuringRealtimeDegraded: true,
  });
}

export function createAIRun(apiBase: string, companyID: string, submission: AISubmission, signal: AbortSignal) {
  return requestJSON<AIRun>(apiBase, aiPath("/runs", companyID), {
    method: "POST", json: { ...submission, company_id: companyID }, signal,
    headers: { "Idempotency-Key": submission.run_id }, timeoutMs: 60_000, allowDuringRealtimeDegraded: true,
  });
}

export function getAIRun(apiBase: string, companyID: string, id: string, signal: AbortSignal) {
  return requestJSON<AIRun>(apiBase, aiPath(`/runs/${encodeURIComponent(id)}`, companyID), { signal });
}

export function cancelAIRun(apiBase: string, companyID: string, id: string, signal: AbortSignal) {
  return requestJSON<AIRun>(apiBase, aiPath(`/runs/${encodeURIComponent(id)}/cancel`, companyID), {
    method: "POST", json: { company_id: companyID }, signal, allowDuringRealtimeDegraded: true,
  });
}

export function watchAIRun(apiBase: string, companyID: string, id: string, signal: AbortSignal, onEvent: (event: AIEvent) => void) {
  return requestJSON<void>(apiBase, aiPath(`/runs/${encodeURIComponent(id)}/events`, companyID), {
    signal, timeoutMs: 0, headers: { Accept: "text/event-stream" },
    consumeResponse: (response) => consumeAIEvents(response, id, onEvent),
  });
}

// The Go API preserves native SSE event names and binds each frame to the local
// run ID. Reconnects read saved status before reopening the stream.
export async function consumeAIEvents(response: Response, runID: string, onEvent: (event: AIEvent) => void): Promise<void> {
  if (!response.body || response.headers.get("Content-Type")?.split(";")[0].trim() !== "text/event-stream") {
    throw new Error("AI chat returned an invalid stream.");
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
          || !("run_id" in event) || event.run_id !== runID) throw new Error("AI chat returned an invalid event.");
        if (event.event === "message.delta" && (!("delta" in event) || typeof event.delta !== "string")) throw new Error("AI chat returned invalid text.");
        if (event.event === "run.completed" && (!("output" in event) || typeof event.output !== "string")) throw new Error("AI chat returned an invalid response.");
        onEvent(event as AIEvent);
        if (["run.completed", "run.failed", "run.cancelled", "run.interrupted"].includes(event.event)) return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function aiErrorMessage(error: unknown): string {
  if (isTerminalAuthFailureError(error)) return error.message;
  if (aiErrorDetails(error).code === "ai_response_open_elsewhere") return "This response is open in another tab. Close that view, then resume here.";
  if (error instanceof APIHTTPError) {
    if (error.status === 403) return "AI chat is unavailable for this company or account.";
    if (error.status === 404) return "This saved chat or run is no longer available.";
    if (error.status === 409) return "This chat has a pending request. Resume it before sending again.";
    if (error.status === 503) return "AI chat is unavailable. Ask your administrator to configure Hermes.";
    if (error.status === 429) return "AI chat is busy. Please try again shortly.";
  }
  return "AI chat could not finish the request. Check your connection and try again.";
}

export function aiErrorDetails(error: unknown): { code: string; activeChatID?: string; activeRunID?: string } {
  if (!(error instanceof APIHTTPError)) return { code: "" };
  try {
    const body: unknown = JSON.parse(error.bodyText);
    if (!body || typeof body !== "object") return { code: "" };
    return {
      code: "error" in body && typeof body.error === "string" ? body.error : "",
      activeChatID: "active_chat_id" in body && typeof body.active_chat_id === "string" ? body.active_chat_id : undefined,
      activeRunID: "active_run_id" in body && typeof body.active_run_id === "string" ? body.active_run_id : undefined,
    };
  } catch { return { code: "" }; }
}

export function isUnsubmittedAIError(error: unknown): boolean {
  return error instanceof APIHTTPError && [400, 401, 403].includes(error.status);
}
