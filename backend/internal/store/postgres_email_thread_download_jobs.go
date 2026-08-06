package store

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
	"time"
)

type communicationsEmailIngestionJobScanner interface {
	Scan(dest ...any) error
}

const postgresCommunicationsEmailIngestionJobColumns = `
ingestion_job_id::text,company_id::text,email_connection_id::text,
coalesce(email_thread_id::text,''),provider_message_id,provider_thread_id,priority,
status,attempt_count,last_error,available_at,processing_started_at,
completed_timestamp,failed_timestamp,created_timestamp,updated_timestamp`

func scanPostgresCommunicationsEmailIngestionJob(row communicationsEmailIngestionJobScanner) (CommunicationsEmailThreadDownloadJob, error) {
	var item CommunicationsEmailThreadDownloadJob
	var processing, completed, failed sql.NullTime
	err := row.Scan(
		&item.DownloadJobID, &item.CompanyID, &item.EmailConnectionID, &item.EmailThreadID,
		&item.ProviderMessageID, &item.ProviderThreadID, &item.Priority,
		&item.Status, &item.AttemptCount, &item.LastError, &item.AvailableAt,
		&processing, &completed, &failed, &item.CreatedTimestamp, &item.UpdatedTimestamp,
	)
	if processing.Valid {
		value := processing.Time
		item.ProcessingStartedAt = &value
	}
	if completed.Valid {
		value := completed.Time
		item.CompletedTimestamp = &value
	}
	if failed.Valid {
		value := failed.Time
		item.FailedTimestamp = &value
	}
	return item, err
}

func normalizeCommunicationsEmailIngestionPriority(priority int) int {
	switch priority {
	case CommunicationsEmailIngestionPriorityLive,
		CommunicationsEmailIngestionPriorityVisible,
		CommunicationsEmailIngestionPriorityScan,
		CommunicationsEmailIngestionPriorityBacklog:
		return priority
	default:
		return CommunicationsEmailIngestionPriorityScan
	}
}

