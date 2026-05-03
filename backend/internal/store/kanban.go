package store

import (
	"strings"
)

const KanbanMaxCardsLimit = 500

type KanbanCardQuery struct {
	ColumnID      string
	AfterPosition int
	Limit         int
}

type KanbanCardMetadataInput struct {
	Status              string
	WorkType            string
	AssignedTo          string
	AssignedBy          string
	ActorID             string
	DescriptionSnapshot string
	LastActivity        string
}

type KanbanCardMutationInput struct {
	CompanyID     string
	BoardID       string
	ColumnID      string
	ItemType      string
	ItemID        string
	TitleSnapshot string
	Position      int
	Metadata      KanbanCardMetadataInput
}

type KanbanCardMoveInput struct {
	CompanyID string
	BoardID   string
	CardID    string
	ColumnID  string
	Position  int
	Metadata  KanbanCardMetadataInput
}

func NormalizeKanbanCardQuery(query KanbanCardQuery) KanbanCardQuery {
	query.ColumnID = strings.TrimSpace(query.ColumnID)
	if query.AfterPosition < 0 {
		query.AfterPosition = 0
	}
	if query.Limit <= 0 || query.Limit > KanbanMaxCardsLimit {
		query.Limit = 200
	}
	return query
}

func NormalizeKanbanCardStatus(inputStatus, columnTitle string) string {
	status := strings.TrimSpace(inputStatus)
	if status != "" {
		return status
	}
	status = strings.TrimSpace(columnTitle)
	if status != "" {
		return status
	}
	return "Unspecified"
}

func NormalizeKanbanCardWorkType(inputWorkType, itemType string) string {
	workType := strings.TrimSpace(inputWorkType)
	if workType != "" {
		return workType
	}
	if itemType == "logic_gate" {
		return "Logic Gate"
	}
	return "Node"
}

func NormalizeKanbanLastActivity(inputActivity, fallback string) string {
	activity := strings.TrimSpace(inputActivity)
	if activity != "" {
		return activity
	}
	return fallback
}
