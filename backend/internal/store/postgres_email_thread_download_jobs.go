package store

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
	"time"
)

type communicationsEmailThreadDownloadJobScanner interface {
	Scan(dest ...any) error
}

const postgresCommunicationsEmailThreadDownloadJobColumns = `
download_job_id::text, company_id::text, email_thread_id::text, download_scope,
requested_provider_message_id, coalesce(requested_by_user_id::text, ''), status,
attempt_count, last_error, available_at, processing_started_at, completed_timestamp,
failed_timestamp, created_timestamp, updated_timestamp`

func scanPostgresCommunicationsEmailThreadDownloadJob(row communicationsEmailThreadDownloadJobScanner) (CommunicationsEmailThreadDownloadJob, error) {
	var item CommunicationsEmailThreadDownloadJob
	var processing, completed, failed sql.NullTime
	err := row.Scan(&item.DownloadJobID, &item.CompanyID, &item.EmailThreadID, &item.DownloadScope,
		&item.RequestedProviderMessageID, &item.RequestedByUserID, &item.Status, &item.AttemptCount,
		&item.LastError, &item.AvailableAt, &processing, &completed, &failed, &item.CreatedTimestamp, &item.UpdatedTimestamp)
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

func ensurePostgresCommunicationsEmailThreadDownloadJobTx(ctx context.Context, tx *sql.Tx, companyID, emailThreadID, downloadScope, requestedProviderMessageID, requestedByUserID string) (CommunicationsEmailThreadDownloadJob, bool, error) {
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	downloadScope = normalizeCommunicationsEmailThreadDownloadScope(downloadScope)
	requestedProviderMessageID = strings.TrimSpace(requestedProviderMessageID)
	requestedByUserID = cleanUUIDText(requestedByUserID)
	if companyID == "" || emailThreadID == "" || downloadScope == "" || requestedByUserID == "" || (downloadScope == CommunicationsEmailThreadDownloadScopeMessage && requestedProviderMessageID == "") {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrInvalid
	}
	lockKey := strings.Join([]string{companyID, emailThreadID, downloadScope, requestedProviderMessageID}, "\x1f")
	if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	var threadExists bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from email_threads where company_id=$1::uuid and email_thread_id=$2::uuid)`, companyID, emailThreadID).Scan(&threadExists); err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	if !threadExists {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrNotFound
	}
	item, err := scanPostgresCommunicationsEmailThreadDownloadJob(tx.QueryRowContext(ctx, `
select `+postgresCommunicationsEmailThreadDownloadJobColumns+`
from email_thread_download_jobs
where company_id=$1::uuid and email_thread_id=$2::uuid and download_scope=$3
  and requested_provider_message_id=$4 and status in ('pending','processing','retry')
order by created_timestamp limit 1 for update`, companyID, emailThreadID, downloadScope, requestedProviderMessageID))
	if err == nil {
		return item, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	item, err = scanPostgresCommunicationsEmailThreadDownloadJob(tx.QueryRowContext(ctx, `
insert into email_thread_download_jobs (
 download_job_id, company_id, email_thread_id, download_scope, requested_provider_message_id,
 requested_by_user_id, status, attempt_count, last_error, available_at, created_timestamp, updated_timestamp
) values ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,'pending',0,'',now(),now(),now())
returning `+postgresCommunicationsEmailThreadDownloadJobColumns,
		newUUIDv7String(), companyID, emailThreadID, downloadScope, requestedProviderMessageID, requestedByUserID))
	if err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `update email_threads set download_status='downloading', last_download_error='', updated_timestamp=now() where company_id=$1::uuid and email_thread_id=$2::uuid`, companyID, emailThreadID); err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	return item, true, nil
}

func (r *PostgresRepo) EnsureCommunicationsEmailThreadDownloadJob(companyID, emailThreadID, downloadScope, requestedProviderMessageID, requestedByUserID string) (CommunicationsEmailThreadDownloadJob, bool, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	defer tx.Rollback()
	item, created, err := ensurePostgresCommunicationsEmailThreadDownloadJobTx(ctx, tx, companyID, emailThreadID, downloadScope, requestedProviderMessageID, requestedByUserID)
	if err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsEmailThreadDownloadJob{}, false, err
	}
	return item, created, nil
}

func (r *PostgresRepo) ClaimCommunicationsEmailThreadDownloadJobs(limit int, processingLeaseTimeout time.Duration) ([]CommunicationsEmailThreadDownloadJob, error) {
	limit = NormalizeCommunicationsEmailThreadDownloadClaimLimit(limit)
	processingLeaseTimeout = NormalizeCommunicationsEmailThreadDownloadLease(processingLeaseTimeout)
	staleBefore := time.Now().UTC().Add(-processingLeaseTimeout)
	rows, err := r.db.QueryContext(context.Background(), `
