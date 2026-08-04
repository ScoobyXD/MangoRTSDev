package attachmentcleanup

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

type PostgresRepository struct {
	DB *sql.DB
}

func (r PostgresRepository) ListWork(ctx context.Context, companyID string, limit int) ([]WorkItem, error) {
	if r.DB == nil {
		return nil, errors.New("postgres cleanup repository has no database")
	}
	rows, err := r.DB.QueryContext(ctx, `
select attachment_id
from attachments
where company_id=$1::uuid and deleted_timestamp is not null
  and not exists (
    select 1 from attachment_relationships relationship
    where relationship.company_id=attachments.company_id
      and relationship.attachment_id=attachments.attachment_id
      and relationship.deleted_timestamp is null
  )
order by attachment_id
limit $2`, companyID, limit)
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
		objects, err := r.listObjects(ctx, item)
		if err != nil {
			return nil, err
		}
		item.Objects = objects
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r PostgresRepository) listObjects(ctx context.Context, item WorkItem) ([]ObjectRef, error) {
	if item.Kind != WorkOrphanAttachment {
		return nil, errors.New("unsupported cleanup work kind")
	}
	rows, err := r.DB.QueryContext(ctx, `
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
	err := r.DB.QueryRowContext(ctx, `
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
)`, item.CompanyID, item.AttachmentID).Scan(&eligible)
	return eligible, err
}

func (r PostgresRepository) SharedWithRetained(ctx context.Context, item WorkItem, object ObjectRef) (bool, error) {
	if r.DB == nil {
		return false, errors.New("postgres cleanup repository has no database")
	}
	var shared bool
	err := r.DB.QueryRowContext(ctx, `
select exists(
  select 1 from attachments retained
  where retained.deleted_timestamp is null
    and retained.storage_bucket=$1 and retained.storage_key=$2
  union all
  select 1
  from attachment_previews preview
  join attachments retained on retained.attachment_id=preview.attachment_id
  where retained.deleted_timestamp is null
    and preview.storage_bucket=$1 and preview.storage_key=$2
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
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var pending bool
	err = tx.QueryRowContext(ctx, `
select deleted_timestamp is not null
from attachments
where company_id=$1::uuid and attachment_id=$2::uuid
for update`, item.CompanyID, item.AttachmentID).Scan(&pending)
	if errors.Is(err, sql.ErrNoRows) {
		return tx.Commit()
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
)`, item.CompanyID, item.AttachmentID).Scan(&owned); err != nil {
		return err
	}
	if owned {
		return ErrStillOwned
	}
	if _, err := tx.ExecContext(ctx, `
delete from attachment_relationships
where company_id=$1::uuid and attachment_id=$2::uuid;
delete from attachment_previews where attachment_id=$2::uuid`, item.CompanyID, item.AttachmentID); err != nil {
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
	return tx.Commit()
}
