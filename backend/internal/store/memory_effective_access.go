package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

func (r *MemoryRepo) replaceEffectiveFactsForResourceSourceLocked(companyID, resourceType, resourceID, sourceType string, facts []domain.EffectiveResourceAccess) error {
	return validateEffectiveAccessCompatibilityScope(companyID, resourceType, resourceID)
}

func (r *MemoryRepo) deleteEffectiveFactsForResourceSourceLocked(companyID, resourceType, resourceID, sourceType string) error {
	return validateEffectiveAccessCompatibilityScope(companyID, resourceType, resourceID)
}

func (r *MemoryRepo) deleteEffectiveFactsForResourceLocked(companyID, resourceType, resourceID string) error {
	return validateEffectiveAccessCompatibilityScope(companyID, resourceType, resourceID)
}

func (r *MemoryRepo) deleteEffectiveFactsForCompanyUserLocked(companyID, userID string) error {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return ErrInvalid
	}
	return nil
}

func (r *MemoryRepo) replaceEffectiveFactsForSourceLocked(companyID, sourceType, sourceID string, facts []domain.EffectiveResourceAccess) error {
	companyID = strings.TrimSpace(companyID)
	sourceType = strings.TrimSpace(sourceType)
	sourceID = strings.TrimSpace(sourceID)
	if companyID == "" || sourceType == "" || sourceID == "" {
		return ErrInvalid
	}
	return nil
}

func (r *MemoryRepo) deleteEffectiveFactsForSourceLocked(companyID, sourceType, sourceID string) error {
	companyID = strings.TrimSpace(companyID)
	sourceType = strings.TrimSpace(sourceType)
	sourceID = strings.TrimSpace(sourceID)
	if companyID == "" || sourceType == "" || sourceID == "" {
		return ErrInvalid
	}
	return nil
}

func (r *MemoryRepo) recomputeLogicGateGVICEffectiveAccessLocked(companyID, logicGateID string) error {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return ErrInvalid
	}
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) recomputeSharedTriageGVICEffectiveAccessForResourceLocked(companyID, folderID string) error {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" || folderID == "" {
		return ErrInvalid
	}
	folder, ok := r.folders[key(companyID, folderID)]
	if !ok || folder.FolderKind != "communications" {
		return ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) recomputeSharedTriageInheritedEffectiveAccessForSubtreeLocked(companyID, folderID string) error {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" || folderID == "" {
		return ErrInvalid
	}
	if _, ok := r.folders[key(companyID, folderID)]; !ok {
		return ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) recomputeLogicGateAssignedNodeVisibilityLocked(companyID string, logicGateIDs, nodeIDs []string) error {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return ErrInvalid
	}
	keys := make([]resourceGVICKey, 0)
	for _, nodeID := range nodeIDs {
		nodeID = strings.TrimSpace(nodeID)
		if nodeID != "" {
			keys = append(keys, resourceGVICKey{companyID: companyID, resourceType: EntityTypeNode, resourceID: nodeID})
		}
	}
	for _, logicGateID := range logicGateIDs {
		logicGateID = strings.TrimSpace(logicGateID)
		if logicGateID != "" {
			keyValue := resourceGVICKey{companyID: companyID, resourceType: EntityTypeLogicGate, resourceID: logicGateID}
			keys = append(keys, r.affectedGVICResourceKeysLocked(keyValue)...)
		}
	}
	r.syncResourceGVICEffectiveAssignmentsLocked(keys)
	return nil
}

func (r *MemoryRepo) recomputeGroupDependentEffectiveAccessForCompanyLocked(companyID string) error {
	if strings.TrimSpace(companyID) == "" {
		return ErrInvalid
	}
	r.syncGVICGroupDependentResourcesLocked(companyID)
	return nil
}

func (r *MemoryRepo) recomputeGroupDependentEffectiveAccessForGroupsLocked(companyID string, groupIDs []string) error {
	if strings.TrimSpace(companyID) == "" {
		return ErrInvalid
	}
	r.syncGVICGroupDependentResourcesForGroupsLocked(companyID, groupIDs)
	return nil
}

func (r *MemoryRepo) recomputeDirectGrantEffectiveAccessForResourceLocked(companyID, resourceType, resourceID string) error {
	return validateEffectiveAccessCompatibilityScope(companyID, resourceType, resourceID)
}

