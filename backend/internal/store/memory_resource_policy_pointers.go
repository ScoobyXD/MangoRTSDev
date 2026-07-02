package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const resourcePermissionDefaultRuleKey = "__default__"

type resourcePermissionSubtreeApplication struct {
	CompanyID            string
	AncestorResourceType string
	AncestorResourceID   string
	RuleKey              string
	SubjectType          string
	SubjectID            string
	AccessLevel          string
	Deleted              bool
	Sequence             int64
}

type resourceGVICSubtreeApplication struct {
	CompanyID            string
	AncestorResourceType string
	AncestorResourceID   string
	Role                 string
	PrincipalType        string
	PrincipalID          string
	Deleted              bool
	Sequence             int64
}

type resolvedResourcePermissionPolicy struct {
	DefaultAccess string
	Assignments   []resourcePermissionAssignment
}

func resourcePolicyKey(companyID, resourceType, resourceID string) string {
	return strings.Join([]string{strings.TrimSpace(companyID), strings.TrimSpace(resourceType), strings.TrimSpace(resourceID)}, ":")
}

func permissionRuleKey(subjectType, subjectID string) string {
	subjectType = strings.TrimSpace(subjectType)
	subjectID = strings.TrimSpace(subjectID)
	if subjectType == "" && subjectID == "" {
		return resourcePermissionDefaultRuleKey
	}
	return subjectType + ":" + subjectID
}

func gvicRuleKey(role, principalType, principalID string) string {
	return strings.Join([]string{strings.TrimSpace(role), strings.TrimSpace(principalType), strings.TrimSpace(principalID)}, ":")
}

func (r *MemoryRepo) nextResourcePolicySequenceLocked() int64 {
	r.resourcePolicySequence++
	return r.resourcePolicySequence
}

func (r *MemoryRepo) directResourcePolicySequenceLocked(companyID, resourceType, resourceID string) int64 {
	return r.resourcePermissionRevisions[resourcePolicyKey(companyID, resourceType, resourceID)]
}

func (r *MemoryRepo) setDirectResourcePolicySequenceLocked(companyID, resourceType, resourceID string, sequence int64) {
	r.resourcePermissionRevisions[resourcePolicyKey(companyID, resourceType, resourceID)] = sequence
}

func (r *MemoryRepo) directGVICPolicySequenceLocked(companyID, resourceType, resourceID string) int64 {
	return r.gvicPolicyRevisions[resourcePolicyKey(companyID, resourceType, resourceID)]
}

func (r *MemoryRepo) setDirectGVICPolicySequenceLocked(companyID, resourceType, resourceID string, sequence int64) {
	r.gvicPolicyRevisions[resourcePolicyKey(companyID, resourceType, resourceID)] = sequence
}

func clonePermissionApplications(items []resourcePermissionSubtreeApplication) []resourcePermissionSubtreeApplication {
	return append([]resourcePermissionSubtreeApplication(nil), items...)
}

func cloneGVICApplications(items []resourceGVICSubtreeApplication) []resourceGVICSubtreeApplication {
	return append([]resourceGVICSubtreeApplication(nil), items...)
}

type resourcePolicyAncestor struct {
	ResourceType string
	ResourceID   string
}

