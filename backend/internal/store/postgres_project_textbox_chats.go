package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

const postgresProjectTextboxChatProjectionSelect = `
select chat.company_id::text,
       chat.project_id::text,
       'Text block chat',
       jsonb_build_object(
         'block_id', chat.textbox_id,
         'parent_id', coalesce(chat.parent_chat_id::text, ''),
         'selection_source', chat.selection_source,
         'selection_block_id', coalesce(chat.selection_textbox_id, ''),
         'selection_message_id', coalesce(chat.selection_email_message_id::text, ''),
         'selection_quote', chat.selection_quote,
         'selection_start', chat.selection_start,
         'selection_end', chat.selection_end,
         'author_id', coalesce(chat.author_user_id::text, ''),
         'author_name', chat.author_display_name,
         'message', chat.message,
         'created_timestamp', chat.created_timestamp,
         'edited_timestamp', chat.edited_timestamp,
         'attachments', coalesce((
           select jsonb_agg(
             jsonb_build_object(
               'id', attachment.attachment_id::text,
               'attachment_id', attachment.attachment_id::text,
               'name', attachment.original_filename,
               'filename', attachment.original_filename,
               'type', attachment.mime_type,
               'mime_type', attachment.mime_type,
               'size', attachment.byte_size,
               'byte_size', attachment.byte_size
             ) order by link.created_timestamp, attachment.attachment_id
           )
           from attachment_relationships link
           join attachments attachment
             on attachment.company_id=link.company_id
            and attachment.attachment_id=link.attachment_id
            and attachment.deleted_timestamp is null
           where link.company_id=chat.company_id
             and link.resource_type='project_chat_message'
             and link.resource_id=chat.chat_id::text
             and link.relationship_kind='chat_attachment'
             and link.deleted_timestamp is null
         ), '[]'::jsonb),
         'entity_links', chat.entity_links,
         'mentioned_user_ids', to_jsonb(chat.mentioned_user_ids),
         'mentioned_group_ids', to_jsonb(chat.mentioned_group_ids)
       )::text,
       chat.chat_id::text,
       chat.created_timestamp,
       chat.updated_timestamp
from project_textbox_chats chat`

