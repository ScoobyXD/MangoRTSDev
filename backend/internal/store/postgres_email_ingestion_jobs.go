package store

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
)

type communicationsEmailIngestionJobScanner interface {
	Scan(dest ...any) error
}

const postgresCommunicationsEmailIngestionJobColumns = `
ingestion_job_id::text,company_id::text,email_connection_id::text,
coalesce(email_thread_id::text,''),provider_message_id,provider_thread_id,priority,
	status,provider_attempt_count,coalesce(attempt_token::text,''),enqueue_source_id,sqs_accepted_timestamp,
last_error,completed_timestamp,failed_timestamp,created_timestamp,updated_timestamp`

func scanPostgresCommunicationsEmailIngestionJob(row communicationsEmailIngestionJobScanner) (CommunicationsEmailIngestionJob, error) {
	var item CommunicationsEmailIngestionJob
	var sqsAccepted, completed, failed sql.NullTime
	err := row.Scan(
		&item.IngestionJobID, &item.CompanyID, &item.EmailConnectionID, &item.EmailThreadID,
		&item.ProviderMessageID, &item.ProviderThreadID, &item.Priority,
		&item.Status, &item.ProviderAttemptCount, &item.AttemptToken, &item.EnqueueSourceID, &sqsAccepted,
		&item.LastError, &completed, &failed, &item.CreatedTimestamp, &item.UpdatedTimestamp,
	)
	if sqsAccepted.Valid {
		value := sqsAccepted.Time
		item.SQSAcceptedTimestamp = &value
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
		CommunicationsEmailIngestionPriorityScan:
		return priority
	default:
		return CommunicationsEmailIngestionPriorityScan
	}
}

