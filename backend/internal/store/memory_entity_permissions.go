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
	group.UpdatedTimestamp = time.Now().UTC()
	r.userGroups[userGroupKey(companyID, group.GroupID)] = group
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
	for descendantID := range groupIDs {
		delete(r.userGroups, userGroupKey(companyID, descendantID))
	}
	for memberKey, member := range r.userGroupMembers {
		if member.CompanyID == companyID && groupIDs[member.GroupID] {
			delete(r.userGroupMembers, memberKey)
		}
	}
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.SubjectType == EntityPermissionSubjectGroup && groupIDs[permission.SubjectID] {
			delete(r.entityPermissions, permissionKey)
		}
	}
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
			return nil, ErrAssigneeNotInCompany
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
			if _, ok := r.memberships[membershipKey(companyID, subjectID)]; !ok {
				return nil, ErrAssigneeNotInCompany
			}
		} else if _, ok := r.userGroups[userGroupKey(companyID, subjectID)]; !ok {
			return nil, ErrNotFound
		}
		key := subjectType + ":" + subjectID + ":" + permission
		if seen[key] {
			continue
		}
		seen[key] = true
		normalized = append(normalized, normalizedPermission{subjectType: subjectType, subjectID: subjectID, permission: permission})
	}
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.EntityType == entityType && permission.EntityID == entityID {
			delete(r.entityPermissions, permissionKey)
		}
	}
	now := time.Now().UTC()
	out := make([]domain.EntityPermission, 0, len(normalized))
	for _, item := range normalized {
		permission := domain.EntityPermission{
			CompanyID:        companyID,
			EntityType:       entityType,
			EntityID:         entityID,
			SubjectType:      item.subjectType,
			SubjectID:        item.subjectID,
			Permission:       item.permission,
			AccessLevel:      item.permission,
			CreatedTimestamp: now,
		}
		r.entityPermissions[entityPermissionKey(companyID, entityType, entityID, item.subjectType, item.subjectID, item.permission)] = permission
		out = append(out, r.withEntityPermissionSubjectLocked(permission))
	}
	sortEntityPermissions(out)
	return out, nil
}

func (r *MemoryRepo) UserCanViewEntity(companyID, entityType, entityID, userID string) (bool, error) {
	return r.UserCanAccessEntity(companyID, entityType, entityID, userID, EntityPermissionView)
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
	case EntityTypeSharedTriageFolder:
		item, ok := r.folders[key(companyID, entityID)]
		return ok && item.FolderKind == "communications"
	default:
		return false
	}
}

func (r *MemoryRepo) userCanAccessEntityLocked(companyID, entityType, entityID, userID, accessLevel string) bool {
	requiredRank := entityPermissionRank(accessLevel)
	if requiredRank == 0 {
		return false
	}
	hasRestriction := false
	for _, permission := range r.entityPermissions {
		if permission.CompanyID != companyID || permission.EntityType != entityType || permission.EntityID != entityID {
			continue
		}
		hasRestriction = true
		if entityPermissionRank(permission.Permission) < requiredRank {
			continue
		}
		if permission.SubjectType == EntityPermissionSubjectUser && permission.SubjectID == userID {
			return true
		}
		if permission.SubjectType != EntityPermissionSubjectGroup {
			continue
		}
		groupIDs := companyUserGroupSubtreeIDsLocked(r.userGroups, companyID, permission.SubjectID)
		for groupID := range groupIDs {
			if _, ok := r.userGroupMembers[userGroupMemberKey(companyID, groupID, userID)]; ok {
				return true
			}
		}
	}
	if !hasRestriction {
		return entityTypeDefaultsToFullAccess(entityType) || accessLevel == EntityPermissionView
	}
	return false
}

func entityPermissionRank(accessLevel string) int {
	switch strings.TrimSpace(accessLevel) {
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

func entityTypeDefaultsToFullAccess(entityType string) bool {
	switch strings.TrimSpace(entityType) {
	case EntityTypeNode, EntityTypeLogicGate:
		return true
	default:
		return false
	}
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
