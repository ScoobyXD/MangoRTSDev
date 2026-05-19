package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

func (r *MemoryRepo) ListResponsibleInboxNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listAssignedWorkItemInboxNodes(query)
}

func (r *MemoryRepo) ListMyNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	return r.listAssignedWorkItemInboxNodes(query)
}

func (r *MemoryRepo) listAssignedWorkItemInboxNodes(query WorkItemInboxQuery) ([]domain.Node, error) {
	query = NormalizeWorkItemInboxQuery(query)
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.Node, 0)
	for _, node := range r.nodes {
		if node.CompanyID != query.CompanyID || node.AssigneeUserID == nil || strings.TrimSpace(*node.AssigneeUserID) != query.UserID {
			continue
		}
		items = append(items, r.withNodeReadModelLocked(node))
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
	return r.listWorkItemLogicGateInboxItems(query, map[string]bool{
		domain.LogicGateRaciRoleAccountable: true,
		domain.LogicGateRaciRoleConsulted:   true,
		domain.LogicGateRaciRoleInformed:    true,
	})
}

func (r *MemoryRepo) ListMyLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error) {
	return r.listWorkItemLogicGateInboxItems(query, nil)
}

func (r *MemoryRepo) listWorkItemLogicGateInboxItems(query WorkItemInboxQuery, allowedRoles map[string]bool) ([]WorkItemLogicGateInboxItem, error) {
	query = NormalizeWorkItemInboxQuery(query)
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]WorkItemLogicGateInboxItem, 0)
	for _, gate := range r.logicGates {
		if gate.CompanyID != query.CompanyID {
			continue
		}
		assignments := r.logicGateRaci[key(gate.CompanyID, gate.LogicGateID)]
		roles := workItemInboxRolesForUser(assignments, query.UserID, allowedRoles)
		if len(roles) == 0 {
			continue
		}
		gate = r.withLogicGateRaciLocked(gate)
		items = append(items, WorkItemLogicGateInboxItem{
			CompanyID:        gate.CompanyID,
			LogicGateID:      gate.LogicGateID,
			Header:           gate.Header,
			Roles:            roles,
			RaciAssignments:  gate.RaciAssignments,
			CreatedTimestamp: gate.CreatedTimestamp,
		})
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
