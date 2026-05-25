package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

type effectiveAccessResource struct {
	resourceType string
	resourceID   string
}

type legacyGrantEffectiveAccessCandidate struct {
	userID       string
	resourceType string
	resourceID   string
	accessLevel  string
	sourceType   string
	sourceID     string
	sourceTime   time.Time
	depth        int
	subjectRank  int
	accessRank   int
}

const (
	effectiveAccessSourceDirectUserGrant  = "direct_user_grant"
	effectiveAccessSourceDirectGroupGrant = "direct_group_grant"
	effectiveAccessSourceCompanyDefault   = "company_member_default"
	effectiveAccessSourceCompanyAdmin     = "company_admin"
	effectiveAccessSourceNodeAssignee     = "node_assignee"
	effectiveAccessSourceLogicGateRaci    = "logic_gate_raci"
	effectiveAccessSourceSharedTriageRaci = "shared_triage_raci"
	effectiveAccessSourceGateVisibility   = "logic_gate_assignment_visibility"
)

func (r *MemoryRepo) RebuildEffectiveResourceAccessForCompany(companyID string) error {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	return r.rebuildEffectiveResourceAccessForCompanyLocked(companyID)
}

func (r *MemoryRepo) rebuildEffectiveResourceAccessForCompanyLocked(companyID string) error {
	if r.effectiveAccessErr != nil {
		return r.effectiveAccessErr
	}
	now := time.Now().UTC()
	next := make(map[string]domain.EffectiveResourceAccess)
	r.projectLegacyGrantEffectiveAccessLocked(companyID, next, now)
	r.projectCompanyMemberDefaultEffectiveAccessLocked(companyID, next, now)
	r.projectCompanyAdminEffectiveAccessLocked(companyID, next, now)
	r.projectNodeAssigneeEffectiveAccessLocked(companyID, next, now)
	r.projectLogicGateAssignmentVisibilityLocked(companyID, next, now)

	for accessKey, access := range r.effectiveAccess {
		if access.CompanyID == companyID {
			delete(r.effectiveAccess, accessKey)
		}
	}
	for accessKey, access := range next {
		r.effectiveAccess[accessKey] = access
	}
	return nil
}

func (r *MemoryRepo) replaceEffectiveFactsForResourceSourceLocked(companyID, resourceType, resourceID, sourceType string, facts []domain.EffectiveResourceAccess) error {
	companyID, resourceType, resourceID, sourceType, err := normalizeEffectiveAccessResourceSourceScope(companyID, resourceType, resourceID, sourceType)
	if err != nil {
		return err
	}
	facts, err = normalizeEffectiveAccessFactsForResourceSource(companyID, resourceType, resourceID, sourceType, facts)
	if err != nil {
		return err
	}
	if err := r.deleteEffectiveFactsForResourceSourceLocked(companyID, resourceType, resourceID, sourceType); err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, fact := range facts {
		addEffectiveAccessFact(r.effectiveAccess, now, fact)
	}
	return nil
}

func (r *MemoryRepo) deleteEffectiveFactsForResourceSourceLocked(companyID, resourceType, resourceID, sourceType string) error {
	companyID, resourceType, resourceID, sourceType, err := normalizeEffectiveAccessResourceSourceScope(companyID, resourceType, resourceID, sourceType)
	if err != nil {
		return err
	}
	if r.effectiveAccessErr != nil {
		return r.effectiveAccessErr
	}
	for accessKey, access := range r.effectiveAccess {
		if access.CompanyID == companyID &&
			access.ResourceType == resourceType &&
			access.ResourceID == resourceID &&
			access.SourceType == sourceType {
			delete(r.effectiveAccess, accessKey)
		}
	}
	return nil
}

func (r *MemoryRepo) deleteEffectiveFactsForResourceLocked(companyID, resourceType, resourceID string) error {
	companyID = strings.TrimSpace(companyID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	if companyID == "" || !typeOK || resourceID == "" {
		return ErrInvalid
	}
	if r.effectiveAccessErr != nil {
		return r.effectiveAccessErr
	}
	for accessKey, access := range r.effectiveAccess {
		if access.CompanyID == companyID &&
			access.ResourceType == resourceType &&
			access.ResourceID == resourceID {
			delete(r.effectiveAccess, accessKey)
		}
	}
	return nil
}

func (r *MemoryRepo) deleteEffectiveFactsForCompanyUserLocked(companyID, userID string) error {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return ErrInvalid
	}
	if r.effectiveAccessErr != nil {
		return r.effectiveAccessErr
	}
	for accessKey, access := range r.effectiveAccess {
		if access.CompanyID == companyID && access.UserID == userID {
			delete(r.effectiveAccess, accessKey)
		}
	}
	return nil
}

