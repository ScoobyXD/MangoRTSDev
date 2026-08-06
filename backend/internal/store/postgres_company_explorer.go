package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

type companyExplorerFolderScanner interface {
	Scan(dest ...any) error
}

func scanCompanyExplorerFolder(row companyExplorerFolderScanner) (domain.CompanyExplorerFolder, error) {
	var item domain.CompanyExplorerFolder
	var parent sql.NullString
	var systemKey sql.NullString
	var accountEmail sql.NullString
	var scopeType sql.NullString
	var scopeID sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.FolderID,
		&parent,
		&item.FolderKind,
		&systemKey,
		&item.Name,
		&accountEmail,
		&scopeType,
		&scopeID,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if err != nil {
		return item, err
	}
	if parent.Valid {
		item.ParentFolderID = &parent.String
	}
	if systemKey.Valid {
		item.SystemKey = &systemKey.String
	}
	if accountEmail.Valid {
		item.AccountEmail = &accountEmail.String
	}
	if scopeType.Valid && strings.TrimSpace(scopeType.String) != "" {
		item.ScopeType = scopeType.String
	} else {
		item.ScopeType = CompanyExplorerFolderScopeCompany
	}
	if scopeID.Valid {
		item.ScopeID = &scopeID.String
	}
	return item, err
}

func scanCompanyExplorerFolderWithEffectiveAccess(row companyExplorerFolderScanner) (domain.CompanyExplorerFolder, error) {
	var item domain.CompanyExplorerFolder
	var parent sql.NullString
	var systemKey sql.NullString
	var accountEmail sql.NullString
	var scopeType sql.NullString
	var scopeID sql.NullString
	var effectiveAccess sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.FolderID,
		&parent,
		&item.FolderKind,
		&systemKey,
		&item.Name,
		&accountEmail,
		&scopeType,
		&scopeID,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
		&effectiveAccess,
	)
	if err != nil {
		return item, err
	}
	if parent.Valid {
		item.ParentFolderID = &parent.String
	}
	if systemKey.Valid {
		item.SystemKey = &systemKey.String
	}
	if accountEmail.Valid {
		item.AccountEmail = &accountEmail.String
	}
	if scopeType.Valid && strings.TrimSpace(scopeType.String) != "" {
		item.ScopeType = scopeType.String
	} else {
		item.ScopeType = CompanyExplorerFolderScopeCompany
	}
	if scopeID.Valid {
		item.ScopeID = &scopeID.String
	}
	if effectiveAccess.Valid {
		item.EffectiveAccess = effectiveAccess.String
	}
	return item, nil
}

func companyExplorerFolderAccountEmailColumn(includeAccountEmail bool, qualifier string) string {
	return "null::text as account_email"
}

func companyExplorerFolderScopeColumns(qualifier string) string {
	return "'company'::text as scope_type, null::text as scope_id"
}

