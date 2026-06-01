package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const domainEventSelectColumns = `
event_id::text, company_id::text, stream_type, stream_id, sequence, event_type,
actor_user_id::text, idempotency_key, payload, published_timestamp, created_timestamp`

func scanDomainEvent(row interface{ Scan(dest ...any) error }) (domain.DomainEvent, error) {
	var item domain.DomainEvent
	var actorUserID sql.NullString
	var payloadBytes []byte
	err := row.Scan(
		&item.EventID,
		&item.CompanyID,
		&item.StreamType,
		&item.StreamID,
		&item.Sequence,
		&item.Type,
		&actorUserID,
		&item.IdempotencyKey,
		&payloadBytes,
		&item.PublishedTimestamp,
		&item.CreatedTimestamp,
	)
	if err != nil {
		return domain.DomainEvent{}, err
	}
	if actorUserID.Valid {
		item.ActorUserID = &actorUserID.String
	}
	if len(payloadBytes) > 0 {
		if err := json.Unmarshal(payloadBytes, &item.Payload); err != nil {
			return domain.DomainEvent{}, err
		}
	}
	if item.Payload == nil {
		item.Payload = map[string]any{}
	}
	return item, nil
}

func normalizePostgresDomainEventInput(input DomainEventInput) (DomainEventInput, []byte, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.StreamType = strings.TrimSpace(input.StreamType)
	input.StreamID = strings.TrimSpace(input.StreamID)
	input.Type = strings.TrimSpace(input.Type)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.CompanyID == "" || input.StreamType == "" || input.StreamID == "" || input.Type == "" {
		return DomainEventInput{}, nil, ErrInvalid
	}

	payloadBytes, err := json.Marshal(cloneDomainEventPayload(input.Payload))
	if err != nil {
		return DomainEventInput{}, nil, err
	}
	return input, payloadBytes, nil
}

func (r *PostgresRepo) AppendDomainEvent(input DomainEventInput) (domain.DomainEvent, error) {
	ctx := ContextWithTimingRecorder(context.Background(), input.TimingRecorder)
	defer observeTiming(ctx, "repo.AppendDomainEvent.transaction")()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.DomainEvent{}, err
	}
	defer tx.Rollback()

	item, err := r.appendDomainEventTx(ctx, tx, input)
	if err != nil {
		return domain.DomainEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.DomainEvent{}, err
	}
	return item, nil
}

func (r *PostgresRepo) AppendDomainEvents(inputs []DomainEventInput) ([]domain.DomainEvent, error) {
	if len(inputs) == 0 {
		return []domain.DomainEvent{}, nil
	}
	var recorder TimingRecorder
	for _, input := range inputs {
		if input.TimingRecorder != nil {
			recorder = input.TimingRecorder
			break
		}
	}
	ctx := ContextWithTimingRecorder(context.Background(), recorder)
	defer observeTiming(ctx, "repo.AppendDomainEvents.transaction")()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	events, err := r.appendDomainEventsTx(ctx, tx, inputs)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return events, nil
}

func (r *PostgresRepo) appendDomainEventTx(ctx context.Context, tx *sql.Tx, input DomainEventInput) (domain.DomainEvent, error) {
	defer observeTiming(ctx, "repo.appendDomainEventTx.total")()
	stop := observeTiming(ctx, "repo.appendDomainEventTx.normalize_payload")
	input, payloadBytes, err := normalizePostgresDomainEventInput(input)
	stop()
	if err != nil {
		return domain.DomainEvent{}, err
	}

	stop = observeTiming(ctx, "repo.appendDomainEventTx.advisory_lock")
	if _, err := tx.ExecContext(ctx,
		`select pg_advisory_xact_lock(hashtext($1), hashtext($2 || ':' || $3))`,
		input.CompanyID, input.StreamType, input.StreamID,
	); err != nil {
		stop()
		return domain.DomainEvent{}, err
	}
	stop()

	stop = observeTiming(ctx, "repo.appendDomainEventTx.insert")
	defer stop()
	return scanDomainEvent(tx.QueryRowContext(ctx, `
with next_sequence as (
  select coalesce(max(sequence), 0) + 1 as sequence
  from domain_events
  where company_id=$2::uuid
    and stream_type=$4
    and stream_id=$5
)
insert into domain_events (
  event_id, company_id, actor_user_id, stream_type, stream_id, sequence,
  event_type, idempotency_key, payload, created_timestamp
)
select $1::uuid, $2::uuid, nullif($3, '')::uuid, $4, $5, sequence, $6, $7, $8::jsonb, now()
from next_sequence
on conflict (company_id, idempotency_key) where btrim(idempotency_key) <> ''
do update set idempotency_key=domain_events.idempotency_key
returning `+domainEventSelectColumns,
		newUUIDv7String(), input.CompanyID, input.ActorUserID, input.StreamType, input.StreamID, input.Type, input.IdempotencyKey, string(payloadBytes),
	))
}