func ensurePostgresCommunicationsEmailIngestionJobTx(
	ctx context.Context,
	tx *sql.Tx,
	input CommunicationsEmailIngestionJobInput,
) (CommunicationsEmailIngestionJob, bool, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.EmailConnectionID = cleanUUIDText(input.EmailConnectionID)
	input.EmailThreadID = cleanUUIDText(input.EmailThreadID)
	input.ProviderMessageID = strings.TrimSpace(input.ProviderMessageID)
	input.ProviderThreadID = strings.TrimSpace(input.ProviderThreadID)
	input.EnqueueSourceID = strings.TrimSpace(input.EnqueueSourceID)
	input.Priority = normalizeCommunicationsEmailIngestionPriority(input.Priority)
	if input.CompanyID == "" || input.EmailConnectionID == "" {
		return CommunicationsEmailIngestionJob{}, false, ErrInvalid
	}
	if input.EmailThreadID != "" {
		var connectionID, rootMessageID, providerThreadID string
		err := tx.QueryRowContext(ctx, `select email_connection_id::text,root_provider_message_id,provider_thread_id
from email_threads where company_id=$1::uuid and email_thread_id=$2::uuid`,
			input.CompanyID, input.EmailThreadID).Scan(&connectionID, &rootMessageID, &providerThreadID)
		if errors.Is(err, sql.ErrNoRows) {
			return CommunicationsEmailIngestionJob{}, false, ErrNotFound
		}
		if err != nil {
			return CommunicationsEmailIngestionJob{}, false, err
		}
		if input.EmailConnectionID != connectionID {
			return CommunicationsEmailIngestionJob{}, false, ErrInvalid
		}
		if input.ProviderMessageID == "" {
			input.ProviderMessageID = rootMessageID
		}
		if input.ProviderThreadID == "" {
			input.ProviderThreadID = providerThreadID
		}
	}
	if input.ProviderMessageID == "" {
		return CommunicationsEmailIngestionJob{}, false, ErrInvalid
	}
	var connectionExists bool
	if err := tx.QueryRowContext(ctx, `select exists(
 select 1 from email_connections
 where company_id=$1::uuid and email_connection_id=$2::uuid
)`, input.CompanyID, input.EmailConnectionID).Scan(&connectionExists); err != nil {
		return CommunicationsEmailIngestionJob{}, false, err
	}
	if !connectionExists {
		return CommunicationsEmailIngestionJob{}, false, ErrNotFound
	}
	lockKey := strings.Join([]string{input.CompanyID, input.EmailConnectionID, input.ProviderMessageID}, "\x1f")
	if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, lockKey); err != nil {
		return CommunicationsEmailIngestionJob{}, false, err
	}
	item, err := scanPostgresCommunicationsEmailIngestionJob(tx.QueryRowContext(ctx, `
update email_ingestion_jobs
set priority=least(priority,$4),
    email_thread_id=coalesce(email_thread_id,nullif($5,'')::uuid),
    provider_thread_id=case when provider_thread_id='' then $6 else provider_thread_id end,
    updated_timestamp=now()
where company_id=$1::uuid and email_connection_id=$2::uuid and provider_message_id=$3
  and status in ('accepted','processing')
returning `+postgresCommunicationsEmailIngestionJobColumns,
		input.CompanyID, input.EmailConnectionID, input.ProviderMessageID, input.Priority,
		input.EmailThreadID, input.ProviderThreadID))
	if err == nil {
		if input.EmailThreadID != "" && communicationsEmailIngestionJobActive(item.Status) {
			if _, err := tx.ExecContext(ctx, `update email_threads
set download_status='downloading',last_download_error='',updated_timestamp=now()
where company_id=$1::uuid and email_thread_id=$2::uuid`,
				input.CompanyID, input.EmailThreadID); err != nil {
				return CommunicationsEmailIngestionJob{}, false, err
			}
		}
		return item, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommunicationsEmailIngestionJob{}, false, err
	}
	item, err = scanPostgresCommunicationsEmailIngestionJob(tx.QueryRowContext(ctx, `
select `+postgresCommunicationsEmailIngestionJobColumns+`
from email_ingestion_jobs
where company_id=$1::uuid and email_connection_id=$2::uuid and provider_message_id=$3
limit 1`, input.CompanyID, input.EmailConnectionID, input.ProviderMessageID))
	if err == nil {
		return item, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommunicationsEmailIngestionJob{}, false, err
	}
	item, err = scanPostgresCommunicationsEmailIngestionJob(tx.QueryRowContext(ctx, `
insert into email_ingestion_jobs (
 ingestion_job_id,company_id,email_connection_id,email_thread_id,
	 provider_message_id,provider_thread_id,priority,status,
	 provider_attempt_count,enqueue_source_id,sqs_accepted_timestamp,last_error,
 created_timestamp,updated_timestamp
) values (
 $1::uuid,$2::uuid,$3::uuid,nullif($4,'')::uuid,$5,$6,$7,
	 'accepted',0,$8,null,'',now(),now()
)
returning `+postgresCommunicationsEmailIngestionJobColumns,
		newUUIDv7String(), input.CompanyID, input.EmailConnectionID, input.EmailThreadID,
		input.ProviderMessageID, input.ProviderThreadID, input.Priority, input.EnqueueSourceID))
	if err != nil {
		return CommunicationsEmailIngestionJob{}, false, err
	}
	if input.EmailThreadID != "" {
		if _, err := tx.ExecContext(ctx, `update email_threads
set download_status='downloading',last_download_error='',updated_timestamp=now()
where company_id=$1::uuid and email_thread_id=$2::uuid`,
			input.CompanyID, input.EmailThreadID); err != nil {
			return CommunicationsEmailIngestionJob{}, false, err
		}
	}
	return item, true, nil
}

func (r *PostgresRepo) EnsureCommunicationsEmailIngestionJobContext(ctx context.Context, input CommunicationsEmailIngestionJobInput) (CommunicationsEmailIngestionJob, bool, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsEmailIngestionJob{}, false, err
	}
	defer tx.Rollback()
	item, created, err := ensurePostgresCommunicationsEmailIngestionJobTx(ctx, tx, input)
	if err != nil {
		return CommunicationsEmailIngestionJob{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsEmailIngestionJob{}, false, err
	}
	return item, created, nil
}

