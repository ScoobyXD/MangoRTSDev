package store

import (
	"context"
	"maps"
	"miraeopus/backend/internal/domain"
	"slices"
	"strings"
	"time"
)

func processMapPlacementMemoryKey(companyID, resourceType, resourceID string) string {
	return companyID + ":" + resourceType + ":" + resourceID
}

func cloneProcessMapRoutePoints(points []domain.ProcessMapRoutePoint) []domain.ProcessMapRoutePoint {
	return append([]domain.ProcessMapRoutePoint{}, points...)
}

func cloneProcessMapTrace(item domain.ProcessMapTrace) domain.ProcessMapTrace {
	item.RoutePoints = cloneProcessMapRoutePoints(item.RoutePoints)
	return item
}

func cloneProcessMapPlacement(item domain.ProcessMapPlacement) domain.ProcessMapPlacement {
	if item.MapParentFolderID != nil {
		parentID := *item.MapParentFolderID
		item.MapParentFolderID = &parentID
	}
	return item
}

func sameProcessMapParent(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return strings.TrimSpace(*left) == strings.TrimSpace(*right)
}

func processMapParentPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

// syncAutomaticMemoryProcessMapPlacementLocked applies the same validated pure
// plan as PostgreSQL. Nothing is mutated until every placement and transformed
// internal trace has passed the shared coordinate checks.
func (r *MemoryRepo) syncAutomaticMemoryProcessMapPlacementLocked(companyID, resourceType, resourceID string, parentID *string, permissionUserID string) (bool, error) {
	parentValue := strings.TrimSpace(pointerStringValue(parentID))
	placements := make([]domain.ProcessMapPlacement, 0, len(r.processMapPlacements))
	for _, placement := range r.processMapPlacements {
		if placement.CompanyID == companyID {
			placements = append(placements, cloneProcessMapPlacement(placement))
		}
	}
	plan, err := planAutomaticProcessMapPlacement(companyID, resourceType, resourceID, parentValue, placements)
	if err != nil {
		return false, err
	}
	if len(plan.Placements) == 0 {
		return false, nil
	}
	if permissionUserID != "" {
		checked := map[domain.ProcessMapResourceRef]bool{}
		requireEdit := func(resource domain.ProcessMapResourceRef) bool {
			if checked[resource] || plan.Created && resource.ResourceType == resourceType && resource.ResourceID == resourceID {
				return true
			}
			checked[resource] = true
			return r.processMapResourceAllowedLocked(companyID, permissionUserID, resource.ResourceType, resource.ResourceID)
		}
		for _, placement := range plan.Placements {
			if !requireEdit(domain.ProcessMapResourceRef{ResourceType: placement.ResourceType, ResourceID: placement.ResourceID}) {
				return false, ErrNotFound
			}
		}
		for _, transform := range plan.Transforms {
			for _, member := range transform.Members {
				if !requireEdit(member) {
					return false, ErrNotFound
				}
			}
		}
	}

	transformedTraces := map[string]domain.ProcessMapTrace{}
	for _, transform := range plan.Transforms {
		members := make(map[string]bool, len(transform.Members))
		for _, member := range transform.Members {
			members[processMapPlacementMemoryKey(companyID, member.ResourceType, member.ResourceID)] = true
		}
		for traceKey, trace := range r.processMapTraces {
			if trace.CompanyID != companyID {
				continue
			}
			relationship, ok := r.resourceOperationalRelationships[key(companyID, trace.ResourceOperationalRelationshipID)]
			if !ok || !members[processMapPlacementMemoryKey(companyID, relationship.Source.ResourceType, relationship.Source.ResourceID)] || !members[processMapPlacementMemoryKey(companyID, relationship.Target.ResourceType, relationship.Target.ResourceID)] {
				continue
			}
			if previous, ok := transformedTraces[traceKey]; ok {
				trace = previous
			}
			trace.RoutePoints = processMapScaleRoutePointsWithinFolder(trace.RoutePoints, transform.Source, transform.Target)
			transformedTraces[traceKey] = trace
		}
	}
	for _, trace := range transformedTraces {
		if !validProcessMapRoutePoints(trace.RoutePoints) {
			return false, ErrInvalid
		}
	}

	now := time.Now().UTC()
	for _, placement := range plan.Placements {
		placementKey := processMapPlacementMemoryKey(companyID, placement.ResourceType, placement.ResourceID)
		current, exists := r.processMapPlacements[placementKey]
		if exists {
			placement.PlacementIncarnationToken = current.PlacementIncarnationToken
			placement.CreatedTimestamp = current.CreatedTimestamp
			placement.Revision = current.Revision + 1
		} else {
			placement.PlacementIncarnationToken = newUUIDv7String()
			placement.CreatedTimestamp = now
			placement.Revision = 1
		}
		placement.UpdatedTimestamp = now
		r.processMapPlacements[placementKey] = cloneProcessMapPlacement(placement)
	}
	for traceKey, trace := range transformedTraces {
		if slices.Equal(trace.RoutePoints, r.processMapTraces[traceKey].RoutePoints) {
			continue
		}
		trace.Revision++
		trace.UpdatedTimestamp = now
		r.processMapTraces[traceKey] = trace
	}
	return true, nil
}

// deleteAutomaticMemoryProcessMapPlacementLocked detaches map geometry while
// preserving the underlying Process and its operational relationships.
func (r *MemoryRepo) deleteAutomaticMemoryProcessMapPlacementLocked(companyID, resourceType, resourceID string) bool {
	placementKey := processMapPlacementMemoryKey(companyID, resourceType, resourceID)
	if _, exists := r.processMapPlacements[placementKey]; !exists {
		return false
	}
	placements := []domain.ProcessMapPlacement{{CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID}}
	if resourceType == domain.ProcessMapResourceTypeFolder {
		placements = append(placements, r.processMapDescendantsLocked(companyID, resourceID)...)
	}
	for _, placement := range placements {
		r.deleteProcessMapTracesIncidentToResourceLocked(companyID, placement.ResourceType, placement.ResourceID)
		delete(r.processMapPlacements, processMapPlacementMemoryKey(companyID, placement.ResourceType, placement.ResourceID))
	}
	return true
}

