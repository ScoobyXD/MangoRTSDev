package store

import (
	"strings"
)

const KanbanMaxCardsLimit = 500
const KanbanMaxBoardsLimit = 200

type KanbanBoardQuery struct {
	AfterPosition int
	Limit         int
}

type KanbanCardQuery struct {
	ColumnID      string
	AfterPosition int
	Limit         int
}

type KanbanCardMutationInput struct {
	CompanyID           string
	BoardID             string
	ColumnID            string
	NodeID              string
	NodeTitle           string
	DescriptionSnapshot string
	Position            int
}

type KanbanCardMoveInput struct {
	CompanyID string
	BoardID   string
	CardID    string
	ColumnID  string
	Position  int
}

func NormalizeKanbanBoardQuery(query KanbanBoardQuery) KanbanBoardQuery {
	if query.AfterPosition < 0 {
		query.AfterPosition = 0
	}
	if query.Limit <= 0 || query.Limit > KanbanMaxBoardsLimit {
		query.Limit = 100
	}
	return query
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
