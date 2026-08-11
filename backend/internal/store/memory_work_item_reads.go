package store

import (
	"context"
	"miraeopus/backend/internal/domain"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	RACIMatrixProjectionResourceNode      = "node"
	RACIMatrixProjectionResourceLogicGate = "logic_gate"
)

type memoryRACIMatrixProjectionRow struct {
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

// rebuildV2RACIMatrixRowsLocked derives the transient memory read model from the
// four V2 policy maps. The rows are never policy authority and are rebuilt at
// each public RACI matrix read so group membership and inheritance stay live.
func (r *MemoryRepo) rebuildV2RACIMatrixRowsLocked(companyID string) {
	for rowKey, row := range r.RACIMatrixProjectionRows {
		if row.CompanyID == companyID {
			delete(r.RACIMatrixProjectionRows, rowKey)
		}
	}
	gateIDs := []string{}
	for _, gate := range r.logicGates {
		if gate.CompanyID == companyID {
			gateIDs = append(gateIDs, gate.LogicGateID)
		}
	}
	sort.Strings(gateIDs)
	for _, gateID := range gateIDs {
		r.syncRACIMatrixProjectionForLogicGateLocked(companyID, gateID)
	}
	nodeIDs := []string{}
	for _, node := range r.nodes {
		if node.CompanyID == companyID {
			nodeIDs = append(nodeIDs, node.NodeID)
		}
	}
	sort.Strings(nodeIDs)
	for _, nodeID := range nodeIDs {
		r.syncRACIMatrixProjectionForNodeLocked(companyID, nodeID)
	}
}

func (r *MemoryRepo) ListResponsibleInboxNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListResponsibleInboxNodesContext(context.Background(), query)
}

func (r *MemoryRepo) ListResponsibleInboxNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listRACIMatrixProjectedNodes(ctx, query, true)
}

func (r *MemoryRepo) ListMyNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListMyNodesContext(context.Background(), query)
}

func (r *MemoryRepo) ListMyNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listRACIMatrixProjectedNodes(ctx, query, false)
}

func (r *MemoryRepo) listRACIMatrixProjectedNodes(ctx context.Context, query WorkItemInboxQuery, responsibleOnly bool) ([]domain.Node, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	query = NormalizeWorkItemInboxQuery(query)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rebuildV2RACIMatrixRowsLocked(query.CompanyID)

	items := make([]domain.Node, 0)
	for _, row := range r.RACIMatrixProjectionRows {
		if row.CompanyID != query.CompanyID || row.UserID != query.UserID || row.ResourceType != RACIMatrixProjectionResourceNode {
			continue
		}
		if responsibleOnly {
			if row.LogicGateID == "" || !r.gvicEffectiveUserHasRoleLocked(query.CompanyID, EntityTypeNode, row.ResourceID, query.UserID, domain.RACIRoleResponsible) {
				continue
			}
		} else if row.LogicGateID != "" {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, EntityTypeNode, row.ResourceID, EntityPermissionEdit) {
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
	if query.Limit > 0 && len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) ListACIInboxLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.ListACIInboxLogicGatesContext(context.Background(), query)
}

func (r *MemoryRepo) ListACIInboxLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listRACIMatrixProjectedLogicGates(ctx, query, map[string]bool{
		domain.RACIRoleAccountable: true,
		domain.RACIRoleConsulted:   true,
		domain.RACIRoleInformed:    true,
	})
}

func (r *MemoryRepo) ListMyLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.ListMyLogicGatesContext(context.Background(), query)
}

func (r *MemoryRepo) ListMyLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listRACIMatrixProjectedLogicGates(ctx, query, nil)
}

