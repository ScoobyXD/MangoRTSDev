package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

const nodeSelectColumns = `
n.company_id,
n.node_id,
n.title,
coalesce(
  case
    when card.is_issue then 'Issue'
    else column_row.title
  end,
  nullif(n.status, '')
) as status,
coalesce(
  case
    when card.is_issue then '#ffd400'
    else column_row.item_color
  end,
  nullif(n.status_color, '')
) as status_color,
n.due_date::text,
n.priority,
n.assignee_user_id::text,
nullif(assignee.display_name, '') as assignee_name,
nullif(assignee.email, '') as assignee_email,
n.created_timestamp`

const nodeStatusJoin = `
left join kanban_cards card
  on card.company_id = n.company_id
 and card.node_id = n.node_id
 and card.logic_gate_id is not null
left join kanban_columns column_row
  on column_row.company_id = card.company_id
 and column_row.board_id = card.board_id
 and column_row.column_id = card.column_id
left join company_memberships assignee_membership
  on assignee_membership.company_id = n.company_id
 and assignee_membership.user_id = n.assignee_user_id
left join users assignee
  on assignee.user_id = assignee_membership.user_id`

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
	return item, err
}

func (r *PostgresRepo) CreateNode(companyID, title string) (domain.Node, error) {
	ctx := context.Background()
	item := domain.Node{CompanyID: companyID, NodeID: newUUIDv7String(), Title: title}
	_, err := r.db.ExecContext(ctx,
		`insert into nodes (company_id, node_id, title, created_timestamp)
		 values ($1, $2, $3, now())
		`,
		item.CompanyID, item.NodeID, item.Title,
	)
	if err != nil {
		return domain.Node{}, err
	}
	return r.GetNode(companyID, item.NodeID)
}

func (r *PostgresRepo) UpdateNode(input UpdateNodeInput) (domain.Node, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Node{}, err
	}
	defer tx.Rollback()

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
	_, err = tx.ExecContext(ctx, `
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
	if err := tx.Commit(); err != nil {
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

func (r *PostgresRepo) DeleteNodeRelationship(companyID, relationshipID string) error {
	ctx := context.Background()
	deleted, err := r.db.ExecContext(ctx,
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

	if _, err := tx.ExecContext(ctx,
		`delete from node_relationships
		 where company_id=$1 and (node_id_a=$2 or node_id_b=$2)`,
		companyID, nodeID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from company_explorer_folder_items
		 where company_id=$1 and item_type='node' and item_id=$2`,
		companyID, nodeID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from kanban_cards
		 where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx,
		`delete from node_information
		 where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	); err != nil {
		return err
	}

	// Projection rows also reference nodes directly. Remove them before deleting the node row
	// so FK checks pass for nodes that have editor/node information history.
	if _, err := tx.ExecContext(ctx,
		`delete from node_projection_table
		 where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx,
		`delete from node_map_positions
		 where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	); err != nil {
		return err
	}

	deletedNode, err := tx.ExecContext(ctx,
		`delete from nodes
		 where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	)
	if err != nil {
		return err
	}
	affected, err := deletedNode.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}

	return tx.Commit()
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

func (r *PostgresRepo) UpsertNodeMapPositions(companyID string, positions []domain.NodeMapPosition) ([]domain.NodeMapPosition, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := make([]domain.NodeMapPosition, 0, len(positions))
	for _, position := range positions {
		var item domain.NodeMapPosition
		err := tx.QueryRowContext(ctx, `
insert into node_map_positions (company_id, node_id, x, y, updated_timestamp)
select $1, $2, $3, $4, now()
where exists (select 1 from nodes where company_id=$1 and node_id=$2)
on conflict (company_id, node_id) do update
set x=excluded.x,
    y=excluded.y,
    updated_timestamp=now()
returning company_id, node_id, x, y, updated_timestamp`,
			companyID, position.NodeID, position.X, position.Y).Scan(
			&item.CompanyID, &item.NodeID, &item.X, &item.Y, &item.UpdatedTimestamp,
		)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *PostgresRepo) GetNodeDetails(companyID, nodeID string) (domain.NodeDetails, error) {
	node, err := r.GetNode(companyID, nodeID)
	if err != nil {
		return domain.NodeDetails{}, err
	}

	ctx := context.Background()
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

	information := make([]domain.NodeInformation, 0)
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
		Node:          node,
		Information:   information,
		Relationships: relationships,
	}, nil
}

func (r *PostgresRepo) AddNodeInformation(companyID, nodeID, infoType, information, informationID string) (domain.NodeInformation, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.NodeInformation{}, err
	}
	defer tx.Rollback()

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
		Information:   information,
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
	if _, err := tx.ExecContext(ctx,
		`insert into node_projection_table
		 (company_id, node_id, information_id, type, information, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4::information_type, $5, now(), now())
		 on conflict (company_id, node_id, information_id)
		 do update set
		   type=excluded.type,
		   information=excluded.information,
		   updated_timestamp=now()`,
		item.CompanyID, item.NodeID, keyValue, item.Type, information,
	); err != nil {
		return domain.NodeInformation{}, err
	}

	if err := tx.Commit(); err != nil {
		return domain.NodeInformation{}, err
	}
	return item, nil
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
	ctx := context.Background()
	var exists bool
	if err := r.db.QueryRowContext(ctx,
		`select exists(select 1 from nodes where company_id=$1 and node_id=$2)`,
		companyID, nodeID,
	).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	_, err := r.db.ExecContext(ctx,
		`delete from node_projection_table
		 where company_id=$1 and node_id=$2 and information_id=$3`,
		companyID, nodeID, informationID,
	)
	return err
}

func (r *PostgresRepo) CreateNodeRelationship(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.NodeRelationship{}, err
	}
	defer tx.Rollback()

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

	if err := tx.Commit(); err != nil {
		return domain.NodeRelationship{}, err
	}
	return item, nil
}
