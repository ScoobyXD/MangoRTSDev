package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const domainEventSelectColumns = `
event_id::text, company_id::text, stream_type, stream_id, sequence, event_type,
actor_user_id::text, idempotency_key, payload, created_timestamp`

const domainEventReturningColumns = `
event_id, company_id, stream_type, stream_id, sequence, event_type,
actor_user_id, idempotency_key, payload, created_timestamp`

func domainEventSelectColumnsForAlias(alias string) string {
	alias = strings.TrimSpace(alias)
	if alias == "" {
		return domainEventSelectColumns
	}
	prefix := alias + "."
	return `
` + prefix + `event_id::text, ` + prefix + `company_id::text, ` + prefix + `stream_type, ` + prefix + `stream_id, ` + prefix + `sequence, ` + prefix + `event_type,
` + prefix + `actor_user_id::text, ` + prefix + `idempotency_key, ` + prefix + `payload, ` + prefix + `created_timestamp`
}

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

func (r *PostgresRepo) appendDomainEventRecordTx(ctx context.Context, tx *sql.Tx, input DomainEventInput) (domain.DomainEvent, bool, error) {
	defer observeTiming(ctx, "repo.appendDomainEventTx.total")()
	stop := observeTiming(ctx, "repo.appendDomainEventTx.normalize_payload")
	input, payloadBytes, err := normalizePostgresDomainEventInput(input)
	stop()
	if err != nil {
		return domain.DomainEvent{}, false, err
	}

	stop = observeTiming(ctx, "repo.appendDomainEventTx.advisory_lock")
	if _, err := tx.ExecContext(ctx,
		`select pg_advisory_xact_lock(hashtext($1), hashtext($2 || ':' || $3))`,
		input.CompanyID, input.StreamType, input.StreamID,
	); err != nil {
		stop()
		return domain.DomainEvent{}, false, err
	}
	stop()

	stop = observeTiming(ctx, "repo.appendDomainEventTx.insert")
	defer stop()
	eventID := newUUIDv7String()
	item, err := scanDomainEvent(tx.QueryRowContext(ctx, `
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
select $1::uuid, $2::uuid, nullif($3, '')::uuid, $4::text, $5::text, sequence, $6::text, $7::text, $8::jsonb, now()
from next_sequence
on conflict (company_id, idempotency_key) where btrim(idempotency_key) <> ''
do update set idempotency_key=domain_events.idempotency_key
returning `+domainEventSelectColumns,
		eventID, input.CompanyID, input.ActorUserID, input.StreamType, input.StreamID, input.Type, input.IdempotencyKey, string(payloadBytes),
	))
	if err != nil {
		return domain.DomainEvent{}, false, err
	}
	return item, item.EventID == eventID, nil
}

func (r *PostgresRepo) appendDomainEventTx(ctx context.Context, tx *sql.Tx, input DomainEventInput) (domain.DomainEvent, error) {
	item, inserted, err := r.appendDomainEventRecordTx(ctx, tx, input)
	if err != nil {
		return domain.DomainEvent{}, err
	}
	if inserted {
		if err := syncPostgresNodeCompletionTransitionsTx(ctx, tx, []domain.DomainEvent{item}); err != nil {
			return domain.DomainEvent{}, err
		}
	}
	if err := r.enqueueProcessWorkRealtimeForDomainEventTx(ctx, tx, item); err != nil {
		return domain.DomainEvent{}, err
	}
	if err := r.enqueueProcessMapRealtimeForDomainEventsTx(ctx, tx, []domain.DomainEvent{item}); err != nil {
		return domain.DomainEvent{}, err
	}
	return item, nil
}

type postgresDomainEventBatchItem struct {
	input        DomainEventInput
	payloadBytes []byte
	eventID      string
}

func (r *PostgresRepo) appendDomainEventsTx(ctx context.Context, tx *sql.Tx, inputs []DomainEventInput) ([]domain.DomainEvent, error) {
	defer observeTiming(ctx, "repo.appendDomainEventsTx.total")()
	if len(inputs) == 0 {
		return []domain.DomainEvent{}, nil
	}
	if len(inputs) == 1 || domainEventInputsRequireSequentialAppend(inputs) {
		events := make([]domain.DomainEvent, 0, len(inputs))
		insertedEvents := make([]domain.DomainEvent, 0, len(inputs))
		for _, input := range inputs {
			event, inserted, err := r.appendDomainEventRecordTx(ctx, tx, input)
			if err != nil {
				return nil, err
			}
			events = append(events, event)
			if inserted {
				insertedEvents = append(insertedEvents, event)
			}
		}
		if err := syncPostgresNodeCompletionTransitionsTx(ctx, tx, insertedEvents); err != nil {
			return nil, err
		}
		if err := r.enqueueProcessWorkRealtimeForDomainEventsTx(ctx, tx, events); err != nil {
			return nil, err
		}
		if err := r.enqueueProcessMapRealtimeForDomainEventsTx(ctx, tx, events); err != nil {
			return nil, err
		}
		return events, nil
	}

	items := make([]postgresDomainEventBatchItem, 0, len(inputs))
	for _, input := range inputs {
		stop := observeTiming(ctx, "repo.appendDomainEventTx.normalize_payload")
		normalized, payloadBytes, err := normalizePostgresDomainEventInput(input)
		stop()
		if err != nil {
			return nil, err
		}
		items = append(items, postgresDomainEventBatchItem{
			input:        normalized,
			payloadBytes: payloadBytes,
			eventID:      newUUIDv7String(),
		})
	}

	events := make([]domain.DomainEvent, 0, len(items))
	for start := 0; start < len(items); {
		end := start + 1
		for end < len(items) && domainEventBatchSameStream(items[start].input, items[end].input) {
			end++
		}
		batch, err := r.appendDomainEventBatchTx(ctx, tx, items[start:end])
		if err != nil {
			return nil, err
		}
		events = append(events, batch...)
		start = end
	}
	if err := r.enqueueProcessWorkRealtimeForDomainEventsTx(ctx, tx, events); err != nil {
		return nil, err
	}
	if err := r.enqueueProcessMapRealtimeForDomainEventsTx(ctx, tx, events); err != nil {
		return nil, err
	}
	return events, nil
}