func postgresProjectTextboxChatProjectionTx(ctx context.Context, tx *sql.Tx, companyID, projectID, chatID string) (domain.ProjectProjection, bool, error) {
	item, err := scanProjectProjection(tx.QueryRowContext(ctx, postgresProjectTextboxChatProjectionSelect+`
where chat.company_id=$1::uuid and chat.project_id=$2::uuid and chat.chat_id=$3::uuid`, companyID, projectID, chatID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ProjectProjection{}, false, nil
	}
	return item, err == nil, err
}

func listPostgresProjectTextboxChatProjections(ctx context.Context, db *sql.DB, companyID, projectID string) ([]domain.ProjectProjection, error) {
	rows, err := db.QueryContext(ctx, postgresProjectTextboxChatProjectionSelect+`
where chat.company_id=$1::uuid and chat.project_id=$2::uuid and chat.deleted_timestamp is null
order by chat.created_timestamp, chat.chat_id`, companyID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.ProjectProjection, 0)
	for rows.Next() {
		item, err := scanProjectProjection(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ensurePostgresProjectEmailSelectionTextboxLinkForFirstChatTx(
	ctx context.Context,
	tx *sql.Tx,
	input ProjectInformationInput,
	payload textboxChatPayload,
) error {
	if !payload.EnsureEmailTextboxLink {
		return nil
	}
	textboxID := cleanUUIDText(payload.BlockID)
	selectionTextboxID := cleanUUIDText(payload.SelectionBlockID)
	emailMessageID := cleanUUIDText(payload.SelectionMessageID)
	textboxColor := strings.ToUpper(strings.TrimSpace(payload.EmailTextboxColor))
	if strings.TrimSpace(payload.SelectionMessageID) == "" || emailMessageID == "" {
		return ErrEmailMessageIdentityInvalid
	}
	if textboxID == "" || textboxID == input.ProjectID || selectionTextboxID != textboxID ||
		strings.TrimSpace(payload.ParentID) != "" || strings.ToLower(strings.TrimSpace(payload.SelectionSource)) != "email" ||
		strings.TrimSpace(payload.SelectionQuote) == "" || !validEmailTextboxColor(textboxColor) {
		return ErrInvalid
	}
	var textboxExists, projectThreadExists bool
	if err := tx.QueryRowContext(ctx, `select exists(
  select 1 from project_textboxes
  where company_id=$1::uuid and project_id=$2::uuid and textbox_id=$3 and deleted_timestamp is null
), exists(
  select 1 from email_messages message
  where message.company_id=$1::uuid and message.email_message_id=$4::uuid
    and exists (
      select 1 from email_relationships wide
      where wide.company_id=message.company_id
        and wide.email_thread_id=message.email_thread_id
        and wide.resource_type='project'
        and wide.resource_id=$2::uuid
        and wide.resource_textbox_id is null
    )
)`, input.CompanyID, input.ProjectID, textboxID, emailMessageID).Scan(&textboxExists, &projectThreadExists); err != nil {
		return err
	}
	if !projectThreadExists {
		return ErrEmailMessageNotAttachedToProject
	}
	if !textboxExists {
		ref := EditorJSONDocumentRef{
			CompanyID: input.CompanyID, ResourceType: EntityTypeProject,
			ResourceID: input.ProjectID, DocumentID: textboxID,
		}
		storage, ok := postgresEditorTextboxStorageFor(ref)
		if !ok {
			return ErrInvalid
		}
		if err := insertEmptyPostgresEditorTextboxTx(ctx, tx, storage, ref); err != nil {
			return err
		}
	}
	attachedPayload, err := json.Marshal(emailTextboxRelationshipPayload{
		BlockID: textboxID, EmailMessageID: emailMessageID, TextboxColor: textboxColor,
		AttachedTimestamp: time.Now().UTC().Format(time.RFC3339Nano), LinkScope: "message",
	})
	if err != nil {
		return err
	}
	_, err = addPostgresProjectEmailRelationshipTx(ctx, tx, ProjectInformationInput{
		CompanyID: input.CompanyID, ProjectID: input.ProjectID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(attachedPayload), ActorUserID: input.ActorUserID,
	})
	return err
}

func normalizeProjectTextboxChatPayload(ctx context.Context, tx *sql.Tx, input ProjectInformationInput) (normalizedTextboxChat, error) {
	var payload textboxChatPayload
	if json.Unmarshal([]byte(input.Information), &payload) != nil {
		return normalizedTextboxChat{}, ErrInvalid
	}
	rawParentID, rawSelectionBlockID := strings.TrimSpace(payload.ParentID), strings.TrimSpace(payload.SelectionBlockID)
	payload.BlockID = cleanUUIDText(payload.BlockID)
	payload.ParentID = cleanUUIDText(payload.ParentID)
	payload.SelectionBlockID = cleanUUIDText(payload.SelectionBlockID)
	payload.AuthorID = cleanUUIDText(payload.AuthorID)
	actorUserID := cleanUUIDText(input.ActorUserID)
	if payload.AuthorID == "" {
		payload.AuthorID = actorUserID
	}
	if payload.BlockID == "" || payload.BlockID == input.ProjectID || payload.AuthorID == "" || actorUserID == "" || payload.AuthorID != actorUserID {
		return normalizedTextboxChat{}, ErrInvalid
	}
	if (rawParentID != "" && payload.ParentID == "") || (rawSelectionBlockID != "" && payload.SelectionBlockID == "") {
		return normalizedTextboxChat{}, ErrInvalid
	}
	selectionSource := strings.ToLower(strings.TrimSpace(payload.SelectionSource))
	if selectionSource == "" {
		selectionSource = "text"
	}
	if selectionSource != "text" && selectionSource != "email" {
		return normalizedTextboxChat{}, ErrInvalid
	}
	selectionEmailMessageID := ""
	if selectionSource == "text" {
		if strings.TrimSpace(payload.SelectionMessageID) != "" {
			return normalizedTextboxChat{}, ErrInvalid
		}
	} else {
		selectionEmailMessageID = cleanUUIDText(payload.SelectionMessageID)
		if selectionEmailMessageID == "" {
			return normalizedTextboxChat{}, ErrEmailMessageIdentityInvalid
		}
		canSelect, err := lockPostgresExactEmailTextboxRelationshipTx(
			ctx, tx, input.CompanyID, EntityTypeProject, input.ProjectID, payload.BlockID, selectionEmailMessageID,
		)
		if err != nil {
			return normalizedTextboxChat{}, err
		}
		if !canSelect {
			var linkedToAnotherTextbox bool
			if err := tx.QueryRowContext(ctx, `select exists(
  select 1 from email_relationships relationship
  where relationship.company_id=$1::uuid
    and relationship.email_message_id=$2::uuid
    and relationship.resource_type='project'
    and relationship.resource_id=$3::uuid
    and relationship.resource_textbox_id is not null
    and relationship.resource_textbox_id<>$4
)`, input.CompanyID, selectionEmailMessageID, input.ProjectID, payload.BlockID).Scan(&linkedToAnotherTextbox); err != nil {
				return normalizedTextboxChat{}, err
			}
			if linkedToAnotherTextbox {
				return normalizedTextboxChat{}, ErrEmailMessageTextboxConflict
			}
			return normalizedTextboxChat{}, ErrEmailMessageNotAttachedToProject
		}
	}
	if (payload.SelectionStart == nil) != (payload.SelectionEnd == nil) ||
		(payload.SelectionStart != nil && (*payload.SelectionStart < 0 || *payload.SelectionEnd < *payload.SelectionStart)) {
		return normalizedTextboxChat{}, ErrInvalid
	}
	attachmentIDsJSON, hasAttachments, err := normalizeChatAttachmentIDs(payload.Attachments)
	if err != nil {
		return normalizedTextboxChat{}, err
	}
	entityLinksJSON, _, err := normalizeJSONArray(payload.EntityLinks)
	if err != nil {
		return normalizedTextboxChat{}, err
	}
	mentionedUserIDsJSON, err := normalizeChatUUIDArray(payload.MentionedUserIDs)
	if err != nil {
		return normalizedTextboxChat{}, err
	}
	mentionedGroupIDsJSON, err := normalizeChatUUIDArray(payload.MentionedGroupIDs)
	if err != nil {
		return normalizedTextboxChat{}, err
	}
	message := strings.TrimSpace(payload.Message)
	if message == "" && !hasAttachments {
		return normalizedTextboxChat{}, ErrInvalid
	}
	createdTimestamp, _, err := parseChatTimestamp(payload.CreatedTimestamp, true)
	if err != nil {
		return normalizedTextboxChat{}, err
	}
	_, editedTimestamp, err := parseChatTimestamp(payload.EditedTimestamp, false)
	if err != nil || (editedTimestamp != nil && editedTimestamp.Before(createdTimestamp)) {
		return normalizedTextboxChat{}, ErrInvalid
	}
	return normalizedTextboxChat{
		TextboxID: payload.BlockID, ParentChatID: payload.ParentID,
		SelectionSource: selectionSource, SelectionTextboxID: payload.SelectionBlockID,
		SelectionEmailMessageID: selectionEmailMessageID, SelectionQuote: strings.TrimSpace(payload.SelectionQuote),
		SelectionStart: payload.SelectionStart, SelectionEnd: payload.SelectionEnd,
		AuthorUserID: payload.AuthorID, AuthorDisplayName: strings.TrimSpace(payload.AuthorName),
		Message: message, CreatedTimestamp: createdTimestamp, EditedTimestamp: editedTimestamp,
		AttachmentIDsJSON: attachmentIDsJSON, EntityLinksJSON: entityLinksJSON,
		MentionedUserIDsJSON: mentionedUserIDsJSON, MentionedGroupIDsJSON: mentionedGroupIDsJSON,
	}, nil
}

func syncPostgresProjectTextboxChatAttachmentsTx(ctx context.Context, tx *sql.Tx, companyID, chatID string, chat normalizedTextboxChat) error {
	var wantedCount, foundCount int
	if err := tx.QueryRowContext(ctx, `
with wanted as (select value::uuid attachment_id from jsonb_array_elements_text($2::jsonb))
select jsonb_array_length($2::jsonb), count(*)
from wanted join attachments attachment
  on attachment.company_id=$1::uuid and attachment.attachment_id=wanted.attachment_id
 and attachment.deleted_timestamp is null`, companyID, chat.AttachmentIDsJSON).Scan(&wantedCount, &foundCount); err != nil {
		return err
	}
	if wantedCount != foundCount {
		return ErrInvalid
	}
	if _, err := retireAttachmentRelationshipsTx(ctx, tx, companyID, "project_chat_message", chatID, "", AttachmentRelationshipChatAttachment, chat.AttachmentIDsJSON); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
insert into attachment_relationships(
  attachment_relationship_id,company_id,resource_type,resource_id,attachment_id,information_id,
  message_id,editor_surface,relationship_kind,created_by_user_id,created_timestamp
)
select gen_random_uuid(),$1::uuid,'project_chat_message',$2,wanted.attachment_id,$4::uuid,
       '','project_textbox_chat','chat_attachment',$5::uuid,clock_timestamp()
from (select value::uuid attachment_id from jsonb_array_elements_text($3::jsonb)) wanted
where not exists (
  select 1 from attachment_relationships link
  where link.company_id=$1::uuid and link.resource_type='project_chat_message'
    and link.resource_id=$2 and link.attachment_id=wanted.attachment_id
    and link.relationship_kind='chat_attachment' and link.deleted_timestamp is null
)`, companyID, chatID, chat.AttachmentIDsJSON, chat.TextboxID, chat.AuthorUserID)
	return err
}

func upsertPostgresProjectTextboxChatTx(ctx context.Context, tx *sql.Tx, input ProjectInformationInput) (domain.ProjectProjection, error) {
	var payload textboxChatPayload
	if json.Unmarshal([]byte(input.Information), &payload) != nil {
		return domain.ProjectProjection{}, ErrInvalid
	}
	if err := ensurePostgresProjectEmailSelectionTextboxLinkForFirstChatTx(ctx, tx, input, payload); err != nil {
		return domain.ProjectProjection{}, err
	}
	chat, err := normalizeProjectTextboxChatPayload(ctx, tx, input)
	if err != nil {
		return domain.ProjectProjection{}, err
	}
	var textboxExists bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from project_textboxes
where company_id=$1::uuid and project_id=$2::uuid and textbox_id=$3 and deleted_timestamp is null)`,
		input.CompanyID, input.ProjectID, chat.TextboxID).Scan(&textboxExists); err != nil {
		return domain.ProjectProjection{}, err
	}
	if !textboxExists {
		return domain.ProjectProjection{}, ErrNotFound
	}
	_, existed, err := postgresProjectTextboxChatProjectionTx(ctx, tx, input.CompanyID, input.ProjectID, input.InformationID)
	if err != nil {
		return domain.ProjectProjection{}, err
	}
	if existed {
		result, err := tx.ExecContext(ctx, `update project_textbox_chats
set message=$4,entity_links=$5::jsonb,
    mentioned_user_ids=array(select jsonb_array_elements_text($6::jsonb)::uuid),
    mentioned_group_ids=array(select jsonb_array_elements_text($7::jsonb)::uuid),
    edited_timestamp=$8::timestamptz,revision=revision+1,updated_timestamp=greatest(clock_timestamp(),created_timestamp,coalesce($8::timestamptz,created_timestamp))
where company_id=$1::uuid and project_id=$2::uuid and chat_id=$3::uuid and textbox_id=$9 and author_user_id=$10::uuid`,
			input.CompanyID, input.ProjectID, input.InformationID, chat.Message, chat.EntityLinksJSON,
			chat.MentionedUserIDsJSON, chat.MentionedGroupIDsJSON, chat.EditedTimestamp, chat.TextboxID, chat.AuthorUserID)
		if err != nil {
			return domain.ProjectProjection{}, err
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			if err != nil {
				return domain.ProjectProjection{}, err
			}
			return domain.ProjectProjection{}, ErrInvalid
		}
	} else {
		_, err = tx.ExecContext(ctx, `insert into project_textbox_chats(
  company_id,chat_id,project_id,textbox_id,parent_chat_id,selection_source,selection_textbox_id,
  selection_email_message_id,selection_quote,selection_start,selection_end,author_user_id,
  author_display_name,message,entity_links,mentioned_user_ids,mentioned_group_ids,
  revision,created_timestamp,edited_timestamp,updated_timestamp
) values(
  $1::uuid,$2::uuid,$3::uuid,$4,nullif($5,'')::uuid,$6,nullif($7,''),nullif($8,'')::uuid,
  $9,$10,$11,$12::uuid,$13,$14,$15::jsonb,
  array(select jsonb_array_elements_text($16::jsonb)::uuid),
  array(select jsonb_array_elements_text($17::jsonb)::uuid),1,$18::timestamptz,$19::timestamptz,
  greatest(clock_timestamp(),$18::timestamptz,coalesce($19::timestamptz,$18::timestamptz))
)`, input.CompanyID, input.InformationID, input.ProjectID, chat.TextboxID, chat.ParentChatID,
			chat.SelectionSource, chat.SelectionTextboxID, chat.SelectionEmailMessageID, chat.SelectionQuote,
			chat.SelectionStart, chat.SelectionEnd, chat.AuthorUserID, chat.AuthorDisplayName, chat.Message,
			chat.EntityLinksJSON, chat.MentionedUserIDsJSON, chat.MentionedGroupIDsJSON,
			chat.CreatedTimestamp, chat.EditedTimestamp)
		if err != nil {
			return domain.ProjectProjection{}, postgresEmailRelationshipMutationError(err, EntityTypeProject)
		}
	}
	if err := syncPostgresProjectTextboxChatAttachmentsTx(ctx, tx, input.CompanyID, input.InformationID, chat); err != nil {
		return domain.ProjectProjection{}, err
	}
	projection, found, err := postgresProjectTextboxChatProjectionTx(ctx, tx, input.CompanyID, input.ProjectID, input.InformationID)
	if err != nil {
		return domain.ProjectProjection{}, err
	}
	if !found {
		return domain.ProjectProjection{}, ErrNotFound
	}
	return projection, nil
}
