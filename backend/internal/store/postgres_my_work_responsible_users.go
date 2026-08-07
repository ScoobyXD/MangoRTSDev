//go:build step1legacy

package store

import (
	"context"
	"database/sql"
	"sort"
	"strings"
)

func attachPostgresMyWorkResponsibleUserIDs(ctx context.Context, db *sql.DB, companyID string, items []GVICMatrixProjectionRow) error {
	if len(items) == 0 {
		return nil
	}
	nodeSet := map[string]bool{}
	wanted := make(map[string]bool, len(items))
	for _, item := range items {
		if nodeID := strings.TrimSpace(item.NodeID); nodeID != "" {
			nodeSet[nodeID] = true
		}
		wanted[myWorkResponsibleUsersContextKey(item)] = true
	}
	nodeIDs := make([]string, 0, len(nodeSet))
	for nodeID := range nodeSet {
		nodeIDs = append(nodeIDs, nodeID)
	}
	sort.Strings(nodeIDs)
	if len(nodeIDs) == 0 {
		return nil
	}
	rows, err := db.QueryContext(ctx, `
select entry.company_id::text,
       coalesce(entry.project_id::text, ''),
       coalesce(entry.logic_gate_id::text, ''),
       entry.node_id::text,
       entry.user_id::text
from gvic_matrix_projection_table entry
where entry.company_id=$1::uuid
  and entry.gvic_assignment='responsible'
  and entry.node_id in (
    select btrim(value)::uuid
    from unnest(string_to_array($2::text, ',')) value
    where btrim(value) <> ''
  )
order by entry.user_id::text`, companyID, strings.Join(nodeIDs, ","))
	if err != nil {
		return err
	}
	defer rows.Close()
	byContext := make(map[string]map[string]bool)
	for rows.Next() {
		var rowCompanyID, projectID, logicGateID, nodeID, userID string
		if err := rows.Scan(&rowCompanyID, &projectID, &logicGateID, &nodeID, &userID); err != nil {
			return err
		}
		key := strings.Join([]string{strings.TrimSpace(rowCompanyID), strings.TrimSpace(projectID), strings.TrimSpace(logicGateID), strings.TrimSpace(nodeID)}, "\x00")
		if !wanted[key] {
			continue
		}
		users := byContext[key]
		if users == nil {
			users = map[string]bool{}
			byContext[key] = users
		}
		users[strings.TrimSpace(userID)] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for index := range items {
		items[index].ResponsibleUserIDs = sortedResponsibleUserIDs(byContext[myWorkResponsibleUsersContextKey(items[index])])
	}
	return nil
}
