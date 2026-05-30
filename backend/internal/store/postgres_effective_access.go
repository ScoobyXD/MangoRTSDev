package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

type effectiveAccessExecer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

type effectiveAccessQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func replaceEffectiveFactsForSourceTx(ctx context.Context, tx effectiveAccessExecer, companyID, sourceType, sourceID string, facts []domain.EffectiveResourceAccess) error {
	companyID, sourceType, sourceID, err := normalizePostgresEffectiveAccessSourceScope(companyID, sourceType, sourceID)
	if err != nil {
		return err
	}
	facts, err = normalizePostgresEffectiveAccessFactsForSource(companyID, sourceType, sourceID, facts)
	if err != nil {
		return err
	}
	if err := deleteEffectiveFactsForSourceTx(ctx, tx, companyID, sourceType, sourceID); err != nil {
		return err
	}
	return insertEffectiveFactsTx(ctx, tx, facts)
}

func deleteEffectiveFactsForSourceTx(ctx context.Context, tx effectiveAccessExecer, companyID, sourceType, sourceID string) error {
	companyID, sourceType, sourceID, err := normalizePostgresEffectiveAccessSourceScope(companyID, sourceType, sourceID)
	if err != nil {
		return err
	}
	if ctx == nil || tx == nil {
		return ErrInvalid
	}
	_, err = tx.ExecContext(ctx, `
delete from effective_resource_access
where company_id=$1::uuid
  and source_type=$2
  and source_id=$3`, companyID, sourceType, sourceID)
	return err
}

func replaceEffectiveFactsForResourceSourceTx(ctx context.Context, tx effectiveAccessExecer, companyID, resourceType, resourceID, sourceType string, facts []domain.EffectiveResourceAccess) error {
	var err error
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	sourceType = strings.TrimSpace(sourceType)
	if companyID == "" || resourceID == "" || !typeOK || sourceType == "" {
		return ErrInvalid
	}
	facts, err = normalizePostgresEffectiveAccessFactsForResourceSource(companyID, resourceType, resourceID, sourceType, facts)
	if err != nil {
		return err
	}
	if err := deleteEffectiveFactsForResourceSourceTx(ctx, tx, companyID, resourceType, resourceID, sourceType); err != nil {
		return err
	}
	return insertEffectiveFactsTx(ctx, tx, facts)
}

func deleteEffectiveFactsForResourceSourceTx(ctx context.Context, tx effectiveAccessExecer, companyID, resourceType, resourceID, sourceType string) error {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	sourceType = strings.TrimSpace(sourceType)
	if companyID == "" || resourceID == "" || !typeOK || sourceType == "" || ctx == nil || tx == nil {
		return ErrInvalid
	}
	_, err := tx.ExecContext(ctx, `
delete from effective_resource_access
where company_id=$1::uuid
  and resource_type=$2
  and resource_id=$3::uuid
	  and source_type=$4`, companyID, resourceType, resourceID, sourceType)
	return err
}

func deleteEffectiveFactsForResourceTx(ctx context.Context, tx effectiveAccessExecer, companyID, resourceType, resourceID string) error {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	if companyID == "" || resourceID == "" || !typeOK || ctx == nil || tx == nil {
		return ErrInvalid
	}
	_, err := tx.ExecContext(ctx, `
delete from effective_resource_access
where company_id=$1::uuid
  and resource_type=$2
  and resource_id=$3::uuid`, companyID, resourceType, resourceID)
	return err
}

func deleteEffectiveFactsForCompanyUserTx(ctx context.Context, tx effectiveAccessExecer, companyID, userID string) error {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" || ctx == nil || tx == nil {
		return ErrInvalid
	}
	_, err := tx.ExecContext(ctx, `
delete from effective_resource_access
where company_id=$1::uuid
  and user_id=$2::uuid`, companyID, userID)
	return err
}

func insertEffectiveFactsTx(ctx context.Context, tx effectiveAccessExecer, facts []domain.EffectiveResourceAccess) error {
	if ctx == nil || tx == nil {
		return ErrInvalid
	}
	var err error
	facts, err = normalizePostgresEffectiveAccessFacts(facts)
	if err != nil {
		return err
	}
	for _, fact := range facts {
		if _, err := tx.ExecContext(ctx, `
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
values ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, now(), now())
on conflict (company_id, user_id, resource_type, resource_id)
	do update set
	  access_level=excluded.access_level,
	  source_type=excluded.source_type,
	  source_id=excluded.source_id,
	  updated_timestamp=now()`,
			fact.CompanyID,
			fact.UserID,
			fact.ResourceType,
			fact.ResourceID,
			fact.AccessLevel,
			fact.SourceType,
			fact.SourceID,
		); err != nil {
			return err
		}
	}
	return nil
}

func normalizePostgresEffectiveAccessSourceScope(companyID, sourceType, sourceID string) (string, string, string, error) {
	companyID = cleanUUIDText(companyID)
	sourceType = strings.TrimSpace(sourceType)
	sourceID = strings.TrimSpace(sourceID)
	if companyID == "" || sourceType == "" || sourceID == "" {
		return "", "", "", ErrInvalid
	}
	return companyID, sourceType, sourceID, nil
}

