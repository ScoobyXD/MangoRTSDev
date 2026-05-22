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
	err := row.Scan(
		&item.CompanyID,
		&item.FolderID,
		&parent,
		&item.FolderKind,
		&systemKey,
		&item.Name,
		&accountEmail,
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
	return item, err
}

func scanCompanyExplorerFolderWithEffectiveAccess(row companyExplorerFolderScanner) (domain.CompanyExplorerFolder, error) {
	var item domain.CompanyExplorerFolder
	var parent sql.NullString
	var systemKey sql.NullString
	var accountEmail sql.NullString
	var effectiveAccess sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.FolderID,
		&parent,
		&item.FolderKind,
		&systemKey,
		&item.Name,
		&accountEmail,
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
	if effectiveAccess.Valid {
		item.EffectiveAccess = effectiveAccess.String
	}
	return item, nil
}

func companyExplorerFolderAccountEmailColumn(includeAccountEmail bool, qualifier string) string {
	if !includeAccountEmail {
		return "null::text as account_email"
	}
	if strings.TrimSpace(qualifier) == "" {
		return "account_email"
	}
	return qualifier + ".account_email"
}

func companyExplorerCommunicationsFolderStorageUnavailable(err error, folderKind string) bool {
	if folderKind != "communications" {
		return false
	}
	if isPostgresUndefinedTable(err, "company_explorer_folders") {
		return true
	}
	return isPostgresUndefinedColumn(err, "")
}

