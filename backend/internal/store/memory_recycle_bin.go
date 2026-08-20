package store

import (
	"miraeopus/backend/internal/domain"
	"reflect"
	"sort"
	"strings"
	"time"
)

type memoryRecycleBinItem struct {
	Item     domain.RecycleBinItem
	Targets  []CompanyExplorerDeletedTarget
	Snapshot memoryRecycleBinSnapshot
	Delta    memoryRecycleBinSnapshot
	UseDelta bool
}

type memoryRecycleBinSnapshot struct {
	nodes                          map[string]domain.Node
	nodeInfo                       map[string][]domain.NodeInformation
	nodeText                       map[string]map[string]domain.NodeProjection
	nodeRels                       map[string][]domain.NodeRelationship
	nodeAccountAssignments         map[string]domain.NodeAccountAssignment
	logicGates                     map[string]domain.LogicGate
	huddleLogicGates               map[string]domain.HuddleLogicGate
	huddleNodes                    map[string]domain.HuddleNode
	kpis                           map[string]domain.KPI
	huddleExplorerFolders          map[string]domain.HuddleExplorerFolder
	huddleExplorerItems            map[string]domain.HuddleExplorerItem
	logicGateInfo                  map[string][]domain.LogicGateInformation
	logicGateText                  map[string]map[string]domain.LogicGateProjection
	logicGateRels                  map[string][]domain.LogicGateRelationship
	logicGateRACI                  map[string][]domain.LogicGateRACIAssignment
	projects                       map[string]domain.Project
	projectAccountAssignments      map[string]bool
	projectTeamAssignments         map[string]bool
	entityFieldAssignments         map[string]bool
	projectInfo                    map[string][]domain.ProjectInformation
	projectText                    map[string]map[string]domain.ProjectProjection
	projectRelationships           map[string]domain.ProjectRelationship
	projectRelationshipProjection  map[string]domain.ProjectRelationshipProjection
	projectCriticalPathSteps       map[string]domain.ProjectCriticalPathStep
	sharedInboxRACI                map[string][]domain.SharedInboxRACIAssignment
	folders                        map[string]domain.CompanyExplorerFolder
	folderItems                    map[string]domain.CompanyExplorerFolderItem
	folderShares                   map[string]domain.CompanyExplorerFolderShare
	kanbanBoards                   map[string]domain.KanbanBoard
	kanbanColumns                  map[string][]domain.KanbanColumn
	kanbanCards                    map[string][]domain.KanbanCard
	nodeLogicGateAssignments       map[string]domain.NodeLogicGateAssignment
	RACIMatrixProjectionRows       map[string]memoryRACIMatrixProjectionRow
	projectTimelineItems           map[string]memoryProjectManagementTimelineItem
	projectTimelineProjection      map[string]ProjectManagementTimelineProjectionRow
	entityPermissions              map[string]domain.EntityPermission
	gvicAssignments                map[string]domain.ResourceRACIAssignment
	gvicV2Settings                 map[string]memoryV2PolicySetting
	permissionV2Settings           map[string]memoryV2PolicySetting
	effectiveAccess                map[string]domain.EffectiveResourceAccess
	emailNodeLinks                 map[string]communicationsEmailNodeLink
	nodeEmailThreads               map[string]domain.CommunicationsNodeEmailThread
	projectEmailRelationships      map[string]memoryProjectEmailRelationship
	emailCollaborations            map[string]domain.CommunicationsEmailCollaboration
	emailCollaborationParticipants map[string]domain.CommunicationsEmailCollaborationParticipant
	emailDrafts                    map[string]domain.CommunicationsEmailDraft
	attachments                    map[string]domain.Attachment
	resourceAttachments            map[string]domain.ResourceAttachment
	logicGateShortcuts             map[string]domain.UserLogicGateShortcut
	companyExplorerV2Entities      map[string]memoryCompanyExplorerV2Entity
	companyExplorerV2Edges         map[string]memoryCompanyExplorerV2Edge
	companyExplorerV2Subscriptions map[string]memoryCompanyExplorerV2Subscription

	huddleLogicGateRelationships     map[string]domain.HuddleLogicGateRelationship
	huddleNodeLogicGateRelationships map[string]domain.HuddleNodeLogicGateRelationship
	huddleNodeKPIRelationships       map[string]domain.HuddleNodeKPIRelationship
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
	restoredState := r.snapshotRecycleStateLocked()
	for _, itemID := range itemIDs {
		record, ok := r.recycleBin[key(companyID, itemID)]
		if !ok || record.Item.CompanyID != companyID || record.Item.DeletedByUserID != deletedByUserID {
			continue
		}
		items = append(items, record.Item)
		for _, target := range record.Targets {
			targets = appendCompanyExplorerDeletedTarget(targets, seenTargets, target.Kind, target.ID, target.FolderKind)
		}
		if record.UseDelta {
			mergeMemoryRecycleSnapshot(&restoredState, record.Delta)
		} else {
			restoredState = record.Snapshot
		}
	}
	if len(items) == 0 {
		return RecycleBinRestoreResult{}, ErrNotFound
	}
	r.restoreRecycleSnapshotLocked(restoredState)
	now := time.Now().UTC()
	for _, target := range targets {
		if target.Kind != EntityTypeNode && target.Kind != EntityTypeProject {
			continue
		}
		for draftKey, draft := range r.emailDrafts {
			if draft.CompanyID != companyID || draft.DeletedTimestamp != nil || draft.SharedResourceType != target.Kind || draft.SharedResourceID != target.ID {
				continue
			}
			draft.Revision++
			draft.UpdatedTimestamp = now
			r.emailDrafts[draftKey] = draft
			for linkKey, link := range r.resourceAttachments {
				if link.CompanyID == companyID && link.ResourceType == "email_draft" && link.ResourceID == draft.DraftID && link.DeletedTimestamp == nil {
					link.ResourceRevision = draft.Revision
					r.resourceAttachments[linkKey] = link
				}
			}
		}
	}
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

func (r *MemoryRepo) createRecycleBinItemsLocked(companyID, deletedByUserID string, targets []CompanyExplorerDeletedTarget, snapshot memoryRecycleBinSnapshot) []string {
	now := time.Now().UTC()
	deletedByUserID = strings.TrimSpace(deletedByUserID)
	seen := map[string]bool{}
	itemIDs := make([]string, 0, len(targets))
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
		itemIDs = append(itemIDs, itemID)
	}
	return itemIDs
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
		nodes:                          cloneMap(r.nodes),
		nodeInfo:                       cloneSliceMap(r.nodeInfo),
		nodeText:                       cloneNestedMap(r.nodeText),
		nodeRels:                       cloneSliceMap(r.nodeRels),
		nodeAccountAssignments:         cloneMap(r.nodeAccountAssignments),
		logicGates:                     cloneMap(r.logicGates),
		huddleLogicGates:               cloneMap(r.huddleLogicGates),
		huddleNodes:                    cloneMap(r.huddleNodes),
		kpis:                           cloneMap(r.kpis),
		huddleExplorerFolders:          cloneMap(r.huddleExplorerFolders),
		huddleExplorerItems:            cloneMap(r.huddleExplorerItems),
		logicGateInfo:                  cloneSliceMap(r.logicGateInfo),
		logicGateText:                  cloneNestedMap(r.logicGateText),
		logicGateRels:                  cloneSliceMap(r.logicGateRels),
		logicGateRACI:                  cloneSliceMap(r.logicGateRACI),
		projects:                       cloneMap(r.projects),
		projectAccountAssignments:      cloneMap(r.projectAccountAssignments),
		projectTeamAssignments:         cloneMap(r.projectTeamAssignments),
		entityFieldAssignments:         cloneMap(r.entityFieldAssignments),
		projectInfo:                    cloneSliceMap(r.projectInfo),
		projectText:                    cloneNestedMap(r.projectText),
		projectRelationships:           cloneMap(r.projectRelationships),
		projectRelationshipProjection:  cloneMap(r.projectRelationshipProjection),
		projectCriticalPathSteps:       cloneMap(r.projectCriticalPathSteps),
		sharedInboxRACI:                cloneSliceMap(r.sharedInboxRACI),
		folders:                        cloneMap(r.folders),
		folderItems:                    cloneMap(r.folderItems),
		folderShares:                   cloneMap(r.folderShares),
		kanbanBoards:                   cloneMap(r.kanbanBoards),
		kanbanColumns:                  cloneSliceMap(r.kanbanColumns),
		kanbanCards:                    cloneSliceMap(r.kanbanCards),
		nodeLogicGateAssignments:       cloneMap(r.nodeLogicGateAssignments),
		RACIMatrixProjectionRows:       cloneMap(r.RACIMatrixProjectionRows),
		projectTimelineItems:           cloneMap(r.projectTimelineItems),
		projectTimelineProjection:      cloneMap(r.projectTimelineProjection),
		entityPermissions:              cloneMap(r.entityPermissions),
		gvicAssignments:                cloneMap(r.gvicAssignments),
		gvicV2Settings:                 cloneMap(r.gvicV2Settings),
		permissionV2Settings:           cloneMap(r.permissionV2Settings),
		effectiveAccess:                cloneMap(r.effectiveAccess),
		emailNodeLinks:                 cloneMap(r.emailNodeLinks),
		nodeEmailThreads:               cloneMap(r.nodeEmailThreads),
		projectEmailRelationships:      cloneMap(r.projectEmailRelationships),
		emailCollaborations:            cloneMap(r.emailCollaborations),
		emailCollaborationParticipants: cloneMap(r.emailCollaborationParticipants),
		emailDrafts:                    cloneMap(r.emailDrafts),
		attachments:                    cloneMap(r.attachments),
		resourceAttachments:            cloneMap(r.resourceAttachments),
		logicGateShortcuts:             cloneMap(r.logicGateShortcuts),
		companyExplorerV2Entities:      cloneMap(r.companyExplorerV2Entities),
		companyExplorerV2Edges:         cloneMap(r.companyExplorerV2Edges),
		companyExplorerV2Subscriptions: cloneMap(r.companyExplorerV2Subscriptions),

		huddleLogicGateRelationships:     cloneMap(r.huddleLogicGateRelationships),
		huddleNodeLogicGateRelationships: cloneMap(r.huddleNodeLogicGateRelationships),
		huddleNodeKPIRelationships:       cloneMap(r.huddleNodeKPIRelationships),
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
	r.huddleLogicGateRelationships = cloneMap(snapshot.huddleLogicGateRelationships)
	r.huddleNodeLogicGateRelationships = cloneMap(snapshot.huddleNodeLogicGateRelationships)
	r.huddleNodeKPIRelationships = cloneMap(snapshot.huddleNodeKPIRelationships)
	r.huddleExplorerFolders = cloneMap(snapshot.huddleExplorerFolders)
	r.huddleExplorerItems = cloneMap(snapshot.huddleExplorerItems)
	r.logicGateInfo = cloneSliceMap(snapshot.logicGateInfo)
	r.logicGateText = cloneNestedMap(snapshot.logicGateText)
	r.logicGateRels = cloneSliceMap(snapshot.logicGateRels)
	r.logicGateRACI = cloneSliceMap(snapshot.logicGateRACI)
	r.projects = cloneMap(snapshot.projects)
	r.projectAccountAssignments = cloneMap(snapshot.projectAccountAssignments)
	r.projectTeamAssignments = cloneMap(snapshot.projectTeamAssignments)
	r.entityFieldAssignments = cloneMap(snapshot.entityFieldAssignments)
	r.projectInfo = cloneSliceMap(snapshot.projectInfo)
	r.projectText = cloneNestedMap(snapshot.projectText)
	r.projectRelationships = cloneMap(snapshot.projectRelationships)
	r.projectRelationshipProjection = cloneMap(snapshot.projectRelationshipProjection)
	r.projectCriticalPathSteps = cloneMap(snapshot.projectCriticalPathSteps)
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
	r.nodeEmailThreads = cloneMap(snapshot.nodeEmailThreads)
	r.projectEmailRelationships = cloneMap(snapshot.projectEmailRelationships)
	r.emailCollaborations = cloneMap(snapshot.emailCollaborations)
	r.emailCollaborationParticipants = cloneMap(snapshot.emailCollaborationParticipants)
	r.emailDrafts = cloneMap(snapshot.emailDrafts)
	r.attachments = cloneMap(snapshot.attachments)
	r.resourceAttachments = cloneMap(snapshot.resourceAttachments)
	r.logicGateShortcuts = cloneMap(snapshot.logicGateShortcuts)
	r.companyExplorerV2Entities = cloneMap(snapshot.companyExplorerV2Entities)
	r.companyExplorerV2Edges = cloneMap(snapshot.companyExplorerV2Edges)
	r.companyExplorerV2Subscriptions = cloneMap(snapshot.companyExplorerV2Subscriptions)
}

