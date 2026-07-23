package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const nodeTimelineEventColumns = `event_id::text, company_id::text, node_id::text, event_type,
coalesce(actor_user_id::text, ''), actor_display_name,
coalesce(from_logic_gate_id::text, ''), from_logic_gate_name,
coalesce(to_logic_gate_id::text, ''), to_logic_gate_name,
idempotency_key, created_timestamp`

func scanNodeTimelineEvent(scanner interface{ Scan(...any) error }) (domain.NodeTimelineEvent, error) {
	var item domain.NodeTimelineEvent
	err := scanner.Scan(
		&item.EventID, &item.CompanyID, &item.NodeID, &item.Type,
		&item.ActorUserID, &item.ActorDisplayName,
		&item.FromLogicGateID, &item.FromLogicGateName,
		&item.ToLogicGateID, &item.ToLogicGateName,
		&item.IdempotencyKey, &item.CreatedTimestamp,
	)
	item.VerificationRecipients = []domain.NodeTimelineVerificationRecipient{}
	return item, err
}

func listNodeTimelineRecipientsQuery(ctx context.Context, queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, companyID, nodeID, eventID string) ([]domain.NodeTimelineVerificationRecipient, error) {
	rows, err := queryer.QueryContext(ctx, `
select company_id::text, node_id::text, event_id::text, user_id::text,
       user_display_name, completed_timestamp, created_timestamp
from node_timeline_verification_recipients
where company_id=$1::uuid and node_id=$2::uuid and event_id=$3::uuid
order by lower(user_display_name), user_id`, companyID, nodeID, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.NodeTimelineVerificationRecipient, 0)
	for rows.Next() {
		var item domain.NodeTimelineVerificationRecipient
		if err := rows.Scan(&item.CompanyID, &item.NodeID, &item.EventID, &item.UserID, &item.UserDisplayName, &item.CompletedTimestamp, &item.CreatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func nodeTimelineEventByIDTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, eventID string) (domain.NodeTimelineEvent, error) {
	item, err := scanNodeTimelineEvent(tx.QueryRowContext(ctx, `select `+nodeTimelineEventColumns+`
from node_timeline_events
where company_id=$1::uuid and node_id=$2::uuid and event_id=$3::uuid`, companyID, nodeID, eventID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NodeTimelineEvent{}, ErrNotFound
	}
	if err != nil {
		return domain.NodeTimelineEvent{}, err
	}
	item.VerificationRecipients, err = listNodeTimelineRecipientsQuery(ctx, tx, companyID, nodeID, eventID)
	return item, err
}

func (r *PostgresRepo) ListNodeTimelineEvents(companyID, nodeID string) ([]domain.NodeTimelineEvent, error) {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	if companyID == "" || nodeID == "" {
		return nil, ErrInvalid
	}
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx, `select `+nodeTimelineEventColumns+`
from node_timeline_events
where company_id=$1::uuid and node_id=$2::uuid
order by created_timestamp desc, event_id desc`, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.NodeTimelineEvent, 0)
	for rows.Next() {
		item, err := scanNodeTimelineEvent(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range items {
		items[index].VerificationRecipients, err = listNodeTimelineRecipientsQuery(ctx, r.db, companyID, nodeID, items[index].EventID)
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}

func (r *PostgresRepo) CreateNodeVerificationRequest(input NodeVerificationRequestInput) (NodeTimelineMutationResult, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.CompanyID == "" || input.NodeID == "" || input.ActorUserID == "" || input.IdempotencyKey == "" {
		return NodeTimelineMutationResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return NodeTimelineMutationResult{}, err
	}
	defer tx.Rollback()

	var existingID string
	err = tx.QueryRowContext(ctx, `select event_id::text from node_timeline_events
where company_id=$1::uuid and node_id=$2::uuid and event_type='verification_request' and idempotency_key=$3`, input.CompanyID, input.NodeID, input.IdempotencyKey).Scan(&existingID)
	if err == nil {
		item, getErr := nodeTimelineEventByIDTx(ctx, tx, input.CompanyID, input.NodeID, existingID)
		return NodeTimelineMutationResult{TimelineEvent: item}, getErr
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return NodeTimelineMutationResult{}, err
	}

	var nodeTitle, actorDisplayName string
	if err := tx.QueryRowContext(ctx, `
select n.name, coalesce(nullif(u.display_name, ''), nullif(u.email, ''), 'Unknown user')
from nodes n left join users u on u.user_id=$3::uuid
where n.company_id=$1::uuid and n.node_id=$2::uuid for update of n`, input.CompanyID, input.NodeID, input.ActorUserID).Scan(&nodeTitle, &actorDisplayName); errors.Is(err, sql.ErrNoRows) {
		return NodeTimelineMutationResult{}, ErrNotFound
	} else if err != nil {
		return NodeTimelineMutationResult{}, err
	}
	existingID = ""
	err = tx.QueryRowContext(ctx, `select event_id::text from node_timeline_events
where company_id=$1::uuid and node_id=$2::uuid and event_type='verification_request' and idempotency_key=$3`, input.CompanyID, input.NodeID, input.IdempotencyKey).Scan(&existingID)
	if err == nil {
		item, getErr := nodeTimelineEventByIDTx(ctx, tx, input.CompanyID, input.NodeID, existingID)
		return NodeTimelineMutationResult{TimelineEvent: item}, getErr
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return NodeTimelineMutationResult{}, err
	}

	rows, err := tx.QueryContext(ctx, postgresDerivedResourceGVICEffectiveAssignmentsCTE+`
select distinct derived.user_id::text,
       coalesce(nullif(app_user.display_name, ''), nullif(app_user.email, ''), 'Unknown user')
from derived
join users app_user on app_user.user_id=derived.user_id
where derived.role='verified'
order by 2, 1`, input.CompanyID, EntityTypeNode, input.NodeID)
	if err != nil {
		return NodeTimelineMutationResult{}, err
	}
	recipientNames := map[string]string{}
	for rows.Next() {
		var userID, displayName string
		if err := rows.Scan(&userID, &displayName); err != nil {
			rows.Close()
			return NodeTimelineMutationResult{}, err
		}
		recipientNames[userID] = displayName
	}
	if err := rows.Close(); err != nil {
		return NodeTimelineMutationResult{}, err
	}
	if len(recipientNames) == 0 {
		return NodeTimelineMutationResult{}, ErrNoVerificationRecipients
	}

	eventID := newUUIDv7String()
	item, err := scanNodeTimelineEvent(tx.QueryRowContext(ctx, `
insert into node_timeline_events
(event_id, company_id, node_id, event_type, actor_user_id, actor_display_name, idempotency_key)
values ($1::uuid, $2::uuid, $3::uuid, 'verification_request', $4::uuid, $5, $6)
returning `+nodeTimelineEventColumns, eventID, input.CompanyID, input.NodeID, input.ActorUserID, actorDisplayName, input.IdempotencyKey))
	if err != nil {
		return NodeTimelineMutationResult{}, err
	}
	recipientUserIDs := make([]string, 0, len(recipientNames))
	for userID, displayName := range recipientNames {
		if _, err := tx.ExecContext(ctx, `
insert into node_timeline_verification_recipients
(company_id, node_id, event_id, user_id, user_display_name)
values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)`, input.CompanyID, input.NodeID, eventID, userID, displayName); err != nil {
			return NodeTimelineMutationResult{}, err
		}
		recipientUserIDs = append(recipientUserIDs, userID)
	}
	sort.Strings(recipientUserIDs)
	item.VerificationRecipients, err = listNodeTimelineRecipientsQuery(ctx, tx, input.CompanyID, input.NodeID, eventID)
	if err != nil {
		return NodeTimelineMutationResult{}, err
	}
	events, err := r.appendDomainEventsTx(ctx, tx, []DomainEventInput{{
		CompanyID: input.CompanyID, StreamType: EntityTypeNode, StreamID: input.NodeID,
		Type: NodeVerificationRequestedWorkspaceEventType, ActorUserID: input.ActorUserID,
		IdempotencyKey: "node-verification-request:" + input.IdempotencyKey,
		Payload: map[string]any{
			"timeline_event_id": eventID, "node_id": input.NodeID, "node_title": strings.TrimSpace(nodeTitle),
			"actor_display_name": actorDisplayName, "recipient_user_ids": recipientUserIDs,
		},
	}})
	if err != nil {
		return NodeTimelineMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return NodeTimelineMutationResult{}, err
	}
	return NodeTimelineMutationResult{TimelineEvent: item, Events: events}, nil
}

func (r *PostgresRepo) CompleteNodeVerificationRequest(input NodeVerificationCompletionInput) (domain.NodeTimelineEvent, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.EventID = strings.TrimSpace(input.EventID)
	input.UserID = strings.TrimSpace(input.UserID)
	if input.CompanyID == "" || input.NodeID == "" || input.EventID == "" || input.UserID == "" {
		return domain.NodeTimelineEvent{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.NodeTimelineEvent{}, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
update node_timeline_verification_recipients
set completed_timestamp=coalesce(completed_timestamp, now())
where company_id=$1::uuid and node_id=$2::uuid and event_id=$3::uuid and user_id=$4::uuid`, input.CompanyID, input.NodeID, input.EventID, input.UserID)
	if err != nil {
		return domain.NodeTimelineEvent{}, err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return domain.NodeTimelineEvent{}, err
	} else if affected == 0 {
		return domain.NodeTimelineEvent{}, ErrNotFound
	}
	item, err := nodeTimelineEventByIDTx(ctx, tx, input.CompanyID, input.NodeID, input.EventID)
	if err != nil {
		return domain.NodeTimelineEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.NodeTimelineEvent{}, err
	}
	return item, nil
}

func insertLogicGateTransferTimelineEventTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, actorUserID, fromLogicGateID, toLogicGateID string) (domain.NodeTimelineEvent, error) {
	item, err := scanNodeTimelineEvent(tx.QueryRowContext(ctx, `
insert into node_timeline_events
(event_id, company_id, node_id, event_type, actor_user_id, actor_display_name,
 from_logic_gate_id, from_logic_gate_name, to_logic_gate_id, to_logic_gate_name)
select $1::uuid, $2::uuid, $3::uuid, 'logic_gate_transfer', $4::uuid,
       coalesce(nullif(actor.display_name, ''), nullif(actor.email, ''), 'Unknown user'),
       $5::uuid, coalesce(nullif(source_gate.header, ''), 'Deleted logic gate'),
       $6::uuid, coalesce(nullif(target_gate.header, ''), 'Deleted logic gate')
from logic_gates source_gate
join logic_gates target_gate on target_gate.company_id=source_gate.company_id and target_gate.logic_gate_id=$6::uuid
left join users actor on actor.user_id=$4::uuid
where source_gate.company_id=$2::uuid and source_gate.logic_gate_id=$5::uuid
returning `+nodeTimelineEventColumns,
		newUUIDv7String(), companyID, nodeID, actorUserID, fromLogicGateID, toLogicGateID))
	return item, err
}
