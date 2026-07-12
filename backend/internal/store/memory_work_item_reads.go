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
	GVICMatrixProjectionResourceNode      = "node"
	GVICMatrixProjectionResourceLogicGate = "logic_gate"
)

type memoryGVICMatrixProjectionRow struct {
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

func (r *MemoryRepo) ListGeneratedInboxNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListGeneratedInboxNodesContext(context.Background(), query)
}

func (r *MemoryRepo) ListGeneratedInboxNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listGVICMatrixProjectedNodes(ctx, query, true)
}

func (r *MemoryRepo) ListMyNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListMyNodesContext(context.Background(), query)
}

func (r *MemoryRepo) ListMyNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listGVICMatrixProjectedNodes(ctx, query, false)
}

func (r *MemoryRepo) listGVICMatrixProjectedNodes(ctx context.Context, query WorkItemInboxQuery, generatedOnly bool) ([]domain.Node, error) {
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
	for _, row := range r.GVICMatrixProjectionRows {
		if row.CompanyID != query.CompanyID || row.UserID != query.UserID || row.ResourceType != GVICMatrixProjectionResourceNode {
			continue
		}
		if generatedOnly {
			if row.LogicGateID == "" || !r.gvicEffectiveUserHasRoleLocked(query.CompanyID, EntityTypeNode, row.ResourceID, query.UserID, domain.GVICRoleGenerated) {
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
	return r.listGVICMatrixProjectedLogicGates(ctx, query, map[string]bool{
		domain.GVICRoleVerified:  true,
		domain.GVICRoleConsulted: true,
		domain.GVICRoleInformed:  true,
	})
}

func (r *MemoryRepo) ListMyLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.ListMyLogicGatesContext(context.Background(), query)
}

func (r *MemoryRepo) ListMyLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listGVICMatrixProjectedLogicGates(ctx, query, nil)
}

func (r *MemoryRepo) listGVICMatrixProjectedLogicGates(ctx context.Context, query WorkItemInboxQuery, allowedRoles map[string]bool) ([]WorkItemLogicGateInboxItem, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	query = NormalizeWorkItemInboxQuery(query)
	r.mu.RLock()
	defer r.mu.RUnlock()

	assignmentsByGate := r.logicGateGVICAssignmentsByGateLocked(query.CompanyID)
	items := make([]WorkItemLogicGateInboxItem, 0)
	for _, row := range r.GVICMatrixProjectionRows {
		if row.CompanyID != query.CompanyID || row.UserID != query.UserID || row.ResourceType != GVICMatrixProjectionResourceLogicGate {
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
			GVICAssignments:  assignmentsByGate[row.ResourceID],
			CreatedTimestamp: row.LogicGateCreatedTimestamp,
		}
		if item.GVICAssignments == nil {
			item.GVICAssignments = []domain.LogicGateGVICAssignment{}
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

func (r *MemoryRepo) syncGVICMatrixProjectionForNodeLocked(companyID, nodeID string) {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	if companyID == "" || nodeID == "" {
		return
	}
	r.syncResourceGVICEffectiveAssignmentsLocked([]resourceGVICKey{{companyID: companyID, resourceType: EntityTypeNode, resourceID: nodeID}})
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
				rowKey := GVICMatrixProjectionKey(companyID, userID, GVICMatrixProjectionResourceNode, node.NodeID)
				desired[rowKey] = true
				r.upsertGVICMatrixProjectionNodeRowLocked(companyID, node, logicGateID, userID)
			}
		}
	}
	r.deleteStaleGVICMatrixProjectionForNodeLocked(companyID, nodeID, desired)
}

func (r *MemoryRepo) syncGVICMatrixProjectionForLogicGateLocked(companyID, logicGateID string) {
	r.syncResourceGVICEffectiveAssignmentsLocked([]resourceGVICKey{{companyID: companyID, resourceType: EntityTypeLogicGate, resourceID: logicGateID}})
	users := r.GVICMatrixProjectionUsersForLogicGateLocked(companyID, logicGateID)
	for userID := range r.gvicEffectiveUsersForResourceLocked(companyID, EntityTypeLogicGate, logicGateID, nil) {
		users[userID] = true
	}
	for _, nodeID := range r.nodeIDsAssignedToLogicGateLocked(companyID, logicGateID) {
		for userID := range r.gvicEffectiveUsersForResourceLocked(companyID, EntityTypeNode, nodeID, nil) {
			users[userID] = true
		}
	}
	r.syncGVICMatrixProjectionForLogicGateUsersLocked(companyID, logicGateID, mapKeys(users))
}

func (r *MemoryRepo) syncGVICMatrixProjectionForLogicGateAssignmentsLocked(companyID, logicGateID string, before, after []domain.LogicGateGVICAssignment) {
	r.syncGVICMatrixProjectionForLogicGateLocked(companyID, logicGateID)
}

func (r *MemoryRepo) syncGVICMatrixProjectionForLogicGateUsersLocked(companyID, logicGateID string, userIDs []string) {
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
		if r.logicGateUserHasAnyGVICLocked(companyID, logicGateID, userID) {
			desired[GVICMatrixProjectionKey(companyID, userID, GVICMatrixProjectionResourceLogicGate, logicGateID)] = true
			r.upsertGVICMatrixProjectionLogicGateRowLocked(companyID, logicGateID, userID)
		}
		for _, nodeID := range r.nodeIDsAssignedToLogicGateLocked(companyID, logicGateID) {
			if !r.gvicEffectiveUsersForResourceLocked(companyID, EntityTypeNode, nodeID, nil)[userID] {
				continue
			}
			node, ok := r.nodes[key(companyID, nodeID)]
			if !ok {
				continue
			}
			desired[GVICMatrixProjectionKey(companyID, userID, GVICMatrixProjectionResourceNode, nodeID)] = true
			r.upsertGVICMatrixProjectionNodeRowLocked(companyID, r.withNodeReadModelLocked(node), logicGateID, userID)
		}
		r.deleteStaleGVICMatrixProjectionForLogicGateUserLocked(companyID, logicGateID, userID, desired)
	}
}

