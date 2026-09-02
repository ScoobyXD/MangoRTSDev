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
	beforeMutation := r.snapshotProcessMapMutationLocked()
	if _, err := r.appendDomainEventLocked(workspaceDomainEventInput(companyID, "company_explorer_folder_created", map[string]any{
		"folder_id": item.FolderID, "parent_entity_id": parentFolderID,
	})); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	r.folders[key(companyID, item.FolderID)] = item
	r.syncMemoryProcessMapParentToExplorerLocked(companyID, domain.ProcessMapResourceTypeFolder, item.FolderID, item.ParentFolderID, now)
	if _, err := r.syncAutomaticMemoryProcessMapPlacementLocked(companyID, domain.ProcessMapResourceTypeFolder, item.FolderID, item.ParentFolderID, ""); err != nil {
		r.restoreProcessMapMutationLocked(beforeMutation)
		return domain.CompanyExplorerFolder{}, err
	}
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
	return r.withSharedInboxRACILocked(item), nil
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
		accessLevel := r.effectiveAccessLevelLocked(companyID, userID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionEdit)
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
			if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionEdit) {
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
		return EntityPermissionEdit
	}
	if r.userHasResourcePermissionLocked(companyID, userID, resourceType, resourceID, EntityPermissionEdit) {
		return EntityPermissionEdit
	}
	if r.userHasResourcePermissionLocked(companyID, userID, resourceType, resourceID, accessLevel) {
		return EntityPermissionEdit
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
		if folder.FolderKind == "communications" || !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionEdit) {
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
			if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionEdit) {
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
		accessLevel := r.effectiveAccessLevelLocked(companyID, userID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionEdit)
		if accessLevel == "" {
			continue
		}
		item.EffectiveAccess = accessLevel
		items = append(items, item)
	}
	sortCompanyExplorerFolders(items)
	return items, nil
}
func (r *MemoryRepo) MoveCompanyExplorerFolder(companyID, folderID string, parentFolderID *string, position int, actorUserID, permissionUserID string) (domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	actorUserID = strings.TrimSpace(actorUserID)
	permissionUserID = strings.TrimSpace(permissionUserID)
	if companyID == "" || folderID == "" || (actorUserID == "") != (permissionUserID == "") || (actorUserID != "" && actorUserID != permissionUserID) {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	beforeMutation := r.snapshotProcessMapMutationLocked()

	item, ok := r.folders[key(companyID, folderID)]
	if !ok || item.FolderKind == "communications" {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if permissionUserID != "" && (!r.userHasCompanyMembershipLocked(companyID, permissionUserID) || !r.userHasEffectiveAccessLocked(companyID, permissionUserID, EntityTypeCompanyExplorerFolder, folderID, EntityPermissionEdit)) {
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
		if permissionUserID != "" && !r.userHasEffectiveAccessLocked(companyID, permissionUserID, EntityTypeCompanyExplorerFolder, targetParentID, EntityPermissionEdit) {
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

	audienceResources := []domain.ProcessMapResourceRef(nil)
	beforeAudience := processMapAccessAudience(nil)
	if parentChanged {
		audienceResources = r.processMapAccessResourcesLocked(companyID, domain.ProcessMapResourceTypeFolder, folderID)
		beforeAudience = r.processMapAccessAudienceLocked(companyID, audienceResources)
	}
	if _, err := r.syncAutomaticMemoryProcessMapPlacementLocked(companyID, domain.ProcessMapResourceTypeFolder, item.FolderID, parent, permissionUserID); err != nil {
		r.restoreProcessMapMutationLocked(beforeMutation)
		return domain.CompanyExplorerFolder{}, err
	}
	item.ParentFolderID = parent
	item.Position = position
	item.UpdatedTimestamp = time.Now().UTC()
	r.folders[key(companyID, item.FolderID)] = item
	r.syncMemoryProcessMapParentToExplorerLocked(companyID, domain.ProcessMapResourceTypeFolder, item.FolderID, item.ParentFolderID, item.UpdatedTimestamp)
	payload := map[string]any{"folder_id": folderID, "parent_entity_id": targetParentID}
	if parentChanged {
		markProcessMapProtectedGeometryChanged(payload, beforeAudience, r.processMapAccessAudienceLocked(companyID, audienceResources))
	}
	eventInput := workspaceDomainEventInput(companyID, "company_explorer_folder_updated", payload)
	eventInput.ActorUserID = strings.TrimSpace(actorUserID)
	if _, err := r.appendDomainEventLocked(eventInput); err != nil {
		r.restoreProcessMapMutationLocked(beforeMutation)
		return domain.CompanyExplorerFolder{}, err
	}
	return item, nil
}

func (r *MemoryRepo) RenameCompanyExplorerFolder(companyID, folderID, name, actorUserID, permissionUserID string) (domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	name = strings.TrimSpace(name)
	actorUserID = strings.TrimSpace(actorUserID)
	permissionUserID = strings.TrimSpace(permissionUserID)
	if companyID == "" || folderID == "" || name == "" || (actorUserID == "") != (permissionUserID == "") || (actorUserID != "" && actorUserID != permissionUserID) {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.folders[key(companyID, folderID)]
	if !ok || item.FolderKind == "communications" {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if permissionUserID != "" && (!r.userHasCompanyMembershipLocked(companyID, permissionUserID) || !r.userHasEffectiveAccessLocked(companyID, permissionUserID, EntityTypeCompanyExplorerFolder, folderID, EntityPermissionEdit)) {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if err := protectCompanyExplorerDefaultFolderMutation(companyID, folderID); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	if item.SystemKey != nil {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	beforeMutation := r.snapshotProcessMapMutationLocked()
	previous := item
	item.Name = name
	item.UpdatedTimestamp = time.Now().UTC()
	r.folders[key(companyID, item.FolderID)] = item
	eventInput := workspaceDomainEventInput(companyID, "company_explorer_folder_updated", map[string]any{"folder_id": folderID})
	eventInput.ActorUserID = actorUserID
	if _, err := r.appendDomainEventsLocked([]DomainEventInput{eventInput}); err != nil {
		r.folders[key(companyID, item.FolderID)] = previous
		r.restoreProcessMapMutationLocked(beforeMutation)
		return domain.CompanyExplorerFolder{}, err
	}
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
	return r.withSharedInboxRACILocked(item), nil
}

func (r *MemoryRepo) DeleteCompanyExplorerTargets(companyID string, targets []CompanyExplorerDeleteTargetInput, deletedByUserID string) (CompanyExplorerDeleteResult, error) {
	companyID = strings.TrimSpace(companyID)
	deletedByUserID = strings.TrimSpace(deletedByUserID)
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
	beforeRecycleBin := cloneMap(r.recycleBin)
	beforeDomainEvents := cloneMap(r.domainEvents)
	beforeWorkspaceReadVersions := cloneMap(r.workspaceReadVersions)
	beforeOutbox := cloneMap(r.realtimeOutbox)
	beforeOutboxSequence := r.realtimeOutboxSequence
	committed := false
	defer func() {
		if !committed {
			r.restoreRecycleSnapshotLocked(recycleSnapshot)
			r.recycleBin = beforeRecycleBin
			r.domainEvents = beforeDomainEvents
			r.workspaceReadVersions = beforeWorkspaceReadVersions
			r.realtimeOutbox = beforeOutbox
			r.realtimeOutboxSequence = beforeOutboxSequence
		}
	}()

	deleteScope := newCompanyExplorerRecycleScope()
	folderIDs := deleteScope.FolderIDs
	folderKinds := deleteScope.FolderKinds
	nodeIDs := deleteScope.NodeIDs
	logicGateIDs := deleteScope.LogicGateIDs
	projectIDs := deleteScope.ProjectIDs
	kanbanBoardIDs := deleteScope.KanbanBoardIDs
	recycleRoots := make([]companyExplorerRecycleRootScope, 0, len(targets))

	for _, target := range targets {
		targetScope := newCompanyExplorerRecycleScope()
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
				targetScope.FolderIDs[id] = true
				targetScope.FolderKinds[id] = item.FolderKind
			}
		case "node":
			if _, ok := r.nodes[key(companyID, target.ID)]; !ok {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			targetScope.NodeIDs[target.ID] = true
		case "logic_gate":
			if _, ok := r.logicGates[key(companyID, target.ID)]; !ok {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			targetScope.LogicGateIDs[target.ID] = true
		case "project":
			if _, ok := r.projects[key(companyID, target.ID)]; !ok {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			targetScope.ProjectIDs[target.ID] = true
		case "kanban":
			if _, ok := r.kanbanBoards[boardKey(companyID, target.ID)]; !ok {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			targetScope.KanbanBoardIDs[target.ID] = true
		}
		r.expandCompanyExplorerDeleteScopeLocked(companyID, targetScope.FolderIDs, targetScope.NodeIDs, targetScope.LogicGateIDs, targetScope.ProjectIDs)
		for _, board := range r.kanbanBoards {
			if board.CompanyID == companyID && board.LogicGateID != nil && targetScope.LogicGateIDs[*board.LogicGateID] {
				targetScope.KanbanBoardIDs[board.BoardID] = true
			}
		}
		targetScope.addLogicGateBoards()
		targetScope.mergeInto(&deleteScope)
		recycleRoots = append(recycleRoots, companyExplorerRecycleRootScope{Target: target, Scope: targetScope})
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
	eventInputs := companyExplorerTargetWorkspaceEventInputs(companyID, result.Targets, false)
	for index := range eventInputs {
		eventInputs[index].ActorUserID = deletedByUserID
	}
	events, err := r.appendDomainEventsLocked(eventInputs)
	if err != nil {
		return CompanyExplorerDeleteResult{}, err
	}
	result.Events = events
	if err := r.deleteCompanyExplorerRecycleScopeLocked(companyID, deleteScope); err != nil {
		return CompanyExplorerDeleteResult{}, err
	}
	afterDeleteSnapshot := r.snapshotRecycleStateLocked()
	deletedSnapshot := memoryRecycleSnapshotDelta(recycleSnapshot, afterDeleteSnapshot)
	recycleContext := memoryRecycleSnapshotWithProcessMapTraceContext(recycleSnapshot, afterDeleteSnapshot, deletedSnapshot)
	if err := r.createRecycleBinItemsLocked(companyID, deletedByUserID, recycleRoots, recycleSnapshot, recycleContext); err != nil {
		return CompanyExplorerDeleteResult{}, err
	}
	committed = true
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

	if err := r.validateCompanyExplorerFolderItemAssignmentLocked(companyID, folderID, itemType, itemID); err != nil {
		return domain.CompanyExplorerFolderItem{}, nil, err
	}
	beforeMutation := r.snapshotProcessMapMutationLocked()
	audienceResources := r.processMapAccessResourcesLocked(companyID, itemType, itemID)
	beforeAudience := r.processMapAccessAudienceLocked(companyID, audienceResources)
	item, deletedRelationshipIDs, err := r.assignCompanyExplorerFolderItemLocked(companyID, folderID, itemType, itemID, position)
	if err != nil {
		r.restoreProcessMapMutationLocked(beforeMutation)
		return domain.CompanyExplorerFolderItem{}, nil, err
	}
	payload := map[string]any{"parent_entity_id": folderID, "target_type": itemType, "target_id": itemID}
	markProcessMapProtectedGeometryChanged(payload, beforeAudience, r.processMapAccessAudienceLocked(companyID, audienceResources))
	if _, err := r.appendDomainEventLocked(workspaceDomainEventInput(companyID, "company_explorer_item_placed", payload)); err != nil {
		r.restoreProcessMapMutationLocked(beforeMutation)
		return domain.CompanyExplorerFolderItem{}, nil, err
	}
	return item, deletedRelationshipIDs, nil
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
	beforeMutation := r.snapshotProcessMapMutationLocked()
	audienceResources := make([][]domain.ProcessMapResourceRef, len(assignments))
	beforeAudiences := make([]processMapAccessAudience, len(assignments))
	for index, assignment := range assignments {
		audienceResources[index] = r.processMapAccessResourcesLocked(companyID, assignment.ItemType, assignment.ItemID)
		beforeAudiences[index] = r.processMapAccessAudienceLocked(companyID, audienceResources[index])
	}

	items := make([]domain.CompanyExplorerFolderItem, 0, len(assignments))
	deleted := make([]CompanyExplorerRelationshipDeleteResult, 0)
	for _, assignment := range assignments {
		item, deletedRelationshipIDs, err := r.assignCompanyExplorerFolderItemLocked(companyID, assignment.FolderID, assignment.ItemType, assignment.ItemID, assignment.Position)
		if err != nil {
			r.restoreProcessMapMutationLocked(beforeMutation)
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
	eventInputs := make([]DomainEventInput, 0, len(assignments))
	for index, assignment := range assignments {
		payload := map[string]any{"parent_entity_id": assignment.FolderID, "target_type": assignment.ItemType, "target_id": assignment.ItemID}
		markProcessMapProtectedGeometryChanged(payload, beforeAudiences[index], r.processMapAccessAudienceLocked(companyID, audienceResources[index]))
		eventInputs = append(eventInputs, workspaceDomainEventInput(companyID, "company_explorer_item_placed", payload))
	}
	if _, err := r.appendDomainEventsLocked(eventInputs); err != nil {
		r.restoreProcessMapMutationLocked(beforeMutation)
		return nil, nil, err
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
	if existing, ok := r.folderItems[k]; ok {
		created = existing.CreatedTimestamp
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
	if itemType == EntityTypeLogicGate {
		parentID := folderID
		r.syncMemoryProcessMapParentToExplorerLocked(companyID, domain.ProcessMapResourceTypeProcess, itemID, &parentID, now)
		if _, err := r.syncAutomaticMemoryProcessMapPlacementLocked(companyID, domain.ProcessMapResourceTypeProcess, itemID, &parentID, ""); err != nil {
			return domain.CompanyExplorerFolderItem{}, nil, err
		}
	}

	return item, []string{}, nil
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
	if folder.FolderKind == "communications" || !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionEdit) {
		return false
	}
	switch item.ItemType {
	case "logic_gate":
		return r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, item.ItemID, EntityPermissionEdit)
	case EntityTypeProject:
		return r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeProject, item.ItemID, EntityPermissionEdit)
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
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeNode, node.NodeID, EntityPermissionEdit) {
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
		RACIAssignments:  append([]domain.LogicGateRACIAssignment{}, gate.RACIAssignments...),
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
		items = append(items, companyExplorerLogicGateSummary(r.withLogicGateRACILocked(gate)))
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
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit) {
			continue
		}
		items = append(items, companyExplorerLogicGateSummary(r.withLogicGateRACILocked(gate)))
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
		items = append(items, companyExplorerLogicGateSummary(r.withLogicGateRACILocked(gate)))
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
		items = append(items, companyExplorerLogicGateSummary(r.withLogicGateRACILocked(gate)))
	}
	sortCompanyExplorerLogicGateSummaries(items)
	return items, nil
}

func (r *MemoryRepo) RemoveCompanyExplorerFolderItem(companyID, itemType, itemID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	k := folderItemKey(companyID, itemType, itemID)
	item, ok := r.folderItems[k]
	if !ok {
		return ErrNotFound
	}
	if _, err := r.appendDomainEventLocked(workspaceDomainEventInput(companyID, "company_explorer_item_removed", map[string]any{
		"parent_entity_id": item.FolderID, "target_type": itemType, "target_id": itemID,
	})); err != nil {
		return err
	}
	delete(r.folderItems, k)
	if itemType == EntityTypeLogicGate {
		for edgeKey, edge := range r.companyExplorerV2Edges {
			if edge.CompanyID == companyID && edge.ChildEntityID == itemID {
				delete(r.companyExplorerV2Edges, edgeKey)
			}
		}
		r.deleteAutomaticMemoryProcessMapPlacementLocked(companyID, domain.ProcessMapResourceTypeProcess, itemID)
	}
	return nil
}