func memoryRecycleSnapshotDelta(before, after memoryRecycleBinSnapshot) memoryRecycleBinSnapshot {
	return memoryRecycleBinSnapshot{
		nodes:                            recycleMapDelta(before.nodes, after.nodes),
		nodeInfo:                         recycleMapDelta(before.nodeInfo, after.nodeInfo),
		nodeText:                         recycleMapDelta(before.nodeText, after.nodeText),
		nodeRels:                         recycleMapDelta(before.nodeRels, after.nodeRels),
		nodeAccountAssignments:           recycleMapDelta(before.nodeAccountAssignments, after.nodeAccountAssignments),
		logicGates:                       recycleMapDelta(before.logicGates, after.logicGates),
		huddleLogicGates:                 recycleMapDelta(before.huddleLogicGates, after.huddleLogicGates),
		huddleNodes:                      recycleMapDelta(before.huddleNodes, after.huddleNodes),
		kpis:                             recycleMapDelta(before.kpis, after.kpis),
		huddleExplorerFolders:            recycleMapDelta(before.huddleExplorerFolders, after.huddleExplorerFolders),
		huddleExplorerItems:              recycleMapDelta(before.huddleExplorerItems, after.huddleExplorerItems),
		logicGateInfo:                    recycleMapDelta(before.logicGateInfo, after.logicGateInfo),
		logicGateText:                    recycleMapDelta(before.logicGateText, after.logicGateText),
		logicGateRels:                    recycleMapDelta(before.logicGateRels, after.logicGateRels),
		logicGateRACI:                    recycleMapDelta(before.logicGateRACI, after.logicGateRACI),
		projects:                         recycleMapDelta(before.projects, after.projects),
		projectAccountAssignments:        recycleMapDelta(before.projectAccountAssignments, after.projectAccountAssignments),
		projectTeamAssignments:           recycleMapDelta(before.projectTeamAssignments, after.projectTeamAssignments),
		entityFieldAssignments:           recycleMapDelta(before.entityFieldAssignments, after.entityFieldAssignments),
		projectInfo:                      recycleMapDelta(before.projectInfo, after.projectInfo),
		projectText:                      recycleMapDelta(before.projectText, after.projectText),
		projectRelationships:             recycleMapDelta(before.projectRelationships, after.projectRelationships),
		projectRelationshipProjection:    recycleMapDelta(before.projectRelationshipProjection, after.projectRelationshipProjection),
		projectCriticalPathSteps:         recycleMapDelta(before.projectCriticalPathSteps, after.projectCriticalPathSteps),
		sharedInboxRACI:                  recycleMapDelta(before.sharedInboxRACI, after.sharedInboxRACI),
		folders:                          recycleMapDelta(before.folders, after.folders),
		folderItems:                      recycleMapDelta(before.folderItems, after.folderItems),
		folderShares:                     recycleMapDelta(before.folderShares, after.folderShares),
		kanbanBoards:                     recycleMapDelta(before.kanbanBoards, after.kanbanBoards),
		kanbanColumns:                    recycleMapDelta(before.kanbanColumns, after.kanbanColumns),
		kanbanCards:                      recycleMapDelta(before.kanbanCards, after.kanbanCards),
		nodeLogicGateAssignments:         recycleMapDelta(before.nodeLogicGateAssignments, after.nodeLogicGateAssignments),
		RACIMatrixProjectionRows:         recycleMapDelta(before.RACIMatrixProjectionRows, after.RACIMatrixProjectionRows),
		projectTimelineItems:             recycleMapDelta(before.projectTimelineItems, after.projectTimelineItems),
		projectTimelineProjection:        recycleMapDelta(before.projectTimelineProjection, after.projectTimelineProjection),
		entityPermissions:                recycleMapDelta(before.entityPermissions, after.entityPermissions),
		gvicAssignments:                  recycleMapDelta(before.gvicAssignments, after.gvicAssignments),
		gvicV2Settings:                   recycleMapDelta(before.gvicV2Settings, after.gvicV2Settings),
		permissionV2Settings:             recycleMapDelta(before.permissionV2Settings, after.permissionV2Settings),
		effectiveAccess:                  recycleMapDelta(before.effectiveAccess, after.effectiveAccess),
		emailNodeLinks:                   recycleMapDelta(before.emailNodeLinks, after.emailNodeLinks),
		nodeEmailThreads:                 recycleMapDelta(before.nodeEmailThreads, after.nodeEmailThreads),
		projectEmailRelationships:        recycleMapDelta(before.projectEmailRelationships, after.projectEmailRelationships),
		emailCollaborations:              recycleMapDelta(before.emailCollaborations, after.emailCollaborations),
		emailCollaborationParticipants:   recycleMapDelta(before.emailCollaborationParticipants, after.emailCollaborationParticipants),
		emailDrafts:                      recycleMapDelta(before.emailDrafts, after.emailDrafts),
		attachments:                      recycleMapDelta(before.attachments, after.attachments),
		resourceAttachments:              recycleMapDelta(before.resourceAttachments, after.resourceAttachments),
		logicGateShortcuts:               recycleMapDelta(before.logicGateShortcuts, after.logicGateShortcuts),
		companyExplorerV2Entities:        recycleMapDelta(before.companyExplorerV2Entities, after.companyExplorerV2Entities),
		companyExplorerV2Edges:           recycleMapDelta(before.companyExplorerV2Edges, after.companyExplorerV2Edges),
		companyExplorerV2Subscriptions:   recycleMapDelta(before.companyExplorerV2Subscriptions, after.companyExplorerV2Subscriptions),
		huddleLogicGateRelationships:     recycleMapDelta(before.huddleLogicGateRelationships, after.huddleLogicGateRelationships),
		huddleNodeLogicGateRelationships: recycleMapDelta(before.huddleNodeLogicGateRelationships, after.huddleNodeLogicGateRelationships),
		huddleNodeKPIRelationships:       recycleMapDelta(before.huddleNodeKPIRelationships, after.huddleNodeKPIRelationships),
	}
}

