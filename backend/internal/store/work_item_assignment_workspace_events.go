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
		"process_step_id":assignment.ProcessStepID,
		"position":               assignment.Position,
		"is_issue":               assignment.IsIssue,
		"priority":               optionalIntValue(node.Priority),
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



func logicGateAssignmentSavedWorkspaceEventInputs(result LogicGateNodeAssignmentResult, meta workItemAssignmentEventMetadata) []DomainEventInput {
 return []DomainEventInput{workItemAssignmentWorkspaceEventInput(WorkItemLogicGateAssignmentSavedEventType,result.Assignment,result.Node,meta),nodeUpdatedWorkspaceEventInputWithMetadata(result.Node,meta)}
}

func logicGateAssignmentMovedWorkspaceEventInputs(result LogicGateNodeAssignmentResult,sourceAssignment domain.NodeLogicGateAssignment,meta workItemAssignmentEventMetadata) []DomainEventInput {
 event:=workItemAssignmentWorkspaceEventInput(WorkItemLogicGateAssignmentMovedEventType,result.Assignment,result.Node,meta)
 if sourceAssignment.LogicGateID!=result.Assignment.LogicGateID {event.Payload["source_logic_gate_id"]=sourceAssignment.LogicGateID}
 return []DomainEventInput{event,nodeUpdatedWorkspaceEventInputWithMetadata(result.Node,meta)}
}

func logicGateAssignmentRemovedWorkspaceEventInputs(result LogicGateNodeAssignmentRemoveResult, meta workItemAssignmentEventMetadata) []DomainEventInput {
 return []DomainEventInput{workItemAssignmentWorkspaceEventInput(WorkItemLogicGateAssignmentRemovedEventType,result.Assignment,result.Node,meta),nodeUpdatedWorkspaceEventInputWithMetadata(result.Node,meta)}
}

func logicGateAssignmentIssueWorkspaceEventInputs(result LogicGateNodeAssignmentResult, meta workItemAssignmentEventMetadata) []DomainEventInput {
 return []DomainEventInput{workItemAssignmentWorkspaceEventInput(WorkItemLogicGateIssueToggledEventType,result.Assignment,result.Node,meta),nodeUpdatedWorkspaceEventInputWithMetadata(result.Node,meta)}
}

func nodeUpdatedWorkspaceEventInputWithMetadata(item domain.Node, meta workItemAssignmentEventMetadata) DomainEventInput {
	input := nodeUpdatedWorkspaceEventInput(item)
	input.ActorUserID = meta.ActorUserID
	return input
}
