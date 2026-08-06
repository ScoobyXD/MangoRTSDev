package store

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

type memoryV2PolicySetting struct {
	Mode                    string
	DefaultAccess           string
	CustomizedSequence      int64
	ParentResourceType      string
	ParentResourceID        string
	ParentLinkSequence      int64
	DescendantResetSequence int64
}

type memoryV2ResolvedPolicy struct {
	SourceType        string
	SourceID          string
	SourceSequence    int64
	OverwrittenBy     *PolicyOverwrite
	ParentFingerprint string
}

func (r *MemoryRepo) nextGVICV2SequenceLocked() int64 {
	r.gvicV2Sequence++
	return r.gvicV2Sequence
}

func (r *MemoryRepo) nextPermissionV2SequenceLocked() int64 {
	r.permissionV2Sequence++
	return r.permissionV2Sequence
}

func (r *MemoryRepo) v2PolicyParentLocked(companyID, resourceType, resourceID string) (string, string) {
	switch resourceType {
	case EntityTypeNode:
		for _, assignment := range r.nodeLogicGateAssignments {
			if assignment.CompanyID == companyID && assignment.NodeID == resourceID {
				return EntityTypeLogicGate, assignment.LogicGateID
			}
		}
	case EntityTypeLogicGate, EntityTypeProject:
		for _, item := range r.folderItems {
			if item.CompanyID == companyID && item.ItemType == resourceType && item.ItemID == resourceID {
				return EntityTypeCompanyExplorerFolder, item.FolderID
			}
		}
	case EntityTypeCompanyExplorerFolder:
		if folder, ok := r.folders[key(companyID, resourceID)]; ok && folder.ParentFolderID != nil {
			return EntityTypeCompanyExplorerFolder, strings.TrimSpace(*folder.ParentFolderID)
		}
	case EntityTypeSharedInboxFolder:
		if folder, ok := r.folders[key(companyID, resourceID)]; ok && folder.ParentFolderID != nil {
			return EntityTypeSharedInboxFolder, strings.TrimSpace(*folder.ParentFolderID)
		}
	case EntityTypeSharedInbox:
		for _, entry := range r.folders {
			if entry.CompanyID == companyID && (entry.SharedInboxID == resourceID || entry.FolderID == resourceID) && entry.ParentFolderID != nil {
				return EntityTypeSharedInboxFolder, strings.TrimSpace(*entry.ParentFolderID)
			}
		}
	}
	return "", ""
}

