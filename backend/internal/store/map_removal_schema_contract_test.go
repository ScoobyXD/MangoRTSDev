package store

import (
	"miraeopus/backend/internal/domain"
	"os"
	"regexp"
	"strings"
	"testing"
)

func readMapRemovalContractFile(t *testing.T, parts ...string) string {
	t.Helper()
	path := strings.Join(parts, string(os.PathSeparator))
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return strings.ToLower(string(data))
}

var sqlEventArrayPattern = regexp.MustCompile(`(?s)p_event_type\s*=\s*any\(array\[(.*?)\]::text\[\]\)`)
var sqlSingleEventPattern = regexp.MustCompile(`p_event_type\s*=\s*'([^']+)'`)
var sqlLiteralPattern = regexp.MustCompile(`'([^']*)'`)
var sqlLiteralPairPattern = regexp.MustCompile(`\('([^']*)',\s*'([^']*)'\)`)

func extractWorkspaceReadVersionFunctionForTest(t *testing.T, source string) string {
	t.Helper()
	const signature = "create or replace function workspace_read_version_keys_for_domain_event"
	start := strings.Index(source, signature)
	if start < 0 {
		t.Fatalf("workspace read-version function not found")
	}
	const terminator = "$$ language plpgsql immutable;"
	end := strings.Index(source[start:], terminator)
	if end < 0 {
		t.Fatalf("workspace read-version function terminator not found")
	}
	return source[start : start+end+len(terminator)]
}

func workspaceReadVersionEventNamesForTest(source string) map[string]struct{} {
	events := map[string]struct{}{}
	for _, arrayMatch := range sqlEventArrayPattern.FindAllStringSubmatch(source, -1) {
		for _, literalMatch := range sqlLiteralPattern.FindAllStringSubmatch(arrayMatch[1], -1) {
			events[literalMatch[1]] = struct{}{}
		}
	}
	for _, match := range sqlSingleEventPattern.FindAllStringSubmatch(source, -1) {
		events[match[1]] = struct{}{}
	}
	return events
}

func workspaceReadVersionLiteralPairsForTest(source string) map[string]struct{} {
	pairs := map[string]struct{}{}
	for _, match := range sqlLiteralPairPattern.FindAllStringSubmatch(source, -1) {
		pair := match[1] + "\x00" + match[2]
		if strings.Contains(pair, "map") {
			continue
		}
		pairs[pair] = struct{}{}
	}
	return pairs
}

func sqlIfBlockContainingForTest(t *testing.T, source, anchor string) string {
	t.Helper()
	anchorIndex := strings.Index(source, anchor)
	if anchorIndex < 0 {
		t.Fatalf("SQL anchor %q not found", anchor)
	}
	start := strings.LastIndex(source[:anchorIndex], "if p_event_type")
	if start < 0 {
		t.Fatalf("SQL IF block for %q not found", anchor)
	}
	endOffset := strings.Index(source[anchorIndex:], "end if;")
	if endOffset < 0 {
		t.Fatalf("SQL IF terminator for %q not found", anchor)
	}
	return source[start : anchorIndex+endOffset+len("end if;")]
}

func TestMapRemovalReadVersionFunctionPreservesEveryShippedNonMapMapping(t *testing.T) {
	shipped := extractWorkspaceReadVersionFunctionForTest(t, readMapRemovalContractFile(t, "..", "..", "db", "migrations", "20260707_zz_align_prod_to_dev_schema.sql"))
	candidates := map[string]string{
		"map removal migration": extractWorkspaceReadVersionFunctionForTest(t, readMapRemovalContractFile(t, "..", "..", "db", "migrations", "20260805_zz_remove_map_runtime_contracts.sql")),
		"process map migration": extractWorkspaceReadVersionFunctionForTest(t, readMapRemovalContractFile(t, "..", "..", "db", "migrations", "20260824_process_map.sql")),
		"canonical schema":      extractWorkspaceReadVersionFunctionForTest(t, readMapRemovalContractFile(t, "..", "..", "db", "schema.sql")),
	}
	mapOnlyEvents := map[string]struct{}{
		"node_map_positions_updated":       {},
		"logic_gate_map_positions_updated": {},
		"logic_gate_relationship_created":  {},
		"logic_gate_relationship_deleted":  {},
	}
	shippedEvents := workspaceReadVersionEventNamesForTest(shipped)
	shippedPairs := workspaceReadVersionLiteralPairsForTest(shipped)
	for label, candidate := range candidates {
		candidateEvents := workspaceReadVersionEventNamesForTest(candidate)
		for event := range shippedEvents {
			if _, mapOnly := mapOnlyEvents[event]; mapOnly {
				continue
			}
			if _, preserved := candidateEvents[event]; !preserved {
				t.Errorf("%s lost shipped non-map event mapping %q", label, event)
			}
		}
		candidatePairs := workspaceReadVersionLiteralPairsForTest(candidate)
		for pair := range shippedPairs {
			if strings.HasPrefix(pair, "logic-gate-relationships\x00") {
				continue
			}
			if _, preserved := candidatePairs[pair]; !preserved {
				t.Errorf("%s lost shipped non-map scope mapping %q", label, strings.ReplaceAll(pair, "\x00", " / "))
			}
		}
		projectBlock := sqlIfBlockContainingForTest(t, candidate, "'project_information_created'")
		for _, required := range []string{
			"'project_information_created'",
			"'project_information_deleted'",
			"('projects', '')",
			"('workspace-snapshot:company_explorer', '')",
			"('workspace-snapshot:company_explorer', 'folder_kind:project')",
		} {
			if !strings.Contains(projectBlock, required) {
				t.Errorf("%s project information block missing %q", label, required)
			}
		}
	}
}