func (r *PostgresRepo) getCompanyExplorerFolder(ctx context.Context, companyID, folderID string, includeAccountEmail bool) (domain.CompanyExplorerFolder, error) {
	item, err := scanCompanyExplorerFolder(r.db.QueryRowContext(ctx,
		`select company_id, folder_id, parent_folder_id, folder_kind, system_key, name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "")+`, position, created_timestamp, updated_timestamp
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
	if item.FolderKind != "communications" {
		return item, nil
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

func nextCompanyExplorerSQLRowPosition(ctx context.Context, tx *sql.Tx, companyID, folderKind string, parent any) (int, error) {
	var position int
	err := tx.QueryRowContext(ctx,
		`select coalesce(max(position), 0) + 1000
		 from (
		   select position
		   from company_explorer_folders
		   where company_id=$1
		     and folder_kind=$2
		     and (($3::uuid is null and parent_folder_id is null) or parent_folder_id=$3::uuid)
		   union all
		   select position
		   from company_explorer_folder_items
		   where company_id=$1
		     and folder_id=$3::uuid
		 ) explorer_siblings`,
		companyID, folderKind, parent,
	).Scan(&position)
	return position, err
}

func createCompanyExplorerDefaultFolderTreeSQL(ctx context.Context, tx *sql.Tx, companyID, folderKind string, parent any, startPosition int, seeds []companyExplorerDefaultFolderDefinition) error {
	for index, seed := range seeds {
		folderID := newUUIDv7String()
		if _, err := tx.ExecContext(ctx,
			`insert into company_explorer_folders
			 (company_id, folder_id, parent_folder_id, folder_kind, system_key, name, position, created_timestamp, updated_timestamp)
			 values ($1, $2, $3, $4, null, $5, $6, now(), now())`,
			companyID, folderID, parent, folderKind, seed.Name, startPosition+index*1000,
		); err != nil {
			return err
		}
		if len(seed.Children) > 0 {
			if err := createCompanyExplorerDefaultFolderTreeSQL(ctx, tx, companyID, folderKind, folderID, 1000, seed.Children); err != nil {
				return err
			}
		}
	}
	return nil
}

func ensureCompanyExplorerDefaultFoldersSQL(ctx context.Context, tx *sql.Tx, companyID string) error {
	if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtext('mangorts_company_explorer_default_folders'), hashtext($1))`, companyID); err != nil {
		return err
	}

	var insertedSystemSeed string
	err := tx.QueryRowContext(ctx,
		`insert into company_explorer_default_folder_seeds
		 (company_id, seed_key, created_timestamp)
		 values ($1, $2, now())
		 on conflict (company_id, seed_key) do nothing
		 returning seed_key`,
		companyID, companyExplorerSystemFolderSeedKey,
	).Scan(&insertedSystemSeed)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil {
		for _, seed := range companyExplorerSystemFolderSeeds {
			if _, err := tx.ExecContext(ctx,
				`insert into company_explorer_folders
				 (company_id, folder_id, parent_folder_id, folder_kind, system_key, name, position, created_timestamp, updated_timestamp)
				 values ($1, $2, null, 'node', $3, $4, $5, now(), now())
				 on conflict (company_id, system_key) where system_key is not null do nothing`,
				companyID, newUUIDv7String(), seed.Key, seed.Name, seed.Position,
			); err != nil {
				return err
			}
		}
	}

	var insertedSeed string
	err = tx.QueryRowContext(ctx,
		`insert into company_explorer_default_folder_seeds
		 (company_id, seed_key, created_timestamp)
		 values ($1, $2, now())
		 on conflict (company_id, seed_key) do nothing
		 returning seed_key`,
		companyID, companyExplorerDefaultFolderSeedKey,
	).Scan(&insertedSeed)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil {
		position, err := nextCompanyExplorerSQLRowPosition(ctx, tx, companyID, "logic_gate", nil)
		if err != nil {
			return err
		}
		rootID := newUUIDv7String()
		if _, err := tx.ExecContext(ctx,
			`insert into company_explorer_folders
			 (company_id, folder_id, parent_folder_id, folder_kind, system_key, name, position, created_timestamp, updated_timestamp)
			 values ($1, $2, null, 'logic_gate', null, 'Logic Gates', $3, now(), now())`,
			companyID, rootID, position,
		); err != nil {
			return err
		}
		for index, name := range companyExplorerDefaultLogicGateChildFolderNames {
			if _, err := tx.ExecContext(ctx,
				`insert into company_explorer_folders
				 (company_id, folder_id, parent_folder_id, folder_kind, system_key, name, position, created_timestamp, updated_timestamp)
				 values ($1, $2, $3, 'logic_gate', null, $4, $5, now(), now())`,
				companyID, newUUIDv7String(), rootID, name, (index+1)*1000,
			); err != nil {
				return err
			}
		}
	}

	var insertedCommunicationsSeed string
	err = tx.QueryRowContext(ctx,
		`insert into company_explorer_default_folder_seeds
		 (company_id, seed_key, created_timestamp)
		 values ($1, $2, now())
		 on conflict (company_id, seed_key) do nothing
		 returning seed_key`,
		companyID, companyExplorerDefaultCommunicationsFolderSeedKey,
	).Scan(&insertedCommunicationsSeed)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil {
		position, err := nextCompanyExplorerSQLRowPosition(ctx, tx, companyID, "communications", nil)
		if err != nil {
			return err
		}
		if err := createCompanyExplorerDefaultFolderTreeSQL(ctx, tx, companyID, "communications", nil, position, companyExplorerDefaultCommunicationsFolderTree); err != nil {
			return err
		}
	}

	return nil
}

func ensureCompanyExplorerSystemFolderSQL(ctx context.Context, tx *sql.Tx, companyID, systemKey string) (domain.CompanyExplorerFolder, error) {
	seed, ok := companyExplorerSystemFolderDefinitionForKey(systemKey)
	if !ok {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	if _, err := tx.ExecContext(ctx,
		`insert into company_explorer_folders
		 (company_id, folder_id, parent_folder_id, folder_kind, system_key, name, position, created_timestamp, updated_timestamp)
		 values ($1, $2, null, 'node', $3, $4, $5, now(), now())
		 on conflict (company_id, system_key) where system_key is not null do nothing`,
		companyID, newUUIDv7String(), seed.Key, seed.Name, seed.Position,
	); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}

	item, err := scanCompanyExplorerFolder(tx.QueryRowContext(ctx,
		`select company_id, folder_id, parent_folder_id, folder_kind, system_key, name, null::text as account_email, position, created_timestamp, updated_timestamp
		 from company_explorer_folders
		 where company_id=$1 and system_key=$2`,
		companyID, systemKey,
	))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		return domain.CompanyExplorerFolder{}, err
	}
	return item, nil
}

func (r *PostgresRepo) CreateCompanyExplorerFolder(companyID, parentFolderID, folderKind, name string) (domain.CompanyExplorerFolder, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	defer tx.Rollback()

	var parent any
	if parentFolderID != "" {
		var parentKind string
		if err := tx.QueryRowContext(ctx,
			`select folder_kind
			 from company_explorer_folders
			 where company_id=$1 and folder_id=$2`,
			companyID, parentFolderID,
		).Scan(&parentKind); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return domain.CompanyExplorerFolder{}, ErrNotFound
			}
			return domain.CompanyExplorerFolder{}, err
		}
		if parentKind != folderKind {
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
		FolderKind: folderKind,
		Name:       name,
		Position:   position,
	}
	item, err = scanCompanyExplorerFolder(tx.QueryRowContext(ctx,
		`insert into company_explorer_folders
		 (company_id, folder_id, parent_folder_id, folder_kind, system_key, name, position, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, null, $5, $6, now(), now())
		 returning company_id, folder_id, parent_folder_id, folder_kind, system_key, name, null::text as account_email, position, created_timestamp, updated_timestamp`,
		item.CompanyID, item.FolderID, parent, item.FolderKind, item.Name, item.Position,
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
	ctx := context.Background()
	return r.queryCompanyExplorerFolders(ctx, companyID, folderKind, true)
}

func (r *PostgresRepo) ListVisibleCompanyExplorerFolders(companyID, folderKind, userID string) ([]domain.CompanyExplorerFolder, error) {
	ctx := context.Background()
	return r.queryVisibleCompanyExplorerFolders(ctx, companyID, folderKind, userID, true)
}

func (r *PostgresRepo) queryCompanyExplorerFolders(ctx context.Context, companyID, folderKind string, includeAccountEmail bool) ([]domain.CompanyExplorerFolder, error) {
	var kindParam any
	if folderKind != "" {
		kindParam = folderKind
	}
	rows, err := r.db.QueryContext(ctx,
		`select company_id, folder_id, parent_folder_id, folder_kind, system_key, name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "")+`, position, created_timestamp, updated_timestamp
		 from company_explorer_folders
		 where company_id=$1
		   and ($2::text is null or folder_kind=$2)
		   and (system_key is null or system_key <> 'kanban_boards')
		 order by position asc, created_timestamp asc`,
		companyID, kindParam,
	)
	if err != nil {
		if includeAccountEmail && isPostgresUndefinedColumn(err, "account_email") {
			return r.queryCompanyExplorerFolders(ctx, companyID, folderKind, false)
		}
		if companyExplorerCommunicationsFolderStorageUnavailable(err, folderKind) {
			return nil, ErrSharedInboxStorageUnavailable
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
		if companyExplorerCommunicationsFolderStorageUnavailable(err, folderKind) {
			return nil, ErrSharedInboxStorageUnavailable
		}
		return nil, err
	}
	items, err = r.attachCommunicationsSharedInboxRaciAssignments(ctx, companyID, items)
	if err != nil {
		return nil, err
	}
	return r.attachCommunicationsSharedInboxAccessGrants(ctx, companyID, items)
}

func (r *PostgresRepo) queryVisibleCompanyExplorerFolders(ctx context.Context, companyID, folderKind, userID string, includeAccountEmail bool) ([]domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	var kindParam any
	if folderKind != "" {
		kindParam = folderKind
	}
	rows, err := r.db.QueryContext(ctx,
		`with visible_shared_triage as (
		   select access.resource_id,
		          (array_agg(access.access_level order by mangorts_access_level_rank(access.access_level) desc))[1]::text as access_level
		   from effective_resource_access access
		   where access.company_id=$1::uuid
		     and access.user_id=$3::uuid
		     and access.resource_type='shared_triage_folder'
		     and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($4)
		   group by access.resource_id
		 )
		 select folder.company_id, folder.folder_id, folder.parent_folder_id, folder.folder_kind, folder.system_key, folder.name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "folder")+`, folder.position, folder.created_timestamp, folder.updated_timestamp,
		        visible_shared_triage.access_level
		 from company_explorer_folders folder
		 left join visible_shared_triage on visible_shared_triage.resource_id=folder.folder_id
		 where folder.company_id=$1::uuid
		   and ($2::text is null or folder.folder_kind=$2)
		   and (folder.system_key is null or folder.system_key <> 'kanban_boards')
		   and (folder.folder_kind <> 'communications' or visible_shared_triage.resource_id is not null)
		 order by folder.position asc, folder.created_timestamp asc`,
		companyID, kindParam, userID, EntityPermissionView,
	)
	if err != nil {
		if includeAccountEmail && isPostgresUndefinedColumn(err, "account_email") {
			return r.queryVisibleCompanyExplorerFolders(ctx, companyID, folderKind, userID, false)
		}
		if companyExplorerCommunicationsFolderStorageUnavailable(err, folderKind) {
			return nil, ErrSharedInboxStorageUnavailable
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
		if companyExplorerCommunicationsFolderStorageUnavailable(err, folderKind) {
			return nil, ErrSharedInboxStorageUnavailable
		}
		return nil, err
	}
	items, err = r.attachCommunicationsSharedInboxRaciAssignments(ctx, companyID, items)
	if err != nil {
		return nil, err
	}
	return r.attachCommunicationsSharedInboxAccessGrants(ctx, companyID, items)
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
	var kindParam any
	if strings.TrimSpace(folderKind) != "" {
		kindParam = strings.TrimSpace(folderKind)
	}
	rows, err := r.db.QueryContext(ctx, `
with recursive subtree as (
  select company_id, folder_id, parent_folder_id, folder_kind, system_key, name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "")+`, position, created_timestamp, updated_timestamp
  from company_explorer_folders
  where company_id=$1
    and folder_id=$2::uuid
    and ($3::text is null or folder_kind=$3)
  union all
  select child.company_id, child.folder_id, child.parent_folder_id, child.folder_kind, child.system_key, child.name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "child")+`, child.position, child.created_timestamp, child.updated_timestamp
  from company_explorer_folders child
  join subtree parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
  where ($3::text is null or child.folder_kind=$3)
)
select company_id, folder_id, parent_folder_id, folder_kind, system_key, name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "")+`, position, created_timestamp, updated_timestamp
from subtree
where system_key is null or system_key <> 'kanban_boards'
order by position asc, created_timestamp asc`, companyID, strings.TrimSpace(folderID), kindParam)
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
	items, err = r.attachCommunicationsSharedInboxRaciAssignments(ctx, companyID, items)
	if err != nil {
		return nil, err
	}
	return r.attachCommunicationsSharedInboxAccessGrants(ctx, companyID, items)
}

