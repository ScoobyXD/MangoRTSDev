package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const LogicGateGVICUpdatedEventType = "logic_gate_gvic_updated"

type normalizedLogicGateGVICCommandAssignment struct {
	role          string
	principalType string
	principalID   string
	userID        string
}

func normalizeLogicGateGVICAssignmentInput(assignment LogicGateGVICAssignmentInput) (normalizedLogicGateGVICCommandAssignment, error) {
	role, ok := NormalizeGVICRole(assignment.Role)
	principalType := strings.ToLower(strings.TrimSpace(assignment.PrincipalType))
	principalID := strings.TrimSpace(assignment.PrincipalID)
	userID := strings.TrimSpace(assignment.UserID)
	if principalType == "" && userID != "" {
		principalType = EntityPermissionSubjectUser
		principalID = userID
	}
	if principalType == EntityPermissionSubjectUser && principalID == "" {
		principalID = userID
	}
	if !ok || principalID == "" {
		return normalizedLogicGateGVICCommandAssignment{}, ErrInvalid
	}
	switch principalType {
	case EntityPermissionSubjectUser:
		if userID == "" {
			userID = principalID
		}
	case EntityPermissionSubjectGroup:
		userID = ""
	default:
		return normalizedLogicGateGVICCommandAssignment{}, ErrInvalid
	}
	return normalizedLogicGateGVICCommandAssignment{
		role:          role,
		principalType: principalType,
		principalID:   principalID,
		userID:        userID,
	}, nil
}

func normalizeLogicGateGVICCommandAssignments(assignments []LogicGateGVICAssignmentInput) ([]normalizedLogicGateGVICCommandAssignment, error) {
	if len(assignments) == 0 {
		return nil, ErrInvalid
	}
	seen := map[string]bool{}
	out := make([]normalizedLogicGateGVICCommandAssignment, 0, len(assignments))
	for _, assignment := range assignments {
		normalized, err := normalizeLogicGateGVICAssignmentInput(assignment)
		if err != nil {
			return nil, err
		}
		key := normalized.role + ":" + normalized.principalType + ":" + normalized.principalID
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, normalized)
	}
	if len(out) == 0 {
		return nil, ErrInvalid
	}
	return out, nil
}

func cloneLogicGateGVICAssignments(items []domain.LogicGateGVICAssignment) []domain.LogicGateGVICAssignment {
	if len(items) == 0 {
		return []domain.LogicGateGVICAssignment{}
	}
	out := append([]domain.LogicGateGVICAssignment{}, items...)
	return out
}

func logicGateGVICCommandAssignmentPayload(assignments []normalizedLogicGateGVICCommandAssignment) []map[string]string {
	out := make([]map[string]string, 0, len(assignments))
	for _, assignment := range assignments {
		payload := map[string]string{
			"role":           assignment.role,
			"principal_type": assignment.principalType,
			"principal_id":   assignment.principalID,
		}
		if assignment.principalType == EntityPermissionSubjectUser {
			payload["user_id"] = assignment.principalID
		}
		out = append(out, payload)
	}
	return out
}

func logicGateGVICChangedUserIDs(before, after []domain.LogicGateGVICAssignment) []string {
	beforeRoles := highestLogicGateGVICRolesByUser(before)
	afterRoles := highestLogicGateGVICRolesByUser(after)
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

func highestLogicGateGVICRolesByUser(assignments []domain.LogicGateGVICAssignment) map[string]string {
	out := map[string]string{}
	for _, assignment := range assignments {
		userID := strings.TrimSpace(assignment.UserID)
		role, ok := NormalizeGVICRole(assignment.Role)
		if !ok || userID == "" {
			continue
		}
		if logicGateGVICRoleRank(role) > logicGateGVICRoleRank(out[userID]) {
			out[userID] = role
		}
	}
	return out
}

func logicGateGVICRoleRank(role string) int {
	switch strings.TrimSpace(role) {
	case domain.GVICRoleResponsible:
		return 4
	case domain.GVICRoleConsulted:
		return 3
	case domain.GVICRoleVerifier:
		return 2
	case domain.GVICRoleInformed:
		return 1
	default:
		return 0
	}
}

func logicGateGVICUpdatedWorkspaceEventInput(result LogicGateGVICAssignmentCommandResult, commandAssignments []normalizedLogicGateGVICCommandAssignment, input LogicGateGVICAssignmentCommandInput) DomainEventInput {
	payload := map[string]any{
		"logic_gate_id":       result.LogicGateID,
		"gvic_assignments":    result.GVICAssignments,
		"operation":           result.Operation,
		"command_assignments": logicGateGVICCommandAssignmentPayload(commandAssignments),
		"assignment_user_ids": logicGateGVICChangedUserIDs(result.BeforeAssignments, result.GVICAssignments),
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
		Type:        LogicGateGVICUpdatedEventType,
		ActorUserID: actorUserID,
		Payload:     payload,
	}
}
