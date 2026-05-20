package store

import (
	"context"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const (
	memoryWorkItemInboxEntryKindNode      = "node"
	memoryWorkItemInboxEntryKindLogicGate = "logic_gate"
	memoryWorkItemInboxRoleAssignee       = "assignee"
)

type memoryWorkItemInboxEntry struct {
	CompanyID                 string
	UserID                    string
	EntryKind                 string
	Role                      string
	Node                      domain.Node
	LogicGateID               string
	LogicGateHeader           string
	LogicGateCreatedTimestamp time.Time
	RaciAssignment            domain.LogicGateRaciAssignment
}

func (r *MemoryRepo) ListResponsibleInboxNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListResponsibleInboxNodesContext(context.Background(), query)
}

func (r *MemoryRepo) ListResponsibleInboxNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listAssignedWorkItemInboxNodes(ctx, query)
}

func (r *MemoryRepo) ListMyNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.ListMyNodesContext(context.Background(), query)
}

func (r *MemoryRepo) ListMyNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listAssignedWorkItemInboxNodes(ctx, query)
}

func (r *MemoryRepo) RebuildWorkItemInboxEntries(companyID string) error {
	companyID = strings.TrimSpace(companyID)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rebuildWorkItemInboxEntriesForCompanyLocked(companyID)
	return nil
}

func (r *MemoryRepo) RebuildWorkItemInboxEntriesForNode(companyID, nodeID string) error {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rebuildWorkItemInboxEntriesForNodeLocked(companyID, nodeID)
	return nil
}

func (r *MemoryRepo) RebuildWorkItemInboxEntriesForLogicGate(companyID, logicGateID string) error {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rebuildWorkItemInboxEntriesForLogicGateLocked(companyID, logicGateID)
	return nil
}

func (r *MemoryRepo) listAssignedWorkItemInboxNodes(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	query = NormalizeWorkItemInboxQuery(query)
	r.mu.Lock()
	defer r.mu.Unlock()

	r.rebuildWorkItemInboxEntriesForCompanyLocked(query.CompanyID)
	items := make([]domain.Node, 0)
	for _, entry := range r.workItemInboxEntries {
		if entry.CompanyID != query.CompanyID || entry.UserID != query.UserID || entry.EntryKind != memoryWorkItemInboxEntryKindNode {
			continue
		}
		items = append(items, entry.Node)
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
	return r.listWorkItemLogicGateInboxItems(ctx, query, map[string]bool{
		domain.LogicGateRaciRoleAccountable: true,
		domain.LogicGateRaciRoleConsulted:   true,
		domain.LogicGateRaciRoleInformed:    true,
	})
}

func (r *MemoryRepo) ListMyLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.ListMyLogicGatesContext(context.Background(), query)
}

func (r *MemoryRepo) ListMyLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listWorkItemLogicGateInboxItems(ctx, query, nil)
}

