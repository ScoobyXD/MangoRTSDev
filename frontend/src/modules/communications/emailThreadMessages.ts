import type { EmailAddress, EmailAttachment, EmailMessage } from "./communicationsApi.js";
import { splitEmailQuotedHistory } from "./emailQuotedContent.js";

export type EmailThreadMessageSource = "provider" | "collaboration" | "local";

export type EmailThreadMessageCandidate = {
  message: EmailMessage;
  source: EmailThreadMessageSource;
  scopeKey?: string;
  inheritedThreadID?: string;
};

export type NormalizedEmailThreadMessage = EmailMessage & {
  client_thread_sources: EmailThreadMessageSource[];
  client_reconciled_message_ids: string[];
};

type ThreadMessageEntry = {
  message: EmailMessage;
  scopeKey: string;
  sources: Set<EmailThreadMessageSource>;
  reconciledIDs: Set<string>;
  firstIndex: number;
  preferredSource: EmailThreadMessageSource;
};

const sourceRank: Record<EmailThreadMessageSource, number> = {
  local: 1,
  collaboration: 2,
  provider: 3,
};

function cleanMessageScope(candidate: EmailThreadMessageCandidate): string {
  return candidate.scopeKey?.trim()
    || candidate.message.client_source_scope_key?.trim()
    || "mailbox";
}

