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
	return r.listWorkItemInboxNodes(ctx, query, domain.LogicGateRaciRoleResponsible)
}

func (r *PostgresRepo) ListMyNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListMyNodesContext(context.Background(), query)
}

func (r *PostgresRepo) ListMyNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listWorkItemInboxNodes(ctx, query, "assignee")
}

func (r *PostgresRepo) RebuildWorkItemInboxEntries(companyID string) error {
	ctx := context.Background()
	_, err := r.db.ExecContext(ctx, `select rebuild_work_item_inbox_entries_for_company($1::uuid)`, strings.TrimSpace(companyID))
	return err
}

func (r *PostgresRepo) RebuildWorkItemInboxEntriesForNode(companyID, nodeID string) error {
	ctx := context.Background()
	_, err := r.db.ExecContext(ctx, `select rebuild_work_item_inbox_entries_for_node($1::uuid, $2::uuid)`, strings.TrimSpace(companyID), strings.TrimSpace(nodeID))
	return err
}

func (r *PostgresRepo) RebuildWorkItemInboxEntriesForLogicGate(companyID, logicGateID string) error {
	ctx := context.Background()
	_, err := r.db.ExecContext(ctx, `select rebuild_work_item_inbox_entries_for_logic_gate($1::uuid, $2::uuid)`, strings.TrimSpace(companyID), strings.TrimSpace(logicGateID))
	return err
}

func (r *PostgresRepo) listWorkItemInboxNodes(ctx context.Context, query WorkItemInboxQuery, role string) ([]domain.Node, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	query = NormalizeWorkItemInboxQuery(query)
	rows, err := r.db.QueryContext(ctx, `
select
  entry.company_id::text,
  entry.node_id::text,
  entry.node_title,
  entry.status,
  entry.status_color,
  entry.due_date::text,
  entry.priority,
  entry.assignee_user_id::text,
  nullif(entry.assignee_display_name, ''),
  nullif(entry.assignee_email, ''),
  entry.node_created_timestamp,
  entry.logic_gate_ids::text
from work_item_inbox_entries entry
where entry.entry_kind='node'
  and entry.company_id=$1
  and entry.user_id::text=$2
  and entry.role=$3
  and exists (
    select 1
    from effective_resource_access access
    where access.company_id=entry.company_id
      and access.user_id=entry.user_id
      and access.resource_type='node'
      and access.resource_id=entry.node_id
      and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($5)
  )
order by entry.node_created_timestamp asc, entry.node_id::text asc
limit $4`, query.CompanyID, query.UserID, role, query.Limit, EntityPermissionView)
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
	return r.listWorkItemLogicGateInboxItems(ctx, query, true)
}

func (r *PostgresRepo) ListMyLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.ListMyLogicGatesContext(context.Background(), query)
}

func (r *PostgresRepo) ListMyLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listWorkItemLogicGateInboxItems(ctx, query, false)
}

func (r *PostgresRepo) listWorkItemLogicGateInboxItems(ctx context.Context, query WorkItemInboxQuery, aciOnly bool) ([]WorkItemLogicGateInboxItem, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	query = NormalizeWorkItemInboxQuery(query)
	roleFilter := ""
	if aciOnly {
		roleFilter = "\n  and entry.role in ('accountable', 'consulted', 'informed')"
	}
	rows, err := r.db.QueryContext(ctx, `
select
  entry.company_id::text,
  entry.logic_gate_id::text,
  entry.logic_gate_header,
  entry.logic_gate_created_timestamp,
  coalesce(jsonb_agg(entry.role order by
    case entry.role
      when 'responsible' then 1
      when 'accountable' then 2
      when 'consulted' then 3
      when 'informed' then 4
      else 5
    end
  ), '[]'::jsonb)::text as roles_json
from work_item_inbox_entries entry
where entry.entry_kind='logic_gate'
  and entry.company_id=$1
  and entry.user_id::text=$2`+roleFilter+`
  and exists (
    select 1
    from effective_resource_access access
    where access.company_id=entry.company_id
      and access.user_id=entry.user_id
      and access.resource_type='logic_gate'
      and access.resource_id=entry.logic_gate_id
      and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($4)
  )
group by entry.company_id, entry.logic_gate_id, entry.logic_gate_header, entry.logic_gate_created_timestamp
order by lower(entry.logic_gate_header) asc, entry.logic_gate_id::text asc
limit $3`, query.CompanyID, query.UserID, query.Limit, EntityPermissionView)
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
  entry.company_id::text,
  entry.logic_gate_id::text,
  entry.role,
  entry.user_id::text,
  nullif(entry.raci_user_display_name, ''),
  nullif(entry.raci_user_email, ''),
  entry.raci_created_timestamp
from work_item_inbox_entries entry
where entry.entry_kind = 'logic_gate'
  and entry.company_id = $1
  and entry.logic_gate_id = any(string_to_array($2, ',')::uuid[])
order by entry.logic_gate_id::text asc,
  case entry.role
    when 'responsible' then 1
    when 'accountable' then 2
    when 'consulted' then 3
    when 'informed' then 4
    else 5
  end,
  lower(coalesce(nullif(entry.raci_user_display_name, ''), nullif(entry.raci_user_email, ''), entry.user_id::text)) asc,
  entry.user_id::text asc`, companyID, strings.Join(logicGateIDs, ","))
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
