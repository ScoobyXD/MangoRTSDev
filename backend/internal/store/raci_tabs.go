package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	raciTabPositionStep = 1000
	raciTabDefaultLimit = 50
	raciTabMaximumLimit = 100
)

func NormalizeRACITabRole(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case domain.RACIRoleResponsible:
		return domain.RACIRoleResponsible, true
	case domain.RACIRoleAccountable:
		return domain.RACIRoleAccountable, true
	case domain.RACIRoleConsulted:
		return domain.RACIRoleConsulted, true
	case domain.RACIRoleInformed:
		return domain.RACIRoleInformed, true
	default:
		return "", false
	}
}

func normalizeRACITabBranchInput(input RACITabBranchInput) (RACITabBranchInput, bool) {
	rawParentFolderID := strings.TrimSpace(input.ParentFolderID)
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.UserID = cleanUUIDText(input.UserID)
	input.ParentFolderID = cleanOptionalUUIDText(input.ParentFolderID)
	role, roleOK := NormalizeRACITabRole(input.Role)
	if input.CompanyID == "" || input.UserID == "" || !roleOK || input.Offset < 0 ||
		(rawParentFolderID != "" && input.ParentFolderID == "") {
		return RACITabBranchInput{}, false
	}
	input.Role = role
	if input.Limit <= 0 {
		input.Limit = raciTabDefaultLimit
	}
	if input.Limit > raciTabMaximumLimit {
		input.Limit = raciTabMaximumLimit
	}
	return input, true
}

func normalizeRACITabLogicGateCountsInput(input RACITabLogicGateCountsInput) (RACITabLogicGateCountsInput, bool) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.UserID = cleanUUIDText(input.UserID)
	input.LogicGateID = cleanUUIDText(input.LogicGateID)
	return input, input.CompanyID != "" && input.UserID != "" && input.LogicGateID != ""
}

func normalizeRACITabFolderCreateInput(input RACITabFolderCreateInput) (RACITabFolderCreateInput, bool) {
	rawFolderID := strings.TrimSpace(input.FolderID)
	rawParentFolderID := strings.TrimSpace(input.ParentFolderID)
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.UserID = cleanUUIDText(input.UserID)
	input.FolderID = cleanOptionalUUIDText(input.FolderID)
	input.ParentFolderID = cleanOptionalUUIDText(input.ParentFolderID)
	input.Name = strings.TrimSpace(input.Name)
	role, roleOK := NormalizeRACITabRole(input.Role)
	if input.CompanyID == "" || input.UserID == "" || input.Name == "" || !roleOK ||
		(rawFolderID != "" && input.FolderID == "") ||
		(rawParentFolderID != "" && input.ParentFolderID == "") {
		return RACITabFolderCreateInput{}, false
	}
	if input.FolderID == "" {
		input.FolderID = newUUIDv7String()
	}
	input.Role = role
	return input, true
}

func normalizeRACITabFolderRenameInput(input RACITabFolderRenameInput) (RACITabFolderRenameInput, bool) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.UserID = cleanUUIDText(input.UserID)
	input.FolderID = cleanUUIDText(input.FolderID)
	input.Name = strings.TrimSpace(input.Name)
	return input, input.CompanyID != "" && input.UserID != "" && input.FolderID != "" && input.Name != ""
}

func normalizeRACITabFolderDeleteInput(input RACITabFolderDeleteInput) (RACITabFolderDeleteInput, bool) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.UserID = cleanUUIDText(input.UserID)
	input.FolderID = cleanUUIDText(input.FolderID)
	return input, input.CompanyID != "" && input.UserID != "" && input.FolderID != ""
}

func normalizeRACITabLayoutInput(input RACITabLayoutInput) (RACITabLayoutInput, bool) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.UserID = cleanUUIDText(input.UserID)
	role, roleOK := NormalizeRACITabRole(input.Role)
	if input.CompanyID == "" || input.UserID == "" || !roleOK || len(input.Entries) == 0 {
		return RACITabLayoutInput{}, false
	}
	input.Role = role
	seen := map[string]bool{}
	for index := range input.Entries {
		entry := &input.Entries[index]
		rawParentFolderID := strings.TrimSpace(entry.ParentFolderID)
		entry.EntryType = strings.ToLower(strings.TrimSpace(entry.EntryType))
		entry.EntryID = cleanUUIDText(entry.EntryID)
		entry.ParentFolderID = cleanOptionalUUIDText(entry.ParentFolderID)
		if (entry.EntryType != RACITabLayoutEntryFolder && entry.EntryType != RACITabLayoutEntryItem) ||
			entry.EntryID == "" || entry.Position < 0 ||
			(rawParentFolderID != "" && entry.ParentFolderID == "") {
			return RACITabLayoutInput{}, false
		}
		keyValue := entry.EntryType + ":" + entry.EntryID
		if seen[keyValue] {
			return RACITabLayoutInput{}, false
		}
		seen[keyValue] = true
	}
	return input, true
}

func addRACITabStatusCounts(target *domain.RACITabStatusCounts, source domain.RACITabStatusCounts) {
	target.Request += source.Request
	target.Pending += source.Pending
	target.InProgress += source.InProgress
	target.Review += source.Review
}

func raciTabCountsForStatus(status string) domain.RACITabStatusCounts {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "request", "requested":
		return domain.RACITabStatusCounts{Request: 1}
	case "pending":
		return domain.RACITabStatusCounts{Pending: 1}
	case "in_progress", "in progress", "inprogress":
		return domain.RACITabStatusCounts{InProgress: 1}
	case "review":
		return domain.RACITabStatusCounts{Review: 1}
	default:
		return domain.RACITabStatusCounts{}
	}
}

func sortRACITabRows(rows []domain.RACITabRow) {
	sort.SliceStable(rows, func(i, j int) bool {
		leftPosition, leftCreated, leftName, leftKind, leftID := raciTabRowSortValues(rows[i])
		rightPosition, rightCreated, rightName, rightKind, rightID := raciTabRowSortValues(rows[j])
		if leftPosition != rightPosition {
			return leftPosition < rightPosition
		}
		if !leftCreated.Equal(rightCreated) {
			return leftCreated.Before(rightCreated)
		}
		if leftName != rightName {
			return leftName < rightName
		}
		if leftKind != rightKind {
			return leftKind < rightKind
		}
		return leftID < rightID
	})
}

func raciTabRowSortValues(row domain.RACITabRow) (int, time.Time, string, string, string) {
	if row.Folder != nil {
		return row.Folder.Position, row.Folder.CreatedTimestamp, strings.ToLower(row.Folder.Name), "folder", row.Folder.FolderID
	}
	if row.Item != nil {
		return row.Item.Position, row.Item.CreatedTimestamp, strings.ToLower(row.Item.Name), "item", row.Item.LogicGateID
	}
	return 0, time.Time{}, "", row.RowKind, ""
}

func setRACITabNextCursor(page *domain.RACITabPage, offset, limit, total int) {
	if offset+limit < total {
		page.NextCursor = strconv.Itoa(offset + limit)
	}
}
