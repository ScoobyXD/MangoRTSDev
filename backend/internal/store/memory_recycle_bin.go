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
	nodeContentChanges            map[string]domain.NodeContentChange
	nodeContentChangeSeen         map[string]time.Time
	nodeProjectionSeen            map[string]memoryNodeProjectionSeen
	nodeRels                      map[string][]domain.NodeRelationship
	nodeAccountAssignments        map[string]domain.NodeAccountAssignment
	logicGates                    map[string]domain.LogicGate
	logicGateInfo                 map[string][]domain.LogicGateInformation
	logicGateText                 map[string]map[string]domain.LogicGateProjection
	logicGateRels                 map[string][]domain.LogicGateRelationship
	logicGateGVIC                 map[string][]domain.LogicGateGVICAssignment
	projects                      map[string]domain.Project
	projectInfo                   map[string][]domain.ProjectInformation
	projectText                   map[string]map[string]domain.ProjectProjection
	projectRelationships          map[string]domain.ProjectRelationship
	projectRelationshipProjection map[string]domain.ProjectRelationshipProjection
	sharedInboxGVIC               map[string][]domain.SharedInboxGVICAssignment
	folders                       map[string]domain.CompanyExplorerFolder
	folderItems                   map[string]domain.CompanyExplorerFolderItem
	folderShares                  map[string]domain.CompanyExplorerFolderShare
	nodeMapPositions              map[string]domain.NodeMapPosition
	logicMapPositions             map[string]domain.LogicGateMapPosition
	kanbanBoards                  map[string]domain.KanbanBoard
	kanbanColumns                 map[string][]domain.KanbanColumn
	kanbanCards                   map[string][]domain.KanbanCard
	nodeLogicGateAssignments      map[string]domain.NodeLogicGateAssignment
	GVICMatrixProjectionRows      map[string]memoryGVICMatrixProjectionRow
	projectTimelineItems          map[string]memoryProjectManagementTimelineItem
	projectTimelineProjection     map[string]ProjectManagementTimelineProjectionRow
	entityPermissions             map[string]domain.EntityPermission
	effectiveAccess               map[string]domain.EffectiveResourceAccess
	emailNodeLinks                map[string]communicationsEmailNodeLink
	logicGateShortcuts            map[string]domain.UserLogicGateShortcut
}

