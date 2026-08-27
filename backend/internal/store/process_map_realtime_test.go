package store

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestProcessMapRealtimeDoorbellIsCompactStableAndCompanyScoped(t *testing.T) {
	companyID := "89898989-8989-4989-8989-898989898981"
	first, err := processMapChangedOutboxInput(companyID, []string{"event-b", "event-a", "event-a"}, []string{"user-b", "user-a"}, "", false)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := processMapChangedOutboxInput(companyID, []string{"event-a", "event-b"}, []string{"user-a"}, "connection-a", false)
	if err != nil {
		t.Fatal(err)
	}
	if first.EventID != retry.EventID {
		t.Fatalf("doorbell event identity changed across event ordering: %s != %s", first.EventID, retry.EventID)
	}
	if first.Scope != processMapRealtimeScope || first.EventType != "process_map.changed" || !first.AudienceRestricted {
		t.Fatalf("doorbell scope/type/audience = %+v", first)
	}
	var payload map[string]any
	if err := json.Unmarshal(first.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload) != 4 || payload["type"] != "process_map.changed" || payload["company_id"] != companyID || payload["scope"] != processMapRealtimeScope || payload["protected_geometry_changed"] != false {
		t.Fatalf("doorbell leaked more than compact invalidation fields: %s", first.Payload)
	}
	if err := json.Unmarshal(retry.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload) != 5 || payload["origin_connection_id"] != "connection-a" || payload["protected_geometry_changed"] != false {
		t.Fatalf("correlated doorbell payload = %s", retry.Payload)
	}
	protected, err := processMapChangedOutboxInput(companyID, []string{"event-a"}, []string{"user-a"}, "", true)
	if err != nil {
		t.Fatal(err)
	}
	var protectedPayload map[string]any
	if err := json.Unmarshal(protected.Payload, &protectedPayload); err != nil {
		t.Fatal(err)
	}
	if len(protectedPayload) != 4 || protectedPayload["protected_geometry_changed"] != true {
		t.Fatalf("protected-geometry doorbell payload = %s", protected.Payload)
	}
}

func TestMemoryProcessMapRealtimeDoorbellUsesCompanyAudienceForFolderCreation(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "89898989-8989-4989-8989-898989898982"
	repo.EnsureCompany(companyID, "Process Map Realtime")
	user := mustCreateRACIMembershipUser(t, repo, "process-map-realtime-user", companyID)
	resetMemoryMembershipEventState(repo)
	if _, err := repo.AppendDomainEvent(workspaceDomainEventInput(
		companyID,
		"company_explorer_folder_created",
		map[string]any{"folder_id": "89898989-8989-4989-8989-898989898983"},
	)); err != nil {
		t.Fatal(err)
	}
	if len(repo.realtimeOutbox) != 1 {
		t.Fatalf("process map outbox rows = %d, want 1", len(repo.realtimeOutbox))
	}
	for _, event := range repo.realtimeOutbox {
		if event.Scope != processMapRealtimeScope || len(event.AllowedUserIDs) != 1 || event.AllowedUserIDs[0] != user.UserID {
			t.Fatalf("process map outbox audience = %+v", event)
		}
	}
}

func TestMemoryProcessMapRealtimeCoalescesDomainEventBatch(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "89898989-8989-4989-8989-898989898984"
	repo.EnsureCompany(companyID, "Process Map Coalescing")
	mustCreateRACIMembershipUser(t, repo, "process-map-coalescing-user", companyID)
	resetMemoryMembershipEventState(repo)

	if _, err := repo.AppendDomainEvents([]DomainEventInput{
		workspaceDomainEventInput(companyID, "logic_gate_permissions_updated", map[string]any{}),
		workspaceDomainEventInput(companyID, "company_explorer_folder_permissions_updated", map[string]any{}),
	}); err != nil {
		t.Fatal(err)
	}
	if len(repo.realtimeOutbox) != 1 {
		t.Fatalf("Process Map batch outbox rows = %d, want one coalesced row", len(repo.realtimeOutbox))
	}
}