func (r *PostgresRepo) queryVisibleCompanyExplorerFolderSubtree(ctx context.Context, companyID, folderID, folderKind, userID string, includeAccountEmail bool) ([]domain.CompanyExplorerFolder, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" || userID == "" || folderID == "" {
		return nil, ErrInvalid
	}
	var kindParam any
	if strings.TrimSpace(folderKind) != "" {
		kindParam = strings.TrimSpace(folderKind)
	}
	rows, err := r.db.QueryContext(ctx, `
with recursive subtree as (
  select company_id, folder_id, parent_folder_id, folder_kind, system_key, name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "")+`, position, created_timestamp, updated_timestamp
  from company_explorer_folders
  where company_id=$1::uuid
    and folder_id=$2::uuid
    and ($3::text is null or folder_kind=$3)
  union all
  select child.company_id, child.folder_id, child.parent_folder_id, child.folder_kind, child.system_key, child.name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "child")+`, child.position, child.created_timestamp, child.updated_timestamp
  from company_explorer_folders child
  join subtree parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
  where ($3::text is null or child.folder_kind=$3)
), visible_shared_triage as (
  select access.resource_id,
         (array_agg(access.access_level order by mangorts_access_level_rank(access.access_level) desc))[1]::text as access_level
  from effective_resource_access access
  where access.company_id=$1::uuid
    and access.user_id=$4::uuid
    and access.resource_type='shared_triage_folder'
    and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($5)
  group by access.resource_id
)
select subtree.company_id, subtree.folder_id, subtree.parent_folder_id, subtree.folder_kind, subtree.system_key, subtree.name, `+companyExplorerFolderAccountEmailColumn(includeAccountEmail, "subtree")+`, subtree.position, subtree.created_timestamp, subtree.updated_timestamp,
       visible_shared_triage.access_level
from subtree
left join visible_shared_triage on visible_shared_triage.resource_id=subtree.folder_id
where (subtree.system_key is null or subtree.system_key <> 'kanban_boards')
  and (subtree.folder_kind <> 'communications' or visible_shared_triage.resource_id is not null)
order by subtree.position asc, subtree.created_timestamp asc`, companyID, folderID, kindParam, userID, EntityPermissionView)
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
	items, err = r.attachCommunicationsSharedInboxRaciAssignments(ctx, companyID, items)
	if err != nil {
		return nil, err
	}
	return r.attachCommunicationsSharedInboxAccessGrants(ctx, companyID, items)
}

