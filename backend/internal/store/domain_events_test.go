package store

import (
	"testing"
)

func TestMemoryDomainEventsSequenceAndIdempotency(t *testing.T) {
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
}

func TestMemoryDomainEventsRejectInvalidInput(t *testing.T) {
	repo := NewMemoryRepo()
	if _, err := repo.AppendDomainEvent(DomainEventInput{CompanyID: "company", StreamType: "node", StreamID: "node-1"}); err != ErrInvalid {
		t.Fatalf("AppendDomainEvent invalid err = %v, want ErrInvalid", err)
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

func TestMemoryDomainEventsCurrentSequenceFiltersEventType(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"
	for _, eventType := range []string{"workspace.snapshot_changed", "workspace.notification_sent", "workspace.snapshot_changed"} {
		if _, err := repo.AppendDomainEvent(DomainEventInput{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: eventType}); err != nil {
			t.Fatalf("AppendDomainEvent %s: %v", eventType, err)
		}
	}

	sequence, err := repo.CurrentDomainEventSequence(DomainEventStreamQuery{
		CompanyID:  companyID,
		StreamType: "workspace",
		StreamID:   companyID,
		EventTypes: []string{"workspace.notification_sent"},
	})
	if err != nil {
		t.Fatalf("CurrentDomainEventSequence filtered: %v", err)
	}
	if sequence != 2 {
		t.Fatalf("filtered sequence = %d, want 2", sequence)
	}

	sequence, err = repo.CurrentDomainEventSequence(DomainEventStreamQuery{CompanyID: companyID, StreamType: "workspace", StreamID: companyID})
	if err != nil {
		t.Fatalf("CurrentDomainEventSequence unfiltered: %v", err)
	}
	if sequence != 3 {
		t.Fatalf("unfiltered sequence = %d, want 3", sequence)
	}
}

func TestMemoryDomainEventsCurrentSequenceFiltersPayloadBoardID(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"
	inputs := []DomainEventInput{
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "kanban.card_moved", Payload: map[string]any{"board_id": "board-a"}},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "kanban.card_moved", Payload: map[string]any{"board_id": "board-b"}},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "kanban.column_updated", Payload: map[string]any{"board_id": "board-a"}},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "kanban.card_moved", Payload: map[string]any{"board_id": "board-a"}},
	}
	for index, input := range inputs {
		if _, err := repo.AppendDomainEvent(input); err != nil {
			t.Fatalf("AppendDomainEvent %d: %v", index, err)
		}
	}

	sequence, err := repo.CurrentDomainEventSequence(DomainEventStreamQuery{
		CompanyID:     companyID,
		StreamType:    "workspace",
		StreamID:      companyID,
		EventTypes:    []string{"kanban.card_moved"},
		PayloadEquals: map[string]string{"board_id": "board-a"},
	})
	if err != nil {
		t.Fatalf("CurrentDomainEventSequence board filtered: %v", err)
	}
	if sequence != 4 {
		t.Fatalf("board filtered sequence = %d, want 4", sequence)
	}

	sequence, err = repo.CurrentDomainEventSequence(DomainEventStreamQuery{
		CompanyID:     companyID,
		StreamType:    "workspace",
		StreamID:      companyID,
		EventTypes:    []string{"kanban.card_moved"},
		PayloadEquals: map[string]string{"board_id": "board-b"},
	})
	if err != nil {
		t.Fatalf("CurrentDomainEventSequence other board filtered: %v", err)
	}
	if sequence != 2 {
		t.Fatalf("other board filtered sequence = %d, want 2", sequence)
	}
}

func TestMemoryWorkspaceReadVersionsTrackScopedEventSemantics(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-222222222222"

	if _, err := repo.AppendDomainEvent(DomainEventInput{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "node_created"}); err != nil {
		t.Fatalf("AppendDomainEvent node_created: %v", err)
	}
	assertWorkspaceReadVersion(t, repo, companyID, "nodes", "", 1, true)
	assertWorkspaceReadVersion(t, repo, companyID, "workspace-snapshot:company_explorer", "", 1, true)
	assertWorkspaceReadVersion(t, repo, companyID, "workspace-snapshot:full", "", 1, true)

	if _, err := repo.AppendDomainEvent(DomainEventInput{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "relationship_created"}); err != nil {
		t.Fatalf("AppendDomainEvent relationship_created: %v", err)
	}
	assertWorkspaceReadVersion(t, repo, companyID, "node-relationships", "", 2, true)
	assertWorkspaceReadVersion(t, repo, companyID, "workspace-snapshot:full", "", 2, true)
}

