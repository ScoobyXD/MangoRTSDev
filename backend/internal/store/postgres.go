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

func (r *PostgresRepo) CreateNode(companyID, header string) (domain.Node, error) {
	ctx := context.Background()
	item := domain.Node{CompanyID: companyID, NodeID: newUUIDv7String(), Header: header}
	err := r.db.QueryRowContext(ctx,
		`insert into nodes (company_id, node_id, header, created_timestamp)
		 values ($1, $2, $3, now())
		 returning company_id, node_id, header, created_timestamp`,
		item.CompanyID, item.NodeID, item.Header,
	).Scan(&item.CompanyID, &item.NodeID, &item.Header, &item.CreatedTimestamp)
	if err != nil {
		return domain.Node{}, err
	}
	return item, nil
}

func (r *PostgresRepo) GetNode(companyID, nodeID string) (domain.Node, error) {
	ctx := context.Background()
	var item domain.Node
	err := r.db.QueryRowContext(ctx,
		`select company_id, node_id, header, created_timestamp
		 from nodes where company_id=$1 and node_id=$2`,
		companyID, nodeID,
	).Scan(&item.CompanyID, &item.NodeID, &item.Header, &item.CreatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Node{}, ErrNotFound
	}
	if err != nil {
		return domain.Node{}, err
	}
	return item, nil
}

func (r *PostgresRepo) AddNodeInformation(companyID, nodeID, infoType, information string) (domain.NodeInformation, error) {
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
		 values ($1, $2, $3, $4::info_type, $5, now(), now())
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

	if err := tx.Commit(); err != nil {
		return domain.NodeInformation{}, err
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
