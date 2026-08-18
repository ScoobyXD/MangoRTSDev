package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type nodeAttachedEmailPayload struct {
	BlockID           string `json:"block_id"`
	EmailMessageID    string `json:"email_message_id"`
	TextboxColor      string `json:"textbox_color"`
	AttachedTimestamp string `json:"attached_timestamp"`
	LinkScope         string `json:"link_scope"`
}

func nodeTextboxFromProjectionInformation(information string) (json.RawMessage, string, string, error) {
	value := strings.TrimPrefix(strings.TrimSpace(information), editorTextBlockProjectionPrefix)
	var payload struct {
		Document json.RawMessage `json:"document"`
		Title    string          `json:"title"`
		Color    string          `json:"color"`
	}
	if json.Unmarshal([]byte(value), &payload) != nil || len(payload.Document) == 0 {
		return nil, "", "", ErrInvalid
	}
	payload.Title = strings.TrimSpace(payload.Title)
	payload.Color = strings.ToUpper(strings.TrimSpace(payload.Color))
	if len(payload.Title) > 500 || (payload.Color != "" && !validNodeTextboxColor(payload.Color)) {
		return nil, "", "", ErrInvalid
	}
	document := payload.Document
	if len(document) > 0 && document[0] == '"' {
		var encoded string
		if json.Unmarshal(document, &encoded) != nil {
			return nil, "", "", ErrInvalid
		}
		if strings.TrimSpace(encoded) == "" {
			return emptyEditorTextboxBody(), payload.Title, payload.Color, nil
		}
		document = json.RawMessage(encoded)
	}
	canonical, err := validateMangoTiptapJSONForCommit(document)
	if err != nil {
		return nil, "", "", err
	}
	body, err := encodeEditorTextboxBody(canonical, nil)
	return body, payload.Title, payload.Color, err
}

func nodeProjectionAsInformation(item domain.NodeProjection) domain.NodeInformation {
	return domain.NodeInformation{
		CompanyID: item.CompanyID, NodeID: item.NodeID, InformationID: item.InformationID,
		Type: item.Type, Information: item.Information,
		CreatedTimestamp: item.CreatedTimestamp, UpdatedTimestamp: item.UpdatedTimestamp,
	}
}

const postgresNodeTextboxProjectionSelectFormat = `
select textbox.company_id::text, textbox.node_id::text, textbox.textbox_id::text, 'Text box',
	       $3 || jsonb_build_object(
	         'title', textbox.title,
	         'color', coalesce(textbox.color, ''),
	         'document', %s,
	         'email_message_ids', coalesce(linked_email.email_message_ids, '[]'::jsonb),
         'attachments', coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', attachment.attachment_id::text, 'attachment_id', attachment.attachment_id::text,
             'name', attachment.original_filename, 'filename', attachment.original_filename,
             'type', attachment.mime_type, 'mime_type', attachment.mime_type,
             'size', attachment.byte_size, 'byte_size', attachment.byte_size
           ) order by link.created_timestamp, attachment.attachment_id)
           from attachment_relationships link
           join attachments attachment on attachment.company_id=link.company_id
            and attachment.attachment_id=link.attachment_id and attachment.deleted_timestamp is null
           where link.company_id=textbox.company_id and link.resource_type='node'
             and link.resource_id=textbox.node_id::text and link.information_id=textbox.textbox_id
             and link.relationship_kind in ('file_attachment','inline_image','migrated_inline_image')
             and link.deleted_timestamp is null
         ), '[]'::jsonb)
       )::text,
       false, textbox.revision, textbox.created_timestamp, textbox.updated_timestamp
from node_textboxes textbox
left join lateral (
  select jsonb_agg(relationship.email_message_id::text order by message.message_timestamp nulls last,message.email_message_id) as email_message_ids
  from email_relationships relationship
  join email_messages message
    on message.company_id=relationship.company_id
   and message.email_message_id=relationship.email_message_id
  where relationship.company_id=textbox.company_id
    and relationship.resource_type='node'
    and relationship.resource_id=textbox.node_id
    and relationship.resource_textbox_id=textbox.textbox_id::text
) linked_email on true`

func postgresNodeTextboxProjectionSelect(includeDocument bool) string {
	documentExpression := `''`
	if includeDocument {
		documentExpression = `(textbox.body_json->'document')::text`
	}
	return fmt.Sprintf(postgresNodeTextboxProjectionSelectFormat, documentExpression)
}

