package store

import (
	"context"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const (
	racioProjectionResourceNode      = "node"
	racioProjectionResourceLogicGate = "logic_gate"
)

type memoryRacioProjectionRow struct {
	CompanyID                 string
	UserID                    string
	ResourceType              string
	ResourceID                string
	LogicGateID               string
	Node                      domain.Node
	LogicGateHeader           string
	LogicGateCreatedTimestamp time.Time
	UpdatedTimestamp          time.Time
}

func (r *MemoryRepo) ListResponsibleInboxNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListResponsibleInboxNodesContext(context.Background(), query)
}

func (r *MemoryRepo) ListResponsibleInboxNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listRacioProjectedNodes(ctx, query, true)
}

func (r *MemoryRepo) ListMyNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListMyNodesContext(context.Background(), query)
}

func (r *MemoryRepo) ListMyNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listRacioProjectedNodes(ctx, query, false)
}

func (r *MemoryRepo) listRacioProjectedNodes(ctx context.Context, query WorkItemInboxQuery, responsibleOnly bool) ([]domain.Node, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	query = NormalizeWorkItemInboxQuery(query)
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.Node, 0)
	for _, row := range r.racioProjectionRows {
		if row.CompanyID != query.CompanyID || row.UserID != query.UserID || row.ResourceType != racioProjectionResourceNode {
			continue
		}
		if responsibleOnly {
			if row.LogicGateID == "" || !r.logicGateUserHasRoleLocked(query.CompanyID, row.LogicGateID, query.UserID, domain.LogicGateRaciRoleResponsible) {
				continue
			}
		} else if row.LogicGateID != "" {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.UserID, EntityTypeNode, row.ResourceID, EntityPermissionEdit) {
			continue
		}
		items = append(items, row.Node)
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].NodeID < items[j].NodeID
	})
	if len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) ListACIInboxLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.ListACIInboxLogicGatesContext(context.Background(), query)
}

func (r *MemoryRepo) ListACIInboxLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listRacioProjectedLogicGates(ctx, query, map[string]bool{
		domain.LogicGateRaciRoleAccountable: true,
		domain.LogicGateRaciRoleConsulted:   true,
		domain.LogicGateRaciRoleInformed:    true,
	})
}

func (r *MemoryRepo) ListMyLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.ListMyLogicGatesContext(context.Background(), query)
}

func (r *MemoryRepo) ListMyLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listRacioProjectedLogicGates(ctx, query, nil)
}

func (r *MemoryRepo) listRacioProjectedLogicGates(ctx context.Context, query WorkItemInboxQuery, allowedRoles map[string]bool) ([]WorkItemLogicGateInboxItem, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	query = NormalizeWorkItemInboxQuery(query)
	r.mu.RLock()
	defer r.mu.RUnlock()

	assignmentsByGate := r.logicGateRaciAssignmentsByGateLocked(query.CompanyID)
	items := make([]WorkItemLogicGateInboxItem, 0)
	for _, row := range r.racioProjectionRows {
		if row.CompanyID != query.CompanyID || row.UserID != query.UserID || row.ResourceType != racioProjectionResourceLogicGate {
			continue
		}
		roles := logicGateRaciRolesForUser(assignmentsByGate[row.ResourceID], query.UserID, allowedRoles)
		if len(roles) == 0 {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.UserID, EntityTypeLogicGate, row.ResourceID, EntityPermissionEdit) {
			continue
		}
		item := WorkItemLogicGateInboxItem{
			CompanyID:        row.CompanyID,
			LogicGateID:      row.ResourceID,
			Header:           row.LogicGateHeader,
			Roles:            roles,
			RaciAssignments:  assignmentsByGate[row.ResourceID],
			CreatedTimestamp: row.LogicGateCreatedTimestamp,
		}
		if item.RaciAssignments == nil {
			item.RaciAssignments = []domain.LogicGateRaciAssignment{}
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		left := strings.ToLower(strings.TrimSpace(items[i].Header))
		right := strings.ToLower(strings.TrimSpace(items[j].Header))
		if left != right {
			return left < right
		}
		return items[i].LogicGateID < items[j].LogicGateID
	})
	if len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) syncRacioProjectionForNodeLocked(companyID, nodeID string) {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	if companyID == "" || nodeID == "" {
		return
	}
	desired := map[string]bool{}
	node, ok := r.nodes[key(companyID, nodeID)]
	if ok {
		node = r.withNodeReadModelLocked(node)
		assignment, assigned := r.nodeLogicGateAssignmentLocked(companyID, nodeID, "")
		if assigned && strings.TrimSpace(assignment.LogicGateID) != "" {
			logicGateID := strings.TrimSpace(assignment.LogicGateID)
			for _, userID := range r.logicGateRaciUserIDsLocked(companyID, logicGateID) {
				userID = strings.TrimSpace(userID)
				if userID == "" {
					continue
				}
				rowKey := racioProjectionKey(companyID, userID, racioProjectionResourceNode, node.NodeID)
				desired[rowKey] = true
				r.upsertRacioProjectionNodeRowLocked(companyID, node, logicGateID, userID)
			}
		} else if node.AssigneeUserID != nil {
			userID := strings.TrimSpace(*node.AssigneeUserID)
			if userID != "" {
				if _, ok := r.memberships[membershipKey(companyID, userID)]; ok {
					rowKey := racioProjectionKey(companyID, userID, racioProjectionResourceNode, node.NodeID)
					desired[rowKey] = true
					r.upsertRacioProjectionNodeRowLocked(companyID, node, "", userID)
				}
			}
		}
	}
	r.deleteStaleRacioProjectionForNodeLocked(companyID, nodeID, desired)
}

