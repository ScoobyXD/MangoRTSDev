import type { EmailMessage } from "../../modules/communications/communicationsApi.js";
import { parseEmailAddressList } from "../../modules/communications/communicationsApi.js";
import { EDITOR_RICH_TEXT_PREFIX } from "../../modules/editor/richTextEditing.js";
import { emptyCompose, type ComposeAttachment, type ComposeState } from "./homeTypes.js";

const HOME_MAIL_DRAFTS_STORAGE_PREFIX = "mangorts.home.mailDrafts.v1";
const HOME_MAIL_SIGNATURE_STORAGE_PREFIX = "mangorts.home.mailSignature.v1";

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

function signatureStorageKey(companyID: string, userID: string): string {
  return `${HOME_MAIL_SIGNATURE_STORAGE_PREFIX}:${storagePart(companyID, "global")}:${storagePart(userID, "anonymous")}`;
}

export function createHomeMailDraftID(): string {
  return `draft:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

export function createHomeMailReplyDraftID(sharedInboxID: string, replyToMessageID: string): string {
  const cleanReplyToMessageID = replyToMessageID.trim();
  if (!cleanReplyToMessageID) return createHomeMailDraftID();
  const scope = sharedInboxID.trim() || "personal";
  return `draft:reply:${encodeURIComponent(scope)}:${encodeURIComponent(cleanReplyToMessageID)}`;
}

export function createHomeMailForwardDraftID(sharedInboxID: string, messageID: string): string {
  const cleanMessageID = messageID.trim();
  if (!cleanMessageID) return createHomeMailDraftID();
  const scope = sharedInboxID.trim() || "personal";
  return `draft:forward:${encodeURIComponent(scope)}:${encodeURIComponent(cleanMessageID)}`;
}

function cloneAttachments(attachments: ComposeAttachment[] | undefined): ComposeAttachment[] {
  return (attachments ?? []).map((attachment) => ({ ...attachment }));
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

function writeHomeMailDrafts(companyID: string, userID: string, drafts: HomeMailDraft[]): HomeMailDraft[] {
  const sorted = [...drafts].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  try {
    if (storageAvailable()) localStorage.setItem(draftsStorageKey(companyID, userID), JSON.stringify(sorted));
  } catch {
    return readHomeMailDrafts(companyID, userID);
  }
  return sorted;
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
  const signatureBody = signature.trim();
  const body = composeBodyDraftText(compose.body);
  return !!(
    compose.to.trim()
    || compose.cc.trim()
    || compose.bcc.trim()
    || compose.subject.trim()
    || compose.attachments.length > 0
    || compose.scheduledAt.trim()
    || (body && body !== signatureBody)
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
  const bodySnippet = draft.body.trim().replace(/\s+/g, " ");
  const attachmentSnippet = draft.attachments.length === 0 ? "" : `${draft.attachments.length} attachment${draft.attachments.length === 1 ? "" : "s"}`;
  return {
    id: draft.id,
    subject: draft.subject.trim() || "(no subject)",
    snippet: bodySnippet || attachmentSnippet || "Draft",
    body: draft.body,
    date: Number.isFinite(updatedAtMs) ? Math.floor(updatedAtMs / 1000) : undefined,
    unread: false,
    starred: false,
    from: draft.accountEmail ? [{ email: draft.accountEmail }] : undefined,
    to: parseEmailAddressList(draft.to),
    cc: parseEmailAddressList(draft.cc),
    bcc: parseEmailAddressList(draft.bcc),
    attachments: draft.attachments.map((attachment) => ({
      filename: attachment.filename,
      content_type: attachment.contentType,
      content: attachment.content,
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

export function readHomeMailSignature(companyID: string, userID: string): string {
  if (!storageAvailable()) return "";
  return localStorage.getItem(signatureStorageKey(companyID, userID)) ?? "";
}

export function saveHomeMailSignature(companyID: string, userID: string, signature: string): void {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(signatureStorageKey(companyID, userID), signature);
  } catch {
    // Ignore storage failures; the compose state still keeps the signature text for this session.
  }
}
