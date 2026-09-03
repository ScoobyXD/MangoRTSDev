package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

const nodeLogicGateAssignmentSelectColumns = `assignment_id::text,company_id::text,node_id::text,logic_gate_id::text,process_step_id::text,is_issue,position,coalesce(requested_by_user_id::text,''),coalesce(placed_by_user_id::text,''),version,created_timestamp,updated_timestamp`

func scanNodeLogicGateAssignment(row interface{ Scan(...any) error }) (domain.NodeLogicGateAssignment, error) {
	var item domain.NodeLogicGateAssignment
	err := row.Scan(&item.AssignmentID, &item.CompanyID, &item.NodeID, &item.LogicGateID, &item.ProcessStepID, &item.IsIssue, &item.Position, &item.RequestedByUserID, &item.PlacedByUserID, &item.Version, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	return item, err
}
func (r *PostgresRepo) ListNodeLogicGateAssignments(companyID, nodeID string) ([]domain.NodeLogicGateAssignment, error) {
	rows, err := r.db.QueryContext(context.Background(), `select `+nodeLogicGateAssignmentSelectColumns+` from node_logic_gate_assignments where company_id=$1::uuid and ($2='' or node_id::text=$2) order by updated_timestamp desc,created_timestamp desc,assignment_id desc`, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.NodeLogicGateAssignment{}
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
	AssignmentID      string
	CompanyID         string
	NodeID            string
	LogicGateID       string
	ProcessStepID     *string
	IsIssue           bool
	Position          int
	RequestedByUserID string
	PlacedByUserID    string
}
type nodeLogicGateAssignmentQueryRower interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}
type nodeLogicGateAssignmentExecer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func upsertNodeLogicGateAssignmentSQL(ctx context.Context, queryer nodeLogicGateAssignmentQueryRower, input nodeLogicGateAssignmentSQLInput) (domain.NodeLogicGateAssignment, error) {
	if input.AssignmentID == "" {
		input.AssignmentID = newUUIDv7String()
	}
	return scanNodeLogicGateAssignment(queryer.QueryRowContext(ctx, `insert into node_logic_gate_assignments(assignment_id,company_id,node_id,logic_gate_id,process_step_id,is_issue,position,requested_by_user_id,placed_by_user_id,created_timestamp,updated_timestamp) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,nullif($8,'')::uuid,nullif($9,'')::uuid,now(),now()) on conflict(company_id,node_id) do update set logic_gate_id=excluded.logic_gate_id,process_step_id=excluded.process_step_id,is_issue=excluded.is_issue,position=excluded.position,requested_by_user_id=excluded.requested_by_user_id,placed_by_user_id=excluded.placed_by_user_id,version=node_logic_gate_assignments.version+1,updated_timestamp=now() returning `+nodeLogicGateAssignmentSelectColumns, input.AssignmentID, input.CompanyID, input.NodeID, input.LogicGateID, input.ProcessStepID, input.IsIssue, input.Position, strings.TrimSpace(input.RequestedByUserID), strings.TrimSpace(input.PlacedByUserID)))
}
func nodeLogicGateAssignmentByNodeSQL(ctx context.Context, queryer nodeLogicGateAssignmentQueryRower, companyID, nodeID, logicGateID string) (domain.NodeLogicGateAssignment, error) {
	item, err := scanNodeLogicGateAssignment(queryer.QueryRowContext(ctx, `select `+nodeLogicGateAssignmentSelectColumns+` from node_logic_gate_assignments where company_id=$1::uuid and node_id=$2::uuid and ($3='' or logic_gate_id::text=$3)`, companyID, nodeID, logicGateID))
	if errors.Is(err, sql.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}
