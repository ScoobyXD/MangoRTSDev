package store

import (
	"miraeopus/backend/internal/domain"
)

const workspaceDomainStreamType = "workspace"

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
