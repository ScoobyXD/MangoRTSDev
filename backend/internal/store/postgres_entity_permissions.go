package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

func scanCompanyUserGroup(row interface{ Scan(dest ...any) error }) (domain.CompanyUserGroup, error) {
	var item domain.CompanyUserGroup
	var parent sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.GroupID,
		&parent,
		&item.Name,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if parent.Valid {
		item.ParentGroupID = &parent.String
	}
	return item, err
}

func scanCompanyUserGroupMember(row interface{ Scan(dest ...any) error }) (domain.CompanyUserGroupMember, error) {
	var item domain.CompanyUserGroupMember
	var displayName sql.NullString
	var email sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.GroupID,
		&item.UserID,
		&displayName,
		&email,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if displayName.Valid {
		item.UserDisplayName = displayName.String
	}
	if email.Valid {
		item.UserEmail = email.String
	}
	return item, err
}

func scanEntityPermission(row interface{ Scan(dest ...any) error }) (domain.EntityPermission, error) {
	var item domain.EntityPermission
	var subjectName sql.NullString
	var subjectEmail sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.EntityType,
		&item.EntityID,
		&item.SubjectType,
		&item.SubjectID,
		&subjectName,
		&subjectEmail,
		&item.Permission,
		&item.CreatedTimestamp,
	)
	if subjectName.Valid {
		item.SubjectName = subjectName.String
	}
	if subjectEmail.Valid {
		item.SubjectEmail = subjectEmail.String
	}
	item.AccessLevel = item.Permission
	return item, err
}

