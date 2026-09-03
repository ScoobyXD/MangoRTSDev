package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *MemoryRepo) GetLogicGateWork(companyID, logicGateID, userID string) (domain.LogicGateWorkView, error) {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return domain.LogicGateWorkView{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	gate, ok := r.logicGates[key(companyID, logicGateID)]
	if !ok {
		return domain.LogicGateWorkView{}, ErrNotFound
	}
	if policy, found := r.resolvedResourcePermissionPolicyLocked(companyID, EntityTypeLogicGate, logicGateID); found {
		gate.DefaultAccess = policy.DefaultAccess
	}
	work := domain.LogicGateWorkView{LogicGate: domain.LogicGateWorkHeader{LogicGateID: logicGateID, Header: gate.Header, DefaultAccess: defaultResourceAccessOrEdit(gate.DefaultAccess)}, Steps: r.processStepsLocked(companyID, logicGateID), Relationships: r.processStepRelationshipsLocked(companyID, logicGateID), Nodes: []domain.LogicGateWorkNode{}}
	if userID != "" {
		for _, assignment := range r.gvicEffectiveAssignmentsForResourceLocked(companyID, EntityTypeLogicGate, logicGateID) {
			if assignment.UserID == userID && assignment.Role == domain.RACIRoleResponsible {
				work.Permissions.CanResolveRequests = true
				break
			}
		}
	}
	emailNodes := map[string]bool{}
	for _, link := range r.emailNodeLinks {
		if link.CompanyID == companyID {
			emailNodes[link.NodeID] = true
		}
	}
	projectNodes := map[string]bool{}
	for _, relationship := range r.projectRelationships {
		if relationship.CompanyID == companyID && relationship.ResourceType == EntityTypeNode {
			projectNodes[relationship.ResourceID] = true
		}
	}
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID != companyID || assignment.LogicGateID != logicGateID {
			continue
		}
		node, ok := r.nodes[key(companyID, assignment.NodeID)]
		if !ok {
			continue
		}
		if userID != "" && !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeNode, node.NodeID, EntityPermissionEdit) {
			continue
		}
		item := logicGateWorkNode(assignment, r.withNodeReadModelLocked(node))
		item.HasProject = projectNodes[node.NodeID]
		item.CreatedFromEmail = emailNodes[node.NodeID]
		work.Nodes = append(work.Nodes, item)
	}
	sortLogicGateWorkNodes(work.Nodes)
	return work, nil
}
func (r *MemoryRepo) LogicGateWorkAccessFlags(companyID, userID, logicGateID string) (domain.EffectiveAccessFlags, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if companyID == "" || userID == "" || logicGateID == "" {
		return domain.EffectiveAccessFlags{}, ErrInvalid
	}
	if !r.entityExistsLocked(companyID, EntityTypeLogicGate, logicGateID) {
		return domain.EffectiveAccessFlags{}, ErrNotFound
	}
	return domain.EffectiveAccessFlags{CanEdit: r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, logicGateID, EntityPermissionEdit)}, nil
}
func (r *MemoryRepo) CurrentLogicGateWorkVersion(companyID, logicGateID string) (int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if companyID == "" || logicGateID == "" {
		return 0, ErrInvalid
	}
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return 0, ErrNotFound
	}
	return r.workspaceReadVersions[logicGateWorkReadVersionMemoryKey(companyID, logicGateID)], nil
}
