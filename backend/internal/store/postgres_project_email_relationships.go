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
	var payload emailTextboxRelationshipPayload
	if json.Unmarshal([]byte(input.Information), &payload) != nil {
		return domain.ProjectProjection{}, ErrInvalid
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
		return domain.ProjectProjection{}, ErrEmailMessageIdentityInvalid
	}
	if (rawBlockID != "" && payload.BlockID == "") || actorUserID == "" ||
		(payload.LinkScope != "message" && payload.LinkScope != "thread") ||
		(payload.LinkScope == "thread" && payload.BlockID != "") {
		return domain.ProjectProjection{}, ErrInvalid
	}
	if payload.BlockID != "" && (payload.BlockID == input.ProjectID ||
		(payload.TextboxColor != "" && !validEmailTextboxColor(payload.TextboxColor))) {
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
	var emailThreadID, existingTextboxColor string
	if payload.BlockID != "" {
		if err := tx.QueryRowContext(ctx, `select coalesce(color,'')
from project_textboxes
where company_id=$1::uuid and project_id=$2::uuid and textbox_id=$3 and deleted_timestamp is null
for update`, input.CompanyID, input.ProjectID, payload.BlockID).Scan(&existingTextboxColor); errors.Is(err, sql.ErrNoRows) {
			return domain.ProjectProjection{}, ErrInvalid
		} else if err != nil {
			return domain.ProjectProjection{}, err
		}
		if err := tx.QueryRowContext(ctx, `select coalesce((
  select message.email_thread_id::text from email_messages message
  where message.company_id=$1::uuid and message.email_message_id=$2::uuid
), '')`, input.CompanyID, payload.EmailMessageID).Scan(&emailThreadID); err != nil {
			return domain.ProjectProjection{}, err
		}
		if emailThreadID == "" {
			return domain.ProjectProjection{}, ErrEmailMessageNotAttachedToProject
		}
		wideLocked, err := lockPostgresWideEmailOwnerThreadRelationshipTx(
			ctx, tx, input.CompanyID, EntityTypeProject, input.ProjectID, emailThreadID,
		)
		if err != nil {
			return domain.ProjectProjection{}, err
		}
		if !wideLocked {
			return domain.ProjectProjection{}, ErrEmailMessageNotAttachedToProject
		}
	} else if err := tx.QueryRowContext(ctx, `select message.email_thread_id::text
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
    ))`, input.CompanyID, payload.EmailMessageID, actorUserID).Scan(&emailThreadID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.ProjectProjection{}, ErrInvalid
		}
		return domain.ProjectProjection{}, err
	}
	if payload.BlockID != "" {
		existing, existingTextboxID, found, err := postgresProjectMessageTextboxEmailProjectionTx(
			ctx, tx, input.CompanyID, input.ProjectID, payload.EmailMessageID,
		)
		if err != nil {
			return domain.ProjectProjection{}, err
		}
		if found {
			if existingTextboxID != payload.BlockID {
				return domain.ProjectProjection{}, ErrEmailMessageTextboxConflict
			}
			return existing, nil
		}
		if existingTextboxColor == "" && payload.TextboxColor == "" {
			return domain.ProjectProjection{}, ErrInvalid
		}
	}
	var insertResult sql.Result
	var insertErr error
	if payload.LinkScope == "thread" {
		insertResult, insertErr = tx.ExecContext(ctx, `insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,resource_type,resource_id,resource_textbox_id,created_timestamp
)
select $1::uuid,case when message.email_message_id=$4::uuid then $2::uuid else gen_random_uuid() end,
       $3::uuid,message.email_message_id,'project',$5::uuid,null,$6
from email_messages message
where message.company_id=$1::uuid and message.email_thread_id=$3::uuid
on conflict do nothing`, input.CompanyID, input.InformationID, emailThreadID, payload.EmailMessageID, input.ProjectID, attachedAt)
	} else {
		insertResult, insertErr = tx.ExecContext(ctx, `insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,resource_type,resource_id,resource_textbox_id,created_timestamp
) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'project',$5::uuid,nullif($6,''),$7)
on conflict do nothing`, input.CompanyID, input.InformationID, emailThreadID, payload.EmailMessageID, input.ProjectID, payload.BlockID, attachedAt)
	}
	if insertErr != nil {
		return domain.ProjectProjection{}, postgresEmailRelationshipMutationError(insertErr, EntityTypeProject)
	}
	if payload.BlockID != "" {
		inserted, err := insertResult.RowsAffected()
		if err != nil {
			return domain.ProjectProjection{}, err
		}
		if inserted > 0 && existingTextboxColor == "" {
			if _, err := tx.ExecContext(ctx, `update project_textboxes
set color=coalesce(color,nullif($4,'')),
    updated_timestamp=case when color is null then clock_timestamp() else updated_timestamp end
where company_id=$1::uuid and project_id=$2::uuid and textbox_id=$3 and deleted_timestamp is null`,
				input.CompanyID, input.ProjectID, payload.BlockID, payload.TextboxColor); err != nil {
				return domain.ProjectProjection{}, err
			}
		}
	}
	projection, found, err := postgresProjectEmailRelationshipProjectionTx(ctx, tx, input.CompanyID, input.ProjectID, input.InformationID)
	if err != nil {
		return domain.ProjectProjection{}, err
	}
	if !found {
		if payload.BlockID != "" {
			existing, existingTextboxID, existingFound, lookupErr := postgresProjectMessageTextboxEmailProjectionTx(
				ctx, tx, input.CompanyID, input.ProjectID, payload.EmailMessageID,
			)
			if lookupErr != nil {
				return domain.ProjectProjection{}, lookupErr
			}
			if existingFound && existingTextboxID != payload.BlockID {
				return domain.ProjectProjection{}, ErrEmailMessageTextboxConflict
			}
			if existingFound {
				return existing, nil
			}
			return domain.ProjectProjection{}, ErrInvalid
		}
		return postgresProjectMessageWideEmailProjectionTx(ctx, tx, input.CompanyID, input.ProjectID, payload.EmailMessageID)
	}
	return projection, nil
}

