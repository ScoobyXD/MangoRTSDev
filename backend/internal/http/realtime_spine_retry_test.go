package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"miraeopus/backend/internal/store"
)

func expireRealtimeAuthorizationRetry(t *testing.T, server *Server) {
	t.Helper()
	server.realtimeSpineMu.Lock()
	server.realtimeSpineRetryAt = time.Now().Add(-time.Millisecond)
	server.realtimeSpineMu.Unlock()
}

func enqueueRealtimeRetryTestEvent(t *testing.T, repo *store.MemoryRepo, companyID, scope, nodeID, eventID string) store.RealtimeOutboxEvent {
	t.Helper()
	event, err := repo.EnqueueRealtimeOutbox(context.Background(), store.RealtimeOutboxInput{
		EventID: eventID, CompanyID: companyID, Scope: scope, EventType: "chat.created",
		ResourceType: store.EntityTypeNode, ResourceID: nodeID, Permission: store.EntityPermissionEdit,
		Payload: json.RawMessage(`{"type":"chat.created"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	return event
}

func TestRealtimeSpineRetryableAuthorizationFailureDoesNotAdvanceCursor(t *testing.T) {
	base := store.NewMemoryRepo()
	allowedUserID := "11111111-1111-4111-8111-111111111111"
	repo := &controlledRealtimeAudienceRepo{Repository: base, exists: true, allowed: []string{allowedUserID}, resolveErr: errors.New("temporary authorization store failure")}
	server := NewServerWithOptions(repo, ServerOptions{DisableRealtimeSpine: true, DisableNotificationCleanup: true, DisableAttachmentUploadCleanup: true})
	defer server.Close()

	companyID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	nodeID := "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	scope := realtimeChatScope(nodeID)
	network := subscribeRecordingRealtimeConnection(t, server, "retry-allowed", companyID, allowedUserID, scope)
	unrelated := subscribeRecordingRealtimeConnection(t, server, "retry-unrelated", companyID, allowedUserID, realtimeChatScope("cccccccc-cccc-4ccc-8ccc-cccccccccccc"))
	event := enqueueRealtimeRetryTestEvent(t, base, companyID, scope, nodeID, "dddddddd-dddd-4ddd-8ddd-dddddddddddd")

	server.acceptRealtimeOutboxEvent(context.Background(), event)
	if server.realtimeSpineCursor != 0 || server.realtimeSpineRetrySequence != event.Sequence || server.realtimeSpineRetryAttempts != 1 {
		t.Fatalf("retry state cursor=%d sequence=%d attempts=%d", server.realtimeSpineCursor, server.realtimeSpineRetrySequence, server.realtimeSpineRetryAttempts)
	}
	if messages := network.messages(t); len(messages) != 0 {
		t.Fatalf("failed authorization attempt delivered payload: %+v", messages)
	}

	repo.resolveErr = nil
	server.acceptRealtimeOutboxEvent(context.Background(), event)
	if server.realtimeSpineCursor != 0 || len(repo.snapshotCalls()) != 1 {
		t.Fatal("authorization retry deadline was bypassed by an immediate replay")
	}
	expireRealtimeAuthorizationRetry(t, server)
	server.acceptRealtimeOutboxEvent(context.Background(), event)
	if server.realtimeSpineCursor != event.Sequence {
		t.Fatalf("cursor=%d want recovered sequence=%d", server.realtimeSpineCursor, event.Sequence)
	}
	if messages := network.messages(t); len(messages) != 1 {
		t.Fatalf("recovered event deliveries=%d want 1", len(messages))
	}
	if messages := unrelated.messages(t); len(messages) != 0 {
		t.Fatalf("unrelated exact scope received event: %+v", messages)
	}
	server.acceptRealtimeOutboxEvent(context.Background(), event)
	if messages := network.messages(t); len(messages) != 1 {
		t.Fatalf("duplicate event replayed: deliveries=%d", len(messages))
	}
}

func TestRealtimeSpinePersistentAuthorizationFailureBlocksLaterSequence(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &controlledRealtimeAudienceRepo{Repository: base, exists: true, resolveErr: errors.New("persistent authorization store failure")}
	server := NewServerWithOptions(repo, ServerOptions{DisableRealtimeSpine: true, DisableNotificationCleanup: true, DisableAttachmentUploadCleanup: true})
	defer server.Close()

	companyID := "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
	nodeID := "ffffffff-ffff-4fff-8fff-ffffffffffff"
	scope := realtimeChatScope(nodeID)
	subscribeRecordingRealtimeConnection(t, server, "persistent", companyID, "22222222-2222-4222-8222-222222222222", scope)
	first := enqueueRealtimeRetryTestEvent(t, base, companyID, scope, nodeID, "12121212-1212-4121-8121-121212121212")
	second := enqueueRealtimeRetryTestEvent(t, base, companyID, scope, nodeID, "13131313-1313-4131-8131-131313131313")

	for attempt := 1; attempt <= 3; attempt++ {
		if attempt > 1 {
			expireRealtimeAuthorizationRetry(t, server)
		}
		server.acceptRealtimeOutboxEvent(context.Background(), first)
		if server.realtimeSpineCursor != 0 || server.realtimeSpineRetrySequence != first.Sequence || server.realtimeSpineRetryAttempts != attempt {
			t.Fatalf("attempt %d state cursor=%d retry=%d/%d", attempt, server.realtimeSpineCursor, server.realtimeSpineRetrySequence, server.realtimeSpineRetryAttempts)
		}
	}
	server.acceptRealtimeOutboxEvent(context.Background(), second)
	if server.realtimeSpineCursor != 0 {
		t.Fatalf("later sequence crossed failed first event: cursor=%d", server.realtimeSpineCursor)
	}
	repo.resolveErr = nil
	repo.allowed = nil
	expireRealtimeAuthorizationRetry(t, server)
	server.acceptRealtimeOutboxEvent(context.Background(), first)
	if server.realtimeSpineCursor != second.Sequence {
		t.Fatalf("terminal recovery cursor=%d want %d", server.realtimeSpineCursor, second.Sequence)
	}
}

func TestRealtimeAuthorizationRetryBackoffIgnoresLaterEventsAndRecoverySignals(t *testing.T) {
	base := store.NewMemoryRepo()
	allowedUserID := "24242424-2424-4242-8242-242424242424"
	repo := &controlledRealtimeAudienceRepo{Repository: base, exists: true, allowed: []string{allowedUserID}, resolveErr: errors.New("temporary authorization failure")}
	server := NewServerWithOptions(repo, ServerOptions{DisableRealtimeSpine: true, DisableNotificationCleanup: true, DisableAttachmentUploadCleanup: true})
	defer server.Close()

	companyID := "25252525-2525-4252-8252-252525252525"
	nodeID := "26262626-2626-4262-8262-262626262626"
	scope := realtimeChatScope(nodeID)
	connection := subscribeRecordingRealtimeConnection(t, server, "bounded-auth-retry", companyID, allowedUserID, scope)
	first := enqueueRealtimeRetryTestEvent(t, base, companyID, scope, nodeID, "27272727-2727-4272-8272-272727272727")
	second := enqueueRealtimeRetryTestEvent(t, base, companyID, scope, nodeID, "28282828-2828-4282-8282-282828282828")
	claimed, err := base.ClaimRealtimeOutbox(context.Background(), store.RealtimeOutboxClaimQuery{Limit: 10, LeaseDuration: time.Minute})
	if err != nil || len(claimed) != 2 {
		t.Fatalf("claim retry fixtures: count=%d err=%v", len(claimed), err)
	}
	for _, event := range claimed {
		if err := base.MarkRealtimeOutboxPublished(context.Background(), event.EventID, event.ClaimToken); err != nil {
			t.Fatal(err)
		}
	}

	server.acceptRealtimeOutboxEvent(context.Background(), first)
	server.realtimeSpineMu.Lock()
	server.realtimeSpineRetryAt = time.Now().Add(time.Hour)
	generation := server.realtimeSpineRetryGeneration
	server.realtimeSpineMu.Unlock()
	for range 20 {
		server.acceptRealtimeOutboxEvent(context.Background(), second)
		server.recoverPublishedRealtimeOutbox(context.Background())
	}
	server.realtimeSpineMu.Lock()
	attempts := server.realtimeSpineRetryAttempts
	gotGeneration := server.realtimeSpineRetryGeneration
	server.realtimeSpineMu.Unlock()
	if calls := len(repo.snapshotCalls()); calls != 1 || attempts != 1 || gotGeneration != generation {
		t.Fatalf("backoff was bypassed: calls=%d attempts=%d generation=%d want generation=%d", calls, attempts, gotGeneration, generation)
	}
	if len(connection.messages(t)) != 0 {
		t.Fatal("later event crossed retryable authorization failure")
	}

	repo.resolveErr = nil
	expireRealtimeAuthorizationRetry(t, server)
	server.recoverPublishedRealtimeOutbox(context.Background())
	if calls := len(repo.snapshotCalls()); calls != 3 {
		t.Fatalf("authorization calls after deadline=%d want failed first event plus one successful check per event", calls)
	}
	if server.realtimeSpineCursor != second.Sequence || len(connection.messages(t)) != 2 {
		t.Fatalf("recovery cursor=%d deliveries=%d", server.realtimeSpineCursor, len(connection.messages(t)))
	}
}
