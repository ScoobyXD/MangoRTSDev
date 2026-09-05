package httpapi

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"miraeopus/backend/internal/attachmentcleanup"
	"miraeopus/backend/internal/store"
)

const (
	attachmentDeletionCleanupBatch             = 100
	attachmentDeletionCleanupMaxItems          = 1000
	attachmentDeletionCleanupFailureRetryStart = time.Minute
	attachmentDeletionCleanupFailureRetryMax   = time.Hour
	attachmentDeletionCleanupContinueDelay     = time.Second
	attachmentDeletionCleanupRunTimeout        = 5 * time.Minute
)

type attachmentDeletionObjectStorage interface {
	Bucket() string
	DeleteObject(context.Context, string) error
}

type attachmentDeletionStorage struct {
	storage attachmentDeletionObjectStorage
}

func (s attachmentDeletionStorage) Bucket() string {
	return s.storage.Bucket()
}

func (s attachmentDeletionStorage) DeleteObject(ctx context.Context, key string) error {
	err := s.storage.DeleteObject(ctx, key)
	if errors.Is(err, ErrAttachmentObjectNotFound) {
		return attachmentcleanup.ErrObjectNotFound
	}
	return err
}

func (s *Server) runAttachmentDeletionCleanup(
	ctx context.Context,
	after *attachmentcleanup.Cursor,
) (attachmentcleanup.DrainResult, error) {
	ctx, cancel := context.WithTimeout(ctx, attachmentDeletionCleanupRunTimeout)
	defer cancel()
	storage, ok := s.attachmentStorage.(attachmentDeletionObjectStorage)
	if !ok {
		return attachmentcleanup.DrainResult{}, nil
	}
	repository, ok := s.repo.(attachmentcleanup.PendingRepository)
	if !ok {
		return attachmentcleanup.DrainResult{}, nil
	}
	result, err := attachmentcleanup.DrainPending(
		ctx,
		repository,
		attachmentDeletionStorage{storage: storage},
		attachmentcleanup.DrainOptions{
			BatchSize: attachmentDeletionCleanupBatch,
			MaxItems:  attachmentDeletionCleanupMaxItems,
			Apply:     true,
			After:     after,
		},
	)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			logAttachmentDeletionCleanupFailure("failed", "", "", "drain_work", err)
		}
	}
	for _, item := range result.Items {
		if item.Err != nil {
			logAttachmentDeletionCleanupFailure(
				"item_failed", item.CompanyID, item.AttachmentID, item.FailureStage, item.Err,
			)
		}
	}
	return result, err
}

func logAttachmentDeletionCleanupFailure(status, companyID, attachmentID, stage string, err error) {
	category, sqlState, safeErr := attachmentDeletionCleanupErrorDiagnostic(stage, err)
	message := "attachment_deletion_cleanup status=" + status
	if companyID != "" {
		message += " company_id=" + companyID
	}
	if attachmentID != "" {
		message += " attachment_id=" + attachmentID
	}
	log.Printf("%s stage=%s error_category=%s sqlstate=%s err=%q", message, stage, category, sqlState, safeErr)
}

func attachmentDeletionCleanupErrorDiagnostic(stage string, err error) (category, sqlState, safeErr string) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		sqlState = strings.TrimSpace(pgErr.Code)
		if sqlState == "" {
			sqlState = "unknown"
		}
		switch sqlState {
		case "42601":
			if strings.Contains(strings.ToLower(pgErr.Message), "multiple commands") {
				return "invalid_sql_statement", sqlState, "multiple commands are not allowed in one prepared statement"
			}
			return "invalid_sql_statement", sqlState, "invalid PostgreSQL statement"
		case "23503":
			return "foreign_key_violation", sqlState, "database row is still referenced"
		case "42501":
			return "insufficient_privilege", sqlState, "database permission denied"
		case "42P01":
			return "undefined_table", sqlState, "required database table is missing"
		case "42703":
			return "undefined_column", sqlState, "required database column is missing"
		default:
			return "postgres_error", sqlState, "PostgreSQL operation failed"
		}
	}
	if errors.Is(err, context.Canceled) {
		return "context_canceled", "none", "cleanup was canceled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "deadline_exceeded", "none", "cleanup deadline was exceeded"
	}
	if errors.Is(err, attachmentcleanup.ErrStillOwned) {
		return "attachment_still_owned", "none", "attachment still has a surviving relationship"
	}
	if errors.Is(err, ErrAttachmentStorageUnavailable) {
		return "storage_unavailable", "none", "attachment storage is unavailable"
	}
	switch stage {
	case "company_scope":
		return "invalid_company_scope", "none", "repository returned work for another company"
	case "validate_work_item":
		return "invalid_work_item", "none", "cleanup work item is invalid"
	case "validate_object_reference":
		return "invalid_object_reference", "none", "database object reference is incomplete"
	case "validate_storage_bucket":
		return "storage_bucket_mismatch", "none", "database object bucket does not match configured attachment bucket"
	case "delete_storage_object":
		return "storage_error", "none", "attachment storage request failed"
	case "company_list", "list_work", "drain_work", "lock_attachment_storage", "load_storage_objects", "recheck_eligibility", "check_retained_references", "finalize_database":
		return "database_error", "none", "database operation failed"
	default:
		return "cleanup_error", "none", "attachment cleanup failed"
	}
}

