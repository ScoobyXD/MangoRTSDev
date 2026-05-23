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
insert into kanban_boards (company_id, board_id, logic_gate_id, title, position, created_timestamp, updated_timestamp)
select $1, $2, null, $3, coalesce(max(position), 0) + 1000, now(), now()
from kanban_boards
where company_id=$1
on conflict (company_id, board_id) do nothing`,
		companyID, boardID, normalizeKanbanBoardTitle(boardID, title),
	)
	return err
}

func ensureLogicGateKanbanBoardSQL(ctx context.Context, exec kanbanBoardEnsurer, companyID, logicGateID, title string) error {
	boardID := LogicGateKanbanBoardID(logicGateID)
	if _, err := exec.ExecContext(ctx,
		`select pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	_, err := exec.ExecContext(ctx, `
with preferred as (
  select
    $1::uuid as company_id,
    $2::text as preferred_board_id,
    $3::uuid as logic_gate_id,
    $4::text as title
),
existing as (
  select kb.board_id
  from kanban_boards kb, preferred p
  where kb.company_id = p.company_id
    and kb.logic_gate_id = p.logic_gate_id
  order by (kb.board_id = p.preferred_board_id) desc, kb.created_timestamp asc, kb.board_id asc
  limit 1
),
inserted as (
  insert into kanban_boards (company_id, board_id, logic_gate_id, title, position, created_timestamp, updated_timestamp)
  select
    p.company_id,
    p.preferred_board_id,
    p.logic_gate_id,
    p.title,
    coalesce(max(kb.position), 0) + 1000,
    now(),
    now()
  from preferred p
  left join kanban_boards kb on kb.company_id = p.company_id
  where not exists (select 1 from existing)
  group by p.company_id, p.preferred_board_id, p.logic_gate_id, p.title
  on conflict (company_id, board_id)
  do update set
    logic_gate_id = excluded.logic_gate_id,
    title = excluded.title,
    updated_timestamp = now()
  returning board_id
),
updated_existing as (
  update kanban_boards kb
  set logic_gate_id = p.logic_gate_id,
      title = p.title,
      updated_timestamp = now()
  from preferred p, existing e
  where kb.company_id = p.company_id
    and kb.board_id = e.board_id
  returning kb.board_id
),
board_target as (
  select board_id from updated_existing
  union all
  select board_id from inserted
  limit 1
),
defaults(title, position, color) as (
  values
    ('Pending', 1000, $5::text),
    ('In Progress', 2000, $6::text),
    ('Done', 3000, $7::text)
)
insert into kanban_columns (
  company_id,
  board_id,
  column_id,
  title,
  position,
  width_px,
  height_px,
  item_color,
  created_timestamp,
  updated_timestamp
)
select
  p.company_id,
  b.board_id,
  md5((p.company_id::text || ':' || b.board_id || ':' || d.title))::uuid,
  d.title,
  d.position,
  260,
  240,
  d.color,
  now(),
  now()
from preferred p
cross join board_target b
cross join defaults d
where not exists (
  select 1
  from kanban_columns kc
  where kc.company_id = p.company_id
    and kc.board_id = b.board_id
    and lower(btrim(kc.title)) = lower(btrim(d.title))
)
on conflict (company_id, board_id, column_id)
do update set
  title = excluded.title,
  updated_timestamp = now()`,
		companyID,
		boardID,
		logicGateID,
		normalizeKanbanBoardTitle(boardID, title),
		KanbanDefaultPendingColor,
		KanbanDefaultInProgressColor,
		KanbanDefaultDoneColor,
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
		&item.LogicGateID,
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
select company_id, board_id, logic_gate_id::text, title, position, created_timestamp, updated_timestamp
from kanban_boards
where company_id=$1
  and ($2 = 0 or position > $2)
  and ($3 = '' or logic_gate_id::text = $3)
order by position asc, created_timestamp asc, board_id asc
limit $4`, companyID, query.AfterPosition, query.LogicGateID, query.Limit)
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

func (r *PostgresRepo) EnsureLogicGateKanbanBoard(companyID, logicGateID, title string) (domain.KanbanBoard, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.KanbanBoard{}, err
	}
	defer tx.Rollback()

	var exists bool
	if err := tx.QueryRowContext(ctx,
		`select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`,
		companyID, logicGateID,
	).Scan(&exists); err != nil {
		return domain.KanbanBoard{}, err
	}
	if !exists {
		return domain.KanbanBoard{}, ErrNotFound
	}
	if err := ensureLogicGateKanbanBoardSQL(ctx, tx, companyID, logicGateID, title); err != nil {
		return domain.KanbanBoard{}, err
	}
	board, err := scanKanbanBoard(tx.QueryRowContext(ctx, `
select company_id, board_id, logic_gate_id::text, title, position, created_timestamp, updated_timestamp
from kanban_boards
where company_id=$1 and logic_gate_id=$2::uuid
order by (board_id=$3) desc, created_timestamp asc, board_id asc
limit 1`,
		companyID, logicGateID, LogicGateKanbanBoardID(logicGateID),
	))
	if err != nil {
		return domain.KanbanBoard{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.KanbanBoard{}, err
	}
	return board, nil
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
  title=case
    when kanban_boards.logic_gate_id is not null then coalesce((
      select header from logic_gates
      where company_id=kanban_boards.company_id and logic_gate_id=kanban_boards.logic_gate_id
    ), kanban_boards.title)
    else excluded.title
  end,
  position=case when $5 then excluded.position else kanban_boards.position end,
  updated_timestamp=now()
returning company_id, board_id, logic_gate_id::text, title, position, created_timestamp, updated_timestamp`,
		companyID, boardID, normalizeKanbanBoardTitle(boardID, title), position, positionWasProvided,
	))
	return item, err
}

