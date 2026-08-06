package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

func sortSharedInboxGVICAssignments(items []domain.SharedInboxGVICAssignment) {
	sort.Slice(items, func(i, j int) bool {
		if GVICRoleSortValue(items[i].Role) != GVICRoleSortValue(items[j].Role) {
			return GVICRoleSortValue(items[i].Role) < GVICRoleSortValue(items[j].Role)
		}
		iLabel := sharedInboxGVICAssignmentSortLabel(items[i])
		jLabel := sharedInboxGVICAssignmentSortLabel(items[j])
		if iLabel != jLabel {
			return iLabel < jLabel
		}
		if items[i].PrincipalType != items[j].PrincipalType {
			return items[i].PrincipalType < items[j].PrincipalType
		}
		if items[i].PrincipalID != items[j].PrincipalID {
			return items[i].PrincipalID < items[j].PrincipalID
		}
		return items[i].FolderID < items[j].FolderID
	})
}

func sharedInboxGVICAssignmentSortLabel(item domain.SharedInboxGVICAssignment) string {
	label := strings.ToLower(strings.TrimSpace(item.PrincipalName))
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.UserDisplayName))
	}
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.UserEmail))
	}
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.PrincipalID))
	}
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.UserID))
	}
	return label
}

func appendSharedInboxGVICAssignment(assignmentsByInbox map[string][]domain.SharedInboxGVICAssignment, item domain.SharedInboxGVICAssignment) {
	principalType := strings.TrimSpace(item.PrincipalType)
	principalID := strings.TrimSpace(item.PrincipalID)
	if principalType == "" {
		principalType = EntityPermissionSubjectUser
		principalID = strings.TrimSpace(item.UserID)
	}
	if principalType == EntityPermissionSubjectUser && principalID == "" {
		principalID = strings.TrimSpace(item.UserID)
	}
	if item.FolderID == "" || item.Role == "" || principalID == "" {
		return
	}
	item.PrincipalType = principalType
	item.PrincipalID = principalID
	item.SharedInboxID = item.FolderID
	for _, existing := range assignmentsByInbox[item.FolderID] {
		existingPrincipalType := strings.TrimSpace(existing.PrincipalType)
		existingPrincipalID := strings.TrimSpace(existing.PrincipalID)
		if existingPrincipalType == "" {
			existingPrincipalType = EntityPermissionSubjectUser
			existingPrincipalID = strings.TrimSpace(existing.UserID)
		}
		if existing.Role == item.Role && existingPrincipalType == principalType && existingPrincipalID == principalID {
			return
		}
	}
	assignmentsByInbox[item.FolderID] = append(assignmentsByInbox[item.FolderID], item)
}

