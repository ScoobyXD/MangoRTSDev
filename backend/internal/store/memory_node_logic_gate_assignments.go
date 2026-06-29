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

	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	items := make([]domain.NodeLogicGateAssignment, 0)
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID != companyID {
			continue
		}
		if nodeID != "" && assignment.NodeID != nodeID {
			continue
		}
		items = append(items, assignment)
	}
	sortNodeLogicGateAssignments(items)
	return items, nil
}

func sortNodeLogicGateAssignments(items []domain.NodeLogicGateAssignment) {
	sort.Slice(items, func(i, j int) bool {
		if !items[i].UpdatedTimestamp.Equal(items[j].UpdatedTimestamp) {
			return items[i].UpdatedTimestamp.After(items[j].UpdatedTimestamp)
		}
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.After(items[j].CreatedTimestamp)
		}
		return items[i].AssignmentID > items[j].AssignmentID
	})
}

func (r *MemoryRepo) upsertNodeLogicGateAssignmentFromCardLocked(card domain.KanbanCard) domain.NodeLogicGateAssignment {
	if card.LogicGateID == nil || strings.TrimSpace(*card.LogicGateID) == "" {
		return domain.NodeLogicGateAssignment{}
	}
	column, _ := r.kanbanColumnLocked(card.CompanyID, card.BoardID, card.ColumnID)
	return r.upsertNodeLogicGateAssignmentLocked(nodeLogicGateAssignmentMutation{
		CompanyID:            card.CompanyID,
		NodeID:               card.NodeID,
		LogicGateID:          *card.LogicGateID,
		ColumnID:             card.ColumnID,
		StatusKey:            logicGateAssignmentStatusKey(column.Title),
		IsIssue:              card.IsIssue,
		Position:             card.Position,
		CompatibilityBoardID: card.BoardID,
		CompatibilityCardID:  card.CardID,
		RequestedByUserID:    card.RequestedByUserID,
		PlacedByUserID:       card.PlacedByUserID,
		CreatedTimestamp:     card.CreatedTimestamp,
		UpdatedTimestamp:     card.UpdatedTimestamp,
	})
}

type nodeLogicGateAssignmentMutation struct {
	CompanyID            string
	NodeID               string
	LogicGateID          string
	ColumnID             string
	StatusKey            string
	IsIssue              bool
	Position             int
	CompatibilityBoardID string
	CompatibilityCardID  string
	RequestedByUserID    string
	PlacedByUserID       string
	CreatedTimestamp     time.Time
	UpdatedTimestamp     time.Time
}

func (r *MemoryRepo) upsertNodeLogicGateAssignmentLocked(input nodeLogicGateAssignmentMutation) domain.NodeLogicGateAssignment {
	now := time.Now().UTC()
	if input.CreatedTimestamp.IsZero() {
		input.CreatedTimestamp = now
	}
	if input.UpdatedTimestamp.IsZero() {
		input.UpdatedTimestamp = now
	}
	if strings.TrimSpace(input.StatusKey) == "" {
		input.StatusKey = logicGateAssignmentStatusKey(input.ColumnID)
	}
	assignmentKeyValue := nodeLogicGateAssignmentKey(input.CompanyID, input.NodeID)
	assignment, exists := r.nodeLogicGateAssignments[assignmentKeyValue]
	if !exists {
		assignment = domain.NodeLogicGateAssignment{
			AssignmentID:     newUUIDv7String(),
			CompanyID:        input.CompanyID,
			NodeID:           input.NodeID,
			CreatedTimestamp: input.CreatedTimestamp,
			Version:          1,
		}
	} else {
		assignment.Version++
	}
	assignment.LogicGateID = input.LogicGateID
	assignment.StatusKey = input.StatusKey
	assignment.ColumnID = input.ColumnID
	assignment.IsIssue = input.IsIssue
	assignment.Position = input.Position
	assignment.CompatibilityBoardID = input.CompatibilityBoardID
	assignment.CompatibilityCardID = input.CompatibilityCardID
	if placedBy := strings.TrimSpace(input.PlacedByUserID); placedBy != "" {
		assignment.PlacedByUserID = placedBy
	}
	if logicGateWorkStatusKeyOrDefault(input.StatusKey, input.ColumnID) == LogicGateWorkStatusRequested {
		if requestedBy := strings.TrimSpace(input.RequestedByUserID); requestedBy != "" {
			assignment.RequestedByUserID = requestedBy
		}
	} else {
		assignment.RequestedByUserID = ""
	}
	assignment.UpdatedTimestamp = input.UpdatedTimestamp
	r.nodeLogicGateAssignments[assignmentKeyValue] = assignment
	return assignment
}

func (r *MemoryRepo) nodeLogicGateAssignmentLocked(companyID, nodeID, logicGateID string) (domain.NodeLogicGateAssignment, bool) {
	assignment, ok := r.nodeLogicGateAssignments[nodeLogicGateAssignmentKey(companyID, nodeID)]
	if !ok {
		return domain.NodeLogicGateAssignment{}, false
	}
	logicGateID = strings.TrimSpace(logicGateID)
	if logicGateID != "" && assignment.LogicGateID != logicGateID {
		return domain.NodeLogicGateAssignment{}, false
	}
	return assignment, true
}

func (r *MemoryRepo) deleteNodeLogicGateAssignmentForCardLocked(card domain.KanbanCard) {
	assignment, ok := r.nodeLogicGateAssignmentLocked(card.CompanyID, card.NodeID, "")
	if !ok {
		return
	}
	if assignment.CompatibilityBoardID == card.BoardID && assignment.CompatibilityCardID == card.CardID {
		delete(r.nodeLogicGateAssignments, nodeLogicGateAssignmentKey(card.CompanyID, card.NodeID))
	}
}

func (r *MemoryRepo) deleteNodeLogicGateAssignmentsForLogicGateLocked(companyID, logicGateID string) {
	for assignmentKeyValue, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID == companyID && assignment.LogicGateID == logicGateID {
			delete(r.nodeLogicGateAssignments, assignmentKeyValue)
		}
	}
}
