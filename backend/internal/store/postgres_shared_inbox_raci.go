package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
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

func appendSharedInboxRaciAssignment(assignmentsByInbox map[string][]domain.SharedInboxRaciAssignment, item domain.SharedInboxRaciAssignment) {
	subjectType := strings.TrimSpace(item.SubjectType)
	subjectID := strings.TrimSpace(item.SubjectID)
	if subjectType == "" {
		subjectType = EntityPermissionSubjectUser
		subjectID = strings.TrimSpace(item.UserID)
	}
	if subjectType == EntityPermissionSubjectUser && subjectID == "" {
		subjectID = strings.TrimSpace(item.UserID)
	}
	if item.FolderID == "" || item.Role == "" || subjectID == "" {
		return
	}
	item.SubjectType = subjectType
	item.SubjectID = subjectID
	item.SharedInboxID = item.FolderID
	for _, existing := range assignmentsByInbox[item.FolderID] {
		existingSubjectType := strings.TrimSpace(existing.SubjectType)
		existingSubjectID := strings.TrimSpace(existing.SubjectID)
		if existingSubjectType == "" {
			existingSubjectType = EntityPermissionSubjectUser
			existingSubjectID = strings.TrimSpace(existing.UserID)
		}
		if existing.Role == item.Role && existingSubjectType == subjectType && existingSubjectID == subjectID {
			return
		}
	}
	assignmentsByInbox[item.FolderID] = append(assignmentsByInbox[item.FolderID], item)
}

