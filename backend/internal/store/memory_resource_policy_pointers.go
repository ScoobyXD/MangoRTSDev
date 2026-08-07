package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const (
	resourcePermissionDefaultRuleKey  = "__default__"
	resourcePermissionSnapshotRuleKey = "__snapshot__"
)

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

type resourceRACISubtreeApplication struct {
	CompanyID            string
	AncestorResourceType string
	AncestorResourceID   string
	Role                 string
	PrincipalType        string
	PrincipalID          string
	Snapshot             bool
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

func (r *MemoryRepo) directRACIPolicySequenceLocked(companyID, resourceType, resourceID string) int64 {
	return r.gvicPolicyRevisions[resourcePolicyKey(companyID, resourceType, resourceID)]
}

func (r *MemoryRepo) setDirectRACIPolicySequenceLocked(companyID, resourceType, resourceID string, sequence int64) {
	r.gvicPolicyRevisions[resourcePolicyKey(companyID, resourceType, resourceID)] = sequence
}

func clonePermissionApplications(items []resourcePermissionSubtreeApplication) []resourcePermissionSubtreeApplication {
	return append([]resourcePermissionSubtreeApplication(nil), items...)
}

func cloneRACIApplications(items []resourceRACISubtreeApplication) []resourceRACISubtreeApplication {
	return append([]resourceRACISubtreeApplication(nil), items...)
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
	ancestors := r.resourcePermissionAncestorsLocked(companyID, resourceType, resourceID)
	matchesAncestor := func(ancestorType, ancestorID string) bool {
		for _, ancestor := range ancestors {
			if ancestor.ResourceType == ancestorType && ancestor.ResourceID == ancestorID {
				return true
			}
		}
		return false
	}
	// A snapshot boundary means "replace the descendant policy with this
	// ancestor's complete current policy." Direct descendant rules and older
	// ancestor applications must not leak through that one-shot overwrite.
	snapshotSequence := int64(0)
	for _, application := range r.resourcePermissionApplications {
		if application.CompanyID == companyID &&
			application.Sequence > directSequence &&
			application.RuleKey == resourcePermissionSnapshotRuleKey &&
			matchesAncestor(application.AncestorResourceType, application.AncestorResourceID) &&
			application.Sequence > snapshotSequence {
			snapshotSequence = application.Sequence
		}
	}
	if snapshotSequence == 0 {
		for _, assignment := range r.directResourcePermissionAssignmentsLocked(companyID, resourceType, resourceID) {
			rules[resourcePermissionAssignmentKey(assignment)] = resolvedRule{assignment: assignment, sequence: directSequence}
		}
	}
	for _, application := range r.resourcePermissionApplications {
		if application.CompanyID != companyID || application.Sequence <= directSequence || application.Sequence < snapshotSequence {
			continue
		}
		if !matchesAncestor(application.AncestorResourceType, application.AncestorResourceID) || application.RuleKey == resourcePermissionSnapshotRuleKey {
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

func (r *MemoryRepo) recordPermissionSubtreeApplicationsLocked(companyID, ancestorType, ancestorID string, sequence int64, currentDefault string, currentAssignments []resourcePermissionAssignment) {
	// Apply-to-descendants copies the complete policy that exists now, even when
	// the parent was not edited in the same request. The snapshot marker clears
	// descendant-only rules; the following rows define the current parent policy.
	r.resourcePermissionApplications = append(r.resourcePermissionApplications,
		resourcePermissionSubtreeApplication{
			CompanyID:            companyID,
			AncestorResourceType: ancestorType,
			AncestorResourceID:   ancestorID,
			RuleKey:              resourcePermissionSnapshotRuleKey,
			Sequence:             sequence,
		},
		resourcePermissionSubtreeApplication{
			CompanyID:            companyID,
			AncestorResourceType: ancestorType,
			AncestorResourceID:   ancestorID,
			RuleKey:              resourcePermissionDefaultRuleKey,
			AccessLevel:          currentDefault,
			Sequence:             sequence,
		},
	)
	for _, current := range currentAssignments {
		r.resourcePermissionApplications = append(r.resourcePermissionApplications, resourcePermissionSubtreeApplication{
			CompanyID:            companyID,
			AncestorResourceType: ancestorType,
			AncestorResourceID:   ancestorID,
			RuleKey:              resourcePermissionAssignmentKey(current),
			SubjectType:          current.SubjectType,
			SubjectID:            current.SubjectID,
			AccessLevel:          current.AccessLevel,
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

func (r *MemoryRepo) resolvedResourceRACIAssignmentsLocked(companyID, resourceType, resourceID string) []domain.ResourceRACIAssignment {
	directSequence := r.directRACIPolicySequenceLocked(companyID, resourceType, resourceID)
	type resolvedRule struct {
		assignment domain.ResourceRACIAssignment
		sequence   int64
		deleted    bool
	}
	rules := map[string]resolvedRule{}
	ancestors := r.resourcePermissionAncestorsLocked(companyID, resourceType, resourceID)
	matchesAncestor := func(ancestorType, ancestorID string) bool {
		for _, ancestor := range ancestors {
			if ancestor.ResourceType == ancestorType && ancestor.ResourceID == ancestorID {
				return true
			}
		}
		return false
	}
	snapshotSequence := int64(0)
	for _, application := range r.gvicSubtreeApplications {
		if application.CompanyID == companyID &&
			application.Sequence > directSequence &&
			application.Snapshot &&
			matchesAncestor(application.AncestorResourceType, application.AncestorResourceID) &&
			application.Sequence > snapshotSequence {
			snapshotSequence = application.Sequence
		}
	}
	if snapshotSequence == 0 {
		for _, assignment := range r.directRACIAssignmentsForResourceLocked(companyID, resourceType, resourceID) {
			rules[gvicRuleKey(assignment.Role, assignment.PrincipalType, assignment.PrincipalID)] = resolvedRule{assignment: assignment, sequence: directSequence}
		}
	}
	for _, application := range r.gvicSubtreeApplications {
		if application.CompanyID != companyID || application.Sequence <= directSequence || application.Sequence < snapshotSequence {
			continue
		}
		if !matchesAncestor(application.AncestorResourceType, application.AncestorResourceID) || application.Snapshot {
			continue
		}
		ruleKey := gvicRuleKey(application.Role, application.PrincipalType, application.PrincipalID)
		existing, exists := rules[ruleKey]
		if exists && existing.sequence >= application.Sequence {
			continue
		}
		item := r.resourceRACIAssignmentForPrincipalLocked(resourceRACIKey{companyID: companyID, resourceType: resourceType, resourceID: resourceID}, normalizedRACIAssignmentInput{
			role:          application.Role,
			principalType: application.PrincipalType,
			principalID:   application.PrincipalID,
		}, time.Now().UTC())
		rules[ruleKey] = resolvedRule{assignment: item, sequence: application.Sequence, deleted: application.Deleted}
	}
	items := make([]domain.ResourceRACIAssignment, 0, len(rules))
	for _, rule := range rules {
		if rule.deleted {
			continue
		}
		items = append(items, rule.assignment)
	}
	sortResourceRACIAssignments(items)
	return items
}

func (r *MemoryRepo) directRACIAssignmentsForResourceLocked(companyID, resourceType, resourceID string) []domain.ResourceRACIAssignment {
	items := make([]domain.ResourceRACIAssignment, 0)
	for _, assignment := range r.gvicAssignments {
		if assignment.CompanyID == companyID && assignment.ResourceType == resourceType && assignment.ResourceID == resourceID {
			items = append(items, assignment)
		}
	}
	sortResourceRACIAssignments(items)
	return items
}

func (r *MemoryRepo) recordRACISubtreeApplicationsLocked(companyID, ancestorType, ancestorID string, sequence int64, currentAssignments []domain.ResourceRACIAssignment) bool {
	// An explicit snapshot makes an unchanged Apply command meaningful and
	// removes descendant-only RACI rules before current parent rules are read.
	r.gvicSubtreeApplications = append(r.gvicSubtreeApplications, resourceRACISubtreeApplication{
		CompanyID:            companyID,
		AncestorResourceType: ancestorType,
		AncestorResourceID:   ancestorID,
		Snapshot:             true,
		Sequence:             sequence,
	})
	for _, current := range currentAssignments {
		r.gvicSubtreeApplications = append(r.gvicSubtreeApplications, resourceRACISubtreeApplication{
			CompanyID:            companyID,
			AncestorResourceType: ancestorType,
			AncestorResourceID:   ancestorID,
			Role:                 current.Role,
			PrincipalType:        current.PrincipalType,
			PrincipalID:          current.PrincipalID,
			Sequence:             sequence,
		})
	}
	return true
}
