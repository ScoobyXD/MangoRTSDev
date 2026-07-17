package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) CreateNode(companyID, title string) (domain.Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotNodeGraphEventStateLocked()
	item, err := r.createNodeLocked(companyID, title)
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return domain.Node{}, err
	}
	return item, nil
}

func (r *MemoryRepo) CreateNodeWithWorkspaceEvent(companyID, title string) (domain.Node, domain.DomainEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotNodeGraphEventStateLocked()
	item, err := r.createNodeLocked(companyID, title)
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return domain.Node{}, domain.DomainEvent{}, err
	}
	event, err := r.appendDomainEventLocked(nodeCreatedWorkspaceEventInput(item))
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return domain.Node{}, domain.DomainEvent{}, err
	}
	return item, event, nil
}

func (r *MemoryRepo) createNodeLocked(companyID, title string) (domain.Node, error) {
	return r.createNodeWithIDLocked(companyID, "", title)
}

func (r *MemoryRepo) createNodeWithIDLocked(companyID, nodeID, title string) (domain.Node, error) {
	nodeID = strings.TrimSpace(nodeID)
	if nodeID == "" {
		nodeID = newUUIDv7String()
	} else if _, exists := r.nodes[key(companyID, nodeID)]; exists {
		return domain.Node{}, ErrInvalid
	}
	n := domain.Node{
		CompanyID:        companyID,
		NodeID:           nodeID,
		Title:            title,
		DefaultAccess:    ResourceDefaultAccessEdit,
		CreatedTimestamp: time.Now().UTC(),
	}
	r.nodes[key(companyID, n.NodeID)] = n
	r.bumpNodeViewVersionLocked(companyID, n.NodeID)
	r.syncGVICMatrixProjectionForNodeLocked(companyID, n.NodeID)
	return r.withNodeReadModelLocked(n), nil
}

func (r *MemoryRepo) deriveNodeStatusLocked(companyID, nodeID string) *string {
	assignment, ok := r.nodeLogicGateAssignmentLocked(companyID, nodeID, "")
	if !ok {
		return nil
	}
	status := ""
	if assignment.IsIssue {
		status = "Issue"
	} else if title, ok := r.kanbanColumnTitleLocked(companyID, assignment.CompatibilityBoardID, assignment.ColumnID); ok {
		status = title
	}
	if status == "" {
		status = "Unknown"
	}
	return &status
}

func (r *MemoryRepo) withDerivedNodeStatusLocked(node domain.Node) domain.Node {
	derivedStatus := r.deriveNodeStatusLocked(node.CompanyID, node.NodeID)
	if derivedStatus != nil {
		node.Status = derivedStatus
	}
	return node
}

func (r *MemoryRepo) nodeLogicGateIDsLocked(companyID, nodeID string) []string {
	seen := map[string]bool{}
	assignment, ok := r.nodeLogicGateAssignmentLocked(companyID, nodeID, "")
	if ok {
		logicGateID := strings.TrimSpace(assignment.LogicGateID)
		if logicGateID != "" {
			seen[logicGateID] = true
		}
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func (r *MemoryRepo) withNodeReadModelLocked(node domain.Node) domain.Node {
	node.DefaultAccess = defaultResourceAccessOrEdit(node.DefaultAccess)
	node = r.withDerivedNodeStatusLocked(node)
	node.LogicGateIDs = r.nodeLogicGateIDsLocked(node.CompanyID, node.NodeID)
	node.Accounts = r.accountSnapshotsForNodeLocked(node.CompanyID, node.NodeID)
	return node
}

func (r *MemoryRepo) UpdateNode(input UpdateNodeInput) (domain.Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotNodeGraphEventStateLocked()
	item, err := r.updateNodeLocked(input)
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return domain.Node{}, err
	}
	return item, nil
}

func (r *MemoryRepo) UpdateNodeAndWorkspaceEvent(input UpdateNodeInput) (domain.Node, domain.DomainEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotNodeGraphEventStateLocked()
	before, hasBefore := r.nodes[key(input.CompanyID, input.NodeID)]
	gvicEffectiveBefore := r.gvicEffectiveAssignmentsForResourceLocked(input.CompanyID, EntityTypeNode, input.NodeID)
	beforeGeneratedUserIDs := gvicEffectiveUserIDsForRole(gvicEffectiveBefore, domain.GVICRoleGenerated)
	item, err := r.updateNodeLocked(input)
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return domain.Node{}, domain.DomainEvent{}, err
	}
	gvicEffectiveAfter := r.gvicEffectiveAssignmentsForResourceLocked(input.CompanyID, EntityTypeNode, input.NodeID)
	afterGeneratedUserIDs := gvicEffectiveUserIDsForRole(gvicEffectiveAfter, domain.GVICRoleGenerated)
	eventInput := nodeUpdatedWorkspaceEventInput(item)
	if hasBefore {
		eventInput = nodeUpdatedWorkspaceEventInputForUpdate(input, before, item, beforeGeneratedUserIDs, afterGeneratedUserIDs)
	}
	event, err := r.appendDomainEventLocked(eventInput)
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return domain.Node{}, domain.DomainEvent{}, err
	}
	return item, event, nil
}

