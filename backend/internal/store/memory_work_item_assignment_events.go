package store

import (
	"time"

	"miraeopus/backend/internal/domain"
)

type memoryWorkItemAssignmentEventSnapshot struct {
	nodes                     map[string]domain.Node
	folderItems               map[string]domain.CompanyExplorerFolderItem
	kanbanCards               map[string][]domain.KanbanCard
	nodeLogicGateAssignments  map[string]domain.NodeLogicGateAssignment
	emailNodeLinks            map[string]communicationsEmailNodeLink
	entityPermissions         map[string]domain.EntityPermission
	effectiveAccess           map[string]domain.EffectiveResourceAccess
	RACIMatrixProjectionRows  map[string]memoryRACIMatrixProjectionRow
	domainEvents              map[string]domain.DomainEvent
	nodeCompletionTransitions map[string]time.Time
	workspaceReadVersions     map[string]int64
}

func (r *MemoryRepo) snapshotWorkItemAssignmentEventStateLocked() memoryWorkItemAssignmentEventSnapshot {
	return memoryWorkItemAssignmentEventSnapshot{
		nodes:                     cloneMemoryMap(r.nodes),
		folderItems:               cloneMemoryMap(r.folderItems),
		kanbanCards:               cloneMemorySliceMap(r.kanbanCards),
		nodeLogicGateAssignments:  cloneMemoryMap(r.nodeLogicGateAssignments),
		emailNodeLinks:            cloneMemoryMap(r.emailNodeLinks),
		entityPermissions:         cloneMemoryMap(r.entityPermissions),
		effectiveAccess:           cloneMemoryMap(r.effectiveAccess),
		RACIMatrixProjectionRows:  cloneMemoryMap(r.RACIMatrixProjectionRows),
		domainEvents:              cloneMemoryMap(r.domainEvents),
		nodeCompletionTransitions: cloneMemoryMap(r.nodeCompletionTransitions),
		workspaceReadVersions:     cloneMemoryMap(r.workspaceReadVersions),
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
	r.RACIMatrixProjectionRows = snapshot.RACIMatrixProjectionRows
	r.domainEvents = snapshot.domainEvents
	r.nodeCompletionTransitions = snapshot.nodeCompletionTransitions
	r.workspaceReadVersions = snapshot.workspaceReadVersions
}
