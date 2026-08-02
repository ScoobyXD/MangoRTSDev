package store

import (
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) ListCommunicationsEmailDrafts(input CommunicationsEmailDraftListInput) ([]domain.CommunicationsEmailDraft, error) {
	if err := r.ensureCommunicationsEmailDraftsSchema(); err != nil {
		return nil, err
	}
	scope, _, participantOnly, err := normalizeCommunicationsEmailDraftReadScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID, input.ParticipantUserID)
	if err != nil {
		return nil, err
	}
	if participantOnly {
		return r.appendParticipantSharedCommunicationsEmailDrafts(input, []domain.CommunicationsEmailDraft{})
	}

	var rows *sql.Rows
	if scope.scopeType == "shared" {
		rows, err = r.db.Query(`
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts
where company_id = $1::uuid
	and deleted_timestamp is null
	and email_relationship_id is null
	and shared_inbox_id = $2::uuid
order by updated_timestamp desc, draft_id asc`, scope.companyID, scope.sharedInboxID)
	} else {
		rows, err = r.db.Query(`
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts
where company_id = $1::uuid
	and deleted_timestamp is null
	and email_relationship_id is null
	and personal_user_id = $2::uuid
	and personal_account_email = $3
order by updated_timestamp desc, draft_id asc`, scope.companyID, scope.personalUserID, scope.personalAccountEmail)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	drafts := make([]domain.CommunicationsEmailDraft, 0)
	for rows.Next() {
		draft, err := scanCommunicationsEmailDraft(rows)
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
	if err := r.ensureCommunicationsEmailDraftsSchema(); err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	scope, _, participantOnly, err := normalizeCommunicationsEmailDraftReadScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID, input.ParticipantUserID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if participantOnly {
		return r.getParticipantSharedCommunicationsEmailDraft(input)
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
	and deleted_timestamp is null
	and email_relationship_id is null`, scope.companyID, draftID, scope.sharedInboxID))
	} else {
		draft, err = scanCommunicationsEmailDraft(r.db.QueryRow(`
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts
where company_id = $1::uuid
	and draft_id = $2
	and personal_user_id = $3::uuid
	and personal_account_email = $4
	and deleted_timestamp is null
	and email_relationship_id is null`, scope.companyID, draftID, scope.personalUserID, scope.personalAccountEmail))
	}
	return draft, err
}

func (r *PostgresRepo) UpsertCommunicationsEmailDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	if err := r.ensureCommunicationsEmailDraftsSchema(); err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if input.IsShared {
		return r.upsertSharedCommunicationsEmailDraft(input)
	}
	draft, err := normalizeCommunicationsEmailDraftInput(input)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	var sourceEmailMessageID string
	if draft.SourceMessageID != "" {
		rows, err := r.db.Query(`
select distinct message.email_message_id::text
from email_messages message
join email_threads thread on thread.company_id=message.company_id and thread.email_thread_id=message.email_thread_id
where message.company_id=$1::uuid and message.provider_message_id=$2
 and (($3='personal' and thread.mailbox_scope_type='personal'
       and thread.personal_user_id=nullif($4,'')::uuid and thread.personal_account_email=$5)
   or ($3='shared' and thread.mailbox_scope_type='shared' and thread.shared_inbox_id=nullif($6,'')::uuid))
limit 2`, draft.CompanyID, draft.SourceMessageID, draft.ScopeType,
			draft.PersonalUserID, draft.PersonalAccountEmail, draft.SharedInboxID)
		if err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return domain.CommunicationsEmailDraft{}, err
			}
			if sourceEmailMessageID != "" {
				rows.Close()
				return domain.CommunicationsEmailDraft{}, ErrInvalid
			}
			sourceEmailMessageID = id
		}
		if err := rows.Close(); err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		if sourceEmailMessageID == "" {
			return domain.CommunicationsEmailDraft{}, ErrNotFound
		}
	}
	saved, err := scanCommunicationsEmailDraft(r.db.QueryRow(`
insert into email_drafts (
 company_id,draft_id,email_relationship_id,source_email_message_id,mailbox_scope_type,
 personal_user_id,personal_account_email,shared_inbox_id,sender_account_email,
 created_by_user_id,updated_by_user_id,kind,to_recipients,cc_recipients,bcc_recipients,
 subject,body_editor_html,scheduled_send_timestamp,created_timestamp,updated_timestamp,deleted_timestamp
) values (
 $1::uuid,$2,null,nullif($3,'')::uuid,$4,nullif($5,'')::uuid,nullif($6,''),nullif($7,'')::uuid,$8,
 nullif($9,'')::uuid,nullif($10,'')::uuid,$11,$12,$13,$14,$15,$16,$17,now(),now(),null
)
on conflict(company_id,draft_id) do update set
 source_email_message_id=excluded.source_email_message_id,
 updated_by_user_id=excluded.updated_by_user_id,kind=excluded.kind,
 sender_account_email=excluded.sender_account_email,to_recipients=excluded.to_recipients,
 cc_recipients=excluded.cc_recipients,bcc_recipients=excluded.bcc_recipients,
 subject=excluded.subject,body_editor_html=excluded.body_editor_html,
 scheduled_send_timestamp=excluded.scheduled_send_timestamp,
 revision=email_drafts.revision+1,send_state='draft',updated_timestamp=now(),deleted_timestamp=null
where email_drafts.email_relationship_id is null
 and email_drafts.mailbox_scope_type=excluded.mailbox_scope_type
 and email_drafts.personal_user_id is not distinct from excluded.personal_user_id
 and email_drafts.personal_account_email is not distinct from excluded.personal_account_email
 and email_drafts.shared_inbox_id is not distinct from excluded.shared_inbox_id
returning `+communicationsEmailDraftSelectColumns(),
		draft.CompanyID, draft.DraftID, sourceEmailMessageID, draft.ScopeType,
		draft.PersonalUserID, draft.PersonalAccountEmail, draft.SharedInboxID, draft.AccountEmail,
		draft.CreatedByUserID, draft.UpdatedByUserID, draft.Kind, draft.ToRecipients,
		draft.CcRecipients, draft.BccRecipients, draft.Subject, draft.BodyEditorHTML,
		draft.ScheduledSendTimestamp))
	if errors.Is(err, ErrNotFound) {
		return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
	}
	return saved, err
}

func (r *PostgresRepo) SoftDeleteCommunicationsEmailDraft(input CommunicationsEmailDraftDeleteInput) error {
	if err := r.ensureCommunicationsEmailDraftsSchema(); err != nil {
		return err
	}
	scope, _, participantOnly, err := normalizeCommunicationsEmailDraftReadScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID, input.ParticipantUserID)
	if err != nil {
		return err
	}
	if participantOnly {
		return r.softDeleteParticipantSharedCommunicationsEmailDraft(input)
	}
	draftID := strings.TrimSpace(input.DraftID)
	updatedByUserID := cleanUUIDText(input.UpdatedByUserID)
	if draftID == "" {
		return ErrInvalid
	}
	result, err := r.db.Exec(`
update email_drafts
set deleted_timestamp = now(),
	updated_timestamp = now(),
	updated_by_user_id = nullif($3, '')::uuid
where company_id = $1::uuid
	and draft_id = $2
	and personal_user_id is not distinct from nullif($4, '')::uuid
	and personal_account_email is not distinct from nullif($5, '')
	and shared_inbox_id is not distinct from nullif($6, '')::uuid
	and deleted_timestamp is null
	and email_relationship_id is null`, scope.companyID, draftID, updatedByUserID, scope.personalUserID, scope.personalAccountEmail, scope.sharedInboxID)
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
	return nil
}

func (r *PostgresRepo) GetCommunicationsEmailSignature(input CommunicationsEmailSignatureScopeInput) (domain.CommunicationsEmailSignature, error) {
	if err := r.ensureCommunicationsEmailDraftsSchema(); err != nil {
		return domain.CommunicationsEmailSignature{}, err
	}
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return domain.CommunicationsEmailSignature{}, err
	}
	if scope.scopeType == "shared" {
		return scanCommunicationsEmailSignature(r.db.QueryRow(`
select `+communicationsEmailSignatureSelectColumns()+`
from communications_email_signatures
where company_id = $1::uuid
  and shared_inbox_id = $2::uuid
order by is_default desc, updated_timestamp desc
limit 1`, scope.companyID, scope.sharedInboxID))
	}
	return scanCommunicationsEmailSignature(r.db.QueryRow(`
select `+communicationsEmailSignatureSelectColumns()+`
from communications_email_signatures
where company_id = $1::uuid
  and personal_user_id = $2::uuid
  and personal_account_email = $3
order by is_default desc, updated_timestamp desc
limit 1`, scope.companyID, scope.personalUserID, scope.personalAccountEmail))
}

func (r *PostgresRepo) UpsertCommunicationsEmailSignature(input CommunicationsEmailSignatureInput) (domain.CommunicationsEmailSignature, error) {
	if err := r.ensureCommunicationsEmailDraftsSchema(); err != nil {
		return domain.CommunicationsEmailSignature{}, err
	}
	signature, err := normalizeCommunicationsEmailSignatureInput(input)
	if err != nil {
		return domain.CommunicationsEmailSignature{}, err
	}
	return scanCommunicationsEmailSignature(r.db.QueryRow(`
insert into communications_email_signatures (
  company_id,
  signature_id,
  personal_user_id,
  personal_account_email,
  shared_inbox_id,
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
  nullif($3, '')::uuid,
  nullif($4, ''),
  nullif($5, '')::uuid,
  $6,
  $7,
  $8,
  nullif($9, '')::uuid,
  nullif($10, '')::uuid,
  now(),
  now()
)
on conflict (company_id, signature_id) do update set
  personal_user_id = excluded.personal_user_id,
  personal_account_email = excluded.personal_account_email,
  shared_inbox_id = excluded.shared_inbox_id,
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

func (r *PostgresRepo) ensureCommunicationsEmailDraftsSchema() error {
	if r == nil || r.db == nil {
		return ErrInvalid
	}
	return nil
}

func communicationsEmailDraftSelectColumns() string {
	return `
company_id::text,
draft_id,
mailbox_scope_type,
coalesce(personal_user_id::text, ''),
coalesce(personal_account_email, ''),
coalesce(shared_inbox_id::text, ''),
coalesce(email_relationship_id::text, ''),
email_relationship_id is not null,
revision,
send_state,
send_claim_token,
send_idempotency_key,
send_idempotency_grant_id,
send_idempotency_timestamp,
send_claimed_revision,
send_claimed_timestamp,
sent_provider_message_id,
coalesce(created_by_user_id::text, ''),
coalesce(updated_by_user_id::text, ''),
kind,
coalesce(source_email_message_id::text, ''),
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
	var sendIdempotency sql.NullTime
	var sendClaimed sql.NullTime
	var deleted sql.NullTime
	err := row.Scan(
		&draft.CompanyID,
		&draft.DraftID,
		&draft.ScopeType,
		&draft.PersonalUserID,
		&draft.PersonalAccountEmail,
		&draft.SharedInboxID,
		&draft.CollaborationID,
		&draft.IsShared,
		&draft.Revision,
		&draft.SendState,
		&draft.SendClaimToken,
		&draft.SendIdempotencyKey,
		&draft.SendIdempotencyGrantID,
		&sendIdempotency,
		&draft.SendClaimedRevision,
		&sendClaimed,
		&draft.SentMessageID,
		&draft.CreatedByUserID,
		&draft.UpdatedByUserID,
		&draft.Kind,
		&draft.SourceMessageID,
		&draft.AccountEmail,
		&draft.ToRecipients,
		&draft.CcRecipients,
		&draft.BccRecipients,
		&draft.Subject,
		&draft.BodyEditorHTML,
		&draft.ReplyToMessageJSON,
		&scheduled,
		&draft.CreatedTimestamp,
		&draft.UpdatedTimestamp,
		&deleted,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsEmailDraft{}, ErrNotFound
	}
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if scheduled.Valid {
		draft.ScheduledSendTimestamp = &scheduled.Time
	}
	if sendIdempotency.Valid {
		draft.SendIdempotencyTimestamp = &sendIdempotency.Time
	}
	if sendClaimed.Valid {
		draft.SendClaimedTimestamp = &sendClaimed.Time
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
