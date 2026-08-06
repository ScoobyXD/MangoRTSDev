package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func scanNotification(row interface{ Scan(dest ...any) error }) (domain.Notification, error) {
	var item domain.Notification
	var companyID sql.NullString
	var actorUserID sql.NullString
	var priority sql.NullInt64
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
		&item.Surface,
		&item.Role,
		&item.LogicGateID,
		&item.NodeID,
		&item.InformationID,
		&priority,
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
	if priority.Valid {
		value := int(priority.Int64)
		item.Priority = &value
	}
	return item, nil
}

const notificationSelectColumns = `
notification_id::text, company_id::text, recipient_user_id::text, actor_user_id::text,
notification_type, source_event_id::text, entity_type, entity_id, title, body_preview,
surface, role, logic_gate_id, node_id, information_id, priority, read_timestamp, created_timestamp`

const notificationRecipientVisibilityConditionSQL = `(
    company_id is null
    or case
        when btrim(node_id) <> ''
          and role in ('generated', 'verified', 'consulted', 'informed') then exists (
            select 1
            from nodes
            where nodes.company_id=notifications.company_id
              and nodes.node_id=notifications.node_id::uuid
          )
        when btrim(logic_gate_id) <> ''
          and role in ('generated', 'verified', 'consulted', 'informed') then exists (
            select 1
            from logic_gates
            where logic_gates.company_id=notifications.company_id
              and logic_gates.logic_gate_id=notifications.logic_gate_id::uuid
          )
        when btrim(node_id) <> '' then mangorts_user_can_access_resource(
          notifications.company_id,
          'node',
          notifications.node_id::uuid,
          notifications.recipient_user_id,
          'edit'
        )
        when btrim(logic_gate_id) <> '' then mangorts_user_can_access_resource(
          notifications.company_id,
          'logic_gate',
          notifications.logic_gate_id::uuid,
          notifications.recipient_user_id,
          'edit'
        )
        when entity_type = 'logic_gate' then mangorts_user_can_access_resource(
          notifications.company_id,
          'logic_gate',
          notifications.entity_id::uuid,
          notifications.recipient_user_id,
          'edit'
        )
        when entity_type = 'node' then mangorts_user_can_access_resource(
          notifications.company_id,
          'node',
          notifications.entity_id::uuid,
          notifications.recipient_user_id,
          'edit'
        )
        when entity_type in ('shared_inbox_folder', 'shared_inbox') then mangorts_user_can_access_resource(
          notifications.company_id,
          case when entity_type='shared_inbox' then 'shared_inbox' else 'shared_inbox_folder' end,
          notifications.entity_id::uuid,
          notifications.recipient_user_id,
          'edit'
        )
        else true
      end
  )`

const notificationRecipientVisibilityWhereSQL = `
  and ` + notificationRecipientVisibilityConditionSQL

// This narrow missing-target exception lets stale clients dismiss an update
// without relaxing the access check for a live resource whose access was revoked.
const notificationMissingNodeOrLogicGateTargetConditionSQL = `(
    company_id is not null
    and case
        when btrim(node_id) <> '' then not exists (
          select 1
          from nodes
          where nodes.company_id=notifications.company_id
            and nodes.node_id=notifications.node_id::uuid
        )
        when btrim(logic_gate_id) <> '' then not exists (
          select 1
          from logic_gates
          where logic_gates.company_id=notifications.company_id
            and logic_gates.logic_gate_id=notifications.logic_gate_id::uuid
        )
        when entity_type = 'logic_gate' then not exists (
          select 1
          from logic_gates
          where logic_gates.company_id=notifications.company_id
            and logic_gates.logic_gate_id=notifications.entity_id::uuid
        )
        when entity_type = 'node' then not exists (
          select 1
          from nodes
          where nodes.company_id=notifications.company_id
            and nodes.node_id=notifications.entity_id::uuid
        )
        else false
      end
  )`

const notificationRecipientReadStateWhereSQL = `
  and (
    ` + notificationRecipientVisibilityConditionSQL + `
    or ` + notificationMissingNodeOrLogicGateTargetConditionSQL + `
  )`

