package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

type companyExplorerSearchResultScanner interface {
	Scan(dest ...any) error
}

func scanCompanyExplorerSearchResult(row companyExplorerSearchResultScanner) (CompanyExplorerSearchResult, error) {
	var item CompanyExplorerSearchResult
	var pathJSON string
	err := row.Scan(
		&item.CompanyID,
		&item.ResourceType,
		&item.ResourceID,
		&item.EntityID,
		&item.DisplayName,
		&item.MatchReason,
		&pathJSON,
		&item.HasChildren,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if err != nil {
		return item, err
	}
	if pathJSON != "" {
		_ = json.Unmarshal([]byte(pathJSON), &item.LocationPath)
	}
	if item.LocationPath == nil {
		item.LocationPath = []CompanyExplorerLocationSegment{}
	}
	item.ProtectedDefaultFolder = item.ResourceType == CompanyExplorerV2EntityFolder && isCompanyExplorerDefaultFolderID(item.CompanyID, item.EntityID)
	return item, nil
}

func scanCompanyExplorerSearchResults(rows *sql.Rows) ([]CompanyExplorerSearchResult, error) {
	defer rows.Close()
	items := make([]CompanyExplorerSearchResult, 0)
	for rows.Next() {
		item, err := scanCompanyExplorerSearchResult(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) SearchCompanyExplorer(query CompanyExplorerSearchQuery) (CompanyExplorerSearchResults, error) {
	query, err := normalizeCompanyExplorerSearchQuery(query)
	if err != nil {
		return CompanyExplorerSearchResults{}, err
	}
	if err := r.ensureCompanyExplorerDefaultState(query.CompanyID); err != nil {
		return CompanyExplorerSearchResults{}, err
	}
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx, `
with recursive folder_paths as (
  select folder.company_id,
         folder.folder_id,
         folder.parent_folder_id,
         folder.name,
         jsonb_build_array(jsonb_build_object(
           'entity_type', 'folder',
           'entity_id', folder.folder_id::text,
           'name', folder.name
         )) as path
  from company_explorer_folders folder
  where folder.company_id=$1::uuid
    and folder.parent_folder_id is null
  union all
  select child.company_id,
         child.folder_id,
         child.parent_folder_id,
         child.name,
         parent.path || jsonb_build_array(jsonb_build_object(
           'entity_type', 'folder',
           'entity_id', child.folder_id::text,
           'name', child.name
         )) as path
  from company_explorer_folders child
  join folder_paths parent
    on parent.company_id=child.company_id
   and parent.folder_id=child.parent_folder_id
), item_locations as (
  select item.target_type,
         item.target_id,
         coalesce(parent.path, '[]'::jsonb) as path,
         10 as source_priority
  from company_explorer_items item
  left join folder_paths parent
    on parent.company_id=item.company_id
   and parent.folder_id=item.parent_folder_id
  where item.company_id=$1::uuid
), project_locations as (
  select location.target_type,
         location.target_id,
         location.path,
         location.source_priority
  from item_locations location
  where location.target_type='project'
), logic_gate_locations as (
  select location.target_type,
         location.target_id,
         location.path,
         location.source_priority
  from item_locations location
  where location.target_type='logic_gate'
  union all
  select 'logic_gate'::text as target_type,
         relationship.resource_id as target_id,
         project_location.path || jsonb_build_array(jsonb_build_object(
           'entity_type', 'project',
           'entity_id', project.project_id::text,
           'resource_id', project.project_id::text,
           'name', project.name
         )) as path,
         20 as source_priority
  from project_relationships relationship
  join projects project
    on project.company_id=relationship.company_id
   and project.project_id=relationship.project_id
  join project_locations project_location
    on project_location.target_id=relationship.project_id
  where relationship.company_id=$1::uuid
    and relationship.resource_type='logic_gate'
), node_locations as (
  select location.target_type,
         location.target_id,
         location.path,
         location.source_priority
  from item_locations location
  where location.target_type='node'
  union all
  select 'node'::text as target_type,
         assignment.node_id as target_id,
         logic_gate_location.path || jsonb_build_array(jsonb_build_object(
           'entity_type', 'logic_gate',
           'entity_id', logic_gate.logic_gate_id::text,
           'resource_id', logic_gate.logic_gate_id::text,
           'name', logic_gate.header
         )) as path,
         20 as source_priority
  from node_logic_gate_assignments assignment
  join logic_gates logic_gate
    on logic_gate.company_id=assignment.company_id
   and logic_gate.logic_gate_id=assignment.logic_gate_id
  join logic_gate_locations logic_gate_location
    on logic_gate_location.target_id=assignment.logic_gate_id
  where assignment.company_id=$1::uuid
  union all
  select 'node'::text as target_type,
         relationship.resource_id as target_id,
         project_location.path || jsonb_build_array(jsonb_build_object(
           'entity_type', 'project',
           'entity_id', project.project_id::text,
           'resource_id', project.project_id::text,
           'name', project.name
         )) as path,
         30 as source_priority
  from project_relationships relationship
  join projects project
    on project.company_id=relationship.company_id
   and project.project_id=relationship.project_id
  join project_locations project_location
    on project_location.target_id=relationship.project_id
  where relationship.company_id=$1::uuid
    and relationship.resource_type='node'
), all_locations as (
  select * from project_locations
  union all select * from logic_gate_locations
  union all select * from node_locations
), ranked_locations as (
  select target_type,
         target_id,
         path,
         row_number() over (partition by target_type, target_id order by source_priority) as rank
  from all_locations
), candidates as (
  select logic_gate.company_id,
         'logic_gate'::text as resource_type,
         logic_gate.logic_gate_id as resource_id,
         logic_gate.logic_gate_id as entity_id,
         logic_gate.header as display_name,
         null::jsonb as folder_path,
         logic_gate.created_timestamp,
         logic_gate.created_timestamp as updated_timestamp
  from logic_gates logic_gate
  where logic_gate.company_id=$1::uuid
  union all
  select node.company_id,
         'node'::text as resource_type,
         node.node_id as resource_id,
         node.node_id as entity_id,
         node.name as display_name,
         null::jsonb as folder_path,
         node.created_timestamp,
         node.created_timestamp as updated_timestamp
  from nodes node
  where node.company_id=$1::uuid
  union all
  select project.company_id,
         'project'::text as resource_type,
         project.project_id as resource_id,
         project.project_id as entity_id,
         project.name as display_name,
         null::jsonb as folder_path,
         project.created_timestamp,
         project.updated_timestamp
  from projects project
  where project.company_id=$1::uuid
  union all
  select folder.company_id,
         'folder'::text as resource_type,
         folder.folder_id as resource_id,
         folder.folder_id as entity_id,
         folder.name as display_name,
         coalesce(parent.path, '[]'::jsonb) as folder_path,
         folder.created_timestamp,
         folder.updated_timestamp
  from company_explorer_folders folder
  left join folder_paths parent
    on parent.company_id=folder.company_id
   and parent.folder_id=folder.parent_folder_id
  where folder.company_id=$1::uuid
), matched as (
  select candidate.*,
         coalesce(candidate.folder_path, location.path, '[]'::jsonb) as location_path,
         case
           when lower(candidate.display_name)=lower($2) then 'name_exact'
           when lower(candidate.display_name) like lower($2) || '%' then 'name_prefix'
           when lower(candidate.display_name) like '%' || lower($2) || '%' then 'name_contains'
           else 'id_contains'
         end as match_reason,
         case candidate.resource_type
           when 'logic_gate' then 0
           when 'node' then 1
           when 'project' then 2
           when 'folder' then 3
           else 4
         end as type_priority,
         case
           when lower(candidate.display_name)=lower($2) then 0
           when lower(candidate.display_name) like lower($2) || '%' then 1
           when lower(candidate.display_name) like '%' || lower($2) || '%' then 2
           else 3
         end as match_priority
  from candidates candidate
  left join ranked_locations location
    on location.rank=1
   and location.target_type=candidate.resource_type
   and location.target_id=candidate.resource_id
  where `+companyExplorerAccessPredicate("candidate.resource_type", "candidate.entity_id", "$3", "$4")+`
    and (
      lower(candidate.display_name) like '%' || lower($2) || '%'
      or candidate.entity_id::text like '%' || $2 || '%'
    )
)
select matched.company_id::text,
       matched.resource_type,
       matched.resource_id::text,
       matched.entity_id::text,
       matched.display_name,
       matched.match_reason,
       matched.location_path::text,
       `+companyExplorerFinalHasChildrenExpr("matched.resource_type", "matched.entity_id")+` as has_children,
       matched.created_timestamp,
       matched.updated_timestamp
from matched
order by matched.type_priority,
         matched.match_priority,
         lower(matched.display_name),
         matched.created_timestamp desc,
         matched.entity_id
limit $5`, query.CompanyID, query.Query, companyExplorerLazyNullable(query.PermissionUserID), EntityPermissionView, query.Limit)
	if errors.Is(err, sql.ErrNoRows) {
		return CompanyExplorerSearchResults{Results: []CompanyExplorerSearchResult{}}, nil
	}
	if err != nil {
		return CompanyExplorerSearchResults{}, err
	}
	items, err := scanCompanyExplorerSearchResults(rows)
	if err != nil {
		return CompanyExplorerSearchResults{}, err
	}
	return CompanyExplorerSearchResults{Results: items}, nil
}
