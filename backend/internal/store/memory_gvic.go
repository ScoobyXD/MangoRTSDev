package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func gvicSourceAssignmentKey(companyID, resourceType, resourceID, role, principalType, principalID string) string {
	return strings.Join([]string{
		strings.TrimSpace(companyID),
		strings.TrimSpace(resourceType),
		strings.TrimSpace(resourceID),
		strings.TrimSpace(role),
		strings.TrimSpace(principalType),
		strings.TrimSpace(principalID),
	}, ":")
}

func (r *MemoryRepo) ListResourceRACIAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceRACIAssignment, error) {
	policy, err := r.GetResourceRACIPolicy(companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	return cloneResourceRACIAssignments(policy.RACIAssignments), nil
}

func (r *MemoryRepo) SetResourceRACIAssignments(input ResourceRACIAssignmentUpdateInput) (ResourceRACIAssignmentMutationResult, error) {
	current, err := r.GetResourceRACIPolicy(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return ResourceRACIAssignmentMutationResult{}, err
	}
	action := PolicyDescendantActionInheritedOnly
	if input.ApplyToDescendants {
		action = PolicyDescendantActionIncludingCustomized
	}
	policy, events, err := r.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: input.CompanyID, ResourceType: input.ResourceType, ResourceID: input.ResourceID,
		AssignmentMode: PolicyModeCustomized, Assignments: append([]ResourceRACIAssignmentInput{}, input.Assignments...),
		DescendantAction: action, ExpectedRevision: current.Revision, ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey,
	})
	if err != nil {
		return ResourceRACIAssignmentMutationResult{}, err
	}
	return ResourceRACIAssignmentMutationResult{
		CompanyID: policy.CompanyID, ResourceType: policy.ResourceType, ResourceID: policy.ResourceID,
		Operation: RACIAssignmentCommandSet, Changed: current.Revision != policy.Revision,
		RACIAssignments: policy.RACIAssignments, EffectiveAssignments: policy.EffectiveAssignments, Events: events,
	}, nil
}

func (r *MemoryRepo) AddResourceRACIAssignments(input ResourceRACIAssignmentCommandInput) (ResourceRACIAssignmentMutationResult, error) {
	current, err := r.GetResourceRACIPolicy(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return ResourceRACIAssignmentMutationResult{}, err
	}
	items := v2RACIAssignmentsForEdit(current)
	before := append([]ResourceRACIAssignmentInput{}, items...)
	byPrincipal := map[string]ResourceRACIAssignmentInput{}
	for _, item := range items {
		byPrincipal[item.PrincipalType+":"+item.PrincipalID] = item
	}
	for _, item := range input.Assignments {
		byPrincipal[strings.TrimSpace(item.PrincipalType)+":"+strings.TrimSpace(item.PrincipalID)] = item
	}
	items = items[:0]
	for _, item := range byPrincipal {
		items = append(items, item)
	}
	if v2RACIInputSetsEqual(before, items) {
		return unchangedV2RACIMutation(current, RACIAssignmentCommandAdd), nil
	}
	result, err := r.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: input.CompanyID, ResourceType: input.ResourceType, ResourceID: input.ResourceID, Assignments: items,
		ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey, ApplyToDescendants: input.ApplyToDescendants,
	})
	result.Operation = RACIAssignmentCommandAdd
	return result, err
}

func (r *MemoryRepo) RemoveResourceRACIAssignments(input ResourceRACIAssignmentCommandInput) (ResourceRACIAssignmentMutationResult, error) {
	current, err := r.GetResourceRACIPolicy(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return ResourceRACIAssignmentMutationResult{}, err
	}
	remove := map[string]bool{}
	for _, item := range input.Assignments {
		remove[strings.TrimSpace(item.Role)+":"+strings.TrimSpace(item.PrincipalType)+":"+strings.TrimSpace(item.PrincipalID)] = true
	}
	items := []ResourceRACIAssignmentInput{}
	for _, item := range v2RACIAssignmentsForEdit(current) {
		if !remove[item.Role+":"+item.PrincipalType+":"+item.PrincipalID] {
			items = append(items, item)
		}
	}
	if v2RACIInputSetsEqual(v2RACIAssignmentsForEdit(current), items) {
		return unchangedV2RACIMutation(current, RACIAssignmentCommandRemove), nil
	}
	result, err := r.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: input.CompanyID, ResourceType: input.ResourceType, ResourceID: input.ResourceID, Assignments: items,
		ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey, ApplyToDescendants: input.ApplyToDescendants,
	})
	result.Operation = RACIAssignmentCommandRemove
	return result, err
}