func (r *MemoryRepo) recomputeCompanyAdminEffectiveAccessForUserLocked(userID string) error {
	if strings.TrimSpace(userID) == "" {
		return ErrInvalid
	}
	return nil
}

func (r *MemoryRepo) recomputeCompanyAdminEffectiveAccessForResourceLocked(companyID, resourceType, resourceID string) error {
	return validateEffectiveAccessCompatibilityScope(companyID, resourceType, resourceID)
}

func (r *MemoryRepo) recomputeCompanyMemberDefaultEffectiveAccessForResourceLocked(companyID, resourceType, resourceID string) error {
	return validateEffectiveAccessCompatibilityScope(companyID, resourceType, resourceID)
}

func (r *MemoryRepo) recomputeCompanyMemberDefaultEffectiveAccessForUserLocked(companyID, userID string) error {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return ErrInvalid
	}
	return nil
}

func (r *MemoryRepo) UserHasEffectiveAccess(companyID, userID, resourceType, resourceID, accessLevel string) (bool, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	resourceID = strings.TrimSpace(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || userID == "" || resourceID == "" || !typeOK || !accessOK || EntityPermissionRank(accessLevel) == 0 {
		return false, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

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

	r.mu.RLock()
	defer r.mu.RUnlock()

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

	r.mu.RLock()
	defer r.mu.RUnlock()

	if !r.entityExistsLocked(companyID, resourceType, resourceID) {
		return nil, ErrNotFound
	}
	seen := r.effectiveUserIDsForResourceLocked(companyID, resourceType, resourceID, accessLevel)
	out := mapKeys(seen)
	sort.Strings(out)
	return out, nil
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

func (r *MemoryRepo) ListEffectiveUsersForWorkspaceEvent(event domain.DomainEvent) ([]string, error) {
	targets := WorkspaceEventAccessTargets(event)
	if len(targets) == 0 {
		return []string{}, nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	return r.effectiveUsersForWorkspaceEventLocked(event), nil
}

func (r *MemoryRepo) effectiveUsersForWorkspaceEventLocked(event domain.DomainEvent) []string {
	targets := WorkspaceEventAccessTargets(event)
	if len(targets) == 0 {
		return []string{}
	}
	seen := map[string]bool{}
	for _, target := range targets {
		resourceSeen := r.effectiveUserIDsForResourceLocked(event.CompanyID, target.ResourceType, target.ResourceID, EntityPermissionView)
		for userID := range resourceSeen {
			seen[userID] = true
		}
	}
	return sortWorkspaceEventUserIDs(seen)
}

func (r *MemoryRepo) userHasEffectiveAccessLocked(companyID, userID, resourceType, resourceID, accessLevel string) bool {
	return r.userHasResourcePermissionLocked(companyID, userID, resourceType, resourceID, accessLevel)
}

func (r *MemoryRepo) effectiveAccessLevelForUserLocked(companyID, userID, resourceType, resourceID string) string {
	if r.userHasRoleAdminAccessLocked(companyID, userID) {
		return EntityPermissionAdmin
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
	switch resourceType {
	case EntityTypeNode, EntityTypeLogicGate, EntityTypeProject, EntityTypeCompanyExplorerFolder, EntityTypeSharedInboxFolder, EntityTypeSharedInbox:
		if accessLevel == EntityPermissionAdmin {
			return false
		}
		if _, ok := r.memberships[membershipKey(companyID, userID)]; !ok {
			return false
		}
		defaultAccess, ok := r.defaultAccessForResourceLocked(companyID, resourceType, resourceID)
		if !ok {
			return false
		}
		resolvedAccess := r.resourcePermissionAccessLevelForUserLocked(companyID, userID, resourceType, resourceID, defaultAccess)
		if EntityPermissionRank(resolvedAccess) == 0 {
			return false
		}
		return EntityPermissionSatisfies(resolvedAccess, accessLevel)
	default:
		return false
	}
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

func validateEffectiveAccessCompatibilityScope(companyID, resourceType, resourceID string) error {
	companyID = strings.TrimSpace(companyID)
	resourceID = strings.TrimSpace(resourceID)
	_, typeOK := NormalizeEntityType(resourceType)
	if companyID == "" || resourceID == "" || !typeOK {
		return ErrInvalid
	}
	return nil
}
