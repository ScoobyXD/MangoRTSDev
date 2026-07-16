package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

type postgresResourceAccessQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func postgresResourceDefaultAccess(ctx context.Context, q postgresResourceAccessQueryer, companyID, resourceType, resourceID string) (string, error) {
	policy, err := postgresResolvedResourceAccessPolicy(ctx, q, companyID, resourceType, resourceID)
	if err != nil {
		return "", err
	}
	return policy.DefaultAccess, nil
}

func postgresDirectResourceDefaultAccess(ctx context.Context, q postgresResourceAccessQueryer, companyID, resourceType, resourceID string) (string, error) {
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
	case EntityTypeProject:
		err = q.QueryRowContext(ctx, `
select coalesce(default_access, $3)
from projects
where company_id=$1::uuid and project_id=$2::uuid`, companyID, resourceID, ResourceDefaultAccessEdit).Scan(&access)
	case EntityTypeCompanyExplorerFolder:
		err = q.QueryRowContext(ctx, `
select coalesce(default_access, $3)
from company_explorer_folders
where company_id=$1::uuid and folder_id=$2::uuid`, companyID, resourceID, ResourceDefaultAccessEdit).Scan(&access)
	case EntityTypeSharedInboxFolder:
		err = q.QueryRowContext(ctx, `
select coalesce(default_access, $3)
from shared_inbox_folders
where company_id=$1::uuid and folder_id=$2::uuid`, companyID, resourceID, ResourceDefaultAccessEdit).Scan(&access)
	case EntityTypeSharedInbox:
		err = q.QueryRowContext(ctx, `
select coalesce(default_access, $3)
from shared_inboxes
where company_id=$1::uuid and shared_inbox_id=$2::uuid`, companyID, resourceID, ResourceDefaultAccessEdit).Scan(&access)
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
	case EntityTypeProject:
		res, err = tx.ExecContext(ctx, `
update projects
set default_access=$3
where company_id=$1::uuid and project_id=$2::uuid`, companyID, resourceID, defaultAccess)
	case EntityTypeCompanyExplorerFolder:
		res, err = tx.ExecContext(ctx, `
update company_explorer_folders
set default_access=$3,
    updated_timestamp=now()
where company_id=$1::uuid and folder_id=$2::uuid`, companyID, resourceID, defaultAccess)
	case EntityTypeSharedInboxFolder:
		res, err = tx.ExecContext(ctx, `
update shared_inbox_folders
set default_access=$3,
    updated_timestamp=now()
where company_id=$1::uuid and folder_id=$2::uuid`, companyID, resourceID, defaultAccess)
	case EntityTypeSharedInbox:
		res, err = tx.ExecContext(ctx, `
update shared_inboxes
set default_access=$3,
    updated_timestamp=now()
where company_id=$1::uuid and shared_inbox_id=$2::uuid`, companyID, resourceID, defaultAccess)
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

type resourcePermissionAssignment struct {
	SubjectType string
	SubjectID   string
	AccessLevel string
}

type resourcePermissionTarget struct {
	ResourceType string
	ResourceID   string
}

func insertPostgresResourceOverrideTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID, userID string) error {
	return insertPostgresResourcePermissionTx(ctx, tx, companyID, resourceType, resourceID, resourcePermissionAssignment{
		SubjectType: EntityPermissionSubjectUser,
		SubjectID:   userID,
		AccessLevel: OppositeResourceDefaultAccess(ResourceDefaultAccessEdit),
	})
}

func insertPostgresResourcePermissionTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string, assignment resourcePermissionAssignment) error {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	subjectID := cleanUUIDText(assignment.SubjectID)
	resourceType, ok := NormalizeEntityType(resourceType)
	subjectType, subjectOK := NormalizeEntityPermissionSubjectType(assignment.SubjectType)
	accessLevel, accessOK := NormalizeEntityPermission(assignment.AccessLevel)
	if ctx == nil || tx == nil || companyID == "" || resourceID == "" || subjectID == "" || !ok || !subjectOK || !accessOK || !usesDefaultResourceAccessPolicy(resourceType) {
		return ErrInvalid
	}
	var userID any
	if subjectType == EntityPermissionSubjectUser {
		userID = subjectID
	}
	_, err := tx.ExecContext(ctx, `
insert into resource_permissions (
  company_id,
  resource_type,
  resource_id,
  subject_type,
  subject_id,
  user_id,
  access_level,
  created_timestamp,
  updated_timestamp
)
values ($1::uuid, $2, $3::uuid, $4, $5::uuid, $6::uuid, $7, now(), now())
on conflict (company_id, resource_type, resource_id, subject_type, subject_id)
do update set user_id=excluded.user_id,
              access_level=excluded.access_level,
              updated_timestamp=now()`, companyID, resourceType, resourceID, subjectType, subjectID, userID, accessLevel)
	return err
}

func postgresActorCanMutateManagerOverrides(ctx context.Context, tx *sql.Tx, companyID, actorUserID string) (bool, error) {
	actorUserID = cleanUUIDText(actorUserID)
	if actorUserID == "" {
		return true, nil
	}
	var allowed bool
	err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_memberships
  where user_id=$1::uuid
    and (role='dev_admin' or (company_id=$2::uuid and role='company_admin'))
)`, actorUserID, companyID).Scan(&allowed)
	return allowed, err
}

func postgresResourcePermissionAssignmentsFromInput(ctx context.Context, tx *sql.Tx, input EntityPermissionUpdateInput, defaultAccess string, canMutateManagerOverrides bool) ([]resourcePermissionAssignment, error) {
	if ctx == nil || tx == nil {
		return nil, ErrInvalid
	}
	companyID := cleanUUIDText(input.CompanyID)
	entityType, ok := NormalizeEntityType(input.EntityType)
	if companyID == "" || !ok || !usesDefaultResourceAccessPolicy(entityType) {
		return nil, ErrInvalid
	}
	seen := map[string]int{}
	out := make([]resourcePermissionAssignment, 0, len(input.OverrideUserIDs)+len(input.Permissions))
	addAssignment := func(subjectType, subjectID, accessLevel string) error {
		subjectType, ok := NormalizeEntityPermissionSubjectType(subjectType)
		if !ok {
			return ErrInvalid
		}
		accessLevel, ok = NormalizeEntityPermission(accessLevel)
		if !ok {
			return ErrInvalid
		}
		subjectID = cleanUUIDText(subjectID)
		if subjectID == "" {
			return ErrInvalid
		}
		switch subjectType {
		case EntityPermissionSubjectUser:
			var role string
			err := tx.QueryRowContext(ctx, `
