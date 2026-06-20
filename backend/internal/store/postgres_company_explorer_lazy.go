package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) ListCompanyExplorerRootRows(query CompanyExplorerLazyRowsQuery) (CompanyExplorerLazyRows, error) {
	query, err := normalizeCompanyExplorerLazyRowsQuery(query, false)
	if err != nil {
		return CompanyExplorerLazyRows{}, err
	}
	ctx := context.Background()
	rows := CompanyExplorerLazyRows{}
	if rows.Folders, err = r.queryCompanyExplorerLazyFolders(ctx, query, true); err != nil {
		return CompanyExplorerLazyRows{}, err
	}
	if rows.Nodes, err = r.queryCompanyExplorerLazyRootNodes(ctx, query); err != nil {
		return CompanyExplorerLazyRows{}, err
	}
	if rows.LogicGates, err = r.queryCompanyExplorerLazyRootLogicGates(ctx, query); err != nil {
		return CompanyExplorerLazyRows{}, err
	}
	if rows.Projects, err = r.queryCompanyExplorerLazyRootProjects(ctx, query); err != nil {
		return CompanyExplorerLazyRows{}, err
	}
	return rows, nil
}

func (r *PostgresRepo) ListCompanyExplorerFolderChildRows(query CompanyExplorerLazyRowsQuery) (CompanyExplorerLazyRows, error) {
	query, err := normalizeCompanyExplorerLazyRowsQuery(query, true)
	if err != nil {
		return CompanyExplorerLazyRows{}, err
	}
	ctx := context.Background()
	if _, err := r.getCompanyExplorerFolder(ctx, query.CompanyID, query.ParentID, true); err != nil {
		if err == sql.ErrNoRows {
			return CompanyExplorerLazyRows{}, ErrNotFound
		}
		return CompanyExplorerLazyRows{}, err
	}
	rows := CompanyExplorerLazyRows{}
	if rows.Folders, err = r.queryCompanyExplorerLazyFolders(ctx, query, false); err != nil {
		return CompanyExplorerLazyRows{}, err
	}
	if rows.FolderItems, err = r.queryCompanyExplorerLazyFolderItems(ctx, query); err != nil {
		return CompanyExplorerLazyRows{}, err
	}
	if rows.Nodes, err = r.queryCompanyExplorerLazyFolderNodes(ctx, query); err != nil {
		return CompanyExplorerLazyRows{}, err
	}
	if rows.LogicGates, err = r.queryCompanyExplorerLazyFolderLogicGates(ctx, query); err != nil {
		return CompanyExplorerLazyRows{}, err
	}
	if rows.Projects, err = r.queryCompanyExplorerLazyFolderProjects(ctx, query); err != nil {
		return CompanyExplorerLazyRows{}, err
	}
	return rows, nil
}

func (r *PostgresRepo) ListCompanyExplorerLogicGateChildRows(query CompanyExplorerLazyRowsQuery) (CompanyExplorerLazyRows, error) {
	query, err := normalizeCompanyExplorerLazyRowsQuery(query, true)
	if err != nil {
		return CompanyExplorerLazyRows{}, err
	}
	nodes, err := r.queryCompanyExplorerLazyLogicGateNodes(context.Background(), query)
	if err != nil {
		return CompanyExplorerLazyRows{}, err
	}
	return CompanyExplorerLazyRows{Nodes: nodes}, nil
}

func companyExplorerLazyNullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func companyExplorerLazyArgs(query CompanyExplorerLazyRowsQuery) []any {
	return []any{
		query.CompanyID,
		query.Scope,
		companyExplorerLazyNullable(query.ScopeUserID),
		companyExplorerLazyNullable(query.PermissionUserID),
		companyExplorerLazyNullable(query.ParentID),
		EntityPermissionView,
	}
}

const companyExplorerLazyScopeCTE = `
with lazy_params as (
  select $4::uuid as permission_user_id,
         $5::uuid as parent_id,
         $6::text as access_level
)`

func companyExplorerLazyFolderScopePredicate(alias string) string {
	return `true`
}

