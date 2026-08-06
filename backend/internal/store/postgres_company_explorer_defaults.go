package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) ensureCompanyExplorerDefaultState(companyID string) error {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := ensureCompanyExplorerDefaultFoldersTx(ctx, tx, companyID, ""); err != nil {
		return err
	}
	if err := backfillBareCompanyExplorerItemsTx(ctx, tx, companyID); err != nil {
		return err
	}
	return tx.Commit()
}

func ensureCompanyExplorerDefaultFoldersTx(ctx context.Context, tx *sql.Tx, companyID, actorUserID string) (companyExplorerDefaultFolders, error) {
	companyID = cleanUUIDText(companyID)
	actorUserID = cleanUUIDText(actorUserID)
	if companyID == "" {
		return companyExplorerDefaultFolders{}, ErrInvalid
	}
	folders := companyExplorerDefaultFolderIDs(companyID)
	if folders.UnfiledFolderID == "" || folders.ProjectsFolderID == "" || folders.LogicGatesFolderID == "" || folders.NodesFolderID == "" {
		return companyExplorerDefaultFolders{}, ErrInvalid
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
  updated_timestamp=now()`, companyID, folderID, parentFolderID, name, position, actorUserID)
		return err
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
	if err := upsert(folders.NodesFolderID, folders.UnfiledFolderID, CompanyExplorerDefaultNodesFolderName, 3000); err != nil {
		return companyExplorerDefaultFolders{}, err
	}
	return folders, nil
}

func placeCompanyExplorerItemInDefaultFolderTx(ctx context.Context, tx *sql.Tx, companyID, targetType, targetID, actorUserID string, snapshotPolicy bool) (domain.CompanyExplorerFolderItem, bool, error) {
	return placeCompanyExplorerItemInDefaultFolderInternalTx(ctx, tx, companyID, targetType, targetID, actorUserID, snapshotPolicy, false)
}

func placeEmailCollaborationNodeInDefaultFolderTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, actorUserID string) (domain.CompanyExplorerFolderItem, bool, error) {
	return placeCompanyExplorerItemInDefaultFolderInternalTx(ctx, tx, companyID, EntityTypeNode, nodeID, actorUserID, false, true)
}

func placeCompanyExplorerItemInDefaultFolderInternalTx(ctx context.Context, tx *sql.Tx, companyID, targetType, targetID, actorUserID string, snapshotPolicy, allowEmailCollaborationNode bool) (domain.CompanyExplorerFolderItem, bool, error) {
	companyID = cleanUUIDText(companyID)
	targetID = cleanUUIDText(targetID)
	actorUserID = cleanUUIDText(actorUserID)
	folderID, ok := companyExplorerDefaultFolderIDForTargetType(companyID, targetType)
	if companyID == "" || targetID == "" || !ok {
		return domain.CompanyExplorerFolderItem{}, false, ErrInvalid
	}
	if targetType == EntityTypeNode && !allowEmailCollaborationNode {
		return domain.CompanyExplorerFolderItem{}, false, ErrInvalid
	}
	if _, err := ensureCompanyExplorerDefaultFoldersTx(ctx, tx, companyID, actorUserID); err != nil {
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
		return domain.CompanyExplorerFolderItem{}, false, nil
	}
	if err != nil {
		return domain.CompanyExplorerFolderItem{}, false, err
	}
	_ = snapshotPolicy // V2 child policy mode is initialized by the database trigger.
	return item, true, nil
}

func backfillBareCompanyExplorerItemsTx(ctx context.Context, tx *sql.Tx, companyID string) error {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return ErrInvalid
	}
	if _, err := ensureCompanyExplorerDefaultFoldersTx(ctx, tx, companyID, ""); err != nil {
		return err
	}
	if err := backfillBareCompanyExplorerItemsForTypeTx(ctx, tx, companyID, EntityTypeProject, `
select project.project_id::text
from projects project
where project.company_id=$1::uuid
  and not exists (
    select 1
    from company_explorer_items item
    where item.company_id=project.company_id
      and item.target_type='project'
      and item.target_id=project.project_id
  )
order by project.created_timestamp, project.project_id`); err != nil {
		return err
	}
	if err := backfillBareCompanyExplorerItemsForTypeTx(ctx, tx, companyID, EntityTypeLogicGate, `
select logic_gate.logic_gate_id::text
from logic_gates logic_gate
where logic_gate.company_id=$1::uuid
  and not exists (
    select 1
    from company_explorer_items item
    where item.company_id=logic_gate.company_id
      and item.target_type='logic_gate'
      and item.target_id=logic_gate.logic_gate_id
  )
  and not exists (
    select 1
    from project_relationships relationship
    where relationship.company_id=logic_gate.company_id
      and relationship.resource_type='logic_gate'
      and relationship.resource_id=logic_gate.logic_gate_id
  )
order by logic_gate.created_timestamp, logic_gate.logic_gate_id`); err != nil {
		return err
	}
	return nil
}

func backfillBareCompanyExplorerItemsForTypeTx(ctx context.Context, tx *sql.Tx, companyID, targetType, query string) error {
	rows, err := tx.QueryContext(ctx, query, companyID)
	if err != nil {
		return err
	}
	targetIDs := make([]string, 0)
	for rows.Next() {
		var targetID string
		if err := rows.Scan(&targetID); err != nil {
			_ = rows.Close()
			return err
		}
		targetIDs = append(targetIDs, targetID)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, targetID := range targetIDs {
		if _, _, err := placeCompanyExplorerItemInDefaultFolderTx(ctx, tx, companyID, targetType, targetID, "", false); err != nil && !errors.Is(err, ErrInvalid) {
			return err
		}
	}
	return nil
}
