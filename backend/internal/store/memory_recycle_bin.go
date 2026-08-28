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

type memoryProcessMapCleanupChild struct {
	CompanyID                 string
	ResourceType              string
	ResourceID                string
	PlacementIncarnationToken string
	OriginalParentFolderID    string
	CleanupParentFolderID     *string
	CleanupRevision           int64
	CreatedTimestamp          time.Time
	GridX                     int
	GridY                     int
	GridWidth                 int
	GridHeight                int
}

type memoryRecycleBinSnapshot struct {
	nodes                            map[string]domain.Node
	nodeInfo                         map[string][]domain.NodeInformation
	nodeText                         map[string]map[string]domain.NodeProjection
	nodeRels                         map[string][]domain.NodeRelationship
	nodeAccountAssignments           map[string]domain.NodeAccountAssignment
	logicGates                       map[string]domain.LogicGate
	qdRatings                        map[string]domain.QDRating
	huddleLogicGates                 map[string]domain.HuddleLogicGate
	huddleNodes                      map[string]domain.HuddleNode
	huddleNodeTextboxes              map[string]map[string]HuddleNodeTextbox
	huddleNodeTextboxChats           map[string]map[string]HuddleNodeTextboxChat
	kpis                             map[string]domain.KPI
	huddleExplorerFolders            map[string]domain.HuddleExplorerFolder
	huddleExplorerItems              map[string]domain.HuddleExplorerItem
	logicGateInfo                    map[string][]domain.LogicGateInformation
	logicGateText                    map[string]map[string]domain.LogicGateProjection
	logicGateRACI                    map[string][]domain.LogicGateRACIAssignment
	projects                         map[string]domain.Project
	projectAccountAssignments        map[string]bool
	projectTeamAssignments           map[string]bool
	projectInfo                      map[string][]domain.ProjectInformation
	projectText                      map[string]map[string]domain.ProjectProjection
	projectRelationships             map[string]domain.ProjectRelationship
	projectRelationshipProjection    map[string]domain.ProjectRelationshipProjection
	projectCriticalPathSteps         map[string]domain.ProjectCriticalPathStep
	sharedInboxRACI                  map[string][]domain.SharedInboxRACIAssignment
	folders                          map[string]domain.CompanyExplorerFolder
	folderItems                      map[string]domain.CompanyExplorerFolderItem
	folderShares                     map[string]domain.CompanyExplorerFolderShare
	resourceOperationalRelationships map[string]domain.ResourceOperationalRelationship
	processMapPlacements             map[string]domain.ProcessMapPlacement
	processMapTraces                 map[string]domain.ProcessMapTrace
	processMapCleanupChildren        map[string]memoryProcessMapCleanupChild
	kanbanBoards                     map[string]domain.KanbanBoard
	kanbanColumns                    map[string][]domain.KanbanColumn
	kanbanCards                      map[string][]domain.KanbanCard
	nodeLogicGateAssignments         map[string]domain.NodeLogicGateAssignment
	RACIMatrixProjectionRows         map[string]memoryRACIMatrixProjectionRow
	projectTimelineItems             map[string]memoryProjectManagementTimelineItem
	projectTimelineProjection        map[string]ProjectManagementTimelineProjectionRow
	entityPermissions                map[string]domain.EntityPermission
	gvicAssignments                  map[string]domain.ResourceRACIAssignment
	gvicV2Settings                   map[string]memoryV2PolicySetting
	permissionV2Settings             map[string]memoryV2PolicySetting
	effectiveAccess                  map[string]domain.EffectiveResourceAccess
	editorJSONDocuments              map[string]memoryEditorJSONDocument
	editorJSONOperations             map[string][]memoryEditorJSONOperation
	emailNodeLinks                   map[string]communicationsEmailNodeLink
	nodeEmailThreads                 map[string]domain.CommunicationsNodeEmailThread
	projectEmailRelationships        map[string]memoryProjectEmailRelationship
	emailCollaborations              map[string]domain.CommunicationsEmailCollaboration
	emailCollaborationParticipants   map[string]domain.CommunicationsEmailCollaborationParticipant
	emailDrafts                      map[string]domain.CommunicationsEmailDraft
	attachments                      map[string]domain.Attachment
	resourceAttachments              map[string]domain.ResourceAttachment
	logicGateShortcuts               map[string]domain.UserLogicGateShortcut
	companyExplorerV2Entities        map[string]memoryCompanyExplorerV2Entity
	companyExplorerV2Edges           map[string]memoryCompanyExplorerV2Edge
	companyExplorerV2Subscriptions   map[string]memoryCompanyExplorerV2Subscription

	huddleLogicGateRelationships     map[string]domain.HuddleLogicGateRelationship
	huddleNodeLogicGateRelationships map[string]domain.HuddleNodeLogicGateRelationship
	huddleNodeKPIRelationships       map[string]domain.HuddleNodeKPIRelationship
	entityRelationships              map[string]domain.EntityRelationship
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

func (r *MemoryRepo) createRecycleBinItemsLocked(companyID, deletedByUserID string, roots []companyExplorerRecycleRootScope, snapshot, deletedSnapshot memoryRecycleBinSnapshot) error {
	now := time.Now().UTC()
	deletedByUserID = strings.TrimSpace(deletedByUserID)
	seen := map[string]bool{}
	for _, root := range roots {
		target := root.Target
		if target.Kind == "kanban" {
			continue
		}
		recycleKey := target.Kind + ":" + target.ID
		if seen[recycleKey] {
			continue
		}
		seen[recycleKey] = true
		delta, err := memoryRecycleSnapshotForDeleteScope(companyID, deletedSnapshot, root.Scope)
		if err != nil {
			return err
		}
		itemID := newUUIDv7String()
		folderKind := ""
		if target.Kind == "folder" {
			folderKind = root.Scope.FolderKinds[target.ID]
		}
		deletedTarget := CompanyExplorerDeletedTarget{Kind: target.Kind, ID: target.ID, FolderKind: folderKind}
		item := domain.RecycleBinItem{
			CompanyID:        companyID,
			RecycleBinItemID: itemID,
			ObjectKind:       target.Kind,
			ObjectID:         target.ID,
			ObjectLabel:      recycleTargetLabelFromMemorySnapshot(companyID, deletedTarget, snapshot),
			ObjectFolderKind: folderKind,
			ContainedItems:   recycleContainedItemsFromMemorySnapshot(domain.RecycleBinItem{CompanyID: companyID, ObjectKind: target.Kind, ObjectID: target.ID}, snapshot),
			DeletedByUserID:  deletedByUserID,
			DeletedTimestamp: now,
		}
		if strings.TrimSpace(item.ObjectLabel) == "" {
			item.ObjectLabel = target.ID
		}
		r.recycleBin[key(companyID, itemID)] = memoryRecycleBinItem{
			Item:     item,
			Targets:  []CompanyExplorerDeletedTarget{deletedTarget},
			Snapshot: delta,
			Delta:    delta,
			UseDelta: true,
		}
	}
	return nil
}

func memoryRecycleSnapshotForDeleteScope(companyID string, snapshot memoryRecycleBinSnapshot, scope companyExplorerRecycleScope) (memoryRecycleBinSnapshot, error) {
	repo := NewMemoryRepo()
	repo.restoreRecycleSnapshotLocked(snapshot)
	if err := repo.deleteCompanyExplorerRecycleScopeLocked(companyID, scope); err != nil {
		return memoryRecycleBinSnapshot{}, err
	}
	delta := memoryRecycleSnapshotDelta(snapshot, repo.snapshotRecycleStateLocked())
	delta.processMapCleanupChildren = map[string]memoryProcessMapCleanupChild{}
	for placementKey, cleanup := range snapshot.processMapCleanupChildren {
		if cleanup.CompanyID == companyID && scope.FolderIDs[cleanup.OriginalParentFolderID] {
			delta.processMapCleanupChildren[placementKey] = cleanup
		}
	}
	return delta, nil
}

func memoryRecycleSnapshotWithProcessMapTraceContext(before, after, deleted memoryRecycleBinSnapshot) memoryRecycleBinSnapshot {
	deleted.resourceOperationalRelationships = cloneMap(deleted.resourceOperationalRelationships)
	for traceKey, trace := range deleted.processMapTraces {
		relationship, ok := before.resourceOperationalRelationships[traceKey]
		if !ok {
			relationship, ok = before.resourceOperationalRelationships[key(trace.CompanyID, trace.ResourceOperationalRelationshipID)]
		}
		if ok {
			deleted.resourceOperationalRelationships[key(relationship.CompanyID, relationship.ResourceOperationalRelationshipID)] = relationship
		}
	}
	deleted.processMapCleanupChildren = map[string]memoryProcessMapCleanupChild{}
	for placementKey, beforePlacement := range before.processMapPlacements {
		afterPlacement, survives := after.processMapPlacements[placementKey]
		if !survives || beforePlacement.MapParentFolderID == nil {
			continue
		}
		originalParentID := strings.TrimSpace(*beforePlacement.MapParentFolderID)
		if _, deletedParent := deleted.folders[key(beforePlacement.CompanyID, originalParentID)]; !deletedParent {
			continue
		}
		deleted.processMapCleanupChildren[placementKey] = memoryProcessMapCleanupChild{
			CompanyID: beforePlacement.CompanyID, ResourceType: beforePlacement.ResourceType, ResourceID: beforePlacement.ResourceID,
			PlacementIncarnationToken: afterPlacement.PlacementIncarnationToken,
			OriginalParentFolderID:    originalParentID, CleanupParentFolderID: cloneProcessMapPlacement(afterPlacement).MapParentFolderID,
			CleanupRevision: afterPlacement.Revision, CreatedTimestamp: afterPlacement.CreatedTimestamp,
			GridX: afterPlacement.GridX, GridY: afterPlacement.GridY,
			GridWidth: afterPlacement.GridWidth, GridHeight: afterPlacement.GridHeight,
		}
	}
	return deleted
}

func (r *MemoryRepo) deleteCompanyExplorerRecycleScopeLocked(companyID string, scope companyExplorerRecycleScope) error {
	for logicGateID := range scope.LogicGateIDs {
		if err := r.deleteLogicGateLocked(companyID, logicGateID); err != nil {
			return err
		}
	}
	for boardID := range scope.KanbanBoardIDs {
		if _, exists := r.kanbanBoards[boardKey(companyID, boardID)]; !exists {
			continue
		}
		if err := r.deleteKanbanBoardLocked(companyID, boardID); err != nil {
			return err
		}
	}
	for projectID := range scope.ProjectIDs {
		if err := r.deleteProjectLocked(companyID, projectID); err != nil {
			return err
		}
	}
	for nodeID := range scope.NodeIDs {
		if err := r.deleteNodeLocked(companyID, nodeID); err != nil {
			return err
		}
	}
	for logicGateID := range scope.LogicGateIDs {
		r.deleteCompanyExplorerV2NativeEntityProjectionLocked(companyID, CompanyExplorerV2EntityLogicGate, logicGateID)
	}
	for projectID := range scope.ProjectIDs {
		r.deleteCompanyExplorerV2NativeEntityProjectionLocked(companyID, CompanyExplorerV2EntityProject, projectID)
	}
	for nodeID := range scope.NodeIDs {
		r.deleteCompanyExplorerV2NativeEntityProjectionLocked(companyID, CompanyExplorerV2EntityNode, nodeID)
	}
	for _, folderID := range r.processMapFolderCleanupOrderLocked(companyID, scope.FolderIDs) {
		r.deleteCompanyExplorerV2EntityProjectionLocked(companyID, folderID)
		r.deleteProcessMapResourceLocked(companyID, domain.ProcessMapResourceTypeFolder, folderID)
		delete(r.folders, key(companyID, folderID))
		delete(r.sharedInboxRACI, sharedInboxRACIKey(companyID, folderID))
	}
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID &&
			(permission.EntityType == EntityTypeSharedInboxFolder || permission.EntityType == EntityTypeSharedInbox || permission.EntityType == EntityTypeCompanyExplorerFolder) &&
			scope.FolderIDs[permission.EntityID] {
			delete(r.entityPermissions, permissionKey)
		}
	}
	for itemKey, item := range r.folderItems {
		if item.CompanyID == companyID && scope.FolderIDs[item.FolderID] {
			delete(r.folderItems, itemKey)
		}
	}
	for shareKey, share := range r.folderShares {
		if share.CompanyID == companyID && scope.FolderIDs[share.FolderID] {
			delete(r.folderShares, shareKey)
		}
	}
	return nil
}

