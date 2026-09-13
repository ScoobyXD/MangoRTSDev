package store

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const ctrlJobColumns = `j.job_id,j.company_id,j.user_id,j.name,j.instructions,j.email_connection_id,c.provider,j.time_zone,
CASE WHEN j.current_attachment_id IS NULL THEN 'Awaiting file' WHEN c.status<>'connected' THEN 'Error'
WHEN j.status='Processing' AND NOT EXISTS(SELECT 1 FROM ctrl_loop_run_jobs w JOIN ctrl_loop_runs r USING(company_id,run_id) WHERE w.company_id=j.company_id AND w.job_id=j.job_id AND r.status IN ('processing','saving') AND r.token_expires_at>now()) THEN 'Error' ELSE j.status END,
CASE WHEN c.status<>'connected' THEN 'Reconnect this mailbox in Mango Mail.' WHEN j.status='Processing' AND NOT EXISTS(SELECT 1 FROM ctrl_loop_run_jobs w JOIN ctrl_loop_runs r USING(company_id,run_id) WHERE w.company_id=j.company_id AND w.job_id=j.job_id AND r.status IN ('processing','saving') AND r.token_expires_at>now()) THEN 'The worker stopped before saving. The durable queue will retry.' ELSE j.last_error END,
coalesce(j.original_attachment_id::text,''),coalesce(j.current_attachment_id::text,''),coalesce(a.original_filename,''),
(SELECT count(*) FROM ctrl_loop_changes ch WHERE ch.company_id=j.company_id AND ch.job_id=j.job_id AND NOT ch.seen),j.last_updated,j.activated_at,j.revision`
const ctrlJobFrom = ` FROM ctrl_loop_jobs j JOIN email_connections c USING(company_id,email_connection_id)
LEFT JOIN attachments a ON a.company_id=j.company_id AND a.attachment_id=j.original_attachment_id `

type ctrlScanner interface{ Scan(...any) error }

