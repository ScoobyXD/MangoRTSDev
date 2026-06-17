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
with scope_groups as (
  select member.group_id
  from company_user_group_members member
  where member.company_id=$1::uuid
    and member.user_id=$3::uuid
),
scope_users as (
  select $3::uuid as user_id
  where $3::uuid is not null
  union
  select member.user_id
  from company_user_group_members member
  join scope_groups scope_group on scope_group.group_id=member.group_id
  where member.company_id=$1::uuid
)`

func companyExplorerLazyFolderScopePredicate(alias string) string {
	return `(
    $2::text='all'
    or coalesce(` + alias + `.scope_type, 'company')='company'
    or (
      $2::text='me'
      and coalesce(` + alias + `.scope_type, 'company')='user'
      and ` + alias + `.scope_id=$3::text
    )
    or (
      $2::text='team'
      and (
        (coalesce(` + alias + `.scope_type, 'company')='team' and ` + alias + `.scope_id in (select group_id::text from scope_groups))
        or (coalesce(` + alias + `.scope_type, 'company')='user' and ` + alias + `.scope_id in (select user_id::text from scope_users))
      )
    )
  )`
}

func companyExplorerLazyNodeScopePredicate(alias string) string {
	return `(
    $2::text='all'
    or ($2::text='me' and ` + alias + `.assignee_user_id=$3::uuid)
    or ($2::text='team' and ` + alias + `.assignee_user_id in (select user_id from scope_users))
    or exists (
      select 1
      from node_logic_gate_assignments node_gate
      join logic_gate_raci_assignments assignment
        on assignment.company_id=node_gate.company_id
       and assignment.logic_gate_id=node_gate.logic_gate_id
      where node_gate.company_id=` + alias + `.company_id
        and node_gate.node_id=` + alias + `.node_id
        and (
          ($2::text='me' and assignment.user_id=$3::uuid)
          or ($2::text='team' and assignment.user_id in (select user_id from scope_users))
        )
    )
  )`
}

func companyExplorerLazyLogicGateScopePredicate(alias string) string {
	return `(
    $2::text='all'
    or exists (
      select 1
      from logic_gate_raci_assignments assignment
      where assignment.company_id=` + alias + `.company_id
        and assignment.logic_gate_id=` + alias + `.logic_gate_id
        and (
          ($2::text='me' and assignment.user_id=$3::uuid)
          or ($2::text='team' and assignment.user_id in (select user_id from scope_users))
        )
    )
  )`
}

func companyExplorerLazyProjectScopePredicate(alias string) string {
	return `(
    $2::text='all'
    or (
      $2::text='team'
      and exists (
        select 1
        from project_team_assignments assignment
        where assignment.company_id=` + alias + `.company_id
          and assignment.project_id=` + alias + `.project_id
          and assignment.team_id in (select group_id from scope_groups)
      )
    )
  )`
}

func companyExplorerLazyFolderItemScopePredicate(alias string) string {
	return `(
    (` + alias + `.item_type='node' and exists (
      select 1
      from nodes n
      where n.company_id=` + alias + `.company_id
        and n.node_id=` + alias + `.item_id::uuid
        and ` + companyExplorerLazyNodeScopePredicate("n") + `
    ))
    or (` + alias + `.item_type='logic_gate' and exists (
      select 1
      from logic_gates gate
      where gate.company_id=` + alias + `.company_id
        and gate.logic_gate_id=` + alias + `.item_id::uuid
        and ` + companyExplorerLazyLogicGateScopePredicate("gate") + `
    ))
    or (` + alias + `.item_type='project' and exists (
      select 1
      from projects project
      where project.company_id=` + alias + `.company_id
        and project.project_id=` + alias + `.item_id::uuid
        and ` + companyExplorerLazyProjectScopePredicate("project") + `
    ))
  )`
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
select folder.company_id, folder.folder_id, folder.parent_folder_id, folder.folder_kind, folder.system_key, folder.name, ` + companyExplorerFolderAccountEmailColumn(true, "folder") + `, ` + companyExplorerFolderScopeColumns("folder") + `, folder.position, folder.created_timestamp, folder.updated_timestamp,
       ` + companyExplorerLazyFolderAccessSelect("folder") + `
from company_explorer_folders folder
where folder.company_id=$1::uuid
  and folder.folder_kind <> 'communications'
  and (folder.system_key is null or folder.system_key <> 'kanban_boards')
  and ` + parentClause + `
  and ` + companyExplorerLazyFolderScopePredicate("folder") + `
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
select item.company_id, item.folder_id, item.item_type, item.item_id, item.position, item.created_timestamp, item.updated_timestamp
from company_explorer_folder_items item
join company_explorer_folders folder
  on folder.company_id=item.company_id
 and folder.folder_id=item.folder_id
where item.company_id=$1::uuid
  and item.folder_id=$5::uuid
  and item.item_type <> 'kanban'
  and folder.folder_kind <> 'communications'
  and `+companyExplorerLazyFolderScopePredicate("folder")+`
  and `+companyExplorerLazyFolderItemScopePredicate("item")+`
  and (
    $4::uuid is null
    or (
      mangorts_user_can_access_resource(item.company_id, 'company_explorer_folder', item.folder_id, $4::uuid, $6::text)
      and (
        item.item_type not in ('node', 'logic_gate', 'project')
        or mangorts_user_can_access_resource(item.company_id, item.item_type, item.item_id::uuid, $4::uuid, $6::text)
      )
    )
  )
order by item.position asc, item.created_timestamp asc, item.item_type asc, item.item_id asc`, companyExplorerLazyArgs(query)...)
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
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1::uuid
  and not exists (
    select 1
    from company_explorer_folder_items item
    where item.company_id=n.company_id
      and item.item_type='node'
      and item.item_id=n.node_id::text
  )
  and ($4::uuid is null or mangorts_user_can_access_resource(n.company_id, 'node', n.node_id, $4::uuid, $6::text))
  and `+companyExplorerLazyNodeScopePredicate("n")+`
