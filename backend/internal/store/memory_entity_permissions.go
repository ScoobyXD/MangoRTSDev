package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) ListCompanyUserGroups(companyID string) ([]domain.CompanyUserGroup, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.CompanyUserGroup, 0)
	for _, group := range r.userGroups {
		if group.CompanyID == companyID {
			items = append(items, cloneCompanyUserGroup(group))
		}
	}
	sortCompanyUserGroups(items)
	return items, nil
}

func (r *MemoryRepo) CreateCompanyUserGroup(companyID, parentGroupID, name string) (domain.CompanyUserGroup, error) {
	companyID = strings.TrimSpace(companyID)
	parentGroupID = strings.TrimSpace(parentGroupID)
	name = strings.TrimSpace(name)
	if companyID == "" || name == "" {
		return domain.CompanyUserGroup{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.companies[companyID]; !ok {
		return domain.CompanyUserGroup{}, ErrNotFound
	}
	var parent *string
	if parentGroupID != "" {
		if _, ok := r.userGroups[userGroupKey(companyID, parentGroupID)]; !ok {
			return domain.CompanyUserGroup{}, ErrNotFound
		}
		parentValue := parentGroupID
		parent = &parentValue
	}
	now := time.Now().UTC()
	group := domain.CompanyUserGroup{
		CompanyID:        companyID,
		GroupID:          newUUIDv7String(),
		ParentGroupID:    parent,
		Name:             name,
		Position:         nextCompanyUserGroupPositionLocked(r.userGroups, companyID, parentGroupID),
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.userGroups[userGroupKey(companyID, group.GroupID)] = group
	return cloneCompanyUserGroup(group), nil
}

func (r *MemoryRepo) UpdateCompanyUserGroup(companyID, groupID string, parentGroupID *string, name string, position int) (domain.CompanyUserGroup, error) {
	companyID = strings.TrimSpace(companyID)
	groupID = strings.TrimSpace(groupID)
	name = strings.TrimSpace(name)
	if companyID == "" || groupID == "" {
		return domain.CompanyUserGroup{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	group, ok := r.userGroups[userGroupKey(companyID, groupID)]
	if !ok {
		return domain.CompanyUserGroup{}, ErrNotFound
	}
	targetParentID := companyUserGroupParentID(group)
	parentChanged := false
	if parentGroupID != nil {
		targetParentID = strings.TrimSpace(*parentGroupID)
		if targetParentID == groupID || companyUserGroupCreatesCycleLocked(r.userGroups, companyID, groupID, targetParentID) {
			return domain.CompanyUserGroup{}, ErrInvalid
		}
		if targetParentID != "" {
			if _, ok := r.userGroups[userGroupKey(companyID, targetParentID)]; !ok {
				return domain.CompanyUserGroup{}, ErrNotFound
			}
		}
		parentChanged = targetParentID != companyUserGroupParentID(group)
		if targetParentID == "" {
			group.ParentGroupID = nil
		} else {
			parentValue := targetParentID
			group.ParentGroupID = &parentValue
		}
	}
	if name != "" {
		group.Name = name
	}
	if strings.TrimSpace(group.Name) == "" {
		return domain.CompanyUserGroup{}, ErrInvalid
	}
	if position > 0 {
		group.Position = position
	} else if parentChanged {
		group.Position = nextCompanyUserGroupPositionLocked(r.userGroups, companyID, targetParentID)
	}
	oldAffectedGroupIDs := map[string]bool(nil)
	if parentChanged {
		oldAffectedGroupIDs = companyUserGroupAncestorIDsLocked(r.userGroups, companyID, []string{groupID})
	}
	group.UpdatedTimestamp = time.Now().UTC()
	r.userGroups[userGroupKey(companyID, group.GroupID)] = group
	if parentChanged {
		newAffectedGroupIDs := companyUserGroupAncestorIDsLocked(r.userGroups, companyID, []string{groupID})
		for affectedGroupID := range newAffectedGroupIDs {
			oldAffectedGroupIDs[affectedGroupID] = true
		}
		r.syncGVICGroupDependentResourcesForGroupSetLocked(companyID, oldAffectedGroupIDs)
	}
	return cloneCompanyUserGroup(group), nil
}

func (r *MemoryRepo) DeleteCompanyUserGroup(companyID, groupID string) error {
	companyID = strings.TrimSpace(companyID)
	groupID = strings.TrimSpace(groupID)
	if companyID == "" || groupID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.userGroups[userGroupKey(companyID, groupID)]; !ok {
		return ErrNotFound
	}
	groupIDs := companyUserGroupSubtreeIDsLocked(r.userGroups, companyID, groupID)
	affectedGroupIDs := companyUserGroupAncestorIDsLocked(r.userGroups, companyID, mapKeys(groupIDs))
	affectedGVICKeys := r.gvicResourceKeysForGroupSetLocked(companyID, affectedGroupIDs)
	for descendantID := range groupIDs {
		delete(r.userGroups, userGroupKey(companyID, descendantID))
	}
	for memberKey, member := range r.userGroupMembers {
		if member.CompanyID == companyID && groupIDs[member.GroupID] {
			delete(r.userGroupMembers, memberKey)
		}
	}
	type defaultPolicyResource struct {
		entityType string
		entityID   string
	}
	affectedDefaultPolicyResources := map[defaultPolicyResource]bool{}
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.SubjectType == EntityPermissionSubjectGroup && groupIDs[permission.SubjectID] {
			if usesDefaultResourceAccessPolicy(permission.EntityType) {
				affectedDefaultPolicyResources[defaultPolicyResource{entityType: permission.EntityType, entityID: permission.EntityID}] = true
			}
			delete(r.entityPermissions, permissionKey)
		}
	}
	for resource := range affectedDefaultPolicyResources {
		if r.resourceHasDirectEntityPermissionsLocked(companyID, resource.entityType, resource.entityID) {
			continue
		}
		switch resource.entityType {
		case EntityTypeNode:
			node := r.nodes[key(companyID, resource.entityID)]
			node.DefaultAccess = ResourceDefaultAccessEdit
			r.nodes[key(companyID, resource.entityID)] = node
		case EntityTypeLogicGate:
			gate := r.logicGates[key(companyID, resource.entityID)]
			gate.DefaultAccess = ResourceDefaultAccessEdit
			r.logicGates[key(companyID, resource.entityID)] = gate
		case EntityTypeProject:
			project := r.projects[key(companyID, resource.entityID)]
			project.DefaultAccess = ResourceDefaultAccessEdit
			r.projects[key(companyID, resource.entityID)] = project
		case EntityTypeCompanyExplorerFolder:
			if entity, ok := r.companyExplorerV2Entities[key(companyID, resource.entityID)]; ok && entity.EntityType == CompanyExplorerV2EntityFolder {
				entity.DefaultAccess = ResourceDefaultAccessEdit
				r.companyExplorerV2Entities[key(companyID, resource.entityID)] = entity
			}
			if folder, ok := r.folders[key(companyID, resource.entityID)]; ok {
				folder.DefaultAccess = ResourceDefaultAccessEdit
				r.folders[key(companyID, resource.entityID)] = folder
			}
		case EntityTypeSharedInboxFolder, EntityTypeSharedInbox:
			folder := r.folders[key(companyID, resource.entityID)]
			folder.DefaultAccess = ResourceDefaultAccessEdit
			r.folders[key(companyID, resource.entityID)] = folder
		}
	}
	for GVICKey, assignments := range r.sharedInboxGVIC {
		next := assignments[:0]
		for _, assignment := range assignments {
			if assignment.CompanyID == companyID && assignment.PrincipalType == EntityPermissionSubjectGroup && groupIDs[assignment.PrincipalID] {
				continue
			}
			next = append(next, assignment)
		}
		if len(next) == 0 {
			delete(r.sharedInboxGVIC, GVICKey)
		} else {
			r.sharedInboxGVIC[GVICKey] = next
		}
	}
	for assignmentKey, assignment := range r.gvicAssignments {
		if assignment.CompanyID == companyID && assignment.PrincipalType == EntityPermissionSubjectGroup && groupIDs[assignment.PrincipalID] {
			delete(r.gvicAssignments, assignmentKey)
		}
	}
	r.syncGVICResourceKeysLocked(companyID, affectedGVICKeys)
	return nil
}

func (r *MemoryRepo) ListCompanyUserGroupMembers(companyID string) ([]domain.CompanyUserGroupMember, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.CompanyUserGroupMember, 0)
	for _, member := range r.userGroupMembers {
		if member.CompanyID == companyID {
			items = append(items, r.withCompanyUserGroupMemberUserLocked(member))
		}
	}
	sortCompanyUserGroupMembers(items)
	return items, nil
}

func (r *MemoryRepo) SetCompanyUserGroupMembers(companyID, groupID string, userIDs []string) ([]domain.CompanyUserGroupMember, error) {
	companyID = strings.TrimSpace(companyID)
	groupID = strings.TrimSpace(groupID)
	if companyID == "" || groupID == "" {
		return nil, ErrInvalid
	}
	if len(userIDs) > EntityPermissionMaxAssignments {
		return nil, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	userGroupMembersSnapshot := cloneMemoryMap(r.userGroupMembers)
	effectiveAccessSnapshot := cloneMemoryMap(r.effectiveAccess)
	gvicEffectiveSnapshot := cloneMemoryMap(r.gvicEffectiveAssignments)
	GVICMatrixProjectionRowsSnapshot := cloneMemoryMap(r.GVICMatrixProjectionRows)
	if _, ok := r.userGroups[userGroupKey(companyID, groupID)]; !ok {
		return nil, ErrNotFound
	}
	seen := map[string]bool{}
	cleanUserIDs := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		userID = strings.TrimSpace(userID)
		if userID == "" || seen[userID] {
			continue
		}
		if _, ok := r.memberships[membershipKey(companyID, userID)]; !ok {
			return nil, ErrPrincipalNotInCompany
		}
		seen[userID] = true
		cleanUserIDs = append(cleanUserIDs, userID)
	}
	for memberKey, member := range r.userGroupMembers {
		if member.CompanyID == companyID && member.GroupID == groupID {
			delete(r.userGroupMembers, memberKey)
		}
	}
	now := time.Now().UTC()
	items := make([]domain.CompanyUserGroupMember, 0, len(cleanUserIDs))
	for _, userID := range cleanUserIDs {
		member := domain.CompanyUserGroupMember{
			CompanyID:        companyID,
			GroupID:          groupID,
			UserID:           userID,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
		r.userGroupMembers[userGroupMemberKey(companyID, groupID, userID)] = member
		items = append(items, r.withCompanyUserGroupMemberUserLocked(member))
	}
	if err := r.recomputeGroupDependentEffectiveAccessForGroupsLocked(companyID, []string{groupID}); err != nil {
		r.userGroupMembers = userGroupMembersSnapshot
		r.effectiveAccess = effectiveAccessSnapshot
		r.gvicEffectiveAssignments = gvicEffectiveSnapshot
		r.GVICMatrixProjectionRows = GVICMatrixProjectionRowsSnapshot
		return nil, err
	}
	sortCompanyUserGroupMembers(items)
	return items, nil
}

func (r *MemoryRepo) ListEntityPermissions(companyID, entityType, entityID string) ([]domain.EntityPermission, error) {
	companyID = strings.TrimSpace(companyID)
	entityID = strings.TrimSpace(entityID)
	normalizedEntityType, ok := NormalizeEntityType(entityType)
	if companyID == "" || entityID == "" || !ok {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	if !r.entityExistsLocked(companyID, normalizedEntityType, entityID) {
		return nil, ErrNotFound
	}
	if usesDefaultResourceAccessPolicy(normalizedEntityType) {
		return r.resolvedEntityPermissionsLocked(companyID, normalizedEntityType, entityID), nil
	}
	items := make([]domain.EntityPermission, 0)
	for _, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.EntityType == normalizedEntityType && permission.EntityID == entityID {
			items = append(items, r.withEntityPermissionSubjectLocked(permission))
		}
	}
	sortEntityPermissions(items)
	return items, nil
}

func (r *MemoryRepo) SetEntityPermissions(input EntityPermissionUpdateInput) ([]domain.EntityPermission, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	entityID := strings.TrimSpace(input.EntityID)
	entityType, ok := NormalizeEntityType(input.EntityType)
	if companyID == "" || entityID == "" || !ok || len(input.Permissions) > EntityPermissionMaxAssignments {
		return nil, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if usesDefaultResourceAccessPolicy(entityType) {
		return r.setDefaultResourceAccessPolicyLocked(input, companyID, entityType, entityID)
	}

	permissionsSnapshot := cloneMemoryMap(r.entityPermissions)
	effectiveAccessSnapshot := cloneMemoryMap(r.effectiveAccess)
	nodesSnapshot := cloneMemoryMap(r.nodes)
	logicGatesSnapshot := cloneMemoryMap(r.logicGates)
	eventRowsSnapshot := cloneMemoryMap(r.eventRows)
	if !r.entityExistsLocked(companyID, entityType, entityID) {
		return nil, ErrNotFound
	}
	type normalizedPermission struct {
		subjectType string
		subjectID   string
		permission  string
	}
	normalized := make([]normalizedPermission, 0, len(input.Permissions))
	seen := map[string]bool{}
	for _, item := range input.Permissions {
		subjectType, ok := NormalizeEntityPermissionSubjectType(item.SubjectType)
		if !ok {
			return nil, ErrInvalid
		}
		rawAccessLevel := strings.TrimSpace(item.AccessLevel)
		if rawAccessLevel == "" {
			rawAccessLevel = item.Permission
		}
		permission, ok := NormalizeEntityPermission(rawAccessLevel)
		if !ok {
			return nil, ErrInvalid
		}
		subjectID := strings.TrimSpace(item.SubjectID)
		if subjectID == "" {
			return nil, ErrInvalid
		}
		if subjectType == EntityPermissionSubjectUser {
			membership, ok := r.memberships[membershipKey(companyID, subjectID)]
			if !ok {
				return nil, ErrPrincipalNotInCompany
			}
			if (entityType == EntityTypeNode || entityType == EntityTypeLogicGate) && permission == EntityPermissionNoAccess && domain.CanBypassResourcePermissions(membership.Role) {
				continue
			}
		} else if _, ok := r.userGroups[userGroupKey(companyID, subjectID)]; !ok {
			return nil, ErrNotFound
		}
		key := subjectType + ":" + subjectID
		if seen[key] {
			continue
		}
		seen[key] = true
		normalized = append(normalized, normalizedPermission{subjectType: subjectType, subjectID: subjectID, permission: permission})
	}
	if usesDefaultResourceAccessPolicy(entityType) {
		defaultAccess := ResourceDefaultAccessEdit
		if len(normalized) > 0 {
			defaultAccess = ResourceDefaultAccessNoAccess
		}
		switch entityType {
		case EntityTypeNode:
			node := r.nodes[key(companyID, entityID)]
			node.DefaultAccess = defaultAccess
			r.nodes[key(companyID, entityID)] = node
		case EntityTypeLogicGate:
			gate := r.logicGates[key(companyID, entityID)]
			gate.DefaultAccess = defaultAccess
			r.logicGates[key(companyID, entityID)] = gate
		}
	}
	targetEntityIDs := []string{entityID}
	targetEntityIDSet := make(map[string]bool, len(targetEntityIDs))
	for _, targetEntityID := range targetEntityIDs {
		targetEntityIDSet[targetEntityID] = true
	}
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.EntityType == entityType && targetEntityIDSet[permission.EntityID] {
			delete(r.entityPermissions, permissionKey)
		}
	}
	now := time.Now().UTC()
	out := make([]domain.EntityPermission, 0, len(normalized))
	for _, targetEntityID := range targetEntityIDs {
		for _, item := range normalized {
			permission := domain.EntityPermission{
				CompanyID:        companyID,
				EntityType:       entityType,
				EntityID:         targetEntityID,
				SubjectType:      item.subjectType,
				SubjectID:        item.subjectID,
				Permission:       item.permission,
				AccessLevel:      item.permission,
				CreatedTimestamp: now,
			}
			r.entityPermissions[entityPermissionKey(companyID, entityType, targetEntityID, item.subjectType, item.subjectID, item.permission)] = permission
			if targetEntityID == entityID {
				out = append(out, r.withEntityPermissionSubjectLocked(permission))
			}
		}
	}
	for _, targetEntityID := range targetEntityIDs {
		if err := r.recomputeDirectGrantEffectiveAccessForResourceLocked(companyID, entityType, targetEntityID); err != nil {
			r.entityPermissions = permissionsSnapshot
			r.effectiveAccess = effectiveAccessSnapshot
			r.nodes = nodesSnapshot
			r.logicGates = logicGatesSnapshot
			r.eventRows = eventRowsSnapshot
			return nil, err
		}
		if entityType == EntityTypeNode || entityType == EntityTypeLogicGate {
			if err := r.recomputeCompanyMemberDefaultEffectiveAccessForResourceLocked(companyID, entityType, targetEntityID); err != nil {
				r.entityPermissions = permissionsSnapshot
				r.effectiveAccess = effectiveAccessSnapshot
				r.nodes = nodesSnapshot
				r.logicGates = logicGatesSnapshot
				r.eventRows = eventRowsSnapshot
				return nil, err
			}
		}
	}
	if entityType == EntityTypeLogicGate {
		if err := r.recomputeLogicGateAssignedNodeVisibilityLocked(companyID, []string{entityID}, nil); err != nil {
			r.entityPermissions = permissionsSnapshot
			r.effectiveAccess = effectiveAccessSnapshot
			r.nodes = nodesSnapshot
			r.logicGates = logicGatesSnapshot
			r.eventRows = eventRowsSnapshot
			return nil, err
		}
	}
	eventInputs := ProjectRelationshipProjectionDeltaEventInputs(companyID, input.ActorUserID, "", r.projectRelationshipPermissionProjectionDeltasLocked(companyID, entityType, entityID))
	if eventInput, ok := PermissionChangedEventInput(companyID, entityType, entityID, input.ActorUserID); ok {
		eventInputs = append(eventInputs, eventInput)
	}
	if _, err := r.appendEventRowsLocked(eventInputs); err != nil {
		r.entityPermissions = permissionsSnapshot
		r.effectiveAccess = effectiveAccessSnapshot
		r.nodes = nodesSnapshot
		r.logicGates = logicGatesSnapshot
		r.eventRows = eventRowsSnapshot
		return nil, err
	}
	sortEntityPermissions(out)
	return out, nil
}

func (r *MemoryRepo) setDefaultResourceAccessPolicyLocked(input EntityPermissionUpdateInput, companyID, entityType, entityID string) ([]domain.EntityPermission, error) {
	permissionsSnapshot := cloneMemoryMap(r.entityPermissions)
	effectiveAccessSnapshot := cloneMemoryMap(r.effectiveAccess)
	nodesSnapshot := cloneMemoryMap(r.nodes)
	logicGatesSnapshot := cloneMemoryMap(r.logicGates)
	projectsSnapshot := cloneMemoryMap(r.projects)
	foldersSnapshot := cloneMemoryMap(r.folders)
	eventRowsSnapshot := cloneMemoryMap(r.eventRows)
	resourcePolicySequenceSnapshot := r.resourcePolicySequence
	resourcePermissionRevisionsSnapshot := cloneMemoryMap(r.resourcePermissionRevisions)
	resourcePermissionApplicationsSnapshot := clonePermissionApplications(r.resourcePermissionApplications)
	restore := func() {
		r.entityPermissions = permissionsSnapshot
		r.effectiveAccess = effectiveAccessSnapshot
		r.nodes = nodesSnapshot
		r.logicGates = logicGatesSnapshot
		r.projects = projectsSnapshot
		r.folders = foldersSnapshot
		r.eventRows = eventRowsSnapshot
		r.resourcePolicySequence = resourcePolicySequenceSnapshot
		r.resourcePermissionRevisions = resourcePermissionRevisionsSnapshot
		r.resourcePermissionApplications = resourcePermissionApplicationsSnapshot
	}
	if !r.entityExistsLocked(companyID, entityType, entityID) {
		return nil, ErrNotFound
	}
	beforePolicy, ok := r.resolvedResourcePermissionPolicyLocked(companyID, entityType, entityID)
	if !ok {
		return nil, ErrNotFound
	}
	defaultAccess := beforePolicy.DefaultAccess
	directDefaultAccess, ok := r.defaultAccessForResourceLocked(companyID, entityType, entityID)
	if !ok {
		return nil, ErrNotFound
	}
	oldDefaultAccess := beforePolicy.DefaultAccess
	beforeAssignments := beforePolicy.Assignments
	if input.ApplyToDescendants {
		beforeAssignments = beforePolicy.Assignments
	}
	canMutateManagerOverrides := true
	if strings.TrimSpace(input.ActorUserID) != "" {
		canMutateManagerOverrides = r.userCanMutateManagerResourceOverridesLocked(companyID, input.ActorUserID)
	}
	defaultAccessChanged := false
	if input.DefaultAccessSet {
		nextDefaultAccess, ok := NormalizeResourceDefaultAccess(input.DefaultAccess)
		if !ok {
			return nil, ErrInvalid
		}
		defaultAccess = nextDefaultAccess
		defaultAccessChanged = true
	} else if len(input.OverrideUserIDs) == 0 {
		inferredDefaultAccess, inferred, err := inferredResourceDefaultAccessFromPermissions(input.Permissions)
		if err != nil {
			return nil, err
		}
		if inferred {
			defaultAccess = inferredDefaultAccess
			defaultAccessChanged = true
		}
	}
	if defaultAccessChanged || directDefaultAccess != defaultAccess {
		if err := r.setResourceDefaultAccessLocked(companyID, entityType, entityID, defaultAccess); err != nil {
			restore()
			return nil, err
		}
	}

	assignments := map[string]domain.EntityPermission{}
	addAssignment := func(subjectType, subjectID, accessLevel string) error {
		subjectType, ok := NormalizeEntityPermissionSubjectType(subjectType)
		if !ok {
			return ErrInvalid
		}
		accessLevel, ok = NormalizeEntityPermission(accessLevel)
		if !ok {
			return ErrInvalid
		}
		subjectID = strings.TrimSpace(subjectID)
		if subjectID == "" {
			return ErrInvalid
		}
		switch subjectType {
		case EntityPermissionSubjectUser:
			membership, ok := r.memberships[membershipKey(companyID, subjectID)]
			if !ok {
				return ErrPrincipalNotInCompany
			}
			role := domain.NormalizeRole(membership.Role)
			if domain.CanBypassResourcePermissions(role) {
				return nil
			}
			if role == domain.RoleCompanyManager && !canMutateManagerOverrides {
				return nil
			}
		case EntityPermissionSubjectGroup:
			if !canMutateManagerOverrides {
				return ErrInvalid
			}
			if _, ok := r.userGroups[userGroupKey(companyID, subjectID)]; !ok {
				return ErrNotFound
			}
		default:
			return ErrInvalid
		}
		assignments[subjectType+":"+subjectID] = domain.EntityPermission{
			CompanyID:   companyID,
			EntityType:  entityType,
			EntityID:    entityID,
			SubjectType: subjectType,
			SubjectID:   subjectID,
			Permission:  accessLevel,
			AccessLevel: accessLevel,
		}
		return nil
	}

	if len(input.OverrideUserIDs) > 0 && len(input.Permissions) == 0 {
		overrideAccess := OppositeResourceDefaultAccess(defaultAccess)
		for _, userID := range input.OverrideUserIDs {
			if err := addAssignment(EntityPermissionSubjectUser, userID, overrideAccess); err != nil {
				return nil, err
			}
		}
	} else {
		for _, raw := range input.Permissions {
			subjectType, ok := NormalizeEntityPermissionSubjectType(raw.SubjectType)
			if !ok {
				return nil, ErrInvalid
			}
			subjectID := strings.TrimSpace(raw.SubjectID)
			if subjectID == "" {
				return nil, ErrInvalid
			}
			rawAccessLevel := permissionInputAccessLevel(raw)
			accessLevel := ""
			if strings.TrimSpace(rawAccessLevel) != "" {
				var accessOK bool
				accessLevel, accessOK = NormalizeEntityPermission(rawAccessLevel)
				if !accessOK {
					return nil, ErrInvalid
				}
			}
			if accessLevel == "" {
				return nil, ErrInvalid
			}
			if err := addAssignment(subjectType, subjectID, accessLevel); err != nil {
				return nil, err
			}
		}
	}
	if !canMutateManagerOverrides {
		for _, membership := range r.memberships {
			if membership.CompanyID != companyID || domain.NormalizeRole(membership.Role) != domain.RoleCompanyManager {
				continue
			}
			effectiveAccess := oldDefaultAccess
			if directAccess, ok := r.directResourcePermissionAccessLevelLocked(companyID, entityType, entityID, membership.UserID); ok {
				effectiveAccess = directAccess
			}
			if effectiveAccess != defaultAccess {
				assignments[EntityPermissionSubjectUser+":"+membership.UserID] = domain.EntityPermission{
					CompanyID:   companyID,
					EntityType:  entityType,
					EntityID:    entityID,
					SubjectType: EntityPermissionSubjectUser,
					SubjectID:   membership.UserID,
					Permission:  effectiveAccess,
					AccessLevel: effectiveAccess,
				}
			}
		}
	}

	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.EntityType == entityType && permission.EntityID == entityID {
			delete(r.entityPermissions, permissionKey)
		}
	}
	now := time.Now().UTC()
	out := make([]domain.EntityPermission, 0, len(assignments))
	for _, permission := range assignments {
		permission.CreatedTimestamp = now
		r.entityPermissions[entityPermissionKey(companyID, entityType, entityID, permission.SubjectType, permission.SubjectID, "")] = permission
		out = append(out, r.withEntityPermissionSubjectLocked(permission))
	}
	policySequence := r.nextResourcePolicySequenceLocked()
	r.setDirectResourcePolicySequenceLocked(companyID, entityType, entityID, policySequence)
	changedTargets := []resourcePermissionTarget{{ResourceType: entityType, ResourceID: entityID}}
	if input.ApplyToDescendants {
		afterPolicy, ok := r.resolvedResourcePermissionPolicyLocked(companyID, entityType, entityID)
		if !ok {
			restore()
			return nil, ErrNotFound
		}
		descendantTargets, err := r.applyResourcePermissionPolicyToDescendantsLocked(input, policySequence, oldDefaultAccess, beforeAssignments, afterPolicy.DefaultAccess, afterPolicy.Assignments)
		if err != nil {
			restore()
			return nil, err
		}
		changedTargets = append(changedTargets, descendantTargets...)
	}
	for _, target := range changedTargets {
		if err := r.recomputeDirectGrantEffectiveAccessForResourceLocked(companyID, target.ResourceType, target.ResourceID); err != nil {
			restore()
			return nil, err
		}
		if target.ResourceType == EntityTypeLogicGate {
			if err := r.recomputeLogicGateAssignedNodeVisibilityLocked(companyID, []string{target.ResourceID}, nil); err != nil {
				restore()
				return nil, err
			}
		}
	}
	projectionDeltas := []ProjectionDelta{}
	permissionEvents := []EventRowInput{}
	seenPermissionEvents := map[string]bool{}
	for _, target := range changedTargets {
		projectionDeltas = append(projectionDeltas, r.projectRelationshipPermissionProjectionDeltasLocked(companyID, target.ResourceType, target.ResourceID)...)
		eventKey := target.ResourceType + ":" + target.ResourceID
		if seenPermissionEvents[eventKey] {
			continue
		}
		seenPermissionEvents[eventKey] = true
		if eventInput, ok := PermissionChangedEventInput(companyID, target.ResourceType, target.ResourceID, input.ActorUserID); ok {
			permissionEvents = append(permissionEvents, eventInput)
		}
	}
	eventInputs := ProjectRelationshipProjectionDeltaEventInputs(companyID, input.ActorUserID, "", projectionDeltas)
	eventInputs = append(eventInputs, permissionEvents...)
	if _, err := r.appendEventRowsLocked(eventInputs); err != nil {
		restore()
		return nil, err
	}
	sortEntityPermissions(out)
	return out, nil
}

func (r *MemoryRepo) userCanMutateManagerResourceOverridesLocked(companyID, userID string) bool {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return false
	}
	for _, membership := range r.memberships {
		if membership.UserID == userID && domain.NormalizeRole(membership.Role) == domain.RoleDevAdmin {
			return true
		}
	}
	membership, ok := r.memberships[membershipKey(companyID, userID)]
	return ok && domain.NormalizeRole(membership.Role) == domain.RoleCompanyAdmin
}

func (r *MemoryRepo) UserCanViewEntity(companyID, entityType, entityID, userID string) (bool, error) {
	return r.UserCanAccessEntity(companyID, entityType, entityID, userID, EntityPermissionView)
}

func (r *MemoryRepo) ListAccessibleEntityIDs(companyID, entityType, userID, accessLevel string, entityIDs []string) (map[string]bool, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	normalizedEntityType, ok := NormalizeEntityType(entityType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || userID == "" || !ok || !accessOK {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	out := map[string]bool{}
	seen := map[string]bool{}
	for _, rawID := range entityIDs {
		entityID := strings.TrimSpace(rawID)
		if entityID == "" || seen[entityID] {
			continue
		}
		seen[entityID] = true
		if !r.entityExistsLocked(companyID, normalizedEntityType, entityID) {
			continue
		}
		if r.userCanAccessEntityLocked(companyID, normalizedEntityType, entityID, userID, accessLevel) {
			out[entityID] = true
		}
	}
	return out, nil
}

func (r *MemoryRepo) UserCanAccessEntity(companyID, entityType, entityID, userID, accessLevel string) (bool, error) {
	companyID = strings.TrimSpace(companyID)
	entityID = strings.TrimSpace(entityID)
	userID = strings.TrimSpace(userID)
	normalizedEntityType, ok := NormalizeEntityType(entityType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || entityID == "" || userID == "" || !ok || !accessOK {
		return false, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	if !r.entityExistsLocked(companyID, normalizedEntityType, entityID) {
		return false, ErrNotFound
	}
	return r.userCanAccessEntityLocked(companyID, normalizedEntityType, entityID, userID, accessLevel), nil
}

func (r *MemoryRepo) entityExistsLocked(companyID, entityType, entityID string) bool {
	switch entityType {
	case EntityTypeNode:
		_, ok := r.nodes[key(companyID, entityID)]
		return ok
	case EntityTypeLogicGate:
		_, ok := r.logicGates[key(companyID, entityID)]
		return ok
	case EntityTypeProject:
		_, ok := r.projects[key(companyID, entityID)]
		return ok
	case EntityTypeCompanyExplorerFolder:
		if entity, ok := r.companyExplorerV2Entities[key(companyID, entityID)]; ok && entity.EntityType == CompanyExplorerV2EntityFolder {
			return true
		}
		item, ok := r.folders[key(companyID, entityID)]
		return ok && item.FolderKind != "communications"
	case EntityTypeSharedInboxFolder:
		item, ok := r.folders[key(companyID, entityID)]
		return ok && item.FolderKind == "communications" && normalizeCommunicationsSharedInboxEntryType(item.EntryType, item.AccountEmail != nil) == CommunicationsSharedInboxEntryTypeFolder
	case EntityTypeSharedInbox:
		item, ok := r.folders[key(companyID, entityID)]
		return ok && item.FolderKind == "communications" && normalizeCommunicationsSharedInboxEntryType(item.EntryType, item.AccountEmail != nil) == CommunicationsSharedInboxEntryTypeSharedInbox
	default:
		return false
	}
}

func (r *MemoryRepo) userCanAccessEntityLocked(companyID, entityType, entityID, userID, accessLevel string) bool {
	return r.userHasResourcePermissionLocked(companyID, userID, entityType, entityID, accessLevel)
}

func (r *MemoryRepo) resourceHasDirectEntityPermissionsLocked(companyID, entityType, entityID string) bool {
	for _, permission := range r.entityPermissions {
		if permission.CompanyID == companyID &&
			permission.EntityType == entityType &&
			permission.EntityID == entityID {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) userHasSharedTriagePermissionLocked(companyID, entityID, userID, accessLevel string) bool {
	requiredRank := entityPermissionRank(accessLevel)
	if requiredRank == 0 {
		return false
	}
	entityIDs := []string{entityID}
	entityIDs = r.sharedTriageFolderAncestryLocked(companyID, entityID)
	type matchedGrant struct {
		depth       int
		subjectRank int
		accessRank  int
	}
	best := matchedGrant{depth: len(entityIDs) + 1, subjectRank: -1, accessRank: -1}
	found := false
	for depth, currentEntityID := range entityIDs {
		for _, permission := range r.entityPermissions {
			if permission.CompanyID != companyID || permission.EntityType != EntityTypeSharedTriageFolder || permission.EntityID != currentEntityID {
				continue
			}
			subjectRank := 0
			switch permission.SubjectType {
			case EntityPermissionSubjectUser:
				if permission.SubjectID != userID {
					continue
				}
				subjectRank = 2
			case EntityPermissionSubjectGroup:
				groupIDs := companyUserGroupSubtreeIDsLocked(r.userGroups, companyID, permission.SubjectID)
				matchedGroup := false
				for groupID := range groupIDs {
					if _, ok := r.userGroupMembers[userGroupMemberKey(companyID, groupID, userID)]; ok {
						matchedGroup = true
						break
					}
				}
				if !matchedGroup {
					continue
				}
				subjectRank = 3
			default:
				continue
			}
			candidate := matchedGrant{depth: depth, subjectRank: subjectRank, accessRank: entityPermissionRank(permission.Permission)}
			if !found || candidate.depth < best.depth ||
				(candidate.depth == best.depth && candidate.subjectRank > best.subjectRank) ||
				(candidate.depth == best.depth && candidate.subjectRank == best.subjectRank && candidate.accessRank > best.accessRank) {
				best = candidate
				found = true
			}
		}
	}
	return found && best.accessRank >= requiredRank
}

func (r *MemoryRepo) userHasRoleAdminAccessLocked(companyID, userID string) bool {
	for _, membership := range r.memberships {
		if membership.UserID == userID && membership.Role == domain.RoleDevAdmin {
			return true
		}
	}
	membership, ok := r.memberships[membershipKey(companyID, userID)]
	return ok && membership.Role == domain.RoleCompanyAdmin
}

func entityPermissionRank(accessLevel string) int {
	switch strings.TrimSpace(accessLevel) {
	case EntityPermissionNoAccess:
		return 0
	case EntityPermissionView:
		return 1
	case EntityPermissionEdit:
		return 2
	case EntityPermissionAdmin:
		return 3
	default:
		return 0
	}
}

func (r *MemoryRepo) sharedTriageFolderAncestryLocked(companyID, folderID string) []string {
	ids := []string{folderID}
	seen := map[string]bool{folderID: true}
	currentID := folderID
	for {
		folder, ok := r.folders[key(companyID, currentID)]
		if !ok || folder.FolderKind != "communications" || folder.ParentFolderID == nil {
			break
		}
		parentID := strings.TrimSpace(*folder.ParentFolderID)
		if parentID == "" || seen[parentID] {
			break
		}
		seen[parentID] = true
		ids = append(ids, parentID)
		currentID = parentID
	}
	return ids
}

func (r *MemoryRepo) sharedTriagePermissionTargetIDsLocked(companyID, folderID string) []string {
	ids := []string{folderID}
	root, ok := r.folders[key(companyID, folderID)]
	if !ok || root.FolderKind != "communications" {
		return ids
	}
	seen := map[string]bool{folderID: true}
	for index := 0; index < len(ids); index++ {
		parentID := ids[index]
		for _, folder := range r.folders {
			if folder.CompanyID != companyID || folder.FolderKind != "communications" || folder.ParentFolderID == nil {
				continue
			}
			if strings.TrimSpace(*folder.ParentFolderID) != parentID || seen[folder.FolderID] {
				continue
			}
			seen[folder.FolderID] = true
			ids = append(ids, folder.FolderID)
		}
	}
	return ids
}

func cloneCompanyUserGroup(group domain.CompanyUserGroup) domain.CompanyUserGroup {
	if group.ParentGroupID != nil {
		parent := *group.ParentGroupID
		group.ParentGroupID = &parent
	}
	return group
}

func sortCompanyUserGroups(items []domain.CompanyUserGroup) {
	sort.Slice(items, func(i, j int) bool {
		leftParent := companyUserGroupParentID(items[i])
		rightParent := companyUserGroupParentID(items[j])
		if leftParent != rightParent {
			return leftParent < rightParent
		}
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].GroupID < items[j].GroupID
	})
}

func sortCompanyUserGroupMembers(items []domain.CompanyUserGroupMember) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].GroupID != items[j].GroupID {
			return items[i].GroupID < items[j].GroupID
		}
		left := strings.ToLower(strings.TrimSpace(items[i].UserDisplayName))
		if left == "" {
			left = strings.ToLower(strings.TrimSpace(items[i].UserEmail))
		}
		right := strings.ToLower(strings.TrimSpace(items[j].UserDisplayName))
		if right == "" {
			right = strings.ToLower(strings.TrimSpace(items[j].UserEmail))
		}
		if left != right {
			return left < right
		}
		return items[i].UserID < items[j].UserID
	})
}

func sortEntityPermissions(items []domain.EntityPermission) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].SubjectType != items[j].SubjectType {
			return items[i].SubjectType < items[j].SubjectType
		}
		left := strings.ToLower(strings.TrimSpace(items[i].SubjectName))
		if left == "" {
			left = strings.ToLower(strings.TrimSpace(items[i].SubjectEmail))
		}
		if left == "" {
			left = items[i].SubjectID
		}
		right := strings.ToLower(strings.TrimSpace(items[j].SubjectName))
		if right == "" {
			right = strings.ToLower(strings.TrimSpace(items[j].SubjectEmail))
		}
		if right == "" {
			right = items[j].SubjectID
		}
		if left != right {
			return left < right
		}
		return items[i].SubjectID < items[j].SubjectID
	})
}

