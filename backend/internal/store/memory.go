package store

import (
	"errors"
	"sort"
	"sync"
	"time"

	"miraeopus/backend/internal/domain"
)

var ErrNotFound = errors.New("not found")

type Repository interface {
	CreateNode(companyID, title string) (domain.Node, error)
	UpdateNodeTitle(companyID, nodeID, title string) (domain.Node, error)
	ListNodes(companyID string) ([]domain.Node, error)
	ListNodeRelationships(companyID string) ([]domain.NodeRelationship, error)
	DeleteNodeRelationship(companyID, relationshipID string) error
	GetNode(companyID, nodeID string) (domain.Node, error)
	DeleteNode(companyID, nodeID string) error
	GetNodeDetails(companyID, nodeID string) (domain.NodeDetails, error)
	AddNodeInformation(companyID, nodeID, infoType, information, informationID string) (domain.NodeInformation, error)
	ListNodeProjections(companyID, nodeID string) ([]domain.NodeProjection, error)
	CreateNodeRelationship(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, error)
	CreateLogicGate(companyID, header string) (domain.LogicGate, error)
	UpdateLogicGateHeader(companyID, logicGateID, header string) (domain.LogicGate, error)
	ListLogicGates(companyID string) ([]domain.LogicGate, error)
	ListLogicGateRelationships(companyID string) ([]domain.LogicGateRelationship, error)
	DeleteLogicGateRelationship(companyID, relationshipID string) error
	GetLogicGate(companyID, logicGateID string) (domain.LogicGate, error)
	DeleteLogicGate(companyID, logicGateID string) error
	GetLogicGateDetails(companyID, logicGateID string) (domain.LogicGateDetails, error)
	AddLogicGateInformation(companyID, logicGateID, infoType, information, informationID string) (domain.LogicGateInformation, error)
	ListLogicGateProjections(companyID, logicGateID string) ([]domain.LogicGateProjection, error)
	CreateLogicGateRelationship(companyID, logicGateIDA, logicGateIDB, aPosition, bPosition string) (domain.LogicGateRelationship, error)
	ListNodeMapPositions(companyID string) ([]domain.NodeMapPosition, error)
	UpsertNodeMapPositions(companyID string, positions []domain.NodeMapPosition) ([]domain.NodeMapPosition, error)
	ListLogicGateMapPositions(companyID string) ([]domain.LogicGateMapPosition, error)
	UpsertLogicGateMapPositions(companyID string, positions []domain.LogicGateMapPosition) ([]domain.LogicGateMapPosition, error)
	CreateOperation(in CreateOperationInput) (domain.Operation, error)
	GetOperation(companyID, operationID string) (domain.Operation, error)
	AppendWorkspaceContextEvent(event domain.WorkspaceContextEvent) (domain.WorkspaceContextProjection, error)
	GetWorkspaceContextProjection(companyID, workspaceID, contextID string) (domain.WorkspaceContextProjection, error)
	ListWorkspaceContextEventsAfterSequence(companyID, workspaceID, contextID string, afterSequence int64, limit int) ([]domain.WorkspaceContextEvent, error)
}

type CreateOperationInput struct {
	CompanyID      string
	NodeID         *string
	LogicGateID    *string
	Status         string
	StartTimestamp time.Time
	EndTimestamp   *time.Time
}

type MemoryRepo struct {
	mu                 sync.RWMutex
	nodes              map[string]domain.Node
	nodeInfo           map[string][]domain.NodeInformation
	nodeText           map[string]map[string]domain.NodeProjection
	nodeRels           map[string][]domain.NodeRelationship
	logicGates         map[string]domain.LogicGate
	logicGateInfo      map[string][]domain.LogicGateInformation
	logicGateText      map[string]map[string]domain.LogicGateProjection
	logicGateRels      map[string][]domain.LogicGateRelationship
	nodeMapPositions   map[string]domain.NodeMapPosition
	logicMapPositions  map[string]domain.LogicGateMapPosition
	operations         map[string]domain.Operation
	contextEvents      map[string][]domain.WorkspaceContextEvent
	contextProjections map[string]domain.WorkspaceContextProjection
}