func (r *MemoryRepo) updateNodeLocked(input UpdateNodeInput) (domain.Node, error) {
	k := key(input.CompanyID, input.NodeID)
	node, ok := r.nodes[k]
	if !ok {
		return domain.Node{}, ErrNotFound
	}

	if input.TitleSet {
		node.Title = input.Title
		for boardKey, cards := range r.kanbanCards {
			for index, card := range cards {
				if card.CompanyID != input.CompanyID || card.NodeID != input.NodeID {
					continue
				}
				card.NodeTitle = input.Title
				card.UpdatedTimestamp = time.Now().UTC()
				r.kanbanCards[boardKey][index] = card
			}
		}
	}
	if input.DueDateSet {
		node.DueDate = input.DueDate
	}
	if input.StatusSet {
		node.Status = input.Status
	}
	if input.PrioritySet {
		node.Priority = input.Priority
	}
	r.nodes[k] = node
	r.bumpNodeViewVersionLocked(input.CompanyID, input.NodeID)
	r.syncGVICMatrixProjectionForNodeLocked(input.CompanyID, input.NodeID)
	r.syncProjectManagementTimelineProjectionForNodeLocked(input.CompanyID, input.NodeID)
	return r.withNodeReadModelLocked(node), nil
}

func (r *MemoryRepo) UpdateNodeTitle(companyID, nodeID, title string) (domain.Node, error) {
	return r.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: nodeID, Title: title, TitleSet: true})
}

func (r *MemoryRepo) ListNodes(companyID string) ([]domain.Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.Node, 0)
	for _, node := range r.nodes {
		if node.CompanyID == companyID {
			items = append(items, r.withNodeReadModelLocked(node))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) ListVisibleNodes(companyID, userID string) ([]domain.Node, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.Node, 0)
	for _, node := range r.nodes {
		if node.CompanyID != companyID {
			continue
		}
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeNode, node.NodeID, EntityPermissionEdit) {
			continue
		}
		node = r.withNodeReadModelLocked(node)
		node.EffectiveAccess = r.effectiveAccessLevelForUserLocked(companyID, userID, EntityTypeNode, node.NodeID)
		items = append(items, node)
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].NodeID < items[j].NodeID
	})
	return items, nil
}

func (r *MemoryRepo) ListNodesInFolderSubtree(companyID, folderID string) ([]domain.Node, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListNodes(companyID)
	}
	return []domain.Node{}, nil
}

func (r *MemoryRepo) ListVisibleNodesInFolderSubtree(companyID, folderID, userID string) ([]domain.Node, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return r.ListVisibleNodes(companyID, userID)
	}
	return []domain.Node{}, nil
}
func (r *MemoryRepo) GetNode(companyID, nodeID string) (domain.Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	n, ok := r.nodes[key(companyID, nodeID)]
	if !ok {
		return domain.Node{}, ErrNotFound
	}
	return r.withNodeReadModelLocked(n), nil
}