func TestCanonicalSchemaOmitsRetiredPositionStorageAndKeepsProtectedNodeContracts(t *testing.T) {
	schema := readMapRemovalContractFile(t, "..", "..", "db", "schema.sql")
	for _, retired := range []string{"create table if not exists node_map_positions", "create table if not exists logic_gate_map_positions", "idx_node_map_positions_company_updated", "idx_logic_gate_map_positions_company_updated"} {
		if strings.Contains(schema, retired) {
			t.Errorf("canonical schema still contains retired contract %q", retired)
		}
	}
	for _, protected := range []string{"node_relationships", "node_textboxes_history", "logic_gate_textboxes_history", "node_view_user_versions"} {
		if !strings.Contains(schema, "create table if not exists "+protected) {
			t.Errorf("canonical schema lost protected table %q", protected)
		}
	}
}

func TestProcessMapCanonicalSchemaDefinesTheThreeAuthoritiesAndLifecycleGuards(t *testing.T) {
	schema := readMapRemovalContractFile(t, "..", "..", "db", "schema.sql")
	for _, retired := range []string{
		"create table if not exists logic_gate_relationships (",
		"create type logic_gate_relationship_position",
		"'logic-gate-relationships'",
	} {
		if strings.Contains(schema, retired) {
			t.Errorf("canonical schema still contains retired relationship authority %q", retired)
		}
	}
	for _, required := range []string{
		"create table if not exists process_map_placements (",
		"primary key (company_id, resource_type, resource_id)",
		"create table if not exists resource_operational_relationships (",
		"unique (company_id, source_resource_type, source_resource_id, target_resource_type, target_resource_id)",
		"create table if not exists process_map_traces (",
		"constraint process_map_traces_route_points_chk check (mangorts_process_map_route_points_valid(route_points))",
		"jsonb_array_length(p_route_points) > 256",
		"p_route_points is null",
		"x_text::numeric not between -2147483648 and 2147483647",
		"y_text::numeric not between -2147483648 and 2147483647",
		"create trigger trg_validate_process_map_placement",
		"raise exception 'process_map_parent_cycle'",
		"create trigger trg_validate_resource_operational_relationship",
		"create trigger trg_cleanup_process_map_folder_delete",
		"create trigger trg_cleanup_process_map_logic_gate_delete",
		"delete from process_map_traces trace",
		"delete from resource_operational_relationships relationship",
	} {
		if !strings.Contains(schema, required) {
			t.Errorf("canonical Process Map schema missing %q", required)
		}
	}
}

func TestProcessMapForwardMigrationPreflightsAndPreservesValidLegacyRows(t *testing.T) {
	migration := readMapRemovalContractFile(t, "..", "..", "db", "migrations", "20260824_process_map.sql")
	for _, required := range []string{
		"current_setting('server_version_num')::integer < 170000",
		"exact unordered column set drifted",
		"contains an invalid or cross-company row",
		"contains duplicate directed semantic pairs",
		"relationship.logic_gate_relationship_id",
		"case when relationship.a_position::text = 'output' then relationship.logic_gate_id_a else relationship.logic_gate_id_b end",
		"case when relationship.a_position::text = 'input' then relationship.logic_gate_id_a else relationship.logic_gate_id_b end",
		"relationship.created_timestamp",
		"drop table logic_gate_relationships;",
		"drop type logic_gate_relationship_position;",
		"create trigger trg_cleanup_process_map_folder_delete",
		"create trigger trg_cleanup_process_map_logic_gate_delete",
	} {
		if !strings.Contains(migration, required) {
			t.Errorf("Process Map migration missing %q", required)
		}
	}
	if strings.Contains(migration, "drop table logic_gate_relationships cascade") || strings.Contains(migration, "drop type logic_gate_relationship_position cascade") {
		t.Error("Process Map migration must not use CASCADE for retired authority removal")
	}
}