func (r *MemoryRepo) syncMemoryProcessMapParentToExplorerLocked(companyID, resourceType, resourceID string, parentID *string, now time.Time) bool {
	r.ensureCompanyExplorerV2CompanyGraphLocked(companyID)
	parentValue := pointerStringValue(parentID)
	childEntityID := resourceID
	changed := false
	position := 0
	created := now
	if resourceType == domain.ProcessMapResourceTypeFolder {
		folderKey := key(companyID, resourceID)
		folder, ok := r.folders[folderKey]
		if !ok {
			return false
		}
		position = folder.Position
		created = folder.CreatedTimestamp
		if pointerStringValue(folder.ParentFolderID) != parentValue {
			folder.ParentFolderID = processMapParentPointer(parentValue)
			folder.UpdatedTimestamp = now
			r.folders[folderKey] = folder
			changed = true
		}
	} else {
		itemKey := folderItemKey(companyID, "logic_gate", resourceID)
		item, exists := r.folderItems[itemKey]
		if exists {
			position = item.Position
			created = item.CreatedTimestamp
		}
		if parentValue == "" && exists {
			delete(r.folderItems, itemKey)
			changed = true
		} else if parentValue != "" && (!exists || item.FolderID != parentValue) {
			if !exists {
				item = domain.CompanyExplorerFolderItem{
					CompanyID: companyID, ItemType: "logic_gate", ItemID: resourceID,
					CreatedTimestamp: now,
				}
			}
			item.FolderID = parentValue
			item.Position = nextCompanyExplorerRowPosition(r.folders, r.folderItems, companyID, "node", parentValue)
			item.UpdatedTimestamp = now
			r.folderItems[itemKey] = item
			position = item.Position
			created = item.CreatedTimestamp
			changed = true
		}
	}

	parentEntityID := parentValue
	if parentEntityID == "" {
		parentEntityID = companyExplorerV2NativeEntityID(companyID, CompanyExplorerV2EntityCompany, companyID)
	}
	matchingEdges := 0
	exactEdge := memoryCompanyExplorerV2Edge{}
	for _, edge := range r.companyExplorerV2Edges {
		if edge.CompanyID == companyID && edge.ChildEntityID == childEntityID {
			matchingEdges++
			if edge.ParentEntityID == parentEntityID {
				exactEdge = edge
			}
		}
	}
	if matchingEdges == 1 && exactEdge.EdgeID != "" && (position <= 0 || exactEdge.Position == position) {
		return changed
	}
	for edgeKey, edge := range r.companyExplorerV2Edges {
		if edge.CompanyID == companyID && edge.ChildEntityID == childEntityID {
			delete(r.companyExplorerV2Edges, edgeKey)
		}
	}
	if position <= 0 {
		position = r.nextCompanyExplorerV2EdgePositionLocked(companyID, parentEntityID)
	}
	edge := memoryCompanyExplorerV2Edge{
		CompanyID: companyID, EdgeID: companyExplorerV2EdgeID(companyID, parentEntityID, childEntityID),
		ParentEntityID: parentEntityID, ChildEntityID: childEntityID,
		Position:         position,
		CreatedTimestamp: created, UpdatedTimestamp: now,
	}
	r.companyExplorerV2Edges[key(companyID, edge.EdgeID)] = edge
	return true
}

func processMapRoutePointsEqual(a, b []domain.ProcessMapRoutePoint) bool {
	return slices.Equal(a, b)
}

func (r *MemoryRepo) processMapResourceExistsLocked(companyID, resourceType, resourceID string) bool {
	switch resourceType {
	case domain.ProcessMapResourceTypeFolder:
		folder, ok := r.folders[key(companyID, resourceID)]
		return ok && folder.FolderKind != "communications"
	case domain.ProcessMapResourceTypeProcess:
		_, ok := r.logicGates[key(companyID, resourceID)]
		return ok
	default:
		return false
	}
}

func (r *MemoryRepo) processMapResourceAllowedLocked(companyID, permissionUserID, resourceType, resourceID string) bool {
	return r.userHasEffectiveAccessLocked(companyID, permissionUserID, resourceType, resourceID, EntityPermissionEdit)
}

func (r *MemoryRepo) processMapResourceNameLocked(companyID, resourceType, resourceID string) (string, bool) {
	switch resourceType {
	case domain.ProcessMapResourceTypeFolder:
		folder, ok := r.folders[key(companyID, resourceID)]
		if !ok || folder.FolderKind == "communications" {
			return "", false
		}
		return folder.Name, true
	case domain.ProcessMapResourceTypeProcess:
		process, ok := r.logicGates[key(companyID, resourceID)]
		if !ok {
			return "", false
		}
		return process.Header, true
	default:
		return "", false
	}
}

func (r *MemoryRepo) memoryProcessMapProcessSummaryLocked(companyID, logicGateID string) (*domain.ProcessMapScoreCardSummary, []string, []string) {
	var scoreCard *domain.ProcessMapScoreCardSummary
	if businessDate, err := qdRatingBusinessDate(time.Now().UTC()); err == nil {
		if rating, ok := r.qdRatings[memoryQDRatingDayKey(companyID, logicGateID, businessDate)]; ok {
			scoreCard = &domain.ProcessMapScoreCardSummary{
				QualityRating: rating.QualityRating, CostRating: rating.CostRating, DeliveryRating: rating.DeliveryRating,
			}
		}
	}
	responsible, accountable := []string{}, []string{}
	if r.ensureV2PolicySettingsLocked(companyID, EntityTypeLogicGate, logicGateID) {
		seenResponsible, seenAccountable := map[string]bool{}, map[string]bool{}
		for _, assignment := range r.gvicAssignmentsForResourceLocked(companyID, EntityTypeLogicGate, logicGateID) {
			name := strings.TrimSpace(assignment.PrincipalName)
			if name == "" {
				name = strings.TrimSpace(assignment.UserDisplayName)
			}
			if name == "" {
				name = strings.TrimSpace(assignment.UserEmail)
			}
			if name == "" {
				continue
			}
			switch assignment.Role {
			case domain.RACIRoleResponsible:
				if !seenResponsible[name] {
					seenResponsible[name] = true
					responsible = append(responsible, name)
				}
			case domain.RACIRoleAccountable:
				if !seenAccountable[name] {
					seenAccountable[name] = true
					accountable = append(accountable, name)
				}
			}
		}
	}
	slices.Sort(responsible)
	slices.Sort(accountable)
	return scoreCard, responsible, accountable
}

func (r *MemoryRepo) processMapVersionsLocked(companyID string) (int64, int64) {
	return r.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "process-map", "")],
		r.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "policy-group-membership", "")]
}

func (r *MemoryRepo) CurrentProcessMapVersions(ctx context.Context, companyID string) (int64, int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, 0, err
	}
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return 0, 0, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	processVersion, permissionVersion := r.processMapVersionsLocked(companyID)
	return processVersion, permissionVersion, nil
}

func normalizeMemoryProcessMapRead(companyID, permissionUserID string) (string, string, error) {
	companyID = strings.TrimSpace(companyID)
	permissionUserID = strings.TrimSpace(permissionUserID)
	if companyID == "" || permissionUserID == "" {
		return "", "", ErrInvalid
	}
	return companyID, permissionUserID, nil
}

