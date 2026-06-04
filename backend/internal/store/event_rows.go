package store

import (
	"encoding/json"
	"sort"
	"strings"
	"time"
)

const EventRowListMaxLimit = 100
const DefaultEventRowProcessingLeaseTimeout = 5 * time.Minute

const (
	EventTypeKanbanProjectionDelta = "kanban.projection_delta"
	EventTypePermissionChanged     = "permission.changed"
)

const EventResourceTypeKanbanBoard = "kanban_board"

type EventRow struct {
	EventID             string         `json:"event_id"`
	CompanyID           string         `json:"company_id"`
	EventType           string         `json:"event_type"`
	ResourceType        string         `json:"resource_type,omitempty"`
	ResourceID          string         `json:"resource_id,omitempty"`
	PrimaryScope        string         `json:"primary_scope,omitempty"`
	AffectedScopes      []string       `json:"affected_scopes,omitempty"`
	ActorUserID         string         `json:"actor_user_id,omitempty"`
	IdempotencyKey      string         `json:"idempotency_key,omitempty"`
	SequenceScope       string         `json:"sequence_scope,omitempty"`
	Sequence            int64          `json:"sequence"`
	Payload             map[string]any `json:"payload,omitempty"`
	CreatedTimestamp    time.Time      `json:"created_timestamp"`
	AvailableAt         time.Time      `json:"available_at"`
	ProcessingStartedAt *time.Time     `json:"processing_started_at,omitempty"`
	ProcessedAt         *time.Time     `json:"processed_at,omitempty"`
	AttemptCount        int            `json:"attempt_count"`
	LastError           string         `json:"last_error,omitempty"`
}

type EventRowInput struct {
	CompanyID      string
	EventType      string
	ResourceType   string
	ResourceID     string
	PrimaryScope   string
	AffectedScopes []string
	ActorUserID    string
	IdempotencyKey string
	SequenceScope  string
	Payload        map[string]any
	AvailableAt    time.Time
}

type KanbanProjectionDeltaEventPayload struct {
	Projection string            `json:"projection"`
	Scope      string            `json:"scope"`
	Deltas     []ProjectionDelta `json:"deltas"`
}

type PermissionChangedEventPayload struct {
	EntityType string `json:"entity_type"`
	EntityID   string `json:"entity_id"`
}

func NormalizeEventRowListLimit(limit int) int {
	if limit <= 0 || limit > EventRowListMaxLimit {
		return 25
	}
	return limit
}

func NormalizeEventRowProcessingLeaseTimeout(timeout time.Duration) time.Duration {
	if timeout <= 0 {
		return DefaultEventRowProcessingLeaseTimeout
	}
	return timeout
}

func NormalizeEventRowInput(input EventRowInput) (EventRowInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.EventType = strings.TrimSpace(input.EventType)
	input.ResourceType = strings.TrimSpace(input.ResourceType)
	input.ResourceID = strings.TrimSpace(input.ResourceID)
	input.PrimaryScope = strings.TrimSpace(input.PrimaryScope)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.SequenceScope = strings.TrimSpace(input.SequenceScope)
	if input.SequenceScope == "" {
		input.SequenceScope = input.PrimaryScope
	}
	if input.CompanyID == "" || input.EventType == "" || input.SequenceScope == "" {
		return EventRowInput{}, ErrInvalid
	}
	input.AffectedScopes = normalizeEventScopes(input.AffectedScopes)
	if len(input.AffectedScopes) == 0 && input.PrimaryScope != "" {
		input.AffectedScopes = []string{input.PrimaryScope}
	}
	if input.Payload == nil {
		input.Payload = map[string]any{}
	}
	return input, nil
}

func EventRowPayloadJSON(payload map[string]any) ([]byte, error) {
	if payload == nil {
		payload = map[string]any{}
	}
	return json.Marshal(payload)
}

func NormalizeEventRowPayload(payload []byte) map[string]any {
	if len(payload) == 0 {
		return map[string]any{}
	}
	out := map[string]any{}
	if err := json.Unmarshal(payload, &out); err != nil {
		return map[string]any{}
	}
	return out
}

func normalizeEventScopes(scopes []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if scope == "" || seen[scope] {
			continue
		}
		seen[scope] = true
		out = append(out, scope)
	}
	sort.Strings(out)
	return out
}

