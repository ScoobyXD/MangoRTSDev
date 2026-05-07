package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"time"
)

func newestNodeTextProjectionKey(items map[string]domain.NodeProjection) string {
	keyValue := ""
	var newest domain.NodeProjection
	for key, item := range items {
		if !isEditorTextBoxType(item.Type) {
			continue
		}
		if keyValue == "" || item.UpdatedTimestamp.After(newest.UpdatedTimestamp) || (item.UpdatedTimestamp.Equal(newest.UpdatedTimestamp) && item.InformationID > newest.InformationID) {
			keyValue = key
			newest = item
		}
	}
	return keyValue
}

func (r *MemoryRepo) CreateNode(companyID, title string) (domain.Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	n := domain.Node{
		CompanyID:        companyID,
		NodeID:           newUUIDv7String(),
		Title:            title,
		CreatedTimestamp: time.Now().UTC(),
	}
	r.nodes[key(companyID, n.NodeID)] = n
	return n, nil
}

func (r *MemoryRepo) deriveNodeStatusLocked(companyID, nodeID string) (*string, *string) {
	for _, cards := range r.kanbanCards {
		for _, card := range cards {
			if card.CompanyID != companyID || card.NodeID != nodeID || card.LogicGateID == nil {
				continue
			}
			status := ""
			statusColor := ""
			if card.IsIssue {
				status = "Issue"
				statusColor = "#ffd400"
			} else if title, ok := r.kanbanColumnTitleLocked(companyID, card.BoardID, card.ColumnID); ok {
				status = title
				if column, found := r.kanbanColumnLocked(companyID, card.BoardID, card.ColumnID); found {
					statusColor = column.ItemColor
				}
			}
			if status == "" {
				status = "Unknown"
			}
			if statusColor == "" {
				statusColor = "#2f7d62"
			}
			return &status, &statusColor
		}
	}
	return nil, nil
}

func (r *MemoryRepo) withDerivedNodeStatusLocked(node domain.Node) domain.Node {
	derivedStatus, derivedColor := r.deriveNodeStatusLocked(node.CompanyID, node.NodeID)
	if derivedStatus != nil {
		node.Status = derivedStatus
	}
	if derivedColor != nil {
		node.StatusColor = derivedColor
	}
	return node
}

func (r *MemoryRepo) UpdateNode(input UpdateNodeInput) (domain.Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
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
	if input.StatusColorSet {
		node.StatusColor = input.StatusColor
	}
	if input.PrioritySet {
		node.Priority = input.Priority
	}
	if input.AssigneeUserIDSet {
		node.AssigneeUserID = input.AssigneeUserID
	}
	r.nodes[k] = node
	return r.withDerivedNodeStatusLocked(node), nil
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
			items = append(items, r.withDerivedNodeStatusLocked(node))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) GetNode(companyID, nodeID string) (domain.Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	n, ok := r.nodes[key(companyID, nodeID)]
	if !ok {
		return domain.Node{}, ErrNotFound
	}
	return r.withDerivedNodeStatusLocked(n), nil
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

func (r *MemoryRepo) DeleteNode(companyID, nodeID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	k := key(companyID, nodeID)
	if _, ok := r.nodes[k]; !ok {
		return ErrNotFound
	}

	delete(r.nodes, k)
	delete(r.nodeInfo, k)
	delete(r.nodeText, k)
	delete(r.folderItems, folderItemKey(companyID, "node", nodeID))
	delete(r.nodeMapPositions, k)
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
	for operationKey, operation := range r.operations {
		if operation.CompanyID != companyID || operation.NodeID == nil || *operation.NodeID != nodeID {
			continue
		}
		// Preserve operation history while releasing the FK-shaped in-memory pointer.
		operation.NodeID = nil
		r.operations[operationKey] = operation
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

func (r *MemoryRepo) UpsertNodeMapPositions(companyID string, positions []domain.NodeMapPosition) ([]domain.NodeMapPosition, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	out := make([]domain.NodeMapPosition, 0, len(positions))
	for _, position := range positions {
		if _, ok := r.nodes[key(companyID, position.NodeID)]; !ok {
			return nil, ErrNotFound
		}
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
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return domain.NodeInformation{}, ErrNotFound
	}
	now := time.Now().UTC()
	item := domain.NodeInformation{
		CompanyID:        companyID,
		InformationID:    newUUIDv7String(),
		NodeID:           nodeID,
		Type:             infoType,
		Information:      information,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	k := key(companyID, nodeID)
	r.nodeInfo[k] = append(r.nodeInfo[k], item)
	sort.Slice(r.nodeInfo[k], func(i, j int) bool {
		return r.nodeInfo[k][i].CreatedTimestamp.Before(r.nodeInfo[k][j].CreatedTimestamp)
	})
	keyValue := informationID
	if keyValue == "" {
		keyValue = item.InformationID
	}
	if r.nodeText[k] == nil {
		r.nodeText[k] = map[string]domain.NodeProjection{}
	}
	if isEditorTextBoxType(infoType) {
		// The current editor has exactly one document surface per node. Keep
		// history append-only above, but collapse the hot projection to one
		// current Text box row so UI and headless reads never rotate old drafts.
		if existingTextKey := newestNodeTextProjectionKey(r.nodeText[k]); existingTextKey != "" {
			keyValue = existingTextKey
			for projectionID, projection := range r.nodeText[k] {
				if projectionID != keyValue && isEditorTextBoxType(projection.Type) {
					delete(r.nodeText[k], projectionID)
				}
			}
		}
	}
	existing, ok := r.nodeText[k][keyValue]
	created := item.CreatedTimestamp
	if ok {
		created = existing.CreatedTimestamp
	}
	r.nodeText[k][keyValue] = domain.NodeProjection{
		CompanyID:        companyID,
		NodeID:           nodeID,
		Type:             infoType,
		Information:      information,
		InformationID:    keyValue,
		CreatedTimestamp: created,
		UpdatedTimestamp: item.UpdatedTimestamp,
	}
	return item, nil
}

func (r *MemoryRepo) ListNodeProjections(companyID, nodeID string) ([]domain.NodeProjection, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return nil, ErrNotFound
	}
	items := make([]domain.NodeProjection, 0)
	latestTextKey := newestNodeTextProjectionKey(r.nodeText[key(companyID, nodeID)])
	for projectionID, item := range r.nodeText[key(companyID, nodeID)] {
		if isEditorTextBoxType(item.Type) && projectionID != latestTextKey {
			continue
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedTimestamp.Before(items[j].UpdatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) DeleteNodeProjection(companyID, nodeID, informationID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return ErrNotFound
	}
	delete(r.nodeText[key(companyID, nodeID)], informationID)
	return nil
}

func (r *MemoryRepo) CreateNodeRelationship(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

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
	return item, nil
}

func (r *MemoryRepo) DeleteNodeRelationship(companyID, relationshipID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	items := r.nodeRels[companyID]
	filtered := make([]domain.NodeRelationship, 0, len(items))
	deleted := false
	for _, item := range items {
		if item.NodeRelationshipID == relationshipID {
			deleted = true
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
	r.mu.RLock()
	defer r.mu.RUnlock()

	node, ok := r.nodes[key(companyID, nodeID)]
	if !ok {
		return domain.NodeDetails{}, ErrNotFound
	}

	info := append([]domain.NodeInformation{}, r.nodeInfo[key(companyID, nodeID)]...)
	sort.Slice(info, func(i, j int) bool {
		return info[i].CreatedTimestamp.Before(info[j].CreatedTimestamp)
	})

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
		Node:          node,
		Information:   info,
		Relationships: relationships,
	}, nil
}
