package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"time"
)

func newestLogicGateTextProjectionKey(items map[string]domain.LogicGateProjection) string {
	keyValue := ""
	var newest domain.LogicGateProjection
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

func (r *MemoryRepo) CreateLogicGate(companyID, header string) (domain.LogicGate, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	item := domain.LogicGate{
		CompanyID:        companyID,
		LogicGateID:      newUUIDv7String(),
		Header:           header,
		CreatedTimestamp: time.Now().UTC(),
	}
	r.logicGates[key(companyID, item.LogicGateID)] = item
	r.ensureLogicGateKanbanBoardLocked(companyID, item.LogicGateID, item.Header)
	return item, nil
}

func (r *MemoryRepo) UpdateLogicGateHeader(companyID, logicGateID, header string) (domain.LogicGate, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(companyID, logicGateID)
	item, ok := r.logicGates[k]
	if !ok {
		return domain.LogicGate{}, ErrNotFound
	}
	item.Header = header
	r.logicGates[k] = item
	boardKeyValue := boardKey(companyID, LogicGateKanbanBoardID(logicGateID))
	if board, ok := r.kanbanBoards[boardKeyValue]; ok && board.LogicGateID != nil {
		board.Title = normalizeKanbanBoardTitle(board.BoardID, header)
		board.UpdatedTimestamp = time.Now().UTC()
		r.kanbanBoards[boardKeyValue] = board
	}
	return item, nil
}

func (r *MemoryRepo) ListLogicGates(companyID string) ([]domain.LogicGate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.LogicGate, 0)
	for _, gate := range r.logicGates {
		if gate.CompanyID == companyID {
			items = append(items, gate)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) GetLogicGate(companyID, logicGateID string) (domain.LogicGate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.logicGates[key(companyID, logicGateID)]
	if !ok {
		return domain.LogicGate{}, ErrNotFound
	}
	return item, nil
}

func (r *MemoryRepo) DeleteLogicGate(companyID, logicGateID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	k := key(companyID, logicGateID)
	if _, ok := r.logicGates[k]; !ok {
		return ErrNotFound
	}
	delete(r.logicGates, k)
	delete(r.logicGateInfo, k)
	delete(r.logicGateText, k)
	delete(r.folderItems, folderItemKey(companyID, "logic_gate", logicGateID))
	delete(r.logicMapPositions, k)
	boardID := LogicGateKanbanBoardID(logicGateID)
	delete(r.kanbanCards, boardKey(companyID, boardID))
	delete(r.kanbanColumns, boardKey(companyID, boardID))
	delete(r.kanbanBoards, boardKey(companyID, boardID))
	delete(r.folderItems, folderItemKey(companyID, "kanban", boardID))
	for operationKey, operation := range r.operations {
		if operation.CompanyID != companyID || operation.LogicGateID == nil || *operation.LogicGateID != logicGateID {
			continue
		}
		operation.LogicGateID = nil
		r.operations[operationKey] = operation
	}

	filtered := make([]domain.LogicGateRelationship, 0, len(r.logicGateRels[companyID]))
	for _, rel := range r.logicGateRels[companyID] {
		if rel.LogicGateIDA == logicGateID || rel.LogicGateIDB == logicGateID {
			continue
		}
		filtered = append(filtered, rel)
	}
	r.logicGateRels[companyID] = filtered
	return nil
}

func (r *MemoryRepo) ListLogicGateMapPositions(companyID string) ([]domain.LogicGateMapPosition, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]domain.LogicGateMapPosition, 0)
	for _, item := range r.logicMapPositions {
		if item.CompanyID == companyID {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].LogicGateID < items[j].LogicGateID
	})
	return items, nil
}

func (r *MemoryRepo) UpsertLogicGateMapPositions(companyID string, positions []domain.LogicGateMapPosition) ([]domain.LogicGateMapPosition, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	out := make([]domain.LogicGateMapPosition, 0, len(positions))
	for _, position := range positions {
		if _, ok := r.logicGates[key(companyID, position.LogicGateID)]; !ok {
			return nil, ErrNotFound
		}
		item := domain.LogicGateMapPosition{
			CompanyID:        companyID,
			LogicGateID:      position.LogicGateID,
			X:                position.X,
			Y:                position.Y,
			UpdatedTimestamp: now,
		}
		r.logicMapPositions[key(companyID, item.LogicGateID)] = item
		out = append(out, item)
	}
	return out, nil
}

func (r *MemoryRepo) ListLogicGateRelationships(companyID string) ([]domain.LogicGateRelationship, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := append([]domain.LogicGateRelationship{}, r.logicGateRels[companyID]...)
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) CreateLogicGateRelationship(companyID, logicGateIDA, logicGateIDB, aPosition, bPosition string) (domain.LogicGateRelationship, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.logicGates[key(companyID, logicGateIDA)]; !ok {
		return domain.LogicGateRelationship{}, ErrNotFound
	}
	if _, ok := r.logicGates[key(companyID, logicGateIDB)]; !ok {
		return domain.LogicGateRelationship{}, ErrNotFound
	}

	item := domain.LogicGateRelationship{
		CompanyID:               companyID,
		LogicGateRelationshipID: newUUIDv7String(),
		LogicGateIDA:            logicGateIDA,
		LogicGateIDB:            logicGateIDB,
		APosition:               aPosition,
		BPosition:               bPosition,
		CreatedTimestamp:        time.Now().UTC(),
	}
	r.logicGateRels[companyID] = append(r.logicGateRels[companyID], item)
	return item, nil
}

