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
	GetNode(companyID, nodeID string) (domain.Node, error)
	AddNodeInformation(companyID, nodeID, infoType, information string) (domain.NodeInformation, error)
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
	logicGates map[string]domain.LogicGate
	operations map[string]domain.Operation
}

func NewMemoryRepo() *MemoryRepo {
	return &MemoryRepo{
		nodes:      map[string]domain.Node{},
		nodeInfo:   map[string][]domain.NodeInformation{},
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

func (r *MemoryRepo) GetNode(companyID, nodeID string) (domain.Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	n, ok := r.nodes[key(companyID, nodeID)]
	if !ok {
		return domain.Node{}, ErrNotFound
	}
	return n, nil
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
