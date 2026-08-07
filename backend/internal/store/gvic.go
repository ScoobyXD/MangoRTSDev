package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const (
	RACIAssignmentCommandSet    = "set"
	RACIAssignmentCommandAdd    = "add"
	RACIAssignmentCommandRemove = "remove"

	RACIInheritanceDirect             = "direct"
	RACIInheritanceLogicGateInherited = "logic_gate_inherited"
)

type resourceRACIKey struct {
	companyID    string
	resourceType string
	resourceID   string
}

type normalizedRACIAssignmentInput struct {
	role          string
	principalType string
	principalID   string
}

func normalizeResourceRACIKey(companyID, resourceType, resourceID string) (resourceRACIKey, error) {
	resourceType, ok := NormalizeRACIResourceType(resourceType)
	companyID = strings.TrimSpace(companyID)
	resourceID = strings.TrimSpace(resourceID)
	if companyID == "" || resourceID == "" || !ok {
		return resourceRACIKey{}, ErrInvalid
	}
	return resourceRACIKey{companyID: companyID, resourceType: resourceType, resourceID: resourceID}, nil
}

func normalizeResourceRACIAssignmentInput(input ResourceRACIAssignmentInput) (normalizedRACIAssignmentInput, error) {
	role, roleOK := NormalizeRACIRole(input.Role)
	principalType, principalOK := NormalizeRACIPrincipalType(input.PrincipalType)
	principalID := strings.TrimSpace(input.PrincipalID)
	if !roleOK || !principalOK || principalID == "" {
		return normalizedRACIAssignmentInput{}, ErrInvalid
	}
	return normalizedRACIAssignmentInput{role: role, principalType: principalType, principalID: principalID}, nil
}

func normalizeResourceRACIAssignmentInputs(assignments []ResourceRACIAssignmentInput) ([]normalizedRACIAssignmentInput, error) {
	seen := map[string]bool{}
	out := make([]normalizedRACIAssignmentInput, 0, len(assignments))
	for _, assignment := range assignments {
		normalized, err := normalizeResourceRACIAssignmentInput(assignment)
		if err != nil {
			return nil, err
		}
		key := gvicAssignmentInputKey(normalized)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, normalized)
	}
	sort.Slice(out, func(i, j int) bool {
		return gvicAssignmentInputKey(out[i]) < gvicAssignmentInputKey(out[j])
	})
	return out, nil
}

func validateResourceRACIAssignmentInputsForOperation(keyValue resourceRACIKey, assignments []normalizedRACIAssignmentInput, operation string) error {
	if operation == RACIAssignmentCommandRemove {
		return nil
	}
	principalRoles := map[string]string{}
	for _, assignment := range assignments {
		principalKey := assignment.principalType + ":" + assignment.principalID
		if existingRole, exists := principalRoles[principalKey]; exists && existingRole != assignment.role {
			return ErrInvalid
		}
		principalRoles[principalKey] = assignment.role
	}
	_ = keyValue
	return nil
}

func gvicAssignmentInputKey(input normalizedRACIAssignmentInput) string {
	return input.role + ":" + input.principalType + ":" + input.principalID
}

func cloneResourceRACIAssignments(items []domain.ResourceRACIAssignment) []domain.ResourceRACIAssignment {
	if len(items) == 0 {
		return []domain.ResourceRACIAssignment{}
	}
	return append([]domain.ResourceRACIAssignment{}, items...)
}

func inheritedResourceRACIAssignments(items []domain.ResourceRACIAssignment, resourceType, resourceID, sourceResourceType, sourceResourceID string) []domain.ResourceRACIAssignment {
	out := cloneResourceRACIAssignments(items)
	for index := range out {
		out[index].ResourceType = resourceType
		out[index].ResourceID = resourceID
		out[index].SourceResourceType = sourceResourceType
		out[index].SourceResourceID = sourceResourceID
		out[index].InheritanceType = RACIInheritanceLogicGateInherited
		out[index].Inherited = true
		out[index].ReadOnly = true
	}
	return out
}

func logicGateRACIAssignmentFromResource(item domain.ResourceRACIAssignment) domain.LogicGateRACIAssignment {
	return domain.LogicGateRACIAssignment{
		CompanyID:        item.CompanyID,
		LogicGateID:      item.ResourceID,
		Role:             item.Role,
		PrincipalType:    item.PrincipalType,
		PrincipalID:      item.PrincipalID,
		PrincipalName:    item.PrincipalName,
		UserID:           item.UserID,
		UserDisplayName:  item.UserDisplayName,
		UserEmail:        item.UserEmail,
		CreatedTimestamp: item.CreatedTimestamp,
	}
}

