package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) GetLogicGateWork(companyID, logicGateID string) (domain.LogicGateWorkView, error) {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" {
		return domain.LogicGateWorkView{}, ErrInvalid
	}

	ctx := context.Background()
	logicGate, err := r.GetLogicGate(companyID, logicGateID)
	if errors.Is(err, ErrNotFound) {
		return domain.LogicGateWorkView{}, ErrNotFound
	}
	if err != nil {
		return domain.LogicGateWorkView{}, err
	}

	rows, err := r.db.QueryContext(ctx, `
select
  assignment.assignment_id::text,
  assignment.company_id::text,
  assignment.node_id::text,
  assignment.logic_gate_id::text,
  assignment.status_key,
  assignment.column_id::text,
  assignment.is_issue,
  assignment.position,
  assignment.compatibility_board_id,
  assignment.compatibility_card_id::text,
  coalesce(assignment.requested_by_user_id::text, ''),
  assignment.version,
  assignment.created_timestamp,
  assignment.updated_timestamp,
  projection.company_id::text,
  projection.node_id::text,
  projection.title,
  case
    when projection.is_issue then 'Issue'
    when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('requested', 'request', 'requests', 'r') then 'Requested'
    when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('backlog', 'backlogs', 'b') then 'Backlogs'
    when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('in progress', 'inprogress', 'ip') then 'In Progress'
    when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) = 'review' then 'Review'
    when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('done', 'd') then 'Done'
    else 'Pending'
  end as status,
  projection.due_date::text,
  projection.priority,
  projection.node_created_timestamp,
  coalesce(node_logic_gates.logic_gate_ids_json, '[]') as logic_gate_ids_json
from kanban_board_projection projection
join node_logic_gate_assignments assignment
  on assignment.company_id = projection.company_id
 and assignment.logic_gate_id = projection.logic_gate_id
 and assignment.node_id = projection.node_id
left join lateral (
  select coalesce(jsonb_agg(gate.logic_gate_id order by gate.logic_gate_id), '[]'::jsonb)::text as logic_gate_ids_json
  from (
    select distinct all_assignment.logic_gate_id::text as logic_gate_id
    from node_logic_gate_assignments all_assignment
    where all_assignment.company_id = projection.company_id
      and all_assignment.node_id = projection.node_id
  ) gate
) node_logic_gates on true
where projection.company_id = $1::uuid
  and projection.logic_gate_id = $2::uuid
order by
  case
    when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('requested', 'request', 'requests', 'r') then 0
    when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('backlog', 'backlogs', 'b') then 1
    when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('pending', 'p') then 2
    when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('in progress', 'inprogress', 'ip') then 3
    when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) = 'review' then 4
    when lower(replace(replace(trim(projection.status), '_', ' '), '-', ' ')) in ('done', 'd') then 5
    else 2
  end asc,
  projection.position asc,
  projection.assignment_created_timestamp asc,
  assignment.assignment_id asc`, companyID, logicGateID)
	if err != nil {
		return domain.LogicGateWorkView{}, err
	}
	defer rows.Close()

	assignments := make([]domain.LogicGateWorkAssignment, 0)
	for rows.Next() {
		item, err := scanLogicGateWorkAssignment(rows)
		if err != nil {
			return domain.LogicGateWorkView{}, err
		}
		assignments = append(assignments, item)
	}
	if err := rows.Err(); err != nil {
		return domain.LogicGateWorkView{}, err
	}
	return buildLogicGateWorkView(logicGate, assignments), nil
}

func scanLogicGateWorkAssignment(row interface{ Scan(dest ...any) error }) (domain.LogicGateWorkAssignment, error) {
	var item domain.LogicGateWorkAssignment
	var status sql.NullString
	var dueDate sql.NullString
	var priority sql.NullInt64
	var logicGateIDsJSON sql.NullString
	err := row.Scan(
		&item.Assignment.AssignmentID,
		&item.Assignment.CompanyID,
		&item.Assignment.NodeID,
		&item.Assignment.LogicGateID,
		&item.Assignment.StatusKey,
		&item.Assignment.ColumnID,
		&item.Assignment.IsIssue,
		&item.Assignment.Position,
		&item.Assignment.CompatibilityBoardID,
		&item.Assignment.CompatibilityCardID,
		&item.Assignment.RequestedByUserID,
		&item.Assignment.Version,
		&item.Assignment.CreatedTimestamp,
		&item.Assignment.UpdatedTimestamp,
		&item.Node.CompanyID,
		&item.Node.NodeID,
		&item.Node.Title,
		&status,
		&dueDate,
		&priority,
		&item.Node.CreatedTimestamp,
		&logicGateIDsJSON,
	)
	if err != nil {
		return item, err
	}
	if status.Valid {
		item.Node.Status = &status.String
	}
	if dueDate.Valid {
		item.Node.DueDate = &dueDate.String
	}
	if priority.Valid {
		value := int(priority.Int64)
		item.Node.Priority = &value
	}
	if logicGateIDsJSON.Valid {
		var ids []string
		if json.Unmarshal([]byte(logicGateIDsJSON.String), &ids) == nil {
			item.Node.LogicGateIDs = cleanStringList(ids)
		}
	}
	return item, nil
}
