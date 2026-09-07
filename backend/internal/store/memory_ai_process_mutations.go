package store

import (
	"context"
	"strings"
)

func (r *MemoryRepo) AICreateProcess(ctx context.Context, run AIRun, actionKey, folderID, name string) (WorkspaceEntityBatchResult, error) {
	input, err := aiProcessCreateInput(run, folderID, name)
	if err != nil {
		return WorkspaceEntityBatchResult{}, err
	}
	return memoryAIMutation(r, ctx, run, aiActionKey{"mango_create_process", actionKey}, func() bool {
		return input.FolderID == "" || r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, EntityTypeCompanyExplorerFolder, input.FolderID, EntityPermissionEdit)
	}, func() (WorkspaceEntityBatchResult, error) {
		result, err := r.createWorkspaceEntityBatchLocked(input)
		if err != nil {
			return WorkspaceEntityBatchResult{}, err
		}
		result.Events, err = r.appendDomainEventsLocked(WorkspaceEntityBatchEventInputs(result, nil))
		return result, err
	})
}

func (r *MemoryRepo) AIUpdateProcess(ctx context.Context, run AIRun, actionKey, logicGateID, name string) (AIProcessUpdateResult, error) {
	logicGateID, name = cleanUUIDText(logicGateID), strings.TrimSpace(name)
	if logicGateID == "" || name == "" {
		return AIProcessUpdateResult{}, ErrInvalid
	}
	return memoryAIMutation(r, ctx, run, aiActionKey{"mango_update_process", actionKey}, func() bool {
		return r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, EntityTypeLogicGate, logicGateID, EntityPermissionEdit)
	}, func() (AIProcessUpdateResult, error) {
		process, event, err := r.updateLogicGateHeaderWithWorkspaceEventLocked(run.CompanyID, logicGateID, name)
		return AIProcessUpdateResult{Process: process, Event: event}, err
	})
}

func (r *MemoryRepo) AIMoveProcess(ctx context.Context, run AIRun, actionKey, logicGateID, folderID string) (CompanyExplorerV2Row, error) {
	input, err := aiProcessPlacementInput(run, logicGateID, folderID)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	return memoryAIMutation(r, ctx, run, aiActionKey{"mango_move_process", actionKey}, func() bool {
		return r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, EntityTypeLogicGate, input.ChildResourceID, EntityPermissionEdit) &&
			(input.ParentEntityID == run.CompanyID || r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, EntityTypeCompanyExplorerFolder, input.ParentEntityID, EntityPermissionEdit))
	}, func() (CompanyExplorerV2Row, error) { return r.upsertCompanyExplorerV2EdgeLocked(input) })
}

func (r *MemoryRepo) AICreateProcessStep(ctx context.Context, run AIRun, actionKey string, input ProcessStepCreateInput) (ProcessStepMutationResult, error) {
	input.CompanyID, input.ActorUserID = run.CompanyID, run.UserID
	return memoryAIMutation(r, ctx, run, aiActionKey{"mango_create_step", actionKey}, func() bool {
		return r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, EntityTypeLogicGate, input.LogicGateID, EntityPermissionEdit)
	}, func() (ProcessStepMutationResult, error) { return r.createProcessStepLocked(input) })
}
