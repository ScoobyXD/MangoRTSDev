package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

func scanNotificationEvent(row interface{ Scan(dest ...any) error }) (domain.NotificationEvent, error) {
	var item domain.NotificationEvent
	var companyID sql.NullString
	var actorUserID sql.NullString
	var payloadBytes []byte
	err := row.Scan(
		&item.EventID,
		&companyID,
		&actorUserID,
		&item.Type,
		&item.EntityType,
		&item.EntityID,
		&item.IdempotencyKey,
		&payloadBytes,
		&item.ProcessedTimestamp,
		&item.CreatedTimestamp,
	)
	if err != nil {
		return domain.NotificationEvent{}, err
	}
	if companyID.Valid {
		item.CompanyID = companyID.String
	}
	if actorUserID.Valid {
		item.ActorUserID = &actorUserID.String
	}
	if len(payloadBytes) > 0 {
		if err := json.Unmarshal(payloadBytes, &item.Payload); err != nil {
			return domain.NotificationEvent{}, err
		}
	}
	if item.Payload == nil {
		item.Payload = map[string]any{}
	}
	return item, nil
}

const notificationEventSelectColumns = `
event_id::text, company_id::text, actor_user_id::text, event_type, entity_type, entity_id,
idempotency_key, payload, processed_timestamp, created_timestamp`

