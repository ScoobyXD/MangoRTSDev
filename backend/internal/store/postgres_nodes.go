package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

const nodeSelectColumns = `
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
n.due_date::text,
n.priority,
n.assignee_user_id::text,
nullif(assignee.display_name, '') as assignee_name,
nullif(assignee.email, '') as assignee_email,
n.created_timestamp,
coalesce(node_logic_gates.logic_gate_ids_json, '[]') as logic_gate_ids_json`

const nodeStatusJoin = `
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
left join lateral (
  select coalesce(jsonb_agg(gate.logic_gate_id order by gate.logic_gate_id), '[]'::jsonb)::text as logic_gate_ids_json
  from (
    select distinct assignment.logic_gate_id::text as logic_gate_id
    from node_logic_gate_assignments assignment
    where assignment.company_id = n.company_id
      and assignment.node_id = n.node_id
  ) gate
) node_logic_gates on true`

const postgresNodeMapWindowCTE = `
with recursive folder_scope as (
  select company_id, folder_id
  from company_explorer_folders
  where company_id=$1
    and folder_id=$2::uuid
    and folder_kind='node'
  union all
  select child.company_id, child.folder_id
  from company_explorer_folders child
  join folder_scope parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
  where child.folder_kind='node'
), windowed_positions as (
  select position.company_id, position.node_id, position.x, position.y, position.updated_timestamp
  from node_map_positions position
  join company_explorer_folder_items item
    on item.company_id=position.company_id
   and item.item_type='node'
   and item.item_id=position.node_id::text
  join folder_scope folder
    on folder.folder_id=item.folder_id
  where position.company_id=$1
    and position.x >= $3
    and position.x <= $4
    and position.y >= $5
    and position.y <= $6
  order by position.x asc, position.y asc, position.node_id asc
  limit $7
)
`

func postgresNodeMapWindowArgs(query NodeMapWindowQuery) []any {
	return []any{query.CompanyID, query.FolderID, query.Window.MinX, query.Window.MaxX, query.Window.MinY, query.Window.MaxY, query.Limit}
}

func (r *PostgresRepo) nodeMapWindowFolderExists(ctx context.Context, query NodeMapWindowQuery) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx, `
select exists(
  select 1
  from company_explorer_folders
  where company_id=$1
    and folder_id=$2::uuid
    and folder_kind='node'
)`, query.CompanyID, query.FolderID).Scan(&exists)
	return exists, err
}
func scanNode(row interface {
	Scan(dest ...any) error
}) (domain.Node, error) {
	var item domain.Node
	var status sql.NullString
	var statusColor sql.NullString
	var dueDate sql.NullString
	var priority sql.NullInt64
	var assigneeUserID sql.NullString
	var assigneeName sql.NullString
	var assigneeEmail sql.NullString
	var logicGateIDsJSON sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.NodeID,
		&item.Title,
		&status,
		&statusColor,
		&dueDate,
		&priority,
		&assigneeUserID,
		&assigneeName,
		&assigneeEmail,
		&item.CreatedTimestamp,
		&logicGateIDsJSON,
	)
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
	if assigneeName.Valid {
		item.AssigneeName = &assigneeName.String
	}
	if assigneeEmail.Valid {
		item.AssigneeEmail = &assigneeEmail.String
	}
	if logicGateIDsJSON.Valid {
		var ids []string
		if json.Unmarshal([]byte(logicGateIDsJSON.String), &ids) == nil {
			item.LogicGateIDs = cleanStringList(ids)
		}
	}
	return item, err
}

func cleanStringList(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		clean := strings.TrimSpace(value)
		if clean == "" || seen[clean] {
			continue
		}
		seen[clean] = true
		out = append(out, clean)
	}
	return out
}

type postgresNodeAssigneeReadModel struct {
	UserID string
	Name   *string
	Email  *string
}

func loadPostgresNodeAssigneeReadModel(ctx context.Context, tx *sql.Tx, companyID, userID string) (postgresNodeAssigneeReadModel, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return postgresNodeAssigneeReadModel{}, nil
	}
	var item postgresNodeAssigneeReadModel
	var name sql.NullString
	var email sql.NullString
	err := tx.QueryRowContext(ctx, `
select membership.user_id::text, nullif(app_user.display_name, ''), nullif(app_user.email, '')
from company_memberships membership
left join users app_user
  on app_user.user_id = membership.user_id
where membership.company_id=$1 and membership.user_id::text=$2`,
		companyID, userID,
	).Scan(&item.UserID, &name, &email)
	if errors.Is(err, sql.ErrNoRows) {
		return postgresNodeAssigneeReadModel{}, ErrAssigneeNotInCompany
	}
	if err != nil {
		return postgresNodeAssigneeReadModel{}, err
	}
	if name.Valid {
		item.Name = &name.String
	}
	if email.Valid {
		item.Email = &email.String
	}
	return item, nil
}

func applyPostgresNodeAssigneeReadModel(node *domain.Node, assignee postgresNodeAssigneeReadModel) {
	if assignee.UserID == "" {
		return
	}
	node.AssigneeUserID = &assignee.UserID
	node.AssigneeName = assignee.Name
	node.AssigneeEmail = assignee.Email
}

func (r *PostgresRepo) CreateNode(companyID, title string) (domain.Node, error) {
	return r.CreateNodeWithAssignee(companyID, title, "")
}

func (r *PostgresRepo) CreateNodeWithAssignee(companyID, title, assigneeUserID string) (domain.Node, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Node{}, err
	}
	defer tx.Rollback()

	item, err := r.createNodeWithAssigneeTx(ctx, tx, companyID, title, assigneeUserID)
	if err != nil {
		return domain.Node{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Node{}, err
	}
	return item, nil
}

func (r *PostgresRepo) CreateNodeWithAssigneeAndWorkspaceEvent(companyID, title, assigneeUserID string) (domain.Node, domain.DomainEvent, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	defer tx.Rollback()

	item, err := r.createNodeWithAssigneeTx(ctx, tx, companyID, title, assigneeUserID)
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	event, err := r.appendDomainEventTx(ctx, tx, nodeCreatedWorkspaceEventInput(item))
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	return item, event, nil
}

