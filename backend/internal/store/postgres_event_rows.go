package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

const eventRowSelectColumns = `event_id::text,
company_id::text,
event_type,
resource_type,
resource_id,
primary_scope,
affected_scopes,
actor_user_id::text,
idempotency_key,
sequence_scope,
sequence,
payload,
created_timestamp,
available_at,
processing_started_at,
processed_at,
attempt_count,
last_error`

const eventRowSelectColumnsForRowAlias = `row.event_id::text,
row.company_id::text,
row.event_type,
row.resource_type,
row.resource_id,
row.primary_scope,
row.affected_scopes,
row.actor_user_id::text,
row.idempotency_key,
row.sequence_scope,
row.sequence,
row.payload,
row.created_timestamp,
row.available_at,
row.processing_started_at,
row.processed_at,
row.attempt_count,
row.last_error`

func scanEventRow(row interface{ Scan(dest ...any) error }) (EventRow, error) {
	var item EventRow
	var affectedScopesBytes []byte
	var payloadBytes []byte
	var actorUserID sql.NullString
	var processingStartedAt sql.NullTime
	var processedAt sql.NullTime
	err := row.Scan(
		&item.EventID,
		&item.CompanyID,
		&item.EventType,
		&item.ResourceType,
		&item.ResourceID,
		&item.PrimaryScope,
		&affectedScopesBytes,
		&actorUserID,
		&item.IdempotencyKey,
		&item.SequenceScope,
		&item.Sequence,
		&payloadBytes,
		&item.CreatedTimestamp,
		&item.AvailableAt,
		&processingStartedAt,
		&processedAt,
		&item.AttemptCount,
		&item.LastError,
	)
	if err != nil {
		return EventRow{}, err
	}
	if len(affectedScopesBytes) > 0 {
		_ = json.Unmarshal(affectedScopesBytes, &item.AffectedScopes)
	}
	item.AffectedScopes = normalizeEventScopes(item.AffectedScopes)
	if actorUserID.Valid {
		item.ActorUserID = actorUserID.String
	}
	item.Payload = NormalizeEventRowPayload(payloadBytes)
	if processingStartedAt.Valid {
		value := processingStartedAt.Time
		item.ProcessingStartedAt = &value
	}
	if processedAt.Valid {
		value := processedAt.Time
		item.ProcessedAt = &value
	}
	return item, nil
}

func (r *PostgresRepo) AppendEventRow(input EventRowInput) (EventRow, error) {
	rows, err := r.AppendEventRows([]EventRowInput{input})
	if err != nil {
		return EventRow{}, err
	}
	if len(rows) == 0 {
		return EventRow{}, ErrInvalid
	}
	return rows[0], nil
}

