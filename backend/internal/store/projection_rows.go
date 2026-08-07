package store

import "strings"

func gvicMatrixProjectionRowIdentity(row RACIMatrixProjectionRow) string {
	userID := strings.TrimSpace(row.UserID)
	if projectionRowID := strings.TrimSpace(row.ProjectionRowID); projectionRowID != "" {
		return userID + ":" + projectionRowID
	}
	if itemID := strings.TrimSpace(row.ItemID); itemID != "" {
		return userID + ":" + itemID
	}
	if nodeID := strings.TrimSpace(firstNonEmpty(row.NodeID, row.NodeLeafID)); nodeID != "" {
		return userID + ":" + strings.TrimSpace(firstNonEmpty(row.RACIAssignment, row.Role)) + ":" + nodeID + ":" + strings.TrimSpace(row.ProjectID) + ":" + strings.TrimSpace(pointerStringValue(row.LogicGateID))
	}
	return userID + ":" + strings.TrimSpace(row.ResourceType) + ":" + strings.TrimSpace(row.ResourceID)
}

func cloneProjectManagementTimelineProjectionRow(row ProjectManagementTimelineProjectionRow) ProjectManagementTimelineProjectionRow {
	out := row
	out.LogicGateID = cloneStringPointer(row.LogicGateID)
	out.Status = cloneStringPointer(row.Status)
	out.DueDate = cloneStringPointer(row.DueDate)
	out.Priority = cloneIntPointer(row.Priority)
	out.Accounts = cloneAccountSnapshots(row.Accounts)
	return out
}

func cloneProjectRelationshipProjectionRow(row ProjectRelationshipProjectionRow) ProjectRelationshipProjectionRow {
	out := row
	out.LogicGateID = cloneStringPointer(row.LogicGateID)
	out.Status = cloneStringPointer(row.Status)
	return out
}

func cloneProjectRelationshipProjectionRows(rows []ProjectRelationshipProjectionRow) []ProjectRelationshipProjectionRow {
	if len(rows) == 0 {
		return nil
	}
	out := make([]ProjectRelationshipProjectionRow, len(rows))
	for index, row := range rows {
		out[index] = cloneProjectRelationshipProjectionRow(row)
	}
	return out
}

func pointerStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
