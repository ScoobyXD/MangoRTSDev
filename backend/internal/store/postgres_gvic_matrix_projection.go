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
  select assignment.*
  from node_logic_gate_assignments assignment
  where assignment.company_id=$1::uuid
    and assignment.node_id=$2::uuid
  order by assignment.updated_timestamp desc, assignment.created_timestamp desc, assignment.assignment_id desc
  limit 1
), node_row as (
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
    n.created_timestamp as node_created_timestamp,
    assignment.logic_gate_id,
    coalesce(account_snapshot.accounts_json, '[]'::jsonb) as accounts
  from nodes n
  left join latest_assignment assignment on true
  ` + postgresAccountSnapshotsForNodeLateralSQL("n") + `
  where n.company_id=$1::uuid
    and n.node_id=$2::uuid
), gate_row as (
  select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
  from node_row
  join logic_gates gate
    on gate.company_id=node_row.company_id
   and gate.logic_gate_id=node_row.logic_gate_id
), assignment_rows as (
  select distinct
    node_row.company_id,
    effective.user_id,
    effective.role as gvic_assignment,
    node_row.node_id,
    node_row.title,
    node_row.status,
    node_row.due_date,
    node_row.priority,
    node_row.node_created_timestamp,
    node_row.logic_gate_id,
    gate_row.header as logic_gate_title,
    gate_row.created_timestamp as logic_gate_created_timestamp,
    node_row.accounts
  from node_row
  left join gate_row on true
  join resource_gvic_effective_assignments effective
    on effective.company_id=node_row.company_id
   and (
     (node_row.logic_gate_id is not null and effective.resource_type='logic_gate' and effective.resource_id=node_row.logic_gate_id)
     or (node_row.logic_gate_id is null and effective.resource_type='node' and effective.resource_id=node_row.node_id)
   )
  where effective.role in ('generated', 'verified', 'consulted', 'informed')
    and lower(regexp_replace(coalesce(node_row.status, ''), '[\s_-]+', '_', 'g')) not in ('done', 'complete', 'completed', 'closed', 'archived')
), project_matches as (
  select distinct on (assignment_rows.user_id, assignment_rows.gvic_assignment, assignment_rows.node_id, project.project_id)
    assignment_rows.*,
    project.project_id,
    project.name as project_name,
    project.created_timestamp as project_created_timestamp,
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
    assignment_rows.user_id,
    assignment_rows.gvic_assignment,
    assignment_rows.node_id,
    project.project_id,
    relationship.position asc,
    relationship.relationship_created_timestamp asc
), leaf_contexts as (
  select *
  from project_matches
  where not project_done
  union all
  select
    assignment_rows.*,
    null::uuid as project_id,
    null::text as project_name,
    null::timestamptz as project_created_timestamp,
    0 as project_position,
    assignment_rows.node_created_timestamp as relationship_created_timestamp,
    false as project_done
  from assignment_rows
  where not exists (
    select 1
    from project_matches match
    where match.user_id=assignment_rows.user_id
      and match.gvic_assignment=assignment_rows.gvic_assignment
      and match.node_id=assignment_rows.node_id
  )
), path_rows as (
  select
    company_id,
    user_id,
    gvic_assignment,
    concat(gvic_assignment, ':', coalesce(priority::text, 'none'), ':', node_id::text, ':project:', project_id::text) as item_id,
    'project'::text as resource_type,
    project_id as resource_id,
    project_id,
    logic_gate_id,
    node_id as node_leaf_id,
    null::text as parent_resource_type,
    null::uuid as parent_resource_id,
    project_name as display_title,
    null::text as status,
    null::date as due_date,
    priority,
    '[]'::jsonb as accounts,
    project_created_timestamp as resource_created_timestamp,
    0::smallint as depth,
    true as is_container_row,
    lower(coalesce(project_name, '')) as project_sort,
    lower(coalesce(logic_gate_title, '')) as gate_sort,
    lower(coalesce(title, '')) as node_sort
  from leaf_contexts
  where project_id is not null
  union all
  select
    company_id,
    user_id,
    gvic_assignment,
    concat(gvic_assignment, ':', coalesce(priority::text, 'none'), ':', node_id::text, ':', coalesce('project:' || project_id::text, 'no_project'), ':logic_gate:', logic_gate_id::text) as item_id,
    'logic_gate'::text as resource_type,
    logic_gate_id as resource_id,
    project_id,
    logic_gate_id,
    node_id as node_leaf_id,
    case when project_id is not null then 'project'::text end as parent_resource_type,
    project_id as parent_resource_id,
    logic_gate_title as display_title,
    null::text as status,
    null::date as due_date,
    priority,
    '[]'::jsonb as accounts,
    logic_gate_created_timestamp as resource_created_timestamp,
    case when project_id is not null then 1 else 0 end::smallint as depth,
    true as is_container_row,
    lower(coalesce(project_name, '')) as project_sort,
    lower(coalesce(logic_gate_title, '')) as gate_sort,
    lower(coalesce(title, '')) as node_sort
  from leaf_contexts
  where logic_gate_id is not null
  union all
  select
    company_id,
    user_id,
    gvic_assignment,
    concat(gvic_assignment, ':', coalesce(priority::text, 'none'), ':', node_id::text, ':', coalesce('project:' || project_id::text, 'no_project'), ':', coalesce('logic_gate:' || logic_gate_id::text, 'no_gate'), ':node:', node_id::text) as item_id,
    'node'::text as resource_type,
    node_id as resource_id,
    project_id,
    logic_gate_id,
    node_id as node_leaf_id,
    case
      when logic_gate_id is not null then 'logic_gate'::text
      when project_id is not null then 'project'::text
    end as parent_resource_type,
    coalesce(logic_gate_id, project_id) as parent_resource_id,
    title as display_title,
    status,
    due_date,
    priority,
    accounts,
    node_created_timestamp as resource_created_timestamp,
    case
      when project_id is not null and logic_gate_id is not null then 2
      when project_id is not null or logic_gate_id is not null then 1
      else 0
    end::smallint as depth,
    false as is_container_row,
    lower(coalesce(project_name, '')) as project_sort,
    lower(coalesce(logic_gate_title, '')) as gate_sort,
    lower(coalesce(title, '')) as node_sort
  from leaf_contexts
), projected as (
  select
    company_id,
    user_id,
    item_id,
    gvic_assignment,
    resource_type,
    resource_id,
    project_id,
    logic_gate_id,
    node_leaf_id,
    parent_resource_type,
    parent_resource_id,
    display_title,
    status,
    due_date,
    priority,
    accounts,
    resource_created_timestamp,
    depth,
    is_container_row,
    row_number() over (
      partition by company_id, user_id
      order by
        case gvic_assignment
          when 'generated' then 1
          when 'verified' then 2
          when 'consulted' then 3
          when 'informed' then 4
          else 5
        end,
        coalesce(priority, 6),
        project_sort,
        gate_sort,
        node_sort,
        node_leaf_id::text,
        depth,
        resource_type,
        resource_id::text
    )::integer as sort_order
  from path_rows
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
  and (entry.node_leaf_id=$2::uuid or (entry.node_leaf_id is null and entry.resource_type='node' and entry.resource_id=$2::uuid))
  and not exists (
    select 1
    from projected
    where projected.company_id=entry.company_id
      and projected.user_id=entry.user_id
      and projected.item_id=entry.item_id
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
  item_id,
  gvic_assignment,
  resource_type,
  resource_id,
  project_id,
  logic_gate_id,
  node_leaf_id,
  parent_resource_type,
  parent_resource_id,
  display_title,
  status,
  due_date,
  priority,
  resource_created_timestamp,
  accounts,
  depth,
  sort_order,
  is_container_row,
  updated_timestamp
)
select
  company_id,
  user_id,
  item_id,
  gvic_assignment,
  resource_type,
  resource_id,
  project_id,
  logic_gate_id,
  node_leaf_id,
  parent_resource_type,
  parent_resource_id,
  display_title,
  status,
  due_date,
  priority,
  resource_created_timestamp,
  accounts,
  depth,
  sort_order,
  is_container_row,
  now()
from projected
on conflict (company_id, user_id, item_id)
do update set
  gvic_assignment=excluded.gvic_assignment,
  resource_type=excluded.resource_type,
  resource_id=excluded.resource_id,
  project_id=excluded.project_id,
  logic_gate_id=excluded.logic_gate_id,
  node_leaf_id=excluded.node_leaf_id,
  parent_resource_type=excluded.parent_resource_type,
  parent_resource_id=excluded.parent_resource_id,
  display_title=excluded.display_title,
  status=excluded.status,
  due_date=excluded.due_date,
  priority=excluded.priority,
  resource_created_timestamp=excluded.resource_created_timestamp,
  accounts=excluded.accounts,
  depth=excluded.depth,
  sort_order=excluded.sort_order,
  is_container_row=excluded.is_container_row,
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
  and (node_leaf_id=$2::uuid or (node_leaf_id is null and resource_type='node' and resource_id=$2::uuid))`, companyID, nodeID)
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
       entry.item_id,
       entry.gvic_assignment,
       entry.resource_type,
       entry.resource_id::text,
       entry.project_id::text,
       entry.logic_gate_id::text,
       entry.node_leaf_id::text,
       entry.parent_resource_type,
       entry.parent_resource_id::text,
       entry.display_title,
       entry.status,
       entry.due_date::text,
       entry.priority,
       entry.accounts::text,
       entry.resource_created_timestamp,
       entry.depth,
       entry.sort_order,
       entry.is_container_row,
       entry.updated_timestamp
from gvic_matrix_projection_table entry
where entry.company_id=$1::uuid
  and entry.user_id=$2::uuid
  and entry.gvic_assignment in ('generated', 'verified', 'consulted', 'informed')
  and entry.node_leaf_id is not null
  and mangorts_user_can_access_resource(entry.company_id, 'node', entry.node_leaf_id, $4::uuid, 'edit')
order by entry.sort_order asc, entry.item_id asc
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
       entry.user_id::text,
       entry.item_id,
       entry.gvic_assignment,
       entry.resource_type,
       entry.resource_id::text,
       entry.project_id::text,
       entry.logic_gate_id::text,
       entry.node_leaf_id::text,
       entry.parent_resource_type,
       entry.parent_resource_id::text,
       entry.display_title,
       entry.status,
       entry.due_date::text,
       entry.priority,
       entry.accounts::text,
       entry.resource_created_timestamp,
       entry.depth,
       entry.sort_order,
       entry.is_container_row,
       entry.updated_timestamp
from gvic_matrix_projection_table entry
where entry.company_id=$1::uuid
  and entry.user_id=$2::uuid
  and entry.gvic_assignment in ('generated', 'verified', 'consulted', 'informed')
  and entry.node_leaf_id is not null
  and mangorts_user_can_access_resource(entry.company_id, 'node', entry.node_leaf_id, $3::uuid, 'edit')
order by entry.gvic_assignment asc, coalesce(entry.priority, 6) asc, entry.sort_order asc, entry.item_id asc
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
       user_id::text,
       item_id,
       gvic_assignment,
       resource_type,
       resource_id::text,
       project_id::text,
       logic_gate_id::text,
       node_leaf_id::text,
       parent_resource_type,
       parent_resource_id::text,
       display_title,
       status,
       due_date::text,
       priority,
       accounts::text,
       resource_created_timestamp,
       depth,
       sort_order,
       is_container_row,
       updated_timestamp
from gvic_matrix_projection_table
where company_id=$1::uuid
  and (
    ($2 <> '' and node_leaf_id = any(string_to_array($2, ',')::uuid[]))
    or ($3 <> '' and logic_gate_id = any(string_to_array($3, ',')::uuid[]))
  )
order by user_id::text asc, item_id asc`, companyID, strings.Join(nodeIDs, ","), strings.Join(logicGateIDs, ","))
}

func postgresGVICMatrixProjectionRowsForLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) ([]GVICMatrixProjectionRow, error) {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if ctx == nil || tx == nil || companyID == "" || logicGateID == "" {
		return nil, ErrInvalid
	}
	return postgresGVICMatrixProjectionRowsForQueryTx(ctx, tx, `
select company_id::text,
       user_id::text,
       item_id,
       gvic_assignment,
       resource_type,
       resource_id::text,
       project_id::text,
       logic_gate_id::text,
       node_leaf_id::text,
       parent_resource_type,
       parent_resource_id::text,
       display_title,
       status,
       due_date::text,
       priority,
       accounts::text,
       resource_created_timestamp,
       depth,
       sort_order,
       is_container_row,
       updated_timestamp
from gvic_matrix_projection_table
where company_id=$1::uuid
  and logic_gate_id=$2::uuid
order by user_id::text asc, item_id asc`, companyID, logicGateID)
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
	var logicGateID sql.NullString
	var nodeLeafID sql.NullString
	var parentResourceType sql.NullString
	var parentResourceID sql.NullString
	var status sql.NullString
	var dueDate sql.NullString
	var priority sql.NullInt64
	var accountsJSON sql.NullString
	var depth sql.NullInt64
	var sortOrder sql.NullInt64
	err := row.Scan(
		&item.CompanyID,
		&item.UserID,
		&item.ItemID,
		&item.GVICAssignment,
		&item.ResourceType,
		&item.ResourceID,
		&projectID,
		&logicGateID,
		&nodeLeafID,
		&parentResourceType,
		&parentResourceID,
		&item.DisplayTitle,
		&status,
		&dueDate,
		&priority,
		&accountsJSON,
		&item.ResourceCreatedTimestamp,
		&depth,
		&sortOrder,
		&item.IsContainerRow,
		&item.UpdatedTimestamp,
	)
	if projectID.Valid {
		item.ProjectID = strings.TrimSpace(projectID.String)
	}
	if logicGateID.Valid {
		clean := strings.TrimSpace(logicGateID.String)
		item.LogicGateID = &clean
	}
	if nodeLeafID.Valid {
		item.NodeLeafID = strings.TrimSpace(nodeLeafID.String)
		item.NodeID = item.NodeLeafID
	}
	if parentResourceType.Valid {
		item.ParentResourceType = strings.TrimSpace(parentResourceType.String)
	}
	if parentResourceID.Valid {
		item.ParentResourceID = strings.TrimSpace(parentResourceID.String)
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
	if depth.Valid {
		item.Depth = int(depth.Int64)
	}
	if sortOrder.Valid {
		item.SortOrder = int(sortOrder.Int64)
	}
	item.Role = item.GVICAssignment
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