func companyUserGroupParentID(group domain.CompanyUserGroup) string {
	if group.ParentGroupID == nil {
		return ""
	}
	return strings.TrimSpace(*group.ParentGroupID)
}

func nextCompanyUserGroupPositionLocked(groups map[string]domain.CompanyUserGroup, companyID, parentGroupID string) int {
	next := 1000
	for _, group := range groups {
		if group.CompanyID != companyID || companyUserGroupParentID(group) != parentGroupID {
			continue
		}
		if group.Position >= next {
			next = group.Position + 1000
		}
	}
	return next
}

func companyUserGroupSubtreeIDsLocked(groups map[string]domain.CompanyUserGroup, companyID, groupID string) map[string]bool {
	groupID = strings.TrimSpace(groupID)
	ids := map[string]bool{}
	if groupID == "" {
		return ids
	}
	for _, group := range groups {
		if group.CompanyID == companyID && group.GroupID == groupID {
			ids[groupID] = true
			break
		}
	}
	changed := true
	for changed {
		changed = false
		for _, group := range groups {
			if group.CompanyID != companyID || group.ParentGroupID == nil {
				continue
			}
			if ids[*group.ParentGroupID] && !ids[group.GroupID] {
				ids[group.GroupID] = true
				changed = true
			}
		}
	}
	return ids
}

