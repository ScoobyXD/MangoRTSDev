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
	if accountEmail != "" {
		if !r.companyHasConnectedEmailAccountLocked(companyID, accountEmail) {
			return domain.CompanyExplorerFolder{}, ErrEmailAccountUnavailable
		}
		entryType = CommunicationsSharedInboxEntryTypeSharedInbox
		accountEmailPtr = &accountEmail
	}

	now := time.Now().UTC()
	item := domain.CompanyExplorerFolder{
		CompanyID:        companyID,
		FolderID:         newUUIDv7String(),
		ParentFolderID:   parent,
		FolderKind:       "communications",
		EntryType:        entryType,
		Name:             name,
		DefaultAccess:    ResourceDefaultAccessEdit,
		AccountEmail:     accountEmailPtr,
		ScopeType:        CompanyExplorerFolderScopeCompany,
		Position:         nextCompanyExplorerFolderPosition(r.folders, companyID, "communications", parentFolderID),
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.folders[key(companyID, item.FolderID)] = item
	return r.withSharedInboxRaciLocked(item), nil
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
		items = append(items, r.withSharedInboxRaciLocked(normalizeMemorySharedInboxFolder(folder)))
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
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeSharedTriageFolder, folder.FolderID, EntityPermissionView) {
			continue
		}
		item := r.withSharedInboxRaciLocked(normalizeMemorySharedInboxFolder(folder))
		item.EffectiveAccess = r.effectiveAccessLevelLocked(companyID, userID, EntityTypeSharedTriageFolder, folder.FolderID, EntityPermissionView)
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
	return r.withSharedInboxRaciLocked(normalizeMemorySharedInboxFolder(item)), nil
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
	return r.withSharedInboxRaciLocked(normalizeMemorySharedInboxFolder(item)), nil
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
	return r.withSharedInboxRaciLocked(normalizeMemorySharedInboxFolder(item)), nil
}

func (r *MemoryRepo) DeleteCommunicationsSharedInboxFolder(companyID, folderID string) error {
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
	toDelete := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, folderID, "communications")
	for id := range toDelete {
		delete(r.folders, key(companyID, id))
		delete(r.sharedInboxRaci, sharedInboxRaciKey(companyID, id))
		if err := r.deleteEffectiveFactsForResourceLocked(companyID, EntityTypeSharedTriageFolder, id); err != nil {
			return err
		}
	}
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.EntityType == EntityTypeSharedTriageFolder && toDelete[permission.EntityID] {
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
	return folder
}