func (r *MemoryRepo) ListResourceRACIEffectiveAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceRACIEffectiveAssignment, error) {
	policy, err := r.GetResourceRACIPolicy(companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	return cloneResourceRACIEffectiveAssignments(policy.EffectiveAssignments), nil
}

func (r *MemoryRepo) validateRACIPrincipalLocked(companyID, principalType, principalID string) error {
	switch principalType {
	case EntityPermissionSubjectUser:
		if _, ok := r.memberships[membershipKey(companyID, principalID)]; !ok {
			return ErrPrincipalNotInCompany
		}
	case EntityPermissionSubjectGroup:
		if _, ok := r.userGroups[userGroupKey(companyID, principalID)]; !ok {
			return ErrPrincipalNotInCompany
		}
	default:
		return ErrInvalid
	}
	return nil
}

func (r *MemoryRepo) resourceRACIAssignmentForPrincipalLocked(keyValue resourceRACIKey, input normalizedRACIAssignmentInput, now time.Time) domain.ResourceRACIAssignment {
	item := domain.ResourceRACIAssignment{
		CompanyID: keyValue.companyID, ResourceType: keyValue.resourceType, ResourceID: keyValue.resourceID,
		Role: input.role, PrincipalType: input.principalType, PrincipalID: input.principalID,
		CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	switch input.principalType {
	case EntityPermissionSubjectUser:
		if user, ok := r.companyUserByIDLocked(keyValue.companyID, input.principalID); ok {
			item.UserID, item.UserDisplayName, item.UserEmail = user.UserID, strings.TrimSpace(user.DisplayName), strings.TrimSpace(user.Email)
			item.PrincipalName = item.UserDisplayName
			if item.PrincipalName == "" {
				item.PrincipalName = item.UserEmail
			}
		}
	case EntityPermissionSubjectGroup:
		if group, ok := r.userGroups[userGroupKey(keyValue.companyID, input.principalID)]; ok {
			item.PrincipalName = strings.TrimSpace(group.Name)
		}
	}
	return item
}

// gvicAssignmentsForResourceLocked returns the graph edges from the V2 source
// that currently governs the resource. It does not read or maintain a derived
// effective-assignment table.
func (r *MemoryRepo) gvicAssignmentsForResourceLocked(companyID, resourceType, resourceID string) []domain.ResourceRACIAssignment {
	if !r.ensureV2PolicySettingsLocked(companyID, resourceType, resourceID) {
		return []domain.ResourceRACIAssignment{}
	}
	resolved := r.resolveV2PolicyLocked(companyID, resourceType, resourceID, true)
	return r.directMemoryRACIEdgesLocked(companyID, resolved.SourceType, resolved.SourceID)
}

func (r *MemoryRepo) gvicEffectiveAssignmentsForResourceLocked(companyID, resourceType, resourceID string) []domain.ResourceRACIEffectiveAssignment {
	if !r.ensureV2PolicySettingsLocked(companyID, resourceType, resourceID) {
		return []domain.ResourceRACIEffectiveAssignment{}
	}
	resolved := r.resolveV2PolicyLocked(companyID, resourceType, resourceID, true)
	return r.memoryV2EffectiveRACILocked(companyID, resourceType, resourceID, resolved)
}

// V2 resolves nested group membership and policy inheritance live. These
// retained call sites therefore need no policy projection refresh.
func (r *MemoryRepo) syncRACIGroupDependentResourcesLocked(string)                             {}
func (r *MemoryRepo) syncRACIGroupDependentResourcesForGroupsLocked(string, []string)          {}
func (r *MemoryRepo) syncRACIGroupDependentResourcesForGroupSetLocked(string, map[string]bool) {}
func (r *MemoryRepo) gvicResourceKeysForGroupSetLocked(string, map[string]bool) []resourceRACIKey {
	return nil
}
func (r *MemoryRepo) syncRACIResourceKeysLocked(companyID string, keys []resourceRACIKey) {
	for _, keyValue := range keys {
		if keyValue.companyID != "" {
			companyID = keyValue.companyID
		}
		r.ensureV2PolicySettingsLocked(companyID, keyValue.resourceType, keyValue.resourceID)
	}
}
func (r *MemoryRepo) syncResourceRACIEffectiveAssignmentsLocked([]resourceRACIKey) {}