func (r *MemoryRepo) listWorkItemLogicGateInboxItems(ctx context.Context, query WorkItemInboxQuery, allowedRoles map[string]bool) ([]WorkItemLogicGateInboxItem, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	query = NormalizeWorkItemInboxQuery(query)
	r.mu.Lock()
	defer r.mu.Unlock()

	r.rebuildWorkItemInboxEntriesForCompanyLocked(query.CompanyID)
	itemsByGate := map[string]*WorkItemLogicGateInboxItem{}
	seenRolesByGate := map[string]map[string]bool{}
	for _, entry := range r.workItemInboxEntries {
		if entry.CompanyID != query.CompanyID || entry.UserID != query.UserID || entry.EntryKind != memoryWorkItemInboxEntryKindLogicGate {
			continue
		}
		if allowedRoles != nil && !allowedRoles[entry.Role] {
			continue
		}
		item := itemsByGate[entry.LogicGateID]
		if item == nil {
			item = &WorkItemLogicGateInboxItem{
				CompanyID:        entry.CompanyID,
				LogicGateID:      entry.LogicGateID,
				Header:           entry.LogicGateHeader,
				Roles:            []string{},
				RaciAssignments:  []domain.LogicGateRaciAssignment{},
				CreatedTimestamp: entry.LogicGateCreatedTimestamp,
			}
			itemsByGate[entry.LogicGateID] = item
			seenRolesByGate[entry.LogicGateID] = map[string]bool{}
		}
		if !seenRolesByGate[entry.LogicGateID][entry.Role] {
			item.Roles = append(item.Roles, entry.Role)
			seenRolesByGate[entry.LogicGateID][entry.Role] = true
		}
	}

	assignmentsByGate := r.projectedLogicGateRaciAssignmentsByGateLocked(query.CompanyID)
	items := make([]WorkItemLogicGateInboxItem, 0, len(itemsByGate))
	for gateID, item := range itemsByGate {
		sort.Slice(item.Roles, func(i, j int) bool {
			if raciRoleSortValue(item.Roles[i]) != raciRoleSortValue(item.Roles[j]) {
				return raciRoleSortValue(item.Roles[i]) < raciRoleSortValue(item.Roles[j])
			}
			return item.Roles[i] < item.Roles[j]
		})
		item.RaciAssignments = assignmentsByGate[gateID]
		if item.RaciAssignments == nil {
			item.RaciAssignments = []domain.LogicGateRaciAssignment{}
		}
		items = append(items, *item)
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

func (r *MemoryRepo) rebuildWorkItemInboxEntriesForCompanyLocked(companyID string) {
	for entryKey, entry := range r.workItemInboxEntries {
		if entry.CompanyID == companyID {
			delete(r.workItemInboxEntries, entryKey)
		}
	}
	for _, node := range r.nodes {
		if node.CompanyID == companyID {
			r.rebuildWorkItemInboxEntriesForNodeLocked(companyID, node.NodeID)
		}
	}
	for _, gate := range r.logicGates {
		if gate.CompanyID == companyID {
			r.rebuildWorkItemInboxEntriesForLogicGateLocked(companyID, gate.LogicGateID)
		}
	}
}

func (r *MemoryRepo) rebuildWorkItemInboxEntriesForNodeLocked(companyID, nodeID string) {
	for entryKey, entry := range r.workItemInboxEntries {
		if entry.CompanyID == companyID && entry.EntryKind == memoryWorkItemInboxEntryKindNode && entry.Node.NodeID == nodeID {
			delete(r.workItemInboxEntries, entryKey)
		}
	}
	node, ok := r.nodes[key(companyID, nodeID)]
	if !ok || node.AssigneeUserID == nil || strings.TrimSpace(*node.AssigneeUserID) == "" {
		return
	}
	node = r.withNodeReadModelLocked(node)
	userID := strings.TrimSpace(*node.AssigneeUserID)
	entry := memoryWorkItemInboxEntry{
		CompanyID: companyID,
		UserID:    userID,
		EntryKind: memoryWorkItemInboxEntryKindNode,
		Role:      memoryWorkItemInboxRoleAssignee,
		Node:      node,
	}
	r.workItemInboxEntries[workItemInboxProjectionKey(companyID, memoryWorkItemInboxEntryKindNode, nodeID, userID, memoryWorkItemInboxRoleAssignee)] = entry
}

func (r *MemoryRepo) rebuildWorkItemInboxEntriesForLogicGateLocked(companyID, logicGateID string) {
	for entryKey, entry := range r.workItemInboxEntries {
		if entry.CompanyID == companyID && entry.EntryKind == memoryWorkItemInboxEntryKindLogicGate && entry.LogicGateID == logicGateID {
			delete(r.workItemInboxEntries, entryKey)
		}
	}
	gate, ok := r.logicGates[key(companyID, logicGateID)]
	if !ok {
		return
	}
	assignments := append([]domain.LogicGateRaciAssignment{}, r.logicGateRaci[key(companyID, logicGateID)]...)
	sortLogicGateRaciAssignments(assignments)
	for _, assignment := range assignments {
		userID := strings.TrimSpace(assignment.UserID)
		role := strings.TrimSpace(assignment.Role)
		if userID == "" || role == "" {
			continue
		}
		entry := memoryWorkItemInboxEntry{
			CompanyID:                 companyID,
			UserID:                    userID,
			EntryKind:                 memoryWorkItemInboxEntryKindLogicGate,
			Role:                      role,
			LogicGateID:               logicGateID,
			LogicGateHeader:           gate.Header,
			LogicGateCreatedTimestamp: gate.CreatedTimestamp,
			RaciAssignment:            assignment,
		}
		r.workItemInboxEntries[workItemInboxProjectionKey(companyID, memoryWorkItemInboxEntryKindLogicGate, logicGateID, userID, role)] = entry
	}
}

func (r *MemoryRepo) projectedLogicGateRaciAssignmentsByGateLocked(companyID string) map[string][]domain.LogicGateRaciAssignment {
	assignmentsByGate := map[string][]domain.LogicGateRaciAssignment{}
	for _, entry := range r.workItemInboxEntries {
		if entry.CompanyID != companyID || entry.EntryKind != memoryWorkItemInboxEntryKindLogicGate {
			continue
		}
		assignmentsByGate[entry.LogicGateID] = append(assignmentsByGate[entry.LogicGateID], entry.RaciAssignment)
	}
	for gateID := range assignmentsByGate {
		sortLogicGateRaciAssignments(assignmentsByGate[gateID])
	}
	return assignmentsByGate
}

func workItemInboxProjectionKey(companyID, entryKind, entityID, userID, role string) string {
	return companyID + ":" + entryKind + ":" + entityID + ":" + userID + ":" + role
}

func workItemInboxRolesForUser(assignments []domain.LogicGateRaciAssignment, userID string, allowedRoles map[string]bool) []string {
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
	roles := make([]string, 0, len(seen))
	for role := range seen {
		roles = append(roles, role)
	}
	sort.Slice(roles, func(i, j int) bool {
		if raciRoleSortValue(roles[i]) != raciRoleSortValue(roles[j]) {
			return raciRoleSortValue(roles[i]) < raciRoleSortValue(roles[j])
		}
		return roles[i] < roles[j]
	})
	return roles
}