func (r *PostgresRepo) AppendEventRows(inputs []EventRowInput) ([]EventRow, error) {
	if len(inputs) == 0 {
		return []EventRow{}, nil
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	rows, err := r.appendEventRowsTx(ctx, tx, inputs)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *PostgresRepo) appendEventRowsTx(ctx context.Context, tx *sql.Tx, inputs []EventRowInput) ([]EventRow, error) {
	rows := make([]EventRow, 0, len(inputs))
	for _, input := range inputs {
		row, err := r.appendEventRowTx(ctx, tx, input)
		if err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func (r *PostgresRepo) appendEventRowTx(ctx context.Context, tx *sql.Tx, input EventRowInput) (EventRow, error) {
	input, err := NormalizeEventRowInput(input)
	if err != nil {
		return EventRow{}, err
	}
	payloadBytes, err := EventRowPayloadJSON(input.Payload)
	if err != nil {
		return EventRow{}, err
	}
	affectedScopesBytes, err := json.Marshal(input.AffectedScopes)
	if err != nil {
		return EventRow{}, err
	}
	availableAt := input.AvailableAt
	if availableAt.IsZero() {
		availableAt = time.Now().UTC()
	}
	if _, err := tx.ExecContext(ctx,
		`select pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
		input.CompanyID, input.SequenceScope,
	); err != nil {
		return EventRow{}, err
	}
	return scanEventRow(tx.QueryRowContext(ctx, `
with next_sequence as (
  select coalesce(max(sequence), 0) + 1 as sequence
  from event_rows
  where company_id=$2::uuid
    and sequence_scope=$9
)
insert into event_rows (
  event_id,
  company_id,
  event_type,
  resource_type,
  resource_id,
  primary_scope,
  affected_scopes,
  actor_user_id,
  idempotency_key,
  sequence_scope,
  sequence,
  payload,
  created_timestamp,
  available_at
)
select
  $1::uuid,
  $2::uuid,
  $3,
  $4,
  $5,
  $6,
  $7::jsonb,
  nullif($8, '')::uuid,
  $10,
  $9,
  sequence,
  $11::jsonb,
  now(),
  $12
from next_sequence
on conflict (company_id, idempotency_key) where btrim(idempotency_key) <> ''
do update set idempotency_key=event_rows.idempotency_key
returning `+eventRowSelectColumns,
		newUUIDv7String(),
		input.CompanyID,
		input.EventType,
		input.ResourceType,
		input.ResourceID,
		input.PrimaryScope,
		string(affectedScopesBytes),
		input.ActorUserID,
		input.SequenceScope,
		input.IdempotencyKey,
		string(payloadBytes),
		availableAt,
	))
}

func (r *PostgresRepo) ListEventRows(companyID string, limit int) ([]EventRow, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	limit = NormalizeEventRowListLimit(limit)
	rows, err := r.db.QueryContext(context.Background(), `
select `+eventRowSelectColumns+`
from event_rows
where company_id=$1::uuid
order by created_timestamp asc, event_id asc
limit $2`, companyID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEventRows(rows)
}

func (r *PostgresRepo) ClaimAvailableEventRows(limit int, processingLeaseTimeout time.Duration) ([]EventRow, error) {
	limit = NormalizeEventRowListLimit(limit)
	processingLeaseTimeout = NormalizeEventRowProcessingLeaseTimeout(processingLeaseTimeout)
	staleBefore := time.Now().UTC().Add(-processingLeaseTimeout)
	rows, err := r.db.QueryContext(context.Background(), `
with claimed as (
  select company_id, event_id
  from event_rows
  where processed_at is null
    and (
      processing_started_at is null
      or processing_started_at < $2
    )
    and available_at <= now()
  order by available_at asc, created_timestamp asc, company_id asc, event_id asc
  limit $1
  for update skip locked
),
updated as (
  update event_rows row
  set processing_started_at=now(),
      attempt_count=row.attempt_count + 1
  from claimed
  where row.company_id=claimed.company_id
    and row.event_id=claimed.event_id
  returning `+eventRowSelectColumnsForRowAlias+`
)
select * from updated
order by available_at asc, created_timestamp asc, company_id asc, event_id asc`, limit, staleBefore)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEventRows(rows)
}

func (r *PostgresRepo) MarkEventRowProcessed(companyID, eventID string) error {
	companyID = strings.TrimSpace(companyID)
	eventID = strings.TrimSpace(eventID)
	if companyID == "" || eventID == "" {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `
update event_rows
set processed_at=coalesce(processed_at, now()),
    processing_started_at=null,
    last_error=''
where company_id=$1::uuid
  and event_id=$2::uuid`, companyID, eventID)
	if err != nil {
		return err
	}
	return postgresRequireRowsAffected(result)
}

func (r *PostgresRepo) MarkEventRowFailed(companyID, eventID, lastError string, availableAt time.Time) error {
	companyID = strings.TrimSpace(companyID)
	eventID = strings.TrimSpace(eventID)
	if companyID == "" || eventID == "" {
		return ErrInvalid
	}
	if availableAt.IsZero() {
		availableAt = time.Now().UTC().Add(time.Second)
	}
	result, err := r.db.ExecContext(context.Background(), `
update event_rows
set processing_started_at=null,
    available_at=$3,
    last_error=$4
where company_id=$1::uuid
  and event_id=$2::uuid`, companyID, eventID, availableAt.UTC(), trimEventLastError(lastError))
	if err != nil {
		return err
	}
	return postgresRequireRowsAffected(result)
}

func scanEventRows(rows *sql.Rows) ([]EventRow, error) {
	items := make([]EventRow, 0)
	for rows.Next() {
		item, err := scanEventRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func postgresRequireRowsAffected(result sql.Result) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func trimEventLastError(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 2000 {
		return value[:2000]
	}
	return value
}
