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

func TestMemoryWorkspaceReadVersionsTrackProcessResources(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-333333333333"
	processA := WorkspaceReadVersionResourceKey("logic_gate_id", "process-a")
	processB := WorkspaceReadVersionResourceKey("logic_gate_id", "process-b")

	if _, err := repo.AppendDomainEvent(DomainEventInput{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: ProcessWorkChangedEventType, Payload: map[string]any{"logic_gate_id": "process-a"}}); err != nil {
		t.Fatalf("AppendDomainEvent Process work: %v", err)
	}
	assertWorkspaceReadVersion(t, repo, companyID, logicGateWorkReadVersionScope, processA, 1, true)
	assertWorkspaceReadVersion(t, repo, companyID, logicGateWorkReadVersionScope, processB, 0, false)

	if _, err := repo.AppendDomainEvent(DomainEventInput{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: WorkItemLogicGateAssignmentMovedEventType, Payload: map[string]any{"source_logic_gate_id": "process-a", "logic_gate_id": "process-b"}}); err != nil {
		t.Fatalf("AppendDomainEvent Process move: %v", err)
	}
	assertWorkspaceReadVersion(t, repo, companyID, logicGateWorkReadVersionScope, processA, 2, true)
	assertWorkspaceReadVersion(t, repo, companyID, logicGateWorkReadVersionScope, processB, 1, true)
	assertWorkspaceReadVersion(t, repo, companyID, "nodes", "", 2, true)
}

func TestProcessWorkVersionsFollowFolderPermissionAncestry(t *testing.T) {
	repo, companyID, gate, node := processStepsFixture(t)
	other, err := repo.CreateLogicGate(companyID, "Unrelated Process")
	if err != nil {
		t.Fatal(err)
	}
	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Parent")
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "logic_gate", "Child")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, child.FolderID, EntityTypeLogicGate, gate.LogicGateID, 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "Pending"}); err != nil {
		t.Fatal(err)
	}
	workVersion := func(processID string) int64 {
		t.Helper()
		version, err := repo.CurrentLogicGateWorkVersion(companyID, processID)
		if err != nil {
			t.Fatal(err)
		}
		return version
	}
	before, otherBefore := workVersion(gate.LogicGateID), workVersion(other.LogicGateID)
	if _, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Unrelated folder"); err != nil {
		t.Fatal(err)
	}
	if workVersion(gate.LogicGateID) != before || workVersion(other.LogicGateID) != otherBefore {
		t.Fatal("Creating an unrelated folder must not change Process work versions")
	}
	noAccess := EntityPermissionNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: parent.FolderID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatal(err)
	}
	if workVersion(gate.LogicGateID) <= before || workVersion(other.LogicGateID) != otherBefore {
		t.Fatal("Ancestor permission changes must refresh the affected Process work only")
	}
	before = workVersion(gate.LogicGateID)
	if _, err := repo.MoveCompanyExplorerFolder(companyID, child.FolderID, nil, 1000, "", ""); err != nil {
		t.Fatal(err)
	}
	if workVersion(gate.LogicGateID) <= before || workVersion(other.LogicGateID) != otherBefore {
		t.Fatal("Reparenting a Process ancestor must refresh its work only")
	}
}

func TestMemoryWorkspaceReadVersionsTrackProcessMapWithoutRetiredScope(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-444444444444"

	staticRows := WorkspaceReadVersionStaticRows(companyID)
	foundProcessMap := false
	for _, row := range staticRows {
		if row.Scope == "logic-gate-relationships" {
			t.Fatal("static read versions retained removed logic-gate relationship scope")
		}
		if row.Scope == "process-map" && row.ResourceKey == "" {
			foundProcessMap = true
		}
	}
	if !foundProcessMap {
		t.Fatal("static read versions missing shared process-map scope")
	}

	events := []DomainEventInput{
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "process_map_placement_saved"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "process_map_placement_deleted"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "resource_operational_relationship_created"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "resource_operational_relationship_deleted"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "process_map_trace_saved"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "logic_gate_updated"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "logic_gate_deleted"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "logic_gate_permissions_updated"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "company_explorer_folder_updated"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "company_explorer_folder_deleted"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "company_explorer_folder_permissions_updated"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "company_explorer_item_placed"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "company_explorer_item_removed"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "company_user_group_updated"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "company_user_group_deleted"},
		{CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "company_user_group_members_updated"},
	}
	for index, input := range events {
		if _, err := repo.AppendDomainEvent(input); err != nil {
			t.Fatalf("AppendDomainEvent %s: %v", input.Type, err)
		}
		assertWorkspaceReadVersion(t, repo, companyID, "process-map", "", int64(index+1), true)
	}

	if _, err := repo.AppendDomainEvent(DomainEventInput{
		CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "logic_gate_created",
	}); err != nil {
		t.Fatalf("AppendDomainEvent ordinary logic_gate_created: %v", err)
	}
	assertWorkspaceReadVersion(t, repo, companyID, "process-map", "", int64(len(events)+1), true)

	if _, err := repo.AppendDomainEvent(DomainEventInput{
		CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "logic_gate_created",
		Payload: map[string]any{"realtime_change_type": "resource_restored"},
	}); err != nil {
		t.Fatalf("AppendDomainEvent restored logic_gate_created: %v", err)
	}
	assertWorkspaceReadVersion(t, repo, companyID, "process-map", "", int64(len(events)+2), true)
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
