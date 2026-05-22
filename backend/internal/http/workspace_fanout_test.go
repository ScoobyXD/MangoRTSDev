package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"sync"
	"testing"
	"time"
)

type manualWorkspaceEventFanout struct {
	notifications chan store.WorkspaceEventNotification
	notifyErr     error
	mu            sync.Mutex
	published     []store.WorkspaceEventNotification
}

func newManualWorkspaceEventFanout() *manualWorkspaceEventFanout {
	return &manualWorkspaceEventFanout{notifications: make(chan store.WorkspaceEventNotification, 24)}
}

func (f *manualWorkspaceEventFanout) NotifyWorkspaceEvent(ctx context.Context, event domain.DomainEvent) error {
	notification, ok := store.WorkspaceEventNotificationFromDomainEvent(event)
	if ok {
		f.mu.Lock()
		f.published = append(f.published, notification)
		f.mu.Unlock()
	}
	return f.notifyErr
}

func (f *manualWorkspaceEventFanout) ListenWorkspaceEvents(ctx context.Context, notify func(store.WorkspaceEventNotification)) error {
	for {
		select {
		case notification := <-f.notifications:
			notify(notification)
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (f *manualWorkspaceEventFanout) emit(notification store.WorkspaceEventNotification) {
	f.notifications <- notification
}

func (f *manualWorkspaceEventFanout) publishedCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.published)
}

func TestWorkspaceFanoutCommittedEventPublishesLocalHubAndExternalNotification(t *testing.T) {
	repo := store.NewMemoryRepo()
	fanout := newManualWorkspaceEventFanout()
	server := NewServerWithOptions(repo, ServerOptions{WorkspaceEventFanout: fanout})
	defer server.Close()
	companyID := "fanout-local-company"
	stream := server.hub.subscribe(companyID)
	defer server.hub.unsubscribe(companyID, stream)

	event, err := repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:  companyID,
		StreamType: workspaceDomainStreamType,
		StreamID:   companyID,
		Type:       "node_created",
		Payload:    map[string]any{"node_id": "node-local"},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent: %v", err)
	}
	server.publishCommittedWorkspaceEvent(event)

	hubEvent := readWorkspaceEventForTest(t, stream)
	if hubEvent.Sequence != event.Sequence || hubEvent.Type != "node_created" || hubEvent.Data["node_id"] != "node-local" {
		t.Fatalf("hub event = %+v, want committed node_created sequence %d", hubEvent, event.Sequence)
	}
	if count := fanout.publishedCount(); count != 1 {
		t.Fatalf("fanout published count = %d, want 1", count)
	}
}

func TestWorkspaceFanoutNotificationWakesDurableCatchup(t *testing.T) {
	repo := store.NewMemoryRepo()
	fanout := newManualWorkspaceEventFanout()
	server := NewServerWithOptions(repo, ServerOptions{WorkspaceEventFanout: fanout, WorkspaceCatchupInterval: time.Hour})
	defer server.Close()
	companyID := "fanout-wake-company"

	reader, cancel := openWorkspaceStreamForTest(t, server.Routes(), "/v1/workspace/stream?company_id="+companyID, nil)
	defer cancel()
	ready := readWorkspaceReadyForTest(t, reader)
	if ready.AfterSequence != 0 {
		t.Fatalf("ready after_sequence = %d, want 0", ready.AfterSequence)
	}

	event, err := repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:  companyID,
		StreamType: workspaceDomainStreamType,
		StreamID:   companyID,
		Type:       "node_created",
		Payload:    map[string]any{"node_id": "node-external"},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent: %v", err)
	}
	notification, ok := store.WorkspaceEventNotificationFromDomainEvent(event)
	if !ok {
		t.Fatalf("event did not produce workspace notification: %+v", event)
	}
	fanout.emit(notification)

	got := readWorkspaceSSEForTest(t, reader)
	if got.Sequence != event.Sequence || got.Type != "node_created" || got.Data["node_id"] != "node-external" {
		t.Fatalf("fanout-woken SSE = %+v, want durable node_created sequence %d", got, event.Sequence)
	}
}

func TestWorkspaceFanoutDuplicateAndStaleNotificationsDoNotDuplicateSSE(t *testing.T) {
	repo := store.NewMemoryRepo()
	fanout := newManualWorkspaceEventFanout()
	server := NewServerWithOptions(repo, ServerOptions{WorkspaceEventFanout: fanout, WorkspaceCatchupInterval: time.Hour})
	defer server.Close()
	companyID := "fanout-duplicate-company"

	reader, cancel := openWorkspaceStreamForTest(t, server.Routes(), "/v1/workspace/stream?company_id="+companyID, nil)
	ready := readWorkspaceReadyForTest(t, reader)
	if ready.AfterSequence != 0 {
		t.Fatalf("ready after_sequence = %d, want 0", ready.AfterSequence)
	}

	event, err := repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:  companyID,
		StreamType: workspaceDomainStreamType,
		StreamID:   companyID,
		Type:       "node_created",
		Payload:    map[string]any{"node_id": "node-duplicate"},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent: %v", err)
	}
	notification, ok := store.WorkspaceEventNotificationFromDomainEvent(event)
	if !ok {
		t.Fatalf("event did not produce workspace notification: %+v", event)
	}
	fanout.emit(notification)
	first := readWorkspaceSSEForTest(t, reader)
	if first.Sequence != event.Sequence {
		t.Fatalf("first SSE sequence = %d, want %d", first.Sequence, event.Sequence)
	}

	fanout.emit(notification)
	fanout.emit(store.WorkspaceEventNotification{CompanyID: companyID, Sequence: event.Sequence})
	assertNoWorkspaceSSEForTest(t, reader, cancel, 150*time.Millisecond)
}

