package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) ListNodeLogicGateAssignments(companyID, nodeID string) ([]domain.NodeLogicGateAssignment, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := []domain.NodeLogicGateAssignment{}
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID == companyID && (nodeID == "" || assignment.NodeID == nodeID) {
			items = append(items, assignment)
		}
	}
	sortNodeLogicGateAssignments(items)
	return items, nil
}
func sortNodeLogicGateAssignments(items []domain.NodeLogicGateAssignment) {
	sort.Slice(items, func(i, j int) bool {
		if !items[i].UpdatedTimestamp.Equal(items[j].UpdatedTimestamp) {
			return items[i].UpdatedTimestamp.After(items[j].UpdatedTimestamp)
		}
		return items[i].AssignmentID > items[j].AssignmentID
	})
}

type nodeLogicGateAssignmentMutation struct {
	CompanyID         string
	NodeID            string
	LogicGateID       string
	ProcessStepID     *string
	IsIssue           bool
	Position          int
	RequestedByUserID string
	PlacedByUserID    string
	CreatedTimestamp  time.Time
	UpdatedTimestamp  time.Time
}

func (r *MemoryRepo) upsertNodeLogicGateAssignmentLocked(input nodeLogicGateAssignmentMutation) domain.NodeLogicGateAssignment {
	now := time.Now().UTC()
	if input.CreatedTimestamp.IsZero() {
		input.CreatedTimestamp = now
	}
	if input.UpdatedTimestamp.IsZero() {
		input.UpdatedTimestamp = now
	}
	assignmentKey := nodeLogicGateAssignmentKey(input.CompanyID, input.NodeID)
	assignment, exists := r.nodeLogicGateAssignments[assignmentKey]
	if !exists {
		assignment = domain.NodeLogicGateAssignment{AssignmentID: newUUIDv7String(), CompanyID: input.CompanyID, NodeID: input.NodeID, CreatedTimestamp: input.CreatedTimestamp}
	}
	assignment.LogicGateID = input.LogicGateID
	assignment.ProcessStepID = cloneStringPointer(input.ProcessStepID)
	assignment.Position = input.Position
	assignment.IsIssue = input.IsIssue
	assignment.RequestedByUserID = input.RequestedByUserID
	assignment.PlacedByUserID = input.PlacedByUserID
	assignment.UpdatedTimestamp = input.UpdatedTimestamp
	assignment.Version++
	r.nodeLogicGateAssignments[assignmentKey] = assignment
	r.bumpNodeViewVersionLocked(input.CompanyID, input.NodeID)
	return assignment
}
func (r *MemoryRepo) nodeLogicGateAssignmentLocked(companyID, nodeID, logicGateID string) (domain.NodeLogicGateAssignment, bool) {
	assignment, ok := r.nodeLogicGateAssignments[nodeLogicGateAssignmentKey(companyID, nodeID)]
	if !ok || logicGateID != "" && assignment.LogicGateID != logicGateID {
		return domain.NodeLogicGateAssignment{}, false
	}
	return assignment, true
}
func (r *MemoryRepo) clearLogicGateAssignmentMemberReferencesLocked(companyID, userID string) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	for assignmentKey, assignment := range r.nodeLogicGateAssignments {
		if companyID != "" && assignment.CompanyID != companyID {
			continue
		}
		changed := false
		if assignment.RequestedByUserID == userID {
			assignment.RequestedByUserID = ""
			changed = true
		}
		if assignment.PlacedByUserID == userID {
			assignment.PlacedByUserID = ""
			changed = true
		}
		if changed {
			r.nodeLogicGateAssignments[assignmentKey] = assignment
			r.bumpNodeViewVersionLocked(assignment.CompanyID, assignment.NodeID)
		}
	}
}
func (r *MemoryRepo) deleteNodeLogicGateAssignmentsForLogicGateLocked(companyID, logicGateID string) {
	for assignmentKey, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID == companyID && assignment.LogicGateID == logicGateID {
			delete(r.nodeLogicGateAssignments, assignmentKey)
			r.bumpNodeViewVersionLocked(companyID, assignment.NodeID)
		}
	}
}
