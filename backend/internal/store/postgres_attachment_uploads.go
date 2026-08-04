package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

const attachmentUploadJobSelectColumns = `
ui.upload_job_id::text,
ui.company_id::text,
ui.actor_user_id::text,
ui.client_request_id,
ui.attachment_id::text,
coalesce(ui.attachment_relationship_id::text, ''),
ui.original_filename,
ui.mime_type,
ui.size_bytes,
ui.sha256,
ui.sha256_verification_method,
ui.storage_checksum_algorithm,
ui.storage_checksum_value,
ui.storage_checksum_type,
ui.resource_type,
ui.resource_id,
coalesce(ui.information_id::text, ''),
ui.message_id,
ui.editor_surface,
ui.relationship_kind,
ui.source_kind,
ui.source_provider,
ui.original_width,
ui.original_height,
ui.storage_bucket,
ui.storage_key,
ui.multipart_upload_id,
ui.strategy,
ui.part_size_bytes,
ui.part_count,
ui.status,
ui.failure_code,
ui.version,
ui.created_timestamp,
ui.updated_timestamp,
ui.expires_timestamp,
ui.completed_timestamp`

const attachmentUploadPartSelectColumns = `
p.upload_job_id::text,
p.part_number,
p.expected_size_bytes,
p.observed_size_bytes,
p.checksum_algorithm,
p.expected_checksum,
p.etag,
p.s3_checksum,
p.signing_attempt_count,
p.last_signed_timestamp,
p.uploaded_timestamp,
p.created_timestamp,
p.updated_timestamp`

