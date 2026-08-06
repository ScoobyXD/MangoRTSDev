package store

import "miraeopus/backend/internal/domain"

func (r *MemoryRepo) AddLogicGateGVICAssignments(input LogicGateGVICAssignmentCommandInput) (LogicGateGVICAssignmentCommandResult, error) {
	return r.applyLogicGateGVICAssignmentCommand(input, LogicGateGVICCommandAdd)
}

func (r *MemoryRepo) RemoveLogicGateGVICAssignments(input LogicGateGVICAssignmentCommandInput) (LogicGateGVICAssignmentCommandResult, error) {
	return r.applyLogicGateGVICAssignmentCommand(input, LogicGateGVICCommandRemove)
}

func (r *MemoryRepo) applyLogicGateGVICAssignmentCommand(input LogicGateGVICAssignmentCommandInput, operation string) (LogicGateGVICAssignmentCommandResult, error) {
	current, err := r.GetResourceGVICPolicy(input.CompanyID, EntityTypeLogicGate, input.LogicGateID)
	if err != nil {
		return LogicGateGVICAssignmentCommandResult{}, err
	}
	assignments := make([]ResourceGVICAssignmentInput, 0, len(input.Assignments))
	for _, item := range input.Assignments {
		normalized, err := normalizeLogicGateGVICAssignmentInput(item)
		if err != nil {
			return LogicGateGVICAssignmentCommandResult{}, err
		}
		assignments = append(assignments, ResourceGVICAssignmentInput{Role: normalized.role, PrincipalType: normalized.principalType, PrincipalID: normalized.principalID})
	}
	command := ResourceGVICAssignmentCommandInput{
		CompanyID: input.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: input.LogicGateID,
		Assignments: assignments, ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey,
	}
	var mutation ResourceGVICAssignmentMutationResult
	switch operation {
	case LogicGateGVICCommandAdd:
		mutation, err = r.AddResourceGVICAssignments(command)
	case LogicGateGVICCommandRemove:
		mutation, err = r.RemoveResourceGVICAssignments(command)
	default:
		return LogicGateGVICAssignmentCommandResult{}, ErrInvalid
	}
	if err != nil {
		return LogicGateGVICAssignmentCommandResult{}, err
	}
	return LogicGateGVICAssignmentCommandResult{
		CompanyID: mutation.CompanyID, LogicGateID: mutation.ResourceID, Operation: operation, Changed: mutation.Changed,
		BeforeAssignments: logicGateGVICAssignmentsFromResources(current.GVICAssignments),
		GVICAssignments:   logicGateGVICAssignmentsFromResources(mutation.GVICAssignments), Events: append([]domain.DomainEvent{}, mutation.Events...),
	}, nil
}