func (r *MemoryRepo) GetProcessMapScene(ctx context.Context, input ProcessMapSceneQuery) (domain.ProcessMapScene, error) {
	companyID, permissionUserID, err := normalizeMemoryProcessMapRead(input.CompanyID, input.PermissionUserID)
	if err != nil {
		return domain.ProcessMapScene{}, err
	}
	if err := ctx.Err(); err != nil {
		return domain.ProcessMapScene{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.userHasCompanyMembershipLocked(companyID, permissionUserID) {
		return domain.ProcessMapScene{}, ErrNotFound
	}
	var bounds *domain.ProcessMapBounds
	for _, placement := range r.processMapPlacements {
		if placement.CompanyID != companyID || !r.processMapResourceExistsLocked(companyID, placement.ResourceType, placement.ResourceID) {
			continue
		}
		itemBounds := processMapPlacementBounds(placement)
		if !r.processMapResourceAllowedLocked(companyID, permissionUserID, placement.ResourceType, placement.ResourceID) {
			itemBounds.MaxX = itemBounds.MinX + ProcessMapRestrictedWidth
			itemBounds.MaxY = itemBounds.MinY + ProcessMapRestrictedHeight
		}
		if bounds == nil {
			copyBounds := itemBounds
			bounds = &copyBounds
			continue
		}
		bounds.MinX = min(bounds.MinX, itemBounds.MinX)
		bounds.MinY = min(bounds.MinY, itemBounds.MinY)
		bounds.MaxX = max(bounds.MaxX, itemBounds.MaxX)
		bounds.MaxY = max(bounds.MaxY, itemBounds.MaxY)
	}
	processVersion, _ := r.processMapVersionsLocked(companyID)
	return domain.ProcessMapScene{
		Bounds: bounds, ProcessMapReadVersion: processVersion,
		TileSize: ProcessMapTileSize, MinTileZoom: ProcessMapMinTileZoom, MaxTileZoom: ProcessMapMaxTileZoom,
	}, nil
}

func (r *MemoryRepo) GetProcessMapTile(ctx context.Context, input ProcessMapTileQuery) (domain.ProcessMapTile, error) {
	companyID, permissionUserID, err := normalizeMemoryProcessMapRead(input.CompanyID, input.PermissionUserID)
	if err != nil {
		return domain.ProcessMapTile{}, err
	}
	tileBounds, ok := processMapTileBounds(input.Z, input.X, input.Y)
	if !ok {
		return domain.ProcessMapTile{}, ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return domain.ProcessMapTile{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.userHasCompanyMembershipLocked(companyID, permissionUserID) {
		return domain.ProcessMapTile{}, ErrNotFound
	}
	processVersion, _ := r.processMapVersionsLocked(companyID)
	result := domain.ProcessMapTile{
		Z: input.Z, X: input.X, Y: input.Y, ProcessMapReadVersion: processVersion,
		Placements: []domain.ProcessMapTilePlacement{}, Traces: []domain.ProcessMapTileTrace{},
	}

	placements := make([]domain.ProcessMapPlacement, 0)
	for _, placement := range r.processMapPlacements {
		if placement.CompanyID == companyID {
			placements = append(placements, cloneProcessMapPlacement(placement))
		}
	}
	slices.SortFunc(placements, compareProcessMapPlacements)
	visible := map[string]domain.ProcessMapPlacement{}
	for _, placement := range placements {
		if !r.processMapResourceExistsLocked(companyID, placement.ResourceType, placement.ResourceID) {
			continue
		}
		allowed := r.processMapResourceAllowedLocked(companyID, permissionUserID, placement.ResourceType, placement.ResourceID)
		itemBounds := processMapPlacementBounds(placement)
		if !allowed {
			itemBounds.MaxX = itemBounds.MinX + ProcessMapRestrictedWidth
			itemBounds.MaxY = itemBounds.MinY + ProcessMapRestrictedHeight
			if processMapBoundsIntersect(itemBounds, tileBounds) {
				result.Placements = append(result.Placements, domain.ProcessMapRestrictedPlacement{Restricted: true, GridX: placement.GridX, GridY: placement.GridY})
			}
			continue
		}
		name, exists := r.processMapResourceNameLocked(companyID, placement.ResourceType, placement.ResourceID)
		if !exists || !processMapBoundsIntersect(itemBounds, tileBounds) {
			continue
		}
		visible[processMapPlacementMemoryKey(companyID, placement.ResourceType, placement.ResourceID)] = placement
		parentID := placement.MapParentFolderID
		if parentID != nil && !r.processMapResourceAllowedLocked(companyID, permissionUserID, domain.ProcessMapResourceTypeFolder, *parentID) {
			parentID = nil
		}
		presentation := processMapPlacementPresentationAtTileZoom(placement.GridWidth, placement.GridHeight, input.Z)
		if presentation == domain.ProcessMapPresentationWhole {
			name = ""
		}
		var scoreCard *domain.ProcessMapScoreCardSummary
		var responsibleNames, accountableNames []string
		if placement.ResourceType == domain.ProcessMapResourceTypeProcess && presentation == domain.ProcessMapPresentationEditing {
			scoreCard, responsibleNames, accountableNames = r.memoryProcessMapProcessSummaryLocked(companyID, placement.ResourceID)
		}
		result.Placements = append(result.Placements, domain.ProcessMapVisiblePlacement{
			Restricted: false, Presentation: presentation, ResourceType: placement.ResourceType, ResourceID: placement.ResourceID, Name: name,
			MapParentFolderID: parentID, GridX: placement.GridX, GridY: placement.GridY,
			GridWidth: placement.GridWidth, GridHeight: placement.GridHeight, Revision: placement.Revision,
			CreatedTimestamp: placement.CreatedTimestamp, UpdatedTimestamp: placement.UpdatedTimestamp, CanEdit: true,
			ScoreCard: scoreCard, ResponsibleNames: responsibleNames, AccountableNames: accountableNames,
		})
	}

	traceItems := make([]domain.ProcessMapTrace, 0)
	for _, trace := range r.processMapTraces {
		if trace.CompanyID == companyID {
			traceItems = append(traceItems, cloneProcessMapTrace(trace))
		}
	}
	slices.SortFunc(traceItems, func(a, b domain.ProcessMapTrace) int {
		return strings.Compare(a.ResourceOperationalRelationshipID, b.ResourceOperationalRelationshipID)
	})
	for _, trace := range traceItems {
		relationship, exists := r.resourceOperationalRelationships[key(companyID, trace.ResourceOperationalRelationshipID)]
		if !exists || !r.processMapResourceAllowedLocked(companyID, permissionUserID, relationship.Source.ResourceType, relationship.Source.ResourceID) ||
			!r.processMapResourceAllowedLocked(companyID, permissionUserID, relationship.Target.ResourceType, relationship.Target.ResourceID) {
			continue
		}
		source, sourceOK := r.processMapPlacements[processMapPlacementMemoryKey(companyID, relationship.Source.ResourceType, relationship.Source.ResourceID)]
		target, targetOK := r.processMapPlacements[processMapPlacementMemoryKey(companyID, relationship.Target.ResourceType, relationship.Target.ResourceID)]
		if !sourceOK || !targetOK {
			continue
		}
		fragments := processMapClipPath(processMapTracePath(source, target, trace.RoutePoints), tileBounds)
		if len(fragments) == 0 {
			continue
		}
		presentation := processMapMaxPresentation(
			processMapPlacementPresentationAtTileZoom(source.GridWidth, source.GridHeight, input.Z),
			processMapPlacementPresentationAtTileZoom(target.GridWidth, target.GridHeight, input.Z),
		)
		routePoints := []domain.ProcessMapRoutePoint{}
		if presentation == domain.ProcessMapPresentationEditing {
			routePoints = cloneProcessMapRoutePoints(trace.RoutePoints)
		}
		result.Traces = append(result.Traces, domain.ProcessMapTileTrace{
			ResourceOperationalRelationshipID: relationship.ResourceOperationalRelationshipID,
			Presentation:                      presentation,
			Source:                            relationship.Source, Target: relationship.Target, RoutePoints: routePoints,
			PathFragments: fragments, Revision: trace.Revision,
			CreatedTimestamp: trace.CreatedTimestamp, UpdatedTimestamp: trace.UpdatedTimestamp,
		})
	}
	return result, nil
}

func (r *MemoryRepo) ListResourceOperationalRelationshipsForResource(ctx context.Context, input ResourceOperationalRelationshipQuery) ([]domain.ResourceOperationalRelationship, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ResourceID = strings.TrimSpace(input.ResourceID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	resourceType, typeOK := normalizeProcessMapResourceType(input.ResourceType)
	direction, directionOK := normalizeProcessMapDirection(input.Direction)
	if input.CompanyID == "" || input.ResourceID == "" || input.PermissionUserID == "" || !typeOK || !directionOK {
		return nil, ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if !r.processMapResourceExistsLocked(input.CompanyID, resourceType, input.ResourceID) ||
		!r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, resourceType, input.ResourceID) {
		return nil, ErrNotFound
	}
	items := []domain.ResourceOperationalRelationship{}
	for _, item := range r.resourceOperationalRelationships {
		if item.CompanyID != input.CompanyID {
			continue
		}
		outgoing := item.Source.ResourceType == resourceType && item.Source.ResourceID == input.ResourceID
		incoming := item.Target.ResourceType == resourceType && item.Target.ResourceID == input.ResourceID
		if (direction == "outgoing" && !outgoing) || (direction == "incoming" && !incoming) || (direction == "both" && !outgoing && !incoming) {
			continue
		}
		if !r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, item.Source.ResourceType, item.Source.ResourceID) ||
			!r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, item.Target.ResourceType, item.Target.ResourceID) {
			continue
		}
		items = append(items, item)
	}
	slices.SortFunc(items, func(a, b domain.ResourceOperationalRelationship) int {
		return strings.Compare(a.ResourceOperationalRelationshipID, b.ResourceOperationalRelationshipID)
	})
	return items, nil
}

type memoryProcessMapMutationSnapshot struct {
	companies             map[string]domain.Company
	placements            map[string]domain.ProcessMapPlacement
	relationships         map[string]domain.ResourceOperationalRelationship
	traces                map[string]domain.ProcessMapTrace
	folders               map[string]domain.CompanyExplorerFolder
	folderItems           map[string]domain.CompanyExplorerFolderItem
	logicGates            map[string]domain.LogicGate
	explorerEntities      map[string]memoryCompanyExplorerV2Entity
	explorerEdges         map[string]memoryCompanyExplorerV2Edge
	explorerSubscriptions map[string]memoryCompanyExplorerV2Subscription
	gvicAssignments       map[string]domain.ResourceRACIAssignment
	entityPermissions     map[string]domain.EntityPermission
	gvicV2Settings        map[string]memoryV2PolicySetting
	permissionV2Settings  map[string]memoryV2PolicySetting
	gvicV2Sequence        int64
	permissionV2Sequence  int64
	events                map[string]domain.DomainEvent
	versions              map[string]int64
	outbox                map[string]RealtimeOutboxEvent
	outboxSequence        int64
}

func (r *MemoryRepo) snapshotProcessMapMutationLocked() memoryProcessMapMutationSnapshot {
	placements := maps.Clone(r.processMapPlacements)
	for itemKey, item := range placements {
		placements[itemKey] = cloneProcessMapPlacement(item)
	}
	traces := maps.Clone(r.processMapTraces)
	for itemKey, item := range traces {
		traces[itemKey] = cloneProcessMapTrace(item)
	}
	return memoryProcessMapMutationSnapshot{
		companies: maps.Clone(r.companies), placements: placements, relationships: maps.Clone(r.resourceOperationalRelationships),
		traces: traces, folders: maps.Clone(r.folders), folderItems: maps.Clone(r.folderItems),
		logicGates:       maps.Clone(r.logicGates),
		explorerEntities: maps.Clone(r.companyExplorerV2Entities), explorerEdges: maps.Clone(r.companyExplorerV2Edges),
		explorerSubscriptions: maps.Clone(r.companyExplorerV2Subscriptions),
		gvicAssignments:       maps.Clone(r.gvicAssignments), entityPermissions: maps.Clone(r.entityPermissions),
		gvicV2Settings: maps.Clone(r.gvicV2Settings), permissionV2Settings: maps.Clone(r.permissionV2Settings),
		gvicV2Sequence: r.gvicV2Sequence, permissionV2Sequence: r.permissionV2Sequence,
		events: maps.Clone(r.domainEvents), versions: maps.Clone(r.workspaceReadVersions),
		outbox: maps.Clone(r.realtimeOutbox), outboxSequence: r.realtimeOutboxSequence,
	}
}

func (r *MemoryRepo) restoreProcessMapMutationLocked(snapshot memoryProcessMapMutationSnapshot) {
	r.companies = snapshot.companies
	r.processMapPlacements = snapshot.placements
	r.resourceOperationalRelationships = snapshot.relationships
	r.processMapTraces = snapshot.traces
	r.folders = snapshot.folders
	r.folderItems = snapshot.folderItems
	r.logicGates = snapshot.logicGates
	r.companyExplorerV2Entities = snapshot.explorerEntities
	r.companyExplorerV2Edges = snapshot.explorerEdges
	r.companyExplorerV2Subscriptions = snapshot.explorerSubscriptions
	r.gvicAssignments = snapshot.gvicAssignments
	r.entityPermissions = snapshot.entityPermissions
	r.gvicV2Settings = snapshot.gvicV2Settings
	r.permissionV2Settings = snapshot.permissionV2Settings
	r.gvicV2Sequence = snapshot.gvicV2Sequence
	r.permissionV2Sequence = snapshot.permissionV2Sequence
	r.domainEvents = snapshot.events
	r.workspaceReadVersions = snapshot.versions
	r.realtimeOutbox = snapshot.outbox
	r.realtimeOutboxSequence = snapshot.outboxSequence
}

func (r *MemoryRepo) processMapFolderCycleLocked(companyID, folderID, parentFolderID string) bool {
	seen := map[string]bool{}
	for parentFolderID != "" {
		if parentFolderID == folderID || seen[parentFolderID] {
			return true
		}
		seen[parentFolderID] = true
		parent, ok := r.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, parentFolderID)]
		if !ok || parent.MapParentFolderID == nil {
			return false
		}
		parentFolderID = strings.TrimSpace(*parent.MapParentFolderID)
	}
	return false
}

func (r *MemoryRepo) processMapDescendantsLocked(companyID, folderID string) []domain.ProcessMapPlacement {
	result := []domain.ProcessMapPlacement{}
	queue := []string{folderID}
	seen := map[string]bool{folderID: true}
	for len(queue) > 0 {
		parentID := queue[0]
		queue = queue[1:]
		children := []domain.ProcessMapPlacement{}
		for _, placement := range r.processMapPlacements {
			if placement.CompanyID == companyID && placement.MapParentFolderID != nil && strings.TrimSpace(*placement.MapParentFolderID) == parentID {
				children = append(children, cloneProcessMapPlacement(placement))
			}
		}
		slices.SortFunc(children, compareProcessMapPlacements)
		for _, child := range children {
			result = append(result, child)
			if child.ResourceType == domain.ProcessMapResourceTypeFolder && !seen[child.ResourceID] {
				seen[child.ResourceID] = true
				queue = append(queue, child.ResourceID)
			}
		}
	}
	return result
}

func (r *MemoryRepo) processMapFolderCleanupOrderLocked(companyID string, folderIDs map[string]bool) []string {
	type folderDepth struct {
		id    string
		depth int
	}
	items := make([]folderDepth, 0, len(folderIDs))
	for folderID := range folderIDs {
		depth := 0
		seen := map[string]bool{folderID: true}
		placement, mapped := r.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, folderID)]
		for mapped && placement.MapParentFolderID != nil {
			parentID := strings.TrimSpace(*placement.MapParentFolderID)
			if parentID == "" || seen[parentID] {
				break
			}
			seen[parentID] = true
			depth++
			placement, mapped = r.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, parentID)]
		}
		items = append(items, folderDepth{id: folderID, depth: depth})
	}
	slices.SortFunc(items, func(a, b folderDepth) int {
		if a.depth != b.depth {
			return a.depth - b.depth
		}
		return strings.Compare(a.id, b.id)
	})
	result := make([]string, 0, len(items))
	for _, item := range items {
		result = append(result, item.id)
	}
	return result
}

