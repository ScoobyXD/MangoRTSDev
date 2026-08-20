package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) ListCommunicationsEmailDrafts(input CommunicationsEmailDraftListInput) ([]domain.CommunicationsEmailDraft, error) {
	owner, err := normalizeCommunicationsSharedDraftOwner(input.SharedResourceType, input.SharedResourceID)
	if err != nil {
		return nil, err
	}
	if owner.resourceID != "" {
		return r.listCommunicationsResourceEmailDrafts(input, owner)
	}
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return nil, err
	}
	kind, sourceMessageIDs, sourceThreadIDs, err := normalizeCommunicationsEmailDraftListFilters(input.Kind, input.SourceMessageIDs, input.SourceThreadIDs)
	if err != nil {
		return nil, err
	}
	sourceMessageIDFilter := strings.Join(sourceMessageIDs, ",")
	sourceThreadIDFilter := strings.Join(sourceThreadIDs, ",")

	var rows *sql.Rows
	if scope.scopeType == "shared" {
		rows, err = r.db.Query(`
select `+communicationsEmailDraftSummarySelectColumns()+`,
  case when $7::boolean and $3<>'' then `+communicationsEmailDraftCanSendSQL("draft", "$3")+` else false end
from email_drafts draft
left join email_messages source_message
  on source_message.company_id=draft.company_id
 and source_message.email_message_id=draft.source_email_message_id
where draft.company_id = $1::uuid
	and draft.deleted_timestamp is null
	and draft.shared_inbox_id = $2::uuid
	and (($7::boolean and draft.shared_resource_type is not null
	      and mangorts_user_can_access_resource(draft.company_id,
	        draft.shared_resource_type,draft.shared_resource_id,$3::uuid,'edit'))
	  or (not $7::boolean and draft.shared_resource_type is null))
	and ($7::boolean or $3='' or draft.created_by_user_id = $3::uuid)
	and ($4='' or draft.kind = $4)
	and (($5='' and $6='')
		or draft.source_email_message_id = any(string_to_array($5, ',')::uuid[])
		or source_message.email_thread_id = any(string_to_array($6, ',')::uuid[]))
order by draft.updated_timestamp desc, draft.draft_id asc
limit case when $7::boolean then 100 else null end`, scope.companyID, scope.sharedInboxID, cleanUUIDText(input.ParticipantUserID), kind, sourceMessageIDFilter, sourceThreadIDFilter, input.ResourceSharedOnly)
	} else {
		rows, err = r.db.Query(`
select `+communicationsEmailDraftSummarySelectColumns()+`,
  case when $8::boolean and $4<>'' then `+communicationsEmailDraftCanSendSQL("draft", "$4")+` else false end
from email_drafts draft
left join email_messages source_message
  on source_message.company_id=draft.company_id
 and source_message.email_message_id=draft.source_email_message_id
where draft.company_id = $1::uuid
	and draft.deleted_timestamp is null
	and draft.personal_user_id = $2::uuid
	and draft.personal_account_email = $3
	and (($8::boolean and draft.shared_resource_type is not null
	      and mangorts_user_can_access_resource(draft.company_id,
	        draft.shared_resource_type,draft.shared_resource_id,$4::uuid,'edit'))
	  or (not $8::boolean and draft.shared_resource_type is null))
	and ($8::boolean or $4='' or draft.created_by_user_id = $4::uuid)
	and ($5='' or draft.kind = $5)
	and (($6='' and $7='')
		or draft.source_email_message_id = any(string_to_array($6, ',')::uuid[])
		or source_message.email_thread_id = any(string_to_array($7, ',')::uuid[]))
order by draft.updated_timestamp desc, draft.draft_id asc
limit case when $8::boolean then 100 else null end`, scope.companyID, scope.personalUserID, scope.personalAccountEmail, cleanUUIDText(input.ParticipantUserID), kind, sourceMessageIDFilter, sourceThreadIDFilter, input.ResourceSharedOnly)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	drafts := make([]domain.CommunicationsEmailDraft, 0)
	for rows.Next() {
		draft, err := scanCommunicationsEmailDraftWithCanSend(rows)
		if err != nil {
			return nil, err
		}
		drafts = append(drafts, draft)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return drafts, nil
}

func (r *PostgresRepo) GetCommunicationsEmailDraft(input CommunicationsEmailDraftGetInput) (domain.CommunicationsEmailDraft, error) {
	owner, err := normalizeCommunicationsSharedDraftOwner(input.SharedResourceType, input.SharedResourceID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if owner.resourceID != "" {
		return r.getCommunicationsResourceEmailDraft(input, owner)
	}
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draftID := strings.TrimSpace(input.DraftID)
	if draftID == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	var draft domain.CommunicationsEmailDraft
	if scope.scopeType == "shared" {
		draft, err = scanCommunicationsEmailDraft(r.db.QueryRow(`
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts
where company_id = $1::uuid
		and draft_id = $2
		and shared_inbox_id = $3::uuid
		and shared_resource_type is null and shared_resource_id is null
		and ($4='' or created_by_user_id = $4::uuid)
		and deleted_timestamp is null`, scope.companyID, draftID, scope.sharedInboxID, cleanUUIDText(input.ParticipantUserID)))
	} else {
		draft, err = scanCommunicationsEmailDraft(r.db.QueryRow(`
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts
where company_id = $1::uuid
	and draft_id = $2
		and personal_user_id = $3::uuid
		and personal_account_email = $4
		and shared_resource_type is null and shared_resource_id is null
		and ($5='' or created_by_user_id = $5::uuid)
		and deleted_timestamp is null`, scope.companyID, draftID, scope.personalUserID, scope.personalAccountEmail, cleanUUIDText(input.ParticipantUserID)))
	}
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	return r.hydrateCommunicationsEmailDraftReplyTarget(draft)
}

func (r *PostgresRepo) UpsertCommunicationsEmailDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	owner, err := normalizeCommunicationsSharedDraftOwner(input.SharedResourceType, input.SharedResourceID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if owner.resourceID != "" {
		return r.updateCommunicationsResourceEmailDraft(input, owner)
	}
	draft, err := normalizeCommunicationsEmailDraftInput(input)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if input.ExistingOnly {
		if draft.Kind != "reply" {
			return domain.CommunicationsEmailDraft{}, ErrInvalid
		}
		source, err := r.requireCommunicationsEmailDraftSource(draft)
		if err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		updated, err := r.updateExistingCommunicationsEmailReplyDraft(draft)
		if err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		return communicationsEmailDraftWithReplyTarget(updated, source)
	}
	source, err := r.requireCommunicationsEmailDraftSource(draft)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	saved, err := scanCommunicationsEmailDraft(r.db.QueryRow(`
insert into email_drafts (
 company_id,draft_id,source_email_message_id,email_account_type,
 personal_user_id,personal_account_email,shared_inbox_id,sender_account_email,
 created_by_user_id,updated_by_user_id,kind,to_recipients,cc_recipients,bcc_recipients,
 subject,body_editor_html,scheduled_send_timestamp,created_timestamp,updated_timestamp,deleted_timestamp
) values (
 $1::uuid,$2,nullif($3,'')::uuid,case $4 when 'personal' then 'personal_email_account' else 'shared_email_account' end,nullif($5,'')::uuid,nullif($6,''),nullif($7,'')::uuid,$8,
 nullif($9,'')::uuid,nullif($10,'')::uuid,$11,$12,$13,$14,$15,$16,$17,now(),now(),null
)
on conflict(company_id,draft_id) do update set
 updated_by_user_id=excluded.updated_by_user_id,
 sender_account_email=excluded.sender_account_email,to_recipients=excluded.to_recipients,
 cc_recipients=excluded.cc_recipients,bcc_recipients=excluded.bcc_recipients,
 subject=excluded.subject,body_editor_html=excluded.body_editor_html,
 scheduled_send_timestamp=excluded.scheduled_send_timestamp,
 updated_timestamp=now(),deleted_timestamp=null
where email_drafts.created_by_user_id=excluded.created_by_user_id
 and email_drafts.email_account_type=excluded.email_account_type
 and email_drafts.kind=excluded.kind
 and email_drafts.source_email_message_id is not distinct from excluded.source_email_message_id
 and email_drafts.personal_user_id is not distinct from excluded.personal_user_id
 and email_drafts.personal_account_email is not distinct from excluded.personal_account_email
 and email_drafts.shared_inbox_id is not distinct from excluded.shared_inbox_id
 and email_drafts.shared_resource_type is null and email_drafts.shared_resource_id is null
returning `+communicationsEmailDraftSelectColumns(),
		draft.CompanyID, draft.DraftID, source.emailMessageID, draft.ScopeType,
		draft.PersonalUserID, draft.PersonalAccountEmail, draft.SharedInboxID, draft.AccountEmail,
		draft.CreatedByUserID, draft.UpdatedByUserID, draft.Kind, draft.ToRecipients,
		draft.CcRecipients, draft.BccRecipients, draft.Subject, draft.BodyEditorHTML,
		draft.ScheduledSendTimestamp))
	if errors.Is(err, ErrNotFound) {
		return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
	}
	if err != nil {
		return domain.CommunicationsEmailDraft{}, communicationsEmailDraftUpsertError(err)
	}
	if saved.Kind != "reply" {
		saved.ReplyToMessageJSON = draft.ReplyToMessageJSON
		return saved, nil
	}
	return communicationsEmailDraftWithReplyTarget(saved, source)
}

func communicationsEmailDraftUpsertError(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return err
	}
	switch strings.TrimSpace(pgErr.ConstraintName) {
	case "idx_email_drafts_active_personal_message_personal_account",
		"idx_email_drafts_active_personal_message_shared_inbox":
		return ErrEmailDraftIdentityConflict
	default:
		return err
	}
}

func (r *PostgresRepo) EnsureCommunicationsEmailReplyDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, bool, error) {
	owner, err := normalizeCommunicationsSharedDraftOwner(input.SharedResourceType, input.SharedResourceID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	if owner.resourceID != "" {
		return r.ensureCommunicationsResourceEmailReplyDraft(input, owner)
	}
	if strings.TrimSpace(input.SeedFromPersonalDraftID) != "" {
		return domain.CommunicationsEmailDraft{}, false, ErrInvalid
	}
	input.DraftID = "draft:reply:" + newUUIDv7String()
	input.Kind = "reply"
	input.ReplyToMessageJSON = "{}"
	draft, err := normalizeCommunicationsEmailDraftInput(input)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	if cleanUUIDText(draft.CreatedByUserID) == "" {
		return domain.CommunicationsEmailDraft{}, false, ErrInvalid
	}

	existing, err := r.getCommunicationsEmailDraftBySemanticIdentity(draft)
	if err == nil {
		if existing.Kind != "reply" {
			return domain.CommunicationsEmailDraft{}, false, ErrEmailDraftIdentityConflict
		}
		source, err := r.requireCommunicationsEmailDraftSource(existing)
		if err != nil {
			return domain.CommunicationsEmailDraft{}, false, err
		}
		existing, err = communicationsEmailDraftWithReplyTarget(existing, source)
		return existing, false, err
	}
	if !errors.Is(err, ErrNotFound) {
		return domain.CommunicationsEmailDraft{}, false, err
	}

	source, err := r.requireCommunicationsEmailDraftSource(draft)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	created, err := scanCommunicationsEmailDraft(r.db.QueryRow(`
insert into email_drafts (
 company_id,draft_id,source_email_message_id,email_account_type,
 personal_user_id,personal_account_email,shared_inbox_id,sender_account_email,
 created_by_user_id,updated_by_user_id,kind,to_recipients,cc_recipients,bcc_recipients,
 subject,body_editor_html,scheduled_send_timestamp,created_timestamp,updated_timestamp,deleted_timestamp
) values (
 $1::uuid,$2,$3::uuid,case $4 when 'personal' then 'personal_email_account' else 'shared_email_account' end,nullif($5,'')::uuid,nullif($6,''),nullif($7,'')::uuid,$8,
 $9::uuid,nullif($10,'')::uuid,'reply',$11,$12,$13,$14,$15,$16,now(),now(),null
)
on conflict do nothing
returning `+communicationsEmailDraftSelectColumns(),
		draft.CompanyID, draft.DraftID, source.emailMessageID, draft.ScopeType,
		draft.PersonalUserID, draft.PersonalAccountEmail, draft.SharedInboxID, draft.AccountEmail,
		draft.CreatedByUserID, draft.UpdatedByUserID, draft.ToRecipients, draft.CcRecipients,
		draft.BccRecipients, draft.Subject, draft.BodyEditorHTML, draft.ScheduledSendTimestamp))
	if err == nil {
		created, err = communicationsEmailDraftWithReplyTarget(created, source)
		return created, true, err
	}
	if !errors.Is(err, ErrNotFound) {
		return domain.CommunicationsEmailDraft{}, false, err
	}

	existing, err = r.getCommunicationsEmailDraftBySemanticIdentity(draft)
	if err == nil {
		if existing.Kind != "reply" {
			return domain.CommunicationsEmailDraft{}, false, ErrEmailDraftIdentityConflict
		}
		source, err := r.requireCommunicationsEmailDraftSource(existing)
		if err != nil {
			return domain.CommunicationsEmailDraft{}, false, err
		}
		existing, err = communicationsEmailDraftWithReplyTarget(existing, source)
		return existing, false, err
	}
	if errors.Is(err, ErrNotFound) {
		return domain.CommunicationsEmailDraft{}, false, ErrConflict
	}
	return domain.CommunicationsEmailDraft{}, false, err
}

func (r *PostgresRepo) updateExistingCommunicationsEmailReplyDraft(draft domain.CommunicationsEmailDraft) (domain.CommunicationsEmailDraft, error) {
	updated, err := scanCommunicationsEmailDraft(r.db.QueryRow(`
update email_drafts
set updated_by_user_id=nullif($8,'')::uuid,
 sender_account_email=$9,to_recipients=$10,cc_recipients=$11,bcc_recipients=$12,
 subject=$13,body_editor_html=$14,scheduled_send_timestamp=$15,updated_timestamp=now()
where company_id=$1::uuid and draft_id=$2 and source_email_message_id=$3::uuid
 and created_by_user_id=$4::uuid and kind='reply'
 and email_account_type=case $5 when 'personal' then 'personal_email_account' else 'shared_email_account' end
 and personal_user_id is not distinct from nullif($6,'')::uuid
 and personal_account_email is not distinct from nullif($7,'')
 and shared_inbox_id is not distinct from nullif($16,'')::uuid
 and shared_resource_type is null and shared_resource_id is null
 and deleted_timestamp is null
returning `+communicationsEmailDraftSelectColumns(),
		draft.CompanyID, draft.DraftID, draft.SourceMessageID, draft.CreatedByUserID,
		draft.ScopeType, draft.PersonalUserID, draft.PersonalAccountEmail, draft.UpdatedByUserID,
		draft.AccountEmail, draft.ToRecipients, draft.CcRecipients, draft.BccRecipients,
		draft.Subject, draft.BodyEditorHTML, draft.ScheduledSendTimestamp, draft.SharedInboxID))
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	return updated, nil
}

func (r *PostgresRepo) getCommunicationsEmailDraftBySemanticIdentity(draft domain.CommunicationsEmailDraft) (domain.CommunicationsEmailDraft, error) {
	if draft.ScopeType == "shared" {
		return scanCommunicationsEmailDraft(r.db.QueryRow(`
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts
where company_id=$1::uuid and created_by_user_id=$2::uuid
 and source_email_message_id=$3::uuid and shared_inbox_id=$4::uuid
 and email_account_type='shared_email_account' and shared_resource_type is null and shared_resource_id is null
 and deleted_timestamp is null`,
			draft.CompanyID, draft.CreatedByUserID, draft.SourceMessageID, draft.SharedInboxID))
	}
	return scanCommunicationsEmailDraft(r.db.QueryRow(`
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts
where company_id=$1::uuid and created_by_user_id=$2::uuid
 and source_email_message_id=$3::uuid and personal_user_id=$4::uuid
 and personal_account_email=$5 and email_account_type='personal_email_account'
 and shared_resource_type is null and shared_resource_id is null and deleted_timestamp is null`,
		draft.CompanyID, draft.CreatedByUserID, draft.SourceMessageID, draft.PersonalUserID, draft.PersonalAccountEmail))
}

type communicationsEmailDraftSource struct {
	emailMessageID    string
	providerMessageID string
	providerThreadID  string
}

func (r *PostgresRepo) requireCommunicationsEmailDraftSource(draft domain.CommunicationsEmailDraft) (communicationsEmailDraftSource, error) {
	if draft.SourceMessageID == "" {
		return communicationsEmailDraftSource{}, nil
	}
	var source communicationsEmailDraftSource
	err := r.db.QueryRow(`
select message.email_message_id::text,message.provider_message_id,thread.provider_thread_id
from email_messages message
join email_threads thread on thread.company_id=message.company_id and thread.email_thread_id=message.email_thread_id
join email_connections connection on connection.company_id=thread.company_id
 and connection.email_connection_id=thread.email_connection_id
left join shared_inboxes inbox on inbox.company_id=thread.company_id
 and inbox.company_email_connection_id=thread.email_connection_id
where message.company_id=$1::uuid and message.email_message_id=$2::uuid
 and (($3='personal' and connection.connection_type='personal'
       and connection.personal_user_id=nullif($4,'')::uuid and connection.account_email=$5)
   or ($3='shared' and connection.connection_type='shared' and inbox.shared_inbox_id=nullif($6,'')::uuid))
limit 1`, draft.CompanyID, draft.SourceMessageID, draft.ScopeType,
		draft.PersonalUserID, draft.PersonalAccountEmail, draft.SharedInboxID).
		Scan(&source.emailMessageID, &source.providerMessageID, &source.providerThreadID)
	if errors.Is(err, sql.ErrNoRows) {
		return communicationsEmailDraftSource{}, ErrEmailDraftSourceNotFound
	}
	if err != nil {
		return communicationsEmailDraftSource{}, err
	}
	return source, nil
}

func (r *PostgresRepo) hydrateCommunicationsEmailDraftReplyTarget(draft domain.CommunicationsEmailDraft) (domain.CommunicationsEmailDraft, error) {
	if draft.Kind != "reply" || strings.TrimSpace(draft.SourceMessageID) == "" {
		return draft, nil
	}
	source := communicationsEmailDraftSource{emailMessageID: draft.SourceMessageID}
	err := r.db.QueryRow(`
select message.provider_message_id,thread.provider_thread_id
from email_messages message
join email_threads thread
  on thread.company_id=message.company_id
 and thread.email_thread_id=message.email_thread_id
where message.company_id=$1::uuid and message.email_message_id=$2::uuid`,
		draft.CompanyID, draft.SourceMessageID).Scan(&source.providerMessageID, &source.providerThreadID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsEmailDraft{}, ErrEmailDraftSourceNotFound
	}
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	return communicationsEmailDraftWithReplyTarget(draft, source)
}

func communicationsEmailDraftWithReplyTarget(draft domain.CommunicationsEmailDraft, source communicationsEmailDraftSource) (domain.CommunicationsEmailDraft, error) {
	if draft.Kind != "reply" || source.emailMessageID == "" {
		return draft, nil
	}
	payload, err := json.Marshal(map[string]string{
		"id":               source.providerMessageID,
		"email_message_id": source.emailMessageID,
		"thread_id":        source.providerThreadID,
	})
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draft.ReplyToMessageJSON = string(payload)
	return draft, nil
}

func (r *PostgresRepo) SoftDeleteCommunicationsEmailDraft(input CommunicationsEmailDraftDeleteInput) error {
	owner, err := normalizeCommunicationsSharedDraftOwner(input.SharedResourceType, input.SharedResourceID)
	if err != nil {
		return err
	}
	if owner.resourceID != "" {
		return r.deleteCommunicationsResourceEmailDraft(input, owner)
	}
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return err
	}
	draftID := strings.TrimSpace(input.DraftID)
	updatedByUserID := cleanUUIDText(input.UpdatedByUserID)
	if draftID == "" {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
update email_drafts
set deleted_timestamp = now(),
	updated_timestamp = now(),
	updated_by_user_id = nullif($3, '')::uuid
where company_id = $1::uuid
	and draft_id = $2
	and personal_user_id is not distinct from nullif($4, '')::uuid
	and personal_account_email is not distinct from nullif($5, '')
	and shared_inbox_id is not distinct from nullif($6, '')::uuid
	and created_by_user_id = nullif($7, '')::uuid
	and shared_resource_type is null and shared_resource_id is null
	and deleted_timestamp is null`, scope.companyID, draftID, updatedByUserID, scope.personalUserID, scope.personalAccountEmail, scope.sharedInboxID, cleanUUIDText(input.ParticipantUserID))
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, scope.companyID, "email_draft", draftID); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) GetCommunicationsSharedEmailDraftForSend(input CommunicationsEmailDraftGetInput) (domain.CommunicationsEmailDraft, error) {
	companyID, actorUserID, draftID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.ParticipantUserID), strings.TrimSpace(input.DraftID)
	if companyID == "" || actorUserID == "" || draftID == "" || input.ExpectedRevision < 1 {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	draft, err := scanCommunicationsEmailDraftWithCanSend(r.db.QueryRow(`
select `+communicationsEmailDraftSelectColumns()+`,
  `+communicationsEmailDraftCanSendSQL("draft", "$3")+`
from email_drafts draft
where draft.company_id=$1::uuid and draft.draft_id=$2
	and draft.shared_resource_type is not null
  and draft.deleted_timestamp is null
	and mangorts_user_can_access_resource(draft.company_id,
	  draft.shared_resource_type,draft.shared_resource_id,$3::uuid,'edit')`, companyID, draftID, actorUserID))
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if draft.Revision != input.ExpectedRevision {
		return domain.CommunicationsEmailDraft{}, ErrVersionConflict
	}
	hydrated, err := r.hydrateCommunicationsEmailDraftReplyTarget(draft)
	if err == nil {
		hydrated.CanSend = draft.CanSend
	}
	return hydrated, err
}

func (r *PostgresRepo) listCommunicationsResourceEmailDrafts(input CommunicationsEmailDraftListInput, owner communicationsSharedDraftOwner) ([]domain.CommunicationsEmailDraft, error) {
	companyID, actorUserID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.ParticipantUserID)
	if companyID == "" || actorUserID == "" {
		return nil, ErrInvalid
	}
	kind, sourceMessageIDs, sourceThreadIDs, err := normalizeCommunicationsEmailDraftListFilters(input.Kind, input.SourceMessageIDs, input.SourceThreadIDs)
	if err != nil {
		return nil, err
	}
	if len(sourceMessageIDs) == 0 && len(sourceThreadIDs) == 0 {
		return nil, ErrInvalid
	}
	rows, err := r.db.Query(`
select `+communicationsEmailDraftSummarySelectColumns()+`,
  `+communicationsEmailDraftCanSendSQL("draft", "$2")+`
from email_drafts draft
join email_messages source_message
  on source_message.company_id=draft.company_id
 and source_message.email_message_id=draft.source_email_message_id
where draft.company_id=$1::uuid and draft.deleted_timestamp is null
	and mangorts_user_can_access_resource($1::uuid,$3,nullif($4,'')::uuid,$2::uuid,'edit')
  and exists (
    select 1 from email_relationships relationship
    where relationship.company_id=draft.company_id
      and relationship.email_message_id=draft.source_email_message_id
	  and relationship.resource_type=$3
	  and relationship.resource_id=nullif($4,'')::uuid
      and relationship.resource_textbox_id is null
  )
  and (
	(draft.shared_resource_type=$3 and draft.shared_resource_id=nullif($4,'')::uuid)
	or (draft.shared_resource_type is null and draft.shared_resource_id is null
      and draft.created_by_user_id=$2::uuid
      and `+communicationsEmailDraftCanSendSQL("draft", "$2")+`)
  )
  and ($5='' or draft.kind=$5)
  and (($6='' and $7='')
    or draft.source_email_message_id=any(string_to_array($6,',')::uuid[])
    or source_message.email_thread_id=any(string_to_array($7,',')::uuid[]))
order by draft.updated_timestamp desc,draft.draft_id asc`, companyID, actorUserID, owner.resourceType, owner.resourceID, kind, strings.Join(sourceMessageIDs, ","), strings.Join(sourceThreadIDs, ","))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	drafts := make([]domain.CommunicationsEmailDraft, 0)
	for rows.Next() {
		draft, err := scanCommunicationsEmailDraftWithCanSend(rows)
		if err != nil {
			return nil, err
		}
		drafts = append(drafts, draft)
	}
	return drafts, rows.Err()
}

func (r *PostgresRepo) getCommunicationsResourceEmailDraft(input CommunicationsEmailDraftGetInput, owner communicationsSharedDraftOwner) (domain.CommunicationsEmailDraft, error) {
	companyID, actorUserID, draftID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.ParticipantUserID), strings.TrimSpace(input.DraftID)
	if companyID == "" || actorUserID == "" || draftID == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	draft, err := scanCommunicationsEmailDraftWithCanSend(r.db.QueryRow(`
select `+communicationsEmailDraftSelectColumns()+`,
  `+communicationsEmailDraftCanSendSQL("draft", "$5")+`
from email_drafts draft
where draft.company_id=$1::uuid and draft.draft_id=$2
	and draft.shared_resource_type=$3
	and draft.shared_resource_id=nullif($4,'')::uuid
  and draft.deleted_timestamp is null
	and mangorts_user_can_access_resource(draft.company_id,
	  draft.shared_resource_type,draft.shared_resource_id,$5::uuid,'edit')`, companyID, draftID, owner.resourceType, owner.resourceID, actorUserID))
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if input.ExpectedRevision > 0 && draft.Revision != input.ExpectedRevision {
		return domain.CommunicationsEmailDraft{}, ErrVersionConflict
	}
	if input.ExpectedRevision > 0 {
		return draft, nil
	}
	hydrated, err := r.hydrateCommunicationsEmailDraftReplyTarget(draft)
	if err == nil {
		hydrated.CanSend = draft.CanSend
	}
	return hydrated, err
}

type communicationsResourceEmailDraftSource struct {
	communicationsEmailDraftSource
	scopeType            string
	personalUserID       string
	personalAccountEmail string
	sharedInboxID        string
	accountEmail         string
}

func (r *PostgresRepo) ensureCommunicationsResourceEmailReplyDraft(input CommunicationsEmailDraftInput, owner communicationsSharedDraftOwner) (domain.CommunicationsEmailDraft, bool, error) {
	companyID, actorUserID, sourceMessageID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.CreatedByUserID), cleanUUIDText(input.SourceMessageID)
	if companyID == "" || actorUserID == "" || sourceMessageID == "" || input.ScheduledSendTimestamp != nil {
		return domain.CommunicationsEmailDraft{}, false, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	defer tx.Rollback()
	if err := lockResourceSharedEmailDraftOwnerTx(ctx, tx, companyID, owner.resourceType, owner.resourceID); err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	var source communicationsResourceEmailDraftSource
	err = tx.QueryRowContext(ctx, `
select message.email_message_id::text,message.provider_message_id,thread.provider_thread_id,
  case connection.connection_type when 'personal' then 'personal' else 'shared' end,
  coalesce(connection.personal_user_id::text,''),
  case when connection.connection_type='personal' then connection.account_email else '' end,
  coalesce(inbox.shared_inbox_id::text,''),connection.account_email
from email_relationships relationship
join email_messages message on message.company_id=relationship.company_id
  and message.email_message_id=relationship.email_message_id
join email_threads thread on thread.company_id=message.company_id
  and thread.email_thread_id=message.email_thread_id
join email_connections connection on connection.company_id=thread.company_id
  and connection.email_connection_id=thread.email_connection_id
left join shared_inboxes inbox on connection.connection_type='shared'
  and inbox.company_id=connection.company_id
  and inbox.shared_inbox_id=nullif($6,'')::uuid
  and inbox.company_email_connection_id=connection.email_connection_id
where relationship.company_id=$1::uuid
  and relationship.email_message_id=$2::uuid
	and relationship.resource_type=$3
	and relationship.resource_id=nullif($4,'')::uuid
  and relationship.resource_textbox_id is null
  and (connection.connection_type='personal' or inbox.shared_inbox_id is not null)
  and mangorts_user_can_access_resource($1::uuid,relationship.resource_type,relationship.resource_id,$5::uuid,'edit')
for share of relationship`, companyID, sourceMessageID, owner.resourceType, owner.resourceID, actorUserID, cleanUUIDText(input.SharedInboxID)).Scan(
		&source.emailMessageID, &source.providerMessageID, &source.providerThreadID, &source.scopeType,
		&source.personalUserID, &source.personalAccountEmail, &source.sharedInboxID, &source.accountEmail)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsEmailDraft{}, false, ErrEmailDraftSourceNotFound
	}
	if err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	draftID := "draft:reply:" + newUUIDv7String()
	created, err := scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
insert into email_drafts (
 company_id,draft_id,source_email_message_id,email_account_type,
	personal_user_id,personal_account_email,shared_inbox_id,shared_resource_type,shared_resource_id,revision,
 sender_account_email,created_by_user_id,updated_by_user_id,kind,to_recipients,cc_recipients,bcc_recipients,
 subject,body_editor_html,scheduled_send_timestamp,created_timestamp,updated_timestamp,deleted_timestamp
) values (
 $1::uuid,$2,$3::uuid,case $4 when 'personal' then 'personal_email_account' else 'shared_email_account' end,
	nullif($5,'')::uuid,nullif($6,''),nullif($7,'')::uuid,nullif($8,''),nullif($9,'')::uuid,1,
 $10,$11::uuid,$11::uuid,'reply',$12,$13,$14,$15,$16,null,now(),now(),null
)
on conflict do nothing
returning `+communicationsEmailDraftSelectColumns(), companyID, draftID, sourceMessageID, source.scopeType,
		source.personalUserID, source.personalAccountEmail, source.sharedInboxID, owner.resourceType, owner.resourceID,
		source.accountEmail, actorUserID, input.ToRecipients, input.CcRecipients, input.BccRecipients, input.Subject, input.BodyEditorHTML))
	createdNew := err == nil
	if errors.Is(err, ErrNotFound) {
		created, err = scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts
where company_id=$1::uuid and source_email_message_id=$2::uuid
	and shared_resource_type=$3
	and shared_resource_id=nullif($4,'')::uuid
	and deleted_timestamp is null`, companyID, sourceMessageID, owner.resourceType, owner.resourceID))
	}
	if err != nil {
		return domain.CommunicationsEmailDraft{}, false, communicationsEmailDraftUpsertError(err)
	}
	seedDraftID := strings.TrimSpace(input.SeedFromPersonalDraftID)
	if createdNew && seedDraftID != "" {
		seed, seedErr := scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts
where company_id=$1::uuid and draft_id=$2 and created_by_user_id=$3::uuid
  and source_email_message_id=$4::uuid and kind='reply' and deleted_timestamp is null
  and shared_resource_type is null and shared_resource_id is null
  and (($5='personal' and email_account_type='personal_email_account'
        and personal_user_id is not distinct from nullif($6,'')::uuid
        and personal_account_email is not distinct from nullif($7,''))
    or ($5='shared' and email_account_type='shared_email_account'
        and shared_inbox_id is not distinct from nullif($8,'')::uuid))
for share`, companyID, seedDraftID, actorUserID, sourceMessageID, source.scopeType,
			source.personalUserID, source.personalAccountEmail, source.sharedInboxID))
		if errors.Is(seedErr, ErrNotFound) {
			return domain.CommunicationsEmailDraft{}, false, ErrInvalid
		}
		if seedErr != nil {
			return domain.CommunicationsEmailDraft{}, false, seedErr
		}
		created.ToRecipients, created.CcRecipients, created.BccRecipients = seed.ToRecipients, seed.CcRecipients, seed.BccRecipients
		created.Subject, created.BodyEditorHTML = seed.Subject, seed.BodyEditorHTML
		if _, err := tx.ExecContext(ctx, `update email_drafts set
to_recipients=$3,cc_recipients=$4,bcc_recipients=$5,subject=$6,body_editor_html=$7
where company_id=$1::uuid and draft_id=$2`, companyID, created.DraftID, created.ToRecipients,
			created.CcRecipients, created.BccRecipients, created.Subject, created.BodyEditorHTML); err != nil {
			return domain.CommunicationsEmailDraft{}, false, err
		}
		if _, err := tx.ExecContext(ctx, `insert into attachment_relationships (
 attachment_relationship_id,company_id,resource_type,resource_id,attachment_id,information_id,
 message_id,editor_surface,relationship_kind,created_by_user_id,created_timestamp,deleted_timestamp
)
select gen_random_uuid(),company_id,'email_draft',$3,attachment_id,information_id,
 message_id,editor_surface,relationship_kind,$4::uuid,now(),null
from attachment_relationships
where company_id=$1::uuid and resource_type='email_draft' and resource_id=$2 and deleted_timestamp is null`,
			companyID, seedDraftID, created.DraftID, actorUserID); err != nil {
			return domain.CommunicationsEmailDraft{}, false, err
		}
	}
	if err := tx.QueryRowContext(ctx, `select `+communicationsEmailDraftCanSendSQL("draft", "$3")+`
from email_drafts draft where draft.company_id=$1::uuid and draft.draft_id=$2`, companyID, created.DraftID, actorUserID).Scan(&created.CanSend); err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	created, err = communicationsEmailDraftWithReplyTarget(created, source.communicationsEmailDraftSource)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	return created, createdNew, nil
}

