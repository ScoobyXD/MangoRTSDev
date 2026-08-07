package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

func cleanPolicyRevision(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "W/")
	return strings.Trim(value, "\"")
}

func normalizePolicyMode(value string) (string, bool) {
	switch strings.TrimSpace(value) {
	case PolicyModeInherited:
		return PolicyModeInherited, true
	case PolicyModeCustomized:
		return PolicyModeCustomized, true
	default:
		return "", false
	}
}

func normalizeDescendantAction(value string) (string, bool) {
	switch strings.TrimSpace(value) {
	case "", PolicyDescendantActionInheritedOnly:
		return PolicyDescendantActionInheritedOnly, true
	case PolicyDescendantActionIncludingCustomized:
		return PolicyDescendantActionIncludingCustomized, true
	default:
		return "", false
	}
}

func (r *PostgresRepo) GetResourceGVICPolicy(companyID, resourceType, resourceID string) (ResourceGVICPolicy, error) {
	keyValue, err := normalizeResourceGVICKey(companyID, resourceType, resourceID)
	if err != nil {
		return ResourceGVICPolicy{}, err
	}
	return postgresV2GVICPolicy(context.Background(), r.db, keyValue)
}

func postgresV2GVICPolicy(ctx context.Context, queryer postgresGVICQueryer, keyValue resourceGVICKey) (ResourceGVICPolicy, error) {
	if exists, err := postgresGVICResourceExists(ctx, queryer, keyValue); err != nil {
		return ResourceGVICPolicy{}, err
	} else if !exists {
		return ResourceGVICPolicy{}, ErrNotFound
	}
	policy := ResourceGVICPolicy{
		CompanyID: keyValue.companyID, ResourceType: keyValue.resourceType, ResourceID: keyValue.resourceID,
		GVICAssignments: []domain.ResourceGVICAssignment{}, EffectiveAssignments: []domain.ResourceGVICEffectiveAssignment{},
	}
	var sourceType, sourceID string
	var overwrittenType, overwrittenID sql.NullString
	var overwrittenSequence sql.NullInt64
	err := queryer.QueryRowContext(ctx, `
select setting.assignment_mode,
       resolved.source_resource_type,
       resolved.source_resource_id::text,
       resolved.overwritten_resource_type,
       resolved.overwritten_resource_id::text,
       resolved.overwritten_sequence,
       md5(concat_ws(':',setting.assignment_mode,setting.customized_sequence,
         setting.parent_link_sequence,setting.descendant_reset_sequence,
         resolved.source_resource_type,resolved.source_resource_id,resolved.source_customized_sequence,
         resolved.reset_resource_type,resolved.reset_resource_id,resolved.reset_sequence,
         resolved.parent_link_fingerprint,mangorts_v2_group_membership_version($1::uuid)))
from resource_gvic_settings setting
cross join lateral mangorts_v2_resolve_gvic_policy(setting.company_id,setting.resource_type,setting.resource_id) resolved
where setting.company_id=$1::uuid and setting.resource_type=$2 and setting.resource_id=$3::uuid`,
		keyValue.companyID, keyValue.resourceType, keyValue.resourceID).Scan(
		&policy.AssignmentMode, &sourceType, &sourceID, &overwrittenType, &overwrittenID, &overwrittenSequence, &policy.Revision,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return ResourceGVICPolicy{}, ErrNotFound
	}
	if err != nil {
		return ResourceGVICPolicy{}, err
	}
	policy.EffectiveSource = PolicySource{ResourceType: sourceType, ResourceID: sourceID}
	policy.EffectiveAssignmentMode = PolicyModeInherited
	if sourceType == keyValue.resourceType && sourceID == keyValue.resourceID && !overwrittenID.Valid {
		policy.EffectiveAssignmentMode = PolicyModeCustomized
	}
	if overwrittenID.Valid {
		policy.OverwrittenByAncestor = &PolicyOverwrite{ResourceType: overwrittenType.String, ResourceID: overwrittenID.String, Sequence: overwrittenSequence.Int64}
	}
	policy.GVICAssignments, err = postgresDirectResourceGVICAssignmentsForResource(ctx, queryer, keyValue)
	if err != nil {
		return ResourceGVICPolicy{}, err
	}
	if policy.AssignmentMode == PolicyModeInherited {
		policy.GVICAssignments = []domain.ResourceGVICAssignment{}
	}
	policy.EffectiveAssignments, err = postgresV2EffectiveGVICAssignments(ctx, queryer, keyValue)
	if err != nil {
		return ResourceGVICPolicy{}, err
	}
	return policy, nil
}