func (s *Server) wakeAttachmentDeletionCleanup() {
	if s.attachmentDeletionCleanupWake == nil {
		return
	}
	select {
	case s.attachmentDeletionCleanupWake <- struct{}{}:
	default:
	}
}

func (s *Server) startAttachmentDeletionCleanup() {
	if _, ok := s.attachmentStorage.(attachmentDeletionObjectStorage); !ok {
		return
	}
	if _, ok := s.repo.(*store.PostgresRepo); !ok {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.attachmentDeletionCleanupCancel = cancel
	go runAttachmentDeletionCleanupConsumer(
		ctx,
		s.attachmentDeletionCleanupWake,
		attachmentDeletionCleanupFailureRetryStart,
		attachmentDeletionCleanupFailureRetryMax,
		attachmentDeletionCleanupContinueDelay,
		s.runAttachmentDeletionCleanup,
	)
}

type attachmentDeletionCleanupRun func(
	context.Context,
	*attachmentcleanup.Cursor,
) (attachmentcleanup.DrainResult, error)

func runAttachmentDeletionCleanupConsumer(
	ctx context.Context,
	wake <-chan struct{},
	failureRetryStart time.Duration,
	failureRetryMax time.Duration,
	continueDelay time.Duration,
	run attachmentDeletionCleanupRun,
) {
	var cursor *attachmentcleanup.Cursor
	sweepFailed := false
	restartAfterSweep := false
	failureBackoff := newAttachmentDeletionFailureBackoff(failureRetryStart, failureRetryMax)

	for {
		result, err := run(ctx, cursor)
		if ctx.Err() != nil {
			return
		}
		sweepFailed = sweepFailed || result.FailureCount() > 0
		if result.NextCursor != nil {
			cursor = result.NextCursor
		}

		delay := time.Duration(0)
		failureWait := false
		switch {
		case err != nil:
			delay = failureBackoff.NextDelay()
			failureWait = true
		case result.NextCursor != nil:
			delay = continueDelay
		default:
			cursor = nil
			if sweepFailed {
				sweepFailed = false
				restartAfterSweep = false
				delay = failureBackoff.NextDelay()
				failureWait = true
			} else if restartAfterSweep {
				restartAfterSweep = false
				continue
			} else {
				failureBackoff.Reset()
			}
		}

		waitWake := wake
		if failureWait {
			// Coalesce new work while honoring the failure delay. Otherwise busy
			// producers would retry the same failed storage request at event rate.
			waitWake = nil
		}
		woke, active := waitForAttachmentDeletionCleanup(ctx, waitWake, delay)
		if !active {
			return
		}
		if failureWait {
			select {
			case <-wake:
				woke = true
			default:
			}
		}
		if woke && cursor != nil {
			restartAfterSweep = true
		}
	}
}

type attachmentDeletionFailureBackoff struct {
	initial time.Duration
	maximum time.Duration
	next    time.Duration
}

func newAttachmentDeletionFailureBackoff(initial, maximum time.Duration) *attachmentDeletionFailureBackoff {
	if initial <= 0 {
		initial = time.Minute
	}
	if maximum < initial {
		maximum = initial
	}
	return &attachmentDeletionFailureBackoff{initial: initial, maximum: maximum, next: initial}
}

func (b *attachmentDeletionFailureBackoff) NextDelay() time.Duration {
	delay := b.next
	if b.next < b.maximum {
		b.next *= 2
		if b.next > b.maximum {
			b.next = b.maximum
		}
	}
	return delay
}

func (b *attachmentDeletionFailureBackoff) Reset() {
	b.next = b.initial
}

func waitForAttachmentDeletionCleanup(
	ctx context.Context,
	wake <-chan struct{},
	delay time.Duration,
) (woke, active bool) {
	if delay <= 0 {
		select {
		case <-ctx.Done():
			return false, false
		case <-wake:
			return true, true
		}
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false, false
	case <-wake:
		return true, true
	case <-timer.C:
		return false, true
	}
}
