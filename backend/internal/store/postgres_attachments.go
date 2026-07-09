package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

const attachmentSelectColumns = `
a.company_id::text,
a.attachment_id::text,
coalesce(a.uploaded_by_user_id::text, ''),
a.original_filename,
a.mime_type,
a.byte_size,
a.sha256,
a.storage_bucket,
a.storage_key,
a.original_width,
a.original_height,
a.source_kind,
a.source_provider,
a.created_timestamp,
a.deleted_timestamp`

const resourceAttachmentSelectColumns = `
ra.resource_attachment_id::text,
ra.company_id::text,
ra.resource_type,
ra.resource_id,
ra.attachment_id::text,
coalesce(ra.information_id::text, ''),
ra.message_id,
ra.editor_surface,
ra.relationship_kind,
coalesce(ra.created_by_user_id::text, ''),
ra.created_timestamp,
ra.deleted_timestamp`

func (r *PostgresRepo) CreateAttachmentWithResourceLink(input AttachmentCreateInput) (domain.Attachment, domain.ResourceAttachment, error) {
	attachment, link, err := normalizeAttachmentCreateInput(input)
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	defer tx.Rollback()

	attachment, err = scanAttachment(tx.QueryRowContext(ctx, `
with inserted as (
insert into attachments (
  company_id,
  attachment_id,
  uploaded_by_user_id,
  original_filename,
  mime_type,
  byte_size,
  sha256,
  storage_bucket,
  storage_key,
  original_width,
  original_height,
  source_kind,
  source_provider,
  created_timestamp
)
values (
  $1::uuid,
  $2::uuid,
  nullif($3, '')::uuid,
  $4,
  $5,
  $6,
  $7,
  $8,
  $9,
  $10,
  $11,
  $12,
  $13,
  $14
)
returning *
)
select `+attachmentSelectColumns+`
from inserted a`,
		attachment.CompanyID,
		attachment.AttachmentID,
		attachment.UploadedByUserID,
		attachment.OriginalFilename,
		attachment.MimeType,
		attachment.ByteSize,
		attachment.SHA256,
		attachment.StorageBucket,
		attachment.StorageKey,
		nullableInt(attachment.OriginalWidth),
		nullableInt(attachment.OriginalHeight),
		attachment.SourceKind,
		attachment.SourceProvider,
		attachment.CreatedTimestamp,
	))
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}

	link.AttachmentID = attachment.AttachmentID
	link, err = insertOrReviveResourceAttachmentTx(ctx, tx, link)
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	return attachment, link, nil
}