func companyUserGroupAncestorIDsLocked(groups map[string]domain.CompanyUserGroup, companyID string, groupIDs []string) map[string]bool {
	companyID = strings.TrimSpace(companyID)
	ids := map[string]bool{}
	for _, groupID := range groupIDs {
		groupID = strings.TrimSpace(groupID)
		seen := map[string]bool{}
		for groupID != "" && !seen[groupID] {
			seen[groupID] = true
			group, ok := groups[userGroupKey(companyID, groupID)]
			if !ok {
				break
			}
			ids[group.GroupID] = true
			groupID = companyUserGroupParentID(group)
		}
	}
	return ids
}

func companyUserGroupCreatesCycleLocked(groups map[string]domain.CompanyUserGroup, companyID, groupID, targetParentID string) bool {
	if strings.TrimSpace(targetParentID) == "" {
		return false
	}
	return companyUserGroupSubtreeIDsLocked(groups, companyID, groupID)[targetParentID]
}

func (r *MemoryRepo) withCompanyUserGroupMemberUserLocked(member domain.CompanyUserGroupMember) domain.CompanyUserGroupMember {
	if user, ok := r.companyUserByIDLocked(member.CompanyID, member.UserID); ok {
		member.UserDisplayName = strings.TrimSpace(user.DisplayName)
		member.UserEmail = strings.TrimSpace(user.Email)
	}
	return member
}

