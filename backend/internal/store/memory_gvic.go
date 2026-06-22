package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func gvicSourceAssignmentKey(companyID, resourceType, resourceID, role, principalType, principalID string) string {
	return strings.Join([]string{
		strings.TrimSpace(companyID),
		strings.TrimSpace(resourceType),
		strings.TrimSpace(resourceID),
		strings.TrimSpace(role),
		strings.TrimSpace(principalType),
		strings.TrimSpace(principalID),
	}, ":")
}

func gvicEffectiveAssignmentKey(item domain.ResourceGVICEffectiveAssignment) string {
	return strings.Join([]string{
		strings.TrimSpace(item.CompanyID),
		strings.TrimSpace(item.ResourceType),
		strings.TrimSpace(item.ResourceID),
		strings.TrimSpace(item.Role),
		strings.TrimSpace(item.UserID),
		strings.TrimSpace(item.SourceResourceType),
		strings.TrimSpace(item.SourceResourceID),
		strings.TrimSpace(item.SourcePrincipalType),
		strings.TrimSpace(item.SourcePrincipalID),
		strings.TrimSpace(item.InheritanceType),
	}, ":")
}

func (r *MemoryRepo) ListResourceGVICAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceGVICAssignment, error) {
	keyValue, err := normalizeResourceGVICKey(companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if !r.gvicResourceExistsLocked(keyValue.companyID, keyValue.resourceType, keyValue.resourceID) {
		return nil, ErrNotFound
	}
	items := r.gvicAssignmentsForResourceLocked(keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
	return cloneResourceGVICAssignments(items), nil
}

func (r *MemoryRepo) SetResourceGVICAssignments(input ResourceGVICAssignmentUpdateInput) (ResourceGVICAssignmentMutationResult, error) {
	command := ResourceGVICAssignmentCommandInput{
		CompanyID:      input.CompanyID,
		ResourceType:   input.ResourceType,
		ResourceID:     input.ResourceID,
		Assignments:    input.Assignments,
		ActorUserID:    input.ActorUserID,
		IdempotencyKey: input.IdempotencyKey,
	}
	return r.applyResourceGVICAssignmentCommand(command, GVICAssignmentCommandSet)
}

func (r *MemoryRepo) AddResourceGVICAssignments(input ResourceGVICAssignmentCommandInput) (ResourceGVICAssignmentMutationResult, error) {
	return r.applyResourceGVICAssignmentCommand(input, GVICAssignmentCommandAdd)
}

func (r *MemoryRepo) RemoveResourceGVICAssignments(input ResourceGVICAssignmentCommandInput) (ResourceGVICAssignmentMutationResult, error) {
	return r.applyResourceGVICAssignmentCommand(input, GVICAssignmentCommandRemove)
}

func (r *MemoryRepo) applyResourceGVICAssignmentCommand(input ResourceGVICAssignmentCommandInput, operation string) (ResourceGVICAssignmentMutationResult, error) {
	keyValue, err := normalizeResourceGVICKey(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	assignments, err := normalizeResourceGVICAssignmentInputs(input.Assignments)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	if err := validateResourceGVICAssignmentInputsForOperation(keyValue, assignments, operation); err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.gvicResourceExistsLocked(keyValue.companyID, keyValue.resourceType, keyValue.resourceID) {
		return ResourceGVICAssignmentMutationResult{}, ErrNotFound
	}
	for _, assignment := range assignments {
		if err := r.validateGVICPrincipalLocked(keyValue.companyID, assignment.principalType, assignment.principalID); err != nil {
			return ResourceGVICAssignmentMutationResult{}, err
		}
	}
	assignmentsSnapshot := cloneMemoryMap(r.gvicAssignments)
	effectiveSnapshot := cloneMemoryMap(r.gvicEffectiveAssignments)
	GVICMatrixProjectionSnapshot := cloneMemoryMap(r.GVICMatrixProjectionRows)
	eventRowsSnapshot := cloneMemoryMap(r.eventRows)
	restore := func() {
		r.gvicAssignments = assignmentsSnapshot
		r.gvicEffectiveAssignments = effectiveSnapshot
		r.GVICMatrixProjectionRows = GVICMatrixProjectionSnapshot
		r.eventRows = eventRowsSnapshot
	}

	before := r.gvicAssignmentsForResourceLocked(keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
	changed := false
	now := time.Now().UTC()
	switch operation {
	case GVICAssignmentCommandSet:
		for sourceKey, assignment := range r.gvicAssignments {
			if assignment.CompanyID == keyValue.companyID && assignment.ResourceType == keyValue.resourceType && assignment.ResourceID == keyValue.resourceID {
				delete(r.gvicAssignments, sourceKey)
				changed = true
			}
		}
		for _, assignment := range assignments {
			item := r.resourceGVICAssignmentForPrincipalLocked(keyValue, assignment, now)
			r.gvicAssignments[gvicSourceAssignmentKey(item.CompanyID, item.ResourceType, item.ResourceID, item.Role, item.PrincipalType, item.PrincipalID)] = item
		}
	case GVICAssignmentCommandAdd:
		for _, assignment := range assignments {
			if keyValue.resourceType == EntityTypeNode || keyValue.resourceType == EntityTypeLogicGate {
				for sourceKey, existing := range r.gvicAssignments {
					if existing.CompanyID == keyValue.companyID && existing.ResourceType == keyValue.resourceType && existing.ResourceID == keyValue.resourceID && existing.PrincipalType == assignment.principalType && existing.PrincipalID == assignment.principalID && existing.Role != assignment.role {
						delete(r.gvicAssignments, sourceKey)
						changed = true
					}
				}
			}
			if isSingleUserPrimaryGVICResourceType(keyValue.resourceType) && isSingleUserPrimaryGVICRole(assignment.role) {
				for sourceKey, existing := range r.gvicAssignments {
					if existing.CompanyID == keyValue.companyID && existing.ResourceType == keyValue.resourceType && existing.ResourceID == keyValue.resourceID && existing.Role == assignment.role && (existing.PrincipalType != assignment.principalType || existing.PrincipalID != assignment.principalID) {
						delete(r.gvicAssignments, sourceKey)
						changed = true
					}
				}
			}

			item := r.resourceGVICAssignmentForPrincipalLocked(keyValue, assignment, now)
			sourceKey := gvicSourceAssignmentKey(item.CompanyID, item.ResourceType, item.ResourceID, item.Role, item.PrincipalType, item.PrincipalID)
			if _, ok := r.gvicAssignments[sourceKey]; ok {
				continue
			}
			r.gvicAssignments[sourceKey] = item
			changed = true
		}
	case GVICAssignmentCommandRemove:
		for _, assignment := range assignments {
			sourceKey := gvicSourceAssignmentKey(keyValue.companyID, keyValue.resourceType, keyValue.resourceID, assignment.role, assignment.principalType, assignment.principalID)
			if _, ok := r.gvicAssignments[sourceKey]; ok {
				delete(r.gvicAssignments, sourceKey)
				changed = true
			}
		}
	default:
		return ResourceGVICAssignmentMutationResult{}, ErrInvalid
	}
	after := r.gvicAssignmentsForResourceLocked(keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
	if !changed && len(before) != len(after) {
		changed = true
	}

	affected := []resourceGVICKey{keyValue}
	if keyValue.resourceType != EntityTypeLogicGate {
		affected = r.affectedGVICResourceKeysLocked(keyValue)
	}
	deltas := r.syncGVICResourceKeysLocked(keyValue.companyID, affected)
	if _, err := r.appendEventRowsLocked(ProjectionDeltaEventInputs(keyValue.companyID, input.ActorUserID, input.IdempotencyKey, deltas)); err != nil {
		restore()
		return ResourceGVICAssignmentMutationResult{}, err
	}
	effective := r.gvicEffectiveAssignmentsForResourceLocked(keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
	return ResourceGVICAssignmentMutationResult{
		CompanyID:            keyValue.companyID,
		ResourceType:         keyValue.resourceType,
		ResourceID:           keyValue.resourceID,
		Operation:            operation,
		Changed:              changed || len(deltas) > 0,
		GVICAssignments:      cloneResourceGVICAssignments(after),
		EffectiveAssignments: cloneResourceGVICEffectiveAssignments(effective),
		ProjectionDeltas:     deltas,
		Events:               []domain.DomainEvent{},
	}, nil
}

func (r *MemoryRepo) ListResourceGVICEffectiveAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceGVICEffectiveAssignment, error) {
	keyValue, err := normalizeResourceGVICKey(companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if !r.gvicResourceExistsLocked(keyValue.companyID, keyValue.resourceType, keyValue.resourceID) {
		return nil, ErrNotFound
	}
	items := r.gvicEffectiveAssignmentsForResourceLocked(keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
	return cloneResourceGVICEffectiveAssignments(items), nil
}

func (r *MemoryRepo) validateGVICPrincipalLocked(companyID, principalType, principalID string) error {
	switch principalType {
	case EntityPermissionSubjectUser:
		if _, ok := r.memberships[membershipKey(companyID, principalID)]; !ok {
			return ErrPrincipalNotInCompany
		}
	case EntityPermissionSubjectGroup:
		if _, ok := r.userGroups[userGroupKey(companyID, principalID)]; !ok {
			return ErrPrincipalNotInCompany
		}
	default:
		return ErrInvalid
	}
	return nil
}

func (r *MemoryRepo) gvicResourceExistsLocked(companyID, resourceType, resourceID string) bool {
	switch resourceType {
	case EntityTypeNode:
		_, ok := r.nodes[key(companyID, resourceID)]
		return ok
	case EntityTypeLogicGate:
		_, ok := r.logicGates[key(companyID, resourceID)]
		return ok
	case EntityTypeProject:
		_, ok := r.projects[key(companyID, resourceID)]
		return ok
	case EntityTypeSharedInbox:
		_, ok := r.folders[key(companyID, resourceID)]
		return ok
	case EntityTypeSharedTriageFolder:
		_, ok := r.folders[key(companyID, resourceID)]
		return ok
	default:
		return false
	}
}

func (r *MemoryRepo) resourceGVICAssignmentForPrincipalLocked(keyValue resourceGVICKey, input normalizedGVICAssignmentInput, now time.Time) domain.ResourceGVICAssignment {
	item := domain.ResourceGVICAssignment{
		CompanyID:        keyValue.companyID,
		ResourceType:     keyValue.resourceType,
		ResourceID:       keyValue.resourceID,
		Role:             input.role,
		PrincipalType:    input.principalType,
		PrincipalID:      input.principalID,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	switch input.principalType {
	case EntityPermissionSubjectUser:
		if user, ok := r.companyUserByIDLocked(keyValue.companyID, input.principalID); ok {
			item.UserID = user.UserID
			item.UserDisplayName = strings.TrimSpace(user.DisplayName)
			item.UserEmail = strings.TrimSpace(user.Email)
			item.PrincipalName = strings.TrimSpace(user.DisplayName)
			if item.PrincipalName == "" {
				item.PrincipalName = strings.TrimSpace(user.Email)
			}
		}
	case EntityPermissionSubjectGroup:
		if group, ok := r.userGroups[userGroupKey(keyValue.companyID, input.principalID)]; ok {
			item.PrincipalName = strings.TrimSpace(group.Name)
		}
	}
	return item
}

func (r *MemoryRepo) gvicAssignmentsForResourceLocked(companyID, resourceType, resourceID string) []domain.ResourceGVICAssignment {
	items := make([]domain.ResourceGVICAssignment, 0)
	for _, assignment := range r.gvicAssignments {
		if assignment.CompanyID == companyID && assignment.ResourceType == resourceType && assignment.ResourceID == resourceID {
			items = append(items, assignment)
		}
	}
	sortResourceGVICAssignments(items)
	return items
}

func (r *MemoryRepo) gvicEffectiveAssignmentsForResourceLocked(companyID, resourceType, resourceID string) []domain.ResourceGVICEffectiveAssignment {
	items := make([]domain.ResourceGVICEffectiveAssignment, 0)
	if resourceType == EntityTypeNode {
		if assignment, ok := r.nodeLogicGateAssignments[nodeLogicGateAssignmentKey(companyID, resourceID)]; ok && strings.TrimSpace(assignment.LogicGateID) != "" {
			for _, effective := range r.gvicEffectiveAssignments {
				if effective.CompanyID != companyID || effective.ResourceType != EntityTypeLogicGate || effective.ResourceID != assignment.LogicGateID {
					continue
				}
				item := effective
				item.ResourceType = EntityTypeNode
				item.ResourceID = resourceID
				item.InheritanceType = GVICInheritanceLogicGateInherited
				items = append(items, item)
			}
			sortResourceGVICEffectiveAssignments(items)
			return items
		}
	}
	for _, assignment := range r.gvicEffectiveAssignments {
		if assignment.CompanyID == companyID && assignment.ResourceType == resourceType && assignment.ResourceID == resourceID {
			items = append(items, assignment)
		}
	}
	sortResourceGVICEffectiveAssignments(items)
	return items
}
func (r *MemoryRepo) affectedGVICResourceKeysLocked(keyValue resourceGVICKey) []resourceGVICKey {
	seen := map[resourceGVICKey]bool{keyValue: true}
	if keyValue.resourceType == EntityTypeLogicGate {
		for _, assignment := range r.nodeLogicGateAssignments {
			if assignment.CompanyID == keyValue.companyID && assignment.LogicGateID == keyValue.resourceID {
				seen[resourceGVICKey{companyID: keyValue.companyID, resourceType: EntityTypeNode, resourceID: assignment.NodeID}] = true
			}
		}
	}
	out := make([]resourceGVICKey, 0, len(seen))
	for item := range seen {
		out = append(out, item)
	}
	return out
}

func (r *MemoryRepo) syncResourceGVICEffectiveAssignmentsLocked(keys []resourceGVICKey) []ProjectionDelta {
	deltas := make([]ProjectionDelta, 0)
	for _, keyValue := range keys {
		beforeEffective := r.gvicEffectiveAssignmentsForResourceLocked(keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
		for effectiveKey, assignment := range r.gvicEffectiveAssignments {
			if assignment.CompanyID == keyValue.companyID && assignment.ResourceType == keyValue.resourceType && assignment.ResourceID == keyValue.resourceID {
				delete(r.gvicEffectiveAssignments, effectiveKey)
			}
		}
		next := r.deriveResourceGVICEffectiveAssignmentsLocked(keyValue, time.Now().UTC())
		for _, assignment := range next {
			r.gvicEffectiveAssignments[gvicEffectiveAssignmentKey(assignment)] = assignment
		}
		afterEffective := r.gvicEffectiveAssignmentsForResourceLocked(keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
		beforeRows := make([]GVICEffectiveAssignmentProjectionRow, 0, len(beforeEffective))
		afterRows := make([]GVICEffectiveAssignmentProjectionRow, 0, len(afterEffective))
		for _, item := range beforeEffective {
			beforeRows = append(beforeRows, gvicEffectiveProjectionRowFromDomain(item))
		}
		for _, item := range afterEffective {
			afterRows = append(afterRows, gvicEffectiveProjectionRowFromDomain(item))
		}
		deltas = append(deltas, diffGVICEffectiveProjectionRows(beforeRows, afterRows)...)
	}
	return deltas
}

func (r *MemoryRepo) deriveResourceGVICEffectiveAssignmentsLocked(keyValue resourceGVICKey, now time.Time) []domain.ResourceGVICEffectiveAssignment {
	if keyValue.resourceType == EntityTypeNode {
		if assignment, ok := r.nodeLogicGateAssignments[nodeLogicGateAssignmentKey(keyValue.companyID, keyValue.resourceID)]; ok && strings.TrimSpace(assignment.LogicGateID) != "" {
			return nil
		}
	}
	sourceType := keyValue.resourceType
	sourceID := keyValue.resourceID
	inheritance := GVICInheritanceDirect

	outByKey := map[string]domain.ResourceGVICEffectiveAssignment{}
	for _, assignment := range r.gvicAssignments {
		if assignment.CompanyID != keyValue.companyID || assignment.ResourceType != sourceType || assignment.ResourceID != sourceID {
			continue
		}
		userIDs := []string{}
		switch assignment.PrincipalType {
		case EntityPermissionSubjectUser:
			userIDs = append(userIDs, assignment.PrincipalID)
		case EntityPermissionSubjectGroup:
			userIDs, _ = r.logicGateGVICUserIDsForGroupLocked(keyValue.companyID, assignment.PrincipalID)
		}
		for _, userID := range userIDs {
			user, ok := r.companyUserByIDLocked(keyValue.companyID, userID)
			if !ok {
				continue
			}
			item := domain.ResourceGVICEffectiveAssignment{
				CompanyID:           keyValue.companyID,
				ResourceType:        keyValue.resourceType,
				ResourceID:          keyValue.resourceID,
				Role:                assignment.Role,
				UserID:              user.UserID,
				SourceResourceType:  sourceType,
				SourceResourceID:    sourceID,
				SourcePrincipalType: assignment.PrincipalType,
				SourcePrincipalID:   assignment.PrincipalID,
				InheritanceType:     inheritance,
				UserDisplayName:     strings.TrimSpace(user.DisplayName),
				UserEmail:           strings.TrimSpace(user.Email),
				UpdatedTimestamp:    now,
			}
			outByKey[gvicEffectiveAssignmentKey(item)] = item
		}
	}
	out := make([]domain.ResourceGVICEffectiveAssignment, 0, len(outByKey))
	for _, item := range outByKey {
		out = append(out, item)
	}
	sortResourceGVICEffectiveAssignments(out)
	return out
}
func (r *MemoryRepo) syncGVICGroupDependentResourcesLocked(companyID string) []ProjectionDelta {
	return r.syncGVICGroupDependentResourcesForGroupSetLocked(companyID, nil)
}

func (r *MemoryRepo) syncGVICGroupDependentResourcesForGroupsLocked(companyID string, groupIDs []string) []ProjectionDelta {
	affectedGroupIDs := companyUserGroupAncestorIDsLocked(r.userGroups, companyID, groupIDs)
	if len(affectedGroupIDs) == 0 {
		return nil
	}
	return r.syncGVICGroupDependentResourcesForGroupSetLocked(companyID, affectedGroupIDs)
}

func (r *MemoryRepo) syncGVICGroupDependentResourcesForGroupSetLocked(companyID string, affectedGroupIDs map[string]bool) []ProjectionDelta {
	keys := r.gvicResourceKeysForGroupSetLocked(companyID, affectedGroupIDs)
	return r.syncGVICResourceKeysLocked(companyID, keys)
}

func (r *MemoryRepo) gvicResourceKeysForGroupSetLocked(companyID string, affectedGroupIDs map[string]bool) []resourceGVICKey {
	seen := map[resourceGVICKey]bool{}
	for _, assignment := range r.gvicAssignments {
		if assignment.CompanyID != companyID || assignment.PrincipalType != EntityPermissionSubjectGroup {
			continue
		}
		if affectedGroupIDs != nil && !affectedGroupIDs[assignment.PrincipalID] {
			continue
		}
		keyValue := resourceGVICKey{companyID: assignment.CompanyID, resourceType: assignment.ResourceType, resourceID: assignment.ResourceID}
		seen[keyValue] = true
	}
	keys := make([]resourceGVICKey, 0, len(seen))
	for keyValue := range seen {
		keys = append(keys, keyValue)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].resourceType != keys[j].resourceType {
			return keys[i].resourceType < keys[j].resourceType
		}
		return keys[i].resourceID < keys[j].resourceID
	})
	return keys
}
func (r *MemoryRepo) syncGVICResourceKeysLocked(companyID string, keys []resourceGVICKey) []ProjectionDelta {
	companyID = strings.TrimSpace(companyID)
	seen := map[resourceGVICKey]bool{}
	for _, keyValue := range keys {
		keyValue.companyID = strings.TrimSpace(keyValue.companyID)
		keyValue.resourceType = strings.TrimSpace(keyValue.resourceType)
		keyValue.resourceID = strings.TrimSpace(keyValue.resourceID)
		if companyID == "" || keyValue.companyID != companyID || keyValue.resourceType == "" || keyValue.resourceID == "" {
			continue
		}
		seen[keyValue] = true
	}
	ordered := make([]resourceGVICKey, 0, len(seen))
	for keyValue := range seen {
		ordered = append(ordered, keyValue)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].resourceType != ordered[j].resourceType {
			return ordered[i].resourceType < ordered[j].resourceType
		}
		return ordered[i].resourceID < ordered[j].resourceID
	})

	deltas := r.syncResourceGVICEffectiveAssignmentsLocked(ordered)
	for _, keyValue := range ordered {
		switch keyValue.resourceType {
		case EntityTypeNode:
			deltas = append(deltas, r.syncGVICMatrixProjectionForNodeDeltasLocked(keyValue.companyID, keyValue.resourceID)...)
		case EntityTypeLogicGate:
			deltas = append(deltas, r.syncGVICMatrixProjectionForLogicGateAssignmentsDeltasLocked(keyValue.companyID, keyValue.resourceID, nil, nil)...)
		}
	}
	return deltas
}
