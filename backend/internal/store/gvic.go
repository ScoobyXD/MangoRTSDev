package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const (
	GVICAssignmentCommandSet    = "set"
	GVICAssignmentCommandAdd    = "add"
	GVICAssignmentCommandRemove = "remove"

	GVICInheritanceDirect             = "direct"
	GVICInheritanceLogicGateInherited = "logic_gate_inherited"
)

type resourceGVICKey struct {
	companyID    string
	resourceType string
	resourceID   string
}

type normalizedGVICAssignmentInput struct {
	role          string
	principalType string
	principalID   string
}

func normalizeResourceGVICKey(companyID, resourceType, resourceID string) (resourceGVICKey, error) {
	resourceType, ok := NormalizeGVICResourceType(resourceType)
	companyID = strings.TrimSpace(companyID)
	resourceID = strings.TrimSpace(resourceID)
	if companyID == "" || resourceID == "" || !ok {
		return resourceGVICKey{}, ErrInvalid
	}
	return resourceGVICKey{companyID: companyID, resourceType: resourceType, resourceID: resourceID}, nil
}

func normalizeResourceGVICAssignmentInput(input ResourceGVICAssignmentInput) (normalizedGVICAssignmentInput, error) {
	role, roleOK := NormalizeGVICRole(input.Role)
	principalType, principalOK := NormalizeGVICPrincipalType(input.PrincipalType)
	principalID := strings.TrimSpace(input.PrincipalID)
	if !roleOK || !principalOK || principalID == "" {
		return normalizedGVICAssignmentInput{}, ErrInvalid
	}
	return normalizedGVICAssignmentInput{role: role, principalType: principalType, principalID: principalID}, nil
}

func normalizeResourceGVICAssignmentInputs(assignments []ResourceGVICAssignmentInput) ([]normalizedGVICAssignmentInput, error) {
	seen := map[string]bool{}
	out := make([]normalizedGVICAssignmentInput, 0, len(assignments))
	for _, assignment := range assignments {
		normalized, err := normalizeResourceGVICAssignmentInput(assignment)
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

func validateResourceGVICAssignmentInputsForOperation(keyValue resourceGVICKey, assignments []normalizedGVICAssignmentInput, operation string) error {
	if operation == GVICAssignmentCommandRemove {
		return nil
	}
	roleCounts := map[string]int{}
	principalRoles := map[string]string{}
	for _, assignment := range assignments {
		if (assignment.role == domain.GVICRoleGenerated || assignment.role == domain.GVICRoleVerified) && assignment.principalType != EntityPermissionSubjectUser {
			return ErrInvalid
		}
		principalKey := assignment.principalType + ":" + assignment.principalID
		if existingRole, exists := principalRoles[principalKey]; exists && existingRole != assignment.role {
			return ErrInvalid
		}
		principalRoles[principalKey] = assignment.role
		if assignment.role == domain.GVICRoleGenerated {
			roleCounts[assignment.role]++
			if roleCounts[assignment.role] > 1 {
				return ErrInvalid
			}
		}
	}
	_ = keyValue
	return nil
}

func isSingleUserPrimaryGVICResourceType(resourceType string) bool {
	return resourceType == EntityTypeNode || resourceType == EntityTypeLogicGate
}

func isSingleUserPrimaryGVICRole(role string) bool {
	return role == domain.GVICRoleGenerated
}

func gvicAssignmentInputKey(input normalizedGVICAssignmentInput) string {
	return input.role + ":" + input.principalType + ":" + input.principalID
}

func cloneResourceGVICAssignments(items []domain.ResourceGVICAssignment) []domain.ResourceGVICAssignment {
	if len(items) == 0 {
		return []domain.ResourceGVICAssignment{}
	}
	return append([]domain.ResourceGVICAssignment{}, items...)
}

func inheritedResourceGVICAssignments(items []domain.ResourceGVICAssignment, resourceType, resourceID, sourceResourceType, sourceResourceID string) []domain.ResourceGVICAssignment {
	out := cloneResourceGVICAssignments(items)
	for index := range out {
		out[index].ResourceType = resourceType
		out[index].ResourceID = resourceID
		out[index].SourceResourceType = sourceResourceType
		out[index].SourceResourceID = sourceResourceID
		out[index].InheritanceType = GVICInheritanceLogicGateInherited
		out[index].Inherited = true
		out[index].ReadOnly = true
	}
	return out
}

func logicGateGVICAssignmentFromResource(item domain.ResourceGVICAssignment) domain.LogicGateGVICAssignment {
	return domain.LogicGateGVICAssignment{
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

func logicGateGVICAssignmentsFromResources(items []domain.ResourceGVICAssignment) []domain.LogicGateGVICAssignment {
	out := make([]domain.LogicGateGVICAssignment, 0, len(items))
	for _, item := range items {
		out = append(out, logicGateGVICAssignmentFromResource(item))
	}
	sortLogicGateGVICAssignments(out)
	return out
}

func sharedInboxGVICAssignmentFromResource(item domain.ResourceGVICAssignment, folderID string) domain.SharedInboxGVICAssignment {
	return domain.SharedInboxGVICAssignment{
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

func sharedInboxGVICAssignmentsFromResources(items []domain.ResourceGVICAssignment, folderID string) []domain.SharedInboxGVICAssignment {
	out := make([]domain.SharedInboxGVICAssignment, 0, len(items))
	for _, item := range items {
		out = append(out, sharedInboxGVICAssignmentFromResource(item, folderID))
	}
	sortSharedInboxGVICAssignments(out)
	return out
}

func cloneResourceGVICEffectiveAssignments(items []domain.ResourceGVICEffectiveAssignment) []domain.ResourceGVICEffectiveAssignment {
	if len(items) == 0 {
		return []domain.ResourceGVICEffectiveAssignment{}
	}
	return append([]domain.ResourceGVICEffectiveAssignment{}, items...)
}

func gvicEffectiveUserIDsForRole(items []domain.ResourceGVICEffectiveAssignment, role string) []string {
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

func sortResourceGVICAssignments(items []domain.ResourceGVICAssignment) {
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

func sortResourceGVICEffectiveAssignments(items []domain.ResourceGVICEffectiveAssignment) {
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
	case domain.GVICRoleGenerated:
		return 0
	case domain.GVICRoleVerified:
		return 1
	case domain.GVICRoleConsulted:
		return 2
	case domain.GVICRoleInformed:
		return 3
	default:
		return 4
	}
}
