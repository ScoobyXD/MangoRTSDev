import type { CommunicationsEmailDraft, EmailMessage } from "../../modules/communications/communicationsApi.js";
import { deleteEmailDraft, getEmailSignature, listEmailDrafts, parseEmailAddressList, saveEmailDraft, saveEmailSignature } from "../../modules/communications/communicationsApi.js";
import { EDITOR_RICH_TEXT_PREFIX, editorBodyHasEmailContent, linkifyEditorPlainTextToHTML, sanitizeEditorDocumentHTML } from "../../modules/editor/richTextEditing.js";
import { emptyCompose, type ComposeAttachment, type ComposeState } from "./homeTypes.js";

const HOME_MAIL_DRAFTS_STORAGE_PREFIX = "mangorts.home.mailDrafts.v1";
const HOME_MAIL_SIGNATURE_STORAGE_PREFIX = "mangorts.home.mailSignature.v1";
const homeMailSignatureRemoteSaveQueues = new Map<string, Promise<void>>();
const homeMailSignatureLocalRevisions = new Map<string, number>();

export type HomeMailDraft = {
  id: string;
  userID: string;
  companyID: string;
  sharedInboxID: string;
  accountEmail: string;
  replyToMessageID: string;
  replyToMessage?: EmailMessage | null;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  attachments: ComposeAttachment[];
  scheduledAt: string;
  createdAt: string;
  updatedAt: string;
  pendingRemoteSync?: boolean;
};

function storageAvailable(): boolean {
  return typeof localStorage !== "undefined";
}

function storagePart(value: string, fallback: string): string {
  return value.trim() || fallback;
}

function draftsStorageKey(companyID: string, userID: string): string {
  return `${HOME_MAIL_DRAFTS_STORAGE_PREFIX}:${storagePart(companyID, "global")}:${storagePart(userID, "anonymous")}`;
}

function legacySignatureStorageKey(companyID: string, userID: string): string {
  return `${HOME_MAIL_SIGNATURE_STORAGE_PREFIX}:${storagePart(companyID, "global")}:${storagePart(userID, "anonymous")}`;
}

export function homeMailSignatureScopeKey(
  companyID: string,
  userID: string,
  sharedInboxID = "",
  accountEmail = "",
): string {
  const cleanSharedInboxID = sharedInboxID.trim();
  const scope = cleanSharedInboxID
    ? `shared:${encodeURIComponent(cleanSharedInboxID)}`
    : `personal:${encodeURIComponent(accountEmail.trim().toLowerCase() || "account")}`;
  return `${legacySignatureStorageKey(companyID, userID)}:${scope}`;
}

function homeMailSignaturePendingSyncKey(
  companyID: string,
  userID: string,
  sharedInboxID = "",
  accountEmail = "",
): string {
  return homeMailSignatureScopeKey(companyID, userID, sharedInboxID, accountEmail) + ":pending-sync";
}

function readPendingHomeMailSignatureSync(
  companyID: string,
  userID: string,
  sharedInboxID = "",
  accountEmail = "",
): string | null {
  if (!storageAvailable()) return null;
  return localStorage.getItem(homeMailSignaturePendingSyncKey(companyID, userID, sharedInboxID, accountEmail));
}

function markPendingHomeMailSignatureSync(
  companyID: string,
  userID: string,
  signature: string,
  sharedInboxID = "",
  accountEmail = "",
): void {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(homeMailSignaturePendingSyncKey(companyID, userID, sharedInboxID, accountEmail), signature);
  } catch {
    // The rejected remote save remains visible in compose state even when browser storage is unavailable.
  }
}

function clearPendingHomeMailSignatureSync(
  companyID: string,
  userID: string,
  signature: string,
  sharedInboxID = "",
  accountEmail = "",
): void {
  if (!storageAvailable()) return;
  const key = homeMailSignaturePendingSyncKey(companyID, userID, sharedInboxID, accountEmail);
  try {
    if (localStorage.getItem(key) === signature) localStorage.removeItem(key);
  } catch {
    // A stale retry marker is safe; the next load retries the idempotent signature upsert.
  }
}

function queueHomeMailSignatureRemoteSave(scopeKey: string, save: () => Promise<unknown>): Promise<void> {
  const previous = homeMailSignatureRemoteSaveQueues.get(scopeKey) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    await save();
  });
  homeMailSignatureRemoteSaveQueues.set(scopeKey, current);
  return current.finally(() => {
    if (homeMailSignatureRemoteSaveQueues.get(scopeKey) === current) {
      homeMailSignatureRemoteSaveQueues.delete(scopeKey);
    }
  });
}