func ensurePostgresCommunicationsEmailIngestionJobTx(
	ctx context.Context,
	tx *sql.Tx,
	input CommunicationsEmailIngestionJobInput,
) (CommunicationsEmailThreadDownloadJob, bool, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.EmailConnectionID = cleanUUIDText(input.EmailConnectionID)
	input.EmailThreadID = cleanUUIDText(input.EmailThreadID)
	input.ProviderMessageID = strings.TrimSpace(input.ProviderMessageID)
	input.ProviderThreadID = strings.TrimSpace(input.ProviderThreadID)
	input.Priority = normalizeCommunicationsEmailIngestionPriority(input.Priority)
	if input.CompanyID == "" || input.EmailConnectionID == "" {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrInvalid
	}
	if input.EmailThreadID != "" {
		var connectionID, rootMessageID, providerThreadID string
		err := tx.QueryRowContext(ctx, `select email_connection_id::text,root_provider_message_id,provider_thread_id
from email_threads where company_id=$1::uuid and email_thread_id=$2::uuid`,
			input.CompanyID, input.EmailThreadID).Scan(&connectionID, &rootMessageID, &providerThreadID)
		if errors.Is(err, sql.ErrNoRows) {
			return CommunicationsEmailThreadDownloadJob{}, false, ErrNotFound
		}
		if err != nil {
			return CommunicationsEmailThreadDownloadJob{}, false, err
		}
		if input.EmailConnectionID != connectionID {
			return CommunicationsEmailThreadDownloadJob{}, false, ErrInvalid
		}
		if input.ProviderMessageID == "" {
			input.ProviderMessageID = rootMessageID
		}
		if input.ProviderThreadID == "" {
			input.ProviderThreadID = providerThreadID
		}
	}
	if input.ProviderMessageID == "" {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrInvalid
	}
	var connectionExists bool
	if err := tx.QueryRowContext(ctx, `select exists(
 select 1 from email_connections
 where company_id=$1::uuid and email_connection_id=$2::uuid
)`, input.CompanyID, input.EmailConnectionID).Scan(&connectionExists); err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	if !connectionExists {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrNotFound
	}
	lockKey := strings.Join([]string{input.CompanyID, input.EmailConnectionID, input.ProviderMessageID}, "\x1f")
	if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, lockKey); err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	item, err := scanPostgresCommunicationsEmailIngestionJob(tx.QueryRowContext(ctx, `
update email_ingestion_jobs
set priority=least(priority,$4),
    email_thread_id=coalesce(email_thread_id,nullif($5,'')::uuid),
    provider_thread_id=case when provider_thread_id='' then $6 else provider_thread_id end,
    available_at=least(available_at,now()),updated_timestamp=now()
where company_id=$1::uuid and email_connection_id=$2::uuid and provider_message_id=$3
  and status in ('pending','processing','retry')
returning `+postgresCommunicationsEmailIngestionJobColumns,
		input.CompanyID, input.EmailConnectionID, input.ProviderMessageID, input.Priority,
		input.EmailThreadID, input.ProviderThreadID))
	if err == nil {
		if input.EmailThreadID != "" {
			if _, err := tx.ExecContext(ctx, `update email_threads
set download_status='downloading',last_download_error='',updated_timestamp=now()
where company_id=$1::uuid and email_thread_id=$2::uuid`,
				input.CompanyID, input.EmailThreadID); err != nil {
				return CommunicationsEmailThreadDownloadJob{}, false, err
			}
		}
		return item, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	item, err = scanPostgresCommunicationsEmailIngestionJob(tx.QueryRowContext(ctx, `
select `+postgresCommunicationsEmailIngestionJobColumns+`
from email_ingestion_jobs
where company_id=$1::uuid and email_connection_id=$2::uuid and provider_message_id=$3
  and status='completed'
order by completed_timestamp desc nulls last,updated_timestamp desc
limit 1`, input.CompanyID, input.EmailConnectionID, input.ProviderMessageID))
	if err == nil {
		return item, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	item, err = scanPostgresCommunicationsEmailIngestionJob(tx.QueryRowContext(ctx, `
insert into email_ingestion_jobs (
 ingestion_job_id,company_id,email_connection_id,email_thread_id,
 provider_message_id,provider_thread_id,priority,status,attempt_count,last_error,
 available_at,created_timestamp,updated_timestamp
) values (
 $1::uuid,$2::uuid,$3::uuid,nullif($4,'')::uuid,$5,$6,$7,
 'pending',0,'',now(),now(),now()
)
returning `+postgresCommunicationsEmailIngestionJobColumns,
		newUUIDv7String(), input.CompanyID, input.EmailConnectionID, input.EmailThreadID,
		input.ProviderMessageID, input.ProviderThreadID, input.Priority))
	if err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	if input.EmailThreadID != "" {
		if _, err := tx.ExecContext(ctx, `update email_threads
set download_status='downloading',last_download_error='',updated_timestamp=now()
where company_id=$1::uuid and email_thread_id=$2::uuid`,
			input.CompanyID, input.EmailThreadID); err != nil {
			return CommunicationsEmailThreadDownloadJob{}, false, err
		}
	}
	return item, true, nil
}

func (r *PostgresRepo) EnsureCommunicationsEmailIngestionJob(input CommunicationsEmailIngestionJobInput) (CommunicationsEmailThreadDownloadJob, bool, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	defer tx.Rollback()
	item, created, err := ensurePostgresCommunicationsEmailIngestionJobTx(ctx, tx, input)
	if err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	return item, created, nil
}

func ensurePostgresCommunicationsEmailThreadDownloadJobTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, emailThreadID, _ string,
	requestedProviderMessageID, _ string,
) (CommunicationsEmailThreadDownloadJob, bool, error) {
	var connectionID, providerThreadID string
	err := tx.QueryRowContext(ctx, `select email_connection_id::text,provider_thread_id
from email_threads where company_id=$1::uuid and email_thread_id=$2::uuid`,
		companyID, emailThreadID).Scan(&connectionID, &providerThreadID)
	if errors.Is(err, sql.ErrNoRows) {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrNotFound
	}
	if err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	return ensurePostgresCommunicationsEmailIngestionJobTx(ctx, tx, CommunicationsEmailIngestionJobInput{
		CompanyID: companyID, EmailConnectionID: connectionID, EmailThreadID: emailThreadID,
		ProviderMessageID: requestedProviderMessageID, ProviderThreadID: providerThreadID,
		Priority: CommunicationsEmailIngestionPriorityVisible,
	})
}

func (r *PostgresRepo) EnsureCommunicationsEmailThreadDownloadJob(
	companyID, emailThreadID, downloadScope, requestedProviderMessageID, requestedByUserID string,
) (CommunicationsEmailThreadDownloadJob, bool, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	defer tx.Rollback()
	item, created, err := ensurePostgresCommunicationsEmailThreadDownloadJobTx(
		ctx, tx, companyID, emailThreadID, downloadScope, requestedProviderMessageID, requestedByUserID,
	)
	if err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	return item, created, nil
}

