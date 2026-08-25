package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const ProcessMapMaxRoutePoints = 256

const processMapMaxLayerAncestors = 256

const (
	processMapMinCoordinate = -2147483648
	processMapMaxCoordinate = 2147483647
)

const (
	ProcessMapPlacementSavedEvent               = "process_map_placement_saved"
	ProcessMapPlacementDeletedEvent             = "process_map_placement_deleted"
	ResourceOperationalRelationshipCreatedEvent = "resource_operational_relationship_created"
	ResourceOperationalRelationshipDeletedEvent = "resource_operational_relationship_deleted"
	ProcessMapTraceSavedEvent                   = "process_map_trace_saved"
)

const processMapRealtimeOriginConnectionIDPayloadKey = "realtime_origin_connection_id"

type ProcessMapLayerQuery struct {
	CompanyID        string
	FolderID         string
	PermissionUserID string
}

type ResourceOperationalRelationshipQuery struct {
	CompanyID        string
	ResourceType     string
	ResourceID       string
	Direction        string
	PermissionUserID string
}

type ProcessMapPlacementPutInput struct {
	CompanyID            string
	ResourceType         string
	ResourceID           string
	MapParentFolderID    *string
	GridX                int
	GridY                int
	ActorUserID          string
	PermissionUserID     string
	RealtimeConnectionID string
}

type ProcessMapPlacementMutationResult struct {
	Placement domain.ProcessMapPlacement `json:"placement"`
	Created   bool                       `json:"created"`
	Events    []domain.DomainEvent       `json:"-"`
}

type ProcessMapPlacementDeleteInput struct {
	CompanyID            string
	ResourceType         string
	ResourceID           string
	ActorUserID          string
	PermissionUserID     string
	RealtimeConnectionID string
}

type ProcessMapPlacementDeleteResult struct {
	Events []domain.DomainEvent `json:"-"`
}

type ResourceOperationalRelationshipCreateInput struct {
	CompanyID            string
	Source               domain.ProcessMapResourceRef
	Target               domain.ProcessMapResourceRef
	Trace                *ProcessMapTraceInput
	ActorUserID          string
	PermissionUserID     string
	RealtimeConnectionID string
}

type ProcessMapTraceInput struct {
	RoutePoints []domain.ProcessMapRoutePoint
}

type ResourceOperationalRelationshipMutationResult struct {
	Relationship        domain.ResourceOperationalRelationship `json:"relationship"`
	Trace               *domain.ProcessMapTrace                `json:"trace,omitempty"`
	RelationshipCreated bool                                   `json:"relationship_created"`
	TraceChanged        bool                                   `json:"trace_changed"`
	Events              []domain.DomainEvent                   `json:"-"`
}

type ProcessMapTracePutInput struct {
	CompanyID                         string
	ResourceOperationalRelationshipID string
	RoutePoints                       []domain.ProcessMapRoutePoint
	ActorUserID                       string
	PermissionUserID                  string
	RealtimeConnectionID              string
}

type ProcessMapTraceMutationResult struct {
	Trace   domain.ProcessMapTrace `json:"trace"`
	Changed bool                   `json:"changed"`
	Events  []domain.DomainEvent   `json:"-"`
}

type ResourceOperationalRelationshipDeleteInput struct {
	CompanyID                         string
	ResourceOperationalRelationshipID string
	ActorUserID                       string
	PermissionUserID                  string
	RealtimeConnectionID              string
}

type ResourceOperationalRelationshipDeleteResult struct {
	Events []domain.DomainEvent `json:"-"`
}

func normalizeProcessMapResourceType(value string) (string, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case domain.ProcessMapResourceTypeFolder, domain.ProcessMapResourceTypeProcess:
		return value, true
	default:
		return "", false
	}
}

func normalizeProcessMapDirection(value string) (string, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "both", true
	}
	switch value {
	case "incoming", "outgoing", "both":
		return value, true
	default:
		return "", false
	}
}

func validProcessMapRoutePoints(points []domain.ProcessMapRoutePoint) bool {
	if points == nil || len(points) > ProcessMapMaxRoutePoints {
		return false
	}
	for _, point := range points {
		if !validProcessMapCoordinate(point.X) || !validProcessMapCoordinate(point.Y) {
			return false
		}
	}
	return true
}

func validProcessMapCoordinate(value int) bool {
	return int64(value) >= processMapMinCoordinate && int64(value) <= processMapMaxCoordinate
}

func processMapEventInput(companyID, actorUserID, eventType string, payload map[string]any) DomainEventInput {
	return DomainEventInput{
		CompanyID:   companyID,
		StreamType:  workspaceDomainStreamType,
		StreamID:    companyID,
		Type:        eventType,
		ActorUserID: actorUserID,
		Payload:     payload,
	}
}

func processMapMutationEventInput(companyID, actorUserID, realtimeConnectionID, eventType string, payload map[string]any) DomainEventInput {
	if realtimeConnectionID = strings.TrimSpace(realtimeConnectionID); realtimeConnectionID != "" {
		payload[processMapRealtimeOriginConnectionIDPayloadKey] = realtimeConnectionID
	}
	return processMapEventInput(companyID, actorUserID, eventType, payload)
}

func processMapResourceEventPayload(resourceType, resourceID string) map[string]any {
	return map[string]any{"resource_type": resourceType, "resource_id": resourceID}
}
