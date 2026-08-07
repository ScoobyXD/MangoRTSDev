package store

import "miraeopus/backend/internal/domain"

func (r *MemoryRepo) AddLogicGateRACIAssignments(input LogicGateRACIAssignmentCommandInput) (LogicGateRACIAssignmentCommandResult, error) {
	return r.applyLogicGateRACIAssignmentCommand(input, LogicGateRACICommandAdd)
}

func (r *MemoryRepo) RemoveLogicGateRACIAssignments(input LogicGateRACIAssignmentCommandInput) (LogicGateRACIAssignmentCommandResult, error) {
	return r.applyLogicGateRACIAssignmentCommand(input, LogicGateRACICommandRemove)
}

func (r *MemoryRepo) applyLogicGateRACIAssignmentCommand(input LogicGateRACIAssignmentCommandInput, operation string) (LogicGateRACIAssignmentCommandResult, error) {
	current, err := r.GetResourceRACIPolicy(input.CompanyID, EntityTypeLogicGate, input.LogicGateID)
	if err != nil {
		return LogicGateRACIAssignmentCommandResult{}, err
	}
	assignments := make([]ResourceRACIAssignmentInput, 0, len(input.Assignments))
	for _, item := range input.Assignments {
		normalized, err := normalizeLogicGateRACIAssignmentInput(item)
		if err != nil {
			return LogicGateRACIAssignmentCommandResult{}, err
		}
		assignments = append(assignments, ResourceRACIAssignmentInput{Role: normalized.role, PrincipalType: normalized.principalType, PrincipalID: normalized.principalID})
	}
	command := ResourceRACIAssignmentCommandInput{
		CompanyID: input.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: input.LogicGateID,
		Assignments: assignments, ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey,
	}
	var mutation ResourceRACIAssignmentMutationResult
	switch operation {
	case LogicGateRACICommandAdd:
		mutation, err = r.AddResourceRACIAssignments(command)
	case LogicGateRACICommandRemove:
		mutation, err = r.RemoveResourceRACIAssignments(command)
	default:
		return LogicGateRACIAssignmentCommandResult{}, ErrInvalid
	}
	if err != nil {
		return LogicGateRACIAssignmentCommandResult{}, err
	}
	return LogicGateRACIAssignmentCommandResult{
		CompanyID: mutation.CompanyID, LogicGateID: mutation.ResourceID, Operation: operation, Changed: mutation.Changed,
		BeforeAssignments: logicGateRACIAssignmentsFromResources(current.RACIAssignments),
		RACIAssignments:   logicGateRACIAssignmentsFromResources(mutation.RACIAssignments), Events: append([]domain.DomainEvent{}, mutation.Events...),
	}, nil
}
