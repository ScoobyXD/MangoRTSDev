package store

import (
	"context"
	"math"
	"miraeopus/backend/internal/domain"
	"strings"
)

const (
	ProcessMapMaxRoutePoints   = 256
	ProcessMapTileSize         = 256
	ProcessMapMinTileZoom      = 0
	ProcessMapMaxTileZoom      = 22
	ProcessMapRestrictedWidth  = 4
	ProcessMapRestrictedHeight = 3
	ProcessMapDefaultWidth     = 7
	ProcessMapDefaultHeight    = 5
	ProcessMapNormalLODMinPX   = 24
	ProcessMapEditingLODMinPX  = 96
	ProcessMapMaxCameraZoom    = 20
	ProcessMapMinCoordinate    = -1_000_000_000
	ProcessMapMaxCoordinate    = 1_000_000_000
	ProcessMapMaxDimension     = 1_000_000
)

const (
	ProcessMapPlacementSavedEvent               = "process_map_placement_saved"
	ProcessMapPlacementDeletedEvent             = "process_map_placement_deleted"
	ResourceOperationalRelationshipCreatedEvent = "resource_operational_relationship_created"
	ResourceOperationalRelationshipDeletedEvent = "resource_operational_relationship_deleted"
	ProcessMapTraceSavedEvent                   = "process_map_trace_saved"
)

const processMapRealtimeOriginConnectionIDPayloadKey = "realtime_origin_connection_id"

type ProcessMapSceneQuery struct {
	CompanyID        string
	PermissionUserID string
}

type ProcessMapTileQuery struct {
	CompanyID        string
	PermissionUserID string
	Z                int
	X                int
	Y                int
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
	GridWidth            int
	GridHeight           int
	ActorUserID          string
	PermissionUserID     string
	RealtimeConnectionID string
}

