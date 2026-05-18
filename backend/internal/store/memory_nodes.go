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

	n := domain.Node{
		CompanyID:        companyID,
		NodeID:           newUUIDv7String(),
		Title:            title,
		CreatedTimestamp: time.Now().UTC(),
	}
	r.nodes[key(companyID, n.NodeID)] = n
	if _, err := r.assignNodeToActiveNodesFolderLocked(companyID, n.NodeID, 0); err != nil {
		delete(r.nodes, key(companyID, n.NodeID))
		return domain.Node{}, err
	}
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
				statusColor = "#fbb152"
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

func (r *MemoryRepo) nodeLogicGateIDsLocked(companyID, nodeID string) []string {
	seen := map[string]bool{}
	for _, cards := range r.kanbanCards {
		for _, card := range cards {
			if card.CompanyID != companyID || card.NodeID != nodeID || card.LogicGateID == nil {
				continue
			}
			logicGateID := strings.TrimSpace(*card.LogicGateID)
			if logicGateID != "" {
				seen[logicGateID] = true
			}
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
	node = r.withDerivedNodeStatusLocked(node)
	node.LogicGateIDs = r.nodeLogicGateIDsLocked(node.CompanyID, node.NodeID)
	if node.AssigneeUserID == nil || strings.TrimSpace(*node.AssigneeUserID) == "" {
		return node
	}
	if _, ok := r.memberships[membershipKey(node.CompanyID, *node.AssigneeUserID)]; !ok {
		return node
	}
	for _, user := range r.users {
		if user.UserID != *node.AssigneeUserID {
			continue
		}
		if name := strings.TrimSpace(user.DisplayName); name != "" {
			node.AssigneeName = &name
		}
		if email := strings.TrimSpace(user.Email); email != "" {
			node.AssigneeEmail = &email
		}
		break
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
		if input.AssigneeUserID == nil || strings.TrimSpace(*input.AssigneeUserID) == "" {
			node.AssigneeUserID = nil
		} else {
			value := strings.TrimSpace(*input.AssigneeUserID)
			if _, ok := r.memberships[membershipKey(input.CompanyID, value)]; !ok {
				return domain.Node{}, ErrAssigneeNotInCompany
			}
			node.AssigneeUserID = &value
		}
	}
	r.nodes[k] = node
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

func (r *MemoryRepo) DeleteNode(companyID, nodeID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.deleteNodeLocked(companyID, nodeID)
}

func (r *MemoryRepo) deleteNodeLocked(companyID, nodeID string) error {
	k := key(companyID, nodeID)
	if _, ok := r.nodes[k]; !ok {
		return ErrNotFound
	}

	delete(r.nodes, k)
	delete(r.nodeInfo, k)
	delete(r.nodeText, k)
	delete(r.folderItems, folderItemKey(companyID, "node", nodeID))
	delete(r.nodeMapPositions, k)
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
	for _, item := range r.nodeText[key(companyID, nodeID)] {
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
		Node:          r.withNodeReadModelLocked(node),
		Information:   info,
		Relationships: relationships,
	}, nil
}
