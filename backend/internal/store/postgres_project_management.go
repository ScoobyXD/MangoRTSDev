package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

type projectManagementDB interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

const projectManagementTimelineProjectionSelectColumns = `
projection.company_id::text,
projection.item_id::text,
projection.user_id::text,
projection.resource_type,
projection.resource_id::text,
projection.logic_gate_id::text,
projection.node_id::text,
projection.display_title,
projection.status,
projection.status_color,
projection.due_date::text,
projection.priority,
projection.assignee_user_id::text,
projection.assignee_display_name,
projection.assignee_email,
projection.start_date::text,
projection.end_date::text,
projection.duration_days,
projection.position,
projection.resource_created_timestamp,
projection.timeline_created_timestamp,
projection.timeline_updated_timestamp,
projection.projection_updated_timestamp,
projection.accounts::text`

func scanProjectManagementTimelineProjectionRow(row interface{ Scan(dest ...any) error }) (ProjectManagementTimelineProjectionRow, error) {
	var item ProjectManagementTimelineProjectionRow
	var logicGateID sql.NullString
	var nodeID sql.NullString
	var status sql.NullString
	var statusColor sql.NullString
	var dueDate sql.NullString
	var priority sql.NullInt64
	var assigneeUserID sql.NullString
	var assigneeDisplayName sql.NullString
	var assigneeEmail sql.NullString
	var accountsJSON sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.ItemID,
		&item.UserID,
		&item.ResourceType,
		&item.ResourceID,
		&logicGateID,
		&nodeID,
		&item.DisplayTitle,
		&status,
		&statusColor,
		&dueDate,
		&priority,
		&assigneeUserID,
		&assigneeDisplayName,
		&assigneeEmail,
		&item.StartDate,
		&item.EndDate,
		&item.DurationDays,
		&item.Position,
		&item.ResourceCreatedTimestamp,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
		&item.ProjectionUpdatedTimestamp,
		&accountsJSON,
	)
	if err != nil {
		return ProjectManagementTimelineProjectionRow{}, err
	}
	if logicGateID.Valid && strings.TrimSpace(logicGateID.String) != "" {
		value := logicGateID.String
		item.LogicGateID = &value
	}
	if nodeID.Valid {
		item.NodeID = nodeID.String
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
	if item.NodeID != "" {
		item.NodeTitle = item.DisplayTitle
	}
	item.Accounts = scanAccountSnapshotsJSON(accountsJSON)
	return item, nil
}

