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
	if len(payload) != 3 || payload["type"] != "process_map.changed" || payload["company_id"] != companyID || payload["scope"] != processMapRealtimeScope {
		t.Fatalf("doorbell leaked more than compact invalidation fields: %s", first.Payload)
	}
	if err := json.Unmarshal(retry.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload) != 4 || payload["origin_connection_id"] != "connection-a" {
		t.Fatalf("correlated doorbell payload = %s", retry.Payload)
	}
	presentation, err := processMapChangedOutboxInput(companyID, []string{"event-a"}, []string{"user-a"}, "", true)
	if err != nil {
		t.Fatal(err)
	}
	var presentationPayload map[string]any
	if err := json.Unmarshal(presentation.Payload, &presentationPayload); err != nil {
		t.Fatal(err)
	}
	if len(presentationPayload) != 4 || presentationPayload["presentation_only"] != true {
		t.Fatalf("presentation-only doorbell payload = %s", presentation.Payload)
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

func TestMemoryProcessMapRealtimeMarksOnlyScorecardBatchesAsPresentationOnly(t *testing.T) {
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
	if scorecardPayload["presentation_only"] != true {
		t.Fatalf("scorecard Process Map payload = %+v, want presentation_only=true", scorecardPayload)
	}

	mixedPayload := appendAndReadPayload([]DomainEventInput{
		workspaceDomainEventInput(companyID, QDRatingRealtimeEventType, map[string]any{"logic_gate_id": "two"}),
		workspaceDomainEventInput(companyID, "logic_gate_permissions_updated", map[string]any{"logic_gate_id": "two"}),
	})
	if _, exists := mixedPayload["presentation_only"]; exists {
		t.Fatalf("mixed Process Map payload = %+v, want full refresh", mixedPayload)
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

func TestProcessMapRealtimePresentationOnlyRequiresEveryRelevantEventToBeScorecardUpdate(t *testing.T) {
	companyID := "89898989-8989-4989-8989-898989898978"
	event := func(eventID, eventType string, payload map[string]any) domain.DomainEvent {
		return domain.DomainEvent{
			CompanyID: companyID, EventID: eventID, StreamType: workspaceDomainStreamType,
			StreamID: companyID, Type: eventType, Payload: payload,
		}
	}
	for _, test := range []struct {
		name   string
		events []domain.DomainEvent
		want   bool
	}{
		{
			name:   "scorecard update",
			events: []domain.DomainEvent{event("one", QDRatingRealtimeEventType, nil)},
			want:   true,
		},
		{
			name: "scorecard batch",
			events: []domain.DomainEvent{
				event("one", QDRatingRealtimeEventType, nil),
				event("two", QDRatingRealtimeEventType, nil),
			},
			want: true,
		},
		{
			name: "mixed structural batch",
			events: []domain.DomainEvent{
				event("one", QDRatingRealtimeEventType, nil),
				event("two", "logic_gate_updated", nil),
			},
		},
		{
			name:   "permission change",
			events: []domain.DomainEvent{event("one", "logic_gate_permissions_updated", nil)},
		},
		{
			name: "restored resource",
			events: []domain.DomainEvent{
				event("one", "logic_gate_created", map[string]any{"realtime_change_type": "resource_restored"}),
			},
		},
		{
			name: "unrelated event ignored",
			events: []domain.DomainEvent{
				event("one", QDRatingRealtimeEventType, nil),
				event("two", "node_updated", nil),
			},
			want: true,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := processMapChangedPresentationOnlyByCompany(test.events)[companyID]; got != test.want {
				t.Fatalf("presentation-only = %v, want %v", got, test.want)
			}
		})
	}
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

	assertMutation := func(wantEventType string, mutate func() error) {
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
		}
		if scopeCounts[processMapRealtimeScope] != 1 || scopeCounts[raciTabsRealtimeScope] != 1 || len(repo.realtimeOutbox) != 2 {
			t.Fatalf("%s outbox scopes = %+v, want one Process Map and one RACI Tabs row", wantEventType, scopeCounts)
		}
		if got := repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "process-map", "")]; got != 1 {
			t.Fatalf("%s Process Map read version = %d, want 1", wantEventType, got)
		}
	}

	assertMutation("company_user_group_members_updated", func() error {
		_, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{user.UserID})
		return err
	})
	assertMutation("company_user_group_updated", func() error {
		_, err := repo.UpdateCompanyUserGroup(companyID, group.GroupID, nil, "Renamed Operators", 0)
		return err
	})
	assertMutation("company_user_group_deleted", func() error {
		return repo.DeleteCompanyUserGroup(companyID, group.GroupID)
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