const notificationRoleSummaryTargetSQL = `
case
  when btrim(node_id) <> '' then 'node:' || coalesce(nullif(btrim(logic_gate_id), ''), '') || ':' || btrim(node_id)
  when btrim(logic_gate_id) <> '' then 'logic_gate:' || btrim(logic_gate_id)
  else btrim(entity_type) || ':' || btrim(entity_id)
end`

func (r *PostgresRepo) CreateNotifications(input CreateNotificationsInput) ([]domain.Notification, error) {
	ctx := ContextWithTimingRecorder(context.Background(), input.TimingRecorder)
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
		candidate.Surface = strings.TrimSpace(candidate.Surface)
		candidate.Role = strings.TrimSpace(candidate.Role)
		candidate.LogicGateID = strings.TrimSpace(candidate.LogicGateID)
		candidate.NodeID = strings.TrimSpace(candidate.NodeID)
		candidate.InformationID = strings.TrimSpace(candidate.InformationID)
		if candidate.Priority != nil && (*candidate.Priority < 1 || *candidate.Priority > 5) {
			return nil, ErrInvalid
		}
		if candidate.RecipientUserID == "" || candidate.Type == "" || candidate.SourceEventID == "" || candidate.EntityType == "" || candidate.EntityID == "" || candidate.Title == "" {
			return nil, ErrInvalid
		}
		stop := observeTiming(ctx, "notifications.insert")
		item, err := scanNotification(tx.QueryRowContext(ctx, `
insert into notifications (
  notification_id, company_id, recipient_user_id, actor_user_id, notification_type,
  source_event_id, entity_type, entity_id, title, body_preview, surface, role, logic_gate_id, node_id, information_id, priority, created_timestamp
) values ($1, nullif($2, '')::uuid, $3::uuid, nullif($4, '')::uuid, $5, $6::uuid, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
on conflict (recipient_user_id, source_event_id, notification_type, entity_type, entity_id)
do nothing
returning `+notificationSelectColumns,
			newUUIDv7String(), candidate.CompanyID, candidate.RecipientUserID, candidate.ActorUserID,
			candidate.Type, candidate.SourceEventID, candidate.EntityType, candidate.EntityID,
			candidate.Title, candidate.BodyPreview, candidate.Surface, candidate.Role, candidate.LogicGateID, candidate.NodeID, candidate.InformationID, candidate.Priority,
		))
		stop()
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return nil, err
		}
		created = append(created, item)
		outboxInput, err := notificationCreatedOutboxInput(item)
		if err != nil {
			return nil, err
		}
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, outboxInput); err != nil {
			return nil, err
		}
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
	input.NotificationType = strings.TrimSpace(input.NotificationType)
	if input.UserID == "" {
		return nil, ErrInvalid
	}
	limit := NormalizeNotificationListLimit(input.Limit)
	rows, err := r.db.QueryContext(ctx, `
select `+notificationSelectColumns+`
from notifications
where recipient_user_id=$1::uuid
  and ($2 = '' or company_id = nullif($2, '')::uuid)
  and ($3 = '' or notification_type = $3)
  and (not $4::boolean or read_timestamp is null)`+notificationRecipientVisibilityWhereSQL+`
order by created_timestamp desc, notification_id desc
limit $5`, input.UserID, input.CompanyID, input.NotificationType, input.UnreadOnly, limit)
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

