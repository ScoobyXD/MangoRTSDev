package store

import (
	"context"
	"math"
	"miraeopus/backend/internal/domain"
	"sort"
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
	processMapAutomaticRootFolderWidth    = 32
	processMapAutomaticRootFolderHeight   = 24
	processMapAutomaticNestedFolderWidth  = 24
	processMapAutomaticNestedFolderHeight = 16
	processMapAutomaticProcessWidth       = 14
	processMapAutomaticProcessHeight      = 8
	processMapAutomaticRootGap            = 8
	processMapAutomaticChildGap           = 2
	processMapAutomaticFolderPadding      = 2
	processMapAutomaticFolderHeaderHeight = 6
	processMapAutomaticSectionGap         = 4
	processMapAutomaticCandidateLimit     = 256
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

func processMapScaleCoordinate(value, sourceOrigin, sourceSize, targetOrigin, targetSize int) int {
	// Math.floor(value + 0.5) matches JavaScript Math.round, including negative
	// half values, so the server commits the exact geometry shown by the client.
	scaled := float64(targetOrigin) + float64(value-sourceOrigin)*float64(targetSize)/float64(sourceSize)
	return int(math.Floor(scaled + 0.5))
}

func processMapScalePlacementWithinFolder(item, sourceFolder, targetFolder domain.ProcessMapPlacement) domain.ProcessMapPlacement {
	minX := processMapScaleCoordinate(item.GridX, sourceFolder.GridX, sourceFolder.GridWidth, targetFolder.GridX, targetFolder.GridWidth)
	minY := processMapScaleCoordinate(item.GridY, sourceFolder.GridY, sourceFolder.GridHeight, targetFolder.GridY, targetFolder.GridHeight)
	maxX := processMapScaleCoordinate(item.GridX+item.GridWidth, sourceFolder.GridX, sourceFolder.GridWidth, targetFolder.GridX, targetFolder.GridWidth)
	maxY := processMapScaleCoordinate(item.GridY+item.GridHeight, sourceFolder.GridY, sourceFolder.GridHeight, targetFolder.GridY, targetFolder.GridHeight)
	item.GridX, item.GridY = minX, minY
	item.GridWidth, item.GridHeight = maxX-minX, maxY-minY
	return item
}

func processMapScaleRoutePointsWithinFolder(points []domain.ProcessMapRoutePoint, sourceFolder, targetFolder domain.ProcessMapPlacement) []domain.ProcessMapRoutePoint {
	result := make([]domain.ProcessMapRoutePoint, len(points))
	for index, point := range points {
		result[index] = domain.ProcessMapRoutePoint{
			X: processMapScaleCoordinate(point.X, sourceFolder.GridX, sourceFolder.GridWidth, targetFolder.GridX, targetFolder.GridWidth),
			Y: processMapScaleCoordinate(point.Y, sourceFolder.GridY, sourceFolder.GridHeight, targetFolder.GridY, targetFolder.GridHeight),
		}
	}
	return result
}

func processMapPlacementsConflictWithGap(left, right domain.ProcessMapPlacement, gap int) bool {
	return int64(left.GridX) < int64(right.GridX)+int64(right.GridWidth)+int64(gap) &&
		int64(left.GridX)+int64(left.GridWidth)+int64(gap) > int64(right.GridX) &&
		int64(left.GridY) < int64(right.GridY)+int64(right.GridHeight)+int64(gap) &&
		int64(left.GridY)+int64(left.GridHeight)+int64(gap) > int64(right.GridY)
}

func compareProcessMapPlacements(a, b domain.ProcessMapPlacement) int {
	if a.GridY != b.GridY {
		if a.GridY < b.GridY {
			return -1
		}
		return 1
	}
	if a.GridX != b.GridX {
		if a.GridX < b.GridX {
			return -1
		}
		return 1
	}
	if byType := strings.Compare(a.ResourceType, b.ResourceType); byType != 0 {
		return byType
	}
	return strings.Compare(a.ResourceID, b.ResourceID)
}

type processMapPositionCandidate struct {
	x int
	y int
}

// processMapSquareBiasedCandidates keeps candidate growth linear in the number
// of existing rectangles. The right and lower edges preserve actual sizes,
// while the two append candidates guarantee a non-overlapping frontier when a
// valid coordinate remains.
func processMapSquareBiasedCandidates(
	placements []domain.ProcessMapPlacement,
	startX, startY, gap, width, height int,
) []processMapPositionCandidate {
	seen := map[processMapPositionCandidate]bool{}
	candidates := make([]processMapPositionCandidate, 0, len(placements)*4+3)
	add := func(x, y int) {
		candidate := processMapPositionCandidate{x: x, y: y}
		if x < startX || y < startY || seen[candidate] || !validProcessMapGeometry(x, y, width, height) {
			return
		}
		seen[candidate] = true
		candidates = append(candidates, candidate)
	}

	add(startX, startY)
	maxRight, maxBottom := startX, startY
	for _, placement := range placements {
		right := placement.GridX + placement.GridWidth + gap
		bottom := placement.GridY + placement.GridHeight + gap
		maxRight = max(maxRight, right)
		maxBottom = max(maxBottom, bottom)
		add(right, placement.GridY)
		add(placement.GridX, bottom)
		add(right, startY)
		add(startX, bottom)
	}
	add(maxRight, startY)
	add(startX, maxBottom)

	minX, minY := int64(startX), int64(startY)
	maxX, maxY := int64(startX), int64(startY)
	for _, placement := range placements {
		minX = min(minX, int64(placement.GridX))
		minY = min(minY, int64(placement.GridY))
		maxX = max(maxX, int64(placement.GridX)+int64(placement.GridWidth))
		maxY = max(maxY, int64(placement.GridY)+int64(placement.GridHeight))
	}
	score := func(point processMapPositionCandidate) (int64, int64, int64) {
		candidateMaxX := max(maxX, int64(point.x)+int64(width))
		candidateMaxY := max(maxY, int64(point.y)+int64(height))
		footprintWidth, footprintHeight := candidateMaxX-minX, candidateMaxY-minY
		imbalance := footprintWidth - footprintHeight
		if imbalance < 0 {
			imbalance = -imbalance
		}
		return max(footprintWidth, footprintHeight), imbalance, footprintWidth * footprintHeight
	}
	sort.Slice(candidates, func(i, j int) bool {
		iSide, iImbalance, iArea := score(candidates[i])
		jSide, jImbalance, jArea := score(candidates[j])
		if iSide != jSide {
			return iSide < jSide
		}
		if iImbalance != jImbalance {
			return iImbalance < jImbalance
		}
		if iArea != jArea {
			return iArea < jArea
		}
		if candidates[i].y != candidates[j].y {
			return candidates[i].y < candidates[j].y
		}
		return candidates[i].x < candidates[j].x
	})
	if len(candidates) <= processMapAutomaticCandidateLimit {
		return candidates
	}

	// Keep the best square-biased frontier bounded, while reserving the two
	// append positions that always clear every existing rectangle on one axis.
	bounded := append([]processMapPositionCandidate{}, candidates[:processMapAutomaticCandidateLimit-2]...)
	boundedSet := make(map[processMapPositionCandidate]bool, len(bounded)+2)
	for _, candidate := range bounded {
		boundedSet[candidate] = true
	}
	for _, candidate := range []processMapPositionCandidate{{x: maxRight, y: startY}, {x: startX, y: maxBottom}} {
		if validProcessMapGeometry(candidate.x, candidate.y, width, height) && !boundedSet[candidate] {
			bounded = append(bounded, candidate)
			boundedSet[candidate] = true
		}
	}
	if len(bounded) > processMapAutomaticCandidateLimit {
		bounded = bounded[:processMapAutomaticCandidateLimit]
	}
	return bounded
}

// processMapSquareBiasedPosition finds the smallest practical square footprint
// for one new or displaced rectangle without rewriting separated geometry. It
// evaluates only the bounded actual-size frontier instead of an exhaustive
// cross-product of every X and Y edge.
func processMapSquareBiasedPosition(
	placements []domain.ProcessMapPlacement,
	startX, startY, gap, width, height int,
) (int, int, bool) {
	minX, minY := int64(startX), int64(startY)
	maxX, maxY := int64(startX), int64(startY)
	for _, placement := range placements {
		minX = min(minX, int64(placement.GridX))
		minY = min(minY, int64(placement.GridY))
		maxX = max(maxX, int64(placement.GridX)+int64(placement.GridWidth))
		maxY = max(maxY, int64(placement.GridY)+int64(placement.GridHeight))
	}

	bestX, bestY := 0, 0
	bestSide, bestImbalance, bestArea := int64(math.MaxInt64), int64(math.MaxInt64), int64(math.MaxInt64)
	found := false
	for _, point := range processMapSquareBiasedCandidates(placements, startX, startY, gap, width, height) {
		candidate := domain.ProcessMapPlacement{GridX: point.x, GridY: point.y, GridWidth: width, GridHeight: height}
		blocked := false
		for _, obstacle := range placements {
			if processMapPlacementsConflictWithGap(candidate, obstacle, gap) {
				blocked = true
				break
			}
		}
		if blocked {
			continue
		}

		candidateMaxX := max(maxX, int64(point.x)+int64(width))
		candidateMaxY := max(maxY, int64(point.y)+int64(height))
		footprintWidth, footprintHeight := candidateMaxX-minX, candidateMaxY-minY
		side := max(footprintWidth, footprintHeight)
		area := footprintWidth * footprintHeight
		imbalance := footprintWidth - footprintHeight
		if imbalance < 0 {
			imbalance = -imbalance
		}
		if !found || side < bestSide ||
			side == bestSide && imbalance < bestImbalance ||
			side == bestSide && imbalance == bestImbalance && area < bestArea ||
			side == bestSide && imbalance == bestImbalance && area == bestArea && (point.y < bestY || point.y == bestY && point.x < bestX) {
			bestX, bestY = point.x, point.y
			bestSide, bestImbalance, bestArea = side, imbalance, area
			found = true
		}
	}
	return bestX, bestY, found
}

type processMapAutomaticPlacementPlan struct {
	Placements              []domain.ProcessMapPlacement
	Created                 bool
	ReparentedFolderMembers []domain.ProcessMapResourceRef
	ReparentedFolderDeltaX  int
	ReparentedFolderDeltaY  int
}

func processMapAutomaticPlacementKey(resourceType, resourceID string) string {
	return resourceType + "\x00" + resourceID
}

func processMapAutomaticParentID(item domain.ProcessMapPlacement) string {
	if item.MapParentFolderID == nil {
		return ""
	}
	return strings.TrimSpace(*item.MapParentFolderID)
}

func processMapAutomaticClonePlacement(item domain.ProcessMapPlacement) domain.ProcessMapPlacement {
	if item.MapParentFolderID != nil {
		parentID := *item.MapParentFolderID
		item.MapParentFolderID = &parentID
	}
	return item
}

func processMapAutomaticGeometryEqual(left, right domain.ProcessMapPlacement) bool {
	return left.ResourceType == right.ResourceType && left.ResourceID == right.ResourceID &&
		processMapAutomaticParentID(left) == processMapAutomaticParentID(right) &&
		left.GridX == right.GridX && left.GridY == right.GridY &&
		left.GridWidth == right.GridWidth && left.GridHeight == right.GridHeight
}

func processMapAutomaticChildrenIndex(placements map[string]domain.ProcessMapPlacement) map[string][]string {
	children := map[string][]string{}
	for placementKey, placement := range placements {
		parentID := processMapAutomaticParentID(placement)
		children[parentID] = append(children[parentID], placementKey)
	}
	for parentID := range children {
		sort.Strings(children[parentID])
	}
	return children
}

func processMapAutomaticDescendantKeys(
	placements map[string]domain.ProcessMapPlacement,
	children map[string][]string,
	folderID string,
) ([]string, bool) {
	result := []string{}
	queue := []string{folderID}
	seenFolders := map[string]bool{folderID: true}
	for len(queue) > 0 {
		parentID := queue[0]
		queue = queue[1:]
		for _, childKey := range children[parentID] {
			child, ok := placements[childKey]
			if !ok {
				continue
			}
			result = append(result, childKey)
			if child.ResourceType != domain.ProcessMapResourceTypeFolder {
				continue
			}
			if seenFolders[child.ResourceID] {
				return nil, true
			}
			seenFolders[child.ResourceID] = true
			queue = append(queue, child.ResourceID)
		}
	}
	return result, false
}

func processMapAutomaticTranslateDescendants(
	placements map[string]domain.ProcessMapPlacement,
	children map[string][]string,
	folderID string,
	deltaX, deltaY int,
) error {
	if deltaX == 0 && deltaY == 0 {
		return nil
	}
	descendants, cycle := processMapAutomaticDescendantKeys(placements, children, folderID)
	if cycle {
		return ErrProcessMapCycle
	}
	for _, descendantKey := range descendants {
		descendant := placements[descendantKey]
		descendant.GridX += deltaX
		descendant.GridY += deltaY
		placements[descendantKey] = descendant
	}
	return nil
}

func processMapAutomaticPosition(
	placements map[string]domain.ProcessMapPlacement,
	children map[string][]string,
	targetKey, resourceType, parentID string,
	width, height int,
) (int, int, error) {
	if parentID == "" {
		folders := []domain.ProcessMapPlacement{}
		processes := []domain.ProcessMapPlacement{}
		for _, childKey := range children[""] {
			if childKey == targetKey {
				continue
			}
			root := placements[childKey]
			if root.ResourceType == domain.ProcessMapResourceTypeFolder {
				folders = append(folders, root)
			} else if root.ResourceType == domain.ProcessMapResourceTypeProcess {
				processes = append(processes, root)
			}
		}
		section := folders
		startX := 0
		if resourceType == domain.ProcessMapResourceTypeProcess {
			section = processes
			if len(folders) > 0 {
				folderRight := folders[0].GridX + folders[0].GridWidth
				for _, folder := range folders[1:] {
					folderRight = max(folderRight, folder.GridX+folder.GridWidth)
				}
				startX = folderRight + max(processMapAutomaticSectionGap, processMapAutomaticRootGap)
			}
			if len(processes) > 0 {
				minimumProcessX := processes[0].GridX
				for _, process := range processes[1:] {
					minimumProcessX = min(minimumProcessX, process.GridX)
				}
				startX = max(startX, minimumProcessX)
			}
		}
		x, y, ok := processMapSquareBiasedPosition(section, startX, 0, processMapAutomaticRootGap, width, height)
		if !ok {
			return 0, 0, ErrInvalid
		}
		return x, y, nil
	}

	parentKey := processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, parentID)
	parent, ok := placements[parentKey]
	if !ok {
		return 0, 0, ErrNotFound
	}
	folders := []domain.ProcessMapPlacement{}
	processes := []domain.ProcessMapPlacement{}
	for _, childKey := range children[parentID] {
		if childKey == targetKey {
			continue
		}
		child := placements[childKey]
		if child.ResourceType == domain.ProcessMapResourceTypeFolder {
			folders = append(folders, child)
		} else if child.ResourceType == domain.ProcessMapResourceTypeProcess {
			processes = append(processes, child)
		}
	}
	childStartX := parent.GridX + processMapAutomaticFolderPadding
	childStartY := parent.GridY + processMapAutomaticFolderHeaderHeight
	section := folders
	startX := childStartX
	if resourceType == domain.ProcessMapResourceTypeProcess {
		section = processes
		if len(folders) > 0 {
			folderRight := folders[0].GridX + folders[0].GridWidth
			for _, folder := range folders[1:] {
				folderRight = max(folderRight, folder.GridX+folder.GridWidth)
			}
			startX = max(childStartX, folderRight) + processMapAutomaticSectionGap
		}
		if len(processes) > 0 {
			minimumProcessX := processes[0].GridX
			for _, process := range processes[1:] {
				minimumProcessX = min(minimumProcessX, process.GridX)
			}
			startX = max(startX, minimumProcessX)
		}
	}
	x, y, ok := processMapSquareBiasedPosition(section, startX, childStartY, processMapAutomaticChildGap, width, height)
	if !ok {
		return 0, 0, ErrInvalid
	}
	return x, y, nil
}

