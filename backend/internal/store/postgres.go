package store

import (
	"context"
	"database/sql"
	"errors"

	"miraeopus/backend/internal/domain"
)

type PostgresRepo struct {
	db *sql.DB
}

func NewPostgresRepo(db *sql.DB) *PostgresRepo {
	return &PostgresRepo{db: db}
}

func (r *PostgresRepo) CreateNode(companyID, title string) (domain.Node, error) {
	ctx := context.Background()
	item := domain.Node{CompanyID: companyID, NodeID: newUUIDv7String(), Title: title}
	err := r.db.QueryRowContext(ctx,
		`insert into nodes (company_id, node_id, title, created_timestamp)
		 values ($1, $2, $3, now())
		 returning company_id, node_id, title, created_timestamp`,
		item.CompanyID, item.NodeID, item.Title,
	).Scan(&item.CompanyID, &item.NodeID, &item.Title, &item.CreatedTimestamp)
	if err != nil {
		return domain.Node{}, err
	}
	return item, nil
}

func (r *PostgresRepo) UpdateNodeTitle(companyID, nodeID, title string) (domain.Node, error) {
	const q = `
UPDATE nodes
SET title = $3
WHERE company_id = $1 AND node_id = $2
RETURNING company_id, node_id, title, created_timestamp
`
	var item domain.Node
	if err := r.db.QueryRow(q, companyID, nodeID, title).Scan(&item.CompanyID, &item.NodeID, &item.Title, &item.CreatedTimestamp); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Node{}, ErrNotFound
		}
		return domain.Node{}, err
	}
	return item, nil
}

func (r *PostgresRepo) ListNodes(companyID string) ([]domain.Node, error) {
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`select company_id, node_id, title, created_timestamp
		 from nodes
		 where company_id=$1
		 order by created_timestamp asc`,
		companyID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.Node, 0)
	for rows.Next() {
		var item domain.Node
		if err := rows.Scan(&item.CompanyID, &item.NodeID, &item.Title, &item.CreatedTimestamp); err != nil {
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
	var item domain.Node
	err := r.db.QueryRowContext(ctx,
		`select company_id, node_id, title, created_timestamp
		 from nodes where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	).Scan(&item.CompanyID, &item.NodeID, &item.Title, &item.CreatedTimestamp)
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
		 order by updated_timestamp asc`,
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

func (r *PostgresRepo) CreateLogicGate(companyID, header string) (domain.LogicGate, error) {
	ctx := context.Background()
	item := domain.LogicGate{CompanyID: companyID, LogicGateID: newUUIDv7String(), Header: header}
	err := r.db.QueryRowContext(ctx,
		`insert into logic_gates (company_id, logic_gate_id, header, created_timestamp)
		 values ($1, $2, $3, now())
		 returning company_id, logic_gate_id, header, created_timestamp`,
		item.CompanyID, item.LogicGateID, item.Header,
	).Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp)
	if err != nil {
		return domain.LogicGate{}, err
	}
	return item, nil
}

func (r *PostgresRepo) UpdateLogicGateHeader(companyID, logicGateID, header string) (domain.LogicGate, error) {
	const q = `
UPDATE logic_gates
SET header = $3
WHERE company_id = $1 AND logic_gate_id = $2
RETURNING company_id, logic_gate_id, header, created_timestamp
`
	var item domain.LogicGate
	if err := r.db.QueryRow(q, companyID, logicGateID, header).Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.LogicGate{}, ErrNotFound
		}
		return domain.LogicGate{}, err
	}
	return item, nil
}

