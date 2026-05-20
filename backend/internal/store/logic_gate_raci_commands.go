package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const LogicGateRaciUpdatedEventType = "logic_gate_raci_updated"

type normalizedLogicGateRaciCommandAssignment struct {
	role   string
	userID string
}

func normalizeLogicGateRaciCommandAssignments(assignments []LogicGateRaciAssignmentInput) ([]normalizedLogicGateRaciCommandAssignment, error) {
	if len(assignments) == 0 {
		return nil, ErrInvalid
	}
	seen := map[string]bool{}
	out := make([]normalizedLogicGateRaciCommandAssignment, 0, len(assignments))
	for _, assignment := range assignments {
		role, ok := NormalizeLogicGateRaciRole(assignment.Role)
		userID := strings.TrimSpace(assignment.UserID)
		if !ok || userID == "" {
			return nil, ErrInvalid
		}
		key := role + ":" + userID
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, normalizedLogicGateRaciCommandAssignment{role: role, userID: userID})
	}
	if len(out) == 0 {
		return nil, ErrInvalid
	}
	return out, nil
}

func cloneLogicGateRaciAssignments(items []domain.LogicGateRaciAssignment) []domain.LogicGateRaciAssignment {
	if len(items) == 0 {
		return []domain.LogicGateRaciAssignment{}
	}
	out := append([]domain.LogicGateRaciAssignment{}, items...)
	return out
}

func logicGateRaciCommandAssignmentPayload(assignments []normalizedLogicGateRaciCommandAssignment) []map[string]string {
	out := make([]map[string]string, 0, len(assignments))
	for _, assignment := range assignments {
		out = append(out, map[string]string{"role": assignment.role, "user_id": assignment.userID})
	}
	return out
}

func logicGateRaciUpdatedWorkspaceEventInput(result LogicGateRaciAssignmentCommandResult, commandAssignments []normalizedLogicGateRaciCommandAssignment, input LogicGateRaciAssignmentCommandInput) DomainEventInput {
	payload := map[string]any{
		"logic_gate_id":       result.LogicGateID,
		"raci_assignments":    result.RaciAssignments,
		"operation":           result.Operation,
		"command_assignments": logicGateRaciCommandAssignmentPayload(commandAssignments),
	}
	actorUserID := strings.TrimSpace(input.ActorUserID)
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	if actorUserID != "" {
		payload["actor_user_id"] = actorUserID
	}
	if idempotencyKey != "" {
		payload["idempotency_key"] = idempotencyKey
	}
	return DomainEventInput{
		CompanyID:   result.CompanyID,
		StreamType:  workspaceDomainStreamType,
		StreamID:    result.CompanyID,
		Type:        LogicGateRaciUpdatedEventType,
		ActorUserID: actorUserID,
		Payload:     payload,
	}
}
