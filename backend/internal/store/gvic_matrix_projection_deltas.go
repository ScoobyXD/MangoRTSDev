package store

import (
	"reflect"
	"sort"
	"strings"
	"time"
)

func GVICMatrixProjectionRowKey(row GVICMatrixProjectionRow) ProjectionRowKey {
	return ProjectionRowKey{
		ProjectionRowID:    strings.TrimSpace(row.ProjectionRowID),
		ItemID:             strings.TrimSpace(row.ItemID),
		UserID:             strings.TrimSpace(row.UserID),
		ResourceType:       strings.TrimSpace(row.ResourceType),
		ResourceID:         strings.TrimSpace(row.ResourceID),
		GVICAssignment:     strings.TrimSpace(firstNonEmpty(row.GVICAssignment, row.Role)),
		ProjectID:          strings.TrimSpace(row.ProjectID),
		LogicGateID:        strings.TrimSpace(pointerStringValue(row.LogicGateID)),
		NodeID:             strings.TrimSpace(firstNonEmpty(row.NodeID, row.NodeLeafID)),
		NodeLeafID:         strings.TrimSpace(firstNonEmpty(row.NodeLeafID, row.NodeID)),
		ParentResourceType: strings.TrimSpace(row.ParentResourceType),
		ParentResourceID:   strings.TrimSpace(row.ParentResourceID),
	}
}

func GVICMatrixProjectionRowKeyString(key ProjectionRowKey) string {
	projectionRowID := strings.TrimSpace(key.ProjectionRowID)
	if projectionRowID != "" {
		return strings.TrimSpace(key.UserID) + ":" + projectionRowID
	}
	itemID := strings.TrimSpace(key.ItemID)
	if itemID != "" {
		return strings.TrimSpace(key.UserID) + ":" + itemID
	}
	nodeID := strings.TrimSpace(firstNonEmpty(key.NodeID, key.NodeLeafID))
	if nodeID != "" {
		return strings.TrimSpace(key.UserID) + ":" + strings.TrimSpace(key.GVICAssignment) + ":" + nodeID + ":" + strings.TrimSpace(key.ProjectID) + ":" + strings.TrimSpace(key.LogicGateID)
	}
	return strings.TrimSpace(key.UserID) + ":" + strings.TrimSpace(key.ResourceType) + ":" + strings.TrimSpace(key.ResourceID)
}
func cloneGVICMatrixProjectionRow(row GVICMatrixProjectionRow) GVICMatrixProjectionRow {
	out := row
	out.LogicGateID = cloneStringPointer(row.LogicGateID)
	out.Status = cloneStringPointer(row.Status)
	out.DueDate = cloneStringPointer(row.DueDate)
	out.Priority = cloneIntPointer(row.Priority)
	out.Accounts = cloneAccountSnapshots(row.Accounts)
	return out
}

func GVICMatrixProjectionRowsMeaningfullyEqual(left, right GVICMatrixProjectionRow) bool {
	left.UpdatedTimestamp = time.Time{}
	right.UpdatedTimestamp = time.Time{}
	return reflect.DeepEqual(left, right)
}

func diffGVICMatrixProjectionRows(before, after []GVICMatrixProjectionRow) []ProjectionDelta {
	beforeByKey := map[string]GVICMatrixProjectionRow{}
	afterByKey := map[string]GVICMatrixProjectionRow{}
	keys := map[string]ProjectionRowKey{}
	for _, row := range before {
		key := GVICMatrixProjectionRowKey(row)
		keyString := GVICMatrixProjectionRowKeyString(key)
		if keyString == "::" {
			continue
		}
		beforeByKey[keyString] = cloneGVICMatrixProjectionRow(row)
		keys[keyString] = key
	}
	for _, row := range after {
		key := GVICMatrixProjectionRowKey(row)
		keyString := GVICMatrixProjectionRowKeyString(key)
		if keyString == "::" {
			continue
		}
		afterByKey[keyString] = cloneGVICMatrixProjectionRow(row)
		keys[keyString] = key
	}

	orderedKeys := make([]string, 0, len(keys))
	for key := range keys {
		orderedKeys = append(orderedKeys, key)
	}
	sort.Strings(orderedKeys)

	now := time.Now().UTC()
	deltas := make([]ProjectionDelta, 0, len(orderedKeys))
	for _, keyString := range orderedKeys {
		key := keys[keyString]
		beforeRow, hadBefore := beforeByKey[keyString]
		afterRow, hasAfter := afterByKey[keyString]
		switch {
		case !hasAfter && hadBefore:
			deltas = append(deltas, ProjectionDelta{
				CompanyID:          beforeRow.CompanyID,
				Projection:         ProjectionNameGVICMatrix,
				Operation:          ProjectionDeltaOperationDelete,
				RowKey:             key,
				ProjectedTimestamp: now,
			})
		case hasAfter && (!hadBefore || !GVICMatrixProjectionRowsMeaningfullyEqual(beforeRow, afterRow)):
			row := cloneGVICMatrixProjectionRow(afterRow)
			projectedAt := row.UpdatedTimestamp
			if projectedAt.IsZero() {
				projectedAt = now
			}
			deltas = append(deltas, ProjectionDelta{
				CompanyID:          row.CompanyID,
				Projection:         ProjectionNameGVICMatrix,
				Operation:          ProjectionDeltaOperationUpsert,
				RowKey:             key,
				Row:                &row,
				ProjectedTimestamp: projectedAt,
			})
		}
	}
	return deltas
}
