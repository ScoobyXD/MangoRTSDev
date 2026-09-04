package store

import (
	"encoding/json"
	"math"
	"miraeopus/backend/internal/domain"
	"strings"
)

const (
	ProcessMapMaxValidationTiles = 512
	processMapMaxReplayEvents    = 2048
	processMapDamagePayloadKey   = "process_map_damage"
)

// A validation identifies a cached transport tile, never a stored map resource.
type ProcessMapTileValidation struct {
	Z                     int   `json:"z"`
	X                     int   `json:"x"`
	Y                     int   `json:"y"`
	ProcessMapReadVersion int64 `json:"process_map_read_version"`
}

type ProcessMapChangesQuery struct {
	CompanyID        string
	PermissionUserID string
	SinceVersion     int64
	Tiles            []ProcessMapTileValidation
}

type ProcessMapChanges struct {
	domain.ProcessMapScene
	ValidatedTiles           []ProcessMapTileValidation `json:"validated_tiles"`
	ProtectedGeometryChanged bool                       `json:"protected_geometry_changed"`
}

// Damage is private event metadata used only to certify cached tile reuse.
// It never leaves the server or becomes placement/relationship authority.
type processMapDamage struct {
	Resources   []domain.ProcessMapResourceRef `json:"resources"`
	Bounds      []domain.ProcessMapBounds      `json:"bounds"`
	resourceSet map[domain.ProcessMapResourceRef]bool
}

func newProcessMapDamage() processMapDamage {
	return processMapDamage{Resources: []domain.ProcessMapResourceRef{}, Bounds: []domain.ProcessMapBounds{}}
}

func (damage *processMapDamage) addResource(ref domain.ProcessMapResourceRef) {
	if damage.resourceSet == nil {
		damage.resourceSet = make(map[domain.ProcessMapResourceRef]bool, len(damage.Resources)+1)
		for _, existing := range damage.Resources {
			damage.resourceSet[existing] = true
		}
	}
	if damage.resourceSet[ref] {
		return
	}
	damage.resourceSet[ref] = true
	damage.Resources = append(damage.Resources, ref)
}

func (damage *processMapDamage) addPlacement(placement domain.ProcessMapPlacement) {
	damage.addResource(domain.ProcessMapResourceRef{ResourceType: placement.ResourceType, ResourceID: placement.ResourceID})
	damage.Bounds = append(damage.Bounds, processMapPlacementBounds(placement))
}

func (damage *processMapDamage) addTrace(relationship domain.ResourceOperationalRelationship, source, target domain.ProcessMapPlacement, trace domain.ProcessMapTrace) {
	damage.addResource(relationship.Source)
	damage.addResource(relationship.Target)
	path := processMapTracePath(source, target, trace.RoutePoints)
	if len(path) == 0 {
		return
	}
	minX, maxX, minY, maxY := path[0].X, path[0].X, path[0].Y, path[0].Y
	for _, point := range path[1:] {
		minX, maxX = min(minX, point.X), max(maxX, point.X)
		minY, maxY = min(minY, point.Y), max(maxY, point.Y)
	}
	damage.Bounds = append(damage.Bounds, domain.ProcessMapBounds{MinX: int(math.Floor(minX)), MinY: int(math.Floor(minY)), MaxX: int(math.Ceil(maxX)), MaxY: int(math.Ceil(maxY))})
}

func attachProcessMapDamage(inputs []DomainEventInput, before, after processMapDamage) {
	for _, ref := range after.Resources {
		before.addResource(ref)
	}
	before.Bounds = append(before.Bounds, after.Bounds...)
	for index := range inputs {
		inputs[index].Payload[processMapDamagePayloadKey] = before
	}
}

func processMapEventDamage(event domain.DomainEvent) (processMapDamage, bool) {
	value, exists := event.Payload[processMapDamagePayloadKey]
	if !exists {
		return processMapDamage{}, false
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return processMapDamage{}, false
	}
	var damage processMapDamage
	if json.Unmarshal(encoded, &damage) != nil || damage.Resources == nil || damage.Bounds == nil {
		return processMapDamage{}, false
	}
	if len(damage.Bounds) > 0 && len(damage.Resources) == 0 {
		return processMapDamage{}, false
	}
	for _, ref := range damage.Resources {
		resourceType, valid := normalizeProcessMapResourceType(ref.ResourceType)
		if !valid || resourceType != ref.ResourceType || strings.TrimSpace(ref.ResourceID) == "" {
			return processMapDamage{}, false
		}
	}
	for _, bounds := range damage.Bounds {
		if bounds.MinX > bounds.MaxX || bounds.MinY > bounds.MaxY {
			return processMapDamage{}, false
		}
	}
	return damage, true
}

