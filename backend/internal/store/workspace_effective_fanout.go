package store

import (
	"fmt"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

type WorkspaceEventAccessTarget struct {
	ResourceType string
	ResourceID   string
}

func WorkspaceEventAccessTargets(event domain.DomainEvent) []WorkspaceEventAccessTarget {
	if !isWorkspaceStreamDomainEvent(event) {
		return nil
	}
	targets := make([]WorkspaceEventAccessTarget, 0, 2)
	seen := map[string]bool{}
	add := func(resourceType, resourceID string) {
		resourceType, ok := NormalizeEntityType(resourceType)
		resourceID = strings.TrimSpace(resourceID)
		if !ok || resourceID == "" {
			return
		}
		key := resourceType + "\x00" + resourceID
		if seen[key] {
			return
		}
		seen[key] = true
		targets = append(targets, WorkspaceEventAccessTarget{ResourceType: resourceType, ResourceID: resourceID})
	}

	if logicGateID := workspaceEventPayloadText(event.Payload, "logic_gate_id"); logicGateID != "" {
		add(EntityTypeLogicGate, logicGateID)
		return targets
	}
	if logicGateID := LogicGateIDFromKanbanBoardID(workspaceEventPayloadText(event.Payload, "board_id")); logicGateID != "" {
		add(EntityTypeLogicGate, logicGateID)
		return targets
	}
	if itemType := workspaceEventPayloadText(event.Payload, "item_type"); itemType != "" {
		switch itemType {
		case EntityTypeNode:
			add(EntityTypeNode, workspaceEventPayloadText(event.Payload, "item_id"))
			return targets
		case EntityTypeLogicGate:
			add(EntityTypeLogicGate, workspaceEventPayloadText(event.Payload, "item_id"))
			return targets
		}
	}
	if folderKind := workspaceEventPayloadText(event.Payload, "folder_kind"); folderKind == "communications" {
		add(EntityTypeSharedTriageFolder, workspaceEventPayloadText(event.Payload, "folder_id"))
		return targets
	}

	add(EntityTypeNode, workspaceEventPayloadText(event.Payload, "node_id"))
	add(EntityTypeNode, workspaceEventPayloadText(event.Payload, "node_id_a"))
	add(EntityTypeNode, workspaceEventPayloadText(event.Payload, "node_id_b"))

	if len(targets) == 0 {
		addLogicGateRelationshipTargets(event.Payload, add)
	}
	return targets
}

func workspaceEventPayloadText(payload map[string]any, key string) string {
	value, ok := payload[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case *string:
		if typed == nil {
			return ""
		}
		return strings.TrimSpace(*typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func addLogicGateRelationshipTargets(payload map[string]any, add func(string, string)) {
	raw, ok := payload["logic_gate_relationship"]
	if !ok || raw == nil {
		return
	}
	switch relationship := raw.(type) {
	case domain.LogicGateRelationship:
		add(EntityTypeLogicGate, relationship.LogicGateIDA)
		add(EntityTypeLogicGate, relationship.LogicGateIDB)
	case map[string]any:
		add(EntityTypeLogicGate, workspaceEventPayloadText(relationship, "logic_gate_id_a"))
		add(EntityTypeLogicGate, workspaceEventPayloadText(relationship, "logic_gate_id_b"))
	case map[string]string:
		add(EntityTypeLogicGate, relationship["logic_gate_id_a"])
		add(EntityTypeLogicGate, relationship["logic_gate_id_b"])
	}
}

func sortWorkspaceEventUserIDs(userIDs map[string]bool) []string {
	out := make([]string, 0, len(userIDs))
	for userID := range userIDs {
		out = append(out, userID)
	}
	sort.Strings(out)
	return out
}
