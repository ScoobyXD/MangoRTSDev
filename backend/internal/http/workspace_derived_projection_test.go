package httpapi

import (
	"context"
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type workspaceDerivedReplayTestRepo struct {
	*store.MemoryRepo
	checkpoint    store.NotificationDomainEventCheckpoint
	hasCheckpoint bool
	projectErr    error
	projectErrs   map[string]error
	projectCalls  int
}

func (r *workspaceDerivedReplayTestRepo) GetWorkspaceDerivedDomainEventCheckpoint(companyID string) (store.NotificationDomainEventCheckpoint, bool, error) {
	if !r.hasCheckpoint {
		return store.NotificationDomainEventCheckpoint{}, false, nil
	}
	return r.checkpoint, true, nil
}

func (r *workspaceDerivedReplayTestRepo) SaveWorkspaceDerivedDomainEventCheckpoint(checkpoint store.NotificationDomainEventCheckpoint) error {
	r.checkpoint = checkpoint
	r.hasCheckpoint = true
	return nil
}

func (r *workspaceDerivedReplayTestRepo) ProjectWorkspaceDerivedDomainEvent(event domain.DomainEvent) ([]domain.DomainEvent, error) {
	r.projectCalls++
	if r.projectErrs != nil {
		if err := r.projectErrs[event.EventID]; err != nil {
			return nil, err
		}
	}
	return nil, r.projectErr
}

func TestWorkspaceDerivedReplayCheckpointsMissingTargets(t *testing.T) {
	repo := &workspaceDerivedReplayTestRepo{
		MemoryRepo: store.NewMemoryRepo(),
		projectErr: store.ErrNotFound,
	}
	companyID := "11111111-1111-1111-1111-111111111111"
	event, err := repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:  companyID,
		StreamType: workspaceDomainStreamType,
		StreamID:   companyID,
		Type:       store.WorkspaceDeferredFolderItemAssignEventType,
		Payload: map[string]any{
			"system_folder_key": "active_logic_gates",
			"item_type":         "logic_gate",
			"item_id":           "22222222-2222-4222-8222-222222222222",
		},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent: %v", err)
	}

	server := &Server{repo: repo}
	if err := server.replayWorkspaceDerivedDomainEvents(context.Background(), repo, companyID, 10); err != nil {
		t.Fatalf("replayWorkspaceDerivedDomainEvents: %v", err)
	}
	if repo.projectCalls != 1 {
		t.Fatalf("project calls = %d, want 1", repo.projectCalls)
	}
	if !repo.hasCheckpoint {
		t.Fatal("missing checkpoint after skipped derived projection")
	}
	if repo.checkpoint.CompanyID != companyID || repo.checkpoint.EventID != event.EventID || !repo.checkpoint.CreatedTimestamp.Equal(event.CreatedTimestamp) {
		t.Fatalf("checkpoint = %+v, want event %+v", repo.checkpoint, event)
	}
}

func TestWorkspaceDerivedImmediateProjectionAdvancesCheckpointOnSuccess(t *testing.T) {
	repo := &workspaceDerivedReplayTestRepo{MemoryRepo: store.NewMemoryRepo()}
	companyID := "11111111-1111-1111-1111-111111111112"
	first := appendWorkspaceDerivedProjectionEventForTest(t, repo, companyID)
	second := appendWorkspaceDerivedProjectionEventForTest(t, repo, companyID)

	server := &Server{}
	server.projectCommittedWorkspaceDerivedEventsAsync(repo, []domain.DomainEvent{first, second})

	if repo.projectCalls != 2 {
		t.Fatalf("project calls = %d, want 2", repo.projectCalls)
	}
	if !repo.hasCheckpoint {
		t.Fatal("missing checkpoint after immediate projection")
	}
	if repo.checkpoint.EventID != second.EventID || !repo.checkpoint.CreatedTimestamp.Equal(second.CreatedTimestamp) {
		t.Fatalf("checkpoint = %+v, want second event %+v", repo.checkpoint, second)
	}
}

func TestWorkspaceDerivedImmediateProjectionStopsCheckpointAtFailure(t *testing.T) {
	repo := &workspaceDerivedReplayTestRepo{MemoryRepo: store.NewMemoryRepo(), projectErrs: map[string]error{}}
	companyID := "11111111-1111-1111-1111-111111111113"
	first := appendWorkspaceDerivedProjectionEventForTest(t, repo, companyID)
	second := appendWorkspaceDerivedProjectionEventForTest(t, repo, companyID)
	repo.projectErrs[second.EventID] = errors.New("projection failed")

	server := &Server{}
	server.projectCommittedWorkspaceDerivedEventsAsync(repo, []domain.DomainEvent{first, second})

	if repo.projectCalls != 2 {
		t.Fatalf("project calls = %d, want 2", repo.projectCalls)
	}
	if !repo.hasCheckpoint {
		t.Fatal("missing checkpoint after first projection")
	}
	if repo.checkpoint.EventID != first.EventID || !repo.checkpoint.CreatedTimestamp.Equal(first.CreatedTimestamp) {
		t.Fatalf("checkpoint = %+v, want first event %+v", repo.checkpoint, first)
	}
}

func TestWorkspaceDerivedImmediateProjectionCheckpointsMissingTargets(t *testing.T) {
	repo := &workspaceDerivedReplayTestRepo{
		MemoryRepo: store.NewMemoryRepo(),
		projectErr: store.ErrNotFound,
	}
	companyID := "11111111-1111-1111-1111-111111111114"
	event := appendWorkspaceDerivedProjectionEventForTest(t, repo, companyID)

	server := &Server{}
	server.projectCommittedWorkspaceDerivedEventsAsync(repo, []domain.DomainEvent{event})

	if repo.projectCalls != 1 {
		t.Fatalf("project calls = %d, want 1", repo.projectCalls)
	}
	if !repo.hasCheckpoint {
		t.Fatal("missing checkpoint after skipped immediate projection")
	}
	if repo.checkpoint.EventID != event.EventID || !repo.checkpoint.CreatedTimestamp.Equal(event.CreatedTimestamp) {
		t.Fatalf("checkpoint = %+v, want event %+v", repo.checkpoint, event)
	}
}

func appendWorkspaceDerivedProjectionEventForTest(t *testing.T, repo *workspaceDerivedReplayTestRepo, companyID string) domain.DomainEvent {
	t.Helper()
	event, err := repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:  companyID,
		StreamType: workspaceDomainStreamType,
		StreamID:   companyID,
		Type:       store.WorkspaceDerivedProjectionRequestedEventType,
		Payload: map[string]any{
			"tasks": []map[string]any{{
				"kind":      store.WorkspaceDerivedTaskCompanyExplorerFolderItemAssign,
				"item_type": "logic_gate",
				"item_id":   "22222222-2222-4222-8222-222222222222",
			}},
		},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent: %v", err)
	}
	return event
}
