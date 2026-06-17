package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strings"
)

type companyExplorerV2RowScanner interface {
	Scan(dest ...any) error
}

func companyExplorerV2Args(query CompanyExplorerV2RowsQuery) []any {
	return []any{
		query.CompanyID,
		query.View,
		companyExplorerLazyNullable(query.ScopeUserID),
		companyExplorerLazyNullable(query.PermissionUserID),
		companyExplorerLazyNullable(query.ParentEntityID),
		EntityPermissionView,
	}
}

const companyExplorerV2TypedArgsCTE = `with v2_args as (
  select $2::text as view,
         $3::uuid as scope_user_id,
         $5::uuid as parent_entity_id,
         $6::text as access_level
)
`

const companyExplorerV2TypedArgsJoin = `cross join v2_args
`

func companyExplorerV2AccessPredicate(alias string) string {
	return `(
    $4::uuid is null
    or (
      ` + alias + `.entity_type in ('company', 'user_group', 'user')
      and exists (
        select 1
        from company_memberships membership
        where membership.user_id=$4::uuid
          and (membership.role='dev_admin' or membership.company_id=` + alias + `.company_id)
      )
    )
    or (
      ` + alias + `.entity_type='folder'
      and mangorts_user_can_access_resource(` + alias + `.company_id, 'company_explorer_folder', ` + alias + `.entity_id, $4::uuid, $6::text)
    )
    or (
      ` + alias + `.entity_type in ('node', 'logic_gate', 'project')
      and mangorts_user_can_access_resource(` + alias + `.company_id, ` + alias + `.entity_type, ` + alias + `.resource_id, $4::uuid, $6::text)
    )
  )`
}

func companyExplorerV2EffectiveAccessSelect(alias string) string {
	return `case
    when $4::uuid is null then ''
    when exists (
      select 1
      from company_memberships membership
      where membership.user_id=$4::uuid
        and (
          membership.role='dev_admin'
          or (membership.company_id=` + alias + `.company_id and membership.role='company_admin')
        )
    ) then 'admin'
    when ` + alias + `.entity_type in ('company', 'user_group', 'user') then 'view'
    when ` + alias + `.entity_type='folder'
      and mangorts_user_can_access_resource(` + alias + `.company_id, 'company_explorer_folder', ` + alias + `.entity_id, $4::uuid, 'edit') then 'edit'
    when ` + alias + `.entity_type in ('node', 'logic_gate', 'project')
      and mangorts_user_can_access_resource(` + alias + `.company_id, ` + alias + `.entity_type, ` + alias + `.resource_id, $4::uuid, 'edit') then 'edit'
    else 'view'
  end`
}

func companyExplorerV2NameExpr(alias string) string {
	return `coalesce(
    case ` + alias + `.entity_type
      when 'company' then nullif(company.name, '')
      when 'user_group' then nullif(user_group.name, '')
      when 'user' then nullif(coalesce(nullif(app_user.display_name, ''), app_user.email), '')
      when 'project' then nullif(project.name, '')
      when 'logic_gate' then nullif(logic_gate.header, '')
      when 'node' then nullif(node.title, '')
      else nullif(` + alias + `.name, '')
    end,
    nullif(` + alias + `.name, ''),
    ` + alias + `.resource_id::text,
    ` + alias + `.entity_id::text
  )`
}

func companyExplorerV2HasChildrenExpr(alias string) string {
	return `(
    exists (
      select 1
      from company_explorer_edges child_edge
      where child_edge.company_id=` + alias + `.company_id
        and child_edge.parent_entity_id=` + alias + `.entity_id
    )
    or (
      ` + alias + `.entity_type='company'
      and exists (
        select 1 from company_user_groups child_group
        where child_group.company_id=` + alias + `.company_id
          and child_group.parent_group_id is null
      )
    )
    or (
      ` + alias + `.entity_type='user_group'
      and (
        exists (
          select 1 from company_user_groups child_group
          where child_group.company_id=` + alias + `.company_id
            and child_group.parent_group_id=` + alias + `.resource_id
        )
        or exists (
          select 1 from company_user_group_members child_member
          where child_member.company_id=` + alias + `.company_id
            and child_member.group_id=` + alias + `.resource_id
        )
      )
    )
    or (
      ` + alias + `.entity_type='project'
      and exists (
        select 1 from project_relationship_projection projection
        where projection.company_id=` + alias + `.company_id
          and projection.project_id=` + alias + `.resource_id
      )
    )
    or (
      ` + alias + `.entity_type='logic_gate'
      and exists (
        select 1 from node_logic_gate_assignments assignment
        where assignment.company_id=` + alias + `.company_id
          and assignment.logic_gate_id=` + alias + `.resource_id
      )
    )
  )`
}

