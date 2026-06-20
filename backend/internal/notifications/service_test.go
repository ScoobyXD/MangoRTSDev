package notifications

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestUpdateFeedEventFromDomainEventDefinesDedicatedFeedRows(t *testing.T) {
	logicGateID := "11111111-1111-4111-8111-555555555501"
	nodeID := "22222222-2222-4222-8222-555555555502"

	rule, ok := UpdateFeedEventFromDomainEvent(domain.DomainEvent{
		Type: store.WorkItemLogicGateAssignmentSavedEventType,
		Payload: map[string]any{
			"logic_gate_id": logicGateID,
			"node_id":       nodeID,
		},
	})
	if !ok {
		t.Fatalf("work item assignment event did not create an update feed rule")
	}
	if rule.NotificationType != store.WorkItemLogicGateAssignmentSavedEventType || rule.EntityType != store.EntityTypeLogicGate || rule.EntityID != logicGateID {
		t.Fatalf("work item update rule = %+v, want logic gate assignment rule", rule)
	}

	rule, ok = UpdateFeedEventFromDomainEvent(domain.DomainEvent{
		Type: "node_updated",
		Payload: map[string]any{
			"node_id":                 nodeID,
			"notification_event_type": domain.NotificationEventNodeAssigned,
		},
	})
	if !ok {
		t.Fatalf("node assignment event did not create an update feed rule")
	}
	if rule.NotificationType != domain.NotificationEventNodeAssigned || rule.EntityType != store.EntityTypeNode || rule.EntityID != nodeID {
		t.Fatalf("node assignment update rule = %+v, want node assignment rule", rule)
	}

	if _, ok := UpdateFeedEventFromDomainEvent(domain.DomainEvent{
		Type: "kanban_card_moved",
		Payload: map[string]any{
			"node_id": nodeID,
		},
	}); ok {
		t.Fatalf("low-level kanban_card_moved event should not create an update feed row directly")
	}
}

func TestUpdateFeedAffectedScopesTargetsRecipientUser(t *testing.T) {
	companyID := "11111111-1111-4111-8111-555555555511"
	userID := "22222222-2222-4222-8222-555555555512"
	scopes := UpdateFeedAffectedScopes(domain.Notification{
		CompanyID:       companyID,
		RecipientUserID: userID,
	})
	if !notificationScopeContains(scopes, store.UpdatesUserScope(userID)) {
		t.Fatalf("update feed scopes = %+v, want user scope", scopes)
	}
	if notificationScopeContains(scopes, store.UpdatesCompanyScope(companyID)) {
		t.Fatalf("update feed scopes = %+v, should not include company scope when recipient user is known", scopes)
	}
}

func TestPhase6NotificationRecipientsUseGVICRouting(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "66666666-6666-4666-8666-666666666601"
	repo.EnsureCompany(companyID, "Phase 6 Notifications Co")

	viewer := mustNotificationUser(t, repo, companyID, "phase6-notify-viewer")
	editor := mustNotificationUser(t, repo, companyID, "phase6-notify-editor")
	admin := mustNotificationUser(t, repo, companyID, "phase6-notify-admin")
	responsible := mustNotificationUser(t, repo, companyID, "phase6-notify-responsible")
	blocked := mustNotificationUser(t, repo, companyID, "phase6-notify-blocked")
	actor := mustNotificationUser(t, repo, companyID, "phase6-notify-actor")

	logicGate, err := repo.CreateLogicGate(companyID, "Phase 6 Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Phase 6 Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "in_progress",
		Priority:    testPriority(3),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: store.EntityPermissionEdit, Permission: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: admin.UserID, AccessLevel: store.EntityPermissionAdmin, Permission: store.EntityPermissionAdmin},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: actor.UserID, AccessLevel: store.EntityPermissionAdmin, Permission: store.EntityPermissionAdmin},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments: %v", err)
	}

	notifications, err := service.ProcessDomainEvent(context.Background(), domain.DomainEvent{
		EventID:     "66666666-6666-4666-8666-666666666699",
		CompanyID:   companyID,
		StreamType:  "workspace",
		StreamID:    companyID,
		ActorUserID: &actor.UserID,
		Type:        store.WorkItemLogicGateAssignmentMovedEventType,
		Payload: map[string]any{
			"logic_gate_id": logicGate.LogicGateID,
			"node_id":       node.NodeID,
			"node_title":    node.Title,
			"status":        "In Progress",
		},
	})
	if err != nil {
		t.Fatalf("ProcessDomainEvent: %v", err)
	}

	byUser := map[string]domain.Notification{}
	for _, item := range notifications {
		byUser[item.RecipientUserID] = item
	}
	for _, user := range []domain.User{responsible} {
		if _, ok := byUser[user.UserID]; !ok {
			t.Fatalf("missing notification for GVIC user %s; got %+v", user.UserID, notifications)
		}
	}
	for _, user := range []domain.User{viewer, editor, admin, blocked, actor} {
		if _, ok := byUser[user.UserID]; ok {
			t.Fatalf("non-GVIC user %s received notification: %+v", user.UserID, byUser[user.UserID])
		}
	}
	if got := byUser[responsible.UserID]; got.Surface != domain.NotificationSurfaceRInbox || got.Role != domain.GVICRoleGenerated {
		t.Fatalf("responsible metadata = %+v, want R inbox responsible", got)
	}
}

