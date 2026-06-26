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
		if folder.CompanyID != companyID || companyExplorerParentID(folder) != parentFolderID {
			continue
		}
		if parentFolderID == "" && folder.FolderKind != folderKind {
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
		if folder.CompanyID != companyID || companyExplorerParentID(folder) != folderID {
			continue
		}
		if folder.Position >= next {
			next = folder.Position + 1000
		}
	}
	return next
}

func (r *MemoryRepo) CreateCompanyExplorerFolder(companyID, parentFolderID, folderKind, name string) (domain.CompanyExplorerFolder, error) {
	if strings.TrimSpace(folderKind) == "communications" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	var parent *string
	scopeType := CompanyExplorerFolderScopeCompany
	var scopeID *string
	if parentFolderID != "" {
		parentFolder, ok := r.folders[key(companyID, parentFolderID)]
		if !ok {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		parentValue := parentFolderID
		parent = &parentValue
		scopeType = companyExplorerFolderScopeType(parentFolder)
		scopeID = companyExplorerFolderScopeID(parentFolder)
	}

	now := time.Now().UTC()
	item := domain.CompanyExplorerFolder{
		CompanyID:        companyID,
		FolderID:         newUUIDv7String(),
		ParentFolderID:   parent,
		FolderKind:       folderKind,
		Name:             name,
		DefaultAccess:    ResourceDefaultAccessEdit,
		ScopeType:        scopeType,
		ScopeID:          scopeID,
		Position:         nextCompanyExplorerRowPosition(r.folders, r.folderItems, companyID, folderKind, parentFolderID),
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.folders[key(companyID, item.FolderID)] = item
	return item, nil
}

func (r *MemoryRepo) SetCompanyExplorerFolderScope(companyID, folderID, scopeType, scopeID string) (domain.CompanyExplorerFolder, error) {
	normalizedScopeType, normalizedScopeID, err := normalizeCompanyExplorerFolderScope(scopeType, scopeID)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.folders[key(companyID, folderID)]
	if !ok {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	item.ScopeType = normalizedScopeType
	item.ScopeID = normalizedScopeID
	item.UpdatedTimestamp = time.Now().UTC()
	r.folders[key(companyID, item.FolderID)] = item
	return r.withSharedInboxGVICLocked(item), nil
}

func (r *MemoryRepo) ListCompanyExplorerFolders(companyID, folderKind string) ([]domain.CompanyExplorerFolder, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.CompanyExplorerFolder, 0)
	for _, folder := range r.folders {
		if folder.CompanyID != companyID {
			continue
		}
		if folder.FolderKind == "communications" {
			continue
		}
		if folderKind != "" && folder.FolderKind != folderKind {
			continue
		}
		if folder.SystemKey != nil && *folder.SystemKey == "kanban_boards" {
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

func (r *MemoryRepo) GetCompanyExplorerFolder(companyID, folderID string) (domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" || folderID == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	item, ok := r.folders[key(companyID, folderID)]
	if !ok || item.FolderKind == "communications" {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	return item, nil
}

func (r *MemoryRepo) ListVisibleCompanyExplorerFolders(companyID, folderKind, userID string) ([]domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	folderKind = strings.TrimSpace(folderKind)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	visibleFolderIDs := r.visibleCompanyExplorerFolderIDsLocked(companyID, folderKind, userID)
	items := make([]domain.CompanyExplorerFolder, 0)
	for _, folder := range r.folders {
		if !visibleFolderIDs[folder.FolderID] {
			continue
		}
		item := folder
		accessLevel := r.effectiveAccessLevelLocked(companyID, userID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionView)
		if accessLevel == "" {
			continue
		}
		item.EffectiveAccess = accessLevel
		items = append(items, item)
	}
	sortCompanyExplorerFolders(items)
	return items, nil
}

func (r *MemoryRepo) visibleCompanyExplorerFolderIDsLocked(companyID, folderKind, userID string) map[string]bool {
	ids := map[string]bool{}
	changed := true
	for changed {
		changed = false
		for _, folder := range r.folders {
			if folder.CompanyID != companyID {
				continue
			}
			if folderKind != "" && folder.FolderKind != folderKind {
				continue
			}
			if folder.FolderKind == "communications" {
				continue
			}
			if folder.SystemKey != nil && *folder.SystemKey == "kanban_boards" {
				continue
			}
			if ids[folder.FolderID] {
				continue
			}
			parentID := companyExplorerParentID(folder)
			if parentID != "" && !ids[parentID] {
				continue
			}
			if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionView) {
				continue
			}
			ids[folder.FolderID] = true
			changed = true
		}
	}
	return ids
}

func sortCompanyExplorerFolders(items []domain.CompanyExplorerFolder) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position == items[j].Position {
			if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
				return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
			}
			return items[i].FolderID < items[j].FolderID
		}
		return items[i].Position < items[j].Position
	})
}

func (r *MemoryRepo) effectiveAccessLevelLocked(companyID, userID, resourceType, resourceID, accessLevel string) string {
	if r.userHasRoleAdminAccessLocked(companyID, userID) {
		return EntityPermissionAdmin
	}
	if r.userHasResourcePermissionLocked(companyID, userID, resourceType, resourceID, EntityPermissionEdit) {
		return EntityPermissionEdit
	}
	if r.userHasResourcePermissionLocked(companyID, userID, resourceType, resourceID, accessLevel) {
		return EntityPermissionView
	}
	return ""
}

func companyExplorerFolderSubtreeIDsLocked(folders map[string]domain.CompanyExplorerFolder, companyID, folderID, folderKind string) map[string]bool {
	ids := map[string]bool{}
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return ids
	}
	for _, folder := range folders {
		if folder.CompanyID != companyID || folder.FolderID != folderID {
			continue
		}
		if folderKind != "" && folder.FolderKind != folderKind {
			return ids
		}
		ids[folder.FolderID] = true
		break
	}
	changed := true
	for changed {
		changed = false
		for _, folder := range folders {
			if folder.CompanyID != companyID || folder.ParentFolderID == nil {
				continue
			}
			if folderKind != "" && folder.FolderKind != folderKind {
				continue
			}
			if ids[*folder.ParentFolderID] && !ids[folder.FolderID] {
				ids[folder.FolderID] = true
				changed = true
			}
		}
	}
	return ids
}

