package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

func normalizeEmailAttachmentResourceAccessInput(input EmailAttachmentResourceAccessInput) (EmailAttachmentResourceAccessInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.UserID = cleanUUIDText(input.UserID)
	input.ResourceType = NormalizeAttachmentResourceType(input.ResourceType)
	input.ResourceID = strings.TrimSpace(input.ResourceID)
	input.AccessLevel, _ = NormalizeEntityPermission(input.AccessLevel)
	if input.CompanyID == "" || input.UserID == "" || input.ResourceID == "" ||
		(input.ResourceType != "email_message" && input.ResourceType != "email_draft" && input.ResourceType != "email_signature") ||
		EntityPermissionRank(input.AccessLevel) == 0 {
		return EmailAttachmentResourceAccessInput{}, ErrInvalid
	}
	if input.ResourceType == "email_message" && cleanUUIDText(input.ResourceID) == "" {
		return EmailAttachmentResourceAccessInput{}, ErrInvalid
	}
	return input, nil
}

func (r *PostgresRepo) GetEmailAttachmentResourceAccess(input EmailAttachmentResourceAccessInput) (EmailAttachmentResourceAccess, error) {
	input, err := normalizeEmailAttachmentResourceAccessInput(input)
	if err != nil {
		return EmailAttachmentResourceAccess{}, err
	}
	ctx := context.Background()
	var result EmailAttachmentResourceAccess
	switch input.ResourceType {
	case "email_message":
		err = r.db.QueryRowContext(ctx, `
select (
  (connection.connection_type='personal' and connection.personal_user_id=$2::uuid)
  or exists (
    select 1 from shared_inboxes inbox
    where inbox.company_id=thread.company_id
      and inbox.company_email_connection_id=thread.email_connection_id
      and mangorts_user_can_access_resource(
        message.company_id,'shared_inbox',inbox.shared_inbox_id,$2::uuid,$4::text)
  )
  or exists (
    select 1 from email_relationships relationship
    where relationship.company_id=message.company_id
      and relationship.email_message_id=message.email_message_id
      and mangorts_user_can_access_resource(relationship.company_id,relationship.resource_type,
        relationship.resource_id,$2::uuid,$4::text)
  )
)
from email_messages message
join email_threads thread on thread.company_id=message.company_id and thread.email_thread_id=message.email_thread_id
join email_connections connection on connection.company_id=thread.company_id
 and connection.email_connection_id=thread.email_connection_id
where message.company_id=$1::uuid and message.email_message_id=$3::uuid`,
			input.CompanyID, input.UserID, input.ResourceID, input.AccessLevel).Scan(&result.Allowed)
	case "email_draft":
		err = r.db.QueryRowContext(ctx, `
select (
  draft.personal_user_id=$2::uuid
  or (draft.shared_inbox_id is not null and mangorts_user_can_access_resource(
    draft.company_id,'shared_inbox',draft.shared_inbox_id,$2::uuid,$4::text))
)
from email_drafts draft
where draft.company_id=$1::uuid and draft.draft_id=$3 and draft.deleted_timestamp is null`,
			input.CompanyID, input.UserID, input.ResourceID, input.AccessLevel).Scan(&result.Allowed)
	case "email_signature":
		err = r.db.QueryRowContext(ctx, `
select (
  signature.personal_user_id=$2::uuid
  or (signature.shared_inbox_id is not null and mangorts_user_can_access_resource(
    signature.company_id,'shared_inbox',signature.shared_inbox_id,$2::uuid,$4::text))
)
from email_signatures signature
where signature.company_id=$1::uuid and signature.signature_id=$3`,
			input.CompanyID, input.UserID, input.ResourceID, input.AccessLevel).Scan(&result.Allowed)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return EmailAttachmentResourceAccess{}, ErrNotFound
	}
	return result, err
}

func (r *MemoryRepo) GetEmailAttachmentResourceAccess(input EmailAttachmentResourceAccessInput) (EmailAttachmentResourceAccess, error) {
	input, err := normalizeEmailAttachmentResourceAccessInput(input)
	if err != nil {
		return EmailAttachmentResourceAccess{}, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	switch input.ResourceType {
	case "email_message":
		var threadFound bool
		var threadID string
		var allowed bool
		for _, thread := range r.emailThreads {
			if thread.CompanyID != input.CompanyID {
				continue
			}
			for _, message := range thread.Messages {
				if message.EmailMessageID != input.ResourceID {
					continue
				}
				threadFound, threadID = true, thread.EmailThreadID
				allowed = thread.PersonalUserID == input.UserID ||
					(thread.SharedInboxID != "" && r.userHasEffectiveAccessLocked(input.CompanyID, input.UserID, EntityTypeSharedInbox, thread.SharedInboxID, input.AccessLevel))
				break
			}
		}
		if !threadFound {
			return EmailAttachmentResourceAccess{}, ErrNotFound
		}
		if !allowed {
			for _, relationship := range r.emailCollaborations {
				if relationship.CompanyID == input.CompanyID && relationship.EmailThreadID == threadID &&
					(relationship.RootMessageID == input.ResourceID || relationship.LatestMessageID == input.ResourceID || relationship.Message.EmailMessageID == input.ResourceID) &&
					r.userHasEffectiveAccessLocked(input.CompanyID, input.UserID, EntityTypeNode, relationship.NodeID, input.AccessLevel) {
					allowed = true
					break
				}
			}
		}
		return EmailAttachmentResourceAccess{Allowed: allowed}, nil
	case "email_draft":
		draft, ok := r.emailDrafts[communicationsEmailDraftKey(input.CompanyID, input.ResourceID)]
		if !ok || draft.DeletedTimestamp != nil {
			return EmailAttachmentResourceAccess{}, ErrNotFound
		}
		allowed := draft.PersonalUserID == input.UserID ||
			(draft.SharedInboxID != "" && r.userHasEffectiveAccessLocked(input.CompanyID, input.UserID, EntityTypeSharedInbox, draft.SharedInboxID, input.AccessLevel))
		return EmailAttachmentResourceAccess{Allowed: allowed}, nil
	case "email_signature":
		signature, ok := r.emailSignatures[communicationsEmailSignatureKey(input.CompanyID, input.ResourceID)]
		if !ok {
			return EmailAttachmentResourceAccess{}, ErrNotFound
		}
		allowed := signature.PersonalUserID == input.UserID ||
			(signature.SharedInboxID != "" && r.userHasEffectiveAccessLocked(input.CompanyID, input.UserID, EntityTypeSharedInbox, signature.SharedInboxID, input.AccessLevel))
		return EmailAttachmentResourceAccess{Allowed: allowed}, nil
	default:
		return EmailAttachmentResourceAccess{}, ErrInvalid
	}
}
