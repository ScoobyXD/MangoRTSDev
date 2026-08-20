import type { CommunicationsEmailDraft, EmailAddress, EmailMessage } from "../../modules/communications/communicationsApi";

export const homeSharedMailDraftMessageID = (draftID: string): string => `shared-draft:${draftID.trim()}`;

export function homeSharedMailDraftToMessage(draft: CommunicationsEmailDraft): EmailMessage {
  return {
    id: homeSharedMailDraftMessageID(draft.draft_id), email_message_id: draft.source_message_id, email_thread_id: draft.source_thread_id,
    subject: draft.subject || "(no subject)", snippet: draft.shared_resource_type === "project" ? "Project shared reply draft" : "Node shared reply draft",
    date: Math.floor((Date.parse(draft.updated_timestamp || draft.created_timestamp) || 0) / 1000),
    unread: false, starred: false, folders: ["drafts"],
    to: parseDraftAddresses(draft.to_recipients), cc: parseDraftAddresses(draft.cc_recipients), bcc: parseDraftAddresses(draft.bcc_recipients),
    collaboration_shared_inbox_id: draft.shared_inbox_id,
    collaboration_account_email: draft.account_email || draft.personal_account_email,
  };
}

export const homeSharedMailDraftMatchesSearch = (draft: CommunicationsEmailDraft, query: string): boolean => !query.trim() || [draft.subject, draft.to_recipients, draft.cc_recipients, draft.bcc_recipients].some((value) => value.toLowerCase().includes(query.trim().toLowerCase()));

const parseDraftAddresses = (value: string): EmailAddress[] => value.split(/[;,]/).map((email) => email.trim()).filter(Boolean).map((email) => ({ email }));
