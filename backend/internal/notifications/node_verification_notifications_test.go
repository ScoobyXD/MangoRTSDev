package notifications

import (
	"context"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"strings"
	"testing"
)

func TestVerificationRequestNotifiesSnapshottedRecipientsWithTimelineDeepLink(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "63636363-6363-4363-8363-636363636301"
	repo.EnsureCompany(companyID, "Verification Notification Co")
	actor := mustNotificationUser(t, repo, companyID, "verification-notification-actor")
	first := mustNotificationUser(t, repo, companyID, "verification-notification-first")
	second := mustNotificationUser(t, repo, companyID, "verification-notification-second")
	node, err := repo.CreateNode(companyID, "Quarterly verification packet")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 2
	if _, err := repo.UpdateNode(store.UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Priority: &priority, PrioritySet: true}); err != nil {
		t.Fatalf("UpdateNode priority: %v", err)
	}
	_, err = repo.SetResourceRACIAssignments(store.ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: store.EntityTypeNode, ResourceID: node.NodeID,
		Assignments: []store.ResourceRACIAssignmentInput{
			{Role: domain.RACIRoleAccountable, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: actor.UserID},
			{Role: domain.RACIRoleAccountable, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: first.UserID},
			{Role: domain.RACIRoleAccountable, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: second.UserID},
		},
	})
	if err != nil {
		t.Fatalf("SetResourceRACIAssignments: %v", err)
	}
	result, err := repo.CreateNodeVerificationRequest(store.NodeVerificationRequestInput{CompanyID: companyID, NodeID: node.NodeID, ActorUserID: actor.UserID, IdempotencyKey: "notification-verification-one"})
	if err != nil {
		t.Fatalf("CreateNodeVerificationRequest: %v", err)
	}
	items, err := service.ProcessDomainEvents(context.Background(), result.Events)
	if err != nil {
		t.Fatalf("ProcessDomainEvents: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("notifications = %+v, want two non-actor recipients", items)
	}
	seen := map[string]bool{}
	for _, item := range items {
		seen[item.RecipientUserID] = true
		if item.Type != domain.NotificationEventNodeVerificationRequested || item.Surface != domain.NotificationSurfaceACIInbox || item.Role != domain.RACIRoleAccountable {
			t.Fatalf("verification notification routing = %+v", item)
		}
		if item.NodeID != node.NodeID || item.InformationID != result.TimelineEvent.EventID || item.Priority == nil || *item.Priority != priority {
			t.Fatalf("verification notification context = %+v", item)
		}
		if !strings.Contains(item.Title, actor.DisplayName) || !strings.Contains(item.Title, "requested verification") {
			t.Fatalf("verification notification title = %q", item.Title)
		}
	}
	if !seen[first.UserID] || !seen[second.UserID] || seen[actor.UserID] {
		t.Fatalf("recipient set = %v", seen)
	}

	rule, ok := UpdateFeedEventFromDomainEvent(result.Events[0])
	if !ok || rule.NotificationType != domain.NotificationEventNodeVerificationRequested || rule.EntityType != store.EntityTypeNode || rule.EntityID != node.NodeID {
		t.Fatalf("update feed rule = %+v ok=%v", rule, ok)
	}
}