func (r *MemoryRepo) replaceEffectiveFactsForSourceLocked(companyID, sourceType, sourceID string, facts []domain.EffectiveResourceAccess) error {
	companyID, sourceType, sourceID, err := normalizeEffectiveAccessSourceScope(companyID, sourceType, sourceID)
	if err != nil {
		return err
	}
	facts, err = normalizeEffectiveAccessFactsForSource(companyID, sourceType, sourceID, facts)
	if err != nil {
		return err
	}
	if err := r.deleteEffectiveFactsForSourceLocked(companyID, sourceType, sourceID); err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, fact := range facts {
		addEffectiveAccessFact(r.effectiveAccess, now, fact)
	}
	return nil
}

func (r *MemoryRepo) deleteEffectiveFactsForSourceLocked(companyID, sourceType, sourceID string) error {
	companyID, sourceType, sourceID, err := normalizeEffectiveAccessSourceScope(companyID, sourceType, sourceID)
	if err != nil {
		return err
	}
	if r.effectiveAccessErr != nil {
		return r.effectiveAccessErr
	}
	for accessKey, access := range r.effectiveAccess {
		if access.CompanyID == companyID &&
			access.SourceType == sourceType &&
			access.SourceID == sourceID {
			delete(r.effectiveAccess, accessKey)
		}
	}
	return nil
}

func (r *MemoryRepo) recomputeNodeAssigneeEffectiveAccessLocked(companyID, nodeID string) error {
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return ErrNotFound
	}
	return r.rebuildEffectiveResourceAccessForCompanyLocked(companyID)
}

func (r *MemoryRepo) recomputeLogicGateRaciEffectiveAccessLocked(companyID, logicGateID string) error {
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return ErrNotFound
	}
	return r.rebuildEffectiveResourceAccessForCompanyLocked(companyID)
}

func (r *MemoryRepo) recomputeSharedTriageRaciEffectiveAccessForResourceLocked(companyID, folderID string) error {
	folder, ok := r.folders[key(companyID, folderID)]
	if !ok || folder.FolderKind != "communications" {
		return ErrNotFound
	}
	return r.rebuildEffectiveResourceAccessForCompanyLocked(companyID)
}

func (r *MemoryRepo) recomputeSharedTriageInheritedEffectiveAccessForSubtreeLocked(companyID, folderID string) error {
	if _, ok := r.folders[key(companyID, folderID)]; !ok {
		return ErrNotFound
	}
	return r.rebuildEffectiveResourceAccessForCompanyLocked(companyID)
}

func (r *MemoryRepo) recomputeLogicGateAssignedNodeVisibilityLocked(companyID string, logicGateIDs, nodeIDs []string) error {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return ErrInvalid
	}
	return r.rebuildEffectiveResourceAccessForCompanyLocked(companyID)
}

func (r *MemoryRepo) recomputeGroupDependentEffectiveAccessForCompanyLocked(companyID string) error {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return ErrInvalid
	}
	return r.rebuildEffectiveResourceAccessForCompanyLocked(companyID)
}

func (r *MemoryRepo) recomputeDirectGrantEffectiveAccessForResourceLocked(companyID, resourceType, resourceID string) error {
	companyID = strings.TrimSpace(companyID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	if companyID == "" || !typeOK || resourceID == "" {
		return ErrInvalid
	}
	return r.rebuildEffectiveResourceAccessForCompanyLocked(companyID)
}

func (r *MemoryRepo) recomputeCompanyAdminEffectiveAccessForUserLocked(userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ErrInvalid
	}
	companies := map[string]bool{}
	for companyID := range r.companies {
		companies[companyID] = true
	}
	for _, membership := range r.memberships {
		if membership.UserID == userID {
			companies[membership.CompanyID] = true
		}
	}
	for companyID := range companies {
		if err := r.rebuildEffectiveResourceAccessForCompanyLocked(companyID); err != nil {
			return err
		}
	}
	return nil
}

