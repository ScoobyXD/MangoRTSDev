package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

type userPinTreeQueryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func (r *PostgresRepo) ListUserPinTree(input UserPinListInput) (domain.UserPinTree, error) {
	input, ok := normalizeUserPinListInput(input)
	if !ok {
		return domain.UserPinTree{}, ErrInvalid
	}
	return queryUserPinTree(context.Background(), r.db, input)
}

func queryUserPinTree(ctx context.Context, queryer userPinTreeQueryer, input UserPinListInput) (domain.UserPinTree, error) {
	tree := domain.UserPinTree{
		PinFolders: make([]domain.UserPinFolder, 0),
		UserPins:   make([]domain.UserPin, 0),
	}
	folderRows, err := queryer.QueryContext(ctx, `
select company_id::text, folder_id::text, user_id::text, parent_folder_id::text, name, position, created_timestamp, updated_timestamp
from pin_folders
where company_id=$1::uuid and user_id=$2::uuid
order by parent_folder_id nulls first, position, created_timestamp, folder_id`, input.CompanyID, input.UserID)
	if err != nil {
		return domain.UserPinTree{}, err
	}
	for folderRows.Next() {
		folder, scanErr := scanUserPinFolder(folderRows)
		if scanErr != nil {
			folderRows.Close()
			return domain.UserPinTree{}, scanErr
		}
		tree.PinFolders = append(tree.PinFolders, folder)
	}
	if err := folderRows.Err(); err != nil {
		folderRows.Close()
		return domain.UserPinTree{}, err
	}
	folderRows.Close()

	pinRows, err := queryer.QueryContext(ctx, `
select company_id::text, pin_id::text, user_id::text, parent_folder_id::text, resource_type, resource_id::text, name, position, created_timestamp
from pins
where company_id=$1::uuid and user_id=$2::uuid
order by parent_folder_id nulls first, position, created_timestamp, pin_id`, input.CompanyID, input.UserID)
	if err != nil {
		return domain.UserPinTree{}, err
	}
	defer pinRows.Close()
	for pinRows.Next() {
		pin, scanErr := scanUserPin(pinRows)
		if scanErr != nil {
			return domain.UserPinTree{}, scanErr
		}
		tree.UserPins = append(tree.UserPins, pin)
	}
	return tree, pinRows.Err()
}