func (r *PostgresRepo) GetNotificationSummary(input NotificationSummaryInput) (domain.NotificationSummary, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	if input.UserID == "" {
		return domain.NotificationSummary{}, ErrInvalid
	}
	summary := domain.NotificationSummary{
		CompanyID:        input.CompanyID,
		RoleCounts:       []domain.NotificationRoleCount{},
		TypeCounts:       []domain.NotificationTypeCount{},
		LogicGateCounts:  []domain.NotificationLogicGateCount{},
		UpdatedTimestamp: time.Now().UTC(),
	}
	if err := r.db.QueryRow(`
select count(*)
from notifications
where recipient_user_id=$1::uuid
  and read_timestamp is null
  and ($2 = '' or company_id = nullif($2, '')::uuid)`+notificationRecipientVisibilityWhereSQL, input.UserID, input.CompanyID).Scan(&summary.TotalUnread); err != nil {
		return domain.NotificationSummary{}, err
	}

	roleRows, err := r.db.Query(`
select surface, role, count(distinct `+notificationRoleSummaryTargetSQL+`)
from notifications
where recipient_user_id=$1::uuid
  and read_timestamp is null
  and ($2 = '' or company_id = nullif($2, '')::uuid)
  and (btrim(surface) <> '' or btrim(role) <> '')`+notificationRecipientVisibilityWhereSQL+`
group by surface, role
order by surface asc, role asc`, input.UserID, input.CompanyID)
	if err != nil {
		return domain.NotificationSummary{}, err
	}
	defer roleRows.Close()
	for roleRows.Next() {
		var item domain.NotificationRoleCount
		if err := roleRows.Scan(&item.Surface, &item.Role, &item.Count); err != nil {
			return domain.NotificationSummary{}, err
		}
		summary.RoleCounts = append(summary.RoleCounts, item)
	}
	if err := roleRows.Err(); err != nil {
		return domain.NotificationSummary{}, err
	}

	typeRows, err := r.db.Query(`
select notification_type, count(*)
from notifications
where recipient_user_id=$1::uuid
  and read_timestamp is null
  and ($2 = '' or company_id = nullif($2, '')::uuid)`+notificationRecipientVisibilityWhereSQL+`
group by notification_type
order by notification_type asc`, input.UserID, input.CompanyID)
	if err != nil {
		return domain.NotificationSummary{}, err
	}
	defer typeRows.Close()
	for typeRows.Next() {
		var item domain.NotificationTypeCount
		if err := typeRows.Scan(&item.Type, &item.Count); err != nil {
			return domain.NotificationSummary{}, err
		}
		summary.TypeCounts = append(summary.TypeCounts, item)
	}
	if err := typeRows.Err(); err != nil {
		return domain.NotificationSummary{}, err
	}

	gateRows, err := r.db.Query(`
select logic_gate_id, node_id, role, count(*)
from notifications
where recipient_user_id=$1::uuid
  and read_timestamp is null
  and ($2 = '' or company_id = nullif($2, '')::uuid)
  and btrim(logic_gate_id) <> ''
  and btrim(role) <> ''`+notificationRecipientVisibilityWhereSQL+`
group by logic_gate_id, node_id, role
order by logic_gate_id asc, node_id asc, role asc`, input.UserID, input.CompanyID)
	if err != nil {
		return domain.NotificationSummary{}, err
	}
	defer gateRows.Close()
	for gateRows.Next() {
		var item domain.NotificationLogicGateCount
		if err := gateRows.Scan(&item.LogicGateID, &item.NodeID, &item.Role, &item.Count); err != nil {
			return domain.NotificationSummary{}, err
		}
		summary.LogicGateCounts = append(summary.LogicGateCounts, item)
	}
	if err := gateRows.Err(); err != nil {
		return domain.NotificationSummary{}, err
	}
	return summary, nil
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
  and ($2 = '' or company_id = nullif($2, '')::uuid)`+notificationRecipientVisibilityWhereSQL, userID, companyID).Scan(&count); err != nil {
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
where recipient_user_id=$1::uuid and notification_id=$2::uuid`+notificationRecipientReadStateWhereSQL+`
returning `+notificationSelectColumns, userID, notificationID, read))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Notification{}, ErrNotFound
	}
	return item, err
}

