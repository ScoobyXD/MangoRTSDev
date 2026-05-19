package kanban

import (
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type Repository interface {
	store.KanbanRepository
	store.WorkGraphRepository
	store.DomainEventRepository
}

type Service struct {
	repo Repository
}

type CardCommandResult struct {
	Card        domain.KanbanCard
	DerivedNode *domain.Node
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) UpsertCard(input store.KanbanCardMutationInput) (CardCommandResult, error) {
	card, err := s.repo.UpsertKanbanCard(input)
	if err != nil {
		return CardCommandResult{}, err
	}
	s.appendCardEvent(card, "kanban.card_upserted", map[string]any{
		"board_id":  card.BoardID,
		"card_id":   card.CardID,
		"column_id": card.ColumnID,
		"node_id":   card.NodeID,
	})
	return s.withDerivedNode(card), nil
}

func (s *Service) MoveCard(input store.KanbanCardMoveInput) (CardCommandResult, error) {
	card, err := s.repo.MoveKanbanCard(input)
	if err != nil {
		return CardCommandResult{}, err
	}
	s.appendCardEvent(card, "kanban.card_moved", map[string]any{
		"board_id":  card.BoardID,
		"card_id":   card.CardID,
		"column_id": card.ColumnID,
		"node_id":   card.NodeID,
		"is_issue":  card.IsIssue,
	})
	return s.withDerivedNode(card), nil
}

func (s *Service) withDerivedNode(card domain.KanbanCard) CardCommandResult {
	result := CardCommandResult{Card: card}
	if card.LogicGateID == nil {
		return result
	}
	node, err := s.repo.GetNode(card.CompanyID, card.NodeID)
	if err == nil {
		result.DerivedNode = &node
	}
	return result
}

func (s *Service) appendCardEvent(card domain.KanbanCard, eventType string, payload map[string]any) {
	_, _ = s.repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:  card.CompanyID,
		StreamType: "kanban_card",
		StreamID:   card.CardID,
		Type:       eventType,
		Payload:    payload,
	})
}