func scanCtrlJob(row ctrlScanner) (CtrlLoopJob, error) {
	var j CtrlLoopJob
	err := row.Scan(&j.ID, &j.CompanyID, &j.UserID, &j.Name, &j.Instructions, &j.EmailConnectionID, &j.Provider, &j.TimeZone, &j.Status, &j.Error, &j.OriginalAttachmentID, &j.CurrentAttachmentID, &j.FileName, &j.UnseenUpdates, &j.LastUpdated, &j.ActivatedAt, &j.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return j, err
}
func (r *PostgresRepo) ListCtrlLoopJobs(ctx context.Context, c, u string) ([]CtrlLoopJob, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT `+ctrlJobColumns+ctrlJobFrom+`WHERE j.company_id=$1 AND j.user_id=$2 ORDER BY j.activated_at,j.job_id`, c, u)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CtrlLoopJob{}
	for rows.Next() {
		j, e := scanCtrlJob(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, j)
	}
	return out, rows.Err()
}
func (r *PostgresRepo) GetCtrlLoopJob(ctx context.Context, c, u, id string) (CtrlLoopJob, error) {
	return scanCtrlJob(r.db.QueryRowContext(ctx, `SELECT `+ctrlJobColumns+ctrlJobFrom+`WHERE j.company_id=$1 AND j.user_id=$2 AND j.job_id=$3`, c, u, id))
}
func (r *PostgresRepo) SaveCtrlLoopJob(ctx context.Context, j CtrlLoopJob) (CtrlLoopJob, error) {
	j.Name = strings.TrimSpace(j.Name)
	j.Instructions = strings.TrimSpace(j.Instructions)
	if len(j.Name) == 0 || len(j.Name) > 160 || len(j.Instructions) == 0 || len(j.Instructions) > 12000 {
		return j, ErrInvalid
	}
	if _, err := time.LoadLocation(j.TimeZone); err != nil || j.TimeZone == "" || j.TimeZone == "Local" {
		return j, ErrInvalid
	}
	err := r.WithCtrlLoopCompanyLock(ctx, j.CompanyID, func() error {
		if j.ID == "" {
			return r.db.QueryRowContext(ctx, `INSERT INTO ctrl_loop_jobs(company_id,user_id,email_connection_id,name,instructions,time_zone) VALUES($1,$2,$3,$4,$5,$6) RETURNING job_id`, j.CompanyID, j.UserID, j.EmailConnectionID, j.Name, j.Instructions, j.TimeZone).Scan(&j.ID)
		}
		result, e := r.db.ExecContext(ctx, `UPDATE ctrl_loop_jobs SET name=$4,instructions=$5,time_zone=$6,email_connection_id=$7,revision=revision+1,
activated_at=CASE WHEN email_connection_id<>$7::uuid OR instructions<>$5 THEN clock_timestamp() ELSE activated_at END,
status=CASE WHEN current_attachment_id IS NULL THEN 'Awaiting file' ELSE 'Listening' END,last_error=''
WHERE company_id=$1 AND user_id=$2 AND job_id=$3 AND revision=$8`, j.CompanyID, j.UserID, j.ID, j.Name, j.Instructions, j.TimeZone, j.EmailConnectionID, j.Revision)
		return ctrlAffected(result, e)
	})
	if err != nil {
		return j, err
	}
	return r.GetCtrlLoopJob(ctx, j.CompanyID, j.UserID, j.ID)
}
func ctrlAffected(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n != 1 {
		return ErrConflict
	}
	return err
}
func (r *PostgresRepo) AttachCtrlLoopWorkbook(ctx context.Context, c, u, id string, revision int64, attachment string) error {
	result, err := r.db.ExecContext(ctx, `UPDATE ctrl_loop_jobs j SET original_attachment_id=$5,current_attachment_id=$5,status='Listening',last_error='',activated_at=clock_timestamp(),revision=revision+1
WHERE company_id=$1 AND user_id=$2 AND job_id=$3 AND revision=$4 AND original_attachment_id IS NULL
AND EXISTS(SELECT 1 FROM attachment_relationships ar WHERE ar.company_id=j.company_id AND ar.resource_type='ctrl_loop_job' AND ar.resource_id=j.job_id::text AND ar.attachment_id=$5 AND ar.deleted_timestamp IS NULL)`, c, u, id, revision, attachment)
	return ctrlAffected(result, err)
}

// A database-owned session lock spans model and S3 work, across all worker
// processes/mailboxes. Only workbook work takes it. An attempt token additionally
// fences publishing if a worker loses its database connection.
func (r *PostgresRepo) WithCtrlLoopCompanyLock(ctx context.Context, c string, fn func() error) error {
	conn, err := r.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	var locked bool
	if err = conn.QueryRowContext(ctx, `SELECT pg_try_advisory_lock(hashtextextended('ctrl-loop:'||$1,0))`, c).Scan(&locked); err != nil {
		_ = conn.Raw(func(any) error { return driver.ErrBadConn })
		return err
	}
	if !locked {
		return ErrConflict
	}
	defer func() {
		release, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var released bool
		if err := conn.QueryRowContext(release, `SELECT pg_advisory_unlock(hashtextextended('ctrl-loop:'||$1,0))`, c).Scan(&released); err != nil || !released {
			_ = conn.Raw(func(any) error { return driver.ErrBadConn })
		}
	}()
	return fn()
}

const ctrlRunColumns = `r.run_id,r.company_id,r.email_connection_id,coalesce(r.email_message_id::text,''),coalesce(m.provider_message_id,''),r.status,r.last_error,r.arrival_at,r.source_url,r.session_id,r.created_at,r.completed_at,r.changed_cells`

func scanCtrlRun(row ctrlScanner) (CtrlLoopRun, error) {
	var run CtrlLoopRun
	err := row.Scan(&run.ID, &run.CompanyID, &run.EmailConnectionID, &run.EmailMessageID, &run.ProviderMessageID, &run.Status, &run.Error, &run.ArrivalAt, &run.SourceURL, &run.SessionID, &run.CreatedAt, &run.CompletedAt, &run.ChangedCells)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return run, err
}
func (r *PostgresRepo) GetCtrlLoopRun(ctx context.Context, c, id string) (CtrlLoopRun, error) {
	return scanCtrlRun(r.db.QueryRowContext(ctx, `SELECT `+ctrlRunColumns+` FROM ctrl_loop_runs r LEFT JOIN email_messages m ON m.company_id=r.company_id AND m.email_message_id=r.email_message_id WHERE r.company_id=$1 AND r.run_id=$2`, c, id))
}

func (r *PostgresRepo) HasCtrlLoopJobsForConnection(ctx context.Context, c, connection string) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM ctrl_loop_jobs WHERE company_id=$1 AND email_connection_id=$2 AND current_attachment_id IS NOT NULL)
OR EXISTS(SELECT 1 FROM ctrl_loop_runs WHERE company_id=$1 AND email_connection_id=$2 AND status<>'completed')`, c, connection).Scan(&exists)
	return exists, err
}