func logicGateRACIAssignmentsFromResources(items []domain.ResourceRACIAssignment) []domain.LogicGateRACIAssignment {
	out := make([]domain.LogicGateRACIAssignment, 0, len(items))
	for _, item := range items {
		out = append(out, logicGateRACIAssignmentFromResource(item))
	}
	sortLogicGateRACIAssignments(out)
	return out
}

func sharedInboxRACIAssignmentFromResource(item domain.ResourceRACIAssignment, folderID string) domain.SharedInboxRACIAssignment {
	return domain.SharedInboxRACIAssignment{
		CompanyID:        item.CompanyID,
		FolderID:         folderID,
		SharedInboxID:    item.ResourceID,
		Role:             item.Role,
		PrincipalType:    item.PrincipalType,
		PrincipalID:      item.PrincipalID,
		PrincipalName:    item.PrincipalName,
		UserID:           item.UserID,
		UserDisplayName:  item.UserDisplayName,
		UserEmail:        item.UserEmail,
		CreatedTimestamp: item.CreatedTimestamp,
	}
}

func sharedInboxRACIAssignmentsFromResources(items []domain.ResourceRACIAssignment, folderID string) []domain.SharedInboxRACIAssignment {
	out := make([]domain.SharedInboxRACIAssignment, 0, len(items))
	for _, item := range items {
		out = append(out, sharedInboxRACIAssignmentFromResource(item, folderID))
	}
	sortSharedInboxRACIAssignments(out)
	return out
}

func cloneResourceRACIEffectiveAssignments(items []domain.ResourceRACIEffectiveAssignment) []domain.ResourceRACIEffectiveAssignment {
	if len(items) == 0 {
		return []domain.ResourceRACIEffectiveAssignment{}
	}
	return append([]domain.ResourceRACIEffectiveAssignment{}, items...)
}

func gvicEffectiveUserIDsForRole(items []domain.ResourceRACIEffectiveAssignment, role string) []string {
	role = strings.TrimSpace(role)
	seen := map[string]bool{}
	out := make([]string, 0)
	for _, item := range items {
		if strings.TrimSpace(item.Role) != role {
			continue
		}
		userID := strings.TrimSpace(item.UserID)
		if userID == "" || seen[userID] {
			continue
		}
		seen[userID] = true
		out = append(out, userID)
	}
	sort.Strings(out)
	return out
}

func sortResourceRACIAssignments(items []domain.ResourceRACIAssignment) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].ResourceType != items[j].ResourceType {
			return items[i].ResourceType < items[j].ResourceType
		}
		if items[i].ResourceID != items[j].ResourceID {
			return items[i].ResourceID < items[j].ResourceID
		}
		if gvicRoleSortValue(items[i].Role) != gvicRoleSortValue(items[j].Role) {
			return gvicRoleSortValue(items[i].Role) < gvicRoleSortValue(items[j].Role)
		}
		if items[i].PrincipalType != items[j].PrincipalType {
			return items[i].PrincipalType < items[j].PrincipalType
		}
		leftName := strings.ToLower(strings.TrimSpace(items[i].PrincipalName))
		rightName := strings.ToLower(strings.TrimSpace(items[j].PrincipalName))
		if leftName != rightName {
			return leftName < rightName
		}
		return items[i].PrincipalID < items[j].PrincipalID
	})
}

func sortResourceRACIEffectiveAssignments(items []domain.ResourceRACIEffectiveAssignment) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].ResourceType != items[j].ResourceType {
			return items[i].ResourceType < items[j].ResourceType
		}
		if items[i].ResourceID != items[j].ResourceID {
			return items[i].ResourceID < items[j].ResourceID
		}
		if items[i].UserID != items[j].UserID {
			return items[i].UserID < items[j].UserID
		}
		if gvicRoleSortValue(items[i].Role) != gvicRoleSortValue(items[j].Role) {
			return gvicRoleSortValue(items[i].Role) < gvicRoleSortValue(items[j].Role)
		}
		if items[i].SourceResourceType != items[j].SourceResourceType {
			return items[i].SourceResourceType < items[j].SourceResourceType
		}
		if items[i].SourceResourceID != items[j].SourceResourceID {
			return items[i].SourceResourceID < items[j].SourceResourceID
		}
		if items[i].SourcePrincipalType != items[j].SourcePrincipalType {
			return items[i].SourcePrincipalType < items[j].SourcePrincipalType
		}
		if items[i].SourcePrincipalID != items[j].SourcePrincipalID {
			return items[i].SourcePrincipalID < items[j].SourcePrincipalID
		}
		return items[i].InheritanceType < items[j].InheritanceType
	})
}

func gvicRoleSortValue(role string) int {
	switch role {
	case domain.RACIRoleResponsible:
		return 0
	case domain.RACIRoleAccountable:
		return 1
	case domain.RACIRoleConsulted:
		return 2
	case domain.RACIRoleInformed:
		return 3
	default:
		return 4
	}
}