func notificationScopeContains(scopes []string, want string) bool {
	for _, scope := range scopes {
		if scope == want {
			return true
		}
	}
	return false
}

func TestProcessDomainEventsLogicGateWorkUsesGVICMatrixnly(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "66666666-6666-4666-8666-666666666611"
	repo.EnsureCompany(companyID, "Notification Projector Co")

	viewer := mustNotificationUser(t, repo, companyID, "projector-viewer")
	nodeOnlyViewer := mustNotificationUser(t, repo, companyID, "projector-node-viewer")
	responsible := mustNotificationUser(t, repo, companyID, "projector-responsible")
	actor := mustNotificationUser(t, repo, companyID, "projector-actor")
	blocked := mustNotificationUser(t, repo, companyID, "projector-blocked")

	logicGate, err := repo.CreateLogicGate(companyID, "Projector Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Projector Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: actor.UserID, AccessLevel: store.EntityPermissionAdmin, Permission: store.EntityPermissionAdmin},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions logic gate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: nodeOnlyViewer.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions node: %v", err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments: %v", err)
	}

	process := func(label, wantType, wantTitle string, events []domain.DomainEvent) []domain.Notification {
		t.Helper()
		items, err := service.ProcessDomainEvents(context.Background(), events)
		if err != nil {
			t.Fatalf("%s ProcessDomainEvents: %v", label, err)
		}
		byUser := map[string]domain.Notification{}
		for _, item := range items {
			if item.Type != wantType {
				t.Fatalf("%s notification type = %q, want %q", label, item.Type, wantType)
			}
			if !strings.Contains(item.Title, wantTitle) {
				t.Fatalf("%s notification title = %q, want it to contain %q", label, item.Title, wantTitle)
			}
			if item.EntityType != store.EntityTypeLogicGate || item.EntityID != logicGate.LogicGateID || item.LogicGateID != logicGate.LogicGateID || item.NodeID != node.NodeID {
				t.Fatalf("%s notification target = %+v, want logic gate/node target", label, item)
			}
			byUser[item.RecipientUserID] = item
		}
		for _, user := range []domain.User{responsible} {
			if _, ok := byUser[user.UserID]; !ok {
				t.Fatalf("%s missing notification for eligible user %s; got %+v", label, user.UserID, items)
			}
		}
		for _, user := range []domain.User{viewer, actor, blocked, nodeOnlyViewer} {
			if _, ok := byUser[user.UserID]; ok {
				t.Fatalf("%s unexpected notification for user %s: %+v", label, user.UserID, byUser[user.UserID])
			}
		}
		if got := byUser[responsible.UserID]; got.Surface != domain.NotificationSurfaceRInbox || got.Role != domain.GVICRoleGenerated {
			t.Fatalf("%s responsible metadata = %+v, want responsible R inbox", label, got)
		}
		return items
	}

	assigned, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		ActorUserID: actor.UserID,
		Priority:    testPriority(3),
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	process("saved", store.WorkItemLogicGateAssignmentSavedEventType, "Brand new node", assigned.Events)

	moved, err := repo.MoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "done",
		ActorUserID: actor.UserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment: %v", err)
	}
	process("moved", store.WorkItemLogicGateAssignmentMovedEventType, "Done", moved.Events)
	if _, err := service.ProcessDomainEvent(context.Background(), moved.Events[0]); err != nil {
		t.Fatalf("duplicate ProcessDomainEvent: %v", err)
	}
	responsibleNotifications, err := repo.ListNotifications(store.NotificationListInput{UserID: responsible.UserID, CompanyID: companyID, Limit: 50})
	if err != nil {
		t.Fatalf("ListNotifications responsible: %v", err)
	}
	duplicateCount := 0
	for _, item := range responsibleNotifications {
		if item.SourceEventID == moved.Events[0].EventID {
			duplicateCount++
		}
	}
	if duplicateCount != 1 {
		t.Fatalf("responsible duplicate moved notifications = %d, want 1: %+v", duplicateCount, responsibleNotifications)
	}

	issue, err := repo.SetLogicGateNodeAssignmentIssue(store.LogicGateNodeAssignmentIssueInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		IsIssue:     true,
		ActorUserID: actor.UserID,
	})
	if err != nil {
		t.Fatalf("SetLogicGateNodeAssignmentIssue: %v", err)
	}
	process("issue", store.WorkItemLogicGateIssueToggledEventType, "issue", issue.Events)

	removed, err := repo.RemoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentRemoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		ActorUserID: actor.UserID,
	})
	if err != nil {
		t.Fatalf("RemoveLogicGateNodeAssignment: %v", err)
	}
	process("removed", store.WorkItemLogicGateAssignmentRemovedEventType, "removed", removed.Events)
}

