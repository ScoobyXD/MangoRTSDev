package store

import "miraeopus/backend/internal/domain"

func normalizeLogicGateCommandResourceAssignments(inputs []LogicGateGVICAssignmentInput) ([]ResourceGVICAssignmentInput, error) {
	items := make([]ResourceGVICAssignmentInput, 0, len(inputs))
	for _, input := range inputs {
		normalized, err := normalizeLogicGateGVICAssignmentInput(input)
		if err != nil {
			return nil, err
		}
		items = append(items, ResourceGVICAssignmentInput{Role: normalized.role, PrincipalType: normalized.principalType, PrincipalID: normalized.principalID})
	}
	return items, nil
}

func (r *PostgresRepo) AddLogicGateGVICAssignments(input LogicGateGVICAssignmentCommandInput) (LogicGateGVICAssignmentCommandResult, error) {
	return r.applyV2LogicGateGVICAssignmentCommand(input, LogicGateGVICCommandAdd)
}

func (r *PostgresRepo) RemoveLogicGateGVICAssignments(input LogicGateGVICAssignmentCommandInput) (LogicGateGVICAssignmentCommandResult, error) {
	return r.applyV2LogicGateGVICAssignmentCommand(input, LogicGateGVICCommandRemove)
}

func (r *PostgresRepo) applyV2LogicGateGVICAssignmentCommand(input LogicGateGVICAssignmentCommandInput, operation string) (LogicGateGVICAssignmentCommandResult, error) {
	assignments, err := normalizeLogicGateCommandResourceAssignments(input.Assignments)
	if err != nil {
		return LogicGateGVICAssignmentCommandResult{}, err
	}
	beforePolicy, err := r.GetResourceGVICPolicy(input.CompanyID, EntityTypeLogicGate, input.LogicGateID)
	if err != nil {
		return LogicGateGVICAssignmentCommandResult{}, err
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
		CompanyID: input.CompanyID, LogicGateID: input.LogicGateID, Operation: operation, Changed: mutation.Changed,
		BeforeAssignments: logicGateGVICAssignmentsFromResources(beforePolicy.GVICAssignments),
		GVICAssignments:   logicGateGVICAssignmentsFromResources(mutation.GVICAssignments),
		Events:            append([]domain.DomainEvent{}, mutation.Events...),
	}, nil
}
