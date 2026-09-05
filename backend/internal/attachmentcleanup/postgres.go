package attachmentcleanup

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

type PostgresRepository struct {
	DB *sql.DB
	tx *sql.Tx
}

// LockAttachmentStorageTx serializes deletion and recreation of the same real
// attachment identity, including when its database row is temporarily absent.
func LockAttachmentStorageTx(ctx context.Context, tx *sql.Tx, companyID, attachmentID string) error {
	_, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended('attachment-storage:' || $1::uuid::text || ':' || $2::uuid::text, 0))`, companyID, attachmentID)
	return err
}

func (r PostgresRepository) WithItemLock(ctx context.Context, item WorkItem, run func(Repository) ItemResult) ItemResult {
	failure := ItemResult{Kind: item.Kind, CompanyID: item.CompanyID, AttachmentID: item.AttachmentID, FailureStage: "lock_attachment_storage"}
	if r.DB == nil {
		failure.Err = errors.New("postgres cleanup repository has no database")
		return failure
	}
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		failure.Err = err
		return failure
	}
	defer tx.Rollback()
	if err := LockAttachmentStorageTx(ctx, tx, item.CompanyID, item.AttachmentID); err != nil {
		failure.Err = err
		return failure
	}
	result := run(PostgresRepository{DB: r.DB, tx: tx})
	if result.Err != nil || !result.Finalized {
		return result
	}
	if err := tx.Commit(); err != nil {
		result.Finalized = false
		result.FailureStage = "finalize_database"
		result.Err = fmt.Errorf("commit attachment cleanup: %w", err)
	}
	return result
}

func (r PostgresRepository) queryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	if r.tx != nil {
		return r.tx.QueryContext(ctx, query, args...)
	}
	return r.DB.QueryContext(ctx, query, args...)
}

func (r PostgresRepository) queryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	if r.tx != nil {
		return r.tx.QueryRowContext(ctx, query, args...)
	}
	return r.DB.QueryRowContext(ctx, query, args...)
}

func (r PostgresRepository) ListPendingAttachmentDeletionCompanyIDs(ctx context.Context) ([]string, error) {
	if r.DB == nil {
		return nil, errors.New("postgres cleanup repository has no database")
	}
	rows, err := r.queryContext(ctx, `
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