func (r *PostgresRepo) CreateNotificationEvent(input NotificationEventInput) (domain.NotificationEvent, error) {
	ctx := context.Background()
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.Type = strings.TrimSpace(input.Type)
	input.EntityType = strings.TrimSpace(input.EntityType)
	input.EntityID = strings.TrimSpace(input.EntityID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.Type == "" || input.EntityType == "" || input.EntityID == "" {
		return domain.NotificationEvent{}, ErrInvalid
	}
	payloadBytes, err := json.Marshal(cloneNotificationPayload(input.Payload))
	if err != nil {
		return domain.NotificationEvent{}, err
	}
	if input.IdempotencyKey != "" {
		return scanNotificationEvent(r.db.QueryRowContext(ctx, `
insert into notification_events (
  event_id, company_id, actor_user_id, event_type, entity_type, entity_id,
  idempotency_key, payload, created_timestamp
) values ($1, nullif($2, '')::uuid, nullif($3, '')::uuid, $4, $5, $6, $7, $8::jsonb, now())
on conflict (idempotency_key) where btrim(idempotency_key) <> ''
do update set idempotency_key=excluded.idempotency_key
returning `+notificationEventSelectColumns,
			newUUIDv7String(), input.CompanyID, input.ActorUserID, input.Type, input.EntityType, input.EntityID, input.IdempotencyKey, string(payloadBytes),
		))
	}
	return scanNotificationEvent(r.db.QueryRowContext(ctx, `
insert into notification_events (
  event_id, company_id, actor_user_id, event_type, entity_type, entity_id,
  idempotency_key, payload, created_timestamp
) values ($1, nullif($2, '')::uuid, nullif($3, '')::uuid, $4, $5, $6, '', $7::jsonb, now())
returning `+notificationEventSelectColumns,
		newUUIDv7String(), input.CompanyID, input.ActorUserID, input.Type, input.EntityType, input.EntityID, string(payloadBytes),
	))
}

func (r *PostgresRepo) ListPendingNotificationEvents(limit int) ([]domain.NotificationEvent, error) {
	ctx := context.Background()
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := r.db.QueryContext(ctx, `
select `+notificationEventSelectColumns+`
from notification_events
where processed_timestamp is null
order by created_timestamp asc, event_id asc
limit $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.NotificationEvent, 0)
	for rows.Next() {
		item, err := scanNotificationEvent(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) MarkNotificationEventProcessed(eventID string) error {
	eventID = strings.TrimSpace(eventID)
	if eventID == "" {
		return ErrInvalid
	}
	result, err := r.db.Exec(`
update notification_events
set processed_timestamp=coalesce(processed_timestamp, now())
where event_id=$1::uuid`, eventID)
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

func scanNotification(row interface{ Scan(dest ...any) error }) (domain.Notification, error) {
	var item domain.Notification
	var companyID sql.NullString
	var actorUserID sql.NullString
	err := row.Scan(
		&item.NotificationID,
		&companyID,
		&item.RecipientUserID,
		&actorUserID,
		&item.Type,
		&item.SourceEventID,
		&item.EntityType,
		&item.EntityID,
		&item.Title,
		&item.BodyPreview,
		&item.ReadTimestamp,
		&item.CreatedTimestamp,
	)
	if err != nil {
		return domain.Notification{}, err
	}
	if companyID.Valid {
		item.CompanyID = companyID.String
	}
	if actorUserID.Valid {
		item.ActorUserID = &actorUserID.String
	}
	return item, nil
}

const notificationSelectColumns = `
notification_id::text, company_id::text, recipient_user_id::text, actor_user_id::text,
notification_type, source_event_id::text, entity_type, entity_id, title, body_preview,
read_timestamp, created_timestamp`

func (r *PostgresRepo) CreateNotifications(input CreateNotificationsInput) ([]domain.Notification, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	created := make([]domain.Notification, 0, len(input.Notifications))
	for _, candidate := range input.Notifications {
		candidate.CompanyID = strings.TrimSpace(candidate.CompanyID)
		candidate.RecipientUserID = strings.TrimSpace(candidate.RecipientUserID)
		candidate.ActorUserID = strings.TrimSpace(candidate.ActorUserID)
		candidate.Type = strings.TrimSpace(candidate.Type)
		candidate.SourceEventID = strings.TrimSpace(candidate.SourceEventID)
		candidate.EntityType = strings.TrimSpace(candidate.EntityType)
		candidate.EntityID = strings.TrimSpace(candidate.EntityID)
		candidate.Title = strings.TrimSpace(candidate.Title)
		candidate.BodyPreview = strings.TrimSpace(candidate.BodyPreview)
		if candidate.RecipientUserID == "" || candidate.Type == "" || candidate.SourceEventID == "" || candidate.EntityType == "" || candidate.EntityID == "" || candidate.Title == "" {
			return nil, ErrInvalid
		}
		item, err := scanNotification(tx.QueryRowContext(ctx, `
insert into notifications (
  notification_id, company_id, recipient_user_id, actor_user_id, notification_type,
  source_event_id, entity_type, entity_id, title, body_preview, created_timestamp
) values ($1, nullif($2, '')::uuid, $3::uuid, nullif($4, '')::uuid, $5, $6::uuid, $7, $8, $9, $10, now())
on conflict (recipient_user_id, source_event_id, notification_type, entity_type, entity_id)
do update set notification_id=notifications.notification_id
returning `+notificationSelectColumns,
			newUUIDv7String(), candidate.CompanyID, candidate.RecipientUserID, candidate.ActorUserID,
			candidate.Type, candidate.SourceEventID, candidate.EntityType, candidate.EntityID,
			candidate.Title, candidate.BodyPreview,
		))
		if err != nil {
			return nil, err
		}
		created = append(created, item)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return created, nil
}

func (r *PostgresRepo) ListNotifications(input NotificationListInput) ([]domain.Notification, error) {
	ctx := context.Background()
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	if input.UserID == "" {
		return nil, ErrInvalid
	}
	limit := NormalizeNotificationListLimit(input.Limit)
	rows, err := r.db.QueryContext(ctx, `
select `+notificationSelectColumns+`
from notifications
where recipient_user_id=$1::uuid
  and ($2 = '' or company_id = nullif($2, '')::uuid)
  and (not $3::boolean or read_timestamp is null)
order by created_timestamp desc, notification_id desc
limit $4`, input.UserID, input.CompanyID, input.UnreadOnly, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.Notification, 0)
	for rows.Next() {
		item, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CountUnreadNotifications(userID, companyID string) (int, error) {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	if userID == "" {
		return 0, ErrInvalid
	}
	var count int
	if err := r.db.QueryRow(`
select count(*)
from notifications
where recipient_user_id=$1::uuid
  and read_timestamp is null
  and ($2 = '' or company_id = nullif($2, '')::uuid)`, userID, companyID).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (r *PostgresRepo) MarkNotificationRead(userID, notificationID string, read bool) (domain.Notification, error) {
	userID = strings.TrimSpace(userID)
	notificationID = strings.TrimSpace(notificationID)
	if userID == "" || notificationID == "" {
		return domain.Notification{}, ErrInvalid
	}
	item, err := scanNotification(r.db.QueryRow(`
update notifications
set read_timestamp=case when $3::boolean then coalesce(read_timestamp, now()) else null end
where recipient_user_id=$1::uuid and notification_id=$2::uuid
returning `+notificationSelectColumns, userID, notificationID, read))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Notification{}, ErrNotFound
	}
	return item, err
}

func (r *PostgresRepo) MarkAllNotificationsRead(userID, companyID string) (int, error) {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	if userID == "" {
		return 0, ErrInvalid
	}
	result, err := r.db.Exec(`
update notifications
set read_timestamp=coalesce(read_timestamp, now())
where recipient_user_id=$1::uuid
  and read_timestamp is null
  and ($2 = '' or company_id = nullif($2, '')::uuid)`, userID, companyID)
	if err != nil {
		return 0, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return int(affected), nil
}