func (r *PostgresRepo) GetCommunicationsEmailIngestionJobContext(ctx context.Context, jobID string) (CommunicationsEmailIngestionJob, error) {
	jobID = cleanUUIDText(jobID)
	if jobID == "" {
		return CommunicationsEmailIngestionJob{}, ErrInvalid
	}
	item, err := scanPostgresCommunicationsEmailIngestionJob(r.db.QueryRowContext(ctx, `select `+postgresCommunicationsEmailIngestionJobColumns+`
from email_ingestion_jobs where ingestion_job_id=$1::uuid`, jobID))
	if errors.Is(err, sql.ErrNoRows) {
		return CommunicationsEmailIngestionJob{}, ErrNotFound
	}
	return item, err
}

func (r *PostgresRepo) MarkCommunicationsEmailIngestionJobSQSAcceptedContext(ctx context.Context, jobID string) error {
	jobID = cleanUUIDText(jobID)
	if jobID == "" {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(ctx, `update email_ingestion_jobs
set sqs_accepted_timestamp=coalesce(sqs_accepted_timestamp,now()),updated_timestamp=now()
where ingestion_job_id=$1::uuid`, jobID)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return err
		}
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) StartCommunicationsEmailIngestionAttemptContext(ctx context.Context, jobID string) (CommunicationsEmailIngestionJob, bool, error) {
	jobID = cleanUUIDText(jobID)
	if jobID == "" {
		return CommunicationsEmailIngestionJob{}, false, ErrInvalid
	}
	token := newUUIDv7String()
	item, err := scanPostgresCommunicationsEmailIngestionJob(r.db.QueryRowContext(ctx, `
update email_ingestion_jobs
set status='processing',provider_attempt_count=provider_attempt_count+1,
    attempt_token=$2::uuid,last_error='',updated_timestamp=now()
where ingestion_job_id=$1::uuid
  and status in ('accepted','processing')
  and provider_attempt_count < 3
returning `+postgresCommunicationsEmailIngestionJobColumns, jobID, token))
	if err == nil {
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommunicationsEmailIngestionJob{}, false, err
	}
	item, err = r.GetCommunicationsEmailIngestionJobContext(ctx, jobID)
	if err != nil {
		return CommunicationsEmailIngestionJob{}, false, err
	}
	if item.ProviderAttemptCount >= CommunicationsEmailProviderAttemptLimit &&
		(item.Status == CommunicationsEmailIngestionJobAccepted || item.Status == CommunicationsEmailIngestionJobProcessing) {
		item, err = scanPostgresCommunicationsEmailIngestionJob(r.db.QueryRowContext(ctx, `
update email_ingestion_jobs
set status='exhausted',attempt_token=null,
    failed_timestamp=coalesce(failed_timestamp,now()),updated_timestamp=now()
where ingestion_job_id=$1::uuid and provider_attempt_count>=3
returning `+postgresCommunicationsEmailIngestionJobColumns, jobID))
		if err != nil {
			return CommunicationsEmailIngestionJob{}, false, err
		}
	}
	return item, false, nil
}

