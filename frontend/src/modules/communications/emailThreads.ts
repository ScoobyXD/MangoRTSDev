import type { EmailMessage } from "./communicationsApi.js";

export function emailThreadKey(message: Pick<EmailMessage, "id" | "thread_id" | "client_source_scope_key">): string {
  const sourceScopeKey = message.client_source_scope_key?.trim() || "mailbox";
  const threadID = (message.thread_id ?? "").trim();
  if (threadID) return JSON.stringify([sourceScopeKey, "thread", threadID]);
  return JSON.stringify([sourceScopeKey, "message", message.id.trim()]);
}

export function emailThreadMessageCount(message: Pick<EmailMessage, "thread_message_count">): number {
  const count = message.thread_message_count ?? 0;
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}

export function emailMessageHasMultipleThreadMessages(message: Pick<EmailMessage, "thread_message_count">): boolean {
  return emailThreadMessageCount(message) > 1;
}

export function condenseEmailThreadMessages(messages: EmailMessage[]): EmailMessage[] {
  const groups = new Map<string, EmailMessage[]>();
  const order: string[] = [];
  for (const message of messages) {
    const key = emailThreadKey(message);
    const existing = groups.get(key);
    if (existing) {
      existing.push(message);
    } else {
      groups.set(key, [message]);
      order.push(key);
    }
  }

  const condensed: EmailMessage[] = [];
  for (const key of order) {
    const group = groups.get(key) ?? [];
    const representative = group[0];
    if (!representative) continue;
    const unreadCount = group.reduce((count, message) => count + (message.unread ? 1 : 0), 0);
    const authoritativeMessageCount = group.reduce((count, message) => (
      Math.max(count, emailThreadMessageCount(message))
    ), 0);
    condensed.push({
      ...representative,
      unread: unreadCount > 0,
      starred: group.some((message) => message.starred),
      thread_message_count: Math.max(group.length, authoritativeMessageCount),
      thread_unread_count: unreadCount,
    });
  }
  return condensed;
}