const postgresNodeEmailRelationshipProjectionSelect = `
select relationship.company_id::text, relationship.resource_id::text,
       relationship.email_relationship_id::text, 'Attached email',
       jsonb_build_object(
         'block_id', coalesce(relationship.resource_textbox_id, ''),
         'collaboration_id', relationship.email_relationship_id::text,
         'message_id', message.provider_message_id, 'email_message_id', message.email_message_id::text,
         'thread_id', thread.provider_thread_id, 'email_thread_id', thread.email_thread_id::text,
         'shared_inbox_id', coalesce(inbox.shared_inbox_id::text, ''),
         'account_email', connection.account_email, 'created_from_email', true,
         'subject', message.subject, 'snippet', message.snippet,
         'from', coalesce(nullif(message.sender_snapshot->0->>'name', ''), message.sender_snapshot->0->>'email', ''),
         'date', case when message.message_timestamp is null then null else floor(extract(epoch from message.message_timestamp))::bigint end,
         'attached_timestamp', relationship.created_timestamp
       )::text,
       false, 1::bigint, relationship.created_timestamp, relationship.created_timestamp
from email_relationships relationship
join email_messages message on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id and message.email_message_id=relationship.email_message_id
join email_threads thread on thread.company_id=message.company_id and thread.email_thread_id=message.email_thread_id
join email_connections connection on connection.company_id=thread.company_id
 and connection.email_connection_id=thread.email_connection_id
left join lateral (
 select shared_inbox_id from shared_inboxes
 where company_id=thread.company_id and company_email_connection_id=thread.email_connection_id
 order by shared_inbox_id limit 1
) inbox on true`

func scanNodeProjection(row interface{ Scan(dest ...any) error }) (domain.NodeProjection, error) {
	var item domain.NodeProjection
	err := row.Scan(&item.CompanyID, &item.NodeID, &item.InformationID, &item.Type, &item.Information,
		&item.IsDeleted, &item.Revision, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	return item, err
}

func postgresNodeFinalProjectionTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, informationID string) (domain.NodeProjection, bool, error) {
	item, err := scanNodeProjection(tx.QueryRowContext(ctx, postgresNodeTextboxProjectionSelect(true)+`
where textbox.company_id=$1::uuid and textbox.node_id=$2::uuid and textbox.textbox_id=$4::uuid
  and textbox.deleted_timestamp is null`, companyID, nodeID, editorTextBlockProjectionPrefix, informationID))
	if errors.Is(err, sql.ErrNoRows) {
		item, err = scanNodeProjection(tx.QueryRowContext(ctx, postgresNodeEmailRelationshipProjectionSelect+`
where relationship.company_id=$1::uuid and relationship.resource_type='node'
  and relationship.resource_id=$2::uuid and relationship.email_relationship_id=$3::uuid`, companyID, nodeID, informationID))
	}
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NodeProjection{}, false, nil
	}
	return item, err == nil, err
}

