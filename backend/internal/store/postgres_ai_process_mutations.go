package store

import (
	"context"
	"database/sql"
	"strings"
)

func (r *PostgresRepo) AICreateProcess(ctx context.Context, run AIRun, actionKey, folderID, name string) (WorkspaceEntityBatchResult, error) {
	input, err := aiProcessCreateInput(run, folderID, name)
	if err != nil {
		return WorkspaceEntityBatchResult{}, err
	}
	return postgresAIMutation(r, ctx, run, aiActionKey{"mango_create_process", actionKey}, func(tx *sql.Tx) error {
		if err := lockPostgresCompanyExplorerMutationTx(ctx, tx, run.CompanyID, run.UserID, true); err != nil {
			return err
		}
		if input.FolderID != "" {
			return lockPostgresCompanyExplorerResourceEditTx(ctx, tx, run.CompanyID, run.UserID, EntityTypeCompanyExplorerFolder, input.FolderID)
		}
		return nil
	}, func(tx *sql.Tx) (WorkspaceEntityBatchResult, error) {
		result, err := r.createWorkspaceEntityBatchTx(ctx, tx, input)
		if err != nil {
			return WorkspaceEntityBatchResult{}, err
		}
		result.Events, err = r.appendDomainEventsTx(ctx, tx, WorkspaceEntityBatchEventInputs(result, nil))
		return result, err
	})
}

func (r *PostgresRepo) AIUpdateProcess(ctx context.Context, run AIRun, actionKey, logicGateID, name string) (AIProcessUpdateResult, error) {
	logicGateID, name = cleanUUIDText(logicGateID), strings.TrimSpace(name)
	if logicGateID == "" || name == "" {
		return AIProcessUpdateResult{}, ErrInvalid
	}
	return postgresAIMutation(r, ctx, run, aiActionKey{"mango_update_process", actionKey}, func(tx *sql.Tx) error {
		return lockPostgresCompanyExplorerResourceEditTx(ctx, tx, run.CompanyID, run.UserID, EntityTypeLogicGate, logicGateID)
	}, func(tx *sql.Tx) (AIProcessUpdateResult, error) {
		process, event, err := r.updateLogicGateHeaderWithWorkspaceEventTx(ctx, tx, run.CompanyID, logicGateID, name)
		return AIProcessUpdateResult{Process: process, Event: event}, err
	})
}

func (r *PostgresRepo) AIMoveProcess(ctx context.Context, run AIRun, actionKey, logicGateID, folderID string) (CompanyExplorerV2Row, error) {
	input, err := aiProcessPlacementInput(run, logicGateID, folderID)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	return postgresAIMutation(r, ctx, run, aiActionKey{"mango_move_process", actionKey}, func(tx *sql.Tx) error {
		if err := lockPostgresCompanyExplorerMutationTx(ctx, tx, run.CompanyID, run.UserID, true); err != nil {
			return err
		}
		if err := lockPostgresCompanyExplorerResourceEditTx(ctx, tx, run.CompanyID, run.UserID, EntityTypeLogicGate, input.ChildResourceID); err != nil {
			return err
		}
		_, _, err := r.companyExplorerFinalContainerTarget(ctx, tx, run.CompanyID, input.ParentEntityID, run.UserID)
		return err
	}, func(tx *sql.Tx) (CompanyExplorerV2Row, error) { return r.upsertCompanyExplorerV2EdgeTx(ctx, tx, input) })
}

func (r *PostgresRepo) AICreateProcessStep(ctx context.Context, run AIRun, actionKey string, input ProcessStepCreateInput) (ProcessStepMutationResult, error) {
	input.CompanyID, input.ActorUserID = run.CompanyID, run.UserID
	return postgresAIMutation(r, ctx, run, aiActionKey{"mango_create_step", actionKey}, func(tx *sql.Tx) error {
		if err := lockProcessStepsTx(ctx, tx, run.CompanyID, input.LogicGateID); err != nil {
			return err
		}
		return aiRequireEditTx(ctx, tx, run, EntityTypeLogicGate, input.LogicGateID)
	}, func(tx *sql.Tx) (ProcessStepMutationResult, error) { return r.createProcessStepTx(ctx, tx, input) })
}
