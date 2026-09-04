package store

import (
	"context"
	"miraeopus/backend/internal/domain"
	"slices"
)

func (r *MemoryRepo) GetProcessMapChanges(ctx context.Context, input ProcessMapChangesQuery) (ProcessMapChanges, error) {
	companyID, userID, err := normalizeMemoryProcessMapRead(input.CompanyID, input.PermissionUserID)
	if err != nil {
		return ProcessMapChanges{}, err
	}
	input.CompanyID, input.PermissionUserID = companyID, userID
	if err := ctx.Err(); err != nil {
		return ProcessMapChanges{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.userHasCompanyMembershipLocked(companyID, userID) {
		return ProcessMapChanges{}, ErrNotFound
	}
	version, _ := r.processMapVersionsLocked(companyID)
	minimumVersion, err := validateProcessMapChangesQuery(input, version)
	if err != nil {
		return ProcessMapChanges{}, err
	}
	scene := r.processMapSceneLocked(companyID, userID)
	events := []domain.DomainEvent{}
	for _, event := range r.domainEvents {
		if event.CompanyID == companyID && isWorkspaceStreamDomainEvent(event) && event.Sequence > minimumVersion && event.Sequence <= version {
			events = append(events, event)
		}
	}
	slices.SortFunc(events, func(left, right domain.DomainEvent) int {
		if left.Sequence < right.Sequence {
			return -1
		}
		if left.Sequence > right.Sequence {
			return 1
		}
		return 0
	})
	if len(events) > processMapMaxReplayEvents {
		events = events[:processMapMaxReplayEvents]
	}
	access := map[domain.ProcessMapResourceRef]bool{}
	return validateProcessMapCachedTiles(input, scene, events, minimumVersion, func(event domain.DomainEvent) (processMapDamage, bool, error) {
		if err := ctx.Err(); err != nil {
			return processMapDamage{}, false, err
		}
		damage, selective := processMapEventDamage(event)
		if !selective {
			if ref, ok := processMapPresentationEventResource(event); ok {
				damage, selective = newProcessMapDamage(), true
				if placement, exists := r.processMapPlacements[processMapPlacementMemoryKey(companyID, ref.ResourceType, ref.ResourceID)]; exists {
					damage.addPlacement(placement)
				}
			}
		}
		if !selective {
			return damage, false, nil
		}
		for _, ref := range damage.Resources {
			allowed, checked := access[ref]
			if !checked {
				allowed = r.processMapResourceAllowedLocked(companyID, userID, ref.ResourceType, ref.ResourceID)
				access[ref] = allowed
			}
			if !allowed {
				return damage, false, nil
			}
		}
		return damage, true, nil
	})
}

func memoryProcessMapDamage(companyID string, resources []domain.ProcessMapResourceRef, relationshipID string,
	placements map[string]domain.ProcessMapPlacement, relationships map[string]domain.ResourceOperationalRelationship, traces map[string]domain.ProcessMapTrace) processMapDamage {
	damage := newProcessMapDamage()
	affected := map[domain.ProcessMapResourceRef]bool{}
	for _, ref := range resources {
		affected[ref] = true
		if placement, exists := placements[processMapPlacementMemoryKey(companyID, ref.ResourceType, ref.ResourceID)]; exists {
			damage.addPlacement(placement)
		}
	}
	for _, relationship := range relationships {
		if relationship.CompanyID != companyID || (relationship.ResourceOperationalRelationshipID != relationshipID && !affected[relationship.Source] && !affected[relationship.Target]) {
			continue
		}
		trace, traced := traces[key(companyID, relationship.ResourceOperationalRelationshipID)]
		source, sourceExists := placements[processMapPlacementMemoryKey(companyID, relationship.Source.ResourceType, relationship.Source.ResourceID)]
		target, targetExists := placements[processMapPlacementMemoryKey(companyID, relationship.Target.ResourceType, relationship.Target.ResourceID)]
		if traced && sourceExists && targetExists {
			damage.addTrace(relationship, source, target, trace)
		}
	}
	return damage
}

func (r *MemoryRepo) attachProcessMapMutationDamageLocked(inputs []DomainEventInput, before memoryProcessMapMutationSnapshot, companyID string, resources []domain.ProcessMapResourceRef, relationshipID string) {
	attachProcessMapDamage(inputs,
		memoryProcessMapDamage(companyID, resources, relationshipID, before.placements, before.relationships, before.traces),
		memoryProcessMapDamage(companyID, resources, relationshipID, r.processMapPlacements, r.resourceOperationalRelationships, r.processMapTraces))
}
