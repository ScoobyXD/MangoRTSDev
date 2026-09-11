import { readAuthConfig } from "../../auth/cognitoAuth.js";
import { requestJSON, type RequestJSONInit } from "../api/requestJSON.js";

export type AISkill = { name: string; content: string };
export type AIItem = { id: string; role: "user" | "ai"; text: string; status?: string };
export type AIAction = { turn_id: string; call_id: string; name: string; arguments: Record<string, unknown>; state: "pending" | "executing" | "completed" | "failed" | "rejected"; output?: unknown; error?: string; consequential: boolean };
export type AISessionSummary = { id: string; prompt: string; created_at: string; stopped: boolean };
export type AISessionList = { sessions: AISessionSummary[]; models: string[]; default_model: string };
export type AISession = {
  id: string;
  model: string;
  prompt: string;
  stopped: boolean;
  status: "queued" | "in_progress" | "waiting" | "completed" | "failed" | "cancelled";
  instructions: string;
  skills: AISkill[];
  items: AIItem[];
  items_cursor: string;
  items_has_more: boolean;
  read_counts: Record<string, number>;
  actions: AIAction[];
  error?: string;
  created_at: string;
};

function requestAI<T>(url: string, init?: RequestJSONInit): Promise<T> {
  return requestJSON<T>(readAuthConfig().apiBase, url, { ...init, timeoutMs: 120000 });
}

function path(companyID: string, suffix = "", cursor = ""): string {
  const query = new URLSearchParams({ company_id: companyID });
  if (cursor) query.set("items_after", cursor);
  return `/v1/ai/sessions${suffix}?${query}`;
}

function sessionPath(companyID: string, id: string, suffix = "", cursor = ""): string {
  return path(companyID, `/${encodeURIComponent(id)}${suffix}`, cursor);
}

export function listAISessions(companyID: string, signal?: AbortSignal): Promise<AISessionList> {
  return requestAI(path(companyID), { signal });
}

export function getAISession(companyID: string, id: string, signal?: AbortSignal, cursor = ""): Promise<AISession> {
  return requestAI(sessionPath(companyID, id, "", cursor), { signal });
}

export function createAISession(companyID: string, input: { model: string; prompt: string; instructions: string; skills: AISkill[] }, signal?: AbortSignal): Promise<AISession> {
  return requestAI(path(companyID), { method: "POST", json: input, signal });
}

export function advanceAISession(companyID: string, id: string, signal?: AbortSignal, cursor = ""): Promise<AISession> {
  return requestAI(sessionPath(companyID, id, "/advance", cursor), { method: "POST", signal });
}

export function messageAISession(companyID: string, id: string, prompt: string, signal?: AbortSignal, cursor = ""): Promise<AISession> {
  return requestAI(sessionPath(companyID, id, "/messages", cursor), { method: "POST", json: { prompt }, signal });
}

export function decideAIAction(companyID: string, id: string, action: AIAction, approved: boolean, signal?: AbortSignal, cursor = ""): Promise<AISession> {
  return requestAI(sessionPath(companyID, id, `/actions/${encodeURIComponent(action.call_id)}`, cursor), { method: "POST", json: { turn_id: action.turn_id, approved }, signal });
}

export function cancelAISession(companyID: string, id: string): Promise<AISession> {
  return requestAI(sessionPath(companyID, id, "/cancel"), { method: "POST", allowDuringRealtimeDegraded: true });
}

export async function deleteAISession(companyID: string, id: string): Promise<void> {
  await requestAI(sessionPath(companyID, id), { method: "DELETE" });
}

export function createAILiveSession(companyID: string, sdp: string, signal?: AbortSignal): Promise<{ session_id: string; sdp: string }> {
  return requestAI(`/v1/ai/live?${new URLSearchParams({ company_id: companyID })}`, { method: "POST", json: { sdp }, signal });
}