func (r *PostgresRepo) MoveCompanyExplorerFolder(companyID, folderID string, parentFolderID *string, position int) (domain.CompanyExplorerFolder, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	defer tx.Rollback()

	var folderKind string
	var currentParent sql.NullString
	var currentPosition int
	if err := tx.QueryRowContext(ctx,
		`select folder_kind, parent_folder_id, position
		 from company_explorer_folders
		 where company_id=$1 and folder_id=$2
		 for update`,
		companyID, folderID,
	).Scan(&folderKind, &currentParent, &currentPosition); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
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
		targetParentID = strings.TrimSpace(*parentFolderID)
		if targetParentID == folderID {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		parentChanged = (!currentParent.Valid && targetParentID != "") || (currentParent.Valid && currentParent.String != targetParentID)
		parent = nil
	}

	if parentFolderID != nil && targetParentID != "" {
		var parentKind string
		if err := tx.QueryRowContext(ctx,
			`select folder_kind
			 from company_explorer_folders
			 where company_id=$1 and folder_id=$2`,
			companyID, targetParentID,
		).Scan(&parentKind); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return domain.CompanyExplorerFolder{}, ErrNotFound
			}
			return domain.CompanyExplorerFolder{}, err
		}
		if parentKind != folderKind {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}

		var createsCycle bool
		if err := tx.QueryRowContext(ctx,
			`with recursive descendants as (
			   select folder_id
			   from company_explorer_folders
			   where company_id=$1 and folder_id=$2
			   union all
			   select child.folder_id
			   from company_explorer_folders child
			   join descendants parent on child.company_id=$1 and child.parent_folder_id=parent.folder_id
			 )
			 select exists(select 1 from descendants where folder_id=$3)`,
			companyID, folderID, targetParentID,
		).Scan(&createsCycle); err != nil {
			return domain.CompanyExplorerFolder{}, err
		}
		if createsCycle {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		parent = targetParentID
	}

	if position <= 0 {
		if parentChanged {
			position, err = nextCompanyExplorerSQLRowPosition(ctx, tx, companyID, folderKind, parent)
			if err != nil {
				return domain.CompanyExplorerFolder{}, err
			}
		} else {
			position = currentPosition
		}
	}

	item, err := scanCompanyExplorerFolder(tx.QueryRowContext(ctx,
		`update company_explorer_folders
		 set parent_folder_id=$3, position=$4, updated_timestamp=now()
		 where company_id=$1 and folder_id=$2
		 returning company_id, folder_id, parent_folder_id, folder_kind, system_key, name, null::text as account_email, position, created_timestamp, updated_timestamp`,
		companyID, folderID, parent, position,
	))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		return domain.CompanyExplorerFolder{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return r.getCompanyExplorerFolder(ctx, companyID, item.FolderID, true)
}

func (r *PostgresRepo) RenameCompanyExplorerFolder(companyID, folderID, name string) (domain.CompanyExplorerFolder, error) {
	ctx := context.Background()

	var systemKey sql.NullString
	if err := r.db.QueryRowContext(ctx,
		`select system_key
		 from company_explorer_folders
		 where company_id=$1 and folder_id=$2`,
		companyID, folderID,
	).Scan(&systemKey); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		return domain.CompanyExplorerFolder{}, err
	}
	if systemKey.Valid {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}

	item, err := scanCompanyExplorerFolder(r.db.QueryRowContext(ctx,
		`update company_explorer_folders
		 set name=$3, updated_timestamp=now()
		 where company_id=$1 and folder_id=$2
		 returning company_id, folder_id, parent_folder_id, folder_kind, system_key, name, null::text as account_email, position, created_timestamp, updated_timestamp`,
		companyID, folderID, name,
	))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		return domain.CompanyExplorerFolder{}, err
	}
	return r.getCompanyExplorerFolder(ctx, companyID, item.FolderID, true)
}

