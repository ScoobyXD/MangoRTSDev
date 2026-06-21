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
with latest_assignment as (
  select distinct on (assignment.company_id, assignment.node_id)
    assignment.*
  from node_logic_gate_assignments assignment
  where assignment.company_id=$1::uuid
    and assignment.node_id=$2::uuid
  order by
    assignment.company_id,
    assignment.node_id,
    assignment.updated_timestamp desc,
    assignment.created_timestamp desc,
    assignment.assignment_id desc
), node_row as (
  select
    node.company_id,
    node.node_id,
    node.name as node_name,
    coalesce(
      case
        when assignment.is_issue then 'Issue'
        when assignment.assignment_id is not null then ` + postgresLogicGateAssignmentStatusTitleSQL + `
      end,
      nullif(node.status, '')
    ) as status,
    node.due_date,
    node.priority,
    node.created_timestamp as node_created_timestamp,
    assignment.logic_gate_id,
    gate.header as logic_gate_name,
    gate.created_timestamp as logic_gate_created_timestamp,
    coalesce(account_snapshot.accounts_json, '[]'::jsonb) as accounts
  from nodes node
  left join latest_assignment assignment
    on assignment.company_id=node.company_id
   and assignment.node_id=node.node_id
  left join logic_gates gate
    on gate.company_id=node.company_id
   and gate.logic_gate_id=assignment.logic_gate_id
  ` + postgresAccountSnapshotsForNodeLateralSQL("node") + `
  where node.company_id=$1::uuid
    and node.node_id=$2::uuid
), assignment_rows as (
  select distinct
    node_row.company_id,
    effective.user_id,
    effective.role as gvic_assignment,
    node_row.node_id,
    node_row.node_name,
    node_row.status,
    node_row.due_date,
    node_row.priority,
    node_row.node_created_timestamp,
    node_row.logic_gate_id,
    node_row.logic_gate_name,
    node_row.logic_gate_created_timestamp,
    node_row.accounts
  from node_row
  join resource_gvic_effective_assignments effective
    on effective.company_id=node_row.company_id
   and (
     (node_row.logic_gate_id is not null and effective.resource_type='logic_gate' and effective.resource_id=node_row.logic_gate_id)
     or (node_row.logic_gate_id is null and effective.resource_type='node' and effective.resource_id=node_row.node_id)
   )
  where effective.role in ('generated', 'verified', 'consulted', 'informed')
), project_matches as (
  select distinct on (
    assignment_rows.company_id,
    assignment_rows.user_id,
    assignment_rows.gvic_assignment,
    assignment_rows.priority,
    assignment_rows.node_id,
    assignment_rows.logic_gate_id,
    project.project_id
  )
    assignment_rows.company_id,
    assignment_rows.user_id,
    assignment_rows.gvic_assignment,
    assignment_rows.priority,
    assignment_rows.node_id,
    assignment_rows.node_name,
    assignment_rows.status,
    assignment_rows.due_date,
    assignment_rows.node_created_timestamp,
    assignment_rows.logic_gate_id,
    assignment_rows.logic_gate_name,
    assignment_rows.logic_gate_created_timestamp,
    assignment_rows.accounts,
    project.project_id,
    project.name as project_name,
    relationship.position as project_position,
    relationship.relationship_created_timestamp,
    lower(regexp_replace(coalesce(project.status, ''), '[\s_-]+', '_', 'g')) in ('done', 'complete', 'completed', 'closed', 'archived') as project_done
  from assignment_rows
  join project_relationship_projection relationship
    on relationship.company_id=assignment_rows.company_id
   and (
     relationship.node_id=assignment_rows.node_id
     or (assignment_rows.logic_gate_id is not null and relationship.logic_gate_id=assignment_rows.logic_gate_id)
   )
  join projects project
    on project.company_id=relationship.company_id
   and project.project_id=relationship.project_id
  order by
    assignment_rows.company_id,
    assignment_rows.user_id,
    assignment_rows.gvic_assignment,
    assignment_rows.priority,
    assignment_rows.node_id,
    assignment_rows.logic_gate_id,
    project.project_id,
    relationship.position asc,
    relationship.relationship_created_timestamp asc,
    relationship.relationship_id asc
), leaf_contexts as (
  select
    company_id,
    user_id,
    gvic_assignment,
    priority,
    node_id,
    node_name,
    status,
    due_date,
    node_created_timestamp,
    logic_gate_id,
    logic_gate_name,
    logic_gate_created_timestamp,
    accounts,
    project_id,
    project_name,
    project_position,
    relationship_created_timestamp
  from project_matches
  where not project_done
  union all
  select
    assignment_rows.company_id,
    assignment_rows.user_id,
    assignment_rows.gvic_assignment,
    assignment_rows.priority,
    assignment_rows.node_id,
    assignment_rows.node_name,
    assignment_rows.status,
    assignment_rows.due_date,
    assignment_rows.node_created_timestamp,
    assignment_rows.logic_gate_id,
    assignment_rows.logic_gate_name,
    assignment_rows.logic_gate_created_timestamp,
    assignment_rows.accounts,
    null::uuid as project_id,
    null::text as project_name,
    null::integer as project_position,
    null::timestamptz as relationship_created_timestamp
  from assignment_rows
  where not exists (
    select 1
    from project_matches match
    where match.company_id=assignment_rows.company_id
      and match.user_id=assignment_rows.user_id
      and match.gvic_assignment=assignment_rows.gvic_assignment
      and match.priority is not distinct from assignment_rows.priority
      and match.node_id=assignment_rows.node_id
      and match.logic_gate_id is not distinct from assignment_rows.logic_gate_id
  )
    and lower(regexp_replace(coalesce(assignment_rows.status, ''), '[\s_-]+', '_', 'g')) not in ('done', 'complete', 'completed', 'closed', 'archived')
), projected as (
  select
    company_id,
    concat_ws(
      ':',
      'my_work_node_leaf',
      company_id::text,
      user_id::text,
      gvic_assignment,
      coalesce(priority::text, 'none'),
      'node',
      node_id::text,
      'project',
      coalesce(project_id::text, 'none'),
      'logic_gate',
      coalesce(logic_gate_id::text, 'none')
    ) as projection_row_id,
    user_id,
    node_name,
    gvic_assignment,
    priority,
    project_id,
    project_name,
    logic_gate_id,
    logic_gate_name,
    node_id,
    status,
    due_date,
    accounts,
    node_created_timestamp as created_timestamp,
    now() as updated_timestamp,
    row_number() over (
      partition by company_id, user_id, gvic_assignment, priority
      order by
        coalesce(project_position, 2147483647),
        lower(coalesce(project_name, '')),
        relationship_created_timestamp nulls last,
        lower(coalesce(logic_gate_name, '')),
        logic_gate_created_timestamp nulls last,
        lower(node_name),
        node_created_timestamp,
        node_id::text,
        coalesce(project_id::text, ''),
        coalesce(logic_gate_id::text, '')
    )::integer as sort_order
  from leaf_contexts
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
  and entry.node_id=$2::uuid
  and not exists (
    select 1
    from projected
    where projected.company_id=entry.company_id
      and projected.projection_row_id=entry.projection_row_id
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
  projection_row_id,
  user_id,
  node_name,
  gvic_assignment,
  priority,
  project_id,
  project_name,
  logic_gate_id,
  logic_gate_name,
  node_id,
  status,
  due_date,
  accounts,
  created_timestamp,
  updated_timestamp,
  sort_order
)
select
  company_id,
  projection_row_id,
  user_id,
  node_name,
  gvic_assignment,
  priority,
  project_id,
  project_name,
  logic_gate_id,
  logic_gate_name,
  node_id,
  status,
  due_date,
  accounts,
  created_timestamp,
  updated_timestamp,
  sort_order
from projected
on conflict (company_id, projection_row_id)
do update set
  user_id=excluded.user_id,
  node_name=excluded.node_name,
  gvic_assignment=excluded.gvic_assignment,
  priority=excluded.priority,
  project_id=excluded.project_id,
  project_name=excluded.project_name,
  logic_gate_id=excluded.logic_gate_id,
  logic_gate_name=excluded.logic_gate_name,
  node_id=excluded.node_id,
  status=excluded.status,
  due_date=excluded.due_date,
  accounts=excluded.accounts,
  created_timestamp=excluded.created_timestamp,
  sort_order=excluded.sort_order,
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
		if _, err := tx.ExecContext(ctx, `
delete from gvic_matrix_projection_table
where company_id=$1::uuid
  and logic_gate_id=$2::uuid
  and user_id=$3::uuid`, companyID, logicGateID, userID); err != nil {
			return err
		}
	}
	nodeIDs, err := postgresNodeIDsForLogicGateProjectionSyncTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return err
	}
	for _, nodeID := range nodeIDs {
		if err := syncPostgresGVICMatrixProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
			return err
		}
	}
	return nil
}