func (r *PostgresRepo) ListCompanyUserGroups(companyID string) ([]domain.CompanyUserGroup, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}

	rows, err := r.db.Query(`
select company_id::text, group_id::text, parent_group_id::text, name, position, created_timestamp, updated_timestamp
from company_user_groups
where company_id=$1
order by coalesce(parent_group_id::text, ''), position asc, created_timestamp asc, group_id asc`, companyID)
	if err != nil {
		if isPostgresUndefinedTable(err, "company_user_groups") {
			return []domain.CompanyUserGroup{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.CompanyUserGroup, 0)
	for rows.Next() {
		item, err := scanCompanyUserGroup(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CreateCompanyUserGroup(companyID, parentGroupID, name string) (domain.CompanyUserGroup, error) {
	companyID = strings.TrimSpace(companyID)
	parentGroupID = strings.TrimSpace(parentGroupID)
	name = strings.TrimSpace(name)
	if companyID == "" || name == "" {
		return domain.CompanyUserGroup{}, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyUserGroup{}, err
	}
	defer tx.Rollback()

	if exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from companies where company_id=$1::uuid)`, companyID); err != nil {
		return domain.CompanyUserGroup{}, err
	} else if !exists {
		return domain.CompanyUserGroup{}, ErrNotFound
	}

	var parent any
	if parentGroupID != "" {
		if exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from company_user_groups where company_id=$1::uuid and group_id=$2::uuid)`, companyID, parentGroupID); err != nil {
			return domain.CompanyUserGroup{}, err
		} else if !exists {
			return domain.CompanyUserGroup{}, ErrNotFound
		}
		parent = parentGroupID
	}

	position, err := postgresNextCompanyUserGroupPosition(ctx, tx, companyID, parent)
	if err != nil {
		return domain.CompanyUserGroup{}, err
	}

	item, err := scanCompanyUserGroup(tx.QueryRowContext(ctx, `
insert into company_user_groups (company_id, group_id, parent_group_id, name, position, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, $4, $5, now(), now())
returning company_id::text, group_id::text, parent_group_id::text, name, position, created_timestamp, updated_timestamp`,
		companyID, newUUIDv7String(), parent, name, position,
	))
	if err != nil {
		return domain.CompanyUserGroup{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyUserGroup{}, err
	}
	return item, nil
}

func (r *PostgresRepo) UpdateCompanyUserGroup(companyID, groupID string, parentGroupID *string, name string, position int) (domain.CompanyUserGroup, error) {
	companyID = strings.TrimSpace(companyID)
	groupID = strings.TrimSpace(groupID)
	name = strings.TrimSpace(name)
	if companyID == "" || groupID == "" {
		return domain.CompanyUserGroup{}, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyUserGroup{}, err
	}
	defer tx.Rollback()

	var currentParent sql.NullString
	var currentName string
	var currentPosition int
	if err := tx.QueryRowContext(ctx, `
select parent_group_id::text, name, position
from company_user_groups
where company_id=$1::uuid and group_id=$2::uuid
for update`, companyID, groupID).Scan(&currentParent, &currentName, &currentPosition); errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyUserGroup{}, ErrNotFound
	} else if err != nil {
		return domain.CompanyUserGroup{}, err
	}

	var parent any
	targetParentID := ""
	if currentParent.Valid {
		targetParentID = currentParent.String
		parent = currentParent.String
	}
	parentChanged := false
	if parentGroupID != nil {
		targetParentID = strings.TrimSpace(*parentGroupID)
		if targetParentID == groupID {
			return domain.CompanyUserGroup{}, ErrInvalid
		}
		if targetParentID != "" {
			if exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from company_user_groups where company_id=$1::uuid and group_id=$2::uuid)`, companyID, targetParentID); err != nil {
				return domain.CompanyUserGroup{}, err
			} else if !exists {
				return domain.CompanyUserGroup{}, ErrNotFound
			}
			var createsCycle bool
			if err := tx.QueryRowContext(ctx, `
with recursive descendants as (
  select group_id
  from company_user_groups
  where company_id=$1::uuid and group_id=$2::uuid
  union all
  select child.group_id
  from company_user_groups child
  join descendants parent
    on child.company_id=$1
   and child.parent_group_id=parent.group_id
)
select exists(select 1 from descendants where group_id=$3)`, companyID, groupID, targetParentID).Scan(&createsCycle); err != nil {
				return domain.CompanyUserGroup{}, err
			}
			if createsCycle {
				return domain.CompanyUserGroup{}, ErrInvalid
			}
			parent = targetParentID
		} else {
			parent = nil
		}
		parentChanged = (!currentParent.Valid && targetParentID != "") || (currentParent.Valid && currentParent.String != targetParentID)
	}

	if name == "" {
		name = currentName
	}
	if strings.TrimSpace(name) == "" {
		return domain.CompanyUserGroup{}, ErrInvalid
	}
	if position <= 0 {
		if parentChanged {
			position, err = postgresNextCompanyUserGroupPosition(ctx, tx, companyID, parent)
			if err != nil {
				return domain.CompanyUserGroup{}, err
			}
		} else {
			position = currentPosition
		}
	}

	item, err := scanCompanyUserGroup(tx.QueryRowContext(ctx, `
update company_user_groups
set parent_group_id=$3,
    name=$4,
    position=$5,
    updated_timestamp=now()
where company_id=$1::uuid and group_id=$2::uuid
returning company_id::text, group_id::text, parent_group_id::text, name, position, created_timestamp, updated_timestamp`,
		companyID, groupID, parent, name, position,
	))
	if err != nil {
		return domain.CompanyUserGroup{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyUserGroup{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteCompanyUserGroup(companyID, groupID string) error {
	companyID = strings.TrimSpace(companyID)
	groupID = strings.TrimSpace(groupID)
	if companyID == "" || groupID == "" {
		return ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
with recursive subtree as (
  select group_id
  from company_user_groups
  where company_id=$1::uuid and group_id=$2::uuid
  union all
  select child.group_id
  from company_user_groups child
  join subtree parent
    on child.company_id=$1::uuid
   and child.parent_group_id=parent.group_id
)
select group_id::text
from subtree`, companyID, groupID)
	if err != nil {
		return err
	}
	groupIDs := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		groupIDs = append(groupIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(groupIDs) == 0 {
		return ErrNotFound
	}

	if _, err := tx.ExecContext(ctx, `
delete from resource_gvic_assignments
where company_id=$1::uuid
  and principal_type='group'
  and principal_id::text = any($2::text[])`, companyID, groupIDs); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
delete from resource_permissions
where company_id=$1::uuid
  and subject_type='group'
  and subject_id::text = any($2::text[])`, companyID, groupIDs); err != nil {
		return err
	}
	deleted, err := tx.ExecContext(ctx, `
delete from company_user_groups
where company_id=$1::uuid and group_id=$2::uuid`, companyID, groupID)
	if err != nil {
		return err
	}
	affected, err := deleted.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListCompanyUserGroupMembers(companyID string) ([]domain.CompanyUserGroupMember, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}

	rows, err := r.db.Query(`
select member.company_id::text,
       member.group_id::text,
       member.user_id::text,
       nullif(app_user.display_name, ''),
       nullif(app_user.email, ''),
       member.created_timestamp,
       member.updated_timestamp
from company_user_group_members member
join users app_user on app_user.user_id=member.user_id
where member.company_id=$1
order by member.group_id::text asc,
         lower(coalesce(nullif(app_user.display_name, ''), nullif(app_user.email, ''), member.user_id::text)) asc,
         member.user_id::text asc`, companyID)
	if err != nil {
		if isPostgresUndefinedTable(err, "company_user_group_members") {
			return []domain.CompanyUserGroupMember{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.CompanyUserGroupMember, 0)
	for rows.Next() {
		item, err := scanCompanyUserGroupMember(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) SetCompanyUserGroupMembers(companyID, groupID string, userIDs []string) ([]domain.CompanyUserGroupMember, error) {
	companyID = strings.TrimSpace(companyID)
	groupID = strings.TrimSpace(groupID)
	if companyID == "" || groupID == "" || len(userIDs) > EntityPermissionMaxAssignments {
		return nil, ErrInvalid
	}

	cleanUserIDs := make([]string, 0, len(userIDs))
	seen := map[string]bool{}
	for _, userID := range userIDs {
		userID = strings.TrimSpace(userID)
		if userID == "" || seen[userID] {
			continue
		}
		seen[userID] = true
		cleanUserIDs = append(cleanUserIDs, userID)
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from company_user_groups where company_id=$1::uuid and group_id=$2::uuid)`, companyID, groupID); err != nil {
		return nil, err
	} else if !exists {
		return nil, ErrNotFound
	}
	if len(cleanUserIDs) > 0 {
		var missing bool
		if err := tx.QueryRowContext(ctx, `
with input as (
  select unnest($2::text[])::uuid as user_id
)
select exists(
  select 1
  from input
  where not exists (
    select 1
    from company_memberships membership
    where membership.company_id=$1::uuid
      and membership.user_id=input.user_id
  )
)`, companyID, cleanUserIDs).Scan(&missing); err != nil {
			return nil, err
		}
		if missing {
			return nil, ErrPrincipalNotInCompany
		}
	}

	if _, err := tx.ExecContext(ctx, `delete from company_user_group_members where company_id=$1::uuid and group_id=$2::uuid`, companyID, groupID); err != nil {
		return nil, err
	}
	if len(cleanUserIDs) > 0 {
		if _, err := tx.ExecContext(ctx, `
insert into company_user_group_members (company_id, group_id, user_id, created_timestamp, updated_timestamp)
select $1::uuid, $2::uuid, input.user_id::uuid, now(), now()
from unnest($3::text[]) as input(user_id)
on conflict (company_id, group_id, user_id) do update
set updated_timestamp=now()`, companyID, groupID, cleanUserIDs); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	allMembers, err := r.ListCompanyUserGroupMembers(companyID)
	if err != nil {
		return nil, err
	}
	items := make([]domain.CompanyUserGroupMember, 0, len(cleanUserIDs))
	for _, member := range allMembers {
		if member.GroupID == groupID {
			items = append(items, member)
		}
	}
	return items, nil
}

func (r *PostgresRepo) ListEntityPermissions(companyID, entityType, entityID string) ([]domain.EntityPermission, error) {
	policy, err := r.GetResourcePermissionPolicy(companyID, entityType, entityID)
	if err != nil {
		return nil, err
	}
	return policy.Permissions, nil
}

func (r *PostgresRepo) SetEntityPermissions(input EntityPermissionUpdateInput) ([]domain.EntityPermission, error) {
	companyID, entityID := strings.TrimSpace(input.CompanyID), strings.TrimSpace(input.EntityID)
	entityType, ok := NormalizeEntityType(input.EntityType)
	if companyID == "" || entityID == "" || !ok || len(input.Permissions) > EntityPermissionMaxAssignments {
		return nil, ErrInvalid
	}
	current, err := r.GetResourcePermissionPolicy(companyID, entityType, entityID)
	if err != nil {
		return nil, err
	}
	var defaultAccess *string
	if input.DefaultAccessSet {
		value := input.DefaultAccess
		defaultAccess = &value
	} else {
		defaultAccess = &current.EffectiveDefaultAccess
	}
	action := PolicyDescendantActionInheritedOnly
	if input.ApplyToDescendants {
		action = PolicyDescendantActionIncludingCustomized
	}
	policy, _, err := r.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: entityType, ResourceID: entityID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: defaultAccess,
		Permissions: input.Permissions, DescendantAction: action, ExpectedRevision: current.Revision,
		ActorUserID: input.ActorUserID,
	})
	if err != nil {
		return nil, err
	}
	return policy.Permissions, nil
}

