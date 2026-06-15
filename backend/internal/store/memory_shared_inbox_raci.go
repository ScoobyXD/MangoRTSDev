package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func sortSharedInboxRaciAssignments(items []domain.SharedInboxRaciAssignment) {
	sort.Slice(items, func(i, j int) bool {
		if raciRoleSortValue(items[i].Role) != raciRoleSortValue(items[j].Role) {
			return raciRoleSortValue(items[i].Role) < raciRoleSortValue(items[j].Role)
		}
		iLabel := sharedInboxRaciAssignmentSortLabel(items[i])
		jLabel := sharedInboxRaciAssignmentSortLabel(items[j])
		if iLabel != jLabel {
			return iLabel < jLabel
		}
		if items[i].SubjectType != items[j].SubjectType {
			return items[i].SubjectType < items[j].SubjectType
		}
		if items[i].SubjectID != items[j].SubjectID {
			return items[i].SubjectID < items[j].SubjectID
		}
		return items[i].FolderID < items[j].FolderID
	})
}

func sharedInboxRaciAssignmentSortLabel(item domain.SharedInboxRaciAssignment) string {
	label := strings.ToLower(strings.TrimSpace(item.SubjectName))
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.UserDisplayName))
	}
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.UserEmail))
	}
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.SubjectID))
	}
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.UserID))
	}
	return label
}

func (r *MemoryRepo) withSharedInboxRaciLocked(folder domain.CompanyExplorerFolder) domain.CompanyExplorerFolder {
	if folder.FolderKind != "communications" {
		return folder
	}
	assignments := make([]domain.SharedInboxRaciAssignment, 0)
	accessGrants := make([]domain.EntityPermission, 0)
	seenAssignments := map[string]bool{}
	seenFolders := map[string]bool{}
	for current := folder; strings.TrimSpace(current.FolderID) != ""; {
		currentID := strings.TrimSpace(current.FolderID)
		if seenFolders[currentID] {
			break
		}
		seenFolders[currentID] = true
		for _, assignment := range r.sharedInboxRaci[sharedInboxRaciKey(folder.CompanyID, currentID)] {
			subjectType := strings.TrimSpace(assignment.SubjectType)
			subjectID := strings.TrimSpace(assignment.SubjectID)
			if subjectType == "" {
				subjectType = EntityPermissionSubjectUser
				subjectID = strings.TrimSpace(assignment.UserID)
			}
			seenKey := assignment.Role + ":" + subjectType + ":" + subjectID
			if seenAssignments[seenKey] {
				continue
			}
			seenAssignments[seenKey] = true
			assignments = append(assignments, assignment)
		}
		if current.ParentFolderID == nil || strings.TrimSpace(*current.ParentFolderID) == "" {
			break
		}
		parent, ok := r.folders[key(folder.CompanyID, strings.TrimSpace(*current.ParentFolderID))]
		if !ok || parent.FolderKind != "communications" {
			break
		}
		current = parent
	}
	for _, grant := range r.entityPermissions {
		if grant.CompanyID != folder.CompanyID || grant.EntityType != EntityTypeSharedTriageFolder || grant.EntityID != folder.FolderID || grant.SubjectType != EntityPermissionSubjectUser {
			continue
		}
		grant.Permission = OppositeResourceDefaultAccess(folder.DefaultAccess)
		grant.AccessLevel = grant.Permission
		accessGrants = append(accessGrants, r.withEntityPermissionSubjectLocked(grant))
	}
	sortSharedInboxRaciAssignments(assignments)
	sortEntityPermissions(accessGrants)
	folder.RaciAssignments = assignments
	folder.AccessGrants = accessGrants
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
		subjectType := strings.ToLower(strings.TrimSpace(assignment.SubjectType))
		subjectID := strings.TrimSpace(assignment.SubjectID)
		userID := strings.TrimSpace(assignment.UserID)
		if subjectType == "" && userID != "" {
			subjectType = EntityPermissionSubjectUser
			subjectID = userID
		}
		if subjectType == EntityPermissionSubjectUser && subjectID == "" {
			subjectID = userID
		}
		if !ok || subjectID == "" {
			return nil, ErrInvalid
		}
		seenKey := role + ":" + subjectType + ":" + subjectID
		if seen[seenKey] {
			continue
		}
		seen[seenKey] = true
		item := domain.SharedInboxRaciAssignment{
			CompanyID:        companyID,
			FolderID:         folderID,
			Role:             role,
			SubjectType:      subjectType,
			SubjectID:        subjectID,
			CreatedTimestamp: now,
		}
		switch subjectType {
		case EntityPermissionSubjectUser:
			user, ok := r.companyUserByIDLocked(companyID, subjectID)
			if !ok {
				return nil, ErrAssigneeNotInCompany
			}
			item.UserID = subjectID
			item.UserDisplayName = user.DisplayName
			item.UserEmail = user.Email
			item.SubjectName = user.DisplayName
			if item.SubjectName == "" {
				item.SubjectName = user.Email
			}
		case EntityPermissionSubjectGroup:
			group, ok := r.userGroups[key(companyID, subjectID)]
			if !ok {
				return nil, ErrAssigneeNotInCompany
			}
			item.SubjectName = group.Name
		default:
			return nil, ErrInvalid
		}
		assignments = append(assignments, item)
	}
	sortSharedInboxRaciAssignments(assignments)
	r.sharedInboxRaci[sharedInboxRaciKey(companyID, folderID)] = assignments
	next := r.withSharedInboxRaciLocked(folder).RaciAssignments
	return append([]domain.SharedInboxRaciAssignment{}, next...), nil
}