func (r *PostgresRepo) getCompanyExplorerFolder(ctx context.Context, companyID, folderID string, includeAccountEmail bool) (domain.CompanyExplorerFolder, error) {
	item, err := scanCompanyExplorerFolder(r.db.QueryRowContext(ctx,
		`select company_id, folder_id, parent_folder_id, 'folder'::text as folder_kind, null::text as system_key, name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "")+`, `+companyExplorerFolderScopeColumns("")+`, position, created_timestamp, updated_timestamp
		 from company_explorer_folders
		 where company_id=$1 and folder_id=$2`,
		companyID, folderID,
	))
	if err != nil {
		if includeAccountEmail && isPostgresUndefinedColumn(err, "account_email") {
			return r.getCompanyExplorerFolder(ctx, companyID, folderID, false)
		}
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		return domain.CompanyExplorerFolder{}, err
	}
	return r.attachCompanyExplorerFolderMetadata(ctx, companyID, item)
}

func (r *PostgresRepo) attachCompanyExplorerFolderMetadata(ctx context.Context, companyID string, item domain.CompanyExplorerFolder) (domain.CompanyExplorerFolder, error) {
	if item.FolderKind == "communications" {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	return item, nil
}

func nextCompanyExplorerSQLRowPosition(ctx context.Context, tx *sql.Tx, companyID, folderKind string, parent any) (int, error) {
	defer observeTiming(ctx, "repo.nextCompanyExplorerSQLRowPosition")()
	var position int
	err := tx.QueryRowContext(ctx,
		`select coalesce(max(position), 0) + 1000
		 from (
		   select position
		 from company_explorer_folders
		 where company_id=$1
		     and (($2::uuid is null and parent_folder_id is null) or parent_folder_id=$2::uuid)
		   union all
		   select position
		   from company_explorer_items
		   where company_id=$1
		     and (($2::uuid is null and parent_folder_id is null) or parent_folder_id=$2::uuid)
		 ) explorer_siblings`,
		companyID, parent,
	).Scan(&position)
	return position, err
}

func (r *PostgresRepo) CreateCompanyExplorerFolder(companyID, parentFolderID, folderKind, name string) (domain.CompanyExplorerFolder, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	defer tx.Rollback()

	var parent any
	scopeType := CompanyExplorerFolderScopeCompany
	if parentFolderID != "" {
		var exists bool
		if err := tx.QueryRowContext(ctx,
			`select exists(
			   select 1
			   from company_explorer_folders
			   where company_id=$1::uuid and folder_id=$2::uuid
			 )`,
			companyID, parentFolderID,
		).Scan(&exists); err != nil {
			return domain.CompanyExplorerFolder{}, err
		}
		if !exists {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		parent = parentFolderID
	}

	position, err := nextCompanyExplorerSQLRowPosition(ctx, tx, companyID, folderKind, parent)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}

	item := domain.CompanyExplorerFolder{
		CompanyID:  companyID,
		FolderID:   newUUIDv7String(),
		FolderKind: "folder",
		Name:       name,
		ScopeType:  scopeType,
		Position:   position,
	}
	item, err = scanCompanyExplorerFolder(tx.QueryRowContext(ctx,
		`insert into company_explorer_folders
		 (company_id, folder_id, parent_folder_id, name, position, created_timestamp, updated_timestamp)
		 values ($1::uuid, $2::uuid, $3::uuid, $4, $5, now(), now())
		 returning company_id, folder_id, parent_folder_id, 'folder'::text as folder_kind, null::text as system_key, name, null::text as account_email, 'company'::text as scope_type, null::text as scope_id, position, created_timestamp, updated_timestamp`,
		item.CompanyID, item.FolderID, parent, item.Name, item.Position,
	))
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return r.getCompanyExplorerFolder(ctx, companyID, item.FolderID, true)
}

func (r *PostgresRepo) ListCompanyExplorerFolders(companyID, folderKind string) ([]domain.CompanyExplorerFolder, error) {
	if strings.TrimSpace(folderKind) == "communications" {
		return []domain.CompanyExplorerFolder{}, nil
	}
	ctx := context.Background()
	return r.queryCompanyExplorerFolders(ctx, companyID, folderKind, true)
}

func (r *PostgresRepo) ListVisibleCompanyExplorerFolders(companyID, folderKind, userID string) ([]domain.CompanyExplorerFolder, error) {
	if strings.TrimSpace(folderKind) == "communications" {
		return []domain.CompanyExplorerFolder{}, nil
	}
	ctx := context.Background()
	return r.queryVisibleCompanyExplorerFolders(ctx, companyID, folderKind, userID, true)
}

func (r *PostgresRepo) SetCompanyExplorerFolderScope(companyID, folderID, scopeType, scopeID string) (domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	if companyID == "" || folderID == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	return domain.CompanyExplorerFolder{}, ErrInvalid
}

func (r *PostgresRepo) queryCompanyExplorerFolders(ctx context.Context, companyID, folderKind string, includeAccountEmail bool) ([]domain.CompanyExplorerFolder, error) {
	rows, err := r.db.QueryContext(ctx,
		`select company_id, folder_id, parent_folder_id, 'folder'::text as folder_kind, null::text as system_key, name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "")+`, `+companyExplorerFolderScopeColumns("")+`, position, created_timestamp, updated_timestamp
		 from company_explorer_folders
		 where company_id=$1
		 order by position asc, created_timestamp asc`,
		companyID,
	)
	if err != nil {
		if includeAccountEmail && isPostgresUndefinedColumn(err, "account_email") {
			return r.queryCompanyExplorerFolders(ctx, companyID, folderKind, false)
		}
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyExplorerFolder, 0)
	for rows.Next() {
		item, err := scanCompanyExplorerFolder(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		if includeAccountEmail && isPostgresUndefinedColumn(err, "account_email") {
			return r.queryCompanyExplorerFolders(ctx, companyID, folderKind, false)
		}
		return nil, err
	}
	return items, nil
}

func (r *PostgresRepo) GetCompanyExplorerFolder(companyID, folderID string) (domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	if companyID == "" || folderID == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	if err := protectCompanyExplorerDefaultFolderMutation(companyID, folderID); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	ctx := context.Background()
	item, err := r.getCompanyExplorerFolder(ctx, companyID, folderID, true)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	defaultAccess, err := postgresResourceDefaultAccess(ctx, r.db, companyID, EntityTypeCompanyExplorerFolder, folderID)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	item.DefaultAccess = defaultAccess
	return item, nil
}

func (r *PostgresRepo) queryVisibleCompanyExplorerFolders(ctx context.Context, companyID, folderKind, userID string, includeAccountEmail bool) ([]domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(ctx,
		`with recursive visible_workspace_folder as (
		   select folder.folder_id as resource_id,
		          case
		            when exists (
		              select 1
		              from company_memberships membership
		              where membership.user_id=$2::uuid
		                and (
		                  membership.role='dev_admin'
		                  or (membership.company_id=$1::uuid and membership.role='company_admin')
		                )
		            ) then 'edit'
		            when mangorts_user_can_access_resource(folder.company_id, 'company_explorer_folder', folder.folder_id, $2::uuid, 'edit') then 'edit'
		            else 'edit'
		          end as access_level
		   from company_explorer_folders folder
		   where folder.company_id=$1::uuid
		     and folder.parent_folder_id is null
		     and mangorts_user_can_access_resource(folder.company_id, 'company_explorer_folder', folder.folder_id, $2::uuid, $3)
		   union all
		   select child.folder_id as resource_id,
		          case
		            when exists (
		              select 1
		              from company_memberships membership
		              where membership.user_id=$2::uuid
		                and (
		                  membership.role='dev_admin'
		                  or (membership.company_id=$1::uuid and membership.role='company_admin')
		                )
		            ) then 'edit'
		            when mangorts_user_can_access_resource(child.company_id, 'company_explorer_folder', child.folder_id, $2::uuid, 'edit') then 'edit'
		            else 'edit'
		          end as access_level
		   from company_explorer_folders child
		   join visible_workspace_folder parent
		     on parent.resource_id=child.parent_folder_id
		   where child.company_id=$1::uuid
		     and mangorts_user_can_access_resource(child.company_id, 'company_explorer_folder', child.folder_id, $2::uuid, $3)
		 )
		 select folder.company_id, folder.folder_id, folder.parent_folder_id, 'folder'::text as folder_kind, null::text as system_key, folder.name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "folder")+`, `+companyExplorerFolderScopeColumns("folder")+`, folder.position, folder.created_timestamp, folder.updated_timestamp,
		        visible_workspace_folder.access_level
		 from company_explorer_folders folder
		 join visible_workspace_folder on visible_workspace_folder.resource_id=folder.folder_id
		 where folder.company_id=$1::uuid
		 order by folder.position asc, folder.created_timestamp asc`,
		companyID, userID, EntityPermissionEdit,
	)
	if err != nil {
		if includeAccountEmail && isPostgresUndefinedColumn(err, "account_email") {
			return r.queryVisibleCompanyExplorerFolders(ctx, companyID, folderKind, userID, false)
		}
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyExplorerFolder, 0)
	for rows.Next() {
		item, err := scanCompanyExplorerFolderWithEffectiveAccess(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		if includeAccountEmail && isPostgresUndefinedColumn(err, "account_email") {
			return r.queryVisibleCompanyExplorerFolders(ctx, companyID, folderKind, userID, false)
		}
		return nil, err
	}
	return items, nil
}

func (r *PostgresRepo) ListCompanyExplorerFolderSubtree(companyID, folderID, folderKind string) ([]domain.CompanyExplorerFolder, error) {
	if strings.TrimSpace(folderID) == "" {
		return r.ListCompanyExplorerFolders(companyID, folderKind)
	}
	ctx := context.Background()
	return r.queryCompanyExplorerFolderSubtree(ctx, companyID, folderID, folderKind, true)
}

func (r *PostgresRepo) ListVisibleCompanyExplorerFolderSubtree(companyID, folderID, folderKind, userID string) ([]domain.CompanyExplorerFolder, error) {
	if strings.TrimSpace(folderID) == "" {
		return r.ListVisibleCompanyExplorerFolders(companyID, folderKind, userID)
	}
	ctx := context.Background()
	return r.queryVisibleCompanyExplorerFolderSubtree(ctx, companyID, folderID, folderKind, userID, true)
}

func (r *PostgresRepo) queryCompanyExplorerFolderSubtree(ctx context.Context, companyID, folderID, folderKind string, includeAccountEmail bool) ([]domain.CompanyExplorerFolder, error) {
	rows, err := r.db.QueryContext(ctx, `
with recursive subtree as (
  select company_id, folder_id, parent_folder_id, 'folder'::text as folder_kind, null::text as system_key, name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "")+`, `+companyExplorerFolderScopeColumns("")+`, position, created_timestamp, updated_timestamp
  from company_explorer_folders
  where company_id=$1
    and folder_id=$2::uuid
  union all
  select child.company_id, child.folder_id, child.parent_folder_id, 'folder'::text as folder_kind, null::text as system_key, child.name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "child")+`, `+companyExplorerFolderScopeColumns("child")+`, child.position, child.created_timestamp, child.updated_timestamp
  from company_explorer_folders child
  join subtree parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
)
select company_id, folder_id, parent_folder_id, folder_kind, system_key, name, account_email, scope_type, scope_id, position, created_timestamp, updated_timestamp
from subtree
order by position asc, created_timestamp asc`, companyID, strings.TrimSpace(folderID))
	if err != nil {
		if includeAccountEmail && isPostgresUndefinedColumn(err, "account_email") {
			return r.queryCompanyExplorerFolderSubtree(ctx, companyID, folderID, folderKind, false)
		}
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyExplorerFolder, 0)
	for rows.Next() {
		item, err := scanCompanyExplorerFolder(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		if includeAccountEmail && isPostgresUndefinedColumn(err, "account_email") {
			return r.queryCompanyExplorerFolderSubtree(ctx, companyID, folderID, folderKind, false)
		}
		return nil, err
	}
	return items, nil
}

func (r *PostgresRepo) queryVisibleCompanyExplorerFolderSubtree(ctx context.Context, companyID, folderID, folderKind, userID string, includeAccountEmail bool) ([]domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" || userID == "" || folderID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(ctx, `
with recursive subtree as (
  select company_id, folder_id, parent_folder_id, 'folder'::text as folder_kind, null::text as system_key, name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "")+`, `+companyExplorerFolderScopeColumns("")+`, position, created_timestamp, updated_timestamp
  from company_explorer_folders
  where company_id=$1::uuid
    and folder_id=$2::uuid
    and mangorts_user_can_access_resource(company_id, 'company_explorer_folder', folder_id, $3::uuid, $4)
  union all
  select child.company_id, child.folder_id, child.parent_folder_id, 'folder'::text as folder_kind, null::text as system_key, child.name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "child")+`, `+companyExplorerFolderScopeColumns("child")+`, child.position, child.created_timestamp, child.updated_timestamp
  from company_explorer_folders child
  join subtree parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
  where mangorts_user_can_access_resource(child.company_id, 'company_explorer_folder', child.folder_id, $3::uuid, $4)
), visible_workspace_folder as (
  select subtree.folder_id as resource_id,
         case
           when exists (
             select 1
             from company_memberships membership
             where membership.user_id=$3::uuid
               and (
                 membership.role='dev_admin'
                 or (membership.company_id=$1::uuid and membership.role='company_admin')
               )
           ) then 'edit'
           when mangorts_user_can_access_resource(subtree.company_id, 'company_explorer_folder', subtree.folder_id, $3::uuid, 'edit') then 'edit'
           else 'edit'
         end as access_level
  from subtree
  where mangorts_user_can_access_resource(subtree.company_id, 'company_explorer_folder', subtree.folder_id, $3::uuid, $4)
)
select subtree.company_id, subtree.folder_id, subtree.parent_folder_id, subtree.folder_kind, subtree.system_key, subtree.name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "subtree")+`, `+companyExplorerFolderScopeColumns("subtree")+`, subtree.position, subtree.created_timestamp, subtree.updated_timestamp,
       visible_workspace_folder.access_level
from subtree
join visible_workspace_folder on visible_workspace_folder.resource_id=subtree.folder_id
order by subtree.position asc, subtree.created_timestamp asc`, companyID, folderID, userID, EntityPermissionEdit)
	if err != nil {
		if includeAccountEmail && isPostgresUndefinedColumn(err, "account_email") {
			return r.queryVisibleCompanyExplorerFolderSubtree(ctx, companyID, folderID, folderKind, userID, false)
		}
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyExplorerFolder, 0)
	for rows.Next() {
		item, err := scanCompanyExplorerFolderWithEffectiveAccess(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		if includeAccountEmail && isPostgresUndefinedColumn(err, "account_email") {
			return r.queryVisibleCompanyExplorerFolderSubtree(ctx, companyID, folderID, folderKind, userID, false)
		}
		return nil, err
	}
	return items, nil
}

