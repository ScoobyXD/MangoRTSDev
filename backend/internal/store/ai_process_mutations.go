package store

import (
	"strings"

	"miraeopus/backend/internal/domain"
)

type AIProcessUpdateResult struct {
	Process domain.LogicGate   `json:"process"`
	Event   domain.DomainEvent `json:"event"`
}

func aiProcessCreateInput(run AIRun, folderID, name string) (WorkspaceEntityBatchInput, error) {
	name, folderID = strings.TrimSpace(name), strings.TrimSpace(folderID)
	if name == "" || (folderID != "" && cleanUUIDText(folderID) == "") {
		return WorkspaceEntityBatchInput{}, ErrInvalid
	}
	origin := MutationOriginCompanyExplorer
	if folderID == "" {
		origin = MutationOriginEditor
	}
	return WorkspaceEntityBatchInput{
		CompanyID: run.CompanyID, CreatorUserID: run.UserID,
		EntityKind: EntityTypeLogicGate, MutationOrigin: origin,
		FolderID: folderID, Items: []WorkspaceEntityBatchItemInput{{ClientID: "process", Title: name}},
	}, nil
}

func aiProcessPlacementInput(run AIRun, logicGateID, folderID string) (CompanyExplorerV2EdgeInput, error) {
	logicGateID, folderID = cleanUUIDText(logicGateID), strings.TrimSpace(folderID)
	if logicGateID == "" || (folderID != "" && cleanUUIDText(folderID) == "") {
		return CompanyExplorerV2EdgeInput{}, ErrInvalid
	}
	if folderID == "" {
		folderID = run.CompanyID
	}
	return CompanyExplorerV2EdgeInput{
		CompanyID: run.CompanyID, ActorUserID: run.UserID, PermissionUserID: run.UserID,
		ParentEntityID: folderID, ChildEntityType: EntityTypeLogicGate, ChildResourceID: logicGateID,
	}, nil
}
