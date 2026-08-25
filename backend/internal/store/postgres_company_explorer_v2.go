package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

type companyExplorerV2RowScanner interface {
	Scan(dest ...any) error
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
		&item.HasPermissionRules,
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
	applyCompanyExplorerDefaultFolderNativeContext(&item)
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

func companyExplorerFinalArgs(query CompanyExplorerV2RowsQuery) []any {
	return []any{
		query.CompanyID,
		companyExplorerLazyNullable(query.ParentEntityID),
		companyExplorerLazyNullable(query.PermissionUserID),
		EntityPermissionEdit,
	}
}

func companyExplorerRootArgs(query CompanyExplorerV2RowsQuery) []any {
	return []any{
		query.CompanyID,
		companyExplorerLazyNullable(query.PermissionUserID),
		EntityPermissionEdit,
	}
}

func companyExplorerFinalEffectiveAccessSelect(entityTypeExpr, entityIDExpr string) string {
	return companyExplorerEffectiveAccessSelect(entityTypeExpr, entityIDExpr, "$3")
}

func companyExplorerRootEffectiveAccessSelect(entityTypeExpr, entityIDExpr string) string {
	return companyExplorerEffectiveAccessSelect(entityTypeExpr, entityIDExpr, "$2")
}

func companyExplorerEffectiveAccessSelect(entityTypeExpr, entityIDExpr, permissionUserParam string) string {
	return `case
    when ` + permissionUserParam + `::uuid is null then ''
    when exists (
      select 1
      from company_memberships membership
      where membership.user_id=` + permissionUserParam + `::uuid
        and (
          membership.role='dev_admin'
          or (membership.company_id=$1::uuid and membership.role='company_admin')
        )
    ) then 'edit'
    when ` + entityTypeExpr + `='company' then 'edit'
    when ` + entityTypeExpr + `='folder'
      and mangorts_user_can_access_resource($1::uuid, 'company_explorer_folder', ` + entityIDExpr + `, ` + permissionUserParam + `::uuid, 'edit') then 'edit'
    when ` + entityTypeExpr + ` in ('node', 'logic_gate', 'project')
      and mangorts_user_can_access_resource($1::uuid, ` + entityTypeExpr + `, ` + entityIDExpr + `, ` + permissionUserParam + `::uuid, 'edit') then 'edit'
    else 'edit'
  end`
}

func companyExplorerPermissionRulesSelect(entityTypeExpr, entityIDExpr string) string {
	return `(
    ` + entityTypeExpr + `='folder'
    and (
      exists (
        select 1
        from company_explorer_folders permission_folder
        where permission_folder.company_id=$1::uuid
          and permission_folder.folder_id=` + entityIDExpr + `
          and coalesce(permission_folder.default_access, '` + ResourceDefaultAccessEdit + `')='` + ResourceDefaultAccessNoAccess + `'
      )
      or exists (
        select 1
        from resource_permissions permission_marker
        where permission_marker.company_id=$1::uuid
          and permission_marker.resource_type='` + EntityTypeCompanyExplorerFolder + `'
          and permission_marker.resource_id=` + entityIDExpr + `
      )
    )
    or (
      ` + entityTypeExpr + `='` + EntityTypeLogicGate + `'
      and (
        exists (
          select 1
          from logic_gates permission_logic_gate
          where permission_logic_gate.company_id=$1::uuid
            and permission_logic_gate.logic_gate_id=` + entityIDExpr + `
            and coalesce(permission_logic_gate.default_access, '` + ResourceDefaultAccessEdit + `')='` + ResourceDefaultAccessNoAccess + `'
        )
        or exists (
          select 1
          from resource_permissions permission_marker
          where permission_marker.company_id=$1::uuid
            and permission_marker.resource_type='` + EntityTypeLogicGate + `'
            and permission_marker.resource_id=` + entityIDExpr + `
        )
      )
    )
    or (
      ` + entityTypeExpr + `='` + EntityTypeProject + `'
      and (
        exists (
          select 1
          from projects permission_project
          where permission_project.company_id=$1::uuid
            and permission_project.project_id=` + entityIDExpr + `
            and coalesce(permission_project.default_access, '` + ResourceDefaultAccessEdit + `')='` + ResourceDefaultAccessNoAccess + `'
        )
        or exists (
          select 1
          from resource_permissions permission_marker
          where permission_marker.company_id=$1::uuid
            and permission_marker.resource_type='` + EntityTypeProject + `'
            and permission_marker.resource_id=` + entityIDExpr + `
        )
      )
    )
  )`
}

func companyExplorerFinalAccessPredicate(entityTypeExpr, entityIDExpr string) string {
	return companyExplorerAccessPredicate(entityTypeExpr, entityIDExpr, "$3", "$4")
}

func companyExplorerRootAccessPredicate(entityTypeExpr, entityIDExpr string) string {
	return companyExplorerAccessPredicate(entityTypeExpr, entityIDExpr, "$2", "$3")
}

func companyExplorerAccessPredicate(entityTypeExpr, entityIDExpr, permissionUserParam, accessLevelParam string) string {
	return `(
    ` + permissionUserParam + `::uuid is null
    or (
      ` + entityTypeExpr + `='company'
      and exists (
        select 1
        from company_memberships membership
        where membership.user_id=` + permissionUserParam + `::uuid
          and (membership.role='dev_admin' or membership.company_id=$1::uuid)
      )
    )
    or (
      ` + entityTypeExpr + `='folder'
      and mangorts_user_can_access_resource($1::uuid, 'company_explorer_folder', ` + entityIDExpr + `, ` + permissionUserParam + `::uuid, ` + accessLevelParam + `::text)
    )
    or (
      ` + entityTypeExpr + ` in ('node', 'logic_gate', 'project')
      and mangorts_user_can_access_resource($1::uuid, ` + entityTypeExpr + `, ` + entityIDExpr + `, ` + permissionUserParam + `::uuid, ` + accessLevelParam + `::text)
    )
  )`
}

func companyExplorerFinalHasChildrenExpr(entityTypeExpr, entityIDExpr string) string {
	return `(
    (
      ` + entityTypeExpr + `='folder'
      and (
        exists (
          select 1
          from company_explorer_folders child_folder
          where child_folder.company_id=$1::uuid
            and child_folder.parent_folder_id=` + entityIDExpr + `
        )
        or exists (
          select 1
          from company_explorer_items child_item
          where child_item.company_id=$1::uuid
            and child_item.parent_folder_id=` + entityIDExpr + `
        )
      )
    )
    or (
      ` + entityTypeExpr + `='company'
      and (
        exists (
          select 1
          from company_explorer_folders root_folder
          where root_folder.company_id=$1::uuid
            and root_folder.parent_folder_id is null
        )
        or exists (
          select 1
          from company_explorer_items root_item
          where root_item.company_id=$1::uuid
            and root_item.parent_folder_id is null
        )
      )
    )
  )`
}

func companyExplorerFinalNativeContext(entityTypeExpr, entityIDExpr, resourceIDExpr string) string {
	return `jsonb_strip_nulls(jsonb_build_object(
    'entity_id', ` + entityIDExpr + `::text,
    'resource_id', nullif((` + resourceIDExpr + `)::text, ''),
    'company_id', case when ` + entityTypeExpr + `='company' then (` + resourceIDExpr + `)::text end,
    'folder_id', case when ` + entityTypeExpr + `='folder' then ` + entityIDExpr + `::text end,
    'project_id', case when ` + entityTypeExpr + `='project' then (` + resourceIDExpr + `)::text end,
    'logic_gate_id', case when ` + entityTypeExpr + `='logic_gate' then (` + resourceIDExpr + `)::text end,
    'node_id', case when ` + entityTypeExpr + `='node' then (` + resourceIDExpr + `)::text end
  ))::text`
}

func (r *PostgresRepo) ListCompanyExplorerV2RootRows(query CompanyExplorerV2RowsQuery) (CompanyExplorerV2Rows, error) {
	query, err := normalizeCompanyExplorerV2RowsQuery(query, false)
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	ctx := context.Background()
	rows, err := r.queryCompanyExplorerFinalRootChildren(ctx, query)
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	return CompanyExplorerV2Rows{Rows: rows}, nil
}

func (r *PostgresRepo) ListCompanyExplorerV2ChildRows(query CompanyExplorerV2RowsQuery) (CompanyExplorerV2Rows, error) {
	query, err := normalizeCompanyExplorerV2RowsQuery(query, true)
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	ctx := context.Background()
	parent, err := r.GetCompanyExplorerV2Entity(query.CompanyID, query.ParentEntityID, query.PermissionUserID)
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	var rows []CompanyExplorerV2Row
	switch parent.EntityType {
	case CompanyExplorerV2EntityCompany:
		rows, err = r.queryCompanyExplorerFinalRootChildren(ctx, query)
	case CompanyExplorerV2EntityFolder:
		rows, err = r.queryCompanyExplorerFinalContainerChildren(ctx, query)
	case CompanyExplorerV2EntityProject, CompanyExplorerV2EntityLogicGate:
		rows = []CompanyExplorerV2Row{}
	default:
		rows = []CompanyExplorerV2Row{}
	}
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	return CompanyExplorerV2Rows{Rows: rows}, nil
}

func (r *PostgresRepo) GetCompanyExplorerV2Entity(companyID, entityID, permissionUserID string) (CompanyExplorerV2Row, error) {
	companyID = cleanUUIDText(companyID)
	entityID = cleanUUIDText(entityID)
	permissionUserID = cleanUUIDText(permissionUserID)
	if companyID == "" || entityID == "" {
		return CompanyExplorerV2Row{}, ErrInvalid
	}
	query := CompanyExplorerV2RowsQuery{CompanyID: companyID, ParentEntityID: entityID, PermissionUserID: permissionUserID}
	ctx := context.Background()
	row, err := scanCompanyExplorerV2Row(r.db.QueryRowContext(ctx, `
with candidate as (
  select company.company_id,
         company.company_id as entity_id,
         'company'::text as entity_type,
         company.company_id as resource_id,
         company.name,
         1000 as position,
         company.created_timestamp,
         company.updated_timestamp
  from companies company
  where company.company_id=$1::uuid
    and company.company_id=$2::uuid
  union all
  select folder.company_id,
         folder.folder_id as entity_id,
         'folder'::text as entity_type,
         null::uuid as resource_id,
         folder.name,
         folder.position,
         folder.created_timestamp,
         folder.updated_timestamp
  from company_explorer_folders folder
  where folder.company_id=$1::uuid
    and folder.folder_id=$2::uuid
  union all
  select project.company_id,
         project.project_id as entity_id,
         'project'::text as entity_type,
         project.project_id as resource_id,
         project.name,
         1000 as position,
         project.created_timestamp,
         project.updated_timestamp
  from projects project
  where project.company_id=$1::uuid
    and project.project_id=$2::uuid
  union all
  select logic_gate.company_id,
         logic_gate.logic_gate_id as entity_id,
         'logic_gate'::text as entity_type,
         logic_gate.logic_gate_id as resource_id,
         logic_gate.header as name,
         1000 as position,
         logic_gate.created_timestamp,
         logic_gate.created_timestamp as updated_timestamp
  from logic_gates logic_gate
  where logic_gate.company_id=$1::uuid
    and logic_gate.logic_gate_id=$2::uuid
  union all
  select node.company_id,
         node.node_id as entity_id,
         'node'::text as entity_type,
         node.node_id as resource_id,
         node.name,
         1000 as position,
         node.created_timestamp,
         node.created_timestamp as updated_timestamp
  from nodes node
  where node.company_id=$1::uuid
    and node.node_id=$2::uuid
)
select candidate.company_id::text,
       candidate.entity_id::text,
       candidate.entity_type,
       coalesce(candidate.resource_id::text, '') as resource_id,
       candidate.name,
       '' as parent_entity_id,
       '' as edge_id,
       candidate.position,
       `+companyExplorerFinalHasChildrenExpr("candidate.entity_type", "candidate.entity_id")+` as has_children,
       `+companyExplorerFinalEffectiveAccessSelect("candidate.entity_type", "candidate.entity_id")+` as effective_access,
       `+companyExplorerPermissionRulesSelect("candidate.entity_type", "candidate.entity_id")+` as has_permission_rules,
       `+companyExplorerFinalNativeContext("candidate.entity_type", "candidate.entity_id", "coalesce(candidate.resource_id, candidate.entity_id)")+` as native_context,
       candidate.created_timestamp,
       candidate.updated_timestamp
from candidate
where `+companyExplorerFinalAccessPredicate("candidate.entity_type", "candidate.entity_id")+`
order by case candidate.entity_type
  when 'company' then 0
  when 'folder' then 1
  when 'project' then 2
  when 'logic_gate' then 3
  when 'node' then 4
  else 5
end
limit 1`, query.CompanyID, query.ParentEntityID, companyExplorerLazyNullable(query.PermissionUserID), EntityPermissionEdit))
	if errors.Is(err, sql.ErrNoRows) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	return row, err
}

func (r *PostgresRepo) queryCompanyExplorerFinalRootChildren(ctx context.Context, query CompanyExplorerV2RowsQuery) ([]CompanyExplorerV2Row, error) {
	rows, err := r.db.QueryContext(ctx, `
with folder_rows as (
  select folder.company_id,
         folder.folder_id as entity_id,
         'folder'::text as entity_type,
         null::uuid as resource_id,
         folder.name,
         null::uuid as parent_entity_id,
         null::uuid as edge_id,
         folder.position,
         folder.created_timestamp,
         folder.updated_timestamp
  from company_explorer_folders folder
  where folder.company_id=$1::uuid
    and folder.parent_folder_id is null
), item_rows as (
  select item.company_id,
         item.target_id as entity_id,
         item.target_type as entity_type,
         item.target_id as resource_id,
         coalesce(project.name, logic_gate.header, item.target_id::text) as name,
         null::uuid as parent_entity_id,
         item.item_id as edge_id,
         item.position,
         item.created_timestamp,
         item.updated_timestamp
  from company_explorer_items item
  left join projects project
    on item.target_type='project'
   and project.company_id=item.company_id
   and project.project_id=item.target_id
  left join logic_gates logic_gate
    on item.target_type='logic_gate'
   and logic_gate.company_id=item.company_id
   and logic_gate.logic_gate_id=item.target_id
  where item.company_id=$1::uuid
    and item.parent_folder_id is null
    and (
      (item.target_type='project' and project.project_id is not null)
      or (item.target_type='logic_gate' and logic_gate.logic_gate_id is not null)
    )
), all_rows as (
  select * from folder_rows
  union all
  select * from item_rows
)
select all_rows.company_id::text,
       all_rows.entity_id::text,
       all_rows.entity_type,
       coalesce(all_rows.resource_id::text, '') as resource_id,
       all_rows.name,
       coalesce(all_rows.parent_entity_id::text, '') as parent_entity_id,
       coalesce(all_rows.edge_id::text, '') as edge_id,
       all_rows.position,
       `+companyExplorerFinalHasChildrenExpr("all_rows.entity_type", "all_rows.entity_id")+` as has_children,
       `+companyExplorerRootEffectiveAccessSelect("all_rows.entity_type", "all_rows.entity_id")+` as effective_access,
       `+companyExplorerPermissionRulesSelect("all_rows.entity_type", "all_rows.entity_id")+` as has_permission_rules,
       `+companyExplorerFinalNativeContext("all_rows.entity_type", "all_rows.entity_id", "coalesce(all_rows.resource_id, all_rows.entity_id)")+` as native_context,
       all_rows.created_timestamp,
       all_rows.updated_timestamp
from all_rows
where `+companyExplorerRootAccessPredicate("all_rows.entity_type", "all_rows.entity_id")+`
order by all_rows.position asc, all_rows.created_timestamp asc, all_rows.name asc, all_rows.entity_id asc`, companyExplorerRootArgs(query)...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerV2Rows(rows)
}

func (r *PostgresRepo) queryCompanyExplorerFinalContainerChildren(ctx context.Context, query CompanyExplorerV2RowsQuery) ([]CompanyExplorerV2Row, error) {
	parentFolderPredicate := "folder.parent_folder_id=$2::uuid"
	itemParentPredicate := "item.parent_folder_id=$2::uuid"
	parentEntityExpr := "$2::uuid"
	rows, err := r.db.QueryContext(ctx, `
with folder_rows as (
  select folder.company_id,
         folder.folder_id as entity_id,
         'folder'::text as entity_type,
         null::uuid as resource_id,
         folder.name,
         `+parentEntityExpr+` as parent_entity_id,
         null::uuid as edge_id,
         folder.position,
         folder.created_timestamp,
         folder.updated_timestamp
  from company_explorer_folders folder
  where folder.company_id=$1::uuid
    and `+parentFolderPredicate+`
), item_rows as (
  select item.company_id,
         item.target_id as entity_id,
         item.target_type as entity_type,
         item.target_id as resource_id,
         coalesce(project.name, logic_gate.header, item.target_id::text) as name,
         `+parentEntityExpr+` as parent_entity_id,
         item.item_id as edge_id,
         item.position,
         item.created_timestamp,
         item.updated_timestamp
  from company_explorer_items item
  left join projects project
    on item.target_type='project'
   and project.company_id=item.company_id
   and project.project_id=item.target_id
  left join logic_gates logic_gate
    on item.target_type='logic_gate'
   and logic_gate.company_id=item.company_id
   and logic_gate.logic_gate_id=item.target_id
  where item.company_id=$1::uuid
    and `+itemParentPredicate+`
    and (
      (item.target_type='project' and project.project_id is not null)
      or (item.target_type='logic_gate' and logic_gate.logic_gate_id is not null)
    )
), all_rows as (
  select * from folder_rows
  union all
  select * from item_rows
)
select all_rows.company_id::text,
       all_rows.entity_id::text,
       all_rows.entity_type,
       coalesce(all_rows.resource_id::text, '') as resource_id,
       all_rows.name,
       all_rows.parent_entity_id::text,
       coalesce(all_rows.edge_id::text, '') as edge_id,
       all_rows.position,
       `+companyExplorerFinalHasChildrenExpr("all_rows.entity_type", "all_rows.entity_id")+` as has_children,
       `+companyExplorerFinalEffectiveAccessSelect("all_rows.entity_type", "all_rows.entity_id")+` as effective_access,
       `+companyExplorerPermissionRulesSelect("all_rows.entity_type", "all_rows.entity_id")+` as has_permission_rules,
       `+companyExplorerFinalNativeContext("all_rows.entity_type", "all_rows.entity_id", "coalesce(all_rows.resource_id, all_rows.entity_id)")+` as native_context,
       all_rows.created_timestamp,
       all_rows.updated_timestamp
from all_rows
where `+companyExplorerFinalAccessPredicate("all_rows.entity_type", "all_rows.entity_id")+`
order by all_rows.position asc, all_rows.created_timestamp asc, all_rows.name asc, all_rows.entity_id asc`, companyExplorerFinalArgs(query)...)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerV2Rows(rows)
}

func (r *PostgresRepo) GetCompanyExplorerV2FolderDefaultAccess(companyID, entityID string) (string, error) {
	companyID = cleanUUIDText(companyID)
	entityID = cleanUUIDText(entityID)
	if companyID == "" || entityID == "" {
		return "", ErrInvalid
	}
	return postgresResourceDefaultAccess(context.Background(), r.db, companyID, EntityTypeCompanyExplorerFolder, entityID)
}

func (r *PostgresRepo) CreateCompanyExplorerV2Folder(input CompanyExplorerV2FolderInput) (CompanyExplorerV2Row, error) {
	input, err := normalizeCompanyExplorerV2FolderInput(input)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	ctx := context.Background()
	if input.ParentEntityID != input.CompanyID {
		parent, err := r.GetCompanyExplorerV2Entity(input.CompanyID, input.ParentEntityID, input.PermissionUserID)
		if err != nil {
			return CompanyExplorerV2Row{}, err
		}
		if parent.EntityType != CompanyExplorerV2EntityFolder {
			return CompanyExplorerV2Row{}, ErrInvalid
		}
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	defer tx.Rollback()

	parentFolderID := any(nil)
	parentEntityID := input.CompanyID
	if input.ParentEntityID != input.CompanyID {
		parentFolderID = input.ParentEntityID
		parentEntityID = input.ParentEntityID
	}
	defaultAccess := input.DefaultAccess
	if defaultAccess == "" {
		defaultAccess = ResourceDefaultAccessEdit
	}
	position := input.Position
	if position <= 0 {
		position, err = nextCompanyExplorerFinalPositionSQL(ctx, tx, input.CompanyID, parentFolderID)
		if err != nil {
			return CompanyExplorerV2Row{}, err
		}
	}
	folderID := newUUIDv7String()
	if _, err := tx.ExecContext(ctx, `
insert into company_explorer_folders (
  company_id,
  folder_id,
  parent_folder_id,
  name,
  default_access,
  position,
  created_by_user_id,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, nullif($7, '')::uuid, now(), now())`,
		input.CompanyID, folderID, parentFolderID, input.Name, defaultAccess, position, input.ActorUserID); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	if err := tx.Commit(); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	return r.GetCompanyExplorerV2EntityWithParent(input.CompanyID, folderID, parentEntityID, "", input.PermissionUserID)
}

func (r *PostgresRepo) UpsertCompanyExplorerV2Edge(input CompanyExplorerV2EdgeInput) (CompanyExplorerV2Row, error) {
	input, err := normalizeCompanyExplorerV2EdgeInput(input)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ParentEntityID = cleanUUIDText(input.ParentEntityID)
	input.ChildEntityID = cleanUUIDText(input.ChildEntityID)
	input.ChildResourceID = cleanUUIDText(input.ChildResourceID)
	input.ActorUserID = cleanUUIDText(input.ActorUserID)
	input.PermissionUserID = cleanUUIDText(input.PermissionUserID)
	if input.CompanyID == "" || input.ParentEntityID == "" || (input.ActorUserID == "") != (input.PermissionUserID == "") || (input.ActorUserID != "" && input.ActorUserID != input.PermissionUserID) {
		return CompanyExplorerV2Row{}, ErrInvalid
	}
	ctx := context.Background()
	targetType := input.ChildEntityType
	targetID := input.ChildResourceID
	if input.ChildEntityID != "" && targetID == "" {
		targetID = input.ChildEntityID
	}
	if targetID == "" {
		return CompanyExplorerV2Row{}, ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresCompanyExplorerMutationTx(ctx, tx, input.CompanyID, input.PermissionUserID, true); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	if targetType == "" {
		err := tx.QueryRowContext(ctx, `
select entity_type from (
  select 'logic_gate'::text as entity_type from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid
  union all
  select 'project'::text from projects where company_id=$1::uuid and project_id=$2::uuid
) candidate limit 1`, input.CompanyID, targetID).Scan(&targetType)
		if errors.Is(err, sql.ErrNoRows) {
			return CompanyExplorerV2Row{}, ErrNotFound
		}
		if err != nil {
			return CompanyExplorerV2Row{}, err
		}
	}
	if targetType != EntityTypeProject && targetType != EntityTypeLogicGate {
		return CompanyExplorerV2Row{}, ErrInvalid
	}
	if err := lockPostgresCompanyExplorerResourceEditTx(ctx, tx, input.CompanyID, input.PermissionUserID, targetType, targetID); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	parentFolderID, parentEntityID, err := r.companyExplorerFinalContainerTarget(ctx, tx, input.CompanyID, input.ParentEntityID, input.PermissionUserID)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	targetParentID := ""
	if parentEntityID != input.CompanyID {
		targetParentID = parentEntityID
	}
	var previousParentID sql.NullString
	hadPreviousEdge := true
	if err := tx.QueryRowContext(ctx, `
select parent_folder_id::text
from company_explorer_items
where company_id=$1::uuid and target_type=$2 and target_id=$3::uuid
for update`, input.CompanyID, targetType, targetID).Scan(&previousParentID); errors.Is(err, sql.ErrNoRows) {
		hadPreviousEdge = false
	} else if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	position := input.Position
	if position <= 0 {
		position, err = nextCompanyExplorerFinalPositionSQL(ctx, tx, input.CompanyID, parentFolderID)
		if err != nil {
			return CompanyExplorerV2Row{}, err
		}
	} else if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	var itemID string
	var createdTimestamp, updatedTimestamp sql.NullTime
	err = tx.QueryRowContext(ctx, `
insert into company_explorer_items (
  company_id,
  item_id,
  parent_folder_id,
  target_type,
  target_id,
  position,
  created_by_user_id,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, nullif($7, '')::uuid, now(), now())
on conflict (company_id, target_type, target_id) do update set
  parent_folder_id=excluded.parent_folder_id,
  position=excluded.position,
  updated_timestamp=now()
returning item_id::text, created_timestamp, updated_timestamp`,
		input.CompanyID, newUUIDv7String(), parentFolderID, targetType, targetID, position, input.ActorUserID,
	).Scan(&itemID, &createdTimestamp, &updatedTimestamp)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	if !hadPreviousEdge || previousParentID.Valid != (targetParentID != "") || previousParentID.String != targetParentID {
		eventInput := workspaceDomainEventInput(input.CompanyID, "company_explorer_item_placed", map[string]any{
			"item_id": itemID, "parent_entity_id": parentEntityID,
			"target_type": targetType, "target_id": targetID,
		})
		eventInput.ActorUserID = input.ActorUserID
		if _, err := r.appendDomainEventTx(ctx, tx, eventInput); err != nil {
			return CompanyExplorerV2Row{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	_ = createdTimestamp
	_ = updatedTimestamp
	return r.GetCompanyExplorerV2EntityWithParent(input.CompanyID, targetID, parentEntityID, itemID, input.PermissionUserID)
}

func (r *PostgresRepo) MoveCompanyExplorerV2Edge(input CompanyExplorerV2MoveEdgeInput) (CompanyExplorerV2Row, error) {
	input, err := normalizeCompanyExplorerV2MoveEdgeInput(input)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.EdgeID = cleanUUIDText(input.EdgeID)
	input.ParentEntityID = cleanUUIDText(input.ParentEntityID)
	input.ActorUserID = cleanUUIDText(input.ActorUserID)
	input.PermissionUserID = cleanUUIDText(input.PermissionUserID)
	if input.CompanyID == "" || input.EdgeID == "" || input.ParentEntityID == "" || (input.ActorUserID == "") != (input.PermissionUserID == "") || (input.ActorUserID != "" && input.ActorUserID != input.PermissionUserID) {
		return CompanyExplorerV2Row{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresCompanyExplorerMutationTx(ctx, tx, input.CompanyID, input.PermissionUserID, true); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	var targetType, targetID string
	var previousParentID sql.NullString
	err = tx.QueryRowContext(ctx, `
select target_type, target_id::text, parent_folder_id::text
from company_explorer_items
where company_id=$1::uuid
  and item_id=$2::uuid
for update`, input.CompanyID, input.EdgeID).Scan(&targetType, &targetID, &previousParentID)
	if errors.Is(err, sql.ErrNoRows) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	if err := lockPostgresCompanyExplorerResourceEditTx(ctx, tx, input.CompanyID, input.PermissionUserID, targetType, targetID); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	parentFolderID, parentEntityID, err := r.companyExplorerFinalContainerTarget(ctx, tx, input.CompanyID, input.ParentEntityID, input.PermissionUserID)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	position := input.Position
	if position <= 0 {
		position, err = nextCompanyExplorerFinalPositionSQL(ctx, tx, input.CompanyID, parentFolderID)
		if err != nil {
			return CompanyExplorerV2Row{}, err
		}
	}

	err = tx.QueryRowContext(ctx, `
update company_explorer_items
set parent_folder_id=$3::uuid,
    position=$4,
    updated_timestamp=now()
where company_id=$1::uuid
  and item_id=$2::uuid
returning target_type, target_id::text`, input.CompanyID, input.EdgeID, parentFolderID, position).Scan(&targetType, &targetID)
	if errors.Is(err, sql.ErrNoRows) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	targetParentID := ""
	if parentEntityID != input.CompanyID {
		targetParentID = parentEntityID
	}
	if previousParentID.Valid != (targetParentID != "") || previousParentID.String != targetParentID {
		eventInput := workspaceDomainEventInput(input.CompanyID, "company_explorer_item_placed", map[string]any{
			"item_id": input.EdgeID, "parent_entity_id": parentEntityID,
			"target_type": targetType, "target_id": targetID,
		})
		eventInput.ActorUserID = input.ActorUserID
		if _, err := r.appendDomainEventTx(ctx, tx, eventInput); err != nil {
			return CompanyExplorerV2Row{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	_ = targetType
	return r.GetCompanyExplorerV2EntityWithParent(input.CompanyID, targetID, parentEntityID, input.EdgeID, input.PermissionUserID)
}

func (r *PostgresRepo) DeleteCompanyExplorerV2Edge(companyID, edgeID, actorUserID, permissionUserID string) error {
	companyID = cleanUUIDText(companyID)
	edgeID = cleanUUIDText(edgeID)
	actorUserID = cleanUUIDText(actorUserID)
	permissionUserID = cleanUUIDText(permissionUserID)
	if companyID == "" || edgeID == "" || (actorUserID == "") != (permissionUserID == "") || (actorUserID != "" && actorUserID != permissionUserID) {
		return ErrInvalid
	}
	return r.DeleteCompanyExplorerV2Edges(companyID, []string{edgeID}, actorUserID, permissionUserID)
}

func (r *PostgresRepo) DeleteCompanyExplorerV2Edges(companyID string, edgeIDs []string, actorUserID, permissionUserID string) error {
	companyID = cleanUUIDText(companyID)
	actorUserID = cleanUUIDText(actorUserID)
	permissionUserID = cleanUUIDText(permissionUserID)
	edgeIDs = normalizeCompanyExplorerV2EdgeIDs(edgeIDs)
	if companyID == "" || len(edgeIDs) == 0 || (actorUserID == "") != (permissionUserID == "") || (actorUserID != "" && actorUserID != permissionUserID) {
		return ErrInvalid
	}
	cleanEdgeIDs := make([]string, 0, len(edgeIDs))
	for _, edgeID := range edgeIDs {
		cleanEdgeID := cleanUUIDText(edgeID)
		if cleanEdgeID == "" {
			return ErrInvalid
		}
		cleanEdgeIDs = append(cleanEdgeIDs, cleanEdgeID)
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := lockPostgresCompanyExplorerMutationTx(ctx, tx, companyID, permissionUserID, true); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `
select item_id::text,target_type,target_id::text,coalesce(parent_folder_id::text,'')
from company_explorer_items item
where item.company_id=$1::uuid
	  and item.item_id = any(string_to_array($2, ',')::uuid[])
order by item_id
for update`, companyID, strings.Join(cleanEdgeIDs, ","))
	if err != nil {
		return err
	}
	eventInputs := make([]DomainEventInput, 0, len(cleanEdgeIDs))
	resources := make([]struct{ resourceType, resourceID string }, 0, len(cleanEdgeIDs))
	for rows.Next() {
		var itemID, targetType, targetID, parentID string
		if err := rows.Scan(&itemID, &targetType, &targetID, &parentID); err != nil {
			rows.Close()
			return err
		}
		eventInput := workspaceDomainEventInput(companyID, "company_explorer_item_removed", map[string]any{
			"item_id": itemID, "parent_entity_id": parentID, "target_type": targetType, "target_id": targetID,
		})
		eventInput.ActorUserID = actorUserID
		eventInputs = append(eventInputs, eventInput)
		resources = append(resources, struct{ resourceType, resourceID string }{resourceType: targetType, resourceID: targetID})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(eventInputs) != len(cleanEdgeIDs) {
		return ErrNotFound
	}
	for _, resource := range resources {
		if err := lockPostgresCompanyExplorerResourceEditTx(ctx, tx, companyID, permissionUserID, resource.resourceType, resource.resourceID); err != nil {
			return err
		}
	}

	result, err := tx.ExecContext(ctx, `
delete from company_explorer_items
where company_id=$1::uuid
  and item_id = any(string_to_array($2, ',')::uuid[])`, companyID, strings.Join(cleanEdgeIDs, ","))
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected != int64(len(cleanEdgeIDs)) {
		return ErrNotFound
	}
	if _, err := r.appendDomainEventsTx(ctx, tx, eventInputs); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) DeleteCompanyExplorerV2Folder(companyID, entityID string) error {
	companyID = cleanUUIDText(companyID)
	entityID = cleanUUIDText(entityID)
	if companyID == "" || entityID == "" {
		return ErrInvalid
	}
	if err := protectCompanyExplorerDefaultFolderMutation(companyID, entityID); err != nil {
		return err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := postgresDeleteProcessMapResourceTx(ctx, tx, companyID, domain.ProcessMapResourceTypeFolder, entityID); err != nil {
		return err
	}
	if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "company_explorer_folder", entityID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
delete from company_explorer_folders
where company_id=$1::uuid
  and folder_id=$2::uuid`, companyID, entityID)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}
func (r *PostgresRepo) GetCompanyExplorerV2EntityWithParent(companyID, entityID, parentEntityID, edgeID, permissionUserID string) (CompanyExplorerV2Row, error) {
	row, err := r.GetCompanyExplorerV2Entity(companyID, entityID, permissionUserID)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	if parentEntityID == companyID {
		parentEntityID = ""
	}
	row.ParentEntityID = parentEntityID
	row.EdgeID = edgeID
	if edgeID != "" {
		var position int
		var createdTimestamp, updatedTimestamp sql.NullTime
		err := r.db.QueryRowContext(context.Background(), `
select position, created_timestamp, updated_timestamp
from company_explorer_items
where company_id=$1::uuid
  and item_id=$2::uuid`, companyID, edgeID).Scan(&position, &createdTimestamp, &updatedTimestamp)
		if err == nil {
			row.Position = position
			if createdTimestamp.Valid {
				row.CreatedTimestamp = createdTimestamp.Time
			}
			if updatedTimestamp.Valid {
				row.UpdatedTimestamp = updatedTimestamp.Time
			}
		}
	}
	return row, nil
}

func lockPostgresCompanyExplorerMutationTx(ctx context.Context, tx *sql.Tx, companyID, permissionUserID string, changesPermissionParent bool) error {
	if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended('company-explorer-mutation:' || $1,0))`, companyID); err != nil {
		return err
	}
	if err := lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, companyID, changesPermissionParent); err != nil {
		return err
	}
	if permissionUserID == "" {
		return nil
	}
	var one int
	err := tx.QueryRowContext(ctx, `
select 1
from company_memberships
where user_id=$2::uuid and (company_id=$1::uuid or role='dev_admin')
order by case when company_id=$1::uuid then 0 else 1 end
limit 1`, companyID, permissionUserID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func lockPostgresCompanyExplorerResourceEditTx(ctx context.Context, tx *sql.Tx, companyID, permissionUserID, resourceType, resourceID string) error {
	query := ""
	switch resourceType {
	case EntityTypeCompanyExplorerFolder:
		query = `select 1 from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid`
		if permissionUserID != "" {
			query += ` and mangorts_user_can_access_resource(company_id,'company_explorer_folder',folder_id,$3::uuid,'edit')`
		}
	case EntityTypeLogicGate:
		query = `select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid`
		if permissionUserID != "" {
			query += ` and mangorts_user_can_access_resource(company_id,'logic_gate',logic_gate_id,$3::uuid,'edit')`
		}
	case EntityTypeProject:
		query = `select 1 from projects where company_id=$1::uuid and project_id=$2::uuid`
		if permissionUserID != "" {
			query += ` and mangorts_user_can_access_resource(company_id,'project',project_id,$3::uuid,'edit')`
		}
	default:
		return ErrInvalid
	}
	query += ` for update`
	var one int
	args := []any{companyID, resourceID}
	if permissionUserID != "" {
		args = append(args, permissionUserID)
	}
	err := tx.QueryRowContext(ctx, query, args...).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (r *PostgresRepo) companyExplorerFinalContainerTarget(ctx context.Context, tx *sql.Tx, companyID, parentEntityID, permissionUserID string) (any, string, error) {
	if parentEntityID == companyID {
		return nil, companyID, nil
	}
	if err := lockPostgresCompanyExplorerResourceEditTx(ctx, tx, companyID, permissionUserID, EntityTypeCompanyExplorerFolder, parentEntityID); err != nil {
		return nil, "", err
	}
	return parentEntityID, parentEntityID, nil
}

func nextCompanyExplorerFinalPositionSQL(ctx context.Context, tx *sql.Tx, companyID string, parentFolderID any) (int, error) {
	defer observeTiming(ctx, "repo.nextCompanyExplorerFinalPositionSQL")()
	var position int
	err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from (
  select folder.position
  from company_explorer_folders folder
  where folder.company_id=$1::uuid
    and (($2::uuid is null and folder.parent_folder_id is null) or folder.parent_folder_id=$2::uuid)
  union all
  select item.position
  from company_explorer_items item
  where item.company_id=$1::uuid
    and (($2::uuid is null and item.parent_folder_id is null) or item.parent_folder_id=$2::uuid)
) siblings`, companyID, parentFolderID).Scan(&position)
	return position, err
}

func scanCompanyExplorerV2Subscription(row companyExplorerV2RowScanner) (CompanyExplorerV2Subscription, error) {
	var item CompanyExplorerV2Subscription
	err := row.Scan(
		&item.CompanyID,
		&item.SubscriptionID,
		&item.OwnerType,
		&item.OwnerID,
		&item.AnchorEntityID,
		&item.Position,
		&item.CreatedByUserID,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	return item, err
}

func (r *PostgresRepo) UpsertCompanyExplorerV2Subscription(input CompanyExplorerV2SubscriptionInput) (CompanyExplorerV2Subscription, error) {
	return CompanyExplorerV2Subscription{}, ErrInvalid
}

func (r *PostgresRepo) DeleteCompanyExplorerV2Subscription(companyID, subscriptionID, actorUserID string) error {
	companyID = cleanUUIDText(companyID)
	subscriptionID = cleanUUIDText(subscriptionID)
	if companyID == "" || subscriptionID == "" {
		return ErrInvalid
	}
	return ErrNotFound
}

func postgresCompanyExplorerV2SubscriptionOwnerCanEdit(ctx context.Context, tx *sql.Tx, companyID, ownerType, ownerID, actorUserID string) error {
	return ErrInvalid
}

func postgresCompanyExplorerV2ParentCanEdit(ctx context.Context, tx *sql.Tx, companyID, parentEntityID, userID string) error {
	return ErrInvalid
}
