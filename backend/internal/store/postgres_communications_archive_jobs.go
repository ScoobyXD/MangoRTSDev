package store

import (
	"context"
	"database/sql"
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
item.attempt_count,
item.last_error,
item.available_at,
item.processing_started_at,
item.archived_timestamp,
item.failed_timestamp,
item.created_timestamp,
item.updated_timestamp`

func (r *PostgresRepo) CreateCommunicationsArchiveJob(input CommunicationsArchiveJobInput) (CommunicationsArchiveJob, error) {
	input, err := NormalizeCommunicationsArchiveJobInput(input)
	if err != nil {
		return CommunicationsArchiveJob{}, err
	}
	ctx := context.Background()
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
	if _, err := tx.ExecContext(ctx, `
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
		var activeExists bool
		if err := tx.QueryRowContext(ctx, `
select exists (
  select 1
  from communications_email_archive_job_items item
  join communications_email_archive_jobs job
    on job.archive_job_id = item.archive_job_id
  where job.actor_user_id = $1::uuid
    and coalesce(job.company_id::text, '') = $2
    and coalesce(job.shared_inbox_id::text, '') = $3
    and job.connection_scope = $4
    and job.account_email = $5
    and item.message_id = $6
    and item.status in ('pending', 'processing', 'retry')
)`,
			job.ActorUserID,
			job.CompanyID,
			job.SharedInboxID,
			job.ConnectionScope,
			job.AccountEmail,
			messageID,
		).Scan(&activeExists); err != nil {
			return CommunicationsArchiveJob{}, err
		}
		if activeExists {
			continue
		}
		item, err := scanCommunicationsArchiveJobItem(tx.QueryRowContext(ctx, `
with inserted as (
  insert into communications_email_archive_job_items (
    job_item_id,
    archive_job_id,
    message_id,
    status,
    available_at,
    created_timestamp,
    updated_timestamp
  ) values (
    $1::uuid,
    $2::uuid,
    $3,
    'pending',
    $4,
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
	if job.CreatedItemCount == 0 {
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

func (r *PostgresRepo) ClaimCommunicationsArchiveJobItems(limit int, processingLeaseTimeout time.Duration) ([]CommunicationsArchiveJobItem, error) {
	limit = NormalizeCommunicationsArchiveJobClaimLimit(limit)
	processingLeaseTimeout = NormalizeCommunicationsArchiveJobProcessingLeaseTimeout(processingLeaseTimeout)
	staleBefore := time.Now().UTC().Add(-processingLeaseTimeout)
	rows, err := r.db.QueryContext(context.Background(), `
with claimed as (
  select item.job_item_id
  from communications_email_archive_job_items item
  where item.status in ('pending', 'retry', 'processing')
    and item.available_at <= now()
    and (
      item.status <> 'processing'
      or item.processing_started_at is null
      or item.processing_started_at < $2
    )
  order by item.available_at asc, item.created_timestamp asc, item.job_item_id asc
  limit $1
  for update skip locked
),
updated as (
  update communications_email_archive_job_items item
  set status='processing',
      processing_started_at=now(),
      attempt_count=item.attempt_count + 1,
      updated_timestamp=now()
  from claimed
  where item.job_item_id=claimed.job_item_id
  returning item.*
)
select `+communicationsArchiveJobItemSelectColumns+`
from updated item
join communications_email_archive_jobs job
  on job.archive_job_id = item.archive_job_id
order by item.available_at asc, item.created_timestamp asc, item.job_item_id asc`, limit, staleBefore)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCommunicationsArchiveJobItems(rows)
}

func (r *PostgresRepo) MarkCommunicationsArchiveJobItemArchived(jobItemID string) error {
	jobItemID = strings.TrimSpace(jobItemID)
	if jobItemID == "" {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var jobID string
	if err := tx.QueryRowContext(ctx, `
update communications_email_archive_job_items
set status='archived',
    processing_started_at=null,
    archived_timestamp=coalesce(archived_timestamp, now()),
    last_error='',
    updated_timestamp=now()
where job_item_id=$1::uuid
returning archive_job_id::text`, jobItemID).Scan(&jobID); err != nil {
		if err == sql.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	if err := updatePostgresCommunicationsArchiveJobStatusTx(ctx, tx, jobID); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) MarkCommunicationsArchiveJobItemFailed(jobItemID, lastError string, availableAt time.Time, final bool) error {
	jobItemID = strings.TrimSpace(jobItemID)
	if jobItemID == "" {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	status := CommunicationsArchiveJobItemStatusRetry
	if availableAt.IsZero() {
		availableAt = time.Now().UTC().Add(time.Second)
	}
	if final {
		status = CommunicationsArchiveJobItemStatusFailed
	}

	var jobID string
	if final {
		err = tx.QueryRowContext(ctx, `
update communications_email_archive_job_items
set status=$2,
    processing_started_at=null,
    failed_timestamp=coalesce(failed_timestamp, now()),
    last_error=$3,
    updated_timestamp=now()
where job_item_id=$1::uuid
returning archive_job_id::text`, jobItemID, status, trimEventLastError(lastError)).Scan(&jobID)
	} else {
		err = tx.QueryRowContext(ctx, `
update communications_email_archive_job_items
set status=$2,
    processing_started_at=null,
    available_at=$3,
    last_error=$4,
    updated_timestamp=now()
where job_item_id=$1::uuid
returning archive_job_id::text`, jobItemID, status, availableAt.UTC(), trimEventLastError(lastError)).Scan(&jobID)
	}
	if err != nil {
		if err == sql.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	if err := updatePostgresCommunicationsArchiveJobStatusTx(ctx, tx, jobID); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListCommunicationsArchiveJobItems(jobID string) ([]CommunicationsArchiveJobItem, error) {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
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
		if err := r.db.QueryRowContext(context.Background(), `select exists(select 1 from communications_email_archive_jobs where archive_job_id=$1::uuid)`, jobID).Scan(&exists); err != nil {
			return nil, err
		}
		if !exists {
			return nil, ErrNotFound
		}
	}
	return items, nil
}

func updatePostgresCommunicationsArchiveJobStatusTx(ctx context.Context, tx *sql.Tx, jobID string) error {
	var activeCount, failedCount int
	if err := tx.QueryRowContext(ctx, `
select
  count(*) filter (where status in ('pending', 'processing', 'retry')),
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
	var processingStarted sql.NullTime
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
		&item.AttemptCount,
		&item.LastError,
		&item.AvailableAt,
		&processingStarted,
		&archivedAt,
		&failedAt,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if err != nil {
		return CommunicationsArchiveJobItem{}, err
	}
	if processingStarted.Valid {
		value := processingStarted.Time
		item.ProcessingStartedAt = &value
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