func (r *MemoryRepo) listRACIMatrixProjectedLogicGates(ctx context.Context, query WorkItemInboxQuery, allowedRoles map[string]bool) ([]WorkItemLogicGateInboxItem, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	query = NormalizeWorkItemInboxQuery(query)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rebuildV2RACIMatrixRowsLocked(query.CompanyID)

	assignmentsByGate := r.logicGateRACIAssignmentsByGateLocked(query.CompanyID)
	items := make([]WorkItemLogicGateInboxItem, 0)
	for _, row := range r.RACIMatrixProjectionRows {
		if row.CompanyID != query.CompanyID || row.UserID != query.UserID || row.ResourceType != RACIMatrixProjectionResourceLogicGate {
			continue
		}
		roles := r.gvicEffectiveRolesForUserLocked(query.CompanyID, EntityTypeLogicGate, row.ResourceID, query.UserID, allowedRoles)
		if len(roles) == 0 {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, EntityTypeLogicGate, row.ResourceID, EntityPermissionEdit) {
			continue
		}
		item := WorkItemLogicGateInboxItem{
			CompanyID:        row.CompanyID,
			LogicGateID:      row.ResourceID,
			Header:           row.LogicGateHeader,
			Roles:            roles,
			RACIAssignments:  assignmentsByGate[row.ResourceID],
			CreatedTimestamp: row.LogicGateCreatedTimestamp,
		}
		if item.RACIAssignments == nil {
			item.RACIAssignments = []domain.LogicGateRACIAssignment{}
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
	if query.Limit > 0 && len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) syncRACIMatrixProjectionForNodeLocked(companyID, nodeID string) {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	if companyID == "" || nodeID == "" {
		return
	}
	r.syncResourceRACIEffectiveAssignmentsLocked([]resourceRACIKey{{companyID: companyID, resourceType: EntityTypeNode, resourceID: nodeID}})
	desired := map[string]bool{}
	node, ok := r.nodes[key(companyID, nodeID)]
	if ok {
		node = r.withNodeReadModelLocked(node)
		logicGateID := ""
		assignment, assigned := r.nodeLogicGateAssignmentLocked(companyID, nodeID, "")
		if assigned && strings.TrimSpace(assignment.LogicGateID) != "" {
			logicGateID = strings.TrimSpace(assignment.LogicGateID)
		}
		users := r.gvicEffectiveUsersForResourceLocked(companyID, EntityTypeNode, node.NodeID, nil)
		for userID := range users {
			if userID != "" {
				rowKey := RACIMatrixProjectionKey(companyID, userID, RACIMatrixProjectionResourceNode, node.NodeID)
				desired[rowKey] = true
				r.upsertRACIMatrixProjectionNodeRowLocked(companyID, node, logicGateID, userID)
			}
		}
	}
	r.deleteStaleRACIMatrixProjectionForNodeLocked(companyID, nodeID, desired)
}

func (r *MemoryRepo) syncRACIMatrixProjectionForLogicGateLocked(companyID, logicGateID string) {
	r.syncResourceRACIEffectiveAssignmentsLocked([]resourceRACIKey{{companyID: companyID, resourceType: EntityTypeLogicGate, resourceID: logicGateID}})
	users := r.RACIMatrixProjectionUsersForLogicGateLocked(companyID, logicGateID)
	for userID := range r.gvicEffectiveUsersForResourceLocked(companyID, EntityTypeLogicGate, logicGateID, nil) {
		users[userID] = true
	}
	for _, nodeID := range r.nodeIDsAssignedToLogicGateLocked(companyID, logicGateID) {
		for userID := range r.gvicEffectiveUsersForResourceLocked(companyID, EntityTypeNode, nodeID, nil) {
			users[userID] = true
		}
	}
	r.syncRACIMatrixProjectionForLogicGateUsersLocked(companyID, logicGateID, mapKeys(users))
}

func (r *MemoryRepo) syncRACIMatrixProjectionForLogicGateAssignmentsLocked(companyID, logicGateID string, before, after []domain.LogicGateRACIAssignment) {
	r.syncRACIMatrixProjectionForLogicGateLocked(companyID, logicGateID)
}

func (r *MemoryRepo) syncRACIMatrixProjectionForLogicGateUsersLocked(companyID, logicGateID string, userIDs []string) {
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
		if r.logicGateUserHasAnyRACILocked(companyID, logicGateID, userID) {
			desired[RACIMatrixProjectionKey(companyID, userID, RACIMatrixProjectionResourceLogicGate, logicGateID)] = true
			r.upsertRACIMatrixProjectionLogicGateRowLocked(companyID, logicGateID, userID)
		}
		for _, nodeID := range r.nodeIDsAssignedToLogicGateLocked(companyID, logicGateID) {
			if !r.gvicEffectiveUsersForResourceLocked(companyID, EntityTypeNode, nodeID, nil)[userID] {
				continue
			}
			node, ok := r.nodes[key(companyID, nodeID)]
			if !ok {
				continue
			}
			desired[RACIMatrixProjectionKey(companyID, userID, RACIMatrixProjectionResourceNode, nodeID)] = true
			r.upsertRACIMatrixProjectionNodeRowLocked(companyID, r.withNodeReadModelLocked(node), logicGateID, userID)
		}
		r.deleteStaleRACIMatrixProjectionForLogicGateUserLocked(companyID, logicGateID, userID, desired)
	}
}

func (r *MemoryRepo) deleteRACIMatrixProjectionForNodeLocked(companyID, nodeID string) {
	r.deleteStaleRACIMatrixProjectionForNodeLocked(companyID, nodeID, map[string]bool{})
}

func (r *MemoryRepo) deleteStaleRACIMatrixProjectionForNodeLocked(companyID, nodeID string, desired map[string]bool) {
	for rowKey, row := range r.RACIMatrixProjectionRows {
		if row.CompanyID == companyID && row.ResourceType == RACIMatrixProjectionResourceNode && row.ResourceID == nodeID {
			if !desired[rowKey] {
				delete(r.RACIMatrixProjectionRows, rowKey)
			}
		}
	}
}

func (r *MemoryRepo) deleteRACIMatrixProjectionForLogicGateUserLocked(companyID, logicGateID, userID string) {
	r.deleteStaleRACIMatrixProjectionForLogicGateUserLocked(companyID, logicGateID, userID, map[string]bool{})
}

func (r *MemoryRepo) deleteStaleRACIMatrixProjectionForLogicGateUserLocked(companyID, logicGateID, userID string, desired map[string]bool) {
	for rowKey, row := range r.RACIMatrixProjectionRows {
		if row.CompanyID != companyID || row.UserID != userID || row.LogicGateID != logicGateID {
			continue
		}
		if row.ResourceType == RACIMatrixProjectionResourceLogicGate || row.ResourceType == RACIMatrixProjectionResourceNode {
			if !desired[rowKey] {
				delete(r.RACIMatrixProjectionRows, rowKey)
			}
		}
	}
}

func (r *MemoryRepo) deleteRACIMatrixProjectionForLogicGateLocked(companyID, logicGateID string) {
	for rowKey, row := range r.RACIMatrixProjectionRows {
		if row.CompanyID == companyID && row.LogicGateID == logicGateID {
			delete(r.RACIMatrixProjectionRows, rowKey)
		}
	}
}

func (r *MemoryRepo) v2RACIMatrixSourceTimestampLocked(companyID, resourceType, resourceID, userID string, fallback time.Time) time.Time {
	for _, assignment := range r.gvicEffectiveAssignmentsForResourceLocked(companyID, resourceType, resourceID) {
		if assignment.UserID == userID && assignment.UpdatedTimestamp.After(fallback) {
			fallback = assignment.UpdatedTimestamp
		}
	}
	if fallback.IsZero() {
		return time.Unix(0, 0).UTC()
	}
	return fallback
}

func (r *MemoryRepo) upsertRACIMatrixProjectionNodeRowLocked(companyID string, node domain.Node, logicGateID, userID string) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	row := memoryRACIMatrixProjectionRow{
		CompanyID:        companyID,
		UserID:           userID,
		ResourceType:     RACIMatrixProjectionResourceNode,
		ResourceID:       node.NodeID,
		LogicGateID:      strings.TrimSpace(logicGateID),
		Node:             node,
		UpdatedTimestamp: r.v2RACIMatrixSourceTimestampLocked(companyID, EntityTypeNode, node.NodeID, userID, node.CreatedTimestamp),
	}
	r.RACIMatrixProjectionRows[RACIMatrixProjectionKey(companyID, userID, RACIMatrixProjectionResourceNode, node.NodeID)] = row
}

