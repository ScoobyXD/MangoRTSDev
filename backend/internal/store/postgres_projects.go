package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

const projectSelectColumns = `
project.company_id::text,
project.project_id::text,
project.name,
project.status,
project.health,
project.default_access,
project.created_timestamp,
project.updated_timestamp`

func scanProject(row interface{ Scan(dest ...any) error }) (domain.Project, error) {
	var item domain.Project
	err := row.Scan(
		&item.CompanyID,
		&item.ProjectID,
		&item.Name,
		&item.Status,
		&item.Health,
		&item.DefaultAccess,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	return item, err
}

type postgresProjectAssignmentQueryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func attachProjectAssignmentReadModel(ctx context.Context, queryer postgresProjectAssignmentQueryer, project domain.Project) (domain.Project, error) {
	fields, err := listEntityFieldsForResource(ctx, queryer, project.CompanyID, EntityTypeProject, project.ProjectID)
	if err != nil {
		return domain.Project{}, err
	}
	accounts, err := listProjectAccountAssignments(ctx, queryer, project.CompanyID, project.ProjectID)
	if err != nil {
		return domain.Project{}, err
	}
	teams, err := listProjectTeamAssignments(ctx, queryer, project.CompanyID, project.ProjectID)
	if err != nil {
		return domain.Project{}, err
	}
	project.Fields = fields
	project.Accounts = accounts
	project.Teams = teams
	return project, nil
}

func listProjectAccountAssignments(ctx context.Context, queryer postgresProjectAssignmentQueryer, companyID, projectID string) ([]domain.Account, error) {
	rows, err := queryer.QueryContext(ctx, `
select account.company_id::text, account.account_id::text, account.name, account.folder_id::text, account.position, account.created_timestamp, account.updated_timestamp
from project_account_assignments assignment
join accounts account
  on account.company_id=assignment.company_id
 and account.account_id=assignment.account_id
where assignment.company_id=$1::uuid
  and assignment.project_id=$2::uuid
order by account.position asc, lower(account.name) asc, account.account_id::text asc`, companyID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Account, 0)
	for rows.Next() {
		item, err := scanAccount(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func listProjectTeamAssignments(ctx context.Context, queryer postgresProjectAssignmentQueryer, companyID, projectID string) ([]domain.CompanyUserGroup, error) {
	rows, err := queryer.QueryContext(ctx, `
select team.company_id::text, team.group_id::text, team.parent_group_id::text, team.name, team.position, team.created_timestamp, team.updated_timestamp
from project_team_assignments assignment
join company_user_groups team
  on team.company_id=assignment.company_id
 and team.group_id=assignment.team_id
where assignment.company_id=$1::uuid
  and assignment.project_id=$2::uuid
order by team.position asc, lower(team.name) asc, team.group_id::text asc`, companyID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.CompanyUserGroup, 0)
	for rows.Next() {
		item, err := scanProjectTeam(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanProjectTeam(row interface{ Scan(dest ...any) error }) (domain.CompanyUserGroup, error) {
	var item domain.CompanyUserGroup
	var parentID sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.GroupID,
		&parentID,
		&item.Name,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if parentID.Valid && strings.TrimSpace(parentID.String) != "" {
		value := parentID.String
		item.ParentGroupID = &value
	}
	return item, err
}

func setProjectAccountAssignmentsTx(ctx context.Context, tx *sql.Tx, companyID, projectID string, accountIDs []string) error {
	if _, err := tx.ExecContext(ctx, `delete from project_account_assignments where company_id=$1::uuid and project_id=$2::uuid`, companyID, projectID); err != nil {
		return err
	}
	for _, accountID := range cleanProjectIDList(accountIDs) {
		if _, err := tx.ExecContext(ctx, `
insert into project_account_assignments (company_id, project_id, account_id, created_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, now())
on conflict (company_id, project_id, account_id) do nothing`, companyID, projectID, accountID); err != nil {
			return err
		}
	}
	return nil
}

func setProjectTeamAssignmentsTx(ctx context.Context, tx *sql.Tx, companyID, projectID string, teamIDs []string) error {
	if _, err := tx.ExecContext(ctx, `delete from project_team_assignments where company_id=$1::uuid and project_id=$2::uuid`, companyID, projectID); err != nil {
		return err
	}
	for _, teamID := range cleanProjectIDList(teamIDs) {
		if _, err := tx.ExecContext(ctx, `
insert into project_team_assignments (company_id, project_id, team_id, created_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, now())
on conflict (company_id, project_id, team_id) do nothing`, companyID, projectID, teamID); err != nil {
			return err
		}
	}
	return nil
}

func scanProjectRelationshipProjection(row interface{ Scan(dest ...any) error }) (domain.ProjectRelationshipProjection, error) {
	var item domain.ProjectRelationshipProjection
	var logicGateID sql.NullString
	var nodeID sql.NullString
	var assignmentID sql.NullString
	var status sql.NullString
	var createdFromEmail bool
	err := row.Scan(
		&item.CompanyID,
		&item.ProjectID,
		&item.ProjectName,
		&item.RelationshipID,
		&item.ResourceType,
		&item.ResourceID,
		&logicGateID,
		&nodeID,
		&assignmentID,
		&item.DisplayTitle,
		&status,
		&createdFromEmail,
		&item.Position,
		&item.ResourceCreatedTimestamp,
		&item.RelationshipCreatedTimestamp,
		&item.RelationshipUpdatedTimestamp,
		&item.ProjectionUpdatedTimestamp,
	)
	if logicGateID.Valid && strings.TrimSpace(logicGateID.String) != "" {
		value := logicGateID.String
		item.LogicGateID = &value
	}
	if nodeID.Valid && strings.TrimSpace(nodeID.String) != "" {
		value := nodeID.String
		item.NodeID = &value
	}
	if assignmentID.Valid && strings.TrimSpace(assignmentID.String) != "" {
		value := assignmentID.String
		item.AssignmentID = &value
	}
	if status.Valid {
		value := status.String
		item.Status = &value
	}
	item.CreatedFromEmail = createdFromEmail
	return item, err
}

func (r *PostgresRepo) CreateProject(input ProjectInput) (ProjectMutationResult, error) {
	input, err := NormalizeProjectInput(input, false)
	if err != nil {
		return ProjectMutationResult{}, err
	}
	if input.ProjectID == "" {
		input.ProjectID = newUUIDv7String()
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProjectMutationResult{}, err
	}
	defer tx.Rollback()

	project, err := scanProject(tx.QueryRowContext(ctx, `
with inserted as (
  insert into projects (
    company_id, project_id, name, status, health, default_access, created_timestamp, updated_timestamp
  ) values ($1::uuid, $2::uuid, $3, $4, $5, 'edit', now(), now())
  returning *
)
select `+projectSelectColumns+`
from inserted project
`, input.CompanyID, input.ProjectID, input.Name, input.Status, input.Health))
	if err != nil {
		return ProjectMutationResult{}, err
	}
	if err := setProjectAccountAssignmentsTx(ctx, tx, input.CompanyID, project.ProjectID, input.AccountIDs); err != nil {
		return ProjectMutationResult{}, err
	}
	if err := setProjectTeamAssignmentsTx(ctx, tx, input.CompanyID, project.ProjectID, input.TeamIDs); err != nil {
		return ProjectMutationResult{}, err
	}
	project, err = attachProjectAssignmentReadModel(ctx, tx, project)
	if err != nil {
		return ProjectMutationResult{}, err
	}
	var folderItem *domain.CompanyExplorerFolderItem
	if input.CompanyExplorerDefaultPlacement {
		item, inserted, err := placeCompanyExplorerItemInDefaultFolderTx(ctx, tx, input.CompanyID, EntityTypeProject, project.ProjectID, input.ActorUserID, true)
		if err != nil {
			return ProjectMutationResult{}, err
		}
		if inserted {
			folderItem = &item
		}
	}
	if err := tx.Commit(); err != nil {
		return ProjectMutationResult{}, err
	}
	return ProjectMutationResult{Project: &project, FolderItem: folderItem}, nil
}

func (r *PostgresRepo) UpdateProject(input ProjectInput) (ProjectMutationResult, error) {
	input, err := NormalizeProjectInput(input, true)
	if err != nil {
		return ProjectMutationResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProjectMutationResult{}, err
	}
	defer tx.Rollback()
	GVICMatrixNodeIDs, GVICMatrixLogicGateIDs, err := postgresGVICMatrixProjectAffectedResourceIDsTx(ctx, tx, input.CompanyID, input.ProjectID)
	if err != nil {
		return ProjectMutationResult{}, err
	}
	args := []any{input.CompanyID, input.ProjectID, input.Name, input.Status, input.Health}
	query := `
with updated as (
  update projects
  set name=$3,
      status=$4,
      health=$5,
      updated_timestamp=now()
  where company_id=$1::uuid
    and project_id=$2::uuid
  returning *
)
select ` + projectSelectColumns + `
from updated project`
	project, err := scanProject(tx.QueryRowContext(ctx, query, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectMutationResult{}, ErrNotFound
	}
	if err != nil {
		return ProjectMutationResult{}, err
	}
	if input.AccountIDsSet {
		if err := setProjectAccountAssignmentsTx(ctx, tx, input.CompanyID, input.ProjectID, input.AccountIDs); err != nil {
			return ProjectMutationResult{}, err
		}
	}
	if input.TeamIDsSet {
		if err := setProjectTeamAssignmentsTx(ctx, tx, input.CompanyID, input.ProjectID, input.TeamIDs); err != nil {
			return ProjectMutationResult{}, err
		}
	}
	project, err = attachProjectAssignmentReadModel(ctx, tx, project)
	if err != nil {
		return ProjectMutationResult{}, err
	}
	if err := syncPostgresGVICMatrixProjectionForProjectResourcesTx(ctx, tx, input.CompanyID, GVICMatrixNodeIDs, GVICMatrixLogicGateIDs); err != nil {
		return ProjectMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProjectMutationResult{}, err
	}
	return ProjectMutationResult{Project: &project}, nil
}

func (r *PostgresRepo) DeleteProject(companyID, projectID, actorUserID string) (ProjectMutationResult, error) {
	companyID = cleanUUIDText(companyID)
	projectID = cleanUUIDText(projectID)
	if companyID == "" || projectID == "" {
		return ProjectMutationResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProjectMutationResult{}, err
	}
	defer tx.Rollback()
	GVICMatrixNodeIDs, GVICMatrixLogicGateIDs, err := postgresGVICMatrixProjectAffectedResourceIDsTx(ctx, tx, companyID, projectID)
	if err != nil {
		return ProjectMutationResult{}, err
	}
	if err := postgresDeleteProjectTx(ctx, tx, companyID, projectID); err != nil {
		return ProjectMutationResult{}, err
	}
	if err := syncPostgresGVICMatrixProjectionForProjectResourcesTx(ctx, tx, companyID, GVICMatrixNodeIDs, GVICMatrixLogicGateIDs); err != nil {
		return ProjectMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProjectMutationResult{}, err
	}
	return ProjectMutationResult{DeletedID: projectID}, nil
}

func postgresGVICMatrixProjectAffectedResourceIDsTx(ctx context.Context, tx *sql.Tx, companyID, projectID string) ([]string, []string, error) {
	companyID = cleanUUIDText(companyID)
	projectID = cleanUUIDText(projectID)
	if ctx == nil || tx == nil || companyID == "" || projectID == "" {
		return nil, nil, ErrInvalid
	}
	rows, err := tx.QueryContext(ctx, `
select distinct node_id::text, logic_gate_id::text
from project_relationship_projection
where company_id=$1::uuid
  and project_id=$2::uuid`, companyID, projectID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	nodeSet := map[string]bool{}
	logicGateSet := map[string]bool{}
	for rows.Next() {
		var nodeID sql.NullString
		var logicGateID sql.NullString
		if err := rows.Scan(&nodeID, &logicGateID); err != nil {
			return nil, nil, err
		}
		if nodeID.Valid {
			if clean := cleanUUIDText(nodeID.String); clean != "" {
				nodeSet[clean] = true
			}
		}
		if logicGateID.Valid {
			if clean := cleanUUIDText(logicGateID.String); clean != "" {
				logicGateSet[clean] = true
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return mapKeys(nodeSet), mapKeys(logicGateSet), nil
}

func syncPostgresGVICMatrixProjectionForProjectResourcesTx(ctx context.Context, tx *sql.Tx, companyID string, nodeIDs, logicGateIDs []string) error {
	for _, nodeID := range cleanUUIDTextSlice(nodeIDs) {
		if err := syncPostgresGVICMatrixProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
			return err
		}
	}
	for _, logicGateID := range cleanUUIDTextSlice(logicGateIDs) {
		if err := syncPostgresGVICMatrixProjectionForLogicGateTx(ctx, tx, companyID, logicGateID); err != nil {
			return err
		}
	}
	return nil
}

func (r *PostgresRepo) GetProject(companyID, projectID string) (domain.Project, error) {
	ctx := context.Background()
	project, err := scanProject(r.db.QueryRowContext(ctx, `
select `+projectSelectColumns+`
from projects project
where project.company_id=$1::uuid
  and project.project_id=$2::uuid`, companyID, projectID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Project{}, ErrNotFound
	}
	if err != nil {
		return domain.Project{}, err
	}
	return attachProjectAssignmentReadModel(ctx, r.db, project)
}

func (r *PostgresRepo) ListProjects(companyID, viewerUserID string) ([]domain.Project, error) {
	companyID = cleanUUIDText(companyID)
	viewerUserID = cleanUUIDText(viewerUserID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	query := `
select ` + projectSelectColumns + `
from projects project
where project.company_id=$1::uuid`
	args := []any{companyID}
	if viewerUserID != "" {
		query += ` and mangorts_user_can_access_resource(project.company_id, 'project', project.project_id, $2::uuid, $3::text)`
		args = append(args, viewerUserID, EntityPermissionEdit)
	}
	query += ` order by lower(project.name) asc, project.project_id asc`
	rows, err := r.db.QueryContext(context.Background(), query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Project, 0)
	for rows.Next() {
		item, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		if viewerUserID != "" {
			item.EffectiveAccess = EntityPermissionEdit
		}
		item, err = attachProjectAssignmentReadModel(context.Background(), r.db, item)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListCompanyExplorerProjectSummaries(companyID string) ([]domain.Project, error) {
	return r.ListProjects(companyID, "")
}

func (r *PostgresRepo) ListVisibleCompanyExplorerProjectSummaries(companyID, userID string) ([]domain.Project, error) {
	return r.ListProjects(companyID, userID)
}

func (r *PostgresRepo) ListCompanyExplorerProjectSummariesInFolderSubtree(companyID, folderID string) ([]domain.Project, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListCompanyExplorerProjectSummaries(companyID)
	}
	rows, err := r.db.QueryContext(context.Background(), `
with recursive folder_scope as (
  select company_id, folder_id
  from company_explorer_folders
  where company_id=$1::uuid
    and folder_id=$2::uuid
  union all
  select child.company_id, child.folder_id
  from company_explorer_folders child
  join folder_scope parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
)
select `+projectSelectColumns+`
from projects project
join company_explorer_items item
  on item.company_id=project.company_id
 and item.target_type='project'
 and item.target_id=project.project_id
join folder_scope folder
  on folder.folder_id=item.parent_folder_id
where project.company_id=$1::uuid
order by lower(project.name) asc, project.project_id asc`, companyID, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Project, 0)
	for rows.Next() {
		item, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		item, err = attachProjectAssignmentReadModel(context.Background(), r.db, item)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListVisibleCompanyExplorerProjectSummariesInFolderSubtree(companyID, folderID, userID string) ([]domain.Project, error) {
	companyID = cleanUUIDText(companyID)
	folderID = strings.TrimSpace(folderID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return r.ListVisibleCompanyExplorerProjectSummaries(companyID, userID)
	}
	rows, err := r.db.QueryContext(context.Background(), `
with recursive folder_scope as (
  select company_id, folder_id
  from company_explorer_folders
  where company_id=$1::uuid
    and folder_id=$2::uuid
    and mangorts_user_can_access_resource(company_id, 'company_explorer_folder', folder_id, $3::uuid, $4::text)
  union all
  select child.company_id, child.folder_id
  from company_explorer_folders child
  join folder_scope parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
  where mangorts_user_can_access_resource(child.company_id, 'company_explorer_folder', child.folder_id, $3::uuid, $4::text)
)
select `+projectSelectColumns+`
from projects project
join company_explorer_items item
  on item.company_id=project.company_id
 and item.target_type='project'
 and item.target_id=project.project_id
join folder_scope folder
  on folder.folder_id=item.parent_folder_id
where project.company_id=$1::uuid
  and mangorts_user_can_access_resource(project.company_id, 'project', project.project_id, $3::uuid, $4::text)
order by lower(project.name) asc, project.project_id asc`, companyID, folderID, userID, EntityPermissionEdit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Project, 0)
	for rows.Next() {
		item, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		item.EffectiveAccess = EntityPermissionEdit
		item, err = attachProjectAssignmentReadModel(context.Background(), r.db, item)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) GetProjectView(companyID, projectID, viewerUserID string) (domain.ProjectView, error) {
	project, err := r.GetProject(companyID, projectID)
	if err != nil {
		return domain.ProjectView{}, err
	}
	projections, err := r.ListProjectProjections(companyID, projectID)
	if err != nil {
		return domain.ProjectView{}, err
	}
	relationships, err := r.ListProjectRelationshipProjectionsForViewer(companyID, projectID, viewerUserID)
	if err != nil {
		return domain.ProjectView{}, err
	}
	criticalPath, err := r.ListProjectCriticalPathSteps(companyID, projectID, viewerUserID)
	if err != nil {
		return domain.ProjectView{}, err
	}
	information, err := r.listProjectInformation(companyID, projectID)
	if err != nil {
		return domain.ProjectView{}, err
	}
	view := domain.ProjectView{
		CompanyID:         companyID,
		ProjectID:         projectID,
		Project:           project,
		Information:       information,
		Projections:       projections,
		Relationships:     relationships,
		CriticalPath:      criticalPath,
		InformationCount:  len(information),
		ProjectionCount:   len(projections),
		RelationshipCount: len(relationships),
		CriticalPathCount: len(criticalPath),
	}
	if strings.TrimSpace(viewerUserID) != "" {
		view.CanEdit, _ = r.UserHasEffectiveAccess(companyID, viewerUserID, EntityTypeProject, projectID, EntityPermissionEdit)
		if view.CanEdit {
			view.Project.EffectiveAccess = EntityPermissionEdit
		} else {
			view.Project.EffectiveAccess = EntityPermissionEdit
		}
	}
	return view, nil
}

func (r *PostgresRepo) AddProjectInformation(input ProjectInformationInput) (domain.ProjectInformation, error) {
	input, err := NormalizeProjectInformationInput(input)
	if err != nil {
		return domain.ProjectInformation{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.ProjectInformation{}, err
	}
	defer tx.Rollback()
	item, err := scanProjectInformation(tx.QueryRowContext(ctx, `
insert into project_information (company_id, information_id, project_id, type, information, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, $4::information_type, $5, now(), now())
returning company_id::text, information_id::text, project_id::text, type::text, information, created_timestamp, updated_timestamp`,
		input.CompanyID, newUUIDv7String(), input.ProjectID, input.Type, input.Information))
	if err != nil {
		return domain.ProjectInformation{}, err
	}
	_, err = scanProjectProjection(tx.QueryRowContext(ctx, `
insert into project_projection_table (company_id, project_id, information_id, type, information, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, $4::information_type, $5, now(), now())
on conflict (company_id, project_id, information_id)
do update set
  type=excluded.type,
  information=excluded.information,
  updated_timestamp=now()
returning company_id::text, project_id::text, type::text, information, information_id::text, created_timestamp, updated_timestamp`,
		input.CompanyID, input.ProjectID, input.InformationID, input.Type, input.Information))
	if err != nil {
		return domain.ProjectInformation{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.ProjectInformation{}, err
	}
	return item, nil
}

func scanProjectInformation(row interface{ Scan(dest ...any) error }) (domain.ProjectInformation, error) {
	var item domain.ProjectInformation
	err := row.Scan(&item.CompanyID, &item.InformationID, &item.ProjectID, &item.Type, &item.Information, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	return item, err
}

func scanProjectProjection(row interface{ Scan(dest ...any) error }) (domain.ProjectProjection, error) {
	var item domain.ProjectProjection
	err := row.Scan(&item.CompanyID, &item.ProjectID, &item.Type, &item.Information, &item.InformationID, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	return item, err
}

func (r *PostgresRepo) listProjectInformation(companyID, projectID string) ([]domain.ProjectInformation, error) {
	rows, err := r.db.QueryContext(context.Background(), `
select company_id::text, information_id::text, project_id::text, type::text, information, created_timestamp, updated_timestamp
from project_information
where company_id=$1::uuid and project_id=$2::uuid
order by created_timestamp asc, information_id asc`, companyID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.ProjectInformation, 0)
	for rows.Next() {
		item, err := scanProjectInformation(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListProjectProjections(companyID, projectID string) ([]domain.ProjectProjection, error) {
	rows, err := r.db.QueryContext(context.Background(), `
select company_id::text, project_id::text, type::text, information, information_id::text, created_timestamp, updated_timestamp
from project_projection_table
where company_id=$1::uuid and project_id=$2::uuid
order by created_timestamp desc, information_id asc`, companyID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.ProjectProjection, 0)
	for rows.Next() {
		item, err := scanProjectProjection(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) DeleteProjectProjection(input ProjectProjectionDeleteInput) error {
	input, err := NormalizeProjectProjectionDeleteInput(input)
	if err != nil {
		return err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `delete from project_projection_table where company_id=$1::uuid and project_id=$2::uuid and information_id=$3::uuid`, input.CompanyID, input.ProjectID, input.InformationID); err != nil {
		return err
	}
	return tx.Commit()
}

func scanProjectCriticalPathStep(row interface{ Scan(dest ...any) error }) (domain.ProjectCriticalPathStep, error) {
	var item domain.ProjectCriticalPathStep
	var relationshipID sql.NullString
	var resourceID sql.NullString
	var logicGateID sql.NullString
	var nodeID sql.NullString
	var status sql.NullString
	var dueDate sql.NullString
	var ownerID sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.ProjectID,
		&item.StepID,
		&item.Name,
		&relationshipID,
		&item.ResourceType,
		&resourceID,
		&logicGateID,
		&nodeID,
		&item.DisplayTitle,
		&status,
		&dueDate,
		&item.OwnerType,
		&ownerID,
		&item.OwnerLabel,
		&item.Position,
		&item.IsCurrent,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if relationshipID.Valid && strings.TrimSpace(relationshipID.String) != "" {
		value := relationshipID.String
		item.RelationshipID = &value
	}
	if resourceID.Valid && strings.TrimSpace(resourceID.String) != "" {
		item.ResourceID = resourceID.String
	}
	if logicGateID.Valid && strings.TrimSpace(logicGateID.String) != "" {
		value := logicGateID.String
		item.LogicGateID = &value
	}
	if nodeID.Valid && strings.TrimSpace(nodeID.String) != "" {
		value := nodeID.String
		item.NodeID = &value
	}
	if status.Valid {
		value := status.String
		item.Status = &value
	}
	if dueDate.Valid && strings.TrimSpace(dueDate.String) != "" {
		value := dueDate.String
		item.DueDate = &value
	}
	if ownerID.Valid && strings.TrimSpace(ownerID.String) != "" {
		value := ownerID.String
		item.OwnerID = &value
	}
	return item, err
}

func (r *PostgresRepo) ListProjectCriticalPathSteps(companyID, projectID, viewerUserID string) ([]domain.ProjectCriticalPathStep, error) {
	companyID = cleanUUIDText(companyID)
	projectID = cleanUUIDText(projectID)
	viewerUserID = cleanUUIDText(viewerUserID)
	if companyID == "" || projectID == "" {
		return nil, ErrInvalid
	}
	query := projectCriticalPathSelectSQL
	args := []any{companyID, projectID}
	if viewerUserID != "" {
		query = strings.Replace(query, "/* viewer_access */", `
 and mangorts_user_can_access_resource(projection.company_id, projection.resource_type, projection.resource_id, $3::uuid, $4::text)`, 1)
		args = append(args, viewerUserID, EntityPermissionEdit)
	} else {
		query = strings.Replace(query, "/* viewer_access */", "", 1)
	}
	query += `
where step.company_id=$1::uuid
  and step.project_id=$2::uuid
order by step.position asc, step.created_timestamp asc, step.step_id asc`
	rows, err := r.db.QueryContext(context.Background(), query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.ProjectCriticalPathStep, 0)
	for rows.Next() {
		item, err := scanProjectCriticalPathStep(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) UpsertProjectCriticalPathStep(input ProjectCriticalPathStepInput) (domain.ProjectCriticalPathStep, error) {
	input, err := NormalizeProjectCriticalPathStepInput(input)
	if err != nil {
		return domain.ProjectCriticalPathStep{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.ProjectCriticalPathStep{}, err
	}
	defer tx.Rollback()
	if input.RelationshipID != "" {
		var relationshipExists bool
		if err := tx.QueryRowContext(ctx, `
select exists (
  select 1
  from project_relationships
  where company_id=$1::uuid
    and project_id=$2::uuid
    and relationship_id=$3::uuid
)`, input.CompanyID, input.ProjectID, input.RelationshipID).Scan(&relationshipExists); err != nil {
			return domain.ProjectCriticalPathStep{}, err
		}
		if !relationshipExists {
			return domain.ProjectCriticalPathStep{}, ErrNotFound
		}
	}
	if input.IsCurrent {
		if _, err := tx.ExecContext(ctx, `
update project_critical_path_steps
set is_current=false,
    updated_timestamp=now()
where company_id=$1::uuid
  and project_id=$2::uuid
  and step_id<>$3::uuid`, input.CompanyID, input.ProjectID, input.StepID); err != nil {
			return domain.ProjectCriticalPathStep{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `
insert into project_critical_path_steps (
  company_id,
  project_id,
  step_id,
  name,
  relationship_id,
  due_date,
  owner_type,
  owner_id,
  position,
  is_current,
  created_timestamp,
  updated_timestamp
) values (
  $1::uuid,
  $2::uuid,
  $3::uuid,
  $4,
  nullif($5, '')::uuid,
  nullif($6, '')::date,
  $7,
  nullif($8, '')::uuid,
  $9,
  $10,
  now(),
  now()
)
on conflict (company_id, project_id, step_id)
do update set
  name=excluded.name,
  relationship_id=excluded.relationship_id,
  due_date=excluded.due_date,
  owner_type=excluded.owner_type,
  owner_id=excluded.owner_id,
  position=excluded.position,
  is_current=excluded.is_current,
  updated_timestamp=now()`,
		input.CompanyID,
		input.ProjectID,
		input.StepID,
		input.Name,
		input.RelationshipID,
		input.DueDate,
		input.OwnerType,
		input.OwnerID,
		input.Position,
		input.IsCurrent,
	); err != nil {
		return domain.ProjectCriticalPathStep{}, err
	}
	item, err := scanProjectCriticalPathStep(tx.QueryRowContext(ctx, projectCriticalPathSelectSQL+`
where step.company_id=$1::uuid
  and step.project_id=$2::uuid
  and step.step_id=$3::uuid`, input.CompanyID, input.ProjectID, input.StepID))
	if err != nil {
		return domain.ProjectCriticalPathStep{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.ProjectCriticalPathStep{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteProjectCriticalPathStep(input ProjectCriticalPathStepDeleteInput) error {
	input, err := NormalizeProjectCriticalPathStepDeleteInput(input)
	if err != nil {
		return err
	}
	result, err := r.db.ExecContext(context.Background(), `
delete from project_critical_path_steps
where company_id=$1::uuid
  and project_id=$2::uuid
  and step_id=$3::uuid`, input.CompanyID, input.ProjectID, input.StepID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

const projectCriticalPathSelectSQL = `
select
  step.company_id::text,
  step.project_id::text,
  step.step_id::text,
  step.name,
  step.relationship_id::text,
  coalesce(projection.resource_type, '') as resource_type,
  projection.resource_id::text,
  projection.logic_gate_id::text,
  projection.node_id::text,
  coalesce(projection.display_title, '') as display_title,
  projection.status,
  step.due_date::text,
  step.owner_type,
  step.owner_id::text,
  coalesce(nullif(owner_user.display_name, ''), owner_user.email, owner_group.name, '') as owner_label,
  step.position,
  step.is_current,
  step.created_timestamp,
  step.updated_timestamp
from project_critical_path_steps step
left join project_relationship_projection projection
  on projection.company_id=step.company_id
 and projection.project_id=step.project_id
 and projection.relationship_id=step.relationship_id
 /* viewer_access */
left join users owner_user
  on step.owner_type='user'
 and owner_user.user_id=step.owner_id
left join company_user_groups owner_group
  on step.owner_type='group'
 and owner_group.company_id=step.company_id
 and owner_group.group_id=step.owner_id
`

func (r *PostgresRepo) UpsertProjectRelationship(input ProjectRelationshipInput) (ProjectRelationshipMutationResult, error) {
	input, err := NormalizeProjectRelationshipInput(input)
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	defer tx.Rollback()

	var logicGateID string
	err = tx.QueryRowContext(ctx, `
select logic_gate_id::text
from node_logic_gate_assignments
where company_id=$1::uuid and node_id=$2::uuid
order by updated_timestamp desc, created_timestamp desc, assignment_id desc
limit 1`, input.CompanyID, input.ResourceID).Scan(&logicGateID)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectRelationshipMutationResult{}, ErrProjectNodeLogicGateRequired
	}
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}

	gateRelationshipID, err := upsertProjectRelationshipSourceTx(ctx, tx, ProjectRelationshipInput{
		CompanyID: input.CompanyID, ProjectID: input.ProjectID, ResourceType: EntityTypeLogicGate,
		ResourceID: logicGateID, Position: input.Position,
	})
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	nodeRelationshipID, err := upsertProjectRelationshipSourceTx(ctx, tx, input)
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	for _, relationshipID := range []string{gateRelationshipID, nodeRelationshipID} {
		if err := syncProjectRelationshipProjectionDependenciesTx(ctx, tx, ProjectRelationshipProjectionDependencyInput{
			CompanyID: input.CompanyID, RelationshipID: relationshipID,
		}); err != nil {
			return ProjectRelationshipMutationResult{}, err
		}
	}
	gateProjection, err := projectRelationshipProjectionByIDTx(ctx, tx, input.CompanyID, gateRelationshipID)
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	nodeProjection, err := projectRelationshipProjectionByIDTx(ctx, tx, input.CompanyID, nodeRelationshipID)
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	return ProjectRelationshipMutationResult{
		Relationship:          &nodeProjection,
		ImplicitRelationships: []domain.ProjectRelationshipProjection{gateProjection},
	}, nil
}

func upsertProjectRelationshipSourceTx(ctx context.Context, tx *sql.Tx, input ProjectRelationshipInput) (string, error) {
	relationshipID := cleanUUIDText(input.RelationshipID)
	if relationshipID == "" {
		relationshipID = newUUIDv7String()
	}
	var returnedID string
	err := tx.QueryRowContext(ctx, `
insert into project_relationships (
  company_id, relationship_id, project_id, resource_type, resource_id, position, created_timestamp, updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, now(), now())
on conflict (company_id, resource_type, resource_id)
do update set
  project_id=excluded.project_id,
  position=excluded.position,
  updated_timestamp=now()
returning relationship_id::text`, input.CompanyID, relationshipID, input.ProjectID, input.ResourceType, input.ResourceID, input.Position).Scan(&returnedID)
	if err == nil && input.ResourceType == EntityTypeNode {
		_, err = tx.ExecContext(ctx, `select mangorts_bump_logic_gate_work_versions_for_node($1::uuid, $2::uuid)`, input.CompanyID, input.ResourceID)
	}
	return returnedID, err
}
func (r *PostgresRepo) DeleteProjectRelationship(input ProjectRelationshipDeleteInput) (ProjectRelationshipMutationResult, error) {
	input, err := NormalizeProjectRelationshipDeleteInput(input)
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	defer tx.Rollback()
	projectionBefore, err := projectRelationshipProjectionRowsForRelationshipTx(ctx, tx, input.CompanyID, input.RelationshipID)
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	result, err := tx.ExecContext(ctx, `
delete from project_relationships
where company_id=$1::uuid
  and project_id=$2::uuid
  and relationship_id=$3::uuid`, input.CompanyID, input.ProjectID, input.RelationshipID)
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	if affected == 0 {
		return ProjectRelationshipMutationResult{}, ErrNotFound
	}
	for _, row := range projectionBefore {
		if strings.TrimSpace(row.NodeID) == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, "select mangorts_bump_logic_gate_work_versions_for_node($1::uuid, $2::uuid)", input.CompanyID, row.NodeID); err != nil {
			return ProjectRelationshipMutationResult{}, err
		}
	}
	err = syncProjectRelationshipProjectionDependenciesTx(ctx, tx, ProjectRelationshipProjectionDependencyInput{
		CompanyID:      input.CompanyID,
		RelationshipID: input.RelationshipID,
		Delete:         true,
		BeforeRows:     projectionBefore,
	})
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	return ProjectRelationshipMutationResult{DeletedRelationshipID: input.RelationshipID}, nil
}

func (r *PostgresRepo) ListProjectRelationshipProjections(companyID, projectID string) ([]domain.ProjectRelationshipProjection, error) {
	return r.ListProjectRelationshipProjectionsForViewer(companyID, projectID, "")
}

func (r *PostgresRepo) ListProjectRelationshipProjectionsForViewer(companyID, projectID, viewerUserID string) ([]domain.ProjectRelationshipProjection, error) {
	companyID = cleanUUIDText(companyID)
	projectID = cleanUUIDText(projectID)
	viewerUserID = cleanUUIDText(viewerUserID)
	if companyID == "" || projectID == "" {
		return nil, ErrInvalid
	}
	query := projectRelationshipProjectionSelectSQL + `
where projection.company_id=$1::uuid
  and projection.project_id=$2::uuid`
	args := []any{companyID, projectID}
	if viewerUserID != "" {
		query += `
  and mangorts_user_can_access_resource(projection.company_id, 'project', projection.project_id, $3::uuid, $4::text)
  and mangorts_user_can_access_resource(projection.company_id, projection.resource_type, projection.resource_id, $3::uuid, $4::text)`
		args = append(args, viewerUserID, EntityPermissionEdit)
	}
	query += `
order by projection.position asc, lower(projection.display_title) asc, projection.relationship_id asc`
	rows, err := r.db.QueryContext(context.Background(), query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanProjectRelationshipProjectionRows(rows)
}

func (r *PostgresRepo) ListProjectRelationshipsForResource(companyID, resourceType, resourceID, viewerUserID string) ([]domain.ProjectRelationshipProjection, error) {
	resourceType, ok := NormalizeEntityType(resourceType)
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	viewerUserID = cleanUUIDText(viewerUserID)
	if companyID == "" || resourceID == "" || !ok {
		return nil, ErrInvalid
	}
	query := projectRelationshipProjectionSelectSQL + `
where projection.company_id=$1::uuid
  and projection.resource_type=$2
  and projection.resource_id=$3::uuid`
	args := []any{companyID, resourceType, resourceID}
	if viewerUserID != "" {
		query += ` and mangorts_user_can_access_resource(projection.company_id, 'project', projection.project_id, $4::uuid, $5::text)`
		args = append(args, viewerUserID, EntityPermissionEdit)
	}
	query += ` order by lower(projection.display_title) asc, projection.project_id asc`
	rows, err := r.db.QueryContext(context.Background(), query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanProjectRelationshipProjectionRows(rows)
}

const projectRelationshipProjectionSelectSQL = `
select
  projection.company_id::text,
  projection.project_id::text,
  coalesce(nullif(project.name, ''), projection.project_id::text) as project_name,
  projection.relationship_id::text,
  projection.resource_type,
  projection.resource_id::text,
  projection.logic_gate_id::text,
  projection.node_id::text,
  projection.assignment_id::text,
  projection.display_title,
  projection.status,
  projection.created_from_email,
  projection.position,
  projection.resource_created_timestamp,
  projection.relationship_created_timestamp,
  projection.relationship_updated_timestamp,
  projection.projection_updated_timestamp
from project_relationship_projection projection
left join projects project
  on project.company_id=projection.company_id
 and project.project_id=projection.project_id
`

func scanProjectRelationshipProjectionRows(rows *sql.Rows) ([]domain.ProjectRelationshipProjection, error) {
	items := make([]domain.ProjectRelationshipProjection, 0)
	for rows.Next() {
		item, err := scanProjectRelationshipProjection(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func projectRelationshipProjectionByIDTx(ctx context.Context, tx *sql.Tx, companyID, relationshipID string) (domain.ProjectRelationshipProjection, error) {
	item, err := scanProjectRelationshipProjection(tx.QueryRowContext(ctx, projectRelationshipProjectionSelectSQL+`
where projection.company_id=$1::uuid
  and projection.relationship_id=$2::uuid`, companyID, relationshipID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ProjectRelationshipProjection{}, ErrNotFound
	}
	return item, err
}

func syncProjectRelationshipProjectionTx(ctx context.Context, tx *sql.Tx, companyID, relationshipID string) error {
	return syncProjectRelationshipProjectionForRelationshipTx(ctx, tx, companyID, relationshipID)
}

func postgresDeleteProjectTx(ctx context.Context, tx *sql.Tx, companyID, projectID string) error {
	if _, err := tx.ExecContext(ctx, `delete from company_explorer_items where company_id=$1::uuid and target_type='project' and target_id=$2::uuid`, companyID, projectID); err != nil {
		return err
	}
	if err := execOptionalPostgresShapeCleanupTx(tx, "resource_permissions", `delete from resource_permissions where company_id=$1::uuid and resource_type='project' and resource_id=$2::uuid`, companyID, projectID); err != nil {
		return err
	}
	deleted, err := tx.ExecContext(ctx, `delete from projects where company_id=$1::uuid and project_id=$2::uuid`, companyID, projectID)
	if err != nil {
		return err
	}
	affected, err := deleted.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}