function readHomeMailSignatureLocalRevision(scopeKey: string): number {
  return homeMailSignatureLocalRevisions.get(scopeKey) ?? 0;
}

function advanceHomeMailSignatureLocalRevision(scopeKey: string): void {
  homeMailSignatureLocalRevisions.set(scopeKey, readHomeMailSignatureLocalRevision(scopeKey) + 1);
}

function plainTextToEditorHTML(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line ? linkifyEditorPlainTextToHTML(line) : "<br>")
    .join("<br>");
}

function storedSignatureEditorHTML(signature: string): string {
  const cleanSignature = signature.trim();
  if (!cleanSignature) return "";
  if (cleanSignature.startsWith(EDITOR_RICH_TEXT_PREFIX)) {
    return sanitizeEditorDocumentHTML(cleanSignature.slice(EDITOR_RICH_TEXT_PREFIX.length));
  }
  return sanitizeEditorDocumentHTML(`<div>${plainTextToEditorHTML(cleanSignature)}</div>`);
}

function normalizedEditorText(value: string): string {
  return composeBodyDraftText(value).replace(/\s+/g, " ").trim();
}

function homeMailBodyWithoutSignature(body: string, signature: string): string {
  const cleanBody = body.trimEnd();
  const cleanSignature = signature.trim();
  if (!cleanBody || !cleanSignature) return cleanBody;
  if (!cleanBody.startsWith(EDITOR_RICH_TEXT_PREFIX)) {
    return cleanBody.endsWith(cleanSignature)
      ? cleanBody.slice(0, -cleanSignature.length).trimEnd()
      : cleanBody;
  }

  const bodyHTML = sanitizeEditorDocumentHTML(cleanBody.slice(EDITOR_RICH_TEXT_PREFIX.length)).trimEnd();
  const signatureHTML = storedSignatureEditorHTML(cleanSignature).trim();
  if (signatureHTML && bodyHTML.endsWith(signatureHTML)) {
    return EDITOR_RICH_TEXT_PREFIX + bodyHTML.slice(0, -signatureHTML.length).trimEnd();
  }
  return normalizedEditorText(cleanBody) === normalizedEditorText(cleanSignature) ? "" : cleanBody;
}

export function homeMailBodyHasSignature(body: string, signature: string): boolean {
  const cleanBody = body.trimEnd();
  const cleanSignature = signature.trim();
  if (!cleanBody || !cleanSignature) return false;
  if (!cleanBody.startsWith(EDITOR_RICH_TEXT_PREFIX)) return cleanBody.endsWith(cleanSignature);

  const bodyHTML = sanitizeEditorDocumentHTML(cleanBody.slice(EDITOR_RICH_TEXT_PREFIX.length)).trimEnd();
  const signatureHTML = storedSignatureEditorHTML(cleanSignature).trim();
  if (signatureHTML && bodyHTML.endsWith(signatureHTML)) return true;

  const bodyText = normalizedEditorText(cleanBody);
  const signatureText = normalizedEditorText(cleanSignature);
  return !!signatureText && (bodyText === signatureText || bodyText.endsWith(` ${signatureText}`));
}

export function applyHomeMailSignature(body: string, signature: string): string {
  const cleanSignature = signature.trim();
  if (!cleanSignature || homeMailBodyHasSignature(body, cleanSignature)) return body;

  const currentHTML = body.startsWith(EDITOR_RICH_TEXT_PREFIX)
    ? sanitizeEditorDocumentHTML(body.slice(EDITOR_RICH_TEXT_PREFIX.length))
    : body.trim()
      ? sanitizeEditorDocumentHTML(`<div>${plainTextToEditorHTML(body.trimEnd())}</div>`)
      : "";
  const signatureHTML = storedSignatureEditorHTML(cleanSignature);
  const spacerHTML = "<div><br></div><div><br></div>";
  return `${EDITOR_RICH_TEXT_PREFIX}${sanitizeEditorDocumentHTML(`${currentHTML}${spacerHTML}${signatureHTML}`)}`;
}

export function appendHomeMailPlainText(body: string, content: string): string {
  const cleanContent = content.trim();
  if (!cleanContent) return body;
  const currentHTML = body.startsWith(EDITOR_RICH_TEXT_PREFIX)
    ? sanitizeEditorDocumentHTML(body.slice(EDITOR_RICH_TEXT_PREFIX.length))
    : body.trim()
      ? sanitizeEditorDocumentHTML(`<div>${plainTextToEditorHTML(body.trimEnd())}</div>`)
      : "";
  const contentHTML = sanitizeEditorDocumentHTML(`<div>${plainTextToEditorHTML(cleanContent)}</div>`);
  const spacerHTML = currentHTML.trim() ? "<div><br></div><div><br></div>" : "";
  return `${EDITOR_RICH_TEXT_PREFIX}${sanitizeEditorDocumentHTML(`${currentHTML}${spacerHTML}${contentHTML}`)}`;
}