func (r *MemoryRepo) resourcePermissionAncestorsLocked(companyID, resourceType, resourceID string) []resourcePolicyAncestor {
	seen := map[string]bool{}
	out := []resourcePolicyAncestor{}
	add := func(resourceType, resourceID string) {
		resourceType, ok := NormalizeEntityType(resourceType)
		resourceID = strings.TrimSpace(resourceID)
		if !ok || resourceID == "" {
			return
		}
		keyValue := resourceType + ":" + resourceID
		if seen[keyValue] {
			return
		}
		seen[keyValue] = true
		out = append(out, resourcePolicyAncestor{ResourceType: resourceType, ResourceID: resourceID})
	}
	var addFolderAncestors func(folderID string)
	addFolderAncestors = func(folderID string) {
		folderID = strings.TrimSpace(folderID)
		if folderID == "" {
			return
		}
		currentID := folderID
		visited := map[string]bool{}
		for currentID != "" && !visited[currentID] {
			visited[currentID] = true
			parentID := ""
			for _, edge := range r.companyExplorerV2Edges {
				if edge.CompanyID != companyID || edge.ChildEntityID != currentID {
					continue
				}
				parent, ok := r.companyExplorerV2Entities[key(companyID, edge.ParentEntityID)]
				if ok && parent.EntityType == CompanyExplorerV2EntityFolder {
					parentID = parent.EntityID
				}
				break
			}
			if parentID == "" {
				if folder, ok := r.folders[key(companyID, currentID)]; ok && folder.ParentFolderID != nil {
					parentID = strings.TrimSpace(*folder.ParentFolderID)
				}
			}
			if parentID == "" {
				return
			}
			add(EntityTypeCompanyExplorerFolder, parentID)
			currentID = parentID
		}
	}
	addExplorerContainerFolders := func(childEntityType, childResourceID string) {
		for _, entity := range r.companyExplorerV2Entities {
			if entity.CompanyID != companyID || entity.EntityType != childEntityType {
				continue
			}
			entityResourceID := strings.TrimSpace(entity.ResourceID)
			if entityResourceID == "" {
				entityResourceID = entity.EntityID
			}
			if entityResourceID != childResourceID {
				continue
			}
			for _, edge := range r.companyExplorerV2Edges {
				if edge.CompanyID != companyID || edge.ChildEntityID != entity.EntityID {
					continue
				}
				parent, ok := r.companyExplorerV2Entities[key(companyID, edge.ParentEntityID)]
				if ok && parent.EntityType == CompanyExplorerV2EntityFolder {
					add(EntityTypeCompanyExplorerFolder, parent.EntityID)
					addFolderAncestors(parent.EntityID)
				}
			}
		}
		for _, item := range r.folderItems {
			if item.CompanyID != companyID || item.ItemID != childResourceID || item.ItemType != childEntityType {
				continue
			}
			add(EntityTypeCompanyExplorerFolder, item.FolderID)
			addFolderAncestors(item.FolderID)
		}
	}
	switch resourceType {
	case EntityTypeCompanyExplorerFolder:
		addFolderAncestors(resourceID)
	case EntityTypeProject:
		addExplorerContainerFolders(CompanyExplorerV2EntityProject, resourceID)
	case EntityTypeLogicGate:
		addExplorerContainerFolders(CompanyExplorerV2EntityLogicGate, resourceID)
	case EntityTypeNode:
		for _, assignment := range r.nodeLogicGateAssignments {
			if assignment.CompanyID != companyID || assignment.NodeID != resourceID {
				continue
			}
			add(EntityTypeLogicGate, assignment.LogicGateID)
			addExplorerContainerFolders(CompanyExplorerV2EntityLogicGate, assignment.LogicGateID)
		}
	}
	return out
}

