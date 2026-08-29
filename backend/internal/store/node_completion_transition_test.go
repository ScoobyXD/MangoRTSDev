package store

import (
	"os"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestMemoryNodeCompletionTransitionProjectionTracksOnlyLatestEntry(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000013"
	nodeID := "20000000-0000-4000-8000-000000000013"
	transitionKey := key(companyID, nodeID)
	at := func(day int) time.Time { return time.Date(2026, time.August, day, 12, 0, 0, 0, time.UTC) }
	event := func(status string, created time.Time) domain.DomainEvent {
		return domain.DomainEvent{
			CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID,
			Type: "node_updated", Payload: map[string]any{"node": domain.Node{NodeID: nodeID, Status: stringPointer(status)}},
			CreatedTimestamp: created,
		}
	}

	wrongStream := event("done", at(24))
	wrongStream.StreamID = "another-workspace-stream"
	repo.applyNodeCompletionTransitionUpdatesLocked([]domain.DomainEvent{wrongStream})
	if _, exists := repo.nodeCompletionTransitions[transitionKey]; exists {
		t.Fatal("a non-canonical workspace stream must not alter the completion projection")
	}
	repo.applyNodeCompletionTransitionUpdatesLocked([]domain.DomainEvent{event("in progress", at(25))})
	if _, exists := repo.nodeCompletionTransitions[transitionKey]; exists {
		t.Fatal("non-complete snapshot must not project a completion transition")
	}
	repo.applyNodeCompletionTransitionUpdatesLocked([]domain.DomainEvent{event("done", at(26))})
	if got := repo.nodeCompletionTransitions[transitionKey]; !got.Equal(at(26)) {
		t.Fatalf("first completion transition = %s, want %s", got, at(26))
	}
	partialSnapshot := event("in progress", at(27))
	partialSnapshot.Payload["node"] = map[string]any{"node_id": nodeID}
	repo.applyNodeCompletionTransitionUpdatesLocked([]domain.DomainEvent{partialSnapshot})
	if got := repo.nodeCompletionTransitions[transitionKey]; !got.Equal(at(26)) {
		t.Fatalf("partial Node payload changed transition to %s, want %s", got, at(26))
	}
	repo.applyNodeCompletionTransitionUpdatesLocked([]domain.DomainEvent{event("done", at(27))})
	if got := repo.nodeCompletionTransitions[transitionKey]; !got.Equal(at(26)) {
		t.Fatalf("same-complete update changed transition to %s, want %s", got, at(26))
	}
	repo.applyNodeCompletionTransitionUpdatesLocked([]domain.DomainEvent{event("in progress", at(28))})
	if _, exists := repo.nodeCompletionTransitions[transitionKey]; exists {
		t.Fatal("reopening a Node must clear its current completion transition")
	}
	repo.applyNodeCompletionTransitionUpdatesLocked([]domain.DomainEvent{event("done", at(29))})
	if got := repo.nodeCompletionTransitions[transitionKey]; !got.Equal(at(29)) {
		t.Fatalf("re-completion transition = %s, want %s", got, at(29))
	}
}

func TestMemoryNodeCompletionTransitionIgnoresIdempotentEventReplay(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000014"
	nodeID := "20000000-0000-4000-8000-000000000014"
	done := stringPointer("done")
	inProgress := stringPointer("in progress")
	completionInput := DomainEventInput{
		CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID,
		Type: "node_updated", IdempotencyKey: "completion-once",
		Payload: map[string]any{"node": domain.Node{NodeID: nodeID, Status: done}},
	}
	if _, err := repo.AppendDomainEvent(completionInput); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AppendDomainEvent(DomainEventInput{
		CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID,
		Type: "node_updated", Payload: map[string]any{"node": domain.Node{NodeID: nodeID, Status: inProgress}},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AppendDomainEvent(completionInput); err != nil {
		t.Fatal(err)
	}
	repo.mu.RLock()
	defer repo.mu.RUnlock()
	if _, exists := repo.nodeCompletionTransitions[key(companyID, nodeID)]; exists {
		t.Fatal("replaying an old idempotent completion event must not restore its stale timestamp")
	}
}

func TestPostgresNodeCompletionTransitionSyncUsesOnlyInsertedEvents(t *testing.T) {
	source, err := os.ReadFile("postgres_domain_events.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, required := range []string{
		"return item, item.EventID == eventID, nil",
		"syncPostgresNodeCompletionTransitionsTx(ctx, tx, insertedEvents)",
		"if len(inputs) == 1 || domainEventInputsRequireSequentialAppend(inputs)",
		"syncPostgresNodeCompletionTransitionsTx(ctx, tx, events)",
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("PostgreSQL completion projection insertion guard missing %q", required)
		}
	}
}