func (r *MemoryRepo) syncRacioProjectionForNodeDeltasLocked(companyID, nodeID string) []ProjectionDelta {
	before := r.racioProjectionRowsForResourcesLocked(companyID, []string{nodeID}, nil)
	r.syncRacioProjectionForNodeLocked(companyID, nodeID)
	after := r.racioProjectionRowsForResourcesLocked(companyID, []string{nodeID}, nil)
	return diffRacioProjectionRows(before, after)
}

func (r *MemoryRepo) syncRacioProjectionForLogicGateLocked(companyID, logicGateID string) {
	users := r.racioProjectionUsersForLogicGateLocked(companyID, logicGateID)
	for _, userID := range r.logicGateRaciUserIDsLocked(companyID, logicGateID) {
		users[userID] = true
	}
	r.syncRacioProjectionForLogicGateUsersLocked(companyID, logicGateID, mapKeys(users))
}

func (r *MemoryRepo) syncRacioProjectionForLogicGateAssignmentsLocked(companyID, logicGateID string, before, after []domain.LogicGateRaciAssignment) {
	users := racioAssignmentChangedUserSet(before, after)
	r.syncRacioProjectionForLogicGateUsersLocked(companyID, logicGateID, mapKeys(users))
}

func (r *MemoryRepo) syncRacioProjectionForLogicGateAssignmentsDeltasLocked(companyID, logicGateID string, before, after []domain.LogicGateRaciAssignment) []ProjectionDelta {
	beforeRows := r.racioProjectionRowsForLogicGateLocked(companyID, logicGateID)
	r.syncRacioProjectionForLogicGateAssignmentsLocked(companyID, logicGateID, before, after)
	afterRows := r.racioProjectionRowsForLogicGateLocked(companyID, logicGateID)
	return diffRacioProjectionRows(beforeRows, afterRows)
}

func (r *MemoryRepo) syncRacioProjectionForLogicGateUsersLocked(companyID, logicGateID string, userIDs []string) {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return
	}
	sort.Strings(userIDs)
	for _, userID := range userIDs {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			continue
		}
		desired := map[string]bool{}
		if !r.logicGateUserHasAnyRaciLocked(companyID, logicGateID, userID) {
			r.deleteStaleRacioProjectionForLogicGateUserLocked(companyID, logicGateID, userID, desired)
			continue
		}
		desired[racioProjectionKey(companyID, userID, racioProjectionResourceLogicGate, logicGateID)] = true
		r.upsertRacioProjectionLogicGateRowLocked(companyID, logicGateID, userID)
		for _, nodeID := range r.nodeIDsAssignedToLogicGateLocked(companyID, logicGateID) {
			node, ok := r.nodes[key(companyID, nodeID)]
			if !ok {
				continue
			}
			desired[racioProjectionKey(companyID, userID, racioProjectionResourceNode, nodeID)] = true
			r.upsertRacioProjectionNodeRowLocked(companyID, r.withNodeReadModelLocked(node), logicGateID, userID)
		}
		r.deleteStaleRacioProjectionForLogicGateUserLocked(companyID, logicGateID, userID, desired)
	}
}

func (r *MemoryRepo) deleteRacioProjectionForNodeLocked(companyID, nodeID string) {
	r.deleteStaleRacioProjectionForNodeLocked(companyID, nodeID, map[string]bool{})
}