export function createHomeMailDraftID(): string {
  return `draft:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

function emailDraftScopeSegment(sharedInboxID: string, accountEmail = "", userID = ""): string {
  const cleanSharedInboxID = sharedInboxID.trim();
  if (cleanSharedInboxID) return cleanSharedInboxID;
  const cleanUserID = userID.trim();
  const cleanAccountEmail = accountEmail.trim().toLowerCase();
  if (cleanUserID || cleanAccountEmail) return `personal:${cleanUserID || "user"}:${cleanAccountEmail || "account"}`;
  return "personal";
}

export function createHomeMailReplyDraftID(sharedInboxID: string, replyToMessageID: string, accountEmail = "", userID = ""): string {
  const cleanReplyToMessageID = replyToMessageID.trim();
  if (!cleanReplyToMessageID) return createHomeMailDraftID();
  const scope = emailDraftScopeSegment(sharedInboxID, accountEmail, userID);
  return `draft:reply:${encodeURIComponent(scope)}:${encodeURIComponent(cleanReplyToMessageID)}`;
}

export function createHomeMailForwardDraftID(sharedInboxID: string, messageID: string, accountEmail = "", userID = ""): string {
  const cleanMessageID = messageID.trim();
  if (!cleanMessageID) return createHomeMailDraftID();
  const scope = emailDraftScopeSegment(sharedInboxID, accountEmail, userID);
  return `draft:forward:${encodeURIComponent(scope)}:${encodeURIComponent(cleanMessageID)}`;
}

function normalizeComposeAttachment(raw: unknown): ComposeAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<ComposeAttachment> & { attachment_id?: string };
  const attachmentID = (item.attachmentID ?? item.attachment_id ?? "").trim();
  if (!attachmentID) return null;
  return {
    id: item.id?.trim() || attachmentID,
    attachmentID,
    filename: item.filename?.trim() || "attachment",
    contentType: item.contentType?.trim() || "application/octet-stream",
    size: Number.isFinite(item.size) ? Math.max(0, Math.round(item.size ?? 0)) : 0,
  };
}

function cloneAttachments(attachments: ComposeAttachment[] | undefined): ComposeAttachment[] {
  return (attachments ?? [])
    .map(normalizeComposeAttachment)
    .filter((attachment): attachment is ComposeAttachment => Boolean(attachment));
}

function normalizeDraft(raw: unknown, companyID: string, userID: string): HomeMailDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<HomeMailDraft>;
  const id = item.id?.trim();
  if (!id) return null;
  const createdAt = item.createdAt?.trim() || item.updatedAt?.trim() || new Date().toISOString();
  const updatedAt = item.updatedAt?.trim() || createdAt;
  return {
    id,
    userID: userID.trim(),
    companyID: companyID.trim(),
    sharedInboxID: item.sharedInboxID?.trim() ?? "",
    accountEmail: item.accountEmail?.trim() ?? "",
    replyToMessageID: item.replyToMessageID?.trim() ?? "",
    replyToMessage: item.replyToMessage ? cloneMessage(item.replyToMessage) : null,
    to: item.to ?? "",
    cc: item.cc ?? "",
    bcc: item.bcc ?? "",
    subject: item.subject ?? "",
    body: item.body ?? "",
    attachments: Array.isArray(item.attachments) ? cloneAttachments(item.attachments) : [],
    scheduledAt: item.scheduledAt?.trim() ?? "",
    createdAt,
    updatedAt,
    pendingRemoteSync: item.pendingRemoteSync === true,
  };
}

export function readHomeMailDrafts(companyID: string, userID: string): HomeMailDraft[] {
  if (!storageAvailable()) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(draftsStorageKey(companyID, userID)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeDraft(item, companyID, userID))
      .filter((item): item is HomeMailDraft => !!item)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  } catch {
    return [];
  }
}

export function homeMailDraftMatchesScope(
  draft: HomeMailDraft,
  sharedInboxID = "",
  accountEmail = "",
): boolean {
  const cleanSharedInboxID = sharedInboxID.trim();
  if (cleanSharedInboxID) return draft.sharedInboxID.trim() === cleanSharedInboxID;
  if (draft.sharedInboxID.trim()) return false;
  const cleanAccountEmail = accountEmail.trim().toLowerCase();
  return !!cleanAccountEmail && draft.accountEmail.trim().toLowerCase() === cleanAccountEmail;
}

export function readHomeMailDraftsForScope(
  companyID: string,
  userID: string,
  sharedInboxID = "",
  accountEmail = "",
): HomeMailDraft[] {
  return readHomeMailDrafts(companyID, userID)
    .filter((draft) => homeMailDraftMatchesScope(draft, sharedInboxID, accountEmail));
}

function writeHomeMailDrafts(companyID: string, userID: string, drafts: HomeMailDraft[]): HomeMailDraft[] {
  const sorted = mergeHomeMailDrafts(drafts, []);
  try {
    if (storageAvailable()) localStorage.setItem(draftsStorageKey(companyID, userID), JSON.stringify(sorted));
  } catch {
    return readHomeMailDrafts(companyID, userID);
  }
  return sorted;
}

type APIRequestFailure = Error & {
  code?: unknown;
  status?: unknown;
};

export function homeMailDraftScopeFailureRequiresLocalPurge(error: unknown): boolean {
  const failure = error instanceof Error ? error as APIRequestFailure : null;
  const status = typeof failure?.status === "number" ? failure.status : 0;
  const code = typeof failure?.code === "string" ? failure.code.trim().toLowerCase() : "";
  if (status === 401 || status === 403) return true;
  if (new Set([
    "access_denied",
    "company_access_denied",
    "company_not_found",
    "email_account_not_connected",
    "email_account_required",
    "nylas_not_connected",
    "nylas_reauth_required",
    "shared_inbox_email_account_not_connected",
    "shared_inbox_not_found",
    "shared_inbox_not_mailbox",
  ]).has(code)) return true;

  // Preserve compatibility with callers that still throw plain Errors without
  // the structured API status/code metadata installed by apiFetchJSON.
  const message = failure?.message.trim().toLowerCase() ?? "";
  return message === "you are not signed in."
    || message === "you do not have access to this resource."
    || message === "you do not have access to perform this action."
    || message === "connect your mailbox before opening home."
    || message === "email access expired. disconnect and reconnect your mailbox."
    || message === "company_access_denied"
    || message === "email_account_not_connected"
    || message === "email_account_required"
    || message === "shared_inbox_email_account_not_connected"
    || message === "shared_inbox_not_found"
    || message === "shared_inbox_not_mailbox";
}

export async function loadHomeMailDrafts(
  companyID: string,
  userID: string,
  sharedInboxID = "",
  accountEmail = "",
): Promise<HomeMailDraft[]> {
  const allLocalDrafts = readHomeMailDrafts(companyID, userID);
  const localDrafts = allLocalDrafts.filter((draft) => homeMailDraftMatchesScope(draft, sharedInboxID, accountEmail));
  const otherScopeDrafts = allLocalDrafts.filter((draft) => !homeMailDraftMatchesScope(draft, sharedInboxID, accountEmail));
  try {
    const scope = { sharedInboxID: sharedInboxID.trim() || undefined, accountEmail: accountEmail.trim() || undefined };
    const remoteDrafts = (await listEmailDrafts(companyID, scope))
      .map((draft) => homeMailDraftFromRemote(draft, companyID, userID))
      .filter((draft): draft is HomeMailDraft => Boolean(draft))
      .filter((draft) => homeMailDraftMatchesScope(draft, sharedInboxID, accountEmail));
    const supersededRemoteDraftIDs = supersededHomeMailDraftIDs(remoteDrafts);
    if (supersededRemoteDraftIDs.length > 0) {
      await Promise.all(supersededRemoteDraftIDs.map((draftID) => deleteEmailDraft(companyID, draftID, scope).catch(() => undefined)));
    }
    const activeRemoteDrafts = mergeHomeMailDrafts(remoteDrafts, []);
    const remoteByID = new Map(remoteDrafts.map((draft) => [draft.id, draft]));
    const pendingLocalDrafts = localDrafts.filter((draft) => (
      draft.pendingRemoteSync === true
      && (
        !remoteByID.has(draft.id)
        || Date.parse(draft.updatedAt) > Date.parse(remoteByID.get(draft.id)?.updatedAt ?? "")
      )
      && composeHasDraftContent(homeMailDraftToCompose(draft), "")
    ));
    const migratedDrafts = (await Promise.all(pendingLocalDrafts.map((draft) => saveHomeMailDraftToDatabase(draft).catch(() => null))))
      .filter((draft): draft is HomeMailDraft => Boolean(draft));
    const failedPendingDraftIDs = new Set(pendingLocalDrafts.map((draft) => draft.id));
    for (const migrated of migratedDrafts) failedPendingDraftIDs.delete(migrated.id);
    const failedPendingDrafts = pendingLocalDrafts.filter((draft) => failedPendingDraftIDs.has(draft.id));
    const scopedDrafts = mergeHomeMailDrafts([...activeRemoteDrafts, ...migratedDrafts], failedPendingDrafts);
    writeHomeMailDrafts(companyID, userID, [...otherScopeDrafts, ...scopedDrafts]);
    return scopedDrafts;
  } catch (error) {
    if (homeMailDraftScopeFailureRequiresLocalPurge(error)) {
      writeHomeMailDrafts(companyID, userID, otherScopeDrafts);
      return [];
    }
    return localDrafts;
  }
}

export async function syncHomeMailDraftFromCompose(
  companyID: string,
  userID: string,
  compose: ComposeState,
  signature: string,
): Promise<HomeMailDraft[]> {
  const priorDraft = compose.draftID.trim()
    ? readHomeMailDrafts(companyID, userID).find((item) => item.id === compose.draftID.trim()) ?? null
    : null;
  const localDrafts = saveHomeMailDraftFromCompose(companyID, userID, compose, signature);
  try {
    const draftID = compose.draftID.trim();
    const draft = draftID ? localDrafts.find((item) => item.id === draftID) : null;
    if (draft) {
      const saved = await saveHomeMailDraftToDatabase(draft);
      if (saved) {
        const allDrafts = readHomeMailDrafts(companyID, userID);
        writeHomeMailDrafts(companyID, userID, [saved, ...allDrafts.filter((item) => item.id !== saved.id)]);
      }
    } else if (draftID) {
      if (priorDraft) {
        await deleteEmailDraft(companyID, draftID, {
          sharedInboxID: priorDraft.sharedInboxID || undefined,
          accountEmail: priorDraft.accountEmail || undefined,
        });
      }
    }
    return loadHomeMailDrafts(companyID, userID, compose.sharedInboxID, compose.accountEmail);
  } catch {
    return localDrafts;
  }
}

export async function deleteHomeMailDraftRemote(companyID: string, userID: string, draftID: string): Promise<HomeMailDraft[]> {
  const existing = readHomeMailDrafts(companyID, userID).find((draft) => draft.id === draftID.trim()) ?? null;
  const localDrafts = deleteHomeMailDraft(companyID, userID, draftID);
  if (!existing) return localDrafts;
  try {
    await deleteEmailDraft(companyID, draftID, {
      sharedInboxID: existing.sharedInboxID || undefined,
      accountEmail: existing.accountEmail || undefined,
    });
    return loadHomeMailDrafts(companyID, userID, existing.sharedInboxID, existing.accountEmail);
  } catch {
    return localDrafts;
  }
}

export async function deleteHomeMailDraftsRemote(companyID: string, userID: string, draftIDs: string[]): Promise<HomeMailDraft[]> {
  const cleanDraftIDs = new Set(draftIDs.map((draftID) => draftID.trim()).filter(Boolean));
  const existingDrafts = readHomeMailDrafts(companyID, userID).filter((draft) => cleanDraftIDs.has(draft.id));
  const localDrafts = deleteHomeMailDrafts(companyID, userID, draftIDs);
  try {
    await Promise.all(existingDrafts.map((draft) => deleteEmailDraft(companyID, draft.id, {
      sharedInboxID: draft.sharedInboxID || undefined,
      accountEmail: draft.accountEmail || undefined,
    })));
    return localDrafts;
  } catch {
    return localDrafts;
  }
}

async function saveHomeMailDraftToDatabase(draft: HomeMailDraft): Promise<HomeMailDraft | null> {
  const saved = await saveEmailDraft({
    companyID: draft.companyID,
    draftID: draft.id,
    sharedInboxID: draft.sharedInboxID || undefined,
    accountEmail: draft.accountEmail || undefined,
    kind: homeMailDraftKind(draft),
    sourceMessageID: draft.replyToMessageID || undefined,
    replyToMessageID: draft.replyToMessageID || undefined,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    bodyEditorHTML: draft.body,
    replyToMessage: draft.replyToMessage ?? null,
    scheduledSendTimestamp: draft.scheduledAt,
  });
  return homeMailDraftFromRemote(saved, draft.companyID, draft.userID);
}

function homeMailDraftFromRemote(draft: CommunicationsEmailDraft, companyID: string, userID: string): HomeMailDraft | null {
  const id = draft.draft_id?.trim();
  if (!id) return null;
  return normalizeDraft({
    id,
    userID,
    companyID,
    sharedInboxID: draft.shared_inbox_id ?? "",
    accountEmail: draft.account_email ?? draft.personal_account_email ?? "",
    replyToMessageID: draft.source_message_id ?? "",
    replyToMessage: draft.reply_to_message ?? null,
    to: draft.to_recipients ?? "",
    cc: draft.cc_recipients ?? "",
    bcc: draft.bcc_recipients ?? "",
    subject: draft.subject ?? "",
    body: draft.body_editor_html ?? "",
    attachments: remoteDraftAttachments(draft),
    scheduledAt: scheduledTimestampForCompose(draft.scheduled_send_timestamp ?? ""),
    createdAt: draft.created_timestamp,
    updatedAt: draft.updated_timestamp,
    pendingRemoteSync: false,
  }, companyID, userID);
}

function remoteDraftAttachments(draft: CommunicationsEmailDraft): ComposeAttachment[] {
  return (draft.attachments ?? [])
    .map((link) => ({
      id: link.attachment_id?.trim() || link.resource_attachment_id?.trim() || "",
      attachmentID: link.attachment_id?.trim() || "",
      filename: link.attachment?.original_filename?.trim() || "attachment",
      contentType: link.attachment?.mime_type?.trim() || "application/octet-stream",
      size: Number.isFinite(link.attachment?.byte_size) ? Math.max(0, Math.round(link.attachment?.byte_size ?? 0)) : 0,
    }))
    .filter((attachment) => attachment.attachmentID);
}

export function mergeHomeMailDrafts(primary: HomeMailDraft[], secondary: HomeMailDraft[]): HomeMailDraft[] {
  const byDraftKey = new Map<string, HomeMailDraft>();
  for (const draft of [...secondary, ...primary]) {
    const key = homeMailDraftSemanticKey(draft);
    const existing = byDraftKey.get(key);
    if (!existing || Date.parse(draft.updatedAt) >= Date.parse(existing.updatedAt)) {
      byDraftKey.set(key, draft);
    }
  }
  return [...byDraftKey.values()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function supersededHomeMailDraftIDs(drafts: HomeMailDraft[]): string[] {
  const activeIDs = new Set(mergeHomeMailDrafts(drafts, []).map((draft) => draft.id));
  return Array.from(new Set(drafts.map((draft) => draft.id).filter((draftID) => !activeIDs.has(draftID))));
}

function homeMailDraftSemanticKey(draft: HomeMailDraft): string {
  const replyMessageID = draft.replyToMessageID.trim();
  const scope = draft.sharedInboxID.trim()
    ? `shared:${draft.sharedInboxID.trim()}`
    : `personal:${draft.userID.trim()}:${draft.accountEmail.trim().toLowerCase()}`;
  return replyMessageID ? `reply:${scope}:${replyMessageID}` : `draft:${draft.id}`;
}

function homeMailDraftKind(draft: HomeMailDraft): "compose" | "reply" | "forward" {
  if (draft.id.startsWith("draft:reply:")) return "reply";
  if (draft.id.startsWith("draft:forward:")) return "forward";
  return "compose";
}

function scheduledTimestampForCompose(value: string): string {
  const timestamp = Date.parse(value.trim());
  if (!Number.isFinite(timestamp)) return value.trim();
  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function deleteHomeMailDraft(companyID: string, userID: string, draftID: string): HomeMailDraft[] {
  const cleanID = draftID.trim();
  if (!cleanID) return readHomeMailDrafts(companyID, userID);
  const drafts = readHomeMailDrafts(companyID, userID).filter((draft) => draft.id !== cleanID);
  return writeHomeMailDrafts(companyID, userID, drafts);
}

export function deleteHomeMailDrafts(companyID: string, userID: string, draftIDs: string[]): HomeMailDraft[] {
  const cleanIDs = new Set(draftIDs.map((draftID) => draftID.trim()).filter(Boolean));
  if (cleanIDs.size === 0) return readHomeMailDrafts(companyID, userID);
  const drafts = readHomeMailDrafts(companyID, userID).filter((draft) => !cleanIDs.has(draft.id));
  return writeHomeMailDrafts(companyID, userID, drafts);
}

export function composeHasDraftContent(compose: ComposeState, signature: string): boolean {
  const body = homeMailBodyWithoutSignature(compose.body, signature);
  return !!(
    compose.to.trim()
    || compose.cc.trim()
    || compose.bcc.trim()
    || compose.subject.trim()
    || compose.attachments.length > 0
    || compose.scheduledAt.trim()
    || editorBodyHasEmailContent(body)
  );
}

function composeBodyDraftText(value: string): string {
  const body = value.trim();
  if (!body.startsWith(EDITOR_RICH_TEXT_PREFIX)) return body;
  return body
    .slice(EDITOR_RICH_TEXT_PREFIX.length)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/(?:&#39;|&apos;)/g, "'")
    .replace(/&#96;/g, "`")
    .replace(/\s+/g, " ")
    .trim();
}

