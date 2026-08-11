package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strconv"
)

func (r *PostgresRepo) ListRACITabBranch(input RACITabBranchInput) (domain.RACITabPage, error) {
	input, ok := normalizeRACITabBranchInput(input)
	if !ok {
		return domain.RACITabPage{}, ErrInvalid
	}
	ctx := context.Background()
	if err := requirePostgresRACITabMembership(ctx, r.db, input.CompanyID, input.UserID); err != nil {
		return domain.RACITabPage{}, err
	}
	if input.ParentFolderID != "" {
		var exists bool
		if err := r.db.QueryRowContext(ctx, `
select exists(
  select 1 from raci_tabs_folders
  where company_id=$1::uuid and user_id=$2::uuid and role=$3 and folder_id=$4::uuid
)`, input.CompanyID, input.UserID, input.Role, input.ParentFolderID).Scan(&exists); err != nil {
			return domain.RACITabPage{}, err
		}
		if !exists {
			return domain.RACITabPage{}, ErrNotFound
		}
	}

	page := domain.RACITabPage{Role: input.Role, Rows: []domain.RACITabRow{}}
	if input.ParentFolderID != "" {
		parentID := input.ParentFolderID
		page.ParentFolderID = &parentID
	}
	if err := r.db.QueryRowContext(ctx, raciTabRoleCountsSQL, input.CompanyID, input.UserID, input.Role).Scan(
		&page.StatusCounts.Request,
		&page.StatusCounts.Pending,
		&page.StatusCounts.InProgress,
		&page.StatusCounts.Review,
	); err != nil {
		return domain.RACITabPage{}, err
	}

	rows, err := r.db.QueryContext(ctx, raciTabBranchSQL,
		input.CompanyID,
		input.UserID,
		input.Role,
		raciTabNullableUUID(input.ParentFolderID),
		input.Offset,
		input.Limit+1,
	)
	if err != nil {
		return domain.RACITabPage{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			kind, folderID, logicGateID, parentFolderID string
			name                                        string
			position                                    int
			createdTimestamp, updatedTimestamp          sql.NullTime
			hasChildren                                 bool
			counts                                      domain.RACITabStatusCounts
		)
		if err := rows.Scan(
			&kind,
			&folderID,
			&logicGateID,
			&parentFolderID,
			&name,
			&position,
			&createdTimestamp,
			&updatedTimestamp,
			&hasChildren,
			&counts.Request,
			&counts.Pending,
			&counts.InProgress,
			&counts.Review,
		); err != nil {
			return domain.RACITabPage{}, err
		}
		if kind == RACITabLayoutEntryFolder {
			folder := domain.RACITabFolder{
				CompanyID: input.CompanyID, FolderID: folderID, UserID: input.UserID, Role: input.Role,
				Name: name, Position: position, CreatedTimestamp: createdTimestamp.Time, UpdatedTimestamp: updatedTimestamp.Time,
				HasChildren: hasChildren, StatusCounts: counts,
			}
			if parentFolderID != "" {
				folder.ParentFolderID = &parentFolderID
			}
			page.Rows = append(page.Rows, domain.RACITabRow{RowKind: kind, Folder: &folder})
			continue
		}
		item := domain.RACITabItem{
			CompanyID: input.CompanyID, UserID: input.UserID, Role: input.Role, LogicGateID: logicGateID,
			Name: name, Position: position, CreatedTimestamp: createdTimestamp.Time, UpdatedTimestamp: updatedTimestamp.Time,
			StatusCounts: counts,
		}
		if parentFolderID != "" {
			item.FolderID = &parentFolderID
		}
		page.Rows = append(page.Rows, domain.RACITabRow{RowKind: RACITabLayoutEntryItem, Item: &item})
	}
	if err := rows.Err(); err != nil {
		return domain.RACITabPage{}, err
	}
	if len(page.Rows) > input.Limit {
		page.Rows = page.Rows[:input.Limit]
		page.NextCursor = strconv.Itoa(input.Offset + input.Limit)
	}
	return page, nil
}

