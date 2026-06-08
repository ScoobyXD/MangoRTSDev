package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

type kanbanBoardProjectionDB interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

const kanbanProjectionCanonicalStatusSQL = `
case
  when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('backlog', 'backlogs', 'b') then 'backlog'
  when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('in progress', 'inprogress', 'ip') then 'in_progress'
  when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('verify', 'verification', 'v') then 'verify'
  when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('done', 'd') then 'done'
  else 'pending'
end`

const postgresLogicGateAssignmentStatusTitleSQL = `
case
  when lower(replace(replace(trim(assignment.status_key), '_', ' '), '-', ' ')) in ('backlog', 'backlogs', 'b') then 'Backlogs'
  when lower(replace(replace(trim(assignment.status_key), '_', ' '), '-', ' ')) in ('in progress', 'inprogress', 'ip') then 'In Progress'
  when lower(replace(replace(trim(assignment.status_key), '_', ' '), '-', ' ')) in ('verify', 'verification', 'v') then 'Verify'
  when lower(replace(replace(trim(assignment.status_key), '_', ' '), '-', ' ')) in ('done', 'd') then 'Done'
  else 'Pending'
end`

const postgresLogicGateAssignmentStatusColorSQL = `
case
  when lower(replace(replace(trim(assignment.status_key), '_', ' '), '-', ' ')) in ('backlog', 'backlogs', 'b') then '` + KanbanDefaultBacklogColor + `'
  when lower(replace(replace(trim(assignment.status_key), '_', ' '), '-', ' ')) in ('in progress', 'inprogress', 'ip') then '` + KanbanDefaultInProgressColor + `'
  when lower(replace(replace(trim(assignment.status_key), '_', ' '), '-', ' ')) in ('verify', 'verification', 'v') then '` + KanbanDefaultVerifyColor + `'
  when lower(replace(replace(trim(assignment.status_key), '_', ' '), '-', ' ')) in ('done', 'd') then '` + KanbanDefaultDoneColor + `'
  else '` + KanbanDefaultPendingColor + `'
end`

const kanbanProjectionStatusRankSQL = `
case
  when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('backlog', 'backlogs', 'b') then 0
  when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('pending', 'p') then 1
  when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('in progress', 'inprogress', 'ip') then 2
  when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('verify', 'verification', 'v') then 3
  when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('done', 'd') then 4
  else 1
end`

const kanbanBoardProjectionCardSelectColumns = `
projection.company_id::text as company_id,
projection.compatibility_board_id as compatibility_board_id,
projection.compatibility_card_id::text as compatibility_card_id,
` + kanbanProjectionCanonicalStatusSQL + ` as column_id,
projection.node_id::text as node_id,
projection.logic_gate_id::text as logic_gate_id,
projection.title as title,
''::text as description_snapshot,
projection.is_issue as is_issue,
projection.position as position,
projection.due_date::text as due_date,
projection.priority as priority,
projection.assignee_user_id::text as assignee_user_id,
(select u.display_name from users u where u.user_id = projection.assignee_user_id) as assignee_display_name,
(select u.email from users u where u.user_id = projection.assignee_user_id) as assignee_email,
projection.projection_updated_timestamp as projection_updated_timestamp,
projection.assignment_created_timestamp as assignment_created_timestamp,
projection.projection_updated_timestamp as projection_updated_timestamp,
projection.accounts::text as accounts_json`