func (r *PostgresRepo) ListAccessibleEntityIDs(companyID, entityType, userID, accessLevel string, entityIDs []string) (map[string]bool, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	entityType, ok := NormalizeEntityType(entityType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || userID == "" || !ok || !accessOK {
		return nil, ErrInvalid
	}

	cleanIDs := make([]string, 0, len(entityIDs))
	seen := map[string]bool{}
	for _, rawID := range entityIDs {
		entityID := cleanUUIDText(rawID)
		if entityID == "" || seen[entityID] {
			continue
		}
		seen[entityID] = true
		cleanIDs = append(cleanIDs, entityID)
	}
	if len(cleanIDs) == 0 {
		return map[string]bool{}, nil
	}
	if usesDefaultResourceAccessPolicy(entityType) {
		return r.ListEffectiveResourceIDsForUser(companyID, userID, entityType, accessLevel, cleanIDs)
	}
	return nil, ErrInvalid
}

func (r *PostgresRepo) UserCanAccessEntity(companyID, entityType, entityID, userID, accessLevel string) (bool, error) {
	companyID = strings.TrimSpace(companyID)
	entityID = strings.TrimSpace(entityID)
	userID = strings.TrimSpace(userID)
	entityType, ok := NormalizeEntityType(entityType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || entityID == "" || userID == "" || !ok || !accessOK {
		return false, ErrInvalid
	}
	ctx := context.Background()
	if exists, err := r.postgresEntityExists(ctx, companyID, entityType, entityID); err != nil {
		return false, err
	} else if !exists {
		return false, ErrNotFound
	}
	if allowed, err := r.UserHasEffectiveAccess(companyID, userID, entityType, entityID, accessLevel); err == nil {
		return allowed, nil
	} else if err != nil && !errors.Is(err, ErrInvalid) {
		return false, err
	}
	var allowed bool
	err := r.db.QueryRowContext(ctx, `select mangorts_user_can_access_resource($1::uuid, $2::text, $3::uuid, $4::uuid, $5::text)`, companyID, entityType, entityID, userID, accessLevel).Scan(&allowed)
	return allowed, err
}

func (r *PostgresRepo) attachCommunicationsSharedInboxAccessGrants(ctx context.Context, companyID string, folders []domain.CompanyExplorerFolder) ([]domain.CompanyExplorerFolder, error) {
	ids := make([]string, 0, len(folders))
	for _, folder := range folders {
		if folder.FolderKind == "communications" {
			ids = append(ids, folder.FolderID)
		}
	}
	if len(ids) == 0 {
		return folders, nil
	}
	rows, err := r.db.QueryContext(ctx, `
with communications_shared_items as (
  select folder.company_id,
         folder.folder_id as resource_id,
         folder.default_access,
         'shared_inbox_folder'::text as resource_type
  from shared_inbox_folders folder
  union all
  select inbox.company_id,
         inbox.shared_inbox_id as resource_id,
         inbox.default_access,
         'shared_inbox'::text as resource_type
  from shared_inboxes inbox
)
select access.company_id::text,
       access.resource_type,
       access.resource_id::text,
       access.subject_type,
       access.subject_id::text,
       coalesce(nullif(user_group.name, ''), nullif(app_user.display_name, ''), nullif(app_user.email, '')),
       nullif(app_user.email, ''),
       access.access_level,
       access.created_timestamp
from resource_permissions access
join communications_shared_items folder
  on folder.company_id=access.company_id
 and folder.resource_id=access.resource_id
 and folder.resource_type=access.resource_type
left join users app_user
  on access.subject_type='user'
 and app_user.user_id=access.subject_id
left join company_user_groups user_group
  on access.subject_type='group'
 and user_group.company_id=access.company_id
 and user_group.group_id=access.subject_id
where access.company_id=$1::uuid
  and access.resource_type in ($2, $3)
  and access.resource_id = any(string_to_array($4, ',')::uuid[])
order by access.resource_id::text asc,
         access.subject_type asc,
         lower(coalesce(nullif(user_group.name, ''), nullif(app_user.display_name, ''), nullif(app_user.email, ''), access.subject_id::text)) asc,
         access.subject_id::text asc`, companyID, EntityTypeSharedInboxFolder, EntityTypeSharedInbox, strings.Join(ids, ","))
	if err != nil {
		if isPostgresUndefinedTable(err, "resource_permissions") || postgresSharedInboxStorageUnavailable(err) || isPostgresInvalidTextRepresentation(err) {
			return folders, nil
		}
		return nil, err
	}
	defer rows.Close()
	grantsByResource := map[string][]domain.EntityPermission{}
	for rows.Next() {
		item, err := scanEntityPermission(rows)
		if err != nil {
			return nil, err
		}
		grantsByResource[item.EntityID] = append(grantsByResource[item.EntityID], item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for index := range folders {
		if folders[index].FolderKind != "communications" {
			continue
		}
		folders[index].AccessGrants = grantsByResource[folders[index].FolderID]
	}
	return folders, nil
}
func postgresNextCompanyUserGroupPosition(ctx context.Context, tx *sql.Tx, companyID string, parent any) (int, error) {
	var position int
	err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from company_user_groups
where company_id=$1::uuid
  and (($2::uuid is null and parent_group_id is null) or parent_group_id=$2::uuid)`, companyID, parent).Scan(&position)
	return position, err
}

func (r *PostgresRepo) postgresEntityExists(ctx context.Context, companyID, entityType, entityID string) (bool, error) {
	switch entityType {
	case EntityTypeNode:
		var exists bool
		err := r.db.QueryRowContext(ctx, `select exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)`, companyID, entityID).Scan(&exists)
		return exists, err
	case EntityTypeLogicGate:
		var exists bool
		err := r.db.QueryRowContext(ctx, `select exists(select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid)`, companyID, entityID).Scan(&exists)
		return exists, err
	case EntityTypeProject:
		var exists bool
		err := r.db.QueryRowContext(ctx, `select exists(select 1 from projects where company_id=$1::uuid and project_id=$2::uuid)`, companyID, entityID).Scan(&exists)
		return exists, err
	case EntityTypeCompanyExplorerFolder:
		var exists bool
		err := r.db.QueryRowContext(ctx, `
select exists(select 1 from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid)`, companyID, entityID).Scan(&exists)
		return exists, err
	case EntityTypeSharedInboxFolder:
		var exists bool
		err := r.db.QueryRowContext(ctx, `select exists(select 1 from shared_inbox_folders where company_id=$1::uuid and folder_id=$2::uuid)`, companyID, entityID).Scan(&exists)
		return exists, err
	case EntityTypeSharedInbox:
		var exists bool
		err := r.db.QueryRowContext(ctx, `select exists(select 1 from shared_inboxes where company_id=$1::uuid and shared_inbox_id=$2::uuid)`, companyID, entityID).Scan(&exists)
		return exists, err
	default:
		return false, ErrInvalid
	}
}

func postgresEntityExistsTx(ctx context.Context, tx *sql.Tx, companyID, entityType, entityID string) (bool, error) {
	switch entityType {
	case EntityTypeNode:
		return postgresTxExists(ctx, tx, `select exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)`, companyID, entityID)
	case EntityTypeLogicGate:
		return postgresTxExists(ctx, tx, `select exists(select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid)`, companyID, entityID)
	case EntityTypeProject:
		return postgresTxExists(ctx, tx, `select exists(select 1 from projects where company_id=$1::uuid and project_id=$2::uuid)`, companyID, entityID)
	case EntityTypeCompanyExplorerFolder:
		return postgresTxExists(ctx, tx, `
select exists(select 1 from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid)`, companyID, entityID)
	case EntityTypeSharedInboxFolder:
		return postgresTxExists(ctx, tx, `select exists(select 1 from shared_inbox_folders where company_id=$1::uuid and folder_id=$2::uuid)`, companyID, entityID)
	case EntityTypeSharedInbox:
		return postgresTxExists(ctx, tx, `select exists(select 1 from shared_inboxes where company_id=$1::uuid and shared_inbox_id=$2::uuid)`, companyID, entityID)
	default:
		return false, ErrInvalid
	}
}
