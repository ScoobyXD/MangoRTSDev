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

const communicationsSharedInboxItemsCTE = `
with communications_shared_items as (
  select folder.company_id::text as company_id,
         folder.folder_id::text as folder_id,
         null::text as shared_inbox_id,
         folder.parent_folder_id::text as parent_folder_id,
         'folder'::text as entry_type,
         folder.name,
         folder.default_access,
         null::text as account_email,
         null::text as company_email_connection_id,
         folder.position,
         folder.created_timestamp,
         folder.updated_timestamp,
         'shared_inbox_folder'::text as resource_type
  from shared_inbox_folders folder
  union all
  select inbox.company_id::text as company_id,
         inbox.shared_inbox_id::text as folder_id,
         inbox.shared_inbox_id::text as shared_inbox_id,
         inbox.parent_folder_id::text as parent_folder_id,
         'shared_inbox'::text as entry_type,
         inbox.name,
         inbox.default_access,
         inbox.account_email,
         inbox.company_email_connection_id::text,
         inbox.position,
         inbox.created_timestamp,
         inbox.updated_timestamp,
         'shared_inbox'::text as resource_type
  from shared_inboxes inbox
)
`

type communicationsSharedInboxFolderScanner interface {
	Scan(dest ...any) error
}

func scanCommunicationsSharedInboxFolder(row communicationsSharedInboxFolderScanner) (domain.CompanyExplorerFolder, error) {
	var item domain.CompanyExplorerFolder
	var sharedInboxID sql.NullString
	var parent sql.NullString
	var accountEmail sql.NullString
	var companyEmailConnectionID sql.NullString
	var entryType string
	err := row.Scan(
		&item.CompanyID,
		&item.FolderID,
		&sharedInboxID,
		&parent,
		&entryType,
		&item.Name,
		&item.DefaultAccess,
		&accountEmail,
		&companyEmailConnectionID,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if err != nil {
		return item, err
	}
	item.FolderKind = "communications"
	item.EntryType = normalizeCommunicationsSharedInboxEntryType(entryType, accountEmail.Valid || sharedInboxID.Valid)
	item.ScopeType = CompanyExplorerFolderScopeCompany
	if sharedInboxID.Valid {
		item.SharedInboxID = sharedInboxID.String
	}
	if parent.Valid {
		item.ParentFolderID = &parent.String
	}
	if accountEmail.Valid {
		item.AccountEmail = &accountEmail.String
	}
	if companyEmailConnectionID.Valid {
		item.CompanyEmailConnectionID = companyEmailConnectionID.String
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

func CommunicationsSharedInboxResourceType(item domain.CompanyExplorerFolder) string {
	return communicationsSharedInboxResourceType(item.EntryType, item.AccountEmail != nil || item.SharedInboxID != "")
}

func CommunicationsSharedInboxGVICResourceType(item domain.CompanyExplorerFolder) string {
	if normalizeCommunicationsSharedInboxEntryType(item.EntryType, item.AccountEmail != nil || item.SharedInboxID != "") == CommunicationsSharedInboxEntryTypeSharedInbox {
		return EntityTypeSharedInbox
	}
	return EntityTypeSharedTriageFolder
}

func communicationsSharedInboxResourceType(entryType string, hasAccountEmail bool) string {
	if normalizeCommunicationsSharedInboxEntryType(entryType, hasAccountEmail) == CommunicationsSharedInboxEntryTypeSharedInbox {
		return EntityTypeSharedInbox
	}
	return EntityTypeSharedInboxFolder
}

func postgresSharedInboxStorageUnavailable(err error) bool {
	return isPostgresUndefinedTable(err, "shared_inbox_folders") ||
		isPostgresUndefinedTable(err, "shared_inboxes") ||
		isPostgresUndefinedColumn(err, "")
}

func nextCommunicationsSharedInboxPositionSQL(ctx context.Context, tx *sql.Tx, companyID string, parent any) (int, error) {
	var position int
	err := tx.QueryRowContext(ctx, `
with positions as (
  select position
  from shared_inbox_folders
  where company_id=$1::uuid
    and (($2::uuid is null and parent_folder_id is null) or parent_folder_id=$2::uuid)
  union all
  select position
  from shared_inboxes
  where company_id=$1::uuid
    and (($2::uuid is null and parent_folder_id is null) or parent_folder_id=$2::uuid)
)
select coalesce(max(position), 0) + 1000 from positions`, companyID, parent).Scan(&position)
	return position, err
}

func postgresLockCommunicationsSharedInboxItemTx(ctx context.Context, tx *sql.Tx, companyID, itemID string) (string, sql.NullString, int, error) {
	var parent sql.NullString
	var position int
	err := tx.QueryRowContext(ctx, `
select parent_folder_id::text, position
from shared_inbox_folders
where company_id=$1::uuid and folder_id=$2::uuid
for update`, companyID, itemID).Scan(&parent, &position)
	if err == nil {
		return CommunicationsSharedInboxEntryTypeFolder, parent, position, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", parent, 0, err
	}
	err = tx.QueryRowContext(ctx, `
select parent_folder_id::text, position
from shared_inboxes
where company_id=$1::uuid and shared_inbox_id=$2::uuid
for update`, companyID, itemID).Scan(&parent, &position)
	if err == nil {
		return CommunicationsSharedInboxEntryTypeSharedInbox, parent, position, nil
	}
	return "", parent, 0, err
}

func (r *PostgresRepo) getCommunicationsSharedInboxFolder(ctx context.Context, companyID, folderID string) (domain.CompanyExplorerFolder, error) {
	item, err := scanCommunicationsSharedInboxFolder(r.db.QueryRowContext(ctx, communicationsSharedInboxItemsCTE+`
select company_id,
       folder_id,
       shared_inbox_id,
       parent_folder_id,
       entry_type,
       name,
       coalesce(default_access, $3),
       account_email,
       company_email_connection_id,
       position,
       created_timestamp,
       updated_timestamp
from communications_shared_items
where company_id=$1 and folder_id=$2`, companyID, folderID, ResourceDefaultAccessEdit))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
		}
		return domain.CompanyExplorerFolder{}, err
	}
	items, err := r.attachCommunicationsSharedInboxGVICAssignments(ctx, companyID, []domain.CompanyExplorerFolder{item})
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
		if exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from shared_inbox_folders where company_id=$1::uuid and folder_id=$2::uuid)`, companyID, parentFolderID); err != nil {
			if postgresSharedInboxStorageUnavailable(err) {
				return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
			}
			return domain.CompanyExplorerFolder{}, err
		} else if !exists {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		parent = parentFolderID
	}

	if accountEmail != "" {
		available, err := postgresCompanyHasConnectedEmailAccount(ctx, tx, companyID, accountEmail)
		if err != nil {
			return domain.CompanyExplorerFolder{}, err
		}
		if !available {
			return domain.CompanyExplorerFolder{}, ErrEmailAccountUnavailable
		}
	}
	var companyEmailConnectionID sql.NullString
	if accountEmail != "" {
		if err := tx.QueryRowContext(ctx, `
select company_email_connection_id::text
from company_email_connections
where company_id=$1::uuid
  and account_email=$2
  and status='connected'
limit 1`, companyID, accountEmail).Scan(&companyEmailConnectionID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return domain.CompanyExplorerFolder{}, ErrEmailAccountUnavailable
			}
			return domain.CompanyExplorerFolder{}, err
		}
	}
	position, err := nextCommunicationsSharedInboxPositionSQL(ctx, tx, companyID, parent)
	if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
		}
		return domain.CompanyExplorerFolder{}, err
	}

	itemID := newUUIDv7String()
	if accountEmail == "" {
		if _, err := tx.ExecContext(ctx, `
insert into shared_inbox_folders (
  company_id,
  folder_id,
  parent_folder_id,
  name,
  default_access,
  position,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, now(), now())`,
			companyID, itemID, parent, name, ResourceDefaultAccessEdit, position,
		); err != nil {
			if postgresSharedInboxStorageUnavailable(err) {
				return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
			}
			return domain.CompanyExplorerFolder{}, err
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
insert into shared_inboxes (
  company_id,
  shared_inbox_id,
  parent_folder_id,
  name,
  account_email,
  company_email_connection_id,
  default_access,
  position,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid, $7, $8, now(), now())`,
			companyID, itemID, parent, name, accountEmail, companyEmailConnectionID, ResourceDefaultAccessEdit, position,
		); err != nil {
			if postgresSharedInboxStorageUnavailable(err) {
				return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
			}
			return domain.CompanyExplorerFolder{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return r.getCommunicationsSharedInboxFolder(ctx, companyID, itemID)
}

func (r *PostgresRepo) ListCommunicationsSharedInboxFolders(companyID string) ([]domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx, communicationsSharedInboxItemsCTE+`
select company_id,
       folder_id,
       shared_inbox_id,
       parent_folder_id,
       entry_type,
       name,
       coalesce(default_access, $2),
       account_email,
       company_email_connection_id,
       position,
       created_timestamp,
       updated_timestamp
from communications_shared_items
where company_id=$1
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
	items, err = r.attachCommunicationsSharedInboxGVICAssignments(ctx, companyID, items)
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
	rows, err := r.db.QueryContext(ctx, communicationsSharedInboxItemsCTE+`,
actor_access as (
  select exists (
    select 1
    from company_memberships membership
    where membership.user_id=$2::uuid
      and (
        membership.role='dev_admin'
        or (membership.company_id=$1::uuid and membership.role='company_admin')
      )
  ) as is_admin,
  exists (
    select 1
    from company_memberships membership
    where membership.company_id=$1::uuid
      and membership.user_id=$2::uuid
  ) as is_member
),
item_access as (
  select item.*
  from communications_shared_items item
  where item.company_id=$1::text
)
select item.company_id,
       item.folder_id,
       item.shared_inbox_id,
       item.parent_folder_id,
       item.entry_type,
       item.name,
       coalesce(item.default_access, $3),
       item.account_email,
       item.company_email_connection_id,
       item.position,
       item.created_timestamp,
       item.updated_timestamp,
       case
         when actor_access.is_admin then 'edit'
         when actor_access.is_member
          and mangorts_user_can_access_resource($1::uuid, item.resource_type, item.folder_id::uuid, $2::uuid, 'edit') then 'edit'
          else 'no_access'
        end as effective_access_level
from item_access item
cross join actor_access
where actor_access.is_admin
   or (
      actor_access.is_member
      and mangorts_user_can_access_resource($1::uuid, item.resource_type, item.folder_id::uuid, $2::uuid, 'edit')
    )
order by item.position asc, item.created_timestamp asc`, companyID, userID, ResourceDefaultAccessEdit)
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
		var sharedInboxID sql.NullString
		var parent sql.NullString
		var entryType string
		var accountEmail sql.NullString
		var companyEmailConnectionID sql.NullString
		if err := rows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&sharedInboxID,
			&parent,
			&entryType,
			&item.Name,
			&item.DefaultAccess,
			&accountEmail,
			&companyEmailConnectionID,
			&item.Position,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
			&item.EffectiveAccess,
		); err != nil {
			return nil, err
		}
		item.FolderKind = "communications"
		item.EntryType = normalizeCommunicationsSharedInboxEntryType(entryType, accountEmail.Valid || sharedInboxID.Valid)
		item.ScopeType = CompanyExplorerFolderScopeCompany
		item.DefaultAccess = defaultResourceAccessOrEdit(item.DefaultAccess)
		if sharedInboxID.Valid {
			item.SharedInboxID = sharedInboxID.String
		}
		if parent.Valid {
			item.ParentFolderID = &parent.String
		}
		if accountEmail.Valid {
			item.AccountEmail = &accountEmail.String
		}
		if companyEmailConnectionID.Valid {
			item.CompanyEmailConnectionID = companyEmailConnectionID.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items, err = r.attachCommunicationsSharedInboxGVICAssignments(ctx, companyID, items)
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

	entryType, currentParent, currentPosition, err := postgresLockCommunicationsSharedInboxItemTx(ctx, tx, companyID, folderID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if err != nil {
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
		if exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from shared_inbox_folders where company_id=$1::uuid and folder_id=$2::uuid)`, companyID, targetParentID); err != nil {
			return domain.CompanyExplorerFolder{}, err
		} else if !exists {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		if entryType == CommunicationsSharedInboxEntryTypeFolder {
			var createsCycle bool
			if err := tx.QueryRowContext(ctx, `
with recursive descendants as (
  select folder_id
  from shared_inbox_folders
  where company_id=$1::uuid and folder_id=$2::uuid
  union all
  select child.folder_id
  from shared_inbox_folders child
  join descendants parent on child.company_id=$1::uuid and child.parent_folder_id=parent.folder_id
)
select exists(select 1 from descendants where folder_id=$3::uuid)`, companyID, folderID, targetParentID).Scan(&createsCycle); err != nil {
				return domain.CompanyExplorerFolder{}, err
			}
			if createsCycle {
				return domain.CompanyExplorerFolder{}, ErrInvalid
			}
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
	if entryType == CommunicationsSharedInboxEntryTypeFolder {
		_, err = tx.ExecContext(ctx, `
update shared_inbox_folders
set parent_folder_id=$3::uuid,
    position=$4,
    updated_timestamp=now()
where company_id=$1::uuid and folder_id=$2::uuid`, companyID, folderID, parent, position)
	} else {
		_, err = tx.ExecContext(ctx, `
update shared_inboxes
set parent_folder_id=$3::uuid,
    position=$4,
    updated_timestamp=now()
where company_id=$1::uuid and shared_inbox_id=$2::uuid`, companyID, folderID, parent, position)
	}
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return r.getCommunicationsSharedInboxFolder(ctx, companyID, folderID)
}

func (r *PostgresRepo) RenameCommunicationsSharedInboxFolder(companyID, folderID, name string) (domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	name = strings.TrimSpace(name)
	if companyID == "" || folderID == "" || name == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	defer tx.Rollback()
	entryType, _, _, err := postgresLockCommunicationsSharedInboxItemTx(ctx, tx, companyID, folderID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
		}
		return domain.CompanyExplorerFolder{}, err
	}
	if entryType == CommunicationsSharedInboxEntryTypeFolder {
		_, err = tx.ExecContext(ctx, `
update shared_inbox_folders
set name=$3,
    updated_timestamp=now()
where company_id=$1::uuid and folder_id=$2::uuid`, companyID, folderID, name)
	} else {
		_, err = tx.ExecContext(ctx, `
update shared_inboxes
set name=$3,
    updated_timestamp=now()
where company_id=$1::uuid and shared_inbox_id=$2::uuid`, companyID, folderID, name)
	}
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return r.getCommunicationsSharedInboxFolder(ctx, companyID, folderID)
}

func (r *PostgresRepo) DeleteCommunicationsSharedInboxFolder(companyID, folderID string) error {
	return r.deleteCommunicationsSharedInboxFolder(companyID, folderID, true)
}

func (r *PostgresRepo) RemoveCommunicationsSharedInboxFolder(companyID, folderID string) error {
	return r.deleteCommunicationsSharedInboxFolder(companyID, folderID, false)
}

func (r *PostgresRepo) deleteCommunicationsSharedInboxFolder(companyID, folderID string, deleteCompanyConnections bool) error {
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

	entryType, _, _, err := postgresLockCommunicationsSharedInboxItemTx(ctx, tx, companyID, folderID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return ErrSharedInboxStorageUnavailable
		}
		return err
	}

	if entryType == CommunicationsSharedInboxEntryTypeFolder {
		rows, err := tx.QueryContext(ctx, `
with recursive subtree as (
  select folder_id
  from shared_inbox_folders
  where company_id=$1::uuid and folder_id=$2::uuid
  union all
  select child.folder_id
  from shared_inbox_folders child
  join subtree parent on child.company_id=$1::uuid and child.parent_folder_id=parent.folder_id
)
select folder_id::text from subtree`, companyID, folderID)
		if err != nil {
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
		sharedInboxIDs := make([]string, 0)
		companyEmailConnectionIDs := make([]string, 0)
		if deleteCompanyConnections {
			rows, err := tx.QueryContext(ctx, `
with target_connections as (
  select distinct company_email_connection_id
  from shared_inboxes
  where company_id=$1::uuid
    and parent_folder_id = any(string_to_array($2, ',')::uuid[])
    and company_email_connection_id is not null
),
target_inboxes as (
  select shared_inbox_id, company_email_connection_id
  from shared_inboxes
  where company_id=$1::uuid
    and (
      parent_folder_id = any(string_to_array($2, ',')::uuid[])
      or (
        company_email_connection_id is not null
        and company_email_connection_id in (select company_email_connection_id from target_connections)
      )
    )
)
select shared_inbox_id::text, coalesce(company_email_connection_id::text, '')
from target_inboxes`, companyID, idList)
			if err != nil {
				return err
			}
			connectionSeen := map[string]bool{}
			for rows.Next() {
				var inboxID string
				var connectionID string
				if err := rows.Scan(&inboxID, &connectionID); err != nil {
					rows.Close()
					return err
				}
				sharedInboxIDs = append(sharedInboxIDs, inboxID)
				if connectionID != "" && !connectionSeen[connectionID] {
					connectionSeen[connectionID] = true
					companyEmailConnectionIDs = append(companyEmailConnectionIDs, connectionID)
				}
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return err
			}
			if err := rows.Close(); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `
delete from resource_permissions
where company_id=$1::uuid
  and resource_type=$2
  and resource_id = any(string_to_array($3, ',')::uuid[])`, companyID, EntityTypeSharedInboxFolder, idList); err != nil && !isPostgresUndefinedTable(err, "resource_permissions") {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
delete from resource_gvic_assignments
where company_id=$1::uuid
  and resource_type=$2
  and resource_id = any(string_to_array($3, ',')::uuid[])`, companyID, EntityTypeSharedInboxFolder, idList); err != nil && !isPostgresUndefinedTable(err, "resource_gvic_assignments") {
			return err
		}
		if deleteCompanyConnections {
			if len(sharedInboxIDs) > 0 {
				sharedInboxIDList := strings.Join(sharedInboxIDs, ",")
				if _, err := tx.ExecContext(ctx, `
delete from resource_permissions
where company_id=$1::uuid
  and resource_type=$2
  and resource_id = any(string_to_array($3, ',')::uuid[])`, companyID, EntityTypeSharedInbox, sharedInboxIDList); err != nil && !isPostgresUndefinedTable(err, "resource_permissions") {
					return err
				}
				if _, err := tx.ExecContext(ctx, `
delete from resource_gvic_assignments
where company_id=$1::uuid
  and resource_type=$2
  and resource_id = any(string_to_array($3, ',')::uuid[])`, companyID, EntityTypeSharedInbox, sharedInboxIDList); err != nil && !isPostgresUndefinedTable(err, "resource_gvic_assignments") {
					return err
				}
				if _, err := tx.ExecContext(ctx, `
delete from shared_inboxes
where company_id=$1::uuid
  and shared_inbox_id = any(string_to_array($2, ',')::uuid[])`, companyID, sharedInboxIDList); err != nil {
					return err
				}
			}
		} else if _, err := tx.ExecContext(ctx, `
update shared_inboxes
set parent_folder_id=null,
    updated_timestamp=now()
where company_id=$1::uuid
  and parent_folder_id = any(string_to_array($2, ',')::uuid[])`, companyID, idList); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
delete from shared_inbox_folders
where company_id=$1::uuid and folder_id = any(string_to_array($2, ',')::uuid[])`, companyID, idList); err != nil {
			return err
		}
		if deleteCompanyConnections && len(companyEmailConnectionIDs) > 0 {
			connectionIDList := strings.Join(companyEmailConnectionIDs, ",")
			if _, err := tx.ExecContext(ctx, `
delete from company_email_connections
where company_id=$1::uuid
  and company_email_connection_id = any(string_to_array($2, ',')::uuid[])`, companyID, connectionIDList); err != nil && !isPostgresUndefinedTable(err, "company_email_connections") {
				return err
			}
		}
		return tx.Commit()
	}

	var companyEmailConnectionID sql.NullString
	if err := tx.QueryRowContext(ctx, `
select company_email_connection_id::text
from shared_inboxes
where company_id=$1::uuid and shared_inbox_id=$2::uuid`, companyID, folderID).Scan(&companyEmailConnectionID); errors.Is(err, sql.ErrNoRows) {
		if folderExists, err := postgresTxExists(ctx, tx, `select exists(select 1 from shared_inbox_folders where company_id=$1::uuid and folder_id=$2::uuid)`, companyID, folderID); err != nil {
			return err
		} else if folderExists {
			return ErrInvalid
		}
		return ErrNotFound
	} else if err != nil {
		return err
	}
	sharedInboxIDs := []string{folderID}
	if deleteCompanyConnections && companyEmailConnectionID.Valid {
		rows, err := tx.QueryContext(ctx, `
select shared_inbox_id::text
from shared_inboxes
where company_id=$1::uuid
  and company_email_connection_id=$2::uuid`, companyID, companyEmailConnectionID.String)
		if err != nil {
			return err
		}
		sharedInboxIDs = sharedInboxIDs[:0]
		for rows.Next() {
			var inboxID string
			if err := rows.Scan(&inboxID); err != nil {
				rows.Close()
				return err
			}
			sharedInboxIDs = append(sharedInboxIDs, inboxID)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
	}
	sharedInboxIDList := strings.Join(sharedInboxIDs, ",")
	if _, err := tx.ExecContext(ctx, `
delete from resource_permissions
where company_id=$1::uuid
  and resource_type=$2
  and resource_id = any(string_to_array($3, ',')::uuid[])`, companyID, EntityTypeSharedInbox, sharedInboxIDList); err != nil && !isPostgresUndefinedTable(err, "resource_permissions") {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
delete from resource_gvic_assignments
where company_id=$1::uuid
  and resource_type=$2
  and resource_id = any(string_to_array($3, ',')::uuid[])`, companyID, EntityTypeSharedInbox, sharedInboxIDList); err != nil && !isPostgresUndefinedTable(err, "resource_gvic_assignments") {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
delete from shared_inboxes
where company_id=$1::uuid
  and shared_inbox_id = any(string_to_array($2, ',')::uuid[])`, companyID, sharedInboxIDList); err != nil {
		return err
	}
	if deleteCompanyConnections && companyEmailConnectionID.Valid {
		if _, err := tx.ExecContext(ctx, `
delete from company_email_connections
where company_id=$1::uuid
  and company_email_connection_id=$2::uuid`, companyID, companyEmailConnectionID.String); err != nil && !isPostgresUndefinedTable(err, "company_email_connections") {
			return err
		}
	}
	return tx.Commit()
}

func (r *PostgresRepo) SetCommunicationsSharedInboxAccountEmail(companyID, folderID, accountEmail string) (domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	accountEmail = normalizeEmail(accountEmail)
	if companyID == "" || folderID == "" || accountEmail == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	defer tx.Rollback()

	if err := tx.QueryRowContext(ctx, `
select 1
from shared_inboxes
where company_id=$1::uuid and shared_inbox_id=$2::uuid
for update`, companyID, folderID).Scan(new(int)); errors.Is(err, sql.ErrNoRows) {
		if folderExists, err := postgresTxExists(ctx, tx, `select exists(select 1 from shared_inbox_folders where company_id=$1::uuid and folder_id=$2::uuid)`, companyID, folderID); err != nil {
			return domain.CompanyExplorerFolder{}, err
		} else if folderExists {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		return domain.CompanyExplorerFolder{}, ErrNotFound
	} else if err != nil {
		if postgresSharedInboxStorageUnavailable(err) {
			return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
		}
		return domain.CompanyExplorerFolder{}, err
	}
	available, err := postgresCompanyHasConnectedEmailAccount(ctx, tx, companyID, accountEmail)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	if !available {
		return domain.CompanyExplorerFolder{}, ErrEmailAccountUnavailable
	}
	var companyEmailConnectionID string
	if err := tx.QueryRowContext(ctx, `
select company_email_connection_id::text
from company_email_connections
where company_id=$1::uuid
  and account_email=$2
  and status='connected'
limit 1`, companyID, accountEmail).Scan(&companyEmailConnectionID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrEmailAccountUnavailable
		}
		return domain.CompanyExplorerFolder{}, err
	}
	if _, err := tx.ExecContext(ctx, `
update shared_inboxes
set account_email=$3,
    company_email_connection_id=$4::uuid,
    updated_timestamp=now()
where company_id=$1::uuid and shared_inbox_id=$2::uuid`, companyID, folderID, accountEmail, companyEmailConnectionID); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return r.getCommunicationsSharedInboxFolder(ctx, companyID, folderID)
}
