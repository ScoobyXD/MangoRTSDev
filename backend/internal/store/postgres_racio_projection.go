package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const postgresRacioNodeProjectionCTE = `
with node_row as (
  select
    n.company_id,
    n.node_id,
    n.title,
    coalesce(
      case
        when assignment.is_issue then 'Issue'
        when assignment.assignment_id is not null then ` + postgresLogicGateAssignmentStatusTitleSQL + `
      end,
      nullif(n.status, '')
    ) as status,
    coalesce(
      case
        when assignment.is_issue then '#ffd400'
        when assignment.assignment_id is not null then ` + postgresLogicGateAssignmentStatusColorSQL + `
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
)`

const postgresRacioLogicGateUserProjectionCTE = `
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
        when assignment.assignment_id is not null then ` + postgresLogicGateAssignmentStatusTitleSQL + `
      end,
      nullif(n.status, '')
    ) as status,
    coalesce(
      case
        when assignment.is_issue then '#ffd400'
        when assignment.assignment_id is not null then ` + postgresLogicGateAssignmentStatusColorSQL + `
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
  left join company_memberships assignee_membership
    on assignee_membership.company_id = n.company_id
   and assignee_membership.user_id = n.assignee_user_id
  left join users assignee
    on assignee.user_id = assignee_membership.user_id
  where assignment.company_id=$1::uuid
    and assignment.logic_gate_id=$2::uuid
), projected as (
  select
    gate_row.company_id,
    user_raci.user_id,
    'logic_gate'::text as resource_type,
    gate_row.logic_gate_id as resource_id,
    gate_row.logic_gate_id,
    gate_row.header as display_title,
    null::text as status,
    null::text as status_color,
    null::date as due_date,
    null::smallint as priority,
    null::uuid as assignee_user_id,
    null::text as assignee_display_name,
    null::text as assignee_email,
    gate_row.created_timestamp as resource_created_timestamp
  from gate_row
  join user_raci on true
  union all
  select
    node_rows.company_id,
    user_raci.user_id,
    'node'::text as resource_type,
    node_rows.node_id as resource_id,
    node_rows.logic_gate_id,
    node_rows.title as display_title,
    node_rows.status,
    node_rows.status_color,
    node_rows.due_date,
    node_rows.priority,
    node_rows.assignee_user_id,
    node_rows.assignee_display_name,
    node_rows.assignee_email,
    node_rows.resource_created_timestamp
  from node_rows
  join user_raci on true
)`

func syncPostgresRacioProjectionForNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	defer observeTiming(ctx, "repo.syncPostgresRacioProjectionForNodeTx.total")()
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	if ctx == nil || tx == nil || companyID == "" || nodeID == "" {
		return ErrInvalid
	}
	stop := observeTiming(ctx, "repo.syncPostgresRacioProjectionForNodeTx.delete_stale")
	if _, err := tx.ExecContext(ctx, postgresRacioNodeProjectionCTE+`
delete from racio_matrix_projection_table entry
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
	return upsertPostgresRacioProjectionForNodeTx(ctx, tx, companyID, nodeID)
}

func syncPostgresRacioProjectionForNodeDeltasTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) ([]ProjectionDelta, error) {
	before, err := postgresRacioProjectionRowsForResourcesTx(ctx, tx, companyID, []string{nodeID}, nil)
	if err != nil {
		return nil, err
	}
	if err := syncPostgresRacioProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
		return nil, err
	}
	after, err := postgresRacioProjectionRowsForResourcesTx(ctx, tx, companyID, []string{nodeID}, nil)
	if err != nil {
		return nil, err
	}
	return diffRacioProjectionRows(before, after), nil
}

func syncPostgresRacioProjectionForNewNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	defer observeTiming(ctx, "repo.syncPostgresRacioProjectionForNodeTx.total")()
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	if ctx == nil || tx == nil || companyID == "" || nodeID == "" {
		return ErrInvalid
	}
	return upsertPostgresRacioProjectionForNodeTx(ctx, tx, companyID, nodeID)
}

func syncPostgresRacioProjectionForNewNodeDeltasTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) ([]ProjectionDelta, error) {
	before, err := postgresRacioProjectionRowsForResourcesTx(ctx, tx, companyID, []string{nodeID}, nil)
	if err != nil {
		return nil, err
	}
	if err := syncPostgresRacioProjectionForNewNodeTx(ctx, tx, companyID, nodeID); err != nil {
		return nil, err
	}
	after, err := postgresRacioProjectionRowsForResourcesTx(ctx, tx, companyID, []string{nodeID}, nil)
	if err != nil {
		return nil, err
	}
	return diffRacioProjectionRows(before, after), nil
}

func upsertPostgresRacioProjectionForNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	stop := observeTiming(ctx, "repo.syncPostgresRacioProjectionForNodeTx.upsert")
	_, err := tx.ExecContext(ctx, postgresRacioNodeProjectionCTE+`
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
	stop()
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
	users := racioAssignmentChangedUserSet(before, after)
	return syncPostgresRacioProjectionForLogicGateUsersTx(ctx, tx, companyID, logicGateID, mapKeys(users))
}

