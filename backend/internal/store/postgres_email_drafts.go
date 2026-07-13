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
	scope, err := normalizeCommunicationsEmailSignatureScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return nil, err
	}

	var rows *sql.Rows
	if scope.scopeType == "shared" {
		rows, err = r.db.Query(`
select `+communicationsEmailDraftSelectColumns()+`
from communications_email_drafts
where company_id = $1::uuid
	and deleted_timestamp is null
	and shared_inbox_id = $2::uuid
order by updated_timestamp desc, draft_id asc`, scope.companyID, scope.sharedInboxID)
	} else {
		rows, err = r.db.Query(`
select `+communicationsEmailDraftSelectColumns()+`
from communications_email_drafts
where company_id = $1::uuid
	and deleted_timestamp is null
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
	return drafts, rows.Err()
}

func (r *PostgresRepo) GetCommunicationsEmailDraft(input CommunicationsEmailDraftGetInput) (domain.CommunicationsEmailDraft, error) {
	if err := r.ensureCommunicationsEmailDraftsSchema(); err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	scope, err := normalizeCommunicationsEmailSignatureScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draftID := strings.TrimSpace(input.DraftID)
	if draftID == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	if scope.scopeType == "shared" {
		return scanCommunicationsEmailDraft(r.db.QueryRow(`
select `+communicationsEmailDraftSelectColumns()+`
from communications_email_drafts
where company_id = $1::uuid
	and draft_id = $2
	and shared_inbox_id = $3::uuid
	and deleted_timestamp is null`, scope.companyID, draftID, scope.sharedInboxID))
	}
	return scanCommunicationsEmailDraft(r.db.QueryRow(`
select `+communicationsEmailDraftSelectColumns()+`
from communications_email_drafts
where company_id = $1::uuid
	and draft_id = $2
	and personal_user_id = $3::uuid
	and personal_account_email = $4
	and deleted_timestamp is null`, scope.companyID, draftID, scope.personalUserID, scope.personalAccountEmail))
}

func (r *PostgresRepo) UpsertCommunicationsEmailDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	if err := r.ensureCommunicationsEmailDraftsSchema(); err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draft, err := normalizeCommunicationsEmailDraftInput(input)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	saved, err := scanCommunicationsEmailDraft(r.db.QueryRow(`
insert into communications_email_drafts (
  company_id,
  draft_id,
  personal_user_id,
  personal_account_email,
  shared_inbox_id,
  created_by_user_id,
  updated_by_user_id,
  kind,
  source_message_id,
  account_email,
  to_recipients,
  cc_recipients,
  bcc_recipients,
  subject,
  body_editor_html,
  reply_to_message,
  scheduled_send_timestamp,
  created_timestamp,
  updated_timestamp,
  deleted_timestamp
) values (
  $1::uuid,
  $2,
  nullif($3, '')::uuid,
  nullif($4, ''),
  nullif($5, '')::uuid,
  nullif($6, '')::uuid,
  nullif($7, '')::uuid,
  $8,
  $9,
  $10,
  $11,
  $12,
  $13,
  $14,
  $15,
  coalesce(nullif($16, '')::jsonb, '{}'::jsonb),
  $17,
  now(),
  now(),
  null
)
on conflict (company_id, draft_id) do update set
	updated_by_user_id = excluded.updated_by_user_id,
  kind = excluded.kind,
  source_message_id = excluded.source_message_id,
  account_email = excluded.account_email,
  to_recipients = excluded.to_recipients,
  cc_recipients = excluded.cc_recipients,
  bcc_recipients = excluded.bcc_recipients,
  subject = excluded.subject,
  body_editor_html = excluded.body_editor_html,
  reply_to_message = excluded.reply_to_message,
	scheduled_send_timestamp = excluded.scheduled_send_timestamp,
	updated_timestamp = now(),
	deleted_timestamp = null
where communications_email_drafts.personal_user_id is not distinct from excluded.personal_user_id
	and communications_email_drafts.personal_account_email is not distinct from excluded.personal_account_email
	and communications_email_drafts.shared_inbox_id is not distinct from excluded.shared_inbox_id
returning `+communicationsEmailDraftSelectColumns(),
		draft.CompanyID,
		draft.DraftID,
		draft.PersonalUserID,
		draft.PersonalAccountEmail,
		draft.SharedInboxID,
		draft.CreatedByUserID,
		draft.UpdatedByUserID,
		draft.Kind,
		draft.SourceMessageID,
		draft.AccountEmail,
		draft.ToRecipients,
		draft.CcRecipients,
		draft.BccRecipients,
		draft.Subject,
		draft.BodyEditorHTML,
		draft.ReplyToMessageJSON,
		draft.ScheduledSendTimestamp,
	))
	if errors.Is(err, ErrNotFound) {
		return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
	}
	return saved, err
}

func (r *PostgresRepo) SoftDeleteCommunicationsEmailDraft(input CommunicationsEmailDraftDeleteInput) error {
	if err := r.ensureCommunicationsEmailDraftsSchema(); err != nil {
		return err
	}
	scope, err := normalizeCommunicationsEmailSignatureScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return err
	}
	draftID := strings.TrimSpace(input.DraftID)
	updatedByUserID := cleanUUIDText(input.UpdatedByUserID)
	if draftID == "" {
		return ErrInvalid
	}
	result, err := r.db.Exec(`
update communications_email_drafts
set deleted_timestamp = now(),
	updated_timestamp = now(),
	updated_by_user_id = nullif($3, '')::uuid
where company_id = $1::uuid
	and draft_id = $2
	and personal_user_id is not distinct from nullif($4, '')::uuid
	and personal_account_email is not distinct from nullif($5, '')
	and shared_inbox_id is not distinct from nullif($6, '')::uuid
	and deleted_timestamp is null`, scope.companyID, draftID, updatedByUserID, scope.personalUserID, scope.personalAccountEmail, scope.sharedInboxID)
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
	scope, err := normalizeCommunicationsEmailSignatureScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
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
	r.communicationsEmailDraftsSchemaOnce.Do(func() {
		_, r.communicationsEmailDraftsSchemaErr = r.db.Exec(communicationsEmailDraftsSchemaSQL())
	})
	return r.communicationsEmailDraftsSchemaErr
}

func communicationsEmailDraftSelectColumns() string {
	return `
company_id::text,
draft_id,
case when shared_inbox_id is null then 'personal' else 'shared' end,
coalesce(personal_user_id::text, ''),
coalesce(personal_account_email, ''),
coalesce(shared_inbox_id::text, ''),
coalesce(created_by_user_id::text, ''),
coalesce(updated_by_user_id::text, ''),
kind,
source_message_id,
account_email,
to_recipients,
cc_recipients,
bcc_recipients,
subject,
body_editor_html,
coalesce(reply_to_message::text, '{}'),
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
	var deleted sql.NullTime
	err := row.Scan(
		&draft.CompanyID,
		&draft.DraftID,
		&draft.ScopeType,
		&draft.PersonalUserID,
		&draft.PersonalAccountEmail,
		&draft.SharedInboxID,
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

func communicationsEmailDraftsSchemaSQL() string {
	return `
create table if not exists communications_email_drafts (
  company_id uuid not null,
  draft_id text not null,
  personal_user_id uuid,
  personal_account_email text,
  shared_inbox_id uuid,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  kind text not null default 'compose',
  source_message_id text not null default '',
  account_email text not null default '',
  to_recipients text not null default '',
  cc_recipients text not null default '',
  bcc_recipients text not null default '',
  subject text not null default '',
  body_editor_html text not null default '',
  reply_to_message jsonb not null default '{}'::jsonb,
  scheduled_send_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id, draft_id),
  constraint communications_email_drafts_draft_id_chk check (btrim(draft_id) <> ''),
  constraint communications_email_drafts_kind_chk check (kind in ('compose', 'reply', 'forward')),
  constraint communications_email_drafts_account_email_chk check (account_email = '' or account_email = lower(btrim(account_email))),
  constraint communications_email_drafts_personal_account_email_chk check (personal_account_email is null or (btrim(personal_account_email) <> '' and personal_account_email = lower(btrim(personal_account_email)))),
  constraint communications_email_drafts_scope_chk check (
    (personal_user_id is not null and personal_account_email is not null and shared_inbox_id is null)
    or (personal_user_id is null and personal_account_email is null and shared_inbox_id is not null)
  ),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (personal_user_id, personal_account_email) references user_email_connections(user_id, account_email) on delete cascade,
  foreign key (company_id, shared_inbox_id) references shared_inboxes(company_id, shared_inbox_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null,
  foreign key (updated_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_communications_email_drafts_personal_updated
  on communications_email_drafts(company_id, personal_user_id, personal_account_email, updated_timestamp desc)
  where deleted_timestamp is null and personal_user_id is not null;

create index if not exists idx_communications_email_drafts_shared_updated
  on communications_email_drafts(company_id, shared_inbox_id, updated_timestamp desc)
  where deleted_timestamp is null and shared_inbox_id is not null;

create table if not exists communications_email_signatures (
  company_id uuid not null,
  signature_id text not null,
  personal_user_id uuid,
  personal_account_email text,
  shared_inbox_id uuid,
  name text not null default 'Default',
  body_editor_html text not null default '',
  is_default boolean not null default true,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, signature_id),
  constraint communications_email_signatures_signature_id_chk check (btrim(signature_id) <> ''),
  constraint communications_email_signatures_name_chk check (btrim(name) <> ''),
  constraint communications_email_signatures_personal_account_email_chk check (personal_account_email is null or (btrim(personal_account_email) <> '' and personal_account_email = lower(btrim(personal_account_email)))),
  constraint communications_email_signatures_scope_chk check (
    (personal_user_id is not null and personal_account_email is not null and shared_inbox_id is null)
    or (personal_user_id is null and personal_account_email is null and shared_inbox_id is not null)
  ),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (personal_user_id, personal_account_email) references user_email_connections(user_id, account_email) on delete cascade,
  foreign key (company_id, shared_inbox_id) references shared_inboxes(company_id, shared_inbox_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null,
  foreign key (updated_by_user_id) references users(user_id) on delete set null
);

create unique index if not exists idx_communications_email_signatures_personal_scope
  on communications_email_signatures(company_id, personal_user_id, personal_account_email)
  where personal_user_id is not null;

create unique index if not exists idx_communications_email_signatures_shared_scope
  on communications_email_signatures(company_id, shared_inbox_id)
  where shared_inbox_id is not null;
`
}
