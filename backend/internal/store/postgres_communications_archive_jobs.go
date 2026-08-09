package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

const communicationsArchiveJobItemSelectColumns = `item.job_item_id::text,
item.archive_job_id::text,
job.actor_user_id::text,
coalesce(job.company_id::text, ''),
coalesce(job.shared_inbox_id::text, ''),
job.connection_scope,
job.provider,
job.account_email,
job.grant_id,
coalesce(job.company_email_connection_id::text, ''),
item.message_id,
item.status,
item.provider_attempt_count,
coalesce(item.attempt_token::text, ''),
item.last_error,
item.archived_timestamp,
item.failed_timestamp,
item.created_timestamp,
item.updated_timestamp`

func (r *PostgresRepo) CreateCommunicationsArchiveJobContext(ctx context.Context, input CommunicationsArchiveJobInput) (CommunicationsArchiveJob, error) {
	input, err := NormalizeCommunicationsArchiveJobInput(input)
	if err != nil {
		return CommunicationsArchiveJob{}, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsArchiveJob{}, err
	}
	defer tx.Rollback()

	identityKey := strings.Join([]string{
		input.ActorUserID,
		input.CompanyID,
		input.SharedInboxID,
		input.Connection.Scope,
		input.Connection.AccountEmail,
	}, "\x1f")
	if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, "communications_archive_job", identityKey); err != nil {
		return CommunicationsArchiveJob{}, err
	}

	jobID := newUUIDv7String()
	now := time.Now().UTC()
	job := CommunicationsArchiveJob{
		JobID:                    jobID,
		ActorUserID:              input.ActorUserID,
		CompanyID:                input.CompanyID,
		SharedInboxID:            input.SharedInboxID,
		ConnectionScope:          input.Connection.Scope,
		Provider:                 input.Connection.Provider,
		AccountEmail:             input.Connection.AccountEmail,
		GrantID:                  input.Connection.GrantID,
		CompanyEmailConnectionID: input.Connection.CompanyEmailConnectionID,
		Status:                   CommunicationsArchiveJobStatusPending,
		RequestedCount:           len(input.MessageIDs),
		AcceptedMessageIDs:       append([]string(nil), input.MessageIDs...),
		CreatedTimestamp:         now,
		UpdatedTimestamp:         now,
	}
	var existingCompletedAt sql.NullTime
	err = tx.QueryRowContext(ctx, `
select archive_job_id::text,actor_user_id::text,coalesce(company_id::text,''),
       coalesce(shared_inbox_id::text,''),connection_scope,provider,account_email,grant_id,
       coalesce(company_email_connection_id::text,''),status,requested_count,
       created_timestamp,updated_timestamp,completed_timestamp
from communications_email_archive_jobs
where actor_user_id=$1::uuid
  and coalesce(company_id::text,'')=$2
  and coalesce(shared_inbox_id::text,'')=$3
  and connection_scope=$4
  and account_email=$5
  and status='pending'
order by created_timestamp,archive_job_id
limit 1`, input.ActorUserID, input.CompanyID, input.SharedInboxID, input.Connection.Scope, input.Connection.AccountEmail).Scan(
		&job.JobID, &job.ActorUserID, &job.CompanyID, &job.SharedInboxID, &job.ConnectionScope,
		&job.Provider, &job.AccountEmail, &job.GrantID, &job.CompanyEmailConnectionID,
		&job.Status, &job.RequestedCount, &job.CreatedTimestamp, &job.UpdatedTimestamp, &existingCompletedAt,
	)
	reusedJob := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CommunicationsArchiveJob{}, err
	}
	job.RequestedCount = len(input.MessageIDs)
	job.AcceptedMessageIDs = append([]string(nil), input.MessageIDs...)
	job.UpdatedTimestamp = now
	if reusedJob {
		if _, err := tx.ExecContext(ctx, `update communications_email_archive_jobs
set requested_count=$2,updated_timestamp=$3
where archive_job_id=$1::uuid`, job.JobID, job.RequestedCount, now); err != nil {
			return CommunicationsArchiveJob{}, err
		}
	} else if _, err := tx.ExecContext(ctx, `
insert into communications_email_archive_jobs (
  archive_job_id,
  actor_user_id,
  company_id,
  shared_inbox_id,
  connection_scope,
  provider,
  account_email,
  grant_id,
  company_email_connection_id,
  status,
  requested_count,
  created_timestamp,
  updated_timestamp
) values (
  $1::uuid,
  $2::uuid,
  nullif($3, '')::uuid,
  nullif($4, '')::uuid,
  $5,
  $6,
  $7,
  $8,
  nullif($9, '')::uuid,
  $10,
  $11,
  $12,
  $12
)`,
		job.JobID,
		job.ActorUserID,
		job.CompanyID,
		job.SharedInboxID,
		job.ConnectionScope,
		job.Provider,
		job.AccountEmail,
		job.GrantID,
		job.CompanyEmailConnectionID,
		job.Status,
		job.RequestedCount,
		now,
	); err != nil {
		return CommunicationsArchiveJob{}, err
	}

	for _, messageID := range input.MessageIDs {
		existing, err := scanCommunicationsArchiveJobItem(tx.QueryRowContext(ctx, `
select `+communicationsArchiveJobItemSelectColumns+`
  from communications_email_archive_job_items item
  join communications_email_archive_jobs job
    on job.archive_job_id = item.archive_job_id
  where job.actor_user_id = $1::uuid
    and coalesce(job.company_id::text, '') = $2
    and coalesce(job.shared_inbox_id::text, '') = $3
    and job.connection_scope = $4
    and job.account_email = $5
    and item.message_id = $6
    and item.status in ('pending', 'processing')
  order by item.created_timestamp,item.job_item_id
  limit 1`,
			job.ActorUserID,
			job.CompanyID,
			job.SharedInboxID,
			job.ConnectionScope,
			job.AccountEmail,
			messageID,
		))
		if err == nil {
			job.Items = append(job.Items, existing)
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return CommunicationsArchiveJob{}, err
		}
		item, err := scanCommunicationsArchiveJobItem(tx.QueryRowContext(ctx, `
with inserted as (
  insert into communications_email_archive_job_items (
    job_item_id,
    archive_job_id,
    message_id,
    status,
    created_timestamp,
    updated_timestamp
  ) values (
    $1::uuid,
    $2::uuid,
    $3,
    'pending',
    $4,
    $4
  )
  returning *
)
select `+communicationsArchiveJobItemSelectColumns+`
from inserted item
join communications_email_archive_jobs job
  on job.archive_job_id = item.archive_job_id`,
			newUUIDv7String(),
			job.JobID,
			messageID,
			now,
		))
		if err != nil {
			return CommunicationsArchiveJob{}, err
		}
		job.Items = append(job.Items, item)
		job.CreatedItemCount++
	}
	if job.CreatedItemCount == 0 && !reusedJob {
		completedAt := now
		job.Status = CommunicationsArchiveJobStatusCompleted
		job.CompletedTimestamp = &completedAt
		if _, err := tx.ExecContext(ctx, `
update communications_email_archive_jobs
set status='completed',
    completed_timestamp=$2,
    updated_timestamp=$2
where archive_job_id=$1::uuid`, job.JobID, now); err != nil {
			return CommunicationsArchiveJob{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsArchiveJob{}, err
	}
	return CloneCommunicationsArchiveJob(job), nil
}

func (r *PostgresRepo) GetCommunicationsArchiveJobItemContext(ctx context.Context, jobItemID string) (CommunicationsArchiveJobItem, error) {
	jobItemID = cleanUUIDText(jobItemID)
	if jobItemID == "" {
		return CommunicationsArchiveJobItem{}, ErrInvalid
	}
	item, err := scanCommunicationsArchiveJobItem(r.db.QueryRowContext(ctx, `select `+communicationsArchiveJobItemSelectColumns+`
from communications_email_archive_job_items item
join communications_email_archive_jobs job on job.archive_job_id=item.archive_job_id
where item.job_item_id=$1::uuid`, jobItemID))
	if errors.Is(err, sql.ErrNoRows) {
		return CommunicationsArchiveJobItem{}, ErrNotFound
	}
	return item, err
}

func (r *PostgresRepo) GetCommunicationsArchiveJobContext(ctx context.Context, jobID string) (CommunicationsArchiveJob, error) {
	jobID = cleanUUIDText(jobID)
	if jobID == "" {
		return CommunicationsArchiveJob{}, ErrInvalid
	}
	var job CommunicationsArchiveJob
	var completedAt sql.NullTime
	err := r.db.QueryRowContext(ctx, `
select archive_job_id::text,actor_user_id::text,coalesce(company_id::text,''),
       coalesce(shared_inbox_id::text,''),connection_scope,provider,account_email,grant_id,
       coalesce(company_email_connection_id::text,''),status,requested_count,
       created_timestamp,updated_timestamp,completed_timestamp
from communications_email_archive_jobs where archive_job_id=$1::uuid`, jobID).Scan(
		&job.JobID, &job.ActorUserID, &job.CompanyID, &job.SharedInboxID, &job.ConnectionScope,
		&job.Provider, &job.AccountEmail, &job.GrantID, &job.CompanyEmailConnectionID,
		&job.Status, &job.RequestedCount, &job.CreatedTimestamp, &job.UpdatedTimestamp, &completedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return CommunicationsArchiveJob{}, ErrNotFound
	}
	if err != nil {
		return CommunicationsArchiveJob{}, err
	}
	if completedAt.Valid {
		value := completedAt.Time
		job.CompletedTimestamp = &value
	}
	job.Items, err = r.ListCommunicationsArchiveJobItemsContext(ctx, jobID)
	if err != nil {
		return CommunicationsArchiveJob{}, err
	}
	job.CreatedItemCount = len(job.Items)
	for _, item := range job.Items {
		job.AcceptedMessageIDs = append(job.AcceptedMessageIDs, item.MessageID)
	}
	return CloneCommunicationsArchiveJob(job), nil
}

func (r *PostgresRepo) StartCommunicationsArchiveJobItemAttemptContext(ctx context.Context, jobItemID string) (CommunicationsArchiveJobItem, bool, error) {
	jobItemID = cleanUUIDText(jobItemID)
	if jobItemID == "" {
		return CommunicationsArchiveJobItem{}, false, ErrInvalid
	}
	attemptToken := newUUIDv7String()
	item, err := scanCommunicationsArchiveJobItem(r.db.QueryRowContext(ctx, `with updated as (
 update communications_email_archive_job_items
 set status='processing',provider_attempt_count=provider_attempt_count+1,attempt_token=$2::uuid,last_error='',updated_timestamp=now()
 where job_item_id=$1::uuid and status in ('pending','processing') and provider_attempt_count<3
 returning *
)
select `+communicationsArchiveJobItemSelectColumns+`
from updated item join communications_email_archive_jobs job on job.archive_job_id=item.archive_job_id`, jobItemID, attemptToken))
	if err == nil {
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommunicationsArchiveJobItem{}, false, err
	}
	item, err = r.GetCommunicationsArchiveJobItemContext(ctx, jobItemID)
	return item, false, err
}

func (r *PostgresRepo) CompleteCommunicationsArchiveJobItemAttemptContext(ctx context.Context, jobItemID, attemptToken string, realtimeInputs []RealtimeOutboxInput) error {
	jobItemID, attemptToken = cleanUUIDText(jobItemID), cleanUUIDText(attemptToken)
	if jobItemID == "" || attemptToken == "" {
		return ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var jobID string
	err = tx.QueryRowContext(ctx, `update communications_email_archive_job_items
set status='archived',archived_timestamp=coalesce(archived_timestamp,now()),last_error='',updated_timestamp=now()
where job_item_id=$1::uuid and status='processing' and attempt_token=$2::uuid
returning archive_job_id::text`, jobItemID, attemptToken).Scan(&jobID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := updatePostgresCommunicationsArchiveJobStatusTx(ctx, tx, jobID); err != nil {
		return err
	}
	if err := r.enqueueRealtimeOutboxInputsTx(ctx, tx, realtimeInputs); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) FailCommunicationsArchiveJobItemAttemptContext(ctx context.Context, jobItemID, attemptToken, lastError string, realtimeInputs []RealtimeOutboxInput) error {
	jobItemID, attemptToken = cleanUUIDText(jobItemID), cleanUUIDText(attemptToken)
	lastError = trimCommunicationsArchiveJobLastError(lastError)
	if jobItemID == "" || attemptToken == "" || lastError == "" {
		return ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var jobID string
	err = tx.QueryRowContext(ctx, `update communications_email_archive_job_items
set status=case when provider_attempt_count>=3 then 'failed' else 'pending' end,
    last_error=$3,
    attempt_token=null,
    failed_timestamp=case when provider_attempt_count>=3 then now() else null end,updated_timestamp=now()
where job_item_id=$1::uuid and status='processing' and attempt_token=$2::uuid
returning archive_job_id::text`, jobItemID, attemptToken, lastError).Scan(&jobID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := updatePostgresCommunicationsArchiveJobStatusTx(ctx, tx, jobID); err != nil {
		return err
	}
	if err := r.enqueueRealtimeOutboxInputsTx(ctx, tx, realtimeInputs); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) ParkCommunicationsArchiveJobItemAttemptContext(ctx context.Context, jobItemID, attemptToken, companyID, emailConnectionID, connectionStatus, lastError string, realtimeInputs []RealtimeOutboxInput) error {
	jobItemID, attemptToken = cleanUUIDText(jobItemID), cleanUUIDText(attemptToken)
	companyID, emailConnectionID = cleanUUIDText(companyID), cleanUUIDText(emailConnectionID)
	connectionStatus, lastError = normalizeEmailConnectionStatus(connectionStatus), trimCommunicationsArchiveJobLastError(lastError)
	if jobItemID == "" || attemptToken == "" || companyID == "" || emailConnectionID == "" || lastError == "" ||
		(connectionStatus != "reauth_required" && connectionStatus != "configuration_required") {
		return ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var jobID string
	err = tx.QueryRowContext(ctx, `update communications_email_archive_job_items item
set status='failed',last_error=$3,attempt_token=null,failed_timestamp=now(),updated_timestamp=now()
from communications_email_archive_jobs job
where item.archive_job_id=job.archive_job_id and item.job_item_id=$1::uuid
  and item.status='processing' and item.attempt_token=$2::uuid and job.company_id=$4::uuid
returning item.archive_job_id::text`, jobItemID, attemptToken, lastError, companyID).Scan(&jobID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `update email_connections set status=$3,updated_timestamp=now()
where company_id=$1::uuid and email_connection_id=$2::uuid`, companyID, emailConnectionID, connectionStatus)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return err
		}
		return ErrNotFound
	}
	if err := updatePostgresCommunicationsArchiveJobStatusTx(ctx, tx, jobID); err != nil {
		return err
	}
	if err := r.enqueueRealtimeOutboxInputsTx(ctx, tx, realtimeInputs); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListCommunicationsArchiveJobItemsContext(ctx context.Context, jobID string) ([]CommunicationsArchiveJobItem, error) {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(ctx, `
select `+communicationsArchiveJobItemSelectColumns+`
from communications_email_archive_job_items item
join communications_email_archive_jobs job
  on job.archive_job_id = item.archive_job_id
where item.archive_job_id=$1::uuid
order by item.created_timestamp asc, item.job_item_id asc`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanCommunicationsArchiveJobItems(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		var exists bool
		if err := r.db.QueryRowContext(ctx, `select exists(select 1 from communications_email_archive_jobs where archive_job_id=$1::uuid)`, jobID).Scan(&exists); err != nil {
			return nil, err
		}
		if !exists {
			return nil, ErrNotFound
		}
	}
	return items, nil
}

func (r *PostgresRepo) ListUnsentCommunicationsArchiveJobItemsContext(ctx context.Context, companyID, emailConnectionID string, createdBefore time.Time, limit int) ([]CommunicationsArchiveJobItem, error) {
	companyID, emailConnectionID = cleanUUIDText(companyID), cleanUUIDText(emailConnectionID)
	if companyID == "" || emailConnectionID == "" || createdBefore.IsZero() || limit <= 0 || limit > 500 {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(ctx, `select `+communicationsArchiveJobItemSelectColumns+`
from communications_email_archive_job_items item
join communications_email_archive_jobs job on job.archive_job_id=item.archive_job_id
join email_connections connection on connection.company_id=$1::uuid and connection.email_connection_id=$2::uuid
where job.company_id=$1::uuid
  and item.status='pending' and item.provider_attempt_count=0 and item.created_timestamp <= $3
  and ((job.connection_scope='personal' and job.actor_user_id=connection.personal_user_id and job.account_email=connection.account_email)
    or (job.connection_scope='shared' and job.company_email_connection_id=connection.email_connection_id))
order by item.created_timestamp,item.job_item_id
limit $4`, companyID, emailConnectionID, createdBefore, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCommunicationsArchiveJobItems(rows)
}

func updatePostgresCommunicationsArchiveJobStatusTx(ctx context.Context, tx *sql.Tx, jobID string) error {
	var activeCount, failedCount int
	if err := tx.QueryRowContext(ctx, `
select
  count(*) filter (where status in ('pending', 'processing')),
  count(*) filter (where status='failed')
from communications_email_archive_job_items
where archive_job_id=$1::uuid`, jobID).Scan(&activeCount, &failedCount); err != nil {
		return err
	}
	status := CommunicationsArchiveJobStatusCompleted
	if activeCount > 0 {
		status = CommunicationsArchiveJobStatusProcessing
	} else if failedCount > 0 {
		status = CommunicationsArchiveJobStatusFailed
	}
	_, err := tx.ExecContext(ctx, `
update communications_email_archive_jobs
set status=$2,
    completed_timestamp=case when $2 in ('completed', 'failed') then coalesce(completed_timestamp, now()) else null end,
    updated_timestamp=now()
where archive_job_id=$1::uuid`, jobID, status)
	return err
}

func scanCommunicationsArchiveJobItem(row interface{ Scan(dest ...any) error }) (CommunicationsArchiveJobItem, error) {
	var item CommunicationsArchiveJobItem
	var archivedAt sql.NullTime
	var failedAt sql.NullTime
	err := row.Scan(
		&item.JobItemID,
		&item.JobID,
		&item.ActorUserID,
		&item.CompanyID,
		&item.SharedInboxID,
		&item.ConnectionScope,
		&item.Provider,
		&item.AccountEmail,
		&item.GrantID,
		&item.CompanyEmailConnectionID,
		&item.MessageID,
		&item.Status,
		&item.ProviderAttemptCount,
		&item.AttemptToken,
		&item.LastError,
		&archivedAt,
		&failedAt,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if err != nil {
		return CommunicationsArchiveJobItem{}, err
	}
	if archivedAt.Valid {
		value := archivedAt.Time
		item.ArchivedTimestamp = &value
	}
	if failedAt.Valid {
		value := failedAt.Time
		item.FailedTimestamp = &value
	}
	return CloneCommunicationsArchiveJobItem(item), nil
}

func scanCommunicationsArchiveJobItems(rows *sql.Rows) ([]CommunicationsArchiveJobItem, error) {
	items := make([]CommunicationsArchiveJobItem, 0)
	for rows.Next() {
		item, err := scanCommunicationsArchiveJobItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
