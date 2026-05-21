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
	deleted, err := r.db.Exec(`
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
	return nil
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
			return nil, ErrAssigneeNotInCompany
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
	companyID = strings.TrimSpace(companyID)
	entityID = strings.TrimSpace(entityID)
	entityType, ok := NormalizeEntityType(entityType)
	if companyID == "" || entityID == "" || !ok {
		return nil, ErrInvalid
	}
	ctx := context.Background()
	if exists, err := r.postgresEntityExists(ctx, companyID, entityType, entityID); err != nil {
		return nil, err
	} else if !exists {
		return nil, ErrNotFound
	}

	rows, err := r.db.QueryContext(ctx, `
select grant_row.company_id::text,
       grant_row.resource_type,
       grant_row.resource_id::text,
       grant_row.principal_type,
       grant_row.principal_id::text,
       coalesce(nullif(app_user.display_name, ''), user_group.name),
       nullif(app_user.email, ''),
       grant_row.access_level,
       grant_row.created_timestamp
from resource_access_grants grant_row
left join users app_user
  on grant_row.principal_type='user'
 and app_user.user_id=grant_row.principal_id
left join company_user_groups user_group
  on grant_row.principal_type='group'
 and user_group.company_id=grant_row.company_id
 and user_group.group_id=grant_row.principal_id
where grant_row.company_id=$1
  and grant_row.resource_type=$2
  and grant_row.resource_id=$3::uuid
order by grant_row.principal_type asc,
         lower(coalesce(nullif(app_user.display_name, ''), nullif(app_user.email, ''), user_group.name, grant_row.principal_id::text)) asc,
         grant_row.principal_id::text asc`, companyID, entityType, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.EntityPermission, 0)
	for rows.Next() {
		item, err := scanEntityPermission(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) SetEntityPermissions(input EntityPermissionUpdateInput) ([]domain.EntityPermission, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	entityID := strings.TrimSpace(input.EntityID)
	entityType, ok := NormalizeEntityType(input.EntityType)
	if companyID == "" || entityID == "" || !ok || len(input.Permissions) > EntityPermissionMaxAssignments {
		return nil, ErrInvalid
	}

	type normalizedPermission struct {
		subjectType string
		subjectID   string
		permission  string
	}
	normalized := make([]normalizedPermission, 0, len(input.Permissions))
	seen := map[string]bool{}
	for _, raw := range input.Permissions {
		subjectType, ok := NormalizeEntityPermissionSubjectType(raw.SubjectType)
		if !ok {
			return nil, ErrInvalid
		}
		rawAccessLevel := strings.TrimSpace(raw.AccessLevel)
		if rawAccessLevel == "" {
			rawAccessLevel = raw.Permission
		}
		permission, ok := NormalizeEntityPermission(rawAccessLevel)
		if !ok {
			return nil, ErrInvalid
		}
		subjectID := strings.TrimSpace(raw.SubjectID)
		if subjectID == "" {
			return nil, ErrInvalid
		}
		key := subjectType + ":" + subjectID + ":" + permission
		if seen[key] {
			continue
		}
		seen[key] = true
		normalized = append(normalized, normalizedPermission{subjectType: subjectType, subjectID: subjectID, permission: permission})
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if exists, err := postgresEntityExistsTx(ctx, tx, companyID, entityType, entityID); err != nil {
		return nil, err
	} else if !exists {
		return nil, ErrNotFound
	}
	for _, item := range normalized {
		switch item.subjectType {
		case EntityPermissionSubjectUser:
			if exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from company_memberships where company_id=$1::uuid and user_id=$2::uuid)`, companyID, item.subjectID); err != nil {
				return nil, err
			} else if !exists {
				return nil, ErrAssigneeNotInCompany
			}
		case EntityPermissionSubjectGroup:
			if exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from company_user_groups where company_id=$1::uuid and group_id=$2::uuid)`, companyID, item.subjectID); err != nil {
				return nil, err
			} else if !exists {
				return nil, ErrNotFound
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `
delete from resource_access_grants
where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, entityType, entityID); err != nil {
		return nil, err
	}
	for _, item := range normalized {
		if _, err := tx.ExecContext(ctx, `
insert into resource_access_grants
  (company_id, resource_type, resource_id, principal_type, principal_id, access_level, created_timestamp)
values ($1, $2, $3::uuid, $4, $5::uuid, $6, now())
on conflict (company_id, resource_type, resource_id, principal_type, principal_id) do update set
  access_level=excluded.access_level`,
			companyID, entityType, entityID, item.subjectType, item.subjectID, item.permission,
		); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return r.ListEntityPermissions(companyID, entityType, entityID)
}

