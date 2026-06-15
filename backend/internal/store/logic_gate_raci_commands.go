package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const LogicGateRaciUpdatedEventType = "logic_gate_raci_updated"

type normalizedLogicGateRaciCommandAssignment struct {
	role        string
	subjectType string
	subjectID   string
	userID      string
}

func normalizeLogicGateRaciAssignmentInput(assignment LogicGateRaciAssignmentInput) (normalizedLogicGateRaciCommandAssignment, error) {
	role, ok := NormalizeLogicGateRaciRole(assignment.Role)
	subjectType := strings.ToLower(strings.TrimSpace(assignment.SubjectType))
	subjectID := strings.TrimSpace(assignment.SubjectID)
	userID := strings.TrimSpace(assignment.UserID)
	if subjectType == "" && userID != "" {
		subjectType = EntityPermissionSubjectUser
		subjectID = userID
	}
	if subjectType == EntityPermissionSubjectUser && subjectID == "" {
		subjectID = userID
	}
	if !ok || subjectID == "" {
		return normalizedLogicGateRaciCommandAssignment{}, ErrInvalid
	}
	switch subjectType {
	case EntityPermissionSubjectUser:
		if userID == "" {
			userID = subjectID
		}
	case EntityPermissionSubjectGroup:
		userID = ""
	default:
		return normalizedLogicGateRaciCommandAssignment{}, ErrInvalid
	}
	return normalizedLogicGateRaciCommandAssignment{
		role:        role,
		subjectType: subjectType,
		subjectID:   subjectID,
		userID:      userID,
	}, nil
}

func normalizeLogicGateRaciCommandAssignments(assignments []LogicGateRaciAssignmentInput) ([]normalizedLogicGateRaciCommandAssignment, error) {
	if len(assignments) == 0 {
		return nil, ErrInvalid
	}
	seen := map[string]bool{}
	out := make([]normalizedLogicGateRaciCommandAssignment, 0, len(assignments))
	for _, assignment := range assignments {
		normalized, err := normalizeLogicGateRaciAssignmentInput(assignment)
		if err != nil {
			return nil, err
		}
		key := normalized.role + ":" + normalized.subjectType + ":" + normalized.subjectID
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
		payload := map[string]string{
			"role":         assignment.role,
			"subject_type": assignment.subjectType,
			"subject_id":   assignment.subjectID,
		}
		if assignment.subjectType == EntityPermissionSubjectUser {
			payload["user_id"] = assignment.subjectID
		}
		out = append(out, payload)
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
