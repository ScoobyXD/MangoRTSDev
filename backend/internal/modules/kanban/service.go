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
	Events      []domain.DomainEvent
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) UpsertCard(input store.KanbanCardMutationInput) (CardCommandResult, error) {
	result, err := s.repo.UpsertKanbanCardWithWorkspaceEvent(input)
	if err != nil {
		return CardCommandResult{}, err
	}
	return CardCommandResult{Card: result.Card, DerivedNode: result.DerivedNode, Events: result.Events}, nil
}

func (s *Service) MoveCard(input store.KanbanCardMoveInput) (CardCommandResult, error) {
	result, err := s.repo.MoveKanbanCardWithWorkspaceEvent(input)
	if err != nil {
		return CardCommandResult{}, err
	}
	return CardCommandResult{Card: result.Card, DerivedNode: result.DerivedNode, Events: result.Events}, nil
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
	return result, nil
}