func (r *PostgresRepo) UserCanViewEntity(companyID, entityType, entityID, userID string) (bool, error) {
	return r.UserCanAccessEntity(companyID, entityType, entityID, userID, EntityPermissionView)
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
	var allowed bool
	err := r.db.QueryRowContext(ctx, `select mangorts_user_can_access_resource($1::uuid, $2::text, $3::uuid, $4::uuid, $5::text)`, companyID, entityType, entityID, userID, accessLevel).Scan(&allowed)
	return allowed, err
}

func (r *PostgresRepo) listResourceAccessGrants(ctx context.Context, companyID, resourceType string, resourceIDs []string) (map[string][]domain.EntityPermission, error) {
	itemsByResource := map[string][]domain.EntityPermission{}
	if len(resourceIDs) == 0 {
		return itemsByResource, nil
	}
	rows, err := r.db.QueryContext(ctx, `
select grant_row.company_id::text,
       grant_row.resource_type,
       grant_row.resource_id::text,
       grant_row.principal_type,
       grant_row.principal_id::text,
       coalesce(nullif(app_user.display_name, ''), user_group.name),
       nullif(app_user.email, ''),
       grant_row.access_level,
       grant_row.created_timestamp
from resource_access_grants grant_row
left join users app_user
  on grant_row.principal_type='user'
 and app_user.user_id=grant_row.principal_id
left join company_user_groups user_group
  on grant_row.principal_type='group'
 and user_group.company_id=grant_row.company_id
 and user_group.group_id=grant_row.principal_id
where grant_row.company_id=$1
  and grant_row.resource_type=$2
  and grant_row.resource_id = any(string_to_array($3, ',')::uuid[])
order by grant_row.resource_id::text asc,
         grant_row.principal_type asc,
         lower(coalesce(nullif(app_user.display_name, ''), nullif(app_user.email, ''), user_group.name, grant_row.principal_id::text)) asc,
         grant_row.principal_id::text asc`, companyID, resourceType, strings.Join(resourceIDs, ","))
	if err != nil {
		if isPostgresUndefinedTable(err, "resource_access_grants") || isPostgresInvalidTextRepresentation(err) {
			return itemsByResource, nil
		}
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		item, err := scanEntityPermission(rows)
		if err != nil {
			return nil, err
		}
		itemsByResource[item.EntityID] = append(itemsByResource[item.EntityID], item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for resourceID := range itemsByResource {
		sortEntityPermissions(itemsByResource[resourceID])
	}
	return itemsByResource, nil
}

func resourceAccessGrantsForFolder(folderID string, parentByFolder map[string]string, grantsByResource map[string][]domain.EntityPermission) []domain.EntityPermission {
	items := make([]domain.EntityPermission, 0)
	seenSubjects := map[string]bool{}
	seenFolders := map[string]bool{}
	for currentID := strings.TrimSpace(folderID); currentID != ""; currentID = strings.TrimSpace(parentByFolder[currentID]) {
		if seenFolders[currentID] {
			break
		}
		seenFolders[currentID] = true
		for _, grant := range grantsByResource[currentID] {
			seenKey := grant.SubjectType + ":" + grant.SubjectID
			if seenSubjects[seenKey] {
				continue
			}
			seenSubjects[seenKey] = true
			items = append(items, grant)
		}
		if _, ok := parentByFolder[currentID]; !ok {
			break
		}
	}
	sortEntityPermissions(items)
	return items
}

func (r *PostgresRepo) attachCommunicationsSharedInboxAccessGrants(ctx context.Context, companyID string, folders []domain.CompanyExplorerFolder) ([]domain.CompanyExplorerFolder, error) {
	ids := make([]string, 0, len(folders))
	for _, folder := range folders {
		if folder.FolderKind == "communications" {
			ids = append(ids, folder.FolderID)
		}
	}
	parentByFolder, grantFolderIDs, err := r.listCommunicationsSharedInboxRaciAncestry(ctx, companyID, ids)
	if err != nil {
		if isPostgresUndefinedTable(err, "") || isPostgresUndefinedColumn(err, "") || isPostgresInvalidTextRepresentation(err) {
			return folders, nil
		}
		return nil, err
	}
	grantsByResource, err := r.listResourceAccessGrants(ctx, companyID, EntityTypeSharedTriageFolder, grantFolderIDs)
	if err != nil {
		return nil, err
	}
	for index := range folders {
		if folders[index].FolderKind != "communications" {
			continue
		}
		folders[index].AccessGrants = resourceAccessGrantsForFolder(folders[index].FolderID, parentByFolder, grantsByResource)
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
	case EntityTypeSharedTriageFolder:
		var exists bool
		err := r.db.QueryRowContext(ctx, `select exists(select 1 from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid and folder_kind='communications')`, companyID, entityID).Scan(&exists)
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
	case EntityTypeSharedTriageFolder:
		return postgresTxExists(ctx, tx, `select exists(select 1 from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid and folder_kind='communications')`, companyID, entityID)
	default:
		return false, ErrInvalid
	}
}
