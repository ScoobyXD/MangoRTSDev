package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const (
	EntityFieldDefaultColor = "#6366f1"
	EntityFieldMaxNameLen   = 64
)

func NormalizeEntityFieldInput(input EntityFieldInput, requireFieldID bool) (EntityFieldInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.FieldID = cleanUUIDText(input.FieldID)
	input.Name = strings.TrimSpace(input.Name)
	input.Color = normalizeEntityFieldColor(input.Color)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	if input.CompanyID == "" || (requireFieldID && input.FieldID == "") || input.Name == "" || len(input.Name) > EntityFieldMaxNameLen {
		return EntityFieldInput{}, ErrInvalid
	}
	if !validEntityFieldColor(input.Color) {
		return EntityFieldInput{}, ErrInvalid
	}
	return input, nil
}

func NormalizeEntityFieldAssignmentInput(input EntityFieldAssignmentInput) (EntityFieldAssignmentInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ResourceID = cleanUUIDText(input.ResourceID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	resourceType, ok := NormalizeEntityType(input.ResourceType)
	if !ok || (resourceType != EntityTypeProject && resourceType != EntityTypeNode && resourceType != EntityTypeLogicGate) {
		return EntityFieldAssignmentInput{}, ErrInvalid
	}
	input.ResourceType = resourceType
	input.FieldIDs = cleanEntityFieldIDs(input.FieldIDs)
	if input.CompanyID == "" || input.ResourceID == "" {
		return EntityFieldAssignmentInput{}, ErrInvalid
	}
	return input, nil
}

func normalizeEntityFieldColor(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return EntityFieldDefaultColor
	}
	return value
}

func validEntityFieldColor(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, character := range value[1:] {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func cleanEntityFieldIDs(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		fieldID := cleanUUIDText(value)
		if fieldID == "" || seen[fieldID] {
			continue
		}
		seen[fieldID] = true
		result = append(result, fieldID)
	}
	return result
}

func cloneEntityFields(items []domain.EntityField) []domain.EntityField {
	if len(items) == 0 {
		return nil
	}
	return append([]domain.EntityField{}, items...)
}

func sortEntityFields(items []domain.EntityField) {
	sort.Slice(items, func(leftIndex, rightIndex int) bool {
		left := items[leftIndex]
		right := items[rightIndex]
		if left.Position != right.Position {
			return left.Position < right.Position
		}
		leftName := strings.ToLower(strings.TrimSpace(left.Name))
		rightName := strings.ToLower(strings.TrimSpace(right.Name))
		if leftName != rightName {
			return leftName < rightName
		}
		return left.FieldID < right.FieldID
	})
}
