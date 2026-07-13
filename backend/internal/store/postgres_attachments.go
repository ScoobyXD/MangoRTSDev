package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

const attachmentSelectColumns = `
a.company_id::text,
a.attachment_id::text,
coalesce(a.uploaded_by_user_id::text, ''),
a.original_filename,
a.mime_type,
a.byte_size,
a.sha256,
a.sha256_verification_method,
a.storage_checksum_algorithm,
a.storage_checksum_value,
a.storage_checksum_type,
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

const attachmentVariantSelectColumns = `
v.attachment_id::text,
v.variant_type,
v.mime_type,
v.byte_size,
v.sha256,
v.generation_version,
v.width,
v.height,
v.storage_bucket,
v.storage_key,
v.created_timestamp,
v.updated_timestamp`

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
  sha256_verification_method,
  storage_checksum_algorithm,
  storage_checksum_value,
  storage_checksum_type,
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
  $14,
  $15,
  $16,
  $17,
  $18
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
		attachment.SHA256VerificationMethod,
		attachment.StorageChecksumAlgorithm,
		attachment.StorageChecksumValue,
		attachment.StorageChecksumType,
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

func (r *PostgresRepo) GetAttachmentVariant(ctx context.Context, companyID, attachmentID, variantType string) (domain.AttachmentVariant, error) {
	companyID = strings.TrimSpace(companyID)
	attachmentID = cleanUUIDText(attachmentID)
	variantType = NormalizeAttachmentVariantType(variantType)
	if companyID == "" || attachmentID == "" || variantType == "" {
		return domain.AttachmentVariant{}, ErrInvalid
	}
	if variantType == AttachmentVariantOriginal {
		attachment, err := scanAttachment(r.db.QueryRowContext(ctx, `
select `+attachmentSelectColumns+` from attachments a
where a.company_id=$1::uuid and a.attachment_id=$2::uuid and a.deleted_timestamp is null`, companyID, attachmentID))
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
			UpdatedTimestamp: attachment.CreatedTimestamp,
		}, nil
	}
	variant, err := scanAttachmentVariant(r.db.QueryRowContext(ctx, `
select `+attachmentVariantSelectColumns+`
from attachment_variants v
join attachments a on a.attachment_id = v.attachment_id
where a.company_id=$1::uuid
  and a.attachment_id=$2::uuid
  and a.deleted_timestamp is null
  and v.variant_type=$3
  and v.sha256 is not null
  and v.generation_version=$4`,
		companyID, attachmentID, variantType, AttachmentVariantGenerationVersion,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.AttachmentVariant{}, ErrNotFound
	}
	return variant, err
}

func (r *PostgresRepo) ReadAttachmentContent(ctx context.Context, companyID, attachmentID, variantType string) (AttachmentContentRead, error) {
	companyID = strings.TrimSpace(companyID)
	attachmentID = cleanUUIDText(attachmentID)
	variantType = NormalizeAttachmentVariantType(variantType)
	if companyID == "" || attachmentID == "" || variantType == "" {
		return AttachmentContentRead{}, ErrInvalid
	}
	rows, err := r.db.QueryContext(ctx, `
select
  a.company_id::text,
  a.attachment_id::text,
  a.original_filename,
  a.mime_type,
  a.sha256,
  a.byte_size,
  a.storage_bucket,
  a.storage_key,
  a.created_timestamp,
  a.created_timestamp,
  $3,
  case when v.attachment_id is null then 'original' else v.variant_type end,
  coalesce(v.mime_type, a.mime_type),
  coalesce(v.byte_size, a.byte_size),
  case when v.attachment_id is null then a.sha256 else coalesce(v.sha256, '') end,
  coalesce(v.generation_version, 0),
  coalesce(v.width, a.original_width),
  coalesce(v.height, a.original_height),
  coalesce(v.storage_bucket, a.storage_bucket),
  coalesce(v.storage_key, a.storage_key),
  coalesce(v.created_timestamp, a.created_timestamp),
  coalesce(v.updated_timestamp, a.created_timestamp),
  `+resourceAttachmentSelectColumns+`
from attachments a
left join attachment_variants v
  on v.attachment_id=a.attachment_id
 and v.variant_type=$3
 and $3 <> 'original'
	and v.sha256 is not null
	and v.generation_version=1
join resource_attachments ra
  on ra.company_id=a.company_id
 and ra.attachment_id=a.attachment_id
 and ra.deleted_timestamp is null
where a.company_id=$1::uuid
  and a.attachment_id=$2::uuid
  and a.deleted_timestamp is null