func (r *MemoryRepo) deleteStaleRacioProjectionForNodeLocked(companyID, nodeID string, desired map[string]bool) {
	for rowKey, row := range r.racioProjectionRows {
		if row.CompanyID == companyID && row.ResourceType == racioProjectionResourceNode && row.ResourceID == nodeID {
			if !desired[rowKey] {
				delete(r.racioProjectionRows, rowKey)
			}
		}
	}
}

func (r *MemoryRepo) deleteRacioProjectionForLogicGateUserLocked(companyID, logicGateID, userID string) {
	r.deleteStaleRacioProjectionForLogicGateUserLocked(companyID, logicGateID, userID, map[string]bool{})
}

func (r *MemoryRepo) deleteStaleRacioProjectionForLogicGateUserLocked(companyID, logicGateID, userID string, desired map[string]bool) {
	for rowKey, row := range r.racioProjectionRows {
		if row.CompanyID != companyID || row.UserID != userID || row.LogicGateID != logicGateID {
			continue
		}
		if row.ResourceType == racioProjectionResourceLogicGate || row.ResourceType == racioProjectionResourceNode {
			if !desired[rowKey] {
				delete(r.racioProjectionRows, rowKey)
			}
		}
	}
}

func (r *MemoryRepo) deleteRacioProjectionForLogicGateLocked(companyID, logicGateID string) {
	for rowKey, row := range r.racioProjectionRows {
		if row.CompanyID == companyID && row.LogicGateID == logicGateID {
			delete(r.racioProjectionRows, rowKey)
		}
	}
}

func (r *MemoryRepo) upsertRacioProjectionNodeRowLocked(companyID string, node domain.Node, logicGateID, userID string) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	row := memoryRacioProjectionRow{
		CompanyID:        companyID,
		UserID:           userID,
		ResourceType:     racioProjectionResourceNode,
		ResourceID:       node.NodeID,
		LogicGateID:      strings.TrimSpace(logicGateID),
		Node:             node,
		UpdatedTimestamp: time.Now().UTC(),
	}
	r.racioProjectionRows[racioProjectionKey(companyID, userID, racioProjectionResourceNode, node.NodeID)] = row
}

func (r *MemoryRepo) upsertRacioProjectionLogicGateRowLocked(companyID, logicGateID, userID string) {
	gate, ok := r.logicGates[key(companyID, logicGateID)]
	if !ok || strings.TrimSpace(userID) == "" {
		return
	}
	row := memoryRacioProjectionRow{
		CompanyID:                 companyID,
		UserID:                    userID,
		ResourceType:              racioProjectionResourceLogicGate,
		ResourceID:                logicGateID,
		LogicGateID:               logicGateID,
		LogicGateHeader:           gate.Header,
		LogicGateCreatedTimestamp: gate.CreatedTimestamp,
		UpdatedTimestamp:          time.Now().UTC(),
	}
	r.racioProjectionRows[racioProjectionKey(companyID, userID, racioProjectionResourceLogicGate, logicGateID)] = row
}

func (r *MemoryRepo) racioProjectionRowsForResourcesLocked(companyID string, nodeIDs, logicGateIDs []string) []RacioMatrixProjectionRow {
	nodeSet := map[string]bool{}
	for _, nodeID := range nodeIDs {
		nodeID = strings.TrimSpace(nodeID)
		if nodeID != "" {
			nodeSet[nodeID] = true
		}
	}
	logicGateSet := map[string]bool{}
	for _, logicGateID := range logicGateIDs {
		logicGateID = strings.TrimSpace(logicGateID)
		if logicGateID != "" {
			logicGateSet[logicGateID] = true
		}
	}
	items := make([]RacioMatrixProjectionRow, 0)
	for _, row := range r.racioProjectionRows {
		if row.CompanyID != companyID {
			continue
		}
		if row.ResourceType == racioProjectionResourceNode && !nodeSet[row.ResourceID] {
			continue
		}
		if row.ResourceType == racioProjectionResourceLogicGate && !logicGateSet[row.ResourceID] {
			continue
		}
		if row.ResourceType != racioProjectionResourceNode && row.ResourceType != racioProjectionResourceLogicGate {
			continue
		}
		items = append(items, memoryRacioProjectionRowToDTO(row))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].ResourceType != items[j].ResourceType {
			return items[i].ResourceType < items[j].ResourceType
		}
		if items[i].ResourceID != items[j].ResourceID {
			return items[i].ResourceID < items[j].ResourceID
		}
		return items[i].UserID < items[j].UserID
	})
	return items
}

