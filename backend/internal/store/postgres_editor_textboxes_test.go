package store

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func editorMergeTestDocument(t *testing.T, blocks ...string) json.RawMessage {
	t.Helper()
	raw := `{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[` + strings.Join(blocks, ",") + `]}}`
	canonical, err := ValidateMangoTiptapJSON([]byte(raw))
	if err != nil {
		t.Fatalf("ValidateMangoTiptapJSON: %v", err)
	}
	return canonical
}

func TestEditorTextboxBodyStoresAnnotationsInsideJSON(t *testing.T) {
	document := editorMergeTestDocument(t,
		`{"type":"paragraph","attrs":{"blockId":"a"},"content":[{"type":"text","text":"hello"}]}`,
	)
	annotations := []EditorJSONAnnotation{{ID: "comment-1", Kind: "comment", From: 1, To: 4}}
	body, err := encodeEditorTextboxBody(document, annotations)
	if err != nil {
		t.Fatalf("encodeEditorTextboxBody: %v", err)
	}
	var stored map[string]json.RawMessage
	if err := json.Unmarshal(body, &stored); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if _, ok := stored["annotations"]; !ok {
		t.Fatal("body_json did not contain annotations")
	}
	decodedDocument, decodedAnnotations, err := decodeEditorTextboxBody(body)
	if err != nil {
		t.Fatalf("decodeEditorTextboxBody: %v", err)
	}
	if !bytes.Equal(document, decodedDocument) {
		t.Fatalf("document changed during body round trip\nwant %s\n got %s", document, decodedDocument)
	}
	if !editorJSONAnnotationsEqual(annotations, decodedAnnotations) {
		t.Fatalf("annotations changed during body round trip: %#v", decodedAnnotations)
	}
}

func TestMergeMangoTiptapDocumentsKeepsBothConflictingBlocksAndRejectsDeletion(t *testing.T) {
	serverA := `{"type":"paragraph","attrs":{"blockId":"a"},"content":[{"type":"text","text":"server edit"}]}`
	serverB := `{"type":"paragraph","attrs":{"blockId":"b"},"content":[{"type":"text","text":"server-only block"}]}`
	localA := `{"type":"paragraph","attrs":{"blockId":"a"},"content":[{"type":"text","text":"local edit"}]}`
	localC := `{"type":"paragraph","attrs":{"blockId":"c"},"content":[{"type":"text","text":"local-only block"}]}`

	merged, err := mergeMangoTiptapDocuments(
		editorMergeTestDocument(t, serverA, serverB),
		editorMergeTestDocument(t, localA, localC),
	)
	if err != nil {
		t.Fatalf("mergeMangoTiptapDocuments: %v", err)
	}
	var envelope mangoTiptapMergeEnvelope
	if err := json.Unmarshal(merged, &envelope); err != nil {
		t.Fatalf("unmarshal merged document: %v", err)
	}
	if got, want := len(envelope.Document.Content), 4; got != want {
		t.Fatalf("merged block count=%d, want %d: %s", got, want, merged)
	}
	if mangoTiptapBlockID(envelope.Document.Content[0]) != "a" ||
		!bytes.Contains(envelope.Document.Content[0], []byte("server edit")) {
		t.Fatalf("server conflict winner changed: %s", envelope.Document.Content[0])
	}
	if mangoTiptapBlockID(envelope.Document.Content[1]) != "b" ||
		!bytes.Contains(envelope.Document.Content[1], []byte("server-only block")) {
		t.Fatalf("missing local block deleted the server block: %s", merged)
	}
	if mangoTiptapBlockID(envelope.Document.Content[2]) == "a" || mangoTiptapBlockID(envelope.Document.Content[2]) == "" {
		t.Fatalf("conflicting local copy did not receive a fresh block ID: %s", envelope.Document.Content[2])
	}
	if mangoTiptapBlockID(envelope.Document.Content[3]) != "c" {
		t.Fatalf("local-only block was not appended: %s", envelope.Document.Content[3])
	}

	retried, err := mergeMangoTiptapDocuments(merged, editorMergeTestDocument(t, localA, localC))
	if err != nil {
		t.Fatalf("retry merge: %v", err)
	}
	var retriedEnvelope mangoTiptapMergeEnvelope
	if err := json.Unmarshal(retried, &retriedEnvelope); err != nil {
		t.Fatalf("unmarshal retried merge: %v", err)
	}
	if got, want := len(retriedEnvelope.Document.Content), 4; got != want {
		t.Fatalf("retry duplicated a conflict block: got %d blocks, want %d: %s", got, want, retried)
	}
}

func TestEditorTextboxCutoverUsesSixPermanentTables(t *testing.T) {
	migrationPath := filepath.Join("..", "..", "db", "migrations", "20260801_editor_textbox_storage_foundation.sql")
	migration, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(migration)
	for _, table := range []string{
		"node_textboxes", "logic_gate_textboxes", "project_textboxes",
		"node_textboxes_history", "logic_gate_textboxes_history", "project_textboxes_history",
	} {
		if !strings.Contains(sql, table) {
			t.Fatalf("migration is missing %s", table)
		}
	}
	logicStart := strings.Index(sql, "create table if not exists logic_gate_textboxes (")
	logicEnd := strings.Index(sql[logicStart:], ");")
	if logicStart < 0 || logicEnd < 0 {
		t.Fatal("logic_gate_textboxes definition not found")
	}
	if strings.Contains(sql[logicStart:logicStart+logicEnd], "display_order") {
		t.Fatal("logic_gate_textboxes must not have display_order")
	}
	for _, obsoleteWrite := range []string{
		"insert into editor_json_operations", "insert into editor_json_versions",
		"insert into project_editor_document_operations", "insert into project_editor_document_versions",
		"insert into logic_gate_editor_document_operations", "insert into logic_gate_editor_document_versions",
	} {
		activePath, err := os.ReadFile(filepath.Join("postgres_editor_" + "textboxes.go"))
		if err != nil {
			t.Fatalf("read active store: %v", err)
		}
		if strings.Contains(string(activePath), obsoleteWrite) {
			t.Fatalf("active editor path still contains obsolete write %q", obsoleteWrite)
		}
	}
}