func listPostgresNodeFinalProjections(ctx context.Context, db *sql.DB, companyID, nodeID string, includeDocuments bool) ([]domain.NodeProjection, error) {
	rows, err := db.QueryContext(ctx, postgresNodeTextboxProjectionSelect(includeDocuments)+`
where textbox.company_id=$1::uuid and textbox.node_id=$2::uuid and textbox.deleted_timestamp is null
order by textbox.display_order,textbox.textbox_id`, companyID, nodeID, editorTextBlockProjectionPrefix)
	if err != nil {
		return nil, err
	}
	items := make([]domain.NodeProjection, 0)
	for rows.Next() {
		item, scanErr := scanNodeProjection(rows)
		if scanErr != nil {
			rows.Close()
			return nil, scanErr
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}

	rows, err = db.QueryContext(ctx, postgresNodeEmailRelationshipProjectionSelect+`
where relationship.company_id=$1::uuid and relationship.resource_type='node'
  and relationship.resource_id=$2::uuid
order by relationship.created_timestamp,relationship.email_relationship_id`, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		item, scanErr := scanNodeProjection(rows)
		if scanErr != nil {
			rows.Close()
			return nil, scanErr
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}

	chats, err := listPostgresNodeTextboxChatProjections(ctx, db, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	items = append(items, chats...)
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].InformationID < items[j].InformationID
		}
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}

func addPostgresNodeEmailRelationshipTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput, relationshipID string) (domain.NodeProjection, error) {
	var payload nodeAttachedEmailPayload
	if json.Unmarshal([]byte(input.Information), &payload) != nil {
		return domain.NodeProjection{}, ErrInvalid
	}
	rawBlockID := strings.TrimSpace(payload.BlockID)
	rawEmailMessageID := strings.TrimSpace(payload.EmailMessageID)
	payload.BlockID = cleanUUIDText(payload.BlockID)
	payload.EmailMessageID = cleanUUIDText(payload.EmailMessageID)
	payload.TextboxColor = strings.ToUpper(strings.TrimSpace(payload.TextboxColor))
	payload.LinkScope = strings.ToLower(strings.TrimSpace(payload.LinkScope))
	if payload.LinkScope == "" {
		payload.LinkScope = "message"
	}
	actorUserID := cleanUUIDText(input.ActorUserID)
	if rawEmailMessageID == "" || payload.EmailMessageID == "" {
		return domain.NodeProjection{}, ErrEmailMessageIdentityInvalid
	}
	if (rawBlockID != "" && payload.BlockID == "") || actorUserID == "" ||
		(payload.LinkScope != "message" && payload.LinkScope != "thread") ||
		(payload.LinkScope == "thread" && payload.BlockID != "") ||
		(payload.TextboxColor != "" && (payload.BlockID == "" || !validNodeTextboxColor(payload.TextboxColor))) {
		return domain.NodeProjection{}, ErrInvalid
	}
	if existing, found, err := postgresNodeFinalProjectionTx(ctx, tx, input.CompanyID, input.NodeID, relationshipID); err != nil {
		return domain.NodeProjection{}, err
	} else if found {
		if existing.Type != "Attached email" {
			return domain.NodeProjection{}, ErrInvalid
		}
		var messageID, textboxID string
		if err := tx.QueryRowContext(ctx, `select email_message_id::text,coalesce(resource_textbox_id,'')
from email_relationships where company_id=$1::uuid and email_relationship_id=$2::uuid`, input.CompanyID, relationshipID).Scan(&messageID, &textboxID); err != nil {
			return domain.NodeProjection{}, err
		}
		if messageID != payload.EmailMessageID || textboxID != payload.BlockID {
			return domain.NodeProjection{}, ErrInvalid
		}
		return existing, nil
	}
	attachedAt := time.Now().UTC()
	if strings.TrimSpace(payload.AttachedTimestamp) != "" {
		parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(payload.AttachedTimestamp))
		if err != nil {
			return domain.NodeProjection{}, ErrInvalid
		}
		attachedAt = parsed.UTC()
	}
	var emailThreadID string
	var existingTextboxColor string
	if payload.BlockID != "" {
		if err := tx.QueryRowContext(ctx, `select coalesce(color,'')
from node_textboxes
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and deleted_timestamp is null
for update`, input.CompanyID, input.NodeID, payload.BlockID).Scan(&existingTextboxColor); errors.Is(err, sql.ErrNoRows) {
			return domain.NodeProjection{}, ErrInvalid
		} else if err != nil {
			return domain.NodeProjection{}, err
		}
		if err := tx.QueryRowContext(ctx, `select coalesce((
  select message.email_thread_id::text
  from email_messages message
  where message.company_id=$1::uuid and message.email_message_id=$3::uuid
    and exists (
      select 1 from email_relationships relationship
      where relationship.company_id=message.company_id
        and relationship.email_thread_id=message.email_thread_id
        and relationship.resource_type='node'
        and relationship.resource_id=$2::uuid
        and relationship.resource_textbox_id is null
    )
), '')`, input.CompanyID, input.NodeID, payload.EmailMessageID).Scan(&emailThreadID); err != nil {
			return domain.NodeProjection{}, err
		}
		if emailThreadID == "" {
			return domain.NodeProjection{}, ErrEmailMessageNotAttachedToNode
		}
	} else {
		err := tx.QueryRowContext(ctx, `select message.email_thread_id::text
from email_messages message
join email_threads thread on thread.company_id=message.company_id and thread.email_thread_id=message.email_thread_id
join email_connections connection on connection.company_id=thread.company_id
 and connection.email_connection_id=thread.email_connection_id
where message.company_id=$1::uuid and message.email_message_id=$2::uuid
  and ((connection.connection_type='personal' and connection.personal_user_id=$3::uuid)
    or exists (
      select 1 from shared_inboxes inbox
      where inbox.company_id=thread.company_id
        and inbox.company_email_connection_id=thread.email_connection_id
        and mangorts_user_can_access_resource(
          $1::uuid,'shared_inbox',inbox.shared_inbox_id,$3::uuid,'edit')
    ))`,
			input.CompanyID, payload.EmailMessageID, actorUserID).Scan(&emailThreadID)
		if errors.Is(err, sql.ErrNoRows) {
			return domain.NodeProjection{}, ErrInvalid
		}
		if err != nil {
			return domain.NodeProjection{}, err
		}
	}
	if payload.BlockID != "" {
		existing, existingTextboxID, found, err := postgresNodeMessageTextboxEmailProjectionTx(
			ctx, tx, input.CompanyID, input.NodeID, payload.EmailMessageID,
		)
		if err != nil {
			return domain.NodeProjection{}, err
		}
		if found {
			if existingTextboxID != payload.BlockID {
				return domain.NodeProjection{}, ErrEmailMessageTextboxConflict
			}
			return existing, nil
		}
		if existingTextboxColor == "" && payload.TextboxColor == "" {
			return domain.NodeProjection{}, ErrInvalid
		}
	}
	var insertResult sql.Result
	var err error
	if payload.LinkScope == "thread" {
		insertResult, err = tx.ExecContext(ctx, `insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,resource_type,resource_id,resource_textbox_id,created_timestamp
)
select $1::uuid,
       case when message.email_message_id=$4::uuid then $2::uuid else gen_random_uuid() end,
       $3::uuid,message.email_message_id,'node',$5::uuid,nullif($6,''),$7
from email_messages message
where message.company_id=$1::uuid and message.email_thread_id=$3::uuid
on conflict do nothing`,
			input.CompanyID, relationshipID, emailThreadID, payload.EmailMessageID, input.NodeID, payload.BlockID, attachedAt)
	} else {
		insertResult, err = tx.ExecContext(ctx, `insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,resource_type,resource_id,resource_textbox_id,created_timestamp
) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'node',$5::uuid,nullif($6,''),$7)
on conflict do nothing`,
			input.CompanyID, relationshipID, emailThreadID, payload.EmailMessageID, input.NodeID, payload.BlockID, attachedAt)
	}
	if err != nil {
		return domain.NodeProjection{}, err
	}
	if payload.BlockID != "" {
		inserted, err := insertResult.RowsAffected()
		if err != nil {
			return domain.NodeProjection{}, err
		}
		if inserted > 0 {
			if existingTextboxColor == "" {
				if _, err := tx.ExecContext(ctx, `update node_textboxes
set color=coalesce(color,nullif($4,'')),
    updated_timestamp=case when color is null then clock_timestamp() else updated_timestamp end
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and deleted_timestamp is null`,
					input.CompanyID, input.NodeID, payload.BlockID, payload.TextboxColor); err != nil {
					return domain.NodeProjection{}, err
				}
			}
			if _, err := tx.ExecContext(ctx, `select mangorts_bump_node_view_version($1::uuid,$2::uuid)`, input.CompanyID, input.NodeID); err != nil {
				return domain.NodeProjection{}, err
			}
		}
	}
	projection, found, err := postgresNodeFinalProjectionTx(ctx, tx, input.CompanyID, input.NodeID, relationshipID)
	if err != nil {
		return domain.NodeProjection{}, err
	}
	if found {
		return projection, nil
	}
	if payload.BlockID != "" {
		existing, existingTextboxID, found, err := postgresNodeMessageTextboxEmailProjectionTx(
			ctx, tx, input.CompanyID, input.NodeID, payload.EmailMessageID,
		)
		if err != nil {
			return domain.NodeProjection{}, err
		}
		if !found || existingTextboxID != payload.BlockID {
			if found {
				return domain.NodeProjection{}, ErrEmailMessageTextboxConflict
			}
			return domain.NodeProjection{}, ErrInvalid
		}
		return existing, nil
	}
	return postgresNodeMessageWideEmailProjectionTx(ctx, tx, input.CompanyID, input.NodeID, payload.EmailMessageID)
}

