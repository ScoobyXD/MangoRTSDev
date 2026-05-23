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
	depth        int
	subjectRank  int
	accessRank   int
}

const (
	effectiveAccessSourceDirectUserGrant  = "direct_user_grant"
	effectiveAccessSourceDirectGroupGrant = "direct_group_grant"
	effectiveAccessSourceCompanyAdmin     = "company_admin"
	effectiveAccessSourceNodeAssignee     = "node_assignee"
)

func (r *MemoryRepo) RebuildEffectiveResourceAccessForCompany(companyID string) error {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	next := make(map[string]domain.EffectiveResourceAccess)
	r.projectLegacyGrantEffectiveAccessLocked(companyID, next, now)
	r.projectCompanyAdminEffectiveAccessLocked(companyID, next, now)
	r.projectNodeAssigneeEffectiveAccessLocked(companyID, next, now)
	r.projectLogicGateRaciEffectiveAccessLocked(companyID, next, now)
	r.projectSharedTriageRaciEffectiveAccessLocked(companyID, next, now)
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
	node, ok := r.nodes[key(companyID, nodeID)]
	if !ok {
		return ErrNotFound
	}
	facts := []domain.EffectiveResourceAccess{}
	if node.AssigneeUserID != nil {
		userID := strings.TrimSpace(*node.AssigneeUserID)
		if userID != "" {
			if _, ok := r.memberships[membershipKey(companyID, userID)]; ok {
				facts = append(facts, domain.EffectiveResourceAccess{
					CompanyID:    companyID,
					UserID:       userID,
					ResourceType: EntityTypeNode,
					ResourceID:   nodeID,
					AccessLevel:  EntityPermissionEdit,
					SourceType:   effectiveAccessSourceNodeAssignee,
					SourceID:     nodeAssigneeEffectiveAccessSourceID(nodeID, userID),
				})
			}
		}
	}
	return r.replaceEffectiveFactsForResourceSourceLocked(companyID, EntityTypeNode, nodeID, effectiveAccessSourceNodeAssignee, facts)
}