func (r *MemoryRepo) upsertRACIMatrixProjectionLogicGateRowLocked(companyID, logicGateID, userID string) {
	gate, ok := r.logicGates[key(companyID, logicGateID)]
	if !ok || strings.TrimSpace(userID) == "" {
		return
	}
	row := memoryRACIMatrixProjectionRow{
		CompanyID:                 companyID,
		UserID:                    userID,
		ResourceType:              RACIMatrixProjectionResourceLogicGate,
		ResourceID:                logicGateID,
		LogicGateID:               logicGateID,
		LogicGateHeader:           gate.Header,
		LogicGateCreatedTimestamp: gate.CreatedTimestamp,
		UpdatedTimestamp:          r.v2RACIMatrixSourceTimestampLocked(companyID, EntityTypeLogicGate, logicGateID, userID, gate.CreatedTimestamp),
	}
	r.RACIMatrixProjectionRows[RACIMatrixProjectionKey(companyID, userID, RACIMatrixProjectionResourceLogicGate, logicGateID)] = row
}

func (r *MemoryRepo) RACIMatrixProjectionRowsForResourcesLocked(companyID string, nodeIDs, logicGateIDs []string) []RACIMatrixProjectionRow {
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
	items := make([]RACIMatrixProjectionRow, 0)
	seen := map[string]bool{}
	for _, row := range r.RACIMatrixProjectionRows {
		if row.CompanyID != companyID || row.ResourceType != RACIMatrixProjectionResourceNode {
			continue
		}
		nodeMatches := len(nodeSet) > 0 && nodeSet[row.ResourceID]
		logicGateMatches := len(logicGateSet) > 0 && logicGateSet[row.LogicGateID]
		if !nodeMatches && !logicGateMatches {
			continue
		}
		for _, item := range r.raciMatrixFlatPathRowsForNodeProjectionLocked(row) {
			key := gvicMatrixProjectionRowIdentity(item)
			if key == ":" || seen[key] {
				continue
			}
			seen[key] = true
			items = append(items, item)
		}
	}
	for _, row := range r.RACIMatrixProjectionRows {
		if row.CompanyID != companyID || row.ResourceType != RACIMatrixProjectionResourceLogicGate {
			continue
		}
		if len(logicGateSet) > 0 && !logicGateSet[row.ResourceID] {
			continue
		}
		if len(logicGateSet) == 0 {
			continue
		}
		item := memoryRACIMatrixProjectionRowToDTO(row)
		key := gvicMatrixProjectionRowIdentity(item)
		if key == ":" || seen[key] {
			continue
		}
		seen[key] = true
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].UserID != items[j].UserID {
			return items[i].UserID < items[j].UserID
		}
		if items[i].ProjectionRowID != items[j].ProjectionRowID {
			return items[i].ProjectionRowID < items[j].ProjectionRowID
		}
		return items[i].NodeID < items[j].NodeID
	})
	return items
}