func syncKanbanBoardProjectionForNodeTx(ctx context.Context, db kanbanBoardProjectionDB, companyID, nodeID string) error {
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	if companyID == "" || nodeID == "" {
		return ErrInvalid
	}
	_, err := db.ExecContext(ctx, `
with target_assignment as (
  select
    assignment.company_id,
    assignment.logic_gate_id,
    assignment.node_id,
    assignment.status_key,
    assignment.column_id,
    assignment.position,
    node_row.title,
    node_row.assignee_user_id,
    node_row.priority,
    assignment.is_issue,
    node_row.due_date,
    node_row.created_timestamp as node_created_timestamp,
    now() as node_updated_timestamp,
    assignment.assignment_id,
    assignment.created_timestamp as assignment_created_timestamp,
    assignment.updated_timestamp as assignment_updated_timestamp,
    assignment.compatibility_board_id,
    assignment.compatibility_card_id,
    coalesce(account_snapshot.accounts_json, '[]'::jsonb) as accounts
  from node_logic_gate_assignments assignment
  join nodes node_row
    on node_row.company_id = assignment.company_id
   and node_row.node_id = assignment.node_id
  join logic_gates logic_gate
    on logic_gate.company_id = assignment.company_id
   and logic_gate.logic_gate_id = assignment.logic_gate_id
  left join lateral (
    ` + postgresAccountSnapshotSQL + `
    where node_account.company_id=assignment.company_id
      and node_account.node_id=assignment.node_id
  ) account_snapshot on true
  where assignment.company_id = $1::uuid
    and assignment.node_id = $2::uuid
),
deleted_stale as (
  delete from kanban_board_projection projection
  where projection.company_id = $1::uuid
    and projection.node_id = $2::uuid
    and not exists (
      select 1
      from target_assignment target
      where target.logic_gate_id = projection.logic_gate_id
    )
)
insert into kanban_board_projection (
  company_id,
  logic_gate_id,
  node_id,
  status,
  column_id,
  position,
  title,
  assignee_user_id,
  priority,
  is_issue,
  due_date,
  node_created_timestamp,
  node_updated_timestamp,
  assignment_id,
  assignment_created_timestamp,
  assignment_updated_timestamp,
  compatibility_board_id,
  compatibility_card_id,
  accounts,
  projection_updated_timestamp
)
select
  company_id,
  logic_gate_id,
  node_id,
  status_key,
  column_id,
  position,
  title,
  assignee_user_id,
  priority,
  is_issue,
  due_date,
  node_created_timestamp,
  node_updated_timestamp,
  assignment_id,
  assignment_created_timestamp,
  assignment_updated_timestamp,
  compatibility_board_id,
  compatibility_card_id,
  accounts,
  now()
from target_assignment
on conflict (company_id, logic_gate_id, node_id)
do update set
  status = excluded.status,
  column_id = excluded.column_id,
  position = excluded.position,
  title = excluded.title,
  assignee_user_id = excluded.assignee_user_id,
  priority = excluded.priority,
  is_issue = excluded.is_issue,
  due_date = excluded.due_date,
  node_created_timestamp = excluded.node_created_timestamp,
  node_updated_timestamp = excluded.node_updated_timestamp,
  assignment_id = excluded.assignment_id,
  assignment_created_timestamp = excluded.assignment_created_timestamp,
  assignment_updated_timestamp = excluded.assignment_updated_timestamp,
  compatibility_board_id = excluded.compatibility_board_id,
  compatibility_card_id = excluded.compatibility_card_id,
  accounts = excluded.accounts,
  projection_updated_timestamp = now()`, companyID, nodeID)
	return err
}

func deleteKanbanBoardProjectionForNodeTx(ctx context.Context, db kanbanBoardProjectionDB, companyID, nodeID string) error {
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	if companyID == "" || nodeID == "" {
		return ErrInvalid
	}
	_, err := db.ExecContext(ctx, `
delete from kanban_board_projection
where company_id=$1::uuid
  and node_id=$2::uuid`, companyID, nodeID)
	return err
}

func deleteKanbanBoardProjectionForLogicGateTx(ctx context.Context, db kanbanBoardProjectionDB, companyID, logicGateID string) error {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" {
		return ErrInvalid
	}
	_, err := db.ExecContext(ctx, `
delete from kanban_board_projection
where company_id=$1::uuid
  and logic_gate_id=$2::uuid`, companyID, logicGateID)
	return err
}