func normalizePostgresEffectiveAccessFact(fact domain.EffectiveResourceAccess) (domain.EffectiveResourceAccess, error) {
	fact, err := normalizeEffectiveAccessFact(fact)
	if err != nil {
		return domain.EffectiveResourceAccess{}, err
	}
	fact.CompanyID = cleanUUIDText(fact.CompanyID)
	fact.UserID = cleanUUIDText(fact.UserID)
	fact.ResourceID = cleanUUIDText(fact.ResourceID)
	if fact.CompanyID == "" || fact.UserID == "" || fact.ResourceID == "" {
		return domain.EffectiveResourceAccess{}, ErrInvalid
	}
	return fact, nil
}

func normalizePostgresEffectiveAccessFacts(facts []domain.EffectiveResourceAccess) ([]domain.EffectiveResourceAccess, error) {
	normalized := make([]domain.EffectiveResourceAccess, 0, len(facts))
	for _, fact := range facts {
		normalizedFact, err := normalizePostgresEffectiveAccessFact(fact)
		if err != nil {
			return nil, err
		}
		normalized = append(normalized, normalizedFact)
	}
	return normalized, nil
}

func normalizePostgresEffectiveAccessFactsForSource(companyID, sourceType, sourceID string, facts []domain.EffectiveResourceAccess) ([]domain.EffectiveResourceAccess, error) {
	normalized, err := normalizePostgresEffectiveAccessFacts(facts)
	if err != nil {
		return nil, err
	}
	for _, fact := range normalized {
		if fact.CompanyID != companyID || fact.SourceType != sourceType || fact.SourceID != sourceID {
			return nil, ErrInvalid
		}
	}
	return normalized, nil
}

func normalizePostgresEffectiveAccessFactsForResourceSource(companyID, resourceType, resourceID, sourceType string, facts []domain.EffectiveResourceAccess) ([]domain.EffectiveResourceAccess, error) {
	normalized, err := normalizePostgresEffectiveAccessFacts(facts)
	if err != nil {
		return nil, err
	}
	for _, fact := range normalized {
		if fact.CompanyID != companyID || fact.ResourceType != resourceType || fact.ResourceID != resourceID || fact.SourceType != sourceType {
			return nil, ErrInvalid
		}
	}
	return normalized, nil
}

func recomputeDirectGrantEffectiveAccessForResourceTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) error {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	if ctx == nil || tx == nil || companyID == "" || resourceID == "" || !typeOK {
		return ErrInvalid
	}
	return nil
}

