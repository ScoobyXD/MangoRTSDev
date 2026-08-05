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
	attachmentDeletionCleanupInterval = time.Minute
	attachmentDeletionCleanupBatch    = 100
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

func (s *Server) runAttachmentDeletionCleanup(ctx context.Context, companyID string, limit int) attachmentcleanup.Result {
	storage, ok := s.attachmentStorage.(attachmentDeletionObjectStorage)
	if !ok {
		return attachmentcleanup.Result{}
	}
	result, err := (attachmentcleanup.Service{
		Repository: s.repo,
		Storage:    attachmentDeletionStorage{storage: storage},
	}).Run(ctx, attachmentcleanup.Options{CompanyID: companyID, Limit: limit, Apply: true})
	if err != nil {
		logAttachmentDeletionCleanupFailure("failed", companyID, "", "list_work", err)
		return attachmentcleanup.Result{}
	}
	for _, item := range result.Items {
		if item.Err != nil {
			logAttachmentDeletionCleanupFailure(
				"item_failed", companyID, item.AttachmentID, item.FailureStage, item.Err,
			)
		}
	}
	return result
}

func (s *Server) cleanupPendingAttachmentDeletions(ctx context.Context) {
	repo, ok := s.repo.(*store.PostgresRepo)
	if !ok {
		return
	}
	companyIDs, err := repo.ListPendingAttachmentDeletionCompanyIDs(ctx)
	if err != nil {
		logAttachmentDeletionCleanupFailure("company_list_failed", "", "", "company_list", err)
		return
	}
	for _, companyID := range companyIDs {
		if ctx.Err() != nil {
			return
		}
		s.runAttachmentDeletionCleanup(ctx, companyID, attachmentDeletionCleanupBatch)
	}
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
	case "company_list", "list_work", "recheck_eligibility", "check_retained_references", "finalize_database":
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
	go func() {
		s.cleanupPendingAttachmentDeletions(ctx)
		ticker := time.NewTicker(attachmentDeletionCleanupInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-s.attachmentDeletionCleanupWake:
				s.cleanupPendingAttachmentDeletions(ctx)
			case <-ticker.C:
				s.cleanupPendingAttachmentDeletions(ctx)
			}
		}
	}()
}
