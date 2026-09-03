package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const (
	logicGateWorkReadVersionScope = "logic-gate-work"
	LogicGateWorkStatusRequested  = "requested"
	LogicGateWorkStatusBacklog    = "backlog"
	LogicGateWorkStatusPending    = "pending"
	LogicGateWorkStatusInProgress = "in_progress"
	LogicGateWorkStatusReview     = "review"
	LogicGateWorkStatusDone       = "done"
)

func logicGateWorkReadVersionMemoryKey(companyID, logicGateID string) string {
	return workspaceReadVersionMemoryKey(strings.TrimSpace(companyID), logicGateWorkReadVersionScope, WorkspaceReadVersionResourceKey("logic_gate_id", strings.TrimSpace(logicGateID)))
}
func NormalizeLogicGateWorkStatusKey(status string) (string, bool) {
	status = logicGateAssignmentStatusKey(status)
	switch status {
	case "":
		return "", true
	case "requested", "request", "requests", "r":
		return LogicGateWorkStatusRequested, true
	case "backlog", "backlogs", "b":
		return LogicGateWorkStatusBacklog, true
	case "pending", "p":
		return LogicGateWorkStatusPending, true
	case "in progress", "inprogress", "ip":
		return LogicGateWorkStatusInProgress, true
	case "review":
		return LogicGateWorkStatusReview, true
	case "done", "d":
		return LogicGateWorkStatusDone, true
	default:
		return "", false
	}
}
func logicGateWorkStatusKeyOrDefault(status, fallback string) string {
	if key, ok := NormalizeLogicGateWorkStatusKey(status); ok && key != "" {
		return key
	}
	if key, ok := NormalizeLogicGateWorkStatusKey(fallback); ok && key != "" {
		return key
	}
	return LogicGateWorkStatusPending
}
func LogicGateWorkStatusTitle(status string) string {
	switch logicGateWorkStatusKeyOrDefault(status, LogicGateWorkStatusPending) {
	case LogicGateWorkStatusRequested:
		return "Requested"
	case LogicGateWorkStatusBacklog:
		return "Backlogs"
	case LogicGateWorkStatusInProgress:
		return "In Progress"
	case LogicGateWorkStatusReview:
		return "Review"
	case LogicGateWorkStatusDone:
		return "Done"
	default:
		return "Pending"
	}
}
func requestedByUserIDForLogicGateStatus(status, requestedByUserID, fallbackUserID string) string {
	if logicGateWorkStatusKeyOrDefault(status, status) != LogicGateWorkStatusRequested {
		return ""
	}
	if clean := strings.TrimSpace(requestedByUserID); clean != "" {
		return clean
	}
	return strings.TrimSpace(fallbackUserID)
}
func nodeWorkStatus(node domain.Node) string {
	if node.Status == nil {
		return "Pending"
	}
	return *node.Status
}

func normalizeNodeStatusForAssignment(status *string, assigned bool) (*string, error) {
	value := ""
	if status != nil {
		value = strings.TrimSpace(*status)
	}
	if strings.EqualFold(value, "Issue") {
		return nil, ErrInvalid
	}
	statusKey, valid := NormalizeLogicGateWorkStatusKey(value)
	if assigned && (!valid || statusKey == "") {
		return nil, ErrInvalid
	}
	if valid && statusKey != "" {
		value = LogicGateWorkStatusTitle(statusKey)
	}
	return normalizeOptionalStringPointer(&value), nil
}
func logicGateWorkNode(assignment domain.NodeLogicGateAssignment, node domain.Node) domain.LogicGateWorkNode {
	return domain.LogicGateWorkNode{NodeID: node.NodeID, NodeTitle: node.Title, Status: nodeWorkStatus(node), ProcessStepID: cloneStringPointer(assignment.ProcessStepID), RequestedByUserID: assignment.RequestedByUserID, PlacedByUserID: assignment.PlacedByUserID, IsIssue: assignment.IsIssue, Position: assignment.Position, DueDate: cloneStringPointer(node.DueDate), Priority: cloneIntPointer(node.Priority), CreatedTimestamp: assignment.CreatedTimestamp, Accounts: cloneAccountSnapshots(node.Accounts)}
}
func sortLogicGateWorkNodes(nodes []domain.LogicGateWorkNode) {
	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].Position != nodes[j].Position {
			return nodes[i].Position < nodes[j].Position
		}
		if !nodes[i].CreatedTimestamp.Equal(nodes[j].CreatedTimestamp) {
			return nodes[i].CreatedTimestamp.Before(nodes[j].CreatedTimestamp)
		}
		return nodes[i].NodeID < nodes[j].NodeID
	})
}