func (r *MemoryRepo) ensureV2PolicySettingsLocked(companyID, resourceType, resourceID string) bool {
	if !r.entityExistsLocked(companyID, resourceType, resourceID) {
		return false
	}
	keyValue := resourcePolicyKey(companyID, resourceType, resourceID)
	parentType, parentID := r.v2PolicyParentLocked(companyID, resourceType, resourceID)
	if parentID != "" {
		r.ensureV2PolicySettingsLocked(companyID, parentType, parentID)
	}
	gvic, exists := r.gvicV2Settings[keyValue]
	if !exists {
		gvic = memoryV2PolicySetting{Mode: PolicyModeCustomized}
		if parentID != "" {
			gvic.Mode = PolicyModeInherited
			gvic.ParentResourceType, gvic.ParentResourceID = parentType, parentID
			gvic.ParentLinkSequence = r.nextGVICV2SequenceLocked()
		} else {
			gvic.CustomizedSequence = r.nextGVICV2SequenceLocked()
		}
		r.gvicV2Settings[keyValue] = gvic
	} else if gvic.ParentResourceType != parentType || gvic.ParentResourceID != parentID {
		if gvic.ParentResourceID != "" && parentID == "" {
			resolved := r.resolveV2PolicyLocked(companyID, resourceType, resourceID, true)
			if resolved.SourceID != "" && (resolved.SourceType != resourceType || resolved.SourceID != resourceID) {
				r.replaceMemoryGVICEdgesLocked(companyID, resourceType, resourceID, r.directMemoryGVICEdgesLocked(companyID, resolved.SourceType, resolved.SourceID))
				gvic.Mode = PolicyModeCustomized
				gvic.CustomizedSequence = r.nextGVICV2SequenceLocked()
			}
		}
		gvic.ParentResourceType, gvic.ParentResourceID = parentType, parentID
		if parentID == "" {
			gvic.ParentLinkSequence = 0
		} else {
			gvic.ParentLinkSequence = r.nextGVICV2SequenceLocked()
		}
		r.gvicV2Settings[keyValue] = gvic
	}

	permission, exists := r.permissionV2Settings[keyValue]
	if !exists {
		initialDefault := ResourceDefaultAccessEdit
		if currentDefault, ok := r.defaultAccessForResourceLocked(companyID, resourceType, resourceID); ok {
			initialDefault = currentDefault
		}
		permission = memoryV2PolicySetting{Mode: PolicyModeCustomized, DefaultAccess: initialDefault}
		if parentID != "" {
			permission.Mode = PolicyModeInherited
			permission.DefaultAccess = ""
			permission.ParentResourceType, permission.ParentResourceID = parentType, parentID
			permission.ParentLinkSequence = r.nextPermissionV2SequenceLocked()
		} else {
			permission.CustomizedSequence = r.nextPermissionV2SequenceLocked()
		}
		r.permissionV2Settings[keyValue] = permission
	} else if permission.ParentResourceType != parentType || permission.ParentResourceID != parentID {
		if permission.ParentResourceID != "" && parentID == "" {
			resolved := r.resolveV2PolicyLocked(companyID, resourceType, resourceID, false)
			if resolved.SourceID != "" && (resolved.SourceType != resourceType || resolved.SourceID != resourceID) {
				sourceKey := resourcePolicyKey(companyID, resolved.SourceType, resolved.SourceID)
				source := r.permissionV2Settings[sourceKey]
				permission.Mode = PolicyModeCustomized
				permission.DefaultAccess = source.DefaultAccess
				permission.CustomizedSequence = r.nextPermissionV2SequenceLocked()
				r.replaceMemoryPermissionEdgesLocked(companyID, resourceType, resourceID, r.directMemoryPermissionEdgesLocked(companyID, resolved.SourceType, resolved.SourceID))
			}
		}
		permission.ParentResourceType, permission.ParentResourceID = parentType, parentID
		if parentID == "" {
			permission.ParentLinkSequence = 0
		} else {
			permission.ParentLinkSequence = r.nextPermissionV2SequenceLocked()
		}
		r.permissionV2Settings[keyValue] = permission
	}
	return true
}

func (r *MemoryRepo) resolveV2PolicyLocked(companyID, resourceType, resourceID string, gvic bool) memoryV2ResolvedPolicy {
	settings := r.permissionV2Settings
	if gvic {
		settings = r.gvicV2Settings
	}
	type pathItem struct {
		resourceType, resourceID string
		setting                  memoryV2PolicySetting
		depth                    int
	}
	path := []pathItem{}
	seen := map[string]bool{}
	currentType, currentID := resourceType, resourceID
	for currentID != "" {
		keyValue := resourcePolicyKey(companyID, currentType, currentID)
		if seen[keyValue] {
			break
		}
		seen[keyValue] = true
		setting, ok := settings[keyValue]
		if !ok {
			break
		}
		path = append(path, pathItem{currentType, currentID, setting, len(path)})
		currentType, currentID = setting.ParentResourceType, setting.ParentResourceID
	}
	eligibleReset := func(reset pathItem) bool {
		if reset.depth == 0 || reset.setting.DescendantResetSequence <= 0 {
			return false
		}
		for _, edge := range path {
			if edge.depth < reset.depth && edge.setting.ParentLinkSequence > reset.setting.DescendantResetSequence {
				return false
			}
		}
		return true
	}
	var selectedReset *pathItem
	for index := range path {
		candidate := path[index]
		if eligibleReset(candidate) && (selectedReset == nil || candidate.setting.DescendantResetSequence > selectedReset.setting.DescendantResetSequence) {
			copyValue := candidate
			selectedReset = &copyValue
		}
	}
	result := memoryV2ResolvedPolicy{}
	for _, candidate := range path {
		if candidate.setting.Mode != PolicyModeCustomized {
			continue
		}
		active := true
		for _, reset := range path {
			if reset.depth > candidate.depth && eligibleReset(reset) && reset.setting.DescendantResetSequence >= candidate.setting.CustomizedSequence {
				active = false
				break
			}
		}
		if active {
			result.SourceType, result.SourceID, result.SourceSequence = candidate.resourceType, candidate.resourceID, candidate.setting.CustomizedSequence
			break
		}
	}
	if len(path) > 0 && path[0].setting.Mode == PolicyModeCustomized {
		for _, reset := range path {
			if eligibleReset(reset) && reset.setting.DescendantResetSequence >= path[0].setting.CustomizedSequence {
				result.OverwrittenBy = &PolicyOverwrite{ResourceType: reset.resourceType, ResourceID: reset.resourceID, Sequence: reset.setting.DescendantResetSequence}
				break
			}
		}
	}
	parts := make([]string, 0, len(path))
	for _, item := range path {
		parts = append(parts, fmt.Sprintf("%d:%s:%s:%d", item.depth, item.resourceType, item.resourceID, item.setting.ParentLinkSequence))
	}
	result.ParentFingerprint = strings.Join(parts, "|")
	return result
}