func recycleTargetLabelFromMemorySnapshot(companyID string, target CompanyExplorerDeletedTarget, snapshot memoryRecycleBinSnapshot) string {
	switch target.Kind {
	case "folder":
		return snapshot.folders[key(companyID, target.ID)].Name
	case "node":
		return snapshot.nodes[key(companyID, target.ID)].Title
	case "logic_gate":
		return snapshot.logicGates[key(companyID, target.ID)].Header
	case "project":
		return snapshot.projects[key(companyID, target.ID)].Name
	case "kanban":
		return "Kanban board"
	default:
		return ""
	}
}

func (r *MemoryRepo) snapshotRecycleStateLocked() memoryRecycleBinSnapshot {
	return memoryRecycleBinSnapshot{
		nodes:                            cloneMap(r.nodes),
		nodeInfo:                         cloneSliceMap(r.nodeInfo),
		nodeText:                         cloneNestedMap(r.nodeText),
		nodeRels:                         cloneSliceMap(r.nodeRels),
		nodeAccountAssignments:           cloneMap(r.nodeAccountAssignments),
		logicGates:                       cloneMap(r.logicGates),
		qdRatings:                        cloneMap(r.qdRatings),
		huddleLogicGates:                 cloneMap(r.huddleLogicGates),
		huddleNodes:                      cloneMap(r.huddleNodes),
		huddleNodeTextboxes:              cloneNestedMap(r.huddleNodeTextboxes),
		huddleNodeTextboxChats:           cloneNestedMap(r.huddleNodeTextboxChats),
		kpis:                             cloneMap(r.kpis),
		huddleExplorerFolders:            cloneMap(r.huddleExplorerFolders),
		huddleExplorerItems:              cloneMap(r.huddleExplorerItems),
		logicGateInfo:                    cloneSliceMap(r.logicGateInfo),
		logicGateText:                    cloneNestedMap(r.logicGateText),
		logicGateRACI:                    cloneSliceMap(r.logicGateRACI),
		projects:                         cloneMap(r.projects),
		projectAccountAssignments:        cloneMap(r.projectAccountAssignments),
		projectTeamAssignments:           cloneMap(r.projectTeamAssignments),
		projectInfo:                      cloneSliceMap(r.projectInfo),
		projectText:                      cloneNestedMap(r.projectText),
		projectRelationships:             cloneMap(r.projectRelationships),
		projectRelationshipProjection:    cloneMap(r.projectRelationshipProjection),
		projectCriticalPathSteps:         cloneMap(r.projectCriticalPathSteps),
		sharedInboxRACI:                  cloneSliceMap(r.sharedInboxRACI),
		folders:                          cloneMap(r.folders),
		folderItems:                      cloneMap(r.folderItems),
		folderShares:                     cloneMap(r.folderShares),
		resourceOperationalRelationships: cloneMap(r.resourceOperationalRelationships),
		processMapPlacements:             cloneMap(r.processMapPlacements),
		processMapTraces:                 cloneMap(r.processMapTraces),
		processMapCleanupChildren:        map[string]memoryProcessMapCleanupChild{},
		kanbanBoards:                     cloneMap(r.kanbanBoards),
		kanbanColumns:                    cloneSliceMap(r.kanbanColumns),
		kanbanCards:                      cloneSliceMap(r.kanbanCards),
		nodeLogicGateAssignments:         cloneMap(r.nodeLogicGateAssignments),
		RACIMatrixProjectionRows:         cloneMap(r.RACIMatrixProjectionRows),
		projectTimelineItems:             cloneMap(r.projectTimelineItems),
		projectTimelineProjection:        cloneMap(r.projectTimelineProjection),
		entityPermissions:                cloneMap(r.entityPermissions),
		gvicAssignments:                  cloneMap(r.gvicAssignments),
		gvicV2Settings:                   cloneMap(r.gvicV2Settings),
		permissionV2Settings:             cloneMap(r.permissionV2Settings),
		effectiveAccess:                  cloneMap(r.effectiveAccess),
		editorJSONDocuments:              cloneMap(r.editorJSONDocuments),
		editorJSONOperations:             cloneSliceMap(r.editorJSONOperations),
		emailNodeLinks:                   cloneMap(r.emailNodeLinks),
		nodeEmailThreads:                 cloneMap(r.nodeEmailThreads),
		projectEmailRelationships:        cloneMap(r.projectEmailRelationships),
		emailCollaborations:              cloneMap(r.emailCollaborations),
		emailCollaborationParticipants:   cloneMap(r.emailCollaborationParticipants),
		emailDrafts:                      cloneMap(r.emailDrafts),
		attachments:                      cloneMap(r.attachments),
		resourceAttachments:              cloneMap(r.resourceAttachments),
		logicGateShortcuts:               cloneMap(r.logicGateShortcuts),
		companyExplorerV2Entities:        cloneMap(r.companyExplorerV2Entities),
		companyExplorerV2Edges:           cloneMap(r.companyExplorerV2Edges),
		companyExplorerV2Subscriptions:   cloneMap(r.companyExplorerV2Subscriptions),

		huddleLogicGateRelationships:     cloneMap(r.huddleLogicGateRelationships),
		huddleNodeLogicGateRelationships: cloneMap(r.huddleNodeLogicGateRelationships),
		huddleNodeKPIRelationships:       cloneMap(r.huddleNodeKPIRelationships),
		entityRelationships:              cloneMap(r.entityRelationships),
	}
}

