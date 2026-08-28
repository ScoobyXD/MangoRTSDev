import type { CommunicationsEmailDraft, EmailMessage } from "../../modules/communications/communicationsApi.js";
import { deleteEmailDraft, getEmailDraft, getEmailSignature, listEmailDrafts, parseEmailAddressList, saveEmailDraft, saveEmailSignature } from "../../modules/communications/communicationsApi.js";
import { applyEmailSignature, emailBodyHasSignature, emailBodyWithoutEntityReferences, emailBodyWithoutSignature } from "../../modules/editor/emailSignatureBody.js";
import { EDITOR_RICH_TEXT_PREFIX, editorBodyHasEmailContent, linkifyEditorPlainTextToHTML, sanitizeEditorDocumentHTML } from "../../modules/editor/richTextEditing.js";
import { emptyCompose, type ComposeAttachment, type ComposeKind, type ComposeState } from "./homeTypes.js";

const HOME_MAIL_DRAFTS_STORAGE_PREFIX = "mangorts.home.mailDrafts.v1";
const HOME_MAIL_SIGNATURE_STORAGE_PREFIX = "mangorts.home.mailSignature.v1";
const homeMailDraftScopeRevisions = new Map<string, number>();
const homeMailDraftLoadGenerations = new Map<string, number>();
const homeMailDraftEnsurePromises = new Map<string, Promise<HomeMailDraft[]>>();
const homeMailDraftRemoteMutationTails = new Map<string, Promise<void>>();
const homeMailSignatureRemoteSaveQueues = new Map<string, Promise<void>>();
const homeMailSignatureLocalRevisions = new Map<string, number>();
const HOME_MAIL_DRAFT_SCOPE_PURGE_ERROR_CODES = new Set([
  "access_denied",
  "company_access_denied",
  "company_not_found",
  "shared_inbox_not_found",
  "shared_inbox_not_mailbox",
]);

export type HomeMailDraft = {
  id: string;
  kind: ComposeKind;
  userID: string;
  companyID: string;
  sharedInboxID: string;
  accountEmail: string;
  sourceMessageID: string;
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

function homeMailDraftScopeIdentity(sharedInboxID = "", accountEmail = ""): string {
  const cleanSharedInboxID = sharedInboxID.trim();
  if (cleanSharedInboxID) return "shared:" + encodeURIComponent(cleanSharedInboxID);
  return "personal:" + encodeURIComponent(accountEmail.trim().toLowerCase() || "account");
}

function homeMailDraftScopeKey(
  companyID: string,
  userID: string,
  sharedInboxID = "",
  accountEmail = "",
): string {
  return draftsStorageKey(companyID, userID) + ":" + homeMailDraftScopeIdentity(sharedInboxID, accountEmail);
}

function homeMailDraftScopeKeyForDraft(draft: HomeMailDraft): string {
  return homeMailDraftScopeKey(draft.companyID, draft.userID, draft.sharedInboxID, draft.accountEmail);
}

function homeMailDraftRemoteMutationKey(
  companyID: string,
  userID: string,
  draftID: string,
  sharedInboxID = "",
  accountEmail = "",
): string {
  return homeMailDraftScopeKey(companyID, userID, sharedInboxID, accountEmail) + ":" + draftID.trim();
}

function queueHomeMailDraftRemoteMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
  const previous = homeMailDraftRemoteMutationTails.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(mutation);
  const tail = result.then(() => undefined, () => undefined);
  homeMailDraftRemoteMutationTails.set(key, tail);
  void tail.then(() => {
    if (homeMailDraftRemoteMutationTails.get(key) === tail) homeMailDraftRemoteMutationTails.delete(key);
  });
  return result;
}

function readHomeMailDraftScopeRevision(scopeKey: string): number {
  return homeMailDraftScopeRevisions.get(scopeKey) ?? 0;
}

function advanceHomeMailDraftScopeRevision(scopeKey: string): void {
  homeMailDraftScopeRevisions.set(scopeKey, readHomeMailDraftScopeRevision(scopeKey) + 1);
}

function homeMailDraftScopeFingerprints(drafts: HomeMailDraft[]): Map<string, string> {
  const draftsByScope = new Map<string, HomeMailDraft[]>();
  for (const draft of drafts) {
    const scopeKey = homeMailDraftScopeKeyForDraft(draft);
    const scopedDrafts = draftsByScope.get(scopeKey) ?? [];
    scopedDrafts.push(draft);
    draftsByScope.set(scopeKey, scopedDrafts);
  }
  return new Map(Array.from(draftsByScope, ([scopeKey, scopedDrafts]) => [scopeKey, JSON.stringify(scopedDrafts)]));
}