func (r *MemoryRepo) policyV2GroupFingerprintLocked(companyID string) string {
	parts := []string{}
	for _, group := range r.userGroups {
		if group.CompanyID == companyID {
			parentID := ""
			if group.ParentGroupID != nil {
				parentID = *group.ParentGroupID
			}
			parts = append(parts, "g:"+group.GroupID+":"+parentID)
		}
	}
	for _, member := range r.userGroupMembers {
		if member.CompanyID == companyID {
			parts = append(parts, "m:"+member.GroupID+":"+member.UserID)
		}
	}
	sort.Strings(parts)
	sum := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(sum[:])
}

func memoryV2Revision(setting memoryV2PolicySetting, resolved memoryV2ResolvedPolicy, groups string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%d:%d:%d:%s:%s:%d:%s:%s", setting.Mode, setting.DefaultAccess, setting.CustomizedSequence, setting.ParentLinkSequence, setting.DescendantResetSequence, resolved.SourceType, resolved.SourceID, resolved.SourceSequence, resolved.ParentFingerprint, groups)))
	return hex.EncodeToString(sum[:])
}

func (r *MemoryRepo) GetResourceGVICPolicy(companyID, resourceType, resourceID string) (ResourceGVICPolicy, error) {
	resourceType, ok := NormalizeGVICResourceType(resourceType)
	companyID, resourceID = strings.TrimSpace(companyID), strings.TrimSpace(resourceID)
	if !ok || companyID == "" || resourceID == "" {
		return ResourceGVICPolicy{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.ensureV2PolicySettingsLocked(companyID, resourceType, resourceID) {
		return ResourceGVICPolicy{}, ErrNotFound
	}
	return r.memoryV2GVICPolicyLocked(companyID, resourceType, resourceID), nil
}

func (r *MemoryRepo) memoryV2GVICPolicyLocked(companyID, resourceType, resourceID string) ResourceGVICPolicy {
	keyValue := resourcePolicyKey(companyID, resourceType, resourceID)
	setting := r.gvicV2Settings[keyValue]
	resolved := r.resolveV2PolicyLocked(companyID, resourceType, resourceID, true)
	stored := r.directMemoryGVICEdgesLocked(companyID, resourceType, resourceID)
	if setting.Mode == PolicyModeInherited {
		stored = []domain.ResourceGVICAssignment{}
	}
	policy := ResourceGVICPolicy{CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, AssignmentMode: setting.Mode,
		EffectiveAssignmentMode: PolicyModeInherited, EffectiveSource: PolicySource{ResourceType: resolved.SourceType, ResourceID: resolved.SourceID},
		OverwrittenByAncestor: resolved.OverwrittenBy, GVICAssignments: stored,
		EffectiveAssignments: r.memoryV2EffectiveGVICLocked(companyID, resourceType, resourceID, resolved),
		Revision:             memoryV2Revision(setting, resolved, r.policyV2GroupFingerprintLocked(companyID))}
	if resolved.SourceType == resourceType && resolved.SourceID == resourceID && resolved.OverwrittenBy == nil {
		policy.EffectiveAssignmentMode = PolicyModeCustomized
	}
	return policy
}

func (r *MemoryRepo) directMemoryGVICEdgesLocked(companyID, resourceType, resourceID string) []domain.ResourceGVICAssignment {
	items := []domain.ResourceGVICAssignment{}
	for _, item := range r.gvicAssignments {
		if item.CompanyID == companyID && item.ResourceType == resourceType && item.ResourceID == resourceID {
			items = append(items, item)
		}
	}
	sortResourceGVICAssignments(items)
	return items
}

func (r *MemoryRepo) replaceMemoryGVICEdgesLocked(companyID, resourceType, resourceID string, inputs []domain.ResourceGVICAssignment) {
	previous := map[string]domain.ResourceGVICAssignment{}
	for keyValue, item := range r.gvicAssignments {
		if item.CompanyID == companyID && item.ResourceType == resourceType && item.ResourceID == resourceID {
			previous[keyValue] = item
			delete(r.gvicAssignments, keyValue)
		}
	}
	now := time.Now().UTC()
	for _, input := range inputs {
		item := r.resourceGVICAssignmentForPrincipalLocked(resourceGVICKey{companyID: companyID, resourceType: resourceType, resourceID: resourceID}, normalizedGVICAssignmentInput{role: input.Role, principalType: input.PrincipalType, principalID: input.PrincipalID}, now)
		keyValue := gvicSourceAssignmentKey(companyID, resourceType, resourceID, item.Role, item.PrincipalType, item.PrincipalID)
		if existing, ok := previous[keyValue]; ok {
			item.CreatedTimestamp = existing.CreatedTimestamp
			item.UpdatedTimestamp = existing.UpdatedTimestamp
		}
		r.gvicAssignments[keyValue] = item
	}
}

func (r *MemoryRepo) memoryV2EffectiveGVICLocked(companyID, resourceType, resourceID string, resolved memoryV2ResolvedPolicy) []domain.ResourceGVICEffectiveAssignment {
	type winner struct {
		item                domain.ResourceGVICEffectiveAssignment
		rank, principalRank int
	}
	winners := map[string]winner{}
	for _, edge := range r.directMemoryGVICEdgesLocked(companyID, resolved.SourceType, resolved.SourceID) {
		userIDs := []string{}
		if edge.PrincipalType == EntityPermissionSubjectUser {
			userIDs = []string{edge.PrincipalID}
		} else {
			userIDs, _ = r.logicGateGVICUserIDsForGroupLocked(companyID, edge.PrincipalID)
		}
		for _, userID := range userIDs {
			user, ok := r.companyUserByIDLocked(companyID, userID)
			if !ok {
				continue
			}
			item := domain.ResourceGVICEffectiveAssignment{CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, Role: edge.Role, UserID: userID,
				SourceResourceType: resolved.SourceType, SourceResourceID: resolved.SourceID, SourcePrincipalType: edge.PrincipalType, SourcePrincipalID: edge.PrincipalID,
				InheritanceType: GVICInheritanceDirect, UserDisplayName: user.DisplayName, UserEmail: user.Email, UpdatedTimestamp: edge.UpdatedTimestamp}
			if resolved.SourceType != resourceType || resolved.SourceID != resourceID {
				item.InheritanceType = "inherited"
			}
			candidate := winner{item: item, rank: gvicRoleSortValue(edge.Role), principalRank: 1}
			if edge.PrincipalType == EntityPermissionSubjectUser {
				candidate.principalRank = 0
			}
			current, exists := winners[userID]
			if !exists || candidate.rank < current.rank || (candidate.rank == current.rank && candidate.principalRank < current.principalRank) {
				winners[userID] = candidate
			}
		}
	}
	items := make([]domain.ResourceGVICEffectiveAssignment, 0, len(winners))
	for _, value := range winners {
		items = append(items, value.item)
	}
	sortResourceGVICEffectiveAssignments(items)
	return items
}

func (r *MemoryRepo) PutResourceGVICPolicy(input ResourceGVICPolicyUpdateInput) (ResourceGVICPolicy, []domain.DomainEvent, error) {
	resourceType, ok := NormalizeGVICResourceType(input.ResourceType)
	mode, modeOK := normalizePolicyMode(input.AssignmentMode)
	action, actionOK := normalizeDescendantAction(input.DescendantAction)
	companyID, resourceID := strings.TrimSpace(input.CompanyID), strings.TrimSpace(input.ResourceID)
	if !ok || !modeOK || !actionOK || companyID == "" || resourceID == "" || (mode == PolicyModeInherited && len(input.Assignments) > 0) {
		return ResourceGVICPolicy{}, nil, ErrInvalid
	}
	normalized, err := normalizeResourceGVICAssignmentInputs(input.Assignments)
	if err != nil {
		return ResourceGVICPolicy{}, nil, err
	}
	if err := validateResourceGVICAssignmentInputsForOperation(resourceGVICKey{
		companyID: companyID, resourceType: resourceType, resourceID: resourceID,
	}, normalized, GVICAssignmentCommandSet); err != nil {
		return ResourceGVICPolicy{}, nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.ensureV2PolicySettingsLocked(companyID, resourceType, resourceID) {
		return ResourceGVICPolicy{}, nil, ErrNotFound
	}
	idempotencyKey := companyID + ":" + strings.TrimSpace(input.IdempotencyKey)
	if strings.TrimSpace(input.IdempotencyKey) != "" && r.policyV2Idempotency[idempotencyKey] {
		return r.memoryV2GVICPolicyLocked(companyID, resourceType, resourceID), []domain.DomainEvent{}, nil
	}
	current := r.memoryV2GVICPolicyLocked(companyID, resourceType, resourceID)
	if expected := cleanPolicyRevision(input.ExpectedRevision); expected != "" && expected != current.Revision {
		return ResourceGVICPolicy{}, nil, ErrVersionConflict
	}
	if mode == PolicyModeCustomized && input.Assignments == nil {
		resolved := r.resolveV2PolicyLocked(companyID, resourceType, resourceID, true)
		sourceEdges := r.directMemoryGVICEdgesLocked(companyID, resolved.SourceType, resolved.SourceID)
		normalized = make([]normalizedGVICAssignmentInput, 0, len(sourceEdges))
		for _, edge := range sourceEdges {
			normalized = append(normalized, normalizedGVICAssignmentInput{
				role: edge.Role, principalType: edge.PrincipalType, principalID: edge.PrincipalID,
			})
		}
		if err := validateResourceGVICAssignmentInputsForOperation(resourceGVICKey{
			companyID: companyID, resourceType: resourceType, resourceID: resourceID,
		}, normalized, GVICAssignmentCommandSet); err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
	}
	for _, item := range normalized {
		if err := r.validateGVICPrincipalLocked(companyID, item.principalType, item.principalID); err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
	}
	keyValue := resourcePolicyKey(companyID, resourceType, resourceID)
	setting := r.gvicV2Settings[keyValue]
	if mode == PolicyModeInherited {
		if setting.ParentResourceID == "" {
			return ResourceGVICPolicy{}, nil, ErrInvalid
		}
		r.replaceMemoryGVICEdgesLocked(companyID, resourceType, resourceID, nil)
		setting.Mode, setting.CustomizedSequence = PolicyModeInherited, 0
	} else {
		edges := make([]domain.ResourceGVICAssignment, 0, len(normalized))
		for _, item := range normalized {
			edges = append(edges, domain.ResourceGVICAssignment{Role: item.role, PrincipalType: item.principalType, PrincipalID: item.principalID})
		}
		setting.Mode, setting.CustomizedSequence = PolicyModeCustomized, r.nextGVICV2SequenceLocked()
		r.replaceMemoryGVICEdgesLocked(companyID, resourceType, resourceID, edges)
	}
	if action == PolicyDescendantActionIncludingCustomized {
		setting.DescendantResetSequence = r.nextGVICV2SequenceLocked()
	}
	r.gvicV2Settings[keyValue] = setting
	resultingSequence := setting.CustomizedSequence
	if action == PolicyDescendantActionIncludingCustomized {
		resultingSequence = setting.DescendantResetSequence
	}
	after := r.memoryV2GVICPolicyLocked(companyID, resourceType, resourceID)
	beforeUserIDs := make(map[string]bool, len(current.EffectiveAssignments))
	for _, item := range current.EffectiveAssignments {
		beforeUserIDs[item.UserID] = true
	}
	userIDs := []string{}
	for _, item := range after.EffectiveAssignments {
		if !beforeUserIDs[item.UserID] {
			userIDs = append(userIDs, item.UserID)
		}
	}
	if resourceType == EntityTypeNode {
		r.bumpNodeViewVersionLocked(companyID, resourceID)
	}
	sort.Strings(userIDs)
	event, err := r.appendDomainEventLocked(DomainEventInput{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, Type: v2GVICEventType(resourceType), ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey, Payload: v2PolicyEventPayload(resourceType, resourceID, map[string]any{"policy_type": "gvic", "assignment_mode": mode, "action": action, "descendant_action": action, "sequence": resultingSequence, "assignment_user_ids": userIDs})})
	if err != nil {
		return ResourceGVICPolicy{}, nil, err
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		r.policyV2Idempotency[idempotencyKey] = true
	}
	return after, []domain.DomainEvent{event}, nil
}

func (r *MemoryRepo) GetResourcePermissionPolicy(companyID, resourceType, resourceID string) (ResourcePermissionPolicy, error) {
	resourceType, ok := NormalizeEntityType(resourceType)
	companyID, resourceID = strings.TrimSpace(companyID), strings.TrimSpace(resourceID)
	if !ok || companyID == "" || resourceID == "" {
		return ResourcePermissionPolicy{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.ensureV2PolicySettingsLocked(companyID, resourceType, resourceID) {
		return ResourcePermissionPolicy{}, ErrNotFound
	}
	return r.memoryV2PermissionPolicyLocked(companyID, resourceType, resourceID), nil
}

func (r *MemoryRepo) directMemoryPermissionEdgesLocked(companyID, resourceType, resourceID string) []domain.EntityPermission {
	items := []domain.EntityPermission{}
	for _, item := range r.entityPermissions {
		if item.CompanyID == companyID && item.EntityType == resourceType && item.EntityID == resourceID {
			items = append(items, item)
		}
	}
	sortEntityPermissions(items)
	return items
}

func (r *MemoryRepo) replaceMemoryPermissionEdgesLocked(companyID, resourceType, resourceID string, inputs []domain.EntityPermission) {
	for keyValue, item := range r.entityPermissions {
		if item.CompanyID == companyID && item.EntityType == resourceType && item.EntityID == resourceID {
			delete(r.entityPermissions, keyValue)
		}
	}
	now := time.Now().UTC()
	for _, input := range inputs {
		item := domain.EntityPermission{CompanyID: companyID, EntityType: resourceType, EntityID: resourceID, SubjectType: input.SubjectType, SubjectID: input.SubjectID, AccessLevel: input.AccessLevel, Permission: input.AccessLevel, CreatedTimestamp: now}
		item = r.withEntityPermissionSubjectLocked(item)
		r.entityPermissions[entityPermissionKey(companyID, resourceType, resourceID, item.SubjectType, item.SubjectID, "")] = item
	}
}

func (r *MemoryRepo) memoryV2PermissionPolicyLocked(companyID, resourceType, resourceID string) ResourcePermissionPolicy {
	keyValue := resourcePolicyKey(companyID, resourceType, resourceID)
	setting := r.permissionV2Settings[keyValue]
	resolved := r.resolveV2PolicyLocked(companyID, resourceType, resourceID, false)
	source := r.permissionV2Settings[resourcePolicyKey(companyID, resolved.SourceType, resolved.SourceID)]
	stored := r.directMemoryPermissionEdgesLocked(companyID, resourceType, resourceID)
	if setting.Mode == PolicyModeInherited {
		stored = []domain.EntityPermission{}
	}
	policy := ResourcePermissionPolicy{CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, PermissionMode: setting.Mode, EffectivePermissionMode: PolicyModeInherited, EffectiveSource: PolicySource{ResourceType: resolved.SourceType, ResourceID: resolved.SourceID}, OverwrittenByAncestor: resolved.OverwrittenBy, EffectiveDefaultAccess: source.DefaultAccess, Permissions: stored, EffectivePermissions: r.directMemoryPermissionEdgesLocked(companyID, resolved.SourceType, resolved.SourceID), Revision: memoryV2Revision(setting, resolved, r.policyV2GroupFingerprintLocked(companyID))}
	if setting.Mode == PolicyModeCustomized {
		value := setting.DefaultAccess
		policy.DefaultAccess = &value
	}
	if resolved.SourceType == resourceType && resolved.SourceID == resourceID && resolved.OverwrittenBy == nil {
		policy.EffectivePermissionMode = PolicyModeCustomized
	}
	return policy
}

func (r *MemoryRepo) PutResourcePermissionPolicy(input ResourcePermissionPolicyUpdateInput) (ResourcePermissionPolicy, []domain.DomainEvent, error) {
	resourceType, ok := NormalizeEntityType(input.ResourceType)
	mode, modeOK := normalizePolicyMode(input.PermissionMode)
	action, actionOK := normalizeDescendantAction(input.DescendantAction)
	companyID, resourceID := strings.TrimSpace(input.CompanyID), strings.TrimSpace(input.ResourceID)
	if !ok || !modeOK || !actionOK || companyID == "" || resourceID == "" || (mode == PolicyModeCustomized && input.DefaultAccess == nil) ||
		(mode == PolicyModeInherited && (input.DefaultAccess != nil || len(input.Permissions) > 0)) {
		return ResourcePermissionPolicy{}, nil, ErrInvalid
	}
	normalized, err := normalizeV2EntityPermissionInputs(input.Permissions)
	if err != nil {
		return ResourcePermissionPolicy{}, nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.ensureV2PolicySettingsLocked(companyID, resourceType, resourceID) {
		return ResourcePermissionPolicy{}, nil, ErrNotFound
	}
	idempotencyKey := companyID + ":" + strings.TrimSpace(input.IdempotencyKey)
	if strings.TrimSpace(input.IdempotencyKey) != "" && r.policyV2Idempotency[idempotencyKey] {
		return r.memoryV2PermissionPolicyLocked(companyID, resourceType, resourceID), []domain.DomainEvent{}, nil
	}
	current := r.memoryV2PermissionPolicyLocked(companyID, resourceType, resourceID)
	if expected := cleanPolicyRevision(input.ExpectedRevision); expected != "" && expected != current.Revision {
		return ResourcePermissionPolicy{}, nil, ErrVersionConflict
	}
	for _, item := range normalized {
		if err := r.validateGVICPrincipalLocked(companyID, item.SubjectType, item.SubjectID); err != nil {
			return ResourcePermissionPolicy{}, nil, err
		}
	}
	keyValue := resourcePolicyKey(companyID, resourceType, resourceID)
	setting := r.permissionV2Settings[keyValue]
	if mode == PolicyModeInherited {
		if setting.ParentResourceID == "" {
			return ResourcePermissionPolicy{}, nil, ErrInvalid
		}
		r.replaceMemoryPermissionEdgesLocked(companyID, resourceType, resourceID, nil)
		setting.Mode, setting.DefaultAccess, setting.CustomizedSequence = PolicyModeInherited, "", 0
	} else {
		defaultAccess, ok := NormalizeEntityPermission(*input.DefaultAccess)
		if !ok {
			return ResourcePermissionPolicy{}, nil, ErrInvalid
		}
		edges := make([]domain.EntityPermission, 0, len(normalized))
		for _, item := range normalized {
			edges = append(edges, domain.EntityPermission{SubjectType: item.SubjectType, SubjectID: item.SubjectID, AccessLevel: item.AccessLevel})
		}
		setting.Mode, setting.DefaultAccess, setting.CustomizedSequence = PolicyModeCustomized, defaultAccess, r.nextPermissionV2SequenceLocked()
		r.replaceMemoryPermissionEdgesLocked(companyID, resourceType, resourceID, edges)
	}
	if action == PolicyDescendantActionIncludingCustomized {
		setting.DescendantResetSequence = r.nextPermissionV2SequenceLocked()
	}
	r.permissionV2Settings[keyValue] = setting
	resultingSequence := setting.CustomizedSequence
	if action == PolicyDescendantActionIncludingCustomized {
		resultingSequence = setting.DescendantResetSequence
	}
	after := r.memoryV2PermissionPolicyLocked(companyID, resourceType, resourceID)
	if resourceType == EntityTypeNode {
		r.bumpNodeViewVersionLocked(companyID, resourceID)
	}
	event, err := r.appendDomainEventLocked(DomainEventInput{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, Type: v2PermissionEventType(resourceType), ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey, Payload: v2PolicyEventPayload(resourceType, resourceID, map[string]any{"policy_type": "permission", "permission_mode": mode, "action": action, "descendant_action": action, "sequence": resultingSequence})})
	if err != nil {
		return ResourcePermissionPolicy{}, nil, err
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		r.policyV2Idempotency[idempotencyKey] = true
	}
	return after, []domain.DomainEvent{event}, nil
}

func (r *MemoryRepo) ResourcePolicyFingerprints(companyID, resourceType, resourceID, userID string) (ResourcePolicyFingerprints, error) {
	gvic, err := r.GetResourceGVICPolicy(companyID, resourceType, resourceID)
	if err != nil {
		return ResourcePolicyFingerprints{}, err
	}
	permission, err := r.GetResourcePermissionPolicy(companyID, resourceType, resourceID)
	if err != nil {
		return ResourcePolicyFingerprints{}, err
	}
	return ResourcePolicyFingerprints{
		GVIC:       gvic.Revision,
		Permission: permission.Revision + ":" + strings.TrimSpace(userID),
	}, nil
}
