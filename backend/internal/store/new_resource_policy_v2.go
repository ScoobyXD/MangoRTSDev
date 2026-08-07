package store

import (
	"context"
	"database/sql"

	"miraeopus/backend/internal/domain"
)

// customizeNewMemoryResourceRACIForCreatorLocked implements the one create-workflow
// exception in the V2 contract: copy the new resource's effective source policy,
// then assign the creator. It refuses to run after the target already owns edges.
func (r *MemoryRepo) customizeNewMemoryResourceRACIForCreatorLocked(companyID, resourceType, resourceID, role, creatorUserID string) (ResourceRACIPolicy, error) {
	if !r.ensureV2PolicySettingsLocked(companyID, resourceType, resourceID) || len(r.directMemoryRACIEdgesLocked(companyID, resourceType, resourceID)) != 0 {
		return ResourceRACIPolicy{}, ErrInvalid
	}
	normalized, err := normalizeResourceRACIAssignmentInputs([]ResourceRACIAssignmentInput{{
		Role: role, PrincipalType: EntityPermissionSubjectUser, PrincipalID: creatorUserID,
	}})
	if err != nil {
		return ResourceRACIPolicy{}, err
	}
	if err := r.validateRACIPrincipalLocked(companyID, EntityPermissionSubjectUser, creatorUserID); err != nil {
		return ResourceRACIPolicy{}, err
	}
	resolved := r.resolveV2PolicyLocked(companyID, resourceType, resourceID, true)
	edges := r.directMemoryRACIEdgesLocked(companyID, resolved.SourceType, resolved.SourceID)
	complete := make([]domain.ResourceRACIAssignment, 0, len(edges)+1)
	for _, edge := range edges {
		if (edge.PrincipalType == EntityPermissionSubjectUser && edge.PrincipalID == creatorUserID) ||
			(normalized[0].role == domain.RACIRoleResponsible && edge.Role == domain.RACIRoleResponsible) {
			continue
		}
		complete = append(complete, edge)
	}
	complete = append(complete, domain.ResourceRACIAssignment{
		Role: normalized[0].role, PrincipalType: EntityPermissionSubjectUser, PrincipalID: creatorUserID,
	})
	validation := make([]normalizedRACIAssignmentInput, 0, len(complete))
	for _, edge := range complete {
		validation = append(validation, normalizedRACIAssignmentInput{role: edge.Role, principalType: edge.PrincipalType, principalID: edge.PrincipalID})
	}
	keyValue := resourceRACIKey{companyID: companyID, resourceType: resourceType, resourceID: resourceID}
	if err := validateResourceRACIAssignmentInputsForOperation(keyValue, validation, RACIAssignmentCommandSet); err != nil {
		return ResourceRACIPolicy{}, err
	}
	settingKey := resourcePolicyKey(companyID, resourceType, resourceID)
	setting := r.gvicV2Settings[settingKey]
	setting.Mode = PolicyModeCustomized
	setting.CustomizedSequence = r.nextRACIV2SequenceLocked()
	r.gvicV2Settings[settingKey] = setting
	r.replaceMemoryRACIEdgesLocked(companyID, resourceType, resourceID, complete)
	return r.memoryV2RACIPolicyLocked(companyID, resourceType, resourceID), nil
}

// customizeNewMemoryResourcePermissionForCreatorLocked copies the effective
// permission source once and then gives the creator a direct Edit rule.
func (r *MemoryRepo) customizeNewMemoryResourcePermissionForCreatorLocked(companyID, resourceType, resourceID, creatorUserID string) (ResourcePermissionPolicy, error) {
	if !r.ensureV2PolicySettingsLocked(companyID, resourceType, resourceID) || len(r.directMemoryPermissionEdgesLocked(companyID, resourceType, resourceID)) != 0 {
		return ResourcePermissionPolicy{}, ErrInvalid
	}
	if err := r.validateRACIPrincipalLocked(companyID, EntityPermissionSubjectUser, creatorUserID); err != nil {
		return ResourcePermissionPolicy{}, err
	}
	resolved := r.resolveV2PolicyLocked(companyID, resourceType, resourceID, false)
	sourceSetting := r.permissionV2Settings[resourcePolicyKey(companyID, resolved.SourceType, resolved.SourceID)]
	edges := r.directMemoryPermissionEdgesLocked(companyID, resolved.SourceType, resolved.SourceID)
	complete := make([]domain.EntityPermission, 0, len(edges)+1)
	for _, edge := range edges {
		if edge.SubjectType == EntityPermissionSubjectUser && edge.SubjectID == creatorUserID {
			continue
		}
		complete = append(complete, edge)
	}
	complete = append(complete, domain.EntityPermission{
		SubjectType: EntityPermissionSubjectUser, SubjectID: creatorUserID,
		AccessLevel: EntityPermissionEdit, Permission: EntityPermissionEdit,
	})
	settingKey := resourcePolicyKey(companyID, resourceType, resourceID)
	setting := r.permissionV2Settings[settingKey]
	setting.Mode = PolicyModeCustomized
	setting.DefaultAccess = sourceSetting.DefaultAccess
	setting.CustomizedSequence = r.nextPermissionV2SequenceLocked()
	r.permissionV2Settings[settingKey] = setting
	r.replaceMemoryPermissionEdgesLocked(companyID, resourceType, resourceID, complete)
	return r.memoryV2PermissionPolicyLocked(companyID, resourceType, resourceID), nil
}