func (r *MemoryRepo) recomputeDirectGrantEffectiveAccessForResourceLocked(companyID, resourceType, resourceID string) error {
	companyID = strings.TrimSpace(companyID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	if companyID == "" || !typeOK || resourceID == "" {
		return ErrInvalid
	}

	sourceDepths := r.effectiveAccessLegacyGrantSourceDepthsForTargetLocked(companyID, resourceType, resourceID)
	bestByUserResource := map[string]legacyGrantEffectiveAccessCandidate{}
	for _, permission := range r.entityPermissions {
		if permission.CompanyID != companyID || permission.EntityType != resourceType {
			continue
		}
		depth, ok := sourceDepths[permission.EntityID]
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
		sourceID := effectiveAccessSourceID(resourceType, permission.EntityID, permission.SubjectType, permission.SubjectID)
		switch permission.SubjectType {
		case EntityPermissionSubjectUser:
			if _, ok := r.memberships[membershipKey(companyID, permission.SubjectID)]; !ok {
				continue
			}
			recordBestLegacyGrantEffectiveAccessCandidate(bestByUserResource, legacyGrantEffectiveAccessCandidate{
				userID:       permission.SubjectID,
				resourceType: resourceType,
				resourceID:   resourceID,
				accessLevel:  accessLevel,
				sourceType:   effectiveAccessSourceDirectUserGrant,
				sourceID:     sourceID,
				depth:        depth,
				subjectRank:  2,
				accessRank:   EntityPermissionRank(accessLevel),
			})
		case EntityPermissionSubjectGroup:
			groupIDs := companyUserGroupSubtreeIDsLocked(r.userGroups, companyID, permission.SubjectID)
			for _, member := range r.userGroupMembers {
				if member.CompanyID != companyID || !groupIDs[member.GroupID] {
					continue
				}
				recordBestLegacyGrantEffectiveAccessCandidate(bestByUserResource, legacyGrantEffectiveAccessCandidate{
					userID:       member.UserID,
					resourceType: resourceType,
					resourceID:   resourceID,
					accessLevel:  accessLevel,
					sourceType:   effectiveAccessSourceDirectGroupGrant,
					sourceID:     sourceID,
					depth:        depth,
					subjectRank:  1,
					accessRank:   EntityPermissionRank(accessLevel),
				})
			}
		}
	}

	userFacts := []domain.EffectiveResourceAccess{}
	groupFacts := []domain.EffectiveResourceAccess{}
	for _, candidate := range bestByUserResource {
		if candidate.accessRank == 0 {
			continue
		}
		fact := domain.EffectiveResourceAccess{
			CompanyID:    companyID,
			UserID:       candidate.userID,
			ResourceType: candidate.resourceType,
			ResourceID:   candidate.resourceID,
			AccessLevel:  candidate.accessLevel,
			SourceType:   candidate.sourceType,
			SourceID:     candidate.sourceID,
		}
		if candidate.sourceType == effectiveAccessSourceDirectUserGrant {
			userFacts = append(userFacts, fact)
		} else {
			groupFacts = append(groupFacts, fact)
		}
	}
	if err := r.replaceEffectiveFactsForResourceSourceLocked(companyID, resourceType, resourceID, effectiveAccessSourceDirectUserGrant, userFacts); err != nil {
		return err
	}
	return r.replaceEffectiveFactsForResourceSourceLocked(companyID, resourceType, resourceID, effectiveAccessSourceDirectGroupGrant, groupFacts)
}

func (r *MemoryRepo) recomputeCompanyAdminEffectiveAccessForUserLocked(userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ErrInvalid
	}
	if r.effectiveAccessErr != nil {
		return r.effectiveAccessErr
	}
	for accessKey, access := range r.effectiveAccess {
		if access.UserID == userID && access.SourceType == effectiveAccessSourceCompanyAdmin {
			delete(r.effectiveAccess, accessKey)
		}
	}
	now := time.Now().UTC()
	for targetCompanyID, resources := range r.effectiveAccessAllCompanyResourcesLocked() {
		sourceMembership, ok := r.companyAdminSourceMembershipForTargetLocked(targetCompanyID, userID)
		if !ok {
			continue
		}
		sourceID := effectiveAccessSourceID("membership", sourceMembership.CompanyID, userID)
		for _, resource := range resources {
			addEffectiveAccessFact(r.effectiveAccess, now, domain.EffectiveResourceAccess{
				CompanyID:    targetCompanyID,
				UserID:       userID,
				ResourceType: resource.resourceType,
				ResourceID:   resource.resourceID,
				AccessLevel:  EntityPermissionAdmin,
				SourceType:   effectiveAccessSourceCompanyAdmin,
				SourceID:     sourceID,
			})
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
	facts := []domain.EffectiveResourceAccess{}
	for _, userID := range r.companyAdminUserIDsForTargetLocked(companyID) {
		sourceMembership, ok := r.companyAdminSourceMembershipForTargetLocked(companyID, userID)
		if !ok {
			continue
		}
		facts = append(facts, domain.EffectiveResourceAccess{
			CompanyID:    companyID,
			UserID:       userID,
			ResourceType: resourceType,
			ResourceID:   resourceID,
			AccessLevel:  EntityPermissionAdmin,
			SourceType:   effectiveAccessSourceCompanyAdmin,
			SourceID:     effectiveAccessSourceID("membership", sourceMembership.CompanyID, userID),
		})
	}
	return r.replaceEffectiveFactsForResourceSourceLocked(companyID, resourceType, resourceID, effectiveAccessSourceCompanyAdmin, facts)
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
						depth:        depth,
						subjectRank:  1,
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
		if candidate.accessRank == 0 {
			continue
		}
		addEffectiveAccessFact(facts, now, domain.EffectiveResourceAccess{
			CompanyID:    companyID,
			UserID:       candidate.userID,
			ResourceType: candidate.resourceType,
			ResourceID:   candidate.resourceID,
			AccessLevel:  candidate.accessLevel,
			SourceType:   candidate.sourceType,
			SourceID:     candidate.sourceID,
		})
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
				CompanyID:    companyID,
				UserID:       assignment.UserID,
				ResourceType: EntityTypeLogicGate,
				ResourceID:   assignment.LogicGateID,
				AccessLevel:  EntityPermissionEdit,
				SourceType:   "logic_gate_raci",
				SourceID:     "logic_gate:" + assignment.LogicGateID + ":role:" + assignment.Role + ":user:" + assignment.UserID,
			})
		}
	}
}