func NewMemoryRepo() *MemoryRepo {
	return &MemoryRepo{
		nodes:              map[string]domain.Node{},
		nodeInfo:           map[string][]domain.NodeInformation{},
		nodeText:           map[string]map[string]domain.NodeProjection{},
		nodeRels:           map[string][]domain.NodeRelationship{},
		logicGates:         map[string]domain.LogicGate{},
		logicGateInfo:      map[string][]domain.LogicGateInformation{},
		logicGateText:      map[string]map[string]domain.LogicGateProjection{},
		logicGateRels:      map[string][]domain.LogicGateRelationship{},
		nodeMapPositions:   map[string]domain.NodeMapPosition{},
		logicMapPositions:  map[string]domain.LogicGateMapPosition{},
		operations:         map[string]domain.Operation{},
		contextEvents:      map[string][]domain.WorkspaceContextEvent{},
		contextProjections: map[string]domain.WorkspaceContextProjection{},
	}
}

func key(companyID, id string) string {
	return companyID + ":" + id
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

func (r *MemoryRepo) UpdateNodeTitle(companyID, nodeID, title string) (domain.Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := companyID + ":" + nodeID
	node, ok := r.nodes[key]
	if !ok {
		return domain.Node{}, ErrNotFound
	}
	node.Title = title
	r.nodes[key] = node
	return node, nil
}

func (r *MemoryRepo) ListNodes(companyID string) ([]domain.Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.Node, 0)
	for _, node := range r.nodes {
		if node.CompanyID == companyID {
			items = append(items, node)
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
	return n, nil
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
	delete(r.nodeMapPositions, k)

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
		return items[i].UpdatedTimestamp.Before(items[j].UpdatedTimestamp)
	})
	return items, nil
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

func workspaceContextKey(companyID, workspaceID, contextID string) string {
	return companyID + ":" + workspaceID + ":" + contextID
}

func (r *MemoryRepo) AppendWorkspaceContextEvent(event domain.WorkspaceContextEvent) (domain.WorkspaceContextProjection, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	event.CreatedAt = now
	k := workspaceContextKey(event.CompanyID, event.WorkspaceID, event.ContextID)
	r.contextEvents[k] = append(r.contextEvents[k], event)
	current := r.contextProjections[k]
	if event.Sequence >= current.LastSequence {
		current.CompanyID = event.CompanyID
		current.WorkspaceID = event.WorkspaceID
		current.ContextID = event.ContextID
		current.LastSequence = event.Sequence
		current.LastEventAt = event.CreatedAt
		current.LastPayloadJSON = event.PayloadJSON
		current.UpdatedTimestamp = now
		r.contextProjections[k] = current
	}
	return r.contextProjections[k], nil
}

func (r *MemoryRepo) GetWorkspaceContextProjection(companyID, workspaceID, contextID string) (domain.WorkspaceContextProjection, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.contextProjections[workspaceContextKey(companyID, workspaceID, contextID)]
	if !ok {
		return domain.WorkspaceContextProjection{}, ErrNotFound
	}
	return item, nil
}

func (r *MemoryRepo) ListWorkspaceContextEventsAfterSequence(companyID, workspaceID, contextID string, afterSequence int64, limit int) ([]domain.WorkspaceContextEvent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	k := workspaceContextKey(companyID, workspaceID, contextID)
	source := r.contextEvents[k]
	if len(source) == 0 {
		return []domain.WorkspaceContextEvent{}, nil
	}
	if limit <= 0 {
		limit = 250
	}
	out := make([]domain.WorkspaceContextEvent, 0, min(limit, len(source)))
	for _, item := range source {
		if item.Sequence <= afterSequence {
			continue
		}
		out = append(out, item)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
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
	delete(r.logicMapPositions, k)

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
	for _, item := range r.logicGateText[key(companyID, logicGateID)] {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedTimestamp.Before(items[j].UpdatedTimestamp)
	})
	return items, nil
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

func (r *MemoryRepo) CreateOperation(in CreateOperationInput) (domain.Operation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if in.NodeID != nil {
		if _, ok := r.nodes[key(in.CompanyID, *in.NodeID)]; !ok {
			return domain.Operation{}, ErrNotFound
		}
	}
	if in.LogicGateID != nil {
		if _, ok := r.logicGates[key(in.CompanyID, *in.LogicGateID)]; !ok {
			return domain.Operation{}, ErrNotFound
		}
	}

	item := domain.Operation{
		CompanyID:      in.CompanyID,
		OperationID:    newUUIDv7String(),
		NodeID:         in.NodeID,
		LogicGateID:    in.LogicGateID,
		Status:         in.Status,
		StartTimestamp: in.StartTimestamp,
		EndTimestamp:   in.EndTimestamp,
	}
	r.operations[key(in.CompanyID, item.OperationID)] = item
	return item, nil
}

func (r *MemoryRepo) GetOperation(companyID, operationID string) (domain.Operation, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	item, ok := r.operations[key(companyID, operationID)]
	if !ok {
		return domain.Operation{}, ErrNotFound
	}
	return item, nil
}
