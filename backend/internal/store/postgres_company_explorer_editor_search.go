package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// searchCompanyExplorerEditorEntities is the lean read model used only by the
// inline # picker. It keeps the normal effective-access and hidden-path rules,
// but deliberately skips building Explorer location JSON that the picker never
// consumes. Name filtering happens inside each resource branch before the
// final bounded sort.
func (r *PostgresRepo) searchCompanyExplorerEditorEntities(query CompanyExplorerSearchQuery) (CompanyExplorerSearchResults, error) {
	rows, err := r.db.QueryContext(context.Background(), `
with recursive visible_folders as (
  select folder.company_id, folder.folder_id
  from company_explorer_folders folder
  where folder.company_id=$1::uuid
    and folder.parent_folder_id is null
    and `+companyExplorerAccessPredicate("'folder'", "folder.folder_id", "$3", "$4")+`
  union all
  select child.company_id, child.folder_id
  from company_explorer_folders child
  join visible_folders parent
    on parent.company_id=child.company_id
   and parent.folder_id=child.parent_folder_id
  where `+companyExplorerAccessPredicate("'folder'", "child.folder_id", "$3", "$4")+`
), visible_items as (
  select distinct item.company_id, item.target_type, item.target_id
  from company_explorer_items item
  left join visible_folders parent
    on parent.company_id=item.company_id
   and parent.folder_id=item.parent_folder_id
  where item.company_id=$1::uuid
    and item.target_type in ('project', 'logic_gate')
    and (item.parent_folder_id is null or parent.folder_id is not null)
    and `+companyExplorerAccessPredicate("item.target_type", "item.target_id", "$3", "$4")+`
), node_organization_links as (
  select assignment.company_id, assignment.node_id
  from node_logic_gate_assignments assignment
  where assignment.company_id=$1::uuid
  union
  select relationship.company_id, relationship.resource_id as node_id
  from project_relationships relationship
  where relationship.company_id=$1::uuid
    and relationship.resource_type='node'
), visible_node_links as (
  select assignment.company_id, assignment.node_id
  from node_logic_gate_assignments assignment
  join visible_items location
    on location.company_id=assignment.company_id
   and location.target_type='logic_gate'
   and location.target_id=assignment.logic_gate_id
  where assignment.company_id=$1::uuid
  union
  select relationship.company_id, relationship.resource_id as node_id
  from project_relationships relationship
  join visible_items location
    on location.company_id=relationship.company_id
   and location.target_type='project'
   and location.target_id=relationship.project_id
  where relationship.company_id=$1::uuid
    and relationship.resource_type='node'
), candidates as (
  select node.company_id,
         'node'::text as resource_type,
         node.node_id as resource_id,
         node.node_id as entity_id,
         node.name as display_name,
         coalesce(node.status, '') as status,
         node.created_timestamp,
         node.created_timestamp as updated_timestamp
  from nodes node
  where node.company_id=$1::uuid
    and ($6 = '' or 'node' = any(string_to_array($6, ',')::text[]))
    and `+companyExplorerAccessPredicate("'node'", "node.node_id", "$3", "$4")+`
    and ($2='' or lower(node.name) like '%' || lower($2) || '%' or node.node_id::text like '%' || $2 || '%')
    and (
      not exists (
        select 1 from node_organization_links linked
        where linked.company_id=node.company_id and linked.node_id=node.node_id
      )
      or exists (
        select 1 from visible_node_links visible
        where visible.company_id=node.company_id and visible.node_id=node.node_id
      )
    )
  union all
  select project.company_id,
         'project'::text as resource_type,
         project.project_id as resource_id,
         project.project_id as entity_id,
         project.name as display_name,
         project.status,
         project.created_timestamp,
         project.updated_timestamp
  from projects project
  join visible_items location
    on location.company_id=project.company_id
   and location.target_type='project'
   and location.target_id=project.project_id
  where project.company_id=$1::uuid
    and ($6 = '' or 'project' = any(string_to_array($6, ',')::text[]))
    and ($2='' or lower(project.name) like '%' || lower($2) || '%' or project.project_id::text like '%' || $2 || '%')
  union all
  select logic_gate.company_id,
         'logic_gate'::text as resource_type,
         logic_gate.logic_gate_id as resource_id,
         logic_gate.logic_gate_id as entity_id,
         logic_gate.header as display_name,
         ''::text as status,
         logic_gate.created_timestamp,
         logic_gate.created_timestamp as updated_timestamp
  from logic_gates logic_gate
  join visible_items location
    on location.company_id=logic_gate.company_id
   and location.target_type='logic_gate'
   and location.target_id=logic_gate.logic_gate_id
  where logic_gate.company_id=$1::uuid
    and ($6 = '' or 'logic_gate' = any(string_to_array($6, ',')::text[]))
    and ($2='' or lower(logic_gate.header) like '%' || lower($2) || '%' or logic_gate.logic_gate_id::text like '%' || $2 || '%')
), matched as (
  select candidate.*,
         case
           when $2='' then 'recent'
           when lower(candidate.display_name)=lower($2) then 'name_exact'
           when lower(candidate.display_name) like lower($2) || '%' then 'name_prefix'
           when lower(candidate.display_name) like '%' || lower($2) || '%' then 'name_contains'
           else 'id_contains'
         end as match_reason,
         case
           when candidate.resource_type='node' and lower(btrim(candidate.status))='done' then 3
           when candidate.resource_type='node' then 0
           when candidate.resource_type='project' and lower(btrim(candidate.status)) in ('done', 'completed', 'archived') then 4
           when candidate.resource_type='project' then 1
           when candidate.resource_type='logic_gate' then 2
           else 5
         end as editor_priority,
         case
           when $2='' then 0
           when lower(candidate.display_name)=lower($2) then 0
           when lower(candidate.display_name) like lower($2) || '%' then 1
           when lower(candidate.display_name) like '%' || lower($2) || '%' then 2
           else 3
         end as match_priority
  from candidates candidate
)
select matched.company_id::text,
       matched.resource_type,
       matched.resource_id::text,
       matched.entity_id::text,
       matched.display_name,
       matched.match_reason,
       '[]'::text as location_path,
       false as has_children,
       matched.created_timestamp,
       matched.updated_timestamp
from matched
order by matched.editor_priority,
         matched.match_priority,
         matched.updated_timestamp desc,
         lower(matched.display_name),
         matched.created_timestamp desc,
         matched.entity_id
limit $5`, query.CompanyID, query.Query, companyExplorerLazyNullable(query.PermissionUserID), EntityPermissionEdit, query.Limit, strings.Join(query.ResourceTypes, ","))
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
