package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"time"
)

type communicationsEmailThreadRowScanner interface {
	Scan(dest ...any) error
}

const postgresCommunicationsEmailThreadColumns = `
t.company_id::text,
t.email_thread_id::text,
t.scope_type,
coalesce(t.personal_user_id::text, ''),
coalesce(t.personal_account_email, ''),
coalesce(t.shared_inbox_id::text, ''),
t.account_email,
t.provider_thread_id,
t.root_provider_message_id,
t.download_status,
t.history_complete,
t.fetched_at,
t.last_download_error,
t.created_timestamp,
t.updated_timestamp`

func scanPostgresCommunicationsEmailThread(row communicationsEmailThreadRowScanner) (domain.CommunicationsEmailThread, error) {
	var item domain.CommunicationsEmailThread
	var fetchedAt sql.NullTime
	err := row.Scan(
		&item.CompanyID, &item.EmailThreadID, &item.ScopeType,
		&item.PersonalUserID, &item.PersonalAccountEmail, &item.SharedInboxID,
		&item.AccountEmail, &item.ProviderThreadID, &item.RootProviderMessageID,
		&item.DownloadStatus, &item.HistoryComplete, &fetchedAt,
		&item.LastDownloadError, &item.CreatedTimestamp, &item.UpdatedTimestamp,
	)
	if fetchedAt.Valid {
		value := fetchedAt.Time
		item.FetchedAt = &value
	}
	return item, err
}

func marshalEmailSnapshotJSON(value any) (string, error) {
	raw, err := json.Marshal(value)
	return string(raw), err
}

