package store

import "miraeopus/backend/internal/domain"

type memoryWorkItemAssignmentEventSnapshot struct {
	nodes                    map[string]domain.Node
	kanbanCards              map[string][]domain.KanbanCard
	nodeLogicGateAssignments map[string]domain.NodeLogicGateAssignment
	workItemInboxEntries     map[string]memoryWorkItemInboxEntry
	domainEvents             map[string]domain.DomainEvent
}

func (r *MemoryRepo) snapshotWorkItemAssignmentEventStateLocked() memoryWorkItemAssignmentEventSnapshot {
	return memoryWorkItemAssignmentEventSnapshot{
		nodes:                    cloneMemoryMap(r.nodes),
		kanbanCards:              cloneMemorySliceMap(r.kanbanCards),
		nodeLogicGateAssignments: cloneMemoryMap(r.nodeLogicGateAssignments),
		workItemInboxEntries:     cloneMemoryMap(r.workItemInboxEntries),
		domainEvents:             cloneMemoryMap(r.domainEvents),
	}
}

func (r *MemoryRepo) restoreWorkItemAssignmentEventStateLocked(snapshot memoryWorkItemAssignmentEventSnapshot) {
	r.nodes = snapshot.nodes
	r.kanbanCards = snapshot.kanbanCards
	r.nodeLogicGateAssignments = snapshot.nodeLogicGateAssignments
	r.workItemInboxEntries = snapshot.workItemInboxEntries
	r.domainEvents = snapshot.domainEvents
}