export function saveHomeMailDraftFromCompose(
  companyID: string,
  userID: string,
  compose: ComposeState,
  signature: string,
): HomeMailDraft[] {
  if (!compose.open) return readHomeMailDrafts(companyID, userID);
  if (!composeHasDraftContent(compose, signature)) {
    return compose.draftID ? deleteHomeMailDraft(companyID, userID, compose.draftID) : readHomeMailDrafts(companyID, userID);
  }
  const now = new Date().toISOString();
  const drafts = readHomeMailDrafts(companyID, userID);
  const existing = compose.draftID ? drafts.find((draft) => draft.id === compose.draftID) : null;
  const draft: HomeMailDraft = {
    id: existing?.id ?? (compose.draftID.trim() || createHomeMailDraftID()),
    userID: userID.trim(),
    companyID: companyID.trim(),
    sharedInboxID: compose.sharedInboxID.trim(),
    accountEmail: compose.accountEmail.trim(),
    replyToMessageID: compose.replyToMessageID.trim(),
    replyToMessage: compose.replyToMessage ? cloneMessage(compose.replyToMessage) : null,
    to: compose.to,
    cc: compose.cc,
    bcc: compose.bcc,
    subject: compose.subject,
    body: compose.body,
    attachments: cloneAttachments(compose.attachments),
    scheduledAt: compose.scheduledAt.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    pendingRemoteSync: true,
  };
  return writeHomeMailDrafts(companyID, userID, [draft, ...drafts.filter((item) => item.id !== draft.id)]);
}

