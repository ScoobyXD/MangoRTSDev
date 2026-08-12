package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

type communicationsEmailThreadRowScanner interface {
	Scan(dest ...any) error
}

type communicationsEmailMessageRowScanner interface {
	Scan(dest ...any) error
}

const postgresCommunicationsEmailThreadColumns = `
t.company_id::text,
t.email_thread_id::text,
t.email_connection_id::text,
connection.connection_type,
coalesce(connection.personal_user_id::text, ''),
case when connection.connection_type='personal' then connection.account_email else '' end,
coalesce(inbox.shared_inbox_id::text, ''),
connection.account_email,
connection.provider,
t.provider_thread_id,
t.root_provider_message_id,
t.download_status,
t.history_complete,
t.fetched_timestamp,
t.last_download_error,
t.created_timestamp,
t.updated_timestamp`

const postgresCommunicationsEmailThreadJoins = `
join email_connections connection
  on connection.company_id=t.company_id
 and connection.email_connection_id=t.email_connection_id
left join lateral (
  select shared_inbox_id
  from shared_inboxes
  where company_id=t.company_id
    and company_email_connection_id=t.email_connection_id
  order by shared_inbox_id
  limit 1
) inbox on true`

const postgresCommunicationsEmailMessageColumns = `
message.company_id::text, message.email_message_id::text, message.email_thread_id::text,
message.provider_message_id, message.message_order, message.subject,
message.sender_snapshot::text, message.to_snapshot::text, message.cc_snapshot::text,
message.bcc_snapshot::text, message.reply_to_snapshot::text,
coalesce(extract(epoch from message.message_timestamp)::bigint, 0),
message.rich_html_body, message.text_fallback, message.snippet, message.unread, message.starred,
message.folder_snapshot::text, message.folder_id_snapshot::text, message.attachment_metadata::text,
message.download_complete, message.created_timestamp, message.updated_timestamp`

func scanPostgresCommunicationsEmailThread(row communicationsEmailThreadRowScanner) (domain.CommunicationsEmailThread, error) {
	var item domain.CommunicationsEmailThread
	var fetchedAt sql.NullTime
	err := row.Scan(
		&item.CompanyID, &item.EmailThreadID, &item.EmailConnectionID, &item.ScopeType,
		&item.PersonalUserID, &item.PersonalAccountEmail, &item.SharedInboxID,
		&item.AccountEmail, &item.Provider, &item.ProviderThreadID, &item.RootProviderMessageID,
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

func scanPostgresCommunicationsEmailMessage(row communicationsEmailMessageRowScanner) (domain.CommunicationsEmailMessage, error) {
	var item domain.CommunicationsEmailMessage
	var fromJSON, toJSON, ccJSON, bccJSON, replyToJSON string
	var foldersJSON, folderIDsJSON, attachmentsJSON string
	var textFallback string
	err := row.Scan(
		&item.CompanyID, &item.EmailMessageID, &item.EmailThreadID,
		&item.ProviderMessageID, &item.MessageOrder,
		&item.Message.Subject, &fromJSON, &toJSON, &ccJSON, &bccJSON,
		&replyToJSON, &item.Message.Date, &item.Message.Body, &textFallback,
		&item.Message.Snippet, &item.Message.Unread, &item.Message.Starred,
		&foldersJSON, &folderIDsJSON, &attachmentsJSON, &item.Message.DownloadComplete,
		&item.CreatedTimestamp, &item.UpdatedTimestamp,
	)
	if err != nil {
		return domain.CommunicationsEmailMessage{}, err
	}
	item.Message.ID = item.ProviderMessageID
	item.Message.EmailMessageID = item.EmailMessageID
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
			return domain.CommunicationsEmailMessage{}, err
		}
	}
	return item, nil
}

