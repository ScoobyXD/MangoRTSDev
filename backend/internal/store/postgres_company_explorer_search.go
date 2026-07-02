package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
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
with recursive visible_folder_paths as (
  select folder.company_id,
         folder.folder_id,
         folder.parent_folder_id,
         folder.name,
         folder.created_timestamp,
         folder.updated_timestamp,
         '[]'::jsonb as parent_path,
         jsonb_build_array(jsonb_build_object(
           'entity_type', 'folder',
           'entity_id', folder.folder_id::text,
           'name', folder.name
         )) as path
  from company_explorer_folders folder
  where folder.company_id=$1::uuid
    and folder.parent_folder_id is null
    and `+companyExplorerAccessPredicate("'folder'", "folder.folder_id", "$3", "$4")+`
  union all
  select child.company_id,
         child.folder_id,
         child.parent_folder_id,
         child.name,
         child.created_timestamp,
         child.updated_timestamp,
         parent.path as parent_path,
         parent.path || jsonb_build_array(jsonb_build_object(
           'entity_type', 'folder',
           'entity_id', child.folder_id::text,
           'name', child.name
         )) as path
  from company_explorer_folders child
  join visible_folder_paths parent
    on parent.company_id=child.company_id
   and parent.folder_id=child.parent_folder_id
  where `+companyExplorerAccessPredicate("'folder'", "child.folder_id", "$3", "$4")+`
), visible_item_locations as (
  select item.company_id,
         item.target_type,
         item.target_id,
         coalesce(parent.path, '[]'::jsonb) as location_path,
         10 as source_priority
  from company_explorer_items item
  left join visible_folder_paths parent
    on parent.company_id=item.company_id
   and parent.folder_id=item.parent_folder_id
  where item.company_id=$1::uuid
    and item.target_type in ('project', 'logic_gate')
    and ($6 = '' or item.target_type = any(string_to_array($6, ',')::text[]) or 'node' = any(string_to_array($6, ',')::text[]))
    and (item.parent_folder_id is null or parent.folder_id is not null)
    and `+companyExplorerAccessPredicate("item.target_type", "item.target_id", "$3", "$4")+`
), visible_logic_gate_locations as (
  select location.company_id,
         location.target_type,
         location.target_id,
         coalesce(location.location_path, '[]'::jsonb) as location_path,
         location.source_priority
  from visible_item_locations location
  where location.target_type='logic_gate'
), visible_project_locations as (
  select location.company_id,
         location.target_type,
         location.target_id,
         coalesce(location.location_path, '[]'::jsonb) as location_path,
         location.source_priority
  from visible_item_locations location
  where location.target_type='project'
), visible_node_locations as (
  select assignment.company_id,
         'node'::text as target_type,
         assignment.node_id as target_id,
         logic_gate_location.location_path || jsonb_build_array(jsonb_build_object(
           'entity_type', 'logic_gate',
           'entity_id', logic_gate.logic_gate_id::text,
           'resource_id', logic_gate.logic_gate_id::text,
           'name', logic_gate.header
         )) as location_path,
         20 as source_priority
  from node_logic_gate_assignments assignment
  join logic_gates logic_gate
    on logic_gate.company_id=assignment.company_id
   and logic_gate.logic_gate_id=assignment.logic_gate_id
  join visible_logic_gate_locations logic_gate_location
    on logic_gate_location.company_id=assignment.company_id
   and logic_gate_location.target_id=assignment.logic_gate_id
  where assignment.company_id=$1::uuid
    and ($6 = '' or 'node' = any(string_to_array($6, ',')::text[]))
    and `+companyExplorerAccessPredicate("'node'", "assignment.node_id", "$3", "$4")+`
  union all
  select relationship.company_id,
         'node'::text as target_type,
         relationship.resource_id as target_id,
         project_location.location_path || jsonb_build_array(jsonb_build_object(
           'entity_type', 'project',
           'entity_id', project.project_id::text,
           'resource_id', project.project_id::text,
           'name', project.name
         )) as location_path,
         30 as source_priority
  from project_relationships relationship
  join projects project
    on project.company_id=relationship.company_id
   and project.project_id=relationship.project_id
  join visible_project_locations project_location
    on project_location.company_id=relationship.company_id
   and project_location.target_id=relationship.project_id
  where relationship.company_id=$1::uuid
    and relationship.resource_type='node'
    and ($6 = '' or 'node' = any(string_to_array($6, ',')::text[]))
    and `+companyExplorerAccessPredicate("'node'", "relationship.resource_id", "$3", "$4")+`
), node_organization_links as (
  select distinct assignment.company_id,
         assignment.node_id as target_id
  from node_logic_gate_assignments assignment
  where assignment.company_id=$1::uuid
  union
  select distinct relationship.company_id,
         relationship.resource_id as target_id
  from project_relationships relationship
  where relationship.company_id=$1::uuid
    and relationship.resource_type='node'
), all_locations as (
  select item.target_type,
         item.target_id,
         item.location_path,
         item.source_priority
  from visible_item_locations item
  where item.target_type in ('project', 'logic_gate')
  union all
  select node.target_type,
         node.target_id,
         node.location_path,
         node.source_priority
  from visible_node_locations node
), ranked_locations as (
  select target_type,
         target_id,
         location_path,
         row_number() over (partition by target_type, target_id order by source_priority) as rank
  from all_locations
), candidates as (
  select logic_gate.company_id,
         'logic_gate'::text as resource_type,
         logic_gate.logic_gate_id as resource_id,
         logic_gate.logic_gate_id as entity_id,
         logic_gate.header as display_name,
         location.location_path,
         logic_gate.created_timestamp,
         logic_gate.created_timestamp as updated_timestamp
  from logic_gates logic_gate
  join ranked_locations location
    on location.rank=1
   and location.target_type='logic_gate'
   and location.target_id=logic_gate.logic_gate_id
  where logic_gate.company_id=$1::uuid
    and ($6 = '' or 'logic_gate' = any(string_to_array($6, ',')::text[]))
  union all
  select node.company_id,
         'node'::text as resource_type,
         node.node_id as resource_id,
         node.node_id as entity_id,
         node.name as display_name,
         coalesce(location.location_path, '[]'::jsonb) as location_path,
         node.created_timestamp,
         node.created_timestamp as updated_timestamp
  from nodes node
  left join ranked_locations location
    on location.rank=1
   and location.target_type='node'
   and location.target_id=node.node_id
  left join node_organization_links node_link
    on node_link.company_id=node.company_id
   and node_link.target_id=node.node_id
  where node.company_id=$1::uuid
    and ($6 = '' or 'node' = any(string_to_array($6, ',')::text[]))
    and `+companyExplorerAccessPredicate("'node'", "node.node_id", "$3", "$4")+`
    and (location.target_id is not null or node_link.target_id is null)
  union all
  select project.company_id,
         'project'::text as resource_type,
         project.project_id as resource_id,
         project.project_id as entity_id,
         project.name as display_name,
         location.location_path,
         project.created_timestamp,
         project.updated_timestamp
  from projects project
  join ranked_locations location
    on location.rank=1
   and location.target_type='project'
   and location.target_id=project.project_id
  where project.company_id=$1::uuid
    and ($6 = '' or 'project' = any(string_to_array($6, ',')::text[]))
  union all
  select folder.company_id,
         'folder'::text as resource_type,
         folder.folder_id as resource_id,
         folder.folder_id as entity_id,
         folder.name as display_name,
         folder.parent_path as location_path,
         folder.created_timestamp,
         folder.updated_timestamp
  from visible_folder_paths folder
  where ($6 = '' or 'folder' = any(string_to_array($6, ',')::text[]))
), matched as (
  select candidate.*,
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
  where ($6 = '' or candidate.resource_type = any(string_to_array($6, ',')::text[]))
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
limit $5`, query.CompanyID, query.Query, companyExplorerLazyNullable(query.PermissionUserID), EntityPermissionView, query.Limit, strings.Join(query.ResourceTypes, ","))
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
