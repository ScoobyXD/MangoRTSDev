package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

var savedViewGroupingFieldsBySurface = map[string]map[string]bool{
	SavedViewSurfaceMyWork: {
		"account":    true,
		"due_date":   true,
		"logic_gate": true,
		"person":     true,
		"project":    true,
		"status":     true,
		"team":       true,
	},
	SavedViewSurfaceUpdates: {
		"type":       true,
		"date":       true,
		"gvic":       true,
		"project":    true,
		"logic_gate": true,
	},
	SavedViewSurfaceLogicGateKanban: {
		"account":  true,
		"due_date": true,
		"person":   true,
		"priority": true,
	},
}

func NormalizeSavedViewSurface(surface string) (string, bool) {
	switch strings.TrimSpace(surface) {
	case SavedViewSurfaceMyWork:
		return SavedViewSurfaceMyWork, true
	case SavedViewSurfaceUpdates:
		return SavedViewSurfaceUpdates, true
	case SavedViewSurfaceLogicGateKanban:
		return SavedViewSurfaceLogicGateKanban, true
	default:
		return "", false
	}
}

func NormalizeSavedViewPreferenceSurface(surface string) (string, bool) {
	switch strings.TrimSpace(surface) {
	case SavedViewSurfaceMyWork:
		return SavedViewSurfaceMyWork, true
	case SavedViewSurfaceUpdates:
		return SavedViewSurfaceUpdates, true
	default:
		return "", false
	}
}

func NormalizeSavedViewPrincipal(principal string) (string, bool) {
	switch strings.TrimSpace(principal) {
	case SavedViewPrincipalUser:
		return SavedViewPrincipalUser, true
	case SavedViewPrincipalGroup:
		return SavedViewPrincipalGroup, true
	default:
		return "", false
	}
}

func savedViewSurfaceAllowsPrincipal(surface, principal string) bool {
	surface, ok := NormalizeSavedViewSurface(surface)
	if !ok {
		return false
	}
	principal, ok = NormalizeSavedViewPrincipal(principal)
	if !ok {
		return false
	}
	if surface == SavedViewSurfaceLogicGateKanban {
		return principal == SavedViewPrincipalUser
	}
	return principal == SavedViewPrincipalUser || principal == SavedViewPrincipalGroup
}

func NormalizeSavedViewGroupings(surface string, groupings []domain.SavedViewGrouping) ([]domain.SavedViewGrouping, bool) {
	surface, ok := NormalizeSavedViewSurface(surface)
	if !ok {
		return nil, false
	}
	allowedFields := savedViewGroupingFieldsBySurface[surface]
	out := make([]domain.SavedViewGrouping, 0, len(groupings))
	seen := map[string]bool{}
	for _, grouping := range groupings {
		field := strings.TrimSpace(grouping.Field)
		if !allowedFields[field] || seen[field] {
			return nil, false
		}
		direction, ok := normalizeSavedViewGroupingDirection(grouping.Direction)
		if !ok {
			return nil, false
		}
		seen[field] = true
		out = append(out, domain.SavedViewGrouping{Field: field, Direction: direction})
	}
	return out, true
}

func NormalizeSavedViewSettings(surface string, settings domain.SavedViewSettings) (domain.SavedViewSettings, bool) {
	surface, ok := NormalizeSavedViewSurface(surface)
	if !ok {
		return domain.SavedViewSettings{}, false
	}
	dateAddedDirection := strings.TrimSpace(settings.DateAddedSortDirection)
	if surface != SavedViewSurfaceLogicGateKanban {
		return domain.SavedViewSettings{}, dateAddedDirection == ""
	}
	if dateAddedDirection == "" {
		dateAddedDirection = "asc"
	}
	if dateAddedDirection != "asc" && dateAddedDirection != "desc" {
		return domain.SavedViewSettings{}, false
	}
	return domain.SavedViewSettings{DateAddedSortDirection: dateAddedDirection}, true
}

func normalizeSavedViewGroupingDirection(direction string) (string, bool) {
	switch strings.TrimSpace(direction) {
	case "", "asc":
		return "asc", true
	case "desc":
		return "desc", true
	default:
		return "", false
	}
}

