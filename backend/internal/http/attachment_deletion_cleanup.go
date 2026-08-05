package httpapi

import (
	"context"
	"errors"
	"log"
	"miraeopus/backend/internal/attachmentcleanup"
	"miraeopus/backend/internal/store"
	"time"
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
		log.Printf("attachment_deletion_cleanup status=failed company_id=%s", companyID)
		return attachmentcleanup.Result{}
	}
	for _, item := range result.Items {
		if item.Err != nil {
			log.Printf("attachment_deletion_cleanup status=item_failed company_id=%s attachment_id=%s", companyID, item.AttachmentID)
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
		log.Printf("attachment_deletion_cleanup status=company_list_failed err=%v", err)
		return
	}
	for _, companyID := range companyIDs {
		if ctx.Err() != nil {
			return
		}
		s.runAttachmentDeletionCleanup(ctx, companyID, attachmentDeletionCleanupBatch)
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
