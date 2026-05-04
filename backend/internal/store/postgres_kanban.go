package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"strings"
)

type kanbanBoardEnsurer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func ensureKanbanBoardSQL(ctx context.Context, exec kanbanBoardEnsurer, companyID, boardID, title string) error {
	_, err := exec.ExecContext(ctx, `
insert into kanban_boards (company_id, board_id, title, position, created_timestamp, updated_timestamp)
select $1, $2, $3, coalesce(max(position), 0) + 1000, now(), now()
from kanban_boards
where company_id=$1
on conflict (company_id, board_id) do nothing`,
		companyID, boardID, normalizeKanbanBoardTitle(boardID, title),
	)
	return err
}

func scanKanbanBoard(row interface {
	Scan(dest ...any) error
}) (domain.KanbanBoard, error) {
	var item domain.KanbanBoard
	err := row.Scan(
		&item.CompanyID,
		&item.BoardID,
		&item.Title,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	return item, err
}

func (r *PostgresRepo) ListKanbanBoards(companyID string, query KanbanBoardQuery) ([]domain.KanbanBoard, error) {
	ctx := context.Background()
	query = NormalizeKanbanBoardQuery(query)
	rows, err := r.db.QueryContext(ctx, `
select company_id, board_id, title, position, created_timestamp, updated_timestamp
from kanban_boards
where company_id=$1
  and ($2 = 0 or position > $2)
order by position asc, created_timestamp asc, board_id asc
limit $3`, companyID, query.AfterPosition, query.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.KanbanBoard, 0)
	for rows.Next() {
		item, err := scanKanbanBoard(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CreateKanbanBoard(companyID, boardID, title string, position int) (domain.KanbanBoard, error) {
	ctx := context.Background()
	if boardID == "" {
		boardID = newUUIDv7String()
	}
	positionWasProvided := position > 0
	if position <= 0 {
		if err := r.db.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from kanban_boards
where company_id=$1`, companyID).Scan(&position); err != nil {
			return domain.KanbanBoard{}, err
		}
	}
	item, err := scanKanbanBoard(r.db.QueryRowContext(ctx, `
insert into kanban_boards (company_id, board_id, title, position, created_timestamp, updated_timestamp)
values ($1, $2, $3, $4, now(), now())
on conflict (company_id, board_id)
do update set
  title=excluded.title,
  position=case when $5 then excluded.position else kanban_boards.position end,
  updated_timestamp=now()
returning company_id, board_id, title, position, created_timestamp, updated_timestamp`,
		companyID, boardID, normalizeKanbanBoardTitle(boardID, title), position, positionWasProvided,
	))
	return item, err
}

func (r *PostgresRepo) UpdateKanbanBoard(companyID, boardID, title string, position int) (domain.KanbanBoard, error) {
	item, err := scanKanbanBoard(r.db.QueryRow(`
update kanban_boards
set title=coalesce(nullif($3, ''), title),
    position=case when $4 > 0 then $4 else position end,
    updated_timestamp=now()
where company_id=$1 and board_id=$2
returning company_id, board_id, title, position, created_timestamp, updated_timestamp`,
		companyID, boardID, strings.TrimSpace(title), position,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.KanbanBoard{}, ErrNotFound
	}
	return item, err
}

func (r *PostgresRepo) DeleteKanbanBoard(companyID, boardID string) error {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

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
	return tx.Commit()
}

func scanKanbanColumn(row interface {
	Scan(dest ...any) error
}) (domain.KanbanColumn, error) {
	var item domain.KanbanColumn
	err := row.Scan(
		&item.CompanyID,
		&item.BoardID,
		&item.ColumnID,
		&item.Title,
		&item.Position,
		&item.WidthPx,
		&item.HeightPx,
		&item.ItemColor,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	return item, err
}

func scanKanbanCard(row interface {
	Scan(dest ...any) error
}) (domain.KanbanCard, error) {
	var item domain.KanbanCard
	err := row.Scan(
		&item.CompanyID,
		&item.BoardID,
		&item.CardID,
		&item.ColumnID,
		&item.NodeID,
		&item.NodeTitle,
		&item.DescriptionSnapshot,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	return item, err
}

const kanbanCardSelectColumns = `
company_id, board_id, card_id, column_id, node_id::text,
node_title, description_snapshot, position, created_timestamp, updated_timestamp`

func (r *PostgresRepo) ListKanbanColumns(companyID, boardID string) ([]domain.KanbanColumn, error) {
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx, `
select company_id, board_id, column_id, title, position, width_px, height_px, item_color, created_timestamp, updated_timestamp
from kanban_columns
where company_id=$1 and board_id=$2
order by position asc, created_timestamp asc`, companyID, boardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.KanbanColumn, 0)
	for rows.Next() {
		item, err := scanKanbanColumn(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CreateKanbanColumn(companyID, boardID, title string, position int, widthPx int, heightPx int, itemColor string) (domain.KanbanColumn, error) {
	ctx := context.Background()
	if err := ensureKanbanBoardSQL(ctx, r.db, companyID, boardID, boardID); err != nil {
		return domain.KanbanColumn{}, err
	}
	if position <= 0 {
		if err := r.db.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from kanban_columns
where company_id=$1 and board_id=$2`, companyID, boardID).Scan(&position); err != nil {
			return domain.KanbanColumn{}, err
		}
	}
	widthPx = normalizeKanbanColumnWidth(widthPx)
	heightPx = normalizeKanbanColumnHeight(heightPx)
	itemColor = normalizeKanbanColumnItemColor(itemColor)
	return scanKanbanColumn(r.db.QueryRowContext(ctx, `
insert into kanban_columns (company_id, board_id, column_id, title, position, width_px, height_px, item_color, created_timestamp, updated_timestamp)
values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
returning company_id, board_id, column_id, title, position, width_px, height_px, item_color, created_timestamp, updated_timestamp`,
		companyID, boardID, newUUIDv7String(), title, position, widthPx, heightPx, itemColor,
	))
}

func (r *PostgresRepo) UpdateKanbanColumn(companyID, boardID, columnID, title string, position int, widthPx int, heightPx int, itemColor string) (domain.KanbanColumn, error) {
	if widthPx > 0 {
		widthPx = normalizeKanbanColumnWidth(widthPx)
	}
	if heightPx > 0 {
		heightPx = normalizeKanbanColumnHeight(heightPx)
	}
	if strings.TrimSpace(itemColor) != "" {
		itemColor = normalizeKanbanColumnItemColor(itemColor)
	}
	item, err := scanKanbanColumn(r.db.QueryRow(`
update kanban_columns
set title=coalesce(nullif($4, ''), title),
    position=case when $5 > 0 then $5 else position end,
    width_px=case when $6 > 0 then $6 else width_px end,
    height_px=case when $7 > 0 then $7 else height_px end,
    item_color=coalesce(nullif($8, ''), item_color),
    updated_timestamp=now()
where company_id=$1 and board_id=$2 and column_id=$3
returning company_id, board_id, column_id, title, position, width_px, height_px, item_color, created_timestamp, updated_timestamp`,
		companyID, boardID, columnID, title, position, widthPx, heightPx, itemColor,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.KanbanColumn{}, ErrNotFound
	}
	return item, err
}

func (r *PostgresRepo) DeleteKanbanColumn(companyID, boardID, columnID string) error {
	result, err := r.db.Exec(`
delete from kanban_columns
where company_id=$1 and board_id=$2 and column_id=$3`,
		companyID, boardID, columnID,
	)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) ListKanbanCards(companyID, boardID string, query KanbanCardQuery) ([]domain.KanbanCard, error) {
	ctx := context.Background()
	query = NormalizeKanbanCardQuery(query)
	where := []string{"company_id=$1", "board_id=$2"}
	args := []any{companyID, boardID}
	addArg := func(value any) string {
		args = append(args, value)
		return fmt.Sprintf("$%d", len(args))
	}
	if query.ColumnID != "" {
		where = append(where, "column_id::text="+addArg(query.ColumnID))
	}
	if query.AfterPosition > 0 {
		where = append(where, "position>"+addArg(query.AfterPosition))
	}
	orderBy := []string{"column_id asc", "position asc", "created_timestamp asc", "card_id asc"}
	limitPlaceholder := addArg(query.Limit)
	sqlText := fmt.Sprintf(`
select %s
from kanban_cards
where %s
order by %s
limit %s`, kanbanCardSelectColumns, strings.Join(where, " and "), strings.Join(orderBy, ", "), limitPlaceholder)
	rows, err := r.db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.KanbanCard, 0)
	for rows.Next() {
		item, err := scanKanbanCard(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) UpsertKanbanCard(input KanbanCardMutationInput) (domain.KanbanCard, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.KanbanCard{}, err
	}
	defer tx.Rollback()
	if err := ensureKanbanBoardSQL(ctx, tx, input.CompanyID, input.BoardID, input.BoardID); err != nil {
		return domain.KanbanCard{}, err
	}

	var columnExists bool
	if err := tx.QueryRowContext(ctx, `
select exists(select 1 from kanban_columns where company_id=$1 and board_id=$2 and column_id=$3)`,
		input.CompanyID, input.BoardID, input.ColumnID).Scan(&columnExists); err != nil {
		return domain.KanbanCard{}, err
	}
	if !columnExists {
		return domain.KanbanCard{}, ErrNotFound
	}

	var canonicalNodeTitle string
	if err := tx.QueryRowContext(ctx, `
select title
from nodes
where company_id=$1 and node_id=$2`,
		input.CompanyID, input.NodeID).Scan(&canonicalNodeTitle); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.KanbanCard{}, ErrNotFound
		}
		return domain.KanbanCard{}, err
	}

	if input.Position <= 0 {
		if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from kanban_cards
where company_id=$1 and board_id=$2 and column_id=$3`, input.CompanyID, input.BoardID, input.ColumnID).Scan(&input.Position); err != nil {
			return domain.KanbanCard{}, err
		}
	}

	nodeTitle := strings.TrimSpace(canonicalNodeTitle)
	if nodeTitle == "" {
		nodeTitle = normalizeKanbanBoardTitle(input.NodeID, input.NodeTitle)
	}
	descriptionSnapshot := strings.TrimSpace(input.DescriptionSnapshot)

	var item domain.KanbanCard
	item, err = scanKanbanCard(tx.QueryRowContext(ctx, `
update kanban_cards
set column_id=$4,
    node_title=$5,
    description_snapshot=case when $6 <> '' then $6 else description_snapshot end,
    position=$7,
    updated_timestamp=now()
where company_id=$1 and board_id=$2 and node_id=$3
returning `+kanbanCardSelectColumns,
		input.CompanyID, input.BoardID, input.NodeID, input.ColumnID, nodeTitle, descriptionSnapshot, input.Position,
	))
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return domain.KanbanCard{}, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		item, err = scanKanbanCard(tx.QueryRowContext(ctx, `
insert into kanban_cards (
  company_id, board_id, card_id, column_id, node_id, node_title,
  description_snapshot, position, created_timestamp, updated_timestamp
) values ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
returning `+kanbanCardSelectColumns,
			input.CompanyID, input.BoardID, newUUIDv7String(), input.ColumnID,
			input.NodeID, nodeTitle, descriptionSnapshot, input.Position,
		))
		if err != nil {
			return domain.KanbanCard{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return domain.KanbanCard{}, err
	}
	return item, nil
}

func (r *PostgresRepo) MoveKanbanCard(input KanbanCardMoveInput) (domain.KanbanCard, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.KanbanCard{}, err
	}
	defer tx.Rollback()

	var columnExists bool
	if err := tx.QueryRowContext(ctx, `
select exists(select 1 from kanban_columns where company_id=$1 and board_id=$2 and column_id=$3)`,
		input.CompanyID, input.BoardID, input.ColumnID).Scan(&columnExists); err != nil {
		return domain.KanbanCard{}, err
	}
	if !columnExists {
		return domain.KanbanCard{}, ErrNotFound
	}
	if input.Position <= 0 {
		if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from kanban_cards
where company_id=$1 and board_id=$2 and column_id=$3`, input.CompanyID, input.BoardID, input.ColumnID).Scan(&input.Position); err != nil {
			return domain.KanbanCard{}, err
		}
	}

	item, err := scanKanbanCard(tx.QueryRowContext(ctx, `
update kanban_cards
set column_id=$4,
    node_title=coalesce((select title from nodes where company_id=$1 and node_id=kanban_cards.node_id), node_title),
    position=$5,
    updated_timestamp=now()
where company_id=$1 and board_id=$2 and card_id=$3
returning `+kanbanCardSelectColumns,
		input.CompanyID, input.BoardID, input.CardID, input.ColumnID, input.Position,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.KanbanCard{}, ErrNotFound
	}
	if err != nil {
		return domain.KanbanCard{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.KanbanCard{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteKanbanCard(companyID, boardID, cardID string) error {
	result, err := r.db.Exec(`
delete from kanban_cards
where company_id=$1 and board_id=$2 and card_id=$3`,
		companyID, boardID, cardID,
	)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}
