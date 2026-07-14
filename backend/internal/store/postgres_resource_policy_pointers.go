package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

type resolvedPostgresResourceAccessPolicy struct {
	DefaultAccess string
	Assignments   []resourcePermissionAssignment
}

const postgresResourcePolicyAncestorsCTE = `
node_logic_gate_ancestors(logic_gate_id) as (
  select assignment.logic_gate_id
  from node_logic_gate_assignments assignment
  join requested req
    on req.resource_type='node'
   and assignment.company_id=req.company_id
   and assignment.node_id=req.resource_id
  where not exists (
    select 1
    from communications_email_collaborations collaboration
    where collaboration.company_id=req.company_id
      and collaboration.node_id=req.resource_id
  )
),
folder_seeds(folder_id) as (
  select folder.parent_folder_id
  from company_explorer_folders folder
  join requested req
    on req.resource_type='company_explorer_folder'
   and folder.company_id=req.company_id
   and folder.folder_id=req.resource_id
  where folder.parent_folder_id is not null
  union
  select item.parent_folder_id
  from company_explorer_items item
  join requested req
    on item.company_id=req.company_id
   and item.target_type=req.resource_type
   and item.target_id=req.resource_id
  where req.resource_type in ('project', 'logic_gate')
  union
  select item.parent_folder_id
  from company_explorer_items item
  join requested req
    on req.resource_type='node'
   and item.company_id=req.company_id
  join node_logic_gate_ancestors gate
    on item.target_type='logic_gate'
   and item.target_id=gate.logic_gate_id
),
folder_ancestors(folder_id, path) as (
  select folder_id, array[folder_id]
  from folder_seeds
  union all
  select parent.parent_folder_id, folder_ancestors.path || parent.parent_folder_id
  from folder_ancestors
  join requested req on true
  join company_explorer_folders parent
    on parent.company_id=req.company_id
   and parent.folder_id=folder_ancestors.folder_id
  where parent.parent_folder_id is not null
    and not parent.parent_folder_id = any(folder_ancestors.path)
),
resource_policy_ancestors(resource_type, resource_id) as (
  select 'logic_gate'::text, logic_gate_id
  from node_logic_gate_ancestors
  union
  select 'company_explorer_folder'::text, folder_id
  from folder_ancestors
)`

const postgresGVICPolicyAncestorsCTE = `
node_logic_gate_ancestors(logic_gate_id) as (
  select assignment.logic_gate_id
  from node_logic_gate_assignments assignment
  join requested req
    on req.resource_type='node'
   and assignment.company_id=req.company_id
   and assignment.node_id=req.resource_id
),
resource_policy_ancestors(resource_type, resource_id) as (
  select 'logic_gate'::text, logic_gate_id
  from node_logic_gate_ancestors
)`

func nextPostgresResourcePolicySequenceTx(ctx context.Context, tx *sql.Tx) (int64, error) {
	if ctx == nil || tx == nil {
		return 0, ErrInvalid
	}
	var sequence int64
	err := tx.QueryRowContext(ctx, `select nextval('resource_policy_sequence')`).Scan(&sequence)
	return sequence, err
}

func setPostgresResourcePermissionPolicyRevisionTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string, sequence int64) error {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, ok := NormalizeEntityType(resourceType)
	if ctx == nil || tx == nil || companyID == "" || resourceID == "" || !ok || sequence <= 0 {
		return ErrInvalid
	}
	_, err := tx.ExecContext(ctx, `
insert into resource_permission_policy_revisions (
  company_id,
  resource_type,
  resource_id,
  policy_sequence,
  updated_timestamp
) values ($1::uuid, $2, $3::uuid, $4, now())
on conflict (company_id, resource_type, resource_id)
do update set policy_sequence=excluded.policy_sequence,
              updated_timestamp=now()`, companyID, resourceType, resourceID, sequence)
	return err
}

func setPostgresResourceGVICPolicyRevisionTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string, sequence int64) error {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, ok := NormalizeGVICResourceType(resourceType)
	if ctx == nil || tx == nil || companyID == "" || resourceID == "" || !ok || sequence <= 0 {
		return ErrInvalid
	}
	_, err := tx.ExecContext(ctx, `
insert into resource_gvic_policy_revisions (
  company_id,
  resource_type,
  resource_id,
  policy_sequence,
  updated_timestamp
) values ($1::uuid, $2, $3::uuid, $4, now())
on conflict (company_id, resource_type, resource_id)
do update set policy_sequence=excluded.policy_sequence,
              updated_timestamp=now()`, companyID, resourceType, resourceID, sequence)
	return err
}

func postgresResolvedResourceAccessPolicy(ctx context.Context, queryer postgresResourceAccessQueryer, companyID, resourceType, resourceID string) (resolvedPostgresResourceAccessPolicy, error) {
	defaultAccess, err := postgresDirectResourceDefaultAccess(ctx, queryer, companyID, resourceType, resourceID)
	if err != nil {
		return resolvedPostgresResourceAccessPolicy{}, err
	}
	resolvedDefault, err := postgresResolvedResourceDefaultAccess(ctx, queryer, companyID, resourceType, resourceID, defaultAccess)
	if err != nil {
		return resolvedPostgresResourceAccessPolicy{}, err
	}
	assignments, err := postgresResolvedResourcePermissionAssignments(ctx, queryer, companyID, resourceType, resourceID)
	if err != nil {
		return resolvedPostgresResourceAccessPolicy{}, err
	}
	return resolvedPostgresResourceAccessPolicy{DefaultAccess: resolvedDefault, Assignments: assignments}, nil
}

func postgresResolvedResourceDefaultAccess(ctx context.Context, queryer postgresResourceAccessQueryer, companyID, resourceType, resourceID, directDefaultAccess string) (string, error) {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, ok := NormalizeEntityType(resourceType)
	directDefaultAccess = defaultResourceAccessOrEdit(directDefaultAccess)
	if ctx == nil || queryer == nil || companyID == "" || resourceID == "" || !ok || !usesDefaultResourceAccessPolicy(resourceType) {
		return "", ErrInvalid
	}
	var defaultAccess string
	err := queryer.QueryRowContext(ctx, `
with recursive requested(company_id, resource_type, resource_id) as (
  select $1::uuid, $2::text, $3::uuid
),
direct_sequence(policy_sequence) as (
  select coalesce((
    select revision.policy_sequence
    from resource_permission_policy_revisions revision
    join requested req
      on revision.company_id=req.company_id
     and revision.resource_type=req.resource_type
     and revision.resource_id=req.resource_id
  ), 0)
),
`+postgresResourcePolicyAncestorsCTE+`,
latest_default_application as (
  select app.access_level
  from resource_permission_subtree_applications app
  join resource_policy_ancestors ancestor
    on ancestor.resource_type=app.ancestor_resource_type
   and ancestor.resource_id=app.ancestor_resource_id
  join requested req on app.company_id=req.company_id
  join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
  where app.rule_key=$5
  order by app.policy_sequence desc, app.application_id desc
  limit 1
)
select coalesce((select access_level from latest_default_application), $4)`, companyID, resourceType, resourceID, directDefaultAccess, resourcePermissionDefaultRuleKey).Scan(&defaultAccess)
	if err != nil {
		return "", err
	}
	return defaultResourceAccessOrEdit(defaultAccess), nil
}