func (r *MemoryRepo) RACIMatrixProjectionRowsForLogicGateLocked(companyID, logicGateID string) []RACIMatrixProjectionRow {
	items := make([]RACIMatrixProjectionRow, 0)
	seen := map[string]bool{}
	for _, row := range r.RACIMatrixProjectionRows {
		if row.CompanyID != companyID || row.ResourceType != RACIMatrixProjectionResourceNode || row.LogicGateID != logicGateID {
			continue
		}
		for _, item := range r.raciMatrixFlatPathRowsForNodeProjectionLocked(row) {
			key := gvicMatrixProjectionRowIdentity(item)
			if key == ":" || seen[key] {
				continue
			}
			seen[key] = true
			items = append(items, item)
		}
	}
	for _, row := range r.RACIMatrixProjectionRows {
		if row.CompanyID != companyID || row.ResourceType != RACIMatrixProjectionResourceLogicGate || row.ResourceID != logicGateID {
			continue
		}
		item := memoryRACIMatrixProjectionRowToDTO(row)
		key := gvicMatrixProjectionRowIdentity(item)
		if key == ":" || seen[key] {
			continue
		}
		seen[key] = true
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].UserID != items[j].UserID {
			return items[i].UserID < items[j].UserID
		}
		if items[i].ProjectionRowID != items[j].ProjectionRowID {
			return items[i].ProjectionRowID < items[j].ProjectionRowID
		}
		return items[i].NodeID < items[j].NodeID
	})
	return items
}

func (r *MemoryRepo) ListRACIMatrixProjectionRowsForResources(companyID string, nodeIDs, logicGateIDs []string) ([]RACIMatrixProjectionRow, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rebuildV2RACIMatrixRowsLocked(companyID)
	return r.RACIMatrixProjectionRowsForResourcesLocked(companyID, nodeIDs, logicGateIDs), nil
}

