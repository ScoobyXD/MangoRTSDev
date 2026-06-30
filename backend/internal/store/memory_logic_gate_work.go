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

	assignments := make([]domain.LogicGateWorkAssignment, 0)
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID != companyID || assignment.LogicGateID != logicGateID {
			continue
		}
		node, ok := r.nodes[key(companyID, assignment.NodeID)]
		if !ok {
			continue
		}
		assignments = append(assignments, domain.LogicGateWorkAssignment{
			Assignment: assignment,
			Node:       r.logicGateWorkNodeSummaryLocked(node, assignment),
		})
	}
	work := buildLogicGateWorkView(logicGate, assignments)
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
	node.LogicGateIDs = []string{assignment.LogicGateID}
	return node
}