func (r *PostgresRepo) UpdateKanbanBoard(companyID, boardID, title string, position int) (domain.KanbanBoard, error) {
	item, err := scanKanbanBoard(r.db.QueryRow(`
update kanban_boards
set title=case
      when logic_gate_id is not null then coalesce((
        select header from logic_gates
        where company_id=kanban_boards.company_id and logic_gate_id=kanban_boards.logic_gate_id
      ), title)
      else coalesce(nullif($3, ''), title)
    end,
    position=case when $4 > 0 then $4 else position end,
    updated_timestamp=now()
where company_id=$1 and board_id=$2
returning company_id, board_id, logic_gate_id::text, title, position, created_timestamp, updated_timestamp`,
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
		&item.LogicGateID,
		&item.NodeTitle,
		&item.DescriptionSnapshot,
		&item.IsIssue,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	return item, err
}

const kanbanCardSelectColumns = `
company_id, board_id, card_id, column_id, node_id::text, logic_gate_id::text,
node_title, description_snapshot, is_issue, position, created_timestamp, updated_timestamp`

func syncNodeStatusFromKanbanCardSQL(ctx context.Context, exec kanbanBoardEnsurer, card domain.KanbanCard) error {
	if card.LogicGateID == nil {
		return nil
	}
	_, err := exec.ExecContext(ctx, `
update nodes
set status=case
      when $5 then 'Issue'
      else coalesce((
        select title
        from kanban_columns
        where company_id=$1 and board_id=$2 and column_id=$3
      ), status)
    end,
    status_color=case
      when $5 then '#ffd400'
      else coalesce((
        select item_color
        from kanban_columns
        where company_id=$1 and board_id=$2 and column_id=$3
      ), status_color)
    end
where company_id=$1 and node_id=$4`,
		card.CompanyID, card.BoardID, card.ColumnID, card.NodeID, card.IsIssue,
	)
	return err
}

func assignNodeToLogicGateResponsibleSQL(ctx context.Context, tx *sql.Tx, companyID, logicGateID, nodeID string) error {
	var changedCount int
	err := tx.QueryRowContext(ctx, `
with responsible as (
  select user_id
  from logic_gate_raci_assignments
  where company_id=$1
    and logic_gate_id=$2::uuid
    and role=$4
  order by created_timestamp asc, user_id asc
  limit 1
),
updated_node as (
  update nodes
  set assignee_user_id = responsible.user_id
  from responsible
  where nodes.company_id=$1
    and nodes.node_id=$3
    and nodes.assignee_user_id is distinct from responsible.user_id
  returning 1
)
select count(*) from updated_node`,
		companyID, logicGateID, nodeID, domain.LogicGateRaciRoleResponsible,
	).Scan(&changedCount)
	if isPostgresUndefinedTable(err, "logic_gate_raci_assignments") {
		return nil
	}
	if err != nil {
		return err
	}
	if changedCount == 0 {
		return nil
	}
	return recomputeNodeAssigneeEffectiveAccessTx(ctx, tx, companyID, nodeID)
}

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
	ctx := context.Background()
	var hasAssignment bool
	if err := r.db.QueryRowContext(ctx, `
select exists(
  select 1
  from node_logic_gate_assignments
  where company_id=$1
    and compatibility_board_id=$2
    and column_id=$3
)`, companyID, boardID, columnID).Scan(&hasAssignment); err != nil {
		return err
	}
	if hasAssignment {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(ctx, `
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

func (r *PostgresRepo) GetKanbanCard(companyID, boardID, cardID string) (domain.KanbanCard, error) {
	companyID = strings.TrimSpace(companyID)
	boardID = strings.TrimSpace(boardID)
	cardID = strings.TrimSpace(cardID)
	if companyID == "" || boardID == "" || cardID == "" {
		return domain.KanbanCard{}, ErrInvalid
	}
	ctx := context.Background()
	item, err := scanKanbanCard(r.db.QueryRowContext(ctx, `
select `+kanbanCardSelectColumns+`
from kanban_cards
where company_id=$1 and board_id=$2 and card_id=$3`, companyID, boardID, cardID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.KanbanCard{}, ErrNotFound
	}
	if err != nil {
		return domain.KanbanCard{}, err
	}
	return item, nil
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

	var boardLogicGateID sql.NullString
	if err := tx.QueryRowContext(ctx, `
select logic_gate_id::text
from kanban_boards
where company_id=$1 and board_id=$2`,
		input.CompanyID, input.BoardID).Scan(&boardLogicGateID); err != nil {
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
	if boardLogicGateID.Valid {
		if _, err := tx.ExecContext(ctx, `
delete from kanban_cards
where company_id=$1
  and node_id=$2
  and board_id<>$3
  and logic_gate_id is not null`,
			input.CompanyID, input.NodeID, input.BoardID); err != nil {
			return domain.KanbanCard{}, err
		}
	}

	issueValue := false
	if input.IsIssueSet {
		issueValue = input.IsIssue
	}
	var item domain.KanbanCard
	item, err = scanKanbanCard(tx.QueryRowContext(ctx, `
update kanban_cards
set column_id=$4,
    logic_gate_id=$5::uuid,
    node_title=$6,
    description_snapshot=case when $7 <> '' then $7 else description_snapshot end,
    position=$8,
    is_issue=case when $9 then $10 else is_issue end,
    updated_timestamp=now()
where company_id=$1 and board_id=$2 and node_id=$3
returning `+kanbanCardSelectColumns,
		input.CompanyID, input.BoardID, input.NodeID, input.ColumnID, boardLogicGateID, nodeTitle, descriptionSnapshot, input.Position, input.IsIssueSet, issueValue,
	))
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return domain.KanbanCard{}, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		cardID := strings.TrimSpace(input.CardID)
		if cardID == "" {
			cardID = newUUIDv7String()
		}
		item, err = scanKanbanCard(tx.QueryRowContext(ctx, `
insert into kanban_cards (
  company_id, board_id, card_id, column_id, node_id, logic_gate_id, node_title,
  description_snapshot, is_issue, position, created_timestamp, updated_timestamp
) values ($1,$2,$3,$4,$5,$6::uuid,$7,$8,$9,$10,now(),now())
returning `+kanbanCardSelectColumns,
			input.CompanyID, input.BoardID, cardID, input.ColumnID,
			input.NodeID, boardLogicGateID, nodeTitle, descriptionSnapshot, issueValue, input.Position,
		))
		if err != nil {
			return domain.KanbanCard{}, err
		}
	}
	if item.LogicGateID != nil {
		if _, err := syncNodeLogicGateAssignmentFromCardSQL(ctx, tx, item); err != nil {
			return domain.KanbanCard{}, err
		}
	}
	if err := syncNodeStatusFromKanbanCardSQL(ctx, tx, item); err != nil {
		return domain.KanbanCard{}, err
	}
	if item.LogicGateID != nil {
		if err := assignNodeToLogicGateResponsibleSQL(ctx, tx, item.CompanyID, *item.LogicGateID, item.NodeID); err != nil {
			return domain.KanbanCard{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return domain.KanbanCard{}, err
	}
	return item, nil
}

func (r *PostgresRepo) AssignNodeToLogicGateStatus(input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	defer tx.Rollback()

	boardID := LogicGateKanbanBoardID(input.LogicGateID)
	rows, err := tx.QueryContext(ctx, `
select kc.company_id, kc.board_id, kc.column_id, kc.title, kc.position, kc.width_px, kc.height_px, kc.item_color, kc.created_timestamp, kc.updated_timestamp
from kanban_boards kb
join kanban_columns kc on kc.company_id=kb.company_id and kc.board_id=kb.board_id
where kb.company_id=$1
  and kb.board_id=$2
  and kb.logic_gate_id::text=$3
order by kc.position asc, kc.created_timestamp asc, kc.column_id asc`, input.CompanyID, boardID, input.LogicGateID)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	columns := make([]domain.KanbanColumn, 0)
	for rows.Next() {
		column, err := scanKanbanColumn(rows)
		if err != nil {
			rows.Close()
			return LogicGateNodeAssignmentResult{}, err
		}
		columns = append(columns, column)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return LogicGateNodeAssignmentResult{}, err
	}
	if err := rows.Close(); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	column, err := resolveLogicGateAssignmentColumn(columns, input.ColumnID, input.Status)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	var canonicalNodeTitle string
	var previousAssignee sql.NullString
	var createdNode domain.Node
	if err := tx.QueryRowContext(ctx, `
select title, assignee_user_id::text
from nodes
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID).Scan(&canonicalNodeTitle, &previousAssignee); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			if input.CreateNodeTitle == "" {
				return LogicGateNodeAssignmentResult{}, ErrNotFound
			}
			createdNode, err = r.createNodeWithAssigneeIDTx(ctx, tx, input.CompanyID, input.NodeID, input.CreateNodeTitle, input.ActorUserID)
			if err != nil {
				return LogicGateNodeAssignmentResult{}, err
			}
			canonicalNodeTitle = createdNode.Title
			if createdNode.AssigneeUserID != nil {
				previousAssignee = sql.NullString{String: *createdNode.AssigneeUserID, Valid: true}
			}
		} else {
			return LogicGateNodeAssignmentResult{}, err
		}
	}
	previousAssignment, previousAssignmentErr := nodeLogicGateAssignmentByNodeSQL(ctx, tx, input.CompanyID, input.NodeID, "")
	hadPreviousAssignment := previousAssignmentErr == nil
	if previousAssignmentErr != nil && !errors.Is(previousAssignmentErr, ErrNotFound) {
		return LogicGateNodeAssignmentResult{}, previousAssignmentErr
	}

	position := input.Position
	if position <= 0 {
		if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from node_logic_gate_assignments
where company_id=$1 and compatibility_board_id=$2 and column_id=$3`, input.CompanyID, boardID, column.ColumnID).Scan(&position); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	}

	nodeTitle := strings.TrimSpace(canonicalNodeTitle)
	if nodeTitle == "" {
		nodeTitle = normalizeKanbanBoardTitle(input.NodeID, input.NodeTitle)
	}
	descriptionSnapshot := strings.TrimSpace(input.DescriptionSnapshot)
	cardID := ""
	var existingTargetIssue sql.NullBool
	if err := tx.QueryRowContext(ctx, `
select card_id::text, is_issue
from kanban_cards
where company_id=$1 and board_id=$2 and node_id=$3`, input.CompanyID, boardID, input.NodeID).Scan(&cardID, &existingTargetIssue); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return LogicGateNodeAssignmentResult{}, err
		}
	}
	if cardID == "" {
		cardID = newUUIDv7String()
	}

	issueValue := false
	if input.IsIssueSet {
		issueValue = input.IsIssue
	} else if existingTargetIssue.Valid {
		issueValue = existingTargetIssue.Bool
	}
	assignment, err := upsertNodeLogicGateAssignmentSQL(ctx, tx, nodeLogicGateAssignmentSQLInput{
		CompanyID:            input.CompanyID,
		NodeID:               input.NodeID,
		LogicGateID:          input.LogicGateID,
		StatusKey:            logicGateAssignmentStatusKey(column.Title),
		ColumnID:             column.ColumnID,
		IsIssue:              issueValue,
		Position:             position,
		CompatibilityBoardID: boardID,
		CompatibilityCardID:  cardID,
	})
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from kanban_cards
where company_id=$1
  and node_id=$2
  and board_id<>$3
  and logic_gate_id is not null`, input.CompanyID, input.NodeID, boardID); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	var card domain.KanbanCard
	card, err = scanKanbanCard(tx.QueryRowContext(ctx, `
update kanban_cards
set column_id=$4,
    logic_gate_id=$5::uuid,
    node_title=$6,
    description_snapshot=case when $7 <> '' then $7 else description_snapshot end,
    position=$8,
    is_issue=case when $9 then $10 else is_issue end,
    updated_timestamp=now()
where company_id=$1 and board_id=$2 and node_id=$3
returning `+kanbanCardSelectColumns,
		input.CompanyID, boardID, input.NodeID, column.ColumnID, input.LogicGateID, nodeTitle, descriptionSnapshot, position, input.IsIssueSet, issueValue,
	))
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return LogicGateNodeAssignmentResult{}, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		card, err = scanKanbanCard(tx.QueryRowContext(ctx, `
insert into kanban_cards (
  company_id, board_id, card_id, column_id, node_id, logic_gate_id, node_title,
  description_snapshot, is_issue, position, created_timestamp, updated_timestamp
) values ($1,$2,$3,$4,$5,$6::uuid,$7,$8,$9,$10,now(),now())
returning `+kanbanCardSelectColumns,
			input.CompanyID, boardID, cardID, column.ColumnID,
			input.NodeID, input.LogicGateID, nodeTitle, descriptionSnapshot, issueValue, position,
		))
		if err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	}
	if err := syncNodeStatusFromKanbanCardSQL(ctx, tx, card); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if err := assignNodeToLogicGateResponsibleSQL(ctx, tx, input.CompanyID, input.LogicGateID, input.NodeID); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	var currentAssignee sql.NullString
	if err := tx.QueryRowContext(ctx, `
select assignee_user_id::text
from nodes
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID).Scan(&currentAssignee); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if previousAssignee.String != currentAssignee.String || previousAssignee.Valid != currentAssignee.Valid {
		if err := recomputeNodeAssigneeEffectiveAccessTx(ctx, tx, input.CompanyID, input.NodeID); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	}
	if !hadPreviousAssignment || previousAssignment.LogicGateID != input.LogicGateID {
		if err := recomputeLogicGateAssignedNodeVisibilityTx(ctx, tx, input.CompanyID, []string{input.LogicGateID}, []string{input.NodeID}); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	}
	if input.PrioritySet {
		var priority any
		if input.Priority != nil {
			priority = *input.Priority
		}
		if _, err := tx.ExecContext(ctx, `
update nodes
set priority=$3::smallint
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID, priority); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	}

	status := column.Title
	statusColor := column.ItemColor
	if card.IsIssue {
		status = "Issue"
		statusColor = "#ffd400"
	}
	node, err := scanNode(tx.QueryRowContext(ctx, `
select
  n.company_id,
  n.node_id,
  n.title,
  nullif($3, '') as status,
  nullif($4, '') as status_color,
  n.due_date::text,
  n.priority,
  n.assignee_user_id::text,
  nullif(assignee.display_name, '') as assignee_name,
  nullif(assignee.email, '') as assignee_email,
  n.created_timestamp,
  coalesce(node_logic_gates.logic_gate_ids_json, '[]') as logic_gate_ids_json
from nodes n
left join company_memberships assignee_membership
  on assignee_membership.company_id = n.company_id
 and assignee_membership.user_id = n.assignee_user_id
left join users assignee
  on assignee.user_id = assignee_membership.user_id
left join lateral (
  select coalesce(jsonb_agg(gate.logic_gate_id order by gate.logic_gate_id), '[]'::jsonb)::text as logic_gate_ids_json
  from (
    select distinct assignment.logic_gate_id::text as logic_gate_id
    from node_logic_gate_assignments assignment
    where assignment.company_id = n.company_id
      and assignment.node_id = n.node_id
  ) gate
) node_logic_gates on true
where n.company_id=$1 and n.node_id=$2`, input.CompanyID, input.NodeID, status, statusColor))
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result := LogicGateNodeAssignmentResult{Card: card, Node: node, Assignment: assignment}
	meta := workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)
	eventInputs := logicGateAssignmentSavedWorkspaceEventInputs(result, meta)
	if createdNode.CompanyID != "" {
		eventInputs = append([]DomainEventInput{nodeCreatedWorkspaceEventInputWithMetadata(createdNode, meta)}, eventInputs...)
	}
	events, err := r.appendDomainEventsTx(ctx, tx, eventInputs)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	if err := tx.Commit(); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) MoveLogicGateNodeAssignment(input LogicGateNodeAssignmentMoveInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentMoveInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	defer tx.Rollback()

	assignment, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, input.CompanyID, input.NodeID, input.LogicGateID)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	card, err := nodeLogicGateAssignmentCardSQL(ctx, tx, assignment)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	var previousAssignee sql.NullString
	if input.AssigneePolicySet {
		if err := tx.QueryRowContext(ctx, `
select assignee_user_id::text
from nodes
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID).Scan(&previousAssignee); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	}

	columnID := card.ColumnID
	if input.ColumnID != "" || input.Status != "" {
		rows, err := tx.QueryContext(ctx, `
select company_id, board_id, column_id, title, position, width_px, height_px, item_color, created_timestamp, updated_timestamp
from kanban_columns
where company_id=$1 and board_id=$2
order by position asc, created_timestamp asc, column_id asc`, input.CompanyID, card.BoardID)
		if err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
		columns := make([]domain.KanbanColumn, 0)
		for rows.Next() {
			column, err := scanKanbanColumn(rows)
			if err != nil {
				rows.Close()
				return LogicGateNodeAssignmentResult{}, err
			}
			columns = append(columns, column)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return LogicGateNodeAssignmentResult{}, err
		}
		if err := rows.Close(); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
		column, err := resolveLogicGateAssignmentColumn(columns, input.ColumnID, input.Status)
		if err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
		columnID = column.ColumnID
	}

	position := card.Position
	if input.Position > 0 {
		position = input.Position
	} else if columnID != card.ColumnID {
		if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from node_logic_gate_assignments
where company_id=$1 and compatibility_board_id=$2 and column_id=$3`, input.CompanyID, card.BoardID, columnID).Scan(&position); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	}

	var columnTitle string
	if err := tx.QueryRowContext(ctx, `
select title
from kanban_columns
where company_id=$1 and board_id=$2 and column_id=$3`, input.CompanyID, card.BoardID, columnID).Scan(&columnTitle); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	assignment, err = upsertNodeLogicGateAssignmentSQL(ctx, tx, nodeLogicGateAssignmentSQLInput{
		AssignmentID:         assignment.AssignmentID,
		CompanyID:            input.CompanyID,
		NodeID:               input.NodeID,
		LogicGateID:          assignment.LogicGateID,
		StatusKey:            logicGateAssignmentStatusKey(columnTitle),
		ColumnID:             columnID,
		IsIssue:              assignment.IsIssue,
		Position:             position,
		CompatibilityBoardID: assignment.CompatibilityBoardID,
		CompatibilityCardID:  assignment.CompatibilityCardID,
	})
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	card, err = scanKanbanCard(tx.QueryRowContext(ctx, `
update kanban_cards
set column_id=$4,
    node_title=coalesce((select title from nodes where company_id=$1 and node_id=kanban_cards.node_id), node_title),
    position=$5,
    updated_timestamp=now()
where company_id=$1 and board_id=$2 and card_id=$3
returning `+kanbanCardSelectColumns,
		input.CompanyID, card.BoardID, card.CardID, columnID, position,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if err := syncNodeStatusFromKanbanCardSQL(ctx, tx, card); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if input.AssigneePolicySet {
		if err := assignNodeToLogicGateResponsibleSQL(ctx, tx, input.CompanyID, input.LogicGateID, input.NodeID); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
		var currentAssignee sql.NullString
		if err := tx.QueryRowContext(ctx, `
select assignee_user_id::text
from nodes
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID).Scan(&currentAssignee); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
		if previousAssignee.String != currentAssignee.String || previousAssignee.Valid != currentAssignee.Valid {
			if err := recomputeNodeAssigneeEffectiveAccessTx(ctx, tx, input.CompanyID, input.NodeID); err != nil {
				return LogicGateNodeAssignmentResult{}, err
			}
		}
	}
	if input.PrioritySet {
		var priority any
		if input.Priority != nil {
			priority = *input.Priority
		}
		if _, err := tx.ExecContext(ctx, `
update nodes
set priority=$3::smallint
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID, priority); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	}

	node, err := scanNode(tx.QueryRowContext(ctx, `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1 and n.node_id=$2`, input.CompanyID, input.NodeID))
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result := LogicGateNodeAssignmentResult{Card: card, Node: node, Assignment: assignment}
	events, err := r.appendDomainEventsTx(ctx, tx, logicGateAssignmentMovedWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	if err := tx.Commit(); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) RemoveLogicGateNodeAssignment(input LogicGateNodeAssignmentRemoveInput) (LogicGateNodeAssignmentRemoveResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentRemoveInput(input)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	defer tx.Rollback()

	assignment, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, input.CompanyID, input.NodeID, input.LogicGateID)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	card, err := nodeLogicGateAssignmentCardSQL(ctx, tx, assignment)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from node_logic_gate_assignments
where company_id=$1 and node_id=$2 and assignment_id=$3`, assignment.CompanyID, assignment.NodeID, assignment.AssignmentID); err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	deleted, err := tx.ExecContext(ctx, `
delete from kanban_cards
where company_id=$1 and board_id=$2 and card_id=$3`, input.CompanyID, card.BoardID, card.CardID)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	affected, err := deleted.RowsAffected()
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	if affected == 0 {
		return LogicGateNodeAssignmentRemoveResult{}, ErrNotFound
	}

	remainingAssignment, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, input.CompanyID, input.NodeID, "")
	if err == nil {
		remaining, err := nodeLogicGateAssignmentCardSQL(ctx, tx, remainingAssignment)
		if err != nil {
			return LogicGateNodeAssignmentRemoveResult{}, err
		}
		if err := syncNodeStatusFromKanbanCardSQL(ctx, tx, remaining); err != nil {
			return LogicGateNodeAssignmentRemoveResult{}, err
		}
	} else if errors.Is(err, ErrNotFound) {
		var fallbackStatus any
		var fallbackStatusColor any
		if input.FallbackStatus != nil {
			fallbackStatus = *input.FallbackStatus
		}
		if input.FallbackStatusColor != nil {
			fallbackStatusColor = *input.FallbackStatusColor
		}
		if _, err := tx.ExecContext(ctx, `
update nodes
set status=$3::text,
    status_color=$4::text
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID, fallbackStatus, fallbackStatusColor); err != nil {
			return LogicGateNodeAssignmentRemoveResult{}, err
		}
	} else if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	if err := recomputeLogicGateAssignedNodeVisibilityTx(ctx, tx, input.CompanyID, []string{input.LogicGateID}, []string{input.NodeID}); err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}

	node, err := scanNode(tx.QueryRowContext(ctx, `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1 and n.node_id=$2`, input.CompanyID, input.NodeID))
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	result := LogicGateNodeAssignmentRemoveResult{Card: card, Node: node, Assignment: assignment}
	events, err := r.appendDomainEventsTx(ctx, tx, logicGateAssignmentRemovedWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	result.Events = events
	if err := tx.Commit(); err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) SetLogicGateNodeAssignmentIssue(input LogicGateNodeAssignmentIssueInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentIssueInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	defer tx.Rollback()

	assignment, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, input.CompanyID, input.NodeID, input.LogicGateID)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	current, err := nodeLogicGateAssignmentCardSQL(ctx, tx, assignment)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	assignment, err = upsertNodeLogicGateAssignmentSQL(ctx, tx, nodeLogicGateAssignmentSQLInput{
		AssignmentID:         assignment.AssignmentID,
		CompanyID:            input.CompanyID,
		NodeID:               input.NodeID,
		LogicGateID:          assignment.LogicGateID,
		StatusKey:            assignment.StatusKey,
		ColumnID:             assignment.ColumnID,
		IsIssue:              input.IsIssue,
		Position:             assignment.Position,
		CompatibilityBoardID: assignment.CompatibilityBoardID,
		CompatibilityCardID:  assignment.CompatibilityCardID,
	})
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	card, err := scanKanbanCard(tx.QueryRowContext(ctx, `
update kanban_cards
set is_issue=$4,
    updated_timestamp=now()
where company_id=$1 and board_id=$2 and card_id=$3
returning `+kanbanCardSelectColumns,
		input.CompanyID, current.BoardID, current.CardID, input.IsIssue,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if err := syncNodeStatusFromKanbanCardSQL(ctx, tx, card); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	node, err := scanNode(tx.QueryRowContext(ctx, `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1 and n.node_id=$2`, input.CompanyID, input.NodeID))
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result := LogicGateNodeAssignmentResult{Card: card, Node: node, Assignment: assignment}
	events, err := r.appendDomainEventsTx(ctx, tx, logicGateAssignmentIssueWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	if err := tx.Commit(); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	return result, nil
}
func (r *PostgresRepo) MoveKanbanCard(input KanbanCardMoveInput) (domain.KanbanCard, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.KanbanCard{}, err
	}
	defer tx.Rollback()

	if input.ColumnID != "" {
		var columnExists bool
		if err := tx.QueryRowContext(ctx, `
select exists(select 1 from kanban_columns where company_id=$1 and board_id=$2 and column_id=$3)`,
			input.CompanyID, input.BoardID, input.ColumnID).Scan(&columnExists); err != nil {
			return domain.KanbanCard{}, err
		}
		if !columnExists {
			return domain.KanbanCard{}, ErrNotFound
		}
	}
	if input.ColumnID != "" && input.Position <= 0 {
		if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from kanban_cards
where company_id=$1 and board_id=$2 and column_id=$3`, input.CompanyID, input.BoardID, input.ColumnID).Scan(&input.Position); err != nil {
			return domain.KanbanCard{}, err
		}
	}

	issueValue := false
	if input.IsIssue != nil {
		issueValue = *input.IsIssue
	}
	item, err := scanKanbanCard(tx.QueryRowContext(ctx, `
update kanban_cards
set column_id=coalesce(nullif($4, '')::uuid, column_id),
    node_title=coalesce((select title from nodes where company_id=$1 and node_id=kanban_cards.node_id), node_title),
    position=case when $5 > 0 then $5 else position end,
    is_issue=case when $6 then $7 else is_issue end,
    updated_timestamp=now()
where company_id=$1 and board_id=$2 and card_id=$3
returning `+kanbanCardSelectColumns,
		input.CompanyID, input.BoardID, input.CardID, input.ColumnID, input.Position, input.IsIssue != nil, issueValue,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.KanbanCard{}, ErrNotFound
	}
	if err != nil {
		return domain.KanbanCard{}, err
	}
	if item.LogicGateID != nil {
		if _, err := syncNodeLogicGateAssignmentFromCardSQL(ctx, tx, item); err != nil {
			return domain.KanbanCard{}, err
		}
	}
	if err := syncNodeStatusFromKanbanCardSQL(ctx, tx, item); err != nil {
		return domain.KanbanCard{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.KanbanCard{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteKanbanCard(companyID, boardID, cardID string) error {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	card, err := scanKanbanCard(tx.QueryRowContext(ctx, `
select `+kanbanCardSelectColumns+`
from kanban_cards
where company_id=$1 and board_id=$2 and card_id=$3`, companyID, boardID, cardID))
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := deleteNodeLogicGateAssignmentForCardSQL(ctx, tx, card); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
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
	if card.LogicGateID != nil {
		if _, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, companyID, card.NodeID, ""); errors.Is(err, ErrNotFound) {
			if _, err := tx.ExecContext(ctx, `
update nodes
set status=null,
    status_color=null
where company_id=$1 and node_id=$2`, companyID, card.NodeID); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func kanbanDerivedNodeTx(ctx context.Context, tx *sql.Tx, card domain.KanbanCard) (*domain.Node, error) {
	if card.LogicGateID == nil {
		return nil, nil
	}
	node, err := scanNode(tx.QueryRowContext(ctx, `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1 and n.node_id=$2`, card.CompanyID, card.NodeID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &node, nil
}

func (r *PostgresRepo) appendKanbanCardWorkspaceEventsTx(ctx context.Context, tx *sql.Tx, eventType string, card domain.KanbanCard, includeCard bool) (*domain.Node, []domain.DomainEvent, error) {
	derivedNode, err := kanbanDerivedNodeTx(ctx, tx, card)
	if err != nil {
		return nil, nil, err
	}
	events, err := r.appendDomainEventsTx(ctx, tx, kanbanCardMutationWorkspaceEventInputs(eventType, card, derivedNode, includeCard))
	if err != nil {
		return nil, nil, err
	}
	return derivedNode, events, nil
}

func (r *PostgresRepo) CreateKanbanBoardWithWorkspaceEvent(companyID, boardID, title string, position int) (KanbanBoardWorkspaceEventResult, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return KanbanBoardWorkspaceEventResult{}, err
	}
	defer tx.Rollback()

	if boardID == "" {
		boardID = newUUIDv7String()
	}
	positionWasProvided := position > 0
	if position <= 0 {
		if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from kanban_boards
where company_id=$1`, companyID).Scan(&position); err != nil {
			return KanbanBoardWorkspaceEventResult{}, err
		}
	}
	item, err := scanKanbanBoard(tx.QueryRowContext(ctx, `
insert into kanban_boards (company_id, board_id, title, position, created_timestamp, updated_timestamp)
values ($1, $2, $3, $4, now(), now())
on conflict (company_id, board_id)
do update set
  title=case
    when kanban_boards.logic_gate_id is not null then coalesce((
      select header from logic_gates
      where company_id=kanban_boards.company_id and logic_gate_id=kanban_boards.logic_gate_id
    ), kanban_boards.title)
    else excluded.title
  end,
  position=case when $5 then excluded.position else kanban_boards.position end,
  updated_timestamp=now()
returning company_id, board_id, logic_gate_id::text, title, position, created_timestamp, updated_timestamp`,
		companyID, boardID, normalizeKanbanBoardTitle(boardID, title), position, positionWasProvided,
	))
	if err != nil {
		return KanbanBoardWorkspaceEventResult{}, err
	}
	event, err := r.appendDomainEventTx(ctx, tx, kanbanBoardSavedWorkspaceEventInput(item))
	if err != nil {
		return KanbanBoardWorkspaceEventResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return KanbanBoardWorkspaceEventResult{}, err
	}
	return KanbanBoardWorkspaceEventResult{Board: item, Events: []domain.DomainEvent{event}}, nil
}

