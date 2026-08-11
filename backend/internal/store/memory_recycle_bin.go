package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

type memoryRecycleBinItem struct {
	Item     domain.RecycleBinItem
	Targets  []CompanyExplorerDeletedTarget
	Snapshot memoryRecycleBinSnapshot
}

type memoryRecycleBinSnapshot struct {
	nodes                         map[string]domain.Node
	nodeInfo                      map[string][]domain.NodeInformation
	nodeText                      map[string]map[string]domain.NodeProjection
	nodeRels                      map[string][]domain.NodeRelationship
	nodeAccountAssignments        map[string]domain.NodeAccountAssignment
	logicGates                    map[string]domain.LogicGate
	huddleLogicGates              map[string]domain.HuddleLogicGate
	huddleNodes                   map[string]domain.HuddleNode
	kpis                          map[string]domain.KPI
	huddleExplorerFolders         map[string]domain.HuddleExplorerFolder
	huddleExplorerItems           map[string]domain.HuddleExplorerItem
	logicGateInfo                 map[string][]domain.LogicGateInformation
	logicGateText                 map[string]map[string]domain.LogicGateProjection
	logicGateRels                 map[string][]domain.LogicGateRelationship
	logicGateRACI                 map[string][]domain.LogicGateRACIAssignment
	projects                      map[string]domain.Project
	projectInfo                   map[string][]domain.ProjectInformation
	projectText                   map[string]map[string]domain.ProjectProjection
	projectRelationships          map[string]domain.ProjectRelationship
	projectRelationshipProjection map[string]domain.ProjectRelationshipProjection
	sharedInboxRACI               map[string][]domain.SharedInboxRACIAssignment
	folders                       map[string]domain.CompanyExplorerFolder
	folderItems                   map[string]domain.CompanyExplorerFolderItem
	folderShares                  map[string]domain.CompanyExplorerFolderShare
	kanbanBoards                  map[string]domain.KanbanBoard
	kanbanColumns                 map[string][]domain.KanbanColumn
	kanbanCards                   map[string][]domain.KanbanCard
	nodeLogicGateAssignments      map[string]domain.NodeLogicGateAssignment
	RACIMatrixProjectionRows      map[string]memoryRACIMatrixProjectionRow
	projectTimelineItems          map[string]memoryProjectManagementTimelineItem
	projectTimelineProjection     map[string]ProjectManagementTimelineProjectionRow
	entityPermissions             map[string]domain.EntityPermission
	gvicAssignments               map[string]domain.ResourceRACIAssignment
	gvicV2Settings                map[string]memoryV2PolicySetting
	permissionV2Settings          map[string]memoryV2PolicySetting
	effectiveAccess               map[string]domain.EffectiveResourceAccess
	emailNodeLinks                map[string]communicationsEmailNodeLink
	logicGateShortcuts            map[string]domain.UserLogicGateShortcut
}