func syncPostgresRacioProjectionForLogicGateAssignmentsDeltasTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string, before, after []domain.LogicGateRaciAssignment) ([]ProjectionDelta, error) {
	beforeRows, err := postgresRacioProjectionRowsForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	if err := syncPostgresRacioProjectionForLogicGateAssignmentsTx(ctx, tx, companyID, logicGateID, before, after); err != nil {
		return nil, err
	}
	afterRows, err := postgresRacioProjectionRowsForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	return diffRacioProjectionRows(beforeRows, afterRows), nil
}

func syncPostgresRacioProjectionForLogicGateUsersTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string, userIDs []string) error {
	defer observeTiming(ctx, "repo.syncPostgresRacioProjectionForLogicGateUsersTx.total")()
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if ctx == nil || tx == nil || companyID == "" || logicGateID == "" {
		return ErrInvalid
	}
	userIDs = cleanUUIDTextSlice(userIDs)
	sort.Strings(userIDs)
	for _, userID := range userIDs {
		if err := deleteStalePostgresRacioProjectionForLogicGateUserTx(ctx, tx, companyID, logicGateID, userID); err != nil {
			return err
		}
		if err := upsertPostgresRacioProjectionForLogicGateUserTx(ctx, tx, companyID, logicGateID, userID); err != nil {
			return err
		}
	}
	return nil
}

