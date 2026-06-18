package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const (
	WorkItemLogicGateAssignmentSavedEventType   = "work_item.logic_gate_assignment_saved"
	WorkItemLogicGateAssignmentMovedEventType   = "work_item.logic_gate_assignment_moved"
	WorkItemLogicGateAssignmentRemovedEventType = "work_item.logic_gate_assignment_removed"
	WorkItemLogicGateIssueToggledEventType      = "work_item.logic_gate_issue_toggled"
)

type workItemAssignmentEventMetadata struct {
	ActorUserID    string
	IdempotencyKey string
}

func workItemAssignmentEventMetadataFromValues(actorUserID, idempotencyKey string) workItemAssignmentEventMetadata {
	return workItemAssignmentEventMetadata{
		ActorUserID:    strings.TrimSpace(actorUserID),
		IdempotencyKey: strings.TrimSpace(idempotencyKey),
	}
}

func workItemAssignmentEventPayload(assignment domain.NodeLogicGateAssignment, node domain.Node, meta workItemAssignmentEventMetadata) map[string]any {
	status := ""
	if node.Status != nil {
		status = strings.TrimSpace(*node.Status)
	}
	payload := map[string]any{
		"company_id":             assignment.CompanyID,
		"logic_gate_id":          assignment.LogicGateID,
		"node_id":                assignment.NodeID,
		"assignment_id":          assignment.AssignmentID,
		"status":                 status,
		"status_key":             assignment.StatusKey,
		"column_id":              assignment.ColumnID,
		"position":               assignment.Position,
		"is_issue":               assignment.IsIssue,
		"priority":               optionalIntValue(node.Priority),
		"compatibility_board_id": assignment.CompatibilityBoardID,
		"compatibility_card_id":  assignment.CompatibilityCardID,
		"board_id":               assignment.CompatibilityBoardID,
		"card_id":                assignment.CompatibilityCardID,
	}
	if meta.ActorUserID != "" {
		payload["actor_user_id"] = meta.ActorUserID
	}
	if meta.IdempotencyKey != "" {
		payload["idempotency_key"] = meta.IdempotencyKey
	}
	return payload
}

func optionalIntValue(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func optionalStringValue(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func workItemAssignmentWorkspaceEventInput(eventType string, assignment domain.NodeLogicGateAssignment, node domain.Node, meta workItemAssignmentEventMetadata) DomainEventInput {
	return DomainEventInput{
		CompanyID:   assignment.CompanyID,
		StreamType:  workspaceDomainStreamType,
		StreamID:    assignment.CompanyID,
		Type:        eventType,
		ActorUserID: meta.ActorUserID,
		Payload:     workItemAssignmentEventPayload(assignment, node, meta),
	}
}

func logicGateAssignmentWorkspaceCard(result LogicGateNodeAssignmentResult) domain.KanbanCard {
	return LogicGateWorkCompatibilityCard(result.Card.BoardID, result.Assignment, result.Node)
}

func kanbanCardWorkspaceEventInput(companyID, eventType string, card domain.KanbanCard, includeCard bool, meta workItemAssignmentEventMetadata) DomainEventInput {
	payload := map[string]any{
		"board_id": card.BoardID,
		"card_id":  card.CardID,
	}
	if includeCard {
		payload["card"] = card
	}
	return DomainEventInput{
		CompanyID:   companyID,
		StreamType:  workspaceDomainStreamType,
		StreamID:    companyID,
		Type:        eventType,
		ActorUserID: meta.ActorUserID,
		Payload:     payload,
	}
}

func logicGateAssignmentSavedWorkspaceEventInputs(result LogicGateNodeAssignmentResult, meta workItemAssignmentEventMetadata) []DomainEventInput {
	card := logicGateAssignmentWorkspaceCard(result)
	return []DomainEventInput{
		workItemAssignmentWorkspaceEventInput(WorkItemLogicGateAssignmentSavedEventType, result.Assignment, result.Node, meta),
		kanbanCardWorkspaceEventInput(card.CompanyID, "kanban_card_upserted", card, true, meta),
		nodeUpdatedWorkspaceEventInputWithMetadata(result.Node, meta),
	}
}

func logicGateAssignmentMovedWorkspaceEventInputs(result LogicGateNodeAssignmentResult, meta workItemAssignmentEventMetadata) []DomainEventInput {
	card := logicGateAssignmentWorkspaceCard(result)
	return []DomainEventInput{
		workItemAssignmentWorkspaceEventInput(WorkItemLogicGateAssignmentMovedEventType, result.Assignment, result.Node, meta),
		kanbanCardWorkspaceEventInput(card.CompanyID, "kanban_card_moved", card, true, meta),
		nodeUpdatedWorkspaceEventInputWithMetadata(result.Node, meta),
	}
}

func logicGateAssignmentRemovedWorkspaceEventInputs(result LogicGateNodeAssignmentRemoveResult, meta workItemAssignmentEventMetadata) []DomainEventInput {
	return []DomainEventInput{
		workItemAssignmentWorkspaceEventInput(WorkItemLogicGateAssignmentRemovedEventType, result.Assignment, result.Node, meta),
		kanbanCardWorkspaceEventInput(result.Card.CompanyID, "kanban_card_deleted", result.Card, false, meta),
		nodeUpdatedWorkspaceEventInputWithMetadata(result.Node, meta),
	}
}

func logicGateAssignmentIssueWorkspaceEventInputs(result LogicGateNodeAssignmentResult, meta workItemAssignmentEventMetadata) []DomainEventInput {
	card := logicGateAssignmentWorkspaceCard(result)
	return []DomainEventInput{
		workItemAssignmentWorkspaceEventInput(WorkItemLogicGateIssueToggledEventType, result.Assignment, result.Node, meta),
		kanbanCardWorkspaceEventInput(card.CompanyID, "kanban_card_moved", card, true, meta),
		nodeUpdatedWorkspaceEventInputWithMetadata(result.Node, meta),
	}
}

func nodeUpdatedWorkspaceEventInputWithMetadata(item domain.Node, meta workItemAssignmentEventMetadata) DomainEventInput {
	input := nodeUpdatedWorkspaceEventInput(item)
	input.ActorUserID = meta.ActorUserID
	return input
}
