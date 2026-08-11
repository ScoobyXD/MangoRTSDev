package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func memoryRACITabItemKey(companyID, userID, logicGateID string) string {
	return companyID + ":" + userID + ":" + logicGateID
}

func (r *MemoryRepo) reconcileMemoryRACITabsCompanyLocked(companyID string) {
	for _, gate := range r.logicGates {
		if gate.CompanyID != companyID {
			continue
		}
		r.reconcileMemoryRACITabsLogicGateLocked(gate)
	}
	for itemKey, item := range r.raciTabItems {
		if item.CompanyID != companyID {
			continue
		}
		if _, exists := r.logicGates[key(companyID, item.LogicGateID)]; !exists {
			delete(r.raciTabItems, itemKey)
		}
	}
}

func (r *MemoryRepo) reconcileMemoryRACITabsLogicGateLocked(gate domain.LogicGate) {
	if !r.ensureV2PolicySettingsLocked(gate.CompanyID, EntityTypeLogicGate, gate.LogicGateID) {
		for itemKey, item := range r.raciTabItems {
			if item.CompanyID == gate.CompanyID && item.LogicGateID == gate.LogicGateID {
				delete(r.raciTabItems, itemKey)
			}
		}
		return
	}
	policy := r.memoryV2RACIPolicyLocked(gate.CompanyID, EntityTypeLogicGate, gate.LogicGateID)
	expected := map[string]domain.ResourceRACIEffectiveAssignment{}
	for _, assignment := range policy.EffectiveAssignments {
		expected[assignment.UserID] = assignment
	}
	for itemKey, item := range r.raciTabItems {
		if item.CompanyID == gate.CompanyID && item.LogicGateID == gate.LogicGateID && expected[item.UserID].UserID == "" {
			delete(r.raciTabItems, itemKey)
		}
	}
	now := time.Now().UTC()
	for userID, assignment := range expected {
		itemKey := memoryRACITabItemKey(gate.CompanyID, userID, gate.LogicGateID)
		item, exists := r.raciTabItems[itemKey]
		roleChanged := exists && item.Role != assignment.Role
		if !exists {
			item = domain.RACITabItem{
				CompanyID: gate.CompanyID, UserID: userID, LogicGateID: gate.LogicGateID,
				CreatedTimestamp: gate.CreatedTimestamp,
			}
		}
		if item.CreatedTimestamp.IsZero() {
			item.CreatedTimestamp = now
		}
		changed := !exists || roleChanged || item.Name != gate.Header
		item.Role = assignment.Role
		item.Name = gate.Header
		if !exists || roleChanged {
			item.FolderID = nil
			item.Position = r.nextMemoryRACITabPositionLocked(gate.CompanyID, userID, assignment.Role, "", gate.LogicGateID)
		}
		if changed {
			item.UpdatedTimestamp = now
		}
		r.raciTabItems[itemKey] = item
	}
}

func (r *MemoryRepo) nextMemoryRACITabPositionLocked(companyID, userID, role, parentFolderID, excludedLogicGateID string) int {
	maximum := 0
	for _, folder := range r.raciTabFolders {
		if folder.CompanyID == companyID && folder.UserID == userID && folder.Role == role && pointerString(folder.ParentFolderID) == parentFolderID && folder.Position > maximum {
			maximum = folder.Position
		}
	}
	for _, item := range r.raciTabItems {
		if item.CompanyID == companyID && item.UserID == userID && item.Role == role && pointerString(item.FolderID) == parentFolderID && item.LogicGateID != excludedLogicGateID && item.Position > maximum {
			maximum = item.Position
		}
	}
	return maximum + raciTabPositionStep
}