// DismissCtrlLoopRun terminally acknowledges a deleted source without publishing
// cells. The retained arrival and reason explain why the queued work stopped.
func (r *PostgresRepo) DismissCtrlLoopRun(ctx context.Context, c, id, reason string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE ctrl_loop_runs SET status='completed',last_error=$3,completed_at=clock_timestamp(),token_hash='',token_expires_at=NULL,changed_cells=0 WHERE company_id=$1 AND run_id=$2 AND email_message_id IS NULL AND status<>'completed'`, c, id, reason)
	if err = ctrlAffected(res, err); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE ctrl_loop_jobs j SET status='Error',last_error=$3 FROM ctrl_loop_runs r WHERE r.company_id=$1 AND r.run_id=$2 AND j.company_id=r.company_id AND j.email_connection_id=r.email_connection_id AND j.current_attachment_id IS NOT NULL AND j.activated_at<=r.arrival_at`, c, id, reason)
	if err != nil {
		return err
	}
	return tx.Commit()
}
func (r *PostgresRepo) AcceptCtrlLoopRun(ctx context.Context, job CommunicationsEmailIngestionJob, inboxFolderID string) (CtrlLoopRun, bool, error) {
	var id string
	err := r.db.QueryRowContext(ctx, `INSERT INTO ctrl_loop_runs(company_id,email_connection_id,email_thread_id,email_message_id,arrival_at)
SELECT m.company_id,t.email_connection_id,m.email_thread_id,m.email_message_id,m.message_timestamp FROM email_messages m JOIN email_threads t USING(company_id,email_thread_id)
WHERE m.company_id=$1 AND t.email_connection_id=$2 AND m.provider_message_id=$3 AND m.download_complete AND m.message_timestamp IS NOT NULL
AND (EXISTS(SELECT 1 FROM ctrl_loop_runs accepted WHERE accepted.company_id=m.company_id AND accepted.email_connection_id=t.email_connection_id AND accepted.email_message_id=m.email_message_id)
 OR (EXISTS(SELECT 1 FROM jsonb_array_elements_text(m.folder_snapshot || m.folder_id_snapshot) folder WHERE lower(folder)='inbox' OR ($4<>'' AND folder=$4))
 AND EXISTS(SELECT 1 FROM ctrl_loop_jobs j WHERE j.company_id=m.company_id AND j.email_connection_id=t.email_connection_id AND j.current_attachment_id IS NOT NULL AND j.activated_at<=m.message_timestamp)))
ON CONFLICT(company_id,email_connection_id,email_message_id) DO UPDATE SET email_message_id=excluded.email_message_id RETURNING run_id`, job.CompanyID, job.EmailConnectionID, job.ProviderMessageID, inboxFolderID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return CtrlLoopRun{}, false, nil
	}
	if err != nil {
		return CtrlLoopRun{}, false, err
	}
	run, err := r.GetCtrlLoopRun(ctx, job.CompanyID, id)
	return run, run.Status != "completed", err
}
func (r *PostgresRepo) StartCtrlLoopRun(ctx context.Context, c, id, hash string, expires time.Time) ([]CtrlLoopWork, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE ctrl_loop_runs SET status='processing',last_error='',token_hash=$3,token_expires_at=$4,source_url='',session_id='' WHERE company_id=$1 AND run_id=$2 AND status<>'completed' AND email_message_id IS NOT NULL`, c, id, hash, expires)
	if err = ctrlAffected(res, err); err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM ctrl_loop_run_jobs WHERE company_id=$1 AND run_id=$2`, c, id); err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO ctrl_loop_run_jobs(company_id,run_id,job_id,base_attachment_id,base_revision)