func scanProjectManagementTimelineProjectionRows(rows *sql.Rows) ([]ProjectManagementTimelineProjectionRow, error) {
	items := make([]ProjectManagementTimelineProjectionRow, 0)
	for rows.Next() {
		item, err := scanProjectManagementTimelineProjectionRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func projectManagementTimelineProjectionRowsForItemTx(ctx context.Context, db projectManagementDB, companyID, itemID string) ([]ProjectManagementTimelineProjectionRow, error) {
	companyID = cleanUUIDText(companyID)
	itemID = cleanUUIDText(itemID)
	if companyID == "" || itemID == "" {
		return nil, ErrInvalid
	}
	rows, err := db.QueryContext(ctx, `
select `+projectManagementTimelineProjectionSelectColumns+`
from project_management_timeline_projection projection
where projection.company_id=$1::uuid
  and projection.item_id=$2::uuid
order by projection.user_id, projection.item_id`, companyID, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanProjectManagementTimelineProjectionRows(rows)
}

func projectManagementTimelineProjectionRowsForEntityTx(ctx context.Context, db projectManagementDB, companyID, userID, entityType, entityID string) ([]ProjectManagementTimelineProjectionRow, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	entityID = cleanUUIDText(entityID)
	entityType, ok := NormalizeEntityType(entityType)
	if companyID == "" || userID == "" || entityID == "" || !ok {
		return nil, ErrInvalid
	}
	rows, err := db.QueryContext(ctx, `
select `+projectManagementTimelineProjectionSelectColumns+`
from project_management_timeline_projection projection
where projection.company_id=$1::uuid
  and projection.user_id=$2::uuid
  and projection.resource_type=$3
  and projection.resource_id=$4::uuid
order by projection.user_id, projection.item_id`, companyID, userID, entityType, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanProjectManagementTimelineProjectionRows(rows)
}

func syncProjectManagementTimelineProjectionForItemTx(ctx context.Context, db projectManagementDB, companyID, itemID string) error {
	companyID = cleanUUIDText(companyID)
	itemID = cleanUUIDText(itemID)
	if companyID == "" || itemID == "" {
		return ErrInvalid
	}
	_, err := db.ExecContext(ctx, `
with source as (
  select
    item.company_id,
    item.item_id,
    item.user_id,
    case when item.node_id is not null then 'node' else 'logic_gate' end as resource_type,
    coalesce(item.node_id, item.logic_gate_id) as resource_id,
    item.node_id,
    item.logic_gate_id,
    coalesce(nullif(node_row.name, ''), nullif(gate.header, ''), coalesce(item.node_id::text, item.logic_gate_id::text)) as display_title,
    case when item.node_id is not null then nullif(node_row.status, '') else 'Logic Gate' end as status,
    case when item.node_id is not null then null::text else '#8b5cf6' end as status_color,
    node_row.due_date,
    node_row.priority,
    null::uuid as assignee_user_id,
    null::text as assignee_display_name,
    null::text as assignee_email,
    item.start_date,
    (item.start_date + (item.duration_days - 1) * interval '1 day')::date as end_date,
    item.duration_days,
    item.position,
    coalesce(node_row.created_timestamp, gate.created_timestamp) as resource_created_timestamp,
    item.created_timestamp as timeline_created_timestamp,
    item.updated_timestamp as timeline_updated_timestamp,
    coalesce(account_snapshot.accounts_json, '[]'::jsonb) as accounts_json
  from project_management_timeline_items item
  left join nodes node_row
    on node_row.company_id=item.company_id
   and node_row.node_id=item.node_id
  left join logic_gates gate
    on gate.company_id=item.company_id
   and gate.logic_gate_id=item.logic_gate_id
  `+postgresAccountSnapshotsForNodeLateralSQL("node_row")+`
  where item.company_id=$1::uuid
    and item.item_id=$2::uuid
    and (
      (item.node_id is not null and node_row.node_id is not null)
      or (item.logic_gate_id is not null and gate.logic_gate_id is not null)
    )
),
deleted_stale as (
  delete from project_management_timeline_projection projection
  where projection.company_id=$1::uuid
    and projection.item_id=$2::uuid
    and not exists (select 1 from source)
)
insert into project_management_timeline_projection (
  company_id,
  item_id,
  user_id,
  resource_type,
  resource_id,
  node_id,
  logic_gate_id,
  display_title,
  status,
  status_color,
  due_date,
  priority,
  assignee_user_id,
  assignee_display_name,
  assignee_email,
  start_date,
  end_date,
  duration_days,
  position,
  resource_created_timestamp,
  timeline_created_timestamp,
  timeline_updated_timestamp,
  accounts,
  projection_updated_timestamp
)
select
  company_id,
  item_id,
  user_id,
  resource_type,
  resource_id,
  node_id,
  logic_gate_id,
  display_title,
  status,
  status_color,
  due_date,
  priority,
  assignee_user_id,
  assignee_display_name,
  assignee_email,
  start_date,
  end_date,
  duration_days,
  position,
  resource_created_timestamp,
  timeline_created_timestamp,
  timeline_updated_timestamp,
  case when node_id is not null then coalesce(accounts_json, '[]'::jsonb) else '[]'::jsonb end,
  now()
from source
on conflict (company_id, user_id, item_id)
do update set
  resource_type=excluded.resource_type,
  resource_id=excluded.resource_id,
  node_id=excluded.node_id,
  logic_gate_id=excluded.logic_gate_id,
  display_title=excluded.display_title,
  status=excluded.status,
  status_color=excluded.status_color,
  due_date=excluded.due_date,
  priority=excluded.priority,
  assignee_user_id=excluded.assignee_user_id,
  assignee_display_name=excluded.assignee_display_name,
  assignee_email=excluded.assignee_email,
  start_date=excluded.start_date,
  end_date=excluded.end_date,
  duration_days=excluded.duration_days,
  position=excluded.position,
  resource_created_timestamp=excluded.resource_created_timestamp,
  timeline_created_timestamp=excluded.timeline_created_timestamp,
  timeline_updated_timestamp=excluded.timeline_updated_timestamp,
  accounts=excluded.accounts,
  projection_updated_timestamp=now()`, companyID, itemID)
	return err
}

func syncProjectManagementTimelineProjectionForNodeTx(ctx context.Context, db projectManagementDB, companyID, nodeID string) error {
	return syncProjectManagementTimelineProjectionForResourceTx(ctx, db, companyID, EntityTypeNode, nodeID)
}

func syncProjectManagementTimelineProjectionForLogicGateTx(ctx context.Context, db projectManagementDB, companyID, logicGateID string) error {
	return syncProjectManagementTimelineProjectionForResourceTx(ctx, db, companyID, EntityTypeLogicGate, logicGateID)
}

func syncProjectManagementTimelineProjectionForResourceTx(ctx context.Context, db projectManagementDB, companyID, entityType, entityID string) error {
	companyID = cleanUUIDText(companyID)
	entityID = cleanUUIDText(entityID)
	entityType, ok := NormalizeEntityType(entityType)
	if companyID == "" || entityID == "" || !ok {
		return ErrInvalid
	}
	rows, err := db.QueryContext(ctx, `
select item_id::text
from project_management_timeline_items
where company_id=$1::uuid
  and (
    ($2='node' and node_id=$3::uuid)
    or ($2='logic_gate' and logic_gate_id=$3::uuid)
  )`, companyID, entityType, entityID)
	if err != nil {
		return err
	}
	defer rows.Close()
	itemIDs := make([]string, 0)
	for rows.Next() {
		var itemID string
		if err := rows.Scan(&itemID); err != nil {
			return err
		}
		itemIDs = append(itemIDs, itemID)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, itemID := range itemIDs {
		if err := syncProjectManagementTimelineProjectionForItemTx(ctx, db, companyID, itemID); err != nil {
			return err
		}
	}
	return nil
}

func deleteProjectManagementTimelineProjectionForNodeTx(ctx context.Context, db projectManagementDB, companyID, nodeID string) error {
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	if companyID == "" || nodeID == "" {
		return ErrInvalid
	}
	_, err := db.ExecContext(ctx, `
delete from project_management_timeline_projection
where company_id=$1::uuid
  and node_id=$2::uuid`, companyID, nodeID)
	return err
}

func deleteProjectManagementTimelineProjectionForLogicGateTx(ctx context.Context, db projectManagementDB, companyID, logicGateID string) error {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" {
		return ErrInvalid
	}
	_, err := db.ExecContext(ctx, `
delete from project_management_timeline_projection
where company_id=$1::uuid
  and logic_gate_id=$2::uuid`, companyID, logicGateID)
	return err
}

func (r *PostgresRepo) ListProjectManagementTimelineProjectionRows(query ProjectManagementTimelineQuery) ([]ProjectManagementTimelineProjectionRow, error) {
	query = NormalizeProjectManagementTimelineQuery(query)
	if query.CompanyID == "" || query.UserID == "" || query.ViewerUserID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select `+projectManagementTimelineProjectionSelectColumns+`
from project_management_timeline_projection projection
where projection.company_id=$1::uuid
  and projection.user_id=$2::uuid
  and mangorts_user_can_access_resource(projection.company_id, projection.resource_type, projection.resource_id, $3::uuid, $4::text)
order by projection.start_date asc, projection.position asc, lower(projection.display_title) asc, projection.item_id asc
limit $5`, query.CompanyID, query.UserID, query.ViewerUserID, EntityPermissionView, query.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanProjectManagementTimelineProjectionRows(rows)
}

func (r *PostgresRepo) ListProjectManagementTimelineProjectionRowsForNode(companyID, nodeID string) ([]ProjectManagementTimelineProjectionRow, error) {
	return projectManagementTimelineProjectionRowsForResource(context.Background(), r.db, companyID, EntityTypeNode, nodeID)
}

func (r *PostgresRepo) ListProjectManagementTimelineProjectionRowsForLogicGate(companyID, logicGateID string) ([]ProjectManagementTimelineProjectionRow, error) {
	return projectManagementTimelineProjectionRowsForResource(context.Background(), r.db, companyID, EntityTypeLogicGate, logicGateID)
}

func (r *PostgresRepo) GetProjectManagementTimelineItemOwner(companyID, itemID string) (string, error) {
	return projectManagementTimelineItemOwnerTx(context.Background(), r.db, companyID, itemID)
}

func projectManagementTimelineProjectionRowsForResource(ctx context.Context, db projectManagementDB, companyID, entityType, entityID string) ([]ProjectManagementTimelineProjectionRow, error) {
	companyID = cleanUUIDText(companyID)
	entityID = cleanUUIDText(entityID)
	entityType, ok := NormalizeEntityType(entityType)
	if companyID == "" || entityID == "" || !ok {
		return nil, ErrInvalid
	}
	rows, err := db.QueryContext(ctx, `
select `+projectManagementTimelineProjectionSelectColumns+`
from project_management_timeline_projection projection
where projection.company_id=$1::uuid
  and projection.resource_type=$2
  and projection.resource_id=$3::uuid
order by projection.user_id, projection.item_id`, companyID, entityType, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanProjectManagementTimelineProjectionRows(rows)
}

func (r *PostgresRepo) UpsertProjectManagementTimelineItem(input ProjectManagementTimelineItemInput) (ProjectManagementTimelineMutationResult, error) {
	input, err := NormalizeProjectManagementTimelineItemInput(input)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	defer tx.Rollback()

	before, err := projectManagementTimelineProjectionRowsForEntityTx(ctx, tx, input.CompanyID, input.UserID, input.EntityType, input.EntityID)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	itemID := cleanUUIDText(input.ItemID)
	if itemID == "" {
		itemID = newUUIDv7String()
	}
	var returnedItemID string
	switch input.EntityType {
	case EntityTypeNode:
		err = tx.QueryRowContext(ctx, `
insert into project_management_timeline_items (
  company_id, item_id, user_id, node_id, start_date, duration_days, position, created_by_user_id, created_timestamp, updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::date, $6, $7, nullif($8, '')::uuid, now(), now())
on conflict (company_id, user_id, node_id) where node_id is not null
do update set
  start_date=excluded.start_date,
  duration_days=excluded.duration_days,
  position=excluded.position,
  updated_timestamp=now()
returning item_id::text`, input.CompanyID, itemID, input.UserID, input.EntityID, input.StartDate, input.DurationDays, input.Position, input.ActorUserID).Scan(&returnedItemID)
	case EntityTypeLogicGate:
		err = tx.QueryRowContext(ctx, `
insert into project_management_timeline_items (
  company_id, item_id, user_id, logic_gate_id, start_date, duration_days, position, created_by_user_id, created_timestamp, updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::date, $6, $7, nullif($8, '')::uuid, now(), now())
on conflict (company_id, user_id, logic_gate_id) where logic_gate_id is not null
do update set
  start_date=excluded.start_date,
  duration_days=excluded.duration_days,
  position=excluded.position,
  updated_timestamp=now()
returning item_id::text`, input.CompanyID, itemID, input.UserID, input.EntityID, input.StartDate, input.DurationDays, input.Position, input.ActorUserID).Scan(&returnedItemID)
	}
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	if err := syncProjectManagementTimelineProjectionForItemTx(ctx, tx, input.CompanyID, returnedItemID); err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	after, err := projectManagementTimelineProjectionRowsForEntityTx(ctx, tx, input.CompanyID, input.UserID, input.EntityType, input.EntityID)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	deltas := diffProjectManagementProjectionRows(before, after)
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, "", deltas)); err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	var item *ProjectManagementTimelineProjectionRow
	for index := range after {
		if after[index].ItemID == returnedItemID {
			copied := after[index]
			item = &copied
			break
		}
	}
	return ProjectManagementTimelineMutationResult{Item: item, UserID: input.UserID, ProjectionDeltas: deltas}, nil
}

func (r *PostgresRepo) UpdateProjectManagementTimelineItem(input ProjectManagementTimelineItemUpdateInput) (ProjectManagementTimelineMutationResult, error) {
	input, err := NormalizeProjectManagementTimelineItemUpdateInput(input)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	defer tx.Rollback()

	before, err := projectManagementTimelineProjectionRowsForItemTx(ctx, tx, input.CompanyID, input.ItemID)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	if len(before) == 0 {
		return ProjectManagementTimelineMutationResult{}, ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `
update project_management_timeline_items
set start_date=$3::date,
    duration_days=$4,
    position=$5,
    updated_timestamp=now()
where company_id=$1::uuid
  and item_id=$2::uuid`, input.CompanyID, input.ItemID, input.StartDate, input.DurationDays, input.Position); err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	if err := syncProjectManagementTimelineProjectionForItemTx(ctx, tx, input.CompanyID, input.ItemID); err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	after, err := projectManagementTimelineProjectionRowsForItemTx(ctx, tx, input.CompanyID, input.ItemID)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	deltas := diffProjectManagementProjectionRows(before, after)
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, "", deltas)); err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	var item *ProjectManagementTimelineProjectionRow
	if len(after) > 0 {
		copied := after[0]
		item = &copied
	}
	return ProjectManagementTimelineMutationResult{Item: item, UserID: before[0].UserID, ProjectionDeltas: deltas}, nil
}

func (r *PostgresRepo) DeleteProjectManagementTimelineItem(input ProjectManagementTimelineItemDeleteInput) (ProjectManagementTimelineMutationResult, error) {
	input, err := NormalizeProjectManagementTimelineItemDeleteInput(input)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	defer tx.Rollback()

	before, err := projectManagementTimelineProjectionRowsForItemTx(ctx, tx, input.CompanyID, input.ItemID)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	if len(before) == 0 {
		return ProjectManagementTimelineMutationResult{}, ErrNotFound
	}
	result, err := tx.ExecContext(ctx, `
delete from project_management_timeline_items
where company_id=$1::uuid
  and item_id=$2::uuid`, input.CompanyID, input.ItemID)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	if affected == 0 {
		return ProjectManagementTimelineMutationResult{}, ErrNotFound
	}
	after := []ProjectManagementTimelineProjectionRow{}
	deltas := diffProjectManagementProjectionRows(before, after)
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, "", deltas)); err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	return ProjectManagementTimelineMutationResult{DeletedItemID: input.ItemID, UserID: before[0].UserID, ProjectionDeltas: deltas}, nil
}

func projectManagementTimelineItemOwnerTx(ctx context.Context, db projectManagementDB, companyID, itemID string) (string, error) {
	var userID string
	err := db.QueryRowContext(ctx, `
select user_id::text
from project_management_timeline_items
where company_id=$1::uuid
  and item_id=$2::uuid`, companyID, itemID).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return userID, err
}
