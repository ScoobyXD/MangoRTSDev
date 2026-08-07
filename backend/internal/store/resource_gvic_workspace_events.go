package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const NodeRACIUpdatedEventType = "node_gvic_updated"

func highestResourceRACIRolesByUser(assignments []domain.ResourceRACIEffectiveAssignment) map[string]string {
	roles := map[string]string{}
	for _, assignment := range assignments {
		userID := strings.TrimSpace(assignment.UserID)
		role, ok := NormalizeRACIRole(assignment.Role)
		if !ok || userID == "" {
			continue
		}
		if logicGateRACIRoleRank(role) > logicGateRACIRoleRank(roles[userID]) {
			roles[userID] = role
		}
	}
	return roles
}

func resourceRACIChangedUserIDs(before, after []domain.ResourceRACIEffectiveAssignment) []string {
	beforeRoles := highestResourceRACIRolesByUser(before)
	afterRoles := highestResourceRACIRolesByUser(after)
	userIDs := make([]string, 0, len(afterRoles))
	for userID, role := range afterRoles {
		if beforeRoles[userID] != role {
			userIDs = append(userIDs, userID)
		}
	}
	sort.Strings(userIDs)
	return userIDs
}

func resourceRACIUpdatedWorkspaceEventInput(
	result ResourceRACIAssignmentMutationResult,
	beforeEffective []domain.ResourceRACIEffectiveAssignment,
	actorUserID string,
	idempotencyKey string,
) (DomainEventInput, bool) {
	resourceType, ok := NormalizeRACIResourceType(result.ResourceType)
	if !ok || (resourceType != EntityTypeNode && resourceType != EntityTypeLogicGate) {
		return DomainEventInput{}, false
	}
	assignmentUserIDs := resourceRACIChangedUserIDs(beforeEffective, result.EffectiveAssignments)
	if len(assignmentUserIDs) == 0 {
		return DomainEventInput{}, false
	}
	payload := map[string]any{
		"resource_type":       resourceType,
		"resource_id":         strings.TrimSpace(result.ResourceID),
		"operation":           strings.TrimSpace(result.Operation),
		"gvic_assignments":    result.RACIAssignments,
		"assignment_user_ids": assignmentUserIDs,
	}
	eventType := LogicGateRACIUpdatedEventType
	if resourceType == EntityTypeNode {
		eventType = NodeRACIUpdatedEventType
		payload["node_id"] = strings.TrimSpace(result.ResourceID)
	} else {
		payload["logic_gate_id"] = strings.TrimSpace(result.ResourceID)
	}
	actorUserID = strings.TrimSpace(actorUserID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if actorUserID != "" {
		payload["actor_user_id"] = actorUserID
	}
	if idempotencyKey != "" {
		payload["idempotency_key"] = idempotencyKey
	}
	return DomainEventInput{
		CompanyID:      strings.TrimSpace(result.CompanyID),
		StreamType:     workspaceDomainStreamType,
		StreamID:       strings.TrimSpace(result.CompanyID),
		Type:           eventType,
		ActorUserID:    actorUserID,
		IdempotencyKey: idempotencyKey,
		Payload:        payload,
	}, true
}
