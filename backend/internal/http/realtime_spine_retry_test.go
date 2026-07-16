package httpapi

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"miraeopus/backend/internal/store"
)

func enqueuePublishedRealtimeRetryTestEvent(
	t *testing.T,
	repo *store.MemoryRepo,
	companyID, scope, nodeID, eventID string,
) store.RealtimeOutboxEvent {
	t.Helper()
	event, err := repo.EnqueueRealtimeOutbox(store.RealtimeOutboxInput{
		EventID:      eventID,
		CompanyID:    companyID,
		Scope:        scope,
		EventType:    "chat.created",
		ResourceType: store.EntityTypeNode,
		ResourceID:   nodeID,
		Permission:   store.EntityPermissionEdit,
		Payload:      json.RawMessage(`{"type":"chat.created"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	return event
}

func TestRealtimeSpineRetryableAuthorizationFailureDoesNotAdvanceCursor(t *testing.T) {
	base := store.NewMemoryRepo()
	transient := errors.New("temporary authorization store failure")
	allowedUserID := "11111111-1111-4111-8111-111111111111"
	repo := &controlledRealtimeAudienceRepo{
		Repository: base,
		exists:     true,
		allowed:    []string{allowedUserID},
		resolveErr: transient,
	}
	server := NewServerWithOptions(repo, ServerOptions{
		DisableRealtimeSpine:               true,
		DisableNotificationCleanup:         true,
		DisableAttachmentUploadCleanup:     true,
		DisableCommunicationsArchiveWorker: true,
	})
	defer server.Close()

	companyID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	nodeID := "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	scope := realtimeChatScope(nodeID)
	network := subscribeRecordingRealtimeConnection(t, server, "retry-allowed", companyID, allowedUserID, scope)
	unrelated := subscribeRecordingRealtimeConnection(t, server, "retry-unrelated", companyID, allowedUserID, realtimeChatScope("cccccccc-cccc-4ccc-8ccc-cccccccccccc"))
	event := enqueuePublishedRealtimeRetryTestEvent(t, base, companyID, scope, nodeID, "dddddddd-dddd-4ddd-8ddd-dddddddddddd")

	server.flushRealtimeSpine(nil)
	if server.realtimeSpineCursor != 0 {
		t.Fatalf("cursor advanced across retryable auth failure: %d", server.realtimeSpineCursor)
	}
	if server.realtimeSpineRetrySequence != event.Sequence || server.realtimeSpineRetryAttempts != 1 {
		t.Fatalf("retry state=%d/%d want sequence=%d attempt=1", server.realtimeSpineRetrySequence, server.realtimeSpineRetryAttempts, event.Sequence)
	}
	if messages := network.messages(t); len(messages) != 0 {
		t.Fatalf("failed authorization attempt delivered payload: %+v", messages)
	}

	repo.resolveErr = nil
	server.realtimeSpineRetryAt = time.Time{}
	server.flushRealtimeSpine(nil)
	if server.realtimeSpineCursor != event.Sequence {
		t.Fatalf("cursor=%d want recovered sequence=%d", server.realtimeSpineCursor, event.Sequence)
	}
	if messages := network.messages(t); len(messages) != 1 {
		t.Fatalf("recovered event deliveries=%d want 1", len(messages))
	}
	if messages := unrelated.messages(t); len(messages) != 0 {
		t.Fatalf("unrelated exact scope received event: %+v", messages)
	}

	server.flushRealtimeSpine(nil)
	if messages := network.messages(t); len(messages) != 1 {
		t.Fatalf("terminal cursor replayed event: deliveries=%d", len(messages))
	}
}

func TestRealtimeSpinePersistentAuthorizationFailureRemainsRetryableAndBlocksLaterCursor(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &controlledRealtimeAudienceRepo{
		Repository: base,
		exists:     true,
		resolveErr: errors.New("persistent authorization store failure"),
	}
	server := NewServerWithOptions(repo, ServerOptions{
		DisableRealtimeSpine:               true,
		DisableNotificationCleanup:         true,
		DisableAttachmentUploadCleanup:     true,
		DisableCommunicationsArchiveWorker: true,
	})
	defer server.Close()

	companyID := "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
	nodeID := "ffffffff-ffff-4fff-8fff-ffffffffffff"
	scope := realtimeChatScope(nodeID)
	subscribeRecordingRealtimeConnection(t, server, "persistent", companyID, "22222222-2222-4222-8222-222222222222", scope)
	first := enqueuePublishedRealtimeRetryTestEvent(t, base, companyID, scope, nodeID, "12121212-1212-4121-8121-121212121212")
	second := enqueuePublishedRealtimeRetryTestEvent(t, base, companyID, scope, nodeID, "13131313-1313-4131-8131-131313131313")

	for attempt := 1; attempt <= 3; attempt++ {
		server.realtimeSpineRetryAt = time.Time{}
		server.flushRealtimeSpine(nil)
		if server.realtimeSpineCursor != 0 {
			t.Fatalf("attempt %d advanced cursor to %d", attempt, server.realtimeSpineCursor)
		}
		if server.realtimeSpineRetrySequence != first.Sequence || server.realtimeSpineRetryAttempts != attempt {
			t.Fatalf("attempt %d retry state=%d/%d", attempt, server.realtimeSpineRetrySequence, server.realtimeSpineRetryAttempts)
		}
	}
	if second.Sequence <= first.Sequence {
		t.Fatalf("test events out of order: first=%d second=%d", first.Sequence, second.Sequence)
	}

	repo.resolveErr = nil
	repo.allowed = nil
	server.realtimeSpineRetryAt = time.Time{}
	server.flushRealtimeSpine(nil)
	if server.realtimeSpineCursor != second.Sequence {
		t.Fatalf("terminal no-authorized-recipient recovery cursor=%d want %d", server.realtimeSpineCursor, second.Sequence)
	}
}