func postgresNodeIDsForLogicGateProjectionSyncTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `
select node_id::text
from node_logic_gate_assignments
where company_id=$1::uuid
  and logic_gate_id=$2::uuid
order by node_id::text`, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var nodeID string
		if err := rows.Scan(&nodeID); err != nil {
			return nil, err
		}
		nodeID = strings.TrimSpace(nodeID)
		if nodeID != "" {
			out = append(out, nodeID)
		}
	}
	return out, rows.Err()
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
  and node_id=$2::uuid`, companyID, nodeID)
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
       entry.projection_row_id,
       entry.user_id::text,
       entry.node_name,
       entry.gvic_assignment,
       entry.priority,
       entry.project_id::text,
       entry.project_name,
       entry.logic_gate_id::text,
       entry.logic_gate_name,
       entry.node_id::text,
       entry.status,
       entry.due_date::text,
       entry.accounts::text,
       entry.created_timestamp,
       entry.updated_timestamp,
       entry.sort_order
from gvic_matrix_projection_table entry
where entry.company_id=$1::uuid
  and entry.user_id=$2::uuid
  and entry.gvic_assignment in ('generated', 'verified', 'consulted', 'informed')
  and mangorts_user_can_access_resource(entry.company_id, 'node', entry.node_id, $4::uuid, 'edit')
  and (entry.logic_gate_id is null or mangorts_user_can_access_resource(entry.company_id, 'logic_gate', entry.logic_gate_id, $4::uuid, 'view'))
  and (entry.project_id is null or mangorts_user_can_access_resource(entry.company_id, 'project', entry.project_id, $4::uuid, 'view'))
order by entry.gvic_assignment asc, coalesce(entry.priority, 6) asc, entry.sort_order asc, entry.projection_row_id asc
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
	companyID := cleanUUIDText(query.CompanyID)
	userID := cleanUUIDText(query.UserID)
	viewerUserID := cleanUUIDText(query.ViewerUserID)
	limit := query.Limit
	if companyID == "" || userID == "" || viewerUserID == "" || limit < 0 {
		return nil, ErrInvalid
	}
	if limit > WorkItemInboxMaxLimit {
		limit = WorkItemInboxMaxLimit
	}
	rows, err := r.db.QueryContext(context.Background(), `
