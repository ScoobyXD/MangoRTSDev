package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func ImportedEmailAttachmentID(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x1f")))
	b := append([]byte(nil), sum[:16]...)
	b[6] = (b[6] & 0x0f) | 0x50
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

type redundantImportedEmailAttachmentRule struct {
	EmailMessageID        string `json:"email_message_id"`
	CanonicalAttachmentID string `json:"canonical_attachment_id"`
	ImportedAttachmentID  string `json:"imported_attachment_id"`
}

func redundantImportedEmailAttachmentRuleForSnapshot(
	companyID, emailThreadID, emailMessageID, providerMessageID string,
	attachment domain.EmailAttachmentSnapshot,
) (redundantImportedEmailAttachmentRule, bool) {
	canonicalAttachmentID := cleanUUIDText(attachment.AttachmentID)
	providerAttachmentID := strings.TrimSpace(attachment.ID)
	if canonicalAttachmentID == "" || providerAttachmentID == "" {
		return redundantImportedEmailAttachmentRule{}, false
	}
	importedAttachmentID := ImportedEmailAttachmentID(
		companyID, emailThreadID, providerMessageID, providerAttachmentID, attachment.ContentID, attachment.Filename,
	)
	if importedAttachmentID == canonicalAttachmentID {
		return redundantImportedEmailAttachmentRule{}, false
	}
	return redundantImportedEmailAttachmentRule{
		EmailMessageID: cleanUUIDText(emailMessageID), CanonicalAttachmentID: canonicalAttachmentID,
		ImportedAttachmentID: importedAttachmentID,
	}, cleanUUIDText(emailMessageID) != ""
}

func convergeCommunicationsEmailThreadAttachmentLinksTx(
	ctx context.Context, tx *sql.Tx, companyID, emailThreadID string,
) (bool, error) {
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	if companyID == "" || emailThreadID == "" {
		return false, ErrInvalid
	}
	rows, err := tx.QueryContext(ctx, `
select email_message_id::text,provider_message_id,attachment_metadata
from email_messages
where company_id=$1::uuid and email_thread_id=$2::uuid and download_complete
  and jsonb_typeof(attachment_metadata)='array' and jsonb_array_length(attachment_metadata)>0
order by email_message_id
for update`, companyID, emailThreadID)
	if err != nil {
		return false, err
	}
	rules := make([]redundantImportedEmailAttachmentRule, 0)
	for rows.Next() {
		var emailMessageID, providerMessageID string
		var raw json.RawMessage
		if err := rows.Scan(&emailMessageID, &providerMessageID, &raw); err != nil {
			rows.Close()
			return false, err
		}
		var attachments []domain.EmailAttachmentSnapshot
		if err := json.Unmarshal(raw, &attachments); err != nil {
			continue
		}
		for _, attachment := range attachments {
			if rule, ok := redundantImportedEmailAttachmentRuleForSnapshot(
				companyID, emailThreadID, emailMessageID, providerMessageID, attachment,
			); ok {
				rules = append(rules, rule)
			}
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return false, err
	}
	if err := rows.Close(); err != nil {
		return false, err
	}
	if len(rules) == 0 {
		return false, nil
	}
	rulesJSON, err := json.Marshal(rules)
	if err != nil {
		return false, err
	}
	locked, err := tx.QueryContext(ctx, `
select attachment.attachment_id::text
from attachments attachment
where attachment.company_id=$1::uuid
  and exists (
    select 1
    from jsonb_to_recordset($2::jsonb) as rule(canonical_attachment_id text,imported_attachment_id text)
    where attachment.attachment_id::text in (rule.canonical_attachment_id,rule.imported_attachment_id)
  )
order by attachment.attachment_id
for update of attachment`, companyID, string(rulesJSON))
	if err != nil {
		return false, err
	}
	for locked.Next() {
		var ignored string
		if err := locked.Scan(&ignored); err != nil {
			locked.Close()
			return false, err
		}
	}
	if err := locked.Err(); err != nil {
		locked.Close()
		return false, err
	}
	if err := locked.Close(); err != nil {
		return false, err
	}
	retiredRows, err := tx.QueryContext(ctx, `
with rules as (
  select email_message_id,canonical_attachment_id,imported_attachment_id
  from jsonb_to_recordset($2::jsonb) as rule(
    email_message_id text,canonical_attachment_id text,imported_attachment_id text
  )
)
update attachment_relationships redundant
set deleted_timestamp=coalesce(redundant.deleted_timestamp,clock_timestamp())
from rules rule
where redundant.company_id=$1::uuid
  and redundant.resource_type='email_message'
  and redundant.resource_id=rule.email_message_id
  and redundant.attachment_id::text=rule.imported_attachment_id
  and redundant.deleted_timestamp is null
  and rule.canonical_attachment_id<>rule.imported_attachment_id
  and exists (
    select 1 from attachments canonical
    where canonical.company_id=redundant.company_id
      and canonical.attachment_id::text=rule.canonical_attachment_id
      and canonical.deleted_timestamp is null
  )
  and exists (
    select 1 from attachment_relationships canonical_link
    where canonical_link.company_id=redundant.company_id
      and canonical_link.resource_type='email_message'
      and canonical_link.resource_id=redundant.resource_id
      and canonical_link.attachment_id::text=rule.canonical_attachment_id
      and canonical_link.deleted_timestamp is null
  )
returning redundant.attachment_id::text`, companyID, string(rulesJSON))
	if err != nil {
		return false, err
	}
	retired := make([]string, 0)
	for retiredRows.Next() {
		var attachmentID string
		if err := retiredRows.Scan(&attachmentID); err != nil {
			retiredRows.Close()
			return false, err
		}
		retired = append(retired, attachmentID)
	}
	if err := retiredRows.Err(); err != nil {
		retiredRows.Close()
		return false, err
	}
	if err := retiredRows.Close(); err != nil {
		return false, err
	}
	retired = cleanUUIDTextSlice(retired)
	if err := markUnownedAttachmentsPendingTx(ctx, tx, companyID, retired); err != nil {
		return false, err
	}
	return len(retired) > 0, nil
}

// retireAttachmentRelationshipsTx is the single database-side owner unlink
// path. It locks each affected attachment before changing links so a concurrent
// relink either completes first or observes deleted_timestamp and fails.
func retireAttachmentRelationshipsTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID string,
	resourceType string,
	resourceID string,
	attachmentID string,
	relationshipKind string,
	retainedAttachmentIDsJSON string,
) ([]string, error) {
	companyID = strings.TrimSpace(companyID)
	resourceType = NormalizeAttachmentResourceType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	attachmentID = cleanUUIDText(attachmentID)
	relationshipKind = strings.TrimSpace(relationshipKind)
	retainedAttachmentIDsJSON = strings.TrimSpace(retainedAttachmentIDsJSON)
	if retainedAttachmentIDsJSON == "" {
		retainedAttachmentIDsJSON = "[]"
	}
	if companyID == "" || resourceType == "" || resourceID == "" {
		return nil, ErrInvalid
	}

	rows, err := tx.QueryContext(ctx, `
select attachment.attachment_id::text
from attachments attachment
where attachment.company_id=$1::uuid
  and ($4='' or attachment.attachment_id=nullif($4,'')::uuid)
  and exists (
    select 1
    from attachment_relationships relationship
    where relationship.company_id=attachment.company_id
      and relationship.attachment_id=attachment.attachment_id
      and relationship.resource_type=$2
      and relationship.resource_id=$3
      and ($5='' or relationship.relationship_kind=$5)
      and relationship.deleted_timestamp is null
      and not exists (
        select 1
        from jsonb_array_elements_text($6::jsonb) retained(attachment_id)
        where retained.attachment_id::uuid=relationship.attachment_id
      )
  )
order by attachment.attachment_id
for update of attachment`, companyID, resourceType, resourceID, attachmentID, relationshipKind, retainedAttachmentIDsJSON)
	if err != nil {
		return nil, err
	}
	attachmentIDs := make([]string, 0)
	for rows.Next() {
		var candidate string
		if err := rows.Scan(&candidate); err != nil {
			rows.Close()
			return nil, err
		}
		attachmentIDs = append(attachmentIDs, candidate)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if len(attachmentIDs) == 0 {
		return nil, nil
	}

	if _, err := tx.ExecContext(ctx, `
update attachment_relationships relationship
set deleted_timestamp=coalesce(relationship.deleted_timestamp,clock_timestamp())
where relationship.company_id=$1::uuid
  and relationship.resource_type=$2
  and relationship.resource_id=$3
  and ($4='' or relationship.attachment_id=nullif($4,'')::uuid)
  and ($5='' or relationship.relationship_kind=$5)
  and relationship.deleted_timestamp is null
  and not exists (
    select 1
    from jsonb_array_elements_text($6::jsonb) retained(attachment_id)
    where retained.attachment_id::uuid=relationship.attachment_id
  )`, companyID, resourceType, resourceID, attachmentID, relationshipKind, retainedAttachmentIDsJSON); err != nil {
		return nil, err
	}
	if err := markUnownedAttachmentsPendingTx(ctx, tx, companyID, attachmentIDs); err != nil {
		return nil, err
	}
	return attachmentIDs, nil
}

func promoteEmailDraftAttachmentRelationshipsTx(ctx context.Context, tx *sql.Tx, companyID, draftID, emailMessageID string) error {
	rows, err := tx.QueryContext(ctx, `
select attachment_id::text,coalesce(information_id::text,'') as information_id,
       message_id,editor_surface,relationship_kind,coalesce(created_by_user_id::text,'') as created_by_user_id
from attachment_relationships
where company_id=$1::uuid and resource_type='email_draft' and resource_id=$2
  and deleted_timestamp is null
order by attachment_relationship_id`, companyID, draftID)
	if err != nil {
		return err
	}
	sources := make([]domain.ResourceAttachment, 0)
	for rows.Next() {
		var source domain.ResourceAttachment
		if err := rows.Scan(&source.AttachmentID, &source.InformationID, &source.MessageID, &source.EditorSurface, &source.RelationshipKind, &source.CreatedByUserID); err != nil {
			rows.Close()
			return err
		}
		sources = append(sources, source)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	created := time.Now().UTC()
	for _, source := range sources {
		source.ResourceAttachmentID = newUUIDv7String()
		source.CompanyID = companyID
		source.ResourceType = "email_message"
		source.ResourceID = emailMessageID
		source.CreatedTimestamp = created
		if _, err := insertOrReviveResourceAttachmentTx(ctx, tx, source); err != nil {
			return err
		}
	}
	return nil
}

func retireAttachmentOwnerRelationshipsTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) error {
	_, err := retireAttachmentRelationshipsTx(ctx, tx, companyID, resourceType, resourceID, "", "", "[]")
	return err
}

func markUnownedAttachmentsPendingTx(ctx context.Context, tx *sql.Tx, companyID string, attachmentIDs []string) error {
	companyID = cleanUUIDText(companyID)
	attachmentIDs = cleanUUIDTextSlice(attachmentIDs)
	if companyID == "" {
		return ErrInvalid
	}
	if len(attachmentIDs) == 0 {
		return nil
	}
	_, err := tx.ExecContext(ctx, `
update attachments
set deleted_timestamp=coalesce(deleted_timestamp,clock_timestamp())
where company_id=$1::uuid
  and attachment_id=any(string_to_array($2,',')::uuid[])
  and not exists (
    select 1 from attachment_relationships relationship
    where relationship.company_id=attachments.company_id
      and relationship.attachment_id=attachments.attachment_id
      and relationship.deleted_timestamp is null
  )`, companyID, strings.Join(attachmentIDs, ","))
	return err
}
func retireNodeTextboxChatTreeRelationshipsTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, rootChatID string) error {
	rows, err := tx.QueryContext(ctx, `
with recursive deleted_chats(chat_id) as (
  select chat_id
  from node_textbox_chats
  where company_id=$1::uuid and node_id=$2::uuid and chat_id=$3::uuid
  union all
  select child.chat_id
  from node_textbox_chats child
  join deleted_chats parent on child.parent_chat_id=parent.chat_id
  where child.company_id=$1::uuid and child.node_id=$2::uuid
)
select chat_id::text from deleted_chats order by chat_id`, companyID, nodeID, rootChatID)
	if err != nil {
		return err
	}
	chatIDs := make([]string, 0)
	for rows.Next() {
		var chatID string
		if err := rows.Scan(&chatID); err != nil {
			rows.Close()
			return err
		}
		chatIDs = append(chatIDs, chatID)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, chatID := range chatIDs {
		if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "node_chat_message", chatID); err != nil {
			return err
		}
	}
	return nil
}

func retireNodeTextboxAttachmentRelationshipsTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, textboxID string) error {
	rows, err := tx.QueryContext(ctx, `
select chat_id::text
from node_textbox_chats
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid
order by chat_id`, companyID, nodeID, textboxID)
	if err != nil {
		return err
	}
	chatIDs := make([]string, 0)
	for rows.Next() {
		var chatID string
		if err := rows.Scan(&chatID); err != nil {
			rows.Close()
			return err
		}
		chatIDs = append(chatIDs, chatID)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, chatID := range chatIDs {
		if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "node_chat_message", chatID); err != nil {
			return err
		}
	}
	return nil
}
func retireNodeChatAttachmentRelationshipsTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	rows, err := tx.QueryContext(ctx, `
select chat_id::text from node_textbox_chats
where company_id=$1::uuid and node_id=$2::uuid
order by chat_id`, companyID, nodeID)
	if err != nil {
		return err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, id := range ids {
		if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "node_chat_message", id); err != nil {
			return err
		}
	}
	return nil
}