func (r *MemoryRepo) deleteGVICMatrixProjectionForNodeLocked(companyID, nodeID string) {
	r.deleteStaleGVICMatrixProjectionForNodeLocked(companyID, nodeID, map[string]bool{})
}

func (r *MemoryRepo) deleteStaleGVICMatrixProjectionForNodeLocked(companyID, nodeID string, desired map[string]bool) {
	for rowKey, row := range r.GVICMatrixProjectionRows {
		if row.CompanyID == companyID && row.ResourceType == GVICMatrixProjectionResourceNode && row.ResourceID == nodeID {
			if !desired[rowKey] {
				delete(r.GVICMatrixProjectionRows, rowKey)
			}
		}
	}
}

func (r *MemoryRepo) deleteGVICMatrixProjectionForLogicGateUserLocked(companyID, logicGateID, userID string) {
	r.deleteStaleGVICMatrixProjectionForLogicGateUserLocked(companyID, logicGateID, userID, map[string]bool{})
}

func (r *MemoryRepo) deleteStaleGVICMatrixProjectionForLogicGateUserLocked(companyID, logicGateID, userID string, desired map[string]bool) {
	for rowKey, row := range r.GVICMatrixProjectionRows {
		if row.CompanyID != companyID || row.UserID != userID || row.LogicGateID != logicGateID {
			continue
		}
		if row.ResourceType == GVICMatrixProjectionResourceLogicGate || row.ResourceType == GVICMatrixProjectionResourceNode {
			if !desired[rowKey] {
				delete(r.GVICMatrixProjectionRows, rowKey)
			}
		}
	}
}

func (r *MemoryRepo) deleteGVICMatrixProjectionForLogicGateLocked(companyID, logicGateID string) {
	for rowKey, row := range r.GVICMatrixProjectionRows {
		if row.CompanyID == companyID && row.LogicGateID == logicGateID {
			delete(r.GVICMatrixProjectionRows, rowKey)
		}
	}
}

func (r *MemoryRepo) upsertGVICMatrixProjectionNodeRowLocked(companyID string, node domain.Node, logicGateID, userID string) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	row := memoryGVICMatrixProjectionRow{
		CompanyID:        companyID,
		UserID:           userID,
		ResourceType:     GVICMatrixProjectionResourceNode,
		ResourceID:       node.NodeID,
		LogicGateID:      strings.TrimSpace(logicGateID),
		Node:             node,
		UpdatedTimestamp: time.Now().UTC(),
	}
	r.GVICMatrixProjectionRows[GVICMatrixProjectionKey(companyID, userID, GVICMatrixProjectionResourceNode, node.NodeID)] = row
}

