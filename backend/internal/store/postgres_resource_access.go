package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

type postgresQueryRower interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func postgresResourceDefaultAccess(ctx context.Context, q postgresQueryRower, companyID, resourceType, resourceID string) (string, error) {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, ok := NormalizeEntityType(resourceType)
	if ctx == nil || q == nil || companyID == "" || resourceID == "" || !ok || !usesDefaultResourceAccessPolicy(resourceType) {
		return "", ErrInvalid
	}
	var access string
	var err error
	switch resourceType {
	case EntityTypeNode:
		err = q.QueryRowContext(ctx, `
select coalesce(default_access, $3)
from nodes
where company_id=$1::uuid and node_id=$2::uuid`, companyID, resourceID, ResourceDefaultAccessEdit).Scan(&access)
	case EntityTypeLogicGate:
		err = q.QueryRowContext(ctx, `
select coalesce(default_access, $3)
from logic_gates
where company_id=$1::uuid and logic_gate_id=$2::uuid`, companyID, resourceID, ResourceDefaultAccessEdit).Scan(&access)
	default:
		return "", ErrInvalid
	}
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return defaultResourceAccessOrEdit(access), nil
}

func setPostgresResourceDefaultAccessTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID, defaultAccess string) error {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, ok := NormalizeEntityType(resourceType)
	defaultAccess, accessOK := NormalizeResourceDefaultAccess(defaultAccess)
	if ctx == nil || tx == nil || companyID == "" || resourceID == "" || !ok || !accessOK || !usesDefaultResourceAccessPolicy(resourceType) {
		return ErrInvalid
	}
	var res sql.Result
	var err error
	switch resourceType {
	case EntityTypeNode:
		res, err = tx.ExecContext(ctx, `
update nodes
set default_access=$3
where company_id=$1::uuid and node_id=$2::uuid`, companyID, resourceID, defaultAccess)
	case EntityTypeLogicGate:
		res, err = tx.ExecContext(ctx, `
update logic_gates
set default_access=$3
where company_id=$1::uuid and logic_gate_id=$2::uuid`, companyID, resourceID, defaultAccess)
	default:
		return ErrInvalid
	}
	if err != nil {
		return err
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		return ErrNotFound
	}
	return nil
}

func deletePostgresResourceOverridesTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) error {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, ok := NormalizeEntityType(resourceType)
	if ctx == nil || tx == nil || companyID == "" || resourceID == "" || !ok || !usesDefaultResourceAccessPolicy(resourceType) {
		return ErrInvalid
	}
	_, err := tx.ExecContext(ctx, `
delete from resource_permissions
where company_id=$1::uuid
  and resource_type=$2
  and resource_id=$3::uuid`, companyID, resourceType, resourceID)
	return err
}

func insertPostgresResourceOverrideTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID, userID string) error {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	userID = cleanUUIDText(userID)
	resourceType, ok := NormalizeEntityType(resourceType)
	if ctx == nil || tx == nil || companyID == "" || resourceID == "" || userID == "" || !ok || !usesDefaultResourceAccessPolicy(resourceType) {
		return ErrInvalid
	}
	_, err := tx.ExecContext(ctx, `
insert into resource_permissions (
  company_id,
  resource_type,
  resource_id,
  user_id,
  created_timestamp,
  updated_timestamp
)
values ($1::uuid, $2, $3::uuid, $4::uuid, now(), now())
on conflict (company_id, resource_type, resource_id, user_id)
do update set updated_timestamp=now()`, companyID, resourceType, resourceID, userID)
	return err
}

