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

func (r *PostgresRepo) AppendWorkspaceContextEvent(event domain.WorkspaceContextEvent) (domain.WorkspaceContextProjection, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.WorkspaceContextProjection{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
insert into workspace_context_events (
 company_id, workspace_id, context_id, source_module_id, sequence, user_action_type, payload_json
) values ($1,$2,$3,$4,$5,$6,$7)`,
		event.CompanyID, event.WorkspaceID, event.ContextID, event.SourceModuleID, event.Sequence, event.UserActionType, event.PayloadJSON); err != nil {
		return domain.WorkspaceContextProjection{}, err
	}
	if _, err := tx.ExecContext(ctx, `
insert into workspace_context_projections (
 company_id, workspace_id, context_id, last_sequence, last_event_timestamp, last_payload_json, updated_timestamp
) values ($1,$2,$3,$4,now(),$5,now())
on conflict (company_id, workspace_id, context_id) do update
set last_sequence = excluded.last_sequence,
    last_event_timestamp = excluded.last_event_timestamp,
    last_payload_json = excluded.last_payload_json,
    updated_timestamp = now()
where workspace_context_projections.last_sequence <= excluded.last_sequence`,
		event.CompanyID, event.WorkspaceID, event.ContextID, event.Sequence, event.PayloadJSON); err != nil {
		return domain.WorkspaceContextProjection{}, err
	}
	var out domain.WorkspaceContextProjection
	if err := tx.QueryRowContext(ctx, `
select company_id, workspace_id, context_id, last_sequence, last_event_timestamp, last_payload_json, updated_timestamp
from workspace_context_projections
where company_id=$1 and workspace_id=$2 and context_id=$3`,
		event.CompanyID, event.WorkspaceID, event.ContextID).Scan(
		&out.CompanyID, &out.WorkspaceID, &out.ContextID, &out.LastSequence, &out.LastEventAt, &out.LastPayloadJSON, &out.UpdatedTimestamp,
	); err != nil {
		return domain.WorkspaceContextProjection{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.WorkspaceContextProjection{}, err
	}
	return out, nil
}

func (r *PostgresRepo) GetWorkspaceContextProjection(companyID, workspaceID, contextID string) (domain.WorkspaceContextProjection, error) {
	var out domain.WorkspaceContextProjection
	if err := r.db.QueryRow(`
select company_id, workspace_id, context_id, last_sequence, last_event_timestamp, last_payload_json, updated_timestamp
from workspace_context_projections
where company_id=$1 and workspace_id=$2 and context_id=$3`,
		companyID, workspaceID, contextID).Scan(
		&out.CompanyID, &out.WorkspaceID, &out.ContextID, &out.LastSequence, &out.LastEventAt, &out.LastPayloadJSON, &out.UpdatedTimestamp,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.WorkspaceContextProjection{}, ErrNotFound
		}
		return domain.WorkspaceContextProjection{}, err
	}
	return out, nil
}

func (r *PostgresRepo) ListWorkspaceContextEventsAfterSequence(companyID, workspaceID, contextID string, afterSequence int64, limit int) ([]domain.WorkspaceContextEvent, error) {
	if limit <= 0 {
		limit = 250
	}
	rows, err := r.db.Query(`
select company_id, workspace_id, context_id, source_module_id, sequence, user_action_type, payload_json::text, created_timestamp
from workspace_context_events
where company_id=$1 and workspace_id=$2 and context_id=$3 and sequence > $4
order by sequence asc
limit $5`,
		companyID, workspaceID, contextID, afterSequence, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.WorkspaceContextEvent, 0)
	for rows.Next() {
		var item domain.WorkspaceContextEvent
		if err := rows.Scan(&item.CompanyID, &item.WorkspaceID, &item.ContextID, &item.SourceModuleID, &item.Sequence, &item.UserActionType, &item.PayloadJSON, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
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
		`delete from workspace_folder_items
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
		`delete from workspace_folder_items
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

func (r *PostgresRepo) CreateWorkspaceFolder(companyID, parentFolderID, folderKind, name string) (domain.WorkspaceFolder, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.WorkspaceFolder{}, err
	}
	defer tx.Rollback()

	var parent any
	if parentFolderID != "" {
		var parentKind string
		if err := tx.QueryRowContext(ctx,
			`select folder_kind
			 from workspace_folders
			 where company_id=$1 and folder_id=$2`,
			companyID, parentFolderID,
		).Scan(&parentKind); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return domain.WorkspaceFolder{}, ErrNotFound
			}
			return domain.WorkspaceFolder{}, err
		}
		if parentKind != folderKind {
			return domain.WorkspaceFolder{}, ErrNotFound
		}
		parent = parentFolderID
	}

	item := domain.WorkspaceFolder{
		CompanyID:  companyID,
		FolderID:   newUUIDv7String(),
		FolderKind: folderKind,
		Name:       name,
	}
	var parentOut sql.NullString
	if err := tx.QueryRowContext(ctx,
		`insert into workspace_folders
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
		return domain.WorkspaceFolder{}, err
	}
	if parentOut.Valid {
		item.ParentFolderID = &parentOut.String
	}
	if err := tx.Commit(); err != nil {
		return domain.WorkspaceFolder{}, err
	}
	return item, nil
}

