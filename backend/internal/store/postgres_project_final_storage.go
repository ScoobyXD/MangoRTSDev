package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"sort"
)

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
         'color', coalesce(textbox.color, ''),
         'document', (textbox.body_json->'document')::text,
         'email_message_ids', coalesce(linked_email.email_message_ids, '[]'::jsonb),
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
         ), '[]'::jsonb)
       )::text,
       textbox.textbox_id,
       textbox.created_timestamp,
       textbox.updated_timestamp
from project_textboxes textbox
left join lateral (
  select jsonb_agg(relationship.email_message_id::text
    order by message.message_timestamp nulls last,message.email_message_id) as email_message_ids
  from email_relationships relationship
  join email_messages message
    on message.company_id=relationship.company_id
   and message.email_message_id=relationship.email_message_id
  where relationship.company_id=textbox.company_id
    and relationship.resource_type='project'
    and relationship.resource_id=textbox.project_id
    and relationship.resource_textbox_id=textbox.textbox_id
) linked_email on true`

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
