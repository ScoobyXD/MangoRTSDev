package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) ensureCompanyExplorerDefaultFoldersTx(ctx context.Context, tx *sql.Tx, companyID, actorUserID string) (companyExplorerDefaultFolders, error) {
	companyID = cleanUUIDText(companyID)
	actorUserID = cleanUUIDText(actorUserID)
	if companyID == "" {
		return companyExplorerDefaultFolders{}, ErrInvalid
	}
	folders := companyExplorerDefaultFolderIDs(companyID)
	if folders.UnfiledFolderID == "" || folders.ProjectsFolderID == "" || folders.LogicGatesFolderID == "" {
		return companyExplorerDefaultFolders{}, ErrInvalid
	}
	if err := lockPostgresCompanyExplorerMutationTx(ctx, tx, companyID, "", true); err != nil {
		return companyExplorerDefaultFolders{}, err
	}
	if err := postgresLockProcessMapCompanyTx(ctx, tx, companyID); err != nil {
		return companyExplorerDefaultFolders{}, err
	}
	upsert := func(folderID string, parentFolderID any, name string, position int) error {
		_, err := tx.ExecContext(ctx, `
insert into company_explorer_folders (
  company_id,
  folder_id,
  parent_folder_id,
  name,
  default_access,
  position,
  created_by_user_id,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4, 'edit', $5, nullif($6, '')::uuid, now(), now())
on conflict (company_id, folder_id) do update set
  parent_folder_id=excluded.parent_folder_id,
  name=excluded.name,
  position=excluded.position,
  updated_timestamp=now()
where (company_explorer_folders.parent_folder_id, company_explorer_folders.name, company_explorer_folders.position)
      is distinct from
      (excluded.parent_folder_id, excluded.name, excluded.position)`, companyID, folderID, parentFolderID, name, position, actorUserID)
		if err != nil {
			return err
		}
		parentID := ""
		if value, ok := parentFolderID.(string); ok {
			parentID = value
		}
		return r.syncAutomaticProcessMapPlacementTx(ctx, tx, companyID, domain.ProcessMapResourceTypeFolder, folderID, parentID, actorUserID)
	}
	if err := upsert(folders.UnfiledFolderID, nil, CompanyExplorerDefaultRootFolderName, 1000); err != nil {
		return companyExplorerDefaultFolders{}, err
	}
	if err := upsert(folders.ProjectsFolderID, folders.UnfiledFolderID, CompanyExplorerDefaultProjectsFolderName, 1000); err != nil {
		return companyExplorerDefaultFolders{}, err
	}
	if err := upsert(folders.LogicGatesFolderID, folders.UnfiledFolderID, CompanyExplorerDefaultLogicGatesFolderName, 2000); err != nil {
		return companyExplorerDefaultFolders{}, err
	}
	return folders, nil
}

func (r *PostgresRepo) placeCompanyExplorerItemInDefaultFolderTx(ctx context.Context, tx *sql.Tx, companyID, targetType, targetID, actorUserID string, snapshotPolicy bool) (domain.CompanyExplorerFolderItem, bool, error) {
	companyID = cleanUUIDText(companyID)
	targetID = cleanUUIDText(targetID)
	actorUserID = cleanUUIDText(actorUserID)
	folderID, ok := companyExplorerDefaultFolderIDForTargetType(companyID, targetType)
	if companyID == "" || targetID == "" || !ok {
		return domain.CompanyExplorerFolderItem{}, false, ErrInvalid
	}
	if _, err := r.ensureCompanyExplorerDefaultFoldersTx(ctx, tx, companyID, actorUserID); err != nil {
		return domain.CompanyExplorerFolderItem{}, false, err
	}
	position, err := nextCompanyExplorerFinalPositionSQL(ctx, tx, companyID, folderID)
	if err != nil {
		return domain.CompanyExplorerFolderItem{}, false, err
	}
	var item domain.CompanyExplorerFolderItem
	err = tx.QueryRowContext(ctx, `
insert into company_explorer_items (
  company_id,
  item_id,
  parent_folder_id,
  target_type,
  target_id,
  position,
  created_by_user_id,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, nullif($7, '')::uuid, now(), now())
on conflict (company_id, target_type, target_id) do nothing
returning company_id::text, coalesce(parent_folder_id::text, '') as folder_id, target_type, target_id::text, position, created_timestamp, updated_timestamp`, companyID, newUUIDv7String(), folderID, targetType, targetID, position, actorUserID).Scan(
		&item.CompanyID,
		&item.FolderID,
		&item.ItemType,
		&item.ItemID,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		if targetType == EntityTypeLogicGate {
			if err := r.syncAutomaticProcessMapPlacementTx(ctx, tx, companyID, domain.ProcessMapResourceTypeProcess, targetID, folderID, actorUserID); err != nil {
				return domain.CompanyExplorerFolderItem{}, false, err
			}
		}
		return domain.CompanyExplorerFolderItem{}, false, nil
	}
	if err != nil {
		return domain.CompanyExplorerFolderItem{}, false, err
	}
	if targetType == EntityTypeLogicGate {
		if err := r.syncAutomaticProcessMapPlacementTx(ctx, tx, companyID, domain.ProcessMapResourceTypeProcess, targetID, folderID, actorUserID); err != nil {
			return domain.CompanyExplorerFolderItem{}, false, err
		}
	}
	_ = snapshotPolicy // V2 child policy mode is initialized by the database trigger.
	return item, true, nil
}
