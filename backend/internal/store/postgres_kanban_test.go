package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLegacyKanbanTablesAreRemovedFromCanonicalSchema(t *testing.T) {
	schemaPath := filepath.Join("..", "..", "db", "schema.sql")
	raw, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("ReadFile schema: %v", err)
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))

	for _, forbidden := range []string{
		"create table if not exists kanban_boards",
		"create table if not exists kanban_columns",
		"create table if not exists kanban_cards",
		"idx_kanban_boards_company_position",
		"idx_kanban_columns_board_position",
		"idx_kanban_cards_column_position",
		"references kanban_cards",
		"references kanban_columns",
		"sync_node_logic_gate_assignment_from_kanban_card",
		"trg_sync_node_logic_gate_assignment_from_kanban_card",
	} {
		if strings.Contains(normalized, forbidden) {
			t.Fatalf("canonical schema still contains legacy Kanban artifact %q", forbidden)
		}
	}
	for _, required := range []string{
		"create table if not exists node_logic_gate_assignments",
		"column_id text not null",
		"create table if not exists kanban_board_projection",
		"idx_kanban_board_projection_hot_read",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("canonical schema missing %q", required)
		}
	}
}

func TestNodeLogicGateAssignmentMemberReferenceFksNullOnlyUserColumns(t *testing.T) {
	schemaPath := filepath.Join("..", "..", "db", "schema.sql")
	raw, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("ReadFile schema: %v", err)
	}
	assignmentTable := normalizedCreateTableForTest(t, string(raw), "node_logic_gate_assignments")
	for _, required := range []string{
		"foreign key (company_id, requested_by_user_id) references company_memberships (company_id, user_id) on delete set null (requested_by_user_id)",
		"foreign key (company_id, placed_by_user_id) references company_memberships (company_id, user_id) on delete set null (placed_by_user_id)",
	} {
		if !strings.Contains(assignmentTable, required) {
			t.Fatalf("node_logic_gate_assignments missing member FK shape %q", required)
		}
	}

	for _, migrationName := range []string{
		"20260622_logic_gate_requested_by.sql",
		"20260629_logic_gate_kanban_grouping_preferences.sql",
		"20260630_fix_logic_gate_assignment_membership_fks.sql",
	} {
		migrationPath := filepath.Join("..", "..", "db", "migrations", migrationName)
		migrationRaw, err := os.ReadFile(migrationPath)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", migrationName, err)
		}
		normalizedMigration := strings.ToLower(strings.Join(strings.Fields(string(migrationRaw)), " "))
		switch migrationName {
		case "20260622_logic_gate_requested_by.sql":
			if !strings.Contains(normalizedMigration, "on delete set null (requested_by_user_id)") {
				t.Fatalf("%s must null only requested_by_user_id", migrationName)
			}
		case "20260629_logic_gate_kanban_grouping_preferences.sql":
			if !strings.Contains(normalizedMigration, "on delete set null (placed_by_user_id)") {
				t.Fatalf("%s must null only placed_by_user_id", migrationName)
			}
		default:
			for _, required := range []string{
				"drop constraint if exists node_logic_gate_assignments_requested_by_user_id_fkey",
				"drop constraint if exists node_logic_gate_assignments_placed_by_user_id_fkey",
				"on delete set null (requested_by_user_id)",
				"on delete set null (placed_by_user_id)",
			} {
				if !strings.Contains(normalizedMigration, required) {
					t.Fatalf("%s missing repair marker %q", migrationName, required)
				}
			}
		}
	}
}

