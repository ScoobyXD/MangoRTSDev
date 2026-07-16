package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

func (r *PostgresRepo) EnqueueRealtimeOutbox(input RealtimeOutboxInput) (RealtimeOutboxEvent, error) {
	input, err := normalizeRealtimeOutboxInput(input)
	if err != nil {
		return RealtimeOutboxEvent{}, err
	}
	if input.EventID == "" {
		input.EventID = newUUIDv7String()
	}
	allowed, err := json.Marshal(input.AllowedUserIDs)
	if err != nil {
		return RealtimeOutboxEvent{}, err
	}
	row := r.db.QueryRowContext(context.Background(), `
		insert into realtime_outbox (
			event_id, company_id, scope, event_type, resource_type, resource_id,
			permission, resource_revision, payload, allowed_user_ids, audience_restricted
		) values (
			$1::uuid, $2::uuid, $3, $4, nullif($5, ''), nullif($6, ''),
			nullif($7, ''), $8, $9::jsonb, $10::jsonb, $11
		)
		on conflict (event_id) do update set event_id = excluded.event_id
		returning outbox_sequence, event_id::text, company_id::text, scope, event_type,
			coalesce(resource_type, ''), coalesce(resource_id, ''), coalesce(permission, ''),
			resource_revision, payload, allowed_user_ids, audience_restricted, attempt_count,
			coalesce(claim_token::text, ''), claim_expires_at, published_timestamp,
			created_timestamp, coalesce(last_error_category, '')`,
		input.EventID, input.CompanyID, input.Scope, input.EventType, input.ResourceType,
		input.ResourceID, input.Permission, input.ResourceRevision, []byte(input.Payload), allowed, input.AudienceRestricted,
	)
	return scanRealtimeOutboxEvent(row)
}

func (r *PostgresRepo) enqueueRealtimeOutboxTx(ctx context.Context, tx *sql.Tx, input RealtimeOutboxInput) (RealtimeOutboxEvent, error) {
	input, err := normalizeRealtimeOutboxInput(input)
	if err != nil {
		return RealtimeOutboxEvent{}, err
	}
	if input.EventID == "" {
		input.EventID = newUUIDv7String()
	}
	allowed, err := json.Marshal(input.AllowedUserIDs)
	if err != nil {
		return RealtimeOutboxEvent{}, err
	}
	row := tx.QueryRowContext(ctx, `
		insert into realtime_outbox (
			event_id, company_id, scope, event_type, resource_type, resource_id,
			permission, resource_revision, payload, allowed_user_ids, audience_restricted
		) values (
			$1::uuid, $2::uuid, $3, $4, nullif($5, ''), nullif($6, ''),
			nullif($7, ''), $8, $9::jsonb, $10::jsonb, $11
		)
		on conflict (event_id) do update set event_id = excluded.event_id
		returning outbox_sequence, event_id::text, company_id::text, scope, event_type,
			coalesce(resource_type, ''), coalesce(resource_id, ''), coalesce(permission, ''),
			resource_revision, payload, allowed_user_ids, audience_restricted, attempt_count,
			coalesce(claim_token::text, ''), claim_expires_at, published_timestamp,
			created_timestamp, coalesce(last_error_category, '')`,
		input.EventID, input.CompanyID, input.Scope, input.EventType, input.ResourceType,
		input.ResourceID, input.Permission, input.ResourceRevision, []byte(input.Payload), allowed, input.AudienceRestricted,
	)
	return scanRealtimeOutboxEvent(row)
}