func kanbanBoardProjectionCardByNodeTx(ctx context.Context, db kanbanBoardProjectionDB, companyID, nodeID, logicGateID string) (domain.KanbanCard, error) {
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || nodeID == "" {
		return domain.KanbanCard{}, ErrInvalid
	}
	item, err := scanKanbanCard(db.QueryRowContext(ctx, `
select `+kanbanBoardProjectionCardSelectColumns+`
from kanban_board_projection projection
where projection.company_id=$1::uuid
  and projection.node_id=$2::uuid
  and ($3 = '' or projection.logic_gate_id=$3::uuid)
order by projection.projection_updated_timestamp desc, projection.assignment_created_timestamp desc, projection.assignment_id desc
limit 1`, companyID, nodeID, logicGateID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.KanbanCard{}, ErrNotFound
	}
	return item, err
}

func listKanbanBoardProjectionCardsTx(ctx context.Context, db kanbanBoardProjectionDB, companyID, logicGateID string, query KanbanCardQuery) ([]domain.KanbanCard, error) {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" {
		return nil, ErrInvalid
	}
	query = NormalizeKanbanCardQuery(query)
	rows, err := db.QueryContext(ctx, `
with projected as (
  select
    `+kanbanBoardProjectionCardSelectColumns+`,
    projection.column_id::text as source_column_id,
    `+kanbanProjectionStatusRankSQL+` as status_rank
  from kanban_board_projection projection
  where projection.company_id=$1::uuid
    and projection.logic_gate_id=$2::uuid
)
select
  company_id,
  compatibility_board_id,
  compatibility_card_id,
  column_id,
  node_id,
  logic_gate_id,
  title,
  description_snapshot,
  is_issue,
  position,
  due_date,
  priority,
  assignee_user_id,
  assignee_display_name,
  assignee_email,
  projection_updated_timestamp,
  assignment_created_timestamp,
  projection_updated_timestamp,
  accounts_json
from projected
where ($3 = '' or column_id=$3 or source_column_id=$3)
  and ($4 = 0 or position > $4)
order by status_rank asc, position asc, assignment_created_timestamp asc, compatibility_card_id asc
limit $5`, companyID, logicGateID, strings.TrimSpace(query.ColumnID), query.AfterPosition, query.Limit)
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

const kanbanBoardProjectionRowSelectColumns = `
projection.company_id::text,
projection.compatibility_board_id,
projection.compatibility_card_id::text,
` + kanbanProjectionCanonicalStatusSQL + ` as column_id,
projection.column_id as source_column_id,
projection.node_id::text,
projection.logic_gate_id::text,
projection.title,
''::text as description_snapshot,
projection.is_issue,
projection.position,
projection.due_date::text,
projection.priority,
projection.assignee_user_id::text,
(select u.display_name from users u where u.user_id = projection.assignee_user_id) as assignee_display_name,
(select u.email from users u where u.user_id = projection.assignee_user_id) as assignee_email,
projection.node_created_timestamp,
projection.node_updated_timestamp,
projection.assignment_id::text,
projection.assignment_created_timestamp,
projection.assignment_updated_timestamp,
projection.projection_updated_timestamp,
projection.accounts::text as accounts_json`

func scanKanbanBoardProjectionRow(row interface{ Scan(dest ...any) error }) (KanbanBoardProjectionRow, error) {
	var item KanbanBoardProjectionRow
	var logicGateID string
	var dueDate sql.NullString
	var priority sql.NullInt64
	var assigneeUserID sql.NullString
	var assigneeDisplayName sql.NullString
	var assigneeEmail sql.NullString
	var accountsJSON sql.NullString
	var status string
	err := row.Scan(
		&item.CompanyID,
		&item.BoardID,
		&item.CardID,
		&item.ColumnID,
		&status,
		&item.NodeID,
		&logicGateID,
		&item.NodeTitle,
		&item.DescriptionSnapshot,
		&item.IsIssue,
		&item.Position,
		&dueDate,
		&priority,
		&assigneeUserID,
		&assigneeDisplayName,
		&assigneeEmail,
		&item.NodeCreatedTimestamp,
		&item.NodeUpdatedTimestamp,
		&item.AssignmentID,
		&item.AssignmentCreatedTimestamp,
		&item.AssignmentUpdatedTimestamp,
		&item.ProjectionUpdatedTimestamp,
		&accountsJSON,
	)
	if err != nil {
		return KanbanBoardProjectionRow{}, err
	}
	item.LogicGateID = &logicGateID
	item.ResourceType = EntityTypeNode
	item.ResourceID = item.NodeID
	item.DisplayTitle = item.NodeTitle
	item.Status = &status
	item.CreatedTimestamp = item.AssignmentCreatedTimestamp
	item.UpdatedTimestamp = item.ProjectionUpdatedTimestamp
	if dueDate.Valid {
		item.DueDate = &dueDate.String
	}
	if priority.Valid {
		value := int(priority.Int64)
		item.Priority = &value
	}
	if assigneeUserID.Valid {
		item.AssigneeUserID = &assigneeUserID.String
	}
	if assigneeDisplayName.Valid {
		item.AssigneeDisplayName = &assigneeDisplayName.String
	}
	if assigneeEmail.Valid {
		item.AssigneeEmail = &assigneeEmail.String
	}
	item.Accounts = scanAccountSnapshotsJSON(accountsJSON)
	return item, nil
}

func listKanbanBoardProjectionRowsTx(ctx context.Context, db kanbanBoardProjectionDB, companyID, logicGateID string, query KanbanCardQuery) ([]KanbanBoardProjectionRow, error) {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" {
		return nil, ErrInvalid
	}
	query = NormalizeKanbanCardQuery(query)
	rows, err := db.QueryContext(ctx, `
with projected as (
  select
    `+kanbanBoardProjectionRowSelectColumns+`,
    `+kanbanProjectionStatusRankSQL+` as status_rank
  from kanban_board_projection projection
  where projection.company_id=$1::uuid
    and projection.logic_gate_id=$2::uuid
)
select
  company_id,
  compatibility_board_id,
  compatibility_card_id,
  column_id,
  source_column_id,
  node_id,
  logic_gate_id,
  title,
  description_snapshot,
  is_issue,
  position,
  due_date,
  priority,
  assignee_user_id,
  assignee_display_name,
  assignee_email,
  node_created_timestamp,
  node_updated_timestamp,
  assignment_id,
  assignment_created_timestamp,
  assignment_updated_timestamp,
  projection_updated_timestamp,
  accounts_json
from projected
where ($3 = '' or column_id=$3 or source_column_id=$3)
  and ($4 = 0 or position > $4)
order by status_rank asc, position asc, assignment_created_timestamp asc, compatibility_card_id asc
limit $5`, companyID, logicGateID, strings.TrimSpace(query.ColumnID), query.AfterPosition, query.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]KanbanBoardProjectionRow, 0)
	for rows.Next() {
		item, err := scanKanbanBoardProjectionRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func postgresKanbanProjectionRowsForNodeTx(ctx context.Context, db kanbanBoardProjectionDB, companyID, nodeID string) ([]KanbanBoardProjectionRow, error) {
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	if companyID == "" || nodeID == "" {
		return nil, ErrInvalid
	}
	rows, err := db.QueryContext(ctx, `
select `+kanbanBoardProjectionRowSelectColumns+`
from kanban_board_projection projection
where projection.company_id=$1::uuid
  and projection.node_id=$2::uuid
order by projection.logic_gate_id, projection.node_id`, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]KanbanBoardProjectionRow, 0)
	for rows.Next() {
		item, err := scanKanbanBoardProjectionRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func postgresKanbanProjectionRowsForLogicGateTx(ctx context.Context, db kanbanBoardProjectionDB, companyID, logicGateID string) ([]KanbanBoardProjectionRow, error) {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" {
		return nil, ErrInvalid
	}
	return listKanbanBoardProjectionRowsTx(ctx, db, companyID, logicGateID, KanbanCardQuery{Limit: KanbanMaxCardsLimit})
}

func (r *PostgresRepo) ListKanbanBoardProjectionRows(companyID, logicGateID string, query KanbanCardQuery) ([]KanbanBoardProjectionRow, error) {
	return listKanbanBoardProjectionRowsTx(context.Background(), r.db, companyID, logicGateID, query)
}

func (r *PostgresRepo) ListKanbanBoardProjectionRowsForNode(companyID, nodeID string) ([]KanbanBoardProjectionRow, error) {
	return postgresKanbanProjectionRowsForNodeTx(context.Background(), r.db, companyID, nodeID)
}

func (r *PostgresRepo) ListKanbanBoardProjectionRowsForLogicGate(companyID, logicGateID string) ([]KanbanBoardProjectionRow, error) {
	return postgresKanbanProjectionRowsForLogicGateTx(context.Background(), r.db, companyID, logicGateID)
}

func rebuildKanbanBoardProjectionForLogicGateTx(ctx context.Context, db kanbanBoardProjectionDB, companyID, logicGateID string) (int64, error) {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" {
		return 0, ErrInvalid
	}
	var count int64
	err := db.QueryRowContext(ctx, `
with deleted as (
  delete from kanban_board_projection
  where company_id=$1::uuid
    and logic_gate_id=$2::uuid
),
inserted as (
  insert into kanban_board_projection (
    company_id,
    logic_gate_id,
    node_id,
    status,
    column_id,
    position,
    title,
    assignee_user_id,
    priority,
    is_issue,
    due_date,
    node_created_timestamp,
    node_updated_timestamp,
    assignment_id,
    assignment_created_timestamp,
    assignment_updated_timestamp,
    compatibility_board_id,
    compatibility_card_id,
    accounts,
    projection_updated_timestamp
  )
  select
    assignment.company_id,
    assignment.logic_gate_id,
    assignment.node_id,
    assignment.status_key,
    assignment.column_id,
    assignment.position,
    node_row.title,
    node_row.assignee_user_id,
    node_row.priority,
    assignment.is_issue,
    node_row.due_date,
    node_row.created_timestamp,
    greatest(node_row.created_timestamp, assignment.updated_timestamp),
    assignment.assignment_id,
    assignment.created_timestamp,
    assignment.updated_timestamp,
    assignment.compatibility_board_id,
    assignment.compatibility_card_id,
    coalesce(account_snapshot.accounts_json, '[]'::jsonb),
    now()
  from node_logic_gate_assignments assignment
  join nodes node_row
    on node_row.company_id = assignment.company_id
   and node_row.node_id = assignment.node_id
  join logic_gates logic_gate
    on logic_gate.company_id = assignment.company_id
   and logic_gate.logic_gate_id = assignment.logic_gate_id
  left join lateral (
    ` + postgresAccountSnapshotSQL + `
    where node_account.company_id=assignment.company_id
      and node_account.node_id=assignment.node_id
  ) account_snapshot on true
  where assignment.company_id=$1::uuid
    and assignment.logic_gate_id=$2::uuid
  returning 1
)
select count(*) from inserted`, companyID, logicGateID).Scan(&count)
	return count, err
}

func (r *PostgresRepo) RebuildKanbanBoardProjectionForLogicGate(companyID, logicGateID string) (int64, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	count, err := rebuildKanbanBoardProjectionForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return count, nil
}

func (r *PostgresRepo) RebuildKanbanBoardProjectionForCompany(companyID string) (int64, error) {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return 0, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
select logic_gate_id::text
from logic_gates
where company_id=$1::uuid
order by logic_gate_id`, companyID)
	if err != nil {
		return 0, err
	}
	logicGateIDs := []string{}
	for rows.Next() {
		var logicGateID string
		if err := rows.Scan(&logicGateID); err != nil {
			rows.Close()
			return 0, err
		}
		logicGateIDs = append(logicGateIDs, logicGateID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}

	var total int64
	for _, logicGateID := range logicGateIDs {
		count, err := rebuildKanbanBoardProjectionForLogicGateTx(ctx, tx, companyID, logicGateID)
		if err != nil {
			return 0, err
		}
		total += count
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return total, nil
}