func (r *PostgresRepo) MoveCompanyExplorerFolder(companyID, folderID string, parentFolderID *string, position int) (domain.CompanyExplorerFolder, error) {
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
select parent_folder_id, position
from company_explorer_folders
where company_id=$1::uuid and folder_id=$2::uuid
for update`, companyID, folderID).Scan(&currentParent, &currentPosition); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		return domain.CompanyExplorerFolder{}, err
	}

	var parent any
	if currentParent.Valid {
		parent = currentParent.String
	}
	if parentFolderID != nil {
		targetParentID := cleanUUIDText(*parentFolderID)
		if targetParentID == folderID {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		parent = nil
		if targetParentID != "" {
			var createsCycle bool
			if err := tx.QueryRowContext(ctx, `
with recursive descendants as (
  select folder_id
  from company_explorer_folders
  where company_id=$1::uuid and folder_id=$2::uuid
  union all
  select child.folder_id
  from company_explorer_folders child
  join descendants parent on child.company_id=$1::uuid and child.parent_folder_id=parent.folder_id
)
select exists(select 1 from descendants where folder_id=$3::uuid)`, companyID, folderID, targetParentID).Scan(&createsCycle); err != nil {
				return domain.CompanyExplorerFolder{}, err
			}
			if createsCycle {
				return domain.CompanyExplorerFolder{}, ErrInvalid
			}
			var exists bool
			if err := tx.QueryRowContext(ctx, `
select exists(select 1 from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid)`, companyID, targetParentID).Scan(&exists); err != nil {
				return domain.CompanyExplorerFolder{}, err
			}
			if !exists {
				return domain.CompanyExplorerFolder{}, ErrNotFound
			}
			parent = targetParentID
		}
	}
	if position <= 0 {
		position = currentPosition
	}
	if position <= 0 {
		position, err = nextCompanyExplorerFinalPositionSQL(ctx, tx, companyID, parent)
		if err != nil {
			return domain.CompanyExplorerFolder{}, err
		}
	}
	var item domain.CompanyExplorerFolder
	var parentOut sql.NullString
	if err := tx.QueryRowContext(ctx, `
update company_explorer_folders
set parent_folder_id=$3::uuid,
    position=$4,
    updated_timestamp=now()
where company_id=$1::uuid and folder_id=$2::uuid
returning company_id::text, folder_id::text, parent_folder_id::text, name, default_access, position, created_timestamp, updated_timestamp`,
		companyID, folderID, parent, position).Scan(
		&item.CompanyID,
		&item.FolderID,
		&parentOut,
		&item.Name,
		&item.DefaultAccess,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		return domain.CompanyExplorerFolder{}, err
	}
	if parentOut.Valid {
		item.ParentFolderID = &parentOut.String
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return item, nil
}

func (r *PostgresRepo) RenameCompanyExplorerFolder(companyID, folderID, name string) (domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	name = strings.TrimSpace(name)
	if companyID == "" || folderID == "" || name == "" {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}
	if err := protectCompanyExplorerDefaultFolderMutation(companyID, folderID); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	ctx := context.Background()
	var item domain.CompanyExplorerFolder
	var parentOut sql.NullString
	if err := r.db.QueryRowContext(ctx, `
update company_explorer_folders
set name=$3,
    updated_timestamp=now()
where company_id=$1::uuid and folder_id=$2::uuid
returning company_id::text, folder_id::text, parent_folder_id::text, name, default_access, position, created_timestamp, updated_timestamp`, companyID, folderID, name).Scan(
		&item.CompanyID,
		&item.FolderID,
		&parentOut,
		&item.Name,
		&item.DefaultAccess,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		return domain.CompanyExplorerFolder{}, err
	}
	if parentOut.Valid {
		item.ParentFolderID = &parentOut.String
	}
	return item, nil
}

func (r *PostgresRepo) DeleteCompanyExplorerFolder(companyID, folderID string) error {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	if companyID == "" || folderID == "" {
		return ErrInvalid
	}
	if err := protectCompanyExplorerDefaultFolderMutation(companyID, folderID); err != nil {
		return err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "company_explorer_folder", folderID); err != nil {
		return err
	}
	deleted, err := tx.ExecContext(ctx, `
delete from company_explorer_folders
where company_id=$1::uuid and folder_id=$2::uuid`, companyID, folderID)
	if err != nil {
		return err
	}
	if affected, err := deleted.RowsAffected(); err != nil {
		return err
	} else if affected == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}
func postgresCompanyHasConnectedEmailAccount(ctx context.Context, tx *sql.Tx, companyID, accountEmail string) (bool, error) {
	var exists bool
	if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from email_connections connection
  where connection.company_id = $1::uuid
    and connection.connection_type = 'shared'
    and connection.account_email = $2
    and connection.status = 'connected'
)`, companyID, accountEmail).Scan(&exists); err != nil {
		return false, err
	}
	return exists, nil
}

