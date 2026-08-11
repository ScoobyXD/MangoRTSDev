package store

import (
	"os"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryRepoRACIMatrixRowsAreDerivedFromV2PolicyAtReadTime(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222451"
	repo.EnsureCompany(companyID, "RACIMatrix Projection Co")
	user := mustCreateInboxReadCompanyUser(t, repo, "RACIMatrix-projection-user", companyID, "RACIMatrix-projection@example.com", "RACIMatrix User")

	standaloneNode, err := repo.CreateNode(companyID, "Standalone node")
	if err != nil {
		t.Fatalf("CreateNode standalone: %v", err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   standaloneNode.NodeID,
		Assignments: []ResourceRACIAssignmentInput{{
			Role:          domain.RACIRoleResponsible,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   user.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments standalone node: %v", err)
	}

	responsibleGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Responsible gate")
	mustSetInboxReadLogicGateRACI(t, repo, companyID, responsibleGate.LogicGateID, []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleResponsible, UserID: user.UserID}})
	responsibleNode, err := repo.CreateNode(companyID, "Responsible node")
	if err != nil {
		t.Fatalf("CreateNode responsible: %v", err)
	}
	priority := 4
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: responsibleGate.LogicGateID,
		NodeID:      responsibleNode.NodeID,
		Status:      "in progress",
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus responsible: %v", err)
	}
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: responsibleNode.NodeID,
		AssignmentMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatalf("PutResourceRACIPolicy responsible node inherited: %v", err)
	}

	aciGate := mustCreateInboxReadLogicGate(t, repo, companyID, "ACI gate")
	mustSetInboxReadLogicGateRACI(t, repo, companyID, aciGate.LogicGateID, []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleAccountable, UserID: user.UserID}})

	assertMemoryRACIMatrixProjectionCounts(t, repo, companyID, 0, 0)

	query := WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 20}
	myNodes, err := repo.ListMyNodes(query)
	if err != nil {
		t.Fatalf("ListMyNodes: %v", err)
	}
	if len(myNodes) != 1 || myNodes[0].NodeID != standaloneNode.NodeID {
		t.Fatalf("my nodes = %+v, want only standalone assignee node", myNodes)
	}
	assertMemoryRACIMatrixProjectionCounts(t, repo, companyID, 2, 2)

	responsibleNodes, err := repo.ListResponsibleInboxNodes(query)
	if err != nil {
		t.Fatalf("ListResponsibleInboxNodes: %v", err)
	}
	responsibleRead := mustFindInboxReadNode(t, responsibleNodes, responsibleNode.NodeID)
	if responsibleRead.Priority == nil || *responsibleRead.Priority != priority {
		t.Fatalf("responsible node priority = %+v, want %d", responsibleRead.Priority, priority)
	}
	if len(responsibleRead.LogicGateIDs) != 1 || responsibleRead.LogicGateIDs[0] != responsibleGate.LogicGateID {
		t.Fatalf("responsible node logic_gate_ids = %+v, want %q", responsibleRead.LogicGateIDs, responsibleGate.LogicGateID)
	}

	aciGates, err := repo.ListACIInboxLogicGates(query)
	if err != nil {
		t.Fatalf("ListACIInboxLogicGates: %v", err)
	}
	aciRead := findInboxReadGate(aciGates, aciGate.LogicGateID)
	if aciRead == nil || !inboxReadRolesContain(aciRead.Roles, domain.RACIRoleAccountable) {
		t.Fatalf("ACI gates = %+v, want accountable gate", aciGates)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeNode,
		EntityID:         responsibleNode.NodeID,
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions responsible node no access: %v", err)
	}
	responsibleNodes, err = repo.ListResponsibleInboxNodes(query)
	if err != nil {
		t.Fatalf("ListResponsibleInboxNodes after access change: %v", err)
	}
	assertVisibleQueryNodesDoNotContain(t, responsibleNodes, responsibleNode.NodeID)
	assertMemoryRACIMatrixProjectionCounts(t, repo, companyID, 2, 2)
}

func TestRACIMatrixReadsUseV2PolicySourcesWithoutRetiredTable(t *testing.T) {
	cleanupRaw, err := os.ReadFile("../../db/migrations/20260810_zz_remove_retired_personal_work_surface.sql")
	if err != nil {
		t.Fatalf("ReadFile cleanup migration: %v", err)
	}
	cleanup := normalizeProjectionSource(string(cleanupRaw))
	for _, needle := range []string{
		"drop table if exists gvic_matrix_projection_table",
		"drop table if exists racio_matrix_projection_table",
		"gvic_matrix_projection_table_legacy_20260621%",
		"delete from saved_views",
		"add constraint saved_views_surface_chk",
	} {
		if !strings.Contains(cleanup, needle) {
			t.Fatalf("retired surface cleanup migration missing %q", needle)
		}
	}

	schemaRaw, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatalf("ReadFile schema: %v", err)
	}
	schema := normalizeProjectionSource(string(schemaRaw))
	if strings.Contains(schema, "create table if not exists gvic_matrix_projection_table") {
		t.Fatal("canonical schema still creates the retired RACI matrix projection table")
	}

	postgresReadRaw, err := os.ReadFile("postgres_raci_matrix_v2.go")
	if err != nil {
		t.Fatalf("ReadFile Postgres RACI matrix reads: %v", err)
	}
	postgresReads := normalizeProjectionSource(string(postgresReadRaw))
	for _, needle := range []string{
		"mangorts_v2_effective_gvic_assignments(node.company_id,'node',node.node_id)",
		"mangorts_v2_effective_gvic_assignments(gate.company_id,'logic_gate',gate.logic_gate_id)",
		"mangorts_user_can_access_resource(candidate.company_id,candidate.resource_type,candidate.resource_id,$3::uuid,'edit')",
	} {
		if !strings.Contains(postgresReads, needle) {
			t.Fatalf("Postgres RACI matrix reads missing %q", needle)
		}
	}
	if strings.Contains(postgresReads, "gvic_matrix_projection_table") {
		t.Fatal("Postgres RACI matrix reads still depend on the retired projection table")
	}
}

func assertMemoryRACIMatrixProjectionCounts(t *testing.T, repo *MemoryRepo, companyID string, wantNodeRows, wantLogicGateRows int) {
	t.Helper()
	repo.mu.RLock()
	defer repo.mu.RUnlock()
	nodeRows := 0
	logicGateRows := 0
	for _, row := range repo.RACIMatrixProjectionRows {
		if row.CompanyID != companyID {
			continue
		}
		switch row.ResourceType {
		case RACIMatrixProjectionResourceNode:
			nodeRows++
		case RACIMatrixProjectionResourceLogicGate:
			logicGateRows++
		}
	}
	if nodeRows != wantNodeRows || logicGateRows != wantLogicGateRows {
		t.Fatalf("RACIMatrix projection counts node=%d logic_gate=%d, want node=%d logic_gate=%d", nodeRows, logicGateRows, wantNodeRows, wantLogicGateRows)
	}
}

func normalizeProjectionSource(raw string) string {
	return strings.ToLower(strings.Join(strings.Fields(raw), " "))
}