func TestPostgresDeleteCompanyUserClearsLogicGateMemberReferencesBeforeMembershipDelete(t *testing.T) {
	raw, err := os.ReadFile("postgres_auth.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_auth.go: %v", err)
	}
	body := postgresKanbanFunctionBodyForTest(t, string(raw), "func (r *PostgresRepo) DeleteCompanyUser")
	normalized := strings.ToLower(strings.Join(strings.Fields(body), " "))
	for _, required := range []string{
		"update node_logic_gate_assignments set requested_by_user_id = case when requested_by_user_id = $2::uuid then null else requested_by_user_id end",
		"update kanban_board_projection set requested_by_user_id = case when requested_by_user_id = $2::uuid then null else requested_by_user_id end",
		"update node_logic_gate_assignments set requested_by_user_id = case when requested_by_user_id = $1::uuid then null else requested_by_user_id end",
		"update kanban_board_projection set requested_by_user_id = case when requested_by_user_id = $1::uuid then null else requested_by_user_id end",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("DeleteCompanyUser missing cleanup marker %q", required)
		}
	}

	companyScopedCleanup := strings.Index(normalized, "clearcompanylogicgateassignmentmemberrefs(companyid, userid)")
	companyMembershipDelete := strings.Index(normalized, "delete from company_memberships where company_id = $1::uuid and user_id = $2::uuid")
	if companyScopedCleanup < 0 || companyMembershipDelete < 0 || companyScopedCleanup > companyMembershipDelete {
		t.Fatalf("company-scoped logic gate member cleanup must run before deleting the company membership")
	}

	allScopedCleanup := strings.Index(normalized, "clearalllogicgateassignmentmemberrefs(userid)")
	remainingMembershipDelete := strings.Index(normalized, "delete from company_memberships where user_id = $1::uuid")
	if allScopedCleanup < 0 || remainingMembershipDelete < 0 || allScopedCleanup > remainingMembershipDelete {
		t.Fatalf("all-company logic gate member cleanup must run before deleting remaining memberships")
	}
}

func TestDropLegacyKanbanTablesMigration(t *testing.T) {
	migrationPath := filepath.Join("..", "..", "db", "migrations", "20260602_drop_legacy_kanban_tables.sql")
	raw, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("ReadFile migration: %v", err)
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))

	for _, required := range []string{
		"drop trigger if exists trg_sync_node_logic_gate_assignment_from_kanban_card on kanban_cards",
		"drop function if exists sync_node_logic_gate_assignment_from_kanban_card()",
		"alter table if exists node_logic_gate_assignments alter column column_id type text using column_id::text",
		"alter table if exists kanban_board_projection alter column column_id type text using column_id::text",
		"drop table if exists kanban_cards cascade",
		"drop table if exists kanban_columns cascade",
		"drop table if exists kanban_boards cascade",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("drop migration missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"create table if not exists kanban_boards",
		"create table if not exists kanban_columns",
		"create table if not exists kanban_cards",
	} {
		if strings.Contains(normalized, forbidden) {
			t.Fatalf("drop migration recreates legacy artifact %q", forbidden)
		}
	}
}

func TestKanbanBoardProjectionMigrationAndSchemaAreBounded(t *testing.T) {
	migrationPath := filepath.Join("..", "..", "db", "migrations", "20260601_kanban_board_projection.sql")
	raw, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("ReadFile migration: %v", err)
	}
	normalizedMigration := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	for _, needle := range []string{
		"create table if not exists kanban_board_projection",
		"primary key (company_id, logic_gate_id, node_id)",
		"idx_kanban_board_projection_hot_read",
		"on kanban_board_projection(company_id, logic_gate_id, status, position, node_id)",
		"idx_kanban_board_projection_node",
		"on kanban_board_projection(company_id, node_id)",
		"insert into kanban_board_projection",
		"from node_logic_gate_assignments assignment join nodes node_row",
		"join logic_gates logic_gate",
		"on conflict (company_id, logic_gate_id, node_id)",
	} {
		if !strings.Contains(normalizedMigration, needle) {
			t.Fatalf("projection migration missing %q", needle)
		}
	}
	projectionTable := normalizedCreateTableForTest(t, string(raw), "kanban_board_projection")
	for _, forbidden := range []string{
		" user_id uuid not null",
		"primary key (company_id, user_id",
		"primary key (company_id, logic_gate_id, user_id",
	} {
		if strings.Contains(projectionTable, forbidden) {
			t.Fatalf("projection table contains per-user shape %q", forbidden)
		}
	}

	schemaPath := filepath.Join("..", "..", "db", "schema.sql")
	schemaRaw, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("ReadFile schema: %v", err)
	}
	normalizedSchema := strings.ToLower(strings.Join(strings.Fields(string(schemaRaw)), " "))
	if !strings.Contains(normalizedSchema, "create table if not exists kanban_board_projection") {
		t.Fatal("canonical schema is missing kanban_board_projection")
	}
	if !strings.Contains(normalizedSchema, "idx_kanban_board_projection_hot_read") {
		t.Fatal("canonical schema is missing hot-read projection index")
	}
}