order by n.created_timestamp asc, n.node_id::text asc`, companyExplorerLazyArgs(query)...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerNodeSummaryRows(rows)
}

func (r *PostgresRepo) queryCompanyExplorerLazyFolderNodes(ctx context.Context, query CompanyExplorerLazyRowsQuery) ([]domain.Node, error) {
	rows, err := r.db.QueryContext(ctx, companyExplorerLazyScopeCTE+`
select `+nodeSelectColumns+`
from company_explorer_folder_items item
join company_explorer_folders folder
  on folder.company_id=item.company_id
 and folder.folder_id=item.folder_id
join nodes n
  on n.company_id=item.company_id
 and n.node_id=item.item_id::uuid
`+nodeStatusJoin+`
where item.company_id=$1::uuid
  and item.folder_id=$5::uuid
  and item.item_type='node'
  and folder.folder_kind <> 'communications'
  and `+companyExplorerLazyFolderScopePredicate("folder")+`
  and `+companyExplorerLazyNodeScopePredicate("n")+`
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
from logic_gates gate
where gate.company_id=$1::uuid
  and not exists (
    select 1
    from company_explorer_folder_items item
    where item.company_id=gate.company_id
      and item.item_type='logic_gate'
      and item.item_id=gate.logic_gate_id::text
  )
  and ($4::uuid is null or mangorts_user_can_access_resource(gate.company_id, 'logic_gate', gate.logic_gate_id, $4::uuid, $6::text))
  and `+companyExplorerLazyLogicGateScopePredicate("gate")+`
order by gate.created_timestamp asc, gate.logic_gate_id::text asc`, companyExplorerLazyArgs(query)...)
	if err != nil {
		return nil, err
	}
	items, err := scanCompanyExplorerLogicGateSummaryRows(rows)
	if err != nil {
		return nil, err
	}
	return r.attachLogicGateRaciAssignments(ctx, query.CompanyID, items)
}

func (r *PostgresRepo) queryCompanyExplorerLazyFolderLogicGates(ctx context.Context, query CompanyExplorerLazyRowsQuery) ([]domain.LogicGate, error) {
	rows, err := r.db.QueryContext(ctx, companyExplorerLazyScopeCTE+`
select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
from company_explorer_folder_items item
join company_explorer_folders folder
  on folder.company_id=item.company_id
 and folder.folder_id=item.folder_id
join logic_gates gate
  on gate.company_id=item.company_id
 and gate.logic_gate_id=item.item_id::uuid
where item.company_id=$1::uuid
  and item.folder_id=$5::uuid
  and item.item_type='logic_gate'
  and folder.folder_kind <> 'communications'
  and `+companyExplorerLazyFolderScopePredicate("folder")+`
  and `+companyExplorerLazyLogicGateScopePredicate("gate")+`
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
	return r.attachLogicGateRaciAssignments(ctx, query.CompanyID, items)
}

func (r *PostgresRepo) queryCompanyExplorerLazyRootProjects(ctx context.Context, query CompanyExplorerLazyRowsQuery) ([]domain.Project, error) {
	rows, err := r.db.QueryContext(ctx, companyExplorerLazyScopeCTE+`
select `+projectSelectColumns+`
from projects project
where project.company_id=$1::uuid
  and not exists (
    select 1
    from company_explorer_folder_items item
    where item.company_id=project.company_id
      and item.item_type='project'
      and item.item_id=project.project_id::text
  )
  and ($4::uuid is null or mangorts_user_can_access_resource(project.company_id, 'project', project.project_id, $4::uuid, $6::text))
  and `+companyExplorerLazyProjectScopePredicate("project")+`
order by lower(project.name) asc, project.project_id::text asc`, companyExplorerLazyArgs(query)...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerLazyProjectRows(ctx, r.db, rows)
}

func (r *PostgresRepo) queryCompanyExplorerLazyFolderProjects(ctx context.Context, query CompanyExplorerLazyRowsQuery) ([]domain.Project, error) {
	rows, err := r.db.QueryContext(ctx, companyExplorerLazyScopeCTE+`
select `+projectSelectColumns+`
from company_explorer_folder_items item
join company_explorer_folders folder
  on folder.company_id=item.company_id
 and folder.folder_id=item.folder_id
join projects project
  on project.company_id=item.company_id
 and project.project_id=item.item_id::uuid
where item.company_id=$1::uuid
  and item.folder_id=$5::uuid
  and item.item_type='project'
  and folder.folder_kind <> 'communications'
  and `+companyExplorerLazyFolderScopePredicate("folder")+`
  and `+companyExplorerLazyProjectScopePredicate("project")+`
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