func postgresProjectMessageTextboxEmailProjectionTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, projectID, emailMessageID string,
) (domain.ProjectProjection, string, bool, error) {
	var relationshipID, textboxID string
	err := tx.QueryRowContext(ctx, `select email_relationship_id::text,resource_textbox_id
from email_relationships
where company_id=$1::uuid and resource_type='project' and resource_id=$2::uuid
  and email_message_id=$3::uuid and resource_textbox_id is not null
order by created_timestamp,email_relationship_id limit 1`, companyID, projectID, emailMessageID).
		Scan(&relationshipID, &textboxID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ProjectProjection{}, "", false, nil
	}
	if err != nil {
		return domain.ProjectProjection{}, "", false, err
	}
	projection, found, err := postgresProjectEmailRelationshipProjectionTx(ctx, tx, companyID, projectID, relationshipID)
	return projection, textboxID, found, err
}

func postgresProjectMessageWideEmailProjectionTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, projectID, emailMessageID string,
) (domain.ProjectProjection, error) {
	var relationshipID string
	err := tx.QueryRowContext(ctx, `select email_relationship_id::text
from email_relationships
where company_id=$1::uuid and resource_type='project' and resource_id=$2::uuid
  and email_message_id=$3::uuid and resource_textbox_id is null
order by created_timestamp,email_relationship_id limit 1`, companyID, projectID, emailMessageID).Scan(&relationshipID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ProjectProjection{}, ErrNotFound
	}
	if err != nil {
		return domain.ProjectProjection{}, err
	}
	projection, found, err := postgresProjectEmailRelationshipProjectionTx(ctx, tx, companyID, projectID, relationshipID)
	if err != nil {
		return domain.ProjectProjection{}, err
	}
	if !found {
		return domain.ProjectProjection{}, ErrNotFound
	}
	return projection, nil
}
