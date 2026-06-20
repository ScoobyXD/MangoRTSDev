package store

import (
	"fmt"
	"strings"
)

func MyWorkUserScope(userID string) string {
	return semanticScope("my_work", "user", userID)
}

func MyWorkTeamScope(teamID string) string {
	return semanticScope("my_work", "team", teamID)
}

func MyWorkCompanyScope(companyID string) string {
	return semanticScope("my_work", "company", companyID)
}

func UpdatesUserScope(userID string) string {
	return semanticScope("updates", "user", userID)
}

func UpdatesTeamScope(teamID string) string {
	return semanticScope("updates", "team", teamID)
}

func UpdatesCompanyScope(companyID string) string {
	return semanticScope("updates", "company", companyID)
}

func CompanyExplorerRootScope(companyID string) string {
	return semanticScope("company_explorer", "root", companyID)
}

func CompanyExplorerFolderScope(folderID string) string {
	return semanticScope("company_explorer", "folder", folderID)
}

func CompanyExplorerProjectScope(projectID string) string {
	return semanticScope("company_explorer", "project", projectID)
}

func CompanyExplorerLogicGateScope(logicGateID string) string {
	return semanticScope("company_explorer", "logic_gate", logicGateID)
}

func CompanyExplorerNodeScope(nodeID string) string {
	return semanticScope("company_explorer", "node", nodeID)
}

func MyWorkProjectionAffectedScopes(projection, userID string) []string {
	switch strings.TrimSpace(projection) {
	case ProjectionNameGVICMatrix, ProjectionNameGVICEffectiveAssignments:
		return normalizeEventScopes([]string{MyWorkUserScope(userID)})
	default:
		return nil
	}
}

func AffectedScopesForMyWorkProjection(primaryScope, projection, userID string) []string {
	scopes := []string{strings.TrimSpace(primaryScope)}
	scopes = append(scopes, MyWorkProjectionAffectedScopes(projection, userID)...)
	return normalizeEventScopes(scopes)
}

func UpdatesAffectedScopes(companyID, recipientUserID string) []string {
	recipientUserID = strings.TrimSpace(recipientUserID)
	if recipientUserID != "" {
		return normalizeEventScopes([]string{UpdatesUserScope(recipientUserID)})
	}
	return normalizeEventScopes([]string{UpdatesCompanyScope(companyID)})
}

func CompanyExplorerAffectedScopes(companyID, eventType string, payload map[string]any) []string {
	companyID = strings.TrimSpace(companyID)
	eventType = strings.TrimSpace(eventType)
	if companyID == "" {
		return nil
	}
	scopes := []string{}
	if strings.HasPrefix(eventType, "company_explorer") {
		scopes = append(scopes, CompanyExplorerRootScope(companyID))
	}
	if eventType == "project_deleted" || eventType == "logic_gate_deleted" || eventType == "node_deleted" {
		scopes = append(scopes, CompanyExplorerRootScope(companyID))
	}
	addFolderScope := func(value string) {
		if scope := CompanyExplorerFolderScope(value); scope != "" {
			scopes = append(scopes, scope)
		}
	}
	addResourceScope := func(entityType, resourceID string) {
		switch strings.TrimSpace(entityType) {
		case EntityTypeProject:
			if scope := CompanyExplorerProjectScope(resourceID); scope != "" {
				scopes = append(scopes, scope)
			}
		case EntityTypeLogicGate:
			if scope := CompanyExplorerLogicGateScope(resourceID); scope != "" {
				scopes = append(scopes, scope)
			}
		case EntityTypeNode:
			if scope := CompanyExplorerNodeScope(resourceID); scope != "" {
				scopes = append(scopes, scope)
			}
		}
	}

	addFolderScope(payloadText(payload, "folder_id"))
	addFolderScope(payloadText(payload, "parent_folder_id"))
	parentEntityID := payloadText(payload, "parent_entity_id")
	if parentEntityID == companyID {
		scopes = append(scopes, CompanyExplorerRootScope(companyID))
	} else {
		addFolderScope(parentEntityID)
	}
	entityType := payloadText(payload, "entity_type")
	entityID := payloadText(payload, "entity_id")
	resourceID := payloadText(payload, "resource_id")
	if entityType == CompanyExplorerV2EntityFolder {
		addFolderScope(entityID)
	} else {
		addResourceScope(entityType, resourceID)
	}
	addResourceScope(payloadText(payload, "item_type"), payloadText(payload, "item_id"))
	addResourceScope(payloadText(payload, "target_type"), payloadText(payload, "target_id"))
	addResourceScope(EntityTypeProject, payloadText(payload, "project_id"))
	addResourceScope(EntityTypeLogicGate, payloadText(payload, "logic_gate_id"))
	addResourceScope(EntityTypeNode, payloadText(payload, "node_id"))

	return normalizeEventScopes(scopes)
}

func semanticScope(parts ...string) string {
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			return ""
		}
		clean = append(clean, part)
	}
	return strings.Join(clean, ":")
}

func payloadText(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
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
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}