func companyExplorerV2Joins(alias string) string {
	return `
left join companies company
  on ` + alias + `.entity_type='company'
 and company.company_id=` + alias + `.resource_id
left join company_user_groups user_group
  on ` + alias + `.entity_type='user_group'
 and user_group.company_id=` + alias + `.company_id
 and user_group.group_id=` + alias + `.resource_id
left join users app_user
  on ` + alias + `.entity_type='user'
 and app_user.user_id=` + alias + `.resource_id
left join projects project
  on ` + alias + `.entity_type='project'
 and project.company_id=` + alias + `.company_id
 and project.project_id=` + alias + `.resource_id
left join logic_gates logic_gate
  on ` + alias + `.entity_type='logic_gate'
 and logic_gate.company_id=` + alias + `.company_id
 and logic_gate.logic_gate_id=` + alias + `.resource_id
left join nodes node
  on ` + alias + `.entity_type='node'
 and node.company_id=` + alias + `.company_id
 and node.node_id=` + alias + `.resource_id`
}

func companyExplorerV2RowSelect(alias, parentExpr, edgeExpr, positionExpr, createdExpr, updatedExpr string) string {
	return alias + `.company_id::text,
       ` + alias + `.entity_id::text,
       ` + alias + `.entity_type,
       coalesce(` + alias + `.resource_id::text, '') as resource_id,
       ` + companyExplorerV2NameExpr(alias) + ` as name,
       coalesce((` + parentExpr + `)::text, '') as parent_entity_id,
       coalesce((` + edgeExpr + `)::text, '') as edge_id,
       ` + positionExpr + ` as position,
       ` + companyExplorerV2HasChildrenExpr(alias) + ` as has_children,
       ` + companyExplorerV2EffectiveAccessSelect(alias) + ` as effective_access,
       jsonb_strip_nulls(jsonb_build_object(
         'entity_id', ` + alias + `.entity_id::text,
         'resource_id', ` + alias + `.resource_id::text,
         'company_id', case when ` + alias + `.entity_type='company' then ` + alias + `.resource_id::text end,
         'user_group_id', case when ` + alias + `.entity_type='user_group' then ` + alias + `.resource_id::text end,
         'user_id', case when ` + alias + `.entity_type='user' then ` + alias + `.resource_id::text end,
         'folder_id', case when ` + alias + `.entity_type='folder' then ` + alias + `.entity_id::text end,
         'project_id', case when ` + alias + `.entity_type='project' then ` + alias + `.resource_id::text end,
         'logic_gate_id', case when ` + alias + `.entity_type='logic_gate' then ` + alias + `.resource_id::text end,
         'node_id', case when ` + alias + `.entity_type='node' then ` + alias + `.resource_id::text end
       ))::text as native_context,
       ` + createdExpr + ` as created_timestamp,
       ` + updatedExpr + ` as updated_timestamp`
}