func (r *MemoryRepo) ListRACIMatrixProjectionRowsForUser(query WorkItemInboxQuery) ([]RACIMatrixProjectionRow, error) {
	query = NormalizeWorkItemInboxQuery(query)
	if query.CompanyID == "" || query.UserID == "" {
		return nil, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rebuildV2RACIMatrixRowsLocked(query.CompanyID)
	items := make([]RACIMatrixProjectionRow, 0)
	for _, row := range r.RACIMatrixProjectionRows {
		if row.CompanyID != query.CompanyID || row.UserID != query.UserID || row.ResourceType != RACIMatrixProjectionResourceNode {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, EntityTypeNode, row.ResourceID, EntityPermissionEdit) {
			continue
		}
		for _, item := range r.raciMatrixFlatPathRowsForNodeProjectionLocked(row) {
			if !r.userCanReadRACIMatrixProjectionContextLocked(query.CompanyID, query.ViewerUserID, item) {
				continue
			}
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if RACIRoleSortValue(items[i].RACIAssignment) != RACIRoleSortValue(items[j].RACIAssignment) {
			return RACIRoleSortValue(items[i].RACIAssignment) < RACIRoleSortValue(items[j].RACIAssignment)
		}
		leftPriority := raciMatrixProjectionPrioritySort(items[i].Priority)
		rightPriority := raciMatrixProjectionPrioritySort(items[j].Priority)
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		return items[i].ProjectionRowID < items[j].ProjectionRowID
	})
	for index := range items {
		items[index].SortOrder = index + 1
	}
	if query.Limit > 0 && len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) userCanReadRACIMatrixProjectionContextLocked(companyID, viewerUserID string, row RACIMatrixProjectionRow) bool {
	if row.LogicGateID != nil && strings.TrimSpace(*row.LogicGateID) != "" {
		if !r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeLogicGate, strings.TrimSpace(*row.LogicGateID), EntityPermissionEdit) {
			return false
		}
	}
	if strings.TrimSpace(row.ProjectID) != "" {
		if !r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeProject, strings.TrimSpace(row.ProjectID), EntityPermissionEdit) {
			return false
		}
	}
	return true
}

func (r *MemoryRepo) raciMatrixFlatPathRowsForNodeProjectionLocked(row memoryRACIMatrixProjectionRow) []RACIMatrixProjectionRow {
	if row.ResourceType != RACIMatrixProjectionResourceNode || strings.TrimSpace(row.ResourceID) == "" || strings.TrimSpace(row.Node.NodeID) == "" {
		return nil
	}
	roles := r.raciMatrixRolesForProjectionRowLocked(row)
	if len(roles) == 0 {
		return nil
	}
	projectContexts, hasProject := r.raciMatrixProjectContextsLocked(row)
	if hasProject && len(projectContexts) == 0 {
		return nil
	}
	if !hasProject && workItemStatusDone(row.Node.Status) {
		return nil
	}
	if len(projectContexts) == 0 {
		projectContexts = []raciMatrixProjectContext{{}}
	}
	out := make([]RACIMatrixProjectionRow, 0, len(roles)*len(projectContexts))
	for _, role := range roles {
		for _, project := range projectContexts {
			out = append(out, r.raciMatrixFlatPathRowForNodeRoleLocked(row, role, project))
		}
	}
	return out
}

func (r *MemoryRepo) raciMatrixFlatPathRowForNodeRoleLocked(row memoryRACIMatrixProjectionRow, role string, project raciMatrixProjectContext) RACIMatrixProjectionRow {
	nodeID := strings.TrimSpace(row.ResourceID)
	logicGateID := strings.TrimSpace(row.LogicGateID)
	projectID := strings.TrimSpace(project.projectID)
	projectName := strings.TrimSpace(project.projectName)
	logicGateName := ""
	if logicGateID != "" {
		if gate, ok := r.logicGates[key(row.CompanyID, logicGateID)]; ok && strings.TrimSpace(gate.Header) != "" {
			logicGateName = strings.TrimSpace(gate.Header)
		}
	}
	item := RACIMatrixProjectionRow{
		CompanyID:        row.CompanyID,
		ProjectionRowID:  memoryRACIMatrixProjectionRowID(row, role, projectID),
		UserID:           row.UserID,
		NodeName:         row.Node.Title,
		RACIAssignment:   role,
		ProjectID:        projectID,
		ProjectName:      projectName,
		LogicGateName:    logicGateName,
		NodeID:           nodeID,
		Status:           cloneStringPointer(row.Node.Status),
		DueDate:          cloneStringPointer(row.Node.DueDate),
		Priority:         cloneIntPointer(row.Node.Priority),
		Accounts:         cloneAccountSnapshots(row.Node.Accounts),
		CreatedTimestamp: row.Node.CreatedTimestamp,
		UpdatedTimestamp: row.UpdatedTimestamp,
	}
	if strings.TrimSpace(item.NodeName) == "" {
		item.NodeName = nodeID
	}
	if logicGateID != "" {
		item.LogicGateID = stringPointer(logicGateID)
	}
	return item
}

