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
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		item, err := scanSharedInboxRaciAssignment(rows)
		if err != nil {
			return nil, err
		}
		assignmentsByFolder[item.FolderID] = append(assignmentsByFolder[item.FolderID], item)
	}
	return assignmentsByFolder, rows.Err()
}

func (r *PostgresRepo) attachCommunicationsSharedInboxRaciAssignments(ctx context.Context, companyID string, folders []domain.CompanyExplorerFolder) ([]domain.CompanyExplorerFolder, error) {
	ids := make([]string, 0, len(folders))
	for _, folder := range folders {
		if folder.FolderKind == "communications" {
			ids = append(ids, folder.FolderID)
		}
	}
	assignments, err := r.listCommunicationsSharedInboxRaciAssignments(ctx, companyID, ids)
	if err != nil {
		return nil, err
	}
	for index := range folders {
		if folders[index].FolderKind != "communications" {
			continue
		}
		folders[index].RaciAssignments = assignments[folders[index].FolderID]
		if folders[index].RaciAssignments == nil {
			folders[index].RaciAssignments = []domain.SharedInboxRaciAssignment{}
		}
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
		role   string
		userID string
	}
	normalized := make([]normalizedAssignment, 0, len(input.Assignments))
	seen := map[string]bool{}
	for _, assignment := range input.Assignments {
		role, ok := NormalizeLogicGateRaciRole(assignment.Role)
		userID := strings.TrimSpace(assignment.UserID)
		if !ok || userID == "" {
			return nil, ErrInvalid
		}
		key := role + ":" + userID
		if seen[key] {
			continue
		}
		seen[key] = true

		var userInCompany bool
		if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_memberships
  where company_id=$1 and user_id::text=$2
)`, companyID, userID).Scan(&userInCompany); err != nil {
			return nil, err
		}
		if !userInCompany {
			return nil, ErrAssigneeNotInCompany
		}
		normalized = append(normalized, normalizedAssignment{role: role, userID: userID})
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
	for _, assignment := range normalized {
		if _, err := tx.ExecContext(ctx, `
insert into communications_shared_inbox_raci_assignments (
  company_id,
  folder_id,
  role,
  user_id,
  created_timestamp
) values ($1, $2, $3, $4, now())
on conflict (company_id, folder_id, role, user_id) do nothing`,
			companyID, folderID, assignment.role, assignment.userID,
		); err != nil {
			if isPostgresUndefinedTable(err, "communications_shared_inbox_raci_assignments") {
				return nil, ErrRaciStorageUnavailable
			}
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	assignmentsByFolder, err := r.listCommunicationsSharedInboxRaciAssignments(ctx, companyID, []string{folderID})
	if err != nil {
		if isPostgresUndefinedTable(err, "communications_shared_inbox_raci_assignments") {
			return nil, ErrRaciStorageUnavailable
		}
		return nil, err
	}
	assignments := assignmentsByFolder[folderID]
	if assignments == nil {
		assignments = []domain.SharedInboxRaciAssignment{}
	}
	return assignments, nil
}