func (r *PostgresRepo) createNodeWithAssigneeTx(ctx context.Context, tx *sql.Tx, companyID, title, assigneeUserID string) (domain.Node, error) {
	return r.createNodeWithAssigneeIDTx(ctx, tx, companyID, "", title, assigneeUserID)
}

func (r *PostgresRepo) createNodeWithAssigneeIDTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, title, assigneeUserID string) (domain.Node, error) {
	nodeID = strings.TrimSpace(nodeID)
	assigneeUserID = strings.TrimSpace(assigneeUserID)
	var assignee postgresNodeAssigneeReadModel
	if assigneeUserID != "" {
		var err error
		assignee, err = loadPostgresNodeAssigneeReadModel(ctx, tx, companyID, assigneeUserID)
		if err != nil {
			return domain.Node{}, err
		}
		assigneeUserID = assignee.UserID
	}
	if nodeID == "" {
		nodeID = newUUIDv7String()
	}
	item := domain.Node{CompanyID: companyID, NodeID: nodeID, Title: title}
	if err := tx.QueryRowContext(ctx,
		`insert into nodes (company_id, node_id, title, assignee_user_id, created_timestamp)
		 values ($1, $2, $3, nullif($4::text, '')::uuid, now())
		 returning company_id, node_id, title, created_timestamp`,
		item.CompanyID, item.NodeID, item.Title, assigneeUserID,
	).Scan(&item.CompanyID, &item.NodeID, &item.Title, &item.CreatedTimestamp); err != nil {
		return domain.Node{}, err
	}
	activeFolder, err := ensureCompanyExplorerSystemFolderSQL(ctx, tx, companyID, CompanyExplorerSystemActiveNodesKey)
	if err != nil {
		return domain.Node{}, err
	}
	if _, _, err := assignCompanyExplorerFolderItemSQL(ctx, tx, companyID, activeFolder.FolderID, "node", item.NodeID, 0); err != nil {
		return domain.Node{}, err
	}
	if err := recomputeNodeAssigneeEffectiveAccessTx(ctx, tx, companyID, item.NodeID); err != nil {
		return domain.Node{}, err
	}
	if err := recomputeCompanyMemberDefaultEffectiveAccessForResourceTx(ctx, tx, companyID, EntityTypeNode, item.NodeID); err != nil {
		return domain.Node{}, err
	}
	if err := recomputeCompanyAdminEffectiveAccessForResourceTx(ctx, tx, companyID, EntityTypeNode, item.NodeID); err != nil {
		return domain.Node{}, err
	}
	applyPostgresNodeAssigneeReadModel(&item, assignee)
	item.LogicGateIDs = []string{}
	return item, nil
}

func (r *PostgresRepo) UpdateNode(input UpdateNodeInput) (domain.Node, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Node{}, err
	}
	defer tx.Rollback()

	item, err := r.updateNodeTx(ctx, tx, input)
	if err != nil {
		return domain.Node{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Node{}, err
	}
	return item, nil
}

