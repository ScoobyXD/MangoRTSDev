package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func companyExplorerParentID(folder domain.CompanyExplorerFolder) string {
	if folder.ParentFolderID == nil {
		return ""
	}
	return *folder.ParentFolderID
}

func nextCompanyExplorerFolderPosition(folders map[string]domain.CompanyExplorerFolder, companyID, folderKind, parentFolderID string) int {
	next := 1000
	for _, folder := range folders {
		if folder.CompanyID != companyID || folder.FolderKind != folderKind || companyExplorerParentID(folder) != parentFolderID {
			continue
		}
		if folder.Position >= next {
			next = folder.Position + 1000
		}
	}
	return next
}

// Folder rows and item rows share one visible sibling list. New API-created
// rows append after both tables so the UI does not regroup folders after items.

func nextCompanyExplorerRowPosition(folders map[string]domain.CompanyExplorerFolder, items map[string]domain.CompanyExplorerFolderItem, companyID, folderKind, parentFolderID string) int {
	next := nextCompanyExplorerFolderPosition(folders, companyID, folderKind, parentFolderID)
	if parentFolderID == "" {
		return next
	}
	for _, item := range items {
		if item.CompanyID != companyID || item.FolderID != parentFolderID {
			continue
		}
		if item.Position >= next {
			next = item.Position + 1000
		}
	}
	return next
}

func nextCompanyExplorerFolderItemPosition(items map[string]domain.CompanyExplorerFolderItem, companyID, folderID string) int {
	next := 1000
	for _, item := range items {
		if item.CompanyID != companyID || item.FolderID != folderID {
			continue
		}
		if item.Position >= next {
			next = item.Position + 1000
		}
	}
	return next
}

func nextCompanyExplorerFolderChildPosition(folders map[string]domain.CompanyExplorerFolder, items map[string]domain.CompanyExplorerFolderItem, companyID, folderID, itemType string) int {
	next := nextCompanyExplorerFolderItemPosition(items, companyID, folderID)
	for _, folder := range folders {
		if folder.CompanyID != companyID || folder.FolderKind != itemType || companyExplorerParentID(folder) != folderID {
			continue
		}
		if folder.Position >= next {
			next = folder.Position + 1000
		}
	}
	return next
}

func (r *MemoryRepo) CreateCompanyExplorerFolder(companyID, parentFolderID, folderKind, name string) (domain.CompanyExplorerFolder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	var parent *string
	if parentFolderID != "" {
		parentFolder, ok := r.folders[key(companyID, parentFolderID)]
		if !ok || parentFolder.FolderKind != folderKind {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		parentValue := parentFolderID
		parent = &parentValue
	}

	now := time.Now().UTC()
	item := domain.CompanyExplorerFolder{
		CompanyID:        companyID,
		FolderID:         newUUIDv7String(),
		ParentFolderID:   parent,
		FolderKind:       folderKind,
		Name:             name,
		Position:         nextCompanyExplorerRowPosition(r.folders, r.folderItems, companyID, folderKind, parentFolderID),
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.folders[key(companyID, item.FolderID)] = item
	return item, nil
}

func (r *MemoryRepo) ListCompanyExplorerFolders(companyID, folderKind string) ([]domain.CompanyExplorerFolder, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.CompanyExplorerFolder, 0)
	for _, folder := range r.folders {
		if folder.CompanyID != companyID {
			continue
		}
		if folderKind != "" && folder.FolderKind != folderKind {
			continue
		}
		items = append(items, folder)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position == items[j].Position {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].Position < items[j].Position
	})
	return items, nil
}

