package httpapi

import (
	"miraeopus/backend/internal/domain"
	"net/http"
)

type assignmentSets map[string]map[string]bool

func (s assignmentSets) has(resourceType, resourceID string) bool {
	return s[resourceType] != nil && s[resourceType][resourceID]
}

func (s *Server) assignmentSetsForRequest(r *http.Request, companyID string) (assignmentSets, bool, error) {
	return nil, false, nil
}

func filterNodesByAssignments(items []domain.Node, sets assignmentSets) []domain.Node {
	filtered := make([]domain.Node, 0, len(items))
	for _, item := range items {
		if sets.has(domain.ResourceTypeNode, item.NodeID) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterNodeRelationshipsByAssignments(items []domain.NodeRelationship, sets assignmentSets) []domain.NodeRelationship {
	filtered := make([]domain.NodeRelationship, 0, len(items))
	for _, item := range items {
		if sets.has(domain.ResourceTypeNode, item.NodeIDA) && sets.has(domain.ResourceTypeNode, item.NodeIDB) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterNodeMapPositionsByAssignments(items []domain.NodeMapPosition, sets assignmentSets) []domain.NodeMapPosition {
	filtered := make([]domain.NodeMapPosition, 0, len(items))
	for _, item := range items {
		if sets.has(domain.ResourceTypeNode, item.NodeID) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterLogicGatesByAssignments(items []domain.LogicGate, sets assignmentSets) []domain.LogicGate {
	filtered := make([]domain.LogicGate, 0, len(items))
	for _, item := range items {
		if sets.has(domain.ResourceTypeLogicGate, item.LogicGateID) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterLogicGateRelationshipsByAssignments(items []domain.LogicGateRelationship, sets assignmentSets) []domain.LogicGateRelationship {
	filtered := make([]domain.LogicGateRelationship, 0, len(items))
	for _, item := range items {
		if sets.has(domain.ResourceTypeLogicGate, item.LogicGateIDA) && sets.has(domain.ResourceTypeLogicGate, item.LogicGateIDB) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterLogicGateMapPositionsByAssignments(items []domain.LogicGateMapPosition, sets assignmentSets) []domain.LogicGateMapPosition {
	filtered := make([]domain.LogicGateMapPosition, 0, len(items))
	for _, item := range items {
		if sets.has(domain.ResourceTypeLogicGate, item.LogicGateID) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterKanbanBoardsByAssignments(items []domain.KanbanBoard, sets assignmentSets) []domain.KanbanBoard {
	filtered := make([]domain.KanbanBoard, 0, len(items))
	for _, item := range items {
		if sets.has(domain.ResourceTypeKanbanBoard, item.BoardID) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterFoldersByAssignments(items []domain.CompanyExplorerFolder, sets assignmentSets) []domain.CompanyExplorerFolder {
	filtered := make([]domain.CompanyExplorerFolder, 0, len(items))
	for _, item := range items {
		if sets.has(domain.ResourceTypeFolder, item.FolderID) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterFolderItemsByAssignments(items []domain.CompanyExplorerFolderItem, sets assignmentSets) []domain.CompanyExplorerFolderItem {
	filtered := make([]domain.CompanyExplorerFolderItem, 0, len(items))
	for _, item := range items {
		if sets.has(domain.ResourceTypeFolder, item.FolderID) || sets.has(folderItemResourceType(item.ItemType), item.ItemID) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func folderItemResourceType(itemType string) string {
	switch itemType {
	case "node":
		return domain.ResourceTypeNode
	case "logic_gate":
		return domain.ResourceTypeLogicGate
	case "kanban":
		return domain.ResourceTypeKanbanBoard
	default:
		return ""
	}
}