func deleteStalePostgresRacioProjectionForLogicGateUserTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID, userID string) error {
	defer observeTiming(ctx, "repo.deleteStalePostgresRacioProjectionForLogicGateUserTx")()
	_, err := tx.ExecContext(ctx, postgresRacioLogicGateUserProjectionCTE+`
delete from racio_matrix_projection_table entry
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

func upsertPostgresRacioProjectionForLogicGateUserTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID, userID string) error {
	defer observeTiming(ctx, "repo.upsertPostgresRacioProjectionForLogicGateUserTx")()
	_, err := tx.ExecContext(ctx, postgresRacioLogicGateUserProjectionCTE+`
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

func (r *PostgresRepo) ListRacioMatrixProjectionRowsForResources(companyID string, nodeIDs, logicGateIDs []string) ([]RacioMatrixProjectionRow, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := postgresRacioProjectionRowsForResourcesTx(ctx, tx, companyID, nodeIDs, logicGateIDs)
	if err != nil {
		return nil, err
	}
	return rows, tx.Commit()
}

func (r *PostgresRepo) ListRacioMatrixProjectionRowsForLogicGate(companyID, logicGateID string) ([]RacioMatrixProjectionRow, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := postgresRacioProjectionRowsForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	return rows, tx.Commit()
}

func (r *PostgresRepo) ListRacioMatrixProjectionRowsForUser(query WorkItemInboxQuery) ([]RacioMatrixProjectionRow, error) {
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
       entry.status_color,
       entry.due_date::text,
       entry.priority,
       entry.assignee_user_id::text,
       entry.assignee_display_name,
       entry.assignee_email,
       entry.resource_created_timestamp,
       entry.updated_timestamp
from racio_matrix_projection_table entry
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
	items := make([]RacioMatrixProjectionRow, 0)
	for rows.Next() {
		item, err := scanRacioMatrixProjectionRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func postgresRacioProjectionRowsForResourcesTx(ctx context.Context, tx *sql.Tx, companyID string, nodeIDs, logicGateIDs []string) ([]RacioMatrixProjectionRow, error) {
	companyID = cleanUUIDText(companyID)
	nodeIDs = cleanUUIDTextSlice(nodeIDs)
	logicGateIDs = cleanUUIDTextSlice(logicGateIDs)
	if ctx == nil || tx == nil || companyID == "" {
		return nil, ErrInvalid
	}
	if len(nodeIDs) == 0 && len(logicGateIDs) == 0 {
		return []RacioMatrixProjectionRow{}, nil
	}
	rows, err := tx.QueryContext(ctx, `
select company_id::text,
       user_id::text,
       resource_type,
       resource_id::text,
       logic_gate_id::text,
       display_title,
       status,
       status_color,
       due_date::text,
       priority,
       assignee_user_id::text,
       assignee_display_name,
       assignee_email,
       resource_created_timestamp,
       updated_timestamp
from racio_matrix_projection_table
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
	items := make([]RacioMatrixProjectionRow, 0)
	for rows.Next() {
		item, err := scanRacioMatrixProjectionRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func postgresRacioProjectionRowsForLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) ([]RacioMatrixProjectionRow, error) {
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
       status_color,
       due_date::text,
       priority,
       assignee_user_id::text,
       assignee_display_name,
       assignee_email,
       resource_created_timestamp,
       updated_timestamp
from racio_matrix_projection_table
where company_id=$1::uuid
  and logic_gate_id=$2::uuid
order by resource_type asc, resource_id::text asc, user_id::text asc`, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]RacioMatrixProjectionRow, 0)
	for rows.Next() {
		item, err := scanRacioMatrixProjectionRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanRacioMatrixProjectionRow(row interface{ Scan(dest ...any) error }) (RacioMatrixProjectionRow, error) {
	var item RacioMatrixProjectionRow
	var logicGateID sql.NullString
	var status sql.NullString
	var statusColor sql.NullString
	var dueDate sql.NullString
	var priority sql.NullInt64
	var assigneeUserID sql.NullString
	var assigneeDisplayName sql.NullString
	var assigneeEmail sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.UserID,
		&item.ResourceType,
		&item.ResourceID,
		&logicGateID,
		&item.DisplayTitle,
		&status,
		&statusColor,
		&dueDate,
		&priority,
		&assigneeUserID,
		&assigneeDisplayName,
		&assigneeEmail,
		&item.ResourceCreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if logicGateID.Valid {
		item.LogicGateID = &logicGateID.String
	}
	if status.Valid {
		item.Status = &status.String
	}
	if statusColor.Valid {
		item.StatusColor = &statusColor.String
	}
	if dueDate.Valid {
		item.DueDate = &dueDate.String
	}
	if priority.Valid {
		value := int(priority.Int64)
		item.Priority = &value
	}
	if assigneeUserID.Valid {
		item.AssigneeUserID = &assigneeUserID.String
	}
	if assigneeDisplayName.Valid {
		item.AssigneeDisplayName = &assigneeDisplayName.String
	}
	if assigneeEmail.Valid {
		item.AssigneeEmail = &assigneeEmail.String
	}
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