func (r *MemoryRepo) ListRACITabBranch(input RACITabBranchInput) (domain.RACITabPage, error) {
	input, ok := normalizeRACITabBranchInput(input)
	if !ok {
		return domain.RACITabPage{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.memberships[membershipKey(input.CompanyID, input.UserID)]; !exists {
		return domain.RACITabPage{}, ErrNotFound
	}
	r.reconcileMemoryRACITabsCompanyLocked(input.CompanyID)
	if input.ParentFolderID != "" {
		folder, exists := r.raciTabFolders[key(input.CompanyID, input.ParentFolderID)]
		if !exists || folder.UserID != input.UserID || folder.Role != input.Role {
			return domain.RACITabPage{}, ErrNotFound
		}
	}
	countsByLogicGateID := r.memoryRACITabLogicGateCountsLocked(input.CompanyID)
	page := domain.RACITabPage{Role: input.Role, Rows: []domain.RACITabRow{}}
	if input.ParentFolderID != "" {
		parentID := input.ParentFolderID
		page.ParentFolderID = &parentID
	}
	for _, item := range r.raciTabItems {
		if item.CompanyID != input.CompanyID || item.UserID != input.UserID || item.Role != input.Role {
			continue
		}
		item.StatusCounts = countsByLogicGateID[item.LogicGateID]
		addRACITabStatusCounts(&page.StatusCounts, item.StatusCounts)
		if pointerString(item.FolderID) == input.ParentFolderID {
			itemCopy := item
			page.Rows = append(page.Rows, domain.RACITabRow{RowKind: RACITabLayoutEntryItem, Item: &itemCopy})
		}
	}
	for _, folder := range r.raciTabFolders {
		if folder.CompanyID != input.CompanyID || folder.UserID != input.UserID || folder.Role != input.Role || pointerString(folder.ParentFolderID) != input.ParentFolderID {
			continue
		}
		folder.HasChildren = r.memoryRACITabFolderHasChildrenLocked(folder)
		folder.StatusCounts = r.memoryRACITabFolderCountsLocked(folder, countsByLogicGateID, map[string]bool{})
		folderCopy := folder
		page.Rows = append(page.Rows, domain.RACITabRow{RowKind: RACITabLayoutEntryFolder, Folder: &folderCopy})
	}
	sortRACITabRows(page.Rows)
	total := len(page.Rows)
	if input.Offset >= total {
		page.Rows = []domain.RACITabRow{}
		return page, nil
	}
	end := input.Offset + input.Limit
	if end > total {
		end = total
	}
	page.Rows = page.Rows[input.Offset:end]
	setRACITabNextCursor(&page, input.Offset, input.Limit, total)
	return page, nil
}

func (r *MemoryRepo) GetRACITabLogicGateCounts(input RACITabLogicGateCountsInput) (domain.RACITabStatusCounts, error) {
	input, ok := normalizeRACITabLogicGateCountsInput(input)
	if !ok {
		return domain.RACITabStatusCounts{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.reconcileMemoryRACITabsCompanyLocked(input.CompanyID)
	if _, exists := r.raciTabItems[memoryRACITabItemKey(input.CompanyID, input.UserID, input.LogicGateID)]; !exists {
		return domain.RACITabStatusCounts{}, ErrNotFound
	}
	return r.memoryRACITabLogicGateCountsLocked(input.CompanyID)[input.LogicGateID], nil
}

func (r *MemoryRepo) memoryRACITabLogicGateCountsLocked(companyID string) map[string]domain.RACITabStatusCounts {
	countsByLogicGateID := map[string]domain.RACITabStatusCounts{}
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID != companyID {
			continue
		}
		counts := countsByLogicGateID[assignment.LogicGateID]
		addRACITabStatusCounts(&counts, raciTabCountsForStatus(assignment.StatusKey))
		countsByLogicGateID[assignment.LogicGateID] = counts
	}
	return countsByLogicGateID
}

func (r *MemoryRepo) memoryRACITabFolderHasChildrenLocked(folder domain.RACITabFolder) bool {
	for _, child := range r.raciTabFolders {
		if child.CompanyID == folder.CompanyID && child.UserID == folder.UserID && child.Role == folder.Role && pointerString(child.ParentFolderID) == folder.FolderID {
			return true
		}
	}
	for _, item := range r.raciTabItems {
		if item.CompanyID == folder.CompanyID && item.UserID == folder.UserID && item.Role == folder.Role && pointerString(item.FolderID) == folder.FolderID {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) memoryRACITabFolderCountsLocked(folder domain.RACITabFolder, countsByLogicGateID map[string]domain.RACITabStatusCounts, visited map[string]bool) domain.RACITabStatusCounts {
	if visited[folder.FolderID] {
		return domain.RACITabStatusCounts{}
	}
	visited[folder.FolderID] = true
	counts := domain.RACITabStatusCounts{}
	for _, item := range r.raciTabItems {
		if item.CompanyID == folder.CompanyID && item.UserID == folder.UserID && item.Role == folder.Role && pointerString(item.FolderID) == folder.FolderID {
			addRACITabStatusCounts(&counts, countsByLogicGateID[item.LogicGateID])
		}
	}
	for _, child := range r.raciTabFolders {
		if child.CompanyID == folder.CompanyID && child.UserID == folder.UserID && child.Role == folder.Role && pointerString(child.ParentFolderID) == folder.FolderID {
			addRACITabStatusCounts(&counts, r.memoryRACITabFolderCountsLocked(child, countsByLogicGateID, visited))
		}
	}
	delete(visited, folder.FolderID)
	return counts
}

func (r *MemoryRepo) CreateRACITabFolder(input RACITabFolderCreateInput) (domain.RACITabFolder, error) {
	input, ok := normalizeRACITabFolderCreateInput(input)
	if !ok {
		return domain.RACITabFolder{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.memberships[membershipKey(input.CompanyID, input.UserID)]; !exists {
		return domain.RACITabFolder{}, ErrNotFound
	}
	if _, exists := r.raciTabFolders[key(input.CompanyID, input.FolderID)]; exists {
		return domain.RACITabFolder{}, ErrAlreadyExists
	}
	if input.ParentFolderID != "" {
		parent, exists := r.raciTabFolders[key(input.CompanyID, input.ParentFolderID)]
		if !exists || parent.UserID != input.UserID || parent.Role != input.Role {
			return domain.RACITabFolder{}, ErrInvalid
		}
	}
	now := time.Now().UTC()
	folder := domain.RACITabFolder{
		CompanyID: input.CompanyID, FolderID: input.FolderID, UserID: input.UserID, Role: input.Role,
		Name: input.Name, Position: r.nextMemoryRACITabPositionLocked(input.CompanyID, input.UserID, input.Role, input.ParentFolderID, ""),
		CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	if input.ParentFolderID != "" {
		parentID := input.ParentFolderID
		folder.ParentFolderID = &parentID
	}
	r.raciTabFolders[key(input.CompanyID, input.FolderID)] = folder
	return folder, nil
}

func (r *MemoryRepo) RenameRACITabFolder(input RACITabFolderRenameInput) (domain.RACITabFolder, error) {
	input, ok := normalizeRACITabFolderRenameInput(input)
	if !ok {
		return domain.RACITabFolder{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	folderKey := key(input.CompanyID, input.FolderID)
	folder, exists := r.raciTabFolders[folderKey]
	if !exists || folder.UserID != input.UserID {
		return domain.RACITabFolder{}, ErrNotFound
	}
	folder.Name = input.Name
	folder.UpdatedTimestamp = time.Now().UTC()
	r.raciTabFolders[folderKey] = folder
	return folder, nil
}

func (r *MemoryRepo) DeleteRACITabFolder(input RACITabFolderDeleteInput) error {
	input, ok := normalizeRACITabFolderDeleteInput(input)
	if !ok {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	root, exists := r.raciTabFolders[key(input.CompanyID, input.FolderID)]
	if !exists || root.UserID != input.UserID {
		return ErrNotFound
	}
	subtree := map[string]bool{root.FolderID: true}
	for changed := true; changed; {
		changed = false
		for _, folder := range r.raciTabFolders {
			if folder.CompanyID == root.CompanyID && folder.UserID == root.UserID && folder.Role == root.Role && subtree[pointerString(folder.ParentFolderID)] && !subtree[folder.FolderID] {
				subtree[folder.FolderID] = true
				changed = true
			}
		}
	}
	moving := []domain.RACITabItem{}
	for _, item := range r.raciTabItems {
		if item.CompanyID == root.CompanyID && item.UserID == root.UserID && item.Role == root.Role && subtree[pointerString(item.FolderID)] {
			moving = append(moving, item)
		}
	}
	sort.SliceStable(moving, func(i, j int) bool {
		if moving[i].Position != moving[j].Position {
			return moving[i].Position < moving[j].Position
		}
		if !moving[i].CreatedTimestamp.Equal(moving[j].CreatedTimestamp) {
			return moving[i].CreatedTimestamp.Before(moving[j].CreatedTimestamp)
		}
		if strings.ToLower(moving[i].Name) != strings.ToLower(moving[j].Name) {
			return strings.ToLower(moving[i].Name) < strings.ToLower(moving[j].Name)
		}
		return moving[i].LogicGateID < moving[j].LogicGateID
	})
	maximum := r.nextMemoryRACITabPositionLocked(root.CompanyID, root.UserID, root.Role, "", "") - raciTabPositionStep
	now := time.Now().UTC()
	for index, item := range moving {
		item.FolderID = nil
		item.Position = maximum + (index+1)*raciTabPositionStep
		item.UpdatedTimestamp = now
		r.raciTabItems[memoryRACITabItemKey(item.CompanyID, item.UserID, item.LogicGateID)] = item
	}
	for folderKey, folder := range r.raciTabFolders {
		if folder.CompanyID == root.CompanyID && folder.UserID == root.UserID && subtree[folder.FolderID] {
			delete(r.raciTabFolders, folderKey)
		}
	}
	return nil
}

func (r *MemoryRepo) ApplyRACITabLayout(input RACITabLayoutInput) error {
	input, ok := normalizeRACITabLayoutInput(input)
	if !ok {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.memberships[membershipKey(input.CompanyID, input.UserID)]; !exists {
		return ErrNotFound
	}
	parents := map[string]string{}
	for _, folder := range r.raciTabFolders {
		if folder.CompanyID == input.CompanyID && folder.UserID == input.UserID && folder.Role == input.Role {
			parents[folder.FolderID] = pointerString(folder.ParentFolderID)
		}
	}
	for _, entry := range input.Entries {
		if entry.ParentFolderID != "" {
			if _, exists := parents[entry.ParentFolderID]; !exists {
				return ErrInvalid
			}
		}
		if entry.EntryType == RACITabLayoutEntryFolder {
			if _, exists := parents[entry.EntryID]; !exists || entry.EntryID == entry.ParentFolderID {
				return ErrInvalid
			}
			parents[entry.EntryID] = entry.ParentFolderID
			continue
		}
		item, exists := r.raciTabItems[memoryRACITabItemKey(input.CompanyID, input.UserID, entry.EntryID)]
		if !exists || item.Role != input.Role {
			return ErrInvalid
		}
	}
	for folderID := range parents {
		seen := map[string]bool{folderID: true}
		for parentID := parents[folderID]; parentID != ""; parentID = parents[parentID] {
			if seen[parentID] {
				return ErrInvalid
			}
			seen[parentID] = true
		}
	}
	now := time.Now().UTC()
	for _, entry := range input.Entries {
		if entry.EntryType == RACITabLayoutEntryFolder {
			folderKey := key(input.CompanyID, entry.EntryID)
			folder := r.raciTabFolders[folderKey]
			folder.ParentFolderID = optionalStringPointer(entry.ParentFolderID)
			folder.Position = entry.Position
			folder.UpdatedTimestamp = now
			r.raciTabFolders[folderKey] = folder
			continue
		}
		itemKey := memoryRACITabItemKey(input.CompanyID, input.UserID, entry.EntryID)
		item := r.raciTabItems[itemKey]
		item.FolderID = optionalStringPointer(entry.ParentFolderID)
		item.Position = entry.Position
		item.UpdatedTimestamp = now
		r.raciTabItems[itemKey] = item
	}
	return nil
}

func pointerString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func optionalStringPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
