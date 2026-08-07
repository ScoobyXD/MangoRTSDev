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

func (r *MemoryRepo) ListResourceGVICAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceGVICAssignment, error) {
	policy, err := r.GetResourceGVICPolicy(companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	return cloneResourceGVICAssignments(policy.GVICAssignments), nil
}

func (r *MemoryRepo) SetResourceGVICAssignments(input ResourceGVICAssignmentUpdateInput) (ResourceGVICAssignmentMutationResult, error) {
	current, err := r.GetResourceGVICPolicy(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	action := PolicyDescendantActionInheritedOnly
	if input.ApplyToDescendants {
		action = PolicyDescendantActionIncludingCustomized
	}
	policy, events, err := r.PutResourceGVICPolicy(ResourceGVICPolicyUpdateInput{
		CompanyID: input.CompanyID, ResourceType: input.ResourceType, ResourceID: input.ResourceID,
		AssignmentMode: PolicyModeCustomized, Assignments: append([]ResourceGVICAssignmentInput{}, input.Assignments...),
		DescendantAction: action, ExpectedRevision: current.Revision, ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey,
	})
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	return ResourceGVICAssignmentMutationResult{
		CompanyID: policy.CompanyID, ResourceType: policy.ResourceType, ResourceID: policy.ResourceID,
		Operation: GVICAssignmentCommandSet, Changed: current.Revision != policy.Revision,
		GVICAssignments: policy.GVICAssignments, EffectiveAssignments: policy.EffectiveAssignments, Events: events,
	}, nil
}

func (r *MemoryRepo) AddResourceGVICAssignments(input ResourceGVICAssignmentCommandInput) (ResourceGVICAssignmentMutationResult, error) {
	current, err := r.GetResourceGVICPolicy(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	items := v2GVICAssignmentsForEdit(current)
	before := append([]ResourceGVICAssignmentInput{}, items...)
	byPrincipal := map[string]ResourceGVICAssignmentInput{}
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
	if v2GVICInputSetsEqual(before, items) {
		return unchangedV2GVICMutation(current, GVICAssignmentCommandAdd), nil
	}
	result, err := r.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID: input.CompanyID, ResourceType: input.ResourceType, ResourceID: input.ResourceID, Assignments: items,
		ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey, ApplyToDescendants: input.ApplyToDescendants,
	})
	result.Operation = GVICAssignmentCommandAdd
	return result, err
}

func (r *MemoryRepo) RemoveResourceGVICAssignments(input ResourceGVICAssignmentCommandInput) (ResourceGVICAssignmentMutationResult, error) {
	current, err := r.GetResourceGVICPolicy(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	remove := map[string]bool{}
	for _, item := range input.Assignments {
		remove[strings.TrimSpace(item.Role)+":"+strings.TrimSpace(item.PrincipalType)+":"+strings.TrimSpace(item.PrincipalID)] = true
	}
	items := []ResourceGVICAssignmentInput{}
	for _, item := range v2GVICAssignmentsForEdit(current) {
		if !remove[item.Role+":"+item.PrincipalType+":"+item.PrincipalID] {
			items = append(items, item)
		}
	}
	if v2GVICInputSetsEqual(v2GVICAssignmentsForEdit(current), items) {
		return unchangedV2GVICMutation(current, GVICAssignmentCommandRemove), nil
	}
	result, err := r.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID: input.CompanyID, ResourceType: input.ResourceType, ResourceID: input.ResourceID, Assignments: items,
		ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey, ApplyToDescendants: input.ApplyToDescendants,
	})
	result.Operation = GVICAssignmentCommandRemove
	return result, err
}

func (r *MemoryRepo) ListResourceGVICEffectiveAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceGVICEffectiveAssignment, error) {
	policy, err := r.GetResourceGVICPolicy(companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	return cloneResourceGVICEffectiveAssignments(policy.EffectiveAssignments), nil
}

func (r *MemoryRepo) validateGVICPrincipalLocked(companyID, principalType, principalID string) error {
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

func (r *MemoryRepo) resourceGVICAssignmentForPrincipalLocked(keyValue resourceGVICKey, input normalizedGVICAssignmentInput, now time.Time) domain.ResourceGVICAssignment {
	item := domain.ResourceGVICAssignment{
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
func (r *MemoryRepo) gvicAssignmentsForResourceLocked(companyID, resourceType, resourceID string) []domain.ResourceGVICAssignment {
	if !r.ensureV2PolicySettingsLocked(companyID, resourceType, resourceID) {
		return []domain.ResourceGVICAssignment{}
	}
	resolved := r.resolveV2PolicyLocked(companyID, resourceType, resourceID, true)
	return r.directMemoryGVICEdgesLocked(companyID, resolved.SourceType, resolved.SourceID)
}

func (r *MemoryRepo) gvicEffectiveAssignmentsForResourceLocked(companyID, resourceType, resourceID string) []domain.ResourceGVICEffectiveAssignment {
	if !r.ensureV2PolicySettingsLocked(companyID, resourceType, resourceID) {
		return []domain.ResourceGVICEffectiveAssignment{}
	}
	resolved := r.resolveV2PolicyLocked(companyID, resourceType, resourceID, true)
	return r.memoryV2EffectiveGVICLocked(companyID, resourceType, resourceID, resolved)
}

// V2 resolves nested group membership and policy inheritance live. These
// retained call sites therefore need no policy projection refresh.
func (r *MemoryRepo) syncGVICGroupDependentResourcesLocked(string)                             {}
func (r *MemoryRepo) syncGVICGroupDependentResourcesForGroupsLocked(string, []string)          {}
func (r *MemoryRepo) syncGVICGroupDependentResourcesForGroupSetLocked(string, map[string]bool) {}
func (r *MemoryRepo) gvicResourceKeysForGroupSetLocked(string, map[string]bool) []resourceGVICKey {
	return nil
}
func (r *MemoryRepo) syncGVICResourceKeysLocked(companyID string, keys []resourceGVICKey) {
	for _, keyValue := range keys {
		if keyValue.companyID != "" {
			companyID = keyValue.companyID
		}
		r.ensureV2PolicySettingsLocked(companyID, keyValue.resourceType, keyValue.resourceID)
	}
}
func (r *MemoryRepo) syncResourceGVICEffectiveAssignmentsLocked([]resourceGVICKey) {}