select role
from company_memberships
where company_id=$1::uuid and user_id=$2::uuid`, companyID, subjectID).Scan(&role)
			if errors.Is(err, sql.ErrNoRows) {
				return ErrPrincipalNotInCompany
			}
			if err != nil {
				return err
			}
			role = domain.NormalizeRole(role)
			if domain.CanBypassResourcePermissions(role) {
				return nil
			}
			if role == domain.RoleCompanyManager && !canMutateManagerOverrides {
				return nil
			}
		case EntityPermissionSubjectGroup:
			if !canMutateManagerOverrides {
				return ErrInvalid
			}
			exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from company_user_groups where company_id=$1::uuid and group_id=$2::uuid)`, companyID, subjectID)
			if err != nil {
				return err
			}
			if !exists {
				return ErrNotFound
			}
		default:
			return ErrInvalid
		}
		key := subjectType + ":" + subjectID
		assignment := resourcePermissionAssignment{SubjectType: subjectType, SubjectID: subjectID, AccessLevel: accessLevel}
		if index, ok := seen[key]; ok {
			out[index] = assignment
			return nil
		}
		seen[key] = len(out)
		out = append(out, assignment)
		return nil
	}
	addUser := func(userID string, accessLevel string) error {
		userID = cleanUUIDText(userID)
		return addAssignment(EntityPermissionSubjectUser, userID, accessLevel)
	}
	if len(input.OverrideUserIDs) > 0 && len(input.Permissions) == 0 {
		overrideAccess := OppositeResourceDefaultAccess(defaultAccess)
		for _, userID := range input.OverrideUserIDs {
			if err := addUser(userID, overrideAccess); err != nil {
				return nil, err
			}
		}
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
		subjectID := cleanUUIDText(permission.SubjectID)
		if subjectID == "" {
			return nil, ErrInvalid
		}
		if err := addAssignment(subjectType, subjectID, accessLevel); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func setPostgresResourceAccessPolicyTx(ctx context.Context, tx *sql.Tx, input EntityPermissionUpdateInput, entityType, entityID string) (int64, error) {
	if ctx == nil || tx == nil {
		return 0, ErrInvalid
	}
	companyID := cleanUUIDText(input.CompanyID)
	entityID = cleanUUIDText(entityID)
	entityType, ok := NormalizeEntityType(entityType)
	if companyID == "" || entityID == "" || !ok || !usesDefaultResourceAccessPolicy(entityType) {
		return 0, ErrInvalid
	}
	defaultAccess, err := postgresResourceDefaultAccess(ctx, tx, companyID, entityType, entityID)
	if err != nil {
		return 0, err
	}
	directDefaultAccess, err := postgresDirectResourceDefaultAccess(ctx, tx, companyID, entityType, entityID)
	if err != nil {
		return 0, err
	}
	oldDefaultAccess := defaultAccess
	canMutateManagerOverrides, err := postgresActorCanMutateManagerOverrides(ctx, tx, companyID, input.ActorUserID)
	if err != nil {
		return 0, err
	}
	defaultAccessChanged := false
	if input.DefaultAccessSet {
		defaultAccess, ok = NormalizeResourceDefaultAccess(input.DefaultAccess)
		if !ok {
			return 0, ErrInvalid
		}
		defaultAccessChanged = true
	} else if len(input.OverrideUserIDs) == 0 {
		inferredDefaultAccess, inferred, err := inferredResourceDefaultAccessFromPermissions(input.Permissions)
		if err != nil {
			return 0, err
		}
		if inferred {
			defaultAccess = inferredDefaultAccess
			defaultAccessChanged = true
		}
	}
	if defaultAccessChanged || directDefaultAccess != defaultAccess {
		if err := setPostgresResourceDefaultAccessTx(ctx, tx, companyID, entityType, entityID, defaultAccess); err != nil {
			return 0, err
		}
	}
	assignments, err := postgresResourcePermissionAssignmentsFromInput(ctx, tx, input, defaultAccess, canMutateManagerOverrides)
	if err != nil {
		return 0, err
	}
	if !canMutateManagerOverrides {
		preservedManagerAssignments, err := postgresPreservedManagerPermissionAssignments(ctx, tx, companyID, entityType, entityID, oldDefaultAccess, defaultAccess)
		if err != nil {
			return 0, err
		}
		seen := make(map[string]bool, len(assignments)+len(preservedManagerAssignments))
		for _, assignment := range assignments {
			seen[assignment.SubjectType+":"+assignment.SubjectID] = true
		}
		for _, assignment := range preservedManagerAssignments {
			key := assignment.SubjectType + ":" + assignment.SubjectID
			if !seen[key] {
				assignments = append(assignments, assignment)
				seen[key] = true
			}
		}
	}
	if err := deletePostgresResourceOverridesTx(ctx, tx, companyID, entityType, entityID); err != nil {
		return 0, err
	}
	for _, assignment := range assignments {
		if err := insertPostgresResourcePermissionTx(ctx, tx, companyID, entityType, entityID, assignment); err != nil {
			return 0, err
		}
	}
	policySequence, err := nextPostgresResourcePolicySequenceTx(ctx, tx)
	if err != nil {
		return 0, err
	}
	if err := setPostgresResourcePermissionPolicyRevisionTx(ctx, tx, companyID, entityType, entityID, policySequence); err != nil {
		return 0, err
	}
	return policySequence, nil
}

func postgresPreservedManagerPermissionAssignments(ctx context.Context, tx *sql.Tx, companyID, entityType, entityID, oldDefaultAccess, newDefaultAccess string) ([]resourcePermissionAssignment, error) {
	rows, err := tx.QueryContext(ctx, `
select membership.user_id::text,
       coalesce(access.access_level, '') as direct_access_level
from company_memberships membership
left join resource_permissions access
  on access.company_id=membership.company_id
 and access.resource_type=$2
 and access.resource_id=$3::uuid
 and access.subject_type='user'
 and access.subject_id=membership.user_id
where membership.company_id=$1::uuid
  and membership.role='company_manager'
order by membership.user_id::text`, companyID, entityType, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []resourcePermissionAssignment{}
	for rows.Next() {
		var userID string
		var directAccessLevel string
		if err := rows.Scan(&userID, &directAccessLevel); err != nil {
			return nil, err
		}
		effectiveAccess := oldDefaultAccess
		if directAccessLevel != "" {
			effectiveAccess = directAccessLevel
		}
		if effectiveAccess != newDefaultAccess {
			out = append(out, resourcePermissionAssignment{
				SubjectType: EntityPermissionSubjectUser,
				SubjectID:   userID,
				AccessLevel: effectiveAccess,
			})
		}
	}
	return out, rows.Err()
}

func postgresResourcePermissionAssignmentsTx(ctx context.Context, queryer postgresResourceAccessQueryer, companyID, resourceType, resourceID string) ([]resourcePermissionAssignment, error) {
	return postgresResolvedResourcePermissionAssignments(ctx, queryer, companyID, resourceType, resourceID)
}

func snapshotPostgresResourceAccessPolicyTx(ctx context.Context, tx *sql.Tx, companyID, sourceType, sourceID, targetType, targetID string) (bool, error) {
	companyID = cleanUUIDText(companyID)
	sourceID = cleanUUIDText(sourceID)
	targetID = cleanUUIDText(targetID)
	var ok bool
	sourceType, ok = NormalizeEntityType(sourceType)
	if !ok {
		return false, ErrInvalid
	}
	targetType, ok = NormalizeEntityType(targetType)
	if ctx == nil || tx == nil || companyID == "" || sourceID == "" || targetID == "" || !ok ||
		!usesDefaultResourceAccessPolicy(sourceType) || !usesDefaultResourceAccessPolicy(targetType) {
		return false, ErrInvalid
	}
	sourceDefaultAccess, err := postgresResourceDefaultAccess(ctx, tx, companyID, sourceType, sourceID)
	if err != nil {
		return false, err
	}
	targetDefaultAccess, err := postgresResourceDefaultAccess(ctx, tx, companyID, targetType, targetID)
	if err != nil {
		return false, err
	}
	sourceAssignments, err := postgresResourcePermissionAssignmentsTx(ctx, tx, companyID, sourceType, sourceID)
	if err != nil {
		return false, err
	}
	targetAssignments, err := postgresResourcePermissionAssignmentsTx(ctx, tx, companyID, targetType, targetID)
	if err != nil {
		return false, err
	}
	if sourceDefaultAccess == targetDefaultAccess && orderedResourcePermissionAssignmentsEqual(sourceAssignments, targetAssignments) {
		return false, nil
	}
	if err := setPostgresResourceDefaultAccessTx(ctx, tx, companyID, targetType, targetID, sourceDefaultAccess); err != nil {
		return false, err
	}
	if err := deletePostgresResourceOverridesTx(ctx, tx, companyID, targetType, targetID); err != nil {
		return false, err
	}
	for _, assignment := range sourceAssignments {
		if err := insertPostgresResourcePermissionTx(ctx, tx, companyID, targetType, targetID, assignment); err != nil {
			return false, err
		}
	}
	policySequence, err := nextPostgresResourcePolicySequenceTx(ctx, tx)
	if err != nil {
		return false, err
	}
	if err := setPostgresResourcePermissionPolicyRevisionTx(ctx, tx, companyID, targetType, targetID, policySequence); err != nil {
		return false, err
	}
	if err := recomputeDirectGrantEffectiveAccessForResourceTx(ctx, tx, companyID, targetType, targetID); err != nil {
		return false, err
	}
	if targetType == EntityTypeLogicGate {
		if err := recomputeLogicGateAssignedNodeVisibilityTx(ctx, tx, companyID, []string{targetID}, nil); err != nil {
			return false, err
		}
	}
	return true, nil
}

func orderedStringSlicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func orderedResourcePermissionAssignmentsEqual(left, right []resourcePermissionAssignment) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func resourcePermissionAssignmentKey(assignment resourcePermissionAssignment) string {
	return assignment.SubjectType + ":" + assignment.SubjectID
}

func resourcePermissionAssignmentMap(assignments []resourcePermissionAssignment) map[string]resourcePermissionAssignment {
	out := make(map[string]resourcePermissionAssignment, len(assignments))
	for _, assignment := range assignments {
		out[resourcePermissionAssignmentKey(assignment)] = assignment
	}
	return out
}

func postgresResourcePermissionDescendantTargetsTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) ([]resourcePermissionTarget, error) {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, ok := NormalizeEntityType(resourceType)
	if ctx == nil || tx == nil || companyID == "" || resourceID == "" || !ok {
		return nil, ErrInvalid
	}
	var rows *sql.Rows
	var err error
	switch resourceType {
	case EntityTypeCompanyExplorerFolder:
		rows, err = tx.QueryContext(ctx, `
with recursive folder_scope(folder_id, is_root, path) as (
  select folder.folder_id, true, array[folder.folder_id]
  from company_explorer_folders folder
  where folder.company_id=$1::uuid
    and folder.folder_id=$2::uuid
  union all
  select child.folder_id, false, folder_scope.path || child.folder_id
  from folder_scope
  join company_explorer_folders child
    on child.company_id=$1::uuid
   and child.parent_folder_id=folder_scope.folder_id
  where not child.folder_id = any(folder_scope.path)
),
direct_targets(resource_type, resource_id) as (
  select '`+EntityTypeCompanyExplorerFolder+`'::text, folder_id
  from folder_scope
  where not is_root
  union
  select item.target_type, item.target_id
  from company_explorer_items item
  join folder_scope
    on folder_scope.folder_id=item.parent_folder_id
  where item.company_id=$1::uuid
    and item.target_type in ('`+EntityTypeProject+`', '`+EntityTypeLogicGate+`', '`+EntityTypeNode+`')
    and not (
      item.target_type='`+EntityTypeNode+`'
      and exists (
        select 1 from communications_email_collaborations collaboration
        where collaboration.company_id=item.company_id
          and collaboration.node_id=item.target_id
      )
    )
),
node_targets(resource_type, resource_id) as (
  select '`+EntityTypeNode+`'::text, assignment.node_id
  from node_logic_gate_assignments assignment
  join direct_targets target
    on target.resource_type='`+EntityTypeLogicGate+`'
   and target.resource_id=assignment.logic_gate_id
  where assignment.company_id=$1::uuid
    and not exists (
      select 1 from communications_email_collaborations collaboration
      where collaboration.company_id=assignment.company_id
        and collaboration.node_id=assignment.node_id
    )
)
select distinct resource_type, resource_id::text
from (
  select resource_type, resource_id from direct_targets
  union all
  select resource_type, resource_id from node_targets
) target
order by resource_type, resource_id::text`, companyID, resourceID)
	case EntityTypeLogicGate:
		rows, err = tx.QueryContext(ctx, `
select distinct '`+EntityTypeNode+`'::text as resource_type, assignment.node_id::text as resource_id
from node_logic_gate_assignments assignment
where assignment.company_id=$1::uuid
  and assignment.logic_gate_id=$2::uuid
  and not exists (
    select 1 from communications_email_collaborations collaboration
    where collaboration.company_id=assignment.company_id
      and collaboration.node_id=assignment.node_id
  )
order by assignment.node_id::text`, companyID, resourceID)
	default:
		return []resourcePermissionTarget{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	targets := []resourcePermissionTarget{}
	for rows.Next() {
		var target resourcePermissionTarget
		if err := rows.Scan(&target.ResourceType, &target.ResourceID); err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	return targets, rows.Err()
}

func forEachResourcePermissionTargetChunk(targets []resourcePermissionTarget, size int, fn func([]resourcePermissionTarget) error) error {
	if size <= 0 {
		size = 1000
	}
	for start := 0; start < len(targets); start += size {
		end := start + size
		if end > len(targets) {
			end = len(targets)
		}
		if err := fn(targets[start:end]); err != nil {
			return err
		}
	}
	return nil
}

func resourcePermissionTargetLists(targets []resourcePermissionTarget) (string, string) {
	resourceTypes := make([]string, 0, len(targets))
	resourceIDs := make([]string, 0, len(targets))
	for _, target := range targets {
		resourceTypes = append(resourceTypes, target.ResourceType)
		resourceIDs = append(resourceIDs, target.ResourceID)
	}
	return strings.Join(resourceTypes, ","), strings.Join(resourceIDs, ",")
}

func setPostgresResourceDefaultAccessForTargetsTx(ctx context.Context, tx *sql.Tx, companyID string, targets []resourcePermissionTarget, defaultAccess string) error {
	targetsByType := map[string][]string{}
	for _, target := range targets {
		resourceType, ok := NormalizeEntityType(target.ResourceType)
		resourceID := cleanUUIDText(target.ResourceID)
		if !ok || resourceID == "" || !usesDefaultResourceAccessPolicy(resourceType) {
			continue
		}
		targetsByType[resourceType] = append(targetsByType[resourceType], resourceID)
	}
	for resourceType, resourceIDs := range targetsByType {
		for start := 0; start < len(resourceIDs); start += 1000 {
			end := start + 1000
			if end > len(resourceIDs) {
				end = len(resourceIDs)
			}
			idList := strings.Join(resourceIDs[start:end], ",")
			var sqlText string
			switch resourceType {
			case EntityTypeNode:
				sqlText = `update nodes set default_access=$3 where company_id=$1::uuid and node_id = any(string_to_array($2, ',')::uuid[])`
			case EntityTypeLogicGate:
				sqlText = `update logic_gates set default_access=$3 where company_id=$1::uuid and logic_gate_id = any(string_to_array($2, ',')::uuid[])`
			case EntityTypeProject:
				sqlText = `update projects set default_access=$3 where company_id=$1::uuid and project_id = any(string_to_array($2, ',')::uuid[])`
			case EntityTypeCompanyExplorerFolder:
				sqlText = `update company_explorer_folders set default_access=$3, updated_timestamp=now() where company_id=$1::uuid and folder_id = any(string_to_array($2, ',')::uuid[])`
			case EntityTypeSharedInboxFolder:
				sqlText = `update shared_inbox_folders set default_access=$3, updated_timestamp=now() where company_id=$1::uuid and folder_id = any(string_to_array($2, ',')::uuid[])`
			case EntityTypeSharedInbox:
				sqlText = `update shared_inboxes set default_access=$3, updated_timestamp=now() where company_id=$1::uuid and shared_inbox_id = any(string_to_array($2, ',')::uuid[])`
			default:
				continue
			}
			if _, err := tx.ExecContext(ctx, sqlText, companyID, idList, defaultAccess); err != nil {
				return err
			}
		}
	}
	return nil
}

func upsertPostgresResourcePermissionForTargetsTx(ctx context.Context, tx *sql.Tx, companyID string, targets []resourcePermissionTarget, assignment resourcePermissionAssignment) error {
	if len(targets) == 0 {
		return nil
	}
	subjectType, ok := NormalizeEntityPermissionSubjectType(assignment.SubjectType)
	accessLevel, accessOK := NormalizeEntityPermission(assignment.AccessLevel)
	subjectID := cleanUUIDText(assignment.SubjectID)
	if !ok || !accessOK || subjectID == "" {
		return ErrInvalid
	}
	var userID any
	if subjectType == EntityPermissionSubjectUser {
		userID = subjectID
	}
	return forEachResourcePermissionTargetChunk(targets, 1000, func(chunk []resourcePermissionTarget) error {
		resourceTypes, resourceIDs := resourcePermissionTargetLists(chunk)
		_, err := tx.ExecContext(ctx, `
with target(resource_type, resource_id) as (
  select *
  from unnest(string_to_array($4, ',')::text[], string_to_array($5, ',')::uuid[])
)
insert into resource_permissions (
  company_id,
  resource_type,
  resource_id,
  subject_type,
  subject_id,
  user_id,
  access_level,
  created_timestamp,
  updated_timestamp
)
select $1::uuid,
       target.resource_type,
       target.resource_id,
       $2,
       $3::uuid,
       $6::uuid,
       $7,
       now(),
       now()
from target
on conflict (company_id, resource_type, resource_id, subject_type, subject_id)
do update set user_id=excluded.user_id,
              access_level=excluded.access_level,
              updated_timestamp=now()`, companyID, subjectType, subjectID, resourceTypes, resourceIDs, userID, accessLevel)
		return err
	})
}

func deletePostgresResourcePermissionForTargetsTx(ctx context.Context, tx *sql.Tx, companyID string, targets []resourcePermissionTarget, assignment resourcePermissionAssignment) error {
	if len(targets) == 0 {
		return nil
	}
	subjectType, ok := NormalizeEntityPermissionSubjectType(assignment.SubjectType)
	subjectID := cleanUUIDText(assignment.SubjectID)
	if !ok || subjectID == "" {
		return ErrInvalid
	}
	return forEachResourcePermissionTargetChunk(targets, 1000, func(chunk []resourcePermissionTarget) error {
		resourceTypes, resourceIDs := resourcePermissionTargetLists(chunk)
		_, err := tx.ExecContext(ctx, `
with target(resource_type, resource_id) as (
  select *
  from unnest(string_to_array($4, ',')::text[], string_to_array($5, ',')::uuid[])
)
delete from resource_permissions access
using target
where access.company_id=$1::uuid
  and access.subject_type=$2
  and access.subject_id=$3::uuid
  and access.resource_type=target.resource_type
  and access.resource_id=target.resource_id`, companyID, subjectType, subjectID, resourceTypes, resourceIDs)
		return err
	})
}

func applyPostgresResourcePermissionPolicyToDescendantsTx(ctx context.Context, tx *sql.Tx, input EntityPermissionUpdateInput, policySequence int64, beforeDefault string, beforeAssignments []resourcePermissionAssignment, afterDefault string, afterAssignments []resourcePermissionAssignment) ([]resourcePermissionTarget, error) {
	if !input.ApplyToDescendants {
		return []resourcePermissionTarget{}, nil
	}
	companyID := cleanUUIDText(input.CompanyID)
	resourceID := cleanUUIDText(input.EntityID)
	resourceType, ok := NormalizeEntityType(input.EntityType)
	if companyID == "" || resourceID == "" || !ok {
		return nil, ErrInvalid
	}
	targets, err := postgresResourcePermissionDescendantTargetsTx(ctx, tx, companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	if len(targets) == 0 {
		return targets, nil
	}
	if _, err := postgresRecordPermissionSubtreeApplicationsTx(ctx, tx, companyID, resourceType, resourceID, policySequence, beforeDefault, beforeAssignments, afterDefault, afterAssignments); err != nil {
		return nil, err
	}
	return targets, nil
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
  when (select allowed from admin_actor) then 'edit'
  when mangorts_user_can_access_resource($1::uuid, $3::text, $4::uuid, $2::uuid, 'edit') then 'edit'
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