func postgresCommunicationsEmailThreadMessages(ctx context.Context, db interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, companyID, emailThreadID string) ([]domain.CommunicationsEmailMessage, error) {
	rows, err := db.QueryContext(ctx, `
select `+postgresCommunicationsEmailMessageColumns+`
from email_messages message
where message.company_id=$1::uuid and message.email_thread_id=$2::uuid
order by message.message_order, message.provider_message_id`, companyID, emailThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.CommunicationsEmailMessage{}
	for rows.Next() {
		item, err := scanPostgresCommunicationsEmailMessage(rows)
		if err != nil {
			return nil, err
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
from email_threads t
`+postgresCommunicationsEmailThreadJoins+`
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
	for index := range item.Messages {
		item.Messages[index].ProviderThreadID = item.ProviderThreadID
		item.Messages[index].Message.ThreadID = item.ProviderThreadID
	}
	return communicationsEmailThreadForMessages(item), nil
}

func postgresEmailThreadConnectionTx(ctx context.Context, tx *sql.Tx, input CommunicationsEmailThreadUpsertInput, scope communicationsEmailCollaborationScope) (string, string, error) {
	var connectionID, provider string
	var err error
	if scope.scopeType == CommunicationsEmailCollaborationScopePersonal {
		err = tx.QueryRowContext(ctx, `select email_connection_id::text,provider
from email_connections
where company_id=$1::uuid and connection_type='personal'
  and personal_user_id=$2::uuid and account_email=$3`,
			input.CompanyID, scope.personalUserID, scope.personalAccountEmail).Scan(&connectionID, &provider)
	} else {
		err = tx.QueryRowContext(ctx, `select connection.email_connection_id::text,connection.provider
from shared_inboxes inbox
join email_connections connection
  on connection.company_id=inbox.company_id
 and connection.email_connection_id=inbox.company_email_connection_id
where inbox.company_id=$1::uuid and inbox.shared_inbox_id=$2::uuid and connection.account_email=$3`,
			input.CompanyID, scope.sharedInboxID, scope.accountEmail).Scan(&connectionID, &provider)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrInvalid
	}
	if err != nil {
		return "", "", err
	}
	if provider != "google" && provider != "microsoft" {
		return "", "", ErrInvalid
	}
	if input.Provider != "" && input.Provider != provider {
		return "", "", ErrInvalid
	}
	return connectionID, provider, nil
}

func upsertPostgresCommunicationsEmailThreadTx(ctx context.Context, tx *sql.Tx, input CommunicationsEmailThreadUpsertInput) (domain.CommunicationsEmailThread, error) {
	input, scope, err := normalizeCommunicationsEmailThreadInput(input)
	if err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	connectionID, _, err := postgresEmailThreadConnectionTx(ctx, tx, input, scope)
	if err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	providerKey := communicationsEmailThreadProviderKey(input.ProviderThreadID, input.SelectedMessageID)
	lockKey := strings.Join([]string{input.CompanyID, connectionID, providerKey}, "\x1f")
	if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	var emailThreadID, existingProviderThreadID string
	messageLockKey := strings.Join([]string{input.CompanyID, connectionID, communicationsEmailThreadProviderKey("", input.SelectedMessageID)}, "\x1f")
	if messageLockKey != lockKey {
		if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, messageLockKey); err != nil {
			return domain.CommunicationsEmailThread{}, err
		}
	}
	err = tx.QueryRowContext(ctx, `
select t.email_thread_id::text, t.provider_thread_id
from email_threads t
where company_id=$1::uuid and email_connection_id=$2::uuid
  and (provider_thread_key=$3 or (root_provider_message_id=$4 and $4<>'')
       or exists (
         select 1 from email_messages m
         where m.company_id=t.company_id and m.email_thread_id=t.email_thread_id and m.provider_message_id=$4
       ))
order by case when provider_thread_key=$3 then 0 else 1 end
limit 1
for update`, input.CompanyID, connectionID, providerKey, input.SelectedMessageID).Scan(&emailThreadID, &existingProviderThreadID)
	if errors.Is(err, sql.ErrNoRows) {
		if !communicationsEmailThreadInputContainsSelectedMessage(input) {
			return domain.CommunicationsEmailThread{}, ErrInvalid
		}
		emailThreadID = newUUIDv7String()
		_, err = tx.ExecContext(ctx, `
insert into email_threads (
  company_id, email_thread_id, email_connection_id, provider_thread_key, provider_thread_id,
  root_provider_message_id, download_status, history_complete, fetched_timestamp,
  last_download_error, created_timestamp, updated_timestamp
) values (
  $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
  case when $7 then 'complete' else 'partial' end, $7, $8, $9, now(), now()
)`, input.CompanyID, emailThreadID, connectionID, providerKey, input.ProviderThreadID,
			input.SelectedMessageID, input.HistoryComplete, input.FetchedAt, input.LastDownloadError)
	}
	if err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	if existingProviderThreadID != "" && input.ProviderThreadID != "" && existingProviderThreadID != input.ProviderThreadID {
		return domain.CommunicationsEmailThread{}, ErrInvalid
	}
	if _, err := tx.ExecContext(ctx, `
update email_threads
set provider_thread_key=case when provider_thread_id='' and $3<>'' then $7 else provider_thread_key end,
    provider_thread_id=case when provider_thread_id='' then $3 else provider_thread_id end,
    history_complete=history_complete or $4,
    download_status=case when $4 then 'complete' else download_status end,
    fetched_timestamp=greatest(coalesce(fetched_timestamp, $5), $5),
    last_download_error=case when $4 then '' else $6 end,
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
insert into email_messages (
  company_id, email_message_id, email_thread_id, provider_message_id,
  message_order, subject, sender_snapshot, to_snapshot, cc_snapshot, bcc_snapshot,
  reply_to_snapshot, message_timestamp, rich_html_body, text_fallback, snippet,
  unread, starred, folder_snapshot, folder_id_snapshot, attachment_metadata,
  download_complete, created_timestamp, updated_timestamp
) values (
  $1::uuid, $2::uuid, $3::uuid, $4, 0, $5, $6::jsonb, $7::jsonb, $8::jsonb,
  $9::jsonb, $10::jsonb, to_timestamp(nullif($11, 0)), $12, $13, $13, $14, $15,
  $16::jsonb, $17::jsonb, $18::jsonb, $19, now(), now()
)
on conflict (company_id, email_thread_id, provider_message_id)
do update set
  subject=case when excluded.subject<>'' then excluded.subject else email_messages.subject end,
  sender_snapshot=case when jsonb_array_length(excluded.sender_snapshot)>0 then excluded.sender_snapshot else email_messages.sender_snapshot end,
  to_snapshot=case when jsonb_array_length(excluded.to_snapshot)>0 then excluded.to_snapshot else email_messages.to_snapshot end,
  cc_snapshot=case when jsonb_array_length(excluded.cc_snapshot)>0 then excluded.cc_snapshot else email_messages.cc_snapshot end,
  bcc_snapshot=case when jsonb_array_length(excluded.bcc_snapshot)>0 then excluded.bcc_snapshot else email_messages.bcc_snapshot end,
  reply_to_snapshot=case when jsonb_array_length(excluded.reply_to_snapshot)>0 then excluded.reply_to_snapshot else email_messages.reply_to_snapshot end,
  message_timestamp=coalesce(excluded.message_timestamp, email_messages.message_timestamp),
  rich_html_body=case when excluded.rich_html_body<>'' then excluded.rich_html_body else email_messages.rich_html_body end,
  text_fallback=case when excluded.text_fallback<>'' then excluded.text_fallback else email_messages.text_fallback end,
  snippet=case when excluded.snippet<>'' then excluded.snippet else email_messages.snippet end,
  unread=excluded.unread,
  starred=excluded.starred,
  folder_snapshot=case when jsonb_array_length(excluded.folder_snapshot)>0 then excluded.folder_snapshot else email_messages.folder_snapshot end,
  folder_id_snapshot=case when jsonb_array_length(excluded.folder_id_snapshot)>0 then excluded.folder_id_snapshot else email_messages.folder_id_snapshot end,
  attachment_metadata=case when jsonb_array_length(excluded.attachment_metadata)>0 then excluded.attachment_metadata else email_messages.attachment_metadata end,
  download_complete=email_messages.download_complete or excluded.download_complete,
  updated_timestamp=now()`,
			input.CompanyID, newUUIDv7String(), emailThreadID, message.ID,
			message.Subject, fromJSON, toJSON, ccJSON, bccJSON, replyToJSON,
			message.Date, message.Body, message.Snippet, message.Unread, message.Starred,
			foldersJSON, folderIDsJSON, attachmentsJSON, message.DownloadComplete); err != nil {
			return domain.CommunicationsEmailThread{}, err
		}
		if message.DownloadComplete {
			if _, err := tx.ExecContext(ctx, `
insert into email_relationships (
  company_id,email_relationship_id,email_thread_id,email_message_id,
  resource_type,resource_id,resource_textbox_id,created_timestamp
)
select target.company_id,gen_random_uuid(),target.email_thread_id,target.email_message_id,
       'node',destination.resource_id,null,now()
from email_messages target
cross join (
  select distinct resource_id
  from email_relationships
  where company_id=$1::uuid and email_thread_id=$2::uuid
    and resource_type='node' and resource_textbox_id is null
) destination
where target.company_id=$1::uuid and target.email_thread_id=$2::uuid
  and target.provider_message_id=$3 and target.download_complete
on conflict do nothing`, input.CompanyID, emailThreadID, message.ID); err != nil {
				return domain.CommunicationsEmailThread{}, err
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `
with ordered as (
  select email_message_id,
         row_number() over (order by message_timestamp, provider_message_id)-1 as next_order
  from email_messages
  where company_id=$1::uuid and email_thread_id=$2::uuid
)
update email_messages target
set message_order=ordered.next_order
from ordered
where target.company_id=$1::uuid and target.email_message_id=ordered.email_message_id`, input.CompanyID, emailThreadID); err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	return postgresCommunicationsEmailThreadByID(ctx, tx, input.CompanyID, emailThreadID)
}

func (r *PostgresRepo) UpsertCommunicationsEmailThread(input CommunicationsEmailThreadUpsertInput) (domain.CommunicationsEmailThread, error) {
	return r.UpsertCommunicationsEmailThreadContext(context.Background(), input)
}

func (r *PostgresRepo) UpsertCommunicationsEmailThreadContext(ctx context.Context, input CommunicationsEmailThreadUpsertInput) (domain.CommunicationsEmailThread, error) {
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
	return r.GetCommunicationsEmailThreadContext(context.Background(), companyID, emailThreadID)
}

func (r *PostgresRepo) GetCommunicationsEmailThreadContext(ctx context.Context, companyID, emailThreadID string) (domain.CommunicationsEmailThread, error) {
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	if companyID == "" || emailThreadID == "" {
		return domain.CommunicationsEmailThread{}, ErrInvalid
	}
	return postgresCommunicationsEmailThreadByID(ctx, r.db, companyID, emailThreadID)
}

func (r *PostgresRepo) ListCommunicationsEmailThreadsForAccount(input CommunicationsEmailAccountReadInput) ([]domain.CommunicationsEmailThread, error) {
	input, scope, err := normalizeCommunicationsEmailAccountReadInput(input)
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	var connectionID string
	if scope.scopeType == CommunicationsEmailCollaborationScopePersonal {
		err = r.db.QueryRowContext(ctx, `select email_connection_id::text from email_connections
where company_id=$1::uuid and connection_type='personal'
  and personal_user_id=$2::uuid and account_email=$3 and provider=$4`,
			input.CompanyID, scope.personalUserID, scope.personalAccountEmail, input.Provider).Scan(&connectionID)
	} else {
		err = r.db.QueryRowContext(ctx, `select connection.email_connection_id::text
from shared_inboxes inbox
join email_connections connection on connection.company_id=inbox.company_id
 and connection.email_connection_id=inbox.company_email_connection_id
where inbox.company_id=$1::uuid and inbox.shared_inbox_id=$2::uuid
  and connection.account_email=$3 and connection.provider=$4`,
			input.CompanyID, scope.sharedInboxID, scope.accountEmail, input.Provider).Scan(&connectionID)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	rows, err := r.db.QueryContext(ctx, `
select `+postgresCommunicationsEmailThreadColumns+`
from email_threads t
`+postgresCommunicationsEmailThreadJoins+`
where t.company_id=$1::uuid and t.email_connection_id=$2::uuid
order by t.updated_timestamp desc,t.email_thread_id`, input.CompanyID, connectionID)
	if err != nil {
		return nil, err
	}
	items := []domain.CommunicationsEmailThread{}
	for rows.Next() {
		item, scanErr := scanPostgresCommunicationsEmailThread(rows)
		if scanErr != nil {
			rows.Close()
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range items {
		items[index].Messages, err = postgresCommunicationsEmailThreadMessages(ctx, r.db, input.CompanyID, items[index].EmailThreadID)
		if err != nil {
			return nil, err
		}
		for messageIndex := range items[index].Messages {
			items[index].Messages[messageIndex].ProviderThreadID = items[index].ProviderThreadID
			items[index].Messages[messageIndex].Message.ThreadID = items[index].ProviderThreadID
		}
		items[index] = communicationsEmailThreadForMessages(items[index])
	}
	return items, nil
}

func (r *PostgresRepo) ListCommunicationsEmailMessagesForAccount(input CommunicationsEmailAccountReadInput) ([]domain.CommunicationsEmailMessage, error) {
	input, scope, err := normalizeCommunicationsEmailAccountReadInput(input)
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	var connectionID string
	if scope.scopeType == CommunicationsEmailCollaborationScopePersonal {
		err = r.db.QueryRowContext(ctx, `select email_connection_id::text from email_connections
where company_id=$1::uuid and connection_type='personal'
  and personal_user_id=$2::uuid and account_email=$3 and provider=$4`,
			input.CompanyID, scope.personalUserID, scope.personalAccountEmail, input.Provider).Scan(&connectionID)
	} else {
		err = r.db.QueryRowContext(ctx, `select connection.email_connection_id::text
from shared_inboxes inbox
join email_connections connection on connection.company_id=inbox.company_id
 and connection.email_connection_id=inbox.company_email_connection_id
where inbox.company_id=$1::uuid and inbox.shared_inbox_id=$2::uuid
  and connection.account_email=$3 and connection.provider=$4`,
			input.CompanyID, scope.sharedInboxID, scope.accountEmail, input.Provider).Scan(&connectionID)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	rows, err := r.db.QueryContext(ctx, `
select message.company_id::text, message.email_message_id::text, message.email_thread_id::text,
       thread.provider_thread_id, message.provider_message_id, message.message_order, message.subject,
       message.sender_snapshot::text, message.to_snapshot::text, message.cc_snapshot::text,
       message.bcc_snapshot::text, message.reply_to_snapshot::text,
       coalesce(extract(epoch from message.message_timestamp)::bigint, 0),
       message.rich_html_body, message.text_fallback, message.snippet, message.unread, message.starred,
       message.folder_snapshot::text, message.folder_id_snapshot::text, message.attachment_metadata::text,
       message.download_complete, message.created_timestamp, message.updated_timestamp
from email_messages message
join email_threads thread
  on thread.company_id=message.company_id
 and thread.email_thread_id=message.email_thread_id
where thread.company_id=$1::uuid and thread.email_connection_id=$2::uuid
order by message.message_timestamp desc nulls last, message.provider_message_id`, input.CompanyID, connectionID)
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
			&item.CompanyID, &item.EmailMessageID, &item.EmailThreadID, &item.ProviderThreadID,
			&item.ProviderMessageID, &item.MessageOrder,
			&item.Message.Subject, &fromJSON, &toJSON, &ccJSON, &bccJSON,
			&replyToJSON, &item.Message.Date, &item.Message.Body, &textFallback,
			&item.Message.Snippet, &item.Message.Unread, &item.Message.Starred,
			&foldersJSON, &folderIDsJSON, &attachmentsJSON, &item.Message.DownloadComplete,
			&item.CreatedTimestamp, &item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		item.Message.ID = item.ProviderMessageID
		item.Message.EmailMessageID = item.EmailMessageID
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

func (r *PostgresRepo) GetCommunicationsEmailMessageForScope(input CommunicationsEmailMessageLookupInput) (CommunicationsEmailMessageLookupResult, error) {
	input, scope, err := normalizeCommunicationsEmailMessageLookupInput(input)
	if err != nil {
		return CommunicationsEmailMessageLookupResult{}, err
	}
	ctx := context.Background()
	var emailThreadID string
	err = r.db.QueryRowContext(ctx, `
select thread.email_thread_id::text
from email_messages message
join email_threads thread
  on thread.company_id=message.company_id
 and thread.email_thread_id=message.email_thread_id
join email_connections connection
  on connection.company_id=thread.company_id
 and connection.email_connection_id=thread.email_connection_id
left join shared_inboxes inbox
  on inbox.company_id=connection.company_id
 and inbox.company_email_connection_id=connection.email_connection_id
where message.company_id=$1::uuid
  and message.provider_message_id=$6
  and connection.connection_type=$2
  and (($2='personal' and connection.personal_user_id=nullif($3,'')::uuid and connection.account_email=$4)
    or ($2='shared' and inbox.shared_inbox_id=nullif($5,'')::uuid))
order by thread.email_thread_id
limit 1`, input.CompanyID, scope.scopeType, scope.personalUserID, scope.personalAccountEmail, scope.sharedInboxID, input.ProviderMessageID).Scan(&emailThreadID)
	if errors.Is(err, sql.ErrNoRows) {
		return CommunicationsEmailMessageLookupResult{}, ErrNotFound
	}
	if err != nil {
		return CommunicationsEmailMessageLookupResult{}, err
	}
	thread, err := postgresCommunicationsEmailThreadByID(ctx, r.db, input.CompanyID, emailThreadID)
	if err != nil {
		return CommunicationsEmailMessageLookupResult{}, err
	}
	for _, message := range thread.Messages {
		if message.ProviderMessageID == input.ProviderMessageID {
			return CommunicationsEmailMessageLookupResult{Message: message.Message, Provider: thread.Provider, Thread: thread}, nil
		}
	}
	return CommunicationsEmailMessageLookupResult{}, ErrNotFound
}

func (r *PostgresRepo) GetCommunicationsNodeEmailThread(companyID, nodeID, emailThreadID string) (domain.CommunicationsNodeEmailThread, error) {
	companyID, nodeID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(nodeID), cleanUUIDText(emailThreadID)
	if companyID == "" || nodeID == "" || emailThreadID == "" {
		return domain.CommunicationsNodeEmailThread{}, ErrInvalid
	}
	ctx := context.Background()
	var item domain.CommunicationsNodeEmailThread
	err := r.db.QueryRowContext(ctx, `
select relationship.company_id::text,
       relationship.resource_id::text,
       relationship.email_relationship_id::text,
       relationship.email_thread_id::text,
       relationship.email_message_id::text,
       relationship.created_timestamp
from email_relationships relationship
join email_messages message
  on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id
 and message.email_message_id=relationship.email_message_id
where relationship.company_id=$1::uuid
  and relationship.resource_type='node'
  and relationship.resource_id=$2::uuid
  and relationship.email_thread_id=$3::uuid
order by relationship.resource_textbox_id nulls first,
         relationship.created_timestamp,
         relationship.email_relationship_id
limit 1`, companyID, nodeID, emailThreadID).Scan(
		&item.CompanyID, &item.NodeID, &item.InformationID, &item.EmailThreadID,
		&item.SelectedMessageID, &item.CreatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsNodeEmailThread{}, ErrNotFound
	}
	if err != nil {
		return domain.CommunicationsNodeEmailThread{}, err
	}
	item.Thread, err = postgresCommunicationsEmailThreadByID(ctx, r.db, companyID, emailThreadID)
	return item, err
}

func (r *PostgresRepo) GetCommunicationsNodeEmailMessage(companyID, nodeID, emailThreadID, emailMessageID string) (domain.CommunicationsNodeEmailThread, error) {
	companyID, nodeID, emailThreadID, emailMessageID = cleanUUIDText(companyID), cleanUUIDText(nodeID), cleanUUIDText(emailThreadID), cleanUUIDText(emailMessageID)
	if companyID == "" || nodeID == "" || emailThreadID == "" || emailMessageID == "" {
		return domain.CommunicationsNodeEmailThread{}, ErrInvalid
	}
	ctx := context.Background()
	var item domain.CommunicationsNodeEmailThread
	err := r.db.QueryRowContext(ctx, `
select relationship.company_id::text,
       relationship.resource_id::text,
       relationship.email_relationship_id::text,
       relationship.email_thread_id::text,
       relationship.email_message_id::text,
       relationship.created_timestamp
from email_relationships relationship
where relationship.company_id=$1::uuid
  and relationship.resource_type='node'
  and relationship.resource_id=$2::uuid
  and relationship.email_thread_id=$3::uuid
order by relationship.resource_textbox_id nulls first,
         relationship.created_timestamp,
         relationship.email_relationship_id
limit 1`, companyID, nodeID, emailThreadID).Scan(
		&item.CompanyID, &item.NodeID, &item.InformationID, &item.EmailThreadID,
		&item.SelectedMessageID, &item.CreatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsNodeEmailThread{}, ErrNotFound
	}
	if err != nil {
		return domain.CommunicationsNodeEmailThread{}, err
	}
	item.Thread, err = scanPostgresCommunicationsEmailThread(r.db.QueryRowContext(ctx, `
select `+postgresCommunicationsEmailThreadColumns+`
from email_threads t
`+postgresCommunicationsEmailThreadJoins+`
where t.company_id=$1::uuid and t.email_thread_id=$2::uuid`, companyID, emailThreadID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsNodeEmailThread{}, ErrNotFound
	}
	if err != nil {
		return domain.CommunicationsNodeEmailThread{}, err
	}
	message, err := scanPostgresCommunicationsEmailMessage(r.db.QueryRowContext(ctx, `
select `+postgresCommunicationsEmailMessageColumns+`
from email_messages message
where message.company_id=$1::uuid
  and message.email_thread_id=$2::uuid
  and message.email_message_id=$3::uuid`, companyID, emailThreadID, emailMessageID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsNodeEmailThread{}, ErrNotFound
	}
	if err != nil {
		return domain.CommunicationsNodeEmailThread{}, err
	}
	message.ProviderThreadID = item.Thread.ProviderThreadID
	message.Message.ThreadID = item.Thread.ProviderThreadID
	item.Thread.Messages = []domain.CommunicationsEmailMessage{message}
	return item, nil
}

func linkPostgresCommunicationsEmailThreadToNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, relationshipID, emailThreadID, selectedMessageID, _ string) error {
	if _, err := tx.ExecContext(ctx, `
select pg_advisory_xact_lock(
  hashtextextended($1::text || ':' || $2::text, 0)
)`, companyID, emailThreadID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
insert into email_relationships (
  company_id, email_relationship_id, email_thread_id, email_message_id,
  resource_type, resource_id, resource_textbox_id, created_timestamp
)
select $1::uuid,
       case when message.provider_message_id=$5 then $3::uuid else gen_random_uuid() end,
       $4::uuid, message.email_message_id,
       'node', $2::uuid, null, now()
from email_messages message
where message.company_id=$1::uuid
  and message.email_thread_id=$4::uuid
on conflict do nothing`, companyID, nodeID, relationshipID, emailThreadID, selectedMessageID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected > 0 {
		return nil
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, `
select exists (
  select 1
  from email_relationships relationship
  join email_messages message
    on message.company_id=relationship.company_id
   and message.email_thread_id=relationship.email_thread_id
   and message.email_message_id=relationship.email_message_id
  where relationship.company_id=$1::uuid
    and relationship.email_thread_id=$3::uuid
    and relationship.resource_type='node'
    and relationship.resource_id=$2::uuid
    and relationship.resource_textbox_id is null
    and message.provider_message_id=$4
)`, companyID, nodeID, emailThreadID, selectedMessageID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
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
	selectedProviderMessageID := strings.TrimSpace(input.Thread.SelectedMessageID)
	if selectedProviderMessageID == "" && len(thread.Messages) > 0 {
		selectedProviderMessageID = thread.Messages[0].ProviderMessageID
	}
	if err := linkPostgresCommunicationsEmailThreadToNodeTx(ctx, tx, input.CompanyID, input.NodeID, input.InformationID, thread.EmailThreadID, selectedProviderMessageID, input.CreatedByUserID); err != nil {
		return CommunicationsNodeEmailImportResult{}, err
	}
	if err := tx.QueryRowContext(ctx, `
select relationship.email_relationship_id::text
from email_relationships relationship
join email_messages message
  on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id
 and message.email_message_id=relationship.email_message_id
where relationship.company_id=$1::uuid
  and relationship.email_thread_id=$3::uuid
  and relationship.resource_type='node'
  and relationship.resource_id=$2::uuid
  and relationship.resource_textbox_id is null
  and message.provider_message_id=$4`,
		input.CompanyID, input.NodeID, thread.EmailThreadID, selectedProviderMessageID).Scan(&input.InformationID); err != nil {
		return CommunicationsNodeEmailImportResult{}, err
	}
	if requestedMessageID, sourceID, ok := communicationsEmailIngestionRequest(thread, input.Thread); ok {
		if _, _, err := ensurePostgresCommunicationsEmailIngestionJobTx(ctx, tx, CommunicationsEmailIngestionJobInput{
			CompanyID: input.CompanyID, EmailConnectionID: thread.EmailConnectionID, EmailThreadID: thread.EmailThreadID,
			ProviderMessageID: requestedMessageID, ProviderThreadID: thread.ProviderThreadID, Priority: CommunicationsEmailIngestionPriorityVisible,
			EnqueueSourceID: sourceID,
		}); err != nil {
			return CommunicationsNodeEmailImportResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsNodeEmailImportResult{}, err
	}
	return CommunicationsNodeEmailImportResult{InformationID: input.InformationID, EmailThread: thread}, nil
}
