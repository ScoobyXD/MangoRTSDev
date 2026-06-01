package httpapi

import (
	"context"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type workspaceDerivedReplayTestRepo struct {
	*store.MemoryRepo
	checkpoint    store.NotificationDomainEventCheckpoint
	hasCheckpoint bool
	projectErr    error
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
			"system_folder_key": store.CompanyExplorerSystemActiveNodesKey,
			"item_type":         "node",
			"item_id":           "22222222-2222-4222-8222-222222222222",
		},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent: %v", err)
	}

	server := &Server{repo: repo, hub: newWorkspaceEventHub()}
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
