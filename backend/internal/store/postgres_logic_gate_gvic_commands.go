package store

import "miraeopus/backend/internal/domain"

func normalizeLogicGateCommandResourceAssignments(inputs []LogicGateRACIAssignmentInput) ([]ResourceRACIAssignmentInput, error) {
	items := make([]ResourceRACIAssignmentInput, 0, len(inputs))
	for _, input := range inputs {
		normalized, err := normalizeLogicGateRACIAssignmentInput(input)
		if err != nil {
			return nil, err
		}
		items = append(items, ResourceRACIAssignmentInput{Role: normalized.role, PrincipalType: normalized.principalType, PrincipalID: normalized.principalID})
	}
	return items, nil
}

func (r *PostgresRepo) AddLogicGateRACIAssignments(input LogicGateRACIAssignmentCommandInput) (LogicGateRACIAssignmentCommandResult, error) {
	return r.applyV2LogicGateRACIAssignmentCommand(input, LogicGateRACICommandAdd)
}

func (r *PostgresRepo) RemoveLogicGateRACIAssignments(input LogicGateRACIAssignmentCommandInput) (LogicGateRACIAssignmentCommandResult, error) {
	return r.applyV2LogicGateRACIAssignmentCommand(input, LogicGateRACICommandRemove)
}

func (r *PostgresRepo) applyV2LogicGateRACIAssignmentCommand(input LogicGateRACIAssignmentCommandInput, operation string) (LogicGateRACIAssignmentCommandResult, error) {
	assignments, err := normalizeLogicGateCommandResourceAssignments(input.Assignments)
	if err != nil {
		return LogicGateRACIAssignmentCommandResult{}, err
	}
	beforePolicy, err := r.GetResourceRACIPolicy(input.CompanyID, EntityTypeLogicGate, input.LogicGateID)
	if err != nil {
		return LogicGateRACIAssignmentCommandResult{}, err
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
		CompanyID: input.CompanyID, LogicGateID: input.LogicGateID, Operation: operation, Changed: mutation.Changed,
		BeforeAssignments: logicGateRACIAssignmentsFromResources(beforePolicy.RACIAssignments),
		RACIAssignments:   logicGateRACIAssignmentsFromResources(mutation.RACIAssignments),
		Events:            append([]domain.DomainEvent{}, mutation.Events...),
	}, nil
}
