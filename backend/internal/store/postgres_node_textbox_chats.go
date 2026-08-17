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

type nodeTextboxChatPayload struct {
	BlockID                string          `json:"block_id"`
	EnsureEmailTextboxLink bool            `json:"ensure_email_textbox_link_on_send"`
	EmailTextboxColor      string          `json:"email_textbox_color_on_send"`
	ParentID               string          `json:"parent_id"`
	SelectionSource        string          `json:"selection_source"`
	SelectionBlockID       string          `json:"selection_block_id"`
	SelectionMessageID     string          `json:"selection_message_id"`
	SelectionQuote         string          `json:"selection_quote"`
	SelectionStart         *int            `json:"selection_start"`
	SelectionEnd           *int            `json:"selection_end"`
	AuthorID               string          `json:"author_id"`
	AuthorName             string          `json:"author_name"`
	Message                string          `json:"message"`
	CreatedTimestamp       string          `json:"created_timestamp"`
	EditedTimestamp        string          `json:"edited_timestamp"`
	Attachments            json.RawMessage `json:"attachments"`
	EntityLinks            json.RawMessage `json:"entity_links"`
	MentionedUserIDs       json.RawMessage `json:"mentioned_user_ids"`
	MentionedGroupIDs      json.RawMessage `json:"mentioned_group_ids"`
}

func ensurePostgresEmailSelectionTextboxLinkForFirstChatTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput, payload nodeTextboxChatPayload) error {
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
	if textboxID == "" || selectionTextboxID != textboxID ||
		strings.TrimSpace(payload.ParentID) != "" || strings.ToLower(strings.TrimSpace(payload.SelectionSource)) != "email" ||
		strings.TrimSpace(payload.SelectionQuote) == "" || !validNodeTextboxColor(textboxColor) {
		return ErrInvalid
	}
	var textboxExists, nodeWideEmailExists bool
	if err := tx.QueryRowContext(ctx, `select exists(
  select 1 from node_textboxes
  where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid
), exists(
  select 1 from email_relationships
  where company_id=$1::uuid
    and email_message_id=$4::uuid
    and resource_type='node'
    and resource_id=$2::uuid
    and resource_textbox_id is null
)`, input.CompanyID, input.NodeID, textboxID, emailMessageID).Scan(&textboxExists, &nodeWideEmailExists); err != nil {
		return err
	}
	if !nodeWideEmailExists {
		return ErrEmailMessageNotAttachedToNode
	}
	if !textboxExists {
		ref := EditorJSONDocumentRef{
			CompanyID: input.CompanyID, ResourceType: EntityTypeNode,
			ResourceID: input.NodeID, DocumentID: textboxID,
		}
		storage, ok := postgresEditorTextboxStorageFor(ref)
		if !ok {
			return ErrInvalid
		}
		if err := insertEmptyPostgresEditorTextboxTx(ctx, tx, storage, ref); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `update node_textboxes
set color=coalesce(color,$4),updated_timestamp=case when color is null then now() else updated_timestamp end
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and deleted_timestamp is null`,
		input.CompanyID, input.NodeID, textboxID, textboxColor); err != nil {
		return err
	}
	attachedPayload, err := json.Marshal(nodeAttachedEmailPayload{
		BlockID: textboxID, EmailMessageID: emailMessageID,
		AttachedTimestamp: time.Now().UTC().Format(time.RFC3339Nano), LinkScope: "message",
	})
	if err != nil {
		return err
	}
	relationshipID := newUUIDv7String()
	_, err = addPostgresNodeEmailRelationshipTx(ctx, tx, NodeInformationInput{
		CompanyID: input.CompanyID, NodeID: input.NodeID, InformationID: relationshipID,
		Type: "Attached email", Information: string(attachedPayload), ActorUserID: input.ActorUserID,
	}, relationshipID)
	return err
}

type normalizedNodeTextboxChat struct {
	TextboxID               string
	ParentChatID            string
	SelectionSource         string
	SelectionTextboxID      string
	SelectionEmailMessageID string
	SelectionQuote          string
	SelectionStart          *int
	SelectionEnd            *int
	AuthorUserID            string
	AuthorDisplayName       string
	Message                 string
	CreatedTimestamp        time.Time
	EditedTimestamp         *time.Time
	AttachmentIDsJSON       string
	EntityLinksJSON         string
	MentionedUserIDsJSON    string
	MentionedGroupIDsJSON   string
}