func TestEditorTextboxRetirementRemovesNineLegacyTables(t *testing.T) {
	schema, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatalf("read canonical schema: %v", err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260801_z_retire_legacy_editor_storage.sql"))
	if err != nil {
		t.Fatalf("read retirement migration: %v", err)
	}
	schemaText := strings.ToLower(string(schema))
	migrationText := strings.ToLower(string(migration))
	obsolete := []string{
		"editor_json_documents",
		"editor_json_operations",
		"editor_json_versions",
		"project_editor_documents",
		"project_editor_document_operations",
		"project_editor_document_versions",
		"logic_gate_editor_documents",
		"logic_gate_editor_document_operations",
		"logic_gate_editor_document_versions",
	}
	for _, table := range obsolete {
		if strings.Contains(schemaText, table) {
			t.Errorf("canonical schema still references obsolete table %s", table)
		}
		if !strings.Contains(migrationText, "drop table if exists "+table) {
			t.Errorf("retirement migration does not drop %s", table)
		}
	}
	for _, required := range []string{
		"legacy_editor_storage_not_empty",
		"from node_textboxes",
		"from project_textboxes",
		"from logic_gate_textboxes",
	} {
		if !strings.Contains(migrationText, required) {
			t.Errorf("retirement migration missing %q", required)
		}
	}
}
func TestEditorTextboxCutoverAcceptsUUIDv7Identities(t *testing.T) {
	migrationPath := filepath.Join("..", "..", "db", "migrations", "20260801_editor_textbox_storage_foundation.sql")
	migration, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(migration)
	for _, check := range []string{
		"not pg_input_is_valid(resource_id, 'uuid')",
		"not pg_input_is_valid(document_id, 'uuid')",
	} {
		if !strings.Contains(sql, check) {
			t.Fatalf("migration must let PostgreSQL validate UUID identities; missing %q", check)
		}
	}
	if strings.Contains(sql, "[1-5][0-9a-f]{3}") {
		t.Fatal("migration must not reject valid UUIDv6, UUIDv7, or UUIDv8 identities")
	}
	if id := newUUIDv7String(); len(id) != 36 || id[14] != '7' {
		t.Fatalf("test requires the application's UUIDv7 identity format, got %q", id)
	}
}

func TestEditorTextboxCutoverPreservesRecyclableDocumentsAndManualHistory(t *testing.T) {
	checks := map[string][]string{
		filepath.Join("..", "..", "db", "migrations", "20260801_editor_textbox_storage_foundation.sql"): {
			"join nodes parent",
			"information.save_kind <> 'auto'",
		},
		filepath.Join("..", "..", "..", "scripts", "verify_editor_textbox_cutover.sql"): {
			"recyclable node current rows missing or different in recycle payload",
			"recycle current textbox projections not copied",
			"recycle legacy editor save rows not converted",
		},
		filepath.Join("..", "..", "..", "scripts", "apply_editor_textbox_cleanup.sql"): {
			"editor_textbox_cleanup_blocked_recyclable_node_document",
			"editor_textbox_cleanup_blocked_recycle_current_rows",
			"editor_textbox_cleanup_blocked_recycle_history_rows",
		},
	}
	for path, required := range checks {
		contents, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		for _, text := range required {
			if !strings.Contains(string(contents), text) {
				t.Fatalf("%s must preserve recycled editor state; missing %q", path, text)
			}
		}
	}
}

func TestEditorTextboxRecyclePayloadUsesSixPermanentTables(t *testing.T) {
	contents, err := os.ReadFile("postgres_recycle_bin.go")
	if err != nil {
		t.Fatalf("read postgres_recycle_bin.go: %v", err)
	}
	source := string(contents)
	for _, table := range []string{
		"node_textboxes", "project_textboxes", "logic_gate_textboxes",
		"node_textboxes_history", "project_textboxes_history", "logic_gate_textboxes_history",
	} {
		if !strings.Contains(source, `"`+table+`":`) || strings.Count(source, `"`+table+`"`) < 3 {
			t.Fatalf("recycle snapshot and restore paths must include %s", table)
		}
	}
}
func TestEditorTextboxWritesUseDatabaseTimestamps(t *testing.T) {
	contents, err := os.ReadFile("postgres_editor_textboxes.go")
	if err != nil {
		t.Fatalf("read postgres_editor_textboxes.go: %v", err)
	}
	source := string(contents)
	if strings.Contains(source, "clock_timestamp(),clock_timestamp()") {
		t.Fatal("textbox inserts must not use two independently evaluated clock timestamps")
	}
	if strings.Count(source, "statement_timestamp(),statement_timestamp()") != 3 {
		t.Fatal("all three textbox insert paths must use one stable statement timestamp")
	}
	if strings.Count(source, "greatest(clock_timestamp(),created_timestamp)") != 2 {
		t.Fatal("commit and delete must use a database timestamp that cannot precede row creation")
	}
}
