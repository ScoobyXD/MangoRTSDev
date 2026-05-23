package store

import "miraeopus/backend/internal/domain"

type memoryWorkItemAssignmentEventSnapshot struct {
	nodes                    map[string]domain.Node
	folderItems              map[string]domain.CompanyExplorerFolderItem
	kanbanCards              map[string][]domain.KanbanCard
	nodeLogicGateAssignments map[string]domain.NodeLogicGateAssignment
	entityPermissions        map[string]domain.EntityPermission
	effectiveAccess          map[string]domain.EffectiveResourceAccess
	workItemInboxEntries     map[string]memoryWorkItemInboxEntry
	domainEvents             map[string]domain.DomainEvent
}

func (r *MemoryRepo) snapshotWorkItemAssignmentEventStateLocked() memoryWorkItemAssignmentEventSnapshot {
	return memoryWorkItemAssignmentEventSnapshot{
		nodes:                    cloneMemoryMap(r.nodes),
		folderItems:              cloneMemoryMap(r.folderItems),
		kanbanCards:              cloneMemorySliceMap(r.kanbanCards),
		nodeLogicGateAssignments: cloneMemoryMap(r.nodeLogicGateAssignments),
		entityPermissions:        cloneMemoryMap(r.entityPermissions),
		effectiveAccess:          cloneMemoryMap(r.effectiveAccess),
		workItemInboxEntries:     cloneMemoryMap(r.workItemInboxEntries),
		domainEvents:             cloneMemoryMap(r.domainEvents),
	}
}

func (r *MemoryRepo) restoreWorkItemAssignmentEventStateLocked(snapshot memoryWorkItemAssignmentEventSnapshot) {
	r.nodes = snapshot.nodes
	r.folderItems = snapshot.folderItems
	r.kanbanCards = snapshot.kanbanCards
	r.nodeLogicGateAssignments = snapshot.nodeLogicGateAssignments
	r.entityPermissions = snapshot.entityPermissions
	r.effectiveAccess = snapshot.effectiveAccess
	r.workItemInboxEntries = snapshot.workItemInboxEntries
	r.domainEvents = snapshot.domainEvents
}
