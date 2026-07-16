package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const nodeSelectColumns = `
n.company_id,
n.node_id,
n.name,
coalesce(
  case
    when assignment.is_issue then 'Issue'
    when assignment.assignment_id is not null then ` + postgresLogicGateAssignmentStatusTitleSQL + `
  end,
  nullif(n.status, '')
) as status,
n.due_date::text,
n.priority,
n.created_timestamp,
coalesce(node_logic_gates.logic_gate_ids_json, '[]') as logic_gate_ids_json,
coalesce(account_snapshot.accounts_json, '[]')::text as accounts_json`

const nodeStatusJoinBase = `
left join lateral (
  select assignment.*
  from node_logic_gate_assignments assignment
  where assignment.company_id = n.company_id
    and assignment.node_id = n.node_id
  order by assignment.updated_timestamp desc, assignment.created_timestamp desc, assignment.assignment_id desc
  limit 1
) assignment on true
left join lateral (
  select coalesce(jsonb_agg(gate.logic_gate_id order by gate.logic_gate_id), '[]'::jsonb)::text as logic_gate_ids_json
  from (
    select distinct assignment.logic_gate_id::text as logic_gate_id
    from node_logic_gate_assignments assignment
    where assignment.company_id = n.company_id
      and assignment.node_id = n.node_id
  ) gate
) node_logic_gates on true`

var nodeStatusJoin = nodeStatusJoinBase + "\n" + postgresAccountSnapshotsForNodeLateralSQL("n")

const postgresNodeMapWindowCTE = `
with windowed_positions as (
  select position.company_id, position.node_id, position.x, position.y, position.updated_timestamp
  from node_map_positions position
  where position.company_id=$1
    and false
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
)`, query.CompanyID, query.FolderID).Scan(&exists)
	return exists, err
}
func scanNode(row interface {
	Scan(dest ...any) error
}) (domain.Node, error) {
	var item domain.Node
	var status sql.NullString
	var dueDate sql.NullString
	var priority sql.NullInt64
	var logicGateIDsJSON sql.NullString
	var accountsJSON sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.NodeID,
		&item.Title,
		&status,
		&dueDate,
		&priority,
		&item.CreatedTimestamp,
		&logicGateIDsJSON,
		&accountsJSON,
	)
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
	if logicGateIDsJSON.Valid {
		var ids []string
		if json.Unmarshal([]byte(logicGateIDsJSON.String), &ids) == nil {
			item.LogicGateIDs = cleanStringList(ids)
		}
	}
	item.Accounts = scanAccountSnapshotsJSON(accountsJSON)
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

type postgresCompanyMemberReadModel struct {
	UserID string
	Name   *string
	Email  *string
}

func loadPostgresCompanyMemberReadModel(ctx context.Context, tx *sql.Tx, companyID, userID string) (postgresCompanyMemberReadModel, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return postgresCompanyMemberReadModel{}, nil
	}
	var item postgresCompanyMemberReadModel
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
		return postgresCompanyMemberReadModel{}, ErrPrincipalNotInCompany
	}
	if err != nil {
		return postgresCompanyMemberReadModel{}, err
	}
	if name.Valid {
		item.Name = &name.String
	}
	if email.Valid {
		item.Email = &email.String
	}
	return item, nil
}

func (r *PostgresRepo) CreateNode(companyID, title string) (domain.Node, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Node{}, err
	}
	defer tx.Rollback()

	item, err := r.createNodeWithIDProjectionAndFolderTx(ctx, tx, companyID, "", title, false, true)
	if err != nil {
		return domain.Node{}, err
	}
	err = syncNodeProjectionDependenciesTx(ctx, tx, NodeProjectionDependencyInput{
		CompanyID: item.CompanyID,
		NodeID:    item.NodeID,
	})
	if err != nil {
		return domain.Node{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Node{}, err
	}
	return item, nil
}