func nodeEmailRelationshipMutationError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" &&
		strings.TrimSpace(pgErr.Message) == "email relationship is required by an active Node chat" {
		return ErrEmailRelationshipRequiredByChat
	}
	return err
}

func postgresNodeMessageTextboxEmailProjectionTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, nodeID, emailMessageID string,
) (domain.NodeProjection, string, bool, error) {
	var relationshipID, textboxID string
	err := tx.QueryRowContext(ctx, `select email_relationship_id::text,resource_textbox_id
from email_relationships
where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid
  and email_message_id=$3::uuid and resource_textbox_id is not null
order by created_timestamp,email_relationship_id
limit 1`, companyID, nodeID, emailMessageID).Scan(&relationshipID, &textboxID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NodeProjection{}, "", false, nil
	}
	if err != nil {
		return domain.NodeProjection{}, "", false, err
	}
	projection, found, err := postgresNodeFinalProjectionTx(ctx, tx, companyID, nodeID, relationshipID)
	return projection, textboxID, found, err
}

func postgresNodeMessageWideEmailProjectionTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, nodeID, emailMessageID string,
) (domain.NodeProjection, error) {
	var relationshipID string
	err := tx.QueryRowContext(ctx, `select email_relationship_id::text
from email_relationships
where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid
  and email_message_id=$3::uuid and resource_textbox_id is null
order by created_timestamp,email_relationship_id
limit 1`, companyID, nodeID, emailMessageID).Scan(&relationshipID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NodeProjection{}, ErrNotFound
	}
	if err != nil {
		return domain.NodeProjection{}, err
	}
	projection, found, err := postgresNodeFinalProjectionTx(ctx, tx, companyID, nodeID, relationshipID)
	if err != nil {
		return domain.NodeProjection{}, err
	}
	if !found {
		return domain.NodeProjection{}, ErrNotFound
	}
	return projection, nil
}