func (r *PostgresRepo) UpdateKanbanBoardWithWorkspaceEvent(companyID, boardID, title string, position int) (KanbanBoardWorkspaceEventResult, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return KanbanBoardWorkspaceEventResult{}, err
	}
	defer tx.Rollback()

	item, err := scanKanbanBoard(tx.QueryRowContext(ctx, `
update kanban_boards
set title=case
      when logic_gate_id is not null then coalesce((
        select header from logic_gates
        where company_id=kanban_boards.company_id and logic_gate_id=kanban_boards.logic_gate_id
      ), title)
      else coalesce(nullif($3, ''), title)
    end,
    position=case when $4 > 0 then $4 else position end,
    updated_timestamp=now()
where company_id=$1 and board_id=$2
returning company_id, board_id, logic_gate_id::text, title, position, created_timestamp, updated_timestamp`,
		companyID, boardID, strings.TrimSpace(title), position,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return KanbanBoardWorkspaceEventResult{}, ErrNotFound
	}
	if err != nil {
		return KanbanBoardWorkspaceEventResult{}, err
	}
	event, err := r.appendDomainEventTx(ctx, tx, kanbanBoardUpdatedWorkspaceEventInput(item))
	if err != nil {
		return KanbanBoardWorkspaceEventResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return KanbanBoardWorkspaceEventResult{}, err
	}
	return KanbanBoardWorkspaceEventResult{Board: item, Events: []domain.DomainEvent{event}}, nil
}

