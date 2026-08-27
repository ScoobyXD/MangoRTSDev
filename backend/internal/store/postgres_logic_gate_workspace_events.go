package store

import (
	"context"
	"database/sql"
	"errors"

	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) CreateLogicGateWithWorkspaceEvent(companyID, header string) (domain.LogicGate, domain.DomainEvent, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	defer tx.Rollback()

	item := domain.LogicGate{
		CompanyID: companyID, LogicGateID: newUUIDv7String(), Header: header,
		DefaultAccess: ResourceDefaultAccessEdit,
	}
	if err := tx.QueryRowContext(ctx,
		`insert into logic_gates (company_id, logic_gate_id, header, created_timestamp)
		 values ($1, $2, $3, now())
		 returning company_id, logic_gate_id, header, created_timestamp`,
		item.CompanyID, item.LogicGateID, item.Header,
	).Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp); err != nil {
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	if err := syncLogicGateProjectionDependenciesTx(ctx, tx, LogicGateProjectionDependencyInput{
		CompanyID: item.CompanyID, LogicGateID: item.LogicGateID,
	}); err != nil {
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	if _, _, err := r.placeCompanyExplorerItemInDefaultFolderTx(ctx, tx, item.CompanyID, EntityTypeLogicGate, item.LogicGateID, "", false); err != nil {
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	event, err := r.appendDomainEventTx(ctx, tx, logicGateCreatedWorkspaceEventInput(item, workItemAssignmentEventMetadata{}))
	if err != nil {
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	return item, event, nil
}

func (r *PostgresRepo) UpdateLogicGateHeaderWithWorkspaceEvent(companyID, logicGateID, header string) (domain.LogicGate, domain.DomainEvent, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	defer tx.Rollback()

	var item domain.LogicGate
	if err := tx.QueryRowContext(ctx, `
		update logic_gates set header=$3
		where company_id=$1 and logic_gate_id=$2
		returning company_id, logic_gate_id, header, created_timestamp`,
		companyID, logicGateID, header,
	).Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.LogicGate{}, domain.DomainEvent{}, ErrNotFound
		}
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	if err := syncLogicGateProjectionDependenciesTx(ctx, tx, LogicGateProjectionDependencyInput{
		CompanyID: item.CompanyID, LogicGateID: item.LogicGateID,
	}); err != nil {
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	event, err := r.appendDomainEventTx(ctx, tx, logicGateUpdatedWorkspaceEventInput(item))
	if err != nil {
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	return item, event, nil
}
