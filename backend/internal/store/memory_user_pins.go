package store

import (
	"miraeopus/backend/internal/domain"
	"time"
)

func (r *MemoryRepo) ListUserPinTree(input UserPinListInput) (domain.UserPinTree, error) {
	input, ok := normalizeUserPinListInput(input)
	if !ok {
		return domain.UserPinTree{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.memberships[membershipKey(input.CompanyID, input.UserID)]; !ok {
		return domain.UserPinTree{}, ErrInvalid
	}
	return r.listUserPinTreeLocked(input.CompanyID, input.UserID), nil
}

func (r *MemoryRepo) listUserPinTreeLocked(companyID, userID string) domain.UserPinTree {
	tree := domain.UserPinTree{
		PinFolders: make([]domain.UserPinFolder, 0),
		UserPins:   make([]domain.UserPin, 0),
	}
	for _, folder := range r.userPinFolders {
		if folder.CompanyID == companyID && folder.UserID == userID {
			tree.PinFolders = append(tree.PinFolders, folder)
		}
	}
	for _, pin := range r.userPins {
		if pin.CompanyID == companyID && pin.UserID == userID {
			tree.UserPins = append(tree.UserPins, pin)
		}
	}
	sortUserPinFolders(tree.PinFolders)
	sortUserPins(tree.UserPins)
	return tree
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
	if input.ParentFolderSet && !r.userPinFolderOwnedLocked(input.CompanyID, input.UserID, input.ParentFolderID) {
		return domain.UserPin{}, ErrNotFound
	}
	for pinKey, item := range r.userPins {
		if item.CompanyID != input.CompanyID || item.UserID != input.UserID || item.ResourceType != input.ResourceType || item.ResourceID != input.ResourceID {
			continue
		}
		item.Name = input.Name
		if input.ParentFolderSet {
			currentParent := userPinParentID(item.ParentFolderID)
			item.ParentFolderID = userPinParentPointer(input.ParentFolderID)
			if input.Position > 0 {
				item.Position = input.Position
			} else if currentParent != input.ParentFolderID {
				item.Position = r.nextUserPinTreePositionLocked(input.CompanyID, input.UserID, input.ParentFolderID)
			}
		}
		r.userPins[pinKey] = item
		return item, nil
	}
	position := input.Position
	if position <= 0 {
		position = r.nextUserPinTreePositionLocked(input.CompanyID, input.UserID, input.ParentFolderID)
	}
	item := domain.UserPin{
		CompanyID:        input.CompanyID,
		PinID:            input.PinID,
		UserID:           input.UserID,
		ParentFolderID:   userPinParentPointer(input.ParentFolderID),
		ResourceType:     input.ResourceType,
		ResourceID:       input.ResourceID,
		Name:             input.Name,
		Position:         position,
		CreatedTimestamp: time.Now().UTC(),
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

func (r *MemoryRepo) CreateUserPinFolder(input UserPinFolderCreateInput) (domain.UserPinFolder, error) {
	input, ok := normalizeUserPinFolderCreateInput(input)
	if !ok {
		return domain.UserPinFolder{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.memberships[membershipKey(input.CompanyID, input.UserID)]; !ok {
		return domain.UserPinFolder{}, ErrInvalid
	}
	if !r.userPinFolderOwnedLocked(input.CompanyID, input.UserID, input.ParentFolderID) {
		return domain.UserPinFolder{}, ErrNotFound
	}
	if _, exists := r.userPinFolders[userPinFolderKey(input.CompanyID, input.FolderID)]; exists {
		return domain.UserPinFolder{}, ErrAlreadyExists
	}
	position := input.Position
	if position <= 0 {
		position = r.nextUserPinTreePositionLocked(input.CompanyID, input.UserID, input.ParentFolderID)
	}
	now := time.Now().UTC()
	folder := domain.UserPinFolder{
		CompanyID:        input.CompanyID,
		FolderID:         input.FolderID,
		UserID:           input.UserID,
		ParentFolderID:   userPinParentPointer(input.ParentFolderID),
		Name:             input.Name,
		Position:         position,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.userPinFolders[userPinFolderKey(input.CompanyID, input.FolderID)] = folder
	return folder, nil
}

func (r *MemoryRepo) RenameUserPinFolder(input UserPinFolderRenameInput) (domain.UserPinFolder, error) {
	input, ok := normalizeUserPinFolderRenameInput(input)
	if !ok {
		return domain.UserPinFolder{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := userPinFolderKey(input.CompanyID, input.FolderID)
	folder, ok := r.userPinFolders[key]
	if !ok || folder.UserID != input.UserID {
		return domain.UserPinFolder{}, ErrNotFound
	}
	folder.Name = input.Name
	folder.UpdatedTimestamp = time.Now().UTC()
	r.userPinFolders[key] = folder
	return folder, nil
}

func (r *MemoryRepo) DeleteUserPinFolder(input UserPinFolderDeleteInput) error {
	input, ok := normalizeUserPinFolderDeleteInput(input)
	if !ok {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	root, ok := r.userPinFolders[userPinFolderKey(input.CompanyID, input.FolderID)]
	if !ok || root.UserID != input.UserID {
		return ErrNotFound
	}
	deleted := map[string]bool{input.FolderID: true}
	for changed := true; changed; {
		changed = false
		for _, folder := range r.userPinFolders {
			if folder.CompanyID != input.CompanyID || folder.UserID != input.UserID || deleted[folder.FolderID] {
				continue
			}
			if deleted[userPinParentID(folder.ParentFolderID)] {
				deleted[folder.FolderID] = true
				changed = true
			}
		}
	}
	for key, pin := range r.userPins {
		if pin.CompanyID == input.CompanyID && pin.UserID == input.UserID && deleted[userPinParentID(pin.ParentFolderID)] {
			delete(r.userPins, key)
		}
	}
	for key, folder := range r.userPinFolders {
		if folder.CompanyID == input.CompanyID && folder.UserID == input.UserID && deleted[folder.FolderID] {
			delete(r.userPinFolders, key)
		}
	}
	return nil
}

func (r *MemoryRepo) ApplyUserPinLayout(input UserPinLayoutInput) error {
	input, ok := normalizeUserPinLayoutInput(input)
	if !ok {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.memberships[membershipKey(input.CompanyID, input.UserID)]; !ok {
		return ErrInvalid
	}
	parents := map[string]string{}
	for _, folder := range r.userPinFolders {
		if folder.CompanyID == input.CompanyID && folder.UserID == input.UserID {
			parents[folder.FolderID] = userPinParentID(folder.ParentFolderID)
		}
	}
	for _, entry := range input.Entries {
		if entry.ParentFolderID != "" {
			if _, exists := parents[entry.ParentFolderID]; !exists {
				return ErrNotFound
			}
		}
		switch entry.EntryType {
		case UserPinLayoutEntryFolder:
			if _, exists := parents[entry.EntryID]; !exists {
				return ErrNotFound
			}
			parents[entry.EntryID] = entry.ParentFolderID
		case UserPinLayoutEntryPin:
			pin, exists := r.userPins[userPinKey(input.CompanyID, entry.EntryID)]
			if !exists || pin.UserID != input.UserID {
				return ErrNotFound
			}
		default:
			return ErrInvalid
		}
	}
	if userPinFolderParentsHaveCycle(parents) {
		return ErrInvalid
	}
	now := time.Now().UTC()
	for _, entry := range input.Entries {
		if entry.EntryType == UserPinLayoutEntryFolder {
			key := userPinFolderKey(input.CompanyID, entry.EntryID)
			folder := r.userPinFolders[key]
			folder.ParentFolderID = userPinParentPointer(entry.ParentFolderID)
			folder.Position = entry.Position
			folder.UpdatedTimestamp = now
			r.userPinFolders[key] = folder
			continue
		}
		key := userPinKey(input.CompanyID, entry.EntryID)
		pin := r.userPins[key]
		pin.ParentFolderID = userPinParentPointer(entry.ParentFolderID)
		pin.Position = entry.Position
		r.userPins[key] = pin
	}
	return nil
}

func (r *MemoryRepo) GroupUserPins(input UserPinGroupInput) (UserPinGroupResult, error) {
	input, ok := normalizeUserPinGroupInput(input)
	if !ok {
		return UserPinGroupResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.memberships[membershipKey(input.CompanyID, input.UserID)]; !ok {
		return UserPinGroupResult{}, ErrInvalid
	}
	targetKey := userPinKey(input.CompanyID, input.TargetPinID)
	draggedKey := userPinKey(input.CompanyID, input.DraggedPinID)
	target, targetOK := r.userPins[targetKey]
	dragged, draggedOK := r.userPins[draggedKey]
	if !targetOK || !draggedOK || target.UserID != input.UserID || dragged.UserID != input.UserID {
		return UserPinGroupResult{}, ErrNotFound
	}
	if _, exists := r.userPinFolders[userPinFolderKey(input.CompanyID, input.FolderID)]; exists {
		return UserPinGroupResult{}, ErrAlreadyExists
	}
	now := time.Now().UTC()
	folder := domain.UserPinFolder{
		CompanyID:        input.CompanyID,
		FolderID:         input.FolderID,
		UserID:           input.UserID,
		ParentFolderID:   userPinParentPointer(userPinParentID(target.ParentFolderID)),
		Name:             input.Name,
		Position:         target.Position,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.userPinFolders[userPinFolderKey(input.CompanyID, input.FolderID)] = folder
	target.ParentFolderID = userPinParentPointer(input.FolderID)
	target.Position = userPinPositionStep
	dragged.ParentFolderID = userPinParentPointer(input.FolderID)
	dragged.Position = 2 * userPinPositionStep
	r.userPins[targetKey] = target
	r.userPins[draggedKey] = dragged
	return UserPinGroupResult{Folder: folder, Tree: r.listUserPinTreeLocked(input.CompanyID, input.UserID)}, nil
}

func (r *MemoryRepo) userPinFolderOwnedLocked(companyID, userID, folderID string) bool {
	if folderID == "" {
		return true
	}
	folder, ok := r.userPinFolders[userPinFolderKey(companyID, folderID)]
	return ok && folder.UserID == userID
}

func (r *MemoryRepo) nextUserPinTreePositionLocked(companyID, userID, parentFolderID string) int {
	position := 0
	for _, folder := range r.userPinFolders {
		if folder.CompanyID == companyID && folder.UserID == userID && userPinParentID(folder.ParentFolderID) == parentFolderID && folder.Position > position {
			position = folder.Position
		}
	}
	for _, pin := range r.userPins {
		if pin.CompanyID == companyID && pin.UserID == userID && userPinParentID(pin.ParentFolderID) == parentFolderID && pin.Position > position {
			position = pin.Position
		}
	}
	return position + userPinPositionStep
}