func (r *MemoryRepo) resolvedResourcePermissionPolicyLocked(companyID, resourceType, resourceID string) (resolvedResourcePermissionPolicy, bool) {
	defaultAccess, ok := r.defaultAccessForResourceLocked(companyID, resourceType, resourceID)
	if !ok {
		return resolvedResourcePermissionPolicy{}, false
	}
	directSequence := r.directResourcePolicySequenceLocked(companyID, resourceType, resourceID)
	type resolvedRule struct {
		assignment resourcePermissionAssignment
		sequence   int64
		deleted    bool
	}
	defaultRule := resolvedRule{assignment: resourcePermissionAssignment{AccessLevel: defaultAccess}, sequence: directSequence}
	rules := map[string]resolvedRule{}
	for _, assignment := range r.directResourcePermissionAssignmentsLocked(companyID, resourceType, resourceID) {
		rules[resourcePermissionAssignmentKey(assignment)] = resolvedRule{assignment: assignment, sequence: directSequence}
	}
	ancestors := r.resourcePermissionAncestorsLocked(companyID, resourceType, resourceID)
	for _, application := range r.resourcePermissionApplications {
		if application.CompanyID != companyID || application.Sequence <= directSequence {
			continue
		}
		matches := false
		for _, ancestor := range ancestors {
			if ancestor.ResourceType == application.AncestorResourceType && ancestor.ResourceID == application.AncestorResourceID {
				matches = true
				break
			}
		}
		if !matches {
			continue
		}
		if application.RuleKey == resourcePermissionDefaultRuleKey {
			if application.Sequence > defaultRule.sequence {
				defaultRule = resolvedRule{assignment: resourcePermissionAssignment{AccessLevel: application.AccessLevel}, sequence: application.Sequence, deleted: application.Deleted}
			}
			continue
		}
		existing, exists := rules[application.RuleKey]
		if exists && existing.sequence >= application.Sequence {
			continue
		}
		rules[application.RuleKey] = resolvedRule{
			assignment: resourcePermissionAssignment{SubjectType: application.SubjectType, SubjectID: application.SubjectID, AccessLevel: application.AccessLevel},
			sequence:   application.Sequence,
			deleted:    application.Deleted,
		}
	}
	if defaultRule.deleted || defaultRule.assignment.AccessLevel == "" {
		defaultAccess = ResourceDefaultAccessEdit
	} else {
		defaultAccess = defaultResourceAccessOrEdit(defaultRule.assignment.AccessLevel)
	}
	assignments := make([]resourcePermissionAssignment, 0, len(rules))
	for _, rule := range rules {
		if rule.deleted || rule.assignment.SubjectType == "" || rule.assignment.SubjectID == "" {
			continue
		}
		assignments = append(assignments, rule.assignment)
	}
	sort.Slice(assignments, func(i, j int) bool {
		if assignments[i].SubjectType != assignments[j].SubjectType {
			return assignments[i].SubjectType < assignments[j].SubjectType
		}
		return assignments[i].SubjectID < assignments[j].SubjectID
	})
	return resolvedResourcePermissionPolicy{DefaultAccess: defaultAccess, Assignments: assignments}, true
}

func (r *MemoryRepo) recordPermissionSubtreeApplicationsLocked(companyID, ancestorType, ancestorID string, sequence int64, beforeDefault string, beforeAssignments []resourcePermissionAssignment, afterDefault string, afterAssignments []resourcePermissionAssignment) {
	if beforeDefault != afterDefault {
		r.resourcePermissionApplications = append(r.resourcePermissionApplications, resourcePermissionSubtreeApplication{
			CompanyID:            companyID,
			AncestorResourceType: ancestorType,
			AncestorResourceID:   ancestorID,
			RuleKey:              resourcePermissionDefaultRuleKey,
			AccessLevel:          afterDefault,
			Sequence:             sequence,
		})
	}
	beforeByKey := resourcePermissionAssignmentMap(beforeAssignments)
	afterByKey := resourcePermissionAssignmentMap(afterAssignments)
	for ruleKey, before := range beforeByKey {
		if _, ok := afterByKey[ruleKey]; ok {
			continue
		}
		r.resourcePermissionApplications = append(r.resourcePermissionApplications, resourcePermissionSubtreeApplication{
			CompanyID:            companyID,
			AncestorResourceType: ancestorType,
			AncestorResourceID:   ancestorID,
			RuleKey:              ruleKey,
			SubjectType:          before.SubjectType,
			SubjectID:            before.SubjectID,
			Deleted:              true,
			Sequence:             sequence,
		})
	}
	for ruleKey, after := range afterByKey {
		if before, ok := beforeByKey[ruleKey]; ok && before == after {
			continue
		}
		r.resourcePermissionApplications = append(r.resourcePermissionApplications, resourcePermissionSubtreeApplication{
			CompanyID:            companyID,
			AncestorResourceType: ancestorType,
			AncestorResourceID:   ancestorID,
			RuleKey:              ruleKey,
			SubjectType:          after.SubjectType,
			SubjectID:            after.SubjectID,
			AccessLevel:          after.AccessLevel,
			Sequence:             sequence,
		})
	}
}

