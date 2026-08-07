package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

const (
	editorEntitySearchMinimumBatchSize = 40
	editorEntitySearchMaximumBatchSize = 200
)

// searchCompanyExplorerEditorEntities first ranks a bounded candidate batch
// directly from the requested resource tables. Permission and location checks
// run only for those candidates. If permissions remove too many candidates, the
// next ranked batch is checked until the requested result count is filled or
// the matching resource rows are exhausted.
func (r *PostgresRepo) searchCompanyExplorerEditorEntities(query CompanyExplorerSearchQuery) (CompanyExplorerSearchResults, error) {
	batchSize := query.Limit * 4
	if batchSize < editorEntitySearchMinimumBatchSize {
		batchSize = editorEntitySearchMinimumBatchSize
	}
	if batchSize > editorEntitySearchMaximumBatchSize {
		batchSize = editorEntitySearchMaximumBatchSize
	}

	results := make([]CompanyExplorerSearchResult, 0, query.Limit)
	for offset := 0; len(results) < query.Limit; offset += batchSize {
		batch, err := r.searchCompanyExplorerEditorEntityBatch(query, batchSize, offset)
		if err != nil {
			return CompanyExplorerSearchResults{}, err
		}
		for _, candidate := range batch {
			if candidate.allowed {
				results = append(results, candidate.result)
				if len(results) == query.Limit {
					break
				}
			}
		}
		if len(batch) < batchSize {
			break
		}
	}
	return CompanyExplorerSearchResults{Results: results}, nil
}

type editorEntitySearchCandidate struct {
	result  CompanyExplorerSearchResult
	allowed bool
}

