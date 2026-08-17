package store

import (
	"encoding/json"
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
	item, err := r.updateNodeLocked(input)
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return domain.Node{}, domain.DomainEvent{}, err
	}
	eventInput := nodeUpdatedWorkspaceEventInput(item)
	if hasBefore {
		eventInput = nodeUpdatedWorkspaceEventInputForUpdate(input, before, item)
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
	r.syncRACIMatrixProjectionForNodeLocked(input.CompanyID, input.NodeID)
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
	r.deleteRACIMatrixProjectionForNodeLocked(companyID, nodeID)
	for itemKey, item := range r.projectTimelineItems {
		if item.CompanyID == companyID && item.EntityType == EntityTypeNode && item.EntityID == nodeID {
			delete(r.projectTimelineItems, itemKey)
			delete(r.projectTimelineProjection, itemKey)
		}
	}

	delete(r.nodes, k)
	delete(r.nodeInfo, k)
	delete(r.nodeText, k)
	delete(r.folderItems, folderItemKey(companyID, "node", nodeID))
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
	for linkKey, link := range r.nodeEmailThreads {
		if link.CompanyID == companyID && link.NodeID == nodeID {
			delete(r.nodeEmailThreads, linkKey)
		}
	}
	collaborationIDs := map[string]bool{}
	for collaborationKey, collaboration := range r.emailCollaborations {
		if collaboration.CompanyID == companyID && collaboration.NodeID == nodeID {
			collaborationIDs[collaboration.CollaborationID] = true
			delete(r.emailCollaborations, collaborationKey)
		}
	}
	for participantKey, participant := range r.emailCollaborationParticipants {
		if participant.CompanyID == companyID && collaborationIDs[participant.CollaborationID] {
			delete(r.emailCollaborationParticipants, participantKey)
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
	revision := int64(1)
	if ok {
		created = existing.CreatedTimestamp
		if existing.Revision < 1 {
			existing.Revision = 1
		}
		revision = existing.Revision + 1
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

func (r *MemoryRepo) ListNodeProjectionSummaries(companyID, nodeID string) ([]domain.NodeProjection, error) {
	items, err := r.ListNodeProjections(companyID, nodeID)
	if err != nil {
		return nil, err
	}
	for index := range items {
		items[index].Information = nodeProjectionSummaryInformation(items[index].Information)
	}
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
	if projectionExists && strings.EqualFold(strings.TrimSpace(existing.Type), "Attached email") {
		emailThreadID := ""
		for _, link := range r.nodeEmailThreads {
			if link.CompanyID == companyID && link.NodeID == nodeID && link.InformationID == informationID {
				emailThreadID = link.EmailThreadID
				break
			}
		}
		if emailThreadID != "" {
			messageIDs := map[string]bool{}
			if thread, ok := r.emailThreads[key(companyID, emailThreadID)]; ok {
				for _, message := range thread.Messages {
					messageIDs[message.EmailMessageID] = true
				}
			}
			for _, projection := range r.nodeText[k] {
				if !strings.EqualFold(strings.TrimSpace(projection.Type), "Text block chat") {
					continue
				}
				var payload struct {
					SelectionSource    string `json:"selection_source"`
					SelectionMessageID string `json:"selection_message_id"`
				}
				if json.Unmarshal([]byte(projection.Information), &payload) == nil && strings.EqualFold(payload.SelectionSource, "email") && messageIDs[cleanUUIDText(payload.SelectionMessageID)] {
					return ErrEmailRelationshipHasNodeWork
				}
			}
		}
		for collaborationKey, collaboration := range r.emailCollaborations {
			if collaboration.CompanyID == companyID && collaboration.NodeID == nodeID && collaboration.AttachedEmailInformationID == informationID {
				delete(r.emailCollaborations, collaborationKey)
			}
		}
		for linkKey, link := range r.nodeEmailThreads {
			if link.CompanyID == companyID && link.NodeID == nodeID && link.InformationID == informationID {
				delete(r.nodeEmailThreads, linkKey)
			}
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
