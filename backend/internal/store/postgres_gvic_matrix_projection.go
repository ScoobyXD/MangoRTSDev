package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const postgresLogicGateGVICUsersCTE = `
logic_gate_GVIC_users as (
  select effective.company_id, effective.resource_id as logic_gate_id, effective.role, effective.user_id
  from resource_gvic_effective_assignments effective
  where effective.resource_type='logic_gate'
)`

var postgresGVICMatrixNodeProjectionCTE = `
with recursive ` + postgresLogicGateGVICUsersCTE + `,
node_row as (
  select
    n.company_id,
    n.node_id,
    n.name as title,
    coalesce(
      case
        when assignment.is_issue then 'Issue'
        when assignment.assignment_id is not null then ` + postgresLogicGateAssignmentStatusTitleSQL + `
      end,
      nullif(n.status, '')
    ) as status,
    n.due_date,
    n.priority,
    n.created_timestamp as resource_created_timestamp,
    assignment.logic_gate_id,
    coalesce(account_snapshot.accounts_json, '[]'::jsonb) as accounts
  from nodes n
  left join lateral (
    select assignment.*
    from node_logic_gate_assignments assignment
    where assignment.company_id = n.company_id
      and assignment.node_id = n.node_id
    order by assignment.updated_timestamp desc, assignment.created_timestamp desc, assignment.assignment_id desc
    limit 1
  ) assignment on true
  ` + postgresAccountSnapshotsForNodeLateralSQL("n") + `
  where n.company_id=$1::uuid
    and n.node_id=$2::uuid
), projected as (
  select distinct
    node_row.company_id,
    gvic.user_id,
    'node'::text as resource_type,
    node_row.node_id as resource_id,
    node_row.logic_gate_id,
    node_row.title as display_title,
    node_row.status,
    node_row.due_date,
    node_row.priority,
    node_row.resource_created_timestamp,
    node_row.accounts
  from node_row
  join resource_gvic_effective_assignments gvic
    on gvic.company_id=node_row.company_id
   and gvic.resource_type='node'
   and gvic.resource_id=node_row.node_id
)`

var postgresGVICMatrixLogicGateUserProjectionCTE = `
with recursive ` + postgresLogicGateGVICUsersCTE + `,
user_GVIC as (
  select distinct assignment.user_id
  from logic_gate_GVIC_users assignment
  where assignment.company_id=$1::uuid
    and assignment.logic_gate_id=$2::uuid
    and assignment.user_id=$3::uuid
), gate_row as (
  select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
  from logic_gates gate
  join user_GVIC on true
  where gate.company_id=$1::uuid
    and gate.logic_gate_id=$2::uuid
), node_rows as (
  select
    n.company_id,
    n.node_id,
    n.name as title,
    coalesce(
      case
        when assignment.is_issue then 'Issue'
        when assignment.assignment_id is not null then ` + postgresLogicGateAssignmentStatusTitleSQL + `
      end,
      nullif(n.status, '')
    ) as status,
    n.due_date,
    n.priority,
    n.created_timestamp as resource_created_timestamp,
    assignment.logic_gate_id,
    coalesce(account_snapshot.accounts_json, '[]'::jsonb) as accounts
  from node_logic_gate_assignments assignment
  join nodes n
    on n.company_id=assignment.company_id
   and n.node_id=assignment.node_id
  ` + postgresAccountSnapshotsForNodeLateralSQL("n") + `
  where assignment.company_id=$1::uuid
    and assignment.logic_gate_id=$2::uuid
), projected as (
  select
    gate_row.company_id,
    user_GVIC.user_id,
    'logic_gate'::text as resource_type,
    gate_row.logic_gate_id as resource_id,
    gate_row.logic_gate_id,
    gate_row.header as display_title,
    null::text as status,
    null::date as due_date,
    null::smallint as priority,
    gate_row.created_timestamp as resource_created_timestamp,
    '[]'::jsonb as accounts
  from gate_row
  join user_GVIC on true
  union all
  select
    node_rows.company_id,
    user_GVIC.user_id,
    'node'::text as resource_type,
    node_rows.node_id as resource_id,
    node_rows.logic_gate_id,
    node_rows.title as display_title,
    node_rows.status,
    node_rows.due_date,
    node_rows.priority,
    node_rows.resource_created_timestamp,
    node_rows.accounts
  from node_rows
  join user_GVIC on true
)`

func syncPostgresGVICMatrixProjectionForNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	defer observeTiming(ctx, "repo.syncPostgresGVICMatrixProjectionForNodeTx.total")()
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	if ctx == nil || tx == nil || companyID == "" || nodeID == "" {
		return ErrInvalid
	}
	stop := observeTiming(ctx, "repo.syncPostgresGVICMatrixProjectionForNodeTx.delete_stale")
	if _, err := tx.ExecContext(ctx, postgresGVICMatrixNodeProjectionCTE+`
delete from gvic_matrix_projection_table entry
where entry.company_id=$1::uuid
  and entry.resource_type='node'
  and entry.resource_id=$2::uuid
  and not exists (
    select 1
    from projected
    where projected.company_id=entry.company_id
      and projected.user_id=entry.user_id
      and projected.resource_type=entry.resource_type
      and projected.resource_id=entry.resource_id
  )`, companyID, nodeID); err != nil {
		stop()
		return err
	}
	stop()
	return upsertPostgresGVICMatrixProjectionForNodeTx(ctx, tx, companyID, nodeID)
}

func syncPostgresGVICMatrixProjectionForNodeDeltasTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) ([]ProjectionDelta, error) {
	before, err := postgresGVICMatrixProjectionRowsForResourcesTx(ctx, tx, companyID, []string{nodeID}, nil)
	if err != nil {
		return nil, err
	}
	if err := syncPostgresGVICMatrixProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
		return nil, err
	}
	after, err := postgresGVICMatrixProjectionRowsForResourcesTx(ctx, tx, companyID, []string{nodeID}, nil)
	if err != nil {
		return nil, err
	}
	return diffGVICMatrixProjectionRows(before, after), nil
}

func syncPostgresGVICMatrixProjectionForNewNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	defer observeTiming(ctx, "repo.syncPostgresGVICMatrixProjectionForNodeTx.total")()
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	if ctx == nil || tx == nil || companyID == "" || nodeID == "" {
		return ErrInvalid
	}
	return upsertPostgresGVICMatrixProjectionForNodeTx(ctx, tx, companyID, nodeID)
}

func syncPostgresGVICMatrixProjectionForNewNodeDeltasTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) ([]ProjectionDelta, error) {
	before, err := postgresGVICMatrixProjectionRowsForResourcesTx(ctx, tx, companyID, []string{nodeID}, nil)
	if err != nil {
		return nil, err
	}
	if err := syncPostgresGVICMatrixProjectionForNewNodeTx(ctx, tx, companyID, nodeID); err != nil {
		return nil, err
	}
	after, err := postgresGVICMatrixProjectionRowsForResourcesTx(ctx, tx, companyID, []string{nodeID}, nil)
	if err != nil {
		return nil, err
	}
	return diffGVICMatrixProjectionRows(before, after), nil
}

func upsertPostgresGVICMatrixProjectionForNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	stop := observeTiming(ctx, "repo.syncPostgresGVICMatrixProjectionForNodeTx.upsert")
	_, err := tx.ExecContext(ctx, postgresGVICMatrixNodeProjectionCTE+`
insert into gvic_matrix_projection_table (
  company_id,
  user_id,
  resource_type,
  resource_id,
  logic_gate_id,
  display_title,
  status,
  due_date,
  priority,
  resource_created_timestamp,
  accounts,
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
  due_date,
  priority,
  resource_created_timestamp,
  accounts,
  now()
from projected
on conflict (company_id, user_id, resource_type, resource_id)
do update set
  logic_gate_id=excluded.logic_gate_id,
  display_title=excluded.display_title,
  status=excluded.status,
  due_date=excluded.due_date,
  priority=excluded.priority,
  resource_created_timestamp=excluded.resource_created_timestamp,
  accounts=excluded.accounts,
  updated_timestamp=now()`, companyID, nodeID)
	stop()
	return err
}

func syncPostgresGVICMatrixProjectionForLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	users, err := postgresGVICMatrixProjectionUsersForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return err
	}
	current, err := postgresGVICMatrixAssignmentUserIDsTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return err
	}
	for userID := range current {
		users[userID] = true
	}
	return syncPostgresGVICMatrixProjectionForLogicGateUsersTx(ctx, tx, companyID, logicGateID, mapKeys(users))
}

func syncPostgresGVICMatrixProjectionForLogicGateAssignmentsTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string, before, after []domain.LogicGateGVICAssignment) error {
	return syncPostgresGVICMatrixProjectionForLogicGateTx(ctx, tx, companyID, logicGateID)
}

