package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

const nodeSelectColumns = `
n.company_id,
n.node_id,
n.name,
n.status,
n.due_date::text,
n.priority,
n.created_timestamp,
coalesce(node_logic_gates.logic_gate_ids_json, '[]') as logic_gate_ids_json,
coalesce(account_snapshot.accounts_json, '[]')::text as accounts_json`

const nodeStatusJoinBase = `
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
	item, event, err := r.updateNodeAndWorkspaceEventTx(ctx, tx, input)
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	return item, event, nil
}

func (r *PostgresRepo) updateNodeAndWorkspaceEventTx(ctx context.Context, tx *sql.Tx, input UpdateNodeInput) (domain.Node, domain.DomainEvent, error) {
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
	err = syncNodeProjectionDependenciesTx(ctx, tx, NodeProjectionDependencyInput{
		CompanyID: input.CompanyID,
		NodeID:    input.NodeID,
	})
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	event, err := r.appendDomainEventTx(ctx, tx, nodeUpdatedWorkspaceEventInputForUpdate(input, before, item))
	if err != nil {
		return domain.Node{}, domain.DomainEvent{}, err
	}
	return item, event, nil
}

func (r *PostgresRepo) updateNodeTx(ctx context.Context, tx *sql.Tx, input UpdateNodeInput) (domain.Node, error) {
	if input.StatusSet {
		var assigned bool
		if err := tx.QueryRowContext(ctx, `select exists(select 1 from node_logic_gate_assignments where company_id=$1::uuid and node_id=$2::uuid)`, input.CompanyID, input.NodeID).Scan(&assigned); err != nil {
			return domain.Node{}, err
		}
		status, err := normalizeNodeStatusForAssignment(input.Status, assigned)
		if err != nil {
			return domain.Node{}, err
		}
		input.Status = status
		if assigned {
			if _, err := tx.ExecContext(ctx, `update node_logic_gate_assignments set requested_by_user_id=case when $3='Requested' then coalesce(requested_by_user_id,nullif($4,'')::uuid) else null end where company_id=$1::uuid and node_id=$2::uuid`, input.CompanyID, input.NodeID, status, input.ActorUserID); err != nil {
				return domain.Node{}, err
			}
		}
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
		projections, err := listPostgresNodeFinalProjections(ctx, r.db, companyID, nodeID, true)
		if err != nil {
			return domain.NodeDetails{}, err
		}
		for _, projection := range projections {
			information = append(information, nodeProjectionAsInformation(projection))
		}
		informationCount = len(information)
	} else if err := r.db.QueryRowContext(ctx,
		`select
		  (select count(*) from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and deleted_timestamp is null)
		+ (select count(*) from node_textbox_chats where company_id=$1::uuid and node_id=$2::uuid and deleted_timestamp is null)
		+ (select count(*) from email_relationships where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid)`,
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
	item, err := r.addNodeInformationTx(ctx, tx, input)
	if err != nil {
		return domain.NodeInformation{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.NodeInformation{}, err
	}
	return item, nil
}

func (r *PostgresRepo) addNodeInformationTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput) (domain.NodeInformation, error) {
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
	if isTextboxChatType(infoType) {
		chatID := cleanUUIDText(informationID)
		if chatID == "" {
			chatID = newUUIDv7String()
		}
		projection, previousFound, err := upsertPostgresNodeTextboxChatTx(ctx, tx, input, chatID)
		if err != nil {
			return domain.NodeInformation{}, err
		}
		if previousFound {
			return domain.NodeInformation{}, ErrAlreadyExists
		}
		item := domain.NodeInformation{
			CompanyID: projection.CompanyID, InformationID: projection.InformationID, NodeID: projection.NodeID,
			Type: projection.Type, Information: projection.Information,
			CreatedTimestamp: projection.CreatedTimestamp, UpdatedTimestamp: projection.UpdatedTimestamp,
		}
		outboxInput, err := nodeChatCreatedOutboxInput(item, chatID)
		if err != nil {
			return domain.NodeInformation{}, err
		}
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, outboxInput); err != nil {
			return domain.NodeInformation{}, err
		}
		return item, nil
	}

	if !strings.EqualFold(infoType, "Attached email") {
		return domain.NodeInformation{}, ErrInvalid
	}
	keyValue := cleanUUIDText(informationID)
	if keyValue == "" {
		keyValue = newUUIDv7String()
	}
	projection, err := addPostgresNodeEmailRelationshipTx(ctx, tx, input, keyValue)
	if err != nil {
		return domain.NodeInformation{}, err
	}
	item := nodeProjectionAsInformation(projection)
	return item, nil
}

func postgresNodeProjectionTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, informationID string) (domain.NodeProjection, bool, error) {
	return postgresNodeFinalProjectionTx(ctx, tx, companyID, nodeID, informationID)
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

	return listPostgresNodeFinalProjections(ctx, r.db, companyID, nodeID, true)
}

func (r *PostgresRepo) ListNodeProjectionSummaries(companyID, nodeID string) ([]domain.NodeProjection, error) {
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
	return listPostgresNodeFinalProjections(ctx, r.db, companyID, nodeID, false)
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
	informationID := cleanUUIDText(input.InformationID)
	if informationID == "" {
		return ErrInvalid
	}
	if err := lockResourceSharedEmailDraftOwnerTx(ctx, tx, companyID, EntityTypeNode, nodeID); err != nil {
		return err
	}

	var emailThreadID string
	var relationshipTextboxID sql.NullString
	err = tx.QueryRowContext(ctx, `select email_thread_id::text,resource_textbox_id from email_relationships
