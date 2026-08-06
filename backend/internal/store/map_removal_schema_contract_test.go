package store

import (
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
		"forward migration": extractWorkspaceReadVersionFunctionForTest(t, readMapRemovalContractFile(t, "..", "..", "db", "migrations", "20260805_zz_remove_map_runtime_contracts.sql")),
		"canonical schema":  extractWorkspaceReadVersionFunctionForTest(t, readMapRemovalContractFile(t, "..", "..", "db", "schema.sql")),
	}
	mapOnlyEvents := map[string]struct{}{
		"node_map_positions_updated":       {},
		"logic_gate_map_positions_updated": {},
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
	for _, protected := range []string{"node_relationships", "logic_gate_relationships", "node_textboxes_history", "logic_gate_textboxes_history", "node_view_user_versions"} {
		if !strings.Contains(schema, "create table if not exists "+protected) {
			t.Errorf("canonical schema lost protected table %q", protected)
		}
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
	for _, required := range []string{"begin transaction isolation level repeatable read read only", "server_version_num", "170000", "180000", "workspace_derived_domain_event_projection_checkpoints", "node_map_position_upsert", "logic_gate_map_position_upsert", "exact unordered column set drifted", "ready_for_separately_approved_map_position_retirement", "rollback;"} {
		if !strings.Contains(preflight, required) {
			t.Errorf("preflight missing %q", required)
		}
	}
	for _, required := range []string{"values (false,false,false,false,false,false)", "map_free_application_deployed", "old_writers_stopped", "operator_approved", "drop table public.node_map_positions;", "drop table public.logic_gate_map_positions;", "workspace_derived_domain_event_projection_checkpoints", "exact unordered column set drifted", "commit;"} {
		if !strings.Contains(operator, required) {
			t.Errorf("operator SQL missing %q", required)
		}
	}
	if strings.Contains(operator, "drop table public.node_map_positions cascade") || strings.Contains(operator, "drop table public.logic_gate_map_positions cascade") {
		t.Error("operator SQL must never use CASCADE")
	}
	if strings.Count(operator, "drop table public.") != 2 {
		t.Errorf("operator SQL must drop exactly two public tables, got %d", strings.Count(operator, "drop table public."))
	}
}
