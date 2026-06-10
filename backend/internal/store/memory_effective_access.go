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

func (r *MemoryRepo) recomputeNodeAssigneeEffectiveAccessLocked(companyID, nodeID string) error {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	if companyID == "" || nodeID == "" {
		return ErrInvalid
	}
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) recomputeLogicGateRaciEffectiveAccessLocked(companyID, logicGateID string) error {
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

func (r *MemoryRepo) recomputeSharedTriageRaciEffectiveAccessForResourceLocked(companyID, folderID string) error {
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
	return nil
}

func (r *MemoryRepo) recomputeGroupDependentEffectiveAccessForCompanyLocked(companyID string) error {
	if strings.TrimSpace(companyID) == "" {
		return ErrInvalid
	}
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
	case EntityTypeNode, EntityTypeLogicGate, EntityTypeProject:
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
		hasOverride := r.resourceAccessOverrideExistsLocked(companyID, resourceType, resourceID, userID)
		return (defaultAccess == ResourceDefaultAccessEdit) != hasOverride
	case EntityTypeSharedTriageFolder:
		return r.userHasSharedTriagePermissionLocked(companyID, resourceID, userID, accessLevel)
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
	default:
		return "", false
	}
}

func (r *MemoryRepo) resourceAccessOverrideExistsLocked(companyID, resourceType, resourceID, userID string) bool {
	for _, permission := range r.entityPermissions {
		if permission.CompanyID == companyID &&
			permission.EntityType == resourceType &&
			permission.EntityID == resourceID &&
			permission.SubjectType == EntityPermissionSubjectUser &&
			permission.SubjectID == userID {
			return true
		}
	}
	return false
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