select entry.company_id::text,
       entry.projection_row_id,
       entry.user_id::text,
       entry.node_name,
       entry.gvic_assignment,
       entry.priority,
       entry.project_id::text,
       entry.project_name,
       entry.logic_gate_id::text,
       entry.logic_gate_name,
       entry.node_id::text,
       entry.status,
       entry.due_date::text,
       entry.accounts::text,
       entry.created_timestamp,
       entry.updated_timestamp,
       entry.sort_order
from gvic_matrix_projection_table entry
where entry.company_id=$1::uuid
  and entry.user_id=$2::uuid
  and entry.gvic_assignment in ('generated', 'verified', 'consulted', 'informed')
  and mangorts_user_can_access_resource(entry.company_id, 'node', entry.node_id, $3::uuid, 'edit')
  and (entry.logic_gate_id is null or mangorts_user_can_access_resource(entry.company_id, 'logic_gate', entry.logic_gate_id, $3::uuid, 'view'))
  and (entry.project_id is null or mangorts_user_can_access_resource(entry.company_id, 'project', entry.project_id, $3::uuid, 'view'))
order by entry.gvic_assignment asc, coalesce(entry.priority, 6) asc, entry.sort_order asc, entry.projection_row_id asc
limit nullif($4, 0)`, companyID, userID, viewerUserID, limit)
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

func (r *PostgresRepo) ListMyWorkMatrix(query WorkItemInboxQuery) (MyWorkMatrixResponse, error) {
	companyID := cleanUUIDText(query.CompanyID)
	userID := cleanUUIDText(query.UserID)
	viewerUserID := cleanUUIDText(query.ViewerUserID)
	if companyID == "" || userID == "" || viewerUserID == "" {
		return MyWorkMatrixResponse{}, ErrInvalid
	}
	rows, err := r.ListMyWorkMatrixRows(query)
	if err != nil {
		return MyWorkMatrixResponse{}, err
	}
	return MyWorkMatrixResponse{CompanyID: query.CompanyID, UserID: query.UserID, Rows: rows}, nil
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
	return postgresGVICMatrixProjectionRowsForQueryTx(ctx, tx, `