func TestPostgresKanbanRuntimeDoesNotQueryLegacyTables(t *testing.T) {
	files := []string{
		"postgres_kanban.go",
		"postgres_node_logic_gate_assignments.go",
		"postgres_communications_triage.go",
		"postgres_logic_gates.go",
		"postgres_company_explorer.go",
		"postgres_nodes.go",
		"postgres_gvic_matrix_projection.go",
		"postgres_gvic_matrix_commands.go",
		"postgres_workspace_entity_batch.go",
	}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", file, err)
		}
		normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
		for _, forbidden := range []string{
			"from kanban_boards",
			"join kanban_boards",
			"into kanban_boards",
			"update kanban_boards",
			"delete from kanban_boards",
			"from kanban_columns",
			"join kanban_columns",
			"into kanban_columns",
			"update kanban_columns",
			"delete from kanban_columns",
			"from kanban_cards",
			"join kanban_cards",
			"into kanban_cards",
			"update kanban_cards",
			"delete from kanban_cards",
			"ensurelogicgatekanbanboardsql",
		} {
			if strings.Contains(normalized, forbidden) {
				t.Fatalf("%s still contains legacy Kanban table/process pattern %q", file, forbidden)
			}
		}
	}
}

func TestPostgresKanbanProjectionHelpersAreBoundedDeltas(t *testing.T) {
	raw, err := os.ReadFile("postgres_kanban_projection.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_kanban_projection.go: %v", err)
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	for _, needle := range []string{
		"func synckanbanboardprojectionfornodetx",
		"where assignment.company_id = $1::uuid and assignment.node_id = $2::uuid",
		"delete from kanban_board_projection projection where projection.company_id = $1::uuid and projection.node_id = $2::uuid",
		"on conflict (company_id, logic_gate_id, node_id)",
		"func rebuildkanbanboardprojectionforlogicgate",
		"delete from kanban_board_projection where company_id=$1::uuid and logic_gate_id=$2::uuid",
		"rebuildkanbanboardprojectionforcompany",
	} {
		if !strings.Contains(normalized, needle) {
			t.Fatalf("projection helper source missing %q", needle)
		}
	}
	for _, forbidden := range []string{
		" offset ",
		" company_id=$1::uuid or ",
		" from kanban_cards ",
	} {
		if strings.Contains(normalized, forbidden) {
			t.Fatalf("projection helper source contains forbidden pattern %q", forbidden)
		}
	}

	kanbanRaw, err := os.ReadFile("postgres_kanban.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_kanban.go: %v", err)
	}
	assignBody := postgresKanbanFunctionBodyForTest(t, strings.ReplaceAll(string(kanbanRaw), "\r\n", "\n"), "func (r *PostgresRepo) assignNodeToLogicGateStatusTx")
	moveBody := postgresKanbanFunctionBodyForTest(t, strings.ReplaceAll(string(kanbanRaw), "\r\n", "\n"), "func (r *PostgresRepo) MoveLogicGateNodeAssignment")
	removeBody := postgresKanbanFunctionBodyForTest(t, strings.ReplaceAll(string(kanbanRaw), "\r\n", "\n"), "func (r *PostgresRepo) RemoveLogicGateNodeAssignment")
	if !strings.Contains(assignBody, "upsertNodeLogicGateAssignmentSQL") || !strings.Contains(assignBody, "applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx") || !strings.Contains(assignBody, "kanbanBoardProjectionCardByNodeTx") {
		t.Fatal("assignNodeToLogicGateStatusTx does not write source assignment, apply dependency deltas, and reread the Kanban projection")
	}
	if !strings.Contains(moveBody, "upsertNodeLogicGateAssignmentSQL") || !strings.Contains(moveBody, "applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx") || !strings.Contains(moveBody, "kanbanBoardProjectionCardByNodeTx") {
		t.Fatal("MoveLogicGateNodeAssignment does not write source assignment, apply dependency deltas, and reread the Kanban projection")
	}
	if !strings.Contains(removeBody, "applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx") || strings.Contains(removeBody, "delete from kanban_cards") {
		t.Fatal("RemoveLogicGateNodeAssignment should apply dependency deltas without deleting legacy Kanban cards")
	}
}