func (r *PostgresRepo) SetCommunicationsSharedInboxAccountEmail(companyID, folderID, accountEmail string) (domain.CompanyExplorerFolder, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
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

	var folderKind string
	if err := tx.QueryRowContext(ctx,
		`select folder_kind
		 from company_explorer_folders
		 where company_id=$1 and folder_id=$2
		 for update`,
		companyID, folderID,
	).Scan(&folderKind); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		return domain.CompanyExplorerFolder{}, err
	}
	if folderKind != "communications" {
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

	item, err := scanCompanyExplorerFolder(tx.QueryRowContext(ctx,
		`update company_explorer_folders
		 set account_email=$3, updated_timestamp=now()
		 where company_id=$1 and folder_id=$2
		 returning company_id, folder_id, parent_folder_id, folder_kind, system_key, name, account_email, position, created_timestamp, updated_timestamp`,
		companyID, folderID, accountParam,
	))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		if isPostgresUndefinedColumn(err, "account_email") {
			return domain.CompanyExplorerFolder{}, ErrSharedInboxStorageUnavailable
		}
		return domain.CompanyExplorerFolder{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return r.attachCompanyExplorerFolderMetadata(ctx, companyID, item)
}

func postgresCompanyHasConnectedEmailAccount(ctx context.Context, tx *sql.Tx, companyID, accountEmail string) (bool, error) {
	var exists bool
	if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from user_email_connections connection
  join company_memberships membership
    on membership.user_id = connection.user_id
  where membership.company_id = $1
    and connection.account_email = $2
    and connection.status = 'connected'
)`, companyID, accountEmail).Scan(&exists); err != nil {
		return false, err
	}
	return exists, nil
}

func (r *PostgresRepo) DeleteCompanyExplorerFolder(companyID, folderID string) error {
	_, err := r.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: "folder", ID: folderID}})
	return err
}

func (r *PostgresRepo) DeleteCompanyExplorerTargets(companyID string, targets []CompanyExplorerDeleteTargetInput) (CompanyExplorerDeleteResult, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" || len(targets) == 0 || len(targets) > CompanyExplorerDeleteBatchMaxItems {
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

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
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
	kanbanBoardIDs := map[string]bool{}
	directKanbanBoardIDs := map[string]bool{}

	for _, target := range targets {
		switch target.Kind {
		case "folder":
			rows, err := tx.QueryContext(ctx,
				`with recursive subtree as (
				   select folder_id, folder_kind, system_key
				   from company_explorer_folders
				   where company_id=$1 and folder_id=$2
				   union all
				   select child.folder_id, child.folder_kind, child.system_key
				   from company_explorer_folders child
				   join subtree parent on child.company_id=$1 and child.parent_folder_id=parent.folder_id
				 )
				 select folder_id::text, folder_kind, system_key is not null
				 from subtree`,
				companyID, target.ID,
			)
			if err != nil {
				return CompanyExplorerDeleteResult{}, err
			}
			count := 0
			for rows.Next() {
				var folderID string
				var folderKind string
				var protected bool
				if err := rows.Scan(&folderID, &folderKind, &protected); err != nil {
					rows.Close()
					return CompanyExplorerDeleteResult{}, err
				}
				count++
				if protected {
					rows.Close()
					return CompanyExplorerDeleteResult{}, ErrInvalid
				}
				folderIDs[folderID] = true
				folderKinds[folderID] = folderKind
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
		case "kanban":
			exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from kanban_boards where company_id=$1 and board_id=$2)`, companyID, target.ID)
			if err != nil {
				return CompanyExplorerDeleteResult{}, err
			}
			if !exists {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			kanbanBoardIDs[target.ID] = true
			directKanbanBoardIDs[target.ID] = true
		}
	}

	for folderID := range folderIDs {
		rows, err := tx.QueryContext(ctx,
			`select item_type, item_id
			 from company_explorer_folder_items
			 where company_id=$1 and folder_id=$2`,
			companyID, folderID,
		)
		if err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
		for rows.Next() {
			var itemType string
			var itemID string
			if err := rows.Scan(&itemType, &itemID); err != nil {
				rows.Close()
				return CompanyExplorerDeleteResult{}, err
			}
			switch itemType {
			case "node":
				nodeIDs[itemID] = true
			case "logic_gate":
				logicGateIDs[itemID] = true
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return CompanyExplorerDeleteResult{}, err
		}
		rows.Close()
	}

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
		boardRows, err := tx.QueryContext(ctx,
			`select board_id
			 from kanban_boards
			 where company_id=$1 and (board_id=$2 or logic_gate_id=$3)`,
			companyID, LogicGateKanbanBoardID(logicGateID), logicGateID,
		)
		if err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
		for boardRows.Next() {
			var boardID string
			if err := boardRows.Scan(&boardID); err != nil {
				boardRows.Close()
				return CompanyExplorerDeleteResult{}, err
			}
			kanbanBoardIDs[boardID] = true
		}
		if err := boardRows.Err(); err != nil {
			boardRows.Close()
			return CompanyExplorerDeleteResult{}, err
		}
		boardRows.Close()
	}
	for boardID := range kanbanBoardIDs {
		var attachedLogicGateID sql.NullString
		err := tx.QueryRowContext(ctx,
			`select logic_gate_id::text
			 from kanban_boards
			 where company_id=$1 and board_id=$2`,
			companyID, boardID,
		).Scan(&attachedLogicGateID)
		if errors.Is(err, sql.ErrNoRows) {
			if directKanbanBoardIDs[boardID] {
				return CompanyExplorerDeleteResult{}, ErrNotFound
			}
			delete(kanbanBoardIDs, boardID)
			continue
		}
		if err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
		if attachedLogicGateID.Valid && !logicGateIDs[attachedLogicGateID.String] {
			return CompanyExplorerDeleteResult{}, ErrInvalid
		}
	}

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
	appendSorted("kanban", kanbanBoardIDs)

	for logicGateID := range logicGateIDs {
		if err := postgresDeleteLogicGateTx(ctx, tx, companyID, logicGateID); err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
	}
	for boardID := range kanbanBoardIDs {
		exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from kanban_boards where company_id=$1 and board_id=$2)`, companyID, boardID)
		if err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
		if !exists {
			continue
		}
		if err := postgresDeleteKanbanBoardTx(ctx, tx, companyID, boardID); err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
	}
	for nodeID := range nodeIDs {
		if err := postgresDeleteNodeTx(ctx, tx, companyID, nodeID); err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
	}
	if len(folderIDs) > 0 {
		grantFolderIDs := make([]string, 0, len(folderIDs))
		for folderID := range folderIDs {
			grantFolderIDs = append(grantFolderIDs, folderID)
		}
		if _, err := tx.ExecContext(ctx,
			`delete from resource_access_grants
			 where company_id=$1 and resource_type=$2 and resource_id = any(string_to_array($3, ',')::uuid[])`,
			companyID, EntityTypeSharedTriageFolder, strings.Join(grantFolderIDs, ","),
		); err != nil && !isPostgresUndefinedTable(err, "resource_access_grants") {
			return CompanyExplorerDeleteResult{}, err
		}
	}
	for folderID := range folderRootIDs {
		if _, err := tx.ExecContext(ctx,
			`delete from company_explorer_folders
			 where company_id=$1 and folder_id=$2`,
			companyID, folderID,
		); err != nil {
			return CompanyExplorerDeleteResult{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return CompanyExplorerDeleteResult{}, err
	}
	return result, nil
}

func postgresTxExists(ctx context.Context, tx *sql.Tx, query string, args ...any) (bool, error) {
	var exists bool
	if err := tx.QueryRowContext(ctx, query, args...).Scan(&exists); err != nil {
		return false, err
	}
	return exists, nil
}

func postgresDeleteNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	if _, err := tx.ExecContext(ctx,
		`delete from node_relationships
		 where company_id=$1 and (node_id_a=$2 or node_id_b=$2)`,
		companyID, nodeID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from company_explorer_folder_items
		 where company_id=$1 and item_type='node' and item_id=$2`,
		companyID, nodeID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from kanban_cards
		 where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from node_information
		 where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from node_projection_table
		 where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from node_map_positions
		 where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from resource_access_grants
		 where company_id=$1 and resource_type='node' and resource_id=$2::uuid`,
		companyID, nodeID,
	); err != nil && !isPostgresUndefinedTable(err, "resource_access_grants") {
		return err
	}
	deleted, err := tx.ExecContext(ctx,
		`delete from nodes
		 where company_id=$1 and node_id=$2`,
		companyID, nodeID,
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

func postgresDeleteLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_relationships
		 where company_id=$1 and (logic_gate_id_a=$2 or logic_gate_id_b=$2)`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from company_explorer_folder_items
		 where company_id=$1 and item_type='logic_gate' and item_id=$2`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	boardID := LogicGateKanbanBoardID(logicGateID)
	if _, err := tx.ExecContext(ctx,
		`with target_boards as (
		   select $3::text as board_id
		   union
		   select board_id
		   from kanban_boards
		   where company_id=$1 and logic_gate_id=$2
		 )
		 delete from company_explorer_folder_items
		 where company_id=$1
		   and item_type='kanban'
		   and item_id in (select board_id from target_boards)`,
		companyID, logicGateID, boardID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`with target_boards as (
		   select $3::text as board_id
		   union
		   select board_id
		   from kanban_boards
		   where company_id=$1 and logic_gate_id=$2
		 )
		 delete from kanban_cards
		 where company_id=$1
		   and board_id in (select board_id from target_boards)`,
		companyID, logicGateID, boardID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`with target_boards as (
		   select $3::text as board_id
		   union
		   select board_id
		   from kanban_boards
		   where company_id=$1 and logic_gate_id=$2
		 )
		 delete from kanban_columns
		 where company_id=$1
		   and board_id in (select board_id from target_boards)`,
		companyID, logicGateID, boardID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from kanban_boards
		 where company_id=$1
		   and (board_id=$3 or logic_gate_id=$2)`,
		companyID, logicGateID, boardID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_information
		 where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_projection_table
		 where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_map_positions
		 where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from resource_access_grants
		 where company_id=$1 and resource_type='logic_gate' and resource_id=$2::uuid`,
		companyID, logicGateID,
	); err != nil && !isPostgresUndefinedTable(err, "resource_access_grants") {
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
	var attachedLogicGateID sql.NullString
	if err := tx.QueryRowContext(ctx, `
