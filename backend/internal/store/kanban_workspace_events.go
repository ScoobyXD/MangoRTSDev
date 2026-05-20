package store

import "miraeopus/backend/internal/domain"

func kanbanBoardSavedWorkspaceEventInput(item domain.KanbanBoard) DomainEventInput {
	return workspaceDomainEventInput(item.CompanyID, "kanban_board_saved", map[string]any{"board_id": item.BoardID, "board": item})
}

func kanbanBoardUpdatedWorkspaceEventInput(item domain.KanbanBoard) DomainEventInput {
	return workspaceDomainEventInput(item.CompanyID, "kanban_board_updated", map[string]any{"board_id": item.BoardID, "board": item})
}

func kanbanBoardDeletedWorkspaceEventInput(companyID, boardID string) DomainEventInput {
	return workspaceDomainEventInput(companyID, "kanban_board_deleted", map[string]any{"board_id": boardID})
}

func kanbanColumnCreatedWorkspaceEventInput(item domain.KanbanColumn) DomainEventInput {
	return workspaceDomainEventInput(item.CompanyID, "kanban_column_created", map[string]any{
		"board_id":  item.BoardID,
		"column_id": item.ColumnID,
		"column":    item,
	})
}

func kanbanColumnUpdatedWorkspaceEventInput(item domain.KanbanColumn) DomainEventInput {
	return workspaceDomainEventInput(item.CompanyID, "kanban_column_updated", map[string]any{
		"board_id":  item.BoardID,
		"column_id": item.ColumnID,
		"column":    item,
	})
}

func kanbanColumnDeletedWorkspaceEventInput(companyID, boardID, columnID string) DomainEventInput {
	return workspaceDomainEventInput(companyID, "kanban_column_deleted", map[string]any{
		"board_id":  boardID,
		"column_id": columnID,
	})
}

func kanbanCardMutationWorkspaceEventInputs(eventType string, card domain.KanbanCard, derivedNode *domain.Node, includeCard bool) []DomainEventInput {
	inputs := []DomainEventInput{
		kanbanCardWorkspaceEventInput(card.CompanyID, eventType, card, includeCard, workItemAssignmentEventMetadata{}),
	}
	if derivedNode != nil {
		inputs = append(inputs, nodeUpdatedWorkspaceEventInput(*derivedNode))
	}
	return inputs
}