func (r *PostgresRepo) DeleteKanbanBoardWithWorkspaceEvent(companyID, boardID string) (KanbanWorkspaceEventResult, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	defer tx.Rollback()

	var attachedLogicGateID sql.NullString
	if err := tx.QueryRowContext(ctx, `
select logic_gate_id::text
from kanban_boards
where company_id=$1 and board_id=$2`, companyID, boardID).Scan(&attachedLogicGateID); errors.Is(err, sql.ErrNoRows) {
		return KanbanWorkspaceEventResult{}, ErrNotFound
	} else if err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	if attachedLogicGateID.Valid {
		return KanbanWorkspaceEventResult{}, ErrInvalid
	}

	if _, err := tx.ExecContext(ctx, `
delete from company_explorer_folder_items
where company_id=$1 and item_type='kanban' and item_id=$2`, companyID, boardID); err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from kanban_cards
where company_id=$1 and board_id=$2`, companyID, boardID); err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from kanban_columns
where company_id=$1 and board_id=$2`, companyID, boardID); err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	deleted, err := tx.ExecContext(ctx, `
delete from kanban_boards
where company_id=$1 and board_id=$2`, companyID, boardID)
	if err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	affected, err := deleted.RowsAffected()
	if err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	if affected == 0 {
		return KanbanWorkspaceEventResult{}, ErrNotFound
	}
	event, err := r.appendDomainEventTx(ctx, tx, kanbanBoardDeletedWorkspaceEventInput(companyID, boardID))
	if err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	return KanbanWorkspaceEventResult{Events: []domain.DomainEvent{event}}, nil
}