func (r *PostgresRepo) DeleteCompanyExplorerTargets(companyID string, targets []CompanyExplorerDeleteTargetInput, deletedByUserID string) (CompanyExplorerDeleteResult, error) {
	return r.deleteCompanyExplorerTargets(companyID, targets, deletedByUserID, nil)
}

func (r *PostgresRepo) DeleteCompanyExplorerTargetsWithTiming(companyID string, targets []CompanyExplorerDeleteTargetInput, deletedByUserID string, recorder TimingRecorder) (CompanyExplorerDeleteResult, error) {
	return r.deleteCompanyExplorerTargets(companyID, targets, deletedByUserID, recorder)
}

func (r *PostgresRepo) deleteCompanyExplorerTargets(companyID string, targets []CompanyExplorerDeleteTargetInput, deletedByUserID string, recorder TimingRecorder) (CompanyExplorerDeleteResult, error) {
	companyID = strings.TrimSpace(companyID)
	deletedByUserID = strings.TrimSpace(deletedByUserID)
	if companyID == "" || len(targets) == 0 {
		return CompanyExplorerDeleteResult{}, ErrInvalid
	}
	targets = normalizeCompanyExplorerDeleteTargets(targets)
	if len(targets) == 0 {
		return CompanyExplorerDeleteResult{}, ErrInvalid
	}
	for _, target := range targets {
		if !validCompanyExplorerDeleteKind(target.Kind) {
			return CompanyExplorerDeleteResult{}, ErrInvalid
		}
	}

	ctx := ContextWithTimingRecorder(context.Background(), recorder)
	defer observeTiming(ctx, "repo.DeleteCompanyExplorerTargets.total")()
	stop := observeTiming(ctx, "repo.DeleteCompanyExplorerTargets.begin")
	tx, err := r.db.BeginTx(ctx, nil)
	stop()
	if err != nil {
		return CompanyExplorerDeleteResult{}, err
	}
	defer tx.Rollback()

	folderRootIDs := map[string]bool{}
	folderIDs := map[string]bool{}
	folderKinds := map[string]string{}
	nodeIDs := map[string]bool{}
	directNodeIDs := map[string]bool{}
	logicGateIDs := map[string]bool{}
	directLogicGateIDs := map[string]bool{}
	projectIDs := map[string]bool{}
	directProjectIDs := map[string]bool{}
	kanbanBoardIDs := map[string]bool{}
	recycleRoots := make([]companyExplorerRecycleRootScope, 0, len(targets))

	stop = observeTiming(ctx, "repo.DeleteCompanyExplorerTargets.resolve_targets")
	for _, target := range targets {
		targetScope := newCompanyExplorerRecycleScope()
		switch target.Kind {
		case "folder":
			rows, err := tx.QueryContext(ctx,
				`with recursive subtree as (
				   select folder_id
				   from company_explorer_folders
				   where company_id=$1::uuid and folder_id=$2::uuid
				   union all
				   select child.folder_id
				   from company_explorer_folders child
				   join subtree parent on child.company_id=$1 and child.parent_folder_id=parent.folder_id
				 )
				 select folder_id::text
				 from subtree`,
				companyID, target.ID,
			)
			if err != nil {
				return CompanyExplorerDeleteResult{}, err
			}
			count := 0
			for rows.Next() {
				var folderID string
				if err := rows.Scan(&folderID); err != nil {
					rows.Close()
					return CompanyExplorerDeleteResult{}, err
				}
				if err := protectCompanyExplorerDefaultFolderMutation(companyID, folderID); err != nil {
					rows.Close()
					return CompanyExplorerDeleteResult{}, err
				}
				count++
				folderIDs[folderID] = true
				targetScope.FolderIDs[folderID] = true
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return CompanyExplorerDeleteResult{}, err
			}
			rows.Close()
			if count == 0 {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			folderRootIDs[target.ID] = true
		case "node":
			exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from nodes where company_id=$1 and node_id=$2)`, companyID, target.ID)
			if err != nil {
				return CompanyExplorerDeleteResult{}, err
			}
			if !exists {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			nodeIDs[target.ID] = true
			directNodeIDs[target.ID] = true
			targetScope.NodeIDs[target.ID] = true
		case "logic_gate":
			exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`, companyID, target.ID)
			if err != nil {
				return CompanyExplorerDeleteResult{}, err
			}
			if !exists {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			logicGateIDs[target.ID] = true
			directLogicGateIDs[target.ID] = true
			targetScope.LogicGateIDs[target.ID] = true
		case "project":
			exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from projects where company_id=$1 and project_id=$2)`, companyID, target.ID)
			if err != nil {
				return CompanyExplorerDeleteResult{}, err
			}
			if !exists {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			projectIDs[target.ID] = true
			directProjectIDs[target.ID] = true
			targetScope.ProjectIDs[target.ID] = true
		case "kanban":
			return CompanyExplorerDeleteResult{}, ErrInvalid
		}
		if err := postgresExpandCompanyExplorerRecycleScopeTx(ctx, tx, companyID, &targetScope); err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
		for folderID := range targetScope.FolderIDs {
			folderIDs[folderID] = true
			if kind := strings.TrimSpace(targetScope.FolderKinds[folderID]); kind != "" {
				folderKinds[folderID] = kind
			}
		}
		for nodeID := range targetScope.NodeIDs {
			nodeIDs[nodeID] = true
		}
		for logicGateID := range targetScope.LogicGateIDs {
			logicGateIDs[logicGateID] = true
		}
		for projectID := range targetScope.ProjectIDs {
			projectIDs[projectID] = true
		}
		for boardID := range targetScope.KanbanBoardIDs {
			kanbanBoardIDs[boardID] = true
		}
		recycleRoots = append(recycleRoots, companyExplorerRecycleRootScope{Target: target, Scope: targetScope})
	}
	stop()

	stop = observeTiming(ctx, "repo.DeleteCompanyExplorerTargets.validate_targets")
	for nodeID := range nodeIDs {
		exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from nodes where company_id=$1 and node_id=$2)`, companyID, nodeID)
		if err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
		if !exists {
			if directNodeIDs[nodeID] {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			delete(nodeIDs, nodeID)
		}
	}
	for logicGateID := range logicGateIDs {
		exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`, companyID, logicGateID)
		if err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
		if !exists {
			if directLogicGateIDs[logicGateID] {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			delete(logicGateIDs, logicGateID)
			continue
		}
	}
	for projectID := range projectIDs {
		exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from projects where company_id=$1 and project_id=$2)`, companyID, projectID)
		if err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
		if !exists {
			if directProjectIDs[projectID] {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			delete(projectIDs, projectID)
			continue
		}
	}
	stop()

	result := CompanyExplorerDeleteResult{Targets: make([]CompanyExplorerDeletedTarget, 0)}
	seenDeleted := map[string]bool{}
	appendSorted := func(kind string, ids map[string]bool) {
		values := make([]string, 0, len(ids))
		for id := range ids {
			values = append(values, id)
		}
		sort.Strings(values)
		for _, id := range values {
			folderKind := ""
			if kind == "folder" {
				folderKind = folderKinds[id]
			}
			result.Targets = appendCompanyExplorerDeletedTarget(result.Targets, seenDeleted, kind, id, folderKind)
		}
	}
	appendSorted("folder", folderIDs)
	appendSorted("node", nodeIDs)
	appendSorted("logic_gate", logicGateIDs)
	appendSorted("project", projectIDs)
	appendSorted("kanban", kanbanBoardIDs)
	events, err := r.appendDomainEventsTx(ctx, tx, companyExplorerTargetWorkspaceEventInputs(companyID, result.Targets, false))
	if err != nil {
		return CompanyExplorerDeleteResult{}, err
	}
	result.Events = events

	recycleCandidates := make([]companyExplorerRecycleRootScope, 0, len(recycleRoots))
	for index := range recycleRoots {
		recycleRoots[index].Scope.addLogicGateBoards()
		recycleCandidates = append(recycleCandidates, recycleRoots[index])
	}
	if len(recycleCandidates) > 0 {
		stop = observeTiming(ctx, "repo.DeleteCompanyExplorerTargets.recycle_bin_write")
		if err := postgresCreateRecycleBinItemsTx(ctx, tx, companyID, deletedByUserID, recycleCandidates); err != nil {
			stop()
			return CompanyExplorerDeleteResult{}, err
		}
		stop()
	}

	stop = observeTiming(ctx, "repo.DeleteCompanyExplorerTargets.folder_effective_delete")
	for folderID := range folderIDs {
		if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "company_explorer_folder", folderID); err != nil {
			stop()
			return CompanyExplorerDeleteResult{}, err
		}

	}
	stop()
	stop = observeTiming(ctx, "repo.DeleteCompanyExplorerTargets.logic_gate_delete")
	for logicGateID := range logicGateIDs {
		err := postgresDeleteLogicGateWithDependentProjectionsTx(ctx, tx, companyID, logicGateID)
		if err != nil {
			stop()
			return CompanyExplorerDeleteResult{}, err
		}
	}
	stop()
	stop = observeTiming(ctx, "repo.DeleteCompanyExplorerTargets.kanban_delete")
	for boardID := range kanbanBoardIDs {
		if err := postgresDeleteKanbanBoardTx(ctx, tx, companyID, boardID); err != nil {
			stop()
			return CompanyExplorerDeleteResult{}, err
		}
	}
	stop()
	stop = observeTiming(ctx, "repo.DeleteCompanyExplorerTargets.project_delete")
	for projectID := range projectIDs {
		if err := postgresDeleteProjectTx(ctx, tx, companyID, projectID); err != nil {
			stop()
			return CompanyExplorerDeleteResult{}, err
		}
	}
	stop()
	stop = observeTiming(ctx, "repo.DeleteCompanyExplorerTargets.node_delete")
	for nodeID := range nodeIDs {
		err := postgresDeleteNodeWithDependentProjectionsTx(ctx, tx, companyID, nodeID)
		if err != nil {
			stop()
			return CompanyExplorerDeleteResult{}, err
		}
	}
	stop()
	if len(folderIDs) > 0 {
		stop = observeTiming(ctx, "repo.DeleteCompanyExplorerTargets.folder_access_cleanup")
		grantFolderIDs := make([]string, 0, len(folderIDs))
		for folderID := range folderIDs {
			grantFolderIDs = append(grantFolderIDs, folderID)
		}
		if err := execOptionalPostgresShapeCleanupTx(tx, "resource_permissions",
			`delete from resource_permissions
			 where company_id=$1 and resource_type in ($2, $3, $4) and resource_id = any(string_to_array($5, ',')::uuid[])`,
			companyID, EntityTypeCompanyExplorerFolder, EntityTypeSharedInboxFolder, EntityTypeSharedInbox, strings.Join(grantFolderIDs, ","),
		); err != nil {
			stop()
			return CompanyExplorerDeleteResult{}, err
		}
		stop()
	}
	stop = observeTiming(ctx, "repo.DeleteCompanyExplorerTargets.folder_root_delete")
	for folderID := range folderRootIDs {
		if _, err := tx.ExecContext(ctx,
			`delete from company_explorer_folders
			 where company_id=$1 and folder_id=$2`,
			companyID, folderID,
		); err != nil {
			stop()
			return CompanyExplorerDeleteResult{}, err
		}
	}
	stop()

	stop = observeTiming(ctx, "repo.DeleteCompanyExplorerTargets.commit")
	if err := tx.Commit(); err != nil {
		stop()
		return CompanyExplorerDeleteResult{}, err
	}
	stop()
	return result, nil
}