func (r *PostgresRepo) CompleteCommunicationsEmailIngestionAttemptContext(ctx context.Context, jobID, attemptToken string, realtimeInputs []RealtimeOutboxInput) error {
	jobID, attemptToken = cleanUUIDText(jobID), cleanUUIDText(attemptToken)
	if jobID == "" || attemptToken == "" {
		return ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var companyID, threadID string
	err = tx.QueryRowContext(ctx, `update email_ingestion_jobs
set status='completed',last_error='',
    attempt_token=null,
    completed_timestamp=now(),failed_timestamp=null,updated_timestamp=now()
where ingestion_job_id=$1::uuid and status='processing' and attempt_token=$2::uuid
returning company_id::text,coalesce(email_thread_id::text,'')`, jobID, attemptToken).Scan(&companyID, &threadID)
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
   and job.status in ('accepted','processing')
) then 'downloading' when thread.history_complete then 'complete' else 'partial' end,
last_download_error='',updated_timestamp=now()
where company_id=$1::uuid and email_thread_id=$2::uuid`, companyID, threadID)
		if err != nil {
			return err
		}
	}
	if err := r.enqueueRealtimeOutboxInputsTx(ctx, tx, realtimeInputs); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) FailCommunicationsEmailIngestionAttemptContext(ctx context.Context, jobID, attemptToken, lastError string, realtimeInputs []RealtimeOutboxInput) error {
	jobID, attemptToken, lastError = cleanUUIDText(jobID), cleanUUIDText(attemptToken), strings.TrimSpace(lastError)
	if jobID == "" || attemptToken == "" || lastError == "" {
		return ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var companyID, threadID string
	err = tx.QueryRowContext(ctx, `update email_ingestion_jobs
set status=case when provider_attempt_count>=3 then 'exhausted' else 'accepted' end,
    last_error=$3,attempt_token=null,
    failed_timestamp=case when provider_attempt_count>=3 then now() else null end,
    updated_timestamp=now()
where ingestion_job_id=$1::uuid and status='processing' and attempt_token=$2::uuid
returning company_id::text,coalesce(email_thread_id::text,'')`,
		jobID, attemptToken, lastError).Scan(&companyID, &threadID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if threadID != "" {
		if _, err := tx.ExecContext(ctx, `update email_threads
set download_status=case when exists(
      select 1 from email_ingestion_jobs job
      where job.company_id=email_threads.company_id
        and job.email_thread_id=email_threads.email_thread_id
        and job.status in ('accepted','processing')
    ) then 'downloading' else 'failed' end,
    last_download_error=$3,updated_timestamp=now()
where company_id=$1::uuid and email_thread_id=$2::uuid`,
			companyID, threadID, lastError); err != nil {
			return err
		}
	}
	if err := r.enqueueRealtimeOutboxInputsTx(ctx, tx, realtimeInputs); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) ParkCommunicationsEmailIngestionAttemptContext(ctx context.Context, jobID, attemptToken, connectionStatus, lastError string, realtimeInputs []RealtimeOutboxInput) error {
	jobID, attemptToken = cleanUUIDText(jobID), cleanUUIDText(attemptToken)
	connectionStatus, lastError = strings.TrimSpace(connectionStatus), strings.TrimSpace(lastError)
	if jobID == "" || attemptToken == "" || lastError == "" ||
		(connectionStatus != "reauth_required" && connectionStatus != "configuration_required") {
		return ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var companyID, connectionID, threadID string
	err = tx.QueryRowContext(ctx, `update email_ingestion_jobs
set status='parked',last_error=$3,attempt_token=null,
    failed_timestamp=now(),updated_timestamp=now()
where ingestion_job_id=$1::uuid and status='processing' and attempt_token=$2::uuid
returning company_id::text,email_connection_id::text,coalesce(email_thread_id::text,'')`,
		jobID, attemptToken, lastError).Scan(&companyID, &connectionID, &threadID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `update email_connections
set status=$3,updated_timestamp=now()
where company_id=$1::uuid and email_connection_id=$2::uuid`, companyID, connectionID, connectionStatus)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return err
		}
		return ErrNotFound
	}
	if threadID != "" {
		if _, err := tx.ExecContext(ctx, `update email_threads
set download_status='failed',last_download_error=$3,updated_timestamp=now()
where company_id=$1::uuid and email_thread_id=$2::uuid`, companyID, threadID, lastError); err != nil {
			return err
		}
	}
	if err := r.enqueueRealtimeOutboxInputsTx(ctx, tx, realtimeInputs); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListCommunicationsEmailIngestionJobsForThreadContext(ctx context.Context, companyID, emailThreadID string) ([]CommunicationsEmailIngestionJob, error) {
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	if companyID == "" || emailThreadID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(ctx, `select `+postgresCommunicationsEmailIngestionJobColumns+`
from email_ingestion_jobs where company_id=$1::uuid and email_thread_id=$2::uuid
order by created_timestamp`, companyID, emailThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []CommunicationsEmailIngestionJob{}
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
		if err := r.db.QueryRowContext(ctx, `select exists(select 1 from email_threads
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