with candidates as (
 select download_job_id
 from email_thread_download_jobs
 where ((status in ('pending','retry') and available_at<=now())
        or (status='processing' and processing_started_at<$2))
 order by available_at, created_timestamp
 limit $1
 for update skip locked
), claimed as (
 update email_thread_download_jobs target
 set status='processing', attempt_count=target.attempt_count+1, processing_started_at=now(), updated_timestamp=now()
 from candidates
 where target.download_job_id=candidates.download_job_id
 returning target.*
) select `+postgresCommunicationsEmailThreadDownloadJobColumns+` from claimed`, limit, staleBefore)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CommunicationsEmailThreadDownloadJob{}
	for rows.Next() {
		item, err := scanPostgresCommunicationsEmailThreadDownloadJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *PostgresRepo) MarkCommunicationsEmailThreadDownloadJobCompleted(downloadJobID string) error {
	downloadJobID = cleanUUIDText(downloadJobID)
	if downloadJobID == "" {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var companyID, emailThreadID string
	err = tx.QueryRowContext(ctx, `
update email_thread_download_jobs
set status='completed', last_error='', processing_started_at=null, completed_timestamp=now(), failed_timestamp=null, updated_timestamp=now()
where download_job_id=$1::uuid
returning company_id::text,email_thread_id::text`, downloadJobID).Scan(&companyID, &emailThreadID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
update email_threads t
set download_status=case when exists(
 select 1 from email_thread_download_jobs j
 where j.company_id=t.company_id and j.email_thread_id=t.email_thread_id and j.status in ('pending','processing','retry')
) then 'downloading' when t.history_complete then 'complete' else 'partial' end,
last_download_error='',updated_timestamp=now()
where company_id=$1::uuid and email_thread_id=$2::uuid`, companyID, emailThreadID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) MarkCommunicationsEmailThreadDownloadJobFailed(downloadJobID, lastError string, availableAt time.Time, final bool) error {
	downloadJobID = cleanUUIDText(downloadJobID)
	lastError = strings.TrimSpace(lastError)
	if downloadJobID == "" || lastError == "" {
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
	var companyID, emailThreadID string
	err = tx.QueryRowContext(ctx, `
update email_thread_download_jobs
set status=$2,last_error=$3,available_at=$4,processing_started_at=null,
    failed_timestamp=case when $2='failed' then now() else null end,updated_timestamp=now()
where download_job_id=$1::uuid
returning company_id::text,email_thread_id::text`, downloadJobID, status, lastError, availableAt.UTC()).Scan(&companyID, &emailThreadID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	threadStatus := CommunicationsEmailThreadDownloadDownloading
	if final {
		threadStatus = CommunicationsEmailThreadDownloadFailed
	}
	if _, err := tx.ExecContext(ctx, `update email_threads set download_status=$3,last_download_error=$4,updated_timestamp=now() where company_id=$1::uuid and email_thread_id=$2::uuid`, companyID, emailThreadID, threadStatus, lastError); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListCommunicationsEmailThreadDownloadJobs(companyID, emailThreadID string) ([]CommunicationsEmailThreadDownloadJob, error) {
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	if companyID == "" || emailThreadID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `select `+postgresCommunicationsEmailThreadDownloadJobColumns+` from email_thread_download_jobs where company_id=$1::uuid and email_thread_id=$2::uuid order by created_timestamp`, companyID, emailThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CommunicationsEmailThreadDownloadJob{}
	for rows.Next() {
		item, err := scanPostgresCommunicationsEmailThreadDownloadJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		var exists bool
		if err := r.db.QueryRow(`select exists(select 1 from email_threads where company_id=$1::uuid and email_thread_id=$2::uuid)`, companyID, emailThreadID).Scan(&exists); err != nil {
			return nil, err
		}
		if !exists {
			return nil, ErrNotFound
		}
	}
	return out, nil
}

func (r *PostgresRepo) ListCommunicationsEmailThreadNodeIDs(companyID, emailThreadID string) ([]string, error) {
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	if companyID == "" || emailThreadID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `select distinct resource_id::text from email_relationships where company_id=$1::uuid and email_thread_id=$2::uuid and resource_type='node' order by resource_id::text`, companyID, emailThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var nodeID string
		if err := rows.Scan(&nodeID); err != nil {
			return nil, err
		}
		out = append(out, nodeID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, ErrNotFound
	}
	sort.Strings(out)
	return out, nil
}