order by ra.created_timestamp desc, ra.resource_attachment_id desc`, companyID, attachmentID, variantType)
	if err != nil {
		return AttachmentContentRead{}, err
	}
	defer rows.Close()
	var result AttachmentContentRead
	for rows.Next() {
		var link domain.ResourceAttachment
		var width, height sql.NullInt64
		var linkDeleted sql.NullTime
		if err := rows.Scan(
			&result.CompanyID, &result.AttachmentID, &result.OriginalFilename, &result.OriginalMimeType, &result.OriginalSHA256,
			&result.OriginalByteSize, &result.OriginalStorageBucket, &result.OriginalStorageKey, &result.OriginalCreatedTimestamp,
			&result.OriginalUpdatedTimestamp,
			&result.RequestedVariant, &result.ServedVariant, &result.MimeType, &result.ByteSize, &result.SHA256,
			&result.GenerationVersion, &width, &height, &result.StorageBucket, &result.StorageKey, &result.CreatedTimestamp,
			&result.UpdatedTimestamp,
			&link.ResourceAttachmentID, &link.CompanyID, &link.ResourceType, &link.ResourceID, &link.AttachmentID,
			&link.InformationID, &link.MessageID, &link.EditorSurface, &link.RelationshipKind, &link.CreatedByUserID,
			&link.CreatedTimestamp, &linkDeleted,
		); err != nil {
			return AttachmentContentRead{}, err
		}
		if width.Valid {
			value := int(width.Int64)
			result.Width = &value
		}
		if height.Valid {
			value := int(height.Int64)
			result.Height = &value
		}
		result.ResourceLinks = append(result.ResourceLinks, link)
	}
	if err := rows.Err(); err != nil {
		return AttachmentContentRead{}, err
	}
	if result.AttachmentID == "" {
		return AttachmentContentRead{}, ErrNotFound
	}
	return result, nil
}

func (r *PostgresRepo) UpsertAttachmentVariants(ctx context.Context, companyID string, inputs []AttachmentVariantInput) ([]domain.AttachmentVariant, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" || len(inputs) == 0 {
		return nil, ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, input := range inputs {
		attachmentID := cleanUUIDText(input.AttachmentID)
		variantType := NormalizeAttachmentVariantType(input.VariantType)
		mimeType := strings.TrimSpace(input.MimeType)
		bucket := strings.TrimSpace(input.StorageBucket)
		key := strings.TrimSpace(input.StorageKey)
		if attachmentID == "" || variantType == "" || variantType == AttachmentVariantOriginal || mimeType == "" ||
			input.ByteSize < 0 || bucket == "" || key == "" || !validAttachmentVariantGeneration(input) {
			return nil, ErrInvalid
		}
		created := input.CreatedTimestamp
		if created.IsZero() {
			created = time.Now().UTC()
		}
		result, err := tx.ExecContext(ctx, `
insert into attachment_variants (
  attachment_id, variant_type, mime_type, byte_size, sha256, generation_version,
  width, height, storage_bucket, storage_key, created_timestamp, updated_timestamp
)
select $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12
from attachments a
where a.company_id=$1::uuid and a.attachment_id=$2::uuid and a.deleted_timestamp is null
on conflict (attachment_id, variant_type) do update
set mime_type=excluded.mime_type,
    byte_size=excluded.byte_size,
    sha256=excluded.sha256,
    generation_version=excluded.generation_version,
    width=excluded.width,
    height=excluded.height,
    storage_bucket=excluded.storage_bucket,
    storage_key=excluded.storage_key,
    updated_timestamp=excluded.updated_timestamp