func (r *MemoryRepo) MoveCompanyExplorerFolder(companyID, folderID string, parentFolderID *string, position int) (domain.CompanyExplorerFolder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.folders[key(companyID, folderID)]
	if !ok {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	parent := item.ParentFolderID
	targetParentID := companyExplorerParentID(item)
	parentChanged := false
	if parentFolderID != nil {
		targetParentID = strings.TrimSpace(*parentFolderID)
		if targetParentID == folderID {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		parentChanged = targetParentID != companyExplorerParentID(item)
		parent = nil
	}
	if parentFolderID != nil && targetParentID != "" {
		parentFolder, ok := r.folders[key(companyID, targetParentID)]
		if !ok || parentFolder.FolderKind != item.FolderKind {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		// A folder cannot be moved under one of its descendants; that would
		// create a cycle and make folder-scope queries loop forever.
		toCheck := map[string]bool{folderID: true}
		changed := true
		for changed {
			changed = false
			for _, folder := range r.folders {
				if folder.CompanyID != companyID || folder.ParentFolderID == nil {
					continue
				}
				if toCheck[*folder.ParentFolderID] && !toCheck[folder.FolderID] {
					toCheck[folder.FolderID] = true
					changed = true
				}
			}
		}
		if toCheck[targetParentID] {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		parentValue := targetParentID
		parent = &parentValue
	}
	if position <= 0 {
		if parentChanged {
			position = nextCompanyExplorerRowPosition(r.folders, r.folderItems, companyID, item.FolderKind, targetParentID)
		} else {
			position = item.Position
		}
	}

	item.ParentFolderID = parent
	item.Position = position
	item.UpdatedTimestamp = time.Now().UTC()
	r.folders[key(companyID, item.FolderID)] = item
	return item, nil
}

func (r *MemoryRepo) RenameCompanyExplorerFolder(companyID, folderID, name string) (domain.CompanyExplorerFolder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.folders[key(companyID, folderID)]
	if !ok {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	item.Name = name
	item.UpdatedTimestamp = time.Now().UTC()
	r.folders[key(companyID, item.FolderID)] = item
	return item, nil
}

func (r *MemoryRepo) DeleteCompanyExplorerFolder(companyID, folderID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.folders[key(companyID, folderID)]; !ok {
		return ErrNotFound
	}

	// Delete the selected folder and every descendant. This matches file-explorer
	// folder semantics while keeping item delete independent from node/gate delete.
	toDelete := map[string]bool{folderID: true}
	changed := true
	for changed {
		changed = false
		for _, folder := range r.folders {
			if folder.CompanyID != companyID || folder.ParentFolderID == nil {
				continue
			}
			if toDelete[*folder.ParentFolderID] && !toDelete[folder.FolderID] {
				toDelete[folder.FolderID] = true
				changed = true
			}
		}
	}

	for id := range toDelete {
		delete(r.folders, key(companyID, id))
	}
	for k, item := range r.folderItems {
		if item.CompanyID == companyID && toDelete[item.FolderID] {
			delete(r.folderItems, k)
		}
	}
	return nil
}

func (r *MemoryRepo) AssignCompanyExplorerFolderItem(companyID, folderID, itemType, itemID string, position int) (domain.CompanyExplorerFolderItem, []string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	folder, ok := r.folders[key(companyID, folderID)]
	if !ok || (folder.FolderKind != itemType && itemType != "kanban") {
		return domain.CompanyExplorerFolderItem{}, nil, ErrNotFound
	}
	if itemType == "node" {
		if _, ok := r.nodes[key(companyID, itemID)]; !ok {
			return domain.CompanyExplorerFolderItem{}, nil, ErrNotFound
		}
	} else if itemType == "logic_gate" {
		if _, ok := r.logicGates[key(companyID, itemID)]; !ok {
			return domain.CompanyExplorerFolderItem{}, nil, ErrNotFound
		}
	} else if itemType == "kanban" {
		if _, ok := r.kanbanBoards[boardKey(companyID, itemID)]; !ok {
			return domain.CompanyExplorerFolderItem{}, nil, ErrNotFound
		}
	} else {
		return domain.CompanyExplorerFolderItem{}, nil, ErrNotFound
	}

	now := time.Now().UTC()
	k := folderItemKey(companyID, itemType, itemID)
	created := now
	previousFolderID := ""
	if existing, ok := r.folderItems[k]; ok {
		created = existing.CreatedTimestamp
		previousFolderID = existing.FolderID
		if position <= 0 && existing.FolderID == folderID {
			position = existing.Position
		}
	}
	if position <= 0 {
		position = nextCompanyExplorerRowPosition(r.folders, r.folderItems, companyID, folder.FolderKind, folderID)
	}
	item := domain.CompanyExplorerFolderItem{
		CompanyID:        companyID,
		FolderID:         folderID,
		ItemType:         itemType,
		ItemID:           itemID,
		Position:         position,
		CreatedTimestamp: created,
		UpdatedTimestamp: now,
	}
	r.folderItems[k] = item

	deletedRelationshipIDs := make([]string, 0)
	if previousFolderID != folderID {
		// Moving an entity to another Explorer folder level gives it a new local
		// graph context. Existing edges are no longer valid in that context.
		if itemType == "node" {
			next := r.nodeRels[companyID][:0]
			for _, rel := range r.nodeRels[companyID] {
				if rel.NodeIDA == itemID || rel.NodeIDB == itemID {
					deletedRelationshipIDs = append(deletedRelationshipIDs, rel.NodeRelationshipID)
					continue
				}
				next = append(next, rel)
			}
			r.nodeRels[companyID] = next
		} else if itemType == "logic_gate" {
			next := r.logicGateRels[companyID][:0]
			for _, rel := range r.logicGateRels[companyID] {
				if rel.LogicGateIDA == itemID || rel.LogicGateIDB == itemID {
					deletedRelationshipIDs = append(deletedRelationshipIDs, rel.LogicGateRelationshipID)
					continue
				}
				next = append(next, rel)
			}
			r.logicGateRels[companyID] = next
		}
	}
	return item, deletedRelationshipIDs, nil
}

func (r *MemoryRepo) ListCompanyExplorerFolderItems(companyID, folderID, itemType string) ([]domain.CompanyExplorerFolderItem, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.CompanyExplorerFolderItem, 0)
	for _, item := range r.folderItems {
		if item.CompanyID != companyID {
			continue
		}
		if folderID != "" && item.FolderID != folderID {
			continue
		}
		if itemType != "" && item.ItemType != itemType {
			continue
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position == items[j].Position {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].Position < items[j].Position
	})
	return items, nil
}

func (r *MemoryRepo) RemoveCompanyExplorerFolderItem(companyID, itemType, itemID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	k := folderItemKey(companyID, itemType, itemID)
	if _, ok := r.folderItems[k]; !ok {
		return ErrNotFound
	}
	delete(r.folderItems, k)
	return nil
}