func TestProcessDomainEventLogicGateWorkReviewMoveNotifiesGVICRecipients(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "66666666-6666-4666-8666-666666666612"
	repo.EnsureCompany(companyID, "Review Notification Co")

	generated := mustNotificationUser(t, repo, companyID, "review-generated")
	verified := mustNotificationUser(t, repo, companyID, "review-verified")
	consulted := mustNotificationUser(t, repo, companyID, "review-consulted")
	informed := mustNotificationUser(t, repo, companyID, "review-informed")
	actor := mustNotificationUser(t, repo, companyID, "review-actor")
	viewer := mustNotificationUser(t, repo, companyID, "review-viewer")

	logicGate, err := repo.CreateLogicGate(companyID, "Review Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Review Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{
			{Role: domain.GVICRoleGenerated, UserID: generated.UserID},
			{Role: domain.GVICRoleVerified, UserID: verified.UserID},
			{Role: domain.GVICRoleConsulted, UserID: consulted.UserID},
			{Role: domain.GVICRoleInformed, UserID: informed.UserID},
		},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: actor.UserID, AccessLevel: store.EntityPermissionAdmin, Permission: store.EntityPermissionAdmin},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	assigned, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    testPriority(2),
		PrioritySet: true,
		ActorUserID: actor.UserID,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if assigned.Assignment.StatusKey != store.LogicGateWorkStatusPending {
		t.Fatalf("assigned status = %q, want pending", assigned.Assignment.StatusKey)
	}
	moved, err := repo.MoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "review",
		ActorUserID: actor.UserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment: %v", err)
	}
	if moved.Assignment.StatusKey != store.LogicGateWorkStatusReview || moved.Node.Status == nil || *moved.Node.Status != "Review" {
		t.Fatalf("moved status assignment=%q node=%+v, want Review", moved.Assignment.StatusKey, moved.Node.Status)
	}

	items, err := service.ProcessDomainEvent(context.Background(), moved.Events[0])
	if err != nil {
		t.Fatalf("ProcessDomainEvent: %v", err)
	}
	byUser := map[string]domain.Notification{}
	for _, item := range items {
		if item.Type != store.WorkItemLogicGateAssignmentMovedEventType || !strings.Contains(item.Title, "Review") {
			t.Fatalf("review notification = %+v, want moved Review notification", item)
		}
		if item.LogicGateID != logicGate.LogicGateID || item.NodeID != node.NodeID {
			t.Fatalf("review notification target = %+v", item)
		}
		byUser[item.RecipientUserID] = item
	}
	want := map[string]struct {
		surface string
		role    string
	}{
		generated.UserID: {surface: domain.NotificationSurfaceRInbox, role: domain.GVICRoleGenerated},
		verified.UserID:  {surface: domain.NotificationSurfaceACIInbox, role: domain.GVICRoleVerified},
		consulted.UserID: {surface: domain.NotificationSurfaceACIInbox, role: domain.GVICRoleConsulted},
		informed.UserID:  {surface: domain.NotificationSurfaceACIInbox, role: domain.GVICRoleInformed},
	}
	if len(byUser) != len(want) {
		t.Fatalf("review notification recipients = %+v, want %d GVIC users", byUser, len(want))
	}
	for userID, expected := range want {
		item, ok := byUser[userID]
		if !ok {
			t.Fatalf("missing review notification for %s; got %+v", userID, byUser)
		}
		if item.Surface != expected.surface || item.Role != expected.role {
			t.Fatalf("review notification metadata for %s = %+v, want %s/%s", userID, item, expected.surface, expected.role)
		}
	}
	if _, ok := byUser[actor.UserID]; ok {
		t.Fatalf("actor received review notification: %+v", byUser[actor.UserID])
	}
	if _, ok := byUser[viewer.UserID]; ok {
		t.Fatalf("non-GVIC viewer received review notification: %+v", byUser[viewer.UserID])
	}
}

func TestProcessDomainEventNodeMentionFiltersByEffectiveAccessAndSkipsActor(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "66666666-6666-4666-8666-666666666621"
	repo.EnsureCompany(companyID, "Node Mention Projector Co")

	allowed := mustNotificationUser(t, repo, companyID, "node-mention-allowed")
	blocked := mustNotificationUser(t, repo, companyID, "node-mention-blocked")
	actor := mustNotificationUser(t, repo, companyID, "node-mention-actor")
	node, err := repo.CreateNode(companyID, "Mentioned Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: allowed.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: actor.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	items, err := service.ProcessDomainEvent(context.Background(), domain.DomainEvent{
		EventID:     "66666666-6666-4666-8666-666666666622",
		CompanyID:   companyID,
		StreamType:  "notification",
		StreamID:    "node:" + node.NodeID,
		Type:        store.NodeMentionCreatedEventType,
		ActorUserID: &actor.UserID,
		Payload: map[string]any{
			"node_id":            node.NodeID,
			"comment":            "@allowed @blocked @actor",
			"mentioned_user_ids": []string{allowed.UserID, blocked.UserID, actor.UserID},
			"actor_display_name": "Mention Actor",
		},
	})
	if err != nil {
		t.Fatalf("ProcessDomainEvent: %v", err)
	}
	if len(items) != 1 || items[0].RecipientUserID != allowed.UserID {
		t.Fatalf("mention notifications = %+v, want allowed user only", items)
	}
	if items[0].Type != domain.NotificationEventMentionCreated || items[0].EntityType != store.EntityTypeNode || items[0].EntityID != node.NodeID {
		t.Fatalf("mention notification target = %+v, want node mention", items[0])
	}
}

