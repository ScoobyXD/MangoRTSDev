package store

import (
	"context"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

func (r *MemoryRepo) UserHasEffectiveAccess(companyID, userID, resourceType, resourceID, accessLevel string) (bool, error) {
	return r.UserHasEffectiveAccessContext(context.Background(), companyID, userID, resourceType, resourceID, accessLevel)
}

func (r *MemoryRepo) UserHasEffectiveAccessContext(ctx context.Context, companyID, userID, resourceType, resourceID, accessLevel string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	resourceID = strings.TrimSpace(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || userID == "" || resourceID == "" || !typeOK || !accessOK || EntityPermissionRank(accessLevel) == 0 {
		return false, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return false, err
	}

	if !r.entityExistsLocked(companyID, resourceType, resourceID) {
		return false, ErrNotFound
	}
	return r.userHasEffectiveAccessLocked(companyID, userID, resourceType, resourceID, accessLevel), nil
}

func (r *MemoryRepo) ListEffectiveResourceIDsForUser(companyID, userID, resourceType, accessLevel string, resourceIDs []string) (map[string]bool, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || userID == "" || !typeOK || !accessOK || EntityPermissionRank(accessLevel) == 0 {
		return nil, ErrInvalid
	}

	filter := make(map[string]bool, len(resourceIDs))
	for _, rawID := range resourceIDs {
		resourceID := strings.TrimSpace(rawID)
		if resourceID != "" {
			filter[resourceID] = true
		}
	}
	if len(filter) == 0 {
		return map[string]bool{}, nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	out := map[string]bool{}
	for resourceID := range filter {
		if r.entityExistsLocked(companyID, resourceType, resourceID) && r.userHasEffectiveAccessLocked(companyID, userID, resourceType, resourceID, accessLevel) {
			out[resourceID] = true
		}
	}
	return out, nil
}

func (r *MemoryRepo) ListEffectiveUsersForResource(companyID, resourceType, resourceID, accessLevel string) ([]string, error) {
	companyID = strings.TrimSpace(companyID)
	resourceID = strings.TrimSpace(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || resourceID == "" || !typeOK || !accessOK || EntityPermissionRank(accessLevel) == 0 {
		return nil, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.entityExistsLocked(companyID, resourceType, resourceID) {
		return nil, ErrNotFound
	}
	seen := r.effectiveUserIDsForResourceLocked(companyID, resourceType, resourceID, accessLevel)
	out := mapKeys(seen)
	sort.Strings(out)
	return out, nil
}

func (r *MemoryRepo) ResolveEffectiveUsersForResource(ctx context.Context, companyID, resourceType, resourceID, accessLevel string, candidateUserIDs []string) (bool, []string, error) {
	companyID = strings.TrimSpace(companyID)
	resourceID = strings.TrimSpace(resourceID)
	resourceType = strings.ToLower(strings.TrimSpace(resourceType))
	_, typeOK := NormalizeEntityType(resourceType)
	if resourceType == EntityTypeKPI {
		typeOK = true
	}
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if ctx == nil || companyID == "" || resourceID == "" || !typeOK || !accessOK || EntityPermissionRank(accessLevel) == 0 {
		return false, nil, ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return false, nil, err
	}

	candidateUserIDs = cleanUUIDTextSlice(candidateUserIDs)

	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return false, nil, err
	}
	if resourceType == EntityTypeKPI {
		kpi, ok := r.kpis[key(companyID, resourceID)]
		if !ok {
			return false, []string{}, nil
		}
		resourceType = EntityTypeLogicGate
		resourceID = kpi.LogicGateID
	} else {
		resourceType, _ = NormalizeEntityType(resourceType)
	}
	if !r.entityExistsLocked(companyID, resourceType, resourceID) {
		return false, []string{}, nil
	}
	userIDs := make([]string, 0, len(candidateUserIDs))
	for _, userID := range candidateUserIDs {
		if r.userHasEffectiveAccessLocked(companyID, userID, resourceType, resourceID, accessLevel) {
			userIDs = append(userIDs, userID)
		}
	}
	return true, userIDs, nil
}

func (r *MemoryRepo) effectiveUserIDsForResourceLocked(companyID, resourceType, resourceID, accessLevel string) map[string]bool {
	seen := map[string]bool{}
	for _, membership := range r.memberships {
		userID := strings.TrimSpace(membership.UserID)
		if userID == "" || seen[userID] {
			continue
		}
		if membership.CompanyID != companyID && membership.Role != domain.RoleDevAdmin {
			continue
		}
		if r.userHasEffectiveAccessLocked(companyID, userID, resourceType, resourceID, accessLevel) {
			seen[userID] = true
		}
	}
	return seen
}

func (r *MemoryRepo) userHasEffectiveAccessLocked(companyID, userID, resourceType, resourceID, accessLevel string) bool {
	return r.userHasResourcePermissionLocked(companyID, userID, resourceType, resourceID, accessLevel)
}

func (r *MemoryRepo) effectiveAccessLevelForUserLocked(companyID, userID, resourceType, resourceID string) string {
	if r.userHasRoleAdminAccessLocked(companyID, userID) {
		return EntityPermissionEdit
	}
	if r.userHasResourcePermissionLocked(companyID, userID, resourceType, resourceID, EntityPermissionEdit) {
		return EntityPermissionEdit
	}
	return EntityPermissionNoAccess
}

func (r *MemoryRepo) userHasResourcePermissionLocked(companyID, userID, resourceType, resourceID, accessLevel string) bool {
	requiredRank := EntityPermissionRank(accessLevel)
	if requiredRank == 0 {
		return false
	}
	if r.userHasRoleAdminAccessLocked(companyID, userID) {
		return true
	}
	if _, ok := r.memberships[membershipKey(companyID, userID)]; !ok {
		return false
	}
	if !r.ensureV2PolicySettingsLocked(companyID, resourceType, resourceID) {
		return false
	}
	resolved := r.resolveV2PolicyLocked(companyID, resourceType, resourceID, false)
	if resolved.SourceID == "" {
		return false
	}
	edges := r.directMemoryPermissionEdgesLocked(companyID, resolved.SourceType, resolved.SourceID)
	assignments := make([]resourcePermissionAssignment, 0, len(edges))
	for _, edge := range edges {
		assignments = append(assignments, resourcePermissionAssignment{SubjectType: edge.SubjectType, SubjectID: edge.SubjectID, AccessLevel: edge.AccessLevel})
	}
	resolvedAccess, matched := r.permissionAccessLevelForUserFromAssignmentsLocked(companyID, userID, assignments)
	if !matched {
		setting := r.permissionV2Settings[resourcePolicyKey(companyID, resolved.SourceType, resolved.SourceID)]
		resolvedAccess = setting.DefaultAccess
	}
	return EntityPermissionSatisfies(resolvedAccess, accessLevel)
}
func (r *MemoryRepo) userHasDefaultResourceAccessLocked(companyID, userID, resourceType, resourceID string) bool {
	return r.userHasResourcePermissionLocked(companyID, userID, resourceType, resourceID, EntityPermissionEdit)
}

func (r *MemoryRepo) defaultAccessForResourceLocked(companyID, resourceType, resourceID string) (string, bool) {
	switch resourceType {
	case EntityTypeNode:
		node, ok := r.nodes[key(companyID, resourceID)]
		if !ok {
			return "", false
		}
		return defaultResourceAccessOrEdit(node.DefaultAccess), true
	case EntityTypeLogicGate:
		gate, ok := r.logicGates[key(companyID, resourceID)]
		if !ok {
			return "", false
		}
		return defaultResourceAccessOrEdit(gate.DefaultAccess), true
	case EntityTypeProject:
		project, ok := r.projects[key(companyID, resourceID)]
		if !ok {
			return "", false
		}
		return defaultResourceAccessOrEdit(project.DefaultAccess), true
	case EntityTypeCompanyExplorerFolder:
		if entity, ok := r.companyExplorerV2Entities[key(companyID, resourceID)]; ok && entity.EntityType == CompanyExplorerV2EntityFolder {
			return defaultResourceAccessOrEdit(entity.DefaultAccess), true
		}
		folder, ok := r.folders[key(companyID, resourceID)]
		if !ok || folder.FolderKind == "communications" {
			return "", false
		}
		return defaultResourceAccessOrEdit(folder.DefaultAccess), true
	case EntityTypeSharedInboxFolder:
		folder, ok := r.folders[key(companyID, resourceID)]
		if !ok || folder.FolderKind != "communications" || normalizeCommunicationsSharedInboxEntryType(folder.EntryType, folder.AccountEmail != nil) != CommunicationsSharedInboxEntryTypeFolder {
			return "", false
		}
		return defaultResourceAccessOrEdit(folder.DefaultAccess), true
	case EntityTypeSharedInbox:
		folder, ok := r.folders[key(companyID, resourceID)]
		if !ok || folder.FolderKind != "communications" || normalizeCommunicationsSharedInboxEntryType(folder.EntryType, folder.AccountEmail != nil) != CommunicationsSharedInboxEntryTypeSharedInbox {
			return "", false
		}
		return defaultResourceAccessOrEdit(folder.DefaultAccess), true
	default:
		return "", false
	}
}

func (r *MemoryRepo) directResourcePermissionAccessLevelLocked(companyID, resourceType, resourceID, userID string) (string, bool) {
	for _, permission := range r.entityPermissions {
		if permission.CompanyID == companyID &&
			permission.EntityType == resourceType &&
			permission.EntityID == resourceID &&
			permission.SubjectType == EntityPermissionSubjectUser &&
			permission.SubjectID == userID {
			accessLevel, ok := NormalizeEntityPermission(permission.AccessLevel)
			if !ok {
				accessLevel, ok = NormalizeEntityPermission(permission.Permission)
			}
			if !ok {
				return "", false
			}
			return accessLevel, true
		}
	}
	return "", false
}

func (r *MemoryRepo) resourceAccessOverrideExistsLocked(companyID, resourceType, resourceID, userID string) bool {
	_, ok := r.directResourcePermissionAccessLevelLocked(companyID, resourceType, resourceID, userID)
	return ok
}

func (r *MemoryRepo) resourcePermissionAccessLevelForUserLocked(companyID, userID, resourceType, resourceID, defaultAccess string) string {
	if directAccess, ok := r.directResourcePermissionAccessLevelLocked(companyID, resourceType, resourceID, userID); ok {
		return directAccess
	}
	bestAccess := ""
	bestDepth := int(^uint(0) >> 1)
	bestRank := int(^uint(0) >> 1)
	for _, permission := range r.entityPermissions {
		if permission.CompanyID != companyID ||
			permission.EntityType != resourceType ||
			permission.EntityID != resourceID ||
			permission.SubjectType != EntityPermissionSubjectGroup {
			continue
		}
		depth, ok := r.userGroupPermissionDepthLocked(companyID, userID, permission.SubjectID)
		if !ok {
			continue
		}
		accessLevel, ok := NormalizeEntityPermission(permission.AccessLevel)
		if !ok {
			accessLevel, ok = NormalizeEntityPermission(permission.Permission)
		}
		if !ok {
			continue
		}
		rank := EntityPermissionRank(accessLevel)
		if bestAccess == "" || depth < bestDepth || (depth == bestDepth && rank < bestRank) {
			bestAccess = accessLevel
			bestDepth = depth
			bestRank = rank
		}
	}
	if bestAccess != "" {
		return bestAccess
	}
	return defaultResourceAccessOrEdit(defaultAccess)
}

func (r *MemoryRepo) userGroupPermissionDepthLocked(companyID, userID, ancestorGroupID string) (int, bool) {
	ancestorGroupID = strings.TrimSpace(ancestorGroupID)
	if ancestorGroupID == "" {
		return 0, false
	}
	if _, ok := r.userGroups[userGroupKey(companyID, ancestorGroupID)]; !ok {
		return 0, false
	}
	type queuedGroup struct {
		groupID string
		depth   int
	}
	queue := []queuedGroup{{groupID: ancestorGroupID, depth: 0}}
	seen := map[string]bool{ancestorGroupID: true}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if _, ok := r.userGroupMembers[userGroupMemberKey(companyID, current.groupID, userID)]; ok {
			return current.depth, true
		}
		for _, group := range r.userGroups {
			if group.CompanyID != companyID || group.ParentGroupID == nil {
				continue
			}
			parentID := strings.TrimSpace(*group.ParentGroupID)
			if parentID != current.groupID || seen[group.GroupID] {
				continue
			}
			seen[group.GroupID] = true
			queue = append(queue, queuedGroup{groupID: group.GroupID, depth: current.depth + 1})
		}
	}
	return 0, false
}