func KanbanProjectionDeltaEventInputs(companyID, actorUserID, idempotencyKey string, deltas []ProjectionDelta) []EventRowInput {
	type group struct {
		boardID     string
		logicGateID string
		deltas      []ProjectionDelta
	}
	groups := map[string]group{}
	for _, delta := range deltas {
		if strings.TrimSpace(delta.Projection) != ProjectionNameKanbanBoard {
			continue
		}
		boardID := projectionDeltaBoardIDForEvent(delta)
		if boardID == "" {
			continue
		}
		item := groups[boardID]
		item.boardID = boardID
		if item.logicGateID == "" {
			item.logicGateID = LogicGateIDFromKanbanBoardID(boardID)
		}
		item.deltas = append(item.deltas, delta)
		groups[boardID] = item
	}
	if len(groups) == 0 {
		return nil
	}
	boardIDs := make([]string, 0, len(groups))
	for boardID := range groups {
		boardIDs = append(boardIDs, boardID)
	}
	sort.Strings(boardIDs)
	inputs := make([]EventRowInput, 0, len(boardIDs))
	for _, boardID := range boardIDs {
		item := groups[boardID]
		scope := "board:" + boardID
		resourceID := item.logicGateID
		resourceType := EntityTypeLogicGate
		if resourceID == "" {
			resourceID = boardID
			resourceType = EventResourceTypeKanbanBoard
		}
		payloadBytes, _ := json.Marshal(KanbanProjectionDeltaEventPayload{
			Projection: ProjectionNameKanbanBoard,
			Scope:      scope,
			Deltas:     item.deltas,
		})
		inputs = append(inputs, EventRowInput{
			CompanyID:      companyID,
			EventType:      EventTypeKanbanProjectionDelta,
			ResourceType:   resourceType,
			ResourceID:     resourceID,
			PrimaryScope:   scope,
			AffectedScopes: []string{scope},
			ActorUserID:    actorUserID,
			IdempotencyKey: scopedEventIdempotencyKey(idempotencyKey, scope),
			SequenceScope:  scope,
			Payload:        NormalizeEventRowPayload(payloadBytes),
		})
	}
	return inputs
}

func PermissionChangedEventInput(companyID, entityType, entityID, actorUserID string) (EventRowInput, bool) {
	entityType, ok := NormalizeEntityType(entityType)
	entityID = strings.TrimSpace(entityID)
	if companyID == "" || entityID == "" || !ok {
		return EventRowInput{}, false
	}
	primaryScope := entityType + ":" + entityID
	payloadBytes, _ := json.Marshal(PermissionChangedEventPayload{EntityType: entityType, EntityID: entityID})
	return EventRowInput{
		CompanyID:      companyID,
		EventType:      EventTypePermissionChanged,
		ResourceType:   entityType,
		ResourceID:     entityID,
		PrimaryScope:   primaryScope,
		AffectedScopes: []string{primaryScope},
		ActorUserID:    actorUserID,
		SequenceScope:  primaryScope,
		Payload:        NormalizeEventRowPayload(payloadBytes),
	}, true
}

func DecodeKanbanProjectionDeltaEventPayload(row EventRow) (KanbanProjectionDeltaEventPayload, error) {
	payloadBytes, err := json.Marshal(row.Payload)
	if err != nil {
		return KanbanProjectionDeltaEventPayload{}, err
	}
	var payload KanbanProjectionDeltaEventPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return KanbanProjectionDeltaEventPayload{}, err
	}
	payload.Projection = strings.TrimSpace(payload.Projection)
	payload.Scope = strings.TrimSpace(payload.Scope)
	return payload, nil
}

func DecodePermissionChangedEventPayload(row EventRow) (PermissionChangedEventPayload, error) {
	payloadBytes, err := json.Marshal(row.Payload)
	if err != nil {
		return PermissionChangedEventPayload{}, err
	}
	var payload PermissionChangedEventPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return PermissionChangedEventPayload{}, err
	}
	payload.EntityType = strings.TrimSpace(payload.EntityType)
	payload.EntityID = strings.TrimSpace(payload.EntityID)
	return payload, nil
}

func projectionDeltaBoardIDForEvent(delta ProjectionDelta) string {
	if boardID := strings.TrimSpace(delta.RowKey.BoardID); boardID != "" {
		return boardID
	}
	if delta.Row != nil {
		return strings.TrimSpace(delta.Row.BoardID)
	}
	return ""
}

func scopedEventIdempotencyKey(idempotencyKey, scope string) string {
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	scope = strings.TrimSpace(scope)
	if idempotencyKey == "" || scope == "" {
		return idempotencyKey
	}
	return idempotencyKey + ":" + scope
}
