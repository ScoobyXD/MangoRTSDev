package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const companyExplorerDefaultFolderSeedKey = "logic_gates_v1"
const companyExplorerDefaultCommunicationsFolderSeedKey = "communications_v1"
const companyExplorerSystemFolderSeedKey = "system_folders_v1"
const CompanyExplorerSystemActiveNodesKey = "active_nodes"
const CompanyExplorerSystemHistoryKey = "history"

var companyExplorerDefaultLogicGateChildFolderNames = []string{
	"Product",
	"Design",
	"Production",
	"Supply Chain",
	"QA",
}

type companyExplorerDefaultFolderDefinition struct {
	Name     string
	Children []companyExplorerDefaultFolderDefinition
}

var companyExplorerDefaultCommunicationsFolderTree = []companyExplorerDefaultFolderDefinition{
	{
		Name: "BM",
		Children: []companyExplorerDefaultFolderDefinition{
			{
				Name: "Product",
				Children: []companyExplorerDefaultFolderDefinition{
					{Name: "design"},
					{Name: "printing"},
					{Name: "suppliers"},
				},
			},
			{Name: "Account"},
			{Name: "Commercial"},
			{Name: "Project"},
		},
	},
	{
		Name: "Supply Chain",
		Children: []companyExplorerDefaultFolderDefinition{
			{Name: "orders"},
			{Name: "shipping"},
			{Name: "receiving"},
		},
	},
	{
		Name: "Production",
		Children: []companyExplorerDefaultFolderDefinition{
			{Name: "temps"},
		},
	},
	{
		Name: "QA",
		Children: []companyExplorerDefaultFolderDefinition{
			{Name: "quality"},
		},
	},
	{
		Name: "Finance",
		Children: []companyExplorerDefaultFolderDefinition{
			{Name: "ar"},
			{Name: "ap"},
		},
	},
	{Name: "Legal"},
	{Name: "HR"},
}

type companyExplorerSystemFolderDefinition struct {
	Key      string
	Name     string
	Position int
}

var companyExplorerSystemFolderSeeds = []companyExplorerSystemFolderDefinition{
	{Key: CompanyExplorerSystemActiveNodesKey, Name: "Active Nodes", Position: 200},
	{Key: CompanyExplorerSystemHistoryKey, Name: "History", Position: 300},
}

func companyExplorerSystemFolderDefinitionForKey(systemKey string) (companyExplorerSystemFolderDefinition, bool) {
	for _, seed := range companyExplorerSystemFolderSeeds {
		if seed.Key == systemKey {
			return seed, true
		}
	}
	return companyExplorerSystemFolderDefinition{}, false
}

func companyExplorerParentID(folder domain.CompanyExplorerFolder) string {
	if folder.ParentFolderID == nil {
		return ""
	}
	return *folder.ParentFolderID
}

