package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

func syncPostgresRacioProjectionForNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	if ctx == nil || tx == nil || companyID == "" || nodeID == "" {
		return ErrInvalid
	}
	if _, err := tx.ExecContext(ctx, `
delete from racio_matrix_projection_table
where company_id=$1::uuid
  and resource_type='node'
  and resource_id=$2::uuid`, companyID, nodeID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
with node_row as (
  select
    n.company_id,
    n.node_id,
    n.title,
    coalesce(
      case
        when assignment.is_issue then 'Issue'
        else column_row.title
      end,
      nullif(n.status, '')
    ) as status,
    coalesce(
      case
        when assignment.is_issue then '#ffd400'
        else column_row.item_color
      end,
      nullif(n.status_color, '')
    ) as status_color,
    n.due_date,
    n.priority,
    n.assignee_user_id,
    nullif(assignee.display_name, '') as assignee_display_name,
    nullif(assignee.email, '') as assignee_email,
    n.created_timestamp as resource_created_timestamp,
    assignment.logic_gate_id
  from nodes n
  left join lateral (
    select assignment.*
    from node_logic_gate_assignments assignment
    where assignment.company_id = n.company_id
      and assignment.node_id = n.node_id
    order by assignment.updated_timestamp desc, assignment.created_timestamp desc, assignment.assignment_id desc
    limit 1
  ) assignment on true
  left join kanban_columns column_row
    on column_row.company_id = assignment.company_id
   and column_row.board_id = assignment.compatibility_board_id
   and column_row.column_id = assignment.column_id
  left join company_memberships assignee_membership
    on assignee_membership.company_id = n.company_id
   and assignee_membership.user_id = n.assignee_user_id
  left join users assignee
    on assignee.user_id = assignee_membership.user_id
  where n.company_id=$1::uuid
    and n.node_id=$2::uuid
), projected as (
  select distinct
    node_row.company_id,
    raci.user_id,
    'node'::text as resource_type,
    node_row.node_id as resource_id,
    node_row.logic_gate_id,
    node_row.title as display_title,
    node_row.status,
    node_row.status_color,
    node_row.due_date,
    node_row.priority,
    node_row.assignee_user_id,
    node_row.assignee_display_name,
    node_row.assignee_email,
    node_row.resource_created_timestamp
  from node_row
  join logic_gate_raci_assignments raci
    on raci.company_id=node_row.company_id
   and raci.logic_gate_id=node_row.logic_gate_id
  join company_memberships membership
    on membership.company_id=raci.company_id
   and membership.user_id=raci.user_id
  where node_row.logic_gate_id is not null
  union all
  select
    node_row.company_id,
    node_row.assignee_user_id as user_id,
    'node'::text as resource_type,
    node_row.node_id as resource_id,
    null::uuid as logic_gate_id,
    node_row.title as display_title,
    node_row.status,
    node_row.status_color,
    node_row.due_date,
    node_row.priority,
    node_row.assignee_user_id,
    node_row.assignee_display_name,
    node_row.assignee_email,
    node_row.resource_created_timestamp
  from node_row
  join company_memberships membership
    on membership.company_id=node_row.company_id
   and membership.user_id=node_row.assignee_user_id
  where node_row.logic_gate_id is null
    and node_row.assignee_user_id is not null
)
insert into racio_matrix_projection_table (
  company_id,
  user_id,
  resource_type,
  resource_id,
  logic_gate_id,
  display_title,
  status,
  status_color,
  due_date,
  priority,
  assignee_user_id,
  assignee_display_name,
  assignee_email,
  resource_created_timestamp,
  updated_timestamp
)
select
  company_id,
  user_id,
  resource_type,
  resource_id,
  logic_gate_id,
  display_title,
  status,
  status_color,
  due_date,
  priority,
  assignee_user_id,
  assignee_display_name,
  assignee_email,
  resource_created_timestamp,
  now()
from projected
on conflict (company_id, user_id, resource_type, resource_id)
do update set
  logic_gate_id=excluded.logic_gate_id,
  display_title=excluded.display_title,
  status=excluded.status,
  status_color=excluded.status_color,
  due_date=excluded.due_date,
  priority=excluded.priority,
  assignee_user_id=excluded.assignee_user_id,
  assignee_display_name=excluded.assignee_display_name,
  assignee_email=excluded.assignee_email,
  resource_created_timestamp=excluded.resource_created_timestamp,
  updated_timestamp=now()`, companyID, nodeID)
	return err
}

func syncPostgresRacioProjectionForLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	users, err := postgresRacioProjectionUsersForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return err
	}
	current, err := postgresRacioAssignmentUserIDsTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return err
	}
	for userID := range current {
		users[userID] = true
	}
	return syncPostgresRacioProjectionForLogicGateUsersTx(ctx, tx, companyID, logicGateID, mapKeys(users))
}

func syncPostgresRacioProjectionForLogicGateAssignmentsTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string, before, after []domain.LogicGateRaciAssignment) error {
	users := racioAssignmentUserSet(before)
	for userID := range racioAssignmentUserSet(after) {
		users[userID] = true
	}
	return syncPostgresRacioProjectionForLogicGateUsersTx(ctx, tx, companyID, logicGateID, mapKeys(users))
}

func syncPostgresRacioProjectionForLogicGateUsersTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string, userIDs []string) error {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if ctx == nil || tx == nil || companyID == "" || logicGateID == "" {
		return ErrInvalid
	}
	userIDs = cleanUUIDTextSlice(userIDs)
	sort.Strings(userIDs)
	for _, userID := range userIDs {
		if err := deletePostgresRacioProjectionForLogicGateUserTx(ctx, tx, companyID, logicGateID, userID); err != nil {
			return err
		}
		if err := insertPostgresRacioProjectionForLogicGateUserTx(ctx, tx, companyID, logicGateID, userID); err != nil {
			return err
		}
	}
	return nil
}

func deletePostgresRacioProjectionForLogicGateUserTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID, userID string) error {
	_, err := tx.ExecContext(ctx, `
delete from racio_matrix_projection_table
where company_id=$1::uuid
  and logic_gate_id=$2::uuid
  and user_id=$3::uuid`, companyID, logicGateID, userID)
	return err
}

func insertPostgresRacioProjectionForLogicGateUserTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID, userID string) error {
	_, err := tx.ExecContext(ctx, `
with user_raci as (
  select distinct assignment.user_id
  from logic_gate_raci_assignments assignment
  join company_memberships membership
    on membership.company_id=assignment.company_id
   and membership.user_id=assignment.user_id
  where assignment.company_id=$1::uuid
    and assignment.logic_gate_id=$2::uuid
    and assignment.user_id=$3::uuid
), gate_row as (
  select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
  from logic_gates gate
  join user_raci on true
  where gate.company_id=$1::uuid
    and gate.logic_gate_id=$2::uuid
), node_rows as (
  select
    n.company_id,
    n.node_id,
    n.title,
    coalesce(
      case
        when assignment.is_issue then 'Issue'
        else column_row.title
      end,
      nullif(n.status, '')
    ) as status,
    coalesce(
      case
        when assignment.is_issue then '#ffd400'
        else column_row.item_color
      end,
      nullif(n.status_color, '')
    ) as status_color,
    n.due_date,
    n.priority,
    n.assignee_user_id,
    nullif(assignee.display_name, '') as assignee_display_name,
    nullif(assignee.email, '') as assignee_email,
    n.created_timestamp as resource_created_timestamp,
    assignment.logic_gate_id
  from node_logic_gate_assignments assignment
  join nodes n
    on n.company_id=assignment.company_id
   and n.node_id=assignment.node_id
  left join kanban_columns column_row
    on column_row.company_id = assignment.company_id
   and column_row.board_id = assignment.compatibility_board_id
   and column_row.column_id = assignment.column_id
  left join company_memberships assignee_membership
    on assignee_membership.company_id = n.company_id
   and assignee_membership.user_id = n.assignee_user_id
  left join users assignee
    on assignee.user_id = assignee_membership.user_id
  where assignment.company_id=$1::uuid
    and assignment.logic_gate_id=$2::uuid
)
insert into racio_matrix_projection_table (
  company_id,
  user_id,
  resource_type,
  resource_id,
  logic_gate_id,
  display_title,
  status,
  status_color,
  due_date,
  priority,
  assignee_user_id,
  assignee_display_name,
  assignee_email,
  resource_created_timestamp,
  updated_timestamp
)
select
  gate_row.company_id,
  user_raci.user_id,
  'logic_gate',
  gate_row.logic_gate_id,
  gate_row.logic_gate_id,
  gate_row.header,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  gate_row.created_timestamp,
  now()
from gate_row
join user_raci on true
union all
select
  node_rows.company_id,
  user_raci.user_id,
  'node',
  node_rows.node_id,
  node_rows.logic_gate_id,
  node_rows.title,
  node_rows.status,
  node_rows.status_color,
  node_rows.due_date,
  node_rows.priority,
  node_rows.assignee_user_id,
  node_rows.assignee_display_name,
  node_rows.assignee_email,
  node_rows.resource_created_timestamp,
  now()
from node_rows
join user_raci on true
on conflict (company_id, user_id, resource_type, resource_id)
do update set
  logic_gate_id=excluded.logic_gate_id,
  display_title=excluded.display_title,
  status=excluded.status,
  status_color=excluded.status_color,
  due_date=excluded.due_date,
  priority=excluded.priority,
  assignee_user_id=excluded.assignee_user_id,
  assignee_display_name=excluded.assignee_display_name,
  assignee_email=excluded.assignee_email,
  resource_created_timestamp=excluded.resource_created_timestamp,
  updated_timestamp=now()`, companyID, logicGateID, userID)
	return err
}

func deletePostgresRacioProjectionForLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	_, err := tx.ExecContext(ctx, `
delete from racio_matrix_projection_table
where company_id=$1::uuid
  and logic_gate_id=$2::uuid`, companyID, logicGateID)
	return err
}

func deletePostgresRacioProjectionForNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	_, err := tx.ExecContext(ctx, `
delete from racio_matrix_projection_table
where company_id=$1::uuid
  and resource_type='node'
  and resource_id=$2::uuid`, companyID, nodeID)
	return err
}

func postgresRacioProjectionUsersForLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) (map[string]bool, error) {
	rows, err := tx.QueryContext(ctx, `
select distinct user_id::text
from racio_matrix_projection_table
where company_id=$1::uuid
  and logic_gate_id=$2::uuid`, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := map[string]bool{}
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		userID = strings.TrimSpace(userID)
		if userID != "" {
			users[userID] = true
		}
	}
	return users, rows.Err()
}

func postgresRacioAssignmentUserIDsTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) (map[string]bool, error) {
	rows, err := tx.QueryContext(ctx, `
select distinct assignment.user_id::text
from logic_gate_raci_assignments assignment
join company_memberships membership
  on membership.company_id=assignment.company_id
 and membership.user_id=assignment.user_id
where assignment.company_id=$1::uuid
  and assignment.logic_gate_id=$2::uuid`, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := map[string]bool{}
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		userID = strings.TrimSpace(userID)
		if userID != "" {
			users[userID] = true
		}
	}
	return users, rows.Err()
}