func memoryRACIMatrixProjectionRowID(row memoryRACIMatrixProjectionRow, role, projectID string) string {
	priority := "none"
	if row.Node.Priority != nil {
		priority = strconv.Itoa(*row.Node.Priority)
	}
	project := strings.TrimSpace(projectID)
	if project == "" {
		project = "none"
	}
	logicGateID := strings.TrimSpace(row.LogicGateID)
	if logicGateID == "" {
		logicGateID = "none"
	}
	parts := []string{
		"raci_matrix_node_leaf",
		strings.TrimSpace(row.CompanyID),
		strings.TrimSpace(row.UserID),
		strings.TrimSpace(role),
		priority,
		"node",
		strings.TrimSpace(row.ResourceID),
		"project",
		project,
		"logic_gate",
		logicGateID,
	}
	return strings.Join(parts, ":")
}

func raciMatrixProjectionPrioritySort(priority *int) int {
	if priority == nil || *priority <= 0 {
		return 6
	}
	if *priority > 5 {
		return 5
	}
	return *priority
}
func (r *MemoryRepo) ListRACIMatrixProjectionRowsForLogicGate(companyID, logicGateID string) ([]RACIMatrixProjectionRow, error) {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return nil, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rebuildV2RACIMatrixRowsLocked(companyID)
	return r.RACIMatrixProjectionRowsForLogicGateLocked(companyID, logicGateID), nil
}

func memoryRACIMatrixProjectionRowToDTO(row memoryRACIMatrixProjectionRow) RACIMatrixProjectionRow {
	item := RACIMatrixProjectionRow{
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
	if row.ResourceType == RACIMatrixProjectionResourceLogicGate {
		item.DisplayTitle = row.LogicGateHeader
		item.ResourceCreatedTimestamp = row.LogicGateCreatedTimestamp
		return item
	}
	item.Status = cloneStringPointer(row.Node.Status)
	item.DueDate = cloneStringPointer(row.Node.DueDate)
	item.Priority = cloneIntPointer(row.Node.Priority)
	item.Accounts = cloneAccountSnapshots(row.Node.Accounts)
	return item
}

func (r *MemoryRepo) raciMatrixRolesForProjectionRowLocked(row memoryRACIMatrixProjectionRow) []string {
	return r.gvicEffectiveRolesForUserLocked(row.CompanyID, row.ResourceType, row.ResourceID, row.UserID, map[string]bool{
		domain.RACIRoleResponsible: true,
		domain.RACIRoleAccountable: true,
		domain.RACIRoleConsulted:   true,
		domain.RACIRoleInformed:    true,
	})
}

type raciMatrixProjectContext struct {
	projectID   string
	projectName string
	position    int
	created     time.Time
	id          string
}

func (r *MemoryRepo) raciMatrixProjectContextsLocked(row memoryRACIMatrixProjectionRow) ([]raciMatrixProjectContext, bool) {
	candidates := make([]raciMatrixProjectContext, 0)
	hasProject := false
	seen := map[string]bool{}
	for _, projection := range r.projectRelationshipProjection {
		if projection.CompanyID != row.CompanyID {
			continue
		}
		related := false
		if row.ResourceType == RACIMatrixProjectionResourceLogicGate {
			related = projection.LogicGateID != nil && strings.TrimSpace(*projection.LogicGateID) == row.ResourceID
		} else if row.ResourceType == RACIMatrixProjectionResourceNode {
			related = projection.NodeID != nil && strings.TrimSpace(*projection.NodeID) == row.ResourceID
		}
		if !related {
			continue
		}
		hasProject = true
		project, ok := r.projects[key(row.CompanyID, projection.ProjectID)]
		projectStatus := ""
		name := strings.TrimSpace(projection.ProjectName)
		if ok {
			projectStatus = project.Status
			if strings.TrimSpace(project.Name) != "" {
				name = project.Name
			}
		}
		done := workItemStatusDone(&projectStatus)
		if done {
			continue
		}
		keyValue := projection.ProjectID
		if seen[keyValue] {
			continue
		}
		seen[keyValue] = true
		candidates = append(candidates, raciMatrixProjectContext{
			projectID:   projection.ProjectID,
			projectName: name,
			position:    projection.Position,
			created:     projection.RelationshipCreatedTimestamp,
			id:          projection.RelationshipID,
		})
	}
	if len(candidates) == 0 {
		return nil, hasProject
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].position != candidates[j].position {
			return candidates[i].position < candidates[j].position
		}
		if strings.ToLower(candidates[i].projectName) != strings.ToLower(candidates[j].projectName) {
			return strings.ToLower(candidates[i].projectName) < strings.ToLower(candidates[j].projectName)
		}
		if !candidates[i].created.Equal(candidates[j].created) {
			return candidates[i].created.Before(candidates[j].created)
		}
		return candidates[i].id < candidates[j].id
	})
	return candidates, hasProject
}

