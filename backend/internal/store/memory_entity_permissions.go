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
		r.syncRACIGroupDependentResourcesForGroupSetLocked(companyID, oldAffectedGroupIDs)
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
	affectedRACIKeys := r.gvicResourceKeysForGroupSetLocked(companyID, affectedGroupIDs)
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
	for RACIKey, assignments := range r.sharedInboxRACI {
		next := assignments[:0]
		for _, assignment := range assignments {
			if assignment.CompanyID == companyID && assignment.PrincipalType == EntityPermissionSubjectGroup && groupIDs[assignment.PrincipalID] {
				continue
			}
			next = append(next, assignment)
		}
		if len(next) == 0 {
			delete(r.sharedInboxRACI, RACIKey)
		} else {
			r.sharedInboxRACI[RACIKey] = next
		}
	}
	for assignmentKey, assignment := range r.gvicAssignments {
		if assignment.CompanyID == companyID && assignment.PrincipalType == EntityPermissionSubjectGroup && groupIDs[assignment.PrincipalID] {
			delete(r.gvicAssignments, assignmentKey)
		}
	}
	r.syncRACIResourceKeysLocked(companyID, affectedRACIKeys)
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
	sortCompanyUserGroupMembers(items)
	return items, nil
}

func (r *MemoryRepo) ListEntityPermissions(companyID, entityType, entityID string) ([]domain.EntityPermission, error) {
	policy, err := r.GetResourcePermissionPolicy(companyID, entityType, entityID)
	if err != nil {
		return nil, err
	}
	return policy.Permissions, nil
}

func (r *MemoryRepo) SetEntityPermissions(input EntityPermissionUpdateInput) ([]domain.EntityPermission, error) {
	current, err := r.GetResourcePermissionPolicy(input.CompanyID, input.EntityType, input.EntityID)
	if err != nil {
		return nil, err
	}
	action := PolicyDescendantActionInheritedOnly
	if input.ApplyToDescendants {
		action = PolicyDescendantActionIncludingCustomized
	}
	var defaultAccess *string
	if input.DefaultAccessSet {
		value := input.DefaultAccess
		defaultAccess = &value
	} else {
		defaultAccess = &current.EffectiveDefaultAccess
	}
	updated, _, err := r.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: input.CompanyID, ResourceType: input.EntityType, ResourceID: input.EntityID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: defaultAccess, Permissions: input.Permissions,
		DescendantAction: action, ExpectedRevision: current.Revision, ActorUserID: input.ActorUserID,
	})
	if err != nil {
		return nil, err
	}
	return updated.Permissions, nil
}

func (r *MemoryRepo) ListAccessibleEntityIDs(companyID, entityType, userID, accessLevel string, entityIDs []string) (map[string]bool, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	entityType, typeOK := NormalizeEntityType(entityType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || userID == "" || !typeOK || !accessOK || !usesDefaultResourceAccessPolicy(entityType) {
		return nil, ErrInvalid
	}

	cleanIDs := make([]string, 0, len(entityIDs))
	seen := map[string]bool{}
	for _, rawID := range entityIDs {
		entityID := strings.TrimSpace(rawID)
		if entityID == "" || seen[entityID] {
			continue
		}
		seen[entityID] = true
		cleanIDs = append(cleanIDs, entityID)
	}
	if len(cleanIDs) == 0 {
		return map[string]bool{}, nil
	}
	return r.ListEffectiveResourceIDsForUser(companyID, userID, entityType, accessLevel, cleanIDs)
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
	return EntityPermissionRank(accessLevel)
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

func (r *MemoryRepo) applyResourcePermissionPolicyToDescendantsLocked(input EntityPermissionUpdateInput, policySequence int64, currentDefault string, currentAssignments []resourcePermissionAssignment) ([]resourcePermissionTarget, error) {
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
	r.recordPermissionSubtreeApplicationsLocked(companyID, resourceType, resourceID, policySequence, currentDefault, currentAssignments)
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
	if targetType == EntityTypeLogicGate {
	}
	return changed, nil
}
