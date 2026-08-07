package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
)

func logicGateProjectionAsInformation(item domain.LogicGateProjection) domain.LogicGateInformation {
	return domain.LogicGateInformation{
		CompanyID: item.CompanyID, LogicGateID: item.LogicGateID, InformationID: item.InformationID,
		Type: item.Type, Information: item.Information,
		CreatedTimestamp: item.CreatedTimestamp, UpdatedTimestamp: item.UpdatedTimestamp,
	}
}

const postgresLogicGateTextboxProjectionSelect = `
select textbox.company_id::text,
       textbox.logic_gate_id::text,
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
             and link.resource_type='logic_gate'
             and link.resource_id=textbox.logic_gate_id::text
             and link.information_id::text=textbox.textbox_id
             and link.relationship_kind in ('file_attachment','inline_image','migrated_inline_image')
             and link.deleted_timestamp is null
         ), '[]'::jsonb),
         'email_message_id', textbox.email_message_id,
         'email_accent', textbox.email_accent
       )::text,
       false,
       textbox.textbox_id,
       greatest(textbox.revision, textbox.metadata_revision),
       textbox.created_timestamp,
       textbox.updated_timestamp
from logic_gate_textboxes textbox`

const postgresLogicGateEmailRelationshipProjectionSelect = `
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
       false,
       relationship.email_relationship_id::text,
       1::bigint,
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

func scanLogicGateProjection(row interface{ Scan(dest ...any) error }) (domain.LogicGateProjection, error) {
	var item domain.LogicGateProjection
	err := row.Scan(&item.CompanyID, &item.LogicGateID, &item.Type, &item.Information, &item.IsDeleted,
		&item.InformationID, &item.Revision, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	return item, err
}

func listPostgresLogicGateFinalProjections(ctx context.Context, db *sql.DB, companyID, logicGateID string) ([]domain.LogicGateProjection, error) {
	items := make([]domain.LogicGateProjection, 0)
	textbox, err := scanLogicGateProjection(db.QueryRowContext(ctx, postgresLogicGateTextboxProjectionSelect+`
where textbox.company_id=$1::uuid and textbox.logic_gate_id=$2::uuid and textbox.deleted_timestamp is null
order by textbox.updated_timestamp desc,textbox.created_timestamp desc,textbox.textbox_id desc
limit 1`, companyID, logicGateID, editorTextBlockProjectionPrefix))
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err == nil {
		items = append(items, textbox)
	}
	rows, err := db.QueryContext(ctx, postgresLogicGateEmailRelationshipProjectionSelect+`
where relationship.company_id=$1::uuid and relationship.resource_type='logic_gate'
  and relationship.resource_id=$2::uuid
order by relationship.created_timestamp,relationship.email_relationship_id`, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		item, err := scanLogicGateProjection(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].InformationID < items[j].InformationID
		}
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}