func (r *PostgresRepo) CreateNodeWithWorkspaceEvent(companyID, title string) (domain.Node, domain.DomainEvent, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	defer tx.Rollback()

	item, err := r.createNodeWithIDProjectionAndFolderTx(ctx, tx, companyID, "", title, false, true)
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	err = syncNodeProjectionDependenciesTx(ctx, tx, NodeProjectionDependencyInput{
		CompanyID: item.CompanyID,
		NodeID:    item.NodeID,
	})
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

func (r *PostgresRepo) createNodeTx(ctx context.Context, tx *sql.Tx, companyID, title string) (domain.Node, error) {
	return r.createNodeWithIDTx(ctx, tx, companyID, "", title)
}

func (r *PostgresRepo) createNodeWithIDTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, title string) (domain.Node, error) {
	return r.createNodeWithIDProjectionAndFolderTx(ctx, tx, companyID, nodeID, title, true, true)
}

func (r *PostgresRepo) createNodeWithIDWithoutProjectionTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, title string) (domain.Node, error) {
	return r.createNodeWithIDProjectionAndFolderTx(ctx, tx, companyID, nodeID, title, false, true)
}

func (r *PostgresRepo) createNodeWithIDWithoutProjectionOrFolderTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, title string) (domain.Node, error) {
	return r.createNodeWithIDProjectionAndFolderTx(ctx, tx, companyID, nodeID, title, false, false)
}

func (r *PostgresRepo) createNodeWithIDProjectionAndFolderTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, title string, syncProjection, syncFolderItem bool) (domain.Node, error) {
	nodeID = strings.TrimSpace(nodeID)
	if nodeID == "" {
		nodeID = newUUIDv7String()
	}
	item := domain.Node{CompanyID: companyID, NodeID: nodeID, Title: title, DefaultAccess: ResourceDefaultAccessEdit}
	if err := tx.QueryRowContext(ctx,
		`insert into nodes (company_id, node_id, name, created_timestamp)
		 values ($1, $2, $3, now())
		 returning company_id, node_id, name, created_timestamp`,
		item.CompanyID, item.NodeID, item.Title,
	).Scan(&item.CompanyID, &item.NodeID, &item.Title, &item.CreatedTimestamp); err != nil {
		return domain.Node{}, err
	}
	item.LogicGateIDs = []string{}
	item.Accounts = []domain.Account{}
	if syncProjection {
		if err := syncNodeProjectionDependenciesTx(ctx, tx, NodeProjectionDependencyInput{
			CompanyID: companyID,
			NodeID:    item.NodeID,
		}); err != nil {
			return domain.Node{}, err
		}
	}
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
	err = syncNodeProjectionDependenciesTx(ctx, tx, NodeProjectionDependencyInput{
		CompanyID: input.CompanyID,
		NodeID:    input.NodeID,
	})
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
	beforeEffective, err := postgresResourceGVICEffectiveAssignmentsForResource(ctx, tx, resourceGVICKey{companyID: input.CompanyID, resourceType: EntityTypeNode, resourceID: input.NodeID})
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	beforeGeneratedUserIDs := gvicEffectiveUserIDsForRole(beforeEffective, domain.GVICRoleGenerated)
	item, err := r.updateNodeTx(ctx, tx, input)
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	err = syncNodeProjectionDependenciesTx(ctx, tx, NodeProjectionDependencyInput{
		CompanyID: input.CompanyID,
		NodeID:    input.NodeID,
	})
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	afterEffective, err := postgresResourceGVICEffectiveAssignmentsForResource(ctx, tx, resourceGVICKey{companyID: input.CompanyID, resourceType: EntityTypeNode, resourceID: input.NodeID})
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	afterGeneratedUserIDs := gvicEffectiveUserIDsForRole(afterEffective, domain.GVICRoleGenerated)
	event, err := r.appendDomainEventTx(ctx, tx, nodeUpdatedWorkspaceEventInputForUpdate(input, before, item, beforeGeneratedUserIDs, afterGeneratedUserIDs))
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	return item, event, nil
}

