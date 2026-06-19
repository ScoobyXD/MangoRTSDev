package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) ListGeneratedInboxNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListGeneratedInboxNodesContext(context.Background(), query)
}

func (r *PostgresRepo) ListGeneratedInboxNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listGVICMatrixProjectedNodes(ctx, query, true)
}

func (r *PostgresRepo) ListMyNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListMyNodesContext(context.Background(), query)
}

func (r *PostgresRepo) ListMyNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listGVICMatrixProjectedNodes(ctx, query, false)
}

func (r *PostgresRepo) listGVICMatrixProjectedNodes(ctx context.Context, query WorkItemInboxQuery, generatedOnly bool) ([]domain.Node, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	query = NormalizeWorkItemInboxQuery(query)
	roleFilter := "and entry.logic_gate_id is null"
	if generatedOnly {
		roleFilter = `and entry.logic_gate_id is not null
  and exists (
    select 1
    from logic_gate_GVIC_users assignment
    where assignment.company_id=entry.company_id
      and assignment.logic_gate_id=entry.logic_gate_id
      and assignment.user_id=entry.user_id
      and assignment.role='generated'
  )`
	}
	rows, err := r.db.QueryContext(ctx, `
with recursive `+postgresLogicGateGVICUsersCTE+`
select
  entry.company_id::text,
  entry.resource_id::text,
  entry.display_title,
  entry.status,
  entry.due_date::text,
  entry.priority,
  entry.resource_created_timestamp,
  case
    when entry.logic_gate_id is null then '[]'::jsonb
    else jsonb_build_array(entry.logic_gate_id::text)
  end::text as logic_gate_ids_json
from gvic_matrix_projection_table entry
where entry.resource_type='node'
  and entry.company_id=$1::uuid
  and entry.user_id=$2::uuid
  `+roleFilter+`
  and mangorts_user_can_access_resource(entry.company_id, 'node', entry.resource_id, $4::uuid, 'edit')
order by entry.resource_created_timestamp asc, entry.resource_id::text asc
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
	return r.listGVICMatrixProjectedLogicGates(ctx, query, true)
}

func (r *PostgresRepo) ListMyLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.ListMyLogicGatesContext(context.Background(), query)
}

func (r *PostgresRepo) ListMyLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listGVICMatrixProjectedLogicGates(ctx, query, false)
}

func (r *PostgresRepo) listGVICMatrixProjectedLogicGates(ctx context.Context, query WorkItemInboxQuery, aciOnly bool) ([]WorkItemLogicGateInboxItem, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	query = NormalizeWorkItemInboxQuery(query)
	roleFilter := ""
	if aciOnly {
		roleFilter = "\n  and assignment.role in ('verified', 'consulted', 'informed')"
	}
	rows, err := r.db.QueryContext(ctx, `
with recursive `+postgresLogicGateGVICUsersCTE+`
select
  entry.company_id::text,
  entry.resource_id::text,
  entry.display_title,
  entry.resource_created_timestamp,
  coalesce(jsonb_agg(assignment.role order by
    case assignment.role
      when 'generated' then 1
      when 'verified' then 2
      when 'consulted' then 3
      when 'informed' then 4
      else 5
    end
  ), '[]'::jsonb)::text as roles_json
from gvic_matrix_projection_table entry
join logic_gate_GVIC_users assignment
  on assignment.company_id=entry.company_id
 and assignment.logic_gate_id=entry.resource_id
 and assignment.user_id=entry.user_id
where entry.resource_type='logic_gate'
  and entry.company_id=$1::uuid
  and entry.user_id=$2::uuid`+roleFilter+`
  and mangorts_user_can_access_resource(entry.company_id, 'logic_gate', entry.resource_id, $4::uuid, 'edit')
group by entry.company_id, entry.resource_id, entry.display_title, entry.resource_created_timestamp
order by lower(entry.display_title) asc, entry.resource_id::text asc
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
	assignmentsByGate, err := r.listProjectedLogicGateGVICAssignments(ctx, query.CompanyID, ids)
	if err != nil {
		return nil, err
	}
	for index := range items {
		items[index].GVICAssignments = assignmentsByGate[strings.TrimSpace(items[index].LogicGateID)]
		if items[index].GVICAssignments == nil {
			items[index].GVICAssignments = []domain.LogicGateGVICAssignment{}
		}
	}
	return items, nil
}

func (r *PostgresRepo) listProjectedLogicGateGVICAssignments(ctx context.Context, companyID string, logicGateIDs []string) (map[string][]domain.LogicGateGVICAssignment, error) {
	return r.listLogicGateGVICAssignments(ctx, companyID, logicGateIDs)
}