func syncPostgresGVICMatrixProjectionForLogicGateAssignmentsDeltasTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string, before, after []domain.LogicGateGVICAssignment) ([]ProjectionDelta, error) {
	beforeRows, err := postgresGVICMatrixProjectionRowsForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	if err := syncPostgresGVICMatrixProjectionForLogicGateAssignmentsTx(ctx, tx, companyID, logicGateID, before, after); err != nil {
		return nil, err
	}
	afterRows, err := postgresGVICMatrixProjectionRowsForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	return diffGVICMatrixProjectionRows(beforeRows, afterRows), nil
}

func syncPostgresGVICMatrixProjectionForLogicGateUsersTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string, userIDs []string) error {
	defer observeTiming(ctx, "repo.syncPostgresGVICMatrixProjectionForLogicGateUsersTx.total")()
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if ctx == nil || tx == nil || companyID == "" || logicGateID == "" {
		return ErrInvalid
	}
	userIDs = cleanUUIDTextSlice(userIDs)
	sort.Strings(userIDs)
	for _, userID := range userIDs {
		if err := deleteStalePostgresGVICMatrixProjectionForLogicGateUserTx(ctx, tx, companyID, logicGateID, userID); err != nil {
			return err
		}
		if err := upsertPostgresGVICMatrixProjectionForLogicGateUserTx(ctx, tx, companyID, logicGateID, userID); err != nil {
			return err
		}
	}
	return nil
}

func deleteStalePostgresGVICMatrixProjectionForLogicGateUserTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID, userID string) error {
	defer observeTiming(ctx, "repo.deleteStalePostgresGVICMatrixProjectionForLogicGateUserTx")()
	_, err := tx.ExecContext(ctx, postgresGVICMatrixLogicGateUserProjectionCTE+`
delete from gvic_matrix_projection_table entry
where entry.company_id=$1::uuid
  and entry.logic_gate_id=$2::uuid
  and entry.user_id=$3::uuid
  and entry.resource_type in ('logic_gate', 'node')
  and not exists (
    select 1
    from projected
    where projected.company_id=entry.company_id
      and projected.user_id=entry.user_id
      and projected.resource_type=entry.resource_type
      and projected.resource_id=entry.resource_id
  )`, companyID, logicGateID, userID)
	return err
}

func upsertPostgresGVICMatrixProjectionForLogicGateUserTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID, userID string) error {
	defer observeTiming(ctx, "repo.upsertPostgresGVICMatrixProjectionForLogicGateUserTx")()
	_, err := tx.ExecContext(ctx, postgresGVICMatrixLogicGateUserProjectionCTE+`
insert into gvic_matrix_projection_table (
  company_id,
  user_id,
  resource_type,
  resource_id,
  logic_gate_id,
  display_title,
  status,
  due_date,
  priority,
  resource_created_timestamp,
  accounts,
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
  due_date,
  priority,
  resource_created_timestamp,
  accounts,
  now()
from projected
on conflict (company_id, user_id, resource_type, resource_id)
do update set
  logic_gate_id=excluded.logic_gate_id,
  display_title=excluded.display_title,
  status=excluded.status,
  due_date=excluded.due_date,
  priority=excluded.priority,
  resource_created_timestamp=excluded.resource_created_timestamp,
  accounts=excluded.accounts,
  updated_timestamp=now()`, companyID, logicGateID, userID)
	return err
}

func deletePostgresGVICMatrixProjectionForLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	_, err := tx.ExecContext(ctx, `
delete from gvic_matrix_projection_table
where company_id=$1::uuid
  and logic_gate_id=$2::uuid`, companyID, logicGateID)
	return err
}

func deletePostgresGVICMatrixProjectionForNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	_, err := tx.ExecContext(ctx, `
delete from gvic_matrix_projection_table
where company_id=$1::uuid
  and resource_type='node'
  and resource_id=$2::uuid`, companyID, nodeID)
	return err
}

func (r *PostgresRepo) ListGVICMatrixProjectionRowsForResources(companyID string, nodeIDs, logicGateIDs []string) ([]GVICMatrixProjectionRow, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := postgresGVICMatrixProjectionRowsForResourcesTx(ctx, tx, companyID, nodeIDs, logicGateIDs)
	if err != nil {
		return nil, err
	}
	return rows, tx.Commit()
}

func (r *PostgresRepo) ListGVICMatrixProjectionRowsForLogicGate(companyID, logicGateID string) ([]GVICMatrixProjectionRow, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := postgresGVICMatrixProjectionRowsForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	return rows, tx.Commit()
}