func (r *PostgresRepo) updateCommunicationsResourceEmailDraft(input CommunicationsEmailDraftInput, owner communicationsSharedDraftOwner) (domain.CommunicationsEmailDraft, error) {
	companyID, actorUserID, draftID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.UpdatedByUserID), strings.TrimSpace(input.DraftID)
	if companyID == "" || actorUserID == "" || draftID == "" || input.ExpectedRevision < 1 ||
		(input.Kind != "" && normalizeCommunicationsEmailDraftKind(input.Kind) != "reply") || input.ScheduledSendTimestamp != nil {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	updated, err := scanCommunicationsEmailDraftWithCanSend(r.db.QueryRow(`
update email_drafts draft set
 updated_by_user_id=$5::uuid,to_recipients=$7,cc_recipients=$8,bcc_recipients=$9,
 subject=$10,body_editor_html=$11,revision=draft.revision+1,updated_timestamp=now()
where draft.company_id=$1::uuid and draft.draft_id=$2
	and draft.shared_resource_type=$3
	and draft.shared_resource_id=nullif($4,'')::uuid
  and draft.revision=$6 and draft.deleted_timestamp is null
	and mangorts_user_can_access_resource(draft.company_id,
	  draft.shared_resource_type,draft.shared_resource_id,$5::uuid,'edit')
returning `+communicationsEmailDraftSelectColumns()+`,
	`+communicationsEmailDraftCanSendSQL("draft", "$5")+``, companyID, draftID, owner.resourceType, owner.resourceID,
		actorUserID, input.ExpectedRevision, input.ToRecipients, input.CcRecipients, input.BccRecipients, input.Subject, input.BodyEditorHTML))
	if !errors.Is(err, ErrNotFound) {
		return updated, err
	}
	return domain.CommunicationsEmailDraft{}, r.communicationsResourceEmailDraftMiss(companyID, draftID, actorUserID, owner, input.ExpectedRevision)
}

