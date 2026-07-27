package store

import (
	"context"
	"database/sql"
	"encoding/json"

	"miraeopus/backend/internal/domain"
)

// appendNodeV2BusinessMutationTx keeps the authoritative mutation, durable
// domain event, and realtime delivery record inside one transaction. Yjs
// typing updates deliberately do not call this boundary.
func (r *PostgresRepo) appendNodeV2BusinessMutationTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, nodeID, actorUserID, eventType, idempotencyKey string,
	payload map[string]any,
) ([]domain.DomainEvent, error) {
	payload["node_id"] = nodeID
	events, err := r.appendDomainEventsTx(ctx, tx, []DomainEventInput{{
		CompanyID: companyID, StreamType: EntityTypeNode, StreamID: nodeID,
		Type: eventType, ActorUserID: actorUserID, IdempotencyKey: idempotencyKey,
		Payload: payload,
	}})
	if err != nil {
		return nil, err
	}
	if len(events) != 1 {
		return nil, ErrInvalid
	}
	encoded, err := json.Marshal(map[string]any{
		"type": eventType, "company_id": companyID, "scope": "node-v2:" + nodeID,
		"node_id": nodeID, "payload": payload,
	})
	if err != nil {
		return nil, err
	}
	_, err = r.enqueueRealtimeOutboxTx(ctx, tx, RealtimeOutboxInput{
		EventID: events[0].EventID, CompanyID: companyID, Scope: "node-v2:" + nodeID,
		EventType: eventType, ResourceType: EntityTypeNode, ResourceID: nodeID,
		Permission: EntityPermissionEdit, Payload: encoded,
	})
	if err != nil {
		return nil, err
	}
	return events, nil
}