func TestProcessDomainEventUnsupportedMentionCreatesNoNotification(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "66666666-6666-4666-8666-666666666623"
	repo.EnsureCompany(companyID, "Unsupported Mention Projector Co")

	mentioned := mustNotificationUser(t, repo, companyID, "unsupported-mention-user")
	items, err := service.ProcessDomainEvent(context.Background(), domain.DomainEvent{
		EventID:    "66666666-6666-4666-8666-666666666624",
		CompanyID:  companyID,
		StreamType: "notification",
		StreamID:   "document:unsupported",
		Type:       "document.mention_created",
		Payload: map[string]any{
			"entity_type":        "document",
			"entity_id":          "unsupported",
			"mentioned_user_ids": []string{mentioned.UserID},
			"comment":            "@Unsupported Mention User",
		},
	})
	if err != nil {
		t.Fatalf("ProcessDomainEvent: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("unsupported mention notifications = %+v, want none", items)
	}
}

func TestProcessDomainEventNodeAssignmentUsesEffectiveAccessMyTriageAndSkipsActor(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "66666666-6666-4666-8666-666666666631"
	repo.EnsureCompany(companyID, "Node Assignment Projector Co")

	assignee := mustNotificationUser(t, repo, companyID, "node-assignment-assignee")
	viewer := mustNotificationUser(t, repo, companyID, "node-assignment-viewer")
	actor := mustNotificationUser(t, repo, companyID, "node-assignment-actor")
	node, err := repo.CreateNode(companyID, "Assigned Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: assignee.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: actor.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	items, err := service.ProcessDomainEvent(context.Background(), domain.DomainEvent{
		EventID:     "66666666-6666-4666-8666-666666666632",
		CompanyID:   companyID,
		StreamType:  "workspace",
		StreamID:    companyID,
		Type:        "node_updated",
		ActorUserID: &actor.UserID,
		Payload: map[string]any{
			"node_id":                 node.NodeID,
			"notification_event_type": domain.NotificationEventNodeAssigned,
			"recipient_user_ids":      []string{assignee.UserID},
			"node_title":              node.Title,
		},
	})
	if err != nil {
		t.Fatalf("ProcessDomainEvent: %v", err)
	}
	if len(items) != 1 || items[0].RecipientUserID != assignee.UserID {
		t.Fatalf("assignment notifications = %+v, want assignee only", items)
	}
	if items[0].Surface != domain.NotificationSurfaceMyTriage || items[0].Role != domain.NotificationRoleOther {
		t.Fatalf("assignment metadata = %+v, want my triage other", items[0])
	}
	if items[0].NodeID != node.NodeID || items[0].EntityType != store.EntityTypeNode || items[0].EntityID != node.NodeID {
		t.Fatalf("assignment target = %+v, want node target", items[0])
	}

	selfItems, err := service.ProcessDomainEvent(context.Background(), domain.DomainEvent{
		EventID:     "66666666-6666-4666-8666-666666666633",
		CompanyID:   companyID,
		StreamType:  "workspace",
		StreamID:    companyID,
		Type:        "node_updated",
		ActorUserID: &assignee.UserID,
		Payload: map[string]any{
			"node_id":                 node.NodeID,
			"notification_event_type": domain.NotificationEventNodeAssigned,
			"recipient_user_ids":      []string{assignee.UserID},
		},
	})
	if err != nil {
		t.Fatalf("self ProcessDomainEvent: %v", err)
	}
	if len(selfItems) != 0 {
		t.Fatalf("self assignment notifications = %+v, want none", selfItems)
	}
}

func TestProcessDomainEventNodeAssignmentRevocationBeforeProcessingSuppresses(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "66666666-6666-4666-8666-666666666641"
	repo.EnsureCompany(companyID, "Node Assignment Revocation Co")

	assignee := mustNotificationUser(t, repo, companyID, "node-assignment-revoked")
	actor := mustNotificationUser(t, repo, companyID, "node-assignment-revoke-actor")
	node, err := repo.CreateNode(companyID, "Revoked Assignment Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		OverrideUserIDs:  []string{assignee.UserID},
	}); err != nil {
		t.Fatalf("SetEntityPermissions grant: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions revoke: %v", err)
	}

	items, err := service.ProcessDomainEvent(context.Background(), domain.DomainEvent{
		EventID:     "66666666-6666-4666-8666-666666666642",
		CompanyID:   companyID,
		StreamType:  "workspace",
		StreamID:    companyID,
		Type:        "node_updated",
		ActorUserID: &actor.UserID,
		Payload: map[string]any{
			"node_id":                 node.NodeID,
			"notification_event_type": domain.NotificationEventNodeAssigned,
			"recipient_user_ids":      []string{assignee.UserID},
		},
	})
	if err != nil {
		t.Fatalf("ProcessDomainEvent: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("revoked assignment notifications = %+v, want none", items)
	}
}