func (r *PostgresRepo) CreateKanbanColumnWithWorkspaceEvent(companyID, boardID, title string, position int, widthPx int, heightPx int, itemColor string) (KanbanColumnWorkspaceEventResult, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return KanbanColumnWorkspaceEventResult{}, err
	}
	defer tx.Rollback()

	if err := ensureKanbanBoardSQL(ctx, tx, companyID, boardID, boardID); err != nil {
		return KanbanColumnWorkspaceEventResult{}, err
	}
	if position <= 0 {
		if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from kanban_columns
where company_id=$1 and board_id=$2`, companyID, boardID).Scan(&position); err != nil {
			return KanbanColumnWorkspaceEventResult{}, err
		}
	}
	widthPx = normalizeKanbanColumnWidth(widthPx)
	heightPx = normalizeKanbanColumnHeight(heightPx)
	itemColor = normalizeKanbanColumnItemColor(itemColor)
	item, err := scanKanbanColumn(tx.QueryRowContext(ctx, `
insert into kanban_columns (company_id, board_id, column_id, title, position, width_px, height_px, item_color, created_timestamp, updated_timestamp)
values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
returning company_id, board_id, column_id, title, position, width_px, height_px, item_color, created_timestamp, updated_timestamp`,
		companyID, boardID, newUUIDv7String(), title, position, widthPx, heightPx, itemColor,
	))
	if err != nil {
		return KanbanColumnWorkspaceEventResult{}, err
	}
	event, err := r.appendDomainEventTx(ctx, tx, kanbanColumnCreatedWorkspaceEventInput(item))
	if err != nil {
		return KanbanColumnWorkspaceEventResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return KanbanColumnWorkspaceEventResult{}, err
	}
	return KanbanColumnWorkspaceEventResult{Column: item, Events: []domain.DomainEvent{event}}, nil
}

func (r *PostgresRepo) UpdateKanbanColumnWithWorkspaceEvent(companyID, boardID, columnID, title string, position int, widthPx int, heightPx int, itemColor string) (KanbanColumnWorkspaceEventResult, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return KanbanColumnWorkspaceEventResult{}, err
	}
	defer tx.Rollback()

	if widthPx > 0 {
		widthPx = normalizeKanbanColumnWidth(widthPx)
	}
	if heightPx > 0 {
		heightPx = normalizeKanbanColumnHeight(heightPx)
	}
	if strings.TrimSpace(itemColor) != "" {
		itemColor = normalizeKanbanColumnItemColor(itemColor)
	}
	item, err := scanKanbanColumn(tx.QueryRowContext(ctx, `
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
		return KanbanColumnWorkspaceEventResult{}, ErrNotFound
	}
	if err != nil {
		return KanbanColumnWorkspaceEventResult{}, err
	}
	event, err := r.appendDomainEventTx(ctx, tx, kanbanColumnUpdatedWorkspaceEventInput(item))
	if err != nil {
		return KanbanColumnWorkspaceEventResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return KanbanColumnWorkspaceEventResult{}, err
	}
	return KanbanColumnWorkspaceEventResult{Column: item, Events: []domain.DomainEvent{event}}, nil
}

