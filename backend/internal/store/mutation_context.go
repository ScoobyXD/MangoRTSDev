package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const (
	MutationOriginCompanyExplorer = "company_explorer"
	MutationOriginNodeMap         = "node_map"
	MutationOriginLogicGateMap    = "logic_gate_map"
	MutationOriginMatrix          = "matrix"
	MutationOriginKanban          = "kanban"
	MutationOriginEditor          = "editor"

	WorkspaceDeferredFolderItemAssignEventType       = "company_explorer_folder_item_assign_requested"
	WorkspaceDeferredNodeMapPositionUpsertEventType  = "node_map_position_upsert_requested"
	WorkspaceDeferredLogicMapPositionUpsertEventType = "logic_gate_map_position_upsert_requested"
)

func NormalizeMutationOrigin(origin string) string {
	switch strings.TrimSpace(origin) {
	case MutationOriginCompanyExplorer:
		return MutationOriginCompanyExplorer
	case MutationOriginNodeMap:
		return MutationOriginNodeMap
	case MutationOriginLogicGateMap:
		return MutationOriginLogicGateMap
	case MutationOriginMatrix:
		return MutationOriginMatrix
	case MutationOriginKanban:
		return MutationOriginKanban
	case MutationOriginEditor:
		return MutationOriginEditor
	default:
		return ""
	}
}

func MutationOriginNeedsNodeMapPosition(origin string) bool {
	origin = NormalizeMutationOrigin(origin)
	return origin == "" || origin == MutationOriginNodeMap
}

func MutationOriginNeedsLogicGateMapPosition(origin string) bool {
	origin = NormalizeMutationOrigin(origin)
	return origin == "" || origin == MutationOriginLogicGateMap
}

func MutationOriginNeedsCompanyExplorerFolderItem(origin string) bool {
	origin = NormalizeMutationOrigin(origin)
	return origin == "" || origin == MutationOriginCompanyExplorer
}

func DeferredCompanyExplorerFolderItemAssignEventInput(companyID, folderID, systemFolderKey, itemType, itemID string, position int, actorUserID string) DomainEventInput {
	input := workspaceDomainEventInput(companyID, WorkspaceDeferredFolderItemAssignEventType, map[string]any{
		"folder_id":         strings.TrimSpace(folderID),
		"system_folder_key": strings.TrimSpace(systemFolderKey),
		"item_type":         strings.TrimSpace(itemType),
		"item_id":           strings.TrimSpace(itemID),
		"position":          position,
	})
	input.ActorUserID = strings.TrimSpace(actorUserID)
	return input
}

func DeferredNodeMapPositionUpsertEventInput(position domain.NodeMapPosition, actorUserID string) DomainEventInput {
	input := workspaceDomainEventInput(position.CompanyID, WorkspaceDeferredNodeMapPositionUpsertEventType, map[string]any{
		"node_id": position.NodeID,
		"x":       position.X,
		"y":       position.Y,
	})
	input.ActorUserID = strings.TrimSpace(actorUserID)
	return input
}

func DeferredLogicGateMapPositionUpsertEventInput(position domain.LogicGateMapPosition, actorUserID string) DomainEventInput {
	input := workspaceDomainEventInput(position.CompanyID, WorkspaceDeferredLogicMapPositionUpsertEventType, map[string]any{
		"logic_gate_id": position.LogicGateID,
		"x":             position.X,
		"y":             position.Y,
	})
	input.ActorUserID = strings.TrimSpace(actorUserID)
	return input
}