func (r *MemoryRepo) createCompanyExplorerDefaultFolderTreeLocked(companyID, folderKind, parentFolderID string, startPosition int, seeds []companyExplorerDefaultFolderDefinition, now time.Time) {
	for index, seed := range seeds {
		var parent *string
		if parentFolderID != "" {
			parentValue := parentFolderID
			parent = &parentValue
		}
		folderID := newUUIDv7String()
		r.folders[key(companyID, folderID)] = domain.CompanyExplorerFolder{
			CompanyID:        companyID,
			FolderID:         folderID,
			ParentFolderID:   parent,
			FolderKind:       folderKind,
			Name:             seed.Name,
			Position:         startPosition + index*1000,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
		if len(seed.Children) > 0 {
			r.createCompanyExplorerDefaultFolderTreeLocked(companyID, folderKind, folderID, 1000, seed.Children, now)
		}
	}
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
	if !r.defaultFolderSeed[seedKey] {
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

	communicationsSeedKey := companyID + ":" + companyExplorerDefaultCommunicationsFolderSeedKey
	if !r.defaultFolderSeed[communicationsSeedKey] {
		now := time.Now().UTC()
		startPosition := nextCompanyExplorerRowPosition(r.folders, r.folderItems, companyID, "communications", "")
		r.createCompanyExplorerDefaultFolderTreeLocked(companyID, "communications", "", startPosition, companyExplorerDefaultCommunicationsFolderTree, now)
		r.defaultFolderSeed[communicationsSeedKey] = true
	}
}

func (r *MemoryRepo) ensureCompanyExplorerSystemFolderLocked(companyID, systemKey string) (domain.CompanyExplorerFolder, bool) {
	for _, folder := range r.folders {
		if folder.CompanyID == companyID && folder.SystemKey != nil && *folder.SystemKey == systemKey {
			return folder, true
		}
	}
	seed, ok := companyExplorerSystemFolderDefinitionForKey(systemKey)
	if !ok {
		return domain.CompanyExplorerFolder{}, false
	}
	now := time.Now().UTC()
	systemKeyValue := seed.Key
	folder := domain.CompanyExplorerFolder{
		CompanyID:        companyID,
		FolderID:         newUUIDv7String(),
		FolderKind:       "node",
		SystemKey:        &systemKeyValue,
		Name:             seed.Name,
		Position:         seed.Position,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.folders[key(companyID, folder.FolderID)] = folder
	return folder, true
}

func (r *MemoryRepo) assignNodeToActiveNodesFolderLocked(companyID, nodeID string, position int) (domain.CompanyExplorerFolderItem, error) {
	activeFolder, ok := r.ensureCompanyExplorerSystemFolderLocked(companyID, CompanyExplorerSystemActiveNodesKey)
	if !ok {
		return domain.CompanyExplorerFolderItem{}, ErrNotFound
	}
	item, _, err := r.assignCompanyExplorerFolderItemLocked(companyID, activeFolder.FolderID, "node", nodeID, position)
	return item, err
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
	return r.withSharedInboxRaciLocked(item), nil
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
		if folder.SystemKey != nil && *folder.SystemKey == "kanban_boards" {
			continue
		}
		items = append(items, r.withSharedInboxRaciLocked(folder))
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

func (r *MemoryRepo) ListVisibleCompanyExplorerFolders(companyID, folderKind, userID string) ([]domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	folderKind = strings.TrimSpace(folderKind)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}

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
		if folder.SystemKey != nil && *folder.SystemKey == "kanban_boards" {
			continue
		}
		item := r.withSharedInboxRaciLocked(folder)
		if folder.FolderKind == "communications" {
			accessLevel := r.effectiveAccessLevelLocked(companyID, userID, EntityTypeSharedTriageFolder, folder.FolderID, EntityPermissionView)
			if accessLevel == "" {
				continue
			}
			item.EffectiveAccess = accessLevel
		}
		items = append(items, item)
	}
	sortCompanyExplorerFolders(items)
	return items, nil
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
	best := ""
	for _, access := range r.effectiveAccess {
		if access.CompanyID != companyID ||
			access.UserID != userID ||
			access.ResourceType != resourceType ||
			access.ResourceID != resourceID ||
			!EntityPermissionSatisfies(access.AccessLevel, accessLevel) {
			continue
		}
		if best == "" || EntityPermissionRank(access.AccessLevel) > EntityPermissionRank(best) {
			best = access.AccessLevel
		}
	}
	return best
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
		if folder.SystemKey != nil && *folder.SystemKey == "kanban_boards" {
			continue
		}
		items = append(items, r.withSharedInboxRaciLocked(folder))
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

	ids := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, folderID, folderKind)
	items := make([]domain.CompanyExplorerFolder, 0, len(ids))
	for _, folder := range r.folders {
		if !ids[folder.FolderID] {
			continue
		}
		if folder.SystemKey != nil && *folder.SystemKey == "kanban_boards" {
			continue
		}
		item := r.withSharedInboxRaciLocked(folder)
		if folder.FolderKind == "communications" {
			accessLevel := r.effectiveAccessLevelLocked(companyID, userID, EntityTypeSharedTriageFolder, folder.FolderID, EntityPermissionView)
			if accessLevel == "" {
				continue
			}
			item.EffectiveAccess = accessLevel
		}
		items = append(items, item)
	}
	sortCompanyExplorerFolders(items)
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
	return r.withSharedInboxRaciLocked(item), nil
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
	return r.withSharedInboxRaciLocked(item), nil
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
	if accountEmail != "" && !r.companyHasConnectedEmailAccountLocked(companyID, accountEmail) {
		return domain.CompanyExplorerFolder{}, ErrEmailAccountUnavailable
	}
	if accountEmail == "" {
		item.AccountEmail = nil
	} else {
		item.AccountEmail = &accountEmail
	}
	item.UpdatedTimestamp = time.Now().UTC()
	r.folders[key(companyID, item.FolderID)] = item
	return r.withSharedInboxRaciLocked(item), nil
}

func (r *MemoryRepo) companyHasConnectedEmailAccountLocked(companyID, accountEmail string) bool {
	for _, connection := range r.emailConnections {
		if connection.Status != "connected" || normalizeEmail(connection.AccountEmail) != accountEmail {
			continue
		}
		if _, ok := r.memberships[membershipKey(companyID, connection.UserID)]; ok {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) DeleteCompanyExplorerFolder(companyID, folderID string) error {
	_, err := r.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: "folder", ID: folderID}})
	return err
}

