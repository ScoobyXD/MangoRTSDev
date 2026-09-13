import { readAuthConfig } from "../../auth/cognitoAuth.js";
import { requestJSON, type RequestJSONInit } from "../api/requestJSON.js";

export type CtrlLoopStatus = "Awaiting file" | "Listening" | "Processing" | "Error";
export type CtrlLoopJobInput = { name: string; instructions: string; email_connection_id: string; time_zone: string };
export type CtrlLoopJob = CtrlLoopJobInput & {
  id: string;
  revision: number;
  status: CtrlLoopStatus;
  error?: string;
  file_name?: string;
  unseen_updates: number;
  last_updated?: string | null;
};
export type CtrlLoopMailbox = { email_connection_id: string; account_email: string; provider: string; status: string };
export type CtrlLoopJobs = { jobs: CtrlLoopJob[]; mailboxes: CtrlLoopMailbox[] };
export type CtrlLoopChange = {
  id: string; sheet: string; cell: string; previous_text: string; text: string;
  run_id: string; job_id: string; source_url: string; arrival_at: string; saved_at: string; seen: boolean;
};
export type CtrlLoopRun = { id: string; status: string; created_at: string; completed_at?: string; error?: string; changed_cells: number };
export type CtrlLoopHistory = { changes: CtrlLoopChange[]; runs: CtrlLoopRun[]; has_more: boolean };
export type CtrlLoopPreviewCell = { address: string; column: number; text: string; hyperlink?: string; formula?: string };
export type CtrlLoopPreview = {
  sheets: { name: string; rows: number; columns: number }[];
  sheet: { name: string; start_row: number; start_column: number; rows: { row: number; cells: CtrlLoopPreviewCell[] }[] };
};

function path(companyID: string, suffix = "", extra?: Record<string, string>): string {
  return `/v1/ctrl-loop/jobs${suffix}?${new URLSearchParams({ company_id: companyID, ...extra })}`;
}
function request<T>(url: string, init?: RequestJSONInit): Promise<T> {
  return requestJSON<T>(readAuthConfig().apiBase, url, init);
}
function jobPath(companyID: string, id: string, suffix = "", extra?: Record<string, string>): string {
  return path(companyID, `/${encodeURIComponent(id)}${suffix}`, extra);
}
export function listCtrlLoopJobs(companyID: string, signal?: AbortSignal): Promise<CtrlLoopJobs> {
  return request(path(companyID), { signal });
}
export function saveCtrlLoopJob(companyID: string, input: CtrlLoopJobInput, job?: CtrlLoopJob): Promise<CtrlLoopJob> {
  return request(job ? jobPath(companyID, job.id) : path(companyID), {
    method: job ? "PATCH" : "POST", json: { ...input, ...(job ? { revision: job.revision } : {}) },
  });
}
export function uploadCtrlLoopWorkbook(companyID: string, id: string, file: File): Promise<CtrlLoopJob> {
  if (!/\.xlsx$/i.test(file.name)) return Promise.reject(new Error("Choose an Excel .xlsx file."));
  return request(jobPath(companyID, id, "/workbook"), {
    method: "POST", body: file, timeoutMs: 120_000,
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "X-Filename": encodeURIComponent(file.name) },
  });
}
export function downloadCtrlLoopWorkbook(companyID: string, id: string, version: "original" | "current"): Promise<Blob> {
  return request(jobPath(companyID, id, "/workbook", { version }), {
    timeoutMs: 120_000, consumeResponse: (response) => response.blob(),
  });
}
export function previewCtrlLoopWorkbook(companyID: string, id: string, sheet = "", startRow = 1, startColumn = 1, signal?: AbortSignal): Promise<CtrlLoopPreview> {
  return request(jobPath(companyID, id, "/preview", { sheet, start_row: String(startRow), start_column: String(startColumn), row_count: "40", column_count: "20" }), { signal, timeoutMs: 120_000 });
}
export function getCtrlLoopHistory(companyID: string, id: string, beforeID = "", signal?: AbortSignal): Promise<CtrlLoopHistory> {
  return request(jobPath(companyID, id, "/changes", beforeID ? { before_id: beforeID } : undefined), { signal });
}
export function markCtrlLoopChangesSeen(companyID: string, id: string, changeIDs: string[], signal?: AbortSignal): Promise<void> {
  return request(jobPath(companyID, id, "/seen"), { method: "POST", json: { change_ids: changeIDs }, signal });
}

// Workbook contents are untrusted data. Only ordinary web links become clickable.
export function workbookWebLink(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function ctrlLoopTitle(jobs: Pick<CtrlLoopJob, "unseen_updates">[]): string {
  const count = jobs.reduce((total, job) => total + Math.max(0, job.unseen_updates), 0);
  return `${count ? `[${count}] ` : ""}[CTRL] Loop`;
}