func postgresDeleteCompanyExplorerV2NativeEntitiesTx(ctx context.Context, tx *sql.Tx, companyID, entityType string, ids map[string]bool) error {
	if len(ids) == 0 {
		return nil
	}
	values := make([]string, 0, len(ids))
	for id := range ids {
		values = append(values, id)
	}
	sort.Strings(values)
	_, err := tx.ExecContext(ctx, `
delete from company_explorer_items
where company_id=$1::uuid
  and target_type=$2
  and target_id = any(string_to_array($3, ',')::uuid[])`, companyID, entityType, strings.Join(values, ","))
	return err
}

func postgresTxExists(ctx context.Context, tx *sql.Tx, query string, args ...any) (bool, error) {
	var exists bool
	if err := tx.QueryRowContext(ctx, query, args...).Scan(&exists); err != nil {
		return false, err
	}
	return exists, nil
}

func execOptionalPostgresShapeCleanupTx(tx *sql.Tx, tableName, query string, args ...any) error {
	return execOptionalPostgresCleanup(tx, query, func(err error) bool {
		return isOptionalPostgresCleanupShapeError(err, tableName)
	}, args...)
}

func postgresDeleteNodeWithDependentProjectionsTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	defer observeTiming(ctx, "repo.postgresDeleteNodeWithDependentProjectionsTx.total")()
	stop := observeTiming(ctx, "repo.postgresDeleteNodeWithDependentProjectionsTx.projection_dependencies")
	err := syncNodeProjectionDependenciesTx(ctx, tx, NodeProjectionDependencyInput{
		CompanyID: companyID,
		NodeID:    nodeID,
		Delete:    true,
	})
	stop()
	if err != nil {
		return err
	}
	stop = observeTiming(ctx, "repo.postgresDeleteNodeWithDependentProjectionsTx.project_relationship_delete")
	if _, err := tx.ExecContext(ctx, `
delete from project_relationships
where company_id=$1::uuid
  and resource_type='node'
  and resource_id=$2::uuid`, companyID, nodeID); err != nil {
		stop()
		return err
	}
	stop()
	stop = observeTiming(ctx, "repo.postgresDeleteNodeWithDependentProjectionsTx.node_rows_delete")
	if err := postgresDeleteNodeRowsTx(ctx, tx, companyID, nodeID, false); err != nil {
		stop()
		return err
	}
	stop()
	return nil
}
func postgresDeleteNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	return postgresDeleteNodeRowsTx(ctx, tx, companyID, nodeID, true)
}

func postgresDeleteNodeRowsTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string, deleteProjectionRows bool) error {
	if err := retireNodeChatAttachmentRelationshipsTx(ctx, tx, companyID, nodeID); err != nil {
		return err
	}
	if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, EntityTypeNode, nodeID); err != nil {
		return err
	}
	defer observeTiming(ctx, "repo.postgresDeleteNodeRowsTx.total")()

	if deleteProjectionRows {

		stop := observeTiming(ctx, "repo.postgresDeleteNodeRowsTx.project_timeline_projection_delete")
		if err := deleteProjectManagementTimelineProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
			stop()
			return err
		}
		stop()
	}
	stop := observeTiming(ctx, "repo.postgresDeleteNodeRowsTx.project_timeline_items_delete")
	if _, err := tx.ExecContext(ctx,
		`delete from project_management_timeline_items
		 where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	); err != nil {
		stop()
		return err
	}
	stop()
	stop = observeTiming(ctx, "repo.postgresDeleteNodeRowsTx.node_relationships_delete")
	if _, err := tx.ExecContext(ctx,
		`delete from node_relationships
		 where company_id=$1 and (node_id_a=$2 or node_id_b=$2)`,
		companyID, nodeID,
	); err != nil {
		stop()
		return err
	}
	stop()
	if deleteProjectionRows {
		stop = observeTiming(ctx, "repo.postgresDeleteNodeRowsTx.kanban_projection_delete")
		if _, err := tx.ExecContext(ctx,
			`delete from kanban_board_projection
			 where company_id=$1 and node_id=$2`,
			companyID, nodeID,
		); err != nil {
			stop()
			return err
		}
		stop()
	}
	stop = observeTiming(ctx, "repo.postgresDeleteNodeRowsTx.node_delete")
	deleted, err := tx.ExecContext(ctx,
		`delete from nodes
		 where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	)
	if err != nil {
		stop()
		return err
	}
	affected, err := deleted.RowsAffected()
	if err != nil {
		stop()
		return err
	}
	if affected == 0 {
		stop()
		return ErrNotFound
	}
	stop()
	return nil
}

func postgresDeleteLogicGateWithDependentProjectionsTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	affectedNodeIDs, err := nodeIDsAssignedToLogicGatesTx(ctx, tx, companyID, []string{logicGateID})
	if err != nil {
		return err
	}
	if err := syncLogicGateProjectionDependenciesTx(ctx, tx, LogicGateProjectionDependencyInput{
		CompanyID:   companyID,
		LogicGateID: logicGateID,
		Delete:      true,
	}); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
