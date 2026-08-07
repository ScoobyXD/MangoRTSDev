package store

import "strings"

func addProjectRelationshipRACIMatrixResourceIDs(nodeSet, logicGateSet map[string]bool, rows []ProjectRelationshipProjectionRow) {
	for _, row := range rows {
		resourceType := strings.TrimSpace(row.ResourceType)
		resourceID := strings.TrimSpace(row.ResourceID)
		switch resourceType {
		case EntityTypeNode:
			if resourceID != "" {
				nodeSet[resourceID] = true
			}
		case EntityTypeLogicGate:
			if resourceID != "" {
				logicGateSet[resourceID] = true
			}
		}
	}
}
