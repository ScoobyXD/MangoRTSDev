package store

import (
	"reflect"
	"sort"
	"strings"
	"time"
)

func racioProjectionRowKey(row RacioMatrixProjectionRow) ProjectionRowKey {
	return ProjectionRowKey{
		UserID:       strings.TrimSpace(row.UserID),
		ResourceType: strings.TrimSpace(row.ResourceType),
		ResourceID:   strings.TrimSpace(row.ResourceID),
	}
}

func racioProjectionRowKeyString(key ProjectionRowKey) string {
	return strings.TrimSpace(key.UserID) + ":" + strings.TrimSpace(key.ResourceType) + ":" + strings.TrimSpace(key.ResourceID)
}

func cloneRacioMatrixProjectionRow(row RacioMatrixProjectionRow) RacioMatrixProjectionRow {
	out := row
	out.LogicGateID = cloneStringPointer(row.LogicGateID)
	out.Status = cloneStringPointer(row.Status)
	out.DueDate = cloneStringPointer(row.DueDate)
	out.Priority = cloneIntPointer(row.Priority)
	out.Accounts = cloneAccountSnapshots(row.Accounts)
	return out
}

func racioProjectionRowsMeaningfullyEqual(left, right RacioMatrixProjectionRow) bool {
	left.UpdatedTimestamp = time.Time{}
	right.UpdatedTimestamp = time.Time{}
	return reflect.DeepEqual(left, right)
}

func diffRacioProjectionRows(before, after []RacioMatrixProjectionRow) []ProjectionDelta {
	beforeByKey := map[string]RacioMatrixProjectionRow{}
	afterByKey := map[string]RacioMatrixProjectionRow{}
	keys := map[string]ProjectionRowKey{}
	for _, row := range before {
		key := racioProjectionRowKey(row)
		keyString := racioProjectionRowKeyString(key)
		if keyString == "::" {
			continue
		}
		beforeByKey[keyString] = cloneRacioMatrixProjectionRow(row)
		keys[keyString] = key
	}
	for _, row := range after {
		key := racioProjectionRowKey(row)
		keyString := racioProjectionRowKeyString(key)
		if keyString == "::" {
			continue
		}
		afterByKey[keyString] = cloneRacioMatrixProjectionRow(row)
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
		case hasAfter && (!hadBefore || !racioProjectionRowsMeaningfullyEqual(beforeRow, afterRow)):
			row := cloneRacioMatrixProjectionRow(afterRow)
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
