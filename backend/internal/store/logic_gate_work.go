package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
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
	return workspaceReadVersionMemoryKey(
		strings.TrimSpace(companyID),
		logicGateWorkReadVersionScope,
		WorkspaceReadVersionResourceKey("logic_gate_id", strings.TrimSpace(logicGateID)),
	)
}

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
	{Key: LogicGateWorkStatusReview, Title: "Review", Color: KanbanDefaultReviewColor, Position: 3000},
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
	spec := logicGateWorkStatusSpecForKey(logicGateWorkStatusKeyOrDefault(status, LogicGateWorkStatusPending))
	return spec.Title
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

func requestedByUserIDForLogicGateStatus(status, requestedByUserID, fallbackUserID string) string {
	if logicGateWorkStatusKeyOrDefault(status, status) != LogicGateWorkStatusRequested {
		return ""
	}
	if clean := strings.TrimSpace(requestedByUserID); clean != "" {
		return clean
	}
	return strings.TrimSpace(fallbackUserID)
}

type logicGateWorkAssignment struct {
	Assignment domain.NodeLogicGateAssignment
	Node       domain.Node
}

func sortLogicGateWorkAssignments(items []logicGateWorkAssignment) {
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

func buildLogicGateWorkView(logicGate domain.LogicGate, assignments []logicGateWorkAssignment) domain.LogicGateWorkView {
	sortLogicGateWorkAssignments(assignments)
	board := synthesizeLogicGateWorkBoard(logicGate)
	columns := synthesizeLogicGateWorkColumns(logicGate.CompanyID, board.BoardID, logicGate.CreatedTimestamp)
	cards := make([]domain.LogicGateWorkCard, 0, len(assignments))
	for _, item := range assignments {
		cards = append(cards, synthesizeLogicGateWorkCard(item.Assignment, item.Node))
	}

	return domain.LogicGateWorkView{
		LogicGate: domain.LogicGateWorkHeader{
			LogicGateID:        logicGate.LogicGateID,
			Header:             logicGate.Header,
			DefaultAccess:      defaultResourceAccessOrEdit(logicGate.DefaultAccess),
			RequestOwnerUserID: logicGateWorkRequestOwnerUserID(logicGate.GVICAssignments),
		},
		Board:   board,
		Columns: columns,
		Cards:   cards,
	}
}

func logicGateWorkRequestOwnerUserID(assignments []domain.LogicGateGVICAssignment) string {
	for _, assignment := range assignments {
		principalType, principalID := logicGateGVICAssignmentPrincipal(assignment)
		if assignment.Role == domain.GVICRoleResponsible && principalType == EntityPermissionSubjectUser {
			return strings.TrimSpace(principalID)
		}
	}
	return ""
}

func logicGateWorkCardEmailOriginKey(boardID, cardID, nodeID string) string {
	return strings.TrimSpace(boardID) + "\x00" + strings.TrimSpace(cardID) + "\x00" + strings.TrimSpace(nodeID)
}

func markLogicGateWorkEmailOriginCards(work *domain.LogicGateWorkView, emailOriginKeys map[string]bool) {
	if len(emailOriginKeys) == 0 {
		return
	}
	for index := range work.Cards {
		card := &work.Cards[index]
		if emailOriginKeys[logicGateWorkCardEmailOriginKey(work.Board.BoardID, card.CardID, card.NodeID)] {
			card.CreatedFromEmail = true
		}
	}
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

func synthesizeLogicGateWorkCard(assignment domain.NodeLogicGateAssignment, node domain.Node) domain.LogicGateWorkCard {
	cardID := strings.TrimSpace(assignment.CompatibilityCardID)
	if cardID == "" {
		cardID = assignment.AssignmentID
	}
	return domain.LogicGateWorkCard{
		CardID:                     cardID,
		ColumnID:                   logicGateWorkStatusKeyOrDefault(assignment.StatusKey, LogicGateWorkStatusPending),
		NodeID:                     assignment.NodeID,
		RequestedByUserID:          strings.TrimSpace(assignment.RequestedByUserID),
		PlacedByUserID:             strings.TrimSpace(assignment.PlacedByUserID),
		NodeTitle:                  node.Title,
		IsIssue:                    assignment.IsIssue,
		Position:                   assignment.Position,
		DueDate:                    cloneStringPointer(node.DueDate),
		Priority:                   cloneIntPointer(node.Priority),
		ProjectionUpdatedTimestamp: assignment.UpdatedTimestamp,
		CreatedTimestamp:           assignment.CreatedTimestamp,
		Accounts:                   cloneAccountSnapshots(node.Accounts),
	}
}

// LogicGateWorkCompatibilityCard returns the same card shape used by Logic
// Gate work read APIs, where column_id is a stable status key.
func LogicGateWorkCompatibilityCard(boardID string, assignment domain.NodeLogicGateAssignment, node domain.Node) domain.KanbanCard {
	boardID = strings.TrimSpace(boardID)
	if boardID == "" {
		boardID = strings.TrimSpace(assignment.CompatibilityBoardID)
	}
	card := synthesizeLogicGateWorkCard(assignment, node)
	return LogicGateWorkCardToKanbanCard(assignment.CompanyID, boardID, assignment.LogicGateID, card)
}

// LogicGateWorkCardToKanbanCard restores compatibility-only coordinates for
// the generic Kanban endpoints without bloating the Arena response.
func LogicGateWorkCardToKanbanCard(companyID, boardID, logicGateID string, card domain.LogicGateWorkCard) domain.KanbanCard {
	logicGateID = strings.TrimSpace(logicGateID)
	return domain.KanbanCard{
		CompanyID:                  strings.TrimSpace(companyID),
		BoardID:                    strings.TrimSpace(boardID),
		CardID:                     card.CardID,
		ColumnID:                   card.ColumnID,
		NodeID:                     card.NodeID,
		LogicGateID:                stringPointer(logicGateID),
		RequestedByUserID:          card.RequestedByUserID,
		PlacedByUserID:             card.PlacedByUserID,
		NodeTitle:                  card.NodeTitle,
		IsIssue:                    card.IsIssue,
		Position:                   card.Position,
		DueDate:                    cloneStringPointer(card.DueDate),
		Priority:                   cloneIntPointer(card.Priority),
		CreatedFromEmail:           card.CreatedFromEmail,
		HasProject:                 card.HasProject,
		ProjectionUpdatedTimestamp: card.ProjectionUpdatedTimestamp,
		CreatedTimestamp:           card.CreatedTimestamp,
		UpdatedTimestamp:           card.ProjectionUpdatedTimestamp,
		Accounts:                   cloneAccountSnapshots(card.Accounts),
	}
}
