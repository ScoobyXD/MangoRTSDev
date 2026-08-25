package store

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestProcessMapRealtimeDoorbellIsCompactStableAndCompanyScoped(t *testing.T) {
	companyID := "89898989-8989-4989-8989-898989898981"
	first, err := processMapChangedOutboxInput(companyID, []string{"event-b", "event-a", "event-a"}, []string{"user-b", "user-a"})
	if err != nil {
		t.Fatal(err)
	}
	retry, err := processMapChangedOutboxInput(companyID, []string{"event-a", "event-b"}, []string{"user-a"})
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
}

func TestMemoryProcessMapRealtimeDoorbellUsesCompanyAudience(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "89898989-8989-4989-8989-898989898982"
	repo.EnsureCompany(companyID, "Process Map Realtime")
	user := mustCreateRACIMembershipUser(t, repo, "process-map-realtime-user", companyID)
	resetMemoryMembershipEventState(repo)
	events := []domain.DomainEvent{{
		CompanyID: companyID, EventID: "89898989-8989-4989-8989-898989898983",
		StreamType: workspaceDomainStreamType, StreamID: companyID, Type: "process_map_trace_saved",
	}}

	if err := repo.enqueueProcessMapRealtimeForDomainEventsLocked(events); err != nil {
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
		workspaceDomainEventInput(companyID, "process_map_placement_saved", map[string]any{}),
		workspaceDomainEventInput(companyID, "process_map_trace_saved", map[string]any{}),
	}); err != nil {
		t.Fatal(err)
	}
	if len(repo.realtimeOutbox) != 1 {
		t.Fatalf("Process Map batch outbox rows = %d, want one coalesced row", len(repo.realtimeOutbox))
	}
}

func TestProcessMapRealtimeFilterIncludesVisibilityChangesAndRestoreOnlyCreates(t *testing.T) {
	companyID := "89898989-8989-4989-8989-898989898985"
	event := func(eventType string, payload map[string]any) domain.DomainEvent {
		return domain.DomainEvent{
			CompanyID: companyID, EventID: eventType, StreamType: workspaceDomainStreamType,
			StreamID: companyID, Type: eventType, Payload: payload,
		}
	}
	for _, eventType := range []string{
		"logic_gate_permissions_updated", "company_explorer_folder_permissions_updated",
		"company_user_group_updated", "company_user_group_deleted", "company_user_group_members_updated",
		CompanyMembershipSavedEventType, CompanyMembershipDeletedEventType,
	} {
		if !isProcessMapChangedDomainEvent(event(eventType, nil)) {
			t.Errorf("Process Map realtime ignored visibility event %q", eventType)
		}
	}
	if isProcessMapChangedDomainEvent(event("logic_gate_created", nil)) {
		t.Error("ordinary source creation must not invalidate Process Map before manual placement")
	}
	if !isProcessMapChangedDomainEvent(event("logic_gate_created", map[string]any{"realtime_change_type": "resource_restored"})) {
		t.Error("restored source creation must invalidate restored Process Map state")
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