func (r *MemoryRepo) restoreRecycleSnapshotLocked(snapshot memoryRecycleBinSnapshot) {
	r.nodes = cloneMap(snapshot.nodes)
	r.nodeInfo = cloneSliceMap(snapshot.nodeInfo)
	r.nodeText = cloneNestedMap(snapshot.nodeText)
	r.nodeRels = cloneSliceMap(snapshot.nodeRels)
	r.nodeAccountAssignments = cloneMap(snapshot.nodeAccountAssignments)
	r.logicGates = cloneMap(snapshot.logicGates)
	r.qdRatings = cloneMap(snapshot.qdRatings)
	r.huddleLogicGates = cloneMap(snapshot.huddleLogicGates)
	r.huddleNodes = cloneMap(snapshot.huddleNodes)
	r.huddleNodeTextboxes = cloneNestedMap(snapshot.huddleNodeTextboxes)
	r.huddleNodeTextboxChats = cloneNestedMap(snapshot.huddleNodeTextboxChats)
	r.kpis = cloneMap(snapshot.kpis)
	r.huddleLogicGateRelationships = cloneMap(snapshot.huddleLogicGateRelationships)
	r.huddleNodeLogicGateRelationships = cloneMap(snapshot.huddleNodeLogicGateRelationships)
	r.huddleNodeKPIRelationships = cloneMap(snapshot.huddleNodeKPIRelationships)
	r.entityRelationships = cloneMap(snapshot.entityRelationships)
	r.huddleExplorerFolders = cloneMap(snapshot.huddleExplorerFolders)
	r.huddleExplorerItems = cloneMap(snapshot.huddleExplorerItems)
	r.logicGateInfo = cloneSliceMap(snapshot.logicGateInfo)
	r.logicGateText = cloneNestedMap(snapshot.logicGateText)
	r.logicGateRACI = cloneSliceMap(snapshot.logicGateRACI)
	r.projects = cloneMap(snapshot.projects)
	r.projectAccountAssignments = cloneMap(snapshot.projectAccountAssignments)
	r.projectTeamAssignments = cloneMap(snapshot.projectTeamAssignments)
	r.projectInfo = cloneSliceMap(snapshot.projectInfo)
	r.projectText = cloneNestedMap(snapshot.projectText)
	r.projectRelationships = cloneMap(snapshot.projectRelationships)
	r.projectRelationshipProjection = cloneMap(snapshot.projectRelationshipProjection)
	r.projectCriticalPathSteps = cloneMap(snapshot.projectCriticalPathSteps)
	r.sharedInboxRACI = cloneSliceMap(snapshot.sharedInboxRACI)
	r.folders = cloneMap(snapshot.folders)
	r.folderItems = cloneMap(snapshot.folderItems)
	r.folderShares = cloneMap(snapshot.folderShares)
	r.resourceOperationalRelationships = cloneMap(snapshot.resourceOperationalRelationships)
	r.processMapPlacements = cloneMap(snapshot.processMapPlacements)
	r.processMapTraces = cloneMap(snapshot.processMapTraces)
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
	r.editorJSONDocuments = cloneMap(snapshot.editorJSONDocuments)
	r.editorJSONOperations = cloneSliceMap(snapshot.editorJSONOperations)
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
		qdRatings:                        recycleMapDelta(before.qdRatings, after.qdRatings),
		huddleLogicGates:                 recycleMapDelta(before.huddleLogicGates, after.huddleLogicGates),
		huddleNodes:                      recycleMapDelta(before.huddleNodes, after.huddleNodes),
		huddleNodeTextboxes:              recycleMapDelta(before.huddleNodeTextboxes, after.huddleNodeTextboxes),
		huddleNodeTextboxChats:           recycleMapDelta(before.huddleNodeTextboxChats, after.huddleNodeTextboxChats),
		kpis:                             recycleMapDelta(before.kpis, after.kpis),
		huddleExplorerFolders:            recycleMapDelta(before.huddleExplorerFolders, after.huddleExplorerFolders),
		huddleExplorerItems:              recycleMapDelta(before.huddleExplorerItems, after.huddleExplorerItems),
		logicGateInfo:                    recycleMapDelta(before.logicGateInfo, after.logicGateInfo),
		logicGateText:                    recycleMapDelta(before.logicGateText, after.logicGateText),
		logicGateRACI:                    recycleMapDelta(before.logicGateRACI, after.logicGateRACI),
		projects:                         recycleMapDelta(before.projects, after.projects),
		projectAccountAssignments:        recycleMapDelta(before.projectAccountAssignments, after.projectAccountAssignments),
		projectTeamAssignments:           recycleMapDelta(before.projectTeamAssignments, after.projectTeamAssignments),
		projectInfo:                      recycleMapDelta(before.projectInfo, after.projectInfo),
		projectText:                      recycleMapDelta(before.projectText, after.projectText),
		projectRelationships:             recycleMapDelta(before.projectRelationships, after.projectRelationships),
		projectRelationshipProjection:    recycleMapDelta(before.projectRelationshipProjection, after.projectRelationshipProjection),
		projectCriticalPathSteps:         recycleMapDelta(before.projectCriticalPathSteps, after.projectCriticalPathSteps),
		sharedInboxRACI:                  recycleMapDelta(before.sharedInboxRACI, after.sharedInboxRACI),
		folders:                          recycleMapDelta(before.folders, after.folders),
		folderItems:                      recycleMapDelta(before.folderItems, after.folderItems),
		folderShares:                     recycleMapDelta(before.folderShares, after.folderShares),
		resourceOperationalRelationships: recycleMapDelta(before.resourceOperationalRelationships, after.resourceOperationalRelationships),
		processMapPlacements:             recycleMapDelta(before.processMapPlacements, after.processMapPlacements),
		processMapTraces:                 recycleMapDelta(before.processMapTraces, after.processMapTraces),
		processMapCleanupChildren:        recycleMapDelta(before.processMapCleanupChildren, after.processMapCleanupChildren),
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
		editorJSONDocuments:              recycleMapDelta(before.editorJSONDocuments, after.editorJSONDocuments),
		editorJSONOperations:             recycleMapDelta(before.editorJSONOperations, after.editorJSONOperations),
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
		entityRelationships:              recycleMapDelta(before.entityRelationships, after.entityRelationships),
	}
}

