package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

var savedViewGroupingFieldsBySurface = map[string]map[string]bool{
	SavedViewSurfaceUpdates: {
		"type":       true,
		"date":       true,
		"gvic":       true,
		"priority":   true,
		"project":    true,
		"logic_gate": true,
		"status":     true,
	},
	SavedViewSurfaceLogicGateKanban: {
		"account":  true,
		"due_date": true,
		"person":   true,
		"priority": true,
	},
	SavedViewSurfaceMyWorkActionItemsMine: {
		MyWorkActionItemGroupingColor:             true,
		MyWorkActionItemGroupingHuddleProcess:     true,
		MyWorkActionItemGroupingCompletionDueDate: true,
	},
	SavedViewSurfaceMyWorkActionItemsDelegated: {
		MyWorkActionItemGroupingColor:             true,
		MyWorkActionItemGroupingHuddleProcess:     true,
		MyWorkActionItemGroupingCompletionDueDate: true,
		MyWorkActionItemGroupingPersonInCharge:    true,
	},
	SavedViewSurfaceHuddleLogicGateActionItems: {
		MyWorkActionItemGroupingColor:             true,
		MyWorkActionItemGroupingPersonInCharge:    true,
		MyWorkActionItemGroupingCompletionDueDate: true,
	},
	SavedViewSurfaceHuddleNodeActionItems: {
		MyWorkActionItemGroupingColor:             true,
		MyWorkActionItemGroupingPersonInCharge:    true,
		MyWorkActionItemGroupingCompletionDueDate: true,
	},
}

var actionItemDisplayedFields = map[string]bool{
	"person_in_charge":    true,
	"assigned_by":         true,
	"created_timestamp":   true,
	"source":              true,
	"color":               true,
	"analysis_due_date":   true,
	"completion_due_date": true,
	"status":              true,
	"huddle_process":      true,
}

