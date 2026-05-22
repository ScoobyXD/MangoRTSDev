package store

import (
	"context"
	"sort"
)

func (r *PostgresRepo) RebuildEffectiveResourceAccessForCompany(companyID string) error {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from companies where company_id=$1::uuid)`, companyID); err != nil {
		return err
	} else if !exists {
		return ErrNotFound
	}

	if _, err := tx.ExecContext(ctx, `delete from effective_resource_access where company_id=$1::uuid`, companyID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
with recursive resources as (
  select company_id, 'node'::text as resource_type, node_id as resource_id
  from nodes
  where company_id=$1::uuid
  union all
  select company_id, 'logic_gate'::text, logic_gate_id
  from logic_gates
  where company_id=$1::uuid
  union all
  select company_id, 'shared_triage_folder'::text, folder_id
  from company_explorer_folders
  where company_id=$1::uuid
    and folder_kind='communications'
),
shared_descendants as (
  select folder.company_id,
         folder.folder_id as source_folder_id,
         folder.folder_id as target_folder_id,
         0 as depth,
         array[folder.folder_id] as path
  from company_explorer_folders folder
  where folder.company_id=$1::uuid
    and folder.folder_kind='communications'
  union all
  select parent.company_id,
         parent.source_folder_id,
         child.folder_id,
         parent.depth + 1,
         parent.path || child.folder_id
  from shared_descendants parent
  join company_explorer_folders child
    on child.company_id=parent.company_id
   and child.folder_kind='communications'
   and child.parent_folder_id=parent.target_folder_id
  where not child.folder_id = any(parent.path)
),
group_descendants as (
  select user_group.company_id,
         user_group.group_id as root_group_id,
         user_group.group_id,
         array[user_group.group_id] as path
  from company_user_groups user_group
  where user_group.company_id=$1::uuid
  union all
  select parent.company_id,
         parent.root_group_id,
         child.group_id,
         parent.path || child.group_id
  from group_descendants parent
  join company_user_groups child
    on child.company_id=parent.company_id
   and child.parent_group_id=parent.group_id
  where not child.group_id = any(parent.path)
),
legacy_grant_scope as (
  select grant_row.company_id,
         grant_row.resource_type,
         grant_row.resource_id as source_resource_id,
         grant_row.resource_id as resource_id,
         grant_row.principal_type,
         grant_row.principal_id,
         lower(btrim(grant_row.access_level)) as access_level,
         0 as depth
  from resource_access_grants grant_row
  join resources resource
    on resource.company_id=grant_row.company_id
   and resource.resource_type=grant_row.resource_type
   and resource.resource_id=grant_row.resource_id
  where grant_row.company_id=$1::uuid
    and grant_row.resource_type in ('node', 'logic_gate')
  union all
  select grant_row.company_id,
         grant_row.resource_type,
         grant_row.resource_id,
         shared.target_folder_id,
         grant_row.principal_type,
         grant_row.principal_id,
         lower(btrim(grant_row.access_level)),
         shared.depth
  from resource_access_grants grant_row
  join shared_descendants shared
    on shared.company_id=grant_row.company_id
   and shared.source_folder_id=grant_row.resource_id
  where grant_row.company_id=$1::uuid
    and grant_row.resource_type='shared_triage_folder'
),
legacy_candidates as (
  select scope.company_id,
         scope.principal_id as user_id,
         scope.resource_type,
         scope.resource_id,
         scope.access_level,
         'direct_user_grant'::text as source_type,
         scope.resource_type || ':' || scope.source_resource_id::text || ':user:' || scope.principal_id::text as source_id,
         scope.depth,
         2 as subject_rank,
         mangorts_access_level_rank(scope.access_level) as access_rank
  from legacy_grant_scope scope
  join company_memberships membership
    on membership.company_id=scope.company_id
   and membership.user_id=scope.principal_id
  where scope.principal_type='user'
  union all
  select scope.company_id,
         member.user_id,
         scope.resource_type,
         scope.resource_id,
         scope.access_level,
         'direct_group_grant'::text,
         scope.resource_type || ':' || scope.source_resource_id::text || ':group:' || scope.principal_id::text,
         scope.depth,
         1,
         mangorts_access_level_rank(scope.access_level)
  from legacy_grant_scope scope
  join group_descendants descendant
    on descendant.company_id=scope.company_id
   and descendant.root_group_id=scope.principal_id
  join company_user_group_members member
    on member.company_id=scope.company_id
   and member.group_id=descendant.group_id
  where scope.principal_type='group'
),
ranked_legacy_facts as (
  select legacy_candidates.*,
         row_number() over (
           partition by company_id, user_id, resource_type, resource_id
           order by depth asc, subject_rank desc, access_rank desc, source_type asc, source_id asc
         ) as rn
  from legacy_candidates
),
legacy_facts as (
  select company_id, user_id, resource_type, resource_id, access_level, source_type, source_id, access_rank
  from ranked_legacy_facts
  where rn=1
    and access_rank > 0
),
company_admin_users as (
  select user_id, source_id
  from (
    select membership.user_id,
           'membership:' || membership.company_id::text || ':' || membership.user_id::text as source_id,
           row_number() over (
             partition by membership.user_id
             order by case when membership.company_id=$1::uuid then 0 else 1 end, membership.company_id::text
           ) as rn
    from company_memberships membership
    where membership.role='dev_admin'
       or (membership.company_id=$1::uuid and membership.role='company_admin')
  ) ranked
  where rn=1
),
company_admin_facts as (
  select $1::uuid as company_id,
         admin_user.user_id,
         resource.resource_type,
         resource.resource_id,
         'admin'::text as access_level,
         'company_admin'::text as source_type,
         admin_user.source_id,
         3 as access_rank
  from company_admin_users admin_user
  cross join resources resource
),
node_assignee_facts as (
  select node.company_id,
         node.assignee_user_id as user_id,
         'node'::text as resource_type,
         node.node_id as resource_id,
         'edit'::text as access_level,
         'node_assignee'::text as source_type,
         'node:' || node.node_id::text || ':assignee:' || node.assignee_user_id::text as source_id,
         2 as access_rank
  from nodes node
  join company_memberships membership
    on membership.company_id=node.company_id
   and membership.user_id=node.assignee_user_id
  where node.company_id=$1::uuid
    and node.assignee_user_id is not null
),
logic_gate_raci_facts as (
  select assignment.company_id,
         assignment.user_id,
         'logic_gate'::text as resource_type,
         assignment.logic_gate_id as resource_id,
         'edit'::text as access_level,
         'logic_gate_raci'::text as source_type,
         'logic_gate:' || assignment.logic_gate_id::text || ':role:' || assignment.role || ':user:' || assignment.user_id::text as source_id,
         2 as access_rank
  from logic_gate_raci_assignments assignment
  where assignment.company_id=$1::uuid
),
shared_raci_user_facts as (
  select assignment.company_id,
         assignment.user_id,
         'shared_triage_folder'::text as resource_type,
         shared.target_folder_id as resource_id,
         'edit'::text as access_level,
         'shared_triage_raci'::text as source_type,
         'folder:' || assignment.folder_id::text || ':role:' || assignment.role || ':user:' || assignment.user_id::text as source_id,
         2 as access_rank
  from communications_shared_inbox_raci_assignments assignment
  join shared_descendants shared
    on shared.company_id=assignment.company_id
   and shared.source_folder_id=assignment.folder_id
  where assignment.company_id=$1::uuid
),
shared_raci_group_facts as (
  select assignment.company_id,
         member.user_id,
         'shared_triage_folder'::text as resource_type,
         shared.target_folder_id as resource_id,
         'edit'::text as access_level,
         'shared_triage_raci'::text as source_type,
         'folder:' || assignment.folder_id::text || ':role:' || assignment.role || ':group:' || assignment.group_id::text as source_id,
         2 as access_rank
  from communications_shared_inbox_raci_group_assignments assignment
  join shared_descendants shared
    on shared.company_id=assignment.company_id
   and shared.source_folder_id=assignment.folder_id
  join group_descendants descendant
    on descendant.company_id=assignment.company_id
   and descendant.root_group_id=assignment.group_id
  join company_user_group_members member
    on member.company_id=assignment.company_id
   and member.group_id=descendant.group_id
  where assignment.company_id=$1::uuid
),
base_facts as (
  select * from legacy_facts
  union all
  select * from company_admin_facts
  union all
  select * from node_assignee_facts
  union all
  select * from logic_gate_raci_facts
  union all
  select * from shared_raci_user_facts
  union all
  select * from shared_raci_group_facts
),
logic_gate_assignment_visibility_facts as (
  select base.company_id,
         base.user_id,
         'node'::text as resource_type,
         assignment.node_id as resource_id,
         'view'::text as access_level,
         'logic_gate_assignment_visibility'::text as source_type,
         base.source_type || ':' || base.source_id || ':logic_gate:' || assignment.logic_gate_id::text || ':node:' || assignment.node_id::text as source_id,
         1 as access_rank
  from base_facts base
  join node_logic_gate_assignments assignment
    on assignment.company_id=base.company_id
   and assignment.logic_gate_id=base.resource_id
  where base.resource_type='logic_gate'
    and base.access_rank >= 1
),
all_facts as (
  select * from base_facts
  union all
  select * from logic_gate_assignment_visibility_facts
),
ranked_all_facts as (
  select all_facts.*,
         row_number() over (
           partition by company_id, user_id, resource_type, resource_id, source_type, source_id
           order by access_rank desc
         ) as rn
  from all_facts
  where access_rank > 0
    and access_level in ('view', 'edit', 'admin')
)
insert into effective_resource_access (
  company_id,
  user_id,
  resource_type,
  resource_id,
  access_level,
  source_type,
  source_id,
  created_timestamp,
  updated_timestamp
)
select company_id,
       user_id,
       resource_type,
       resource_id,
       access_level,
       source_type,
       source_id,
       now(),
       now()
from ranked_all_facts
where rn=1
on conflict (company_id, user_id, resource_type, resource_id, source_type, source_id)
do update set
  access_level=case
    when mangorts_access_level_rank(effective_resource_access.access_level) >= mangorts_access_level_rank(excluded.access_level)
      then effective_resource_access.access_level
    else excluded.access_level
  end,
  updated_timestamp=now()`, companyID); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}
	return nil
}

