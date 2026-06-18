package store

import (
	"os"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryRepoRacioProjectionMaintainedByWrites(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222451"
	repo.EnsureCompany(companyID, "RACIO Projection Co")
	user := mustCreateInboxReadCompanyUser(t, repo, "racio-projection-user", companyID, "racio-projection@example.com", "RACIO User")

	standaloneNode, err := repo.CreateNodeWithAssignee(companyID, "Standalone node", user.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee standalone: %v", err)
	}

	responsibleGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Responsible gate")
	mustSetInboxReadLogicGateRaci(t, repo, companyID, responsibleGate.LogicGateID, []LogicGateRaciAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: user.UserID}})
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

	aciGate := mustCreateInboxReadLogicGate(t, repo, companyID, "ACI gate")
	mustSetInboxReadLogicGateRaci(t, repo, companyID, aciGate.LogicGateID, []LogicGateRaciAssignmentInput{{Role: domain.GVICRoleVerified, UserID: user.UserID}})

	assertMemoryRacioProjectionCounts(t, repo, companyID, 2, 2)

	query := WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 20}
	myNodes, err := repo.ListMyNodes(query)
	if err != nil {
		t.Fatalf("ListMyNodes: %v", err)
	}
	if len(myNodes) != 1 || myNodes[0].NodeID != standaloneNode.NodeID {
		t.Fatalf("my nodes = %+v, want only standalone assignee node", myNodes)
	}

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
	if aciRead == nil || !inboxReadRolesContain(aciRead.Roles, domain.GVICRoleVerified) {
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
	assertMemoryRacioProjectionCounts(t, repo, companyID, 2, 2)
}

func TestRacioProjectionSchemaAndPostgresReadsUseTargetedProjection(t *testing.T) {
	migrationRaw, err := os.ReadFile("../../db/migrations/20260530_racio_projection_resource_permissions.sql")
	if err != nil {
		t.Fatalf("ReadFile migration: %v", err)
	}
	migration := normalizeProjectionSource(string(migrationRaw))
	for _, needle := range []string{
		"create table if not exists racio_matrix_projection_table",
		"create table if not exists resource_permissions",
		"create or replace function mangorts_user_can_access_resource",
		"insert into racio_matrix_projection_table",
	} {
		if !strings.Contains(migration, needle) {
			t.Fatalf("RACIO migration missing %q", needle)
		}
	}

	schemaRaw, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatalf("ReadFile schema: %v", err)
	}
	schema := normalizeProjectionSource(string(schemaRaw))
	for _, needle := range []string{
		"create table if not exists racio_matrix_projection_table",
		"create table if not exists resource_permissions",
		"from resource_permissions access",
	} {
		if !strings.Contains(schema, needle) {
			t.Fatalf("canonical schema missing %q", needle)
		}
	}

	postgresReadRaw, err := os.ReadFile("postgres_work_item_reads.go")
	if err != nil {
		t.Fatalf("ReadFile postgres reads: %v", err)
	}
	postgresReads := normalizeProjectionSource(string(postgresReadRaw))
	for _, needle := range []string{
		"from racio_matrix_projection_table entry",
		"mangorts_user_can_access_resource(entry.company_id, 'node', entry.resource_id, $4::uuid, 'edit')",
		"mangorts_user_can_access_resource(entry.company_id, 'logic_gate', entry.resource_id, $4::uuid, 'edit')",
	} {
		if !strings.Contains(postgresReads, needle) {
			t.Fatalf("Postgres RACIO reads missing %q", needle)
		}
	}

	postgresProjectionRaw, err := os.ReadFile("postgres_racio_projection.go")
	if err != nil {
		t.Fatalf("ReadFile postgres projection writes: %v", err)
	}
	postgresProjection := normalizeProjectionSource(string(postgresProjectionRaw))
	for _, forbidden := range []string{
		"rebuild_" + "work_item_" + "inbox",
		"work_item_" + "inbox_entries",
		"effective_" + "resource_" + "access",
		"resource_" + "access ",
	} {
		if strings.Contains(postgresReads, forbidden) || strings.Contains(postgresProjection, forbidden) || strings.Contains(schema, forbidden) {
			t.Fatalf("new projection/runtime source should not contain legacy reference %q", forbidden)
		}
	}
}

func assertMemoryRacioProjectionCounts(t *testing.T, repo *MemoryRepo, companyID string, wantNodeRows, wantLogicGateRows int) {
	t.Helper()
	repo.mu.RLock()
	defer repo.mu.RUnlock()
	nodeRows := 0
	logicGateRows := 0
	for _, row := range repo.racioProjectionRows {
		if row.CompanyID != companyID {
			continue
		}
		switch row.ResourceType {
		case racioProjectionResourceNode:
			nodeRows++
		case racioProjectionResourceLogicGate:
			logicGateRows++
		}
	}
	if nodeRows != wantNodeRows || logicGateRows != wantLogicGateRows {
		t.Fatalf("RACIO projection counts node=%d logic_gate=%d, want node=%d logic_gate=%d", nodeRows, logicGateRows, wantNodeRows, wantLogicGateRows)
	}
}

func normalizeProjectionSource(raw string) string {
	return strings.ToLower(strings.Join(strings.Fields(raw), " "))
}
