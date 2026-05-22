package store

import (
	"os"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestPhase6WorkspaceEventAffectedUsersUseLogicGateEffectiveAccess(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777701"
	repo.EnsureCompany(companyID, "Phase 6 Workspace Co")

	viewer := mustWorkspaceFanoutUser(t, repo, companyID, "phase6-workspace-viewer")
	blocked := mustWorkspaceFanoutUser(t, repo, companyID, "phase6-workspace-blocked")
	logicGate, err := repo.CreateLogicGate(companyID, "Workspace Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Workspace Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   viewer.UserID,
			AccessLevel: EntityPermissionView,
			Permission:  EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	event := domain.DomainEvent{
		CompanyID:  companyID,
		StreamType: workspaceDomainStreamType,
		StreamID:   companyID,
		Sequence:   1,
		Type:       WorkItemLogicGateAssignmentMovedEventType,
		Payload: map[string]any{
			"logic_gate_id": logicGate.LogicGateID,
			"node_id":       node.NodeID,
		},
	}
	users, err := repo.ListEffectiveUsersForWorkspaceEvent(event)
	if err != nil {
		t.Fatalf("ListEffectiveUsersForWorkspaceEvent: %v", err)
	}
	if len(users) != 1 || users[0] != viewer.UserID {
		t.Fatalf("affected users = %+v, want only %s", users, viewer.UserID)
	}
	if stringSliceContains(users, blocked.UserID) {
		t.Fatalf("blocked user included in affected users: %+v", users)
	}

	appended, err := repo.AppendDomainEvent(DomainEventInput{
		CompanyID:  companyID,
		StreamType: workspaceDomainStreamType,
		StreamID:   companyID,
		Type:       WorkItemLogicGateAssignmentMovedEventType,
		Payload:    event.Payload,
	})
	if err != nil {
		t.Fatalf("AppendDomainEvent: %v", err)
	}
	version, found, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, UserID: viewer.UserID, Scope: "workspace-snapshot:full"})
	if err != nil {
		t.Fatalf("CurrentWorkspaceReadVersion viewer: %v", err)
	}
	if !found || version != appended.Sequence {
		t.Fatalf("viewer read version = %d found %t, want %d true", version, found, appended.Sequence)
	}
	_, found, err = repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, UserID: blocked.UserID, Scope: "workspace-snapshot:full"})
	if err != nil {
		t.Fatalf("CurrentWorkspaceReadVersion blocked: %v", err)
	}
	if found {
		t.Fatalf("blocked user has user-scoped workspace read version")
	}
}

func TestPhase6WorkspaceSourceShape(t *testing.T) {
	for _, path := range []string{
		"workspace_effective_fanout.go",
		"workspace_read_versions.go",
		"workspace_event_fanout.go",
		"postgres_workspace_event_fanout.go",
		"memory_domain_events.go",
		"../http/workspace_fanout.go",
	} {
		source := strings.ToLower(readWorkspacePhase6SourceForTest(t, path))
		for _, forbidden := range []string{
			"listaccessibleentityids",
			"mangorts_user_can_access_resource",
			"usercanaccessentity",
		} {
			if strings.Contains(source, forbidden) {
				t.Fatalf("%s contains forbidden workspace hot path %q", path, forbidden)
			}
		}
	}
}

func mustWorkspaceFanoutUser(t *testing.T, repo *MemoryRepo, companyID, subject string) domain.User {
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

func readWorkspacePhase6SourceForTest(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile %s: %v", path, err)
	}
	return string(content)
}
