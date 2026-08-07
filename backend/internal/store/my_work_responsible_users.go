package store

import (
	"sort"
	"strings"
)

func myWorkResponsibleUsersContextKey(row GVICMatrixProjectionRow) string {
	logicGateID := ""
	if row.LogicGateID != nil {
		logicGateID = strings.TrimSpace(*row.LogicGateID)
	}
	return strings.Join([]string{
		strings.TrimSpace(row.CompanyID),
		strings.TrimSpace(row.ProjectID),
		logicGateID,
		strings.TrimSpace(row.NodeID),
	}, "\x00")
}

func sortedResponsibleUserIDs(values map[string]bool) []string {
	items := make([]string, 0, len(values))
	for value := range values {
		if clean := strings.TrimSpace(value); clean != "" {
			items = append(items, clean)
		}
	}
	sort.Strings(items)
	return items
}
