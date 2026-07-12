package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *MemoryRepo) GetLogicGateWork(companyID, logicGateID string) (domain.LogicGateWorkView, error) {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return domain.LogicGateWorkView{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	logicGate, ok := r.logicGates[key(companyID, logicGateID)]
	if !ok {
		return domain.LogicGateWorkView{}, ErrNotFound
	}
	logicGate = r.withLogicGateGVICLocked(logicGate)
	if policy, found := r.resolvedResourcePermissionPolicyLocked(companyID, EntityTypeLogicGate, logicGateID); found {
		logicGate.DefaultAccess = policy.DefaultAccess
	}

	assignments := make([]logicGateWorkAssignment, 0)
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID != companyID || assignment.LogicGateID != logicGateID {
			continue
		}
		node, ok := r.nodes[key(companyID, assignment.NodeID)]
		if !ok {
			continue
		}
		assignments = append(assignments, logicGateWorkAssignment{
			Assignment: assignment,
			Node:       r.logicGateWorkNodeSummaryLocked(node, assignment),
		})
	}
	boardID := LogicGateKanbanBoardID(logicGateID)
	sequence := r.projectionSequences[companyID+":"+ProjectionNameKanbanBoard+":"+"board:"+boardID]
	work := buildLogicGateWorkView(logicGate, assignments, sequence)
	emailOriginKeys := make(map[string]bool)
	for linkKey, link := range r.emailNodeLinks {
		if linkKey != emailNodeLinkKey(link.CompanyID, link.BoardID, link.CardID) {
			continue
		}
		if link.CompanyID != companyID || link.LogicGateID != logicGateID {
			continue
		}
		emailOriginKeys[logicGateWorkCardEmailOriginKey(link.BoardID, link.CardID, link.NodeID)] = true
	}
	markLogicGateWorkEmailOriginCards(&work, emailOriginKeys)
	return work, nil
}

func (r *MemoryRepo) logicGateWorkNodeSummaryLocked(node domain.Node, assignment domain.NodeLogicGateAssignment) domain.Node {
	node = r.withNodeReadModelLocked(node)
	node.LogicGateIDs = []string{assignment.LogicGateID}
	return node
}

func (r *MemoryRepo) LogicGateWorkAccessFlags(companyID, userID, logicGateID string) (domain.EffectiveAccessFlags, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || userID == "" || logicGateID == "" {
		return domain.EffectiveAccessFlags{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if !r.entityExistsLocked(companyID, EntityTypeLogicGate, logicGateID) {
		return domain.EffectiveAccessFlags{}, ErrNotFound
	}
	return domain.EffectiveAccessFlags{
		CanView:  r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, logicGateID, EntityPermissionView),
		CanEdit:  r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, logicGateID, EntityPermissionEdit),
		CanAdmin: r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, logicGateID, EntityPermissionAdmin),
	}, nil
}

func (r *MemoryRepo) CurrentLogicGateWorkVersion(companyID, logicGateID string) (int64, error) {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return 0, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return 0, ErrNotFound
	}
	return r.workspaceReadVersions[logicGateWorkReadVersionMemoryKey(companyID, logicGateID)], nil
}
