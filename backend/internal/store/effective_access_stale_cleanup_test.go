package store

import (
	"context"
	"miraeopus/backend/internal/domain"
	"os"
	"slices"
	"strings"
	"testing"
)

func TestMemoryDeleteCompanyUserRemovesAllCompanyEffectiveAccessSources(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666601"
	otherCompanyID := "66666666-6666-4666-8666-666666666602"
	repo.EnsureCompany(companyID, "Delete Effective Access Co")
	repo.EnsureCompany(otherCompanyID, "Remaining Membership Co")

	user := mustEffectiveAccessUser(t, repo, companyID, "delete-effective-user")
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, otherCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership other company: %v", err)
	}

	group, err := repo.CreateCompanyUserGroup(companyID, "", "Operations")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{user.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers: %v", err)
	}
	groupNode, err := repo.CreateNode(companyID, "Group visible node")
	if err != nil {
		t.Fatalf("CreateNode group: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   groupNode.NodeID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectGroup,
			SubjectID:   group.GroupID,
			AccessLevel: EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions group grant: %v", err)
	}

	gate, err := repo.CreateLogicGate(companyID, "RACI gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	assignedNode, err := repo.CreateNode(companyID, "Assigned node")
	if err != nil {
		t.Fatalf("CreateNode assigned: %v", err)
	}
	if _, err := repo.SetLogicGateRaciAssignments(LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleResponsible,
			UserID: user.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		NodeID:      assignedNode.NodeID,
		Status:      "pending",
		NodeTitle:   assignedNode.Title,
		Priority:    testPriority(3),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}

	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Shared inbox")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder: %v", err)
	}
	if _, err := repo.SetCommunicationsSharedInboxRaciAssignments(SharedInboxRaciAssignmentUpdateInput{
		CompanyID: companyID,
		FolderID:  folder.FolderID,
		Assignments: []SharedInboxRaciAssignmentInput{{
			Role:        domain.LogicGateRaciRoleConsulted,
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetCommunicationsSharedInboxRaciAssignments: %v", err)
	}

	otherNode, err := repo.CreateNode(otherCompanyID, "Other company node")
	if err != nil {
		t.Fatalf("CreateNode other company: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  otherCompanyID,
		EntityType: EntityTypeNode,
		EntityID:   otherNode.NodeID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions other company: %v", err)
	}

	groupSourceID := effectiveAccessSourceID(EntityTypeNode, groupNode.NodeID, EntityPermissionSubjectGroup, group.GroupID)
	assertEffectiveAccessSource(t, repo, companyID, user.UserID, EntityTypeNode, groupNode.NodeID, effectiveAccessSourceDirectGroupGrant, groupSourceID, EntityPermissionView, true)
	raciSourceID := logicGateRaciEffectiveAccessSourceID(gate.LogicGateID, domain.LogicGateRaciRoleResponsible, user.UserID)
	_ = raciSourceID
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit, true)
	visibilitySourceID := logicGateAssignmentVisibilityEffectiveAccessSourceID(effectiveAccessSourceLogicGateRaci, raciSourceID, gate.LogicGateID, assignedNode.NodeID)
	_ = visibilitySourceID
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeNode, assignedNode.NodeID, EntityPermissionEdit, true)
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeSharedTriageFolder, folder.FolderID, EntityPermissionView, false)
	assertEffectiveAccess(t, repo, otherCompanyID, user.UserID, EntityTypeNode, otherNode.NodeID, EntityPermissionView, true)

	result, err := repo.DeleteCompanyUser(companyID, user.UserID)
	if err != nil {
		t.Fatalf("DeleteCompanyUser: %v", err)
	}
	if result.DeleteExternalIdentity {
		t.Fatal("DeleteCompanyUser deleted external identity despite remaining membership")
	}

	assertNoEffectiveRowsForCompanyUser(t, repo, companyID, user.UserID)
	assertEffectiveAccess(t, repo, otherCompanyID, user.UserID, EntityTypeNode, otherNode.NodeID, EntityPermissionView, true)
}

