package store

import (
	"context"
	"database/sql"
)

// ensureV2PolicySettingsTx fires pending resource initialization before a create
// workflow writes a complete policy in the same transaction. The constraint
// remains immediate for later resources created by that transaction.
func ensureV2PolicySettingsTx(ctx context.Context, tx *sql.Tx) error {
	if ctx == nil || tx == nil {
		return ErrInvalid
	}
	_, err := tx.ExecContext(ctx, `set constraints trg_v2_policy_initialize immediate`)
	return err
}

func customizeResourceRACIPolicyTx(ctx context.Context, tx *sql.Tx, keyValue resourceRACIKey, inputs []ResourceRACIAssignmentInput) (ResourceRACIPolicy, error) {
	if ctx == nil || tx == nil {
		return ResourceRACIPolicy{}, ErrInvalid
	}
	normalized, err := normalizeResourceRACIAssignmentInputs(inputs)
	if err != nil {
		return ResourceRACIPolicy{}, err
	}
	if err := validateResourceRACIAssignmentInputsForOperation(keyValue, normalized, RACIAssignmentCommandSet); err != nil {
		return ResourceRACIPolicy{}, err
	}
	if err := ensureV2PolicySettingsTx(ctx, tx); err != nil {
		return ResourceRACIPolicy{}, err
	}
	for _, assignment := range normalized {
		if err := validatePostgresRACIPrincipalTx(ctx, tx, keyValue.companyID, assignment.principalType, assignment.principalID); err != nil {
			return ResourceRACIPolicy{}, err
		}
	}
	result, err := tx.ExecContext(ctx, `
update resource_gvic_settings
set assignment_mode='customized',
    customized_sequence=nextval('resource_gvic_change_sequence'),
    updated_timestamp=now()
where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`,
		keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
	if err != nil {
		return ResourceRACIPolicy{}, err
	}
	if count, err := result.RowsAffected(); err != nil {
		return ResourceRACIPolicy{}, err
	} else if count != 1 {
		return ResourceRACIPolicy{}, ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `delete from resource_gvic_assignments where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID); err != nil {
		return ResourceRACIPolicy{}, err
	}
	for _, assignment := range normalized {
		if _, err := tx.ExecContext(ctx, `
insert into resource_gvic_assignments(company_id,resource_type,resource_id,role,principal_type,principal_id,created_timestamp,updated_timestamp)
values($1::uuid,$2,$3::uuid,$4,$5,$6::uuid,now(),now())`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID, assignment.role, assignment.principalType, assignment.principalID); err != nil {
			return ResourceRACIPolicy{}, err
		}
	}
	return postgresV2RACIPolicy(ctx, tx, keyValue)
}

func customizeResourcePermissionPolicyTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID, defaultAccess string, inputs []EntityPermissionInput) (ResourcePermissionPolicy, error) {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	defaultAccess, accessOK := NormalizeResourceDefaultAccess(defaultAccess)
	if ctx == nil || tx == nil || companyID == "" || resourceID == "" || !typeOK || !accessOK {
		return ResourcePermissionPolicy{}, ErrInvalid
	}
	normalized, err := normalizeV2EntityPermissionInputs(inputs)
	if err != nil {
		return ResourcePermissionPolicy{}, err
	}
	if err := ensureV2PolicySettingsTx(ctx, tx); err != nil {
		return ResourcePermissionPolicy{}, err
	}
	for _, permission := range normalized {
		if err := validatePostgresRACIPrincipalTx(ctx, tx, companyID, permission.SubjectType, permission.SubjectID); err != nil {
			return ResourcePermissionPolicy{}, err
		}
	}
	result, err := tx.ExecContext(ctx, `
update resource_permission_settings
set permission_mode='customized',default_access=$4,
    customized_sequence=nextval('resource_permission_change_sequence'),updated_timestamp=now()
where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, resourceType, resourceID, defaultAccess)
	if err != nil {
		return ResourcePermissionPolicy{}, err
	}
	if count, err := result.RowsAffected(); err != nil {
		return ResourcePermissionPolicy{}, err
	} else if count != 1 {
		return ResourcePermissionPolicy{}, ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `delete from resource_permissions where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, resourceType, resourceID); err != nil {
		return ResourcePermissionPolicy{}, err
	}
	for _, permission := range normalized {
		if _, err := tx.ExecContext(ctx, `
insert into resource_permissions(company_id,resource_type,resource_id,subject_type,subject_id,access_level,created_timestamp,updated_timestamp)
values($1::uuid,$2,$3::uuid,$4,$5::uuid,$6,now(),now())`, companyID, resourceType, resourceID, permission.SubjectType, permission.SubjectID, permission.AccessLevel); err != nil {
			return ResourcePermissionPolicy{}, err
		}
	}
	return postgresV2PermissionPolicy(ctx, tx, companyID, resourceType, resourceID)
}