select company_id::text,
       projection_row_id,
       user_id::text,
       node_name,
       gvic_assignment,
       priority,
       project_id::text,
       project_name,
       logic_gate_id::text,
       logic_gate_name,
       node_id::text,
       status,
       due_date::text,
       accounts::text,
       created_timestamp,
       updated_timestamp,
       sort_order
from gvic_matrix_projection_table
where company_id=$1::uuid
  and (
    ($2 <> '' and node_id = any(string_to_array($2, ',')::uuid[]))
    or ($3 <> '' and logic_gate_id = any(string_to_array($3, ',')::uuid[]))
  )
order by user_id::text asc, projection_row_id asc`, companyID, strings.Join(nodeIDs, ","), strings.Join(logicGateIDs, ","))
}

func postgresGVICMatrixProjectionRowsForLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) ([]GVICMatrixProjectionRow, error) {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if ctx == nil || tx == nil || companyID == "" || logicGateID == "" {
		return nil, ErrInvalid
	}
	return postgresGVICMatrixProjectionRowsForQueryTx(ctx, tx, `
select company_id::text,
       projection_row_id,
       user_id::text,
       node_name,
       gvic_assignment,
       priority,
       project_id::text,
       project_name,
       logic_gate_id::text,
       logic_gate_name,
       node_id::text,
       status,
       due_date::text,
       accounts::text,
       created_timestamp,
       updated_timestamp,
       sort_order
from gvic_matrix_projection_table
where company_id=$1::uuid
  and logic_gate_id=$2::uuid
order by user_id::text asc, projection_row_id asc`, companyID, logicGateID)
}

func postgresGVICMatrixProjectionRowsForQueryTx(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]GVICMatrixProjectionRow, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
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
	var projectID sql.NullString
	var projectName sql.NullString
	var logicGateID sql.NullString
	var logicGateName sql.NullString
	var status sql.NullString
	var dueDate sql.NullString
	var priority sql.NullInt64
	var accountsJSON sql.NullString
	var sortOrder sql.NullInt64
	err := row.Scan(
		&item.CompanyID,
		&item.ProjectionRowID,
		&item.UserID,
		&item.NodeName,
		&item.GVICAssignment,
		&priority,
		&projectID,
		&projectName,
		&logicGateID,
		&logicGateName,
		&item.NodeID,
		&status,
		&dueDate,
		&accountsJSON,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
		&sortOrder,
	)
	if projectID.Valid {
		item.ProjectID = strings.TrimSpace(projectID.String)
	}
	if projectName.Valid {
		item.ProjectName = strings.TrimSpace(projectName.String)
	}
	if logicGateID.Valid {
		clean := strings.TrimSpace(logicGateID.String)
		item.LogicGateID = &clean
	}
	if logicGateName.Valid {
		item.LogicGateName = strings.TrimSpace(logicGateName.String)
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
	if sortOrder.Valid {
		item.SortOrder = int(sortOrder.Int64)
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