function normalizedAddressEmails(addresses: EmailAddress[] | undefined): string {
  return (addresses ?? [])
    .map((address) => address.email.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
}

function normalizedAttachmentIdentity(attachment: EmailAttachment): string {
  const filename = (attachment.filename ?? "").trim().toLowerCase();
  const contentType = (attachment.content_type ?? "").trim().toLowerCase();
  const size = Number.isFinite(attachment.size ?? NaN) ? Math.max(0, Math.trunc(attachment.size ?? 0)) : 0;
  return [filename, contentType, size].join(":");
}

function normalizedAttachments(attachments: EmailAttachment[] | undefined): string {
  return (attachments ?? [])
    .filter((attachment) => !attachment.is_inline)
    .map(normalizedAttachmentIdentity)
    .sort()
    .join(",");
}

function normalizedBody(body: string | undefined): string {
  return (body ?? "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedSubject(subject: string): string {
  return subject.trim().toLowerCase().replace(/^(?:(?:re|fw|fwd):\s*)+/, "");
}

function messageTimestamp(message: EmailMessage): number {
  return Number.isFinite(message.date ?? NaN) ? Math.max(0, Math.trunc(message.date ?? 0)) : 0;
}

function storedMessageOrder(message: EmailMessage): number | null {
  return Number.isFinite(message.message_order ?? NaN) ? Math.max(0, Math.trunc(message.message_order ?? 0)) : null;
}

function chronologicalMessageDelta(left: EmailMessage, right: EmailMessage): number {
  return messageTimestamp(left) - messageTimestamp(right) || left.id.localeCompare(right.id);
}

function reconciliationSignature(message: EmailMessage): string {
  const threadID = message.thread_id?.trim() ?? "";
  const fullBody = message.body || message.snippet || "";
  const body = normalizedBody(splitEmailQuotedHistory(fullBody).authoredBody || fullBody);
  const timestamp = messageTimestamp(message);
  if (!threadID || !body || timestamp <= 0) return "";
  return [
    threadID,
    normalizedSubject(message.subject),
    body,
    normalizedAddressEmails(message.from),
    normalizedAddressEmails(message.to),
    normalizedAddressEmails(message.cc),
    normalizedAddressEmails(message.bcc),
    normalizedAttachments(message.attachments),
  ].join("\x1f");
}

function preserveUsefulArrays(merged: EmailMessage, primary: EmailMessage, secondary: EmailMessage): void {
  if (!primary.from?.length && secondary.from?.length) merged.from = secondary.from;
  if (!primary.to?.length && secondary.to?.length) merged.to = secondary.to;
  if (!primary.cc?.length && secondary.cc?.length) merged.cc = secondary.cc;
  if (!primary.bcc?.length && secondary.bcc?.length) merged.bcc = secondary.bcc;
  if (!primary.reply_to?.length && secondary.reply_to?.length) merged.reply_to = secondary.reply_to;
  if (!primary.attachments?.length && secondary.attachments?.length) merged.attachments = secondary.attachments;
  if (!primary.folders?.length && secondary.folders?.length) merged.folders = secondary.folders;
  if (!primary.folder_ids?.length && secondary.folder_ids?.length) merged.folder_ids = secondary.folder_ids;
  if (!primary.logic_gate_ids?.length && secondary.logic_gate_ids?.length) merged.logic_gate_ids = secondary.logic_gate_ids;
}

function mergeMessageValues(
  previous: EmailMessage,
  next: EmailMessage,
  previousSource: EmailThreadMessageSource,
  nextSource: EmailThreadMessageSource,
): { message: EmailMessage; preferredSource: EmailThreadMessageSource } {
  const preferNext = sourceRank[nextSource] >= sourceRank[previousSource];
  const primary = preferNext ? next : previous;
  const secondary = preferNext ? previous : next;
  const merged: EmailMessage = { ...secondary, ...primary };
  if (!primary.body?.trim() && secondary.body?.trim()) merged.body = secondary.body;
  if (!primary.snippet?.trim() && secondary.snippet?.trim()) merged.snippet = secondary.snippet;
  preserveUsefulArrays(merged, primary, secondary);
  merged.detail_fetched = primary.detail_fetched === true || secondary.detail_fetched === true;
  delete merged.local_replies;
  return { message: merged, preferredSource: preferNext ? nextSource : previousSource };
}

function mergeEntries(target: ThreadMessageEntry, incoming: ThreadMessageEntry): void {
  const merged = mergeMessageValues(
    target.message,
    incoming.message,
    target.preferredSource,
    incoming.preferredSource,
  );
  target.message = merged.message;
  target.preferredSource = merged.preferredSource;
  for (const source of incoming.sources) target.sources.add(source);
  for (const id of incoming.reconciledIDs) target.reconciledIDs.add(id);
  target.firstIndex = Math.min(target.firstIndex, incoming.firstIndex);
}

function canReconcileLocalRepresentation(local: ThreadMessageEntry, authoritative: ThreadMessageEntry): boolean {
  if (!local.sources.has("local")) return false;
  if (local.scopeKey !== authoritative.scopeKey) return false;
  const localSignature = reconciliationSignature(local.message);
  if (!localSignature || localSignature !== reconciliationSignature(authoritative.message)) return false;
  return Math.abs(messageTimestamp(local.message) - messageTimestamp(authoritative.message)) <= 120;
}

function canReconcileLocalCopies(left: ThreadMessageEntry, right: ThreadMessageEntry): boolean {
  if (!left.sources.has("local") || !right.sources.has("local")) return false;
  if (left.scopeKey !== right.scopeKey) return false;
  const leftSignature = reconciliationSignature(left.message);
  if (!leftSignature || leftSignature !== reconciliationSignature(right.message)) return false;
  return Math.abs(messageTimestamp(left.message) - messageTimestamp(right.message)) <= 2;
}

function entryToMessage(entry: ThreadMessageEntry): NormalizedEmailThreadMessage {
  const message = { ...entry.message } as NormalizedEmailThreadMessage;
  delete message.local_replies;
  message.client_thread_sources = Array.from(entry.sources).sort((left, right) => sourceRank[right] - sourceRank[left]);
  message.client_reconciled_message_ids = Array.from(entry.reconciledIDs).sort();
  return message;
}

export function normalizeEmailThreadMessages(
  candidates: EmailThreadMessageCandidate[],
  order: "oldest" | "newest" = "oldest",
): NormalizedEmailThreadMessage[] {
  const byIdentity = new Map<string, ThreadMessageEntry>();
  const exactEntries: ThreadMessageEntry[] = [];
  candidates.forEach((candidate, index) => {
    const id = candidate.message.id?.trim() ?? "";
    if (!id) return;
    const scopeKey = cleanMessageScope(candidate);
    const inheritedThreadID = candidate.inheritedThreadID?.trim() ?? "";
    const threadScopedMessage = inheritedThreadID && !candidate.message.thread_id?.trim()
      ? { ...candidate.message, thread_id: inheritedThreadID }
      : candidate.message;
    const message = threadScopedMessage.client_source_scope_key?.trim()
      ? threadScopedMessage
      : { ...threadScopedMessage, client_source_scope_key: scopeKey };
    const identity = JSON.stringify([scopeKey, id]);
    const incoming: ThreadMessageEntry = {
      message,
      scopeKey,
      sources: new Set([candidate.source]),
      reconciledIDs: new Set([id]),
      firstIndex: index,
      preferredSource: candidate.source,
    };
    const existing = byIdentity.get(identity);
    if (existing) {
      mergeEntries(existing, incoming);
      return;
    }
    byIdentity.set(identity, incoming);
    exactEntries.push(incoming);
  });

  const authoritative = exactEntries.filter((entry) => entry.sources.has("provider") || entry.sources.has("collaboration"));
  const locals = exactEntries.filter((entry) => !entry.sources.has("provider") && !entry.sources.has("collaboration"));
  const unreconciledLocals: ThreadMessageEntry[] = [];
  for (const local of locals) {
    const matches = authoritative.filter((candidate) => canReconcileLocalRepresentation(local, candidate));
    if (matches.length === 1) {
      mergeEntries(matches[0], local);
      continue;
    }
    unreconciledLocals.push(local);
  }

  const localGroups: ThreadMessageEntry[] = [];
  for (const local of unreconciledLocals) {
    const existing = localGroups.find((candidate) => canReconcileLocalCopies(local, candidate));
    if (existing) mergeEntries(existing, local);
    else localGroups.push(local);
  }

  const normalized = [...authoritative, ...localGroups].map(entryToMessage);
  const storedTimeline = normalized
    .filter((message) => storedMessageOrder(message) !== null)
    .sort((left, right) => (storedMessageOrder(left) ?? 0) - (storedMessageOrder(right) ?? 0) || left.id.localeCompare(right.id));
  const timelinePositions = new Map<EmailMessage, number>();
  storedTimeline.forEach((message, index) => timelinePositions.set(message, index * 2));
  normalized.forEach((message) => {
    if (storedMessageOrder(message) !== null) return;
    const nextStoredIndex = storedTimeline.findIndex((storedMessage) => chronologicalMessageDelta(message, storedMessage) < 0);
    const insertionIndex = nextStoredIndex >= 0 ? nextStoredIndex : storedTimeline.length;
    timelinePositions.set(message, insertionIndex * 2 - 1);
  });
  normalized.sort((left, right) => {
    const positionDelta = (timelinePositions.get(left) ?? 0) - (timelinePositions.get(right) ?? 0);
    const timelineDelta = positionDelta || chronologicalMessageDelta(left, right);
    return order === "oldest" ? timelineDelta : -timelineDelta;
  });
  return normalized;
}

export function emailThreadMessageRenderKey(message: EmailMessage): string {
  return JSON.stringify([
    message.client_source_scope_key?.trim() || "mailbox",
    message.id.trim(),
  ]);
}

export function emailThreadMessageSourceLabel(message: EmailMessage): string {
  const sources = (message as Partial<NormalizedEmailThreadMessage>).client_thread_sources ?? [];
  return sources.join(",");
}