export function homeMailDraftToCompose(draft: HomeMailDraft): ComposeState {
  return {
    ...emptyCompose,
    open: true,
    draftID: draft.id,
    sharedInboxID: draft.sharedInboxID,
    accountEmail: draft.accountEmail,
    replyToMessageID: draft.replyToMessageID,
    replyToMessage: draft.replyToMessage ? cloneMessage(draft.replyToMessage) : null,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    body: draft.body,
    attachments: cloneAttachments(draft.attachments),
    scheduledAt: draft.scheduledAt,
  };
}

export function homeMailDraftToMessage(draft: HomeMailDraft): EmailMessage {
  const updatedAtMs = Date.parse(draft.updatedAt);
  const bodySnippet = composeBodyDraftText(draft.body).replace(/\s+/g, " ").trim();
  const inlineContentSnippet = !bodySnippet && editorBodyHasEmailContent(draft.body) ? "Inline image" : "";
  const attachmentSnippet = draft.attachments.length === 0 ? "" : `${draft.attachments.length} attachment${draft.attachments.length === 1 ? "" : "s"}`;
  return {
    id: draft.id,
    subject: draft.subject.trim() || "(no subject)",
    snippet: bodySnippet || inlineContentSnippet || attachmentSnippet || "Draft",
    body: draft.body,
    date: Number.isFinite(updatedAtMs) ? Math.floor(updatedAtMs / 1000) : undefined,
    unread: false,
    starred: false,
    from: draft.accountEmail ? [{ email: draft.accountEmail }] : undefined,
    to: parseEmailAddressList(draft.to),
    cc: parseEmailAddressList(draft.cc),
    bcc: parseEmailAddressList(draft.bcc),
    attachments: draft.attachments.map((attachment) => ({
      id: attachment.attachmentID,
      attachment_id: attachment.attachmentID,
      filename: attachment.filename,
      content_type: attachment.contentType,
      size: attachment.size,
    })),
    folders: ["drafts", "draft"],
  };
}

