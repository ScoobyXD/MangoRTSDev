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
