package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func sortSharedInboxRaciAssignments(items []domain.SharedInboxRaciAssignment) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].FolderID != items[j].FolderID {
			return items[i].FolderID < items[j].FolderID
		}
		if raciRoleSortValue(items[i].Role) != raciRoleSortValue(items[j].Role) {
			return raciRoleSortValue(items[i].Role) < raciRoleSortValue(items[j].Role)
		}
		iLabel := strings.ToLower(strings.TrimSpace(items[i].UserDisplayName))
		if iLabel == "" {
			iLabel = strings.ToLower(strings.TrimSpace(items[i].UserEmail))
		}
		if iLabel == "" {
			iLabel = items[i].UserID
		}
		jLabel := strings.ToLower(strings.TrimSpace(items[j].UserDisplayName))
		if jLabel == "" {
			jLabel = strings.ToLower(strings.TrimSpace(items[j].UserEmail))
		}
		if jLabel == "" {
			jLabel = items[j].UserID
		}
		if iLabel != jLabel {
			return iLabel < jLabel
		}
		return items[i].UserID < items[j].UserID
	})
}

func (r *MemoryRepo) withSharedInboxRaciLocked(folder domain.CompanyExplorerFolder) domain.CompanyExplorerFolder {
	if folder.FolderKind != "communications" {
		return folder
	}
	assignments := append([]domain.SharedInboxRaciAssignment{}, r.sharedInboxRaci[sharedInboxRaciKey(folder.CompanyID, folder.FolderID)]...)
	sortSharedInboxRaciAssignments(assignments)
	folder.RaciAssignments = assignments
	return folder
}

func (r *MemoryRepo) SetCommunicationsSharedInboxRaciAssignments(input SharedInboxRaciAssignmentUpdateInput) ([]domain.SharedInboxRaciAssignment, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	folderID := strings.TrimSpace(input.FolderID)
	if companyID == "" || folderID == "" {
		return nil, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	folder, ok := r.folders[key(companyID, folderID)]
	if !ok {
		return nil, ErrNotFound
	}
	if folder.FolderKind != "communications" {
		return nil, ErrInvalid
	}

	now := time.Now().UTC()
	assignments := make([]domain.SharedInboxRaciAssignment, 0, len(input.Assignments))
	seen := map[string]bool{}
	for _, assignment := range input.Assignments {
		role, ok := NormalizeLogicGateRaciRole(assignment.Role)
		userID := strings.TrimSpace(assignment.UserID)
		if !ok || userID == "" {
			return nil, ErrInvalid
		}
		seenKey := role + ":" + userID
		if seen[seenKey] {
			continue
		}
		seen[seenKey] = true
		user, ok := r.companyUserByIDLocked(companyID, userID)
		if !ok {
			return nil, ErrAssigneeNotInCompany
		}
		assignments = append(assignments, domain.SharedInboxRaciAssignment{
			CompanyID:        companyID,
			FolderID:         folderID,
			Role:             role,
			UserID:           userID,
			UserDisplayName:  user.DisplayName,
			UserEmail:        user.Email,
			CreatedTimestamp: now,
		})
	}
	sortSharedInboxRaciAssignments(assignments)
	r.sharedInboxRaci[sharedInboxRaciKey(companyID, folderID)] = assignments
	return append([]domain.SharedInboxRaciAssignment{}, assignments...), nil
}