func (r *PostgresRepo) updateNodeTx(ctx context.Context, tx *sql.Tx, input UpdateNodeInput) (domain.Node, error) {
	if err := postgresRejectEmailCollaborationNodeMutation(ctx, tx, input.CompanyID, input.NodeID); err != nil {
		return domain.Node{}, err
	}
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
	_, err := tx.ExecContext(ctx, `
update nodes
set name = case when $4 then $3 else name end,
    status = case when $6 then nullif($5::text, '') else status end,
    due_date = case when $8 then nullif($7::text, '')::date else due_date end,
    priority = case when $10 then $9::smallint else priority end
where company_id = $1 and node_id = $2`,
		input.CompanyID,
		input.NodeID,
		input.Title,
		input.TitleSet,
		status,
		input.StatusSet,
		dueDate,
		input.DueDateSet,
		input.Priority,
		input.PrioritySet,
	)
	if err != nil {
		return domain.Node{}, err
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
	if defaultAccess, err := postgresResourceDefaultAccess(ctx, tx, input.CompanyID, EntityTypeNode, input.NodeID); err == nil {
		item.DefaultAccess = defaultAccess
	} else if err != nil && !errors.Is(err, ErrNotFound) {
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
		 `+nodeStatusJoin+`
		 where n.company_id=$1::uuid
		   and mangorts_user_can_access_resource(n.company_id, 'node', n.node_id, $2::uuid, $3::text)
		 order by n.created_timestamp asc, n.node_id::text asc`,
		companyID, userID, EntityPermissionEdit,
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
	return []domain.Node{}, nil
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
	return []domain.Node{}, nil
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
	return []domain.NodeRelationship{}, nil
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
	if defaultAccess, err := postgresResourceDefaultAccess(ctx, r.db, companyID, EntityTypeNode, nodeID); err == nil {
		item.DefaultAccess = defaultAccess
	} else if err != nil && !errors.Is(err, ErrNotFound) {
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

	err = postgresDeleteNodeWithDependentProjectionsTx(ctx, tx, companyID, nodeID)
	if err != nil {
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

	err = postgresDeleteNodeWithDependentProjectionsTx(ctx, tx, companyID, nodeID)
	if err != nil {
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
	return []domain.NodeMapPosition{}, nil
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
	folders, err := r.ListCompanyExplorerFolderSubtree(query.CompanyID, query.FolderID, "")
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
	if err := postgresRejectEmailCollaborationNodeMutation(ctx, tx, companyID, nodeID); err != nil {
		return domain.NodeInformation{}, err
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
	var projection domain.NodeProjection
	if err := tx.QueryRowContext(ctx,
		`insert into node_projection_table
		 (company_id, node_id, information_id, type, information, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4::information_type, $5, now(), now())
		 on conflict (company_id, node_id, information_id)
		 do update set
		   type=excluded.type,
		   information=excluded.information,
		   is_deleted=false,
		   revision=node_projection_table.revision+1,
		   updated_timestamp=now()
		 returning company_id, node_id, information_id, type::text, information, created_timestamp, updated_timestamp`,
		item.CompanyID, item.NodeID, keyValue, item.Type, input.Information,
	).Scan(
		&projection.CompanyID,
		&projection.NodeID,
		&projection.InformationID,
		&projection.Type,
		&projection.Information,
		&projection.CreatedTimestamp,
		&projection.UpdatedTimestamp,
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

	if strings.EqualFold(infoType, "Text block chat") {
		outboxInput, err := nodeChatCreatedOutboxInput(item, keyValue)
		if err != nil {
			return domain.NodeInformation{}, err
		}
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, outboxInput); err != nil {
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
		`select company_id, node_id, information_id, type::text, information, is_deleted, revision, created_timestamp, updated_timestamp
		   from node_projection_table
		  where company_id=$1 and node_id=$2 and information_id=$3`,
		companyID, nodeID, informationID,
	).Scan(
		&item.CompanyID,
		&item.NodeID,
		&item.InformationID,
		&item.Type,
		&item.Information,
		&item.IsDeleted,
		&item.Revision,
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
		`select company_id, node_id, information_id, type::text, information, is_deleted, revision, created_timestamp, updated_timestamp
		   from node_projection_table
		  where company_id=$1 and node_id=$2
		    and not is_deleted
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
			&item.IsDeleted,
			&item.Revision,
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
	if collaboration, err := postgresEmailCollaborationByNode(ctx, tx, companyID, nodeID); err == nil && collaboration.AttachedEmailInformationID == informationID {
		return ErrProtectedEmailCollaborationResource
	} else if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	previous, previousFound, err := postgresNodeProjectionTx(ctx, tx, companyID, nodeID, informationID)
	if err != nil {
		return err
	}
	if (previousFound && isEditorTextBoxType(previous.Type)) || (!previousFound && input.ExpectedRevision != nil) {
		return deletePostgresNodeTextProjection(ctx, tx, input, previous, previousFound)
	}
	if previousFound && (strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "") {
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
	deleted, err := tx.ExecContext(ctx,
		`delete from node_projection_table
		 where company_id=$1 and node_id=$2 and information_id=$3`,
		companyID, nodeID, informationID,
	)
	if err != nil {
		return err
	}
	affected, err := deleted.RowsAffected()
	if err != nil {
		return err
	}
	if affected > 0 && previousFound && strings.EqualFold(strings.TrimSpace(previous.Type), "Text block chat") {
		outboxInput, err := nodeChatDeletedOutboxInput(previous)
		if err != nil {
			return err
		}
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, outboxInput); err != nil {
			return err
		}
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
select change.company_id::text,
       change.change_id::text,
       change.node_id::text,
       change.information_id::text,
       change.change_type,
       change.text,
       change.start_offset,
       change.end_offset,
       coalesce(change.actor_user_id::text, ''),
       coalesce(change.actor_display_name, ''),
       change.created_timestamp,
       coalesce(seen.information, '')
from node_content_changes change
join node_projection_table projection
  on projection.company_id=change.company_id
 and projection.node_id=change.node_id
 and projection.information_id=change.information_id
left join node_projection_seen_snapshots seen
  on seen.company_id=change.company_id
 and seen.node_id=change.node_id
 and seen.information_id=change.information_id
 and seen.user_id=$3::uuid
left join node_content_change_seen seen_change
  on seen_change.company_id=change.company_id
 and seen_change.change_id=change.change_id
 and seen_change.user_id=$3::uuid
where change.company_id=$1::uuid
  and change.node_id=$2::uuid
  and projection.type='Text box'::information_type
  and change.actor_user_id is distinct from $3::uuid
  and seen_change.change_id is null
  and (seen.seen_timestamp is null or change.created_timestamp >= seen.seen_timestamp)
order by change.created_timestamp asc, change.change_id asc`, companyID, nodeID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type unseenNodeContentChangeGroup struct {
		seenInformation string
		changes         []domain.NodeContentChange
	}
	groups := map[string]unseenNodeContentChangeGroup{}
	groupOrder := make([]string, 0)
	for rows.Next() {
		var item domain.NodeContentChange
		var seenInformation string
		if err := rows.Scan(
			&item.CompanyID,
			&item.ChangeID,
			&item.NodeID,
			&item.InformationID,
			&item.ChangeType,
			&item.Text,
			&item.StartOffset,
			&item.EndOffset,
			&item.ActorUserID,
			&item.ActorDisplayName,
			&item.CreatedTimestamp,
			&seenInformation,
		); err != nil {
			return nil, err
		}
		group, ok := groups[item.InformationID]
		if !ok {
			groupOrder = append(groupOrder, item.InformationID)
			group.seenInformation = seenInformation
		}
		group.changes = append(group.changes, item)
		groups[item.InformationID] = group
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items := make([]domain.NodeContentChange, 0, len(groups))
	for _, informationID := range groupOrder {
		group := groups[informationID]
		items = append(items, buildNodeProjectionAuthoredSnapshotChanges(
			companyID,
			nodeID,
			informationID,
			group.seenInformation,
			group.changes,
		)...)
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].ChangeID < items[j].ChangeID
	})
	return items, nil
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
		if _, err := tx.ExecContext(ctx, `
insert into node_content_change_seen (company_id, change_id, user_id, seen_timestamp)
select change.company_id, change.change_id, $4::uuid, now()
from node_content_changes change
where change.company_id=$1::uuid
  and change.node_id=$2::uuid
  and change.information_id=$3::uuid
on conflict (company_id, change_id, user_id) do nothing`, companyID, nodeID, informationID, userID); err != nil {
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