// customizeNewPostgresResourceRACIForCreatorTx is restricted to a newly-created
// resource with no target edges, so create workflows cannot turn this into a
// partial-policy update path.
func customizeNewPostgresResourceRACIForCreatorTx(ctx context.Context, tx *sql.Tx, keyValue resourceRACIKey, role, creatorUserID string) (ResourceRACIPolicy, error) {
	if err := ensureV2PolicySettingsTx(ctx, tx); err != nil {
		return ResourceRACIPolicy{}, err
	}
	var directCount int
	if err := tx.QueryRowContext(ctx, `select count(*) from resource_gvic_assignments where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID).Scan(&directCount); err != nil {
		return ResourceRACIPolicy{}, err
	}
	if directCount != 0 {
		return ResourceRACIPolicy{}, ErrInvalid
	}
	rows, err := tx.QueryContext(ctx, `
select edge.role,edge.principal_type,edge.principal_id::text
from mangorts_v2_resolve_gvic_policy($1::uuid,$2,$3::uuid) resolved
join resource_gvic_assignments edge
  on edge.company_id=$1::uuid
 and edge.resource_type=resolved.source_resource_type
 and edge.resource_id=resolved.source_resource_id
order by edge.role,edge.principal_type,edge.principal_id::text`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
	if err != nil {
		return ResourceRACIPolicy{}, err
	}
	complete := []ResourceRACIAssignmentInput{}
	for rows.Next() {
		var edge ResourceRACIAssignmentInput
		if err := rows.Scan(&edge.Role, &edge.PrincipalType, &edge.PrincipalID); err != nil {
			rows.Close()
			return ResourceRACIPolicy{}, err
		}
		if (edge.PrincipalType == EntityPermissionSubjectUser && edge.PrincipalID == creatorUserID) ||
			(role == domain.RACIRoleResponsible && edge.Role == domain.RACIRoleResponsible) {
			continue
		}
		complete = append(complete, edge)
	}
	if err := rows.Close(); err != nil {
		return ResourceRACIPolicy{}, err
	}
	complete = append(complete, ResourceRACIAssignmentInput{
		Role: role, PrincipalType: EntityPermissionSubjectUser, PrincipalID: creatorUserID,
	})
	return customizeResourceRACIPolicyTx(ctx, tx, keyValue, complete)
}

func customizeNewPostgresResourcePermissionForCreatorTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID, creatorUserID string) (ResourcePermissionPolicy, error) {
	if err := ensureV2PolicySettingsTx(ctx, tx); err != nil {
		return ResourcePermissionPolicy{}, err
	}
	var directCount int
	if err := tx.QueryRowContext(ctx, `select count(*) from resource_permissions where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, resourceType, resourceID).Scan(&directCount); err != nil {
		return ResourcePermissionPolicy{}, err
	}
	if directCount != 0 {
		return ResourcePermissionPolicy{}, ErrInvalid
	}
	policy, err := postgresV2PermissionPolicy(ctx, tx, companyID, resourceType, resourceID)
	if err != nil {
		return ResourcePermissionPolicy{}, err
	}
	complete := make([]EntityPermissionInput, 0, len(policy.EffectivePermissions)+1)
	for _, edge := range policy.EffectivePermissions {
		if edge.SubjectType == EntityPermissionSubjectUser && edge.SubjectID == creatorUserID {
			continue
		}
		complete = append(complete, EntityPermissionInput{
			SubjectType: edge.SubjectType, SubjectID: edge.SubjectID, AccessLevel: edge.AccessLevel,
		})
	}
	complete = append(complete, EntityPermissionInput{
		SubjectType: EntityPermissionSubjectUser, SubjectID: creatorUserID, AccessLevel: EntityPermissionEdit,
	})
	return customizeResourcePermissionPolicyTx(ctx, tx, companyID, resourceType, resourceID, policy.EffectiveDefaultAccess, complete)
}