func scanCompanyExplorerV2Row(row companyExplorerV2RowScanner) (CompanyExplorerV2Row, error) {
	var item CompanyExplorerV2Row
	var nativeContext string
	err := row.Scan(
		&item.CompanyID,
		&item.EntityID,
		&item.EntityType,
		&item.ResourceID,
		&item.Name,
		&item.ParentEntityID,
		&item.EdgeID,
		&item.Position,
		&item.HasChildren,
		&item.EffectiveAccess,
		&nativeContext,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if err != nil {
		return item, err
	}
	if strings.TrimSpace(nativeContext) != "" {
		_ = json.Unmarshal([]byte(nativeContext), &item.NativeContext)
	}
	return item, nil
}

func scanCompanyExplorerV2Rows(rows *sql.Rows) ([]CompanyExplorerV2Row, error) {
	defer rows.Close()
	items := make([]CompanyExplorerV2Row, 0)
	for rows.Next() {
		item, err := scanCompanyExplorerV2Row(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ensureCompanyExplorerV2NativeEntities(ctx context.Context, companyID string) error {
	statements := []string{
		`insert into company_explorer_entities (company_id, entity_id, entity_type, resource_id, name, default_access, created_timestamp, updated_timestamp)
		 select company.company_id, mangorts_company_explorer_v2_entity_id(company.company_id, 'company', company.company_id), 'company', company.company_id, company.name, null, company.created_timestamp, company.updated_timestamp
		 from companies company
		 where company.company_id=$1::uuid
		 on conflict (company_id, entity_type, resource_id) where resource_id is not null do update set
		   name=excluded.name,
		   updated_timestamp=greatest(company_explorer_entities.updated_timestamp, excluded.updated_timestamp)`,
		`insert into company_explorer_entities (company_id, entity_id, entity_type, resource_id, name, default_access, created_timestamp, updated_timestamp)
		 select membership.company_id, mangorts_company_explorer_v2_entity_id(membership.company_id, 'user', membership.user_id), 'user', membership.user_id, nullif(coalesce(nullif(app_user.display_name, ''), app_user.email), ''), null, greatest(membership.created_timestamp, app_user.created_timestamp), greatest(membership.updated_timestamp, app_user.updated_timestamp)
		 from company_memberships membership
		 join users app_user on app_user.user_id=membership.user_id
		 where membership.company_id=$1::uuid
		 on conflict (company_id, entity_type, resource_id) where resource_id is not null do update set
		   name=coalesce(excluded.name, company_explorer_entities.name),
		   updated_timestamp=greatest(company_explorer_entities.updated_timestamp, excluded.updated_timestamp)`,
		`insert into company_explorer_entities (company_id, entity_id, entity_type, resource_id, name, default_access, created_timestamp, updated_timestamp)
		 select user_group.company_id, mangorts_company_explorer_v2_entity_id(user_group.company_id, 'user_group', user_group.group_id), 'user_group', user_group.group_id, user_group.name, null, user_group.created_timestamp, user_group.updated_timestamp
		 from company_user_groups user_group
		 where user_group.company_id=$1::uuid
		 on conflict (company_id, entity_type, resource_id) where resource_id is not null do update set
		   name=excluded.name,
		   updated_timestamp=greatest(company_explorer_entities.updated_timestamp, excluded.updated_timestamp)`,
		`insert into company_explorer_entities (company_id, entity_id, entity_type, resource_id, name, default_access, created_timestamp, updated_timestamp)
		 select project.company_id, mangorts_company_explorer_v2_entity_id(project.company_id, 'project', project.project_id), 'project', project.project_id, project.name, null, project.created_timestamp, project.updated_timestamp
		 from projects project
		 where project.company_id=$1::uuid
		 on conflict (company_id, entity_type, resource_id) where resource_id is not null do update set
		   name=excluded.name,
		   updated_timestamp=greatest(company_explorer_entities.updated_timestamp, excluded.updated_timestamp)`,
		`insert into company_explorer_entities (company_id, entity_id, entity_type, resource_id, name, default_access, created_timestamp, updated_timestamp)
		 select logic_gate.company_id, mangorts_company_explorer_v2_entity_id(logic_gate.company_id, 'logic_gate', logic_gate.logic_gate_id), 'logic_gate', logic_gate.logic_gate_id, logic_gate.header, null, logic_gate.created_timestamp, logic_gate.created_timestamp
		 from logic_gates logic_gate
		 where logic_gate.company_id=$1::uuid
		 on conflict (company_id, entity_type, resource_id) where resource_id is not null do update set
		   name=excluded.name`,
		`insert into company_explorer_entities (company_id, entity_id, entity_type, resource_id, name, default_access, created_timestamp, updated_timestamp)
		 select node.company_id, mangorts_company_explorer_v2_entity_id(node.company_id, 'node', node.node_id), 'node', node.node_id, node.title, null, node.created_timestamp, node.created_timestamp
		 from nodes node
		 where node.company_id=$1::uuid
		 on conflict (company_id, entity_type, resource_id) where resource_id is not null do update set
		   name=coalesce(excluded.name, company_explorer_entities.name),
		   updated_timestamp=greatest(company_explorer_entities.updated_timestamp, excluded.updated_timestamp)`,
	}
	for _, statement := range statements {
		if _, err := r.db.ExecContext(ctx, statement, companyID); err != nil {
			return err
		}
	}
	return nil
}

func (r *PostgresRepo) ListCompanyExplorerV2RootRows(query CompanyExplorerV2RowsQuery) (CompanyExplorerV2Rows, error) {
	query, err := normalizeCompanyExplorerV2RowsQuery(query, false)
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	ctx := context.Background()
	if err := r.ensureCompanyExplorerV2NativeEntities(ctx, query.CompanyID); err != nil {
		return CompanyExplorerV2Rows{}, err
	}

	whereClause := "entity.entity_type='company' and entity.resource_id=$1::uuid"
	positionExpr := "1000"
	if query.View == CompanyExplorerLazyScopeMe {
		whereClause = "entity.entity_type='user' and entity.resource_id=$3::uuid"
	} else if query.View == CompanyExplorerLazyScopeTeam {
		whereClause = `entity.entity_type='user_group'
      and exists (
        select 1
        from company_user_group_members member
        where member.company_id=entity.company_id
          and member.group_id=entity.resource_id
          and member.user_id=$3::uuid
      )`
		positionExpr = "coalesce(user_group.position, 1000)"
	}
	rows, err := r.db.QueryContext(ctx, companyExplorerV2TypedArgsCTE+`
select `+companyExplorerV2RowSelect("entity", "null::uuid", "null::uuid", positionExpr, "entity.created_timestamp", "entity.updated_timestamp")+`
from company_explorer_entities entity
`+companyExplorerV2TypedArgsJoin+`
`+companyExplorerV2Joins("entity")+`
where entity.company_id=$1::uuid
  and `+whereClause+`
  and `+companyExplorerV2AccessPredicate("entity")+`
order by position asc, created_timestamp asc, name asc, entity_id asc`, companyExplorerV2Args(query)...)
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	items, err := scanCompanyExplorerV2Rows(rows)
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	return CompanyExplorerV2Rows{Rows: items}, nil
}

func (r *PostgresRepo) ListCompanyExplorerV2ChildRows(query CompanyExplorerV2RowsQuery) (CompanyExplorerV2Rows, error) {
	query, err := normalizeCompanyExplorerV2RowsQuery(query, true)
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	ctx := context.Background()
	if err := r.ensureCompanyExplorerV2NativeEntities(ctx, query.CompanyID); err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	parent, err := r.getCompanyExplorerV2Parent(ctx, query)
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	items, err := r.queryCompanyExplorerV2StoredChildren(ctx, query)
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	derived, err := r.queryCompanyExplorerV2DerivedChildren(ctx, query, parent)
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	items = append(items, derived...)
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		if items[i].Name != items[j].Name {
			return items[i].Name < items[j].Name
		}
		return items[i].EntityID < items[j].EntityID
	})
	return CompanyExplorerV2Rows{Rows: items}, nil
}

func (r *PostgresRepo) GetCompanyExplorerV2FolderDefaultAccess(companyID, entityID string) (string, error) {
	companyID = cleanUUIDText(companyID)
	entityID = cleanUUIDText(entityID)
	if companyID == "" || entityID == "" {
		return "", ErrInvalid
	}
	return postgresResourceDefaultAccess(context.Background(), r.db, companyID, EntityTypeCompanyExplorerFolder, entityID)
}

func (r *PostgresRepo) getCompanyExplorerV2Parent(ctx context.Context, query CompanyExplorerV2RowsQuery) (CompanyExplorerV2Row, error) {
	item, err := scanCompanyExplorerV2Row(r.db.QueryRowContext(ctx, companyExplorerV2TypedArgsCTE+`
select `+companyExplorerV2RowSelect("entity", "null::uuid", "null::uuid", "1000", "entity.created_timestamp", "entity.updated_timestamp")+`
from company_explorer_entities entity
`+companyExplorerV2TypedArgsJoin+`
`+companyExplorerV2Joins("entity")+`
where entity.company_id=$1::uuid
  and entity.entity_id=$5::uuid
  and `+companyExplorerV2AccessPredicate("entity")+`
limit 1`, companyExplorerV2Args(query)...))
	if errors.Is(err, sql.ErrNoRows) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	return item, err
}

func (r *PostgresRepo) queryCompanyExplorerV2StoredChildren(ctx context.Context, query CompanyExplorerV2RowsQuery) ([]CompanyExplorerV2Row, error) {
	rows, err := r.db.QueryContext(ctx, companyExplorerV2TypedArgsCTE+`
select `+companyExplorerV2RowSelect("entity", "edge.parent_entity_id", "edge.edge_id", "edge.position", "edge.created_timestamp", "edge.updated_timestamp")+`
from company_explorer_edges edge
join company_explorer_entities entity
  on entity.company_id=edge.company_id
 and entity.entity_id=edge.child_entity_id
`+companyExplorerV2TypedArgsJoin+`
`+companyExplorerV2Joins("entity")+`
where edge.company_id=$1::uuid
  and edge.parent_entity_id=$5::uuid
  and `+companyExplorerV2AccessPredicate("entity")+`
order by edge.position asc, edge.created_timestamp asc, name asc, entity.entity_id asc`, companyExplorerV2Args(query)...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerV2Rows(rows)
}

func (r *PostgresRepo) queryCompanyExplorerV2DerivedChildren(ctx context.Context, query CompanyExplorerV2RowsQuery, parent CompanyExplorerV2Row) ([]CompanyExplorerV2Row, error) {
	switch parent.EntityType {
	case CompanyExplorerV2EntityCompany:
		return r.queryCompanyExplorerV2DerivedGroups(ctx, query, "child_group.parent_group_id is null", []any{})
	case CompanyExplorerV2EntityUserGroup:
		items, err := r.queryCompanyExplorerV2DerivedGroups(ctx, query, "child_group.parent_group_id=$7::uuid", []any{parent.ResourceID})
		if err != nil {
			return nil, err
		}
		users, err := r.queryCompanyExplorerV2DerivedGroupUsers(ctx, query, parent.ResourceID)
		if err != nil {
			return nil, err
		}
		return append(items, users...), nil
	case CompanyExplorerV2EntityProject:
		return r.queryCompanyExplorerV2DerivedProjectChildren(ctx, query, parent.ResourceID)
	case CompanyExplorerV2EntityLogicGate:
		return r.queryCompanyExplorerV2DerivedLogicGateNodes(ctx, query, parent.ResourceID)
	default:
		return nil, nil
	}
}

func (r *PostgresRepo) queryCompanyExplorerV2DerivedGroups(ctx context.Context, query CompanyExplorerV2RowsQuery, groupPredicate string, extraArgs []any) ([]CompanyExplorerV2Row, error) {
	args := append(companyExplorerV2Args(query), extraArgs...)
	rows, err := r.db.QueryContext(ctx, companyExplorerV2TypedArgsCTE+`
select `+companyExplorerV2RowSelect("entity", "$5::uuid", "null::uuid", "coalesce(child_group.position, 1000)", "child_group.created_timestamp", "child_group.updated_timestamp")+`
from company_user_groups child_group
join company_explorer_entities entity
  on entity.company_id=child_group.company_id
 and entity.entity_type='user_group'
 and entity.resource_id=child_group.group_id
`+companyExplorerV2TypedArgsJoin+`
`+companyExplorerV2Joins("entity")+`
where child_group.company_id=$1::uuid
  and `+groupPredicate+`
  and not exists (
    select 1
    from company_explorer_edges stored_edge
    where stored_edge.company_id=$1::uuid
      and stored_edge.parent_entity_id=$5::uuid
      and stored_edge.child_entity_id=entity.entity_id
  )
  and `+companyExplorerV2AccessPredicate("entity")+`
order by position asc, created_timestamp asc, name asc, entity_id asc`, args...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerV2Rows(rows)
}

func (r *PostgresRepo) queryCompanyExplorerV2DerivedGroupUsers(ctx context.Context, query CompanyExplorerV2RowsQuery, groupID string) ([]CompanyExplorerV2Row, error) {
	args := append(companyExplorerV2Args(query), groupID)
	rows, err := r.db.QueryContext(ctx, companyExplorerV2TypedArgsCTE+`
select `+companyExplorerV2RowSelect("entity", "$5::uuid", "null::uuid", "1000000 + row_number() over (order by "+companyExplorerV2NameExpr("entity")+" asc, entity.entity_id asc)::integer * 1000", "member.created_timestamp", "member.updated_timestamp")+`
from company_user_group_members member
join company_explorer_entities entity
  on entity.company_id=member.company_id
 and entity.entity_type='user'
 and entity.resource_id=member.user_id
`+companyExplorerV2TypedArgsJoin+`
`+companyExplorerV2Joins("entity")+`
where member.company_id=$1::uuid
  and member.group_id=$7::uuid
  and not exists (
    select 1
    from company_explorer_edges stored_edge
    where stored_edge.company_id=$1::uuid
      and stored_edge.parent_entity_id=$5::uuid
      and stored_edge.child_entity_id=entity.entity_id
  )
  and `+companyExplorerV2AccessPredicate("entity")+`
order by position asc, created_timestamp asc, name asc, entity_id asc`, args...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerV2Rows(rows)
}

func (r *PostgresRepo) queryCompanyExplorerV2DerivedProjectChildren(ctx context.Context, query CompanyExplorerV2RowsQuery, projectID string) ([]CompanyExplorerV2Row, error) {
	args := append(companyExplorerV2Args(query), projectID)
	rows, err := r.db.QueryContext(ctx, companyExplorerV2TypedArgsCTE+`
select `+companyExplorerV2RowSelect("entity", "$5::uuid", "null::uuid", "projection.position", "projection.relationship_created_timestamp", "projection.relationship_updated_timestamp")+`
from project_relationship_projection projection
join company_explorer_entities entity
  on entity.company_id=projection.company_id
 and entity.entity_type=projection.resource_type
 and entity.resource_id=projection.resource_id
`+companyExplorerV2TypedArgsJoin+`
`+companyExplorerV2Joins("entity")+`
where projection.company_id=$1::uuid
  and projection.project_id=$7::uuid
  and not exists (
    select 1
    from company_explorer_edges stored_edge
    where stored_edge.company_id=$1::uuid
      and stored_edge.parent_entity_id=$5::uuid
      and stored_edge.child_entity_id=entity.entity_id
  )
  and ($4::uuid is null or mangorts_user_can_access_resource(projection.company_id, 'project', projection.project_id, $4::uuid, $6::text))
  and `+companyExplorerV2AccessPredicate("entity")+`
order by position asc, created_timestamp asc, name asc, entity_id asc`, args...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerV2Rows(rows)
}

func (r *PostgresRepo) queryCompanyExplorerV2DerivedLogicGateNodes(ctx context.Context, query CompanyExplorerV2RowsQuery, logicGateID string) ([]CompanyExplorerV2Row, error) {
	args := append(companyExplorerV2Args(query), logicGateID)
	rows, err := r.db.QueryContext(ctx, companyExplorerV2TypedArgsCTE+`
select `+companyExplorerV2RowSelect("entity", "$5::uuid", "null::uuid", "assignment.position", "assignment.created_timestamp", "assignment.updated_timestamp")+`
from node_logic_gate_assignments assignment
join company_explorer_entities entity
  on entity.company_id=assignment.company_id
 and entity.entity_type='node'
 and entity.resource_id=assignment.node_id
`+companyExplorerV2TypedArgsJoin+`
`+companyExplorerV2Joins("entity")+`
where assignment.company_id=$1::uuid
  and assignment.logic_gate_id=$7::uuid
  and not exists (
    select 1
    from company_explorer_edges stored_edge
    where stored_edge.company_id=$1::uuid
      and stored_edge.parent_entity_id=$5::uuid
      and stored_edge.child_entity_id=entity.entity_id
  )
  and `+companyExplorerV2AccessPredicate("entity")+`
order by position asc, created_timestamp asc, name asc, entity_id asc`, args...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerV2Rows(rows)
}

func (r *PostgresRepo) CreateCompanyExplorerV2Folder(input CompanyExplorerV2FolderInput) (CompanyExplorerV2Row, error) {
	input, err := normalizeCompanyExplorerV2FolderInput(input)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	defer tx.Rollback()
	if err := postgresCompanyExplorerV2ParentCanEdit(ctx, tx, input.CompanyID, input.ParentEntityID, input.PermissionUserID); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	position := input.Position
	if position <= 0 {
		if err := tx.QueryRowContext(ctx, `select coalesce(max(position), 0) + 1000 from company_explorer_edges where company_id=$1::uuid and parent_entity_id=$2::uuid`, input.CompanyID, input.ParentEntityID).Scan(&position); err != nil {
			return CompanyExplorerV2Row{}, err
		}
	}
	entityID := newUUIDv7String()
	edgeID := companyExplorerV2EdgeID(input.CompanyID, input.ParentEntityID, entityID)
	if _, err := tx.ExecContext(ctx, `
insert into company_explorer_entities (company_id, entity_id, entity_type, resource_id, name, default_access, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, 'folder', null, $3, $4, now(), now())`, input.CompanyID, entityID, input.Name, input.DefaultAccess); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	if _, err := tx.ExecContext(ctx, `
insert into company_explorer_edges (company_id, edge_id, parent_entity_id, child_entity_id, position, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, now(), now())`, input.CompanyID, edgeID, input.ParentEntityID, entityID, position); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	if err := tx.Commit(); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	return r.companyExplorerV2RowByEdge(context.Background(), input.CompanyID, edgeID, input.PermissionUserID)
}

func (r *PostgresRepo) UpdateCompanyExplorerV2Folder(input CompanyExplorerV2FolderUpdateInput) (CompanyExplorerV2Row, error) {
	input, err := normalizeCompanyExplorerV2FolderUpdateInput(input)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	defer tx.Rollback()
	if err := postgresCompanyExplorerV2ParentCanEdit(ctx, tx, input.CompanyID, input.EntityID, input.PermissionUserID); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	result, err := tx.ExecContext(ctx, `
update company_explorer_entities
set name=$3,
    updated_timestamp=now()
where company_id=$1::uuid
  and entity_id=$2::uuid
  and entity_type='folder'`, input.CompanyID, input.EntityID, input.Name)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `
update company_explorer_folders
set name=$3,
    updated_timestamp=now()
where company_id=$1::uuid
  and folder_id=$2::uuid
  and folder_kind <> 'communications'`, input.CompanyID, input.EntityID, input.Name); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	if err := tx.Commit(); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	query := CompanyExplorerV2RowsQuery{CompanyID: input.CompanyID, ParentEntityID: input.EntityID, PermissionUserID: input.PermissionUserID, View: CompanyExplorerLazyScopeAll}
	row, err := r.getCompanyExplorerV2Parent(context.Background(), query)
	if errors.Is(err, sql.ErrNoRows) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	return row, err
}

func (r *PostgresRepo) UpsertCompanyExplorerV2Edge(input CompanyExplorerV2EdgeInput) (CompanyExplorerV2Row, error) {
	input, err := normalizeCompanyExplorerV2EdgeInput(input)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	ctx := context.Background()
	if err := r.ensureCompanyExplorerV2NativeEntities(ctx, input.CompanyID); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	defer tx.Rollback()
	if err := postgresCompanyExplorerV2ParentCanEdit(ctx, tx, input.CompanyID, input.ParentEntityID, input.PermissionUserID); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	childEntityID := input.ChildEntityID
	if childEntityID == "" {
		if err := tx.QueryRowContext(ctx, `
select entity_id::text
from company_explorer_entities
where company_id=$1::uuid and entity_type=$2 and resource_id=$3::uuid`, input.CompanyID, input.ChildEntityType, input.ChildResourceID).Scan(&childEntityID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return CompanyExplorerV2Row{}, ErrNotFound
			}
			return CompanyExplorerV2Row{}, err
		}
	}
	if input.PermissionUserID != "" {
		childQuery := CompanyExplorerV2RowsQuery{CompanyID: input.CompanyID, View: CompanyExplorerLazyScopeAll, ParentEntityID: childEntityID, PermissionUserID: input.PermissionUserID}
		var visible bool
		if err := tx.QueryRowContext(ctx, companyExplorerV2TypedArgsCTE+`
select exists (
  select 1
  from company_explorer_entities entity
  `+companyExplorerV2TypedArgsJoin+`
  where entity.company_id=$1::uuid
    and entity.entity_id=$5::uuid
    and `+companyExplorerV2AccessPredicate("entity")+`
)`, companyExplorerV2Args(childQuery)...).Scan(&visible); err != nil {
			return CompanyExplorerV2Row{}, err
		}
		if !visible {
			return CompanyExplorerV2Row{}, ErrNotFound
		}
	}
	position := input.Position
	if position <= 0 {
		if err := tx.QueryRowContext(ctx, `select coalesce(max(position), 0) + 1000 from company_explorer_edges where company_id=$1::uuid and parent_entity_id=$2::uuid`, input.CompanyID, input.ParentEntityID).Scan(&position); err != nil {
			return CompanyExplorerV2Row{}, err
		}
	}
	edgeID := companyExplorerV2EdgeID(input.CompanyID, input.ParentEntityID, childEntityID)
	if _, err := tx.ExecContext(ctx, `
insert into company_explorer_edges (company_id, edge_id, parent_entity_id, child_entity_id, position, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, now(), now())
on conflict (company_id, parent_entity_id, child_entity_id) do update set
  position=excluded.position,
  updated_timestamp=now()`, input.CompanyID, edgeID, input.ParentEntityID, childEntityID, position); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	if err := tx.Commit(); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	return r.companyExplorerV2RowByEdge(context.Background(), input.CompanyID, edgeID, input.PermissionUserID)
}

func (r *PostgresRepo) MoveCompanyExplorerV2Edge(input CompanyExplorerV2MoveEdgeInput) (CompanyExplorerV2Row, error) {
	input, err := normalizeCompanyExplorerV2MoveEdgeInput(input)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	defer tx.Rollback()
	if err := postgresCompanyExplorerV2ParentCanEdit(ctx, tx, input.CompanyID, input.ParentEntityID, input.PermissionUserID); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	var childEntityID string
	if err := tx.QueryRowContext(ctx, `
select child_entity_id::text
from company_explorer_edges
where company_id=$1::uuid and edge_id=$2::uuid`, input.CompanyID, input.EdgeID).Scan(&childEntityID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CompanyExplorerV2Row{}, ErrNotFound
		}
		return CompanyExplorerV2Row{}, err
	}
	edgeID := companyExplorerV2EdgeID(input.CompanyID, input.ParentEntityID, childEntityID)
	if input.Position <= 0 {
		if err := tx.QueryRowContext(ctx, `select coalesce(max(position), 0) + 1000 from company_explorer_edges where company_id=$1::uuid and parent_entity_id=$2::uuid`, input.CompanyID, input.ParentEntityID).Scan(&input.Position); err != nil {
			return CompanyExplorerV2Row{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `
update company_explorer_edges
set edge_id=$3::uuid,
    parent_entity_id=$4::uuid,
    position=$5,
    updated_timestamp=now()
where company_id=$1::uuid and edge_id=$2::uuid`, input.CompanyID, input.EdgeID, edgeID, input.ParentEntityID, input.Position); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	if err := tx.Commit(); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	return r.companyExplorerV2RowByEdge(context.Background(), input.CompanyID, edgeID, input.PermissionUserID)
}

func (r *PostgresRepo) DeleteCompanyExplorerV2Edge(companyID, edgeID string) error {
	companyID = cleanUUIDText(companyID)
	edgeID = cleanUUIDText(edgeID)
	if companyID == "" || edgeID == "" {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `delete from company_explorer_edges where company_id=$1::uuid and edge_id=$2::uuid`, companyID, edgeID)
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) DeleteCompanyExplorerV2Folder(companyID, entityID string) error {
	companyID = cleanUUIDText(companyID)
	entityID = cleanUUIDText(entityID)
	if companyID == "" || entityID == "" {
		return ErrInvalid
	}
	ctx := context.Background()
	if err := r.ensureCompanyExplorerV2NativeEntities(ctx, companyID); err != nil {
		return err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRowContext(ctx, `
select exists (
  select 1
  from company_explorer_entities
  where company_id=$1::uuid
    and entity_id=$2::uuid
    and entity_type='folder'
)`, companyID, entityID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `
with recursive folder_subtree(entity_id) as (
  select entity_id
  from company_explorer_entities
  where company_id=$1::uuid
    and entity_id=$2::uuid
    and entity_type='folder'
  union
  select edge.child_entity_id
  from company_explorer_edges edge
  join folder_subtree parent
    on parent.entity_id=edge.parent_entity_id
  join company_explorer_entities child
    on child.company_id=edge.company_id
   and child.entity_id=edge.child_entity_id
   and child.entity_type='folder'
  where edge.company_id=$1::uuid
)
delete from resource_permissions
where company_id=$1::uuid
  and resource_type='company_explorer_folder'
  and resource_id in (select entity_id from folder_subtree)`, companyID, entityID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
with recursive folder_subtree(entity_id) as (
  select entity_id
  from company_explorer_entities
  where company_id=$1::uuid
    and entity_id=$2::uuid
    and entity_type='folder'
  union
  select edge.child_entity_id
  from company_explorer_edges edge
  join folder_subtree parent
    on parent.entity_id=edge.parent_entity_id
  join company_explorer_entities child
    on child.company_id=edge.company_id
   and child.entity_id=edge.child_entity_id
   and child.entity_type='folder'
  where edge.company_id=$1::uuid
)
delete from resource_access_grants
where company_id=$1::uuid
  and resource_type='company_explorer_folder'
  and resource_id in (select entity_id from folder_subtree)`, companyID, entityID); err != nil && !isPostgresUndefinedTable(err, "resource_access_grants") {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
with recursive folder_subtree(entity_id) as (
  select entity_id
  from company_explorer_entities
  where company_id=$1::uuid
    and entity_id=$2::uuid
    and entity_type='folder'
  union
  select edge.child_entity_id
  from company_explorer_edges edge
  join folder_subtree parent
    on parent.entity_id=edge.parent_entity_id
  join company_explorer_entities child
    on child.company_id=edge.company_id
   and child.entity_id=edge.child_entity_id
   and child.entity_type='folder'
  where edge.company_id=$1::uuid
)
delete from company_explorer_folder_shares
where company_id=$1::uuid
  and folder_id in (select entity_id from folder_subtree)`, companyID, entityID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
with recursive folder_subtree(entity_id) as (
  select entity_id
  from company_explorer_entities
  where company_id=$1::uuid
    and entity_id=$2::uuid
    and entity_type='folder'
  union
  select edge.child_entity_id
  from company_explorer_edges edge
  join folder_subtree parent
    on parent.entity_id=edge.parent_entity_id
  join company_explorer_entities child
    on child.company_id=edge.company_id
   and child.entity_id=edge.child_entity_id
   and child.entity_type='folder'
  where edge.company_id=$1::uuid
)
delete from company_explorer_folder_items
where company_id=$1::uuid
  and folder_id in (select entity_id from folder_subtree)`, companyID, entityID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
with recursive folder_subtree(entity_id) as (
  select entity_id
  from company_explorer_entities
  where company_id=$1::uuid
    and entity_id=$2::uuid
    and entity_type='folder'
  union
  select edge.child_entity_id
  from company_explorer_edges edge
  join folder_subtree parent
    on parent.entity_id=edge.parent_entity_id
  join company_explorer_entities child
    on child.company_id=edge.company_id
   and child.entity_id=edge.child_entity_id
   and child.entity_type='folder'
  where edge.company_id=$1::uuid
)
delete from company_explorer_folders
where company_id=$1::uuid
  and folder_id in (select entity_id from folder_subtree)`, companyID, entityID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
with recursive folder_subtree(entity_id) as (
  select entity_id
  from company_explorer_entities
  where company_id=$1::uuid
    and entity_id=$2::uuid
    and entity_type='folder'
  union
  select edge.child_entity_id
  from company_explorer_edges edge
  join folder_subtree parent
    on parent.entity_id=edge.parent_entity_id
  join company_explorer_entities child
    on child.company_id=edge.company_id
   and child.entity_id=edge.child_entity_id
   and child.entity_type='folder'
  where edge.company_id=$1::uuid
)
delete from company_explorer_entities
where company_id=$1::uuid
  and entity_id in (select entity_id from folder_subtree)
  and entity_type='folder'`, companyID, entityID); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) companyExplorerV2RowByEdge(ctx context.Context, companyID, edgeID, permissionUserID string) (CompanyExplorerV2Row, error) {
	query := CompanyExplorerV2RowsQuery{CompanyID: companyID, PermissionUserID: permissionUserID, View: CompanyExplorerLazyScopeAll}
	item, err := scanCompanyExplorerV2Row(r.db.QueryRowContext(ctx, companyExplorerV2TypedArgsCTE+`
select `+companyExplorerV2RowSelect("entity", "edge.parent_entity_id", "edge.edge_id", "edge.position", "edge.created_timestamp", "edge.updated_timestamp")+`
from company_explorer_edges edge
join company_explorer_entities entity
  on entity.company_id=edge.company_id
 and entity.entity_id=edge.child_entity_id
`+companyExplorerV2TypedArgsJoin+`
`+companyExplorerV2Joins("entity")+`
where edge.company_id=$1::uuid and edge.edge_id=$7::uuid
  and `+companyExplorerV2AccessPredicate("entity")+`
limit 1`, append(companyExplorerV2Args(query), edgeID)...))
	if errors.Is(err, sql.ErrNoRows) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	return item, err
}

func postgresCompanyExplorerV2ParentCanEdit(ctx context.Context, tx *sql.Tx, companyID, parentEntityID, userID string) error {
	if userID == "" {
		return nil
	}
	var ok bool
	err := tx.QueryRowContext(ctx, `
select exists (
  select 1
  from company_explorer_entities entity
  where entity.company_id=$1::uuid
    and entity.entity_id=$2::uuid
    and (
      exists (
        select 1
        from company_memberships membership
        where membership.user_id=$3::uuid
          and (
            membership.role='dev_admin'
            or (membership.company_id=entity.company_id and membership.role='company_admin')
          )
      )
      or (
        entity.entity_type in ('company', 'user_group', 'user')
        and exists (
          select 1
          from company_memberships membership
          where membership.user_id=$3::uuid
            and membership.company_id=entity.company_id
        )
      )
      or (
        entity.entity_type='folder'
        and mangorts_user_can_access_resource(entity.company_id, 'company_explorer_folder', entity.entity_id, $3::uuid, 'edit')
      )
      or (
        entity.entity_type in ('node', 'logic_gate', 'project')
        and mangorts_user_can_access_resource(entity.company_id, entity.entity_type, entity.resource_id, $3::uuid, 'edit')
      )
    )
)`, companyID, parentEntityID, userID).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}