func (r *PostgresRepo) appendDomainEventsTx(ctx context.Context, tx *sql.Tx, inputs []DomainEventInput) ([]domain.DomainEvent, error) {
	defer observeTiming(ctx, "repo.appendDomainEventsTx.total")()
	events := make([]domain.DomainEvent, 0, len(inputs))
	for _, input := range inputs {
		event, err := r.appendDomainEventTx(ctx, tx, input)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, nil
}
func (r *PostgresRepo) ListPendingDomainEvents(limit int) ([]domain.DomainEvent, error) {
	ctx := context.Background()
	limit = NormalizeDomainEventListLimit(limit)
	rows, err := r.db.QueryContext(ctx, `
select `+domainEventSelectColumns+`
from domain_events
where published_timestamp is null
order by created_timestamp asc, company_id asc, event_id asc
limit $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.DomainEvent, 0)
	for rows.Next() {
		item, err := scanDomainEvent(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListDomainEventsAfter(query DomainEventReplayQuery) ([]domain.DomainEvent, error) {
	ctx := context.Background()
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.StreamType = strings.TrimSpace(query.StreamType)
	query.StreamID = strings.TrimSpace(query.StreamID)
	query.Limit = NormalizeDomainEventListLimit(query.Limit)
	if query.CompanyID == "" || query.StreamType == "" || query.StreamID == "" || query.AfterSequence < 0 {
		return nil, ErrInvalid
	}

	rows, err := r.db.QueryContext(ctx, `
select `+domainEventSelectColumns+`
from domain_events
where company_id=$1::uuid
  and stream_type=$2
  and stream_id=$3
  and sequence > $4
order by sequence asc, event_id asc
limit $5`, query.CompanyID, query.StreamType, query.StreamID, query.AfterSequence, query.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.DomainEvent, 0)
	for rows.Next() {
		item, err := scanDomainEvent(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListDomainEventsForNotificationProjection(query DomainEventNotificationProjectionQuery) ([]domain.DomainEvent, error) {
	ctx := context.Background()
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.AfterEventID = strings.TrimSpace(query.AfterEventID)
	query.Limit = NormalizeDomainEventListLimit(query.Limit)
	if query.CompanyID == "" {
		return nil, ErrInvalid
	}
	afterTimestamp := query.AfterCreatedTimestamp
	if afterTimestamp.IsZero() {
		afterTimestamp = time.Unix(0, 0).UTC()
	}

	rows, err := r.db.QueryContext(ctx, `
select `+domainEventSelectColumns+`
from domain_events
where company_id=$1::uuid
  and (
    created_timestamp > $2
    or (created_timestamp = $2 and event_id::text > $3)
  )
order by created_timestamp asc, event_id asc
limit $4`, query.CompanyID, afterTimestamp, query.AfterEventID, query.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.DomainEvent, 0)
	for rows.Next() {
		item, err := scanDomainEvent(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) LatestDomainEventForNotificationProjection(companyID string) (NotificationDomainEventCheckpoint, bool, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return NotificationDomainEventCheckpoint{}, false, ErrInvalid
	}
	var checkpoint NotificationDomainEventCheckpoint
	err := r.db.QueryRowContext(context.Background(), `
select company_id::text, created_timestamp, event_id::text
from domain_events
where company_id=$1::uuid
order by created_timestamp desc, event_id desc
limit 1`, companyID).Scan(&checkpoint.CompanyID, &checkpoint.CreatedTimestamp, &checkpoint.EventID)
	if errors.Is(err, sql.ErrNoRows) {
		return NotificationDomainEventCheckpoint{}, false, nil
	}
	if err != nil {
		return NotificationDomainEventCheckpoint{}, false, err
	}
	return checkpoint, true, nil
}
func (r *PostgresRepo) CurrentDomainEventSequence(query DomainEventStreamQuery) (int64, error) {
	query, err := normalizeDomainEventStreamQuery(query)
	if err != nil {
		return 0, err
	}

	args := []any{query.CompanyID, query.StreamType, query.StreamID}
	where := []string{"company_id=$1::uuid", "stream_type=$2", "stream_id=$3"}
	if len(query.EventTypes) > 0 {
		eventTypePredicates := make([]string, 0, len(query.EventTypes))
		for _, eventType := range query.EventTypes {
			args = append(args, eventType)
			eventTypePredicates = append(eventTypePredicates, fmt.Sprintf("event_type=$%d", len(args)))
		}
		where = append(where, "("+strings.Join(eventTypePredicates, " or ")+")")
	}
	if len(query.PayloadEquals) > 0 {
		keys := make([]string, 0, len(query.PayloadEquals))
		for key := range query.PayloadEquals {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			args = append(args, key)
			keyParam := len(args)
			args = append(args, query.PayloadEquals[key])
			valueParam := len(args)
			where = append(where, fmt.Sprintf("payload->>$%d = $%d", keyParam, valueParam))
		}
	}

	var sequence int64
	err = r.db.QueryRowContext(context.Background(), `
select coalesce(max(sequence), 0)
from domain_events
where `+strings.Join(where, "\n  and "), args...).Scan(&sequence)
	return sequence, err
}
func (r *PostgresRepo) MarkDomainEventPublished(companyID, eventID string) error {
	companyID = strings.TrimSpace(companyID)
	eventID = strings.TrimSpace(eventID)
	if companyID == "" || eventID == "" {
		return ErrInvalid
	}
	result, err := r.db.Exec(`
update domain_events
set published_timestamp=coalesce(published_timestamp, now())
where company_id=$1::uuid and event_id=$2::uuid`, companyID, eventID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}
