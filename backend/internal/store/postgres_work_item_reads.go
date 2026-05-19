package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) ListResponsibleInboxNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listAssignedWorkItemInboxNodes(query)
}

func (r *PostgresRepo) ListMyNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listAssignedWorkItemInboxNodes(query)
}

func (r *PostgresRepo) listAssignedWorkItemInboxNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	query = NormalizeWorkItemInboxQuery(query)
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1
  and n.assignee_user_id::text=$2
order by n.created_timestamp asc, n.node_id::text asc
limit $3`,
		query.CompanyID, query.UserID, query.Limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.Node, 0)
	for rows.Next() {
		item, err := scanNode(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresRepo) ListACIInboxLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listWorkItemLogicGateInboxItems(query, true)
}

func (r *PostgresRepo) ListMyLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listWorkItemLogicGateInboxItems(query, false)
}

func (r *PostgresRepo) listWorkItemLogicGateInboxItems(query WorkItemInboxQuery, aciOnly bool) ([]WorkItemLogicGateInboxItem, error) {
	query = NormalizeWorkItemInboxQuery(query)
	ctx := context.Background()
	roleFilter := ""
	if aciOnly {
		roleFilter = "\n  and assignment.role in ('accountable', 'consulted', 'informed')"
	}
	rows, err := r.db.QueryContext(ctx, `
select
  logic_gate.company_id::text,
  logic_gate.logic_gate_id::text,
  logic_gate.header,
  logic_gate.created_timestamp,
  coalesce(jsonb_agg(assignment.role order by
    case assignment.role
      when 'responsible' then 1
      when 'accountable' then 2
      when 'consulted' then 3
      when 'informed' then 4
      else 5
    end
  ), '[]'::jsonb)::text as roles_json
from logic_gates logic_gate
join logic_gate_raci_assignments assignment
  on assignment.company_id = logic_gate.company_id
 and assignment.logic_gate_id = logic_gate.logic_gate_id
where logic_gate.company_id=$1
  and assignment.user_id::text=$2`+roleFilter+`
group by logic_gate.company_id, logic_gate.logic_gate_id, logic_gate.header, logic_gate.created_timestamp
order by lower(logic_gate.header) asc, logic_gate.logic_gate_id::text asc
limit $3`, query.CompanyID, query.UserID, query.Limit)
	if err != nil {
		if isPostgresUndefinedTable(err, "logic_gate_raci_assignments") {
			return []WorkItemLogicGateInboxItem{}, nil
		}
		return nil, err
	}
	defer rows.Close()

	items := make([]WorkItemLogicGateInboxItem, 0)
	ids := make([]string, 0)
	for rows.Next() {
		var item WorkItemLogicGateInboxItem
		var rolesJSON sql.NullString
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp, &rolesJSON); err != nil {
			return nil, err
		}
		if rolesJSON.Valid {
			var roles []string
			if err := json.Unmarshal([]byte(rolesJSON.String), &roles); err == nil {
				item.Roles = cleanStringList(roles)
			}
		}
		if len(item.Roles) == 0 {
			item.Roles = []string{}
		}
		items = append(items, item)
		ids = append(ids, item.LogicGateID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	assignmentsByGate, err := r.listLogicGateRaciAssignments(ctx, query.CompanyID, ids)
	if err != nil {
		return nil, err
	}
	for index := range items {
		items[index].RaciAssignments = assignmentsByGate[strings.TrimSpace(items[index].LogicGateID)]
		if items[index].RaciAssignments == nil {
			items[index].RaciAssignments = []domain.LogicGateRaciAssignment{}
		}
	}
	return items, nil
}