func (r *MemoryRepo) DeleteCompanyExplorerTargets(companyID string, targets []CompanyExplorerDeleteTargetInput) (CompanyExplorerDeleteResult, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" || len(targets) == 0 || len(targets) > CompanyExplorerDeleteBatchMaxItems {
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

	folderIDs := map[string]bool{}
	folderKinds := map[string]string{}
	nodeIDs := map[string]bool{}
	logicGateIDs := map[string]bool{}
	kanbanBoardIDs := map[string]bool{}

	for _, target := range targets {
		switch target.Kind {
		case "folder":
			folder, ok := r.folders[key(companyID, target.ID)]
			if !ok {
				return CompanyExplorerDeleteResult{}, ErrNotFound
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
				item := r.folders[key(companyID, id)]
				if item.SystemKey != nil {
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
		}
	}

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
	appendSorted("kanban", kanbanBoardIDs)

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
	for nodeID := range nodeIDs {
		if err := r.deleteNodeLocked(companyID, nodeID); err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
	}
	for folderID := range folderIDs {
		delete(r.folders, key(companyID, folderID))
		delete(r.sharedInboxRaci, sharedInboxRaciKey(companyID, folderID))
	}
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.EntityType == EntityTypeSharedTriageFolder && folderIDs[permission.EntityID] {
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
		if item.ItemType == "kanban" {
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
		if item.CompanyID != companyID || item.ItemType == "kanban" {
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
	switch item.ItemType {
	case "node":
		return r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeNode, item.ItemID, EntityPermissionView)
	case "logic_gate":
		return r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, item.ItemID, EntityPermissionView)
	default:
		return true
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
		if item.CompanyID != companyID || item.ItemType == "kanban" || !ids[item.FolderID] {
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

	ids := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, folderID, "")
	items := make([]domain.CompanyExplorerFolderItem, 0)
	for _, item := range r.folderItems {
		if item.CompanyID != companyID || item.ItemType == "kanban" || !ids[item.FolderID] {
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
		DueDate:          node.DueDate,
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
		items = append(items, companyExplorerNodeSummary(node))
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
		items = append(items, companyExplorerNodeSummary(node))
	}
	sortCompanyExplorerNodeSummaries(items)
	return items, nil
}

func (r *MemoryRepo) ListCompanyExplorerNodeSummariesInFolderSubtree(companyID, folderID string) ([]domain.Node, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListCompanyExplorerNodeSummaries(companyID)
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	folderIDs := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, folderID, "node")
	items := make([]domain.Node, 0)
	seen := map[string]bool{}
	for _, folderItem := range r.folderItems {
		if folderItem.CompanyID != companyID || folderItem.ItemType != "node" || !folderIDs[folderItem.FolderID] || seen[folderItem.ItemID] {
			continue
		}
		node, ok := r.nodes[key(companyID, folderItem.ItemID)]
		if !ok {
			continue
		}
		seen[folderItem.ItemID] = true
		items = append(items, companyExplorerNodeSummary(node))
	}
	sortCompanyExplorerNodeSummaries(items)
	return items, nil
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

	r.mu.RLock()
	defer r.mu.RUnlock()

	folderIDs := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, folderID, "node")
	items := make([]domain.Node, 0)
	seen := map[string]bool{}
	for _, folderItem := range r.folderItems {
		if folderItem.CompanyID != companyID || folderItem.ItemType != "node" || !folderIDs[folderItem.FolderID] || seen[folderItem.ItemID] {
			continue
		}
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeNode, folderItem.ItemID, EntityPermissionView) {
			continue
		}
		node, ok := r.nodes[key(companyID, folderItem.ItemID)]
		if !ok {
			continue
		}
		seen[folderItem.ItemID] = true
		items = append(items, companyExplorerNodeSummary(node))
	}
	sortCompanyExplorerNodeSummaries(items)
	return items, nil
}

func companyExplorerLogicGateSummary(gate domain.LogicGate) domain.LogicGate {
	return domain.LogicGate{
		CompanyID:        gate.CompanyID,
		LogicGateID:      gate.LogicGateID,
		Header:           gate.Header,
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
		items = append(items, companyExplorerLogicGateSummary(gate))
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
		items = append(items, companyExplorerLogicGateSummary(gate))
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
		items = append(items, companyExplorerLogicGateSummary(gate))
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

	folderIDs := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, folderID, "logic_gate")
	items := make([]domain.LogicGate, 0)
	seen := map[string]bool{}
	for _, folderItem := range r.folderItems {
		if folderItem.CompanyID != companyID || folderItem.ItemType != "logic_gate" || !folderIDs[folderItem.FolderID] || seen[folderItem.ItemID] {
			continue
		}
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, folderItem.ItemID, EntityPermissionView) {
			continue
		}
		gate, ok := r.logicGates[key(companyID, folderItem.ItemID)]
		if !ok {
			continue
		}
		seen[folderItem.ItemID] = true
		items = append(items, companyExplorerLogicGateSummary(gate))
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