func TestMemoryWorkspaceReadVersionsIgnoreInternalDerivedProjectionRequests(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-222222222223"
	for _, eventType := range []string{WorkspaceDerivedProjectionRequestedEventType, WorkspaceDeferredFolderItemAssignEventType} {
		if _, err := repo.AppendDomainEvent(DomainEventInput{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: eventType}); err != nil {
			t.Fatalf("AppendDomainEvent %s: %v", eventType, err)
		}
	}
	assertWorkspaceReadVersion(t, repo, companyID, "workspace-snapshot:full", "", 0, true)
	assertWorkspaceReadVersion(t, repo, companyID, "nodes", "", 0, true)
	assertWorkspaceReadVersion(t, repo, companyID, "workspace-snapshot:company_explorer", "", 0, true)
}

func TestWorkspaceDerivedProjectionRequestedEventInputUsesTaskPayload(t *testing.T) {
	input := WorkspaceDerivedProjectionRequestedEventInput(
		"company-1",
		[]WorkspaceDerivedProjectionTask{DeferredCompanyExplorerFolderItemAssignTask("", "active_nodes", "node", "node-1", 0)},
		"user-1",
	)
	if input.Type != WorkspaceDerivedProjectionRequestedEventType {
		t.Fatalf("event type = %q, want %q", input.Type, WorkspaceDerivedProjectionRequestedEventType)
	}
	tasks, ok := input.Payload["tasks"].([]map[string]any)
	if !ok {
		t.Fatalf("tasks payload type = %T, want []map[string]any", input.Payload["tasks"])
	}
	if len(tasks) != 1 || tasks[0]["kind"] != WorkspaceDerivedTaskCompanyExplorerFolderItemAssign {
		t.Fatalf("tasks = %+v", tasks)
	}
}

func TestMemoryWorkspaceReadVersionsTrackBoardResources(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-333333333333"
	boardA := WorkspaceReadVersionResourceKey("board_id", "board-a")
	boardB := WorkspaceReadVersionResourceKey("board_id", "board-b")

	if _, err := repo.AppendDomainEvent(DomainEventInput{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "kanban_column_created", Payload: map[string]any{"board_id": "board-a"}}); err != nil {
		t.Fatalf("AppendDomainEvent kanban_column_created: %v", err)
	}
	assertWorkspaceReadVersion(t, repo, companyID, "kanban-columns", boardA, 1, true)
	assertWorkspaceReadVersion(t, repo, companyID, "workspace-snapshot:kanban", boardA, 1, true)
	assertWorkspaceReadVersion(t, repo, companyID, "kanban-columns", boardB, 0, false)

	if _, err := repo.AppendDomainEvent(DomainEventInput{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "kanban_card_moved", Payload: map[string]any{"board_id": "board-b"}}); err != nil {
		t.Fatalf("AppendDomainEvent kanban_card_moved: %v", err)
	}
	assertWorkspaceReadVersion(t, repo, companyID, "kanban-columns", boardA, 1, true)
	assertWorkspaceReadVersion(t, repo, companyID, "kanban-cards", boardB, 2, true)
	assertWorkspaceReadVersion(t, repo, companyID, "workspace-snapshot:kanban", boardB, 2, true)
	assertWorkspaceReadVersion(t, repo, companyID, "nodes", "", 2, true)
}

func assertWorkspaceReadVersion(t *testing.T, repo *MemoryRepo, companyID, scope, resourceKey string, want int64, wantFound bool) {
	t.Helper()
	version, found, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: scope, ResourceKey: resourceKey})
	if err != nil {
		t.Fatalf("CurrentWorkspaceReadVersion(%s,%s): %v", scope, resourceKey, err)
	}
	if found != wantFound || version != want {
		t.Fatalf("CurrentWorkspaceReadVersion(%s,%s) = version %d found %t, want version %d found %t", scope, resourceKey, version, found, want, wantFound)
	}
}
