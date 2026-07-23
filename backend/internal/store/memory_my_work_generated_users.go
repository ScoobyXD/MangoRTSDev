package store

import "strings"

func (r *MemoryRepo) attachMyWorkGeneratedUserIDsLocked(items []GVICMatrixProjectionRow) {
	if len(items) == 0 {
		return
	}
	wanted := make(map[string]bool, len(items))
	for _, item := range items {
		wanted[myWorkGeneratedUsersContextKey(item)] = true
	}
	byContext := make(map[string]map[string]bool)
	for _, source := range r.GVICMatrixProjectionRows {
		if source.ResourceType != GVICMatrixProjectionResourceNode {
			continue
		}
		userID := strings.TrimSpace(source.UserID)
		if userID == "" {
			continue
		}
		for _, row := range r.myWorkFlatPathRowsForNodeProjectionLocked(source) {
			if row.GVICAssignment != "generated" {
				continue
			}
			contextKey := myWorkGeneratedUsersContextKey(row)
			if !wanted[contextKey] {
				continue
			}
			users := byContext[contextKey]
			if users == nil {
				users = map[string]bool{}
				byContext[contextKey] = users
			}
			users[userID] = true
		}
	}
	for index := range items {
		items[index].GeneratedUserIDs = sortedGeneratedUserIDs(byContext[myWorkGeneratedUsersContextKey(items[index])])
	}
}