func (r *PostgresRepo) GetAttachment(companyID, attachmentID string) (domain.Attachment, error) {
	attachmentID = cleanUUIDText(attachmentID)
	if strings.TrimSpace(companyID) == "" || attachmentID == "" {
		return domain.Attachment{}, ErrInvalid
	}
	attachment, err := scanAttachment(r.db.QueryRowContext(context.Background(), `
select `+attachmentSelectColumns+`
from attachments a
where a.company_id=$1::uuid
  and a.attachment_id=$2::uuid
  and a.deleted_timestamp is null`,
		companyID, attachmentID,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Attachment{}, ErrNotFound
	}
	if err != nil {
		return domain.Attachment{}, err
	}
	variants, err := r.listAttachmentVariants(context.Background(), companyID, attachmentID)
	if err != nil {
		return domain.Attachment{}, err
	}
	links, err := r.ListAttachmentResourceLinks(companyID, attachmentID)
	if err != nil {
		return domain.Attachment{}, err
	}
	attachment.Variants = variants
	attachment.ResourceLinks = links
	return attachment, nil
}

func (r *PostgresRepo) GetAttachmentVariant(companyID, attachmentID, variantType string) (domain.AttachmentVariant, error) {
	companyID = strings.TrimSpace(companyID)
	attachmentID = cleanUUIDText(attachmentID)
	variantType = NormalizeAttachmentVariantType(variantType)
	if companyID == "" || attachmentID == "" || variantType == "" {
		return domain.AttachmentVariant{}, ErrInvalid
	}
	if variantType == AttachmentVariantOriginal {
		attachment, err := r.GetAttachment(companyID, attachmentID)
		if err != nil {
			return domain.AttachmentVariant{}, err
		}
		return domain.AttachmentVariant{
			AttachmentID:     attachment.AttachmentID,
			VariantType:      AttachmentVariantOriginal,
			MimeType:         attachment.MimeType,
			ByteSize:         attachment.ByteSize,
			Width:            cloneAttachmentIntPointer(attachment.OriginalWidth),
			Height:           cloneAttachmentIntPointer(attachment.OriginalHeight),
			StorageBucket:    attachment.StorageBucket,
			StorageKey:       attachment.StorageKey,
			CreatedTimestamp: attachment.CreatedTimestamp,
		}, nil
	}
	variant, err := scanAttachmentVariant(r.db.QueryRowContext(context.Background(), `
select
  v.attachment_id::text,
  v.variant_type,
  v.mime_type,
  v.byte_size,
  v.width,
  v.height,
  v.storage_bucket,
  v.storage_key,
  v.created_timestamp
from attachment_variants v
join attachments a on a.attachment_id = v.attachment_id
where a.company_id=$1::uuid
  and a.attachment_id=$2::uuid
  and a.deleted_timestamp is null
  and v.variant_type=$3`,
		companyID, attachmentID, variantType,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.AttachmentVariant{}, ErrNotFound
	}
	return variant, err
}

func (r *PostgresRepo) ListAttachmentResourceLinks(companyID, attachmentID string) ([]domain.ResourceAttachment, error) {
	companyID = strings.TrimSpace(companyID)
	attachmentID = cleanUUIDText(attachmentID)
	if companyID == "" || attachmentID == "" {
		return nil, ErrInvalid
	}
	var exists bool
	if err := r.db.QueryRowContext(context.Background(), `
select exists(
  select 1
  from attachments
  where company_id=$1::uuid
    and attachment_id=$2::uuid
    and deleted_timestamp is null
)`, companyID, attachmentID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	rows, err := r.db.QueryContext(context.Background(), `
select `+resourceAttachmentSelectColumns+`
from resource_attachments ra
where ra.company_id=$1::uuid
  and ra.attachment_id=$2::uuid
  and ra.deleted_timestamp is null
order by ra.created_timestamp desc, ra.resource_attachment_id desc`,
		companyID, attachmentID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanResourceAttachments(rows)
}

func (r *PostgresRepo) ListResourceAttachments(companyID, resourceType, resourceID string) ([]domain.ResourceAttachment, error) {
	companyID = strings.TrimSpace(companyID)
	resourceType = NormalizeAttachmentResourceType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	if companyID == "" || resourceType == "" || resourceID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select
  `+resourceAttachmentSelectColumns+`,
  `+attachmentSelectColumns+`
from resource_attachments ra
join attachments a
  on a.company_id = ra.company_id
 and a.attachment_id = ra.attachment_id
where ra.company_id=$1::uuid
  and ra.resource_type=$2
  and ra.resource_id=$3
  and ra.deleted_timestamp is null
  and a.deleted_timestamp is null
order by ra.created_timestamp desc, ra.resource_attachment_id desc`,
		companyID, resourceType, resourceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.ResourceAttachment, 0)
	for rows.Next() {
		link, attachment, err := scanResourceAttachmentWithAttachment(rows)
		if err != nil {
			return nil, err
		}
		variants, err := r.listAttachmentVariants(context.Background(), companyID, attachment.AttachmentID)
		if err != nil {
			return nil, err
		}
		attachment.Variants = variants
		link.Attachment = &attachment
		items = append(items, link)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) LinkResourceAttachment(input ResourceAttachmentInput) (domain.ResourceAttachment, error) {
	link, err := normalizeResourceAttachmentInput(input)
	if err != nil {
		return domain.ResourceAttachment{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.ResourceAttachment{}, err
	}
	defer tx.Rollback()

	var exists bool
	if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from attachments
  where company_id=$1::uuid
    and attachment_id=$2::uuid
    and deleted_timestamp is null
)`, link.CompanyID, link.AttachmentID).Scan(&exists); err != nil {
		return domain.ResourceAttachment{}, err
	}
	if !exists {
		return domain.ResourceAttachment{}, ErrNotFound
	}

	link, err = insertOrReviveResourceAttachmentTx(ctx, tx, link)
	if err != nil {
		return domain.ResourceAttachment{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.ResourceAttachment{}, err
	}
	return link, nil
}

func (r *PostgresRepo) SoftDeleteResourceAttachment(input ResourceAttachmentDeleteInput) error {
	companyID := strings.TrimSpace(input.CompanyID)
	resourceType := NormalizeAttachmentResourceType(input.ResourceType)
	resourceID := strings.TrimSpace(input.ResourceID)
	attachmentID := cleanUUIDText(input.AttachmentID)
	if companyID == "" || resourceType == "" || resourceID == "" || attachmentID == "" {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `
update resource_attachments
set deleted_timestamp=now()
where company_id=$1::uuid
  and resource_type=$2
  and resource_id=$3
  and attachment_id=$4::uuid
  and deleted_timestamp is null`,
		companyID, resourceType, resourceID, attachmentID,
	)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

func insertOrReviveResourceAttachmentTx(ctx context.Context, tx *sql.Tx, link domain.ResourceAttachment) (domain.ResourceAttachment, error) {
	var existingID string
	err := tx.QueryRowContext(ctx, `
select resource_attachment_id::text
from resource_attachments
where company_id=$1::uuid
  and resource_type=$2
  and resource_id=$3
  and attachment_id=$4::uuid
  and relationship_kind=$5
  and coalesce(information_id::text, '')=$6
  and message_id=$7
  and editor_surface=$8
limit 1`,
		link.CompanyID,
		link.ResourceType,
		link.ResourceID,
		link.AttachmentID,
		link.RelationshipKind,
		link.InformationID,
		link.MessageID,
		link.EditorSurface,
	).Scan(&existingID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return domain.ResourceAttachment{}, err
	}
	if existingID != "" {
		return scanResourceAttachment(tx.QueryRowContext(ctx, `
with changed as (
update resource_attachments
set deleted_timestamp=null,
    created_by_user_id=nullif($2, '')::uuid,
    created_timestamp=$3
where resource_attachment_id=$1::uuid
returning *
)
select `+resourceAttachmentSelectColumns+`
from changed ra`,
			existingID,
			link.CreatedByUserID,
			link.CreatedTimestamp,
		))
	}
	return scanResourceAttachment(tx.QueryRowContext(ctx, `
with inserted as (
insert into resource_attachments (
  resource_attachment_id,
  company_id,
  resource_type,
  resource_id,
  attachment_id,
  information_id,
  message_id,
  editor_surface,
  relationship_kind,
  created_by_user_id,
  created_timestamp
)
values (
  $1::uuid,
  $2::uuid,
  $3,
  $4,
  $5::uuid,
  nullif($6, '')::uuid,
  $7,
  $8,
  $9,
  nullif($10, '')::uuid,
  $11
)
returning *
)
select `+resourceAttachmentSelectColumns+`
from inserted ra`,
		link.ResourceAttachmentID,
		link.CompanyID,
		link.ResourceType,
		link.ResourceID,
		link.AttachmentID,
		link.InformationID,
		link.MessageID,
		link.EditorSurface,
		link.RelationshipKind,
		link.CreatedByUserID,
		link.CreatedTimestamp,
	))
}

func (r *PostgresRepo) listAttachmentVariants(ctx context.Context, companyID, attachmentID string) ([]domain.AttachmentVariant, error) {
	rows, err := r.db.QueryContext(ctx, `
select
  v.attachment_id::text,
  v.variant_type,
  v.mime_type,
  v.byte_size,
  v.width,
  v.height,
  v.storage_bucket,
  v.storage_key,
  v.created_timestamp
from attachment_variants v
join attachments a on a.attachment_id = v.attachment_id
where a.company_id=$1::uuid
  and a.attachment_id=$2::uuid
order by v.variant_type`,
		companyID, attachmentID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.AttachmentVariant, 0)
	for rows.Next() {
		item, err := scanAttachmentVariant(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanAttachment(row interface{ Scan(dest ...any) error }) (domain.Attachment, error) {
	var item domain.Attachment
	var width sql.NullInt64
	var height sql.NullInt64
	var deleted sql.NullTime
	err := row.Scan(
		&item.CompanyID,
		&item.AttachmentID,
		&item.UploadedByUserID,
		&item.OriginalFilename,
		&item.MimeType,
		&item.ByteSize,
		&item.SHA256,
		&item.StorageBucket,
		&item.StorageKey,
		&width,
		&height,
		&item.SourceKind,
		&item.SourceProvider,
		&item.CreatedTimestamp,
		&deleted,
	)
	if width.Valid {
		value := int(width.Int64)
		item.OriginalWidth = &value
	}
	if height.Valid {
		value := int(height.Int64)
		item.OriginalHeight = &value
	}
	if deleted.Valid {
		item.DeletedTimestamp = &deleted.Time
	}
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Attachment{}, ErrNotFound
	}
	return item, err
}

func scanAttachmentVariant(row interface{ Scan(dest ...any) error }) (domain.AttachmentVariant, error) {
	var item domain.AttachmentVariant
	var width sql.NullInt64
	var height sql.NullInt64
	err := row.Scan(
		&item.AttachmentID,
		&item.VariantType,
		&item.MimeType,
		&item.ByteSize,
		&width,
		&height,
		&item.StorageBucket,
		&item.StorageKey,
		&item.CreatedTimestamp,
	)
	if width.Valid {
		value := int(width.Int64)
		item.Width = &value
	}
	if height.Valid {
		value := int(height.Int64)
		item.Height = &value
	}
	if errors.Is(err, sql.ErrNoRows) {
		return domain.AttachmentVariant{}, ErrNotFound
	}
	return item, err
}

func scanResourceAttachment(row interface{ Scan(dest ...any) error }) (domain.ResourceAttachment, error) {
	var item domain.ResourceAttachment
	var deleted sql.NullTime
	err := row.Scan(
		&item.ResourceAttachmentID,
		&item.CompanyID,
		&item.ResourceType,
		&item.ResourceID,
		&item.AttachmentID,
		&item.InformationID,
		&item.MessageID,
		&item.EditorSurface,
		&item.RelationshipKind,
		&item.CreatedByUserID,
		&item.CreatedTimestamp,
		&deleted,
	)
	if deleted.Valid {
		item.DeletedTimestamp = &deleted.Time
	}
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ResourceAttachment{}, ErrNotFound
	}
	return item, err
}

func scanResourceAttachments(rows *sql.Rows) ([]domain.ResourceAttachment, error) {
	items := make([]domain.ResourceAttachment, 0)
	for rows.Next() {
		item, err := scanResourceAttachment(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanResourceAttachmentWithAttachment(row interface{ Scan(dest ...any) error }) (domain.ResourceAttachment, domain.Attachment, error) {
	var link domain.ResourceAttachment
	var attachment domain.Attachment
	var linkDeleted sql.NullTime
	var width sql.NullInt64
	var height sql.NullInt64
	var attachmentDeleted sql.NullTime
	err := row.Scan(
		&link.ResourceAttachmentID,
		&link.CompanyID,
		&link.ResourceType,
		&link.ResourceID,
		&link.AttachmentID,
		&link.InformationID,
		&link.MessageID,
		&link.EditorSurface,
		&link.RelationshipKind,
		&link.CreatedByUserID,
		&link.CreatedTimestamp,
		&linkDeleted,
		&attachment.CompanyID,
		&attachment.AttachmentID,
		&attachment.UploadedByUserID,
		&attachment.OriginalFilename,
		&attachment.MimeType,
		&attachment.ByteSize,
		&attachment.SHA256,
		&attachment.StorageBucket,
		&attachment.StorageKey,
		&width,
		&height,
		&attachment.SourceKind,
		&attachment.SourceProvider,
		&attachment.CreatedTimestamp,
		&attachmentDeleted,
	)
	if linkDeleted.Valid {
		link.DeletedTimestamp = &linkDeleted.Time
	}
	if width.Valid {
		value := int(width.Int64)
		attachment.OriginalWidth = &value
	}
	if height.Valid {
		value := int(height.Int64)
		attachment.OriginalHeight = &value
	}
	if attachmentDeleted.Valid {
		attachment.DeletedTimestamp = &attachmentDeleted.Time
	}
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ResourceAttachment{}, domain.Attachment{}, ErrNotFound
	}
	return link, attachment, err
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}