func postgresResourceOverrideUserIDsFromInput(ctx context.Context, tx *sql.Tx, input EntityPermissionUpdateInput, defaultAccess string) ([]string, error) {
	if ctx == nil || tx == nil {
		return nil, ErrInvalid
	}
	companyID := cleanUUIDText(input.CompanyID)
	entityType, ok := NormalizeEntityType(input.EntityType)
	if companyID == "" || !ok || !usesDefaultResourceAccessPolicy(entityType) {
		return nil, ErrInvalid
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(input.OverrideUserIDs)+len(input.Permissions))
	addUser := func(userID string) error {
		userID = cleanUUIDText(userID)
		if userID == "" || seen[userID] {
			return nil
		}
		var role string
		err := tx.QueryRowContext(ctx, `
select role
from company_memberships
where company_id=$1::uuid and user_id=$2::uuid`, companyID, userID).Scan(&role)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrAssigneeNotInCompany
		}
		if err != nil {
			return err
		}
		if domain.CanManageCompany(role) {
			return nil
		}
		seen[userID] = true
		out = append(out, userID)
		return nil
	}
	for _, userID := range input.OverrideUserIDs {
		if err := addUser(userID); err != nil {
			return nil, err
		}
	}
	if len(input.OverrideUserIDs) > 0 {
		return out, nil
	}
	for _, permission := range input.Permissions {
		subjectType, ok := NormalizeEntityPermissionSubjectType(permission.SubjectType)
		if !ok {
			return nil, ErrInvalid
		}
		accessLevel, ok := NormalizeEntityPermission(permissionInputAccessLevel(permission))
		if !ok {
			return nil, ErrInvalid
		}
		if accessLevel == defaultAccess {
			continue
		}
		subjectID := cleanUUIDText(permission.SubjectID)
		if subjectID == "" {
			return nil, ErrInvalid
		}
		switch subjectType {
		case EntityPermissionSubjectUser:
			if err := addUser(subjectID); err != nil {
				return nil, err
			}
		case EntityPermissionSubjectGroup:
			rows, err := tx.QueryContext(ctx, `
with recursive group_scope(group_id, path) as (
  select group_id, array[group_id]
  from company_user_groups
  where company_id=$1::uuid and group_id=$2::uuid
  union all
  select child.group_id, group_scope.path || child.group_id
  from group_scope
  join company_user_groups child
    on child.company_id=$1::uuid
   and child.parent_group_id=group_scope.group_id
  where not child.group_id = any(group_scope.path)
)
select distinct member.user_id::text
from company_user_group_members member
join group_scope on group_scope.group_id=member.group_id
where member.company_id=$1::uuid
order by member.user_id::text`, companyID, subjectID)
			if err != nil {
				return nil, err
			}
			found := false
			for rows.Next() {
				var userID string
				if err := rows.Scan(&userID); err != nil {
					rows.Close()
					return nil, err
				}
				found = true
				if err := addUser(userID); err != nil {
					rows.Close()
					return nil, err
				}
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return nil, err
			}
			if err := rows.Close(); err != nil {
				return nil, err
			}
			if !found {
				return nil, ErrNotFound
			}
		default:
			return nil, ErrInvalid
		}
	}
	return out, nil
}

func setPostgresResourceAccessPolicyTx(ctx context.Context, tx *sql.Tx, input EntityPermissionUpdateInput, entityType, entityID string) error {
	if ctx == nil || tx == nil {
		return ErrInvalid
	}
	companyID := cleanUUIDText(input.CompanyID)
	entityID = cleanUUIDText(entityID)
	entityType, ok := NormalizeEntityType(entityType)
	if companyID == "" || entityID == "" || !ok || !usesDefaultResourceAccessPolicy(entityType) {
		return ErrInvalid
	}
	defaultAccess, err := postgresResourceDefaultAccess(ctx, tx, companyID, entityType, entityID)
	if err != nil {
		return err
	}
	defaultAccessChanged := false
	if input.DefaultAccessSet {
		defaultAccess, ok = NormalizeResourceDefaultAccess(input.DefaultAccess)
		if !ok {
			return ErrInvalid
		}
		defaultAccessChanged = true
	} else if len(input.OverrideUserIDs) == 0 {
		inferredDefaultAccess, inferred, err := inferredResourceDefaultAccessFromPermissions(input.Permissions)
		if err != nil {
			return err
		}
		if inferred {
			defaultAccess = inferredDefaultAccess
			defaultAccessChanged = true
		}
	}
	if defaultAccessChanged {
		if err := setPostgresResourceDefaultAccessTx(ctx, tx, companyID, entityType, entityID, defaultAccess); err != nil {
			return err
		}
	}
	overrideUserIDs, err := postgresResourceOverrideUserIDsFromInput(ctx, tx, input, defaultAccess)
	if err != nil {
		return err
	}
	if err := deletePostgresResourceOverridesTx(ctx, tx, companyID, entityType, entityID); err != nil {
		return err
	}
	for _, userID := range overrideUserIDs {
		if err := insertPostgresResourceOverrideTx(ctx, tx, companyID, entityType, entityID, userID); err != nil {
			return err
		}
	}
	return nil
}

