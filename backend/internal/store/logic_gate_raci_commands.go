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

func logicGateRaciChangedUserIDs(before, after []domain.LogicGateRaciAssignment) []string {
	beforeRoles := highestLogicGateRaciRolesByUser(before)
	afterRoles := highestLogicGateRaciRolesByUser(after)
	out := make([]string, 0, len(afterRoles))
	seen := map[string]bool{}
	for _, assignment := range after {
		userID := strings.TrimSpace(assignment.UserID)
		role := afterRoles[userID]
		if role == "" || beforeRoles[userID] == role {
			continue
		}
		if seen[userID] {
			continue
		}
		seen[userID] = true
		out = append(out, userID)
	}
	return out
}

func highestLogicGateRaciRolesByUser(assignments []domain.LogicGateRaciAssignment) map[string]string {
	out := map[string]string{}
	for _, assignment := range assignments {
		userID := strings.TrimSpace(assignment.UserID)
		role, ok := NormalizeLogicGateRaciRole(assignment.Role)
		if !ok || userID == "" {
			continue
		}
		if logicGateRaciRoleRank(role) > logicGateRaciRoleRank(out[userID]) {
			out[userID] = role
		}
	}
	return out
}

func logicGateRaciRoleRank(role string) int {
	switch strings.TrimSpace(role) {
	case domain.LogicGateRaciRoleResponsible:
		return 4
	case domain.LogicGateRaciRoleAccountable:
		return 3
	case domain.LogicGateRaciRoleConsulted:
		return 2
	case domain.LogicGateRaciRoleInformed:
		return 1
	default:
		return 0
	}
}

func logicGateRaciUpdatedWorkspaceEventInput(result LogicGateRaciAssignmentCommandResult, commandAssignments []normalizedLogicGateRaciCommandAssignment, input LogicGateRaciAssignmentCommandInput) DomainEventInput {
	payload := map[string]any{
		"logic_gate_id":       result.LogicGateID,
		"raci_assignments":    result.RaciAssignments,
		"operation":           result.Operation,
		"command_assignments": logicGateRaciCommandAssignmentPayload(commandAssignments),
		"assignment_user_ids": logicGateRaciChangedUserIDs(result.BeforeAssignments, result.RaciAssignments),
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
