package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const WorkItemEmailConvertedEventType = "work_item.email_converted"
const CommunicationsTriageConversionDefaultPriority = 3

func NormalizeCommunicationsTriageConversionInput(input CommunicationsTriageConversionInput) (CommunicationsTriageConversionInput, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.LogicGateID = strings.TrimSpace(input.LogicGateID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.NewLogicGateHeader = strings.TrimSpace(input.NewLogicGateHeader)
	input.Status = NormalizeLogicGateAssignmentStatusTitle(input.Status)
	input.ColumnID = strings.TrimSpace(input.ColumnID)
	input.MessageIDs = normalizeUniqueStrings(input.MessageIDs, CommunicationsTriageBatchMaxItems)
	input.Target.Mode = normalizeCommunicationsEmailConversionTargetMode(input.Target.Mode)
	input.Target.LogicGateID = strings.TrimSpace(input.Target.LogicGateID)
	input.Target.NodeID = strings.TrimSpace(input.Target.NodeID)
	input.Target.FolderID = strings.TrimSpace(input.Target.FolderID)
	input.Target.ProjectID = strings.TrimSpace(input.Target.ProjectID)
	input.Target.ParentEntityID = strings.TrimSpace(input.Target.ParentEntityID)
	input.Target.Header = strings.TrimSpace(input.Target.Header)

	if input.Target.LogicGateID == "" {
		input.Target.LogicGateID = input.LogicGateID
	}
	if input.Target.NodeID == "" {
		input.Target.NodeID = input.NodeID
	}
	if input.Target.Header == "" {
		input.Target.Header = input.NewLogicGateHeader
	}
	if input.Target.Mode == "" {
		switch {
		case input.Target.NodeID != "":
			input.Target.Mode = CommunicationsEmailConversionTargetExistingNode
		case input.Target.LogicGateID != "":
			input.Target.Mode = CommunicationsEmailConversionTargetExistingLogicGate
		case input.Target.Header != "":
			input.Target.Mode = CommunicationsEmailConversionTargetNewLogicGate
		case input.Target.ProjectID != "":
			input.Target.Mode = CommunicationsEmailConversionTargetProject
		case input.Target.FolderID != "" || input.Target.ParentEntityID != "":
			input.Target.Mode = CommunicationsEmailConversionTargetFolder
		}
	}

	if input.Status == "" && input.ColumnID == "" {
		input.Status = "Pending"
	}
	if input.Priority != nil {
		if *input.Priority < 1 || *input.Priority > 5 {
			return CommunicationsTriageConversionInput{}, ErrInvalid
		}
		input.PrioritySet = true
	} else if input.PrioritySet {
		return CommunicationsTriageConversionInput{}, ErrInvalid
	} else {
		priority := CommunicationsTriageConversionDefaultPriority
		input.Priority = &priority
		input.PrioritySet = true
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
		input.NodeID = ""
		input.NewLogicGateHeader = ""
		input.Target.FolderID = ""
		input.Target.ProjectID = ""
		input.Target.ParentEntityID = ""
	case CommunicationsEmailConversionTargetExistingNode:
		if input.Target.NodeID == "" {
			return CommunicationsTriageConversionInput{}, ErrInvalid
		}
		input.LogicGateID = input.Target.LogicGateID
		input.NodeID = input.Target.NodeID
		input.NewLogicGateHeader = ""
		input.Target.FolderID = ""
		input.Target.ProjectID = ""
		input.Target.ParentEntityID = ""
	case CommunicationsEmailConversionTargetNewLogicGate:
		if input.Target.Header == "" {
			return CommunicationsTriageConversionInput{}, ErrInvalid
		}
		input.LogicGateID = ""
		input.NodeID = ""
		input.NewLogicGateHeader = input.Target.Header
		input.Target.FolderID = ""
		input.Target.ProjectID = ""
		input.Target.ParentEntityID = ""
	case CommunicationsEmailConversionTargetFolder:
		return CommunicationsTriageConversionInput{}, ErrInvalid
	case CommunicationsEmailConversionTargetProject:
		if input.Target.ProjectID == "" {
			return CommunicationsTriageConversionInput{}, ErrInvalid
		}
		input.LogicGateID = ""
		input.NodeID = ""
		input.NewLogicGateHeader = ""
		input.Target.LogicGateID = ""
		input.Target.NodeID = ""
		input.Target.Header = ""
		input.Target.FolderID = ""
		input.Target.ParentEntityID = ""
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
	case "node", "existing_node":
		return CommunicationsEmailConversionTargetExistingNode
	case "folder", "existing_folder", "company_explorer_folder":
		return CommunicationsEmailConversionTargetFolder
	case "project", "existing_project":
		return CommunicationsEmailConversionTargetProject
	default:
		return "invalid"
	}
}

func communicationsEmailConversionWorkspaceEventInputs(result CommunicationsTriageConversionResult, meta workItemAssignmentEventMetadata) []DomainEventInput {
	inputs := make([]DomainEventInput, 0, len(result.Nodes)*6+1)
	if result.CreatedLogicGate {
		inputs = append(inputs, logicGateCreatedWorkspaceEventInput(result.LogicGate, meta))
	}
	createsNodes := result.Target.Mode != CommunicationsEmailConversionTargetExistingNode
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
		if createsNodes && folderItem.CompanyID != "" {
			inputs = append(inputs, folderItemAssignedWorkspaceEventInput(folderItem, meta))
		}
		if createsNodes {
			inputs = append(inputs, nodeCreatedWorkspaceEventInputWithMetadata(node, meta))
		}
		if createsNodes && assignment.CompanyID != "" {
			inputs = append(inputs, workItemAssignmentWorkspaceEventInput(WorkItemLogicGateAssignmentSavedEventType, assignment, node, meta))
		}
		if createsNodes && card.CompanyID != "" {
			inputs = append(inputs, kanbanCardWorkspaceEventInput(card.CompanyID, "kanban_card_upserted", card, true, meta))
		}
		inputs = append(inputs, nodeUpdatedWorkspaceEventInputWithMetadata(node, meta))
	}
	for _, row := range result.ExplorerV2Rows {
		inputs = append(inputs, companyExplorerV2EdgeUpsertedWorkspaceEventInput(row, meta))
	}
	for _, relationship := range result.ProjectRelationships {
		inputs = append(inputs, projectRelationshipUpsertedWorkspaceEventInput(relationship, meta.ActorUserID))
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

func companyExplorerV2EdgeUpsertedWorkspaceEventInput(row CompanyExplorerV2Row, meta workItemAssignmentEventMetadata) DomainEventInput {
	input := workspaceDomainEventInput(row.CompanyID, "company_explorer_item_placed", map[string]any{
		"item_id":          row.EdgeID,
		"parent_entity_id": row.ParentEntityID,
		"target_type":      row.EntityType,
		"target_id":        row.ResourceID,
		"entity":           row,
	})
	input.ActorUserID = meta.ActorUserID
	return input
}

func nodeCreatedWorkspaceEventInputWithMetadata(item domain.Node, meta workItemAssignmentEventMetadata) DomainEventInput {
	input := nodeCreatedWorkspaceEventInput(item)
	input.ActorUserID = meta.ActorUserID
	return input
}