delete from project_relationships
where company_id=$1::uuid
  and resource_type='logic_gate'
  and resource_id=$2::uuid`, companyID, logicGateID); err != nil {
		return err
	}
	if err := postgresDeleteLogicGateRowsTx(ctx, tx, companyID, logicGateID, false); err != nil {
		return err
	}
	for _, nodeID := range affectedNodeIDs {
		if err := syncNodeProjectionDependenciesTx(ctx, tx, NodeProjectionDependencyInput{
			CompanyID: companyID,
			NodeID:    nodeID,
		}); err != nil {
			return err
		}
	}
	return nil
}
func postgresDeleteLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	return postgresDeleteLogicGateRowsTx(ctx, tx, companyID, logicGateID, true)
}

func postgresDeleteLogicGateRowsTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string, deleteProjectionRows bool) error {
	if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, EntityTypeLogicGate, logicGateID); err != nil {
		return err
	}

	if deleteProjectionRows {

		if err := deleteProjectManagementTimelineProjectionForLogicGateTx(ctx, tx, companyID, logicGateID); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, "delete from project_management_timeline_items where company_id=$1 and logic_gate_id=$2", companyID, logicGateID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
delete from node_logic_gate_assignments
where company_id=$1::uuid and logic_gate_id=$2::uuid`, companyID, logicGateID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_relationships
		 where company_id=$1 and (logic_gate_id_a=$2 or logic_gate_id_b=$2)`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from company_explorer_items
		 where company_id=$1::uuid and target_type='logic_gate' and target_id=$2::uuid`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	if deleteProjectionRows {
		if err := deleteKanbanBoardProjectionForLogicGateTx(ctx, tx, companyID, logicGateID); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `delete from email_relationships
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, companyID, logicGateID); err != nil {
		return err
	}
	if err := execOptionalPostgresShapeCleanupTx(tx, "resource_permissions",
		`delete from resource_permissions
		 where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	deleted, err := tx.ExecContext(ctx,
		`delete from logic_gates
		 where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	)
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

func postgresDeleteKanbanBoardTx(ctx context.Context, tx *sql.Tx, companyID, boardID string) error {
	if LogicGateIDFromKanbanBoardID(boardID) != "" {
		return nil
	}
	return ErrNotFound
}

func assignCompanyExplorerFolderItemSQL(ctx context.Context, tx *sql.Tx, companyID, folderID, itemType, itemID string, position int) (domain.CompanyExplorerFolderItem, []string, error) {
	var err error
	var folderExists bool
	if err := tx.QueryRowContext(ctx,
		`select exists(select 1 from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid)`,
		companyID, folderID,
	).Scan(&folderExists); err != nil {
		return domain.CompanyExplorerFolderItem{}, nil, err
	}
	if !folderExists {
		return domain.CompanyExplorerFolderItem{}, nil, ErrNotFound
	}
	var exists bool
	var existsQuery string
	if itemType == "node" {
		return domain.CompanyExplorerFolderItem{}, nil, ErrInvalid
	} else if itemType == "logic_gate" {
		existsQuery = `select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`
	} else if itemType == EntityTypeProject {
		existsQuery = `select exists(select 1 from projects where company_id=$1 and project_id=$2)`
	} else {
		return domain.CompanyExplorerFolderItem{}, nil, ErrNotFound
	}
	if err := tx.QueryRowContext(ctx, existsQuery, companyID, itemID).Scan(&exists); err != nil {
		return domain.CompanyExplorerFolderItem{}, nil, err
	}
	if !exists {
		return domain.CompanyExplorerFolderItem{}, nil, ErrNotFound
	}

	var existingFolderID string
	var existingPosition int
	var hasExisting bool
	if err := tx.QueryRowContext(ctx,
		`select coalesce(parent_folder_id::text, ''), position
		 from company_explorer_items
		 where company_id=$1::uuid and target_type=$2 and target_id=$3::uuid
		 for update`,
		companyID, itemType, itemID,
	).Scan(&existingFolderID, &existingPosition); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolderItem{}, nil, err
		}
	} else {
		hasExisting = true
	}
	if position <= 0 && hasExisting && existingFolderID == folderID {
		position = existingPosition
	}
	if position <= 0 {
		position, err = nextCompanyExplorerSQLRowPosition(ctx, tx, companyID, itemType, folderID)
		if err != nil {
			return domain.CompanyExplorerFolderItem{}, nil, err
		}
	}

	var item domain.CompanyExplorerFolderItem
	if err := tx.QueryRowContext(ctx,
		`insert into company_explorer_items
		 (company_id, item_id, parent_folder_id, target_type, target_id, position, created_timestamp, updated_timestamp)
		 values ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, now(), now())
		 on conflict (company_id, target_type, target_id)
		 do update set
		   parent_folder_id=excluded.parent_folder_id,
		   position=excluded.position,
		   updated_timestamp=now()
		 returning company_id::text, coalesce(parent_folder_id::text, '') as folder_id, target_type, target_id::text, position, created_timestamp, updated_timestamp`,
		companyID, newUUIDv7String(), folderID, itemType, itemID, position,
	).Scan(
		&item.CompanyID,
		&item.FolderID,
		&item.ItemType,
		&item.ItemID,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); err != nil {
		return domain.CompanyExplorerFolderItem{}, nil, err
	}
	return item, nil, nil
}

func (r *PostgresRepo) AssignCompanyExplorerFolderItem(companyID, folderID, itemType, itemID string, position int) (domain.CompanyExplorerFolderItem, []string, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolderItem{}, nil, err
	}
	defer tx.Rollback()

	item, deletedRelationshipIDs, err := assignCompanyExplorerFolderItemSQL(ctx, tx, companyID, folderID, itemType, itemID, position)
	if err != nil {
		return domain.CompanyExplorerFolderItem{}, nil, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolderItem{}, nil, err
	}
	return item, deletedRelationshipIDs, nil
}

func (r *PostgresRepo) AssignCompanyExplorerFolderItems(companyID string, assignments []CompanyExplorerFolderItemAssignmentInput) ([]domain.CompanyExplorerFolderItem, []CompanyExplorerRelationshipDeleteResult, error) {
	if len(assignments) == 0 || len(assignments) > CompanyExplorerFolderItemBatchMaxItems {
		return nil, nil, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()

	items := make([]domain.CompanyExplorerFolderItem, 0, len(assignments))
	deleted := make([]CompanyExplorerRelationshipDeleteResult, 0)
	for _, assignment := range assignments {
		item, deletedRelationshipIDs, err := assignCompanyExplorerFolderItemSQL(ctx, tx, companyID, assignment.FolderID, assignment.ItemType, assignment.ItemID, assignment.Position)
		if err != nil {
			return nil, nil, err
		}
		items = append(items, item)
		if len(deletedRelationshipIDs) > 0 {
			deleted = append(deleted, CompanyExplorerRelationshipDeleteResult{
				ItemType:        assignment.ItemType,
				ItemID:          assignment.ItemID,
				RelationshipIDs: deletedRelationshipIDs,
			})
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	return items, deleted, nil
}

func (r *PostgresRepo) ListCompanyExplorerFolderItems(companyID, folderID, itemType string) ([]domain.CompanyExplorerFolderItem, error) {
	ctx := context.Background()
	if itemType == "kanban" {
		return []domain.CompanyExplorerFolderItem{}, nil
	}
	var folderParam any
	if folderID != "" {
		folderParam = folderID
	}
	var itemTypeParam any
	if itemType != "" {
		itemTypeParam = itemType
	}
	rows, err := r.db.QueryContext(ctx,
		`select company_id::text, coalesce(parent_folder_id::text, '') as folder_id, target_type, target_id::text, position, created_timestamp, updated_timestamp
		 from company_explorer_items
		 where company_id=$1::uuid
		   and target_type in ('project', 'logic_gate')
		   and ($2::uuid is null or parent_folder_id=$2::uuid)
		   and ($3::text is null or target_type=$3)
		 order by position asc, created_timestamp asc`,
		companyID, folderParam, itemTypeParam,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyExplorerFolderItem, 0)
	for rows.Next() {
		var item domain.CompanyExplorerFolderItem
		if err := rows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&item.ItemType,
			&item.ItemID,
			&item.Position,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListVisibleCompanyExplorerFolderItems(companyID, folderID, itemType, userID string) ([]domain.CompanyExplorerFolderItem, error) {
	ctx := context.Background()
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if itemType == "kanban" {
		return []domain.CompanyExplorerFolderItem{}, nil
	}
	var folderParam any
	if folderID != "" {
		folderParam = folderID
	}
	var itemTypeParam any
	if itemType != "" {
		itemTypeParam = itemType
	}
	rows, err := r.db.QueryContext(ctx,
		`select item.company_id::text, coalesce(item.parent_folder_id::text, '') as folder_id, item.target_type, item.target_id::text, item.position, item.created_timestamp, item.updated_timestamp
		 from company_explorer_items item
		 join company_explorer_folders folder
		   on folder.company_id=item.company_id
		  and folder.folder_id=item.parent_folder_id
		 where item.company_id=$1::uuid
		   and item.target_type in ('project', 'logic_gate')
		   and ($2::uuid is null or item.parent_folder_id=$2::uuid)
		   and ($3::text is null or item.target_type=$3)
		   and mangorts_user_can_access_resource(item.company_id, 'company_explorer_folder', item.parent_folder_id, $4::uuid, $5)
		   and mangorts_user_can_access_resource(
		     item.company_id,
		     item.target_type,
		     item.target_id,
		     $4::uuid,
		     $5
		   )
		 order by item.position asc, item.created_timestamp asc`,
		companyID, folderParam, itemTypeParam, userID, EntityPermissionEdit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyExplorerFolderItem, 0)
	for rows.Next() {
		var item domain.CompanyExplorerFolderItem
		if err := rows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&item.ItemType,
			&item.ItemID,
			&item.Position,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, itemType string) ([]domain.CompanyExplorerFolderItem, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListCompanyExplorerFolderItems(companyID, "", itemType)
	}
	if itemType == "kanban" {
		return []domain.CompanyExplorerFolderItem{}, nil
	}
	var itemTypeParam any
	if strings.TrimSpace(itemType) != "" {
		itemTypeParam = strings.TrimSpace(itemType)
	}
	rows, err := r.db.QueryContext(context.Background(), `
with recursive subtree as (
  select folder_id
  from company_explorer_folders
  where company_id=$1
    and folder_id=$2::uuid
  union all
  select child.folder_id
  from company_explorer_folders child
  join subtree parent on child.parent_folder_id=parent.folder_id
  where child.company_id=$1
)
select item.company_id::text, coalesce(item.parent_folder_id::text, '') as folder_id, item.target_type, item.target_id::text, item.position, item.created_timestamp, item.updated_timestamp
from company_explorer_items item
join subtree folder_scope on folder_scope.folder_id=item.parent_folder_id
where item.company_id=$1::uuid
  and item.target_type in ('project', 'logic_gate')
  and ($3::text is null or item.target_type=$3)
order by item.position asc, item.created_timestamp asc`, companyID, folderID, itemTypeParam)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.CompanyExplorerFolderItem, 0)
	for rows.Next() {
		var item domain.CompanyExplorerFolderItem
		if err := rows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&item.ItemType,
			&item.ItemID,
			&item.Position,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListVisibleCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, itemType, userID string) ([]domain.CompanyExplorerFolderItem, error) {
	companyID = cleanUUIDText(companyID)
	folderID = strings.TrimSpace(folderID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return r.ListVisibleCompanyExplorerFolderItems(companyID, "", itemType, userID)
	}
	if itemType == "kanban" {
		return []domain.CompanyExplorerFolderItem{}, nil
	}
	var itemTypeParam any
	if strings.TrimSpace(itemType) != "" {
		itemTypeParam = strings.TrimSpace(itemType)
	}
	rows, err := r.db.QueryContext(context.Background(), `
with recursive subtree as (
  select folder_id
  from company_explorer_folders
  where company_id=$1::uuid
    and folder_id=$2::uuid
    and mangorts_user_can_access_resource(company_id, 'company_explorer_folder', folder_id, $4::uuid, $5)
  union all
  select child.folder_id
  from company_explorer_folders child
  join subtree parent on child.parent_folder_id=parent.folder_id
  where child.company_id=$1::uuid
    and mangorts_user_can_access_resource(child.company_id, 'company_explorer_folder', child.folder_id, $4::uuid, $5)
)
select item.company_id::text, coalesce(item.parent_folder_id::text, '') as folder_id, item.target_type, item.target_id::text, item.position, item.created_timestamp, item.updated_timestamp
from company_explorer_items item
join subtree folder_scope on folder_scope.folder_id=item.parent_folder_id
join company_explorer_folders folder
  on folder.company_id=item.company_id
 and folder.folder_id=item.parent_folder_id
where item.company_id=$1::uuid
  and item.target_type in ('project', 'logic_gate')
  and ($3::text is null or item.target_type=$3)
  and mangorts_user_can_access_resource(item.company_id, 'company_explorer_folder', item.parent_folder_id, $4::uuid, $5)
  and mangorts_user_can_access_resource(
    item.company_id,
    item.target_type,
    item.target_id,
    $4::uuid,
    $5
  )
order by item.position asc, item.created_timestamp asc`, companyID, folderID, itemTypeParam, userID, EntityPermissionEdit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.CompanyExplorerFolderItem, 0)
	for rows.Next() {
		var item domain.CompanyExplorerFolderItem
		if err := rows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&item.ItemType,
			&item.ItemID,
			&item.Position,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanCompanyExplorerNodeSummaryRows(rows *sql.Rows) ([]domain.Node, error) {
	defer rows.Close()

	items := make([]domain.Node, 0)
	for rows.Next() {
		item, err := scanNode(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListCompanyExplorerNodeSummaries(companyID string) ([]domain.Node, error) {
	rows, err := r.db.QueryContext(context.Background(), `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1
order by n.created_timestamp asc, n.node_id::text asc`, companyID)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerNodeSummaryRows(rows)
}

func (r *PostgresRepo) ListVisibleCompanyExplorerNodeSummaries(companyID, userID string) ([]domain.Node, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1::uuid
  and mangorts_user_can_access_resource(n.company_id, 'node', n.node_id, $2::uuid, $3)
order by n.created_timestamp asc, n.node_id::text asc`, companyID, userID, EntityPermissionEdit)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerNodeSummaryRows(rows)
}