func TestWorkspaceStreamUserScopedFanoutUsesEffectiveAccess(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{WorkspaceCatchupInterval: time.Hour})
	defer server.Close()
	companyID := "88888888-8888-4888-8888-888888888801"
	repo.EnsureCompany(companyID, "Phase 6 Workspace HTTP Co")

	viewer, err := repo.UpsertAuthUser("phase6-stream-viewer", "phase6-stream-viewer@example.com", "Viewer")
	if err != nil {
		t.Fatalf("UpsertAuthUser viewer: %v", err)
	}
	if _, err := repo.AddCompanyMembership("phase6-stream-viewer", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership viewer: %v", err)
	}
	blocked, err := repo.UpsertAuthUser("phase6-stream-blocked", "phase6-stream-blocked@example.com", "Blocked")
	if err != nil {
		t.Fatalf("UpsertAuthUser blocked: %v", err)
	}
	if _, err := repo.AddCompanyMembership("phase6-stream-blocked", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership blocked: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Stream Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Stream Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   viewer.UserID,
			AccessLevel: store.EntityPermissionView,
			Permission:  store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	viewerHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.Routes().ServeHTTP(w, requestWithActorForTest(r, viewer, companyID))
	})
	viewerReader, viewerCancel := openWorkspaceStreamForTest(t, viewerHandler, "/v1/workspace/stream?company_id="+companyID+"&after_sequence=0", nil)
	defer viewerCancel()
	readWorkspaceReadyForTest(t, viewerReader)

	blockedHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.Routes().ServeHTTP(w, requestWithActorForTest(r, blocked, companyID))
	})
	blockedReader, blockedCancel := openWorkspaceStreamForTest(t, blockedHandler, "/v1/workspace/stream?company_id="+companyID+"&after_sequence=0", nil)
	readWorkspaceReadyForTest(t, blockedReader)

	server.publishWorkspaceEvent(companyID, store.WorkItemLogicGateAssignmentMovedEventType, map[string]any{
		"logic_gate_id": logicGate.LogicGateID,
		"node_id":       node.NodeID,
	})

	got := readWorkspaceSSEForTest(t, viewerReader)
	if got.Type != store.WorkItemLogicGateAssignmentMovedEventType || got.Data["logic_gate_id"] != logicGate.LogicGateID {
		t.Fatalf("viewer workspace event = %+v, want logic gate assignment update", got)
	}
	assertNoWorkspaceSSEForTest(t, blockedReader, blockedCancel, 150*time.Millisecond)
}

func TestWorkspaceStreamPollingCatchesUpWhenFanoutNotifyFails(t *testing.T) {
	repo := store.NewMemoryRepo()
	failingFanout := newManualWorkspaceEventFanout()
	failingFanout.notifyErr = errors.New("fanout down")
	serverA := NewServer(repo)
	defer serverA.Close()
	serverB := NewServerWithOptions(repo, ServerOptions{WorkspaceEventFanout: failingFanout})
	defer serverB.Close()
	companyID := "fanout-failure-poll-company"

	reader, cancel := openWorkspaceStreamForTest(t, serverA.Routes(), "/v1/workspace/stream?company_id="+companyID, nil)
	defer cancel()
	ready := readWorkspaceReadyForTest(t, reader)
	if ready.AfterSequence != 0 {
		t.Fatalf("ready after_sequence = %d, want 0", ready.AfterSequence)
	}

	serverB.publishWorkspaceEvent(companyID, "node_created", map[string]any{"node_id": "node-poll"})
	got := readWorkspaceSSEForTest(t, reader)
	if got.Sequence != 1 || got.Type != "node_created" || got.Data["node_id"] != "node-poll" {
		t.Fatalf("poll fallback SSE = %+v, want node_created sequence 1", got)
	}
	if count := failingFanout.publishedCount(); count != 1 {
		t.Fatalf("failing fanout publish attempts = %d, want 1", count)
	}
}

func assertNoWorkspaceSSEForTest(t *testing.T, reader *bufio.Reader, cancel context.CancelFunc, wait time.Duration) {
	t.Helper()
	events := make(chan workspaceEventEnvelope, 1)
	errs := make(chan error, 1)
	go func() {
		event, err := readWorkspaceSSEForTestResult(reader)
		if err != nil {
			errs <- err
			return
		}
		events <- event
	}()
	select {
	case event := <-events:
		t.Fatalf("unexpected duplicate workspace SSE event: %+v", event)
	case err := <-errs:
		t.Fatalf("workspace stream ended before duplicate assertion completed: %v", err)
	case <-time.After(wait):
		cancel()
		select {
		case event := <-events:
			t.Fatalf("unexpected duplicate workspace SSE event after cancel: %+v", event)
		case <-errs:
		case <-time.After(time.Second):
		}
	}
}

func readWorkspaceSSEForTestResult(reader *bufio.Reader) (workspaceEventEnvelope, error) {
	for {
		event, err := readRawSSEEventForTest(reader)
		if err != nil {
			return workspaceEventEnvelope{}, err
		}
		switch event.Event {
		case "workspace":
			var envelope workspaceEventEnvelope
			if err := json.Unmarshal([]byte(event.Data), &envelope); err != nil {
				return workspaceEventEnvelope{}, err
			}
			return envelope, nil
		case "", "ready", "ping":
			continue
		default:
			return workspaceEventEnvelope{}, fmt.Errorf("unexpected SSE event %q data=%s", event.Event, event.Data)
		}
	}
}