func isNodeTextboxChatType(value string) bool {
	return strings.EqualFold(strings.TrimSpace(value), CommunicationsEmailCollaborationChatInformationType)
}

func normalizeJSONArray(value json.RawMessage) (string, bool, error) {
	if len(value) == 0 || string(value) == "null" {
		return "[]", false, nil
	}
	var items []json.RawMessage
	if err := json.Unmarshal(value, &items); err != nil {
		return "", false, ErrInvalid
	}
	encoded, err := json.Marshal(items)
	if err != nil {
		return "", false, err
	}
	return string(encoded), len(items) > 0, nil
}

func normalizeChatAttachmentIDs(value json.RawMessage) (string, bool, error) {
	if len(value) == 0 || string(value) == "null" {
		return "[]", false, nil
	}
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(value, &items); err != nil {
		return "", false, ErrInvalid
	}
	ids := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		var id string
		for _, key := range []string{"attachment_id", "attachmentID", "id"} {
			if raw, ok := item[key]; ok && json.Unmarshal(raw, &id) == nil && strings.TrimSpace(id) != "" {
				break
			}
		}
		id = cleanUUIDText(id)
		if id == "" {
			return "", false, ErrInvalid
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	encoded, err := json.Marshal(ids)
	if err != nil {
		return "", false, err
	}
	return string(encoded), len(ids) > 0, nil
}
func normalizeChatUUIDArray(value json.RawMessage) (string, error) {
	if len(value) == 0 || string(value) == "null" {
		return "[]", nil
	}
	var ids []string
	if err := json.Unmarshal(value, &ids); err != nil {
		return "", ErrInvalid
	}
	cleaned := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		id = cleanUUIDText(id)
		if id == "" {
			return "", ErrInvalid
		}
		if !seen[id] {
			seen[id] = true
			cleaned = append(cleaned, id)
		}
	}
	encoded, err := json.Marshal(cleaned)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func parseChatTimestamp(value string, required bool) (time.Time, *time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		if required {
			return time.Now().UTC(), nil, nil
		}
		return time.Time{}, nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, nil, ErrInvalid
	}
	parsed = parsed.UTC()
	return parsed, &parsed, nil
}

