package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const userPinPositionStep = 1000

func NormalizeUserPinResourceType(resourceType string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(resourceType)) {
	case EntityTypeNode:
		return EntityTypeNode, true
	case EntityTypeLogicGate:
		return EntityTypeLogicGate, true
	case EntityTypeProject:
		return EntityTypeProject, true
	default:
		return "", false
	}
}

func normalizeUserPinInput(input UserPinInput) (UserPinInput, bool) {
	companyID := cleanUUIDText(input.CompanyID)
	pinID := cleanUUIDText(input.PinID)
	userID := cleanUUIDText(input.UserID)
	resourceType, resourceOK := NormalizeUserPinResourceType(input.ResourceType)
	resourceID := cleanUUIDText(input.ResourceID)
	name := strings.TrimSpace(input.Name)
	if companyID == "" || userID == "" || resourceID == "" || !resourceOK || name == "" {
		return UserPinInput{}, false
	}
	if pinID == "" {
		pinID = newUUIDv7String()
	}
	input.CompanyID = companyID
	input.PinID = pinID
	input.UserID = userID
	input.ResourceType = resourceType
	input.ResourceID = resourceID
	input.Name = name
	return input, true
}

func normalizeUserPinListInput(input UserPinListInput) (UserPinListInput, bool) {
	companyID := cleanUUIDText(input.CompanyID)
	userID := cleanUUIDText(input.UserID)
	if companyID == "" || userID == "" {
		return UserPinListInput{}, false
	}
	input.CompanyID = companyID
	input.UserID = userID
	return input, true
}

func normalizeUserPinDeleteInput(input UserPinDeleteInput) (UserPinDeleteInput, bool) {
	companyID := cleanUUIDText(input.CompanyID)
	userID := cleanUUIDText(input.UserID)
	pinID := cleanUUIDText(input.PinID)
	if companyID == "" || userID == "" || pinID == "" {
		return UserPinDeleteInput{}, false
	}
	input.CompanyID = companyID
	input.UserID = userID
	input.PinID = pinID
	return input, true
}

func normalizeUserPinReorderInput(input UserPinReorderInput) (UserPinReorderInput, bool) {
	companyID := cleanUUIDText(input.CompanyID)
	userID := cleanUUIDText(input.UserID)
	if companyID == "" || userID == "" || len(input.PinIDs) == 0 {
		return UserPinReorderInput{}, false
	}
	pinIDs := make([]string, 0, len(input.PinIDs))
	seen := map[string]bool{}
	for _, rawID := range input.PinIDs {
		pinID := cleanUUIDText(rawID)
		if pinID == "" || seen[pinID] {
			return UserPinReorderInput{}, false
		}
		seen[pinID] = true
		pinIDs = append(pinIDs, pinID)
	}
	input.CompanyID = companyID
	input.UserID = userID
	input.PinIDs = pinIDs
	return input, true
}

func userPinKey(companyID, pinID string) string {
	return companyID + ":" + pinID
}

func sortUserPins(items []domain.UserPin) {
	sort.Slice(items, func(i, j int) bool {
		left := items[i]
		right := items[j]
		if left.Position != right.Position {
			return left.Position < right.Position
		}
		if !left.CreatedTimestamp.Equal(right.CreatedTimestamp) {
			return left.CreatedTimestamp.Before(right.CreatedTimestamp)
		}
		return left.PinID < right.PinID
	})
}