func TestProcessDomainEventSharedInboxGVICUsesNotificationRoles(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "66666666-6666-4666-8666-666666666651"
	repo.EnsureCompany(companyID, "Shared Inbox GVIC Co")

	responsible := mustNotificationUser(t, repo, companyID, "shared-GVIC-responsible")
	accountable := mustNotificationUser(t, repo, companyID, "shared-GVIC-accountable")
	groupMember := mustNotificationUser(t, repo, companyID, "shared-GVIC-group-member")
	viewer := mustNotificationUser(t, repo, companyID, "shared-GVIC-viewer")
	blocked := mustNotificationUser(t, repo, companyID, "shared-GVIC-blocked")
	actor := mustNotificationUser(t, repo, companyID, "shared-GVIC-actor")
	parentGroup, err := repo.CreateCompanyUserGroup(companyID, "", "Shared GVIC parent")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup parent: %v", err)
	}
	childGroup, err := repo.CreateCompanyUserGroup(companyID, parentGroup.GroupID, "Shared GVIC child")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup child: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, childGroup.GroupID, []string{groupMember.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers: %v", err)
	}
	const sharedGVICAccountEmail = "shared-GVIC@example.com"
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       actor.UserID,
		Provider:     "google",
		AccountEmail: sharedGVICAccountEmail,
		Scope:        "shared",
		GrantID:      "shared-GVIC-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatalf("UpsertUserEmailConnection shared: %v", err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Shared GVIC Inbox", sharedGVICAccountEmail)
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedInbox,
		EntityID:   folder.FolderID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: responsible.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: accountable.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
			{SubjectType: store.EntityPermissionSubjectGroup, SubjectID: parentGroup.GroupID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: actor.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	if _, err := repo.SetResourceGVICAssignments(store.ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: store.EntityTypeSharedInbox,
		ResourceID:   folder.FolderID,
		Assignments: []store.ResourceGVICAssignmentInput{
			{Role: domain.GVICRoleGenerated, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: responsible.UserID},
			{Role: domain.GVICRoleVerified, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: accountable.UserID},
			{Role: domain.GVICRoleConsulted, PrincipalType: store.EntityPermissionSubjectGroup, PrincipalID: parentGroup.GroupID},
			{Role: domain.GVICRoleInformed, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: blocked.UserID},
		},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments shared inbox: %v", err)
	}

	items, err := service.ProcessDomainEvent(context.Background(), domain.DomainEvent{
		EventID:     "66666666-6666-4666-8666-666666666652",
		CompanyID:   companyID,
		StreamType:  "workspace",
		StreamID:    companyID,
		Type:        "communications_shared_inbox_gvic_updated",
		ActorUserID: &actor.UserID,
		Payload: map[string]any{
			"folder_id":       folder.FolderID,
			"shared_inbox_id": folder.SharedInboxID,
			"folder_kind":     "communications",
			"resource_type":   store.EntityTypeSharedInbox,
		},
	})
	if err != nil {
		t.Fatalf("ProcessDomainEvent: %v", err)
	}
	byUser := map[string]domain.Notification{}
	for _, item := range items {
		if item.Surface != domain.NotificationSurfaceSharedTriage {
			t.Fatalf("shared inbox surface = %+v, want shared triage", item)
		}
		if item.EntityType != store.EntityTypeSharedInbox || item.EntityID != folder.FolderID {
			t.Fatalf("shared inbox target = %+v, want shared inbox", item)
		}
		byUser[item.RecipientUserID] = item
	}
	for _, user := range []domain.User{responsible, accountable, groupMember, blocked} {
		if _, ok := byUser[user.UserID]; !ok {
			t.Fatalf("missing shared inbox notification for %s; got %+v", user.UserID, items)
		}
	}
	for _, user := range []domain.User{viewer, actor} {
		if _, ok := byUser[user.UserID]; ok {
			t.Fatalf("unexpected shared inbox notification for %s: %+v", user.UserID, byUser[user.UserID])
		}
	}
	if got := byUser[responsible.UserID]; got.Role != domain.GVICRoleGenerated {
		t.Fatalf("generated role = %+v, want generated", got)
	}
	if got := byUser[accountable.UserID]; got.Role != domain.GVICRoleVerified {
		t.Fatalf("verified role = %+v, want verified", got)
	}
	if got := byUser[groupMember.UserID]; got.Role != domain.GVICRoleConsulted {
		t.Fatalf("group member role = %+v, want consulted", got)
	}
	if got := byUser[blocked.UserID]; got.Role != domain.GVICRoleInformed {
		t.Fatalf("blocked role = %+v, want informed", got)
	}
	visible, err := repo.ListNotifications(store.NotificationListInput{UserID: responsible.UserID, CompanyID: companyID, Limit: 50})
	if err != nil {
		t.Fatalf("ListNotifications responsible: %v", err)
	}
	if len(visible) != 1 || visible[0].Surface != domain.NotificationSurfaceSharedTriage || visible[0].Role != domain.GVICRoleGenerated {
		t.Fatalf("generated visible notifications = %+v, want shared triage generated row", visible)
	}
	summary, err := repo.GetNotificationSummary(store.NotificationSummaryInput{UserID: responsible.UserID, CompanyID: companyID})
	if err != nil {
		t.Fatalf("GetNotificationSummary responsible: %v", err)
	}
	if summary.TotalUnread != 1 || len(summary.RoleCounts) != 1 || summary.RoleCounts[0].Surface != domain.NotificationSurfaceSharedTriage || summary.RoleCounts[0].Role != domain.GVICRoleGenerated || summary.RoleCounts[0].Count != 1 {
		t.Fatalf("generated summary = %+v, want one shared triage generated target", summary)
	}
}