func (r *PostgresRepo) UpdateNodeAndWorkspaceEvent(input UpdateNodeInput) (domain.Node, domain.DomainEvent, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	defer tx.Rollback()

	before, err := scanNode(tx.QueryRowContext(ctx, `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1 and n.node_id=$2`, input.CompanyID, input.NodeID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Node{}, domain.DomainEvent{}, ErrNotFound
	}
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	item, err := r.updateNodeTx(ctx, tx, input)
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	event, err := r.appendDomainEventTx(ctx, tx, nodeUpdatedWorkspaceEventInputForUpdate(input, before, item))
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	return item, event, nil
}

func (r *PostgresRepo) updateNodeTx(ctx context.Context, tx *sql.Tx, input UpdateNodeInput) (domain.Node, error) {
	dueDate := (*string)(nil)
	if input.DueDate != nil {
		value := strings.TrimSpace(*input.DueDate)
		dueDate = &value
	}
	status := (*string)(nil)
	if input.Status != nil {
		value := strings.TrimSpace(*input.Status)
		status = &value
	}
	statusColor := (*string)(nil)
	if input.StatusColor != nil {
		value := strings.TrimSpace(*input.StatusColor)
		statusColor = &value
	}
	assigneeUserID := (*string)(nil)
	if input.AssigneeUserID != nil {
		value := strings.TrimSpace(*input.AssigneeUserID)
		assigneeUserID = &value
	}
	if input.AssigneeUserIDSet && assigneeUserID != nil && *assigneeUserID != "" {
		var ok bool
		if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_memberships
  where company_id=$1 and user_id::text=$2
)`, input.CompanyID, *assigneeUserID).Scan(&ok); err != nil {
			return domain.Node{}, err
		}
		if !ok {
			return domain.Node{}, ErrAssigneeNotInCompany
		}
	}
	_, err := tx.ExecContext(ctx, `
update nodes
set title = case when $4 then $3 else title end,
    status = case when $6 then nullif($5::text, '') else status end,
    status_color = case when $8 then nullif($7::text, '') else status_color end,
    due_date = case when $10 then nullif($9::text, '')::date else due_date end,
    priority = case when $12 then $11::smallint else priority end,
    assignee_user_id = case when $14 then nullif($13::text, '')::uuid else assignee_user_id end
where company_id = $1 and node_id = $2`,
		input.CompanyID,
		input.NodeID,
		input.Title,
		input.TitleSet,
		status,
		input.StatusSet,
		statusColor,
		input.StatusColorSet,
		dueDate,
		input.DueDateSet,
		input.Priority,
		input.PrioritySet,
		assigneeUserID,
		input.AssigneeUserIDSet,
	)
	if err != nil {
		return domain.Node{}, err
	}
	if input.AssigneeUserIDSet {
		if err := recomputeNodeAssigneeEffectiveAccessTx(ctx, tx, input.CompanyID, input.NodeID); err != nil {
			return domain.Node{}, err
		}
	}
	if input.TitleSet {
		if _, err := tx.ExecContext(ctx, `
update kanban_cards
set node_title=$3,
    updated_timestamp=now()
where company_id=$1 and node_id=$2
`, input.CompanyID, input.NodeID, input.Title); err != nil {
			return domain.Node{}, err
		}
	}
	item, err := scanNode(tx.QueryRowContext(ctx, `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1 and n.node_id=$2`, input.CompanyID, input.NodeID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Node{}, ErrNotFound
	}
	if err != nil {
		return domain.Node{}, err
	}
	return item, nil
}

func (r *PostgresRepo) UpdateNodeTitle(companyID, nodeID, title string) (domain.Node, error) {
	return r.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: nodeID, Title: title, TitleSet: true})
}

func (r *PostgresRepo) ListNodes(companyID string) ([]domain.Node, error) {
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`select `+nodeSelectColumns+`
		 from nodes n
		 `+nodeStatusJoin+`
		 where n.company_id=$1
		 order by n.created_timestamp asc`,
		companyID,
	)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresRepo) ListVisibleNodes(companyID, userID string) ([]domain.Node, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}

	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`select `+nodeSelectColumns+`
		 from nodes n
		 join (
		   select distinct access.resource_id
		   from effective_resource_access access
		   where access.company_id=$1::uuid
		     and access.user_id=$2::uuid
		     and access.resource_type='node'
		     and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($3)
		 ) visible on visible.resource_id=n.node_id
		 `+nodeStatusJoin+`
		 where n.company_id=$1::uuid
		 order by n.created_timestamp asc, n.node_id::text asc`,
		companyID, userID, EntityPermissionView,
	)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return r.attachNodeEffectiveAccessLevels(ctx, companyID, userID, items)
}

func (r *PostgresRepo) ListNodesInFolderSubtree(companyID, folderID string) ([]domain.Node, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListNodes(companyID)
	}
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`with recursive folder_scope as (
		   select company_id, folder_id
		   from company_explorer_folders
		   where company_id=$1 and folder_id=$2::uuid and folder_kind='node'
		   union all
		   select child.company_id, child.folder_id
		   from company_explorer_folders child
		   join folder_scope parent
		     on child.company_id=parent.company_id
		    and child.parent_folder_id=parent.folder_id
		   where child.folder_kind='node'
		 ), visible_nodes as (
		   select item.item_id::uuid as node_id
		   from company_explorer_folder_items item
		   join folder_scope folder on folder.folder_id=item.folder_id
		   where item.company_id=$1 and item.item_type='node'
		 )
		 select `+nodeSelectColumns+`
		 from nodes n
		 join visible_nodes visible on visible.node_id=n.node_id
		 `+nodeStatusJoin+`
		 where n.company_id=$1
		 order by n.created_timestamp asc`,
		companyID, folderID,
	)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresRepo) ListVisibleNodesInFolderSubtree(companyID, folderID, userID string) ([]domain.Node, error) {
	companyID = cleanUUIDText(companyID)
	folderID = strings.TrimSpace(folderID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return r.ListVisibleNodes(companyID, userID)
	}

	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`with recursive folder_scope as (
		   select company_id, folder_id
		   from company_explorer_folders
		   where company_id=$1::uuid and folder_id=$2::uuid and folder_kind='node'
		   union all
		   select child.company_id, child.folder_id
		   from company_explorer_folders child
		   join folder_scope parent
		     on child.company_id=parent.company_id
		    and child.parent_folder_id=parent.folder_id
		   where child.folder_kind='node'
		 ), folder_nodes as (
		   select distinct item.item_id::uuid as node_id
		   from company_explorer_folder_items item
		   join folder_scope folder on folder.folder_id=item.folder_id
		   where item.company_id=$1::uuid and item.item_type='node'
		 ), visible_nodes as (
		   select distinct access.resource_id as node_id
		   from effective_resource_access access
		   join folder_nodes folder_node on folder_node.node_id=access.resource_id
		   where access.company_id=$1::uuid
		     and access.user_id=$3::uuid
		     and access.resource_type='node'
		     and mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($4)
		 )
		 select `+nodeSelectColumns+`
		 from nodes n
		 join visible_nodes visible on visible.node_id=n.node_id
		 `+nodeStatusJoin+`
		 where n.company_id=$1::uuid
		 order by n.created_timestamp asc, n.node_id::text asc`,
		companyID, folderID, userID, EntityPermissionView,
	)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return r.attachNodeEffectiveAccessLevels(ctx, companyID, userID, items)
}

func (r *PostgresRepo) attachNodeEffectiveAccessLevels(ctx context.Context, companyID, userID string, items []domain.Node) ([]domain.Node, error) {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.NodeID)
	}
	levels, err := r.effectiveAccessLevelsForUser(ctx, companyID, userID, EntityTypeNode, ids)
	if err != nil {
		return nil, err
	}
	for index := range items {
		items[index].EffectiveAccess = levels[items[index].NodeID]
	}
	return items, nil
}

func (r *PostgresRepo) ListNodeRelationships(companyID string) ([]domain.NodeRelationship, error) {
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`select company_id, node_relationship_id, node_id_a, node_id_b, a_position::text, b_position::text, created_timestamp
		 from node_relationships
		 where company_id=$1
		 order by created_timestamp asc`,
		companyID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.NodeRelationship, 0)
	for rows.Next() {
		var item domain.NodeRelationship
		if err := rows.Scan(
			&item.CompanyID,
			&item.NodeRelationshipID,
			&item.NodeIDA,
			&item.NodeIDB,
			&item.APosition,
			&item.BPosition,
			&item.CreatedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresRepo) ListNodeRelationshipsInFolderSubtree(companyID, folderID string) ([]domain.NodeRelationship, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListNodeRelationships(companyID)
	}
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`with recursive folder_scope as (
		   select company_id, folder_id
		   from company_explorer_folders
		   where company_id=$1 and folder_id=$2::uuid and folder_kind='node'
		   union all
		   select child.company_id, child.folder_id
		   from company_explorer_folders child
		   join folder_scope parent
		     on child.company_id=parent.company_id
		    and child.parent_folder_id=parent.folder_id
		   where child.folder_kind='node'
		 ), visible_nodes as (
		   select item.item_id::uuid as node_id
		   from company_explorer_folder_items item
		   join folder_scope folder on folder.folder_id=item.folder_id
		   where item.company_id=$1 and item.item_type='node'
		 )
		 select rel.company_id, rel.node_relationship_id, rel.node_id_a, rel.node_id_b, rel.a_position::text, rel.b_position::text, rel.created_timestamp
		 from node_relationships rel
		 join visible_nodes a on a.node_id=rel.node_id_a
		 join visible_nodes b on b.node_id=rel.node_id_b
		 where rel.company_id=$1
		 order by rel.created_timestamp asc`,
		companyID, folderID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.NodeRelationship, 0)
	for rows.Next() {
		var item domain.NodeRelationship
		if err := rows.Scan(
			&item.CompanyID,
			&item.NodeRelationshipID,
			&item.NodeIDA,
			&item.NodeIDB,
			&item.APosition,
			&item.BPosition,
			&item.CreatedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (r *PostgresRepo) DeleteNodeRelationship(companyID, relationshipID string) error {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := postgresDeleteNodeRelationshipTx(ctx, tx, companyID, relationshipID); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) DeleteNodeRelationshipAndWorkspaceEvent(companyID, relationshipID string) (domain.DomainEvent, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.DomainEvent{}, err
	}
	defer tx.Rollback()

	if err := postgresDeleteNodeRelationshipTx(ctx, tx, companyID, relationshipID); err != nil {
		return domain.DomainEvent{}, err
	}
	event, err := r.appendDomainEventTx(ctx, tx, relationshipDeletedWorkspaceEventInput(companyID, relationshipID))
	if err != nil {
		return domain.DomainEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.DomainEvent{}, err
	}
	return event, nil
}

func postgresDeleteNodeRelationshipTx(ctx context.Context, tx *sql.Tx, companyID, relationshipID string) error {
	deleted, err := tx.ExecContext(ctx,
		`delete from node_relationships
		 where company_id=$1 and node_relationship_id=$2`,
		companyID, relationshipID,
	)
	if err != nil {
		return err
	}
	affected, err := deleted.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) GetNode(companyID, nodeID string) (domain.Node, error) {
	ctx := context.Background()
	item, err := scanNode(r.db.QueryRowContext(ctx,
		`select `+nodeSelectColumns+`
		 from nodes n
		 `+nodeStatusJoin+`
		 where n.company_id=$1 and n.node_id=$2`,
		companyID, nodeID,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Node{}, ErrNotFound
	}
	if err != nil {
		return domain.Node{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteNode(companyID, nodeID string) error {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := postgresDeleteNodeTx(ctx, tx, companyID, nodeID); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) DeleteNodeAndWorkspaceEvent(companyID, nodeID string) (domain.DomainEvent, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.DomainEvent{}, err
	}
	defer tx.Rollback()

	if err := postgresDeleteNodeTx(ctx, tx, companyID, nodeID); err != nil {
		return domain.DomainEvent{}, err
	}
	event, err := r.appendDomainEventTx(ctx, tx, nodeDeletedWorkspaceEventInput(companyID, nodeID))
	if err != nil {
		return domain.DomainEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.DomainEvent{}, err
	}
	return event, nil
}

func (r *PostgresRepo) ListNodeMapPositions(companyID string) ([]domain.NodeMapPosition, error) {
	rows, err := r.db.Query(`
select company_id, node_id, x, y, updated_timestamp
from node_map_positions
where company_id=$1
order by node_id asc`, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.NodeMapPosition, 0)
	for rows.Next() {
		var item domain.NodeMapPosition
		if err := rows.Scan(&item.CompanyID, &item.NodeID, &item.X, &item.Y, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListNodeMapPositionsInFolderSubtree(companyID, folderID string) ([]domain.NodeMapPosition, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListNodeMapPositions(companyID)
	}
	rows, err := r.db.Query(`
with recursive folder_scope as (
  select company_id, folder_id
  from company_explorer_folders
  where company_id=$1 and folder_id=$2::uuid and folder_kind='node'
  union all
  select child.company_id, child.folder_id
  from company_explorer_folders child
  join folder_scope parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
  where child.folder_kind='node'
), visible_nodes as (
  select item.item_id::uuid as node_id
  from company_explorer_folder_items item
  join folder_scope folder on folder.folder_id=item.folder_id
  where item.company_id=$1 and item.item_type='node'
)
select position.company_id, position.node_id, position.x, position.y, position.updated_timestamp
from node_map_positions position
join visible_nodes visible on visible.node_id=position.node_id
where position.company_id=$1
order by position.node_id asc`, companyID, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.NodeMapPosition, 0)
	for rows.Next() {
		var item domain.NodeMapPosition
		if err := rows.Scan(&item.CompanyID, &item.NodeID, &item.X, &item.Y, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (r *PostgresRepo) ListNodeMapPositionsWindow(query NodeMapWindowQuery) ([]domain.NodeMapPosition, error) {
	query, err := NormalizeNodeMapWindowQuery(query)
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	exists, err := r.nodeMapWindowFolderExists(ctx, query)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	rows, err := r.db.QueryContext(ctx, postgresNodeMapWindowCTE+`
select company_id, node_id, x, y, updated_timestamp
from windowed_positions
order by x asc, y asc, node_id asc`, postgresNodeMapWindowArgs(query)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.NodeMapPosition, 0)
	for rows.Next() {
		var item domain.NodeMapPosition
		if err := rows.Scan(&item.CompanyID, &item.NodeID, &item.X, &item.Y, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListNodeMapWindow(query NodeMapWindowQuery) (NodeMapWindowResult, error) {
	query, err := NormalizeNodeMapWindowQuery(query)
	if err != nil {
		return NodeMapWindowResult{}, err
	}
	folders, err := r.ListCompanyExplorerFolderSubtree(query.CompanyID, query.FolderID, "node")
	if err != nil {
		return NodeMapWindowResult{}, err
	}
	if len(folders) == 0 {
		return NodeMapWindowResult{}, ErrNotFound
	}
	positions, err := r.ListNodeMapPositionsWindow(query)
	if err != nil {
		return NodeMapWindowResult{}, err
	}
	result := NodeMapWindowResult{
		CompanyID:        query.CompanyID,
		FolderID:         query.FolderID,
		Window:           query.Window,
		Limit:            query.Limit,
		Nodes:            []domain.Node{},
		Relationships:    []domain.NodeRelationship{},
		Folders:          folders,
		FolderItems:      []domain.CompanyExplorerFolderItem{},
		NodeMapPositions: positions,
	}
	args := postgresNodeMapWindowArgs(query)
	ctx := context.Background()

	nodeRows, err := r.db.QueryContext(ctx, postgresNodeMapWindowCTE+`
select `+nodeSelectColumns+`
from nodes n
join windowed_positions visible on visible.node_id=n.node_id
`+nodeStatusJoin+`
where n.company_id=$1
order by n.created_timestamp asc`, args...)
	if err != nil {
		return NodeMapWindowResult{}, err
	}
	defer nodeRows.Close()
	for nodeRows.Next() {
		item, err := scanNode(nodeRows)
		if err != nil {
			return NodeMapWindowResult{}, err
		}
		result.Nodes = append(result.Nodes, item)
	}
	if err := nodeRows.Err(); err != nil {
		return NodeMapWindowResult{}, err
	}

	relationshipRows, err := r.db.QueryContext(ctx, postgresNodeMapWindowCTE+`
select rel.company_id, rel.node_relationship_id, rel.node_id_a, rel.node_id_b, rel.a_position::text, rel.b_position::text, rel.created_timestamp
from node_relationships rel
join windowed_positions a on a.node_id=rel.node_id_a
join windowed_positions b on b.node_id=rel.node_id_b
where rel.company_id=$1
order by rel.created_timestamp asc`, args...)
	if err != nil {
		return NodeMapWindowResult{}, err
	}
	defer relationshipRows.Close()
	for relationshipRows.Next() {
		var item domain.NodeRelationship
		if err := relationshipRows.Scan(
			&item.CompanyID,
			&item.NodeRelationshipID,
			&item.NodeIDA,
			&item.NodeIDB,
			&item.APosition,
			&item.BPosition,
			&item.CreatedTimestamp,
		); err != nil {
			return NodeMapWindowResult{}, err
		}
		result.Relationships = append(result.Relationships, item)
	}
	if err := relationshipRows.Err(); err != nil {
		return NodeMapWindowResult{}, err
	}

	itemRows, err := r.db.QueryContext(ctx, postgresNodeMapWindowCTE+`
select item.company_id, item.folder_id, item.item_type, item.item_id, item.position, item.created_timestamp, item.updated_timestamp
from company_explorer_folder_items item
join windowed_positions visible on visible.node_id::text=item.item_id
where item.company_id=$1
  and item.item_type='node'
order by item.position asc, item.created_timestamp asc`, args...)
	if err != nil {
		return NodeMapWindowResult{}, err
	}
	defer itemRows.Close()
	for itemRows.Next() {
		var item domain.CompanyExplorerFolderItem
		if err := itemRows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&item.ItemType,
			&item.ItemID,
			&item.Position,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return NodeMapWindowResult{}, err
		}
		result.FolderItems = append(result.FolderItems, item)
	}
	if err := itemRows.Err(); err != nil {
		return NodeMapWindowResult{}, err
	}
	return result, nil
}
func (r *PostgresRepo) UpsertNodeMapPositions(companyID string, positions []domain.NodeMapPosition) ([]domain.NodeMapPosition, error) {
	ctx := context.Background()
	out := make([]domain.NodeMapPosition, 0, len(positions))
	if len(positions) == 0 {
		return out, nil
	}

	nodeIDs := make([]string, len(positions))
	xs := make([]float64, len(positions))
	ys := make([]float64, len(positions))
	for index, position := range positions {
		nodeIDs[index] = position.NodeID
		xs[index] = position.X
		ys[index] = position.Y
	}

	rows, err := r.db.QueryContext(ctx, `
with input as (
  select node_id::uuid as node_id, x, y, ordinality
  from unnest($2::text[], $3::double precision[], $4::double precision[])
       with ordinality as input(node_id, x, y, ordinality)
),
missing as (
  select 1
  from input
  where not exists (
    select 1
    from nodes
    where company_id=$1 and node_id=input.node_id
  )
  limit 1
),
latest_input as (
  select distinct on (node_id) node_id, x, y
  from input
  order by node_id, ordinality desc
),
upserted as (
  insert into node_map_positions (company_id, node_id, x, y, updated_timestamp)
  select $1, latest_input.node_id, latest_input.x, latest_input.y, now()
  from latest_input
  where not exists (select 1 from missing)
  on conflict (company_id, node_id) do update
  set x=excluded.x,
      y=excluded.y,
      updated_timestamp=now()
  returning company_id, node_id, updated_timestamp
)
select upserted.company_id, input.node_id, input.x, input.y, upserted.updated_timestamp
from input
join upserted on upserted.node_id=input.node_id
order by input.ordinality`,
		companyID, nodeIDs, xs, ys,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item domain.NodeMapPosition
		if err := rows.Scan(&item.CompanyID, &item.NodeID, &item.X, &item.Y, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) != len(positions) {
		return nil, ErrNotFound
	}
	return out, nil
}

func (r *PostgresRepo) GetNodeDetails(companyID, nodeID string) (domain.NodeDetails, error) {
	return r.getNodeDetails(companyID, nodeID, true)
}

func (r *PostgresRepo) GetNodeDetailsSummary(companyID, nodeID string) (domain.NodeDetails, error) {
	return r.getNodeDetails(companyID, nodeID, false)
}

func (r *PostgresRepo) getNodeDetails(companyID, nodeID string, includeInformation bool) (domain.NodeDetails, error) {
	node, err := r.GetNode(companyID, nodeID)
	if err != nil {
		return domain.NodeDetails{}, err
	}

	ctx := context.Background()
	information := make([]domain.NodeInformation, 0)
	informationCount := 0
	if includeInformation {
		infoRows, err := r.db.QueryContext(ctx,
			`select company_id, information_id, node_id, type::text, information, created_timestamp, updated_timestamp
			 from node_information
			 where company_id=$1 and node_id=$2
			 order by created_timestamp asc`,
			companyID, nodeID,
		)
		if err != nil {
			return domain.NodeDetails{}, err
		}
		defer infoRows.Close()

		for infoRows.Next() {
			var item domain.NodeInformation
			if err := infoRows.Scan(
				&item.CompanyID,
				&item.InformationID,
				&item.NodeID,
				&item.Type,
				&item.Information,
				&item.CreatedTimestamp,
				&item.UpdatedTimestamp,
			); err != nil {
				return domain.NodeDetails{}, err
			}
			information = append(information, item)
		}
		if err := infoRows.Err(); err != nil {
			return domain.NodeDetails{}, err
		}
		informationCount = len(information)
	} else if err := r.db.QueryRowContext(ctx,
		`select count(*)
		   from node_information
		  where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	).Scan(&informationCount); err != nil {
		return domain.NodeDetails{}, err
	}

	relRows, err := r.db.QueryContext(ctx,
		`select company_id, node_relationship_id, node_id_a, node_id_b, a_position::text, b_position::text, created_timestamp
		 from node_relationships
		 where company_id=$1 and (node_id_a=$2 or node_id_b=$2)
		 order by created_timestamp asc`,
		companyID, nodeID,
	)
	if err != nil {
		return domain.NodeDetails{}, err
	}
	defer relRows.Close()

	relationships := make([]domain.NodeRelationship, 0)
	for relRows.Next() {
		var item domain.NodeRelationship
		if err := relRows.Scan(
			&item.CompanyID,
			&item.NodeRelationshipID,
			&item.NodeIDA,
			&item.NodeIDB,
			&item.APosition,
			&item.BPosition,
			&item.CreatedTimestamp,
		); err != nil {
			return domain.NodeDetails{}, err
		}
		relationships = append(relationships, item)
	}
	if err := relRows.Err(); err != nil {
		return domain.NodeDetails{}, err
	}

	return domain.NodeDetails{
		Node:               node,
		Information:        information,
		Relationships:      relationships,
		InformationCount:   informationCount,
		RelationshipsCount: len(relationships),
	}, nil
}