func (r *MemoryRepo) ListNodeRelationships(companyID string) ([]domain.NodeRelationship, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := append([]domain.NodeRelationship{}, r.nodeRels[companyID]...)
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) ListNodeRelationshipsInFolderSubtree(companyID, folderID string) ([]domain.NodeRelationship, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListNodeRelationships(companyID)
	}
	return []domain.NodeRelationship{}, nil
}
func (r *MemoryRepo) DeleteNode(companyID, nodeID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.deleteNodeLocked(companyID, nodeID)
}

func (r *MemoryRepo) DeleteNodeAndWorkspaceEvent(companyID, nodeID string) (domain.DomainEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotNodeGraphEventStateLocked()
	if err := r.deleteNodeLocked(companyID, nodeID); err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return domain.DomainEvent{}, err
	}
	event, err := r.appendDomainEventLocked(nodeDeletedWorkspaceEventInput(companyID, nodeID))
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return domain.DomainEvent{}, err
	}
	return event, nil
}

func (r *MemoryRepo) deleteNodeLocked(companyID, nodeID string) error {
	k := key(companyID, nodeID)
	if _, ok := r.nodes[k]; !ok {
		return ErrNotFound
	}
	if _, protected := r.emailCollaborationForNodeLocked(companyID, nodeID); protected {
		return ErrProtectedEmailCollaborationResource
	}
	r.deleteGVICMatrixProjectionForNodeLocked(companyID, nodeID)
	for itemKey, item := range r.projectTimelineItems {
		if item.CompanyID == companyID && item.EntityType == EntityTypeNode && item.EntityID == nodeID {
			delete(r.projectTimelineItems, itemKey)
			delete(r.projectTimelineProjection, itemKey)
		}
	}

	delete(r.nodes, k)
	delete(r.nodeInfo, k)
	delete(r.nodeText, k)
	for changeKey, change := range r.nodeContentChanges {
		if change.CompanyID == companyID && change.NodeID == nodeID {
			delete(r.nodeContentChanges, changeKey)
		}
	}
	for seenKey := range r.nodeContentChangeSeen {
		parts := strings.Split(seenKey, ":")
		if len(parts) >= 2 && parts[0] == companyID {
			change, ok := r.nodeContentChanges[key(companyID, parts[1])]
			if !ok || change.NodeID == nodeID {
				delete(r.nodeContentChangeSeen, seenKey)
			}
		}
	}
	for seenKey := range r.nodeProjectionSeen {
		parts := strings.Split(seenKey, ":")
		if len(parts) >= 2 && parts[0] == companyID && parts[1] == nodeID {
			delete(r.nodeProjectionSeen, seenKey)
		}
	}
	delete(r.folderItems, folderItemKey(companyID, "node", nodeID))
	delete(r.nodeMapPositions, k)
	delete(r.nodeLogicGateAssignments, nodeLogicGateAssignmentKey(companyID, nodeID))
	for assignmentKey, assignment := range r.nodeAccountAssignments {
		if assignment.CompanyID == companyID && assignment.NodeID == nodeID {
			delete(r.nodeAccountAssignments, assignmentKey)
		}
	}
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.EntityType == EntityTypeNode && permission.EntityID == nodeID {
			delete(r.entityPermissions, permissionKey)
		}
	}
	for linkKey, link := range r.emailNodeLinks {
		if link.CompanyID == companyID && link.NodeID == nodeID {
			delete(r.emailNodeLinks, linkKey)
		}
	}
	for board, cards := range r.kanbanCards {
		next := make([]domain.KanbanCard, 0, len(cards))
		for _, card := range cards {
			if card.CompanyID == companyID && card.NodeID == nodeID {
				continue
			}
			next = append(next, card)
		}
		r.kanbanCards[board] = next
	}

	filtered := make([]domain.NodeRelationship, 0, len(r.nodeRels[companyID]))
	for _, rel := range r.nodeRels[companyID] {
		if rel.NodeIDA == nodeID || rel.NodeIDB == nodeID {
			continue
		}
		filtered = append(filtered, rel)
	}
	r.nodeRels[companyID] = filtered
	return nil
}

func (r *MemoryRepo) ListNodeMapPositions(companyID string) ([]domain.NodeMapPosition, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]domain.NodeMapPosition, 0)
	for _, item := range r.nodeMapPositions {
		if item.CompanyID == companyID {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].NodeID < items[j].NodeID
	})
	return items, nil
}

