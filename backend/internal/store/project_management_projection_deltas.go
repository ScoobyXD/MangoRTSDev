package store

import (
	"reflect"
	"sort"
	"strings"
	"time"
)

func projectManagementProjectionRowKey(row ProjectManagementTimelineProjectionRow) ProjectionRowKey {
	return ProjectionRowKey{
		ItemID:       strings.TrimSpace(row.ItemID),
		UserID:       strings.TrimSpace(row.UserID),
		ResourceType: strings.TrimSpace(row.ResourceType),
		ResourceID:   strings.TrimSpace(row.ResourceID),
		LogicGateID:  strings.TrimSpace(pointerStringValue(row.LogicGateID)),
		NodeID:       strings.TrimSpace(row.NodeID),
	}
}

func projectManagementProjectionRowKeyString(key ProjectionRowKey) string {
	return strings.TrimSpace(key.UserID) + ":" + strings.TrimSpace(key.ItemID)
}

func cloneProjectManagementTimelineProjectionRow(row ProjectManagementTimelineProjectionRow) ProjectManagementTimelineProjectionRow {
	out := row
	out.LogicGateID = cloneStringPointer(row.LogicGateID)
	out.Status = cloneStringPointer(row.Status)
	out.StatusColor = cloneStringPointer(row.StatusColor)
	out.DueDate = cloneStringPointer(row.DueDate)
	out.Priority = cloneIntPointer(row.Priority)
	out.AssigneeUserID = cloneStringPointer(row.AssigneeUserID)
	out.AssigneeDisplayName = cloneStringPointer(row.AssigneeDisplayName)
	out.AssigneeEmail = cloneStringPointer(row.AssigneeEmail)
	out.Accounts = cloneAccountSnapshots(row.Accounts)
	return out
}

func projectManagementProjectionRowsMeaningfullyEqual(left, right ProjectManagementTimelineProjectionRow) bool {
	left.UpdatedTimestamp = time.Time{}
	right.UpdatedTimestamp = time.Time{}
	left.ProjectionUpdatedTimestamp = time.Time{}
	right.ProjectionUpdatedTimestamp = time.Time{}
	return reflect.DeepEqual(left, right)
}

func diffProjectManagementProjectionRows(before, after []ProjectManagementTimelineProjectionRow) []ProjectionDelta {
	beforeByKey := map[string]ProjectManagementTimelineProjectionRow{}
	afterByKey := map[string]ProjectManagementTimelineProjectionRow{}
	keys := map[string]ProjectionRowKey{}
	for _, row := range before {
		key := projectManagementProjectionRowKey(row)
		keyString := projectManagementProjectionRowKeyString(key)
		if keyString == ":" {
			continue
		}
		beforeByKey[keyString] = cloneProjectManagementTimelineProjectionRow(row)
		keys[keyString] = key
	}
	for _, row := range after {
		key := projectManagementProjectionRowKey(row)
		keyString := projectManagementProjectionRowKeyString(key)
		if keyString == ":" {
			continue
		}
		afterByKey[keyString] = cloneProjectManagementTimelineProjectionRow(row)
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
			projectedAt := beforeRow.ProjectionUpdatedTimestamp
			if projectedAt.IsZero() {
				projectedAt = now
			}
			deltas = append(deltas, ProjectionDelta{
				CompanyID:          beforeRow.CompanyID,
				Projection:         ProjectionNameProjectManagementTimeline,
				Operation:          ProjectionDeltaOperationDelete,
				RowKey:             key,
				ProjectedTimestamp: projectedAt,
			})
		case hasAfter && (!hadBefore || !projectManagementProjectionRowsMeaningfullyEqual(beforeRow, afterRow)):
			row := cloneProjectManagementTimelineProjectionRow(afterRow)
			projectedAt := row.ProjectionUpdatedTimestamp
			if projectedAt.IsZero() {
				projectedAt = now
			}
			deltas = append(deltas, ProjectionDelta{
				CompanyID:          row.CompanyID,
				Projection:         ProjectionNameProjectManagementTimeline,
				Operation:          ProjectionDeltaOperationUpsert,
				RowKey:             key,
				Row:                &row,
				ProjectedTimestamp: projectedAt,
			})
		}
	}
	return deltas
}

func ProjectManagementProjectionUpsertDeltas(rows []ProjectManagementTimelineProjectionRow) []ProjectionDelta {
	now := time.Now().UTC()
	deltas := make([]ProjectionDelta, 0, len(rows))
	for _, row := range rows {
		row = cloneProjectManagementTimelineProjectionRow(row)
		key := projectManagementProjectionRowKey(row)
		if projectManagementProjectionRowKeyString(key) == ":" {
			continue
		}
		projectedAt := row.ProjectionUpdatedTimestamp
		if projectedAt.IsZero() {
			projectedAt = now
		}
		deltas = append(deltas, ProjectionDelta{
			CompanyID:          row.CompanyID,
			Projection:         ProjectionNameProjectManagementTimeline,
			Operation:          ProjectionDeltaOperationUpsert,
			RowKey:             key,
			Row:                &row,
			ProjectedTimestamp: projectedAt,
		})
	}
	return deltas
}

func pointerStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
