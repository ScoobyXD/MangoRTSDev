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
select kind,attachment_id,preview_type
from (
  select 'orphan_attachment'::text kind,a.attachment_id,''::text preview_type,1 priority
  from attachments a
  where a.company_id=$1::uuid and a.deleted_timestamp is not null
  union all
  select 'email_send_preview',v.attachment_id,v.variant_type,2
  from attachment_variants v
  join attachments a on a.attachment_id=v.attachment_id
  where a.company_id=$1::uuid and a.deleted_timestamp is null
    and v.variant_type='email_send'
) work
order by priority,attachment_id
limit $2`, companyID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]WorkItem, 0)
	for rows.Next() {
		var kind string
		var item WorkItem
		if err := rows.Scan(&kind, &item.AttachmentID, &item.PreviewType); err != nil {
			return nil, err
		}
		item.CompanyID = companyID
		item.Kind = WorkKind(kind)
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
	var rows *sql.Rows
	var err error
	switch item.Kind {
	case WorkOrphanAttachment:
		rows, err = r.DB.QueryContext(ctx, `
select storage_bucket,storage_key
from (
  select a.storage_bucket,a.storage_key,1 priority,'original'::text object_type
  from attachments a
  where a.company_id=$1::uuid and a.attachment_id=$2::uuid
  union all
  select v.storage_bucket,v.storage_key,2,'legacy_'||v.variant_type
  from attachment_variants v
  join attachments a on a.attachment_id=v.attachment_id
  where a.company_id=$1::uuid and v.attachment_id=$2::uuid
  union all
  select p.storage_bucket,p.storage_key,3,'preview_'||p.preview_type
  from attachment_previews p
  join attachments a on a.attachment_id=p.attachment_id
  where a.company_id=$1::uuid and p.attachment_id=$2::uuid
) objects
order by priority,object_type`, item.CompanyID, item.AttachmentID)
	case WorkEmailSendPreview:
		rows, err = r.DB.QueryContext(ctx, `
select v.storage_bucket,v.storage_key
from attachment_variants v
join attachments a on a.attachment_id=v.attachment_id
where a.company_id=$1::uuid and v.attachment_id=$2::uuid
  and v.variant_type='email_send'`, item.CompanyID, item.AttachmentID)
	default:
		return nil, errors.New("unsupported cleanup work kind")
	}
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
	var eligible bool
	switch item.Kind {
	case WorkOrphanAttachment:
		err := r.DB.QueryRowContext(ctx, `
select exists(
  select 1
  from attachments a
  where a.company_id=$1::uuid and a.attachment_id=$2::uuid
    and a.deleted_timestamp is not null
    and not exists(select 1 from attachment_relationships relationship
      where relationship.company_id=a.company_id
        and relationship.attachment_id=a.attachment_id
        and relationship.deleted_timestamp is null)
    and not exists(select 1 from resource_attachments relationship
      where relationship.company_id=a.company_id
        and relationship.attachment_id=a.attachment_id
        and relationship.deleted_timestamp is null)
)`, item.CompanyID, item.AttachmentID).Scan(&eligible)
		return eligible, err
	case WorkEmailSendPreview:
		err := r.DB.QueryRowContext(ctx, `
select exists(
  select 1
  from attachment_variants variant
  join attachments attachment
    on attachment.attachment_id=variant.attachment_id
  where attachment.company_id=$1::uuid
    and attachment.attachment_id=$2::uuid
    and attachment.deleted_timestamp is null
    and variant.variant_type='email_send'
)`, item.CompanyID, item.AttachmentID).Scan(&eligible)
		return eligible, err
	default:
		return false, nil
	}
}

func (r PostgresRepository) SharedWithRetained(
	ctx context.Context,
	item WorkItem,
	object ObjectRef,
) (bool, error) {
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
  select 1
  from attachment_variants variant
  join attachments retained on retained.attachment_id=variant.attachment_id
  where retained.deleted_timestamp is null
    and variant.storage_bucket=$1 and variant.storage_key=$2
    and not ($3='email_send_preview'
      and retained.company_id=$4::uuid
      and variant.attachment_id=$5::uuid
      and variant.variant_type='email_send')
  union all
  select 1 from attachment_upload_intents upload
  where upload.storage_bucket=$1 and upload.storage_key=$2
    and upload.status in('pending','uploading','completing','failed')
  union all
  select 1 from attachment_upload_jobs upload
  where upload.storage_bucket=$1 and upload.storage_key=$2
    and upload.status in('pending','uploading','completing','failed')
)`, object.Bucket, object.Key, string(item.Kind), item.CompanyID, item.AttachmentID).Scan(&shared)
	return shared, err
}

func (r PostgresRepository) Finalize(ctx context.Context, item WorkItem) error {
	if r.DB == nil {
		return errors.New("postgres cleanup repository has no database")
	}
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer tx.Rollback()

	switch item.Kind {
	case WorkOrphanAttachment:
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
  union all
  select 1 from resource_attachments
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
delete from resource_attachments
where company_id=$1::uuid and attachment_id=$2::uuid;
delete from attachment_previews where attachment_id=$2::uuid;
delete from attachment_variants where attachment_id=$2::uuid`,
			item.CompanyID, item.AttachmentID); err != nil {
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
	case WorkEmailSendPreview:
		result, err := tx.ExecContext(ctx, `
delete from attachment_variants variant
using attachments attachment
where attachment.attachment_id=variant.attachment_id
  and attachment.company_id=$1::uuid
  and attachment.attachment_id=$2::uuid
  and attachment.deleted_timestamp is null
  and variant.variant_type='email_send'`,
			item.CompanyID, item.AttachmentID)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected > 1 {
			return fmt.Errorf("email_send cleanup affected %d rows", affected)
		}
	default:
		return errors.New("unsupported cleanup work kind")
	}
	return tx.Commit()
}