func (r *PostgresRepo) listCommunicationsSharedInboxGVICAssignments(ctx context.Context, companyID string, sharedInboxIDs []string) (map[string][]domain.SharedInboxGVICAssignment, error) {
	assignmentsByInbox := map[string][]domain.SharedInboxGVICAssignment{}
	if len(sharedInboxIDs) == 0 {
		return assignmentsByInbox, nil
	}
	idList := strings.Join(sharedInboxIDs, ",")
	genericRows, err := r.db.QueryContext(ctx, `
select
  assignment.company_id::text,
  assignment.resource_id::text,
  assignment.role,
  assignment.principal_type,
  assignment.principal_id::text,
  coalesce(nullif(user_group.name, ''), nullif(app_user.display_name, ''), nullif(app_user.email, '')),
  coalesce(app_user.user_id::text, ''),
  nullif(app_user.display_name, ''),
  nullif(app_user.email, ''),
  assignment.created_timestamp
from resource_gvic_assignments assignment
left join company_memberships membership
  on assignment.principal_type = 'user'
 and membership.company_id = assignment.company_id
 and membership.user_id = assignment.principal_id
left join users app_user
  on assignment.principal_type = 'user'
 and app_user.user_id = assignment.principal_id
left join company_user_groups user_group
  on assignment.principal_type = 'group'
 and user_group.company_id = assignment.company_id
 and user_group.group_id = assignment.principal_id
where assignment.company_id = $1::uuid
  and assignment.resource_type = $3
  and assignment.resource_id = any(string_to_array($2, ',')::uuid[])
  and (
    (assignment.principal_type = 'user' and membership.user_id is not null)
    or (assignment.principal_type = 'group' and user_group.group_id is not null)
  )
order by assignment.resource_id::text asc,
  case assignment.role
    when 'generated' then 1
    when 'verified' then 2
    when 'consulted' then 3
    when 'informed' then 4
    else 5
  end,
  assignment.principal_type asc,
  lower(coalesce(nullif(user_group.name, ''), nullif(app_user.display_name, ''), nullif(app_user.email, ''), assignment.principal_id::text)) asc,
  assignment.principal_id::text asc`,
		companyID, idList, EntityTypeSharedInbox,
	)
	if err != nil {
		if isPostgresUndefinedTable(err, "resource_gvic_assignments") || isPostgresUndefinedColumn(err, "") || isPostgresInvalidTextRepresentation(err) {
			return nil, ErrGVICStorageUnavailable
		}
		return nil, err
	}
	defer genericRows.Close()
	for genericRows.Next() {
		var item domain.SharedInboxGVICAssignment
		var principalName sql.NullString
		var displayName sql.NullString
		var email sql.NullString
		if err := genericRows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&item.Role,
			&item.PrincipalType,
			&item.PrincipalID,
			&principalName,
			&item.UserID,
			&displayName,
			&email,
			&item.CreatedTimestamp,
		); err != nil {
			return nil, err
		}
		if principalName.Valid {
			item.PrincipalName = principalName.String
		}
		if displayName.Valid {
			item.UserDisplayName = displayName.String
		}
		if email.Valid {
			item.UserEmail = email.String
		}
		if item.PrincipalType == EntityPermissionSubjectUser {
			if item.UserID == "" {
				item.UserID = item.PrincipalID
			}
			if item.PrincipalName == "" {
				item.PrincipalName = item.UserDisplayName
			}
			if item.PrincipalName == "" {
				item.PrincipalName = item.UserEmail
			}
		}
		appendSharedInboxGVICAssignment(assignmentsByInbox, item)
	}
	if err := genericRows.Err(); err != nil {
		return nil, err
	}
	for inboxID := range assignmentsByInbox {
		sortSharedInboxGVICAssignments(assignmentsByInbox[inboxID])
	}
	return assignmentsByInbox, nil
}

func (r *PostgresRepo) attachCommunicationsSharedInboxGVICAssignments(ctx context.Context, companyID string, folders []domain.CompanyExplorerFolder) ([]domain.CompanyExplorerFolder, error) {
	ids := make([]string, 0, len(folders))
	for _, folder := range folders {
		if folder.FolderKind == "communications" && normalizeCommunicationsSharedInboxEntryType(folder.EntryType, folder.AccountEmail != nil || folder.SharedInboxID != "") == CommunicationsSharedInboxEntryTypeSharedInbox {
			ids = append(ids, folder.FolderID)
		}
	}
	assignments, err := r.listCommunicationsSharedInboxGVICAssignments(ctx, companyID, ids)
	if err != nil {
		return nil, err
	}
	for index := range folders {
		if folders[index].FolderKind != "communications" {
			continue
		}
		if normalizeCommunicationsSharedInboxEntryType(folders[index].EntryType, folders[index].AccountEmail != nil || folders[index].SharedInboxID != "") == CommunicationsSharedInboxEntryTypeSharedInbox {
			folders[index].GVICAssignments = assignments[folders[index].FolderID]
		}
		gvicResourceType := CommunicationsSharedInboxGVICResourceType(folders[index])
		policy, err := r.GetResourceGVICPolicy(companyID, gvicResourceType, folders[index].FolderID)
		if err != nil {
			return nil, err
		}
		gvicAssignments := make([]domain.ResourceGVICAssignment, 0, len(policy.EffectiveAssignments))
		for _, effective := range policy.EffectiveAssignments {
			gvicAssignments = append(gvicAssignments, domain.ResourceGVICAssignment{
				Role: effective.Role, PrincipalType: EntityPermissionSubjectUser, PrincipalID: effective.UserID,
			})
		}
		folders[index].GVICAssignments = sharedInboxGVICAssignmentsFromResources(gvicAssignments, folders[index].FolderID)
	}
	return folders, nil
}

