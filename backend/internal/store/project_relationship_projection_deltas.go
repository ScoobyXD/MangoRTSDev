package store

import (
	"reflect"
	"sort"
	"strings"
	"time"
)

func projectRelationshipProjectionRowKey(row ProjectRelationshipProjectionRow) ProjectionRowKey {
	return ProjectionRowKey{
		ProjectID:      strings.TrimSpace(row.ProjectID),
		RelationshipID: strings.TrimSpace(row.RelationshipID),
		ResourceType:   strings.TrimSpace(row.ResourceType),
		ResourceID:     strings.TrimSpace(row.ResourceID),
		LogicGateID:    strings.TrimSpace(pointerStringValue(row.LogicGateID)),
		NodeID:         strings.TrimSpace(row.NodeID),
		AssignmentID:   strings.TrimSpace(row.AssignmentID),
	}
}

func projectRelationshipProjectionRowKeyString(key ProjectionRowKey) string {
	return strings.TrimSpace(key.ProjectID) + ":" + strings.TrimSpace(key.RelationshipID)
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

func projectRelationshipProjectionRowsMeaningfullyEqual(left, right ProjectRelationshipProjectionRow) bool {
	left.ProjectionUpdatedTimestamp = time.Time{}
	right.ProjectionUpdatedTimestamp = time.Time{}
	return reflect.DeepEqual(left, right)
}

func diffProjectRelationshipProjectionRows(before, after []ProjectRelationshipProjectionRow) []ProjectionDelta {
	beforeByKey := map[string]ProjectRelationshipProjectionRow{}
	afterByKey := map[string]ProjectRelationshipProjectionRow{}
	keys := map[string]ProjectionRowKey{}
	for _, row := range before {
		key := projectRelationshipProjectionRowKey(row)
		keyString := projectRelationshipProjectionRowKeyString(key)
		if keyString == ":" {
			continue
		}
		beforeByKey[keyString] = cloneProjectRelationshipProjectionRow(row)
		keys[keyString] = key
	}
	for _, row := range after {
		key := projectRelationshipProjectionRowKey(row)
		keyString := projectRelationshipProjectionRowKeyString(key)
		if keyString == ":" {
			continue
		}
		afterByKey[keyString] = cloneProjectRelationshipProjectionRow(row)
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
				Projection:         ProjectionNameProjectRelationship,
				Operation:          ProjectionDeltaOperationDelete,
				RowKey:             key,
				ProjectedTimestamp: projectedAt,
			})
		case hasAfter && (!hadBefore || !projectRelationshipProjectionRowsMeaningfullyEqual(beforeRow, afterRow)):
			row := cloneProjectRelationshipProjectionRow(afterRow)
			projectedAt := row.ProjectionUpdatedTimestamp
			if projectedAt.IsZero() {
				projectedAt = now
			}
			deltas = append(deltas, ProjectionDelta{
				CompanyID:          row.CompanyID,
				Projection:         ProjectionNameProjectRelationship,
				Operation:          ProjectionDeltaOperationUpsert,
				RowKey:             key,
				Row:                &row,
				ProjectedTimestamp: projectedAt,
			})
		}
	}
	return deltas
}

func ProjectRelationshipProjectionUpsertDeltas(rows []ProjectRelationshipProjectionRow) []ProjectionDelta {
	now := time.Now().UTC()
	deltas := make([]ProjectionDelta, 0, len(rows))
	for _, row := range rows {
		row = cloneProjectRelationshipProjectionRow(row)
		key := projectRelationshipProjectionRowKey(row)
		if projectRelationshipProjectionRowKeyString(key) == ":" {
			continue
		}
		projectedAt := row.ProjectionUpdatedTimestamp
		if projectedAt.IsZero() {
			projectedAt = now
		}
		deltas = append(deltas, ProjectionDelta{
			CompanyID:          row.CompanyID,
			Projection:         ProjectionNameProjectRelationship,
			Operation:          ProjectionDeltaOperationUpsert,
			RowKey:             key,
			Row:                &row,
			ProjectedTimestamp: projectedAt,
		})
	}
	return deltas
}

func ProjectRelationshipProjectionProjectScope(projectID string) string {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return ""
	}
	return "project:" + projectID
}