func (r *MemoryRepo) ListNodeMapPositionsInFolderSubtree(companyID, folderID string) ([]domain.NodeMapPosition, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListNodeMapPositions(companyID)
	}
	return []domain.NodeMapPosition{}, nil
}
func (r *MemoryRepo) nodeMapWindowPositionsLocked(query NodeMapWindowQuery, folderIDs map[string]bool) []domain.NodeMapPosition {
	return []domain.NodeMapPosition{}
}

func (r *MemoryRepo) ListNodeMapPositionsWindow(query NodeMapWindowQuery) ([]domain.NodeMapPosition, error) {
	query, err := NormalizeNodeMapWindowQuery(query)
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	folderIDs := companyExplorerFolderSubtreeIDsLocked(r.folders, query.CompanyID, query.FolderID, "")
	if len(folderIDs) == 0 {
		return nil, ErrNotFound
	}
	return r.nodeMapWindowPositionsLocked(query, folderIDs), nil
}

func (r *MemoryRepo) ListNodeMapWindow(query NodeMapWindowQuery) (NodeMapWindowResult, error) {
	query, err := NormalizeNodeMapWindowQuery(query)
	if err != nil {
		return NodeMapWindowResult{}, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	folderIDs := companyExplorerFolderSubtreeIDsLocked(r.folders, query.CompanyID, query.FolderID, "")
	if len(folderIDs) == 0 {
		return NodeMapWindowResult{}, ErrNotFound
	}

	positions := r.nodeMapWindowPositionsLocked(query, folderIDs)
	result := NodeMapWindowResult{
		CompanyID:        query.CompanyID,
		FolderID:         query.FolderID,
		Window:           query.Window,
		Limit:            query.Limit,
		Nodes:            []domain.Node{},
		Relationships:    []domain.NodeRelationship{},
		Folders:          []domain.CompanyExplorerFolder{},
		FolderItems:      []domain.CompanyExplorerFolderItem{},
		NodeMapPositions: positions,
	}
	for _, folder := range r.folders {
		if !folderIDs[folder.FolderID] {
			continue
		}
		if folder.SystemKey != nil && *folder.SystemKey == "kanban_boards" {
			continue
		}
		result.Folders = append(result.Folders, r.withSharedInboxGVICLocked(folder))
	}
	sort.Slice(result.Folders, func(i, j int) bool {
		if result.Folders[i].Position == result.Folders[j].Position {
			if !result.Folders[i].CreatedTimestamp.Equal(result.Folders[j].CreatedTimestamp) {
				return result.Folders[i].CreatedTimestamp.Before(result.Folders[j].CreatedTimestamp)
			}
			return result.Folders[i].FolderID < result.Folders[j].FolderID
		}
		return result.Folders[i].Position < result.Folders[j].Position
	})
	return result, nil
}
func (r *MemoryRepo) UpsertNodeMapPositions(companyID string, positions []domain.NodeMapPosition) ([]domain.NodeMapPosition, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, position := range positions {
		if _, ok := r.nodes[key(companyID, position.NodeID)]; !ok {
			return nil, ErrNotFound
		}
	}
	now := time.Now().UTC()
	out := make([]domain.NodeMapPosition, 0, len(positions))
	for _, position := range positions {
		item := domain.NodeMapPosition{
			CompanyID:        companyID,
			NodeID:           position.NodeID,
			X:                position.X,
			Y:                position.Y,
			UpdatedTimestamp: now,
		}
		r.nodeMapPositions[key(companyID, item.NodeID)] = item
		out = append(out, item)
	}
	return out, nil
}

func (r *MemoryRepo) AddNodeInformation(companyID, nodeID, infoType, information, informationID string) (domain.NodeInformation, error) {
	return r.addNodeInformation(NodeInformationInput{
		CompanyID:     companyID,
		NodeID:        nodeID,
		Type:          infoType,
		Information:   information,
		InformationID: informationID,
	})
}

func (r *MemoryRepo) AddNodeInformationWithActor(input NodeInformationInput) (domain.NodeInformation, error) {
	return r.addNodeInformation(input)
}

func (r *MemoryRepo) addNodeInformation(input NodeInformationInput) (domain.NodeInformation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.NodeID)
	infoType := strings.TrimSpace(input.Type)
	informationID := strings.TrimSpace(input.InformationID)
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return domain.NodeInformation{}, ErrNotFound
	}
	if collaboration, protected := r.emailCollaborationForNodeLocked(companyID, nodeID); protected && collaboration.AttachedEmailInformationID == informationID {
		return domain.NodeInformation{}, ErrProtectedEmailCollaborationResource
	}
	now := time.Now().UTC()
	k := key(companyID, nodeID)
	item := domain.NodeInformation{
		CompanyID:        companyID,
		InformationID:    newUUIDv7String(),
		NodeID:           nodeID,
		Type:             infoType,
		Information:      input.Information,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	keyValue := informationID
	if keyValue == "" {
		keyValue = item.InformationID
	}
	if strings.EqualFold(infoType, "Text block chat") {
		outboxInput, err := nodeChatCreatedOutboxInput(item, keyValue)
		if err != nil {
			return domain.NodeInformation{}, err
		}
		if _, err := r.enqueueRealtimeOutboxLocked(outboxInput); err != nil {
			return domain.NodeInformation{}, err
		}
	}
	r.nodeInfo[k] = append(r.nodeInfo[k], item)
	sort.Slice(r.nodeInfo[k], func(i, j int) bool {
		return r.nodeInfo[k][i].CreatedTimestamp.Before(r.nodeInfo[k][j].CreatedTimestamp)
	})
	if r.nodeText[k] == nil {
		r.nodeText[k] = map[string]domain.NodeProjection{}
	}
	existing, ok := r.nodeText[k][keyValue]
	created := item.CreatedTimestamp
	previous := (*domain.NodeProjection)(nil)
	revision := int64(1)
	if ok {
		created = existing.CreatedTimestamp
		existingCopy := existing
		previous = &existingCopy
		if existingCopy.Revision < 1 {
			existingCopy.Revision = 1
		}
		revision = existingCopy.Revision + 1
	}
	projection := domain.NodeProjection{
		CompanyID:        companyID,
		NodeID:           nodeID,
		Type:             infoType,
		Information:      input.Information,
		InformationID:    keyValue,
		CreatedTimestamp: created,
		Revision:         revision,
		UpdatedTimestamp: item.UpdatedTimestamp,
	}
	r.nodeText[k][keyValue] = projection
	if strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "" {
		r.recordNodeContentChangesLocked(buildNodeContentChanges(
			companyID,
			nodeID,
			keyValue,
			infoType,
			previous,
			input.Information,
			normalizeNodeContentChangeActor(input.ActorUserID, input.ActorDisplayName),
			now,
		))
	}
	r.bumpNodeViewVersionLocked(companyID, nodeID)
	return item, nil
}