func (r *PostgresRepo) DeleteKanbanColumnWithWorkspaceEvent(companyID, boardID, columnID string) (KanbanWorkspaceEventResult, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	defer tx.Rollback()

	var hasAssignment bool
	if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from node_logic_gate_assignments
  where company_id=$1
    and compatibility_board_id=$2
    and column_id=$3
)`, companyID, boardID, columnID).Scan(&hasAssignment); err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	if hasAssignment {
		return KanbanWorkspaceEventResult{}, ErrInvalid
	}
	result, err := tx.ExecContext(ctx, `
delete from kanban_columns
where company_id=$1 and board_id=$2 and column_id=$3`,
		companyID, boardID, columnID,
	)
	if err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	if affected == 0 {
		return KanbanWorkspaceEventResult{}, ErrNotFound
	}
	event, err := r.appendDomainEventTx(ctx, tx, kanbanColumnDeletedWorkspaceEventInput(companyID, boardID, columnID))
	if err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return KanbanWorkspaceEventResult{}, err
	}
	return KanbanWorkspaceEventResult{Events: []domain.DomainEvent{event}}, nil
}

func (r *PostgresRepo) UpsertKanbanCardWithWorkspaceEvent(input KanbanCardMutationInput) (KanbanCardWorkspaceEventResult, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	defer tx.Rollback()
	if err := ensureKanbanBoardSQL(ctx, tx, input.CompanyID, input.BoardID, input.BoardID); err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}

	var boardLogicGateID sql.NullString
	if err := tx.QueryRowContext(ctx, `