func (r *PostgresRepo) UserHasEffectiveAccess(companyID, userID, resourceType, resourceID, accessLevel string) (bool, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || userID == "" || resourceID == "" || !typeOK || !accessOK || EntityPermissionRank(accessLevel) == 0 {
		return false, ErrInvalid
	}

	var allowed bool
	err := r.db.QueryRowContext(context.Background(), `
select exists(
  select 1
  from effective_resource_access access
  where access.company_id=$1::uuid
    and access.user_id=$2::uuid
    and access.resource_type=$3
    and access.resource_id=$4::uuid
    and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($5)
)`, companyID, userID, resourceType, resourceID, accessLevel).Scan(&allowed)
	return allowed, err
}

func (r *PostgresRepo) ListEffectiveResourceIDsForUser(companyID, userID, resourceType, accessLevel string, resourceIDs []string) (map[string]bool, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || userID == "" || !typeOK || !accessOK || EntityPermissionRank(accessLevel) == 0 {
		return nil, ErrInvalid
	}

	cleanIDs := make([]string, 0, len(resourceIDs))
	seen := map[string]bool{}
	for _, rawID := range resourceIDs {
		resourceID := cleanUUIDText(rawID)
		if resourceID == "" || seen[resourceID] {
			continue
		}
		seen[resourceID] = true
		cleanIDs = append(cleanIDs, resourceID)
	}
	if len(cleanIDs) == 0 {
		return map[string]bool{}, nil
	}

	rows, err := r.db.QueryContext(context.Background(), `
with input as (
  select distinct raw.resource_id::uuid as resource_id
  from unnest($5::text[]) as raw(resource_id)
)
select distinct access.resource_id::text
from effective_resource_access access
join input
  on input.resource_id=access.resource_id
where access.company_id=$1::uuid
  and access.user_id=$2::uuid
  and access.resource_type=$3
  and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($4)
order by access.resource_id::text`, companyID, userID, resourceType, accessLevel, cleanIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]bool{}
	for rows.Next() {
		var resourceID string
		if err := rows.Scan(&resourceID); err != nil {
			return nil, err
		}
		out[resourceID] = true
	}
	return out, rows.Err()
}

func (r *PostgresRepo) ListEffectiveUsersForResource(companyID, resourceType, resourceID, accessLevel string) ([]string, error) {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || resourceID == "" || !typeOK || !accessOK || EntityPermissionRank(accessLevel) == 0 {
		return nil, ErrInvalid
	}

	rows, err := r.db.QueryContext(context.Background(), `
select distinct access.user_id::text
from effective_resource_access access
where access.company_id=$1::uuid
  and access.resource_type=$2
  and access.resource_id=$3::uuid
  and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($4)
order by access.user_id::text`, companyID, resourceType, resourceID, accessLevel)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []string{}
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		out = append(out, userID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Strings(out)
	return out, nil
}
