package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

const (
	CommunicationsSharedInboxEntryTypeFolder      = "folder"
	CommunicationsSharedInboxEntryTypeSharedInbox = "shared_inbox"
)

type communicationsSharedInboxFolderScanner interface {
	Scan(dest ...any) error
}

func scanCommunicationsSharedInboxFolder(row communicationsSharedInboxFolderScanner) (domain.CompanyExplorerFolder, error) {
	var item domain.CompanyExplorerFolder
	var parent sql.NullString
	var accountEmail sql.NullString
	var entryType string
	err := row.Scan(
		&item.CompanyID,
		&item.FolderID,
		&parent,
		&entryType,
		&item.Name,
		&item.DefaultAccess,
		&accountEmail,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if err != nil {
		return item, err
	}
	item.FolderKind = "communications"
	item.EntryType = normalizeCommunicationsSharedInboxEntryType(entryType, accountEmail.Valid)
	item.ScopeType = CompanyExplorerFolderScopeCompany
	if parent.Valid {
		item.ParentFolderID = &parent.String
	}
	if accountEmail.Valid {
		item.AccountEmail = &accountEmail.String
	}
	item.DefaultAccess = defaultResourceAccessOrEdit(item.DefaultAccess)
	return item, nil
}

func normalizeCommunicationsSharedInboxEntryType(entryType string, hasAccountEmail bool) string {
	switch strings.ToLower(strings.TrimSpace(entryType)) {
	case CommunicationsSharedInboxEntryTypeSharedInbox:
		return CommunicationsSharedInboxEntryTypeSharedInbox
	default:
		if hasAccountEmail {
			return CommunicationsSharedInboxEntryTypeSharedInbox
		}
		return CommunicationsSharedInboxEntryTypeFolder
	}
}

func postgresSharedInboxStorageUnavailable(err error) bool {
	return isPostgresUndefinedTable(err, "communications_shared_inbox_folders") || isPostgresUndefinedColumn(err, "")
}

func nextCommunicationsSharedInboxPositionSQL(ctx context.Context, tx *sql.Tx, companyID string, parent any) (int, error) {
	var position int
	err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from communications_shared_inbox_folders
where company_id=$1::uuid
  and (($2::uuid is null and parent_folder_id is null) or parent_folder_id=$2::uuid)`, companyID, parent).Scan(&position)
	return position, err
}

func (r *PostgresRepo) getCommunicationsSharedInboxFolder(ctx context.Context, companyID, folderID string) (domain.CompanyExplorerFolder, error) {
	item, err := scanCommunicationsSharedInboxFolder(r.db.QueryRowContext(ctx, `
select company_id::text,
       folder_id::text,
       parent_folder_id::text,
       entry_type,
       name,
       coalesce(default_access, $3),
       account_email,
       position,
       created_timestamp,
       updated_timestamp
from communications_shared_inbox_folders
where company_id=$1::uuid and folder_id=$2::uuid`, companyID, folderID, ResourceDefaultAccessEdit))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
		}
		return domain.CompanyExplorerFolder{}, err
	}
	items, err := r.attachCommunicationsSharedInboxRaciAssignments(ctx, companyID, []domain.CompanyExplorerFolder{item})
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	items, err = r.attachCommunicationsSharedInboxAccessGrants(ctx, companyID, items)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	if len(items) == 0 {
		return item, nil
	}
	return items[0], nil
}

func (r *PostgresRepo) GetCommunicationsSharedInboxFolder(companyID, folderID string) (domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	if companyID == "" || folderID == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	return r.getCommunicationsSharedInboxFolder(context.Background(), companyID, folderID)
}

func (r *PostgresRepo) CreateCommunicationsSharedInboxFolder(companyID, parentFolderID, name, accountEmail string) (domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	parentFolderID = cleanUUIDText(parentFolderID)
	name = strings.TrimSpace(name)
	accountEmail = normalizeEmail(accountEmail)
	if companyID == "" || name == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	defer tx.Rollback()

	if exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from companies where company_id=$1::uuid)`, companyID); err != nil {
		return domain.CompanyExplorerFolder{}, err
	} else if !exists {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}

	var parent any
	if parentFolderID != "" {
		var parentEntryType string
		err := tx.QueryRowContext(ctx, `
select entry_type
from communications_shared_inbox_folders
where company_id=$1::uuid and folder_id=$2::uuid
for update`, companyID, parentFolderID).Scan(&parentEntryType)
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		if err != nil {
			if postgresSharedInboxStorageUnavailable(err) {
				return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
			}
			return domain.CompanyExplorerFolder{}, err
		}
		if normalizeCommunicationsSharedInboxEntryType(parentEntryType, false) == CommunicationsSharedInboxEntryTypeSharedInbox {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		parent = parentFolderID
	}

	var accountParam any
	entryType := CommunicationsSharedInboxEntryTypeFolder
	if accountEmail != "" {
		available, err := postgresCompanyHasConnectedEmailAccount(ctx, tx, companyID, accountEmail)
		if err != nil {
			return domain.CompanyExplorerFolder{}, err
		}
		if !available {
			return domain.CompanyExplorerFolder{}, ErrEmailAccountUnavailable
		}
		accountParam = accountEmail
		entryType = CommunicationsSharedInboxEntryTypeSharedInbox
	}
	position, err := nextCommunicationsSharedInboxPositionSQL(ctx, tx, companyID, parent)
	if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
		}
		return domain.CompanyExplorerFolder{}, err
	}

	item, err := scanCommunicationsSharedInboxFolder(tx.QueryRowContext(ctx, `
insert into communications_shared_inbox_folders (
  company_id,
  folder_id,
  parent_folder_id,
  entry_type,
  name,
  default_access,
  account_email,
  position,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, now(), now())
returning company_id::text, folder_id::text, parent_folder_id::text, entry_type, name, default_access, account_email, position, created_timestamp, updated_timestamp`,
		companyID, newUUIDv7String(), parent, entryType, name, ResourceDefaultAccessEdit, accountParam, position,
	))
	if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
		}
		return domain.CompanyExplorerFolder{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return r.getCommunicationsSharedInboxFolder(ctx, companyID, item.FolderID)
}

