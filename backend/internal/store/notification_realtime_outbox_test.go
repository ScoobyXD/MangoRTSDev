package store

import (
	"errors"
	"testing"
)

func atomicNotificationCandidate(companyID, sourceEventID string) NotificationCreateInput {
	return NotificationCreateInput{
		CompanyID: companyID, RecipientUserID: "recipient-user", Type: "node.updated",
		SourceEventID: sourceEventID, EntityType: EntityTypeNode, EntityID: "node-id", Title: "Updated",
	}
}

func TestMemoryNotificationMutationAndOutboxAreAtomic(t *testing.T) {
	repo := NewMemoryRepo()
	repo.realtimeOutboxErr = errors.New("forced outbox failure")
	if _, err := repo.CreateNotifications(CreateNotificationsInput{
		Notifications: []NotificationCreateInput{atomicNotificationCandidate("company-id", "source-id")},
	}); err == nil {
		t.Fatal("CreateNotifications succeeded while outbox insertion failed")
	}
	if len(repo.notifications) != 0 || len(repo.realtimeOutbox) != 0 {
		t.Fatalf("split create state notifications=%d outbox=%d", len(repo.notifications), len(repo.realtimeOutbox))
	}

	repo.realtimeOutboxErr = nil
	created, err := repo.CreateNotifications(CreateNotificationsInput{
		Notifications: []NotificationCreateInput{atomicNotificationCandidate("company-id", "source-id")},
	})
	if err != nil || len(created) != 1 {
		t.Fatalf("CreateNotifications = %+v, %v", created, err)
	}
	if len(repo.realtimeOutbox) != 1 {
		t.Fatalf("create outbox rows = %d, want 1", len(repo.realtimeOutbox))
	}

	repo.realtimeOutbox = map[string]RealtimeOutboxEvent{}
	repo.realtimeOutboxSequence = 0
	repo.realtimeOutboxErr = errors.New("forced delete outbox failure")
	if _, err := repo.DeleteNotifications(NotificationDeleteInput{
		UserID: "recipient-user", NotificationID: created[0].NotificationID,
		RealtimeMode: NotificationRealtimeDeleteEach,
	}); err == nil {
		t.Fatal("DeleteNotifications succeeded while outbox insertion failed")
	}
	if len(repo.notifications) != 1 || len(repo.realtimeOutbox) != 0 {
		t.Fatalf("split delete state notifications=%d outbox=%d", len(repo.notifications), len(repo.realtimeOutbox))
	}

	repo.realtimeOutboxErr = nil
	deleted, err := repo.DeleteNotifications(NotificationDeleteInput{
		UserID: "recipient-user", NotificationID: created[0].NotificationID,
		RealtimeMode: NotificationRealtimeDeleteEach,
	})
	if err != nil || len(deleted) != 1 {
		t.Fatalf("DeleteNotifications = %+v, %v", deleted, err)
	}
	if len(repo.notifications) != 0 || len(repo.realtimeOutbox) != 1 {
		t.Fatalf("delete state notifications=%d outbox=%d", len(repo.notifications), len(repo.realtimeOutbox))
	}
	for _, event := range repo.realtimeOutbox {
		if event.EventType != "notification.deleted" || event.EventID != stableRealtimeEventID("notification.deleted", created[0].NotificationID) {
			t.Fatalf("delete event = %+v", event)
		}
	}
}

func TestMemoryNotificationBusinessFailureProducesNoOutbox(t *testing.T) {
	repo := NewMemoryRepo()
	if _, err := repo.CreateNotifications(CreateNotificationsInput{
		Notifications: []NotificationCreateInput{atomicNotificationCandidate("", "source-id")},
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("CreateNotifications error = %v, want ErrInvalid", err)
	}
	if len(repo.notifications) != 0 || len(repo.realtimeOutbox) != 0 {
		t.Fatalf("invalid mutation persisted notifications=%d outbox=%d", len(repo.notifications), len(repo.realtimeOutbox))
	}
}