func (r *MemoryRepo) racioProjectionRowsForLogicGateLocked(companyID, logicGateID string) []RacioMatrixProjectionRow {
	items := make([]RacioMatrixProjectionRow, 0)
	for _, row := range r.racioProjectionRows {
		if row.CompanyID != companyID || row.LogicGateID != logicGateID {
			continue
		}
		if row.ResourceType != racioProjectionResourceNode && row.ResourceType != racioProjectionResourceLogicGate {
			continue
		}
		items = append(items, memoryRacioProjectionRowToDTO(row))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].ResourceType != items[j].ResourceType {
			return items[i].ResourceType < items[j].ResourceType
		}
		if items[i].ResourceID != items[j].ResourceID {
			return items[i].ResourceID < items[j].ResourceID
		}
		return items[i].UserID < items[j].UserID
	})
	return items
}

func (r *MemoryRepo) ListRacioMatrixProjectionRowsForResources(companyID string, nodeIDs, logicGateIDs []string) ([]RacioMatrixProjectionRow, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.racioProjectionRowsForResourcesLocked(companyID, nodeIDs, logicGateIDs), nil
}

func (r *MemoryRepo) ListRacioMatrixProjectionRowsForUser(query WorkItemInboxQuery) ([]RacioMatrixProjectionRow, error) {
	query = NormalizeWorkItemInboxQuery(query)
	if query.CompanyID == "" || query.UserID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]RacioMatrixProjectionRow, 0)
	for _, row := range r.racioProjectionRows {
		if row.CompanyID != query.CompanyID || row.UserID != query.UserID {
			continue
		}
		if row.ResourceType != racioProjectionResourceNode && row.ResourceType != racioProjectionResourceLogicGate {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.UserID, row.ResourceType, row.ResourceID, EntityPermissionEdit) {
			continue
		}
		items = append(items, memoryRacioProjectionRowToDTO(row))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].ResourceType != items[j].ResourceType {
			return items[i].ResourceType < items[j].ResourceType
		}
		if !items[i].ResourceCreatedTimestamp.Equal(items[j].ResourceCreatedTimestamp) {
			return items[i].ResourceCreatedTimestamp.Before(items[j].ResourceCreatedTimestamp)
		}
		return items[i].ResourceID < items[j].ResourceID
	})
	if len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) ListRacioMatrixProjectionRowsForLogicGate(companyID, logicGateID string) ([]RacioMatrixProjectionRow, error) {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.racioProjectionRowsForLogicGateLocked(companyID, logicGateID), nil
}

