package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

func scanSharedInboxRaciAssignment(row interface {
	Scan(dest ...any) error
}) (domain.SharedInboxRaciAssignment, error) {
	var item domain.SharedInboxRaciAssignment
	var displayName sql.NullString
	var email sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.FolderID,
		&item.Role,
		&item.UserID,
		&displayName,
		&email,
		&item.CreatedTimestamp,
	)
	if displayName.Valid {
		item.UserDisplayName = displayName.String
	}
	if email.Valid {
		item.UserEmail = email.String
	}
	return item, err
}

func (r *PostgresRepo) listCommunicationsSharedInboxRaciAssignments(ctx context.Context, companyID string, folderIDs []string) (map[string][]domain.SharedInboxRaciAssignment, error) {
	assignmentsByFolder := map[string][]domain.SharedInboxRaciAssignment{}
	if len(folderIDs) == 0 {
		return assignmentsByFolder, nil
	}
	rows, err := r.db.QueryContext(ctx, `
select
  assignment.company_id::text,
  assignment.folder_id::text,
  assignment.role,
  assignment.user_id::text,
  nullif(app_user.display_name, ''),
  nullif(app_user.email, ''),
  assignment.created_timestamp
from communications_shared_inbox_raci_assignments assignment
join company_memberships membership
  on membership.company_id = assignment.company_id
 and membership.user_id = assignment.user_id
join users app_user
  on app_user.user_id = assignment.user_id
where assignment.company_id = $1
  and assignment.folder_id = any(string_to_array($2, ',')::uuid[])
order by assignment.folder_id::text asc,
  case assignment.role
    when 'responsible' then 1
    when 'accountable' then 2
    when 'consulted' then 3
    when 'informed' then 4
    else 5
  end,
  lower(coalesce(nullif(app_user.display_name, ''), nullif(app_user.email, ''), assignment.user_id::text)) asc,
  assignment.user_id::text asc`,
		companyID, strings.Join(folderIDs, ","),
	)
	if err != nil {
		if isPostgresUndefinedTable(err, "communications_shared_inbox_raci_assignments") {
			return assignmentsByFolder, nil
		}
		if isPostgresUndefinedColumn(err, "") || isPostgresInvalidTextRepresentation(err) {
			return assignmentsByFolder, nil
		}
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		item, err := scanSharedInboxRaciAssignment(rows)
		if err != nil {
			return nil, err
		}
		item.SubjectType = EntityPermissionSubjectUser
		item.SubjectID = item.UserID
		item.SubjectName = item.UserDisplayName
		if item.SubjectName == "" {
			item.SubjectName = item.UserEmail
		}
		assignmentsByFolder[item.FolderID] = append(assignmentsByFolder[item.FolderID], item)
	}
	if err := rows.Err(); err != nil {
		if isPostgresUndefinedTable(err, "communications_shared_inbox_raci_assignments") {
			return assignmentsByFolder, nil
		}
		if isPostgresUndefinedColumn(err, "") || isPostgresInvalidTextRepresentation(err) {
			return assignmentsByFolder, nil
		}
		return nil, err
	}
	groupRows, err := r.db.QueryContext(ctx, `
select
  assignment.company_id::text,
  assignment.folder_id::text,
  assignment.role,
  assignment.group_id::text,
  user_group.name,
  assignment.created_timestamp
from communications_shared_inbox_raci_group_assignments assignment
join company_user_groups user_group
  on user_group.company_id = assignment.company_id
 and user_group.group_id = assignment.group_id
where assignment.company_id = $1
  and assignment.folder_id = any(string_to_array($2, ',')::uuid[])
order by assignment.folder_id::text asc,
  case assignment.role
    when 'responsible' then 1
    when 'accountable' then 2
    when 'consulted' then 3
    when 'informed' then 4
    else 5
  end,
  lower(user_group.name) asc,
  assignment.group_id::text asc`,
		companyID, strings.Join(folderIDs, ","),
	)
	if err != nil {
		if isPostgresUndefinedTable(err, "communications_shared_inbox_raci_group_assignments") || isPostgresInvalidTextRepresentation(err) {
			for folderID := range assignmentsByFolder {
				sortSharedInboxRaciAssignments(assignmentsByFolder[folderID])
			}
			return assignmentsByFolder, nil
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
		assignmentsByFolder[item.FolderID] = append(assignmentsByFolder[item.FolderID], item)
	}
	if err := groupRows.Err(); err != nil {
		if isPostgresUndefinedTable(err, "communications_shared_inbox_raci_group_assignments") {
			return assignmentsByFolder, nil
		}
		return nil, err
	}
	for folderID := range assignmentsByFolder {
		sortSharedInboxRaciAssignments(assignmentsByFolder[folderID])
	}
	return assignmentsByFolder, nil
}

func (r *PostgresRepo) listCommunicationsSharedInboxRaciAncestry(ctx context.Context, companyID string, folderIDs []string) (map[string]string, []string, error) {
	parentByFolder := map[string]string{}
	if len(folderIDs) == 0 {
		return parentByFolder, nil, nil
	}
	rows, err := r.db.QueryContext(ctx, `
with recursive ancestry as (
  select folder_id::text as folder_id,
         parent_folder_id::text as parent_folder_id
  from company_explorer_folders
  where company_id = $1
    and folder_kind = 'communications'
    and folder_id = any(string_to_array($2, ',')::uuid[])
  union
  select parent.folder_id::text as folder_id,
         parent.parent_folder_id::text as parent_folder_id
  from company_explorer_folders parent
  join ancestry child
    on child.parent_folder_id = parent.folder_id::text
  where parent.company_id = $1
    and parent.folder_kind = 'communications'
)
select folder_id, parent_folder_id
from ancestry`,
		companyID, strings.Join(folderIDs, ","),
	)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	ids := make([]string, 0, len(folderIDs))
	seen := map[string]bool{}
	for rows.Next() {
		var folderID string
		var parentID sql.NullString
		if err := rows.Scan(&folderID, &parentID); err != nil {
			return nil, nil, err
		}
		if !seen[folderID] {
			ids = append(ids, folderID)
			seen[folderID] = true
		}
		if parentID.Valid {
			parentByFolder[folderID] = parentID.String
		} else {
			parentByFolder[folderID] = ""
		}
	}
	return parentByFolder, ids, rows.Err()
}

func sharedInboxRaciAssignmentsForFolder(folderID string, parentByFolder map[string]string, assignmentsByFolder map[string][]domain.SharedInboxRaciAssignment) []domain.SharedInboxRaciAssignment {
	assignments := make([]domain.SharedInboxRaciAssignment, 0)
	seenAssignments := map[string]bool{}
	seenFolders := map[string]bool{}
	for currentID := strings.TrimSpace(folderID); currentID != ""; currentID = strings.TrimSpace(parentByFolder[currentID]) {
		if seenFolders[currentID] {
			break
		}
		seenFolders[currentID] = true
		for _, assignment := range assignmentsByFolder[currentID] {
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
		if _, ok := parentByFolder[currentID]; !ok {
			break
		}
	}
	sortSharedInboxRaciAssignments(assignments)
	return assignments
}

func (r *PostgresRepo) attachCommunicationsSharedInboxRaciAssignments(ctx context.Context, companyID string, folders []domain.CompanyExplorerFolder) ([]domain.CompanyExplorerFolder, error) {
	ids := make([]string, 0, len(folders))
	for _, folder := range folders {
		if folder.FolderKind == "communications" {
			ids = append(ids, folder.FolderID)
		}
	}
	parentByFolder, assignmentFolderIDs, err := r.listCommunicationsSharedInboxRaciAncestry(ctx, companyID, ids)
	if err != nil {
		if isPostgresUndefinedTable(err, "") || isPostgresUndefinedColumn(err, "") || isPostgresInvalidTextRepresentation(err) {
			return folders, nil
		}
		return nil, err
	}
	assignments, err := r.listCommunicationsSharedInboxRaciAssignments(ctx, companyID, assignmentFolderIDs)
	if err != nil {
		return nil, err
	}
	for index := range folders {
		if folders[index].FolderKind != "communications" {
			continue
		}
		folders[index].RaciAssignments = sharedInboxRaciAssignmentsForFolder(folders[index].FolderID, parentByFolder, assignments)
	}
	return folders, nil
}

func (r *PostgresRepo) SetCommunicationsSharedInboxRaciAssignments(input SharedInboxRaciAssignmentUpdateInput) ([]domain.SharedInboxRaciAssignment, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	folderID := strings.TrimSpace(input.FolderID)
	if companyID == "" || folderID == "" {
		return nil, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var folderKind string
	if err := tx.QueryRowContext(ctx,
		`select folder_kind from company_explorer_folders where company_id=$1 and folder_id=$2`,
		companyID, folderID,
	).Scan(&folderKind); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	if folderKind != "communications" {
		return nil, ErrInvalid
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
  where company_id=$1 and user_id::text=$2
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
  where company_id=$1 and group_id::text=$2
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

	if _, err := tx.ExecContext(ctx,
		`delete from communications_shared_inbox_raci_assignments where company_id=$1 and folder_id=$2`,
		companyID, folderID,
	); err != nil {
		if isPostgresUndefinedTable(err, "communications_shared_inbox_raci_assignments") {
			return nil, ErrRaciStorageUnavailable
		}
		return nil, err
	}
	hasGroupAssignments := false
	for _, assignment := range normalized {
		if assignment.subjectType == EntityPermissionSubjectGroup {
			hasGroupAssignments = true
			break
		}
	}
	if _, err := tx.ExecContext(ctx,
		`delete from communications_shared_inbox_raci_group_assignments where company_id=$1 and folder_id=$2`,
		companyID, folderID,
	); err != nil {
		if isPostgresUndefinedTable(err, "communications_shared_inbox_raci_group_assignments") {
			if hasGroupAssignments {
				return nil, ErrRaciStorageUnavailable
			}
		} else {
			return nil, err
		}
	}
	for _, assignment := range normalized {
		if assignment.subjectType == EntityPermissionSubjectGroup {
			if _, err := tx.ExecContext(ctx, `
insert into communications_shared_inbox_raci_group_assignments (
  company_id,
  folder_id,
  role,
  group_id,
  created_timestamp
) values ($1, $2, $3, $4, now())
on conflict (company_id, folder_id, role, group_id) do nothing`,
				companyID, folderID, assignment.role, assignment.subjectID,
			); err != nil {
				if isPostgresUndefinedTable(err, "communications_shared_inbox_raci_group_assignments") {
					return nil, ErrRaciStorageUnavailable
				}
				return nil, err
			}
			continue
		}
		if _, err := tx.ExecContext(ctx, `
insert into communications_shared_inbox_raci_assignments (
  company_id,
  folder_id,
  role,
  user_id,
  created_timestamp
) values ($1, $2, $3, $4, now())
on conflict (company_id, folder_id, role, user_id) do nothing`,
			companyID, folderID, assignment.role, assignment.subjectID,
		); err != nil {
			if isPostgresUndefinedTable(err, "communications_shared_inbox_raci_assignments") {
				return nil, ErrRaciStorageUnavailable
			}
			return nil, err
		}
	}
	if err := recomputeSharedTriageRaciEffectiveAccessForSubtreeTx(ctx, tx, companyID, folderID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	folders, err := r.ListCompanyExplorerFolders(companyID, "communications")
	if err != nil {
		return nil, err
	}
	for _, folder := range folders {
		if folder.FolderID == folderID {
			return folder.RaciAssignments, nil
		}
	}
	return []domain.SharedInboxRaciAssignment{}, nil
}
