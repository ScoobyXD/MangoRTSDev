import { apiFetchJSON } from "../../auth/cognitoAuth.js";

export type EmailProvider = "google" | "microsoft";

export type EmailSmartFilterID = "important" | "primary" | "unread" | "starred" | "updates" | "social" | "promotions" | "forums" | "all";

export type EmailSmartFilter = {
  id: EmailSmartFilterID;
  label: string;
  query: string;
  unread?: boolean;
};

export const EMAIL_SMART_FILTERS: EmailSmartFilter[] = [
  { id: "important", label: "Important", query: "is:important -category:promotions -category:social -in:spam -in:trash" },
  { id: "primary", label: "Primary", query: "category:primary -in:spam -in:trash" },
  { id: "unread", label: "Unread", query: "-category:promotions -in:spam -in:trash", unread: true },
  { id: "starred", label: "Starred", query: "is:starred -in:spam -in:trash" },
  { id: "updates", label: "Updates", query: "category:updates -in:spam -in:trash" },
  { id: "social", label: "Social", query: "category:social -in:spam -in:trash" },
  { id: "promotions", label: "Promos", query: "category:promotions -in:spam -in:trash" },
  { id: "forums", label: "Forums", query: "category:forums -in:spam -in:trash" },
  { id: "all", label: "All", query: "" },
];

export type EmailConnection = {
  user_id: string;
  provider: EmailProvider;
  account_email: string;
  status: "connected" | "disconnected" | "reauth_required";
  created_timestamp: string;
  updated_timestamp: string;
};

export type CommunicationsStatus = {
  configured: boolean;
  connected: boolean;
  status: "connected" | "disconnected" | "reauth_required";
  connection?: EmailConnection;
};

export type EmailAddress = {
  name?: string;
  email: string;
};

export type EmailFolder = {
  id: string;
  name: string;
  display_name?: string;
  system_folder?: string;
  attributes?: string[];
  unread_count?: number;
  total_count?: number;
};

export type EmailMessage = {
  id: string;
  thread_id?: string;
  subject: string;
  snippet?: string;
  body?: string;
  date?: number;
  unread: boolean;
  starred: boolean;
  from?: EmailAddress[];
  to?: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  reply_to?: EmailAddress[];
  folders?: string[];
  folder_ids?: string[];
};

export type ListMessagesParams = {
  limit?: number;
  pageToken?: string;
  folderID?: string;
  q?: string;
  unread?: boolean;
};

export type MessagePage = {
  messages: EmailMessage[];
  next_page_token?: string;
};

export type SendEmailInput = {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  body: string;
  reply_to_message_id?: string;
};

