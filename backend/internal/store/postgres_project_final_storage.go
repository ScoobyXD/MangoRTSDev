package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

type projectAttachedEmailPayload struct {
	BlockID           string `json:"block_id"`
	EmailMessageID    string `json:"email_message_id"`
	AttachedTimestamp string `json:"attached_timestamp"`
}

func projectProjectionAsInformation(item domain.ProjectProjection) domain.ProjectInformation {
	return domain.ProjectInformation{
		CompanyID: item.CompanyID, ProjectID: item.ProjectID, InformationID: item.InformationID,
		Type: item.Type, Information: item.Information,
		CreatedTimestamp: item.CreatedTimestamp, UpdatedTimestamp: item.UpdatedTimestamp,
	}
}

const postgresProjectTextboxProjectionSelect = `
select textbox.company_id::text,
       textbox.project_id::text,
       'Text box',
       $3 || jsonb_build_object(
         'title', textbox.title,
         'document', (textbox.body_json->'document')::text,
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
           where link.company_id=textbox.company_id
             and link.resource_type='project'
             and link.resource_id=textbox.project_id::text
             and link.information_id::text=textbox.textbox_id
             and link.relationship_kind in ('file_attachment','inline_image','migrated_inline_image')
             and link.deleted_timestamp is null
         ), '[]'::jsonb),
         'email_message_id', textbox.email_message_id,
         'email_accent', textbox.email_accent
       )::text,
       textbox.textbox_id,
       textbox.created_timestamp,
       textbox.updated_timestamp
from project_textboxes textbox`

