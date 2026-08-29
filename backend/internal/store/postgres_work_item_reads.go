package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) ListResponsibleInboxNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListResponsibleInboxNodesContext(context.Background(), query)
}

func (r *PostgresRepo) ListResponsibleInboxNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listRACIMatrixProjectedNodes(ctx, query, true)
}

func (r *PostgresRepo) ListMyNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListMyNodesContext(context.Background(), query)
}

func (r *PostgresRepo) ListMyNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listRACIMatrixProjectedNodes(ctx, query, false)
}

func (r *PostgresRepo) listRACIMatrixProjectedNodes(ctx context.Context, query WorkItemInboxQuery, responsibleOnly bool) ([]domain.Node, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	query = NormalizeWorkItemInboxQuery(query)
	roleFilter := ""
	if responsibleOnly {
		roleFilter = "and assignment.role='responsible'"
	}
	rows, err := r.db.QueryContext(ctx, `
select
  node.company_id::text,
  node.node_id::text,
  node.name,
  node.status,
  node.due_date::text,
  node.priority,
  node.created_timestamp,
  coalesce((
    select jsonb_agg(link.logic_gate_id::text order by link.logic_gate_id::text)
    from node_logic_gate_assignments link
    where link.company_id=node.company_id and link.node_id=node.node_id
  ), '[]'::jsonb)::text,
  '[]'::jsonb::text
from nodes node
join lateral mangorts_v2_effective_gvic_assignments(node.company_id,'node',node.node_id) assignment
  on assignment.user_id=$2::uuid
where node.company_id=$1::uuid
  `+roleFilter+`
  and mangorts_user_can_access_resource(node.company_id,'node',node.node_id,$4::uuid,'edit')
order by node.created_timestamp asc,node.node_id::text asc
limit $3`, query.CompanyID, query.UserID, query.Limit, query.ViewerUserID)
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
	return items, rows.Err()
}

func (r *PostgresRepo) ListACIInboxLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.ListACIInboxLogicGatesContext(context.Background(), query)
}

func (r *PostgresRepo) ListACIInboxLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listRACIMatrixProjectedLogicGates(ctx, query, true)
}

func (r *PostgresRepo) ListMyLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.ListMyLogicGatesContext(context.Background(), query)
}

func (r *PostgresRepo) ListMyLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listRACIMatrixProjectedLogicGates(ctx, query, false)
}

func (r *PostgresRepo) listRACIMatrixProjectedLogicGates(ctx context.Context, query WorkItemInboxQuery, aciOnly bool) ([]WorkItemLogicGateInboxItem, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	query = NormalizeWorkItemInboxQuery(query)
	roleFilter := ""
	if aciOnly {
		roleFilter = "\n  and assignment.role in ('accountable', 'consulted', 'informed')"
	}
	rows, err := r.db.QueryContext(ctx, `
select
  gate.company_id::text,
  gate.logic_gate_id::text,
  gate.header,
  gate.created_timestamp,
  jsonb_build_array(assignment.role)::text
from logic_gates gate
join lateral mangorts_v2_effective_gvic_assignments(gate.company_id,'logic_gate',gate.logic_gate_id) assignment
  on assignment.user_id=$2::uuid
where gate.company_id=$1::uuid`+roleFilter+`
  and mangorts_user_can_access_resource(gate.company_id,'logic_gate',gate.logic_gate_id,$4::uuid,'edit')
order by lower(gate.header) asc,gate.logic_gate_id::text asc
limit $3`, query.CompanyID, query.UserID, query.Limit, query.ViewerUserID)
	if err != nil {
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
	assignmentsByGate, err := r.listProjectedLogicGateRACIAssignments(ctx, query.CompanyID, ids)
	if err != nil {
		return nil, err
	}
	for index := range items {
		items[index].RACIAssignments = assignmentsByGate[strings.TrimSpace(items[index].LogicGateID)]
		if items[index].RACIAssignments == nil {
			items[index].RACIAssignments = []domain.LogicGateRACIAssignment{}
		}
	}
	return items, nil
}

func (r *PostgresRepo) listProjectedLogicGateRACIAssignments(ctx context.Context, companyID string, logicGateIDs []string) (map[string][]domain.LogicGateRACIAssignment, error) {
	return r.listLogicGateRACIAssignments(ctx, companyID, logicGateIDs)
}