export type CommunicationsMessageState = {
  company_id: string;
  message_id: string;
  shared_inbox: boolean;
  status: "open" | "pending" | "resolved";
  assigned_user_id?: string;
  linked_node_id?: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type CommunicationsMessageComment = {
  company_id: string;
  message_id: string;
  comment_id: string;
  user_id: string;
  body: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type CommunicationsSharedDraft = {
  company_id: string;
  message_id: string;
  draft_id: string;
  user_id: string;
  subject: string;
  body: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type CommunicationsReadReceipt = {
  company_id: string;
  message_id: string;
  user_id: string;
  read_timestamp: string;
};

export type CommunicationsCollaborationState = {
  state: CommunicationsMessageState;
  comments: CommunicationsMessageComment[];
  drafts: CommunicationsSharedDraft[];
  read_receipts: CommunicationsReadReceipt[];
};

export async function fetchCommunicationsStatus(): Promise<CommunicationsStatus> {
  return apiFetchJSON<CommunicationsStatus>("/v1/communications/status");
}

export async function fetchCommunicationsAuthURL(provider: EmailProvider): Promise<string> {
  const payload = await apiFetchJSON<{ auth_url: string }>(`/v1/communications/auth-url?provider=${encodeURIComponent(provider)}`);
  return payload.auth_url;
}

export async function disconnectCommunications(): Promise<void> {
  await apiFetchJSON<{ status: string }>("/v1/communications/disconnect", { method: "POST" });
}

export async function listEmailFolders(): Promise<EmailFolder[]> {
  const payload = await apiFetchJSON<{ folders?: EmailFolder[] }>("/v1/communications/folders");
  return payload.folders ?? [];
}

export async function listEmailMessages(params: ListMessagesParams): Promise<MessagePage> {
  return apiFetchJSON<MessagePage>(`/v1/communications/messages${createMessageQuery(params)}`);
}

export async function getEmailMessage(messageID: string): Promise<EmailMessage> {
  const payload = await apiFetchJSON<{ message: EmailMessage }>(`/v1/communications/messages/${encodeURIComponent(messageID)}`);
  return payload.message;
}

export async function updateEmailMessage(messageID: string, update: { unread?: boolean; starred?: boolean; folders?: string[] }): Promise<EmailMessage> {
  const payload = await apiFetchJSON<{ message: EmailMessage }>(`/v1/communications/messages/${encodeURIComponent(messageID)}`, {
    method: "PUT",
    body: JSON.stringify(update),
  });
  return payload.message;
}

export async function deleteEmailMessage(messageID: string): Promise<void> {
  await apiFetchJSON<{ status: string }>(`/v1/communications/messages/${encodeURIComponent(messageID)}`, { method: "DELETE" });
}

export async function sendEmail(input: SendEmailInput): Promise<EmailMessage> {
  const payload = await apiFetchJSON<{ message: EmailMessage }>("/v1/communications/messages/send", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return payload.message;
}

export async function getCommunicationsCollaboration(messageID: string, companyID: string): Promise<CommunicationsCollaborationState> {
  return apiFetchJSON<CommunicationsCollaborationState>(`/v1/communications/collaboration/${encodeURIComponent(messageID)}?company_id=${encodeURIComponent(companyID)}`);
}

export async function updateCommunicationsCollaboration(messageID: string, input: {
  company_id: string;
  shared_inbox?: boolean;
  status?: CommunicationsMessageState["status"];
  assigned_user_id?: string | null;
  linked_node_id?: string | null;
}): Promise<CommunicationsCollaborationState> {
  return apiFetchJSON<CommunicationsCollaborationState>(`/v1/communications/collaboration/${encodeURIComponent(messageID)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function createCommunicationsComment(messageID: string, companyID: string, body: string): Promise<CommunicationsMessageComment> {
  const payload = await apiFetchJSON<{ comment: CommunicationsMessageComment }>(`/v1/communications/collaboration/${encodeURIComponent(messageID)}/comments`, {
    method: "POST",
    body: JSON.stringify({ company_id: companyID, body }),
  });
  return payload.comment;
}

export async function upsertCommunicationsSharedDraft(messageID: string, companyID: string, subject: string, body: string): Promise<CommunicationsSharedDraft> {
  const payload = await apiFetchJSON<{ draft: CommunicationsSharedDraft }>(`/v1/communications/collaboration/${encodeURIComponent(messageID)}/drafts`, {
    method: "POST",
    body: JSON.stringify({ company_id: companyID, subject, body }),
  });
  return payload.draft;
}

export async function markCommunicationsRead(messageID: string, companyID: string): Promise<CommunicationsReadReceipt> {
  const payload = await apiFetchJSON<{ read_receipt: CommunicationsReadReceipt }>(`/v1/communications/collaboration/${encodeURIComponent(messageID)}/read-receipts`, {
    method: "POST",
    body: JSON.stringify({ company_id: companyID }),
  });
  return payload.read_receipt;
}

export function createMessageQuery(params: ListMessagesParams): string {
  const query = new URLSearchParams();
  if (params.limit && params.limit > 0) query.set("limit", String(params.limit));
  if (params.pageToken) query.set("page_token", params.pageToken);
  if (params.folderID) query.set("folder_id", params.folderID);
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.unread !== undefined) query.set("unread", String(params.unread));
  const raw = query.toString();
  return raw ? `?${raw}` : "";
}

export function buildSmartFilterSearchQuery(filterID: EmailSmartFilterID, searchQuery: string): string {
  const filter = EMAIL_SMART_FILTERS.find((item) => item.id === filterID) ?? EMAIL_SMART_FILTERS[0];
  const parts = [filter.query.trim(), searchQuery.trim()].filter(Boolean);
  return parts.join(" ");
}

export function smartFilterUnread(filterID: EmailSmartFilterID): boolean | undefined {
  return (EMAIL_SMART_FILTERS.find((item) => item.id === filterID)?.unread) ? true : undefined;
}

export function parseEmailAddressList(raw: string): EmailAddress[] {
  const seen = new Set<string>();
  return raw
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseEmailAddress)
    .filter((item): item is EmailAddress => !!item)
    .filter((item) => {
      const key = item.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parseEmailAddress(raw: string): EmailAddress | null {
  const bracketMatch = raw.match(/^(.*?)<([^<>]+)>$/);
  const email = (bracketMatch ? bracketMatch[2] : raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = bracketMatch ? bracketMatch[1].trim().replace(/^"|"$/g, "") : "";
  return name ? { name, email } : { email };
}
