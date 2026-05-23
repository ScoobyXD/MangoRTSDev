package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const workspaceDomainStreamType = "workspace"
const NodeMentionCreatedEventType = "node.mention_created"
const LogicGateMentionCreatedEventType = "logic_gate.mention_created"

func workspaceDomainEventInput(companyID, eventType string, payload map[string]any) DomainEventInput {
	return DomainEventInput{
		CompanyID:  companyID,
		StreamType: workspaceDomainStreamType,
		StreamID:   companyID,
		Type:       eventType,
		Payload:    payload,
	}
}

func nodeCreatedWorkspaceEventInput(item domain.Node) DomainEventInput {
	return workspaceDomainEventInput(item.CompanyID, "node_created", map[string]any{"node_id": item.NodeID, "node": item})
}

func nodeUpdatedWorkspaceEventInput(item domain.Node) DomainEventInput {
	return workspaceDomainEventInput(item.CompanyID, "node_updated", map[string]any{"node_id": item.NodeID, "node": item})
}

func nodeUpdatedWorkspaceEventInputForUpdate(input UpdateNodeInput, before, after domain.Node) DomainEventInput {
	event := nodeUpdatedWorkspaceEventInput(after)
	event.ActorUserID = strings.TrimSpace(input.ActorUserID)
	payload := event.Payload
	payload["node_title"] = strings.TrimSpace(after.Title)
	if assigneeUserID := nodeAssigneeUserID(after); assigneeUserID != "" {
		payload["assignee_user_id"] = assigneeUserID
	}
	if actorLabel := strings.TrimSpace(input.ActorDisplayName); actorLabel != "" {
		payload["actor_display_name"] = actorLabel
	}

	afterAssignee := nodeAssigneeUserID(after)
	beforeAssignee := nodeAssigneeUserID(before)
	if input.AssigneeUserIDSet && afterAssignee != "" && afterAssignee != beforeAssignee {
		payload["notification_event_type"] = domain.NotificationEventNodeAssigned
		payload["recipient_user_ids"] = []string{afterAssignee}
		payload["assignee_changed"] = true
		if beforeAssignee != "" {
			payload["previous_assignee_user_id"] = beforeAssignee
		}
		return event
	}

	changedFields := nodeNotificationChangedFields(input, before, after)
	if afterAssignee != "" && len(changedFields) > 0 {
		payload["notification_event_type"] = domain.NotificationEventNodeFieldsChanged
		payload["recipient_user_ids"] = []string{afterAssignee}
		payload["changed_fields"] = changedFields
		if input.StatusSet {
			payload["status"] = nodeOptionalString(after.Status)
		}
	}
	return event
}

func nodeAssigneeUserID(node domain.Node) string {
	if node.AssigneeUserID == nil {
		return ""
	}
	return strings.TrimSpace(*node.AssigneeUserID)
}

func nodeNotificationChangedFields(input UpdateNodeInput, before, after domain.Node) []string {
	fields := make([]string, 0, 3)
	if input.StatusSet && nodeOptionalString(before.Status) != nodeOptionalString(after.Status) {
		fields = append(fields, "status")
	}
	if input.DueDateSet && nodeOptionalString(before.DueDate) != nodeOptionalString(after.DueDate) {
		fields = append(fields, "due date")
	}
	if input.PrioritySet && nodeOptionalInt(before.Priority) != nodeOptionalInt(after.Priority) {
		fields = append(fields, "priority")
	}
	return fields
}

func nodeOptionalString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func nodeOptionalInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func nodeDeletedWorkspaceEventInput(companyID, nodeID string) DomainEventInput {
	return workspaceDomainEventInput(companyID, "node_deleted", map[string]any{"node_id": nodeID})
}

func relationshipCreatedWorkspaceEventInput(item domain.NodeRelationship) DomainEventInput {
	return workspaceDomainEventInput(item.CompanyID, "relationship_created", map[string]any{
		"node_relationship_id": item.NodeRelationshipID,
		"node_id_a":            item.NodeIDA,
		"node_id_b":            item.NodeIDB,
		"relationship":         item,
	})
}

func relationshipDeletedWorkspaceEventInput(companyID, relationshipID string) DomainEventInput {
	return workspaceDomainEventInput(companyID, "relationship_deleted", map[string]any{"node_relationship_id": relationshipID})
}
