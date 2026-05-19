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

func (s *Service) AssignNodeToLogicGateStatus(input store.LogicGateNodeAssignmentInput) (store.LogicGateNodeAssignmentResult, error) {
	normalized, err := store.NormalizeLogicGateNodeAssignmentInput(input)
	if err != nil {
		return store.LogicGateNodeAssignmentResult{}, err
	}
	result, err := s.repo.AssignNodeToLogicGateStatus(normalized)
	if err != nil {
		return store.LogicGateNodeAssignmentResult{}, err
	}
	payload := map[string]any{
		"board_id":        result.Card.BoardID,
		"card_id":         result.Card.CardID,
		"column_id":       result.Card.ColumnID,
		"logic_gate_id":   normalized.LogicGateID,
		"node_id":         result.Card.NodeID,
		"assignee_policy": normalized.AssigneePolicy,
	}
	if normalized.PrioritySet {
		payload["priority_set"] = true
		payload["priority"] = normalized.Priority
	}
	if normalized.IsIssueSet {
		payload["is_issue"] = normalized.IsIssue
	}
	s.appendCardEvent(result.Card, "work_item.logic_gate_assignment_saved", payload)
	return result, nil
}

func (s *Service) MoveLogicGateNodeAssignment(input store.LogicGateNodeAssignmentMoveInput) (store.LogicGateNodeAssignmentResult, error) {
	normalized, err := store.NormalizeLogicGateNodeAssignmentMoveInput(input)
	if err != nil {
		return store.LogicGateNodeAssignmentResult{}, err
	}
	result, err := s.repo.MoveLogicGateNodeAssignment(normalized)
	if err != nil {
		return store.LogicGateNodeAssignmentResult{}, err
	}
	payload := map[string]any{
		"board_id":      result.Card.BoardID,
		"card_id":       result.Card.CardID,
		"column_id":     result.Card.ColumnID,
		"logic_gate_id": result.Card.LogicGateID,
		"node_id":       result.Card.NodeID,
		"position":      result.Card.Position,
	}
	if normalized.PrioritySet {
		payload["priority_set"] = true
		payload["priority"] = normalized.Priority
	}
	if normalized.AssigneePolicySet {
		payload["assignee_policy"] = normalized.AssigneePolicy
	}
	s.appendCardEvent(result.Card, "work_item.logic_gate_assignment_moved", payload)
	return result, nil
}

func (s *Service) RemoveLogicGateNodeAssignment(input store.LogicGateNodeAssignmentRemoveInput) (store.LogicGateNodeAssignmentRemoveResult, error) {
	normalized, err := store.NormalizeLogicGateNodeAssignmentRemoveInput(input)
	if err != nil {
		return store.LogicGateNodeAssignmentRemoveResult{}, err
	}
	result, err := s.repo.RemoveLogicGateNodeAssignment(normalized)
	if err != nil {
		return store.LogicGateNodeAssignmentRemoveResult{}, err
	}
	s.appendCardEvent(result.Card, "work_item.logic_gate_assignment_removed", map[string]any{
		"board_id":      result.Card.BoardID,
		"card_id":       result.Card.CardID,
		"column_id":     result.Card.ColumnID,
		"logic_gate_id": result.Card.LogicGateID,
		"node_id":       result.Card.NodeID,
	})
	return result, nil
}

func (s *Service) SetLogicGateNodeAssignmentIssue(input store.LogicGateNodeAssignmentIssueInput) (store.LogicGateNodeAssignmentResult, error) {
	normalized, err := store.NormalizeLogicGateNodeAssignmentIssueInput(input)
	if err != nil {
		return store.LogicGateNodeAssignmentResult{}, err
	}
	result, err := s.repo.SetLogicGateNodeAssignmentIssue(normalized)
	if err != nil {
		return store.LogicGateNodeAssignmentResult{}, err
	}
	s.appendCardEvent(result.Card, "work_item.logic_gate_issue_toggled", map[string]any{
		"board_id":      result.Card.BoardID,
		"card_id":       result.Card.CardID,
		"column_id":     result.Card.ColumnID,
		"logic_gate_id": result.Card.LogicGateID,
		"node_id":       result.Card.NodeID,
		"is_issue":      result.Card.IsIssue,
	})
	return result, nil
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