func (r *MemoryRepo) NextProjectionSequence(companyID, projectionName string) (int64, error) {
	companyID = strings.TrimSpace(companyID)
	projectionName = strings.TrimSpace(projectionName)
	if companyID == "" || projectionName == "" {
		return 0, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := companyID + ":" + projectionName
	r.projectionSequences[key]++
	return r.projectionSequences[key], nil
}

func memoryRacioProjectionRowToDTO(row memoryRacioProjectionRow) RacioMatrixProjectionRow {
	item := RacioMatrixProjectionRow{
		CompanyID:                row.CompanyID,
		UserID:                   row.UserID,
		ResourceType:             row.ResourceType,
		ResourceID:               row.ResourceID,
		DisplayTitle:             row.Node.Title,
		ResourceCreatedTimestamp: row.Node.CreatedTimestamp,
		UpdatedTimestamp:         row.UpdatedTimestamp,
	}
	if row.LogicGateID != "" {
		item.LogicGateID = stringPointer(row.LogicGateID)
	}
	if row.ResourceType == racioProjectionResourceLogicGate {
		item.DisplayTitle = row.LogicGateHeader
		item.ResourceCreatedTimestamp = row.LogicGateCreatedTimestamp
		return item
	}
	item.Status = cloneStringPointer(row.Node.Status)
	item.StatusColor = cloneStringPointer(row.Node.StatusColor)
	item.DueDate = cloneStringPointer(row.Node.DueDate)
	item.Priority = cloneIntPointer(row.Node.Priority)
	item.AssigneeUserID = cloneStringPointer(row.Node.AssigneeUserID)
	item.AssigneeDisplayName = cloneStringPointer(row.Node.AssigneeName)
	item.AssigneeEmail = cloneStringPointer(row.Node.AssigneeEmail)
	return item
}

func stringPointer(value string) *string {
	return &value
}

func cloneStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func cloneIntPointer(value *int) *int {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func (r *MemoryRepo) logicGateRaciAssignmentsByGateLocked(companyID string) map[string][]domain.LogicGateRaciAssignment {
	assignmentsByGate := map[string][]domain.LogicGateRaciAssignment{}
	for keyValue, assignments := range r.logicGateRaci {
		if !strings.HasPrefix(keyValue, companyID+":") {
			continue
		}
		copied := cloneLogicGateRaciAssignments(assignments)
		sortLogicGateRaciAssignments(copied)
		if len(copied) == 0 {
			continue
		}
		assignmentsByGate[copied[0].LogicGateID] = copied
	}
	return assignmentsByGate
}

func (r *MemoryRepo) logicGateRaciUserIDsLocked(companyID, logicGateID string) []string {
	return mapKeys(racioAssignmentUserSet(r.logicGateRaci[key(companyID, logicGateID)]))
}

func (r *MemoryRepo) logicGateUserHasRoleLocked(companyID, logicGateID, userID, role string) bool {
	for _, assignment := range r.logicGateRaci[key(companyID, logicGateID)] {
		if strings.TrimSpace(assignment.UserID) == userID && assignment.Role == role {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) logicGateUserHasAnyRaciLocked(companyID, logicGateID, userID string) bool {
	for _, assignment := range r.logicGateRaci[key(companyID, logicGateID)] {
		if strings.TrimSpace(assignment.UserID) == userID {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) nodeIDsAssignedToLogicGateLocked(companyID, logicGateID string) []string {
	ids := make([]string, 0)
	seen := map[string]bool{}
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID != companyID || assignment.LogicGateID != logicGateID || seen[assignment.NodeID] {
			continue
		}
		seen[assignment.NodeID] = true
		ids = append(ids, assignment.NodeID)
	}
	sort.Strings(ids)
	return ids
}

func (r *MemoryRepo) racioProjectionUsersForLogicGateLocked(companyID, logicGateID string) map[string]bool {
	users := map[string]bool{}
	for _, row := range r.racioProjectionRows {
		if row.CompanyID == companyID && row.LogicGateID == logicGateID && strings.TrimSpace(row.UserID) != "" {
			users[row.UserID] = true
		}
	}
	return users
}

func racioProjectionKey(companyID, userID, resourceType, resourceID string) string {
	return companyID + ":" + userID + ":" + resourceType + ":" + resourceID
}

func racioAssignmentUserSet(assignments []domain.LogicGateRaciAssignment) map[string]bool {
	users := map[string]bool{}
	for _, assignment := range assignments {
		userID := strings.TrimSpace(assignment.UserID)
		if userID != "" {
			users[userID] = true
		}
	}
	return users
}

func racioAssignmentChangedUserSet(before, after []domain.LogicGateRaciAssignment) map[string]bool {
	beforeRoles := racioAssignmentRoleSetByUser(before)
	afterRoles := racioAssignmentRoleSetByUser(after)
	users := map[string]bool{}
	for userID, roles := range beforeRoles {
		if !stringSetEqual(roles, afterRoles[userID]) {
			users[userID] = true
		}
	}
	for userID, roles := range afterRoles {
		if !stringSetEqual(roles, beforeRoles[userID]) {
			users[userID] = true
		}
	}
	return users
}

func racioAssignmentRoleSetByUser(assignments []domain.LogicGateRaciAssignment) map[string]map[string]bool {
	out := map[string]map[string]bool{}
	for _, assignment := range assignments {
		userID := strings.TrimSpace(assignment.UserID)
		role := strings.TrimSpace(assignment.Role)
		if userID == "" || role == "" {
			continue
		}
		if out[userID] == nil {
			out[userID] = map[string]bool{}
		}
		out[userID][role] = true
	}
	return out
}

func stringSetEqual(left, right map[string]bool) bool {
	if len(left) != len(right) {
		return false
	}
	for value := range left {
		if !right[value] {
			return false
		}
	}
	return true
}

func logicGateRaciRolesForUser(assignments []domain.LogicGateRaciAssignment, userID string, allowedRoles map[string]bool) []string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil
	}
	seen := map[string]bool{}
	for _, assignment := range assignments {
		role := strings.TrimSpace(assignment.Role)
		if strings.TrimSpace(assignment.UserID) != userID || role == "" || seen[role] {
			continue
		}
		if allowedRoles != nil && !allowedRoles[role] {
			continue
		}
		seen[role] = true
	}
	roles := mapKeys(seen)
	sort.Slice(roles, func(i, j int) bool {
		if raciRoleSortValue(roles[i]) != raciRoleSortValue(roles[j]) {
			return raciRoleSortValue(roles[i]) < raciRoleSortValue(roles[j])
		}
		return roles[i] < roles[j]
	})
	return roles
}

func mapKeys(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