func (r *PostgresRepo) ListGVICMatrixProjectionRowsForUser(query WorkItemInboxQuery) ([]GVICMatrixProjectionRow, error) {
	query = NormalizeWorkItemInboxQuery(query)
	companyID := cleanUUIDText(query.CompanyID)
	userID := cleanUUIDText(query.UserID)
	viewerUserID := cleanUUIDText(query.ViewerUserID)
	if companyID == "" || userID == "" || viewerUserID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select entry.company_id::text,
       entry.user_id::text,
       entry.resource_type,
       entry.resource_id::text,
       entry.logic_gate_id::text,
       entry.display_title,
       entry.status,
       entry.due_date::text,
       entry.priority,
       entry.accounts::text,
       entry.resource_created_timestamp,
       entry.updated_timestamp
from gvic_matrix_projection_table entry
where entry.company_id=$1::uuid
  and entry.user_id=$2::uuid
  and entry.resource_type in ('node', 'logic_gate')
  and mangorts_user_can_access_resource(entry.company_id, entry.resource_type, entry.resource_id, $4::uuid, 'edit')
order by entry.resource_type asc, entry.resource_created_timestamp asc, entry.resource_id::text asc
limit $3`, companyID, userID, query.Limit, viewerUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]GVICMatrixProjectionRow, 0)
	for rows.Next() {
		item, err := scanGVICMatrixProjectionRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListMyWorkMatrixRows(query WorkItemInboxQuery) ([]GVICMatrixProjectionRow, error) {
	query = NormalizeWorkItemInboxQuery(query)
	companyID := cleanUUIDText(query.CompanyID)
	userID := cleanUUIDText(query.UserID)
	viewerUserID := cleanUUIDText(query.ViewerUserID)
	if companyID == "" || userID == "" || viewerUserID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
with base as (
  select
    entry.company_id,
    entry.user_id,
    entry.resource_type,
    entry.resource_id,
    entry.logic_gate_id,
    entry.display_title,
    entry.status,
    entry.due_date,
    entry.priority,
    entry.accounts,
    entry.resource_created_timestamp,
    entry.updated_timestamp,
    effective.role
  from gvic_matrix_projection_table entry
  join resource_gvic_effective_assignments effective
    on effective.company_id=entry.company_id
   and effective.resource_type=entry.resource_type
   and effective.resource_id=entry.resource_id
   and effective.user_id=entry.user_id
  where entry.company_id=$1::uuid
    and entry.user_id=$2::uuid
    and entry.resource_type in ('node', 'logic_gate')
    and effective.role in ('generated', 'verified', 'consulted', 'informed')
    and mangorts_user_can_access_resource(entry.company_id, entry.resource_type, entry.resource_id, $3::uuid, 'edit')
), project_matches as (
  select distinct on (
    base.company_id,
    base.user_id,
    base.resource_type,
    base.resource_id,
    base.role,
    relationship.project_id,
    relationship.relationship_id
  )
    base.*,
    project.project_id::text as project_id,
    project.name as project_name,
    lower(regexp_replace(coalesce(project.status, ''), '[\s_-]+', '_', 'g')) in ('done', 'complete', 'completed', 'closed', 'archived') as project_done,
    relationship.position,
    relationship.relationship_created_timestamp,
    relationship.relationship_id::text
  from base
  join project_relationship_projection relationship
    on relationship.company_id=base.company_id
   and (
     (base.resource_type='logic_gate' and relationship.logic_gate_id=base.resource_id)
     or (
       base.resource_type='node'
       and (
         relationship.node_id=base.resource_id
         or (base.logic_gate_id is not null and relationship.logic_gate_id=base.logic_gate_id)
       )
     )
   )
  join projects project
    on project.company_id=relationship.company_id
   and project.project_id=relationship.project_id
  order by
    base.company_id,
    base.user_id,
    base.resource_type,
    base.resource_id,
    base.role,
    relationship.project_id,
    relationship.relationship_id,
    relationship.position asc,
    relationship.relationship_created_timestamp asc
), active_project_rows as (
  select *
  from project_matches
  where not project_done
), no_project_rows as (
  select
    base.*,
    null::text as project_id,
    null::text as project_name,
    0 as position,
    base.resource_created_timestamp as relationship_created_timestamp,
    ''::text as relationship_id
  from base
  where not exists (
    select 1
    from project_matches match
    where match.company_id=base.company_id
      and match.user_id=base.user_id
      and match.resource_type=base.resource_type
      and match.resource_id=base.resource_id
      and match.role=base.role
  )
    and (
      base.resource_type='logic_gate'
      or lower(regexp_replace(coalesce(base.status, ''), '[\s_-]+', '_', 'g')) not in ('done', 'complete', 'completed', 'closed', 'archived')
    )
), rows as (
  select
    company_id,
    user_id,
    resource_type,
    resource_id,
    logic_gate_id,
    display_title,
    status,
    due_date,
    priority,
    accounts,
    resource_created_timestamp,
    updated_timestamp,
    role,
    project_id,
    project_name,
    position,
    relationship_created_timestamp,
    relationship_id
  from active_project_rows
  union all
  select
    company_id,
    user_id,
    resource_type,
    resource_id,
    logic_gate_id,
    display_title,
    status,
    due_date,
    priority,
    accounts,
    resource_created_timestamp,
    updated_timestamp,
    role,
    project_id,
    project_name,
    position,
    relationship_created_timestamp,
    relationship_id
  from no_project_rows
)
select
  rows.company_id::text,
  rows.user_id::text,
  rows.resource_type,
  rows.resource_id::text,
  rows.logic_gate_id::text,
  rows.display_title,
  rows.status,
  rows.due_date::text,
  rows.priority,
  rows.accounts::text,
  rows.resource_created_timestamp,
  rows.updated_timestamp,
  rows.role,
  rows.project_id,
  rows.project_name
from rows
order by
  case rows.role
    when 'generated' then 1
    when 'verified' then 2
    when 'consulted' then 3
    when 'informed' then 4
    else 5
  end,
  coalesce(rows.priority, 6) asc,
  lower(coalesce(rows.project_name, '')) asc,
  lower(rows.display_title) asc,
  rows.resource_type asc,
  rows.resource_id::text asc,
  rows.relationship_created_timestamp asc,
  rows.relationship_id asc`, companyID, userID, viewerUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]GVICMatrixProjectionRow, 0)
	for rows.Next() {
		item, err := scanMyWorkMatrixRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func postgresGVICMatrixProjectionRowsForResourcesTx(ctx context.Context, tx *sql.Tx, companyID string, nodeIDs, logicGateIDs []string) ([]GVICMatrixProjectionRow, error) {
	companyID = cleanUUIDText(companyID)
	nodeIDs = cleanUUIDTextSlice(nodeIDs)
	logicGateIDs = cleanUUIDTextSlice(logicGateIDs)
	if ctx == nil || tx == nil || companyID == "" {
		return nil, ErrInvalid
	}
	if len(nodeIDs) == 0 && len(logicGateIDs) == 0 {
		return []GVICMatrixProjectionRow{}, nil
	}
	rows, err := tx.QueryContext(ctx, `
select company_id::text,
       user_id::text,
       resource_type,
       resource_id::text,
       logic_gate_id::text,
       display_title,
       status,
       due_date::text,
       priority,
       accounts::text,
       resource_created_timestamp,
       updated_timestamp
from gvic_matrix_projection_table
where company_id=$1::uuid
  and (
    ($2 <> '' and resource_type='node' and resource_id = any(string_to_array($2, ',')::uuid[]))
    or ($3 <> '' and resource_type='logic_gate' and resource_id = any(string_to_array($3, ',')::uuid[]))
  )
order by resource_type asc, resource_id::text asc, user_id::text asc`,
		companyID, strings.Join(nodeIDs, ","), strings.Join(logicGateIDs, ","))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]GVICMatrixProjectionRow, 0)
	for rows.Next() {
		item, err := scanGVICMatrixProjectionRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func postgresGVICMatrixProjectionRowsForLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) ([]GVICMatrixProjectionRow, error) {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if ctx == nil || tx == nil || companyID == "" || logicGateID == "" {
		return nil, ErrInvalid
	}
	rows, err := tx.QueryContext(ctx, `
select company_id::text,
       user_id::text,
       resource_type,
       resource_id::text,
       logic_gate_id::text,
       display_title,
       status,
       due_date::text,
       priority,
       accounts::text,
       resource_created_timestamp,
       updated_timestamp
from gvic_matrix_projection_table
where company_id=$1::uuid
  and logic_gate_id=$2::uuid
order by resource_type asc, resource_id::text asc, user_id::text asc`, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]GVICMatrixProjectionRow, 0)
	for rows.Next() {
		item, err := scanGVICMatrixProjectionRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanGVICMatrixProjectionRow(row interface{ Scan(dest ...any) error }) (GVICMatrixProjectionRow, error) {
	var item GVICMatrixProjectionRow
	var logicGateID sql.NullString
	var status sql.NullString
	var dueDate sql.NullString
	var priority sql.NullInt64
	var accountsJSON sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.UserID,
		&item.ResourceType,
		&item.ResourceID,
		&logicGateID,
		&item.DisplayTitle,
		&status,
		&dueDate,
		&priority,
		&accountsJSON,
		&item.ResourceCreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if logicGateID.Valid {
		item.LogicGateID = &logicGateID.String
	}
	if status.Valid {
		item.Status = &status.String
	}
	if dueDate.Valid {
		item.DueDate = &dueDate.String
	}
	if priority.Valid {
		value := int(priority.Int64)
		item.Priority = &value
	}
	item.Accounts = scanAccountSnapshotsJSON(accountsJSON)
	return item, err
}

func scanMyWorkMatrixRow(row interface{ Scan(dest ...any) error }) (GVICMatrixProjectionRow, error) {
	var item GVICMatrixProjectionRow
	var logicGateID sql.NullString
	var status sql.NullString
	var dueDate sql.NullString
	var priority sql.NullInt64
	var accountsJSON sql.NullString
	var role sql.NullString
	var projectID sql.NullString
	var projectName sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.UserID,
		&item.ResourceType,
		&item.ResourceID,
		&logicGateID,
		&item.DisplayTitle,
		&status,
		&dueDate,
		&priority,
		&accountsJSON,
		&item.ResourceCreatedTimestamp,
		&item.UpdatedTimestamp,
		&role,
		&projectID,
		&projectName,
	)
	if logicGateID.Valid {
		item.LogicGateID = &logicGateID.String
	}
	if status.Valid {
		item.Status = &status.String
	}
	if dueDate.Valid {
		item.DueDate = &dueDate.String
	}
	if priority.Valid {
		value := int(priority.Int64)
		item.Priority = &value
	}
	if role.Valid {
		item.Role = role.String
	}
	if projectID.Valid {
		item.ProjectID = projectID.String
	}
	if projectName.Valid {
		item.ProjectName = projectName.String
	}
	item.Accounts = scanAccountSnapshotsJSON(accountsJSON)
	return item, err
}

