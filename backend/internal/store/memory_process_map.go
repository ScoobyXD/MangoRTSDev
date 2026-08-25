package store

import (
	"maps"
	"miraeopus/backend/internal/domain"
	"slices"
	"strings"
	"time"
)

func processMapPlacementMemoryKey(companyID, resourceType, resourceID string) string {
	return companyID + ":" + resourceType + ":" + resourceID
}

func sameProcessMapLayer(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return strings.TrimSpace(*a) == strings.TrimSpace(*b)
}

func cloneProcessMapRoutePoints(points []domain.ProcessMapRoutePoint) []domain.ProcessMapRoutePoint {
	return append([]domain.ProcessMapRoutePoint{}, points...)
}

func cloneProcessMapTrace(item domain.ProcessMapTrace) domain.ProcessMapTrace {
	item.RoutePoints = cloneProcessMapRoutePoints(item.RoutePoints)
	return item
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

func (r *MemoryRepo) GetProcessMapLayer(input ProcessMapLayerQuery) (domain.ProcessMapLayerView, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.FolderID = strings.TrimSpace(input.FolderID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	if input.CompanyID == "" || input.PermissionUserID == "" {
		return domain.ProcessMapLayerView{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	view := domain.ProcessMapLayerView{
		Layer:      domain.ProcessMapLayer{Kind: "root"},
		Placements: []domain.ProcessMapLayerPlacement{},
		Traces:     []domain.ProcessMapLayerTrace{},
	}
	if input.FolderID != "" {
		name, exists := r.processMapResourceNameLocked(input.CompanyID, domain.ProcessMapResourceTypeFolder, input.FolderID)
		if !exists || !r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, domain.ProcessMapResourceTypeFolder, input.FolderID) {
			return domain.ProcessMapLayerView{}, ErrNotFound
		}
		view.Layer = domain.ProcessMapLayer{Kind: "folder", FolderID: input.FolderID, Name: name}
	}

	visible := map[string]bool{}
	placements := make([]domain.ProcessMapPlacement, 0)
	for _, placement := range r.processMapPlacements {
		if placement.CompanyID != input.CompanyID {
			continue
		}
		if input.FolderID == "" {
			if placement.MapParentFolderID != nil {
				continue
			}
		} else if placement.MapParentFolderID == nil || strings.TrimSpace(*placement.MapParentFolderID) != input.FolderID {
			continue
		}
		placements = append(placements, placement)
	}
	slices.SortFunc(placements, func(a, b domain.ProcessMapPlacement) int {
		if a.GridY != b.GridY {
			return a.GridY - b.GridY
		}
		if a.GridX != b.GridX {
			return a.GridX - b.GridX
		}
		if byType := strings.Compare(a.ResourceType, b.ResourceType); byType != 0 {
			return byType
		}
		return strings.Compare(a.ResourceID, b.ResourceID)
	})
	for _, placement := range placements {
		placementKey := processMapPlacementMemoryKey(placement.CompanyID, placement.ResourceType, placement.ResourceID)
		if !r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, placement.ResourceType, placement.ResourceID) {
			view.Placements = append(view.Placements, domain.ProcessMapRestrictedPlacement{Restricted: true, GridX: placement.GridX, GridY: placement.GridY})
			continue
		}
		name, exists := r.processMapResourceNameLocked(input.CompanyID, placement.ResourceType, placement.ResourceID)
		if !exists {
			continue
		}
		visible[placementKey] = true
		view.Placements = append(view.Placements, domain.ProcessMapVisiblePlacement{
			Restricted: false, ResourceType: placement.ResourceType, ResourceID: placement.ResourceID, Name: name,
			GridX: placement.GridX, GridY: placement.GridY, Revision: placement.Revision,
			CreatedTimestamp: placement.CreatedTimestamp, UpdatedTimestamp: placement.UpdatedTimestamp,
		})
	}

	for _, trace := range r.processMapTraces {
		if trace.CompanyID != input.CompanyID {
			continue
		}
		relationship, ok := r.resourceOperationalRelationships[key(input.CompanyID, trace.ResourceOperationalRelationshipID)]
		if !ok {
			continue
		}
		sourceKey := processMapPlacementMemoryKey(input.CompanyID, relationship.Source.ResourceType, relationship.Source.ResourceID)
		targetKey := processMapPlacementMemoryKey(input.CompanyID, relationship.Target.ResourceType, relationship.Target.ResourceID)
		if !visible[sourceKey] || !visible[targetKey] {
			continue
		}
		view.Traces = append(view.Traces, domain.ProcessMapLayerTrace{
			ResourceOperationalRelationshipID: relationship.ResourceOperationalRelationshipID,
			Source:                            relationship.Source, Target: relationship.Target,
			RoutePoints: cloneProcessMapRoutePoints(trace.RoutePoints), Revision: trace.Revision,
			CreatedTimestamp: trace.CreatedTimestamp, UpdatedTimestamp: trace.UpdatedTimestamp,
		})
	}
	slices.SortFunc(view.Traces, func(a, b domain.ProcessMapLayerTrace) int {
		return strings.Compare(a.ResourceOperationalRelationshipID, b.ResourceOperationalRelationshipID)
	})
	return view, nil
}

func (r *MemoryRepo) ListResourceOperationalRelationshipsForResource(input ResourceOperationalRelationshipQuery) ([]domain.ResourceOperationalRelationship, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ResourceID = strings.TrimSpace(input.ResourceID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	resourceType, typeOK := normalizeProcessMapResourceType(input.ResourceType)
	direction, directionOK := normalizeProcessMapDirection(input.Direction)
	if input.CompanyID == "" || input.ResourceID == "" || input.PermissionUserID == "" || !typeOK || !directionOK {
		return nil, ErrInvalid
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
	placements     map[string]domain.ProcessMapPlacement
	relationships  map[string]domain.ResourceOperationalRelationship
	traces         map[string]domain.ProcessMapTrace
	events         map[string]domain.DomainEvent
	versions       map[string]int64
	outbox         map[string]RealtimeOutboxEvent
	outboxSequence int64
}

func (r *MemoryRepo) snapshotProcessMapMutationLocked() memoryProcessMapMutationSnapshot {
	return memoryProcessMapMutationSnapshot{
		placements: maps.Clone(r.processMapPlacements), relationships: maps.Clone(r.resourceOperationalRelationships),
		traces: maps.Clone(r.processMapTraces), events: maps.Clone(r.domainEvents), versions: maps.Clone(r.workspaceReadVersions),
		outbox: maps.Clone(r.realtimeOutbox), outboxSequence: r.realtimeOutboxSequence,
	}
}

func (r *MemoryRepo) restoreProcessMapMutationLocked(snapshot memoryProcessMapMutationSnapshot) {
	r.processMapPlacements = snapshot.placements
	r.resourceOperationalRelationships = snapshot.relationships
	r.processMapTraces = snapshot.traces
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

func (r *MemoryRepo) PutProcessMapPlacement(input ProcessMapPlacementPutInput) (ProcessMapPlacementMutationResult, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ResourceID = strings.TrimSpace(input.ResourceID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	resourceType, ok := normalizeProcessMapResourceType(input.ResourceType)
	if input.CompanyID == "" || input.ResourceID == "" || input.ActorUserID == "" || input.PermissionUserID == "" || !ok || !validProcessMapCoordinate(input.GridX) || !validProcessMapCoordinate(input.GridY) {
		return ProcessMapPlacementMutationResult{}, ErrInvalid
	}
	var parentID string
	if input.MapParentFolderID != nil {
		parentID = strings.TrimSpace(*input.MapParentFolderID)
		if parentID == "" {
			return ProcessMapPlacementMutationResult{}, ErrInvalid
		}
	} else if resourceType == domain.ProcessMapResourceTypeProcess {
		return ProcessMapPlacementMutationResult{}, ErrProcessMapRootProcess
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotProcessMapMutationLocked()
	restore := func(err error) (ProcessMapPlacementMutationResult, error) {
		r.restoreProcessMapMutationLocked(snapshot)
		return ProcessMapPlacementMutationResult{}, err
	}
	if !r.processMapResourceExistsLocked(input.CompanyID, resourceType, input.ResourceID) ||
		!r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, resourceType, input.ResourceID) {
		return restore(ErrNotFound)
	}
	if parentID != "" {
		if !r.processMapResourceExistsLocked(input.CompanyID, domain.ProcessMapResourceTypeFolder, parentID) ||
			!r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, domain.ProcessMapResourceTypeFolder, parentID) {
			return restore(ErrNotFound)
		}
	}
	if resourceType == domain.ProcessMapResourceTypeFolder && parentID == input.ResourceID {
		return restore(ErrProcessMapCycle)
	}
	if resourceType == domain.ProcessMapResourceTypeFolder && r.processMapFolderCycleLocked(input.CompanyID, input.ResourceID, parentID) {
		return restore(ErrProcessMapCycle)
	}

	placementKey := processMapPlacementMemoryKey(input.CompanyID, resourceType, input.ResourceID)
	current, exists := r.processMapPlacements[placementKey]
	now := time.Now().UTC()
	created := !exists
	parentChanged := exists && !sameProcessMapLayer(current.MapParentFolderID, input.MapParentFolderID)
	if !exists {
		current = domain.ProcessMapPlacement{CompanyID: input.CompanyID, ResourceType: resourceType, ResourceID: input.ResourceID, Revision: 1, CreatedTimestamp: now}
	} else {
		current.Revision++
	}
	if input.MapParentFolderID == nil {
		current.MapParentFolderID = nil
	} else {
		parentCopy := parentID
		current.MapParentFolderID = &parentCopy
	}
	current.GridX = input.GridX
	current.GridY = input.GridY
	current.UpdatedTimestamp = now
	r.processMapPlacements[placementKey] = current
	if parentChanged {
		r.deleteProcessMapTracesIncidentToResourceLocked(input.CompanyID, resourceType, input.ResourceID)
	}
	eventInput := processMapMutationEventInput(input.CompanyID, input.ActorUserID, input.RealtimeConnectionID, ProcessMapPlacementSavedEvent, processMapResourceEventPayload(resourceType, input.ResourceID))
	events, err := r.appendDomainEventsLocked([]DomainEventInput{eventInput})
	if err != nil {
		return restore(err)
	}
	return ProcessMapPlacementMutationResult{Placement: current, Created: created, Events: events}, nil
}

func (r *MemoryRepo) deleteProcessMapTracesIncidentToResourceLocked(companyID, resourceType, resourceID string) {
	for relationshipKey, relationship := range r.resourceOperationalRelationships {
		if relationship.CompanyID != companyID {
			continue
		}
		if (relationship.Source.ResourceType == resourceType && relationship.Source.ResourceID == resourceID) ||
			(relationship.Target.ResourceType == resourceType && relationship.Target.ResourceID == resourceID) {
			delete(r.processMapTraces, relationshipKey)
		}
	}
}

func (r *MemoryRepo) DeleteProcessMapPlacement(input ProcessMapPlacementDeleteInput) (ProcessMapPlacementDeleteResult, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ResourceID = strings.TrimSpace(input.ResourceID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	resourceType, ok := normalizeProcessMapResourceType(input.ResourceType)
	if input.CompanyID == "" || input.ResourceID == "" || input.ActorUserID == "" || input.PermissionUserID == "" || !ok {
		return ProcessMapPlacementDeleteResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotProcessMapMutationLocked()
	restore := func(err error) (ProcessMapPlacementDeleteResult, error) {
		r.restoreProcessMapMutationLocked(snapshot)
		return ProcessMapPlacementDeleteResult{}, err
	}
	if !r.processMapResourceExistsLocked(input.CompanyID, resourceType, input.ResourceID) ||
		!r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, resourceType, input.ResourceID) {
		return restore(ErrNotFound)
	}
	placementKey := processMapPlacementMemoryKey(input.CompanyID, resourceType, input.ResourceID)
	if _, exists := r.processMapPlacements[placementKey]; !exists {
		return restore(ErrNotFound)
	}
	r.deleteProcessMapTracesIncidentToResourceLocked(input.CompanyID, resourceType, input.ResourceID)
	delete(r.processMapPlacements, placementKey)
	events, err := r.appendDomainEventsLocked([]DomainEventInput{processMapMutationEventInput(input.CompanyID, input.ActorUserID, input.RealtimeConnectionID, ProcessMapPlacementDeletedEvent, processMapResourceEventPayload(resourceType, input.ResourceID))})
	if err != nil {
		return restore(err)
	}
	return ProcessMapPlacementDeleteResult{Events: events}, nil
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
	source, sourceOK := r.processMapPlacements[processMapPlacementMemoryKey(companyID, relationship.Source.ResourceType, relationship.Source.ResourceID)]
	target, targetOK := r.processMapPlacements[processMapPlacementMemoryKey(companyID, relationship.Target.ResourceType, relationship.Target.ResourceID)]
	if !sourceOK || !targetOK || !sameProcessMapLayer(source.MapParentFolderID, target.MapParentFolderID) {
		return ErrProcessMapLayerMismatch
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

func (r *MemoryRepo) CreateResourceOperationalRelationship(input ResourceOperationalRelationshipCreateInput) (ResourceOperationalRelationshipMutationResult, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	input.Source.ResourceID = strings.TrimSpace(input.Source.ResourceID)
	input.Target.ResourceID = strings.TrimSpace(input.Target.ResourceID)
	sourceType, sourceOK := normalizeProcessMapResourceType(input.Source.ResourceType)
	targetType, targetOK := normalizeProcessMapResourceType(input.Target.ResourceType)
	input.Source.ResourceType = sourceType
	input.Target.ResourceType = targetType
	if input.CompanyID == "" || input.ActorUserID == "" || input.PermissionUserID == "" || input.Source.ResourceID == "" || input.Target.ResourceID == "" || !sourceOK || !targetOK ||
		(input.Source == input.Target) || (input.Trace != nil && !validProcessMapRoutePoints(input.Trace.RoutePoints)) {
		return ResourceOperationalRelationshipMutationResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotProcessMapMutationLocked()
	restore := func(err error) (ResourceOperationalRelationshipMutationResult, error) {
		r.restoreProcessMapMutationLocked(snapshot)
		return ResourceOperationalRelationshipMutationResult{}, err
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
		relationship = domain.ResourceOperationalRelationship{
			CompanyID: input.CompanyID, ResourceOperationalRelationshipID: newUUIDv7String(),
			Source: input.Source, Target: input.Target, CreatedTimestamp: time.Now().UTC(),
		}
		r.resourceOperationalRelationships[key(input.CompanyID, relationship.ResourceOperationalRelationshipID)] = relationship
	}
	result := ResourceOperationalRelationshipMutationResult{Relationship: relationship, RelationshipCreated: created}
	eventInputs := []DomainEventInput{}
	if created {
		eventInputs = append(eventInputs, processMapMutationEventInput(input.CompanyID, input.ActorUserID, input.RealtimeConnectionID, ResourceOperationalRelationshipCreatedEvent, map[string]any{"resource_operational_relationship_id": relationship.ResourceOperationalRelationshipID}))
	}
	if input.Trace != nil {
		if err := r.validateProcessMapTraceEndpointsLocked(input.CompanyID, relationship); err != nil {
			return restore(err)
		}
		trace, changed := r.upsertProcessMapTraceLocked(input.CompanyID, relationship, input.Trace.RoutePoints)
		result.Trace = &trace
		result.TraceChanged = changed
		if changed {
			eventInputs = append(eventInputs, processMapMutationEventInput(input.CompanyID, input.ActorUserID, input.RealtimeConnectionID, ProcessMapTraceSavedEvent, map[string]any{"resource_operational_relationship_id": relationship.ResourceOperationalRelationshipID}))
		}
	}
	if len(eventInputs) > 0 {
		events, err := r.appendDomainEventsLocked(eventInputs)
		if err != nil {
			return restore(err)
		}
		result.Events = events
	}
	return result, nil
}

func (r *MemoryRepo) PutProcessMapTrace(input ProcessMapTracePutInput) (ProcessMapTraceMutationResult, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ResourceOperationalRelationshipID = strings.TrimSpace(input.ResourceOperationalRelationshipID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	if input.CompanyID == "" || input.ActorUserID == "" || input.PermissionUserID == "" || input.ResourceOperationalRelationshipID == "" || !validProcessMapRoutePoints(input.RoutePoints) {
		return ProcessMapTraceMutationResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotProcessMapMutationLocked()
	restore := func(err error) (ProcessMapTraceMutationResult, error) {
		r.restoreProcessMapMutationLocked(snapshot)
		return ProcessMapTraceMutationResult{}, err
	}
	relationship, exists := r.resourceOperationalRelationships[key(input.CompanyID, input.ResourceOperationalRelationshipID)]
	if !exists {
		return restore(ErrNotFound)
	}
	for _, endpoint := range []domain.ProcessMapResourceRef{relationship.Source, relationship.Target} {
		if !r.processMapResourceExistsLocked(input.CompanyID, endpoint.ResourceType, endpoint.ResourceID) ||
			!r.processMapResourceAllowedLocked(input.CompanyID, input.PermissionUserID, endpoint.ResourceType, endpoint.ResourceID) {
			return restore(ErrNotFound)
		}
	}
	if err := r.validateProcessMapTraceEndpointsLocked(input.CompanyID, relationship); err != nil {
		return restore(err)
	}
	trace, changed := r.upsertProcessMapTraceLocked(input.CompanyID, relationship, input.RoutePoints)
	result := ProcessMapTraceMutationResult{Trace: trace, Changed: changed}
	if changed {
		events, err := r.appendDomainEventsLocked([]DomainEventInput{processMapMutationEventInput(input.CompanyID, input.ActorUserID, input.RealtimeConnectionID, ProcessMapTraceSavedEvent, map[string]any{"resource_operational_relationship_id": relationship.ResourceOperationalRelationshipID})})
		if err != nil {
			return restore(err)
		}
		result.Events = events
	}
	return result, nil
}

func (r *MemoryRepo) DeleteResourceOperationalRelationship(input ResourceOperationalRelationshipDeleteInput) (ResourceOperationalRelationshipDeleteResult, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ResourceOperationalRelationshipID = strings.TrimSpace(input.ResourceOperationalRelationshipID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	if input.CompanyID == "" || input.ActorUserID == "" || input.PermissionUserID == "" || input.ResourceOperationalRelationshipID == "" {
		return ResourceOperationalRelationshipDeleteResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotProcessMapMutationLocked()
	restore := func(err error) (ResourceOperationalRelationshipDeleteResult, error) {
		r.restoreProcessMapMutationLocked(snapshot)
		return ResourceOperationalRelationshipDeleteResult{}, err
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
	events, err := r.appendDomainEventsLocked([]DomainEventInput{processMapMutationEventInput(input.CompanyID, input.ActorUserID, input.RealtimeConnectionID, ResourceOperationalRelationshipDeletedEvent, map[string]any{"resource_operational_relationship_id": input.ResourceOperationalRelationshipID})})
	if err != nil {
		return restore(err)
	}
	return ResourceOperationalRelationshipDeleteResult{Events: events}, nil
}

// deleteProcessMapResourceLocked is the single memory cleanup path for a
// permanently removed Folder or Process. Folder-owned child placements lose
// only placement/trace geometry; relationships between surviving children stay.
func (r *MemoryRepo) deleteProcessMapResourceLocked(companyID, resourceType, resourceID string) {
	if resourceType == domain.ProcessMapResourceTypeFolder {
		for placementKey, placement := range r.processMapPlacements {
			if placement.CompanyID == companyID && placement.MapParentFolderID != nil && strings.TrimSpace(*placement.MapParentFolderID) == resourceID {
				r.deleteProcessMapTracesIncidentToResourceLocked(companyID, placement.ResourceType, placement.ResourceID)
				delete(r.processMapPlacements, placementKey)
			}
		}
	}
	r.deleteProcessMapTracesIncidentToResourceLocked(companyID, resourceType, resourceID)
	delete(r.processMapPlacements, processMapPlacementMemoryKey(companyID, resourceType, resourceID))
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
