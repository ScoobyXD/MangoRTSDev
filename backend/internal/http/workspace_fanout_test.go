package httpapi

import (
	"context"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"sync"
	"testing"
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
	stream := server.workspaceEvents.subscribe(companyID)
	defer server.workspaceEvents.unsubscribe(companyID, stream)

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

func TestWorkspaceFanoutNotificationPublishesRealtimeWorkspaceEvent(t *testing.T) {
	repo := store.NewMemoryRepo()
	fanout := newManualWorkspaceEventFanout()
	companyID := "88888888-8888-4888-8888-888888888101"
	token := "workspace-fanout-realtime-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "workspace-fanout-realtime", domain.RoleCompanyUser)
	server := NewServerWithOptions(repo, ServerOptions{
		WorkspaceEventFanout: fanout,
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			token: {Subject: user.CognitoSubject, Email: user.Email, Name: user.DisplayName},
		}},
	})
	defer server.Close()

	node, err := repo.CreateNode(companyID, "Fanout realtime node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	scope := realtimeWorkspaceScope(user.UserID)
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	client.readJSON(t)

	event, err := repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:  companyID,
		StreamType: workspaceDomainStreamType,
		StreamID:   companyID,
		Type:       "node_updated",
		Payload:    map[string]any{"node_id": node.NodeID},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent: %v", err)
	}
	notification, ok := store.WorkspaceEventNotificationFromDomainEvent(event)
	if !ok {
		t.Fatalf("event did not produce workspace notification: %+v", event)
	}
	fanout.emit(notification)

	message := client.readJSON(t)
	if message["type"] != realtimeMessageWorkspaceEvent || message["scope"] != scope || message["sequence"].(float64) != float64(event.Sequence) {
		t.Fatalf("fanout realtime message = %+v, want workspace event for scope %s sequence %d", message, scope, event.Sequence)
	}
	envelope := message["event"].(map[string]any)
	if envelope["type"] != "node_updated" || envelope["company_id"] != companyID {
		t.Fatalf("fanout realtime envelope = %+v, want node_updated company event", envelope)
	}
}

func TestWorkspaceFanoutDuplicateNotificationAfterLocalPublishIsSuppressed(t *testing.T) {
	repo := store.NewMemoryRepo()
	fanout := newManualWorkspaceEventFanout()
	companyID := "88888888-8888-4888-8888-888888888103"
	token := "workspace-fanout-dedupe-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "workspace-fanout-dedupe", domain.RoleCompanyUser)
	server := NewServerWithOptions(repo, ServerOptions{
		WorkspaceEventFanout: fanout,
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			token: {Subject: user.CognitoSubject, Email: user.Email, Name: user.DisplayName},
		}},
	})
	defer server.Close()

	node, err := repo.CreateNode(companyID, "Fanout dedupe node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	scope := realtimeWorkspaceScope(user.UserID)
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	client.readJSON(t)

	event, err := repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:  companyID,
		StreamType: workspaceDomainStreamType,
		StreamID:   companyID,
		Type:       "node_updated",
		Payload:    map[string]any{"node_id": node.NodeID},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent: %v", err)
	}
	notification, ok := store.WorkspaceEventNotificationFromDomainEvent(event)
	if !ok {
		t.Fatalf("event did not produce workspace notification: %+v", event)
	}
	server.publishCommittedWorkspaceEventWithTiming(event, nil)
	message := client.readJSON(t)
	if message["type"] != realtimeMessageWorkspaceEvent || message["scope"] != scope || message["sequence"].(float64) != float64(event.Sequence) {
		t.Fatalf("local realtime message = %+v, want workspace event for sequence %d", message, event.Sequence)
	}

	fanout.emit(notification)
	client.assertNoMessage(t)
}

func TestWorkspaceFanoutIgnoresUserScopedNotificationsAfterGlobalDelivery(t *testing.T) {
	repo := store.NewMemoryRepo()
	fanout := newManualWorkspaceEventFanout()
	companyID := "88888888-8888-4888-8888-888888888102"
	token := "workspace-fanout-user-notification-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "workspace-fanout-user-notification", domain.RoleCompanyUser)
	server := NewServerWithOptions(repo, ServerOptions{
		WorkspaceEventFanout: fanout,
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			token: {Subject: user.CognitoSubject, Email: user.Email, Name: user.DisplayName},
		}},
	})
	defer server.Close()

	node, err := repo.CreateNode(companyID, "Fanout duplicate node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	scope := realtimeNodeGraphScope(user.UserID)
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	client.readJSON(t)

	event, err := repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:  companyID,
		StreamType: workspaceDomainStreamType,
		StreamID:   companyID,
		Type:       "node_updated",
		Payload:    map[string]any{"node_id": node.NodeID},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent: %v", err)
	}
	notification, ok := store.WorkspaceEventNotificationFromDomainEvent(event)
	if !ok {
		t.Fatalf("event did not produce workspace notification: %+v", event)
	}
	fanout.emit(notification)
	client.readJSON(t)

	notification.UserID = user.UserID
	fanout.emit(notification)
	client.assertNoMessage(t)
}