func TestPostgresCommunicationsTriageConversionAppliesProjectionDependencyDeltas(t *testing.T) {
	raw, err := os.ReadFile("postgres_communications_triage.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_communications_triage.go: %v", err)
	}
	source := strings.ReplaceAll(string(raw), "\r\n", "\n")
	convertBody := postgresKanbanFunctionBodyForTest(t, source, "func (r *PostgresRepo) ConvertCommunicationsTriageItems")
	attachBody := postgresKanbanFunctionBodyForTest(t, source, "func (r *PostgresRepo) attachCommunicationsTriageItemsToExistingNodeTx")

	for _, needle := range []string{
		"applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx",
		"result.ProjectionDeltas = append(result.ProjectionDeltas, projectionDeltas...)",
		"kanbanBoardProjectionCardByNodeTx",
	} {
		if !strings.Contains(convertBody, needle) {
			t.Fatalf("ConvertCommunicationsTriageItems missing new-node projection dependency step %q", needle)
		}
		if !strings.Contains(attachBody, needle) {
			t.Fatalf("attachCommunicationsTriageItemsToExistingNodeTx missing existing-node projection dependency step %q", needle)
		}
	}
	if count := strings.Count(convertBody, "ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, result.ProjectionDeltas)"); count < 2 {
		t.Fatalf("ConvertCommunicationsTriageItems should emit projection delta event rows for both conversion exits, found %d", count)
	}
}

func TestPostgresMoveLogicGateAssignmentPreservesEmailReferencesWithoutLegacyCards(t *testing.T) {
	raw, err := os.ReadFile("postgres_kanban.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_kanban.go: %v", err)
	}
	body := postgresKanbanFunctionBodyForTest(t, strings.ReplaceAll(string(raw), "\r\n", "\n"), "func (r *PostgresRepo) MoveLogicGateNodeAssignment")
	for _, required := range []string{
		"updatePostgresCommunicationsEmailNodeReferenceForNodeTx",
		"updatePostgresCommunicationsEmailAttachmentReferencesForNodeTx",
		"applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx",
	} {
		if !strings.Contains(body, required) {
			t.Fatalf("MoveLogicGateNodeAssignment missing %s", required)
		}
	}
	for _, forbidden := range []string{
		"takePostgresCommunicationsEmailNodeReferenceForCardTx",
		"restorePostgresCommunicationsEmailNodeReferenceTx",
		"delete from kanban_cards",
		"update kanban_cards",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("MoveLogicGateNodeAssignment still contains legacy-card step %q", forbidden)
		}
	}
}

func normalizedCreateTableForTest(t *testing.T, source, tableName string) string {
	t.Helper()
	normalizedSource := strings.ToLower(strings.ReplaceAll(source, "\r\n", "\n"))
	startNeedle := "create table if not exists " + strings.ToLower(tableName)
	start := strings.Index(normalizedSource, startNeedle)
	if start < 0 {
		t.Fatalf("missing table %s", tableName)
	}
	remaining := normalizedSource[start:]
	end := strings.Index(remaining, ");")
	if end < 0 {
		t.Fatalf("table %s has no closing );", tableName)
	}
	return strings.Join(strings.Fields(remaining[:end+2]), " ")
}

func postgresKanbanFunctionBodyForTest(t *testing.T, source, signature string) string {
	t.Helper()
	start := strings.Index(source, signature)
	if start < 0 {
		t.Fatalf("missing function %q", signature)
	}
	remaining := source[start+len(signature):]
	end := strings.Index(remaining, "\nfunc ")
	if end < 0 {
		return remaining
	}
	return remaining[:end]
}