func TestProcessMapRecycleSnapshotIncludesAllAuthoritiesInDependencyOrder(t *testing.T) {
	source := readMapRemovalContractFile(t, "postgres_recycle_bin.go")
	for _, tableName := range []string{"process_map_placements", "resource_operational_relationships", "process_map_traces"} {
		if !strings.Contains(source, `"`+tableName+`"`) {
			t.Errorf("recycle snapshot contract missing %s", tableName)
		}
	}
	if strings.Contains(source, `"logic_gate_relationships"`) {
		t.Error("recycle snapshot contract still includes retired logic_gate_relationships authority")
	}
	restoreStart := strings.Index(source, "var recyclerestoretableorder")
	if restoreStart < 0 {
		t.Fatal("recycle restore order declaration missing")
	}
	restoreOrder := source[restoreStart:]
	relationshipIndex := strings.Index(restoreOrder, `"resource_operational_relationships",`)
	placementIndex := strings.Index(restoreOrder, `"process_map_placements",`)
	traceIndex := strings.Index(restoreOrder, `"process_map_traces",`)
	if relationshipIndex < 0 || placementIndex < 0 || traceIndex < 0 || relationshipIndex >= placementIndex || placementIndex >= traceIndex {
		t.Fatal("Process Map recycle restore order must be relationships, placements, then traces")
	}
}

func TestPostgresProcessMapPartialRecycleRestoreRequiresLiveDependencies(t *testing.T) {
	source := readMapRemovalContractFile(t, "postgres_recycle_bin.go")
	for _, required := range []string{
		`if tablename == "resource_operational_relationships"`,
		"folder.company_id=restored_row.company_id and folder.folder_id=restored_row.source_resource_id",
		"process.company_id=restored_row.company_id and process.logic_gate_id=restored_row.source_resource_id",
		"folder.company_id=restored_row.company_id and folder.folder_id=restored_row.target_resource_id",
		"process.company_id=restored_row.company_id and process.logic_gate_id=restored_row.target_resource_id",
		`if tablename == "process_map_placements"`,
		"folder.company_id=restored_row.company_id and folder.folder_id=restored_row.resource_id",
		"process.company_id=restored_row.company_id and process.logic_gate_id=restored_row.resource_id",
		"restored_row.map_parent_folder_id is null",
		"parent_folder.folder_id=restored_row.map_parent_folder_id",
		`if tablename == "process_map_traces"`,
		"relationship.company_id=restored_row.company_id",
		"relationship.resource_operational_relationship_id=restored_row.resource_operational_relationship_id",
	} {
		if !strings.Contains(source, required) {
			t.Errorf("PostgreSQL partial Process Map restore missing %q", required)
		}
	}
}

func TestMemoryRecycleSnapshotRestoresAllProcessMapAuthorities(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "97979797-9797-4979-8979-979797979791"
	resourceID := "97979797-9797-4979-8979-979797979792"
	relationshipID := "97979797-9797-4979-8979-979797979793"
	targetResourceID := "97979797-9797-4979-8979-979797979794"
	repo.logicGates[key(companyID, resourceID)] = domain.LogicGate{CompanyID: companyID, LogicGateID: resourceID}
	repo.logicGates[key(companyID, targetResourceID)] = domain.LogicGate{CompanyID: companyID, LogicGateID: targetResourceID}
	repo.processMapPlacements[resourceID] = domain.ProcessMapPlacement{CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: resourceID}
	repo.resourceOperationalRelationships[key(companyID, relationshipID)] = domain.ResourceOperationalRelationship{
		CompanyID:                         companyID,
		ResourceOperationalRelationshipID: relationshipID,
		Source:                            domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: resourceID},
		Target:                            domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: targetResourceID},
	}
	repo.processMapTraces[key(companyID, relationshipID)] = domain.ProcessMapTrace{CompanyID: companyID, ResourceOperationalRelationshipID: relationshipID}

	before := repo.snapshotRecycleStateLocked()
	repo.processMapPlacements = map[string]domain.ProcessMapPlacement{}
	repo.resourceOperationalRelationships = map[string]domain.ResourceOperationalRelationship{}
	repo.processMapTraces = map[string]domain.ProcessMapTrace{}
	after := repo.snapshotRecycleStateLocked()
	delta := memoryRecycleSnapshotDelta(before, after)
	if len(delta.processMapPlacements) != 1 || len(delta.resourceOperationalRelationships) != 1 || len(delta.processMapTraces) != 1 {
		t.Fatalf("Process Map recycle delta lost authority rows: placements=%d relationships=%d traces=%d", len(delta.processMapPlacements), len(delta.resourceOperationalRelationships), len(delta.processMapTraces))
	}
	mergeMemoryRecycleSnapshot(&after, delta)
	if len(after.processMapPlacements) != 1 || len(after.resourceOperationalRelationships) != 1 || len(after.processMapTraces) != 1 {
		t.Fatalf("Process Map recycle merge did not restore authority rows: placements=%d relationships=%d traces=%d", len(after.processMapPlacements), len(after.resourceOperationalRelationships), len(after.processMapTraces))
	}
}