SELECT j.company_id,r.run_id,j.job_id,j.current_attachment_id,j.revision FROM ctrl_loop_jobs j JOIN ctrl_loop_runs r ON r.company_id=j.company_id AND r.email_connection_id=j.email_connection_id JOIN users u ON u.user_id=j.user_id
WHERE r.company_id=$1 AND r.run_id=$2 AND j.current_attachment_id IS NOT NULL AND j.activated_at<=r.arrival_at AND u.mailbox_enabled`, c, id)
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE ctrl_loop_jobs j SET status='Processing',last_error='' FROM ctrl_loop_run_jobs w WHERE w.company_id=$1 AND w.run_id=$2 AND j.company_id=w.company_id AND j.job_id=w.job_id`, c, id)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return r.ctrlLoopWork(ctx, c, id)
}
func (r *PostgresRepo) ctrlLoopWork(ctx context.Context, c, id string) ([]CtrlLoopWork, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT j.job_id,j.company_id,j.user_id,j.name,j.instructions,j.email_connection_id,j.time_zone,coalesce(j.original_attachment_id::text,''),coalesce(j.current_attachment_id::text,''),a.original_filename,j.revision,w.base_attachment_id,w.base_revision,w.targets
FROM ctrl_loop_run_jobs w JOIN ctrl_loop_jobs j USING(company_id,job_id) JOIN attachments a ON a.company_id=j.company_id AND a.attachment_id=j.original_attachment_id
JOIN company_memberships cm ON cm.company_id=j.company_id AND cm.user_id=j.user_id JOIN users u ON u.user_id=j.user_id
JOIN email_connections c ON c.company_id=j.company_id AND c.email_connection_id=j.email_connection_id
WHERE w.company_id=$1 AND w.run_id=$2 AND u.mailbox_enabled AND c.personal_user_id=j.user_id AND c.connection_type='personal' AND c.status='connected' ORDER BY j.job_id`, c, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CtrlLoopWork{}
	for rows.Next() {
		var w CtrlLoopWork
		err = rows.Scan(&w.ID, &w.CompanyID, &w.UserID, &w.Name, &w.Instructions, &w.EmailConnectionID, &w.TimeZone, &w.OriginalAttachmentID, &w.CurrentAttachmentID, &w.FileName, &w.Revision, &w.BaseAttachmentID, &w.BaseRevision, &w.Targets)
		if err != nil {
			return nil, err
		}
		if w.CurrentAttachmentID != w.BaseAttachmentID || w.Revision != w.BaseRevision {
			return nil, ErrConflict
		}
		out = append(out, w)
	}
	return out, rows.Err()
}
func (r *PostgresRepo) SetCtrlLoopSource(ctx context.Context, c, id, hash, url, session string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE ctrl_loop_runs SET source_url=$4,session_id=$5 WHERE company_id=$1 AND run_id=$2 AND token_hash=$3 AND status='processing' AND token_expires_at>now()`, c, id, hash, url, session)
	return ctrlAffected(res, err)
}
func (r *PostgresRepo) AuthorizeCtrlLoopToken(ctx context.Context, hash string) (CtrlLoopRun, []CtrlLoopWork, error) {
	run, err := scanCtrlRun(r.db.QueryRowContext(ctx, `SELECT `+ctrlRunColumns+` FROM ctrl_loop_runs r JOIN email_messages m ON m.company_id=r.company_id AND m.email_message_id=r.email_message_id WHERE r.token_hash=$1 AND r.status='processing' AND r.token_expires_at>now() AND r.source_url<>''`, hash))
	if err != nil {
		return run, nil, err
	}
	work, err := r.ctrlLoopWork(ctx, run.CompanyID, run.ID)
	return run, work, err
}
func (r *PostgresRepo) StageCtrlLoopTargets(ctx context.Context, hash string, byJob map[string]json.RawMessage) error {
	if len(byJob) == 0 {
		return ErrInvalid
	}
	for job, raw := range byJob {
		var targets []struct {
			Sheet string `json:"sheet"`
			Cell  string `json:"cell"`
		}
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&targets) != nil || len(targets) == 0 || len(targets) > 500 || strings.TrimSpace(job) == "" {
			return ErrInvalid
		}
		for _, target := range targets {
			if target.Sheet == "" || target.Cell == "" {
				return ErrInvalid
			}
		}
	}
	// Lock the run before staging, using the same row lock as Freeze. A tool
	// already in flight cannot add a target after publication begins.
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var c, id string
	err = tx.QueryRowContext(ctx, `SELECT company_id,run_id FROM ctrl_loop_runs WHERE token_hash=$1 AND status='processing' AND token_expires_at>now() FOR UPDATE`, hash).Scan(&c, &id)
	if err != nil {
		return ErrConflict
	}
	for job, targets := range byJob {
		res, err := tx.ExecContext(ctx, `UPDATE ctrl_loop_run_jobs w SET targets=(SELECT coalesce(jsonb_agg(DISTINCT v),'[]') FROM jsonb_array_elements(w.targets||$4::jsonb) v)
FROM ctrl_loop_jobs j WHERE w.company_id=$1 AND w.run_id=$2 AND w.job_id=$3 AND j.company_id=w.company_id AND j.job_id=w.job_id AND j.revision=w.base_revision AND j.current_attachment_id=w.base_attachment_id`, c, id, job, targets)
		if err = ctrlAffected(res, err); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (r *PostgresRepo) FreezeCtrlLoopRun(ctx context.Context, c, id, hash string) ([]CtrlLoopWork, error) {
	res, err := r.db.ExecContext(ctx, `UPDATE ctrl_loop_runs SET status='saving' WHERE company_id=$1 AND run_id=$2 AND token_hash=$3 AND status='processing' AND token_expires_at>now()`, c, id, hash)
	if err = ctrlAffected(res, err); err != nil {
		return nil, err
	}
	return r.ctrlLoopWork(ctx, c, id)
}
func (r *PostgresRepo) CompleteCtrlLoopRun(ctx context.Context, c, id, hash string, saved []CtrlLoopSavedWorkbook) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE ctrl_loop_runs SET status='completed',completed_at=clock_timestamp(),token_hash='',token_expires_at=NULL,last_error='' WHERE company_id=$1 AND run_id=$2 AND token_hash=$3 AND status='saving' AND token_expires_at>now()`, c, id, hash)
	if err = ctrlAffected(res, err); err != nil {
		return err
	}
	total := 0
	for _, book := range saved {
		res, err = tx.ExecContext(ctx, `UPDATE ctrl_loop_jobs j SET current_attachment_id=$4,last_updated=clock_timestamp(),revision=revision+1,status='Listening',last_error=''
FROM ctrl_loop_run_jobs w,users u,email_connections ec WHERE w.company_id=$1 AND w.run_id=$2 AND w.job_id=$3 AND j.company_id=w.company_id AND j.job_id=w.job_id
AND j.revision=w.base_revision AND j.current_attachment_id=w.base_attachment_id AND u.user_id=j.user_id AND u.mailbox_enabled AND ec.company_id=j.company_id AND ec.email_connection_id=j.email_connection_id AND ec.status='connected' AND ec.personal_user_id=j.user_id
AND EXISTS(SELECT 1 FROM attachment_relationships ar WHERE ar.company_id=j.company_id AND ar.resource_type='ctrl_loop_job' AND ar.resource_id=j.job_id::text AND ar.attachment_id=$4 AND ar.deleted_timestamp IS NULL)`, c, id, book.JobID, book.AttachmentID)
		if err = ctrlAffected(res, err); err != nil {
			return err
		}
		for _, ch := range book.Changes {
			_, err = tx.ExecContext(ctx, `INSERT INTO ctrl_loop_changes(company_id,run_id,job_id,sheet,cell,previous_text,display_text,source_url,arrival_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, c, id, book.JobID, ch.Sheet, ch.Cell, ch.PreviousText, ch.Text, ch.SourceURL, ch.ArrivalAt)
			if err != nil {
				return err
			}
			total++
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE ctrl_loop_runs SET changed_cells=$3 WHERE company_id=$1 AND run_id=$2`, c, id, total)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE ctrl_loop_jobs j SET status='Listening',last_error='' FROM ctrl_loop_run_jobs w WHERE w.company_id=$1 AND w.run_id=$2 AND j.company_id=w.company_id AND j.job_id=w.job_id`, c, id)
	if err != nil {
		return err
	}
	return tx.Commit()
}
func (r *PostgresRepo) FailCtrlLoopRun(ctx context.Context, c, id, hash, message string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE ctrl_loop_runs SET status='error',last_error=$4,token_hash='',token_expires_at=NULL WHERE company_id=$1 AND run_id=$2 AND token_hash=$3 AND status<>'completed'`, c, id, hash, message)
	if err = ctrlAffected(res, err); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE ctrl_loop_jobs j SET status='Error',last_error=$3 FROM ctrl_loop_run_jobs w WHERE w.company_id=$1 AND w.run_id=$2 AND j.company_id=w.company_id AND j.job_id=w.job_id`, c, id, message)
	if err != nil {
		return err
	}
	return tx.Commit()
}
func (r *PostgresRepo) ListCtrlLoopHistory(ctx context.Context, c, u, id, before string) ([]CtrlLoopChange, []CtrlLoopRun, bool, error) {
	if _, err := r.GetCtrlLoopJob(ctx, c, u, id); err != nil {
		return nil, nil, false, err
	}
	if before == "" {
		before = "9223372036854775807"
	}
	rows, err := r.db.QueryContext(ctx, `SELECT change_id::text,run_id,job_id,sheet,cell,previous_text,display_text,source_url,arrival_at,saved_at,seen FROM ctrl_loop_changes WHERE company_id=$1 AND job_id=$2 AND change_id<$3::bigint ORDER BY change_id DESC LIMIT 101`, c, id, before)
	if err != nil {
		return nil, nil, false, err
	}
	changes := []CtrlLoopChange{}
	for rows.Next() {
		var ch CtrlLoopChange
		if err = rows.Scan(&ch.ID, &ch.RunID, &ch.JobID, &ch.Sheet, &ch.Cell, &ch.PreviousText, &ch.Text, &ch.SourceURL, &ch.ArrivalAt, &ch.SavedAt, &ch.Seen); err != nil {
			rows.Close()
			return nil, nil, false, err
		}
		changes = append(changes, ch)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, false, err
	}
	more := len(changes) > 100
	if more {
		changes = changes[:100]
	}
	rows, err = r.db.QueryContext(ctx, `SELECT `+ctrlRunColumns+` FROM ctrl_loop_runs r JOIN ctrl_loop_run_jobs w USING(company_id,run_id) LEFT JOIN email_messages m ON m.company_id=r.company_id AND m.email_message_id=r.email_message_id WHERE w.company_id=$1 AND w.job_id=$2 ORDER BY r.created_at DESC LIMIT 20`, c, id)
	if err != nil {
		return nil, nil, false, err
	}
	defer rows.Close()
	runs := []CtrlLoopRun{}
	for rows.Next() {
		run, e := scanCtrlRun(rows)
		if e != nil {
			return nil, nil, false, e
		}
		runs = append(runs, run)
	}
	return changes, runs, more, rows.Err()
}
func (r *PostgresRepo) MarkCtrlLoopSeen(ctx context.Context, c, u, id string, ids []string) error {
	if len(ids) > 100 {
		return ErrInvalid
	}
	raw, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `UPDATE ctrl_loop_changes ch SET seen=true FROM ctrl_loop_jobs j WHERE j.company_id=$1 AND j.user_id=$2 AND j.job_id=$3 AND ch.company_id=j.company_id AND ch.job_id=j.job_id AND ch.change_id::text IN (SELECT jsonb_array_elements_text($4::jsonb))`, c, u, id, raw)
	return err
}