func (r *PostgresRepo) ListCompanyExplorerNodeSummariesInFolderSubtree(companyID, folderID string) ([]domain.Node, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListCompanyExplorerNodeSummaries(companyID)
	}
	return []domain.Node{}, nil
}

func (r *PostgresRepo) ListVisibleCompanyExplorerNodeSummariesInFolderSubtree(companyID, folderID, userID string) ([]domain.Node, error) {
	companyID = cleanUUIDText(companyID)
	folderID = strings.TrimSpace(folderID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return r.ListVisibleCompanyExplorerNodeSummaries(companyID, userID)
	}
	return []domain.Node{}, nil
}

func scanCompanyExplorerLogicGateSummaryRows(rows *sql.Rows) ([]domain.LogicGate, error) {
	defer rows.Close()

	items := make([]domain.LogicGate, 0)
	for rows.Next() {
		var item domain.LogicGate
		if err := rows.Scan(
			&item.CompanyID,
			&item.LogicGateID,
			&item.Header,
			&item.CreatedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListCompanyExplorerLogicGateSummaries(companyID string) ([]domain.LogicGate, error) {
	rows, err := r.db.QueryContext(context.Background(), `
select company_id, logic_gate_id, header, created_timestamp
from logic_gates
where company_id=$1
order by created_timestamp asc`, companyID)
	if err != nil {
		return nil, err
	}
	items, err := scanCompanyExplorerLogicGateSummaryRows(rows)
	if err != nil {
		return nil, err
	}
	return r.attachLogicGateGVICAssignments(context.Background(), companyID, items)
}

func (r *PostgresRepo) ListVisibleCompanyExplorerLogicGateSummaries(companyID, userID string) ([]domain.LogicGate, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
from logic_gates gate
where gate.company_id=$1::uuid
  and mangorts_user_can_access_resource(gate.company_id, 'logic_gate', gate.logic_gate_id, $2::uuid, $3)
order by gate.created_timestamp asc, gate.logic_gate_id::text asc`, companyID, userID, EntityPermissionEdit)
	if err != nil {
		return nil, err
	}
	items, err := scanCompanyExplorerLogicGateSummaryRows(rows)
	if err != nil {
		return nil, err
	}
	return r.attachLogicGateGVICAssignments(context.Background(), companyID, items)
}

func (r *PostgresRepo) ListCompanyExplorerLogicGateSummariesInFolderSubtree(companyID, folderID string) ([]domain.LogicGate, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListCompanyExplorerLogicGateSummaries(companyID)
	}
	rows, err := r.db.QueryContext(context.Background(), `
with recursive folder_scope as (
  select company_id, folder_id
  from company_explorer_folders
  where company_id=$1
    and folder_id=$2::uuid
  union all
  select child.company_id, child.folder_id
  from company_explorer_folders child
  join folder_scope parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
), visible_gates as (
  select distinct item.target_id as logic_gate_id
  from company_explorer_items item
  join folder_scope folder on folder.folder_id=item.parent_folder_id
  where item.company_id=$1::uuid
    and item.target_type='logic_gate'
)
select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
from logic_gates gate
join visible_gates visible on visible.logic_gate_id=gate.logic_gate_id
where gate.company_id=$1
order by gate.created_timestamp asc`, companyID, folderID)
	if err != nil {
		return nil, err
	}
	items, err := scanCompanyExplorerLogicGateSummaryRows(rows)
	if err != nil {
		return nil, err
	}
	return r.attachLogicGateGVICAssignments(context.Background(), companyID, items)
}

func (r *PostgresRepo) ListVisibleCompanyExplorerLogicGateSummariesInFolderSubtree(companyID, folderID, userID string) ([]domain.LogicGate, error) {
	companyID = cleanUUIDText(companyID)
	folderID = strings.TrimSpace(folderID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return r.ListVisibleCompanyExplorerLogicGateSummaries(companyID, userID)
	}
	rows, err := r.db.QueryContext(context.Background(), `
with recursive folder_scope as (
  select company_id, folder_id
  from company_explorer_folders
  where company_id=$1::uuid
    and folder_id=$2::uuid
    and mangorts_user_can_access_resource(company_id, 'company_explorer_folder', folder_id, $3::uuid, $4)
  union all
  select child.company_id, child.folder_id
  from company_explorer_folders child
  join folder_scope parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
  where mangorts_user_can_access_resource(child.company_id, 'company_explorer_folder', child.folder_id, $3::uuid, $4)
), folder_gates as (
  select distinct item.target_id as logic_gate_id
  from company_explorer_items item
  join folder_scope folder on folder.folder_id=item.parent_folder_id
  where item.company_id=$1::uuid
    and item.target_type='logic_gate'
)
select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
from logic_gates gate
join folder_gates visible on visible.logic_gate_id=gate.logic_gate_id
where gate.company_id=$1::uuid
  and mangorts_user_can_access_resource(gate.company_id, 'logic_gate', gate.logic_gate_id, $3::uuid, $4)
order by gate.created_timestamp asc, gate.logic_gate_id::text asc`, companyID, folderID, userID, EntityPermissionEdit)
	if err != nil {
		return nil, err
	}
	items, err := scanCompanyExplorerLogicGateSummaryRows(rows)
	if err != nil {
		return nil, err
	}
	return r.attachLogicGateGVICAssignments(context.Background(), companyID, items)
}

func (r *PostgresRepo) RemoveCompanyExplorerFolderItem(companyID, itemType, itemID string) error {
	ctx := context.Background()
	deleted, err := r.db.ExecContext(ctx,
		`delete from company_explorer_items
		 where company_id=$1::uuid and target_type=$2 and target_id=$3::uuid`,
		companyID, itemType, itemID,
	)
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