select logic_gate_id::text
from kanban_boards
where company_id=$1 and board_id=$2`,
		input.CompanyID, input.BoardID).Scan(&boardLogicGateID); err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}

	var columnExists bool
	if err := tx.QueryRowContext(ctx, `
select exists(select 1 from kanban_columns where company_id=$1 and board_id=$2 and column_id=$3)`,
		input.CompanyID, input.BoardID, input.ColumnID).Scan(&columnExists); err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	if !columnExists {
		return KanbanCardWorkspaceEventResult{}, ErrNotFound
	}

	var canonicalNodeTitle string
	if err := tx.QueryRowContext(ctx, `
select title
from nodes
where company_id=$1 and node_id=$2`,
		input.CompanyID, input.NodeID).Scan(&canonicalNodeTitle); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return KanbanCardWorkspaceEventResult{}, ErrNotFound
		}
		return KanbanCardWorkspaceEventResult{}, err
	}

	if input.Position <= 0 {
		if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from kanban_cards
where company_id=$1 and board_id=$2 and column_id=$3`, input.CompanyID, input.BoardID, input.ColumnID).Scan(&input.Position); err != nil {
			return KanbanCardWorkspaceEventResult{}, err
		}
	}

	nodeTitle := strings.TrimSpace(canonicalNodeTitle)
	if nodeTitle == "" {
		nodeTitle = normalizeKanbanBoardTitle(input.NodeID, input.NodeTitle)
	}
	descriptionSnapshot := strings.TrimSpace(input.DescriptionSnapshot)
	if boardLogicGateID.Valid {
		if _, err := tx.ExecContext(ctx, `
delete from kanban_cards
where company_id=$1
  and node_id=$2
  and board_id<>$3
  and logic_gate_id is not null`,
			input.CompanyID, input.NodeID, input.BoardID); err != nil {
			return KanbanCardWorkspaceEventResult{}, err
		}
	}

	issueValue := false
	if input.IsIssueSet {
		issueValue = input.IsIssue
	}
	var item domain.KanbanCard
	item, err = scanKanbanCard(tx.QueryRowContext(ctx, `
update kanban_cards
set column_id=$4,
    logic_gate_id=$5::uuid,
    node_title=$6,
    description_snapshot=case when $7 <> '' then $7 else description_snapshot end,
    position=$8,
    is_issue=case when $9 then $10 else is_issue end,
    updated_timestamp=now()
where company_id=$1 and board_id=$2 and node_id=$3
returning `+kanbanCardSelectColumns,
		input.CompanyID, input.BoardID, input.NodeID, input.ColumnID, boardLogicGateID, nodeTitle, descriptionSnapshot, input.Position, input.IsIssueSet, issueValue,
	))
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return KanbanCardWorkspaceEventResult{}, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		cardID := strings.TrimSpace(input.CardID)
		if cardID == "" {
			cardID = newUUIDv7String()
		}
		item, err = scanKanbanCard(tx.QueryRowContext(ctx, `
insert into kanban_cards (
  company_id, board_id, card_id, column_id, node_id, logic_gate_id, node_title,
  description_snapshot, is_issue, position, created_timestamp, updated_timestamp
) values ($1,$2,$3,$4,$5,$6::uuid,$7,$8,$9,$10,now(),now())
returning `+kanbanCardSelectColumns,
			input.CompanyID, input.BoardID, cardID, input.ColumnID,
			input.NodeID, boardLogicGateID, nodeTitle, descriptionSnapshot, issueValue, input.Position,
		))
		if err != nil {
			return KanbanCardWorkspaceEventResult{}, err
		}
	}
	if item.LogicGateID != nil {
		if _, err := syncNodeLogicGateAssignmentFromCardSQL(ctx, tx, item); err != nil {
			return KanbanCardWorkspaceEventResult{}, err
		}
	}
	if err := syncNodeStatusFromKanbanCardSQL(ctx, tx, item); err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	if item.LogicGateID != nil {
		if err := assignNodeToLogicGateResponsibleSQL(ctx, tx, item.CompanyID, *item.LogicGateID, item.NodeID); err != nil {
			return KanbanCardWorkspaceEventResult{}, err
		}
	}
	derivedNode, events, err := r.appendKanbanCardWorkspaceEventsTx(ctx, tx, "kanban_card_upserted", item, true)
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	return KanbanCardWorkspaceEventResult{Card: item, DerivedNode: derivedNode, Events: events}, nil
}