func (r *MemoryRepo) projectSharedTriageRaciEffectiveAccessLocked(companyID string, facts map[string]domain.EffectiveResourceAccess, now time.Time) {
	for _, assignments := range r.sharedInboxRaci {
		for _, assignment := range assignments {
			if assignment.CompanyID != companyID {
				continue
			}
			targetDepths := r.sharedTriageDescendantDepthsLocked(companyID, assignment.FolderID)
			subjectType := strings.TrimSpace(assignment.SubjectType)
			subjectID := strings.TrimSpace(assignment.SubjectID)
			if subjectType == "" {
				subjectType = EntityPermissionSubjectUser
				subjectID = strings.TrimSpace(assignment.UserID)
			}
			sourceID := "folder:" + assignment.FolderID + ":role:" + assignment.Role + ":" + subjectType + ":" + subjectID
			switch subjectType {
			case EntityPermissionSubjectUser:
				if _, ok := r.memberships[membershipKey(companyID, subjectID)]; !ok {
					continue
				}
				for targetID := range targetDepths {
					addEffectiveAccessFact(facts, now, domain.EffectiveResourceAccess{
						CompanyID:    companyID,
						UserID:       subjectID,
						ResourceType: EntityTypeSharedTriageFolder,
						ResourceID:   targetID,
						AccessLevel:  EntityPermissionEdit,
						SourceType:   "shared_triage_raci",
						SourceID:     sourceID,
					})
				}
			case EntityPermissionSubjectGroup:
				groupIDs := companyUserGroupSubtreeIDsLocked(r.userGroups, companyID, subjectID)
				for _, member := range r.userGroupMembers {
					if member.CompanyID != companyID || !groupIDs[member.GroupID] {
						continue
					}
					for targetID := range targetDepths {
						addEffectiveAccessFact(facts, now, domain.EffectiveResourceAccess{
							CompanyID:    companyID,
							UserID:       member.UserID,
							ResourceType: EntityTypeSharedTriageFolder,
							ResourceID:   targetID,
							AccessLevel:  EntityPermissionEdit,
							SourceType:   "shared_triage_raci",
							SourceID:     sourceID,
						})
					}
				}
			}
		}
	}
}

func (r *MemoryRepo) projectLogicGateAssignmentVisibilityLocked(companyID string, facts map[string]domain.EffectiveResourceAccess, now time.Time) {
	baseFacts := make([]domain.EffectiveResourceAccess, 0, len(facts))
	for _, fact := range facts {
		if fact.CompanyID == companyID && fact.ResourceType == EntityTypeLogicGate && EntityPermissionRank(fact.AccessLevel) >= EntityPermissionRank(EntityPermissionView) {
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
				CompanyID:    companyID,
				UserID:       fact.UserID,
				ResourceType: EntityTypeNode,
				ResourceID:   assignment.NodeID,
				AccessLevel:  EntityPermissionView,
				SourceType:   "logic_gate_assignment_visibility",
				SourceID:     fact.SourceType + ":" + fact.SourceID + ":logic_gate:" + assignment.LogicGateID + ":node:" + assignment.NodeID,
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
		EntityPermissionRank(accessLevel) == 0 ||
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
	fact.AccessLevel = strings.TrimSpace(fact.AccessLevel)
	fact.SourceType = strings.TrimSpace(fact.SourceType)
	fact.SourceID = strings.TrimSpace(fact.SourceID)
	if fact.CompanyID == "" || fact.UserID == "" || fact.ResourceType == "" || fact.ResourceID == "" || fact.SourceType == "" || fact.SourceID == "" || EntityPermissionRank(fact.AccessLevel) == 0 {
		return
	}
	accessKey := effectiveAccessKey(fact.CompanyID, fact.UserID, fact.ResourceType, fact.ResourceID, fact.SourceType, fact.SourceID)
	if existing, ok := facts[accessKey]; ok {
		if EntityPermissionRank(existing.AccessLevel) >= EntityPermissionRank(fact.AccessLevel) {
			return
		}
		fact.CreatedTimestamp = existing.CreatedTimestamp
	} else {
		fact.CreatedTimestamp = now
	}
	fact.UpdatedTimestamp = now
	facts[accessKey] = fact
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
