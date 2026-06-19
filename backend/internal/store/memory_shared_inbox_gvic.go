package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *MemoryRepo) withSharedInboxGVICLocked(folder domain.CompanyExplorerFolder) domain.CompanyExplorerFolder {
	if folder.FolderKind != "communications" {
		return folder
	}
	folder = normalizeMemorySharedInboxFolder(folder)
	assignments := make([]domain.SharedInboxGVICAssignment, 0)
	accessGrants := make([]domain.EntityPermission, 0)
	if folder.EntryType == CommunicationsSharedInboxEntryTypeSharedInbox {
		seenAssignments := map[string]bool{}
		for _, assignment := range r.sharedInboxGVIC[sharedInboxGVICKey(folder.CompanyID, folder.FolderID)] {
			principalType := strings.TrimSpace(assignment.PrincipalType)
			principalID := strings.TrimSpace(assignment.PrincipalID)
			if principalType == "" {
				principalType = EntityPermissionSubjectUser
				principalID = strings.TrimSpace(assignment.UserID)
			}
			seenKey := assignment.Role + ":" + principalType + ":" + principalID
			if seenAssignments[seenKey] {
				continue
			}
			seenAssignments[seenKey] = true
			assignment.SharedInboxID = folder.FolderID
			assignment.PrincipalType = principalType
			assignment.PrincipalID = principalID
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
	sortSharedInboxGVICAssignments(assignments)
	sortEntityPermissions(accessGrants)
	gvicResourceType := CommunicationsSharedInboxGVICResourceType(folder)
	resourceAssignments := r.gvicAssignmentsForResourceLocked(folder.CompanyID, gvicResourceType, folder.FolderID)
	if len(resourceAssignments) == 0 {
		fallbackResourceType := EntityTypeSharedInbox
		if gvicResourceType == EntityTypeSharedInbox {
			fallbackResourceType = EntityTypeSharedTriageFolder
		}
		resourceAssignments = r.gvicAssignmentsForResourceLocked(folder.CompanyID, fallbackResourceType, folder.FolderID)
	}
	if len(resourceAssignments) > 0 {
		assignments = sharedInboxGVICAssignmentsFromResources(resourceAssignments, folder.FolderID)
	}
	folder.GVICAssignments = assignments
	folder.AccessGrants = accessGrants
	return folder
}

func (r *MemoryRepo) SetCommunicationsSharedInboxGVICAssignments(input SharedInboxGVICAssignmentUpdateInput) ([]domain.SharedInboxGVICAssignment, error) {
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
	assignments := make([]domain.SharedInboxGVICAssignment, 0, len(input.Assignments))
	seen := map[string]bool{}
	for _, assignment := range input.Assignments {
		role, ok := NormalizeGVICRole(assignment.Role)
		principalType := strings.ToLower(strings.TrimSpace(assignment.PrincipalType))
		principalID := strings.TrimSpace(assignment.PrincipalID)
		userID := strings.TrimSpace(assignment.UserID)
		if principalType == "" && userID != "" {
			principalType = EntityPermissionSubjectUser
			principalID = userID
		}
		if principalType == EntityPermissionSubjectUser && principalID == "" {
			principalID = userID
		}
		if !ok || principalID == "" {
			return nil, ErrInvalid
		}
		seenKey := role + ":" + principalType + ":" + principalID
		if seen[seenKey] {
			continue
		}
		seen[seenKey] = true
		item := domain.SharedInboxGVICAssignment{
			CompanyID:        companyID,
			FolderID:         folderID,
			SharedInboxID:    folderID,
			Role:             role,
			PrincipalType:    principalType,
			PrincipalID:      principalID,
			CreatedTimestamp: now,
		}
		switch principalType {
		case EntityPermissionSubjectUser:
			user, ok := r.companyUserByIDLocked(companyID, principalID)
			if !ok {
				return nil, ErrPrincipalNotInCompany
			}
			item.UserID = principalID
			item.UserDisplayName = user.DisplayName
			item.UserEmail = user.Email
			item.PrincipalName = user.DisplayName
			if item.PrincipalName == "" {
				item.PrincipalName = user.Email
			}
		case EntityPermissionSubjectGroup:
			group, ok := r.userGroups[key(companyID, principalID)]
			if !ok {
				return nil, ErrPrincipalNotInCompany
			}
			item.PrincipalName = group.Name
		default:
			return nil, ErrInvalid
		}
		assignments = append(assignments, item)
	}
	sortSharedInboxGVICAssignments(assignments)
	r.sharedInboxGVIC[sharedInboxGVICKey(companyID, folderID)] = assignments
	next := r.withSharedInboxGVICLocked(folder).GVICAssignments
	return append([]domain.SharedInboxGVICAssignment{}, next...), nil
}