func NormalizeSavedViewSurface(surface string) (string, bool) {
	switch strings.TrimSpace(surface) {
	case SavedViewSurfaceUpdates:
		return SavedViewSurfaceUpdates, true
	case SavedViewSurfaceLogicGateKanban:
		return SavedViewSurfaceLogicGateKanban, true
	case SavedViewSurfaceMyWorkActionItemsMine:
		return SavedViewSurfaceMyWorkActionItemsMine, true
	case SavedViewSurfaceMyWorkActionItemsDelegated:
		return SavedViewSurfaceMyWorkActionItemsDelegated, true
	case SavedViewSurfaceHuddleLogicGateActionItems:
		return SavedViewSurfaceHuddleLogicGateActionItems, true
	case SavedViewSurfaceHuddleNodeActionItems:
		return SavedViewSurfaceHuddleNodeActionItems, true
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
	if savedViewSurfaceIsSingleUser(surface) {
		return principal == SavedViewPrincipalUser
	}
	return principal == SavedViewPrincipalUser || principal == SavedViewPrincipalGroup
}

func NormalizeSavedViewGroupings(surface string, groupings []domain.SavedViewGrouping) ([]domain.SavedViewGrouping, bool) {
	surface, ok := NormalizeSavedViewSurface(surface)
	if !ok {
		return nil, false
	}
	if groupings == nil {
		groupings = defaultSavedViewGroupings(surface)
	}
	return normalizeSavedViewTerms(surface, groupings)
}

func normalizeSavedViewTerms(surface string, terms []domain.SavedViewGrouping) ([]domain.SavedViewGrouping, bool) {
	allowedFields := savedViewGroupingFieldsBySurface[surface]
	out := make([]domain.SavedViewGrouping, 0, len(terms))
	seen := map[string]bool{}
	for _, grouping := range terms {
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
	if savedViewSurfaceIsActionItems(surface) {
		if dateAddedDirection != "" || settings.DateAddedSortEnabled != nil {
			return domain.SavedViewSettings{}, false
		}
		ordering := settings.Ordering
		if ordering == nil {
			ordering = defaultSavedViewOrdering(surface)
		}
		ordering, ok = normalizeSavedViewTerms(surface, ordering)
		if !ok {
			return domain.SavedViewSettings{}, false
		}
		displayedFields := settings.DisplayedFields
		if displayedFields == nil {
			displayedFields = defaultSavedViewDisplayedFields(surface)
		}
		displayedFields, ok = normalizeSavedViewDisplayedFields(surface, displayedFields)
		if !ok {
			return domain.SavedViewSettings{}, false
		}
		return domain.SavedViewSettings{Ordering: ordering, DisplayedFields: displayedFields}, true
	}
	if surface != SavedViewSurfaceLogicGateKanban {
		return domain.SavedViewSettings{}, dateAddedDirection == "" && settings.DateAddedSortEnabled == nil && settings.Ordering == nil && settings.DisplayedFields == nil
	}
	if settings.Ordering != nil || settings.DisplayedFields != nil {
		return domain.SavedViewSettings{}, false
	}
	if dateAddedDirection == "" {
		dateAddedDirection = "asc"
	}
	if dateAddedDirection != "asc" && dateAddedDirection != "desc" {
		return domain.SavedViewSettings{}, false
	}
	dateAddedEnabled := true
	if settings.DateAddedSortEnabled != nil {
		dateAddedEnabled = *settings.DateAddedSortEnabled
	}
	return domain.SavedViewSettings{DateAddedSortDirection: dateAddedDirection, DateAddedSortEnabled: &dateAddedEnabled}, true
}

func defaultSavedViewGroupings(surface string) []domain.SavedViewGrouping {
	switch surface {
	case SavedViewSurfaceMyWorkActionItemsMine:
		return []domain.SavedViewGrouping{
			{Field: MyWorkActionItemGroupingColor, Direction: "asc"},
			{Field: MyWorkActionItemGroupingHuddleProcess, Direction: "asc"},
		}
	case SavedViewSurfaceMyWorkActionItemsDelegated:
		return []domain.SavedViewGrouping{
			{Field: MyWorkActionItemGroupingColor, Direction: "asc"},
			{Field: MyWorkActionItemGroupingPersonInCharge, Direction: "asc"},
			{Field: MyWorkActionItemGroupingHuddleProcess, Direction: "asc"},
		}
	case SavedViewSurfaceHuddleLogicGateActionItems, SavedViewSurfaceHuddleNodeActionItems:
		return []domain.SavedViewGrouping{
			{Field: MyWorkActionItemGroupingColor, Direction: "asc"},
			{Field: MyWorkActionItemGroupingPersonInCharge, Direction: "asc"},
		}
	default:
		return []domain.SavedViewGrouping{}
	}
}

func defaultSavedViewOrdering(surface string) []domain.SavedViewGrouping {
	if savedViewSurfaceIsActionItems(surface) {
		return []domain.SavedViewGrouping{{Field: MyWorkActionItemGroupingCompletionDueDate, Direction: "asc"}}
	}
	return []domain.SavedViewGrouping{}
}

func defaultSavedViewDisplayedFields(surface string) []string {
	if surface == SavedViewSurfaceMyWorkActionItemsDelegated || savedViewSurfaceIsHuddleActionItems(surface) {
		return []string{"person_in_charge", "completion_due_date"}
	}
	return []string{"completion_due_date"}
}

func normalizeSavedViewDisplayedFields(surface string, fields []string) ([]string, bool) {
	out := make([]string, 0, len(fields))
	seen := map[string]bool{}
	for _, raw := range fields {
		field := strings.TrimSpace(raw)
		if !actionItemDisplayedFields[field] || (savedViewSurfaceIsHuddleActionItems(surface) && field == "huddle_process") || seen[field] {
			return nil, false
		}
		seen[field] = true
		out = append(out, field)
	}
	return out, true
}

func savedViewSurfaceIsMyWorkActionItems(surface string) bool {
	return surface == SavedViewSurfaceMyWorkActionItemsMine || surface == SavedViewSurfaceMyWorkActionItemsDelegated
}

func savedViewSurfaceIsHuddleActionItems(surface string) bool {
	return surface == SavedViewSurfaceHuddleLogicGateActionItems || surface == SavedViewSurfaceHuddleNodeActionItems
}

func savedViewSurfaceIsActionItems(surface string) bool {
	return savedViewSurfaceIsMyWorkActionItems(surface) || savedViewSurfaceIsHuddleActionItems(surface)
}

func savedViewSurfaceIsSingleUser(surface string) bool {
	return surface == SavedViewSurfaceLogicGateKanban || savedViewSurfaceIsActionItems(surface)
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
	if savedViewSurfaceIsActionItems(surface) && savedViewGroupingsOverlap(groupings, settings.Ordering) {
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

func savedViewIsSingleUserView(input SavedViewInput) bool {
	return savedViewSurfaceIsSingleUser(input.Surface) && input.Principal == SavedViewPrincipalUser
}

func savedViewGroupingsOverlap(groupings, ordering []domain.SavedViewGrouping) bool {
	seen := map[string]bool{}
	for _, grouping := range groupings {
		seen[grouping.Field] = true
	}
	for _, term := range ordering {
		if seen[term.Field] {
			return true
		}
	}
	return false
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
