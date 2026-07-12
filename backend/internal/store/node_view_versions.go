package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const (
	nodeViewSharedVersionScope = "node-view"
	nodeViewUserVersionScope   = "node-view-user"
)

func nodeViewSharedVersionMemoryKey(companyID, nodeID string) string {
	return workspaceReadVersionMemoryKey(
		strings.TrimSpace(companyID),
		nodeViewSharedVersionScope,
		WorkspaceReadVersionResourceKey("node_id", strings.TrimSpace(nodeID)),
	)
}

func nodeViewUserVersionMemoryKey(companyID, nodeID, userID string) string {
	return workspaceReadVersionMemoryKey(
		strings.TrimSpace(companyID),
		nodeViewUserVersionScope,
		WorkspaceReadVersionUserResourceKey(
			strings.TrimSpace(userID),
			WorkspaceReadVersionResourceKey("node_id", strings.TrimSpace(nodeID)),
		),
	)
}

func (r *MemoryRepo) bumpNodeViewVersionLocked(companyID, nodeID string) {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	if companyID == "" || nodeID == "" {
		return
	}
	if r.workspaceReadVersions == nil {
		r.workspaceReadVersions = map[string]int64{}
	}
	r.workspaceReadVersions[nodeViewSharedVersionMemoryKey(companyID, nodeID)]++
}

func (r *MemoryRepo) bumpNodeViewUserVersionLocked(companyID, nodeID, userID string) {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || nodeID == "" || userID == "" {
		return
	}
	if r.workspaceReadVersions == nil {
		r.workspaceReadVersions = map[string]int64{}
	}
	r.workspaceReadVersions[nodeViewUserVersionMemoryKey(companyID, nodeID, userID)]++
}

func (r *MemoryRepo) CurrentNodeViewVersion(companyID, nodeID, userID string) (NodeViewVersion, error) {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || nodeID == "" {
		return NodeViewVersion{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return NodeViewVersion{}, ErrNotFound
	}
	return NodeViewVersion{
		Shared: r.workspaceReadVersions[nodeViewSharedVersionMemoryKey(companyID, nodeID)],
		User:   r.workspaceReadVersions[nodeViewUserVersionMemoryKey(companyID, nodeID, userID)],
	}, nil
}

func (r *MemoryRepo) AnchorCleanNodeProjections(input NodeProjectionAnchorInput) (int, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.NodeID)
	userID := strings.TrimSpace(input.UserID)
	if companyID == "" || nodeID == "" || userID == "" {
		return 0, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return 0, ErrNotFound
	}

	anchored := 0
	for _, projection := range r.nodeText[key(companyID, nodeID)] {
		if projection.Type != "Text box" {
			continue
		}
		seenKey := nodeProjectionSeenKey(companyID, nodeID, projection.InformationID, userID)
		seen := r.nodeProjectionSeen[seenKey]
		hasUnseen := false
		for _, change := range r.nodeContentChanges {
			if change.CompanyID != companyID || change.NodeID != nodeID || change.InformationID != projection.InformationID {
				continue
			}
			if strings.TrimSpace(change.ActorUserID) == userID {
				continue
			}
			if _, alreadySeen := r.nodeContentChangeSeen[nodeContentChangeSeenKey(companyID, change.ChangeID, userID)]; alreadySeen {
				continue
			}
			if !seen.seenAt.IsZero() && change.CreatedTimestamp.Before(seen.seenAt) {
				continue
			}
			hasUnseen = true
			break
		}
		if hasUnseen || seen.information == projection.Information {
			continue
		}
		r.nodeProjectionSeen[seenKey] = memoryNodeProjectionSeen{
			information: projection.Information,
			seenAt:      projection.UpdatedTimestamp,
		}
		anchored++
	}

	return anchored, nil
}

func nodeViewHasUnseenChange(changes []domain.NodeContentChange) bool {
	return len(changes) > 0
}