func normalizeSavedViewInput(input SavedViewInput) (SavedViewInput, bool) {
	companyID := cleanUUIDText(input.CompanyID)
	if companyID == "" {
		return SavedViewInput{}, false
	}
	savedViewID := cleanUUIDText(input.SavedViewID)
	if savedViewID == "" {
		savedViewID = newUUIDv7String()
	}
	surface, ok := NormalizeSavedViewSurface(input.Surface)
	if !ok {
		return SavedViewInput{}, false
	}
	principal, ok := NormalizeSavedViewPrincipal(input.Principal)
	if !ok {
		return SavedViewInput{}, false
	}
	if !savedViewSurfaceAllowsPrincipal(surface, principal) {
		return SavedViewInput{}, false
	}
	principalID := cleanUUIDText(input.PrincipalID)
	if principalID == "" {
		return SavedViewInput{}, false
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return SavedViewInput{}, false
	}
	groupings, ok := NormalizeSavedViewGroupings(surface, input.Groupings)
	if !ok {
		return SavedViewInput{}, false
	}
	settings, ok := NormalizeSavedViewSettings(surface, input.Settings)
	if !ok {
		return SavedViewInput{}, false
	}
	input.CompanyID = companyID
	input.SavedViewID = savedViewID
	input.Surface = surface
	input.Principal = principal
	input.PrincipalID = principalID
	input.Name = name
	input.Groupings = groupings
	input.Settings = settings
	return input, true
}

func savedViewIsSingleLogicGateKanbanUserView(input SavedViewInput) bool {
	return input.Surface == SavedViewSurfaceLogicGateKanban && input.Principal == SavedViewPrincipalUser
}

func normalizeSavedViewPreferenceInput(input SavedViewPreferenceInput) (SavedViewPreferenceInput, bool) {
	companyID := cleanUUIDText(input.CompanyID)
	userID := cleanUUIDText(input.UserID)
	surface, ok := NormalizeSavedViewPreferenceSurface(input.Surface)
	if companyID == "" || userID == "" || !ok {
		return SavedViewPreferenceInput{}, false
	}
	selectedSavedViewID := cleanUUIDText(input.SelectedSavedViewID)
	input.CompanyID = companyID
	input.UserID = userID
	input.Surface = surface
	input.SelectedSavedViewID = selectedSavedViewID
	return input, true
}

func normalizeSavedViewListInput(input SavedViewListInput) (SavedViewListInput, bool) {
	companyID := cleanUUIDText(input.CompanyID)
	viewerUserID := cleanUUIDText(input.ViewerUserID)
	surface, ok := NormalizeSavedViewSurface(input.Surface)
	if companyID == "" || viewerUserID == "" || !ok {
		return SavedViewListInput{}, false
	}
	input.CompanyID = companyID
	input.ViewerUserID = viewerUserID
	input.Surface = surface
	return input, true
}

func normalizeSavedViewDeleteInput(input SavedViewDeleteInput) (SavedViewDeleteInput, bool) {
	companyID := cleanUUIDText(input.CompanyID)
	savedViewID := cleanUUIDText(input.SavedViewID)
	if companyID == "" || savedViewID == "" {
		return SavedViewDeleteInput{}, false
	}
	input.CompanyID = companyID
	input.SavedViewID = savedViewID
	return input, true
}

func savedViewKey(companyID, savedViewID string) string {
	return companyID + ":" + savedViewID
}

func sortSavedViews(items []domain.SavedView) {
	sort.Slice(items, func(i, j int) bool {
		left := items[i]
		right := items[j]
		if left.Position != right.Position {
			return left.Position < right.Position
		}
		if cmp := strings.Compare(strings.ToLower(left.Name), strings.ToLower(right.Name)); cmp != 0 {
			return cmp < 0
		}
		if !left.CreatedTimestamp.Equal(right.CreatedTimestamp) {
			return left.CreatedTimestamp.Before(right.CreatedTimestamp)
		}
		return left.SavedViewID < right.SavedViewID
	})
}
