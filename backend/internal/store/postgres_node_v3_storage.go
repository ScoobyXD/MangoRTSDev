package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

type postgresNodeV3Queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

type nodeAttachedEmailPayload struct {
	BlockID       string `json:"block_id"`
	MessageID     string `json:"message_id"`
	ThreadID      string `json:"thread_id"`
	EmailThreadID string `json:"email_thread_id"`
	SharedInboxID string `json:"shared_inbox_id"`
	AccountEmail  string `json:"account_email"`
}

type nodeTextboxChatPayload struct {
	BlockID            string          `json:"block_id"`
	ParentID           string          `json:"parent_id,omitempty"`
	SelectionSource    string          `json:"selection_source,omitempty"`
	SelectionBlockID   string          `json:"selection_block_id,omitempty"`
	SelectionMessageID string          `json:"selection_message_id,omitempty"`
	SelectionQuote     string          `json:"selection_quote,omitempty"`
	SelectionStart     *int            `json:"selection_start,omitempty"`
	SelectionEnd       *int            `json:"selection_end,omitempty"`
	AuthorID           string          `json:"author_id,omitempty"`
	AuthorName         string          `json:"author_name,omitempty"`
	Message            string          `json:"message"`
	CreatedTimestamp   string          `json:"created_timestamp,omitempty"`
	EditedTimestamp    string          `json:"edited_timestamp,omitempty"`
	Attachments        json.RawMessage `json:"attachments"`
	EntityLinks        json.RawMessage `json:"entity_links"`
	MentionedUserIDs   []string        `json:"mentioned_user_ids"`
	MentionedGroupIDs  []string        `json:"mentioned_group_ids"`
}

