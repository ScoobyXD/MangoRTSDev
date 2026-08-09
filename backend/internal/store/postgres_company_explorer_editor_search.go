package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

const (
	companyExplorerSearchMinimumBatchSize = 40
	companyExplorerSearchMaximumBatchSize = 200
)

// searchCompanyExplorerCandidates ranks matching source rows before it touches
// permissions or Explorer ancestry. Company Explorer and the editor picker use
// different result ordering, but share the same bounded authorization path.
func (r *PostgresRepo) searchCompanyExplorerCandidates(query CompanyExplorerSearchQuery) (CompanyExplorerSearchResults, error) {
	batchSize := query.Limit * 4
	if batchSize < companyExplorerSearchMinimumBatchSize {
		batchSize = companyExplorerSearchMinimumBatchSize
	}
	if batchSize > companyExplorerSearchMaximumBatchSize {
		batchSize = companyExplorerSearchMaximumBatchSize
	}

	results := make([]CompanyExplorerSearchResult, 0, query.Limit)
	for offset := 0; len(results) < query.Limit; offset += batchSize {
		batch, err := r.searchCompanyExplorerCandidateBatch(query, batchSize, offset)
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

type companyExplorerSearchCandidate struct {
	result  CompanyExplorerSearchResult
	allowed bool
}

func (r *PostgresRepo) searchCompanyExplorerCandidateBatch(query CompanyExplorerSearchQuery, batchSize, offset int) ([]companyExplorerSearchCandidate, error) {
	ctx := query.Context
	if ctx == nil {
		ctx = context.Background()
	}
	rows, err := r.db.QueryContext(ctx, `
with recursive candidates as (
  select node.company_id,
         'node'::text as resource_type,
         'node'::text as permission_resource_type,
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
         'project'::text,
         'project'::text,
         project.project_id,
         project.project_id,
         project.name,
         project.created_timestamp,
         project.updated_timestamp
  from projects project
  where project.company_id=$1::uuid
    and ($6 = '' or 'project' = any(string_to_array($6, ',')::text[]))
    and ($2='' or lower(project.name) like '%' || lower($2) || '%' or project.project_id::text like '%' || $2 || '%')
  union all
  select logic_gate.company_id,
         'logic_gate'::text,
         'logic_gate'::text,
         logic_gate.logic_gate_id,
         logic_gate.logic_gate_id,
         logic_gate.header,
         logic_gate.created_timestamp,
         logic_gate.created_timestamp
  from logic_gates logic_gate
  where logic_gate.company_id=$1::uuid
    and ($6 = '' or 'logic_gate' = any(string_to_array($6, ',')::text[]))
    and ($2='' or lower(logic_gate.header) like '%' || lower($2) || '%' or logic_gate.logic_gate_id::text like '%' || $2 || '%')
  union all
  select folder.company_id,
         'folder'::text,
         'company_explorer_folder'::text,
         folder.folder_id,
         folder.folder_id,
         folder.name,
         folder.created_timestamp,
         folder.updated_timestamp
  from company_explorer_folders folder
  where not $7
    and folder.company_id=$1::uuid
    and ($6 = '' or 'folder' = any(string_to_array($6, ',')::text[]))
    and ($2='' or lower(folder.name) like '%' || lower($2) || '%' or folder.folder_id::text like '%' || $2 || '%')
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
         case candidate.resource_type
           when 'logic_gate' then 0
           when 'node' then 1
           when 'project' then 2
           when 'folder' then 3
           else 4
         end as explorer_priority,
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
  order by case when $7 then editor_priority else explorer_priority end,
           match_priority,
           case when $7 then updated_timestamp end desc,
           lower(display_name),
           created_timestamp desc,
           entity_id
  limit $4 offset $5
), organization_links as (
  select candidate.resource_type as candidate_type,
         candidate.resource_id as candidate_id,
         'logic_gate'::text as location_type,
         logic_gate.logic_gate_id as location_id,
         logic_gate.header as location_name,
         20 as source_priority
  from candidate_batch candidate
  join node_logic_gate_assignments assignment
    on candidate.resource_type='node'
   and assignment.company_id=candidate.company_id
   and assignment.node_id=candidate.resource_id
  join logic_gates logic_gate
    on logic_gate.company_id=assignment.company_id
   and logic_gate.logic_gate_id=assignment.logic_gate_id
  union
  select candidate.resource_type,
         candidate.resource_id,
         'project'::text,
         project.project_id,
         project.name,
         30
  from candidate_batch candidate
  join project_relationships relationship
    on candidate.resource_type='node'
   and relationship.company_id=candidate.company_id
   and relationship.resource_type='node'
   and relationship.resource_id=candidate.resource_id
  join projects project
    on project.company_id=relationship.company_id
   and project.project_id=relationship.project_id
), candidate_locations as (
  select candidate.resource_type as candidate_type,
         candidate.resource_id as candidate_id,
         candidate.permission_resource_type as location_type,
         candidate.resource_id as location_id,
         candidate.display_name as location_name,
         item.parent_folder_id,
         10 as source_priority
  from candidate_batch candidate
  join company_explorer_items item
    on candidate.resource_type in ('project','logic_gate')
   and item.company_id=candidate.company_id
   and item.target_type=candidate.resource_type
   and item.target_id=candidate.resource_id
  union all
  select candidate.resource_type,
         candidate.resource_id,
         'company_explorer_folder'::text,
         candidate.resource_id,
         candidate.display_name,
         folder.parent_folder_id,
         10
  from candidate_batch candidate
  join company_explorer_folders folder
    on candidate.resource_type='folder'
   and folder.company_id=candidate.company_id
   and folder.folder_id=candidate.resource_id
  union all
  select link.candidate_type,
         link.candidate_id,
         link.location_type,
         link.location_id,
         link.location_name,
         item.parent_folder_id,
         link.source_priority
  from organization_links link
  join company_explorer_items item
    on item.company_id=$1::uuid
   and item.target_type=link.location_type
   and item.target_id=link.location_id
), location_folders(candidate_type,candidate_id,location_type,location_id,folder_id,parent_folder_id,folder_name,depth,path) as (
  select location.candidate_type,
         location.candidate_id,
         location.location_type,
         location.location_id,
         folder.folder_id,
         folder.parent_folder_id,
         folder.name,
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
         parent.name,
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
  select candidate.permission_resource_type as resource_type,candidate.resource_id
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
), eligible_locations as (
  select location.candidate_type,
         location.candidate_id,
         location.location_type,
         location.location_id,
         location.location_name,
         location.source_priority,
         case when $7 then '[]'::jsonb else coalesce((
           select jsonb_agg(jsonb_build_object(
             'entity_type','folder',
             'entity_id',folder.folder_id::text,
             'name',folder.folder_name
           ) order by folder.depth desc)
           from location_folders folder
           where folder.candidate_type=location.candidate_type
             and folder.candidate_id=location.candidate_id
             and folder.location_type=location.location_type
             and folder.location_id=location.location_id
         ),'[]'::jsonb) end as folder_path
  from candidate_locations location
  left join target_access location_access
    on location_access.resource_type=location.location_type
   and location_access.resource_id=location.location_id
  where ($3='' or coalesce(location_access.allowed,false))
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
        and $3<>''
        and not coalesce(folder_access.allowed,false)
    )
), ranked_locations as (
  select location.*,
         row_number() over (
           partition by location.candidate_type,location.candidate_id
           order by location.source_priority,location.folder_path::text,location.location_id
         ) as rank
  from eligible_locations location
), candidate_access as (
  select candidate.resource_type,
         candidate.resource_id,
         case
           when $7 and $3='' then true
           when not ($3='' or coalesce(direct_access.allowed,false)) then false
           when candidate.resource_type='node' and not exists (
             select 1 from organization_links link
             where link.candidate_type=candidate.resource_type and link.candidate_id=candidate.resource_id
           ) then true
           else exists (
             select 1 from ranked_locations location
             where location.candidate_type=candidate.resource_type
               and location.candidate_id=candidate.resource_id
               and location.rank=1
           )
         end as allowed
  from candidate_batch candidate
  left join target_access direct_access
    on direct_access.resource_type=candidate.permission_resource_type
   and direct_access.resource_id=candidate.resource_id
)
select candidate.company_id::text,
       candidate.resource_type,
       candidate.resource_id::text,
       candidate.entity_id::text,
       candidate.display_name,
       candidate.match_reason,
       case
         when $7 then '[]'::jsonb
         when candidate.resource_type='node' and location.location_id is not null then
           location.folder_path || jsonb_build_array(jsonb_build_object(
             'entity_type',location.location_type,
             'entity_id',location.location_id::text,
             'resource_id',location.location_id::text,
             'name',location.location_name
           ))
         else coalesce(location.folder_path,'[]'::jsonb)
       end::text as location_path,
       case when $7 or not access.allowed then false else `+companyExplorerFinalHasChildrenExpr("candidate.resource_type", "candidate.entity_id")+` end as has_children,
       candidate.created_timestamp,
       candidate.updated_timestamp,
       access.allowed
from candidate_batch candidate
join candidate_access access
  on access.resource_type=candidate.resource_type
 and access.resource_id=candidate.resource_id
left join ranked_locations location
  on location.candidate_type=candidate.resource_type
 and location.candidate_id=candidate.resource_id
 and location.rank=1
order by case when $7 then candidate.editor_priority else candidate.explorer_priority end,
         candidate.match_priority,
         case when $7 then candidate.updated_timestamp end desc,
         lower(candidate.display_name),
         candidate.created_timestamp desc,
         candidate.entity_id`, query.CompanyID, query.Query, strings.TrimSpace(query.PermissionUserID), batchSize, offset, strings.Join(query.ResourceTypes, ","), query.EditorEntityRanking)
	if errors.Is(err, sql.ErrNoRows) {
		return []companyExplorerSearchCandidate{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]companyExplorerSearchCandidate, 0, batchSize)
	for rows.Next() {
		var item companyExplorerSearchCandidate
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
		if pathJSON != "" {
			_ = json.Unmarshal([]byte(pathJSON), &item.result.LocationPath)
		}
		if item.result.LocationPath == nil {
			item.result.LocationPath = []CompanyExplorerLocationSegment{}
		}
		item.result.ProtectedDefaultFolder = item.result.ResourceType == CompanyExplorerV2EntityFolder && isCompanyExplorerDefaultFolderID(item.result.CompanyID, item.result.EntityID)
		items = append(items, item)
	}
	return items, rows.Err()
}