func retireProjectTextboxChatTreeRelationshipsTx(ctx context.Context, tx *sql.Tx, companyID, projectID, rootChatID string) error {
	rows, err := tx.QueryContext(ctx, `
with recursive deleted_chats(chat_id) as (
  select chat_id from project_textbox_chats
  where company_id=$1::uuid and project_id=$2::uuid and chat_id=$3::uuid
  union all
  select child.chat_id
  from project_textbox_chats child
  join deleted_chats parent on child.parent_chat_id=parent.chat_id
  where child.company_id=$1::uuid and child.project_id=$2::uuid
)
select chat_id::text from deleted_chats order by chat_id`, companyID, projectID, rootChatID)
	if err != nil {
		return err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, id := range ids {
		if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "project_chat_message", id); err != nil {
			return err
		}
	}
	return nil
}

func retireProjectTextboxAttachmentRelationshipsTx(ctx context.Context, tx *sql.Tx, companyID, projectID, textboxID string) error {
	rows, err := tx.QueryContext(ctx, `
select attachment.attachment_id::text
from attachments attachment
where attachment.company_id=$1::uuid
  and exists (
    select 1 from attachment_relationships relationship
    where relationship.company_id=attachment.company_id
      and relationship.attachment_id=attachment.attachment_id
      and relationship.resource_type='project'
      and relationship.resource_id=$2
      and relationship.information_id=$3::uuid
      and relationship.deleted_timestamp is null
  )
order by attachment.attachment_id
for update of attachment`, companyID, projectID, textboxID)
	if err != nil {
		return err
	}
	attachmentIDs := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		attachmentIDs = append(attachmentIDs, id)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
update attachment_relationships
set deleted_timestamp=coalesce(deleted_timestamp,clock_timestamp())
where company_id=$1::uuid and resource_type='project' and resource_id=$2
  and information_id=$3::uuid and deleted_timestamp is null`, companyID, projectID, textboxID); err != nil {
		return err
	}
	if err := markUnownedAttachmentsPendingTx(ctx, tx, companyID, attachmentIDs); err != nil {
		return err
	}
	rows, err = tx.QueryContext(ctx, `
select chat_id::text from project_textbox_chats
where company_id=$1::uuid and project_id=$2::uuid and textbox_id=$3
order by chat_id`, companyID, projectID, textboxID)
	if err != nil {
		return err
	}
	chatIDs := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		chatIDs = append(chatIDs, id)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, id := range chatIDs {
		if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "project_chat_message", id); err != nil {
			return err
		}
	}
	return nil
}

func retireProjectChatAttachmentRelationshipsTx(ctx context.Context, tx *sql.Tx, companyID, projectID string) error {
	rows, err := tx.QueryContext(ctx, `
select chat_id::text from project_textbox_chats
where company_id=$1::uuid and project_id=$2::uuid
order by chat_id`, companyID, projectID)
	if err != nil {
		return err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, id := range ids {
		if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "project_chat_message", id); err != nil {
			return err
		}
	}
	return nil
}
