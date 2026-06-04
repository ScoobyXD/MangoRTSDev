package store

import (
	"miraeopus/backend/internal/domain"
	"testing"
	"time"
)

func TestDeleteExpiredNotificationsRemovesOnlyOldNotificationRows(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "61616161-6161-4161-8161-616161616161"
	repo.EnsureCompany(companyID, "Notification Retention Co")
	user, err := repo.UpsertAuthUser("retention-subject", "retention@example.com", "Retention User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("retention-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Retention node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: EntityPermissionView,
			Permission:  EntityPermissionView,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	created, err := repo.CreateNotifications(CreateNotificationsInput{Notifications: []NotificationCreateInput{
		{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventMentionCreated,
			SourceEventID:   "61616161-6161-4161-8161-000000000001",
			EntityType:      EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "Old notification",
			NodeID:          node.NodeID,
		},
		{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventNodeFieldsChanged,
			SourceEventID:   "61616161-6161-4161-8161-000000000002",
			EntityType:      EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "Fresh notification",
			NodeID:          node.NodeID,
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	oldTimestamp := time.Now().UTC().Add(-DefaultNotificationRetentionDuration - time.Hour)
	repo.mu.Lock()
	old := repo.notifications[created[0].NotificationID]
	old.CreatedTimestamp = oldTimestamp
	repo.notifications[created[0].NotificationID] = old
	repo.mu.Unlock()

	deleted, err := repo.DeleteExpiredNotifications(time.Now().UTC().Add(-DefaultNotificationRetentionDuration), 10)
	if err != nil {
		t.Fatalf("DeleteExpiredNotifications: %v", err)
	}
	if len(deleted) != 1 || deleted[0].NotificationID != created[0].NotificationID {
		t.Fatalf("deleted = %+v, want only old notification", deleted)
	}
	remaining, err := repo.ListNotifications(NotificationListInput{UserID: user.UserID, CompanyID: companyID, Limit: 10})
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(remaining) != 1 || remaining[0].NotificationID != created[1].NotificationID {
		t.Fatalf("remaining notifications = %+v, want only fresh notification", remaining)
	}
}