func mergeMemoryRecycleSnapshot(destination *memoryRecycleBinSnapshot, delta memoryRecycleBinSnapshot) {
	mergeRecycleMap(destination.nodes, delta.nodes)
	mergeRecycleMap(destination.nodeInfo, delta.nodeInfo)
	mergeRecycleMap(destination.nodeText, delta.nodeText)
	mergeRecycleMap(destination.nodeRels, delta.nodeRels)
	mergeRecycleMap(destination.nodeAccountAssignments, delta.nodeAccountAssignments)
	mergeRecycleMap(destination.logicGates, delta.logicGates)
	mergeRecycleMap(destination.qdRatings, delta.qdRatings)
	mergeRecycleMap(destination.huddleLogicGates, delta.huddleLogicGates)
	mergeRecycleMap(destination.huddleNodes, delta.huddleNodes)
	mergeRecycleMap(destination.huddleNodeTextboxes, delta.huddleNodeTextboxes)
	mergeRecycleMap(destination.huddleNodeTextboxChats, delta.huddleNodeTextboxChats)
	mergeRecycleMap(destination.kpis, delta.kpis)
	mergeRecycleMap(destination.huddleExplorerFolders, delta.huddleExplorerFolders)
	mergeRecycleMap(destination.huddleExplorerItems, delta.huddleExplorerItems)
	mergeRecycleMap(destination.logicGateInfo, delta.logicGateInfo)
	mergeRecycleMap(destination.logicGateText, delta.logicGateText)
	mergeRecycleMap(destination.logicGateRACI, delta.logicGateRACI)
	mergeRecycleMap(destination.projects, delta.projects)
	mergeRecycleMap(destination.projectAccountAssignments, delta.projectAccountAssignments)
	mergeRecycleMap(destination.projectTeamAssignments, delta.projectTeamAssignments)
	mergeRecycleMap(destination.projectInfo, delta.projectInfo)
	mergeRecycleMap(destination.projectText, delta.projectText)
	mergeRecycleMap(destination.projectRelationships, delta.projectRelationships)
	mergeRecycleMap(destination.projectRelationshipProjection, delta.projectRelationshipProjection)
	mergeRecycleMap(destination.projectCriticalPathSteps, delta.projectCriticalPathSteps)
	mergeRecycleMap(destination.sharedInboxRACI, delta.sharedInboxRACI)
	mergeRecycleMap(destination.folders, delta.folders)
	mergeRecycleMap(destination.folderItems, delta.folderItems)
	mergeRecycleMap(destination.folderShares, delta.folderShares)
	for relationshipKey, relationship := range delta.resourceOperationalRelationships {
		if _, exists := destination.resourceOperationalRelationships[relationshipKey]; exists {
			continue
		}
		if memoryRecycleProcessMapResourceExists(*destination, relationship.CompanyID, relationship.Source) &&
			memoryRecycleProcessMapResourceExists(*destination, relationship.CompanyID, relationship.Target) {
			destination.resourceOperationalRelationships[relationshipKey] = relationship
		}
	}
	pendingPlacements := cloneMap(delta.processMapPlacements)
	for len(pendingPlacements) > 0 {
		progress := false
		placementKeys := make([]string, 0, len(pendingPlacements))
		for placementKey := range pendingPlacements {
			placementKeys = append(placementKeys, placementKey)
		}
		sort.Strings(placementKeys)
		for _, placementKey := range placementKeys {
			placement := pendingPlacements[placementKey]
			if _, exists := destination.processMapPlacements[placementKey]; exists {
				delete(pendingPlacements, placementKey)
				progress = true
				continue
			}
			if !memoryRecycleProcessMapResourceExists(*destination, placement.CompanyID, domain.ProcessMapResourceRef{
				ResourceType: placement.ResourceType,
				ResourceID:   placement.ResourceID,
			}) {
				delete(pendingPlacements, placementKey)
				progress = true
				continue
			}
			if placement.MapParentFolderID != nil {
				parentID := strings.TrimSpace(*placement.MapParentFolderID)
				if _, ok := destination.processMapPlacements[processMapPlacementMemoryKey(placement.CompanyID, domain.ProcessMapResourceTypeFolder, parentID)]; !ok {
					continue
				}
			}
			placement.PlacementIncarnationToken = newUUIDv7String()
			destination.processMapPlacements[placementKey] = placement
			delete(pendingPlacements, placementKey)
			progress = true
		}
		if !progress {
			break
		}
	}
	for traceKey, trace := range delta.processMapTraces {
		if _, exists := destination.processMapTraces[traceKey]; exists {
			continue
		}
		if _, ok := destination.resourceOperationalRelationships[key(trace.CompanyID, trace.ResourceOperationalRelationshipID)]; ok {
			destination.processMapTraces[traceKey] = trace
		}
	}
	for placementKey, cleanup := range delta.processMapCleanupChildren {
		placement, exists := destination.processMapPlacements[placementKey]
		if !exists || placement.CompanyID != cleanup.CompanyID || placement.ResourceType != cleanup.ResourceType || placement.ResourceID != cleanup.ResourceID ||
			placement.PlacementIncarnationToken != cleanup.PlacementIncarnationToken ||
			placement.Revision != cleanup.CleanupRevision || !placement.CreatedTimestamp.Equal(cleanup.CreatedTimestamp) ||
			placement.GridX != cleanup.GridX || placement.GridY != cleanup.GridY ||
			placement.GridWidth != cleanup.GridWidth || placement.GridHeight != cleanup.GridHeight ||
			!processMapParentIDsEqual(placement.MapParentFolderID, cleanup.CleanupParentFolderID) {
			continue
		}
		if _, restoredParent := destination.processMapPlacements[processMapPlacementMemoryKey(cleanup.CompanyID, domain.ProcessMapResourceTypeFolder, cleanup.OriginalParentFolderID)]; !restoredParent {
			continue
		}
		parentID := cleanup.OriginalParentFolderID
		placement.MapParentFolderID = &parentID
		placement.Revision++
		placement.UpdatedTimestamp = time.Now().UTC()
		destination.processMapPlacements[placementKey] = placement
	}
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
	mergeRecycleMap(destination.editorJSONDocuments, delta.editorJSONDocuments)
	mergeRecycleMap(destination.editorJSONOperations, delta.editorJSONOperations)
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
	mergeRecycleMap(destination.entityRelationships, delta.entityRelationships)
}

func processMapParentIDsEqual(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return strings.TrimSpace(*left) == strings.TrimSpace(*right)
}

func memoryRecycleProcessMapResourceExists(snapshot memoryRecycleBinSnapshot, companyID string, resource domain.ProcessMapResourceRef) bool {
	switch resource.ResourceType {
	case domain.ProcessMapResourceTypeFolder:
		_, ok := snapshot.folders[key(companyID, resource.ResourceID)]
		return ok
	case domain.ProcessMapResourceTypeProcess:
		_, ok := snapshot.logicGates[key(companyID, resource.ResourceID)]
		return ok
	default:
		return false
	}
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
