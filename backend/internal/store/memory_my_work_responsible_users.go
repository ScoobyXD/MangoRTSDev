package store

import "strings"

func (r *MemoryRepo) attachMyWorkResponsibleUserIDsLocked(items []RACIMatrixProjectionRow) {
	if len(items) == 0 {
		return
	}
	wanted := make(map[string]bool, len(items))
	for _, item := range items {
		wanted[myWorkResponsibleUsersContextKey(item)] = true
	}
	byContext := make(map[string]map[string]bool)
	for _, source := range r.RACIMatrixProjectionRows {
		if source.ResourceType != RACIMatrixProjectionResourceNode {
			continue
		}
		userID := strings.TrimSpace(source.UserID)
		if userID == "" {
			continue
		}
		for _, row := range r.myWorkFlatPathRowsForNodeProjectionLocked(source) {
			if row.RACIAssignment != "responsible" {
				continue
			}
			contextKey := myWorkResponsibleUsersContextKey(row)
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
		items[index].ResponsibleUserIDs = sortedResponsibleUserIDs(byContext[myWorkResponsibleUsersContextKey(items[index])])
	}
}
