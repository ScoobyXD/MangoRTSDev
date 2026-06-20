package store

import (
	"miraeopus/backend/internal/domain"
	"time"
)

func (r *MemoryRepo) ListSavedViews(input SavedViewListInput) ([]domain.SavedView, error) {
	input, ok := normalizeSavedViewListInput(input)
	if !ok {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.SavedView, 0)
	for _, item := range r.savedViews {
		if item.CompanyID != input.CompanyID || item.Surface != input.Surface {
			continue
		}
		if !r.savedViewVisibleToUserLocked(item, input.ViewerUserID) {
			continue
		}
		items = append(items, cloneSavedView(item))
	}
	sortSavedViews(items)
	return items, nil
}

func (r *MemoryRepo) GetSavedView(companyID, savedViewID string) (domain.SavedView, error) {
	companyID = cleanUUIDText(companyID)
	savedViewID = cleanUUIDText(savedViewID)
	if companyID == "" || savedViewID == "" {
		return domain.SavedView{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	item, ok := r.savedViews[savedViewKey(companyID, savedViewID)]
	if !ok {
		return domain.SavedView{}, ErrNotFound
	}
	return cloneSavedView(item), nil
}

func (r *MemoryRepo) UpsertSavedView(input SavedViewInput) (domain.SavedView, error) {
	input, ok := normalizeSavedViewInput(input)
	if !ok {
		return domain.SavedView{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	if input.Principal == SavedViewPrincipalUser {
		if _, ok := r.memberships[membershipKey(input.CompanyID, input.PrincipalID)]; !ok {
			return domain.SavedView{}, ErrInvalid
		}
	} else if _, ok := r.userGroups[userGroupKey(input.CompanyID, input.PrincipalID)]; !ok {
		return domain.SavedView{}, ErrInvalid
	}

	now := time.Now().UTC()
	k := savedViewKey(input.CompanyID, input.SavedViewID)
	item, exists := r.savedViews[k]
	if exists {
		item.Surface = input.Surface
		item.Principal = input.Principal
		item.PrincipalID = input.PrincipalID
		item.Name = input.Name
		item.Groupings = cloneSavedViewGroupings(input.Groupings)
		if input.Position > 0 {
			item.Position = input.Position
		}
		item.UpdatedTimestamp = now
		r.savedViews[k] = item
		return cloneSavedView(item), nil
	}
	position := input.Position
	if position <= 0 {
		position = r.nextSavedViewPositionLocked(input.CompanyID, input.Surface, input.Principal, input.PrincipalID)
	}
	item = domain.SavedView{
		CompanyID:        input.CompanyID,
		SavedViewID:      input.SavedViewID,
		Surface:          input.Surface,
		Principal:        input.Principal,
		PrincipalID:      input.PrincipalID,
		Name:             input.Name,
		Groupings:        cloneSavedViewGroupings(input.Groupings),
		Position:         position,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.savedViews[k] = item
	return cloneSavedView(item), nil
}

func (r *MemoryRepo) DeleteSavedView(input SavedViewDeleteInput) error {
	input, ok := normalizeSavedViewDeleteInput(input)
	if !ok {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	k := savedViewKey(input.CompanyID, input.SavedViewID)
	if _, ok := r.savedViews[k]; !ok {
		return ErrNotFound
	}
	delete(r.savedViews, k)
	return nil
}

func (r *MemoryRepo) savedViewVisibleToUserLocked(item domain.SavedView, userID string) bool {
	if item.Principal == SavedViewPrincipalUser {
		return item.PrincipalID == userID
	}
	if item.Principal != SavedViewPrincipalGroup {
		return false
	}
	if r.userHasRoleAdminAccessLocked(item.CompanyID, userID) {
		return true
	}
	_, ok := r.userGroupMembers[userGroupMemberKey(item.CompanyID, item.PrincipalID, userID)]
	return ok
}

func (r *MemoryRepo) nextSavedViewPositionLocked(companyID, surface, principal, principalID string) int {
	position := 0
	for _, item := range r.savedViews {
		if item.CompanyID == companyID && item.Surface == surface && item.Principal == principal && item.PrincipalID == principalID && item.Position > position {
			position = item.Position
		}
	}
	return position + 1000
}

func cloneSavedView(item domain.SavedView) domain.SavedView {
	item.Groupings = cloneSavedViewGroupings(item.Groupings)
	return item
}

func cloneSavedViewGroupings(groupings []domain.SavedViewGrouping) []domain.SavedViewGrouping {
	if len(groupings) == 0 {
		return []domain.SavedViewGrouping{}
	}
	out := make([]domain.SavedViewGrouping, len(groupings))
	copy(out, groupings)
	return out
}
