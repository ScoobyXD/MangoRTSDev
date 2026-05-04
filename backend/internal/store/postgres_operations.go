package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

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
