package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const LogicGateRACIUpdatedEventType = "logic_gate_gvic_updated"

type normalizedLogicGateRACICommandAssignment struct {
	role          string
	principalType string
	principalID   string
	userID        string
}

func normalizeLogicGateRACIAssignmentInput(assignment LogicGateRACIAssignmentInput) (normalizedLogicGateRACICommandAssignment, error) {
	role, ok := NormalizeRACIRole(assignment.Role)
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
		return normalizedLogicGateRACICommandAssignment{}, ErrInvalid
	}
	switch principalType {
	case EntityPermissionSubjectUser:
		if userID == "" {
			userID = principalID
		}
	case EntityPermissionSubjectGroup:
		userID = ""
	default:
		return normalizedLogicGateRACICommandAssignment{}, ErrInvalid
	}
	return normalizedLogicGateRACICommandAssignment{
		role:          role,
		principalType: principalType,
		principalID:   principalID,
		userID:        userID,
	}, nil
}

func normalizeLogicGateRACICommandAssignments(assignments []LogicGateRACIAssignmentInput) ([]normalizedLogicGateRACICommandAssignment, error) {
	if len(assignments) == 0 {
		return nil, ErrInvalid
	}
	seen := map[string]bool{}
	out := make([]normalizedLogicGateRACICommandAssignment, 0, len(assignments))
	for _, assignment := range assignments {
		normalized, err := normalizeLogicGateRACIAssignmentInput(assignment)
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

func cloneLogicGateRACIAssignments(items []domain.LogicGateRACIAssignment) []domain.LogicGateRACIAssignment {
	if len(items) == 0 {
		return []domain.LogicGateRACIAssignment{}
	}
	out := append([]domain.LogicGateRACIAssignment{}, items...)
	return out
}

func logicGateRACICommandAssignmentPayload(assignments []normalizedLogicGateRACICommandAssignment) []map[string]string {
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

func logicGateRACIChangedUserIDs(before, after []domain.LogicGateRACIAssignment) []string {
	beforeRoles := highestLogicGateRACIRolesByUser(before)
	afterRoles := highestLogicGateRACIRolesByUser(after)
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

func highestLogicGateRACIRolesByUser(assignments []domain.LogicGateRACIAssignment) map[string]string {
	out := map[string]string{}
	for _, assignment := range assignments {
		userID := strings.TrimSpace(assignment.UserID)
		role, ok := NormalizeRACIRole(assignment.Role)
		if !ok || userID == "" {
			continue
		}
		if logicGateRACIRoleRank(role) > logicGateRACIRoleRank(out[userID]) {
			out[userID] = role
		}
	}
	return out
}

func logicGateRACIRoleRank(role string) int {
	switch strings.TrimSpace(role) {
	case domain.RACIRoleResponsible:
		return 4
	case domain.RACIRoleAccountable:
		return 3
	case domain.RACIRoleConsulted:
		return 2
	case domain.RACIRoleInformed:
		return 1
	default:
		return 0
	}
}

func logicGateRACIUpdatedWorkspaceEventInput(result LogicGateRACIAssignmentCommandResult, commandAssignments []normalizedLogicGateRACICommandAssignment, input LogicGateRACIAssignmentCommandInput) DomainEventInput {
	payload := map[string]any{
		"logic_gate_id":       result.LogicGateID,
		"gvic_assignments":    result.RACIAssignments,
		"operation":           result.Operation,
		"command_assignments": logicGateRACICommandAssignmentPayload(commandAssignments),
		"assignment_user_ids": logicGateRACIChangedUserIDs(result.BeforeAssignments, result.RACIAssignments),
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
		Type:        LogicGateRACIUpdatedEventType,
		ActorUserID: actorUserID,
		Payload:     payload,
	}
}
