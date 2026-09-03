package store

import (
	"strings"
)

func NormalizeLogicGateNodeAssignmentInput(input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.LogicGateID = strings.TrimSpace(input.LogicGateID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.Status = NormalizeLogicGateAssignmentStatusTitle(input.Status)
	input.ProcessStepID = normalizeOptionalStringPointer(input.ProcessStepID)
	input.MutationOrigin = NormalizeMutationOrigin(input.MutationOrigin)
	input.NodeTitle = strings.TrimSpace(input.NodeTitle)
	input.CreateNodeTitle = strings.TrimSpace(input.CreateNodeTitle)
	input.DescriptionSnapshot = strings.TrimSpace(input.DescriptionSnapshot)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)

	if input.CompanyID == "" || input.LogicGateID == "" || input.NodeID == "" {
		return LogicGateNodeAssignmentInput{}, ErrInvalid
	}
	if input.PrioritySet && input.Priority != nil && (*input.Priority < 1 || *input.Priority > 5) {
		return LogicGateNodeAssignmentInput{}, ErrInvalid
	}
	return input, nil
}

func NormalizeLogicGateNodeAssignmentMoveInput(input LogicGateNodeAssignmentMoveInput) (LogicGateNodeAssignmentMoveInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.LogicGateID = strings.TrimSpace(input.LogicGateID)
	input.FromLogicGateID = strings.TrimSpace(input.FromLogicGateID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.Status = NormalizeLogicGateAssignmentStatusTitle(input.Status)
	input.ProcessStepID = normalizeOptionalStringPointer(input.ProcessStepID)
	input.MutationOrigin = NormalizeMutationOrigin(input.MutationOrigin)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)

	if input.CompanyID == "" || input.LogicGateID == "" || input.NodeID == "" {
		return LogicGateNodeAssignmentMoveInput{}, ErrInvalid
	}
	if input.PrioritySet && input.Priority != nil && (*input.Priority < 1 || *input.Priority > 5) {
		return LogicGateNodeAssignmentMoveInput{}, ErrInvalid
	}
	return input, nil
}

func NormalizeLogicGateNodeAssignmentRemoveInput(input LogicGateNodeAssignmentRemoveInput) (LogicGateNodeAssignmentRemoveInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.LogicGateID = strings.TrimSpace(input.LogicGateID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.FallbackStatus = normalizeOptionalStringPointer(input.FallbackStatus)
	if input.FallbackStatus != nil {
		status, err := normalizeNodeStatusForAssignment(input.FallbackStatus, false)
		if err != nil {
			return LogicGateNodeAssignmentRemoveInput{}, err
		}
		input.FallbackStatus = status
	}
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.CompanyID == "" || input.NodeID == "" {
		return LogicGateNodeAssignmentRemoveInput{}, ErrInvalid
	}
	return input, nil
}

func NormalizeLogicGateNodeAssignmentIssueInput(input LogicGateNodeAssignmentIssueInput) (LogicGateNodeAssignmentIssueInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.LogicGateID = strings.TrimSpace(input.LogicGateID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.CompanyID == "" || input.NodeID == "" {
		return LogicGateNodeAssignmentIssueInput{}, ErrInvalid
	}
	return input, nil
}

func NormalizeRACIMatrixNodeCreateInput(input RACIMatrixNodeCreateInput) (RACIMatrixNodeCreateInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.Title = strings.TrimSpace(input.Title)
	input.LogicGateID = strings.TrimSpace(input.LogicGateID)
	input.CreateLogicGateHeader = strings.TrimSpace(input.CreateLogicGateHeader)
	input.MutationOrigin = NormalizeMutationOrigin(input.MutationOrigin)
	input.Status = NormalizeLogicGateAssignmentStatusTitle(input.Status)
	input.ProcessStepID = normalizeOptionalStringPointer(input.ProcessStepID)
	input.DescriptionSnapshot = strings.TrimSpace(input.DescriptionSnapshot)
	input.CreatorLogicGateRACIRole = strings.TrimSpace(input.CreatorLogicGateRACIRole)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.NodeID == "" {
		input.NodeID = newUUIDv7String()
	}
	if input.CompanyID == "" || input.NodeID == "" || input.Title == "" {
		return RACIMatrixNodeCreateInput{}, ErrInvalid
	}
	if input.LogicGateID != "" && input.CreateLogicGateHeader != "" {
		return RACIMatrixNodeCreateInput{}, ErrInvalid
	}
	if input.CreatorLogicGateRACIRole != "" {
		role, ok := NormalizeRACIRole(input.CreatorLogicGateRACIRole)
		if !ok {
			return RACIMatrixNodeCreateInput{}, ErrInvalid
		}
		input.CreatorLogicGateRACIRole = role
	}
	if input.PrioritySet && input.Priority != nil && (*input.Priority < 1 || *input.Priority > 5) {
		return RACIMatrixNodeCreateInput{}, ErrInvalid
	}
	return input, nil
}

func normalizeOptionalStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func NormalizeLogicGateAssignmentStatusTitle(status string) string {
	switch logicGateAssignmentStatusKey(status) {
	case "":
		return ""
	case "requested", "request", "requests", "r":
		return "Requested"
	case "backlog", "backlogs", "b":
		return "Backlogs"
	case "pending", "p":
		return "Pending"
	case "in progress", "inprogress", "ip":
		return "In Progress"
	case "review":
		return "Review"
	case "done", "d":
		return "Done"
	default:
		return strings.TrimSpace(status)
	}
}

func logicGateAssignmentStatusKey(status string) string {
	status = strings.ToLower(strings.TrimSpace(status))
	status = strings.ReplaceAll(status, "_", " ")
	status = strings.ReplaceAll(status, "-", " ")
	return strings.Join(strings.Fields(status), " ")
}