func (r *PostgresRepo) searchCompanyExplorerEditorEntityBatch(query CompanyExplorerSearchQuery, batchSize, offset int) ([]editorEntitySearchCandidate, error) {
	ctx := query.Context
	if ctx == nil {
		ctx = context.Background()
	}
	rows, err := r.db.QueryContext(ctx, `
with recursive candidates as (
  select node.company_id,
         'node'::text as resource_type,
         node.node_id as resource_id,
         node.node_id as entity_id,
         node.name as display_name,
         node.created_timestamp,
         node.created_timestamp as updated_timestamp
  from nodes node
  where node.company_id=$1::uuid
    and ($6 = '' or 'node' = any(string_to_array($6, ',')::text[]))
    and ($2='' or lower(node.name) like '%' || lower($2) || '%' or node.node_id::text like '%' || $2 || '%')
  union all
  select project.company_id,
         'project'::text as resource_type,
         project.project_id as resource_id,
         project.project_id as entity_id,
         project.name as display_name,
         project.created_timestamp,
         project.updated_timestamp
  from projects project
  where project.company_id=$1::uuid
    and ($6 = '' or 'project' = any(string_to_array($6, ',')::text[]))
    and ($2='' or lower(project.name) like '%' || lower($2) || '%' or project.project_id::text like '%' || $2 || '%')
  union all
  select logic_gate.company_id,
         'logic_gate'::text as resource_type,
         logic_gate.logic_gate_id as resource_id,
         logic_gate.logic_gate_id as entity_id,
         logic_gate.header as display_name,
         logic_gate.created_timestamp,
         logic_gate.created_timestamp as updated_timestamp
  from logic_gates logic_gate
  where logic_gate.company_id=$1::uuid
    and ($6 = '' or 'logic_gate' = any(string_to_array($6, ',')::text[]))
    and ($2='' or lower(logic_gate.header) like '%' || lower($2) || '%' or logic_gate.logic_gate_id::text like '%' || $2 || '%')
), ranked_candidates as (
  select candidate.*,
         case
           when $2='' then 'recent'
           when lower(candidate.display_name)=lower($2) then 'name_exact'
           when lower(candidate.display_name) like lower($2) || '%' then 'name_prefix'
           when lower(candidate.display_name) like '%' || lower($2) || '%' then 'name_contains'
           else 'id_contains'
         end as match_reason,
         case candidate.resource_type
           when 'node' then 0
           when 'project' then 1
           when 'logic_gate' then 2
           else 3
         end as editor_priority,
         case
           when $2='' then 0
           when lower(candidate.display_name)=lower($2) then 0
           when lower(candidate.display_name) like lower($2) || '%' then 1
           when lower(candidate.display_name) like '%' || lower($2) || '%' then 2
           else 3
         end as match_priority
  from candidates candidate
), candidate_batch as materialized (
  select *
  from ranked_candidates
  order by editor_priority,
           match_priority,
           updated_timestamp desc,
           lower(display_name),
           created_timestamp desc,
           entity_id
  limit $4 offset $5
), organization_links as (
  select candidate.resource_type as candidate_type,
         candidate.resource_id as candidate_id,
         'logic_gate'::text as location_type,
         assignment.logic_gate_id as location_id
  from candidate_batch candidate
  join node_logic_gate_assignments assignment
    on candidate.resource_type='node'
   and assignment.company_id=candidate.company_id
   and assignment.node_id=candidate.resource_id
  union
  select candidate.resource_type,
         candidate.resource_id,
         'project'::text,
         relationship.project_id
  from candidate_batch candidate
  join project_relationships relationship
    on candidate.resource_type='node'
   and relationship.company_id=candidate.company_id
   and relationship.resource_type='node'
   and relationship.resource_id=candidate.resource_id
), candidate_locations as (
  select candidate.resource_type as candidate_type,
         candidate.resource_id as candidate_id,
         candidate.resource_type as location_type,
         candidate.resource_id as location_id,
         item.parent_folder_id
  from candidate_batch candidate
  join company_explorer_items item
    on candidate.resource_type in ('project','logic_gate')
   and item.company_id=candidate.company_id
   and item.target_type=candidate.resource_type
   and item.target_id=candidate.resource_id
  union all
  select link.candidate_type,
         link.candidate_id,
         link.location_type,
         link.location_id,
         item.parent_folder_id
  from organization_links link
  join company_explorer_items item
    on item.company_id=$1::uuid
   and item.target_type=link.location_type
   and item.target_id=link.location_id
), location_folders(candidate_type,candidate_id,location_type,location_id,folder_id,parent_folder_id,depth,path) as (
  select location.candidate_type,
         location.candidate_id,
         location.location_type,
         location.location_id,
         folder.folder_id,
         folder.parent_folder_id,
         0,
         array[folder.folder_id]
  from candidate_locations location
  join company_explorer_folders folder
    on folder.company_id=$1::uuid
   and folder.folder_id=location.parent_folder_id
  union all
  select child.candidate_type,
         child.candidate_id,
         child.location_type,
         child.location_id,
         parent.folder_id,
         parent.parent_folder_id,
         child.depth+1,
         child.path || parent.folder_id
  from location_folders child
  join company_explorer_folders parent
    on parent.company_id=$1::uuid
   and parent.folder_id=child.parent_folder_id
  where child.depth<100 and not parent.folder_id=any(child.path)
), member_groups_raw(group_id,depth,path) as (
  select member.group_id,0,array[member.group_id]
  from company_user_group_members member
  where $3<>'' and member.company_id=$1::uuid and member.user_id=nullif($3,'')::uuid
  union all
  select parent.parent_group_id,member.depth+1,member.path || parent.parent_group_id
  from member_groups_raw member
  join company_user_groups parent
    on parent.company_id=$1::uuid and parent.group_id=member.group_id
  where parent.parent_group_id is not null
    and member.depth<100
    and not parent.parent_group_id=any(member.path)
), member_groups as (
  select group_id,min(depth) as depth
  from member_groups_raw
  group by group_id
), access_targets as (
  select candidate.resource_type,candidate.resource_id
  from candidate_batch candidate
  where $3<>''
  union
  select location.location_type,location.location_id
  from candidate_locations location
  where $3<>''
  union
  select 'company_explorer_folder'::text,folder.folder_id
  from location_folders folder
  where $3<>''
), resolved_targets as (
  select target.resource_type,
         target.resource_id,
         resolved.source_resource_type,
         resolved.source_resource_id
  from access_targets target
  cross join lateral mangorts_v2_resolve_permission_policy($1::uuid,target.resource_type,target.resource_id) resolved
), target_access as (
  select target.resource_type,
         target.resource_id,
         coalesce(
           (select access.access_level
            from resource_permissions access
            where access.company_id=$1::uuid
              and access.resource_type=target.source_resource_type
              and access.resource_id=target.source_resource_id
              and access.subject_type='user'
              and access.subject_id=nullif($3,'')::uuid
            limit 1),
           (select access.access_level
            from resource_permissions access
            join member_groups membership on membership.group_id=access.subject_id
            where access.company_id=$1::uuid
              and access.resource_type=target.source_resource_type
              and access.resource_id=target.source_resource_id
              and access.subject_type='group'
            order by membership.depth,
                     case access.access_level when 'no_access' then 0 else 1 end,
                     access.subject_id
            limit 1),
           setting.default_access
         )='edit' as allowed
  from resolved_targets target
  join resource_permission_settings setting
    on setting.company_id=$1::uuid
   and setting.resource_type=target.source_resource_type
   and setting.resource_id=target.source_resource_id
), candidate_access as (
  select candidate.resource_type,
         candidate.resource_id,
         case
           when $3='' then true
           when not coalesce(direct_access.allowed,false) then false
           when candidate.resource_type='node' and not exists (
             select 1 from organization_links link
             where link.candidate_type=candidate.resource_type and link.candidate_id=candidate.resource_id
           ) then true
           else exists (
             select 1
             from candidate_locations location
             left join target_access location_access
               on location_access.resource_type=location.location_type
              and location_access.resource_id=location.location_id
             where location.candidate_type=candidate.resource_type
               and location.candidate_id=candidate.resource_id
               and coalesce(location_access.allowed,false)
               and not exists (
                 select 1
                 from location_folders folder
                 left join target_access folder_access
                   on folder_access.resource_type='company_explorer_folder'
                  and folder_access.resource_id=folder.folder_id
                 where folder.candidate_type=location.candidate_type
                   and folder.candidate_id=location.candidate_id
                   and folder.location_type=location.location_type
                   and folder.location_id=location.location_id
                   and not coalesce(folder_access.allowed,false)
               )
           )
         end as allowed
  from candidate_batch candidate
  left join target_access direct_access
    on direct_access.resource_type=candidate.resource_type
   and direct_access.resource_id=candidate.resource_id
)
select candidate.company_id::text,
       candidate.resource_type,
       candidate.resource_id::text,
       candidate.entity_id::text,
       candidate.display_name,
       candidate.match_reason,
       '[]'::text as location_path,
       false as has_children,
       candidate.created_timestamp,
       candidate.updated_timestamp,
       access.allowed
from candidate_batch candidate
join candidate_access access
  on access.resource_type=candidate.resource_type
 and access.resource_id=candidate.resource_id
order by candidate.editor_priority,
         candidate.match_priority,
         candidate.updated_timestamp desc,
         lower(candidate.display_name),
         candidate.created_timestamp desc,
         candidate.entity_id`, query.CompanyID, query.Query, strings.TrimSpace(query.PermissionUserID), batchSize, offset, strings.Join(query.ResourceTypes, ","))
	if errors.Is(err, sql.ErrNoRows) {
		return []editorEntitySearchCandidate{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]editorEntitySearchCandidate, 0, batchSize)
	for rows.Next() {
		var item editorEntitySearchCandidate
		var pathJSON string
		if err := rows.Scan(
			&item.result.CompanyID,
			&item.result.ResourceType,
			&item.result.ResourceID,
			&item.result.EntityID,
			&item.result.DisplayName,
			&item.result.MatchReason,
			&pathJSON,
			&item.result.HasChildren,
			&item.result.CreatedTimestamp,
			&item.result.UpdatedTimestamp,
			&item.allowed,
		); err != nil {
			return nil, err
		}
		item.result.LocationPath = []CompanyExplorerLocationSegment{}
		items = append(items, item)
	}
	return items, rows.Err()
}
