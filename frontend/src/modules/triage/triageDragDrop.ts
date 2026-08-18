export const TRIAGE_MESSAGE_DRAG_MIME = "application/x-mangorts-communications-triage-messages";

export type TriageMessageDragPayload = {
  messageIDs: string[];
  sharedInboxID?: string;
  accountEmail?: string;
  companyID?: string;
};

export function normalizeTriageMessageIDs(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function readTriageMessageDrag(dataTransfer: DataTransfer): TriageMessageDragPayload {
  try {
    const raw = dataTransfer.getData(TRIAGE_MESSAGE_DRAG_MIME);
    if (!raw) return { messageIDs: [] };
    const parsed = JSON.parse(raw) as { kind?: string; message_ids?: unknown; shared_inbox_id?: unknown; account_email?: unknown; company_id?: unknown };
    if (parsed.kind !== "triage_messages" || !Array.isArray(parsed.message_ids)) return { messageIDs: [] };
    const sharedInboxID = typeof parsed.shared_inbox_id === "string" ? parsed.shared_inbox_id.trim() || undefined : undefined;
    return {
      messageIDs: normalizeTriageMessageIDs(parsed.message_ids.filter((value): value is string => typeof value === "string")),
      sharedInboxID,
      accountEmail: sharedInboxID ? undefined : typeof parsed.account_email === "string" ? parsed.account_email.trim().toLowerCase() || undefined : undefined,
      companyID: typeof parsed.company_id === "string" ? parsed.company_id.trim() || undefined : undefined,
    };
  } catch {
    return { messageIDs: [] };
  }
}

export function readTriageMessageIDs(dataTransfer: DataTransfer): string[] {
  return readTriageMessageDrag(dataTransfer).messageIDs;
}

export function hasTriageMessageDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(TRIAGE_MESSAGE_DRAG_MIME);
}