func (r *PostgresRepo) GetAttachmentUploadIntentByClientRequest(companyID, actorUserID, clientRequestID string) (domain.AttachmentUploadIntent, error) {
	companyID = strings.TrimSpace(companyID)
	actorUserID = cleanUUIDText(actorUserID)
	clientRequestID = strings.TrimSpace(clientRequestID)
	if companyID == "" || actorUserID == "" || clientRequestID == "" {
		return domain.AttachmentUploadIntent{}, ErrInvalid
	}
	intent, err := scanAttachmentUploadIntent(r.db.QueryRowContext(context.Background(), `
select `+attachmentUploadJobSelectColumns+`
from attachment_upload_jobs ui
where ui.company_id=$1::uuid and ui.actor_user_id=$2::uuid and ui.client_request_id=$3`, companyID, actorUserID, clientRequestID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.AttachmentUploadIntent{}, ErrNotFound
	}
	return intent, err
}

func (r *PostgresRepo) CreateAttachmentUploadIntent(input AttachmentUploadIntentCreateInput) (domain.AttachmentUploadIntent, bool, error) {
	intent, err := normalizeAttachmentUploadIntentCreateInput(input)
	if err != nil {
		return domain.AttachmentUploadIntent{}, false, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.AttachmentUploadIntent{}, false, err
	}
	defer tx.Rollback()
	createdIntent, err := scanAttachmentUploadIntent(tx.QueryRowContext(ctx, `
with inserted as (
  insert into attachment_upload_jobs (
    upload_job_id, company_id, actor_user_id, client_request_id, attachment_id,
    original_filename, mime_type, size_bytes, sha256, sha256_verification_method,
    resource_type, resource_id, information_id, message_id, editor_surface,
    relationship_kind, source_kind, source_provider, original_width, original_height,
    storage_bucket, storage_key, multipart_upload_id, strategy, part_size_bytes, part_count,
    status, version, created_timestamp, updated_timestamp, expires_timestamp
  ) values (
    $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid,
    $6, $7, $8, $9, $10,
    $11, $12, nullif($13, '')::uuid, $14, $15,
    $16, $17, $18, $19, $20,
    $21, $22, $23, $24, $25, $26,
    $27, $28, $29, $29, $30
  )
  on conflict (company_id, actor_user_id, client_request_id) do nothing
  returning *
)
select `+attachmentUploadJobSelectColumns+` from inserted ui`,
		intent.UploadIntentID, intent.CompanyID, intent.ActorUserID, intent.ClientRequestID, intent.AttachmentID,
		intent.OriginalFilename, intent.MimeType, intent.SizeBytes, intent.SHA256, intent.SHA256VerificationMethod,
		intent.ResourceType, intent.ResourceID, intent.InformationID, intent.MessageID, intent.EditorSurface,
		intent.RelationshipKind, intent.SourceKind, intent.SourceProvider, nullableInt(intent.OriginalWidth), nullableInt(intent.OriginalHeight),
		intent.StorageBucket, intent.StorageKey, intent.MultipartUploadID, intent.Strategy, intent.PartSizeBytes, intent.PartCount,
		intent.Status, intent.Version, intent.CreatedTimestamp, intent.ExpiresTimestamp))
	created := err == nil
	if errors.Is(err, sql.ErrNoRows) {
		createdIntent, err = scanAttachmentUploadIntent(tx.QueryRowContext(ctx, `
select `+attachmentUploadJobSelectColumns+` from attachment_upload_jobs ui
where ui.company_id=$1::uuid and ui.actor_user_id=$2::uuid and ui.client_request_id=$3
for update`, intent.CompanyID, intent.ActorUserID, intent.ClientRequestID))
		if err == nil && !sameAttachmentUploadPayload(createdIntent, intent) {
			return domain.AttachmentUploadIntent{}, false, ErrUploadPayloadConflict
		}
	}
	if err != nil {
		return domain.AttachmentUploadIntent{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return domain.AttachmentUploadIntent{}, false, err
	}
	return createdIntent, created, nil
}

func (r *PostgresRepo) GetAttachmentUploadIntent(companyID, actorUserID, uploadIntentID string) (domain.AttachmentUploadIntent, error) {
	intent, err := scanAttachmentUploadIntent(r.db.QueryRowContext(context.Background(), `
select `+attachmentUploadJobSelectColumns+` from attachment_upload_jobs ui
where ui.company_id=$1::uuid and ui.actor_user_id=$2::uuid and ui.upload_job_id=$3::uuid`,
		strings.TrimSpace(companyID), cleanUUIDText(actorUserID), cleanUUIDText(uploadIntentID)))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.AttachmentUploadIntent{}, ErrNotFound
	}
	return intent, err
}

func (r *PostgresRepo) UpsertAttachmentUploadParts(input AttachmentUploadPartsInput) ([]domain.AttachmentUploadPart, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	intent, err := lockAttachmentUploadIntent(ctx, tx, input.CompanyID, input.ActorUserID, input.UploadIntentID, input.Now)
	if err != nil {
		return nil, err
	}
	if intent.Strategy != domain.AttachmentUploadStrategyMultipart || (intent.Status != domain.AttachmentUploadStatusPending && intent.Status != domain.AttachmentUploadStatusUploading) {
		return nil, ErrUploadStateConflict
	}
	now := normalizedUploadNow(input.Now)
	for _, requested := range input.Parts {
		part, err := normalizeAttachmentUploadPart(intent, requested, now)
		if err != nil {
			return nil, err
		}
		var stored domain.AttachmentUploadPart
		err = scanAttachmentUploadPart(tx.QueryRowContext(ctx, `
insert into attachment_upload_parts (
  upload_job_id, part_number, expected_size_bytes, checksum_algorithm, expected_checksum,
  signing_attempt_count, last_signed_timestamp, created_timestamp, updated_timestamp
) values ($1::uuid, $2, $3, $4, $5, 1, $6, $6, $6)
on conflict (upload_job_id, part_number) do update
set signing_attempt_count=attachment_upload_parts.signing_attempt_count+1,
    last_signed_timestamp=excluded.last_signed_timestamp,
    updated_timestamp=excluded.updated_timestamp
where attachment_upload_parts.expected_size_bytes=excluded.expected_size_bytes
  and attachment_upload_parts.checksum_algorithm=excluded.checksum_algorithm
  and attachment_upload_parts.expected_checksum=excluded.expected_checksum
returning `+strings.ReplaceAll(attachmentUploadPartSelectColumns, "p.", "attachment_upload_parts."),
			intent.UploadIntentID, part.PartNumber, part.ExpectedSizeBytes, part.ChecksumAlgorithm, part.ExpectedChecksum, now), &stored)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUploadPayloadConflict
		}
		if err != nil {
			return nil, err
		}
	}
	if _, err := tx.ExecContext(ctx, `update attachment_upload_jobs
set status='uploading', failure_code='', version=version+1, updated_timestamp=$2
where upload_job_id=$1::uuid`, intent.UploadIntentID, now); err != nil {
		return nil, err
	}
	parts, err := listAttachmentUploadPartsTx(ctx, tx, intent.UploadIntentID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return parts, nil
}

func (r *PostgresRepo) ReplaceAttachmentUploadObservedParts(input AttachmentUploadObservedPartsInput) ([]domain.AttachmentUploadPart, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	intent, err := lockAttachmentUploadIntent(ctx, tx, input.CompanyID, input.ActorUserID, input.UploadIntentID, input.Now)
	if err != nil {
		return nil, err
	}
	if intent.Strategy != domain.AttachmentUploadStrategyMultipart {
		return nil, ErrUploadStateConflict
	}
	now := normalizedUploadNow(input.Now)
	if _, err := tx.ExecContext(ctx, `update attachment_upload_parts set observed_size_bytes=0, etag='', s3_checksum='', uploaded_timestamp=null, updated_timestamp=$2 where upload_job_id=$1::uuid`, intent.UploadIntentID, now); err != nil {
		return nil, err
	}
	for _, observed := range input.Parts {
		result, err := tx.ExecContext(ctx, `update attachment_upload_parts
set observed_size_bytes=$3, etag=$4, s3_checksum=$5, uploaded_timestamp=coalesce($6, $7), updated_timestamp=$7
where upload_job_id=$1::uuid and part_number=$2`, intent.UploadIntentID, observed.PartNumber,
			observed.ObservedSizeBytes, strings.Trim(strings.TrimSpace(observed.ETag), "\""), strings.TrimSpace(observed.S3Checksum),
			observed.UploadedTimestamp, now)
		if err != nil {
			return nil, err
		}
		count, err := result.RowsAffected()
		if err != nil || count != 1 {
			return nil, ErrInvalid
		}
	}
	if _, err := tx.ExecContext(ctx, `update attachment_upload_jobs set version=version+1, updated_timestamp=$2 where upload_job_id=$1::uuid`, intent.UploadIntentID, now); err != nil {
		return nil, err
	}
	parts, err := listAttachmentUploadPartsTx(ctx, tx, intent.UploadIntentID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return parts, nil
}

func (r *PostgresRepo) ListAttachmentUploadParts(companyID, actorUserID, uploadIntentID string) ([]domain.AttachmentUploadPart, error) {
	if _, err := r.GetAttachmentUploadIntent(companyID, actorUserID, uploadIntentID); err != nil {
		return nil, err
	}
	rows, err := r.db.QueryContext(context.Background(), `select `+attachmentUploadPartSelectColumns+` from attachment_upload_parts p where p.upload_job_id=$1::uuid order by p.part_number`, cleanUUIDText(uploadIntentID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAttachmentUploadParts(rows)
}

func (r *PostgresRepo) BeginAttachmentUploadCompletion(input AttachmentUploadTransitionInput) (domain.AttachmentUploadIntent, bool, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.AttachmentUploadIntent{}, false, err
	}
	defer tx.Rollback()
	intent, err := lockAttachmentUploadIntent(ctx, tx, input.CompanyID, input.ActorUserID, input.UploadIntentID, input.Now)
	if err != nil {
		return domain.AttachmentUploadIntent{}, false, err
	}
	if intent.Status == domain.AttachmentUploadStatusCompleted {
		return intent, false, tx.Commit()
	}
	now := normalizedUploadNow(input.Now)
	if intent.Status == domain.AttachmentUploadStatusCompleting && now.Sub(intent.UpdatedTimestamp) < 2*time.Minute {
		return intent, false, tx.Commit()
	}
	if intent.Status != domain.AttachmentUploadStatusPending && intent.Status != domain.AttachmentUploadStatusUploading && intent.Status != domain.AttachmentUploadStatusCompleting {
		return domain.AttachmentUploadIntent{}, false, ErrUploadStateConflict
	}
	intent, err = scanAttachmentUploadIntent(tx.QueryRowContext(ctx, `
with changed as (
 update attachment_upload_jobs set status='completing', failure_code='', updated_timestamp=$2, version=version+1
 where upload_job_id=$1::uuid returning *
)
select `+attachmentUploadJobSelectColumns+` from changed ui`, intent.UploadIntentID, now))
	if err != nil {
		return domain.AttachmentUploadIntent{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return domain.AttachmentUploadIntent{}, false, err
	}
	return intent, true, nil
}

func (r *PostgresRepo) ReopenAttachmentUploadIntent(input AttachmentUploadTransitionInput, failureCode string) (domain.AttachmentUploadIntent, error) {
	return r.transitionAttachmentUpload(input, func(intent domain.AttachmentUploadIntent) (string, string, error) {
		if intent.Status == domain.AttachmentUploadStatusCompleted {
			return intent.Status, intent.FailureCode, nil
		}
		if intent.Status != domain.AttachmentUploadStatusCompleting && intent.Status != domain.AttachmentUploadStatusFailed {
			return "", "", ErrUploadStateConflict
		}
		return domain.AttachmentUploadStatusUploading, strings.TrimSpace(failureCode), nil
	})
}

func (r *PostgresRepo) FailAttachmentUploadIntent(input AttachmentUploadTransitionInput, failureCode string) (domain.AttachmentUploadIntent, error) {
	return r.transitionAttachmentUpload(input, func(intent domain.AttachmentUploadIntent) (string, string, error) {
		if intent.Status == domain.AttachmentUploadStatusCompleted || intent.Status == domain.AttachmentUploadStatusAborted || intent.Status == domain.AttachmentUploadStatusExpired {
			return "", "", ErrUploadStateConflict
		}
		return domain.AttachmentUploadStatusFailed, strings.TrimSpace(failureCode), nil
	})
}

func (r *PostgresRepo) FinalizeAttachmentUpload(input AttachmentUploadFinalizeInput) (domain.Attachment, domain.ResourceAttachment, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	defer tx.Rollback()
	intent, err := lockAttachmentUploadIntent(ctx, tx, input.CompanyID, input.ActorUserID, input.UploadIntentID, input.Now)
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	if intent.Status == domain.AttachmentUploadStatusCompleted {
		attachment, err := scanAttachment(tx.QueryRowContext(ctx, `select `+attachmentSelectColumns+` from attachments a where a.company_id=$1::uuid and a.attachment_id=$2::uuid`, intent.CompanyID, intent.AttachmentID))
		if err != nil {
			return domain.Attachment{}, domain.ResourceAttachment{}, err
		}
		var link domain.ResourceAttachment
		if intent.ResourceAttachmentID != "" {
			link, err = scanResourceAttachment(tx.QueryRowContext(ctx, `select `+resourceAttachmentSelectColumns+`
from attachment_relationships ra
where ra.company_id=$1::uuid and ra.attachment_id=$2::uuid and ra.attachment_relationship_id=$3::uuid`,
				intent.CompanyID, intent.AttachmentID, intent.ResourceAttachmentID))
		} else {
			link, err = scanResourceAttachment(tx.QueryRowContext(ctx, `select `+resourceAttachmentSelectColumns+`
from attachment_relationships ra
where ra.company_id=$1::uuid and ra.attachment_id=$2::uuid and ra.resource_type=$3 and ra.resource_id=$4
  and ra.relationship_kind=$5 and coalesce(ra.information_id::text, '')=$6 and ra.message_id=$7
  and ra.editor_surface=$8
limit 1`, intent.CompanyID, intent.AttachmentID, intent.ResourceType, intent.ResourceID, intent.RelationshipKind,
				intent.InformationID, intent.MessageID, intent.EditorSurface))
		}
		if err != nil {
			return domain.Attachment{}, domain.ResourceAttachment{}, err
		}
		return attachment, link, tx.Commit()
	}
	if intent.Status != domain.AttachmentUploadStatusCompleting {
		return domain.Attachment{}, domain.ResourceAttachment{}, ErrUploadStateConflict
	}
	now := normalizedUploadNow(input.Now)
	attachmentInput := AttachmentCreateInput{
		CompanyID: intent.CompanyID, AttachmentID: intent.AttachmentID, UploadedByUserID: intent.ActorUserID,
		OriginalFilename: intent.OriginalFilename, MimeType: intent.MimeType, ByteSize: intent.SizeBytes, SHA256: intent.SHA256,
		SHA256VerificationMethod: input.SHA256VerificationMethod, StorageChecksumAlgorithm: input.StorageChecksumAlgorithm,
		StorageChecksumValue: input.StorageChecksumValue, StorageChecksumType: input.StorageChecksumType,
		StorageBucket: intent.StorageBucket, StorageKey: intent.StorageKey, OriginalWidth: intent.OriginalWidth,
		OriginalHeight: intent.OriginalHeight, SourceKind: intent.SourceKind, SourceProvider: intent.SourceProvider,
		CreatedTimestamp: now, ResourceLink: ResourceAttachmentInput{CompanyID: intent.CompanyID, ResourceType: intent.ResourceType,
			ResourceID: intent.ResourceID, InformationID: intent.InformationID, MessageID: intent.MessageID,
			EditorSurface: intent.EditorSurface, RelationshipKind: intent.RelationshipKind, CreatedByUserID: intent.ActorUserID, CreatedTimestamp: now},
	}
	attachment, link, err := normalizeAttachmentCreateInput(attachmentInput)
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	attachment, err = scanAttachment(tx.QueryRowContext(ctx, `
with inserted as (
 insert into attachments (company_id, attachment_id, uploaded_by_user_id, original_filename, mime_type, byte_size, sha256,
 sha256_verification_method, storage_checksum_algorithm, storage_checksum_value, storage_checksum_type,
 storage_bucket, storage_key, original_width, original_height, source_kind, source_provider, created_timestamp)
 values ($1::uuid,$2::uuid,nullif($3,'')::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
 on conflict (attachment_id) do nothing returning *
)
select `+attachmentSelectColumns+` from inserted a
union all
select `+attachmentSelectColumns+` from attachments a where a.company_id=$1::uuid and a.attachment_id=$2::uuid
limit 1`, attachment.CompanyID, attachment.AttachmentID, attachment.UploadedByUserID, attachment.OriginalFilename,
		attachment.MimeType, attachment.ByteSize, attachment.SHA256, attachment.SHA256VerificationMethod,
		attachment.StorageChecksumAlgorithm, attachment.StorageChecksumValue, attachment.StorageChecksumType,
		attachment.StorageBucket, attachment.StorageKey, nullableInt(attachment.OriginalWidth), nullableInt(attachment.OriginalHeight),
		attachment.SourceKind, attachment.SourceProvider, attachment.CreatedTimestamp))
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	link.AttachmentID = attachment.AttachmentID
	link, err = insertOrReviveResourceAttachmentTx(ctx, tx, link)
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	if _, err := tx.ExecContext(ctx, `update attachment_upload_jobs
set status='completed', failure_code='', attachment_relationship_id=$2::uuid, sha256_verification_method=$3,
 storage_checksum_algorithm=$4, storage_checksum_value=$5, storage_checksum_type=$6,
 completed_timestamp=$7, updated_timestamp=$7, version=version+1
where upload_job_id=$1::uuid`, intent.UploadIntentID, link.ResourceAttachmentID, strings.TrimSpace(input.SHA256VerificationMethod),
		strings.TrimSpace(input.StorageChecksumAlgorithm), strings.TrimSpace(input.StorageChecksumValue), strings.TrimSpace(input.StorageChecksumType), now); err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	return attachment, link, nil
}

func (r *PostgresRepo) AbortAttachmentUploadIntent(input AttachmentUploadTransitionInput) (domain.AttachmentUploadIntent, error) {
	now := normalizedUploadNow(input.Now)
	intent, err := scanAttachmentUploadIntent(r.db.QueryRowContext(context.Background(), `
with changed as (
 update attachment_upload_jobs
 set status=case when status in ('completed','aborted','expired') then status else 'aborted' end,
     failure_code=case when status in ('completed','aborted','expired') then failure_code else '' end,
     updated_timestamp=case when status in ('completed','aborted','expired') then updated_timestamp else $4 end,
     version=case when status in ('completed','aborted','expired') then version else version+1 end
 where company_id=$1::uuid and actor_user_id=$2::uuid and upload_job_id=$3::uuid
 returning *
)
select `+attachmentUploadJobSelectColumns+` from changed ui`, strings.TrimSpace(input.CompanyID),
		cleanUUIDText(input.ActorUserID), cleanUUIDText(input.UploadIntentID), now))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.AttachmentUploadIntent{}, ErrNotFound
	}
	return intent, err
}

func (r *PostgresRepo) ListExpiredAttachmentUploadIntents(now time.Time, limit int) ([]domain.AttachmentUploadIntent, error) {
	now = normalizedUploadNow(now)
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := r.db.QueryContext(context.Background(), `select `+attachmentUploadJobSelectColumns+`
from attachment_upload_jobs ui
where (ui.expires_timestamp <= $1 and ui.status in ('pending','uploading','completing')) or ui.status='failed'
order by ui.expires_timestamp, ui.upload_job_id limit $2`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.AttachmentUploadIntent, 0)
	for rows.Next() {
		item, err := scanAttachmentUploadIntent(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ExpireAttachmentUploadIntent(uploadIntentID string, now time.Time) (domain.AttachmentUploadIntent, error) {
	intent, err := scanAttachmentUploadIntent(r.db.QueryRowContext(context.Background(), `
with changed as (
 update attachment_upload_jobs set status='expired', updated_timestamp=$2, version=version+1
 where upload_job_id=$1::uuid and status in ('pending','uploading','completing','failed') returning *
)
select `+attachmentUploadJobSelectColumns+` from changed ui`, cleanUUIDText(uploadIntentID), normalizedUploadNow(now)))
	if errors.Is(err, sql.ErrNoRows) {
		intent, err = scanAttachmentUploadIntent(r.db.QueryRowContext(context.Background(), `select `+attachmentUploadJobSelectColumns+` from attachment_upload_jobs ui where ui.upload_job_id=$1::uuid`, cleanUUIDText(uploadIntentID)))
	}
	if errors.Is(err, sql.ErrNoRows) {
		return domain.AttachmentUploadIntent{}, ErrNotFound
	}
	return intent, err
}

func (r *PostgresRepo) transitionAttachmentUpload(input AttachmentUploadTransitionInput, choose func(domain.AttachmentUploadIntent) (string, string, error)) (domain.AttachmentUploadIntent, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.AttachmentUploadIntent{}, err
	}
	defer tx.Rollback()
	intent, err := lockAttachmentUploadIntent(ctx, tx, input.CompanyID, input.ActorUserID, input.UploadIntentID, input.Now)
	if err != nil {
		return domain.AttachmentUploadIntent{}, err
	}
	status, failureCode, err := choose(intent)
	if err != nil {
		return domain.AttachmentUploadIntent{}, err
	}
	if status != intent.Status || failureCode != intent.FailureCode {
		intent, err = scanAttachmentUploadIntent(tx.QueryRowContext(ctx, `
with changed as (
 update attachment_upload_jobs set status=$2, failure_code=$3, updated_timestamp=$4, version=version+1
 where upload_job_id=$1::uuid returning *
)
select `+attachmentUploadJobSelectColumns+` from changed ui`, intent.UploadIntentID, status, failureCode, normalizedUploadNow(input.Now)))
		if err != nil {
			return domain.AttachmentUploadIntent{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return domain.AttachmentUploadIntent{}, err
	}
	return intent, nil
}

func lockAttachmentUploadIntent(ctx context.Context, tx *sql.Tx, companyID, actorUserID, uploadIntentID string, now time.Time) (domain.AttachmentUploadIntent, error) {
	intent, err := scanAttachmentUploadIntent(tx.QueryRowContext(ctx, `select `+attachmentUploadJobSelectColumns+`
from attachment_upload_jobs ui where ui.company_id=$1::uuid and ui.actor_user_id=$2::uuid and ui.upload_job_id=$3::uuid for update`,
		strings.TrimSpace(companyID), cleanUUIDText(actorUserID), cleanUUIDText(uploadIntentID)))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.AttachmentUploadIntent{}, ErrNotFound
	}
	if err != nil {
		return domain.AttachmentUploadIntent{}, err
	}
	now = normalizedUploadNow(now)
	if !uploadStatusTerminal(intent.Status) && !intent.ExpiresTimestamp.After(now) {
		return domain.AttachmentUploadIntent{}, ErrUploadIntentExpired
	}
	return intent, nil
}

func listAttachmentUploadPartsTx(ctx context.Context, tx *sql.Tx, uploadIntentID string) ([]domain.AttachmentUploadPart, error) {
	rows, err := tx.QueryContext(ctx, `select `+attachmentUploadPartSelectColumns+` from attachment_upload_parts p where p.upload_job_id=$1::uuid order by p.part_number`, uploadIntentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAttachmentUploadParts(rows)
}

func scanAttachmentUploadIntent(row interface{ Scan(dest ...any) error }) (domain.AttachmentUploadIntent, error) {
	var item domain.AttachmentUploadIntent
	var width, height sql.NullInt64
	var completed sql.NullTime
	err := row.Scan(&item.UploadIntentID, &item.CompanyID, &item.ActorUserID, &item.ClientRequestID,
		&item.AttachmentID, &item.ResourceAttachmentID, &item.OriginalFilename, &item.MimeType, &item.SizeBytes, &item.SHA256,
		&item.SHA256VerificationMethod, &item.StorageChecksumAlgorithm, &item.StorageChecksumValue, &item.StorageChecksumType,
		&item.ResourceType, &item.ResourceID, &item.InformationID, &item.MessageID, &item.EditorSurface,
		&item.RelationshipKind, &item.SourceKind, &item.SourceProvider, &width, &height, &item.StorageBucket,
		&item.StorageKey, &item.MultipartUploadID, &item.Strategy, &item.PartSizeBytes, &item.PartCount,
		&item.Status, &item.FailureCode, &item.Version, &item.CreatedTimestamp, &item.UpdatedTimestamp,
		&item.ExpiresTimestamp, &completed)
	if width.Valid {
		value := int(width.Int64)
		item.OriginalWidth = &value
	}
	if height.Valid {
		value := int(height.Int64)
		item.OriginalHeight = &value
	}
	if completed.Valid {
		item.CompletedTimestamp = &completed.Time
	}
	return item, err
}

func scanAttachmentUploadPart(row interface{ Scan(dest ...any) error }, item *domain.AttachmentUploadPart) error {
	var signed, uploaded sql.NullTime
	err := row.Scan(&item.UploadIntentID, &item.PartNumber, &item.ExpectedSizeBytes, &item.ObservedSizeBytes,
		&item.ChecksumAlgorithm, &item.ExpectedChecksum, &item.ETag, &item.S3Checksum,
		&item.SigningAttemptCount, &signed, &uploaded, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	if signed.Valid {
		item.LastSignedTimestamp = &signed.Time
	}
	if uploaded.Valid {
		item.UploadedTimestamp = &uploaded.Time
	}
	return err
}

func scanAttachmentUploadParts(rows *sql.Rows) ([]domain.AttachmentUploadPart, error) {
	items := make([]domain.AttachmentUploadPart, 0)
	for rows.Next() {
		var item domain.AttachmentUploadPart
		if err := scanAttachmentUploadPart(rows, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