func (r *PostgresRepo) ListLogicGates(companyID string) ([]domain.LogicGate, error) {
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`select company_id, logic_gate_id, header, created_timestamp
		 from logic_gates
		 where company_id=$1
		 order by created_timestamp asc`,
		companyID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.LogicGate, 0)
	for rows.Next() {
		var item domain.LogicGate
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) GetLogicGate(companyID, logicGateID string) (domain.LogicGate, error) {
	ctx := context.Background()
	var item domain.LogicGate
	err := r.db.QueryRowContext(ctx,
		`select company_id, logic_gate_id, header, created_timestamp
		 from logic_gates where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	).Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.LogicGate{}, ErrNotFound
	}
	if err != nil {
		return domain.LogicGate{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteLogicGate(companyID, logicGateID string) error {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_relationships
		 where company_id=$1 and (logic_gate_id_a=$2 or logic_gate_id_b=$2)`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from company_explorer_folder_items
		 where company_id=$1 and item_type='logic_gate' and item_id=$2`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_information
		 where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	// Projection rows reference logic gates directly, so remove them before the gate.
	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_projection_table
		 where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_map_positions
		 where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	); err != nil {
		return err
	}

	deleted, err := tx.ExecContext(ctx,
		`delete from logic_gates
		 where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
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
	return tx.Commit()
}

func (r *PostgresRepo) ListLogicGateMapPositions(companyID string) ([]domain.LogicGateMapPosition, error) {
	rows, err := r.db.Query(`
select company_id, logic_gate_id, x, y, updated_timestamp
from logic_gate_map_positions
where company_id=$1
order by logic_gate_id asc`, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.LogicGateMapPosition, 0)
	for rows.Next() {
		var item domain.LogicGateMapPosition
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.X, &item.Y, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) UpsertLogicGateMapPositions(companyID string, positions []domain.LogicGateMapPosition) ([]domain.LogicGateMapPosition, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := make([]domain.LogicGateMapPosition, 0, len(positions))
	for _, position := range positions {
		var item domain.LogicGateMapPosition
		err := tx.QueryRowContext(ctx, `
insert into logic_gate_map_positions (company_id, logic_gate_id, x, y, updated_timestamp)
select $1, $2, $3, $4, now()
where exists (select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)
on conflict (company_id, logic_gate_id) do update
set x=excluded.x,
    y=excluded.y,
    updated_timestamp=now()
returning company_id, logic_gate_id, x, y, updated_timestamp`,
			companyID, position.LogicGateID, position.X, position.Y).Scan(
			&item.CompanyID, &item.LogicGateID, &item.X, &item.Y, &item.UpdatedTimestamp,
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

func (r *PostgresRepo) ListLogicGateRelationships(companyID string) ([]domain.LogicGateRelationship, error) {
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`select company_id, logic_gate_relationship_id, logic_gate_id_a, logic_gate_id_b, a_position::text, b_position::text, created_timestamp
		 from logic_gate_relationships
		 where company_id=$1
		 order by created_timestamp asc`,
		companyID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.LogicGateRelationship, 0)
	for rows.Next() {
		var item domain.LogicGateRelationship
		if err := rows.Scan(
			&item.CompanyID,
			&item.LogicGateRelationshipID,
			&item.LogicGateIDA,
			&item.LogicGateIDB,
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

func (r *PostgresRepo) CreateLogicGateRelationship(companyID, logicGateIDA, logicGateIDB, aPosition, bPosition string) (domain.LogicGateRelationship, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.LogicGateRelationship{}, err
	}
	defer tx.Rollback()

	for _, candidate := range []string{logicGateIDA, logicGateIDB} {
		var exists bool
		if err := tx.QueryRowContext(ctx,
			`select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`,
			companyID, candidate,
		).Scan(&exists); err != nil {
			return domain.LogicGateRelationship{}, err
		}
		if !exists {
			return domain.LogicGateRelationship{}, ErrNotFound
		}
	}

	item := domain.LogicGateRelationship{
		CompanyID:               companyID,
		LogicGateRelationshipID: newUUIDv7String(),
		LogicGateIDA:            logicGateIDA,
		LogicGateIDB:            logicGateIDB,
		APosition:               aPosition,
		BPosition:               bPosition,
	}
	if err := tx.QueryRowContext(ctx,
		`insert into logic_gate_relationships
		 (company_id, logic_gate_relationship_id, logic_gate_id_a, logic_gate_id_b, a_position, b_position, created_timestamp)
		 values ($1, $2, $3, $4, $5::logic_gate_relationship_position, $6::logic_gate_relationship_position, now())
		 returning company_id, logic_gate_relationship_id, logic_gate_id_a, logic_gate_id_b, a_position::text, b_position::text, created_timestamp`,
		item.CompanyID, item.LogicGateRelationshipID, item.LogicGateIDA, item.LogicGateIDB, item.APosition, item.BPosition,
	).Scan(
		&item.CompanyID,
		&item.LogicGateRelationshipID,
		&item.LogicGateIDA,
		&item.LogicGateIDB,
		&item.APosition,
		&item.BPosition,
		&item.CreatedTimestamp,
	); err != nil {
		return domain.LogicGateRelationship{}, err
	}

	if err := tx.Commit(); err != nil {
		return domain.LogicGateRelationship{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteLogicGateRelationship(companyID, relationshipID string) error {
	ctx := context.Background()
	deleted, err := r.db.ExecContext(ctx,
		`delete from logic_gate_relationships
		 where company_id=$1 and logic_gate_relationship_id=$2`,
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

func (r *PostgresRepo) AddLogicGateInformation(companyID, logicGateID, infoType, information, informationID string) (domain.LogicGateInformation, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.LogicGateInformation{}, err
	}
	defer tx.Rollback()

	var exists bool
	if err := tx.QueryRowContext(ctx,
		`select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`,
		companyID, logicGateID,
	).Scan(&exists); err != nil {
		return domain.LogicGateInformation{}, err
	}
	if !exists {
		return domain.LogicGateInformation{}, ErrNotFound
	}

	item := domain.LogicGateInformation{
		CompanyID:     companyID,
		InformationID: newUUIDv7String(),
		LogicGateID:   logicGateID,
		Type:          infoType,
		Information:   information,
	}
	if err := tx.QueryRowContext(ctx,
		`insert into logic_gate_information
		 (company_id, information_id, logic_gate_id, type, information, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4::information_type, $5, now(), now())
		 returning company_id, information_id, logic_gate_id, type::text, information, created_timestamp, updated_timestamp`,
		item.CompanyID, item.InformationID, item.LogicGateID, item.Type, item.Information,
	).Scan(
		&item.CompanyID,
		&item.InformationID,
		&item.LogicGateID,
		&item.Type,
		&item.Information,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); err != nil {
		return domain.LogicGateInformation{}, err
	}

	// History is append-only above. This read model keeps the latest value per
	// stable information_id for the editor and headless agents on hot read paths.
	projectionID := informationID
	if projectionID == "" {
		projectionID = item.InformationID
	}
	if _, err := tx.ExecContext(ctx,
		`insert into logic_gate_projection_table
		 (company_id, logic_gate_id, information_id, type, information, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4::information_type, $5, now(), now())
		 on conflict (company_id, logic_gate_id, information_id)
		 do update set
		   type=excluded.type,
		   information=excluded.information,
		   updated_timestamp=now()`,
		item.CompanyID, item.LogicGateID, projectionID, item.Type, item.Information,
	); err != nil {
		return domain.LogicGateInformation{}, err
	}

	if err := tx.Commit(); err != nil {
		return domain.LogicGateInformation{}, err
	}
	return item, nil
}

func (r *PostgresRepo) ListLogicGateProjections(companyID, logicGateID string) ([]domain.LogicGateProjection, error) {
	ctx := context.Background()
	var exists bool
	if err := r.db.QueryRowContext(ctx,
		`select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`,
		companyID, logicGateID,
	).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}

	rows, err := r.db.QueryContext(ctx,
		`select company_id, logic_gate_id, information_id, type::text, information, created_timestamp, updated_timestamp
		 from logic_gate_projection_table
		 where company_id=$1 and logic_gate_id=$2
		 order by updated_timestamp asc`,
		companyID, logicGateID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.LogicGateProjection, 0)
	for rows.Next() {
		var item domain.LogicGateProjection
		if err := rows.Scan(
			&item.CompanyID,
			&item.LogicGateID,
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

func (r *PostgresRepo) GetLogicGateDetails(companyID, logicGateID string) (domain.LogicGateDetails, error) {
	logicGate, err := r.GetLogicGate(companyID, logicGateID)
	if err != nil {
		return domain.LogicGateDetails{}, err
	}

	ctx := context.Background()
	infoRows, err := r.db.QueryContext(ctx,
		`select company_id, information_id, logic_gate_id, type::text, information, created_timestamp, updated_timestamp
		 from logic_gate_information
		 where company_id=$1 and logic_gate_id=$2
		 order by created_timestamp asc`,
		companyID, logicGateID,
	)
	if err != nil {
		return domain.LogicGateDetails{}, err
	}
	defer infoRows.Close()

	information := make([]domain.LogicGateInformation, 0)
	for infoRows.Next() {
		var item domain.LogicGateInformation
		if err := infoRows.Scan(
			&item.CompanyID,
			&item.InformationID,
			&item.LogicGateID,
			&item.Type,
			&item.Information,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return domain.LogicGateDetails{}, err
		}
		information = append(information, item)
	}
	if err := infoRows.Err(); err != nil {
		return domain.LogicGateDetails{}, err
	}

	relRows, err := r.db.QueryContext(ctx,
		`select company_id, logic_gate_relationship_id, logic_gate_id_a, logic_gate_id_b, a_position::text, b_position::text, created_timestamp
		 from logic_gate_relationships
		 where company_id=$1 and (logic_gate_id_a=$2 or logic_gate_id_b=$2)
		 order by created_timestamp asc`,
		companyID, logicGateID,
	)
	if err != nil {
		return domain.LogicGateDetails{}, err
	}
	defer relRows.Close()

	relationships := make([]domain.LogicGateRelationship, 0)
	for relRows.Next() {
		var item domain.LogicGateRelationship
		if err := relRows.Scan(
			&item.CompanyID,
			&item.LogicGateRelationshipID,
			&item.LogicGateIDA,
			&item.LogicGateIDB,
			&item.APosition,
			&item.BPosition,
			&item.CreatedTimestamp,
		); err != nil {
			return domain.LogicGateDetails{}, err
		}
		relationships = append(relationships, item)
	}
	if err := relRows.Err(); err != nil {
		return domain.LogicGateDetails{}, err
	}

	return domain.LogicGateDetails{
		LogicGate:     logicGate,
		Information:   information,
		Relationships: relationships,
	}, nil
}

func (r *PostgresRepo) CreateCompanyExplorerFolder(companyID, parentFolderID, folderKind, name string) (domain.CompanyExplorerFolder, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	defer tx.Rollback()

	var parent any
	if parentFolderID != "" {
		var parentKind string
		if err := tx.QueryRowContext(ctx,
			`select folder_kind
			 from company_explorer_folders
			 where company_id=$1 and folder_id=$2`,
			companyID, parentFolderID,
		).Scan(&parentKind); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return domain.CompanyExplorerFolder{}, ErrNotFound
			}
			return domain.CompanyExplorerFolder{}, err
		}
		if parentKind != folderKind {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		parent = parentFolderID
	}

	item := domain.CompanyExplorerFolder{
		CompanyID:  companyID,
		FolderID:   newUUIDv7String(),
		FolderKind: folderKind,
		Name:       name,
	}
	var parentOut sql.NullString
	if err := tx.QueryRowContext(ctx,
		`insert into company_explorer_folders
		 (company_id, folder_id, parent_folder_id, folder_kind, name, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, $5, now(), now())
		 returning company_id, folder_id, parent_folder_id, folder_kind, name, created_timestamp, updated_timestamp`,
		item.CompanyID, item.FolderID, parent, item.FolderKind, item.Name,
	).Scan(
		&item.CompanyID,
		&item.FolderID,
		&parentOut,
		&item.FolderKind,
		&item.Name,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	if parentOut.Valid {
		item.ParentFolderID = &parentOut.String
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return item, nil
}

func (r *PostgresRepo) ListCompanyExplorerFolders(companyID, folderKind string) ([]domain.CompanyExplorerFolder, error) {
	ctx := context.Background()
	var kindParam any
	if folderKind != "" {
		kindParam = folderKind
	}
	rows, err := r.db.QueryContext(ctx,
		`select company_id, folder_id, parent_folder_id, folder_kind, name, created_timestamp, updated_timestamp
		 from company_explorer_folders
		 where company_id=$1 and ($2::text is null or folder_kind=$2)
		 order by created_timestamp asc`,
		companyID, kindParam,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyExplorerFolder, 0)
	for rows.Next() {
		var item domain.CompanyExplorerFolder
		var parent sql.NullString
		if err := rows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&parent,
			&item.FolderKind,
			&item.Name,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		if parent.Valid {
			item.ParentFolderID = &parent.String
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) MoveCompanyExplorerFolder(companyID, folderID, parentFolderID string) (domain.CompanyExplorerFolder, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	defer tx.Rollback()

	var folderKind string
	if err := tx.QueryRowContext(ctx,
		`select folder_kind
		 from company_explorer_folders
		 where company_id=$1 and folder_id=$2
		 for update`,
		companyID, folderID,
	).Scan(&folderKind); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		return domain.CompanyExplorerFolder{}, err
	}
	if parentFolderID == folderID {
		return domain.CompanyExplorerFolder{}, ErrInvalid
	}

	var parent any
	if parentFolderID != "" {
		var parentKind string
		if err := tx.QueryRowContext(ctx,
			`select folder_kind
			 from company_explorer_folders
			 where company_id=$1 and folder_id=$2`,
			companyID, parentFolderID,
		).Scan(&parentKind); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return domain.CompanyExplorerFolder{}, ErrNotFound
			}
			return domain.CompanyExplorerFolder{}, err
		}
		if parentKind != folderKind {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}

		var createsCycle bool
		if err := tx.QueryRowContext(ctx,
			`with recursive descendants as (
			   select folder_id
			   from company_explorer_folders
			   where company_id=$1 and folder_id=$2
			   union all
			   select child.folder_id
			   from company_explorer_folders child
			   join descendants parent on child.company_id=$1 and child.parent_folder_id=parent.folder_id
			 )
			 select exists(select 1 from descendants where folder_id=$3)`,
			companyID, folderID, parentFolderID,
		).Scan(&createsCycle); err != nil {
			return domain.CompanyExplorerFolder{}, err
		}
		if createsCycle {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		parent = parentFolderID
	}

	var item domain.CompanyExplorerFolder
	var parentOut sql.NullString
	if err := tx.QueryRowContext(ctx,
		`update company_explorer_folders
		 set parent_folder_id=$3, updated_timestamp=now()
		 where company_id=$1 and folder_id=$2
		 returning company_id, folder_id, parent_folder_id, folder_kind, name, created_timestamp, updated_timestamp`,
		companyID, folderID, parent,
	).Scan(
		&item.CompanyID,
		&item.FolderID,
		&parentOut,
		&item.FolderKind,
		&item.Name,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		return domain.CompanyExplorerFolder{}, err
	}
	if parentOut.Valid {
		item.ParentFolderID = &parentOut.String
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteCompanyExplorerFolder(companyID, folderID string) error {
	ctx := context.Background()
	deleted, err := r.db.ExecContext(ctx,
		`delete from company_explorer_folders
		 where company_id=$1 and folder_id=$2`,
		companyID, folderID,
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
	// The self-referential folder FK and company_explorer_folder_items FK both cascade. Deleting
	// the root folder removes descendants and placements without touching nodes/gates.
	return nil
}

func (r *PostgresRepo) AssignCompanyExplorerFolderItem(companyID, folderID, itemType, itemID string) (domain.CompanyExplorerFolderItem, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolderItem{}, err
	}
	defer tx.Rollback()

	var folderKind string
	if err := tx.QueryRowContext(ctx,
		`select folder_kind
		 from company_explorer_folders
		 where company_id=$1 and folder_id=$2`,
		companyID, folderID,
	).Scan(&folderKind); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolderItem{}, ErrNotFound
		}
		return domain.CompanyExplorerFolderItem{}, err
	}
	if folderKind != itemType {
		return domain.CompanyExplorerFolderItem{}, ErrNotFound
	}

	var exists bool
	var existsQuery string
	if itemType == "node" {
		existsQuery = `select exists(select 1 from nodes where company_id=$1 and node_id=$2)`
	} else if itemType == "logic_gate" {
		existsQuery = `select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`
	} else {
		return domain.CompanyExplorerFolderItem{}, ErrNotFound
	}
	if err := tx.QueryRowContext(ctx, existsQuery, companyID, itemID).Scan(&exists); err != nil {
		return domain.CompanyExplorerFolderItem{}, err
	}
	if !exists {
		return domain.CompanyExplorerFolderItem{}, ErrNotFound
	}

	var item domain.CompanyExplorerFolderItem
	if err := tx.QueryRowContext(ctx,
		`insert into company_explorer_folder_items
		 (company_id, folder_id, item_type, item_id, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, now(), now())
		 on conflict (company_id, item_type, item_id)
		 do update set
		   folder_id=excluded.folder_id,
		   updated_timestamp=now()
		 returning company_id, folder_id, item_type, item_id, created_timestamp, updated_timestamp`,
		companyID, folderID, itemType, itemID,
	).Scan(
		&item.CompanyID,
		&item.FolderID,
		&item.ItemType,
		&item.ItemID,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); err != nil {
		return domain.CompanyExplorerFolderItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolderItem{}, err
	}
	return item, nil
}

func (r *PostgresRepo) ListCompanyExplorerFolderItems(companyID, folderID, itemType string) ([]domain.CompanyExplorerFolderItem, error) {
	ctx := context.Background()
	var folderParam any
	if folderID != "" {
		folderParam = folderID
	}
	var itemTypeParam any
	if itemType != "" {
		itemTypeParam = itemType
	}
	rows, err := r.db.QueryContext(ctx,
		`select company_id, folder_id, item_type, item_id, created_timestamp, updated_timestamp
		 from company_explorer_folder_items
		 where company_id=$1
		   and ($2::uuid is null or folder_id=$2::uuid)
		   and ($3::text is null or item_type=$3)
		 order by created_timestamp asc`,
		companyID, folderParam, itemTypeParam,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyExplorerFolderItem, 0)
	for rows.Next() {
		var item domain.CompanyExplorerFolderItem
		if err := rows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&item.ItemType,
			&item.ItemID,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) RemoveCompanyExplorerFolderItem(companyID, itemType, itemID string) error {
	ctx := context.Background()
	deleted, err := r.db.ExecContext(ctx,
		`delete from company_explorer_folder_items
		 where company_id=$1 and item_type=$2 and item_id=$3`,
		companyID, itemType, itemID,
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

func (r *PostgresRepo) CreateOperation(in CreateOperationInput) (domain.Operation, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Operation{}, err
	}
	defer tx.Rollback()

	if in.NodeID != nil {
		var nodeExists bool
		if err := tx.QueryRowContext(ctx,
			`select exists(select 1 from nodes where company_id=$1 and node_id=$2)`,
			in.CompanyID, *in.NodeID,
		).Scan(&nodeExists); err != nil {
			return domain.Operation{}, err
		}
		if !nodeExists {
			return domain.Operation{}, ErrNotFound
		}
	}
	if in.LogicGateID != nil {
		var gateExists bool
		if err := tx.QueryRowContext(ctx,
			`select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`,
			in.CompanyID, *in.LogicGateID,
		).Scan(&gateExists); err != nil {
			return domain.Operation{}, err
		}
		if !gateExists {
			return domain.Operation{}, ErrNotFound
		}
	}

	item := domain.Operation{
		CompanyID:      in.CompanyID,
		OperationID:    newUUIDv7String(),
		NodeID:         in.NodeID,
		LogicGateID:    in.LogicGateID,
		Status:         in.Status,
		StartTimestamp: in.StartTimestamp,
		EndTimestamp:   in.EndTimestamp,
	}

	if err := tx.QueryRowContext(ctx,
		`insert into operations
		 (company_id, operation_id, node_id, logic_gate_id, status, start_timestamp, end_timestamp)
		 values ($1, $2, $3, $4, $5::operation_status, $6, $7)
		 returning company_id, operation_id, node_id, logic_gate_id, status::text, start_timestamp, end_timestamp`,
		item.CompanyID, item.OperationID, item.NodeID, item.LogicGateID, item.Status, item.StartTimestamp, item.EndTimestamp,
	).Scan(
		&item.CompanyID,
		&item.OperationID,
		&item.NodeID,
		&item.LogicGateID,
		&item.Status,
		&item.StartTimestamp,
		&item.EndTimestamp,
	); err != nil {
		return domain.Operation{}, err
	}

	if err := tx.Commit(); err != nil {
		return domain.Operation{}, err
	}
	return item, nil
}

func (r *PostgresRepo) GetOperation(companyID, operationID string) (domain.Operation, error) {
	ctx := context.Background()
	var item domain.Operation
	err := r.db.QueryRowContext(ctx,
		`select company_id, operation_id, node_id, logic_gate_id, status::text, start_timestamp, end_timestamp
		 from operations where company_id=$1 and operation_id=$2`,
		companyID, operationID,
	).Scan(
		&item.CompanyID,
		&item.OperationID,
		&item.NodeID,
		&item.LogicGateID,
		&item.Status,
		&item.StartTimestamp,
		&item.EndTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Operation{}, ErrNotFound
	}
	if err != nil {
		return domain.Operation{}, err
	}
	return item, nil
}

func scanKanbanColumn(row interface {
	Scan(dest ...any) error
}) (domain.KanbanColumn, error) {
	var item domain.KanbanColumn
	err := row.Scan(
		&item.CompanyID,
		&item.BoardID,
		&item.ColumnID,
		&item.Title,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	return item, err
}

func scanKanbanCard(row interface {
	Scan(dest ...any) error
}) (domain.KanbanCard, error) {
	var item domain.KanbanCard
	err := row.Scan(
		&item.CompanyID,
		&item.BoardID,
		&item.CardID,
		&item.ColumnID,
		&item.ItemType,
		&item.ItemID,
		&item.TitleSnapshot,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	return item, err
}

func (r *PostgresRepo) ListKanbanColumns(companyID, boardID string) ([]domain.KanbanColumn, error) {
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx, `
select company_id, board_id, column_id, title, position, created_timestamp, updated_timestamp
from kanban_columns
where company_id=$1 and board_id=$2
order by position asc, created_timestamp asc`, companyID, boardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.KanbanColumn, 0)
	for rows.Next() {
		item, err := scanKanbanColumn(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CreateKanbanColumn(companyID, boardID, title string, position int) (domain.KanbanColumn, error) {
	ctx := context.Background()
	if position <= 0 {
		if err := r.db.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from kanban_columns
where company_id=$1 and board_id=$2`, companyID, boardID).Scan(&position); err != nil {
			return domain.KanbanColumn{}, err
		}
	}
	return scanKanbanColumn(r.db.QueryRowContext(ctx, `
insert into kanban_columns (company_id, board_id, column_id, title, position, created_timestamp, updated_timestamp)
values ($1, $2, $3, $4, $5, now(), now())
returning company_id, board_id, column_id, title, position, created_timestamp, updated_timestamp`,
		companyID, boardID, newUUIDv7String(), title, position,
	))
}

func (r *PostgresRepo) UpdateKanbanColumnTitle(companyID, boardID, columnID, title string) (domain.KanbanColumn, error) {
	item, err := scanKanbanColumn(r.db.QueryRow(`
update kanban_columns
set title=$4, updated_timestamp=now()
where company_id=$1 and board_id=$2 and column_id=$3
returning company_id, board_id, column_id, title, position, created_timestamp, updated_timestamp`,
		companyID, boardID, columnID, title,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.KanbanColumn{}, ErrNotFound
	}
	return item, err
}

func (r *PostgresRepo) DeleteKanbanColumn(companyID, boardID, columnID string) error {
	result, err := r.db.Exec(`
delete from kanban_columns
where company_id=$1 and board_id=$2 and column_id=$3`,
		companyID, boardID, columnID,
	)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) ListKanbanCards(companyID, boardID, columnID string, afterPosition int, limit int) ([]domain.KanbanCard, error) {
	ctx := context.Background()
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := r.db.QueryContext(ctx, `
select company_id, board_id, card_id, column_id, item_type,
       coalesce(node_id::text, logic_gate_id::text) as item_id,
       title_snapshot, position, created_timestamp, updated_timestamp
from kanban_cards
where company_id=$1 and board_id=$2
  and ($3 = '' or column_id::text = $3)
  and ($4 <= 0 or position > $4)
order by column_id, position asc, created_timestamp asc
limit $5`, companyID, boardID, columnID, afterPosition, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.KanbanCard, 0)
	for rows.Next() {
		item, err := scanKanbanCard(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) UpsertKanbanCard(companyID, boardID, columnID, itemType, itemID, titleSnapshot string, position int) (domain.KanbanCard, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.KanbanCard{}, err
	}
	defer tx.Rollback()

	var columnExists bool
	if err := tx.QueryRowContext(ctx, `
select exists(select 1 from kanban_columns where company_id=$1 and board_id=$2 and column_id=$3)`,
		companyID, boardID, columnID).Scan(&columnExists); err != nil {
		return domain.KanbanCard{}, err
	}
	if !columnExists {
		return domain.KanbanCard{}, ErrNotFound
	}

	if itemType != "node" && itemType != "logic_gate" {
		return domain.KanbanCard{}, ErrNotFound
	}
	existsQuery := `select exists(select 1 from nodes where company_id=$1 and node_id=$2)`
	if itemType == "logic_gate" {
		existsQuery = `select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`
	}
	var itemExists bool
	if err := tx.QueryRowContext(ctx, existsQuery, companyID, itemID).Scan(&itemExists); err != nil {
		return domain.KanbanCard{}, err
	}
	if !itemExists {
		return domain.KanbanCard{}, ErrNotFound
	}

	if position <= 0 {
		if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from kanban_cards
where company_id=$1 and board_id=$2 and column_id=$3`, companyID, boardID, columnID).Scan(&position); err != nil {
			return domain.KanbanCard{}, err
		}
	}

	var item domain.KanbanCard
	updateQuery := `
update kanban_cards
set column_id=$4, title_snapshot=$5, position=$6, updated_timestamp=now()
where company_id=$1 and board_id=$2 and item_type=$3 and node_id=$7
returning company_id, board_id, card_id, column_id, item_type,
          coalesce(node_id::text, logic_gate_id::text), title_snapshot, position, created_timestamp, updated_timestamp`
	updateArgs := []any{companyID, boardID, itemType, columnID, titleSnapshot, position, itemID}
	if itemType == "logic_gate" {
		updateQuery = `
update kanban_cards
set column_id=$4, title_snapshot=$5, position=$6, updated_timestamp=now()
where company_id=$1 and board_id=$2 and item_type=$3 and logic_gate_id=$7
returning company_id, board_id, card_id, column_id, item_type,
          coalesce(node_id::text, logic_gate_id::text), title_snapshot, position, created_timestamp, updated_timestamp`
	}
	item, err = scanKanbanCard(tx.QueryRowContext(ctx, updateQuery, updateArgs...))
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return domain.KanbanCard{}, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		var nodeID any
		var logicGateID any
		if itemType == "node" {
			nodeID = itemID
		} else {
			logicGateID = itemID
		}
		item, err = scanKanbanCard(tx.QueryRowContext(ctx, `
insert into kanban_cards (
  company_id, board_id, card_id, column_id, item_type, node_id, logic_gate_id, title_snapshot, position, created_timestamp, updated_timestamp
) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now())
returning company_id, board_id, card_id, column_id, item_type,
          coalesce(node_id::text, logic_gate_id::text), title_snapshot, position, created_timestamp, updated_timestamp`,
			companyID, boardID, newUUIDv7String(), columnID, itemType, nodeID, logicGateID, titleSnapshot, position,
		))
		if err != nil {
			return domain.KanbanCard{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return domain.KanbanCard{}, err
	}
	return item, nil
}

func (r *PostgresRepo) MoveKanbanCard(companyID, boardID, cardID, columnID string, position int) (domain.KanbanCard, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.KanbanCard{}, err
	}
	defer tx.Rollback()

	var columnExists bool
	if err := tx.QueryRowContext(ctx, `
select exists(select 1 from kanban_columns where company_id=$1 and board_id=$2 and column_id=$3)`,
		companyID, boardID, columnID).Scan(&columnExists); err != nil {
		return domain.KanbanCard{}, err
	}
	if !columnExists {
		return domain.KanbanCard{}, ErrNotFound
	}
	if position <= 0 {
		if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from kanban_cards
where company_id=$1 and board_id=$2 and column_id=$3`, companyID, boardID, columnID).Scan(&position); err != nil {
			return domain.KanbanCard{}, err
		}
	}

	item, err := scanKanbanCard(tx.QueryRowContext(ctx, `
update kanban_cards
set column_id=$4, position=$5, updated_timestamp=now()
where company_id=$1 and board_id=$2 and card_id=$3
returning company_id, board_id, card_id, column_id, item_type,
          coalesce(node_id::text, logic_gate_id::text), title_snapshot, position, created_timestamp, updated_timestamp`,
		companyID, boardID, cardID, columnID, position,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.KanbanCard{}, ErrNotFound
	}
	if err != nil {
		return domain.KanbanCard{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.KanbanCard{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteKanbanCard(companyID, boardID, cardID string) error {
	result, err := r.db.Exec(`
delete from kanban_cards
where company_id=$1 and board_id=$2 and card_id=$3`,
		companyID, boardID, cardID,
	)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}