func processMapPresentationEventResource(event domain.DomainEvent) (domain.ProcessMapResourceRef, bool) {
	switch event.Type {
	case "logic_gate_updated", LogicGateRACIUpdatedEventType, QDRatingRealtimeEventType:
		id := workspaceEventPayloadString(event.Payload, "logic_gate_id")
		return domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: id}, id != ""
	default:
		return domain.ProcessMapResourceRef{}, false
	}
}

func validateProcessMapChangesQuery(query ProcessMapChangesQuery, currentVersion int64) (int64, error) {
	if query.SinceVersion < 0 || query.SinceVersion > currentVersion || len(query.Tiles) > ProcessMapMaxValidationTiles {
		return 0, ErrInvalid
	}
	minimumVersion := query.SinceVersion
	seen := map[[3]int]bool{}
	for _, tile := range query.Tiles {
		if _, valid := processMapTileBounds(tile.Z, tile.X, tile.Y); !valid || tile.ProcessMapReadVersion < 0 || tile.ProcessMapReadVersion > currentVersion {
			return 0, ErrInvalid
		}
		key := [3]int{tile.Z, tile.X, tile.Y}
		if seen[key] {
			return 0, ErrInvalid
		}
		seen[key] = true
		minimumVersion = min(minimumVersion, tile.ProcessMapReadVersion)
	}
	return minimumVersion, nil
}

// Replay every workspace sequence so a lost event or a newer tile cannot hide
// an intervening protected change. Ordinary broad changes invalidate only
// older tiles; protected changes invalidate the complete viewer scope.
func validateProcessMapCachedTiles(query ProcessMapChangesQuery, scene domain.ProcessMapScene, events []domain.DomainEvent, minimumVersion int64, damageForEvent func(domain.DomainEvent) (processMapDamage, bool, error)) (ProcessMapChanges, error) {
	result := ProcessMapChanges{ProcessMapScene: scene, ValidatedTiles: []ProcessMapTileValidation{}}
	last := minimumVersion
	dirty := make([]bool, len(query.Tiles))
	for _, event := range events {
		if event.Sequence != last+1 {
			result.ProtectedGeometryChanged = true
			return result, nil
		}
		last = event.Sequence
		if !isProcessMapChangedDomainEvent(event) && !(event.Type == "resource_gvic_policy_updated" && workspaceEventPayloadString(event.Payload, "resource_type") == domain.ProcessMapResourceTypeFolder) {
			continue
		}
		if processMapChangedProtectedGeometryChangedByCompany([]domain.DomainEvent{event})[query.CompanyID] {
			result.ProtectedGeometryChanged = true
			return result, nil
		}
		damage, selective, err := damageForEvent(event)
		if err != nil {
			return ProcessMapChanges{}, err
		}
		for index, tile := range query.Tiles {
			if dirty[index] || event.Sequence <= tile.ProcessMapReadVersion {
				continue
			}
			if !selective {
				dirty[index] = true
				continue
			}
			tileBounds, _ := processMapTileBounds(tile.Z, tile.X, tile.Y)
			for _, bounds := range damage.Bounds {
				// Include a zero-width/height trace and boundary-touching fragments.
				if bounds.MinX <= tileBounds.MaxX && bounds.MaxX >= tileBounds.MinX && bounds.MinY <= tileBounds.MaxY && bounds.MaxY >= tileBounds.MinY {
					dirty[index] = true
					break
				}
			}
		}
	}
	if last != scene.ProcessMapReadVersion {
		result.ProtectedGeometryChanged = true
		return result, nil
	}
	for index, tile := range query.Tiles {
		if !dirty[index] {
			result.ValidatedTiles = append(result.ValidatedTiles, tile)
		}
	}
	return result, nil
}