function advanceChangedHomeMailDraftScopeRevisions(before: HomeMailDraft[], after: HomeMailDraft[]): void {
  const beforeByScope = homeMailDraftScopeFingerprints(before);
  const afterByScope = homeMailDraftScopeFingerprints(after);
  const scopeKeys = new Set([...beforeByScope.keys(), ...afterByScope.keys()]);
  for (const scopeKey of scopeKeys) {
    if (beforeByScope.get(scopeKey) !== afterByScope.get(scopeKey)) {
      advanceHomeMailDraftScopeRevision(scopeKey);
    }
  }
}

type HomeMailDraftLoadAttempt = {
  scopeKey: string;
  localRevision: number;
  generation: number;
};

function beginHomeMailDraftLoad(
  companyID: string,
  userID: string,
  sharedInboxID = "",
  accountEmail = "",
): HomeMailDraftLoadAttempt {
  const scopeKey = homeMailDraftScopeKey(companyID, userID, sharedInboxID, accountEmail);
  const generation = (homeMailDraftLoadGenerations.get(scopeKey) ?? 0) + 1;
  homeMailDraftLoadGenerations.set(scopeKey, generation);
  return {
    scopeKey,
    localRevision: readHomeMailDraftScopeRevision(scopeKey),
    generation,
  };
}

