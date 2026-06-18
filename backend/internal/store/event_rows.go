package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const EventRowListMaxLimit = 100
const DefaultEventRowProcessingLeaseTimeout = 5 * time.Minute

const (
	EventTypeKanbanProjectionDelta              = "kanban.projection_delta"
	EventTypeRacioProjectionDelta               = "racio.projection_delta"
	EventTypeProjectManagementProjectionDelta   = "project_management.projection_delta"
	EventTypeProjectRelationshipProjectionDelta = "project_relationship.projection_delta"
	EventTypeEditorProjectionDelta              = "editor.projection_delta"
	EventTypeGVICProjectionDelta                = "gvic.projection_delta"
	EventTypePermissionChanged                  = "permission.changed"
)

const EventResourceTypeKanbanBoard = "kanban_board"
const EventResourceTypeRacioMatrix = "racio_matrix"
const EventResourceTypeGVICEffectiveAssignments = "gvic_effective_assignments"
const EventResourceTypeProjectManagementTimeline = "project_management_timeline"
const EventResourceTypeProjectRelationship = "project_relationship"

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

type RacioProjectionDeltaEventPayload struct {
	Projection      string            `json:"projection"`
	Scope           string            `json:"scope"`
	ProjectionScope string            `json:"projection_scope,omitempty"`
	Deltas          []ProjectionDelta `json:"deltas"`
}

type GVICProjectionDeltaEventPayload struct {
	Projection string            `json:"projection"`
	Scope      string            `json:"scope"`
	Deltas     []ProjectionDelta `json:"deltas"`
}

type ProjectManagementProjectionDeltaEventPayload struct {
	Projection      string            `json:"projection"`
	Scope           string            `json:"scope"`
	ProjectionScope string            `json:"projection_scope,omitempty"`
	Deltas          []ProjectionDelta `json:"deltas"`
}

type ProjectRelationshipProjectionDeltaEventPayload struct {
	Projection string            `json:"projection"`
	Scope      string            `json:"scope"`
	Deltas     []ProjectionDelta `json:"deltas"`
}

type PermissionChangedEventPayload struct {
	EntityType string `json:"entity_type"`
	EntityID   string `json:"entity_id"`
}

type EditorProjectionRowKey struct {
	ResourceType  string `json:"resource_type"`
	ResourceID    string `json:"resource_id"`
	InformationID string `json:"information_id"`
}