func normalizeNodeTextboxChatPayload(ctx context.Context, tx *sql.Tx, companyID string, input NodeInformationInput) (normalizedNodeTextboxChat, error) {
	var payload nodeTextboxChatPayload
	if err := json.Unmarshal([]byte(input.Information), &payload); err != nil {
		return normalizedNodeTextboxChat{}, ErrInvalid
	}
	rawParentID := strings.TrimSpace(payload.ParentID)
	rawSelectionBlockID := strings.TrimSpace(payload.SelectionBlockID)
	payload.BlockID = cleanUUIDText(payload.BlockID)
	payload.ParentID = cleanUUIDText(payload.ParentID)
	payload.SelectionBlockID = cleanUUIDText(payload.SelectionBlockID)
	payload.AuthorID = cleanUUIDText(payload.AuthorID)
	if payload.BlockID == "" || payload.AuthorID == "" {
		return normalizedNodeTextboxChat{}, ErrInvalid
	}
	if rawParentID != "" && payload.ParentID == "" {
		return normalizedNodeTextboxChat{}, ErrInvalid
	}
	if rawSelectionBlockID != "" && payload.SelectionBlockID == "" {
		return normalizedNodeTextboxChat{}, ErrInvalid
	}
	selectionSource := strings.ToLower(strings.TrimSpace(payload.SelectionSource))
	if selectionSource == "" {
		selectionSource = "text"
	}
	if selectionSource != "text" && selectionSource != "email" {
		return normalizedNodeTextboxChat{}, ErrInvalid
	}
	selectionMessageID := strings.TrimSpace(payload.SelectionMessageID)
	selectionEmailMessageID := ""
	if selectionSource == "text" {
		if selectionMessageID != "" {
			return normalizedNodeTextboxChat{}, ErrInvalid
		}
	} else {
		selectionEmailMessageID = cleanUUIDText(selectionMessageID)
		if selectionEmailMessageID == "" {
			return normalizedNodeTextboxChat{}, ErrEmailMessageIdentityInvalid
		}
		if cleanUUIDText(input.ActorUserID) == "" {
			return normalizedNodeTextboxChat{}, ErrInvalid
		}
		var canSelect, linkedToAnotherTextbox bool
		if err := tx.QueryRowContext(ctx, `select exists(
  select 1
  from email_relationships relationship
  where relationship.company_id=$1::uuid
    and relationship.email_message_id=$2::uuid
    and relationship.resource_type='node'
    and relationship.resource_id=$3::uuid
    and relationship.resource_textbox_id=$4::text
), exists(
  select 1
  from email_relationships relationship
  where relationship.company_id=$1::uuid
    and relationship.email_message_id=$2::uuid
    and relationship.resource_type='node'
    and relationship.resource_id=$3::uuid
    and relationship.resource_textbox_id is not null
    and relationship.resource_textbox_id<>$4::text
)`, companyID, selectionEmailMessageID, input.NodeID, payload.BlockID).Scan(&canSelect, &linkedToAnotherTextbox); err != nil {
			return normalizedNodeTextboxChat{}, err
		}
		if !canSelect {
			if linkedToAnotherTextbox {
				return normalizedNodeTextboxChat{}, ErrEmailMessageTextboxConflict
			}
			return normalizedNodeTextboxChat{}, ErrEmailMessageNotAttachedToNode
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
	if err != nil {
		return normalizedNodeTextboxChat{}, err
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

const postgresNodeTextboxChatProjectionSelect = `
select chat.company_id::text,
       chat.node_id::text,
       chat.chat_id::text,
       'Text block chat',
       jsonb_build_object(
         'block_id', chat.textbox_id::text,
         'parent_id', coalesce(chat.parent_chat_id::text, ''),
         'selection_source', chat.selection_source,
         'selection_block_id', coalesce(chat.selection_textbox_id::text, ''),
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
             )
             order by link.created_timestamp, attachment.attachment_id
           )
           from attachment_relationships link
           join attachments attachment
             on attachment.company_id=link.company_id
            and attachment.attachment_id=link.attachment_id
            and attachment.deleted_timestamp is null
           where link.company_id=chat.company_id
             and link.resource_type='node_chat_message'
             and link.resource_id=chat.chat_id::text
             and link.relationship_kind='chat_attachment'
             and link.deleted_timestamp is null
         ), '[]'::jsonb),
         'entity_links', chat.entity_links,
         'mentioned_user_ids', to_jsonb(chat.mentioned_user_ids),
         'mentioned_group_ids', to_jsonb(chat.mentioned_group_ids)
       )::text,
       chat.deleted_timestamp is not null,
       chat.revision,
       chat.created_timestamp,
       chat.updated_timestamp
from node_textbox_chats chat`

func scanNodeTextboxChatProjection(row interface{ Scan(...any) error }) (domain.NodeProjection, error) {
	var item domain.NodeProjection
	err := row.Scan(&item.CompanyID, &item.NodeID, &item.InformationID, &item.Type, &item.Information,
		&item.IsDeleted, &item.Revision, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	return item, err
}

func postgresNodeTextboxChatProjectionTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, chatID string) (domain.NodeProjection, bool, error) {
	item, err := scanNodeTextboxChatProjection(tx.QueryRowContext(ctx, postgresNodeTextboxChatProjectionSelect+`
where chat.company_id=$1::uuid and chat.node_id=$2::uuid and chat.chat_id=$3::uuid`, companyID, nodeID, chatID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NodeProjection{}, false, nil
	}
	return item, err == nil, err
}

func listPostgresNodeTextboxChatProjections(ctx context.Context, db *sql.DB, companyID, nodeID string) ([]domain.NodeProjection, error) {
	rows, err := db.QueryContext(ctx, postgresNodeTextboxChatProjectionSelect+`
where chat.company_id=$1::uuid and chat.node_id=$2::uuid and chat.deleted_timestamp is null
order by chat.created_timestamp, chat.chat_id`, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.NodeProjection, 0)
	for rows.Next() {
		item, err := scanNodeTextboxChatProjection(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func syncPostgresNodeTextboxChatAttachmentsTx(ctx context.Context, tx *sql.Tx, companyID, chatID string, chat normalizedNodeTextboxChat) error {
	var wantedCount, foundCount int
	if err := tx.QueryRowContext(ctx, `
with wanted as (
  select value::uuid as attachment_id
  from jsonb_array_elements_text($2::jsonb)
)
select jsonb_array_length($2::jsonb), count(*)
from wanted
join attachments attachment
  on attachment.company_id=$1::uuid
 and attachment.attachment_id=wanted.attachment_id
 and attachment.deleted_timestamp is null`, companyID, chat.AttachmentIDsJSON).Scan(&wantedCount, &foundCount); err != nil {
		return err
	}
	if wantedCount != foundCount {
		return ErrInvalid
	}
	if _, err := retireAttachmentRelationshipsTx(ctx, tx, companyID, "node_chat_message", chatID, "", AttachmentRelationshipChatAttachment, chat.AttachmentIDsJSON); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
insert into attachment_relationships(
  attachment_relationship_id,company_id,resource_type,resource_id,attachment_id,information_id,
  message_id,editor_surface,relationship_kind,created_by_user_id,created_timestamp
)
select
  gen_random_uuid(),$1::uuid,'node_chat_message',$2,wanted.attachment_id,$4::uuid,
  '','node_textbox_chat','chat_attachment',$5::uuid,clock_timestamp()
from (
  select value::uuid as attachment_id
  from jsonb_array_elements_text($3::jsonb)
) wanted
where not exists (
  select 1
  from attachment_relationships link
  where link.company_id=$1::uuid
    and link.resource_type='node_chat_message'
    and link.resource_id=$2
    and link.attachment_id=wanted.attachment_id
    and link.relationship_kind='chat_attachment'
    and link.deleted_timestamp is null
)`, companyID, chatID, chat.AttachmentIDsJSON, chat.TextboxID, chat.AuthorUserID)
	return err
}

func upsertPostgresNodeTextboxChatTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput, chatID string) (domain.NodeProjection, bool, error) {
	chatID = cleanUUIDText(chatID)
	if chatID == "" {
		return domain.NodeProjection{}, false, ErrInvalid
	}
	var rawPayload nodeTextboxChatPayload
	if err := json.Unmarshal([]byte(input.Information), &rawPayload); err != nil {
		return domain.NodeProjection{}, false, ErrInvalid
	}
	if err := ensurePostgresEmailSelectionTextboxLinkForFirstChatTx(ctx, tx, input, rawPayload); err != nil {
		return domain.NodeProjection{}, false, err
	}
	chat, err := normalizeNodeTextboxChatPayload(ctx, tx, input.CompanyID, input)
	if err != nil {
		return domain.NodeProjection{}, false, err
	}
	var textboxExists bool
	if err := tx.QueryRowContext(ctx, `select exists(
  select 1 from node_textboxes
  where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and deleted_timestamp is null
)`, input.CompanyID, input.NodeID, chat.TextboxID).Scan(&textboxExists); err != nil {
		return domain.NodeProjection{}, false, err
	}
	if !textboxExists {
		return domain.NodeProjection{}, false, ErrNotFound
	}
	previous, existed, err := postgresNodeTextboxChatProjectionTx(ctx, tx, input.CompanyID, input.NodeID, chatID)
	if err != nil {
		return domain.NodeProjection{}, false, err
	}
	if existed {
		if input.ExpectedRevision != nil && *input.ExpectedRevision != previous.Revision {
			current := previous
			return domain.NodeProjection{}, true, &ProjectionRevisionConflictError{NodeCurrent: &current}
		}
		result, err := tx.ExecContext(ctx, `
update node_textbox_chats
set message=$4,
    entity_links=$5::jsonb,
    mentioned_user_ids=array(select jsonb_array_elements_text($6::jsonb)::uuid),
    mentioned_group_ids=array(select jsonb_array_elements_text($7::jsonb)::uuid),
    edited_timestamp=$8,
    revision=revision+1,
    updated_timestamp=now()
where company_id=$1::uuid and node_id=$2::uuid and chat_id=$3::uuid and textbox_id=$9::uuid`,
			input.CompanyID, input.NodeID, chatID, chat.Message, chat.EntityLinksJSON,
			chat.MentionedUserIDsJSON, chat.MentionedGroupIDsJSON, chat.EditedTimestamp, chat.TextboxID)
		if err != nil {
			return domain.NodeProjection{}, true, err
		}
		affected, err := result.RowsAffected()
		if err != nil || affected != 1 {
			if err != nil {
				return domain.NodeProjection{}, true, err
			}
			return domain.NodeProjection{}, true, ErrInvalid
		}
	} else {
		if input.ExpectedRevision != nil && *input.ExpectedRevision != 0 {
			return domain.NodeProjection{}, false, &ProjectionRevisionConflictError{}
		}
		_, err = tx.ExecContext(ctx, `
insert into node_textbox_chats(
  company_id,chat_id,node_id,textbox_id,parent_chat_id,selection_source,selection_textbox_id,
  selection_email_message_id,selection_quote,selection_start,selection_end,author_user_id,
  author_display_name,message,entity_links,mentioned_user_ids,mentioned_group_ids,
  revision,created_timestamp,edited_timestamp,updated_timestamp
) values (
  $1::uuid,$2::uuid,$3::uuid,$4::uuid,nullif($5,'')::uuid,$6,nullif($7,'')::uuid,
  nullif($8,'')::uuid,$9,$10,$11,$12::uuid,$13,$14,$15::jsonb,
  array(select jsonb_array_elements_text($16::jsonb)::uuid),
  array(select jsonb_array_elements_text($17::jsonb)::uuid),1,$18,$19,greatest(clock_timestamp(),$18)
)`, input.CompanyID, chatID, input.NodeID, chat.TextboxID, chat.ParentChatID, chat.SelectionSource,
			chat.SelectionTextboxID, chat.SelectionEmailMessageID, chat.SelectionQuote, chat.SelectionStart,
			chat.SelectionEnd, chat.AuthorUserID, chat.AuthorDisplayName, chat.Message,
			chat.EntityLinksJSON, chat.MentionedUserIDsJSON, chat.MentionedGroupIDsJSON,
			chat.CreatedTimestamp, chat.EditedTimestamp)
		if err != nil {
			return domain.NodeProjection{}, false, err
		}
	}
	if err := syncPostgresNodeTextboxChatAttachmentsTx(ctx, tx, input.CompanyID, chatID, chat); err != nil {
		return domain.NodeProjection{}, existed, err
	}
	projection, found, err := postgresNodeTextboxChatProjectionTx(ctx, tx, input.CompanyID, input.NodeID, chatID)
	if err != nil {
		return domain.NodeProjection{}, existed, err
	}
	if !found {
		return domain.NodeProjection{}, existed, ErrNotFound
	}
	return projection, existed, nil
}

func deletePostgresNodeTextboxChatTx(ctx context.Context, tx *sql.Tx, input NodeProjectionDeleteInput) (domain.NodeProjection, bool, error) {
	previous, found, err := postgresNodeTextboxChatProjectionTx(ctx, tx, input.CompanyID, input.NodeID, input.InformationID)
	if err != nil || !found {
		return previous, found, err
	}
	if input.ExpectedRevision != nil && *input.ExpectedRevision != previous.Revision {
		current := previous
		return domain.NodeProjection{}, true, &ProjectionRevisionConflictError{NodeCurrent: &current}
	}
	if err := retireNodeTextboxChatTreeRelationshipsTx(ctx, tx, input.CompanyID, input.NodeID, input.InformationID); err != nil {
		return domain.NodeProjection{}, true, err
	}
	result, err := tx.ExecContext(ctx, `delete from node_textbox_chats
where company_id=$1::uuid and node_id=$2::uuid and chat_id=$3::uuid`, input.CompanyID, input.NodeID, input.InformationID)
	if err != nil {
		return domain.NodeProjection{}, true, err
	}
	affected, err := result.RowsAffected()
	return previous, affected > 0, err
}
