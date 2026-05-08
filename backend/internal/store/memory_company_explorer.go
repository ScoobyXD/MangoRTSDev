package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const companyExplorerDefaultFolderSeedKey = "logic_gates_v1"
const companyExplorerSystemFolderSeedKey = "system_folders_v1"
const CompanyExplorerSystemKanbanBoardsKey = "kanban_boards"
const CompanyExplorerSystemActiveNodesKey = "active_nodes"
const CompanyExplorerSystemHistoryKey = "history"

var companyExplorerDefaultLogicGateChildFolderNames = []string{
	"Product",
	"Design",
	"Production",
	"Supply Chain",
	"QA",
}

var companyExplorerSystemFolderSeeds = []struct {
	Key      string
	Name     string
	Position int
}{
	{Key: CompanyExplorerSystemKanbanBoardsKey, Name: "Kanban Boards", Position: 100},
	{Key: CompanyExplorerSystemActiveNodesKey, Name: "Active Nodes", Position: 200},
	{Key: CompanyExplorerSystemHistoryKey, Name: "History", Position: 300},
}

func companyExplorerParentID(folder domain.CompanyExplorerFolder) string {
	if folder.ParentFolderID == nil {
		return ""
	}
	return *folder.ParentFolderID
}

func (r *MemoryRepo) ensureCompanyExplorerDefaultFoldersLocked(companyID string) {
	systemSeedKey := companyID + ":" + companyExplorerSystemFolderSeedKey
	if !r.defaultFolderSeed[systemSeedKey] {
		now := time.Now().UTC()
		for _, seed := range companyExplorerSystemFolderSeeds {
			systemKey := seed.Key
			exists := false
			for _, folder := range r.folders {
				if folder.CompanyID == companyID && folder.SystemKey != nil && *folder.SystemKey == systemKey {
					exists = true
					break
				}
			}
			if exists {
				continue
			}
			folderID := newUUIDv7String()
			r.folders[key(companyID, folderID)] = domain.CompanyExplorerFolder{
				CompanyID:        companyID,
				FolderID:         folderID,
				FolderKind:       "node",
				SystemKey:        &systemKey,
				Name:             seed.Name,
				Position:         seed.Position,
				CreatedTimestamp: now,
				UpdatedTimestamp: now,
			}
		}
		r.defaultFolderSeed[systemSeedKey] = true
	}

	seedKey := companyID + ":" + companyExplorerDefaultFolderSeedKey
	if r.defaultFolderSeed[seedKey] {
		return
	}
	now := time.Now().UTC()
	rootPosition := nextCompanyExplorerRowPosition(r.folders, r.folderItems, companyID, "logic_gate", "")
	root := domain.CompanyExplorerFolder{
		CompanyID:        companyID,
		FolderID:         newUUIDv7String(),
		FolderKind:       "logic_gate",
		Name:             "Logic Gates",
		Position:         rootPosition,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.folders[key(companyID, root.FolderID)] = root
	for index, name := range companyExplorerDefaultLogicGateChildFolderNames {
		parentID := root.FolderID
		child := domain.CompanyExplorerFolder{
			CompanyID:        companyID,
			FolderID:         newUUIDv7String(),
			ParentFolderID:   &parentID,
			FolderKind:       "logic_gate",
			Name:             name,
			Position:         (index + 1) * 1000,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
		r.folders[key(companyID, child.FolderID)] = child
	}
	r.defaultFolderSeed[seedKey] = true
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
	r.mu.Lock()
	defer r.mu.Unlock()

	r.ensureCompanyExplorerDefaultFoldersLocked(companyID)

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
			if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
				return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
			}
			return items[i].FolderID < items[j].FolderID
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
	if item.SystemKey != nil {
		return domain.CompanyExplorerFolder{}, ErrInvalid
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
	for _, folder := range r.folders {
		if folder.CompanyID == companyID && toDelete[folder.FolderID] && folder.SystemKey != nil {
			return ErrInvalid
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

	return r.assignCompanyExplorerFolderItemLocked(companyID, folderID, itemType, itemID, position)
}

func (r *MemoryRepo) AssignCompanyExplorerFolderItems(companyID string, assignments []CompanyExplorerFolderItemAssignmentInput) ([]domain.CompanyExplorerFolderItem, []CompanyExplorerRelationshipDeleteResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if len(assignments) == 0 || len(assignments) > CompanyExplorerFolderItemBatchMaxItems {
		return nil, nil, ErrInvalid
	}
	for _, assignment := range assignments {
		if err := r.validateCompanyExplorerFolderItemAssignmentLocked(companyID, assignment.FolderID, assignment.ItemType, assignment.ItemID); err != nil {
			return nil, nil, err
		}
	}

	items := make([]domain.CompanyExplorerFolderItem, 0, len(assignments))
	deleted := make([]CompanyExplorerRelationshipDeleteResult, 0)
	for _, assignment := range assignments {
		item, deletedRelationshipIDs, err := r.assignCompanyExplorerFolderItemLocked(companyID, assignment.FolderID, assignment.ItemType, assignment.ItemID, assignment.Position)
		if err != nil {
			return nil, nil, err
		}
		items = append(items, item)
		if len(deletedRelationshipIDs) > 0 {
			deleted = append(deleted, CompanyExplorerRelationshipDeleteResult{
				ItemType:        assignment.ItemType,
				ItemID:          assignment.ItemID,
				RelationshipIDs: deletedRelationshipIDs,
			})
		}
	}
	return items, deleted, nil
}

func (r *MemoryRepo) validateCompanyExplorerFolderItemAssignmentLocked(companyID, folderID, itemType, itemID string) error {
	if _, ok := r.folders[key(companyID, folderID)]; !ok {
		return ErrNotFound
	}
	if itemType == "node" {
		if _, ok := r.nodes[key(companyID, itemID)]; !ok {
			return ErrNotFound
		}
	} else if itemType == "logic_gate" {
		if _, ok := r.logicGates[key(companyID, itemID)]; !ok {
			return ErrNotFound
		}
	} else if itemType == "kanban" {
		if _, ok := r.kanbanBoards[boardKey(companyID, itemID)]; !ok {
			return ErrNotFound
		}
	} else {
		return ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) assignCompanyExplorerFolderItemLocked(companyID, folderID, itemType, itemID string, position int) (domain.CompanyExplorerFolderItem, []string, error) {
	if err := r.validateCompanyExplorerFolderItemAssignmentLocked(companyID, folderID, itemType, itemID); err != nil {
		return domain.CompanyExplorerFolderItem{}, nil, err
	}
	folder := r.folders[key(companyID, folderID)]

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
			if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
				return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
			}
			if items[i].ItemType == items[j].ItemType {
				return items[i].ItemID < items[j].ItemID
			}
			return items[i].ItemType < items[j].ItemType
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