func (r *PostgresRepo) listCommunicationsSharedInboxRaciAssignments(ctx context.Context, companyID string, sharedInboxIDs []string) (map[string][]domain.SharedInboxRaciAssignment, error) {
	assignmentsByInbox := map[string][]domain.SharedInboxRaciAssignment{}
	if len(sharedInboxIDs) == 0 {
		return assignmentsByInbox, nil
	}
	idList := strings.Join(sharedInboxIDs, ",")
	genericRows, err := r.db.QueryContext(ctx, `
select
  assignment.company_id::text,
  assignment.resource_id::text,
  assignment.role,
  assignment.subject_type,
  assignment.subject_id::text,
  coalesce(nullif(user_group.name, ''), nullif(app_user.display_name, ''), nullif(app_user.email, '')),
  coalesce(app_user.user_id::text, ''),
  nullif(app_user.display_name, ''),
  nullif(app_user.email, ''),
  assignment.created_timestamp
from resource_raci_assignments assignment
left join company_memberships membership
  on assignment.subject_type = 'user'
 and membership.company_id = assignment.company_id
 and membership.user_id = assignment.subject_id
left join users app_user
  on assignment.subject_type = 'user'
 and app_user.user_id = assignment.subject_id
left join company_user_groups user_group
  on assignment.subject_type = 'group'
 and user_group.company_id = assignment.company_id
 and user_group.group_id = assignment.subject_id
where assignment.company_id = $1::uuid
  and assignment.resource_type = $3
  and assignment.resource_id = any(string_to_array($2, ',')::uuid[])
  and (
    (assignment.subject_type = 'user' and membership.user_id is not null)
    or (assignment.subject_type = 'group' and user_group.group_id is not null)
  )
order by assignment.resource_id::text asc,
  case assignment.role
    when 'responsible' then 1
    when 'accountable' then 2
    when 'consulted' then 3
    when 'informed' then 4
    else 5
  end,
  assignment.subject_type asc,
  lower(coalesce(nullif(user_group.name, ''), nullif(app_user.display_name, ''), nullif(app_user.email, ''), assignment.subject_id::text)) asc,
  assignment.subject_id::text asc`,
		companyID, idList, EntityTypeSharedInbox,
	)
	if err != nil {
		if !isPostgresUndefinedTable(err, "resource_raci_assignments") && !isPostgresUndefinedColumn(err, "") && !isPostgresInvalidTextRepresentation(err) {
			return nil, err
		}
	} else {
		defer genericRows.Close()
		for genericRows.Next() {
			var item domain.SharedInboxRaciAssignment
			var subjectName sql.NullString
			var displayName sql.NullString
			var email sql.NullString
			if err := genericRows.Scan(
				&item.CompanyID,
				&item.FolderID,
				&item.Role,
				&item.SubjectType,
				&item.SubjectID,
				&subjectName,
				&item.UserID,
				&displayName,
				&email,
				&item.CreatedTimestamp,
			); err != nil {
				return nil, err
			}
			if subjectName.Valid {
				item.SubjectName = subjectName.String
			}
			if displayName.Valid {
				item.UserDisplayName = displayName.String
			}
			if email.Valid {
				item.UserEmail = email.String
			}
			if item.SubjectType == EntityPermissionSubjectUser {
				if item.UserID == "" {
					item.UserID = item.SubjectID
				}
				if item.SubjectName == "" {
					item.SubjectName = item.UserDisplayName
				}
				if item.SubjectName == "" {
					item.SubjectName = item.UserEmail
				}
			}
			appendSharedInboxRaciAssignment(assignmentsByInbox, item)
		}
		if err := genericRows.Err(); err != nil {
			return nil, err
		}
	}
	rows, err := r.db.QueryContext(ctx, `
select
  assignment.company_id::text,
  assignment.shared_inbox_id::text,
  assignment.role,
  assignment.user_id::text,
  nullif(app_user.display_name, ''),
  nullif(app_user.email, ''),
  assignment.created_timestamp
from shared_inbox_raci_assignments assignment
join company_memberships membership
  on membership.company_id = assignment.company_id
 and membership.user_id = assignment.user_id
join users app_user
  on app_user.user_id = assignment.user_id
where assignment.company_id = $1::uuid
  and assignment.shared_inbox_id = any(string_to_array($2, ',')::uuid[])
order by assignment.shared_inbox_id::text asc,
  case assignment.role
    when 'responsible' then 1
    when 'accountable' then 2
    when 'consulted' then 3
    when 'informed' then 4
    else 5
  end,
  lower(coalesce(nullif(app_user.display_name, ''), nullif(app_user.email, ''), assignment.user_id::text)) asc,
  assignment.user_id::text asc`,
		companyID, idList,
	)
	if err != nil {
		if isPostgresUndefinedTable(err, "shared_inbox_raci_assignments") || isPostgresUndefinedColumn(err, "") || isPostgresInvalidTextRepresentation(err) {
			for inboxID := range assignmentsByInbox {
				sortSharedInboxRaciAssignments(assignmentsByInbox[inboxID])
			}
			return assignmentsByInbox, nil
		}
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item domain.SharedInboxRaciAssignment
		var displayName sql.NullString
		var email sql.NullString
		if err := rows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&item.Role,
			&item.UserID,
			&displayName,
			&email,
			&item.CreatedTimestamp,
		); err != nil {
			return nil, err
		}
		if displayName.Valid {
			item.UserDisplayName = displayName.String
		}
		if email.Valid {
			item.UserEmail = email.String
		}
		item.SubjectType = EntityPermissionSubjectUser
		item.SubjectID = item.UserID
		item.SubjectName = item.UserDisplayName
		if item.SubjectName == "" {
			item.SubjectName = item.UserEmail
		}
		appendSharedInboxRaciAssignment(assignmentsByInbox, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	groupRows, err := r.db.QueryContext(ctx, `
select
  assignment.company_id::text,
  assignment.shared_inbox_id::text,
  assignment.role,
  assignment.group_id::text,
  user_group.name,
  assignment.created_timestamp
from shared_inbox_raci_group_assignments assignment
join company_user_groups user_group
  on user_group.company_id = assignment.company_id
 and user_group.group_id = assignment.group_id
where assignment.company_id = $1::uuid
  and assignment.shared_inbox_id = any(string_to_array($2, ',')::uuid[])
order by assignment.shared_inbox_id::text asc,
  case assignment.role
    when 'responsible' then 1
    when 'accountable' then 2
    when 'consulted' then 3
    when 'informed' then 4
    else 5
  end,
  lower(user_group.name) asc,
  assignment.group_id::text asc`,
		companyID, idList,
	)
	if err != nil {
		if isPostgresUndefinedTable(err, "shared_inbox_raci_group_assignments") || isPostgresInvalidTextRepresentation(err) {
			for inboxID := range assignmentsByInbox {
				sortSharedInboxRaciAssignments(assignmentsByInbox[inboxID])
			}
			return assignmentsByInbox, nil
		}
		return nil, err
	}
	defer groupRows.Close()
	for groupRows.Next() {
		var item domain.SharedInboxRaciAssignment
		err := groupRows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&item.Role,
			&item.SubjectID,
			&item.SubjectName,
			&item.CreatedTimestamp,
		)
		if err != nil {
			return nil, err
		}
		item.SubjectType = EntityPermissionSubjectGroup
		appendSharedInboxRaciAssignment(assignmentsByInbox, item)
	}
	if err := groupRows.Err(); err != nil {
		return nil, err
	}
	for inboxID := range assignmentsByInbox {
		sortSharedInboxRaciAssignments(assignmentsByInbox[inboxID])
	}
	return assignmentsByInbox, nil
}

func (r *PostgresRepo) attachCommunicationsSharedInboxRaciAssignments(ctx context.Context, companyID string, folders []domain.CompanyExplorerFolder) ([]domain.CompanyExplorerFolder, error) {
	ids := make([]string, 0, len(folders))
	for _, folder := range folders {
		if folder.FolderKind == "communications" && normalizeCommunicationsSharedInboxEntryType(folder.EntryType, folder.AccountEmail != nil || folder.SharedInboxID != "") == CommunicationsSharedInboxEntryTypeSharedInbox {
			ids = append(ids, folder.FolderID)
		}
	}
	assignments, err := r.listCommunicationsSharedInboxRaciAssignments(ctx, companyID, ids)
	if err != nil {
		return nil, err
	}
	for index := range folders {
		if folders[index].FolderKind != "communications" || normalizeCommunicationsSharedInboxEntryType(folders[index].EntryType, folders[index].AccountEmail != nil || folders[index].SharedInboxID != "") != CommunicationsSharedInboxEntryTypeSharedInbox {
			continue
		}
		folders[index].RaciAssignments = assignments[folders[index].FolderID]
	}
	return folders, nil
}