func (r *MemoryRepo) directResourcePermissionAssignmentsLocked(companyID, resourceType, resourceID string) []resourcePermissionAssignment {
	assignments := make([]resourcePermissionAssignment, 0)
	for _, permission := range r.entityPermissions {
		if permission.CompanyID == companyID &&
			permission.EntityType == resourceType &&
			permission.EntityID == resourceID &&
			strings.TrimSpace(permission.SubjectType) != "" &&
			strings.TrimSpace(permission.SubjectID) != "" {
			accessLevel, ok := NormalizeEntityPermission(permission.AccessLevel)
			if !ok {
				accessLevel, ok = NormalizeEntityPermission(permission.Permission)
			}
			if !ok {
				continue
			}
			assignments = append(assignments, resourcePermissionAssignment{
				SubjectType: permission.SubjectType,
				SubjectID:   permission.SubjectID,
				AccessLevel: accessLevel,
			})
		}
	}
	sort.Slice(assignments, func(i, j int) bool {
		if assignments[i].SubjectType != assignments[j].SubjectType {
			return assignments[i].SubjectType < assignments[j].SubjectType
		}
		return assignments[i].SubjectID < assignments[j].SubjectID
	})
	return assignments
}

func (r *MemoryRepo) resolvedEntityPermissionsLocked(companyID, resourceType, resourceID string) []domain.EntityPermission {
	policy, ok := r.resolvedResourcePermissionPolicyLocked(companyID, resourceType, resourceID)
	if !ok {
		return nil
	}
	now := time.Now().UTC()
	items := make([]domain.EntityPermission, 0, len(policy.Assignments))
	for _, assignment := range policy.Assignments {
		permission := domain.EntityPermission{
			CompanyID:        companyID,
			EntityType:       resourceType,
			EntityID:         resourceID,
			SubjectType:      assignment.SubjectType,
			SubjectID:        assignment.SubjectID,
			Permission:       assignment.AccessLevel,
			AccessLevel:      assignment.AccessLevel,
			CreatedTimestamp: now,
		}
		items = append(items, r.withEntityPermissionSubjectLocked(permission))
	}
	sortEntityPermissions(items)
	return items
}

func (r *MemoryRepo) resolvedResourcePermissionAccessLevelForUserLocked(companyID, userID, resourceType, resourceID string) (string, bool) {
	policy, ok := r.resolvedResourcePermissionPolicyLocked(companyID, resourceType, resourceID)
	if !ok {
		return "", false
	}
	if directAccess, ok := r.permissionAccessLevelForUserFromAssignmentsLocked(companyID, userID, policy.Assignments); ok {
		return directAccess, true
	}
	return defaultResourceAccessOrEdit(policy.DefaultAccess), true
}

func (r *MemoryRepo) permissionAccessLevelForUserFromAssignmentsLocked(companyID, userID string, assignments []resourcePermissionAssignment) (string, bool) {
	for _, assignment := range assignments {
		if assignment.SubjectType == EntityPermissionSubjectUser && assignment.SubjectID == userID {
			return assignment.AccessLevel, true
		}
	}
	bestAccess := ""
	bestDepth := int(^uint(0) >> 1)
	bestRank := int(^uint(0) >> 1)
	for _, assignment := range assignments {
		if assignment.SubjectType != EntityPermissionSubjectGroup {
			continue
		}
		depth, ok := r.userGroupPermissionDepthLocked(companyID, userID, assignment.SubjectID)
		if !ok {
			continue
		}
		rank := EntityPermissionRank(assignment.AccessLevel)
		if bestAccess == "" || depth < bestDepth || (depth == bestDepth && rank < bestRank) {
			bestAccess = assignment.AccessLevel
			bestDepth = depth
			bestRank = rank
		}
	}
	return bestAccess, bestAccess != ""
}