func TestMemoryDeleteLogicGateRemovesAssignedNodeVisibility(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666603"
	repo.EnsureCompany(companyID, "Delete Gate Visibility Co")

	user := mustEffectiveAccessUser(t, repo, companyID, "delete-gate-visibility-user")
	gate, err := repo.CreateLogicGate(companyID, "Assigned gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Assigned node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: EntityPermissionNoAccess,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions node: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeLogicGate,
		EntityID:   gate.LogicGateID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions gate: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		NodeTitle:   node.Title,
		Priority:    testPriority(3),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	assertEffectiveSourceRows(t, repo, companyID, EntityTypeNode, node.NodeID, effectiveAccessSourceGateVisibility, true)

	if err := repo.DeleteLogicGate(companyID, gate.LogicGateID); err != nil {
		t.Fatalf("DeleteLogicGate: %v", err)
	}

	assertNoEffectiveSourceRows(t, repo, companyID, EntityTypeNode, node.NodeID, effectiveAccessSourceGateVisibility)
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, false)
	users, err := repo.ListEffectiveUsersForResource(companyID, EntityTypeNode, node.NodeID, EntityPermissionView)
	if err != nil {
		t.Fatalf("ListEffectiveUsersForResource: %v", err)
	}
	if slices.Contains(users, user.UserID) {
		t.Fatalf("effective node users after gate delete = %+v, want deleted gate user removed", users)
	}
}

func TestPostgresEffectiveAccessWriterCompanyUserDeletionIsSourceAgnostic(t *testing.T) {
	companyID := "77777777-7777-4777-8777-777777777701"
	userID := "77777777-7777-4777-8777-777777777702"
	execer := &fakeEffectiveAccessExecer{}

	if err := deleteEffectiveFactsForCompanyUserTx(context.Background(), execer, companyID, userID); err != nil {
		t.Fatalf("deleteEffectiveFactsForCompanyUserTx: %v", err)
	}
	if len(execer.calls) != 1 {
		t.Fatalf("Exec call count = %d, want 1", len(execer.calls))
	}
	deleteSQL := normalizeEffectiveAccessSQLForTest(execer.calls[0].query)
	if !strings.Contains(deleteSQL, "where company_id=$1::uuid and user_id=$2::uuid") {
		t.Fatalf("company/user delete SQL = %q, want company and user scoped delete", deleteSQL)
	}
	if strings.Contains(deleteSQL, "source_type") || strings.Contains(deleteSQL, "source_id") {
		t.Fatalf("company/user delete SQL = %q, should not constrain source", deleteSQL)
	}
	if got := execer.calls[0].args; len(got) != 2 || got[0] != companyID || got[1] != userID {
		t.Fatalf("company/user delete args = %#v, want companyID,userID", got)
	}
}

func TestPostgresDeletePathsUseScopedStaleAccessCleanup(t *testing.T) {
	authRaw, err := os.ReadFile("postgres_auth.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_auth.go: %v", err)
	}
	authBody := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, string(authRaw), "func (r *PostgresRepo) DeleteCompanyUser")), " "))
	if !strings.Contains(authBody, "deleteeffectivefactsforcompanyusertx(context.background(), tx, companyid, userid)") {
		t.Fatal("Postgres DeleteCompanyUser must delete all effective rows for the removed company/user")
	}
	if strings.Contains(authBody, "sourcetype=$3") || strings.Contains(authBody, "source_type=$3") {
		t.Fatal("Postgres DeleteCompanyUser still has source-scoped effective access cleanup")
	}

	for _, tc := range []struct {
		path      string
		signature string
	}{
		{path: "postgres_logic_gates.go", signature: "func (r *PostgresRepo) DeleteLogicGate"},
		{path: "postgres_company_explorer.go", signature: "func postgresDeleteLogicGateTx"},
	} {
		raw, err := os.ReadFile(tc.path)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", tc.path, err)
		}
		body := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, string(raw), tc.signature)), " "))
		if !strings.Contains(body, "deletenodelogicgateassignmentsandrecomputevisibilitytx(ctx, tx, companyid, logicgateid)") {
			t.Fatalf("%s must explicitly delete Logic Gate assignments and recompute affected node visibility", tc.signature)
		}
		if strings.Contains(body, "rebuildeffectiveresourceaccessforcompany") {
			t.Fatalf("%s must not use a full-company effective access rebuild", tc.signature)
		}
	}
}

func assertNoEffectiveRowsForCompanyUser(t *testing.T, repo *MemoryRepo, companyID, userID string) {
	t.Helper()
	for _, fact := range repo.effectiveAccess {
		if fact.CompanyID == companyID && fact.UserID == userID {
			t.Fatalf("effective access row survived company user delete: %+v", fact)
		}
	}
}