select logic_gate_id::text
from kanban_boards
where company_id=$1 and board_id=$2`, companyID, boardID).Scan(&attachedLogicGateID); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if attachedLogicGateID.Valid {
		return ErrInvalid
	}

	if _, err := tx.ExecContext(ctx, `
delete from company_explorer_folder_items
where company_id=$1 and item_type='kanban' and item_id=$2`, companyID, boardID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
delete from kanban_cards
where company_id=$1 and board_id=$2`, companyID, boardID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
delete from kanban_columns
where company_id=$1 and board_id=$2`, companyID, boardID); err != nil {
		return err
	}
	deleted, err := tx.ExecContext(ctx, `
delete from kanban_boards
where company_id=$1 and board_id=$2`, companyID, boardID)
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

func assignCompanyExplorerFolderItemSQL(ctx context.Context, tx *sql.Tx, companyID, folderID, itemType, itemID string, position int) (domain.CompanyExplorerFolderItem, []string, error) {
	var err error
	var folderKind string
	if err := tx.QueryRowContext(ctx,
		`select folder_kind
		 from company_explorer_folders
		 where company_id=$1 and folder_id=$2`,
		companyID, folderID,
	).Scan(&folderKind); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolderItem{}, nil, ErrNotFound
		}
		return domain.CompanyExplorerFolderItem{}, nil, err
	}
	var exists bool
	var existsQuery string
	if itemType == "node" {
		existsQuery = `select exists(select 1 from nodes where company_id=$1 and node_id=$2)`
	} else if itemType == "logic_gate" {
		existsQuery = `select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`
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
		`select folder_id, position
		 from company_explorer_folder_items
		 where company_id=$1 and item_type=$2 and item_id=$3
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
		position, err = nextCompanyExplorerSQLRowPosition(ctx, tx, companyID, folderKind, folderID)
		if err != nil {
			return domain.CompanyExplorerFolderItem{}, nil, err
		}
	}

	var item domain.CompanyExplorerFolderItem
	if err := tx.QueryRowContext(ctx,
		`insert into company_explorer_folder_items
		 (company_id, folder_id, item_type, item_id, position, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, $5, now(), now())
		 on conflict (company_id, item_type, item_id)
		 do update set
		   folder_id=excluded.folder_id,
		   position=excluded.position,
		   updated_timestamp=now()
		 returning company_id, folder_id, item_type, item_id, position, created_timestamp, updated_timestamp`,
		companyID, folderID, itemType, itemID, position,
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
	deletedRelationshipIDs := make([]string, 0)
	if !hasExisting || existingFolderID != folderID {
		var deleteRows *sql.Rows
		if itemType == "node" {
			deleteRows, err = tx.QueryContext(ctx,
				`delete from node_relationships
				 where company_id=$1 and (node_id_a=$2 or node_id_b=$2)
				 returning node_relationship_id::text`,
				companyID, itemID,
			)
		} else if itemType == "logic_gate" {
			deleteRows, err = tx.QueryContext(ctx,
				`delete from logic_gate_relationships
				 where company_id=$1 and (logic_gate_id_a=$2 or logic_gate_id_b=$2)
				 returning logic_gate_relationship_id::text`,
				companyID, itemID,
			)
		} else {
			deleteRows = nil
		}
		if err != nil {
			return domain.CompanyExplorerFolderItem{}, nil, err
		}
		if deleteRows != nil {
			for deleteRows.Next() {
				var relationshipID string
				if err := deleteRows.Scan(&relationshipID); err != nil {
					deleteRows.Close()
					return domain.CompanyExplorerFolderItem{}, nil, err
				}
				deletedRelationshipIDs = append(deletedRelationshipIDs, relationshipID)
			}
			if err := deleteRows.Err(); err != nil {
				deleteRows.Close()
				return domain.CompanyExplorerFolderItem{}, nil, err
			}
			deleteRows.Close()
		}
	}
	return item, deletedRelationshipIDs, nil
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
		`select company_id, folder_id, item_type, item_id, position, created_timestamp, updated_timestamp
		 from company_explorer_folder_items
		 where company_id=$1
		   and ($2::uuid is null or folder_id=$2::uuid)
		   and ($3::text is null or item_type=$3)
		   and item_type <> 'kanban'
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
		`select item.company_id, item.folder_id, item.item_type, item.item_id, item.position, item.created_timestamp, item.updated_timestamp
		 from company_explorer_folder_items item
		 where item.company_id=$1::uuid
		   and ($2::uuid is null or item.folder_id=$2::uuid)
		   and ($3::text is null or item.item_type=$3)
		   and item.item_type <> 'kanban'
		   and (
		     item.item_type not in ('node', 'logic_gate')
		     or exists (
		       select 1
		       from effective_resource_access access
		       where access.company_id=item.company_id
		         and access.user_id=$4::uuid
		         and access.resource_type=case item.item_type when 'node' then 'node' else 'logic_gate' end
		         and access.resource_id::text=item.item_id
		         and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($5)
		     )
		   )
		 order by item.position asc, item.created_timestamp asc`,
		companyID, folderParam, itemTypeParam, userID, EntityPermissionView,
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
select item.company_id, item.folder_id, item.item_type, item.item_id, item.position, item.created_timestamp, item.updated_timestamp
from company_explorer_folder_items item
join subtree folder_scope on folder_scope.folder_id=item.folder_id
where item.company_id=$1
  and ($3::text is null or item.item_type=$3)
  and item.item_type <> 'kanban'
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
  union all
  select child.folder_id
  from company_explorer_folders child
  join subtree parent on child.parent_folder_id=parent.folder_id
  where child.company_id=$1::uuid
)
select item.company_id, item.folder_id, item.item_type, item.item_id, item.position, item.created_timestamp, item.updated_timestamp
from company_explorer_folder_items item
join subtree folder_scope on folder_scope.folder_id=item.folder_id
where item.company_id=$1::uuid
  and ($3::text is null or item.item_type=$3)
  and item.item_type <> 'kanban'
  and (
    item.item_type not in ('node', 'logic_gate')
    or exists (
      select 1
      from effective_resource_access access
      where access.company_id=item.company_id
        and access.user_id=$4::uuid
        and access.resource_type=case item.item_type when 'node' then 'node' else 'logic_gate' end
        and access.resource_id::text=item.item_id
        and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($5)
    )
  )
order by item.position asc, item.created_timestamp asc`, companyID, folderID, itemTypeParam, userID, EntityPermissionView)
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
		var item domain.Node
		var dueDate sql.NullString
		if err := rows.Scan(
			&item.CompanyID,
			&item.NodeID,
			&item.Title,
			&dueDate,
			&item.CreatedTimestamp,
		); err != nil {
			return nil, err
		}
		if dueDate.Valid {
			item.DueDate = &dueDate.String
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListCompanyExplorerNodeSummaries(companyID string) ([]domain.Node, error) {
	rows, err := r.db.QueryContext(context.Background(), `
select company_id, node_id, title, due_date::text, created_timestamp
from nodes
where company_id=$1
order by created_timestamp asc`, companyID)
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
select n.company_id, n.node_id, n.title, n.due_date::text, n.created_timestamp
from nodes n
join (
  select distinct access.resource_id
  from effective_resource_access access
  where access.company_id=$1::uuid
    and access.user_id=$2::uuid
    and access.resource_type='node'
    and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($3)
) visible on visible.resource_id=n.node_id
where n.company_id=$1::uuid
order by n.created_timestamp asc, n.node_id::text asc`, companyID, userID, EntityPermissionView)
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
	rows, err := r.db.QueryContext(context.Background(), `
with recursive folder_scope as (
  select company_id, folder_id
  from company_explorer_folders
  where company_id=$1
    and folder_id=$2::uuid
    and folder_kind='node'
  union all
  select child.company_id, child.folder_id
  from company_explorer_folders child
  join folder_scope parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
  where child.folder_kind='node'
), visible_nodes as (
  select distinct item.item_id::uuid as node_id
  from company_explorer_folder_items item
  join folder_scope folder on folder.folder_id=item.folder_id
  where item.company_id=$1
    and item.item_type='node'
)
select n.company_id, n.node_id, n.title, n.due_date::text, n.created_timestamp
from nodes n
join visible_nodes visible on visible.node_id=n.node_id
where n.company_id=$1
order by n.created_timestamp asc`, companyID, folderID)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerNodeSummaryRows(rows)
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
	rows, err := r.db.QueryContext(context.Background(), `
with recursive folder_scope as (
  select company_id, folder_id
  from company_explorer_folders
  where company_id=$1::uuid
    and folder_id=$2::uuid
    and folder_kind='node'
  union all
  select child.company_id, child.folder_id
  from company_explorer_folders child
  join folder_scope parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
  where child.folder_kind='node'
), folder_nodes as (
  select distinct item.item_id::uuid as node_id
  from company_explorer_folder_items item
  join folder_scope folder on folder.folder_id=item.folder_id
  where item.company_id=$1::uuid
    and item.item_type='node'
), visible_nodes as (
  select distinct access.resource_id as node_id
  from effective_resource_access access
  join folder_nodes folder_node on folder_node.node_id=access.resource_id
  where access.company_id=$1::uuid
    and access.user_id=$3::uuid
    and access.resource_type='node'
    and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($4)
)
select n.company_id, n.node_id, n.title, n.due_date::text, n.created_timestamp
from nodes n
join visible_nodes visible on visible.node_id=n.node_id
where n.company_id=$1::uuid
order by n.created_timestamp asc, n.node_id::text asc`, companyID, folderID, userID, EntityPermissionView)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerNodeSummaryRows(rows)
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
	return scanCompanyExplorerLogicGateSummaryRows(rows)
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
join (
  select distinct access.resource_id
  from effective_resource_access access
  where access.company_id=$1::uuid
    and access.user_id=$2::uuid
    and access.resource_type='logic_gate'
    and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($3)
) visible on visible.resource_id=gate.logic_gate_id
where gate.company_id=$1::uuid
order by gate.created_timestamp asc, gate.logic_gate_id::text asc`, companyID, userID, EntityPermissionView)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerLogicGateSummaryRows(rows)
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
    and folder_kind='logic_gate'
  union all
  select child.company_id, child.folder_id
  from company_explorer_folders child
  join folder_scope parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
  where child.folder_kind='logic_gate'
), visible_gates as (
  select distinct item.item_id::uuid as logic_gate_id
  from company_explorer_folder_items item
  join folder_scope folder on folder.folder_id=item.folder_id
  where item.company_id=$1
    and item.item_type='logic_gate'
)
select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
from logic_gates gate
join visible_gates visible on visible.logic_gate_id=gate.logic_gate_id
where gate.company_id=$1
order by gate.created_timestamp asc`, companyID, folderID)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerLogicGateSummaryRows(rows)
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
    and folder_kind='logic_gate'
  union all
  select child.company_id, child.folder_id
  from company_explorer_folders child
  join folder_scope parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
  where child.folder_kind='logic_gate'
), folder_gates as (
  select distinct item.item_id::uuid as logic_gate_id
  from company_explorer_folder_items item
  join folder_scope folder on folder.folder_id=item.folder_id
  where item.company_id=$1::uuid
    and item.item_type='logic_gate'
), visible_gates as (
  select distinct access.resource_id as logic_gate_id
  from effective_resource_access access
  join folder_gates folder_gate on folder_gate.logic_gate_id=access.resource_id
  where access.company_id=$1::uuid
    and access.user_id=$3::uuid
    and access.resource_type='logic_gate'
    and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($4)
)
select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
from logic_gates gate
join visible_gates visible on visible.logic_gate_id=gate.logic_gate_id
where gate.company_id=$1::uuid
order by gate.created_timestamp asc, gate.logic_gate_id::text asc`, companyID, folderID, userID, EntityPermissionView)
	if err != nil {
		return nil, err
	}
	return scanCompanyExplorerLogicGateSummaryRows(rows)
}

func (r *PostgresRepo) RemoveCompanyExplorerFolderItem(companyID, itemType, itemID string) error {
	ctx := context.Background()
	deleted, err := r.db.ExecContext(ctx,
		`delete from company_explorer_folder_items
		 where company_id=$1 and item_type=$2 and item_id=$3`,
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
