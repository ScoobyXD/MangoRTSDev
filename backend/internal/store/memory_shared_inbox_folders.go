package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *MemoryRepo) CreateCommunicationsSharedInboxFolder(companyID, parentFolderID, name, accountEmail string) (domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	parentFolderID = strings.TrimSpace(parentFolderID)
	name = strings.TrimSpace(name)
	accountEmail = normalizeEmail(accountEmail)
	if companyID == "" || name == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.companies[companyID]; !ok {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}

	var parent *string
	if parentFolderID != "" {
		parentFolder, ok := r.folders[key(companyID, parentFolderID)]
		if !ok || parentFolder.FolderKind != "communications" {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		if parentFolder.EntryType == CommunicationsSharedInboxEntryTypeSharedInbox {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		parentValue := parentFolderID
		parent = &parentValue
	}

	entryType := CommunicationsSharedInboxEntryTypeFolder
	var accountEmailPtr *string
	companyEmailConnectionID := ""
	if accountEmail != "" {
		connection, ok := r.connectedCompanyEmailConnectionForAccountLocked(companyID, accountEmail)
		if !ok {
			return domain.CompanyExplorerFolder{}, ErrEmailAccountUnavailable
		}
		entryType = CommunicationsSharedInboxEntryTypeSharedInbox
		accountEmailPtr = &accountEmail
		companyEmailConnectionID = connection.CompanyEmailConnectionID
	}

	now := time.Now().UTC()
	item := domain.CompanyExplorerFolder{
		CompanyID:                companyID,
		FolderID:                 newUUIDv7String(),
		ParentFolderID:           parent,
		FolderKind:               "communications",
		EntryType:                entryType,
		Name:                     name,
		DefaultAccess:            ResourceDefaultAccessEdit,
		AccountEmail:             accountEmailPtr,
		CompanyEmailConnectionID: companyEmailConnectionID,
		ScopeType:                CompanyExplorerFolderScopeCompany,
		Position:                 nextCompanyExplorerFolderPosition(r.folders, companyID, "communications", parentFolderID),
		CreatedTimestamp:         now,
		UpdatedTimestamp:         now,
	}
	if entryType == CommunicationsSharedInboxEntryTypeSharedInbox {
		item.SharedInboxID = item.FolderID
	}
	r.folders[key(companyID, item.FolderID)] = item
	return r.withSharedInboxGVICLocked(item), nil
}

func (r *MemoryRepo) ListCommunicationsSharedInboxFolders(companyID string) ([]domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.CompanyExplorerFolder, 0)
	for _, folder := range r.folders {
		if folder.CompanyID != companyID || folder.FolderKind != "communications" {
			continue
		}
		items = append(items, r.withSharedInboxGVICLocked(normalizeMemorySharedInboxFolder(folder)))
	}
	sortCompanyExplorerFolders(items)
	return items, nil
}

func (r *MemoryRepo) ListVisibleCommunicationsSharedInboxFolders(companyID, userID string) ([]domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.CompanyExplorerFolder, 0)
	for _, folder := range r.folders {
		if folder.CompanyID != companyID || folder.FolderKind != "communications" {
			continue
		}
		resourceType := CommunicationsSharedInboxResourceType(folder)
		if !r.userHasEffectiveAccessLocked(companyID, userID, resourceType, folder.FolderID, EntityPermissionEdit) {
			continue
		}
		item := r.withSharedInboxGVICLocked(normalizeMemorySharedInboxFolder(folder))
		item.EffectiveAccess = r.effectiveAccessLevelLocked(companyID, userID, resourceType, folder.FolderID, EntityPermissionEdit)
		if item.EffectiveAccess == "" {
			continue
		}
		items = append(items, item)
	}
	sortCompanyExplorerFolders(items)
	return items, nil
}