func mergeMemoryRecycleSnapshot(destination *memoryRecycleBinSnapshot, delta memoryRecycleBinSnapshot) {
	mergeRecycleMap(destination.nodes, delta.nodes)
	mergeRecycleMap(destination.nodeInfo, delta.nodeInfo)
	mergeRecycleMap(destination.nodeText, delta.nodeText)
	mergeRecycleMap(destination.nodeRels, delta.nodeRels)
	mergeRecycleMap(destination.nodeAccountAssignments, delta.nodeAccountAssignments)
	mergeRecycleMap(destination.logicGates, delta.logicGates)
	mergeRecycleMap(destination.huddleLogicGates, delta.huddleLogicGates)
	mergeRecycleMap(destination.huddleNodes, delta.huddleNodes)
	mergeRecycleMap(destination.kpis, delta.kpis)
	mergeRecycleMap(destination.huddleExplorerFolders, delta.huddleExplorerFolders)
	mergeRecycleMap(destination.huddleExplorerItems, delta.huddleExplorerItems)
	mergeRecycleMap(destination.logicGateInfo, delta.logicGateInfo)
	mergeRecycleMap(destination.logicGateText, delta.logicGateText)
	mergeRecycleMap(destination.logicGateRels, delta.logicGateRels)
	mergeRecycleMap(destination.logicGateRACI, delta.logicGateRACI)
	mergeRecycleMap(destination.projects, delta.projects)
	mergeRecycleMap(destination.projectAccountAssignments, delta.projectAccountAssignments)
	mergeRecycleMap(destination.projectTeamAssignments, delta.projectTeamAssignments)
	mergeRecycleMap(destination.entityFieldAssignments, delta.entityFieldAssignments)
	mergeRecycleMap(destination.projectInfo, delta.projectInfo)
	mergeRecycleMap(destination.projectText, delta.projectText)
	mergeRecycleMap(destination.projectRelationships, delta.projectRelationships)
	mergeRecycleMap(destination.projectRelationshipProjection, delta.projectRelationshipProjection)
	mergeRecycleMap(destination.projectCriticalPathSteps, delta.projectCriticalPathSteps)
	mergeRecycleMap(destination.sharedInboxRACI, delta.sharedInboxRACI)
	mergeRecycleMap(destination.folders, delta.folders)
	mergeRecycleMap(destination.folderItems, delta.folderItems)
	mergeRecycleMap(destination.folderShares, delta.folderShares)
	mergeRecycleMap(destination.kanbanBoards, delta.kanbanBoards)
	mergeRecycleMap(destination.kanbanColumns, delta.kanbanColumns)
	mergeRecycleMap(destination.kanbanCards, delta.kanbanCards)
	mergeRecycleMap(destination.nodeLogicGateAssignments, delta.nodeLogicGateAssignments)
	mergeRecycleMap(destination.RACIMatrixProjectionRows, delta.RACIMatrixProjectionRows)
	mergeRecycleMap(destination.projectTimelineItems, delta.projectTimelineItems)
	mergeRecycleMap(destination.projectTimelineProjection, delta.projectTimelineProjection)
	mergeRecycleMap(destination.entityPermissions, delta.entityPermissions)
	mergeRecycleMap(destination.gvicAssignments, delta.gvicAssignments)
	mergeRecycleMap(destination.gvicV2Settings, delta.gvicV2Settings)
	mergeRecycleMap(destination.permissionV2Settings, delta.permissionV2Settings)
	mergeRecycleMap(destination.effectiveAccess, delta.effectiveAccess)
	mergeRecycleMap(destination.emailNodeLinks, delta.emailNodeLinks)
	mergeRecycleMap(destination.nodeEmailThreads, delta.nodeEmailThreads)
	mergeRecycleMap(destination.projectEmailRelationships, delta.projectEmailRelationships)
	mergeRecycleMap(destination.emailCollaborations, delta.emailCollaborations)
	mergeRecycleMap(destination.emailCollaborationParticipants, delta.emailCollaborationParticipants)
	mergeRecycleMap(destination.emailDrafts, delta.emailDrafts)
	mergeRecycleMap(destination.attachments, delta.attachments)
	mergeRecycleMap(destination.resourceAttachments, delta.resourceAttachments)
	mergeRecycleMap(destination.logicGateShortcuts, delta.logicGateShortcuts)
	mergeRecycleMap(destination.companyExplorerV2Entities, delta.companyExplorerV2Entities)
	mergeRecycleMap(destination.companyExplorerV2Edges, delta.companyExplorerV2Edges)
	mergeRecycleMap(destination.companyExplorerV2Subscriptions, delta.companyExplorerV2Subscriptions)
	mergeRecycleMap(destination.huddleLogicGateRelationships, delta.huddleLogicGateRelationships)
	mergeRecycleMap(destination.huddleNodeLogicGateRelationships, delta.huddleNodeLogicGateRelationships)
	mergeRecycleMap(destination.huddleNodeKPIRelationships, delta.huddleNodeKPIRelationships)
}

func recycleMapDelta[V any](before, after map[string]V) map[string]V {
	delta := map[string]V{}
	for entryKey, beforeValue := range before {
		afterValue, exists := after[entryKey]
		if !exists || !reflect.DeepEqual(beforeValue, afterValue) {
			delta[entryKey] = beforeValue
		}
	}
	return delta
}

func mergeRecycleMap[V any](destination, delta map[string]V) {
	for entryKey, value := range delta {
		destination[entryKey] = value
	}
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
