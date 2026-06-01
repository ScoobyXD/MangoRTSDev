package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

const nodeLogicGateAssignmentSelectColumns = `
assignment_id::text,
company_id::text,
node_id::text,
logic_gate_id::text,
status_key,
column_id::text,
is_issue,
position,
compatibility_board_id,
compatibility_card_id::text,
version,
created_timestamp,
updated_timestamp`

func scanNodeLogicGateAssignment(row interface{ Scan(dest ...any) error }) (domain.NodeLogicGateAssignment, error) {
	var item domain.NodeLogicGateAssignment
	err := row.Scan(
		&item.AssignmentID,
		&item.CompanyID,
		&item.NodeID,
		&item.LogicGateID,
		&item.StatusKey,
		&item.ColumnID,
		&item.IsIssue,
		&item.Position,
		&item.CompatibilityBoardID,
		&item.CompatibilityCardID,
		&item.Version,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	return item, err
}

func (r *PostgresRepo) ListNodeLogicGateAssignments(companyID, nodeID string) ([]domain.NodeLogicGateAssignment, error) {
	ctx := context.Background()
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	rows, err := r.db.QueryContext(ctx, `
select `+nodeLogicGateAssignmentSelectColumns+`
from node_logic_gate_assignments
where company_id=$1
  and ($2 = '' or node_id::text=$2)
order by updated_timestamp desc, created_timestamp desc, assignment_id desc`, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.NodeLogicGateAssignment, 0)
	for rows.Next() {
		item, err := scanNodeLogicGateAssignment(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

type nodeLogicGateAssignmentSQLInput struct {
	AssignmentID         string
	CompanyID            string
	NodeID               string
	LogicGateID          string
	StatusKey            string
	ColumnID             string
	IsIssue              bool
	Position             int
	CompatibilityBoardID string
	CompatibilityCardID  string
}

type nodeLogicGateAssignmentQueryRower interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

type nodeLogicGateAssignmentExecer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func upsertNodeLogicGateAssignmentSQL(ctx context.Context, queryer nodeLogicGateAssignmentQueryRower, input nodeLogicGateAssignmentSQLInput) (domain.NodeLogicGateAssignment, error) {
	input.AssignmentID = strings.TrimSpace(input.AssignmentID)
	if input.AssignmentID == "" {
		input.AssignmentID = newUUIDv7String()
	}
	input.StatusKey = strings.TrimSpace(input.StatusKey)
	if input.StatusKey == "" {
		input.StatusKey = logicGateAssignmentStatusKey(input.ColumnID)
	}
	item, err := scanNodeLogicGateAssignment(queryer.QueryRowContext(ctx, `
insert into node_logic_gate_assignments (
  assignment_id,
  company_id,
  node_id,
  logic_gate_id,
  status_key,
  column_id,
  is_issue,
  position,
  compatibility_board_id,
  compatibility_card_id,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid, $7, $8, $9, $10::uuid, now(), now())
on conflict (company_id, node_id)
do update set
  logic_gate_id=excluded.logic_gate_id,
  status_key=excluded.status_key,
  column_id=excluded.column_id,
  is_issue=excluded.is_issue,
  position=excluded.position,
  compatibility_board_id=excluded.compatibility_board_id,
  compatibility_card_id=excluded.compatibility_card_id,
  version=node_logic_gate_assignments.version + 1,
  updated_timestamp=now()
returning `+nodeLogicGateAssignmentSelectColumns,
		input.AssignmentID,
		input.CompanyID,
		input.NodeID,
		input.LogicGateID,
		input.StatusKey,
		input.ColumnID,
		input.IsIssue,
		input.Position,
		input.CompatibilityBoardID,
		input.CompatibilityCardID,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NodeLogicGateAssignment{}, ErrNotFound
	}
	return item, err
}

func nodeLogicGateAssignmentByNodeSQL(ctx context.Context, queryer nodeLogicGateAssignmentQueryRower, companyID, nodeID, logicGateID string) (domain.NodeLogicGateAssignment, error) {
	item, err := scanNodeLogicGateAssignment(queryer.QueryRowContext(ctx, `
select `+nodeLogicGateAssignmentSelectColumns+`
from node_logic_gate_assignments
where company_id=$1
  and node_id=$2
  and ($3 = '' or logic_gate_id::text=$3)
order by updated_timestamp desc, created_timestamp desc, assignment_id desc
limit 1`, companyID, nodeID, strings.TrimSpace(logicGateID)))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NodeLogicGateAssignment{}, ErrNotFound
	}
	return item, err
}

func nodeLogicGateAssignmentCardSQL(ctx context.Context, queryer nodeLogicGateAssignmentQueryRower, assignment domain.NodeLogicGateAssignment) (domain.KanbanCard, error) {
	item, err := scanKanbanCard(queryer.QueryRowContext(ctx, `
select `+kanbanCardSelectColumns+`
from kanban_cards
where company_id=$1
  and board_id=$2
  and card_id=$3`, assignment.CompanyID, assignment.CompatibilityBoardID, assignment.CompatibilityCardID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.KanbanCard{}, ErrNotFound
	}
	return item, err
}

func syncNodeLogicGateAssignmentFromCardSQL(ctx context.Context, queryer nodeLogicGateAssignmentQueryRower, card domain.KanbanCard) (domain.NodeLogicGateAssignment, error) {
	if card.LogicGateID == nil || strings.TrimSpace(*card.LogicGateID) == "" {
		return domain.NodeLogicGateAssignment{}, nil
	}
	var columnTitle string
	if err := queryer.QueryRowContext(ctx, `
select title
from kanban_columns
where company_id=$1 and board_id=$2 and column_id=$3`, card.CompanyID, card.BoardID, card.ColumnID).Scan(&columnTitle); err != nil {
		return domain.NodeLogicGateAssignment{}, err
	}
	return upsertNodeLogicGateAssignmentSQL(ctx, queryer, nodeLogicGateAssignmentSQLInput{
		CompanyID:            card.CompanyID,
		NodeID:               card.NodeID,
		LogicGateID:          *card.LogicGateID,
		StatusKey:            logicGateAssignmentStatusKey(columnTitle),
		ColumnID:             card.ColumnID,
		IsIssue:              card.IsIssue,
		Position:             card.Position,
		CompatibilityBoardID: card.BoardID,
		CompatibilityCardID:  card.CardID,
	})
}

func deleteNodeLogicGateAssignmentForCardSQL(ctx context.Context, execer nodeLogicGateAssignmentExecer, card domain.KanbanCard) error {
	if card.LogicGateID == nil || strings.TrimSpace(*card.LogicGateID) == "" {
		return nil
	}
	if _, err := execer.ExecContext(ctx, `
delete from node_logic_gate_assignments
where company_id=$1
  and node_id=$2
  and compatibility_board_id=$3
  and compatibility_card_id=$4`,
		card.CompanyID, card.NodeID, card.BoardID, card.CardID,
	); err != nil {
		return err
	}
	_, err := execer.ExecContext(ctx, `
delete from kanban_board_projection
where company_id=$1::uuid
  and node_id=$2::uuid
  and logic_gate_id=$3::uuid`,
		card.CompanyID, card.NodeID, *card.LogicGateID,
	)
	return err
}