func processMapAutomaticSetParentIndex(children map[string][]string, placementKey, oldParentID, newParentID string) {
	if oldParentID == newParentID {
		return
	}
	oldChildren := children[oldParentID]
	for index, childKey := range oldChildren {
		if childKey == placementKey {
			children[oldParentID] = append(oldChildren[:index], oldChildren[index+1:]...)
			break
		}
	}
	children[newParentID] = append(children[newParentID], placementKey)
	sort.Strings(children[newParentID])
}

func planAutomaticProcessMapPlacement(
	companyID, resourceType, resourceID, parentID string,
	input []domain.ProcessMapPlacement,
) (processMapAutomaticPlacementPlan, error) {
	plan := processMapAutomaticPlacementPlan{Placements: []domain.ProcessMapPlacement{}, ReparentedFolderMembers: []domain.ProcessMapResourceRef{}}
	placements := make(map[string]domain.ProcessMapPlacement, len(input)+1)
	original := make(map[string]domain.ProcessMapPlacement, len(input))
	for _, item := range input {
		if item.CompanyID != companyID {
			continue
		}
		item = processMapAutomaticClonePlacement(item)
		placementKey := processMapAutomaticPlacementKey(item.ResourceType, item.ResourceID)
		placements[placementKey] = item
		original[placementKey] = processMapAutomaticClonePlacement(item)
	}
	children := processMapAutomaticChildrenIndex(placements)
	targetKey := processMapAutomaticPlacementKey(resourceType, resourceID)
	current, exists := placements[targetKey]
	plan.Created = !exists
	if exists && processMapAutomaticParentID(current) == parentID {
		return plan, nil
	}
	if parentID != "" {
		if _, ok := placements[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, parentID)]; !ok {
			return processMapAutomaticPlacementPlan{}, ErrNotFound
		}
	}

	reparentedKeys := []string{}
	if exists && resourceType == domain.ProcessMapResourceTypeFolder {
		reparentedKeys = append(reparentedKeys, targetKey)
		descendants, cycle := processMapAutomaticDescendantKeys(placements, children, resourceID)
		if cycle {
			return processMapAutomaticPlacementPlan{}, ErrProcessMapCycle
		}
		for _, descendantKey := range descendants {
			descendant := placements[descendantKey]
			if descendant.ResourceType == domain.ProcessMapResourceTypeFolder && descendant.ResourceID == parentID {
				return processMapAutomaticPlacementPlan{}, ErrProcessMapCycle
			}
		}
		reparentedKeys = append(reparentedKeys, descendants...)
	}

	target := current
	if !exists {
		target = domain.ProcessMapPlacement{
			CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID,
			GridWidth: processMapAutomaticProcessWidth, GridHeight: processMapAutomaticProcessHeight,
		}
		if resourceType == domain.ProcessMapResourceTypeFolder {
			target.GridWidth = processMapAutomaticNestedFolderWidth
			target.GridHeight = processMapAutomaticNestedFolderHeight
			if parentID == "" {
				target.GridWidth = processMapAutomaticRootFolderWidth
				target.GridHeight = processMapAutomaticRootFolderHeight
			}
		}
	}
	if resourceType == domain.ProcessMapResourceTypeFolder && parentID == "" {
		target.GridWidth = max(target.GridWidth, processMapAutomaticRootFolderWidth)
		target.GridHeight = max(target.GridHeight, processMapAutomaticRootFolderHeight)
	}
	gridX, gridY, err := processMapAutomaticPosition(placements, children, targetKey, resourceType, parentID, target.GridWidth, target.GridHeight)
	if err != nil {
		return processMapAutomaticPlacementPlan{}, err
	}
	oldParentID := processMapAutomaticParentID(target)
	deltaX, deltaY := gridX-target.GridX, gridY-target.GridY
	if exists && resourceType == domain.ProcessMapResourceTypeFolder {
		if err := processMapAutomaticTranslateDescendants(placements, children, resourceID, deltaX, deltaY); err != nil {
			return processMapAutomaticPlacementPlan{}, err
		}
	}
	if parentID == "" {
		target.MapParentFolderID = nil
	} else {
		parentCopy := parentID
		target.MapParentFolderID = &parentCopy
	}
	target.GridX, target.GridY = gridX, gridY
	placements[targetKey] = target
	processMapAutomaticSetParentIndex(children, targetKey, oldParentID, parentID)

	childKey := targetKey
	ancestorID := parentID
	seenAncestors := map[string]bool{}
	for ancestorID != "" {
		if seenAncestors[ancestorID] {
			return processMapAutomaticPlacementPlan{}, ErrProcessMapCycle
		}
		seenAncestors[ancestorID] = true
		parentKey := processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, ancestorID)
		parent, ok := placements[parentKey]
		if !ok {
			return processMapAutomaticPlacementPlan{}, ErrNotFound
		}
		child := placements[childKey]
		conflicts := false
		for _, siblingKey := range children[ancestorID] {
			if siblingKey == childKey {
				continue
			}
			sibling := placements[siblingKey]
			if sibling.ResourceType == child.ResourceType {
				conflicts = conflicts || processMapPlacementsConflictWithGap(child, sibling, processMapAutomaticChildGap)
			}
		}
		if conflicts {
			nextX, nextY, err := processMapAutomaticPosition(placements, children, childKey, child.ResourceType, ancestorID, child.GridWidth, child.GridHeight)
			if err != nil {
				return processMapAutomaticPlacementPlan{}, err
			}
			moveX, moveY := nextX-child.GridX, nextY-child.GridY
			if child.ResourceType == domain.ProcessMapResourceTypeFolder {
				if err := processMapAutomaticTranslateDescendants(placements, children, child.ResourceID, moveX, moveY); err != nil {
					return processMapAutomaticPlacementPlan{}, err
				}
			}
			child.GridX, child.GridY = nextX, nextY
			placements[childKey] = child
		}

		folderRight, processLeft := 0, 0
		hasFolders, hasProcesses := false, false
		processKeys := []string{}
		for _, directChildKey := range children[ancestorID] {
			directChild := placements[directChildKey]
			if directChild.ResourceType == domain.ProcessMapResourceTypeFolder {
				right := directChild.GridX + directChild.GridWidth
				if !hasFolders || right > folderRight {
					folderRight = right
				}
				hasFolders = true
			} else if directChild.ResourceType == domain.ProcessMapResourceTypeProcess {
				processKeys = append(processKeys, directChildKey)
				if !hasProcesses || directChild.GridX < processLeft {
					processLeft = directChild.GridX
				}
				hasProcesses = true
			}
		}
		if hasFolders && hasProcesses && processLeft < folderRight+processMapAutomaticSectionGap {
			shiftX := folderRight + processMapAutomaticSectionGap - processLeft
			for _, processKey := range processKeys {
				process := placements[processKey]
				process.GridX += shiftX
				placements[processKey] = process
			}
		}

		requiredWidth, requiredHeight := parent.GridWidth, parent.GridHeight
		for _, directChildKey := range children[ancestorID] {
			directChild := placements[directChildKey]
			requiredWidth = max(requiredWidth, directChild.GridX+directChild.GridWidth-parent.GridX+processMapAutomaticFolderPadding)
			requiredHeight = max(requiredHeight, directChild.GridY+directChild.GridHeight-parent.GridY+processMapAutomaticFolderPadding)
		}
		if requiredWidth == parent.GridWidth && requiredHeight == parent.GridHeight {
			break
		}
		parent.GridWidth, parent.GridHeight = requiredWidth, requiredHeight
		placements[parentKey] = parent
		childKey = parentKey
		ancestorID = processMapAutomaticParentID(parent)
	}

	folderRootKeys := []string{}
	processRootKeys := []string{}
	for _, rootKey := range children[""] {
		if placements[rootKey].ResourceType == domain.ProcessMapResourceTypeFolder {
			folderRootKeys = append(folderRootKeys, rootKey)
		} else if placements[rootKey].ResourceType == domain.ProcessMapResourceTypeProcess {
			processRootKeys = append(processRootKeys, rootKey)
		}
	}
	layoutRootSection := func(rootKeys []string, startX, startY int) error {
		sort.Slice(rootKeys, func(i, j int) bool {
			return compareProcessMapPlacements(placements[rootKeys[i]], placements[rootKeys[j]]) < 0
		})
		placedRoots := []domain.ProcessMapPlacement{}
		for _, rootKey := range rootKeys {
			root := placements[rootKey]
			conflicts := false
			for _, previous := range placedRoots {
				if processMapPlacementsConflictWithGap(root, previous, processMapAutomaticRootGap) {
					conflicts = true
					break
				}
			}
			if conflicts {
				nextX, nextY, ok := processMapSquareBiasedPosition(placedRoots, startX, startY, processMapAutomaticRootGap, root.GridWidth, root.GridHeight)
				if !ok {
					return ErrInvalid
				}
				moveX, moveY := nextX-root.GridX, nextY-root.GridY
				if root.ResourceType == domain.ProcessMapResourceTypeFolder {
					if err := processMapAutomaticTranslateDescendants(placements, children, root.ResourceID, moveX, moveY); err != nil {
						return err
					}
				}
				root.GridX, root.GridY = nextX, nextY
				placements[rootKey] = root
			}
			placedRoots = append(placedRoots, root)
		}
		return nil
	}
	sectionMinimum := func(rootKeys []string) (int, int) {
		minimumX, minimumY := 0, 0
		for index, rootKey := range rootKeys {
			root := placements[rootKey]
			if index == 0 || root.GridX < minimumX {
				minimumX = root.GridX
			}
			if index == 0 || root.GridY < minimumY {
				minimumY = root.GridY
			}
		}
		return minimumX, minimumY
	}
	folderStartX, folderStartY := sectionMinimum(folderRootKeys)
	if err := layoutRootSection(folderRootKeys, folderStartX, folderStartY); err != nil {
		return processMapAutomaticPlacementPlan{}, err
	}

	processStartX, processStartY := sectionMinimum(processRootKeys)
	if len(folderRootKeys) > 0 && len(processRootKeys) > 0 {
		folderRight := placements[folderRootKeys[0]].GridX + placements[folderRootKeys[0]].GridWidth
		for _, folderKey := range folderRootKeys[1:] {
			folder := placements[folderKey]
			folderRight = max(folderRight, folder.GridX+folder.GridWidth)
		}
		requiredProcessLeft := folderRight + max(processMapAutomaticSectionGap, processMapAutomaticRootGap)
		if processStartX < requiredProcessLeft {
			shiftX := requiredProcessLeft - processStartX
			for _, processKey := range processRootKeys {
				process := placements[processKey]
				process.GridX += shiftX
				placements[processKey] = process
			}
			processStartX = requiredProcessLeft
		}
	}
	if err := layoutRootSection(processRootKeys, processStartX, processStartY); err != nil {
		return processMapAutomaticPlacementPlan{}, err
	}

	for _, placement := range placements {
		if !validProcessMapGeometry(placement.GridX, placement.GridY, placement.GridWidth, placement.GridHeight) {
			return processMapAutomaticPlacementPlan{}, ErrInvalid
		}
		parentID := processMapAutomaticParentID(placement)
		if parentID == "" {
			continue
		}
		parent, ok := placements[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, parentID)]
		if !ok {
			return processMapAutomaticPlacementPlan{}, ErrNotFound
		}
		if !processMapBoundsContain(processMapPlacementBounds(parent), processMapPlacementBounds(placement)) {
			return processMapAutomaticPlacementPlan{}, ErrProcessMapContainment
		}
	}

	for placementKey, placement := range placements {
		before, existed := original[placementKey]
		if !existed || !processMapAutomaticGeometryEqual(before, placement) {
			plan.Placements = append(plan.Placements, processMapAutomaticClonePlacement(placement))
		}
	}
	sort.Slice(plan.Placements, func(i, j int) bool { return compareProcessMapPlacements(plan.Placements[i], plan.Placements[j]) < 0 })
	if exists && resourceType == domain.ProcessMapResourceTypeFolder {
		finalTarget := placements[targetKey]
		plan.ReparentedFolderDeltaX = finalTarget.GridX - current.GridX
		plan.ReparentedFolderDeltaY = finalTarget.GridY - current.GridY
		for _, placementKey := range reparentedKeys {
			member := placements[placementKey]
			plan.ReparentedFolderMembers = append(plan.ReparentedFolderMembers, domain.ProcessMapResourceRef{ResourceType: member.ResourceType, ResourceID: member.ResourceID})
		}
		sort.Slice(plan.ReparentedFolderMembers, func(i, j int) bool {
			if plan.ReparentedFolderMembers[i].ResourceType != plan.ReparentedFolderMembers[j].ResourceType {
				return plan.ReparentedFolderMembers[i].ResourceType < plan.ReparentedFolderMembers[j].ResourceType
			}
			return plan.ReparentedFolderMembers[i].ResourceID < plan.ReparentedFolderMembers[j].ResourceID
		})
	}
	return plan, nil
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
		directionContinues := (middle.X-before.X)*(after.X-middle.X)+
			(middle.Y-before.Y)*(after.Y-middle.Y) >= 0
		if !directionContinues {
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