func TestMemoryProcessMapRealtimeMarksProtectedGeometryChanges(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "89898989-8989-4989-8989-898989898977"
	repo.EnsureCompany(companyID, "Process Map Presentation Refresh")
	mustCreateRACIMembershipUser(t, repo, "process-map-presentation-user", companyID)
	resetMemoryMembershipEventState(repo)

	appendAndReadPayload := func(inputs []DomainEventInput) map[string]any {
		t.Helper()
		repo.realtimeOutbox = map[string]RealtimeOutboxEvent{}
		repo.realtimeOutboxSequence = 0
		if _, err := repo.AppendDomainEvents(inputs); err != nil {
			t.Fatal(err)
		}
		if len(repo.realtimeOutbox) != 1 {
			t.Fatalf("Process Map outbox rows = %d, want 1", len(repo.realtimeOutbox))
		}
		for _, item := range repo.realtimeOutbox {
			var payload map[string]any
			if err := json.Unmarshal(item.Payload, &payload); err != nil {
				t.Fatal(err)
			}
			return payload
		}
		return nil
	}

	scorecardPayload := appendAndReadPayload([]DomainEventInput{
		workspaceDomainEventInput(companyID, QDRatingRealtimeEventType, map[string]any{"logic_gate_id": "one"}),
	})
	if scorecardPayload["protected_geometry_changed"] != false {
		t.Fatalf("scorecard Process Map payload = %+v, want protected_geometry_changed=false", scorecardPayload)
	}

	mixedPayload := appendAndReadPayload([]DomainEventInput{
		workspaceDomainEventInput(companyID, QDRatingRealtimeEventType, map[string]any{"logic_gate_id": "two"}),
		workspaceDomainEventInput(companyID, "logic_gate_permissions_updated", map[string]any{"logic_gate_id": "two"}),
	})
	if mixedPayload["protected_geometry_changed"] != true {
		t.Fatalf("mixed Process Map payload = %+v, want protected_geometry_changed=true", mixedPayload)
	}
}

func TestMemoryProcessMapMutationsKeepCompanyAudienceAndCorrelateExactOrigin(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "89898989-8989-4989-8989-898989898980"
	repo.EnsureCompany(companyID, "Process Map Direct Mutations")
	actor := mustCreateRACIMembershipUser(t, repo, "process-map-direct-actor", companyID)
	other := mustCreateRACIMembershipUser(t, repo, "process-map-direct-other", companyID)
	resetMemoryMembershipEventState(repo)

	if _, err := repo.AppendDomainEvents([]DomainEventInput{
		processMapMutationEventInput(companyID, actor.UserID, "connection-a", ProcessMapPlacementSavedEvent, map[string]any{}),
		processMapMutationEventInput(companyID, actor.UserID, "connection-a", ResourceOperationalRelationshipCreatedEvent, map[string]any{}),
		processMapMutationEventInput(companyID, actor.UserID, "connection-a", ProcessMapTraceSavedEvent, map[string]any{}),
	}); err != nil {
		t.Fatal(err)
	}
	if len(repo.realtimeOutbox) != 1 {
		t.Fatalf("direct Process Map mutations enqueued %d refresh hints, want one for other viewers", len(repo.realtimeOutbox))
	}
	for _, item := range repo.realtimeOutbox {
		wantAudience := []string{actor.UserID, other.UserID}
		slices.Sort(wantAudience)
		if !reflect.DeepEqual(item.AllowedUserIDs, wantAudience) {
			t.Fatalf("direct Process Map refresh audience = %v, want every viewer %v", item.AllowedUserIDs, wantAudience)
		}
		var payload map[string]any
		if err := json.Unmarshal(item.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if payload["origin_connection_id"] != "connection-a" {
			t.Fatalf("direct Process Map refresh payload = %s", item.Payload)
		}
	}
	if got := repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "process-map", "")]; got != 3 {
		t.Fatalf("Process Map read version = %d, want 3", got)
	}
}

