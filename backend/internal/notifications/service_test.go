package notifications

import (
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