where company_id=$1::uuid and email_relationship_id=$3::uuid
  and resource_type='node' and resource_id=$2::uuid
for update`, companyID, nodeID, informationID).Scan(&emailThreadID, &relationshipTextboxID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil {
		textboxID := ""
		if relationshipTextboxID.Valid {
			textboxID = cleanUUIDText(relationshipTextboxID.String)
			if textboxID == "" {
				return ErrInvalid
			}
			var lockedTextboxID string
			if err := tx.QueryRowContext(ctx, `select textbox_id::text
from node_textboxes
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid
for update`, companyID, nodeID, textboxID).Scan(&lockedTextboxID); err != nil {
				return err
			}
		} else {
			var hasNodeWork bool
			if err := tx.QueryRowContext(ctx, `select
  exists (
    select 1 from email_relationships relationship
    where relationship.company_id=$1::uuid and relationship.email_thread_id=$3::uuid
      and relationship.resource_type='node' and relationship.resource_id=$2::uuid
      and relationship.resource_textbox_id is not null
  )
	  or exists (
    select 1 from node_textbox_chats chat
    join email_messages message on message.company_id=chat.company_id
      and message.email_message_id=chat.selection_email_message_id
    where chat.company_id=$1::uuid and chat.node_id=$2::uuid
      and chat.selection_source='email' and chat.deleted_timestamp is null
      and message.email_thread_id=$3::uuid
	  )`, companyID, nodeID, emailThreadID).Scan(&hasNodeWork); err != nil {
				return err
			}
			if hasNodeWork {
				return ErrEmailRelationshipHasNodeWork
			}
			var emailMessageID string
			if err := tx.QueryRowContext(ctx, `select email_message_id::text from email_relationships
where company_id=$1::uuid and email_relationship_id=$2::uuid`, companyID, informationID).Scan(&emailMessageID); err != nil {
				return err
			}
			if err := retireExactResourceSharedEmailDraftTx(ctx, tx, companyID, EntityTypeNode, nodeID, emailMessageID); err != nil {
				return err
			}
		}
		var deletedTextboxID sql.NullString
		if err := tx.QueryRowContext(ctx, `delete from email_relationships
where company_id=$1::uuid and email_relationship_id=$3::uuid
  and resource_type='node' and resource_id=$2::uuid
returning resource_textbox_id`, companyID, nodeID, informationID).Scan(&deletedTextboxID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return nodeEmailRelationshipMutationError(err)
		}
		if deletedTextboxID.Valid {
			if _, err := tx.ExecContext(ctx, `update node_textboxes textbox
set color=null,updated_timestamp=clock_timestamp()
where textbox.company_id=$1::uuid and textbox.node_id=$2::uuid and textbox.textbox_id=$3::uuid
  and textbox.deleted_timestamp is null
  and not exists (
    select 1 from email_relationships relationship
    where relationship.company_id=textbox.company_id
      and relationship.resource_type='node'
      and relationship.resource_id=textbox.node_id
      and relationship.resource_textbox_id=textbox.textbox_id::text
  )`, companyID, nodeID, textboxID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `select mangorts_bump_node_view_version($1::uuid,$2::uuid)`, companyID, nodeID); err != nil {
				return err
			}
		}
		return nodeEmailRelationshipMutationError(tx.Commit())
	}

	previous, previousFound, err := postgresNodeProjectionTx(ctx, tx, companyID, nodeID, informationID)
	if err != nil {
		return err
	}
	chatPrevious, chatFound, err := deletePostgresNodeTextboxChatTx(ctx, tx, input)
	if err != nil {
		return err
	}
	if chatFound {
		outboxInput, err := nodeChatDeletedOutboxInput(chatPrevious)
		if err != nil {
			return err
		}
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, outboxInput); err != nil {
			return err
		}
		return tx.Commit()
	}
	if (previousFound && isEditorTextBoxType(previous.Type)) || (!previousFound && input.ExpectedRevision != nil) {
		return deletePostgresNodeTextProjection(ctx, tx, input, previous, previousFound)
	}
	return ErrNotFound
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