func (r *PostgresRepo) AddNodeInformation(companyID, nodeID, infoType, information, informationID string) (domain.NodeInformation, error) {
	return r.addNodeInformation(NodeInformationInput{
		CompanyID:     companyID,
		NodeID:        nodeID,
		Type:          infoType,
		Information:   information,
		InformationID: informationID,
	})
}

func (r *PostgresRepo) AddNodeInformationWithActor(input NodeInformationInput) (domain.NodeInformation, error) {
	return r.addNodeInformation(input)
}

func (r *PostgresRepo) addNodeInformation(input NodeInformationInput) (domain.NodeInformation, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.NodeInformation{}, err
	}
	defer tx.Rollback()

	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.NodeID)
	infoType := strings.TrimSpace(input.Type)
	informationID := strings.TrimSpace(input.InformationID)
	var exists bool
	if err := tx.QueryRowContext(ctx,
		`select exists(select 1 from nodes where company_id=$1 and node_id=$2)`,
		companyID, nodeID,
	).Scan(&exists); err != nil {
		return domain.NodeInformation{}, err
	}
	if !exists {
		return domain.NodeInformation{}, ErrNotFound
	}

	item := domain.NodeInformation{
		CompanyID:     companyID,
		InformationID: newUUIDv7String(),
		NodeID:        nodeID,
		Type:          infoType,
		Information:   input.Information,
	}
	if err := tx.QueryRowContext(ctx,
		`insert into node_information
		 (company_id, information_id, node_id, type, information, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4::information_type, $5, now(), now())
		 returning company_id, information_id, node_id, type::text, information, created_timestamp, updated_timestamp`,
		item.CompanyID, item.InformationID, item.NodeID, item.Type, item.Information,
	).Scan(
		&item.CompanyID,
		&item.InformationID,
		&item.NodeID,
		&item.Type,
		&item.Information,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); err != nil {
		return domain.NodeInformation{}, err
	}
	keyValue := informationID
	if keyValue == "" {
		keyValue = item.InformationID
	}
	previous, previousFound, err := postgresNodeProjectionTx(ctx, tx, companyID, nodeID, keyValue)
	if err != nil {
		return domain.NodeInformation{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`insert into node_projection_table
		 (company_id, node_id, information_id, type, information, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4::information_type, $5, now(), now())
		 on conflict (company_id, node_id, information_id)
		 do update set
		   type=excluded.type,
		   information=excluded.information,
		   updated_timestamp=now()`,
		item.CompanyID, item.NodeID, keyValue, item.Type, input.Information,
	); err != nil {
		return domain.NodeInformation{}, err
	}
	if strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "" {
		actor := normalizeNodeContentChangeActor(cleanUUIDText(input.ActorUserID), input.ActorDisplayName)
		var previousPtr *domain.NodeProjection
		if previousFound {
			previousPtr = &previous
		}
		if err := insertNodeContentChangesTx(ctx, tx, buildNodeContentChanges(
			companyID,
			nodeID,
			keyValue,
			infoType,
			previousPtr,
			input.Information,
			actor,
			time.Now().UTC(),
		)); err != nil {
			return domain.NodeInformation{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return domain.NodeInformation{}, err
	}
	return item, nil
}

func postgresNodeProjectionTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, informationID string) (domain.NodeProjection, bool, error) {
	var item domain.NodeProjection
	err := tx.QueryRowContext(ctx,
		`select company_id, node_id, information_id, type::text, information, created_timestamp, updated_timestamp
		   from node_projection_table
		  where company_id=$1 and node_id=$2 and information_id=$3`,
		companyID, nodeID, informationID,
	).Scan(
		&item.CompanyID,
		&item.NodeID,
		&item.InformationID,
		&item.Type,
		&item.Information,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NodeProjection{}, false, nil
	}
	if err != nil {
		return domain.NodeProjection{}, false, err
	}
	return item, true, nil
}

func insertNodeContentChangesTx(ctx context.Context, tx *sql.Tx, changes []domain.NodeContentChange) error {
	if len(changes) == 0 {
		return nil
	}
	for _, change := range changes {
		if _, err := tx.ExecContext(ctx, `
insert into node_content_changes
  (company_id, change_id, node_id, information_id, change_type, text, start_offset, end_offset, actor_user_id, actor_display_name, created_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, nullif($9::text, '')::uuid, $10, $11)`,
			change.CompanyID,
			change.ChangeID,
			change.NodeID,
			change.InformationID,
			change.ChangeType,
			change.Text,
			change.StartOffset,
			change.EndOffset,
			cleanUUIDText(change.ActorUserID),
			change.ActorDisplayName,
			change.CreatedTimestamp,
		); err != nil {
			return err
		}
		if actorUserID := cleanUUIDText(change.ActorUserID); actorUserID != "" {
			if _, err := tx.ExecContext(ctx, `
insert into node_content_change_seen (company_id, change_id, user_id, seen_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, now())
on conflict (company_id, change_id, user_id) do nothing`,
				change.CompanyID,
				change.ChangeID,
				actorUserID,
			); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *PostgresRepo) ListNodeProjections(companyID, nodeID string) ([]domain.NodeProjection, error) {
	ctx := context.Background()
	var exists bool
	if err := r.db.QueryRowContext(ctx,
		`select exists(select 1 from nodes where company_id=$1 and node_id=$2)`,
		companyID, nodeID,
	).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}

	rows, err := r.db.QueryContext(ctx,
		`select company_id, node_id, information_id, type::text, information, created_timestamp, updated_timestamp
		   from node_projection_table
		  where company_id=$1 and node_id=$2
		  order by created_timestamp asc, information_id asc`,
		companyID, nodeID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.NodeProjection, 0)
	for rows.Next() {
		var item domain.NodeProjection
		if err := rows.Scan(
			&item.CompanyID,
			&item.NodeID,
			&item.InformationID,
			&item.Type,
			&item.Information,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresRepo) DeleteNodeProjection(companyID, nodeID, informationID string) error {
	return r.deleteNodeProjection(NodeProjectionDeleteInput{
		CompanyID:     companyID,
		NodeID:        nodeID,
		InformationID: informationID,
	})
}

func (r *PostgresRepo) DeleteNodeProjectionWithActor(input NodeProjectionDeleteInput) error {
	return r.deleteNodeProjection(input)
}

func (r *PostgresRepo) deleteNodeProjection(input NodeProjectionDeleteInput) error {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.NodeID)
	informationID := strings.TrimSpace(input.InformationID)
	var exists bool
	if err := tx.QueryRowContext(ctx,
		`select exists(select 1 from nodes where company_id=$1 and node_id=$2)`,
		companyID, nodeID,
	).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	if strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "" {
		if previous, found, err := postgresNodeProjectionTx(ctx, tx, companyID, nodeID, informationID); err != nil {
			return err
		} else if found {
			previousCopy := previous
			if err := insertNodeContentChangesTx(ctx, tx, buildNodeContentChanges(
				companyID,
				nodeID,
				informationID,
				previous.Type,
				&previousCopy,
				"",
				normalizeNodeContentChangeActor(cleanUUIDText(input.ActorUserID), input.ActorDisplayName),
				time.Now().UTC(),
			)); err != nil {
				return err
			}
		}
	}
	_, err = tx.ExecContext(ctx,
		`delete from node_projection_table
		 where company_id=$1 and node_id=$2 and information_id=$3`,
		companyID, nodeID, informationID,
	)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListUnseenNodeContentChanges(input NodeContentChangeListInput) ([]domain.NodeContentChange, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.NodeID)
	userID := cleanUUIDText(input.UserID)
	if companyID == "" || nodeID == "" || userID == "" {
		return nil, ErrInvalid
	}
	ctx := context.Background()
	var exists bool
	if err := r.db.QueryRowContext(ctx,
		`select exists(select 1 from nodes where company_id=$1 and node_id=$2)`,
		companyID, nodeID,
	).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	rows, err := r.db.QueryContext(ctx, `
select projection.company_id::text,
       projection.node_id::text,
       projection.information_id::text,
       projection.information,
       coalesce(seen.information, ''),
       coalesce(actor.actor_user_id::text, ''),
       coalesce(actor.actor_display_name, ''),
       actor.created_timestamp
from node_projection_table projection
left join node_projection_seen_snapshots seen
  on seen.company_id=projection.company_id
 and seen.node_id=projection.node_id
 and seen.information_id=projection.information_id
 and seen.user_id=$3::uuid
left join lateral (
  select change.actor_user_id, change.actor_display_name, change.created_timestamp, change.change_id
    from node_content_changes change
   where change.company_id=projection.company_id
     and change.node_id=projection.node_id
     and change.information_id=projection.information_id
     and change.actor_user_id is distinct from $3::uuid
     and (seen.seen_timestamp is null or change.created_timestamp >= seen.seen_timestamp)
   order by change.created_timestamp desc, change.change_id desc
   limit 1
) actor on true
where projection.company_id=$1::uuid
  and projection.node_id=$2::uuid
  and projection.type='Text box'::information_type
  and actor.created_timestamp is not null
order by actor.created_timestamp asc, projection.created_timestamp asc, projection.information_id asc`, companyID, nodeID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.NodeContentChange, 0)
	for rows.Next() {
		var companyIDValue, nodeIDValue, informationID, currentInformation, seenInformation, actorUserID, actorDisplayName string
		var changedAt time.Time
		if err := rows.Scan(
			&companyIDValue,
			&nodeIDValue,
			&informationID,
			&currentInformation,
			&seenInformation,
			&actorUserID,
			&actorDisplayName,
			&changedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, buildNodeProjectionSnapshotChanges(
			companyIDValue,
			nodeIDValue,
			informationID,
			seenInformation,
			currentInformation,
			normalizeNodeContentChangeActor(actorUserID, actorDisplayName),
			changedAt,
		)...)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) MarkNodeContentChangeSeen(input NodeContentChangeSeenInput) (int, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.NodeID)
	changeID := strings.TrimSpace(input.ChangeID)
	userID := cleanUUIDText(input.UserID)
	if companyID == "" || nodeID == "" || userID == "" {
		return 0, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)`, companyID, nodeID); err != nil {
		return 0, err
	} else if !exists {
		return 0, ErrNotFound
	}

	if informationID := nodeProjectionInformationIDFromContentChangeID(changeID); informationID != "" {
		count, err := markNodeProjectionSeenSnapshotsTx(ctx, tx, companyID, nodeID, informationID, userID)
		if err != nil {
			return 0, err
		}
		if err := tx.Commit(); err != nil {
			return 0, err
		}
		return count, nil
	}

	if changeID != "" {
		rawChangeID := cleanUUIDText(changeID)
		if rawChangeID == "" {
			return 0, ErrInvalid
		}
		if exists, err := postgresTxExists(ctx, tx, `select exists(select 1 from node_content_changes where company_id=$1::uuid and node_id=$2::uuid and change_id=$3::uuid)`, companyID, nodeID, rawChangeID); err != nil {
			return 0, err
		} else if !exists {
			return 0, ErrNotFound
		}
		result, err := tx.ExecContext(ctx, `
insert into node_content_change_seen (company_id, change_id, user_id, seen_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, now())
on conflict (company_id, change_id, user_id) do nothing`, companyID, rawChangeID, userID)
		if err != nil {
			return 0, err
		}
		if err := tx.Commit(); err != nil {
			return 0, err
		}
		affected, _ := result.RowsAffected()
		return int(affected), nil
	}

	count, err := markNodeProjectionSeenSnapshotsTx(ctx, tx, companyID, nodeID, "", userID)
	if err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `
insert into node_content_change_seen (company_id, change_id, user_id, seen_timestamp)
select change.company_id, change.change_id, $3::uuid, now()
from node_content_changes change
where change.company_id=$1::uuid
  and change.node_id=$2::uuid
on conflict (company_id, change_id, user_id) do nothing`, companyID, nodeID, userID); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return count, nil
}

func markNodeProjectionSeenSnapshotsTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, informationID, userID string) (int, error) {
	if informationID != "" {
		result, err := tx.ExecContext(ctx, `
insert into node_projection_seen_snapshots
  (company_id, node_id, information_id, user_id, information, projection_updated_timestamp, seen_timestamp)
select projection.company_id, projection.node_id, projection.information_id, $4::uuid,
       projection.information, projection.updated_timestamp, now()
  from node_projection_table projection
 where projection.company_id=$1::uuid
   and projection.node_id=$2::uuid
   and projection.information_id=$3::uuid
   and projection.type='Text box'::information_type
on conflict (company_id, node_id, information_id, user_id)
do update set
  information=excluded.information,
  projection_updated_timestamp=excluded.projection_updated_timestamp,
  seen_timestamp=excluded.seen_timestamp`, companyID, nodeID, informationID, userID)
		if err != nil {
			return 0, err
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			return 0, ErrNotFound
		}
		return int(affected), nil
	}

	result, err := tx.ExecContext(ctx, `
insert into node_projection_seen_snapshots
  (company_id, node_id, information_id, user_id, information, projection_updated_timestamp, seen_timestamp)
select projection.company_id, projection.node_id, projection.information_id, $3::uuid,
       projection.information, projection.updated_timestamp, now()
  from node_projection_table projection
 where projection.company_id=$1::uuid
   and projection.node_id=$2::uuid
   and projection.type='Text box'::information_type
on conflict (company_id, node_id, information_id, user_id)
do update set
  information=excluded.information,
  projection_updated_timestamp=excluded.projection_updated_timestamp,
  seen_timestamp=excluded.seen_timestamp`, companyID, nodeID, userID)
	if err != nil {
		return 0, err
	}
	affected, _ := result.RowsAffected()
	return int(affected), nil
}

func (r *PostgresRepo) CreateNodeRelationship(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.NodeRelationship{}, err
	}
	defer tx.Rollback()

	item, err := r.createNodeRelationshipTx(ctx, tx, companyID, nodeIDA, nodeIDB, aPosition, bPosition)
	if err != nil {
		return domain.NodeRelationship{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.NodeRelationship{}, err
	}
	return item, nil
}

func (r *PostgresRepo) CreateNodeRelationshipAndWorkspaceEvent(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, domain.DomainEvent, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.NodeRelationship{}, domain.DomainEvent{}, err
	}
	defer tx.Rollback()

	item, err := r.createNodeRelationshipTx(ctx, tx, companyID, nodeIDA, nodeIDB, aPosition, bPosition)
	if err != nil {
		return domain.NodeRelationship{}, domain.DomainEvent{}, err
	}
	event, err := r.appendDomainEventTx(ctx, tx, relationshipCreatedWorkspaceEventInput(item))
	if err != nil {
		return domain.NodeRelationship{}, domain.DomainEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.NodeRelationship{}, domain.DomainEvent{}, err
	}
	return item, event, nil
}

func (r *PostgresRepo) createNodeRelationshipTx(ctx context.Context, tx *sql.Tx, companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, error) {
	for _, candidate := range []string{nodeIDA, nodeIDB} {
		var exists bool
		if err := tx.QueryRowContext(ctx,
			`select exists(select 1 from nodes where company_id=$1 and node_id=$2)`,
			companyID, candidate,
		).Scan(&exists); err != nil {
			return domain.NodeRelationship{}, err
		}
		if !exists {
			return domain.NodeRelationship{}, ErrNotFound
		}
	}

	item := domain.NodeRelationship{
		CompanyID:          companyID,
		NodeRelationshipID: newUUIDv7String(),
		NodeIDA:            nodeIDA,
		NodeIDB:            nodeIDB,
		APosition:          aPosition,
		BPosition:          bPosition,
	}
	if err := tx.QueryRowContext(ctx,
		`insert into node_relationships
		 (company_id, node_relationship_id, node_id_a, node_id_b, a_position, b_position, created_timestamp)
		 values ($1, $2, $3, $4, $5::node_relationship_position, $6::node_relationship_position, now())
		 returning company_id, node_relationship_id, node_id_a, node_id_b, a_position::text, b_position::text, created_timestamp`,
		item.CompanyID, item.NodeRelationshipID, item.NodeIDA, item.NodeIDB, item.APosition, item.BPosition,
	).Scan(
		&item.CompanyID,
		&item.NodeRelationshipID,
		&item.NodeIDA,
		&item.NodeIDB,
		&item.APosition,
		&item.BPosition,
		&item.CreatedTimestamp,
	); err != nil {
		return domain.NodeRelationship{}, err
	}
	return item, nil
}