func (r *MemoryRepo) DeleteLogicGateRelationship(companyID, relationshipID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	items := r.logicGateRels[companyID]
	filtered := make([]domain.LogicGateRelationship, 0, len(items))
	deleted := false
	for _, item := range items {
		if item.LogicGateRelationshipID == relationshipID {
			deleted = true
			continue
		}
		filtered = append(filtered, item)
	}
	if !deleted {
		return ErrNotFound
	}
	r.logicGateRels[companyID] = filtered
	return nil
}

func (r *MemoryRepo) AddLogicGateInformation(companyID, logicGateID, infoType, information, informationID string) (domain.LogicGateInformation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return domain.LogicGateInformation{}, ErrNotFound
	}
	now := time.Now().UTC()
	item := domain.LogicGateInformation{
		CompanyID:        companyID,
		InformationID:    newUUIDv7String(),
		LogicGateID:      logicGateID,
		Type:             infoType,
		Information:      information,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	k := key(companyID, logicGateID)
	r.logicGateInfo[k] = append(r.logicGateInfo[k], item)
	sort.Slice(r.logicGateInfo[k], func(i, j int) bool {
		return r.logicGateInfo[k][i].CreatedTimestamp.Before(r.logicGateInfo[k][j].CreatedTimestamp)
	})

	// Keep one latest-value row per stable information_id while preserving every
	// save above as history. Clients/agents should reuse information_id for edits.
	projectionID := informationID
	if projectionID == "" {
		projectionID = item.InformationID
	}
	if r.logicGateText[k] == nil {
		r.logicGateText[k] = map[string]domain.LogicGateProjection{}
	}
	if isEditorTextBoxType(infoType) {
		// Logic gates keep the legacy one-document editor contract. The new
		// multi-block timeline/chat/email workspace is node-only.
		if existingTextKey := newestLogicGateTextProjectionKey(r.logicGateText[k]); existingTextKey != "" {
			projectionID = existingTextKey
			for keyValue, projection := range r.logicGateText[k] {
				if keyValue != projectionID && isEditorTextBoxType(projection.Type) {
					delete(r.logicGateText[k], keyValue)
				}
			}
		}
	}
	created := item.CreatedTimestamp
	if existing, ok := r.logicGateText[k][projectionID]; ok {
		created = existing.CreatedTimestamp
	}
	r.logicGateText[k][projectionID] = domain.LogicGateProjection{
		CompanyID:        companyID,
		LogicGateID:      logicGateID,
		Type:             infoType,
		Information:      information,
		InformationID:    projectionID,
		CreatedTimestamp: created,
		UpdatedTimestamp: item.UpdatedTimestamp,
	}
	return item, nil
}

func (r *MemoryRepo) ListLogicGateProjections(companyID, logicGateID string) ([]domain.LogicGateProjection, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return nil, ErrNotFound
	}
	items := make([]domain.LogicGateProjection, 0)
	latestTextKey := newestLogicGateTextProjectionKey(r.logicGateText[key(companyID, logicGateID)])
	for projectionID, item := range r.logicGateText[key(companyID, logicGateID)] {
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

func (r *MemoryRepo) DeleteLogicGateProjection(companyID, logicGateID, informationID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return ErrNotFound
	}
	delete(r.logicGateText[key(companyID, logicGateID)], informationID)
	return nil
}

func (r *MemoryRepo) GetLogicGateDetails(companyID, logicGateID string) (domain.LogicGateDetails, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	logicGate, ok := r.logicGates[key(companyID, logicGateID)]
	if !ok {
		return domain.LogicGateDetails{}, ErrNotFound
	}

	info := append([]domain.LogicGateInformation{}, r.logicGateInfo[key(companyID, logicGateID)]...)
	sort.Slice(info, func(i, j int) bool {
		return info[i].CreatedTimestamp.Before(info[j].CreatedTimestamp)
	})

	relationships := make([]domain.LogicGateRelationship, 0)
	for _, rel := range r.logicGateRels[companyID] {
		if rel.LogicGateIDA == logicGateID || rel.LogicGateIDB == logicGateID {
			relationships = append(relationships, rel)
		}
	}
	sort.Slice(relationships, func(i, j int) bool {
		return relationships[i].CreatedTimestamp.Before(relationships[j].CreatedTimestamp)
	})

	return domain.LogicGateDetails{
		LogicGate:     logicGate,
		Information:   info,
		Relationships: relationships,
	}, nil
}
