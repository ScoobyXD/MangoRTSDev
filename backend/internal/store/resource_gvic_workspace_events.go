package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const NodeGVICUpdatedEventType = "node_gvic_updated"

func highestResourceGVICRolesByUser(assignments []domain.ResourceGVICEffectiveAssignment) map[string]string {
	roles := map[string]string{}
	for _, assignment := range assignments {
		userID := strings.TrimSpace(assignment.UserID)
		role, ok := NormalizeGVICRole(assignment.Role)
		if !ok || userID == "" {
			continue
		}
		if logicGateGVICRoleRank(role) > logicGateGVICRoleRank(roles[userID]) {
			roles[userID] = role
		}
	}
	return roles
}

func resourceGVICChangedUserIDs(before, after []domain.ResourceGVICEffectiveAssignment) []string {
	beforeRoles := highestResourceGVICRolesByUser(before)
	afterRoles := highestResourceGVICRolesByUser(after)
	userIDs := make([]string, 0, len(afterRoles))
	for userID, role := range afterRoles {
		if beforeRoles[userID] != role {
			userIDs = append(userIDs, userID)
		}
	}
	sort.Strings(userIDs)
	return userIDs
}

func resourceGVICUpdatedWorkspaceEventInput(
	result ResourceGVICAssignmentMutationResult,
	beforeEffective []domain.ResourceGVICEffectiveAssignment,
	actorUserID string,
	idempotencyKey string,
) (DomainEventInput, bool) {
	resourceType, ok := NormalizeGVICResourceType(result.ResourceType)
	if !ok || (resourceType != EntityTypeNode && resourceType != EntityTypeLogicGate) {
		return DomainEventInput{}, false
	}
	assignmentUserIDs := resourceGVICChangedUserIDs(beforeEffective, result.EffectiveAssignments)
	if len(assignmentUserIDs) == 0 {
		return DomainEventInput{}, false
	}
	payload := map[string]any{
		"resource_type":       resourceType,
		"resource_id":         strings.TrimSpace(result.ResourceID),
		"operation":           strings.TrimSpace(result.Operation),
		"gvic_assignments":    result.GVICAssignments,
		"assignment_user_ids": assignmentUserIDs,
	}
	eventType := LogicGateGVICUpdatedEventType
	if resourceType == EntityTypeNode {
		eventType = NodeGVICUpdatedEventType
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