func TestProcessDomainEventSharedTriageAccessRevocationBeforeProcessingSuppresses(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "66666666-6666-4666-8666-666666666661"
	repo.EnsureCompany(companyID, "Shared Inbox Access Revocation Co")

	user := mustNotificationUser(t, repo, companyID, "shared-access-revoked")
	actor := mustNotificationUser(t, repo, companyID, "shared-access-actor")
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Revoked Shared Inbox", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedTriageFolder,
		EntityID:   folder.FolderID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: store.EntityPermissionView,
			Permission:  store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions grant: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{CompanyID: companyID, EntityType: store.EntityTypeSharedTriageFolder, EntityID: folder.FolderID}); err != nil {
		t.Fatalf("SetEntityPermissions revoke: %v", err)
	}

	items, err := service.ProcessDomainEvent(context.Background(), domain.DomainEvent{
		EventID:     "66666666-6666-4666-8666-666666666662",
		CompanyID:   companyID,
		StreamType:  "workspace",
		StreamID:    companyID,
		Type:        "shared_triage_access_updated",
		ActorUserID: &actor.UserID,
		Payload: map[string]any{
			"folder_id":   folder.FolderID,
			"folder_kind": "communications",
		},
	})
	if err != nil {
		t.Fatalf("ProcessDomainEvent: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("revoked shared access notifications = %+v, want none", items)
	}
}