func postgresResolvedResourcePermissionAssignments(ctx context.Context, queryer postgresResourceAccessQueryer, companyID, resourceType, resourceID string) ([]resourcePermissionAssignment, error) {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, ok := NormalizeEntityType(resourceType)
	if ctx == nil || queryer == nil || companyID == "" || resourceID == "" || !ok || !usesDefaultResourceAccessPolicy(resourceType) {
		return nil, ErrInvalid
	}
	rows, err := queryer.QueryContext(ctx, `
with recursive requested(company_id, resource_type, resource_id) as (
  select $1::uuid, $2::text, $3::uuid
),
direct_sequence(policy_sequence) as (
  select coalesce((
    select revision.policy_sequence
    from resource_permission_policy_revisions revision
    join requested req
      on revision.company_id=req.company_id
     and revision.resource_type=req.resource_type
     and revision.resource_id=req.resource_id
  ), 0)
),
`+postgresResourcePolicyAncestorsCTE+`,
direct_assignments as (
  select access.subject_type,
         access.subject_id,
         access.access_level,
         access.subject_type || ':' || access.subject_id::text as rule_key
  from resource_permissions access
  join requested req
    on access.company_id=req.company_id
   and access.resource_type=req.resource_type
   and access.resource_id=req.resource_id
),
application_rules as (
  select distinct on (app.rule_key)
         app.rule_key,
         app.subject_type,
         app.subject_id,
         app.access_level,
         app.deleted
  from resource_permission_subtree_applications app
  join resource_policy_ancestors ancestor
    on ancestor.resource_type=app.ancestor_resource_type
   and ancestor.resource_id=app.ancestor_resource_id
  join requested req on app.company_id=req.company_id
  join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
  where app.rule_key<>$4
  order by app.rule_key, app.policy_sequence desc, app.application_id desc
),
merged_assignments as (
  select direct.subject_type, direct.subject_id, direct.access_level
  from direct_assignments direct
  where not exists (
    select 1
    from application_rules app
    where app.rule_key=direct.rule_key
  )
  union all
  select app.subject_type, app.subject_id, app.access_level
  from application_rules app
  where not app.deleted
)
select subject_type, subject_id::text, access_level
from merged_assignments
where subject_type in ('user', 'group')
  and subject_id is not null
  and access_level is not null
order by subject_type, subject_id::text`, companyID, resourceType, resourceID, resourcePermissionDefaultRuleKey)
	if err != nil {
		return nil, err
	}
	assignments := []resourcePermissionAssignment{}
	for rows.Next() {
		var assignment resourcePermissionAssignment
		if err := rows.Scan(&assignment.SubjectType, &assignment.SubjectID, &assignment.AccessLevel); err != nil {
			rows.Close()
			return nil, err
		}
		assignments = append(assignments, assignment)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	sort.Slice(assignments, func(i, j int) bool {
		if assignments[i].SubjectType != assignments[j].SubjectType {
			return assignments[i].SubjectType < assignments[j].SubjectType
		}
		return assignments[i].SubjectID < assignments[j].SubjectID
	})
	return assignments, nil
}

func insertPostgresResourcePermissionSubtreeApplicationTx(ctx context.Context, tx *sql.Tx, companyID, ancestorType, ancestorID string, sequence int64, ruleKey, subjectType, subjectID, accessLevel string, deleted bool) error {
	companyID = cleanUUIDText(companyID)
	ancestorID = cleanUUIDText(ancestorID)
	ancestorType, ok := NormalizeEntityType(ancestorType)
	if ctx == nil || tx == nil || companyID == "" || ancestorID == "" || !ok || sequence <= 0 || strings.TrimSpace(ruleKey) == "" {
		return ErrInvalid
	}
	var subjectIDValue any
	var subjectTypeValue any
	var accessLevelValue any
	if subjectType != "" || subjectID != "" {
		normalizedSubjectType, subjectOK := NormalizeEntityPermissionSubjectType(subjectType)
		cleanSubjectID := cleanUUIDText(subjectID)
		if !subjectOK || cleanSubjectID == "" {
			return ErrInvalid
		}
		subjectTypeValue = normalizedSubjectType
		subjectIDValue = cleanSubjectID
	}
	if accessLevel != "" {
		normalizedAccess, accessOK := NormalizeEntityPermission(accessLevel)
		if !accessOK {
			return ErrInvalid
		}
		accessLevelValue = normalizedAccess
	}
	_, err := tx.ExecContext(ctx, `
insert into resource_permission_subtree_applications (
  policy_sequence,
  company_id,
  ancestor_resource_type,
  ancestor_resource_id,
  rule_key,
  subject_type,
  subject_id,
  access_level,
  deleted,
  created_timestamp
) values ($1, $2::uuid, $3, $4::uuid, $5, $6, $7::uuid, $8, $9, now())`,
		sequence,
		companyID,
		ancestorType,
		ancestorID,
		ruleKey,
		subjectTypeValue,
		subjectIDValue,
		accessLevelValue,
		deleted,
	)
	return err
}

func postgresRecordPermissionSubtreeApplicationsTx(ctx context.Context, tx *sql.Tx, companyID, ancestorType, ancestorID string, sequence int64, beforeDefault string, beforeAssignments []resourcePermissionAssignment, afterDefault string, afterAssignments []resourcePermissionAssignment) (bool, error) {
	changed := false
	if beforeDefault != afterDefault {
		if err := insertPostgresResourcePermissionSubtreeApplicationTx(ctx, tx, companyID, ancestorType, ancestorID, sequence, resourcePermissionDefaultRuleKey, "", "", afterDefault, false); err != nil {
			return false, err
		}
		changed = true
	}
	beforeByKey := resourcePermissionAssignmentMap(beforeAssignments)
	afterByKey := resourcePermissionAssignmentMap(afterAssignments)
	for ruleKey, before := range beforeByKey {
		if _, ok := afterByKey[ruleKey]; ok {
			continue
		}
		if err := insertPostgresResourcePermissionSubtreeApplicationTx(ctx, tx, companyID, ancestorType, ancestorID, sequence, ruleKey, before.SubjectType, before.SubjectID, "", true); err != nil {
			return false, err
		}
		changed = true
	}
	for ruleKey, after := range afterByKey {
		if before, ok := beforeByKey[ruleKey]; ok && before == after {
			continue
		}
		if err := insertPostgresResourcePermissionSubtreeApplicationTx(ctx, tx, companyID, ancestorType, ancestorID, sequence, ruleKey, after.SubjectType, after.SubjectID, after.AccessLevel, false); err != nil {
			return false, err
		}
		changed = true
	}
	return changed, nil
}

func insertPostgresGVICSubtreeApplicationTx(ctx context.Context, tx *sql.Tx, companyID, ancestorType, ancestorID string, sequence int64, role, principalType, principalID string, deleted bool) error {
	companyID = cleanUUIDText(companyID)
	ancestorID = cleanUUIDText(ancestorID)
	ancestorType, ok := NormalizeGVICResourceType(ancestorType)
	role, roleOK := NormalizeGVICRole(role)
	principalType, principalOK := NormalizeGVICPrincipalType(principalType)
	principalID = cleanUUIDText(principalID)
	if ctx == nil || tx == nil || companyID == "" || ancestorID == "" || !ok || sequence <= 0 || !roleOK || !principalOK || principalID == "" {
		return ErrInvalid
	}
	_, err := tx.ExecContext(ctx, `
insert into resource_gvic_subtree_applications (
  policy_sequence,
  company_id,
  ancestor_resource_type,
  ancestor_resource_id,
  role,
  principal_type,
  principal_id,
  deleted,
  created_timestamp
) values ($1, $2::uuid, $3, $4::uuid, $5, $6, $7::uuid, $8, now())`,
		sequence,
		companyID,
		ancestorType,
		ancestorID,
		role,
		principalType,
		principalID,
		deleted,
	)
	return err
}

func postgresRecordGVICSubtreeApplicationsTx(ctx context.Context, tx *sql.Tx, companyID, ancestorType, ancestorID string, sequence int64, beforeAssignments, afterAssignments []domain.ResourceGVICAssignment) (bool, error) {
	beforeByKey := map[string]domain.ResourceGVICAssignment{}
	for _, assignment := range beforeAssignments {
		beforeByKey[gvicRuleKey(assignment.Role, assignment.PrincipalType, assignment.PrincipalID)] = assignment
	}
	afterByKey := map[string]domain.ResourceGVICAssignment{}
	for _, assignment := range afterAssignments {
		afterByKey[gvicRuleKey(assignment.Role, assignment.PrincipalType, assignment.PrincipalID)] = assignment
	}
	changed := false
	for ruleKey, before := range beforeByKey {
		if _, ok := afterByKey[ruleKey]; ok {
			continue
		}
		if err := insertPostgresGVICSubtreeApplicationTx(ctx, tx, companyID, ancestorType, ancestorID, sequence, before.Role, before.PrincipalType, before.PrincipalID, true); err != nil {
			return false, err
		}
		changed = true
	}
	for ruleKey, after := range afterByKey {
		if _, ok := beforeByKey[ruleKey]; ok {
			continue
		}
		if err := insertPostgresGVICSubtreeApplicationTx(ctx, tx, companyID, ancestorType, ancestorID, sequence, after.Role, after.PrincipalType, after.PrincipalID, false); err != nil {
			return false, err
		}
		changed = true
	}
	return changed, nil
}

func postgresResolvedResourceGVICAssignmentsForResource(ctx context.Context, queryer postgresGVICQueryer, keyValue resourceGVICKey) ([]domain.ResourceGVICAssignment, error) {
	rows, err := queryer.QueryContext(ctx, `
with requested(company_id, resource_type, resource_id) as (
  select $1::uuid, $2::text, $3::uuid
),
direct_sequence(policy_sequence) as (
  select coalesce((
    select revision.policy_sequence
    from resource_gvic_policy_revisions revision
    join requested req
      on revision.company_id=req.company_id
     and revision.resource_type=req.resource_type
     and revision.resource_id=req.resource_id
  ), 0)
),
`+postgresGVICPolicyAncestorsCTE+`,
direct_assignments as (
  select assignment.role,
         assignment.principal_type,
         assignment.principal_id,
         assignment.created_timestamp,
         assignment.updated_timestamp,
         assignment.role || ':' || assignment.principal_type || ':' || assignment.principal_id::text as rule_key
  from resource_gvic_assignments assignment
  join requested req
    on assignment.company_id=req.company_id
   and assignment.resource_type=req.resource_type
   and assignment.resource_id=req.resource_id
),
application_rules as (
  select distinct on (app.role, app.principal_type, app.principal_id)
         app.role,
         app.principal_type,
         app.principal_id,
         app.deleted,
         app.created_timestamp,
         app.created_timestamp as updated_timestamp,
         app.role || ':' || app.principal_type || ':' || app.principal_id::text as rule_key
  from resource_gvic_subtree_applications app
  join resource_policy_ancestors ancestor
    on ancestor.resource_type=app.ancestor_resource_type
   and ancestor.resource_id=app.ancestor_resource_id
  join requested req on app.company_id=req.company_id
  join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
  order by app.role, app.principal_type, app.principal_id, app.policy_sequence desc, app.application_id desc
),
merged_assignments as (
  select direct.role, direct.principal_type, direct.principal_id, direct.created_timestamp, direct.updated_timestamp
  from direct_assignments direct
  where not exists (
    select 1
    from application_rules app
    where app.rule_key=direct.rule_key
  )
  union all
  select app.role, app.principal_type, app.principal_id, app.created_timestamp, app.updated_timestamp
  from application_rules app
  where not app.deleted
)
select
  req.company_id::text,
  req.resource_type,
  req.resource_id::text,
  assignment.role,
  assignment.principal_type,
  assignment.principal_id::text,
  coalesce(nullif(user_group.name, ''), nullif(app_user.display_name, ''), nullif(app_user.email, '')),
  coalesce(app_user.user_id::text, ''),
  nullif(app_user.display_name, ''),
  nullif(app_user.email, ''),
  assignment.created_timestamp,
  assignment.updated_timestamp
from requested req
join merged_assignments assignment on true
left join users app_user
  on assignment.principal_type='user'
 and app_user.user_id=assignment.principal_id
left join company_user_groups user_group
  on assignment.principal_type='group'
 and user_group.company_id=req.company_id
 and user_group.group_id=assignment.principal_id
order by assignment.role,
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