func (r PostgresRepository) ListWork(ctx context.Context, companyID, afterAttachmentID string, limit int) ([]WorkItem, error) {
	if r.DB == nil {
		return nil, errors.New("postgres cleanup repository has no database")
	}
	var after any
	if afterAttachmentID != "" {
		after = afterAttachmentID
	}
	rows, err := r.queryContext(ctx, `
select attachment_id
from attachments
where company_id=$1::uuid and deleted_timestamp is not null
  and ($2::uuid is null or attachment_id>$2::uuid)
  and not exists (
    select 1 from attachment_relationships relationship
    where relationship.company_id=attachments.company_id
      and relationship.attachment_id=attachments.attachment_id
      and relationship.deleted_timestamp is null
  )
  and not exists (
    select 1 from recycle_bin_items recycle,
      lateral jsonb_array_elements(coalesce(recycle.restore_payload->'attachments','[]'::jsonb)) restored
    where recycle.company_id=attachments.company_id
      and restored->>'attachment_id'=attachments.attachment_id::text
  )
order by attachment_id
limit $3`, companyID, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]WorkItem, 0)
	for rows.Next() {
		var item WorkItem
		if err := rows.Scan(&item.AttachmentID); err != nil {
			return nil, err
		}
		item.CompanyID = companyID
		item.Kind = WorkOrphanAttachment
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r PostgresRepository) LoadObjects(ctx context.Context, item WorkItem) ([]ObjectRef, error) {
	if r.DB == nil {
		return nil, errors.New("postgres cleanup repository has no database")
	}
	if item.Kind != WorkOrphanAttachment {
		return nil, errors.New("unsupported cleanup work kind")
	}
	rows, err := r.queryContext(ctx, `
select storage_bucket,storage_key
from (
  select attachment.storage_bucket,attachment.storage_key,1 priority,'original'::text object_type
  from attachments attachment
  where attachment.company_id=$1::uuid and attachment.attachment_id=$2::uuid
  union all
  select preview.storage_bucket,preview.storage_key,2,'preview_'||preview.preview_type
  from attachment_previews preview
  join attachments attachment on attachment.attachment_id=preview.attachment_id
  where attachment.company_id=$1::uuid and preview.attachment_id=$2::uuid
) objects
order by priority,object_type`, item.CompanyID, item.AttachmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	objects := make([]ObjectRef, 0)
	for rows.Next() {
		var object ObjectRef
		if err := rows.Scan(&object.Bucket, &object.Key); err != nil {
			return nil, err
		}
		objects = append(objects, object)
	}
	return objects, rows.Err()
}

func (r PostgresRepository) Eligible(ctx context.Context, item WorkItem) (bool, error) {
	if r.DB == nil {
		return false, errors.New("postgres cleanup repository has no database")
	}
	if item.Kind != WorkOrphanAttachment {
		return false, nil
	}
	var eligible bool
	err := r.queryRowContext(ctx, `
select exists(
  select 1
  from attachments attachment
  where attachment.company_id=$1::uuid
    and attachment.attachment_id=$2::uuid
    and attachment.deleted_timestamp is not null
    and not exists(
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
)`, item.CompanyID, item.AttachmentID).Scan(&eligible)
	return eligible, err
}

func (r PostgresRepository) SharedWithRetained(ctx context.Context, item WorkItem, object ObjectRef) (bool, error) {
	if r.DB == nil {
		return false, errors.New("postgres cleanup repository has no database")
	}
	var shared bool
	err := r.queryRowContext(ctx, `
select exists(
  select 1 from attachments retained
  where retained.storage_bucket=$1 and retained.storage_key=$2
    and (retained.deleted_timestamp is null or exists (
      select 1 from recycle_bin_items recycle,
        lateral jsonb_array_elements(coalesce(recycle.restore_payload->'attachments','[]'::jsonb)) restored
      where recycle.company_id=retained.company_id
        and restored->>'attachment_id'=retained.attachment_id::text
    ))
  union all
  select 1
  from attachment_previews preview
  join attachments retained on retained.attachment_id=preview.attachment_id
  where preview.storage_bucket=$1 and preview.storage_key=$2
    and (retained.deleted_timestamp is null or exists (
      select 1 from recycle_bin_items recycle,
        lateral jsonb_array_elements(coalesce(recycle.restore_payload->'attachments','[]'::jsonb)) restored
      where recycle.company_id=retained.company_id
        and restored->>'attachment_id'=retained.attachment_id::text
    ))
  union all
  select 1 from attachment_upload_jobs upload
  where upload.storage_bucket=$1 and upload.storage_key=$2
    and upload.status in('pending','uploading','completing','failed')
)`, object.Bucket, object.Key).Scan(&shared)
	return shared, err
}

func (r PostgresRepository) Finalize(ctx context.Context, item WorkItem) error {
	if r.DB == nil {
		return errors.New("postgres cleanup repository has no database")
	}
	if item.Kind != WorkOrphanAttachment {
		return errors.New("unsupported cleanup work kind")
	}
	if r.tx != nil {
		return finalizeAttachmentTx(ctx, r.tx, item)
	}
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := LockAttachmentStorageTx(ctx, tx, item.CompanyID, item.AttachmentID); err != nil {
		return err
	}
	if err := finalizeAttachmentTx(ctx, tx, item); err != nil {
		return err
	}
	return tx.Commit()
}

func finalizeAttachmentTx(ctx context.Context, tx *sql.Tx, item WorkItem) error {
	var pending bool
	err := tx.QueryRowContext(ctx, `
select deleted_timestamp is not null
from attachments
where company_id=$1::uuid and attachment_id=$2::uuid
for update`, item.CompanyID, item.AttachmentID).Scan(&pending)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if !pending {
		return ErrStillOwned
	}
	var owned bool
	if err := tx.QueryRowContext(ctx, `
select exists(
  select 1 from attachment_relationships
  where company_id=$1::uuid and attachment_id=$2::uuid
    and deleted_timestamp is null
  union all
  select 1 from recycle_bin_items recycle,
    lateral jsonb_array_elements(coalesce(recycle.restore_payload->'attachments','[]'::jsonb)) restored
  where recycle.company_id=$1::uuid and restored->>'attachment_id'=$2::text
)`, item.CompanyID, item.AttachmentID).Scan(&owned); err != nil {
		return err
	}
	if owned {
		return ErrStillOwned
	}
	if _, err := tx.ExecContext(ctx, `
delete from attachment_relationships
where company_id=$1::uuid and attachment_id=$2::uuid`, item.CompanyID, item.AttachmentID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
delete from attachment_previews
where attachment_id=$1::uuid`, item.AttachmentID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
delete from attachments
where company_id=$1::uuid and attachment_id=$2::uuid
  and deleted_timestamp is not null`, item.CompanyID, item.AttachmentID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("hard delete affected %d attachments", affected)
	}
	return nil
}
