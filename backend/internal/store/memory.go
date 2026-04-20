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
	CreateNode(companyID, header string) (domain.Node, error)
	ListNodes(companyID string) ([]domain.Node, error)
	GetNode(companyID, nodeID string) (domain.Node, error)
	DeleteNode(companyID, nodeID string) error
	GetNodeDetails(companyID, nodeID string) (domain.NodeDetails, error)
	AddNodeInformation(companyID, nodeID, infoType, information string) (domain.NodeInformation, error)
	CreateNodeRelationship(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, error)
	CreateLogicGate(companyID, header string) (domain.LogicGate, error)
	CreateOperation(in CreateOperationInput) (domain.Operation, error)
	GetOperation(companyID, operationID string) (domain.Operation, error)
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
	mu         sync.RWMutex
	nodes      map[string]domain.Node
	nodeInfo   map[string][]domain.NodeInformation
	nodeRels   map[string][]domain.NodeRelationship
	logicGates map[string]domain.LogicGate
	operations map[string]domain.Operation
}

func NewMemoryRepo() *MemoryRepo {
	return &MemoryRepo{
		nodes:      map[string]domain.Node{},
		nodeInfo:   map[string][]domain.NodeInformation{},
		nodeRels:   map[string][]domain.NodeRelationship{},
		logicGates: map[string]domain.LogicGate{},
		operations: map[string]domain.Operation{},
	}
}

func key(companyID, id string) string {
	return companyID + ":" + id
}

func (r *MemoryRepo) CreateNode(companyID, header string) (domain.Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	n := domain.Node{
		CompanyID:        companyID,
		NodeID:           newUUIDv7String(),
		Header:           header,
		CreatedTimestamp: time.Now().UTC(),
	}
	r.nodes[key(companyID, n.NodeID)] = n
	return n, nil
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

func (r *MemoryRepo) DeleteNode(companyID, nodeID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	k := key(companyID, nodeID)
	if _, ok := r.nodes[k]; !ok {
		return ErrNotFound
	}

	delete(r.nodes, k)
	delete(r.nodeInfo, k)

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

func (r *MemoryRepo) AddNodeInformation(companyID, nodeID, infoType, information string) (domain.NodeInformation, error) {
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
	return item, nil
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