function cloneMessage(message: EmailMessage): EmailMessage {
  return {
    ...message,
    from: message.from ? message.from.map((address) => ({ ...address })) : undefined,
    to: message.to ? message.to.map((address) => ({ ...address })) : undefined,
    cc: message.cc ? message.cc.map((address) => ({ ...address })) : undefined,
    bcc: message.bcc ? message.bcc.map((address) => ({ ...address })) : undefined,
    reply_to: message.reply_to ? message.reply_to.map((address) => ({ ...address })) : undefined,
    attachments: message.attachments ? message.attachments.map((attachment) => ({ ...attachment })) : undefined,
    folders: message.folders ? [...message.folders] : undefined,
    folder_ids: message.folder_ids ? [...message.folder_ids] : undefined,
    logic_gate_ids: message.logic_gate_ids ? [...message.logic_gate_ids] : undefined,
    read_status: message.read_status ? { ...message.read_status } : undefined,
    local_replies: message.local_replies ? message.local_replies.map(cloneMessage) : undefined,
  };
}

export function readHomeMailSignature(
  companyID: string,
  userID: string,
  sharedInboxID = "",
  accountEmail = "",
): string {
  if (!storageAvailable()) return "";
  const scopedSignature = localStorage.getItem(homeMailSignatureScopeKey(companyID, userID, sharedInboxID, accountEmail));
  if (scopedSignature !== null) return scopedSignature;
  if (sharedInboxID.trim()) return "";
  const legacyKey = legacySignatureStorageKey(companyID, userID);
  const legacySignature = localStorage.getItem(legacyKey) ?? "";
  if (!legacySignature) return "";
  if (!accountEmail.trim()) return legacySignature;
  try {
    localStorage.setItem(homeMailSignatureScopeKey(companyID, userID, "", accountEmail), legacySignature);
    localStorage.removeItem(legacyKey);
  } catch {
    // Keep returning the legacy value when browser storage cannot complete the one-time migration.
  }
  return legacySignature;
}