func (r *PostgresRepo) CurrentProjectionSequence(companyID, projectionName, projectionScope string) (int64, error) {
	companyID = cleanUUIDText(companyID)
	projectionName = strings.TrimSpace(projectionName)
	projectionScope = strings.TrimSpace(projectionScope)
	if companyID == "" || projectionName == "" {
		return 0, ErrInvalid
	}
	var sequence int64
	err := r.db.QueryRowContext(context.Background(), `
select coalesce((
  select sequence
  from company_projection_sequences
  where company_id=$1::uuid
    and projection_name=$2::text
    and projection_scope=$3::text
), 0)`, companyID, projectionName, projectionScope).Scan(&sequence)
	return sequence, err
}

func (r *PostgresRepo) NextProjectionSequence(companyID, projectionName, projectionScope string) (int64, error) {
	companyID = cleanUUIDText(companyID)
	projectionName = strings.TrimSpace(projectionName)
	projectionScope = strings.TrimSpace(projectionScope)
	if companyID == "" || projectionName == "" {
		return 0, ErrInvalid
	}
	var sequence int64
	err := r.db.QueryRowContext(context.Background(), `
insert into company_projection_sequences (company_id, projection_name, projection_scope, sequence, updated_timestamp)
values ($1::uuid, $2::text, $3::text, 1, now())
on conflict (company_id, projection_name, projection_scope)
do update set sequence=company_projection_sequences.sequence + 1,
              updated_timestamp=now()
returning sequence`, companyID, projectionName, projectionScope).Scan(&sequence)
	return sequence, err
}

func postgresGVICMatrixProjectionUsersForLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) (map[string]bool, error) {
	rows, err := tx.QueryContext(ctx, `
select distinct user_id::text
from gvic_matrix_projection_table
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

func postgresGVICMatrixAssignmentUserIDsTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) (map[string]bool, error) {
	rows, err := tx.QueryContext(ctx, `
with recursive `+postgresLogicGateGVICUsersCTE+`
select distinct assignment.user_id::text
from logic_gate_GVIC_users assignment
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