func (r *MemoryRepo) ListNodeProjections(companyID, nodeID string) ([]domain.NodeProjection, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return nil, ErrNotFound
	}
	items := make([]domain.NodeProjection, 0)
	for _, item := range r.nodeText[key(companyID, nodeID)] {
		if isEditorTextBoxType(item.Type) && item.IsDeleted {
			continue
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].InformationID < items[j].InformationID
	})
	return items, nil
}

func (r *MemoryRepo) DeleteNodeProjection(companyID, nodeID, informationID string) error {
	return r.deleteNodeProjection(NodeProjectionDeleteInput{
		CompanyID:     companyID,
		NodeID:        nodeID,
		InformationID: informationID,
	})
}

func (r *MemoryRepo) DeleteNodeProjectionWithActor(input NodeProjectionDeleteInput) error {
	return r.deleteNodeProjection(input)
}

func (r *MemoryRepo) deleteNodeProjection(input NodeProjectionDeleteInput) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.NodeID)
	informationID := strings.TrimSpace(input.InformationID)
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return ErrNotFound
	}
	if collaboration, protected := r.emailCollaborationForNodeLocked(companyID, nodeID); protected && collaboration.AttachedEmailInformationID == informationID {
		return ErrProtectedEmailCollaborationResource
	}
	k := key(companyID, nodeID)
	existing, projectionExists := r.nodeText[k][informationID]
	if projectionExists && isEditorTextBoxType(existing.Type) {
		if existing.Revision < 1 {
			existing.Revision = 1
		}
		if input.ExpectedRevision == nil {
			return ErrProjectionRevisionRequired
		}
		if existing.IsDeleted || *input.ExpectedRevision != existing.Revision {
			current := existing
			return &ProjectionRevisionConflictError{NodeCurrent: &current}
		}
	}
	if projectionExists && strings.EqualFold(strings.TrimSpace(existing.Type), "Text block chat") {
		outboxInput, err := nodeChatDeletedOutboxInput(existing)
		if err != nil {
			return err
		}
		if _, err := r.enqueueRealtimeOutboxLocked(outboxInput); err != nil {
			return err
		}
	}
	if projectionExists && (strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "") {
		existingCopy := existing
		r.recordNodeContentChangesLocked(buildNodeContentChanges(
			companyID,
			nodeID,
			informationID,
			existing.Type,
			&existingCopy,
			"",
			normalizeNodeContentChangeActor(input.ActorUserID, input.ActorDisplayName),
			time.Now().UTC(),
		))
	}
	if projectionExists {
		if isEditorTextBoxType(existing.Type) {
			existing.IsDeleted = true
			existing.Revision++
			existing.UpdatedTimestamp = time.Now().UTC()
			r.nodeText[k][informationID] = existing
		} else {
			delete(r.nodeText[k], informationID)
		}
		r.bumpNodeViewVersionLocked(companyID, nodeID)
	}
	return nil
}

