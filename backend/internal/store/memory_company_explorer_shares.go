package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) ListCompanyExplorerFolderShares(companyID, folderID string) ([]domain.CompanyExplorerFolderShare, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" || folderID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	if _, ok := r.folders[key(companyID, folderID)]; !ok {
		return nil, ErrNotFound
	}

	items := make([]domain.CompanyExplorerFolderShare, 0)
	for _, share := range r.folderShares {
		if share.CompanyID == companyID && share.FolderID == folderID {
			items = append(items, share)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Status != items[j].Status {
			return items[i].Status < items[j].Status
		}
		return items[i].Email < items[j].Email
	})
	return items, nil
}

func (r *MemoryRepo) UpsertCompanyExplorerFolderShare(input CompanyExplorerFolderShareInput) (domain.CompanyExplorerFolderShare, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	folderID := strings.TrimSpace(input.FolderID)
	email := normalizeEmail(input.Email)
	userID := strings.TrimSpace(input.UserID)
	invitedByUserID := strings.TrimSpace(input.InvitedByUserID)
	if companyID == "" || folderID == "" || email == "" || invitedByUserID == "" {
		return domain.CompanyExplorerFolderShare{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.folders[key(companyID, folderID)]; !ok {
		return domain.CompanyExplorerFolderShare{}, ErrNotFound
	}
	if !r.userCanCreateInvitationLocked(invitedByUserID, companyID) {
		return domain.CompanyExplorerFolderShare{}, ErrInvalid
	}
	if userID != "" {
		if _, ok := r.memberships[membershipKey(companyID, userID)]; !ok {
			return domain.CompanyExplorerFolderShare{}, ErrNotFound
		}
	}

	now := time.Now().UTC()
	shareKey := folderShareKey(companyID, folderID, email)
	share := r.folderShares[shareKey]
	if share.CreatedTimestamp.IsZero() {
		share.CreatedTimestamp = now
	}
	share.CompanyID = companyID
	share.FolderID = folderID
	share.Email = email
	share.Status = "pending"
	share.UserID = nil
	if userID != "" {
		share.UserID = &userID
		share.Status = "active"
	}
	share.InvitedByUserID = invitedByUserID
	share.UpdatedTimestamp = now
	r.folderShares[shareKey] = share
	return share, nil
}

func (r *MemoryRepo) DeleteCompanyExplorerFolderShare(companyID, folderID, email string) error {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	email = normalizeEmail(email)
	if companyID == "" || folderID == "" || email == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	shareKey := folderShareKey(companyID, folderID, email)
	if _, ok := r.folderShares[shareKey]; !ok {
		return ErrNotFound
	}
	delete(r.folderShares, shareKey)
	return nil
}