func queryDirectGrantEffectiveAccessFactsForResourceTx(ctx context.Context, tx effectiveAccessQueryer, companyID, resourceType, resourceID string) ([]domain.EffectiveResourceAccess, error) {
	rows, err := tx.QueryContext(ctx, `
with recursive normalized_resource(resource_type) as (
  select $2::text
),
resource_scope(resource_id, depth, path) as (
  select $3::uuid, 0, array[$3::uuid]
  union all
  select folder.parent_folder_id,
         resource_scope.depth + 1,
         resource_scope.path || folder.parent_folder_id
  from resource_scope
  join company_explorer_folders folder
    on folder.company_id=$1::uuid
   and folder.folder_kind='communications'
   and folder.folder_id=resource_scope.resource_id
  join normalized_resource normalized
    on normalized.resource_type='shared_triage_folder'
  where folder.parent_folder_id is not null
    and not folder.parent_folder_id = any(resource_scope.path)
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
legacy_candidates as (
  select grant_row.company_id,
         grant_row.principal_id as user_id,
         grant_row.resource_type,
         $3::uuid as resource_id,
         lower(btrim(grant_row.access_level)) as access_level,
         'direct_user_grant'::text as source_type,
         grant_row.resource_type || ':' || grant_row.resource_id::text || ':user:' || grant_row.principal_id::text as source_id,
         resource_scope.depth,
         2 as subject_rank,
         mangorts_access_level_rank(grant_row.access_level) as access_rank
  from resource_access_grants grant_row
  join resource_scope
    on resource_scope.resource_id=grant_row.resource_id
  join normalized_resource normalized
    on normalized.resource_type=grant_row.resource_type
  join company_memberships membership
    on membership.company_id=grant_row.company_id
   and membership.user_id=grant_row.principal_id
  where grant_row.company_id=$1::uuid
    and grant_row.principal_type='user'
  union all
  select grant_row.company_id,
         member.user_id,
         grant_row.resource_type,
         $3::uuid,
         lower(btrim(grant_row.access_level)),
         'direct_group_grant'::text,
         grant_row.resource_type || ':' || grant_row.resource_id::text || ':group:' || grant_row.principal_id::text,
         resource_scope.depth,
         3,
         mangorts_access_level_rank(grant_row.access_level)
  from resource_access_grants grant_row
  join resource_scope
    on resource_scope.resource_id=grant_row.resource_id
  join normalized_resource normalized
    on normalized.resource_type=grant_row.resource_type
  join group_descendants descendant
    on descendant.company_id=grant_row.company_id
   and descendant.root_group_id=grant_row.principal_id
  join company_user_group_members member
    on member.company_id=grant_row.company_id
   and member.group_id=descendant.group_id
  where grant_row.company_id=$1::uuid
    and grant_row.principal_type='group'
),
ranked_legacy_facts as (
  select legacy_candidates.*,
         row_number() over (
           partition by company_id, user_id, resource_type, resource_id
           order by depth asc, subject_rank desc, access_rank desc, source_type asc, source_id asc
         ) as rn
  from legacy_candidates
)
select company_id::text,
       user_id::text,
       resource_type,
       resource_id::text,
       access_level,
       source_type,
       source_id
from ranked_legacy_facts
where rn=1
order by user_id::text asc, source_type asc, source_id asc`, companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEffectiveResourceAccessRows(rows)
}

func recomputeCompanyAdminEffectiveAccessForUserTx(ctx context.Context, tx *sql.Tx, userID string) error {
	userID = cleanUUIDText(userID)
	if ctx == nil || tx == nil || userID == "" {
		return ErrInvalid
	}
	return nil
}

func queryCompanyAdminEffectiveAccessFactsForUserTx(ctx context.Context, tx effectiveAccessQueryer, userID string) ([]domain.EffectiveResourceAccess, error) {
	rows, err := tx.QueryContext(ctx, `
with resources as (
  select company_id, 'node'::text as resource_type, node_id as resource_id
  from nodes
  union all
  select company_id, 'logic_gate'::text, logic_gate_id
  from logic_gates
  union all
  select company_id, 'shared_triage_folder'::text, folder_id
  from company_explorer_folders
  where folder_kind='communications'
),
admin_source_candidates as (
  select resources.company_id as target_company_id,
         membership.user_id,
         'membership:' || membership.company_id::text || ':' || membership.user_id::text as source_id,
         row_number() over (
           partition by resources.company_id, membership.user_id
           order by case when membership.company_id=resources.company_id then 0 else 1 end, membership.company_id::text
         ) as rn
  from resources
  join company_memberships membership
    on membership.user_id=$1::uuid
   and (
     membership.role='dev_admin'
     or (membership.company_id=resources.company_id and membership.role='company_admin')
   )
  group by resources.company_id, membership.company_id, membership.user_id
),
admin_sources as (
  select target_company_id, user_id, source_id
  from admin_source_candidates
  where rn=1
)
select resources.company_id::text,
       admin_sources.user_id::text,
       resources.resource_type,
       resources.resource_id::text,
       'admin'::text as access_level,
       'company_admin'::text as source_type,
       admin_sources.source_id
from admin_sources
join resources
  on resources.company_id=admin_sources.target_company_id
order by resources.company_id::text asc,
         resources.resource_type asc,
         resources.resource_id::text asc`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEffectiveResourceAccessRows(rows)
}

func recomputeCompanyAdminEffectiveAccessForResourceTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) error {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	if ctx == nil || tx == nil || companyID == "" || resourceID == "" || !typeOK {
		return ErrInvalid
	}
	return nil
}

func queryCompanyAdminEffectiveAccessFactsForResourceTx(ctx context.Context, tx effectiveAccessQueryer, companyID, resourceType, resourceID string) ([]domain.EffectiveResourceAccess, error) {
	rows, err := tx.QueryContext(ctx, `
with admin_source_candidates as (
  select membership.user_id,
         'membership:' || membership.company_id::text || ':' || membership.user_id::text as source_id,
         row_number() over (
           partition by membership.user_id
           order by case when membership.company_id=$1::uuid then 0 else 1 end, membership.company_id::text
         ) as rn
  from company_memberships membership
  where membership.role='dev_admin'
     or (membership.company_id=$1::uuid and membership.role='company_admin')
),
admin_sources as (
  select user_id, source_id
  from admin_source_candidates
  where rn=1
)
select $1::text as company_id,
       user_id::text,
       $2::text as resource_type,
       $3::text as resource_id,
       'admin'::text as access_level,
       'company_admin'::text as source_type,
       source_id
from admin_sources
order by user_id::text asc`, companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEffectiveResourceAccessRows(rows)
}

func recomputeCompanyMemberDefaultEffectiveAccessForResourceTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) error {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	if ctx == nil || tx == nil || companyID == "" || resourceID == "" || !typeOK {
		return ErrInvalid
	}
	return nil
}

func queryCompanyMemberDefaultEffectiveAccessFactsForResourceTx(ctx context.Context, tx effectiveAccessQueryer, companyID, resourceType, resourceID string) ([]domain.EffectiveResourceAccess, error) {
	rows, err := tx.QueryContext(ctx, `
with resource_input as (
  select $1::uuid as company_id, $2::text as resource_type, $3::uuid as resource_id
  where $2::text in ('node', 'logic_gate')
),
existing_resource as (
  select resource_input.*
  from resource_input
  join nodes node
    on node.company_id=resource_input.company_id
   and node.node_id=resource_input.resource_id
  where resource_input.resource_type='node'
  union all
  select resource_input.*
  from resource_input
  join logic_gates gate
    on gate.company_id=resource_input.company_id
   and gate.logic_gate_id=resource_input.resource_id
  where resource_input.resource_type='logic_gate'
)
select existing_resource.company_id::text,
       membership.user_id::text,
       existing_resource.resource_type,
       existing_resource.resource_id::text,
       'edit'::text as access_level,
       'company_member_default'::text as source_type,
       'membership:' || membership.company_id::text || ':' || membership.user_id::text as source_id
from existing_resource
join company_memberships membership
  on membership.company_id=existing_resource.company_id
where not exists (
  select 1
  from resource_access_grants grant_row
  where grant_row.company_id=existing_resource.company_id
    and grant_row.resource_type=existing_resource.resource_type
    and grant_row.resource_id=existing_resource.resource_id
)
order by membership.user_id::text asc`, companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEffectiveResourceAccessRows(rows)
}

func recomputeCompanyMemberDefaultEffectiveAccessForUserTx(ctx context.Context, tx *sql.Tx, companyID, userID string) error {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if ctx == nil || tx == nil || companyID == "" || userID == "" {
		return ErrInvalid
	}
	return nil
}

func queryCompanyMemberDefaultEffectiveAccessFactsForUserTx(ctx context.Context, tx effectiveAccessQueryer, companyID, userID string) ([]domain.EffectiveResourceAccess, error) {
	rows, err := tx.QueryContext(ctx, `
with membership as (
  select company_id, user_id
  from company_memberships
  where company_id=$1::uuid
    and user_id=$2::uuid
),
resources as (
  select node.company_id, 'node'::text as resource_type, node.node_id as resource_id
  from nodes node
  where node.company_id=$1::uuid
  union all
  select gate.company_id, 'logic_gate'::text, gate.logic_gate_id
  from logic_gates gate
  where gate.company_id=$1::uuid
)
select resources.company_id::text,
       membership.user_id::text,
       resources.resource_type,
       resources.resource_id::text,
       'edit'::text as access_level,
       'company_member_default'::text as source_type,
       'membership:' || membership.company_id::text || ':' || membership.user_id::text as source_id
from membership
join resources
  on resources.company_id=membership.company_id
where not exists (
  select 1
  from resource_access_grants grant_row
  where grant_row.company_id=resources.company_id
    and grant_row.resource_type=resources.resource_type
    and grant_row.resource_id=resources.resource_id
)
order by resources.resource_type asc,
         resources.resource_id::text asc`, companyID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEffectiveResourceAccessRows(rows)
}

func scanEffectiveResourceAccessRows(rows *sql.Rows) ([]domain.EffectiveResourceAccess, error) {
	facts := []domain.EffectiveResourceAccess{}
	for rows.Next() {
		var fact domain.EffectiveResourceAccess
		if err := rows.Scan(
			&fact.CompanyID,
			&fact.UserID,
			&fact.ResourceType,
			&fact.ResourceID,
			&fact.AccessLevel,
			&fact.SourceType,
			&fact.SourceID,
		); err != nil {
			return nil, err
		}
		facts = append(facts, fact)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return facts, nil
}

func recomputeNodeAssigneeEffectiveAccessTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	if companyID == "" || nodeID == "" || ctx == nil || tx == nil {
		return ErrInvalid
	}
	return nil
}

func recomputeLogicGateRaciEffectiveAccessTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" || ctx == nil || tx == nil {
		return ErrInvalid
	}
	return nil
}

func recomputeSharedTriageRaciEffectiveAccessForResourceTx(ctx context.Context, tx *sql.Tx, companyID, folderID string) error {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	if companyID == "" || folderID == "" || ctx == nil || tx == nil {
		return ErrInvalid
	}
	return nil
}

func recomputeSharedTriageInheritedEffectiveAccessForSubtreeTx(ctx context.Context, tx *sql.Tx, companyID, folderID string) error {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	if companyID == "" || folderID == "" || ctx == nil || tx == nil {
		return ErrInvalid
	}
	if _, err := postgresSharedTriagePermissionTargetIDs(ctx, tx, companyID, folderID); err != nil {
		return err
	}
	return nil
}

func deleteNodeLogicGateAssignmentsAndRecomputeVisibilityTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" || ctx == nil || tx == nil {
		return ErrInvalid
	}
	nodeIDs, err := nodeIDsAssignedToLogicGatesTx(ctx, tx, companyID, []string{logicGateID})
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
delete from node_logic_gate_assignments
where company_id=$1::uuid
  and logic_gate_id=$2::uuid`, companyID, logicGateID); err != nil {
		return err
	}
	return recomputeLogicGateAssignedNodeVisibilityTx(ctx, tx, companyID, nil, nodeIDs)
}

func recomputeLogicGateAssignedNodeVisibilityTx(ctx context.Context, tx *sql.Tx, companyID string, logicGateIDs, nodeIDs []string) error {
	companyID = cleanUUIDText(companyID)
	if companyID == "" || ctx == nil || tx == nil {
		return ErrInvalid
	}
	return nil
}

func recomputeGroupDependentEffectiveAccessForCompanyTx(ctx context.Context, tx *sql.Tx, companyID string) error {
	companyID = cleanUUIDText(companyID)
	if companyID == "" || ctx == nil || tx == nil {
		return ErrInvalid
	}
	return nil
}

func cleanUUIDTextSlice(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = cleanUUIDText(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func nodeIDsAssignedToLogicGatesTx(ctx context.Context, tx *sql.Tx, companyID string, logicGateIDs []string) ([]string, error) {
	companyID = cleanUUIDText(companyID)
	logicGateIDs = cleanUUIDTextSlice(logicGateIDs)
	if companyID == "" || ctx == nil || tx == nil {
		return nil, ErrInvalid
	}
	if len(logicGateIDs) == 0 {
		return nil, nil
	}
	nodeIDs := []string{}
	for _, logicGateID := range logicGateIDs {
		rows, err := tx.QueryContext(ctx, `