func copyPostgresLogicGateAccessPolicyToNodeTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID, nodeID string) error {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	nodeID = cleanUUIDText(nodeID)
	if ctx == nil || tx == nil || companyID == "" || logicGateID == "" || nodeID == "" {
		return ErrInvalid
	}
	matches, err := postgresLogicGateAccessPolicyMatchesNodeTx(ctx, tx, companyID, logicGateID, nodeID)
	if err != nil {
		return err
	}
	if matches {
		return nil
	}
	defaultAccess, err := postgresResourceDefaultAccess(ctx, tx, companyID, EntityTypeLogicGate, logicGateID)
	if err != nil {
		return err
	}
	if err := setPostgresResourceDefaultAccessTx(ctx, tx, companyID, EntityTypeNode, nodeID, defaultAccess); err != nil {
		return err
	}
	if err := deletePostgresResourceOverridesTx(ctx, tx, companyID, EntityTypeNode, nodeID); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `
select user_id::text
from resource_permissions
where company_id=$1::uuid
  and resource_type='logic_gate'
  and resource_id=$2::uuid
order by user_id::text`, companyID, logicGateID)
	if err != nil {
		return err
	}
	userIDs := []string{}
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			rows.Close()
			return err
		}
		userIDs = append(userIDs, userID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, userID := range userIDs {
		if err := insertPostgresResourceOverrideTx(ctx, tx, companyID, EntityTypeNode, nodeID, userID); err != nil {
			return err
		}
	}
	return nil
}

func postgresLogicGateAccessPolicyMatchesNodeTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID, nodeID string) (bool, error) {
	var matches bool
	err := tx.QueryRowContext(ctx, `
with gate_default as (
  select coalesce(default_access, $4) as default_access
  from logic_gates
  where company_id=$1::uuid and logic_gate_id=$2::uuid
),
node_default as (
  select coalesce(default_access, $4) as default_access
  from nodes
  where company_id=$1::uuid and node_id=$3::uuid
),
gate_users as (
  select user_id
  from resource_permissions
  where company_id=$1::uuid
    and resource_type='logic_gate'
    and resource_id=$2::uuid
),
node_users as (
  select user_id
  from resource_permissions
  where company_id=$1::uuid
    and resource_type='node'
    and resource_id=$3::uuid
),
different_users as (
  (select user_id from gate_users except select user_id from node_users)
  union
  (select user_id from node_users except select user_id from gate_users)
)
select exists(select 1 from gate_default)
   and exists(select 1 from node_default)
   and (select default_access from gate_default) = (select default_access from node_default)
   and not exists(select 1 from different_users)`,
		companyID, logicGateID, nodeID, ResourceDefaultAccessEdit,
	).Scan(&matches)
	if err != nil {
		return false, err
	}
	return matches, nil
}

func (r *PostgresRepo) effectiveAccessLevelForUserTx(ctx context.Context, tx *sql.Tx, companyID, userID, resourceType, resourceID string) (string, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, ok := NormalizeEntityType(resourceType)
	if ctx == nil || tx == nil || companyID == "" || userID == "" || resourceID == "" || !ok {
		return "", ErrInvalid
	}
	var accessLevel string
	err := tx.QueryRowContext(ctx, `
with admin_actor as (
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
select case
  when (select allowed from admin_actor) then 'admin'
  when mangorts_user_can_access_resource($1::uuid, $3::text, $4::uuid, $2::uuid, 'view') then 'edit'
  else 'no_access'
end`, companyID, userID, resourceType, resourceID).Scan(&accessLevel)
	return accessLevel, err
}

func postgresResourceAccessCheckSQL(resourceAlias, idColumn, resourceType, userParam, requiredParam string) string {
	resourceAlias = strings.TrimSpace(resourceAlias)
	idColumn = strings.TrimSpace(idColumn)
	resourceType = strings.TrimSpace(resourceType)
	userParam = strings.TrimSpace(userParam)
	requiredParam = strings.TrimSpace(requiredParam)
	if resourceAlias == "" || idColumn == "" || resourceType == "" || userParam == "" || requiredParam == "" {
		return "false"
	}
	return `mangorts_user_can_access_resource(` + resourceAlias + `.company_id, '` + resourceType + `', ` + resourceAlias + `.` + idColumn + `, ` + userParam + `::uuid, ` + requiredParam + `)`
}