func (r *MemoryRepo) ListRecycleBinItems(companyID string) ([]domain.RecycleBinItem, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]domain.RecycleBinItem, 0)
	for _, record := range r.recycleBin {
		if record.Item.CompanyID == companyID {
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

func (r *MemoryRepo) PermanentlyDeleteRecycleBinItems(companyID string, itemIDs []string) error {
	companyID = strings.TrimSpace(companyID)
	itemIDs = normalizeRecycleBinItemIDs(itemIDs)
	if companyID == "" || len(itemIDs) == 0 {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	deleted := 0
	for _, itemID := range itemIDs {
		record, ok := r.recycleBin[key(companyID, itemID)]
		if !ok || record.Item.CompanyID != companyID {
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

func (r *MemoryRepo) RestoreRecycleBinItems(companyID string, itemIDs []string) (RecycleBinRestoreResult, error) {
	companyID = strings.TrimSpace(companyID)
	itemIDs = normalizeRecycleBinItemIDs(itemIDs)
	if companyID == "" || len(itemIDs) == 0 {
		return RecycleBinRestoreResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]domain.RecycleBinItem, 0)
	targets := make([]CompanyExplorerDeletedTarget, 0)
	seenTargets := map[string]bool{}
	var snapshot *memoryRecycleBinSnapshot
	for _, itemID := range itemIDs {
		record, ok := r.recycleBin[key(companyID, itemID)]
		if !ok || record.Item.CompanyID != companyID {
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
	for _, item := range items {
		delete(r.recycleBin, key(companyID, item.RecycleBinItemID))
	}
	return RecycleBinRestoreResult{Items: items, Targets: targets}, nil
}

func (r *MemoryRepo) createRecycleBinItemsLocked(companyID string, targets []CompanyExplorerDeletedTarget, snapshot memoryRecycleBinSnapshot) {
	now := time.Now().UTC()
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
			DeletedTimestamp: now,
		}
		if strings.TrimSpace(item.ObjectLabel) == "" {
			item.ObjectLabel = target.ID
		}
		r.recycleBin[key(companyID, itemID)] = memoryRecycleBinItem{
			Item:     item,
			Targets:  []CompanyExplorerDeletedTarget{target},
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
		nodeContentChanges:            cloneMap(r.nodeContentChanges),
		nodeContentChangeSeen:         cloneMap(r.nodeContentChangeSeen),
		nodeProjectionSeen:            cloneMap(r.nodeProjectionSeen),
		nodeRels:                      cloneSliceMap(r.nodeRels),
		nodeAccountAssignments:        cloneMap(r.nodeAccountAssignments),
		logicGates:                    cloneMap(r.logicGates),
		logicGateInfo:                 cloneSliceMap(r.logicGateInfo),
		logicGateText:                 cloneNestedMap(r.logicGateText),
		logicGateRels:                 cloneSliceMap(r.logicGateRels),
		logicGateGVIC:                 cloneSliceMap(r.logicGateGVIC),
		projects:                      cloneMap(r.projects),
		projectInfo:                   cloneSliceMap(r.projectInfo),
		projectText:                   cloneNestedMap(r.projectText),
		projectRelationships:          cloneMap(r.projectRelationships),
		projectRelationshipProjection: cloneMap(r.projectRelationshipProjection),
		sharedInboxGVIC:               cloneSliceMap(r.sharedInboxGVIC),
		folders:                       cloneMap(r.folders),
		folderItems:                   cloneMap(r.folderItems),
		folderShares:                  cloneMap(r.folderShares),
		nodeMapPositions:              cloneMap(r.nodeMapPositions),
		logicMapPositions:             cloneMap(r.logicMapPositions),
		kanbanBoards:                  cloneMap(r.kanbanBoards),
		kanbanColumns:                 cloneSliceMap(r.kanbanColumns),
		kanbanCards:                   cloneSliceMap(r.kanbanCards),
		nodeLogicGateAssignments:      cloneMap(r.nodeLogicGateAssignments),
		GVICMatrixProjectionRows:      cloneMap(r.GVICMatrixProjectionRows),
		projectTimelineItems:          cloneMap(r.projectTimelineItems),
		projectTimelineProjection:     cloneMap(r.projectTimelineProjection),
		entityPermissions:             cloneMap(r.entityPermissions),
		effectiveAccess:               cloneMap(r.effectiveAccess),
		emailNodeLinks:                cloneMap(r.emailNodeLinks),
		logicGateShortcuts:            cloneMap(r.logicGateShortcuts),
	}
}

func (r *MemoryRepo) restoreRecycleSnapshotLocked(snapshot memoryRecycleBinSnapshot) {
	r.nodes = cloneMap(snapshot.nodes)
	r.nodeInfo = cloneSliceMap(snapshot.nodeInfo)
	r.nodeText = cloneNestedMap(snapshot.nodeText)
	r.nodeContentChanges = cloneMap(snapshot.nodeContentChanges)
	r.nodeContentChangeSeen = cloneMap(snapshot.nodeContentChangeSeen)
	r.nodeProjectionSeen = cloneMap(snapshot.nodeProjectionSeen)
	r.nodeRels = cloneSliceMap(snapshot.nodeRels)
	r.nodeAccountAssignments = cloneMap(snapshot.nodeAccountAssignments)
	r.logicGates = cloneMap(snapshot.logicGates)
	r.logicGateInfo = cloneSliceMap(snapshot.logicGateInfo)
	r.logicGateText = cloneNestedMap(snapshot.logicGateText)
	r.logicGateRels = cloneSliceMap(snapshot.logicGateRels)
	r.logicGateGVIC = cloneSliceMap(snapshot.logicGateGVIC)
	r.projects = cloneMap(snapshot.projects)
	r.projectInfo = cloneSliceMap(snapshot.projectInfo)
	r.projectText = cloneNestedMap(snapshot.projectText)
	r.projectRelationships = cloneMap(snapshot.projectRelationships)
	r.projectRelationshipProjection = cloneMap(snapshot.projectRelationshipProjection)
	r.sharedInboxGVIC = cloneSliceMap(snapshot.sharedInboxGVIC)
	r.folders = cloneMap(snapshot.folders)
	r.folderItems = cloneMap(snapshot.folderItems)
	r.folderShares = cloneMap(snapshot.folderShares)
	r.nodeMapPositions = cloneMap(snapshot.nodeMapPositions)
	r.logicMapPositions = cloneMap(snapshot.logicMapPositions)
	r.kanbanBoards = cloneMap(snapshot.kanbanBoards)
	r.kanbanColumns = cloneSliceMap(snapshot.kanbanColumns)
	r.kanbanCards = cloneSliceMap(snapshot.kanbanCards)
	r.nodeLogicGateAssignments = cloneMap(snapshot.nodeLogicGateAssignments)
	r.GVICMatrixProjectionRows = cloneMap(snapshot.GVICMatrixProjectionRows)
	r.projectTimelineItems = cloneMap(snapshot.projectTimelineItems)
	r.projectTimelineProjection = cloneMap(snapshot.projectTimelineProjection)
	r.entityPermissions = cloneMap(snapshot.entityPermissions)
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