func workItemStatusDone(status *string) bool {
	if status == nil {
		return false
	}
	clean := strings.ToLower(strings.TrimSpace(*status))
	clean = strings.NewReplacer(" ", "_", "-", "_").Replace(clean)
	switch clean {
	case "done", "complete", "completed", "closed", "archived":
		return true
	default:
		return false
	}
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

func (r *MemoryRepo) logicGateRACIAssignmentsByGateLocked(companyID string) map[string][]domain.LogicGateRACIAssignment {
	assignmentsByGate := map[string][]domain.LogicGateRACIAssignment{}
	for _, gate := range r.logicGates {
		if gate.CompanyID != companyID {
			continue
		}
		copied := r.logicGateRACIAssignmentsAsLogicGateRACILocked(companyID, gate.LogicGateID)
		sortLogicGateRACIAssignments(copied)
		if len(copied) == 0 {
			continue
		}
		assignmentsByGate[gate.LogicGateID] = copied
	}
	return assignmentsByGate
}

func (r *MemoryRepo) logicGateRACIUserIDsLocked(companyID, logicGateID string) []string {
	return mapKeys(r.gvicEffectiveUsersForResourceLocked(companyID, EntityTypeLogicGate, logicGateID, nil))
}

func (r *MemoryRepo) logicGateUserHasRoleLocked(companyID, logicGateID, userID, role string) bool {
	return r.gvicEffectiveUserHasRoleLocked(companyID, EntityTypeLogicGate, logicGateID, userID, role)
}

func (r *MemoryRepo) logicGateUserHasAnyRACILocked(companyID, logicGateID, userID string) bool {
	return r.gvicEffectiveUsersForResourceLocked(companyID, EntityTypeLogicGate, logicGateID, nil)[strings.TrimSpace(userID)]
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

func (r *MemoryRepo) RACIMatrixProjectionUsersForLogicGateLocked(companyID, logicGateID string) map[string]bool {
	users := map[string]bool{}
	for _, row := range r.RACIMatrixProjectionRows {
		if row.CompanyID == companyID && row.LogicGateID == logicGateID && strings.TrimSpace(row.UserID) != "" {
			users[row.UserID] = true
		}
	}
	return users
}

func RACIMatrixProjectionKey(companyID, userID, resourceType, resourceID string) string {
	return companyID + ":" + userID + ":" + resourceType + ":" + resourceID
}

func (r *MemoryRepo) logicGateRACIAssignmentUserSetLocked(companyID string, assignments []domain.LogicGateRACIAssignment) map[string]bool {
	users := map[string]bool{}
	for _, assignment := range assignments {
		principalType, principalID := logicGateRACIAssignmentPrincipal(assignment)
		switch principalType {
		case EntityPermissionSubjectUser:
			if principalID != "" {
				users[principalID] = true
			}
		case EntityPermissionSubjectGroup:
			groupIDs := companyUserGroupSubtreeIDsLocked(r.userGroups, companyID, principalID)
			for _, member := range r.userGroupMembers {
				if member.CompanyID == companyID && groupIDs[member.GroupID] && strings.TrimSpace(member.UserID) != "" {
					users[member.UserID] = true
				}
			}
		}
	}
	return users
}

func (r *MemoryRepo) RACIMatrixAssignmentChangedUserSetLocked(companyID string, before, after []domain.LogicGateRACIAssignment) map[string]bool {
	beforeRoles := r.RACIMatrixAssignmentRoleSetByUserLocked(companyID, before)
	afterRoles := r.RACIMatrixAssignmentRoleSetByUserLocked(companyID, after)
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

func (r *MemoryRepo) RACIMatrixAssignmentRoleSetByUserLocked(companyID string, assignments []domain.LogicGateRACIAssignment) map[string]map[string]bool {
	out := map[string]map[string]bool{}
	for _, assignment := range assignments {
		role := strings.TrimSpace(assignment.Role)
		if role == "" {
			continue
		}
		for userID := range r.logicGateRACIAssignmentUserSetLocked(companyID, []domain.LogicGateRACIAssignment{assignment}) {
			if out[userID] == nil {
				out[userID] = map[string]bool{}
			}
			out[userID][role] = true
		}
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

func (r *MemoryRepo) logicGateRACIRolesForUserLocked(companyID string, assignments []domain.LogicGateRACIAssignment, userID string, allowedRoles map[string]bool) []string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil
	}
	seen := map[string]bool{}
	for _, assignment := range assignments {
		role := strings.TrimSpace(assignment.Role)
		if role == "" || seen[role] {
			continue
		}
		if !r.logicGateRACIAssignmentUserSetLocked(companyID, []domain.LogicGateRACIAssignment{assignment})[userID] {
			continue
		}
		if allowedRoles != nil && !allowedRoles[role] {
			continue
		}
		seen[role] = true
	}
	roles := mapKeys(seen)
	sort.Slice(roles, func(i, j int) bool {
		if RACIRoleSortValue(roles[i]) != RACIRoleSortValue(roles[j]) {
			return RACIRoleSortValue(roles[i]) < RACIRoleSortValue(roles[j])
		}
		return roles[i] < roles[j]
	})
	return roles
}

func (r *MemoryRepo) gvicEffectiveUsersForResourceLocked(companyID, resourceType, resourceID string, allowedRoles map[string]bool) map[string]bool {
	users := map[string]bool{}
	for _, assignment := range r.gvicEffectiveAssignmentsForResourceLocked(companyID, resourceType, resourceID) {
		role := strings.TrimSpace(assignment.Role)
		if allowedRoles != nil && !allowedRoles[role] {
			continue
		}
		userID := strings.TrimSpace(assignment.UserID)
		if userID != "" {
			users[userID] = true
		}
	}
	return users
}
func (r *MemoryRepo) gvicEffectiveUserHasRoleLocked(companyID, resourceType, resourceID, userID, role string) bool {
	userID = strings.TrimSpace(userID)
	role, ok := NormalizeRACIRole(role)
	if userID == "" || !ok {
		return false
	}
	return r.gvicEffectiveUsersForResourceLocked(companyID, resourceType, resourceID, map[string]bool{role: true})[userID]
}

func (r *MemoryRepo) gvicEffectiveRolesForUserLocked(companyID, resourceType, resourceID, userID string, allowedRoles map[string]bool) []string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil
	}
	seen := map[string]bool{}
	for _, assignment := range r.gvicEffectiveAssignmentsForResourceLocked(companyID, resourceType, resourceID) {
		if assignment.UserID != userID {
			continue
		}
		role := strings.TrimSpace(assignment.Role)
		if role == "" || seen[role] {
			continue
		}
		if allowedRoles != nil && !allowedRoles[role] {
			continue
		}
		seen[role] = true
	}
	roles := mapKeys(seen)
	sort.Slice(roles, func(i, j int) bool {
		if RACIRoleSortValue(roles[i]) != RACIRoleSortValue(roles[j]) {
			return RACIRoleSortValue(roles[i]) < RACIRoleSortValue(roles[j])
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
