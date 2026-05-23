package notifications

import (
	"context"
	"os"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestPhase6NotificationRecipientsUseReverseEffectiveAccessAndRACIRouting(t *testing.T) {
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
	if _, err := repo.SetLogicGateRaciAssignments(store.LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleResponsible,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments: %v", err)
	}
	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	notifications, err := service.ProcessEvent(domain.NotificationEvent{
		EventID:     "66666666-6666-4666-8666-666666666699",
		CompanyID:   companyID,
		ActorUserID: &actor.UserID,
		Type:        domain.NotificationEventLogicGateStateChanged,
		EntityType:  "kanban_card",
		EntityID:    "card-phase6",
		Payload: map[string]any{
			"logic_gate_id":      logicGate.LogicGateID,
			"node_id":            node.NodeID,
			"node_title":         node.Title,
			"column_title":       "In Progress",
			"actor_display_name": "Actor",
		},
	})
	if err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}

	byUser := map[string]domain.Notification{}
	for _, item := range notifications {
		byUser[item.RecipientUserID] = item
	}
	for _, user := range []domain.User{viewer, editor, admin, responsible} {
		if _, ok := byUser[user.UserID]; !ok {
			t.Fatalf("missing notification for effective user %s; got %+v", user.UserID, notifications)
		}
	}
	if _, ok := byUser[blocked.UserID]; ok {
		t.Fatalf("blocked user received notification: %+v", byUser[blocked.UserID])
	}
	if _, ok := byUser[actor.UserID]; ok {
		t.Fatalf("actor received self notification: %+v", byUser[actor.UserID])
	}
	if got := byUser[responsible.UserID]; got.Surface != domain.NotificationSurfaceRInbox || got.Role != domain.LogicGateRaciRoleResponsible {
		t.Fatalf("responsible metadata = %+v, want R inbox responsible", got)
	}
	if got := byUser[viewer.UserID]; got.Surface != domain.NotificationSurfaceACIInbox || got.Role != domain.NotificationRoleOther {
		t.Fatalf("viewer metadata = %+v, want ACI other fallback", got)
	}
}

func TestProcessDomainEventsLogicGateWorkUsesEffectiveAccessAndRACI(t *testing.T) {
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
	if _, err := repo.SetLogicGateRaciAssignments(store.LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleResponsible,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments: %v", err)
	}
	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany setup: %v", err)
	}

	process := func(label, wantType, wantTitle string, events []domain.DomainEvent) []domain.Notification {
		t.Helper()
		if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
			t.Fatalf("%s RebuildEffectiveResourceAccessForCompany: %v", label, err)
		}
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
		for _, user := range []domain.User{viewer, responsible} {
			if _, ok := byUser[user.UserID]; !ok {
				t.Fatalf("%s missing notification for eligible user %s; got %+v", label, user.UserID, items)
			}
		}
		for _, user := range []domain.User{actor, blocked, nodeOnlyViewer} {
			if _, ok := byUser[user.UserID]; ok {
				t.Fatalf("%s unexpected notification for user %s: %+v", label, user.UserID, byUser[user.UserID])
			}
		}
		if got := byUser[responsible.UserID]; got.Surface != domain.NotificationSurfaceRInbox || got.Role != domain.LogicGateRaciRoleResponsible {
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
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	process("saved", store.WorkItemLogicGateAssignmentSavedEventType, "added", assigned.Events)

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
	for _, path := range []string{
		"service.go",
		"../store/postgres_notifications.go",
		"../store/memory_notifications.go",
	} {
		source := strings.ToLower(readNotificationSourceForTest(t, path))
		for _, forbidden := range []string{
			"listaccessibleentityids",
			"mangorts_user_can_access_resource",
			"usercanaccessentity",
			"usercanaccessentitylocked",
		} {
			if strings.Contains(source, forbidden) {
				t.Fatalf("%s contains forbidden notification hot path %q", path, forbidden)
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
