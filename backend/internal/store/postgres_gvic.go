package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
)

func (r *PostgresRepo) ListResourceGVICAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceGVICAssignment, error) {
	keyValue, err := normalizeResourceGVICKey(companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	if exists, err := postgresGVICResourceExists(ctx, r.db, keyValue); err != nil {
		return nil, err
	} else if !exists {
		return nil, ErrNotFound
	}
	return postgresResourceGVICAssignmentsForResource(ctx, r.db, keyValue)
}

func (r *PostgresRepo) SetResourceGVICAssignments(input ResourceGVICAssignmentUpdateInput) (ResourceGVICAssignmentMutationResult, error) {
	command := ResourceGVICAssignmentCommandInput{
		CompanyID:      input.CompanyID,
		ResourceType:   input.ResourceType,
		ResourceID:     input.ResourceID,
		Assignments:    input.Assignments,
		ActorUserID:    input.ActorUserID,
		IdempotencyKey: input.IdempotencyKey,
	}
	return r.applyResourceGVICAssignmentCommand(command, GVICAssignmentCommandSet)
}

func (r *PostgresRepo) AddResourceGVICAssignments(input ResourceGVICAssignmentCommandInput) (ResourceGVICAssignmentMutationResult, error) {
	return r.applyResourceGVICAssignmentCommand(input, GVICAssignmentCommandAdd)
}

func (r *PostgresRepo) RemoveResourceGVICAssignments(input ResourceGVICAssignmentCommandInput) (ResourceGVICAssignmentMutationResult, error) {
	return r.applyResourceGVICAssignmentCommand(input, GVICAssignmentCommandRemove)
}

func (r *PostgresRepo) applyResourceGVICAssignmentCommand(input ResourceGVICAssignmentCommandInput, operation string) (ResourceGVICAssignmentMutationResult, error) {
	keyValue, err := normalizeResourceGVICKey(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	assignments, err := normalizeResourceGVICAssignmentInputs(input.Assignments)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	if err := validateResourceGVICAssignmentInputsForOperation(keyValue, assignments, operation); err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	defer tx.Rollback()

	if exists, err := postgresGVICResourceExists(ctx, tx, keyValue); err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	} else if !exists {
		return ResourceGVICAssignmentMutationResult{}, ErrNotFound
	}
	for _, assignment := range assignments {
		if err := validatePostgresGVICPrincipalTx(ctx, tx, keyValue.companyID, assignment.principalType, assignment.principalID); err != nil {
			return ResourceGVICAssignmentMutationResult{}, err
		}
	}

	changed := false
	switch operation {
	case GVICAssignmentCommandSet:
		deleted, err := tx.ExecContext(ctx, `
delete from resource_gvic_assignments
where company_id=$1::uuid
  and resource_type=$2
  and resource_id=$3::uuid`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
		if err != nil {
			return ResourceGVICAssignmentMutationResult{}, err
		}
		if affected, err := deleted.RowsAffected(); err == nil && affected > 0 {
			changed = true
		} else if err != nil {
			return ResourceGVICAssignmentMutationResult{}, err
		}
		for _, assignment := range assignments {
			inserted, err := tx.ExecContext(ctx, `
insert into resource_gvic_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  principal_type,
  principal_id,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, $2, $3::uuid, $4, $5, $6::uuid, now(), now())
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id)
do update set updated_timestamp=resource_gvic_assignments.updated_timestamp`,
				keyValue.companyID, keyValue.resourceType, keyValue.resourceID, assignment.role, assignment.principalType, assignment.principalID)
			if err != nil {
				return ResourceGVICAssignmentMutationResult{}, err
			}
			if affected, err := inserted.RowsAffected(); err == nil && affected > 0 {
				changed = true
			} else if err != nil {
				return ResourceGVICAssignmentMutationResult{}, err
			}
		}
	case GVICAssignmentCommandAdd:
		for _, assignment := range assignments {
			if keyValue.resourceType == EntityTypeNode || keyValue.resourceType == EntityTypeLogicGate {
				deleted, err := tx.ExecContext(ctx, `
delete from resource_gvic_assignments
where company_id=$1::uuid
  and resource_type=$2
  and resource_id=$3::uuid
  and principal_type=$4
  and principal_id=$5::uuid
  and role<>$6`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID, assignment.principalType, assignment.principalID, assignment.role)
				if err != nil {
					return ResourceGVICAssignmentMutationResult{}, err
				}
				if affected, err := deleted.RowsAffected(); err == nil && affected > 0 {
					changed = true
				} else if err != nil {
					return ResourceGVICAssignmentMutationResult{}, err
				}
			}
			if isSingleUserPrimaryGVICResourceType(keyValue.resourceType) && isSingleUserPrimaryGVICRole(assignment.role) {
				deleted, err := tx.ExecContext(ctx, `
delete from resource_gvic_assignments
where company_id=$1::uuid
  and resource_type=$2
  and resource_id=$3::uuid
  and role=$4
  and not (principal_type=$5 and principal_id=$6::uuid)`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID, assignment.role, assignment.principalType, assignment.principalID)
				if err != nil {
					return ResourceGVICAssignmentMutationResult{}, err
				}
				if affected, err := deleted.RowsAffected(); err == nil && affected > 0 {
					changed = true
				} else if err != nil {
					return ResourceGVICAssignmentMutationResult{}, err
				}
			}
			inserted, err := tx.ExecContext(ctx, `
insert into resource_gvic_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  principal_type,
  principal_id,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, $2, $3::uuid, $4, $5, $6::uuid, now(), now())
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id) do nothing`,
				keyValue.companyID, keyValue.resourceType, keyValue.resourceID, assignment.role, assignment.principalType, assignment.principalID)
			if err != nil {
				return ResourceGVICAssignmentMutationResult{}, err
			}
			if affected, err := inserted.RowsAffected(); err == nil && affected > 0 {
				changed = true
			} else if err != nil {
				return ResourceGVICAssignmentMutationResult{}, err
			}
		}
	case GVICAssignmentCommandRemove:
		for _, assignment := range assignments {
			deleted, err := tx.ExecContext(ctx, `
delete from resource_gvic_assignments
where company_id=$1::uuid
  and resource_type=$2
  and resource_id=$3::uuid
  and role=$4
  and principal_type=$5
  and principal_id=$6::uuid`,
				keyValue.companyID, keyValue.resourceType, keyValue.resourceID, assignment.role, assignment.principalType, assignment.principalID)
			if err != nil {
				return ResourceGVICAssignmentMutationResult{}, err
			}
			if affected, err := deleted.RowsAffected(); err == nil && affected > 0 {
				changed = true
			} else if err != nil {
				return ResourceGVICAssignmentMutationResult{}, err
			}
		}
	default:
		return ResourceGVICAssignmentMutationResult{}, ErrInvalid
	}

	affected := []resourceGVICKey{keyValue}
	if keyValue.resourceType != EntityTypeLogicGate {
		var err error
		affected, err = postgresAffectedGVICResourceKeysTx(ctx, tx, keyValue)
		if err != nil {
			return ResourceGVICAssignmentMutationResult{}, err
		}
	}
	deltas, err := syncResourceGVICEffectiveAssignmentsTx(ctx, tx, keyValue.companyID, affected)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	for _, affectedKey := range affected {
		switch affectedKey.resourceType {
		case EntityTypeNode:
			nodeDeltas, err := syncPostgresGVICMatrixProjectionForNodeDeltasTx(ctx, tx, affectedKey.companyID, affectedKey.resourceID)
			if err != nil {
				return ResourceGVICAssignmentMutationResult{}, err
			}
			deltas = append(deltas, nodeDeltas...)
		case EntityTypeLogicGate:
			logicGateDeltas, err := syncPostgresGVICMatrixProjectionForLogicGateAssignmentsDeltasTx(ctx, tx, affectedKey.companyID, affectedKey.resourceID, nil, nil)
			if err != nil {
				return ResourceGVICAssignmentMutationResult{}, err
			}
			deltas = append(deltas, logicGateDeltas...)
		}
	}
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(keyValue.companyID, input.ActorUserID, input.IdempotencyKey, deltas)); err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	sourceRows, err := postgresResourceGVICAssignmentsForResource(ctx, tx, keyValue)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	effectiveRows, err := postgresResourceGVICEffectiveAssignmentsForResource(ctx, tx, keyValue)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	return ResourceGVICAssignmentMutationResult{
		CompanyID:            keyValue.companyID,
		ResourceType:         keyValue.resourceType,
		ResourceID:           keyValue.resourceID,
		Operation:            operation,
		Changed:              changed || len(deltas) > 0,
		GVICAssignments:      sourceRows,
		EffectiveAssignments: effectiveRows,
		ProjectionDeltas:     deltas,
		Events:               []domain.DomainEvent{},
	}, nil
}

func (r *PostgresRepo) ListResourceGVICEffectiveAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceGVICEffectiveAssignment, error) {
	keyValue, err := normalizeResourceGVICKey(companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	if exists, err := postgresGVICResourceExists(ctx, r.db, keyValue); err != nil {
		return nil, err
	} else if !exists {
		return nil, ErrNotFound
	}
	return postgresResourceGVICEffectiveAssignmentsForResource(ctx, r.db, keyValue)
}

type postgresGVICQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func postgresGVICResourceExists(ctx context.Context, queryer postgresGVICQueryer, keyValue resourceGVICKey) (bool, error) {
	var sqlText string
	switch keyValue.resourceType {
	case EntityTypeNode:
		sqlText = `select exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)`
	case EntityTypeLogicGate:
		sqlText = `select exists(select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid)`
	case EntityTypeProject:
		sqlText = `select exists(select 1 from projects where company_id=$1::uuid and project_id=$2::uuid)`
	case EntityTypeSharedInbox:
		sqlText = `select exists(select 1 from shared_inboxes where company_id=$1::uuid and shared_inbox_id=$2::uuid)`
	case EntityTypeSharedTriageFolder:
		sqlText = `select exists(select 1 from shared_inbox_folders where company_id=$1::uuid and folder_id=$2::uuid)`
	default:
		return false, ErrInvalid
	}
	var exists bool
	err := queryer.QueryRowContext(ctx, sqlText, keyValue.companyID, keyValue.resourceID).Scan(&exists)
	return exists, err
}

func validatePostgresGVICPrincipalTx(ctx context.Context, tx *sql.Tx, companyID, principalType, principalID string) error {
	var sqlText string
	switch principalType {
	case EntityPermissionSubjectUser:
		sqlText = `select exists(select 1 from company_memberships where company_id=$1::uuid and user_id=$2::uuid)`
	case EntityPermissionSubjectGroup:
		sqlText = `select exists(select 1 from company_user_groups where company_id=$1::uuid and group_id=$2::uuid)`
	default:
		return ErrInvalid
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, sqlText, companyID, principalID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrPrincipalNotInCompany
	}
	return nil
}

func postgresResourceGVICAssignmentsForResource(ctx context.Context, queryer postgresGVICQueryer, keyValue resourceGVICKey) ([]domain.ResourceGVICAssignment, error) {
	rows, err := queryer.QueryContext(ctx, `
select
  assignment.company_id::text,
  assignment.resource_type,
  assignment.resource_id::text,
  assignment.role,
  assignment.principal_type,
  assignment.principal_id::text,
  coalesce(nullif(user_group.name, ''), nullif(app_user.display_name, ''), nullif(app_user.email, '')),
  coalesce(app_user.user_id::text, ''),
  nullif(app_user.display_name, ''),
  nullif(app_user.email, ''),
  assignment.created_timestamp,
  assignment.updated_timestamp
from resource_gvic_assignments assignment
left join users app_user
  on assignment.principal_type='user'
 and app_user.user_id=assignment.principal_id
left join company_user_groups user_group
  on assignment.principal_type='group'
 and user_group.company_id=assignment.company_id
 and user_group.group_id=assignment.principal_id
where assignment.company_id=$1::uuid
  and assignment.resource_type=$2
  and assignment.resource_id=$3::uuid
order by
  case assignment.role
    when 'generated' then 1
    when 'verified' then 2
    when 'consulted' then 3
    when 'informed' then 4
    else 5
  end,
  assignment.principal_type,
  lower(coalesce(nullif(user_group.name, ''), nullif(app_user.display_name, ''), nullif(app_user.email, ''), assignment.principal_id::text)),
  assignment.principal_id::text`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.ResourceGVICAssignment, 0)
	for rows.Next() {
		var item domain.ResourceGVICAssignment
		var principalName sql.NullString
		var userID sql.NullString
		var displayName sql.NullString
		var email sql.NullString
		if err := rows.Scan(
			&item.CompanyID,
			&item.ResourceType,
			&item.ResourceID,
			&item.Role,
			&item.PrincipalType,
			&item.PrincipalID,
			&principalName,
			&userID,
			&displayName,
			&email,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		if principalName.Valid {
			item.PrincipalName = principalName.String
		}
		if userID.Valid {
			item.UserID = userID.String
		}
		if displayName.Valid {
			item.UserDisplayName = displayName.String
		}
		if email.Valid {
			item.UserEmail = email.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sortResourceGVICAssignments(items)
	return items, nil
}

func postgresResourceGVICEffectiveAssignmentsForResource(ctx context.Context, queryer postgresGVICQueryer, keyValue resourceGVICKey) ([]domain.ResourceGVICEffectiveAssignment, error) {
	rows, err := queryer.QueryContext(ctx, `
with requested as (
  select $1::uuid as company_id, $2::text as resource_type, $3::uuid as resource_id
),
linked_node as (
  select assignment.logic_gate_id
  from node_logic_gate_assignments assignment
  join requested req
    on req.resource_type='node'
   and assignment.company_id=req.company_id
   and assignment.node_id=req.resource_id
  order by assignment.updated_timestamp desc, assignment.created_timestamp desc, assignment.assignment_id desc
  limit 1
),
effective_source as (
  select
    req.company_id,
    req.resource_type,
    req.resource_id,
    case when req.resource_type='node' and exists(select 1 from linked_node) then 'logic_gate' else req.resource_type end as lookup_resource_type,
    case when req.resource_type='node' and exists(select 1 from linked_node) then (select logic_gate_id from linked_node) else req.resource_id end as lookup_resource_id,
    case when req.resource_type='node' and exists(select 1 from linked_node) then 'logic_gate_inherited'::text else null::text end as pointer_inheritance_type
  from requested req
)
select
  assignment.company_id::text,
  effective_source.resource_type,
  effective_source.resource_id::text,
  assignment.role,
  assignment.user_id::text,
  assignment.source_resource_type,
  assignment.source_resource_id::text,
  assignment.source_principal_type,
  assignment.source_principal_id::text,
  coalesce(effective_source.pointer_inheritance_type, assignment.inheritance_type),
  nullif(app_user.display_name, ''),
  nullif(app_user.email, ''),
  assignment.updated_timestamp
from effective_source
join resource_gvic_effective_assignments assignment
  on assignment.company_id=effective_source.company_id
 and assignment.resource_type=effective_source.lookup_resource_type
 and assignment.resource_id=effective_source.lookup_resource_id
left join users app_user on app_user.user_id=assignment.user_id
order by assignment.user_id::text, assignment.role, assignment.source_resource_type, assignment.source_resource_id::text, assignment.source_principal_type, assignment.source_principal_id::text`,
		keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.ResourceGVICEffectiveAssignment, 0)
	for rows.Next() {
		var item domain.ResourceGVICEffectiveAssignment
		var displayName sql.NullString
		var email sql.NullString
		if err := rows.Scan(
			&item.CompanyID,
			&item.ResourceType,
			&item.ResourceID,
			&item.Role,
			&item.UserID,
			&item.SourceResourceType,
			&item.SourceResourceID,
			&item.SourcePrincipalType,
			&item.SourcePrincipalID,
			&item.InheritanceType,
			&displayName,
			&email,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		if displayName.Valid {
			item.UserDisplayName = displayName.String
		}
		if email.Valid {
			item.UserEmail = email.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sortResourceGVICEffectiveAssignments(items)
	return items, nil
}
func postgresAffectedGVICResourceKeysTx(ctx context.Context, tx *sql.Tx, keyValue resourceGVICKey) ([]resourceGVICKey, error) {
	seen := map[resourceGVICKey]bool{keyValue: true}
	if keyValue.resourceType == EntityTypeLogicGate {
		rows, err := tx.QueryContext(ctx, `
select node_id::text
from node_logic_gate_assignments
where company_id=$1::uuid
  and logic_gate_id=$2::uuid`, keyValue.companyID, keyValue.resourceID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var nodeID string
			if err := rows.Scan(&nodeID); err != nil {
				rows.Close()
				return nil, err
			}
			seen[resourceGVICKey{companyID: keyValue.companyID, resourceType: EntityTypeNode, resourceID: nodeID}] = true
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	keys := make([]resourceGVICKey, 0, len(seen))
	for item := range seen {
		keys = append(keys, item)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].resourceType != keys[j].resourceType {
			return keys[i].resourceType < keys[j].resourceType
		}
		return keys[i].resourceID < keys[j].resourceID
	})
	return keys, nil
}

func syncResourceGVICEffectiveAssignmentsTx(ctx context.Context, tx *sql.Tx, companyID string, keys []resourceGVICKey) ([]ProjectionDelta, error) {
	companyID = cleanUUIDText(companyID)
	if ctx == nil || tx == nil || companyID == "" {
		return nil, ErrInvalid
	}
	deduped := map[resourceGVICKey]bool{}
	for _, keyValue := range keys {
		normalized, err := normalizeResourceGVICKey(keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
		if err != nil {
			return nil, err
		}
		if normalized.companyID != companyID {
			return nil, ErrInvalid
		}
		deduped[normalized] = true
	}
	ordered := make([]resourceGVICKey, 0, len(deduped))
	for keyValue := range deduped {
		ordered = append(ordered, keyValue)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].resourceType != ordered[j].resourceType {
			return ordered[i].resourceType < ordered[j].resourceType
		}
		return ordered[i].resourceID < ordered[j].resourceID
	})

	deltas := make([]ProjectionDelta, 0)
	for _, keyValue := range ordered {
		beforeDomain, err := postgresResourceGVICEffectiveAssignmentsForResource(ctx, tx, keyValue)
		if err != nil {
			return nil, err
		}
		beforeRows := make([]GVICEffectiveAssignmentProjectionRow, 0, len(beforeDomain))
		for _, item := range beforeDomain {
			beforeRows = append(beforeRows, gvicEffectiveProjectionRowFromDomain(item))
		}
		if err := syncDerivedResourceGVICEffectiveAssignmentsDeltaTx(ctx, tx, keyValue); err != nil {
			return nil, err
		}
		afterDomain, err := postgresResourceGVICEffectiveAssignmentsForResource(ctx, tx, keyValue)
		if err != nil {
			return nil, err
		}
		afterRows := make([]GVICEffectiveAssignmentProjectionRow, 0, len(afterDomain))
		for _, item := range afterDomain {
			afterRows = append(afterRows, gvicEffectiveProjectionRowFromDomain(item))
		}
		deltas = append(deltas, diffGVICEffectiveProjectionRows(beforeRows, afterRows)...)
	}
	return deltas, nil
}

func syncPostgresGVICForResourceKeysTx(ctx context.Context, tx *sql.Tx, companyID string, keys []resourceGVICKey) ([]ProjectionDelta, error) {
	companyID = cleanUUIDText(companyID)
	if ctx == nil || tx == nil || companyID == "" {
		return nil, ErrInvalid
	}
	ordered, err := normalizeResourceGVICKeysForCompany(companyID, keys)
	if err != nil {
		return nil, err
	}
	if len(ordered) == 0 {
		return nil, nil
	}
	deltas, err := syncResourceGVICEffectiveAssignmentsTx(ctx, tx, companyID, ordered)
	if err != nil {
		return nil, err
	}
	for _, keyValue := range ordered {
		switch keyValue.resourceType {
		case EntityTypeNode:
			nodeDeltas, err := syncPostgresGVICMatrixProjectionForNodeDeltasTx(ctx, tx, keyValue.companyID, keyValue.resourceID)
			if err != nil {
				return nil, err
			}
			deltas = append(deltas, nodeDeltas...)
		case EntityTypeLogicGate:
			logicGateDeltas, err := syncPostgresGVICMatrixProjectionForLogicGateAssignmentsDeltasTx(ctx, tx, keyValue.companyID, keyValue.resourceID, nil, nil)
			if err != nil {
				return nil, err
			}
			deltas = append(deltas, logicGateDeltas...)
		}
	}
	return deltas, nil
}

func normalizeResourceGVICKeysForCompany(companyID string, keys []resourceGVICKey) ([]resourceGVICKey, error) {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	deduped := map[resourceGVICKey]bool{}
	for _, keyValue := range keys {
		normalized, err := normalizeResourceGVICKey(keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
		if err != nil {
			return nil, err
		}
		if normalized.companyID != companyID {
			return nil, ErrInvalid
		}
		deduped[normalized] = true
	}
	ordered := make([]resourceGVICKey, 0, len(deduped))
	for keyValue := range deduped {
		ordered = append(ordered, keyValue)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].resourceType != ordered[j].resourceType {
			return ordered[i].resourceType < ordered[j].resourceType
		}
		return ordered[i].resourceID < ordered[j].resourceID
	})
	return ordered, nil
}

const postgresDerivedResourceGVICEffectiveAssignmentsCTE = `
with requested as (
  select $1::uuid as company_id, $2::text as resource_type, $3::uuid as resource_id
),
linked_node as (
  select assignment.logic_gate_id
  from node_logic_gate_assignments assignment
  join requested req
    on req.resource_type='node'
   and assignment.company_id=req.company_id
   and assignment.node_id=req.resource_id
  order by assignment.updated_timestamp desc, assignment.created_timestamp desc, assignment.assignment_id desc
  limit 1
),
source_resource as (
  select
    req.company_id,
    req.resource_type,
    req.resource_id,
    req.resource_type as source_resource_type,
    req.resource_id as source_resource_id,
    'direct'::text as inheritance_type
  from requested req
  where not (req.resource_type='node' and exists(select 1 from linked_node))
),
configured as (
  select
    source_resource.company_id,
    source_resource.resource_type,
    source_resource.resource_id,
    source_resource.source_resource_type,
    source_resource.source_resource_id,
    source_resource.inheritance_type,
    assignment.role,
    assignment.principal_type,
    assignment.principal_id
  from source_resource
  join resource_gvic_assignments assignment
    on assignment.company_id=source_resource.company_id
   and assignment.resource_type=source_resource.source_resource_type
   and assignment.resource_id=source_resource.source_resource_id
),
derived as (
  select
    configured.company_id,
    configured.resource_type,
    configured.resource_id,
    configured.role,
    configured.principal_id as user_id,
    configured.source_resource_type,
    configured.source_resource_id,
    configured.principal_type as source_principal_type,
    configured.principal_id as source_principal_id,
    configured.inheritance_type
  from configured
  join company_memberships membership
    on configured.principal_type='user'
   and membership.company_id=configured.company_id
   and membership.user_id=configured.principal_id
  union
  select
    configured.company_id,
    configured.resource_type,
    configured.resource_id,
    configured.role,
    member.user_id,
    configured.source_resource_type,
    configured.source_resource_id,
    configured.principal_type as source_principal_type,
    configured.principal_id as source_principal_id,
    configured.inheritance_type
  from configured
  join company_user_group_closure closure
    on configured.principal_type='group'
   and closure.company_id=configured.company_id
   and closure.ancestor_group_id=configured.principal_id
  join company_user_group_members member
    on member.company_id=closure.company_id
   and member.group_id=closure.descendant_group_id
  join company_memberships membership
    on membership.company_id=member.company_id
   and membership.user_id=member.user_id
)`

func syncDerivedResourceGVICEffectiveAssignmentsDeltaTx(ctx context.Context, tx *sql.Tx, keyValue resourceGVICKey) error {
	if _, err := tx.ExecContext(ctx, postgresDerivedResourceGVICEffectiveAssignmentsCTE+`
delete from resource_gvic_effective_assignments existing
where existing.company_id=$1::uuid
  and existing.resource_type=$2
  and existing.resource_id=$3::uuid
  and not exists (
    select 1
    from derived
    where derived.company_id=existing.company_id
      and derived.resource_type=existing.resource_type
      and derived.resource_id=existing.resource_id
      and derived.role=existing.role
      and derived.user_id=existing.user_id
      and derived.source_resource_type=existing.source_resource_type
      and derived.source_resource_id=existing.source_resource_id
      and derived.source_principal_type=existing.source_principal_type
      and derived.source_principal_id=existing.source_principal_id
      and derived.inheritance_type=existing.inheritance_type
  )`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, postgresDerivedResourceGVICEffectiveAssignmentsCTE+`
insert into resource_gvic_effective_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  user_id,
  source_resource_type,
  source_resource_id,
  source_principal_type,
  source_principal_id,
  inheritance_type,
  updated_timestamp
)
select distinct
  company_id,
  resource_type,
  resource_id,
  role,
  user_id,
  source_resource_type,
  source_resource_id,
  source_principal_type,
  source_principal_id,
  inheritance_type,
  now()
from derived
on conflict (
  company_id,
  resource_type,
  resource_id,
  role,
  user_id,
  source_resource_type,
  source_resource_id,
  source_principal_type,
  source_principal_id,
  inheritance_type
) do nothing`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
	return err
}

func syncCompanyUserGroupClosureTx(ctx context.Context, tx *sql.Tx, companyID string) error {
	companyID = cleanUUIDText(companyID)
	if companyID == "" || ctx == nil || tx == nil {
		return ErrInvalid
	}
	if _, err := tx.ExecContext(ctx, `
delete from company_user_group_closure
where company_id=$1::uuid`, companyID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
with recursive closure as (
  select company_id, group_id as ancestor_group_id, group_id as descendant_group_id, 0 as depth
  from company_user_groups
  where company_id=$1::uuid
  union all
  select closure.company_id, closure.ancestor_group_id, child.group_id, closure.depth + 1
  from closure
  join company_user_groups child
    on child.company_id=closure.company_id
   and child.parent_group_id=closure.descendant_group_id
)
insert into company_user_group_closure (company_id, ancestor_group_id, descendant_group_id, depth)
select company_id, ancestor_group_id, descendant_group_id, min(depth)
from closure
group by company_id, ancestor_group_id, descendant_group_id
on conflict (company_id, ancestor_group_id, descendant_group_id)
do update set depth=excluded.depth`, companyID)
	return err
}

func gvicAncestorGroupIDsForGroupsTx(ctx context.Context, tx *sql.Tx, companyID string, groupIDs []string) ([]string, error) {
	companyID = cleanUUIDText(companyID)
	groupIDs = cleanUUIDTextSlice(groupIDs)
	if ctx == nil || tx == nil || companyID == "" {
		return nil, ErrInvalid
	}
	if len(groupIDs) == 0 {
		return []string{}, nil
	}
	rows, err := tx.QueryContext(ctx, `
with input_groups(group_id) as (
  select distinct unnest($2::text[])::uuid
)
select distinct closure.ancestor_group_id::text
from company_user_group_closure closure
join input_groups input_group
  on closure.descendant_group_id=input_group.group_id
where closure.company_id=$1::uuid
order by closure.ancestor_group_id::text asc`, companyID, groupIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var groupID string
		if err := rows.Scan(&groupID); err != nil {
			return nil, err
		}
		out = append(out, groupID)
	}
	return out, rows.Err()
}

func gvicResourceKeysForGroupPrincipalIDsTx(ctx context.Context, tx *sql.Tx, companyID string, groupIDs []string) ([]resourceGVICKey, error) {
	companyID = cleanUUIDText(companyID)
	groupIDs = cleanUUIDTextSlice(groupIDs)
	if ctx == nil || tx == nil || companyID == "" {
		return nil, ErrInvalid
	}
	if len(groupIDs) == 0 {
		return []resourceGVICKey{}, nil
	}
	rows, err := tx.QueryContext(ctx, `
with input_groups(group_id) as (
  select distinct unnest($2::text[])::uuid
)
select distinct assignment.company_id::text, assignment.resource_type, assignment.resource_id::text
from resource_gvic_assignments assignment
join input_groups input_group
  on assignment.principal_id=input_group.group_id
where assignment.company_id=$1::uuid
  and assignment.principal_type='group'
order by assignment.resource_type asc, assignment.resource_id::text asc`, companyID, groupIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]resourceGVICKey, 0)
	for rows.Next() {
		var keyValue resourceGVICKey
		if err := rows.Scan(&keyValue.companyID, &keyValue.resourceType, &keyValue.resourceID); err != nil {
			return nil, err
		}
		out = append(out, keyValue)
	}
	return out, rows.Err()
}
func gvicResourceKeysForAffectedGroupsTx(ctx context.Context, tx *sql.Tx, companyID string, groupIDs []string) ([]resourceGVICKey, error) {
	affectedGroupIDs, err := gvicAncestorGroupIDsForGroupsTx(ctx, tx, companyID, groupIDs)
	if err != nil {
		return nil, err
	}
	return gvicResourceKeysForGroupPrincipalIDsTx(ctx, tx, companyID, affectedGroupIDs)
}

// gvicResourceKeysForAllGroupAssignmentsTx is a broad repair/backfill helper. Normal
// group membership and hierarchy writes should use targeted group-principal helpers instead.
func gvicResourceKeysForAllGroupAssignmentsTx(ctx context.Context, tx *sql.Tx, companyID string) ([]resourceGVICKey, error) {
	rows, err := tx.QueryContext(ctx, `
select distinct company_id::text, resource_type, resource_id::text
from resource_gvic_assignments
where company_id=$1::uuid
  and principal_type='group'`, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	seen := map[resourceGVICKey]bool{}
	for rows.Next() {
		var keyValue resourceGVICKey
		if err := rows.Scan(&keyValue.companyID, &keyValue.resourceType, &keyValue.resourceID); err != nil {
			return nil, err
		}
		seen[keyValue] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]resourceGVICKey, 0, len(seen))
	for item := range seen {
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].resourceType != out[j].resourceType {
			return out[i].resourceType < out[j].resourceType
		}
		return out[i].resourceID < out[j].resourceID
	})
	return out, nil
}
func syncPostgresGVICForAffectedGroupsTx(ctx context.Context, tx *sql.Tx, companyID string, groupIDs []string) error {
	if err := syncCompanyUserGroupClosureTx(ctx, tx, companyID); err != nil {
		return err
	}
	keys, err := gvicResourceKeysForAffectedGroupsTx(ctx, tx, companyID, groupIDs)
	if err != nil {
		return err
	}
	_, err = syncPostgresGVICForResourceKeysTx(ctx, tx, companyID, keys)
	return err
}

// syncPostgresGVICForAllGroupAssignmentsTx is intentionally company-wide and is
// reserved for repair/backfill paths where every group-principal GVIC assignment
// may need to be refreshed.
func syncPostgresGVICForAllGroupAssignmentsTx(ctx context.Context, tx *sql.Tx, companyID string) error {
	if err := syncCompanyUserGroupClosureTx(ctx, tx, companyID); err != nil {
		return err
	}
	keys, err := gvicResourceKeysForAllGroupAssignmentsTx(ctx, tx, companyID)
	if err != nil {
		return err
	}
	_, err = syncPostgresGVICForResourceKeysTx(ctx, tx, companyID, keys)
	return err
}

func postgresGVICEffectiveAssignmentsForAccess(ctx context.Context, queryer postgresGVICQueryer, companyID, resourceType, resourceID, userID string) ([]domain.ResourceGVICEffectiveAssignment, error) {
	keyValue, err := normalizeResourceGVICKey(companyID, resourceType, resourceID)
	if err != nil {
		return nil, nil
	}
	userID = cleanUUIDText(userID)
	if userID == "" {
		return nil, nil
	}
	assignments, err := postgresResourceGVICEffectiveAssignmentsForResource(ctx, queryer, keyValue)
	if err != nil {
		return nil, err
	}
	items := make([]domain.ResourceGVICEffectiveAssignment, 0, len(assignments))
	for _, assignment := range assignments {
		if assignment.UserID == userID {
			items = append(items, assignment)
		}
	}
	return items, nil
}
func userHasGVICAccess(ctx context.Context, queryer postgresGVICQueryer, companyID, userID, resourceType, resourceID, accessLevel string) (bool, error) {
	assignments, err := postgresGVICEffectiveAssignmentsForAccess(ctx, queryer, companyID, resourceType, resourceID, userID)
	if err != nil {
		if isPostgresUndefinedTable(err, "resource_gvic_effective_assignments") {
			return false, nil
		}
		return false, err
	}
	for _, assignment := range assignments {
		gvicAccess, ok := GVICRoleAccessLevel(assignment.Role)
		if ok && EntityPermissionSatisfies(gvicAccess, accessLevel) {
			return true, nil
		}
	}
	return false, nil
}

func postgresGVICErrNotFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