func (r *PostgresRepo) SetCommunicationsSharedInboxGVICAssignments(input SharedInboxGVICAssignmentUpdateInput) ([]domain.SharedInboxGVICAssignment, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	sharedInboxID := strings.TrimSpace(input.FolderID)
	if companyID == "" || sharedInboxID == "" {
		return nil, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var exists bool
	if err := tx.QueryRowContext(ctx,
		`select exists(select 1 from shared_inboxes where company_id=$1::uuid and shared_inbox_id=$2::uuid)`,
		companyID, sharedInboxID,
	).Scan(&exists); err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return nil, ErrSharedInboxStorageUnavailable
		}
		return nil, err
	}
	if !exists {
		if folderExists, err := postgresTxExists(ctx, tx, `select exists(select 1 from shared_inbox_folders where company_id=$1::uuid and folder_id=$2::uuid)`, companyID, sharedInboxID); err != nil {
			return nil, err
		} else if folderExists {
			return nil, ErrInvalid
		}
		return nil, ErrNotFound
	}

	type normalizedAssignment struct {
		role          string
		principalType string
		principalID   string
	}
	normalized := make([]normalizedAssignment, 0, len(input.Assignments))
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
		key := role + ":" + principalType + ":" + principalID
		if seen[key] {
			continue
		}
		seen[key] = true

		switch principalType {
		case EntityPermissionSubjectUser:
			var userInCompany bool
			if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_memberships
  where company_id=$1::uuid and user_id=$2::uuid
)`, companyID, principalID).Scan(&userInCompany); err != nil {
				return nil, err
			}
			if !userInCompany {
				return nil, ErrPrincipalNotInCompany
			}
		case EntityPermissionSubjectGroup:
			var groupInCompany bool
			if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_user_groups
  where company_id=$1::uuid and group_id=$2::uuid
)`, companyID, principalID).Scan(&groupInCompany); err != nil {
				return nil, err
			}
			if !groupInCompany {
				return nil, ErrPrincipalNotInCompany
			}
		default:
			return nil, ErrInvalid
		}
		normalized = append(normalized, normalizedAssignment{role: role, principalType: principalType, principalID: principalID})
	}

	if _, err := tx.ExecContext(ctx, `
delete from resource_gvic_assignments
where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`,
		companyID, EntityTypeSharedInbox, sharedInboxID,
	); err != nil {
		if isPostgresUndefinedTable(err, "resource_gvic_assignments") {
			return nil, ErrGVICStorageUnavailable
		}
		return nil, err
	}
	for _, assignment := range normalized {
		if _, err := tx.ExecContext(ctx, `
insert into resource_gvic_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  principal_type,
  principal_id,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, $2, $3::uuid, $4, $5, $6::uuid, now(), now())
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id) do nothing`,
			companyID, EntityTypeSharedInbox, sharedInboxID, assignment.role, assignment.principalType, assignment.principalID,
		); err != nil {
			if isPostgresUndefinedTable(err, "resource_gvic_assignments") {
				return nil, ErrGVICStorageUnavailable
			}
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	folders, err := r.ListCommunicationsSharedInboxFolders(companyID)
	if err != nil {
		return nil, err
	}
	for _, folder := range folders {
		if folder.FolderID == sharedInboxID {
			return folder.GVICAssignments, nil
		}
	}
	return []domain.SharedInboxGVICAssignment{}, nil
}