export function saveHomeMailSignature(
  companyID: string,
  userID: string,
  signature: string,
  sharedInboxID = "",
  accountEmail = "",
): void {
  const scopeKey = homeMailSignatureScopeKey(companyID, userID, sharedInboxID, accountEmail);
  advanceHomeMailSignatureLocalRevision(scopeKey);
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(scopeKey, signature);
  } catch {
    // Ignore storage failures; the compose state still keeps the signature text for this session.
  }
}

export async function loadHomeMailSignature(
  companyID: string,
  userID: string,
  sharedInboxID = "",
  accountEmail = "",
): Promise<string> {
  const scopeKey = homeMailSignatureScopeKey(companyID, userID, sharedInboxID, accountEmail);
  const localSignature = readHomeMailSignature(companyID, userID, sharedInboxID, accountEmail);
  const localRevisionAtLoadStart = readHomeMailSignatureLocalRevision(scopeKey);
  const pendingSignature = readPendingHomeMailSignatureSync(companyID, userID, sharedInboxID, accountEmail);
  if (pendingSignature !== null) {
    saveHomeMailSignature(companyID, userID, pendingSignature, sharedInboxID, accountEmail);
    try {
      await queueHomeMailSignatureRemoteSave(scopeKey, () => (
        saveEmailSignature({ companyID, sharedInboxID, accountEmail, bodyEditorHTML: pendingSignature })
      ));
      clearPendingHomeMailSignatureSync(companyID, userID, pendingSignature, sharedInboxID, accountEmail);
    } catch {
      // Keep the exact pending body authoritative locally until a later retry succeeds.
    }
    return readPendingHomeMailSignatureSync(companyID, userID, sharedInboxID, accountEmail)
      ?? readHomeMailSignature(companyID, userID, sharedInboxID, accountEmail);
  }
  try {
    const remoteSignature = await getEmailSignature(companyID, sharedInboxID, accountEmail);
    const pendingAfterLoad = readPendingHomeMailSignatureSync(companyID, userID, sharedInboxID, accountEmail);
    const localAfterLoad = readHomeMailSignature(companyID, userID, sharedInboxID, accountEmail);
    if (
      pendingAfterLoad !== null
      || readHomeMailSignatureLocalRevision(scopeKey) !== localRevisionAtLoadStart
      || localAfterLoad !== localSignature
    ) {
      return pendingAfterLoad ?? localAfterLoad;
    }
    if (remoteSignature) {
      const body = remoteSignature.body_editor_html ?? "";
      saveHomeMailSignature(companyID, userID, body, sharedInboxID, accountEmail);
      return body;
    }
    if (localSignature.trim()) {
      await queueHomeMailSignatureRemoteSave(scopeKey, () => (
        saveEmailSignature({ companyID, sharedInboxID, accountEmail, bodyEditorHTML: localSignature })
      ));
    }
    return readPendingHomeMailSignatureSync(companyID, userID, sharedInboxID, accountEmail)
      ?? readHomeMailSignature(companyID, userID, sharedInboxID, accountEmail);
  } catch {
    return readPendingHomeMailSignatureSync(companyID, userID, sharedInboxID, accountEmail)
      ?? readHomeMailSignature(companyID, userID, sharedInboxID, accountEmail);
  }
}

export async function saveHomeMailSignatureRemote(
  companyID: string,
  userID: string,
  signature: string,
  sharedInboxID = "",
  accountEmail = "",
): Promise<void> {
  saveHomeMailSignature(companyID, userID, signature, sharedInboxID, accountEmail);
  markPendingHomeMailSignatureSync(companyID, userID, signature, sharedInboxID, accountEmail);
  const scopeKey = homeMailSignatureScopeKey(companyID, userID, sharedInboxID, accountEmail);
  await queueHomeMailSignatureRemoteSave(scopeKey, () => (
    saveEmailSignature({ companyID, sharedInboxID, accountEmail, bodyEditorHTML: signature })
  ));
  clearPendingHomeMailSignatureSync(companyID, userID, signature, sharedInboxID, accountEmail);
}