func (r *MemoryRepo) withEntityPermissionSubjectLocked(permission domain.EntityPermission) domain.EntityPermission {
	switch permission.SubjectType {
	case EntityPermissionSubjectUser:
		if user, ok := r.companyUserByIDLocked(permission.CompanyID, permission.SubjectID); ok {
			permission.SubjectName = strings.TrimSpace(user.DisplayName)
			permission.SubjectEmail = strings.TrimSpace(user.Email)
		}
	case EntityPermissionSubjectGroup:
		if group, ok := r.userGroups[userGroupKey(permission.CompanyID, permission.SubjectID)]; ok {
			permission.SubjectName = strings.TrimSpace(group.Name)
		}
	}
	return permission
}

func (r *MemoryRepo) setResourceDefaultAccessLocked(companyID, entityType, entityID, defaultAccess string) error {
	companyID = strings.TrimSpace(companyID)
	entityID = strings.TrimSpace(entityID)
	var ok bool
	entityType, ok = NormalizeEntityType(entityType)
	defaultAccess, accessOK := NormalizeResourceDefaultAccess(defaultAccess)
	if companyID == "" || entityID == "" || !ok || !accessOK || !usesDefaultResourceAccessPolicy(entityType) {
		return ErrInvalid
	}
	switch entityType {
	case EntityTypeNode:
		node, ok := r.nodes[key(companyID, entityID)]
		if !ok {
			return ErrNotFound
		}
		node.DefaultAccess = defaultAccess
		r.nodes[key(companyID, entityID)] = node
		r.bumpNodeViewVersionLocked(companyID, entityID)
	case EntityTypeLogicGate:
		gate, ok := r.logicGates[key(companyID, entityID)]
		if !ok {
			return ErrNotFound
		}
		gate.DefaultAccess = defaultAccess
		r.logicGates[key(companyID, entityID)] = gate
	case EntityTypeProject:
		project, ok := r.projects[key(companyID, entityID)]
		if !ok {
			return ErrNotFound
		}
		project.DefaultAccess = defaultAccess
		r.projects[key(companyID, entityID)] = project
	case EntityTypeCompanyExplorerFolder:
		found := false
		if entity, ok := r.companyExplorerV2Entities[key(companyID, entityID)]; ok && entity.EntityType == CompanyExplorerV2EntityFolder {
			entity.DefaultAccess = defaultAccess
			r.companyExplorerV2Entities[key(companyID, entityID)] = entity
			found = true
		}
		if folder, ok := r.folders[key(companyID, entityID)]; ok {
			folder.DefaultAccess = defaultAccess
			r.folders[key(companyID, entityID)] = folder
			found = true
		}
		if !found {
			return ErrNotFound
		}
	case EntityTypeSharedInboxFolder, EntityTypeSharedInbox:
		folder, ok := r.folders[key(companyID, entityID)]
		if !ok {
			return ErrNotFound
		}
		folder.DefaultAccess = defaultAccess
		r.folders[key(companyID, entityID)] = folder
	default:
		return ErrInvalid
	}
	return nil
}

