package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const WorkItemEmailConvertedEventType = "work_item.email_converted"

func NormalizeCommunicationsTriageConversionInput(input CommunicationsTriageConversionInput) (CommunicationsTriageConversionInput, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.LogicGateID = strings.TrimSpace(input.LogicGateID)
	input.NewLogicGateHeader = strings.TrimSpace(input.NewLogicGateHeader)
	input.Status = NormalizeLogicGateAssignmentStatusTitle(input.Status)
	input.ColumnID = strings.TrimSpace(input.ColumnID)
	input.MessageIDs = normalizeUniqueStrings(input.MessageIDs, CommunicationsTriageBatchMaxItems)
	input.Target.Mode = normalizeCommunicationsEmailConversionTargetMode(input.Target.Mode)
	input.Target.LogicGateID = strings.TrimSpace(input.Target.LogicGateID)
	input.Target.Header = strings.TrimSpace(input.Target.Header)

	if input.Target.LogicGateID == "" {
		input.Target.LogicGateID = input.LogicGateID
	}
	if input.Target.Header == "" {
		input.Target.Header = input.NewLogicGateHeader
	}
	if input.Target.Mode == "" {
		switch {
		case input.Target.LogicGateID != "":
			input.Target.Mode = CommunicationsEmailConversionTargetExistingLogicGate
		case input.Target.Header != "":
			input.Target.Mode = CommunicationsEmailConversionTargetNewLogicGate
		}
	}

	if input.Status == "" && input.ColumnID == "" {
		input.Status = "Pending"
	}
	if input.UserID == "" || input.CompanyID == "" || len(input.MessageIDs) == 0 {
		return CommunicationsTriageConversionInput{}, ErrInvalid
	}
	switch input.Target.Mode {
	case CommunicationsEmailConversionTargetExistingLogicGate:
		if input.Target.LogicGateID == "" {
			return CommunicationsTriageConversionInput{}, ErrInvalid
		}
		input.LogicGateID = input.Target.LogicGateID
		input.NewLogicGateHeader = ""
	case CommunicationsEmailConversionTargetNewLogicGate:
		if input.Target.Header == "" {
			return CommunicationsTriageConversionInput{}, ErrInvalid
		}
		input.LogicGateID = ""
		input.NewLogicGateHeader = input.Target.Header
	default:
		return CommunicationsTriageConversionInput{}, ErrInvalid
	}
	return input, nil
}

func normalizeCommunicationsEmailConversionTargetMode(mode string) string {
	clean := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(mode), "-", "_"))
	switch clean {
	case "":
		return ""
	case "existing", "logic_gate", "existing_logic_gate":
		return CommunicationsEmailConversionTargetExistingLogicGate
	case "new", "new_logic_gate":
		return CommunicationsEmailConversionTargetNewLogicGate
	default:
		return "invalid"
	}
}

func communicationsEmailConversionWorkspaceEventInputs(result CommunicationsTriageConversionResult, meta workItemAssignmentEventMetadata) []DomainEventInput {
	inputs := make([]DomainEventInput, 0, len(result.Nodes)*6+1)
	if result.CreatedLogicGate {
		inputs = append(inputs, logicGateCreatedWorkspaceEventInput(result.LogicGate, meta))
	}
	for index, node := range result.Nodes {
		var folderItem domain.CompanyExplorerFolderItem
		if index < len(result.FolderItems) {
			folderItem = result.FolderItems[index]
		}
		var card domain.KanbanCard
		if index < len(result.Cards) {
			card = result.Cards[index]
		}
		var assignment domain.NodeLogicGateAssignment
		if index < len(result.Assignments) {
			assignment = result.Assignments[index]
		}
		var provenance CommunicationsEmailConversionProvenance
		if index < len(result.EmailProvenance) {
			provenance = result.EmailProvenance[index]
		}
		inputs = append(inputs, emailConvertedWorkspaceEventInput(provenance, assignment, node, meta))
		if folderItem.CompanyID != "" {
			inputs = append(inputs, folderItemAssignedWorkspaceEventInput(folderItem, meta))
		}
		inputs = append(inputs, nodeCreatedWorkspaceEventInputWithMetadata(node, meta))
		if assignment.CompanyID != "" {
			inputs = append(inputs, workItemAssignmentWorkspaceEventInput(WorkItemLogicGateAssignmentSavedEventType, assignment, node, meta))
		}
		if card.CompanyID != "" {
			inputs = append(inputs, kanbanCardWorkspaceEventInput(card.CompanyID, "kanban_card_upserted", card, true, meta))
		}
		inputs = append(inputs, nodeUpdatedWorkspaceEventInputWithMetadata(node, meta))
	}
	return inputs
}

func emailConvertedWorkspaceEventInput(provenance CommunicationsEmailConversionProvenance, assignment domain.NodeLogicGateAssignment, node domain.Node, meta workItemAssignmentEventMetadata) DomainEventInput {
	payload := map[string]any{
		"company_id":             provenance.CompanyID,
		"user_id":                provenance.UserID,
		"message_id":             provenance.MessageID,
		"thread_id":              provenance.ThreadID,
		"node_id":                provenance.NodeID,
		"logic_gate_id":          provenance.LogicGateID,
		"assignment_id":          assignment.AssignmentID,
		"status":                 optionalStringValue(node.Status),
		"status_key":             assignment.StatusKey,
		"column_id":              assignment.ColumnID,
		"position":               assignment.Position,
		"is_issue":               assignment.IsIssue,
		"compatibility_board_id": provenance.BoardID,
		"compatibility_card_id":  provenance.CardID,
		"board_id":               provenance.BoardID,
		"card_id":                provenance.CardID,
	}
	if meta.ActorUserID != "" {
		payload["actor_user_id"] = meta.ActorUserID
	}
	if meta.IdempotencyKey != "" {
		payload["idempotency_key"] = meta.IdempotencyKey
	}
	return DomainEventInput{
		CompanyID:   provenance.CompanyID,
		StreamType:  workspaceDomainStreamType,
		StreamID:    provenance.CompanyID,
		Type:        WorkItemEmailConvertedEventType,
		ActorUserID: meta.ActorUserID,
		Payload:     payload,
	}
}

func logicGateCreatedWorkspaceEventInput(item domain.LogicGate, meta workItemAssignmentEventMetadata) DomainEventInput {
	input := workspaceDomainEventInput(item.CompanyID, "logic_gate_created", map[string]any{"logic_gate_id": item.LogicGateID, "logic_gate": item})
	input.ActorUserID = meta.ActorUserID
	return input
}

func folderItemAssignedWorkspaceEventInput(item domain.CompanyExplorerFolderItem, meta workItemAssignmentEventMetadata) DomainEventInput {
	input := workspaceDomainEventInput(item.CompanyID, "company_explorer_folder_item_assigned", map[string]any{
		"folder_id":   item.FolderID,
		"item_type":   item.ItemType,
		"item_id":     item.ItemID,
		"folder_item": item,
	})
	input.ActorUserID = meta.ActorUserID
	return input
}

func nodeCreatedWorkspaceEventInputWithMetadata(item domain.Node, meta workItemAssignmentEventMetadata) DomainEventInput {
	input := nodeCreatedWorkspaceEventInput(item)
	input.ActorUserID = meta.ActorUserID
	return input
}
