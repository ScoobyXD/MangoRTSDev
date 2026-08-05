package store

import "strings"

const (
	MutationOriginCompanyExplorer = "company_explorer"
	MutationOriginMatrix          = "matrix"
	MutationOriginKanban          = "kanban"
	MutationOriginEditor          = "editor"

	WorkspaceDerivedProjectionRequestedEventType        = "workspace_derived_projection_requested"
	WorkspaceDerivedTaskCompanyExplorerFolderItemAssign = "company_explorer_folder_item_assign"
	WorkspaceDeferredFolderItemAssignEventType          = "company_explorer_folder_item_assign_requested"
)

func NormalizeMutationOrigin(origin string) string {
	switch strings.TrimSpace(origin) {
	case MutationOriginCompanyExplorer:
		return MutationOriginCompanyExplorer
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

func MutationOriginNeedsCompanyExplorerFolderItem(origin string) bool {
	origin = NormalizeMutationOrigin(origin)
	return origin == "" || origin == MutationOriginCompanyExplorer
}

func MutationOriginNeedsCompanyExplorerDefaultPlacement(origin string) bool {
	switch NormalizeMutationOrigin(origin) {
	case MutationOriginMatrix, MutationOriginKanban, MutationOriginEditor:
		return true
	default:
		return false
	}
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
	input := workspaceDomainEventInput(companyID, WorkspaceDerivedProjectionRequestedEventType, map[string]any{"tasks": cleanTasks})
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
