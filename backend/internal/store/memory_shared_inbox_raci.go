package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *MemoryRepo) withSharedInboxRaciLocked(folder domain.CompanyExplorerFolder) domain.CompanyExplorerFolder {
	if folder.FolderKind != "communications" {
		return folder
	}
	folder = normalizeMemorySharedInboxFolder(folder)
	assignments := make([]domain.SharedInboxRaciAssignment, 0)
	accessGrants := make([]domain.EntityPermission, 0)
	if folder.EntryType == CommunicationsSharedInboxEntryTypeSharedInbox {
		seenAssignments := map[string]bool{}
		for _, assignment := range r.sharedInboxRaci[sharedInboxRaciKey(folder.CompanyID, folder.FolderID)] {
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
			assignment.SharedInboxID = folder.FolderID
			assignments = append(assignments, assignment)
		}
	}
	resourceType := CommunicationsSharedInboxResourceType(folder)
	for _, grant := range r.entityPermissions {
		if grant.CompanyID != folder.CompanyID || grant.EntityType != resourceType || grant.EntityID != folder.FolderID || grant.SubjectType != EntityPermissionSubjectUser {
			continue
		}
		grant.Permission = OppositeResourceDefaultAccess(folder.DefaultAccess)
		grant.AccessLevel = grant.Permission
		accessGrants = append(accessGrants, r.withEntityPermissionSubjectLocked(grant))
	}
	sortSharedInboxRaciAssignments(assignments)
	sortEntityPermissions(accessGrants)
	folder.RaciAssignments = assignments
	gvicResourceType := CommunicationsSharedInboxGVICResourceType(folder)
	folder.GVICAssignments = r.gvicAssignmentsForResourceLocked(folder.CompanyID, gvicResourceType, folder.FolderID)
	if len(folder.GVICAssignments) == 0 {
		fallbackResourceType := EntityTypeSharedInbox
		if gvicResourceType == EntityTypeSharedInbox {
			fallbackResourceType = EntityTypeSharedTriageFolder
		}
		folder.GVICAssignments = r.gvicAssignmentsForResourceLocked(folder.CompanyID, fallbackResourceType, folder.FolderID)
	}
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
	folder = normalizeMemorySharedInboxFolder(folder)
	if folder.FolderKind != "communications" || folder.EntryType != CommunicationsSharedInboxEntryTypeSharedInbox {
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
			SharedInboxID:    folderID,
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