type ProcessMapPlacementDeleteInput struct {
	CompanyID            string
	ResourceType         string
	ResourceID           string
	ActorUserID          string
	PermissionUserID     string
	RealtimeConnectionID string
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

type ProcessMapTracePutInput struct {
	CompanyID                         string
	ResourceOperationalRelationshipID string
	RoutePoints                       []domain.ProcessMapRoutePoint
	ActorUserID                       string
	PermissionUserID                  string
	RealtimeConnectionID              string
}

type ResourceOperationalRelationshipDeleteInput struct {
	CompanyID                         string
	ResourceOperationalRelationshipID string
	ActorUserID                       string
	PermissionUserID                  string
	RealtimeConnectionID              string
}

type ProcessMapMutationEnvelope struct {
	Placements            []domain.ProcessMapPlacement            `json:"placements"`
	Traces                []domain.ProcessMapTrace                `json:"traces"`
	DeletedTraceIDs       []string                                `json:"deleted_trace_ids"`
	ProcessMapReadVersion int64                                   `json:"process_map_read_version"`
	Relationship          *domain.ResourceOperationalRelationship `json:"relationship,omitempty"`
	Created               bool                                    `json:"created,omitempty"`
	Changed               bool                                    `json:"changed,omitempty"`
	Events                []domain.DomainEvent                    `json:"-"`
}

func emptyProcessMapMutationEnvelope() ProcessMapMutationEnvelope {
	return ProcessMapMutationEnvelope{
		Placements:      []domain.ProcessMapPlacement{},
		Traces:          []domain.ProcessMapTrace{},
		DeletedTraceIDs: []string{},
	}
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
	return value >= ProcessMapMinCoordinate && value <= ProcessMapMaxCoordinate
}

func validProcessMapDimension(value int) bool {
	return value > 0 && value <= ProcessMapMaxDimension
}

func validProcessMapGeometry(x, y, width, height int) bool {
	if !validProcessMapCoordinate(x) || !validProcessMapCoordinate(y) ||
		!validProcessMapDimension(width) || !validProcessMapDimension(height) {
		return false
	}
	maxX := int64(x) + int64(width)
	maxY := int64(y) + int64(height)
	return maxX <= ProcessMapMaxCoordinate && maxY <= ProcessMapMaxCoordinate
}

func processMapTileBounds(z, x, y int) (domain.ProcessMapBounds, bool) {
	if z < ProcessMapMinTileZoom || z > ProcessMapMaxTileZoom {
		return domain.ProcessMapBounds{}, false
	}
	span := int64(ProcessMapTileSize) << uint(ProcessMapMaxTileZoom-z)
	tileX, tileY := int64(x), int64(y)
	minTileIndex := int64(math.MinInt32) / span
	maxTileIndex := (int64(math.MaxInt32) - span) / span
	if tileX < minTileIndex || tileX > maxTileIndex || tileY < minTileIndex || tileY > maxTileIndex {
		return domain.ProcessMapBounds{}, false
	}
	minX := tileX * span
	minY := tileY * span
	maxX := minX + span
	maxY := minY + span
	if minX < math.MinInt32 || minY < math.MinInt32 || maxX > math.MaxInt32 || maxY > math.MaxInt32 {
		return domain.ProcessMapBounds{}, false
	}
	return domain.ProcessMapBounds{MinX: int(minX), MinY: int(minY), MaxX: int(maxX), MaxY: int(maxY)}, true
}

func processMapPlacementPresentationAtTileZoom(width, height, z int) domain.ProcessMapPresentation {
	upperCameraZoom := z - ProcessMapMaxTileZoom
	if z == ProcessMapMaxTileZoom {
		// The highest spatial tile remains selected while the camera continues
		// through editing zoom, so its payload must cover that clamped interval.
		upperCameraZoom = ProcessMapMaxCameraZoom
	}
	projectedShortestSide := math.Ldexp(float64(min(width, height)), upperCameraZoom)
	switch {
	case projectedShortestSide >= ProcessMapEditingLODMinPX:
		return domain.ProcessMapPresentationEditing
	case projectedShortestSide >= ProcessMapNormalLODMinPX:
		return domain.ProcessMapPresentationNormal
	default:
		return domain.ProcessMapPresentationWhole
	}
}

func processMapMaxPresentation(left, right domain.ProcessMapPresentation) domain.ProcessMapPresentation {
	if left == domain.ProcessMapPresentationEditing || right == domain.ProcessMapPresentationEditing {
		return domain.ProcessMapPresentationEditing
	}
	if left == domain.ProcessMapPresentationNormal || right == domain.ProcessMapPresentationNormal {
		return domain.ProcessMapPresentationNormal
	}
	return domain.ProcessMapPresentationWhole
}

func processMapBoundsIntersect(a, b domain.ProcessMapBounds) bool {
	return a.MinX < b.MaxX && a.MaxX > b.MinX && a.MinY < b.MaxY && a.MaxY > b.MinY
}

func processMapPlacementBounds(item domain.ProcessMapPlacement) domain.ProcessMapBounds {
	return domain.ProcessMapBounds{MinX: item.GridX, MinY: item.GridY, MaxX: item.GridX + item.GridWidth, MaxY: item.GridY + item.GridHeight}
}

func processMapBoundsContain(outer, inner domain.ProcessMapBounds) bool {
	return inner.MinX >= outer.MinX && inner.MinY >= outer.MinY && inner.MaxX <= outer.MaxX && inner.MaxY <= outer.MaxY
}

func processMapTracePath(source, target domain.ProcessMapPlacement, route []domain.ProcessMapRoutePoint) []domain.ProcessMapPathPoint {
	requested := make([]domain.ProcessMapPathPoint, 0, len(route)+2)
	requested = append(requested, domain.ProcessMapPathPoint{X: float64(source.GridX + source.GridWidth), Y: float64(source.GridY) + float64(source.GridHeight)/2})
	for _, point := range route {
		requested = append(requested, domain.ProcessMapPathPoint{X: float64(point.X), Y: float64(point.Y)})
	}
	requested = append(requested, domain.ProcessMapPathPoint{X: float64(target.GridX), Y: float64(target.GridY) + float64(target.GridHeight)/2})

	// Route points remain the canonical editable waypoints. The tile presentation
	// path inserts deterministic bends only between those points, so every visible
	// segment is orthogonal without expanding the path's candidate bounds.
	path := make([]domain.ProcessMapPathPoint, 0, len(requested)*2)
	for index, point := range requested {
		if len(path) > 0 {
			previous := path[len(path)-1]
			if previous.X != point.X && previous.Y != point.Y {
				bend := domain.ProcessMapPathPoint{X: point.X, Y: previous.Y}
				if index == len(requested)-1 {
					bend = domain.ProcessMapPathPoint{X: previous.X, Y: point.Y}
				}
				path = processMapAppendSimplifiedPathPoint(path, bend)
			}
		}
		path = processMapAppendSimplifiedPathPoint(path, point)
	}
	return path
}

func processMapAppendSimplifiedPathPoint(path []domain.ProcessMapPathPoint, point domain.ProcessMapPathPoint) []domain.ProcessMapPathPoint {
	if len(path) == 0 || !processMapPathPointEqual(path[len(path)-1], point) {
		path = append(path, point)
	}
	for len(path) >= 3 {
		end := len(path) - 1
		before, middle, after := path[end-2], path[end-1], path[end]
		if !((before.X == middle.X && middle.X == after.X) || (before.Y == middle.Y && middle.Y == after.Y)) {
			break
		}
		path = append(path[:end-1], path[end:]...)
		if len(path) >= 2 && processMapPathPointEqual(path[len(path)-2], path[len(path)-1]) {
			path = path[:len(path)-1]
		}
	}
	return path
}

func processMapClipPath(path []domain.ProcessMapPathPoint, bounds domain.ProcessMapBounds) [][]domain.ProcessMapPathPoint {
	if len(path) < 2 {
		return [][]domain.ProcessMapPathPoint{}
	}
	fragments := make([][]domain.ProcessMapPathPoint, 0)
	current := make([]domain.ProcessMapPathPoint, 0)
	flush := func() {
		if len(current) >= 2 {
			fragments = append(fragments, current)
		}
		current = nil
	}
	for index := 0; index+1 < len(path); index++ {
		start, end, ok := processMapClipSegment(path[index], path[index+1], bounds)
		if !ok {
			flush()
			continue
		}
		if len(current) == 0 {
			current = append(current, start, end)
			continue
		}
		last := current[len(current)-1]
		if processMapPathPointEqual(last, start) {
			if !processMapPathPointEqual(last, end) {
				current = append(current, end)
			}
			continue
		}
		flush()
		current = append(current, start, end)
	}
	flush()
	return fragments
}

func processMapPathPointEqual(a, b domain.ProcessMapPathPoint) bool {
	return math.Abs(a.X-b.X) < 1e-9 && math.Abs(a.Y-b.Y) < 1e-9
}

func processMapClipSegment(a, b domain.ProcessMapPathPoint, bounds domain.ProcessMapBounds) (domain.ProcessMapPathPoint, domain.ProcessMapPathPoint, bool) {
	dx := b.X - a.X
	dy := b.Y - a.Y
	t0, t1 := 0.0, 1.0
	// Tile ownership is half-open on MaxX/MaxY. A feature exactly on a shared
	// border therefore belongs only to the adjacent tile whose minimum owns it.
	maxX := math.Nextafter(float64(bounds.MaxX), math.Inf(-1))
	maxY := math.Nextafter(float64(bounds.MaxY), math.Inf(-1))
	checks := [][2]float64{
		{-dx, a.X - float64(bounds.MinX)},
		{dx, maxX - a.X},
		{-dy, a.Y - float64(bounds.MinY)},
		{dy, maxY - a.Y},
	}
	for _, check := range checks {
		p, q := check[0], check[1]
		if p == 0 {
			if q < 0 {
				return domain.ProcessMapPathPoint{}, domain.ProcessMapPathPoint{}, false
			}
			continue
		}
		ratio := q / p
		if p < 0 {
			if ratio > t1 {
				return domain.ProcessMapPathPoint{}, domain.ProcessMapPathPoint{}, false
			}
			if ratio > t0 {
				t0 = ratio
			}
		} else {
			if ratio < t0 {
				return domain.ProcessMapPathPoint{}, domain.ProcessMapPathPoint{}, false
			}
			if ratio < t1 {
				t1 = ratio
			}
		}
	}
	return domain.ProcessMapPathPoint{X: a.X + t0*dx, Y: a.Y + t0*dy}, domain.ProcessMapPathPoint{X: a.X + t1*dx, Y: a.Y + t1*dy}, true
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

func processMapRelationshipEventPayload(relationship domain.ResourceOperationalRelationship) map[string]any {
	return map[string]any{
		"resource_operational_relationship_id": relationship.ResourceOperationalRelationshipID,
		"source_resource_type":                 relationship.Source.ResourceType,
		"source_resource_id":                   relationship.Source.ResourceID,
		"target_resource_type":                 relationship.Target.ResourceType,
		"target_resource_id":                   relationship.Target.ResourceID,
	}
}

type ProcessMapRepository interface {
	CurrentProcessMapVersions(ctx context.Context, companyID string) (int64, int64, error)
	GetProcessMapScene(ctx context.Context, input ProcessMapSceneQuery) (domain.ProcessMapScene, error)
	GetProcessMapTile(ctx context.Context, input ProcessMapTileQuery) (domain.ProcessMapTile, error)
	ListResourceOperationalRelationshipsForResource(ctx context.Context, input ResourceOperationalRelationshipQuery) ([]domain.ResourceOperationalRelationship, error)
	PutProcessMapPlacement(ctx context.Context, input ProcessMapPlacementPutInput) (ProcessMapMutationEnvelope, error)
	DeleteProcessMapPlacement(ctx context.Context, input ProcessMapPlacementDeleteInput) (ProcessMapMutationEnvelope, error)
	CreateResourceOperationalRelationship(ctx context.Context, input ResourceOperationalRelationshipCreateInput) (ProcessMapMutationEnvelope, error)
	PutProcessMapTrace(ctx context.Context, input ProcessMapTracePutInput) (ProcessMapMutationEnvelope, error)
	DeleteResourceOperationalRelationship(ctx context.Context, input ResourceOperationalRelationshipDeleteInput) (ProcessMapMutationEnvelope, error)
}