func (r *MemoryRepo) recordNodeContentChangesLocked(changes []domain.NodeContentChange) {
	if len(changes) == 0 {
		return
	}
	now := time.Now().UTC()
	for _, change := range changes {
		r.nodeContentChanges[key(change.CompanyID, change.ChangeID)] = change
		if strings.TrimSpace(change.ActorUserID) != "" {
			r.nodeContentChangeSeen[nodeContentChangeSeenKey(change.CompanyID, change.ChangeID, change.ActorUserID)] = now
		}
	}
}

func cloneMemoryNodeProjectionMap(items map[string]domain.NodeProjection) map[string]domain.NodeProjection {
	if items == nil {
		return nil
	}
	out := make(map[string]domain.NodeProjection, len(items))
	for key, value := range items {
		out[key] = value
	}
	return out
}

func cloneMemoryNodeContentChanges(items map[string]domain.NodeContentChange) map[string]domain.NodeContentChange {
	out := make(map[string]domain.NodeContentChange, len(items))
	for key, value := range items {
		out[key] = value
	}
	return out
}

func cloneMemoryTimeMap(items map[string]time.Time) map[string]time.Time {
	out := make(map[string]time.Time, len(items))
	for key, value := range items {
		out[key] = value
	}
	return out
}

func (r *MemoryRepo) ListUnseenNodeContentChanges(input NodeContentChangeListInput) ([]domain.NodeContentChange, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.NodeID)
	userID := strings.TrimSpace(input.UserID)
	if companyID == "" || nodeID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return nil, ErrNotFound
	}
	projections := r.nodeText[key(companyID, nodeID)]
	changesByInformationID := map[string][]domain.NodeContentChange{}
	seenInformationByID := map[string]string{}
	for _, change := range r.nodeContentChanges {
		if change.CompanyID != companyID || change.NodeID != nodeID {
			continue
		}
		if strings.TrimSpace(change.ActorUserID) == userID {
			continue
		}
		projection, ok := projections[change.InformationID]
		if !ok || projection.Type != "Text box" {
			continue
		}
		if _, seen := r.nodeContentChangeSeen[nodeContentChangeSeenKey(companyID, change.ChangeID, userID)]; seen {
			continue
		}
		seen := r.nodeProjectionSeen[nodeProjectionSeenKey(companyID, nodeID, change.InformationID, userID)]
		if !seen.seenAt.IsZero() && change.CreatedTimestamp.Before(seen.seenAt) {
			continue
		}
		changesByInformationID[change.InformationID] = append(changesByInformationID[change.InformationID], change)
		seenInformationByID[change.InformationID] = seen.information
	}
	items := make([]domain.NodeContentChange, 0, len(changesByInformationID))
	for informationID, changes := range changesByInformationID {
		sort.Slice(changes, func(i, j int) bool {
			if !changes[i].CreatedTimestamp.Equal(changes[j].CreatedTimestamp) {
				return changes[i].CreatedTimestamp.Before(changes[j].CreatedTimestamp)
			}
			return changes[i].ChangeID < changes[j].ChangeID
		})
		items = append(items, buildNodeProjectionAuthoredSnapshotChanges(
			companyID,
			nodeID,
			informationID,
			seenInformationByID[informationID],
			changes,
		)...)
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].ChangeID < items[j].ChangeID
	})
	return items, nil
}