func (r *MemoryRepo) GetCommunicationsSharedInboxFolder(companyID, folderID string) (domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" || folderID == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	item, ok := r.folders[key(companyID, folderID)]
	if !ok || item.FolderKind != "communications" {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	return r.withSharedInboxGVICLocked(normalizeMemorySharedInboxFolder(item)), nil
}

func (r *MemoryRepo) MoveCommunicationsSharedInboxFolder(companyID, folderID string, parentFolderID *string, position int) (domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" || folderID == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.folders[key(companyID, folderID)]
	if !ok || item.FolderKind != "communications" {
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
		if !ok || parentFolder.FolderKind != "communications" {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		if parentFolder.EntryType == CommunicationsSharedInboxEntryTypeSharedInbox {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		toCheck := map[string]bool{folderID: true}
		changed := true
		for changed {
			changed = false
			for _, folder := range r.folders {
				if folder.CompanyID != companyID || folder.ParentFolderID == nil || folder.FolderKind != "communications" {
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
			position = nextCompanyExplorerFolderPosition(r.folders, companyID, "communications", targetParentID)
		} else {
			position = item.Position
		}
	}
	item.ParentFolderID = parent
	item.Position = position
	item.UpdatedTimestamp = time.Now().UTC()
	r.folders[key(companyID, item.FolderID)] = item
	return r.withSharedInboxGVICLocked(normalizeMemorySharedInboxFolder(item)), nil
}

func (r *MemoryRepo) RenameCommunicationsSharedInboxFolder(companyID, folderID, name string) (domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	name = strings.TrimSpace(name)
	if companyID == "" || folderID == "" || name == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.folders[key(companyID, folderID)]
	if !ok || item.FolderKind != "communications" {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	item.Name = name
	item.UpdatedTimestamp = time.Now().UTC()
	r.folders[key(companyID, item.FolderID)] = item
	return r.withSharedInboxGVICLocked(normalizeMemorySharedInboxFolder(item)), nil
}

func (r *MemoryRepo) DeleteCommunicationsSharedInboxFolder(companyID, folderID string) error {
	return r.deleteCommunicationsSharedInboxFolder(companyID, folderID, true)
}

func (r *MemoryRepo) RemoveCommunicationsSharedInboxFolder(companyID, folderID string) error {
	return r.deleteCommunicationsSharedInboxFolder(companyID, folderID, false)
}

func (r *MemoryRepo) deleteCommunicationsSharedInboxFolder(companyID, folderID string, deleteCompanyConnections bool) error {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" || folderID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	root, ok := r.folders[key(companyID, folderID)]
	if !ok || root.FolderKind != "communications" {
		return ErrNotFound
	}
	root = normalizeMemorySharedInboxFolder(root)
	if root.EntryType == CommunicationsSharedInboxEntryTypeSharedInbox {
		toDelete := map[string]bool{folderID: true}
		connectionID := strings.TrimSpace(root.CompanyEmailConnectionID)
		if deleteCompanyConnections && connectionID != "" {
			for _, folder := range r.folders {
				if folder.CompanyID == companyID && normalizeMemorySharedInboxFolder(folder).EntryType == CommunicationsSharedInboxEntryTypeSharedInbox && strings.TrimSpace(folder.CompanyEmailConnectionID) == connectionID {
					toDelete[folder.FolderID] = true
				}
			}
		}
		for id := range toDelete {
			delete(r.folders, key(companyID, id))
			delete(r.sharedInboxGVIC, sharedInboxGVICKey(companyID, id))

		}
		for permissionKey, permission := range r.entityPermissions {
			if permission.CompanyID == companyID && permission.EntityType == EntityTypeSharedInbox && toDelete[permission.EntityID] {
				delete(r.entityPermissions, permissionKey)
			}
		}
		if deleteCompanyConnections && connectionID != "" {
			delete(r.companyEmailConnections, companyEmailConnectionKey(companyID, connectionID))
		}
		return nil
	}
	toDelete := map[string]bool{folderID: true}
	for changed := true; changed; {
		changed = false
		for _, folder := range r.folders {
			if folder.CompanyID != companyID || folder.FolderKind != "communications" || folder.ParentFolderID == nil {
				continue
			}
			parentID := strings.TrimSpace(*folder.ParentFolderID)
			if !toDelete[parentID] || toDelete[folder.FolderID] {
				continue
			}
			if normalizeCommunicationsSharedInboxEntryType(folder.EntryType, folder.AccountEmail != nil) == CommunicationsSharedInboxEntryTypeSharedInbox {
				continue
			}
			toDelete[folder.FolderID] = true
			changed = true
		}
	}
	sharedInboxesToDelete := map[string]bool{}
	companyEmailConnectionIDs := map[string]bool{}
	now := time.Now().UTC()
	for itemKey, folder := range r.folders {
		if folder.CompanyID != companyID || folder.FolderKind != "communications" || folder.ParentFolderID == nil {
			continue
		}
		if !toDelete[strings.TrimSpace(*folder.ParentFolderID)] {
			continue
		}
		if normalizeCommunicationsSharedInboxEntryType(folder.EntryType, folder.AccountEmail != nil) != CommunicationsSharedInboxEntryTypeSharedInbox {
			continue
		}
		if deleteCompanyConnections {
			sharedInboxesToDelete[folder.FolderID] = true
			if connectionID := strings.TrimSpace(folder.CompanyEmailConnectionID); connectionID != "" {
				companyEmailConnectionIDs[connectionID] = true
			}
		} else {
			folder.ParentFolderID = nil
			folder.UpdatedTimestamp = now
			r.folders[itemKey] = folder
		}
	}
	if deleteCompanyConnections {
		for _, folder := range r.folders {
			if folder.CompanyID != companyID || normalizeMemorySharedInboxFolder(folder).EntryType != CommunicationsSharedInboxEntryTypeSharedInbox {
				continue
			}
			if companyEmailConnectionIDs[strings.TrimSpace(folder.CompanyEmailConnectionID)] {
				sharedInboxesToDelete[folder.FolderID] = true
			}
		}
	}
	for id := range toDelete {
		delete(r.folders, key(companyID, id))
		delete(r.sharedInboxGVIC, sharedInboxGVICKey(companyID, id))

	}
	for id := range sharedInboxesToDelete {
		delete(r.folders, key(companyID, id))
		delete(r.sharedInboxGVIC, sharedInboxGVICKey(companyID, id))

	}
	if deleteCompanyConnections {
		for connectionID := range companyEmailConnectionIDs {
			delete(r.companyEmailConnections, companyEmailConnectionKey(companyID, connectionID))
		}
	}
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID != companyID {
			continue
		}
		if permission.EntityType == EntityTypeSharedInboxFolder && toDelete[permission.EntityID] {
			delete(r.entityPermissions, permissionKey)
		}
		if permission.EntityType == EntityTypeSharedInbox && sharedInboxesToDelete[permission.EntityID] {
			delete(r.entityPermissions, permissionKey)
		}
	}
	return nil
}

func normalizeMemorySharedInboxFolder(folder domain.CompanyExplorerFolder) domain.CompanyExplorerFolder {
	folder.FolderKind = "communications"
	folder.ScopeType = CompanyExplorerFolderScopeCompany
	folder.DefaultAccess = defaultResourceAccessOrEdit(folder.DefaultAccess)
	folder.EntryType = normalizeCommunicationsSharedInboxEntryType(folder.EntryType, folder.AccountEmail != nil)
	if folder.EntryType == CommunicationsSharedInboxEntryTypeSharedInbox {
		folder.SharedInboxID = folder.FolderID
	} else {
		folder.SharedInboxID = ""
	}
	return folder
}