func (r *MemoryRepo) resourcePermissionAssignmentsLocked(companyID, resourceType, resourceID string) []resourcePermissionAssignment {
	policy, ok := r.resolvedResourcePermissionPolicyLocked(companyID, resourceType, resourceID)
	if !ok {
		return nil
	}
	return policy.Assignments
}

func (r *MemoryRepo) resourcePermissionDescendantTargetsLocked(companyID, resourceType, resourceID string) []resourcePermissionTarget {
	targets := []resourcePermissionTarget{}
	seen := map[string]bool{}
	addTarget := func(targetType, targetID string) {
		targetType, ok := NormalizeEntityType(targetType)
		targetID = strings.TrimSpace(targetID)
		if !ok || targetID == "" || !usesDefaultResourceAccessPolicy(targetType) {
			return
		}
		keyValue := targetType + ":" + targetID
		if seen[keyValue] {
			return
		}
		seen[keyValue] = true
		targets = append(targets, resourcePermissionTarget{ResourceType: targetType, ResourceID: targetID})
	}
	addAssignedNodes := func(logicGateID string) {
		for _, assignment := range r.nodeLogicGateAssignments {
			if assignment.CompanyID == companyID && assignment.LogicGateID == logicGateID {
				addTarget(EntityTypeNode, assignment.NodeID)
			}
		}
	}
	switch resourceType {
	case EntityTypeCompanyExplorerFolder:
		queue := []string{resourceID}
		visitedFolders := map[string]bool{resourceID: true}
		for len(queue) > 0 {
			parentID := queue[0]
			queue = queue[1:]
			for _, edge := range r.companyExplorerV2Edges {
				if edge.CompanyID != companyID || edge.ParentEntityID != parentID {
					continue
				}
				child, ok := r.companyExplorerV2Entities[key(companyID, edge.ChildEntityID)]
				if !ok {
					continue
				}
				childResourceID := strings.TrimSpace(child.ResourceID)
				if childResourceID == "" {
					childResourceID = child.EntityID
				}
				switch child.EntityType {
				case CompanyExplorerV2EntityFolder:
					addTarget(EntityTypeCompanyExplorerFolder, child.EntityID)
					if !visitedFolders[child.EntityID] {
						visitedFolders[child.EntityID] = true
						queue = append(queue, child.EntityID)
					}
				case CompanyExplorerV2EntityProject:
					addTarget(EntityTypeProject, childResourceID)
				case CompanyExplorerV2EntityLogicGate:
					addTarget(EntityTypeLogicGate, childResourceID)
					addAssignedNodes(childResourceID)
				}
			}
		}
		folderIDs := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, resourceID, "node")
		for folderID := range folderIDs {
			if folderID != resourceID {
				addTarget(EntityTypeCompanyExplorerFolder, folderID)
			}
		}
		for _, item := range r.folderItems {
			if item.CompanyID != companyID || !folderIDs[item.FolderID] {
				continue
			}
			switch item.ItemType {
			case EntityTypeProject:
				addTarget(EntityTypeProject, item.ItemID)
			case EntityTypeLogicGate:
				addTarget(EntityTypeLogicGate, item.ItemID)
				addAssignedNodes(item.ItemID)
			}
		}
	case EntityTypeLogicGate:
		addAssignedNodes(resourceID)
	}
	sort.Slice(targets, func(i, j int) bool {
		if targets[i].ResourceType != targets[j].ResourceType {
			return targets[i].ResourceType < targets[j].ResourceType
		}
		return targets[i].ResourceID < targets[j].ResourceID
	})
	return targets
}

