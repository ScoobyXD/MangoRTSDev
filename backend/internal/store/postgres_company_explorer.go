package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

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
	var parentOut sql.NullString
	if err := tx.QueryRowContext(ctx,
		`insert into company_explorer_folders
		 (company_id, folder_id, parent_folder_id, folder_kind, name, position, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, $5, $6, now(), now())
		 returning company_id, folder_id, parent_folder_id, folder_kind, name, position, created_timestamp, updated_timestamp`,
		item.CompanyID, item.FolderID, parent, item.FolderKind, item.Name, item.Position,
	).Scan(
		&item.CompanyID,
		&item.FolderID,
		&parentOut,
		&item.FolderKind,
		&item.Name,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); err != nil {
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

func (r *PostgresRepo) ListCompanyExplorerFolders(companyID, folderKind string) ([]domain.CompanyExplorerFolder, error) {
	ctx := context.Background()
	var kindParam any
	if folderKind != "" {
		kindParam = folderKind
	}
	rows, err := r.db.QueryContext(ctx,
		`select company_id, folder_id, parent_folder_id, folder_kind, name, position, created_timestamp, updated_timestamp
		 from company_explorer_folders
		 where company_id=$1 and ($2::text is null or folder_kind=$2)
		 order by position asc, created_timestamp asc`,
		companyID, kindParam,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyExplorerFolder, 0)
	for rows.Next() {
		var item domain.CompanyExplorerFolder
		var parent sql.NullString
		if err := rows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&parent,
			&item.FolderKind,
			&item.Name,
			&item.Position,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		if parent.Valid {
			item.ParentFolderID = &parent.String
		}
		items = append(items, item)
	}
	return items, rows.Err()
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

	var item domain.CompanyExplorerFolder
	var parentOut sql.NullString
	if err := tx.QueryRowContext(ctx,
		`update company_explorer_folders
		 set parent_folder_id=$3, position=$4, updated_timestamp=now()
		 where company_id=$1 and folder_id=$2
		 returning company_id, folder_id, parent_folder_id, folder_kind, name, position, created_timestamp, updated_timestamp`,
		companyID, folderID, parent, position,
	).Scan(
		&item.CompanyID,
		&item.FolderID,
		&parentOut,
		&item.FolderKind,
		&item.Name,
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
	ctx := context.Background()
	var item domain.CompanyExplorerFolder
	var parent sql.NullString
	if err := r.db.QueryRowContext(ctx,
		`update company_explorer_folders
		 set name=$3, updated_timestamp=now()
		 where company_id=$1 and folder_id=$2
		 returning company_id, folder_id, parent_folder_id, folder_kind, name, position, created_timestamp, updated_timestamp`,
		companyID, folderID, name,
	).Scan(
		&item.CompanyID,
		&item.FolderID,
		&parent,
		&item.FolderKind,
		&item.Name,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		return domain.CompanyExplorerFolder{}, err
	}
	if parent.Valid {
		item.ParentFolderID = &parent.String
	}
	return item, nil
}

func (r *PostgresRepo) DeleteCompanyExplorerFolder(companyID, folderID string) error {
	ctx := context.Background()
	deleted, err := r.db.ExecContext(ctx,
		`delete from company_explorer_folders
		 where company_id=$1 and folder_id=$2`,
		companyID, folderID,
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
	// The self-referential folder FK and company_explorer_folder_items FK both cascade. Deleting
	// the root folder removes descendants and placements without touching nodes/gates.
	return nil
}

func (r *PostgresRepo) AssignCompanyExplorerFolderItem(companyID, folderID, itemType, itemID string, position int) (domain.CompanyExplorerFolderItem, []string, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolderItem{}, nil, err
	}
	defer tx.Rollback()

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
	if folderKind != itemType && itemType != "kanban" {
		return domain.CompanyExplorerFolderItem{}, nil, ErrNotFound
	}

	var exists bool
	var existsQuery string
	if itemType == "node" {
		existsQuery = `select exists(select 1 from nodes where company_id=$1 and node_id=$2)`
	} else if itemType == "logic_gate" {
		existsQuery = `select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`
	} else if itemType == "kanban" {
		existsQuery = `select exists(select 1 from kanban_boards where company_id=$1 and board_id=$2)`
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
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolderItem{}, nil, err
	}
	return item, deletedRelationshipIDs, nil
}

func (r *PostgresRepo) ListCompanyExplorerFolderItems(companyID, folderID, itemType string) ([]domain.CompanyExplorerFolderItem, error) {
	ctx := context.Background()
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