func (r *PostgresRepo) SetCommunicationsSharedInboxRaciAssignments(input SharedInboxRaciAssignmentUpdateInput) ([]domain.SharedInboxRaciAssignment, error) {
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
		role        string
		subjectType string
		subjectID   string
	}
	normalized := make([]normalizedAssignment, 0, len(input.Assignments))
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
		key := role + ":" + subjectType + ":" + subjectID
		if seen[key] {
			continue
		}
		seen[key] = true

		switch subjectType {
		case EntityPermissionSubjectUser:
			var userInCompany bool
			if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_memberships
  where company_id=$1::uuid and user_id=$2::uuid
)`, companyID, subjectID).Scan(&userInCompany); err != nil {
				return nil, err
			}
			if !userInCompany {
				return nil, ErrAssigneeNotInCompany
			}
		case EntityPermissionSubjectGroup:
			var groupInCompany bool
			if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_user_groups
  where company_id=$1::uuid and group_id=$2::uuid
)`, companyID, subjectID).Scan(&groupInCompany); err != nil {
				return nil, err
			}
			if !groupInCompany {
				return nil, ErrAssigneeNotInCompany
			}
		default:
			return nil, ErrInvalid
		}
		normalized = append(normalized, normalizedAssignment{role: role, subjectType: subjectType, subjectID: subjectID})
	}

	if _, err := tx.ExecContext(ctx, `
delete from resource_raci_assignments
where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`,
		companyID, EntityTypeSharedInbox, sharedInboxID,
	); err != nil {
		if isPostgresUndefinedTable(err, "resource_raci_assignments") {
			return nil, ErrRaciStorageUnavailable
		}
		return nil, err
	}
	for _, assignment := range normalized {
		if _, err := tx.ExecContext(ctx, `
insert into resource_raci_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  subject_type,
  subject_id,
  created_timestamp
) values ($1::uuid, $2, $3::uuid, $4, $5, $6::uuid, now())
on conflict (company_id, resource_type, resource_id, role, subject_type, subject_id) do nothing`,
			companyID, EntityTypeSharedInbox, sharedInboxID, assignment.role, assignment.subjectType, assignment.subjectID,
		); err != nil {
			if isPostgresUndefinedTable(err, "resource_raci_assignments") {
				return nil, ErrRaciStorageUnavailable
			}
			return nil, err
		}
	}

	legacyUserAssignmentsAvailable := true
	if _, err := tx.ExecContext(ctx,
		`delete from shared_inbox_raci_assignments where company_id=$1::uuid and shared_inbox_id=$2::uuid`,
		companyID, sharedInboxID,
	); err != nil {
		if isPostgresUndefinedTable(err, "shared_inbox_raci_assignments") {
			legacyUserAssignmentsAvailable = false
		} else {
			return nil, err
		}
	}
	legacyGroupAssignmentsAvailable := true
	if _, err := tx.ExecContext(ctx,
		`delete from shared_inbox_raci_group_assignments where company_id=$1::uuid and shared_inbox_id=$2::uuid`,
		companyID, sharedInboxID,
	); err != nil {
		if isPostgresUndefinedTable(err, "shared_inbox_raci_group_assignments") {
			legacyGroupAssignmentsAvailable = false
		} else {
			return nil, err
		}
	}
	for _, assignment := range normalized {
		if assignment.subjectType == EntityPermissionSubjectGroup {
			if !legacyGroupAssignmentsAvailable {
				continue
			}
			if _, err := tx.ExecContext(ctx, `
insert into shared_inbox_raci_group_assignments (
  company_id,
  shared_inbox_id,
  role,
  group_id,
  created_timestamp
) values ($1::uuid, $2::uuid, $3, $4::uuid, now())
on conflict (company_id, shared_inbox_id, role, group_id) do nothing`,
				companyID, sharedInboxID, assignment.role, assignment.subjectID,
			); err != nil {
				if isPostgresUndefinedTable(err, "shared_inbox_raci_group_assignments") {
					return nil, ErrRaciStorageUnavailable
				}
				return nil, err
			}
			continue
		}
		if !legacyUserAssignmentsAvailable {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
insert into shared_inbox_raci_assignments (
  company_id,
  shared_inbox_id,
  role,
  user_id,
  created_timestamp
) values ($1::uuid, $2::uuid, $3, $4::uuid, now())
on conflict (company_id, shared_inbox_id, role, user_id) do nothing`,
			companyID, sharedInboxID, assignment.role, assignment.subjectID,
		); err != nil {
			if isPostgresUndefinedTable(err, "shared_inbox_raci_assignments") {
				return nil, ErrRaciStorageUnavailable
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
			return folder.RaciAssignments, nil
		}
	}
	return []domain.SharedInboxRaciAssignment{}, nil
}