func postgresNodeV3Projections(ctx context.Context, db postgresNodeV3Queryer, companyID, nodeID string) ([]domain.NodeProjection, error) {
	items := make([]domain.NodeProjection, 0)
	rows, err := db.QueryContext(ctx, `
select company_id::text,node_id::text,textbox_id::text,body_json::text,revision,
       created_timestamp,updated_timestamp
from node_textboxes
where company_id=$1::uuid and node_id=$2::uuid and deleted_timestamp is null
order by display_order,textbox_id`, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var item domain.NodeProjection
		if err := rows.Scan(
			&item.CompanyID, &item.NodeID, &item.InformationID, &item.Information,
			&item.Revision, &item.CreatedTimestamp, &item.UpdatedTimestamp,
		); err != nil {
			rows.Close()
			return nil, err
		}
		item.Type = "Text box"
		items = append(items, item)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	rows, err = db.QueryContext(ctx, `
select chat.company_id::text,chat.node_id::text,chat.chat_id::text,chat.textbox_id::text,
       coalesce(chat.parent_chat_id::text,''),chat.selection_source,
       coalesce(chat.selection_textbox_id::text,''),
       coalesce(selection_message.provider_message_id,''),chat.selection_quote,
       chat.selection_start,chat.selection_end,coalesce(chat.author_user_id::text,''),
       chat.author_display_name,chat.message,chat.entity_links::text,
       array_to_json(chat.mentioned_user_ids)::text,
       array_to_json(chat.mentioned_group_ids)::text,
       chat.revision,chat.created_timestamp,chat.updated_timestamp,
       coalesce((
         select jsonb_agg(
           jsonb_build_object(
             'id',attachment.attachment_id::text,
             'attachment_id',attachment.attachment_id::text,
             'name',attachment.original_filename,
             'filename',attachment.original_filename,
             'type',attachment.mime_type,
             'mime_type',attachment.mime_type,
             'size',attachment.byte_size,
             'byte_size',attachment.byte_size
           )
           order by link.created_timestamp,link.resource_attachment_id
         )
         from resource_attachments link
         join attachments attachment
           on attachment.company_id=link.company_id
          and attachment.attachment_id=link.attachment_id
         where link.company_id=chat.company_id
           and link.resource_type='node_chat_message'
           and link.resource_id=chat.chat_id::text
           and link.deleted_timestamp is null
           and attachment.deleted_timestamp is null
       ),'[]'::jsonb)::text
from node_textbox_chats chat
left join email_messages selection_message
  on selection_message.company_id=chat.company_id
 and selection_message.email_message_id=chat.selection_email_message_id
where chat.company_id=$1::uuid
  and chat.node_id=$2::uuid
  and chat.deleted_timestamp is null
  and exists (
    select 1 from node_textboxes textbox
    where textbox.company_id=chat.company_id
      and textbox.node_id=chat.node_id
      and textbox.textbox_id=chat.textbox_id
      and textbox.deleted_timestamp is null
  )
order by chat.created_timestamp,chat.chat_id`, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var item domain.NodeProjection
		var payload nodeTextboxChatPayload
		var entityLinksJSON, mentionedUsersJSON, mentionedGroupsJSON, attachmentsJSON string
		var selectionStart, selectionEnd sql.NullInt64
		if err := rows.Scan(
			&item.CompanyID, &item.NodeID, &item.InformationID, &payload.BlockID,
			&payload.ParentID, &payload.SelectionSource, &payload.SelectionBlockID,
			&payload.SelectionMessageID, &payload.SelectionQuote, &selectionStart,
			&selectionEnd, &payload.AuthorID, &payload.AuthorName, &payload.Message,
			&entityLinksJSON, &mentionedUsersJSON, &mentionedGroupsJSON, &item.Revision,
			&item.CreatedTimestamp, &item.UpdatedTimestamp, &attachmentsJSON,
		); err != nil {
			rows.Close()
			return nil, err
		}
		if selectionStart.Valid {
			value := int(selectionStart.Int64)
			payload.SelectionStart = &value
		}
		if selectionEnd.Valid {
			value := int(selectionEnd.Int64)
			payload.SelectionEnd = &value
		}
		payload.CreatedTimestamp = item.CreatedTimestamp.UTC().Format(time.RFC3339Nano)
		if !item.UpdatedTimestamp.Equal(item.CreatedTimestamp) {
			payload.EditedTimestamp = item.UpdatedTimestamp.UTC().Format(time.RFC3339Nano)
		}
		payload.EntityLinks = json.RawMessage(entityLinksJSON)
		payload.Attachments = json.RawMessage(attachmentsJSON)
		if err := json.Unmarshal([]byte(mentionedUsersJSON), &payload.MentionedUserIDs); err != nil {
			rows.Close()
			return nil, err
		}
		if err := json.Unmarshal([]byte(mentionedGroupsJSON), &payload.MentionedGroupIDs); err != nil {
			rows.Close()
			return nil, err
		}
		encoded, err := json.Marshal(payload)
		if err != nil {
			rows.Close()
			return nil, err
		}
		item.Type = CommunicationsEmailCollaborationChatInformationType
		item.Information = string(encoded)
		items = append(items, item)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	rows, err = db.QueryContext(ctx, `
select relationship.company_id::text,relationship.resource_id::text,
       relationship.email_relationship_id::text,
       coalesce(relationship.resource_textbox_id,''),
       message.provider_message_id,thread.provider_thread_id,
       relationship.email_thread_id::text,coalesce(thread.shared_inbox_id::text,''),
       thread.mailbox_account_email,message.subject,message.snippet,
       message.sender_snapshot::text,
       coalesce(extract(epoch from message.message_timestamp)::bigint,0),
       relationship.created_timestamp
from email_relationships relationship
join email_messages message
  on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id
 and message.email_message_id=relationship.email_message_id
join email_threads thread
  on thread.company_id=relationship.company_id
 and thread.email_thread_id=relationship.email_thread_id
where relationship.company_id=$1::uuid
  and relationship.resource_type='node'
  and relationship.resource_id=$2::uuid
order by relationship.created_timestamp,relationship.email_relationship_id`, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var item domain.NodeProjection
		var blockID, providerMessageID, providerThreadID, emailThreadID, sharedInboxID, accountEmail string
		var subject, snippet, senderJSON string
		var messageDate int64
		if err := rows.Scan(
			&item.CompanyID, &item.NodeID, &item.InformationID, &blockID,
			&providerMessageID, &providerThreadID, &emailThreadID, &sharedInboxID,
			&accountEmail, &subject, &snippet, &senderJSON, &messageDate,
			&item.CreatedTimestamp,
		); err != nil {
			rows.Close()
			return nil, err
		}
		var senders []domain.EmailAddressSnapshot
		if err := json.Unmarshal([]byte(senderJSON), &senders); err != nil {
			rows.Close()
			return nil, err
		}
		from := ""
		if len(senders) > 0 {
			from = strings.TrimSpace(senders[0].Email)
			if name := strings.TrimSpace(senders[0].Name); name != "" {
				from = name
			}
		}
		payload := map[string]any{
			"block_id":           blockID,
			"collaboration_id":   item.InformationID,
			"message_id":         providerMessageID,
			"thread_id":          providerThreadID,
			"email_thread_id":    emailThreadID,
			"shared_inbox_id":    sharedInboxID,
			"account_email":      accountEmail,
			"subject":            subject,
			"snippet":            snippet,
			"from":               from,
			"date":               messageDate,
			"attached_timestamp": item.CreatedTimestamp.UTC().Format(time.RFC3339Nano),
		}
		encoded, err := json.Marshal(payload)
		if err != nil {
			rows.Close()
			return nil, err
		}
		item.Type = "Attached email"
		item.Information = string(encoded)
		item.Revision = 1
		item.UpdatedTimestamp = item.CreatedTimestamp
		items = append(items, item)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return items, nil
}

func postgresNodeV3ProjectionTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, informationID string) (domain.NodeProjection, bool, error) {
	items, err := postgresNodeV3Projections(ctx, tx, companyID, nodeID)
	if err != nil {
		return domain.NodeProjection{}, false, err
	}
	for _, item := range items {
		if item.InformationID == informationID {
			return item, true, nil
		}
	}
	return domain.NodeProjection{}, false, nil
}

func nodeTextboxBodyFromProjection(information string) (json.RawMessage, error) {
	information = strings.TrimSpace(information)
	if strings.HasPrefix(information, editorTextBlockProjectionPrefix) {
		var payload struct {
			Document json.RawMessage `json:"document"`
		}
		if err := json.Unmarshal([]byte(strings.TrimPrefix(information, editorTextBlockProjectionPrefix)), &payload); err != nil {
			return nil, ErrInvalid
		}
		if len(payload.Document) > 0 && payload.Document[0] == '"' {
			var document string
			if err := json.Unmarshal(payload.Document, &document); err != nil {
				return nil, ErrInvalid
			}
			information = document
		} else {
			information = string(payload.Document)
		}
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal([]byte(information), &body); err != nil {
		return nil, ErrInvalid
	}
	if _, ok := body["annotations"]; !ok {
		body["annotations"] = json.RawMessage("[]")
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	document, annotations, err := decodeEditorTextboxBody(encoded)
	if err != nil {
		return nil, ErrInvalid
	}
	return encodeEditorTextboxBody(document, annotations)
}

func postgresUUIDArrayLiteral(values []string) (string, error) {
	clean := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = cleanUUIDText(value)
		if value == "" {
			return "", ErrInvalid
		}
		if !seen[value] {
			seen[value] = true
			clean = append(clean, value)
		}
	}
	sort.Strings(clean)
	return "{" + strings.Join(clean, ",") + "}", nil
}

func postgresNodeChatSelectionMessageIDTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, providerMessageID string) (string, error) {
	providerMessageID = strings.TrimSpace(providerMessageID)
	if providerMessageID == "" {
		return "", nil
	}
	rows, err := tx.QueryContext(ctx, `
select distinct message.email_message_id::text
from email_messages message
join email_relationships relationship
  on relationship.company_id=message.company_id
 and relationship.email_thread_id=message.email_thread_id
where message.company_id=$1::uuid
  and message.provider_message_id=$3
  and relationship.resource_type='node'
  and relationship.resource_id=$2::uuid
order by message.email_message_id`, companyID, nodeID, providerMessageID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	ids := make([]string, 0, 2)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return "", err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if len(ids) != 1 {
		return "", ErrInvalid
	}
	return ids[0], nil
}

func postgresUpsertNodeV3ProjectionTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput) (domain.NodeProjection, error) {
	companyID := cleanUUIDText(input.CompanyID)
	nodeID := cleanUUIDText(input.NodeID)
	informationID := cleanUUIDText(input.InformationID)
	infoType := strings.TrimSpace(input.Type)
	if companyID == "" || nodeID == "" {
		return domain.NodeProjection{}, ErrInvalid
	}
	if informationID == "" {
		informationID = newUUIDv7String()
	}
	previous, previousFound, err := postgresNodeV3ProjectionTx(ctx, tx, companyID, nodeID, informationID)
	if err != nil {
		return domain.NodeProjection{}, err
	}
	if input.ExpectedRevision != nil {
		currentRevision := int64(0)
		if previousFound {
			currentRevision = previous.Revision
		}
		if *input.ExpectedRevision != currentRevision {
			var current *domain.NodeProjection
			if previousFound {
				copy := previous
				current = &copy
			}
			return domain.NodeProjection{}, &ProjectionRevisionConflictError{NodeCurrent: current}
		}
	}
	switch infoType {
	case "Text box":
		body, err := nodeTextboxBodyFromProjection(input.Information)
		if err != nil {
			return domain.NodeProjection{}, err
		}
		nextRevision := int64(1)
		if previousFound {
			nextRevision = previous.Revision + 1
		}
		if _, err := tx.ExecContext(ctx, `
insert into node_textboxes(
  company_id,node_id,textbox_id,body_json,revision,display_order,
  created_timestamp,updated_timestamp,deleted_timestamp
)
values(
  $1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5,
  coalesce((select max(display_order)+1 from node_textboxes where company_id=$1::uuid and node_id=$2::uuid),0),
  now(),now(),null
)
on conflict(company_id,node_id,textbox_id) do update
set body_json=excluded.body_json,
    revision=excluded.revision,
    deleted_timestamp=null,
    updated_timestamp=now()`, companyID, nodeID, informationID, body, nextRevision); err != nil {
			return domain.NodeProjection{}, mapEditorOwnerTextLimitError(err)
		}
		if strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "" {
			var previousPtr *domain.NodeProjection
			if previousFound {
				copy := previous
				previousPtr = &copy
			}
			if err := insertNodeContentChangesTx(ctx, tx, buildNodeContentChanges(
				companyID, nodeID, informationID, infoType, previousPtr, string(body),
				normalizeNodeContentChangeActor(cleanUUIDText(input.ActorUserID), input.ActorDisplayName),
				time.Now().UTC(),
			)); err != nil {
				return domain.NodeProjection{}, err
			}
		}
	case "Attached email":
		var payload nodeAttachedEmailPayload
		if err := json.Unmarshal([]byte(input.Information), &payload); err != nil {
			return domain.NodeProjection{}, ErrInvalid
		}
		providerMessageID := strings.TrimSpace(payload.MessageID)
		emailThreadID := cleanUUIDText(payload.EmailThreadID)
		providerThreadID := strings.TrimSpace(payload.ThreadID)
		sharedInboxID := cleanUUIDText(payload.SharedInboxID)
		accountEmail := strings.ToLower(strings.TrimSpace(payload.AccountEmail))
		textboxID := cleanUUIDText(payload.BlockID)
		if providerMessageID == "" || (strings.TrimSpace(payload.BlockID) != "" && textboxID == "") {
			return domain.NodeProjection{}, ErrInvalid
		}
		rows, err := tx.QueryContext(ctx, `
select message.email_thread_id::text,message.email_message_id::text
from email_messages message
join email_threads thread
  on thread.company_id=message.company_id
 and thread.email_thread_id=message.email_thread_id
where message.company_id=$1::uuid
  and message.provider_message_id=$2
  and (nullif($3,'') is null or message.email_thread_id=nullif($3,'')::uuid)
  and (nullif($4,'') is null or thread.provider_thread_id=$4)
  and (nullif($5,'') is null or thread.shared_inbox_id=nullif($5,'')::uuid)
  and (nullif($6,'') is null or lower(thread.mailbox_account_email)=lower($6))
order by message.email_thread_id,message.email_message_id`, companyID, providerMessageID, emailThreadID, providerThreadID, sharedInboxID, accountEmail)
		if err != nil {
			return domain.NodeProjection{}, err
		}
		matches := make([][2]string, 0, 2)
		for rows.Next() {
			var match [2]string
			if err := rows.Scan(&match[0], &match[1]); err != nil {
				rows.Close()
				return domain.NodeProjection{}, err
			}
			matches = append(matches, match)
		}
		if err := rows.Close(); err != nil {
			return domain.NodeProjection{}, err
		}
		if len(matches) != 1 {
			return domain.NodeProjection{}, ErrInvalid
		}
		if _, err := tx.ExecContext(ctx, `
insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,
  resource_type,resource_id,resource_textbox_id,created_timestamp
) values(
  $1::uuid,$2::uuid,$3::uuid,$4::uuid,'node',$5::uuid,nullif($6,''),now()
)
on conflict(company_id,email_relationship_id) do update
set email_thread_id=excluded.email_thread_id,
    email_message_id=excluded.email_message_id,
    resource_type=excluded.resource_type,
    resource_id=excluded.resource_id,
    resource_textbox_id=excluded.resource_textbox_id`,
			companyID, informationID, matches[0][0], matches[0][1], nodeID, textboxID,
		); err != nil {
			return domain.NodeProjection{}, err
		}
	case CommunicationsEmailCollaborationChatInformationType:
		var payload nodeTextboxChatPayload
		if err := json.Unmarshal([]byte(input.Information), &payload); err != nil {
			return domain.NodeProjection{}, ErrInvalid
		}
		textboxID := cleanUUIDText(payload.BlockID)
		if textboxID == "" {
			return domain.NodeProjection{}, ErrInvalid
		}
		parentID := cleanUUIDText(payload.ParentID)
		selectionSource := strings.TrimSpace(payload.SelectionSource)
		if selectionSource == "" {
			selectionSource = "text"
		}
		if selectionSource != "text" && selectionSource != "email" {
			return domain.NodeProjection{}, ErrInvalid
		}
		selectionTextboxID := cleanUUIDText(payload.SelectionBlockID)
		selectionMessageID, err := postgresNodeChatSelectionMessageIDTx(ctx, tx, companyID, nodeID, payload.SelectionMessageID)
		if err != nil {
			return domain.NodeProjection{}, err
		}
		if selectionSource == "text" {
			selectionMessageID = ""
		} else {
			selectionTextboxID = ""
		}
		entityLinks := payload.EntityLinks
		if len(entityLinks) == 0 {
			entityLinks = json.RawMessage("[]")
		}
		var entityLinkValue any
		if json.Unmarshal(entityLinks, &entityLinkValue) != nil {
			return domain.NodeProjection{}, ErrInvalid
		}
		if _, ok := entityLinkValue.([]any); !ok {
			return domain.NodeProjection{}, ErrInvalid
		}
		mentionedUsers, err := postgresUUIDArrayLiteral(payload.MentionedUserIDs)
		if err != nil {
			return domain.NodeProjection{}, err
		}
		mentionedGroups, err := postgresUUIDArrayLiteral(payload.MentionedGroupIDs)
		if err != nil {
			return domain.NodeProjection{}, err
		}
		authorID := cleanUUIDText(payload.AuthorID)
		createdAt := time.Now().UTC()
		if parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(payload.CreatedTimestamp)); err == nil {
			createdAt = parsed.UTC()
		}
		nextRevision := int64(1)
		if previousFound {
			nextRevision = previous.Revision + 1
		}
		if _, err := tx.ExecContext(ctx, `
insert into node_textbox_chats(
  company_id,chat_id,node_id,textbox_id,parent_chat_id,selection_source,
  selection_textbox_id,selection_email_message_id,selection_quote,
  selection_start,selection_end,author_user_id,author_display_name,message,
  entity_links,mentioned_user_ids,mentioned_group_ids,revision,
  created_timestamp,updated_timestamp,deleted_timestamp
) values(
  $1::uuid,$2::uuid,$3::uuid,$4::uuid,nullif($5,'')::uuid,$6,
  nullif($7,'')::uuid,nullif($8,'')::uuid,$9,$10,$11,
  nullif($12,'')::uuid,$13,$14,$15::jsonb,$16::uuid[],$17::uuid[],$18,
  $19,now(),null
)
on conflict(company_id,chat_id) do update
set parent_chat_id=excluded.parent_chat_id,
    selection_source=excluded.selection_source,
    selection_textbox_id=excluded.selection_textbox_id,
    selection_email_message_id=excluded.selection_email_message_id,
    selection_quote=excluded.selection_quote,
    selection_start=excluded.selection_start,
    selection_end=excluded.selection_end,
    author_user_id=excluded.author_user_id,
    author_display_name=excluded.author_display_name,
    message=excluded.message,
    entity_links=excluded.entity_links,
    mentioned_user_ids=excluded.mentioned_user_ids,
    mentioned_group_ids=excluded.mentioned_group_ids,
    revision=excluded.revision,
    updated_timestamp=now(),
    deleted_timestamp=null`,
			companyID, informationID, nodeID, textboxID, parentID, selectionSource,
			selectionTextboxID, selectionMessageID, strings.TrimSpace(payload.SelectionQuote),
			payload.SelectionStart, payload.SelectionEnd, authorID,
			strings.TrimSpace(payload.AuthorName), strings.TrimSpace(payload.Message),
			entityLinks, mentionedUsers, mentionedGroups, nextRevision, createdAt,
		); err != nil {
			return domain.NodeProjection{}, err
		}
	default:
		return domain.NodeProjection{}, ErrInvalid
	}
	item, found, err := postgresNodeV3ProjectionTx(ctx, tx, companyID, nodeID, informationID)
	if err != nil {
		return domain.NodeProjection{}, err
	}
	if !found {
		return domain.NodeProjection{}, ErrNotFound
	}
	return item, nil
}

func postgresDeleteNodeV3ProjectionTx(ctx context.Context, tx *sql.Tx, input NodeProjectionDeleteInput) (domain.NodeProjection, error) {
	companyID := cleanUUIDText(input.CompanyID)
	nodeID := cleanUUIDText(input.NodeID)
	informationID := cleanUUIDText(input.InformationID)
	if companyID == "" || nodeID == "" || informationID == "" {
		return domain.NodeProjection{}, ErrInvalid
	}
	previous, found, err := postgresNodeV3ProjectionTx(ctx, tx, companyID, nodeID, informationID)
	if err != nil {
		return domain.NodeProjection{}, err
	}
	if !found {
		return domain.NodeProjection{}, ErrNotFound
	}
	if input.ExpectedRevision != nil && *input.ExpectedRevision != previous.Revision {
		copy := previous
		return domain.NodeProjection{}, &ProjectionRevisionConflictError{NodeCurrent: &copy}
	}
	switch previous.Type {
	case "Text box":
		if strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "" {
			copy := previous
			if err := insertNodeContentChangesTx(ctx, tx, buildNodeContentChanges(
				companyID, nodeID, informationID, previous.Type, &copy, "",
				normalizeNodeContentChangeActor(cleanUUIDText(input.ActorUserID), input.ActorDisplayName),
				time.Now().UTC(),
			)); err != nil {
				return domain.NodeProjection{}, err
			}
		}
		if _, err := tx.ExecContext(ctx, `
update node_textboxes
set revision=revision+1,deleted_timestamp=now(),updated_timestamp=now()
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid
  and deleted_timestamp is null`, companyID, nodeID, informationID); err != nil {
			return domain.NodeProjection{}, err
		}
		if _, err := tx.ExecContext(ctx, `
update node_textbox_chats
set revision=revision+1,deleted_timestamp=now(),updated_timestamp=now()
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid
  and deleted_timestamp is null`, companyID, nodeID, informationID); err != nil {
			return domain.NodeProjection{}, err
		}
	case CommunicationsEmailCollaborationChatInformationType:
		if _, err := tx.ExecContext(ctx, `
update node_textbox_chats
set revision=revision+1,deleted_timestamp=now(),updated_timestamp=now()
where company_id=$1::uuid and node_id=$2::uuid and chat_id=$3::uuid
  and deleted_timestamp is null`, companyID, nodeID, informationID); err != nil {
			return domain.NodeProjection{}, err
		}
	case "Attached email":
		if _, err := tx.ExecContext(ctx, `
delete from email_relationships
where company_id=$1::uuid
  and email_relationship_id=$3::uuid
  and resource_type='node'
  and resource_id=$2::uuid`, companyID, nodeID, informationID); err != nil {
			return domain.NodeProjection{}, err
		}
	default:
		return domain.NodeProjection{}, ErrInvalid
	}
	return previous, nil
}

func nodeInformationFromProjection(item domain.NodeProjection) domain.NodeInformation {
	return domain.NodeInformation{
		CompanyID: item.CompanyID, InformationID: item.InformationID, NodeID: item.NodeID,
		Type: item.Type, Information: item.Information,
		CreatedTimestamp: item.CreatedTimestamp, UpdatedTimestamp: item.UpdatedTimestamp,
	}
}
