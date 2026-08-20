package store

import (
	"context"
	"miraeopus/backend/internal/attachmentcleanup"
)

func (r *PostgresRepo) ListPendingAttachmentDeletionCompanyIDs(ctx context.Context) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `
select distinct attachment.company_id::text
from attachments attachment
where attachment.deleted_timestamp is not null
  and not exists (
    select 1 from attachment_relationships relationship
    where relationship.company_id=attachment.company_id
      and relationship.attachment_id=attachment.attachment_id
      and relationship.deleted_timestamp is null
  )
  and not exists (
    select 1 from recycle_bin_items recycle,
      lateral jsonb_array_elements(coalesce(recycle.restore_payload->'attachments','[]'::jsonb)) restored
    where recycle.company_id=attachment.company_id
      and restored->>'attachment_id'=attachment.attachment_id::text
  )
order by attachment.company_id::text`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	companyIDs := make([]string, 0)
	for rows.Next() {
		var companyID string
		if err := rows.Scan(&companyID); err != nil {
			return nil, err
		}
		companyIDs = append(companyIDs, companyID)
	}
	return companyIDs, rows.Err()
}

func (r *PostgresRepo) ListWork(ctx context.Context, companyID string, limit int) ([]attachmentcleanup.WorkItem, error) {
	return (attachmentcleanup.PostgresRepository{DB: r.db}).ListWork(ctx, companyID, limit)
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