func (r *MemoryRepo) MarkNodeContentChangeSeen(input NodeContentChangeSeenInput) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.NodeID)
	changeID := strings.TrimSpace(input.ChangeID)
	userID := strings.TrimSpace(input.UserID)
	if companyID == "" || nodeID == "" || userID == "" {
		return 0, ErrInvalid
	}
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return 0, ErrNotFound
	}
	if informationID := nodeProjectionInformationIDFromContentChangeID(changeID); informationID != "" {
		count, err := r.markNodeProjectionSeenLocked(companyID, nodeID, informationID, userID)
		if err == nil && count > 0 {
			r.bumpNodeViewUserVersionLocked(companyID, nodeID, userID)
		}
		return count, err
	}
	if changeID == "" {
		count, err := r.markNodeProjectionSeenLocked(companyID, nodeID, "", userID)
		if err == nil && count > 0 {
			r.bumpNodeViewUserVersionLocked(companyID, nodeID, userID)
		}
		return count, err
	}
	now := time.Now().UTC()
	count := 0
	change, ok := r.nodeContentChanges[key(companyID, changeID)]
	if !ok || change.NodeID != nodeID {
		return 0, ErrNotFound
	}
	seenKey := nodeContentChangeSeenKey(companyID, changeID, userID)
	if _, seen := r.nodeContentChangeSeen[seenKey]; !seen {
		r.nodeContentChangeSeen[seenKey] = now
		count = 1
		r.bumpNodeViewUserVersionLocked(companyID, nodeID, userID)
	}
	return count, nil
}

func (r *MemoryRepo) markNodeProjectionSeenLocked(companyID, nodeID, informationID, userID string) (int, error) {
	projections := r.nodeText[key(companyID, nodeID)]
	now := time.Now().UTC()
	if informationID != "" {
		projection, ok := projections[informationID]
		if !ok || projection.Type != "Text box" {
			return 0, ErrNotFound
		}
		r.nodeProjectionSeen[nodeProjectionSeenKey(companyID, nodeID, informationID, userID)] = memoryNodeProjectionSeen{
			information: projection.Information,
			seenAt:      now,
		}
		for _, change := range r.nodeContentChanges {
			if change.CompanyID == companyID && change.NodeID == nodeID && change.InformationID == informationID {
				r.nodeContentChangeSeen[nodeContentChangeSeenKey(companyID, change.ChangeID, userID)] = now
			}
		}
		return 1, nil
	}
	count := 0
	for _, change := range r.nodeContentChanges {
		if change.CompanyID == companyID && change.NodeID == nodeID {
			r.nodeContentChangeSeen[nodeContentChangeSeenKey(companyID, change.ChangeID, userID)] = now
		}
	}
	for _, projection := range projections {
		if projection.Type != "Text box" {
			continue
		}
		r.nodeProjectionSeen[nodeProjectionSeenKey(companyID, nodeID, projection.InformationID, userID)] = memoryNodeProjectionSeen{
			information: projection.Information,
			seenAt:      now,
		}
		count++
	}
	return count, nil
}

func (r *MemoryRepo) CreateNodeRelationship(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.createNodeRelationshipLocked(companyID, nodeIDA, nodeIDB, aPosition, bPosition)
}

func (r *MemoryRepo) CreateNodeRelationshipAndWorkspaceEvent(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, domain.DomainEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotNodeGraphEventStateLocked()
	item, err := r.createNodeRelationshipLocked(companyID, nodeIDA, nodeIDB, aPosition, bPosition)
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return domain.NodeRelationship{}, domain.DomainEvent{}, err
	}
	event, err := r.appendDomainEventLocked(relationshipCreatedWorkspaceEventInput(item))
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return domain.NodeRelationship{}, domain.DomainEvent{}, err
	}
	return item, event, nil
}

