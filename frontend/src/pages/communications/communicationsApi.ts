import { apiFetchJSON } from "../../auth/cognitoAuth.js";

export type EmailProvider = "google" | "microsoft";

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