func (r *PostgresRepo) ListWorkspaceFolders(companyID, folderKind string) ([]domain.WorkspaceFolder, error) {
	ctx := context.Background()
	var kindParam any
	if folderKind != "" {
		kindParam = folderKind
	}
	rows, err := r.db.QueryContext(ctx,
		`select company_id, folder_id, parent_folder_id, folder_kind, name, created_timestamp, updated_timestamp
		 from workspace_folders
		 where company_id=$1 and ($2::text is null or folder_kind=$2)
		 order by created_timestamp asc`,
		companyID, kindParam,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.WorkspaceFolder, 0)
	for rows.Next() {
		var item domain.WorkspaceFolder
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

func (r *PostgresRepo) MoveWorkspaceFolder(companyID, folderID, parentFolderID string) (domain.WorkspaceFolder, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.WorkspaceFolder{}, err
	}
	defer tx.Rollback()

	var folderKind string
	if err := tx.QueryRowContext(ctx,
		`select folder_kind
		 from workspace_folders
		 where company_id=$1 and folder_id=$2
		 for update`,
		companyID, folderID,
	).Scan(&folderKind); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.WorkspaceFolder{}, ErrNotFound
		}
		return domain.WorkspaceFolder{}, err
	}
	if parentFolderID == folderID {
		return domain.WorkspaceFolder{}, ErrInvalid
	}

	var parent any
	if parentFolderID != "" {
		var parentKind string
		if err := tx.QueryRowContext(ctx,
			`select folder_kind
			 from workspace_folders
			 where company_id=$1 and folder_id=$2`,
			companyID, parentFolderID,
		).Scan(&parentKind); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return domain.WorkspaceFolder{}, ErrNotFound
			}
			return domain.WorkspaceFolder{}, err
		}
		if parentKind != folderKind {
			return domain.WorkspaceFolder{}, ErrNotFound
		}

		var createsCycle bool
		if err := tx.QueryRowContext(ctx,
			`with recursive descendants as (
			   select folder_id
			   from workspace_folders
			   where company_id=$1 and folder_id=$2
			   union all
			   select child.folder_id
			   from workspace_folders child
			   join descendants parent on child.company_id=$1 and child.parent_folder_id=parent.folder_id
			 )
			 select exists(select 1 from descendants where folder_id=$3)`,
			companyID, folderID, parentFolderID,
		).Scan(&createsCycle); err != nil {
			return domain.WorkspaceFolder{}, err
		}
		if createsCycle {
			return domain.WorkspaceFolder{}, ErrInvalid
		}
		parent = parentFolderID
	}

	var item domain.WorkspaceFolder
	var parentOut sql.NullString
	if err := tx.QueryRowContext(ctx,
		`update workspace_folders
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
			return domain.WorkspaceFolder{}, ErrNotFound
		}
		return domain.WorkspaceFolder{}, err
	}
	if parentOut.Valid {
		item.ParentFolderID = &parentOut.String
	}
	if err := tx.Commit(); err != nil {
		return domain.WorkspaceFolder{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteWorkspaceFolder(companyID, folderID string) error {
	ctx := context.Background()
	deleted, err := r.db.ExecContext(ctx,
		`delete from workspace_folders
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
	// The self-referential folder FK and folder_items FK both cascade. Deleting
	// the root folder removes descendants and placements without touching nodes/gates.
	return nil
}

func (r *PostgresRepo) AssignWorkspaceFolderItem(companyID, folderID, itemType, itemID string) (domain.WorkspaceFolderItem, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.WorkspaceFolderItem{}, err
	}
	defer tx.Rollback()

	var folderKind string
	if err := tx.QueryRowContext(ctx,
		`select folder_kind
		 from workspace_folders
		 where company_id=$1 and folder_id=$2`,
		companyID, folderID,
	).Scan(&folderKind); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.WorkspaceFolderItem{}, ErrNotFound
		}
		return domain.WorkspaceFolderItem{}, err
	}
	if folderKind != itemType {
		return domain.WorkspaceFolderItem{}, ErrNotFound
	}

	var exists bool
	var existsQuery string
	if itemType == "node" {
		existsQuery = `select exists(select 1 from nodes where company_id=$1 and node_id=$2)`
	} else if itemType == "logic_gate" {
		existsQuery = `select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`
	} else {
		return domain.WorkspaceFolderItem{}, ErrNotFound
	}
	if err := tx.QueryRowContext(ctx, existsQuery, companyID, itemID).Scan(&exists); err != nil {
		return domain.WorkspaceFolderItem{}, err
	}
	if !exists {
		return domain.WorkspaceFolderItem{}, ErrNotFound
	}

	var item domain.WorkspaceFolderItem
	if err := tx.QueryRowContext(ctx,
		`insert into workspace_folder_items
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
		return domain.WorkspaceFolderItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.WorkspaceFolderItem{}, err
	}
	return item, nil
}

func (r *PostgresRepo) ListWorkspaceFolderItems(companyID, folderID, itemType string) ([]domain.WorkspaceFolderItem, error) {
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
		 from workspace_folder_items
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

	items := make([]domain.WorkspaceFolderItem, 0)
	for rows.Next() {
		var item domain.WorkspaceFolderItem
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

func (r *PostgresRepo) RemoveWorkspaceFolderItem(companyID, itemType, itemID string) error {
	ctx := context.Background()
	deleted, err := r.db.ExecContext(ctx,
		`delete from workspace_folder_items
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
