package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const userPinPositionStep = 1000

const (
	UserPinLayoutEntryFolder = "folder"
	UserPinLayoutEntryPin    = "pin"
)

func NormalizeUserPinResourceType(resourceType string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(resourceType)) {
	case EntityTypeNode:
		return EntityTypeNode, true
	case EntityTypeLogicGate:
		return EntityTypeLogicGate, true
	case EntityTypeProject:
		return EntityTypeProject, true
	case EntityTypeHuddleLogicGate:
		return EntityTypeHuddleLogicGate, true
	case EntityTypeHuddleNode:
		return EntityTypeHuddleNode, true
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
	parentFolderID := cleanOptionalUUIDText(input.ParentFolderID)
	if companyID == "" || userID == "" || resourceID == "" || !resourceOK || name == "" || (strings.TrimSpace(input.ParentFolderID) != "" && parentFolderID == "") {
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
	input.ParentFolderID = parentFolderID
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

func normalizeUserPinFolderCreateInput(input UserPinFolderCreateInput) (UserPinFolderCreateInput, bool) {
	companyID := cleanUUIDText(input.CompanyID)
	userID := cleanUUIDText(input.UserID)
	folderID := cleanUUIDText(input.FolderID)
	parentFolderID := cleanOptionalUUIDText(input.ParentFolderID)
	name := strings.TrimSpace(input.Name)
	if companyID == "" || userID == "" || name == "" || (strings.TrimSpace(input.ParentFolderID) != "" && parentFolderID == "") {
		return UserPinFolderCreateInput{}, false
	}
	if folderID == "" {
		folderID = newUUIDv7String()
	}
	if folderID == parentFolderID {
		return UserPinFolderCreateInput{}, false
	}
	input.CompanyID = companyID
	input.UserID = userID
	input.FolderID = folderID
	input.ParentFolderID = parentFolderID
	input.Name = name
	return input, true
}

func normalizeUserPinFolderRenameInput(input UserPinFolderRenameInput) (UserPinFolderRenameInput, bool) {
	companyID := cleanUUIDText(input.CompanyID)
	userID := cleanUUIDText(input.UserID)
	folderID := cleanUUIDText(input.FolderID)
	name := strings.TrimSpace(input.Name)
	if companyID == "" || userID == "" || folderID == "" || name == "" {
		return UserPinFolderRenameInput{}, false
	}
	input.CompanyID = companyID
	input.UserID = userID
	input.FolderID = folderID
	input.Name = name
	return input, true
}

func normalizeUserPinFolderDeleteInput(input UserPinFolderDeleteInput) (UserPinFolderDeleteInput, bool) {
	companyID := cleanUUIDText(input.CompanyID)
	userID := cleanUUIDText(input.UserID)
	folderID := cleanUUIDText(input.FolderID)
	if companyID == "" || userID == "" || folderID == "" {
		return UserPinFolderDeleteInput{}, false
	}
	input.CompanyID = companyID
	input.UserID = userID
	input.FolderID = folderID
	return input, true
}

func normalizeUserPinLayoutInput(input UserPinLayoutInput) (UserPinLayoutInput, bool) {
	companyID := cleanUUIDText(input.CompanyID)
	userID := cleanUUIDText(input.UserID)
	if companyID == "" || userID == "" || len(input.Entries) == 0 {
		return UserPinLayoutInput{}, false
	}
	entries := make([]UserPinLayoutEntry, 0, len(input.Entries))
	seen := map[string]bool{}
	for _, raw := range input.Entries {
		entryType := strings.ToLower(strings.TrimSpace(raw.EntryType))
		entryID := cleanUUIDText(raw.EntryID)
		parentFolderID := cleanOptionalUUIDText(raw.ParentFolderID)
		if (entryType != UserPinLayoutEntryFolder && entryType != UserPinLayoutEntryPin) || entryID == "" || raw.Position <= 0 || (strings.TrimSpace(raw.ParentFolderID) != "" && parentFolderID == "") {
			return UserPinLayoutInput{}, false
		}
		key := entryType + ":" + entryID
		if seen[key] || (entryType == UserPinLayoutEntryFolder && entryID == parentFolderID) {
			return UserPinLayoutInput{}, false
		}
		seen[key] = true
		entries = append(entries, UserPinLayoutEntry{EntryType: entryType, EntryID: entryID, ParentFolderID: parentFolderID, Position: raw.Position})
	}
	input.CompanyID = companyID
	input.UserID = userID
	input.Entries = entries
	return input, true
}

func normalizeUserPinGroupInput(input UserPinGroupInput) (UserPinGroupInput, bool) {
	companyID := cleanUUIDText(input.CompanyID)
	userID := cleanUUIDText(input.UserID)
	folderID := cleanUUIDText(input.FolderID)
	draggedPinID := cleanUUIDText(input.DraggedPinID)
	targetPinID := cleanUUIDText(input.TargetPinID)
	name := strings.TrimSpace(input.Name)
	if companyID == "" || userID == "" || draggedPinID == "" || targetPinID == "" || draggedPinID == targetPinID || name == "" {
		return UserPinGroupInput{}, false
	}
	if folderID == "" {
		folderID = newUUIDv7String()
	}
	input.CompanyID = companyID
	input.UserID = userID
	input.FolderID = folderID
	input.DraggedPinID = draggedPinID
	input.TargetPinID = targetPinID
	input.Name = name
	return input, true
}

func cleanOptionalUUIDText(value string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	return cleanUUIDText(value)
}

func userPinKey(companyID, pinID string) string {
	return companyID + ":" + pinID
}

func userPinFolderKey(companyID, folderID string) string {
	return companyID + ":" + folderID
}

func userPinParentID(parent *string) string {
	if parent == nil {
		return ""
	}
	return strings.TrimSpace(*parent)
}

func userPinParentPointer(parentFolderID string) *string {
	parentFolderID = strings.TrimSpace(parentFolderID)
	if parentFolderID == "" {
		return nil
	}
	value := parentFolderID
	return &value
}

func sortUserPins(items []domain.UserPin) {
	sort.Slice(items, func(i, j int) bool {
		left := items[i]
		right := items[j]
		leftParent := userPinParentID(left.ParentFolderID)
		rightParent := userPinParentID(right.ParentFolderID)
		if leftParent != rightParent {
			return leftParent < rightParent
		}
		if left.Position != right.Position {
			return left.Position < right.Position
		}
		if !left.CreatedTimestamp.Equal(right.CreatedTimestamp) {
			return left.CreatedTimestamp.Before(right.CreatedTimestamp)
		}
		return left.PinID < right.PinID
	})
}

func sortUserPinFolders(items []domain.UserPinFolder) {
	sort.Slice(items, func(i, j int) bool {
		left := items[i]
		right := items[j]
		leftParent := userPinParentID(left.ParentFolderID)
		rightParent := userPinParentID(right.ParentFolderID)
		if leftParent != rightParent {
			return leftParent < rightParent
		}
		if left.Position != right.Position {
			return left.Position < right.Position
		}
		if !left.CreatedTimestamp.Equal(right.CreatedTimestamp) {
			return left.CreatedTimestamp.Before(right.CreatedTimestamp)
		}
		return left.FolderID < right.FolderID
	})
}

func userPinFolderParentsHaveCycle(parents map[string]string) bool {
	for folderID := range parents {
		seen := map[string]bool{folderID: true}
		for parentID := parents[folderID]; parentID != ""; parentID = parents[parentID] {
			if seen[parentID] {
				return true
			}
			if _, exists := parents[parentID]; !exists {
				break
			}
			seen[parentID] = true
		}
	}
	return false
}