func postgresCommunicationsEmailThreadMessages(ctx context.Context, db interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, companyID, emailThreadID string) ([]domain.CommunicationsEmailMessage, error) {
	rows, err := db.QueryContext(ctx, `
select company_id::text, email_message_id::text, email_thread_id::text,
       provider_message_id, provider_thread_id, message_order, subject,
       sender_snapshot::text, to_snapshot::text, cc_snapshot::text,
       bcc_snapshot::text, reply_to_snapshot::text, message_timestamp,
       rich_html_body, text_fallback, snippet, unread, starred,
       folder_snapshot::text, folder_id_snapshot::text, attachment_metadata::text, download_complete,
       created_timestamp, updated_timestamp
from communications_email_messages
where company_id=$1::uuid and email_thread_id=$2::uuid
order by message_order, provider_message_id`, companyID, emailThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.CommunicationsEmailMessage{}
	for rows.Next() {
		var item domain.CommunicationsEmailMessage
		var fromJSON, toJSON, ccJSON, bccJSON, replyToJSON string
		var foldersJSON, folderIDsJSON, attachmentsJSON string
		var textFallback string
		if err := rows.Scan(
			&item.CompanyID, &item.EmailMessageID, &item.EmailThreadID,
			&item.ProviderMessageID, &item.ProviderThreadID, &item.MessageOrder,
			&item.Message.Subject, &fromJSON, &toJSON, &ccJSON, &bccJSON,
			&replyToJSON, &item.Message.Date, &item.Message.Body, &textFallback,
			&item.Message.Snippet, &item.Message.Unread, &item.Message.Starred,
			&foldersJSON, &folderIDsJSON, &attachmentsJSON, &item.Message.DownloadComplete,
			&item.CreatedTimestamp, &item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		item.Message.ID = item.ProviderMessageID
		item.Message.ThreadID = item.ProviderThreadID
		if item.Message.Snippet == "" {
			item.Message.Snippet = textFallback
		}
		for _, value := range []struct {
			raw    string
			target any
		}{
			{fromJSON, &item.Message.From}, {toJSON, &item.Message.To},
			{ccJSON, &item.Message.Cc}, {bccJSON, &item.Message.Bcc},
			{replyToJSON, &item.Message.ReplyTo}, {foldersJSON, &item.Message.Folders},
			{folderIDsJSON, &item.Message.FolderIDs}, {attachmentsJSON, &item.Message.Attachments},
		} {
			if err := json.Unmarshal([]byte(value.raw), value.target); err != nil {
				return nil, err
			}
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func postgresCommunicationsEmailThreadByID(ctx context.Context, db interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, companyID, emailThreadID string) (domain.CommunicationsEmailThread, error) {
	item, err := scanPostgresCommunicationsEmailThread(db.QueryRowContext(ctx, `
select `+postgresCommunicationsEmailThreadColumns+`
from communications_email_threads t
where t.company_id=$1::uuid and t.email_thread_id=$2::uuid`, companyID, emailThreadID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsEmailThread{}, ErrNotFound
	}
	if err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	item.Messages, err = postgresCommunicationsEmailThreadMessages(ctx, db, companyID, emailThreadID)
	if err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	return communicationsEmailThreadForMessages(item), nil
}

func upsertPostgresCommunicationsEmailThreadTx(ctx context.Context, tx *sql.Tx, input CommunicationsEmailThreadUpsertInput) (domain.CommunicationsEmailThread, error) {
	input, scope, err := normalizeCommunicationsEmailThreadInput(input)
	if err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	providerKey := communicationsEmailThreadProviderKey(input.ProviderThreadID, input.SelectedMessageID)
	lockKey := communicationsEmailThreadScopeKey(input.CompanyID, scope, providerKey)
	if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	var emailThreadID, existingProviderThreadID string
	messageLockKey := communicationsEmailThreadScopeKey(input.CompanyID, scope, communicationsEmailThreadProviderKey("", input.SelectedMessageID))
	if messageLockKey != lockKey {
		if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, messageLockKey); err != nil {
			return domain.CommunicationsEmailThread{}, err
		}
	}
	err = tx.QueryRowContext(ctx, `
select t.email_thread_id::text, t.provider_thread_id
from communications_email_threads t
where company_id=$1::uuid and scope_type=$2
  and (provider_thread_key=$6 or (root_provider_message_id=$7 and $7<>'')
       or exists (
         select 1 from communications_email_messages m
         where m.company_id=t.company_id and m.email_thread_id=t.email_thread_id and m.provider_message_id=$7
       ))
  and (($2='personal' and personal_user_id=nullif($3, '')::uuid and personal_account_email=$4)
       or ($2='shared' and shared_inbox_id=nullif($5, '')::uuid))
order by case when provider_thread_key=$6 then 0 else 1 end
limit 1
for update`, input.CompanyID, scope.scopeType, scope.personalUserID, scope.personalAccountEmail, scope.sharedInboxID, providerKey, input.SelectedMessageID).Scan(&emailThreadID, &existingProviderThreadID)
	if errors.Is(err, sql.ErrNoRows) {
		if !communicationsEmailThreadInputContainsSelectedMessage(input) {
			return domain.CommunicationsEmailThread{}, ErrInvalid
		}
		emailThreadID = newUUIDv7String()
		_, err = tx.ExecContext(ctx, `
insert into communications_email_threads (
  company_id, email_thread_id, scope_type, personal_user_id, personal_account_email,
  shared_inbox_id, account_email, provider_thread_key, provider_thread_id,
  root_provider_message_id, download_status, history_complete, fetched_at,
  last_download_error, created_timestamp, updated_timestamp
) values (
  $1::uuid, $2::uuid, $3, nullif($4, '')::uuid, nullif($5, ''),
  nullif($6, '')::uuid, $7, $8, $9, $10,
  case when $11 then 'complete' else 'partial' end, $11, $12, $13, now(), now()
)`, input.CompanyID, emailThreadID, scope.scopeType, scope.personalUserID, scope.personalAccountEmail,
			scope.sharedInboxID, scope.accountEmail, providerKey, input.ProviderThreadID,
			input.SelectedMessageID, input.HistoryComplete, input.FetchedAt, input.LastDownloadError)
	}
	if err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	if existingProviderThreadID != "" && input.ProviderThreadID != "" && existingProviderThreadID != input.ProviderThreadID {
		return domain.CommunicationsEmailThread{}, ErrInvalid
	}
	if _, err := tx.ExecContext(ctx, `
update communications_email_threads
set provider_thread_key=case when provider_thread_id='' and $3<>'' then $7 else provider_thread_key end,
    provider_thread_id=case when provider_thread_id='' then $3 else provider_thread_id end,
    history_complete=history_complete or $4,
    download_status=case when history_complete or $4 then 'complete' else download_status end,
    fetched_at=greatest(coalesce(fetched_at, $5), $5),
    last_download_error=case when history_complete or $4 then '' else $6 end,
    updated_timestamp=now()
where company_id=$1::uuid and email_thread_id=$2::uuid`,
		input.CompanyID, emailThreadID, input.ProviderThreadID, input.HistoryComplete,
		input.FetchedAt, input.LastDownloadError, providerKey); err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	for _, message := range input.Messages {
		fromJSON, err := marshalEmailSnapshotJSON(message.From)
		if err != nil {
			return domain.CommunicationsEmailThread{}, err
		}
		toJSON, _ := marshalEmailSnapshotJSON(message.To)
		ccJSON, _ := marshalEmailSnapshotJSON(message.Cc)
		bccJSON, _ := marshalEmailSnapshotJSON(message.Bcc)
		replyToJSON, _ := marshalEmailSnapshotJSON(message.ReplyTo)
		foldersJSON, _ := marshalEmailSnapshotJSON(message.Folders)
		folderIDsJSON, _ := marshalEmailSnapshotJSON(message.FolderIDs)
		attachmentsJSON, _ := marshalEmailSnapshotJSON(normalizeEmailAttachmentSnapshots(message.Attachments))
		if _, err := tx.ExecContext(ctx, `
insert into communications_email_messages (
  company_id, email_message_id, email_thread_id, provider_message_id,
  provider_thread_id, message_order, subject, sender_snapshot, to_snapshot,
  cc_snapshot, bcc_snapshot, reply_to_snapshot, message_timestamp,
  rich_html_body, text_fallback, snippet, unread, starred, folder_snapshot,
  folder_id_snapshot, attachment_metadata, download_complete, created_timestamp, updated_timestamp
) values (
  $1::uuid, $2::uuid, $3::uuid, $4, $5, 0, $6, $7::jsonb, $8::jsonb,
  $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, $14, $15, $16,
  $17::jsonb, $18::jsonb, $19::jsonb, $20, now(), now()
)
on conflict (company_id, email_thread_id, provider_message_id)
do update set
  provider_thread_id=case when excluded.provider_thread_id<>'' then excluded.provider_thread_id else communications_email_messages.provider_thread_id end,
  subject=case when excluded.subject<>'' then excluded.subject else communications_email_messages.subject end,
  sender_snapshot=case when jsonb_array_length(excluded.sender_snapshot)>0 then excluded.sender_snapshot else communications_email_messages.sender_snapshot end,
  to_snapshot=case when jsonb_array_length(excluded.to_snapshot)>0 then excluded.to_snapshot else communications_email_messages.to_snapshot end,
  cc_snapshot=case when jsonb_array_length(excluded.cc_snapshot)>0 then excluded.cc_snapshot else communications_email_messages.cc_snapshot end,
  bcc_snapshot=case when jsonb_array_length(excluded.bcc_snapshot)>0 then excluded.bcc_snapshot else communications_email_messages.bcc_snapshot end,
  reply_to_snapshot=case when jsonb_array_length(excluded.reply_to_snapshot)>0 then excluded.reply_to_snapshot else communications_email_messages.reply_to_snapshot end,
  message_timestamp=case when excluded.message_timestamp>0 then excluded.message_timestamp else communications_email_messages.message_timestamp end,
  rich_html_body=case when excluded.rich_html_body<>'' then excluded.rich_html_body else communications_email_messages.rich_html_body end,
  text_fallback=case when excluded.text_fallback<>'' then excluded.text_fallback else communications_email_messages.text_fallback end,
  snippet=case when excluded.snippet<>'' then excluded.snippet else communications_email_messages.snippet end,
  unread=excluded.unread,
  starred=excluded.starred,
  folder_snapshot=case when jsonb_array_length(excluded.folder_snapshot)>0 then excluded.folder_snapshot else communications_email_messages.folder_snapshot end,
  folder_id_snapshot=case when jsonb_array_length(excluded.folder_id_snapshot)>0 then excluded.folder_id_snapshot else communications_email_messages.folder_id_snapshot end,
  attachment_metadata=case when jsonb_array_length(excluded.attachment_metadata)>0 then excluded.attachment_metadata else communications_email_messages.attachment_metadata end,
  download_complete=communications_email_messages.download_complete or excluded.download_complete,
  updated_timestamp=now()`,
			input.CompanyID, newUUIDv7String(), emailThreadID, message.ID, message.ThreadID,
			message.Subject, fromJSON, toJSON, ccJSON, bccJSON, replyToJSON,
			message.Date, message.Body, message.Snippet, message.Unread, message.Starred,
			foldersJSON, folderIDsJSON, attachmentsJSON, message.DownloadComplete); err != nil {
			return domain.CommunicationsEmailThread{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `
with ordered as (
  select email_message_id,
         row_number() over (order by message_timestamp, provider_message_id)-1 as next_order
  from communications_email_messages
  where company_id=$1::uuid and email_thread_id=$2::uuid
)
update communications_email_messages target
set message_order=ordered.next_order
from ordered
where target.company_id=$1::uuid and target.email_message_id=ordered.email_message_id`, input.CompanyID, emailThreadID); err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	return postgresCommunicationsEmailThreadByID(ctx, tx, input.CompanyID, emailThreadID)
}

func (r *PostgresRepo) UpsertCommunicationsEmailThread(input CommunicationsEmailThreadUpsertInput) (domain.CommunicationsEmailThread, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	defer tx.Rollback()
	item, err := upsertPostgresCommunicationsEmailThreadTx(ctx, tx, input)
	if err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	return item, nil
}

func (r *PostgresRepo) GetCommunicationsEmailThread(companyID, emailThreadID string) (domain.CommunicationsEmailThread, error) {
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	if companyID == "" || emailThreadID == "" {
		return domain.CommunicationsEmailThread{}, ErrInvalid
	}
	return postgresCommunicationsEmailThreadByID(context.Background(), r.db, companyID, emailThreadID)
}

func (r *PostgresRepo) GetCommunicationsNodeEmailThread(companyID, nodeID, emailThreadID string) (domain.CommunicationsNodeEmailThread, error) {
	companyID, nodeID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(nodeID), cleanUUIDText(emailThreadID)
	if companyID == "" || nodeID == "" || emailThreadID == "" {
		return domain.CommunicationsNodeEmailThread{}, ErrInvalid
	}
	ctx := context.Background()
	var item domain.CommunicationsNodeEmailThread
	var createdBy sql.NullString
	err := r.db.QueryRowContext(ctx, `
select company_id::text, node_id::text, information_id::text, email_thread_id::text,
       selected_provider_message_id, created_by_user_id::text, created_timestamp
from communications_node_email_threads
where company_id=$1::uuid and node_id=$2::uuid and email_thread_id=$3::uuid`,
		companyID, nodeID, emailThreadID).Scan(
		&item.CompanyID, &item.NodeID, &item.InformationID, &item.EmailThreadID,
		&item.SelectedMessageID, &createdBy, &item.CreatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsNodeEmailThread{}, ErrNotFound
	}
	if err != nil {
		return domain.CommunicationsNodeEmailThread{}, err
	}
	if createdBy.Valid {
		item.CreatedByUserID = createdBy.String
	}
	item.Thread, err = postgresCommunicationsEmailThreadByID(ctx, r.db, companyID, emailThreadID)
	return item, err
}

func linkPostgresCommunicationsEmailThreadToNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, informationID, emailThreadID, selectedMessageID, actorUserID string) error {
	_, err := tx.ExecContext(ctx, `
insert into communications_node_email_threads (
  company_id, node_id, information_id, email_thread_id,
  selected_provider_message_id, created_by_user_id, created_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, nullif($6, '')::uuid, now())
on conflict (company_id, node_id, email_thread_id)
do update set
  information_id=excluded.information_id,
  selected_provider_message_id=excluded.selected_provider_message_id`,
		companyID, nodeID, informationID, emailThreadID, selectedMessageID, actorUserID)
	return err
}

func (r *PostgresRepo) ImportCommunicationsEmailIntoNode(input CommunicationsNodeEmailImportInput) (CommunicationsNodeEmailImportResult, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.NodeID = cleanUUIDText(input.NodeID)
	input.CreatedByUserID = cleanUUIDText(input.CreatedByUserID)
	input.InformationID = cleanUUIDText(input.InformationID)
	if input.CompanyID == "" || input.NodeID == "" || input.CreatedByUserID == "" {
		return CommunicationsNodeEmailImportResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsNodeEmailImportResult{}, err
	}
	defer tx.Rollback()
	var nodeExists bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)`, input.CompanyID, input.NodeID).Scan(&nodeExists); err != nil {
		return CommunicationsNodeEmailImportResult{}, err
	}
	if !nodeExists {
		return CommunicationsNodeEmailImportResult{}, ErrNotFound
	}
	thread, err := upsertPostgresCommunicationsEmailThreadTx(ctx, tx, input.Thread)
	if err != nil {
		return CommunicationsNodeEmailImportResult{}, err
	}
	if input.InformationID == "" {
		input.InformationID = newUUIDv7String()
	}
	selected := thread.Messages[0].Message
	for _, item := range thread.Messages {
		if item.ProviderMessageID == input.Thread.SelectedMessageID {
			selected = item.Message
			break
		}
	}
	now := time.Now().UTC()
	information := attachedEmailProjectionInformationWithThread(selected, input.Thread.SharedInboxID, input.Thread.AccountEmail, thread.EmailThreadID, now, false)
	if _, err := tx.ExecContext(ctx, `
insert into node_information (company_id, information_id, node_id, type, information, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, 'Attached email'::information_type, $4, $5, $5)`,
		input.CompanyID, input.InformationID, input.NodeID, information, now); err != nil {
		return CommunicationsNodeEmailImportResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
insert into node_projection_table (company_id, node_id, information_id, type, information, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, 'Attached email'::information_type, $4, $5, $5)
on conflict (company_id, node_id, information_id)
do update set type=excluded.type, information=excluded.information, is_deleted=false,
              revision=node_projection_table.revision+1, updated_timestamp=excluded.updated_timestamp`,
		input.CompanyID, input.NodeID, input.InformationID, information, now); err != nil {
		return CommunicationsNodeEmailImportResult{}, err
	}
	if err := linkPostgresCommunicationsEmailThreadToNodeTx(ctx, tx, input.CompanyID, input.NodeID, input.InformationID, thread.EmailThreadID, selected.ID, input.CreatedByUserID); err != nil {
		return CommunicationsNodeEmailImportResult{}, err
	}
	if downloadScope, requestedMessageID, ok := communicationsEmailThreadDownloadRequest(thread, input.Thread); ok {
		if _, _, err := ensurePostgresCommunicationsEmailThreadDownloadJobTx(ctx, tx, input.CompanyID, thread.EmailThreadID, downloadScope, requestedMessageID, input.Thread.RequestedByUserID); err != nil {
			return CommunicationsNodeEmailImportResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsNodeEmailImportResult{}, err
	}
	return CommunicationsNodeEmailImportResult{InformationID: input.InformationID, EmailThread: thread}, nil
}