func (r *MemoryRepo) createNodeRelationshipLocked(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, error) {
	if _, ok := r.nodes[key(companyID, nodeIDA)]; !ok {
		return domain.NodeRelationship{}, ErrNotFound
	}
	if _, ok := r.nodes[key(companyID, nodeIDB)]; !ok {
		return domain.NodeRelationship{}, ErrNotFound
	}

	item := domain.NodeRelationship{
		CompanyID:          companyID,
		NodeRelationshipID: newUUIDv7String(),
		NodeIDA:            nodeIDA,
		NodeIDB:            nodeIDB,
		APosition:          aPosition,
		BPosition:          bPosition,
		CreatedTimestamp:   time.Now().UTC(),
	}
	r.nodeRels[companyID] = append(r.nodeRels[companyID], item)
	r.bumpNodeViewVersionLocked(companyID, nodeIDA)
	r.bumpNodeViewVersionLocked(companyID, nodeIDB)
	return item, nil
}

func (r *MemoryRepo) DeleteNodeRelationship(companyID, relationshipID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.deleteNodeRelationshipLocked(companyID, relationshipID)
}

func (r *MemoryRepo) DeleteNodeRelationshipAndWorkspaceEvent(companyID, relationshipID string) (domain.DomainEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotNodeGraphEventStateLocked()
	if err := r.deleteNodeRelationshipLocked(companyID, relationshipID); err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return domain.DomainEvent{}, err
	}
	event, err := r.appendDomainEventLocked(relationshipDeletedWorkspaceEventInput(companyID, relationshipID))
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return domain.DomainEvent{}, err
	}
	return event, nil
}

func (r *MemoryRepo) deleteNodeRelationshipLocked(companyID, relationshipID string) error {
	items := r.nodeRels[companyID]
	filtered := make([]domain.NodeRelationship, 0, len(items))
	deleted := false
	for _, item := range items {
		if item.NodeRelationshipID == relationshipID {
			deleted = true
			r.bumpNodeViewVersionLocked(companyID, item.NodeIDA)
			r.bumpNodeViewVersionLocked(companyID, item.NodeIDB)
			continue
		}
		filtered = append(filtered, item)
	}
	if !deleted {
		return ErrNotFound
	}
	r.nodeRels[companyID] = filtered
	return nil
}

func (r *MemoryRepo) GetNodeDetails(companyID, nodeID string) (domain.NodeDetails, error) {
	return r.getNodeDetails(companyID, nodeID, true)
}

func (r *MemoryRepo) GetNodeDetailsSummary(companyID, nodeID string) (domain.NodeDetails, error) {
	return r.getNodeDetails(companyID, nodeID, false)
}

func (r *MemoryRepo) getNodeDetails(companyID, nodeID string, includeInformation bool) (domain.NodeDetails, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	node, ok := r.nodes[key(companyID, nodeID)]
	if !ok {
		return domain.NodeDetails{}, ErrNotFound
	}

	allInfo := r.nodeInfo[key(companyID, nodeID)]
	info := []domain.NodeInformation{}
	if includeInformation {
		info = append([]domain.NodeInformation{}, allInfo...)
		sort.Slice(info, func(i, j int) bool {
			return info[i].CreatedTimestamp.Before(info[j].CreatedTimestamp)
		})
	}

	relationships := make([]domain.NodeRelationship, 0)
	for _, rel := range r.nodeRels[companyID] {
		if rel.NodeIDA == nodeID || rel.NodeIDB == nodeID {
			relationships = append(relationships, rel)
		}
	}
	sort.Slice(relationships, func(i, j int) bool {
		return relationships[i].CreatedTimestamp.Before(relationships[j].CreatedTimestamp)
	})

	return domain.NodeDetails{
		Node:               r.withNodeReadModelLocked(node),
		Information:        info,
		Relationships:      relationships,
		InformationCount:   len(allInfo),
		RelationshipsCount: len(relationships),
	}, nil
}