select node_id::text
from node_logic_gate_assignments
where company_id=$1::uuid
  and logic_gate_id=$2::uuid`, companyID, logicGateID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var nodeID string
			if err := rows.Scan(&nodeID); err != nil {
				rows.Close()
				return nil, err
			}
			nodeIDs = append(nodeIDs, nodeID)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	return cleanUUIDTextSlice(nodeIDs), nil
}

func rebuildEffectiveResourceAccessForResourceTx(ctx context.Context, tx effectiveAccessExecer, companyID, resourceType, resourceID string) error {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	if ctx == nil || tx == nil || companyID == "" || resourceID == "" || !typeOK {
		return ErrInvalid
	}
	if _, err := tx.ExecContext(ctx, `
delete from effective_resource_access
where company_id=$1::uuid
  and resource_type=$2
  and resource_id=$3::uuid`, companyID, resourceType, resourceID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
with recursive target_resources as (
  select company_id, 'node'::text as resource_type, node_id as resource_id
  from nodes
  where company_id=$1::uuid
    and $2::text='node'
    and node_id=$3::uuid
  union all
  select company_id, 'logic_gate'::text, logic_gate_id
  from logic_gates
  where company_id=$1::uuid
    and $2::text='logic_gate'
    and logic_gate_id=$3::uuid
  union all
  select company_id, 'shared_triage_folder'::text, folder_id
  from company_explorer_folders
  where company_id=$1::uuid
    and $2::text='shared_triage_folder'
    and folder_kind='communications'
    and folder_id=$3::uuid
),
resources as (
  select company_id, resource_type, resource_id
  from target_resources
  union
  select gate.company_id, 'logic_gate'::text, gate.logic_gate_id
  from target_resources target
  join node_logic_gate_assignments assignment
    on assignment.company_id=target.company_id
   and assignment.node_id=target.resource_id
  join logic_gates gate
    on gate.company_id=assignment.company_id
   and gate.logic_gate_id=assignment.logic_gate_id
  where target.resource_type='node'
),
shared_ancestors as (
  select folder.company_id,
         folder.folder_id as source_folder_id,
         folder.folder_id as target_folder_id,
         0 as depth,
         array[folder.folder_id] as path
  from company_explorer_folders folder
  join target_resources target
    on target.company_id=folder.company_id
   and target.resource_type='shared_triage_folder'
   and target.resource_id=folder.folder_id
  where folder.folder_kind='communications'
  union all
  select ancestor.company_id,
         parent.folder_id,
         ancestor.target_folder_id,
         ancestor.depth + 1,
         ancestor.path || parent.folder_id
  from shared_ancestors ancestor
  join company_explorer_folders current_folder
    on current_folder.company_id=ancestor.company_id
   and current_folder.folder_kind='communications'
   and current_folder.folder_id=ancestor.source_folder_id
  join company_explorer_folders parent
    on parent.company_id=current_folder.company_id
   and parent.folder_kind='communications'
   and parent.folder_id=current_folder.parent_folder_id
  where current_folder.parent_folder_id is not null
    and not parent.folder_id = any(ancestor.path)
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
         grant_row.created_timestamp as source_timestamp,
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
         grant_row.created_timestamp,
         shared.depth
  from resource_access_grants grant_row
  join shared_ancestors shared
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
         scope.source_timestamp,
         60 as source_rank,
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
         greatest(scope.source_timestamp, member.updated_timestamp),
         30,
         scope.depth,
         3,
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
           order by depth asc, subject_rank desc, source_timestamp desc, access_rank desc, source_type asc, source_id asc
         ) as rn
  from legacy_candidates
),
legacy_facts as (
  select company_id, user_id, resource_type, resource_id, access_level, source_type, source_id, source_timestamp, source_rank, access_rank
  from ranked_legacy_facts
  where rn=1
),
company_admin_users as (
  select user_id, source_id, source_timestamp
  from (
    select membership.user_id,
           'membership:' || membership.company_id::text || ':' || membership.user_id::text as source_id,
           membership.updated_timestamp as source_timestamp,
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
  select resource.company_id,
         admin_user.user_id,
         resource.resource_type,
         resource.resource_id,
         'admin'::text as access_level,
         'company_admin'::text as source_type,
         admin_user.source_id,
         admin_user.source_timestamp,
         90 as source_rank,
         3 as access_rank
  from company_admin_users admin_user
  cross join resources resource
),
company_member_default_facts as (
  select resource.company_id,
         membership.user_id,
         resource.resource_type,
         resource.resource_id,
         'edit'::text as access_level,
         'company_member_default'::text as source_type,
         'membership:' || membership.company_id::text || ':' || membership.user_id::text as source_id,
         membership.updated_timestamp as source_timestamp,
         10 as source_rank,
         2 as access_rank
  from resources resource
  join company_memberships membership
    on membership.company_id=resource.company_id
  where resource.resource_type in ('node', 'logic_gate')
    and not exists (
      select 1
      from resource_access_grants grant_row
      where grant_row.company_id=resource.company_id
        and grant_row.resource_type=resource.resource_type
        and grant_row.resource_id=resource.resource_id
    )
),
node_assignee_facts as (
  select node.company_id,
         node.assignee_user_id as user_id,
         'node'::text as resource_type,
         node.node_id as resource_id,
         'edit'::text as access_level,
         'node_assignee'::text as source_type,
         'node:' || node.node_id::text || ':assignee:' || node.assignee_user_id::text as source_id,
         now() as source_timestamp,
         65 as source_rank,
         2 as access_rank
  from nodes node
  join resources resource
    on resource.company_id=node.company_id
   and resource.resource_type='node'
   and resource.resource_id=node.node_id
  join company_memberships membership
    on membership.company_id=node.company_id
   and membership.user_id=node.assignee_user_id
  where node.company_id=$1::uuid
    and node.assignee_user_id is not null
),
base_facts as (
  select * from legacy_facts
  union all
  select * from company_member_default_facts
  union all
  select * from company_admin_facts
  union all
  select * from node_assignee_facts
),
logic_gate_assignment_visibility_facts as (
  select base.company_id,
         base.user_id,
         'node'::text as resource_type,
         assignment.node_id as resource_id,
         base.access_level,
         'logic_gate_assignment_visibility'::text as source_type,
         base.source_type || ':' || base.source_id || ':logic_gate:' || assignment.logic_gate_id::text || ':node:' || assignment.node_id::text as source_id,
         greatest(base.source_timestamp, assignment.updated_timestamp) as source_timestamp,
         80 as source_rank,
         base.access_rank
  from base_facts base
  join node_logic_gate_assignments assignment
    on assignment.company_id=base.company_id
   and assignment.logic_gate_id=base.resource_id
  join target_resources target
    on target.company_id=assignment.company_id
   and target.resource_type='node'
   and target.resource_id=assignment.node_id
  where base.resource_type='logic_gate'
),
all_facts as (
  select * from base_facts
  union all
  select * from logic_gate_assignment_visibility_facts
),
ranked_all_facts as (
  select all_facts.*,
         row_number() over (
           partition by company_id, user_id, resource_type, resource_id
           order by case when source_type='company_admin' then 1 else 0 end desc,
                    source_timestamp desc,
                    source_rank desc,
                    access_rank desc,
                    source_type asc,
                    source_id asc
         ) as rn
  from all_facts
  where access_level in ('no_access', 'view', 'edit', 'admin')
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
select ranked.company_id,
       ranked.user_id,
       ranked.resource_type,
       ranked.resource_id,
       ranked.access_level,
       ranked.source_type,
       ranked.source_id,
       now(),
       now()
from ranked_all_facts ranked
join target_resources target
  on target.company_id=ranked.company_id
 and target.resource_type=ranked.resource_type
 and target.resource_id=ranked.resource_id
where ranked.rn=1
on conflict (company_id, user_id, resource_type, resource_id)
do update set
  access_level=excluded.access_level,
  source_type=excluded.source_type,
  source_id=excluded.source_id,
  updated_timestamp=now()`, companyID, resourceType, resourceID)
	return err
}