func (r *MemoryRepo) processMapRequireMappedParentLocked(companyID, permissionUserID, parentID string) (domain.ProcessMapPlacement, error) {
	parent, exists := r.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, parentID)]
	if !exists || !r.processMapResourceExistsLocked(companyID, domain.ProcessMapResourceTypeFolder, parentID) ||
		!r.processMapResourceAllowedLocked(companyID, permissionUserID, domain.ProcessMapResourceTypeFolder, parentID) {
		return domain.ProcessMapPlacement{}, ErrNotFound
	}
	return cloneProcessMapPlacement(parent), nil
}

func (r *MemoryRepo) PutProcessMapPlacement(ctx context.Context, input ProcessMapPlacementPutInput) (ProcessMapMutationEnvelope, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ResourceID = strings.TrimSpace(input.ResourceID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	resourceType, ok := normalizeProcessMapResourceType(input.ResourceType)
	if input.CompanyID == "" || input.ResourceID == "" || input.ActorUserID == "" || input.PermissionUserID == "" || !ok ||
		!validProcessMapGeometry(input.GridX, input.GridY, input.GridWidth, input.GridHeight) {
		return ProcessMapMutationEnvelope{}, ErrInvalid
	}
	var parentID string
	if input.MapParentFolderID != nil {
		parentID = strings.TrimSpace(*input.MapParentFolderID)
		if parentID == "" {
			return ProcessMapMutationEnvelope{}, ErrInvalid
		}
	}
	if err := ctx.Err(); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotProcessMapMutationLocked()
	restore := func(err error) (ProcessMapMutationEnvelope, error) {
		r.restoreProcessMapMutationLocked(snapshot)
		return ProcessMapMutationEnvelope{}, err
	}
	if !r.processMapResourceExistsLocked(input.CompanyID, resourceType, input.ResourceID) ||
		!r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, resourceType, input.ResourceID) {
		return restore(ErrNotFound)
	}
	var parent domain.ProcessMapPlacement
	if parentID != "" {
		var err error
		parent, err = r.processMapRequireMappedParentLocked(input.CompanyID, input.PermissionUserID, parentID)
		if err != nil {
			return restore(err)
		}
	}
	if resourceType == domain.ProcessMapResourceTypeFolder && (parentID == input.ResourceID || r.processMapFolderCycleLocked(input.CompanyID, input.ResourceID, parentID)) {
		return restore(ErrProcessMapCycle)
	}

	placementKey := processMapPlacementMemoryKey(input.CompanyID, resourceType, input.ResourceID)
	current, exists := r.processMapPlacements[placementKey]
	sourceFolder := cloneProcessMapPlacement(current)
	descendants := []domain.ProcessMapPlacement{}
	if resourceType == domain.ProcessMapResourceTypeFolder && exists {
		descendants = r.processMapDescendantsLocked(input.CompanyID, input.ResourceID)
	}
	desiredParent := processMapParentPointer(parentID)
	parentChanged := !exists || !sameProcessMapParent(current.MapParentFolderID, desiredParent)
	audienceResources := []domain.ProcessMapResourceRef(nil)
	beforeAudience := processMapAccessAudience(nil)
	if parentChanged {
		audienceResources = r.processMapAccessResourcesLocked(input.CompanyID, resourceType, input.ResourceID)
		beforeAudience = r.processMapAccessAudienceLocked(input.CompanyID, audienceResources)
	}
	now := time.Now().UTC()
	deltaX, deltaY := 0, 0
	if exists {
		deltaX, deltaY = input.GridX-current.GridX, input.GridY-current.GridY
	}
	movesFolderGroup := resourceType == domain.ProcessMapResourceTypeFolder && exists &&
		(deltaX != 0 || deltaY != 0) && input.GridWidth == current.GridWidth && input.GridHeight == current.GridHeight
	resizesFolderGroup := resourceType == domain.ProcessMapResourceTypeFolder && exists &&
		(input.GridWidth != current.GridWidth || input.GridHeight != current.GridHeight)
	transformsFolderGroup := movesFolderGroup || resizesFolderGroup
	changedPlacements := []domain.ProcessMapPlacement{}
	transformedKeys := map[string]bool{}
	if transformsFolderGroup {
		for _, item := range append([]domain.ProcessMapPlacement{sourceFolder}, descendants...) {
			if !r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, item.ResourceType, item.ResourceID) {
				return restore(ErrNotFound)
			}
		}
	}

	if !exists {
		current = domain.ProcessMapPlacement{
			CompanyID: input.CompanyID, ResourceType: resourceType, ResourceID: input.ResourceID,
			PlacementIncarnationToken: newUUIDv7String(), Revision: 1, CreatedTimestamp: now,
		}
	} else {
		current.Revision++
	}
	if parentID == "" {
		current.MapParentFolderID = nil
	} else {
		parentCopy := parentID
		current.MapParentFolderID = &parentCopy
	}
	current.GridX, current.GridY = input.GridX, input.GridY
	current.GridWidth, current.GridHeight = input.GridWidth, input.GridHeight
	current.UpdatedTimestamp = now
	if parentID != "" && !processMapBoundsContain(processMapPlacementBounds(parent), processMapPlacementBounds(current)) {
		return restore(ErrProcessMapContainment)
	}
	if resourceType == domain.ProcessMapResourceTypeFolder {
		folderBounds := processMapPlacementBounds(current)
		for index, descendant := range descendants {
			transformed := descendant
			if movesFolderGroup {
				transformed.GridX += deltaX
				transformed.GridY += deltaY
			} else if resizesFolderGroup {
				transformed = processMapScalePlacementWithinFolder(transformed, sourceFolder, current)
			}
			if !validProcessMapGeometry(transformed.GridX, transformed.GridY, transformed.GridWidth, transformed.GridHeight) {
				return restore(ErrInvalid)
			}
			if !processMapBoundsContain(folderBounds, processMapPlacementBounds(transformed)) {
				return restore(ErrProcessMapContainment)
			}
			descendants[index] = transformed
		}
	}
	if transformsFolderGroup {
		for _, item := range descendants {
			item.Revision++
			item.UpdatedTimestamp = now
			itemKey := processMapPlacementMemoryKey(item.CompanyID, item.ResourceType, item.ResourceID)
			r.processMapPlacements[itemKey] = item
			transformedKeys[itemKey] = true
			changedPlacements = append(changedPlacements, cloneProcessMapPlacement(item))
		}
	}
	r.processMapPlacements[placementKey] = current
	protectedGeometryChanged := false
	if parentChanged {
		r.syncMemoryProcessMapParentToExplorerLocked(input.CompanyID, resourceType, input.ResourceID, desiredParent, now)
		protectedGeometryChanged = processMapAccessAudienceChanged(beforeAudience, r.processMapAccessAudienceLocked(input.CompanyID, audienceResources))
	}
	transformedKeys[placementKey] = true
	changedPlacements = append(changedPlacements, cloneProcessMapPlacement(current))

	changedTraces := []domain.ProcessMapTrace{}
	if transformsFolderGroup {
		for traceKey, trace := range r.processMapTraces {
			relationship, ok := r.resourceOperationalRelationships[traceKey]
			if !ok {
				relationship, ok = r.resourceOperationalRelationships[key(input.CompanyID, trace.ResourceOperationalRelationshipID)]
			}
			if !ok || relationship.CompanyID != input.CompanyID {
				continue
			}
			sourceTransformed := transformedKeys[processMapPlacementMemoryKey(input.CompanyID, relationship.Source.ResourceType, relationship.Source.ResourceID)]
			targetTransformed := transformedKeys[processMapPlacementMemoryKey(input.CompanyID, relationship.Target.ResourceType, relationship.Target.ResourceID)]
			if !sourceTransformed || !targetTransformed {
				continue
			}
			if movesFolderGroup {
				for _, point := range trace.RoutePoints {
					if !validProcessMapCoordinate(point.X+deltaX) || !validProcessMapCoordinate(point.Y+deltaY) {
						return restore(ErrInvalid)
					}
				}
				for index := range trace.RoutePoints {
					trace.RoutePoints[index].X += deltaX
					trace.RoutePoints[index].Y += deltaY
				}
			} else {
				scaled := processMapScaleRoutePointsWithinFolder(trace.RoutePoints, sourceFolder, current)
				if !validProcessMapRoutePoints(scaled) {
					return restore(ErrInvalid)
				}
				if processMapRoutePointsEqual(trace.RoutePoints, scaled) {
					continue
				}
				trace.RoutePoints = scaled
			}
			trace.Revision++
			trace.UpdatedTimestamp = now
			r.processMapTraces[traceKey] = trace
			changedTraces = append(changedTraces, cloneProcessMapTrace(trace))
		}
	}
	slices.SortFunc(changedPlacements, compareProcessMapPlacements)
	slices.SortFunc(changedTraces, func(a, b domain.ProcessMapTrace) int {
		return strings.Compare(a.ResourceOperationalRelationshipID, b.ResourceOperationalRelationshipID)
	})
	eventInputs := []DomainEventInput{processMapMutationEventInput(input.CompanyID, input.ActorUserID, input.RealtimeConnectionID, ProcessMapPlacementSavedEvent, processMapResourceEventPayload(resourceType, input.ResourceID))}
	if parentChanged {
		payload := map[string]any{
			"resource_type": resourceType, "resource_id": input.ResourceID,
			"parent_folder_id": parentID, processMapRealtimeOriginConnectionIDPayloadKey: strings.TrimSpace(input.RealtimeConnectionID),
		}
		eventType := "company_explorer_item_placed"
		if resourceType == domain.ProcessMapResourceTypeFolder {
			eventType = "company_explorer_folder_updated"
			payload["folder_id"] = input.ResourceID
		} else {
			payload["target_type"] = "logic_gate"
			payload["target_id"] = input.ResourceID
		}
		if protectedGeometryChanged {
			payload[processMapProtectedGeometryChangedPayloadKey] = true
		}
		eventInput := workspaceDomainEventInput(input.CompanyID, eventType, payload)
		eventInput.ActorUserID = input.ActorUserID
		eventInputs = append(eventInputs, eventInput)
	}
	events, err := r.appendDomainEventsLocked(eventInputs)
	if err != nil {
		return restore(err)
	}
	readVersion, _ := r.processMapVersionsLocked(input.CompanyID)
	return ProcessMapMutationEnvelope{Placements: changedPlacements, Traces: changedTraces, DeletedTraceIDs: []string{}, ProcessMapReadVersion: readVersion, Created: !exists, Changed: true, Events: events}, nil
}