func TestMapRemovalForwardMigrationIsNonDestructive(t *testing.T) {
	migration := readMapRemovalContractFile(t, "..", "..", "db", "migrations", "20260805_zz_remove_map_runtime_contracts.sql")
	for _, required := range []string{"workspace_static_read_version_keys", "workspace_read_version_keys_for_domain_event", "workspace-snapshot:node_map", "workspace-snapshot:logic_gate_map", "map-layout:node", "map-layout:logic_gate"} {
		if !strings.Contains(migration, required) {
			t.Errorf("forward migration missing retired read-version contract %q", required)
		}
	}
	if strings.Contains(migration, "drop table") {
		t.Error("normal forward migration must not drop position tables")
	}
}

func TestMapPositionOperatorSQLIsDefaultDenyAndExact(t *testing.T) {
	preflight := readMapRemovalContractFile(t, "..", "..", "..", "scripts", "map_position_storage_retirement_preflight.sql")
	operator := readMapRemovalContractFile(t, "..", "..", "..", "scripts", "retire_map_position_storage.sql")
	for _, required := range []string{"begin transaction isolation level repeatable read read only", "server_version_num", "170000", "180000", "workspace_derived_domain_event_projection_checkpoints", "node_map_position_upsert", "logic_gate_map_position_upsert", "exact unordered column set drifted", "ready_for_separately_approved_map_position_retirement", "process_map_placements", "resource_operational_relationships", "process_map_traces", "retired logic_gate_relationships authority is still present", "rollback;"} {
		if !strings.Contains(preflight, required) {
			t.Errorf("preflight missing %q", required)
		}
	}
	for _, required := range []string{"values (false,false,false,false,false,false)", "map_free_application_deployed", "old_writers_stopped", "operator_approved", "drop table public.node_map_positions;", "drop table public.logic_gate_map_positions;", "workspace_derived_domain_event_projection_checkpoints", "exact unordered column set drifted", "process_map_placements", "resource_operational_relationships", "process_map_traces", "logic_gate_relationships_retired", "commit;"} {
		if !strings.Contains(operator, required) {
			t.Errorf("operator SQL missing %q", required)
		}
	}
	if strings.Contains(operator, "logic_gate_relationships_preserved") {
		t.Error("operator SQL still treats retired logic_gate_relationships as protected")
	}
	if strings.Contains(operator, "drop table public.node_map_positions cascade") || strings.Contains(operator, "drop table public.logic_gate_map_positions cascade") {
		t.Error("operator SQL must never use CASCADE")
	}
	if strings.Count(operator, "drop table public.") != 2 {
		t.Errorf("operator SQL must drop exactly two public tables, got %d", strings.Count(operator, "drop table public."))
	}
}

func TestActiveBackendAndMigrationDocsUseOnlyProcessMapAuthorities(t *testing.T) {
	documents := map[string]string{
		"backend README": readMapRemovalContractFile(t, "..", "..", "..", "docs", "backend", "README.md"),
		"schema guide":   readMapRemovalContractFile(t, "..", "..", "..", "docs", "backend", "db", "aurora-postgresql-schema.md"),
		"migration plan": readMapRemovalContractFile(t, "..", "..", "..", "docs", "infra", "mangorts-prod-data-migration.md"),
	}
	for label, document := range documents {
		for _, retired := range []string{"logic_gate_relationships", "logic_gate_relationship_position", "/v1/logic-gate-relationships"} {
			if strings.Contains(document, retired) {
				t.Errorf("%s still advertises retired contract %q", label, retired)
			}
		}
		for _, required := range []string{"process_map_placements", "resource_operational_relationships", "process_map_traces", "20260824_process_map.sql"} {
			if !strings.Contains(document, required) {
				t.Errorf("%s missing canonical Process Map contract %q", label, required)
			}
		}
	}
}