func (r *PostgresRepo) MoveKanbanCardWithWorkspaceEvent(input KanbanCardMoveInput) (KanbanCardWorkspaceEventResult, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	defer tx.Rollback()

	if input.ColumnID != "" {
		var columnExists bool
		if err := tx.QueryRowContext(ctx, `
select exists(select 1 from kanban_columns where company_id=$1 and board_id=$2 and column_id=$3)`,
			input.CompanyID, input.BoardID, input.ColumnID).Scan(&columnExists); err != nil {
			return KanbanCardWorkspaceEventResult{}, err
		}
		if !columnExists {
			return KanbanCardWorkspaceEventResult{}, ErrNotFound
		}
	}
	if input.ColumnID != "" && input.Position <= 0 {
		if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from kanban_cards
where company_id=$1 and board_id=$2 and column_id=$3`, input.CompanyID, input.BoardID, input.ColumnID).Scan(&input.Position); err != nil {
			return KanbanCardWorkspaceEventResult{}, err
		}
	}

	issueValue := false
	if input.IsIssue != nil {
		issueValue = *input.IsIssue
	}
	item, err := scanKanbanCard(tx.QueryRowContext(ctx, `
update kanban_cards
set column_id=coalesce(nullif($4, '')::uuid, column_id),
    node_title=coalesce((select title from nodes where company_id=$1 and node_id=kanban_cards.node_id), node_title),
    position=case when $5 > 0 then $5 else position end,
    is_issue=case when $6 then $7 else is_issue end,
    updated_timestamp=now()
where company_id=$1 and board_id=$2 and card_id=$3
returning `+kanbanCardSelectColumns,
		input.CompanyID, input.BoardID, input.CardID, input.ColumnID, input.Position, input.IsIssue != nil, issueValue,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return KanbanCardWorkspaceEventResult{}, ErrNotFound
	}
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	if item.LogicGateID != nil {
		if _, err := syncNodeLogicGateAssignmentFromCardSQL(ctx, tx, item); err != nil {
			return KanbanCardWorkspaceEventResult{}, err
		}
	}
	if err := syncNodeStatusFromKanbanCardSQL(ctx, tx, item); err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	derivedNode, events, err := r.appendKanbanCardWorkspaceEventsTx(ctx, tx, "kanban_card_moved", item, true)
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	return KanbanCardWorkspaceEventResult{Card: item, DerivedNode: derivedNode, Events: events}, nil
}

func (r *PostgresRepo) DeleteKanbanCardWithWorkspaceEvent(companyID, boardID, cardID string) (KanbanCardWorkspaceEventResult, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	defer tx.Rollback()

	card, err := scanKanbanCard(tx.QueryRowContext(ctx, `
select `+kanbanCardSelectColumns+`
from kanban_cards
where company_id=$1 and board_id=$2 and card_id=$3`, companyID, boardID, cardID))
	if errors.Is(err, sql.ErrNoRows) {
		return KanbanCardWorkspaceEventResult{}, ErrNotFound
	}
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	if err := deleteNodeLogicGateAssignmentForCardSQL(ctx, tx, card); err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	result, err := tx.ExecContext(ctx, `
delete from kanban_cards
where company_id=$1 and board_id=$2 and card_id=$3`,
		companyID, boardID, cardID,
	)
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	if affected == 0 {
		return KanbanCardWorkspaceEventResult{}, ErrNotFound
	}
	if card.LogicGateID != nil {
		if _, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, companyID, card.NodeID, ""); errors.Is(err, ErrNotFound) {
			if _, err := tx.ExecContext(ctx, `
update nodes
set status=null,
    status_color=null
where company_id=$1 and node_id=$2`, companyID, card.NodeID); err != nil {
				return KanbanCardWorkspaceEventResult{}, err
			}
		} else if err != nil {
			return KanbanCardWorkspaceEventResult{}, err
		}
	}
	derivedNode, events, err := r.appendKanbanCardWorkspaceEventsTx(ctx, tx, "kanban_card_deleted", card, false)
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	return KanbanCardWorkspaceEventResult{Card: card, DerivedNode: derivedNode, Events: events}, nil
}