func (r *PostgresRepo) ClaimCommunicationsEmailThreadDownloadJobs(limit int, lease time.Duration) ([]CommunicationsEmailThreadDownloadJob, error) {
	limit = NormalizeCommunicationsEmailThreadDownloadClaimLimit(limit)
	lease = NormalizeCommunicationsEmailThreadDownloadLease(lease)
	staleBefore := time.Now().UTC().Add(-lease)
	rows, err := r.db.Query(`
with candidates as (
 select ingestion_job_id
 from email_ingestion_jobs
 where ((status in ('pending','retry') and available_at<=now())
        or (status='processing' and processing_started_at<$2))
 order by priority,available_at,created_timestamp
 limit $1 for update skip locked
), claimed as (
 update email_ingestion_jobs target
 set status='processing',attempt_count=target.attempt_count+1,
     processing_started_at=now(),updated_timestamp=now()
 from candidates
 where target.ingestion_job_id=candidates.ingestion_job_id
 returning target.*
)
select `+postgresCommunicationsEmailIngestionJobColumns+` from claimed`, limit, staleBefore)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []CommunicationsEmailThreadDownloadJob{}
	for rows.Next() {
		item, scanErr := scanPostgresCommunicationsEmailIngestionJob(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) MarkCommunicationsEmailThreadDownloadJobCompleted(jobID string) error {
	jobID = cleanUUIDText(jobID)
	if jobID == "" {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var companyID, threadID string
	err = tx.QueryRowContext(ctx, `update email_ingestion_jobs
set status='completed',last_error='',processing_started_at=null,
    completed_timestamp=now(),failed_timestamp=null,updated_timestamp=now()
where ingestion_job_id=$1::uuid
returning company_id::text,coalesce(email_thread_id::text,'')`, jobID).Scan(&companyID, &threadID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if threadID != "" {
		_, err = tx.ExecContext(ctx, `update email_threads thread
set download_status=case when exists(
 select 1 from email_ingestion_jobs job
 where job.company_id=thread.company_id and job.email_thread_id=thread.email_thread_id
   and job.status in ('pending','processing','retry')
) then 'downloading' when thread.history_complete then 'complete' else 'partial' end,
last_download_error='',updated_timestamp=now()
where company_id=$1::uuid and email_thread_id=$2::uuid`, companyID, threadID)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *PostgresRepo) MarkCommunicationsEmailThreadDownloadJobFailed(jobID, lastError string, availableAt time.Time, final bool) error {
	jobID, lastError = cleanUUIDText(jobID), strings.TrimSpace(lastError)
	if jobID == "" || lastError == "" {
		return ErrInvalid
	}
	status := CommunicationsEmailThreadDownloadJobRetry
	if final {
		status = CommunicationsEmailThreadDownloadJobFailed
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var companyID, threadID string
	err = tx.QueryRowContext(ctx, `update email_ingestion_jobs
set status=$2,last_error=$3,available_at=$4,processing_started_at=null,
    attempt_count=case when $3='email_connection_reauth_required'
      then greatest(attempt_count-1,0) else attempt_count end,
    failed_timestamp=case when $2='failed' then now() else null end,updated_timestamp=now()
where ingestion_job_id=$1::uuid
returning company_id::text,coalesce(email_thread_id::text,'')`,
		jobID, status, lastError, availableAt.UTC()).Scan(&companyID, &threadID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if threadID != "" {
		threadStatus := CommunicationsEmailThreadDownloadDownloading
		if final {
			threadStatus = CommunicationsEmailThreadDownloadFailed
		}
		if _, err := tx.ExecContext(ctx, `update email_threads
set download_status=$3,last_download_error=$4,updated_timestamp=now()
where company_id=$1::uuid and email_thread_id=$2::uuid`,
			companyID, threadID, threadStatus, lastError); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListCommunicationsEmailThreadDownloadJobs(companyID, emailThreadID string) ([]CommunicationsEmailThreadDownloadJob, error) {
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	if companyID == "" || emailThreadID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.Query(`select `+postgresCommunicationsEmailIngestionJobColumns+`
from email_ingestion_jobs where company_id=$1::uuid and email_thread_id=$2::uuid
order by created_timestamp`, companyID, emailThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []CommunicationsEmailThreadDownloadJob{}
	for rows.Next() {
		item, scanErr := scanPostgresCommunicationsEmailIngestionJob(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		var exists bool
		if err := r.db.QueryRow(`select exists(select 1 from email_threads
where company_id=$1::uuid and email_thread_id=$2::uuid)`, companyID, emailThreadID).Scan(&exists); err != nil {
			return nil, err
		}
		if !exists {
			return nil, ErrNotFound
		}
	}
	return items, nil
}

func (r *PostgresRepo) ListCommunicationsEmailThreadNodeIDs(companyID, emailThreadID string) ([]string, error) {
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	if companyID == "" || emailThreadID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.Query(`select distinct resource_id::text
from email_relationships
where company_id=$1::uuid and email_thread_id=$2::uuid
  and resource_type='node' and resource_textbox_id is null
order by resource_id::text`, companyID, emailThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []string{}
	for rows.Next() {
		var nodeID string
		if err := rows.Scan(&nodeID); err != nil {
			return nil, err
		}
		items = append(items, nodeID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, ErrNotFound
	}
	sort.Strings(items)
	return items, nil
}