func TestProcessMapRealtimeOriginRequiresEveryRelevantEventToShareOneDirectConnection(t *testing.T) {
	companyID := "89898989-8989-4989-8989-898989898979"
	event := func(eventID, eventType, connectionID string) domain.DomainEvent {
		payload := map[string]any{}
		if connectionID != "" {
			payload[processMapRealtimeOriginConnectionIDPayloadKey] = connectionID
		}
		return domain.DomainEvent{
			CompanyID: companyID, EventID: eventID, StreamType: workspaceDomainStreamType,
			StreamID: companyID, Type: eventType, Payload: payload,
		}
	}
	for _, test := range []struct {
		name   string
		events []domain.DomainEvent
		want   string
	}{
		{
			name: "same direct connection",
			events: []domain.DomainEvent{
				event("one", ProcessMapPlacementSavedEvent, "connection-a"),
				event("two", ProcessMapTraceSavedEvent, "connection-a"),
			},
			want: "connection-a",
		},
		{
			name: "different direct connections",
			events: []domain.DomainEvent{
				event("one", ProcessMapPlacementSavedEvent, "connection-a"),
				event("two", ProcessMapTraceSavedEvent, "connection-b"),
			},
		},
		{
			name: "missing direct connection",
			events: []domain.DomainEvent{
				event("one", ProcessMapPlacementSavedEvent, "connection-a"),
				event("two", ProcessMapTraceSavedEvent, ""),
			},
		},
		{
			name: "source visibility event",
			events: []domain.DomainEvent{
				event("one", ProcessMapPlacementSavedEvent, "connection-a"),
				event("two", "logic_gate_permissions_updated", "connection-a"),
			},
		},
		{
			name: "unrelated event ignored",
			events: []domain.DomainEvent{
				event("one", ProcessMapPlacementSavedEvent, "connection-a"),
				event("two", "node_updated", ""),
			},
			want: "connection-a",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := processMapChangedOriginConnectionIDsByCompany(test.events)[companyID]; got != test.want {
				t.Fatalf("origin connection = %q, want %q", got, test.want)
			}
		})
	}
}

func TestProcessMapRealtimeProtectedGeometryChangedOnlyForVisibilityInvalidators(t *testing.T) {
	companyID := "89898989-8989-4989-8989-898989898978"
	event := func(eventID, eventType string) domain.DomainEvent {
		return domain.DomainEvent{
			CompanyID: companyID, EventID: eventID, StreamType: workspaceDomainStreamType,
			StreamID: companyID, Type: eventType,
		}
	}
	for _, eventType := range []string{
		"logic_gate_permissions_updated", "company_explorer_folder_permissions_updated",
		"company_user_group_deleted", "company_user_group_members_updated",
		CompanyMembershipSavedEventType, CompanyMembershipDeletedEventType,
	} {
		t.Run("protected "+eventType, func(t *testing.T) {
			if got := processMapChangedProtectedGeometryChangedByCompany([]domain.DomainEvent{event("one", eventType)})[companyID]; !got {
				t.Fatalf("protected geometry changed = %v, want true", got)
			}
		})
	}
	for _, eventType := range []string{
		ProcessMapPlacementSavedEvent, ProcessMapPlacementDeletedEvent,
		ResourceOperationalRelationshipCreatedEvent, ResourceOperationalRelationshipDeletedEvent,
		ProcessMapTraceSavedEvent,
		"company_explorer_folder_created", "company_explorer_folder_updated", "company_explorer_folder_deleted",
		"company_explorer_item_placed", "company_explorer_item_removed",
		"logic_gate_created", "logic_gate_updated", "logic_gate_deleted", "logic_gate_gvic_updated",
		QDRatingRealtimeEventType, CompanyUserProfileUpdatedEventType, "company_user_group_updated",
	} {
		t.Run("unprotected "+eventType, func(t *testing.T) {
			if got := processMapChangedProtectedGeometryChangedByCompany([]domain.DomainEvent{event("one", eventType)})[companyID]; got {
				t.Fatalf("protected geometry changed = %v, want false", got)
			}
		})
	}

	events := []domain.DomainEvent{
		event("one", "logic_gate_updated"),
		event("two", "company_user_group_members_updated"),
		event("three", "node_updated"),
	}
	if got := processMapChangedProtectedGeometryChangedByCompany(events)[companyID]; !got {
		t.Fatalf("mixed protected geometry changed = %v, want true", got)
	}
	markedReparent := event("four", "company_explorer_item_placed")
	markedReparent.Payload = map[string]any{processMapProtectedGeometryChangedPayloadKey: true}
	if got := processMapChangedProtectedGeometryChangedByCompany([]domain.DomainEvent{markedReparent})[companyID]; !got {
		t.Fatalf("marked Explorer reparent protected geometry changed = %v, want true", got)
	}
	unmarkedReparent := event("five", "company_explorer_item_placed")
	unmarkedReparent.Payload = map[string]any{processMapProtectedGeometryChangedPayloadKey: false}
	if got := processMapChangedProtectedGeometryChangedByCompany([]domain.DomainEvent{unmarkedReparent})[companyID]; got {
		t.Fatalf("same-audience Explorer reparent protected geometry changed = %v, want false", got)
	}
	markedGroupHierarchy := event("six", "company_user_group_updated")
	markedGroupHierarchy.Payload = map[string]any{processMapProtectedGeometryChangedPayloadKey: true}
	if got := processMapChangedProtectedGeometryChangedByCompany([]domain.DomainEvent{markedGroupHierarchy})[companyID]; !got {
		t.Fatalf("group hierarchy update protected geometry changed = %v, want true", got)
	}
}

