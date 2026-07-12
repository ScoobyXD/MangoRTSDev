package store

import "miraeopus/backend/internal/domain"

type memoryWorkItemAssignmentEventSnapshot struct {
	nodes                    map[string]domain.Node
	folderItems              map[string]domain.CompanyExplorerFolderItem
	kanbanCards              map[string][]domain.KanbanCard
	nodeLogicGateAssignments map[string]domain.NodeLogicGateAssignment
	emailNodeLinks           map[string]communicationsEmailNodeLink
	entityPermissions        map[string]domain.EntityPermission
	effectiveAccess          map[string]domain.EffectiveResourceAccess
	GVICMatrixProjectionRows map[string]memoryGVICMatrixProjectionRow
	domainEvents             map[string]domain.DomainEvent
	workspaceReadVersions    map[string]int64
}

func (r *MemoryRepo) snapshotWorkItemAssignmentEventStateLocked() memoryWorkItemAssignmentEventSnapshot {
	return memoryWorkItemAssignmentEventSnapshot{
		nodes:                    cloneMemoryMap(r.nodes),
		folderItems:              cloneMemoryMap(r.folderItems),
		kanbanCards:              cloneMemorySliceMap(r.kanbanCards),
		nodeLogicGateAssignments: cloneMemoryMap(r.nodeLogicGateAssignments),
		emailNodeLinks:           cloneMemoryMap(r.emailNodeLinks),
		entityPermissions:        cloneMemoryMap(r.entityPermissions),
		effectiveAccess:          cloneMemoryMap(r.effectiveAccess),
		GVICMatrixProjectionRows: cloneMemoryMap(r.GVICMatrixProjectionRows),
		domainEvents:             cloneMemoryMap(r.domainEvents),
		workspaceReadVersions:    cloneMemoryMap(r.workspaceReadVersions),
	}
}

func (r *MemoryRepo) restoreWorkItemAssignmentEventStateLocked(snapshot memoryWorkItemAssignmentEventSnapshot) {
	r.nodes = snapshot.nodes
	r.folderItems = snapshot.folderItems
	r.kanbanCards = snapshot.kanbanCards
	r.nodeLogicGateAssignments = snapshot.nodeLogicGateAssignments
	r.emailNodeLinks = snapshot.emailNodeLinks
	r.entityPermissions = snapshot.entityPermissions
	r.effectiveAccess = snapshot.effectiveAccess
	r.GVICMatrixProjectionRows = snapshot.GVICMatrixProjectionRows
	r.domainEvents = snapshot.domainEvents
	r.workspaceReadVersions = snapshot.workspaceReadVersions
}