type EditorProjectionRow struct {
	CompanyID        string    `json:"company_id"`
	ResourceType     string    `json:"resource_type"`
	ResourceID       string    `json:"resource_id"`
	NodeID           string    `json:"node_id,omitempty"`
	LogicGateID      string    `json:"logic_gate_id,omitempty"`
	ProjectID        string    `json:"project_id,omitempty"`
	InformationID    string    `json:"information_id"`
	Type             string    `json:"type"`
	Information      string    `json:"information"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type EditorProjectionDelta struct {
	Operation string                 `json:"operation"`
	RowKey    EditorProjectionRowKey `json:"row_key"`
	Row       *EditorProjectionRow   `json:"row,omitempty"`
	Patch     map[string]any         `json:"patch,omitempty"`
}

type EditorProjectionDeltaEventPayload struct {
	Scope        string                  `json:"scope"`
	ResourceType string                  `json:"resource_type"`
	ResourceID   string                  `json:"resource_id"`
	Deltas       []EditorProjectionDelta `json:"deltas"`
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

func ProjectionDeltaEventInputs(companyID, actorUserID, idempotencyKey string, deltas []ProjectionDelta) []EventRowInput {
	inputs := KanbanProjectionDeltaEventInputs(companyID, actorUserID, idempotencyKey, deltas)
	inputs = append(inputs, GVICProjectionDeltaEventInputs(companyID, actorUserID, idempotencyKey, deltas)...)
	inputs = append(inputs, RacioProjectionDeltaEventInputs(companyID, actorUserID, idempotencyKey, deltas)...)
	inputs = append(inputs, ProjectManagementProjectionDeltaEventInputs(companyID, actorUserID, idempotencyKey, deltas)...)
	inputs = append(inputs, ProjectRelationshipProjectionDeltaEventInputs(companyID, actorUserID, idempotencyKey, deltas)...)
	return inputs
}

func EditorProjectionRowFromNode(row domain.NodeProjection) EditorProjectionRow {
	return EditorProjectionRow{
		CompanyID:        strings.TrimSpace(row.CompanyID),
		ResourceType:     EntityTypeNode,
		ResourceID:       strings.TrimSpace(row.NodeID),
		NodeID:           strings.TrimSpace(row.NodeID),
		InformationID:    strings.TrimSpace(row.InformationID),
		Type:             strings.TrimSpace(row.Type),
		Information:      row.Information,
		CreatedTimestamp: row.CreatedTimestamp,
		UpdatedTimestamp: row.UpdatedTimestamp,
	}
}

func EditorProjectionRowFromLogicGate(row domain.LogicGateProjection) EditorProjectionRow {
	return EditorProjectionRow{
		CompanyID:        strings.TrimSpace(row.CompanyID),
		ResourceType:     EntityTypeLogicGate,
		ResourceID:       strings.TrimSpace(row.LogicGateID),
		LogicGateID:      strings.TrimSpace(row.LogicGateID),
		InformationID:    strings.TrimSpace(row.InformationID),
		Type:             strings.TrimSpace(row.Type),
		Information:      row.Information,
		CreatedTimestamp: row.CreatedTimestamp,
		UpdatedTimestamp: row.UpdatedTimestamp,
	}
}

func EditorProjectionRowFromProject(row domain.ProjectProjection) EditorProjectionRow {
	return EditorProjectionRow{
		CompanyID:        strings.TrimSpace(row.CompanyID),
		ResourceType:     EntityTypeProject,
		ResourceID:       strings.TrimSpace(row.ProjectID),
		ProjectID:        strings.TrimSpace(row.ProjectID),
		InformationID:    strings.TrimSpace(row.InformationID),
		Type:             strings.TrimSpace(row.Type),
		Information:      row.Information,
		CreatedTimestamp: row.CreatedTimestamp,
		UpdatedTimestamp: row.UpdatedTimestamp,
	}
}

func EditorProjectionUpsertEventInput(companyID, actorUserID, idempotencyKey string, row EditorProjectionRow) (EventRowInput, bool) {
	resourceType, ok := NormalizeEntityType(row.ResourceType)
	resourceID := strings.TrimSpace(row.ResourceID)
	informationID := strings.TrimSpace(row.InformationID)
	if companyID == "" {
		companyID = strings.TrimSpace(row.CompanyID)
	}
	if !ok || companyID == "" || resourceID == "" || informationID == "" {
		return EventRowInput{}, false
	}
	row.CompanyID = strings.TrimSpace(companyID)
	row.ResourceType = resourceType
	row.ResourceID = resourceID
	row.InformationID = informationID
	if resourceType == EntityTypeNode {
		row.NodeID = resourceID
		row.LogicGateID = ""
		row.ProjectID = ""
	} else if resourceType == EntityTypeLogicGate {
		row.LogicGateID = resourceID
		row.NodeID = ""
		row.ProjectID = ""
	} else if resourceType == EntityTypeProject {
		row.ProjectID = resourceID
		row.NodeID = ""
		row.LogicGateID = ""
	}
	return EditorProjectionDeltaEventInput(companyID, actorUserID, idempotencyKey, resourceType, resourceID, []EditorProjectionDelta{{
		Operation: ProjectionDeltaOperationUpsert,
		RowKey:    editorProjectionRowKey(resourceType, resourceID, informationID),
		Row:       &row,
	}})
}

func EditorProjectionDeleteEventInput(companyID, actorUserID, idempotencyKey, resourceType, resourceID, informationID string) (EventRowInput, bool) {
	resourceType, ok := NormalizeEntityType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	informationID = strings.TrimSpace(informationID)
	if companyID == "" || !ok || resourceID == "" || informationID == "" {
		return EventRowInput{}, false
	}
	return EditorProjectionDeltaEventInput(companyID, actorUserID, idempotencyKey, resourceType, resourceID, []EditorProjectionDelta{{
		Operation: ProjectionDeltaOperationDelete,
		RowKey:    editorProjectionRowKey(resourceType, resourceID, informationID),
	}})
}

func EditorProjectionDeltaEventInput(companyID, actorUserID, idempotencyKey, resourceType, resourceID string, deltas []EditorProjectionDelta) (EventRowInput, bool) {
	resourceType, ok := NormalizeEntityType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	scope := EditorRealtimeScope(resourceType, resourceID)
	if companyID == "" || !ok || resourceID == "" || scope == "" || len(deltas) == 0 {
		return EventRowInput{}, false
	}
	normalized := make([]EditorProjectionDelta, 0, len(deltas))
	for _, delta := range deltas {
		operation := strings.TrimSpace(delta.Operation)
		if operation != ProjectionDeltaOperationUpsert && operation != ProjectionDeltaOperationPatch && operation != ProjectionDeltaOperationDelete {
			continue
		}
		informationID := strings.TrimSpace(delta.RowKey.InformationID)
		if informationID == "" && delta.Row != nil {
			informationID = strings.TrimSpace(delta.Row.InformationID)
		}
		if informationID == "" {
			continue
		}
		delta.Operation = operation
		delta.RowKey = editorProjectionRowKey(resourceType, resourceID, informationID)
		if delta.Row != nil {
			row := *delta.Row
			row.CompanyID = strings.TrimSpace(companyID)
			row.ResourceType = resourceType
			row.ResourceID = resourceID
			row.InformationID = informationID
			if resourceType == EntityTypeNode {
				row.NodeID = resourceID
				row.LogicGateID = ""
				row.ProjectID = ""
			} else if resourceType == EntityTypeLogicGate {
				row.LogicGateID = resourceID
				row.NodeID = ""
				row.ProjectID = ""
			} else if resourceType == EntityTypeProject {
				row.ProjectID = resourceID
				row.NodeID = ""
				row.LogicGateID = ""
			}
			delta.Row = &row
		}
		normalized = append(normalized, delta)
	}
	if len(normalized) == 0 {
		return EventRowInput{}, false
	}
	payloadBytes, _ := json.Marshal(EditorProjectionDeltaEventPayload{
		Scope:        scope,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Deltas:       normalized,
	})
	return EventRowInput{
		CompanyID:      companyID,
		EventType:      EventTypeEditorProjectionDelta,
		ResourceType:   resourceType,
		ResourceID:     resourceID,
		PrimaryScope:   scope,
		AffectedScopes: []string{scope},
		ActorUserID:    actorUserID,
		IdempotencyKey: scopedEventIdempotencyKey(idempotencyKey, scope),
		SequenceScope:  scope,
		Payload:        NormalizeEventRowPayload(payloadBytes),
	}, true
}

func EditorRealtimeScope(resourceType, resourceID string) string {
	resourceType, ok := NormalizeEntityType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	if !ok || resourceID == "" {
		return ""
	}
	switch resourceType {
	case EntityTypeNode:
		return "editor:node:" + resourceID
	case EntityTypeLogicGate:
		return "editor:logic_gate:" + resourceID
	case EntityTypeProject:
		return "editor:project:" + resourceID
	default:
		return ""
	}
}

func editorProjectionRowKey(resourceType, resourceID, informationID string) EditorProjectionRowKey {
	return EditorProjectionRowKey{
		ResourceType:  strings.TrimSpace(resourceType),
		ResourceID:    strings.TrimSpace(resourceID),
		InformationID: strings.TrimSpace(informationID),
	}
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

func RacioProjectionDeltaEventInputs(companyID, actorUserID, idempotencyKey string, deltas []ProjectionDelta) []EventRowInput {
	type group struct {
		userID string
		deltas []ProjectionDelta
	}
	groups := map[string]group{}
	for _, delta := range deltas {
		if strings.TrimSpace(delta.Projection) != ProjectionNameRacioMatrix {
			continue
		}
		userID := projectionDeltaUserIDForEvent(delta)
		if userID == "" {
			continue
		}
		item := groups[userID]
		item.userID = userID
		item.deltas = append(item.deltas, delta)
		groups[userID] = item
	}
	if len(groups) == 0 {
		return nil
	}
	userIDs := make([]string, 0, len(groups))
	for userID := range groups {
		userIDs = append(userIDs, userID)
	}
	sort.Strings(userIDs)
	inputs := make([]EventRowInput, 0, len(userIDs))
	for _, userID := range userIDs {
		item := groups[userID]
		scope := RacioRealtimeUserScope(userID)
		projectionScope := RacioProjectionUserScope(userID)
		if scope == "" || projectionScope == "" {
			continue
		}
		payloadBytes, _ := json.Marshal(RacioProjectionDeltaEventPayload{
			Projection:      ProjectionNameRacioMatrix,
			Scope:           scope,
			ProjectionScope: projectionScope,
			Deltas:          item.deltas,
		})
		inputs = append(inputs, EventRowInput{
			CompanyID:      companyID,
			EventType:      EventTypeRacioProjectionDelta,
			ResourceType:   EventResourceTypeRacioMatrix,
			ResourceID:     userID,
			PrimaryScope:   scope,
			AffectedScopes: []string{scope},
			ActorUserID:    actorUserID,
			IdempotencyKey: scopedEventIdempotencyKey(idempotencyKey, scope),
			SequenceScope:  projectionScope,
			Payload:        NormalizeEventRowPayload(payloadBytes),
		})
	}
	return inputs
}

func GVICProjectionDeltaEventInputs(companyID, actorUserID, idempotencyKey string, deltas []ProjectionDelta) []EventRowInput {
	type group struct {
		userID string
		deltas []ProjectionDelta
	}
	groups := map[string]group{}
	for _, delta := range deltas {
		if strings.TrimSpace(delta.Projection) != ProjectionNameGVICEffectiveAssignments {
			continue
		}
		userID := projectionDeltaUserIDForEvent(delta)
		if userID == "" {
			continue
		}
		item := groups[userID]
		item.userID = userID
		item.deltas = append(item.deltas, delta)
		groups[userID] = item
	}
	if len(groups) == 0 {
		return nil
	}
	userIDs := make([]string, 0, len(groups))
	for userID := range groups {
		userIDs = append(userIDs, userID)
	}
	sort.Strings(userIDs)
	inputs := make([]EventRowInput, 0, len(userIDs))
	for _, userID := range userIDs {
		item := groups[userID]
		scope := "gvic:user:" + userID
		payloadBytes, _ := json.Marshal(GVICProjectionDeltaEventPayload{
			Projection: ProjectionNameGVICEffectiveAssignments,
			Scope:      scope,
			Deltas:     item.deltas,
		})
		inputs = append(inputs, EventRowInput{
			CompanyID:      companyID,
			EventType:      EventTypeGVICProjectionDelta,
			ResourceType:   EventResourceTypeGVICEffectiveAssignments,
			ResourceID:     userID,
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

func ProjectManagementProjectionDeltaEventInputs(companyID, actorUserID, idempotencyKey string, deltas []ProjectionDelta) []EventRowInput {
	type group struct {
		userID string
		deltas []ProjectionDelta
	}
	groups := map[string]group{}
	for _, delta := range deltas {
		if strings.TrimSpace(delta.Projection) != ProjectionNameProjectManagementTimeline {
			continue
		}
		userID := projectionDeltaUserIDForEvent(delta)
		if userID == "" {
			continue
		}
		item := groups[userID]
		item.userID = userID
		item.deltas = append(item.deltas, delta)
		groups[userID] = item
	}
	if len(groups) == 0 {
		return nil
	}
	userIDs := make([]string, 0, len(groups))
	for userID := range groups {
		userIDs = append(userIDs, userID)
	}
	sort.Strings(userIDs)
	inputs := make([]EventRowInput, 0, len(userIDs))
	for _, userID := range userIDs {
		item := groups[userID]
		scope := ProjectManagementRealtimeUserScope(userID)
		projectionScope := ProjectManagementProjectionUserScope(userID)
		if scope == "" || projectionScope == "" {
			continue
		}
		payloadBytes, _ := json.Marshal(ProjectManagementProjectionDeltaEventPayload{
			Projection:      ProjectionNameProjectManagementTimeline,
			Scope:           scope,
			ProjectionScope: projectionScope,
			Deltas:          item.deltas,
		})
		inputs = append(inputs, EventRowInput{
			CompanyID:      companyID,
			EventType:      EventTypeProjectManagementProjectionDelta,
			ResourceType:   EventResourceTypeProjectManagementTimeline,
			ResourceID:     userID,
			PrimaryScope:   scope,
			AffectedScopes: []string{scope},
			ActorUserID:    actorUserID,
			IdempotencyKey: scopedEventIdempotencyKey(idempotencyKey, scope),
			SequenceScope:  projectionScope,
			Payload:        NormalizeEventRowPayload(payloadBytes),
		})
	}
	return inputs
}

func ProjectRelationshipProjectionDeltaEventInputs(companyID, actorUserID, idempotencyKey string, deltas []ProjectionDelta) []EventRowInput {
	type group struct {
		projectID string
		deltas    []ProjectionDelta
		scopes    []string
	}
	groups := map[string]group{}
	for _, delta := range deltas {
		if strings.TrimSpace(delta.Projection) != ProjectionNameProjectRelationship {
			continue
		}
		projectID := projectionDeltaProjectIDForEvent(delta)
		if projectID == "" {
			continue
		}
		item := groups[projectID]
		item.projectID = projectID
		item.deltas = append(item.deltas, delta)
		item.scopes = append(item.scopes, ProjectRelationshipProjectionProjectScope(projectID))
		item.scopes = append(item.scopes, projectRelationshipProjectionResourceScopesForEvent(delta)...)
		groups[projectID] = item
	}
	if len(groups) == 0 {
		return nil
	}
	projectIDs := make([]string, 0, len(groups))
	for projectID := range groups {
		projectIDs = append(projectIDs, projectID)
	}
	sort.Strings(projectIDs)
	inputs := make([]EventRowInput, 0, len(projectIDs))
	for _, projectID := range projectIDs {
		item := groups[projectID]
		scope := ProjectRelationshipProjectionProjectScope(projectID)
		if scope == "" {
			continue
		}
		payloadBytes, _ := json.Marshal(ProjectRelationshipProjectionDeltaEventPayload{
			Projection: ProjectionNameProjectRelationship,
			Scope:      scope,
			Deltas:     item.deltas,
		})
		inputs = append(inputs, EventRowInput{
			CompanyID:      companyID,
			EventType:      EventTypeProjectRelationshipProjectionDelta,
			ResourceType:   EntityTypeProject,
			ResourceID:     projectID,
			PrimaryScope:   scope,
			AffectedScopes: normalizeEventScopes(item.scopes),
			ActorUserID:    actorUserID,
			IdempotencyKey: scopedEventIdempotencyKey(idempotencyKey, scope),
			SequenceScope:  scope,
			Payload:        NormalizeEventRowPayload(payloadBytes),
		})
	}
	return inputs
}

func RacioRealtimeUserScope(userID string) string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ""
	}
	return "racio:user:" + userID
}

func ProjectManagementRealtimeUserScope(userID string) string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ""
	}
	return "project_management:user:" + userID
}

func RacioProjectionUserScope(userID string) string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ""
	}
	return "user:" + userID
}

func ProjectManagementProjectionUserScope(userID string) string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ""
	}
	return "user:" + userID
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

func DecodeRacioProjectionDeltaEventPayload(row EventRow) (RacioProjectionDeltaEventPayload, error) {
	payloadBytes, err := json.Marshal(row.Payload)
	if err != nil {
		return RacioProjectionDeltaEventPayload{}, err
	}
	var payload RacioProjectionDeltaEventPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return RacioProjectionDeltaEventPayload{}, err
	}
	payload.Projection = strings.TrimSpace(payload.Projection)
	payload.Scope = strings.TrimSpace(payload.Scope)
	payload.ProjectionScope = strings.TrimSpace(payload.ProjectionScope)
	return payload, nil
}

func DecodeGVICProjectionDeltaEventPayload(row EventRow) (GVICProjectionDeltaEventPayload, error) {
	payloadBytes, err := json.Marshal(row.Payload)
	if err != nil {
		return GVICProjectionDeltaEventPayload{}, err
	}
	var payload GVICProjectionDeltaEventPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return GVICProjectionDeltaEventPayload{}, err
	}
	payload.Projection = strings.TrimSpace(payload.Projection)
	payload.Scope = strings.TrimSpace(payload.Scope)
	return payload, nil
}

func DecodeProjectManagementProjectionDeltaEventPayload(row EventRow) (ProjectManagementProjectionDeltaEventPayload, error) {
	payloadBytes, err := json.Marshal(row.Payload)
	if err != nil {
		return ProjectManagementProjectionDeltaEventPayload{}, err
	}
	var payload ProjectManagementProjectionDeltaEventPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return ProjectManagementProjectionDeltaEventPayload{}, err
	}
	payload.Projection = strings.TrimSpace(payload.Projection)
	payload.Scope = strings.TrimSpace(payload.Scope)
	payload.ProjectionScope = strings.TrimSpace(payload.ProjectionScope)
	return payload, nil
}

func DecodeProjectRelationshipProjectionDeltaEventPayload(row EventRow) (ProjectRelationshipProjectionDeltaEventPayload, error) {
	payloadBytes, err := json.Marshal(row.Payload)
	if err != nil {
		return ProjectRelationshipProjectionDeltaEventPayload{}, err
	}
	var payload ProjectRelationshipProjectionDeltaEventPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return ProjectRelationshipProjectionDeltaEventPayload{}, err
	}
	payload.Projection = strings.TrimSpace(payload.Projection)
	payload.Scope = strings.TrimSpace(payload.Scope)
	return payload, nil
}

func DecodeEditorProjectionDeltaEventPayload(row EventRow) (EditorProjectionDeltaEventPayload, error) {
	payloadBytes, err := json.Marshal(row.Payload)
	if err != nil {
		return EditorProjectionDeltaEventPayload{}, err
	}
	var payload EditorProjectionDeltaEventPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return EditorProjectionDeltaEventPayload{}, err
	}
	payload.Scope = strings.TrimSpace(payload.Scope)
	payload.ResourceType = strings.TrimSpace(payload.ResourceType)
	payload.ResourceID = strings.TrimSpace(payload.ResourceID)
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

func projectionDeltaUserIDForEvent(delta ProjectionDelta) string {
	if userID := strings.TrimSpace(delta.RowKey.UserID); userID != "" {
		return userID
	}
	if delta.Row != nil {
		return strings.TrimSpace(delta.Row.UserID)
	}
	return ""
}

func projectionDeltaProjectIDForEvent(delta ProjectionDelta) string {
	if projectID := strings.TrimSpace(delta.RowKey.ProjectID); projectID != "" {
		return projectID
	}
	if delta.Row != nil {
		return strings.TrimSpace(delta.Row.ProjectID)
	}
	return ""
}

func projectRelationshipProjectionResourceScopesForEvent(delta ProjectionDelta) []string {
	scopes := []string{}
	resourceType := strings.TrimSpace(delta.RowKey.ResourceType)
	resourceID := strings.TrimSpace(delta.RowKey.ResourceID)
	if resourceType == "" || resourceID == "" {
		if delta.Row != nil {
			resourceType = strings.TrimSpace(delta.Row.ResourceType)
			resourceID = strings.TrimSpace(delta.Row.ResourceID)
		}
	}
	if (resourceType == EntityTypeNode || resourceType == EntityTypeLogicGate) && resourceID != "" {
		scopes = append(scopes, "resource:"+resourceType+":"+resourceID)
	}
	logicGateID := strings.TrimSpace(delta.RowKey.LogicGateID)
	if logicGateID == "" && delta.Row != nil {
		logicGateID = strings.TrimSpace(pointerStringValue(delta.Row.LogicGateID))
	}
	if logicGateID != "" {
		scopes = append(scopes, "resource:"+EntityTypeLogicGate+":"+logicGateID)
	}
	nodeID := strings.TrimSpace(delta.RowKey.NodeID)
	if nodeID == "" && delta.Row != nil {
		nodeID = strings.TrimSpace(delta.Row.NodeID)
	}
	if nodeID != "" {
		scopes = append(scopes, "resource:"+EntityTypeNode+":"+nodeID)
	}
	return scopes
}

func scopedEventIdempotencyKey(idempotencyKey, scope string) string {
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	scope = strings.TrimSpace(scope)
	if idempotencyKey == "" || scope == "" {
		return idempotencyKey
	}
	return idempotencyKey + ":" + scope
}