func requireMemoryProcessMapProtectedGeometryChanged(t *testing.T, repo *MemoryRepo, want bool) {
	t.Helper()
	found := 0
	for _, item := range repo.realtimeOutbox {
		if item.Scope != processMapRealtimeScope {
			continue
		}
		found++
		var payload map[string]any
		if err := json.Unmarshal(item.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if got, ok := payload[processMapProtectedGeometryChangedPayloadKey].(bool); !ok || got != want {
			t.Fatalf("Process Map realtime payload = %+v, want protected_geometry_changed=%v", payload, want)
		}
	}
	if found != 1 {
		t.Fatalf("Process Map realtime rows = %d, want 1", found)
	}
}

func TestMemoryExplorerReparentMarksOnlyChangedAccessAudienceAndRollsBack(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	openA, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Open A")
	if err != nil {
		t.Fatal(err)
	}
	openB, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Open B")
	if err != nil {
		t.Fatal(err)
	}
	restricted, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Restricted")
	if err != nil {
		t.Fatal(err)
	}
	noAccess := ResourceDefaultAccessNoAccess
	putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: restricted.FolderID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: PolicyDescendantActionInheritedOnly,
	})

	gate, err := repo.CreateLogicGate(companyID, "Moving gate")
	if err != nil {
		t.Fatal(err)
	}
	placedGate, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID: companyID, ParentEntityID: openA.FolderID,
		ChildEntityType: CompanyExplorerV2EntityLogicGate, ChildResourceID: gate.LogicGateID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}

	resetMemoryMembershipEventState(repo)
	movedGate, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: companyID, EdgeID: placedGate.EdgeID, ParentEntityID: openB.FolderID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	requireMemoryProcessMapProtectedGeometryChanged(t, repo, false)

	resetMemoryMembershipEventState(repo)
	movedGate, err = repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: companyID, EdgeID: movedGate.EdgeID, ParentEntityID: restricted.FolderID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	requireMemoryProcessMapProtectedGeometryChanged(t, repo, true)

	resetMemoryMembershipEventState(repo)
	movedGate, err = repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: companyID, EdgeID: movedGate.EdgeID, ParentEntityID: openB.FolderID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	requireMemoryProcessMapProtectedGeometryChanged(t, repo, true)

	resetMemoryMembershipEventState(repo)
	before := repo.snapshotProcessMapMutationLocked()
	forced := errors.New("forced Explorer reparent event failure")
	repo.domainEventAppendErr = forced
	_, err = repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: companyID, EdgeID: movedGate.EdgeID, ParentEntityID: restricted.FolderID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	repo.domainEventAppendErr = nil
	if !errors.Is(err, forced) {
		t.Fatalf("failed Explorer reparent error = %v, want %v", err, forced)
	}
	if after := repo.snapshotProcessMapMutationLocked(); !reflect.DeepEqual(after, before) {
		t.Fatal("failed Explorer reparent changed canonical, policy, event, or realtime state")
	}
}

func TestMemoryExplorerV2FolderReparentNormalizesProcessMapResourceType(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	open, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Open")
	if err != nil {
		t.Fatal(err)
	}
	restricted, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Restricted")
	if err != nil {
		t.Fatal(err)
	}
	noAccess := ResourceDefaultAccessNoAccess
	putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: restricted.FolderID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: PolicyDescendantActionInheritedOnly,
	})
	nested, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID: companyID, ParentEntityID: open.FolderID, Name: "Nested",
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}

	resetMemoryMembershipEventState(repo)
	if _, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: companyID, EdgeID: nested.EdgeID, ParentEntityID: restricted.FolderID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	requireMemoryProcessMapProtectedGeometryChanged(t, repo, true)
}