func (r *MemoryRepo) upsertGVICMatrixProjectionLogicGateRowLocked(companyID, logicGateID, userID string) {
	gate, ok := r.logicGates[key(companyID, logicGateID)]
	if !ok || strings.TrimSpace(userID) == "" {
		return
	}
	row := memoryGVICMatrixProjectionRow{
		CompanyID:                 companyID,
		UserID:                    userID,
		ResourceType:              GVICMatrixProjectionResourceLogicGate,
		ResourceID:                logicGateID,
		LogicGateID:               logicGateID,
		LogicGateHeader:           gate.Header,
		LogicGateCreatedTimestamp: gate.CreatedTimestamp,
		UpdatedTimestamp:          time.Now().UTC(),
	}
	r.GVICMatrixProjectionRows[GVICMatrixProjectionKey(companyID, userID, GVICMatrixProjectionResourceLogicGate, logicGateID)] = row
}

func (r *MemoryRepo) GVICMatrixProjectionRowsForResourcesLocked(companyID string, nodeIDs, logicGateIDs []string) []GVICMatrixProjectionRow {
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
	items := make([]GVICMatrixProjectionRow, 0)
	seen := map[string]bool{}
	for _, row := range r.GVICMatrixProjectionRows {
		if row.CompanyID != companyID || row.ResourceType != GVICMatrixProjectionResourceNode {
			continue
		}
		nodeMatches := len(nodeSet) > 0 && nodeSet[row.ResourceID]
		logicGateMatches := len(logicGateSet) > 0 && logicGateSet[row.LogicGateID]
		if !nodeMatches && !logicGateMatches {
			continue
		}
		for _, item := range r.myWorkFlatPathRowsForNodeProjectionLocked(row) {
			key := gvicMatrixProjectionRowIdentity(item)
			if key == ":" || seen[key] {
				continue
			}
			seen[key] = true
			items = append(items, item)
		}
	}
	for _, row := range r.GVICMatrixProjectionRows {
		if row.CompanyID != companyID || row.ResourceType != GVICMatrixProjectionResourceLogicGate {
			continue
		}
		if len(logicGateSet) > 0 && !logicGateSet[row.ResourceID] {
			continue
		}
		if len(logicGateSet) == 0 {
			continue
		}
		item := memoryGVICMatrixProjectionRowToDTO(row)
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

func (r *MemoryRepo) GVICMatrixProjectionRowsForLogicGateLocked(companyID, logicGateID string) []GVICMatrixProjectionRow {
	items := make([]GVICMatrixProjectionRow, 0)
	seen := map[string]bool{}
	for _, row := range r.GVICMatrixProjectionRows {
		if row.CompanyID != companyID || row.ResourceType != GVICMatrixProjectionResourceNode || row.LogicGateID != logicGateID {
			continue
		}
		for _, item := range r.myWorkFlatPathRowsForNodeProjectionLocked(row) {
			key := gvicMatrixProjectionRowIdentity(item)
			if key == ":" || seen[key] {
				continue
			}
			seen[key] = true
			items = append(items, item)
		}
	}
	for _, row := range r.GVICMatrixProjectionRows {
		if row.CompanyID != companyID || row.ResourceType != GVICMatrixProjectionResourceLogicGate || row.ResourceID != logicGateID {
			continue
		}
		item := memoryGVICMatrixProjectionRowToDTO(row)
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

func (r *MemoryRepo) ListGVICMatrixProjectionRowsForResources(companyID string, nodeIDs, logicGateIDs []string) ([]GVICMatrixProjectionRow, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.GVICMatrixProjectionRowsForResourcesLocked(companyID, nodeIDs, logicGateIDs), nil
}

func (r *MemoryRepo) ListGVICMatrixProjectionRowsForUser(query WorkItemInboxQuery) ([]GVICMatrixProjectionRow, error) {
	query = NormalizeWorkItemInboxQuery(query)
	if query.CompanyID == "" || query.UserID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]GVICMatrixProjectionRow, 0)
	for _, row := range r.GVICMatrixProjectionRows {
		if row.CompanyID != query.CompanyID || row.UserID != query.UserID || row.ResourceType != GVICMatrixProjectionResourceNode {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, EntityTypeNode, row.ResourceID, EntityPermissionEdit) {
			continue
		}
		for _, item := range r.myWorkFlatPathRowsForNodeProjectionLocked(row) {
			if !r.userCanReadMyWorkProjectionContextLocked(query.CompanyID, query.ViewerUserID, item) {
				continue
			}
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if GVICRoleSortValue(items[i].GVICAssignment) != GVICRoleSortValue(items[j].GVICAssignment) {
			return GVICRoleSortValue(items[i].GVICAssignment) < GVICRoleSortValue(items[j].GVICAssignment)
		}
		leftPriority := myWorkProjectionPrioritySort(items[i].Priority)
		rightPriority := myWorkProjectionPrioritySort(items[j].Priority)
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

func (r *MemoryRepo) ListMyWorkMatrixRows(query WorkItemInboxQuery) ([]GVICMatrixProjectionRow, error) {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.UserID = strings.TrimSpace(query.UserID)
	query.ViewerUserID = strings.TrimSpace(query.ViewerUserID)
	if query.CompanyID == "" || query.UserID == "" || query.ViewerUserID == "" || query.Limit < 0 {
		return nil, ErrInvalid
	}
	if query.Limit > WorkItemInboxMaxLimit {
		query.Limit = WorkItemInboxMaxLimit
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]GVICMatrixProjectionRow, 0)
	for _, row := range r.GVICMatrixProjectionRows {
		if row.CompanyID != query.CompanyID || row.UserID != query.UserID || row.ResourceType != GVICMatrixProjectionResourceNode {
			continue
		}
		if strings.TrimSpace(row.ResourceID) == "" || strings.TrimSpace(row.Node.NodeID) == "" {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, EntityTypeNode, row.ResourceID, EntityPermissionEdit) {
			continue
		}
		for _, item := range r.myWorkFlatPathRowsForNodeProjectionLocked(row) {
			if !r.userCanReadMyWorkProjectionContextLocked(query.CompanyID, query.ViewerUserID, item) {
				continue
			}
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if GVICRoleSortValue(items[i].GVICAssignment) != GVICRoleSortValue(items[j].GVICAssignment) {
			return GVICRoleSortValue(items[i].GVICAssignment) < GVICRoleSortValue(items[j].GVICAssignment)
		}
		leftPriority := myWorkProjectionPrioritySort(items[i].Priority)
		rightPriority := myWorkProjectionPrioritySort(items[j].Priority)
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		if strings.ToLower(items[i].ProjectName) != strings.ToLower(items[j].ProjectName) {
			return strings.ToLower(items[i].ProjectName) < strings.ToLower(items[j].ProjectName)
		}
		leftGate := ""
		if items[i].LogicGateID != nil {
			leftGate = *items[i].LogicGateID
		}
		rightGate := ""
		if items[j].LogicGateID != nil {
			rightGate = *items[j].LogicGateID
		}
		if leftGate != rightGate {
			return leftGate < rightGate
		}
		if strings.ToLower(items[i].NodeName) != strings.ToLower(items[j].NodeName) {
			return strings.ToLower(items[i].NodeName) < strings.ToLower(items[j].NodeName)
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

func (r *MemoryRepo) userCanReadMyWorkProjectionContextLocked(companyID, viewerUserID string, row GVICMatrixProjectionRow) bool {
	if row.LogicGateID != nil && strings.TrimSpace(*row.LogicGateID) != "" {
		if !r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeLogicGate, strings.TrimSpace(*row.LogicGateID), EntityPermissionView) {
			return false
		}
	}
	if strings.TrimSpace(row.ProjectID) != "" {
		if !r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeProject, strings.TrimSpace(row.ProjectID), EntityPermissionView) {
			return false
		}
	}
	return true
}

func (r *MemoryRepo) myWorkFlatPathRowsForNodeProjectionLocked(row memoryGVICMatrixProjectionRow) []GVICMatrixProjectionRow {
	if row.ResourceType != GVICMatrixProjectionResourceNode || strings.TrimSpace(row.ResourceID) == "" || strings.TrimSpace(row.Node.NodeID) == "" {
		return nil
	}
	roles := r.myWorkRolesForProjectionRowLocked(row)
	if len(roles) == 0 {
		return nil
	}
	projectContexts, hasProject := r.myWorkProjectContextsLocked(row)
	if hasProject && len(projectContexts) == 0 {
		return nil
	}
	if !hasProject && workItemStatusDone(row.Node.Status) {
		return nil
	}
	if len(projectContexts) == 0 {
		projectContexts = []myWorkProjectContext{{}}
	}
	out := make([]GVICMatrixProjectionRow, 0, len(roles)*len(projectContexts))
	for _, role := range roles {
		for _, project := range projectContexts {
			out = append(out, r.myWorkFlatPathRowForNodeRoleLocked(row, role, project))
		}
	}
	return out
}

func (r *MemoryRepo) myWorkFlatPathRowForNodeRoleLocked(row memoryGVICMatrixProjectionRow, role string, project myWorkProjectContext) GVICMatrixProjectionRow {
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
	item := GVICMatrixProjectionRow{
		CompanyID:        row.CompanyID,
		ProjectionRowID:  memoryMyWorkProjectionRowID(row, role, projectID),
		UserID:           row.UserID,
		NodeName:         row.Node.Title,
		GVICAssignment:   role,
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

func memoryMyWorkProjectionRowID(row memoryGVICMatrixProjectionRow, role, projectID string) string {
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
		"my_work_node_leaf",
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

func myWorkProjectionPrioritySort(priority *int) int {
	if priority == nil || *priority <= 0 {
		return 6
	}
	if *priority > 5 {
		return 5
	}
	return *priority
}
func (r *MemoryRepo) ListMyWorkMatrix(query WorkItemInboxQuery) (MyWorkMatrixResponse, error) {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.UserID = strings.TrimSpace(query.UserID)
	query.ViewerUserID = strings.TrimSpace(query.ViewerUserID)
	if query.CompanyID == "" || query.UserID == "" || query.ViewerUserID == "" || query.Limit < 0 {
		return MyWorkMatrixResponse{}, ErrInvalid
	}
	rows, err := r.ListMyWorkMatrixRows(query)
	if err != nil {
		return MyWorkMatrixResponse{}, err
	}
	return MyWorkMatrixResponse{CompanyID: query.CompanyID, UserID: query.UserID, Rows: rows}, nil
}
func (r *MemoryRepo) ListGVICMatrixProjectionRowsForLogicGate(companyID, logicGateID string) ([]GVICMatrixProjectionRow, error) {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.GVICMatrixProjectionRowsForLogicGateLocked(companyID, logicGateID), nil
}

func memoryGVICMatrixProjectionRowToDTO(row memoryGVICMatrixProjectionRow) GVICMatrixProjectionRow {
	item := GVICMatrixProjectionRow{
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
	if row.ResourceType == GVICMatrixProjectionResourceLogicGate {
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

func (r *MemoryRepo) myWorkRolesForProjectionRowLocked(row memoryGVICMatrixProjectionRow) []string {
	return r.gvicEffectiveRolesForUserLocked(row.CompanyID, row.ResourceType, row.ResourceID, row.UserID, map[string]bool{
		domain.GVICRoleGenerated: true,
		domain.GVICRoleVerified:  true,
		domain.GVICRoleConsulted: true,
		domain.GVICRoleInformed:  true,
	})
}

type myWorkProjectContext struct {
	projectID   string
	projectName string
	position    int
	created     time.Time
	id          string
}

func (r *MemoryRepo) myWorkProjectContextsLocked(row memoryGVICMatrixProjectionRow) ([]myWorkProjectContext, bool) {
	candidates := make([]myWorkProjectContext, 0)
	hasProject := false
	seen := map[string]bool{}
	for _, projection := range r.projectRelationshipProjection {
		if projection.CompanyID != row.CompanyID {
			continue
		}
		related := false
		if row.ResourceType == GVICMatrixProjectionResourceLogicGate {
			related = projection.LogicGateID != nil && strings.TrimSpace(*projection.LogicGateID) == row.ResourceID
		} else if row.ResourceType == GVICMatrixProjectionResourceNode {
			related = projection.NodeID != nil && strings.TrimSpace(*projection.NodeID) == row.ResourceID
			if !related && strings.TrimSpace(row.LogicGateID) != "" {
				related = projection.LogicGateID != nil && strings.TrimSpace(*projection.LogicGateID) == row.LogicGateID
			}
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
		keyValue := projection.ProjectID + "\x00" + projection.RelationshipID
		if seen[keyValue] {
			continue
		}
		seen[keyValue] = true
		candidates = append(candidates, myWorkProjectContext{
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

func (r *MemoryRepo) logicGateGVICAssignmentsByGateLocked(companyID string) map[string][]domain.LogicGateGVICAssignment {
	assignmentsByGate := map[string][]domain.LogicGateGVICAssignment{}
	for _, gate := range r.logicGates {
		if gate.CompanyID != companyID {
			continue
		}
		copied := r.logicGateGVICAssignmentsAsLogicGateGVICLocked(companyID, gate.LogicGateID)
		sortLogicGateGVICAssignments(copied)
		if len(copied) == 0 {
			continue
		}
		assignmentsByGate[gate.LogicGateID] = copied
	}
	return assignmentsByGate
}

func (r *MemoryRepo) logicGateGVICUserIDsLocked(companyID, logicGateID string) []string {
	return mapKeys(r.gvicEffectiveUsersForResourceLocked(companyID, EntityTypeLogicGate, logicGateID, nil))
}

func (r *MemoryRepo) logicGateUserHasRoleLocked(companyID, logicGateID, userID, role string) bool {
	return r.gvicEffectiveUserHasRoleLocked(companyID, EntityTypeLogicGate, logicGateID, userID, role)
}

func (r *MemoryRepo) logicGateUserHasAnyGVICLocked(companyID, logicGateID, userID string) bool {
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

func (r *MemoryRepo) GVICMatrixProjectionUsersForLogicGateLocked(companyID, logicGateID string) map[string]bool {
	users := map[string]bool{}
	for _, row := range r.GVICMatrixProjectionRows {
		if row.CompanyID == companyID && row.LogicGateID == logicGateID && strings.TrimSpace(row.UserID) != "" {
			users[row.UserID] = true
		}
	}
	return users
}

func GVICMatrixProjectionKey(companyID, userID, resourceType, resourceID string) string {
	return companyID + ":" + userID + ":" + resourceType + ":" + resourceID
}

func (r *MemoryRepo) logicGateGVICAssignmentUserSetLocked(companyID string, assignments []domain.LogicGateGVICAssignment) map[string]bool {
	users := map[string]bool{}
	for _, assignment := range assignments {
		principalType, principalID := logicGateGVICAssignmentPrincipal(assignment)
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

func (r *MemoryRepo) GVICMatrixAssignmentChangedUserSetLocked(companyID string, before, after []domain.LogicGateGVICAssignment) map[string]bool {
	beforeRoles := r.GVICMatrixAssignmentRoleSetByUserLocked(companyID, before)
	afterRoles := r.GVICMatrixAssignmentRoleSetByUserLocked(companyID, after)
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

func (r *MemoryRepo) GVICMatrixAssignmentRoleSetByUserLocked(companyID string, assignments []domain.LogicGateGVICAssignment) map[string]map[string]bool {
	out := map[string]map[string]bool{}
	for _, assignment := range assignments {
		role := strings.TrimSpace(assignment.Role)
		if role == "" {
			continue
		}
		for userID := range r.logicGateGVICAssignmentUserSetLocked(companyID, []domain.LogicGateGVICAssignment{assignment}) {
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

func (r *MemoryRepo) logicGateGVICRolesForUserLocked(companyID string, assignments []domain.LogicGateGVICAssignment, userID string, allowedRoles map[string]bool) []string {
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
		if !r.logicGateGVICAssignmentUserSetLocked(companyID, []domain.LogicGateGVICAssignment{assignment})[userID] {
			continue
		}
		if allowedRoles != nil && !allowedRoles[role] {
			continue
		}
		seen[role] = true
	}
	roles := mapKeys(seen)
	sort.Slice(roles, func(i, j int) bool {
		if GVICRoleSortValue(roles[i]) != GVICRoleSortValue(roles[j]) {
			return GVICRoleSortValue(roles[i]) < GVICRoleSortValue(roles[j])
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
	role, ok := NormalizeGVICRole(role)
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
		if GVICRoleSortValue(roles[i]) != GVICRoleSortValue(roles[j]) {
			return GVICRoleSortValue(roles[i]) < GVICRoleSortValue(roles[j])
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