func postgresV2EffectiveGVICAssignments(ctx context.Context, queryer postgresGVICQueryer, keyValue resourceGVICKey) ([]domain.ResourceGVICEffectiveAssignment, error) {
	rows, err := queryer.QueryContext(ctx, `
select $1::uuid::text,$2,$3::uuid::text,effective.role,effective.user_id::text,
       effective.source_resource_type,effective.source_resource_id::text,
       effective.source_principal_type,effective.source_principal_id::text,effective.inheritance_type,
       nullif(app_user.display_name,''),nullif(app_user.email,''),effective.updated_timestamp
from mangorts_v2_effective_gvic_assignments($1::uuid,$2,$3::uuid) effective
left join users app_user on app_user.user_id=effective.user_id
order by effective.user_id::text,effective.role,effective.source_principal_type,effective.source_principal_id::text`,
		keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.ResourceGVICEffectiveAssignment{}
	for rows.Next() {
		var item domain.ResourceGVICEffectiveAssignment
		var displayName, email sql.NullString
		if err := rows.Scan(&item.CompanyID, &item.ResourceType, &item.ResourceID, &item.Role, &item.UserID,
			&item.SourceResourceType, &item.SourceResourceID, &item.SourcePrincipalType, &item.SourcePrincipalID,
			&item.InheritanceType, &displayName, &email, &item.UpdatedTimestamp); err != nil {
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
	return items, rows.Err()
}

func (r *PostgresRepo) PutResourceGVICPolicy(input ResourceGVICPolicyUpdateInput) (ResourceGVICPolicy, []domain.DomainEvent, error) {
	keyValue, err := normalizeResourceGVICKey(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return ResourceGVICPolicy{}, nil, err
	}
	mode, ok := normalizePolicyMode(input.AssignmentMode)
	if !ok {
		return ResourceGVICPolicy{}, nil, ErrInvalid
	}
	action, ok := normalizeDescendantAction(input.DescendantAction)
	if !ok || (mode == PolicyModeInherited && len(input.Assignments) > 0) {
		return ResourceGVICPolicy{}, nil, ErrInvalid
	}
	normalized, err := normalizeResourceGVICAssignmentInputs(input.Assignments)
	if err != nil {
		return ResourceGVICPolicy{}, nil, err
	}
	if err := validateResourceGVICAssignmentInputsForOperation(keyValue, normalized, GVICAssignmentCommandSet); err != nil {
		return ResourceGVICPolicy{}, nil, err
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ResourceGVICPolicy{}, nil, err
	}
	defer tx.Rollback()
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		var duplicate bool
		if err := tx.QueryRowContext(ctx, `select exists(select 1 from domain_events where company_id=$1::uuid and idempotency_key=$2)`, keyValue.companyID, strings.TrimSpace(input.IdempotencyKey)).Scan(&duplicate); err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
		if duplicate {
			if err := tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
				return ResourceGVICPolicy{}, nil, err
			}
			policy, err := r.GetResourceGVICPolicy(keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
			return policy, []domain.DomainEvent{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `select 1 from resource_gvic_settings where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid for update`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID); err != nil {
		return ResourceGVICPolicy{}, nil, err
	}
	current, err := postgresV2GVICPolicy(ctx, tx, keyValue)
	if err != nil {
		return ResourceGVICPolicy{}, nil, err
	}
	if expected := cleanPolicyRevision(input.ExpectedRevision); expected != "" && expected != current.Revision {
		return ResourceGVICPolicy{}, nil, ErrVersionConflict
	}
	if mode == PolicyModeCustomized && input.Assignments == nil {
		sourceKey := resourceGVICKey{
			companyID:    keyValue.companyID,
			resourceType: current.EffectiveSource.ResourceType,
			resourceID:   current.EffectiveSource.ResourceID,
		}
		sourceEdges, err := postgresDirectResourceGVICAssignmentsForResource(ctx, tx, sourceKey)
		if err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
		inputs := make([]ResourceGVICAssignmentInput, 0, len(sourceEdges))
		for _, edge := range sourceEdges {
			inputs = append(inputs, ResourceGVICAssignmentInput{
				Role: edge.Role, PrincipalType: edge.PrincipalType, PrincipalID: edge.PrincipalID,
			})
		}
		normalized, err = normalizeResourceGVICAssignmentInputs(inputs)
		if err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
		if err := validateResourceGVICAssignmentInputsForOperation(keyValue, normalized, GVICAssignmentCommandSet); err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
	}
	for _, assignment := range normalized {
		if err := validatePostgresGVICPrincipalTx(ctx, tx, keyValue.companyID, assignment.principalType, assignment.principalID); err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
	}
	var resultingSequence int64
	if mode == PolicyModeInherited {
		var hasParent bool
		if err := tx.QueryRowContext(ctx, `select exists(select 1 from mangorts_v2_policy_parent($1::uuid,$2,$3::uuid))`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID).Scan(&hasParent); err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
		if !hasParent {
			return ResourceGVICPolicy{}, nil, ErrInvalid
		}
		if _, err := tx.ExecContext(ctx, `delete from resource_gvic_assignments where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID); err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
		if _, err := tx.ExecContext(ctx, `update resource_gvic_settings set assignment_mode='inherited',customized_sequence=null,updated_timestamp=now() where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID); err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
	} else {
		var sequence int64
		if err := tx.QueryRowContext(ctx, `select nextval('resource_gvic_change_sequence')`).Scan(&sequence); err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
		resultingSequence = sequence
		if _, err := tx.ExecContext(ctx, `update resource_gvic_settings set assignment_mode='customized',customized_sequence=$4,updated_timestamp=now() where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID, sequence); err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
		if _, err := tx.ExecContext(ctx, `delete from resource_gvic_assignments where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID); err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
		for _, assignment := range normalized {
			if _, err := tx.ExecContext(ctx, `insert into resource_gvic_assignments(company_id,resource_type,resource_id,role,principal_type,principal_id,created_timestamp,updated_timestamp) values($1::uuid,$2,$3::uuid,$4,$5,$6::uuid,now(),now())`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID, assignment.role, assignment.principalType, assignment.principalID); err != nil {
				return ResourceGVICPolicy{}, nil, err
			}
		}
	}
	if action == PolicyDescendantActionIncludingCustomized {
		if err := tx.QueryRowContext(ctx, `select nextval('resource_gvic_change_sequence')`).Scan(&resultingSequence); err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
		if _, err := tx.ExecContext(ctx, `update resource_gvic_settings set descendant_reset_sequence=$4,updated_timestamp=now() where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID, resultingSequence); err != nil {
			return ResourceGVICPolicy{}, nil, err
		}
	}
	after, err := postgresV2GVICPolicy(ctx, tx, keyValue)
	if err != nil {
		return ResourceGVICPolicy{}, nil, err
	}
	userIDs := resourceGVICChangedUserIDs(current.EffectiveAssignments, after.EffectiveAssignments)

	eventInput := DomainEventInput{CompanyID: keyValue.companyID, StreamType: workspaceDomainStreamType, StreamID: keyValue.companyID,
		Type: v2GVICEventType(keyValue.resourceType), ActorUserID: strings.TrimSpace(input.ActorUserID), IdempotencyKey: strings.TrimSpace(input.IdempotencyKey),
		Payload: v2PolicyEventPayload(keyValue.resourceType, keyValue.resourceID, map[string]any{"policy_type": "gvic", "assignment_mode": mode, "action": action, "descendant_action": action, "sequence": resultingSequence, "assignment_user_ids": userIDs})}
	event, err := r.appendDomainEventTx(ctx, tx, eventInput)
	if err != nil {
		return ResourceGVICPolicy{}, nil, err
	}
	if err := tx.Commit(); err != nil {
		return ResourceGVICPolicy{}, nil, err
	}
	return after, []domain.DomainEvent{event}, nil
}

func v2GVICEventType(resourceType string) string {
	switch resourceType {
	case EntityTypeNode:
		return NodeGVICUpdatedEventType
	case EntityTypeLogicGate:
		return LogicGateGVICUpdatedEventType
	case EntityTypeSharedInbox:
		return "communications_shared_inbox_gvic_updated"
	default:
		return "resource_gvic_policy_updated"
	}
}

func (r *PostgresRepo) GetResourcePermissionPolicy(companyID, resourceType, resourceID string) (ResourcePermissionPolicy, error) {
	resourceType, ok := NormalizeEntityType(resourceType)
	companyID, resourceID = cleanUUIDText(companyID), cleanUUIDText(resourceID)
	if !ok || companyID == "" || resourceID == "" {
		return ResourcePermissionPolicy{}, ErrInvalid
	}
	return postgresV2PermissionPolicy(context.Background(), r.db, companyID, resourceType, resourceID)
}

func postgresV2PermissionPolicy(ctx context.Context, queryer postgresResourceAccessQueryer, companyID, resourceType, resourceID string) (ResourcePermissionPolicy, error) {
	policy := ResourcePermissionPolicy{CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, Permissions: []domain.EntityPermission{}, EffectivePermissions: []domain.EntityPermission{}}
	var storedDefault sql.NullString
	var sourceType, sourceID, effectiveDefault string
	var overwrittenType, overwrittenID sql.NullString
	var overwrittenSequence sql.NullInt64
	err := queryer.QueryRowContext(ctx, `
select setting.permission_mode,setting.default_access,
       resolved.source_resource_type,resolved.source_resource_id::text,source_setting.default_access,
       resolved.overwritten_resource_type,resolved.overwritten_resource_id::text,resolved.overwritten_sequence,
       md5(concat_ws(':',setting.permission_mode,setting.default_access,setting.customized_sequence,
         setting.parent_link_sequence,setting.descendant_reset_sequence,
         resolved.source_resource_type,resolved.source_resource_id,resolved.source_customized_sequence,
         resolved.reset_resource_type,resolved.reset_resource_id,resolved.reset_sequence,
         resolved.parent_link_fingerprint,mangorts_v2_group_membership_version($1::uuid)))
from resource_permission_settings setting
cross join lateral mangorts_v2_resolve_permission_policy(setting.company_id,setting.resource_type,setting.resource_id) resolved
join resource_permission_settings source_setting
  on source_setting.company_id=setting.company_id and source_setting.resource_type=resolved.source_resource_type and source_setting.resource_id=resolved.source_resource_id
where setting.company_id=$1::uuid and setting.resource_type=$2 and setting.resource_id=$3::uuid`, companyID, resourceType, resourceID).Scan(
		&policy.PermissionMode, &storedDefault, &sourceType, &sourceID, &effectiveDefault,
		&overwrittenType, &overwrittenID, &overwrittenSequence, &policy.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		return ResourcePermissionPolicy{}, ErrNotFound
	}
	if err != nil {
		return ResourcePermissionPolicy{}, err
	}
	if storedDefault.Valid {
		value := storedDefault.String
		policy.DefaultAccess = &value
	}
	policy.EffectiveDefaultAccess = effectiveDefault
	policy.EffectiveSource = PolicySource{ResourceType: sourceType, ResourceID: sourceID}
	policy.EffectivePermissionMode = PolicyModeInherited
	if sourceType == resourceType && sourceID == resourceID && !overwrittenID.Valid {
		policy.EffectivePermissionMode = PolicyModeCustomized
	}
	if overwrittenID.Valid {
		policy.OverwrittenByAncestor = &PolicyOverwrite{ResourceType: overwrittenType.String, ResourceID: overwrittenID.String, Sequence: overwrittenSequence.Int64}
	}
	policy.Permissions, err = postgresV2PermissionEdges(ctx, queryer, companyID, resourceType, resourceID)
	if err != nil {
		return ResourcePermissionPolicy{}, err
	}
	if policy.PermissionMode == PolicyModeInherited {
		policy.Permissions = []domain.EntityPermission{}
	}
	policy.EffectivePermissions, err = postgresV2PermissionEdges(ctx, queryer, companyID, sourceType, sourceID)
	if err != nil {
		return ResourcePermissionPolicy{}, err
	}
	return policy, nil
}

func postgresV2PermissionEdges(ctx context.Context, queryer postgresResourceAccessQueryer, companyID, resourceType, resourceID string) ([]domain.EntityPermission, error) {
	rows, err := queryer.QueryContext(ctx, `
select access.company_id::text,access.resource_type,access.resource_id::text,
       access.subject_type,access.subject_id::text,
       coalesce(nullif(user_group.name,''),nullif(app_user.display_name,''),nullif(app_user.email,'')),
       nullif(app_user.email,''),access.access_level,access.created_timestamp
from resource_permissions access
left join users app_user on access.subject_type='user' and app_user.user_id=access.subject_id
left join company_user_groups user_group on access.subject_type='group' and user_group.company_id=access.company_id and user_group.group_id=access.subject_id
where access.company_id=$1::uuid and access.resource_type=$2 and access.resource_id=$3::uuid
order by access.subject_type,lower(coalesce(user_group.name,app_user.display_name,app_user.email,'')),access.subject_id::text`, companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.EntityPermission{}
	for rows.Next() {
		var item domain.EntityPermission
		var name, email sql.NullString
		if err := rows.Scan(&item.CompanyID, &item.EntityType, &item.EntityID, &item.SubjectType, &item.SubjectID, &name, &email, &item.AccessLevel, &item.CreatedTimestamp); err != nil {
			return nil, err
		}
		item.Permission = item.AccessLevel
		if name.Valid {
			item.SubjectName = name.String
		}
		if email.Valid {
			item.SubjectEmail = email.String
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) PutResourcePermissionPolicy(input ResourcePermissionPolicyUpdateInput) (ResourcePermissionPolicy, []domain.DomainEvent, error) {
	resourceType, ok := NormalizeEntityType(input.ResourceType)
	companyID, resourceID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.ResourceID)
	mode, modeOK := normalizePolicyMode(input.PermissionMode)
	action, actionOK := normalizeDescendantAction(input.DescendantAction)
	if !ok || companyID == "" || resourceID == "" || !modeOK || !actionOK || (mode == PolicyModeCustomized && input.DefaultAccess == nil) ||
		(mode == PolicyModeInherited && (input.DefaultAccess != nil || len(input.Permissions) > 0)) {
		return ResourcePermissionPolicy{}, nil, ErrInvalid
	}
	normalized, err := normalizeV2EntityPermissionInputs(input.Permissions)
	if err != nil {
		return ResourcePermissionPolicy{}, nil, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ResourcePermissionPolicy{}, nil, err
	}
	defer tx.Rollback()
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		var duplicate bool
		if err := tx.QueryRowContext(ctx, `select exists(select 1 from domain_events where company_id=$1::uuid and idempotency_key=$2)`, companyID, strings.TrimSpace(input.IdempotencyKey)).Scan(&duplicate); err != nil {
			return ResourcePermissionPolicy{}, nil, err
		}
		if duplicate {
			_ = tx.Rollback()
			policy, err := r.GetResourcePermissionPolicy(companyID, resourceType, resourceID)
			return policy, []domain.DomainEvent{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `select 1 from resource_permission_settings where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid for update`, companyID, resourceType, resourceID); err != nil {
		return ResourcePermissionPolicy{}, nil, err
	}
	current, err := postgresV2PermissionPolicy(ctx, tx, companyID, resourceType, resourceID)
	if err != nil {
		return ResourcePermissionPolicy{}, nil, err
	}
	if expected := cleanPolicyRevision(input.ExpectedRevision); expected != "" && expected != current.Revision {
		return ResourcePermissionPolicy{}, nil, ErrVersionConflict
	}
	for _, permission := range normalized {
		if err := validatePostgresGVICPrincipalTx(ctx, tx, companyID, permission.SubjectType, permission.SubjectID); err != nil {
			return ResourcePermissionPolicy{}, nil, err
		}
	}
	var resultingSequence int64
	if mode == PolicyModeInherited {
		var hasParent bool
		if err := tx.QueryRowContext(ctx, `select exists(select 1 from mangorts_v2_policy_parent($1::uuid,$2,$3::uuid))`, companyID, resourceType, resourceID).Scan(&hasParent); err != nil {
			return ResourcePermissionPolicy{}, nil, err
		}
		if !hasParent {
			return ResourcePermissionPolicy{}, nil, ErrInvalid
		}
		if _, err := tx.ExecContext(ctx, `delete from resource_permissions where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, resourceType, resourceID); err != nil {
			return ResourcePermissionPolicy{}, nil, err
		}
		if _, err := tx.ExecContext(ctx, `update resource_permission_settings set permission_mode='inherited',default_access=null,customized_sequence=null,updated_timestamp=now() where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, resourceType, resourceID); err != nil {
			return ResourcePermissionPolicy{}, nil, err
		}
	} else {
		defaultAccess, ok := NormalizeEntityPermission(*input.DefaultAccess)
		if !ok {
			return ResourcePermissionPolicy{}, nil, ErrInvalid
		}
		var sequence int64
		if err := tx.QueryRowContext(ctx, `select nextval('resource_permission_change_sequence')`).Scan(&sequence); err != nil {
			return ResourcePermissionPolicy{}, nil, err
		}
		resultingSequence = sequence
		if _, err := tx.ExecContext(ctx, `update resource_permission_settings set permission_mode='customized',default_access=$4,customized_sequence=$5,updated_timestamp=now() where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, resourceType, resourceID, defaultAccess, sequence); err != nil {
			return ResourcePermissionPolicy{}, nil, err
		}
		if _, err := tx.ExecContext(ctx, `delete from resource_permissions where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, resourceType, resourceID); err != nil {
			return ResourcePermissionPolicy{}, nil, err
		}
		for _, permission := range normalized {
			if _, err := tx.ExecContext(ctx, `insert into resource_permissions(company_id,resource_type,resource_id,subject_type,subject_id,access_level,created_timestamp,updated_timestamp) values($1::uuid,$2,$3::uuid,$4,$5::uuid,$6,now(),now())`, companyID, resourceType, resourceID, permission.SubjectType, permission.SubjectID, permission.AccessLevel); err != nil {
				return ResourcePermissionPolicy{}, nil, err
			}
		}
	}
	if action == PolicyDescendantActionIncludingCustomized {
		if err := tx.QueryRowContext(ctx, `select nextval('resource_permission_change_sequence')`).Scan(&resultingSequence); err != nil {
			return ResourcePermissionPolicy{}, nil, err
		}
		if _, err := tx.ExecContext(ctx, `update resource_permission_settings set descendant_reset_sequence=$4,updated_timestamp=now() where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, resourceType, resourceID, resultingSequence); err != nil {
			return ResourcePermissionPolicy{}, nil, err
		}
	}
	after, err := postgresV2PermissionPolicy(ctx, tx, companyID, resourceType, resourceID)
	if err != nil {
		return ResourcePermissionPolicy{}, nil, err
	}
	eventInput := DomainEventInput{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID,
		Type: v2PermissionEventType(resourceType), ActorUserID: strings.TrimSpace(input.ActorUserID), IdempotencyKey: strings.TrimSpace(input.IdempotencyKey),
		Payload: v2PolicyEventPayload(resourceType, resourceID, map[string]any{"policy_type": "permission", "permission_mode": mode, "action": action, "descendant_action": action, "sequence": resultingSequence})}
	event, err := r.appendDomainEventTx(ctx, tx, eventInput)
	if err != nil {
		return ResourcePermissionPolicy{}, nil, err
	}
	if err := tx.Commit(); err != nil {
		return ResourcePermissionPolicy{}, nil, err
	}
	return after, []domain.DomainEvent{event}, nil
}

func normalizeV2EntityPermissionInputs(inputs []EntityPermissionInput) ([]resourcePermissionAssignment, error) {
	seen := map[string]bool{}
	items := make([]resourcePermissionAssignment, 0, len(inputs))
	for _, input := range inputs {
		subjectType, ok := NormalizeEntityPermissionSubjectType(input.SubjectType)
		subjectID := cleanUUIDText(input.SubjectID)
		accessLevel, accessOK := NormalizeEntityPermission(input.AccessLevel)
		if !accessOK {
			accessLevel, accessOK = NormalizeEntityPermission(input.Permission)
		}
		if !ok || !accessOK || subjectID == "" {
			return nil, ErrInvalid
		}
		item := resourcePermissionAssignment{SubjectType: subjectType, SubjectID: subjectID, AccessLevel: accessLevel}
		keyValue := resourcePermissionAssignmentKey(item)
		if seen[keyValue] {
			return nil, ErrInvalid
		}
		seen[keyValue] = true
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return resourcePermissionAssignmentKey(items[i]) < resourcePermissionAssignmentKey(items[j])
	})
	return items, nil
}

func v2PermissionEventType(resourceType string) string {
	switch resourceType {
	case EntityTypeNode:
		return "node_permissions_updated"
	case EntityTypeLogicGate:
		return "logic_gate_permissions_updated"
	case EntityTypeProject:
		return "project_permissions_updated"
	case EntityTypeCompanyExplorerFolder:
		return "company_explorer_folder_permissions_updated"
	case EntityTypeSharedInboxFolder, EntityTypeSharedInbox:
		return "shared_triage_access_updated"
	default:
		return "resource_permissions_updated"
	}
}

func (r *PostgresRepo) ResourcePolicyFingerprints(companyID, resourceType, resourceID, userID string) (ResourcePolicyFingerprints, error) {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	userID = cleanUUIDText(userID)
	resourceType, ok := NormalizeEntityType(resourceType)
	if companyID == "" || resourceID == "" || !ok {
		return ResourcePolicyFingerprints{}, ErrInvalid
	}
	var result ResourcePolicyFingerprints
	err := r.db.QueryRowContext(context.Background(), `
select mangorts_v2_gvic_policy_fingerprint($1::uuid,$2,$3::uuid),
       mangorts_v2_permission_policy_fingerprint($1::uuid,$2,$3::uuid,nullif($4,'')::uuid)`,
		companyID, resourceType, resourceID, userID).Scan(&result.GVIC, &result.Permission)
	if errors.Is(err, sql.ErrNoRows) {
		return ResourcePolicyFingerprints{}, ErrNotFound
	}
	return result, err
}
