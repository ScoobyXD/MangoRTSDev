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
	return r.listRacioProjectedNodes(ctx, query, true)
}

func (r *PostgresRepo) ListMyNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListMyNodesContext(context.Background(), query)
}

func (r *PostgresRepo) ListMyNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listRacioProjectedNodes(ctx, query, false)
}

func (r *PostgresRepo) listRacioProjectedNodes(ctx context.Context, query WorkItemInboxQuery, responsibleOnly bool) ([]domain.Node, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	query = NormalizeWorkItemInboxQuery(query)
	roleFilter := "and entry.logic_gate_id is null"
	if responsibleOnly {
		roleFilter = `and entry.logic_gate_id is not null
  and exists (
    select 1
    from logic_gate_raci_assignments assignment
    where assignment.company_id=entry.company_id
      and assignment.logic_gate_id=entry.logic_gate_id
      and assignment.user_id=entry.user_id
      and assignment.role='responsible'
  )`
	}
	rows, err := r.db.QueryContext(ctx, `
select
  entry.company_id::text,
  entry.resource_id::text,
  entry.display_title,
  entry.status,
  entry.status_color,
  entry.due_date::text,
  entry.priority,
  entry.assignee_user_id::text,
  nullif(entry.assignee_display_name, ''),
  nullif(entry.assignee_email, ''),
  entry.resource_created_timestamp,
  case
    when entry.logic_gate_id is null then '[]'::jsonb
    else jsonb_build_array(entry.logic_gate_id::text)
  end::text as logic_gate_ids_json
from racio_matrix_projection_table entry
where entry.resource_type='node'
  and entry.company_id=$1::uuid
  and entry.user_id=$2::uuid
  `+roleFilter+`
  and mangorts_user_can_access_resource(entry.company_id, 'node', entry.resource_id, entry.user_id, 'edit')
order by entry.resource_created_timestamp asc, entry.resource_id::text asc
limit $3`, query.CompanyID, query.UserID, query.Limit)
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
	return r.listRacioProjectedLogicGates(ctx, query, true)
}

func (r *PostgresRepo) ListMyLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.ListMyLogicGatesContext(context.Background(), query)
}

func (r *PostgresRepo) ListMyLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listRacioProjectedLogicGates(ctx, query, false)
}

func (r *PostgresRepo) listRacioProjectedLogicGates(ctx context.Context, query WorkItemInboxQuery, aciOnly bool) ([]WorkItemLogicGateInboxItem, error) {
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
  entry.company_id::text,
  entry.resource_id::text,
  entry.display_title,
  entry.resource_created_timestamp,
  coalesce(jsonb_agg(assignment.role order by
    case assignment.role
      when 'responsible' then 1
      when 'accountable' then 2
      when 'consulted' then 3
      when 'informed' then 4
      else 5
    end
  ), '[]'::jsonb)::text as roles_json
from racio_matrix_projection_table entry
join logic_gate_raci_assignments assignment
  on assignment.company_id=entry.company_id
 and assignment.logic_gate_id=entry.resource_id
 and assignment.user_id=entry.user_id
where entry.resource_type='logic_gate'
  and entry.company_id=$1::uuid
  and entry.user_id=$2::uuid`+roleFilter+`
  and mangorts_user_can_access_resource(entry.company_id, 'logic_gate', entry.resource_id, entry.user_id, 'edit')
group by entry.company_id, entry.resource_id, entry.display_title, entry.resource_created_timestamp
order by lower(entry.display_title) asc, entry.resource_id::text asc
limit $3`, query.CompanyID, query.UserID, query.Limit)
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
	assignmentsByGate, err := r.listProjectedLogicGateRaciAssignments(ctx, query.CompanyID, ids)
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

func (r *PostgresRepo) listProjectedLogicGateRaciAssignments(ctx context.Context, companyID string, logicGateIDs []string) (map[string][]domain.LogicGateRaciAssignment, error) {
	assignmentsByGate := map[string][]domain.LogicGateRaciAssignment{}
	if len(logicGateIDs) == 0 {
		return assignmentsByGate, nil
	}
	rows, err := r.db.QueryContext(ctx, `
select
  assignment.company_id::text,
  assignment.logic_gate_id::text,
  assignment.role,
  assignment.user_id::text,
  nullif(app_user.display_name, ''),
  nullif(app_user.email, ''),
  assignment.created_timestamp
from logic_gate_raci_assignments assignment
join company_memberships membership
  on membership.company_id=assignment.company_id
 and membership.user_id=assignment.user_id
join users app_user
  on app_user.user_id=assignment.user_id
where assignment.company_id=$1::uuid
  and assignment.logic_gate_id = any(string_to_array($2, ',')::uuid[])
order by assignment.logic_gate_id::text asc,
  case assignment.role
    when 'responsible' then 1
    when 'accountable' then 2
    when 'consulted' then 3
    when 'informed' then 4
    else 5
  end,
  lower(coalesce(nullif(app_user.display_name, ''), nullif(app_user.email, ''), assignment.user_id::text)) asc,
  assignment.user_id::text asc`, companyID, strings.Join(logicGateIDs, ","))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		item, err := scanLogicGateRaciAssignment(rows)
		if err != nil {
			return nil, err
		}
		assignmentsByGate[item.LogicGateID] = append(assignmentsByGate[item.LogicGateID], item)
	}
	return assignmentsByGate, rows.Err()
}