func (r *MemoryRepo) recomputeCompanyAdminEffectiveAccessForResourceLocked(companyID, resourceType, resourceID string) error {
	companyID = strings.TrimSpace(companyID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	if companyID == "" || !typeOK || resourceID == "" {
		return ErrInvalid
	}
	return r.rebuildEffectiveResourceAccessForCompanyLocked(companyID)
}

func (r *MemoryRepo) recomputeCompanyMemberDefaultEffectiveAccessForResourceLocked(companyID, resourceType, resourceID string) error {
	companyID = strings.TrimSpace(companyID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	if companyID == "" || !typeOK || resourceID == "" {
		return ErrInvalid
	}
	return r.rebuildEffectiveResourceAccessForCompanyLocked(companyID)
}

func (r *MemoryRepo) recomputeCompanyMemberDefaultEffectiveAccessForUserLocked(companyID, userID string) error {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return ErrInvalid
	}
	return r.rebuildEffectiveResourceAccessForCompanyLocked(companyID)
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

	for _, access := range r.effectiveAccess {
		if access.CompanyID == companyID &&
			access.UserID == userID &&
			access.ResourceType == resourceType &&
			access.ResourceID == resourceID &&
			EntityPermissionSatisfies(access.AccessLevel, accessLevel) {
			return true, nil
		}
	}
	return false, nil
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
	for _, access := range r.effectiveAccess {
		if access.CompanyID == companyID &&
			access.UserID == userID &&
			access.ResourceType == resourceType &&
			filter[access.ResourceID] &&
			EntityPermissionSatisfies(access.AccessLevel, accessLevel) {
			out[access.ResourceID] = true
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

	seen := map[string]bool{}
	for _, access := range r.effectiveAccess {
		if access.CompanyID == companyID &&
			access.ResourceType == resourceType &&
			access.ResourceID == resourceID &&
			EntityPermissionSatisfies(access.AccessLevel, accessLevel) {
			seen[access.UserID] = true
		}
	}
	out := make([]string, 0, len(seen))
	for userID := range seen {
		out = append(out, userID)
	}
	sort.Strings(out)
	return out, nil
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
		for _, access := range r.effectiveAccess {
			if access.CompanyID == event.CompanyID &&
				access.ResourceType == target.ResourceType &&
				access.ResourceID == target.ResourceID &&
				EntityPermissionSatisfies(access.AccessLevel, EntityPermissionView) {
				seen[access.UserID] = true
			}
		}
	}
	return sortWorkspaceEventUserIDs(seen)
}

func (r *MemoryRepo) userHasEffectiveAccessLocked(companyID, userID, resourceType, resourceID, accessLevel string) bool {
	for _, access := range r.effectiveAccess {
		if access.CompanyID == companyID &&
			access.UserID == userID &&
			access.ResourceType == resourceType &&
			access.ResourceID == resourceID &&
			EntityPermissionSatisfies(access.AccessLevel, accessLevel) {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) effectiveAccessLevelForUserLocked(companyID, userID, resourceType, resourceID string) string {
	bestLevel := ""
	bestRank := 0
	for _, access := range r.effectiveAccess {
		if access.CompanyID != companyID ||
			access.UserID != userID ||
			access.ResourceType != resourceType ||
			access.ResourceID != resourceID {
			continue
		}
		rank := EntityPermissionRank(access.AccessLevel)
		if rank > bestRank {
			bestLevel = access.AccessLevel
			bestRank = rank
		}
	}
	return bestLevel
}

func (r *MemoryRepo) projectLegacyGrantEffectiveAccessLocked(companyID string, facts map[string]domain.EffectiveResourceAccess, now time.Time) {
	bestByUserResource := map[string]legacyGrantEffectiveAccessCandidate{}
	for _, permission := range r.entityPermissions {
		if permission.CompanyID != companyID {
			continue
		}
		resourceType, ok := NormalizeEntityType(permission.EntityType)
		if !ok {
			continue
		}
		accessLevel := strings.TrimSpace(permission.AccessLevel)
		if accessLevel == "" {
			accessLevel = permission.Permission
		}
		accessLevel, ok = NormalizeEntityPermission(accessLevel)
		if !ok {
			continue
		}

		targetDepths := r.effectiveAccessLegacyGrantTargetDepthsLocked(companyID, resourceType, permission.EntityID)
		sourceTime := permission.CreatedTimestamp
		for targetID, depth := range targetDepths {
			sourceID := effectiveAccessSourceID(resourceType, permission.EntityID, permission.SubjectType, permission.SubjectID)
			switch permission.SubjectType {
			case EntityPermissionSubjectUser:
				if _, ok := r.memberships[membershipKey(companyID, permission.SubjectID)]; !ok {
					continue
				}
				candidate := legacyGrantEffectiveAccessCandidate{
					userID:       permission.SubjectID,
					resourceType: resourceType,
					resourceID:   targetID,
					accessLevel:  accessLevel,
					sourceType:   effectiveAccessSourceDirectUserGrant,
					sourceID:     sourceID,
					sourceTime:   sourceTime,
					depth:        depth,
					subjectRank:  2,
					accessRank:   EntityPermissionRank(accessLevel),
				}
				recordBestLegacyGrantEffectiveAccessCandidate(bestByUserResource, candidate)
			case EntityPermissionSubjectGroup:
				groupIDs := companyUserGroupSubtreeIDsLocked(r.userGroups, companyID, permission.SubjectID)
				for _, member := range r.userGroupMembers {
					if member.CompanyID != companyID || !groupIDs[member.GroupID] {
						continue
					}
					candidate := legacyGrantEffectiveAccessCandidate{
						userID:       member.UserID,
						resourceType: resourceType,
						resourceID:   targetID,
						accessLevel:  accessLevel,
						sourceType:   effectiveAccessSourceDirectGroupGrant,
						sourceID:     sourceID,
						sourceTime:   maxEffectiveAccessTime(sourceTime, member.UpdatedTimestamp),
						depth:        depth,
						subjectRank:  3,
						accessRank:   EntityPermissionRank(accessLevel),
					}
					recordBestLegacyGrantEffectiveAccessCandidate(bestByUserResource, candidate)
				}
			}
		}
	}

	candidates := make([]legacyGrantEffectiveAccessCandidate, 0, len(bestByUserResource))
	for _, candidate := range bestByUserResource {
		candidates = append(candidates, candidate)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].userID != candidates[j].userID {
			return candidates[i].userID < candidates[j].userID
		}
		if candidates[i].resourceType != candidates[j].resourceType {
			return candidates[i].resourceType < candidates[j].resourceType
		}
		return candidates[i].resourceID < candidates[j].resourceID
	})
	for _, candidate := range candidates {
		addEffectiveAccessFact(facts, now, domain.EffectiveResourceAccess{
			CompanyID:        companyID,
			UserID:           candidate.userID,
			ResourceType:     candidate.resourceType,
			ResourceID:       candidate.resourceID,
			AccessLevel:      candidate.accessLevel,
			SourceType:       candidate.sourceType,
			SourceID:         candidate.sourceID,
			CreatedTimestamp: candidate.sourceTime,
			UpdatedTimestamp: candidate.sourceTime,
		})
	}
}

func (r *MemoryRepo) projectCompanyMemberDefaultEffectiveAccessLocked(companyID string, facts map[string]domain.EffectiveResourceAccess, now time.Time) {
	memberships := make([]domain.CompanyMembership, 0)
	for _, membership := range r.memberships {
		if membership.CompanyID == companyID {
			memberships = append(memberships, membership)
		}
	}
	if len(memberships) == 0 {
		return
	}
	for _, node := range r.nodes {
		if node.CompanyID != companyID || r.resourceHasDirectEntityPermissionsLocked(companyID, EntityTypeNode, node.NodeID) {
			continue
		}
		for _, membership := range memberships {
			addEffectiveAccessFact(facts, now, domain.EffectiveResourceAccess{
				CompanyID:    companyID,
				UserID:       membership.UserID,
				ResourceType: EntityTypeNode,
				ResourceID:   node.NodeID,
				AccessLevel:  EntityPermissionEdit,
				SourceType:   effectiveAccessSourceCompanyDefault,
				SourceID:     companyMemberDefaultEffectiveAccessSourceID(companyID, membership.UserID),
			})
		}
	}
	for _, gate := range r.logicGates {
		if gate.CompanyID != companyID || r.resourceHasDirectEntityPermissionsLocked(companyID, EntityTypeLogicGate, gate.LogicGateID) {
			continue
		}
		for _, membership := range memberships {
			addEffectiveAccessFact(facts, now, domain.EffectiveResourceAccess{
				CompanyID:    companyID,
				UserID:       membership.UserID,
				ResourceType: EntityTypeLogicGate,
				ResourceID:   gate.LogicGateID,
				AccessLevel:  EntityPermissionEdit,
				SourceType:   effectiveAccessSourceCompanyDefault,
				SourceID:     companyMemberDefaultEffectiveAccessSourceID(companyID, membership.UserID),
			})
		}
	}
}

func (r *MemoryRepo) projectCompanyAdminEffectiveAccessLocked(companyID string, facts map[string]domain.EffectiveResourceAccess, now time.Time) {
	resources := r.effectiveAccessCompanyResourcesLocked(companyID)
	if len(resources) == 0 {
		return
	}
	for _, userID := range r.companyAdminUserIDsForTargetLocked(companyID) {
		sourceMembership, ok := r.companyAdminSourceMembershipForTargetLocked(companyID, userID)
		if !ok {
			continue
		}
		sourceID := effectiveAccessSourceID("membership", sourceMembership.CompanyID, userID)
		for _, resource := range resources {
			addEffectiveAccessFact(facts, now, domain.EffectiveResourceAccess{
				CompanyID:    companyID,
				UserID:       userID,
				ResourceType: resource.resourceType,
				ResourceID:   resource.resourceID,
				AccessLevel:  EntityPermissionAdmin,
				SourceType:   effectiveAccessSourceCompanyAdmin,
				SourceID:     sourceID,
			})
		}
	}
}

func (r *MemoryRepo) projectNodeAssigneeEffectiveAccessLocked(companyID string, facts map[string]domain.EffectiveResourceAccess, now time.Time) {
	for _, node := range r.nodes {
		if node.CompanyID != companyID || node.AssigneeUserID == nil || strings.TrimSpace(*node.AssigneeUserID) == "" {
			continue
		}
		userID := strings.TrimSpace(*node.AssigneeUserID)
		if _, ok := r.memberships[membershipKey(companyID, userID)]; !ok {
			continue
		}
		addEffectiveAccessFact(facts, now, domain.EffectiveResourceAccess{
			CompanyID:    companyID,
			UserID:       userID,
			ResourceType: EntityTypeNode,
			ResourceID:   node.NodeID,
			AccessLevel:  EntityPermissionEdit,
			SourceType:   effectiveAccessSourceNodeAssignee,
			SourceID:     nodeAssigneeEffectiveAccessSourceID(node.NodeID, userID),
		})
	}
}

func (r *MemoryRepo) projectLogicGateRaciEffectiveAccessLocked(companyID string, facts map[string]domain.EffectiveResourceAccess, now time.Time) {
	for _, assignments := range r.logicGateRaci {
		for _, assignment := range assignments {
			if assignment.CompanyID != companyID || strings.TrimSpace(assignment.UserID) == "" {
				continue
			}
			addEffectiveAccessFact(facts, now, domain.EffectiveResourceAccess{
				CompanyID:        companyID,
				UserID:           assignment.UserID,
				ResourceType:     EntityTypeLogicGate,
				ResourceID:       assignment.LogicGateID,
				AccessLevel:      EntityPermissionEdit,
				SourceType:       effectiveAccessSourceLogicGateRaci,
				SourceID:         logicGateRaciEffectiveAccessSourceID(assignment.LogicGateID, assignment.Role, assignment.UserID),
				CreatedTimestamp: assignment.CreatedTimestamp,
				UpdatedTimestamp: assignment.CreatedTimestamp,
			})
		}
	}
}

func (r *MemoryRepo) projectLogicGateAssignmentVisibilityLocked(companyID string, facts map[string]domain.EffectiveResourceAccess, now time.Time) {
	baseFacts := make([]domain.EffectiveResourceAccess, 0, len(facts))
	for _, fact := range facts {
		if fact.CompanyID == companyID && fact.ResourceType == EntityTypeLogicGate {
			baseFacts = append(baseFacts, fact)
		}
	}
	sort.Slice(baseFacts, func(i, j int) bool {
		if baseFacts[i].UserID != baseFacts[j].UserID {
			return baseFacts[i].UserID < baseFacts[j].UserID
		}
		if baseFacts[i].ResourceID != baseFacts[j].ResourceID {
			return baseFacts[i].ResourceID < baseFacts[j].ResourceID
		}
		if baseFacts[i].SourceType != baseFacts[j].SourceType {
			return baseFacts[i].SourceType < baseFacts[j].SourceType
		}
		return baseFacts[i].SourceID < baseFacts[j].SourceID
	})
	for _, fact := range baseFacts {
		for _, assignment := range r.nodeLogicGateAssignments {
			if assignment.CompanyID != companyID || assignment.LogicGateID != fact.ResourceID {
				continue
			}
			if _, ok := r.nodes[key(companyID, assignment.NodeID)]; !ok {
				continue
			}
			addEffectiveAccessFact(facts, now, domain.EffectiveResourceAccess{
				CompanyID:        companyID,
				UserID:           fact.UserID,
				ResourceType:     EntityTypeNode,
				ResourceID:       assignment.NodeID,
				AccessLevel:      fact.AccessLevel,
				SourceType:       effectiveAccessSourceGateVisibility,
				SourceID:         logicGateAssignmentVisibilityEffectiveAccessSourceID(fact.SourceType, fact.SourceID, assignment.LogicGateID, assignment.NodeID),
				CreatedTimestamp: maxEffectiveAccessTime(effectiveAccessFactWriteTime(fact), assignment.UpdatedTimestamp),
				UpdatedTimestamp: maxEffectiveAccessTime(effectiveAccessFactWriteTime(fact), assignment.UpdatedTimestamp),
			})
		}
	}
}

func recordBestLegacyGrantEffectiveAccessCandidate(best map[string]legacyGrantEffectiveAccessCandidate, candidate legacyGrantEffectiveAccessCandidate) {
	key := candidate.userID + ":" + candidate.resourceType + ":" + candidate.resourceID
	existing, ok := best[key]
	if !ok || legacyGrantEffectiveAccessCandidateBetter(candidate, existing) {
		best[key] = candidate
	}
}

func legacyGrantEffectiveAccessCandidateBetter(left, right legacyGrantEffectiveAccessCandidate) bool {
	if left.depth != right.depth {
		return left.depth < right.depth
	}
	if left.subjectRank != right.subjectRank {
		return left.subjectRank > right.subjectRank
	}
	if !left.sourceTime.Equal(right.sourceTime) {
		return left.sourceTime.After(right.sourceTime)
	}
	if left.accessRank != right.accessRank {
		return left.accessRank > right.accessRank
	}
	if left.sourceType != right.sourceType {
		return left.sourceType < right.sourceType
	}
	return left.sourceID < right.sourceID
}

func normalizeEffectiveAccessSourceScope(companyID, sourceType, sourceID string) (string, string, string, error) {
	companyID = strings.TrimSpace(companyID)
	sourceType = strings.TrimSpace(sourceType)
	sourceID = strings.TrimSpace(sourceID)
	if companyID == "" || sourceType == "" || sourceID == "" {
		return "", "", "", ErrInvalid
	}
	return companyID, sourceType, sourceID, nil
}

func normalizeEffectiveAccessResourceSourceScope(companyID, resourceType, resourceID, sourceType string) (string, string, string, string, error) {
	companyID = strings.TrimSpace(companyID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	sourceType = strings.TrimSpace(sourceType)
	if companyID == "" || !typeOK || resourceID == "" || sourceType == "" {
		return "", "", "", "", ErrInvalid
	}
	return companyID, resourceType, resourceID, sourceType, nil
}

func normalizeEffectiveAccessFact(fact domain.EffectiveResourceAccess) (domain.EffectiveResourceAccess, error) {
	fact.CompanyID = strings.TrimSpace(fact.CompanyID)
	fact.UserID = strings.TrimSpace(fact.UserID)
	resourceType, typeOK := NormalizeEntityType(fact.ResourceType)
	fact.ResourceID = strings.TrimSpace(fact.ResourceID)
	rawAccessLevel := strings.TrimSpace(fact.AccessLevel)
	accessLevel, accessOK := NormalizeEntityPermission(rawAccessLevel)
	fact.SourceType = strings.TrimSpace(fact.SourceType)
	fact.SourceID = strings.TrimSpace(fact.SourceID)
	if fact.CompanyID == "" ||
		fact.UserID == "" ||
		!typeOK ||
		fact.ResourceID == "" ||
		rawAccessLevel == "" ||
		!accessOK ||
		fact.SourceType == "" ||
		fact.SourceID == "" {
		return domain.EffectiveResourceAccess{}, ErrInvalid
	}
	fact.ResourceType = resourceType
	fact.AccessLevel = accessLevel
	return fact, nil
}

func normalizeEffectiveAccessFacts(facts []domain.EffectiveResourceAccess) ([]domain.EffectiveResourceAccess, error) {
	normalized := make([]domain.EffectiveResourceAccess, 0, len(facts))
	for _, fact := range facts {
		normalizedFact, err := normalizeEffectiveAccessFact(fact)
		if err != nil {
			return nil, err
		}
		normalized = append(normalized, normalizedFact)
	}
	return normalized, nil
}

func normalizeEffectiveAccessFactsForSource(companyID, sourceType, sourceID string, facts []domain.EffectiveResourceAccess) ([]domain.EffectiveResourceAccess, error) {
	normalized, err := normalizeEffectiveAccessFacts(facts)
	if err != nil {
		return nil, err
	}
	for _, fact := range normalized {
		if fact.CompanyID != companyID || fact.SourceType != sourceType || fact.SourceID != sourceID {
			return nil, ErrInvalid
		}
	}
	return normalized, nil
}

func normalizeEffectiveAccessFactsForResourceSource(companyID, resourceType, resourceID, sourceType string, facts []domain.EffectiveResourceAccess) ([]domain.EffectiveResourceAccess, error) {
	normalized, err := normalizeEffectiveAccessFacts(facts)
	if err != nil {
		return nil, err
	}
	for _, fact := range normalized {
		if fact.CompanyID != companyID || fact.ResourceType != resourceType || fact.ResourceID != resourceID || fact.SourceType != sourceType {
			return nil, ErrInvalid
		}
	}
	return normalized, nil
}

func addEffectiveAccessFact(facts map[string]domain.EffectiveResourceAccess, now time.Time, fact domain.EffectiveResourceAccess) {
	fact.CompanyID = strings.TrimSpace(fact.CompanyID)
	fact.UserID = strings.TrimSpace(fact.UserID)
	fact.ResourceType = strings.TrimSpace(fact.ResourceType)
	fact.ResourceID = strings.TrimSpace(fact.ResourceID)
	accessLevel, accessOK := NormalizeEntityPermission(fact.AccessLevel)
	fact.SourceType = strings.TrimSpace(fact.SourceType)
	fact.SourceID = strings.TrimSpace(fact.SourceID)
	if fact.CompanyID == "" || fact.UserID == "" || fact.ResourceType == "" || fact.ResourceID == "" || fact.SourceType == "" || fact.SourceID == "" || !accessOK {
		return
	}
	fact.AccessLevel = accessLevel
	if fact.CreatedTimestamp.IsZero() {
		fact.CreatedTimestamp = now
	}
	if fact.UpdatedTimestamp.IsZero() {
		fact.UpdatedTimestamp = fact.CreatedTimestamp
	}
	accessKey := effectiveAccessKey(fact.CompanyID, fact.UserID, fact.ResourceType, fact.ResourceID, fact.SourceType, fact.SourceID)
	if existing, ok := facts[accessKey]; ok {
		if !effectiveAccessFactWins(fact, existing) {
			return
		}
	}
	facts[accessKey] = fact
}

func effectiveAccessFactWins(candidate, existing domain.EffectiveResourceAccess) bool {
	candidateTime := effectiveAccessFactWriteTime(candidate)
	existingTime := effectiveAccessFactWriteTime(existing)
	if !candidateTime.Equal(existingTime) {
		return candidateTime.After(existingTime)
	}
	candidatePriority := effectiveAccessSourcePriority(candidate.SourceType)
	existingPriority := effectiveAccessSourcePriority(existing.SourceType)
	if candidatePriority != existingPriority {
		return candidatePriority > existingPriority
	}
	candidateRank := EntityPermissionRank(candidate.AccessLevel)
	existingRank := EntityPermissionRank(existing.AccessLevel)
	if candidateRank != existingRank {
		return candidateRank > existingRank
	}
	if candidate.SourceType != existing.SourceType {
		return candidate.SourceType < existing.SourceType
	}
	return candidate.SourceID < existing.SourceID
}

func effectiveAccessFactWriteTime(fact domain.EffectiveResourceAccess) time.Time {
	if !fact.UpdatedTimestamp.IsZero() {
		return fact.UpdatedTimestamp
	}
	return fact.CreatedTimestamp
}

func maxEffectiveAccessTime(left, right time.Time) time.Time {
	if left.IsZero() {
		return right
	}
	if right.IsZero() || left.After(right) {
		return left
	}
	return right
}

func effectiveAccessSourcePriority(sourceType string) int {
	switch strings.TrimSpace(sourceType) {
	case effectiveAccessSourceCompanyDefault:
		return 10
	case effectiveAccessSourceDirectGroupGrant:
		return 30
	case effectiveAccessSourceSharedTriageRaci:
		return 40
	case effectiveAccessSourceDirectUserGrant:
		return 60
	case effectiveAccessSourceNodeAssignee:
		return 65
	case effectiveAccessSourceLogicGateRaci:
		return 70
	case effectiveAccessSourceGateVisibility:
		return 80
	case effectiveAccessSourceCompanyAdmin:
		return 90
	default:
		return 0
	}
}

func (r *MemoryRepo) effectiveAccessLegacyGrantTargetDepthsLocked(companyID, resourceType, resourceID string) map[string]int {
	switch resourceType {
	case EntityTypeNode, EntityTypeLogicGate:
		if r.entityExistsLocked(companyID, resourceType, resourceID) {
			return map[string]int{resourceID: 0}
		}
	case EntityTypeSharedTriageFolder:
		return r.sharedTriageDescendantDepthsLocked(companyID, resourceID)
	}
	return map[string]int{}
}

func (r *MemoryRepo) effectiveAccessLegacyGrantSourceDepthsForTargetLocked(companyID, resourceType, resourceID string) map[string]int {
	switch resourceType {
	case EntityTypeNode, EntityTypeLogicGate:
		if r.entityExistsLocked(companyID, resourceType, resourceID) {
			return map[string]int{resourceID: 0}
		}
	case EntityTypeSharedTriageFolder:
		folder, ok := r.folders[key(companyID, resourceID)]
		if !ok || folder.FolderKind != "communications" {
			return map[string]int{}
		}
		depths := map[string]int{resourceID: 0}
		current := folder
		depth := 0
		for current.ParentFolderID != nil && strings.TrimSpace(*current.ParentFolderID) != "" {
			parentID := strings.TrimSpace(*current.ParentFolderID)
			if _, seen := depths[parentID]; seen {
				break
			}
			parent, ok := r.folders[key(companyID, parentID)]
			if !ok || parent.FolderKind != "communications" {
				break
			}
			depth++
			depths[parentID] = depth
			current = parent
		}
		return depths
	}
	return map[string]int{}
}

func (r *MemoryRepo) sharedTriageDescendantDepthsLocked(companyID, folderID string) map[string]int {
	folder, ok := r.folders[key(companyID, folderID)]
	if !ok || folder.FolderKind != "communications" {
		return map[string]int{}
	}
	depths := map[string]int{folderID: 0}
	queue := []string{folderID}
	for index := 0; index < len(queue); index++ {
		currentID := queue[index]
		for _, child := range r.folders {
			if child.CompanyID != companyID || child.FolderKind != "communications" || child.ParentFolderID == nil {
				continue
			}
			if strings.TrimSpace(*child.ParentFolderID) != currentID {
				continue
			}
			if _, seen := depths[child.FolderID]; seen {
				continue
			}
			depths[child.FolderID] = depths[currentID] + 1
			queue = append(queue, child.FolderID)
		}
	}
	return depths
}

func (r *MemoryRepo) effectiveAccessCompanyResourcesLocked(companyID string) []effectiveAccessResource {
	resources := make([]effectiveAccessResource, 0)
	for _, node := range r.nodes {
		if node.CompanyID == companyID {
			resources = append(resources, effectiveAccessResource{resourceType: EntityTypeNode, resourceID: node.NodeID})
		}
	}
	for _, logicGate := range r.logicGates {
		if logicGate.CompanyID == companyID {
			resources = append(resources, effectiveAccessResource{resourceType: EntityTypeLogicGate, resourceID: logicGate.LogicGateID})
		}
	}
	for _, folder := range r.folders {
		if folder.CompanyID == companyID && folder.FolderKind == "communications" {
			resources = append(resources, effectiveAccessResource{resourceType: EntityTypeSharedTriageFolder, resourceID: folder.FolderID})
		}
	}
	sort.Slice(resources, func(i, j int) bool {
		if resources[i].resourceType != resources[j].resourceType {
			return resources[i].resourceType < resources[j].resourceType
		}
		return resources[i].resourceID < resources[j].resourceID
	})
	return resources
}

func (r *MemoryRepo) resourceHasDirectEntityPermissionsLocked(companyID, resourceType, resourceID string) bool {
	for _, permission := range r.entityPermissions {
		if permission.CompanyID == companyID &&
			permission.EntityType == resourceType &&
			permission.EntityID == resourceID {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) effectiveAccessAllCompanyResourcesLocked() map[string][]effectiveAccessResource {
	out := map[string][]effectiveAccessResource{}
	for _, node := range r.nodes {
		out[node.CompanyID] = append(out[node.CompanyID], effectiveAccessResource{resourceType: EntityTypeNode, resourceID: node.NodeID})
	}
	for _, logicGate := range r.logicGates {
		out[logicGate.CompanyID] = append(out[logicGate.CompanyID], effectiveAccessResource{resourceType: EntityTypeLogicGate, resourceID: logicGate.LogicGateID})
	}
	for _, folder := range r.folders {
		if folder.FolderKind == "communications" {
			out[folder.CompanyID] = append(out[folder.CompanyID], effectiveAccessResource{resourceType: EntityTypeSharedTriageFolder, resourceID: folder.FolderID})
		}
	}
	for companyID := range out {
		resources := out[companyID]
		sort.Slice(resources, func(i, j int) bool {
			if resources[i].resourceType != resources[j].resourceType {
				return resources[i].resourceType < resources[j].resourceType
			}
			return resources[i].resourceID < resources[j].resourceID
		})
		out[companyID] = resources
	}
	return out
}

func (r *MemoryRepo) companyAdminUserIDsForTargetLocked(companyID string) []string {
	seen := map[string]bool{}
	for _, membership := range r.memberships {
		if membership.Role == domain.RoleDevAdmin || (membership.CompanyID == companyID && membership.Role == domain.RoleCompanyAdmin) {
			seen[membership.UserID] = true
		}
	}
	out := make([]string, 0, len(seen))
	for userID := range seen {
		out = append(out, userID)
	}
	sort.Strings(out)
	return out
}

func (r *MemoryRepo) companyAdminSourceMembershipForTargetLocked(companyID, userID string) (domain.CompanyMembership, bool) {
	candidates := make([]domain.CompanyMembership, 0)
	for _, membership := range r.memberships {
		if membership.UserID != userID {
			continue
		}
		if membership.Role == domain.RoleDevAdmin || (membership.CompanyID == companyID && membership.Role == domain.RoleCompanyAdmin) {
			candidates = append(candidates, membership)
		}
	}
	if len(candidates) == 0 {
		return domain.CompanyMembership{}, false
	}
	sort.Slice(candidates, func(i, j int) bool {
		iTarget := candidates[i].CompanyID == companyID
		jTarget := candidates[j].CompanyID == companyID
		if iTarget != jTarget {
			return iTarget
		}
		return candidates[i].CompanyID < candidates[j].CompanyID
	})
	return candidates[0], true
}

func effectiveAccessSourceID(parts ...string) string {
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			clean = append(clean, part)
		}
	}
	return strings.Join(clean, ":")
}

func nodeAssigneeEffectiveAccessSourceID(nodeID, userID string) string {
	return effectiveAccessSourceID("node", nodeID, "assignee", userID)
}

func logicGateRaciEffectiveAccessSourceID(logicGateID, role, userID string) string {
	return effectiveAccessSourceID("logic_gate", logicGateID, "role", role, EntityPermissionSubjectUser, userID)
}

func companyMemberDefaultEffectiveAccessSourceID(companyID, userID string) string {
	return effectiveAccessSourceID("membership", companyID, userID)
}

func logicGateAssignmentVisibilityEffectiveAccessSourceID(sourceType, sourceID, logicGateID, nodeID string) string {
	return effectiveAccessSourceID(sourceType, sourceID, "logic_gate", logicGateID, "node", nodeID)
}
