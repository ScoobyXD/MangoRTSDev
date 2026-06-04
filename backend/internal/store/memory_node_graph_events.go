package store

import "miraeopus/backend/internal/domain"

type memoryNodeGraphEventSnapshot struct {
	nodes             map[string]domain.Node
	nodeInfo          map[string][]domain.NodeInformation
	nodeText          map[string]map[string]domain.NodeProjection
	nodeRels          map[string][]domain.NodeRelationship
	folders           map[string]domain.CompanyExplorerFolder
	folderItems       map[string]domain.CompanyExplorerFolderItem
	defaultFolderSeed map[string]bool
	nodeMapPositions  map[string]domain.NodeMapPosition
	kanbanCards       map[string][]domain.KanbanCard
	emailNodeLinks    map[string]communicationsEmailNodeLink
	domainEvents      map[string]domain.DomainEvent
	eventRows         map[string]EventRow
	effectiveAccess   map[string]domain.EffectiveResourceAccess
}

func cloneMemoryMap[V any](items map[string]V) map[string]V {
	out := make(map[string]V, len(items))
	for k, v := range items {
		out[k] = v
	}
	return out
}

func cloneMemorySliceMap[V any](items map[string][]V) map[string][]V {
	out := make(map[string][]V, len(items))
	for k, v := range items {
		out[k] = append([]V(nil), v...)
	}
	return out
}

func cloneMemoryNodeText(items map[string]map[string]domain.NodeProjection) map[string]map[string]domain.NodeProjection {
	out := make(map[string]map[string]domain.NodeProjection, len(items))
	for k, v := range items {
		out[k] = cloneMemoryMap(v)
	}
	return out
}

func (r *MemoryRepo) snapshotNodeGraphEventStateLocked() memoryNodeGraphEventSnapshot {
	return memoryNodeGraphEventSnapshot{
		nodes:             cloneMemoryMap(r.nodes),
		nodeInfo:          cloneMemorySliceMap(r.nodeInfo),
		nodeText:          cloneMemoryNodeText(r.nodeText),
		nodeRels:          cloneMemorySliceMap(r.nodeRels),
		folders:           cloneMemoryMap(r.folders),
		folderItems:       cloneMemoryMap(r.folderItems),
		defaultFolderSeed: cloneMemoryMap(r.defaultFolderSeed),
		nodeMapPositions:  cloneMemoryMap(r.nodeMapPositions),
		kanbanCards:       cloneMemorySliceMap(r.kanbanCards),
		emailNodeLinks:    cloneMemoryMap(r.emailNodeLinks),
		domainEvents:      cloneMemoryMap(r.domainEvents),
		eventRows:         cloneMemoryMap(r.eventRows),
		effectiveAccess:   cloneMemoryMap(r.effectiveAccess),
	}
}

func (r *MemoryRepo) restoreNodeGraphEventStateLocked(snapshot memoryNodeGraphEventSnapshot) {
	r.nodes = snapshot.nodes
	r.nodeInfo = snapshot.nodeInfo
	r.nodeText = snapshot.nodeText
	r.nodeRels = snapshot.nodeRels
	r.folders = snapshot.folders
	r.folderItems = snapshot.folderItems
	r.defaultFolderSeed = snapshot.defaultFolderSeed
	r.nodeMapPositions = snapshot.nodeMapPositions
	r.kanbanCards = snapshot.kanbanCards
	r.emailNodeLinks = snapshot.emailNodeLinks
	r.domainEvents = snapshot.domainEvents
	r.eventRows = snapshot.eventRows
	r.effectiveAccess = snapshot.effectiveAccess
}