function homeMailDraftLoadIsCurrent(attempt: HomeMailDraftLoadAttempt): boolean {
  return homeMailDraftLoadGenerations.get(attempt.scopeKey) === attempt.generation
    && readHomeMailDraftScopeRevision(attempt.scopeKey) === attempt.localRevision;
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
  const key = homeMailSignaturePendingSyncKey(companyID, userID, sharedInboxID, accountEmail);
  const signature = localStorage.getItem(key);
  if (signature === null) return null;
  const cleanSignature = emailBodyWithoutEntityReferences(signature);
  if (cleanSignature !== signature) {
    try {
      localStorage.setItem(key, cleanSignature);
    } catch {
      // The sanitized value still remains authoritative for this retry.
    }
  }
  return cleanSignature;
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

function homeMailBodyWithoutSignature(body: string, signature: string): string {
  return emailBodyWithoutSignature(body, signature);
}

export function homeMailBodyHasSignature(body: string, signature: string): boolean {
  return emailBodyHasSignature(body, signature);
}

export function applyHomeMailSignature(body: string, signature: string): string {
  return applyEmailSignature(body, signature);
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
    kind: normalizeHomeMailDraftKind(item.kind),
    userID: userID.trim(),
    companyID: companyID.trim(),
    sharedInboxID: item.sharedInboxID?.trim() ?? "",
    accountEmail: item.accountEmail?.trim() ?? "",
    sourceMessageID: item.sourceMessageID?.trim() ?? "",
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
  const priorDrafts = readHomeMailDrafts(companyID, userID);
  const sorted = mergeHomeMailDrafts(drafts, []);
  try {
    if (storageAvailable()) {
      localStorage.setItem(draftsStorageKey(companyID, userID), JSON.stringify(sorted));
      advanceChangedHomeMailDraftScopeRevisions(priorDrafts, sorted);
    }
  } catch {
    return readHomeMailDrafts(companyID, userID);
  }
  return sorted;
}

function replaceHomeMailDraftScope(
  companyID: string,
  userID: string,
  sharedInboxID: string,
  accountEmail: string,
  scopedDrafts: HomeMailDraft[],
): HomeMailDraft[] {
  const currentDrafts = readHomeMailDrafts(companyID, userID);
  const otherScopeDrafts = currentDrafts.filter((draft) => !homeMailDraftMatchesScope(draft, sharedInboxID, accountEmail));
  return writeHomeMailDrafts(companyID, userID, [...otherScopeDrafts, ...scopedDrafts])
    .filter((draft) => homeMailDraftMatchesScope(draft, sharedInboxID, accountEmail));
}

type APIRequestFailure = Error & {
  code?: unknown;
};

function homeMailDraftScopeFailureRequiresLocalPurge(error: unknown): boolean {
  const failure = error instanceof Error ? error as APIRequestFailure : null;
  const code = typeof failure?.code === "string" ? failure.code.trim().toLowerCase() : "";
  return HOME_MAIL_DRAFT_SCOPE_PURGE_ERROR_CODES.has(code);
}

export async function loadHomeMailDrafts(
  companyID: string,
  userID: string,
  sharedInboxID = "",
  accountEmail = "",
): Promise<HomeMailDraft[]> {
  const loadAttempt = beginHomeMailDraftLoad(companyID, userID, sharedInboxID, accountEmail);
  const localDrafts = readHomeMailDrafts(companyID, userID)
    .filter((draft) => homeMailDraftMatchesScope(draft, sharedInboxID, accountEmail));
  const readCurrentScope = () => readHomeMailDraftsForScope(companyID, userID, sharedInboxID, accountEmail);
  try {
		const scope = { sharedInboxID: sharedInboxID.trim() || undefined, accountEmail: accountEmail.trim() || undefined };
		const remoteRows = scope.sharedInboxID || scope.accountEmail
			? await listEmailDrafts(companyID, scope, { refresh: true })
			: [];
		const localByID = new Map(localDrafts.map((draft) => [draft.id, draft]));
		const remoteDrafts = remoteRows
			.map((draft) => homeMailDraftFromRemote(draft, companyID, userID))
      .filter((draft): draft is HomeMailDraft => Boolean(draft))
      .map((draft) => preserveHomeMailDraftDetail(draft, localByID.get(draft.id)))
      .filter((draft) => homeMailDraftMatchesScope(draft, sharedInboxID, accountEmail));
    if (!homeMailDraftLoadIsCurrent(loadAttempt)) return readCurrentScope();
    const remoteByID = new Map(remoteDrafts.map((draft) => [draft.id, draft]));
    const pendingLocalDrafts = localDrafts.filter((draft) => (
      draft.pendingRemoteSync === true
      && (
        !remoteByID.has(draft.id)
        || Date.parse(draft.updatedAt) > Date.parse(remoteByID.get(draft.id)?.updatedAt ?? "")
      )
      && composeHasDraftContent(homeMailDraftToCompose(draft), "")
    ));
    const migratedDrafts = (await Promise.all(pendingLocalDrafts.map((draft) => queueHomeMailDraftRemoteMutation(
      homeMailDraftRemoteMutationKey(companyID, userID, draft.id, draft.sharedInboxID, draft.accountEmail),
      () => saveHomeMailDraftToDatabase(draft),
    ).catch(() => null))))
      .filter((draft): draft is HomeMailDraft => Boolean(draft));
    const failedPendingDraftIDs = new Set(pendingLocalDrafts.map((draft) => draft.id));
    for (const migrated of migratedDrafts) failedPendingDraftIDs.delete(migrated.id);
    const failedPendingDrafts = pendingLocalDrafts.filter((draft) => failedPendingDraftIDs.has(draft.id));
    const scopedDrafts = mergeHomeMailDrafts([...remoteDrafts, ...migratedDrafts], failedPendingDrafts);
    if (!homeMailDraftLoadIsCurrent(loadAttempt)) return readCurrentScope();
    return replaceHomeMailDraftScope(companyID, userID, sharedInboxID, accountEmail, scopedDrafts);
  } catch (error) {
    if (!homeMailDraftLoadIsCurrent(loadAttempt)) return readCurrentScope();
    if (homeMailDraftScopeFailureRequiresLocalPurge(error)) {
      return replaceHomeMailDraftScope(companyID, userID, sharedInboxID, accountEmail, []);
    }
    return readCurrentScope();
  }
}

export async function loadHomeMailDraft(
	companyID: string,
	userID: string,
	draft: HomeMailDraft,
): Promise<HomeMailDraft | null> {
	const scopeKey = homeMailDraftScopeKey(companyID, userID, draft.sharedInboxID, draft.accountEmail);
	const expectedRevision = readHomeMailDraftScopeRevision(scopeKey);
	const scope = { sharedInboxID: draft.sharedInboxID || undefined, accountEmail: draft.accountEmail || undefined };
	const remote = await getEmailDraft(companyID, draft.id, scope);
	const loaded = remote ? homeMailDraftFromRemote(remote, companyID, userID) : null;
	if (!loaded || readHomeMailDraftScopeRevision(scopeKey) !== expectedRevision) return loaded;
	const currentDrafts = readHomeMailDrafts(companyID, userID);
	const current = currentDrafts.find((item) => item.id === draft.id);
	if (!current || current.pendingRemoteSync || current.updatedAt !== draft.updatedAt) return loaded;
	writeHomeMailDrafts(companyID, userID, [loaded, ...currentDrafts.filter((item) => item.id !== loaded.id)]);
	return loaded;
}

export function syncHomeMailDraftFromCompose(
  companyID: string,
  userID: string,
  compose: ComposeState,
  signature: string,
): Promise<HomeMailDraft[]> {
  const draftID = compose.draftID.trim();
  const priorDraft = draftID
    ? readHomeMailDrafts(companyID, userID).find((item) => item.id === draftID) ?? null
    : null;
  const localDrafts = saveHomeMailDraftFromCompose(companyID, userID, compose, signature);
  const scopeKey = homeMailDraftScopeKey(companyID, userID, compose.sharedInboxID, compose.accountEmail);
  let expectedLocalRevision = readHomeMailDraftScopeRevision(scopeKey);
  const readCurrentScope = () => readHomeMailDraftsForScope(
    companyID,
    userID,
    compose.sharedInboxID,
    compose.accountEmail,
  );
  if (!draftID) return Promise.resolve(readCurrentScope());
  const mutationKey = homeMailDraftRemoteMutationKey(
    companyID,
    userID,
    draftID,
    compose.sharedInboxID,
    compose.accountEmail,
  );
  return queueHomeMailDraftRemoteMutation(mutationKey, async () => {
    try {
      const draft = localDrafts.find((item) => item.id === draftID) ?? null;
      if (draft) {
        const saved = await saveHomeMailDraftToDatabase(draft);
        if (saved) {
          if (readHomeMailDraftScopeRevision(scopeKey) !== expectedLocalRevision) return readCurrentScope();
          const allDrafts = readHomeMailDrafts(companyID, userID);
          writeHomeMailDrafts(companyID, userID, [saved, ...allDrafts.filter((item) => item.id !== saved.id)]);
          expectedLocalRevision = readHomeMailDraftScopeRevision(scopeKey);
        }
      } else if (priorDraft) {
        await deleteEmailDraft(companyID, draftID, {
          sharedInboxID: priorDraft.sharedInboxID || undefined,
          accountEmail: priorDraft.accountEmail || undefined,
        });
        return readCurrentScope();
      }
      if (readHomeMailDraftScopeRevision(scopeKey) !== expectedLocalRevision) return readCurrentScope();
		return readCurrentScope();
    } catch {
      return readCurrentScope();
    }
  });
}

export function ensureHomeMailDraftAttachmentTarget(
  companyID: string,
  userID: string,
  compose: ComposeState,
  signature: string,
): Promise<HomeMailDraft[]> {
  const draftID = compose.draftID.trim();
  if (!compose.open || !draftID) return Promise.reject(new Error("email_draft_target_unavailable"));
  const scopeKey = homeMailDraftScopeKey(companyID, userID, compose.sharedInboxID, compose.accountEmail);
  const operationKey = homeMailDraftRemoteMutationKey(
    companyID,
    userID,
    draftID,
    compose.sharedInboxID,
    compose.accountEmail,
  );
  const existingOperation = homeMailDraftEnsurePromises.get(operationKey);
  if (existingOperation) return existingOperation;

  const operation = queueHomeMailDraftRemoteMutation(operationKey, async () => {
    const localDrafts = saveHomeMailDraftFromCompose(companyID, userID, compose, signature, { preserveEmpty: true });
    const draft = localDrafts.find((item) => item.id === draftID) ?? null;
    if (!draft) throw new Error("email_draft_target_unavailable");
    if (draft.pendingRemoteSync === false) {
      return readHomeMailDraftsForScope(companyID, userID, compose.sharedInboxID, compose.accountEmail);
    }
    const expectedLocalRevision = readHomeMailDraftScopeRevision(scopeKey);
    const saved = await saveHomeMailDraftToDatabase(draft);
    if (!saved) throw new Error("email_draft_target_unavailable");
    if (readHomeMailDraftScopeRevision(scopeKey) === expectedLocalRevision) {
      const allDrafts = readHomeMailDrafts(companyID, userID);
      writeHomeMailDrafts(companyID, userID, [saved, ...allDrafts.filter((item) => item.id !== saved.id)]);
    }
		return readHomeMailDraftsForScope(companyID, userID, compose.sharedInboxID, compose.accountEmail);
  });
  homeMailDraftEnsurePromises.set(operationKey, operation);
  void operation.finally(() => {
    if (homeMailDraftEnsurePromises.get(operationKey) === operation) homeMailDraftEnsurePromises.delete(operationKey);
  }).catch(() => undefined);
  return operation;
}

export async function deleteHomeMailDraftRemote(companyID: string, userID: string, draftID: string): Promise<HomeMailDraft[]> {
  const existing = readHomeMailDrafts(companyID, userID).find((draft) => draft.id === draftID.trim()) ?? null;
  if (!existing) return deleteHomeMailDraft(companyID, userID, draftID);
  deleteHomeMailDraft(companyID, userID, draftID);
  const readCurrentScope = () => readHomeMailDraftsForScope(
    companyID,
    userID,
    existing.sharedInboxID,
    existing.accountEmail,
  );
  const mutationKey = homeMailDraftRemoteMutationKey(
    companyID,
    userID,
    draftID,
    existing.sharedInboxID,
    existing.accountEmail,
  );
  return queueHomeMailDraftRemoteMutation(mutationKey, async () => {
    try {
      await deleteEmailDraft(companyID, draftID, {
        sharedInboxID: existing.sharedInboxID || undefined,
        accountEmail: existing.accountEmail || undefined,
      });
      return readCurrentScope();
    } catch {
      return readCurrentScope();
    }
  });
}

export async function deleteHomeMailDraftsRemote(companyID: string, userID: string, draftIDs: string[]): Promise<HomeMailDraft[]> {
  const cleanDraftIDs = new Set(draftIDs.map((draftID) => draftID.trim()).filter(Boolean));
  const existingDrafts = readHomeMailDrafts(companyID, userID).filter((draft) => cleanDraftIDs.has(draft.id));
  deleteHomeMailDrafts(companyID, userID, draftIDs);
  try {
    await Promise.all(existingDrafts.map((draft) => queueHomeMailDraftRemoteMutation(
      homeMailDraftRemoteMutationKey(companyID, userID, draft.id, draft.sharedInboxID, draft.accountEmail),
      () => deleteEmailDraft(companyID, draft.id, {
        sharedInboxID: draft.sharedInboxID || undefined,
        accountEmail: draft.accountEmail || undefined,
      }),
    )));
    return readHomeMailDrafts(companyID, userID);
  } catch {
    return readHomeMailDrafts(companyID, userID);
  }
}

async function saveHomeMailDraftToDatabase(draft: HomeMailDraft): Promise<HomeMailDraft | null> {
  const sourceSharedInboxID = draft.sharedInboxID.trim();
  const sourceAccountEmail = sourceSharedInboxID ? "" : draft.accountEmail.trim();
  const saved = await saveEmailDraft({
    companyID: draft.companyID,
    draftID: draft.id,
    sharedInboxID: sourceSharedInboxID || undefined,
    accountEmail: sourceAccountEmail || undefined,
    kind: draft.kind,
    sourceMessageID: draft.sourceMessageID || draft.replyToMessage?.email_message_id?.trim() || undefined,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    bodyEditorHTML: draft.body,
    replyToMessage: draft.kind === "reply" ? undefined : draft.replyToMessage,
    scheduledSendTimestamp: draft.scheduledAt,
  });
  return homeMailDraftFromRemote(saved, draft.companyID, draft.userID);
}

export function homeMailDraftFromRemote(draft: CommunicationsEmailDraft, companyID: string, userID: string): HomeMailDraft | null {
  const id = draft.draft_id?.trim();
  if (!id) return null;
  return normalizeDraft({
    id,
    kind: draft.kind,
    userID,
    companyID,
    sharedInboxID: draft.shared_inbox_id ?? "",
    accountEmail: draft.account_email ?? draft.personal_account_email ?? "",
    sourceMessageID: draft.source_message_id ?? "",
    replyToMessageID: draft.reply_to_message?.id?.trim() || "",
    replyToMessage: remoteReplyToMessageHasDetail(draft.reply_to_message) ? draft.reply_to_message ?? null : null,
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

function preserveHomeMailDraftDetail(summary: HomeMailDraft, local: HomeMailDraft | undefined): HomeMailDraft {
  if (!local) return summary;
  return {
    ...summary,
    sourceMessageID: summary.sourceMessageID || local.sourceMessageID,
    replyToMessageID: local.replyToMessageID || summary.replyToMessageID,
    replyToMessage: local.replyToMessage ? cloneMessage(local.replyToMessage) : summary.replyToMessage,
    body: local.body,
    attachments: cloneAttachments(local.attachments),
  };
}

export function mergeHomeMailDrafts(primary: HomeMailDraft[], secondary: HomeMailDraft[]): HomeMailDraft[] {
  const byDraftID = new Map<string, HomeMailDraft>();
  for (const draft of [...secondary, ...primary]) {
    const existing = byDraftID.get(draft.id);
    if (!existing || Date.parse(draft.updatedAt) >= Date.parse(existing.updatedAt)) {
      byDraftID.set(draft.id, draft);
    }
  }
  return [...byDraftID.values()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function remoteReplyToMessageHasDetail(message: EmailMessage | null | undefined): boolean {
  if (!message) return false;
  return message.detail_fetched === true
    || Boolean(
      message.subject?.trim()
      || message.snippet?.trim()
      || message.body?.trim()
      || message.from?.length
      || message.to?.length
      || message.cc?.length
      || message.bcc?.length
      || message.attachments?.length
      || message.date,
    );
}

function normalizeHomeMailDraftKind(value: unknown): ComposeKind {
  if (value === "reply" || value === "forward" || value === "compose") return value;
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
  options: { preserveEmpty?: boolean } = {},
): HomeMailDraft[] {
  if (!compose.open) return readHomeMailDrafts(companyID, userID);
  const body = emailBodyWithoutEntityReferences(compose.body);
  const cleanSignature = emailBodyWithoutEntityReferences(signature);
  if (!options.preserveEmpty && !composeHasDraftContent({ ...compose, body }, cleanSignature)) {
    return compose.draftID ? deleteHomeMailDraft(companyID, userID, compose.draftID) : readHomeMailDrafts(companyID, userID);
  }
  const now = new Date().toISOString();
  const drafts = readHomeMailDrafts(companyID, userID);
  const existing = compose.draftID ? drafts.find((draft) => draft.id === compose.draftID) : null;
  const draft: HomeMailDraft = {
    id: existing?.id ?? (compose.draftID.trim() || createHomeMailDraftID()),
    kind: compose.kind,
    userID: userID.trim(),
    companyID: companyID.trim(),
    sharedInboxID: compose.sharedInboxID.trim(),
    accountEmail: compose.accountEmail.trim(),
    sourceMessageID: compose.replyToMessage?.email_message_id?.trim() || existing?.sourceMessageID || "",
    replyToMessageID: compose.replyToMessageID.trim(),
    replyToMessage: compose.replyToMessage ? cloneMessage(compose.replyToMessage) : null,
    to: compose.to,
    cc: compose.cc,
    bcc: compose.bcc,
    subject: compose.subject,
    body,
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
    kind: draft.kind,
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
  if (scopedSignature !== null) return emailBodyWithoutEntityReferences(scopedSignature);
  if (sharedInboxID.trim()) return "";
  const legacyKey = legacySignatureStorageKey(companyID, userID);
  const legacySignature = emailBodyWithoutEntityReferences(localStorage.getItem(legacyKey) ?? "");
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
  const cleanSignature = emailBodyWithoutEntityReferences(signature);
  advanceHomeMailSignatureLocalRevision(scopeKey);
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(scopeKey, cleanSignature);
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
      const body = emailBodyWithoutEntityReferences(remoteSignature.body_editor_html ?? "");
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
  const cleanSignature = emailBodyWithoutEntityReferences(signature);
  saveHomeMailSignature(companyID, userID, cleanSignature, sharedInboxID, accountEmail);
  markPendingHomeMailSignatureSync(companyID, userID, cleanSignature, sharedInboxID, accountEmail);
  const scopeKey = homeMailSignatureScopeKey(companyID, userID, sharedInboxID, accountEmail);
  await queueHomeMailSignatureRemoteSave(scopeKey, () => (
    saveEmailSignature({ companyID, sharedInboxID, accountEmail, bodyEditorHTML: cleanSignature })
  ));
  clearPendingHomeMailSignatureSync(companyID, userID, cleanSignature, sharedInboxID, accountEmail);
}