func (r *MemoryRepo) ListRecycleBinItems(companyID, deletedByUserID string) ([]domain.RecycleBinItem, error) {
	companyID = strings.TrimSpace(companyID)
	deletedByUserID = strings.TrimSpace(deletedByUserID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]domain.RecycleBinItem, 0)
	for _, record := range r.recycleBin {
		if record.Item.CompanyID == companyID && (deletedByUserID == "" || record.Item.DeletedByUserID == deletedByUserID) {
			items = append(items, record.Item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].DeletedTimestamp.Equal(items[j].DeletedTimestamp) {
			return items[i].RecycleBinItemID > items[j].RecycleBinItemID
		}
		return items[i].DeletedTimestamp.After(items[j].DeletedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) PermanentlyDeleteRecycleBinItems(companyID, deletedByUserID string, itemIDs []string) error {
	companyID = strings.TrimSpace(companyID)
	deletedByUserID = strings.TrimSpace(deletedByUserID)
	itemIDs = normalizeRecycleBinItemIDs(itemIDs)
	if companyID == "" || len(itemIDs) == 0 {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	deleted := 0
	for _, itemID := range itemIDs {
		record, ok := r.recycleBin[key(companyID, itemID)]
		if !ok || record.Item.CompanyID != companyID || (deletedByUserID != "" && record.Item.DeletedByUserID != deletedByUserID) {
			continue
		}
		delete(r.recycleBin, key(companyID, itemID))
		deleted++
	}
	if deleted == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) RestoreRecycleBinItems(companyID, deletedByUserID string, itemIDs []string) (RecycleBinRestoreResult, error) {
	companyID = strings.TrimSpace(companyID)
	deletedByUserID = strings.TrimSpace(deletedByUserID)
	itemIDs = normalizeRecycleBinItemIDs(itemIDs)
	if companyID == "" || deletedByUserID == "" || len(itemIDs) == 0 {
		return RecycleBinRestoreResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	beforeState := r.snapshotRecycleStateLocked()
	beforeRecycleBin := cloneMap(r.recycleBin)
	beforeDomainEvents := cloneMap(r.domainEvents)
	beforeWorkspaceReadVersions := cloneMap(r.workspaceReadVersions)
	beforeOutbox := cloneMap(r.realtimeOutbox)
	beforeOutboxSequence := r.realtimeOutboxSequence
	committed := false
	defer func() {
		if !committed {
			r.restoreRecycleSnapshotLocked(beforeState)
			r.recycleBin = beforeRecycleBin
			r.domainEvents = beforeDomainEvents
			r.workspaceReadVersions = beforeWorkspaceReadVersions
			r.realtimeOutbox = beforeOutbox
			r.realtimeOutboxSequence = beforeOutboxSequence
		}
	}()
	items := make([]domain.RecycleBinItem, 0)
	targets := make([]CompanyExplorerDeletedTarget, 0)
	seenTargets := map[string]bool{}
	var snapshot *memoryRecycleBinSnapshot
	for _, itemID := range itemIDs {
		record, ok := r.recycleBin[key(companyID, itemID)]
		if !ok || record.Item.CompanyID != companyID || record.Item.DeletedByUserID != deletedByUserID {
			continue
		}
		items = append(items, record.Item)
		for _, target := range record.Targets {
			targets = appendCompanyExplorerDeletedTarget(targets, seenTargets, target.Kind, target.ID, target.FolderKind)
		}
		copySnapshot := record.Snapshot
		snapshot = &copySnapshot
	}
	if len(items) == 0 || snapshot == nil {
		return RecycleBinRestoreResult{}, ErrNotFound
	}
	r.restoreRecycleSnapshotLocked(*snapshot)
	events, err := r.appendDomainEventsLocked(companyExplorerTargetWorkspaceEventInputs(companyID, targets, true))
	if err != nil {
		return RecycleBinRestoreResult{}, err
	}
	for _, item := range items {
		delete(r.recycleBin, key(companyID, item.RecycleBinItemID))
	}
	committed = true
	return RecycleBinRestoreResult{Items: items, Targets: targets, Events: events}, nil
}

func (r *MemoryRepo) createRecycleBinItemsLocked(companyID, deletedByUserID string, targets []CompanyExplorerDeletedTarget, snapshot memoryRecycleBinSnapshot) {
	now := time.Now().UTC()
	deletedByUserID = strings.TrimSpace(deletedByUserID)
	seen := map[string]bool{}
	for _, target := range targets {
		if target.Kind == "kanban" {
			continue
		}
		recycleKey := target.Kind + ":" + target.ID
		if seen[recycleKey] {
			continue
		}
		seen[recycleKey] = true
		itemID := newUUIDv7String()
		item := domain.RecycleBinItem{
			CompanyID:        companyID,
			RecycleBinItemID: itemID,
			ObjectKind:       target.Kind,
			ObjectID:         target.ID,
			ObjectLabel:      r.recycleTargetLabelLocked(companyID, target),
			ObjectFolderKind: target.FolderKind,
			ContainedItems:   recycleContainedItemsFromMemorySnapshot(domain.RecycleBinItem{CompanyID: companyID, ObjectKind: target.Kind, ObjectID: target.ID}, snapshot),
			DeletedByUserID:  deletedByUserID,
			DeletedTimestamp: now,
		}
		if strings.TrimSpace(item.ObjectLabel) == "" {
			item.ObjectLabel = target.ID
		}
		r.recycleBin[key(companyID, itemID)] = memoryRecycleBinItem{
			Item:     item,
			Targets:  append([]CompanyExplorerDeletedTarget(nil), targets...),
			Snapshot: snapshot,
		}
	}
}

func (r *MemoryRepo) recycleTargetLabelLocked(companyID string, target CompanyExplorerDeletedTarget) string {
	switch target.Kind {
	case "folder":
		return r.folders[key(companyID, target.ID)].Name
	case "node":
		return r.nodes[key(companyID, target.ID)].Title
	case "logic_gate":
		return r.logicGates[key(companyID, target.ID)].Header
	case "project":
		return r.projects[key(companyID, target.ID)].Name
	case "kanban":
		return "Kanban board"
	default:
		return ""
	}
}

func (r *MemoryRepo) snapshotRecycleStateLocked() memoryRecycleBinSnapshot {
	return memoryRecycleBinSnapshot{
		nodes:                         cloneMap(r.nodes),
		nodeInfo:                      cloneSliceMap(r.nodeInfo),
		nodeText:                      cloneNestedMap(r.nodeText),
		nodeRels:                      cloneSliceMap(r.nodeRels),
		nodeAccountAssignments:        cloneMap(r.nodeAccountAssignments),
		logicGates:                    cloneMap(r.logicGates),
		huddleLogicGates:              cloneMap(r.huddleLogicGates),
		huddleNodes:                   cloneMap(r.huddleNodes),
		kpis:                          cloneMap(r.kpis),
		huddleExplorerFolders:         cloneMap(r.huddleExplorerFolders),
		huddleExplorerItems:           cloneMap(r.huddleExplorerItems),
		logicGateInfo:                 cloneSliceMap(r.logicGateInfo),
		logicGateText:                 cloneNestedMap(r.logicGateText),
		logicGateRels:                 cloneSliceMap(r.logicGateRels),
		logicGateRACI:                 cloneSliceMap(r.logicGateRACI),
		projects:                      cloneMap(r.projects),
		projectInfo:                   cloneSliceMap(r.projectInfo),
		projectText:                   cloneNestedMap(r.projectText),
		projectRelationships:          cloneMap(r.projectRelationships),
		projectRelationshipProjection: cloneMap(r.projectRelationshipProjection),
		sharedInboxRACI:               cloneSliceMap(r.sharedInboxRACI),
		folders:                       cloneMap(r.folders),
		folderItems:                   cloneMap(r.folderItems),
		folderShares:                  cloneMap(r.folderShares),
		kanbanBoards:                  cloneMap(r.kanbanBoards),
		kanbanColumns:                 cloneSliceMap(r.kanbanColumns),
		kanbanCards:                   cloneSliceMap(r.kanbanCards),
		nodeLogicGateAssignments:      cloneMap(r.nodeLogicGateAssignments),
		RACIMatrixProjectionRows:      cloneMap(r.RACIMatrixProjectionRows),
		projectTimelineItems:          cloneMap(r.projectTimelineItems),
		projectTimelineProjection:     cloneMap(r.projectTimelineProjection),
		entityPermissions:             cloneMap(r.entityPermissions),
		gvicAssignments:               cloneMap(r.gvicAssignments),
		gvicV2Settings:                cloneMap(r.gvicV2Settings),
		permissionV2Settings:          cloneMap(r.permissionV2Settings),
		effectiveAccess:               cloneMap(r.effectiveAccess),
		emailNodeLinks:                cloneMap(r.emailNodeLinks),
		logicGateShortcuts:            cloneMap(r.logicGateShortcuts),
	}
}

func (r *MemoryRepo) restoreRecycleSnapshotLocked(snapshot memoryRecycleBinSnapshot) {
	r.nodes = cloneMap(snapshot.nodes)
	r.nodeInfo = cloneSliceMap(snapshot.nodeInfo)
	r.nodeText = cloneNestedMap(snapshot.nodeText)
	r.nodeRels = cloneSliceMap(snapshot.nodeRels)
	r.nodeAccountAssignments = cloneMap(snapshot.nodeAccountAssignments)
	r.logicGates = cloneMap(snapshot.logicGates)
	r.huddleLogicGates = cloneMap(snapshot.huddleLogicGates)
	r.huddleNodes = cloneMap(snapshot.huddleNodes)
	r.kpis = cloneMap(snapshot.kpis)
	r.huddleExplorerFolders = cloneMap(snapshot.huddleExplorerFolders)
	r.huddleExplorerItems = cloneMap(snapshot.huddleExplorerItems)
	r.logicGateInfo = cloneSliceMap(snapshot.logicGateInfo)
	r.logicGateText = cloneNestedMap(snapshot.logicGateText)
	r.logicGateRels = cloneSliceMap(snapshot.logicGateRels)
	r.logicGateRACI = cloneSliceMap(snapshot.logicGateRACI)
	r.projects = cloneMap(snapshot.projects)
	r.projectInfo = cloneSliceMap(snapshot.projectInfo)
	r.projectText = cloneNestedMap(snapshot.projectText)
	r.projectRelationships = cloneMap(snapshot.projectRelationships)
	r.projectRelationshipProjection = cloneMap(snapshot.projectRelationshipProjection)
	r.sharedInboxRACI = cloneSliceMap(snapshot.sharedInboxRACI)
	r.folders = cloneMap(snapshot.folders)
	r.folderItems = cloneMap(snapshot.folderItems)
	r.folderShares = cloneMap(snapshot.folderShares)
	r.kanbanBoards = cloneMap(snapshot.kanbanBoards)
	r.kanbanColumns = cloneSliceMap(snapshot.kanbanColumns)
	r.kanbanCards = cloneSliceMap(snapshot.kanbanCards)
	r.nodeLogicGateAssignments = cloneMap(snapshot.nodeLogicGateAssignments)
	r.RACIMatrixProjectionRows = cloneMap(snapshot.RACIMatrixProjectionRows)
	r.projectTimelineItems = cloneMap(snapshot.projectTimelineItems)
	r.projectTimelineProjection = cloneMap(snapshot.projectTimelineProjection)
	r.entityPermissions = cloneMap(snapshot.entityPermissions)
	r.gvicAssignments = cloneMap(snapshot.gvicAssignments)
	r.gvicV2Settings = cloneMap(snapshot.gvicV2Settings)
	r.permissionV2Settings = cloneMap(snapshot.permissionV2Settings)
	r.effectiveAccess = cloneMap(snapshot.effectiveAccess)
	r.emailNodeLinks = cloneMap(snapshot.emailNodeLinks)
	r.logicGateShortcuts = cloneMap(snapshot.logicGateShortcuts)
}

func cloneMap[V any](input map[string]V) map[string]V {
	out := make(map[string]V, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func cloneSliceMap[V any](input map[string][]V) map[string][]V {
	out := make(map[string][]V, len(input))
	for key, values := range input {
		out[key] = append([]V{}, values...)
	}
	return out
}

func cloneNestedMap[V any](input map[string]map[string]V) map[string]map[string]V {
	out := make(map[string]map[string]V, len(input))
	for key, values := range input {
		out[key] = cloneMap(values)
	}
	return out
}
