package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const (
	LogicGateWorkStatusRequested  = "requested"
	LogicGateWorkStatusBacklog    = "backlog"
	LogicGateWorkStatusPending    = "pending"
	LogicGateWorkStatusInProgress = "in_progress"
	LogicGateWorkStatusVerify     = "review"
	LogicGateWorkStatusDone       = "done"
)

type logicGateWorkStatusSpec struct {
	Key      string
	Title    string
	Color    string
	Position int
}

var logicGateWorkStatusSpecs = []logicGateWorkStatusSpec{
	{Key: LogicGateWorkStatusRequested, Title: "Requested", Color: KanbanDefaultRequestedColor, Position: 250},
	{Key: LogicGateWorkStatusBacklog, Title: "Backlogs", Color: KanbanDefaultBacklogColor, Position: 500},
	{Key: LogicGateWorkStatusPending, Title: "Pending", Color: KanbanDefaultPendingColor, Position: 1000},
	{Key: LogicGateWorkStatusInProgress, Title: "In Progress", Color: KanbanDefaultInProgressColor, Position: 2000},
	{Key: LogicGateWorkStatusVerify, Title: "Review", Color: KanbanDefaultVerifyColor, Position: 3000},
	{Key: LogicGateWorkStatusDone, Title: "Done", Color: KanbanDefaultDoneColor, Position: 4000},
}

func NormalizeLogicGateWorkStatusKey(status string) (string, bool) {
	status = strings.ToLower(strings.TrimSpace(status))
	status = strings.ReplaceAll(status, "_", " ")
	status = strings.ReplaceAll(status, "-", " ")
	status = strings.Join(strings.Fields(status), " ")
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
		return LogicGateWorkStatusVerify, true
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
	spec := logicGateWorkStatusSpecForKey(logicGateWorkStatusKeyOrDefault(status, LogicGateWorkStatusPending))
	return spec.Title
}

func LogicGateWorkStatusColor(status string) string {
	spec := logicGateWorkStatusSpecForKey(logicGateWorkStatusKeyOrDefault(status, LogicGateWorkStatusPending))
	return spec.Color
}

func logicGateWorkStatusSpecForKey(status string) logicGateWorkStatusSpec {
	key := logicGateWorkStatusKeyOrDefault(status, LogicGateWorkStatusPending)
	for _, spec := range logicGateWorkStatusSpecs {
		if spec.Key == key {
			return spec
		}
	}
	return logicGateWorkStatusSpecs[0]
}

func logicGateWorkStatusRank(status string) int {
	key := logicGateWorkStatusKeyOrDefault(status, LogicGateWorkStatusPending)
	for index, spec := range logicGateWorkStatusSpecs {
		if spec.Key == key {
			return index
		}
	}
	return 0
}

func sortLogicGateWorkAssignments(items []domain.LogicGateWorkAssignment) {
	sort.Slice(items, func(i, j int) bool {
		leftRank := logicGateWorkStatusRank(items[i].Assignment.StatusKey)
		rightRank := logicGateWorkStatusRank(items[j].Assignment.StatusKey)
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		if items[i].Assignment.Position != items[j].Assignment.Position {
			return items[i].Assignment.Position < items[j].Assignment.Position
		}
		if !items[i].Assignment.CreatedTimestamp.Equal(items[j].Assignment.CreatedTimestamp) {
			return items[i].Assignment.CreatedTimestamp.Before(items[j].Assignment.CreatedTimestamp)
		}
		return items[i].Assignment.AssignmentID < items[j].Assignment.AssignmentID
	})
}

func buildLogicGateWorkView(logicGate domain.LogicGate, assignments []domain.LogicGateWorkAssignment) domain.LogicGateWorkView {
	sortLogicGateWorkAssignments(assignments)
	board := synthesizeLogicGateWorkBoard(logicGate)
	columns := synthesizeLogicGateWorkColumns(logicGate.CompanyID, board.BoardID, logicGate.CreatedTimestamp)
	statuses := make([]domain.LogicGateWorkStatus, 0, len(logicGateWorkStatusSpecs))
	statusIndexes := map[string]int{}
	for _, spec := range logicGateWorkStatusSpecs {
		statusIndexes[spec.Key] = len(statuses)
		statuses = append(statuses, domain.LogicGateWorkStatus{
			StatusKey:   spec.Key,
			Title:       spec.Title,
			Position:    spec.Position,
			Assignments: []domain.LogicGateWorkAssignment{},
		})
	}

	normalizedAssignments := make([]domain.LogicGateWorkAssignment, 0, len(assignments))
	nodes := make([]domain.Node, 0, len(assignments))
	cards := make([]domain.KanbanCard, 0, len(assignments))
	for _, item := range assignments {
		statusKey := logicGateWorkStatusKeyOrDefault(item.Assignment.StatusKey, LogicGateWorkStatusPending)
		item.Assignment.StatusKey = statusKey
		item.Node = logicGateWorkNodeWithAssignment(item.Node, item.Assignment)
		item.Card = synthesizeLogicGateWorkCard(board.BoardID, item.Assignment, item.Node)
		normalizedAssignments = append(normalizedAssignments, item)
		nodes = append(nodes, item.Node)
		cards = append(cards, item.Card)
		statuses[statusIndexes[statusKey]].Assignments = append(statuses[statusIndexes[statusKey]].Assignments, item)
	}

	return domain.LogicGateWorkView{
		CompanyID:   logicGate.CompanyID,
		LogicGateID: logicGate.LogicGateID,
		LogicGate:   logicGate,
		Statuses:    statuses,
		Assignments: normalizedAssignments,
		Nodes:       nodes,
		Board:       board,
		Columns:     columns,
		Cards:       cards,
		CardsLimit:  KanbanMaxCardsLimit,
	}
}