func (r *MemoryRepo) applyResourcePermissionPolicyToDescendantsLocked(input EntityPermissionUpdateInput, policySequence int64, beforeDefault string, beforeAssignments []resourcePermissionAssignment, afterDefault string, afterAssignments []resourcePermissionAssignment) ([]resourcePermissionTarget, error) {
	if !input.ApplyToDescendants {
		return []resourcePermissionTarget{}, nil
	}
	companyID := strings.TrimSpace(input.CompanyID)
	resourceID := strings.TrimSpace(input.EntityID)
	resourceType, ok := NormalizeEntityType(input.EntityType)
	if companyID == "" || resourceID == "" || !ok {
		return nil, ErrInvalid
	}
	targets := r.resourcePermissionDescendantTargetsLocked(companyID, resourceType, resourceID)
	if len(targets) == 0 {
		return targets, nil
	}
	r.recordPermissionSubtreeApplicationsLocked(companyID, resourceType, resourceID, policySequence, beforeDefault, beforeAssignments, afterDefault, afterAssignments)
	return targets, nil
}

func (r *MemoryRepo) snapshotResourceAccessPolicyLocked(companyID, sourceType, sourceID, targetType, targetID string) (bool, error) {
	companyID = strings.TrimSpace(companyID)
	sourceID = strings.TrimSpace(sourceID)
	targetID = strings.TrimSpace(targetID)
	var ok bool
	sourceType, ok = NormalizeEntityType(sourceType)
	if !ok {
		return false, ErrInvalid
	}
	targetType, ok = NormalizeEntityType(targetType)
	if companyID == "" || sourceID == "" || targetID == "" || !ok ||
		!usesDefaultResourceAccessPolicy(sourceType) || !usesDefaultResourceAccessPolicy(targetType) {
		return false, ErrInvalid
	}
	sourcePolicy, ok := r.resolvedResourcePermissionPolicyLocked(companyID, sourceType, sourceID)
	if !ok {
		return false, ErrNotFound
	}
	targetPolicy, ok := r.resolvedResourcePermissionPolicyLocked(companyID, targetType, targetID)
	if !ok {
		return false, ErrNotFound
	}
	sourceAssignments := sourcePolicy.Assignments
	targetAssignments := targetPolicy.Assignments
	changed := !(sourcePolicy.DefaultAccess == targetPolicy.DefaultAccess && orderedResourcePermissionAssignmentsEqual(sourceAssignments, targetAssignments))
	if err := r.setResourceDefaultAccessLocked(companyID, targetType, targetID, sourcePolicy.DefaultAccess); err != nil {
		return false, err
	}
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.EntityType == targetType && permission.EntityID == targetID {
			delete(r.entityPermissions, permissionKey)
		}
	}
	now := time.Now().UTC()
	for _, assignment := range sourceAssignments {
		permission := domain.EntityPermission{
			CompanyID:        companyID,
			EntityType:       targetType,
			EntityID:         targetID,
			SubjectType:      assignment.SubjectType,
			SubjectID:        assignment.SubjectID,
			Permission:       assignment.AccessLevel,
			AccessLevel:      assignment.AccessLevel,
			CreatedTimestamp: now,
		}
		r.entityPermissions[entityPermissionKey(companyID, targetType, targetID, assignment.SubjectType, assignment.SubjectID, "")] = permission
	}
	r.setDirectResourcePolicySequenceLocked(companyID, targetType, targetID, r.nextResourcePolicySequenceLocked())
	if err := r.recomputeDirectGrantEffectiveAccessForResourceLocked(companyID, targetType, targetID); err != nil {
		return false, err
	}
	if targetType == EntityTypeLogicGate {
		if err := r.recomputeLogicGateAssignedNodeVisibilityLocked(companyID, []string{targetID}, nil); err != nil {
			return false, err
		}
	}
	return changed, nil
}
