package store

import "strings"

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
