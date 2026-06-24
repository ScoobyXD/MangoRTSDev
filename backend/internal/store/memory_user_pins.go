package store

import (
	"miraeopus/backend/internal/domain"
	"time"
)

func (r *MemoryRepo) ListUserPins(input UserPinListInput) ([]domain.UserPin, error) {
	input, ok := normalizeUserPinListInput(input)
	if !ok {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	if _, ok := r.memberships[membershipKey(input.CompanyID, input.UserID)]; !ok {
		return nil, ErrInvalid
	}
	items := make([]domain.UserPin, 0)
	for _, item := range r.userPins {
		if item.CompanyID == input.CompanyID && item.UserID == input.UserID {
			items = append(items, item)
		}
	}
	sortUserPins(items)
	return items, nil
}

func (r *MemoryRepo) UpsertUserPin(input UserPinInput) (domain.UserPin, error) {
	input, ok := normalizeUserPinInput(input)
	if !ok {
		return domain.UserPin{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.memberships[membershipKey(input.CompanyID, input.UserID)]; !ok {
		return domain.UserPin{}, ErrInvalid
	}
	if !r.entityExistsLocked(input.CompanyID, input.ResourceType, input.ResourceID) {
		return domain.UserPin{}, ErrNotFound
	}
	now := time.Now().UTC()
	for pinKey, item := range r.userPins {
		if item.CompanyID == input.CompanyID &&
			item.UserID == input.UserID &&
			item.ResourceType == input.ResourceType &&
			item.ResourceID == input.ResourceID {
			item.Name = input.Name
			r.userPins[pinKey] = item
			return item, nil
		}
	}
	position := input.Position
	if position <= 0 {
		position = r.nextUserPinPositionLocked(input.CompanyID, input.UserID)
	}
	item := domain.UserPin{
		CompanyID:        input.CompanyID,
		PinID:            input.PinID,
		UserID:           input.UserID,
		ResourceType:     input.ResourceType,
		ResourceID:       input.ResourceID,
		Name:             input.Name,
		Position:         position,
		CreatedTimestamp: now,
	}
	r.userPins[userPinKey(input.CompanyID, input.PinID)] = item
	return item, nil
}

func (r *MemoryRepo) DeleteUserPin(input UserPinDeleteInput) error {
	input, ok := normalizeUserPinDeleteInput(input)
	if !ok {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.userPins[userPinKey(input.CompanyID, input.PinID)]
	if !ok || item.UserID != input.UserID {
		return ErrNotFound
	}
	delete(r.userPins, userPinKey(input.CompanyID, input.PinID))
	return nil
}

func (r *MemoryRepo) ReorderUserPins(input UserPinReorderInput) error {
	input, ok := normalizeUserPinReorderInput(input)
	if !ok {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, pinID := range input.PinIDs {
		item, ok := r.userPins[userPinKey(input.CompanyID, pinID)]
		if !ok || item.UserID != input.UserID {
			return ErrNotFound
		}
	}
	for index, pinID := range input.PinIDs {
		item := r.userPins[userPinKey(input.CompanyID, pinID)]
		item.Position = (index + 1) * userPinPositionStep
		r.userPins[userPinKey(input.CompanyID, pinID)] = item
	}
	return nil
}

func (r *MemoryRepo) nextUserPinPositionLocked(companyID, userID string) int {
	position := 0
	for _, item := range r.userPins {
		if item.CompanyID == companyID && item.UserID == userID && item.Position > position {
			position = item.Position
		}
	}
	return position + userPinPositionStep
}