func (r *PostgresRepo) ListCommunicationsSharedInboxFolders(companyID string) ([]domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx, `
select company_id::text,
       folder_id::text,
       parent_folder_id::text,
       entry_type,
       name,
       coalesce(default_access, $2),
       account_email,
       position,
       created_timestamp,
       updated_timestamp
from communications_shared_inbox_folders
where company_id=$1::uuid
order by position asc, created_timestamp asc`, companyID, ResourceDefaultAccessEdit)
	if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return nil, ErrSharedInboxStorageUnavailable
		}
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.CompanyExplorerFolder, 0)
	for rows.Next() {
		item, err := scanCommunicationsSharedInboxFolder(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items, err = r.attachCommunicationsSharedInboxRaciAssignments(ctx, companyID, items)
	if err != nil {
		return nil, err
	}
	return r.attachCommunicationsSharedInboxAccessGrants(ctx, companyID, items)
}

func (r *PostgresRepo) ListVisibleCommunicationsSharedInboxFolders(companyID, userID string) ([]domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx, `
select folder.company_id::text,
       folder.folder_id::text,
       folder.parent_folder_id::text,
       folder.entry_type,
       folder.name,
       coalesce(folder.default_access, $3),
       folder.account_email,
       folder.position,
       folder.created_timestamp,
       folder.updated_timestamp,
       case
         when exists (
           select 1
           from company_memberships membership
           where membership.user_id=$2::uuid
             and (
               membership.role='dev_admin'
               or (membership.company_id=$1::uuid and membership.role='company_admin')
             )
         ) then 'admin'
         when mangorts_user_can_access_resource(folder.company_id, 'shared_triage_folder', folder.folder_id, $2::uuid, 'edit') then 'edit'
         else 'no_access'
       end as effective_access_level
from communications_shared_inbox_folders folder
where folder.company_id=$1::uuid
  and mangorts_user_can_access_resource(folder.company_id, 'shared_triage_folder', folder.folder_id, $2::uuid, 'view')
order by folder.position asc, folder.created_timestamp asc`, companyID, userID, ResourceDefaultAccessEdit)
	if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return nil, ErrSharedInboxStorageUnavailable
		}
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.CompanyExplorerFolder, 0)
	for rows.Next() {
		var item domain.CompanyExplorerFolder
		var parent sql.NullString
		var entryType string
		var accountEmail sql.NullString
		if err := rows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&parent,
			&entryType,
			&item.Name,
			&item.DefaultAccess,
			&accountEmail,
			&item.Position,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
			&item.EffectiveAccess,
		); err != nil {
			return nil, err
		}
		item.FolderKind = "communications"
		item.EntryType = normalizeCommunicationsSharedInboxEntryType(entryType, accountEmail.Valid)
		item.ScopeType = CompanyExplorerFolderScopeCompany
		item.DefaultAccess = defaultResourceAccessOrEdit(item.DefaultAccess)
		if parent.Valid {
			item.ParentFolderID = &parent.String
		}
		if accountEmail.Valid {
			item.AccountEmail = &accountEmail.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items, err = r.attachCommunicationsSharedInboxRaciAssignments(ctx, companyID, items)
	if err != nil {
		return nil, err
	}
	return r.attachCommunicationsSharedInboxAccessGrants(ctx, companyID, items)
}