func (r *PostgresRepo) MarkNotificationsRead(input NotificationMarkReadInput) (int, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.NotificationType = strings.TrimSpace(input.NotificationType)
	input.Surface = strings.TrimSpace(input.Surface)
	input.Role = strings.TrimSpace(input.Role)
	input.LogicGateID = strings.TrimSpace(input.LogicGateID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	if input.UserID == "" {
		return 0, ErrInvalid
	}
	result, err := r.db.Exec(`
update notifications
set read_timestamp=coalesce(read_timestamp, now())
where recipient_user_id=$1::uuid
  and read_timestamp is null
  and ($2 = '' or company_id = nullif($2, '')::uuid)
  and ($3 = '' or notification_type = $3)
  and ($4 = '' or surface = $4)
  and ($5 = '' or role = $5)
  and ($6 = '' or logic_gate_id = $6)
  and ($7 = '' or node_id = $7)`+notificationRecipientReadStateWhereSQL,
		input.UserID,
		input.CompanyID,
		input.NotificationType,
		input.Surface,
		input.Role,
		input.LogicGateID,
		input.NodeID,
	)
	if err != nil {
		return 0, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return int(affected), nil
}

func (r *PostgresRepo) MarkAllNotificationsRead(userID, companyID string) (int, error) {
	return r.MarkNotificationsRead(NotificationMarkReadInput{UserID: userID, CompanyID: companyID})
}

func (r *PostgresRepo) DeleteNotifications(input NotificationDeleteInput) ([]domain.Notification, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.NotificationID = strings.TrimSpace(input.NotificationID)
	input.NotificationType = strings.TrimSpace(input.NotificationType)
	input.Surface = strings.TrimSpace(input.Surface)
	input.Role = strings.TrimSpace(input.Role)
	input.LogicGateID = strings.TrimSpace(input.LogicGateID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.RealtimeMode = strings.TrimSpace(input.RealtimeMode)
	if input.UserID == "" || (input.RealtimeMode != "" && input.RealtimeMode != NotificationRealtimeDeleteEach && input.RealtimeMode != NotificationRealtimeClear) {
		return nil, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `
delete from notifications
where recipient_user_id=$1::uuid
  and ($2 = '' or company_id = nullif($2, '')::uuid)
  and ($3 = '' or notification_id = nullif($3, '')::uuid)
  and ($4 = '' or notification_type = $4)
  and ($5 = '' or surface = $5)
  and ($6 = '' or role = $6)
  and ($7 = '' or logic_gate_id = $7)
  and ($8 = '' or node_id = $8)
returning `+notificationSelectColumns,
		input.UserID,
		input.CompanyID,
		input.NotificationID,
		input.NotificationType,
		input.Surface,
		input.Role,
		input.LogicGateID,
		input.NodeID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	deleted := make([]domain.Notification, 0)
	for rows.Next() {
		item, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		deleted = append(deleted, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if input.NotificationID != "" && len(deleted) == 0 {
		return nil, ErrNotFound
	}
	outboxInputs, err := notificationDeletionOutboxInputs(deleted, input.RealtimeMode)
	if err != nil {
		return nil, err
	}
	for _, outboxInput := range outboxInputs {
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, outboxInput); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return deleted, nil
}

func (r *PostgresRepo) DeleteExpiredNotifications(olderThan time.Time, limit int) ([]domain.Notification, error) {
	if olderThan.IsZero() {
		return nil, ErrInvalid
	}
	limit = NormalizeNotificationCleanupLimit(limit)
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `
with expired as (
  select notification_id
  from notifications
  where created_timestamp < $1
    and read_timestamp is null
  order by created_timestamp asc, notification_id asc
  limit $2
),
deleted as (
  delete from notifications
  using expired
  where notifications.notification_id=expired.notification_id
  returning notifications.*
)
select `+notificationSelectColumns+`
from deleted
order by created_timestamp asc, notification_id asc`, olderThan.UTC(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	deleted := make([]domain.Notification, 0)
	for rows.Next() {
		item, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		deleted = append(deleted, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	outboxInputs, err := notificationDeletionOutboxInputs(deleted, NotificationRealtimeDeleteEach)
	if err != nil {
		return nil, err
	}
	for _, outboxInput := range outboxInputs {
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, outboxInput); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return deleted, nil
}
