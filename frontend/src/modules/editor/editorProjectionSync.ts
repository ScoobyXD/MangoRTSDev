import { APIHTTPError, isTerminalAuthFailureError } from "../api/requestJSON.js";
import type { EditorProjectionItem } from "./editorProjection.js";
import type { LinkedEntityKind } from "./editorTypes.js";

const DRAFT_KEY_PREFIX = "mango-editor-projection-draft-v1";

export type EditorProjectionDraftScope = {
  userID: string;
  companyID: string;
  entityKind: LinkedEntityKind;
  entityID: string;
  informationID: string;
};

export type EditorProjectionDraft = {
  text: string;
  baseRevision: number;
  updatedAt: string;
};

export type EditorProjectionConflict = {
  current: EditorProjectionItem | null;
};

export type EditorSyncBlock = {
  reason: "revision_conflict" | "delivery_failed" | "authentication_required" | "draft_restored";
  target: EditorProjectionDraftScope;
  localText: string;
  current: EditorProjectionItem | null;
  message: string;
};

function cleanScopePart(value: string): string {
  return encodeURIComponent(value.trim());
}

export function editorProjectionDraftKey(scope: EditorProjectionDraftScope): string {
  return [
    DRAFT_KEY_PREFIX,
    cleanScopePart(scope.userID),
    cleanScopePart(scope.companyID),
    scope.entityKind,
    cleanScopePart(scope.entityID),
    cleanScopePart(scope.informationID),
  ].join(":");
}

function editorProjectionEntityDraftPrefix(scope: Omit<EditorProjectionDraftScope, "informationID">): string {
  return [
    DRAFT_KEY_PREFIX,
    cleanScopePart(scope.userID),
    cleanScopePart(scope.companyID),
    scope.entityKind,
    cleanScopePart(scope.entityID),
    "",
  ].join(":");
}

export function retainEditorProjectionDraft(storage: Storage | null, scope: EditorProjectionDraftScope, draft: EditorProjectionDraft): void {
  if (!storage || !scope.userID.trim() || !scope.companyID.trim() || !scope.entityID.trim() || !scope.informationID.trim()) return;
  try {
    storage.setItem(editorProjectionDraftKey(scope), JSON.stringify(draft));
  } catch {
    // The in-memory dirty state remains authoritative for this tab when storage is unavailable.
  }
}

export function readEditorProjectionDraft(storage: Storage | null, scope: EditorProjectionDraftScope): EditorProjectionDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(editorProjectionDraftKey(scope));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<EditorProjectionDraft>;
    if (typeof value.text !== "string" || !Number.isInteger(value.baseRevision) || (value.baseRevision ?? -1) < 0) return null;
    return { text: value.text, baseRevision: value.baseRevision as number, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "" };
  } catch {
    return null;
  }
}

export function listEditorProjectionDrafts(storage: Storage | null, scope: Omit<EditorProjectionDraftScope, "informationID">): Array<{ informationID: string; draft: EditorProjectionDraft }> {
  if (!storage) return [];
  const prefix = editorProjectionEntityDraftPrefix(scope);
  const drafts: Array<{ informationID: string; draft: EditorProjectionDraft }> = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const informationID = decodeURIComponent(key.slice(prefix.length));
      const draft = readEditorProjectionDraft(storage, { ...scope, informationID });
      if (draft) drafts.push({ informationID, draft });
    }
  } catch {
    return [];
  }
  return drafts.sort((left, right) => left.draft.updatedAt.localeCompare(right.draft.updatedAt));
}

export function clearEditorProjectionDraft(storage: Storage | null, scope: EditorProjectionDraftScope): void {
  if (!storage) return;
  try {
    storage.removeItem(editorProjectionDraftKey(scope));
  } catch {
    // A later successful save can retry cleanup.
  }
}

export function parseEditorProjectionConflict(cause: unknown): EditorProjectionConflict | null {
  const status = cause instanceof APIHTTPError ? cause.status : typeof cause === "object" && cause !== null && "status" in cause ? Number((cause as { status?: unknown }).status) : 0;
  const bodyText = cause instanceof APIHTTPError ? cause.bodyText : typeof cause === "object" && cause !== null && "bodyText" in cause ? String((cause as { bodyText?: unknown }).bodyText ?? "") : "";
  if (status !== 409) return null;
  try {
    const body = JSON.parse(bodyText) as { error?: string; current?: EditorProjectionItem | null };
    if (body.error !== "projection_revision_conflict") return null;
    return { current: body.current ?? null };
  } catch {
    return null;
  }
}

export function editorSyncBlockReason(cause: unknown): EditorSyncBlock["reason"] {
  if (isTerminalAuthFailureError(cause)) return "authentication_required";
  if (parseEditorProjectionConflict(cause)) return "revision_conflict";
  return "delivery_failed";
}

function isRetryableEditorWriteFailure(cause: unknown): boolean {
  if (isTerminalAuthFailureError(cause) || parseEditorProjectionConflict(cause)) return false;
  if (cause instanceof APIHTTPError) return cause.status === 408 || cause.status === 425 || cause.status === 429 || cause.status >= 500;
  return true;
}

export async function runEditorWriteWithBoundedRetry<T>(
  write: () => Promise<T>,
  options: { delaysMs?: readonly number[]; sleep?: (delayMs: number) => Promise<void> } = {},
): Promise<T> {
  const delays = options.delaysMs ?? [250, 750];
  const sleep = options.sleep ?? ((delayMs) => new Promise<void>((resolve) => window.setTimeout(resolve, delayMs)));
  let attempt = 0;
  for (;;) {
    try {
      return await write();
    } catch (cause) {
      if (!isRetryableEditorWriteFailure(cause) || attempt >= delays.length) throw cause;
      await sleep(delays[attempt] ?? 0);
      attempt += 1;
    }
  }
}
