package store

import "miraeopus/backend/internal/domain"

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