func TestProcessMapRealtimeFilterIncludesAutomaticPlacementSourcesAndVisibility(t *testing.T) {
	companyID := "89898989-8989-4989-8989-898989898985"
	event := func(eventType string, payload map[string]any) domain.DomainEvent {
		return domain.DomainEvent{
			CompanyID: companyID, EventID: eventType, StreamType: workspaceDomainStreamType,
			StreamID: companyID, Type: eventType, Payload: payload,
		}
	}
	for _, eventType := range []string{
		"company_explorer_folder_created",
		"logic_gate_permissions_updated", "company_explorer_folder_permissions_updated",
		"company_user_group_updated", "company_user_group_deleted", "company_user_group_members_updated",
		CompanyMembershipSavedEventType, CompanyMembershipDeletedEventType, CompanyUserProfileUpdatedEventType,
	} {
		if !isProcessMapChangedDomainEvent(event(eventType, nil)) {
			t.Errorf("Process Map realtime ignored visibility event %q", eventType)
		}
	}
	if !isProcessMapChangedDomainEvent(event("logic_gate_created", nil)) {
		t.Error("ordinary Process creation must invalidate its automatic Process Map placement")
	}
	if !isProcessMapChangedDomainEvent(event("logic_gate_created", map[string]any{"realtime_change_type": "resource_restored"})) {
		t.Error("restored source creation must invalidate restored Process Map state")
	}
	for _, eventType := range []string{
		ProcessMapPlacementSavedEvent, ProcessMapPlacementDeletedEvent,
		ResourceOperationalRelationshipCreatedEvent, ResourceOperationalRelationshipDeletedEvent,
		ProcessMapTraceSavedEvent,
	} {
		if !isProcessMapChangedDomainEvent(event(eventType, nil)) {
			t.Errorf("direct Process Map mutation %q must refresh other viewers", eventType)
		}
	}
}

func TestPostgresDomainEventBatchHelperDoesNotEnqueueRealtime(t *testing.T) {
	source, err := os.ReadFile("postgres_domain_events.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	start := strings.Index(text, "func (r *PostgresRepo) appendDomainEventBatchTx")
	if start < 0 {
		t.Fatal("appendDomainEventBatchTx source block not found")
	}
	end := strings.Index(text[start:], "func (r *PostgresRepo) ListDomainEventsAfter")
	if end < 0 {
		t.Fatal("appendDomainEventBatchTx source block terminator not found")
	}
	block := text[start : start+end]
	if strings.Contains(block, "enqueueKanbanRealtime") || strings.Contains(block, "enqueueRACITabsRealtime") || strings.Contains(block, "enqueueProcessMapRealtime") {
		t.Error("record-batch helper must not enqueue realtime; appendDomainEventsTx owns one coalesced producer pass")
	}
}

func TestMemoryCompanyUserGroupMutationsAtomicallyInvalidateProcessMap(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "89898989-8989-4989-8989-898989898986"
	repo.EnsureCompany(companyID, "Process Map Group Visibility")
	user := mustCreateRACIMembershipUser(t, repo, "process-map-group-user", companyID)
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Operators")
	if err != nil {
		t.Fatal(err)
	}
	parent, err := repo.CreateCompanyUserGroup(companyID, "", "Parent")
	if err != nil {
		t.Fatal(err)
	}

	assertMutation := func(wantEventType string, wantProtectedGeometryChanged bool, mutate func() error) {
		t.Helper()
		repo.domainEvents = map[string]domain.DomainEvent{}
		repo.workspaceReadVersions = map[string]int64{}
		repo.realtimeOutbox = map[string]RealtimeOutboxEvent{}
		repo.realtimeOutboxSequence = 0
		if err := mutate(); err != nil {
			t.Fatalf("%s: %v", wantEventType, err)
		}
		if len(repo.domainEvents) != 1 {
			t.Fatalf("%s domain events = %d, want 1", wantEventType, len(repo.domainEvents))
		}
		for _, event := range repo.domainEvents {
			if event.Type != wantEventType {
				t.Fatalf("event type = %q, want %q", event.Type, wantEventType)
			}
		}
		scopeCounts := map[string]int{}
		for _, item := range repo.realtimeOutbox {
			scopeCounts[item.Scope]++
			if item.Scope == processMapRealtimeScope {
				var payload map[string]any
				if err := json.Unmarshal(item.Payload, &payload); err != nil {
					t.Fatal(err)
				}
				if got, ok := payload[processMapProtectedGeometryChangedPayloadKey].(bool); !ok || got != wantProtectedGeometryChanged {
					t.Fatalf("%s Process Map payload = %+v, want protected_geometry_changed=%v", wantEventType, payload, wantProtectedGeometryChanged)
				}
			}
		}
		if scopeCounts[processMapRealtimeScope] != 1 || scopeCounts[raciTabsRealtimeScope] != 1 || len(repo.realtimeOutbox) != 2 {
			t.Fatalf("%s outbox scopes = %+v, want one Process Map and one RACI Tabs row", wantEventType, scopeCounts)
		}
		if got := repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "process-map", "")]; got != 1 {
			t.Fatalf("%s Process Map read version = %d, want 1", wantEventType, got)
		}
	}

	assertMutation("company_user_group_members_updated", true, func() error {
		_, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{user.UserID})
		return err
	})
	assertMutation("company_user_group_updated", false, func() error {
		_, err := repo.UpdateCompanyUserGroup(companyID, group.GroupID, nil, "Renamed Operators", 2000)
		return err
	})
	assertMutation("company_user_group_updated", true, func() error {
		_, err := repo.UpdateCompanyUserGroup(companyID, group.GroupID, &parent.GroupID, "", 0)
		return err
	})
	assertMutation("company_user_group_deleted", true, func() error {
		return repo.DeleteCompanyUserGroup(companyID, group.GroupID)
	})
}