func TestProcessDomainEventDuplicateReturnsNoNewNotifications(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "66666666-6666-4666-8666-666666666671"
	repo.EnsureCompany(companyID, "Duplicate Notification Co")

	assignee := mustNotificationUser(t, repo, companyID, "duplicate-assignee")
	actor := mustNotificationUser(t, repo, companyID, "duplicate-actor")
	node, err := repo.CreateNode(companyID, "Duplicate Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   assignee.UserID,
			AccessLevel: store.EntityPermissionView,
			Permission:  store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	event := domain.DomainEvent{
		EventID:     "66666666-6666-4666-8666-666666666672",
		CompanyID:   companyID,
		StreamType:  "workspace",
		StreamID:    companyID,
		Type:        "node_updated",
		ActorUserID: &actor.UserID,
		Payload: map[string]any{
			"node_id":                 node.NodeID,
			"notification_event_type": domain.NotificationEventNodeAssigned,
			"recipient_user_ids":      []string{assignee.UserID},
		},
	}
	items, err := service.ProcessDomainEvent(context.Background(), event)
	if err != nil {
		t.Fatalf("first ProcessDomainEvent: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("first ProcessDomainEvent created %d notifications, want 1: %+v", len(items), items)
	}
	again, err := service.ProcessDomainEvent(context.Background(), event)
	if err != nil {
		t.Fatalf("duplicate ProcessDomainEvent: %v", err)
	}
	if len(again) != 0 {
		t.Fatalf("duplicate ProcessDomainEvent returned %d notifications, want 0 newly-created rows: %+v", len(again), again)
	}
	visible, err := repo.ListNotifications(store.NotificationListInput{UserID: assignee.UserID, CompanyID: companyID, Limit: 50})
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(visible) != 1 {
		t.Fatalf("visible notifications = %d, want 1: %+v", len(visible), visible)
	}
}

func TestReplayDomainEventsRetriesFailedProjectionWithoutAdvancingCheckpoint(t *testing.T) {
	base := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666681"
	base.EnsureCompany(companyID, "Notification Replay Co")

	assignee := mustNotificationUser(t, base, companyID, "replay-assignee")
	actor := mustNotificationUser(t, base, companyID, "replay-actor")
	node, err := base.CreateNode(companyID, "Replay Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := base.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   assignee.UserID,
			AccessLevel: store.EntityPermissionView,
			Permission:  store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	event, err := base.AppendDomainEvent(store.DomainEventInput{
		CompanyID:   companyID,
		StreamType:  "workspace",
		StreamID:    companyID,
		Type:        "node_updated",
		ActorUserID: actor.UserID,
		Payload: map[string]any{
			"node_id":                 node.NodeID,
			"notification_event_type": domain.NotificationEventNodeAssigned,
			"recipient_user_ids":      []string{assignee.UserID},
		},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent: %v", err)
	}

	createErr := errors.New("create notifications failed")
	repo := &createNotificationsFailOnceRepo{Repository: base, err: createErr, remaining: 1}
	service := NewService(repo)
	result, items, err := service.ReplayDomainEvents(context.Background(), companyID, 10)
	if !errors.Is(err, createErr) {
		t.Fatalf("first ReplayDomainEvents err = %v, want %v", err, createErr)
	}
	if result.ProcessedEvents != 0 || len(items) != 0 {
		t.Fatalf("failed replay result = %+v items=%+v, want no checkpoint advance or notifications", result, items)
	}
	if checkpoint, ok, err := base.GetNotificationDomainEventCheckpoint(companyID); err != nil || ok {
		t.Fatalf("checkpoint after failed replay = %+v ok=%v err=%v, want absent", checkpoint, ok, err)
	}

	result, items, err = service.ReplayDomainEvents(context.Background(), companyID, 10)
	if err != nil {
		t.Fatalf("retry ReplayDomainEvents: %v", err)
	}
	if result.ProcessedEvents != 1 || result.CreatedNotifications != 1 || len(items) != 1 {
		t.Fatalf("retry result = %+v items=%+v, want one processed notification", result, items)
	}
	if result.LastCheckpoint.EventID != event.EventID || !result.LastCheckpoint.CreatedTimestamp.Equal(event.CreatedTimestamp) {
		t.Fatalf("checkpoint = %+v, want event %s at %s", result.LastCheckpoint, event.EventID, event.CreatedTimestamp)
	}
	again, err := service.ProcessDomainEvent(context.Background(), event)
	if err != nil {
		t.Fatalf("duplicate ProcessDomainEvent after replay: %v", err)
	}
	if len(again) != 0 {
		t.Fatalf("duplicate after replay returned %+v, want no newly-created rows", again)
	}
	visible, err := base.ListNotifications(store.NotificationListInput{UserID: assignee.UserID, CompanyID: companyID, Limit: 50})
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(visible) != 1 {
		t.Fatalf("visible notifications = %d, want 1: %+v", len(visible), visible)
	}
}

func TestReplayDomainEventsSkipsMissingSourceEntityAndAdvancesCheckpoint(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "66666666-6666-4666-8666-666666666682"
	repo.EnsureCompany(companyID, "Notification Stale Replay Co")

	assignee := mustNotificationUser(t, repo, companyID, "stale-replay-assignee")
	actor := mustNotificationUser(t, repo, companyID, "stale-replay-actor")
	node, err := repo.CreateNode(companyID, "Replay After Stale Event")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   assignee.UserID,
			AccessLevel: store.EntityPermissionView,
			Permission:  store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	staleEvent, err := repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:   companyID,
		StreamType:  "workspace",
		StreamID:    companyID,
		Type:        store.WorkItemLogicGateAssignmentMovedEventType,
		ActorUserID: actor.UserID,
		Payload: map[string]any{
			"logic_gate_id": "66666666-6666-4666-8666-666666666683",
			"node_id":       node.NodeID,
			"node_title":    node.Title,
			"status":        "Review",
		},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent stale: %v", err)
	}
	validEvent, err := repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:   companyID,
		StreamType:  "workspace",
		StreamID:    companyID,
		Type:        "node_updated",
		ActorUserID: actor.UserID,
		Payload: map[string]any{
			"node_id":                 node.NodeID,
			"notification_event_type": domain.NotificationEventNodeAssigned,
			"recipient_user_ids":      []string{assignee.UserID},
		},
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent valid: %v", err)
	}

	result, items, err := service.ReplayDomainEvents(context.Background(), companyID, 10)
	if err != nil {
		t.Fatalf("ReplayDomainEvents: %v", err)
	}
	if result.ProcessedEvents != 2 || result.CreatedNotifications != 1 || len(items) != 1 {
		t.Fatalf("result = %+v items=%+v, want stale event skipped and valid event notified", result, items)
	}
	if items[0].SourceEventID == staleEvent.EventID {
		t.Fatalf("stale event produced notification: %+v", items[0])
	}
	if result.LastCheckpoint.EventID != validEvent.EventID || !result.LastCheckpoint.CreatedTimestamp.Equal(validEvent.CreatedTimestamp) {
		t.Fatalf("checkpoint = %+v, want valid event %s at %s", result.LastCheckpoint, validEvent.EventID, validEvent.CreatedTimestamp)
	}

	again, _, err := service.ReplayDomainEvents(context.Background(), companyID, 10)
	if err != nil {
		t.Fatalf("second ReplayDomainEvents: %v", err)
	}
	if again.ProcessedEvents != 0 {
		t.Fatalf("second replay processed %d events, want 0 after checkpoint advanced", again.ProcessedEvents)
	}
}

func TestNotificationRevocationAfterDeliveryHidesRowsAtReadTime(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "66666666-6666-4666-8666-666666666691"
	repo.EnsureCompany(companyID, "Notification Revocation Co")

	assignee := mustNotificationUser(t, repo, companyID, "delivery-revoked")
	actor := mustNotificationUser(t, repo, companyID, "delivery-actor")
	node, err := repo.CreateNode(companyID, "Delivered Then Revoked")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		OverrideUserIDs:  []string{assignee.UserID},
	}); err != nil {
		t.Fatalf("SetEntityPermissions grant: %v", err)
	}
	items, err := service.ProcessDomainEvent(context.Background(), domain.DomainEvent{
		EventID:     "66666666-6666-4666-8666-666666666692",
		CompanyID:   companyID,
		StreamType:  "workspace",
		StreamID:    companyID,
		Type:        "node_updated",
		ActorUserID: &actor.UserID,
		Payload: map[string]any{
			"node_id":                 node.NodeID,
			"notification_event_type": domain.NotificationEventNodeAssigned,
			"recipient_user_ids":      []string{assignee.UserID},
		},
	})
	if err != nil {
		t.Fatalf("ProcessDomainEvent: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("delivered notifications = %+v, want one", items)
	}
	before, err := repo.ListNotifications(store.NotificationListInput{UserID: assignee.UserID, CompanyID: companyID, Limit: 50})
	if err != nil {
		t.Fatalf("ListNotifications before revoke: %v", err)
	}
	if len(before) != 1 {
		t.Fatalf("visible before revoke = %+v, want one", before)
	}

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions revoke: %v", err)
	}
	after, err := repo.ListNotifications(store.NotificationListInput{UserID: assignee.UserID, CompanyID: companyID, Limit: 50})
	if err != nil {
		t.Fatalf("ListNotifications after revoke: %v", err)
	}
	if len(after) != 0 {
		t.Fatalf("visible after revoke = %+v, want hidden by read-time access guard", after)
	}
	summary, err := repo.GetNotificationSummary(store.NotificationSummaryInput{UserID: assignee.UserID, CompanyID: companyID})
	if err != nil {
		t.Fatalf("GetNotificationSummary after revoke: %v", err)
	}
	if summary.TotalUnread != 0 {
		t.Fatalf("summary after revoke = %+v, want no visible unread notifications", summary)
	}
	if _, err := repo.MarkNotificationRead(assignee.UserID, before[0].NotificationID, true); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("MarkNotificationRead after revoke err = %v, want ErrNotFound", err)
	}
}