func (r *MemoryRepo) deleteProcessMapTracesIncidentToResourceLocked(companyID, resourceType, resourceID string) []string {
	deletedTraceIDs := []string{}
	for relationshipKey, relationship := range r.resourceOperationalRelationships {
		if relationship.CompanyID != companyID {
			continue
		}
		if (relationship.Source.ResourceType == resourceType && relationship.Source.ResourceID == resourceID) ||
			(relationship.Target.ResourceType == resourceType && relationship.Target.ResourceID == resourceID) {
			if _, exists := r.processMapTraces[relationshipKey]; exists {
				delete(r.processMapTraces, relationshipKey)
				deletedTraceIDs = append(deletedTraceIDs, relationship.ResourceOperationalRelationshipID)
			}
		}
	}
	slices.Sort(deletedTraceIDs)
	return deletedTraceIDs
}

func (r *MemoryRepo) DeleteProcessMapPlacement(ctx context.Context, input ProcessMapPlacementDeleteInput) (ProcessMapMutationEnvelope, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ResourceID = strings.TrimSpace(input.ResourceID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	resourceType, ok := normalizeProcessMapResourceType(input.ResourceType)
	if input.CompanyID == "" || input.ResourceID == "" || input.ActorUserID == "" || input.PermissionUserID == "" || !ok {
		return ProcessMapMutationEnvelope{}, ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if resourceType == domain.ProcessMapResourceTypeFolder {
		r.mu.Lock()
		_, exists := r.processMapPlacements[processMapPlacementMemoryKey(input.CompanyID, resourceType, input.ResourceID)]
		allowed := exists && r.processMapResourceExistsLocked(input.CompanyID, resourceType, input.ResourceID) &&
			r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, resourceType, input.ResourceID)
		r.mu.Unlock()
		if !allowed {
			return ProcessMapMutationEnvelope{}, ErrNotFound
		}
		deleted, err := r.DeleteCompanyExplorerTargets(input.CompanyID, []CompanyExplorerDeleteTargetInput{{Kind: "folder", ID: input.ResourceID}}, input.ActorUserID)
		if err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
		r.mu.RLock()
		readVersion, _ := r.processMapVersionsLocked(input.CompanyID)
		r.mu.RUnlock()
		return ProcessMapMutationEnvelope{
			Placements: []domain.ProcessMapPlacement{}, Traces: []domain.ProcessMapTrace{}, DeletedTraceIDs: []string{},
			ProcessMapReadVersion: readVersion, Changed: true, Events: deleted.Events,
		}, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotProcessMapMutationLocked()
	restore := func(err error) (ProcessMapMutationEnvelope, error) {
		r.restoreProcessMapMutationLocked(snapshot)
		return ProcessMapMutationEnvelope{}, err
	}
	if !r.processMapResourceExistsLocked(input.CompanyID, resourceType, input.ResourceID) ||
		!r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, resourceType, input.ResourceID) {
		return restore(ErrNotFound)
	}
	placementKey := processMapPlacementMemoryKey(input.CompanyID, resourceType, input.ResourceID)
	_, exists := r.processMapPlacements[placementKey]
	if !exists {
		return restore(ErrNotFound)
	}
	traceIDsBefore := map[string]bool{}
	for _, trace := range r.processMapTraces {
		if trace.CompanyID == input.CompanyID {
			traceIDsBefore[trace.ResourceOperationalRelationshipID] = true
		}
	}
	delete(r.folderItems, folderItemKey(input.CompanyID, "logic_gate", input.ResourceID))
	for edgeKey, edge := range r.companyExplorerV2Edges {
		if edge.CompanyID == input.CompanyID && edge.ChildEntityID == input.ResourceID {
			delete(r.companyExplorerV2Edges, edgeKey)
		}
	}
	r.deleteProcessMapTracesIncidentToResourceLocked(input.CompanyID, resourceType, input.ResourceID)
	delete(r.processMapPlacements, placementKey)
	deletedTraceIDs := []string{}
	for traceID := range traceIDsBefore {
		if _, exists := r.processMapTraces[key(input.CompanyID, traceID)]; !exists {
			deletedTraceIDs = append(deletedTraceIDs, traceID)
		}
	}
	slices.Sort(deletedTraceIDs)
	eventInputs := []DomainEventInput{processMapMutationEventInput(input.CompanyID, input.ActorUserID, input.RealtimeConnectionID, ProcessMapPlacementDeletedEvent, processMapResourceEventPayload(resourceType, input.ResourceID))}
	payload := map[string]any{
		"resource_type": resourceType, "resource_id": input.ResourceID,
		processMapRealtimeOriginConnectionIDPayloadKey: strings.TrimSpace(input.RealtimeConnectionID),
	}
	eventType := "company_explorer_item_removed"
	payload["target_type"] = "logic_gate"
	payload["target_id"] = input.ResourceID
	explorerEvent := workspaceDomainEventInput(input.CompanyID, eventType, payload)
	explorerEvent.ActorUserID = input.ActorUserID
	eventInputs = append(eventInputs, explorerEvent)
	events, err := r.appendDomainEventsLocked(eventInputs)
	if err != nil {
		return restore(err)
	}
	readVersion, _ := r.processMapVersionsLocked(input.CompanyID)
	return ProcessMapMutationEnvelope{Placements: []domain.ProcessMapPlacement{}, Traces: []domain.ProcessMapTrace{}, DeletedTraceIDs: deletedTraceIDs, ProcessMapReadVersion: readVersion, Changed: true, Events: events}, nil
}

func (r *MemoryRepo) processMapRelationshipBySemanticLocked(companyID string, source, target domain.ProcessMapResourceRef) (domain.ResourceOperationalRelationship, bool) {
	for _, item := range r.resourceOperationalRelationships {
		if item.CompanyID == companyID && item.Source == source && item.Target == target {
			return item, true
		}
	}
	return domain.ResourceOperationalRelationship{}, false
}

func (r *MemoryRepo) validateProcessMapTraceEndpointsLocked(companyID string, relationship domain.ResourceOperationalRelationship) error {
	_, sourceOK := r.processMapPlacements[processMapPlacementMemoryKey(companyID, relationship.Source.ResourceType, relationship.Source.ResourceID)]
	_, targetOK := r.processMapPlacements[processMapPlacementMemoryKey(companyID, relationship.Target.ResourceType, relationship.Target.ResourceID)]
	if !sourceOK || !targetOK {
		return ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) upsertProcessMapTraceLocked(companyID string, relationship domain.ResourceOperationalRelationship, points []domain.ProcessMapRoutePoint) (domain.ProcessMapTrace, bool) {
	traceKey := key(companyID, relationship.ResourceOperationalRelationshipID)
	current, exists := r.processMapTraces[traceKey]
	if exists && processMapRoutePointsEqual(current.RoutePoints, points) {
		return cloneProcessMapTrace(current), false
	}
	now := time.Now().UTC()
	if !exists {
		current = domain.ProcessMapTrace{CompanyID: companyID, ResourceOperationalRelationshipID: relationship.ResourceOperationalRelationshipID, Revision: 1, CreatedTimestamp: now}
	} else {
		current.Revision++
	}
	current.RoutePoints = cloneProcessMapRoutePoints(points)
	current.UpdatedTimestamp = now
	r.processMapTraces[traceKey] = current
	return cloneProcessMapTrace(current), true
}

func (r *MemoryRepo) CreateResourceOperationalRelationship(ctx context.Context, input ResourceOperationalRelationshipCreateInput) (ProcessMapMutationEnvelope, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	input.Source.ResourceID = strings.TrimSpace(input.Source.ResourceID)
	input.Target.ResourceID = strings.TrimSpace(input.Target.ResourceID)
	sourceType, sourceOK := normalizeProcessMapResourceType(input.Source.ResourceType)
	targetType, targetOK := normalizeProcessMapResourceType(input.Target.ResourceType)
	input.Source.ResourceType, input.Target.ResourceType = sourceType, targetType
	if input.CompanyID == "" || input.ActorUserID == "" || input.PermissionUserID == "" || input.Source.ResourceID == "" || input.Target.ResourceID == "" ||
		!sourceOK || !targetOK || input.Source == input.Target || (input.Trace != nil && !validProcessMapRoutePoints(input.Trace.RoutePoints)) {
		return ProcessMapMutationEnvelope{}, ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotProcessMapMutationLocked()
	restore := func(err error) (ProcessMapMutationEnvelope, error) {
		r.restoreProcessMapMutationLocked(snapshot)
		return ProcessMapMutationEnvelope{}, err
	}
	for _, endpoint := range []domain.ProcessMapResourceRef{input.Source, input.Target} {
		if !r.processMapResourceExistsLocked(input.CompanyID, endpoint.ResourceType, endpoint.ResourceID) ||
			!r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, endpoint.ResourceType, endpoint.ResourceID) {
			return restore(ErrNotFound)
		}
	}
	relationship, exists := r.processMapRelationshipBySemanticLocked(input.CompanyID, input.Source, input.Target)
	created := !exists
	if !exists {
		relationship = domain.ResourceOperationalRelationship{CompanyID: input.CompanyID, ResourceOperationalRelationshipID: newUUIDv7String(), Source: input.Source, Target: input.Target, CreatedTimestamp: time.Now().UTC()}
		r.resourceOperationalRelationships[key(input.CompanyID, relationship.ResourceOperationalRelationshipID)] = relationship
	}
	eventInputs := []DomainEventInput{}
	if created {
		eventInputs = append(eventInputs, processMapMutationEventInput(input.CompanyID, input.ActorUserID, input.RealtimeConnectionID, ResourceOperationalRelationshipCreatedEvent, processMapRelationshipEventPayload(relationship)))
	}
	changedTraces := []domain.ProcessMapTrace{}
	changed := created
	if input.Trace != nil {
		if err := r.validateProcessMapTraceEndpointsLocked(input.CompanyID, relationship); err != nil {
			return restore(err)
		}
		trace, traceChanged := r.upsertProcessMapTraceLocked(input.CompanyID, relationship, input.Trace.RoutePoints)
		changed = changed || traceChanged
		changedTraces = append(changedTraces, trace)
		if traceChanged {
			eventInputs = append(eventInputs, processMapMutationEventInput(input.CompanyID, input.ActorUserID, input.RealtimeConnectionID, ProcessMapTraceSavedEvent, processMapRelationshipEventPayload(relationship)))
		}
	}
	events := []domain.DomainEvent{}
	var err error
	if len(eventInputs) > 0 {
		events, err = r.appendDomainEventsLocked(eventInputs)
		if err != nil {
			return restore(err)
		}
	}
	readVersion, _ := r.processMapVersionsLocked(input.CompanyID)
	return ProcessMapMutationEnvelope{Placements: []domain.ProcessMapPlacement{}, Traces: changedTraces, DeletedTraceIDs: []string{}, ProcessMapReadVersion: readVersion, Relationship: &relationship, Created: created, Changed: changed, Events: events}, nil
}

func (r *MemoryRepo) PutProcessMapTrace(ctx context.Context, input ProcessMapTracePutInput) (ProcessMapMutationEnvelope, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ResourceOperationalRelationshipID = strings.TrimSpace(input.ResourceOperationalRelationshipID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	if input.CompanyID == "" || input.ActorUserID == "" || input.PermissionUserID == "" || input.ResourceOperationalRelationshipID == "" || !validProcessMapRoutePoints(input.RoutePoints) {
		return ProcessMapMutationEnvelope{}, ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotProcessMapMutationLocked()
	restore := func(err error) (ProcessMapMutationEnvelope, error) {
		r.restoreProcessMapMutationLocked(snapshot)
		return ProcessMapMutationEnvelope{}, err
	}
	relationship, exists := r.resourceOperationalRelationships[key(input.CompanyID, input.ResourceOperationalRelationshipID)]
	if !exists {
		return restore(ErrNotFound)
	}
	for _, endpoint := range []domain.ProcessMapResourceRef{relationship.Source, relationship.Target} {
		if !r.processMapResourceExistsLocked(input.CompanyID, endpoint.ResourceType, endpoint.ResourceID) || !r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, endpoint.ResourceType, endpoint.ResourceID) {
			return restore(ErrNotFound)
		}
	}
	if err := r.validateProcessMapTraceEndpointsLocked(input.CompanyID, relationship); err != nil {
		return restore(err)
	}
	trace, changed := r.upsertProcessMapTraceLocked(input.CompanyID, relationship, input.RoutePoints)
	events := []domain.DomainEvent{}
	var err error
	if changed {
		events, err = r.appendDomainEventsLocked([]DomainEventInput{processMapMutationEventInput(input.CompanyID, input.ActorUserID, input.RealtimeConnectionID, ProcessMapTraceSavedEvent, processMapRelationshipEventPayload(relationship))})
		if err != nil {
			return restore(err)
		}
	}
	readVersion, _ := r.processMapVersionsLocked(input.CompanyID)
	return ProcessMapMutationEnvelope{Placements: []domain.ProcessMapPlacement{}, Traces: []domain.ProcessMapTrace{trace}, DeletedTraceIDs: []string{}, ProcessMapReadVersion: readVersion, Relationship: &relationship, Changed: changed, Events: events}, nil
}

func (r *MemoryRepo) DeleteResourceOperationalRelationship(ctx context.Context, input ResourceOperationalRelationshipDeleteInput) (ProcessMapMutationEnvelope, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ResourceOperationalRelationshipID = strings.TrimSpace(input.ResourceOperationalRelationshipID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	if input.CompanyID == "" || input.ActorUserID == "" || input.PermissionUserID == "" || input.ResourceOperationalRelationshipID == "" {
		return ProcessMapMutationEnvelope{}, ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotProcessMapMutationLocked()
	restore := func(err error) (ProcessMapMutationEnvelope, error) {
		r.restoreProcessMapMutationLocked(snapshot)
		return ProcessMapMutationEnvelope{}, err
	}
	relationshipKey := key(input.CompanyID, input.ResourceOperationalRelationshipID)
	relationship, exists := r.resourceOperationalRelationships[relationshipKey]
	if !exists {
		return restore(ErrNotFound)
	}
	for _, endpoint := range []domain.ProcessMapResourceRef{relationship.Source, relationship.Target} {
		if !r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, endpoint.ResourceType, endpoint.ResourceID) {
			return restore(ErrNotFound)
		}
	}
	delete(r.processMapTraces, relationshipKey)
	delete(r.resourceOperationalRelationships, relationshipKey)
	events, err := r.appendDomainEventsLocked([]DomainEventInput{processMapMutationEventInput(input.CompanyID, input.ActorUserID, input.RealtimeConnectionID, ResourceOperationalRelationshipDeletedEvent, processMapRelationshipEventPayload(relationship))})
	if err != nil {
		return restore(err)
	}
	readVersion, _ := r.processMapVersionsLocked(input.CompanyID)
	return ProcessMapMutationEnvelope{Placements: []domain.ProcessMapPlacement{}, Traces: []domain.ProcessMapTrace{}, DeletedTraceIDs: []string{}, ProcessMapReadVersion: readVersion, Relationship: &relationship, Changed: true, Events: events}, nil
}

// deleteProcessMapResourceLocked is the typed lifecycle cleanup path. A source
// Folder deletion reparents surviving direct map children without granting or
// disclosing access; endpoint deletion still removes its exact relationships.
func (r *MemoryRepo) deleteProcessMapResourceLocked(companyID, resourceType, resourceID string) {
	placementKey := processMapPlacementMemoryKey(companyID, resourceType, resourceID)
	placement, mapped := r.processMapPlacements[placementKey]
	if resourceType == domain.ProcessMapResourceTypeFolder && mapped {
		now := time.Now().UTC()
		for childKey, child := range r.processMapPlacements {
			if child.CompanyID != companyID || child.MapParentFolderID == nil || strings.TrimSpace(*child.MapParentFolderID) != resourceID {
				continue
			}
			if placement.MapParentFolderID == nil {
				child.MapParentFolderID = nil
			} else {
				parentID := *placement.MapParentFolderID
				child.MapParentFolderID = &parentID
			}
			child.Revision++
			child.UpdatedTimestamp = now
			r.processMapPlacements[childKey] = child
		}
	}
	r.deleteProcessMapTracesIncidentToResourceLocked(companyID, resourceType, resourceID)
	delete(r.processMapPlacements, placementKey)
	for relationshipKey, relationship := range r.resourceOperationalRelationships {
		if relationship.CompanyID != companyID {
			continue
		}
		if (relationship.Source.ResourceType == resourceType && relationship.Source.ResourceID == resourceID) ||
			(relationship.Target.ResourceType == resourceType && relationship.Target.ResourceID == resourceID) {
			delete(r.processMapTraces, relationshipKey)
			delete(r.resourceOperationalRelationships, relationshipKey)
		}
	}
}