func rebuildEffectiveResourceAccessForCompanyTx(ctx context.Context, tx effectiveAccessExecer, companyID string) error {
	companyID = cleanUUIDText(companyID)
	if ctx == nil || tx == nil || companyID == "" {
		return ErrInvalid
	}
	if _, err := tx.ExecContext(ctx, `delete from effective_resource_access where company_id=$1::uuid`, companyID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
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
         grant_row.created_timestamp as source_timestamp,
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
         grant_row.created_timestamp,
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
         scope.source_timestamp,
         60 as source_rank,
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
         greatest(scope.source_timestamp, member.updated_timestamp),
         30,
         scope.depth,
         3,
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
           order by depth asc, subject_rank desc, source_timestamp desc, access_rank desc, source_type asc, source_id asc
         ) as rn
  from legacy_candidates
),
legacy_facts as (
  select company_id, user_id, resource_type, resource_id, access_level, source_type, source_id, source_timestamp, source_rank, access_rank
  from ranked_legacy_facts
  where rn=1
),
company_admin_users as (
  select user_id, source_id, source_timestamp
  from (
    select membership.user_id,
           'membership:' || membership.company_id::text || ':' || membership.user_id::text as source_id,
           membership.updated_timestamp as source_timestamp,
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
         admin_user.source_timestamp,
         90 as source_rank,
         3 as access_rank
  from company_admin_users admin_user
  cross join resources resource
),
company_member_default_facts as (
  select resource.company_id,
         membership.user_id,
         resource.resource_type,
         resource.resource_id,
         'edit'::text as access_level,
         'company_member_default'::text as source_type,
         'membership:' || membership.company_id::text || ':' || membership.user_id::text as source_id,
         membership.updated_timestamp as source_timestamp,
         10 as source_rank,
         2 as access_rank
  from resources resource
  join company_memberships membership
    on membership.company_id=resource.company_id
  where resource.resource_type in ('node', 'logic_gate')
    and not exists (
      select 1
      from resource_access_grants grant_row
      where grant_row.company_id=resource.company_id
        and grant_row.resource_type=resource.resource_type
        and grant_row.resource_id=resource.resource_id
    )
),
node_assignee_facts as (
  select node.company_id,
         node.assignee_user_id as user_id,
         'node'::text as resource_type,
         node.node_id as resource_id,
         'edit'::text as access_level,
         'node_assignee'::text as source_type,
         'node:' || node.node_id::text || ':assignee:' || node.assignee_user_id::text as source_id,
         now() as source_timestamp,
         65 as source_rank,
         2 as access_rank
  from nodes node
  join company_memberships membership
    on membership.company_id=node.company_id
   and membership.user_id=node.assignee_user_id
  where node.company_id=$1::uuid
    and node.assignee_user_id is not null
),
base_facts as (
  select * from legacy_facts
  union all
  select * from company_member_default_facts
  union all
  select * from company_admin_facts
  union all
  select * from node_assignee_facts
),
logic_gate_assignment_visibility_facts as (
  select base.company_id,
         base.user_id,
         'node'::text as resource_type,
         assignment.node_id as resource_id,
         base.access_level,
         'logic_gate_assignment_visibility'::text as source_type,
         base.source_type || ':' || base.source_id || ':logic_gate:' || assignment.logic_gate_id::text || ':node:' || assignment.node_id::text as source_id,
         greatest(base.source_timestamp, assignment.updated_timestamp) as source_timestamp,
         80 as source_rank,
         base.access_rank
  from base_facts base
  join node_logic_gate_assignments assignment
    on assignment.company_id=base.company_id
   and assignment.logic_gate_id=base.resource_id
  where base.resource_type='logic_gate'
),
all_facts as (
  select * from base_facts
  union all
  select * from logic_gate_assignment_visibility_facts
),
ranked_all_facts as (
  select all_facts.*,
         row_number() over (
           partition by company_id, user_id, resource_type, resource_id
           order by case when source_type='company_admin' then 1 else 0 end desc,
                    source_timestamp desc,
                    source_rank desc,
                    access_rank desc,
                    source_type asc,
                    source_id asc
         ) as rn
  from all_facts
  where access_level in ('no_access', 'view', 'edit', 'admin')
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
on conflict (company_id, user_id, resource_type, resource_id)
do update set
  access_level=excluded.access_level,
  source_type=excluded.source_type,
  source_id=excluded.source_id,
  updated_timestamp=now()`, companyID)
	return err
}

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
	return tx.Commit()

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
         grant_row.created_timestamp as source_timestamp,
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
         grant_row.created_timestamp,
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
         scope.source_timestamp,
         60 as source_rank,
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
         greatest(scope.source_timestamp, member.updated_timestamp),
         30,
         scope.depth,
         3,
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
           order by depth asc, subject_rank desc, source_timestamp desc, access_rank desc, source_type asc, source_id asc
         ) as rn
  from legacy_candidates
),
legacy_facts as (
  select company_id, user_id, resource_type, resource_id, access_level, source_type, source_id, source_timestamp, source_rank, access_rank
  from ranked_legacy_facts
  where rn=1
),
company_admin_users as (
  select user_id, source_id, source_timestamp
  from (
    select membership.user_id,
           'membership:' || membership.company_id::text || ':' || membership.user_id::text as source_id,
           membership.updated_timestamp as source_timestamp,
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
         admin_user.source_timestamp,
         90 as source_rank,
         3 as access_rank
  from company_admin_users admin_user
  cross join resources resource
),
company_member_default_facts as (
  select resource.company_id,
         membership.user_id,
         resource.resource_type,
         resource.resource_id,
         'edit'::text as access_level,
         'company_member_default'::text as source_type,
         'membership:' || membership.company_id::text || ':' || membership.user_id::text as source_id,
         membership.updated_timestamp as source_timestamp,
         10 as source_rank,
         2 as access_rank
  from resources resource
  join company_memberships membership
    on membership.company_id=resource.company_id
  where resource.resource_type in ('node', 'logic_gate')
    and not exists (
      select 1
      from resource_access_grants grant_row
      where grant_row.company_id=resource.company_id
        and grant_row.resource_type=resource.resource_type
        and grant_row.resource_id=resource.resource_id
    )
),
node_assignee_facts as (
  select node.company_id,
         node.assignee_user_id as user_id,
         'node'::text as resource_type,
         node.node_id as resource_id,
         'edit'::text as access_level,
         'node_assignee'::text as source_type,
         'node:' || node.node_id::text || ':assignee:' || node.assignee_user_id::text as source_id,
         now() as source_timestamp,
         65 as source_rank,
         2 as access_rank
  from nodes node
  join company_memberships membership
    on membership.company_id=node.company_id
   and membership.user_id=node.assignee_user_id
  where node.company_id=$1::uuid
    and node.assignee_user_id is not null
),
base_facts as (
  select * from legacy_facts
  union all
  select * from company_member_default_facts
  union all
  select * from company_admin_facts
  union all
  select * from node_assignee_facts
),
logic_gate_assignment_visibility_facts as (
  select base.company_id,
         base.user_id,
         'node'::text as resource_type,
         assignment.node_id as resource_id,
         base.access_level,
         'logic_gate_assignment_visibility'::text as source_type,
         base.source_type || ':' || base.source_id || ':logic_gate:' || assignment.logic_gate_id::text || ':node:' || assignment.node_id::text as source_id,
         greatest(base.source_timestamp, assignment.updated_timestamp) as source_timestamp,
         80 as source_rank,
         base.access_rank
  from base_facts base
  join node_logic_gate_assignments assignment
    on assignment.company_id=base.company_id
   and assignment.logic_gate_id=base.resource_id
  where base.resource_type='logic_gate'
),
all_facts as (
  select * from base_facts
  union all
  select * from logic_gate_assignment_visibility_facts
),
ranked_all_facts as (
  select all_facts.*,
         row_number() over (
           partition by company_id, user_id, resource_type, resource_id
           order by case when source_type='company_admin' then 1 else 0 end desc,
                    source_timestamp desc,
                    source_rank desc,
                    access_rank desc,
                    source_type asc,
                    source_id asc
         ) as rn
  from all_facts
  where access_level in ('no_access', 'view', 'edit', 'admin')
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
on conflict (company_id, user_id, resource_type, resource_id)
do update set
  access_level=excluded.access_level,
  source_type=excluded.source_type,
  source_id=excluded.source_id,
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
	if usesDefaultResourceAccessPolicy(resourceType) {
		err := r.db.QueryRowContext(context.Background(), `
select mangorts_user_can_access_resource($1::uuid, $2::text, $3::uuid, $4::uuid, $5::text)`,
			companyID, resourceType, resourceID, userID, accessLevel).Scan(&allowed)
		return allowed, err
	}
	err := r.db.QueryRowContext(context.Background(), `
select mangorts_user_can_access_resource($1::uuid, $2::text, $3::uuid, $4::uuid, $5::text)`,
		companyID, resourceType, resourceID, userID, accessLevel).Scan(&allowed)
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

	if usesDefaultResourceAccessPolicy(resourceType) {
		rows, err := r.db.QueryContext(context.Background(), `
with input as (
  select distinct raw.resource_id::uuid as resource_id
  from unnest($5::text[]) as raw(resource_id)
),
existing as (
  select input.resource_id
  from input
  join nodes node
    on node.company_id=$1::uuid
   and node.node_id=input.resource_id
  where $3::text='node'
  union all
  select input.resource_id
  from input
  join logic_gates gate
    on gate.company_id=$1::uuid
   and gate.logic_gate_id=input.resource_id
  where $3::text='logic_gate'
)
select existing.resource_id::text
from existing
where mangorts_user_can_access_resource($1::uuid, $3::text, existing.resource_id, $2::uuid, $4::text)
order by existing.resource_id::text`, companyID, userID, resourceType, accessLevel, cleanIDs)
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

func (r *PostgresRepo) effectiveAccessLevelsForUser(ctx context.Context, companyID, userID, resourceType string, resourceIDs []string) (map[string]string, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	if companyID == "" || userID == "" || !typeOK {
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
		return map[string]string{}, nil
	}
	if usesDefaultResourceAccessPolicy(resourceType) {
		rows, err := r.db.QueryContext(ctx, `
with input as (
  select distinct raw.resource_id::uuid as resource_id
  from unnest($4::text[]) as raw(resource_id)
),
existing as (
  select input.resource_id
  from input
  join nodes node
    on node.company_id=$1::uuid
   and node.node_id=input.resource_id
  where $3::text='node'
  union all
  select input.resource_id
  from input
  join logic_gates gate
    on gate.company_id=$1::uuid
   and gate.logic_gate_id=input.resource_id
  where $3::text='logic_gate'
),
admin_actor as (
  select exists (
    select 1
    from company_memberships membership
    where membership.user_id=$2::uuid
      and (
        membership.role='dev_admin'
        or (membership.company_id=$1::uuid and membership.role='company_admin')
      )
  ) as allowed
)
select existing.resource_id::text,
       case
         when (select allowed from admin_actor) then 'admin'
         when mangorts_user_can_access_resource($1::uuid, $3::text, existing.resource_id, $2::uuid, 'view') then 'edit'
         else 'no_access'
       end as access_level
from existing
order by existing.resource_id::text`, companyID, userID, resourceType, cleanIDs)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := map[string]string{}
		for rows.Next() {
			var resourceID string
			var accessLevel string
			if err := rows.Scan(&resourceID, &accessLevel); err != nil {
				return nil, err
			}
			out[resourceID] = accessLevel
		}
		return out, rows.Err()
	}
	rows, err := r.db.QueryContext(ctx, `
with input as (
  select distinct raw.resource_id::uuid as resource_id
  from unnest($4::text[]) as raw(resource_id)
),
ranked_access as (
  select access.resource_id::text as resource_id,
         access.access_level,
         row_number() over (
           partition by access.resource_id
           order by mangorts_access_level_rank(access.access_level) desc,
                    access.source_type asc,
                    access.source_id asc
         ) as rn
  from effective_resource_access access
  join input
    on input.resource_id=access.resource_id
  where access.company_id=$1::uuid
    and access.user_id=$2::uuid
    and access.resource_type=$3
)
select resource_id, access_level
from ranked_access
where rn=1`, companyID, userID, resourceType, cleanIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var resourceID string
		var accessLevel string
		if err := rows.Scan(&resourceID, &accessLevel); err != nil {
			return nil, err
		}
		out[resourceID] = accessLevel
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

	if usesDefaultResourceAccessPolicy(resourceType) {
		rows, err := r.db.QueryContext(context.Background(), `
select distinct membership.user_id::text
from company_memberships membership
where (
    membership.company_id=$1::uuid
    or membership.role='dev_admin'
  )
  and mangorts_user_can_access_resource($1::uuid, $2::text, $3::uuid, membership.user_id, $4::text)
order by membership.user_id::text`, companyID, resourceType, resourceID, accessLevel)
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

func (r *PostgresRepo) ListEffectiveUsersForWorkspaceEvent(event domain.DomainEvent) ([]string, error) {
	targets := WorkspaceEventAccessTargets(event)
	if len(targets) == 0 {
		return []string{}, nil
	}
	seen := map[string]bool{}
	for _, target := range targets {
		userIDs, err := r.ListEffectiveUsersForResource(event.CompanyID, target.ResourceType, target.ResourceID, EntityPermissionView)
		if errors.Is(err, ErrInvalid) || errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, userID := range userIDs {
			seen[userID] = true
		}
	}
	return sortWorkspaceEventUserIDs(seen), nil
}
