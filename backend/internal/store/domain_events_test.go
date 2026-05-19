package store

import "testing"

func TestMemoryDomainEventsSequenceIdempotencyAndPublish(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	first, err := repo.AppendDomainEvent(DomainEventInput{
		CompanyID:      companyID,
		StreamType:     "node",
		StreamID:       "node-1",
		Type:           "node.created",
		IdempotencyKey: "node-1:create",
		Payload:        map[string]any{"title": "First"},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent first: %v", err)
	}
	if first.Sequence != 1 {
		t.Fatalf("first sequence = %d, want 1", first.Sequence)
	}

	duplicate, err := repo.AppendDomainEvent(DomainEventInput{
		CompanyID:      companyID,
		StreamType:     "node",
		StreamID:       "node-1",
		Type:           "node.created",
		IdempotencyKey: "node-1:create",
		Payload:        map[string]any{"title": "Duplicate"},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent duplicate: %v", err)
	}
	if duplicate.EventID != first.EventID || duplicate.Sequence != first.Sequence {
		t.Fatalf("duplicate event = %+v, want original %+v", duplicate, first)
	}
	if duplicate.Payload["title"] != "First" {
		t.Fatalf("duplicate payload title = %v, want original payload", duplicate.Payload["title"])
	}

	second, err := repo.AppendDomainEvent(DomainEventInput{
		CompanyID:  companyID,
		StreamType: "node",
		StreamID:   "node-1",
		Type:       "node.updated",
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent second: %v", err)
	}
	if second.Sequence != 2 {
		t.Fatalf("second sequence = %d, want 2", second.Sequence)
	}

	otherStream, err := repo.AppendDomainEvent(DomainEventInput{
		CompanyID:  companyID,
		StreamType: "node",
		StreamID:   "node-2",
		Type:       "node.created",
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent other stream: %v", err)
	}
	if otherStream.Sequence != 1 {
		t.Fatalf("other stream sequence = %d, want 1", otherStream.Sequence)
	}

	pending, err := repo.ListPendingDomainEvents(10)
	if err != nil {
		t.Fatalf("ListPendingDomainEvents: %v", err)
	}
	if len(pending) != 3 {
		t.Fatalf("pending count = %d, want 3", len(pending))
	}

	if err := repo.MarkDomainEventPublished(companyID, first.EventID); err != nil {
		t.Fatalf("MarkDomainEventPublished: %v", err)
	}
	pending, err = repo.ListPendingDomainEvents(10)
	if err != nil {
		t.Fatalf("ListPendingDomainEvents after publish: %v", err)
	}
	if len(pending) != 2 {
		t.Fatalf("pending count after publish = %d, want 2", len(pending))
	}
}

func TestMemoryDomainEventsRejectInvalidInput(t *testing.T) {
	repo := NewMemoryRepo()
	if _, err := repo.AppendDomainEvent(DomainEventInput{CompanyID: "company", StreamType: "node", StreamID: "node-1"}); err != ErrInvalid {
		t.Fatalf("AppendDomainEvent invalid err = %v, want ErrInvalid", err)
	}
	if err := repo.MarkDomainEventPublished("", "event"); err != ErrInvalid {
		t.Fatalf("MarkDomainEventPublished invalid err = %v, want ErrInvalid", err)
	}
}

func TestMemoryDomainEventsReplayAfterSequence(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"
	for _, eventType := range []string{"workspace.node_created", "workspace.node_updated", "workspace.node_deleted"} {
		if _, err := repo.AppendDomainEvent(DomainEventInput{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: eventType}); err != nil {
			t.Fatalf("AppendDomainEvent %s: %v", eventType, err)
		}
	}

	replay, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, AfterSequence: 1, Limit: 10})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if len(replay) != 2 {
		t.Fatalf("replay count = %d, want 2", len(replay))
	}
	if replay[0].Sequence != 2 || replay[1].Sequence != 3 {
		t.Fatalf("replay sequences = %d,%d want 2,3", replay[0].Sequence, replay[1].Sequence)
	}
}
