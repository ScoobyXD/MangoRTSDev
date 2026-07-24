package store

import (
	"miraeopus/backend/internal/domain"
	"testing"
	"time"
)

func TestDeleteExpiredNotificationsPreservesArchivedNotificationRows(t *testing.T) {
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
			AccessLevel: EntityPermissionEdit,
			Permission:  EntityPermissionEdit,
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
	if _, err := repo.MarkNotificationRead(user.UserID, created[0].NotificationID, true); err != nil {
		t.Fatalf("MarkNotificationRead: %v", err)
	}

	deleted, err := repo.DeleteExpiredNotifications(time.Now().UTC().Add(-DefaultNotificationRetentionDuration), 10)
	if err != nil {
		t.Fatalf("DeleteExpiredNotifications: %v", err)
	}
	if len(deleted) != 0 {
		t.Fatalf("deleted = %+v, want archived history preserved", deleted)
	}
	remaining, err := repo.ListNotifications(NotificationListInput{UserID: user.UserID, CompanyID: companyID, Limit: 10})
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(remaining) != 2 {
		t.Fatalf("remaining notifications = %+v, want archived and fresh rows", remaining)
	}
}

func TestNotificationReadStateDoesNotRemoveFeedRow(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "61616161-6161-4161-8161-616161616162"
	repo.EnsureCompany(companyID, "Notification Read State Co")
	user, err := repo.UpsertAuthUser("read-state-subject", "read-state@example.com", "Read State User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("read-state-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Read state node")
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
			AccessLevel: EntityPermissionEdit,
			Permission:  EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	created, err := repo.CreateNotifications(CreateNotificationsInput{Notifications: []NotificationCreateInput{{
		CompanyID:       companyID,
		RecipientUserID: user.UserID,
		Type:            domain.NotificationEventMentionCreated,
		SourceEventID:   "61616161-6161-4161-8161-000000000003",
		EntityType:      EntityTypeNode,
		EntityID:        node.NodeID,
		Title:           "Mention",
		NodeID:          node.NodeID,
	}}})
	if err != nil {
		t.Fatalf("CreateNotifications: %v", err)
	}
	if _, err := repo.MarkNotificationRead(user.UserID, created[0].NotificationID, true); err != nil {
		t.Fatalf("MarkNotificationRead: %v", err)
	}
	all, err := repo.ListNotifications(NotificationListInput{UserID: user.UserID, CompanyID: companyID, Limit: 10})
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(all) != 1 || all[0].NotificationID != created[0].NotificationID || all[0].ReadTimestamp == nil {
		t.Fatalf("notifications after read = %+v, want same row with read timestamp", all)
	}
	unread, err := repo.ListNotifications(NotificationListInput{UserID: user.UserID, CompanyID: companyID, UnreadOnly: true, Limit: 10})
	if err != nil {
		t.Fatalf("ListNotifications unread: %v", err)
	}
	if len(unread) != 0 {
		t.Fatalf("unread notifications = %+v, want none after marking read", unread)
	}
}

func TestNotificationReadStateCanChangeAfterReferencedNodeIsDeleted(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "61616161-6161-4161-8161-616161616163"
	repo.EnsureCompany(companyID, "Deleted Notification Target Co")
	user, err := repo.UpsertAuthUser("deleted-target-subject", "deleted-target@example.com", "Deleted Target User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("deleted-target-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Soon deleted node")
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
			AccessLevel: EntityPermissionEdit,
			Permission:  EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	created, err := repo.CreateNotifications(CreateNotificationsInput{Notifications: []NotificationCreateInput{{
		CompanyID:       companyID,
		RecipientUserID: user.UserID,
		Type:            domain.NotificationEventNodeFieldsChanged,
		SourceEventID:   "61616161-6161-4161-8161-000000000004",
		EntityType:      EntityTypeNode,
		EntityID:        node.NodeID,
		Title:           "Node changed before deletion",
		NodeID:          node.NodeID,
	}}})
	if err != nil {
		t.Fatalf("CreateNotifications: %v", err)
	}
	if err := repo.DeleteNode(companyID, node.NodeID); err != nil {
		t.Fatalf("DeleteNode: %v", err)
	}

	item, err := repo.MarkNotificationRead(user.UserID, created[0].NotificationID, true)
	if err != nil {
		t.Fatalf("MarkNotificationRead after node deletion: %v", err)
	}
	if item.ReadTimestamp == nil {
		t.Fatal("notification read timestamp is nil after marking deleted-node update read")
	}

	item, err = repo.MarkNotificationRead(user.UserID, created[0].NotificationID, false)
	if err != nil {
		t.Fatalf("MarkNotificationRead unread after node deletion: %v", err)
	}
	if item.ReadTimestamp != nil {
		t.Fatalf("notification read timestamp = %v after marking deleted-node update unread, want nil", item.ReadTimestamp)
	}

	count, err := repo.MarkNotificationsRead(NotificationMarkReadInput{
		UserID:    user.UserID,
		CompanyID: companyID,
	})
	if err != nil {
		t.Fatalf("MarkNotificationsRead after node deletion: %v", err)
	}
	if count != 1 {
		t.Fatalf("MarkNotificationsRead count = %d, want 1 deleted-node notification", count)
	}
}