func (r *MemoryRepo) visibleCompanyExplorerFolderSubtreeIDsLocked(companyID, folderID, folderKind, userID string) map[string]bool {
	ids := map[string]bool{}
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return ids
	}
	for _, folder := range r.folders {
		if folder.CompanyID != companyID || folder.FolderID != folderID {
			continue
		}
		if folderKind != "" && folder.FolderKind != folderKind {
			return ids
		}
		if folder.FolderKind == "communications" || !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionView) {
			return ids
		}
		ids[folder.FolderID] = true
		break
	}
	changed := true
	for changed {
		changed = false
		for _, folder := range r.folders {
			if folder.CompanyID != companyID || folder.ParentFolderID == nil {
				continue
			}
			if folderKind != "" && folder.FolderKind != folderKind {
				continue
			}
			if folder.FolderKind == "communications" {
				continue
			}
			if !ids[*folder.ParentFolderID] || ids[folder.FolderID] {
				continue
			}
			if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionView) {
				continue
			}
			ids[folder.FolderID] = true
			changed = true
		}
	}
	return ids
}

func (r *MemoryRepo) ListCompanyExplorerFolderSubtree(companyID, folderID, folderKind string) ([]domain.CompanyExplorerFolder, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListCompanyExplorerFolders(companyID, folderKind)
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, folderID, strings.TrimSpace(folderKind))
	items := make([]domain.CompanyExplorerFolder, 0, len(ids))
	for _, folder := range r.folders {
		if !ids[folder.FolderID] {
			continue
		}
		if folder.FolderKind == "communications" {
			continue
		}
		if folder.SystemKey != nil && *folder.SystemKey == "kanban_boards" {
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

func (r *MemoryRepo) ListVisibleCompanyExplorerFolderSubtree(companyID, folderID, folderKind, userID string) ([]domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	folderKind = strings.TrimSpace(folderKind)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return r.ListVisibleCompanyExplorerFolders(companyID, folderKind, userID)
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	ids := r.visibleCompanyExplorerFolderSubtreeIDsLocked(companyID, folderID, folderKind, userID)
	items := make([]domain.CompanyExplorerFolder, 0, len(ids))
	for _, folder := range r.folders {
		if !ids[folder.FolderID] {
			continue
		}
		if folder.FolderKind == "communications" {
			continue
		}
		if folder.SystemKey != nil && *folder.SystemKey == "kanban_boards" {
			continue
		}
		item := folder
		accessLevel := r.effectiveAccessLevelLocked(companyID, userID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionView)
		if accessLevel == "" {
			continue
		}
		item.EffectiveAccess = accessLevel
		items = append(items, item)
	}
	sortCompanyExplorerFolders(items)
	return items, nil
}
func (r *MemoryRepo) MoveCompanyExplorerFolder(companyID, folderID string, parentFolderID *string, position int) (domain.CompanyExplorerFolder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.folders[key(companyID, folderID)]
	if !ok || item.FolderKind == "communications" {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if err := protectCompanyExplorerDefaultFolderMutation(companyID, folderID); err != nil {
		return domain.CompanyExplorerFolder{}, err
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
		if !ok || parentFolder.FolderKind == "communications" {
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
		item.ScopeType = companyExplorerFolderScopeType(parentFolder)
		item.ScopeID = companyExplorerFolderScopeID(parentFolder)
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
	if !ok || item.FolderKind == "communications" {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if err := protectCompanyExplorerDefaultFolderMutation(companyID, folderID); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	if item.SystemKey != nil {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	item.Name = name
	item.UpdatedTimestamp = time.Now().UTC()
	r.folders[key(companyID, item.FolderID)] = item
	return item, nil
}

func (r *MemoryRepo) companyHasConnectedEmailAccountLocked(companyID, accountEmail string) bool {
	for _, connection := range r.companyEmailConnections {
		if connection.CompanyID == companyID && connection.Status == "connected" && normalizeEmail(connection.AccountEmail) == accountEmail {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) connectedCompanyEmailConnectionForAccountLocked(companyID, accountEmail string) (domain.CompanyEmailConnection, bool) {
	for _, connection := range r.companyEmailConnections {
		if connection.CompanyID == companyID && connection.Status == "connected" && normalizeEmail(connection.AccountEmail) == accountEmail {
			return connection, true
		}
	}
	return domain.CompanyEmailConnection{}, false
}

func (r *MemoryRepo) SetCommunicationsSharedInboxAccountEmail(companyID, folderID, accountEmail string) (domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	accountEmail = normalizeEmail(accountEmail)
	if companyID == "" || folderID == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.folders[key(companyID, folderID)]
	if !ok {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if item.FolderKind != "communications" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	item = normalizeMemorySharedInboxFolder(item)
	if accountEmail == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	if item.EntryType != CommunicationsSharedInboxEntryTypeSharedInbox {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	connection, ok := r.connectedCompanyEmailConnectionForAccountLocked(companyID, accountEmail)
	if !ok {
		return domain.CompanyExplorerFolder{}, ErrEmailAccountUnavailable
	}
	item.AccountEmail = &accountEmail
	item.CompanyEmailConnectionID = connection.CompanyEmailConnectionID
	item.SharedInboxID = item.FolderID
	item.UpdatedTimestamp = time.Now().UTC()
	r.folders[key(companyID, item.FolderID)] = item
	return r.withSharedInboxGVICLocked(item), nil
}

func (r *MemoryRepo) DeleteCompanyExplorerFolder(companyID, folderID string) error {
	_, err := r.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: "folder", ID: folderID}})
	return err
}

func (r *MemoryRepo) DeleteCompanyExplorerTargets(companyID string, targets []CompanyExplorerDeleteTargetInput) (CompanyExplorerDeleteResult, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" || len(targets) == 0 {
		return CompanyExplorerDeleteResult{}, ErrInvalid
	}
	targets = normalizeCompanyExplorerDeleteTargets(targets)
	if len(targets) == 0 {
		return CompanyExplorerDeleteResult{}, ErrInvalid
	}
	for _, target := range targets {
		if !validCompanyExplorerDeleteKind(target.Kind) {
			return CompanyExplorerDeleteResult{}, ErrInvalid
		}
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	recycleSnapshot := r.snapshotRecycleStateLocked()

	folderIDs := map[string]bool{}
	folderKinds := map[string]string{}
	nodeIDs := map[string]bool{}
	logicGateIDs := map[string]bool{}
	projectIDs := map[string]bool{}
	kanbanBoardIDs := map[string]bool{}

	for _, target := range targets {
		switch target.Kind {
		case "folder":
			folder, ok := r.folders[key(companyID, target.ID)]
			if !ok {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			if folder.FolderKind == "communications" {
				return CompanyExplorerDeleteResult{}, ErrInvalid
			}
			toDelete := map[string]bool{target.ID: true}
			changed := true
			for changed {
				changed = false
				for _, child := range r.folders {
					if child.CompanyID != companyID || child.ParentFolderID == nil {
						continue
					}
					if toDelete[*child.ParentFolderID] && !toDelete[child.FolderID] {
						toDelete[child.FolderID] = true
						changed = true
					}
				}
			}
			folderKinds[target.ID] = folder.FolderKind
			for id := range toDelete {
				if err := protectCompanyExplorerDefaultFolderMutation(companyID, id); err != nil {
					return CompanyExplorerDeleteResult{}, err
				}
				item := r.folders[key(companyID, id)]
				if item.SystemKey != nil {
					return CompanyExplorerDeleteResult{}, ErrInvalid
				}
				if item.FolderKind == "communications" {
					return CompanyExplorerDeleteResult{}, ErrInvalid
				}
				folderIDs[id] = true
				folderKinds[id] = item.FolderKind
			}
		case "node":
			if _, ok := r.nodes[key(companyID, target.ID)]; !ok {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			nodeIDs[target.ID] = true
		case "logic_gate":
			if _, ok := r.logicGates[key(companyID, target.ID)]; !ok {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			logicGateIDs[target.ID] = true
		case "project":
			if _, ok := r.projects[key(companyID, target.ID)]; !ok {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			projectIDs[target.ID] = true
		case "kanban":
			if _, ok := r.kanbanBoards[boardKey(companyID, target.ID)]; !ok {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			kanbanBoardIDs[target.ID] = true
		}
	}

	for _, item := range r.folderItems {
		if item.CompanyID != companyID || !folderIDs[item.FolderID] {
			continue
		}
		switch item.ItemType {
		case "node":
			if _, ok := r.nodes[key(companyID, item.ItemID)]; ok {
				nodeIDs[item.ItemID] = true
			}
		case "logic_gate":
			if _, ok := r.logicGates[key(companyID, item.ItemID)]; ok {
				logicGateIDs[item.ItemID] = true
			}
		case "project":
			if _, ok := r.projects[key(companyID, item.ItemID)]; ok {
				projectIDs[item.ItemID] = true
			}
		}
	}
	r.expandCompanyExplorerDeleteScopeLocked(companyID, folderIDs, nodeIDs, logicGateIDs, projectIDs)

	for _, board := range r.kanbanBoards {
		if board.CompanyID != companyID || board.LogicGateID == nil || !logicGateIDs[*board.LogicGateID] {
			continue
		}
		kanbanBoardIDs[board.BoardID] = true
	}
	for logicGateID := range logicGateIDs {
		kanbanBoardIDs[LogicGateKanbanBoardID(logicGateID)] = true
	}
	for boardID := range kanbanBoardIDs {
		board, ok := r.kanbanBoards[boardKey(companyID, boardID)]
		if !ok {
			delete(kanbanBoardIDs, boardID)
			continue
		}
		if board.LogicGateID != nil && !logicGateIDs[*board.LogicGateID] {
			return CompanyExplorerDeleteResult{}, ErrInvalid
		}
	}

	result := CompanyExplorerDeleteResult{Targets: make([]CompanyExplorerDeletedTarget, 0)}
	seenDeleted := map[string]bool{}
	appendSorted := func(kind string, ids map[string]bool) {
		values := make([]string, 0, len(ids))
		for id := range ids {
			values = append(values, id)
		}
		sort.Strings(values)
		for _, id := range values {
			folderKind := ""
			if kind == "folder" {
				folderKind = folderKinds[id]
			}
			result.Targets = appendCompanyExplorerDeletedTarget(result.Targets, seenDeleted, kind, id, folderKind)
		}
	}
	appendSorted("folder", folderIDs)
	appendSorted("node", nodeIDs)
	appendSorted("logic_gate", logicGateIDs)
	appendSorted("project", projectIDs)
	appendSorted("kanban", kanbanBoardIDs)
	r.createRecycleBinItemsLocked(companyID, result.Targets, recycleSnapshot)

	for folderID := range folderIDs {
		if err := r.deleteEffectiveFactsForResourceLocked(companyID, EntityTypeCompanyExplorerFolder, folderID); err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
	}
	for logicGateID := range logicGateIDs {
		if err := r.deleteLogicGateLocked(companyID, logicGateID); err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
	}
	for boardID := range kanbanBoardIDs {
		if _, exists := r.kanbanBoards[boardKey(companyID, boardID)]; !exists {
			continue
		}
		if err := r.deleteKanbanBoardLocked(companyID, boardID); err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
	}
	for projectID := range projectIDs {
		if err := r.deleteProjectLocked(companyID, projectID); err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
	}
	for nodeID := range nodeIDs {
		if err := r.deleteNodeLocked(companyID, nodeID); err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
	}
	for logicGateID := range logicGateIDs {
		r.deleteCompanyExplorerV2NativeEntityProjectionLocked(companyID, CompanyExplorerV2EntityLogicGate, logicGateID)
	}
	for projectID := range projectIDs {
		r.deleteCompanyExplorerV2NativeEntityProjectionLocked(companyID, CompanyExplorerV2EntityProject, projectID)
	}
	for nodeID := range nodeIDs {
		r.deleteCompanyExplorerV2NativeEntityProjectionLocked(companyID, CompanyExplorerV2EntityNode, nodeID)
	}
	for folderID := range folderIDs {
		delete(r.folders, key(companyID, folderID))
		delete(r.sharedInboxGVIC, sharedInboxGVICKey(companyID, folderID))
	}
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID &&
			(permission.EntityType == EntityTypeSharedInboxFolder || permission.EntityType == EntityTypeSharedInbox || permission.EntityType == EntityTypeCompanyExplorerFolder) &&
			folderIDs[permission.EntityID] {
			delete(r.entityPermissions, permissionKey)
		}
	}
	for itemKey, item := range r.folderItems {
		if item.CompanyID == companyID && folderIDs[item.FolderID] {
			delete(r.folderItems, itemKey)
		}
	}
	for shareKey, share := range r.folderShares {
		if share.CompanyID == companyID && folderIDs[share.FolderID] {
			delete(r.folderShares, shareKey)
		}
	}
	return result, nil
}

func (r *MemoryRepo) expandCompanyExplorerDeleteScopeLocked(companyID string, folderIDs, nodeIDs, logicGateIDs, projectIDs map[string]bool) {
	changed := true
	for changed {
		changed = false
		for _, item := range r.folderItems {
			if item.CompanyID != companyID || !folderIDs[item.FolderID] {
				continue
			}
			switch item.ItemType {
			case "node":
				if !nodeIDs[item.ItemID] {
					nodeIDs[item.ItemID] = true
					changed = true
				}
			case "logic_gate":
				if !logicGateIDs[item.ItemID] {
					logicGateIDs[item.ItemID] = true
					changed = true
				}
			case "project":
				if !projectIDs[item.ItemID] {
					projectIDs[item.ItemID] = true
					changed = true
				}
			}
		}
		for _, relationship := range r.projectRelationships {
			if relationship.CompanyID != companyID || !projectIDs[relationship.ProjectID] {
				continue
			}
			switch relationship.ResourceType {
			case EntityTypeNode:
				if !nodeIDs[relationship.ResourceID] {
					nodeIDs[relationship.ResourceID] = true
					changed = true
				}
			case EntityTypeLogicGate:
				if !logicGateIDs[relationship.ResourceID] {
					logicGateIDs[relationship.ResourceID] = true
					changed = true
				}
			case EntityTypeProject:
				if !projectIDs[relationship.ResourceID] {
					projectIDs[relationship.ResourceID] = true
					changed = true
				}
			}
		}
		for _, assignment := range r.nodeLogicGateAssignments {
			if assignment.CompanyID != companyID || !logicGateIDs[assignment.LogicGateID] || nodeIDs[assignment.NodeID] {
				continue
			}
			nodeIDs[assignment.NodeID] = true
			changed = true
		}
	}
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
		return ErrInvalid
	} else if itemType == "logic_gate" {
		if _, ok := r.logicGates[key(companyID, itemID)]; !ok {
			return ErrNotFound
		}
	} else if itemType == EntityTypeProject {
		if _, ok := r.projects[key(companyID, itemID)]; !ok {
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
	if itemType == "kanban" {
		return items, nil
	}
	for _, item := range r.folderItems {
		if item.CompanyID != companyID {
			continue
		}
		if item.ItemType == "kanban" || item.ItemType == "node" {
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

func (r *MemoryRepo) ListVisibleCompanyExplorerFolderItems(companyID, folderID, itemType, userID string) ([]domain.CompanyExplorerFolderItem, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.CompanyExplorerFolderItem, 0)
	if itemType == "kanban" {
		return items, nil
	}
	for _, item := range r.folderItems {
		if item.CompanyID != companyID || item.ItemType == "kanban" || item.ItemType == "node" {
			continue
		}
		if folderID != "" && item.FolderID != folderID {
			continue
		}
		if itemType != "" && item.ItemType != itemType {
			continue
		}
		if !r.companyExplorerFolderItemVisibleLocked(companyID, userID, item) {
			continue
		}
		items = append(items, item)
	}
	sortCompanyExplorerFolderItems(items)
	return items, nil
}

func sortCompanyExplorerFolderItems(items []domain.CompanyExplorerFolderItem) {
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
}

func (r *MemoryRepo) companyExplorerFolderItemVisibleLocked(companyID, userID string, item domain.CompanyExplorerFolderItem) bool {
	folder, ok := r.folders[key(companyID, item.FolderID)]
	if !ok {
		return false
	}
	if folder.FolderKind == "communications" || !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionView) {
		return false
	}
	switch item.ItemType {
	case "node":
		return r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeNode, item.ItemID, EntityPermissionView)
	case "logic_gate":
		return r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, item.ItemID, EntityPermissionView)
	case EntityTypeProject:
		return r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeProject, item.ItemID, EntityPermissionView)
	default:
		return false
	}
}

func (r *MemoryRepo) ListCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, itemType string) ([]domain.CompanyExplorerFolderItem, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListCompanyExplorerFolderItems(companyID, "", itemType)
	}
	if itemType == "kanban" {
		return []domain.CompanyExplorerFolderItem{}, nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, folderID, "")
	items := make([]domain.CompanyExplorerFolderItem, 0)
	for _, item := range r.folderItems {
		if item.CompanyID != companyID || item.ItemType == "kanban" || item.ItemType == "node" || !ids[item.FolderID] {
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

func (r *MemoryRepo) ListVisibleCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, itemType, userID string) ([]domain.CompanyExplorerFolderItem, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return r.ListVisibleCompanyExplorerFolderItems(companyID, "", itemType, userID)
	}
	if itemType == "kanban" {
		return []domain.CompanyExplorerFolderItem{}, nil
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	ids := r.visibleCompanyExplorerFolderSubtreeIDsLocked(companyID, folderID, "", userID)
	items := make([]domain.CompanyExplorerFolderItem, 0)
	for _, item := range r.folderItems {
		if item.CompanyID != companyID || item.ItemType == "kanban" || item.ItemType == "node" || !ids[item.FolderID] {
			continue
		}
		if itemType != "" && item.ItemType != itemType {
			continue
		}
		if !r.companyExplorerFolderItemVisibleLocked(companyID, userID, item) {
			continue
		}
		items = append(items, item)
	}
	sortCompanyExplorerFolderItems(items)
	return items, nil
}

func companyExplorerNodeSummary(node domain.Node) domain.Node {
	return domain.Node{
		CompanyID:        node.CompanyID,
		NodeID:           node.NodeID,
		Title:            node.Title,
		Status:           node.Status,
		DueDate:          node.DueDate,
		Priority:         node.Priority,
		LogicGateIDs:     append([]string{}, node.LogicGateIDs...),
		CreatedTimestamp: node.CreatedTimestamp,
	}
}

func sortCompanyExplorerNodeSummaries(items []domain.Node) {
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
}

func (r *MemoryRepo) ListCompanyExplorerNodeSummaries(companyID string) ([]domain.Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.Node, 0)
	for _, node := range r.nodes {
		if node.CompanyID != companyID {
			continue
		}
		items = append(items, companyExplorerNodeSummary(r.withNodeReadModelLocked(node)))
	}
	sortCompanyExplorerNodeSummaries(items)
	return items, nil
}

func (r *MemoryRepo) ListVisibleCompanyExplorerNodeSummaries(companyID, userID string) ([]domain.Node, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.Node, 0)
	for _, node := range r.nodes {
		if node.CompanyID != companyID {
			continue
		}
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeNode, node.NodeID, EntityPermissionView) {
			continue
		}
		items = append(items, companyExplorerNodeSummary(r.withNodeReadModelLocked(node)))
	}
	sortCompanyExplorerNodeSummaries(items)
	return items, nil
}

func (r *MemoryRepo) ListCompanyExplorerNodeSummariesInFolderSubtree(companyID, folderID string) ([]domain.Node, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListCompanyExplorerNodeSummaries(companyID)
	}
	return []domain.Node{}, nil
}

func (r *MemoryRepo) ListVisibleCompanyExplorerNodeSummariesInFolderSubtree(companyID, folderID, userID string) ([]domain.Node, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return r.ListVisibleCompanyExplorerNodeSummaries(companyID, userID)
	}
	return []domain.Node{}, nil
}

func companyExplorerLogicGateSummary(gate domain.LogicGate) domain.LogicGate {
	return domain.LogicGate{
		CompanyID:        gate.CompanyID,
		LogicGateID:      gate.LogicGateID,
		Header:           gate.Header,
		GVICAssignments:  append([]domain.LogicGateGVICAssignment{}, gate.GVICAssignments...),
		CreatedTimestamp: gate.CreatedTimestamp,
	}
}

func sortCompanyExplorerLogicGateSummaries(items []domain.LogicGate) {
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
}

func (r *MemoryRepo) ListCompanyExplorerLogicGateSummaries(companyID string) ([]domain.LogicGate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.LogicGate, 0)
	for _, gate := range r.logicGates {
		if gate.CompanyID != companyID {
			continue
		}
		items = append(items, companyExplorerLogicGateSummary(r.withLogicGateGVICLocked(gate)))
	}
	sortCompanyExplorerLogicGateSummaries(items)
	return items, nil
}

func (r *MemoryRepo) ListVisibleCompanyExplorerLogicGateSummaries(companyID, userID string) ([]domain.LogicGate, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.LogicGate, 0)
	for _, gate := range r.logicGates {
		if gate.CompanyID != companyID {
			continue
		}
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionView) {
			continue
		}
		items = append(items, companyExplorerLogicGateSummary(r.withLogicGateGVICLocked(gate)))
	}
	sortCompanyExplorerLogicGateSummaries(items)
	return items, nil
}

func (r *MemoryRepo) ListCompanyExplorerLogicGateSummariesInFolderSubtree(companyID, folderID string) ([]domain.LogicGate, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListCompanyExplorerLogicGateSummaries(companyID)
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	folderIDs := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, folderID, "logic_gate")
	items := make([]domain.LogicGate, 0)
	seen := map[string]bool{}
	for _, folderItem := range r.folderItems {
		if folderItem.CompanyID != companyID || folderItem.ItemType != "logic_gate" || !folderIDs[folderItem.FolderID] || seen[folderItem.ItemID] {
			continue
		}
		gate, ok := r.logicGates[key(companyID, folderItem.ItemID)]
		if !ok {
			continue
		}
		seen[folderItem.ItemID] = true
		items = append(items, companyExplorerLogicGateSummary(r.withLogicGateGVICLocked(gate)))
	}
	sortCompanyExplorerLogicGateSummaries(items)
	return items, nil
}

func (r *MemoryRepo) ListVisibleCompanyExplorerLogicGateSummariesInFolderSubtree(companyID, folderID, userID string) ([]domain.LogicGate, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return r.ListVisibleCompanyExplorerLogicGateSummaries(companyID, userID)
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	folderIDs := r.visibleCompanyExplorerFolderSubtreeIDsLocked(companyID, folderID, "logic_gate", userID)
	items := make([]domain.LogicGate, 0)
	seen := map[string]bool{}
	for _, folderItem := range r.folderItems {
		if folderItem.CompanyID != companyID || folderItem.ItemType != "logic_gate" || !folderIDs[folderItem.FolderID] || seen[folderItem.ItemID] {
			continue
		}
		if !r.companyExplorerFolderItemVisibleLocked(companyID, userID, folderItem) {
			continue
		}
		gate, ok := r.logicGates[key(companyID, folderItem.ItemID)]
		if !ok {
			continue
		}
		seen[folderItem.ItemID] = true
		items = append(items, companyExplorerLogicGateSummary(r.withLogicGateGVICLocked(gate)))
	}
	sortCompanyExplorerLogicGateSummaries(items)
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