func (r *PostgresRepo) deleteCommunicationsResourceEmailDraft(input CommunicationsEmailDraftDeleteInput, owner communicationsSharedDraftOwner) error {
	companyID, actorUserID, draftID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.UpdatedByUserID), strings.TrimSpace(input.DraftID)
	if companyID == "" || actorUserID == "" || draftID == "" || input.ExpectedRevision < 1 {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
update email_drafts draft set deleted_timestamp=now(),updated_timestamp=now(),
 updated_by_user_id=$5::uuid,revision=draft.revision+1
where draft.company_id=$1::uuid and draft.draft_id=$2
	and draft.shared_resource_type=$3
	and draft.shared_resource_id=nullif($4,'')::uuid
  and draft.revision=$6 and draft.deleted_timestamp is null
	and mangorts_user_can_access_resource(draft.company_id,
	  draft.shared_resource_type,draft.shared_resource_id,$5::uuid,'edit')`, companyID, draftID, owner.resourceType, owner.resourceID, actorUserID, input.ExpectedRevision)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return r.communicationsResourceEmailDraftMissContext(ctx, tx, companyID, draftID, actorUserID, owner, input.ExpectedRevision)
	}
	if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "email_draft", draftID); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) communicationsResourceEmailDraftMiss(companyID, draftID, actorUserID string, owner communicationsSharedDraftOwner, expectedRevision int64) error {
	return r.communicationsResourceEmailDraftMissContext(context.Background(), r.db, companyID, draftID, actorUserID, owner, expectedRevision)
}

func (r *PostgresRepo) communicationsResourceEmailDraftMissContext(ctx context.Context, queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, companyID, draftID, actorUserID string, owner communicationsSharedDraftOwner, expectedRevision int64) error {
	var revision int64
	err := queryer.QueryRowContext(ctx, `
select draft.revision
from email_drafts draft
where draft.company_id=$1::uuid and draft.draft_id=$2
	and draft.shared_resource_type=$3
	and draft.shared_resource_id=nullif($4,'')::uuid
  and draft.deleted_timestamp is null
	and mangorts_user_can_access_resource(draft.company_id,
	  draft.shared_resource_type,draft.shared_resource_id,$5::uuid,'edit')`, companyID, draftID, owner.resourceType, owner.resourceID, actorUserID).Scan(&revision)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if revision != expectedRevision {
		return ErrVersionConflict
	}
	return ErrNotFound
}

func communicationsEmailDraftCanSendSQL(alias, actorParameter string) string {
	return `case when ` + alias + `.email_account_type='personal_email_account'
    then ` + alias + `.personal_user_id=` + actorParameter + `::uuid
    else mangorts_user_can_access_resource(` + alias + `.company_id,'shared_inbox',
      ` + alias + `.shared_inbox_id,` + actorParameter + `::uuid,'edit') end`
}

func retireResourceSharedEmailDraftAttachmentsTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) error {
	if resourceType != EntityTypeNode && resourceType != EntityTypeProject {
		return ErrInvalid
	}
	if err := lockResourceSharedEmailDraftOwnerTx(ctx, tx, companyID, resourceType, resourceID); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `select draft_id from email_drafts
where company_id=$1::uuid and shared_resource_type=$2 and shared_resource_id=$3::uuid
for update`, companyID, resourceType, resourceID)
	if err != nil {
		return err
	}
	defer rows.Close()
	draftIDs := make([]string, 0)
	for rows.Next() {
		var draftID string
		if err := rows.Scan(&draftID); err != nil {
			return err
		}
		draftIDs = append(draftIDs, draftID)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, draftID := range draftIDs {
		if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "email_draft", draftID); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `delete from email_drafts
where company_id=$1::uuid and shared_resource_type=$2 and shared_resource_id=$3::uuid`, companyID, resourceType, resourceID)
	return err
}

func lockResourceSharedEmailDraftOwnerTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) error {
	table, idColumn := "nodes", "node_id"
	if resourceType == EntityTypeProject {
		table, idColumn = "projects", "project_id"
	} else if resourceType != EntityTypeNode {
		return ErrInvalid
	}
	var locked int
	err := tx.QueryRowContext(ctx, `select 1 from `+table+` where company_id=$1::uuid and `+idColumn+`=$2::uuid for update`, companyID, resourceID).Scan(&locked)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func retireExactResourceSharedEmailDraftTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID, sourceMessageID string) error {
	if resourceType != EntityTypeNode && resourceType != EntityTypeProject {
		return ErrInvalid
	}
	var draftID string
	err := tx.QueryRowContext(ctx, `select draft_id from email_drafts
where company_id=$1::uuid and shared_resource_type=$2 and shared_resource_id=$3::uuid
  and source_email_message_id=$4::uuid and deleted_timestamp is null
for update`, companyID, resourceType, resourceID, sourceMessageID).Scan(&draftID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "email_draft", draftID); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `update email_drafts
set deleted_timestamp=now(),updated_timestamp=now(),revision=revision+1
where company_id=$1::uuid and draft_id=$2 and deleted_timestamp is null`, companyID, draftID)
	return err
}
func (r *PostgresRepo) GetCommunicationsEmailSignature(input CommunicationsEmailSignatureScopeInput) (domain.CommunicationsEmailSignature, error) {
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return domain.CommunicationsEmailSignature{}, err
	}
	if scope.scopeType == "shared" {
		return scanCommunicationsEmailSignature(r.db.QueryRow(`
select `+communicationsEmailSignatureSelectColumns()+`
from email_signatures
where company_id = $1::uuid
  and shared_inbox_id = $2::uuid
order by is_default desc, updated_timestamp desc
limit 1`, scope.companyID, scope.sharedInboxID))
	}
	return scanCommunicationsEmailSignature(r.db.QueryRow(`
select `+communicationsEmailSignatureSelectColumns()+`
from email_signatures
where company_id = $1::uuid
  and personal_user_id = $2::uuid
  and personal_account_email = $3
order by is_default desc, updated_timestamp desc
limit 1`, scope.companyID, scope.personalUserID, scope.personalAccountEmail))
}

func (r *PostgresRepo) UpsertCommunicationsEmailSignature(input CommunicationsEmailSignatureInput) (domain.CommunicationsEmailSignature, error) {
	signature, err := normalizeCommunicationsEmailSignatureInput(input)
	if err != nil {
		return domain.CommunicationsEmailSignature{}, err
	}
	return scanCommunicationsEmailSignature(r.db.QueryRow(`
insert into email_signatures (
  company_id,
  signature_id,
  email_account_type,
  personal_user_id,
  personal_account_email,
  shared_inbox_id,
  email_account_email,
  name,
  body_editor_html,
  is_default,
  created_by_user_id,
  updated_by_user_id,
  created_timestamp,
  updated_timestamp
) values (
  $1::uuid,
  $2,
  case when nullif($3, '') is not null then 'personal_email_account' else 'shared_email_account' end,
  nullif($3, '')::uuid,
  nullif($4, ''),
  nullif($5, '')::uuid,
  case when nullif($3, '') is not null then lower(btrim($4))
       else (select lower(btrim(account_email)) from shared_inboxes where company_id=$1::uuid and shared_inbox_id=$5::uuid)
  end,
  $6,
  $7,
  $8,
  nullif($9, '')::uuid,
  nullif($10, '')::uuid,
  now(),
  now()
)
on conflict (company_id, signature_id) do update set
  email_account_type = excluded.email_account_type,
  personal_user_id = excluded.personal_user_id,
  personal_account_email = excluded.personal_account_email,
  shared_inbox_id = excluded.shared_inbox_id,
  email_account_email = excluded.email_account_email,
  name = excluded.name,
  body_editor_html = excluded.body_editor_html,
  is_default = excluded.is_default,
  updated_by_user_id = excluded.updated_by_user_id,
  updated_timestamp = now()
returning `+communicationsEmailSignatureSelectColumns(),
		signature.CompanyID,
		signature.SignatureID,
		signature.PersonalUserID,
		signature.PersonalAccountEmail,
		signature.SharedInboxID,
		signature.Name,
		signature.BodyEditorHTML,
		signature.IsDefault,
		signature.CreatedByUserID,
		signature.UpdatedByUserID,
	))
}

func communicationsEmailDraftSelectColumns() string {
	return `
company_id::text,
draft_id,
case email_account_type when 'personal_email_account' then 'personal' else 'shared' end,
coalesce(personal_user_id::text, ''),
coalesce(personal_account_email, ''),
coalesce(shared_inbox_id::text, ''),
coalesce(shared_resource_type, ''),
coalesce(shared_resource_id::text, ''),
revision,
coalesce(created_by_user_id::text, ''),
coalesce(updated_by_user_id::text, ''),
kind,
coalesce(source_email_message_id::text, ''),
'',
sender_account_email,
to_recipients,
cc_recipients,
bcc_recipients,
subject,
body_editor_html,
'{}',
scheduled_send_timestamp,
created_timestamp,
updated_timestamp,
deleted_timestamp`
}

func communicationsEmailDraftSummarySelectColumns() string {
	return `
draft.company_id::text,
draft.draft_id,
case draft.email_account_type when 'personal_email_account' then 'personal' else 'shared' end,
coalesce(draft.personal_user_id::text, ''),
coalesce(draft.personal_account_email, ''),
coalesce(draft.shared_inbox_id::text, ''),
coalesce(draft.shared_resource_type, ''),
coalesce(draft.shared_resource_id::text, ''),
draft.revision,
coalesce(draft.created_by_user_id::text, ''),
coalesce(draft.updated_by_user_id::text, ''),
draft.kind,
coalesce(draft.source_email_message_id::text, ''),
coalesce(source_message.email_thread_id::text, ''),
draft.sender_account_email,
draft.to_recipients,
draft.cc_recipients,
draft.bcc_recipients,
draft.subject,
'',
'{}',
draft.scheduled_send_timestamp,
draft.created_timestamp,
draft.updated_timestamp,
draft.deleted_timestamp`
}

func communicationsEmailSignatureSelectColumns() string {
	return `
company_id::text,
signature_id,
case when shared_inbox_id is null then 'personal' else 'shared' end,
coalesce(personal_user_id::text, ''),
coalesce(personal_account_email, ''),
coalesce(shared_inbox_id::text, ''),
name,
body_editor_html,
is_default,
coalesce(created_by_user_id::text, ''),
coalesce(updated_by_user_id::text, ''),
created_timestamp,
updated_timestamp`
}

func scanCommunicationsEmailDraft(row interface{ Scan(dest ...any) error }) (domain.CommunicationsEmailDraft, error) {
	var draft domain.CommunicationsEmailDraft
	var scheduled sql.NullTime
	var deleted sql.NullTime
	err := row.Scan(communicationsEmailDraftScanDestinations(&draft, &scheduled, &deleted)...)
	return finishScannedCommunicationsEmailDraft(draft, scheduled, deleted, err)
}

func scanCommunicationsEmailDraftWithCanSend(row interface{ Scan(dest ...any) error }) (domain.CommunicationsEmailDraft, error) {
	var draft domain.CommunicationsEmailDraft
	var scheduled sql.NullTime
	var deleted sql.NullTime
	destinations := communicationsEmailDraftScanDestinations(&draft, &scheduled, &deleted)
	destinations = append(destinations, &draft.CanSend)
	err := row.Scan(destinations...)
	return finishScannedCommunicationsEmailDraft(draft, scheduled, deleted, err)
}

func communicationsEmailDraftScanDestinations(draft *domain.CommunicationsEmailDraft, scheduled, deleted *sql.NullTime) []any {
	return []any{
		&draft.CompanyID,
		&draft.DraftID,
		&draft.ScopeType,
		&draft.PersonalUserID,
		&draft.PersonalAccountEmail,
		&draft.SharedInboxID,
		&draft.SharedResourceType,
		&draft.SharedResourceID,
		&draft.Revision,
		&draft.CreatedByUserID,
		&draft.UpdatedByUserID,
		&draft.Kind,
		&draft.SourceMessageID,
		&draft.SourceThreadID,
		&draft.AccountEmail,
		&draft.ToRecipients,
		&draft.CcRecipients,
		&draft.BccRecipients,
		&draft.Subject,
		&draft.BodyEditorHTML,
		&draft.ReplyToMessageJSON,
		scheduled,
		&draft.CreatedTimestamp,
		&draft.UpdatedTimestamp,
		deleted,
	}
}

func finishScannedCommunicationsEmailDraft(draft domain.CommunicationsEmailDraft, scheduled, deleted sql.NullTime, err error) (domain.CommunicationsEmailDraft, error) {
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsEmailDraft{}, ErrNotFound
	}
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if scheduled.Valid {
		draft.ScheduledSendTimestamp = &scheduled.Time
	}
	if deleted.Valid {
		draft.DeletedTimestamp = &deleted.Time
	}
	return draft, nil
}

func scanCommunicationsEmailSignature(row interface{ Scan(dest ...any) error }) (domain.CommunicationsEmailSignature, error) {
	var signature domain.CommunicationsEmailSignature
	err := row.Scan(
		&signature.CompanyID,
		&signature.SignatureID,
		&signature.ScopeType,
		&signature.PersonalUserID,
		&signature.PersonalAccountEmail,
		&signature.SharedInboxID,
		&signature.Name,
		&signature.BodyEditorHTML,
		&signature.IsDefault,
		&signature.CreatedByUserID,
		&signature.UpdatedByUserID,
		&signature.CreatedTimestamp,
		&signature.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsEmailSignature{}, ErrNotFound
	}
	return signature, err
}
