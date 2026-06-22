package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
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
	if !isSingleUserPrimaryGVICResourceType(keyValue.resourceType) || operation == GVICAssignmentCommandRemove {
		return nil
	}
	roleCounts := map[string]int{}
	for _, assignment := range assignments {
		if !isSingleUserPrimaryGVICRole(assignment.role) {
			continue
		}
		if assignment.principalType != EntityPermissionSubjectUser {
			return ErrInvalid
		}
		roleCounts[assignment.role]++
		if roleCounts[assignment.role] > 1 {
			return ErrInvalid
		}
	}
	return nil
}

func isSingleUserPrimaryGVICResourceType(resourceType string) bool {
	return resourceType == EntityTypeNode || resourceType == EntityTypeLogicGate
}

func isSingleUserPrimaryGVICRole(role string) bool {
	return role == domain.GVICRoleGenerated || role == domain.GVICRoleVerified
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

func gvicEffectiveProjectionRowKey(row GVICEffectiveAssignmentProjectionRow) ProjectionRowKey {
	return ProjectionRowKey{
		UserID:              strings.TrimSpace(row.UserID),
		ResourceType:        strings.TrimSpace(row.ResourceType),
		ResourceID:          strings.TrimSpace(row.ResourceID),
		Role:                strings.TrimSpace(row.Role),
		SourceResourceType:  strings.TrimSpace(row.SourceResourceType),
		SourceResourceID:    strings.TrimSpace(row.SourceResourceID),
		SourcePrincipalType: strings.TrimSpace(row.SourcePrincipalType),
		SourcePrincipalID:   strings.TrimSpace(row.SourcePrincipalID),
		InheritanceType:     strings.TrimSpace(row.InheritanceType),
	}
}

func gvicEffectiveProjectionRowKeyString(key ProjectionRowKey) string {
	return strings.Join([]string{
		strings.TrimSpace(key.UserID),
		strings.TrimSpace(key.ResourceType),
		strings.TrimSpace(key.ResourceID),
		strings.TrimSpace(key.Role),
		strings.TrimSpace(key.SourceResourceType),
		strings.TrimSpace(key.SourceResourceID),
		strings.TrimSpace(key.SourcePrincipalType),
		strings.TrimSpace(key.SourcePrincipalID),
		strings.TrimSpace(key.InheritanceType),
	}, ":")
}

func gvicEffectiveProjectionRowFromDomain(item domain.ResourceGVICEffectiveAssignment) GVICEffectiveAssignmentProjectionRow {
	return GVICEffectiveAssignmentProjectionRow{
		CompanyID:           strings.TrimSpace(item.CompanyID),
		UserID:              strings.TrimSpace(item.UserID),
		ResourceType:        strings.TrimSpace(item.ResourceType),
		ResourceID:          strings.TrimSpace(item.ResourceID),
		Role:                strings.TrimSpace(item.Role),
		SourceResourceType:  strings.TrimSpace(item.SourceResourceType),
		SourceResourceID:    strings.TrimSpace(item.SourceResourceID),
		SourcePrincipalType: strings.TrimSpace(item.SourcePrincipalType),
		SourcePrincipalID:   strings.TrimSpace(item.SourcePrincipalID),
		InheritanceType:     strings.TrimSpace(item.InheritanceType),
		UpdatedTimestamp:    item.UpdatedTimestamp,
	}
}

func gvicEffectiveProjectionRowsFromDomain(items []domain.ResourceGVICEffectiveAssignment) []GVICEffectiveAssignmentProjectionRow {
	rows := make([]GVICEffectiveAssignmentProjectionRow, 0, len(items))
	for _, item := range items {
		rows = append(rows, gvicEffectiveProjectionRowFromDomain(item))
	}
	return rows
}

func diffGVICEffectiveProjectionRows(before, after []GVICEffectiveAssignmentProjectionRow) []ProjectionDelta {
	beforeByKey := map[string]GVICEffectiveAssignmentProjectionRow{}
	afterByKey := map[string]GVICEffectiveAssignmentProjectionRow{}
	keys := map[string]ProjectionRowKey{}
	for _, row := range before {
		key := gvicEffectiveProjectionRowKey(row)
		keyString := gvicEffectiveProjectionRowKeyString(key)
		if keyString == "::::::::" {
			continue
		}
		beforeByKey[keyString] = row
		keys[keyString] = key
	}
	for _, row := range after {
		key := gvicEffectiveProjectionRowKey(row)
		keyString := gvicEffectiveProjectionRowKeyString(key)
		if keyString == "::::::::" {
			continue
		}
		afterByKey[keyString] = row
		keys[keyString] = key
	}
	orderedKeys := make([]string, 0, len(keys))
	for key := range keys {
		orderedKeys = append(orderedKeys, key)
	}
	sort.Strings(orderedKeys)
	now := time.Now().UTC()
	deltas := make([]ProjectionDelta, 0, len(orderedKeys))
	for _, keyString := range orderedKeys {
		key := keys[keyString]
		beforeRow, hadBefore := beforeByKey[keyString]
		afterRow, hasAfter := afterByKey[keyString]
		switch {
		case !hasAfter && hadBefore:
			deltas = append(deltas, ProjectionDelta{
				CompanyID:          beforeRow.CompanyID,
				Projection:         ProjectionNameGVICEffectiveAssignments,
				Operation:          ProjectionDeltaOperationDelete,
				RowKey:             key,
				ProjectedTimestamp: now,
			})
		case hasAfter && !hadBefore:
			row := afterRow
			projectedAt := row.UpdatedTimestamp
			if projectedAt.IsZero() {
				projectedAt = now
			}
			deltas = append(deltas, ProjectionDelta{
				CompanyID:          row.CompanyID,
				Projection:         ProjectionNameGVICEffectiveAssignments,
				Operation:          ProjectionDeltaOperationUpsert,
				RowKey:             key,
				Row:                &row,
				ProjectedTimestamp: projectedAt,
			})
		}
	}
	return deltas
}