func companyExplorerLazyNodeScopePredicate(alias string) string {
	return `true`
}

func companyExplorerLazyLogicGateScopePredicate(alias string) string {
	return `true`
}

func companyExplorerLazyProjectScopePredicate(alias string) string {
	return `true`
}

func companyExplorerLazyFolderItemScopePredicate(alias string) string {
	return `true`
}

func companyExplorerLazyFolderAccessSelect(alias string) string {
	return `case
    when $4::uuid is null then ''
    when exists (
      select 1
      from company_memberships membership
      where membership.user_id=$4::uuid
        and (
          membership.role='dev_admin'
          or (membership.company_id=$1::uuid and membership.role='company_admin')
        )
    ) then 'admin'
    when mangorts_user_can_access_resource(` + alias + `.company_id, 'company_explorer_folder', ` + alias + `.folder_id, $4::uuid, 'edit') then 'edit'
    else 'view'
  end as effective_access`
}

func (r *PostgresRepo) queryCompanyExplorerLazyFolders(ctx context.Context, query CompanyExplorerLazyRowsQuery, root bool) ([]domain.CompanyExplorerFolder, error) {
	parentClause := "folder.parent_folder_id=$5::uuid"
	if root {
		parentClause = "folder.parent_folder_id is null"
	}
	sqlText := companyExplorerLazyScopeCTE + `
select folder.company_id, folder.folder_id, folder.parent_folder_id, 'folder'::text as folder_kind, null::text as system_key, folder.name, ` + companyExplorerFolderAccountEmailColumn(true, "folder") + `, ` + companyExplorerFolderScopeColumns("folder") + `, folder.position, folder.created_timestamp, folder.updated_timestamp,
       ` + companyExplorerLazyFolderAccessSelect("folder") + `
from company_explorer_folders folder
where folder.company_id=$1::uuid
  and ` + parentClause + `
  and ($4::uuid is null or mangorts_user_can_access_resource(folder.company_id, 'company_explorer_folder', folder.folder_id, $4::uuid, $6::text))
order by folder.position asc, folder.created_timestamp asc, folder.folder_id::text asc`
	rows, err := r.db.QueryContext(ctx, sqlText, companyExplorerLazyArgs(query)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.CompanyExplorerFolder, 0)
	for rows.Next() {
		item, err := scanCompanyExplorerFolderWithEffectiveAccess(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) queryCompanyExplorerLazyFolderItems(ctx context.Context, query CompanyExplorerLazyRowsQuery) ([]domain.CompanyExplorerFolderItem, error) {
	rows, err := r.db.QueryContext(ctx, companyExplorerLazyScopeCTE+`
select item.company_id::text, item.parent_folder_id::text, item.target_type, item.target_id::text, item.position, item.created_timestamp, item.updated_timestamp
from company_explorer_items item
join company_explorer_folders folder
  on folder.company_id=item.company_id
 and folder.folder_id=item.parent_folder_id
where item.company_id=$1::uuid
  and item.parent_folder_id=$5::uuid
  and (
    $4::uuid is null
    or (
      mangorts_user_can_access_resource(item.company_id, 'company_explorer_folder', item.parent_folder_id, $4::uuid, $6::text)
      and (
        item.target_type not in ('node', 'logic_gate', 'project')
        or mangorts_user_can_access_resource(item.company_id, item.target_type, item.target_id, $4::uuid, $6::text)
      )
    )
  )
order by item.position asc, item.created_timestamp asc, item.target_type asc, item.target_id asc`, companyExplorerLazyArgs(query)...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerLazyFolderItemRows(rows)
}

func scanCompanyExplorerLazyFolderItemRows(rows *sql.Rows) ([]domain.CompanyExplorerFolderItem, error) {
	defer rows.Close()
	items := make([]domain.CompanyExplorerFolderItem, 0)
	for rows.Next() {
		var item domain.CompanyExplorerFolderItem
		if err := rows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&item.ItemType,
			&item.ItemID,
			&item.Position,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) queryCompanyExplorerLazyRootNodes(ctx context.Context, query CompanyExplorerLazyRowsQuery) ([]domain.Node, error) {
	rows, err := r.db.QueryContext(ctx, companyExplorerLazyScopeCTE+`
select `+nodeSelectColumns+`
from company_explorer_items item
join nodes n
  on n.company_id=item.company_id
 and n.node_id=item.target_id
`+nodeStatusJoin+`
where item.company_id=$1::uuid
  and item.parent_folder_id is null
  and item.target_type='node'
  and ($4::uuid is null or mangorts_user_can_access_resource(n.company_id, 'node', n.node_id, $4::uuid, $6::text))
order by item.position asc, item.created_timestamp asc, n.node_id::text asc`, companyExplorerLazyArgs(query)...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerNodeSummaryRows(rows)
}

func (r *PostgresRepo) queryCompanyExplorerLazyFolderNodes(ctx context.Context, query CompanyExplorerLazyRowsQuery) ([]domain.Node, error) {
	rows, err := r.db.QueryContext(ctx, companyExplorerLazyScopeCTE+`
select `+nodeSelectColumns+`
from company_explorer_items item
join company_explorer_folders folder
  on folder.company_id=item.company_id
 and folder.folder_id=item.parent_folder_id
join nodes n
  on n.company_id=item.company_id
 and n.node_id=item.target_id
`+nodeStatusJoin+`
where item.company_id=$1::uuid
  and item.parent_folder_id=$5::uuid
  and item.target_type='node'
  and (
    $4::uuid is null
    or (
      mangorts_user_can_access_resource(folder.company_id, 'company_explorer_folder', folder.folder_id, $4::uuid, $6::text)
      and mangorts_user_can_access_resource(n.company_id, 'node', n.node_id, $4::uuid, $6::text)
    )
  )
order by item.position asc, item.created_timestamp asc, n.node_id::text asc`, companyExplorerLazyArgs(query)...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerNodeSummaryRows(rows)
}

func (r *PostgresRepo) queryCompanyExplorerLazyLogicGateNodes(ctx context.Context, query CompanyExplorerLazyRowsQuery) ([]domain.Node, error) {
	rows, err := r.db.QueryContext(ctx, companyExplorerLazyScopeCTE+`
select `+nodeSelectColumns+`
from node_logic_gate_assignments logic_gate_assignment
join logic_gates gate
  on gate.company_id=logic_gate_assignment.company_id
 and gate.logic_gate_id=logic_gate_assignment.logic_gate_id
join nodes n
  on n.company_id=logic_gate_assignment.company_id
 and n.node_id=logic_gate_assignment.node_id
`+nodeStatusJoin+`
where logic_gate_assignment.company_id=$1::uuid
  and logic_gate_assignment.logic_gate_id=$5::uuid
  and `+companyExplorerLazyLogicGateScopePredicate("gate")+`
  and ($4::uuid is null or mangorts_user_can_access_resource(n.company_id, 'node', n.node_id, $4::uuid, $6::text))
order by logic_gate_assignment.position asc, logic_gate_assignment.created_timestamp asc, n.node_id::text asc`, companyExplorerLazyArgs(query)...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerNodeSummaryRows(rows)
}

func (r *PostgresRepo) queryCompanyExplorerLazyRootLogicGates(ctx context.Context, query CompanyExplorerLazyRowsQuery) ([]domain.LogicGate, error) {
	rows, err := r.db.QueryContext(ctx, companyExplorerLazyScopeCTE+`
select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
from company_explorer_items item
join logic_gates gate
  on gate.company_id=item.company_id
 and gate.logic_gate_id=item.target_id
where item.company_id=$1::uuid
  and item.parent_folder_id is null
  and item.target_type='logic_gate'
  and ($4::uuid is null or mangorts_user_can_access_resource(gate.company_id, 'logic_gate', gate.logic_gate_id, $4::uuid, $6::text))
order by item.position asc, item.created_timestamp asc, gate.logic_gate_id::text asc`, companyExplorerLazyArgs(query)...)
	if err != nil {
		return nil, err
	}
	items, err := scanCompanyExplorerLogicGateSummaryRows(rows)
	if err != nil {
		return nil, err
	}
	return r.attachLogicGateGVICAssignments(ctx, query.CompanyID, items)
}

func (r *PostgresRepo) queryCompanyExplorerLazyFolderLogicGates(ctx context.Context, query CompanyExplorerLazyRowsQuery) ([]domain.LogicGate, error) {
	rows, err := r.db.QueryContext(ctx, companyExplorerLazyScopeCTE+`
select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
from company_explorer_items item
join company_explorer_folders folder
  on folder.company_id=item.company_id
 and folder.folder_id=item.parent_folder_id
join logic_gates gate
  on gate.company_id=item.company_id
 and gate.logic_gate_id=item.target_id
where item.company_id=$1::uuid
  and item.parent_folder_id=$5::uuid
  and item.target_type='logic_gate'
  and (
    $4::uuid is null
    or (
      mangorts_user_can_access_resource(folder.company_id, 'company_explorer_folder', folder.folder_id, $4::uuid, $6::text)
      and mangorts_user_can_access_resource(gate.company_id, 'logic_gate', gate.logic_gate_id, $4::uuid, $6::text)
    )
  )
order by item.position asc, item.created_timestamp asc, gate.logic_gate_id::text asc`, companyExplorerLazyArgs(query)...)
	if err != nil {
		return nil, err
	}
	items, err := scanCompanyExplorerLogicGateSummaryRows(rows)
	if err != nil {
		return nil, err
	}
	return r.attachLogicGateGVICAssignments(ctx, query.CompanyID, items)
}

func (r *PostgresRepo) queryCompanyExplorerLazyRootProjects(ctx context.Context, query CompanyExplorerLazyRowsQuery) ([]domain.Project, error) {
	rows, err := r.db.QueryContext(ctx, companyExplorerLazyScopeCTE+`
select `+projectSelectColumns+`
from company_explorer_items item
join projects project
  on project.company_id=item.company_id
 and project.project_id=item.target_id
where item.company_id=$1::uuid
  and item.parent_folder_id is null
  and item.target_type='project'
  and ($4::uuid is null or mangorts_user_can_access_resource(project.company_id, 'project', project.project_id, $4::uuid, $6::text))
order by item.position asc, item.created_timestamp asc, project.project_id::text asc`, companyExplorerLazyArgs(query)...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerLazyProjectRows(ctx, r.db, rows)
}

func (r *PostgresRepo) queryCompanyExplorerLazyFolderProjects(ctx context.Context, query CompanyExplorerLazyRowsQuery) ([]domain.Project, error) {
	rows, err := r.db.QueryContext(ctx, companyExplorerLazyScopeCTE+`
select `+projectSelectColumns+`
from company_explorer_items item
join company_explorer_folders folder
  on folder.company_id=item.company_id
 and folder.folder_id=item.parent_folder_id
join projects project
  on project.company_id=item.company_id
 and project.project_id=item.target_id
where item.company_id=$1::uuid
  and item.parent_folder_id=$5::uuid
  and item.target_type='project'
  and (
    $4::uuid is null
    or (
      mangorts_user_can_access_resource(folder.company_id, 'company_explorer_folder', folder.folder_id, $4::uuid, $6::text)
      and mangorts_user_can_access_resource(project.company_id, 'project', project.project_id, $4::uuid, $6::text)
    )
  )
order by item.position asc, item.created_timestamp asc, project.project_id::text asc`, companyExplorerLazyArgs(query)...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerLazyProjectRows(ctx, r.db, rows)
}

func scanCompanyExplorerLazyProjectRows(ctx context.Context, queryer postgresProjectAssignmentQueryer, rows *sql.Rows) ([]domain.Project, error) {
	defer rows.Close()
	items := make([]domain.Project, 0)
	for rows.Next() {
		item, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		item, err = attachProjectAssignmentReadModel(ctx, queryer, item)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
