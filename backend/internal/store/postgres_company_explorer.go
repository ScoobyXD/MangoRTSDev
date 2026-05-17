package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
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
	if err := ensureCompanyExplorerDefaultFoldersSQL(ctx, tx, companyID); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
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

	var item domain.CompanyExplorerFolder
	var parent sql.NullString
	var systemOut sql.NullString
	if err := tx.QueryRowContext(ctx,
		`select company_id, folder_id, parent_folder_id, folder_kind, system_key, name, position, created_timestamp, updated_timestamp
		 from company_explorer_folders
		 where company_id=$1 and system_key=$2`,
		companyID, systemKey,
	).Scan(
		&item.CompanyID,
		&item.FolderID,
		&parent,
		&item.FolderKind,
		&systemOut,
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
	if systemOut.Valid {
		item.SystemKey = &systemOut.String
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
	var parentOut sql.NullString
	var systemOut sql.NullString
	if err := tx.QueryRowContext(ctx,
		`insert into company_explorer_folders
		 (company_id, folder_id, parent_folder_id, folder_kind, system_key, name, position, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, null, $5, $6, now(), now())
		 returning company_id, folder_id, parent_folder_id, folder_kind, system_key, name, position, created_timestamp, updated_timestamp`,
		item.CompanyID, item.FolderID, parent, item.FolderKind, item.Name, item.Position,
	).Scan(
		&item.CompanyID,
		&item.FolderID,
		&parentOut,
		&item.FolderKind,
		&systemOut,
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
	if systemOut.Valid {
		item.SystemKey = &systemOut.String
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return item, nil
}

func (r *PostgresRepo) ListCompanyExplorerFolders(companyID, folderKind string) ([]domain.CompanyExplorerFolder, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if err := ensureCompanyExplorerDefaultFoldersSQL(ctx, tx, companyID); err != nil {
		return nil, err
	}

	var kindParam any
	if folderKind != "" {
		kindParam = folderKind
	}
	rows, err := tx.QueryContext(ctx,
		`select company_id, folder_id, parent_folder_id, folder_kind, system_key, name, position, created_timestamp, updated_timestamp
		 from company_explorer_folders
		 where company_id=$1 and ($2::text is null or folder_kind=$2)
		 order by position asc, created_timestamp asc`,
		companyID, kindParam,
	)
	if err != nil {
		return nil, err
	}

	items := make([]domain.CompanyExplorerFolder, 0)
	for rows.Next() {
		var item domain.CompanyExplorerFolder
		var parent sql.NullString
		var systemKey sql.NullString
		if err := rows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&parent,
			&item.FolderKind,
			&systemKey,
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
		if systemKey.Valid {
			item.SystemKey = &systemKey.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return r.attachCommunicationsSharedInboxRaciAssignments(ctx, companyID, items)
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
	var systemOut sql.NullString
	if err := tx.QueryRowContext(ctx,
		`update company_explorer_folders
		 set parent_folder_id=$3, position=$4, updated_timestamp=now()
		 where company_id=$1 and folder_id=$2
		 returning company_id, folder_id, parent_folder_id, folder_kind, system_key, name, position, created_timestamp, updated_timestamp`,
		companyID, folderID, parent, position,
	).Scan(
		&item.CompanyID,
		&item.FolderID,
		&parentOut,
		&item.FolderKind,
		&systemOut,
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
	if systemOut.Valid {
		item.SystemKey = &systemOut.String
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return item, nil
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

	var item domain.CompanyExplorerFolder
	var parent sql.NullString
	var systemOut sql.NullString
	if err := r.db.QueryRowContext(ctx,
		`update company_explorer_folders
		 set name=$3, updated_timestamp=now()
		 where company_id=$1 and folder_id=$2
		 returning company_id, folder_id, parent_folder_id, folder_kind, system_key, name, position, created_timestamp, updated_timestamp`,
		companyID, folderID, name,
	).Scan(
		&item.CompanyID,
		&item.FolderID,
		&parent,
		&item.FolderKind,
		&systemOut,
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
	if systemOut.Valid {
		item.SystemKey = &systemOut.String
	}
	return item, nil
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
			case "kanban":
				kanbanBoardIDs[itemID] = true
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