where (attachment_variants.mime_type, attachment_variants.byte_size, attachment_variants.sha256,
       attachment_variants.generation_version, attachment_variants.width, attachment_variants.height,
       attachment_variants.storage_bucket, attachment_variants.storage_key)
  is distinct from
      (excluded.mime_type, excluded.byte_size, excluded.sha256,
       excluded.generation_version, excluded.width, excluded.height,
       excluded.storage_bucket, excluded.storage_key)`,
			companyID, attachmentID, variantType, mimeType, input.ByteSize, nullableStringPointer(input.SHA256),
			nullableInt(input.GenerationVersion), nullableInt(input.Width), nullableInt(input.Height), bucket, key, created)
		if err != nil {
			return nil, err
		}
		if count, err := result.RowsAffected(); err != nil {
			return nil, err
		} else if count == 0 {
			var exists bool
			if err := tx.QueryRowContext(ctx, `select exists(select 1 from attachments where company_id=$1::uuid and attachment_id=$2::uuid and deleted_timestamp is null)`, companyID, attachmentID).Scan(&exists); err != nil {
				return nil, err
			}
			if !exists {
				return nil, ErrNotFound
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	items := make([]domain.AttachmentVariant, 0, len(inputs))
	for _, input := range inputs {
		item, err := r.GetAttachmentVariant(ctx, companyID, input.AttachmentID, input.VariantType)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func validAttachmentVariantGeneration(input AttachmentVariantInput) bool {
	if input.SHA256 != nil && !validRawSHA256(strings.TrimSpace(*input.SHA256)) {
		return false
	}
	return input.GenerationVersion == nil || *input.GenerationVersion > 0
}

func nullableStringPointer(value *string) any {
	if value == nil {
		return nil
	}
	return strings.TrimSpace(*value)
}

func (r *PostgresRepo) ListAttachmentResourceLinks(companyID, attachmentID string) ([]domain.ResourceAttachment, error) {
	companyID = strings.TrimSpace(companyID)
	attachmentID = cleanUUIDText(attachmentID)
	if companyID == "" || attachmentID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select
  coalesce(ra.resource_attachment_id::text, ''),
  a.company_id::text,
  coalesce(ra.resource_type, ''),
  coalesce(ra.resource_id, ''),
  a.attachment_id::text,
  coalesce(ra.information_id::text, ''),
  coalesce(ra.message_id, ''),
  coalesce(ra.editor_surface, ''),
  coalesce(ra.relationship_kind, ''),
  coalesce(ra.created_by_user_id::text, ''),
  coalesce(ra.created_timestamp, a.created_timestamp),
  ra.deleted_timestamp
from attachments a
left join resource_attachments ra
  on ra.company_id=a.company_id
 and ra.attachment_id=a.attachment_id
 and ra.deleted_timestamp is null
where a.company_id=$1::uuid
  and a.attachment_id=$2::uuid
  and a.deleted_timestamp is null
order by ra.created_timestamp desc nulls last, ra.resource_attachment_id desc nulls last`,
		companyID, attachmentID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.ResourceAttachment, 0)
	foundAttachment := false
	for rows.Next() {
		foundAttachment = true
		item, scanErr := scanResourceAttachment(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		if item.ResourceAttachmentID != "" {
			items = append(items, item)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !foundAttachment {
		return nil, ErrNotFound
	}
	return items, nil
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
		link.Attachment = &attachment
		items = append(items, link)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	variants, err := r.listResourceAttachmentVariants(context.Background(), companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	for index := range items {
		items[index].Attachment.Variants = variants[items[index].AttachmentID]
	}
	return items, nil
}

func (r *PostgresRepo) listResourceAttachmentVariants(ctx context.Context, companyID, resourceType, resourceID string) (map[string][]domain.AttachmentVariant, error) {
	rows, err := r.db.QueryContext(ctx, `
select `+attachmentVariantSelectColumns+`
from attachment_variants v
join attachments a on a.attachment_id=v.attachment_id
where a.company_id=$1::uuid
  and a.deleted_timestamp is null
  and exists (
    select 1 from resource_attachments ra
    where ra.company_id=$1::uuid and ra.resource_type=$2 and ra.resource_id=$3
      and ra.attachment_id=v.attachment_id and ra.deleted_timestamp is null
  )
order by v.attachment_id, v.variant_type`, companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make(map[string][]domain.AttachmentVariant)
	for rows.Next() {
		item, err := scanAttachmentVariant(rows)
		if err != nil {
			return nil, err
		}
		items[item.AttachmentID] = append(items[item.AttachmentID], item)
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
select `+attachmentVariantSelectColumns+`
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
		&item.SHA256VerificationMethod,
		&item.StorageChecksumAlgorithm,
		&item.StorageChecksumValue,
		&item.StorageChecksumType,
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
	var sha sql.NullString
	var generation sql.NullInt64
	var width sql.NullInt64
	var height sql.NullInt64
	err := row.Scan(
		&item.AttachmentID,
		&item.VariantType,
		&item.MimeType,
		&item.ByteSize,
		&sha,
		&generation,
		&width,
		&height,
		&item.StorageBucket,
		&item.StorageKey,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if sha.Valid {
		value := sha.String
		item.SHA256 = &value
	}
	if generation.Valid {
		value := int(generation.Int64)
		item.GenerationVersion = &value
	}
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
		&attachment.SHA256VerificationMethod,
		&attachment.StorageChecksumAlgorithm,
		&attachment.StorageChecksumValue,
		&attachment.StorageChecksumType,
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
