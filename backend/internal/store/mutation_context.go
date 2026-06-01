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

	WorkspaceDerivedProjectionRequestedEventType        = "workspace_derived_projection_requested"
	WorkspaceDerivedTaskCompanyExplorerFolderItemAssign = "company_explorer_folder_item_assign"
	WorkspaceDerivedTaskNodeMapPositionUpsert           = "node_map_position_upsert"
	WorkspaceDerivedTaskLogicGateMapPositionUpsert      = "logic_gate_map_position_upsert"

	// Deprecated event types kept so catch-up can drain already-durable deferred work.
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

type WorkspaceDerivedProjectionTask map[string]any

func DeferredCompanyExplorerFolderItemAssignTask(folderID, systemFolderKey, itemType, itemID string, position int) WorkspaceDerivedProjectionTask {
	return WorkspaceDerivedProjectionTask{
		"kind":              WorkspaceDerivedTaskCompanyExplorerFolderItemAssign,
		"folder_id":         strings.TrimSpace(folderID),
		"system_folder_key": strings.TrimSpace(systemFolderKey),
		"item_type":         strings.TrimSpace(itemType),
		"item_id":           strings.TrimSpace(itemID),
		"position":          position,
	}
}

func DeferredNodeMapPositionUpsertTask(position domain.NodeMapPosition) WorkspaceDerivedProjectionTask {
	return WorkspaceDerivedProjectionTask{
		"kind":    WorkspaceDerivedTaskNodeMapPositionUpsert,
		"node_id": position.NodeID,
		"x":       position.X,
		"y":       position.Y,
	}
}

func DeferredLogicGateMapPositionUpsertTask(position domain.LogicGateMapPosition) WorkspaceDerivedProjectionTask {
	return WorkspaceDerivedProjectionTask{
		"kind":          WorkspaceDerivedTaskLogicGateMapPositionUpsert,
		"logic_gate_id": position.LogicGateID,
		"x":             position.X,
		"y":             position.Y,
	}
}

func WorkspaceDerivedProjectionRequestedEventInput(companyID string, tasks []WorkspaceDerivedProjectionTask, actorUserID string) DomainEventInput {
	cleanTasks := make([]map[string]any, 0, len(tasks))
	for _, task := range tasks {
		if len(task) == 0 {
			continue
		}
		clean := make(map[string]any, len(task))
		for key, value := range task {
			clean[key] = value
		}
		cleanTasks = append(cleanTasks, clean)
	}
	input := workspaceDomainEventInput(companyID, WorkspaceDerivedProjectionRequestedEventType, map[string]any{
		"tasks": cleanTasks,
	})
	input.ActorUserID = strings.TrimSpace(actorUserID)
	return input
}

func DeferredCompanyExplorerFolderItemAssignEventInput(companyID, folderID, systemFolderKey, itemType, itemID string, position int, actorUserID string) DomainEventInput {
	return WorkspaceDerivedProjectionRequestedEventInput(
		companyID,
		[]WorkspaceDerivedProjectionTask{DeferredCompanyExplorerFolderItemAssignTask(folderID, systemFolderKey, itemType, itemID, position)},
		actorUserID,
	)
}

func DeferredNodeMapPositionUpsertEventInput(position domain.NodeMapPosition, actorUserID string) DomainEventInput {
	return WorkspaceDerivedProjectionRequestedEventInput(
		position.CompanyID,
		[]WorkspaceDerivedProjectionTask{DeferredNodeMapPositionUpsertTask(position)},
		actorUserID,
	)
}

func DeferredLogicGateMapPositionUpsertEventInput(position domain.LogicGateMapPosition, actorUserID string) DomainEventInput {
	return WorkspaceDerivedProjectionRequestedEventInput(
		position.CompanyID,
		[]WorkspaceDerivedProjectionTask{DeferredLogicGateMapPositionUpsertTask(position)},
		actorUserID,
	)
}
