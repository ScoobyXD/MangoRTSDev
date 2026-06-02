package store

import (
	"reflect"
	"sort"
	"strings"
	"time"
)

func kanbanProjectionRowKey(row KanbanBoardProjectionRow) ProjectionRowKey {
	logicGateID := ""
	if row.LogicGateID != nil {
		logicGateID = strings.TrimSpace(*row.LogicGateID)
	}
	return ProjectionRowKey{
		ResourceType: EntityTypeNode,
		ResourceID:   strings.TrimSpace(row.NodeID),
		BoardID:      strings.TrimSpace(row.BoardID),
		LogicGateID:  logicGateID,
		NodeID:       strings.TrimSpace(row.NodeID),
		CardID:       strings.TrimSpace(row.CardID),
	}
}

func kanbanProjectionRowKeyString(key ProjectionRowKey) string {
	return strings.TrimSpace(key.BoardID) + ":" + strings.TrimSpace(key.CardID)
}

func cloneKanbanBoardProjectionRow(row KanbanBoardProjectionRow) KanbanBoardProjectionRow {
	out := row
	out.LogicGateID = cloneStringPointer(row.LogicGateID)
	out.Status = cloneStringPointer(row.Status)
	out.StatusColor = cloneStringPointer(row.StatusColor)
	out.DueDate = cloneStringPointer(row.DueDate)
	out.Priority = cloneIntPointer(row.Priority)
	out.AssigneeUserID = cloneStringPointer(row.AssigneeUserID)
	out.AssigneeDisplayName = cloneStringPointer(row.AssigneeDisplayName)
	out.AssigneeEmail = cloneStringPointer(row.AssigneeEmail)
	return out
}

func kanbanProjectionRowsMeaningfullyEqual(left, right KanbanBoardProjectionRow) bool {
	left.UpdatedTimestamp = time.Time{}
	right.UpdatedTimestamp = time.Time{}
	left.ProjectionUpdatedTimestamp = time.Time{}
	right.ProjectionUpdatedTimestamp = time.Time{}
	left.NodeUpdatedTimestamp = time.Time{}
	right.NodeUpdatedTimestamp = time.Time{}
	left.AssignmentUpdatedTimestamp = time.Time{}
	right.AssignmentUpdatedTimestamp = time.Time{}
	return reflect.DeepEqual(left, right)
}

func diffKanbanProjectionRows(before, after []KanbanBoardProjectionRow) []ProjectionDelta {
	beforeByKey := map[string]KanbanBoardProjectionRow{}
	afterByKey := map[string]KanbanBoardProjectionRow{}
	keys := map[string]ProjectionRowKey{}
	for _, row := range before {
		key := kanbanProjectionRowKey(row)
		keyString := kanbanProjectionRowKeyString(key)
		if keyString == ":" {
			continue
		}
		beforeByKey[keyString] = cloneKanbanBoardProjectionRow(row)
		keys[keyString] = key
	}
	for _, row := range after {
		key := kanbanProjectionRowKey(row)
		keyString := kanbanProjectionRowKeyString(key)
		if keyString == ":" {
			continue
		}
		afterByKey[keyString] = cloneKanbanBoardProjectionRow(row)
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
				Projection:         ProjectionNameKanbanBoard,
				Operation:          ProjectionDeltaOperationDelete,
				RowKey:             key,
				ProjectedTimestamp: projectedAt,
			})
		case hasAfter && (!hadBefore || !kanbanProjectionRowsMeaningfullyEqual(beforeRow, afterRow)):
			row := cloneKanbanBoardProjectionRow(afterRow)
			projectedAt := row.ProjectionUpdatedTimestamp
			if projectedAt.IsZero() {
				projectedAt = now
			}
			deltas = append(deltas, ProjectionDelta{
				CompanyID:          row.CompanyID,
				Projection:         ProjectionNameKanbanBoard,
				Operation:          ProjectionDeltaOperationUpsert,
				RowKey:             key,
				Row:                &row,
				ProjectedTimestamp: projectedAt,
			})
		}
	}
	return deltas
}

func KanbanProjectionUpsertDeltas(rows []KanbanBoardProjectionRow) []ProjectionDelta {
	now := time.Now().UTC()
	deltas := make([]ProjectionDelta, 0, len(rows))
	for _, row := range rows {
		row = cloneKanbanBoardProjectionRow(row)
		key := kanbanProjectionRowKey(row)
		if kanbanProjectionRowKeyString(key) == ":" {
			continue
		}
		projectedAt := row.ProjectionUpdatedTimestamp
		if projectedAt.IsZero() {
			projectedAt = now
		}
		deltas = append(deltas, ProjectionDelta{
			CompanyID:          row.CompanyID,
			Projection:         ProjectionNameKanbanBoard,
			Operation:          ProjectionDeltaOperationUpsert,
			RowKey:             key,
			Row:                &row,
			ProjectedTimestamp: projectedAt,
		})
	}
	return deltas
}