func (r *PostgresRepo) ClaimRealtimeOutbox(query RealtimeOutboxClaimQuery) ([]RealtimeOutboxEvent, error) {
	query = normalizeRealtimeOutboxClaimQuery(query)
	rows, err := r.db.QueryContext(context.Background(), `
		with candidates as (
			select outbox_sequence
			from realtime_outbox
			where published_timestamp is null
			  and (claim_expires_at is null or claim_expires_at <= now())
			order by outbox_sequence
			for update skip locked
			limit $1
		), claimed as (
			update realtime_outbox target
			set claim_token = gen_random_uuid(),
				claim_expires_at = now() + ($2 * interval '1 millisecond'),
				attempt_count = target.attempt_count + 1
			from candidates
			where target.outbox_sequence = candidates.outbox_sequence
			returning target.*
		)
		select outbox_sequence, event_id::text, company_id::text, scope, event_type,
			coalesce(resource_type, ''), coalesce(resource_id, ''), coalesce(permission, ''),
			resource_revision, payload, allowed_user_ids, audience_restricted, attempt_count,
			coalesce(claim_token::text, ''), claim_expires_at, published_timestamp,
			created_timestamp, coalesce(last_error_category, '')
		from claimed
		order by outbox_sequence`, query.Limit, query.LeaseDuration.Milliseconds())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]RealtimeOutboxEvent, 0)
	for rows.Next() {
		item, scanErr := scanRealtimeOutboxEvent(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) MarkRealtimeOutboxPublished(eventID, claimToken string) error {
	eventID, claimToken = strings.TrimSpace(eventID), strings.TrimSpace(claimToken)
	if eventID == "" || claimToken == "" {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `
		update realtime_outbox
		set published_timestamp = now(), claim_token = null, claim_expires_at = null,
			last_error_category = null
		where event_id = $1::uuid and claim_token = $2::uuid and published_timestamp is null`, eventID, claimToken)
	if err := realtimeOutboxMutationResult(result, err); !errors.Is(err, ErrVersionConflict) {
		return err
	}
	var alreadyPublished bool
	if err := r.db.QueryRowContext(context.Background(), `
		select exists(
			select 1 from realtime_outbox
			where event_id=$1::uuid and published_timestamp is not null
		)`, eventID).Scan(&alreadyPublished); err != nil {
		return err
	}
	if alreadyPublished {
		return nil
	}
	return ErrVersionConflict
}

func (r *PostgresRepo) MarkRealtimeOutboxFailed(eventID, claimToken, category string) error {
	eventID, claimToken, category = strings.TrimSpace(eventID), strings.TrimSpace(claimToken), strings.TrimSpace(category)
	if eventID == "" || claimToken == "" {
		return ErrInvalid
	}
	if len(category) > 120 {
		category = category[:120]
	}
	result, err := r.db.ExecContext(context.Background(), `
		update realtime_outbox
		set claim_token = null, claim_expires_at = null, last_error_category = nullif($3, '')
		where event_id = $1::uuid and claim_token = $2::uuid and published_timestamp is null`, eventID, claimToken, category)
	return realtimeOutboxMutationResult(result, err)
}

func (r *PostgresRepo) ListPublishedRealtimeOutboxAfter(sequence int64, limit int) ([]RealtimeOutboxEvent, error) {
	if sequence < 0 {
		return nil, ErrInvalid
	}
	if limit <= 0 || limit > RealtimeOutboxClaimMaxLimit {
		limit = 100
	}
	rows, err := r.db.QueryContext(context.Background(), `
		select outbox_sequence, event_id::text, company_id::text, scope, event_type,
			coalesce(resource_type, ''), coalesce(resource_id, ''), coalesce(permission, ''),
			resource_revision, payload, allowed_user_ids, audience_restricted, attempt_count,
			coalesce(claim_token::text, ''), claim_expires_at, published_timestamp,
			created_timestamp, coalesce(last_error_category, '')
		from realtime_outbox
		where outbox_sequence > $1 and published_timestamp is not null
		  and outbox_sequence <= (
		    select coalesce(min(outbox_sequence) filter (where published_timestamp is null) - 1, max(outbox_sequence), 0)
		    from realtime_outbox
		  )
		order by outbox_sequence
		limit $2`, sequence, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]RealtimeOutboxEvent, 0)
	for rows.Next() {
		item, scanErr := scanRealtimeOutboxEvent(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CurrentPublishedRealtimeOutboxSequence() (int64, error) {
	var sequence int64
	err := r.db.QueryRowContext(context.Background(), `
		select coalesce(min(outbox_sequence) filter (where published_timestamp is null) - 1, max(outbox_sequence), 0)
		from realtime_outbox`).Scan(&sequence)
	return sequence, err
}

type realtimeOutboxScanner interface {
	Scan(dest ...any) error
}

func scanRealtimeOutboxEvent(scanner realtimeOutboxScanner) (RealtimeOutboxEvent, error) {
	var item RealtimeOutboxEvent
	var payload, allowed []byte
	var claimExpiresAt, publishedTimestamp sql.NullTime
	if err := scanner.Scan(
		&item.Sequence, &item.EventID, &item.CompanyID, &item.Scope, &item.EventType,
		&item.ResourceType, &item.ResourceID, &item.Permission, &item.ResourceRevision,
		&payload, &allowed, &item.AudienceRestricted, &item.AttemptCount, &item.ClaimToken, &claimExpiresAt,
		&publishedTimestamp, &item.CreatedTimestamp, &item.LastErrorCategory,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return RealtimeOutboxEvent{}, ErrNotFound
		}
		return RealtimeOutboxEvent{}, err
	}
	item.Payload = append(json.RawMessage(nil), payload...)
	if len(allowed) > 0 {
		if err := json.Unmarshal(allowed, &item.AllowedUserIDs); err != nil {
			return RealtimeOutboxEvent{}, err
		}
	}
	if claimExpiresAt.Valid {
		value := claimExpiresAt.Time.UTC()
		item.ClaimExpiresAt = &value
	}
	if publishedTimestamp.Valid {
		value := publishedTimestamp.Time.UTC()
		item.PublishedTimestamp = &value
	}
	item.CreatedTimestamp = item.CreatedTimestamp.UTC()
	return item, nil
}

func realtimeOutboxMutationResult(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrVersionConflict
	}
	return nil
}

var _ = time.Second
