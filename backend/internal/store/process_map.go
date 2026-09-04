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
	ProcessMapMaxDimension     = 250_000_000
)

// Eight reductions by eight leave a 14-by-8 gate inside eight folder levels.
const (
	processMapAutomaticRootFolderWidth  = 14 * (1 << 24)
	processMapAutomaticRootFolderHeight = 8 * (1 << 24)
	processMapAutomaticRootGap          = processMapAutomaticRootFolderWidth / 8
	processMapAutomaticRowSize          = 6
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

// Each transform uses the same saved integer coordinates as manual folder resize.
// Members include only the moving contents, so crossing trace routes stay fixed.
type processMapAutomaticTransform struct {
	Source  domain.ProcessMapPlacement
	Target  domain.ProcessMapPlacement
	Members []domain.ProcessMapResourceRef
}

type processMapAutomaticPlacementPlan struct {
	Placements []domain.ProcessMapPlacement
	Created    bool
	Transforms []processMapAutomaticTransform
}

// processMapRowPosition appends to the last row of at most six saved siblings.
// Existing manual positions are obstacles, never replaced with generated slots.
func processMapRowPosition(siblings []domain.ProcessMapPlacement, startX, startY, gap, width, height int) (int, int) {
	siblings = append([]domain.ProcessMapPlacement(nil), siblings...)
	sort.Slice(siblings, func(i, j int) bool { return compareProcessMapPlacements(siblings[i], siblings[j]) < 0 })
	x, y := startX, startY
	bottom := startY - gap
	for _, sibling := range siblings {
		bottom = max(bottom, sibling.GridY+sibling.GridHeight)
	}
	if len(siblings) > 0 {
		lastRowY := siblings[len(siblings)-1].GridY
		rowStart := len(siblings) - 1
		for rowStart > 0 && siblings[rowStart-1].GridY == lastRowY {
			rowStart--
		}
		if len(siblings)-rowStart < processMapAutomaticRowSize {
			y = lastRowY
			for _, sibling := range siblings[rowStart:] {
				x = max(x, sibling.GridX+sibling.GridWidth+gap)
			}
		} else {
			y = bottom + gap
		}
	}
	candidate := domain.ProcessMapPlacement{GridX: x, GridY: y, GridWidth: width, GridHeight: height}
	for _, sibling := range siblings {
		if processMapPlacementsConflictWithGap(candidate, sibling, 0) {
			// An irregular manual obstacle may cross several rows. One new row
			// below their bounds is sufficient; no candidate-search loop is needed.
			return startX, bottom + gap
		}
	}
	return x, y
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

func processMapAutomaticInterior(parent domain.ProcessMapPlacement) (domain.ProcessMapPlacement, int) {
	gap := max(1, min(parent.GridWidth, parent.GridHeight)/32)
	header := max(1, parent.GridHeight/8)
	return domain.ProcessMapPlacement{
		GridX: parent.GridX + gap, GridY: parent.GridY + header,
		GridWidth: parent.GridWidth - 2*gap, GridHeight: parent.GridHeight - header - gap,
	}, gap
}

func processMapAutomaticFit(source, interior domain.ProcessMapPlacement) domain.ProcessMapPlacement {
	scale := min(1.0, min(float64(interior.GridWidth)/float64(source.GridWidth), float64(interior.GridHeight)/float64(source.GridHeight)))
	return domain.ProcessMapPlacement{
		GridX: interior.GridX, GridY: interior.GridY,
		GridWidth:  int(math.Floor(float64(source.GridWidth) * scale)),
		GridHeight: int(math.Floor(float64(source.GridHeight) * scale)),
	}
}

func processMapAutomaticTransformMembers(
	placements map[string]domain.ProcessMapPlacement, keys []string,
	source, target domain.ProcessMapPlacement,
) (processMapAutomaticTransform, error) {
	transform := processMapAutomaticTransform{Source: source, Target: target}
	for _, key := range keys {
		item := processMapScalePlacementWithinFolder(placements[key], source, target)
		// Intermediate row positions may extend past the world before the whole
		// child group is fitted into its parent. Validate final bounds in the plan.
		if item.GridWidth <= 0 || item.GridHeight <= 0 {
			return processMapAutomaticTransform{}, ErrProcessMapContainment
		}
		placements[key] = item
		transform.Members = append(transform.Members, domain.ProcessMapResourceRef{ResourceType: item.ResourceType, ResourceID: item.ResourceID})
	}
	return transform, nil
}

func planAutomaticProcessMapPlacement(
	companyID, resourceType, resourceID, parentID string,
	input []domain.ProcessMapPlacement,
) (processMapAutomaticPlacementPlan, error) {
	plan := processMapAutomaticPlacementPlan{Placements: []domain.ProcessMapPlacement{}}
	placements := make(map[string]domain.ProcessMapPlacement, len(input)+1)
	original := make(map[string]domain.ProcessMapPlacement, len(input))
	for _, item := range input {
		if item.CompanyID != companyID {
			continue
		}
		key := processMapAutomaticPlacementKey(item.ResourceType, item.ResourceID)
		placements[key] = processMapAutomaticClonePlacement(item)
		original[key] = item
	}
	targetKey := processMapAutomaticPlacementKey(resourceType, resourceID)
	current, exists := placements[targetKey]
	plan.Created = !exists
	if exists && processMapAutomaticParentID(current) == parentID {
		return plan, nil
	}

	seen := map[string]bool{}
	for ancestorID := parentID; ancestorID != ""; {
		if seen[ancestorID] || resourceType == domain.ProcessMapResourceTypeFolder && ancestorID == resourceID {
			return processMapAutomaticPlacementPlan{}, ErrProcessMapCycle
		}
		seen[ancestorID] = true
		ancestor, ok := placements[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, ancestorID)]
		if !ok {
			return processMapAutomaticPlacementPlan{}, ErrNotFound
		}
		ancestorID = processMapAutomaticParentID(ancestor)
	}

	children := processMapAutomaticChildrenIndex(placements)
	width, height := processMapAutomaticRootFolderWidth, processMapAutomaticRootFolderHeight
	gap := processMapAutomaticRootGap
	startX := -(processMapAutomaticRowSize*width + (processMapAutomaticRowSize-1)*gap) / 2
	startY := 0
	var parent, interior domain.ProcessMapPlacement
	if parentID != "" {
		parent = placements[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, parentID)]
		interior, gap = processMapAutomaticInterior(parent)
		if interior.GridWidth <= 0 || interior.GridHeight <= 0 {
			return processMapAutomaticPlacementPlan{}, ErrProcessMapContainment
		}
		startX, startY = interior.GridX, interior.GridY
		width, height = max(2, parent.GridWidth/8), max(1, parent.GridHeight/8)
		if resourceType == domain.ProcessMapResourceTypeFolder {
			height = max(2, height)
		}
	}

	target := domain.ProcessMapPlacement{CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, GridWidth: width, GridHeight: height}
	if exists {
		target = current
		scale := min(float64(width)/float64(current.GridWidth), float64(height)/float64(current.GridHeight))
		target.GridWidth = int(math.Floor(float64(current.GridWidth) * scale))
		target.GridHeight = int(math.Floor(float64(current.GridHeight) * scale))
	}
	siblings := make([]domain.ProcessMapPlacement, 0, len(children[parentID]))
	for _, key := range children[parentID] {
		if key != targetKey {
			siblings = append(siblings, placements[key])
		}
	}
	target.GridX, target.GridY = processMapRowPosition(siblings, startX, startY, gap, target.GridWidth, target.GridHeight)
	if parentID == "" {
		target.MapParentFolderID = nil
	} else {
		parentCopy := parentID
		target.MapParentFolderID = &parentCopy
	}
	if exists && resourceType == domain.ProcessMapResourceTypeFolder {
		keys, cycle := processMapAutomaticDescendantKeys(placements, children, resourceID)
		if cycle {
			return processMapAutomaticPlacementPlan{}, ErrProcessMapCycle
		}
		keys = append(keys, targetKey)
		transform, err := processMapAutomaticTransformMembers(placements, keys, current, target)
		if err != nil {
			return processMapAutomaticPlacementPlan{}, err
		}
		plan.Transforms = append(plan.Transforms, transform)
	}
	placements[targetKey] = target
	if oldParentID := processMapAutomaticParentID(current); exists && oldParentID != parentID {
		for i, key := range children[oldParentID] {
			if key == targetKey {
				children[oldParentID] = append(children[oldParentID][:i], children[oldParentID][i+1:]...)
				break
			}
		}
	}
	children[parentID] = append(children[parentID], targetKey)

	{
		if parentID == "" {
			interior = domain.ProcessMapPlacement{
				GridX: ProcessMapMinCoordinate, GridY: ProcessMapMinCoordinate,
				GridWidth:  ProcessMapMaxCoordinate - ProcessMapMinCoordinate,
				GridHeight: ProcessMapMaxCoordinate - ProcessMapMinCoordinate,
			}
		}
		content := processMapPlacementBounds(target)
		for _, sibling := range siblings {
			content.MinX = min(content.MinX, sibling.GridX)
			content.MinY = min(content.MinY, sibling.GridY)
			content.MaxX = max(content.MaxX, sibling.GridX+sibling.GridWidth)
			content.MaxY = max(content.MaxY, sibling.GridY+sibling.GridHeight)
		}
		if !processMapBoundsContain(processMapPlacementBounds(interior), content) {
			source := domain.ProcessMapPlacement{GridX: content.MinX, GridY: content.MinY, GridWidth: content.MaxX - content.MinX, GridHeight: content.MaxY - content.MinY}
			fitted := processMapAutomaticFit(source, interior)
			if parentID == "" {
				// Keep the root arrangement in place until a world edge requires
				// movement, and shrink it only when its span exceeds the world.
				fitted.GridX = max(ProcessMapMinCoordinate, min(source.GridX, ProcessMapMaxCoordinate-fitted.GridWidth))
				fitted.GridY = max(ProcessMapMinCoordinate, min(source.GridY, ProcessMapMaxCoordinate-fitted.GridHeight))
			}
			keys, cycle := processMapAutomaticDescendantKeys(placements, children, parentID)
			if cycle {
				return processMapAutomaticPlacementPlan{}, ErrProcessMapCycle
			}
			transform, err := processMapAutomaticTransformMembers(placements, keys, source, fitted)
			if err != nil {
				return processMapAutomaticPlacementPlan{}, err
			}
			plan.Transforms = append(plan.Transforms, transform)
		}
	}

	for key, item := range placements {
		if !validProcessMapGeometry(item.GridX, item.GridY, item.GridWidth, item.GridHeight) {
			return processMapAutomaticPlacementPlan{}, ErrInvalid
		}
		if parentID := processMapAutomaticParentID(item); parentID != "" {
			parent, ok := placements[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, parentID)]
			if !ok {
				return processMapAutomaticPlacementPlan{}, ErrNotFound
			}
			if !processMapBoundsContain(processMapPlacementBounds(parent), processMapPlacementBounds(item)) {
				return processMapAutomaticPlacementPlan{}, ErrProcessMapContainment
			}
		}
		if before, existed := original[key]; !existed || !processMapAutomaticGeometryEqual(before, item) {
			plan.Placements = append(plan.Placements, item)
		}
	}
	sort.Slice(plan.Placements, func(i, j int) bool { return compareProcessMapPlacements(plan.Placements[i], plan.Placements[j]) < 0 })
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
	GetProcessMapChanges(ctx context.Context, input ProcessMapChangesQuery) (ProcessMapChanges, error)
	GetProcessMapTile(ctx context.Context, input ProcessMapTileQuery) (domain.ProcessMapTile, error)
	ListResourceOperationalRelationshipsForResource(ctx context.Context, input ResourceOperationalRelationshipQuery) ([]domain.ResourceOperationalRelationship, error)
	PutProcessMapPlacement(ctx context.Context, input ProcessMapPlacementPutInput) (ProcessMapMutationEnvelope, error)
	DeleteProcessMapPlacement(ctx context.Context, input ProcessMapPlacementDeleteInput) (ProcessMapMutationEnvelope, error)
	CreateResourceOperationalRelationship(ctx context.Context, input ResourceOperationalRelationshipCreateInput) (ProcessMapMutationEnvelope, error)
	PutProcessMapTrace(ctx context.Context, input ProcessMapTracePutInput) (ProcessMapMutationEnvelope, error)
	DeleteResourceOperationalRelationship(ctx context.Context, input ResourceOperationalRelationshipDeleteInput) (ProcessMapMutationEnvelope, error)
}
