package store

import (
	"os"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryRepoGVICMatrixProjectionMaintainedByWrites(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222451"
	repo.EnsureCompany(companyID, "GVICMatrix Projection Co")
	user := mustCreateInboxReadCompanyUser(t, repo, "GVICMatrix-projection-user", companyID, "GVICMatrix-projection@example.com", "GVICMatrix User")

	standaloneNode, err := repo.CreateNode(companyID, "Standalone node")
	if err != nil {
		t.Fatalf("CreateNode standalone: %v", err)
	}
	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   standaloneNode.NodeID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleGenerated,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   user.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments standalone node: %v", err)
	}

	responsibleGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Responsible gate")
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, responsibleGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: user.UserID}})
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
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, aciGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleVerified, UserID: user.UserID}})

	assertMemoryGVICMatrixProjectionCounts(t, repo, companyID, 2, 2)

	query := WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 20}
	myNodes, err := repo.ListMyNodes(query)
	if err != nil {
		t.Fatalf("ListMyNodes: %v", err)
	}
	if len(myNodes) != 1 || myNodes[0].NodeID != standaloneNode.NodeID {
		t.Fatalf("my nodes = %+v, want only standalone assignee node", myNodes)
	}

	responsibleNodes, err := repo.ListGeneratedInboxNodes(query)
	if err != nil {
		t.Fatalf("ListGeneratedInboxNodes: %v", err)
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
	responsibleNodes, err = repo.ListGeneratedInboxNodes(query)
	if err != nil {
		t.Fatalf("ListGeneratedInboxNodes after access change: %v", err)
	}
	assertVisibleQueryNodesDoNotContain(t, responsibleNodes, responsibleNode.NodeID)
	assertMemoryGVICMatrixProjectionCounts(t, repo, companyID, 2, 2)
}

func TestGVICMatrixProjectionSchemaAndPostgresReadsUseTargetedProjection(t *testing.T) {
	migrationRaw, err := os.ReadFile("../../db/migrations/20260618_z_gvic_node_phase2_cleanup.sql")
	if err != nil {
		t.Fatalf("ReadFile migration: %v", err)
	}
	migration := normalizeProjectionSource(string(migrationRaw))
	for _, needle := range []string{
		"create table if not exists gvic_matrix_projection_table",
		"drop column if exists assignee_user_id",
		"drop column if exists status_color",
		"insert into gvic_matrix_projection_table",
		"insert into company_projection_sequences",
		"where projection_name = 'racio_matrix'",
		"'gvic_matrix'",
		"greatest(company_projection_sequences.sequence, excluded.sequence)",
		"delete from company_projection_sequences where projection_name = 'racio_matrix'",
	} {
		if !strings.Contains(migration, needle) {
			t.Fatalf("GVICMatrix migration missing %q", needle)
		}
	}

	schemaRaw, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatalf("ReadFile schema: %v", err)
	}
	schema := normalizeProjectionSource(string(schemaRaw))
	for _, needle := range []string{
		"create table if not exists gvic_matrix_projection_table",
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
		"from gvic_matrix_projection_table entry",
		"mangorts_user_can_access_resource(entry.company_id, 'node', entry.resource_id, $4::uuid, 'edit')",
		"mangorts_user_can_access_resource(entry.company_id, 'logic_gate', entry.resource_id, $4::uuid, 'edit')",
	} {
		if !strings.Contains(postgresReads, needle) {
			t.Fatalf("Postgres GVICMatrix reads missing %q", needle)
		}
	}

	postgresProjectionRaw, err := os.ReadFile("postgres_gvic_matrix_projection.go")
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

func TestPostgresMyWorkMatrixReadsFlatNodeLeafProjectionRows(t *testing.T) {
	postgresProjectionRaw, err := os.ReadFile("postgres_gvic_matrix_projection.go")
	if err != nil {
		t.Fatalf("ReadFile postgres projection writes: %v", err)
	}
	sql := normalizeProjectionSource(string(postgresProjectionRaw))
	for _, needle := range []string{
		"node_leaf_id",
		"is_container_row",
		"'project'::text as resource_type",
		"mangorts_user_can_access_resource(entry.company_id, 'node', entry.node_leaf_id",
	} {
		if !strings.Contains(sql, needle) {
			t.Fatalf("Postgres My Work flat projection path missing %q", needle)
		}
	}
	for _, forbidden := range []string{
		"postgresMyWorkProjectRowsSQL",
		"project_rows",
		"effective.resource_type='project'",
	} {
		if strings.Contains(sql, forbidden) {
			t.Fatalf("Postgres My Work projection still contains project-only query fragment %q", forbidden)
		}
	}
}
func assertMemoryGVICMatrixProjectionCounts(t *testing.T, repo *MemoryRepo, companyID string, wantNodeRows, wantLogicGateRows int) {
	t.Helper()
	repo.mu.RLock()
	defer repo.mu.RUnlock()
	nodeRows := 0
	logicGateRows := 0
	for _, row := range repo.GVICMatrixProjectionRows {
		if row.CompanyID != companyID {
			continue
		}
		switch row.ResourceType {
		case GVICMatrixProjectionResourceNode:
			nodeRows++
		case GVICMatrixProjectionResourceLogicGate:
			logicGateRows++
		}
	}
	if nodeRows != wantNodeRows || logicGateRows != wantLogicGateRows {
		t.Fatalf("GVICMatrix projection counts node=%d logic_gate=%d, want node=%d logic_gate=%d", nodeRows, logicGateRows, wantNodeRows, wantLogicGateRows)
	}
}

func normalizeProjectionSource(raw string) string {
	return strings.ToLower(strings.Join(strings.Fields(raw), " "))
}