func (r *PostgresRepo) UpsertUserPin(input UserPinInput) (domain.UserPin, error) {
	input, ok := normalizeUserPinInput(input)
	if !ok {
		return domain.UserPin{}, ErrInvalid
	}
	exists, err := r.userPinResourceExists(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return domain.UserPin{}, err
	}
	if !exists {
		return domain.UserPin{}, ErrNotFound
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.UserPin{}, err
	}
	defer tx.Rollback()
	if err := lockUserPinOwner(ctx, tx, input.CompanyID, input.UserID); err != nil {
		return domain.UserPin{}, err
	}
	if input.ParentFolderSet {
		if err := requireUserPinFolderTx(ctx, tx, input.CompanyID, input.UserID, input.ParentFolderID); err != nil {
			return domain.UserPin{}, err
		}
	}

	var existingPinID string
	var existingParent sql.NullString
	var existingPosition int
	err = tx.QueryRowContext(ctx, `
select pin_id::text, parent_folder_id::text, position
from pins
where company_id=$1::uuid and user_id=$2::uuid and resource_type=$3 and resource_id=$4::uuid
for update`, input.CompanyID, input.UserID, input.ResourceType, input.ResourceID).Scan(&existingPinID, &existingParent, &existingPosition)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return domain.UserPin{}, err
	}

	parentFolderID := input.ParentFolderID
	position := input.Position
	if existingPinID != "" {
		if !input.ParentFolderSet {
			parentFolderID = existingParent.String
			position = existingPosition
		} else if position <= 0 && existingParent.String == parentFolderID {
			position = existingPosition
		}
	}
	if position <= 0 {
		position, err = nextUserPinTreePositionTx(ctx, tx, input.CompanyID, input.UserID, parentFolderID)
		if err != nil {
			return domain.UserPin{}, err
		}
	}
	item, err := scanUserPin(tx.QueryRowContext(ctx, `
insert into pins (
  company_id, pin_id, user_id, parent_folder_id, resource_type, resource_id, name, position, created_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, nullif($4, '')::uuid, $5, $6::uuid, $7, $8, now())
on conflict (company_id, user_id, resource_type, resource_id) do update
set parent_folder_id=excluded.parent_folder_id,
    name=excluded.name,
    position=excluded.position
returning company_id::text, pin_id::text, user_id::text, parent_folder_id::text, resource_type, resource_id::text, name, position, created_timestamp`,
		input.CompanyID, input.PinID, input.UserID, parentFolderID, input.ResourceType, input.ResourceID, input.Name, position))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.UserPin{}, ErrNotFound
	}
	if err != nil {
		return domain.UserPin{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.UserPin{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteUserPin(input UserPinDeleteInput) error {
	input, ok := normalizeUserPinDeleteInput(input)
	if !ok {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `
delete from pins
where company_id=$1::uuid and user_id=$2::uuid and pin_id=$3::uuid`, input.CompanyID, input.UserID, input.PinID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) CreateUserPinFolder(input UserPinFolderCreateInput) (domain.UserPinFolder, error) {
	input, ok := normalizeUserPinFolderCreateInput(input)
	if !ok {
		return domain.UserPinFolder{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.UserPinFolder{}, err
	}
	defer tx.Rollback()
	if err := lockUserPinOwner(ctx, tx, input.CompanyID, input.UserID); err != nil {
		return domain.UserPinFolder{}, err
	}
	if err := requireUserPinFolderTx(ctx, tx, input.CompanyID, input.UserID, input.ParentFolderID); err != nil {
		return domain.UserPinFolder{}, err
	}
	position := input.Position
	if position <= 0 {
		position, err = nextUserPinTreePositionTx(ctx, tx, input.CompanyID, input.UserID, input.ParentFolderID)
		if err != nil {
			return domain.UserPinFolder{}, err
		}
	}
	folder, err := scanUserPinFolder(tx.QueryRowContext(ctx, `
insert into pin_folders (
  company_id, folder_id, user_id, parent_folder_id, name, position, created_timestamp, updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, nullif($4, '')::uuid, $5, $6, now(), now())
returning company_id::text, folder_id::text, user_id::text, parent_folder_id::text, name, position, created_timestamp, updated_timestamp`,
		input.CompanyID, input.FolderID, input.UserID, input.ParentFolderID, input.Name, position))
	if err != nil {
		return domain.UserPinFolder{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.UserPinFolder{}, err
	}
	return folder, nil
}

func (r *PostgresRepo) RenameUserPinFolder(input UserPinFolderRenameInput) (domain.UserPinFolder, error) {
	input, ok := normalizeUserPinFolderRenameInput(input)
	if !ok {
		return domain.UserPinFolder{}, ErrInvalid
	}
	folder, err := scanUserPinFolder(r.db.QueryRowContext(context.Background(), `
update pin_folders
set name=$4, updated_timestamp=now()
where company_id=$1::uuid and user_id=$2::uuid and folder_id=$3::uuid
returning company_id::text, folder_id::text, user_id::text, parent_folder_id::text, name, position, created_timestamp, updated_timestamp`,
		input.CompanyID, input.UserID, input.FolderID, input.Name))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.UserPinFolder{}, ErrNotFound
	}
	return folder, err
}

func (r *PostgresRepo) DeleteUserPinFolder(input UserPinFolderDeleteInput) error {
	input, ok := normalizeUserPinFolderDeleteInput(input)
	if !ok {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `
delete from pin_folders
where company_id=$1::uuid and user_id=$2::uuid and folder_id=$3::uuid`, input.CompanyID, input.UserID, input.FolderID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) ApplyUserPinLayout(input UserPinLayoutInput) error {
	input, ok := normalizeUserPinLayoutInput(input)
	if !ok {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := lockUserPinOwner(ctx, tx, input.CompanyID, input.UserID); err != nil {
		return err
	}
	parents := map[string]string{}
	folderRows, err := tx.QueryContext(ctx, `
select folder_id::text, coalesce(parent_folder_id::text, '')
from pin_folders
where company_id=$1::uuid and user_id=$2::uuid
for update`, input.CompanyID, input.UserID)
	if err != nil {
		return err
	}
	for folderRows.Next() {
		var folderID, parentFolderID string
		if err := folderRows.Scan(&folderID, &parentFolderID); err != nil {
			folderRows.Close()
			return err
		}
		parents[folderID] = parentFolderID
	}
	if err := folderRows.Err(); err != nil {
		folderRows.Close()
		return err
	}
	folderRows.Close()

	pinIDs := map[string]bool{}
	pinRows, err := tx.QueryContext(ctx, `
select pin_id::text
from pins
where company_id=$1::uuid and user_id=$2::uuid
for update`, input.CompanyID, input.UserID)
	if err != nil {
		return err
	}
	for pinRows.Next() {
		var pinID string
		if err := pinRows.Scan(&pinID); err != nil {
			pinRows.Close()
			return err
		}
		pinIDs[pinID] = true
	}
	if err := pinRows.Err(); err != nil {
		pinRows.Close()
		return err
	}
	pinRows.Close()

	for _, entry := range input.Entries {
		if entry.ParentFolderID != "" {
			if _, exists := parents[entry.ParentFolderID]; !exists {
				return ErrNotFound
			}
		}
		if entry.EntryType == UserPinLayoutEntryFolder {
			if _, exists := parents[entry.EntryID]; !exists {
				return ErrNotFound
			}
			parents[entry.EntryID] = entry.ParentFolderID
			continue
		}
		if !pinIDs[entry.EntryID] {
			return ErrNotFound
		}
	}
	if userPinFolderParentsHaveCycle(parents) {
		return ErrInvalid
	}
	for _, entry := range input.Entries {
		var result sql.Result
		if entry.EntryType == UserPinLayoutEntryFolder {
			result, err = tx.ExecContext(ctx, `
update pin_folders
set parent_folder_id=nullif($4, '')::uuid, position=$5, updated_timestamp=now()
where company_id=$1::uuid and user_id=$2::uuid and folder_id=$3::uuid`,
				input.CompanyID, input.UserID, entry.EntryID, entry.ParentFolderID, entry.Position)
		} else {
			result, err = tx.ExecContext(ctx, `
update pins
set parent_folder_id=nullif($4, '')::uuid, position=$5
where company_id=$1::uuid and user_id=$2::uuid and pin_id=$3::uuid`,
				input.CompanyID, input.UserID, entry.EntryID, entry.ParentFolderID, entry.Position)
		}
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count != 1 {
			return ErrNotFound
		}
	}
	return tx.Commit()
}

func (r *PostgresRepo) GroupUserPins(input UserPinGroupInput) (UserPinGroupResult, error) {
	input, ok := normalizeUserPinGroupInput(input)
	if !ok {
		return UserPinGroupResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return UserPinGroupResult{}, err
	}
	defer tx.Rollback()
	if err := lockUserPinOwner(ctx, tx, input.CompanyID, input.UserID); err != nil {
		return UserPinGroupResult{}, err
	}
	type lockedPin struct {
		id       string
		parentID string
		position int
	}
	locked := map[string]lockedPin{}
	rows, err := tx.QueryContext(ctx, `
select pin_id::text, coalesce(parent_folder_id::text, ''), position
from pins
where company_id=$1::uuid and user_id=$2::uuid and pin_id in ($3::uuid, $4::uuid)
for update`, input.CompanyID, input.UserID, input.DraggedPinID, input.TargetPinID)
	if err != nil {
		return UserPinGroupResult{}, err
	}
	for rows.Next() {
		var pin lockedPin
		if err := rows.Scan(&pin.id, &pin.parentID, &pin.position); err != nil {
			rows.Close()
			return UserPinGroupResult{}, err
		}
		locked[pin.id] = pin
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return UserPinGroupResult{}, err
	}
	rows.Close()
	target, targetOK := locked[input.TargetPinID]
	if !targetOK || locked[input.DraggedPinID].id == "" {
		return UserPinGroupResult{}, ErrNotFound
	}
	folder, err := scanUserPinFolder(tx.QueryRowContext(ctx, `
insert into pin_folders (
  company_id, folder_id, user_id, parent_folder_id, name, position, created_timestamp, updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, nullif($4, '')::uuid, $5, $6, now(), now())
returning company_id::text, folder_id::text, user_id::text, parent_folder_id::text, name, position, created_timestamp, updated_timestamp`,
		input.CompanyID, input.FolderID, input.UserID, target.parentID, input.Name, target.position))
	if err != nil {
		return UserPinGroupResult{}, err
	}
	for index, pinID := range []string{input.TargetPinID, input.DraggedPinID} {
		result, err := tx.ExecContext(ctx, `
update pins
set parent_folder_id=$4::uuid, position=$5
where company_id=$1::uuid and user_id=$2::uuid and pin_id=$3::uuid`,
			input.CompanyID, input.UserID, pinID, input.FolderID, (index+1)*userPinPositionStep)
		if err != nil {
			return UserPinGroupResult{}, err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return UserPinGroupResult{}, err
		}
		if count != 1 {
			return UserPinGroupResult{}, ErrNotFound
		}
	}
	tree, err := queryUserPinTree(ctx, tx, UserPinListInput{CompanyID: input.CompanyID, UserID: input.UserID})
	if err != nil {
		return UserPinGroupResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return UserPinGroupResult{}, err
	}
	return UserPinGroupResult{Folder: folder, Tree: tree}, nil
}

func scanUserPin(row interface{ Scan(dest ...any) error }) (domain.UserPin, error) {
	var item domain.UserPin
	var parentFolderID sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.PinID,
		&item.UserID,
		&parentFolderID,
		&item.ResourceType,
		&item.ResourceID,
		&item.Name,
		&item.Position,
		&item.CreatedTimestamp,
	)
	item.ParentFolderID = userPinParentPointer(parentFolderID.String)
	return item, err
}

func scanUserPinFolder(row interface{ Scan(dest ...any) error }) (domain.UserPinFolder, error) {
	var folder domain.UserPinFolder
	var parentFolderID sql.NullString
	err := row.Scan(
		&folder.CompanyID,
		&folder.FolderID,
		&folder.UserID,
		&parentFolderID,
		&folder.Name,
		&folder.Position,
		&folder.CreatedTimestamp,
		&folder.UpdatedTimestamp,
	)
	folder.ParentFolderID = userPinParentPointer(parentFolderID.String)
	return folder, err
}

func lockUserPinOwner(ctx context.Context, tx *sql.Tx, companyID, userID string) error {
	var exists int
	err := tx.QueryRowContext(ctx, `
select 1
from company_memberships
where company_id=$1::uuid and user_id=$2::uuid
for update`, companyID, userID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvalid
	}
	return err
}

func requireUserPinFolderTx(ctx context.Context, tx *sql.Tx, companyID, userID, folderID string) error {
	if folderID == "" {
		return nil
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, `
select exists(
  select 1 from pin_folders
  where company_id=$1::uuid and user_id=$2::uuid and folder_id=$3::uuid
)`, companyID, userID, folderID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func nextUserPinTreePositionTx(ctx context.Context, tx *sql.Tx, companyID, userID, parentFolderID string) (int, error) {
	var position int
	err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + $4
from (
  select position
  from pin_folders
  where company_id=$1::uuid and user_id=$2::uuid
    and parent_folder_id is not distinct from nullif($3, '')::uuid
  union all
  select position
  from pins
  where company_id=$1::uuid and user_id=$2::uuid
    and parent_folder_id is not distinct from nullif($3, '')::uuid
) siblings`, companyID, userID, parentFolderID, userPinPositionStep).Scan(&position)
	return position, err
}

func (r *PostgresRepo) userPinResourceExists(companyID, resourceType, resourceID string) (bool, error) {
	var exists bool
	var query string
	switch resourceType {
	case EntityTypeNode:
		query = "select exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)"
	case EntityTypeLogicGate:
		query = "select exists(select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid)"
	case EntityTypeProject:
		query = "select exists(select 1 from projects where company_id=$1::uuid and project_id=$2::uuid)"
	default:
		return false, ErrInvalid
	}
	if err := r.db.QueryRowContext(context.Background(), query, companyID, resourceID).Scan(&exists); err != nil {
		return false, err
	}
	return exists, nil
}
