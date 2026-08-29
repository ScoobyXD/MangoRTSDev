package store

import (
	"strings"
	"time"

	"miraeopus/backend/internal/domain"
)

type nodeCompletionTransitionUpdate struct {
	CompanyID           string    `json:"company_id"`
	NodeID              string    `json:"node_id"`
	Completed           bool      `json:"completed"`
	ReplaceTimestamp    bool      `json:"replace_timestamp"`
	TransitionTimestamp time.Time `json:"transition_timestamp"`
}

func nodeCompletionTransitionUpdates(events []domain.DomainEvent) []nodeCompletionTransitionUpdate {
	updates := make([]nodeCompletionTransitionUpdate, 0)
	indexes := make(map[string]int)
	for _, event := range events {
		nodeID, completed, ok := nodeCompletionSnapshot(event)
		if !ok {
			continue
		}
		mapKey := key(event.CompanyID, nodeID)
		index, seen := indexes[mapKey]
		if !seen {
			indexes[mapKey] = len(updates)
			updates = append(updates, nodeCompletionTransitionUpdate{
				CompanyID: event.CompanyID, NodeID: nodeID, Completed: completed,
				TransitionTimestamp: event.CreatedTimestamp,
			})
			continue
		}
		update := &updates[index]
		if !completed {
			update.Completed = false
			update.ReplaceTimestamp = true
			update.TransitionTimestamp = event.CreatedTimestamp
			continue
		}
		if !update.Completed {
			update.ReplaceTimestamp = true
			update.TransitionTimestamp = event.CreatedTimestamp
		}
		update.Completed = true
	}
	return updates
}

func nodeCompletionSnapshot(event domain.DomainEvent) (string, bool, bool) {
	if event.StreamType != workspaceDomainStreamType || strings.TrimSpace(event.StreamID) != strings.TrimSpace(event.CompanyID) || (event.Type != "node_created" && event.Type != "node_updated") {
		return "", false, false
	}
	var nodeID, status string
	switch snapshot := event.Payload["node"].(type) {
	case domain.Node:
		nodeID = snapshot.NodeID
		status = myWorkOptionalString(snapshot.Status)
	case map[string]any:
		nodeID, _ = snapshot["node_id"].(string)
		rawStatus, hasStatus := snapshot["status"]
		if !hasStatus {
			return "", false, false
		}
		switch value := rawStatus.(type) {
		case nil:
		case string:
			status = value
		default:
			return "", false, false
		}
	default:
		return "", false, false
	}
	nodeID = cleanUUIDText(nodeID)
	if nodeID == "" {
		return "", false, false
	}
	return nodeID, myWorkStatusDone(status), true
}

func (r *MemoryRepo) applyNodeCompletionTransitionUpdatesLocked(events []domain.DomainEvent) {
	if r.nodeCompletionTransitions == nil {
		r.nodeCompletionTransitions = map[string]time.Time{}
	}
	for _, update := range nodeCompletionTransitionUpdates(events) {
		mapKey := key(update.CompanyID, update.NodeID)
		if !update.Completed {
			delete(r.nodeCompletionTransitions, mapKey)
			continue
		}
		if _, exists := r.nodeCompletionTransitions[mapKey]; update.ReplaceTimestamp || !exists {
			r.nodeCompletionTransitions[mapKey] = update.TransitionTimestamp
		}
	}
}