func logicGateWorkNodeWithAssignment(node domain.Node, assignment domain.NodeLogicGateAssignment) domain.Node {
	statusKey := logicGateWorkStatusKeyOrDefault(assignment.StatusKey, LogicGateWorkStatusPending)
	status := LogicGateWorkStatusTitle(statusKey)
	statusColor := LogicGateWorkStatusColor(statusKey)
	if assignment.IsIssue {
		status = "Issue"
		statusColor = "#ffd400"
	}
	node.Status = &status
	node.StatusColor = &statusColor
	node.LogicGateIDs = cleanStringList(append(node.LogicGateIDs, assignment.LogicGateID))
	return node
}

func synthesizeLogicGateWorkBoard(logicGate domain.LogicGate) domain.KanbanBoard {
	logicGateID := logicGate.LogicGateID
	return domain.KanbanBoard{
		CompanyID:        logicGate.CompanyID,
		BoardID:          LogicGateKanbanBoardID(logicGate.LogicGateID),
		LogicGateID:      &logicGateID,
		Title:            normalizeKanbanBoardTitle(LogicGateKanbanBoardID(logicGate.LogicGateID), logicGate.Header),
		Position:         1000,
		CreatedTimestamp: logicGate.CreatedTimestamp,
		UpdatedTimestamp: logicGate.CreatedTimestamp,
	}
}

func synthesizeLogicGateWorkColumns(companyID, boardID string, created time.Time) []domain.KanbanColumn {
	columns := make([]domain.KanbanColumn, 0, len(logicGateWorkStatusSpecs))
	for _, spec := range logicGateWorkStatusSpecs {
		columns = append(columns, domain.KanbanColumn{
			CompanyID:        companyID,
			BoardID:          boardID,
			ColumnID:         spec.Key,
			Title:            spec.Title,
			Position:         spec.Position,
			WidthPx:          normalizeKanbanColumnWidth(0),
			HeightPx:         normalizeKanbanColumnHeight(0),
			ItemColor:        spec.Color,
			CreatedTimestamp: created,
			UpdatedTimestamp: created,
		})
	}
	return columns
}

func synthesizeLogicGateWorkCard(boardID string, assignment domain.NodeLogicGateAssignment, node domain.Node) domain.KanbanCard {
	cardID := strings.TrimSpace(assignment.CompatibilityCardID)
	if cardID == "" {
		cardID = assignment.AssignmentID
	}
	logicGateID := assignment.LogicGateID
	return domain.KanbanCard{
		CompanyID:        assignment.CompanyID,
		BoardID:          boardID,
		CardID:           cardID,
		ColumnID:         logicGateWorkStatusKeyOrDefault(assignment.StatusKey, LogicGateWorkStatusPending),
		NodeID:           assignment.NodeID,
		LogicGateID:      &logicGateID,
		NodeTitle:        node.Title,
		IsIssue:          assignment.IsIssue,
		Position:         assignment.Position,
		DueDate:          cloneStringPointer(node.DueDate),
		Priority:         cloneIntPointer(node.Priority),
		AssigneeUserID:   cloneStringPointer(node.AssigneeUserID),
		AssigneeName:     cloneStringPointer(node.AssigneeName),
		AssigneeEmail:    cloneStringPointer(node.AssigneeEmail),
		CreatedTimestamp: assignment.CreatedTimestamp,
		UpdatedTimestamp: assignment.UpdatedTimestamp,
	}
}

// LogicGateWorkCompatibilityCard returns the same card shape used by Logic
// Gate work read APIs, where column_id is a stable status key.
func LogicGateWorkCompatibilityCard(boardID string, assignment domain.NodeLogicGateAssignment, node domain.Node) domain.KanbanCard {
	boardID = strings.TrimSpace(boardID)
	if boardID == "" {
		boardID = strings.TrimSpace(assignment.CompatibilityBoardID)
	}
	return synthesizeLogicGateWorkCard(boardID, assignment, node)
}