func (r *PostgresRepo) MoveCommunicationsSharedInboxFolder(companyID, folderID string, parentFolderID *string, position int) (domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	if companyID == "" || folderID == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	defer tx.Rollback()

	var currentParent sql.NullString
	var currentPosition int
	if err := tx.QueryRowContext(ctx, `
select parent_folder_id::text, position
from communications_shared_inbox_folders
where company_id=$1::uuid and folder_id=$2::uuid
for update`, companyID, folderID).Scan(&currentParent, &currentPosition); errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	} else if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
		}
		return domain.CompanyExplorerFolder{}, err
	}

	var parent any
	targetParentID := ""
	if currentParent.Valid {
		targetParentID = currentParent.String
		parent = currentParent.String
	}
	parentChanged := false
	if parentFolderID != nil {
		targetParentID = cleanUUIDText(*parentFolderID)
		if targetParentID == folderID {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		parentChanged = (!currentParent.Valid && targetParentID != "") || (currentParent.Valid && currentParent.String != targetParentID)
		parent = nil
	}
	if parentFolderID != nil && targetParentID != "" {
		var parentEntryType string
		if err := tx.QueryRowContext(ctx, `
select entry_type
from communications_shared_inbox_folders
where company_id=$1::uuid and folder_id=$2::uuid`, companyID, targetParentID).Scan(&parentEntryType); errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		} else if err != nil {
			return domain.CompanyExplorerFolder{}, err
		}
		if normalizeCommunicationsSharedInboxEntryType(parentEntryType, false) == CommunicationsSharedInboxEntryTypeSharedInbox {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		var createsCycle bool
		if err := tx.QueryRowContext(ctx, `
with recursive descendants as (
  select folder_id
  from communications_shared_inbox_folders
  where company_id=$1::uuid and folder_id=$2::uuid
  union all
  select child.folder_id
  from communications_shared_inbox_folders child
  join descendants parent on child.company_id=$1::uuid and child.parent_folder_id=parent.folder_id
)
select exists(select 1 from descendants where folder_id=$3::uuid)`, companyID, folderID, targetParentID).Scan(&createsCycle); err != nil {
			return domain.CompanyExplorerFolder{}, err
		}
		if createsCycle {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		parent = targetParentID
	}
	if position <= 0 {
		if parentChanged {
			position, err = nextCommunicationsSharedInboxPositionSQL(ctx, tx, companyID, parent)
			if err != nil {
				return domain.CompanyExplorerFolder{}, err
			}
		} else {
			position = currentPosition
		}
	}
	item, err := scanCommunicationsSharedInboxFolder(tx.QueryRowContext(ctx, `
update communications_shared_inbox_folders
set parent_folder_id=$3::uuid,
    position=$4,
    updated_timestamp=now()
where company_id=$1::uuid and folder_id=$2::uuid
returning company_id::text, folder_id::text, parent_folder_id::text, entry_type, name, coalesce(default_access, $5), account_email, position, created_timestamp, updated_timestamp`,
		companyID, folderID, parent, position, ResourceDefaultAccessEdit,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return r.getCommunicationsSharedInboxFolder(ctx, companyID, item.FolderID)
}

func (r *PostgresRepo) RenameCommunicationsSharedInboxFolder(companyID, folderID, name string) (domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	name = strings.TrimSpace(name)
	if companyID == "" || folderID == "" || name == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	ctx := context.Background()
	item, err := scanCommunicationsSharedInboxFolder(r.db.QueryRowContext(ctx, `
update communications_shared_inbox_folders
set name=$3,
    updated_timestamp=now()
where company_id=$1::uuid and folder_id=$2::uuid
returning company_id::text, folder_id::text, parent_folder_id::text, entry_type, name, coalesce(default_access, $4), account_email, position, created_timestamp, updated_timestamp`,
		companyID, folderID, name, ResourceDefaultAccessEdit,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
		}
		return domain.CompanyExplorerFolder{}, err
	}
	return r.getCommunicationsSharedInboxFolder(ctx, companyID, item.FolderID)
}

func (r *PostgresRepo) DeleteCommunicationsSharedInboxFolder(companyID, folderID string) error {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	if companyID == "" || folderID == "" {
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
  select folder_id
  from communications_shared_inbox_folders
  where company_id=$1::uuid and folder_id=$2::uuid
  union all
  select child.folder_id
  from communications_shared_inbox_folders child
  join subtree parent on child.company_id=$1::uuid and child.parent_folder_id=parent.folder_id
)
select folder_id::text from subtree`, companyID, folderID)
	if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return ErrSharedInboxStorageUnavailable
		}
		return err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(ids) == 0 {
		return ErrNotFound
	}
	idList := strings.Join(ids, ",")
	if _, err := tx.ExecContext(ctx, `
delete from resource_permissions
where company_id=$1::uuid
  and resource_type=$2
  and resource_id = any(string_to_array($3, ',')::uuid[])`, companyID, EntityTypeSharedTriageFolder, idList); err != nil && !isPostgresUndefinedTable(err, "resource_permissions") {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
delete from resource_access_grants
where company_id=$1::uuid
  and resource_type=$2
  and resource_id = any(string_to_array($3, ',')::uuid[])`, companyID, EntityTypeSharedTriageFolder, idList); err != nil && !isPostgresUndefinedTable(err, "resource_access_grants") {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
delete from resource_raci_assignments
where company_id=$1::uuid
  and resource_type=$2
  and resource_id = any(string_to_array($3, ',')::uuid[])`, companyID, EntityTypeSharedTriageFolder, idList); err != nil && !isPostgresUndefinedTable(err, "resource_raci_assignments") {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
delete from communications_shared_inbox_folders
where company_id=$1::uuid and folder_id=$2::uuid`, companyID, folderID); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) SetCommunicationsSharedInboxAccountEmail(companyID, folderID, accountEmail string) (domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	accountEmail = normalizeEmail(accountEmail)
	if companyID == "" || folderID == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	defer tx.Rollback()

	var entryType string
	if err := tx.QueryRowContext(ctx, `
select entry_type
from communications_shared_inbox_folders
where company_id=$1::uuid and folder_id=$2::uuid
for update`, companyID, folderID).Scan(&entryType); errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	} else if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
		}
		return domain.CompanyExplorerFolder{}, err
	}
	entryType = normalizeCommunicationsSharedInboxEntryType(entryType, false)
	if accountEmail != "" && entryType != CommunicationsSharedInboxEntryTypeSharedInbox {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	var accountParam any
	if accountEmail != "" {
		available, err := postgresCompanyHasConnectedEmailAccount(ctx, tx, companyID, accountEmail)
		if err != nil {
			return domain.CompanyExplorerFolder{}, err
		}
		if !available {
			return domain.CompanyExplorerFolder{}, ErrEmailAccountUnavailable
		}
		accountParam = accountEmail
	}
	item, err := scanCommunicationsSharedInboxFolder(tx.QueryRowContext(ctx, `
update communications_shared_inbox_folders
set account_email=$3,
    updated_timestamp=now()
where company_id=$1::uuid and folder_id=$2::uuid
returning company_id::text, folder_id::text, parent_folder_id::text, entry_type, name, coalesce(default_access, $4), account_email, position, created_timestamp, updated_timestamp`,
		companyID, folderID, accountParam, ResourceDefaultAccessEdit,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return r.getCommunicationsSharedInboxFolder(ctx, companyID, item.FolderID)
}