func domainEventInputsRequireSequentialAppend(inputs []DomainEventInput) bool {
	for _, input := range inputs {
		if strings.TrimSpace(input.IdempotencyKey) != "" {
			return true
		}
	}
	return false
}

func domainEventBatchSameStream(a, b DomainEventInput) bool {
	return a.CompanyID == b.CompanyID && a.StreamType == b.StreamType && a.StreamID == b.StreamID
}

func (r *PostgresRepo) appendDomainEventBatchTx(ctx context.Context, tx *sql.Tx, items []postgresDomainEventBatchItem) ([]domain.DomainEvent, error) {
	if len(items) == 0 {
		return []domain.DomainEvent{}, nil
	}
	first := items[0].input
	stop := observeTiming(ctx, "repo.appendDomainEventTx.advisory_lock")
	if _, err := tx.ExecContext(ctx,
		`select pg_advisory_xact_lock(hashtext($1), hashtext($2 || ':' || $3))`,
		first.CompanyID, first.StreamType, first.StreamID,
	); err != nil {
		stop()
		return nil, err
	}
	stop()

	args := []any{first.CompanyID, first.StreamType, first.StreamID}
	var values strings.Builder
	for index, item := range items {
		if index > 0 {
			values.WriteString(",\n")
		}
		ordinalParam := len(args) + 1
		eventIDParam := ordinalParam + 1
		actorParam := ordinalParam + 2
		typeParam := ordinalParam + 3
		idempotencyParam := ordinalParam + 4
		payloadParam := ordinalParam + 5
		fmt.Fprintf(
			&values,
			"($%d::integer, $%d::uuid, nullif($%d, '')::uuid, $%d::text, $%d::text, $%d::jsonb)",
			ordinalParam,
			eventIDParam,
			actorParam,
			typeParam,
			idempotencyParam,
			payloadParam,
		)
		args = append(args, index, item.eventID, item.input.ActorUserID, item.input.Type, item.input.IdempotencyKey, string(item.payloadBytes))
	}

	stop = observeTiming(ctx, "repo.appendDomainEventTx.insert")
	rows, err := tx.QueryContext(ctx, `
with next_sequence as (
  select coalesce(max(sequence), 0) as base_sequence
  from domain_events
  where company_id=$1::uuid
    and stream_type=$2
    and stream_id=$3
),
input_rows(input_order, event_id, actor_user_id, event_type, idempotency_key, payload) as (
  values `+values.String()+`
),
numbered_input_rows as (
  select input_rows.*,
         next_sequence.base_sequence + row_number() over (order by input_rows.input_order) as sequence
  from input_rows
  cross join next_sequence
),
inserted as (
  insert into domain_events (
    event_id, company_id, actor_user_id, stream_type, stream_id, sequence,
    event_type, idempotency_key, payload, created_timestamp
  )
  select event_id, $1::uuid, actor_user_id, $2, $3, sequence, event_type, idempotency_key, payload, now()
  from numbered_input_rows
  order by input_order
  returning `+domainEventReturningColumns+`
)
select `+domainEventSelectColumnsForAlias("inserted")+`
from inserted
order by sequence asc, event_id asc`, args...)
	stop()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]domain.DomainEvent, 0, len(items))
	for rows.Next() {
		event, err := scanDomainEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(events) != len(items) {
		return nil, fmt.Errorf("append domain events batch inserted %d events, want %d", len(events), len(items))
	}
	if err := syncPostgresNodeCompletionTransitionsTx(ctx, tx, events); err != nil {
		return nil, err
	}
	return events, nil
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

func (r *PostgresRepo) DomainEventExistsByIdempotencyKey(companyID, idempotencyKey string) (bool, error) {
	companyID = strings.TrimSpace(companyID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if companyID == "" || idempotencyKey == "" {
		return false, ErrInvalid
	}
	var exists bool
	err := r.db.QueryRowContext(context.Background(), `
select exists (
  select 1
  from domain_events
  where company_id=$1::uuid
    and idempotency_key=$2
)`, companyID, idempotencyKey).Scan(&exists)
	return exists, err
}