func (r *PostgresRepo) GetRACITabLogicGateCounts(input RACITabLogicGateCountsInput) (domain.RACITabStatusCounts, error) {
	input, ok := normalizeRACITabLogicGateCountsInput(input)
	if !ok {
		return domain.RACITabStatusCounts{}, ErrInvalid
	}
	var counts domain.RACITabStatusCounts
	err := r.db.QueryRowContext(context.Background(), `
select
  count(*) filter (where projection.status_rank=0)::integer,
  count(*) filter (where projection.status_rank=2)::integer,
  count(*) filter (where projection.status_rank=3)::integer,
  count(*) filter (where projection.status_rank=4)::integer
from raci_tabs_items item
left join kanban_board_projection projection
  on projection.company_id=item.company_id
 and projection.logic_gate_id=item.logic_gate_id
where item.company_id=$1::uuid
  and item.user_id=$2::uuid
  and item.logic_gate_id=$3::uuid
group by item.logic_gate_id`, input.CompanyID, input.UserID, input.LogicGateID).Scan(
		&counts.Request,
		&counts.Pending,
		&counts.InProgress,
		&counts.Review,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.RACITabStatusCounts{}, ErrNotFound
	}
	return counts, err
}

func (r *PostgresRepo) CreateRACITabFolder(input RACITabFolderCreateInput) (domain.RACITabFolder, error) {
	input, ok := normalizeRACITabFolderCreateInput(input)
	if !ok {
		return domain.RACITabFolder{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.RACITabFolder{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresRACITabMembership(ctx, tx, input.CompanyID, input.UserID); err != nil {
		return domain.RACITabFolder{}, err
	}
	if input.ParentFolderID != "" {
		var exists bool
		if err := tx.QueryRowContext(ctx, `
select exists(
  select 1 from raci_tabs_folders
  where company_id=$1::uuid and user_id=$2::uuid and role=$3 and folder_id=$4::uuid
)`, input.CompanyID, input.UserID, input.Role, input.ParentFolderID).Scan(&exists); err != nil {
			return domain.RACITabFolder{}, err
		}
		if !exists {
			return domain.RACITabFolder{}, ErrInvalid
		}
	}
	var position int
	if err := tx.QueryRowContext(ctx, `
select coalesce(max(position),0)+1000
from (
  select folder.position
  from raci_tabs_folders folder
  where folder.company_id=$1::uuid and folder.user_id=$2::uuid and folder.role=$3
    and folder.parent_folder_id is not distinct from $4::uuid
  union all
  select item.position
  from raci_tabs_items item
  where item.company_id=$1::uuid and item.user_id=$2::uuid and item.role=$3
    and item.folder_id is not distinct from $4::uuid
) sibling`, input.CompanyID, input.UserID, input.Role, raciTabNullableUUID(input.ParentFolderID)).Scan(&position); err != nil {
		return domain.RACITabFolder{}, err
	}
	var folder domain.RACITabFolder
	var parentFolderID string
	err = tx.QueryRowContext(ctx, `
insert into raci_tabs_folders(
  company_id,folder_id,user_id,role,parent_folder_id,name,position
) values ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7)
returning company_id::text,folder_id::text,user_id::text,role,
          coalesce(parent_folder_id::text,''),name,position,created_timestamp,updated_timestamp`,
		input.CompanyID, input.FolderID, input.UserID, input.Role, raciTabNullableUUID(input.ParentFolderID), input.Name, position,
	).Scan(
		&folder.CompanyID, &folder.FolderID, &folder.UserID, &folder.Role, &parentFolderID,
		&folder.Name, &folder.Position, &folder.CreatedTimestamp, &folder.UpdatedTimestamp,
	)
	if err != nil {
		return domain.RACITabFolder{}, err
	}
	if parentFolderID != "" {
		folder.ParentFolderID = &parentFolderID
	}
	if err := tx.Commit(); err != nil {
		return domain.RACITabFolder{}, err
	}
	return folder, nil
}

func (r *PostgresRepo) RenameRACITabFolder(input RACITabFolderRenameInput) (domain.RACITabFolder, error) {
	input, ok := normalizeRACITabFolderRenameInput(input)
	if !ok {
		return domain.RACITabFolder{}, ErrInvalid
	}
	var folder domain.RACITabFolder
	var parentFolderID string
	err := r.db.QueryRowContext(context.Background(), `
update raci_tabs_folders
set name=$4,updated_timestamp=now()
where company_id=$1::uuid and user_id=$2::uuid and folder_id=$3::uuid
returning company_id::text,folder_id::text,user_id::text,role,
          coalesce(parent_folder_id::text,''),name,position,created_timestamp,updated_timestamp`,
		input.CompanyID, input.UserID, input.FolderID, input.Name,
	).Scan(
		&folder.CompanyID, &folder.FolderID, &folder.UserID, &folder.Role, &parentFolderID,
		&folder.Name, &folder.Position, &folder.CreatedTimestamp, &folder.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.RACITabFolder{}, ErrNotFound
	}
	if err != nil {
		return domain.RACITabFolder{}, err
	}
	if parentFolderID != "" {
		folder.ParentFolderID = &parentFolderID
	}
	return folder, nil
}

func (r *PostgresRepo) DeleteRACITabFolder(input RACITabFolderDeleteInput) error {
	input, ok := normalizeRACITabFolderDeleteInput(input)
	if !ok {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := lockPostgresRACITabMembership(ctx, tx, input.CompanyID, input.UserID); err != nil {
		return err
	}
	var role string
	err = tx.QueryRowContext(ctx, `
select role from raci_tabs_folders
where company_id=$1::uuid and user_id=$2::uuid and folder_id=$3::uuid
for update`, input.CompanyID, input.UserID, input.FolderID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
with recursive subtree(folder_id) as (
  select $3::uuid
  union
  select child.folder_id
  from raci_tabs_folders child
  join subtree parent on child.parent_folder_id=parent.folder_id
  where child.company_id=$1::uuid and child.user_id=$2::uuid and child.role=$4
), root_max as (
  select coalesce(max(position),0) as position
  from (
    select folder.position
    from raci_tabs_folders folder
    where folder.company_id=$1::uuid and folder.user_id=$2::uuid and folder.role=$4
      and folder.parent_folder_id is null
      and folder.folder_id not in (select folder_id from subtree)
    union all
    select item.position
    from raci_tabs_items item
    where item.company_id=$1::uuid and item.user_id=$2::uuid and item.role=$4
      and item.folder_id is null
  ) sibling
), moving as (
  select item.company_id,item.user_id,item.logic_gate_id,
         row_number() over (order by item.position,item.created_timestamp,lower(item.name),item.logic_gate_id)::integer as ordinal
  from raci_tabs_items item
  where item.company_id=$1::uuid and item.user_id=$2::uuid and item.role=$4
    and item.folder_id in (select folder_id from subtree)
)
update raci_tabs_items item
set folder_id=null,
    position=root_max.position + moving.ordinal*1000,
    updated_timestamp=now()
from moving,root_max
where item.company_id=moving.company_id
  and item.user_id=moving.user_id
  and item.logic_gate_id=moving.logic_gate_id`, input.CompanyID, input.UserID, input.FolderID, role)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
delete from raci_tabs_folders
where company_id=$1::uuid and user_id=$2::uuid and folder_id=$3::uuid`, input.CompanyID, input.UserID, input.FolderID)
	if err != nil {
		return err
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr != nil || affected != 1 {
		if affectedErr != nil {
			return affectedErr
		}
		return ErrNotFound
	}
	return tx.Commit()
}

func (r *PostgresRepo) ApplyRACITabLayout(input RACITabLayoutInput) error {
	input, ok := normalizeRACITabLayoutInput(input)
	if !ok {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := lockPostgresRACITabMembership(ctx, tx, input.CompanyID, input.UserID); err != nil {
		return err
	}

	folderParents := map[string]string{}
	folderRows, err := tx.QueryContext(ctx, `
select folder_id::text,coalesce(parent_folder_id::text,'')
from raci_tabs_folders
where company_id=$1::uuid and user_id=$2::uuid and role=$3
for update`, input.CompanyID, input.UserID, input.Role)
	if err != nil {
		return err
	}
	for folderRows.Next() {
		var folderID, parentFolderID string
		if err := folderRows.Scan(&folderID, &parentFolderID); err != nil {
			folderRows.Close()
			return err
		}
		folderParents[folderID] = parentFolderID
	}
	if err := folderRows.Close(); err != nil {
		return err
	}
	if err := folderRows.Err(); err != nil {
		return err
	}

	itemIDs := map[string]bool{}
	itemRows, err := tx.QueryContext(ctx, `
select logic_gate_id::text
from raci_tabs_items
where company_id=$1::uuid and user_id=$2::uuid and role=$3
for update`, input.CompanyID, input.UserID, input.Role)
	if err != nil {
		return err
	}
	for itemRows.Next() {
		var logicGateID string
		if err := itemRows.Scan(&logicGateID); err != nil {
			itemRows.Close()
			return err
		}
		itemIDs[logicGateID] = true
	}
	if err := itemRows.Close(); err != nil {
		return err
	}
	if err := itemRows.Err(); err != nil {
		return err
	}

	for _, entry := range input.Entries {
		if entry.ParentFolderID != "" {
			if _, exists := folderParents[entry.ParentFolderID]; !exists {
				return ErrInvalid
			}
		}
		switch entry.EntryType {
		case RACITabLayoutEntryFolder:
			if _, exists := folderParents[entry.EntryID]; !exists || entry.EntryID == entry.ParentFolderID {
				return ErrInvalid
			}
			folderParents[entry.EntryID] = entry.ParentFolderID
		case RACITabLayoutEntryItem:
			if !itemIDs[entry.EntryID] {
				return ErrInvalid
			}
		default:
			return ErrInvalid
		}
	}
	for folderID := range folderParents {
		seen := map[string]bool{folderID: true}
		for parentID := folderParents[folderID]; parentID != ""; parentID = folderParents[parentID] {
			if seen[parentID] {
				return ErrInvalid
			}
			seen[parentID] = true
		}
	}

	for _, entry := range input.Entries {
		if entry.EntryType == RACITabLayoutEntryFolder {
			if _, err := tx.ExecContext(ctx, `
update raci_tabs_folders
set parent_folder_id=$5::uuid,position=$6,updated_timestamp=now()
where company_id=$1::uuid and user_id=$2::uuid and role=$3 and folder_id=$4::uuid`,
				input.CompanyID, input.UserID, input.Role, entry.EntryID, raciTabNullableUUID(entry.ParentFolderID), entry.Position,
			); err != nil {
				return err
			}
			continue
		}
		if _, err := tx.ExecContext(ctx, `
update raci_tabs_items
set folder_id=$5::uuid,position=$6,updated_timestamp=now()
where company_id=$1::uuid and user_id=$2::uuid and role=$3 and logic_gate_id=$4::uuid`,
			input.CompanyID, input.UserID, input.Role, entry.EntryID, raciTabNullableUUID(entry.ParentFolderID), entry.Position,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func requirePostgresRACITabMembership(ctx context.Context, queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, companyID, userID string) error {
	var exists bool
	if err := queryer.QueryRowContext(ctx, `
select exists(
  select 1 from company_memberships where company_id=$1::uuid and user_id=$2::uuid
)`, companyID, userID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func lockPostgresRACITabMembership(ctx context.Context, tx *sql.Tx, companyID, userID string) error {
	var one int
	err := tx.QueryRowContext(ctx, `
select 1 from company_memberships
where company_id=$1::uuid and user_id=$2::uuid
for update`, companyID, userID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func raciTabNullableUUID(value string) any {
	if value == "" {
		return nil
	}
	return value
}

const raciTabRoleCountsSQL = `
select
  count(*) filter (where projection.status_rank=0)::integer,
  count(*) filter (where projection.status_rank=2)::integer,
  count(*) filter (where projection.status_rank=3)::integer,
  count(*) filter (where projection.status_rank=4)::integer
from raci_tabs_items item
left join kanban_board_projection projection
  on projection.company_id=item.company_id
 and projection.logic_gate_id=item.logic_gate_id
where item.company_id=$1::uuid
  and item.user_id=$2::uuid
  and item.role=$3`

const raciTabBranchSQL = `
with recursive gate_counts as (
  select
    projection.logic_gate_id,
    count(*) filter (where projection.status_rank=0)::integer as request_count,
    count(*) filter (where projection.status_rank=2)::integer as pending_count,
    count(*) filter (where projection.status_rank=3)::integer as in_progress_count,
    count(*) filter (where projection.status_rank=4)::integer as review_count
  from kanban_board_projection projection
  where projection.company_id=$1::uuid
  group by projection.logic_gate_id
), folder_tree(ancestor_folder_id,descendant_folder_id) as (
  select folder.folder_id,folder.folder_id
  from raci_tabs_folders folder
  where folder.company_id=$1::uuid and folder.user_id=$2::uuid and folder.role=$3
  union
  select tree.ancestor_folder_id,child.folder_id
  from folder_tree tree
  join raci_tabs_folders child
    on child.company_id=$1::uuid and child.user_id=$2::uuid and child.role=$3
   and child.parent_folder_id=tree.descendant_folder_id
), folder_totals as (
  select
    tree.ancestor_folder_id,
    coalesce(sum(counts.request_count),0)::integer as request_count,
    coalesce(sum(counts.pending_count),0)::integer as pending_count,
    coalesce(sum(counts.in_progress_count),0)::integer as in_progress_count,
    coalesce(sum(counts.review_count),0)::integer as review_count
  from folder_tree tree
  left join raci_tabs_items item
    on item.company_id=$1::uuid and item.user_id=$2::uuid and item.role=$3
   and item.folder_id=tree.descendant_folder_id
  left join gate_counts counts on counts.logic_gate_id=item.logic_gate_id
  group by tree.ancestor_folder_id
), direct_rows as (
  select
    'folder'::text as row_kind,
    folder.folder_id::text as folder_id,
    ''::text as logic_gate_id,
    coalesce(folder.parent_folder_id::text,'') as parent_folder_id,
    folder.name,
    folder.position,
    folder.created_timestamp,
    folder.updated_timestamp,
    exists(
      select 1 from raci_tabs_folders child
      where child.company_id=folder.company_id and child.user_id=folder.user_id and child.role=folder.role
        and child.parent_folder_id=folder.folder_id
      union all
      select 1 from raci_tabs_items child_item
      where child_item.company_id=folder.company_id and child_item.user_id=folder.user_id and child_item.role=folder.role
        and child_item.folder_id=folder.folder_id
    ) as has_children,
    coalesce(totals.request_count,0) as request_count,
    coalesce(totals.pending_count,0) as pending_count,
    coalesce(totals.in_progress_count,0) as in_progress_count,
    coalesce(totals.review_count,0) as review_count,
    folder.folder_id::text as exact_id
  from raci_tabs_folders folder
  left join folder_totals totals on totals.ancestor_folder_id=folder.folder_id
  where folder.company_id=$1::uuid and folder.user_id=$2::uuid and folder.role=$3
    and folder.parent_folder_id is not distinct from $4::uuid
  union all
  select
    'item'::text,
    ''::text,
    item.logic_gate_id::text,
    coalesce(item.folder_id::text,''),
    item.name,
    item.position,
    item.created_timestamp,
    item.updated_timestamp,
    false,
    coalesce(counts.request_count,0),
    coalesce(counts.pending_count,0),
    coalesce(counts.in_progress_count,0),
    coalesce(counts.review_count,0),
    item.logic_gate_id::text
  from raci_tabs_items item
  left join gate_counts counts on counts.logic_gate_id=item.logic_gate_id
  where item.company_id=$1::uuid and item.user_id=$2::uuid and item.role=$3
    and item.folder_id is not distinct from $4::uuid
)
select row_kind,folder_id,logic_gate_id,parent_folder_id,name,position,
       created_timestamp,updated_timestamp,has_children,
       request_count,pending_count,in_progress_count,review_count
from direct_rows
order by position,created_timestamp,lower(name),row_kind,exact_id
offset $5
limit $6`