func (r *MemoryRepo) resolvedResourceGVICAssignmentsLocked(companyID, resourceType, resourceID string) []domain.ResourceGVICAssignment {
	directSequence := r.directGVICPolicySequenceLocked(companyID, resourceType, resourceID)
	type resolvedRule struct {
		assignment domain.ResourceGVICAssignment
		sequence   int64
		deleted    bool
	}
	rules := map[string]resolvedRule{}
	for _, assignment := range r.directGVICAssignmentsForResourceLocked(companyID, resourceType, resourceID) {
		rules[gvicRuleKey(assignment.Role, assignment.PrincipalType, assignment.PrincipalID)] = resolvedRule{assignment: assignment, sequence: directSequence}
	}
	ancestors := r.resourcePermissionAncestorsLocked(companyID, resourceType, resourceID)
	for _, application := range r.gvicSubtreeApplications {
		if application.CompanyID != companyID || application.Sequence <= directSequence {
			continue
		}
		matches := false
		for _, ancestor := range ancestors {
			if ancestor.ResourceType == application.AncestorResourceType && ancestor.ResourceID == application.AncestorResourceID {
				matches = true
				break
			}
		}
		if !matches {
			continue
		}
		ruleKey := gvicRuleKey(application.Role, application.PrincipalType, application.PrincipalID)
		existing, exists := rules[ruleKey]
		if exists && existing.sequence >= application.Sequence {
			continue
		}
		item := r.resourceGVICAssignmentForPrincipalLocked(resourceGVICKey{companyID: companyID, resourceType: resourceType, resourceID: resourceID}, normalizedGVICAssignmentInput{
			role:          application.Role,
			principalType: application.PrincipalType,
			principalID:   application.PrincipalID,
		}, time.Now().UTC())
		rules[ruleKey] = resolvedRule{assignment: item, sequence: application.Sequence, deleted: application.Deleted}
	}
	items := make([]domain.ResourceGVICAssignment, 0, len(rules))
	for _, rule := range rules {
		if rule.deleted {
			continue
		}
		items = append(items, rule.assignment)
	}
	sortResourceGVICAssignments(items)
	return items
}

func (r *MemoryRepo) directGVICAssignmentsForResourceLocked(companyID, resourceType, resourceID string) []domain.ResourceGVICAssignment {
	items := make([]domain.ResourceGVICAssignment, 0)
	for _, assignment := range r.gvicAssignments {
		if assignment.CompanyID == companyID && assignment.ResourceType == resourceType && assignment.ResourceID == resourceID {
			items = append(items, assignment)
		}
	}
	sortResourceGVICAssignments(items)
	return items
}

func (r *MemoryRepo) recordGVICSubtreeApplicationsLocked(companyID, ancestorType, ancestorID string, sequence int64, beforeAssignments, afterAssignments []domain.ResourceGVICAssignment) bool {
	beforeByKey := map[string]domain.ResourceGVICAssignment{}
	for _, assignment := range beforeAssignments {
		beforeByKey[gvicRuleKey(assignment.Role, assignment.PrincipalType, assignment.PrincipalID)] = assignment
	}
	afterByKey := map[string]domain.ResourceGVICAssignment{}
	for _, assignment := range afterAssignments {
		afterByKey[gvicRuleKey(assignment.Role, assignment.PrincipalType, assignment.PrincipalID)] = assignment
	}
	changed := false
	for ruleKey, before := range beforeByKey {
		if _, ok := afterByKey[ruleKey]; ok {
			continue
		}
		r.gvicSubtreeApplications = append(r.gvicSubtreeApplications, resourceGVICSubtreeApplication{
			CompanyID:            companyID,
			AncestorResourceType: ancestorType,
			AncestorResourceID:   ancestorID,
			Role:                 before.Role,
			PrincipalType:        before.PrincipalType,
			PrincipalID:          before.PrincipalID,
			Deleted:              true,
			Sequence:             sequence,
		})
		changed = true
	}
	for ruleKey, after := range afterByKey {
		if _, ok := beforeByKey[ruleKey]; ok {
			continue
		}
		r.gvicSubtreeApplications = append(r.gvicSubtreeApplications, resourceGVICSubtreeApplication{
			CompanyID:            companyID,
			AncestorResourceType: ancestorType,
			AncestorResourceID:   ancestorID,
			Role:                 after.Role,
			PrincipalType:        after.PrincipalType,
			PrincipalID:          after.PrincipalID,
			Sequence:             sequence,
		})
		changed = true
	}
	return changed
}