func scanProjectProjection(row interface{ Scan(dest ...any) error }) (domain.ProjectProjection, error) {
	var item domain.ProjectProjection
	err := row.Scan(&item.CompanyID, &item.ProjectID, &item.Type, &item.Information, &item.InformationID, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	return item, err
}

func listPostgresProjectTextboxProjections(ctx context.Context, db *sql.DB, companyID, projectID string) ([]domain.ProjectProjection, error) {
	rows, err := db.QueryContext(ctx, postgresProjectTextboxProjectionSelect+`
where textbox.company_id=$1::uuid and textbox.project_id=$2::uuid and textbox.deleted_timestamp is null
order by textbox.display_order, textbox.textbox_id`, companyID, projectID, editorTextBlockProjectionPrefix)
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

func normalizeProjectTextboxChatPayload(ctx context.Context, tx *sql.Tx, input ProjectInformationInput) (normalizedNodeTextboxChat, error) {
	var payload nodeTextboxChatPayload
	if json.Unmarshal([]byte(input.Information), &payload) != nil {
		return normalizedNodeTextboxChat{}, ErrInvalid
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
	if payload.BlockID == "" || payload.AuthorID == "" || actorUserID == "" || payload.AuthorID != actorUserID {
		return normalizedNodeTextboxChat{}, ErrInvalid
	}
	if (rawParentID != "" && payload.ParentID == "") || (rawSelectionBlockID != "" && payload.SelectionBlockID == "") {
		return normalizedNodeTextboxChat{}, ErrInvalid
	}
	selectionSource := strings.ToLower(strings.TrimSpace(payload.SelectionSource))
	if selectionSource == "" {
		selectionSource = "text"
	}
	if selectionSource != "text" && selectionSource != "email" {
		return normalizedNodeTextboxChat{}, ErrInvalid
	}
	selectionEmailMessageID := ""
	if selectionSource == "text" {
		if strings.TrimSpace(payload.SelectionMessageID) != "" {
			return normalizedNodeTextboxChat{}, ErrInvalid
		}
	} else {
		selectionEmailMessageID = cleanUUIDText(payload.SelectionMessageID)
		if selectionEmailMessageID == "" {
			return normalizedNodeTextboxChat{}, ErrInvalid
		}
		var canSelect bool
		if err := tx.QueryRowContext(ctx, `select exists(
  select 1 from email_relationships relationship
  where relationship.company_id=$1::uuid
    and relationship.email_message_id=$2::uuid
    and relationship.resource_type='project'
    and relationship.resource_id=$3::uuid
    and relationship.resource_textbox_id=$4
  union all
  select 1 from project_textbox_chats chat
  where chat.company_id=$1::uuid and chat.project_id=$3::uuid
    and chat.chat_id=nullif($5,'')::uuid and chat.deleted_timestamp is null
    and chat.selection_source='email' and chat.selection_email_message_id=$2::uuid
)`, input.CompanyID, selectionEmailMessageID, input.ProjectID, payload.BlockID, input.InformationID).Scan(&canSelect); err != nil {
			return normalizedNodeTextboxChat{}, err
		}
		if !canSelect {
			return normalizedNodeTextboxChat{}, ErrInvalid
		}
	}
	if (payload.SelectionStart == nil) != (payload.SelectionEnd == nil) ||
		(payload.SelectionStart != nil && (*payload.SelectionStart < 0 || *payload.SelectionEnd < *payload.SelectionStart)) {
		return normalizedNodeTextboxChat{}, ErrInvalid
	}
	attachmentIDsJSON, hasAttachments, err := normalizeChatAttachmentIDs(payload.Attachments)
	if err != nil {
		return normalizedNodeTextboxChat{}, err
	}
	entityLinksJSON, _, err := normalizeJSONArray(payload.EntityLinks)
	if err != nil {
		return normalizedNodeTextboxChat{}, err
	}
	mentionedUserIDsJSON, err := normalizeChatUUIDArray(payload.MentionedUserIDs)
	if err != nil {
		return normalizedNodeTextboxChat{}, err
	}
	mentionedGroupIDsJSON, err := normalizeChatUUIDArray(payload.MentionedGroupIDs)
	if err != nil {
		return normalizedNodeTextboxChat{}, err
	}
	message := strings.TrimSpace(payload.Message)
	if message == "" && !hasAttachments {
		return normalizedNodeTextboxChat{}, ErrInvalid
	}
	createdTimestamp, _, err := parseChatTimestamp(payload.CreatedTimestamp, true)
	if err != nil {
		return normalizedNodeTextboxChat{}, err
	}
	_, editedTimestamp, err := parseChatTimestamp(payload.EditedTimestamp, false)
	if err != nil || (editedTimestamp != nil && editedTimestamp.Before(createdTimestamp)) {
		return normalizedNodeTextboxChat{}, ErrInvalid
	}
	return normalizedNodeTextboxChat{
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

func syncPostgresProjectTextboxChatAttachmentsTx(ctx context.Context, tx *sql.Tx, companyID, chatID string, chat normalizedNodeTextboxChat) error {
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
			return domain.ProjectProjection{}, err
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

const postgresProjectEmailRelationshipProjectionSelect = `
select relationship.company_id::text,
       relationship.resource_id::text,
       'Attached email',
       jsonb_build_object(
         'block_id', coalesce(relationship.resource_textbox_id, ''),
         'collaboration_id', relationship.email_relationship_id::text,
         'message_id', message.provider_message_id,
         'email_message_id', message.email_message_id::text,
         'thread_id', thread.provider_thread_id,
         'email_thread_id', thread.email_thread_id::text,
         'shared_inbox_id', coalesce(inbox.shared_inbox_id::text, ''),
         'account_email', connection.account_email,
         'created_from_email', true,
         'subject', message.subject,
         'snippet', message.snippet,
         'from', coalesce(nullif(message.sender_snapshot->0->>'name', ''), message.sender_snapshot->0->>'email', ''),
         'date', case when message.message_timestamp is null then null else floor(extract(epoch from message.message_timestamp))::bigint end,
         'attached_timestamp', relationship.created_timestamp
       )::text,
       relationship.email_relationship_id::text,
       relationship.created_timestamp,
       relationship.created_timestamp
from email_relationships relationship
join email_messages message
  on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id
 and message.email_message_id=relationship.email_message_id
join email_threads thread
  on thread.company_id=message.company_id and thread.email_thread_id=message.email_thread_id
join email_connections connection
  on connection.company_id=thread.company_id and connection.email_connection_id=thread.email_connection_id
left join lateral (
  select shared_inbox_id from shared_inboxes
  where company_id=thread.company_id and company_email_connection_id=thread.email_connection_id
  order by shared_inbox_id limit 1
) inbox on true`

func postgresProjectEmailRelationshipProjectionTx(ctx context.Context, tx *sql.Tx, companyID, projectID, relationshipID string) (domain.ProjectProjection, bool, error) {
	item, err := scanProjectProjection(tx.QueryRowContext(ctx, postgresProjectEmailRelationshipProjectionSelect+`
where relationship.company_id=$1::uuid and relationship.resource_type='project'
  and relationship.resource_id=$2::uuid and relationship.email_relationship_id=$3::uuid`, companyID, projectID, relationshipID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ProjectProjection{}, false, nil
	}
	return item, err == nil, err
}

func listPostgresProjectEmailRelationshipProjections(ctx context.Context, db *sql.DB, companyID, projectID string) ([]domain.ProjectProjection, error) {
	rows, err := db.QueryContext(ctx, postgresProjectEmailRelationshipProjectionSelect+`
where relationship.company_id=$1::uuid and relationship.resource_type='project'
  and relationship.resource_id=$2::uuid
order by relationship.created_timestamp,relationship.email_relationship_id`, companyID, projectID)
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

func addPostgresProjectEmailRelationshipTx(ctx context.Context, tx *sql.Tx, input ProjectInformationInput) (domain.ProjectProjection, error) {
	var payload projectAttachedEmailPayload
	if json.Unmarshal([]byte(input.Information), &payload) != nil {
		return domain.ProjectProjection{}, ErrInvalid
	}
	payload.BlockID = cleanUUIDText(payload.BlockID)
	payload.EmailMessageID = cleanUUIDText(payload.EmailMessageID)
	actorUserID := cleanUUIDText(input.ActorUserID)
	if payload.BlockID == "" || payload.EmailMessageID == "" || actorUserID == "" {
		return domain.ProjectProjection{}, ErrInvalid
	}
	if existing, found, err := postgresProjectEmailRelationshipProjectionTx(ctx, tx, input.CompanyID, input.ProjectID, input.InformationID); err != nil {
		return domain.ProjectProjection{}, err
	} else if found {
		var existingMessageID, existingTextboxID string
		if err := tx.QueryRowContext(ctx, `select email_message_id::text,coalesce(resource_textbox_id,'')
from email_relationships where company_id=$1::uuid and email_relationship_id=$2::uuid`, input.CompanyID, input.InformationID).
			Scan(&existingMessageID, &existingTextboxID); err != nil {
			return domain.ProjectProjection{}, err
		}
		if existingMessageID != payload.EmailMessageID || existingTextboxID != payload.BlockID {
			return domain.ProjectProjection{}, ErrInvalid
		}
		return existing, nil
	}
	attachedAt := time.Now().UTC()
	if strings.TrimSpace(payload.AttachedTimestamp) != "" {
		parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(payload.AttachedTimestamp))
		if err != nil {
			return domain.ProjectProjection{}, ErrInvalid
		}
		attachedAt = parsed.UTC()
	}
	var emailThreadID string
	if err := tx.QueryRowContext(ctx, `select message.email_thread_id::text
from email_messages message
join email_threads thread on thread.company_id=message.company_id and thread.email_thread_id=message.email_thread_id
join email_connections connection on connection.company_id=thread.company_id
 and connection.email_connection_id=thread.email_connection_id
join project_textboxes textbox on textbox.company_id=message.company_id
  and textbox.project_id=$3::uuid and textbox.textbox_id=$4 and textbox.deleted_timestamp is null
where message.company_id=$1::uuid and message.email_message_id=$2::uuid
  and ((connection.connection_type='personal' and connection.personal_user_id=$5::uuid)
    or exists (
      select 1 from shared_inboxes inbox
      where inbox.company_id=thread.company_id
        and inbox.company_email_connection_id=thread.email_connection_id
        and mangorts_user_can_access_resource(
          $1::uuid,'shared_inbox',inbox.shared_inbox_id,$5::uuid,'edit')
    ))`,
		input.CompanyID, payload.EmailMessageID, input.ProjectID, payload.BlockID, actorUserID).Scan(&emailThreadID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.ProjectProjection{}, ErrInvalid
		}
		return domain.ProjectProjection{}, err
	}
	if _, err := tx.ExecContext(ctx, `insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,resource_type,resource_id,resource_textbox_id,created_timestamp
) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'project',$5::uuid,$6,$7)`,
		input.CompanyID, input.InformationID, emailThreadID, payload.EmailMessageID, input.ProjectID, payload.BlockID, attachedAt); err != nil {
		return domain.ProjectProjection{}, err
	}
	projection, found, err := postgresProjectEmailRelationshipProjectionTx(ctx, tx, input.CompanyID, input.ProjectID, input.InformationID)
	if err != nil {
		return domain.ProjectProjection{}, err
	}
	if !found {
		return domain.ProjectProjection{}, ErrNotFound
	}
	return projection, nil
}

func listPostgresProjectFinalProjections(ctx context.Context, db *sql.DB, companyID, projectID string) ([]domain.ProjectProjection, error) {
	textboxes, err := listPostgresProjectTextboxProjections(ctx, db, companyID, projectID)
	if err != nil {
		return nil, err
	}
	emails, err := listPostgresProjectEmailRelationshipProjections(ctx, db, companyID, projectID)
	if err != nil {
		return nil, err
	}
	chats, err := listPostgresProjectTextboxChatProjections(ctx, db, companyID, projectID)
	if err != nil {
		return nil, err
	}
	items := append(textboxes, emails...)
	items = append(items, chats...)
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].InformationID < items[j].InformationID
		}
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}
