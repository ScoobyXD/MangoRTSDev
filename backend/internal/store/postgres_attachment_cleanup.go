package store

import (
	"context"
	"miraeopus/backend/internal/attachmentcleanup"
)

func (r *PostgresRepo) WithItemLock(ctx context.Context, item attachmentcleanup.WorkItem, run func(attachmentcleanup.Repository) attachmentcleanup.ItemResult) attachmentcleanup.ItemResult {
	return (attachmentcleanup.PostgresRepository{DB: r.db}).WithItemLock(ctx, item, run)
}

func (r *PostgresRepo) ListPendingAttachmentDeletionCompanyIDs(ctx context.Context) ([]string, error) {
	return (attachmentcleanup.PostgresRepository{DB: r.db}).ListPendingAttachmentDeletionCompanyIDs(ctx)
}

func (r *PostgresRepo) ListWork(ctx context.Context, companyID, afterAttachmentID string, limit int) ([]attachmentcleanup.WorkItem, error) {
	return (attachmentcleanup.PostgresRepository{DB: r.db}).ListWork(ctx, companyID, afterAttachmentID, limit)
}

func (r *PostgresRepo) LoadObjects(ctx context.Context, item attachmentcleanup.WorkItem) ([]attachmentcleanup.ObjectRef, error) {
	return (attachmentcleanup.PostgresRepository{DB: r.db}).LoadObjects(ctx, item)
}

func (r *PostgresRepo) Eligible(ctx context.Context, item attachmentcleanup.WorkItem) (bool, error) {
	return (attachmentcleanup.PostgresRepository{DB: r.db}).Eligible(ctx, item)
}

func (r *PostgresRepo) SharedWithRetained(ctx context.Context, item attachmentcleanup.WorkItem, object attachmentcleanup.ObjectRef) (bool, error) {
	return (attachmentcleanup.PostgresRepository{DB: r.db}).SharedWithRetained(ctx, item, object)
}

func (r *PostgresRepo) Finalize(ctx context.Context, item attachmentcleanup.WorkItem) error {
	return (attachmentcleanup.PostgresRepository{DB: r.db}).Finalize(ctx, item)
}