func TestLogicGateWorkNotificationTargetsIncludeGateAndNode(t *testing.T) {
	targets := logicGateWorkNotificationTargets("gate-1", "node-1")
	if len(targets) != 2 {
		t.Fatalf("targets = %+v, want gate and node", targets)
	}
	if targets[0].EntityType != store.EntityTypeLogicGate || targets[0].EntityID != "gate-1" {
		t.Fatalf("first target = %+v, want logic gate", targets[0])
	}
	if targets[1].EntityType != store.EntityTypeNode || targets[1].EntityID != "node-1" {
		t.Fatalf("second target = %+v, want node", targets[1])
	}
}

func TestPhase6NotificationSourceShape(t *testing.T) {
	legacyTable := "notification_" + "events"
	legacySourceAnchor := "ensurenotification" + "sourceanchortx"
	legacyQueueInput := "notification" + "eventinput"
	for _, path := range []string{
		"service.go",
		"../http/notification_handlers.go",
		"../http/logic_gate_handlers.go",
		"../http/logic_gate_gvic_command_handlers.go",
		"../http/kanban_handlers.go",
		"../store/postgres_notifications.go",
		"../store/memory_notifications.go",
		"../store/node_graph_workspace_events.go",
		"../store/workspace_effective_fanout.go",
		"../store/workspace_event_fanout.go",
	} {
		source := strings.ToLower(readNotificationSourceForTest(t, path))
		for _, forbidden := range []string{
			legacyTable,
			legacySourceAnchor,
			legacyQueueInput,
			"recordandprocess",
			"processpending",
			"recordnotificationevent",
			"createnotificationevent",
			"listpendingnotificationevents",
			"marknotificationeventprocessed",
			"listaccessibleentityids",
			"usercanaccessentity",
			"usercanaccessentitylocked",
			"recordkanbanstatenotification",
			"kanbancardnotificationsnapshot",
		} {
			if strings.Contains(source, forbidden) {
				t.Fatalf("%s contains forbidden notification hot path %q", path, forbidden)
			}
		}
	}
	for _, path := range []string{
		"../store/repository.go",
		"../store/postgres_notifications.go",
		"../store/memory_notifications.go",
	} {
		source := strings.ToLower(readNotificationSourceForTest(t, path))
		for _, forbidden := range []string{
			legacyTable,
			legacySourceAnchor,
			legacyQueueInput,
			"createnotificationevent",
			"listpendingnotificationevents",
			"marknotificationeventprocessed",
		} {
			if strings.Contains(source, forbidden) {
				t.Fatalf("%s contains removed notification queue API %q", path, forbidden)
			}
		}
	}
}

func mustNotificationUser(t *testing.T, repo *store.MemoryRepo, companyID, subject string) domain.User {
	t.Helper()
	user, err := repo.UpsertAuthUser(subject, subject+"@example.com", subject)
	if err != nil {
		t.Fatalf("UpsertAuthUser %s: %v", subject, err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership %s: %v", subject, err)
	}
	return user
}

func readNotificationSourceForTest(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile %s: %v", path, err)
	}
	return string(content)
}

type createNotificationsFailOnceRepo struct {
	store.Repository
	err       error
	remaining int
}

func (r *createNotificationsFailOnceRepo) CreateNotifications(input store.CreateNotificationsInput) ([]domain.Notification, error) {
	if r.remaining > 0 {
		r.remaining--
		return nil, r.err
	}
	return r.Repository.CreateNotifications(input)
}