func TestPostgresCompanyUserGroupUpdateMarksOnlyHierarchyChangesProtected(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map group classification")
	if err != nil {
		t.Fatal(err)
	}
	group, err := repo.CreateCompanyUserGroup(company.CompanyID, "", "Operators")
	if err != nil {
		t.Fatal(err)
	}
	parent, err := repo.CreateCompanyUserGroup(company.CompanyID, "", "Parent")
	if err != nil {
		t.Fatal(err)
	}

	assertUpdate := func(wantProtectedGeometryChanged bool, mutate func() error) {
		t.Helper()
		if _, err := db.Exec(`delete from realtime_outbox where company_id=$1::uuid`, company.CompanyID); err != nil {
			t.Fatal(err)
		}
		if err := mutate(); err != nil {
			t.Fatal(err)
		}
		var rawPayload []byte
		if err := db.QueryRow(`
select payload
from realtime_outbox
where company_id=$1::uuid and scope=$2 and event_type='process_map.changed'
order by outbox_sequence desc
limit 1`, company.CompanyID, processMapRealtimeScope).Scan(&rawPayload); err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if err := json.Unmarshal(rawPayload, &payload); err != nil {
			t.Fatal(err)
		}
		if got, ok := payload[processMapProtectedGeometryChangedPayloadKey].(bool); !ok || got != wantProtectedGeometryChanged {
			t.Fatalf("PostgreSQL group update payload = %+v, want protected_geometry_changed=%v", payload, wantProtectedGeometryChanged)
		}
	}

	assertUpdate(false, func() error {
		_, err := repo.UpdateCompanyUserGroup(company.CompanyID, group.GroupID, nil, "Renamed Operators", 2000)
		return err
	})
	assertUpdate(true, func() error {
		_, err := repo.UpdateCompanyUserGroup(company.CompanyID, group.GroupID, &parent.GroupID, "", 0)
		return err
	})
}

func TestMemoryCompanyUserGroupMutationsRollBackWhenEventAppendFails(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*MemoryRepo, string, domain.CompanyUserGroup, domain.User) error
	}{
		{
			name: "members",
			mutate: func(repo *MemoryRepo, companyID string, group domain.CompanyUserGroup, user domain.User) error {
				_, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{user.UserID})
				return err
			},
		},
		{
			name: "update",
			mutate: func(repo *MemoryRepo, companyID string, group domain.CompanyUserGroup, _ domain.User) error {
				_, err := repo.UpdateCompanyUserGroup(companyID, group.GroupID, nil, "Must Roll Back", 0)
				return err
			},
		},
		{
			name: "delete",
			mutate: func(repo *MemoryRepo, companyID string, group domain.CompanyUserGroup, _ domain.User) error {
				return repo.DeleteCompanyUserGroup(companyID, group.GroupID)
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo := NewMemoryRepo()
			companyID := "89898989-8989-4989-8989-898989898987"
			repo.EnsureCompany(companyID, "Process Map Group Rollback")
			user := mustCreateRACIMembershipUser(t, repo, "process-map-group-rollback-"+test.name, companyID)
			group, err := repo.CreateCompanyUserGroup(companyID, "", "Operators")
			if err != nil {
				t.Fatal(err)
			}
			before := repo.snapshotCompanyUserGroupMutationLocked()
			forced := errors.New("forced group event failure")
			repo.domainEventAppendErr = forced
			if err := test.mutate(repo, companyID, group, user); !errors.Is(err, forced) {
				t.Fatalf("mutation error = %v, want %v", err, forced)
			}
			after := repo.snapshotCompanyUserGroupMutationLocked()
			if !reflect.DeepEqual(after, before) {
				t.Fatal("failed group mutation changed repository state")
			}
		})
	}
}
